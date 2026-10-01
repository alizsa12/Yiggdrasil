"""Yggdrasil memory store.

Local-first persistence for an AI agent's long term memory.
Everything lives in a single SQLite file (source of truth) with a
human-readable JSON mirror written on every mutation, so the memory can be
inspected, versioned or moved without any external service.

Concepts
--------
node     a position in the tree. Leaves carry a memory_id.
memory   a single remembered fact / episode / project state.
link     a semantic edge between two memories, even across branches.
activity an append-only trace of what the agent did (read/create/update/...).

The store is thread safe (one lock, one connection per thread) and publishes
in-process events so the HTTP layer can stream live activity to the UI.
"""

from __future__ import annotations

import json
import math
import os
import re
import sqlite3
import threading
import time
import uuid
from collections import deque
from typing import Any, Callable, Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS nodes (
    id           TEXT PRIMARY KEY,
    parent_id    TEXT,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'branch',   -- root|domain|branch|leaf
    summary      TEXT DEFAULT '',
    hue          INTEGER DEFAULT 265,
    depth        INTEGER DEFAULT 0,
    memory_id    TEXT,                            -- leaves only
    collapsed    INTEGER DEFAULT 0,
    pinned       INTEGER DEFAULT 0,
    created_at   REAL NOT NULL,
    updated_at   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);

CREATE TABLE IF NOT EXISTS memories (
    id           TEXT PRIMARY KEY,
    node_id      TEXT NOT NULL,
    title        TEXT NOT NULL,
    content      TEXT DEFAULT '',
    kind         TEXT DEFAULT 'fact',   -- fact|episode|project|person|skill|goal|insight|event
    domain       TEXT DEFAULT '',
    tags         TEXT DEFAULT '[]',
    importance   REAL DEFAULT 0.5,
    confidence   REAL DEFAULT 0.7,
    source       TEXT DEFAULT 'agent',
    created_at   REAL NOT NULL,
    updated_at   REAL NOT NULL,
    accessed_at  REAL,
    access_count INTEGER DEFAULT 0,
    version      INTEGER DEFAULT 1,
    status       TEXT DEFAULT 'active',  -- active|superseded|archived
    merged_into  TEXT
);
CREATE INDEX IF NOT EXISTS idx_mem_node ON memories(node_id);
CREATE INDEX IF NOT EXISTS idx_mem_status ON memories(status);

CREATE TABLE IF NOT EXISTS links (
    id         TEXT PRIMARY KEY,
    a          TEXT NOT NULL,
    b          TEXT NOT NULL,
    type       TEXT DEFAULT 'related',
    weight     REAL DEFAULT 0.6,
    note       TEXT DEFAULT '',
    created_at REAL NOT NULL,
    UNIQUE(a, b)
);
CREATE INDEX IF NOT EXISTS idx_link_a ON links(a);
CREATE INDEX IF NOT EXISTS idx_link_b ON links(b);

CREATE TABLE IF NOT EXISTS activity (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         REAL NOT NULL,
    action     TEXT NOT NULL,
    actor      TEXT DEFAULT 'agent',
    memory_id  TEXT,
    node_id    TEXT,
    title      TEXT DEFAULT '',
    detail     TEXT DEFAULT '',
    duration_ms INTEGER,
    score      REAL,
    tokens     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts DESC);

CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

TOKEN_RE = re.compile(r"[a-z0-9_]+")

# words that carry little signal when matching a query
STOPWORDS = {
    "a", "an", "the", "is", "are", "was", "were", "of", "to", "in", "on",
    "for", "and", "or", "it", "that", "this", "with", "about", "from", "by",
}


def _now() -> float:
    return time.time()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _limit(value: Any, default: int, ceiling: int = 500) -> int:
    """Clamp a caller-supplied limit.

    A negative limit is not an error to the list it slices -- `rows[:-5]` drops
    the tail and returns almost everything -- so it has to be rejected here.
    """
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(1, min(n, ceiling))


def _pair(a: str, b: str) -> tuple[str, str]:
    """Canonical ordering for the two ends of an undirected link.

    A link has no direction: (a,b) and (b,a) must land on the same row, which
    is what makes the upsert on UNIQUE(a,b) idempotent. Every path that writes
    or reads a link pair goes through here, so the stored order can never
    disagree with the order the activity log or the event stream reports.
    """
    return (a, b) if a <= b else (b, a)


def tokenize(text: str) -> list[str]:
    return [t for t in TOKEN_RE.findall((text or "").lower()) if t and t not in STOPWORDS]


class Store:
    """Thread-safe SQLite + JSON memory store."""

    def __init__(self, db_path: str, json_path: str | None = None) -> None:
        self.db_path = os.path.abspath(db_path)
        self.json_path = os.path.abspath(json_path) if json_path else None
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._lock = threading.RLock()
        self._local = threading.local()
        self._subscribers: list[Callable[[dict], None]] = []
        self._conn = self._connect()
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.commit()

    # ------------------------------------------------------------------ plumbing
    def _connect(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA foreign_keys=ON")
            self._local.conn = conn
        return conn

    def q(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self._connect().execute(sql, tuple(params)).fetchall())

    def x(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self._connect().execute(sql, tuple(params))
            self._connect().commit()
            return cur

    def kv_get(self, key: str, default: Any = None) -> Any:
        rows = self.q("SELECT value FROM kv WHERE key=?", (key,))
        return json.loads(rows[0]["value"]) if rows else default

    def kv_set(self, key: str, value: Any) -> None:
        self.x(
            "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value)),
        )

    # ------------------------------------------------------------------ events
    def subscribe(self, fn: Callable[[dict], None]) -> Callable[[], None]:
        with self._lock:
            self._subscribers.append(fn)

        def unsubscribe() -> None:
            with self._lock:
                if fn in self._subscribers:
                    self._subscribers.remove(fn)

        return unsubscribe

    def _emit(self, event: dict) -> None:
        for fn in list(self._subscribers):
            try:
                fn(event)
            except Exception:  # a broken UI pipe must never break memory writes
                pass

    # ------------------------------------------------------------------ row mapping
    @staticmethod
    def _memory(row: sqlite3.Row) -> dict:
        m = dict(row)
        m["tags"] = json.loads(m.get("tags") or "[]")
        return m

    @staticmethod
    def _node(row: sqlite3.Row) -> dict:
        n = dict(row)
        n["collapsed"] = bool(n["collapsed"])
        n["pinned"] = bool(n["pinned"])
        return n

    def node(self, node_id: str) -> dict | None:
        rows = self.q("SELECT * FROM nodes WHERE id=?", (node_id,))
        return self._node(rows[0]) if rows else None

    def memory(self, memory_id: str) -> dict | None:
        rows = self.q("SELECT * FROM memories WHERE id=?", (memory_id,))
        return self._memory(rows[0]) if rows else None

    def node_of_memory(self, memory_id: str) -> dict | None:
        rows = self.q(
            "SELECT n.* FROM nodes n JOIN memories m ON m.node_id = n.id WHERE m.id=?",
            (memory_id,),
        )
        return self._node(rows[0]) if rows else None

    # ------------------------------------------------------------------ tree
    def create_node(
        self,
        parent_id: str | None,
        name: str,
        kind: str = "branch",
        hue: int | None = None,
        summary: str = "",
        collapsed: bool = False,
        node_id: str | None = None,
    ) -> dict:
        parent = self.node(parent_id) if parent_id else None
        depth = 0 if parent is None else parent["depth"] + 1
        if hue is None:
            hue = parent["hue"] if parent else 265
        now = _now()
        nid = node_id or new_id("nd")
        self.x(
            """INSERT INTO nodes(id,parent_id,name,kind,summary,hue,depth,memory_id,collapsed,pinned,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,NULL,?,0,?,?)""",
            (nid, parent_id, name, kind, summary, hue, depth, int(collapsed), now, now),
        )
        self._prune_collapsed(parent_id)
        self._mirror()
        node = self.node(nid)
        self._emit({"type": "node", "action": "create", "node": node})
        return node

    def update_node(self, node_id: str, changes: dict) -> dict | None:
        allowed = {"name", "summary", "hue", "collapsed", "pinned", "kind"}
        sets, params = [], []
        for key, value in changes.items():
            if key not in allowed:
                continue
            if key in ("collapsed", "pinned"):
                value = int(bool(value))
            sets.append(f"{key}=?")
            params.append(value)
        if not sets:
            return self.node(node_id)
        sets.append("updated_at=?")
        params.append(_now())
        params.append(node_id)
        self.x(f"UPDATE nodes SET {', '.join(sets)} WHERE id=?", params)
        self._prune_collapsed(node_id)
        self._mirror()
        node = self.node(node_id)
        self._emit({"type": "node", "action": "update", "node": node})
        return node

    def _prune_collapsed(self, node_id: str | None) -> None:
        """Hook for future expansion caching; the client derives this itself."""
        return

    def expanded_ids(self) -> list[str]:
        """Nodes that have an open ancestor (i.e. are currently rendered)."""
        nodes = {n["id"]: n for n in self.map_nodes()}
        out: list[str] = []
        for nid in nodes:
            cur, visible, depth = nodes[nid], True, 0
            while cur and cur["parent_id"] and depth < 64:
                cur = nodes.get(cur["parent_id"])
                depth += 1
                if cur and cur["collapsed"]:
                    visible = False
                    break
            if visible:
                out.append(nid)
        return out

    # ------------------------------------------------------------------ memories
    def remember(
        self,
        title: str,
        content: str = "",
        parent_id: str | None = None,
        kind: str = "fact",
        domain: str = "",
        tags: list[str] | None = None,
        importance: float = 0.5,
        confidence: float = 0.7,
        source: str = "agent",
        node_name: str | None = None,
        actor: str = "agent",
        link_to: list[str] | None = None,
    ) -> dict:
        title = (title or "").strip() or "untitled memory"
        if parent_id is None:
            parent_id = self.kv_get("root_id")
        parent = self.node(parent_id)
        if parent is None:
            raise ValueError(f"unknown parent node: {parent_id}")
        # resolve every link target *before* writing anything: a bad link_to used to
        # raise after the memory and its leaf were committed, so the caller's retry
        # produced a duplicate of a memory it had already been told had failed
        for other in link_to or []:
            if self.memory(other) is None:
                raise KeyError(other)

        now = _now()
        mid = new_id("mem")
        # the leaf is created first so the memory can point at its own node
        leaf = self.create_node(
            parent["id"], node_name or title[:60], kind="leaf",
            hue=parent["hue"], node_id=new_id("nd"),
        )
        self.x(
            """INSERT INTO memories(id,node_id,title,content,kind,domain,tags,importance,confidence,
                                   source,created_at,updated_at,accessed_at,access_count,version,status,merged_into)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,1,'active',NULL)""",
            (
                mid, leaf["id"], title, content or "", kind, domain or parent["name"],
                json.dumps(tags or []), float(importance), float(confidence),
                source or "agent", now, now, None,
            ),
        )
        self.x("UPDATE nodes SET memory_id=? WHERE id=?", (mid, leaf["id"]))

        for other in link_to or []:
            try:
                self.link(mid, other, note="created together", actor=actor, log=False)
            except ValueError:
                pass

        memory = self.memory(mid)
        self.log_activity("create", memory=memory, detail=f"remembered “{title}”", actor=actor)
        self._mirror()
        self._emit({"type": "memory", "action": "create", "memory": memory})
        return memory

    def update(self, memory_id: str, changes: dict, actor: str = "agent", log: bool = True) -> dict:
        memory = self.memory(memory_id)
        if memory is None:
            raise KeyError(memory_id)
        allowed = {
            "title", "content", "kind", "domain", "tags", "importance",
            "confidence", "source", "status", "parent_id",
        }
        sets, params, changed = [], [], []
        for key, value in changes.items():
            if key not in allowed:
                continue
            if key == "tags":
                tags = [str(t) for t in (value or [])]
                # compare before serialising: memory["tags"] is a list, so comparing
                # it to the JSON string reported a change on every no-op update
                if list(memory.get("tags") or []) != tags:
                    changed.append("tags")
                value = json.dumps(tags)
            if key == "importance":
                value = max(0.0, min(1.0, float(value)))
            if key == "confidence":
                value = max(0.0, min(1.0, float(value)))
            if key == "parent_id":
                # moving a memory re-parents its leaf node in the tree
                new_parent = self.node(value)
                if new_parent is None:
                    raise ValueError(f"unknown parent node: {value}")
                self.x(
                    "UPDATE nodes SET parent_id=?, name=?, depth=?, updated_at=? WHERE id=?",
                    (new_parent["id"], changes.get("title", memory["title"])[:60],
                     new_parent["depth"] + 1, _now(), memory["node_id"]),
                )
                self._prune_collapsed(value)
                changed.append("location")
                continue
            if key != "tags" and memory.get(key) != value:
                changed.append(key)
            sets.append(f"{key}=?")
            params.append(value)

        if sets:
            sets.append("updated_at=?")
            sets.append("version=version+1")
            params.append(_now())
            params.append(memory_id)
            self.x(f"UPDATE memories SET {', '.join(sets)} WHERE id=?", params)

        memory = self.memory(memory_id)
        if log and changed:
            self.log_activity(
                "update", memory=memory,
                detail="changed " + ", ".join(sorted(set(changed))), actor=actor,
            )
        self._mirror()
        self._emit({"type": "memory", "action": "update", "memory": memory})
        return memory

    def forget(self, memory_id: str, hard: bool = False, actor: str = "agent") -> dict:
        memory = self.memory(memory_id)
        if memory is None:
            raise KeyError(memory_id)
        node_id = memory["node_id"]
        subtree = {node_id} | self.descendant_nodes(node_id)
        mem_ids = [r["id"] for r in self.q(
            f"SELECT id FROM memories WHERE node_id IN ({','.join('?' * len(subtree))})",
            tuple(subtree),
        )]
        if hard:
            self.x(f"DELETE FROM links WHERE a IN ({','.join('?' * len(mem_ids))}) "
                   f"OR b IN ({','.join('?' * len(mem_ids))})", tuple(mem_ids) * 2)
            # The activity log is an audit trail: keep the rows and the text they
            # carry, but drop the ids that are about to stop resolving to anything.
            self.x("UPDATE activity SET memory_id=NULL, node_id=NULL WHERE memory_id IN "
                   f"({','.join('?' * len(mem_ids))}) OR node_id IN ({','.join('?' * len(subtree))})",
                   (*mem_ids, *subtree))
            self.x(f"DELETE FROM memories WHERE id IN ({','.join('?' * len(mem_ids))})", tuple(mem_ids))
            self.x(f"DELETE FROM nodes WHERE id IN ({','.join('?' * len(subtree))})", tuple(subtree))
            action = "forget"
            detail = f"deleted “{memory['title']}”"
        else:
            self.x("UPDATE memories SET status='archived', updated_at=? WHERE id IN "
                   f"({','.join('?' * len(mem_ids))})", (_now(), *mem_ids))
            action = "archive"
            detail = f"archived “{memory['title']}”"

        # after a hard delete the memory row is gone, so this event carries the
        # title only — never an id that no longer resolves
        self.log_activity(action, memory=None if hard else memory,
                          title=memory["title"], detail=detail, actor=actor)
        self._mirror()
        self._emit({"type": "memory", "action": action, "id": memory_id})
        return {"forgotten": mem_ids, "hard": hard}

    def descendant_nodes(self, node_id: str) -> set[str]:
        out: set[str] = set()
        frontier = [node_id]
        while frontier:
            rows = self.q(
                f"SELECT id FROM nodes WHERE parent_id IN ({','.join('?' * len(frontier))})",
                tuple(frontier),
            )
            frontier = [r["id"] for r in rows if r["id"] not in out]
            out.update(frontier)
        return out

    def merge(self, a_id: str, b_id: str, actor: str = "agent", title: str | None = None) -> dict:
        """Fold memory b into memory a, inheriting b's links, tags and recency."""
        a, b = self.memory(a_id), self.memory(b_id)
        if not a or not b:
            raise KeyError("unknown memory id")

        tags = list(dict.fromkeys(a["tags"] + b["tags"]))
        content = a["content"].strip()
        extra = b["content"].strip()
        if extra and extra not in content:
            content = f"{content}\n\n— merged from “{b['title']}” —\n{extra}" if content else extra

        self.update(
            a_id,
            {
                "title": title or a["title"],
                "content": content,
                "tags": tags,
                "importance": max(a["importance"], b["importance"]),
                "confidence": min(1.0, (a["confidence"] + b["confidence"]) / 2 + 0.05),
                "source": a["source"] if a["source"] == b["source"] else f"{a['source']}+{b['source']}",
            },
            actor=actor, log=False,
        )
        for row in self.q("SELECT * FROM links WHERE b=?", (b_id,)):
            if row["a"] != a_id:
                try:
                    self.link(a_id, row["a"], type=row["type"], weight=row["weight"],
                              note=row["note"], actor=actor, log=False)
                except ValueError:
                    pass
        for row in self.q("SELECT * FROM links WHERE a=?", (b_id,)):
            if row["b"] != a_id:
                try:
                    self.link(a_id, row["b"], type=row["type"], weight=row["weight"],
                              note=row["note"], actor=actor, log=False)
                except ValueError:
                    pass
        self.x("UPDATE memories SET status='superseded', merged_into=?, updated_at=? WHERE id=?",
               (a_id, _now(), b_id))
        self.x("UPDATE nodes SET name=? WHERE id=?", (f"merged: {b['title'][:40]}", b["node_id"]))

        merged = self.memory(a_id)
        self.log_activity("merge", memory=merged,
                          detail=f"merged “{b['title']}” into “{merged['title']}”", actor=actor)
        self._mirror()
        self._emit({"type": "memory", "action": "merge", "memory": merged})
        return merged

    # ------------------------------------------------------------------ links
    def link(
        self,
        a_id: str,
        b_id: str,
        type: str = "related",
        weight: float = 0.6,
        note: str = "",
        actor: str = "agent",
        log: bool = True,
    ) -> dict:
        if a_id == b_id:
            raise ValueError("cannot link a memory to itself")
        if not self.memory(a_id) or not self.memory(b_id):
            raise KeyError("unknown memory id")
        a, b = _pair(a_id, b_id)
        self.x(
            """INSERT INTO links(id,a,b,type,weight,note,created_at) VALUES(?,?,?,?,?,?,?)
               ON CONFLICT(a,b) DO UPDATE SET weight=excluded.weight, note=excluded.note, type=excluded.type""",
            (new_id("lnk"), a, b, type, float(weight), note, _now()),
        )
        row = self.q("SELECT * FROM links WHERE a=? AND b=?", (a, b))[0]
        link = dict(row)
        if log:
            # the log names the canonical pair, so the audit trail agrees with
            # the stored row no matter which order the caller supplied
            self.log_activity("link", memory=self.memory(a),
                              title=self.memory(a)["title"],
                              detail=f"linked “{self.memory(a)['title']}” ↔ “{self.memory(b)['title']}”",
                              actor=actor)
        self._mirror()
        self._emit({"type": "link", "action": "link", "link": link})
        return link

    def unlink(self, a_id: str, b_id: str) -> bool:
        a, b = _pair(a_id, b_id)
        cur = self.x("DELETE FROM links WHERE a=? AND b=?", (a, b))
        self._mirror()
        self._emit({"type": "link", "action": "unlink", "ids": [a, b]})
        return cur.rowcount > 0

    # ------------------------------------------------------------------ read paths
    def map_nodes(self) -> list[dict]:
        return [self._node(r) for r in self.q("SELECT * FROM nodes")]

    def map_memories(self, include_archived: bool = False) -> list[dict]:
        sql = "SELECT * FROM memories"
        if not include_archived:
            sql += " WHERE status='active'"
        return [self._memory(r) for r in self.q(sql)]

    def map_links(self) -> list[dict]:
        return [dict(r) for r in self.q("SELECT * FROM links")]

    def score(self, memory: dict, terms: list[str], now: float) -> float:
        if not terms:
            base = 0.0
        else:
            title_tokens = set(tokenize(memory["title"]))
            tag_tokens = {t.lower() for t in memory["tags"]}
            content_tokens = tokenize(memory["content"])
            content_set = set(content_tokens)
            score = 0.0
            for term in terms:
                if term in title_tokens:
                    score += 4.0
                if term in tag_tokens:
                    score += 2.6
                if term in memory["title"].lower():
                    score += 1.6
                if term in content_set:
                    score += 1.1
                elif term in (memory["content"] or "").lower():
                    score += 0.5
                if term and term in (memory["domain"] or "").lower():
                    score += 0.7
            score /= len(terms)
            base = score

        # gentle prior: important memories surface first, recency breaks ties
        age_days = max(0.0, (now - memory["created_at"]) / 86400.0)
        recency = math.exp(-age_days / 45.0)
        if terms and base <= 0.0:
            # nothing matched: the recency prior must not invent a match, or every
            # young memory answers every query ("walrus operator" -> banana bread)
            return 0.0
        return base * (0.55 + memory["importance"]) + recency * (0.35 if not terms else 0.08)

    def search(self, query: str, limit: int = 40, include_archived: bool = False) -> list[dict]:
        now = _now()
        limit = _limit(limit, 40)
        terms = tokenize(query)
        rows = []
        for memory in self.map_memories(include_archived):
            value = self.score(memory, terms, now)
            if not terms and value <= 0:
                continue
            if terms and value <= 0.05:
                continue
            rows.append({**memory, "score": round(value, 4)})
        rows.sort(key=lambda m: -m["score"])
        return rows[:limit]

    def recall(self, query: str, limit: int = 8, actor: str = "agent", record: bool = True) -> list[dict]:
        """Agent-facing retrieval: ranked results + a retrieval trace."""
        started = time.perf_counter()
        limit = _limit(limit, 8)
        results = self.search(query, limit=limit * 3)
        # memories the agent already knows get a small boost (exposure matters)
        for r in results:
            r["score"] *= 1.0 + min(0.35, r["access_count"] * 0.06)
        # the boost changes the order, so the order has to be taken again --
        # otherwise results come back unsorted and `limit` cuts the wrong ones
        results.sort(key=lambda m: -m["score"])
        results = results[:limit]
        duration = int((time.perf_counter() - started) * 1000)
        if record:
            first = results[0] if results else None
            self.log_activity(
                "retrieve", memory=first, duration_ms=duration,
                score=round(first["score"], 3) if first else 0.0,
                tokens=len(tokenize(query)),
                detail=f"recall “{query}” → {len(results)} memories", actor=actor,
            )
            for r in results:  # reinforce what was actually surfaced
                self.x(
                    "UPDATE memories SET accessed_at=?, access_count=access_count+1 WHERE id=?",
                    (_now(), r["id"]),
                )
        return results

    def context(self, memory_id: str, hops: int = 1) -> dict:
        """A memory plus its neighbourhood — what an agent needs to 'understand' it."""
        memory = self.memory(memory_id)
        if not memory:
            raise KeyError(memory_id)
        seen = {memory_id}
        frontier = [memory_id]
        related: list[dict] = []
        for _ in range(max(0, hops)):
            nxt: list[str] = []
            for mid in frontier:
                rows = self.q(
                    "SELECT * FROM links WHERE a=? OR b=? ORDER BY weight DESC",
                    (mid, mid),
                )
                for row in rows:
                    other = row["b"] if row["a"] == mid else row["a"]
                    if other in seen:
                        continue
                    seen.add(other)
                    m = self.memory(other)
                    if m:
                        related.append({**m, "relation": row["type"],
                                        "link_weight": row["weight"], "via": mid})
                    nxt.append(other)
            frontier = nxt
        related.sort(key=lambda m: -m["link_weight"])
        self.log_activity("read", memory=memory,
                          detail=f"read “{memory['title']}” (+{len(related)} linked)", duration_ms=12)
        return {"memory": memory, "related": related[:12]}

    # ------------------------------------------------------------------ activity
    def log_activity(
        self,
        action: str,
        memory: dict | None = None,
        detail: str = "",
        actor: str = "agent",
        duration_ms: int | None = None,
        score: float | None = None,
        tokens: int | None = None,
        title: str = "",
    ) -> dict:
        now = _now()
        cur = self.x(
            """INSERT INTO activity(ts,action,actor,memory_id,node_id,title,detail,duration_ms,score,tokens)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (now, action, actor, memory["id"] if memory else None,
             memory["node_id"] if memory else None,
             memory["title"] if memory else title, detail, duration_ms, score, tokens),
        )
        row = self.q("SELECT * FROM activity WHERE id=?", (cur.lastrowid,))[0]
        entry = dict(row)
        self.kv_set("last_active", now)
        self._emit({"type": "activity", "activity": entry})
        return entry

    def recent_activity(self, limit: int = 80, since: float | None = None) -> list[dict]:
        limit = _limit(limit, 80, 1000)
        if since is not None:
            rows = self.q(
                "SELECT * FROM activity WHERE ts > ? ORDER BY ts DESC LIMIT ?", (since, limit)
            )
        else:
            rows = self.q("SELECT * FROM activity ORDER BY ts DESC LIMIT ?", (limit,))
        return [dict(r) for r in rows]

    def stats(self) -> dict:
        memories = self.map_memories()
        now = _now()
        ages = [(now - m["created_at"]) / 86400.0 for m in memories]
        nodes = self.map_nodes()
        return {
            "memories": len(memories),
            "archived": self.q("SELECT COUNT(*) c FROM memories WHERE status<>'active'")[0]["c"],
            "nodes": len(nodes),
            "branches": sum(1 for n in nodes if n["kind"] != "leaf"),
            "links": len(self.map_links()),
            "accesses": sum(m["access_count"] for m in memories),
            "avg_importance": round(sum(m["importance"] for m in memories) / max(1, len(memories)), 3),
            "avg_confidence": round(sum(m["confidence"] for m in memories) / max(1, len(memories)), 3),
            "oldest_days": round(max(ages) if ages else 0, 1),
            "newest_days": round(min(ages) if ages else 0, 1),
            "created_last_week": sum(1 for a in ages if a <= 7),
            "sources": self._bucket(memories, "source"),
            "kinds": self._bucket(memories, "kind"),
            "domains": self._bucket(memories, "domain"),
        }

    @staticmethod
    def _bucket(memories: list[dict], field: str) -> list[dict]:
        counts: dict[str, int] = {}
        for m in memories:
            counts[m.get(field) or "unknown"] = counts.get(m.get(field) or "unknown", 0) + 1
        return sorted(
            ({"key": k, "count": v} for k, v in counts.items()),
            key=lambda d: -d["count"],
        )

    # ------------------------------------------------------------------ snapshot
    def state(self, include_archived: bool = False) -> dict:
        nodes = self.map_nodes()
        memories = self.map_memories(include_archived)
        mem_by_id = {m["id"]: m for m in memories}
        node_mem = {n["id"]: n.get("memory_id") for n in nodes}
        # weights (how much a subtree matters) drive the 3D layout
        weight: dict[str, float] = {}
        for n in nodes:
            weight[n["id"]] = mem_by_id[n["memory_id"]]["importance"] if n.get("memory_id") in mem_by_id else 0.0
        for n in sorted(nodes, key=lambda n: -n["depth"]):
            if n["parent_id"]:
                weight[n["parent_id"]] = weight.get(n["parent_id"], 0.0) + weight.get(n["id"], 0.0) * 0.55

        counts: dict[str, int] = {}
        for n in nodes:
            counts[n["parent_id"]] = counts.get(n["parent_id"], 0) + 1

        degree: dict[str, int] = {}
        for row in self.q("SELECT a, b FROM links"):
            for mid in (row["a"], row["b"]):
                degree[mid] = degree.get(mid, 0) + 1

        return {
            "meta": {
                "root_id": self.kv_get("root_id"),
                "agent": self.kv_get("agent_name", "agent"),
                "created_at": self.kv_get("created_at", _now()),
                "now": _now(),
                "schema": 2,
            },
            "nodes": [
                {**n, "weight": round(weight.get(n["id"], 0.0), 4), "children": counts.get(n["id"], 0)}
                for n in nodes
            ],
            "memories": [
                {**m, "branch_count": degree.get(m["id"], 0)} for m in memories
            ],
            "links": [l for l in self.map_links() if l["a"] in mem_by_id and l["b"] in mem_by_id],
            "stats": self.stats(),
            "activity": self.recent_activity(60),
        }

    # ------------------------------------------------------------------ json mirror
    def _mirror(self) -> None:
        if not self.json_path:
            return
        try:
            payload = {
                "meta": self.kv_get("meta", {}),
                "exported_at": _now(),
                "nodes": self.map_nodes(),
                "memories": self.map_memories(include_archived=True),
                "links": self.map_links(),
            }
            tmp = self.json_path + ".tmp"
            os.makedirs(os.path.dirname(self.json_path), exist_ok=True)
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2, ensure_ascii=False)
            os.replace(tmp, self.json_path)
        except OSError:
            pass

    def export(self) -> dict:
        return {
            "meta": self.kv_get("meta", {}),
            "exported_at": _now(),
            "nodes": self.map_nodes(),
            "memories": self.map_memories(include_archived=True),
            "links": self.map_links(),
        }

    # ------------------------------------------------------------------ import
    def load_payload(self, payload: dict, replace: bool = False) -> dict:
        """Import an export payload, repairing every reference it carries.

        Ids are minted for anything that arrived without one, and every id-shaped
        reference is checked against the set that will actually exist afterwards:
        a node's memory_id, a memory's node_id and merged_into, and both ends of
        a link. A payload from export() needs none of this, but a partial or
        hand-written one used to import happily and leave pointers to nothing.
        """
        if not isinstance(payload, dict):
            raise ValueError("payload must be an object")

        raw_nodes = [dict(r) for r in payload.get("nodes", [])]
        raw_memories = [dict(r) for r in payload.get("memories", [])]
        for raw in raw_nodes:
            raw["id"] = raw.get("id") or new_id("nd")
        for raw in raw_memories:
            raw["id"] = raw.get("id") or new_id("mem")

        node_ids = {r["id"] for r in raw_nodes}
        memory_ids = {r["id"] for r in raw_memories}
        # a graft target for memories whose branch went missing in the payload
        root_id = (next((r["id"] for r in raw_nodes if r.get("kind") == "root"), None)
                   or next((r["id"] for r in raw_nodes if not r.get("parent_id")), None))

        with self._lock:
            # merging into an existing tree: ids already there are legitimate targets
            known_nodes = set() if replace else {r["id"] for r in self.q("SELECT id FROM nodes")}
            known_memories = (set() if replace
                              else {r["id"] for r in self.q("SELECT id FROM memories")})
            resolvable_nodes = known_nodes | node_ids
            resolvable_memories = known_memories | memory_ids

            repaired = {"parent": 0, "node_memory": 0, "memory_node": 0, "merged_into": 0, "links": 0}
            for raw in raw_nodes:
                if raw.get("parent_id") not in resolvable_nodes:
                    raw["parent_id"] = None
                    repaired["parent"] += 1
                # a branch carrying no memory is legal; a memory_id pointing nowhere is not
                if raw.get("memory_id") and raw["memory_id"] not in resolvable_memories:
                    raw["memory_id"] = None
                    repaired["node_memory"] += 1
            for raw in raw_memories:
                if raw.get("node_id") not in resolvable_nodes:
                    raw["node_id"] = root_id or raw.get("node_id")
                    repaired["memory_node"] += 1
                if raw.get("merged_into") and raw["merged_into"] not in resolvable_memories:
                    raw["merged_into"] = None
                    repaired["merged_into"] += 1
            raw_links = []
            for raw in payload.get("links", []):
                if raw.get("a") in resolvable_memories and raw.get("b") in resolvable_memories:
                    raw_links.append(raw)
                else:
                    repaired["links"] += 1

            now = _now()
            conn = self._connect()
            # One transaction for the whole import. kv_set() commits on every
            # statement, so a failure part-way through used to leave a database
            # holding some of the new tree and some of the old.
            try:
                if replace:
                    # kv holds the *old* tree's identity. Leaving it behind points the
                    # interface at a root node that this import just deleted.
                    for stmt in ("DELETE FROM nodes", "DELETE FROM memories", "DELETE FROM links"):
                        conn.execute(stmt)
                    # same rule as forget(hard=True): keep the audit rows and their
                    # text, drop the ids that this import is about to invalidate
                    conn.execute("UPDATE activity SET memory_id=NULL, node_id=NULL "
                                 "WHERE memory_id IS NOT NULL OR node_id IS NOT NULL")
                    conn.execute("DELETE FROM kv")
                for raw in raw_nodes:
                    conn.execute(
                        """INSERT OR REPLACE INTO nodes(id,parent_id,name,kind,summary,hue,depth,
                               memory_id,collapsed,pinned,created_at,updated_at)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (raw["id"], raw.get("parent_id"), raw.get("name", "untitled"),
                         raw.get("kind", "branch"), raw.get("summary", ""), raw.get("hue", 265),
                         raw.get("depth", 0), raw.get("memory_id"), int(raw.get("collapsed", 0)),
                         int(raw.get("pinned", 0)), raw.get("created_at", now), now),
                    )
                for raw in raw_memories:
                    conn.execute(
                        """INSERT OR REPLACE INTO memories(id,node_id,title,content,kind,domain,tags,
                               importance,confidence,source,created_at,updated_at,accessed_at,
                               access_count,version,status,merged_into)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (raw["id"], raw.get("node_id"), raw.get("title", "untitled"),
                         raw.get("content", ""), raw.get("kind", "fact"), raw.get("domain", ""),
                         json.dumps(raw.get("tags", [])), raw.get("importance", 0.5),
                         raw.get("confidence", 0.7), raw.get("source", "agent"),
                         raw.get("created_at", now), raw.get("updated_at", now),
                         raw.get("accessed_at"), raw.get("access_count", 0), raw.get("version", 1),
                         raw.get("status", "active"), raw.get("merged_into")),
                    )
                for raw in raw_links:
                    a, b = _pair(raw["a"], raw["b"])
                    conn.execute(
                        "INSERT OR REPLACE INTO links(id,a,b,type,weight,note,created_at)"
                        " VALUES(?,?,?,?,?,?,?)",
                        (raw.get("id", new_id("lnk")), a, b, raw.get("type", "related"),
                         raw.get("weight", 0.6), raw.get("note", ""), raw.get("created_at", now)),
                    )
                meta = payload.get("meta") or {}
                # never leave root_id pointing at a node this import did not create
                wanted = meta.get("root_id")
                entries = [("meta", meta),
                           ("root_id", wanted if wanted in node_ids else root_id)]
                if meta.get("agent"):
                    entries.append(("agent_name", meta["agent"]))
                for key, value in entries:
                    conn.execute(
                        "INSERT INTO kv(key,value) VALUES(?,?) "
                        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        (key, json.dumps(value)),
                    )
                conn.commit()
            except Exception:
                conn.rollback()
                raise
        self._mirror()
        return {"nodes": len(raw_nodes), "memories": len(raw_memories),
                "links": len(raw_links), "repaired": repaired}

    def close(self) -> None:
        with self._lock:
            try:
                self._connect().close()
            except Exception:
                pass


class EventHub:
    """Fan-out of store events to subscribers (used by the SSE endpoint)."""

    def __init__(self, store: Store, history: int = 120) -> None:
        self._store = store
        self._queues: list[deque] = []
        self._lock = threading.Lock()
        self._history: deque[dict] = deque(maxlen=history)
        self._unsub = store.subscribe(self._push)

    def _push(self, event: dict) -> None:
        with self._lock:
            self._history.append(event)
            dead = []
            for q in self._queues:
                if len(q) < 256:
                    q.append(event)
                else:
                    dead.append(q)
            for q in dead:
                self._queues.remove(q)

    def subscribe(self) -> deque:
        q: deque = deque(maxlen=256)
        with self._lock:
            for event in list(self._history):
                q.append(event)
            self._queues.append(q)
        return q

    def unsubscribe(self, q: deque) -> None:
        with self._lock:
            if q in self._queues:
                self._queues.remove(q)

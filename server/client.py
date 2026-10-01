"""Agent-facing client for Yggdrasil.

Two modes, one interface:

    # over HTTP (what a running agent should use)
    mem = Yggdrasil(base_url="http://127.0.0.1:8420")
    mem.remember("Mira prefers terse answers", content="...", domain="Preferences")
    hits = mem.recall("how should I talk to Mira?")
    mem.update(hits[0]["id"], {"importance": 0.95})
    mem.link(a_id, b_id, type="supports")
    mem.forget(mem_id)

    # in-process (tools/tests, no server needed)
    store = Store("data/yggdrasil.db", "data/yggdrasil.json")
    mem = store.remember("Mira prefers terse answers", domain="Preferences")

This client speaks HTTP only. For in-process use call `Store` directly -- it
has the same verbs (`remember`, `recall`, `link`, `merge`, `forget`) without a
server, and it is what the tests drive.

Every call is one line and every call is recorded in the agent's activity log,
which is what the UI renders on the right rail.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterable

DEFAULT_URL = os.environ.get("YGGDRASIL_URL", "http://127.0.0.1:8420")


class YggdrasilError(RuntimeError):
    pass


class Yggdrasil:
    def __init__(self, base_url: str | None = None, actor: str = "agent",
                 timeout: float = 8.0) -> None:
        self.base_url = (base_url or DEFAULT_URL).rstrip("/")
        self.actor = actor
        self.timeout = timeout

    # ------------------------------------------------------------------ transport
    def _request(self, method: str, path: str, payload: dict | None = None) -> Any:
        url = f"{self.base_url}{path}"
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = resp.read()
            return json.loads(body) if body else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            try:
                detail = json.loads(detail).get("error", detail)
            except json.JSONDecodeError:
                pass
            raise YggdrasilError(f"{method} {path} → {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise YggdrasilError(
                f"cannot reach Yggdrasil at {self.base_url} ({exc.reason}). "
                f"Start it with: python -m server.app"
            ) from exc

    # ------------------------------------------------------------------ agent API
    def remember(self, title: str, content: str = "", *, domain: str = "", parent_id: str | None = None,
                 kind: str = "fact", tags: Iterable[str] = (), importance: float = 0.5,
                 confidence: float = 0.7, source: str = "agent", link_to: Iterable[str] = ()) -> dict:
        """Store a new memory. Returns the created memory including its id."""
        return self._request("POST", "/api/remember", {
            "title": title, "content": content, "domain": domain, "parent_id": parent_id,
            "kind": kind, "tags": list(tags), "importance": importance,
            "confidence": confidence, "source": source, "link_to": list(link_to),
            "actor": self.actor,
        })

    def recall(self, query: str, limit: int = 8) -> list[dict]:
        """Retrieve the memories most relevant to a query, ranked."""
        return self._request("POST", "/api/recall",
                             {"query": query, "limit": limit, "actor": self.actor})["results"]

    def search(self, query: str, limit: int = 40) -> list[dict]:
        return self._request("GET", f"/api/search?q={urllib.parse.quote(query)}&limit={limit}")["results"]

    def update(self, memory_id: str, changes: dict) -> dict:
        return self._request("PATCH", f"/api/memories/{memory_id}", {**changes, "actor": self.actor})

    def forget(self, memory_id: str, hard: bool = False) -> dict:
        """Archive by default; `hard=True` deletes the leaf and its subtree."""
        qs = urllib.parse.urlencode({"hard": int(hard), "actor": self.actor})
        return self._request("DELETE", f"/api/memories/{memory_id}?{qs}")

    def link(self, memory_a: str, memory_b: str, type: str = "related", weight: float = 0.6,
             note: str = "") -> dict:
        return self._request("POST", "/api/link", {
            "a": memory_a, "b": memory_b, "type": type, "weight": weight,
            "note": note, "actor": self.actor,
        })

    def unlink(self, memory_a: str, memory_b: str) -> bool:
        qs = urllib.parse.urlencode({"a": memory_a, "b": memory_b})
        return self._request("DELETE", f"/api/link?{qs}")["unlinked"]

    def merge(self, memory_a: str, memory_b: str, title: str | None = None) -> dict:
        """Fold b into a, inheriting tags, links and the stronger importance."""
        return self._request("POST", "/api/merge",
                             {"a": memory_a, "b": memory_b, "title": title, "actor": self.actor})

    # ------------------------------------------------------------------ extras
    def context(self, memory_id: str, hops: int = 1) -> dict:
        """A memory plus its linked neighbourhood — what 'understand this' needs."""
        return self._request("GET", f"/api/memories/{memory_id}/context?hops={hops}")

    def state(self) -> dict:
        return self._request("GET", "/api/state")

    def activity(self, limit: int = 50) -> list[dict]:
        return self._request("GET", f"/api/activity?limit={limit}")["activity"]

    def branches(self) -> list[dict]:
        return self._request("GET", "/api/nodes")["nodes"]

    def branch(self, name: str, parent_id: str | None = None, summary: str = "") -> dict:
        return self._request("POST", "/api/nodes",
                             {"name": name, "parent_id": parent_id, "summary": summary})

    def export(self) -> dict:
        return self._request("GET", "/api/export")

    def note(self, detail: str, action: str = "note") -> None:
        """Push a narration into the UI activity rail without touching memory."""
        self._request("POST", "/api/broadcast", {"detail": detail, "action": action,
                                                 "actor": self.actor})

    def say(self, text: str, threshold: float = 1.2) -> str | None:
        """One-shot: recall for a question, return the best memory if it is a hit."""
        hits = self.recall(text, limit=6)
        top = hits[0] if hits else None
        if top and top["score"] > threshold:
            return f"{top['title']} — {top['content'][:400]}"
        return None

    def __repr__(self) -> str:
        return f"<Yggdrasil {self.base_url or 'in-process'}>"

"""Yggdrasil HTTP server.

Standard library only — `python3 -m server.app` is enough, no pip install,
no external service. Serves the web client and a small REST API that maps
one-to-one onto the operations an agent needs:

    remember(memory)              POST   /api/remember
    recall(query)                 POST   /api/recall
    update(memory_id, changes)    PATCH  /api/memories/{id}
    forget(memory_id)             DELETE /api/memories/{id}
    link(memory_a, memory_b)      POST   /api/link
    search(query)                 GET    /api/search?q=
    merge(a, b)                   POST   /api/merge

Plus tree management, an activity log, an SSE stream and JSON import/export.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import random
import re
import socket
import sys
import threading
import time
import traceback
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from . import seed as seed_mod
from .store import EventHub, Store

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, "web")
DATA_DIR = os.environ.get("YGGDRASIL_DATA", os.path.join(ROOT, "data"))
DB_PATH = os.path.join(DATA_DIR, "yggdrasil.db")
JSON_PATH = os.path.join(DATA_DIR, "yggdrasil.json")

store = Store(DB_PATH, JSON_PATH)
hub = EventHub(store)


# --------------------------------------------------------------------- simulator
class AmbientAgent:
    """Occasional agent chatter so a parked tab still feels alive.

    Deliberately conservative: it reads and recalls far more than it writes,
    because an agent's memory should mostly be *used*, not filled. Queries and
    targets rotate so the feed never shows the same memory twice in a row.
    """

    def __init__(self, store_: Store, interval: float = 10.0) -> None:
        self.store = store_
        self.interval = interval
        self.enabled = True
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._recent: deque[str] = deque(maxlen=8)
        self._queries: deque[str] = deque(maxlen=3)
        self._errors = 0

    def start(self) -> None:
        if self._thread:
            return
        self._thread = threading.Thread(target=self._loop, name="ygg-ambient", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _note_error(self) -> None:
        """Report a failed tick instead of swallowing it.

        The simulator must never kill the server, but a silent `pass` here
        hides real defects — a missing import in this module went unnoticed
        for exactly that reason. Print the first few tracebacks in full, then
        throttle so a persistent fault cannot flood the console.
        """
        self._errors += 1
        if self._errors > 3 and self._errors % 25:
            return
        try:
            sys.stderr.write(
                f"ambient agent: tick failed (error #{self._errors})\n{traceback.format_exc()}")
            sys.stderr.flush()
        except (OSError, UnicodeError):
            pass

    def _loop(self) -> None:
        rng = random.Random(7)
        queries = [
            "how do I avoid hallucinating output?", "what did I learn from Tideline?",
            "who is the operator and how do they like answers?", "what is blocked right now?",
            "why is the render path fragile?", "what do I know about wake word precision?",
            "which memories are most important?", "how should I handle destructive actions?",
            "what is the retrieval ranking?", "what should I do about branch explosion?",
        ]
        while not self._stop.wait(self.interval):
            if not self.enabled:
                continue
            try:
                memories = self.store.map_memories()
                if not memories:
                    continue

                def fresh(pool: list[dict]) -> dict | None:
                    """avoid surfacing the same memory twice in a row"""
                    options = [m for m in pool if m["id"] not in self._recent] or pool
                    pick = rng.choice(options)
                    self._recent.append(pick["id"])
                    return pick

                roll = rng.random()
                if roll < 0.62:
                    # half curated questions, half built from a memory it has
                    # not touched recently — keeps the feed from looking canned
                    if rng.random() < 0.5:
                        options = [q for q in queries if q not in self._queries] or queries
                        query = rng.choice(options)
                    else:
                        target = fresh(memories)
                        words = [w for w in re.findall(r"[A-Za-z]{5,}", (target or {}).get("title", ""))
                                 if w.lower() not in ("memory", "memories", "should", "about", "never")]
                        query = f"what do I know about {rng.choice(words)}?" if words else rng.choice(queries)
                    self._queries.append(query)
                    self.store.recall(query, limit=rng.randint(4, 8), actor="agent")
                elif roll < 0.86:
                    mem = fresh(memories)
                    if mem:
                        self.store.context(mem["id"], hops=1)
                elif roll < 0.95:
                    mem = fresh(memories)
                    if mem:
                        bump = min(1.0, mem["confidence"] + rng.uniform(0.01, 0.05))
                        self.store.update(mem["id"], {"confidence": round(bump, 3)},
                                          actor="agent", log=False)
                        self.store.log_activity("update", memory=self.store.memory(mem["id"]),
                                                detail=f"confidence recalibrated → {bump:.2f}",
                                                duration_ms=rng.randint(9, 40))
                else:
                    self.store.log_activity("retrieve", detail="ambient self-check → tree healthy",
                                            duration_ms=rng.randint(3, 12), actor="agent")
            except Exception:
                self._note_error()


ambient = AmbientAgent(store)


# --------------------------------------------------------------------- helpers
def _json_bytes(payload) -> bytes:
    return json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "Yggdrasil/2.0"
    protocol_version = "HTTP/1.1"

    # ---- plumbing
    def log_message(self, fmt: str, *args) -> None:  # quieter console
        if os.environ.get("YGGDRASIL_VERBOSE"):
            super().log_message(fmt, *args)

    def _send(self, code: int, body: bytes, ctype: str = "application/json; charset=utf-8",
              extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, payload, code: int = 200) -> None:
        self._send(code, _json_bytes(payload))

    def _error(self, code: int, message: str) -> None:
        self._json({"error": message, "status": code}, code)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON body: {exc}") from exc
        return data if isinstance(data, dict) else {"value": data}

    def _qs(self) -> dict:
        parsed = urlparse(self.path)
        return {k: v[0] for k, v in parse_qs(parsed.query).items()}

    def _static(self, path: str) -> None:
        rel = unquote(path.lstrip("/")) or "index.html"
        target = os.path.normpath(os.path.join(WEB_DIR, rel))
        if not target.startswith(WEB_DIR) or not os.path.isfile(target):
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(target, "rb") as fh:
            self._send(200, fh.read(), ctype)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            if path == "/api/state":
                return self._json(store.state())
            if path == "/api/stats":
                return self._json(store.stats())
            if path == "/api/search":
                qs = self._qs()
                return self._json({"results": store.search(
                    qs.get("q", ""), limit=int(qs.get("limit", 40)),
                    include_archived=qs.get("archived") == "1")})
            if path == "/api/activity":
                qs = self._qs()
                return self._json({"activity": store.recent_activity(int(qs.get("limit", 80)))})
            if path == "/api/export":
                return self._json(store.export())
            if path == "/api/stream":
                return self._stream()
            if path.startswith("/api/memories/"):
                rest = path[len("/api/memories/"):]
                if rest.endswith("/context"):
                    return self._json(store.context(rest[: -len("/context")],
                                                    hops=int(self._qs().get("hops", 1))))
                try:
                    return self._json(store.memory(rest))
                except KeyError:
                    return self._error(404, "no such memory")
            if path.startswith("/api/nodes/"):
                node = store.node(path[len("/api/nodes/"):])
                return self._json(node) if node else self._error(404, "no such node")
            if path == "/api/nodes":
                return self._json({"nodes": store.map_nodes()})
            if path == "/api/memories":
                return self._json({"memories": store.map_memories(
                    include_archived=self._qs().get("archived") == "1")})
            if path == "/api/health":
                return self._json({"ok": True, "memories": len(store.map_memories())})
            if path.startswith("/api/"):
                return self._error(404, f"unknown endpoint {path}")
            return self._static(path)
        except BrokenPipeError:
            return
        except Exception as exc:  # surface the failure instead of hanging the UI
            traceback.print_exc()
            return self._error(500, str(exc))

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        try:
            body = self._body()
            if path == "/api/remember":
                parent = body.get("parent_id") or self._resolve_parent(body)
                memory = store.remember(
                    title=body.get("title", ""),
                    content=body.get("content", ""),
                    parent_id=parent,
                    kind=body.get("kind", "fact"),
                    domain=body.get("domain", ""),
                    tags=body.get("tags") or [],
                    importance=float(body.get("importance", 0.5)),
                    confidence=float(body.get("confidence", 0.7)),
                    source=body.get("source", "operator"),
                    actor=body.get("actor", "operator"),
                    link_to=body.get("link_to") or [],
                )
                return self._json(memory, 201)
            if path == "/api/recall":
                return self._json({"results": store.recall(
                    body.get("query", ""), limit=int(body.get("limit", 8)),
                    actor=body.get("actor", "agent"))})
            if path == "/api/link":
                try:
                    return self._json(store.link(
                        body["a"], body["b"], type=body.get("type", "related"),
                        weight=float(body.get("weight", 0.6)), note=body.get("note", ""),
                        actor=body.get("actor", "operator")))
                except KeyError as exc:
                    return self._error(404, f"unknown memory {exc}")
                except ValueError as exc:
                    return self._error(400, str(exc))
            if path == "/api/merge":
                try:
                    return self._json(store.merge(body["a"], body["b"],
                                                 actor=body.get("actor", "operator"),
                                                 title=body.get("title")))
                except KeyError:
                    return self._error(404, "unknown memory")
            if path == "/api/nodes":
                return self._json(store.create_node(
                    body.get("parent_id") or store.kv_get("root_id"),
                    body.get("name", "new branch"), kind=body.get("kind", "branch"),
                    hue=body.get("hue"), summary=body.get("summary", "")), 201)
            if path == "/api/forget":
                try:
                    return self._json(store.forget(body["memory_id"],
                                                   hard=bool(body.get("hard")),
                                                   actor=body.get("actor", "operator")))
                except KeyError:
                    return self._error(404, "unknown memory")
            if path == "/api/seed":
                return self._json(seed_mod.seed(store, body.get("agent", "JARVIS"),
                                                force=bool(body.get("force"))))
            if path == "/api/import":
                return self._json(store.load_payload(body.get("payload") or body,
                                                    replace=bool(body.get("replace"))))
            if path == "/api/simulate":
                ambient.enabled = bool(body.get("enabled", True))
                ambient.interval = float(body.get("interval", ambient.interval))
                return self._json({"enabled": ambient.enabled, "interval": ambient.interval})
            if path == "/api/broadcast":
                # lets an external agent push a narration into the activity panel
                store.log_activity(body.get("action", "note"), detail=body.get("detail", ""),
                                   actor=body.get("actor", "agent"))
                return self._json({"ok": True})
            return self._error(404, f"unknown endpoint {path}")
        except BrokenPipeError:
            return
        except Exception as exc:
            traceback.print_exc()
            return self._error(500, str(exc))

    def do_PATCH(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        try:
            body = self._body()
            if path.startswith("/api/memories/"):
                try:
                    return self._json(store.update(path[len("/api/memories/"):], body,
                                                   actor=body.get("actor", "operator")))
                except KeyError:
                    return self._error(404, "no such memory")
            if path.startswith("/api/nodes/"):
                nid = path[len("/api/nodes/"):]
                node = store.update_node(nid, {k: v for k, v in body.items() if k != "actor"})
                return self._json(node) if node else self._error(404, "no such node")
            return self._error(404, f"unknown endpoint {path}")
        except BrokenPipeError:
            return
        except Exception as exc:
            traceback.print_exc()
            return self._error(500, str(exc))

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        try:
            if path.startswith("/api/memories/"):
                try:
                    return self._json(store.forget(path[len("/api/memories/"):],
                                                   hard=qs.get("hard") == "1",
                                                   actor=qs.get("actor", "operator")))
                except KeyError:
                    return self._error(404, "no such memory")
            if path == "/api/link":
                return self._json({"unlinked": store.unlink(self._qs().get("a", ""),
                                                             self._qs().get("b", ""))})
            return self._error(404, f"unknown endpoint {path}")
        except BrokenPipeError:
            return
        except Exception as exc:
            traceback.print_exc()
            return self._error(500, str(exc))

    # ---- helpers bound to request lifetime
    def _resolve_parent(self, body: dict) -> str:
        """Accept a domain name, branch path or explicit node id when planting."""
        if body.get("domain"):
            found = store.q("SELECT id FROM nodes WHERE name=? AND kind='domain'", (body["domain"],))
            if found:
                return found[0]["id"]
        if body.get("path"):
            node_id = store.kv_get("root_id")
            for part in str(body["path"]).split("/"):
                found = store.q(
                    "SELECT id FROM nodes WHERE name=? AND parent_id=? ORDER BY depth LIMIT 1",
                    (part.strip(), node_id))
                if not found:
                    break
                node_id = found[0]["id"]
            return node_id
        # fall back to an "Inbox" branch so nothing is ever orphaned
        found = store.q("SELECT id FROM nodes WHERE name='Inbox' LIMIT 1")
        if found:
            return found[0]["id"]
        return store.create_node(store.kv_get("root_id"), "Inbox", kind="branch",
                                 summary="Memories that have not found their branch yet." )["id"]

    def _stream(self) -> None:
        """Server-sent events: memory mutations + agent activity, live."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        queue = hub.subscribe()
        try:
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            last_ping = time.time()
            while True:
                try:
                    event = queue.popleft()
                except IndexError:
                    if time.time() - last_ping > 15:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                        last_ping = time.time()
                    time.sleep(0.25)
                    continue
                self.wfile.write(b"data: " + _json_bytes(event) + b"\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            hub.unsubscribe(queue)


def _safe_stdio() -> None:
    """Windows consoles default to cp1252; don't let a glyph kill the server."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def serve(host: str = "127.0.0.1", port: int = 8420, seed_if_empty: bool = True,
          simulate: bool = True) -> ThreadingHTTPServer:
    if seed_if_empty:
        result = seed_mod.seed(store)
        if result.get("seeded"):
            print(f"  planted {result['memories']} sample memories "
                  f"({result['links']} links) - the tree starts alive")

    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("text/css", ".css")

    class Server(ThreadingHTTPServer):
        daemon_threads = True

        def handle_error(self, request, client_address):
            """A browser closing a tab mid-stream is normal, not an incident."""
            exc = sys.exc_info()[1]
            if isinstance(exc, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
                return
            super().handle_error(request, client_address)

    httpd = Server((host, port), Handler)
    if simulate:
        ambient.start()
    return httpd


def _free_port(host: str, port: int, tries: int = 12) -> int:
    """Find a port nothing is listening on.

    Deliberately no SO_REUSEADDR: on Windows it lets a second process bind a
    port that is already live, which looks like a working server and is not.
    """
    for offset in range(tries):
        candidate = port + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((host, candidate))
                return candidate
            except OSError:
                continue
    raise SystemExit(f"no free port in {port}..{port + tries}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Yggdrasil memory server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("YGGDRASIL_PORT", 8420)))
    parser.add_argument("--no-seed", action="store_true", help="start with an empty tree")
    parser.add_argument("--no-sim", action="store_true", help="disable ambient agent activity")
    parser.add_argument("--open", action="store_true", help="open the default browser")
    args = parser.parse_args()
    _safe_stdio()

    port = _free_port(args.host, args.port)
    httpd = serve(args.host, port, seed_if_empty=not args.no_seed, simulate=not args.no_sim)

    url = f"http://{args.host}:{port}/"
    print(f"\n  YGGDRASIL  ·  memory tree online")
    print(f"  {url}")
    print(f"  db     {DB_PATH}")
    print(f"  json   {JSON_PATH}")
    print(f"  api    {url}api/state   (remember · recall · update · forget · link · search)")
    print("  ctrl-c to stop\n")

    if args.open:
        import webbrowser

        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  tree sleeping.")
    finally:
        ambient.stop()
        httpd.server_close()
        store.close()


if __name__ == "__main__":
    main()

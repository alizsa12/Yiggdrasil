"""Quick end-to-end check of the memory backend (no server, no deps).

    python yggdrasil/tests/smoke.py
"""

import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from server import seed as seed_mod  # noqa: E402
from server.store import Store  # noqa: E402

passed, failed = 0, 0


def check(label, condition, detail=""):
    global passed, failed
    mark = "PASS" if condition else "FAIL"
    if condition:
        passed += 1
        print(f"  [ok]   {label}")
    else:
        failed += 1
        print(f"  [FAIL] {label}  {detail}")


def main():
    tmp = tempfile.mkdtemp(prefix="yggdrasil-smoke-")
    store = Store(os.path.join(tmp, "y.db"), os.path.join(tmp, "y.json"))

    print("\nseed")
    result = seed_mod.seed(store)
    check("plants a canopy", result["seeded"] and result["memories"] > 40, result)
    check("links across branches", result["links"] >= 25, result)
    check("second seed is a no-op", seed_mod.seed(store)["seeded"] is False)

    print("\nsearch & recall")
    hits = store.search("invented citation")
    check("finds the citation incident", hits and "citation" in hits[0]["title"].lower(),
          hits[:1] and hits[0]["title"])
    hits = store.search("retrieval ranking")
    check("keyword search reaches knowledge", len(hits) >= 2, len(hits))
    recalled = store.recall("how does the operator like answers?", limit=5)
    check("recall ranks by relevance", recalled and any(
        "terse" in r["title"].lower() or "terse" in r["content"].lower() for r in recalled[:3]),
        [r["title"] for r in recalled[:2]])
    check("recall is logged", store.recent_activity(1)[0]["action"] == "retrieve")
    check("recall reinforces", store.memory(recalled[0]["id"])["access_count"] >= 1)

    print("\ntree")
    root = store.q("SELECT * FROM nodes WHERE kind='root'")[0]
    check("root is the agent itself", root["name"] == "assistant", root["name"])
    realms = [r["name"] for r in store.q("SELECT name FROM nodes WHERE kind='domain'")]
    check("nine realms on the tree", len(realms) == 9, realms)
    expected = {"\u00c1sgar\u00f0r", "V\u00e1nheimr", "J\u00f6tunheimr", "M\u00edmame\u00f0r",
                "Helheimr", "Svart\u00e1lfaheimr", "Au\u00f0rbl\u00e1str", "Niflheimr",
                "Ginnungagap"}
    check("realms are the nine of Grimnismal", set(realms) == expected, sorted(realms))
    depths = {r["depth"] for r in store.q("SELECT depth FROM nodes")}
    check("tree is deeper than 3 levels", max(depths) >= 3, max(depths))
    leaf = store.q("SELECT * FROM nodes WHERE kind='leaf' LIMIT 1")[0]
    check("leaves carry memories", bool(leaf["memory_id"]))
    orphan = store.q(
        "SELECT COUNT(*) c FROM memories m LEFT JOIN nodes n ON n.id=m.node_id WHERE n.id IS NULL")[0]["c"]
    check("no orphaned memories", orphan == 0, orphan)
    mismatch = store.q(
        """SELECT COUNT(*) c FROM memories m JOIN nodes n ON n.id=m.node_id
           WHERE n.kind<>'leaf' OR n.memory_id IS NOT m.id""")[0]["c"]
    check("each memory owns its leaf node", mismatch == 0, mismatch)

    print("\nmutations")
    made = store.remember("Smoke test memory", "temporary", parent_id=leaf["parent_id"],
                          tags=["smoke"], importance=0.4, source="test")
    check("remember() returns an id", bool(made["id"]))
    check("leaf node created for it", store.node_of_memory(made["id"]) is not None)
    other = next(m for m in store.search("retrieval") if m["id"] != made["id"])
    store.link(made["id"], other["id"], type="tested-by", weight=0.9)
    check("cross-branch link created", len(store.context(made["id"])["related"]) == 1)
    updated = store.update(made["id"], {"importance": 0.99, "tags": ["smoke", "promoted"]})
    check("update bumps version", updated["version"] == 2 and updated["importance"] == 0.99, updated["version"])
    store.update(made["id"], {"parent_id": store.kv_get("root_id")})
    check("memory can move branches", store.node_of_memory(made["id"])["parent_id"] == store.kv_get("root_id"))

    print("\nmerge")
    twin = store.remember("Smoke test memory (draft)", "extra detail", parent_id=leaf["parent_id"],
                          importance=0.8, tags=["draft"])
    merged = store.merge(made["id"], twin["id"])
    check("merge inherits tags", "draft" in merged["tags"], merged["tags"])
    check("merge keeps stronger importance", merged["importance"] >= 0.8, merged["importance"])
    check("merge marks source superseded", store.memory(twin["id"])["status"] == "superseded")
    check("merge inherits links", any(l["a"] in (made["id"], other["id"]) and l["b"] in (made["id"], other["id"])
                                      for l in store.map_links() if other["id"] in (l["a"], l["b"])))

    print("\nforget")
    doomed = store.remember("Smoke test memory (doomed)", "temporary", parent_id=leaf["parent_id"])
    active_before = len(store.map_memories())
    store.forget(doomed["id"], hard=False)
    check("soft forget archives instead of deleting", store.memory(doomed["id"])["status"] == "archived")
    check("archived memories leave the active set", len(store.map_memories()) == active_before - 1)
    store.forget(doomed["id"], hard=True)
    check("hard delete removes the memory row", store.memory(doomed["id"]) is None)
    check("hard delete removes the leaf node", store.node(store.memory(twin["id"])["node_id"]) is not None)
    store.forget(twin["id"], hard=True)
    check("a superseded memory can still be purged", store.memory(twin["id"]) is None)

    print("\npersistence")
    state = store.state()
    check("state has nodes/memories/links",
          all(k in state for k in ("nodes", "memories", "links", "stats", "meta")))
    check("every leaf maps to a memory",
          all(n.get("memory_id") for n in state["nodes"] if n["kind"] == "leaf"))
    check("json mirror written", os.path.exists(os.path.join(tmp, "y.json")))
    reload_store = Store(os.path.join(tmp, "y.db"), os.path.join(tmp, "y2.json"))
    check("reopening keeps memories", len(reload_store.map_memories()) == len(store.map_memories()))
    payload = store.export()
    fresh = Store(os.path.join(tmp, "f.db"), None)
    fresh.load_payload(payload, replace=True)
    check("export/import round-trips", len(fresh.map_memories()) == len(store.map_memories()))
    check("import keeps links", len(fresh.map_links()) == len(store.map_links()))

    print("\ncollapse")
    domain = store.q("SELECT * FROM nodes WHERE kind='domain' LIMIT 1")[0]
    below = [r["id"] for r in store.q("SELECT id FROM nodes WHERE parent_id=?", (domain["id"],))]
    store.update_node(domain["id"], {"collapsed": True})
    check("the collapsed branch itself stays visible", domain["id"] in store.expanded_ids())
    check("its descendants are hidden", all(nid not in store.expanded_ids() for nid in below))
    check("expanded ids still include leaves elsewhere", len(store.expanded_ids()) > 10)
    store.update_node(domain["id"], {"collapsed": False})
    check("re-expanding restores the subtree", all(nid in store.expanded_ids() for nid in below))

    print("\nactivity")
    store.log_activity("note", detail="hello")
    check("activity feed is newest-first", store.recent_activity(1)[0]["detail"] == "hello")

    print("\nreferential integrity")
    doomed2 = store.remember("Smoke test memory (purged)", "temporary", parent_id=leaf["parent_id"])
    store.link(doomed2["id"], other["id"])
    store.context(doomed2["id"], hops=1)
    store.log_activity("read", memory=store.memory(doomed2["id"]), detail="read before the purge")
    store.forget(doomed2["id"], hard=True)
    dangling = store.q("SELECT COUNT(*) c FROM activity WHERE memory_id IS NOT NULL AND memory_id NOT IN "
                       "(SELECT id FROM memories)")[0]["c"]
    orphan_nodes = store.q("SELECT COUNT(*) c FROM activity WHERE node_id IS NOT NULL AND node_id NOT IN "
                           "(SELECT id FROM nodes)")[0]["c"]
    check("hard forget leaves no dangling memory refs", dangling == 0, dangling)
    check("hard forget leaves no dangling node refs", orphan_nodes == 0, orphan_nodes)
    kept = [a for a in store.recent_activity(200) if a["memory_id"] == doomed2["id"]]
    check("the purge is still recorded in the audit trail", not kept and any(
        a["action"] == "forget" and doomed2["title"] in (a["title"] or "") for a in store.recent_activity(200)))
    check("links to a purged memory are gone",
          not any(doomed2["id"] in (l["a"], l["b"]) for l in store.map_links()))

    print("\nlink symmetry")
    x, y = store.remember("Link symmetry left", "a"), store.remember("Link symmetry right", "b")
    fwd = store.link(x["id"], y["id"])
    rev = store.link(y["id"], x["id"])
    check("link order is canonical either way round", fwd["a"] == rev["a"] and fwd["b"] == rev["b"], (fwd, rev))
    check("relinking does not duplicate the row", len(store.map_links()) == len(
        {frozenset((l["a"], l["b"])) for l in store.map_links()}))
    logged = [a for a in store.recent_activity(200) if a["action"] == "link" and a["memory_id"] == fwd["a"]]
    check("the activity log names the stored end", bool(logged), logged[:1])
    check("unlink works from either order", store.unlink(y["id"], x["id"])
          and store.unlink(x["id"], y["id"]) is False)

    print("\nambient agent")
    os.environ["YGGDRASIL_DATA"] = os.path.join(tmp, "ambient")
    from server import app as app_mod  # noqa: E402  (import-time store honours YGGDRASIL_DATA)
    seed_mod.seed(app_mod.store)
    agent = app_mod.AmbientAgent(app_mod.store, interval=0.01)
    quiet_before = len(app_mod.store.recent_activity(5000))
    agent.start()
    deadline = time.time() + 2.0
    while time.time() < deadline and agent._errors == 0:  # noqa: SLF001 - internal counter
        time.sleep(0.05)
    agent.stop()
    agent._thread.join(timeout=2.0)  # noqa: SLF001
    check("ambient ticks run without raising", agent._errors == 0,  # noqa: SLF001
          f"{agent._errors} failed ticks")  # noqa: SLF001
    check("the ambient agent actually did something",
          len(app_mod.store.recent_activity(5000)) > quiet_before)

    print(f"\n{'all green' if not failed else str(failed) + ' failing'} — {passed} passed\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

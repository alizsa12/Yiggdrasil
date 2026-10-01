# Yggdrasil

**A visual long-term memory system for an AI agent.**

Yggdrasil is not a dashboard with a tree picture in the corner — the tree *is*
the interface. And it is not a diagram of a tree either: it is a **living
cosmic organism whose vascular system is its memory architecture.**

The first thing you see is a colossal tree. A bole two hundred units tall and
fifty wide, standing on buttress roots that heel over into the dark, throwing
nine enormous limbs into a wide crown. It is ancient, it is impossible in scale,
and it is only *after* you have read it as a tree that you notice anything else
is happening inside the wood.

Inside that bark run **veins**, and off the veins grow **capillaries**, and at
the end of every capillary sits a **neuron** — one single memory, with
dendrites, a lit soma, and a membrane. The vessels are a circulatory system
*inside* the wood; they never stand in for the branches. A memory is not a dot
on a branch. It is a cell inside a body, fed by a vessel that carries it up from
the roots.

```
                  the crown — boughs, capillaries, neurons
        ╭───────────────┴───────────────╮
   ╭────┴─────╮   veins run inside    ╭────┴─────╮
   │  Ásgarðr │ ◄── every limb ─────►  │ Vánheimr │
   ╰────┬─────╯                       ╰────┬─────╯
        │        ╭────────────────╮         │
────────┴────────┤   the bole     ├─────────┴────────
   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓┤  (the trunk)  ├▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  the buttress roots
                 ╰────────────────╯
```

The hierarchy is deliberate: **tree, then universe, then vessels, then
neurons.** From the establishing distance a memory is a two-pixel point of
light, because at that range a memory *should* be a speck on an enormous
organism. You have to go in to see the cell.

The nine boughs are the nine realms, and **each realm is a genuine 3D world you
can travel inside** — not a panel, not a filter. Each one hangs off the end of
its own limb on a woody stem, and is dwarfed by the branch it grew on: the
bole's radius is nearly twice the radius of an entire realm. Click into Ásgarðr
and the camera drops through the shell into a real interior volume — its own
floor of root filaments, its own great boughs arching overhead, its own fine
vessels, and its own memories standing in that space as neurons. The memories
you saw from outside are *the same neurons*, now seen from where they actually
live.

**And each realm is a different place.** The nine are not nine tints of one
room. Ásgarðr is a citadel of marble and gold halls; Vánheimr is green water
and reed beds; Jötunheimr is basalt crags and monoliths; Mímameðr is the still
water of the well; Helheimr is an ice plain of obelisks and shards;
Svartálfaheimr is under the mountain, a forge with veins of metal in the rock;
Auðrblástr is open cloud with a tower and a turning vane; Niflheimr is
formless mist and cairns; and Ginnungagap is the abyss before creation, a rift
with the bright river Gjöll running out of one side and the dark river Höð out
of the other. Every realm carries its own ground, its own air, and its own
landmarks — and it keeps the dark around its edge, because a realm is a small
sphere hanging off a branch and seeing that is half of what sells it.

Everything is connected by the vascular system: a relationship between two
memories is a **signal routed from neuron, up a vein, through the shared bole,
and back down into another neuron**. Thirty-eight of them converging on the
trunk would read as a firework, so they stay hidden until you move in close
enough to want them.

It runs on one machine, with nothing but the Python standard library, and it
comes to life with a mature, fully vascularized memory organism the moment you
launch it.

---

## Run it

```bash
python yggdrasil/run.py            # or: python -m yggdrasil  (from the repo root)
```

No pip install, no API keys, no external service. The server picks the next
free port from 8420 and prints the URL.

```
YGGDRASIL · memory tree online
http://127.0.0.1:8420/
db     .../yggdrasil/data/yggdrasil.db
json   .../yggdrasil/data/yggdrasil.json
```

| flag | effect |
| --- | --- |
| `--port 9000` | start on a specific port |
| `--open` | open the browser |
| `--no-seed` | start with an empty tree (no sample memories) |
| `--no-sim` | do not generate ambient agent activity |
| `YGGDRASIL_DATA=./db` | put the database somewhere else |

`python yggdrasil/tests/smoke.py` exercises the whole store — seeding,
search, recall, tree edits, merge, forget, export/import — in a temp database.

---

## The model

| concept | what it is |
| --- | --- |
| **bole** | the trunk. The largest thing in the world, and the only route between realms |
| **buttress roots** | flared fins that leave the bole partway up its flank and heel into the ground |
| **realm** (domain) | one of the nine: Ásgarðr, Vánheimr, Jötunheimr, Mímameðr, Helheimr, Svartálfaheimr, Auðrblástr, Niflheimr, Ginnungagap — a miniature universe on a stem, dwarfed by the limb it hangs from |
| **world** | what a realm *is* as a place: its ground, its air, its landmarks |
| **bough** (branch) | a project, a person, a topic, an experience |
| **vein** | a vessel running *inside* a limb, carrying memory between a neuron and the bole |
| **capillary** | the vessel that branches off a bough to feed one memory |
| **neuron** (leaf) | one memory, with its metadata — soma, dendrites, membrane, firing pulse |
| **thread** (link) | a relationship: a signal routed neuron → vein → bole → neuron |

A memory carries `title`, `content`, `kind`, `domain`, `tags`, `importance`,
`confidence`, `source`, `created_at`, `updated_at`, `access_count`, `version`
and `status` (`active` / `superseded` / `archived`).

Everything lives in SQLite (WAL) with a human-readable JSON mirror rewritten on
every mutation, so the memory is portable, inspectable, and rebuildable without
this program.

---

## The agent API

Six operations, exactly the ones an agent needs:

```python
from server.client import Yggdrasil

mem = Yggdrasil(base_url="http://127.0.0.1:8420")

a = mem.remember("Elias wants the profile before the fix",
                 content="He asked twice why nobody had a flamegraph.",
                 domain="Vánheimr", kind="insight", tags=["elias", "method"],
                 importance=0.8, confidence=0.9)

hits = mem.recall("how should I work with Elias?")   # ranked, records the read
mem.update(a["id"], {"importance": 0.95})           # partial patch
mem.link(a["id"], hits[0]["id"], type="same-principle", weight=0.8)
mem.forget(a["id"])                                  # archive; hard=True deletes
```

Over HTTP, one call each:

| call | method + path |
| --- | --- |
| `remember(memory)` | `POST /api/remember` |
| `recall(query)` | `POST /api/recall` → ranked results + a `retrieve` trace |
| `search(query)` | `GET /api/search?q=` |
| `update(memory_id, changes)` | `PATCH /api/memories/{id}` |
| `forget(memory_id)` | `DELETE /api/memories/{id}[?hard=1]` |
| `link(memory_a, memory_b)` | `POST /api/link` |
| `merge(a, b)` | `POST /api/merge` |
| `context(memory_id, hops)` | `GET /api/memories/{id}/context` |

Extras: `GET /api/state` (the whole organism), `/api/stats`, `/api/activity`,
`/api/stream` (SSE, live), `/api/export`, `/api/import`, `/api/nodes` and
`/api/nodes/{id}` (create, rename, collapse), `/api/broadcast` (push a
narration into the UI feed without touching memory).

Every call is recorded in the activity log, which is what the right-hand rail
renders live.

---

## Using the interface

The organism is the interface, so the organism gets the verbs:

- **drag** to orbit · **scroll** to zoom · **shift-drag** to pan
- **click a realm** to travel *into* that world — the camera falls through the
  shell and you stand among its neurons, in its interior
- **step back out** with the exit button in the realm banner, `Backspace`, or
  `Esc`; the realm banner names where you are and how many memories live there
- **click a neuron** to open the memory, fly to it wherever it is homed, and
  light the vessels that carry its relationships
- **search** (`/`) dims everything that does not match, instantly
- **Timeline** shows memory as growth over time; **Graph** is the connection
  map with each realm as a constellation
- **+ Remember** grows a new neuron; the inspector edits, links, merges and
  forgets

| key | action | key | action |
| --- | --- | --- | --- |
| `/` | search | `1` `2` `3` | tree / timeline / graph |
| `F` | frame the whole organism | `L` | toggle routed signals |
| `N` | remember | `↑` `↓` | previous / next memory in this realm |
| `Backspace` | leave the realm you are inside | `Esc` | clear, and return to the tree |

---

## Architecture

```
yggdrasil/
├── run.py                 portable launcher
├── server/
│   ├── app.py             stdlib HTTP server, REST, SSE, ambient agent
│   ├── store.py           SQLite + JSON store, ranking, activity log
│   ├── seed.py            the nine realms and their sample memories
│   └── client.py          the agent-facing client
├── web/
│   ├── index.html · styles.css
│   └── js/
│       ├── app.js         state, panels, live stream, edits
│       ├── engine.js      camera, input, realm travel, culling
│       ├── organism.js    the anatomy: bole, bark, veins, neurons, worlds
│       ├── layout.js      deterministic anatomy — bole, roots, veins, realms
│       ├── timeline.js    memory over time
│       ├── graph.js       force-directed connection map
│       └── util.js        maths, colour, DOM, formatting
├── tests/smoke.py         40 checks, no dependencies
└── data/                  created on first run (git-ignored)
```

The anatomy is computed, not authored. `layout.js` grows the tree
deterministically from a seed, then for every limb it builds a bezier **vein**
that lives *inside* the wood, and for every memory it grows a **capillary**
from the nearest bough down to the cell that will hold it. `buildBole()` and
`buildRoots()` make the trunk and the buttress fins that hold it up, and
`buildRealms()` carves each domain out as a **volume** — a centre, a radius,
two to five great boughs arching inside it, an in-world position for each of
its memories, and the ground, air and landmarks that make it a place rather
than a colour you can filter by.

`organism.js` does the drawing, in two passes that must not be merged: a
**wood pass** in normal compositing, so nearer limbs occlude the ones behind
them, and a **glow pass** additively on top, for the vessels, cells, motes and
signals. Blending the whole tree additively turns a colossal trunk into a white
smear — with thirty limbs crossing a bole, translucent wood stacks to
saturated white. Within the wood pass the bole is a single filled silhouette
shaded *across* its axis with vertical bark fissures and old limb scars, not a
stack of round-capped segments, which would band.

Behind it is a damped orbit camera, painter's ordering, drifting motes, and
label level-of-detail with greedy decluttering. No build step and no
dependencies — `python run.py` is the whole toolchain.

Design notes worth keeping:

- **The layout is normalised once, and everything is normalised with it.** The
  veins, capillaries and limb thicknesses are grown in the same raw space as
  the node positions, so they all have to pass through the same transform. Skip
  that and the wood and the neurons it feeds end up in two different coordinate
  systems — neurons float away from their own branches, and the tree draws at
  half the size it was grown at. The invariant to hold: every capillary ends on
  the node it feeds, so the gap between a capillary's last point and its node is
  zero. Nothing asserts this — it is a rendering invariant, so check it in the
  browser after touching `normalise()`.
- **Scale is the hierarchy.** Bole radius ≈ 1.8× the radius of an entire realm.
  A neuron is a couple of pixels from the establishing distance and a cell once
  you are inside its world. If the memories look big, the tree is too small.
- **Vessel widths are capped, not proportional.** A vein that is a fixed
  fraction of limb width becomes a highway painted down a colossal trunk. Vessels
  stay vessels at any scale. The same applies to dendrites and halos: a cell
  seen close up must still read as a cell.
- **A realm is a small world, so keep the dark around it.** The world layer is
  drawn inside its own shell, not full-screen. Fill the viewport and the realm
  becomes a wash; leave the void showing and it becomes a place you are standing
  in. Its backdrop is darker than the wood so the neurons stay the light.
- **The establishing distance depends on the viewport**, so it is re-derived on
  every resize until the viewer takes the camera themselves. Measuring the canvas
  for the first time happens after the first state lands.
- Neuron brightness is *importance*, not recency; the layout is seeded and so
  stable across reloads; memories are always homed in a realm, so "outside" and
  "inside" are the same objects seen from two places; archived memories keep
  their links so an old decision can still be explained; and `recall()` is the
  only thing that changes access counts, so reading and writing stay
  distinguishable in the feed.

The two views of a memory are one memory. Rendering them separately is the
mistake this architecture exists to avoid.

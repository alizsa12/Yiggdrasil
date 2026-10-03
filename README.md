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
room, and they are not one template in nine colours. Each one is grown as a
hierarchy:

```
world → regions → landmarks → local environment → detail
```

Ásgarðr is a citadel whose marble terraces step *down* from a high hall to a
wide outer ward, gilded, with a colonnade and banners between them.
Vánheimr is a sea with land in it — a central island, six islets, reed beds and
willow. Jötunheimr is a basalt plain torn open by three rifts, mesas standing
where they always stood. Mímameðr is the well: the terraces climb *away* from
the centre, and the centre is a hole you can see down. Helheimr is a near-level
ice plain whose only landmarks are the obelisk and the moraine.
Svartálfaheimr is the same broken country as the giants but **roofed**, and its
rifts run with metal. Auðrblástr has no ground at all — only cloud shelves
hanging in air. Niflheimr is the flattest place in the tree and the most
cairns. Ginnungagap is the abyss: one wound of stone and fragments that never
fell.

Every realm also carries its own light, its own weather, and its own weather
*behaviour*: frost falls in Helheimr, embers climb out of the rock in
Jötunheimr, pollen hangs in Vánheimr, and Ginnungagap is the only place with
stars in it. A realm keeps the dark around its edge, because a realm is a small
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
`node yggdrasil/tests/smoke-agent.mjs` exercises the agent subsystem — 164
checks, no dependencies and no server.

---

## Agents in the world

Yggdrasil is not only a way to look at memories. An agent can be *in* it: a
body standing on the ground of a realm, with a finite perception range, that has
to walk to a memory before it can read it.

The point is the relationship between where a memory is and what an agent can
know about it. Walk up to one and it enters perception; walk away and it leaves,
with nothing else changed. There is no database query underneath standing in for
that — the agent genuinely cannot see it any more.

### What an agent is

An **agent** has a unique id, a realm, a 3D position, an orientation, a movement
state, a perception range, and a working memory of what it has personally
encountered (`known`, `history`, `received`). It holds no memory content: the
ids it knows are ids *in Yggdrasil*, and the text behind them stays in the store.

### The memory system is still the source of truth

There is exactly one database — the SQLite store behind `/api`. Interacting with
a memory calls that store (`memory.js` is the only module that knows how);
`remember` writes a real memory that appears in the UI, the graph and the
activity feed like any other, and `recall` is a real retrieval query. The 3D
world is an **interface into** the memory graph, not a copy of it.

### Perception is local

An agent sees memories, landmarks and other agents within its perception range
in its own realm — nothing else. Not the whole realm, and never another realm,
however close it looks on screen. Sight is measured as a *volume*: a horizontal
reach across the ground and a vertical reach tall enough to take in the boughs
above, because memories are grown into wood that arches over the country.

A perceived memory carries its id, title, kind, distance and bearing — enough for
a model to choose. The *content* only comes when the agent spends an `inspect`
action on it, and `inspect` refuses a memory that is not currently in sight:
*"that memory is out of sight — walk to it first."*

### Movement never teleports

Every move is a series of steps, each shorter than the step budget, each checked
against the terrain: an agent cannot step onto void, into deep water, or up a
cliff it cannot climb. A refused step ends the walk and the agent is told why.
The one declared traversal is `transit`, which walks an agent along the conduit
from one realm to another — sampled the same short-step way, and flagged
`traversal: true` so it can never be confused with a jump.

### The action vocabulary

| action | what it does |
| --- | --- |
| `look` | turn on the spot and take in what is there |
| `move` | walk to a point or a named place |
| `approach` | walk toward something until it is close, by the roads if it is a landmark |
| `inspect` | read a memory **that is in sight** |
| `interact` | read or edit a memory in reach, or talk to a nearby agent |
| `remember` | write a new memory into the shared tree |
| `recall` | search the shared memory graph |
| `link` | tie two memories the agent has actually encountered |

Every action returns the same structured observation: what it did, where the
agent now is, and what **entered and left perception** — the part a model reads
to learn *"I got closer, so now I can read it."*

### Reasoning is the model's, not a script

There is no default path and no fallback policy. A reasoning model is handed a
live packet — current location, visible objects, nearby memories, available
actions, recent observations, and retrieved memories — and returns
`{"thought", "action", "args"}`. That is the whole decision loop. If no model is
attached the agent does nothing; if a model always walks west, it walks west.

Any OpenAI-compatible chat endpoint works (a hosted model, or a local one):

```js
ygg.agents.model({
  endpoint: 'http://localhost:11434/v1/chat/completions',
  model: 'qwen2.5',
  apiKey: '',            // omit for a local server
  temperature: 0.7,
});
```

### Running a simple agent

With the app open, from the browser console:

```js
// put a body in the realm you are looking at, and open the debug view
const a = ygg.agents.spawn({ name: 'wanderer' });
ygg.agents.debug(true);        // position, realm, perception, action, memory ids

// attach a reasoning model, then take one step per call
ygg.agents.model({ endpoint: 'http://localhost:11434/v1/chat/completions', model: 'qwen2.5' });
await ygg.agents.step(5);      // perceive -> model -> act, five times

ygg.agents.start(1200);        // …or let it walk on its own
ygg.agents.focus(a.id);        // fly the camera to it
ygg.agents.stop();
```

Multiple agents can coexist: they perceive each other, can `approach` and
`interact` to exchange what they know, and writes to the shared tree are gated
by per-agent permissions (`allowRemember`, `allowLink`, `allowRecall`).

---

## The model

| concept | what it is |
| --- | --- |
| **bole** | the trunk. The largest thing in the world, and the only route between realms |
| **buttress roots** | flared fins that leave the bole partway up its flank and heel into the ground |
| **realm** (domain) | one of the nine: Ásgarðr, Vánheimr, Jötunheimr, Mímameðr, Helheimr, Svartálfaheimr, Auðrblástr, Niflheimr, Ginnungagap — a miniature universe on a stem, dwarfed by the limb it hangs from |
| **world** | what a realm *is* as a place: its landform, its regions, its landmarks, its roads, its weather |
| **region** | a named sub-country of a realm — a terrace, a mesa, an islet, a shelf — with its own ground height and its own detail |
| **landmark** | a destination. One per realm is larger than the rest and is the place it is named for; every region has somewhere to walk to |
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
│       ├── agent-control.js  the app-side agent world + debug view
│       ├── engine.js      camera, input, realm travel, culling
│       ├── organism.js    the anatomy: bole, bark, veins, neurons, worlds
│       ├── layout.js      deterministic anatomy — bole, roots, veins, realms
│       ├── world.js       the places: nine realms grown as real geography
│       ├── agent/         agents that live in those places
│       │   ├── world.js       world state: coordinates, memory objects, ground
│       │   ├── movement.js    stepping, terrain collision, realm transit
│       │   ├── perception.js  what is visible from where an agent stands
│       │   ├── actions.js     move / look / inspect / approach / interact / …
│       │   ├── memory.js      the one bridge to the /api store
│       │   ├── reasoning.js   the observation packet + the model adapter
│       │   └── agent.js       the agent entity and the world of agents
│       ├── timeline.js    memory over time
│       ├── graph.js       force-directed connection map
│       └── util.js        maths, colour, DOM, formatting
├── tests/
│   ├── smoke.py           80 checks on the store, no dependencies
│   └── smoke-agent.mjs    164 checks on the agent subsystem, no dependencies
└── data/                  created on first run (git-ignored)
```

The anatomy is computed, not authored. `layout.js` grows the tree
deterministically from a seed, then for every limb it builds a bezier **vein**
that lives *inside* the wood, and for every memory it grows a **capillary**
from the nearest bough down to the cell that will hold it. `buildBole()` and
`buildRoots()` make the trunk and the buttress fins that hold it up, and
`buildRealms()` carves each domain out as a **volume** — a centre, a radius,
two to five great boughs arching inside it, an in-world position for each of
its memories, and the world that makes it a place rather than a colour you can
filter by.

**The places themselves live in `world.js`.** A realm's world is a hierarchy,
not a list: a **landform recipe** (terraces, a well, an archipelago, a broken
plain, a near-level plain, floating shelves, or an abyss) grows **regions**;
landmarks are placed on the highest, most central ground and then distributed
across the other regions; **routes** join them into a graph, following the
ground but bridging any gap or rift they cross; and **instanced detail** —
reeds, shards, colonnade stones, cairns — is generated lazily per region. Each
realm's own `terrain`, `palette`, `sun`, `architecture`, `layers` and `scatter`
decide what all of that looks like, so changing one realm's entry changes that
realm and leaves the other eight alone.

The terrain is a **heightfield queried as a function** (`groundAt`, `heightAt`),
not a mesh. `null` is a real answer: it is what makes Ginnungagap a void and
Auðrblástr a set of islands in air, and it is why the renderer leaves the dark
showing through instead of painting a floor that should not be there.

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
- **A realm has to be framed on its land, not on its middle.** The floor sits
  below the volume's centre, so a level camera puts the country off the bottom
  of the frame, and a ground plane seen edge-on collapses into a thin band
  however wide the lens is. `enterRealm` therefore looks *down* at the land. If
  a realm ever renders as "a lot of wood and no country", this is why.
- **Anything sized by `focal / z` needs a cap.** Proportional sizing is right
  until an object passes near the camera, at which point one mote, star, road
  or limb becomes a hundred-pixel bloom and the realm fills with fog. Motes,
  stars, atmosphere motes, road widths and limb widths are all clamped, for
  this reason. `drawLimb` additionally takes an optional `refZ`: it defaults to
  the first point on the path, which is right for a limb growing outward from
  the trunk but wrong for the realm's entry conduit, whose *first* point is the
  far tip and can be right beside the eye.
- **Detail must not out-scale a destination.** A landmark is a place you go to;
  a scatter instance is scenery standing next to it. If the two are the same
  size the world stops having a hierarchy, and the small stuff becomes the
  subject. Scatter heights are fractions of the realm radius an order of
  magnitude below landmark heights.
- **Roads bridge, they do not fall.** A route's height is the *maximum* of the
  terrain and the straight line between its two destinations, so a path spans a
  gap in a floating shelf and bridges a carved rift instead of diving into it.
- **Detail is generated when you arrive, not before.** `instances(world, tier)`
  returns nothing until the realm is at the fine tier, then caches per tier. The
  cost of a realm's small objects is not paid for realms you are not standing in.
- **The nine realms are not one template.** They are asserted to differ: their
  terrain fingerprints must not match, every landmark must be a real finite size
  standing on real ground of the region it claims, and every route must stay
  inside its realm. These are checked by running the generator under node; the
  smoke suite is backend-only.
- **An agent's perception has to account for the boughs.** Memories are grown
  *into* the wood that arches above a realm, not into its ground, so the nearest
  memories to an agent standing under a bough are often directly overhead —
  ten units up and a step to the side. Measuring sight as a plain 3D distance
  makes those the *invisible* ones, so an agent has to walk away from a bough to
  see into it. Sight is therefore a volume: horizontal reach across the ground
  plus a vertical reach tall enough to take in the canopy. The realm boundary
  still cuts absolutely, so nothing in another realm is ever visible.
- **Perceived ≠ readable.** Perception hands out an id, a title and a distance;
  content arrives only through an `inspect` that checks the memory is in sight.
  Keep those two apart or the spatial constraint becomes decorative — the agent
  can see everything it could read, and the walk means nothing.
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

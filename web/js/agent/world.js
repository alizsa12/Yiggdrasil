// Yggdrasil · agent world state
//
// What an agent knows about the shape of the world, as distinct from where it
// is standing and what it can see. This module owns three things:
//
//   1. Coordinate transforms. world.js works in *realm-local* space — x and z
//      span the realm's radius, y is height off the realm's floor — because
//      that keeps a realm's proportions independent of where it hangs off the
//      tree. The renderer and the memories' interior positions are in *global*
//      space. An agent that walks has to think in global space to be next to
//      the right memory, so the conversion lives here, once.
//   2. Memory objects. Every memory in the tree gets a world position, the one
//      the renderer already draws it at. This is not a copy of the memory: it
//      is `{memoryId, where}` and nothing else. The content stays in the store.
//   3. Ground queries, in global space, so movement can ask "is there floor
//      here" without knowing about realm-local coordinates at all.
//
// Nothing here knows what an agent is. That is agent.js's business.

import { groundAt, nearestLandmark, navRoute, walkable } from '../world.js';

export class WorldState {
  /**
   * @param {object} layout  computeLayout() output — realms, innerPos, byId
   * @param {object} state   the /api/state snapshot: memories, links
   */
  constructor(layout, state) {
    this.layout = layout || null;
    this.state = state || { memories: [], links: [] };
    this.realms = new Map();
    this.objects = new Map();     // memoryId -> memory object
    this._byNode = new Map();     // nodeId  -> memoryId
    this.rebuild();
  }

  /** re-derive everything from the layout and the current snapshot */
  rebuild() {
    const layout = this.layout;
    this.realms = new Map();
    this.objects = new Map();
    this._byNode = new Map();
    if (!layout) return;

    const realms = layout.realms?.realms || new Map();
    for (const realm of realms.values()) {
      if (!realm.world) continue;
      this.realms.set(realm.id, {
        id: realm.id,
        name: realm.name,
        hue: realm.hue,
        radius: realm.radius,
        center: realm.center,
        world: realm.world,
        // where this realm's floor sits in global space
        floorY: realm.center[1] - realm.world.floor,
        members: realm.members,
      });
    }

    // every memory becomes a thing in a place
    for (const memory of this.state.memories || []) {
      const nodeId = memory.node_id;
      if (!nodeId) continue;
      const realmId = layout.realms?.realmOfNode?.get(nodeId);
      if (!realmId) continue;
      const pos = layout.realms.realms.get(realmId)?.innerPos?.get(nodeId);
      if (!pos) continue;
      this._byNode.set(nodeId, memory.id);
      this.objects.set(memory.id, {
        memoryId: memory.id,
        nodeId,
        realmId,
        pos: [pos[0], pos[1], pos[2]],
        links: [],
      });
    }

    // link the objects to each other from the shared graph, so an agent can
    // walk from one memory to a related one without a database query
    for (const link of this.state.links || []) {
      const a = this.objects.get(link.a);
      const b = this.objects.get(link.b);
      if (!a || !b) continue;
      a.links.push({ memoryId: b.memoryId, type: link.type, weight: link.weight });
      b.links.push({ memoryId: a.memoryId, type: link.type, weight: link.weight });
    }
  }

  /** the realms an agent may be in, in a stable order */
  get realmIds() {
    return [...this.realms.keys()].sort();
  }

  realm(realmId) {
    return this.realms.get(realmId) || null;
  }

  /** the world object (world.js's structure) for a realm, for terrain queries */
  worldOf(realmId) {
    return this.realms.get(realmId)?.world || null;
  }

  memoryObject(memoryId) {
    return this.objects.get(memoryId) || null;
  }

  memoryIdForNode(nodeId) {
    return this._byNode.get(nodeId) || null;
  }

  /** every memory object standing in a realm */
  objectsIn(realmId) {
    const out = [];
    for (const obj of this.objects.values()) if (obj.realmId === realmId) out.push(obj);
    return out;
  }

  // ------------------------------------------------------------ coordinates

  /** global position -> realm-local [x, y, z] */
  toLocal(realmId, pos) {
    const r = this.realm(realmId);
    if (!r) return null;
    return [pos[0] - r.center[0], pos[1] - r.floorY, pos[2] - r.center[2]];
  }

  /** realm-local [x, y, z] -> global position */
  toGlobal(realmId, local) {
    const r = this.realm(realmId);
    if (!r) return null;
    return [r.center[0] + local[0], r.floorY + local[1], r.center[2] + local[2]];
  }

  /**
   * The floor under a global point, or null where there is none.
   * Returning null is the important part: it is what stops an agent walking
   * off the edge of Auðrblástr into open air.
   */
  groundAt(realmId, pos) {
    const world = this.worldOf(realmId);
    if (!world) return null;
    const local = this.toLocal(realmId, pos);
    if (!local) return null;
    const g = groundAt(world, local[0], local[2]);
    if (!g) return null;
    return {
      y: this.realm(realmId).floorY + g.y,
      region: g.region,
      water: !!g.region.water,
      local,
    };
  }

  /** global distance that ignores height, for "how far across the room" */
  groundDistance(a, b) {
    return Math.hypot(a[0] - b[0], a[2] - b[2]);
  }

  /** true three-dimensional distance, for "can I see that thing" */
  distance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  /**
   * A compass bearing from `from` toward `to`, in radians, measured in the
   * ground plane so it matches what an agent turning on the spot would expect.
   */
  bearing(from, to) {
    return Math.atan2(to[2] - from[2], to[0] - from[0]);
  }

  /** the landmark nearest a global point, which is the nearest *destination* */
  nearestLandmark(realmId, pos) {
    const world = this.worldOf(realmId);
    if (!world) return null;
    const local = this.toLocal(realmId, pos);
    if (!local) return null;
    return nearestLandmark(world, [local[0], local[1], local[2]]);
  }

  /** the chain of landmark ids connecting two landmarks, or null */
  route(realmId, fromLandmarkId, toLandmarkId) {
    const world = this.worldOf(realmId);
    if (!world) return null;
    return navRoute(world, fromLandmarkId, toLandmarkId);
  }

  /** the solid, dry ground of a realm, for spawning and for wander targets */
  walkableSpots(realmId) {
    const world = this.worldOf(realmId);
    if (!world) return [];
    return walkable(world).filter((w) => w.traversable);
  }

  /**
   * Somewhere an agent can stand. Landmarks are the right answer: each one was
   * placed on the ground of the region it belongs to, so a spawn beside a
   * landmark is a spawn in a place, not a spawn in the middle of a lake.
   */
  spawnPoint(realmId, index = 0) {
    const world = this.worldOf(realmId);
    if (!world) return null;
    const spots = world.landmarks.filter((lm) => {
      const g = groundAt(world, lm.x, lm.z);
      return g && !g.region.water;
    });
    const list = spots.length ? spots : world.landmarks;
    if (!list.length) return null;
    const lm = list[index % list.length];
    const r = this.realm(realmId);
    return {
      position: [r.center[0] + lm.x, r.floorY + lm.y, r.center[2] + lm.z],
      landmark: lm,
      local: [lm.x, lm.y, lm.z],
    };
  }

  /** the height of the void below a realm — an agent will not step into it */
  voidY(realmId) {
    const world = this.worldOf(realmId);
    const r = this.realm(realmId);
    if (!world || !r) return null;
    return r.floorY + world.voidY;
  }

  /**
   * Clamp a global point into the realm's disc, so no action can put an agent
   * outside its own world regardless of what it was asked for.
   */
  clampToRealm(realmId, pos) {
    const r = this.realm(realmId);
    if (!r) return pos;
    const local = this.toLocal(realmId, pos);
    const d = Math.hypot(local[0], local[2]);
    const limit = r.world.radius * 0.99;
    if (d > limit) {
      const k = limit / (d || 1);
      local[0] *= k;
      local[2] *= k;
    }
    return this.toGlobal(realmId, local);
  }
}
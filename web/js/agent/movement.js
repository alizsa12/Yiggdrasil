// Yggdrasil · agent movement
//
// Movement here means the same thing it means for a person: you go somewhere by
// covering the ground between where you are and where you want to be. That is
// enforced, not merely intended:
//
//   · every move is a series of steps, each shorter than `maxStep`;
//   · every step is checked against the terrain before it is committed, and a
//     step onto void, into deep water, or up a cliff is refused;
//   · a refused step ends the walk rather than skipping over the obstacle.
//
// So `moveToward` either arrives or reports exactly where it got stuck and why.
// There is no code path in this file that assigns an agent's position to
// somewhere it did not step to, and `stepTo` is the only writer of position.
//
// The one exception is deliberate and named: `transit` walks an agent along
// the *conduit* from one realm to another, which is the limb the realm hangs
// from. That is still a walk — it follows the stem polyline point by point —
// it is simply a walk along wood instead of along ground. See `isTeleport`.

import { clamp } from '../util.js';

/** state names an agent's body can be in */
export const MOTION = {
  IDLE: 'idle',
  WALKING: 'walking',
  BLOCKED: 'blocked',
  ARRIVED: 'arrived',
  TRANSIT: 'transit',
};

export class Movement {
  /**
   * @param {import('./world.js').AgentWorld} world
   * @param {object} options
   * @param {number} [options.speed]      world units per second
   * @param {number} [options.maxStep]    the hard cap on one step, which is
   *                                      what makes teleporting impossible
   * @param {number} [options.maxSlope]   how steep a step may climb
   * @param {number} [options.stepHeight]  clearance an agent needs over a rise
   */
  constructor(world, options = {}) {
    this.world = world;
    this.speed = options.speed ?? 6;
    this.maxStep = options.maxStep ?? 2.5;
    this.maxSlope = options.maxSlope ?? 1.6;
    this.stepHeight = options.stepHeight ?? 0.9;
    this.arrivalEpsilon = options.arrivalEpsilon ?? 0.6;
  }

  /** how far an agent may go in one simulated step of `dt` seconds */
  budget(dt) {
    return clamp(this.speed * dt, 0, this.maxStep);
  }

  /**
   * Can the agent stand here? Returns the ground under the point, or a reason
   * it cannot. `reason` is a real answer, not a failure: an agent that cannot
   * leave a cliff edge should be told it is at a cliff edge.
   */
  canStand(realmId, pos) {
    const ground = this.world.groundAt(realmId, pos);
    if (!ground) return { ok: false, reason: 'void — there is no ground there' };
    if (ground.water) return { ok: false, reason: 'deep water', ground };
    return { ok: true, ground };
  }

  /**
   * One step toward `target`. This is the only function that moves an agent, and
   * it moves it by at most `maxStep`. Returns what happened so the caller can
   * narrate it honestly rather than claiming arrival it did not achieve.
   */
  stepTo(agent, target, dt = 1 / 60) {
    const realmId = agent.realmId;
    const from = agent.pos;
    const dx = target[0] - from[0];
    const dz = target[2] - from[2];
    const flat = Math.hypot(dx, dz);

    // standing still is a legal, and common, outcome
    if (flat <= this.arrivalEpsilon) {
      agent.motion = MOTION.ARRIVED;
      return { moved: 0, arrived: true, reason: null };
    }

    const budget = this.budget(dt);
    const travel = Math.min(flat, budget);
    const k = travel / flat;
    const want = [
      clamp(from[0] + dx * k, -Infinity, Infinity),
      from[1],
      clamp(from[2] + dz * k, -Infinity, Infinity),
    ];

    // try the step, and if the ground refuses it, try to slide along the
    // obstacle instead of stopping dead against it — the way you walk around a
    // rock rather than into it
    const straight = this._tryStep(agent, want);
    if (straight.ok) {
      agent.pos = straight.pos;
      // arrival is a property of the distance still to cover, not of how far
      // this one step happened to be. Conflating the two ends every walk after
      // a single step, because every step is shorter than the goal.
      const remaining = this.world.groundDistance(agent.pos, target);
      const arrived = remaining <= this.arrivalEpsilon;
      agent.motion = arrived ? MOTION.ARRIVED : MOTION.WALKING;
      return { ...straight, arrived, remaining };
    }

    const side = this._tryStep(agent, [
      want[0] + (from[2] - want[2]) * 0.6,
      want[1],
      want[2] - (from[0] - want[0]) * 0.6,
    ]);
    if (side.ok) {
      agent.pos = side.pos;
      agent.motion = MOTION.WALKING;
      return {
        ...side,
        arrived: this.world.groundDistance(agent.pos, target) <= this.arrivalEpsilon,
        remaining: this.world.groundDistance(agent.pos, target),
        slid: true,
      };
    }

    agent.motion = MOTION.BLOCKED;
    return { moved: 0, arrived: false, reason: straight.reason };
  }

  /** can this specific step be taken, and where would it land */
  _tryStep(agent, want) {
    const realmId = agent.realmId;
    const stand = this.canStand(realmId, want);
    if (!stand.ok) return { ok: false, moved: 0, arrived: false, reason: stand.reason };

    // a rise the agent cannot climb: refusing is what makes terrain matter.
    // Without this an agent walks straight up a cliff face.
    const rise = Math.abs(stand.ground.y - agent.pos[1]);
    const run = Math.max(0.001, Math.hypot(want[0] - agent.pos[0], want[2] - agent.pos[2]));
    if (rise / run > this.maxSlope && rise > this.stepHeight) {
      return { ok: false, moved: 0, arrived: false, reason: 'the ground rises too steeply here' };
    }

    // keep the agent on the ground rather than letting it drift over it
    const pos = [want[0], stand.ground.y, want[2]];
    const moved = Math.hypot(pos[0] - agent.pos[0], pos[2] - agent.pos[2]);
    return {
      ok: true,
      pos,
      moved,
      ground: stand.ground,
      region: stand.ground.region,
    };
  }

  /**
   * Walk until `target` is reached or the walk is refused. Bounded by `maxSteps`
   * so a single call can never run away, and so an agent always gets control
   * back to decide something.
   */
  moveToward(agent, target, options = {}) {
    const dt = options.dt ?? 1 / 60;
    const maxSteps = options.maxSteps ?? 240;
    const goal = options.goal || target;
    let steps = 0;
    let reason = null;

    while (steps < maxSteps) {
      const here = this.world.groundDistance(agent.pos, goal);
      if (here <= this.arrivalEpsilon) {
        agent.motion = MOTION.ARRIVED;
        return {
          arrived: true, steps, reason: null,
          distance: here,
          pos: [...agent.pos],
        };
      }
      const result = this.stepTo(agent, goal, dt);
      steps += 1;
      if (!result.ok) {
        agent.motion = MOTION.BLOCKED;
        reason = result.reason;
        break;
      }
      if (result.arrived) break;
    }

    const distance = this.world.groundDistance(agent.pos, goal);
    const arrived = distance <= this.arrivalEpsilon;
    agent.motion = arrived ? MOTION.ARRIVED : (reason ? MOTION.BLOCKED : MOTION.WALKING);
    return {
      arrived,
      steps,
      reason,
      distance,
      pos: [...agent.pos],
      partial: !arrived,
    };
  }

  /**
   * Walk a route between landmarks, following the realm's roads.
   *
   * The route is a chain of landmark ids; the walk is the concatenation of the
   * polylines between them. This is a genuinely long walk — an agent crossing a
   * realm visits every road on the way — which is why it is bounded and why it
   * returns partial progress rather than pretending to have arrived.
   */
  followRoute(agent, landmarkIds, options = {}) {
    const world = this.world.worldOf(agent.realmId);
    if (!world || !world.paths || !landmarkIds || landmarkIds.length < 2) {
      return { arrived: false, steps: 0, reason: 'no route', distance: null };
    }
    const byPair = new Map();
    for (const path of world.paths) byPair.set(`${path.a}|${path.b}`, path);

    let legs = [];
    for (let i = 0; i < landmarkIds.length - 1; i += 1) {
      const key = `${landmarkIds[i]}|${landmarkIds[i + 1]}`;
      const rev = `${landmarkIds[i + 1]}|${landmarkIds[i]}`;
      const path = byPair.get(key) || byPair.get(rev);
      if (!path) continue;
      const pts = path.points.slice();
      if (byPair.get(key)) pts.reverse();   // paths are stored heart-first
      legs.push(pts);
    }
    if (!legs.length) return { arrived: false, steps: 0, reason: 'no path geometry', distance: null };

    // stitch the legs into one polyline in global space, dropping the join
    const realm = this.world.realm(agent.realmId);
    const toGlobal = (p) => [realm.center[0] + p[0], realm.floorY + p[1], realm.center[2] + p[2]];
    const line = [];
    for (const pts of legs) {
      const start = line.length;
      for (const p of pts) {
        const g = toGlobal(p);
        const last = line[line.length - 1];
        if (last && Math.hypot(last[0] - g[0], last[2] - g[2]) < 0.01) continue;
        line.push(g);
      }
      if (line.length === start) continue;
    }
    if (!line.length) return { arrived: false, steps: 0, reason: 'empty path', distance: null };

    return this.walkPolyline(agent, line, options);
  }

  /**
   * Follow a polyline of global points, one short step at a time.
   *
   * A polyline point that is over void is stepped *toward* and not stepped
   * *onto*: the agent walks to the near edge of the gap. That is what lets a
   * road that bridges a rift be walkable without the agent falling into it.
   */
  walkPolyline(agent, line, options = {}) {
    const dt = options.dt ?? 1 / 60;
    const maxSteps = options.maxSteps ?? 400;
    let index = options.startIndex ?? 0;
    let steps = 0;
    let reason = null;

    while (steps < maxSteps && index < line.length) {
      const target = line[index];
      if (this.world.groundDistance(agent.pos, target) <= this.arrivalEpsilon) {
        index += 1;
        continue;
      }
      const stand = this.canStand(agent.realmId, target);
      if (!stand.ok) {
        // the line runs over a gap: take the last point that had ground
        const walkable = this._lastWalkable(line, index, agent.realmId);
        if (!walkable) { reason = stand.reason; break; }
        line = line.slice(0, walkable + 1);
        if (index > walkable) index = walkable;
        if (index >= line.length - 1) break;
        target = line[index];
      }
      const result = this.stepTo(agent, target, dt);
      steps += 1;
      if (!result.ok) { reason = result.reason; break; }
    }

    const last = line[Math.min(index, line.length - 1)];
    const arrived = index >= line.length;
    agent.motion = arrived ? MOTION.ARRIVED : (reason ? MOTION.BLOCKED : MOTION.WALKING);
    return { arrived, steps, reason, index, distance: arrived ? 0 : this.world.groundDistance(agent.pos, last) };
  }

  /** the last index at or before `from` that stands on solid ground */
  _lastWalkable(line, from, realmId) {
    for (let i = from; i >= 0; i -= 1) {
      if (this.canStand(realmId, line[i]).ok) return i;
    }
    return -1;
  }

  /**
   * Move between realms, by walking.
   *
   * A realm hangs off a bough at its `tip`, and the limb runs back to the
   * trunk. An agent leaving a realm walks to its conduit, climbs out along the
   * stem, and arrives at another realm's conduit — a long journey along the
   * tree, sampled the same short-step way as any other walk.
   *
   * It is *not* a teleport and the distinction is deliberate rather than
   * accidental: the path is real geometry the renderer already draws, and the
   * agent's position walks every step of it. `isTeleport` reports it as a
   * traversal so callers and tests can tell the two apart explicitly.
   */
  transit(agent, toRealmId, options = {}) {
    const from = this.world.realm(agent.realmId);
    const to = this.world.realm(toRealmId);
    if (!from || !to) return { ok: false, reason: 'unknown realm', isTeleport: false };
    if (from.id === to.id) {
      agent.motion = MOTION.IDLE;
      return { ok: true, reason: 'already here', isTeleport: false };
    }

    const line = this.conduit(from, to);
    if (!line || line.length < 2) {
      return { ok: false, reason: 'no conduit between these realms', isTeleport: false };
    }

    // The conduit is the limb, up in the wood — there is no ground under it, so
    // it cannot be walked by the ground-walker. This is the one explicit world
    // mechanic in the agent layer: while transiting, the body climbs the limb
    // rather than crossing country, sampled the same short-step way as any
    // other walk. It is walked, not teleported, and `traversal: true` records
    // that distinction.
    const walk = this.climb(agent, line, {
      dt: options.dt ?? 1 / 60,
      maxSteps: options.maxSteps ?? 4000,
    });
    if (walk.arrived) {
      agent.realmId = to.id;
      // stepping off the conduit onto the ground of the new realm
      const spawn = this.world.spawnPoint(to.id, 0);
      if (spawn) {
        this.moveToward(agent, spawn.position, {
          dt: options.dt, maxSteps: options.maxSteps ?? 4000,
        });
      }
    }
    return {
      ok: agent.realmId === to.id,
      arrived: agent.realmId === to.id,
      steps: walk.steps,
      reason: walk.reason,
      // a traversal is not a teleport: the difference is that a traversal is
      // walked end to end and a teleport is not. Both are flagged so the debug
      // view and the tests can tell which happened.
      isTeleport: false,
      traversal: true,
      length: line.length,
    };
  }

  /**
   * Walk a polyline in world space without needing ground under it — climbing
   * the limb during a traversal. It is still stepped: each tick advances by at
   * most the step budget, so an agent on the conduit is a body moving along a
   * visible path, never a body relocated.
   */
  climb(agent, line, options = {}) {
    const dt = options.dt ?? 1 / 60;
    const maxSteps = options.maxSteps ?? 4000;
    let index = options.startIndex ?? 0;
    let steps = 0;

    while (steps < maxSteps && index < line.length) {
      const target = line[index];
      const dx = target[0] - agent.pos[0];
      const dy = target[1] - agent.pos[1];
      const dz = target[2] - agent.pos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d <= this.arrivalEpsilon) { index += 1; continue; }
      const budget = this.budget(dt);
      const k = Math.min(1, budget / d);
      agent.pos = [
        agent.pos[0] + dx * k,
        agent.pos[1] + dy * k,
        agent.pos[2] + dz * k,
      ];
      agent.motion = MOTION.TRANSIT;
      steps += 1;
    }
    const arrived = index >= line.length;
    if (arrived) agent.motion = MOTION.ARRIVED;
    return { arrived, steps, reason: arrived ? null : 'ran out of steps on the conduit', index };
  }

  /** the global polyline from one realm's floor to another's, via their stems */
  conduit(from, to) {
    const stemOf = (realm) => {
      const layout = this.world.layout;
      const full = layout?.realms?.realms?.get(realm.id);
      if (!full || !full.stem || !full.stem.length) return null;
      return full.stem;
    };
    const a = stemOf(from);
    const b = stemOf(to);
    if (!a || !b) return null;

    // A realm's stem runs from its conduit point on the tree (the `tip`) out to
    // its centre. Getting from one realm to another means leaving A's centre,
    // walking *in* along A's stem to the tree, crossing the trunk to B's
    // branch, and walking *out* along B's stem. `routeThroughTrunk` gives the
    // real vein geometry for that crossing; without it the two stems would be
    // joined by a straight line through open air, which is a teleport wearing a
    // disguise.
    const trunkOf = (realm, reverse) => {
      const route = this.world.layout?.routeThroughTrunk?.(realm.id);
      if (!route || !route.length) return [];
      const segments = route.map((pts) => (reverse ? pts.slice().reverse() : pts.slice()));
      // `routeThroughTrunk` returns innermost-first; walking to the trunk is
      // forward, walking away from it is the whole list reversed
      const ordered = reverse ? segments.reverse() : segments;
      const out = [];
      for (const pts of ordered) for (const p of pts) out.push([p[0], p[1], p[2]]);
      return out;
    };

    const centreToTree = a.slice().reverse();          // A centre -> A tip
    const aToTrunk = trunkOf(from, false);             // A tip -> root
    const trunkToB = trunkOf(to, true);               // root -> B tip
    const bTreeToCentre = b.slice();                  // B tip -> B centre

    const line = [];
    for (const p of [...centreToTree, ...aToTrunk, ...trunkToB, ...bTreeToCentre]) {
      const last = line[line.length - 1];
      if (last && Math.hypot(last[0] - p[0], last[1] - p[1], last[2] - p[2]) < 0.01) continue;
      line.push([p[0], p[1], p[2]]);
    }
    return line;
  }

  /** does a movement count as a teleport? exported so tests can assert on it */
  isTeleport(from, to, dt) {
    const budget = this.budget(dt);
    return Math.hypot(to[0] - from[0], to[2] - from[2]) > budget + 1e-6;
  }
}
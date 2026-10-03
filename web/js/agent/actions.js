// Yggdrasil · agent actions
//
// What an agent can *do*, as a small closed vocabulary. Each action takes
// arguments, mutates the world through the other modules, and returns a
// structured observation — the same shape every time, so a reasoning model can
// be told exactly what it will get back and learn to read it.
//
// The vocabulary is deliberately small and every action is something that
// could be described to a person:
//
//   look      turn, and take in what is there
//   move      walk somewhere, arriving over time
//   approach  walk toward something until it is close
//   inspect   read a memory that is in sight
//   interact  do something to the world with something in it
//   remember  write a memory into the shared graph
//   recall    search the shared graph
//   link      tie two memories together
//
// Two invariants hold across all of them:
//
//   · inspect requires the memory to be *perceived*. An agent cannot read a
//     memory it has not walked up to, and this is checked here rather than
//     trusted to the caller.
//   · remember / recall / link go through the memory bridge, so every write
//     lands in the one Yggdrasil database and is visible to everyone else.
//
// No action moves an agent without going through Movement, so the no-teleport
// rule is a property of the vocabulary and not just of the movement module.

import { MOTION } from './movement.js';

/** the actions an agent may be offered, in the order they should be described */
export const ACTIONS = [
  'look', 'move', 'approach', 'inspect', 'interact', 'remember', 'recall', 'link', 'wait',
];

/** how many past observations an agent keeps in its own working memory */
const OBSERVATION_HISTORY = 12;

export class ActionSet {
  /**
   * @param {object} parts
   * @param {import('./world.js').AgentWorld} parts.world
   * @param {import('./movement.js').Movement} parts.movement
   * @param {import('./perception.js').Perception} parts.perception
   * @param {import('./memory.js').MemoryBridge} parts.bridge
   * @param {Function} [parts.getAgents] the roster, for multi-agent actions
   */
  constructor(parts) {
    this.world = parts.world;
    this.movement = parts.movement;
    this.perception = parts.perception;
    this.bridge = parts.bridge;
    this.getAgents = parts.getAgents || (() => []);
  }

  /**
   * Run one action and return the observation.
   * Every failure is an observation too — an agent that tries to walk into the
   * void should be told it is at the edge, not handed an exception.
   */
  async act(agent, name, args = {}) {
    const started = this.perception.perceive(agent, { agents: this.getAgents() });
    let outcome;
    try {
      const fn = this[`do_${name}`];
      if (typeof fn !== 'function') {
        outcome = { ok: false, reason: `no action called "${name}"`, kind: 'invalid' };
      } else {
        outcome = await fn.call(this, agent, args, started);
      }
    } catch (err) {
      outcome = { ok: false, reason: String((err && err.message) || err), kind: 'error' };
    }
    return this.finish(agent, name, args, outcome, started);
  }

  /** attach the after-state to an outcome so the agent learns from its own action */
  finish(agent, name, args, outcome, before) {
    const after = this.perception.perceive(agent, { agents: this.getAgents() });
    const gained = after.memories.filter((m) => !before.memories.some((b) => b.memoryId === m.memoryId));
    const lost = before.memories.filter((m) => !after.memories.some((a) => a.memoryId === m.memoryId));

    const observation = {
      action: { name, args },
      ok: outcome.ok !== false,
      reason: outcome.reason || null,
      kind: outcome.kind || name,
      result: outcome.result || null,
      moved: outcome.moved ?? 0,
      position: [agent.pos[0], agent.pos[1], agent.pos[2]],
      realm: { id: agent.realmId, name: after.realmName },
      motion: agent.motion,
      // what changed in what it can see. This is the part a model reads to
      // learn "I got closer to that, so now I can read it."
      perceived: { gained, lost },
      visibleCount: after.memories.length,
      // a compact view of the world for the prompt builder; the full observation
      // stays available for the debug view
      perception: after,
      consumed: outcome.consumed || null,
    };

    agent.record(observation);
    agent.lastAction = observation.action;
    agent.lastObservation = observation;
    return observation;
  }

  // ------------------------------------------------------------------ look

  /** turn on the spot and take in the surroundings */
  async do_look(agent, args, seen) {
    if (typeof args.yaw === 'number') agent.yaw = args.yaw;
    else if (args.bearing !== undefined) {
      const target = this._resolveBearingTarget(agent, args.bearing, seen);
      if (target) agent.yaw = Math.atan2(target[2] - agent.pos[2], target[0] - agent.pos[0]);
    } else if (args.at) {
      const target = this._resolveTarget(agent, args.at, seen);
      if (target) agent.yaw = Math.atan2(target[2] - agent.pos[2], target[0] - agent.pos[0]);
    }
    agent.motion = MOTION.IDLE;
    return {
      ok: true,
      kind: 'look',
      result: {
        yaw: agent.yaw,
        facing: seen.ahead,
        nearestMemory: seen.memories[0]
          ? { memoryId: seen.memories[0].memoryId, distance: seen.memories[0].distance }
          : null,
      },
    };
  }

  // ------------------------------------------------------------------ move

  /** walk to a point, or to a named place in the realm */
  async do_move(agent, args) {
    const target = this._resolveMoveTarget(agent, args);
    if (!target) {
      return { ok: false, kind: 'move', reason: 'no such place to move to' };
    }
    const from = [...agent.pos];
    const walk = this.movement.moveToward(agent, target.position, {
      dt: args.dt ?? 1 / 60,
      maxSteps: args.maxSteps ?? 400,
    });
    return {
      ok: walk.arrived,
      kind: 'move',
      partial: walk.partial,
      moved: this.world.groundDistance(from, agent.pos),
      reason: walk.reason,
      result: { steps: walk.steps, distanceLeft: walk.distance, target: target.label },
    };
  }

  // -------------------------------------------------------------- approach

  /**
   * Walk toward something until it is within reach, using the realm's roads
   * when the target is a landmark so the agent walks the route a person would.
   */
  async do_approach(agent, args, seen) {
    const target = this._resolveTarget(agent, args.target ?? args.at ?? args.memory, seen);
    if (!target) {
      return { ok: false, kind: 'approach', reason: 'nothing there to approach' };
    }
    const stopAt = args.within ?? this.perception.range(agent.realmId) * 0.34;
    const from = [...agent.pos];

    // a landmark: take the route, which is a real walk along real roads
    if (target.landmark) {
      const start = this.world.nearestLandmark(agent.realmId, agent.pos);
      const route = this.world.route(agent.realmId, start?.id, target.landmark.id);
      if (route && route.length > 1) {
        const walk = this.movement.followRoute(agent, route, {
          dt: args.dt ?? 1 / 60,
          maxSteps: args.maxSteps ?? 1200,
        });
        return this._approachResult(agent, walk, target, from, route.length);
      }
    }

    const look = this.perception.routeLooksOpen(agent, target.position);
    const walk = this.movement.moveToward(agent, target.position, {
      dt: args.dt ?? 1 / 60,
      maxSteps: args.maxSteps ?? 400,
    });
    const within = this.world.groundDistance(agent.pos, target.position) <= stopAt;
    return this._approachResult(agent, { ...walk, arrived: walk.arrived || within }, target, from, 1, look);
  }

  _approachResult(agent, walk, target, from, legs, look) {
    const distance = this.world.groundDistance(agent.pos, target.position);
    const ok = walk.arrived || distance <= (target.stopAt ?? this.perception.range(agent.realmId) * 0.34);
    return {
      ok,
      kind: 'approach',
      partial: !ok,
      moved: this.world.groundDistance(from, agent.pos),
      reason: walk.reason,
      result: {
        target: target.label,
        legs,
        steps: walk.steps,
        distance,
        routeLooksOpen: look ? look.open : undefined,
      },
    };
  }

  // --------------------------------------------------------------- inspect

  /**
   * Read a memory. Requires perception: this is the check that makes walking
   * away from a memory actually cost you access to it.
   */
  async do_inspect(agent, args, seen) {
    const named = args.target ?? args.at ?? args.memory;
    const memoryId = this._memoryIdOf(named) || (named === 'nearest' ? seen.memories[0]?.memoryId : null);
    if (!memoryId) return { ok: false, kind: 'inspect', reason: 'no memory named' };

    const inSight = seen.memories.find((m) => m.memoryId === memoryId);
    if (!inSight) {
      const obj = this.world.memoryObject(memoryId);
      const where = obj && obj.realmId !== agent.realmId ? 'another realm' : 'out of sight';
      return {
        ok: false,
        kind: 'inspect',
        reason: `that memory is ${where} — walk to it first`,
      };
    }

    // a memory's own context: its links and neighbourhood, from the store
    let context = null;
    try {
      context = await this.bridge.context(memoryId);
    } catch {
      context = null;
    }
    const memory = context?.memory || (await this.bridge.get(memoryId).catch(() => null));
    if (!memory) return { ok: false, kind: 'inspect', reason: 'that memory could not be read' };

    // reading it is an event the store knows about: this is the same read the
    // human inspector performs, counted and logged the same way
    agent.known.add(memoryId);
    return {
      ok: true,
      kind: 'inspect',
      consumed: { action: 'inspect', memoryId },
      result: {
        memory,
        context: context ? { links: context.links || [], related: context.related || null } : null,
        distance: inSight.distance,
        links: this.bridge.relatedIds(memoryId, this.world.state.links),
      },
    };
  }

  // -------------------------------------------------------------- interact

  /**
   * Act on the world. What is possible depends on what is in reach: a memory
   * can be read, re-titled or linked; another agent can be greeted or handed
   * what it is carrying. Refusing is a normal outcome.
   */
  async do_interact(agent, args, seen) {
    // with another agent
    const otherId = args.agent || args.with;
    if (otherId) {
      const other = this.getAgents().find((a) => a.id === otherId && a.realmId === agent.realmId);
      if (!other) return { ok: false, kind: 'interact', reason: 'no such agent here' };
      const distance = this.world.distance(agent.pos, other.pos);
      if (distance > this.perception.agentRange(agent.realmId)) {
        return { ok: false, kind: 'interact', reason: 'that agent is too far away to reach' };
      }
      const message = args.message || args.say || null;
      if (message) {
        // information exchange between agents: the receiving agent's own
        // working memory, not the shared store, unless it chooses to write
        other.known.add(...agent.known);
        other.received.push({ from: agent.id, message, at: other.steps });
        return {
          ok: true,
          kind: 'interact',
          consumed: { action: 'interact', agent: otherId },
          result: {
            told: otherId, message,
            theyCarry: other.known.size,
            theySaid: other.lastObservation ? other.lastObservation.action.name : null,
          },
        };
      }
      return {
        ok: true,
        kind: 'interact',
        result: { met: otherId, name: other.name, lastAction: other.lastAction?.name || null },
      };
    }

    // with a memory: re-title it, revise it, or adjust how much weight it
    // carries. These are writes to the shared store, so they are visible to
    // everyone and to the UI — and a write that the store refuses is reported
    // as a failure, never dressed up as a success.
    const memoryId = this._memoryIdOf(args.target ?? args.at ?? args.memory);
    if (memoryId) {
      const inSight = seen.memories.find((m) => m.memoryId === memoryId);
      if (!inSight) return { ok: false, kind: 'interact', reason: 'that is not within reach' };
      const obj = this.world.memoryObject(memoryId);
      const changes = {};
      if (args.title) changes.title = args.title;
      if (args.content) changes.content = args.content;
      if (args.importance !== undefined) changes.importance = args.importance;
      if (args.confidence !== undefined) changes.confidence = args.confidence;

      if (Object.keys(changes).length) {
        const updated = await this.bridge.update(memoryId, changes, { actor: agent.id });
        return {
          ok: true,
          kind: 'interact',
          consumed: { action: 'interact', memoryId },
          result: { memoryId, at: obj?.realmId, changed: Object.keys(changes), memory: updated },
        };
      }
      // nothing asked for: just report what is here, which is a legitimate thing
      // to do to something you are standing next to
      return {
        ok: true,
        kind: 'interact',
        result: { memoryId, distance: inSight.distance, links: obj ? obj.links.length : 0 },
      };
    }

    // with the ground: describe where the agent is standing
    if (args.ground || args.place) {
      return { ok: true, kind: 'interact', result: { terrain: seen.terrain, ahead: seen.ahead } };
    }
    return { ok: false, kind: 'interact', reason: 'nothing here to interact with' };
  }

  // -------------------------------------------------------------- remember

  /** write a memory into the shared graph — it becomes a place in the tree */
  async do_remember(agent, args) {
    if (!args.title) return { ok: false, kind: 'remember', reason: 'a memory needs a title' };
    const created = await this.bridge.remember({
      title: args.title,
      content: args.content || args.title,
      kind: args.memoryKind || args.kind || 'fact',
      domain: args.domain || this.world.realm(agent.realmId)?.name || '',
      tags: args.tags || ['agent', agent.id],
      importance: args.importance,
      confidence: args.confidence,
      source: agent.id,
      link_to: args.link_to || [],
      parent_id: args.parent_id,
    });
    const memory = created?.memory || created || null;
    const memoryId = memory?.id || null;
    if (memoryId) agent.known.add(memoryId);
    return {
      ok: !!memoryId,
      kind: 'remember',
      consumed: { action: 'remember', memoryId },
      result: {
        memoryId,
        title: memory?.title || args.title,
        // the store places it in the tree; the world it becomes is derived from
        // that, never invented here
        nodeId: memory?.node_id || null,
      },
    };
  }

  // ---------------------------------------------------------------- recall

  /** search the shared graph. A real query against the real store. */
  async do_recall(agent, args) {
    if (!args.query) return { ok: false, kind: 'recall', reason: 'recall needs a query' };
    const out = await this.bridge.recall(args.query, {
      limit: args.limit ?? 6,
      actor: agent.id,
    });
    for (const r of out.results) if (r.id) agent.known.add(r.id);
    return {
      ok: true,
      kind: 'recall',
      consumed: { action: 'recall', query: args.query },
      result: {
        query: out.query,
        count: out.results.length,
        results: out.results.map((r) => ({
          memoryId: r.id,
          title: r.title,
          kind: r.kind,
          score: r.score,
          // retrieval reaches memories the agent has not stood next to; the id
          // lets it decide whether to walk there and read one properly
          inThisRealm: this.world.memoryObject(r.id)?.realmId === agent.realmId,
        })),
      },
    };
  }

  // ------------------------------------------------------------------ link

  /** tie two memories together. Both must be things this agent knows. */
  async do_link(agent, args) {
    const a = this._memoryIdOf(args.a ?? args.from ?? args.memory);
    const b = this._memoryIdOf(args.b ?? args.to);
    if (!a || !b) return { ok: false, kind: 'link', reason: 'link needs two memories' };
    if (a === b) return { ok: false, kind: 'link', reason: 'a memory cannot link to itself' };
    const known = [...agent.known];
    const missing = [a, b].filter((id) => !known.includes(id));
    if (missing.length) {
      // an agent may only link what it has actually encountered — one of the
      // few real permission rules in the world
      return {
        ok: false,
        kind: 'link',
        reason: `not known to this agent yet: ${missing.join(', ')} — inspect or recall them first`,
      };
    }
    const linked = await this.bridge.link(a, b, {
      type: args.type || 'related',
      weight: args.weight,
      note: args.note || `linked by ${agent.id}`,
    });
    return {
      ok: true,
      kind: 'link',
      consumed: { action: 'link', a, b },
      result: { a, b, link: linked?.link || linked || null },
    };
  }

  /** stand still and take stock. A legitimate move in a world of agents. */
  async do_wait(agent, args) {
    agent.motion = MOTION.IDLE;
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { ok: true, kind: 'wait', result: { waited: args.turns ?? 1 } };
  }

  // --------------------------------------------------------------- helpers

  _memoryIdOf(target) {
    if (!target) return null;
    if (typeof target === 'string' && target.startsWith('mem_')) return target;
    if (typeof target !== 'string') return null;
    const byNode = this.world.memoryIdForNode(target);
    return byNode;
  }

  /** resolve a named thing — memory, landmark, agent — to a position */
  _resolveTarget(agent, target, seen) {
    if (!target) return null;
    if (Array.isArray(target)) return { position: target, label: 'a point' };

    // "the nearest one" is how an agent refers to a memory it has not been told
    // the id of: it perceives a set, and picks from it by position. This is the
    // model's natural way to say "walk over there" and resolving it here keeps
    // the reasoning side free of ids it has to memorise.
    if (target === 'nearest' || target === 'closest') {
      const nearest = seen?.memories?.[0];
      if (!nearest) return null;
      const obj = this.world.memoryObject(nearest.memoryId);
      return obj
        ? { position: obj.pos, label: `memory ${nearest.memoryId}`, memoryId: nearest.memoryId }
        : null;
    }
    if (target === 'farthest') {
      const list = seen?.memories || [];
      const last = list[list.length - 1];
      if (!last) return null;
      const obj = this.world.memoryObject(last.memoryId);
      return obj
        ? { position: obj.pos, label: `memory ${last.memoryId}`, memoryId: last.memoryId }
        : null;
    }

    // a memory, by id
    const memoryId = this._memoryIdOf(target);
    if (memoryId) {
      const obj = this.world.memoryObject(memoryId);
      if (obj) return { position: obj.pos, label: `memory ${memoryId}`, memoryId };
    }
    // a memory by its index in what is visible, so an agent can say "the second
    // one I can see" without carrying ids around. `nearest` is index zero.
    if (typeof target === 'number' && seen) {
      const m = seen.memories[target];
      if (m) {
        const obj = this.world.memoryObject(m.memoryId);
        if (obj) return { position: obj.pos, label: `memory ${m.memoryId}`, memoryId: m.memoryId };
      }
    }
    // a landmark by id
    const landmark = (seen?.landmarks || []).find((l) => l.id === target);
    if (landmark) {
      const world = this.world.worldOf(agent.realmId);
      const lm = world?.landmarks.find((l) => l.id === target);
      if (lm) {
        return {
          position: this.world.toGlobal(agent.realmId, [lm.x, lm.y, lm.z]),
          label: `landmark ${lm.name}`,
          landmark: lm,
        };
      }
    }
    // another agent
    const other = this.getAgents().find((a) => a.id === target && a.realmId === agent.realmId);
    if (other) return { position: [...other.pos], label: `agent ${other.id}` };
    return null;
  }

  _resolveMoveTarget(agent, args) {
    if (args.to) return this._resolveTarget(agent, args.to, this.perception.perceive(agent));
    if (Array.isArray(args.position)) return { position: args.position, label: 'a point' };
    if (args.x !== undefined && args.z !== undefined) {
      return { position: [args.x, agent.pos[1], args.z], label: 'a point' };
    }
    return null;
  }

  /** turn toward a memory id or landmark id */
  _resolveBearingTarget(agent, bearing, seen) {
    if (typeof bearing === 'number') {
      const dist = this.perception.range(agent.realmId) * 0.5;
      return [agent.pos[0] + Math.cos(bearing) * dist, agent.pos[1], agent.pos[2] + Math.sin(bearing) * dist];
    }
    return this._resolveTarget(agent, bearing, seen);
  }
}
// Yggdrasil · agent perception
//
// Perception is what an agent knows without doing anything. This is the module
// that makes the spatial relationship real, so it is worth being precise about
// what it does and does not do.
//
// It does NOT read the memory database. It is handed the memory *objects* —
// `{memoryId, pos, realmId}` — which carry a position and an id and nothing
// else, and it filters them by distance from where the agent is standing. The
// content of a memory is only ever obtained by spending an action on it.
//
// The consequences, which are the point:
//
//   · stand near a memory and it appears in the observation with a distance and
//     a bearing. Move away and it leaves the observation. Nothing else changed,
//     and the agent genuinely cannot see it any more.
//   · a memory in another realm is never visible, no matter how close it looks
//     on screen, because realms are separate volumes an agent has to travel
//     between.
//   · the far side of a big realm takes real time to reach, so the sequence of
//     things an agent sees while crossing it is a function of where it walks.
//
// `perceive` is also where other agents enter the picture: an agent that walks
// within sight of a neighbour can see it, which is the precondition for
// approaching and talking to one.
//
// One piece of geometry is worth stating, because it shapes everything else.
//
// Memories are not stuck in the ground: `layout.js` grows each one into a bough
// that crosses the realm, and a bough arches above the country. So a memory can
// be directly *overhead* — ten units up and one step to the side — while an
// agent standing beneath it is looking straight ahead at empty air.
//
// Measuring sight as a plain 3D distance gets this wrong in the worst possible
// way: the nearest memories in a realm would be the invisible ones, and an
// agent would have to walk away from a bough to see into it. Sight here is
// therefore a *volume* — a horizontal reach across the ground, and a vertical
// reach tall enough to take in the canopy overhead — rather than a sphere. An
// agent still has to be in the right part of the realm, and still loses a
// memory by walking away, which is what the spatial relationship requires.

import { glance } from './memory.js';

/** how far an agent can see across the ground, as a fraction of the radius */
const DEFAULT_RANGE = 0.62;

/**
 * how far up an agent can see, as a fraction of the radius. Generous on
 * purpose: the boughs arch up to about `0.44 * radius` above the floor, and an
 * agent under a bough should be able to see the memories in it.
 */
const DEFAULT_VERTICAL = 0.95;

/** above this, two agents are too far apart to make out each other */
const DEFAULT_AGENT_RANGE = 1.35;

export class Perception {
  /**
   * @param {import('./world.js').AgentWorld} world
   * @param {object} options
   * @param {number} [options.rangeFraction]  perception radius vs realm radius
   * @param {number} [options.agentRangeFraction]  the same, for other agents
   */
  constructor(world, options = {}) {
    this.world = world;
    this.rangeFraction = options.rangeFraction ?? DEFAULT_RANGE;
    this.agentRangeFraction = options.agentRangeFraction ?? DEFAULT_AGENT_RANGE;
    this.verticalFraction = options.verticalFraction ?? DEFAULT_VERTICAL;
  }

  /** the perception radius for a realm, in world units */
  range(realmId) {
    const realm = this.world.realm(realmId);
    if (!realm) return 0;
    return realm.radius * this.rangeFraction;
  }

  /**
   * How far up an agent can see. Memories hang in the boughs, so this has to
   * clear the canopy rather than describe a sphere.
   */
  verticalReach(realmId) {
    const realm = this.world.realm(realmId);
    if (!realm) return 0;
    return realm.radius * this.verticalFraction;
  }

  /**
   * Can an agent at `pos` make out a thing at `target`?
   *
   * Horizontal reach and vertical reach are separate, because in a realm the
   * interesting things are overhead as well as around. Returns the distances so
   * a caller can report *why* something is or is not visible.
   */
  inSight(realmId, pos, target, options = {}) {
    const range = options.range ?? this.range(realmId);
    const vertical = options.vertical ?? this.verticalReach(realmId);
    const horizontal = this.world.groundDistance(pos, target);
    const elevation = Math.abs(target[1] - pos[1]);
    return {
      visible: horizontal <= range && elevation <= vertical,
      horizontal,
      elevation,
      range,
      vertical,
      // which limit did it hit, so an agent told something is invisible can be
      // told whether to walk closer or look up
      blockedBy: horizontal > range ? 'distance' : (elevation > vertical ? 'overhead' : null),
    };
  }

  /** how close another agent has to be to be made out */
  agentRange(realmId) {
    const realm = this.world.realm(realmId);
    if (!realm) return 0;
    return realm.radius * this.agentRangeFraction;
  }

  /**
   * Everything the agent can perceive from where it stands.
   *
   * `memories` carries id + position + distance + bearing. The title and kind
   * are included because a *shape* of something is legitimately visible from
   * across a room; the content is not, and cannot be obtained without an
   * action. An agent that has to decide whether to walk over and read something
   * needs enough to choose, and nothing more.
   */
  perceive(agent, options = {}) {
    const world = this.world;
    const realm = world.realm(agent.realmId);
    const memoryRange = options.range ?? this.range(agent.realmId);
    const agentRange = options.agentRange ?? this.agentRange(agent.realmId);

    const result = {
      realmId: agent.realmId,
      realmName: realm ? realm.name : null,
      perceptionRange: memoryRange,
      verticalReach: options.vertical ?? this.verticalReach(agent.realmId),
      agentRange,
      memories: [],
      landmarks: [],
      agents: [],
      terrain: null,
      // how much of what is out there the agent can actually see, which is a
      // useful thing for a reasoning model to be told
      coverage: 0,
    };
    if (!realm) return result;

    // ---- memories, by distance
    let total = 0;
    const vertical = options.vertical ?? this.verticalReach(agent.realmId);
    for (const obj of world.objectsIn(agent.realmId)) {
      total += 1;
      const sight = this.inSight(agent.realmId, agent.pos, obj.pos, { range: memoryRange, vertical });
      if (!sight.visible) continue;
      const memory = (world.state.memories || []).find((m) => m.id === obj.memoryId);
      result.memories.push({
        memoryId: obj.memoryId,
        distance: sight.horizontal,
        elevation: obj.pos[1] - agent.pos[1],
        bearing: world.bearing(agent.pos, obj.pos),
        visible: glance(memory),
        links: obj.links.length,
      });
    }
    result.memories.sort((a, b) => a.distance - b.distance);

    // ---- landmarks, as places rather than objects
    const local = world.toLocal(agent.realmId, agent.pos);
    const worldStruct = world.worldOf(agent.realmId);
    if (local && worldStruct) {
      for (const lm of worldStruct.landmarks) {
        const global = world.toGlobal(agent.realmId, [lm.x, lm.y, lm.z]);
        const distance = world.groundDistance(agent.pos, global);
        if (distance > memoryRange) continue;
        result.landmarks.push({
          id: lm.id,
          name: lm.name,
          kind: lm.kind,
          central: !!lm.central,
          distance,
          bearing: world.bearing(agent.pos, global),
        });
      }
      result.landmarks.sort((a, b) => a.distance - b.distance);

      // ---- the ground underfoot, and the ground ahead
      const ground = world.groundAt(agent.realmId, agent.pos);
      const here = worldStruct.regionAt(local[0], local[2]);
      result.terrain = ground
        ? {
          region: here ? here.name : null,
          regionId: here ? here.id : null,
          height: ground.y - realm.floorY,
          water: ground.water,
        }
        : { region: null, regionId: null, height: null, water: false, overVoid: true };

      // what the agent faces, sampled a short way ahead, so it can tell a
      // cliff edge from an open plain without having to walk to the edge
      const ahead = [
        agent.pos[0] + Math.cos(agent.yaw) * realm.radius * 0.1,
        agent.pos[1],
        agent.pos[2] + Math.sin(agent.yaw) * realm.radius * 0.1,
      ];
      const aheadGround = world.groundAt(agent.realmId, ahead);
      result.ahead = aheadGround
        ? { solid: !aheadGround.water, rise: aheadGround.y - agent.pos[1] }
        : { solid: false, rise: null, overVoid: true };
    }

    // ---- other agents, in this realm and within sight
    const roster = options.agents || [];
    for (const other of roster) {
      if (!other || other.id === agent.id) continue;
      if (other.realmId !== agent.realmId) continue;
      const distance = world.distance(agent.pos, other.pos);
      if (distance > agentRange) continue;
      result.agents.push({
        id: other.id,
        name: other.name,
        distance,
        bearing: world.bearing(agent.pos, other.pos),
        motion: other.motion,
        // what the neighbour is doing is legible from outside it; what the
        // neighbour is thinking is not, and has to be exchanged deliberately
        lastAction: other.lastAction ? other.lastAction.name : null,
      });
    }
    result.agents.sort((a, b) => a.distance - b.distance);

    result.coverage = total ? result.memories.length / total : 0;
    return result;
  }

  /** can this agent perceive that memory right now, from where it stands? */
  canSee(agent, memoryId) {
    const seen = this.perceive(agent);
    return seen.memories.some((m) => m.memoryId === memoryId);
  }

  /** the single nearest perceived memory, or null */
  nearestMemory(agent) {
    const seen = this.perceive(agent);
    return seen.memories[0] || null;
  }

  /**
   * Is the path between two points walkable, sampled coarsely?
   * Used to decide whether `approach` is worth attempting at all, so an agent
   * does not burn a turn walking into a cliff it should have seen.
   */
  routeLooksOpen(agent, target, samples = 12, movement = null) {
    const world = this.world;
    const total = world.groundDistance(agent.pos, target);
    if (total < 1e-6) return { open: true, ratio: 1 };
    let solid = 0;
    for (let i = 1; i <= samples; i += 1) {
      const t = i / (samples + 1);
      const point = [
        agent.pos[0] + (target[0] - agent.pos[0]) * t,
        agent.pos[1],
        agent.pos[2] + (target[2] - agent.pos[2]) * t,
      ];
      const ground = world.groundAt(agent.realmId, point);
      if (ground && !ground.water) solid += 1;
      else if (movement) {
        // a road bridging a gap is walkable even though the gap is not solid,
        // so treat a modest shortfall as still open
        if (solid / samples > 0.6) break;
      }
    }
    const ratio = solid / samples;
    return { open: ratio >= 0.6, ratio };
  }
}
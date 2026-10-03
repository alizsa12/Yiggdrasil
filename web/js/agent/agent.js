// Yggdrasil · agents
//
// The agent itself, and the world that holds the agents.
//
// An agent is a body: an id, a realm, a position, a facing, a movement state, a
// perception range, and a working memory of what it has personally encountered.
// It holds no memory content of its own — `known` is a set of ids the agent has
// read or recalled, and the content behind those ids lives in the store and is
// fetched when needed. That is what keeps an agent's mind and Yggdrasil's mind
// the same mind.
//
// `AgentWorld` is the room the agents are in. It owns the layout-derived world,
// the roster, the action set, and the loop that connects perception to a
// reasoning model and back to an action. It is deliberately not a scheduler:
// one call to `step` advances one agent by one decision, which is what makes
// it testable and what lets several agents share a turn.

import { WorldState } from './world.js';
import { Movement } from './movement.js';
import { Perception } from './perception.js';
import { ActionSet } from './actions.js';
import { MemoryBridge } from './memory.js';
import { buildPacket, systemPrompt, ModelDecider } from './reasoning.js';
import { MOTION } from './movement.js';

/** how many observations an agent keeps */
const HISTORY = 24;

let counter = 0;

export class Agent {
  /**
   * @param {object} options
   * @param {WorldState} options.world
   * @param {string} [options.id]
   * @param {string} [options.name]
   * @param {string} [options.realmId]  which realm to start in
   */
  constructor(options = {}) {
    const world = options.world;
    const realmId = options.realmId || world.realmIds[0];
    counter += 1;
    this.id = options.id || `agent_${counter}`;
    this.name = options.name || this.id;
    this.world = world;
    this.realmId = realmId;

    // place the body on the ground of the realm it starts in, beside a
    // landmark, so it begins in a place rather than at an origin
    const spawn = world.spawnPoint(realmId, options.spawnIndex ?? 0);
    this.pos = spawn ? [...spawn.position] : [0, 0, 0];
    this.spawn = spawn;

    this.yaw = options.yaw ?? 0;
    this.motion = MOTION.IDLE;
    this.perceptionRange = options.perceptionRange ?? null;

    // the agent's own working memory: ids it has encountered, and a short log
    this.known = new Set();
    this.history = [];
    this.received = [];
    this.steps = 0;
    this.thoughts = [];
    this.lastAction = null;
    this.lastObservation = null;

    // what the agent is allowed to do to the shared store. Read is always on;
    // writing is the agent's own decision and is the thing permissions are for
    // when several agents share one tree.
    this.permissions = {
      read: true,
      recall: options.allowRecall !== false,
      remember: options.allowRemember ?? true,
      link: options.allowLink ?? true,
      interact: options.allowInteract ?? true,
    };
  }

  /** the effective perception radius in this realm */
  get range() {
    if (this.perceptionRange) return this.perceptionRange;
    return this.world.realm(this.realmId)?.radius * 0.62;
  }

  /** file an observation in the agent's own history */
  record(observation) {
    this.history.push(observation);
    if (this.history.length > HISTORY) this.history.splice(0, this.history.length - HISTORY);
  }

  /** what the model would be told right now */
  packet() {
    return buildPacket(this, this.world);
  }

  /** a short line for the debug view */
  describe() {
    const realm = this.world.realm(this.realmId);
    return {
      id: this.id,
      name: this.name,
      realm: realm ? realm.name : this.realmId,
      realmId: this.realmId,
      pos: this.pos.map((v) => Math.round(v * 100) / 100),
      yaw: Math.round(this.yaw * 1000) / 1000,
      motion: this.motion,
      range: Math.round(this.range * 100) / 100,
      known: this.known.size,
      steps: this.steps,
      lastAction: this.lastAction ? this.lastAction.name : null,
      lastObservation: this.lastObservation ? {
        action: this.lastObservation.action.name,
        ok: this.lastObservation.ok,
        reason: this.lastObservation.reason,
        visible: this.lastObservation.visibleCount,
        gained: this.lastObservation.perceived.gained.length,
        lost: this.lastObservation.perceived.lost.length,
      } : null,
      selectedMemoryIds: [...this.lastObservation?.perception?.memories?.slice(0, 6).map((m) => m.memoryId) || []],
      lastThought: this.thoughts.length ? this.thoughts[this.thoughts.length - 1] : null,
    };
  }
}

/**
 * The world of agents. Owns the roster, the shared world state, and the loop.
 */
export class AgentWorld {
  /**
   * @param {object} options
   * @param {object} options.layout  computeLayout() output
   * @param {object} options.state   /api/state snapshot
   * @param {MemoryBridge} [options.bridge]
   */
  constructor(options = {}) {
    this.state = options.state;
    this.layout = options.layout;
    this.world = new WorldState(options.layout, options.state);
    this.bridge = options.bridge || new MemoryBridge(options.bridgeOptions || {});
    this.movement = new Movement(this.world, options.movement || {});
    this.perception = new Perception(this.world, options.perception || {});
    this.actions = new ActionSet({
      world: this.world,
      movement: this.movement,
      perception: this.perception,
      bridge: this.bridge,
      getAgents: () => this.agents,
    });
    // the model that decides. Null until one is attached, and an agent with no
    // decider does nothing rather than being given a scripted default.
    this.decider = options.decider || null;
    this.agents = [];
    this.log = [];
    this.maxLog = options.maxLog ?? 60;
  }

  /** add an agent to the world */
  spawn(options = {}) {
    const agent = new Agent({ ...options, world: this.world });
    this.agents.push(agent);
    this.note({ kind: 'spawn', agentId: agent.id, realmId: agent.realmId });
    return agent;
  }

  remove(id) {
    const i = this.agents.findIndex((a) => a.id === id);
    if (i < 0) return false;
    this.agents.splice(i, 1);
    return true;
  }

  get(id) {
    return this.agents.find((a) => a.id === id) || null;
  }

  note(entry) {
    this.log.push({ at: this.log.length, ...entry });
    if (this.log.length > this.maxLog) this.log.splice(0, this.log.length - this.maxLog);
  }

  /** attach a reasoning model. Any object with decide(packet, system). */
  withDecider(decider) {
    this.decider = decider;
    return this;
  }

  /**
   * Advance one agent by one decision.
   *
   * The loop is: perceive -> hand the packet to the model -> run the action it
   * chose -> record what changed. Nothing in here substitutes a decision, so if
   * there is no model there is no movement, and if the model returns something
   * unusable the agent simply does not act.
   */
  async step(agent, options = {}) {
    if (!this.decider) {
      return { ok: false, reason: 'no reasoning model attached', kind: 'unconfigured' };
    }
    agent.steps += 1;
    const packet = agent.packet();
    const system = systemPrompt(this.world);

    let decision;
    try {
      decision = await this.decider.decide(packet, system);
    } catch (err) {
      const failure = {
        ok: false,
        kind: 'reasoning',
        reason: String((err && err.message) || err),
        action: { name: null, args: {} },
      };
      agent.lastAction = failure.action;
      agent.lastObservation = null;
      this.note({ kind: 'reasoning-failed', agentId: agent.id, reason: failure.reason });
      return failure;
    }

    if (!decision || !decision.action) {
      const failure = {
        ok: false,
        kind: 'reasoning',
        reason: 'the model returned no usable action',
        action: { name: null, args: {} },
      };
      this.note({ kind: 'reasoning-unusable', agentId: agent.id });
      return failure;
    }

    if (decision.thought) {
      agent.thoughts.push(decision.thought);
      if (agent.thoughts.length > HISTORY) agent.thoughts.shift();
    }

    // permissions: an agent that may not write to the shared tree is stopped
    // here rather than being allowed to try and failing deeper in
    const verb = String(decision.action).toLowerCase();
    const needsPermission = { remember: 'remember', link: 'link', recall: 'recall' }[verb];
    if (needsPermission && agent.permissions[needsPermission] === false) {
      const denial = {
        ok: false,
        kind: 'permission',
        reason: `this agent is not permitted to ${verb}`,
        action: { name: verb, args: decision.args || {} },
      };
      agent.lastAction = denial.action;
      this.note({ kind: 'permission-denied', agentId: agent.id, verb });
      return denial;
    }

    const observation = await this.actions.act(agent, decision.action, decision.args || {});
    this.note({
      kind: 'action',
      agentId: agent.id,
      action: decision.action,
      ok: observation.ok,
      reason: observation.reason,
      thought: decision.thought || null,
      moved: observation.moved,
    });
    return { ...observation, thought: decision.thought || null };
  }

  /** advance every agent once, sequentially */
  async stepAll(options = {}) {
    const out = [];
    for (const agent of this.agents) out.push(await this.step(agent, options));
    return out;
  }

  /** what the debug view renders */
  debug() {
    return {
      agents: this.agents.map((a) => a.describe()),
      realms: this.realmIds,
      decider: this.decider ? {
        kind: this.decider.constructor?.name || 'custom',
        model: this.decider.model || null,
        endpoint: this.decider.endpoint || null,
        configured: this.decider.configured !== false,
      } : { kind: 'none', configured: false },
      apiCalls: this.bridge.calls.slice(-8),
      log: this.log.slice(-12),
    };
  }
}

export { ModelDecider };
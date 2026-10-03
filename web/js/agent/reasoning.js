// Yggdrasil · agent reasoning
//
// The layer where a model decides. Its whole job is to turn what the agent can
// perceive into a packet a reasoning model can act on, and to turn the model's
// answer back into an action.
//
// The design rule that matters: **nothing in this file decides anything.** The
// prompt is built from live observation; the action comes back from whatever
// `decider` was injected. There is no fallback policy, no priority table, and no
// "if the model failed, walk toward the nearest memory instead". A model that
// always chooses to walk west is allowed to do exactly that.
//
// That means the agent is genuinely autonomous — and it also means an
// unconfigured agent cannot move at all, which is honest rather than
// convenient. `reasoning.js` builds the packet and validates the reply;
// `agent.js` holds the model connection and the loop.
//
// The packet contains exactly what a decision needs, and nothing the agent
// could not legitimately perceive:
//
//   where      the realm, the region, the position, the facing
//   nearby     memories that are in sight, with distance and bearing
//   retrieved  what this agent has already read or recalled
//   recent     its own last few observations, so it can notice what changed
//   actions    the vocabulary it may use, with a line of help for each

import { ACTIONS } from './actions.js';

/** one line per action, so the model is told the vocabulary and its meaning */
const ACTION_HELP = {
  look: 'turn on the spot and take in what is there; args {yaw} or {at: memoryId}',
  move: 'walk to a point or place; args {to: landmarkId | [x,y,z] | {x,z}}',
  approach: 'walk toward something until it is close; args {target: memoryId | landmarkId | agentId}',
  inspect: 'read a memory that is in sight; args {target: memoryId}',
  interact: 'act on something in reach; args {agent: id, message: text} or {target: memoryId}',
  remember: 'write a new memory into the shared tree; args {title, content, kind}',
  recall: 'search the shared memory graph; args {query, limit}',
  link: 'tie two known memories together; args {a: memoryId, b: memoryId, type}',
  wait: 'stay put and take stock; args {}',
};

/**
 * What an agent knows right now, shaped for a model.
 * Pure: it reads the agent and the world and returns a new object.
 */
export function buildPacket(agent, world, options = {}) {
  const realm = world.realm(agent.realmId);
  const observation = agent.lastObservation;
  const perception = observation ? observation.perception : null;

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      realm: realm ? realm.name : null,
      realmId: agent.realmId,
      // metres in realm-local terms, rounded so the numbers stay readable
      position: agent.pos.map((v) => round(v)),
      yaw: round(agent.yaw, 3),
      motion: agent.motion,
      steps: agent.steps,
      memoriesKnown: agent.known.size,
    },
    where: perception ? {
      region: perception.terrain?.region ?? null,
      perceptionRange: round(perception.perceptionRange),
      overVoid: !!perception.terrain?.overVoid,
      facing: perception.ahead || null,
    } : { region: null },

    // only what is actually in sight — this is the spatial constraint doing
    // its work, and it is why the list changes as the agent walks
    nearbyMemories: (perception?.memories || []).slice(0, 12).map((m) => ({
      memoryId: m.memoryId,
      title: m.visible?.title ?? null,
      kind: m.visible?.kind ?? null,
      importance: m.visible?.importance ?? null,
      distance: round(m.distance),
      bearing: round(m.bearing, 3),
      links: m.links,
    })),

    nearbyLandmarks: (perception?.landmarks || []).slice(0, 8).map((l) => ({
      id: l.id, name: l.name, kind: l.kind, distance: round(l.distance), bearing: round(l.bearing, 3),
    })),

    nearbyAgents: (perception?.agents || []).map((a) => ({
      id: a.id, name: a.name, distance: round(a.distance), bearing: round(a.bearing, 3), motion: a.motion,
    })),

    // memories this agent has actually read, and everything retrieval gave it
    retrieved: [...agent.known].slice(-10).map((id) => {
      const obj = world.memoryObject(id);
      return {
        memoryId: id,
        title: obj ? (world.state.memories || []).find((m) => m.id === id)?.title ?? null : null,
        inThisRealm: obj ? obj.realmId === agent.realmId : false,
      };
    }),

    // what just happened, in the agent's own words — this is how it notices
    // that an approach brought a memory into range
    recentObservations: agent.history.slice(-(options.recent ?? 6)).map((o) => ({
      action: o.action.name,
      args: o.action.args,
      ok: o.ok,
      reason: o.reason,
      moved: round(o.moved),
      gained: o.perceived.gained.map((g) => g.memoryId),
      lost: o.perceived.lost.map((l) => l.memoryId),
      result: summarizeResult(o),
    })),

    availableActions: ACTIONS,
    actionHelp: ACTION_HELP,
  };
}

function round(v, digits = 2) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

/** a compact form of an action's result, so history stays small in a prompt */
function summarizeResult(observation) {
  const r = observation.result;
  if (!r) return null;
  if (observation.kind === 'inspect' && r.memory) {
    return { memoryId: r.memory.id, title: r.memory.title, links: (r.links || []).length };
  }
  if (observation.kind === 'recall') return { query: r.query, count: r.count, ids: (r.results || []).map((x) => x.memoryId) };
  if (observation.kind === 'move' || observation.kind === 'approach') {
    return { target: r.target, steps: r.steps, distance: round(r.distance ?? r.distanceLeft) };
  }
  if (observation.kind === 'remember') return { memoryId: r.memoryId, title: r.title };
  if (observation.kind === 'link') return { a: r.a, b: r.b };
  if (observation.kind === 'interact') return r;
  if (observation.kind === 'look') return { nearestMemory: r.nearestMemory?.memoryId ?? null };
  return r;
}

/** the system prompt: what kind of creature this is, and what it may do */
export function systemPrompt(world) {
  const realms = world.realmIds.map((id) => world.realm(id)?.name).filter(Boolean);
  return [
    'You are an agent walking through Yggdrasil, the world tree of memory.',
    '',
    'You are a body in a place, not a query interface. You can only perceive what is',
    'within your perception range, and you can only read a memory you have walked up to.',
    'Moving takes time and may be blocked by terrain. There is no teleport.',
    '',
    `Realms in this world: ${realms.join(', ')}.`,
    '',
    'Reply with JSON only, in exactly this shape:',
    '{"thought": "one sentence of reasoning", "action": "<name>", "args": { ... }}',
    '',
    'Choose the action yourself. There is no default and no correct answer: if nothing',
    'is worth doing, wait; if a memory is in sight and matters, approach and inspect it.',
  ].join('\n');
}

/** the user message: the live packet, rendered as compact JSON */
export function userPrompt(packet) {
  return [
    'Here is what you can perceive right now:',
    '',
    JSON.stringify(packet, null, 1),
    '',
    'What is your next single action?',
  ].join('\n');
}

/**
 * A decider backed by any OpenAI-compatible chat endpoint.
 *
 * This is the reasoning model the world was built for. It is a plain HTTP call
 * with a JSON response, so anything that speaks that shape works — a local
 * server, a hosted model, or a model running on the same machine as the agent.
 */
export class ModelDecider {
  /**
   * @param {object} options
   * @param {string} options.endpoint  e.g. 'http://localhost:11434/v1/chat/completions'
   * @param {string} [options.model]
   * @param {string} [options.apiKey]
   * @param {Function} [options.fetchImpl]
   * @param {number} [options.temperature]
   */
  constructor(options = {}) {
    this.endpoint = options.endpoint || '';
    this.model = options.model || '';
    this.apiKey = options.apiKey || '';
    this.fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
    this.temperature = options.temperature ?? 0.7;
    this.maxTokens = options.maxTokens ?? 400;
    // what the model was last asked and answered, for the debug view
    this.lastExchange = null;
  }

  get configured() {
    return !!this.endpoint && !!this.model;
  }

  /** ask the model; returns {thought, action, args} */
  async decide(packet, system) {
    if (!this.configured) {
      throw new Error('no reasoning model configured: ModelDecider needs endpoint and model');
    }
    const body = {
      model: this.model,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt(packet) },
      ],
    };
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await this.fetchImpl(this.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`model endpoint ${res.status} ${res.statusText}`);
    const data = await res.json();
    const text = extractText(data);
    const parsed = parseDecision(text);
    this.lastExchange = { at: Date.now(), packet, raw: text, parsed };
    return parsed;
  }
}

/** pull the assistant text out of a chat-completions style response */
export function extractText(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  const choice = data.choices?.[0];
  const message = choice?.message?.content ?? choice?.text ?? choice?.delta?.content;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) {
    return message.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  return '';
}

/**
 * Read a decision out of whatever the model sent back.
 *
 * Models wrap JSON in prose and fences no matter how firmly they are told not
 * to, so this finds the first balanced object in the text rather than
 * demanding a clean response. If the model returns something unusable the
 * caller gets `null` and the agent does nothing — it does not get a
 * substitute action invented on its behalf.
 */
export function parseDecision(text) {
  if (!text) return null;
  let raw = String(text).trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const candidate = extractJsonObject(raw);
  if (!candidate) return null;
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  const action = typeof parsed.action === 'string' ? parsed.action.trim() : '';
  if (!action) return null;
  const args = parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args) ? parsed.args : {};
  return {
    thought: typeof parsed.thought === 'string' ? parsed.thought : null,
    action,
    args,
  };
}

/** the first balanced {...} in a string, respecting strings and escapes */
function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
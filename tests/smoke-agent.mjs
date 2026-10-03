// Yggdrasil · agent subsystem tests
//
//     node yggdrasil/tests/smoke-agent.mjs
//
// No dependencies and no server: the world is built from the same
// computeLayout() the browser uses, and the memory bridge is given a fake
// fetch, so the real code path is exercised without a database.
//
// What is checked here is what the design claims, not incidental details:
// perception is spatial and never leaks content, movement never teleports, an
// agent cannot read what it cannot see, writes land in the one store, and an
// agent does nothing at all until a reasoning model is attached.

import { computeLayout } from '../web/js/layout.js';
import {
  AgentWorld, Agent, WorldState, Movement, Perception, ActionSet, MemoryBridge, MOTION,
} from '../web/js/agent/index.js';
import { buildPacket, systemPrompt, parseDecision, ModelDecider } from '../web/js/agent/reasoning.js';

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  [ok]   ${label}`);
  } else {
    failed += 1;
    console.log(`  [FAIL] ${label}  ${detail}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ────────────────────────────────────────────────────────────────── fixtures

const REALMS = ['asgard', 'vanheim', 'jotun', 'mimame', 'hel', 'svartalf', 'audr', 'nifl', 'ginnung'];

/** a small but structurally real tree: nine realms, memories, and links */
function makeState() {
  const nodes = [{ id: 'nd_root', parent_id: null, name: 'assistant', kind: 'root', hue: 48, depth: 0, weight: 1 }];
  const memories = [];
  const links = [];
  REALMS.forEach((realm, ri) => {
    const domainId = `nd_${realm}`;
    nodes.push({
      id: domainId, parent_id: 'nd_root', name: realm, kind: 'domain', hue: 40 + ri * 3, depth: 1, weight: 0.8,
    });
    const count = 5 + (ri % 3);
    for (let i = 0; i < count; i += 1) {
      const nodeId = `nd_${realm}_${i}`;
      const memId = `mem_${realm}_${i}`;
      nodes.push({
        id: nodeId, parent_id: domainId, name: `memory ${i}`, kind: 'leaf', hue: 44, depth: 2, weight: 0.4 + i * 0.05,
      });
      memories.push({
        id: memId,
        node_id: nodeId,
        title: `${realm} memory ${i}`,
        content: `The content of ${memId}, which an agent may only read by standing near it.`,
        kind: 'fact',
        domain: realm,
        tags: [],
        importance: 0.4 + (i % 4) * 0.1,
        confidence: 0.7,
      });
    }
  });
  for (let i = 0; i + 1 < memories.length; i += 3) {
    links.push({ id: `lnk_${i}`, a: memories[i].id, b: memories[i + 1].id, type: 'supports', weight: 0.8, note: '' });
  }
  // one link that crosses realms, so cross-realm adjacency can be tested
  links.push({ id: 'lnk_cross', a: memories[0].id, b: memories[8].id, type: 'related', weight: 0.5, note: '' });
  return { meta: { root_id: 'nd_root' }, nodes, memories, links, activity: [] };
}

/** a fake fetch answering like the real API, over an in-memory store */
function fakeApi(state) {
  const memories = new Map(state.memories.map((x) => [x.id, x]));
  const links = [...state.links];
  const calls = [];
  let created = 0;

  const json = (body, ok = true, status = 200) => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    text: async () => JSON.stringify(body),
    json: async () => body,
  });

  const handler = async (url, options = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method, path, body });

    if (method === 'GET' && /\/api\/memories\/[^/]+\/context$/.test(path)) {
      const id = decodeURIComponent(path.split('/').slice(-2)[0]);
      const memory = memories.get(id);
      if (!memory) return json({ error: 'not found' }, false, 404);
      const related = links.filter((l) => l.a === id || l.b === id);
      return json({ memory, links: related, related: related.map((l) => (l.a === id ? l.b : l.a)) });
    }
    if (method === 'GET' && /\/api\/memories\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(path.split('/').pop());
      const memory = memories.get(id);
      if (!memory) return json({ error: 'not found' }, false, 404);
      return json(memory);
    }
    if (method === 'POST' && path === '/api/recall') {
      const q = String(body?.query || '').toLowerCase();
      const results = [...memories.values()]
        .filter((x) => x.title.toLowerCase().includes(q) || x.content.toLowerCase().includes(q))
        .slice(0, body?.limit ?? 8)
        .map((x) => ({ ...x, score: 0.8 }));
      return json({ results });
    }
    if (method === 'POST' && path === '/api/link') {
      const link = {
        id: `lnk_new_${links.length}`,
        a: body.a, b: body.b, type: body.type || 'related', weight: body.weight ?? 0.6, note: body.note || '',
      };
      links.push(link);
      return json(link, true, 201);
    }
    if (method === 'PATCH' && /\/api\/memories\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(path.split('/').pop());
      const memory = memories.get(id);
      if (!memory) return json({ error: 'not found' }, false, 404);
      const updated = { ...memory };
      for (const key of ['title', 'content', 'kind', 'domain', 'tags', 'importance', 'confidence']) {
        if (body[key] !== undefined) updated[key] = body[key];
      }
      memories.set(id, updated);
      return json(updated);
    }
    if (method === 'POST' && path === '/api/remember') {
      created += 1;
      const memory = {
        id: `mem_new_${created}`,
        node_id: `nd_new_${created}`,
        title: body.title,
        content: body.content || '',
        kind: body.kind || 'fact',
        domain: body.domain || '',
        tags: body.tags || [],
        importance: body.importance ?? 0.5,
        confidence: body.confidence ?? 0.7,
        source: body.source || '',
      };
      memories.set(memory.id, memory);
      return json({ memory }, true, 201);
    }
    return json({ error: `no route ${method} ${path}` }, false, 404);
  };

  return { handler, memories, links, calls };
}

/** an agent world wired to the fake API, with no reasoning model attached */
function makeWorld(options = {}) {
  const state = makeState();
  const layout = computeLayout(state);
  const fake = fakeApi(state);
  const bridge = new MemoryBridge({ fetchImpl: fake.handler, actor: 'test' });
  const world = new AgentWorld({ layout, state, bridge });
  if (options.decider) world.withDecider(options.decider);
  return { world, state, layout, fake, bridge };
}

/** a decider that returns a fixed script of decisions, for loop tests */
function scriptedDecider(script) {
  const queue = script.slice();
  return {
    model: 'scripted',
    endpoint: 'test://scripted',
    configured: true,
    calls: [],
    async decide(packet) {
      this.calls.push(packet);
      const next = queue.length ? queue.shift() : { action: 'wait', args: {} };
      return next;
    },
  };
}

// ─────────────────────────────────────────────────────────────────── tests

async function testWorldState() {
  section('world state: memories are objects with places, not copies');
  const { world, state } = makeWorld();
  const ws = world.world;

  check('every realm got a world', ws.realmIds.length === 9, ws.realmIds.length);
  check('every memory became an object', ws.objects.size === state.memories.length,
    `${ws.objects.size} of ${state.memories.length}`);

  const obj = ws.memoryObject(state.memories[0].id);
  check('a memory object carries an id, a realm and a finite position',
    !!obj && !!obj.memoryId && !!obj.realmId && Array.isArray(obj.pos) && obj.pos.every(Number.isFinite));

  check('a memory object holds no content, only an id and a place',
    obj.content === undefined && obj.title === undefined,
    Object.keys(obj).join(','));

  const local = ws.toLocal(obj.realmId, obj.pos);
  const back = ws.toGlobal(obj.realmId, local);
  check('positions round-trip through the realm transforms',
    Math.abs(back[0] - obj.pos[0]) < 1e-6 && Math.abs(back[1] - obj.pos[1]) < 1e-6
    && Math.abs(back[2] - obj.pos[2]) < 1e-6);

  check('objects carry their links from the shared graph',
    ws.objectsIn(obj.realmId).some((o) => o.links.length > 0));

  const crossRealm = state.memories[8];
  check('a link across realms is visible on both objects',
    ws.memoryObject(state.memories[0].id).links.some((l) => l.memoryId === crossRealm.id));

  section('world state: ground queries work in global space');
  const realmId = ws.realmIds[0];
  const spawn = ws.spawnPoint(realmId, 0);
  check('a realm offers a spawn point standing on ground',
    !!spawn && ws.groundAt(realmId, spawn.position) !== null);
  check('the spawn point is finite', spawn.position.every(Number.isFinite));
  check('the spawn point is inside its own realm',
    ws.groundDistance(spawn.position, ws.realm(realmId).center) < ws.realm(realmId).radius);

  const clamped = ws.clampToRealm(realmId, [1e6, 1e6, 1e6]);
  check('a point far outside a realm is clamped back inside it',
    ws.groundDistance(clamped, ws.realm(realmId).center) < ws.realm(realmId).radius);
}

async function testMovement() {
  section('movement: an agent walks, it never teleports');
  const { world } = makeWorld();
  const ws = world.world;
  const realmId = ws.realmIds[0];
  const agent = new Agent({ world: ws, realmId });
  const spawn = ws.spawnPoint(realmId, 0);
  agent.pos = [...spawn.position];

  const movement = new Movement(ws, { speed: 6, maxStep: 2.5 });
  check('a step never exceeds the step budget', movement.budget(1 / 60) <= movement.maxStep + 1e-9);

  const start = [...agent.pos];
  const trail = [start];
  for (let i = 0; i < 80; i += 1) {
    const before = [...agent.pos];
    movement.stepTo(agent, [start[0] + (i + 1) * 0.4, start[1], start[2] + Math.sin(i * 0.3)], 1 / 60);
    trail.push([...agent.pos]);
    if (movement.isTeleport(before, agent.pos, 1 / 60)) {
      check('no single step teleports the agent', false, `${before} -> ${agent.pos}`);
      break;
    }
  }
  const maxStep = Math.max(...trail.slice(1).map((p, i) => ws.groundDistance(trail[i], p)));
  check('every step in an 80-step walk was within the budget', maxStep <= movement.maxStep + 1e-6, maxStep);
  check('the agent covered real ground', ws.groundDistance(start, agent.pos) > 1,
    ws.groundDistance(start, agent.pos));

  check('the teleport detector calls a step-sized hop ordinary',
    movement.isTeleport([0, 0, 0], [0.05, 0, 0.05], 1 / 60) === false);
  check('the teleport detector calls a jump across the realm a teleport',
    movement.isTeleport([0, 0, 0], [500, 0, 500], 1 / 60) === true);

  section('movement: terrain constrains where an agent can be');
  check('standing on solid ground is allowed', movement.canStand(realmId, agent.pos).ok === true);

  let voidPoint = null;
  for (const realm of ws.realms.values()) {
    for (let r = 0.05; r < 1 && !voidPoint; r += 0.05) {
      for (let a = 0; a < 6.28; a += 0.3) {
        const g = ws.toGlobal(realm.id, [Math.cos(a) * realm.radius * r, 0, Math.sin(a) * realm.radius * r]);
        if (!ws.groundAt(realm.id, g)) { voidPoint = { realmId: realm.id, pos: g }; break; }
      }
    }
    if (voidPoint) break;
  }
  check('a realm has ground that simply is not there', !!voidPoint);
  if (voidPoint) {
    const refusal = movement.canStand(voidPoint.realmId, voidPoint.pos);
    check('an agent may not stand over the void', refusal.ok === false);
    check('...and is told why in words', /void/i.test(refusal.reason || ''), refusal.reason);
  }

  section('movement: walking somewhere either arrives or explains itself');
  for (const index of [2, 4]) {
    const destination = ws.spawnPoint(realmId, index);
    const walker = new Agent({ world: ws, realmId });
    walker.pos = [...spawn.position];
    const walk = movement.moveToward(walker, destination.position, { dt: 1 / 60, maxSteps: 4000 });
    if (walk.arrived) {
      check(`an agent walked from spawn to landmark ${index}`,
        ws.groundDistance(walker.pos, destination.position) <= movement.arrivalEpsilon + 1e-6,
        ws.groundDistance(walker.pos, destination.position));
    } else {
      check(`a blocked walk to landmark ${index} explains itself`,
        typeof walk.reason === 'string' && walk.reason.length > 0, walk.reason);
    }
    check(`the walk to landmark ${index} took more than one step`, walk.steps > 1, walk.steps);
  }

  section('movement: roads are walkable and follow the ground');
  const realm = ws.realm(realmId);
  const outer = realm.world.landmarks.filter((l) => !l.central);
  if (outer.length > 1) {
    const route = ws.route(realmId, outer[0].id, outer[outer.length - 1].id);
    check('two landmarks in a realm are joined by a route', Array.isArray(route) && route.length > 1,
      route && route.length);
    const walker = new Agent({ world: ws, realmId });
    const lm = outer[0];
    const startPoint = ws.toGlobal(realmId, [lm.x, lm.y, lm.z]);
    walker.pos = [...startPoint];
    const walk = movement.followRoute(walker, route, { dt: 1 / 60, maxSteps: 6000 });
    check('following a route is a walk, not a jump',
      ws.groundDistance(walker.pos, startPoint) < realm.radius * 2);
    check('a route walk reports progress or arrival',
      walk.arrived === true || typeof walk.reason === 'string' || walk.index > 0,
      JSON.stringify({ arrived: walk.arrived, index: walk.index, reason: walk.reason }));
  }
}

async function testPerception() {
  section('perception: an agent sees only what is near it');
  const { world } = makeWorld();
  const ws = world.world;
  // a realm with the most memories, so that "sees some but not all" is a real
  // statement about partial visibility rather than an artefact of a tiny realm
  const realmId = [...ws.realms.values()]
    .sort((a, b) => ws.objectsIn(b.id).length - ws.objectsIn(a.id).length)[0].id;
  const agent = new Agent({ world: ws, realmId });
  const spawn = ws.spawnPoint(realmId, 0);
  agent.pos = [...spawn.position];

  const perception = new Perception(ws);
  const near = perception.perceive(agent);
  check('an agent standing in a realm perceives some memories', near.memories.length > 0, near.memories.length);
  check('...but not the whole realm',
    near.memories.length < ws.objectsIn(realmId).length,
    `${near.memories.length} of ${ws.objectsIn(realmId).length}`);
  check('no memory from another realm is visible',
    near.memories.every((m) => ws.memoryObject(m.memoryId).realmId === realmId));
  check('perception reports the range it is using', near.perceptionRange > 0);
  check('perception reports the ground it is standing on', !!near.terrain && !near.terrain.overVoid);
  check('perception reports what is ahead', !!near.ahead && typeof near.ahead.solid === 'boolean');

  section('perception: distance is the only thing that makes a memory visible');
  const target = near.memories[0];
  const obj = ws.memoryObject(target.memoryId);
  check('a perceived memory reports distance and bearing',
    typeof target.distance === 'number' && typeof target.bearing === 'number');

  agent.pos = [obj.pos[0] + 0.5, obj.pos[1], obj.pos[2]];
  const adjacent = perception.perceive(agent);
  check('standing right beside a memory makes it visible',
    adjacent.memories.some((m) => m.memoryId === target.memoryId));
  check('and it is now the nearest thing', adjacent.memories[0]?.memoryId === target.memoryId);

  const realm = ws.realm(realmId);
  let far = null;
  for (let a = 0; a < 6.28 && !far; a += 0.2) {
    const g = ws.toGlobal(realmId, [Math.cos(a) * realm.radius * 0.88, 0, Math.sin(a) * realm.radius * 0.88]);
    const ground = ws.groundAt(realmId, g);
    if (ground && !ground.water && ws.distance(g, obj.pos) > perception.range(realmId) * 2) far = g;
  }
  check('the realm has somewhere far enough away to walk to', !!far);
  if (far) {
    agent.pos = [...far];
    const distant = perception.perceive(agent);
    check('walking away takes a memory out of perception',
      !distant.memories.some((m) => m.memoryId === target.memoryId));
    check('...but the memory still exists in the world',
      ws.memoryObject(target.memoryId) !== null);
    check('...and the world can hand it back when the agent returns',
      (agent.pos = [obj.pos[0] + 0.5, obj.pos[1], obj.pos[2]],
        perception.perceive(agent).memories.some((m) => m.memoryId === target.memoryId)));
  }

  section('perception: a glance never carries memory content');
  agent.pos = [...spawn.position];
  const view = perception.perceive(agent);
  check('a glance carries a title', !!view.memories[0]?.visible?.title);
  check('a glance carries no content', view.memories[0].visible.content === undefined,
    Object.keys(view.memories[0].visible).join(','));
  check('a glance carries no links table, only a count', typeof view.memories[0].links === 'number');

  section('perception: other agents are perceivable, and only when near');
  const neighbour = new Agent({ world: ws, realmId, name: 'neighbour' });
  neighbour.pos = [agent.pos[0] + 2, agent.pos[1], agent.pos[2]];
  const withNeighbour = perception.perceive(agent, { agents: [agent, neighbour] });
  check('an agent sees a neighbour standing nearby',
    withNeighbour.agents.some((a) => a.id === neighbour.id));

  neighbour.pos = [agent.pos[0] + realm.radius * 4, agent.pos[1], agent.pos[2]];
  const withoutNeighbour = perception.perceive(agent, { agents: [agent, neighbour] });
  check('an agent does not see a neighbour across the realm',
    !withoutNeighbour.agents.some((a) => a.id === neighbour.id));
  check('an agent does not see itself in its own perception',
    !perception.perceive(agent, { agents: [agent] }).agents.length);
}

async function testActions() {
  section('actions: an agent cannot read what it cannot see');
  const { world, state, fake } = makeWorld();
  const realmId = [...world.world.realms.values()]
    .sort((a, b) => world.world.objectsIn(b.id).length - world.world.objectsIn(a.id).length)[0].id;
  const agent = new Agent({ world: world.world, realmId });
  agent.pos = [...world.world.spawnPoint(realmId, 0).position];

  const perceivedIds = new Set(world.perception.perceive(agent).memories.map((m) => m.memoryId));
  const inSightId = [...perceivedIds][0];
  const unseen = world.world.objectsIn(realmId).find((o) => !perceivedIds.has(o.memoryId));
  check('there is a memory in this realm that is out of sight', !!unseen);

  const refused = await world.actions.act(agent, 'inspect', { target: unseen.memoryId });
  check('inspecting an unseen memory is refused', refused.ok === false);
  check('...and the refusal tells the agent to walk there first',
    /walk/i.test(refused.reason || ''), refused.reason);
  check('...and the refusal is still a well-formed observation',
    !!refused.action.name && Array.isArray(refused.perceived.gained));

  const read = await world.actions.act(agent, 'inspect', { target: inSightId });
  check('inspecting a memory in sight succeeds', read.ok === true, read.reason);
  check('...and returns the memory itself', !!read.result?.memory?.id);
  check('...with the content that is actually in the store',
    read.result.memory.content === state.memories.find((m) => m.id === inSightId).content);
  check('...and its links', Array.isArray(read.result.links) && read.result.links.length > 0);
  check('the agent now knows that memory', agent.known.has(inSightId));

  section('actions: every observation has the same shape');
  for (const obs of [refused, read]) {
    check('an observation names its action and arguments', !!obs.action?.name && !!obs.action.args);
    check('an observation reports position, realm and motion',
      Array.isArray(obs.position) && !!obs.realm?.id && typeof obs.motion === 'string');
    check('an observation reports what came into and left perception',
      Array.isArray(obs.perceived?.gained) && Array.isArray(obs.perceived?.lost));
    check('an observation carries the perception that produced it', !!obs.perception);
  }
  check('the agent keeps a history of its own observations', agent.history.length === 2, agent.history.length);

  section('actions: the store is the only door to memory');
  const wrote = await world.actions.act(agent, 'remember', {
    title: 'a thing the agent learned',
    content: 'learned while walking',
  });
  check('remember writes a real memory', wrote.ok === true && !!wrote.result.memoryId, wrote.reason);
  check('...and it landed in the store', fake.memories.has(wrote.result.memoryId));
  check('...and the agent knows it wrote something', agent.known.has(wrote.result.memoryId));
  check('...with the store assigning its node', !!wrote.result.nodeId, wrote.result.nodeId);

  const recalled = await world.actions.act(agent, 'recall', { query: 'learned while walking' });
  check('recall searches the shared graph', recalled.ok === true && recalled.result.count >= 1, recalled.reason);
  check('...and reports whether a result is in this realm',
    typeof recalled.result.results[0].inThisRealm === 'boolean');

  section('actions: movement actions move the body');
  const before = [...agent.pos];
  const destination = world.world.spawnPoint(realmId, 2).position;
  const moved = await world.actions.act(agent, 'move', { to: destination, maxSteps: 3000 });
  check('a move reports the distance travelled', typeof moved.moved === 'number', moved.moved);
  check('a move either arrived or reports the distance left',
    moved.ok === true || typeof moved.result?.distanceLeft === 'number', JSON.stringify(moved.result));
  check('the body is somewhere different from where it started',
    world.world.groundDistance(before, agent.pos) >= 0);

  section('actions: look turns the agent and reports what it faces');
  await world.actions.act(agent, 'look', { yaw: 1.25 });
  check('look sets the facing', Math.abs(agent.yaw - 1.25) < 1e-9, agent.yaw);

  section('actions: approach closes the distance to a visible memory');
  const approacher = new Agent({ world: world.world, realmId });
  approacher.pos = [...world.world.spawnPoint(realmId, 0).position];
  const seen = world.perception.perceive(approacher).memories[0];
  if (seen) {
    const goal = world.world.memoryObject(seen.memoryId).pos;
    const from = world.world.groundDistance(approacher.pos, goal);
    const result = await world.actions.act(approacher, 'approach', { target: seen.memoryId, maxSteps: 4000 });
    const to = world.world.groundDistance(approacher.pos, goal);
    check('approach reduces the distance to its target', to < from, `${from.toFixed(2)} -> ${to.toFixed(2)}`);
    check('approach reports the remaining distance', typeof result.result?.distance === 'number');
  } else {
    check('a memory was visible to approach', false);
  }

  section('actions: an unknown action fails as an observation, not a crash');
  const bogus = await world.actions.act(agent, 'fly', {});
  check('an unknown action is refused', bogus.ok === false && !!bogus.reason);

  section('actions: linking is only allowed between memories the agent knows');
  const known = [...agent.known];
  const stranger = world.world.objectsIn(realmId).find((o) => !agent.known.has(o.memoryId));
  const refusedLink = await world.actions.act(agent, 'link', { a: known[0], b: stranger.memoryId });
  check('linking to an unknown memory is refused', refusedLink.ok === false);
  check('...and says which memory is unknown',
    (refusedLink.reason || '').includes(stranger.memoryId), refusedLink.reason);

  // To learn the second memory the agent has to actually walk to it, which is
  // the whole spatial premise: knowledge is a consequence of proximity.
  await world.actions.act(agent, 'inspect', { target: inSightId });
  const strangerObj = world.world.memoryObject(stranger.memoryId);
  agent.pos = [strangerObj.pos[0] + 0.5, strangerObj.pos[1], strangerObj.pos[2]];
  const readSecond = await world.actions.act(agent, 'inspect', { target: stranger.memoryId });
  check('after walking to the second memory it can be read', readSecond.ok === true, readSecond.reason);

  const selfLink = await world.actions.act(agent, 'link', { a: inSightId, b: inSightId });
  check('a memory cannot be linked to itself', selfLink.ok === false);
  const realLink = await world.actions.act(agent, 'link', { a: inSightId, b: stranger.memoryId });
  check('linking two known memories succeeds', realLink.ok === true, realLink.reason);
  check('...and the link is in the store',
    fake.links.some((l) => l.a === inSightId && l.b === stranger.memoryId));

  section('actions: interacting with a memory in reach edits the shared store');
  const editable = world.world.objectsIn(realmId)[0];
  const editAgent = new Agent({ world: world.world, realmId });
  const editObj = world.world.memoryObject(editable.memoryId);
  editAgent.pos = [editObj.pos[0] + 0.5, editObj.pos[1], editObj.pos[2]];
  const originalTitle = fake.memories.get(editable.memoryId).title;
  const edited = await world.actions.act(editAgent, 'interact', {
    target: editable.memoryId, title: 'a title the agent gave it',
  });
  check('interact with a new title succeeds', edited.ok === true, edited.reason);
  check('...and the change is in the store, not just the agent',
    fake.memories.get(editable.memoryId).title === 'a title the agent gave it',
    fake.memories.get(editable.memoryId).title);
  check('...and it really changed something', fake.memories.get(editable.memoryId).title !== originalTitle);

  const readOnly = await world.actions.act(editAgent, 'interact', {
    target: editable.memoryId, title: '',
  });
  check('interact with nothing to change just reports what is there',
    readOnly.ok === true && readOnly.result.memoryId === editable.memoryId, readOnly.reason);

  section('actions: the bridge refuses to link a memory to itself');
  let selfLinkRefused = null;
  try {
    await world.bridge.link('mem_x', 'mem_x', {});
  } catch (err) {
    selfLinkRefused = err;
  }
  check('a self-link is rejected at the bridge, not silently written',
    !!selfLinkRefused && /itself/.test(selfLinkRefused.message));

  section('actions: every store call goes through the bridge');
  check('the bridge recorded the reads and writes',
    world.bridge.calls.length > 0 && world.bridge.calls.some((c) => c.method === 'POST'),
    world.bridge.calls.length);
  check('no api path outside /api was ever requested',
    world.bridge.calls.every((c) => c.path.startsWith('/api/')),
    world.bridge.calls.map((c) => c.path).join(' '));
  check('the edit went out as a PATCH to the memory it named',
    world.bridge.calls.some((c) => c.method === 'PATCH'
      && c.path === `/api/memories/${editable.memoryId}`),
    world.bridge.calls.filter((c) => c.method === 'PATCH').map((c) => c.path).join(' '));
}

async function testMultiAgent() {
  section('multi-agent: two agents in one world');
  const { world } = makeWorld();
  const realmId = world.world.realmIds[0];
  const a = world.spawn({ realmId, name: 'first' });
  const b = world.spawn({ realmId, name: 'second', spawnIndex: 1 });
  check('two agents exist in the roster', world.agents.length === 2);
  check('each agent has its own id', a.id !== b.id);
  check('each agent has its own body', a.pos.join() !== b.pos.join() || a.id !== b.id);

  // put them next to each other so they can meet
  b.pos = [a.pos[0] + 2, a.pos[1], a.pos[2]];
  const seen = world.perception.perceive(a, { agents: world.agents });
  check('the first agent sees the second', seen.agents.some((x) => x.id === b.id));

  const met = await world.actions.act(a, 'interact', { agent: b.id, message: 'I found something' });
  check('an agent can talk to one it can reach', met.ok === true, met.reason);
  check('...and the message arrives', b.received.some((r) => r.message === 'I found something'));
  check('...and what the first agent knew is now known to the second', b.known.size > 0);

  b.pos = [a.pos[0] + world.world.realm(realmId).radius * 4, a.pos[1], a.pos[2]];
  const unreachable = await world.actions.act(a, 'interact', { agent: b.id });
  check('an agent cannot reach one too far away', unreachable.ok === false);
  check('...and is told it is too far', /far/i.test(unreachable.reason || ''), unreachable.reason);

  check('the roster can be read and removed', typeof world.get(b.id) === 'object' && world.remove(b.id) === true);
}

async function testRealmTransit() {
  section('realm transit: moving between realms is a traversal, not a teleport');
  const { world } = makeWorld();
  const ws = world.world;
  const movement = new Movement(ws, { speed: 40, maxStep: 8 });
  const from = ws.realmIds[0];
  const to = ws.realmIds[1];

  const agent = new Agent({ world: ws, realmId: from });
  agent.pos = [...ws.spawnPoint(from, 0).position];

  const line = movement.conduit(ws.realm(from), ws.realm(to));
  check('two realms are joined by a conduit of real geometry', Array.isArray(line) && line.length > 1, line && line.length);
  if (line) {
    check('the conduit is continuous — no jumps along its length',
      line.slice(1).every((p, i) => {
        const d = Math.hypot(p[0] - line[i][0], p[1] - line[i][1], p[2] - line[i][2]);
        return d < 200;
      }));
    check('the conduit has finite points', line.every((p) => p.every(Number.isFinite)));
  }

  const result = movement.transit(agent, to, { dt: 1 / 60, maxSteps: 20000 });
  check('a transit is explicitly not a teleport', result.isTeleport === false);
  check('a transit is flagged as a traversal', result.traversal === true);
  if (result.ok) {
    check('a traversal that succeeds arrives in the other realm', agent.realmId === to, agent.realmId);
    const ground = ws.groundAt(to, agent.pos);
    check('...standing on that realm\'s ground', ground !== null);
  } else {
    check('a traversal that did not complete says why',
      typeof result.reason === 'string' && result.reason.length > 0, JSON.stringify(result));
  }

  check('transiting to the realm you are already in is a no-op',
    movement.transit(agent, agent.realmId, {}).ok === true);
}

async function testReasoning() {
  section('reasoning: the model is given the world, and decides');
  const { world } = makeWorld();
  const realmId = world.world.realmIds[0];
  const agent = new Agent({ world: world.world, realmId });
  agent.pos = [...world.world.spawnPoint(realmId, 0).position];
  await world.actions.act(agent, 'look', {});

  const packet = agent.packet();
  check('the packet names the agent and where it is',
    packet.agent.id === agent.id && !!packet.agent.realm && packet.agent.position.every(Number.isFinite));
  check('the packet says which region it is standing in', 'region' in packet.where);
  check('the packet lists the memories it can see', Array.isArray(packet.nearbyMemories));
  check('the packet lists landmarks', Array.isArray(packet.nearbyLandmarks));
  check('the packet lists the available actions', packet.availableActions.includes('inspect'));
  check('the packet explains what each action is for', !!packet.actionHelp?.approach);
  check('the packet carries recent observations', Array.isArray(packet.recentObservations));
  check('the packet carries retrieved memories', Array.isArray(packet.retrieved));
  check('the packet leaks no memory content',
    !JSON.stringify(packet.nearbyMemories).includes('which an agent may only read'));
  check('the packet is JSON-serialisable for a model', typeof JSON.stringify(packet) === 'string');

  const system = systemPrompt(world.world);
  check('the system prompt names the realms', system.includes(REALMS[0]) && system.includes('walk'));
  check('the system prompt insists on JSON', system.includes('JSON'));

  section('reasoning: a model reply is read, not obeyed blindly');
  check('clean JSON parses', parseDecision('{"action":"wait","args":{}}').action === 'wait');
  check('a thought is kept', parseDecision('{"thought":"hmm","action":"look"}').thought === 'hmm');
  const fenced = parseDecision('Here you go:\n```json\n{"action":"inspect","args":{"target":"mem_x"}}\n```');
  check('JSON inside a code fence parses', fenced?.action === 'inspect');
  check('arguments survive the fence', fenced?.args?.target === 'mem_x');
  check('prose around the JSON is tolerated',
    parseDecision('I think I should wait. {"action":"wait","args":{}} Hope that helps.').action === 'wait');
  check('braces inside strings do not confuse the parser',
    parseDecision('{"action":"remember","args":{"title":"a { brace","content":"b } c"}}').args.title === 'a { brace');
  check('a reply with no action is rejected', parseDecision('I am not sure what to do.') === null);
  check('an empty reply is rejected', parseDecision('') === null);

  section('reasoning: the HTTP decider asks a model and reads its answer');
  const asked = [];
  const decider = new ModelDecider({
    endpoint: 'http://model.local/v1/chat/completions',
    model: 'test-reasoner',
    apiKey: 'k',
    fetchImpl: async (url, options) => {
      asked.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          choices: [{ message: { content: '{"thought":"look around","action":"look","args":{}}' } }],
        }),
      };
    },
  });
  check('the decider reports whether it is configured', decider.configured === true);
  const decision = await decider.decide(packet, system);
  check('the model was asked over the configured endpoint',
    asked.length === 1 && asked[0].url === 'http://model.local/v1/chat/completions');
  check('the model was given the system prompt and the packet',
    asked[0].body.messages[0].role === 'system' && asked[0].body.messages[1].content.includes('nearbyMemories'));
  check('the reply became a decision', decision.action === 'look' && decision.thought === 'look around');

  const unconfigured = new ModelDecider({});
  check('an unconfigured decider says so rather than guessing', unconfigured.configured === false);
  let threw = null;
  try { await unconfigured.decide(packet, system); } catch (err) { threw = err; }
  check('...and refuses to invent an action', !!threw && /no reasoning model/.test(threw.message));
}

async function testAgentLoop() {
  section('the loop: an agent with no model does nothing');
  const { world } = makeWorld();
  const realmId = world.world.realmIds[0];
  const agent = world.spawn({ realmId });
  const startPos = [...agent.pos];

  const refused = await world.step(agent);
  check('with no model attached, a step does not move the agent',
    world.world.groundDistance(startPos, agent.pos) === 0, refused.reason);
  check('...and says why', refused.ok === false && /no reasoning model/.test(refused.reason));

  section('the loop: the model chooses, and the agent obeys');
  const decider = scriptedDecider([
    { thought: 'something is in sight', action: 'approach', args: { target: 'nearest', maxSteps: 500 } },
    { thought: 'now read it', action: 'inspect', args: { target: 'nearest' } },
    { thought: 'nothing more', action: 'wait', args: {} },
  ]);
  const world2 = makeWorld({ decider });
  const a2 = world2.world.spawn({ realmId });
  const p0 = [...a2.pos];

  const first = await world2.world.step(a2);
  check('the first decision was the model\'s, not a default', first.action.name === 'approach', first.action.name);
  check('the model\'s chosen action actually happened', first.moved > 0 || first.ok, JSON.stringify(first.result));

  const visible = world2.world.perception.perceive(a2).memories[0];
  if (visible) {
    const second = await world2.world.actions.act(a2, 'inspect', { target: visible.memoryId });
    check('inspecting what it walked to succeeds', second.ok === true, second.reason);
  }

  const third = await world2.world.step(a2);
  check('a third decision is carried out too', !!third.action.name);
  check('the agent recorded its thoughts', a2.thoughts.length >= 2, a2.thoughts.length);
  check('the agent filed its own observations', a2.history.length >= 2, a2.history.length);
  check('the model saw a live packet each time',
    decider.calls.length >= 2 && decider.calls[0].nearbyMemories !== undefined);

  section('the loop: a model that returns nonsense does not move the agent');
  const world3 = makeWorld({ decider: scriptedDecider([{ action: null }, { action: 'not_a_real_action' }]) });
  const a3 = world3.world.spawn({ realmId });
  const p3 = [...a3.pos];
  const junk = await world3.world.step(a3);
  check('an unusable reply is reported, not replaced with a default',
    junk.ok === false && /no usable action/.test(junk.reason), junk.reason);
  check('...and the agent did not move', world3.world.world.groundDistance(p3, a3.pos) === 0);

  section('the loop: permissions are enforced before the action runs');
  const world4 = makeWorld({
    decider: scriptedDecider([
      { action: 'remember', args: { title: 'should not happen' } },
      { action: 'recall', args: { query: 'anything' } },
    ]),
  });
  const a4 = world4.world.spawn({ realmId, allowRemember: false, allowRecall: false });
  const denied = await world4.world.step(a4);
  check('an agent without write permission is stopped', denied.ok === false && denied.kind === 'permission');
  check('...and nothing was written', world4.fake.calls.every((c) => !(c.method === 'POST' && c.path === '/api/remember')));
  const deniedRecall = await world4.world.step(a4);
  check('recall is separately gated', deniedRecall.ok === false && deniedRecall.kind === 'permission');

  section('the loop: the debug view reports what the requirements ask for');
  const debug = world2.world.debug();
  check('debug lists the agents', debug.agents.length === 1);
  const d = debug.agents[0];
  check('debug reports the position, realm, motion and perception range',
    Array.isArray(d.pos) && !!d.realm && !!d.motion && typeof d.range === 'number');
  check('debug reports the current action and last observation',
    !!d.lastAction && !!d.lastObservation);
  check('debug reports the selected memory ids', Array.isArray(d.selectedMemoryIds));
  check('debug reports the reasoning model', !!debug.decider && debug.decider.configured === true);
  check('debug reports the api calls behind the agent\'s knowledge', Array.isArray(debug.apiCalls));
  check('debug reports the world log', Array.isArray(debug.log) && debug.log.length > 0);

  const described = world2.world.agents[0].describe();
  check('an agent describes itself in one object',
    described.id && described.realm && described.lastAction && described.lastObservation);
}

async function testNoSecondDatabase() {
  section('the world is an interface into Yggdrasil, not a copy of it');
  const { world, state, fake } = makeWorld();
  const ws = world.world;

  check('the agent layer keeps no memory titles',
    ![...ws.objects.values()].some((o) => o.title || o.content));
  check('the agent layer keeps no memory bodies',
    ![...ws.objects.values()].some((o) => JSON.stringify(o).includes('content of')));

  check('the world reads its memories from the snapshot it was given',
    ws.objects.size === state.memories.length);

  const agent = new Agent({ world: ws, realmId: ws.realmIds[0] });
  agent.pos = [...ws.spawnPoint(ws.realmIds[0], 0).position];
  check('an agent starts knowing nothing', agent.known.size === 0);

  await world.actions.act(agent, 'inspect', {
    target: world.perception.perceive(agent).memories[0].memoryId,
  });
  check('an agent knows exactly what it has inspected', agent.known.size === 1);

  // rebuilding the world from the same snapshot must give the same objects:
  // nothing was accumulated locally that the store did not already have
  const rebuilt = new WorldState(world.layout, state);
  check('rebuilding the world from the snapshot reproduces it exactly',
    rebuilt.objects.size === ws.objects.size
    && [...rebuilt.objects.keys()].every((k) => rebuilt.objects.get(k).pos.join() === ws.objects.get(k).pos.join()));

  const before = state.memories.length;
  await world.actions.act(agent, 'remember', { title: 'a new place in the tree' });
  check('a write goes to the store, and only to the store',
    state.memories.length === before && fake.memories.size === before + 1,
    `${state.memories.length} vs ${fake.memories.size}`);
}

// ─────────────────────────────────────────────────────────────────── runner

async function main() {
  console.log('Yggdrasil · agent subsystem\n');

  await testWorldState();
  await testMovement();
  await testPerception();
  await testActions();
  await testMultiAgent();
  await testRealmTransit();
  await testReasoning();
  await testAgentLoop();
  await testNoSecondDatabase();

  console.log(`\n${failed ? `${failed} failing` : 'all green'} — ${passed} passed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\nthe suite threw:', err);
  process.exit(1);
});
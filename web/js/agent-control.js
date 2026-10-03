// Yggdrasil · agent control (application side)
//
// Everything the *page* needs to run an agent inside the world: attaching an
// agent world to the engine, keeping it in step with the tree as it grows,
// drawing the developer view, and stepping the agents.
//
// The agent subsystem itself is deliberately unaware of the page. This file is
// the adapter: it owns the AgentWorld, keeps it fed from the same snapshot the
// renderer draws, and exposes a small API for spawning and stepping agents. It
// does not contain any agent logic of its own — that all lives in ./agent.
//
// The debug view is deliberately plain DOM in a corner rather than something
// elaborate: it is for a developer looking at the page while an agent walks.

import { AgentWorld, ModelDecider } from './agent/index.js';
import { $, el } from './util.js';

let agentWorld = null;
let panel = null;
let panelOn = false;
let loopTimer = null;
let loopRunning = false;

/**
 * Create (or return) the agent world and attach it to the engine so the
 * renderer can draw the agents. Safe to call repeatedly.
 */
export function ensureAgentWorld(engine, state) {
  if (agentWorld) return agentWorld;
  // a bridge with no arguments talks to this page's own /api, which is the one
  // store Yggdrasil already has — the agent gets no database of its own
  agentWorld = new AgentWorld({ layout: engine.layout, state });
  engine.agentWorld = agentWorld;
  return agentWorld;
}

/**
 * Keep the agent world in step with the tree.
 *
 * The layout is recomputed every time the snapshot changes, so the world state
 * has to be rebuilt from it — otherwise an agent's memory objects would keep
 * pointing at positions from a layout that no longer exists. This is the only
 * place that rebuild happens.
 */
export function syncAgentWorld(engine, state) {
  if (!agentWorld) return null;
  agentWorld.layout = engine.layout;
  agentWorld.state = state;
  agentWorld.world.rebuild();
  return agentWorld;
}

export function getAgentWorld() {
  return agentWorld;
}

/** spawn an agent standing in a realm (default: the one you are looking at) */
export function spawnAgent(options = {}) {
  if (!agentWorld) return null;
  const realmId = options.realmId || currentRealmId() || agentWorld.world.realmIds[0];
  return agentWorld.spawn({ ...options, realmId });
}

function currentRealmId() {
  const canvasRealm = window.ygg?.engine?.realmId;
  return canvasRealm || null;
}

/** attach a reasoning model from a config object (any OpenAI-compatible URL) */
export function configureModel(config) {
  if (!agentWorld) return null;
  const decider = new ModelDecider({
    endpoint: config.endpoint,
    model: config.model,
    apiKey: config.apiKey,
    temperature: config.temperature,
  });
  agentWorld.withDecider(decider);
  return decider;
}

/** advance every agent one decision; returns the observations */
export async function stepAgents(times = 1) {
  const out = [];
  for (let i = 0; i < times; i += 1) out.push(...await agentWorld.stepAll());
  renderDebug();
  return out;
}

/** run the agents continuously, one decision per interval */
export function startLoop(intervalMs = 1200) {
  if (loopRunning) return;
  loopRunning = true;
  loopTimer = setInterval(async () => {
    try {
      await agentWorld.stepAll();
      renderDebug();
    } catch (error) {
      console.error('agent step failed', error);
    }
  }, intervalMs);
}

export function stopLoop() {
  loopRunning = false;
  if (loopTimer) clearInterval(loopTimer);
  loopTimer = null;
}

// ──────────────────────────────────────────────────────── the developer view

/** show or hide the agent debug panel */
export function toggleDebug(force) {
  panelOn = force === undefined ? !panelOn : !!force;
  if (panelOn) {
    if (!panel) panel = buildPanel();
    panel.hidden = false;
    renderDebug();
  } else if (panel) {
    panel.hidden = true;
  }
  return panelOn;
}

function buildPanel() {
  const node = el('aside', { id: 'agent-debug', class: 'agent-debug', hidden: 'hidden' });
  document.body.appendChild(node);
  return node;
}

/**
 * The debug view the brief asks for: position, realm, perception radius,
 * visible objects, the current action, the last observation, and the selected
 * memory ids. Rendered as text because this is a developer tool, not a scene.
 */
export function renderDebug() {
  if (!panelOn || !agentWorld || !panel) return;
  const debug = agentWorld.debug();
  const rows = [];
  rows.push(`<header><b>agents</b><span>${debug.agents.length}</span>`
    + `<button id="agent-debug-close" title="hide">x</button></header>`);

  for (const a of debug.agents) {
    const o = a.lastObservation;
    rows.push(
      `<section>`,
      `<div class="ad-name">${a.name}</div>`,
      `<div><label>realm</label> ${a.realm}</div>`,
      `<div><label>position</label> ${a.pos.join(', ')}</div>`,
      `<div><label>facing</label> ${a.yaw} &middot; <label>state</label> ${a.motion}</div>`,
      `<div><label>perception</label> ${a.range}</div>`,
      `<div><label>action</label> ${a.lastAction || '—'}</div>`,
      `<div><label>observation</label> ${o ? `${o.action} ${o.ok ? 'ok' : `(${o.reason || 'failed'})`} · visible ${o.visible} · +${o.gained}/-${o.lost}` : '—'}</div>`,
      `<div><label>selected memories</label> ${a.selectedMemoryIds.join(', ') || '—'}</div>`,
      `<div><label>thought</label> ${a.lastThought || '—'}</div>`,
      `</section>`,
    );
  }

  rows.push(
    `<footer>`,
    `<div><label>model</label> ${debug.decider.configured ? debug.decider.model : 'none attached'}</div>`,
    `<div><label>api calls</label> ${debug.apiCalls.length ? debug.apiCalls.map((c) => `${c.method} ${c.path}`).join('<br>') : '—'}</div>`,
    `</footer>`,
  );
  panel.innerHTML = rows.join('');

  const close = $('#agent-debug-close');
  if (close) close.onclick = () => toggleDebug(false);
}

// ────────────────────────────────────────────────────────── camera following

/**
 * Point the camera at an agent, so "where is it" is answerable by looking.
 * The camera flies the way it always does; nothing about the camera changes.
 */
export function focusAgent(id) {
  const agent = agentWorld?.get(id);
  if (!agent || !agentWorld) return false;
  const engine = window.ygg?.engine;
  if (!engine) return false;
  if (engine.realmId !== agent.realmId) engine.enterRealm(agent.realmId);
  const realm = agentWorld.world.realm(agent.realmId);
  engine.flyTo(agent.pos, Math.max(6, realm ? realm.radius * 0.9 : 12), { pitch: -0.3 });
  return true;
}
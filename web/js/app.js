// Yggdrasil · application
//
// Boots the canopy, keeps it live over SSE, and owns every panel: search,
// the memory inspector, the domain rail, the agent activity feed, the
// composer, and the three ways of looking at the same memory (tree, timeline,
// graph).

import { YggdrasilEngine } from './engine.js';
import { TimelineView } from './timeline.js';
import { GraphView } from './graph.js';
import {
  $, $$, api, clamp, debounce, el, fmtDate, fmtDuration, fmtNum,
  fmtRelative, hsl, pct, truncate,
} from './util.js';

const state = {
  view: 'tree',
  panel: 'activity',
  selectedMemory: null,
  selectedNode: null,
  query: '',
  matches: [],
  activityFilter: 'all',
  sim: true,
};

let engine;
let timeline;
let graph;
let snapshot = { nodes: [], memories: [], links: [], meta: {}, stats: {}, activity: [] };
const nodesById = new Map();
const memoriesById = new Map();
let stream = null;

// ─────────────────────────────────────────────────────────────── boot
async function boot() {
  engine = new YggdrasilEngine($('#stage'), {
    onPick: handlePick,
    onHover: handleHover,
  });

  const layer = document.createElement('canvas');
  layer.id = 'timeline-layer';
  layer.className = 'viewlayer';
  document.body.insertBefore(layer, $('#grain'));
  timeline = new TimelineView(layer, {
    onSelect: selectMemory,
    onHover: (info) => showTooltip(info && {
      title: info.event.m.title,
      hue: info.event.node?.hue ?? 44,
      kind: info.event.m.kind,
      memory: info.event.m,
    }, info),
  });

  const glayer = document.createElement('canvas');
  glayer.id = 'graph-layer';
  glayer.className = 'viewlayer';
  document.body.insertBefore(glayer, $('#grain'));
  graph = new GraphView(glayer, {
    onSelect: selectMemory,
    onHover: (info) => showTooltip(info && {
      title: info.node.memory.title,
      hue: info.node.hue,
      kind: info.node.memory.kind,
      memory: info.node.memory,
    }, info),
  });

  engine.start();
  engine.onRealmChange = syncRealmBar;
  requestAnimationFrame(frame);
  syncStageCentring();
  window.addEventListener('resize', debounce(syncStageCentring, 200));

  await refresh();
  connectStream();
  bindChrome();
  // a small handle for the console: inspect the canopy from a devtools session
  window.ygg = { get state() { return snapshot; }, engine, timeline, graph, selectMemory, runSearch };
  setTimeout(() => $('#boot').classList.add('done'), 260);
}

/** the rails overlay the canvas, so keep the canopy centred in what is visible */
function syncStageCentring() {
  const left = $('#left-rail');
  const right = $('#right-rail');
  const leftW = left && !left.classList.contains('collapsed') ? left.offsetWidth : 0;
  const rightW = right && !right.classList.contains('collapsed') ? right.offsetWidth : 0;
  engine.centerOffset = (leftW - rightW) / 2;
  engine.lift = (right ? 0 : 0) + engine.height * 0.03;
}

function frame(now) {
  const time = now / 1000;
  try {
    if (state.view === 'timeline') {
      timeline.render(time);
    } else if (state.view === 'graph') {
      graph.step(1 / 60);
      graph.render(time);
    }
  } catch (error) {
    if (!frame.warned) { frame.warned = true; console.error('view error', error); }
  }
  requestAnimationFrame(frame);
}

/** pull the canopy right now and apply it (awaited by every mutation) */
async function refresh() {
  applySnapshotNow(await api('/api/state'));
}

/** coalesced pull for the live stream, so a burst of writes is one round trip */
const scheduleRefresh = debounce(() => {
  refresh().catch((error) => toast(error.message, 'bad'));
}, 220);

function applySnapshotNow(next) {
  snapshot = next;
  nodesById.clear();
  for (const node of next.nodes) nodesById.set(node.id, node);
  memoriesById.clear();
  for (const memory of next.memories) memoriesById.set(memory.id, memory);

  engine.setState(next);
  timeline.setState(next);
  graph.setState(next);
  renderStats();
  renderDomains();
  renderActivity();
  $('#agent-name').textContent = (next.meta.agent || 'agent').toUpperCase();

  if (state.selectedMemory && !memoriesById.has(state.selectedMemory)) {
    state.selectedMemory = null;
    renderMemoryPanel();
  }
  if (state.query) runSearch(state.query, { silent: true });
}

// ─────────────────────────────────────────────────────────────── live stream
function connectStream() {
  stream = new EventSource('/api/stream');
  stream.onopen = () => $('#live-dot').classList.remove('off');
  stream.onerror = () => $('#live-dot').classList.add('off');
  stream.onmessage = (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (payload.type === 'activity') {
      snapshot.activity = [payload.activity, ...snapshot.activity].slice(0, 120);
      renderActivity({ highlight: payload.activity.id });
      if (state.selectedMemory && payload.activity.memory_id === state.selectedMemory) {
        renderMemoryPanel();
      }
    }
    if (payload.type === 'memory' && payload.memory) {
      memoriesById.set(payload.memory.id, payload.memory);
      if (payload.memory.node_id && payload.action === 'create') {
        engine.flash(payload.memory.node_id, 1);
      }
    }
    if (['memory', 'node', 'link'].includes(payload.type)) scheduleRefresh();
  };
}

// ─────────────────────────────────────────────────────────────── picking
function handlePick(nodeId, node) {
  if (!node) {
    engine.setIsolate(null);
    engine.select(null);
    state.selectedMemory = null;
    state.selectedNode = null;
    renderMemoryPanel();
    return;
  }
  if (node.kind === 'leaf') {
    const memory = engine.layout.memoryByNode.get(nodeId);
    // clicking a neuron carries you to the world it lives in
    if (memory) selectMemory(memory.id);
    return;
  }
  // a realm is a place: clicking its name takes you inside it
  if (node.kind === 'domain') {
    if (engine.realmId === nodeId) engine.leaveRealm();
    else engine.enterRealm(nodeId);
    renderDomains();
    return;
  }
  if (node.collapsed) {
    setCollapsed(nodeId, false);
    return;
  }
  if (engine.isolate === nodeId) {
    engine.setIsolate(null);
    engine.frameAll();
  } else {
    expandPath(nodeId);
    engine.setIsolate(nodeId);
    engine.focusNode(nodeId);
  }
  state.selectedNode = nodeId;
  renderDomains();
}

/** reflect where you are standing in the interface */
function syncRealmBar() {
  const bar = $('#realm-bar');
  const realmId = engine.realmId;
  if (!realmId) {
    bar.hidden = true;
    engine.highlightRealm = null;
    renderDomains();
    return;
  }
  const realm = engine.layout.realms.realms.get(realmId);
  const node = realm ? nodesById.get(realmId) : null;
  if (!realm) { bar.hidden = true; return; }
  $('#realm-title').textContent = realm.name;
  $('#realm-note').textContent = node?.summary || '';
  $('#realm-memories').textContent = String(realm.members.length);
  bar.hidden = false;
  engine.highlightRealm = realmId;
  renderDomains();
}

function handleHover(info, pointer) {
  showTooltip(info && {
    title: info.node.name,
    hue: info.node.hue,
    kind: info.node.kind,
    summary: info.node.summary,
    childCount: (engine.layout?.children.get(info.node.id) || []).length,
    memory: info.memory,
  }, pointer);
}

function selectMemory(memoryId, opts = {}) {
  const memory = memoriesById.get(memoryId);
  if (!memory) return;
  state.selectedMemory = memoryId;
  state.panel = 'memory';
  graph.selected = memory;
  if (opts.fly !== false) {
    expandPath(memory.node_id);
    // if you are standing in one realm and the memory lives in another, travel
    const home = engine.layout.realms.realmOfNode.get(memory.node_id);
    if (home && engine.realmId !== home) engine.enterRealm(home);
    else if (!home && engine.realmId) engine.leaveRealm();
    engine.focusMemory(memoryId);
  }
  engine.select(memory.node_id, memoryId);
  setPanel('memory');
  renderMemoryPanel();
  if (state.view === 'timeline') timeline.selected = memory;
}

function expandPath(nodeId) {
  // make sure nothing on the way down is collapsed, or the leaf is invisible
  const opened = [];
  let current = nodesById.get(nodeId);
  while (current && current.parent_id) {
    const parent = nodesById.get(current.parent_id);
    if (!parent) break;
    if (parent.collapsed) { parent.collapsed = false; opened.push(parent.id); }
    current = parent;
  }
  if (opened.length) {
    engine.setState(snapshot);
    for (const id of opened) {
      api(`/api/nodes/${id}`, { method: 'PATCH', body: { collapsed: false } }).catch(() => {});
    }
  }
}

async function setCollapsed(nodeId, collapsed) {
  const node = nodesById.get(nodeId);
  if (!node) return;
  node.collapsed = collapsed;
  engine.setState(snapshot);
  renderDomains();
  try {
    await api(`/api/nodes/${nodeId}`, { method: 'PATCH', body: { collapsed } });
  } catch (error) {
    toast(error.message, 'bad');
  }
}

function setCollapsedSafe() {
  // only collapsed nodes need telling; everything else is already open
  for (const node of snapshot.nodes) {
    if (node.collapsed) {
      api(`/api/nodes/${node.id}`, { method: 'PATCH', body: { collapsed: false } }).catch(() => {});
    }
  }
}

// ─────────────────────────────────────────────────────────────── panels
function setPanel(name) {
  state.panel = name;
  $$('.rail-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
  $('#activity-panel').hidden = name !== 'activity';
  $('#memory-panel').hidden = name !== 'memory';
}

function renderStats() {
  const s = snapshot.stats || {};
  const tiles = [
    { label: 'memories', value: fmtNum(s.memories), accent: true },
    { label: 'branches', value: fmtNum(s.branches) },
    { label: 'links', value: fmtNum(s.links), accent: true },
    { label: 'recalls', value: fmtNum(s.accesses) },
    { label: 'avg importance', value: s.avg_importance != null ? s.avg_importance.toFixed(2) : '—' },
    { label: 'memory span', value: s.oldest_days ? `${Math.round(s.oldest_days)}d` : '—' },
  ];
  $('#stats').replaceChildren(...tiles.map((tile) => el('div', { class: `stat${tile.accent ? ' accent' : ''}` },
    el('b', {}, String(tile.value)),
    el('span', {}, tile.label),
  )));
}

function renderDomains() {
  const domains = snapshot.nodes.filter((n) => n.kind === 'domain');
  const counts = new Map();
  for (const node of snapshot.nodes) {
    let current = node;
    while (current && current.kind !== 'domain' && current.parent_id) {
      current = nodesById.get(current.parent_id);
    }
    if (current && current.kind === 'domain') {
      counts.set(current.id, (counts.get(current.id) || 0) + (node.kind === 'leaf' ? 1 : 0));
    }
  }
  const list = $('#domain-list');
  list.replaceChildren(...domains.map((domain) => el('li', {
    class: `domain${engine.realmId === domain.id ? ' active' : ''}${domain.collapsed ? ' collapsed' : ''}`,
    title: domain.summary || domain.name,
    onclick: () => {
      if (engine.realmId === domain.id) engine.leaveRealm();
      else engine.enterRealm(domain.id);
      renderDomains();
    },
  },
    el('i', { class: 'glyph', style: { color: hsl(domain.hue, 95, 62) } }),
    el('span', { class: 'name' }, domain.name),
    el('span', { class: 'n' }, String(counts.get(domain.id) || 0)),
    el('button', {
      class: 'chev',
      title: domain.collapsed ? 'expand branch' : 'collapse branch',
      onclick: (event) => { event.stopPropagation(); setCollapsed(domain.id, !domain.collapsed); },
    }, domain.collapsed ? '▸' : '▾'),
  )));
}

const ACTION_GLYPH = {
  create: '✦', update: '✎', retrieve: '⌕', read: '◉', link: '⇄',
  merge: '⊕', forget: '✕', archive: '⌫', note: '·',
};

function renderActivity(opts = {}) {
  const feed = $('#activity-feed');
  const entries = snapshot.activity.filter((a) => {
    if (state.activityFilter === 'all') return true;
    if (state.activityFilter === 'retrieve') return ['retrieve', 'read'].includes(a.action);
    return ['create', 'update', 'link', 'merge', 'forget', 'archive'].includes(a.action);
  });
  $('#activity-count').textContent = `${entries.length} events`;

  const rows = entries.slice(0, 60).map((entry) => {
    const li = el('li', {
      class: `action-${entry.action}`,
      title: entry.title || entry.detail,
      onclick: () => {
        if (entry.memory_id && memoriesById.has(entry.memory_id)) {
          selectMemory(entry.memory_id);
          if (state.view !== 'tree') setView('tree');
        }
      },
    },
      el('span', { class: 'glyph' }, ACTION_GLYPH[entry.action] || '·'),
      el('div', {},
        el('div', { class: 'detail' },
          entry.action === 'retrieve'
            ? el('span', { class: 'title' }, entry.title || entry.detail)
            : entry.detail || entry.action),
        el('div', { class: 'meta' },
          [
            entry.actor,
            fmtRelative(entry.ts),
            entry.duration_ms != null ? fmtDuration(entry.duration_ms) : null,
            entry.score != null ? `score ${entry.score}` : null,
          ].filter(Boolean).join('  ·  ')),
      ),
    );
    if (opts.highlight === entry.id) li.style.animation = 'none';
    return li;
  });
  feed.replaceChildren(...rows);
}

function renderMemoryPanel() {
  const panel = $('#memory-panel');
  if (!state.selectedMemory) {
    panel.replaceChildren(el('div', { class: 'empty-state' },
      el('p', {}, 'No memory selected.'),
      el('p', {}, 'Click a glowing leaf in the canopy, or press ', el('kbd', {}, '/'), ' to search.'),
    ));
    return;
  }    const memory = memoriesById.get(state.selectedMemory);
    if (!memory) return;
    const node = nodesById.get(memory.node_id);
    const hue = node?.hue ?? 44;
  const relations = snapshot.links
    .filter((l) => l.a === memory.id || l.b === memory.id)
    .map((l) => ({
      link: l,
      other: memoriesById.get(l.a === memory.id ? l.b : l.a),
    }))
    .filter((r) => r.other);

  const path = (node ? engine.layout.path.get(node.id) || [] : [])
    .map((id) => nodesById.get(id))
    .filter(Boolean);

  const panel_ = el('div', {},
    el('div', { class: 'mem-hero' },
      el('div', { class: 'mem-kind', style: { color: hsl(hue, 95, 72) } },
        el('i', { class: 'glyph', style: { background: hsl(hue, 100, 70) } }),
        `${memory.kind} · ${memory.source}`),
      el('h2', { class: 'mem-title' }, memory.title),
      el('div', { class: 'mem-path' }, path.map((n) => n.name).join('  ›  ')),
    ),
    memory.content ? el('div', { class: 'mem-body' }, memory.content) : null,

    el('div', { class: 'mem-meta' },
      metaTile('created', fmtDate(memory.created_at)),
      metaTile('updated', fmtRelative(memory.updated_at)),
      metaTile('recalls', String(memory.access_count)),
      metaTile('version', `v${memory.version}`),
    ),

    meter('importance', memory.importance, hue, 'amber'),
    meter('confidence', memory.confidence, hue, 'cyan'),

    memory.tags.length ? el('div', { class: 'tags' }, memory.tags.map((tag) => el('span', {
      class: 'tag click',
      title: `search “${tag}”`,
      onclick: () => {
        $('#search').value = tag;
        runSearch(tag);
      },
    }, `#${tag}`))) : null,

    relations.length ? el('div', { class: 'rel-group' },
      el('h3', {}, `relationships · ${relations.length}`),
      ...relations.map(({ link, other }) => relRow(other, link, hue)),
    ) : el('div', { class: 'rel-group' },
      el('h3', {}, 'relationships'),
      el('p', { class: 'tip' }, 'This memory is not linked to anything. Isolated leaves are review candidates.'),
    ),

    el('div', { class: 'actions' },
      el('button', { onclick: () => editMemory(memory) }, 'Edit'),
      el('button', { onclick: () => openLinkModal(memory) }, 'Link…'),
      el('button', { onclick: () => openMergeModal(memory) }, 'Merge…'),
      el('button', { onclick: () => { navigator.clipboard?.writeText(memory.id); toast('memory id copied'); } }, 'Copy id'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'danger', onclick: () => openForgetModal(memory) }, 'Forget'),
    ),
  );
  panel.replaceChildren(panel_);
}

function metaTile(label, value) {
  return el('div', { class: 'm' }, el('span', {}, label), el('b', {}, value));
}

function meter(label, value, hue, tint) {
  const color = tint === 'amber' ? 'hsl(38 100% 66%)' : hsl(hue, 100, 68);
  return el('div', { class: 'meter' },
    el('label', {}, label),
    el('div', { class: 'track' }, el('div', { class: 'fill', style: { width: `${(value || 0) * 100}%`, background: color } })),
    el('b', {}, pct(value)),
  );
}

function relRow(other, link, hue) {
  const otherNode = nodesById.get(other.node_id);
  return el('div', {
    class: 'rel',
    title: other.content ? truncate(other.content, 160) : other.title,
    onclick: () => { if (state.view !== 'tree') setView('tree'); selectMemory(other.id); },
  },      el('i', { class: 'bar', style: { background: hsl(otherNode?.hue ?? 44, 90, 60) } }),
    el('span', { class: 't' }, other.title),
    el('span', { class: 'x' }, link.type),
  );
}

// ─────────────────────────────────────────────────────────────── search
function runSearch(query, opts = {}) {
  state.query = query;
  const wrap = $('.searchwrap');
  wrap.classList.toggle('has-query', !!query);
  const results = query ? searchMemories(query) : [];
  state.matches = results.map((r) => r.memory.id);
  engine.setMatches(state.matches);
  const panel = $('#search-results');

  if (!query) {
    panel.hidden = true;
    panel.replaceChildren();
    return results;
  }

  if (!opts.silent) $('#memory-panel').scrollTo?.({ top: 0 });
  panel.hidden = false;
  if (!results.length) {
    panel.replaceChildren(el('div', { class: 'empty' }, `nothing matches “${query}”`));
  } else {
    panel.replaceChildren(...results.slice(0, 30).map((result) => el('div', {
      class: 'result',
      onclick: () => {
        panel.hidden = true;
        if (state.view !== 'tree') setView('tree');
        selectMemory(result.memory.id);
      },
    },
      el('i', { class: 'rail', style: { background: hsl(result.node?.hue ?? 44, 90, 64) } }),
      el('div', {},
        el('div', { class: 't' }, result.memory.title),
        el('div', { class: 's' }, truncate(result.memory.content || result.memory.domain, 70)),
      ),
      el('div', {
        class: 'm',
        title: `${result.memory.kind} · ${result.memory.domain} · ${fmtRelative(result.memory.created_at)}`,
      }, result.memory.kind.slice(0, 3).toUpperCase()),
    )));
  }
  return results;
}

function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 2);
}

function searchMemories(query) {
  const terms = tokenize(query);
  const scored = [];
  for (const memory of snapshot.memories) {
    const title = memory.title.toLowerCase();
    const content = memory.content.toLowerCase();
    const tags = memory.tags.map((t) => t.toLowerCase());
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += title.startsWith(term) ? 5 : 3.4;
      if (tags.some((t) => t.includes(term))) score += 2.4;
      if (memory.domain.toLowerCase().includes(term)) score += 1;
      if (content.includes(term)) score += 0.9;
    }
    if (score > 0) scored.push({ memory, node: nodesById.get(memory.node_id), score: score + memory.importance });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ─────────────────────────────────────────────────────────────── mutations
async function createMemory(payload) {
  const memory = await api('/api/remember', { method: 'POST', body: payload });
  memoriesById.set(memory.id, memory);      // selectable before the canopy reloads
  await refresh();
  selectMemory(memory.id);
  engine.flash(memory.node_id, 1);
  toast('planted in the canopy', 'good');
  return memory;
}

async function patchMemory(memoryId, changes) {
  const memory = await api(`/api/memories/${memoryId}`, { method: 'PATCH', body: changes });
  memoriesById.set(memory.id, memory);
  await refresh();
  renderMemoryPanel();
  return memory;
}

function openComposer(prefill = {}) {
  const domains = snapshot.nodes.filter((n) => n.kind === 'domain');
  const branches = snapshot.nodes.filter((n) => n.kind === 'branch');
  let parentId = prefill.parent_id || (branches[0] && branches[0].id);
  let title = '';
  let content = '';
  let kind = 'fact';
  let importance = 0.55;
  let confidence = 0.75;
  let tags = '';

  const branchSelect = el('select', {
    onchange: (e) => { parentId = e.target.value; },
  }, ...[
    el('option', { value: '', disabled: true, selected: !parentId }, '— choose a branch —'),
    ...domains.map((domain) => el('optgroup', { label: domain.name },
      ...branches.filter((b) => b.parent_id === domain.id).map((b) =>
        el('option', { value: b.id, selected: b.id === parentId }, b.name)))),
  ]);

  const modal = modalShell('Remember something', 'New memories become leaves. Link them later, or search first — an unlinked leaf is a review candidate.',
    [
      field('title', el('input', { type: 'text', placeholder: 'e.g. the operator prefers diagram-first answers', oninput: (e) => { title = e.target.value; } })),
      field('memory', el('textarea', { placeholder: 'What should a future session know, and why does it matter?', oninput: (e) => { content = e.target.value; } })),
      el('div', { class: 'row2' },
        field('branch', branchSelect),
        field('kind', el('select', { onchange: (e) => { kind = e.target.value; } },
          ...['fact', 'insight', 'episode', 'project', 'person', 'skill', 'goal', 'event'].map((k) =>
            el('option', { value: k }, k)))),
      ),
      field('tags  (comma separated)', el('input', { type: 'text', placeholder: 'mira, style', oninput: (e) => { tags = e.target.value; } })),
      sliderField('importance', 0.55, (v) => { importance = v; }),
      sliderField('confidence', 0.75, (v) => { confidence = v; }),
    ],
    async () => {
      if (!title.trim()) { toast('a memory needs a title', 'bad'); return false; }
      if (!parentId) { toast('choose a branch to plant it in', 'bad'); return false; }
      await createMemory({
        title: title.trim(), content: content.trim(), parent_id: parentId, kind,
        importance, confidence,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        source: 'operator',
      });
      return true;
    },
  );
  modal.querySelector('input')?.focus();
}

function editMemory(memory) {
  const node = nodesById.get(memory.node_id);
  let title = memory.title;
  let content = memory.content || '';
  let importance = memory.importance;
  let confidence = memory.confidence;
  let tags = memory.tags.join(', ');
  let parentId = node?.parent_id;

  const branches = snapshot.nodes.filter((n) => n.kind === 'branch');
  modalShell('Edit memory', `v${memory.version} · last written ${fmtRelative(memory.updated_at)}`, [
    field('title', el('input', { type: 'text', value: title, oninput: (e) => { title = e.target.value; } })),
    field('memory', el('textarea', { oninput: (e) => { content = e.target.value; } }, content)),
    field('branch', el('select', { onchange: (e) => { parentId = e.target.value; } },
      ...branches.map((b) => el('option', { value: b.id, selected: b.id === parentId }, branchLabel(b))))),
    field('tags', el('input', { type: 'text', value: tags, oninput: (e) => { tags = e.target.value; } })),
    sliderField('importance', importance, (v) => { importance = v; }),
    sliderField('confidence', confidence, (v) => { confidence = v; }),
  ], async () => {
    await patchMemory(memory.id, {
      title: title.trim(), content, importance, confidence, parent_id: parentId,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    toast('memory updated', 'good');
    return true;
  });
}

function openLinkModal(memory) {
  const list = snapshot.memories
    .filter((m) => m.id !== memory.id)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 40);
  let query = '';
  let relation = 'related';
  let weight = 0.7;
  let target = list[0];

  const listBox = el('div', { class: 'picker' });
  const render = () => {
    const filtered = query
      ? list.filter((m) => m.title.toLowerCase().includes(query.toLowerCase()))
      : list;
    listBox.replaceChildren(...(filtered.length ? filtered.slice(0, 14) : [el('div', { class: 'empty' }, 'no match')])
      .map((m) => el('div', {
        class: `pick${target?.id === m.id ? ' active' : ''}`,
        onclick: (e) => {
          target = m;
          e.currentTarget.parentElement.querySelectorAll('.pick').forEach((n) => n.classList.remove('active'));
          e.currentTarget.classList.add('active');
        },
      },
        el('i', { class: 'glyph', style: { background: hsl(nodesById.get(m.node_id)?.hue ?? 44, 90, 62) } }),
        el('span', { class: 't' }, m.title),
        el('span', { class: 'x' }, m.domain),
      )));
  };
  render();

  modalShell('Link memories', 'Related memories stay connected even when they grow on different branches.', [
    field('find', el('input', { type: 'text', placeholder: 'filter…', oninput: (e) => { query = e.target.value; render(); } })),
    listBox,
    el('div', { class: 'row2' },
      field('relation', el('select', { onchange: (e) => { relation = e.target.value; } },
        ...['related', 'supports', 'contradicts', 'evidenced-by', 'origin', 'same-principle', 'supersedes']
          .map((r) => el('option', { value: r }, r)))),
      field('strength', el('input', {
        type: 'number', min: '0', max: '1', step: '0.05', value: String(weight),
        oninput: (e) => { weight = Number(e.target.value); },
      })),
    ),
  ], async () => {
    if (!target) { toast('pick a memory to link', 'bad'); return false; }
    await api('/api/link', {
      method: 'POST',
      body: { a: memory.id, b: target.id, type: relation, weight, actor: 'operator' },
    });
    await refresh();
    renderMemoryPanel();
    toast('linked across the canopy', 'good');
    return true;
  });
}

function openMergeModal(memory) {
  const candidates = snapshot.memories
    .filter((m) => m.id !== memory.id && m.kind === memory.kind)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 12);
  let target = candidates[0];
  const listBox = el('div', { class: 'picker' });
  const render = () => {
    listBox.replaceChildren(...(candidates.length ? candidates : [el('div', { class: 'empty' }, 'no similar memories')])
      .map((m) => el('div', {
        class: `pick${target?.id === m.id ? ' active' : ''}`,
        onclick: (e) => {
          target = m;
          e.currentTarget.parentElement.querySelectorAll('.pick').forEach((n) => n.classList.remove('active'));
          e.currentTarget.classList.add('active');
        },
      },
        el('i', { class: 'glyph', style: { background: hsl(nodesById.get(m.node_id)?.hue ?? 44, 90, 62) } }),
        el('span', { class: 't' }, m.title),
        el('span', { class: 'x' }, truncate(m.content, 40)),
      )));
  };
  render();

  modalShell('Merge memories', `Tags, links and the stronger importance move into “${truncate(memory.title, 40)}”. The other memory becomes superseded.`, [
    listBox,
  ], async () => {
    if (!target) { toast('pick a memory to merge in', 'bad'); return false; }
    await api('/api/merge', { method: 'POST', body: { a: memory.id, b: target.id, actor: 'operator' } });
    await refresh();
    renderMemoryPanel();
    toast('memories merged', 'good');
    return true;
  });
}

function openForgetModal(memory) {
  modalShell('Forget this memory?',
    'Archive keeps it (and its links) out of the canopy but recoverable. Delete removes the leaf and its node for good.',
    [
      el('div', { class: 'mem-body' }, memory.title),
    ],
    async ({ hard }) => {
      await api(`/api/memories/${memory.id}?hard=${hard ? 1 : 0}&actor=operator`, { method: 'DELETE' });
      await refresh();
      state.selectedMemory = null;
      setPanel('activity');
      toast(hard ? 'deleted for good' : 'archived — recoverable', hard ? 'bad' : 'good');
      return true;
    },
    { danger: true, extraAction: { label: 'delete for good', kind: 'hard' } });
}

function branchLabel(node) {
  const domain = findDomainOf(node);
  return domain && domain.id !== node.id ? `${domain.name} / ${node.name}` : node.name;
}

function findDomainOf(node) {
  let current = node;
  while (current && current.parent_id) {
    current = nodesById.get(current.parent_id);
    if (current?.kind === 'domain') return current;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────── chrome
function bindChrome() {
  const search = $('#search');
  const onInput = debounce(() => runSearch(search.value.trim()), 90);
  search.addEventListener('input', onInput);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { clearSearch(); search.blur(); }
    if (event.key === 'Enter') {
      const first = state.matches[0];
      if (first) {
        $('#search-results').hidden = true;
        if (state.view !== 'tree') setView('tree');
        selectMemory(first);
        search.blur();
      }
    }
  });
  $('#search-clear').addEventListener('click', clearSearch);

  $$('.views button').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));

  $('#new-memory').addEventListener('click', () => openComposer());
  $('#sim-toggle').addEventListener('click', toggleSim);
  $('#realm-exit').addEventListener('click', () => { engine.leaveRealm(); renderDomains(); });
  $('#btn-frame').addEventListener('click', () => { engine.setIsolate(null); engine.frameAll(); syncRealmBar(); });
  $('#btn-links').addEventListener('click', (event) => {
    engine.showLinks = !engine.showLinks;
    event.currentTarget.classList.toggle('on', engine.showLinks);
  });
  $('#expand-all').addEventListener('click', expandAll);
  $('#glow').addEventListener('input', (event) => {
    engine.linkOpacity = Number(event.target.value) / 100;
    $('#stage').style.filter = `brightness(${(0.72 + engine.linkOpacity * 0.38).toFixed(2)})`;
  });
  $('#spin').addEventListener('change', (event) => engine.setSpin(event.target.checked));

  $$('.rail-collapse').forEach((button) => button.addEventListener('click', () => {
    const rail = document.getElementById(button.dataset.target);
    rail.classList.toggle('collapsed');
    button.textContent = rail.classList.contains('collapsed')
      ? (button.classList.contains('right') ? '‹' : '›')
      : (button.classList.contains('right') ? '›' : '‹');
    setTimeout(() => {
      engine.resize();
      timeline.resize();
      graph.resize();
      syncStageCentring();
    }, 420);
  }));

  $$('.rail-tabs button').forEach((button) => button.addEventListener('click', () => setPanel(button.dataset.panel)));
  $$('#activity-filters button').forEach((button) => button.addEventListener('click', () => {
    state.activityFilter = button.dataset.action;
    $$('#activity-filters button').forEach((b) => b.classList.toggle('active', b === button));
    renderActivity();
  }));

  window.addEventListener('resize', debounce(() => {
    engine.resize();
    timeline.resize();
    graph.resize();
  }, 140));

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea, select')) return;
    const key = event.key.toLowerCase();
    if (key === '/') { event.preventDefault(); $('#search').focus(); $('#search').select(); }
    else if (key === 'escape') {
      clearSearch();
      engine.setIsolate(null);
      if (engine.realmId) { engine.leaveRealm(); syncRealmBar(); }
      closeModal();
      setPanel('activity');
    }
    else if (key === '1') setView('tree');
    else if (key === '2') setView('timeline');
    else if (key === '3') setView('graph');
    else if (key === 'f') { engine.setIsolate(null); engine.frameAll(); syncRealmBar(); }
    else if (key === 'backspace' && engine.realmId) { engine.leaveRealm(); syncRealmBar(); }
    else if (key === 'l') $('#btn-links').click();
    else if (key === 'n') openComposer();
    else if (key === 'arrowdown' || key === 'arrowup') stepSelection(key === 'arrowdown' ? 1 : -1);
  });
}

function clearSearch() {
  $('#search').value = '';
  runSearch('');
  $('#search-results').hidden = true;
}

function stepSelection(direction) {
  if (!state.selectedMemory) return;
  const memory = memoriesById.get(state.selectedMemory);
  const domain = findDomainOf(nodesById.get(memory.node_id));
  const siblings = snapshot.memories
    .filter((m) => findDomainOf(nodesById.get(m.node_id))?.id === domain?.id)
    .sort((a, b) => a.created_at - b.created_at);
  const index = siblings.findIndex((m) => m.id === memory.id);
  const next = siblings[(index + direction + siblings.length) % siblings.length];
  if (next) {
    if (state.view !== 'tree') setView('tree');
    selectMemory(next.id);
  }
}

function setView(view) {
  if (state.view === view) return;
  state.view = view;
  $$('.views button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  // the stylesheet keeps .viewlayer hidden, so show it explicitly
  $('#stage').style.display = view === 'tree' ? 'block' : 'none';
  $('#timeline-layer').style.display = view === 'timeline' ? 'block' : 'none';
  $('#graph-layer').style.display = view === 'graph' ? 'block' : 'none';
  engine.paused = view !== 'tree';
  if (view === 'tree') requestAnimationFrame(() => engine.resize());

  const note = $('#view-note');
  const copy = {
    tree: 'drag orbit · scroll zoom · click a branch to descend · click a leaf to open it',
    timeline: 'memories over time · drag to pan · scroll to zoom · click to open',
    graph: 'drag a memory to pin it · scroll to zoom · double-click to reframe',
  }[view];
  note.textContent = copy;
  note.hidden = false;
  clearTimeout(setView._t);
  setView._t = setTimeout(() => { note.hidden = true; }, 5200);

  if (view === 'timeline') { timeline.resize(); timeline.span = Math.min(1, timeline.span); }
  if (view === 'graph') { graph.resize(); graph.alpha = 1; }
  if (state.selectedMemory) {
    const memory = memoriesById.get(state.selectedMemory);
    if (memory) {
      timeline.selected = memory;
      graph.selected = graph.index?.get(memory.id);
    }
  }
}

async function toggleSim() {
  state.sim = !state.sim;
  const button = $('#sim-toggle');
  button.classList.toggle('off', !state.sim);
  $('#sim-label').textContent = state.sim ? 'agent live' : 'agent idle';
  $('#live-dot').classList.toggle('off', !state.sim);
  try {
    await api('/api/simulate', { method: 'POST', body: { enabled: state.sim } });
    toast(state.sim ? 'ambient agent activity on' : 'ambient activity paused');
  } catch (error) {
    toast(error.message, 'bad');
  }
}

async function expandAll() {
  const collapsed = snapshot.nodes.filter((n) => n.collapsed);
  if (!collapsed.length) return;
  for (const node of collapsed) node.collapsed = false;
  engine.setState(snapshot);
  renderDomains();
  await Promise.all(collapsed.map((n) => api(`/api/nodes/${n.id}`, { method: 'PATCH', body: { collapsed: false } })));
  toast('canopy fully open');
}

// ─────────────────────────────────────────────────────────────── tooltip & toast
function showTooltip(info, position) {
  const tip = $('#tooltip');
  if (!info) { tip.hidden = true; return; }
  const { title, hue = 44, kind, summary, childCount = 0, memory } = info;
  tip.replaceChildren(
    el('div', { class: 'tt', style: { color: hsl(hue, 100, 82) } }, title),
    memory
      ? el('div', { class: 'tb' }, truncate(memory.content || 'no detail recorded', 150))
      : el('div', { class: 'tb' }, summary || `${childCount} branches`),
    el('div', { class: 'tm' }, memory
      ? [kind, `imp ${memory.importance.toFixed(2)}`, `conf ${memory.confidence.toFixed(2)}`,
         fmtRelative(memory.updated_at)].join(' · ')
      : [kind, `${childCount} children`, kind === 'leaf' ? 'memory' : 'branch'].join(' · ')),
  );
  tip.hidden = false;
  if (position) tooltipAt(position.x ?? position.lastX, position.y ?? position.lastY);
}

function tooltipAt(x, y) {
  const tip = $('#tooltip');
  if (tip.hidden || x == null || y == null) return;
  const left = clamp(x + 16, 8, window.innerWidth - tip.offsetWidth - 8);
  const top = clamp(y + 18, 8, window.innerHeight - tip.offsetHeight - 8);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function toast(message, kind = '') {
  const node = el('div', { class: `toast ${kind}` }, message);
  $('#toasts').append(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 320);
  }, 2600);
}

// ─────────────────────────────────────────────────────────────── modal helpers
function modalShell(title, subtitle, fields, onSubmit, opts = {}) {
  const veil = el('div', { class: 'veil' });
  let extraKind = null;

  const submit = el('button', { class: 'primary' }, opts.confirmLabel || 'save');
  const form = el('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const result = await onSubmit({ hard: extraKind === 'hard' });
        if (result !== false) close();
      } finally {
        submit.disabled = false;
      }
    },
  },
    el('h2', {}, title),
    subtitle ? el('p', { class: 'sub' }, subtitle) : null,
    ...fields,
    el('div', { class: 'foot' },
      el('button', { type: 'button', class: 'ghost', onclick: () => close() }, 'cancel'),
      opts.extraAction
        ? el('button', {
            type: 'button', class: 'ghost',
            onclick: (event) => {
              extraKind = extraKind ? null : event.currentTarget.dataset.kind;
              $$('.foot .ghost', form).forEach((b) => b.classList.remove('active'));
              if (extraKind) event.currentTarget.classList.add('active');
            },
            dataset: { kind: opts.extraAction.kind },
          }, opts.extraAction.label)
        : null,
      submit,
    ),
  );

  const close = () => { veil.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  veil.addEventListener('mousedown', (event) => { if (event.target === veil) close(); });
  veil.append(el('div', { class: 'modal' }, form));
  $('#modal-root').append(veil);
  return veil;
}

function closeModal() {
  $('#modal-root').replaceChildren();
}

function field(label, control) {
  return el('div', { class: 'field' }, el('label', {}, label), control);
}

function sliderField(label, initial, onChange) {
  const value = el('b', { style: { float: 'right', fontFamily: 'var(--mono)', fontSize: '10px' } }, initial.toFixed(2));
  const input = el('input', {
    type: 'range', min: '0', max: '1', step: '0.01', value: String(initial),
    oninput: (event) => { value.textContent = Number(event.target.value).toFixed(2); onChange(Number(event.target.value)); },
  });
  return el('div', { class: 'field' }, el('label', {}, label, value), input);
}

function escapeHtmlSafe() { /* DOM built with helpers; no raw html anywhere */ }

boot().catch((error) => {
  document.querySelector('.boot-inner p').textContent = `could not reach the memory store: ${error.message}`;
  console.error(error);
});

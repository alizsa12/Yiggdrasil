// Yggdrasil · agent memory bridge
//
// The one door between an agent and the memory graph.
//
// There is exactly one memory database in Yggdrasil and it is the SQLite store
// behind /api. An agent that walked into a realm and read a memory is reading
// the same row a human reads in the inspector. This module is the *only* place
// allowed to know that: every other agent module speaks in terms of memory ids
// and calls through here.
//
// Two consequences worth stating plainly, because they are the whole point:
//
//   1. There is no second store. An agent cannot remember something the store
//      does not hold, and `remember()` writes a real memory that shows up in
//      the UI, the graph, the timeline and the activity feed like any other.
//   2. Perception is the only way in. `get()` is deliberately NOT exposed as a
//      "search everything" call. An agent fetches a memory by id once the world
//      has decided that memory is close enough to see. That is what makes the
//      spatial relationship real: walking away from a memory is what takes// access to it away, not an access check someone can route around.

/** how much of a memory a perception glance is allowed to carry */
const GLANCE_FIELDS = ['id', 'node_id', 'title', 'kind', 'domain', 'importance', 'confidence', 'tags'];

/** the compact form of a memory that perception hands to a reasoning model */
export function glance(memory) {
  if (!memory) return null;
  const out = {};
  for (const key of GLANCE_FIELDS) if (memory[key] !== undefined) out[key] = memory[key];
  return out;
}

export class MemoryBridge {
  /**
   * @param {object}   options
   * @param {string}   [options.base]     prefix for api paths, e.g. '' or '/api-proxy'
   * @param {Function} [options.fetchImpl] injected for tests; defaults to global fetch
   * @param {string}   [options.actor]    who is acting, recorded by the store
   */
  constructor(options = {}) {
    this.base = options.base || '';
    this.fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
    this.actor = options.actor || 'agent';
    // Every call made, for the debug view and for tests. Bounded: an agent
    // that walks for an hour should not grow an unbounded log.
    this.calls = [];
    this.maxCalls = options.maxCalls ?? 200;
  }

  /** record a call for the debug view */
  _note(method, path) {
    this.calls.push({ method, path, at: this.calls.length });
    if (this.calls.length > this.maxCalls) this.calls.splice(0, this.calls.length - this.maxCalls);
  }

  async _get(path) {
    this._note('GET', path);
    return this.request(path);
  }

  async _post(path, body) {
    this._note('POST', path);
    return this.request(path, { method: 'POST', body });
  }

  async _patch(path, body) {
    this._note('PATCH', path);
    return this.request(path, { method: 'PATCH', body });
  }

  /**
   * The one request path. `util.api` is deliberately not used here: it calls
   * the global `fetch` directly and ignores an injected one, so a bridge given a
   * fake — or a base URL — would silently fall back to the browser's fetch
   * against a relative path. Routing every request through this method keeps the
   * bridge honest about where its bytes go.
   */
  async request(path, options = {}) {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
    return data;
  }

  /**
   * A memory the agent can see. The full record, because the agent chose to
   * spend an action on this one — this is `inspect`, not the ambient glance
   * that perception hands out for free.
   */
  async get(memoryId) {
    if (!memoryId) throw new Error('get requires a memory id');
    const memory = await this._get(`${this.base}/api/memories/${encodeURIComponent(memoryId)}`);
    return memory || null;
  }

  /** a memory plus the links and neighbourhood the store knows about */
  async context(memoryId) {
    if (!memoryId) throw new Error('context requires a memory id');
    return this._get(`${this.base}/api/memories/${encodeURIComponent(memoryId)}/context`);
  }

  /**
   * Retrieval. This *is* a graph query, so it can reach memories the agent has
   * never stood next to — which is why it is an explicit action with a cost,
   * and why the observation it produces is recorded as something the agent
   * retrieved rather than something it saw.
   */
  async recall(query, options = {}) {
    const body = {
      query: query || '',
      limit: options.limit ?? 8,
      actor: options.actor || this.actor,
    };
    const data = await this._post(`${this.base}/api/recall`, body);
    return { query: body.query, results: (data && data.results) || [] };
  }

  /** write a memory. It becomes part of the tree immediately, for everyone. */
  async remember(input) {
    if (!input || !input.title) throw new Error('remember requires a title');
    const body = {
      title: input.title,
      content: input.content || '',
      kind: input.kind || 'fact',
      domain: input.domain || '',
      tags: input.tags || [],
      importance: input.importance ?? 0.5,
      confidence: input.confidence ?? 0.7,
      source: input.source || this.actor,
      actor: input.actor || this.actor,
      link_to: input.link_to || [],
      parent_id: input.parent_id || undefined,
    };
    return this._post(`${this.base}/api/remember`, body);
  }

  /** tie two memories together in the shared graph */
  async link(a, b, options = {}) {
    if (a && b && a === b) throw new Error('a memory cannot be linked to itself');
    if (!a || !b) throw new Error('link requires two memory ids');
    const body = {
      a,
      b,
      type: options.type || 'related',
      weight: options.weight ?? 0.6,
      note: options.note || '',
      actor: options.actor || this.actor,
    };
    return this._post(`${this.base}/api/link`, body);
  }

  /**
   * Change an existing memory — re-title it, revise it, adjust how much weight
   * it carries. This is a write to the shared store, so it is visible to
   * everyone else in the world exactly like any other edit. The store owns which
   * fields it will accept; anything else is ignored there rather than here.
   */
  async update(memoryId, changes, options = {}) {
    if (!memoryId) throw new Error('update requires a memory id');
    const allowed = ['title', 'content', 'kind', 'domain', 'tags', 'importance', 'confidence'];
    const body = { actor: options.actor || this.actor };
    for (const key of allowed) if (changes[key] !== undefined) body[key] = changes[key];
    return this._patch(`${this.base}/api/memories/${encodeURIComponent(memoryId)}`, body);
  }

  /** the ids of memories related to this one, from the live graph */
  relatedIds(memoryId, links) {
    if (!memoryId || !links) return [];
    const out = [];
    for (const link of links) {
      if (link.a === memoryId) out.push(link.b);
      else if (link.b === memoryId) out.push(link.a);
    }
    return out;
  }
}
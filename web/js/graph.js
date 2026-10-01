// Yggdrasil · graph view
//
// A force-directed map of the memories themselves. Domains act as soft
// attractors, links act as springs, everything else repels — so related
// memories drift together even when they live on different branches.

import { TAU, clamp, hsl, rnd } from './util.js';

export class GraphView {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = options;
    this.onSelect = options.onSelect || (() => {});
    this.onHover = options.onHover || (() => {});
    this.hover = null;
    this.selected = null;
    this.view = { x: 0, y: 0, k: 1 };
    this.nodes = [];
    this.links = [];
    this.alpha = 1;
    this._bind();
  }

  setState(state) {
    const previous = new Map(this.nodes.map((n) => [n.id, n]));
    const domains = new Map();
    for (const node of state.nodes) {
      if (node.kind !== 'domain') continue;
      domains.set(node.id, { hue: node.hue, cx: 0, cy: 0, n: 0 });
    }

    this.nodes = state.memories.map((memory) => {
      const node = state.nodes.find((n) => n.id === memory.node_id);
      const domainId = node ? findDomain(state.nodes, node.id) : null;
      const prev = previous.get(memory.id);
      const angle = rnd(memory.id, 'a') * TAU;
      const radius = 60 + rnd(memory.id, 'r') * 160;
      return {
        id: memory.id,
        memory,
        hue: node?.hue ?? 44,
        domain: domainId,
        x: prev ? prev.x : Math.cos(angle) * radius,
        y: prev ? prev.y : Math.sin(angle) * radius,
        vx: 0, vy: 0,
        r: 3 + memory.importance * 7,
        pinned: false,
      };
    });
    this.index = new Map(this.nodes.map((n) => [n.id, n]));
    this.links = state.links
      .map((link) => ({ ...link, a: this.index.get(link.a), b: this.index.get(link.b) }))
      .filter((link) => link.a && link.b);

    // domain attractor positions
    for (const domain of domains.values()) { domain.cx = 0; domain.cy = 0; domain.n = 0; }
    for (const node of this.nodes) {
      const domain = domains.get(node.domain);
      if (!domain) continue;
      domain.cx += node.x; domain.cy += node.y; domain.n += 1;
    }
    let index = 0;
    for (const domain of domains.values()) {
      const angle = (index / domains.size) * TAU;
      const spread = 190 + rnd(`d${index}`, 's') * 90;
      domain.tx = Math.cos(angle) * spread;
      domain.ty = Math.sin(angle) * spread * 0.72;
      domain.halo = index;
      index += 1;
    }
    this.domains = Array.from(domains.entries()).map(([id, d]) => ({ id, ...d }));
    this.alpha = 1;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.w = rect.width;
    this.h = rect.height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _bind() {
    const canvas = this.canvas;
    let dragging = null;
    let panning = false;
    let moved = 0;
    let last = { x: 0, y: 0 };

    const toWorld = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left - this.w / 2 - this.view.x) / this.view.k;
      const y = (event.clientY - rect.top - this.h / 2 - this.view.y) / this.view.k;
      return { x, y };
    };

    canvas.addEventListener('pointerdown', (event) => {
      const rect = canvas.getBoundingClientRect();
      const world = toWorld(event);
      const hit = this.pick(world);
      moved = 0;
      last = { x: event.clientX, y: event.clientY };
      if (hit) {
        dragging = hit;
        hit.pinned = true;
        this.alpha = Math.max(this.alpha, 0.55);
      } else {
        panning = true;
      }
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener('pointermove', (event) => {
      if (dragging) {
        const world = toWorld(event);
        dragging.x = world.x;
        dragging.y = world.y;
        dragging.vx = 0;
        dragging.vy = 0;
        this.alpha = Math.max(this.alpha, 0.4);
        return;
      }
      if (panning) {
        this.view.x += event.clientX - last.x;
        this.view.y += event.clientY - last.y;
        last = { x: event.clientX, y: event.clientY };
        return;
      }
      const world = toWorld(event);
      const hit = this.pick(world);
      this.hover = hit;
      this.onHover(hit ? { node: hit, x: event.clientX, y: event.clientY } : null);
      canvas.style.cursor = hit ? 'pointer' : 'grab';
    });

    const up = (event) => {
      if (dragging) {
        dragging.pinned = false;
        if (moved < 4) this.onSelect(dragging.memory);
        dragging = null;
      }
      panning = false;
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.onHover(null); });
    canvas.addEventListener('dblclick', () => { this.view = { x: 0, y: 0, k: 1 }; });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      this.view.k = clamp(this.view.k * factor, 0.25, 6);
    }, { passive: false });
  }

  pick(world) {
    let best = null;
    let bestD = 26 / this.view.k;
    for (const node of this.nodes) {
      const d = Math.hypot(node.x - world.x, node.y - world.y);
      if (d < Math.max(bestD, node.r + 4 / this.view.k) && d < bestD + node.r) {
        bestD = d;
        best = node;
      }
    }
    return best;
  }

  step(dt) {
    const alpha = this.alpha;
    if (alpha < 0.005) return;
    const domainById = new Map(this.domains.map((d) => [d.id, d]));

    // repulsion (n is small enough for the naive O(n^2) form)
    for (let i = 0; i < this.nodes.length; i++) {
      const a = this.nodes[i];
      for (let j = i + 1; j < this.nodes.length; j++) {
        const b = this.nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = (rnd(`${a.id}${b.id}`, 'j') - 0.5) * 2; dy = 1; d2 = 4; }
        const force = 2600 / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // springs
    for (const link of this.links) {
      const dx = link.b.x - link.a.x;
      const dy = link.b.y - link.a.y;
      const d = Math.hypot(dx, dy) || 1;
      const target = 78 + (1 - link.weight) * 90;
      const force = (d - target) * 0.045 * (0.4 + link.weight);
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      link.a.vx += fx; link.a.vy += fy;
      link.b.vx -= fx; link.b.vy -= fy;
    }

    // domains pull their memories together so clusters read as constellations
    for (const node of this.nodes) {
      const domain = domainById.get(node.domain);
      if (domain) {
        node.vx += (domain.tx - node.x) * 0.012;
        node.vy += (domain.ty - node.y) * 0.012;
      }
      node.vx -= node.x * 0.0016;
      node.vy -= node.y * 0.0016;
    }

    const damping = 0.82;
    for (const node of this.nodes) {
      if (node.pinned) continue;
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx * alpha;
      node.y += node.vy * alpha;
    }
    this.alpha = Math.max(0, this.alpha - dt * 0.16);
  }

  render(time) {
    if (!this.nodes.length || !this.w) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(this.w / 2 + this.view.x, this.h / 2 + this.view.y);
    ctx.scale(this.view.k, this.view.k);

    const neighbourIds = new Set();
    if (this.selected) {
      for (const link of this.links) {
        if (link.a.id === this.selected) neighbourIds.add(link.b.id);
        if (link.b.id === this.selected) neighbourIds.add(link.a.id);
      }
    }
    const focus = this.hover?.id || this.selected;

    // domain halos
    for (const domain of this.domains) {
      const g = ctx.createRadialGradient(domain.tx, domain.ty, 0, domain.tx, domain.ty, 150);
      g.addColorStop(0, hsl(domain.hue, 85, 52, 0.11));
      g.addColorStop(1, hsl(domain.hue, 85, 48, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(domain.tx, domain.ty, 150, 0, TAU);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'lighter';
    for (const link of this.links) {
      const touching = focus && (link.a.id === focus || link.b.id === focus);
      const alpha = touching ? 0.75 : focus ? 0.05 : 0.1 + link.weight * 0.22;
      ctx.beginPath();
      ctx.moveTo(link.a.x, link.a.y);
      ctx.lineTo(link.b.x, link.b.y);
      ctx.strokeStyle = hsl(touching ? 44 : 38, 85, 68, alpha);
      ctx.lineWidth = touching ? 1.4 / this.view.k : (0.4 + link.weight * 0.5) / this.view.k;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    for (const node of this.nodes) {
      const dim = focus ? (node.id === focus || neighbourIds.has(node.id) ? 1 : 0.22) : 1;
      const selected = this.selected === node.id;
      const hovered = this.hover?.id === node.id;
      const r = node.r * (selected ? 1.5 : hovered ? 1.25 : 1);
      const g = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 3.4);
      g.addColorStop(0, hsl(node.hue, 55, 95, 0.95 * dim));
      g.addColorStop(0.35, hsl(node.hue, 85, 66, 0.5 * dim));
      g.addColorStop(1, hsl(node.hue, 90, 50, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 3.4, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 0.42, 0, TAU);
      ctx.fillStyle = hsl(node.hue, 100, 96, dim);
      ctx.fill();
      if (selected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 2.1 + Math.sin(time * 2) * 1.2, 0, TAU);
        ctx.strokeStyle = hsl(node.hue + 20, 100, 82, 0.85);
        ctx.lineWidth = 1.2 / this.view.k;
        ctx.stroke();
      }
    }

    // labels for focus and for anything big enough when zoomed in
    ctx.font = `${11 / this.view.k}px "Inter", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const node of this.nodes) {
      const show = node === this.hover || node.id === this.selected
        || (this.view.k > 1.6 && node.memory.importance > 0.75)
        || (focus && (node.id === focus || neighbourIds.has(node.id)));
      if (!show) continue;
      ctx.fillStyle = 'rgba(248,238,214,0.92)';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 6;
      ctx.fillText(clip(node.memory.title, 34), node.x, node.y + node.r * 1.6);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
}

function clip(text, n) {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

function findDomain(nodes, id) {
  let current = nodes.find((n) => n.id === id);
  while (current) {
    if (current.kind === 'domain') return current.id;
    current = nodes.find((n) => n.id === current.parent_id);
  }
  return null;
}

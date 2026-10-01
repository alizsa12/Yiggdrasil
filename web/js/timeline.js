// Yggdrasil · timeline view
//
// Memory as growth rings on a time axis: every memory is a stem whose height is
// its importance, coloured by domain, with relationship arcs drawn across time.

import {
  TAU, add, clamp, el, fmtDate, fmtRelative, hsl, lerp, mix3, mul, norm, rnd, sub,
} from './util.js';

export class TimelineView {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = options;
    this.state = null;
    this.hover = null;
    this.selected = null;
    this.pan = 0;            // 0..1 window start
    this.span = 1;           // 0..1 window width
    this.onSelect = options.onSelect || (() => {});
    this.onHover = options.onHover || (() => {});
    this._bind();
  }

  setState(state) {
    this.state = state;
    const times = state.memories.map((m) => m.created_at);
    this.t0 = Math.min(...times, Date.now() / 1000);
    this.t1 = Math.max(...times, this.t0 + 1);
    this.events = state.memories
      .map((m) => ({ m, x: m.created_at, node: state.nodes.find((n) => n.id === m.node_id) }))
      .sort((a, b) => a.x - b.x);
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
    let dragging = false;
    let lastX = 0;
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      if (dragging) {
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        this.pan = clamp(this.pan - (dx / rect.width) * this.span, 0, 1 - this.span);
        return;
      }
      const hit = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      this.hover = hit;
      this.onHover(hit ? { event: hit, x: e.clientX, y: e.clientY } : null);
      canvas.style.cursor = hit ? 'pointer' : 'grab';
    });
    const up = (e) => {
      if (dragging) {
        dragging = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.onHover(null); });
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const hit = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) this.onSelect(hit.event.m);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.0012);
      const centre = this.pan + this.span / 2;
      this.span = clamp(this.span * factor, 0.02, 1);
      this.pan = clamp(centre - this.span / 2, 0, 1 - this.span);
      this.resize();
    }, { passive: false });
  }

  xOf(ts) {
    const pad = 0.06;
    const view = this.t0 + (this.t1 - this.t0) * this.pan;
    const width = (this.t1 - this.t0) * this.span;
    return this.pad + ((ts - view) / width) * (this.w - this.pad * 2);
  }

  hitTest(x, y) {
    if (!this.events) return null;
    let best = null;
    let bestD = 26;
    for (const event of this.events) {
      const px = this.xOf(event.x);
      const py = this.yOf(event);
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) { bestD = d; best = event; }
    }
    return best;
  }

  yOf(event) {
    const base = this.h - 58;
    const jitter = (rnd(event.m.id, 'j') - 0.5) * 26;
    return base - (12 + event.m.importance * (base * 0.62)) + jitter * (1 - event.m.importance);
  }

  /** month / week ticks, the baseline, and the faint importance rules */
  drawGrid(ctx, view0, view1) {
    const base = this.h - 58;
    const span = view1 - view0;

    ctx.save();
    ctx.strokeStyle = 'rgba(230,200,140,0.07)';
    ctx.lineWidth = 1;
    for (const level of [0.25, 0.5, 0.75, 1]) {
      const y = base - level * (base * 0.62);
      ctx.beginPath();
      ctx.moveTo(this.pad, y);
      ctx.lineTo(this.w - this.pad, y);
      ctx.stroke();
    }

    // pick a tick spacing that yields 6-12 labels
    const candidates = [
      { unit: 'month', step: 1 }, { unit: 'month', step: 3 }, { unit: 'month', step: 6 },
      { unit: 'year', step: 1 },
    ];
    const target = 9;
    const rough = span / target;
    const MONTH = 2629746;
    const YEAR = 31556952;
    let unit = candidates[0];
    for (const c of candidates) {
      if ((c.unit === 'month' ? MONTH * c.step : YEAR * c.step) >= rough) { unit = c; break; }
      unit = c;
    }
    const stepSec = unit.unit === 'month' ? MONTH * unit.step : YEAR * unit.step;

    const first = new Date(view0 * 1000);
    let cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1) / 1000;
    if (unit.unit === 'year') cursor = Date.UTC(first.getUTCFullYear(), 0, 1) / 1000;
    ctx.font = '500 10px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    while (cursor < view1) {
      const x = this.xOf(cursor);
      if (x >= this.pad - 1) {
        ctx.strokeStyle = 'rgba(230,200,140,0.13)';
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.lineTo(x, base + 6);
        ctx.stroke();
        const d = new Date(cursor * 1000);
        const label = unit.unit === 'year'
          ? d.toLocaleDateString(undefined, { year: 'numeric' })
          : d.toLocaleDateString(undefined, { month: 'short' })
            + (d.getUTCMonth() === 0 ? ` ${d.getUTCFullYear()}` : '');
        ctx.fillStyle = 'rgba(214,190,150,0.55)';
        ctx.fillText(label, x, base + 11);
      }
      cursor += stepSec;
    }

    ctx.beginPath();
    ctx.moveTo(this.pad, base);
    ctx.lineTo(this.w - this.pad, base);
    ctx.strokeStyle = 'rgba(230,200,140,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  render(time) {
    if (!this.state || !this.w) return;
    const ctx = this.ctx;
    const { t0, t1 } = this;
    const view0 = t0 + (t1 - t0) * this.pan;
    const view1 = t0 + (t1 - t0) * (this.pan + this.span);

    ctx.clearRect(0, 0, this.w, this.h);
    const bg = ctx.createLinearGradient(0, 0, 0, this.h);
    bg.addColorStop(0, 'rgba(16,11,6,0.0)');
    bg.addColorStop(1, 'rgba(9,6,4,0.55)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.w, this.h);

    this.pad = 40;
    this.drawGrid(ctx, view0, view1);

    // density: memories created per bucket, as a soft area chart
    const buckets = 46;
    const counts = new Array(buckets).fill(0);
    for (const event of this.events) {
      if (event.x < view0 || event.x > view1) continue;
      const i = Math.floor(((event.x - view0) / (view1 - view0)) * buckets);
      counts[clamp(i, 0, buckets - 1)] += 1;
    }
    const peak = Math.max(1, ...counts);
    ctx.beginPath();
    ctx.moveTo(this.pad, this.h - 58);
    for (let i = 0; i < buckets; i++) {
      const x = this.pad + (i / (buckets - 1)) * (this.w - this.pad * 2);
      const y = this.h - 58 - (counts[i] / peak) * 54;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(this.w - this.pad, this.h - 58);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, this.h - 112, 0, this.h - 58);
    fill.addColorStop(0, 'rgba(230,190,120,0.18)');
    fill.addColorStop(1, 'rgba(230,190,120,0.02)');
    ctx.fillStyle = fill;
    ctx.fill();

    // relationship arcs across time
    ctx.globalCompositeOperation = 'lighter';
    for (const link of this.state.links) {
      const a = this.events.find((e) => e.m.id === link.a);
      const b = this.events.find((e) => e.m.id === link.b);
      if (!a || !b) continue;
      const ax = this.xOf(a.x);
      const bx = this.xOf(b.x);
      if ((ax < -20 && bx < -20) || (ax > this.w + 20 && bx > this.w + 20)) continue;
      const ay = this.yOf(a);
      const by = this.yOf(b);
      const touching = this.selected && (link.a === this.selected.id || link.b === this.selected.id);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      const peakY = Math.min(ay, by) - Math.abs(bx - ax) * 0.12 - 20;
      ctx.quadraticCurveTo((ax + bx) / 2, peakY, bx, by);
      ctx.strokeStyle = touching ? hsl(46, 95, 78, 0.75)
        : hsl(40, 80, 64, this.hover ? 0.05 : 0.16);
      ctx.lineWidth = touching ? 1.4 : 0.5;
      ctx.stroke();
    }

    // stems + orbs
    for (const event of this.events) {
      const x = this.xOf(event.x);
      if (x < -30 || x > this.w + 30) continue;
      const y = this.yOf(event);
      const hue = event.node?.hue ?? 44;
      const base = this.h - 58;
      const selected = this.selected && this.selected.id === event.m.id;
      const hovered = this.hover === event;

      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x, y);
      ctx.strokeStyle = hsl(hue, 75, 66, selected ? 0.8 : hovered ? 0.55 : 0.22);
      ctx.lineWidth = selected ? 1.6 : hovered ? 1.2 : 0.7;
      ctx.stroke();

      const r = 2.4 + event.m.importance * 7;
      const glow = r * (hovered || selected ? 5 : 3.4);
      const sprite = orbSprite(hue);
      ctx.globalAlpha = selected || hovered ? 0.95 : 0.5 + event.m.confidence * 0.3;
      ctx.drawImage(sprite, x - glow, y - glow, glow * 2, glow * 2);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.4, r * 0.5), 0, TAU);
      ctx.fillStyle = hsl(hue, 45, 96, selected ? 1 : 0.9);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // labels for the notable ones
    ctx.textBaseline = 'middle';
    const shown = this.events
      .filter((e) => e.x > 0 && e.x < this.w && e.m.importance > 0.8)
      .slice(0, 14);
    for (const event of shown) {
      const x = this.xOf(event.x);
      const y = this.yOf(event);
      ctx.font = '500 10.5px "Inter", system-ui, sans-serif';
      ctx.textAlign = x > this.w - 140 ? 'right' : 'left';
      ctx.fillStyle = 'rgba(246,232,200,0.66)';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 5;
      ctx.fillText(event.m.title.slice(0, 34), x + (x > this.w - 140 ? -10 : 10), y - 12);
      ctx.shadowBlur = 0;
    }
  }
}

const spriteCache = new Map();
function orbSprite(hue) {
  const key = Math.round(hue / 12) * 12;
  let sprite = spriteCache.get(key);
  if (sprite) return sprite;
  const size = 64;
  sprite = document.createElement('canvas');
  sprite.width = sprite.height = size;
  const ctx = sprite.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.2, hsl(key, 55, 92, 0.82));
  g.addColorStop(0.5, hsl(key, 85, 62, 0.26));
  g.addColorStop(1, hsl(key, 95, 45, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  spriteCache.set(key, sprite);
  return sprite;
}

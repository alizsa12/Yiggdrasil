// Yggdrasil · the organism
//
// A living world tree, not a diagram of one. What is drawn here:
//
//   · a colossal trunk and limbs, grown from the layout's world-space veins
//   · a vascular system inside them — bright vessels, sap running outward,
//     and neurons grown *into* the wood rather than floating beside it
//   · relationships routed through the trunk, the way a signal travels wood
//   · nine realms, each a volume of space with great boughs crossing it;
//     fly inside one and its memories are where they were grown
//   · roots falling into the dark, and the cosmos behind all of it

import {
  TAU, add, clamp, cross, dot, easeOutCubic, hsl, lerp, mix3, mul, norm, rnd, sub, basis, dist,
} from './util.js';

const SPRITE_SIZE = 128;
const spriteCache = new Map();

function glowSprite(hue, core = 0.09) {
  const key = `${Math.round(hue / 8) * 8}|${core}`;
  let sprite = spriteCache.get(key);
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = sprite.height = SPRITE_SIZE;
  const ctx = sprite.getContext('2d');
  const r = SPRITE_SIZE / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(core, hsl(hue, 45, 97, 0.95));
  g.addColorStop(core + 0.16, hsl(hue, 80, 74, 0.3));
  g.addColorStop(0.5, hsl(hue, 90, 54, 0.08));
  g.addColorStop(1, hsl(hue, 95, 44, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  spriteCache.set(key, sprite);
  return sprite;
}

function dotSprite(r = 3, color = 'rgba(255,238,196,0.9)') {
  const key = `dot${r}${color}`;
  let sprite = spriteCache.get(key);
  if (sprite) return sprite;
  const size = r * 8;
  sprite = document.createElement('canvas');
  sprite.width = sprite.height = size;
  const ctx = sprite.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color.replace(/[\d.]+\)$/, '0.3)'));
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  spriteCache.set(key, sprite);
  return sprite;
}

export class Organism {
  constructor(engine) {
    this.engine = engine;
    this.motes = [];
    this.cosmos = null;
    this.cosmosKey = '';
    this.seeded = false;
  }

  get ctx() { return this.engine.ctx; }
  get layout() { return this.engine.layout; }
  get state() { return this.engine.state; }

  // ───────────────────────────────────────────────────────────────── cosmos
  paintCosmos() {
    const { width, height } = this.engine;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const key = `${w}x${h}:${this.engine.realmId || 'exterior'}`;
    if (this.cosmos && this.cosmosKey === key) return this.cosmos;

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');

    const realm = this.currentRealm();
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    if (realm) {
      // inside a realm: the dark is warm and close
      bg.addColorStop(0, '#0b0805');
      bg.addColorStop(0.55, '#0d0906');
      bg.addColorStop(1, '#070503');
    } else {
      bg.addColorStop(0, '#04040a');
      bg.addColorStop(0.45, '#080705');
      bg.addColorStop(1, '#050406');
    }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'lighter';
    if (realm) {
      const hue = realm.hue ?? 44;
      const g = ctx.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, Math.max(w, h) * 0.8);
      g.addColorStop(0, hsl(hue, 60, 40, 0.3));
      g.addColorStop(0.35, hsl(hue, 55, 26, 0.16));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    } else {
      // a nebula band behind the tree, and the tree's own light at its foot
      const blooms = [
        { x: 0.24, y: 0.2, r: 0.5, hue: 28, a: 0.1 },
        { x: 0.78, y: 0.36, r: 0.46, hue: 44, a: 0.075 },
        { x: 0.52, y: 0.92, r: 0.62, hue: 40, a: 0.17 },
        { x: 0.08, y: 0.72, r: 0.4, hue: 214, a: 0.05 },
      ];
      for (const b of blooms) {
        const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r * Math.max(w, h));
        g.addColorStop(0, hsl(b.hue, b.hue > 100 ? 55 : 80, 48, b.a));
        g.addColorStop(0.45, hsl(b.hue, 75, 40, b.a * 0.24));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    }

    // stars — sparse, warm, and only outside
    if (!realm) {
      for (let i = 0; i < 320; i++) {
        const x = rnd(`s${i}`, 'x') * w;
        const y = rnd(`s${i}`, 'y') * h;
        const size = rnd(`s${i}`, 'd') * 1.3 + 0.15;
        const alpha = 0.04 + rnd(`s${i}`, 'a') * 0.3;
        ctx.fillStyle = `rgba(255,240,210,${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    this.cosmos = canvas;
    this.cosmosKey = key;
    return canvas;
  }

  currentRealm() {
    const id = this.engine.realmId;
    return id ? this.layout?.realms?.realms.get(id) : null;
  }

  // ───────────────────────────────────────────────────────────────── motes
  seedMotes() {
    this.motes = [];
    const realm = this.currentRealm();
    const count = this.engine.reducedMotion ? 40 : 200;
    for (let i = 0; i < count; i++) {
      const spread = realm ? realm.radius * 2.2 : 210;
      this.motes.push({
        x: (rnd(`m${i}`, 'x') - 0.5) * spread,
        y: (rnd(`m${i}`, 'y') - 0.5) * spread,
        z: (rnd(`m${i}`, 'z') - 0.5) * spread,
        phase: rnd(`m${i}`, 'p') * TAU,
        speed: 0.25 + rnd(`m${i}`, 's') * 0.8,
        size: 0.4 + rnd(`m${i}`, 'd') * 1.5,
        hue: realm ? (realm.hue ?? 44) - 6 + rnd(`m${i}`, 'h') * 18 : 34 + rnd(`m${i}`, 'h') * 26,
      });
    }
    this.seeded = true;
  }

  drawMotes(ctx, dt) {
    if (!this.seeded) this.seedMotes();
    const realm = this.currentRealm();
    const origin = realm ? realm.center : [0, 0, 0];
    const sprite = dotSprite(2, 'rgba(255,240,200,0.85)');
    const t = this.engine.time;
    const rise = realm ? realm.radius * 0.9 : 150;
    const span = realm ? realm.radius * 2.2 : 220;
    for (const mote of this.motes) {
      const y = ((mote.y + t * mote.speed * 3 + span / 2) % span) - span / 2;
      const sway = Math.sin(t * 0.4 + mote.phase) * 1.8;
      const world = add(origin, [mote.x + sway, y, mote.z + Math.cos(t * 0.33 + mote.phase) * 1.8]);
      const p = this.engine.project(world);
      if (!p || p.a < 0.04) continue;
      const size = mote.size * p.s * 0.6;
      ctx.globalAlpha = 0.45 * p.a * (0.45 + 0.55 * Math.sin(t * 1.2 + mote.phase));
      ctx.drawImage(sprite, p.x - size, p.y - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1;
    void rise;
  }

  // ───────────────────────────────────────────────────────────────── limbs
  /** project a world polyline to screen, dropping it if any step is behind us */
  screenPath(points) {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const p = this.engine.project(points[i]);
      if (!p) return null;
      out.push(p);
    }
    return out;
  }

  /**
   * One limb: bark outside, vein inside, sap running through it.
   * The bark is deliberately drawn *over* the vein's ends so the vessel reads
   * as running under the surface rather than sitting on top of it.
   */
  drawLimb(ctx, points, worldWidth, hue, factor, seed, opts = {}) {
    const screen = this.screenPath(points);
    if (!screen || screen.length < 2) return null;
    const near = screen[0].z;
    const scale = this.engine.focal / near;
    const width = Math.max(1.1, worldWidth * scale * (opts.widthScale ?? 1));
    const t = this.engine.time;

    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(screen[0].x, screen[0].y);
      for (let i = 1; i < screen.length - 1; i++) {
        const mx = (screen[i].x + screen[i + 1].x) / 2;
        const my = (screen[i].y + screen[i + 1].y) / 2;
        ctx.quadraticCurveTo(screen[i].x, screen[i].y, mx, my);
      }
      ctx.lineTo(screen[screen.length - 1].x, screen[screen.length - 1].y);
    };

    const wood = opts.pass !== 'vein';
    const glow = opts.pass !== 'wood';

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (wood) {
      // Bark is opaque and drawn in normal compositing, so a nearer limb
      // occludes the ones behind it. Thirty limbs crossing a colossal trunk
      // must not accumulate into a white blowout.
      trace();
      ctx.strokeStyle = `rgba(16,10,5,${clamp(factor, 0, 1)})`;
      ctx.lineWidth = width * 1.22;
      ctx.stroke();

      trace();
      ctx.strokeStyle = hsl(hue, 36, 22, clamp(factor, 0, 1));
      ctx.lineWidth = width * 1.06;
      ctx.stroke();

      // a lit core, wide enough to round out thick boughs — without it a
      // large limb is just a dark pipe
      trace();
      ctx.strokeStyle = hsl(hue, 44, 36, 0.78 * factor);
      ctx.lineWidth = width * 0.74;
      ctx.stroke();
    }

    // the lit side of the limb
    if (wood) {
      ctx.save();
      ctx.translate(-Math.cos(this.engine.cur.yaw) * width * 0.22, -width * 0.22);
      trace();
      ctx.strokeStyle = hsl(hue, 55, 58, 0.15 * factor);
      ctx.lineWidth = clamp(width * 0.12, 0.6, 9);
      ctx.stroke();
      ctx.restore();
    }

    // age: long fissures and knots in the thick wood only. This is the
    // difference between a colossal ancient trunk and a smooth tube.
    if (wood && !opts.thin && width > 3.2) {
      const fissures = Math.min(4, 1 + Math.floor(width / 9));
      for (let f = 0; f < fissures; f++) {
        const off = (rnd(seed, `f${f}`) - 0.5) * width * 0.78;
        const phase = rnd(seed, `fp${f}`) * 6.28;
        ctx.beginPath();
        for (let i = 0; i < screen.length - 1; i++) {
          const a = screen[i];
          const b = screen[i + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          // perpendicular offset, wandering so it reads as a crack
          const wob = Math.sin(i * 0.7 + phase) * width * 0.1;
          const px = (a.x + b.x) / 2 - (dy / len) * (off + wob);
          const py = (a.y + b.y) / 2 + (dx / len) * (off + wob);
          if (i === 0) ctx.moveTo(a.x + (dx / len) * off, a.y + (dy / len) * off);
          ctx.quadraticCurveTo(
            (a.x + b.x) / 2 - (dy / len) * (off + wob),
            (a.y + b.y) / 2 + (dx / len) * (off + wob), px, py);
        }
        ctx.strokeStyle = `rgba(20,12,6,${0.3 * factor})`;
        ctx.lineWidth = Math.max(0.5, width * 0.055);
        ctx.stroke();
      }
      // a knot or two, where a branch died long ago
      if (width > 7 && rnd(seed, 'knot') > 0.45) {
        const at = Math.floor(screen.length * (0.25 + rnd(seed, 'kat') * 0.5));
        const k = screen[at];
        const kr = width * (0.16 + rnd(seed, 'kr') * 0.14);
        const g = ctx.createRadialGradient(k.x, k.y, 0, k.x, k.y, kr);
        g.addColorStop(0, `rgba(18,11,5,${0.7 * factor})`);
        g.addColorStop(0.7, `rgba(30,19,9,${0.4 * factor})`);
        g.addColorStop(1, 'rgba(30,19,9,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(k.x, k.y, kr, kr * 0.78, 0, 0, TAU);
        ctx.fill();
      }
    }

    // the vein: a bright vessel inside the wood. It stays a *vessel* even in a
    // colossal limb, so its width is capped rather than scaling with the wood
    // — otherwise the vein becomes a highway painted down the trunk.
    if (glow && !opts.thin) {
      trace();
      ctx.strokeStyle = hsl(hue, 85, 74, 0.15 * factor);
      ctx.lineWidth = clamp(width * 0.09, 0.6, 7);
      ctx.stroke();

      trace();
      ctx.strokeStyle = hsl(hue, 95, 90, 0.28 * factor);
      ctx.lineWidth = clamp(width * 0.03, 0.45, 3.2);
      ctx.setLineDash([clamp(width * 0.5, 2, 26), clamp(width * 2.2, 6, 90)]);
      ctx.lineDashOffset = -((t * (14 + rnd(seed, 'f') * 26)) % 200);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    return screen[screen.length - 1];
  }

  /** the fine vessel that reaches from a bough to one neuron */
  drawCapillary(ctx, nodeId, hue, factor) {
    const points = this.layout.capillaries.get(nodeId);
    if (!points) return;
    const screen = this.screenPath(points);
    if (!screen) return;
    const width = clamp(this.engine.focal / screen[0].z * 0.12, 0.4, 2.2);
    ctx.beginPath();
    ctx.moveTo(screen[0].x, screen[0].y);
    for (let i = 1; i < screen.length - 1; i++) {
      const mx = (screen[i].x + screen[i + 1].x) / 2;
      const my = (screen[i].y + screen[i + 1].y) / 2;
      ctx.quadraticCurveTo(screen[i].x, screen[i].y, mx, my);
    }
    ctx.strokeStyle = hsl(hue, 90, 72, 0.42 * factor);
    ctx.lineWidth = width;
    ctx.stroke();
  }

  // ───────────────────────────────────────────────────────────────── neurons
  /**
   * A memory as a neuron grown into the wood: a soma, dendrites that reach out
   * of the limb, and an axon that runs back down the vessel. The socket of
   * dark around it is what makes it read as *embedded*.
   */
  drawNeuron(ctx, screen, worldRadius, hue, memory, opts = {}) {
    const { factor = 1, selected = false, hovered = false, matched = false } = opts;
    const importance = memory?.importance ?? 0.5;
    const confidence = memory?.confidence ?? 0.7;
    const pulse = 1 + Math.sin(this.engine.time * (0.5 + importance * 0.8)
      + rnd(opts.seed || 'x', 'b') * TAU) * 0.08;
    const radius = Math.max(1.8, worldRadius * pulse);

    // socket: a hollow in the wood
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius * 2.1, 0, TAU);
    ctx.fillStyle = `rgba(20,13,7,${0.5 * factor})`;
    ctx.fill();

    // dendrites — the neuron's own vascular reach. Length and weight are
    // capped, not proportional: a cell seen close up must still read as a
    // cell, not as a starburst filling the screen.
    const count = 4 + Math.round(importance * 5);
    for (let i = 0; i < count; i++) {
      const angle = rnd(opts.seed || 'x', `d${i}`) * TAU + i * 2.399;
      const length = clamp(radius * (2.4 + rnd(opts.seed || 'x', `l${i}`) * 3.2), 5, 86);
      const end = {
        x: screen.x + Math.cos(angle) * length,
        y: screen.y + Math.sin(angle) * length,
      };
      const control = {
        x: screen.x + Math.cos(angle) * length * 0.5 + (rnd(opts.seed || 'x', `cx${i}`) - 0.5) * length * 0.7,
        y: screen.y + Math.sin(angle) * length * 0.5 + (rnd(opts.seed || 'x', `cy${i}`) - 0.5) * length * 0.7,
      };
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y);
      ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
      ctx.strokeStyle = hsl(hue, 80, 68, 0.24 * factor);
      ctx.lineWidth = clamp(radius * 0.18, 0.35, 4);
      ctx.stroke();

      // the bright inner half, tapering toward the tip
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y);
      ctx.quadraticCurveTo(control.x, control.y,
        lerp(screen.x, end.x, 0.6), lerp(screen.y, end.y, 0.6));
      ctx.strokeStyle = hsl(hue, 60, 88, 0.42 * factor);
      ctx.lineWidth = clamp(radius * 0.24, 0.4, 5);
      ctx.stroke();

      // terminal twig
      if (importance > 0.75) {
        const twig = { x: end.x + Math.cos(angle + 0.9) * length * 0.35, y: end.y + Math.sin(angle + 0.9) * length * 0.35 };
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.quadraticCurveTo((end.x + twig.x) / 2, (end.y + twig.y) / 2 - length * 0.2, twig.x, twig.y);
        ctx.strokeStyle = hsl(hue, 75, 80, 0.4 * factor);
        ctx.lineWidth = Math.max(0.3, radius * 0.12);
        ctx.stroke();
      }
    }

    // the soma: a lit cell, and a faint membrane around it
    const halo = clamp(radius * 7, 12, 120);
    ctx.globalAlpha = (0.1 + confidence * 0.18) * factor;
    ctx.drawImage(glowSprite(hue), screen.x - halo, screen.y - halo, halo * 2, halo * 2);
    ctx.globalAlpha = 1;

    const core = clamp(radius * 2.3, 3, 34);
    ctx.globalAlpha = (0.35 + confidence * 0.3) * factor;
    ctx.drawImage(glowSprite(hue, 0.14), screen.x - core, screen.y - core, core * 2, core * 2);
    ctx.globalAlpha = 1;

    ctx.beginPath();
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * TAU;
      const wobble = radius * (0.85 + 0.2 * Math.sin(a * 3 + rnd(opts.seed || 'x', 'm') * 6));
      const px = screen.x + Math.cos(a) * wobble;
      const py = screen.y + Math.sin(a) * wobble;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = hsl(hue, 70, 86, 0.55 * factor);
    ctx.lineWidth = 0.8;
    ctx.stroke();

    if (selected || hovered || matched) {
      const ring = radius * (selected ? 4.4 : matched ? 3.4 : 3);
      const spin = this.engine.time * (selected ? 0.9 : 0.4);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, ring, 0, TAU);
      ctx.strokeStyle = selected ? 'rgba(255,250,238,0.9)'
        : hsl(hue, 90, 80, matched ? 0.7 : 0.4);
      ctx.lineWidth = selected ? 1.5 : 1;
      ctx.stroke();
      if (selected) {
        // a firing pulse travelling out along every dendrite
        for (let i = 0; i < 6; i++) {
          const a = spin + (i * TAU) / 6;
          const rr = ring * (1.15 + 0.2 * Math.sin(spin * 2 + i));
          ctx.beginPath();
          ctx.arc(screen.x + Math.cos(a) * rr, screen.y + Math.sin(a) * rr, 1.5, 0, TAU);
          ctx.fillStyle = 'rgba(255,248,226,0.85)';
          ctx.fill();
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────── the tree
  /** the limbs, far to near, so painter's ordering gives the wood depth */
  limbQueue() {
    const engine = this.engine;
    const layout = this.layout;
    const visible = engine.vis.visible;
    const limbs = [];
    for (const [id, vein] of layout.veins) {
      if (!visible.has(id)) continue;
      const node = layout.byId.get(id);
      if (!node) continue;
      const parent = node.parent_id ? layout.pos.get(node.parent_id) : null;
      if (!parent) continue;
      limbs.push({ id, node, points: vein.points, z: engine.project(vein.points[0])?.z ?? Infinity });
    }
    limbs.sort((a, b) => b.z - a.z);
    return limbs;
  }

  /** pass one: solid wood. Opaque, occluding, no additive light. */
  drawExteriorWood(ctx) {
    const engine = this.engine;
    const layout = this.layout;

    // roots falling into the dark beneath the trunk
    this.drawRoots(ctx, 'wood');

    // the bole the limbs grow from, behind them so the limbs read as leaving it
    this.drawBole(ctx, 'wood');

    for (const limb of this.limbQueue()) {
      const factor = engine.factorFor({ node: limb.node, p: engine.projected.get(limb.id) });
      if (factor < 0.02) continue;
      const depth = layout.depthOf.get(limb.id) || 1;
      const worldWidth = (layout.thick.get(limb.id) || 1) * (depth <= 1 ? 1 : 0.8);
      this.drawLimb(ctx, limb.points, worldWidth, limb.node.hue ?? 44, factor, limb.id, {
        thin: depth > 3, pass: 'wood',
      });
    }
  }

  /** pass two: the vascular system glowing through and over the wood */
  drawExteriorGlow(ctx) {
    const engine = this.engine;
    const layout = this.layout;
    const visible = engine.vis.visible;

    this.drawRoots(ctx, 'vein');
    this.drawBole(ctx, 'vein');

    for (const limb of this.limbQueue()) {
      const factor = engine.factorFor({ node: limb.node, p: engine.projected.get(limb.id) });
      if (factor < 0.02) continue;
      const depth = layout.depthOf.get(limb.id) || 1;
      const worldWidth = (layout.thick.get(limb.id) || 1) * (depth <= 1 ? 1 : 0.8);
      this.drawLimb(ctx, limb.points, worldWidth, limb.node.hue ?? 44, factor, limb.id, {
        thin: depth > 3, pass: 'vein',
      });
    }

    // capillaries, then the neurons they feed
    const neurons = [];
    for (const [id, p] of engine.projected) {
      const node = layout.byId.get(id);
      if (!node || node.kind !== 'leaf' || !visible.has(id)) continue;
      const factor = engine.factorFor({ node, p });
      if (factor < 0.02) continue;
      const memory = layout.memoryByNode.get(id);
      const hue = node.hue ?? 44;
      this.drawCapillary(ctx, id, hue, factor);
      neurons.push({ id, p, memory, hue, factor });
    }
    neurons.sort((a, b) => b.p.z - a.p.z);
    for (const neuron of neurons) {
      this.drawNeuron(ctx, neuron.p, neuron.p.r, neuron.hue, neuron.memory, {
        factor: neuron.factor,
        selected: engine.selected === neuron.id,
        hovered: engine.hovered === neuron.id,
        matched: !!(neuron.memory && engine.matches.has(neuron.memory.id)),
        seed: neuron.id,
      });
    }

    this.drawRootHeart(ctx);
    this.drawRealmVolumes(ctx);
  }

  /** the trunk's heart, where every realm is fed from */
  drawRootHeart(ctx) {
    const rootId = this.state?.meta?.root_id;
    const p = rootId ? this.engine.projected.get(rootId) : null;
    if (!p) return;
    const beat = 1 + Math.sin(this.engine.time * 1.05) * 0.08;
    // bounded on purpose: the heart is a glow inside the foot of the tree, not
    // a light source the size of the world
    const size = clamp(p.r * 1.5, 18, 220) * beat;
    ctx.globalAlpha = 0.32;
    ctx.drawImage(glowSprite(46), p.x - size, p.y - size, size * 2, size * 2);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 3; i++) {
      const phase = (this.engine.time * 0.24 + i / 3) % 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, clamp(p.r * (0.6 + phase * 1.9), 6, 160), 0, TAU);
      ctx.strokeStyle = hsl(42, 90, 74, (1 - phase) * 0.13);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /**
   * The bole: the trunk drawn as wood, wide at the foot and tapering up. It is
   * what the limbs grow out of, and without it the tree is a burst.
   */
  /**
   * The bole. Drawn as one filled silhouette rather than a stack of round-capped
   * segments, so a colossal trunk reads as a smooth tapered column instead of a
   * pile of bands.
   */
  drawBole(ctx, pass = 'both') {
    const bole = this.layout.bole;
    if (!bole) return;
    const screen = this.screenPath(bole.points);
    if (!screen || screen.length < 2) return;
    const wood = pass !== 'vein';
    const vein = pass !== 'wood';
    const focal = this.engine.focal;

    // build the silhouette: out along one flank and back along the other
    const left = [];
    const right = [];
    for (let i = 0; i < screen.length; i++) {
      const a = screen[i];
      const prev = screen[Math.max(0, i - 1)];
      const next = screen[Math.min(screen.length - 1, i + 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const r = bole.radii[i] * (focal / (a.z || 1));
      const nx = -dy / len;
      const ny = dx / len;
      left.push([a.x + nx * r, a.y + ny * r]);
      right.push([a.x - nx * r, a.y - ny * r]);
    }

    if (wood) {
      ctx.beginPath();
      ctx.moveTo(left[0][0], left[0][1]);
      for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
      ctx.closePath();
      // Shade across the trunk, not down it: the gradient has to run from one
      // flank to the other or the column comes out flat.
      const mid = Math.floor(left.length / 2);
      const g = ctx.createLinearGradient(left[mid][0], left[mid][1], right[mid][0], right[mid][1]);
      g.addColorStop(0, hsl(bole.hue, 42, 10, 1));
      g.addColorStop(0.26, hsl(bole.hue, 38, 20, 1));
      g.addColorStop(0.52, hsl(bole.hue, 44, 33, 1));
      g.addColorStop(0.74, hsl(bole.hue, 40, 24, 1));
      g.addColorStop(1, hsl(bole.hue, 34, 9, 1));
      ctx.fillStyle = g;
      ctx.fill();

      // bark: long vertical fissures following the taper, and old growth scars
      ctx.save();
      ctx.clip();
      for (let f = 0; f < 7; f++) {
        const frac = 0.12 + f * 0.13 + (rnd(bole.hue, `bf${f}`) - 0.5) * 0.05;
        ctx.beginPath();
        for (let i = 0; i < left.length; i++) {
          const wob = Math.sin(i * 0.9 + f) * 0.035;
          const x = left[i][0] + (right[i][0] - left[i][0]) * (frac + wob);
          const y = left[i][1] + (right[i][1] - left[i][1]) * (frac + wob);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(14,8,3,${0.24 + rnd(bole.hue, `bd${f}`) * 0.2})`;
        ctx.lineWidth = 1 + rnd(bole.hue, `bw${f}`) * 2.6;
        ctx.stroke();
      }
      // the scars where limbs once left, low on the old trunk
      for (let k = 0; k < 4; k++) {
        const at = Math.floor(left.length * (0.2 + rnd(bole.hue, `sc${k}`) * 0.6));
        const a = left[at];
        const b = right[at];
        const rr = Math.hypot(b[0] - a[0], b[1] - a[1]) * (0.1 + rnd(bole.hue, `sr${k}`) * 0.1);
        const cx = (a[0] + b[0]) / 2;
        const cy = (a[1] + b[1]) / 2;
        const sc = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
        sc.addColorStop(0, 'rgba(10,6,2,0.75)');
        sc.addColorStop(0.65, 'rgba(24,15,7,0.4)');
        sc.addColorStop(1, 'rgba(24,15,7,0)');
        ctx.fillStyle = sc;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rr, rr * 0.7, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();

      // the dark seam that separates the lit flank from the core
      ctx.beginPath();
      ctx.moveTo(left[0][0], left[0][1]);
      for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
      ctx.strokeStyle = 'rgba(10,6,2,0.9)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    if (vein) {
      // the main vessel up the heartwood, kept thin however wide the trunk
      ctx.beginPath();
      ctx.moveTo(screen[0].x, screen[0].y);
      for (let i = 1; i < screen.length - 1; i++) {
        const mx = (screen[i].x + screen[i + 1].x) / 2;
        const my = (screen[i].y + screen[i + 1].y) / 2;
        ctx.quadraticCurveTo(screen[i].x, screen[i].y, mx, my);
      }
      const w = clamp(bole.radii[0] * (focal / (screen[0].z || 1)) * 0.05, 0.8, 7);
      ctx.strokeStyle = hsl(bole.hue, 88, 76, 0.22);
      ctx.lineWidth = w;
      ctx.stroke();
    }
  }

  /**
   * The buttress roots, drawn as filled fins rather than strokes. Each fin
   * leaves the bole partway up its flank, so it has to be a silhouette with a
   * real width — a stroked tube always reads as a separate object standing
   * next to the tree instead of wood growing out of it.
   */
  drawRoots(ctx, pass = 'both') {
    const roots = this.layout.roots;
    if (!roots || !roots.length) return;
    const wood = pass !== 'vein';
    const vein = pass !== 'wood';
    const focal = this.engine.focal;

    for (const root of roots) {
      const screen = this.screenPath(root.points);
      if (!screen || screen.length < 2) continue;

      // silhouette: out along one edge of the fin and back along the other
      const left = [];
      const right = [];
      for (let i = 0; i < screen.length; i++) {
        const a = screen[i];
        const prev = screen[Math.max(0, i - 1)];
        const next = screen[Math.min(screen.length - 1, i + 1)];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        const w = root.widths[i] * (focal / (a.z || 1));
        left.push([a.x + (-dy / len) * w, a.y + (dx / len) * w]);
        right.push([a.x - (-dy / len) * w, a.y - (dx / len) * w]);
      }
      const fade = clamp((screen[0].a ?? 1) * 0.95, 0, 1);

      if (wood) {
        ctx.beginPath();
        ctx.moveTo(left[0][0], left[0][1]);
        for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
        for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
        ctx.closePath();
        const mid = Math.floor(left.length * 0.35);
        const g = ctx.createLinearGradient(left[mid][0], left[mid][1], right[mid][0], right[mid][1]);
        g.addColorStop(0, hsl(root.hue, 42, 9, fade));
        g.addColorStop(0.36, hsl(root.hue, 38, 18, fade));
        g.addColorStop(0.66, hsl(root.hue, 44, 29, fade));
        g.addColorStop(1, hsl(root.hue, 34, 8, fade));
        ctx.fillStyle = g;
        ctx.fill();
        // the seam where the fin leaves the wood, so the join reads as grain
        ctx.beginPath();
        ctx.moveTo(left[0][0], left[0][1]);
        for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
        ctx.strokeStyle = `rgba(10,6,2,${0.7 * fade})`;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      if (vein) {
        // the vessels that run down into the root and along it
        ctx.beginPath();
        ctx.moveTo(screen[0].x, screen[0].y);
        for (let i = 1; i < screen.length - 1; i++) {
          const mx = (screen[i].x + screen[i + 1].x) / 2;
          const my = (screen[i].y + screen[i + 1].y) / 2;
          ctx.quadraticCurveTo(screen[i].x, screen[i].y, mx, my);
        }
        ctx.strokeStyle = hsl(root.hue, 85, 72, 0.18 * fade);
        ctx.lineWidth = clamp(root.widths[0] * (focal / (screen[0].z || 1)) * 0.06, 0.6, 5);
        ctx.stroke();
      }

      // rootlets trailing off the toes
      for (const rootlet of root.rootlets || []) {
        const rs = this.screenPath(rootlet.points);
        if (!rs || rs.length < 2) continue;
        const w = rootlet.width * (focal / (rs[0].z || 1));
        ctx.beginPath();
        ctx.moveTo(rs[0].x, rs[0].y);
        for (let i = 1; i < rs.length - 1; i++) {
          const mx = (rs[i].x + rs[i + 1].x) / 2;
          const my = (rs[i].y + rs[i + 1].y) / 2;
          ctx.quadraticCurveTo(rs[i].x, rs[i].y, mx, my);
        }
        if (wood) {
          ctx.strokeStyle = hsl(root.hue, 40, 16, fade);
          ctx.lineWidth = Math.max(0.8, w);
          ctx.stroke();
        }
        if (vein) {
          ctx.strokeStyle = hsl(root.hue, 85, 72, 0.14 * fade);
          ctx.lineWidth = Math.max(0.4, w * 0.2);
          ctx.stroke();
        }
      }
    }
  }

  /** from outside, a realm is a volume you can see into but not yet enter */
  drawRealmVolumes(ctx) {
    const engine = this.engine;
    for (const realm of this.layout.realms.realms.values()) {
      const p = engine.project(realm.center);
      if (!p || p.a < 0.03) continue;
      const radiusPx = (realm.radius * engine.focal) / p.z;
      if (radiusPx < 2) continue;
      const active = engine.realmId === realm.id;
      const fade = p.a * (active ? 1 : 0.5);

      // the stem: the bough does not stop at the world, it grows into it
      if (realm.stem && realm.stem.length > 2) {
        const stemScreen = this.screenPath(realm.stem);
        if (stemScreen) {
          const w = Math.max(0.8, (realm.radius * 0.5) * p.s);
          ctx.beginPath();
          ctx.moveTo(stemScreen[0].x, stemScreen[0].y);
          for (let i = 1; i < stemScreen.length - 1; i++) {
            const mx = (stemScreen[i].x + stemScreen[i + 1].x) / 2;
            const my = (stemScreen[i].y + stemScreen[i + 1].y) / 2;
            ctx.quadraticCurveTo(stemScreen[i].x, stemScreen[i].y, mx, my);
          }
          ctx.strokeStyle = `rgba(22,14,7,${0.8 * fade})`;
          ctx.lineWidth = w * 1.7;
          ctx.stroke();
          ctx.strokeStyle = hsl(realm.hue, 42, 26, 0.9 * fade);
          ctx.lineWidth = w;
          ctx.stroke();
          ctx.strokeStyle = hsl(realm.hue, 48, 40, 0.75 * fade);
          ctx.lineWidth = w * 0.5;
          ctx.stroke();
        }
      }

      // the shell: a rim, not a ball
      const shell = ctx.createRadialGradient(
        p.x, p.y, radiusPx * 0.1, p.x, p.y, radiusPx);
      shell.addColorStop(0, hsl(realm.hue, 70, 50, 0.015 * fade));
      shell.addColorStop(0.82, hsl(realm.hue, 65, 44, 0.03 * fade));
      shell.addColorStop(1, hsl(realm.hue, 60, 40, 0.09 * fade));
      ctx.fillStyle = shell;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radiusPx, 0, TAU);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, radiusPx, 0, TAU);
      ctx.strokeStyle = hsl(realm.hue, 70, 70, 0.3 * fade);
      ctx.lineWidth = 1;
      ctx.stroke();

      // the socket where the branch enters the world: this is what makes the
      // realm read as *hung from* the tree rather than floating near it
      const tipScreen = this.screenPath([realm.stem[realm.stem.length - 2], realm.center]);
      if (tipScreen) {
        const sx = tipScreen[0].x;
        const sy = tipScreen[0].y;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(2, radiusPx * 0.5));
        g.addColorStop(0, hsl(realm.hue, 88, 76, 0.5 * fade));
        g.addColorStop(0.5, hsl(realm.hue, 80, 60, 0.16 * fade));
        g.addColorStop(1, hsl(realm.hue, 70, 50, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(2, radiusPx * 0.5), 0, TAU);
        ctx.fill();
      }

      // what is inside, seen through the shell
      for (const structure of realm.structures) {
        const screen = this.screenPath(structure.points);
        if (!screen) continue;
        ctx.beginPath();
        ctx.moveTo(screen[0].x, screen[0].y);
        for (let i = 1; i < screen.length - 1; i++) {
          const mx = (screen[i].x + screen[i + 1].x) / 2;
          const my = (screen[i].y + screen[i + 1].y) / 2;
          ctx.quadraticCurveTo(screen[i].x, screen[i].y, mx, my);
        }
        ctx.strokeStyle = hsl(realm.hue, 60, 40, 0.3 * fade);
        ctx.lineWidth = Math.max(0.6, structure.thick * p.s * 0.12);
        ctx.stroke();
      }
      if (active) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radiusPx * 1.06, 0, TAU);
        ctx.strokeStyle = hsl(realm.hue, 85, 82, 0.5);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  }

  // ───────────────────────────────────────────────────────────────── interior
  /**
   * Inside a realm: the enclosing shell, the great boughs crossing it, the
   * vessel that came down from the trunk, and the neurons grown into the wood.
   */
  drawInterior(ctx) {
    const engine = this.engine;
    const realm = this.currentRealm();
    if (!realm) return;

    // the shell and the wood inside it are solid, not additive
    ctx.globalCompositeOperation = 'source-over';
    this.drawWorld(ctx, realm);
    this.drawShell(ctx, realm);

    // the conduit back to the trunk, so you never forget where you came from
    const trunk = realm.tip;
    const points = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      points.push(mix3(trunk, realm.center, t));
    }
    this.drawLimb(ctx, points, 2.2, realm.hue ?? 44, 0.9, `${realm.id}_entry`, { thin: true, pass: 'wood' });

    // boughs
    for (const structure of realm.structures) {
      const points = structure.points;
      this.drawLimb(ctx, points, structure.thick, realm.hue ?? 44, 0.95, structure.id, { pass: 'wood' });
    }

    // now the vessels, additively, on top of the wood
    ctx.globalCompositeOperation = 'lighter';
    for (const structure of realm.structures) {
      const pts = structure.points;
      this.drawLimb(ctx, pts, structure.thick, realm.hue ?? 44, 0.95, structure.id, { pass: 'vein' });
      // fine vessels along each bough
      for (let i = 2; i < pts.length - 1; i += 2) {
        const screen = this.screenPath([pts[i], mix3(pts[i], pts[i + 1], 0.5)]);
        if (!screen) continue;
        ctx.beginPath();
        ctx.moveTo(screen[0].x, screen[0].y);
        ctx.lineTo(screen[1].x, screen[1].y);
        ctx.strokeStyle = hsl(realm.hue, 80, 76, 0.35);
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }

    // neurons, in the world where they actually live
    const neurons = [];
    for (const nodeId of realm.members) {
      const world = realm.innerPos.get(nodeId);
      if (!world) continue;
      const p = engine.project(world);
      if (!p) continue;
      const node = this.layout.byId.get(nodeId);
      const memory = this.layout.memoryByNode.get(nodeId);
      if (!memory) continue;
      const worldRadius = this.layout.radiusOf(nodeId);
      p.r = clamp(worldRadius * p.s * 0.28, 1.2, 60);
      neurons.push({ id: nodeId, p, memory, hue: node?.hue ?? realm.hue ?? 44 });
    }
    neurons.sort((a, b) => b.p.z - a.p.z);
    for (const neuron of neurons) {
      const memory = neuron.memory;
      const related = !engine.selected || memory.id === engine.selectedMemoryId;
      const dim = engine.selected ? (related ? 1 : 0.2) : 1;
      this.drawNeuron(ctx, neuron.p, neuron.p.r, neuron.hue, memory, {
        factor: dim,
        selected: engine.selected === neuron.id,
        hovered: engine.hovered === neuron.id,
        matched: engine.matches.has(memory.id),
        seed: neuron.id,
      });
    }
  }

  /**
   * The world a realm is a place in. Each of the nine has its own ground, air
   * and landmarks, so arriving somewhere reads as arriving *there* rather than
   * as the same room with a different tint.
   */
  drawWorld(ctx, realm) {
    const engine = this.engine;
    const world = realm.world;
    if (!world) return;
    const c = realm.center;
    const R = realm.radius;

    // the air of the place: a dark backdrop that gives the realm its colour,
    // so the neurons stay the brightest thing in the frame
    const p = engine.project(c);
    if (p) {
      // keep the world inside its own shell: a realm is a small sphere hanging
      // off a branch, and seeing the dark around it is what sells that
      const px = R * 1.12 * p.s;
      const sky = ctx.createRadialGradient(p.x, p.y - px * 0.18, px * 0.08, p.x, p.y, px);
      const [sh, ss] = world.sky;
      sky.addColorStop(0, hsl(sh, ss, 20, 0.34));
      sky.addColorStop(0.5, hsl(sh, ss * 0.9, 9, 0.66));
      sky.addColorStop(1, hsl(sh, ss * 0.7, 3, 0.9));
      ctx.fillStyle = sky;
      ctx.beginPath();
      ctx.arc(p.x, p.y, px, 0, TAU);
      ctx.fill();
      const [hh, hs, ha] = world.haze;
      const haze = ctx.createRadialGradient(p.x, p.y, px * 0.12, p.x, p.y, px * 0.95);
      haze.addColorStop(0, hsl(hh, hs, 48, ha * 0.8));
      haze.addColorStop(0.7, hsl(hh, hs, 32, ha * 0.34));
      haze.addColorStop(1, hsl(hh, hs, 20, 0));
      ctx.fillStyle = haze;
      ctx.beginPath();
      ctx.arc(p.x, p.y, px * 0.95, 0, TAU);
      ctx.fill();
      // the edge of the world itself
      ctx.beginPath();
      ctx.arc(p.x, p.y, px, 0, TAU);
      ctx.strokeStyle = hsl(sh, ss, 52, 0.16);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // the ground: a disc on the realm's floor, sized by real projection so it
    // sits in perspective
    const floorY = c[1] - world.floor;
    const f = engine.project([c[0], floorY, c[2]]);
    const right = engine.project([c[0] + R * 0.92, floorY, c[2]]);
    const far = engine.project([c[0], floorY, c[2] - R * 0.92]);
    if (f && right && far) {
      const rx = Math.abs(right.x - f.x);
      const ry = Math.abs(far.y - f.y);
      const fade = clamp(f.a ?? 1, 0, 1);
      const gh = world.groundHue;
      const gl = world.groundLight;
      if (world.ground !== 'void' && world.ground !== 'mist') {
        // the ground sits below the wood in value, so the boughs still read
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, Math.max(rx, ry));
        g.addColorStop(0, hsl(gh, 44, gl * 0.5, 0.92 * fade));
        g.addColorStop(0.6, hsl(gh, 40, gl * 0.36, 0.9 * fade));
        g.addColorStop(1, hsl(gh, 34, gl * 0.2, 0.86 * fade));
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = hsl(gh, 30, gl * 0.4, world.ground === 'mist' ? 0.34 * fade : 0.9 * fade);
      }
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, rx, Math.max(ry, rx * 0.06), 0, 0, TAU);
      ctx.fill();
      this.groundTexture(ctx, world, f, rx, ry, fade);
    }

    // landmarks, far to near
    const drawn = world.motifs
      .map((m) => ({ m, p: engine.project([c[0] + m.pos[0], floorY + m.height * 0.5, c[2] + m.pos[2]]) }))
      .filter((x) => x.p)
      .sort((a, b) => b.p.z - a.p.z);
    for (const { m, p } of drawn) {
      this.drawMotif(ctx, m, p, floorY, c, engine);
    }
  }

  /** what the floor is made of — enough to tell the nine grounds apart */
  groundTexture(ctx, world, f, rx, ry, fade) {
    const gh = world.groundHue;
    const seed = world.radius.toFixed(2) + world.ground;
    if (world.ground === 'water') {
      for (let i = 0; i < 9; i++) {
        const t = i / 9;
        ctx.beginPath();
        ctx.ellipse(f.x, f.y - ry + ry * 2 * t * 0.5, rx * (0.9 - t * 0.6),
          Math.max(0.6, ry * (0.9 - t * 0.6) * 0.09), 0, 0, TAU);
        ctx.strokeStyle = hsl(gh, 60, 62, 0.16 * fade);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } else if (world.ground === 'ice') {
      for (let i = 0; i < 14; i++) {
        const a = rnd(seed, `i${i}`) * TAU;
        const d = Math.sqrt(rnd(seed, `id${i}`)) * rx * 0.9;
        const s = rx * (0.08 + rnd(seed, `is${i}`) * 0.16);
        ctx.beginPath();
        ctx.moveTo(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.12 - ry * 0.1);
        ctx.lineTo(f.x + Math.cos(a + 1.9) * d * 0.7 + s, f.y + Math.sin(a + 1.9) * d * 0.08);
        ctx.lineTo(f.x + Math.cos(a - 1.9) * d * 0.7 - s, f.y + Math.sin(a - 1.9) * d * 0.08);
        ctx.closePath();
        ctx.strokeStyle = hsl(gh, 50, 74, 0.2 * fade);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } else if (world.ground === 'marble') {
      for (let i = 0; i < 10; i++) {
        const a = rnd(seed, `v${i}`) * TAU;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.quadraticCurveTo(
          f.x + Math.cos(a) * rx * 0.6, f.y + Math.sin(a) * ry * 0.6,
          f.x + Math.cos(a) * rx, f.y + Math.sin(a) * ry);
        ctx.strokeStyle = hsl(gh, 70, 66, 0.14 * fade);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    } else if (world.ground === 'basalt') {
      for (let i = 0; i < 12; i++) {
        const a = rnd(seed, `c${i}`) * TAU;
        const d0 = rnd(seed, `c0${i}`) * rx;
        const d1 = d0 + rx * (0.2 + rnd(seed, `c1${i}`) * 0.4);
        ctx.beginPath();
        ctx.moveTo(f.x + Math.cos(a) * d0, f.y + Math.sin(a) * d0 * 0.12);
        ctx.lineTo(f.x + Math.cos(a + 0.6) * d1, f.y + Math.sin(a + 0.6) * d1 * 0.12);
        ctx.strokeStyle = hsl(gh, 30, 52, 0.16 * fade);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } else if (world.ground === 'cloud') {
      for (let i = 0; i < 10; i++) {
        const a = rnd(seed, `cl${i}`) * TAU;
        const d = Math.sqrt(rnd(seed, `cd${i}`)) * rx;
        const s = rx * (0.14 + rnd(seed, `cs${i}`) * 0.22);
        const g = ctx.createRadialGradient(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.14,
          0, f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.14, s);
        g.addColorStop(0, hsl(gh, 40, 62, 0.22 * fade));
        g.addColorStop(1, hsl(gh, 40, 40, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.14, s, 0, TAU);
        ctx.fill();
      }
    }
  }

  /** one landmark, drawn as a silhouette in the realm's own space */
  drawMotif(ctx, motif, p, floorY, centre, engine) {
    const s = p.s;
    const h = motif.height * s;
    const w = motif.width * s;
    if (h < 1.2) return;
    const base = p.y + h * 0.5;
    const fade = clamp(p.a ?? 1, 0, 1);
    const gh = centre.hue ?? 44;
    const tint = (l, a) => hsl(gh, 30, l, a * fade);
    ctx.save();
    ctx.translate(p.x, base);
    ctx.beginPath();
    switch (motif.kind) {
      case 'hall':      // the great hall of the Aesir: a long roof on piers
        ctx.moveTo(-w * 1.6, 0);
        ctx.lineTo(-w * 1.6, -h * 0.55);
        ctx.lineTo(0, -h);
        ctx.lineTo(w * 1.6, -h * 0.55);
        ctx.lineTo(w * 1.6, 0);
        ctx.closePath();
        ctx.fillStyle = tint(40, 0.85);
        ctx.fill();
        ctx.fillStyle = hsl(46, 80, 70, 0.5 * fade);
        for (let i = -2; i <= 2; i++) ctx.fillRect(i * w * 0.52 - w * 0.09, -h * 0.5, w * 0.18, h * 0.5);
        break;
      case 'pillar':
        ctx.rect(-w * 0.5, -h, w, h);
        ctx.fillStyle = tint(34, 0.8);
        ctx.fill();
        ctx.fillStyle = hsl(46, 70, 66, 0.3 * fade);
        ctx.fillRect(-w * 0.7, -h, w * 1.4, h * 0.06);
        break;
      case 'rampart':
        ctx.rect(-w * 2.4, -h * 0.5, w * 4.8, h * 0.5);
        ctx.fillStyle = tint(28, 0.75);
        ctx.fill();
        for (let i = -3; i <= 3; i++) {
          ctx.fillRect(i * w * 0.6 - w * 0.2, -h * 0.62, w * 0.4, h * 0.14);
        }
        break;
      case 'well':
        ctx.ellipse(0, -h * 0.12, w, w * 0.3, 0, 0, TAU);
        ctx.fillStyle = tint(30, 0.85);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, -h * 0.12, w * 0.62, w * 0.18, 0, 0, TAU);
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fill();
        break;
      case 'monolith':
        ctx.moveTo(-w * 0.5, 0);
        ctx.lineTo(-w * 0.32, -h);
        ctx.lineTo(w * 0.4, -h * 0.94);
        ctx.lineTo(w * 0.55, 0);
        ctx.closePath();
        ctx.fillStyle = tint(16, 0.9);
        ctx.fill();
        break;
      case 'obelisk':
        ctx.moveTo(-w * 0.34, 0);
        ctx.lineTo(-w * 0.2, -h);
        ctx.lineTo(w * 0.2, -h);
        ctx.lineTo(w * 0.34, 0);
        ctx.closePath();
        ctx.fillStyle = hsl(200, 30, 46, 0.8 * fade);
        ctx.fill();
        break;
      case 'shard':
        ctx.moveTo(-w * 0.4, 0);
        ctx.lineTo(w * 0.1, -h);
        ctx.lineTo(w * 0.45, 0);
        ctx.closePath();
        ctx.fillStyle = hsl(198, 45, 58, 0.6 * fade);
        ctx.fill();
        break;
      case 'cairn':
        for (let i = 0; i < 4; i++) {
          const t = i / 4;
          ctx.beginPath();
          ctx.ellipse(0, -h * t * 0.9, w * (1 - t * 0.55), w * 0.3 * (1 - t * 0.5), 0, 0, TAU);
          ctx.fillStyle = tint(22 + i * 3, 0.8);
          ctx.fill();
        }
        break;
      case 'islet':
        ctx.ellipse(0, 0, w * 2.2, w * 0.7, 0, 0, TAU);
        ctx.fillStyle = hsl(96, 34, 26, 0.85 * fade);
        ctx.fill();
        break;
      case 'willow':
        ctx.strokeStyle = hsl(94, 40, 34, 0.8 * fade);
        ctx.lineWidth = Math.max(0.8, w * 0.2);
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -h * 0.6);
        ctx.stroke();
        ctx.strokeStyle = hsl(100, 46, 44, 0.5 * fade);
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath();
          ctx.moveTo(0, -h * 0.6);
          ctx.quadraticCurveTo(i * w * 0.5, -h * 0.5, i * w * 0.7, -h * 0.05);
          ctx.stroke();
        }
        break;
      case 'reed':
        ctx.strokeStyle = hsl(96, 44, 42, 0.5 * fade);
        ctx.lineWidth = Math.max(0.6, w * 0.12);
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(i * w * 0.5, 0);
          ctx.quadraticCurveTo(i * w * 0.6, -h * 0.5, i * w * 0.8, -h);
          ctx.stroke();
        }
        break;
      case 'crag':
        ctx.moveTo(-w, 0);
        ctx.lineTo(-w * 0.4, -h * 0.8);
        ctx.lineTo(w * 0.2, -h);
        ctx.lineTo(w, -h * 0.2);
        ctx.lineTo(w * 1.1, 0);
        ctx.closePath();
        ctx.fillStyle = tint(14, 0.9);
        ctx.fill();
        break;
      case 'bridge':
        ctx.strokeStyle = tint(26, 0.8);
        ctx.lineWidth = Math.max(1, w * 0.22);
        ctx.beginPath();
        ctx.moveTo(-w * 2, 0);
        ctx.quadraticCurveTo(0, -h * 1.2, w * 2, 0);
        ctx.stroke();
        break;
      case 'stair':
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = tint(26 + i * 2, 0.8);
          ctx.fillRect(-w * 1.4, -h * (i + 1) / 5, w * 2.8, h / 5);
        }
        break;
      case 'arch':
        ctx.strokeStyle = tint(30, 0.8);
        ctx.lineWidth = Math.max(1, w * 0.3);
        ctx.beginPath();
        ctx.moveTo(-w, 0);
        ctx.lineTo(-w, -h * 0.55);
        ctx.arc(0, -h * 0.55, w, Math.PI, 0);
        ctx.lineTo(w, 0);
        ctx.stroke();
        break;
      case 'forge':
        ctx.rect(-w, -h * 0.7, w * 2, h * 0.7);
        ctx.fillStyle = tint(12, 0.9);
        ctx.fill();
        ctx.fillStyle = hsl(28, 92, 60, 0.65 * fade);
        ctx.fillRect(-w * 0.55, -h * 0.45, w * 1.1, h * 0.28);
        break;
      case 'vein':
        ctx.strokeStyle = hsl(40, 88, 62, 0.4 * fade);
        ctx.lineWidth = Math.max(0.7, w * 0.1);
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(-w * 2, -i * h * 0.16);
          ctx.quadraticCurveTo(0, -i * h * 0.16 + h * 0.2, w * 2, -i * h * 0.16);
          ctx.stroke();
        }
        break;
      case 'tower':
        ctx.moveTo(-w * 0.6, 0);
        ctx.lineTo(-w * 0.3, -h);
        ctx.lineTo(w * 0.3, -h);
        ctx.lineTo(w * 0.6, 0);
        ctx.closePath();
        ctx.fillStyle = tint(34, 0.75);
        ctx.fill();
        break;
      case 'vane':
        ctx.strokeStyle = tint(30, 0.8);
        ctx.lineWidth = Math.max(0.8, w * 0.12);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -h);
        ctx.stroke();
        ctx.beginPath();
        const spin = this.engine.time * 0.9 + motif.spin;
        ctx.moveTo(0, -h);
        ctx.lineTo(Math.cos(spin) * w * 1.6, -h + Math.sin(spin) * w * 0.5);
        ctx.stroke();
        break;
      case 'cloudbank':
        ctx.fillStyle = hsl(42, 36, 58, 0.2 * fade);
        ctx.beginPath();
        ctx.ellipse(0, -h * 0.3, w * 3, h * 0.34, 0, 0, TAU);
        ctx.fill();
        break;
      case 'veil':
        ctx.fillStyle = hsl(214, 22, 62, 0.13 * fade);
        ctx.beginPath();
        ctx.moveTo(-w * 2, 0);
        ctx.quadraticCurveTo(0, -h * 0.8, w * 2, 0);
        ctx.lineTo(w * 2, h * 0.5);
        ctx.quadraticCurveTo(0, -h * 0.2, -w * 2, h * 0.5);
        ctx.closePath();
        ctx.fill();
        break;
      case 'rift':
        // the yawning gap, with the two rivers running out of it
        ctx.beginPath();
        ctx.moveTo(-w * 0.5, 0);
        ctx.lineTo(-w * 0.1, -h * 0.7);
        ctx.lineTo(w * 0.16, -h * 0.2);
        ctx.lineTo(w * 0.5, -h * 0.95);
        ctx.lineTo(w * 0.7, 0);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
        ctx.fill();
        ctx.strokeStyle = hsl(266, 70, 62, 0.4 * fade);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.strokeStyle = hsl(48, 90, 82, 0.42 * fade);   // Gjöll, bright
        ctx.lineWidth = Math.max(0.8, w * 0.12);
        ctx.beginPath();
        ctx.moveTo(-w * 2, h * 0.2);
        ctx.quadraticCurveTo(-w, h * 0.1, -w * 0.3, -h * 0.1);
        ctx.stroke();
        ctx.strokeStyle = hsl(258, 40, 40, 0.42 * fade);   // Höð, dark
        ctx.beginPath();
        ctx.moveTo(w * 2, h * 0.2);
        ctx.quadraticCurveTo(w, h * 0.1, w * 0.3, -h * 0.1);
        ctx.stroke();
        break;
      case 'river':
        ctx.strokeStyle = hsl(48, 90, 80, 0.3 * fade);
        ctx.lineWidth = Math.max(0.8, w * 0.14);
        ctx.beginPath();
        ctx.moveTo(-w * 3, 0);
        ctx.quadraticCurveTo(0, -h * 0.4, w * 3, 0);
        ctx.stroke();
        break;
      default:
        ctx.rect(-w * 0.5, -h * 0.8, w, h * 0.8);
        ctx.fillStyle = tint(28, 0.7);
        ctx.fill();
    }
    ctx.restore();
  }

  drawShell(ctx, realm) {
    const engine = this.engine;
    const p = engine.project(realm.center);
    if (!p) return;
    const radiusPx = (realm.radius * 1.6 * engine.focal) / p.z;
    // a horizon of root filaments far below, and the shell's inner haze
    const haze = ctx.createRadialGradient(
      p.x, p.y - radiusPx * 0.1, radiusPx * 0.2, p.x, p.y, radiusPx);
    haze.addColorStop(0, hsl(realm.hue ?? 44, 60, 40, 0.05));
    haze.addColorStop(0.7, hsl(realm.hue ?? 44, 55, 30, 0.03));
    haze.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radiusPx, 0, TAU);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, radiusPx, 0, TAU);
    ctx.strokeStyle = hsl(realm.hue ?? 44, 60, 55, 0.12);
    ctx.lineWidth = 1;
    ctx.stroke();

    // root filaments drifting under the realm, for depth
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + rnd('floor', `a${i}`) * 0.3;
      const r = realm.radius * (0.5 + rnd('floor', `r${i}`) * 0.8);
      const centre = add(realm.center, [Math.cos(a) * r, -realm.radius * 0.75, Math.sin(a) * r]);
      const s = engine.project(centre);
      if (!s) continue;
      const len = (12 + rnd('floor', `l${i}`) * 26) * s.s;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(s.x + Math.cos(a) * len, s.y + len * 0.4,
        s.x + Math.cos(a) * len * 1.6, s.y + len * 0.9);
      ctx.strokeStyle = hsl(realm.hue ?? 44, 55, 52, 0.16 * s.a);
      ctx.lineWidth = Math.max(0.4, 0.9 * s.s * 0.2);
      ctx.stroke();
    }
  }

  // ───────────────────────────────────────────────────────────────── routes
  /**
   * A relationship is not a drawn arc: it is a signal leaving one neuron,
   * running down its own vessel, through the trunk, and up into the other.
   * That is why the tree's vascular system is the memory architecture.
   */
  drawRoutes(ctx) {
    const engine = this.engine;
    const links = this.state?.links || [];
    const memoryNode = engine.memoryNode;
    const selected = engine.selectedMemoryId;
    const focus = selected || engine.hoveredMemoryId;

    for (const link of links) {
      const aNode = memoryNode.get(link.a);
      const bNode = memoryNode.get(link.b);
      if (!aNode || !bNode) continue;
      const relevant = !focus || link.a === focus || link.b === focus;
      if (focus && !relevant) continue;
      // from the establishing distance the tree is the subject: thirty-eight
      // signals converging on the trunk would read as a firework. They only
      // appear once you have moved in close enough to want them.
      if (!focus && engine.cur.dist > 250) continue;

      const chainA = this.layout.routeThroughTrunk(aNode);
      const chainB = this.layout.routeThroughTrunk(bNode);
      const world = [];
      for (const segment of chainA) for (const point of segment) world.push(point);
      for (let i = chainB.length - 1; i >= 0; i--) {
        for (const point of chainB[i]) world.push(point);
      }
      const screen = this.screenPath(world);
      if (!screen) continue;

      const alpha = (relevant && focus ? 0.5 : 0.14 + link.weight * 0.16) * screen[0].a;
      if (alpha < 0.015) continue;

      ctx.beginPath();
      ctx.moveTo(screen[0].x, screen[0].y);
      for (let i = 1; i < screen.length - 1; i++) {
        const mx = (screen[i].x + screen[i + 1].x) / 2;
        const my = (screen[i].y + screen[i + 1].y) / 2;
        ctx.quadraticCurveTo(screen[i].x, screen[i].y, mx, my);
      }
      ctx.setLineDash([5, 8]);
      ctx.lineDashOffset = -(engine.time * 26) % 200;
      ctx.strokeStyle = hsl(42 + link.weight * 14, 85, 70, alpha);
      ctx.lineWidth = (relevant && focus ? 1.4 : 0.6) + link.weight * 0.4;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ───────────────────────────────────────────────────────────────── labels
  drawLabels(ctx) {
    const engine = this.engine;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const placed = [];
    const dist = engine.cur.dist;
    const showAll = !engine.realmId;

    const entries = [];
    for (const [id, p] of engine.projected) {
      const node = this.layout.byId.get(id);
      if (!node) continue;
      if (this.layout.realms.realmOfNode.has(id) && showAll && node.kind === 'leaf') continue;
      const isSelected = engine.selected === id;
      const isHovered = engine.hovered === id;
      const memory = this.layout.memoryByNode.get(id);
      const isMatch = !!(memory && engine.matches.has(memory.id));
      if (engine.matches.size && !isMatch && !isSelected && !isHovered) continue;
      if (p.a < 0.14) continue;
      const leaf = node.kind === 'leaf';
      if (leaf && showAll && dist > 190 && !isSelected && !isHovered && !isMatch) continue;
      entries.push({ id, node, p, isSelected, isHovered, isMatch, leaf, memory });
    }

    entries.sort((a, b) => (b.isSelected - a.isSelected) || (b.isHovered - a.isHovered)
      || (b.p.r - a.p.r) || (a.p.z - b.p.z));

    for (const item of entries) {
      const { node, p, isSelected, isHovered, isMatch, leaf } = item;
      const size = clamp(10.5 + (leaf ? Math.min(p.r, 10) * 0.4 : 3.4), 10, 15.5);
      ctx.font = `${isSelected || !leaf ? '600 ' : '400 '}${size.toFixed(1)}px "Inter", system-ui, sans-serif`;
      const text = node.name;
      const width = ctx.measureText(text).width;
      const x = p.x + Math.max(5, p.r * 1.4);
      const box = { x: x - 4, y: p.y - size * 0.7, w: width + 10, h: size * 1.5 };
      if (x + width > engine.width - 8 || box.y < 2 || box.y + box.h > engine.height - 2) continue;
      const collides = placed.some((o) => !(box.x > o.x + o.w || box.x + box.w < o.x
        || box.y > o.y + o.h || box.y + box.h < o.y));
      if (collides && !isSelected && !isHovered) continue;
      placed.push(box);

      const fade = isSelected ? 1 : isHovered ? 0.95 : isMatch ? 0.9 : clamp(p.a * 1.1, 0, 0.75);
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 7;
      ctx.fillStyle = isSelected ? 'rgba(255,251,242,1)'
        : leaf ? `rgba(248,238,220,${(fade * 0.9).toFixed(3)})`
          : hsl(node.hue ?? 44, 55, 82, fade * 0.92);
      ctx.fillText(text, x, p.y);
      ctx.shadowBlur = 0;
    }
  }

  // ───────────────────────────────────────────────────────────────── frame
  draw(dt) {
    const engine = this.engine;
    const ctx = this.ctx;
    if (!this.layout) return;

    ctx.setTransform(engine.dpr, 0, 0, engine.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.paintCosmos(), 0, 0, engine.width, engine.height);

    // Wood is drawn in normal compositing so it occludes; only genuinely
    // emissive things — the vessels, the cells, the motes, the signals — are
    // drawn additively. Additively blending the whole tree turns a colossal
    // trunk into a white smear.
    if (engine.realmId) {
      ctx.globalCompositeOperation = 'lighter';
      this.drawMotes(ctx, dt);
      this.drawInterior(ctx);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      this.drawExteriorWood(ctx);
      ctx.globalCompositeOperation = 'lighter';
      this.drawMotes(ctx, dt);
      this.drawExteriorGlow(ctx);
      if (engine.showLinks) this.drawRoutes(ctx);
    }
    ctx.globalCompositeOperation = 'source-over';
    this.drawLabels(ctx);
    this.drawVignette(ctx);
  }

  drawVignette(ctx) {
    const { width, height } = this.engine;
    const vignette = ctx.createRadialGradient(
      width / 2, height / 2, Math.min(width, height) * 0.26,
      width / 2, height / 2, Math.max(width, height) * 0.76);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }
}

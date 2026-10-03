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
import { TIERS, tierFor, groundAt, instances } from './world.js';

const SPRITE_SIZE = 128;
const spriteCache = new Map();

/** per-realm air, keyed by the `motes` field a realm's theme declares */
const MOTES = {
  dust: { hue: 40, spread: 20, rise: 0.5, alpha: 0.4, speed: 0.35 },
  pollen: { hue: 84, spread: 16, rise: 0.28, alpha: 0.46, speed: 0.3 },
  ember: { hue: 24, spread: 22, rise: 2.4, alpha: 0.6, speed: 0.9 },
  frost: { hue: 198, spread: 12, rise: -0.7, alpha: 0.4, speed: 0.5 },
  star: { hue: 44, spread: 26, rise: 0, alpha: 0.55, speed: 0.1 },
};

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
  /**
   * What the air is full of, per realm. Motes are the cheapest atmosphere there
   * is, so they carry a lot of a world's identity for almost no cost — but only
   * if they behave differently: frost falls, embers climb, pollen hangs, dust
   * drifts. Nine realms with the same drifting specks are one realm.
   */
  static MOTES = MOTES;

  seedMotes() {
    this.motes = [];
    const realm = this.currentRealm();
    const world = realm?.world;
    const kind = MOTES[world?.motes] || MOTES.dust;
    // Inside a realm the land now carries the detail, so the air is thinned
    // right down: motes are the first thing to make a world look like weather
    // when it is meant to look like a place.
    const count = this.engine.reducedMotion
      ? (realm ? 22 : 40)
      : (realm ? 74 : 200);
    for (let i = 0; i < count; i++) {
      const spread = realm ? realm.radius * 2.2 : 210;
      this.motes.push({
        x: (rnd(`m${i}`, 'x') - 0.5) * spread,
        y: (rnd(`m${i}`, 'y') - 0.5) * spread,
        z: (rnd(`m${i}`, 'z') - 0.5) * spread,
        phase: rnd(`m${i}`, 'p') * TAU,
        speed: kind.speed * (0.6 + rnd(`m${i}`, 's') * 0.9),
        size: 0.4 + rnd(`m${i}`, 'd') * 1.5,
        hue: kind.hue + (rnd(`m${i}`, 'h') - 0.5) * kind.spread,
        kind,
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
    const span = realm ? realm.radius * 2.2 : 220;
    for (const mote of this.motes) {
      const y = ((mote.y + t * mote.speed * mote.kind.rise * 3 + span / 2) % span + span) % span - span / 2;
      const sway = Math.sin(t * 0.4 + mote.phase) * 1.8;
      const world = add(origin, [mote.x + sway, y, mote.z + Math.cos(t * 0.33 + mote.phase) * 1.8]);
      const p = this.engine.project(world);
      if (!p || p.a < 0.04) continue;
      // Bounded: a mote is a speck of dust. Scaled by focal/z without a cap it
      // becomes a hundred-pixel bloom the moment it drifts near the camera, and
      // a few dozen of those turn the whole world into fog.
      const size = Math.min(5, mote.size * p.s * 0.6);
      // twinkle for what hangs, flicker for what burns
      const beat = mote.kind === 'ember'
        ? 0.3 + 0.7 * Math.abs(Math.sin(t * 3.1 + mote.phase))
        : 0.45 + 0.55 * Math.sin(t * 1.2 + mote.phase);
      ctx.globalAlpha = mote.kind.alpha * p.a * beat;
      ctx.drawImage(sprite, p.x - size, p.y - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1;
    void dt;
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
    // Stroke width comes from one reference depth. The first point is the
    // natural choice for a limb growing outward from the trunk, but the realm's
    // entry conduit starts at the far tip and *ends* in the middle, so its
    // first point can be right beside the camera — and focal/z then blows the
    // limb up into a wall across the world. Callers that know better pass
    // `refZ`.
    const near = opts.refZ ?? screen[0].z;
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
    const { factor = 1, selected = false, hovered = false, matched = false, compact = false } = opts;
    const importance = memory?.importance ?? 0.5;
    const confidence = memory?.confidence ?? 0.7;
    const pulse = 1 + Math.sin(this.engine.time * (0.5 + importance * 0.8)
      + rnd(opts.seed || 'x', 'b') * TAU) * 0.08;
    const radius = Math.max(1.8, worldRadius * pulse);

    // socket: a hollow in the wood. Inside a realm this is dialled back, or a
    // dozen memories punch a dozen dark holes in the landscape they sit in.
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius * (compact ? 1.7 : 2.1), 0, TAU);
    ctx.fillStyle = `rgba(20,13,7,${(compact ? 0.34 : 0.5) * factor})`;
    ctx.fill();

    // dendrites — the neuron's own vascular reach. Length and weight are
    // capped, not proportional: a cell seen close up must still read as a
    // cell, not as a starburst filling the screen. Inside a realm the cap is
    // tighter again, because there the cell is sharing the frame with a world.
    const reach = compact ? 34 : 86;
    const count = compact ? 3 + Math.round(importance * 3) : 4 + Math.round(importance * 5);
    for (let i = 0; i < count; i++) {
      const angle = rnd(opts.seed || 'x', `d${i}`) * TAU + i * 2.399;
      const length = clamp(radius * (2.4 + rnd(opts.seed || 'x', `l${i}`) * 3.2), 5, reach);
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
    const halo = clamp(radius * 7, 12, compact ? 64 : 120);
    ctx.globalAlpha = (0.1 + confidence * (compact ? 0.13 : 0.18)) * factor;
    ctx.drawImage(glowSprite(hue), screen.x - halo, screen.y - halo, halo * 2, halo * 2);
    ctx.globalAlpha = 1;

    const core = clamp(radius * 2.3, 3, compact ? 26 : 34);
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
    // one owner for the tier, decided before anything reads it
    this.tier = tierFor(engine, realm);

    // the shell and the wood inside it are solid, not additive
    ctx.globalCompositeOperation = 'source-over';
    this.drawUnderRealm(ctx, realm);
    this.drawWorld(ctx, realm);
    this.drawShell(ctx, realm);

    // the conduit back to the trunk, so you never forget where you came from
    const trunk = realm.tip;
    const points = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      points.push(mix3(trunk, realm.center, t));
    }
    this.drawLimb(ctx, points, 1.0, realm.hue ?? 44, 0.9, `${realm.id}_entry`, {
      thin: true,
      pass: 'wood',
      refZ: engine.project(realm.center)?.z,
    });

    // boughs
    for (const structure of realm.structures) {
      const points = structure.points;
      this.drawLimb(ctx, points, structure.thick, realm.hue ?? 44, 0.95, structure.id, { pass: 'wood' });
    }

    // now the vessels, additively, on top of the wood
    ctx.globalCompositeOperation = 'lighter';
    const tier = this.tier ?? TIERS.NEAR;
    for (const structure of realm.structures) {
      const pts = structure.points;
      this.drawLimb(ctx, pts, structure.thick, realm.hue ?? 44, 0.95, structure.id, { pass: 'vein' });
      // Fine vessels along each bough. These are the first thing to go when
      // the world is far away: at range they are a haze of ticks laid over the
      // land, and the land is the reason you came in.
      if (tier !== TIERS.NEAR) continue;
      for (let i = 2; i < pts.length - 1; i += 3) {
        const screen = this.screenPath([pts[i], mix3(pts[i], pts[i + 1], 0.5)]);
        if (!screen) continue;
        ctx.beginPath();
        ctx.moveTo(screen[0].x, screen[0].y);
        ctx.lineTo(screen[1].x, screen[1].y);
        ctx.strokeStyle = hsl(realm.hue, 80, 76, 0.26);
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
      // A cell seen from outside the world is a speck on an enormous organism.
      // Inside its own world it has to share the frame with the place it lives
      // in, so it is drawn at a size the landscape can be read around.
      p.r = clamp(worldRadius * p.s * 0.15, 1.2, 26);
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
        compact: true,
      });
    }
  }

  /**
   * The world a realm is a place in.
   *
   * Drawn in the order a place is actually made: the air, then the far country
   * beyond the horizon, then the land, then what stands on the land, then the
   * weather. Everything the realm generates is already in world space and
   * already sorted far-to-near, so a frame is a handful of linear passes rather
   * than a scene graph.
   *
   * The detail of all of this is tiered. Arriving in a realm is the fine tier,
   * because that is when you came for it; backing away drops the ground to a
   * flat suggestion and stops generating small objects altogether.
   */
  drawWorld(ctx, realm) {
    const world = realm.world;
    if (!world) return;
    const engine = this.engine;
    const tier = this.tier ?? tierFor(engine, realm);
    const stats = { tier, cells: 0, landmarks: 0, detail: 0, ms: 0 };
    this.stats = stats;
    const started = performance.now();

    this.drawAir(ctx, realm, tier);
    if (tier === TIERS.FAR) this.drawFarGround(ctx, realm, tier);
    else this.drawTerrain(ctx, realm, tier, stats);
    this.drawRoof(ctx, realm, tier);
    this.drawAtmosphere(ctx, realm, tier, 'back');
    if (tier !== TIERS.FAR) this.drawPaths(ctx, realm, tier);
    this.drawPopulation(ctx, realm, tier, stats);
    this.drawAgents(ctx, realm);
    this.drawAtmosphere(ctx, realm, tier, 'front');

    stats.ms = performance.now() - started;
  }

  /**
   * The air of the place. A realm is a small sphere hanging off a branch, and
   * seeing the dark around it is half of what sells it — so the backdrop stays
   * bounded, dark, and lower in value than the wood.
   */
  drawAir(ctx, realm, tier) {
    const engine = this.engine;
    const world = realm.world;
    const R = realm.radius;
    const p = engine.project(realm.center);
    if (!p) return;
    const px = R * 1.12 * p.s;
    const [sh, ss] = world.sky;
    const sky = ctx.createRadialGradient(p.x, p.y - px * 0.18, px * 0.08, p.x, p.y, px);
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
    this.drawDistance(ctx, realm, px, p);
    if (tier !== TIERS.FAR) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, px, 0, TAU);
      ctx.strokeStyle = hsl(sh, ss, 52, 0.16);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  /**
   * The country past the horizon. Three soft bands, low in contrast, sitting
   * just outside the realm's own ground. It costs almost nothing and it is the
   * difference between a world and a diorama: the land does not stop at the
   * edge of the shell, it carries on into the haze.
   */
  drawDistance(ctx, realm, px, centre) {
    const world = realm.world;
    const [hh, hs] = world.haze;
    const left = centre.x - px * 1.15;
    const right = centre.x + px * 1.15;
    const horizon = centre.y + px * 0.06;
    for (let i = 0; i < 2; i++) {
      const top = horizon - px * (0.2 + i * 0.12);
      const bottom = horizon + px * (0.34 + i * 0.16);
      // a ridge line for the far country, walked across the realm's width
      const steps = 22;
      ctx.beginPath();
      ctx.moveTo(left, bottom);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const jag = Math.sin(t * (4 + i * 3) + i * 2.1) * 0.5
          + Math.sin(t * (9 - i * 2) + 1.3) * 0.3
          + rnd(world.salt, `d${i}${s}`) * 0.35;
        ctx.lineTo(left + (right - left) * t, top + jag * px * 0.07);
      }
      ctx.lineTo(right, bottom);
      ctx.closePath();
      // Faded at both ends: a hard-edged fill reads as a lump of fog sitting on
      // the landscape rather than as country going on past the horizon.
      const g = ctx.createLinearGradient(0, top, 0, bottom);
      g.addColorStop(0, hsl(hh, hs * 0.5, 28, 0));
      g.addColorStop(0.4, hsl(hh, hs * 0.5, 26, 0.09 - i * 0.03));
      g.addColorStop(1, hsl(hh, hs * 0.5, 18, 0));
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  /**
   * The far tier's ground: the flat disc, kept because it is what the
   * establishing view of a realm has always looked like, and because a
   * heightfield nobody can resolve is just a more expensive flat disc.
   */
  drawFarGround(ctx, realm, tier) {
    const engine = this.engine;
    const world = realm.world;
    const c = realm.center;
    const R = realm.radius;
    const floorY = c[1] - world.floor;
    const f = engine.project([c[0], floorY, c[2]]);
    const right = engine.project([c[0] + R * 0.92, floorY, c[2]]);
    const far = engine.project([c[0], floorY, c[2] - R * 0.92]);
    if (!f || !right || !far) return;
    const rx = Math.abs(right.x - f.x);
    const ry = Math.abs(far.y - f.y);
    const fade = clamp(f.a ?? 1, 0, 1);
    const gh = world.groundHue;
    const gl = world.groundLight;
    if (world.ground !== 'void' && world.ground !== 'mist') {
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
    void tier;
  }

  /**
   * The land.
   *
   * A polar grid is sampled against the realm's own heightfield, projected, and
   * filled back-to-front as shaded triangles. Three details do most of the
   * work: the normal of each triangle is lit by the realm's own sun, a face
   * whose corners differ sharply in height is painted as exposed rock, and
   * distant ground loses contrast toward the haze. Cells with no ground are
   * skipped rather than filled, which is what leaves the dark showing through
   * under a floating shelf or over the mouth of a well.
   */
  drawTerrain(ctx, realm, tier, stats) {
    const engine = this.engine;
    const world = realm.world;
    const c = realm.center;
    const R = realm.radius;
    const floorY = c[1] - world.floor;
    const RINGS = tier === TIERS.NEAR ? 9 : 6;
    const SECTORS = tier === TIERS.NEAR ? 22 : 13;
    const rot = rnd(world.salt, 'rot') * TAU;
    const pal = world.palette;

    const grid = [];
    for (let i = 0; i <= RINGS; i++) {
      const fr = Math.pow(i / RINGS, 0.82);
      const row = [];
      for (let j = 0; j < SECTORS; j++) {
        const a = (j / SECTORS) * TAU + rot;
        const x = Math.cos(a) * fr * R;
        const z = Math.sin(a) * fr * R;
        const g = groundAt(world, x, z);
        if (!g) { row.push(null); continue; }
        const p = engine.project([c[0] + x, floorY + g.y, c[2] + z]);
        if (!p) { row.push(null); continue; }
        row.push({ x, y: g.y, z, sx: p.x, sy: p.y, a: p.a, zc: p.z, region: g.region, water: !!g.region.water });
      }
      grid.push(row);
    }

    // back to front, so a ridge properly hides the ground behind it
    const faces = [];
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SECTORS; j++) {
        const v00 = grid[i][j];
        const v10 = grid[i][j + 1 === SECTORS ? 0 : j + 1];
        const v01 = grid[i + 1][j];
        const v11 = grid[i + 1][j + 1 === SECTORS ? 0 : j + 1];
        if (v00 && v10 && v11) faces.push([v00, v10, v11]);
        if (v00 && v11 && v01) faces.push([v00, v11, v01]);
      }
    }
    faces.sort((m, n) => ((m[0].zc + m[1].zc + m[2].zc) - (n[0].zc + n[1].zc + n[2].zc)));

    const cliffAt = world.relief * R * 0.035;
    for (const face of faces) {
      stats.cells++;
      // the surface this face belongs to: the highest of its three corners
      let top = face[0];
      for (const v of face) if (v.y > top.y) top = v;
      const water = top.water;
      const spread = Math.max(top.y, face[0].y, face[1].y, face[2].y)
        - Math.min(top.y, face[0].y, face[1].y, face[2].y);

      // light it with the realm's own sun
      const e1 = sub(face[1], face[0]);
      const e2 = sub(face[2], face[0]);
      let nrm = cross(e1, e2);
      if (nrm[1] < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
      if (water) {
        // A sea is flat, and a flat plane lit by a sun is one flat colour —
        // the largest region in Vánheimr would read as a field of paint. Give
        // the surface two crossed swells and shade by their gradient instead,
        // so the water moves and catches the light the way water does.
        const w = world.waves || 1;
        const gx = Math.cos(top.x * 0.42 * w + top.z * 0.21 * w) * 0.42 * w
          - Math.cos(top.x * 0.17 * w - top.z * 0.5 * w) * 0.09 * w;
        const gz = Math.cos(top.x * 0.42 * w + top.z * 0.21 * w) * 0.21 * w
          + Math.cos(top.x * 0.17 * w - top.z * 0.5 * w) * 0.5 * w;
        nrm = [-gx, 1, -gz];
      }
      const nl = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
      const lam = Math.max(0, (nrm[0] * world.sun[0] + nrm[1] * world.sun[1] + nrm[2] * world.sun[2]) / nl);

      let hue = water ? pal.water[0] : pal.mid[0];
      let sat = water ? pal.water[1] : pal.mid[1];
      // the ground sits below the wood in value, so the boughs still read
      let light = water ? pal.water[2] * 0.8 : pal.mid[2] * 0.88;
      if (spread > cliffAt) {
        // a face this steep is a cliff: exposed, darker, more saturated rock
        hue = pal.dark[0];
        sat = Math.min(90, pal.dark[1] * 1.2);
        light = pal.dark[2] * (0.9 + 0.7 * lam);
      } else {
        light *= 0.58 + 0.86 * lam;
        // high ground catches a little of the sky
        light += clamp(top.y / (R * 0.16), 0, 1) * (water ? 3 : 9);
      }

      const fade = clamp((top.a + face[0].a + face[1].a + face[2].a) / 4, 0, 1);
      // aerial perspective: the far side of the realm loses contrast
      const far = clamp(1 - top.a * 1.6, 0, 1);
      const alpha = (water ? 0.5 : 0.94) * fade * (1 - far * 0.3);

      ctx.beginPath();
      ctx.moveTo(face[0].sx, face[0].sy);
      ctx.lineTo(face[1].sx, face[1].sy);
      ctx.lineTo(face[2].sx, face[2].sy);
      ctx.closePath();
      ctx.fillStyle = hsl(hue, sat, lerp(light, pal.high[2] * 0.5, far * 0.45), alpha);
      ctx.fill();
      if (water && lam > 0.62) {
        // a sheen, only where the sun actually reaches the swell
        ctx.fillStyle = hsl(pal.accent[0], pal.accent[1], pal.accent[2], 0.16 * (lam - 0.62) * 3 * fade);
        ctx.fill();
      }
    }

    // the sub-region boundaries, so a world reads as *several* places even
    // before you can see what is in them
    if (tier === TIERS.NEAR) this.drawRegionEdges(ctx, realm, RINGS, SECTORS, rot, floorY);
  }

  /** where one sub-region hands over to the next */
  drawRegionEdges(ctx, realm, RINGS, SECTORS, rot, floorY) {
    const engine = this.engine;
    const world = realm.world;
    const c = realm.center;
    const R = realm.radius;
    ctx.lineWidth = 1;
    for (let i = 0; i <= RINGS; i++) {
      const fr = Math.pow(i / RINGS, 0.82);
      let last = null;
      for (let j = 0; j <= SECTORS; j++) {
        const a = (j % SECTORS) / SECTORS * TAU + rot;
        const x = Math.cos(a) * fr * R;
        const z = Math.sin(a) * fr * R;
        const g = groundAt(world, x, z);
        const id = g ? g.region.id : null;
        if (last !== null && id !== last) {
          const p = engine.project([c[0] + x, floorY + (g ? g.y : 0), c[2] + z]);
          if (p) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(0.8, 1.4 * p.s), 0, TAU);
            ctx.fillStyle = hsl(world.palette.accent[0], 40, world.palette.accent[2], 0.16 * p.a);
            ctx.fill();
          }
        }
        last = id;
      }
    }
  }

  /**
   * A ceiling. Svartálfaheimr is under the mountain, and a world with a roof is
   * a different world from one without: it darkens, it closes in, and the
   * landmarks beneath it stop being the whole of the sky.
   */
  drawRoof(ctx, realm, tier) {
    const world = realm.world;
    if (!world.roof || tier === TIERS.FAR) return;
    const engine = this.engine;
    const c = realm.center;
    const R = realm.radius;
    const y = c[1] - world.floor + world.roof * R * 1.5;
    const steps = 22;
    const outer = [];
    const inner = [];
    for (let s = 0; s <= steps; s++) {
      const a = (s / steps) * TAU;
      const jag = rnd(world.salt, `roof${s}`) * 0.6 + 0.2;
      const ro = R * 1.06;
      const ri = R * (0.5 + jag * 0.3);
      const po = engine.project([c[0] + Math.cos(a) * ro, y, c[2] + Math.sin(a) * ro]);
      const pi = engine.project([c[0] + Math.cos(a) * ri, y - world.roof * R * jag * 0.8, c[2] + Math.sin(a) * ri]);
      if (!po || !pi) return;
      outer.push(po);
      inner.push(pi);
    }
    ctx.beginPath();
    ctx.moveTo(outer[0].x, outer[0].y);
    for (let s = 1; s < outer.length; s++) ctx.lineTo(outer[s].x, outer[s].y);
    for (let s = inner.length - 1; s >= 0; s--) ctx.lineTo(inner[s].x, inner[s].y);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, outer[0].y, 0, inner[0].y);
    g.addColorStop(0, 'rgba(2,2,3,0.94)');
    g.addColorStop(1, hsl(world.palette.dark[0], 30, 8, 0.86));
    ctx.fillStyle = g;
    ctx.fill();
    // the underside catches a little of the realm's own light
    ctx.strokeStyle = hsl(world.palette.accent[0], 40, world.palette.accent[2], 0.1);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(inner[0].x, inner[0].y);
    for (let s = 1; s < inner.length; s++) ctx.lineTo(inner[s].x, inner[s].y);
    ctx.stroke();
  }

  /**
   * Roads, causeways and spans: the polylines between landmarks, following the
   * ground. They are what make a world navigable before anything is walking on
   * it — a viewer can see where a place connects to.
   */
  drawPaths(ctx, realm, tier) {
    const engine = this.engine;
    const world = realm.world;
    const c = realm.center;
    const floorY = c[1] - world.floor;
    const accent = world.palette.accent;
    for (const path of world.paths) {
      const pts = path.points.map(([x, y, z]) => engine.project([c[0] + x, floorY + y, c[2] + z]));
      if (pts.some((p) => !p)) continue;
      const wide = path.kind === 'span';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        ctx.quadraticCurveTo(pts[i].x, pts[i].y,
          (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      if (wide) {
        // a span has rails: it is a bridge, and a bridge has a deck
        ctx.strokeStyle = hsl(accent[0], accent[1] * 0.7, accent[2] * 0.8, 0.16 * pts[0].a);
        ctx.lineWidth = Math.max(0.8, 0.8 * pts[0].s);
        ctx.stroke();
        ctx.strokeStyle = hsl(accent[0], accent[1], accent[2] * 0.6, 0.09 * pts[0].a);
        ctx.lineWidth = Math.max(0.4, 0.4 * pts[0].s);
        ctx.stroke();
      } else {
        ctx.strokeStyle = hsl(accent[0], accent[1] * 0.5, accent[2] * 0.9, 0.11 * pts[0].a);
        ctx.lineWidth = Math.max(0.5, 0.45 * pts[0].s);
        ctx.stroke();
      }
      if (tier === TIERS.NEAR) {
        // waymarks, so the road is a made thing and not a hint
        for (let i = 2; i < pts.length - 1; i += 3) {
          ctx.beginPath();
          ctx.arc(pts[i].x, pts[i].y, Math.max(0.4, 0.22 * pts[i].s), 0, TAU);
          ctx.fillStyle = hsl(accent[0], accent[1], accent[2], 0.26 * pts[i].a);
          ctx.fill();
        }
      }
    }
  }

  /**
   * Everything standing on the land — the realm's landmarks and its instanced
   * detail — in one depth-sorted pass, so a colonnade really does stand in
   * front of the hall behind it.
   */
  drawPopulation(ctx, realm, tier, stats) {
    const engine = this.engine;
    const world = realm.world;
    const c = realm.center;
    const floorY = c[1] - world.floor;
    const at = (x, y, z) => engine.project([c[0] + x, floorY + y, c[2] + z]);

    const queue = [];
    for (const lm of world.landmarks) {
      const p = at(lm.x, lm.y, lm.z);
      if (!p) continue;
      queue.push({
        p,
        motif: { kind: lm.kind, height: lm.h, width: lm.w, spin: lm.spin },
        opts: { hero: !!lm.central },
      });
      stats.landmarks++;
    }
    if (tier === TIERS.NEAR) {
      // generated here, not before: the detail of a realm you are not standing
      // in has no reason to exist
      for (const it of instances(world, tier)) {
        const p = at(it.x, it.y, it.z);
        if (!p) continue;
        // Cull by size here rather than inside the draw, so the queue only
        // holds work worth doing and the counters mean something. A two-pixel
        // stone is not detail, it is a smudge.
        const px = it.h * p.s;
        if (!(px >= 2.2)) continue;
        queue.push({
          p,
          motif: { kind: it.kind, height: it.h, width: it.w, spin: it.spin },
        });
        stats.detail++;
      }
    }
    queue.sort((a, b) => b.p.z - a.p.z);
    for (const item of queue) {
      this.drawMotif(ctx, item.motif, item.p, floorY, realm, engine, item.opts);
    }
  }

  /**
   * The agents that are actually in this place.
   *
   * An agent is a small body on the ground with a disc of perception around it,
   * and the disc is the point: it is drawn at the same radius the agent
   * actually perceives at, so what you see on screen is exactly what it knows.
   * A memory inside the disc has been noticed; one outside it has not, however
   * close it looks.
   *
   * This is optional and costs nothing when there are no agents: the whole
   * method returns on the first line if the engine has no agent world, which is
   * the normal state of the app until one is spawned.
   */
  drawAgents(ctx, realm) {
    const engine = this.engine;
    const agentWorld = engine.agentWorld;
    if (!agentWorld || !agentWorld.agents.length) return;

    const hue = realm.hue ?? 44;
    for (const agent of agentWorld.agents) {
      if (agent.realmId !== realm.id) continue;

      const p = engine.project(agent.pos);
      if (!p) continue;

      // the perception disc, drawn flat on the ground it is measured over. It is
      // an ellipse because the ground is, so it reads as lying on the land
      // rather than floating in front of it.
      const range = agent.range || 0;
      if (range > 0) {
        const edge = engine.project([agent.pos[0], agent.pos[1], agent.pos[2]]);
        const rim = engine.project([
          agent.pos[0] + Math.cos(agent.yaw) * range,
          agent.pos[1],
          agent.pos[2] + Math.sin(agent.yaw) * range,
        ]);
        const back = engine.project([
          agent.pos[0] - Math.cos(agent.yaw) * range,
          agent.pos[1],
          agent.pos[2] - Math.sin(agent.yaw) * range,
        ]);
        const left = engine.project([
          agent.pos[0],
          agent.pos[1],
          agent.pos[2] + range,
        ]);
        if (edge && rim && back && left && left.z > 0.6) {
          const r = Math.hypot(rim.x - p.x, rim.y - p.y);
          const rBack = Math.hypot(back.x - p.x, back.y - p.y);
          const flat = Math.abs(left.y - p.y);
          const squash = clamp(flat / Math.max(r, rBack, 0.001), 0.05, 1);
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, (r + rBack) / 2, ((r + rBack) / 2) * squash, 0, 0, TAU);
          ctx.strokeStyle = hsl(hue, 70, 70, 0.3 * p.a);
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.stroke();
          ctx.fillStyle = hsl(hue, 70, 60, 0.05 * p.a);
          ctx.fill();
          ctx.restore();
        }
      }

      // the body: a mark on the ground with a facing, so you can see which way
      // it is looking without reading the debug panel
      const r = clamp(1.6 * p.s, 2.2, 9);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fillStyle = hsl(hue, 74, 68, 0.9 * p.a);
      ctx.fill();
      // the facing, as a short bright stroke
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(agent.yaw) * r * 2.1, p.y + Math.sin(agent.yaw) * r * 1.4);
      ctx.strokeStyle = hsl(hue, 90, 82, 0.85 * p.a);
      ctx.lineWidth = Math.max(1, r * 0.42);
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();

      // its id, so more than one agent in a realm is distinguishable
      if (p.s > 0.4 && agent.name) {
        ctx.save();
        ctx.font = `${Math.max(7, Math.round(r * 0.9))}px ui-monospace, monospace`;
        ctx.fillStyle = hsl(hue, 60, 88, 0.75 * p.a);
        ctx.textAlign = 'center';
        ctx.fillText(agent.name, p.x, p.y - r * 1.8);
        ctx.restore();
      }
    }
  }

  /**
   * The weather. Layers are declared per realm and behave differently in each
   * one: mist drifts, embers rise, frost falls, stars hold still. Drawn in two
   * passes so weather can sit both behind and in front of the land.
   */
  drawAtmosphere(ctx, realm, tier, pass) {
    if (tier === TIERS.FAR) return;
    const engine = this.engine;
    const world = realm.world;
    const c = realm.center;
    const R = realm.radius;
    const t = engine.time;
    const pal = world.palette;
    const sky = world.sky;

    for (const layer of world.layers) {
      if ((layer.pass || 'front') !== pass) continue;
      const a = layer.alpha * (tier === TIERS.MID ? 0.6 : 1);
      const drift = (layer.speed ?? 0.1) * t;
      switch (layer.kind) {
        case 'mist':
        case 'cloud': {
          const isCloud = layer.kind === 'cloud';
          for (let i = 0; i < 5; i++) {
            const ang = (i / 5) * TAU + rnd(world.salt, `mst${i}`) * 1.2;
            const rad = R * (0.25 + rnd(world.salt, `msr${i}`) * 0.7);
            const wob = Math.sin(t * (0.3 + i * 0.11) + i) * R * 0.1;
            const y = layer.y * R + Math.sin(t * 0.2 + i) * R * 0.02;
            const p = engine.project([c[0] + Math.cos(ang + drift * 0.1) * rad + wob,
              c[1] - world.floor + y, c[2] + Math.sin(ang + drift * 0.1) * rad]);
            if (!p) continue;
            const s = Math.min(R * 0.5, R * (0.16 + rnd(world.salt, `mss${i}`) * 0.24) * p.s);
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s);
            g.addColorStop(0, hsl(isCloud ? 42 : pal.high[0], isCloud ? 26 : 20,
              isCloud ? 44 : 38, a));
            g.addColorStop(1, hsl(isCloud ? 42 : pal.high[0], 20, 28, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, s, s * 0.3, 0, 0, TAU);
            ctx.fill();
          }
          break;
        }
        case 'ray': {
          // light coming down into the place, which is what a citadel and a
          // well both have and most places do not
          const top = engine.project([c[0], c[1] - world.floor + R * (layer.y + 0.35), c[2]]);
          const base = engine.project([c[0], c[1] - world.floor - R * 0.1, c[2]]);
          if (!top || !base) break;
          for (let i = 0; i < 4; i++) {
            const off = (i - 1.5) * R * 0.42;
            const w = R * (0.08 + rnd(world.salt, `ry${i}`) * 0.12) * top.s;
            const lean = R * 0.16 * top.s;
            const g = ctx.createLinearGradient(top.x + off, top.y, base.x + off + lean, base.y);
            g.addColorStop(0, hsl(sky[0] + 6, 60, 68, a * 1.3));
            g.addColorStop(1, hsl(sky[0] + 6, 60, 58, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(top.x + off - w, top.y);
            ctx.lineTo(top.x + off + w, top.y);
            ctx.lineTo(base.x + off + lean + w * 1.6, base.y);
            ctx.lineTo(base.x + off + lean - w * 1.6, base.y);
            ctx.closePath();
            ctx.fill();
          }
          break;
        }
        case 'ember':
        case 'frost':
        case 'pollen': {
          // motes with a direction: embers climb out of the ground, frost falls
          const rising = layer.kind === 'ember';
          const n = tier === TIERS.NEAR ? 22 : 10;
          for (let i = 0; i < n; i++) {
            const px0 = (rnd(world.salt, `pt${i}`) * 2 - 1) * R;
            const pz0 = (rnd(world.salt, `pp${i}`) * 2 - 1) * R;
            const g0 = groundAt(world, px0, pz0);
            const baseY = g0 ? g0.y : 0;
            const span = R * 1.5;
            const phase = rnd(world.salt, `pq${i}`);
            const k = ((rising ? 1 : -1) * (layer.speed ?? 0.3) * t * 0.5 + phase) % 1;
            const y = baseY + (k < 0 ? k + 1 : k) * span;            const p = engine.project([c[0] + px0 + Math.sin(t * 0.6 + phase * 9) * R * 0.06,
              c[1] - world.floor + y,
              c[2] + pz0 + Math.cos(t * 0.5 + phase * 7) * R * 0.06,
            ]);
            if (!p) continue;
            const size = Math.min(3.4, Math.max(0.6, (rising ? 1.1 : 0.9) * p.s));
            ctx.beginPath();
            ctx.arc(p.x, p.y, size, 0, TAU);
            ctx.fillStyle = layer.kind === 'ember'
              ? hsl(24, 88, 62, a * (0.4 + 0.6 * (k < 0.5 ? k * 2 : (1 - k) * 2)))
              : layer.kind === 'frost'
                ? hsl(198, 40, 82, a * 0.7)
                : hsl(88, 52, 74, a * 0.7);
            ctx.fill();
          }
          break;
        }
        case 'star': {
          // the only light in the abyss, and the reason the abyss has a shape
          const n = tier === TIERS.NEAR ? 90 : 34;
          for (let i = 0; i < n; i++) {
            const ang = rnd(world.salt, `sx${i}`) * TAU;
            const rad = R * (0.2 + rnd(world.salt, `sr${i}`) * 1.15);
            const y = c[1] + (rnd(world.salt, `sy${i}`) - 0.5) * R * 2.2;
            const p = engine.project([c[0] + Math.cos(ang) * rad, y, c[2] + Math.sin(ang) * rad]);
            if (!p) continue;
            const tw = 0.55 + 0.45 * Math.sin(t * (0.6 + i * 0.07) + i);
            // A star is a point. Left unclamped it is a 70-pixel disc whenever
            // one happens to be near the camera, and the abyss fills with fog.
            const size = Math.min(3.0, Math.max(0.4, rnd(world.salt, `ss${i}`) * 1.6 * p.s));
            ctx.beginPath();
            ctx.arc(p.x, p.y, size, 0, TAU);
            ctx.fillStyle = `rgba(255,248,232,${(a * tw * 0.62).toFixed(3)})`;
            ctx.fill();
          }
          break;
        }
        case 'veil':
        case 'storm': {
          for (let i = 0; i < 3; i++) {
            const ang = (i / 3) * TAU + drift * 0.16;
            const rad = R * (0.45 + rnd(world.salt, `vr${i}`) * 0.5);
            const top = engine.project([c[0] + Math.cos(ang) * rad,
              c[1] - world.floor + R * layer.y, c[2] + Math.sin(ang) * rad]);
            const bot = engine.project([c[0] + Math.cos(ang) * rad * 0.8,
              c[1] - world.floor, c[2] + Math.sin(ang) * rad * 0.8]);
            if (!top || !bot) continue;
            const w = R * 0.4 * top.s;
            const g = ctx.createLinearGradient(top.x, top.y, bot.x, bot.y);
            g.addColorStop(0, hsl(layer.kind === 'storm' ? 22 : pal.high[0], 26, 56, a));
            g.addColorStop(1, hsl(layer.kind === 'storm' ? 22 : pal.high[0], 26, 40, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(top.x - w, top.y);
            ctx.lineTo(top.x + w, top.y);
            ctx.lineTo(bot.x + w * 1.5, bot.y);
            ctx.lineTo(bot.x - w * 1.5, bot.y);
            ctx.closePath();
            ctx.fill();
          }
          break;
        }
        case 'glow': {
          // light off the forges, pooling on the floor. Sized from the realm's
          // own projected radius rather than from depth, so it pools the same
          // way however close the camera is.
          const p = engine.project([c[0], c[1] - world.floor + R * layer.y, c[2]]);
          const hub = engine.project(realm.center);
          if (!p || !hub) break;
          const s = R * hub.s * 1.3;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s);
          g.addColorStop(0, hsl(28, 90, 54, a));
          g.addColorStop(1, hsl(28, 90, 40, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, s, 0, TAU);
          ctx.fill();
          break;
        }
        default: break;
      }
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

  /**
   * One piece of architecture or scenery, as a silhouette standing on the
   * ground at `p`. This is the whole component library: every landmark and
   * every instanced detail in every realm is one of these cases, drawn once per
   * instance. `p` is the *base* — the point where it meets the ground — so
   * anything that follows the terrain follows it exactly.
   */
  drawMotif(ctx, motif, p, floorY, centre, engine, opts = {}) {
    const { hero = false, min = 1.1 } = opts;
    const s = p.s;
    const h = motif.height * s;
    const w = motif.width * s;
    // NaN fails every comparison, so this has to be an explicit finite check:
    // a non-finite size reaches createRadialGradient and takes the frame down
    if (!(h >= min) || !(w >= min * 0.2)) return;
    const base = p.y;
    const fade = clamp(p.a ?? 1, 0, 1);
    const gh = centre.hue ?? 44;
    const pal = centre.world?.palette;
    const tint = (l, a) => hsl(gh, 30, l, a * fade);
    // the palette a realm grew for its own architecture, not the tree's gold
    const paint = pal ? (l, a, s2) => hsl(pal.mid[0], pal.mid[1], l, a * fade) : tint;
    ctx.save();
    ctx.translate(p.x, base);      if (hero) {
      // a landmark big enough to be the reason the realm is named deserves to
      // be legible at a distance, so it gets a light behind it — but a glow
      // scaled to the whole silhouette becomes fog over the landscape
      const g = ctx.createRadialGradient(0, -h * 0.5, 0, 0, -h * 0.5, Math.max(h, w) * 0.9);
      g.addColorStop(0, hsl(pal ? pal.accent[0] : gh, 70, 62, 0.1 * fade));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -h * 0.5, Math.max(h, w) * 1.5, 0, TAU);
      ctx.fill();
    }
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

      // ── the component library, extended for the new landforms ──────────
      case 'terrace': { // a made platform: the mark of a place that was built
        const steps = 4;
        for (let i = 0; i < steps; i++) {
          const t = i / steps;
          ctx.fillStyle = paint(30 - i * 4, 0.9 - t * 0.3);
          ctx.fillRect(-w * (2.4 - t * 1.1), -h * (0.2 + t * 0.8), w * (4.8 - t * 2.2), h * 0.24);
        }
        ctx.fillStyle = hsl(pal ? pal.accent[0] : gh, 60, pal ? pal.accent[2] : 60, 0.4 * fade);
        ctx.fillRect(-w * 0.9, -h, w * 1.8, h * 0.22);
        break;
      }
      case 'colonnade': { // a row of piers, which reads as architecture at any size
        const piers = 5;
        for (let i = 0; i < piers; i++) {
          const t = i / (piers - 1);
          const x = (t - 0.5) * w * 4.4;
          const hh = h * (0.72 + Math.sin(t * Math.PI) * 0.28);
          ctx.fillStyle = paint(32 - Math.abs(t - 0.5) * 16, 0.88);
          ctx.fillRect(x - w * 0.22, -hh, w * 0.44, hh);
        }
        // the architrave across the top: what makes it a building
        ctx.fillStyle = paint(38, 0.8);
        ctx.fillRect(-w * 2.4, -h, w * 4.8, h * 0.12);
        break;
      }
      case 'banner': { // what a place looks like when it is at its festival
        ctx.strokeStyle = paint(30, 0.85);
        ctx.lineWidth = Math.max(0.8, w * 0.16);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -h);
        ctx.stroke();
        const wave = Math.sin(this.engine.time * 1.6 + motif.spin) * w * 0.5;
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(w * 2.1, -h + h * 0.12 + wave * 0.1);
        ctx.lineTo(w * 1.7, -h * 0.7 + wave * 0.16);
        ctx.lineTo(0, -h * 0.72);
        ctx.closePath();
        ctx.fillStyle = hsl(pal ? pal.accent[0] : gh, 78, pal ? pal.accent[2] : 62, 0.55 * fade);
        ctx.fill();
        break;
      }
      case 'grove': { // a wood seen as one mass, with its own edge
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * TAU + motif.spin;
          const d = w * (0.5 + (i % 3) * 0.5);
          const x = Math.cos(a) * d;
          const hh = h * (0.5 + ((i * 37) % 10) / 14);
          ctx.strokeStyle = paint(26, 0.7);
          ctx.lineWidth = Math.max(0.5, w * 0.14);
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, -hh * 0.5);
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(x, -hh * 0.68, w * 0.7, hh * 0.34, 0, 0, TAU);
          ctx.fillStyle = paint(30, 0.62);
          ctx.fill();
        }
        break;
      }
      case 'fissure': { // a crack in the world, with something down it
        const jag = 0.4 + 0.6 * Math.abs(Math.sin(motif.spin));
        ctx.moveTo(-w * 1.6, 0);
        ctx.lineTo(-w * 0.3, -h * 0.3 * jag);
        ctx.lineTo(w * 0.1, h * 0.1);
        ctx.lineTo(w * 0.6, -h * 0.22 * jag);
        ctx.lineTo(w * 1.7, 0);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,0,0,0.88)';
        ctx.fill();
        ctx.strokeStyle = hsl(24, 88, 58, 0.34 * fade);
        ctx.lineWidth = Math.max(0.6, w * 0.1);
        ctx.beginPath();
        ctx.moveTo(-w * 1.4, -h * 0.02);
        ctx.lineTo(-w * 0.2, -h * 0.26 * jag);
        ctx.lineTo(w * 0.5, -h * 0.18 * jag);
        ctx.stroke();
        break;
      }
      case 'moraine': { // a ridge of rock someone pushed here
        for (let i = 0; i < 5; i++) {
          const t = (i / 4 - 0.5) * 2;
          const hh = h * (0.45 + (1 - Math.abs(t)) * 0.55);
          ctx.beginPath();
          ctx.moveTo(t * w * 2.4 - w * 0.8, 0);
          ctx.lineTo(t * w * 2.4, -hh);
          ctx.lineTo(t * w * 2.4 + w * 0.8, 0);
          ctx.closePath();
          ctx.fillStyle = paint(24 - i, 0.8);
          ctx.fill();
        }
        break;
      }
      case 'glacier': { // a wedge of ice that has stopped moving
        ctx.moveTo(-w * 1.8, 0);
        ctx.lineTo(-w * 0.4, -h);
        ctx.lineTo(w * 0.9, -h * 0.72);
        ctx.lineTo(w * 1.8, 0);
        ctx.closePath();
        ctx.fillStyle = hsl(198, 46, 52, 0.66 * fade);
        ctx.fill();
        ctx.strokeStyle = hsl(194, 50, 82, 0.3 * fade);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-w * 0.4, -h);
        ctx.lineTo(-w * 0.1, -h * 0.3);
        ctx.lineTo(w * 0.5, 0);
        ctx.stroke();
        break;
      }
      case 'shaft': { // a shaft of worked rock, with the light coming up it
        ctx.moveTo(-w * 0.7, 0);
        ctx.lineTo(-w * 0.5, -h);
        ctx.lineTo(w * 0.5, -h);
        ctx.lineTo(w * 0.7, 0);
        ctx.closePath();
        ctx.fillStyle = paint(20, 0.9);
        ctx.fill();
        const g = ctx.createLinearGradient(0, 0, 0, -h);
        g.addColorStop(0, hsl(38, 92, 62, 0.7 * fade));
        g.addColorStop(1, hsl(38, 92, 62, 0));
        ctx.fillStyle = g;
        ctx.fillRect(-w * 0.22, -h, w * 0.44, h);
        break;
      }
      case 'barrage': { // a weir: the reason the water above is standing still
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = paint(28 - i * 5, 0.85);
          ctx.fillRect(-w * (2 - i * 0.4), -h * (0.3 + i * 0.3), w * (4 - i * 0.8), h * 0.3);
        }
        ctx.strokeStyle = hsl(pal ? pal.water?.[0] ?? 196 : 196, 60, 70, 0.4 * fade);
        ctx.lineWidth = Math.max(0.6, w * 0.12);
        ctx.beginPath();
        ctx.moveTo(-w * 2, 0);
        ctx.lineTo(w * 2, 0);
        ctx.stroke();
        break;
      }
      case 'rune': { // a standing stone with a mark on it
        ctx.moveTo(-w * 0.4, 0);
        ctx.lineTo(-w * 0.28, -h);
        ctx.lineTo(w * 0.34, -h * 0.9);
        ctx.lineTo(w * 0.46, 0);
        ctx.closePath();
        ctx.fillStyle = paint(18, 0.9);
        ctx.fill();
        const glow = 0.5 + 0.5 * Math.sin(this.engine.time * 1.1 + motif.spin);
        ctx.strokeStyle = hsl(pal ? pal.accent[0] : 196, 80, pal ? pal.accent[2] : 70,
          (0.28 + glow * 0.3) * fade);
        ctx.lineWidth = Math.max(0.6, w * 0.16);
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.78);
        ctx.lineTo(0, -h * 0.34);
        ctx.moveTo(-w * 0.16, -h * 0.62);
        ctx.lineTo(w * 0.16, -h * 0.62);
        ctx.stroke();
        break;
      }
      case 'lattice': { // a structure that is more air than matter
        ctx.strokeStyle = pal
          ? hsl(pal.accent[0], pal.accent[1] * 0.6, pal.accent[2] * 0.7, 0.6 * fade)
          : tint(34, 0.7);
        ctx.lineWidth = Math.max(0.7, w * 0.16);
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(i * w * 1.3, 0);
          ctx.lineTo(i * w * 0.5, -h);
          ctx.moveTo(i * w * 0.5, -h);
          ctx.lineTo(i * w * 1.3, 0);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(-w * 1.5, -h * 0.34);
        ctx.lineTo(w * 1.5, -h * 0.34);
        ctx.stroke();
        break;
      }
      case 'shelf': { // the lip of floating ground: what you could fall off
        ctx.moveTo(-w * 2.2, 0);
        ctx.lineTo(w * 2.2, 0);
        ctx.lineTo(w * 1.4, -h * 0.5);
        ctx.lineTo(-w * 1.2, -h * 0.42);
        ctx.closePath();
        ctx.fillStyle = paint(30, 0.85);
        ctx.fill();
        ctx.strokeStyle = hsl(44, 40, 74, 0.24 * fade);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-w * 2.2, 0);
        ctx.lineTo(w * 2.2, 0);
        ctx.stroke();
        break;
      }
      case 'strata': { // the layered rock of a world with no bottom
        for (let i = 0; i < 5; i++) {
          const t = i / 5;
          ctx.fillStyle = paint(26 - i * 3, 0.7 - t * 0.25);
          ctx.fillRect(-w * (1.4 - t * 0.5), -h * (t + 0.2),
            w * (2.8 - t * 1), h * 0.2);
        }
        break;
      }
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
  }

  /**
   * Root filaments drifting under the realm. Drawn *before* the world, because
   * they are underneath it — and because drawing them afterwards meant they
   * hung across the land like scratches on the lens.
   */
  drawUnderRealm(ctx, realm) {
    const engine = this.engine;
    const tier = this.tier ?? TIERS.NEAR;
    const count = tier === TIERS.NEAR ? 12 : tier === TIERS.MID ? 6 : 0;
    for (let i = 0; i < count; i++) {
      const a = (i / 12) * TAU + rnd('floor', `a${i}`) * 0.3;
      const r = realm.radius * (0.5 + rnd('floor', `r${i}`) * 0.8);
      const centre = add(realm.center, [Math.cos(a) * r, -realm.radius * 0.95, Math.sin(a) * r]);
      const s = engine.project(centre);
      if (!s) continue;
      const len = (12 + rnd('floor', `l${i}`) * 26) * s.s;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(s.x + Math.cos(a) * len, s.y + len * 0.4,
        s.x + Math.cos(a) * len * 1.6, s.y + len * 0.9);
      ctx.strokeStyle = hsl(realm.hue ?? 44, 55, 52, 0.13 * s.a);
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

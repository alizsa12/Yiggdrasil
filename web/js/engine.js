// Yggdrasil · navigation
//
// The engine owns the camera, the pointer, picking, and the two places you can
// stand: outside the organism, looking at the whole world tree, or inside one
// realm, where its boughs and neurons are around you. All drawing is the
// organism's business — see organism.js.

import { computeLayout, visibility, WORLD_RADIUS } from './layout.js';
import { Organism } from './organism.js';
import {
  TAU, add, clamp, cross, damp, dot, easeOutCubic, hsl, lerp, mix3, mul, norm, rnd, sub, wrapHue,
} from './util.js';

const FOV = 38;                // a longer lens: less perspective distortion
const LEAF_SCALE = 0.24;

export class YggdrasilEngine {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.time = 0;
    this.showLinks = true;
    this.realmId = null;          // which realm you are standing inside
    this.paused = false;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.cam = { yaw: 0.72, pitch: -0.14, dist: 330, tx: 0, ty: 0, tz: 0 };
    this.cur = { yaw: 0.72, pitch: -0.14, dist: 330, tx: 0, ty: 0, tz: 0 };
    this.centerOffset = 0;
    this.focal = 900;

    this.layout = null;
    this.state = null;
    this.organism = new Organism(this);
    this.projected = new Map();
    this.anim = new Map();
    this.selected = null;
    this.selectedMemoryId = null;
    this.hovered = null;
    this.hoveredMemoryId = null;
    this.matches = new Set();
    this.isolate = null;
    this.dirty = true;
    this._userMoved = false;
    this.onHover = options.onHover || (() => {});
    this.onCameraMove = options.onCameraMove || (() => {});

    this._bindInput();
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver(() => {
        const rect = canvas.getBoundingClientRect();
        if (Math.round(rect.width) !== this.width || Math.round(rect.height) !== this.height) {
          this.resize();
        }
      });
      this._observer.observe(canvas);
    }
  }

  // ------------------------------------------------------------------ state
  setState(state) {
    const previous = this.state;
    this.state = state;
    this.layout = computeLayout(state);
    this.vis = visibility(state, this.layout.byId);
    if (!previous) {
      for (const id of this.layout.pos.keys()) this.anim.set(id, 0);
    } else {
      for (const id of this.layout.pos.keys()) if (!this.anim.has(id)) this.anim.set(id, 0);
      for (const id of Array.from(this.anim.keys())) {
        if (!this.layout.pos.has(id)) this.anim.delete(id);
      }
    }
    if (this.selected && !this.layout.pos.has(this.selected)) this.select(null);
    // the first layout is the establishing shot: place the camera on it
    // immediately rather than easing in from the default distance, so the
    // first thing anyone sees is the whole tree
    if (!previous) {
      this.establish(true);
    }
    this.dirty = true;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.width = width;
    this.height = height;
    this.focal = (height / 2) / Math.tan((FOV * Math.PI) / 360);
    this.organism.cosmos = null;
    this.organism.seeded = false;
    // the establishing distance depends on the viewport, so it can only be
    // settled once the canvas has been measured — re-derive it until the
    // viewer takes the camera themselves
    if (this.layout && !this._userMoved && !this.realmId) this.establish(true);
    this.dirty = true;
  }

  /**
   * Place the camera on the whole organism. `snap` skips the ease, which is
   * what the first frame and a resize want.
   */
  establish(snap = false) {
    const centre = this.layout?.center || [0, 0, 0];
    this.flyTo([centre[0], centre[1] - WORLD_RADIUS * 0.05, centre[2]], this.fitDistance());
    if (snap) this.cur = { ...this.cam };
  }

  // ------------------------------------------------------------------ camera
  flyTo(pos, dist, opts = {}) {
    this.cam.tx = pos[0]; this.cam.ty = pos[1]; this.cam.tz = pos[2];
    if (dist != null) this.cam.dist = clamp(dist, 6, 900);
    if (opts.yaw != null) this.cam.yaw = opts.yaw;
    if (opts.pitch != null) this.cam.pitch = opts.pitch;
    this.dirty = true;
  }

  fitDistance() {
    const min = Math.min(this.width || 800, this.height || 600);
    // the whole organism, with headroom: the tree should stand inside the
    // frame, not fill it edge to edge
    return clamp((this.focal * WORLD_RADIUS) / (0.37 * min), 120, 900);
  }

  frameAll() {
    this.realmId = null;
    this.organism.seeded = false;
    this._userMoved = false;
    this.establish();
    this.onRealmChange?.(null);
  }

  /**
   * Enter a realm: the camera travels down the limb and into the volume, and
   * from then on the memories are where they were grown, on the boughs.
   *
   * It arrives looking *down* at the land rather than level with the middle of
   * the volume. A realm's ground sits below its centre, so a level camera sees
   * mostly wood and sky and the country is out of frame entirely; and a ground
   * plane seen edge-on collapses into a thin band no matter how wide the lens.
   * Looking down at it is what turns the volume into a place.
   */
  enterRealm(realmId) {
    const realm = this.layout?.realms?.realms.get(realmId);
    if (!realm) return;
    if (this.realmId !== realmId) {
      this.realmId = realmId;
      this.organism.seeded = false;
      this.organism.cosmos = null;
    }
    const world = realm.world;
    const look = world ? realm.center[1] - world.floor * 0.88 : realm.center[1];
    this.flyTo([realm.center[0], look, realm.center[2]], realm.radius * 2.5, { pitch: -0.46 });
    this.onRealmChange?.(realmId);
  }

  leaveRealm() {
    if (!this.realmId) { this.frameAll(); return; }
    const realm = this.layout?.realms?.realms.get(this.realmId);
    // rise back out through the conduit, then frame the whole organism
    this.realmId = null;
    this.organism.seeded = false;
    this.organism.cosmos = null;
    if (realm) this.flyTo(realm.tip, this.fitDistance());
    else this.frameAll();
    this.onRealmChange?.(null);
  }

  focusNode(nodeId, opts = {}) {
    const pos = this.realmId ? this.interiorPos(nodeId) : this.layout?.pos.get(nodeId);
    if (!pos) return;
    this.isolate = null;
    const base = this.realmId
      ? (this.layout.realms.realms.get(this.realmId)?.radius || 24) * 0.85
      : 70;
    this.flyTo(pos, opts.dist ?? base);
  }

  /** a memory's position in whichever world you are currently standing in */
  interiorPos(nodeId) {
    if (!this.realmId) return this.layout?.pos.get(nodeId);
    const realm = this.layout.realms.realms.get(this.realmId);
    return realm?.innerPos.get(nodeId) || this.layout?.pos.get(nodeId);
  }

  focusMemory(memoryId) {
    const nodeId = this.memoryNodeId(memoryId);
    if (!nodeId) return null;
    this.focusNode(nodeId);
    this.select(nodeId);
    this.selectedMemoryId = memoryId;
    return nodeId;
  }

  memoryNodeId(memoryId) {
    return this.memoryNode.get(memoryId);
  }

  get memoryNode() {
    if (!this._memNode || this._memNodeVersion !== (this.state?.memories?.length ?? -1)) {
      this._memNode = new Map();
      for (const memory of this.state?.memories || []) this._memNode.set(memory.id, memory.node_id);
      this._memNodeVersion = this.state?.memories?.length ?? -1;
    }
    return this._memNode;
  }

  select(nodeId, memoryId) {
    this.selected = nodeId;
    this.selectedMemoryId = memoryId || null;
    this.dirty = true;
  }

  hover(nodeId) {
    if (this.hovered === nodeId) return;
    this.hovered = nodeId;
    const memory = this.layout?.memoryByNode.get(nodeId);
    this.hoveredMemoryId = memory?.id || null;
    this.onHover(nodeId ? this.describe(nodeId) : null, this.pointer);
    this.dirty = true;
  }

  describe(nodeId) {
    const node = this.layout?.byId.get(nodeId);
    if (!node) return null;
    return { node, memory: this.layout.memoryByNode.get(nodeId), pos: this.interiorPos(nodeId) };
  }

  setMatches(ids) {
    this.matches = new Set(ids || []);
    this.dirty = true;
  }

  setIsolate(nodeId) {
    this.isolate = nodeId;
    this.dirty = true;
  }

  // ------------------------------------------------------------------ input
  _bindInput() {
    const canvas = this.canvas;
    let dragging = false;
    let panning = false;
    let moved = 0;
    let last = { x: 0, y: 0 };
    let downAt = 0;

    const pointerPos = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    canvas.addEventListener('pointerdown', (event) => {
      try { canvas.setPointerCapture(event.pointerId); } catch { /* no active pointer */ }
      this._userMoved = true;
      dragging = true;
      panning = event.shiftKey || event.button === 1 || event.button === 2;
      moved = 0;
      last = pointerPos(event);
      downAt = performance.now();
      canvas.classList.add('grabbing');
    });

    canvas.addEventListener('pointermove', (event) => {
      const point = pointerPos(event);
      this.pointer = { x: event.clientX, y: event.clientY };
      if (!dragging) {
        const hit = this.pick(point.x, point.y);
        this.hover(hit ? hit.id : null);
        canvas.style.cursor = hit ? 'pointer' : 'grab';
        return;
      }
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      last = point;
      moved += Math.abs(dx) + Math.abs(dy);
      if (panning) {
        const scale = (this.cur.dist / this.focal) * 1.1;
        const right = [Math.cos(this.cur.yaw), 0, -Math.sin(this.cur.yaw)];
        const up = norm(cross(right, [0, 1, 0]));
        this.cam.tx += (-dx * right[0] + dy * up[0]) * scale;
        this.cam.ty += (-dx * right[1] + dy * up[1]) * scale;
        this.cam.tz += (-dx * right[2] + dy * up[2]) * scale;
      } else {
        this.cam.yaw -= dx * 0.0055;
        this.cam.pitch = clamp(this.cam.pitch + dy * 0.0045, -1.45, 1.45);
      }
      this.dirty = true;
    });

    const release = (event) => {
      if (!dragging) return;
      dragging = false;
      canvas.classList.remove('grabbing');
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      if (moved < 5 && performance.now() - downAt < 600) {
        const point = pointerPos(event);
        const hit = this.pick(point.x, point.y);
        this.onPick(hit ? hit.id : null, hit ? hit.node : null);
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    canvas.addEventListener('dblclick', (event) => {
      const rect = canvas.getBoundingClientRect();
      const hit = this.pick(event.clientX - rect.left, event.clientY - rect.top);
      if (!hit) {
        this.setIsolate(null);
        if (this.realmId) this.leaveRealm(); else this.frameAll();
        return;
      }
      const node = hit.node;
      if (node.kind === 'domain') { this.enterRealm(node.id); return; }
      if (node.kind === 'leaf') {
        this.focusMemory(this.layout.memoryByNode.get(hit.id)?.id);
      } else {
        this.setIsolate(this.isolate === hit.id ? null : hit.id);
        this.focusNode(hit.id);
      }
    });

    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this._userMoved = true;
      const factor = Math.exp(event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0016));
      this.cam.dist = clamp(this.cam.dist * factor, 6, 900);
      this.dirty = true;
    }, { passive: false });
  }

  pick(x, y) {
    let best = null;
    let bestScore = Infinity;
    for (const [id, p] of this.projected) {
      const node = this.layout.byId.get(id);
      if (!node || p.a <= 0.04) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const distance = Math.hypot(dx, dy);
      if (distance > Math.max(11, p.r + 8)) continue;
      const score = distance + p.z * 0.02 - (node.kind === 'leaf' ? 4 : 0);
      if (score < bestScore) { bestScore = score; best = { id, node }; }
    }
    return best;
  }

  // ------------------------------------------------------------------ frame
  updateCamera(dt) {
    const k = damp(6, dt);
    this.cur.yaw = lerp(this.cur.yaw, this.cam.yaw, k);
    this.cur.pitch = lerp(this.cur.pitch, this.cam.pitch, k);
    this.cur.dist = lerp(this.cur.dist, this.cam.dist, k);
    this.cur.tx = lerp(this.cur.tx, this.cam.tx, k);
    this.cur.ty = lerp(this.cur.ty, this.cam.ty, k);
    this.cur.tz = lerp(this.cur.tz, this.cam.tz, k);

    const { yaw, pitch, dist, tx, ty, tz } = this.cur;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    this.forward = norm([sy * cp, -sp, cy * cp]);
    this.right = norm(cross(this.forward, [0, 1, 0]));
    this.up = cross(this.right, this.forward);
    this.eye = add([tx, ty, tz], mul(this.forward, -dist));
    this.moving = Math.abs(this.cur.dist - this.cam.dist) > 0.4
      || Math.abs(this.cur.tx - this.cam.tx) > 0.2
      || Math.abs(this.cur.yaw - this.cam.yaw) > 0.002;
  }

  project(pos) {
    const rel = sub(pos, this.eye);
    const z = dot(rel, this.forward);
    if (z <= 0.6) return null;
    const scale = this.focal / z;
    return {
      x: this.width / 2 + this.centerOffset + dot(rel, this.right) * scale,
      y: this.height / 2 - dot(rel, this.up) * scale,
      z,
      s: scale,
      a: clamp(1.3 - z / (this.cur.dist * 4.2), 0.05, 1),
    };
  }

  /** how brightly a node should be drawn right now */
  factorFor({ node, p }) {
    if (!node) return 1;
    const id = node.id;
    let factor = p?.a ?? 1;
    const memory = this.layout?.memoryByNode.get(id);

    // inside a realm, only that realm is lit
    if (this.realmId) {
      const realm = this.layout.realms.realms.get(this.realmId);
      if (memory && realm && !realm.members.includes(id)) factor *= 0.12;
    } else if (memory) {
      // outside, memories of the realm you are inside are dimmed
      const home = this.layout.realms.realmOfNode.get(id);
      if (this.highlightRealm && home === this.highlightRealm) factor *= 0.25;
    }

    if (this.matches.size) {
      factor *= memory && this.matches.has(memory.id) ? 1 : 0.2;
    }
    if (this.isolate) {
      const chain = this.layout.path.get(id);
      factor *= chain && chain.includes(this.isolate) ? 1 : 0.12;
    }
    if (this.hovered === id || this.selected === id) factor = Math.min(1.4, factor * 1.35);
    return factor;
  }

  render(dt) {
    this.time += dt;
    if (!this.layout) return;
    this.updateCamera(dt);

    for (const [id, t] of this.anim) {
      if (t < 1) this.anim.set(id, Math.min(1, t + dt * (this.reducedMotion ? 6 : 1.9)));
    }

    // project whatever the current world contains
    this.projected.clear();
    const inside = this.realmId ? this.layout.realms.realms.get(this.realmId) : null;
    const source = inside ? inside.members : this.layout.pos.keys();
    for (const id of source) {
      if (!inside && !this.vis.visible.has(id)) continue;
      const world = inside ? inside.innerPos.get(id) : this.layout.pos.get(id);
      if (!world) continue;
      const p = this.project(world);
      if (!p) continue;
      const grow = this.anim.get(id) ?? 1;
      const worldRadius = inside
        ? this.layout.radiusOf(id) * 0.28
        : this.layout.radiusOf(id) * LEAF_SCALE;
      p.r = clamp(worldRadius * p.s, 0.35, 90) * (0.15 + 0.85 * easeOutCubic(grow));
      this.projected.set(id, p);
    }

    this.organism.draw(dt);

    if (this.moving) this.onCameraMove();
  }

  start() {
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      try {
        if (!this.paused) this.render(dt);
      } catch (error) {
        // one bad frame must never stop the organism from breathing
        if (!this._warned) { this._warned = true; console.error('render error', error); }
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
    return this;
  }

  stop() { cancelAnimationFrame(this._raf); }
}

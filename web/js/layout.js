// Yggdrasil · the organism's anatomy
//
// The canopy is grown the way a tree grows, not the way a diagram is drawn:
// a trunk, limbs that keep climbing, and a crown. Two things live in that
// space and they are what makes it an organism rather than a chart:
//
//   veins      the vascular system. Every limb carries a main vein and a
//              capillary reaching to each memory. Cross-realm relationships
//              run *through* the trunk, the way signals travel in wood.
//   realms     each of the nine is a volume of space, not a dot. Inside a
//              realm there are great boughs crossing the dark, and the
//              memories are grown into them, embedded where you find them.
//
// The same memory has two homes — one on the exterior canopy, one inside its
// realm — because the same cell is both part of the tree and part of the world
// its branch opens onto.

import {
  GOLDEN, TAU, add, basis, cross, dist, dot, mix3, mul, norm, rnd, sub, clamp,
} from './util.js';
import { buildWorld } from './world.js';

/** segment length by depth: a long trunk tapering into the canopy */
const SEGMENT = [58, 52, 40, 30, 22, 15, 11];

/** how tall the bole is: the limbs leave it along its length, not at one point */
const TRUNK = 190;

/**
 * Branch thickness by depth, before the subtree-weight modifier. The first
 * entry is the bole (drawn separately, and colossal); the rest stay slim
 * against it so the trunk stays the subject and the crown stays airy.
 */
const THICKNESS = [19, 5.2, 3.4, 2.2, 1.4, 0.9, 0.6];

/** the buttress roots that hold the tree up */
const ROOT_COUNT = 6;

const segLength = (depth) => SEGMENT[Math.min(depth, SEGMENT.length - 1)];
const clusterRadius = (depth) => (13 - Math.min(depth, 5) * 1.5);
const UP = [0, 1, 0];

export const WORLD_RADIUS = 100;

/** a point on a quadratic bezier — the curve every limb is built from */
function quad(p0, c, p1, t) {
  const mt = 1 - t;
  return [
    mt * mt * p0[0] + 2 * mt * t * c[0] + t * t * p1[0],
    mt * mt * p0[1] + 2 * mt * t * c[1] + t * t * p1[1],
    mt * mt * p0[2] + 2 * mt * t * c[2] + t * t * p1[2],
  ];
}

/**
 * The vein that runs inside a limb, as world-space samples.
 * Kept here (not in the renderer) so the anatomy is stable: the tree does not
 * re-shape itself when the camera moves.
 */
function vein(from, to, seed, depth, samples = 12) {
  const axis = norm(sub(to, from));
  const [u, v] = basis(axis);
  const phi = rnd(seed, 'vphi') * TAU;
  const out = norm(add(mul(u, Math.cos(phi)), mul(v, Math.sin(phi))));
  const span = dist(from, to);
  // limbs near the trunk run almost straight; twigs wander
  const amp = (depth <= 1 ? 0.03 : 0.16 + 0.14 * rnd(seed, 'vamp')) * span;
  const control = add(mix3(from, to, 0.5), mul(out, amp));
  const points = [];
  for (let i = 0; i <= samples; i++) points.push(quad(from, control, to, i / samples));
  return { points, control };
}

/** a capillary: the fine vessel that leaves a bough to reach one neuron */
function capillary(from, to, seed, samples = 8) {
  const axis = norm(sub(to, from));
  const [u, v] = basis(axis);
  const phi = rnd(seed, 'cphi') * TAU;
  const out = norm(add(mul(u, Math.cos(phi)), mul(v, Math.sin(phi))));
  const control = add(mix3(from, to, 0.5), mul(out, dist(from, to) * 0.3));
  const points = [];
  for (let i = 0; i <= samples; i++) points.push(quad(from, control, to, i / samples));
  return points;
}

export function computeLayout(state, options = {}) {
  const nodes = state.nodes || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map();
  const roots = [];

  for (const node of nodes) {
    if (node.parent_id && byId.has(node.parent_id)) {
      if (!children.has(node.parent_id)) children.set(node.parent_id, []);
      children.get(node.parent_id).push(node);
    } else if (!node.parent_id) {
      roots.push(node);
    }
  }

  // heavy subtrees first: the strongest child keeps the trunk's line of sight
  for (const list of children.values()) {
    list.sort((a, b) => {
      const aLeaf = a.kind === 'leaf' ? 1 : 0;
      const bLeaf = b.kind === 'leaf' ? 1 : 0;
      if (aLeaf !== bLeaf) return aLeaf - bLeaf;
      return (b.weight || 0) - (a.weight || 0) || (a.name < b.name ? -1 : 1);
    });
  }

  const pos = new Map();
  const dir = new Map();
  const thick = new Map();
  const path = new Map();
  const depthOf = new Map();
  const veins = new Map();        // node id -> samples along its parent vein
  const capillaries = new Map();  // memory node id -> samples from the bough
  let maxWeight = 0;
  for (const node of nodes) maxWeight = Math.max(maxWeight, node.weight || 0);

  // A colossal tree is a bole with limbs leaving it at different heights, not
  // a single point spraying. Stagger the realms up the trunk so the silhouette
  // reads as a tree instead of a burst.
  const limbHeight = new Map();
  if (roots.length) {
    const limbs = (children.get(roots[0].id) || []).filter((k) => k.kind !== 'leaf');
    limbs.forEach((k, i) => {
      const t = limbs.length === 1 ? 0.45 : (i + 0.4) / limbs.length;
      limbHeight.set(k.id, 0.16 + 0.84 * t);
    });
  }

  const grow = (node, nodePos, nodeDir, depth, ancestors) => {
    pos.set(node.id, nodePos);
    dir.set(node.id, nodeDir);
    depthOf.set(node.id, depth);
    path.set(node.id, ancestors);
    thick.set(node.id,
      (THICKNESS[Math.min(depth, THICKNESS.length - 1)] || 0.3)
      * (0.55 + 0.95 * clamp((node.weight || 0) / (maxWeight || 1), 0, 1)));

    const kids = children.get(node.id) || [];
    if (!kids.length) return;

    const [u, v] = basis(nodeDir);
    const branches = kids.filter((k) => k.kind !== 'leaf');
    const leaves = kids.filter((k) => k.kind === 'leaf');

    branches.forEach((child, i) => {
      const phi = i * GOLDEN + rnd(child.id, 'phi') * 1.1;
      const radial = norm(add(mul(u, Math.cos(phi)), mul(v, Math.sin(phi))));
      // the first bough keeps the parent's heading — that is what makes the
      // difference between a tree and a starburst
      const spread = branches.length === 1 ? 0.5
        : 0.2 + 0.8 * Math.pow(i / (branches.length - 1), 0.8);
      let childDir = norm(rotateAbout(nodeDir, radial, spread));
      // limbs lean back toward vertical: a tree grows up, but a colossal one
      // throws its limbs wide before it gathers them back
      childDir = norm(mix3(childDir, UP, depth < 2 ? 0.14 : depth < 4 ? 0.12 : 0.07));
      const weightN = clamp((child.weight || 0) / (maxWeight || 1), 0, 1);
      const len = segLength(depth + 1) * (0.8 + 0.32 * rnd(child.id, 'len'));
      // the big limbs are pushed well off the bole so the crown is open
      const lateral = len * (depth === 0 ? 0.42 : 0.06) * (0.6 + 0.4 * weightN);
      // the first limbs leave the bole at staggered heights, so they read as
      // limbs of one trunk rather than spokes of a wheel
      const origin = depth === 0
        ? add(nodePos, [0, TRUNK * (limbHeight.get(child.id) ?? 0.5), 0])
        : nodePos;
      const childPos = add(add(origin, mul(childDir, len)), mul(radial, lateral));
      veins.set(child.id, vein(origin, childPos, child.id, depth + 1));
      grow(child, childPos, childDir, depth + 1, [...ancestors, child.id]);
    });

    // leaves: a phyllotaxis disc at the tip of the bough
    const R = clusterRadius(depth);
    const tilt = 0.35 + rnd(node.id, 'tilt') * 0.5;
    const [lu, lv] = basis(norm(rotateAbout(nodeDir, u, tilt)));
    leaves.forEach((leaf, j) => {
      const t = (j + 0.55) / leaves.length;
      const radius = R * Math.sqrt(t) * (0.72 + 0.4 * rnd(leaf.id, 'r'));
      const theta = j * GOLDEN + rnd(leaf.id, 'theta');
      const radial2 = add(mul(lu, Math.cos(theta)), mul(lv, Math.sin(theta)));
      let p = add(add(nodePos, mul(radial2, radius)), mul(nodeDir, R * (0.22 + 0.42 * rnd(leaf.id, 'z'))));
      p = [p[0], p[1] + (rnd(leaf.id, 'y') - 0.62) * R * 0.3 + R * 0.18, p[2]];
      p = add(p, [
        (rnd(leaf.id, 'jx') - 0.5) * 0.7,
        (rnd(leaf.id, 'jy') - 0.5) * 0.7,
        (rnd(leaf.id, 'jz') - 0.5) * 0.7,
      ]);
      pos.set(leaf.id, p);
      dir.set(leaf.id, norm(sub(p, nodePos)));
      depthOf.set(leaf.id, depth + 1);
      path.set(leaf.id, [...ancestors, leaf.id]);
      thick.set(leaf.id, 0.22 + 0.5 * clamp(leaf.weight || 0, 0, 1));
      // the vessel that feeds this neuron leaves the bough, not the air
      const source = veins.get(leaf.id)
        ? veins.get(leaf.id).points[3]
        : nodePos;
      capillaries.set(leaf.id, capillary(source, p, leaf.id));
    });
  };

  roots.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  for (const root of roots) grow(root, [0, -WORLD_RADIUS * 0.55, 0], [0, 1, 0], 0, [root.id]);

  for (const node of nodes) {
    if (pos.has(node.id)) continue;
    const a = rnd(node.id, 'x') * TAU;
    const r = WORLD_RADIUS * (0.3 + 0.6 * rnd(node.id, 'y'));
    const p = [Math.cos(a) * r, (rnd(node.id, 'z') - 0.5) * WORLD_RADIUS, Math.sin(a) * r];
    pos.set(node.id, p);
    dir.set(node.id, norm(sub(p, [0, -WORLD_RADIUS * 0.55, 0])));
    depthOf.set(node.id, 4);
    path.set(node.id, [node.id]);
    thick.set(node.id, 1);
  }

  const { center, scale, xf } = normalise(pos);
  // veins, capillaries and thickness were grown in raw space, so they need the
  // same transform the node positions got. Without this the wood and the
  // neurons it feeds end up in two different coordinate systems, and the tree
  // draws at half the size it was grown at.
  for (const v of veins.values()) {
    v.points = v.points.map(xf);
    v.control = xf(v.control);
  }
  for (const [id, points] of capillaries) capillaries.set(id, points.map(xf));
  for (const [id, t] of thick) thick.set(id, t * scale);
  const bole = buildBole(pos, thick, byId, limbHeight);
  const buttresses = buildRoots(pos, bole);
  const memoryByNode = new Map();
  for (const memory of state.memories || []) {
    if (memory.node_id) memoryByNode.set(memory.node_id, memory);
  }

  const realms = buildRealms({
    nodes, byId, children, pos, veins, memoryByNode, maxWeight,
  });

  return {
    pos, dir, thick, path, depthOf, veins, capillaries, realms, roots: buttresses, bole,
    center,
    scale,
    children,
    byId,
    memoryByNode,
    radiusOf: (nodeId) => {
      const node = byId.get(nodeId);
      if (!node) return 1;
      if (node.kind === 'leaf') {
        const memory = memoryByNode.get(nodeId);
        const importance = memory ? memory.importance : 0.4;
        const confidence = memory ? memory.confidence : 0.7;
        return (0.75 + 3.1 * Math.pow(importance, 1.15)) * (0.85 + 0.22 * confidence);
      }
      return thick.get(nodeId) || 1;
    },
    nodeAt: (nodeId) => pos.get(nodeId) || [0, 0, 0],
    /** the chain a signal travels: neuron → bough → … → trunk → … → neuron */
    routeThroughTrunk: (nodeId) => {
      const chain = path.get(nodeId) || [nodeId];
      const out = [];
      for (const id of chain) {
        const v = veins.get(id);
        if (v) out.push([...v.points].reverse());   // inward, toward the trunk
        else out.push([pos.get(id)]);
      }
      return out;
    },
  };
}

/**
 * Each realm becomes a volume with boughs crossing it, and its memories are
 * grown into those boughs. This is the geometry you fly into.
 */
function buildRealms({ nodes, byId, children, pos, memoryByNode, maxWeight }) {
  const realms = new Map();

  for (const domain of nodes) {
    if (domain.kind !== 'domain') continue;
    const tip = pos.get(domain.id);
    const boughs = (children.get(domain.id) || []).filter((n) => n.kind !== 'leaf');
    const boughTips = boughs.map((b) => pos.get(b.id));
    const outward = boughTips.length
      ? norm(mul(add(...boughTips.map((p) => sub(p, tip))), 1 / boughTips.length))
      : UP;

    // every memory that belongs to this realm
    const members = [];
    const walk = (nodeId) => {
      for (const child of children.get(nodeId) || []) {
        if (child.kind === 'leaf') members.push(child.id);
        else walk(child.id);
      }
    };
    walk(domain.id);

    // a world is small against the bough it hangs from. The tree is the
    // subject; the realm is a universe you have to lean in to see.
    const radius = 7 + Math.sqrt(members.length) * 2.5;
    // and it sits out along the branch, at the end of the wood
    const reach = radius * 2.6 + (boughTips.length
      ? Math.max(...boughTips.map((p) => dist(p, tip)))
      : radius * 2);
    const center = add(tip, mul(outward, reach));

    // the woody stem the realm grows on: the branch does not stop at the
    // world, it enters it
    const stemDir = norm(sub(center, tip));
    const stem = [];
    for (let s = 0; s <= 10; s++) {
      const t = s / 10;
      const sag = Math.sin(t * Math.PI) * radius * 0.22;
      const [su, sv] = basis(stemDir);
      const lean = norm(add(mul(su, Math.cos(t * 2.2 + rnd(domain.id, 'sg') * TAU)),
        mul(sv, Math.sin(t * 2.2 + rnd(domain.id, 'sg') * TAU))));
      stem.push(add(add(tip, mul(stemDir, reach * t)), mul(lean, sag)));
    }

    // the boughs that cross the interior, sized against the realm so the
    // interior keeps its proportions at any scale
    const count = clamp(Math.round(members.length / 2.2), 2, 5);
    const structures = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + rnd(domain.id, `sa${i}`) * 0.9;
      const tilt = 0.25 + rnd(domain.id, `st${i}`) * 1.0;
      // Tangential, not radial, and barely inclined. Steeply raked boughs span
      // more than a realm-radius of height along their own length and throw
      // their far end out of frame; radial ones all meet in the middle and
      // become one rosette instead of a canopy.
      const axis = norm([-Math.sin(a) * Math.cos(tilt), Math.sin(tilt) * 0.2, Math.cos(a) * Math.cos(tilt)]);
      const length = radius * (1.0 + rnd(domain.id, `sl${i}`) * 0.5);
      // Staggered around a ring above the country, each at its own height, so
      // the wood reads as branches over a landscape with daylight between them
      // — and so the memories grown into it are spread across the world rather
      // than piled in the middle of it.
      const arch = radius * (0.08 + rnd(domain.id, `sh${i}`) * 0.36);
      const ring = radius * (0.3 + rnd(domain.id, `sr${i}`) * 0.12);
      const mid = [
        center[0] + Math.cos(a) * ring,
        center[1] + arch,
        center[2] + Math.sin(a) * ring,
      ];
      const [bu, bv] = basis(axis);
      // Slim. A bough that crosses a realm is a *branch over a country*, and
      // the country is the subject: at half this width five of them close up
      // into a wall of wood with the world hidden behind it.
      const thick = radius * (0.02 + rnd(domain.id, `sk${i}`) * 0.018);
      const points = [];
      for (let s = 0; s <= 14; s++) {
        const t = s / 14;
        const bow = Math.sin(t * Math.PI) * 1.6;
        const spin = t * 1.4 + rnd(domain.id, `sb${i}`) * TAU;
        const radial = add(mul(bu, Math.cos(spin)), mul(bv, Math.sin(spin)));
        points.push(add(add(mid, mul(axis, (t - 0.5) * length)), mul(radial, bow)));
      }
      structures.push({ id: `${domain.id}_s${i}`, axis, points, thick, from: points[0], to: points[14] });
    }

    // grow each memory into a bough rather than hanging it in the air
    const innerPos = new Map();
    members.forEach((nodeId, index) => {
      const structure = structures[index % structures.length];
      const t = 0.12 + 0.76 * rnd(nodeId, 'it');
      const along = structure.points[Math.round(t * 14)];
      const [iu, iv] = basis(structure.axis);
      const spin = rnd(nodeId, 'ispin') * TAU;
      const outwardVessel = add(mul(iu, Math.cos(spin)), mul(iv, Math.sin(spin)));
      // a cell is *in* the wood, not hovering beside it: the lift is a small
      // multiple of the bough's own radius
      const lift = structure.thick * 0.5 + radius * 0.012 + rnd(nodeId, 'ilift') * radius * 0.03;
      innerPos.set(nodeId, add(add(along, mul(outwardVessel, lift)), mul(structure.axis, (rnd(nodeId, 'ialong') - 0.5) * 2)));
    });

    realms.set(domain.id, {
      id: domain.id,
      name: domain.name,
      hue: domain.hue ?? 44,
      center,
      radius,
      stem,
      structures,
      members,
      innerPos,
      tip,
      // what the realm is *as a place* — its landform, regions, landmarks,
      // routes and weather. See world.js.
      world: buildWorld(domain, radius),
    });
  }

  // memories know the realm they live in
  const realmOfNode = new Map();
  for (const realm of realms.values()) {
    for (const member of realm.members) realmOfNode.set(member, realm.id);
  }

  return { realms, realmOfNode };
}

/** centre and scale the grown tree into a predictable world sphere */
function normalise(pos) {
  const pts = Array.from(pos.values());
  if (!pts.length) return { center: [0, 0, 0], scale: 1, xf: (p) => p };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i];
      if (p[i] > max[i]) max[i] = p[i];
    }
  }
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  // fit the bounding sphere: perspective then behaves the same whether the
  // canopy grew wide or tall
  let radius = 1;
  for (const p of pts) {
    radius = Math.max(radius, Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]));
  }
  const scale = WORLD_RADIUS / radius;
  const xf = (p) => [
    (p[0] - center[0]) * scale,
    (p[1] - center[1]) * scale,
    (p[2] - center[2]) * scale,
  ];
  for (const [id, p] of pos) pos.set(id, xf(p));
  return { center: [0, 0, 0], scale, xf };
}

/**
 * The world a realm is a place in: its ground plane, its air, and the
 * landmarks that make it recognisable. Positions are generated here, in the
 * realm's own space, so the renderer only has to draw them.
 */

/**
 * The bole: the trunk the limbs leave from. Drawn as wood in its own right,
 * wide at the foot and tapering as it climbs, with a slight lean and swell so it
 * does not read as a cylinder. Without this the tree is a burst of limbs
 * meeting at a point.
 */
function buildBole(pos, thick, byId, limbHeight) {
  let base = null;
  let baseId = null;
  for (const [id, node] of byId) {
    if (node.kind === 'root' && pos.has(id)) { base = pos.get(id); baseId = id; break; }
  }
  if (!base) return null;
  const foot = (thick.get(baseId) || WORLD_RADIUS * 0.2) * 0.82;
  const top = foot * 0.3;
  const heights = [...limbHeight.values()];
  const crown = TRUNK * (Math.max(...heights, 0.5) + 0.12);
  const lean = (rnd('bole', 'lean') - 0.5) * WORLD_RADIUS * 0.06;
  const points = [];
  const radii = [];
  const steps = 12;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    // a slight S so the trunk is never a straight tube
    const sway = Math.sin(t * 2.1) * WORLD_RADIUS * 0.012;
    points.push([
      base[0] + lean * t + sway,
      base[1] - 6 + crown * t,
      base[2] + Math.cos(t * 1.7) * WORLD_RADIUS * 0.014,
    ]);
    // flared foot, a slight waist, then a shoulder under the crown
    const flare = 1 + Math.pow(1 - t, 3.2) * 0.5;
    const shoulder = 1 + Math.exp(-Math.pow((t - 0.86) * 7, 2)) * 0.16;
    radii.push((top + (foot - top) * Math.pow(1 - t, 0.72)) * flare * shoulder);
  }
  return { points, radii, hue: 42 };
}

/**
 * Buttress roots: the flared fins that hold a colossal tree up. Each one is a
 * spine that leaves the *bole itself* partway up its flank — so the fin grows
 * out of the wood instead of standing beside it — and heels over into the
 * ground, tapering to a toe. They are wood, not decoration, so they are
 * generated here with the rest of the anatomy and share its space.
 */
function buildRoots(pos, bole) {
  const roots = [];
  if (!bole) return roots;
  const spine = bole.points;
  const radii = bole.radii;
  const steps = 9;
  for (let i = 0; i < ROOT_COUNT; i++) {
    const angle = (i / ROOT_COUNT) * TAU + rnd('buttress', `a${i}`) * 0.42;
    const outward = [Math.cos(angle), 0, Math.sin(angle)];

    // leave the bole a little way up its flank, staggered so they do not all
    // spring from one ring
    const attachAt = Math.min(spine.length - 1,
      Math.round((0.05 + rnd('buttress', `h${i}`) * 0.2) * (spine.length - 1)));
    const attachR = radii[attachAt] * (0.42 + rnd('buttress', `r${i}`) * 0.16);
    const attach = add(spine[attachAt], mul(outward, attachR));
    const reach = WORLD_RADIUS * (0.4 + rnd('buttress', `l${i}`) * 0.3);
    const drop = WORLD_RADIUS * (0.14 + rnd('buttress', `d${i}`) * 0.16);

    const points = [];
    const widths = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // a buttress leaves the trunk almost vertically, then heels over
      const spread = Math.pow(t, 1.45);
      const sway = Math.sin(t * 2.1 + i * 1.7) * WORLD_RADIUS * 0.018;
      points.push([
        attach[0] + outward[0] * reach * spread + Math.cos(angle + 1.57) * sway,
        attach[1] - drop * Math.pow(t, 0.62),
        attach[2] + outward[2] * reach * spread + Math.sin(angle + 1.57) * sway,
      ]);
      // wide where it leaves the wood, thin at the toe
      widths.push(
        attachR * (1.5 - 1.34 * Math.pow(t, 0.62)) * (0.85 + rnd('buttress', `w${i}`) * 0.3)
        + WORLD_RADIUS * 0.006,
      );
    }
    // a couple of rootlets trailing off the toe, so the foot grips something
    const rootlets = [];
    for (let k = 0; k < 2; k++) {
      const from = points[steps];
      const a2 = angle + (rnd('buttress', `t${i}${k}`) - 0.5) * 1.5;
      const len = WORLD_RADIUS * (0.1 + rnd('buttress', `tl${i}${k}`) * 0.16);
      const pts = [];
      for (let s = 0; s <= 5; s++) {
        const t = s / 5;
        pts.push([
          from[0] + Math.cos(a2) * len * t + Math.sin(t * 4 + k) * len * 0.12,
          from[1] - len * 0.22 * t * t,
          from[2] + Math.sin(a2) * len * t + Math.cos(t * 3 + k) * len * 0.12,
        ]);
      }
      rootlets.push({ points: pts, width: attachR * 0.2 });
    }

    roots.push({ id: `buttress_${i}`, points, widths, rootlets, seed: `buttress${i}`, hue: 40 });
  }
  return roots;
}

/** Rodrigues rotation, kept local so the layout has no math dependencies */
function rotateAbout(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(
    add(mul(v, c), mul(cross(axis, v), s)),
    mul(axis, dot(axis, v) * (1 - c)),
  );
}

/**
 * Which nodes are on screen: anything whose ancestors are all open.
 */
export function visibility(state, nodesById) {
  const visible = new Set();
  const blocker = new Map();
  const children = new Map();
  for (const node of state.nodes) {
    if (node.parent_id) {
      if (!children.has(node.parent_id)) children.set(node.parent_id, []);
      children.get(node.parent_id).push(node);
    }
  }
  const walk = (node, openAncestors, firstBlocker) => {
    if (firstBlocker) blocker.set(node.id, firstBlocker);
    const isOpen = !node.collapsed;
    if (openAncestors) visible.add(node.id);
    const nextBlocker = firstBlocker || (node.collapsed ? node.id : null);
    for (const child of children.get(node.id) || []) {
      walk(child, openAncestors && isOpen, nextBlocker);
    }
  };
  for (const node of state.nodes) {
    if (!node.parent_id || !nodesById.has(node.parent_id)) walk(node, true, null);
  }
  return { visible, blocker, children };
}

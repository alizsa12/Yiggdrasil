// Yggdrasil · the places
//
// layout.js grows the tree. This grows the *worlds* that hang from it.
//
// A realm is not a handful of landmarks scattered on a disc. It is a place:
//
//     world → regions → landmarks → local environment → detail
//
// The landform comes from the realm's own theme, so the nine are not nine tints
// of one room: Ásgarðr is a citadel stepping down in terraces from a high
// hall, Mímameðr is a sunken well the terraces climb *away* from, Vánheimr is
// water with islands in it, Jötunheimr is a plain torn open by rifts,
// Auðrblástr has no ground at all — only cloud shelves hanging in air.
//
// Everything is deterministic from the realm's id, so a world you have walked
// is the same world tomorrow. Nothing here is random at draw time, and nothing
// is generated until it is needed: `instances()` is the lazy boundary the
// renderer calls when a region is close enough to be worth filling in.

import { TAU, clamp, lerp, rnd } from './util.js';

/** hard ceiling on instanced detail per world, so detail can never run away */
const MAX_INSTANCES = 460;

/** LOD tiers, coarse to fine. Kept tiny on purpose: this is a 2D canvas. */
export const TIERS = { FAR: 0, MID: 1, NEAR: 2 };

/**
 * Which tier a realm is being looked at from. `enterRealm` parks the camera at
 * 2.15× the realm's radius, so arriving is always the fine tier — the detail is
 * what you came for, and you only lose it by deliberately backing away.
 */
export function tierFor(engine, realm) {
  if (!realm) return TIERS.FAR;
  const ratio = engine.cur.dist / Math.max(1, realm.radius);
  if (ratio > 5.0) return TIERS.FAR;
  if (ratio > 3.1) return TIERS.MID;
  return TIERS.NEAR;
}

// ─────────────────────────────────────────────────────── deterministic noise

/**
 * Smooth value noise. Terrain that reads as terrain needs relief that is
 * continuous across cell boundaries, so the heightfield is interpolated rather
 * than per-cell random.
 */
function vnoise(x, z, salt) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = rnd(salt, `${xi}|${zi}`);
  const b = rnd(salt, `${xi + 1}|${zi}`);
  const c = rnd(salt, `${xi}|${zi + 1}`);
  const d = rnd(salt, `${xi + 1}|${zi + 1}`);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** a few octaves of it, centred on zero so regions sit at their nominal height */
function relief(x, z, salt, freq) {
  let sum = 0;
  let amp = 0.6;
  let f = freq;
  for (let i = 0; i < 3; i++) {
    sum += amp * vnoise(x * f, z * f, `${salt}~${i}`);
    f *= 2.11;
    amp *= 0.44;
  }
  return (sum / 1.05 - 0.5) * 2;
}

// ───────────────────────────────────────────────────── the nine places, as places

/**
 * What each realm actually *is*. Nine realms from Grímnismál are not nine tints
 * of the same room, so this is more than a colour: each carries its own
 * landform, its own light, its own architecture, its own weather, and its own
 * scale. Change a value here and that realm becomes a different place while the
 * other eight stay exactly as they were.
 *
 *   terrain     which landform recipe grows it
 *   relief      how rough that ground is
 *   scale       how monumental its architecture is, against the realm's radius
 *   palette     low / mid / high / dark / water / accent, as [h, s, l]
 *   sun         where the light comes from, for shading the terrain
 *   regions     what the sub-regions are called
 *   layers      the air: what is in it and how it behaves. `y` is a height in
 *               realm radii above the *floor* — a layer at 1.0 is level with
 *               the middle of the volume, and anything much above that is
 *               beside the camera rather than in the world.
 *   scatter     instanced detail, generated lazily and only when close
 */
const WORLDS = {
  // the citadel of the Aesir: ordered, gilded, monumental. Terraces step down
  // from a high hall to a wide outer ward, and light comes down with them.
  asgard: {
    ground: 'marble', groundHue: 46, groundLight: 30,
    sky: [48, 22, 8], haze: [46, 72, 0.05], motes: 'dust',
    terrain: 'terrace', sides: 4, relief: 0.34, scale: 1.3,
    palette: { low: [44, 22, 11], mid: [44, 16, 27], high: [48, 26, 45], dark: [26, 22, 5], water: null, accent: [50, 86, 70] },
    sun: [0.42, 0.78, 0.46],
    regions: ['Hall Rise', 'Midstair', 'The Gold Ring', 'Outer Ward', 'Bifrost Verge'],
    architecture: ['hall', 'colonnade', 'rampart', 'terrace', 'stair', 'cairn', 'pillar'],
    central: 'hall',
    layers: [
      { kind: 'ray', y: 0.92, alpha: 0.07, pass: 'front' },
      { kind: 'cloud', y: 0.62, alpha: 0.07, speed: 0.06, pass: 'back' },
    ],
    scatter: [
      { kind: 'pillar', per: 0.25, h: [0.035, 0.062] },
      { kind: 'banner', per: 0.08, h: [0.045, 0.068], w: 0.5 },
      { kind: 'cairn', per: 0.05, h: [0.02, 0.035] },
    ],
  },

  // the green, gentle land of the Vanir: water, growth, soft light. There is no
  // single ground here — there is a sea, and land in it.
  vanheim: {
    ground: 'water', groundHue: 88, groundLight: 22,
    sky: [96, 30, 10], haze: [92, 55, 0.07], motes: 'pollen',
    terrain: 'archipelago', sides: 6, relief: 0.5, scale: 0.95, waves: 1.5,
    palette: { low: [84, 26, 8], mid: [90, 30, 17], high: [100, 34, 34], dark: [70, 30, 4], water: [96, 46, 24], accent: [78, 52, 40] },
    sun: [-0.5, 0.7, 0.5],
    regions: ['Sweet Water', 'Willow Reach', 'Reed Beds', 'Meadow Holm', 'Deep Channel', 'Green Shallows'],
    architecture: ['islet', 'grove', 'willow', 'reed', 'stair', 'cairn', 'bridge'],
    central: 'islet',
    layers: [
      { kind: 'mist', y: 0.07, alpha: 0.12, speed: 0.05, pass: 'front' },
      { kind: 'pollen', y: 0.3, alpha: 0.5, speed: 0.1, pass: 'front' },
    ],
    scatter: [
      { kind: 'reed', per: 0.425, h: [0.02, 0.045], w: 0.2 },
      { kind: 'willow', per: 0.1, h: [0.032, 0.05], w: 0.7 },
      { kind: 'cairn', per: 0.035, h: [0.015, 0.03] },
    ],
  },

  // the land of the giants: basalt, scale, embers, weather. A plain torn open —
  // mesas stand where they always stood and the rifts are new.
  jotun: {
    ground: 'basalt', groundHue: 26, groundLight: 14,
    sky: [22, 30, 6], haze: [20, 60, 0.08], motes: 'ember',
    terrain: 'fracture', sides: 5, relief: 0.9, scale: 1.5,
    palette: { low: [24, 24, 6], mid: [26, 20, 13], high: [30, 18, 26], dark: [16, 24, 3], water: null, accent: [22, 88, 48] },
    sun: [0.6, 0.55, -0.58],
    regions: ['Crag Waste', 'Ember Rift', 'Forge-Foot Mesa', 'The Long Fissure', 'Thunder Shelf', 'Stonefall'],
    architecture: ['monolith', 'crag', 'bridge', 'shard', 'cairn', 'fissure', 'moraine'],
    central: 'monolith',
    layers: [
      { kind: 'ember', y: 0.16, alpha: 0.5, speed: 0.5, pass: 'front' },
      { kind: 'storm', y: 0.55, alpha: 0.1, speed: 0.34, pass: 'back' },
    ],
    scatter: [
      { kind: 'crag', per: 0.14, h: [0.03, 0.07] },
      { kind: 'shard', per: 0.325, h: [0.018, 0.045], w: 0.3 },
    ],
  },

  // the well of wisdom: still, deep, echoing. The terraces climb *away* from
  // the centre here, and the centre is a hole you can see down.
  mimame: {
    ground: 'water', groundHue: 40, groundLight: 18,
    sky: [200, 26, 6], haze: [196, 48, 0.09], motes: 'dust',
    terrain: 'bowl', sides: 4, relief: 0.28, scale: 1.0, waves: 0.45,
    palette: { low: [196, 22, 7], mid: [200, 18, 15], high: [42, 34, 40], dark: [200, 30, 3], water: [192, 34, 22], accent: [196, 62, 66] },
    sun: [0.1, 0.92, 0.38],
    regions: ['Wells Rim', 'Second Ring', 'Water Stair', 'Mímir\'s Stone', 'Deep Mouth'],
    architecture: ['well', 'stair', 'arch', 'cairn', 'pillar', 'barrage', 'rune'],
    central: 'well',
    layers: [
      { kind: 'ray', y: 0.8, alpha: 0.09, pass: 'front' },
      { kind: 'mist', y: 0.05, alpha: 0.15, speed: 0.03, pass: 'front' },
    ],
    scatter: [
      { kind: 'stair', per: 0.045, h: [0.012, 0.028] },
      { kind: 'rune', per: 0.07, h: [0.03, 0.05], w: 0.7 },
      { kind: 'cairn', per: 0.09, h: [0.02, 0.032] },
    ],
  },

  // the cold road: ice, bare rock, no shelter. Almost flat — which is what
  // makes the moraine and the obelisk read as the only things to aim at.
  hel: {
    ground: 'ice', groundHue: 196, groundLight: 42,
    sky: [204, 34, 12], haze: [202, 60, 0.06], motes: 'frost',
    terrain: 'plain', sides: 5, relief: 0.55, scale: 1.15,
    palette: { low: [200, 26, 22], mid: [198, 30, 34], high: [196, 40, 58], dark: [204, 34, 10], water: [198, 44, 40], accent: [188, 52, 62] },
    sun: [-0.34, 0.52, 0.78],
    regions: ['Járnviðr Ice', 'Moraine', 'Frost Hollow', 'Snow Shelf', 'Frozen Ford', 'The Cold Road'],
    architecture: ['obelisk', 'shard', 'cairn', 'glacier', 'moraine', 'monolith', 'arch'],
    central: 'obelisk',
    layers: [
      { kind: 'frost', y: 0.26, alpha: 0.5, speed: 0.18, pass: 'front' },
      { kind: 'mist', y: 0.06, alpha: 0.1, speed: 0.04, pass: 'front' },
    ],
    scatter: [
      { kind: 'shard', per: 0.3, h: [0.016, 0.042], w: 0.3 },
      { kind: 'cairn', per: 0.05, h: [0.018, 0.03] },
    ],
  },

  // the dark elves: under the mountain, metal, forges, no sky. The same broken
  // country as the giants, but roofed, and the rifts are full of metal.
  svartalf: {
    ground: 'basalt', groundHue: 32, groundLight: 11,
    sky: [30, 18, 4], haze: [28, 55, 0.11], motes: 'ember',
    terrain: 'fracture', sides: 5, relief: 0.72, scale: 1.2,
    palette: { low: [30, 26, 4], mid: [32, 22, 10], high: [36, 24, 22], dark: [26, 30, 2], water: [26, 88, 40], accent: [40, 92, 58] },
    sun: [0.3, 0.86, -0.4],
    roof: 0.95,
    regions: ['Forge Hall', 'Ore Vein', 'Deep Mine', 'Quarry Floor', 'The Slag Heap', 'Anvil Row'],
    architecture: ['forge', 'pillar', 'vein', 'shaft', 'crag', 'arch', 'fissure', 'lattice'],
    central: 'forge',
    layers: [
      { kind: 'ember', y: 0.12, alpha: 0.62, speed: 0.42, pass: 'front' },
      { kind: 'glow', y: 0.08, alpha: 0.14, speed: 0.16, pass: 'back' },
    ],
    scatter: [
      { kind: 'pillar', per: 0.225, h: [0.036, 0.062] },
      { kind: 'vein', per: 0.13, h: [0.012, 0.024], w: 1.4 },
      { kind: 'crag', per: 0.09, h: [0.022, 0.05] },
    ],
  },

  // the wide wind: open air, cloud, nothing to stand on but towers. There is no
  // ground surface at all here — there are shelves, and air between them.
  audr: {
    ground: 'cloud', groundHue: 44, groundLight: 34,
    sky: [40, 20, 12], haze: [42, 40, 0.13], motes: 'pollen',
    terrain: 'drift', sides: 5, relief: 0.4, scale: 1.35,
    palette: { low: [40, 22, 12], mid: [42, 24, 24], high: [46, 30, 42], dark: [30, 20, 6], water: null, accent: [44, 70, 66] },
    sun: [0.7, 0.62, 0.34],
    regions: ['Windward Shelf', 'Cloud Terrace', 'Updraft Shelf', 'Far Drift', 'The Turning Tower'],
    architecture: ['tower', 'vane', 'cloudbank', 'bridge', 'arch', 'shelf', 'lattice'],
    central: 'tower',
    layers: [
      { kind: 'cloud', y: 0.2, alpha: 0.15, speed: 0.5, pass: 'back' },
      { kind: 'ray', y: 0.85, alpha: 0.08, pass: 'front' },
    ],
    scatter: [
      { kind: 'vane', per: 0.05, h: [0.045, 0.07] },
      { kind: 'cloudbank', per: 0.05, h: [0.035, 0.065], w: 2.4 },
    ],
  },

  // mist and temperament: formless, cold, nothing resolved. The flattest ground
  // in the tree and the most cairns — which is the point of the place.
  nifl: {
    ground: 'mist', groundHue: 210, groundLight: 24,
    sky: [212, 16, 5], haze: [214, 30, 0.16], motes: 'frost',
    terrain: 'plain', sides: 6, relief: 0.18, scale: 0.85,
    palette: { low: [212, 14, 10], mid: [212, 12, 18], high: [214, 16, 30], dark: [212, 20, 4], water: null, accent: [210, 26, 52] },
    sun: [0.2, 0.86, -0.46],
    regions: ['Formless Field', 'Fog Bank', 'Cold Hollow', 'Grey Verge', 'The Unnamed', 'Last Cairn'],
    architecture: ['cairn', 'veil', 'monolith', 'cairn', 'arch', 'moraine', 'rune'],
    central: 'cairn',
    layers: [
      { kind: 'mist', y: 0.1, alpha: 0.22, speed: 0.04, pass: 'front' },
      { kind: 'veil', y: 0.5, alpha: 0.08, speed: 0.07, pass: 'back' },
      { kind: 'frost', y: 0.24, alpha: 0.34, speed: 0.1, pass: 'front' },
    ],
    scatter: [
      { kind: 'cairn', per: 0.16, h: [0.024, 0.042] },
      { kind: 'veil', per: 0.05, h: [0.028, 0.045], w: 1.6 },
    ],
  },

  // the yawning gap: the abyss before creation, lit by two opposed rivers.
  // No ground. Stone hangs in the dark and the rivers run out of the wound.
  ginnung: {
    ground: 'void', groundHue: 268, groundLight: 8,
    sky: [266, 30, 4], haze: [264, 62, 0.07], motes: 'star',
    terrain: 'abyss', sides: 4, relief: 0.6, scale: 1.45,
    palette: { low: [266, 26, 5], mid: [266, 22, 11], high: [270, 30, 24], dark: [260, 30, 2], water: null, accent: [48, 92, 78] },
    sun: [0.5, 0.4, -0.76],
    regions: ['The Yawn', 'Bright Shore', 'Dark Shore', 'Suspended Stone', 'Before Light'],
    architecture: ['rift', 'river', 'shard', 'strata', 'lattice', 'monolith', 'cairn'],
    central: 'rift',
    layers: [
      { kind: 'star', y: 0.42, alpha: 0.5, speed: 0.02, pass: 'back' },
      { kind: 'veil', y: 0.3, alpha: 0.1, speed: 0.05, pass: 'back' },
      { kind: 'ember', y: 0.12, alpha: 0.34, speed: 0.22, pass: 'front' },
    ],
    scatter: [
      { kind: 'shard', per: 0.175, h: [0.02, 0.05], w: 0.3 },
      { kind: 'cairn', per: 0.04, h: [0.012, 0.024] },
    ],
  },
};

// ───────────────────────────────────────────────────────────── landform recipes

const region = (props) => ({
  type: 'disc', r: 0, r0: 0, r1: 0, x: 0, z: 0, y: 0,
  solid: true, water: false, flat: false, relief: 1, ...props,
});

const inside = (rg, x, z) => {
  const dx = x - rg.x;
  const dz = z - rg.z;
  const d2 = dx * dx + dz * dz;
  if (rg.type === 'ring') return d2 >= rg.r0 * rg.r0 && d2 < rg.r1 * rg.r1;
  return d2 < rg.r * rg.r;
};

/**
 * Each recipe answers one question: what is the shape of this place?
 * They share the region model — a disc or an annulus, a base height, and how
 * much the ground moves inside it — so the renderer does not care which one a
 * realm chose. That is what keeps nine different places from becoming nine
 * different renderers.
 */
const RECIPES = {
  /** Ásgarðr: concentric terraces stepping *down* from a high central hall. */
  terrace({ R }) {
    const bands = [0.30, 0.50, 0.68, 0.83, 0.99];
    const drop = [0.135, 0.088, 0.05, 0.02, 0];
    const regions = [];
    regions.push(region({ id: 'r0', x: 0, z: 0, r: R * bands[0], y: R * drop[0], flat: true, relief: 0.4 }));
    for (let i = 1; i < bands.length; i++) {
      regions.push(region({
        id: `r${i}`,
        type: 'ring',
        r0: R * bands[i - 1],
        r1: R * bands[i],
        y: R * drop[i],
        flat: i < 3,
        relief: 0.7 + i * 0.2,
      }));
    }
    return regions;
  },

  /** Mímameðr: the same stepping, but a well, so the steps climb away. */
  bowl({ R, theme }) {
    const bands = [0.13, 0.30, 0.50, 0.70, 0.88, 1.0];
    const rise = [-0.10, -0.045, 0.005, 0.05, 0.09, 0.13];
    const regions = [];
    // the mouth of the well is not ground at all — a hole the terrain skips
    regions.push(region({ id: 'mouth', r: R * bands[0], solid: false, y: -R * 0.2, name: 'The Mouth' }));
    regions.push(region({ id: 'water', r: R * bands[0] * 0.92, y: -R * 0.17, water: true, flat: true, name: 'Deep Mouth' }));
    for (let i = 1; i < bands.length; i++) {
      regions.push(region({
        id: `r${i}`,
        type: 'ring',
        r0: R * bands[i - 1],
        r1: R * bands[i],
        y: R * rise[i],
        flat: i < 4,
        relief: 0.6 + i * 0.15,
      }));
    }
    void theme;
    return regions;
  },

  /** Vánheimr: a sea with land in it. Water is flat; what rises above it wins. */
  archipelago({ R, salt, side }) {
    const regions = [region({
      id: 'sea', r: R * 1.02, y: 0, water: true, flat: true, relief: 0,
    })];
    regions.push(region({ id: 'r0', r: R * 0.33, y: R * 0.075, relief: 0.7 }));
    const n = Math.max(3, side);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(salt, `isl${i}`) * 0.8;
      const d = R * (0.48 + rnd(salt, `isld${i}`) * 0.34);
      regions.push(region({
        id: `isl${i}`,
        x: Math.cos(a) * d,
        z: Math.sin(a) * d,
        r: R * (0.1 + rnd(salt, `islr${i}`) * 0.12),
        y: R * (0.03 + rnd(salt, `isly${i}`) * 0.05),
        relief: 1.1,
      }));
    }
    return regions;
  },

  /** Jötunheimr & Svartálfaheimr: a broken plain, mesas over rifts. */
  fracture({ R, salt, side }) {
    const regions = [region({ id: 'plain', r: R * 1.0, y: 0, relief: 1.15 })];
    const n = Math.max(3, side);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(salt, `msa${i}`) * 1.1;
      const d = R * (0.2 + rnd(salt, `msd${i}`) * 0.5);
      regions.push(region({
        id: `mesa${i}`,
        x: Math.cos(a) * d,
        z: Math.sin(a) * d,
        r: R * (0.15 + rnd(salt, `msr${i}`) * 0.15),
        y: R * (0.07 + rnd(salt, `msy${i}`) * 0.07),
        relief: 0.3,
      }));
    }
    // the far side is a different country: a scarp the plain breaks off at
    regions.push(region({ id: 'scarp', type: 'ring', r0: R * 0.82, r1: R * 1.0, y: R * 0.045, relief: 0.6 }));
    return regions;
  },

  /**
   * Helheimr & Niflheimr: a wide, near-level plain. Flat is the point — but
   * "flat" must not mean "empty". The named districts sit at almost the same
   * height as each other, so the ground still reads as one vast surface while
   * still being somewhere with parts.
   */
  plain({ R, salt, side }) {
    const regions = [region({ id: 'plain', r: R * 1.0, y: 0, relief: 1.0 })];
    const n = Math.max(3, side - 1);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(salt, `dra${i}`) * 0.9;
      const d = R * (0.22 + rnd(salt, `drd${i}`) * 0.44);
      regions.push(region({
        id: `district${i}`,
        x: Math.cos(a) * d,
        z: Math.sin(a) * d,
        r: R * (0.18 + rnd(salt, `drr${i}`) * 0.16),
        y: R * (rnd(salt, `dry${i}`) * 0.022 - 0.008),
        relief: 0.8,
      }));
    }
    regions.push(region({ id: 'shelf', type: 'ring', r0: R * 0.74, r1: R * 1.0, y: R * 0.016, relief: 0.5 }));
    return regions;
  },

  /** Auðrblástr: no surface. Only shelves, hanging, with air between them. */
  drift({ R, salt, side }) {
    const regions = [region({ id: 'anchor', r: R * 0.27, y: R * 0.04, relief: 0.5 })];
    const n = Math.max(4, side);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(salt, `sha${i}`) * 0.9;
      const d = R * (0.3 + rnd(salt, `shd${i}`) * 0.44);
      regions.push(region({
        id: `shelf${i}`,
        x: Math.cos(a) * d,
        z: Math.sin(a) * d,
        r: R * (0.19 + rnd(salt, `shr${i}`) * 0.14),
        y: R * ((rnd(salt, `shy${i}`) - 0.45) * 0.62),
        relief: 0.35,
      }));
    }
    return regions;
  },

  /** Ginnungagap: one wound of stone, and fragments that never fell. */
  abyss({ R, salt, side }) {
    const regions = [region({ id: 'wound', r: R * 0.3, y: -R * 0.12, relief: 0.55 })];
    const n = Math.max(3, side);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(salt, `fra${i}`) * 1.0;
      const d = R * (0.42 + rnd(salt, `frd${i}`) * 0.4);
      regions.push(region({
        id: `frag${i}`,
        x: Math.cos(a) * d,
        z: Math.sin(a) * d,
        r: R * (0.11 + rnd(salt, `frr${i}`) * 0.11),
        y: R * ((rnd(salt, `fry${i}`) - 0.5) * 0.9),
        relief: 0.8,
      }));
    }
    return regions;
  },
};

/**
 * Long linear features cut *into* the regions above: a rift, a moraine, a
 * channel of metal. They are cheap (a distance to a segment) and they are what
 * turns a bumpy plain into a place with a shape you can name.
 */
function buildCarves(key, terrain, R, theme) {
  const carves = [];
  const specs = {
    fracture: (i, salt) => {
      const a = (i / 3) * TAU + rnd(salt, `ra${i}`) * 0.7;
      const d = R * (0.1 + rnd(salt, `rd${i}`) * 0.3);
      return {
        ax: Math.cos(a) * d, az: Math.sin(a) * d,
        bx: Math.cos(a + 1.9) * R * 1.1, bz: Math.sin(a + 1.9) * R * 1.1,
        w: R * (0.07 + rnd(salt, `rw${i}`) * 0.07),
        depth: -R * (0.05 + rnd(salt, `rk${i}`) * 0.05),
      };
    },
    plain: (i, salt) => {
      const a = rnd(salt, `pa${i}`) * TAU;
      return {
        ax: Math.cos(a) * R * 0.9, az: Math.sin(a) * R * 0.9,
        bx: Math.cos(a + 0.7) * R * 0.9, bz: Math.sin(a + 0.7) * R * 0.9,
        w: R * (0.14 + rnd(salt, `pw${i}`) * 0.12),
        depth: R * (0.02 + rnd(salt, `pk${i}`) * 0.03),
      };
    },
  };
  const make = specs[terrain];
  if (!make) return carves;
  const count = terrain === 'fracture' ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const spec = make(i, key);
    spec.glow = !!theme.glowCarve;
    carves.push(spec);
  }
  return carves;
}

// ─────────────────────────────────────────────────────── terrain as a queryable

/**
 * The ground under a point, or null where there is none. `null` is a real
 * answer and it matters: it is what makes Ginnungagap a void and Auðrblástr a
 * set of islands in air, and it is why the terrain renderer leaves the dark
 * showing through instead of painting a floor that should not be there.
 */
export function groundAt(world, x, z) {
  let bestY = -Infinity;
  let best = null;
  for (const rg of world.regions) {
    if (!rg.solid || !inside(rg, x, z)) continue;
    const y = rg.flat
      ? rg.y
      : rg.y + world.relief * rg.relief * relief(x / world.radius, z / world.radius, world.salt + rg.id, world.freq);
    if (y > bestY) { bestY = y; best = rg; }
  }
  if (!best) return null;
  let y = bestY;
  for (const c of world.carves) {
    y += c.depth * Math.exp(-Math.pow(segDist(x, z, c) / c.w, 2));
  }
  return { y, region: best };
}

/** ground height, or the realm's void level where there is no ground */
export function heightAt(world, x, z) {
  const g = groundAt(world, x, z);
  return g ? g.y : world.voidY;
}

/** which sub-region governs a point — drives terrain colour and detail rules */
export function biomeAt(world, x, z) {
  const g = groundAt(world, x, z);
  return g ? g.region : null;
}

function segDist(x, z, c) {
  const vx = c.bx - c.ax;
  const vz = c.bz - c.az;
  const wx = x - c.ax;
  const wz = z - c.az;
  const len2 = vx * vx + vz * vz || 1;
  const t = clamp((wx * vx + wz * vz) / len2, 0, 1);
  return Math.hypot(wx - vx * t, wz - vz * t);
}

// ──────────────────────────────────────────────────────────── landmarks & roads

function landmarkId(key, tag) { return `${key}~${tag}`; }

/**
 * Landmarks: what a realm is *for*. Every realm gets exactly one that is
 * bigger and more central than the rest, and that is the one the world is
 * named for. The rest are distributed across sub-regions so that every region
 * has somewhere to walk to, and so the shape of the built world follows the
 * shape of the land.
 */
function buildLandmarks({ world, salt }) {
  const { theme, regions } = world;
  const R = world.radius;
  const landmarks = [];
  const kinds = theme.architecture;

  // the heart: the highest, most central piece of ground there is
  let heart = regions[0];
  let heartScore = -Infinity;
  for (const rg of regions) {
    if (!rg.solid) continue;
    const d = Math.hypot(rg.x, rg.z) / R;
    const score = (rg.y / R) * 2.2 + (rg.r / R) * 0.8 - d * 1.1;
    if (score > heartScore) { heartScore = score; heart = rg; }
  }

  const place = (kind, region, tag, opts = {}) => {
    const a = rnd(salt, `${tag}a`) * TAU;
    // a ring is an annulus, so its landmarks have to land *inside* the band —
    // scattering them from the centre would drop half of them off the inside
    const d = region.type === 'ring'
      ? lerp(region.r0, region.r1 * 0.96, Math.sqrt(rnd(salt, `${tag}d`)))
      : Math.sqrt(rnd(salt, `${tag}d`)) * region.r * 0.8;
    const x = clamp(region.x + Math.cos(a) * d, -R * 0.98, R * 0.98);
    const z = clamp(region.z + Math.sin(a) * d, -R * 0.98, R * 0.98);
    const g = groundAt(world, x, z);
    landmarks.push({
      id: landmarkId(world.key, tag),
      kind,
      name: region.name,
      // Regions overlap — an islet sits in the sea, a district sits in a plain
      // — so the region a landmark *belongs* to is the one actually under it,
      // not the one whose bounds we sampled from.
      region: g ? g.region.id : region.id,
      x,
      z,
      y: g ? g.y : region.y,
      h: R * (0.055 + rnd(salt, `${tag}h`) * 0.05) * theme.scale * (opts.central ? 2.5 : 1),
      w: R * (0.018 + rnd(salt, `${tag}w`) * 0.016) * theme.scale * (opts.central ? 2.2 : 1),
      spin: rnd(salt, `${tag}s`) * TAU,
      central: !!opts.central,
    });
  };

  place(theme.central, heart, 'heart', { central: true });

  let n = 0;
  for (const rg of regions) {
    if (!rg.solid || rg === heart) continue;
    // a wide band deserves two destinations, a small islet only one
    const span = rg.type === 'ring' ? rg.r1 - rg.r0 : rg.r;
    for (let i = 0; i < (span / R > 0.4 ? 2 : 1); i++) {
      const kind = kinds[Math.floor(rnd(salt, `lk${n}`) * kinds.length) % kinds.length];
      place(kind, rg, `lm${n}`);
      n++;
    }
  }
  return { landmarks, heart };
}

/**
 * Routes between landmarks, following the ground rather than flying over it.
 * These are the world's graph: an agent that can walk a polyline can already
 * travel these realms, and `navRoute` below is the whole of the query surface
 * such an agent would need. No agent is implemented here — only the structure
 * one would need, so navigation can be added without re-deriving the world.
 */
function buildRoutes({ key, world, landmarks, heart, R }) {
  const paths = [];
  const nav = new Map();
  const link = (a, b) => {
    if (!nav.has(a.id)) nav.set(a.id, new Set());
    if (!nav.has(b.id)) nav.set(b.id, new Set());
    nav.get(a.id).add(b.id);
    nav.get(b.id).add(a.id);
  };

  const route = (a, b, tag, kind) => {
    const steps = 9;
    const points = [];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    // bend the line so two paths never run dead straight through a realm
    const bow = (rnd(key, `${tag}b`) - 0.5) * len * 0.34;
    const lift = R * 0.014;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bend = bow * Math.sin(t * Math.PI);
      // stay inside the realm: a road that wanders off the edge of the world
      // is a road that ends in nothing
      let x = a.x + dx * t - (dz / len) * bend;
      let z = a.z + dz * t + (dx / len) * bend;
      const d = Math.hypot(x, z);
      if (d > R * 0.94) { x *= (R * 0.94) / d; z *= (R * 0.94) / d; }
      // follow the ground, but never below the straight line between the two
      // destinations. A road bridges a rift and spans a gap; it does not fall
      // into one. `heightAt` returns the void level where there is no ground,
      // so taking the max is what turns a gap into a span.
      const y = Math.max(heightAt(world, x, z), lerp(a.y, b.y, t));
      points.push([x, y + lift, z]);
    }
    paths.push({ id: `${key}~r${paths.length}`, kind, points, a: a.id, b: b.id });
    link(a, b);
  };

  for (const lm of landmarks) {
    if (lm === heart) continue;
    route(heart, lm, lm.id, world.terrain === 'drift' || world.terrain === 'abyss' ? 'span' : 'road');
  }
  // a circuit through the outer landmarks, so the realm is a place you loop
  const outer = landmarks.filter((lm) => !lm.central);
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    if (a === b) continue;
    route(a, b, `${a.id}>${b.id}`, 'road');
  }
  return { paths, nav };
}

/** the walkable path between two landmarks, or null if the graph does not join */
export function navRoute(world, fromId, toId) {
  if (fromId === toId) return [fromId];
  const seen = new Set([fromId]);
  const queue = [[fromId]];
  while (queue.length) {
    const chain = queue.shift();
    const tail = chain[chain.length - 1];
    for (const next of world.nav.get(tail) || []) {
      if (seen.has(next)) continue;
      const extended = [...chain, next];
      if (next === toId) return extended;
      seen.add(next);
      queue.push(extended);
    }
  }
  return null;
}

/** the landmark an agent standing here would head for */
export function nearestLandmark(world, point) {
  let best = null;
  let bestD = Infinity;
  for (const lm of world.landmarks) {
    const d = Math.hypot(lm.x - point[0], lm.z - point[2]);
    if (d < bestD) { bestD = d; best = lm; }
  }
  return best;
}

/** every walkable point, for an agent that wants the whole floor at once */
export function walkable(world) {
  const out = [];
  for (const rg of world.regions) {
    if (!rg.solid) continue;
    out.push({
      id: rg.id,
      x: rg.x,
      z: rg.z,
      r: rg.r,
      y: rg.y,
      water: !!rg.water,
      // rings are reachable only across the bands around them; a disc is solid
      // ground, and that is where an agent can stand
      traversable: rg.type === 'disc' && !rg.water,
    });
  }
  return out;
}

// ────────────────────────────────────────────── lazy instanced detail (LOD 2)

const instanceCache = new Map();

/**
 * The small stuff: reeds, shards, cairns, colonnade stones. Generated on
 * demand, cached per tier, and never for a realm you are not standing in. This
 * is the only unbounded-looking part of the world, so it is capped twice — once
 * by a ceiling and once by refusing to generate at all until you are close.
 */
export function instances(world, tier) {
  if (tier !== TIERS.NEAR) return [];
  const cacheKey = `${world.key}#${tier}`;
  const hit = instanceCache.get(cacheKey);
  if (hit) return hit;

  const out = [];
  for (const rule of world.scatter) {
    for (const rg of world.regions) {
      if (!rg.solid || rg.water) continue;
      // a ring's area is its band, not its (absent) radius — get this wrong and
      // every terraced world grows no detail at all
      const area = rg.type === 'ring'
        ? Math.PI * (rg.r1 * rg.r1 - rg.r0 * rg.r0)
        : Math.PI * rg.r * rg.r;
      let n = Math.round(area * rule.per);
      n = Math.min(n, 64);
      for (let i = 0; i < n && out.length < MAX_INSTANCES; i++) {
        const tag = `${rule.kind}${rg.id}${i}`;
        const a = rnd(world.salt, `${tag}a`) * TAU;
        // sample uniformly across the area: sqrt for a disc, and across the
        // squared radii for an annulus
        const d = rg.type === 'ring'
          ? Math.sqrt(lerp(rg.r0 * rg.r0, rg.r1 * rg.r1, rnd(world.salt, `${tag}d`)))
          : Math.sqrt(rnd(world.salt, `${tag}d`)) * rg.r * 0.94;
        const x = rg.x + Math.cos(a) * d;
        const z = rg.z + Math.sin(a) * d;
        const g = groundAt(world, x, z);
        if (!g || g.region !== rg) continue;
        const h = lerp(rule.h[0], rule.h[1], rnd(world.salt, `${tag}h`)) * world.radius;
        out.push({
          kind: rule.kind,
          x, y: g.y, z,
          h,
          w: h * (rule.w ?? 0.42),
          spin: rnd(world.salt, `${tag}s`) * TAU,
          region: rg.id,
        });
      }
    }
  }
  instanceCache.set(cacheKey, out);
  return out;
}

// ───────────────────────────────────────────────────────────────────── build

/**
 * The world a realm is a place in, built once per layout pass.
 *
 * Realm-local coordinates: `x`/`z` span the realm's radius, `y` is height off
 * the floor. The renderer adds the realm's centre and floor offset; keeping the
 * world in its own space is what lets a realm be generated at any size and
 * still keep its proportions.
 */
export function buildWorld(domain, radius) {
  const key = String(domain?.id || '').replace(/^nd_/, '') || 'asgard';
  const theme = WORLDS[key] || WORLDS.asgard;
  const salt = `w:${domain?.id || key}`;

  const world = {
    key,
    theme,
    name: theme.name,
    radius,
    // The floor sits below the middle of the volume, but not a whole radius
    // below it: a realm that arrives with its land off the bottom of the frame
    // is a realm you are looking at the underside of.
    floor: radius * 0.56,
    voidY: -radius * 0.9,
    // kept for the far LOD, which still draws the plain ground disc
    ground: theme.ground,
    groundHue: theme.groundHue,
    groundLight: theme.groundLight,
    sky: theme.sky,
    haze: theme.haze,
    motes: theme.motes,
    palette: theme.palette,
    sun: theme.sun,
    layers: theme.layers || [],
    scatter: theme.scatter || [],
    relief: theme.relief,
    scale: theme.scale,
    roof: theme.roof || 0,
    // how finely the water is rippled: a realm with still water (Mímameðr) sets
    // this low, a realm with weather on it (Vánheimr) sets it high
    waves: theme.waves ?? 1,
    // How finely the ground undulates. Low frequency gives broad soft lumps
    // that read as blotches of light rather than as a surface; a little higher
    // and the same shading starts to look like country.
    freq: 2.9,
    salt,
    terrain: theme.terrain,
    side: theme.sides || 4,
  };

  const regions = RECIPES[theme.terrain]({ R: radius, theme, salt, side: world.side });
  // a recipe may name its own regions (the well names its own mouth); the rest
  // take their names from the realm in the order they were grown
  let n = 0;
  for (const rg of regions) {
    if (rg.name === undefined) rg.name = theme.regions[n % theme.regions.length];
    n++;
  }
  world.regions = regions;
  world.carves = buildCarves(salt, theme.terrain, radius, theme);
  world.regionAt = (x, z) => {
    const g = groundAt(world, x, z);
    return g ? g.region : null;
  };

  const { landmarks, heart } = buildLandmarks({ world, salt });
  world.landmarks = landmarks;
  world.heart = heart;
  const { paths, nav } = buildRoutes({ key, world, landmarks, heart, R: radius });
  world.paths = paths;
  world.nav = nav;

  return world;
}

/** how much a world is worth drawing, for the renderer's own counters */
export function worldStats(world, tier) {
  return {
    regions: world.regions.length,
    landmarks: world.landmarks.length,
    paths: world.paths.length,
    detail: instances(world, tier).length,
  };
}

// Curated procedural scenes for terminal backgrounds.
import { type ProceduralCell, type ProceduralGlow, type ProceduralSprite, type ProceduralScene, type ProceduralRenderOptions, GLYPHS, LOOSE, hash, glyph, ell, drift, near, twinkle, rising, sketch, shape, flip, frame, hexToRgb, rgbToHex, mixRgb, shade, tint, haloOf, DIM, keepVeil } from "./art.ts";

// 1. Moonlit
const moonClouds = new Map<number, string[]>();
function moonCloudArt(w: number): string[] {
  if (!moonClouds.has(w)) {
    const cx = w / 2, inside = (x: number, y: number) => Math.min(ell(x, y, cx, 3, w / 2, 1.6), ell(x, y, cx + w * 0.1, 1.4, w * 0.28, 1.2)) <= 1;
    moonClouds.set(w, shape(w + 1, 6, (x, y) => (inside(x, y) ? String(1 + Math.min(3, Math.floor(4 * x / (w + 1)))) : ".")));
  }
  return moonClouds.get(w)!;
}

const MOON_METEOR = sketch(8, 4, [[0, 0, "11"], [1, 2, "22"], [2, 4, "33"], [3, 6, "4H"]]);
const MOON_METEORS = [MOON_METEOR, flip(MOON_METEOR)];
function moonMeteorPal(ch: string) {
  return {
    H: { bg: "#fff6d0", fg: "#3a3524", a: 1 },
    4: { ch, fg: "#fff6d0", a: 0.85 },
    3: { ch, fg: "#fff6d0", a: 0.6 },
    2: { ch, fg: "#dbe2f5", a: 0.4 },
    1: { ch, fg: "#dbe2f5", a: 0.2 },
  };
}
const MOON_METEOR_PALS = [moonMeteorPal("\\"), moonMeteorPal("/")];
const MOON_SKYFALL = 12, MOON_FALL = 1.5;
function moonMeteors(cols: number, rows: number, t: number): ProceduralSprite[] {
  const k = Math.floor(t / MOON_SKYFALL), p = (t - k * MOON_SKYFALL) / MOON_FALL;
  if (p >= 1) return [];
  const left = hash(k, 3) < 0.5, run = 26 * p;
  const hx = cols * (0.25 + 0.5 * hash(k, 1)) + (left ? -run : run), hy = rows * (0.05 + 0.25 * hash(k, 2)) + run * 0.5;
  return [{ art: MOON_METEORS[+left]!, pal: MOON_METEOR_PALS[+left]!, key: 40, a: Math.sin(Math.PI * p), x: left ? hx : hx - 7, y: hy - 3 }];
}
const MOON_CLOUDS: readonly [number, number, number, number][] = [[0.08, 0.14, 26, 0.6], [0.55, 0.36, 22, 0.45], [0.3, 0.6, 24, 0.5], [0.85, 0.8, 18, 0.7]];
const MOON_NIGHT = tint("#7088d8", "#18214a", [0.35, 0.5, 0.65, 0.82]);

export const moonlitScene: ProceduralScene = {
  id: "moonlit",
  name: "Moonlit",
  tagline: "Silver clouds, crescent moon and quiet shooting stars",
  cell: (x, y, cols, rows, t) => {
    const mx = Math.round(cols * 0.74), my = Math.round(rows * 0.22), R = 6.5;
    // Terminal cell aspect adaptation: 1 vertical row is ~2 horizontal columns in aspect
    const d1 = Math.hypot((x - mx) * 0.5, y - my) * 2;
    const d2 = Math.hypot((x - mx - 3.4) * 0.5, y - my + 1.8) * 2;
    if (d1 <= R && d2 > R * 0.85) return { bg: "#d9c98f", fg: "#3a3524", a: 0.9, floor: 0.45 };
    if (d1 <= R + 1.6 && d2 > R * 0.85 + 0.6 && hash(x, y, 5) < 0.45) return { fg: "#d9c98f", a: 0.25 + 0.15 * Math.sin(t * 2 + x) };
    return twinkle(x, y, t, "#dbe2f5", 0.014);
  },
  sprites: (cols, rows, t) => [
    ...moonMeteors(cols, rows, t),
    ...MOON_CLOUDS.map(([fx, fy, w, v], i) => ({ art: moonCloudArt(w), pal: MOON_NIGHT, halo: "#8ea2e6", x: drift(cols, fx, t, v, w) - w / 2, y: fy * rows - 3, key: i })),
  ],
};

// 2. Cloud Drift
const DRIFT_BIRDS = [["v"], ["^"]];
const DRIFT_BIRD_PAL = { v: { ch: "v", fg: "#3f6280", a: 0.8 }, "^": { ch: "^", fg: "#3f6280", a: 0.8 } };
const DRIFT_FLOCK: readonly [number, number][] = [[0, 0], [2, -1], [4, 0], [1.5, 1.5]];
const driftSkies = new Map<number, string[]>();
function driftSkyArt(seed: number): string[] {
  if (!driftSkies.has(seed)) {
    const r = (j: number) => hash(seed, j, 3), kind = seed % 4;
    const [n, R0, R1, base] = [[3 + Math.floor(r(2) * 2), 2.4, 4.2, 1], [6 + Math.floor(r(2) * 3), 1.1, 1.8, 1], [2, 1.6, 2.4, 1], [3, 2.6, 5.2, 2]][kind]!;
    const domes: [number, number][] = [];
    for (let i = 0, cx = 0; i < n; i++) {
      const mid = 1 - Math.abs(i - (n - 1) / 2) / Math.max(1, (n - 1) / 2);
      const R = R0 + (R1 - R0) * (kind === 3 ? mid ** 2 : mid * 0.6 + r(10 + i) * 0.4);
      cx = i ? cx + R * 0.95 : R;
      domes.push([cx, R]);
      cx += R * 0.45;
    }
    const W = domes[n - 1]![0] + domes[n - 1]![1];
    const lift = (x: number) => Math.max(0, ...domes.map(([cx, R]) => (Math.abs(x - cx) < R ? Math.sqrt(R * R - (x - cx) ** 2) * 0.75 : 0)));
    const H = Math.ceil(Math.max(...domes.map(d => d[1])) * 0.75 + base);
    driftSkies.set(seed, shape(Math.ceil(W) + 1, H, (x, y) => {
      const up = H - 1 - y, h = Math.ceil(base + lift(x + 0.5) - 0.35);
      const end = x + 0.5 < domes[0]![0] - domes[0]![1] * 0.7 || x + 0.5 > domes[n - 1]![0] + domes[n - 1]![1] * 0.7;
      if (up >= h || (end && up >= base) || (up === h - 1 && h > 2 && hash(seed * 7 + x, 1, 4) < 0.25)) return ".";
      return String(1 + Math.min(3, Math.floor(4 * up / H)));
    }));
  }
  return driftSkies.get(seed)!;
}
const DRIFT_DAY_TOPS = {
  4: { bg: "#ffffff", fg: "#9db3c6", a: 0.96 },
  3: { bg: "#f2f6fa", fg: "#93a9bd", a: 0.93 },
  2: { bg: "#e0e9f1", fg: "#869cb0", a: 0.9 },
  1: { bg: "#cad7e3", fg: "#7a90a4", a: 0.86 },
};
const DRIFT_WISP = ["~-~~.~~-~~~.-~", "..~~-~.~~~...."];
const DRIFT_WISP_PAL = { "~": { ch: "~", fg: "#ffffff", a: 0.55 }, "-": { ch: "-", fg: "#ffffff", a: 0.45 } };
const DRIFT_FAR: readonly [number, number, number, number, number][] = [[2, 0.1, 0.14, 0.8, 0.65], [5, 0.55, 0.08, 0.95, 0.6], [6, 0.8, 0.3, 0.75, 0.65], [9, 0.35, 0.3, 0.85, 0.6], [10, 0.95, 0.2, 1, 0.65]];
const DRIFT_NEAR: readonly [number, number, number, number, number][] = [[0, 0.15, 0.48, 1.6, 1], [3, 0.62, 0.42, 1.9, 1], [4, 0.88, 0.72, 1.7, 1], [7, 0.36, 0.78, 2.2, 1], [8, 0.05, 0.86, 1.5, 1]];
const DRIFT_CIRRUS: readonly [number, number, number][] = [[0.2, 0.05, 2.6], [0.7, 0.13, 2.2]];
function driftSkySprite(cols: number, rows: number, t: number) {
  return ([seed, fx, fy, v, a]: readonly [number, number, number, number, number]): ProceduralSprite => {
    const art = driftSkyArt(seed), w = art[0]!.length;
    return { art, pal: DRIFT_DAY_TOPS, a, halo: "#ffffff", x: drift(cols, fx, t, v, w) - w / 2, y: fy * rows - art.length / 2, key: seed };
  };
}

export const cloudDriftScene: ProceduralScene = {
  id: "cloud-drift",
  name: "Cloud Drift",
  tagline: "Rolling daytime cumulus, cirrus wisps and drifting birds",
  sprites: (cols, rows, t) => [
    ...DRIFT_CIRRUS.map(([fx, fy, v], i) => ({ art: DRIFT_WISP, pal: DRIFT_WISP_PAL, key: 60 + i, x: drift(cols, fx, t, v, 14) - 7, y: fy * rows })),
    ...DRIFT_FAR.map(driftSkySprite(cols, rows, t)),
    ...[0, 1].flatMap(f => DRIFT_FLOCK.map(([bx, by], j) => ({
      art: frame(DRIFT_BIRDS, t, 3, j * 0.5), pal: DRIFT_BIRD_PAL, key: 20 + f * 4 + j,
      x: drift(cols, hash(f, 21), t, 2.4 + f * 0.4, 6) + bx, y: rows * (0.25 + 0.25 * f) + Math.sin(t * 0.7 + f) * 1.5 + by,
    }))),
    ...DRIFT_NEAR.map(driftSkySprite(cols, rows, t)),
  ],
};

// 3. Fireflies
const FIREFLY_FLIES = [["a..", ".Y.", "..c"], ["..b", ".Y.", "..."], ["...", ".Y.", "b.a"]];
const FIREFLY_PAL = {
  Y: { bg: "#e9f57a", fg: "#2c3308", a: 1 },
  a: { ch: ":", fg: "#e9f57a", a: 0.55 },
  b: { ch: "'", fg: "#e9f57a", a: 0.55 },
  c: { ch: "o", fg: "#e9f57a", a: 0.4 },
};

export const firefliesScene: ProceduralScene = {
  id: "fireflies",
  name: "Fireflies",
  tagline: "Glowing summer fireflies weaving through moonlit reeds",
  cell: (x, y, cols, rows, t) => {
    const h = 2 + Math.floor(hash(x, 7) ** 2 * 8);
    if (y < rows - h || (y < rows - 1 && hash(x, y, 8) > 0.75)) return undefined;
    return { ch: glyph("SXt%S", x, y, t * 0.5), fg: "#4fb85c", a: 0.5 + 0.45 * (y - rows + h) / h };
  },
  sprites: (cols, rows, t) => Array.from({ length: 18 }, (_, i) => {
    const b = Math.max(0, Math.min(1, Math.sin(t * (0.6 + 0.5 * hash(i, 5)) + i * 3) * 1.4 - 0.2));
    return {
      art: FIREFLY_FLIES[i % 3]!, pal: FIREFLY_PAL, key: i, a: 0.12 + 0.88 * b,
      glow: { r: 3.4, color: "#cfe86a", a: 0.18 + 0.3 * b },
      x: hash(i, 1) * cols + Math.sin(t * 0.2 * (1 + hash(i, 2)) + i) * 6 - 1,
      y: rows * (0.08 + 0.65 * hash(i, 3)) + Math.cos(t * 0.17 * (1 + hash(i, 4)) + i * 2) * 3.5 - 1,
    };
  }),
};

// 4. Jellyfish
function jelly(ph: number): string[] {
  return sketch(13, 22, [
    ...(ph ? [[0, 4, "BBBBB"], [1, 2, "BBBBBBBBB"], [2, 1, "BBpBBBBBpBB"], [3, 0, "RRRRRRRRRRRRR"]] as const
      : [[0, 3, "BBBBBBB"], [1, 1, "BBBBBBBBBBB"], [2, 1, "BBpBBBBBpBB"], [3, 1, "RRRRRRRRRRR"]] as const),
    [4, 3, "kkkkkkk"],
    ...[1, 3, 5, 7, 9, 11].flatMap((c, k) => Array.from({ length: 16 }, (_, i) => {
      const r = hash(k, i, 7);
      return r < 0.18 ? [] : [[5 + i, c, r < 0.42 ? "o" : "l"] as const];
    }).flat()),
  ]);
}
const JELLIES = [jelly(0), jelly(1)];
function jellyPal(c: string) {
  return {
    B: { bg: c, fg: shade(c, -0.6), a: 0.72 },
    p: { bg: shade(c, 0.55), fg: c, a: 0.85 },
    R: { bg: shade(c, 0.15), fg: shade(c, -0.6), a: 0.78 },
    k: { bg: shade(c, -0.15), fg: shade(c, -0.65), a: 0.6 },
    l: { bg: c, fg: shade(c, -0.6), a: 0.62 },
    o: { ch: "o", fg: shade(c, 0.3), a: 0.5 },
  };
}
const JELLY_PRESETS: readonly [number, ReturnType<typeof jellyPal>, number, number][] = [
  [0.25, "#9a7fe0", 0.6, 0.7],
  [0.82, "#ef8f63", 0.9, 0.95],
  [0.06, "#ec92c6", 0.75, 0.9],
  [0.55, "#7fb4ef", 1.1, 0.6],
].map(([x, c, v, a]) => [x as number, jellyPal(c as string), v as number, a as number]);

export const jellyfishScene: ProceduralScene = {
  id: "jellyfish",
  name: "Jellyfish",
  tagline: "Bioluminescent jellies pulsing through the abyss",
  cell: (x, y, cols, rows, t) => {
    const cx = -cols * 0.15, cy = -rows * 0.35, R = rows * 0.75 + cols * 0.1;
    const d = Math.hypot((x - cx) * 0.5, y - cy) * 2;
    if (Math.abs(d - R) < 0.55 && (((Math.atan2(y - cy, (x - cx) * 0.5) * R - t * 3) % 3) + 3) % 3 < 1) return { ch: "o", fg: "#dbe8ff", a: 0.55 };
    if (Math.abs(d - R - 1.6) < 0.55 && hash(x, y, 71) < 0.4) return { ch: "~", fg: "#9cc8ff", a: 0.35 };
    if (rising(x, y, t, 0.6, 0.01)) return { ch: ".", fg: "#9cc8ff", a: 0.35 };
    return undefined;
  },
  sprites: (cols, rows, t) => JELLY_PRESETS.map(([fx, pal, v, a], i) => {
    const span = rows + 34;
    return {
      art: frame(JELLIES, t, 1.1, i * 0.5), pal, a, key: i,
      x: fx * cols + Math.sin(t * 0.35 + i) * 2.5 - 6.5, y: rows + 4 - ((t * v + i * span / 4) % span),
    };
  }),
};

// 5. Lantern Night
const LANTERN_NEAR = ["..RRRR..", ".RRRRRR.", "RRRRRRRR", ".pPPPPp.", ".pPPKPp.", ".pPKKPp.", ".pPPPPp.", ".pPPPPp.", ".WWWWWW.", "wwwwwwww", ".wwwwww."];
const LANTERN_FAR = ["RRRRR", ".pPp.", ".pKp.", ".WWW.", "wwwww"];
function lanternFlicker(art: readonly string[]): string[] {
  return art.map((r, y) => (y === 3 || y === art.length - 4 ? r.replace(/P/g, "p") : r));
}
const LANTERN_REFLECT_NEAR = [["..rrrr..", "...rr...", "..r..r..", "...rr...", "....r..."], [".rrrrr..", "..rr.r..", "...rr...", "..r.....", "...r...."], ["..rrrrr.", "..r.rr..", "...rr...", ".....r..", "....r..."]];
const LANTERN_REFLECT_FAR = [[".rrr.", "..r..", ".r..."], ["rrr..", ".r.r.", "..r.."], [".rrrr", "..r..", "...r."]];
function makeLanternArts(art: readonly string[], reflects: readonly (readonly string[])[]): string[][] {
  return [art, lanternFlicker(art)].flatMap(a => reflects.map(r => [...a, ...r]));
}
const LANTERN_ARTS = [makeLanternArts(LANTERN_FAR, LANTERN_REFLECT_FAR), makeLanternArts(LANTERN_NEAR, LANTERN_REFLECT_NEAR)];
const LANTERN_PAL = {
  R: { bg: "#3a1a14", fg: "#170905", a: 0.95 },
  P: { bg: "#ffd889", fg: "#c46a1c", a: 0.97 },
  p: { bg: "#f4a347", fg: "#7a3a0c", a: 0.95 },
  K: { bg: "#e07a2a", fg: "#5a2a08", a: 0.95 },
  W: { bg: "#4a2e1c", fg: "#1e120a", a: 0.95 },
  w: { bg: "#2e1c12", fg: "#120a06", a: 0.92 },
  r: { bg: "#f6b04e", fg: "#7a3a0c", a: 0.4 },
};
const LANTERNS_LIST: readonly [number, number, number][] = [[0.05, 0.1, 0.12], [0.4, 0.05, 0.1], [0.75, 0.18, 0.14], [0.2, 0.35, 0.2], [0.6, 0.42, 0.18], [0.9, 0.3, 0.22], [0.12, 0.72, 0.3], [0.5, 0.85, 0.26], [0.82, 0.68, 0.32]];
const LANTERN_BANK = 0.3;

export const lanternNightScene: ProceduralScene = {
  id: "lantern-night",
  name: "Lantern Night",
  tagline: "Floating water lanterns drifting past riverside rooftops",
  cell: (x, y, cols, rows, t) => {
    const bank = Math.round(rows * LANTERN_BANK);
    const roof = bank - 1 - Math.floor(2.6 * (0.5 + 0.5 * Math.sin(x * 0.21)) + hash(Math.floor(x / 3), 7) * 2.2);
    if (y < roof) return twinkle(x, y, t, "#fff1cf", 0.012);
    if (y < bank) {
      if (y < bank - 1 && hash(x, y, 41) < 0.07) return { bg: "#f2b65a", fg: "#6a3a0c", a: 0.55 + 0.3 * Math.sin(t * 0.7 + x) ** 2 };
      return { bg: "#04070e", fg: "#131c30", a: 0.97 };
    }
    if (y < bank + 4 && hash(x, bank - 2, 41) < 0.07 && hash(x, y + Math.floor(t * 2), 43) < 0.55) return { ch: "|", fg: "#f2b65a", a: 0.35 * (1 - (y - bank) / 4) };
    if (hash(Math.floor(x / 4 + t * 0.25 * (1 + (y % 3) * 0.3)), y, 45) < 0.07) return { ch: (x + y) % 2 ? "~" : "-", fg: "#8fb0d6", a: 0.16 };
    return undefined;
  },
  sprites: (cols, rows, t) => LANTERNS_LIST.map(([fx, depth, v], i) => {
    const isNear = depth > 0.5, art = frame(LANTERN_ARTS[+isNear]!, t, 2.2, i * 1.7);
    const top = rows * LANTERN_BANK + 1 + depth * (rows * (1 - LANTERN_BANK) - 16);
    return {
      art, pal: LANTERN_PAL, key: 60 + i, a: 0.7 + 0.3 * depth,
      glow: { r: isNear ? 7 : 4, color: "#ffb347", a: isNear ? 0.42 : 0.28 },
      x: drift(cols, fx, t, v, art[0]!.length), y: top + Math.sin(t * 0.8 + i * 2) * 0.5,
    };
  }),
};

// 6. Neon Rain
const NEON_STREET = 3;
interface CityCache {
  cols: number;
  rows: number;
  near: readonly (readonly [number, number, number, number])[];
  far: readonly (readonly [number, number, number, number])[];
}
let cityCache: CityCache | undefined;
function getCity(cols: number, rows: number): CityCache {
  if (cityCache?.cols !== cols || cityCache?.rows !== rows) {
    const mid = cols / 2, half = Math.max(1, cols / 2);
    const buildRow = (seed: number, lo: number, hi: number, pow: number): (readonly [number, number, number, number])[] => {
      const out: (readonly [number, number, number, number])[] = [];
      for (let x = 0, b = 0; x < cols; b++) {
        const w = 4 + Math.floor(hash(b, seed) * 5), e = Math.min(1, Math.abs(x + w / 2 - mid) / half);
        const h = Math.round(rows * (lo + hi * e ** pow * (0.6 + 0.4 * hash(b, seed + 1))));
        for (let i = 0; i < w; i++) out[x + i] = [h, x, x + w - 1, b] as const;
        x += w;
      }
      return out;
    };
    cityCache = { cols, rows, near: buildRow(1, 0.08, 0.52, 2), far: buildRow(5, 0.16, 0.48, 1.4) };
  }
  return cityCache;
}
const NEON_CITY = {
  wall: { bg: "#1b2242", fg: "#2b355a", a: 0.95 },
  roof: { bg: "#2a3358", fg: "#3a4570", a: 0.95 },
  dark: { bg: "#232b4e", fg: "#323c64", a: 0.95 },
  far: { bg: "#121730", fg: "#1b2140", a: 0.75 },
  farWin: { bg: "#6a5a3a", fg: "#2a2416", a: 0.5 },
  win: [{ bg: "#f3c56b", fg: "#6a4a10", a: 0.85 }, { bg: "#ffe2a0", fg: "#7a5a18", a: 0.85 }, { bg: "#8fd3ff", fg: "#1d4a6a", a: 0.75 }],
};
const NEON_RAIN_V = 11, NEON_RAIN_K = 0.3;
function neonRain(x: number, y: number, t: number): ProceduralCell | undefined {
  const q = Math.floor(y - t * NEON_RAIN_V), track = Math.floor(x + y * NEON_RAIN_K), m = ((q % 3) + 3) % 3;
  if (m < 2 && hash(track, Math.floor(q / 3), 27) < 0.09) return { ch: "/", fg: "#a9c4f0", a: m ? 0.6 : 0.28 };
  return undefined;
}
const NEON_SMEAR = ["#ff5fa2", "#4fe3ff", "#f3c56b"];
function neonStreet(x: number, y: number, t: number): ProceduralCell | undefined {
  if (y === 0) return { ch: "_", fg: "#3a4570", a: 0.55 };
  if (hash(x, y, 40 + Math.floor(t * 3)) < 0.025) return { ch: "o", fg: "#a9c4f0", a: 0.5 };
  if (hash(x, Math.floor(t * 1.5) + y, 41) < 0.12) return { ch: y === 1 ? "|" : "~", fg: NEON_SMEAR[Math.floor(hash(x, 42) * 3)], a: 0.28 };
  return undefined;
}
function neonSign(word: string, c: string) {
  const tube = (ch: string) => ({ ch, fg: c, a: 0.9 });
  const pal: Record<string, { bg?: string; fg?: string; ch?: string; a: number }> = { "+": tube("+"), "-": tube("-"), "|": tube("|") };
  for (const ch of word) {
    pal[ch] = { bg: "#1c0b1a", fg: c, a: 0.95, ch };
    pal[ch.toLowerCase()] = { bg: "#1c0b1a", fg: shade(c, -0.55), a: 0.9, ch };
  }
  const art = sketch(3, word.length + 2, [[0, 0, "+-+"], ...[...word].map((ch, i) => [i + 1, 0, `|${ch}|`] as const), [word.length + 1, 0, "+-+"]]);
  return { c, pal, arts: [art, ...[...word].map((_, i) => art.map((r, y) => (y === i + 1 ? r.toLowerCase() : r)))] };
}
const NEON_SIGNS = [neonSign("RAMEN", "#ff5fa2"), neonSign("HOTEL", "#4fe3ff")];
const NEON_WALK = [
  ["..uUu..", ".uUUUu.", "uUUUUUu", "d..|..d", "...h...", "..cCc..", "..cCc..", "..l.l.."],
  ["..uUu..", ".uUUUu.", "uUUUUUu", "...|...", "d..h..d", "..cCc..", "..cCc..", "...l..."],
];
function neonWalkPal(c: string) {
  return {
    U: { bg: c, fg: shade(c, -0.6), a: 0.95 }, u: { bg: shade(c, -0.25), fg: shade(c, -0.7), a: 0.95 },
    d: { ch: ".", fg: "#bcd2f5", a: 0.6 }, "|": { ch: "|", fg: "#8a92b0", a: 0.9 },
    h: { bg: "#3a3550", fg: "#1a1828", a: 0.95 }, c: { bg: "#252a42", fg: "#121526", a: 0.95 },
    C: { bg: "#2f3554", fg: "#151a2e", a: 0.95 }, l: { bg: "#1c2034", fg: "#0c0e18", a: 0.95 },
  };
}
const NEON_WALKERS: readonly [number, number, boolean, ReturnType<typeof neonWalkPal>][] = [[0.97, 1.5, false, neonWalkPal("#ff5fa2")], [0.98, 1.1, true, neonWalkPal("#f2c14e")]];
const NEON_STORM = 23;
function neonBoltArt(k: number): string[] {
  const out: string[] = [];
  for (let y = 0, c = 4; y < 12; y++) {
    const s = Math.floor(hash(k, y, 61) * 3) - 1;
    c = Math.max(0, Math.min(8, c + s));
    out.push(".".repeat(c) + (s < 0 ? "/" : s > 0 ? "\\" : "|") + ".".repeat(8 - c));
  }
  return out;
}
const NEON_BOLT_PAL = Object.fromEntries(["/", "\\", "|"].map(ch => [ch, { ch, fg: "#eef3ff", a: 1 }]));

export const neonRainScene: ProceduralScene = {
  id: "neon-rain",
  name: "Neon Rain",
  tagline: "Cyberpunk city drenched in rain, neon signs and umbrella commuters",
  cell: (x, y, cols, rows, t) => {
    const { near: nearBld, far: farBld } = getCity(cols, rows), ground = rows - NEON_STREET;
    if (y >= ground) return neonStreet(x, y - ground, t);
    const [h, x0, x1, b] = nearBld[x] ?? [0, 0, 0, 0], top = ground - h;
    if (y >= top) {
      if (y === top) return NEON_CITY.roof;
      if (x > x0 && x < x1 && (x - x0) % 2 === 1 && (ground - y) % 2 === 0 && y > top + 1) {
        const lit = (hash(x, y, 21) < 0.45) !== (hash(x, y, 22 + Math.floor(t / 7 + hash(x, y, 24) * 7)) < 0.08);
        const s = hash(x, y, 23);
        return lit ? NEON_CITY.win[s < 0.6 ? 0 : s < 0.85 ? 1 : 2] : NEON_CITY.dark;
      }
      return NEON_CITY.wall;
    }
    if (y === top - 1 && x === Math.floor((x0 + x1) / 2) && hash(b, 31) < 0.35)
      return { ch: "*", fg: "#ff4d5e", a: Math.sin(t * 2.5 + b) > 0.3 ? 0.95 : 0.2 };
    const [fh, fx0, fx1] = farBld[x] ?? [0, 0, 0, 0];
    if (y >= ground - fh)
      return fx1 - fx0 > 2 && (x - fx0) % 2 === 1 && (ground - y) % 3 === 0 && hash(x, y, 25) < 0.3 ? NEON_CITY.farWin : NEON_CITY.far;
    return neonRain(x, y, t);
  },
  sprites: (cols, rows, t) => {
    const { near: nearBld } = getCity(cols, rows), ground = rows - NEON_STREET;
    // Lightning
    const k = Math.floor(t / NEON_STORM), p = t - k * NEON_STORM;
    const bolts: ProceduralSprite[] = [];
    if (p < 0.1 || (p > 0.2 && p < 0.32)) {
      const fx = hash(k, 62) < 0.5 ? 0.06 + 0.14 * hash(k, 63) : 0.78 + 0.14 * hash(k, 63);
      bolts.push({ art: neonBoltArt(k), pal: NEON_BOLT_PAL, key: 80, x: cols * fx, y: rows * 0.03, glow: { r: 16, color: "#a9bcff", a: 0.45 } });
    }
    // Neon Signs
    const signs = NEON_SIGNS.flatMap((s, i) => {
      let best: readonly [number, number, number, number] | undefined;
      const startX = Math.floor(i ? cols * 0.7 : 0), endX = Math.floor(i ? cols : cols * 0.3);
      for (let x = startX; x < endX; x++) if (!best || (nearBld[x]?.[0] ?? 0) > best[0]) best = nearBld[x];
      if (!best || best[0] < s.arts[0]!.length + 3) return [];
      const signK = Math.floor(t * 4), art = hash(signK, i, 51) < 0.1 ? s.arts[1 + Math.floor(hash(signK, i, 52) * (s.arts.length - 1))]! : s.arts[0]!;
      const a = (t + i * 4.5) % 9 < 0.3 ? 0.3 : 1;
      return [{ art, pal: s.pal, key: 70 + i, a, x: i ? best[1] - 2 : best[2], y: ground - best[0] + 2, glow: { r: 6, color: s.c, a: 0.35 * a } }];
    });
    // Walkers
    const walkers = NEON_WALKERS.map(([f, v, left, pal], i) => {
      const run = drift(cols, f, t, v, 7);
      return { art: frame(NEON_WALK, t, 3, i), pal, key: 90 + i, x: (left ? cols - run : run) - 3.5, y: rows - NEON_STREET - 8 };
    });
    return [...bolts, ...signs, ...walkers];
  },
};

// 7. Sakura Dusk
const SAKURA_BRANCH = [
  "BBBBBBBBBBBBbbb.........FF..",
  "BBBBBbbbFFf...bbbb....FFcFF.",
  "BBBb..FFcFF......bbbbb.FF...",
  "BBb....FFf...fFF....bb......",
  "Bb..........FFcF.....bFFf...",
  "B.......FF...fFF....FFcFF...",
  "b......FcFF..........fFF....",
  "b.......Ff..................",
];
function sakuraBloom(art: readonly string[], k: number): string[] {
  return art.map(r => r.replace(/[Ff]/g, (c, i) => ((i + k) % 3 ? c : c === "F" ? "f" : "F")));
}
const SAKURA_BRANCHES = [0, 1, 2].map(k => sakuraBloom(SAKURA_BRANCH, k));
const SAKURA_BRANCHES_R = SAKURA_BRANCHES.map(flip);
const SAKURA_BRANCH_PAL = {
  B: { bg: "#2a1a24", fg: "#120a10", a: 0.97 }, b: { ch: "=", fg: "#3e2834", a: 0.9 },
  F: { bg: "#f7a8c4", fg: "#9a3d62", a: 0.95 }, f: { bg: "#ffd6e4", fg: "#b8607e", a: 0.9 },
  c: { bg: "#ffe9a8", fg: "#9a5a20", a: 0.95 },
};
const SAKURA_PETALS = [["Pp"], ["P", "."], ["pP"], [".", "P"]];
const SAKURA_PETAL_PAL = { P: { bg: "#f7a8c4", fg: "#9a3d62", a: 0.9 }, p: { ch: "'", fg: "#ffd6e4", a: 0.7 } };

export const sakuraDuskScene: ProceduralScene = {
  id: "sakura-dusk",
  name: "Sakura Dusk",
  tagline: "Cherry blossom branches, tumbling petals and golden twilight hills",
  cell: (x, y, cols, rows, t) => {
    const hill = rows - 3 - Math.round(2.5 * (0.5 + 0.5 * Math.sin(x * 0.09 + 1)) + 1.5 * (0.5 + 0.5 * Math.sin(x * 0.23)));
    const sx = cols * 0.8, sy = hill + 1, d = Math.hypot((x - sx) * 0.5, y - sy);
    if (y >= hill) {
      if (hash(x, y, 21) < 0.05) return { ch: ".", fg: "#f7a8c4", a: 0.45 };
      return { bg: "#1a1222", fg: "#2c1d34", a: 0.96 };
    }
    if (d < 4) return { bg: "#ffb48a", fg: "#c0603a", a: 0.75, floor: 0.3 };
    if (d < 6 && hash(x, y, 22) < 0.4) return { fg: "#ffb48a", a: 0.25 + 0.15 * Math.sin(t + x) };
    if (y < rows * 0.45) return twinkle(x, y, t, "#f3dcef", 0.012);
    if (rising(x, y, -t, 0.6, 0.006)) return { ch: ".", fg: "#ffd6e4", a: 0.25 };
    return undefined;
  },
  sprites: (cols, rows, t) => {
    const leftBranchArt = frame(SAKURA_BRANCHES, t, 1.4, 0);
    const rightBranchArt = frame(SAKURA_BRANCHES_R, t, 1.4, 1);
    const branches: ProceduralSprite[] = [
      { art: leftBranchArt, pal: SAKURA_BRANCH_PAL, key: 1, halo: "#f7a8c4", shadow: true, glow: { r: 5, color: "#f7a8c4", a: 0.16 }, x: 0, y: Math.sin(t * 0.5) * 0.4 },
      { art: rightBranchArt, pal: SAKURA_BRANCH_PAL, key: 2, halo: "#f7a8c4", shadow: true, glow: { r: 5, color: "#f7a8c4", a: 0.16 }, x: cols - rightBranchArt[0]!.length, y: Math.sin(t * 0.5 + 2) * 0.4 },
    ];
    const petals = Array.from({ length: Math.round(8 + cols / 8) }, (_, i): ProceduralSprite => {
      const v = 0.8 + 1.2 * hash(i, 1), span = rows + 4, y = ((((hash(i, 2) * span + t * v) % span) + span) % span) - 2;
      const side = hash(i, 3) < 0.5, depth = hash(i, 4);
      const x0 = side ? cols * (0.02 + 0.3 * hash(i, 5)) : cols * (0.68 + 0.3 * hash(i, 5));
      return { art: frame(SAKURA_PETALS, t, 2 + 2 * hash(i, 6), i), pal: SAKURA_PETAL_PAL, key: 10 + i, a: 0.35 + 0.6 * depth, x: x0 + y * 0.35 + Math.sin(t * 0.9 + i) * 3, y };
    });
    return [...branches, ...petals];
  },
};

// 8. Snow Cabin
const CABIN_LIT = [
  "............CC....", ".......NNNNNCC....", ".....NNNNNNNNNN...", "...NNNNNNNNNNNNNN.",
  ".NNNRRRRRRRRRRRNNN", "..LLLLLLLLLLLLLLL.", "..lYyYlLLLLLLDDDl.", "..LyyyLLLLLLLDDDL.", "..lYyYlLLLLLLDdDl.",
  "..lllllllllllDDDl.", "NNNNNNNNNNNNNNNNNN",
];
const CABIN_ARTS = [CABIN_LIT, CABIN_LIT.map((r, y) => (y > 5 && y < 9 ? r.replace(/Y/g, "Z") : r))];
const CABIN_PAL = {
  N: { bg: "#e8f0fb", fg: "#9fb4d4", a: 0.95 }, C: { bg: "#3a2a24", fg: "#1a120e", a: 0.95 }, R: { bg: "#2a1c18", fg: "#120b08", a: 0.95 },
  L: { bg: "#5a3b26", fg: "#2e1e12", a: 0.95 }, l: { bg: "#4a2f1e", fg: "#24160c", a: 0.95 }, D: { bg: "#3a2516", fg: "#1a1008", a: 0.95 },
  d: { bg: "#e0a458", fg: "#5a3a10", a: 0.95 }, y: { bg: "#5a3b26", fg: "#2e1e12", a: 0.95 },
  Y: { bg: "#ffd38a", fg: "#c47a2a", a: 1 }, Z: { bg: "#f6b860", fg: "#a8601c", a: 1 },
};
const CABIN_PINE = ["....N....", "...NGN...", "..GGGGG..", "...GNG...", "..NGGGN..", ".GGGGGGG.", "..GGNGG..", ".NGGGGGGN", "GGGGGGGGG", "....T....", "....T...."];
function cabinSway(art: readonly string[], k: number): string[] {
  return art.map((r, y) => (y < 4 ? (k > 0 ? "." + r.slice(0, -1) : r.slice(1) + ".") : r));
}
const CABIN_PINES = [CABIN_PINE, cabinSway(CABIN_PINE, 1), CABIN_PINE, cabinSway(CABIN_PINE, -1)];
const CABIN_PINE_PAL = { G: { bg: "#1f3a35", fg: "#0d1e1b", a: 0.95 }, N: { bg: "#dbe6f6", fg: "#8ea2c4", a: 0.92 }, T: { bg: "#3a2516", fg: "#1a1008", a: 0.95 } };
const CABIN_TREES: readonly [number, number][] = [[0.34, 1], [0.78, 0.7], [0.86, 1], [0.94, 0.8]];
const CABIN_GROUND = 0.84;
function cabinGroundAt(x: number, rows: number): number {
  return Math.round(rows * CABIN_GROUND + Math.sin(x * 0.09) * 1.2);
}
function cabinPeak(x: number, cols: number, rows: number): number {
  return Math.max(0,
    rows * 0.34 - Math.abs(x - cols * 0.1) * 0.9, rows * 0.26 - Math.abs(x - cols * 0.24) * 1.1,
    rows * 0.38 - Math.abs(x - cols * 0.9) * 0.85, rows * 0.22 - Math.abs(x - cols * 0.74) * 1.2);
}

export const snowCabinScene: ProceduralScene = {
  id: "snow-cabin",
  name: "Snow Cabin",
  tagline: "Warm illuminated log cabin in a quiet winter pine forest",
  cell: (x, y, cols, rows, t) => {
    const ground = cabinGroundAt(x, rows), ridge = Math.round(rows * CABIN_GROUND - cabinPeak(x, cols, rows));
    const fall = (v: number, odds: number, seed: number) => hash(x + Math.round(Math.sin(y * 0.3 + t * 0.5 + seed) * 1.5), Math.floor(y - t * v), seed) < odds;
    if (y >= ground) {
      if (hash(x, y, 21) < 0.02) return { ch: "*", fg: "#ffffff", a: 0.3 + 0.5 * Math.sin(t * 2 + x * 7) ** 2 };
      return { bg: "#3d4d6e", fg: "#56688c", a: 0.85 };
    }
    if (y >= ridge) {
      if (y < ridge + 2 + hash(x, 13) * 2 && cabinPeak(x, cols, rows) > 6) return { bg: "#b8c7df", fg: "#8195b8", a: 0.7 };
      return { bg: "#18233d", fg: "#222f4d", a: 0.9 };
    }
    const cx = Math.round(cols * 0.05), cy = cabinGroundAt(cx + 9, rows) - 10, dy = cy + 1 - y;
    if (dy > 0 && dy < 12) {
      const mid = cx + 12.5 + Math.sin(t * 0.8 - dy * 0.5) * 1.2 + dy * 0.45;
      if (Math.abs(x - mid) <= 1 + dy * 0.12 && hash(x, Math.floor(y + t * 1.6), 17) < 0.55)
        return { ch: dy < 4 ? "o" : "~", fg: "#c9d3e6", a: 0.4 * (1 - dy / 12) };
    }
    if (fall(3.2, 0.012, 31)) return { ch: "*", fg: "#ffffff", a: 0.7 };
    if (fall(1.6, 0.02, 33)) return { ch: ".", fg: "#dfe8f6", a: 0.45 };
    if (y < rows * 0.45) return twinkle(x, y, t, "#e6edf8", 0.01);
    return undefined;
  },
  sprites: (cols, rows, t) => {
    const cx = Math.round(cols * 0.05), cy = cabinGroundAt(cx + 9, rows) - 10;
    return [
      {
        art: frame(CABIN_ARTS, t, 1.6), pal: CABIN_PAL, key: 1, x: cx, y: cy, shadow: "#0a1020",
        glow: { r: 7, color: "#ffb85c", a: 0.32 + 0.06 * Math.sin(t * 3) },
      },
      ...CABIN_TREES.map(([fx, s], i) => ({
        art: frame(CABIN_PINES, t, 0.8, i * 1.3), pal: CABIN_PINE_PAL, key: 10 + i, a: 0.6 + 0.4 * s,
        x: Math.round(cols * fx), y: cabinGroundAt(Math.round(cols * fx) + 4, rows) - 11 + Math.round((1 - s) * 3), halo: "#dfe8f6",
      })),
    ];
  },
};

// 9. Star Voyage
const VOYAGE_HULL: readonly (readonly [number, number, string])[] = [
  [0, 3, "W"], [1, 3, "WBBBBb"], [2, 3, "WBBoBBBBNn"], [3, 3, "WBBBBb"], [4, 3, "W"],
];
const VOYAGE_FLAMES: readonly (readonly (readonly [number, number, string])[])[] = [
  [[2, 0, "fFF"]],
  [[1, 1, "f"], [2, 0, "FFF"], [3, 1, "f"]],
  [[2, 1, "fF"], [1, 2, "f"]],
];
const VOYAGE_ROCKET = VOYAGE_FLAMES.map(f => sketch(13, 5, [...VOYAGE_HULL, ...f]));
const VOYAGE_ROCKET_PAL = {
  B: { bg: "#dfe4f5", fg: "#6a7090", a: 0.95 }, b: { bg: "#aab1cc", fg: "#4a5070", a: 0.95 },
  W: { bg: "#ff6fb5", fg: "#5a1838", a: 0.95 }, o: { bg: "#4fe3ff", fg: "#0d3a4a", a: 0.95 },
  N: { bg: "#ff6fb5", fg: "#5a1838", a: 0.95 }, n: { ch: ">", fg: "#ff6fb5", a: 0.8 },
  F: { bg: "#ffb347", fg: "#7a3a00", a: 0.9 }, f: { ch: "~", fg: "#ff7a3d", a: 0.8 },
};
const VOYAGE_SPEED = 4, VOYAGE_ROCKET_W = 13;
function voyageRocketAt(cols: number, rows: number, t: number) {
  return { x: drift(cols, 0.3, t, VOYAGE_SPEED, VOYAGE_ROCKET_W), y: rows * 0.12 + 1.5 * Math.sin(t * 0.9) };
}
const VOYAGE_BANDS = ["#7a4cc2", "#9b5fd6", "#c76fd0", "#8a55c8", "#6a3fae"];
const VOYAGE_STREAK = sketch(8, 4, [[0, 0, "11"], [1, 2, "22"], [2, 4, "33"], [3, 6, "4H"]]);
const VOYAGE_STREAKS = [VOYAGE_STREAK, flip(VOYAGE_STREAK)];
function voyageStreakPal(ch: string) {
  return {
    H: { bg: "#fff3fb", fg: "#5a3a50", a: 1 }, 4: { ch, fg: "#ffd1ea", a: 0.85 }, 3: { ch, fg: "#ffd1ea", a: 0.6 },
    2: { ch, fg: "#e6ecff", a: 0.4 }, 1: { ch, fg: "#e6ecff", a: 0.2 },
  };
}
const VOYAGE_STREAK_PALS = [voyageStreakPal("\\"), voyageStreakPal("/")];
const VOYAGE_EVERY = 9, VOYAGE_FALL = 1.3;
function voyageShooting(cols: number, rows: number, t: number): ProceduralSprite[] {
  const k = Math.floor(t / VOYAGE_EVERY), p = (t - k * VOYAGE_EVERY) / VOYAGE_FALL;
  if (p >= 1) return [];
  const left = hash(k, 3) < 0.5, run = 24 * p;
  const hx = cols * (0.2 + 0.6 * hash(k, 1)) + (left ? -run : run), hy = rows * (0.3 + 0.3 * hash(k, 2)) + run * 0.5;
  return [{
    art: VOYAGE_STREAKS[+left]!, pal: VOYAGE_STREAK_PALS[+left]!, key: 40, a: Math.sin(Math.PI * p),
    x: left ? hx : hx - 7, y: hy - 3, glow: { r: 5, color: "#ffd1ea", a: 0.3 * Math.sin(Math.PI * p) },
  }];
}
const VOYAGE_MOON = [".mm.", "mMMm", ".mm."];
const VOYAGE_MOON_PAL = { M: { bg: "#d8dcec", fg: "#5a6080", a: 0.95 }, m: { bg: "#a8aec8", fg: "#4a5070", a: 0.9 } };

export const starVoyageScene: ProceduralScene = {
  id: "star-voyage",
  name: "Star Voyage",
  tagline: "Retro rocket traversing cosmic rings, moons and stardust",
  cell: (x, y, cols, rows, t) => {
    const R = Math.max(4, Math.min(9, cols * 0.065)), cx = cols * 0.84, cy = rows * 0.32;
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx * 0.5, dy) * 2;
    const ring = ell(x + 0.5, y + 0.5, cx, cy + dx * 0.12, R * 2.1, R * 0.5);
    const onRing = ring > 0.78 && ring < 1.05, front = dy + dx * 0.12 > 0;
    if (onRing && (front || d > R)) {
      const a = 0.55 + 0.25 * Math.sin(dx * 0.6 - t * 1.5);
      return { bg: "#e6c9ff", fg: "#5a3a80", a: d > R ? a * 0.8 : a, floor: 0.45 };
    }
    if (d <= R) {
      const band = VOYAGE_BANDS[Math.floor(((dy / R + 1) * 2.5 + 0.4 * Math.sin(dx * 0.5 + t * 0.3))) % VOYAGE_BANDS.length] ?? VOYAGE_BANDS[0]!;
      const lit = (-dx - dy) / (R * 1.6);
      return { bg: shade(band, Math.max(-0.55, Math.min(0.25, lit))), fg: shade(band, -0.6), a: 0.92, floor: 0.5 };
    }
    if (onRing || d <= R + 1.5) return near(x, y, "#c9a6ff", 0.22, 0.35);

    const r = voyageRocketAt(cols, rows, t), rdist = r.x - VOYAGE_ROCKET_W / 2 - x;
    if (rdist > 0 && rdist < 16) {
      const ty = voyageRocketAt(cols, rows, t - rdist / VOYAGE_SPEED).y + 2;
      if (Math.abs(y + 0.5 - ty - 0.5) < 0.7 && hash(x, y, Math.floor(t * 5)) < 0.55 - rdist * 0.025)
        return { ch: rdist < 5 ? "o" : ".", fg: rdist < 5 ? "#ffb347" : "#ffd1ea", a: 0.6 * (1 - rdist / 16) };
    }
    if (hash(Math.floor(x + t * 0.8), y, 17) < 0.004) return { ch: ".", fg: "#9aa6d8", a: 0.35 };
    return twinkle(x, y, t, "#e6ecff", 0.018);
  },
  sprites: (cols, rows, t) => {
    const R = Math.max(4, Math.min(9, cols * 0.065)), cx = cols * 0.84, cy = rows * 0.32;
    const r = voyageRocketAt(cols, rows, t), m = t * 0.35;
    const moonBehind = Math.sin(m) < 0 && Math.abs(Math.cos(m) * R * 2.8) < R + 2;
    return [
      ...voyageShooting(cols, rows, t),
      { art: ["."], pal: {}, x: cx - 0.5, y: cy - 0.5, key: 1, glow: { r: R * 2.2, color: "#9b5fd6", a: 0.22 } },
      ...(moonBehind ? [] : [{
        art: VOYAGE_MOON, pal: VOYAGE_MOON_PAL, key: 2, shadow: "#05040d", halo: "#c9cde0",
        x: cx + Math.cos(m) * R * 2.8 - 2, y: cy + Math.sin(m) * R * 0.9 - 1.5,
      }]),
      {
        art: frame(VOYAGE_ROCKET, t, 8), pal: VOYAGE_ROCKET_PAL, key: 3, shadow: "#05040d", x: r.x - VOYAGE_ROCKET_W / 2, y: r.y,
        glow: { r: 5, color: "#ffb347", a: 0.3 + 0.1 * Math.sin(t * 13) },
      },
    ];
  },
};

// 10. Koi Pond
const KOI_CARP_R = [1.8, 2.8, 3.4, 3.8, 3.9, 3.9, 3.7, 3.4, 3, 2.6, 2.2, 1.8, 1.4, 1.1, 0.9, 0.8];
const KOI_CARP_LEN = KOI_CARP_R.length + 5;
const KOI_CARP_PAL = (() => {
  const p: Record<string, { bg: string; fg: string; a: number }> = {
    w: { bg: "#f3eee5", fg: "#a59f94", a: 0.95 }, r: { bg: "#de3a2a", fg: "#6e140c", a: 0.95 }, k: { bg: "#1f1c1b", fg: "#6a6560", a: 0.95 },
    g: { bg: "#f2b52c", fg: "#7a5208", a: 0.95 }, l: { bg: "#f8d769", fg: "#8a6110", a: 0.95 }, e: { bg: "#120c0a", fg: "#5a504a", a: 0.97 },
    f: { bg: "#e6e2d8", fg: "#9a948a", a: 0.78 }, F: { bg: "#f5cc4f", fg: "#8a6110", a: 0.8 },
  };
  for (const k of "wrkgl") p[k.toUpperCase() + "_"] = { ...p[k]!, bg: shade(p[k]!.bg, -0.16) };
  return p;
})();
const KOI_CARP_KINDS: readonly { base: string; fin: string; spots: readonly (readonly [number, number, number, string])[] }[] = [
  { base: "w", fin: "f", spots: [[2, 0.6, 1.3, "r"], [5.5, 1.6, 1.9, "r"], [9.5, -1.3, 1.8, "r"], [13, 0.8, 1.2, "r"]] },
  { base: "w", fin: "f", spots: [[1, 0, 1.5, "r"], [3.5, -1.6, 1.9, "k"], [6, 1.2, 2.2, "r"], [8, 2, 1.6, "k"], [10, -1, 2, "r"], [12, -0.6, 1.6, "k"], [14.5, 0.4, 1.2, "k"]] },
  { base: "g", fin: "F", spots: [] },
];
const KOI_CARP_LOOPS: readonly (readonly [number, number, number, number, number, number])[] = [
  [0.74, 0.3, 0.15, 0.17, 1, 1], [0.26, 0.42, 0.13, 0.24, 1, -1], [0.56, 0.66, 0.2, 0.12, 1, -1],
];
function koiCarpPath(cols: number, rows: number, i: number, s: number): [number, number] {
  const [mx, my, rx, ry, k, dir] = KOI_CARP_LOOPS[i]!;
  return [cols * (mx + rx * Math.cos(s * k * dir + i * 2)), rows * (my + ry * Math.sin(s * dir + i * 2))];
}
function koiCarp(cols: number, rows: number, t: number, i: number): ProceduralSprite {
  const z = Math.min(0.75, Math.max(0.5, cols / 90));
  let s = t * (0.06 + i * 0.01);
  const spine: [number, number][] = [koiCarpPath(cols, rows, i, s)];
  for (let n = 0; spine.length < KOI_CARP_LEN && n < 20000; n++) {
    const q = koiCarpPath(cols, rows, i, s -= 0.002), [lx, ly] = spine[spine.length - 1]!;
    if (Math.hypot(q[0] - lx, q[1] - ly) >= z) spine.push(q);
  }
  const norm = spine.map((_, k) => {
    const [ax, ay] = spine[Math.max(0, k - 1)]!, [bx, by] = spine[Math.min(spine.length - 1, k + 1)]!, d = Math.hypot(ax - bx, ay - by) || 1;
    return [-(ay - by) / d, (ax - bx) / d] as const;
  });
  const xs = spine.map(p => p[0]), ys = spine.map(p => p[1]), ox = Math.min(...xs) - 6, oy = Math.min(...ys) - 6;
  const kind = KOI_CARP_KINDS[i]!, P = KOI_CARP_PAL;
  const swish = (u: number) => Math.sin(t * 3.2 + i * 2) * 1.3 * Math.max(0, u - 9) / 11;
  const paddle = 4.8 + 0.7 * Math.sin(t * 2.4 + i);
  return {
    x: ox, y: oy, w: Math.ceil(Math.max(...xs) - ox + 7), h: Math.ceil(Math.max(...ys) - oy + 7), key: i, shadow: "#0b3430",
    field: (gx, gy) => {
      const wx = ox + gx + 0.5, wy = oy + gy + 0.5;
      let u = 0, d = Infinity;
      spine.forEach(([px, py], j) => { const e = Math.hypot(wx - px, wy - py); if (e < d) { d = e; u = j; } });
      d /= z;
      const [nx, ny] = norm[u]!, dx = (wx - spine[u]![0]) / z, dy = (wy - spine[u]![1]) / z;
      const v = dx * nx + dy * ny - swish(u), av = Math.abs(v), seed = { sx: u + i * 40, sy: Math.round(v * 1.5) };
      if (u < KOI_CARP_R.length && av <= KOI_CARP_R[u]! && d <= KOI_CARP_R[u]! + 1) {
        if (u >= 1 && u <= 2 && Math.abs(av - 1.8) < 0.55) return { c: P.e!, ...seed };
        const spot = kind.spots.find(([su, sv, sr]) => Math.hypot(u - su, v - sv) < sr);
        let key = spot ? spot[3] : kind.base;
        if (kind.base === "g" && av < 0.9 && u > 1) key = "l";
        return { c: av > KOI_CARP_R[u]! - 0.8 ? P[key.toUpperCase() + "_"]! : P[key]!, ...seed };
      }
      if (u >= KOI_CARP_R.length) {
        const a = u - KOI_CARP_R.length + (u === spine.length - 1 ? Math.max(0, dy * nx - dx * ny) : 0);
        if (av <= 0.7 + Math.min(a, 4.5) * 0.5 && a <= 4 + av * 0.8 && !(a > 4 && av < (a - 4) * 1.4 + 0.5)) return { c: P[kind.fin]!, ...seed };
      }
      if (u >= 3 && u <= 8 && ((u - 5.5) / 2.2) ** 2 + ((av - paddle) / 1.6) ** 2 <= 1) return { c: P[kind.fin]!, ...seed };
      if (u >= 9 && u <= 12 && ((u - 10.5) / 1.3) ** 2 + ((av - 3) / 1.1) ** 2 <= 1) return { c: P[kind.fin]!, ...seed };
      return undefined;
    },
  };
}
const KOI_LILIES: readonly [number, number, number, number][] = [[0.8, 0.06, 4.2, 2.4], [0.95, 0.14, 6.5, 2], [0.99, 0.42, 5, 2.8], [0.01, 0.55, 5.5, 0.2], [0.2, 0.97, 4.8, -1.6], [0.04, 0.95, 6.5, -0.9], [0.97, 0.95, 5.5, -2.2]];
const KOI_LOTUS: readonly [number, number, number][] = [[0.82, 0.08, 3.2], [0.18, 0.87, 3.2]];
const KOI_LILY_PAL = {
  pad: { bg: "#5c9a43", fg: "#2c5520", a: 0.93 }, rim: { bg: "#3f7a31", fg: "#1d3d15", a: 0.93 }, vein: { bg: "#86c066", fg: "#3a6a2a", a: 0.93 },
  petal: { bg: "#f28bb8", fg: "#8a2d55", a: 0.95 }, inner: { bg: "#f9c3da", fg: "#a2466e", a: 0.95 }, heart: { bg: "#f6d03f", fg: "#7a5a08", a: 0.97 },
  shadow: { bg: "#0b3430", fg: "#0b3430", ch: "", a: 0.35 },
};
function koiLilyAt(x: number, y: number, cols: number, rows: number, t: number): ProceduralCell | undefined {
  for (const [fx, fy, r] of KOI_LOTUS) {
    const cx = fx * cols, cy = fy * rows, dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx * 0.5, dy) * 2, th = Math.atan2(dy, dx * 0.5);
    const p = r * (0.55 + 0.45 * Math.abs(Math.cos(4 * th + fx * 9))) * (1 + 0.07 * Math.sin(t * 0.8 + fx * 5));
    if (d < 0.9) return KOI_LILY_PAL.heart;
    if (d < p * 0.55) return KOI_LILY_PAL.inner;
    if (d < p) return KOI_LILY_PAL.petal;
  }
  for (const [fx, fy, r, notch] of KOI_LILIES) {
    const cx = fx * cols, cy = fy * rows, dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx * 0.5, dy) * 2;
    if (d > r) continue;
    const th = Math.atan2(dy, dx * 0.5), off = Math.abs(((th - notch) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    if (off < 0.3 && d > 0.4) continue;
    if (d > r - 0.8) return KOI_LILY_PAL.rim;
    const spoke = Math.abs(((((th - notch) * 11 / (Math.PI * 2)) % 1) + 1) % 1 - 0.5);
    return d < 0.8 || (d > 1.2 && spoke > 0.5 - 0.35 / d) ? KOI_LILY_PAL.vein : KOI_LILY_PAL.pad;
  }
  return undefined;
}

export const koiPondScene: ProceduralScene = {
  id: "koi-pond",
  name: "Koi Pond",
  tagline: "Serene pond with ornamental carp swimming among water lilies",
  cell: (x, y, cols, rows, t) => {
    const lily = koiLilyAt(x, y, cols, rows, t);
    if (lily) return lily;
    if (koiLilyAt(x - 1, y - 1, cols, rows, t)) return KOI_LILY_PAL.shadow;
    if (hash(x - Math.floor(t * 0.3), y + Math.floor(t * 0.12), 77) < 0.004) return { bg: "#f4b6cc", fg: "#8a2d55", a: 0.85 };
    for (let i = 0; i < 5; i++) {
      const rr = (t * 1.6 + i * 3.7) % 10, d = Math.hypot((x - hash(i, 61) * cols) * 0.5, y - hash(i, 62) * rows) * 2;
      if ((Math.abs(d - rr) < 0.5 || Math.abs(d - rr + 2.2) < 0.5) && hash(x, y, 63) < 0.7) return { ch: "o", fg: "#d6f1e8", a: 0.4 * (1 - rr / 10) };
    }
    const deep = ell(x, y, cols * 0.5, rows * 0.45, cols * 0.2, rows * 0.28);
    if (deep < 1) return { bg: "#0d3a38", fg: "#0d3a38", ch: "", a: 0.45 * (1 - deep) };
    if (hash(x, y, 71) < 0.03) return { ch: "abcdeghkmnopqtu_.*"[Math.floor(hash(x, y, 72) * 18)], fg: "#cfeee6", a: 0.2 };
    return twinkle(x, y, t, "#e8fbf6", 0.004);
  },
  sprites: (cols, rows, t) => [0, 1, 2].map(i => koiCarp(cols, rows, t, i)),
};

// 11. Honu Lagoon
const HONU_REEF_COLORS = [
  "#2b9ee6","#53ddf9","#06aceb","#69ebfa","#e1f6f5","#21bbef","#3074ee","#007cef","#0499eb","#05befa",
  "#1ccaf9","#01b5fa","#0281e1","#7c4d36","#033a9a","#40b9cd","#e5b77f","#01adf9","#0188f4","#946a62",
  "#cbd5ac","#2561a5","#101b29","#b7a976","#35d4f9","#043a78","#01a0f9","#f4e9bf","#0163da","#01a6f8",
  "#0191f8","#874fe2","#0142a9","#6e7cc9","#015ad2","#016ce4","#0198f8","#f3688c","#0488b8","#116c66",
  "#9bf4f7","#0155ca","#014ec1","#f6cc38","#373b95","#5fc04f","#08508b","#0148b7","#ee7e3a","#163b5d",
  "#a8a7e3","#3b9662","#555cba","#f6e5ab","#97df4f","#1f2d89",
];
const HONU_REEF_W = 97, HONU_REEF_H = 47;
const HONU_THINGS = {
  turtle: { c: 24, r: 10, art: [".........................", ".......ppjMMNN.....pKpK..", ".....pMMjnddjdj..pRPmRPN.", "...NMdndjddd4dddNRPkmDDp.", "..jdgdk44ddjmDPSgRDkRRR..", ".jndddddNPDDJJSSRrRRkp...", "..ddpPRRSSDDNSRrnnpC.....", ".DnRRRRgkDDDNrrRkPSSC....", "..KnngDDDDDngggp.DDJRp...", ".....kDkDPk.......NJSR...", "....PDPjDR.........nDPN..", "...RPDnRK...........gDN..", "..P..Rp..............pC..", "........................."] },
  clownA: { c: 11, r: 20, art: ["........", "..dmMP..", ".M4M44M.", ".ddM4dM.", "........"] },
  clownB: { c: 16, r: 24, art: [".........", "....pM...", ".LlMM4MC.", ".mM4MM4M.", "........."] },
  tang: { c: 26, r: 27, art: [".........", "...pp....", ".y6eeeFP.", ".66666pH.", "........."] },
  yellow: { c: 48, r: 20, art: ["............", "........HP..", ".......HHHH.", "...DH...Hj..", "..HHHH......", "...HH...lHH.", "........HHH.", "............"] },
  crab: { c: 29, r: 42, art: ["BmgjM.", ".MMMdg", "M..jM.", "j....."] },
  idolA: { c: 61, r: 19, art: [".......", "....4..", "..mR...", ".4mrmH.", ".4m4m..", "..m4...", "......."] },
  idolB: { c: 63, r: 25, art: ["........", "...4....", "..m.....", ".4m.mH..", ".rm4N...", "..m44...", "........"] },
  star: { c: 3, r: 35, art: ["............", ".....M......", "............", "..MMMMMMM...", "..MMMMHM....", "....MMMM....", "...MM..MM...", "............", "............"] },
  weedL: { c: 0, r: 10, art: ["........", "........", ".P......", ".JN.....", "..J.....", "...J....", "...J.D..", "..J..J..", ".JD.JJ..", ".JD.P.DN", "..PPD..S", "..JJ..JS", ".JP..DS.", ".PD.DS..", ".P.DJJ.S", "...P.P.S", "....D.JJ", "......J.", "........", "........", "........", "........", "........", "........"] },
  weedM: { c: 16, r: 31, art: ["..........", "..........", "..J.......", "..J..DJ...", "...J..S...", "..JJ.JP...", "..J.JP....", "..P.DD.D..", "...P.P.J..", "....D.PD..", ".....DP..."] },
  weedR: { c: 87, r: 17, art: ["..........", "..........", "..........", "..........", "......J.J.", "....J.PJJ.", "....J..JD.", ".....JJ.J.", "......J.J.", "......P...", "..........", "..........", "..........", ".........."] },
};
const HONU_KEYS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const HONU_PAL = Object.fromEntries(HONU_REEF_COLORS.map((c, i) => [HONU_KEYS[i]!, { bg: c, fg: shade(c, -0.1), a: 0.96 }]));
function honuPlaceOf(th: { c: number; r: number }, cols: number, rows: number): [number, number] {
  return [th.c * cols / HONU_REEF_W, th.r * rows / HONU_REEF_H];
}
function honuNudge(art: readonly string[], pick: (x: number, y: number, k: string) => boolean, dx: number, dy: number): string[] {
  const g = art.map(r => [...r]), moved: [number, number, string][] = [];
  art.forEach((row, y) => [...row].forEach((k, x) => { if (k !== "." && pick(x, y, k)) { moved.push([x + dx, y + dy, k]); g[y]![x] = "."; } }));
  for (const [x, y, k] of moved) if (g[y]?.[x] !== undefined) g[y]![x] = k;
  return g.map(r => r.join(""));
}
function honuParts(art: readonly string[]): { dx: number; dy: number; art: string[] }[] {
  const seen = new Set<string>(), out: { dx: number; dy: number; art: string[] }[] = [];
  art.forEach((row, y) => [...row].forEach((k, x) => {
    if (k === "." || seen.has(`${x},${y}`)) return;
    const cells: [number, number][] = [], todo: [number, number][] = [[x, y]];
    seen.add(`${x},${y}`);
    while (todo.length) {
      const [cx, cy] = todo.pop()!;
      cells.push([cx, cy]);
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]])
        if ((art[ny]?.[nx] ?? ".") !== "." && !seen.has(`${nx},${ny}`)) { seen.add(`${nx},${ny}`); todo.push([nx, ny]); }
    }
    const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]), x0 = Math.min(...xs), y0 = Math.min(...ys);
    const own = shape(Math.max(...xs) - x0 + 1, Math.max(...ys) - y0 + 1, (px, py) => (cells.some(([a, b]) => a === px + x0 && b === py + y0) ? art[py + y0]![px + x0]! : "."));
    if (cells.length > 2) out.push({ dx: x0, dy: y0, art: own });
  }));
  return out;
}
function honuWag(art: readonly string[], facesRight: boolean): string[][] {
  const w = art[0]!.length, tail = (x: number) => (facesRight ? x < w * 0.36 : x >= w * 0.64);
  return [art as string[], honuNudge(art, x => tail(x), 0, -1), art as string[], honuNudge(art, x => tail(x), 0, 1)];
}
function honuBoth(frames: readonly string[][]): [string[][], string[][]] {
  return [frames as string[][], frames.map(flip)];
}
const HONU_FRAMES = {
  clownA: honuBoth(honuWag(HONU_THINGS.clownA.art, true)),
  clownB: honuBoth(honuWag(HONU_THINGS.clownB.art, true)),
  tang: honuBoth(honuWag(HONU_THINGS.tang.art, false)),
  idolA: honuBoth(honuWag(HONU_THINGS.idolA.art, false)),
  idolB: honuBoth(honuWag(HONU_THINGS.idolB.art, false)),
  yellow: honuParts(HONU_THINGS.yellow.art).map(p => ({ ...p, frames: honuWag(p.art, false) })),
  turtle: (() => {
    const a = HONU_THINGS.turtle.art, fl = (_x: number, y: number) => y >= a.length * 0.64;
    return [a, honuNudge(a, fl, -1, 0), honuNudge(a, fl, -1, 1), honuNudge(a, fl, 0, 1)];
  })(),
  crab: (() => {
    const a = HONU_THINGS.crab.art, h = a.length;
    return [a, honuNudge(honuNudge(a, (_x, y) => y === h - 1, 1, 0), (_x, y) => y === 0, 0, -1), a, honuNudge(a, (_x, y) => y === h - 1, -1, 0)];
  })(),
  star: (() => { const a = HONU_THINGS.star.art; return [a, a, a, honuNudge(a, (_x, y) => y <= 1, 0, -1)]; })(),
};
function honuSwaying(art: readonly string[], t: number, i: number): { w: number; h: number; field: ProceduralSprite["field"] } {
  return {
    w: art[0]!.length + 4, h: art.length,
    field: (gx, gy) => {
      const off = Math.round(Math.sin(t * 1.2 + gy * 0.45 + i * 2) * 1.3 * (art.length - gy) / art.length);
      const k = art[gy]?.[gx - 2 - off];
      return k && k !== "." ? { c: HONU_PAL[k]!, sx: gx - 2 - off, sy: gy } : undefined;
    },
  };
}

export const honuLagoonScene: ProceduralScene = {
  id: "honu-lagoon",
  name: "Honu Lagoon",
  tagline: "Tropical coral reef with sea turtle, clownfish and anemones",
  size: 18,
  cell: (x, y, cols, rows, t) => {
    for (let i = 0; i < 9; i++) {
      if (x === Math.floor(hash(i, 31) * cols) + Math.round(Math.sin(t + i))
        && y === Math.round(rows - ((t * 1.8 * (1 + hash(i, 32)) + hash(i, 33) * rows) % (rows + 4))))
        return { ch: "o", fg: "#e8fbff", a: 0.65 };
    }
    if (rising(x, y, t, 0.5, 0.008)) return { ch: ".", fg: "#cdeefa", a: 0.35 };
    if (x > cols * 0.82 && y % 2 === 0 && hash(x, y, 90) < 0.55) return { ch: "-", fg: "#e8fbff", a: 0.14 };
    return twinkle(x, y, t, "#e8fbff", 0.006);
  },
  sprites: (cols, rows, t) => {
    const T = HONU_THINGS, F = HONU_FRAMES, out: ProceduralSprite[] = [];
    const add = (art: readonly string[], x: number, y: number, key: number, extra: Partial<ProceduralSprite> = {}) => out.push({ art, pal: HONU_PAL, key, x, y, ...extra });
    const swim = (name: keyof typeof T, v: number, left: boolean) => {
      const w = T[name].art[0]!.length, [x] = honuPlaceOf(T[name], cols, rows), f = (x + w / 2 + w) / (cols + w * 2);
      const run = drift(cols, left ? 1 - f : f, t, v, w);
      return (left ? cols - run : run) - w / 2;
    };
    (["weedL", "weedM", "weedR"] as const).forEach((n, i) => { const [x, y] = honuPlaceOf(T[n], cols, rows); out.push({ ...honuSwaying(T[n].art, t, i), x: x - 2, y, key: 150 + i }); });
    const [sx, sy] = honuPlaceOf(T.star, cols, rows);
    add(frame(F.star, t, 0.6), sx, sy, 7);
    const [, ty] = honuPlaceOf(T.turtle, cols, rows);
    add(frame(F.turtle, t, 2.2), swim("turtle", 0.8, false), ty + Math.sin(t * 0.6) * 0.8, 1, { shadow: "#0b3d7a" });
    const [, yy] = honuPlaceOf(T.yellow, cols, rows), yx = swim("yellow", 1.3, true);
    F.yellow.forEach((p, i) => add(frame(p.frames, t, 4, i * 1.3), yx + p.dx + Math.sin(t * 0.9 + i * 2) * 0.8, yy + p.dy + Math.sin(t * 1.1 + i) * 0.7, 20 + i));
    const [, gy] = honuPlaceOf(T.tang, cols, rows);
    add(frame(F.tang[0], t, 5), swim("tang", 2, true), gy + Math.sin(t * 1.4) * 0.5, 3);
    (["clownA", "clownB"] as const).forEach((n, i) => {
      const [x, y] = honuPlaceOf(T[n], cols, rows), a = t * 0.7 + i * 2.2;
      add(frame(F[n][Math.cos(a) < 0 ? 1 : 0]!, t, 5, i * 2), x + Math.sin(a) * 2.5, y + Math.sin(t * 1.3 + i) * 0.6, 4 + i);
    });
    (["idolA", "idolB"] as const).forEach((n, i) => {
      const [x, y] = honuPlaceOf(T[n], cols, rows), a = t * 0.45 + i * 1.7;
      add(frame(F[n][Math.cos(a) > 0 ? 1 : 0]!, t, 3, i * 2), x + Math.sin(a) * 1.5, y + Math.sin(t * 0.8 + i) * 0.8, 8 + i);
    });
    const [cx, cy] = honuPlaceOf(T.crab, cols, rows);
    add(frame(F.crab, t, 6), cx + Math.sin(t * 0.9) * 4, cy, 6);
    return out;
  },
};

// All 11 curated procedural scenes
export const CLAUDE_THEME_SCENES: Readonly<Record<string, ProceduralScene>> = Object.freeze({
  moonlit: moonlitScene,
  "cloud-drift": cloudDriftScene,
  "honu-lagoon": honuLagoonScene,
  "koi-pond": koiPondScene,
  jellyfish: jellyfishScene,
  "lantern-night": lanternNightScene,
  fireflies: firefliesScene,
  "neon-rain": neonRainScene,
  "sakura-dusk": sakuraDuskScene,
  "snow-cabin": snowCabinScene,
  "star-voyage": starVoyageScene,
});

export function isClaudeThemeScene(id: string): boolean {
  return Object.hasOwn(CLAUDE_THEME_SCENES, id);
}


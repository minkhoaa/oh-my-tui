// Procedural scene geometry, palettes, sprites, and motion trajectories
// adapted to terminal cell aspect ratios and viewport dimensions with selective readability veils.

import type { ColorMode } from "../capabilities/index.ts";

export interface ProceduralCell {
  bg?: string;
  fg?: string;
  ch?: string;
  a: number;
  floor?: number;
}

export interface ProceduralGlow {
  r: number;
  color: string;
  a: number;
}

export interface ProceduralSprite {
  x: number;
  y: number;
  key: number;
  art?: readonly string[];
  pal?: Record<string, { bg?: string; fg?: string; ch?: string; a: number }>;
  field?: (gx: number, gy: number) => { c: { bg?: string; fg?: string; ch?: string; a: number }; sx?: number; sy?: number } | undefined;
  w?: number;
  h?: number;
  a?: number;
  shadow?: string | boolean;
  halo?: string;
  glow?: ProceduralGlow;
}

export interface ProceduralScene {
  id: string;
  name: string;
  tagline: string;
  size?: number;
  cell?: (x: number, y: number, cols: number, rows: number, t: number) => ProceduralCell | undefined;
  sprites?: (cols: number, rows: number, t: number) => ProceduralSprite[];
}

export interface ProceduralRenderOptions {
  width: number;
  height: number;
  timeMs: number;
  speed?: number;
  intensity?: "low" | "medium" | "high";
  dimming?: "dim" | "subtle" | "vibrant";
  reducedMotion?: boolean;
  asciiOnly?: boolean;
  textureScale?: number;
  colorMode?: ColorMode;
  contentBounds?: readonly [number, number]; // [leftCol, rightCol] for selective readability veil
  backdropBg?: readonly [number, number, number]; // default terminal backdrop [r, g, b]
}

// ==========================================
// Core Helper Kit
// ==========================================

export const GLYPHS = "St%;:X";
export const LOOSE = ".:',o";

export function hash(a: number, b: number, c = 0): number {
  let h = (Math.imul(Math.floor(a), 374761393) ^ Math.imul(Math.floor(b), 668265263) ^ Math.imul(Math.floor(c), 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function glyph(set: string, x: number, y: number, t: number): string {
  const idx = Math.floor(hash(x, y, Math.floor(t * 1.2 + hash(y, x) * 7)) * set.length);
  return set[Math.max(0, Math.min(set.length - 1, idx))]!;
}

export function ell(x: number, y: number, cx: number, cy: number, rx: number, ry: number): number {
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
}

export function drift(cols: number, f: number, t: number, v: number, w: number): number {
  const span = cols + w * 2;
  return ((((f * span + t * v) % span) + span) % span) - w;
}

export function near(x: number, y: number, fg: string, a = 0.3, odds = 0.5): ProceduralCell | undefined {
  return hash(x, y, 3) < odds ? { fg, a } : undefined;
}

export function twinkle(x: number, y: number, t: number, fg: string, odds: number): ProceduralCell | undefined {
  const s = hash(x, y, 9);
  if (s < odds) {
    return {
      ch: s < odds / 3 ? "+" : ".",
      fg,
      a: 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * (1 + s * 200) + s * 1000)),
    };
  }
  return undefined;
}

export function rising(x: number, y: number, t: number, v: number, odds: number): boolean {
  return hash(x, Math.floor(y + t * v), 11) < odds;
}

export function sketch(w: number, h: number, parts: readonly (readonly [number, number, string])[]): string[] {
  const g = Array.from({ length: h }, () => Array(w).fill("."));
  for (const [r, c, s] of parts) {
    [...s].forEach((ch, i) => {
      if (ch !== " " && g[r]?.[c + i] !== undefined) g[r]![c + i] = ch;
    });
  }
  return g.map(r => r.join(""));
}

export function shape(w: number, h: number, at: (x: number, y: number) => string): string[] {
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => at(x, y)).join(""));
}

export function flip(art: readonly string[]): string[] {
  return art.map(r => [...r].reverse().join(""));
}

export function frame<T>(frames: readonly T[], t: number, rate: number, phase = 0): T {
  const idx = Math.floor(t * rate + phase) % frames.length;
  return frames[(idx + frames.length) % frames.length]!;
}

export function hexToRgb(c: string): [number, number, number] {
  if (c.startsWith("#") && c.length === 7) {
    return [
      parseInt(c.slice(1, 3), 16),
      parseInt(c.slice(3, 5), 16),
      parseInt(c.slice(5, 7), 16),
    ];
  }
  return [0, 0, 0];
}

export function rgbToHex(rgb: readonly [number, number, number]): string {
  return "#" + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

export function mixRgb(a: readonly [number, number, number], b: readonly [number, number, number], k: number): [number, number, number] {
  const factor = Math.max(0, Math.min(1, k));
  return [
    Math.round(a[0] + (b[0] - a[0]) * factor),
    Math.round(a[1] + (b[1] - a[1]) * factor),
    Math.round(a[2] + (b[2] - a[2]) * factor),
  ];
}

export function shade(c: string, k: number): string {
  const [r, g, b] = hexToRgb(c);
  const target: [number, number, number] = k > 0 ? [255, 255, 255] : [0, 0, 0];
  return rgbToHex(mixRgb([r, g, b], target, Math.abs(k)));
}

export function tint(bg: string, fg: string, alphas: readonly number[]): Record<string, { bg: string; fg: string; a: number }> {
  const out: Record<string, { bg: string; fg: string; a: number }> = {};
  alphas.forEach((a, i) => {
    out[String(i + 1)] = { bg, fg, a };
  });
  return out;
}

const halos = new WeakMap<readonly string[], readonly [number, number][]>();
export function haloOf(art: readonly string[]): readonly [number, number][] {
  let cached = halos.get(art);
  if (!cached) {
    const h = art.length, w = art[0]?.length ?? 0;
    const on = (x: number, y: number) => (art[y]?.[x] ?? ".") !== ".";
    const out: [number, number][] = [];
    for (let y = -1; y <= h; y++) {
      for (let x = -1; x <= w; x++) {
        if (!on(x, y) && [-1, 0, 1].some(i => [-1, 0, 1].some(j => on(x + i, y + j))) && hash(x + 50, y + 50, 5) < 0.45) {
          out.push([x, y]);
        }
      }
    }
    cached = out;
    halos.set(art, out);
  }
  return cached;
}

// Selective readability veil helper: preserves margins at 1.0, gently attenuates reading column to 0.25
export const DIM = 0.25;
export function keepVeil(col: readonly [number, number] | undefined, x: number): number {
  if (!col) return 1;
  const inside = Math.min(x - col[0], col[1] - x);
  return 1 - (1 - DIM) * Math.max(0, Math.min(1, (inside + 1) / 3));
}

// ==========================================
// Procedural Scenes Port
// ==========================================


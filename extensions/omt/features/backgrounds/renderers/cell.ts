import type { ColorMode } from "../capabilities/index.ts";
import type { ChafaQuality, ChafaSymbolSet } from "./chafa.ts";

export type { ChafaQuality, ChafaSymbolSet };

let chafaRendererPromise: Promise<typeof import("./chafa.ts")> | null = null;
let chafaRenderer: typeof import("./chafa.ts") | null = null;

/**
 * Lazy loads the Chafa WASM renderer module on demand.
 * Startup remains untouched; only called when raster backgrounds are rendered.
 */
export async function loadChafaRenderer(): Promise<typeof import("./chafa.ts")> {
  if (chafaRenderer) return chafaRenderer;
  if (!chafaRendererPromise) {
    chafaRendererPromise = (async () => {
      const mod = await import("./chafa.ts");
      await mod.initChafa();
      chafaRenderer = mod;
      return mod;
    })();
  }
  return chafaRendererPromise;
}

export function getActiveChafaRenderer(): typeof import("./chafa.ts") | null {
  return chafaRenderer;
}

export interface LoadedBackgroundLike {
  metadata: {
    id?: string;
    width: number;
    height: number;
    frameCount: number;
    frameMs: number;
    loops?: number;
  };
  pixels: Buffer;
}

export interface ImageCellRenderSettings {
  fit?: "cover" | "contain" | "center" | "tile";
  textureScale?: number;
  opacity?: number;
  contrast?: number;
  dimming?: "dim" | "subtle" | "vibrant";
  intensity?: "low" | "medium" | "high";
  speed?: number;
  fps?: number;
  readability?: "balanced" | "strict";
  quality?: ChafaQuality;
  symbols?: ChafaSymbolSet;
}

export type CellRenderMode = "halfblock" | "braille" | "ascii";

export function validCellViewport(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width > 0 && height > 0 && width * height <= 80_000;
}

// ==========================================
// ANSI 16 Color Mapping Table
// ==========================================

const ANSI_16_COLORS: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 0, 30, 40],        // Black
  [128, 0, 0, 31, 41],      // Red
  [0, 128, 0, 32, 42],      // Green
  [128, 128, 0, 33, 43],    // Yellow
  [0, 0, 128, 34, 44],      // Blue
  [128, 0, 128, 35, 45],    // Magenta
  [0, 128, 128, 36, 46],    // Cyan
  [192, 192, 192, 37, 47],  // White (Light gray)
  [128, 128, 128, 90, 100], // Bright Black (Dark gray)
  [255, 0, 0, 91, 101],     // Bright Red
  [0, 255, 0, 92, 102],     // Bright Green
  [255, 255, 0, 93, 103],   // Bright Yellow
  [0, 0, 255, 94, 104],     // Bright Blue
  [255, 0, 255, 95, 105],   // Bright Magenta
  [0, 255, 255, 96, 106],   // Bright Cyan
  [255, 255, 255, 97, 107], // Bright White
];

/**
 * Finds closest 16-color ANSI match using Euclidean distance.
 */
export function rgbToAnsi16(r: number, g: number, b: number): { fg: number; bg: number } {
  let closestDist = Infinity;
  let best = ANSI_16_COLORS[0]!;
  for (const entry of ANSI_16_COLORS) {
    const dr = r - entry[0];
    const dg = g - entry[1];
    const db = b - entry[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < closestDist) {
      closestDist = dist;
      best = entry;
      if (dist === 0) break;
    }
  }
  return { fg: best[3], bg: best[4] };
}

/**
 * Maps RGB to xterm 256-color palette index.
 */
export function rgbToAnsi256(r: number, g: number, b: number): number {
  const cr = Math.max(0, Math.min(255, Math.round(r)));
  const cg = Math.max(0, Math.min(255, Math.round(g)));
  const cb = Math.max(0, Math.min(255, Math.round(b)));

  // Grayscale ramp check
  if (cr === cg && cg === cb) {
    if (cr < 8) return 16;
    if (cr > 248) return 231;
    return Math.max(232, Math.min(255, Math.round((cr - 8) / 10) + 232));
  }

  // 6x6x6 color cube
  const rIdx = cr < 48 ? 0 : cr < 115 ? 1 : Math.min(5, Math.floor((cr - 35) / 40));
  const gIdx = cg < 48 ? 0 : cg < 115 ? 1 : Math.min(5, Math.floor((cg - 35) / 40));
  const bIdx = cb < 48 ? 0 : cb < 115 ? 1 : Math.min(5, Math.floor((cb - 35) / 40));
  return 16 + 36 * rIdx + 6 * gIdx + bIdx;
}

/**
 * Formats character with foreground color according to terminal color mode.
 */
export function formatCellFg(
  r: number,
  g: number,
  b: number,
  text: string,
  mode: ColorMode = "truecolor",
): string {
  const cr = Math.max(0, Math.min(255, Math.round(r)));
  const cg = Math.max(0, Math.min(255, Math.round(g)));
  const cb = Math.max(0, Math.min(255, Math.round(b)));

  if (mode === "monochrome") {
    return text;
  }
  if (mode === "16color") {
    const { fg } = rgbToAnsi16(cr, cg, cb);
    return `\x1b[${fg}m${text}\x1b[0m`;
  }
  if (mode === "256color") {
    const code = rgbToAnsi256(cr, cg, cb);
    return `\x1b[38;5;${code}m${text}\x1b[0m`;
  }
  return `\x1b[38;2;${cr};${cg};${cb}m${text}\x1b[0m`;
}

/**
 * Formats character with background color according to terminal color mode.
 */
export function formatCellBg(
  r: number,
  g: number,
  b: number,
  text: string,
  mode: ColorMode = "truecolor",
): string {
  const cr = Math.max(0, Math.min(255, Math.round(r)));
  const cg = Math.max(0, Math.min(255, Math.round(g)));
  const cb = Math.max(0, Math.min(255, Math.round(b)));

  if (mode === "monochrome") {
    return text;
  }
  if (mode === "16color") {
    const { bg } = rgbToAnsi16(cr, cg, cb);
    return `\x1b[${bg}m${text}\x1b[0m`;
  }
  if (mode === "256color") {
    const code = rgbToAnsi256(cr, cg, cb);
    return `\x1b[48;5;${code}m${text}\x1b[0m`;
  }
  return `\x1b[48;2;${cr};${cg};${cb}m${text}\x1b[0m`;
}

/**
 * Formats character with both foreground and background colors in one escape sequence.
 */
export function formatCellFgBg(
  fr: number,
  fg: number,
  fb: number,
  br: number,
  bg: number,
  bb: number,
  text: string,
  mode: ColorMode = "truecolor",
): string {
  const cfr = Math.max(0, Math.min(255, Math.round(fr)));
  const cfg = Math.max(0, Math.min(255, Math.round(fg)));
  const cfb = Math.max(0, Math.min(255, Math.round(fb)));
  const cbr = Math.max(0, Math.min(255, Math.round(br)));
  const cbg = Math.max(0, Math.min(255, Math.round(bg)));
  const cbb = Math.max(0, Math.min(255, Math.round(bb)));

  if (mode === "monochrome") {
    return text;
  }
  if (mode === "16color") {
    const fgCode = rgbToAnsi16(cfr, cfg, cfb).fg;
    const bgCode = rgbToAnsi16(cbr, cbg, cbb).bg;
    return `\x1b[${fgCode};${bgCode}m${text}\x1b[0m`;
  }
  if (mode === "256color") {
    const fgCode = rgbToAnsi256(cfr, cfg, cfb);
    const bgCode = rgbToAnsi256(cbr, cbg, cbb);
    return `\x1b[38;5;${fgCode};48;5;${bgCode}m${text}\x1b[0m`;
  }
  return `\x1b[38;2;${cfr};${cfg};${cfb};48;2;${cbr};${cbg};${cbb}m${text}\x1b[0m`;
}

// Backward-compatible color helpers matching preset shared background exports
export function formatRgb(r: number, g: number, b: number, text: string): string {
  return formatCellFg(r, g, b, text, "truecolor");
}

export function formatRgbBg(r: number, g: number, b: number, text: string): string {
  return formatCellBg(r, g, b, text, "truecolor");
}

export function applyDimming(
  color: readonly [number, number, number],
  dimming: "dim" | "subtle" | "vibrant" = "subtle",
): [number, number, number] {
  let factor = 0.65;
  if (dimming === "dim") factor = 0.35;
  else if (dimming === "vibrant") factor = 1.0;

  return [
    Math.round(Math.max(0, Math.min(255, color[0] * factor))),
    Math.round(Math.max(0, Math.min(255, color[1] * factor))),
    Math.round(Math.max(0, Math.min(255, color[2] * factor))),
  ];
}

export function lerpColor(
  c1: readonly [number, number, number],
  c2: readonly [number, number, number],
  t: number,
): [number, number, number] {
  const clampedT = Math.max(0, Math.min(1, t));
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * clampedT),
    Math.round(c1[1] + (c2[1] - c1[1]) * clampedT),
    Math.round(c1[2] + (c2[2] - c1[2]) * clampedT),
  ];
}

// ==========================================
// Raster-to-Cell Sampling & Rendering
// ==========================================

export interface Sampler {
  sample(x: number, y: number): [number, number, number];
}

/**
 * Creates a pixel sampler for a loaded background frame with fit, contrast, and opacity applied.
 */
export function createPixelSampler(
  asset: LoadedBackgroundLike,
  width: number,
  targetHeight: number,
  settings: ImageCellRenderSettings,
  frame = 0,
): Sampler {
  const { metadata: m, pixels } = asset;
  const fit = settings.fit ?? "cover";
  const textureScale = typeof settings.textureScale === "number" && Number.isFinite(settings.textureScale)
    ? Math.max(0.25, Math.min(2, settings.textureScale)) : 1;
  const scale = textureScale * (
    fit === "cover"
      ? Math.max(width / m.width, targetHeight / m.height)
      : fit === "contain"
        ? Math.min(width / m.width, targetHeight / m.height)
        : 1);

  const offsetX = (width - m.width * scale) / 2;
  const offsetY = (targetHeight - m.height * scale) / 2;
  // Preserve 1x sampling; resized textures sample pixel centers so thin centered
  // images do not disappear at their top edge.
  const center = textureScale === 1 ? 0 : 0.5;
  const opacity = settings.opacity ?? 0.65;
  const dimmingFactor =
    settings.dimming === "dim" ? 0.35 : settings.dimming === "vibrant" ? 1.0 : 0.65;
  const factor = opacity * dimmingFactor;
  const contrast = settings.contrast ?? 1.0;
  const start = frame * m.width * m.height * 4;

  return {
    sample(x: number, y: number): [number, number, number] {
      let sx = Math.floor((x + center - offsetX) / scale);
      let sy = Math.floor((y + center - offsetY) / scale);
      if (fit === "tile") {
        sx = ((Math.floor((x + center) / textureScale) % m.width) + m.width) % m.width;
        sy = ((Math.floor((y + center) / textureScale) % m.height) + m.height) % m.height;
      }
      if (sx < 0 || sy < 0 || sx >= m.width || sy >= m.height) {
        return [0, 0, 0];
      }
      const i = start + (sy * m.width + sx) * 4;
      const alpha = (pixels[i + 3] ?? 255) / 255;
      const r = Math.round(
        Math.max(0, Math.min(255, ((pixels[i] ?? 0) - 128) * contrast + 128)) * factor * alpha,
      );
      const g = Math.round(
        Math.max(0, Math.min(255, ((pixels[i + 1] ?? 0) - 128) * contrast + 128)) * factor * alpha,
      );
      const b = Math.round(
        Math.max(0, Math.min(255, ((pixels[i + 2] ?? 0) - 128) * contrast + 128)) * factor * alpha,
      );
      return [r, g, b];
    },
  };
}

/**
 * Primary cell renderer: renders uploaded images into half-block character cells.
 * Supports truecolor, 256-color, 16-color, and monochrome color modes.
 */
export function renderHalfBlock(
  sampler: Sampler,
  width: number,
  height: number,
  colorMode: ColorMode = "truecolor",
  ascii = false,
): string[] {
  if (!validCellViewport(width, height)) return [];
  return Array.from({ length: height }, (_, y) => {
    let row = "";
    for (let x = 0; x < width; x++) {
      const a = sampler.sample(x, y * 2);
      const b = sampler.sample(x, y * 2 + 1);
      if (ascii || colorMode === "monochrome") {
        const gray = (a[0] + a[1] + a[2] + b[0] + b[1] + b[2]) / (255 * 6);
        const char = " .:-=+*#%@"[Math.min(9, Math.floor(gray * 10))]!;
        row += formatCellFg(a[0], a[1], a[2], char, colorMode);
      } else {
        row += formatCellFgBg(a[0], a[1], a[2], b[0], b[1], b[2], "▀", colorMode);
      }
    }
    return row;
  });
}

/**
 * Unicode Braille cell renderer (2x4 dot matrix per cell, U+2800..U+28FF).
 * Delivers fine sub-cell resolution for line art, particle contours, and high-density artwork.
 */
export function renderBraille(
  sampler: Sampler,
  width: number,
  height: number,
  colorMode: ColorMode = "truecolor",
  threshold = 30,
): string[] {
  if (!validCellViewport(width, height)) return [];
  // Braille dot bitmask positions (standard Unicode mapping):
  // (0,0): 0x01, (0,1): 0x02, (0,2): 0x04, (0,3): 0x40
  // (1,0): 0x08, (1,1): 0x10, (1,2): 0x20, (1,3): 0x80
  const DOT_MASKS: readonly [number, number, number][] = [
    [0, 0, 0x01],
    [0, 1, 0x02],
    [0, 2, 0x04],
    [0, 3, 0x40],
    [1, 0, 0x08],
    [1, 1, 0x10],
    [1, 2, 0x20],
    [1, 3, 0x80],
  ];

  return Array.from({ length: height }, (_, cy) => {
    let row = "";
    for (let cx = 0; cx < width; cx++) {
      let mask = 0;
      let totalR = 0, totalG = 0, totalB = 0, activeDots = 0;

      for (const [dx, dy, bit] of DOT_MASKS) {
        const px = cx * 2 + dx;
        const py = cy * 4 + dy;
        const rgb = sampler.sample(px, py);
        const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
        if (lum > threshold) {
          mask |= bit;
          totalR += rgb[0];
          totalG += rgb[1];
          totalB += rgb[2];
          activeDots++;
        }
      }

      if (mask === 0 || activeDots === 0) {
        row += " ";
      } else {
        const char = String.fromCharCode(0x2800 + mask);
        const avgR = Math.round(totalR / activeDots);
        const avgG = Math.round(totalG / activeDots);
        const avgB = Math.round(totalB / activeDots);
        row += formatCellFg(avgR, avgG, avgB, char, colorMode);
      }
    }
    return row;
  });
}

/**
 * Universal image-to-cell rendering function.
 * Converts uploaded PNG/GIF/WebP/JPEG into bounded terminal-cell representations.
 * Uses Chafa WASM as the default raster converter when loaded, with bounded frame caching.
 * Preserves full backward compatibility with existing image-background tests.
 */
export function renderImageBackground(
  asset: LoadedBackgroundLike,
  width: number,
  height: number,
  settings: ImageCellRenderSettings,
  ascii = false,
  frame = 0,
  colorMode: ColorMode = "truecolor",
  cellMode: CellRenderMode = "halfblock",
): string[] {
  if (!validCellViewport(width, height)) return [];
  if (cellMode === "ascii") ascii = true;

  // Bounded frame cache check
  const assetId = asset.metadata?.id ?? "";
  const cacheKey = chafaRenderer && assetId
    ? chafaRenderer.buildFrameCacheKey({
        assetId,
        width,
        height,
        frame,
        colorMode,
        cellMode,
        symbols: settings.symbols,
        quality: settings.quality,
        fit: settings.fit,
        textureScale: settings.textureScale,
        opacity: settings.opacity,
        contrast: settings.contrast,
        dimming: settings.dimming,
        intensity: settings.intensity,
        ascii,
      })
    : "";

  if (cacheKey && chafaRenderer) {
    const cached = chafaRenderer.chafaFrameCache.get(cacheKey);
    if (cached) return cached;
  }

  let lines: string[];

  if (chafaRenderer?.isChafaLoaded()) {
    // Chafa WASM default raster converter
    const sampleW = cellMode === "braille" && !ascii ? width * 2 : width;
    const sampleH = cellMode === "braille" && !ascii ? height * 4 : height * 2;
    const sampler = createPixelSampler(asset, sampleW, sampleH, settings, frame);
    const sampledData = new Uint8ClampedArray(sampleW * sampleH * 4);
    for (let y = 0; y < sampleH; y++) {
      for (let x = 0; x < sampleW; x++) {
        const rgb = sampler.sample(x, y);
        const i = (y * sampleW + x) * 4;
        sampledData[i] = rgb[0];
        sampledData[i + 1] = rgb[1];
        sampledData[i + 2] = rgb[2];
        sampledData[i + 3] = 255;
      }
    }
    lines = chafaRenderer.renderChafaRaster(
      { width: sampleW, height: sampleH, data: sampledData },
      {
        width,
        height,
        colorMode,
        cellMode,
        ascii,
        quality: settings.quality,
        symbols: settings.symbols,
      },
    );
  } else {
    // Lazy-init Chafa in background for subsequent frames
    loadChafaRenderer().catch(() => {});

    // Synchronous fallback before Chafa WASM compilation completes
    if (cellMode === "braille" && !ascii) {
      const sampler = createPixelSampler(asset, width * 2, height * 4, settings, frame);
      lines = renderBraille(sampler, width, height, colorMode);
    } else {
      const sampler = createPixelSampler(asset, width, height * 2, settings, frame);
      lines = renderHalfBlock(sampler, width, height, colorMode, ascii);
    }
  }

  if (cacheKey && chafaRenderer && lines.length > 0) {
    chafaRenderer.chafaFrameCache.set(cacheKey, lines);
  }
  return lines;
}

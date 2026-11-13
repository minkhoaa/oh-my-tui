import { visibleWidth } from "@earendil-works/pi-tui";
import type { ColorMode } from "../capabilities/index.ts";
import type { CellRenderMode } from "./cell.ts";

export type ChafaQuality = "fast" | "balanced" | "high";
export type ChafaSymbolSet = "vhalf" | "braille" | "ascii" | "blocks" | string;

export interface ChafaRenderOptions {
  width: number;
  height: number;
  colorMode?: ColorMode;
  cellMode?: CellRenderMode;
  symbols?: ChafaSymbolSet;
  quality?: ChafaQuality;
  ascii?: boolean;
  fontRatio?: number;
  dither?: "none" | "ordered" | "diffuse";
  preprocess?: boolean;
  threshold?: number;
  optimize?: number;
  work?: number;
  normalizeHalfBlock?: boolean;
}

export interface ImageDataLike {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  [x: string]: unknown;
}

// Low-level Chafa module interface
export interface ChafaModuleLike {
  imageToAnsi: (
    image: ImageDataLike | ArrayBufferLike,
    config: Record<string, unknown>,
    callback: (err: unknown, res: { ansi: string; config: unknown }) => void,
  ) => void;
  imageToMatrix?: (
    image: ImageDataLike | ArrayBufferLike,
    config: Record<string, unknown>,
    callback: (err: unknown, res: { matrix: number[][][]; config: unknown }) => void,
  ) => void;
  decodeImage?: (
    image: ArrayBufferLike | ImageDataLike,
    callback: (err: unknown, res: ImageDataLike) => void,
  ) => void;
  ChafaCanvasMode?: {
    CHAFA_CANVAS_MODE_TRUECOLOR: { value: number };
    CHAFA_CANVAS_MODE_INDEXED_256: { value: number };
    CHAFA_CANVAS_MODE_INDEXED_16: { value: number };
    CHAFA_CANVAS_MODE_FGBG: { value: number };
  };
  ChafaPixelMode?: {
    CHAFA_PIXEL_MODE_SYMBOLS: { value: number };
  };
  ChafaColorSpace?: {
    CHAFA_COLOR_SPACE_RGB: { value: number };
    CHAFA_COLOR_SPACE_DIN99D: { value: number };
  };
  ChafaDitherMode?: {
    CHAFA_DITHER_MODE_NONE: { value: number };
    CHAFA_DITHER_MODE_ORDERED: { value: number };
    CHAFA_DITHER_MODE_DIFFUSE: { value: number };
  };
  [x: string]: unknown;
}

let chafaInstance: ChafaModuleLike | null = null;
let chafaPromise: Promise<ChafaModuleLike> | null = null;

/**
 * Lazy loads and initializes the Chafa WebAssembly module.
 * Only called when raster backgrounds (images/animations) are enabled.
 */
export async function initChafa(): Promise<ChafaModuleLike> {
  if (chafaInstance) return chafaInstance;
  if (!chafaPromise) {
    chafaPromise = (async () => {
      const mod = await import("chafa-wasm");
      const factory = mod.default ?? mod;
      const instance = (await (factory as () => Promise<ChafaModuleLike>)()) as ChafaModuleLike;

      // Fix upstream chafa-wasm 0.3.3 double-free bug in imageToAnsi finally block:
      // Upstream calls `_free(k)` on the GString struct after `_g_string_free_and_steal(k)`
      // has already freed it. This corrupts Emscripten's dlmalloc heap headers and causes
      // "RuntimeError: memory access out of bounds" on terminal resize when memory grows.
      if (typeof instance.imageToCanvas === "function" && typeof (instance as any)._chafa_canvas_print === "function") {
        const rawImageToCanvas = instance.imageToCanvas.bind(instance);
        instance.imageToAnsi = (
          image: ImageDataLike | ArrayBufferLike,
          config: Record<string, unknown>,
          callback: (err: unknown, res: { ansi: string; config: unknown }) => void,
        ) => {
          rawImageToCanvas(image, config, (d: unknown, canvasRes: any) => {
            if (d != null || !canvasRes?.config) {
              callback(d, { ansi: "", config: canvasRes?.config });
            } else {
              let h = 0;
              try {
                const k = (instance as any)._chafa_canvas_print(canvasRes.canvas, null);
                h = (instance as any)._g_string_free_and_steal(k);
                const l = (instance as any).UTF8ToString(h);
                callback(null, { ansi: l, config: canvasRes.config });
              } catch (err) {
                callback(err, { ansi: "", config: canvasRes.config });
              } finally {
                if (h) (instance as any)._free(h);
              }
            }
          });
        };
      }

      chafaInstance = instance;
      return chafaInstance;
    })();
  }
  return chafaPromise;
}

/**
 * Returns true if Chafa WASM has already been loaded and compiled.
 */
export function isChafaLoaded(): boolean {
  return chafaInstance !== null;
}

/**
 * Returns the currently initialized Chafa instance, or null if not yet loaded.
 */
export function getChafa(): ChafaModuleLike | null {
  return chafaInstance;
}

/**
 * Disposes the loaded Chafa instance and resets state.
 */
export function disposeChafa(): void {
  chafaInstance = null;
  chafaPromise = null;
  chafaFrameCache.clear();
}

type ParsedColor =
  | { mode: "rgb"; r: number; g: number; b: number }
  | { mode: "256"; code: number }
  | { mode: "16"; code: number };

function clampPrimary(v: number): number {
  return v === 254 ? 255 : v;
}

function formatFg(c: ParsedColor | null): string {
  if (!c) return "";
  if (c.mode === "rgb") return `38;2;${clampPrimary(c.r)};${clampPrimary(c.g)};${clampPrimary(c.b)}`;
  if (c.mode === "256") return `38;5;${c.code}`;
  let code = c.code;
  if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) code -= 10;
  return `${code}`;
}

function formatBg(c: ParsedColor | null): string {
  if (!c) return "";
  if (c.mode === "rgb") return `48;2;${clampPrimary(c.r)};${clampPrimary(c.g)};${clampPrimary(c.b)}`;
  if (c.mode === "256") return `48;5;${c.code}`;
  let code = c.code;
  if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) code += 10;
  return `${code}`;
}

/**
 * Converts an ANSI escape sequence string (as output by Chafa) into an array
 * of terminal cell lines where each cell is self-contained:
 * - Styled: `\x1b[<sgr>m<char>\x1b[0m`
 * - Unstyled / Monochrome: `<char>`
 *
 * Handles:
 * - SGR 0 (reset), 7 (inverse), 27 (inverse off)
 * - Truecolor (38;2/48;2), 256-color (38;5/48;5), 16-color (30-37, 40-47, 90-97, 100-107)
 * - Lower half-block (▄) normalization to upper half-block (▀) with swapped fg/bg
 * - East Asian wide character widths and zero-width characters
 * - Strict row column bounding (clipping at width, padding with spaces)
 */
export function ansiToCellLines(
  ansi: string,
  width: number,
  height: number,
  normalizeHalfBlock = true,
): string[] {
  if (width <= 0 || height <= 0 || width * height > 80_000) return [];
  const rawLines = ansi.split("\n");
  const result: string[] = [];

  for (let r = 0; r < height; r++) {
    const rawLine = rawLines[r] ?? "";
    let line = "";
    let fgColor: ParsedColor | null = null;
    let bgColor: ParsedColor | null = null;
    let inverted = false;
    let col = 0;

    let i = 0;
    while (i < rawLine.length && col < width) {
      if (rawLine[i] === "\x1b" && rawLine[i + 1] === "[") {
        const mIdx = rawLine.indexOf("m", i + 2);
        if (mIdx !== -1) {
          const params = rawLine.slice(i + 2, mIdx);
          const parts = params.split(";").map(Number);
          for (let p = 0; p < parts.length; p++) {
            const code = parts[p]!;
            if (code === 0 || isNaN(code)) {
              fgColor = null;
              bgColor = null;
              inverted = false;
            } else if (code === 7) {
              inverted = true;
            } else if (code === 27) {
              inverted = false;
            } else if (code === 38) {
              if (parts[p + 1] === 2) {
                fgColor = { mode: "rgb", r: parts[p + 2]!, g: parts[p + 3]!, b: parts[p + 4]! };
                p += 4;
              } else if (parts[p + 1] === 5) {
                fgColor = { mode: "256", code: parts[p + 2]! };
                p += 2;
              }
            } else if (code === 48) {
              if (parts[p + 1] === 2) {
                bgColor = { mode: "rgb", r: parts[p + 2]!, g: parts[p + 3]!, b: parts[p + 4]! };
                p += 4;
              } else if (parts[p + 1] === 5) {
                bgColor = { mode: "256", code: parts[p + 2]! };
                p += 2;
              }
            } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
              fgColor = { mode: "16", code };
            } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
              bgColor = { mode: "16", code };
            } else if (code === 39) {
              fgColor = null;
            } else if (code === 49) {
              bgColor = null;
            }
          }
          i = mIdx + 1;
          continue;
        }
      }

      const codePoint = rawLine.codePointAt(i);
      if (codePoint === undefined) break;
      let char = String.fromCodePoint(codePoint);
      i += char.length;

      const charWidth = char.charCodeAt(0) < 0x7f ? 1 : visibleWidth(char);
      if (charWidth === 0) {
        line += char;
        continue;
      }
      if (col + charWidth > width) {
        break;
      }

      let effFg = inverted ? bgColor : fgColor;
      let effBg = inverted ? fgColor : bgColor;

      // Normalization: Lower half block (▄) with fg=bottom, bg=top
      // is visually identical to upper half block (▀) with fg=top, bg=bottom
      if (normalizeHalfBlock && char === "▄") {
        char = "▀";
        const tmp = effFg;
        effFg = effBg;
        effBg = tmp;
      }

      const fgStr = formatFg(effFg);
      const bgStr = formatBg(effBg);
      const sgrParts: string[] = [];
      if (fgStr) sgrParts.push(fgStr);
      if (bgStr) sgrParts.push(bgStr);

      if (sgrParts.length > 0) {
        line += `\x1b[${sgrParts.join(";")}m${char}\x1b[0m`;
      } else {
        line += char;
      }
      col += charWidth;
    }

    while (col < width) {
      line += " ";
      col++;
    }
    result.push(line);
  }
  return result;
}

/**
 * Resolves Chafa configuration options from colorMode, cellMode, and quality.
 */
function resolveChafaConfig(
  chafa: ChafaModuleLike,
  options: ChafaRenderOptions,
): Record<string, unknown> {
  const colorMode = options.colorMode ?? "truecolor";
  const ascii = options.ascii || options.cellMode === "ascii" || colorMode === "monochrome";

  // Color mode mapping
  let colors = 0; // Truecolor default
  if (colorMode === "monochrome") {
    colors = chafa.ChafaCanvasMode?.CHAFA_CANVAS_MODE_FGBG?.value ?? 5;
  } else if (colorMode === "16color") {
    colors = chafa.ChafaCanvasMode?.CHAFA_CANVAS_MODE_INDEXED_16?.value ?? 3;
  } else if (colorMode === "256color") {
    colors = chafa.ChafaCanvasMode?.CHAFA_CANVAS_MODE_INDEXED_256?.value ?? 1;
  } else {
    colors = chafa.ChafaCanvasMode?.CHAFA_CANVAS_MODE_TRUECOLOR?.value ?? 0;
  }

  // Symbol set mapping
  let symbols = "vhalf";
  if (ascii) {
    symbols = "ascii";
  } else if (options.cellMode === "braille") {
    symbols = "braille";
  } else if (options.symbols) {
    if (options.symbols === "blocks") {
      symbols = "block+border+space-wide-inverted";
    } else {
      symbols = options.symbols;
    }
  } else if (options.cellMode === "halfblock") {
    symbols = "vhalf";
  }

  // Quality presets mapping
  const quality = options.quality ?? "balanced";
  let optimize = 5;
  let work = 5;
  let dither = chafa.ChafaDitherMode?.CHAFA_DITHER_MODE_NONE?.value ?? 0;

  if (quality === "fast") {
    optimize = 0;
    work = 1;
    dither = chafa.ChafaDitherMode?.CHAFA_DITHER_MODE_NONE?.value ?? 0;
  } else if (quality === "high") {
    optimize = 9;
    work = 9;
    dither = chafa.ChafaDitherMode?.CHAFA_DITHER_MODE_ORDERED?.value ?? 1;
  }

  if (options.optimize !== undefined) optimize = options.optimize;
  if (options.work !== undefined) work = options.work;
  if (options.dither === "none") dither = chafa.ChafaDitherMode?.CHAFA_DITHER_MODE_NONE?.value ?? 0;
  else if (options.dither === "ordered") dither = chafa.ChafaDitherMode?.CHAFA_DITHER_MODE_ORDERED?.value ?? 1;
  else if (options.dither === "diffuse") dither = chafa.ChafaDitherMode?.CHAFA_DITHER_MODE_DIFFUSE?.value ?? 2;

  const colorSpace = chafa.ChafaColorSpace?.CHAFA_COLOR_SPACE_RGB?.value ?? 0;

  return {
    width: options.width,
    height: options.height,
    fontRatio: options.fontRatio ?? 0.5,
    colors,
    colorSpace,
    symbols,
    fill: "none",
    fg: 0xffffff,
    bg: 0x000000,
    fgOnly: false,
    dither,
    ditherGrainWidth: 4,
    ditherGrainHeight: 4,
    ditherIntensity: 1.0,
    preprocess: options.preprocess ?? true,
    threshold: options.threshold ?? 0.5,
    optimize,
    work,
  };
}

/**
 * Synchronous raster conversion using initialized Chafa WASM instance.
 * Throws if Chafa has not been loaded via initChafa().
 */
export function renderChafaRaster(
  image: ImageDataLike,
  options: ChafaRenderOptions,
): string[] {
  if (!chafaInstance) {
    throw new Error("Chafa WASM is not initialized. Call await initChafa() before rendering.");
  }
  const config = resolveChafaConfig(chafaInstance, options);
  let ansiResult = "";
  let error: unknown = null;

  chafaInstance.imageToAnsi(image, config, (err, res) => {
    if (err) {
      error = err;
    } else {
      ansiResult = res?.ansi ?? "";
    }
  });

  if (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  const normalize = options.normalizeHalfBlock ?? (options.cellMode === "halfblock" || !options.cellMode);
  return ansiToCellLines(ansiResult, options.width, options.height, normalize);
}

/**
 * Asynchronous raster conversion that guarantees Chafa initialization before rendering.
 */
export async function renderChafaRasterAsync(
  image: ImageDataLike,
  options: ChafaRenderOptions,
): Promise<string[]> {
  await initChafa();
  return renderChafaRaster(image, options);
}

// ==========================================
// Bounded Frame Cache
// ==========================================

export interface FrameCacheKeyOptions {
  assetId: string;
  width: number;
  height: number;
  frame?: number;
  colorMode?: ColorMode;
  cellMode?: CellRenderMode;
  symbols?: string;
  quality?: string;
  fit?: string;
  textureScale?: number;
  opacity?: number;
  contrast?: number;
  dimming?: string;
  intensity?: string;
  ascii?: boolean;
}

export function buildFrameCacheKey(opts: FrameCacheKeyOptions): string {
  return [
    opts.assetId,
    opts.width,
    opts.height,
    opts.frame ?? 0,
    opts.colorMode ?? "truecolor",
    opts.cellMode ?? "halfblock",
    opts.symbols ?? "default",
    opts.quality ?? "balanced",
    opts.fit ?? "cover",
    opts.textureScale ?? 1,
    opts.opacity ?? 1,
    opts.contrast ?? 1,
    opts.dimming ?? "subtle",
    opts.intensity ?? "medium",
    opts.ascii ? "1" : "0",
  ].join(":");
}

export class ChafaFrameCache {
  private cache = new Map<string, string[]>();
  private readonly maxEntries: number;

  constructor(maxEntries = 48) {
    this.maxEntries = maxEntries;
  }

  get(key: string): string[] | undefined {
    const value = this.cache.get(key);
    if (value) {
      // LRU refresh: move accessed entry to recent position
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, lines: string[]): void {
    this.cache.set(key, lines);
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
      else break;
    }
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  invalidate(prefix?: string): void {
    if (!prefix) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export const chafaFrameCache = new ChafaFrameCache(48);

/**
 * Codex-inspired rendering rules for Pi: ANSI strings, native components,
 * public palette queries, and keybindings.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { indexedColor, rgbColor, sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TerminalColors, type TUI } from "@earendil-works/pi-tui";

export { reservedMarker as codexMarker } from "../shared/rendering.ts";

export const CODEX_COMMIT = "086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a";
export const CODEX_FRAME_MS = 32;
let palette: TerminalColors = {};
let paletteRevision = 0;
export function codexPaletteRevision(): number { return paletteRevision; }
const queried = new WeakSet<TUI>();
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Reuse Pi's completed startup query before the first OMT paint, when available. */
export function primeCodexPalette(tui: TUI, colors: TerminalColors): void {
  queried.add(tui);
  setCodexPalette(colors);
}

/** No polling; Pi owns query parsing, capability handling and rendering. */
export function queryCodexPalette(tui: TUI): void {
  if (queried.has(tui) || typeof tui.queryTerminalColors !== "function") return;
  queried.add(tui);
  const accept = (colors: TerminalColors) => { setCodexPalette(colors); try { tui.requestRender(); } catch {} };
  void tui.queryTerminalColors({ timeoutMs: 100, onLateReply: accept }).then(accept, () => {});
}
export function setCodexPalette(colors: TerminalColors): void {
  if (JSON.stringify(palette) !== JSON.stringify(colors)) paletteRevision++;
  palette = colors;
}

export function blend(top: readonly number[], bottom: readonly number[], alpha: number): [number, number, number] {
  const a = Math.fround(alpha), inverse = Math.fround(1 - a);
  return [0, 1, 2].map((i) => Math.trunc(Math.fround(Math.fround(top[i]! * a) + Math.fround(bottom[i]! * inverse)))) as [number, number, number];
}
export function codexDim(text: string): string { return `\x1b[2m${text}\x1b[22m`; }

function isLight(bg: { r: number; g: number; b: number }): boolean {
  return 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b > 128;
}

/** Blue accent, or the light-background accent. */
export function codexAccent(theme: Theme, text: string): string {
  const rgb: [number, number, number] = palette.background && isLight(palette.background)
    ? [28, 100, 200] : [99, 168, 248];
  return theme.style(text, { fg: rgbColor(...rgb) });
}

export function codexPanel(theme: Theme, text: string, history = false): string {
  if (!theme || typeof theme.style !== "function") return text;
  const bg = palette.background;
  // Submitted prompts retain an ANSI dark-gray fill; only the composer is transparent.
  if (!bg) return history ? theme.style(text, { bg: indexedColor(8) }) : text;
  const light = isLight(bg);
  const alpha = history ? (light ? 0.02 : 0.16) : (light ? 0.04 : 0.12);
  const rgb = blend(light ? [0, 0, 0] : [255, 255, 255], [bg.r, bg.g, bg.b], alpha);
  return theme.style(text, { bg: rgbColor(...rgb) });
}

/** Whole-grapheme brightness wave, delayed 600ms, 1s sweep every 4s. */
export function codexSummary(theme: Theme, text: string, elapsedMs: number): string {
  const fg = palette.foreground, bg = palette.background;
  if (theme.getColorMode() !== "truecolor" || !fg || !bg) return codexDim(text);
  const width = visibleWidth(text), halfWidth = Math.max(width * 0.1, 3);
  const sweep = Math.min(Math.max(0, elapsedMs - 600) / 1000 % 4, 1);
  const position = sweep * (width + 2 * halfWidth) - halfWidth;
  let column = 0;
  return [...graphemes.segment(text)].map(({ segment }) => {
    const size = visibleWidth(segment), center = column + size / 2;
    column += size;
    const distance = Math.min(Math.abs(center - position) / halfWidth, 1);
    const intensity = 0.5 * (1 + Math.cos(Math.PI * distance));
    return theme.style(segment, { fg: rgbColor(...blend([fg.r, fg.g, fg.b], [bg.r, bg.g, bg.b], 0.5 + 0.5 * intensity)) });
  }).join("");
}

/** Truecolor 2s cosine sweep; 600ms bullet/outline fallback. */
export function codexActivity(theme: Theme, elapsedMs: number): string {
  if (theme.getColorMode() !== "truecolor") return Math.floor(elapsedMs / 600) % 2 ? codexDim("◦") : "•";
  const fg = palette.foreground ?? { r: 128, g: 128, b: 128 };
  const bg = palette.background ?? { r: 255, g: 255, b: 255 };
  const position = Math.floor((elapsedMs % 2000) / 2000 * 21);
  const distance = Math.abs(10 - position);
  const t = distance <= 5 ? 0.5 * (1 + Math.cos(Math.PI * distance / 5)) : 0;
  return theme.style("•", { fg: rgbColor(...blend([bg.r, bg.g, bg.b], [fg.r, fg.g, fg.b], t * 0.9)), bold: true });
}

/** Rust str::lines: a terminal newline is not a separate line. Optimized O(N) scan without array allocation. */
export function codexLineCount(text: string): number {
  if (!text) return 0;
  let count = 1;
  let pos = -1;
  while ((pos = text.indexOf("\n", pos + 1)) !== -1) {
    count++;
  }
  if (text.endsWith("\n")) count--;
  return count;
}

export function codexElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
  return `${Math.floor(sec / 3600)}h ${String(Math.floor(sec / 60) % 60).padStart(2, "0")}m ${String(sec % 60).padStart(2, "0")}s`;
}
export function codexStatus(theme: Theme, label: string, elapsed: number, headerElapsed: number, interruptKey: string, width: number): string {
  return truncateToWidth(`${codexActivity(theme, elapsed)} ${codexSummary(theme, label, headerElapsed)} ${codexDim(`(${codexElapsed(elapsed)}${interruptKey ? ` • ${interruptKey} to interrupt` : ""})`)}`, width, "…");
}

/** tool_output.rs: budget is screen rows, partially shown logical lines count as hidden. */
export function codexOutputPreview(text: string, width: number, hint: string): string[] {
  if (!text) return [codexDim("(no output)")];
  const first3: string[] = [];
  let lineStart = 0;
  let p = -1;
  while ((p = text.indexOf("\n", lineStart)) !== -1 && first3.length < 3) {
    first3.push(text.slice(lineStart, p));
    lineStart = p + 1;
  }
  let totalLines = 0;
  if (first3.length < 3) {
    first3.push(text.slice(lineStart));
    totalLines = first3.length;
  } else {
    let remaining = 1;
    let pos = lineStart - 1;
    while ((pos = text.indexOf("\n", pos + 1)) !== -1) {
      remaining++;
    }
    totalLines = 3 + remaining;
  }
  const rows: string[] = [];
  let omitted = totalLines;
  for (const line of first3) {
    const remaining = 3 - rows.length;
    if (!remaining) break;
    // Bound work before wrapping, including hostile zero-width output.
    const bounded = sliceByColumn(line.slice(0, 16 * 1024), 0, Math.max(1, width) * (remaining + 1));
    const wrapped = wrapTextWithAnsi(bounded, Math.max(1, width));
    rows.push(...wrapped.slice(0, remaining));
    if (wrapped.length > remaining || stripTerminalSequences(bounded) !== stripTerminalSequences(line)) break;
    omitted--;
  }
  if (omitted) rows.push(truncateToWidth(`+${omitted} ${omitted === 1 ? "line" : "lines"}${hint}`, Math.max(1, width), "…"));
  return rows.map(codexDim);
}

/**
 * OpenCode-inspired presentation for Pi's ANSI components.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { rgbColor, sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { ansiBackground, LayoutRow } from "../shared/rendering.ts";

export const OPENCODE_COMMIT = "810c0eba1a7348036f8bdf61e6632d0c36c6876c";
export const OPENCODE_FRAME_MS = 40;
export const OPENCODE_BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const colors = {
  dark: { background: "#0a0a0a", panel: "#141414", element: "#1e1e1e", text: "#eeeeee", muted: "#808080", primary: "#fab283", secondary: "#5c9cf5", warning: "#f5a742", error: "#e06c75", added: "#20303b", removed: "#37222c", lineNumber: "#8f8f8f", addedNumber: "#1b2b34", removedNumber: "#2d1f26", addedSign: "#b8db87", removedSign: "#e26a75" },
  light: { background: "#ffffff", panel: "#fafafa", element: "#f5f5f5", text: "#1a1a1a", muted: "#8a8a8a", primary: "#3b7dd8", secondary: "#7b5bb6", warning: "#d68c27", error: "#d1383d", added: "#d5e5d5", removed: "#f7d8db", lineNumber: "#595959", addedNumber: "#c5d5c5", removedNumber: "#e7c8cb", addedSign: "#4db380", removedSign: "#f52a65" },
} as const;
export type OpenCodeColor = keyof typeof colors.dark;
function rgb(theme: Theme, color: OpenCodeColor): [number, number, number] {
  const hex = colors[theme.appearance === "light" ? "light" : "dark"][color];
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
export function openCodeFg(theme: Theme, color: OpenCodeColor, text: string): string {
  return theme.style(text, { fg: rgbColor(...rgb(theme, color)) });
}
export function openCodeBg(theme: Theme, color: OpenCodeColor, text: string): string {
  return ansiBackground(theme, rgbColor(...rgb(theme, color)), text);
}
export function openCodeSpinner(elapsed: number, animated = true): string {
  return animated ? OPENCODE_BRAILLE[Math.floor(Math.max(0, elapsed) / 80) % 10]! : "⋯";
}

/** ui/spinner.ts: 8 forward + 9 hold + 7 backward + 30 hold frames. */
export function openCodeScanner(theme: Theme, elapsed: number, animated = true): string {
  if (!animated) return openCodeFg(theme, "secondary", "⋯");
  const frame = Math.floor(Math.max(0, elapsed) / 40) % 54;
  const forward = frame < 17;
  const position = frame < 8 ? frame : frame < 17 ? 7 : frame < 24 ? 23 - frame : 0;
  const holding = frame >= 8 && frame < 17 || frame >= 24;
  const hold = frame < 17 ? frame - 8 : frame - 24;
  const fade = holding ? Math.max(0.3, 1 - hold / (frame < 17 ? 9 : 30) * 0.7)
    : 0.3 + (frame < 8 ? frame / 7 : (frame - 17) / 6) * 0.7;
  const fg = rgb(theme, "secondary"), bg = rgb(theme, "background");
  return Array.from({ length: 8 }, (_, i) => {
    const distance = (forward ? position - i : i - position) + (holding ? hold : 0);
    const active = distance >= 0 && distance < 6;
    const alpha = active ? distance === 0 ? 1 : distance === 1 ? 0.9 : Math.pow(0.65, distance - 1) : 0.6 * fade;
    const bloom = active && distance === 1 ? 1.15 : 1;
    const color = fg.map((v, c) => Math.round(Math.min(255, v * bloom) * alpha + bg[c]! * (1 - alpha))) as [number, number, number];
    return theme.style(active ? "■" : "⬝", { fg: rgbColor(...color) });
  }).join("");
}

/** Source budgets logical lines and Unicode codepoints, not Codex screen rows. */
export function openCodeCollapse(output: string, width: number): { output: string; overflow: boolean } {
  const budget = 10 * Math.max(20, width - 6);
  const lines = output.split("\n");
  if (lines.length <= 10) {
    if (output.length <= budget) return { output, overflow: false };
    let cp = 0;
    for (const _ of output) {
      if (++cp > budget) break;
    }
    if (cp <= budget) return { output, overflow: false };
  }
  const preview = lines.slice(0, 10).join("\n");
  const previewPoints = Array.from(preview);
  return {
    output: previewPoints.length > budget
      ? previewPoints.slice(0, budget - 1).join("") + "…"
      : [...lines.slice(0, 10), "…"].join("\n"),
    overflow: true,
  };
}

/** Replace a reserved cell, preserving Pi's OSC prompt zones and cursor geometry. */
export function openCodeRail(theme: Theme, line: string, width: number, column: number, surface: "panel" | "element", end = false, rail: OpenCodeColor = "secondary"): string {
  const zones = line.match(/\x1b\]133;[ABC]\x07/g)?.join("") ?? "";
  const body = line.replace(/\x1b\]133;[ABC]\x07/g, "");
  const available = Math.max(0, width - column - 3);
  const content = sliceByColumn(body, column + 1, available);
  const marker = openCodeFg(theme, rail, end ? "╹" : "┃");
  return zones + " ".repeat(column) + (rail === "background" ? openCodeBg(theme, surface, marker) : marker)
    + openCodeBg(theme, surface, content + " ".repeat(Math.max(0, available - visibleWidth(content)))) + "  ";
}

export function openCodeBlock(theme: Theme, body: string[], width: number, nativePad = 1, rail: OpenCodeColor = "background"): string[] {
  if (width <= 0) return [];
  if (width < 10) return body.map((line) => truncateToWidth(line, width, ""));
  const outer = Math.min(Math.max(2, nativePad - 3), Math.floor((width - 6) / 2));
  const inner = Math.max(2, width - outer - 3);
  const rows = ["", ...body, ""].map((line) => " ".repeat(outer + 1) + "  " + line);
  return rows.map((line) => openCodeRail(theme, truncateToWidth(line, outer + 1 + inner, ""), width, outer, "panel", false, rail));
}

const words = new Intl.Segmenter(undefined, { granularity: "word" });
/** Text wraps at Unicode boundaries (including shell punctuation), with hard overflow. */
export function openCodeWrap(text: string, width: number): string[] {
  const size = Math.max(2, width);
  return text.split("\n").flatMap((line) => {
    const total = visibleWidth(line);
    if (total <= size) return [line];
    const boundaries: number[] = [];
    let end = 0;
    for (const { segment } of words.segment(stripTerminalSequences(line))) { end += visibleWidth(segment); boundaries.push(end); }
    const rows: string[] = [];
    let boundary = 0;
    for (let column = 0; column < total;) {
      let last = column;
      while (boundary < boundaries.length && boundaries[boundary]! <= column + size) last = boundaries[boundary++]!;
      const length = total - column <= size ? total - column : last > column ? last - column : size;
      const part = sliceByColumn(line, column, length, true);
      const used = visibleWidth(part);
      if (!used) break;
      rows.push(part); column += used;
    }
    return rows;
  });
}
export class OpenCodeRow extends LayoutRow {}
export function openCodeDiffRow(theme: Theme, line: string, width = 0): string {
  const plain = stripTerminalSequences(line);
  const match = plain.match(/^([+\- ])(\s*\d+) (.*)$/);
  if (!match) return line;
  const [, sign, number] = match;
  const offset = 1 + number!.length + 1;
  const body = sliceByColumn(line, offset, Math.max(0, visibleWidth(line) - offset));
  const changed = sign === "+" || sign === "-";
  const numberText = openCodeFg(theme, "lineNumber", " " + number!.trim().padStart(Math.max(2, number!.length)) + " ");
  const mark = changed ? openCodeFg(theme, sign === "+" ? "addedSign" : "removedSign", sign!) : sign;
  const gutter = numberText + mark + " ";
  const content = (changed ? openCodeBg(theme, sign === "+" ? "addedNumber" : "removedNumber", gutter) : gutter) + body;
  const rendered = content + " ".repeat(Math.max(0, width - visibleWidth(content)));
  return sign === "+" || sign === "-" ? openCodeBg(theme, sign === "+" ? "added" : "removed", rendered) : rendered;
}

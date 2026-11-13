/** Independently implemented from official Claude Code 2.1.319 terminal behavior.
 * No bundled/decompiled implementation or proprietary assets are used.
 * ANSI/cell/timing observations and adaptation limits: README.md, test/evidence/m12.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { rgbColor, sliceByColumn, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { ansiBackground } from "../shared/rendering.ts";
export { reservedMarker as claudeMarker } from "../shared/rendering.ts";

export const CLAUDE_VERSION = "2.1.319";
const palette = {
  dark: { accent: [215, 119, 87], shimmer: [235, 159, 127], text: [255, 255, 255], muted: [153, 153, 153], border: [136, 136, 136], panel: [55, 55, 55], success: [78, 186, 101], error: [255, 107, 128], added: [2, 40, 0], removed: [61, 1, 0], addedSign: [80, 200, 80], removedSign: [220, 90, 90] },
  light: { accent: [215, 119, 87], shimmer: [245, 149, 117], text: [0, 0, 0], muted: [102, 102, 102], border: [138, 138, 138], panel: [240, 240, 240], success: [44, 122, 57], error: [171, 43, 63], added: [220, 255, 220], removed: [255, 220, 220], addedSign: [36, 138, 61], removedSign: [207, 34, 46] },
} as const;
export type ClaudeColor = keyof typeof palette.dark;
function color(theme: Theme, name: ClaudeColor) {
  const [r, g, b] = palette[theme.appearance === "light" ? "light" : "dark"][name];
  return rgbColor(r, g, b);
}
export function claudeFg(theme: Theme, name: ClaudeColor, text: string): string { return theme.style(text, { fg: color(theme, name) }); }
export function claudeBg(theme: Theme, name: ClaudeColor, text: string): string {
  return ansiBackground(theme, color(theme, name), text);
}

/** Result tree is attached to the call, not Codex's screen-row gutter. */
export function claudeResultRows(body: string[], width: number, padding: number, theme: Theme): string[] {
  if (width <= 0) return [];
  const margin = Math.min(Math.max(0, padding), Math.max(0, width - 6));
  const inner = Math.max(2, width - margin - 5);
  return body.flatMap((line) => wrapTextWithAnsi(line, inner)).map((line, i) =>
    sliceByColumn(" ".repeat(margin) + (i === 0 ? claudeFg(theme, "muted", "  ⎿  ") : "     ") + line, 0, width));
}

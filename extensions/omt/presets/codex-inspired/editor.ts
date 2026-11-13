// Codex-inspired editor presentation for Pi.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import type { EditorRenderData } from "../shared/types.ts";
import { getActiveTheme } from "../../core/theme.ts";
import { panel } from "../shared/style.ts";

export function codexEditor(theme: Theme, { lines, width, boxHeight }: EditorRenderData): string[] {
  const active = getActiveTheme();
  const promptGlyph = active.glyph.prompt;
  const inset = active.spacing.inset;
  const promptWidth = visibleWidth(promptGlyph);
  const prefixCols = inset + promptWidth;
  const prompt = theme.bold(promptGlyph);
  const prefix = `${" ".repeat(inset)}${prompt}`;

  return lines.map((line, row) => {
    if (row >= boxHeight) return line;
    const formatted = row === 1 && promptGlyph
      ? `${prefix}${sliceByColumn(line, prefixCols, width - prefixCols)}`
      : line;
    return panel(theme, formatted);
  });
}

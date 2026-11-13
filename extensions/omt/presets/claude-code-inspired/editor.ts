import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, truncateToWidth } from "@earendil-works/pi-tui";
import type { EditorRenderData } from "../shared/types.ts";
import { claudeFg } from "./rendering.ts";

/** Keep native rows, completion menus, fake/IME cursor and mouse coordinates. */
export function claudeEditor(theme: Theme, { lines, width, boxHeight, padding }: EditorRenderData): string[] {
  const column = Math.max(0, padding - 2);
  return lines.map((line, row) => row === 1 && row < boxHeight
    ? truncateToWidth(" ".repeat(column) + claudeFg(theme, "text", "❯") + sliceByColumn(line, column + 1, width - column - 1), width, "") : line);
}
export function claudeEditorBorder(theme: Theme, border: string): string { return claudeFg(theme, "border", border); }

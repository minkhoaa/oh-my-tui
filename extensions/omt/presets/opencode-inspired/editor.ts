// OpenCode-inspired editor presentation for Pi.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import type { EditorRenderData } from "../shared/types.ts";
import { openCodeFg, openCodeRail } from "./rendering.ts";

export function openCodeEditor(theme: Theme, { lines, width, boxHeight, padding, metadata }: EditorRenderData): string[] {
  return lines.map((line, row) => {
    if (row >= boxHeight) return line; // Never paint native completion menus.
    let formatted = line;
    if (row === boxHeight - 1 && !stripTerminalSequences(line).trim()) {
      formatted = " ".repeat(padding) + openCodeFg(theme, "muted", metadata);
    }
    return openCodeRail(theme, truncateToWidth(formatted, width - 2, ""), width, 2, "element", row === boxHeight - 1);
  });
}

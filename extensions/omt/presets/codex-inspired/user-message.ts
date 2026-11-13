// Codex-inspired user message presentation for Pi.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { contentPadding } from "../shared/style.ts";
import type { UserMessageLayout } from "../shared/user-message.ts";
import { codexDim, codexMarker, codexPanel, codexPaletteRevision } from "./rendering.ts";
export function codexUserMessage(width: number, native: number, theme: Theme): UserMessageLayout {
  const padding = Math.min(contentPadding(native), Math.floor((width - 2) / 2));
  return {
    padding, width, key: `codex:${codexPaletteRevision()}`,
    style: { color: (text) => text, bgColor: (text) => codexPanel(theme, text, true) },
    decorate(lines) {
      if (lines.length > 2) {
        const marker = theme && typeof theme.bold === "function" ? theme.bold(codexDim("› ")) : codexDim("› ");
        lines[1] = codexPanel(theme, codexMarker(lines[1]!, marker, Math.max(0, padding - 2)), true);
      }
      return lines;
    },
  };
}

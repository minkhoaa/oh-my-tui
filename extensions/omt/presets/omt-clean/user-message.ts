// OMT Clean user message presentation for Pi.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { contentPadding } from "../shared/style.ts";
import type { UserMessageLayout } from "../shared/user-message.ts";
import { cleanDim, cleanMarker, cleanPanel, cleanPaletteRevision } from "./rendering.ts";
export function cleanUserMessage(width: number, native: number, theme: Theme): UserMessageLayout {
  const padding = Math.min(contentPadding(native), Math.floor((width - 2) / 2));
  return {
    padding, width, key: `clean:${cleanPaletteRevision()}`,
    style: { color: (text) => text, bgColor: (text) => cleanPanel(theme, text, true) },
    decorate(lines) {
      if (lines.length > 2) {
        const marker = theme && typeof theme.bold === "function" ? theme.bold(cleanDim("› ")) : cleanDim("› ");
        lines[1] = cleanPanel(theme, cleanMarker(lines[1]!, marker, Math.max(0, padding - 2)), true);
      }
      return lines;
    },
  };
}

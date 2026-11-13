import type { Theme } from "@earendil-works/pi-coding-agent";
import { contentPadding } from "../shared/style.ts";
import type { UserMessageLayout } from "../shared/user-message.ts";
import { emberBg, emberFg, emberMarker } from "./rendering.ts";

export function emberUserMessage(width: number, native: number, theme: Theme): UserMessageLayout {
  const padding = Math.min(contentPadding(native), Math.floor((width - 2) / 2));
  return {
    padding, width, key: `ember:${theme.appearance}:${theme.getColorMode()}`,
    style: { color: (text) => emberFg(theme, "text", text), bgColor: (text) => emberBg(theme, "panel", text) },
    decorate(rows) {
      // Native top/bottom spacer rows and prompt zones survive, without a filled empty band.
      return rows.map((line, i) => i === 0 || i === rows.length - 1
        ? line.replace(/\x1b\[48;[^m]+m/g, "")
        : i === 1 ? emberBg(theme, "panel", emberMarker(line, emberFg(theme, "muted", "❯ "), Math.max(0, padding - 2))) : line);
    },
  };
}

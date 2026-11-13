import type { Theme } from "@earendil-works/pi-coding-agent";
import { contentPadding } from "../shared/style.ts";
import type { UserMessageLayout } from "../shared/user-message.ts";
import { claudeBg, claudeFg, claudeMarker } from "./rendering.ts";

export function claudeUserMessage(width: number, native: number, theme: Theme): UserMessageLayout {
  const padding = Math.min(contentPadding(native), Math.floor((width - 2) / 2));
  return {
    padding, width, key: `claude:${theme.appearance}:${theme.getColorMode()}`,
    style: { color: (text) => claudeFg(theme, "text", text), bgColor: (text) => claudeBg(theme, "panel", text) },
    decorate(rows) {
      // Native top/bottom spacer rows and prompt zones survive, without a filled empty band.
      return rows.map((line, i) => i === 0 || i === rows.length - 1
        ? line.replace(/\x1b\[48;[^m]+m/g, "")
        : i === 1 ? claudeBg(theme, "panel", claudeMarker(line, claudeFg(theme, "muted", "❯ "), Math.max(0, padding - 2))) : line);
    },
  };
}

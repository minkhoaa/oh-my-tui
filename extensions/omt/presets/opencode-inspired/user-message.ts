// OpenCode-inspired user message presentation for Pi.
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { UserMessageLayout } from "../shared/user-message.ts";
import { openCodeBg, openCodeFg, openCodeRail } from "./rendering.ts";
export function openCodeUserMessage(width: number, native: number, theme: Theme): UserMessageLayout {
  const outer = Math.min(Math.max(2, native - 3), Math.floor((width - 6) / 2));
  const renderWidth = width - outer - 3;
  const padding = Math.min(Math.max(2, native - outer - 1), Math.floor((renderWidth - 2) / 2));
  return {
    padding, width: renderWidth + padding, key: `opencode:${theme.appearance}:${theme.getColorMode()}`,
    style: { color: (text) => openCodeFg(theme, "text", text), bgColor: (text) => openCodeBg(theme, "panel", text) },
    decorate: (lines) => lines.map((line) => openCodeRail(theme, " ".repeat(outer + 1) + line, width, outer, "panel")),
  };
}

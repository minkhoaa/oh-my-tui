// OMT Rail user message presentation for Pi.
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { UserMessageLayout } from "../shared/user-message.ts";
import { railBg, railFg, railRail } from "./rendering.ts";
export function railUserMessage(width: number, native: number, theme: Theme): UserMessageLayout {
  const outer = Math.min(Math.max(2, native - 3), Math.floor((width - 6) / 2));
  const renderWidth = width - outer - 3;
  const padding = Math.min(Math.max(2, native - outer - 1), Math.floor((renderWidth - 2) / 2));
  return {
    padding, width: renderWidth + padding, key: `rail:${theme.appearance}:${theme.getColorMode()}`,
    style: { color: (text) => railFg(theme, "text", text), bgColor: (text) => railBg(theme, "panel", text) },
    decorate: (lines) => lines.map((line) => railRail(theme, " ".repeat(outer + 1) + line, width, outer, "panel")),
  };
}

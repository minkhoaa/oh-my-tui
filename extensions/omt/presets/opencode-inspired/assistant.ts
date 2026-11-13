// OpenCode-inspired assistant presentation for Pi.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { contentPadding } from "../shared/style.ts";
import type { AssistantHost } from "../shared/types.ts";
import { openCodeBlock, openCodeFg } from "./rendering.ts";
export function openCodeAssistant(lines: string[], host: AssistantHost, theme: Theme, width: number): string[] {
      if (!host.hasToolCalls && host.lastMessage?.stopReason === "error") {
        const index = lines.findIndex((line) => stripTerminalSequences(line).trim().startsWith("Error:"));
        if (index >= 0) {
          const body = lines.splice(index).map((line) => {
            const padding = stripTerminalSequences(line).match(/^ */)?.[0].length ?? 0;
            return sliceByColumn(line, padding, Math.max(0, visibleWidth(line) - padding));
          });
          lines.push(...openCodeBlock(theme, body, width, contentPadding(), "error"));
        }
      }
      if (!host.hasToolCalls && !host.isStreaming && host.lastMessage?.model) {
        const pad = " ".repeat(Math.min(contentPadding(), Math.floor((width - 2) / 2)));
        const metadata = openCodeFg(theme, "secondary", "▣ ") + openCodeFg(theme, "muted", host.lastMessage.model);
        // Only metadata actually available in Pi.
        lines.push("", pad + truncateToWidth(metadata, width - pad.length, "…"));
      }
  return lines;
}

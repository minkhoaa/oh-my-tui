import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type { AssistantHost } from "../shared/types.ts";
import { claudeFg, claudeMarker } from "./rendering.ts";

export function claudeThinkingLabel(theme: Theme, streaming: boolean): string {
  return claudeFg(theme, "muted", streaming ? "∴ Thinking…" : "∴ Thought");
}
export function claudeAssistant(lines: string[], host: AssistantHost, theme: Theme, proseOffset = 0): string[] {
  // Reasoning remains a native expandable block, never an invented prose summary.
  const hasText = host.lastMessage?.content?.some((part) => part.type === "text");
  if (!hasText && host.lastMessage?.stopReason !== "error" && host.lastMessage?.stopReason !== "aborted") return lines;
  const first = lines.findIndex((line, index) => {
    if (hasText && index < proseOffset) return false;
    const text = stripTerminalSequences(line).trim();
    return text && !/^(?:∴|Thought|Thinking)/.test(text);
  });
  if (first >= 0) {
    const padding = stripTerminalSequences(lines[first]!).match(/^ */)?.[0].length ?? 0;
    if (padding >= 2) lines[first] = claudeMarker(lines[first]!, claudeFg(theme, "text", "● "), padding - 2);
  }
  return lines;
}

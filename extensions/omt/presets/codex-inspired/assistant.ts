// Codex-inspired assistant presentation for Pi.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type { AssistantHost } from "../shared/types.ts";
import { codexDim, codexMarker } from "./rendering.ts";
export function codexAssistant(lines: string[], host: AssistantHost, _theme: Theme, _width: number): string[] {
      const first = lines.findIndex((line) => stripTerminalSequences(line).trim().length > 0);
      if (first >= 0) {
        const pad = stripTerminalSequences(lines[first]!).match(/^ */)?.[0].length ?? 0;
        if (pad >= 2) lines[first] = codexMarker(lines[first]!, codexDim("• "), pad - 2);
      }
      const reason = host.lastMessage?.stopReason;
      if (!host.hasToolCalls && (reason === "aborted" || reason === "error")) {
        const diagnostic = reason === "error" ? "Error:" : host.lastMessage?.errorMessage && host.lastMessage.errorMessage !== "Request was aborted" ? host.lastMessage.errorMessage : "Operation aborted";
        let index = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
          const text = stripTerminalSequences(lines[i]!).trim().replace(/^• /, "");
          if (text && (text.startsWith(diagnostic) || diagnostic.startsWith(text))) { index = i; break; }
        }
        if (index >= 0) {
          const pad = stripTerminalSequences(lines[index]!).match(/^ */)?.[0].length ?? 0;
          lines[index] = codexMarker(lines[index]!, "\x1b[31m■ \x1b[39m", Math.max(0, pad - 2));
        }
      }
  return lines;
}

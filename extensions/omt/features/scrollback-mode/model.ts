import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type Component, type TUI } from "@earendil-works/pi-tui";
import type { ScrollbackFactory, ScrollbackViewOptions } from "./types.ts";


export type { ScrollbackFactory, ScrollbackViewOptions } from "./types.ts";

/**
 * Safely extract transcript lines from ExtensionContext if none are explicitly provided.
 */
function extractTranscriptLines(ctx: ExtensionContext): string[] {
  const lines: string[] = [];
  const c = ctx as any;

  if (c?.session?.messages && Array.isArray(c.session.messages)) {
    for (const msg of c.session.messages) {
      if (typeof msg.content === "string") {
        lines.push(...msg.content.split("\n"));
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && typeof block.text === "string") {
            lines.push(...block.text.split("\n"));
          }
        }
      }
    }
  }

  if (lines.length === 0) {
    lines.push(
      "--- Oh My TUI Native Scrollback Buffer ---",
      "No prior message history recorded in current session.",
      "Press '/' to search, 'v' for visual line selection, 'q' or 'Esc' to exit.",
    );
  }

  return lines;
}

/**
 * Native Scrollback & Selection Mode Component for Oh My TUI.
 */

export { extractTranscriptLines };

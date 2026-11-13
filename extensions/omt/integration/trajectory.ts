import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TraceStep } from "../features/omt-dialogs/types.ts";
import { extractEntrySummary } from "../features/session-tree/model.ts";
import { traceStepLabel } from "../features/omt-dialogs/model.ts";

/** Source trajectory walks the entire tree DFS, omitting non-message entries. */
export function readTrajectorySteps(manager: ExtensionContext["sessionManager"]): TraceStep[] {
  const steps: TraceStep[] = [];
  type Node = ReturnType<typeof manager.getTree>[number];
  function walk(nodes: readonly Node[]): void {
    for (const node of nodes) {
      const entry = node.entry;
      if (entry.type === "message") {
        const message = entry.message;
        const kind = message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : "tool";
        const title = extractEntrySummary(entry);
        const body = "content" in message ? typeof message.content === "string" ? message.content : message.content.map(block => {
          if (block.type === "text") return block.text;
          if (block.type === "thinking") return block.thinking;
          if (block.type === "toolCall") return `${block.name}\n${JSON.stringify(block.arguments, null, 2)}`;
          return "";
        }).filter(Boolean).join("\n\n") : JSON.stringify(message, null, 2);
        const step: TraceStep = { id: entry.id, index: steps.length + 1, kind, timestamp: entry.timestamp, title,
          detail: "", ...(message.role === "toolResult" ? { toolName: message.toolName } : {}) };
        const date = new Date(entry.timestamp);
        const time = Number.isFinite(date.getTime()) ? ` · ${date.toISOString().slice(11, 19)}` : "";
        step.detail = `${traceStepLabel(step)}\n${kind} · id ${entry.id}${time}${entry.parentId ? ` · parent ${entry.parentId}` : ""}\n\n${body}`;
        steps.push(step);
      }
      walk(node.children);
    }
  }
  walk(manager.getTree());
  return steps;
}

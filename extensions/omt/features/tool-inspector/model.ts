import type { Theme } from "@earendil-works/pi-coding-agent";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";


import type { InspectedToolCall } from "./types.ts";

export interface DiffHunkLine {
  type: "add" | "del" | "context";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffHunkLine[];
}

function fgSafe(theme: Theme, color: any, text: string): string {
  try {
    return typeof theme.fg === "function" ? theme.fg(color, text) : text;
  } catch {
    return text;
  }
}

function boldSafe(theme: Theme, text: string): string {
  try {
    return typeof theme.bold === "function" ? theme.bold(text) : text;
  } catch {
    return text;
  }
}

function dimSafe(theme: Theme, text: string): string {
  try {
    if (typeof (theme as any).dim === "function") {
      return (theme as any).dim(text);
    }
    return typeof theme.fg === "function" ? theme.fg("dim" as any, text) : text;
  } catch {
    return text;
  }
}

function formatDuration(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return "0ms";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function renderOutcomeBadge(tool: InspectedToolCall, theme: Theme): string {
  if (tool.outcome === "running") {
    return fgSafe(theme, "secondary", "running");
  }
  if (tool.outcome === "failure" || tool.isError) {
    return fgSafe(theme, "error", "failure");
  }
  if (tool.outcome === "interrupted") {
    return fgSafe(theme, "warning", "interrupted");
  }
  return fgSafe(theme, "success", "success");
}

export async function copyToolContent(content: string): Promise<boolean> {
  try {
    await copyToClipboard(content);
    return true;
  } catch {
    return false;
  }
}

export function parseDiffHunks(diffText: string): DiffHunk[] {
  if (!diffText || typeof diffText !== "string") return [];

  const rawLines = diffText.split(/\r?\n/);
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let curOld = 1;
  let curNew = 1;

  for (const rawLine of rawLines) {
    // Check if line is a hunk header: @@ -10,4 +10,5 @@ ...
    const hunkMatch = rawLine.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@(.*)$/);
    if (hunkMatch) {
      curOld = parseInt(hunkMatch[1]!, 10);
      curNew = parseInt(hunkMatch[2]!, 10);
      currentHunk = {
        header: rawLine.trim(),
        lines: [],
      };
      hunks.push(currentHunk);
      continue;
    }

    // Skip file header lines if before any hunk or at start
    if (
      !currentHunk &&
      (rawLine.startsWith("---") ||
        rawLine.startsWith("+++") ||
        rawLine.startsWith("diff ") ||
        rawLine.startsWith("index ") ||
        rawLine.startsWith("new file mode ") ||
        rawLine.startsWith("deleted file mode ") ||
        rawLine.startsWith("similarity index ") ||
        rawLine.startsWith("rename from ") ||
        rawLine.startsWith("rename to ") ||
        rawLine.startsWith("old mode ") ||
        rawLine.startsWith("new mode ") ||
        rawLine.startsWith("Binary files "))
    ) {
      continue;
    }

    // Skip git diff EOF marker
    if (rawLine.startsWith("\\ No newline at end of file")) {
      continue;
    }

    // If content lines appear before any @@ header, initialize a default hunk
    if (!currentHunk) {
      currentHunk = {
        header: "@@ Changes @@",
        lines: [],
      };
      hunks.push(currentHunk);
    }

    // Check for additions (+) with optional leading spaces or line numbers
    const trimmed = rawLine.trimStart();
    if (trimmed.startsWith("+") && !trimmed.startsWith("+++")) {
      const matchWithNum = trimmed.match(/^\+(\s*\d+)\s+(.*)$/);
      if (matchWithNum) {
        const lineNum = parseInt(matchWithNum[1]!.trim(), 10);
        currentHunk.lines.push({
          type: "add",
          text: matchWithNum[2]!,
          newLine: Number.isFinite(lineNum) ? lineNum : curNew++,
        });
      } else {
        currentHunk.lines.push({
          type: "add",
          text: trimmed.slice(1),
          newLine: curNew++,
        });
      }
      continue;
    }

    // Check for deletions (-) with optional leading spaces or line numbers
    if (trimmed.startsWith("-") && !trimmed.startsWith("---")) {
      const matchWithNum = trimmed.match(/^-(\s*\d+)\s+(.*)$/);
      if (matchWithNum) {
        const lineNum = parseInt(matchWithNum[1]!.trim(), 10);
        currentHunk.lines.push({
          type: "del",
          text: matchWithNum[2]!,
          oldLine: Number.isFinite(lineNum) ? lineNum : curOld++,
        });
      } else {
        currentHunk.lines.push({
          type: "del",
          text: trimmed.slice(1),
          oldLine: curOld++,
        });
      }
      continue;
    }

    // Context line with line number: e.g. "  5 const x = 1;"
    const ctxWithNum = rawLine.match(/^[\s](\s*\d+)\s+(.*)$/);
    if (ctxWithNum) {
      const lineNum = parseInt(ctxWithNum[1]!.trim(), 10);
      currentHunk.lines.push({
        type: "context",
        text: ctxWithNum[2]!,
        oldLine: Number.isFinite(lineNum) ? lineNum : curOld++,
        newLine: Number.isFinite(lineNum) ? lineNum : curNew++,
      });
      continue;
    }

    // Standard context line starting with space: " const x = 1;"
    if (rawLine.startsWith(" ")) {
      currentHunk.lines.push({
        type: "context",
        text: rawLine.slice(1),
        oldLine: curOld++,
        newLine: curNew++,
      });
      continue;
    }

    // Fallback context line
    if (rawLine.length > 0) {
      currentHunk.lines.push({
        type: "context",
        text: rawLine,
        oldLine: curOld++,
        newLine: curNew++,
      });
    }
  }

  return hunks;
}

export function formatToolSummary(tool: InspectedToolCall): string {
  if (!tool) return "";
  const name = tool.name || "unknown";
  const args = (typeof tool.args === "object" && tool.args !== null ? tool.args : {}) as Record<string, unknown>;

  if (name === "read") {
    const path = String(args.path ?? args.filePath ?? args.file ?? "(unknown)");
    let detail = "";
    if (typeof tool.result === "string" && tool.result.length > 0) {
      const lineCount = tool.result.split("\n").length;
      detail = ` (${lineCount} line${lineCount === 1 ? "" : "s"})`;
    }
    return `read ${path}${detail}`.trim();
  }

  if (name === "write") {
    const path = String(args.path ?? args.filePath ?? args.file ?? "(unknown)");
    let detail = "";
    const content = typeof args.content === "string" ? args.content : typeof tool.result === "string" ? tool.result : "";
    if (content) {
      const lineCount = content.split("\n").length;
      detail = ` (${lineCount} line${lineCount === 1 ? "" : "s"})`;
    }
    return `write ${path}${detail}`.trim();
  }

  if (name === "edit") {
    const path = String(args.path ?? args.filePath ?? args.file ?? "(unknown)");
    let diffStr = "";
    const diff = typeof tool.result === "string" ? tool.result : typeof args.diff === "string" ? args.diff : "";
    if (diff) {
      let add = 0;
      let del = 0;
      for (const line of diff.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) add++;
        else if (line.startsWith("-") && !line.startsWith("---")) del++;
      }
      if (add > 0 || del > 0) {
        diffStr = ` (+${add}/-${del})`;
      }
    }
    return `edit ${path}${diffStr}`.trim();
  }

  if (name === "bash" || name === "powershell") {
    const cmd = String(args.command ?? args.cmd ?? "");
    let durStr = "";
    if (typeof tool.durationMs === "number" && tool.durationMs >= 0) {
      durStr = ` (${tool.durationMs < 1000 ? `${Math.round(tool.durationMs)}ms` : `${(tool.durationMs / 1000).toFixed(1)}s`})`;
    }
    return `${name}: ${cmd || "(no command)"}${durStr}`.trim();
  }

  // Custom tools
  const entries = Object.entries(args)
    .filter(([_, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    .map(([k, v]) => `${k}=${String(v)}`);
  const argSummary = entries.length > 0 ? ` (${entries.slice(0, 2).join(", ")})` : "";
  return `${name}${argSummary}`.trim();
}

export function extractSessionToolCalls(sessionManager: any): InspectedToolCall[] {
  if (!sessionManager) return [];

  let rawEntries: any[] = [];
  if (Array.isArray(sessionManager)) {
    rawEntries = sessionManager;
  } else if (typeof sessionManager.getEntries === "function") {
    rawEntries = sessionManager.getEntries() ?? [];
    if (!rawEntries.length && typeof sessionManager.getBranch === "function") {
      rawEntries = sessionManager.getBranch() ?? [];
    }
  } else if (typeof sessionManager.getBranch === "function") {
    rawEntries = sessionManager.getBranch() ?? [];
  } else if (Array.isArray(sessionManager.messages)) {
    rawEntries = sessionManager.messages;
  } else if (Array.isArray(sessionManager.entries)) {
    rawEntries = sessionManager.entries;
  }

  const calls: InspectedToolCall[] = [];
  const callMap = new Map<string, InspectedToolCall>();

  for (let i = 0; i < rawEntries.length; i++) {
    const entry = rawEntries[i];
    if (!entry) continue;

    // Direct InspectedToolCall check
    if (typeof entry === "object" && typeof entry.name === "string" && ("args" in entry || "arguments" in entry)) {
      const id = String(entry.id || `call_${calls.length + 1}`);
      const toolCall: InspectedToolCall = {
        id,
        name: entry.name,
        args: entry.args ?? entry.arguments ?? {},
        outcome: entry.outcome ?? (entry.isError ? "failure" : entry.result !== undefined ? "success" : "running"),
        result: entry.result,
        isError: entry.isError ?? (entry.outcome === "failure"),
        timestamp: entry.timestamp ? String(entry.timestamp) : undefined,
        durationMs: entry.durationMs,
      };
      calls.push(toolCall);
      callMap.set(id, toolCall);
      continue;
    }

    const msg = entry.type === "message" && entry.message ? entry.message : entry;
    if (!msg || typeof msg !== "object") continue;

    const entryTimestamp = entry.timestamp ? String(entry.timestamp) : msg.timestamp ? String(msg.timestamp) : undefined;

    // 1. Assistant message with tool calls
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && typeof block === "object" && (block.type === "toolCall" || block.type === "tool_use")) {
          const id = String(block.id || `call_${calls.length + 1}`);
          let args = block.arguments ?? block.args ?? {};
          if (typeof args === "string") {
            try {
              args = JSON.parse(args);
            } catch {
              // keep as string
            }
          }
          const toolCall: InspectedToolCall = {
            id,
            name: String(block.name || "unknown"),
            args,
            outcome: "running",
            isError: false,
            timestamp: entryTimestamp,
          };
          calls.push(toolCall);
          callMap.set(id, toolCall);
        }
      }
    }

    // 2. Tool result message
    if (msg.role === "toolResult" || msg.type === "tool_result") {
      const toolCallId = String(msg.toolCallId || msg.tool_call_id || entry.id || `result_${calls.length + 1}`);
      const details = msg.details as Record<string, unknown> | undefined;

      let resultText = "";
      if (Array.isArray(msg.content)) {
        resultText = msg.content
          .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
          .filter(Boolean)
          .join("\n");
      } else if (typeof msg.content === "string") {
        resultText = msg.content;
      } else if (typeof msg.result === "string") {
        resultText = msg.result;
      } else if (details?.error) {
        resultText = String(details.error);
      } else if (details?.diff) {
        resultText = String(details.diff);
      }

      const isInterrupted = details?.interrupted === true
        || details?.aborted === true
        || details?.cancelled === true
        || details?.exitCode === 130
        || details?.signal === "SIGINT"
        || details?.signal === "SIGTERM";

      let outcome: "running" | "success" | "failure" | "interrupted" = "success";
      if (isInterrupted) {
        outcome = "interrupted";
      } else if (msg.isError || details?.error || (typeof details?.exitCode === "number" && details.exitCode !== 0)) {
        outcome = "failure";
      } else {
        outcome = "success";
      }

      const isError = outcome === "failure" || Boolean(msg.isError);
      const durationMs = typeof msg.durationMs === "number" ? msg.durationMs : undefined;

      const existing = callMap.get(toolCallId);
      if (existing) {
        existing.outcome = outcome;
        existing.result = resultText;
        existing.isError = isError;
        if (durationMs !== undefined) existing.durationMs = durationMs;
        if (!existing.timestamp && entryTimestamp) existing.timestamp = entryTimestamp;
      } else {
        const toolCall: InspectedToolCall = {
          id: toolCallId,
          name: String(msg.toolName || msg.name || "tool"),
          args: {},
          outcome,
          result: resultText,
          isError,
          timestamp: entryTimestamp,
          durationMs,
        };
        calls.push(toolCall);
        callMap.set(toolCallId, toolCall);
      }
    }

    // 3. Bash execution message
    if (msg.role === "bashExecution") {
      const isCancelled = Boolean(msg.cancelled);
      const isFailure = typeof msg.exitCode === "number" && msg.exitCode !== 0;
      const outcome = isCancelled ? "interrupted" : isFailure ? "failure" : "success";
      const id = String(entry.id || msg.id || `bash_${calls.length + 1}`);

      const toolCall: InspectedToolCall = {
        id,
        name: "bash",
        args: { command: String(msg.command ?? "") },
        outcome,
        result: String(msg.output ?? ""),
        isError: isCancelled || isFailure,
        timestamp: entryTimestamp,
        durationMs: typeof msg.durationMs === "number" ? msg.durationMs : undefined,
      };
      calls.push(toolCall);
      callMap.set(id, toolCall);
    }
  }

  return calls;
}


export { fgSafe, boldSafe, dimSafe, formatDuration, renderOutcomeBadge };

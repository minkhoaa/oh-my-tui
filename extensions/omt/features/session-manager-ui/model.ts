import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type Component, type TUI } from "@earendil-works/pi-tui";
import { copyToClipboard, SessionManager, type Theme } from "@earendil-works/pi-coding-agent";
import type { SessionItem, ExportFormat, ConversationExportOptions, SessionManagerOptions, SessionManagerFactory } from "./types.ts";


export type {
  SessionItem,
  ExportFormat,
  ConversationExportOptions,
  SessionManagerOptions,
  SessionManagerFactory,
};

export const EXPORT_FORMATS: readonly ExportFormat[] = [
  "markdown",
  "json",
  "html",
  "text",
] as const;

/**
 * Safely invoke theme.fg with fallback to plain text.
 */
function safeFg(theme: Theme | undefined, color: Parameters<Theme["fg"]>[0], text: string): string {
  try {
    if (theme && typeof theme.fg === "function") {
      return theme.fg(color, text);
    }
  } catch {
    // Ignore fallback
  }
  return text;
}

/**
 * Safely invoke theme.bold with fallback to plain text.
 */
function safeBold(theme: Theme | undefined, text: string): string {
  try {
    if (theme && typeof theme.bold === "function") {
      return theme.bold(text);
    }
  } catch {
    // Ignore fallback
  }
  return text;
}

/**
 * Safely invoke theme.dim with fallback.
 */
function safeDim(theme: Theme | undefined, text: string): string {
  try {
    if (theme && typeof (theme as any).dim === "function") {
      return (theme as any).dim(text);
    }
    return safeFg(theme, "dim" as any, text);
  } catch {
    return text;
  }
}

/**
 * Copy text to clipboard safely in any environment.
 */
export async function copyContentToClipboard(text: string): Promise<boolean> {
  try {
    await copyToClipboard(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format timestamp into concise display date/time.
 */
export function formatSessionTimestamp(timestamp?: string): string {
  if (!timestamp) return "N/A";
  try {
    const d = new Date(timestamp);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${day} ${hh}:${mm}`;
    }
  } catch {
    // Return original snippet
  }
  return timestamp.slice(0, 16);
}

/**
 * Format token count with SI suffix (k, M).
 */
export function formatTokenCount(tokens?: number): string {
  if (tokens === undefined || tokens === null || tokens === 0) return "0 tokens";
  if (tokens < 1000) return `${tokens} tokens`;
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k tokens`;
  return `${(tokens / 1000000).toFixed(2)}M tokens`;
}

/**
 * Format summary string of a session item for copying or display.
 */
export function formatSessionSummary(session: SessionItem): string {
  const parts: string[] = [
    `Session ID: ${session.id}`,
    session.name ? `Name: ${session.name}` : undefined,
    session.timestamp ? `Timestamp: ${session.timestamp}` : undefined,
    session.messageCount !== undefined ? `Messages: ${session.messageCount}` : undefined,
    session.tokenUsage !== undefined && session.tokenUsage > 0
      ? `Tokens: ${session.tokenUsage}`
      : undefined,
    session.filePath ? `File: ${session.filePath}` : undefined,
  ].filter((p): p is string => Boolean(p));

  return parts.join("\n");
}

/**
 * Parse an individual JSON or JSONL session file to extract a SessionItem.
 */
async function parseSessionFile(filePath: string): Promise<SessionItem | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    if (!content.trim()) return null;

    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;

    let id = path.basename(filePath, path.extname(filePath));
    let timestamp: string | undefined;
    let name: string | undefined;
    let messageCount = 0;
    let tokenUsage = 0;
    let firstUserText: string | undefined;

    let validEntries = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (!entry || typeof entry !== "object") continue;
        validEntries++;

        if (entry.type === "session" && entry.id) {
          id = entry.id;
          if (entry.timestamp) timestamp = entry.timestamp;
        } else if (entry.type === "session_info" && entry.name) {
          name = entry.name;
        } else if (entry.type === "message") {
          messageCount++;
          if (entry.timestamp && !timestamp) timestamp = entry.timestamp;
          if (!firstUserText && entry.message?.role === "user") {
            const raw = entry.message.content;
            if (typeof raw === "string") {
              firstUserText = raw.trim();
            } else if (Array.isArray(raw)) {
              const textBlock = raw.find((b: any) => b?.type === "text" && typeof b.text === "string");
              if (textBlock) firstUserText = textBlock.text.trim();
            }
          }
        } else if (entry.type === "usage" && entry.usage) {
          const total = entry.usage.totalTokens ?? entry.usage.inputTokens ?? 0;
          tokenUsage += typeof total === "number" ? total : 0;
        }
      } catch {
        // Skip malformed individual lines
      }
    }

    if (validEntries === 0) return null;

    if (!timestamp) {
      try {
        const stat = await fs.stat(filePath);
        timestamp = stat.mtime.toISOString();
      } catch {
        // Keep undefined
      }
    }

    return {
      id,
      filePath,
      name: name || (firstUserText ? firstUserText.slice(0, 40) : undefined),
      timestamp,
      messageCount,
      tokenUsage,
    };
  } catch {
    return null;
  }
}

/**
 * Helper to extract session list from directory or options.
 */
export async function extractSessionList(
  sessionDir?: string,
  options?: SessionManagerOptions,
  cwd?: string,
): Promise<SessionItem[]> {
  // 1. If options.sessions is provided, use it
  if (options?.sessions && options.sessions.length > 0) {
    return [...options.sessions];
  }

  const results: SessionItem[] = [];
  const targetCwd = cwd ?? process.cwd();

  // 2. Attempt using SessionManager.list from @earendil-works/pi-coding-agent
  try {
    const list = await SessionManager.list(targetCwd, sessionDir);
    if (Array.isArray(list) && list.length > 0) {
      for (const item of list) {
        results.push({
          id: item.id,
          filePath: item.path,
          name: item.name || (item.firstMessage ? item.firstMessage.slice(0, 50).replace(/\n/g, " ") : undefined),
          timestamp: item.modified instanceof Date
            ? item.modified.toISOString()
            : item.created instanceof Date
            ? item.created.toISOString()
            : undefined,
          messageCount: item.messageCount ?? 0,
          tokenUsage: 0,
        });
      }
      return results;
    }
  } catch {
    // Fall back to direct filesystem inspection
  }

  // 3. Fallback: inspect session directory directly if available
  if (sessionDir) {
    try {
      const entries = await fs.readdir(sessionDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === ".jsonl" || ext === ".json") {
          const fullPath = path.join(sessionDir, entry.name);
          const parsed = await parseSessionFile(fullPath);
          if (parsed) {
            results.push(parsed);
          }
        }
      }
    } catch {
      // Directory may not exist or be accessible
    }
  }

  // Sort descending by timestamp (newest first)
  results.sort((a, b) => {
    const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tB - tA;
  });

  return results;
}

/**
 * Normalized turn for export formatting.
 */
interface NormalizedExportTurn {
  role: "user" | "assistant" | "system" | "tool" | "compaction" | "branch";
  text: string;
  timestamp?: string;
  thinking?: string;
  toolCalls?: Array<{ name: string; args: unknown; id?: string }>;
  toolResults?: Array<{ name?: string; content: string; isError?: boolean }>;
  summary?: string;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Extract clean string text and sub-elements from varied message contents.
 */
function normalizeSessionEntries(
  entries: unknown[],
  options: ConversationExportOptions,
): NormalizedExportTurn[] {
  const turns: NormalizedExportTurn[] = [];
  const includeTools = options.includeTools !== false;
  const includeSystem = options.includeSystem === true;

  for (const item of entries) {
    if (!item || typeof item !== "object") continue;
    const anyItem = item as Record<string, any>;

    // Case 1: Session Header
    if (anyItem.type === "session") {
      continue;
    }

    // Case 2: Compaction Entry
    if (anyItem.type === "compaction") {
      turns.push({
        role: "compaction",
        text: anyItem.summary || "Conversation history compacted",
        timestamp: anyItem.timestamp,
        summary: anyItem.summary,
      });
      continue;
    }

    // Case 3: Branch Summary Entry
    if (anyItem.type === "branch_summary") {
      turns.push({
        role: "branch",
        text: anyItem.summary || "Branch summary",
        timestamp: anyItem.timestamp,
        summary: anyItem.summary,
      });
      continue;
    }

    // Case 4: Custom Message Entry
    if (anyItem.type === "custom_message") {
      let contentStr = "";
      if (typeof anyItem.content === "string") {
        contentStr = anyItem.content;
      } else if (Array.isArray(anyItem.content)) {
        contentStr = anyItem.content
          .map((b: any) => (typeof b === "string" ? b : b?.text ?? ""))
          .join("\n");
      }
      turns.push({
        role: "user",
        text: contentStr.trim(),
        timestamp: anyItem.timestamp,
      });
      continue;
    }

    // Case 5: Tool Execution Start & End entries
    if (anyItem.type === "tool_execution_start") {
      if (includeTools) {
        turns.push({
          role: "assistant",
          text: "",
          toolCalls: [{
            name: anyItem.toolName ?? anyItem.name ?? "tool",
            args: anyItem.args ?? anyItem.arguments ?? {},
            id: anyItem.id,
          }],
          timestamp: anyItem.timestamp,
        });
      }
      continue;
    }

    if (anyItem.type === "tool_execution_end") {
      if (includeTools) {
        let resContent = "";
        if (typeof anyItem.result === "string") {
          resContent = anyItem.result;
        } else if (typeof anyItem.content === "string") {
          resContent = anyItem.content;
        } else if (Array.isArray(anyItem.content)) {
          resContent = anyItem.content
            .map((b: any) => (typeof b === "string" ? b : b?.text ?? JSON.stringify(b)))
            .join("\n");
        } else if (anyItem.result !== undefined) {
          resContent = JSON.stringify(anyItem.result);
        }
        turns.push({
          role: "tool",
          text: "",
          toolResults: [{
            name: anyItem.toolName ?? anyItem.name ?? "tool",
            content: resContent.trim(),
            isError: anyItem.isError === true,
          }],
          timestamp: anyItem.timestamp,
        });
      }
      continue;
    }

    // Case 6: Message Entry or Raw Message
    const msg = anyItem.type === "message" ? anyItem.message : anyItem;
    if (!msg || typeof msg !== "object") continue;

    const role = (msg.role ?? anyItem.role) as string;
    const timestamp = anyItem.timestamp ?? msg.timestamp;

    if (role === "system") {
      if (!includeSystem) continue;
      const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      turns.push({
        role: "system",
        text: text.trim(),
        timestamp,
      });
      continue;
    }

    if (role === "user") {
      let text = "";
      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === "string") {
            text += block + "\n";
          } else if (block?.type === "text" && typeof block.text === "string") {
            text += block.text + "\n";
          } else if (block?.type === "image") {
            text += "[Image]\n";
          }
        }
      }
      turns.push({
        role: "user",
        text: text.trim(),
        timestamp,
      });
      continue;
    }

    if (role === "assistant") {
      let text = "";
      let thinking = "";
      const toolCalls: Array<{ name: string; args: unknown; id?: string }> = [];

      if (typeof msg.thinking === "string") {
        thinking += msg.thinking + "\n";
      }

      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (!block) continue;
          if (typeof block === "string") {
            text += block + "\n";
          } else if (block.type === "text" && typeof block.text === "string") {
            text += block.text + "\n";
          } else if (block.type === "thinking" && typeof block.thinking === "string") {
            thinking += block.thinking + "\n";
          } else if (block.type === "toolCall") {
            if (includeTools) {
              toolCalls.push({
                name: block.name ?? "tool",
                args: block.arguments ?? {},
                id: block.id,
              });
            }
          }
        }
      }

      if (text.trim().length > 0 || thinking.trim().length > 0 || toolCalls.length > 0) {
        turns.push({
          role: "assistant",
          text: text.trim(),
          thinking: thinking.trim().length > 0 ? thinking.trim() : undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          timestamp,
        });
      }
      continue;
    }

    if (role === "toolResult" || role === "tool") {
      if (!includeTools) continue;
      let resContent = "";
      if (typeof msg.content === "string") {
        resContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        resContent = msg.content
          .map((b: any) => (typeof b === "string" ? b : b?.text ?? JSON.stringify(b)))
          .join("\n");
      }
      turns.push({
        role: "tool",
        text: "",
        toolResults: [
          {
            name: msg.toolName ?? "tool",
            content: resContent.trim(),
            isError: msg.isError === true,
          },
        ],
        timestamp,
      });
      continue;
    }

    if (role === "bashExecution") {
      if (!includeTools) continue;
      turns.push({
        role: "tool",
        text: "",
        toolResults: [
          {
            name: "bash",
            content: (msg.output ?? "").trim(),
            isError: msg.exitCode !== 0,
          },
        ],
        timestamp,
      });
      continue;
    }
  }

  return turns;
}

/**
 * Format conversation as Markdown document.
 */
function exportToMarkdown(turns: NormalizedExportTurn[]): string {
  const lines: string[] = ["# Conversation Export", ""];

  for (const turn of turns) {
    if (turn.role === "user") {
      lines.push("## User");
      if (turn.timestamp) lines.push(`*${turn.timestamp}*`);
      lines.push("");
      lines.push(turn.text);
      lines.push("");
    } else if (turn.role === "assistant") {
      lines.push("## Assistant");
      if (turn.timestamp) lines.push(`*${turn.timestamp}*`);
      lines.push("");

      if (turn.thinking) {
        lines.push("> **Thinking:**");
        const thinkingLines = turn.thinking.split("\n");
        for (const tLine of thinkingLines) {
          lines.push(`> ${tLine}`);
        }
        lines.push("");
      }

      if (turn.text) {
        lines.push(turn.text);
        lines.push("");
      }

      if (turn.toolCalls && turn.toolCalls.length > 0) {
        for (const call of turn.toolCalls) {
          lines.push(`**Tool Call: \`${call.name}\`**`);
          lines.push("```json");
          lines.push(JSON.stringify(call.args, null, 2));
          lines.push("```");
          lines.push("");
        }
      }
    } else if (turn.role === "tool") {
      if (turn.toolResults && turn.toolResults.length > 0) {
        for (const res of turn.toolResults) {
          lines.push(`**Tool Result (\`${res.name ?? "tool"}\`):**`);
          lines.push("```");
          lines.push(res.content);
          lines.push("```");
          lines.push("");
        }
      }
    } else if (turn.role === "system") {
      lines.push("## System");
      if (turn.timestamp) lines.push(`*${turn.timestamp}*`);
      lines.push("");
      lines.push(turn.text);
      lines.push("");
    } else if (turn.role === "compaction") {
      lines.push(`> 📦 **Compaction Summary:** ${turn.summary ?? turn.text}`);
      lines.push("");
    } else if (turn.role === "branch") {
      lines.push(`> 🌿 **Branch Summary:** ${turn.summary ?? turn.text}`);
      lines.push("");
    }
  }

  return lines.join("\n").trim() + "\n";
}

/**
 * Format conversation as structured JSON document.
 */
function exportToJson(turns: NormalizedExportTurn[]): string {
  const exportPayload = {
    exportDate: new Date().toISOString(),
    messageCount: turns.length,
    messages: turns.map((t) => {
      const obj: Record<string, unknown> = {
        role: t.role,
        content: t.text,
      };
      if (t.timestamp) obj.timestamp = t.timestamp;
      if (t.thinking) obj.thinking = t.thinking;
      if (t.toolCalls) obj.toolCalls = t.toolCalls;
      if (t.toolResults) obj.toolResults = t.toolResults;
      if (t.summary) obj.summary = t.summary;
      return obj;
    }),
  };

  return JSON.stringify(exportPayload, null, 2);
}

/**
 * Format conversation as clean semantic HTML5 with CSS styling.
 */
function exportToHtml(turns: NormalizedExportTurn[]): string {
  const messageBlocks: string[] = [];

  for (const turn of turns) {
    const roleClass = `badge-${turn.role}`;
    const roleTitle = turn.role.toUpperCase();
    const timeHtml = turn.timestamp ? `<span class="timestamp">${escapeHtml(turn.timestamp)}</span>` : "";

    let bodyHtml = "";
    if (turn.thinking) {
      bodyHtml += `<div class="thinking"><strong>Thinking:</strong><br>${escapeHtml(turn.thinking)}</div>`;
    }
    if (turn.text) {
      bodyHtml += `<div class="content">${escapeHtml(turn.text)}</div>`;
    }
    if (turn.toolCalls && turn.toolCalls.length > 0) {
      for (const call of turn.toolCalls) {
        bodyHtml += `<div class="tool-call"><div class="tool-title">Tool Call: ${escapeHtml(call.name)}</div><pre><code>${escapeHtml(
          JSON.stringify(call.args, null, 2),
        )}</code></pre></div>`;
      }
    }
    if (turn.toolResults && turn.toolResults.length > 0) {
      for (const res of turn.toolResults) {
        bodyHtml += `<div class="tool-result"><div class="tool-title">Tool Result (${escapeHtml(res.name ?? "tool")})</div><pre><code>${escapeHtml(
          res.content,
        )}</code></pre></div>`;
      }
    }
    if (turn.role === "compaction" || turn.role === "branch") {
      bodyHtml += `<div class="summary-badge">${escapeHtml(turn.summary ?? turn.text)}</div>`;
    }

    messageBlocks.push(`
    <section class="message message-${turn.role}">
      <header class="message-header">
        <span class="badge ${roleClass}">${roleTitle}</span>
        ${timeHtml}
      </header>
      <div class="message-body">
        ${bodyHtml}
      </div>
    </section>`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Conversation Export</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --code-bg: #030712;
      --thinking-bg: #1f2937;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      background: var(--bg);
      color: var(--text);
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem 1rem;
    }
    h1 {
      border-bottom: 2px solid var(--border);
      padding-bottom: 0.5rem;
      margin-bottom: 1.5rem;
      color: var(--accent);
      font-size: 1.6rem;
    }
    .message {
      margin-bottom: 1.5rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--card-bg);
    }
    .message-header {
      padding: 0.5rem 1rem;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .badge {
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: bold;
      letter-spacing: 0.05em;
    }
    .badge-user { background: #1e3a8a; color: #93c5fd; }
    .badge-assistant { background: #064e3b; color: #6ee7b7; }
    .badge-tool { background: #4c1d95; color: #c4b5fd; }
    .badge-system { background: #374151; color: #d1d5db; }
    .badge-compaction { background: #78350f; color: #fde68a; }
    .badge-branch { background: #14532d; color: #bbf7d0; }
    .timestamp { color: var(--text-muted); font-size: 0.8rem; }
    .message-body { padding: 1rem; }
    .content { white-space: pre-wrap; word-break: break-word; }
    .thinking {
      background: var(--thinking-bg);
      border-left: 3px solid #6b7280;
      padding: 0.75rem 1rem;
      margin-bottom: 1rem;
      border-radius: 4px;
      color: #d1d5db;
      font-style: italic;
      white-space: pre-wrap;
    }
    .tool-call, .tool-result {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.75rem;
      margin-top: 0.75rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.85rem;
    }
    .tool-title { font-weight: bold; color: var(--accent); margin-bottom: 0.4rem; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
    .summary-badge { font-style: italic; color: #fbbf24; }
  </style>
</head>
<body>
  <h1>Conversation Export</h1>
  ${messageBlocks.join("\n")}
</body>
</html>`;
}

/**
 * Format conversation as clean plain text.
 */
function exportToText(turns: NormalizedExportTurn[]): string {
  const divider = "=".repeat(80);
  const subDivider = "-".repeat(80);
  const lines: string[] = [divider, "CONVERSATION EXPORT", divider, ""];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const timeStr = turn.timestamp ? ` (${turn.timestamp})` : "";
    lines.push(`[${turn.role.toUpperCase()}]${timeStr}`);

    if (turn.thinking) {
      lines.push("Thinking:");
      lines.push(turn.thinking);
      lines.push("");
    }

    if (turn.text) {
      lines.push(turn.text);
      lines.push("");
    }

    if (turn.toolCalls && turn.toolCalls.length > 0) {
      for (const call of turn.toolCalls) {
        lines.push(`Tool Call: ${call.name}`);
        lines.push("Arguments:");
        lines.push(JSON.stringify(call.args, null, 2));
        lines.push("");
      }
    }

    if (turn.toolResults && turn.toolResults.length > 0) {
      for (const res of turn.toolResults) {
        lines.push(`Tool Result (${res.name ?? "tool"}):`);
        lines.push(res.content);
        lines.push("");
      }
    }

    if (turn.role === "compaction" || turn.role === "branch") {
      lines.push(`Summary: ${turn.summary ?? turn.text}`);
      lines.push("");
    }

    if (i < turns.length - 1) {
      lines.push(subDivider);
      lines.push("");
    }
  }

  lines.push(divider);
  return lines.join("\n") + "\n";
}

/**
 * Export a conversation session across Markdown, JSON, HTML, or plain text.
 */
export function exportConversation(
  sessionEntries: unknown[],
  options: ConversationExportOptions = {},
): string {
  if (!Array.isArray(sessionEntries) || sessionEntries.length === 0) {
    const fmt = options.format ?? "markdown";
    if (fmt === "json") {
      return JSON.stringify({ exportDate: new Date().toISOString(), messageCount: 0, messages: [] }, null, 2);
    }
    if (fmt === "html") {
      return exportToHtml([]);
    }
    if (fmt === "text") {
      return exportToText([]);
    }
    return "# Conversation Export\n\n*(Empty session)*\n";
  }

  const turns = normalizeSessionEntries(sessionEntries, options);
  const format = options.format ?? "markdown";

  switch (format) {
    case "json":
      return exportToJson(turns);
    case "html":
      return exportToHtml(turns);
    case "text":
      return exportToText(turns);
    case "markdown":
    default:
      return exportToMarkdown(turns);
  }
}

/**
 * Filter sessions by search query across id, name, timestamp, or filePath.
 */
export function filterSessions(sessions: SessionItem[], query: string): SessionItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...sessions];

  return sessions.filter((s) => {
    if (s.id.toLowerCase().includes(trimmed)) return true;
    if (s.name && s.name.toLowerCase().includes(trimmed)) return true;
    if (s.timestamp && s.timestamp.toLowerCase().includes(trimmed)) return true;
    if (s.filePath && s.filePath.toLowerCase().includes(trimmed)) return true;
    return false;
  });
}

/**
 * Interactive Session Manager Component for Oh My TUI.
 */

export { safeFg, safeBold, safeDim };

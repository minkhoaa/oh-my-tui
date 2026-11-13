import { fuzzyMatch, truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import { type Theme } from "@earendil-works/pi-coding-agent";
import type { NavEntryCategory, NavigatableItem } from "./types.ts";


export const NAV_CATEGORIES: readonly NavEntryCategory[] = [
  "all",
  "user",
  "assistant",
  "tool",
  "error",
  "bookmark",
] as const;

/**
 * Safely invoke theme.fg with graceful fallback to plain text.
 */
function safeFg(theme: Theme | undefined, color: Parameters<Theme["fg"]>[0], text: string): string {
  try {
    if (theme && typeof theme.fg === "function") {
      return theme.fg(color, text);
    }
  } catch {
    // Fallback if theme is uninitialized or token missing
  }
  return text;
}

/**
 * Safely invoke theme.bold with graceful fallback to plain text.
 */
function safeBold(theme: Theme | undefined, text: string): string {
  try {
    if (theme && typeof theme.bold === "function") {
      return theme.bold(text);
    }
  } catch {
    // Fallback if theme is uninitialized
  }
  return text;
}

/**
 * Safely format an entry timestamp into an ISO string or undefined.
 */
function formatEntryTimestamp(entry: any): string | undefined {
  if (!entry) return undefined;
  if (typeof entry.timestamp === "string") return entry.timestamp;
  if (typeof entry.timestamp === "number") return new Date(entry.timestamp).toISOString();
  if (entry.message && typeof entry.message.timestamp === "number") {
    return new Date(entry.message.timestamp).toISOString();
  }
  return undefined;
}

/**
 * Format timestamp for concise display in entry rows or preview pane.
 */
function formatTimestamp(timestamp: string): string {
  if (!timestamp) return "";
  const match = timestamp.match(/T(\d{2}:\d{2}(?::\d{2})?)/);
  if (match) return match[1]!;
  const d = new Date(timestamp);
  if (!isNaN(d.getTime())) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  return timestamp.slice(0, 8);
}

/**
 * Extract plain text from varied message content types.
 */
function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const block of content) {
    if (typeof block === "string") {
      text += block + " ";
    } else if (typeof block === "object" && block !== null) {
      if ("text" in block && typeof (block as any).text === "string") {
        text += (block as any).text + " ";
      }
    }
  }
  return text.trim();
}

/**
 * Determine whether an assistant message includes reasoning / thinking content.
 */
function hasThinkingContent(message: any): boolean {
  if (!message) return false;
  if (message.thinkingLevel || message.providerThinkingLevel) return true;
  if (message.usage?.reasoning) return true;
  if (Array.isArray(message.content)) {
    return message.content.some(
      (b: any) => b && (b.type === "thinking" || typeof b.thinking === "string"),
    );
  }
  return false;
}

/**
 * Extract thinking text snippet if available.
 */
function extractThinkingText(message: any): string {
  if (!message || !Array.isArray(message.content)) return "";
  for (const b of message.content) {
    if (b && typeof b === "object" && (b.type === "thinking" || typeof b.thinking === "string")) {
      return typeof b.thinking === "string" ? b.thinking : "";
    }
  }
  return "";
}

/**
 * Format tool arguments into a concise preview string.
 */
function formatArgsPreview(args: unknown): string {
  if (!args) return "";
  if (typeof args === "string") return args.slice(0, 80);
  try {
    const obj = args as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return "";
    return keys
      .map((k) => `${k}: ${typeof obj[k] === "string" ? `"${obj[k]}"` : JSON.stringify(obj[k])}`)
      .join(", ")
      .slice(0, 100);
  } catch {
    return String(args).slice(0, 80);
  }
}

/**
 * Category badge text for rendering.
 */
function formatCategoryBadge(category: string): string {
  switch (category) {
    case "user":
      return "[USER]";
    case "assistant":
      return "[ASST]";
    case "tool":
      return "[TOOL]";
    case "error":
      return "[ERR ]";
    case "bookmark":
      return "[MARK]";
    default:
      return `[${category.toUpperCase().slice(0, 4)}]`;
  }
}

/**
 * Apply semantic theme color to category badges safely.
 */
function formatCategoryBadgeStyled(theme: Theme | undefined, category: string, badge: string): string {
  switch (category) {
    case "user":
      return safeFg(theme, "accent", badge);
    case "assistant":
      return safeFg(theme, "success", badge);
    case "tool":
      return safeFg(theme, "warning", badge);
    case "error":
      return safeFg(theme, "error", badge);
    case "bookmark":
      return safeFg(theme, "accent", badge);
    default:
      return safeFg(theme, "muted", badge);
  }
}

/**
 * Wrap or slice a preview string into bounded lines without overflowing maxWidth.
 */
function wrapOrSlicePreview(text: string, maxWidth: number, maxLines: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (maxWidth <= 0) return [normalized.slice(0, 10)];
  const lines: string[] = [];
  let remaining = normalized;
  while (remaining.length > 0 && lines.length < maxLines) {
    if (remaining.length <= maxWidth) {
      lines.push(remaining);
      break;
    }
    let breakPoint = remaining.lastIndexOf(" ", maxWidth);
    if (breakPoint <= 0 || breakPoint < Math.floor(maxWidth / 2)) {
      breakPoint = maxWidth;
    }
    lines.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }
  if (remaining.length > 0 && lines.length > 0) {
    lines[lines.length - 1] = truncateToWidth(lines[lines.length - 1]! + "...", maxWidth);
  }
  return lines;
}

/**
 * Extracts navigatable items from sessionManager entries (strictly read-only).
 */
export function extractNavigatableEntries(sessionManager: any): NavigatableItem[] {
  if (!sessionManager || typeof sessionManager !== "object") {
    return [];
  }

  let entries: any[] | undefined;
  if (typeof sessionManager.getEntries === "function") {
    try {
      entries = sessionManager.getEntries();
    } catch {
      // Fall through
    }
  }

  if (!Array.isArray(entries) && typeof sessionManager.getBranch === "function") {
    try {
      entries = sessionManager.getBranch();
    } catch {
      // Fall through
    }
  }

  if (!Array.isArray(entries)) {
    return [];
  }

  const items: NavigatableItem[] = [];

  // Pass 1: Build a toolCallId -> toolCall map from assistant messages
  const toolCallMap = new Map<string, { id: string; name: string; arguments?: any }>();
  const toolResultCallIds = new Set<string>();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type === "message" && entry.message) {
      if (entry.message.role === "assistant" && Array.isArray(entry.message.content)) {
        for (const block of entry.message.content) {
          if (block && typeof block === "object" && (block.type === "toolCall" || block.type === "tool_call")) {
            toolCallMap.set(block.id, { id: block.id, name: block.name, arguments: block.arguments });
          }
        }
      } else if (entry.message.role === "toolResult" && entry.message.toolCallId) {
        toolResultCallIds.add(entry.message.toolCallId);
      }
    }
  }

  // Pass 2: Extract navigatable items
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry !== "object") continue;
    if (entry.type === "session") continue; // Session header entry

    const entryId = String(entry.id || `entry-${i}`);
    const timestamp = formatEntryTimestamp(entry);
    const existingLabel =
      typeof sessionManager.getLabel === "function" ? sessionManager.getLabel(entry.id) : undefined;

    // 1. Labels / Bookmarks
    if (entry.type === "label") {
      const label = entry.label;
      const targetId = entry.targetId;
      const title = label ? `Bookmark: ${label}` : "Bookmark";
      const preview = label
        ? `Label: ${label}`
        : targetId
          ? `Target: ${targetId}`
          : "Bookmark";
      items.push({
        id: entryId,
        category: "bookmark",
        role: "bookmark",
        title,
        preview,
        timestamp,
        targetId,
        label,
      });
      continue;
    }

    // 2. Compaction entries
    if (entry.type === "compaction" || entry.role === "compaction") {
      const summary = typeof entry.summary === "string" ? entry.summary.trim() : "Compaction summary";
      const tokens = typeof entry.tokensBefore === "number" ? Math.round(entry.tokensBefore / 1000) : undefined;
      const title = tokens !== undefined ? `Compaction (${tokens}k tokens)` : "Compaction Summary";
      items.push({
        id: entryId,
        category: "assistant",
        role: "compaction",
        title,
        preview: summary.replace(/\s+/g, " "),
        timestamp,
        label: existingLabel,
      });
      continue;
    }

    // 3. Branch summary entries
    if (entry.type === "branch_summary" || entry.role === "branch_summary") {
      const summary = typeof entry.summary === "string" ? entry.summary.trim() : "Branch summary";
      items.push({
        id: entryId,
        category: "assistant",
        role: "branch_summary",
        title: "Branch Summary",
        preview: summary.replace(/\s+/g, " "),
        timestamp,
        label: existingLabel,
      });
      continue;
    }

    // 4. Standalone error entries
    if (entry.type === "error") {
      const errText = entry.error || entry.message || "Unknown error";
      items.push({
        id: entryId,
        category: "error",
        role: "error",
        title: "Error",
        preview: String(errText).replace(/\s+/g, " "),
        isError: true,
        timestamp,
        label: existingLabel,
      });
      continue;
    }

    // 5. Standalone tool call entries
    if (entry.type === "tool_call" || entry.type === "toolCall") {
      const name = entry.toolName || entry.name || "tool";
      const argsStr = formatArgsPreview(entry.arguments);
      const isInterrupted = entry.status === "interrupted" || entry.cancelled === true;
      const isError = entry.isError === true || entry.status === "error";
      const status = isInterrupted ? "interrupted" : isError ? "error" : "success";
      items.push({
        id: entryId,
        category: isError ? "error" : "tool",
        role: "tool",
        title: `Tool: ${name} (${status})`,
        preview: argsStr ? `args: ${argsStr}` : `Tool: ${name}`,
        isError: isError || isInterrupted,
        timestamp,
        label: existingLabel,
      });
      continue;
    }

    // 6. Messages
    if (entry.type === "message" && entry.message) {
      const msg = entry.message;
      const role = msg.role;

      // User Message
      if (role === "user") {
        const text = extractTextFromContent(msg.content);
        const firstLine = text.trim().split("\n")[0] || "User Message";
        const title = firstLine.length > 50 ? `${firstLine.slice(0, 47)}...` : firstLine;
        const preview = text.replace(/\s+/g, " ").trim() || "(empty message)";
        items.push({
          id: entryId,
          category: "user",
          role: "user",
          title,
          preview,
          timestamp,
          label: existingLabel,
        });
        continue;
      }

      // Assistant Message
      if (role === "assistant") {
        const text = extractTextFromContent(msg.content);
        const hasThinking = hasThinkingContent(msg);
        const thinkingText = extractThinkingText(msg);
        const isError = Boolean(msg.errorMessage || msg.stopReason === "error");
        const category = isError ? "error" : "assistant";
        const title = isError
          ? "Assistant (Error)"
          : hasThinking
            ? "Assistant [thinking]"
            : "Assistant";

        let preview = "";
        if (isError) {
          preview = msg.errorMessage || "Assistant encountered an error";
        } else if (text) {
          preview = (hasThinking ? "[thinking] " : "") + text.replace(/\s+/g, " ").trim();
        } else if (thinkingText) {
          preview = `[thinking] ${thinkingText.replace(/\s+/g, " ").trim()}`;
        } else {
          preview = "(no text content)";
        }

        items.push({
          id: entryId,
          category,
          role: "assistant",
          title,
          preview,
          isError,
          timestamp,
          label: existingLabel,
        });
        continue;
      }

      // Tool Result Message
      if (role === "toolResult") {
        const toolName = msg.toolName || "tool";
        const toolCall = msg.toolCallId ? toolCallMap.get(msg.toolCallId) : undefined;
        const argsStr = toolCall
          ? formatArgsPreview(toolCall.arguments)
          : msg.details
            ? formatArgsPreview(msg.details)
            : "";
        const isInterrupted =
          msg.cancelled === true ||
          msg.details?.interrupted === true ||
          msg.stopReason === "interrupted" ||
          msg.stopReason === "aborted";
        const isError =
          msg.isError === true ||
          (!isInterrupted && msg.exitCode !== undefined && msg.exitCode !== 0);
        const status = isInterrupted ? "interrupted" : isError ? "error" : "success";
        const resultText = extractTextFromContent(msg.content);

        let preview = "";
        if (argsStr && resultText) {
          preview = `args: (${argsStr}) -> ${resultText.replace(/\s+/g, " ").slice(0, 100)}`;
        } else if (argsStr) {
          preview = `args: (${argsStr})`;
        } else if (resultText) {
          preview = resultText.replace(/\s+/g, " ").slice(0, 100);
        } else {
          preview = `Tool result: ${status}`;
        }

        items.push({
          id: entryId,
          category: isError ? "error" : "tool",
          role: "toolResult",
          title: `Tool: ${toolName} (${status})`,
          preview,
          isError: isError || isInterrupted,
          timestamp,
          label: existingLabel,
        });
        continue;
      }

      // Bash Execution Message
      if (role === "bashExecution") {
        const cmd = msg.command || "";
        const isInterrupted = msg.cancelled === true;
        const isError = !isInterrupted && (msg.exitCode !== undefined && msg.exitCode !== 0);
        const status = isInterrupted ? "interrupted" : isError ? "error" : "success";
        const title = `Bash: ${cmd ? (cmd.length > 30 ? `${cmd.slice(0, 27)}...` : cmd) : "command"} (${status})`;
        const out = msg.output ? msg.output.replace(/\s+/g, " ").trim().slice(0, 100) : "";
        const preview = out ? `$ ${cmd} -> ${out}` : `$ ${cmd}`;

        items.push({
          id: entryId,
          category: isError ? "error" : "tool",
          role: "bashExecution",
          title,
          preview,
          isError: isError || isInterrupted,
          timestamp,
          label: existingLabel,
        });
        continue;
      }

      // Compaction Summary Message
      if (role === "compactionSummary") {
        const summary = msg.summary || "Compaction summary";
        items.push({
          id: entryId,
          category: "assistant",
          role: "compaction",
          title: "Compaction Summary",
          preview: summary.replace(/\s+/g, " "),
          timestamp,
          label: existingLabel,
        });
        continue;
      }

      // Branch Summary Message
      if (role === "branchSummary") {
        const summary = msg.summary || "Branch summary";
        items.push({
          id: entryId,
          category: "assistant",
          role: "branch_summary",
          title: "Branch Summary",
          preview: summary.replace(/\s+/g, " "),
          timestamp,
          label: existingLabel,
        });
        continue;
      }

      // Tool Call Message (Standalone)
      if (role === "toolCall" || role === "tool") {
        const name = msg.name || msg.toolName || "tool";
        const argsStr = formatArgsPreview(msg.arguments);
        items.push({
          id: entryId,
          category: "tool",
          role: "tool",
          title: `Tool: ${name}`,
          preview: argsStr ? `args: ${argsStr}` : `Tool: ${name}`,
          timestamp,
          label: existingLabel,
        });
        continue;
      }

      // Custom message fallback
      if (msg.customType) {
        const text = extractTextFromContent(msg.content);
        items.push({
          id: entryId,
          category: "assistant",
          role: msg.customType,
          title: `Custom: ${msg.customType}`,
          preview: text.slice(0, 80),
          timestamp,
          label: existingLabel,
        });
        continue;
      }
    }
  }

  // Pass 3: Check for any tool calls in toolCallMap that never completed
  for (const [callId, call] of toolCallMap.entries()) {
    if (!toolResultCallIds.has(callId)) {
      const argsStr = formatArgsPreview(call.arguments);
      items.push({
        id: `call-${callId}`,
        category: "tool",
        role: "tool",
        title: `Tool: ${call.name} (interrupted)`,
        preview: argsStr ? `args: ${argsStr}` : `Tool: ${call.name}`,
        isError: true,
      });
    }
  }

  return items;
}

/**
 * Filter navigatable entries by search query and category.
 */
export function filterNavEntries(
  entries: NavigatableItem[],
  query: string,
  category: NavEntryCategory,
): NavigatableItem[] {
  if (!Array.isArray(entries)) return [];

  let result = entries;

  // Filter by category
  if (category && category !== "all") {
    result = result.filter((item) => {
      if (category === "bookmark") {
        return item.category === "bookmark" || Boolean(item.label);
      }
      if (category === "error") {
        return item.category === "error" || item.isError === true;
      }
      if (category === "tool") {
        return (
          item.category === "tool" ||
          item.role === "tool" ||
          item.role === "toolResult" ||
          item.role === "bashExecution"
        );
      }
      if (category === "user") {
        return item.category === "user" || item.role === "user";
      }
      if (category === "assistant") {
        return item.category === "assistant" || item.role === "assistant";
      }
      return item.category === category;
    });
  }

  // Filter by real-time search query
  const q = (query || "").trim().toLowerCase();
  if (q.length > 0) {
    result = result.filter((item) => {
      const title = (item.title || "").toLowerCase();
      const preview = (item.preview || "").toLowerCase();
      const role = (item.role || "").toLowerCase();
      const label = (item.label || "").toLowerCase();

      // Case-insensitive substring match
      if (
        title.includes(q) ||
        preview.includes(q) ||
        role.includes(q) ||
        label.includes(q)
      ) {
        return true;
      }

      // Fuzzy match
      try {
        if (fuzzyMatch(q, item.title || "").matches) return true;
        if (fuzzyMatch(q, item.preview || "").matches) return true;
        if (item.label && fuzzyMatch(q, item.label).matches) return true;
      } catch {
        // Fall through
      }

      return false;
    });
  }

  return result;
}

/**
 * Conversation Navigator UI component for Pi / Oh My TUI.
 */

export { safeFg, safeBold, formatTimestamp, formatCategoryBadge, formatCategoryBadgeStyled, wrapOrSlicePreview };

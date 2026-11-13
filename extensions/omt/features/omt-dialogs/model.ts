/**
 * Extraction, formatting, and layout calculation for OMT Dialogs.
 */

import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type {
  BlockActionOption,
  BlockSemanticContent,
  FixedWindowResult,
  ModelSpec,
  OmtTreeNode,
  PsecId,
  PsecRowItem,
  PsecSectionMeta,
  TraceStep,
  TreeFilterMode,
} from "./types.ts";

/**
 * fixedWin calculates scroll window boundaries for a list of total items
 * displayed in win rows with a cursor at cursor index.
 * Spends at most 2 rows on markers (…(+N above) and …(+N below)) while
 * keeping the total rendered height constant at win rows.
 */
export function fixedWin(cursor: number, total: number, win: number): FixedWindowResult {
  const safeWin = Math.max(1, win);
  const safeTotal = Math.max(0, total);
  const safeCursor = Math.max(0, Math.min(cursor, Math.max(0, safeTotal - 1)));

  if (safeTotal <= safeWin) {
    return {
      start: 0,
      end: safeTotal,
      hasAbove: false,
      hasBelow: false,
    };
  }

  // Budget accommodates at most 2 markers (above & below)
  const availableSlots = safeWin;
  let start = Math.max(0, safeCursor - Math.floor(availableSlots / 2));
  let end = start + availableSlots;

  if (end > safeTotal) {
    end = safeTotal;
    start = Math.max(0, end - availableSlots);
  }

  const hasAbove = start > 0;
  const hasBelow = end < safeTotal;

  // When both markers are needed, adjust bounds so markers + rows == safeWin
  if (hasAbove && hasBelow) {
    const listCapacity = Math.max(1, safeWin - 2);
    start = Math.max(0, safeCursor - Math.floor(listCapacity / 2));
    end = Math.min(safeTotal, start + listCapacity);
    if (end >= safeTotal) {
      end = safeTotal;
      start = Math.max(0, end - listCapacity);
    }
  } else if (hasAbove) {
    const listCapacity = Math.max(1, safeWin - 1);
    start = Math.max(0, safeTotal - listCapacity);
    end = safeTotal;
  } else if (hasBelow) {
    const listCapacity = Math.max(1, safeWin - 1);
    start = 0;
    end = Math.min(safeTotal, listCapacity);
  }

  return {
    start,
    end,
    hasAbove: start > 0,
    hasBelow: end < safeTotal,
  };
}

/**
 * Filter items case-insensitively using provided accessor strings.
 */
export function filterItems<T>(
  items: T[],
  query: string,
  accessor: (item: T) => (string | undefined)[],
): T[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return items;

  return items.filter((item) => {
    const targets = accessor(item);
    return targets.some((t) => t && t.toLowerCase().includes(trimmed));
  });
}

/**
 * Format numbers with comma grouping (e.g. 128000 -> "128,000").
 */
export function formatNumber(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

/**
 * Format relative time ago (e.g. "just now", "5m ago", "2h ago", "3d ago").
 */
export function formatAgo(d: number | Date | undefined): string {
  if (!d) return "—";
  const time = typeof d === "number" ? d : d.getTime();
  const diffMs = Date.now() - time;
  if (diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Format duration in milliseconds (e.g. 240ms or 3.2s).
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format dollar costs pair (input / output) (e.g. "$3.00 / $15.00").
 */
export function formatCostPair(inp?: number, out?: number): string {
  if (inp === undefined && out === undefined) return "—";
  const inStr = inp !== undefined ? `$${inp.toFixed(2)}` : "—";
  const outStr = out !== undefined ? `$${out.toFixed(2)}` : "—";
  return `${inStr} / ${outStr}`;
}

/**
 * Truncate string to maximum visible length with ellipsis.
 */
export function shorten(str: string, maxW: number): string {
  if (!str) return "";
  if (maxW <= 0) return "";
  const clipped = truncateToWidth(str, maxW, "…");
  // Native truncation appends resets even for plain input; pure model helpers
  // must not inject controls into unstyled text or its subsequent slicing.
  return str.includes("\x1b") ? clipped : stripTerminalSequences(clipped);
}

/**
 * Pad or truncate string to fit exact width.
 */
export function fit(str: string, width: number): string {
  if (width <= 0) return "";
  const clipped = shorten(str, width);
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/** Source trajectory labels share one grammar between the list and detail title. */
export function traceStepLabel(step: Pick<TraceStep, "index" | "kind" | "title" | "toolName">): string {
  const summary = step.title.replace(/^(?:User|Assistant):\s*/i, "");
  const prefix = `#${String(step.index).padStart(2, "0")}`;
  return step.kind === "user" || step.kind === "assistant"
    ? `${prefix} • ${step.kind}: ${summary}`
    : `${prefix} [${step.toolName || step.kind}] ${summary}`;
}

// -----------------------------------------------------------------------------
// Semantic Block Copy Helpers
// -----------------------------------------------------------------------------

/**
 * Extract fenced code blocks (```...```) from markdown text.
 */
export function extractCodeBlocks(markdown: string): string[] {
  if (!markdown) return [];
  const codeBlocks: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let inside = false;
  let currentBlock: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (inside) {
        // closing fence
        codeBlocks.push(currentBlock.join("\n"));
        currentBlock = [];
        inside = false;
      } else {
        // opening fence
        inside = true;
        currentBlock = [];
      }
    } else if (inside) {
      currentBlock.push(line);
    }
  }

  // Handle unclosed block gracefully
  if (inside && currentBlock.length > 0) {
    codeBlocks.push(currentBlock.join("\n"));
  }

  return codeBlocks;
}

/**
 * Extract Markdown tables from markdown text.
 */
export function extractTables(markdown: string): string[] {
  if (!markdown) return [];
  const tables: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let currentTable: string[] = [];

  const isTableLine = (l: string) => {
    const t = l.trim();
    return t.startsWith("|") && t.endsWith("|") && t.length > 1;
  };

  for (const line of lines) {
    if (isTableLine(line)) {
      currentTable.push(line);
    } else {
      if (currentTable.length >= 2) {
        // Valid table has header and separator at minimum
        tables.push(currentTable.join("\n"));
      }
      currentTable = [];
    }
  }

  if (currentTable.length >= 2) {
    tables.push(currentTable.join("\n"));
  }

  return tables;
}

/**
 * Convert markdown text to readable plain text by stripping markers.
 */
export function toPlainText(markdown: string): string {
  if (!markdown) return "";
  let text = markdown;

  // Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    const lines = match.split(/\r?\n/);
    return lines.slice(1, -1).join("\n");
  });

  // Remove inline code
  text = text.replace(/`([^`]+)`/g, "$1");

  // Remove bold / italic markers
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(.*?)\1/g, "$2");

  // Remove markdown links [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remove image tags ![alt](url) -> alt
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");

  // Remove heading hashes
  text = text.replace(/^#{1,6}\s+/gm, "");

  // Remove blockquotes
  text = text.replace(/^>\s+/gm, "");

  return text.trim();
}

/**
 * Extract complete semantic content from raw markdown message.
 */
export function extractBlockContent(markdown: string): BlockSemanticContent {
  return {
    markdown: markdown || "",
    codeBlocks: extractCodeBlocks(markdown),
    tables: extractTables(markdown),
    plain: toPlainText(markdown),
  };
}

/**
 * Build menu options for semantic block actions.
 */
export function buildBlockOptions(content: BlockSemanticContent): BlockActionOption[] {
  const options: BlockActionOption[] = [];

  if (content.markdown.trim().length > 0) {
    options.push({
      kind: "md",
      label: "Copy markdown",
      content: content.markdown,
    });
  }

  if (content.codeBlocks.length > 0) {
    const plural = content.codeBlocks.length === 1 ? "" : "s";
    options.push({
      kind: "code",
      label: `Copy ${content.codeBlocks.length} code block${plural}`,
      content: content.codeBlocks.join("\n\n"),
    });
  }

  if (content.tables.length > 0) {
    const plural = content.tables.length === 1 ? "" : "s";
    options.push({
      kind: "tables",
      label: `Copy ${content.tables.length} table${plural}`,
      content: content.tables.join("\n\n"),
    });
  }

  if (content.plain.trim().length > 0) {
    options.push({
      kind: "plain",
      label: "Copy plain text",
      content: content.plain,
    });
  }

  return options;
}

// -----------------------------------------------------------------------------
// Tree Explorer Model Helpers
// -----------------------------------------------------------------------------

/**
 * Filter tree nodes by active display mode.
 */
export function filterTreeNodesByMode(
  nodes: OmtTreeNode[],
  mode: TreeFilterMode,
): OmtTreeNode[] {
  switch (mode) {
    case "no-tools":
      return nodes.filter((n) => n.role !== "tool");
    case "user-only":
      return nodes.filter((n) => n.role === "user");
    case "labeled-only":
      return nodes.filter((n) => Boolean(n.label && n.label.trim().length > 0));
    case "all":
    case "default":
    default:
      return nodes;
  }
}

export interface FlattenedTreeNode {
  node: OmtTreeNode;
  depth: number;
  connector: string;
  isLastSibling: boolean;
  isVisible: boolean;
}

/**
 * Flatten hierarchical tree nodes with ASCII connectors.
 */
export function flattenOmtTree(
  nodes: OmtTreeNode[],
  foldedIds: Set<string> = new Set(),
): FlattenedTreeNode[] {
  const nodeMap = new Map<string, OmtTreeNode>(nodes.map((n) => [n.id, n]));
  const childMap = new Map<string | null, OmtTreeNode[]>();

  for (const node of nodes) {
    const pid = node.parentId;
    const list = childMap.get(pid) || [];
    list.push(node);
    childMap.set(pid, list);
  }

  const flattened: FlattenedTreeNode[] = [];

  function traverse(
    node: OmtTreeNode,
    depth: number,
    ancestorsAreLast: boolean[],
    isLast: boolean,
  ) {
    let connector = "";
    if (depth > 0) {
      let indent = "";
      for (let i = 0; i < depth - 1; i++) {
        indent += ancestorsAreLast[i] ? "    " : "│   ";
      }
      connector = indent + (isLast ? "└── " : "├── ");
    }

    flattened.push({
      node,
      depth,
      connector,
      isLastSibling: isLast,
      isVisible: true,
    });

    if (foldedIds.has(node.id)) {
      return; // subtree folded
    }

    const children = childMap.get(node.id) || [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childIsLast = i === children.length - 1;
      traverse(child, depth + 1, [...ancestorsAreLast, isLast], childIsLast);
    }
  }

  const rootNodes = childMap.get(null) || nodes.filter((n) => !n.parentId);
  for (let i = 0; i < rootNodes.length; i++) {
    const isLast = i === rootNodes.length - 1;
    traverse(rootNodes[i], 0, [], isLast);
  }

  return flattened;
}


// -----------------------------------------------------------------------------
// Trajectory / Live Step Tracking
// -----------------------------------------------------------------------------

/**
 * Resolves stable selection cursor when steps list updates live.
 * If prevSelectedId is still present, preserves cursor on that step.
 * If a new step landed and no specific selection was held, focuses newest.
 */
export function resolveStableCursor(
  prevSelectedId: string | undefined,
  steps: TraceStep[],
  filterQuery: string,
): { cursor: number; selectedStep?: TraceStep } {
  if (steps.length === 0) return { cursor: 0 };

  const filtered = filterItems(steps, filterQuery, (s) => [
    s.title,
    s.detail,
    s.kind,
    s.toolName,
  ]);
  if (filtered.length === 0) return { cursor: 0 };

  if (prevSelectedId) {
    const idx = filtered.findIndex((s) => s.id === prevSelectedId);
    if (idx >= 0) {
      return { cursor: idx, selectedStep: filtered[idx] };
    }
  }

  // Focus newest step by default
  const newestIdx = filtered.length - 1;
  return { cursor: newestIdx, selectedStep: filtered[newestIdx] };
}

export type DiffLineType = "header" | "hunk" | "add" | "delete" | "context";

/**
 * Classify a line of text for diff syntax highlighting.
 */
export function classifyDiffLine(line: string): DiffLineType {
  const trimmed = line.trimStart();
  if (
    trimmed.startsWith("diff ") ||
    trimmed.startsWith("index ") ||
    trimmed.startsWith("--- ") ||
    trimmed.startsWith("+++ ")
  ) {
    return "header";
  }
  if (trimmed.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("+")) {
    return "add";
  }
  if (line.startsWith("-")) {
    return "delete";
  }
  return "context";
}

// -----------------------------------------------------------------------------
// Settings Hub Section Metadata
// -----------------------------------------------------------------------------

export const SETTINGS_HUB_SECTIONS: Record<PsecId, PsecSectionMeta> = {
  agent: {
    id: "agent",
    label: "Agent Settings",
    hint: "Enter opens the agent settings dialog · Esc closes",
  },
  command: {
    id: "command",
    label: "Commands",
    hint: "Enter fills /command · Ctrl+S assigns shortcut · Esc closes",
  },
  shortcut: {
    id: "shortcut",
    label: "Shortcuts",
    hint: "keyboard reference · type filters · Ctrl+S reassigns · Esc closes",
  },
  skill: {
    id: "skill",
    label: "Skills",
    hint: "Enter fills /command · Ctrl+S assigns shortcut · Esc closes",
  },
  prompt: {
    id: "prompt",
    label: "Prompts",
    hint: "Enter fills /command · Ctrl+S assigns shortcut · Esc closes",
  },
  extension: {
    id: "extension",
    label: "Extensions",
    hint: "Enter fills /command · Ctrl+S assigns shortcut · Esc closes",
  },
  plugin: {
    id: "plugin",
    label: "Plugins",
    hint: "★ suggested · Enter installs · Delete uninstalls · Esc closes",
  },
  market: {
    id: "market",
    label: "Marketplace",
    hint: "type to search packages · ↑↓ select · Enter installs · Esc closes",
  },
  mcp: {
    id: "mcp",
    label: "MCP Servers",
    hint: "Enter opens /mcp server manager · Esc closes",
  },
  tool: {
    id: "tool",
    label: "Tool Usage",
    hint: "Per-tool calls this session · Esc closes",
  },
  tasks: {
    id: "tasks",
    label: "Tasks",
    hint: "Enter cycles value · Esc closes",
  },
  side: {
    id: "side",
    label: "Sidebar Sections",
    hint: "Enter shows/hides sidebar section · Esc closes",
  },
  theme: {
    id: "theme",
    label: "Themes & Surfaces",
    hint: "↑↓ previews live · → background column · Enter applies · Esc closes",
  },
  login: {
    id: "login",
    label: "Login & Providers",
    hint: "Enter opens login flow · Esc closes",
  },
};

/**
 * Safe clipboard writing helper with user feedback.
 */
export async function copyToClipboard(
  text: string,
  customWriter?: (t: string) => Promise<boolean> | boolean,
): Promise<{ success: boolean; message: string }> {
  if (!text || text.trim().length === 0) {
    return { success: false, message: "Nothing to copy" };
  }

  if (customWriter) {
    try {
      const ok = await customWriter(text);
      if (ok) {
        return { success: true, message: `✓ copied ${text.length} chars to clipboard` };
      }
      return { success: false, message: "copy failed: clipboard rejected write" };
    } catch (err: any) {
      return { success: false, message: `copy failed: ${err?.message || "error"}` };
    }
  }

  // Attempt standard global navigator.clipboard if present
  if (typeof (globalThis as any)?.navigator?.clipboard?.writeText === "function") {
    try {
      await (globalThis as any).navigator.clipboard.writeText(text);
      return { success: true, message: `✓ copied ${text.length} chars to clipboard` };
    } catch (err: any) {
      return { success: false, message: `copy failed: ${err?.message || "unsupported"}` };
    }
  }

  return { success: false, message: "copy unavailable: no clipboard writer" };
}

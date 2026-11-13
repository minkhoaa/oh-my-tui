import { type Component } from "@earendil-works/pi-tui";
import { copyToClipboard, type Theme } from "@earendil-works/pi-coding-agent";
import type { SessionTreeNodeItem, SessionTreeOptions, SessionTreeFactory } from "./types.ts";


export type {
  SessionTreeNodeItem,
  SessionTreeOptions,
  SessionTreeFactory,
};

/**
 * Safely invoke theme.fg with fallback.
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
 * Safely invoke theme.bold with fallback.
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
 * Copy text to clipboard safely.
 */
export async function copyTreeContent(text: string): Promise<boolean> {
  try {
    await copyToClipboard(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract concise summary text from varied session entry shapes.
 */
export function extractEntrySummary(entry: unknown): string {
  if (!entry || typeof entry !== "object") return "";
  const anyEntry = entry as Record<string, any>;

  // Direct summary property
  if (typeof anyEntry.summary === "string" && anyEntry.summary.trim().length > 0) {
    if (anyEntry.type === "compaction") return `Compaction: ${anyEntry.summary.trim()}`;
    if (anyEntry.type === "branch_summary") return `Branch: ${anyEntry.summary.trim()}`;
    return anyEntry.summary.trim();
  }

  // Label entry
  if (anyEntry.type === "label") {
    return `Label: ${anyEntry.label ?? "bookmark"}`;
  }

  // Model change entry
  if (anyEntry.type === "model_change") {
    return `Model: ${anyEntry.provider ? `${anyEntry.provider}/` : ""}${anyEntry.modelId ?? "default"}`;
  }

  // Thinking level entry
  if (anyEntry.type === "thinking_level_change") {
    return `Thinking: ${anyEntry.thinkingLevel ?? "default"}`;
  }

  // Session info entry
  if (anyEntry.type === "session_info") {
    return `Session: ${anyEntry.name ?? "unnamed"}`;
  }

  // Message entry or raw message
  const msg = anyEntry.message ?? anyEntry;
  if (msg && typeof msg === "object") {
    const role = (msg.role ?? anyEntry.role ?? "message") as string;
    let contentSnippet = "";

    if (typeof msg.content === "string") {
      contentSnippet = msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block) continue;
        if (typeof block === "string") {
          contentSnippet += block + " ";
        } else if (block.type === "text" && typeof block.text === "string") {
          contentSnippet += block.text + " ";
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          if (!contentSnippet) contentSnippet = `[Thinking] ${block.thinking} `;
        } else if (block.type === "toolCall") {
          contentSnippet += `call:${block.name ?? "tool"} `;
        }
      }
    }

    if (role === "bashExecution") {
      return `Bash: ${msg.command ?? ""}`.trim();
    }
    if (role === "toolResult") {
      return `Result (${msg.toolName ?? "tool"}): ${contentSnippet.trim()}`;
    }

    const rolePrefix = role === "user" ? "User: " : role === "assistant" ? "Assistant: " : `${role}: `;
    return `${rolePrefix}${contentSnippet.trim()}`.replace(/\s+/g, " ");
  }

  return anyEntry.id ?? anyEntry.type ?? "Node";
}

/**
 * Determine type / role string for a node.
 */
function getNodeType(entry: unknown): string {
  if (!entry || typeof entry !== "object") return "node";
  const anyEntry = entry as Record<string, any>;

  if (anyEntry.message?.role) {
    return anyEntry.message.role;
  }
  if (anyEntry.role) {
    return anyEntry.role;
  }
  if (anyEntry.type) {
    return anyEntry.type;
  }
  return "node";
}

/**
 * Helper to parse tree nodes, calculate branch paths, and identify leaves and active path.
 */
export function buildSessionTreeItems(
  tree: unknown[],
  currentLeafId?: string,
): SessionTreeNodeItem[] {
  if (!Array.isArray(tree) || tree.length === 0) {
    return [];
  }

  // Case 1: Pre-nested SessionTreeNode[] from Pi SessionManager.getTree()
  // Pattern: node has `entry` and `children: SessionTreeNode[]`
  const isPiSessionTreeNode = (node: any): boolean => {
    return node && typeof node === "object" && "entry" in node && Array.isArray(node.children);
  };

  const convertPiTreeNode = (node: any): SessionTreeNodeItem => {
    const entry = node.entry ?? {};
    const children: SessionTreeNodeItem[] = Array.isArray(node.children)
      ? node.children.map(convertPiTreeNode)
      : [];
    const id = String(entry.id ?? "");
    const isLeaf = children.length === 0;
    const isCurrent = id === currentLeafId;

    return {
      id,
      parentId: entry.parentId ?? null,
      type: getNodeType(entry),
      label: node.label || entry.label,
      summary: extractEntrySummary(entry),
      timestamp: entry.timestamp,
      children,
      isLeaf,
      isCurrent,
    };
  };

  if (tree.some(isPiSessionTreeNode)) {
    return tree.map(convertPiTreeNode);
  }

  // Case 2: Pre-nested SessionTreeNodeItem[] (has `children` and `id`, but no `entry`)
  const isAlreadyNestedItem = (node: any): boolean => {
    return node && typeof node === "object" && "id" in node && Array.isArray(node.children) && !("entry" in node);
  };

  const normalizeNestedItem = (node: any): SessionTreeNodeItem => {
    const children: SessionTreeNodeItem[] = Array.isArray(node.children)
      ? node.children.map(normalizeNestedItem)
      : [];
    const id = String(node.id ?? "");
    const isLeaf = children.length === 0;
    const isCurrent = Boolean(node.isCurrent || (currentLeafId && id === currentLeafId));

    return {
      id,
      parentId: node.parentId ?? null,
      type: node.type ?? "node",
      label: node.label,
      summary: node.summary || extractEntrySummary(node),
      timestamp: node.timestamp,
      children,
      isLeaf,
      isCurrent,
    };
  };

  if (tree.every(isAlreadyNestedItem)) {
    return tree.map(normalizeNestedItem);
  }

  // Case 3: Flat array of SessionEntry[] or items with `id` and `parentId`
  const itemMap = new Map<string, SessionTreeNodeItem>();
  const rawList: any[] = [];
  const labelsById = new Map<string, string>();

  // First pass: extract labels and create base node items
  for (const raw of tree) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, any>;
    const id = String(item.id ?? "");
    if (!id) continue;

    // Track label entries that target earlier nodes
    if (item.type === "label") {
      if (item.targetId && typeof item.label === "string") {
        labelsById.set(String(item.targetId), item.label);
      }
      continue;
    }
    if (item.type === "session" || item.type === "session_info") {
      continue;
    }
    if (item.label && typeof item.label === "string") {
      labelsById.set(id, item.label);
    }

    rawList.push(item);

    const nodeItem: SessionTreeNodeItem = {
      id,
      parentId: item.parentId ? String(item.parentId) : null,
      type: getNodeType(item),
      label: item.label,
      summary: extractEntrySummary(item),
      timestamp: item.timestamp,
      children: [],
      isLeaf: false,
      isCurrent: id === currentLeafId,
    };

    itemMap.set(id, nodeItem);
  }

  // Apply resolved labels
  for (const [targetId, label] of labelsById.entries()) {
    const target = itemMap.get(targetId);
    if (target) {
      target.label = label;
    }
  }

  // Second pass: construct tree hierarchy by connecting parents and children
  const rootNodes: SessionTreeNodeItem[] = [];

  for (const item of rawList) {
    const id = String(item.id);
    const node = itemMap.get(id);
    if (!node) continue;

    const parentId = node.parentId;
    if (parentId && itemMap.has(parentId)) {
      const parent = itemMap.get(parentId)!;
      // Guard against duplicate addition or circular parent references
      if (!parent.children.some((c) => c.id === id) && parent.id !== id) {
        parent.children.push(node);
      }
    } else {
      rootNodes.push(node);
    }
  }

  // Third pass: recursively calculate isLeaf, isCurrent, and branch relationships
  const finalizeItem = (node: SessionTreeNodeItem, visited: Set<string>): void => {
    if (visited.has(node.id)) return; // circular guard
    visited.add(node.id);

    node.isLeaf = node.children.length === 0;
    if (currentLeafId && node.id === currentLeafId) {
      node.isCurrent = true;
    }

    for (const child of node.children) {
      finalizeItem(child, visited);
    }
  };

  const visitedSet = new Set<string>();
  for (const root of rootNodes) {
    finalizeItem(root, visitedSet);
  }

  return rootNodes;
}

/**
 * Display structure for rendering tree rows with ASCII connectors.
 */
export interface DisplayTreeNode {
  node: SessionTreeNodeItem;
  depth: number;
  prefix: string;        // ASCII connector prefix, e.g. "│   ├── "
  connector: string;     // Connector symbol: "├── ", "└── ", "• "
  guidePrefix: string;   // Guide indentation: "│   ", "    "
  isLastChild: boolean;
}

/**
 * Flatten hierarchical tree items into sequential display rows with ASCII connectors.
 */
export function flattenSessionTree(
  roots: SessionTreeNodeItem[],
  ancestorGuide = "",
  depth = 0,
  visited = new Set<string>(),
): DisplayTreeNode[] {
  const result: DisplayTreeNode[] = [];

  for (let i = 0; i < roots.length; i++) {
    const node = roots[i]!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);

    const isLastChild = i === roots.length - 1;
    let connector = "├── ";

    if (depth === 0 && roots.length === 1) {
      connector = "• ";
    } else if (isLastChild) {
      connector = "└── ";
    }

    const fullPrefix = ancestorGuide + connector;

    result.push({
      node,
      depth,
      prefix: fullPrefix,
      connector,
      guidePrefix: ancestorGuide,
      isLastChild,
    });

    if (node.children && node.children.length > 0) {
      const nextGuide = ancestorGuide + (depth === 0 && roots.length === 1 ? "  " : isLastChild ? "    " : "│   ");
      result.push(...flattenSessionTree(node.children, nextGuide, depth + 1, visited));
    }
  }

  return result;
}

/**
 * Filter display tree nodes by search query.
 */
export function filterTreeNodes(
  items: DisplayTreeNode[],
  query: string,
): DisplayTreeNode[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...items];

  return items.filter((item) => {
    const n = item.node;
    if (n.id.toLowerCase().includes(trimmed)) return true;
    if (n.type.toLowerCase().includes(trimmed)) return true;
    if (n.summary && n.summary.toLowerCase().includes(trimmed)) return true;
    if (n.label && n.label.toLowerCase().includes(trimmed)) return true;
    return false;
  });
}

/**
 * Interactive Session Tree & Branch Explorer Component.
 */

export { safeFg, safeBold, safeDim };

/**
 * Visual Conversation Tree Dialog Component.
 */

import { Container, visibleWidth, truncateToWidth, wrapTextWithAnsi, matchesKey, Key, type Component, type Focusable, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { copyToClipboard as nativeCopyToClipboard, type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import type {
  OmtTreeDialogOptions as BaseOmtTreeDialogOptions,
  OmtTreeNode,
  TreeFilterMode,
  TreeSummaryChoice,
} from "./types.ts";

export interface OmtTreeDialogOptions extends Partial<BaseOmtTreeDialogOptions> {
  nodes: OmtTreeNode[];
  currentNodeId?: string;
  currentLeafId?: string;
  initialMode?: TreeFilterMode;
  targetHeight?: number;
  terminalHeight?: number;
  onJumpToNode?: (nodeId: string) => void;
  onForkNode?: (nodeId: string) => void;
  onSummarizeBranch?: (choice: TreeSummaryChoice, customPrompt?: string) => void;
  onBranchSummary?: (choice: TreeSummaryChoice, customPrompt?: string) => void;
  onSetLabel?: (nodeId: string, label: string) => void;
  onCopy?: (text: string) => void;
  clipboardWriter?: (text: string) => Promise<boolean> | boolean;
  onClose?: () => void;
}
export type { OmtTreeNode, TreeFilterMode, TreeSummaryChoice };
import { copyToClipboard } from "./model.ts";
import { selectedDialogRow } from "./presentation.ts";

export type TreeDialogScreen = "tree" | "treeSummary" | "treeCustom";

export interface VisualTreeNode {
  node: OmtTreeNode;
  depth: number;
  connector: string;
  ancestorsAreLast: boolean[];
  isLastSibling: boolean;
  hasChildren: boolean;
  isFolded: boolean;
  isLeaf: boolean;
  isActivePath: boolean;
  isCurrent: boolean;
}

// -----------------------------------------------------------------------------
// Theme & Styling Helpers
// -----------------------------------------------------------------------------

function fgSafe(theme: Theme | undefined, color: ThemeColor | string, text: string): string {
  try {
    return theme?.fg ? theme.fg(color as ThemeColor, text) : text;
  } catch {
    return text;
  }
}

function boldSafe(theme: Theme | undefined, text: string): string {
  try {
    return theme?.bold ? theme.bold(text) : `\x1b[1m${text}\x1b[22m`;
  } catch {
    return text;
  }
}

function dimSafe(theme: Theme | undefined, text: string): string {
  try {
    if (typeof (theme as any)?.dim === "function") {
      return (theme as any).dim(text);
    }
    return typeof theme?.fg === "function" ? theme.fg("dim", text) : text;
  } catch {
    return text;
  }
}

/**
 * Format timestamp into concise human readable form (HH:MM or MM/DD HH:MM).
 */
export function formatTimestamp(ts: number | string | undefined): string {
  if (ts === undefined || ts === null || ts === "") return "";
  let d: Date;
  if (typeof ts === "number") {
    d = new Date(ts < 1e11 ? ts * 1000 : ts);
  } else {
    const parsed = Date.parse(ts);
    if (isNaN(parsed)) return String(ts);
    d = new Date(parsed);
  }
  if (isNaN(d.getTime())) return String(ts);
  const pad = (n: number) => (n < 10 ? "0" + n : String(n));
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());

  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return `${hh}:${mm}`;
  }
  return `${month}/${day} ${hh}:${mm}`;
}

/**
 * Filter tree nodes by active display mode.
 */
export function filterTreeNodesByMode(
  nodes: OmtTreeNode[],
  mode: TreeFilterMode,
): OmtTreeNode[] {
  const settings = new Set(["label", "context_edit", "custom", "model_change", "thinking_level_change", "session_info"]);
  const visible = nodes.filter(n => n.entryType !== "usage");
  switch (mode) {
    case "no-tools":
      return visible.filter((n) => n.role !== "tool" && !settings.has(n.entryType ?? ""));
    case "user-only":
      return nodes.filter((n) => n.role === "user");
    case "labeled-only":
      return nodes.filter((n) => Boolean(n.label && n.label.trim().length > 0));
    case "all":
      return visible;
    case "default":
    default:
      return visible.filter(n => !settings.has(n.entryType ?? ""));
  }
}

/**
 * Recalculate topological visual structure and ASCII connectors for visible nodes.
 */
export function recalculateVisualStructure(
  allNodes: OmtTreeNode[],
  mode: TreeFilterMode,
  query: string,
  foldedIds: Set<string>,
  currentNodeId?: string,
): VisualTreeNode[] {
  const allNodesMap = new Map<string, OmtTreeNode>();
  for (const n of allNodes) {
    allNodesMap.set(n.id, n);
  }

  // 1. Filter by mode
  let filtered = filterTreeNodesByMode(allNodes, mode);

  // 2. Filter by search query
  if (query.trim()) {
    const q = query.trim().toLowerCase();
    filtered = filtered.filter((n) => {
      const matchId = n.id.toLowerCase().includes(q);
      const matchLabel = Boolean(n.label && n.label.toLowerCase().includes(q));
      const matchSummary = Boolean(n.summary && n.summary.toLowerCase().includes(q));
      const matchRole = Boolean(n.role && n.role.toLowerCase().includes(q));
      return matchId || matchLabel || matchSummary || matchRole;
    });
  }

  const visibleIds = new Set(filtered.map((n) => n.id));

  // Determine nearest visible ancestor
  function getVisibleParentId(node: OmtTreeNode): string | null {
    let pid = node.parentId;
    while (pid) {
      if (visibleIds.has(pid)) return pid;
      const parentNode = allNodesMap.get(pid);
      pid = parentNode ? parentNode.parentId : null;
    }
    return null;
  }

  // Group visible children by nearest visible parent ID
  const childMap = new Map<string | null, OmtTreeNode[]>();
  for (const n of filtered) {
    const vpid = getVisibleParentId(n);
    if (!childMap.has(vpid)) childMap.set(vpid, []);
    childMap.get(vpid)!.push(n);
  }

  // Build active path set from target/leaf up to root
  const targetId =
    currentNodeId ||
    filtered.find((n) => n.isCurrent)?.id ||
    (filtered.length > 0 ? filtered[filtered.length - 1]!.id : undefined);

  const activePath = new Set<string>();
  let cur = targetId;
  while (cur) {
    activePath.add(cur);
    const n = allNodesMap.get(cur);
    cur = n ? (n.parentId ?? undefined) : undefined;
  }

  const result: VisualTreeNode[] = [];

  function traverse(
    node: OmtTreeNode,
    depth: number,
    ancestorsAreLast: boolean[],
    isLast: boolean,
  ) {
    let connector = "";
    if (depth > 0) {
      let indent = "";
      for (let i = 1; i < depth; i++) {
        indent += ancestorsAreLast[i - 1] ? "    " : "│   ";
      }
      connector = indent + (isLast ? "└── " : "├── ");
    }

    const children = childMap.get(node.id) || [];
    const hasChildren = children.length > 0;
    const isFolded = foldedIds.has(node.id) || node.isFolded === true;
    const isLeaf = Boolean(node.isLeaf) || !hasChildren;
    const isCurrent = Boolean(node.isCurrent || (currentNodeId && node.id === currentNodeId));
    const isActivePath = activePath.has(node.id);

    result.push({
      node,
      depth,
      connector,
      ancestorsAreLast,
      isLastSibling: isLast,
      hasChildren,
      isFolded,
      isLeaf,
      isActivePath,
      isCurrent,
    });

    if (isFolded) {
      return; // folded subtree omitted from display
    }

    const nextAncestors = depth === 0 ? [] : [...ancestorsAreLast, isLast];
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const childIsLast = i === children.length - 1;
      // Source sessiontree keeps single-child turn chains flat; indentation
      // represents an actual branch, not every message parent edge.
      traverse(child, depth + (children.length > 1 ? 1 : 0), nextAncestors, childIsLast);
    }
  }

  const roots = childMap.get(null) || [];
  for (let i = 0; i < roots.length; i++) {
    const isLast = i === roots.length - 1;
    traverse(roots[i]!, 0, [], isLast);
  }

  return result;
}

/**
 * Sliding window calculation for scrolling lists.
 */
function calculateWindow(
  cursor: number,
  total: number,
  windowSize: number,
): { start: number; end: number; hasAbove: boolean; hasBelow: boolean } {
  if (total <= windowSize) {
    return { start: 0, end: total, hasAbove: false, hasBelow: false };
  }
  const half = Math.floor(windowSize / 2);
  let start = cursor - half;
  if (start < 0) start = 0;
  let end = start + windowSize;
  if (end > total) {
    end = total;
    start = Math.max(0, end - windowSize);
  }
  return {
    start,
    end,
    hasAbove: start > 0,
    hasBelow: end < total,
  };
}

/**
 * Pad or truncate line content so that its visual width equals inner width.
 */
function padOrTruncate(content: string, innerW: number): string {
  const vw = visibleWidth(content);
  if (vw < innerW) {
    return content + " ".repeat(innerW - vw);
  }
  if (vw > innerW) {
    return truncateToWidth(content, innerW, "");
  }
  return content;
}

// -----------------------------------------------------------------------------
// Component Implementation
// -----------------------------------------------------------------------------

export class OmtTreeDialogComponent extends Container implements Component, Focusable {
  static readonly presentationAnchor = "bottom-center";
  readonly presentationAnchor = "bottom-center";
  static readonly presentationFullWidth = true;
  readonly presentationFullWidth = true;

  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx?: ExtensionContext;
  private options: OmtTreeDialogOptions;

  // 4 display modes: default, no-tools, user-only, labeled-only
  private readonly DISPLAY_MODES: TreeFilterMode[] = [
    "default",
    "no-tools",
    "user-only",
    "labeled-only",
  ];

  mode: TreeFilterMode = "default";
  screen: TreeDialogScreen = "tree";
  private foldedIds: Set<string> = new Set();
  private showTimestamps: boolean = false;
  private treeCursor: number = 0;
  private query: string = "";
  private summaryCursor: number = 1; // Default to option 1: "Summarize"
  private inputBuffer: string = "";
  private isLabeling: boolean = false;
  private editingNodeId: string | null = null;
  private feedbackText: string = "";
  private closed: boolean = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings?: KeybindingsManager,
    done?: (value?: unknown) => void,
    ctxOrOptions?: ExtensionContext | OmtTreeDialogOptions,
    maybeOptions?: OmtTreeDialogOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done || (() => {});

    if (maybeOptions) {
      this.ctx = ctxOrOptions as ExtensionContext;
      this.options = maybeOptions;
    } else if (ctxOrOptions && "nodes" in ctxOrOptions) {
      this.options = ctxOrOptions as OmtTreeDialogOptions;
    } else {
      this.ctx = ctxOrOptions as ExtensionContext;
      this.options = { nodes: [], onJumpToNode: () => {} };
    }

    const initMode = (this.options as any).initialMode;
    if (initMode && this.DISPLAY_MODES.includes(initMode)) {
      this.mode = initMode;
    }

    // Initialize folded state from nodes
    for (const node of this.options.nodes) {
      if (node.isFolded) {
        this.foldedIds.add(node.id);
      }
    }

    // Select current node, active leaf, or root
    const displayNodes = this.getDisplayNodes();
    const targetNodeId = this.options.currentNodeId || this.options.currentLeafId;
    if (targetNodeId) {
      const idx = displayNodes.findIndex((n) => n.node.id === targetNodeId);
      if (idx >= 0) this.treeCursor = idx;
    } else {
      const curIdx = displayNodes.findIndex((n) => n.node.isCurrent);
      if (curIdx >= 0) {
        this.treeCursor = curIdx;
      } else {
        const leafIdx = displayNodes.findIndex((n) => n.isLeaf);
        if (leafIdx >= 0) this.treeCursor = leafIdx;
      }
    }
  }

  getDisplayNodes(): VisualTreeNode[] {
    return recalculateVisualStructure(
      this.options.nodes,
      this.mode,
      this.query,
      this.foldedIds,
      this.options.currentNodeId,
    );
  }

  getMode(): TreeFilterMode {
    return this.mode;
  }

  getScreen(): TreeDialogScreen {
    return this.screen;
  }

  getCursor(): number {
    return this.treeCursor;
  }

  getQuery(): string {
    return this.query;
  }

  isTimestampsEnabled(): boolean {
    return this.showTimestamps;
  }

  getFoldedIds(): Set<string> {
    return new Set(this.foldedIds);
  }

  getFeedback(): string {
    return this.feedbackText;
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  // ---------------------------------------------------------------------------
  // Input Handling
  // ---------------------------------------------------------------------------

  handleInput(data: string): void {
    if (this.closed) return;

    // Sub-Screen: Custom Prompt / Bookmark Label Editor (treeCustom)
    if (this.screen === "treeCustom") {
      this.handleInputCustom(data);
      return;
    }

    // Sub-Screen: Branch Summary Selector (treeSummary)
    if (this.screen === "treeSummary") {
      this.handleInputSummary(data);
      return;
    }

    // Main Screen: Conversation Tree (tree)
    this.handleInputTree(data);
  }

  private handleInputTree(data: string): void {
    // 1. Esc: clears search query first, closes dialog on empty query
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      if (this.query.length > 0) {
        this.query = "";
        this.treeCursor = 0;
        this.tui.requestRender?.();
        return;
      }
      this.close();
      return;
    }

    // 2. Ctrl+O: Cycle the 4 display modes (default -> no-tools -> user-only -> labeled-only -> default)
    if (data === "\x0f") {
      const idx = this.DISPLAY_MODES.indexOf(this.mode);
      this.mode = this.DISPLAY_MODES[(idx + 1) % this.DISPLAY_MODES.length]!;
      this.feedbackText = `Mode: ${this.mode}`;
      const nodes = this.getDisplayNodes();
      if (this.treeCursor >= nodes.length) {
        this.treeCursor = Math.max(0, nodes.length - 1);
      }
      this.tui.requestRender?.();
      return;
    }

    // Direct mode keys (Ctrl+D, Ctrl+T, Ctrl+U, Ctrl+L, Ctrl+A)
    if (data === "\x04") {
      this.mode = "default";
      this.feedbackText = "Mode: default";
      this.tui.requestRender?.();
      return;
    }
    if (data === "\x14") {
      this.mode = this.mode === "no-tools" ? "default" : "no-tools";
      this.feedbackText = `Mode: ${this.mode}`;
      this.tui.requestRender?.();
      return;
    }
    if (data === "\x15") {
      this.mode = this.mode === "user-only" ? "default" : "user-only";
      this.feedbackText = `Mode: ${this.mode}`;
      this.tui.requestRender?.();
      return;
    }
    if (data === "\x0c") {
      this.mode = this.mode === "labeled-only" ? "default" : "labeled-only";
      this.feedbackText = `Mode: ${this.mode}`;
      this.tui.requestRender?.();
      return;
    }
    if (data === "\x01") {
      this.mode = this.mode === "all" ? "default" : "all";
      this.feedbackText = `Mode: ${this.mode}`;
      this.tui.requestRender?.();
      return;
    }

    // Folding keys (Alt+Left, Ctrl+Left, Alt+b) / unfolding keys (Alt+Right, Ctrl+Right, Alt+f)
    const isFoldKey = data === "\x1b[1;3D" || data === "\x1b\x1b[D" || data === "\x1b[1;5D" || data === "\x1bb";
    const isUnfoldKey = data === "\x1b[1;3C" || data === "\x1b\x1b[C" || data === "\x1b[1;5C" || data === "\x1bf";

    if (isFoldKey) {
      const nodes = this.getDisplayNodes();
      const sel = nodes[this.treeCursor];
      if (sel) {
        this.foldedIds.add(sel.node.id);
        this.feedbackText = `Folded: ${sel.node.id}`;
        this.tui.requestRender?.();
      }
      return;
    }

    if (isUnfoldKey) {
      const nodes = this.getDisplayNodes();
      const sel = nodes[this.treeCursor];
      if (sel) {
        this.foldedIds.delete(sel.node.id);
        this.feedbackText = `Unfolded: ${sel.node.id}`;
        this.tui.requestRender?.();
      }
      return;
    }

    // Node fold/unfold toggle (Space or 'f' when query is empty)
    if ((data === " " || matchesKey(data, Key.space) || data === "f") && this.query.length === 0) {
      const nodes = this.getDisplayNodes();
      const sel = nodes[this.treeCursor];
      if (sel) {
        if (this.foldedIds.has(sel.node.id)) {
          this.foldedIds.delete(sel.node.id);
          this.feedbackText = `Unfolded: ${sel.node.id}`;
        } else {
          this.foldedIds.add(sel.node.id);
          this.feedbackText = `Folded: ${sel.node.id}`;
        }
        this.tui.requestRender?.();
      }
      return;
    }

    // 's': Branch summary prompt (treeSummary) when query is empty
    if (data === "s" && this.query.length === 0) {
      this.screen = "treeSummary";
      this.summaryCursor = 1; // "Summarize"
      this.feedbackText = "Summarize branch?";
      this.options.onBranchSummary?.("summarize");
      this.tui.requestRender?.();
      return;
    }

    // Bookmark label edit mode: Shift+L ('L') or 'l' when query is empty
    if (data === "L" || (data === "l" && this.query.length === 0)) {
      const nodes = this.getDisplayNodes();
      const sel = nodes[this.treeCursor];
      if (sel) {
        this.screen = "treeCustom";
        this.isLabeling = true;
        this.editingNodeId = sel.node.id;
        this.inputBuffer = sel.node.label || "";
        this.feedbackText = `Editing label for ${sel.node.id}`;
        this.tui.requestRender?.();
      }
      return;
    }

    // Timestamps toggle: Shift+T ('T') or 't' when query is empty
    if (data === "T" || (data === "t" && this.query.length === 0)) {
      this.showTimestamps = !this.showTimestamps;
      this.feedbackText = `Timestamps: ${this.showTimestamps ? "on" : "off"}`;
      this.tui.requestRender?.();
      return;
    }

    // Navigation: Up / 'k'
    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k" || data === "\x10") {
      const nodes = this.getDisplayNodes();
      if (nodes.length > 0) {
        this.treeCursor = (this.treeCursor - 1 + nodes.length) % nodes.length;
      }
      this.tui.requestRender?.();
      return;
    }

    // Navigation: Down / 'j'
    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j" || data === "\x0e") {
      const nodes = this.getDisplayNodes();
      if (nodes.length > 0) {
        this.treeCursor = (this.treeCursor + 1) % nodes.length;
      }
      this.tui.requestRender?.();
      return;
    }

    // Navigation: Page Up / Left
    if (matchesKey(data, Key.left) || data === "\x1b[D" || data === "\x02") {
      const nodes = this.getDisplayNodes();
      if (nodes.length > 0) {
        this.treeCursor = Math.max(0, this.treeCursor - 5);
      }
      this.tui.requestRender?.();
      return;
    }

    // Navigation: Page Down / Right
    if (matchesKey(data, Key.right) || data === "\x1b[C" || data === "\x06") {
      const nodes = this.getDisplayNodes();
      if (nodes.length > 0) {
        this.treeCursor = Math.min(nodes.length - 1, this.treeCursor + 5);
      }
      this.tui.requestRender?.();
      return;
    }

    // Enter: Jump to selected node
    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      const nodes = this.getDisplayNodes();
      const sel = nodes[this.treeCursor];
      if (sel) {
        this.options.onJumpToNode?.(sel.node.id);
        this.close(sel.node);
      }
      return;
    }

    // Semantic Copy: Ctrl+X (\x18), or 'c' / 'y' when query is empty
    if (data === "\x18" || ((data === "c" || data === "y") && this.query.length === 0)) {
      const nodes = this.getDisplayNodes();
      const sel = nodes[this.treeCursor];
      if (sel) {
        const nodeText =
          sel.node.summary ||
          sel.node.label ||
          (sel.node as any).content ||
          (sel.node as any).text ||
          `${sel.node.id} [${sel.node.role || "turn"}]`;

        if (!nodeText.trim()) {
          this.feedbackText = "Selected entry has no text to copy";
          this.tui.requestRender?.();
          return;
        }

        if (typeof this.options.clipboardWriter === "function") {
          let writerRes: boolean | Promise<boolean>;
          try {
            writerRes = this.options.clipboardWriter(nodeText);
          } catch (err: any) {
            this.feedbackText = `copy failed: ${err?.message || "error"}`;
            this.tui.requestRender?.();
            return;
          }

          if (typeof writerRes === "boolean") {
            if (writerRes) {
              this.feedbackText = "Copied selected message to clipboard";
              this.options.onCopy?.(nodeText);
            } else {
              this.feedbackText = "copy failed: clipboard rejected write";
            }
            this.tui.requestRender?.();
            return;
          }

          Promise.resolve(writerRes)
            .then((ok) => {
              if (this.closed) return;
              if (ok) {
                this.feedbackText = "Copied selected message to clipboard";
                this.options.onCopy?.(nodeText);
              } else {
                this.feedbackText = "copy failed: clipboard rejected write";
              }
              this.tui.requestRender?.();
            })
            .catch((err: any) => {
              if (this.closed) return;
              this.feedbackText = `copy failed: ${err?.message || "error"}`;
              this.tui.requestRender?.();
            });
          return;
        }

        // Leaf default native copyToClipboard
        this.feedbackText = "Copied selected message to clipboard";
        nativeCopyToClipboard(nodeText)
          .then(() => {
            if (this.closed) return;
            this.options.onCopy?.(nodeText);
            this.tui.requestRender?.();
          })
          .catch((err: any) => {
            if (this.closed) return;
            this.feedbackText = `copy failed: ${err?.message || "clipboard unavailable"}`;
            this.tui.requestRender?.();
          });
        this.tui.requestRender?.();
      }
      return;
    }

    // Backspace: removes search character
    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.treeCursor = 0;
        this.tui.requestRender?.();
      }
      return;
    }

    // Search query typing: printable characters
    if (data.length === 1 && data >= " " && data <= "~") {
      if (this.query.length > 0 || !["f", "s", "c", "y", "l", "L", "t", "T", " "].includes(data)) {
        this.query += data;
        this.treeCursor = 0;
        this.tui.requestRender?.();
        return;
      }
    }
  }

  private handleInputSummary(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      this.screen = "tree";
      this.tui.requestRender?.();
      return;
    }

    // Navigation: Up / 'k'
    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k") {
      this.summaryCursor = Math.max(0, this.summaryCursor - 1);
      this.tui.requestRender?.();
      return;
    }

    // Navigation: Down / 'j'
    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j") {
      this.summaryCursor = Math.min(2, this.summaryCursor + 1);
      this.tui.requestRender?.();
      return;
    }

    // Enter: Select summary option
    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      if (this.summaryCursor === 0) {
        this.options.onBranchSummary?.("keep");
        this.feedbackText = "Branch summary: No summary";
        this.screen = "tree";
      } else if (this.summaryCursor === 1) {
        this.options.onBranchSummary?.("summarize");
        this.feedbackText = "Branch summary: Summarize";
        this.screen = "tree";
      } else if (this.summaryCursor === 2) {
        this.screen = "treeCustom";
        this.isLabeling = false;
        this.inputBuffer = "";
      }
      this.tui.requestRender?.();
      return;
    }
  }

  private handleInputCustom(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      this.screen = this.isLabeling ? "tree" : "treeSummary";
      this.inputBuffer = "";
      this.tui.requestRender?.();
      return;
    }

    // Enter commits label or submits custom instructions
    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      if (this.isLabeling) {
        const id = this.editingNodeId;
        if (id) {
          const node = this.options.nodes.find((n) => n.id === id);
          if (node) {
            node.label = this.inputBuffer.trim();
          }
          this.options.onSetLabel?.(id, this.inputBuffer.trim());
          this.feedbackText = `Label saved: ${this.inputBuffer.trim()}`;
        }
        this.screen = "tree";
        this.isLabeling = false;
        this.inputBuffer = "";
      } else {
        this.options.onBranchSummary?.("custom", this.inputBuffer.trim());
        this.feedbackText = "Custom prompt submitted";
        this.screen = "tree";
        this.inputBuffer = "";
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.inputBuffer.length > 0) {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
        this.tui.requestRender?.();
      }
      return;
    }

    // Ctrl+J newline for multiline custom instructions
    if (data === "\x0a" || data === "\n") {
      if (!this.isLabeling) {
        this.inputBuffer += "\n";
        this.tui.requestRender?.();
      }
      return;
    }

    if (data.length === 1 && data >= " " && data <= "~") {
      this.inputBuffer += data;
      this.tui.requestRender?.();
      return;
    }
  }

  private treeHelpItems(): string[] {
    const branch = process.platform === "darwin" ? "option+←/→" : "ctrl+←/→";
    return [
      "↑/↓ move",
      "←/→ page",
      `${branch} branch`,
      "ctrl+x copy",
      "shift+l label",
      "shift+t label time",
      "filters ctrl+d/t/u/l/a",
      "cycle ctrl+o/shift+ctrl+o",
    ];
  }

  private treeHelpLines(width: number): string[] {
    const safeW = Math.max(1, width);
    const indent = "  ";
    const sep = " · ";
    const raw: string[] = [];
    let cur = "";

    for (const item of this.treeHelpItems()) {
      let cand: string;
      if (cur !== "") {
        cand = cur + sep + item;
      } else if (visibleWidth(indent + item) <= safeW) {
        cand = indent + item;
      } else {
        cand = item;
      }

      if (cur === "" || visibleWidth(cand) <= safeW) {
        cur = cand;
        continue;
      }
      raw.push(cur.trimEnd());
      if (visibleWidth(indent + item) <= safeW) {
        cur = indent + item;
      } else {
        cur = item;
      }
    }
    if (cur !== "") {
      raw.push(cur.trimEnd());
    }

    return raw.flatMap(line => wrapTextWithAnsi(line, safeW)).map(line => dimSafe(this.theme, line));
  }

  private treeHint(key: string, desc: string): string {
    return dimSafe(this.theme, key) + " " + dimSafe(this.theme, desc);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const border = fgSafe(this.theme, "border", "─".repeat(safeWidth));

    // Sub-Screen: "treeSummary"
    if (this.screen === "treeSummary") {
      const title = " " + boldSafe(this.theme, fgSafe(this.theme, "accent", "Summarize branch?"));
      const options = ["No summary", "Summarize", "Summarize with custom prompt"];
      const optLines = options.map((opt, i) => {
        if (i === this.summaryCursor) {
          return " " + fgSafe(this.theme, "accent", "→ ") + boldSafe(this.theme, fgSafe(this.theme, "accent", opt));
        }
        return "   " + opt;
      });
      const hint =
        " " +
        this.treeHint("↑↓", "navigate") +
        "  " +
        this.treeHint("enter", "select") +
        "  " +
        this.treeHint("escape/ctrl+c", "cancel");

      return [
        border,
        "",
        truncateToWidth(title, safeWidth, ""),
        "",
        ...optLines.map((l) => truncateToWidth(l, safeWidth, "")),
        "",
        truncateToWidth(hint, safeWidth, ""),
        "",
        border,
      ];
    }

    // Sub-Screen: "treeCustom"
    if (this.screen === "treeCustom") {
      const rawTitle = this.isLabeling
        ? "Bookmark Label (empty to remove)"
        : "Custom summarization instructions";
      const title = " " + boldSafe(this.theme, fgSafe(this.theme, "accent", rawTitle));
      const promptLine = "  > " + this.inputBuffer + fgSafe(this.theme, "accent", "▌");
      const hint =
        " " +
        this.treeHint("enter", "submit") +
        "  " +
        this.treeHint("ctrl+j", "newline") +
        "  " +
        this.treeHint("escape/ctrl+c", "cancel");

      return [
        border,
        "",
        truncateToWidth(title, safeWidth, ""),
        "",
        truncateToWidth(promptLine, safeWidth, ""),
        "",
        truncateToWidth(hint, safeWidth, ""),
        "",
        border,
      ];
    }

    // Main Screen: "tree"
    const nodes = this.getDisplayNodes();
    const lines: string[] = [];

    // Title line: "   Session Tree"
    const title = "   " + boldSafe(this.theme, "Session Tree");
    lines.push("");
    lines.push(border);
    lines.push(truncateToWidth(title, safeWidth, ""));

    // Help lines
    lines.push(...this.treeHelpLines(safeWidth));

    // Search query line
    let searchLine = "  " + dimSafe(this.theme, "Type to search:");
    if (this.query) {
      searchLine += " " + fgSafe(this.theme, "accent", this.query);
    }
    lines.push(truncateToWidth(searchLine, safeWidth, ""));
    lines.push(border);
    lines.push("");

    // Tree nodes in scrolling window
    const winSize = Math.max(5, Math.min(24, nodes.length || 1));
    const { start, end, hasAbove, hasBelow } = calculateWindow(
      this.treeCursor,
      nodes.length,
      winSize,
    );

    if (nodes.length === 0) {
      lines.push("  " + dimSafe(this.theme, "No entries found"));
    } else {
      if (hasAbove) {
        lines.push("  " + dimSafe(this.theme, `… (+${start} above)`));
      }

      for (let i = start; i < end; i++) {
        const item = nodes[i]!;
        const isSel = i === this.treeCursor;

        // Selection cursor (› or 2 spaces)
        const cursorPart = isSel
          ? fgSafe(this.theme, "accent", "› ")
          : "  ";

        // Branch connectors
        let connectorPart = "";
        if (item.depth > 0) {
          let indent = "";
          for (let l = 1; l < item.depth; l++) {
            indent += item.ancestorsAreLast[l - 1] ? "   " : "│  ";
          }
          const branch = item.isLastSibling ? "└" : "├";
          let stem = "─ ";
          if (item.hasChildren) {
            stem = item.isFolded ? "⊞ " : "⊟ ";
          }
          connectorPart = indent + branch + stem;
        } else if (item.hasChildren && item.isFolded) {
          connectorPart = "⊞ ";
        }

        const styledConnector = dimSafe(this.theme, connectorPart);

        // Active path bullet (• ) in accent
        const activePart = item.isActivePath
          ? fgSafe(this.theme, "accent", "• ")
          : "";

        // Bookmark label
        const labelPart = item.node.label
          ? fgSafe(this.theme, "warning", `[${item.node.label}] `)
          : "";

        // Timestamps (when toggled on)
        const timePart =
          this.showTimestamps && item.node.timestamp
            ? dimSafe(this.theme, `(${formatTimestamp(item.node.timestamp)}) `)
            : "";

        // Role & Summary
        const role = item.node.role;
        let rolePart = "";
        if (role === "user") {
          rolePart = "user: ";
        } else if (role === "assistant") {
          rolePart = "assistant: ";
        } else if (role === "tool") {
          rolePart = "[tool]: ";
        } else if (role === "system") {
          rolePart = "[system]: ";
        }

        const summaryText = (item.node.summary || item.node.id).replace(
          role === "user" ? /^User:\s*/i : role === "assistant" ? /^Assistant:\s*/i : /$^/, "");
        // Optional labels/times must not consume the whole narrow panel: keep
        // the role and at least a small summary anchor visible.
        const prefix = cursorPart + styledConnector + activePart;
        const content = rolePart + summaryText;
        const reserve = Math.min(visibleWidth(content), visibleWidth(rolePart) + 4);
        const metadataWidth = Math.max(0, safeWidth - visibleWidth(prefix) - reserve);
        const metadata = truncateToWidth(labelPart + timePart, metadataWidth, "");
        const rowLine = truncateToWidth(prefix + metadata + content, safeWidth, "");
        lines.push(isSel ? selectedDialogRow(this.theme, rowLine, visibleWidth(rowLine)) : rowLine);
      }

      if (hasBelow) {
        lines.push("  " + dimSafe(this.theme, `… (+${nodes.length - end} below)`));
      }
    }

    // Status line: (selected/total)
    const statusIdx = nodes.length > 0 ? `(${this.treeCursor + 1}/${nodes.length})` : "(0/0)";
    const modeBadge = this.mode !== "default" ? ` [${this.mode}]` : "";
    const statusLine = `  ${statusIdx}${modeBadge}`;
    lines.push(truncateToWidth(dimSafe(this.theme, statusLine), safeWidth, ""));

    lines.push("");
    lines.push(border);

    // If options.targetHeight is provided and exceeds panel length, pad top to pin to bottom
    const targetH = (this.options as any)?.targetHeight;
    if (typeof targetH === "number" && targetH > lines.length) {
      const topPad = targetH - lines.length;
      const blankRow = " ".repeat(safeWidth);
      const padded: string[] = [];
      for (let p = 0; p < topPad; p++) {
        padded.push(blankRow);
      }
      return [...padded, ...lines];
    }

    return lines;
  }
}

// Aliases for seamless drop-in compatibility across suites
export class OmtTreeComponent extends OmtTreeDialogComponent {}
export class TreeDialogComponent extends OmtTreeDialogComponent {}

export function createOmtTreeComponent(
  tui: TUI,
  theme: Theme,
  keybindings?: KeybindingsManager,
  done?: (value?: unknown) => void,
  ctxOrOptions?: ExtensionContext | OmtTreeDialogOptions,
  maybeOptions?: OmtTreeDialogOptions,
): Component {
  return new OmtTreeDialogComponent(tui, theme, keybindings, done, ctxOrOptions, maybeOptions);
}

export function createTreeDialogComponent(
  tui: TUI,
  theme: Theme,
  keybindings?: KeybindingsManager,
  done?: (value?: unknown) => void,
  ctxOrOptions?: ExtensionContext | OmtTreeDialogOptions,
  maybeOptions?: OmtTreeDialogOptions,
): Component {
  return new OmtTreeDialogComponent(tui, theme, keybindings, done, ctxOrOptions, maybeOptions);
}

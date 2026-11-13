import { Container, Text, Key, matchesKey, truncateToWidth, visibleWidth, decodeKittyPrintable, type Component, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import type { SessionTreeNodeItem, SessionTreeOptions, SessionTreeFactory } from "./types.ts";
import { getBorderStyler } from "../../presets/shared/style.ts";
import { safeFg, safeBold, safeDim, copyTreeContent, buildSessionTreeItems, type DisplayTreeNode, flattenSessionTree, filterTreeNodes } from "./model.ts";

export class SessionTreeComponent extends Container implements Component {
  readonly capturesViewportInput: boolean = true;
  readonly wantsKeyRelease: boolean = false;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options?: SessionTreeOptions;

  private treeRoots: SessionTreeNodeItem[] = [];
  private flatDisplayNodes: DisplayTreeNode[] = [];
  private filteredDisplayNodes: DisplayTreeNode[] = [];
  private selectedIndex: number = 0;
  private query: string = "";
  private isSearching: boolean = false;
  private statusMessage: string = "";
  private closed: boolean = false;
  private maxVisible: number = 10;

  private topBorder: DynamicBorder;
  private titleText: Text;
  private searchBar: Text;
  private midBorder: DynamicBorder;
  private treeText: Text;
  private statusText: Text;
  private botBorder: DynamicBorder;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options?: SessionTreeOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    if (options?.tree && options.tree.length > 0) {
      this.treeRoots = buildSessionTreeItems(options.tree, options.currentLeafId);
      this.refreshDisplayNodes();
    }

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.titleText = new Text("", 0, 0);
    this.searchBar = new Text("", 0, 0);
    this.midBorder = new DynamicBorder(borderStyle);
    this.treeText = new Text("", 0, 0);
    this.statusText = new Text("", 0, 0);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.titleText);
    this.addChild(this.searchBar);
    this.addChild(this.midBorder);
    this.addChild(this.treeText);
    this.addChild(this.statusText);
    this.addChild(this.botBorder);

    // If options.tree was omitted, attempt to load tree from active sessionManager
    if (!options?.tree || options.tree.length === 0) {
      this.loadFromSessionManager();
    }
  }

  private loadFromSessionManager(): void {
    try {
      const sm = (this.ctx as any)?.sessionManager;
      if (sm && typeof sm.getTree === "function") {
        const tree = sm.getTree();
        const leafId = typeof sm.getLeafId === "function" ? sm.getLeafId() : undefined;
        this.treeRoots = buildSessionTreeItems(tree, this.options?.currentLeafId ?? leafId);
        this.refreshDisplayNodes();
        this.tui.requestRender?.();
      }
    } catch {
      // Gracefully handle uninitialized session
    }
  }

  private refreshDisplayNodes(): void {
    this.flatDisplayNodes = flattenSessionTree(this.treeRoots);
    this.filterNodes();
  }

  private filterNodes(): void {
    this.filteredDisplayNodes = filterTreeNodes(this.flatDisplayNodes, this.query);
    if (this.selectedIndex >= this.filteredDisplayNodes.length) {
      this.selectedIndex = Math.max(0, this.filteredDisplayNodes.length - 1);
    }
  }

  getTreeRoots(): SessionTreeNodeItem[] {
    return [...this.treeRoots];
  }

  setTree(tree: unknown[], currentLeafId?: string): void {
    this.treeRoots = buildSessionTreeItems(tree, currentLeafId ?? this.options?.currentLeafId);
    this.refreshDisplayNodes();
    this.tui.requestRender?.();
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getSelectedNode(): SessionTreeNodeItem | undefined {
    return this.filteredDisplayNodes[this.selectedIndex]?.node;
  }

  getQuery(): string {
    return this.query;
  }

  setQuery(query: string): void {
    this.query = query;
    this.filterNodes();
    this.tui.requestRender?.();
  }

  setStatus(msg: string): void {
    this.statusMessage = msg;
    this.tui.requestRender?.();
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    // Esc / Cancel
    if (
      this.keybindings?.matches?.(data, "tui.select.cancel") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.esc) ||
      data === "\x1b"
    ) {
      if (this.query.length > 0) {
        this.query = "";
        this.isSearching = false;
        this.filterNodes();
        this.tui.requestRender?.();
        return;
      }
      this.close();
      return;
    }

    // Enter / Jump to selected node
    if (
      this.keybindings?.matches?.(data, "tui.select.confirm") ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.return) ||
      data === "\r" ||
      data === "\n"
    ) {
      const selected = this.getSelectedNode();
      if (selected) {
        this.options?.onJumpToNode?.(selected.id);
        this.close(selected.id);
      } else {
        this.close();
      }
      return;
    }

    // 'f' / 'F' to fork from selected node
    if (data === "f" || data === "F") {
      if (!this.isSearching) {
        const selected = this.getSelectedNode();
        if (selected) {
          this.options?.onForkNode?.(selected.id);
          this.setStatus(`Forked branch from ${selected.id.slice(0, 8)}`);
          this.tui.requestRender?.();
          return;
        }
      }
    }

    // '/' to focus search input
    if (data === "/" && !this.isSearching) {
      this.isSearching = true;
      this.tui.requestRender?.();
      return;
    }

    // 'c' / 'C' to copy node ID or preview
    if ((data === "c" || data === "C") && !this.isSearching) {
      const selected = this.getSelectedNode();
      if (selected) {
        const copyText = `Node ID: ${selected.id}\nType: ${selected.type}\nSummary: ${selected.summary ?? ""}`;
        void copyTreeContent(copyText);
        this.setStatus(`Copied node ${selected.id.slice(0, 8)}`);
      }
      return;
    }

    // 'q' / 'Q' to close when not in active search
    if ((data === "q" || data === "Q") && this.query.length === 0 && !this.isSearching) {
      this.close();
      return;
    }

    // Up Arrow / 'k'
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A" ||
      (!this.isSearching && data === "k")
    ) {
      if (this.filteredDisplayNodes.length > 0) {
        this.selectedIndex =
          this.selectedIndex <= 0 ? this.filteredDisplayNodes.length - 1 : this.selectedIndex - 1;
        this.tui.requestRender?.();
      }
      return;
    }

    // Down Arrow / 'j'
    if (
      this.keybindings?.matches?.(data, "tui.select.down") ||
      matchesKey(data, Key.down) ||
      data === "\x1b[B" ||
      (!this.isSearching && data === "j")
    ) {
      if (this.filteredDisplayNodes.length > 0) {
        this.selectedIndex =
          this.selectedIndex >= this.filteredDisplayNodes.length - 1 ? 0 : this.selectedIndex + 1;
        this.tui.requestRender?.();
      }
      return;
    }

    // Backspace / Delete
    if (
      matchesKey(data, Key.backspace) ||
      matchesKey(data, Key.delete) ||
      data === "\x7f" ||
      data === "\b" ||
      data === "\x1b[3~"
    ) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.filterNodes();
        this.tui.requestRender?.();
      }
      return;
    }

    // Kitty printable character
    const kittyPrintable = decodeKittyPrintable(data);
    if (kittyPrintable) {
      this.query += kittyPrintable;
      this.filterNodes();
      this.tui.requestRender?.();
      return;
    }

    // Normal printable typing
    if (
      !data.startsWith("\x1b") &&
      !data.includes("\r") &&
      !data.includes("\n") &&
      !data.includes("\t")
    ) {
      const printable = data.replace(/[\x00-\x1f\x7f]/g, "");
      if (printable.length > 0) {
        this.query += printable;
        this.filterNodes();
        this.tui.requestRender?.();
      }
    }
  }

  private updateView(width: number): void {
    const safeWidth = Math.max(1, width);
    const theme = this.theme;

    // 1. Title bar
    const totalCount = this.flatDisplayNodes.length;
    let titleStr = "";

    if (safeWidth >= 80) {
      const left = `${safeBold(theme, safeFg(theme, "accent", "OMT Session Tree & Branch Explorer"))} · ${totalCount} nodes`;
      const right = safeDim(theme, "Press / to search · f to fork");
      const leftW = visibleWidth(left);
      const rightW = visibleWidth(right);
      const pad = Math.max(1, safeWidth - leftW - rightW);
      titleStr = truncateToWidth(`${left}${" ".repeat(pad)}${right}`, safeWidth, "");
    } else if (safeWidth >= 40) {
      titleStr = truncateToWidth(
        `${safeBold(theme, safeFg(theme, "accent", "Session Tree"))} (${totalCount} nodes)`,
        safeWidth,
        "",
      );
    } else {
      titleStr = truncateToWidth(safeBold(theme, safeFg(theme, "accent", "Tree")), safeWidth, "");
    }
    this.titleText.setText(titleStr);

    // 2. Search row
    const prompt = safeBold(theme, safeFg(theme, "accent", "/ "));
    let searchContent = "";
    if (this.query.length === 0) {
      const placeholder = safeWidth < 50 ? "Search..." : "Type to filter tree nodes...";
      searchContent = safeDim(theme, placeholder);
    } else {
      searchContent = `${this.query}${safeFg(theme, "accent", "▏")}`;
    }
    this.searchBar.setText(truncateToWidth(`${prompt}${searchContent}`, safeWidth, ""));

    // 3. Tree display items
    if (this.filteredDisplayNodes.length === 0) {
      const emptyMsg = this.flatDisplayNodes.length === 0
        ? "  No tree nodes found"
        : "  No matching tree nodes found";
      this.treeText.setText(truncateToWidth(safeDim(theme, emptyMsg), safeWidth, ""));
    } else {
      const startIndex = Math.max(
        0,
        Math.min(
          this.selectedIndex - Math.floor(this.maxVisible / 2),
          this.filteredDisplayNodes.length - this.maxVisible,
        ),
      );
      const endIndex = Math.min(startIndex + this.maxVisible, this.filteredDisplayNodes.length);
      const visible = this.filteredDisplayNodes.slice(startIndex, endIndex);

      const lines = visible.map((item, idx) => {
        const actualIdx = startIndex + idx;
        const isSelected = actualIdx === this.selectedIndex;
        const node = item.node;

        const pointer = isSelected ? safeBold(theme, safeFg(theme, "accent", "→ ")) : "  ";
        const curMarker = node.isCurrent ? safeBold(theme, safeFg(theme, "warning", "*")) : " ";
        const leafMarker = node.isLeaf ? safeDim(theme, " (leaf)") : "";
        const labelMarker = node.label ? safeFg(theme, "accent", ` [${node.label}]`) : "";

        const shortId = node.id.slice(0, 8);
        const role = node.type;
        const summary = node.summary || `Node ${shortId}`;

        // Connector prefix
        const connector = safeDim(theme, item.prefix);

        let row = "";
        if (safeWidth >= 100) {
          const idBadge = safeDim(theme, `[${shortId}]`);
          const roleBadge = safeFg(theme, "muted", `[${role}]`);
          const styledSummary = isSelected
            ? safeBold(theme, safeFg(theme, "accent", summary))
            : summary;

          row = `${pointer}${curMarker} ${connector}${idBadge} ${roleBadge} ${styledSummary}${labelMarker}${leafMarker}`;
        } else if (safeWidth >= 60) {
          const roleBadge = safeFg(theme, "muted", `[${role}]`);
          const styledSummary = isSelected
            ? safeBold(theme, safeFg(theme, "accent", summary))
            : summary;

          row = `${pointer}${curMarker}${connector}${roleBadge} ${styledSummary}${leafMarker}`;
        } else if (safeWidth >= 35) {
          const styledSummary = isSelected
            ? safeBold(theme, safeFg(theme, "accent", summary))
            : summary;
          row = `${curMarker}${connector}[${role.slice(0, 4)}] ${styledSummary}`;
        } else {
          const styledSummary = isSelected ? `>${summary}` : summary;
          row = `${curMarker}${connector.slice(-3)}${styledSummary}`;
        }

        return truncateToWidth(row, safeWidth, "");
      });

      this.treeText.setText(lines.join("\n"));
    }

    // 4. Status / Action hints
    if (this.statusMessage) {
      this.statusText.setText(
        truncateToWidth(safeFg(theme, "success", `• ${this.statusMessage}`), safeWidth, ""),
      );
    } else {
      let hints = "";
      if (safeWidth >= 85) {
        hints = "↑↓ Navigate · ↵ Jump · f Fork · c Copy · / Search · Esc Close";
      } else if (safeWidth >= 50) {
        hints = "↑↓ Nav · ↵ Jump · f Fork · / Search · Esc Close";
      } else if (safeWidth >= 30) {
        hints = "↵ Jump · f Fork · Esc Close";
      } else {
        hints = "Esc Close";
      }
      this.statusText.setText(truncateToWidth(safeDim(theme, hints), safeWidth, ""));
    }
  }

  override render(width: number): string[] {
    this.updateView(width);
    return super.render(width);
  }
}

/**
 * Session Tree Component Factory.
 */
export const createSessionTreeComponent: SessionTreeFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: SessionTreeOptions,
): Component => {
  return new SessionTreeComponent(tui, theme, keybindings, done, ctx, options);
};

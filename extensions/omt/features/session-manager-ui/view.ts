import { Container, Text, Key, matchesKey, truncateToWidth, visibleWidth, decodeKittyPrintable, type Component, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import type { SessionItem, ExportFormat, SessionManagerOptions, SessionManagerFactory } from "./types.ts";
import { getBorderStyler } from "../../presets/shared/style.ts";
import { EXPORT_FORMATS, safeFg, safeBold, safeDim, copyContentToClipboard, formatSessionTimestamp, formatTokenCount, formatSessionSummary, extractSessionList, filterSessions } from "./model.ts";

export class SessionManagerComponent extends Container implements Component {
  readonly capturesViewportInput: boolean = true;
  readonly wantsKeyRelease: boolean = false;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options?: SessionManagerOptions;

  private allSessions: SessionItem[] = [];
  private filteredSessions: SessionItem[] = [];
  private selectedIndex: number = 0;
  private query: string = "";
  private isSearching: boolean = false;
  private activeFormatIndex: number = 0;
  private showExportDialog: boolean = false;
  private statusMessage: string = "";
  private closed: boolean = false;
  private maxVisible: number = 7;

  private topBorder: DynamicBorder;
  private titleText: Text;
  private searchBar: Text;
  private exportBar: Text;
  private midBorder: DynamicBorder;
  private listText: Text;
  private statusText: Text;
  private botBorder: DynamicBorder;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options?: SessionManagerOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    if (options?.sessions) {
      this.allSessions = [...options.sessions];
      this.filteredSessions = [...this.allSessions];
    }

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.titleText = new Text("", 0, 0);
    this.searchBar = new Text("", 0, 0);
    this.exportBar = new Text("", 0, 0);
    this.midBorder = new DynamicBorder(borderStyle);
    this.listText = new Text("", 0, 0);
    this.statusText = new Text("", 0, 0);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.titleText);
    this.addChild(this.searchBar);
    this.addChild(this.exportBar);
    this.addChild(this.midBorder);
    this.addChild(this.listText);
    this.addChild(this.statusText);
    this.addChild(this.botBorder);

    // If sessions were not provided in options, asynchronously populate them
    if (!options?.sessions || options.sessions.length === 0) {
      void this.loadSessions();
    }
  }

  private async loadSessions(): Promise<void> {
    try {
      const loaded = await extractSessionList(undefined, this.options, this.ctx?.cwd);
      if (loaded.length > 0) {
        this.allSessions = loaded;
        this.filterSessionsList();
        this.tui.requestRender?.();
      }
    } catch {
      // Keep empty list gracefully
    }
  }

  getSessions(): SessionItem[] {
    return [...this.allSessions];
  }

  setSessions(sessions: SessionItem[]): void {
    this.allSessions = [...sessions];
    this.filterSessionsList();
    this.tui.requestRender?.();
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getSelectedSession(): SessionItem | undefined {
    return this.filteredSessions[this.selectedIndex];
  }

  getActiveExportFormat(): ExportFormat {
    return EXPORT_FORMATS[this.activeFormatIndex] ?? "markdown";
  }

  getQuery(): string {
    return this.query;
  }

  setQuery(query: string): void {
    this.query = query;
    this.filterSessionsList();
    this.tui.requestRender?.();
  }

  private filterSessionsList(): void {
    this.filteredSessions = filterSessions(this.allSessions, this.query);
    if (this.selectedIndex >= this.filteredSessions.length) {
      this.selectedIndex = Math.max(0, this.filteredSessions.length - 1);
    }
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
      if (this.showExportDialog) {
        this.showExportDialog = false;
        this.tui.requestRender?.();
        return;
      }
      if (this.isSearching || this.query.length > 0) {
        this.query = "";
        this.isSearching = false;
        this.filterSessionsList();
        this.tui.requestRender?.();
        return;
      }
      this.close();
      return;
    }

    // Enter / Confirm
    if (
      this.keybindings?.matches?.(data, "tui.select.confirm") ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.return) ||
      data === "\r" ||
      data === "\n"
    ) {
      if (this.showExportDialog) {
        const fmt = this.getActiveExportFormat();
        this.options?.onExport?.(fmt);
        this.setStatus(`Exported session (${fmt})`);
        this.showExportDialog = false;
        this.tui.requestRender?.();
        return;
      }

      const selected = this.getSelectedSession();
      if (selected) {
        this.options?.onSelectSession?.(selected);
        this.close(selected);
      } else {
        this.close();
      }
      return;
    }

    // '/' to focus search input
    if (data === "/" && !this.isSearching && !this.showExportDialog) {
      this.isSearching = true;
      this.tui.requestRender?.();
      return;
    }

    // Action shortcuts when not in active search mode
    if (!this.isSearching && this.query.length === 0) {
      // 'e' / 'E' to trigger export or toggle export format / dialog
      if (data === "e" || data === "E") {
        const fmt = this.getActiveExportFormat();
        this.options?.onExport?.(fmt);
        this.showExportDialog = !this.showExportDialog;
        this.setStatus(`Export format: ${fmt} (Enter to export)`);
        this.tui.requestRender?.();
        return;
      }

      // 'c' / 'C' to copy summary / ID to clipboard
      if (data === "c" || data === "C") {
        const selected = this.getSelectedSession();
        if (selected) {
          const summary = formatSessionSummary(selected);
          void copyContentToClipboard(summary);
          this.setStatus(`Copied session ${selected.id.slice(0, 8)} to clipboard`);
        }
        return;
      }

      // 'q' / 'Q' to close
      if (data === "q" || data === "Q") {
        this.close();
        return;
      }

      // Tab to cycle active export format
      if (matchesKey(data, Key.tab) || data === "\t") {
        this.activeFormatIndex = (this.activeFormatIndex + 1) % EXPORT_FORMATS.length;
        const fmt = this.getActiveExportFormat();
        this.setStatus(`Export format: ${fmt}`);
        this.tui.requestRender?.();
        return;
      }
    }

    // Number keys 1-4 when export dialog is open
    if (this.showExportDialog && ["1", "2", "3", "4"].includes(data)) {
      const idx = parseInt(data, 10) - 1;
      if (idx >= 0 && idx < EXPORT_FORMATS.length) {
        this.activeFormatIndex = idx;
        const fmt = this.getActiveExportFormat();
        this.options?.onExport?.(fmt);
        this.setStatus(`Exported session (${fmt})`);
        this.showExportDialog = false;
        this.tui.requestRender?.();
        return;
      }
    }

    // Up Arrow
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A"
    ) {
      if (this.filteredSessions.length > 0) {
        this.selectedIndex =
          this.selectedIndex <= 0 ? this.filteredSessions.length - 1 : this.selectedIndex - 1;
        this.tui.requestRender?.();
      }
      return;
    }

    // Down Arrow
    if (
      this.keybindings?.matches?.(data, "tui.select.down") ||
      matchesKey(data, Key.down) ||
      data === "\x1b[B"
    ) {
      if (this.filteredSessions.length > 0) {
        this.selectedIndex =
          this.selectedIndex >= this.filteredSessions.length - 1 ? 0 : this.selectedIndex + 1;
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
        this.filterSessionsList();
        this.tui.requestRender?.();
      }
      return;
    }

    // Kitty printable character
    const kittyPrintable = decodeKittyPrintable(data);
    if (kittyPrintable) {
      this.query += kittyPrintable;
      this.filterSessionsList();
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
        this.filterSessionsList();
        this.tui.requestRender?.();
      }
    }
  }

  private updateView(width: number): void {
    const safeWidth = Math.max(1, width);
    const theme = this.theme;

    // 1. Header / Title bar
    const activeFormat = this.getActiveExportFormat();
    const countBadge = `${this.allSessions.length} sessions`;
    let titleStr = "";

    if (safeWidth >= 80) {
      const left = safeBold(theme, safeFg(theme, "accent", "OMT Session Manager")) + ` · ${countBadge}`;
      const right = safeFg(theme, "muted", `[Export: ${activeFormat}]`);
      const leftW = visibleWidth(left);
      const rightW = visibleWidth(right);
      const pad = Math.max(1, safeWidth - leftW - rightW);
      titleStr = truncateToWidth(`${left}${" ".repeat(pad)}${right}`, safeWidth, "");
    } else if (safeWidth >= 40) {
      titleStr = truncateToWidth(
        `${safeBold(theme, safeFg(theme, "accent", "Sessions"))} (${countBadge}) ${safeFg(theme, "muted", `[${activeFormat}]`)}`,
        safeWidth,
        "",
      );
    } else {
      titleStr = truncateToWidth(safeBold(theme, safeFg(theme, "accent", "Sessions")), safeWidth, "");
    }
    this.titleText.setText(titleStr);

    // 2. Search row
    const prompt = safeBold(theme, safeFg(theme, "accent", "> "));
    let searchContent = "";
    if (this.query.length === 0) {
      const placeholder = safeWidth < 50 ? "Search..." : "Type to filter sessions...";
      searchContent = safeDim(theme, placeholder);
    } else {
      searchContent = `${this.query}${safeFg(theme, "accent", "▏")}`;
    }
    this.searchBar.setText(truncateToWidth(`${prompt}${searchContent}`, safeWidth, ""));

    // 3. Export Dialog Submenu if active
    if (this.showExportDialog) {
      const dialogTitle = safeBold(theme, safeFg(theme, "warning", "Export Format: "));
      const optionsStr = EXPORT_FORMATS.map((fmt, idx) => {
        const isFmtActive = fmt === activeFormat;
        const label = `[${idx + 1}] ${fmt}`;
        return isFmtActive
          ? safeBold(theme, safeFg(theme, "accent", label))
          : safeDim(theme, label);
      }).join("  ");
      this.exportBar.setText(
        truncateToWidth(`${dialogTitle}${optionsStr}`, safeWidth, ""),
      );
    } else {
      this.exportBar.setText("");
    }

    // 4. Session list items
    if (this.filteredSessions.length === 0) {
      const emptyMsg = this.allSessions.length === 0
        ? "  No conversation sessions found"
        : "  No matching sessions found";
      this.listText.setText(truncateToWidth(safeDim(theme, emptyMsg), safeWidth, ""));
    } else {
      const startIndex = Math.max(
        0,
        Math.min(
          this.selectedIndex - Math.floor(this.maxVisible / 2),
          this.filteredSessions.length - this.maxVisible,
        ),
      );
      const endIndex = Math.min(startIndex + this.maxVisible, this.filteredSessions.length);
      const visible = this.filteredSessions.slice(startIndex, endIndex);

      const lines = visible.map((session, idx) => {
        const actualIdx = startIndex + idx;
        const isSelected = actualIdx === this.selectedIndex;
        const pointer = isSelected ? safeBold(theme, safeFg(theme, "accent", "→ ")) : "  ";
        const curMarker = session.isCurrent ? safeFg(theme, "warning", "* ") : "";

        const shortId = session.id.slice(0, 8);
        const nameOrId = session.name || `Session ${shortId}`;
        const timeStr = formatSessionTimestamp(session.timestamp);
        const msgs = `${session.messageCount ?? 0} msgs`;
        const tokens = formatTokenCount(session.tokenUsage);

        let row = "";
        if (safeWidth >= 100) {
          const styledName = isSelected
            ? safeBold(theme, safeFg(theme, "accent", nameOrId))
            : nameOrId;
          const leftPart = `${pointer}${curMarker}[${shortId}] ${styledName}`;
          const rightPart = `${safeDim(theme, timeStr)} · ${safeFg(theme, "muted", msgs)} · ${safeDim(theme, tokens)}`;
          const leftW = visibleWidth(leftPart);
          const rightW = visibleWidth(rightPart);
          const pad = Math.max(1, safeWidth - leftW - rightW);
          row = `${leftPart}${" ".repeat(pad)}${rightPart}`;
        } else if (safeWidth >= 60) {
          const styledName = isSelected
            ? safeBold(theme, safeFg(theme, "accent", nameOrId))
            : nameOrId;
          const leftPart = `${pointer}${curMarker}[${shortId}] ${styledName}`;
          const rightPart = `${safeDim(theme, timeStr.slice(5))} · ${msgs}`;
          const leftW = visibleWidth(leftPart);
          const rightW = visibleWidth(rightPart);
          const pad = Math.max(1, safeWidth - leftW - rightW);
          row = `${leftPart}${" ".repeat(pad)}${rightPart}`;
        } else if (safeWidth >= 35) {
          const styledName = isSelected
            ? safeBold(theme, safeFg(theme, "accent", nameOrId))
            : nameOrId;
          row = `${pointer}${curMarker}${styledName} ${safeDim(theme, `(${msgs})`)}`;
        } else {
          const styledName = isSelected ? `>${nameOrId}` : nameOrId;
          row = `${curMarker}${styledName}`;
        }

        return truncateToWidth(row, safeWidth, "");
      });

      this.listText.setText(lines.join("\n"));
    }

    // 5. Status / Actions bar
    if (this.statusMessage) {
      this.statusText.setText(
        truncateToWidth(safeFg(theme, "success", `• ${this.statusMessage}`), safeWidth, ""),
      );
    } else {
      let hints = "";
      if (safeWidth >= 85) {
        hints = "↑↓ Navigate · ↵ Select · e Export · c Copy · / Search · Esc Close";
      } else if (safeWidth >= 50) {
        hints = "↑↓ Nav · ↵ Select · e Export · c Copy · Esc Close";
      } else if (safeWidth >= 30) {
        hints = "↵ Sel · e Exp · Esc Close";
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
 * Session Manager Component Factory.
 */
export const createSessionManagerComponent: SessionManagerFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: SessionManagerOptions,
): Component => {
  return new SessionManagerComponent(tui, theme, keybindings, done, ctx, options);
};

import { Container, Text, visibleWidth, truncateToWidth, matchesKey, Key, decodeKittyPrintable, type Component, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { DynamicBorder, type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import type { PaletteAction, CommandPaletteFactory } from "./types.ts";

import { getBorderStyler } from "../../presets/shared/style.ts";
import { formatCategoryBadge, createDefaultPaletteActions, filterPaletteActions } from "./model.ts";

export class CommandPaletteComponent extends Container implements Component {
  readonly capturesViewportInput: boolean = true;
  readonly wantsKeyRelease: boolean = false;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private allActions: PaletteAction[];
  private filteredActions: PaletteAction[];
  private query: string = "";
  private selectedIndex: number = 0;
  private maxVisible: number = 8;
  private closed: boolean = false;

  private topBorder: DynamicBorder;
  private titleText: Text;
  private searchBar: Text;
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
    actions: PaletteAction[],
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.allActions = actions && actions.length > 0 ? actions : createDefaultPaletteActions(ctx);
    this.filteredActions = [...this.allActions];

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.titleText = new Text("", 0, 0);
    this.searchBar = new Text("", 0, 0);
    this.midBorder = new DynamicBorder(borderStyle);
    this.listText = new Text("", 0, 0);
    this.statusText = new Text("", 0, 0);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.titleText);
    this.addChild(this.searchBar);
    this.addChild(this.midBorder);
    this.addChild(this.listText);
    this.addChild(this.statusText);
    this.addChild(this.botBorder);
  }

  getQuery(): string {
    return this.query;
  }

  setQuery(query: string): void {
    this.query = query;
    this.selectedIndex = 0;
    this.filteredActions = filterPaletteActions(this.allActions, this.query);
    this.tui.requestRender?.();
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getFilteredActions(): PaletteAction[] {
    return [...this.filteredActions];
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    // Esc / cancel
    if (
      this.keybindings?.matches?.(data, "tui.select.cancel") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.esc) ||
      data === "\x1b"
    ) {
      this.close();
      return;
    }

    // Enter / confirm
    if (
      this.keybindings?.matches?.(data, "tui.select.confirm") ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.return) ||
      data === "\r" ||
      data === "\n"
    ) {
      const selected = this.filteredActions[this.selectedIndex];
      if (selected) {
        try {
          const runRes = selected.run(this.ctx);
          if (runRes && typeof (runRes as Promise<void>).then === "function") {
            (runRes as Promise<void>).then(
              () => this.close(selected),
              () => this.close(selected),
            );
          } else {
            this.close(selected);
          }
        } catch {
          this.close(selected);
        }
      } else {
        this.close();
      }
      return;
    }

    // Up arrow
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A"
    ) {
      if (this.filteredActions.length > 0) {
        this.selectedIndex =
          this.selectedIndex <= 0
            ? this.filteredActions.length - 1
            : this.selectedIndex - 1;
        this.tui.requestRender?.();
      }
      return;
    }

    // Down arrow
    if (
      this.keybindings?.matches?.(data, "tui.select.down") ||
      matchesKey(data, Key.down) ||
      data === "\x1b[B"
    ) {
      if (this.filteredActions.length > 0) {
        this.selectedIndex =
          this.selectedIndex >= this.filteredActions.length - 1
            ? 0
            : this.selectedIndex + 1;
        this.tui.requestRender?.();
      }
      return;
    }

    // Page Up (jump 5 items up)
    if (
      this.keybindings?.matches?.(data, "tui.select.pageUp") ||
      matchesKey(data, Key.pageUp) ||
      data === "\x1b[5~"
    ) {
      if (this.filteredActions.length > 0) {
        this.selectedIndex = Math.max(0, this.selectedIndex - 5);
        this.tui.requestRender?.();
      }
      return;
    }

    // Page Down (jump 5 items down)
    if (
      this.keybindings?.matches?.(data, "tui.select.pageDown") ||
      matchesKey(data, Key.pageDown) ||
      data === "\x1b[6~"
    ) {
      if (this.filteredActions.length > 0) {
        this.selectedIndex = Math.min(
          this.filteredActions.length - 1,
          this.selectedIndex + 5,
        );
        this.tui.requestRender?.();
      }
      return;
    }

    // Backspace / delete
    if (
      matchesKey(data, Key.backspace) ||
      matchesKey(data, Key.delete) ||
      data === "\x7f" ||
      data === "\b" ||
      data === "\x1b[3~"
    ) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.selectedIndex = 0;
        this.filteredActions = filterPaletteActions(this.allActions, this.query);
        this.tui.requestRender?.();
      }
      return;
    }

    // Kitty protocol printable character
    const kittyPrintable = decodeKittyPrintable(data);
    if (kittyPrintable) {
      this.query += kittyPrintable;
      this.selectedIndex = 0;
      this.filteredActions = filterPaletteActions(this.allActions, this.query);
      this.tui.requestRender?.();
      return;
    }

    // Normal printable character / paste text
    if (
      !data.startsWith("\x1b") &&
      !data.includes("\r") &&
      !data.includes("\n") &&
      !data.includes("\t")
    ) {
      const printable = data.replace(/[\x00-\x1f\x7f]/g, "");
      if (printable.length > 0) {
        this.query += printable;
        this.selectedIndex = 0;
        this.filteredActions = filterPaletteActions(this.allActions, this.query);
        this.tui.requestRender?.();
        return;
      }
    }
  }

  private updateView(width: number): void {
    const safeWidth = Math.max(1, width);
    const theme = this.theme;

    // Helper functions with safe defaults
    const boldFn = (s: string) => (theme.bold ? theme.bold(s) : s);
    const fgFn = (color: ThemeColor, s: string) => (theme.fg ? theme.fg(color, s) : s);

    // 1. Title bar with shortcut hints
    const titleText = boldFn(fgFn("accent", "OMT Command Palette"));
    const hintText = fgFn("dim", "Esc to close · Enter to run");
    const titleWidth = visibleWidth("OMT Command Palette");
    const hintWidth = visibleWidth("Esc to close · Enter to run");

    if (safeWidth >= 55) {
      const pad = Math.max(1, safeWidth - titleWidth - hintWidth);
      this.titleText.setText(
        truncateToWidth(`${titleText}${" ".repeat(pad)}${hintText}`, safeWidth, ""),
      );
    } else {
      const shortHint =
        safeWidth < 35 ? "Esc: close · ↵: run" : "Esc to close · Enter to run";
      this.titleText.setText(
        `${truncateToWidth(titleText, safeWidth, "")}\n${truncateToWidth(
          fgFn("dim", shortHint),
          safeWidth,
          "",
        )}`,
      );
    }

    // 2. Search input line with styled prompt symbol
    const promptSymbol = boldFn(fgFn("accent", "> "));
    let searchContent = "";
    if (this.query.length === 0) {
      const placeholder =
        safeWidth < 40 ? "Search..." : "Type to filter commands...";
      searchContent = fgFn("dim", placeholder);
    } else {
      searchContent = `${this.query}${fgFn("accent", "▏")}`;
    }
    this.searchBar.setText(
      truncateToWidth(`${promptSymbol}${searchContent}`, safeWidth, ""),
    );

    // 3. Action list items
    if (this.filteredActions.length === 0) {
      this.listText.setText(
        truncateToWidth(fgFn("dim", "  No matching commands found"), safeWidth, ""),
      );
      this.statusText.setText("");
    } else {
      const startIndex = Math.max(
        0,
        Math.min(
          this.selectedIndex - Math.floor(this.maxVisible / 2),
          this.filteredActions.length - this.maxVisible,
        ),
      );
      const endIndex = Math.min(
        startIndex + this.maxVisible,
        this.filteredActions.length,
      );
      const visibleItems = this.filteredActions.slice(startIndex, endIndex);

      const lines = visibleItems.map((action, idx) => {
        const actualIdx = startIndex + idx;
        const isSelected = actualIdx === this.selectedIndex;

        const prefix = isSelected ? boldFn(fgFn("accent", "→ ")) : "  ";
        const badgeStr = formatCategoryBadge(action.category, safeWidth, theme);

        let shortcutStr = "";
        if (action.shortcut && safeWidth >= 65) {
          shortcutStr = fgFn("muted", `[${action.shortcut}]`);
        }

        const prefixW = 2;
        const badgeW = visibleWidth(badgeStr);
        const shortcutW = visibleWidth(shortcutStr);
        const titleStyled = isSelected
          ? boldFn(fgFn("accent", action.title))
          : action.title;
        const titleW = visibleWidth(action.title);

        let titleDesc = titleStyled;
        if (safeWidth >= 70 && action.description) {
          const remaining =
            safeWidth -
            prefixW -
            badgeW -
            (badgeW > 0 ? 1 : 0) -
            titleW -
            (shortcutW > 0 ? shortcutW + 2 : 0) -
            2;
          if (remaining >= 12) {
            const descTrunc = truncateToWidth(action.description, remaining, "…");
            titleDesc = `${titleStyled}  ${fgFn("dim", descTrunc)}`;
          }
        }

        const leftPart =
          badgeW > 0 ? `${prefix}${badgeStr} ${titleDesc}` : `${prefix}${titleDesc}`;
        const leftW = visibleWidth(leftPart);

        let line = "";
        if (shortcutW > 0 && safeWidth - leftW - shortcutW >= 1) {
          const pad = safeWidth - leftW - shortcutW;
          line = `${leftPart}${" ".repeat(pad)}${shortcutStr}`;
        } else {
          line = leftPart;
        }

        return truncateToWidth(line, safeWidth, "");
      });

      this.listText.setText(lines.join("\n"));

      // 4. Status summary footer
      const scrollIndicator =
        this.filteredActions.length > this.maxVisible ? " · (↑↓ to scroll)" : "";
      const statusLine = fgFn(
        "dim",
        `Showing ${this.selectedIndex + 1}/${this.filteredActions.length} commands${scrollIndicator}`,
      );
      this.statusText.setText(truncateToWidth(statusLine, safeWidth, ""));
    }
  }

  override render(width: number): string[] {
    this.updateView(width);
    return super.render(width);
  }
}

/**
 * Command palette factory implementing CommandPaletteFactory contract.
 */
export const createCommandPaletteComponent: CommandPaletteFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  actions: PaletteAction[],
): Component => {
  return new CommandPaletteComponent(tui, theme, keybindings, done, ctx, actions);
};

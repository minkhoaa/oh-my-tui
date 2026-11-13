import type { ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { Container, type Component, type KeybindingsManager, type TUI, matchesKey, Key, truncateToWidth, visibleWidth, decodeKittyPrintable } from "@earendil-works/pi-tui";
import type { AccessibilitySettings, ShortcutHelpEntry } from "./types.ts";

export type { AccessibilitySettings, ShortcutHelpEntry } from "./types.ts";
import { accessibilityStore, adaptThemeForHighContrast, asciiBorder } from "./model.ts";

// ==========================================
// Shortcut Help Table & Component
// ==========================================

export const DEFAULT_SHORTCUT_HELP_ENTRIES: ShortcutHelpEntry[] = [
  // Navigation
  { key: "Left / Right", description: "Navigate tabs or horizontal panels", category: "Navigation" },
  { key: "Up / Down", description: "Navigate list items or scroll lines", category: "Navigation" },
  { key: "PageUp / PageDown", description: "Fast scroll transcript by page", category: "Navigation" },
  { key: "Tab / Shift+Tab", description: "Cycle focus between list and detail / cycle tabs", category: "Navigation" },
  { key: "g / G", description: "Jump to top / bottom of scrollback transcript", category: "Navigation" },

  // Presets
  { key: "/omt theme clean", description: "Switch to OMT Clean preset", category: "Presets" },
  { key: "/omt theme ember", description: "Switch to OMT Ember preset", category: "Presets" },
  { key: "/omt theme rail", description: "Switch to OMT Rail preset", category: "Presets" },
  { key: "/omt theme minimal", description: "Switch to Minimal preset", category: "Presets" },
  { key: "/omt theme native", description: "Switch to Native Pi preset", category: "Presets" },

  // Toggles
  { key: "Ctrl+P", description: "Open unified Command Palette", category: "Toggles" },
  { key: "Ctrl+O", description: "Toggle distraction-free Focus Mode", category: "Toggles" },
  { key: "v", description: "Toggle Visual selection mode in scrollback", category: "Toggles" },
  { key: "/", description: "Toggle Search mode in scrollback buffer", category: "Toggles" },
  { key: "/omt settings", description: "Open interactive Settings UI", category: "Toggles" },

  // Actions
  { key: "1 - 5", description: "Jump directly to tab (Chat, Inspector, Git, Sessions, Doctor)", category: "Actions" },
  { key: "Enter", description: "Confirm selection or run highlighted action", category: "Actions" },
  { key: "y", description: "Yank / copy selected transcript text to clipboard", category: "Actions" },
  { key: "Esc", description: "Cancel search, exit selection, or dismiss overlay", category: "Actions" },
  { key: "q", description: "Quit / close active modal component", category: "Actions" },
];

/**
 * Filter shortcut help entries matching search query.
 */
export function filterShortcutEntries(
  entries: ShortcutHelpEntry[],
  query: string,
): ShortcutHelpEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return entries.slice();
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const hay = `${entry.key} ${entry.description} ${entry.category}`.toLowerCase();
    return tokens.every((token) => hay.includes(token));
  });
}

export interface ShortcutHelpOptions {
  entries?: ShortcutHelpEntry[];
}

export class ShortcutHelpComponent extends Container implements Component {
  readonly capturesViewportInput: boolean = true;
  readonly wantsKeyRelease: boolean = false;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private allEntries: ShortcutHelpEntry[];
  private filteredEntries: ShortcutHelpEntry[];
  private query: string = "";
  private selectedIndex: number = 0;
  private maxVisible: number = 8;
  private closed: boolean = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options?: ShortcutHelpOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.allEntries = options?.entries && options.entries.length > 0
      ? options.entries
      : DEFAULT_SHORTCUT_HELP_ENTRIES;
    this.filteredEntries = [...this.allEntries];
  }

  getQuery(): string {
    return this.query;
  }

  setQuery(query: string): void {
    this.query = query;
    this.selectedIndex = 0;
    this.filteredEntries = filterShortcutEntries(this.allEntries, this.query);
    this.tui.requestRender?.();
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getFilteredEntries(): ShortcutHelpEntry[] {
    return [...this.filteredEntries];
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    // Esc to close
    if (
      this.keybindings?.matches?.(data, "tui.select.cancel") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.esc) ||
      data === "\x1b"
    ) {
      this.close();
      return;
    }

    // 'q' or 'Q' to close when query is empty
    if ((data === "q" || data === "Q") && this.query.length === 0) {
      this.close();
      return;
    }

    // Enter to confirm / close
    if (
      this.keybindings?.matches?.(data, "tui.select.confirm") ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.return) ||
      data === "\r" ||
      data === "\n"
    ) {
      const selected = this.filteredEntries[this.selectedIndex];
      this.close(selected);
      return;
    }

    // Up arrow
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A"
    ) {
      if (this.filteredEntries.length > 0) {
        this.selectedIndex =
          this.selectedIndex <= 0
            ? this.filteredEntries.length - 1
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
      if (this.filteredEntries.length > 0) {
        this.selectedIndex =
          this.selectedIndex >= this.filteredEntries.length - 1
            ? 0
            : this.selectedIndex + 1;
        this.tui.requestRender?.();
      }
      return;
    }

    // Page Up
    if (
      this.keybindings?.matches?.(data, "tui.select.pageUp") ||
      matchesKey(data, Key.pageUp) ||
      data === "\x1b[5~"
    ) {
      if (this.filteredEntries.length > 0) {
        this.selectedIndex = Math.max(0, this.selectedIndex - 5);
        this.tui.requestRender?.();
      }
      return;
    }

    // Page Down
    if (
      this.keybindings?.matches?.(data, "tui.select.pageDown") ||
      matchesKey(data, Key.pageDown) ||
      data === "\x1b[6~"
    ) {
      if (this.filteredEntries.length > 0) {
        this.selectedIndex = Math.min(
          this.filteredEntries.length - 1,
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
        this.filteredEntries = filterShortcutEntries(this.allEntries, this.query);
        this.tui.requestRender?.();
      }
      return;
    }

    // Kitty printable character
    const kittyPrintable = decodeKittyPrintable(data);
    if (kittyPrintable) {
      this.query += kittyPrintable;
      this.selectedIndex = 0;
      this.filteredEntries = filterShortcutEntries(this.allEntries, this.query);
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
        this.filteredEntries = filterShortcutEntries(this.allEntries, this.query);
        this.tui.requestRender?.();
        return;
      }
    }
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const theme = accessibilityStore.isHighContrast()
      ? adaptThemeForHighContrast(this.theme)
      : this.theme;

    const boldFn = (s: string) => (theme.bold ? theme.bold(s) : s);
    const fgFn = (color: ThemeColor, s: string) => (theme.fg ? theme.fg(color, s) : s);

    const useAscii = accessibilityStore.isPlainTextAsciiBorders();
    const borderChar = useAscii ? "-" : "─";

    const clamp = (line: string): string => {
      const processed = useAscii ? asciiBorder(line) : line;
      return truncateToWidth(processed, safeWidth, "");
    };

    const lines: string[] = [];

    // 1. Title bar
    const titleStr = boldFn(fgFn("accent", "Keyboard Shortcuts & Accessibility"));
    const hintStr = fgFn("dim", "Esc / q to close");
    const titleW = visibleWidth("Keyboard Shortcuts & Accessibility");
    const hintW = visibleWidth("Esc / q to close");

    if (safeWidth >= 60) {
      const pad = Math.max(1, safeWidth - titleW - hintW);
      lines.push(clamp(`${titleStr}${" ".repeat(pad)}${hintStr}`));
    } else {
      lines.push(clamp(titleStr));
      if (safeWidth >= 30) {
        lines.push(clamp(hintStr));
      }
    }

    // Top border
    lines.push(clamp(fgFn("border", borderChar.repeat(safeWidth))));

    // 2. Search filter input
    const promptSym = boldFn(fgFn("accent", "> "));
    let searchContent = "";
    if (this.query.length === 0) {
      const placeholder = safeWidth < 40 ? "Filter..." : "Type to filter shortcuts...";
      searchContent = fgFn("dim", placeholder);
    } else {
      searchContent = `${this.query}${fgFn("accent", useAscii ? "|" : "▏")}`;
    }
    lines.push(clamp(`${promptSym}${searchContent}`));

    // Middle border
    lines.push(clamp(fgFn("border", borderChar.repeat(safeWidth))));

    // 3. Entries list
    if (this.filteredEntries.length === 0) {
      lines.push(clamp(fgFn("dim", "  No matching shortcuts found")));
    } else {
      const startIndex = Math.max(
        0,
        Math.min(
          this.selectedIndex - Math.floor(this.maxVisible / 2),
          this.filteredEntries.length - this.maxVisible,
        ),
      );
      const endIndex = Math.min(startIndex + this.maxVisible, this.filteredEntries.length);
      const visibleItems = this.filteredEntries.slice(startIndex, endIndex);

      for (let idx = 0; idx < visibleItems.length; idx++) {
        const item = visibleItems[idx]!;
        const actualIdx = startIndex + idx;
        const isSelected = actualIdx === this.selectedIndex;

        const arrow = isSelected ? (useAscii ? "-> " : "→ ") : "   ";
        const cursorStyled = isSelected ? boldFn(fgFn("accent", arrow)) : arrow;

        // Category badge
        let catBadge = "";
        if (safeWidth >= 65) {
          catBadge = fgFn("muted", `[${item.category}]`.padEnd(14));
        } else if (safeWidth >= 40) {
          catBadge = fgFn("muted", `[${item.category.slice(0, 3)}] `);
        }

        // Key representation
        const keyStyled = isSelected
          ? boldFn(fgFn("accent", item.key.padEnd(18)))
          : boldFn(item.key.padEnd(18));

        // Description
        const descText = item.description;

        let entryLine = "";
        if (safeWidth >= 70) {
          entryLine = `${cursorStyled}${catBadge}${keyStyled} ${descText}`;
        } else if (safeWidth >= 45) {
          entryLine = `${cursorStyled}${catBadge}${boldFn(item.key)} - ${descText}`;
        } else {
          entryLine = `${cursorStyled}${boldFn(item.key)}`;
        }

        lines.push(clamp(entryLine));
      }
    }

    // Bottom border
    lines.push(clamp(fgFn("border", borderChar.repeat(safeWidth))));

    // 4. Status summary footer
    const countInfo = `Showing ${this.filteredEntries.length === 0 ? 0 : this.selectedIndex + 1}/${this.filteredEntries.length} shortcuts`;
    const navHint = safeWidth >= 50 ? " · (↑↓ navigate · Esc/q close)" : "";
    lines.push(clamp(fgFn("dim", `${countInfo}${navHint}`)));

    return lines;
  }
}

/**
 * Shortcut Help Component factory.
 */
export function createShortcutHelpComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: ShortcutHelpOptions,
): Component {
  return new ShortcutHelpComponent(tui, theme, keybindings, done, ctx, options);
}

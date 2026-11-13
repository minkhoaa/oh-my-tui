import type { ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import { Container, type Component, type KeybindingsManager, type TUI, matchesKey, Key, truncateToWidth, visibleWidth, decodeKittyPrintable } from "@earendil-works/pi-tui";
import type { ScrollbackFactory, ScrollbackViewOptions } from "./types.ts";
import { asciiBorder, accessibilityStore } from "../accessibility/model.ts";
import { extractTranscriptLines } from "./model.ts";

export class ScrollbackComponent extends Container implements Component {
  readonly capturesViewportInput: boolean = true;
  readonly wantsKeyRelease: boolean = false;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options: ScrollbackViewOptions;

  private lines: string[];
  private cursorLine: number = 0;
  private scrollOffset: number = 0;
  private visibleRows: number = 15;

  private mode: "normal" | "search" | "visual" = "normal";
  private visualAnchor: number = 0;

  private searchQuery: string = "";
  private searchBuffer: string = "";
  private matchIndices: number[] = [];
  private currentMatchIdx: number = -1;

  private toastMessage: string | null = null;
  private toastTimeout: NodeJS.Timeout | null = null;
  private closed: boolean = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options?: ScrollbackViewOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options ?? {};

    if (this.options.lines && Array.isArray(this.options.lines) && this.options.lines.length > 0) {
      this.lines = this.options.lines.slice();
    } else {
      this.lines = extractTranscriptLines(ctx);
    }

    if (this.options.initialQuery) {
      this.searchQuery = this.options.initialQuery;
      this.updateSearchMatches();
    }
  }

  getMode(): "normal" | "search" | "visual" {
    return this.mode;
  }

  getCursorLine(): number {
    return this.cursorLine;
  }

  getLines(): string[] {
    return [...this.lines];
  }

  getSearchQuery(): string {
    return this.searchQuery;
  }

  getMatchIndices(): number[] {
    return [...this.matchIndices];
  }

  getSelectionRange(): [number, number] {
    return [
      Math.min(this.visualAnchor, this.cursorLine),
      Math.max(this.visualAnchor, this.cursorLine),
    ];
  }

  getSelectedText(): string {
    const [start, end] = this.getSelectionRange();
    return this.lines.slice(start, end + 1).join("\n");
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    this.done(result);
  }

  private setCursorLine(line: number): void {
    if (this.lines.length === 0) {
      this.cursorLine = 0;
      this.scrollOffset = 0;
      return;
    }

    this.cursorLine = Math.max(0, Math.min(this.lines.length - 1, line));

    // Keep cursorLine visible in viewport
    if (this.cursorLine < this.scrollOffset) {
      this.scrollOffset = this.cursorLine;
    } else if (this.cursorLine >= this.scrollOffset + this.visibleRows) {
      this.scrollOffset = Math.max(0, this.cursorLine - this.visibleRows + 1);
    }

    this.tui.requestRender?.();
  }

  private scrollBy(delta: number): void {
    this.setCursorLine(this.cursorLine + delta);
  }

  private jumpTop(): void {
    this.setCursorLine(0);
    this.scrollOffset = 0;
    this.tui.requestRender?.();
  }

  private jumpBottom(): void {
    this.setCursorLine(Math.max(0, this.lines.length - 1));
    this.tui.requestRender?.();
  }

  private updateSearchMatches(): void {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) {
      this.matchIndices = [];
      this.currentMatchIdx = -1;
      return;
    }

    const matches: number[] = [];
    for (let i = 0; i < this.lines.length; i++) {
      if (this.lines[i]!.toLowerCase().includes(query)) {
        matches.push(i);
      }
    }

    this.matchIndices = matches;
    if (matches.length > 0) {
      // Find closest match at or after cursorLine
      const idx = matches.findIndex((lineIdx) => lineIdx >= this.cursorLine);
      if (idx !== -1) {
        this.currentMatchIdx = idx;
        this.setCursorLine(matches[idx]!);
      } else {
        this.currentMatchIdx = 0;
        this.setCursorLine(matches[0]!);
      }
    } else {
      this.currentMatchIdx = -1;
    }
  }

  private nextMatch(): void {
    if (this.matchIndices.length === 0) return;
    const nextIdx = (this.currentMatchIdx + 1) % this.matchIndices.length;
    this.currentMatchIdx = nextIdx;
    this.setCursorLine(this.matchIndices[nextIdx]!);
  }

  private prevMatch(): void {
    if (this.matchIndices.length === 0) return;
    const prevIdx =
      (this.currentMatchIdx - 1 + this.matchIndices.length) % this.matchIndices.length;
    this.currentMatchIdx = prevIdx;
    this.setCursorLine(this.matchIndices[prevIdx]!);
  }

  private copySelection(): void {
    const text = this.getSelectedText();
    const [start, end] = this.getSelectionRange();
    const count = end - start + 1;

    try {
      void copyToClipboard(text);
    } catch {
      // Graceful fallback if native clipboard is unsupported
    }

    if (this.options.onCopySelection) {
      try {
        this.options.onCopySelection(text);
      } catch {
        // Suppress callback failure
      }
    }

    this.mode = "normal";
    this.showToast(`Copied ${count} line${count === 1 ? "" : "s"} to clipboard`);
  }

  private showToast(msg: string): void {
    this.toastMessage = msg;
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
    this.tui.requestRender?.();
    this.toastTimeout = setTimeout(() => {
      this.toastMessage = null;
      this.toastTimeout = null;
      this.tui.requestRender?.();
    }, 2500);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    // --- Search Input Mode ---
    if (this.mode === "search") {
      // Esc: cancel search
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
        this.mode = "normal";
        this.searchBuffer = "";
        this.tui.requestRender?.();
        return;
      }

      // Enter: commit search
      if (
        matchesKey(data, Key.enter) ||
        matchesKey(data, Key.return) ||
        data === "\r" ||
        data === "\n"
      ) {
        this.searchQuery = this.searchBuffer;
        this.mode = "normal";
        this.updateSearchMatches();
        this.tui.requestRender?.();
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
        if (this.searchBuffer.length > 0) {
          this.searchBuffer = this.searchBuffer.slice(0, -1);
          this.tui.requestRender?.();
        }
        return;
      }

      // Printable character in search
      const kitty = decodeKittyPrintable(data);
      if (kitty) {
        this.searchBuffer += kitty;
        this.tui.requestRender?.();
        return;
      }

      if (!data.startsWith("\x1b") && !data.includes("\r") && !data.includes("\n")) {
        const printable = data.replace(/[\x00-\x1f\x7f]/g, "");
        if (printable.length > 0) {
          this.searchBuffer += printable;
          this.tui.requestRender?.();
          return;
        }
      }
      return;
    }

    // --- Visual Selection Mode ---
    if (this.mode === "visual") {
      // Esc: cancel visual selection (returns to normal mode, does NOT exit scrollback)
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
        this.mode = "normal";
        this.tui.requestRender?.();
        return;
      }

      // 'y' or Enter: copy selection
      if (
        data === "y" ||
        data === "Y" ||
        matchesKey(data, Key.enter) ||
        matchesKey(data, Key.return) ||
        data === "\r" ||
        data === "\n"
      ) {
        this.copySelection();
        return;
      }

      // Extend selection with Up / Down / PageUp / PageDown / g / G
      if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k") {
        this.scrollBy(-1);
        return;
      }
      if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j") {
        this.scrollBy(1);
        return;
      }
      if (matchesKey(data, Key.pageUp) || data === "\x1b[5~") {
        this.scrollBy(-this.visibleRows);
        return;
      }
      if (matchesKey(data, Key.pageDown) || data === "\x1b[6~") {
        this.scrollBy(this.visibleRows);
        return;
      }
      if (data === "g") {
        this.jumpTop();
        return;
      }
      if (data === "G") {
        this.jumpBottom();
        return;
      }

      // 'q' in visual mode cancels visual mode
      if (data === "q" || data === "Q") {
        this.mode = "normal";
        this.tui.requestRender?.();
        return;
      }
      return;
    }

    // --- Normal Navigation Mode ---

    // Exit scrollback with 'q' or 'Esc'
    if (
      data === "q" ||
      data === "Q" ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.esc) ||
      data === "\x1b"
    ) {
      this.close();
      return;
    }

    // Enter search mode with '/'
    if (data === "/") {
      this.mode = "search";
      this.searchBuffer = "";
      this.tui.requestRender?.();
      return;
    }

    // Next match ('n') / Prev match ('N')
    if (data === "n") {
      this.nextMatch();
      return;
    }
    if (data === "N") {
      this.prevMatch();
      return;
    }

    // Enter visual selection mode with 'v'
    if (data === "v" || data === "V") {
      this.mode = "visual";
      this.visualAnchor = this.cursorLine;
      this.tui.requestRender?.();
      return;
    }

    // Scroll line by line: Up / Down
    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k") {
      this.scrollBy(-1);
      return;
    }
    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j") {
      this.scrollBy(1);
      return;
    }

    // Scroll by page: PageUp / PageDown
    if (matchesKey(data, Key.pageUp) || data === "\x1b[5~") {
      this.scrollBy(-this.visibleRows);
      return;
    }
    if (matchesKey(data, Key.pageDown) || data === "\x1b[6~") {
      this.scrollBy(this.visibleRows);
      return;
    }

    // Jump to top ('g') / bottom ('G')
    if (data === "g") {
      this.jumpTop();
      return;
    }
    if (data === "G") {
      this.jumpBottom();
      return;
    }
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const theme = this.theme;

    const boldFn = (s: string) => (theme.bold ? theme.bold(s) : s);
    const fgFn = (color: ThemeColor, s: string) => (theme.fg ? theme.fg(color, s) : s);

    const useAscii = accessibilityStore.isPlainTextAsciiBorders();
    const borderChar = useAscii ? "-" : "─";
    const linePipe = useAscii ? "|" : "│";

    const clamp = (line: string): string => {
      const processed = useAscii ? asciiBorder(line) : line;
      return truncateToWidth(processed, safeWidth, "");
    };

    const lines: string[] = [];

    // --- Section 1: Header Bar ---
    const totalLines = this.lines.length;
    const currentLineNum = totalLines === 0 ? 0 : this.cursorLine + 1;
    const posStr = `Line ${currentLineNum}/${totalLines}`;

    let modeBadge = "";
    if (this.mode === "search") {
      modeBadge = boldFn(fgFn("warning", `[SEARCH: ${this.searchBuffer}▏]`));
    } else if (this.mode === "visual") {
      const [start, end] = this.getSelectionRange();
      const count = end - start + 1;
      modeBadge = boldFn(fgFn("accent", `[VISUAL: ${count} line${count === 1 ? "" : "s"}]`));
    } else if (this.toastMessage) {
      modeBadge = boldFn(fgFn("success", `[${this.toastMessage}]`));
    } else if (this.searchQuery) {
      const matchText =
        this.matchIndices.length > 0
          ? `${this.currentMatchIdx + 1}/${this.matchIndices.length}`
          : "0 matches";
      modeBadge = fgFn("dim", `[/${this.searchQuery}/ ${matchText}]`);
    }

    if (safeWidth >= 60) {
      const titleStr = boldFn(fgFn("accent", "Native Scrollback Buffer"));
      const leftPart = `${titleStr}  ${fgFn("dim", posStr)}`;
      const leftW = visibleWidth("Native Scrollback Buffer") + 2 + visibleWidth(posStr);
      const rightW = visibleWidth(modeBadge);
      const pad = Math.max(1, safeWidth - leftW - rightW);
      lines.push(clamp(`${leftPart}${" ".repeat(pad)}${modeBadge}`));
    } else if (safeWidth >= 35) {
      const shortTitle = boldFn(fgFn("accent", "Scrollback"));
      lines.push(clamp(`${shortTitle} ${fgFn("dim", `${currentLineNum}/${totalLines}`)} ${modeBadge}`));
    } else {
      lines.push(clamp(`${boldFn("Scroll")} ${currentLineNum}/${totalLines}`));
    }

    // Top Border
    lines.push(clamp(fgFn("border", borderChar.repeat(safeWidth))));

    // --- Section 2: Transcript Viewport ---
    const startIdx = this.scrollOffset;
    const endIdx = Math.min(this.lines.length, startIdx + this.visibleRows);

    const [vStart, vEnd] = this.getSelectionRange();
    const isVisual = this.mode === "visual";

    if (this.lines.length === 0) {
      lines.push(clamp(fgFn("dim", "  (empty scrollback buffer)")));
    } else {
      for (let i = startIdx; i < endIdx; i++) {
        const rawLine = this.lines[i]!;
        const isCurrent = i === this.cursorLine;
        const inSelection = isVisual && i >= vStart && i <= vEnd;

        // Line number prefix
        let numPrefix = "";
        if (safeWidth >= 45) {
          numPrefix = fgFn("dim", `${(i + 1).toString().padStart(4, " ")} ${linePipe} `);
        } else if (safeWidth >= 28) {
          numPrefix = fgFn("dim", `${(i + 1).toString().padStart(3, " ")}${linePipe}`);
        }

        // Selection / Cursor Indicator
        let indicator = "  ";
        if (inSelection) {
          indicator = boldFn(fgFn("accent", useAscii ? "> " : "▶ "));
        } else if (isCurrent) {
          indicator = boldFn(fgFn("accent", useAscii ? "-> " : "→ "));
        }

        // Highlighting search matches in text
        let content = rawLine;
        if (this.searchQuery && content.toLowerCase().includes(this.searchQuery.toLowerCase())) {
          const qLower = this.searchQuery.toLowerCase();
          const qLen = this.searchQuery.length;
          let highlighted = "";
          let lastIndex = 0;
          let idx = content.toLowerCase().indexOf(qLower, lastIndex);

          while (idx !== -1) {
            highlighted += content.slice(lastIndex, idx);
            const matchedSegment = content.slice(idx, idx + qLen);
            highlighted += boldFn(fgFn("warning", matchedSegment));
            lastIndex = idx + qLen;
            idx = content.toLowerCase().indexOf(qLower, lastIndex);
          }
          highlighted += content.slice(lastIndex);
          content = highlighted;
        }

        if (inSelection) {
          content = boldFn(content);
        }

        lines.push(clamp(`${indicator}${numPrefix}${content}`));
      }
    }

    // Fill remaining rows if buffer has fewer lines than viewport
    const renderedRowCount = endIdx - startIdx;
    const missingRows = Math.max(0, this.visibleRows - renderedRowCount);
    for (let r = 0; r < missingRows; r++) {
      lines.push(clamp(fgFn("dim", "~")));
    }

    // Bottom Border
    lines.push(clamp(fgFn("border", borderChar.repeat(safeWidth))));

    // --- Section 3: Keybindings / Status Footer ---
    if (this.mode === "search") {
      lines.push(clamp(fgFn("dim", "Type query · Enter: search · Esc: cancel")));
    } else if (this.mode === "visual") {
      lines.push(clamp(fgFn("dim", "Up/Down: extend · y/Enter: copy · Esc: cancel selection")));
    } else {
      if (safeWidth >= 65) {
        lines.push(clamp(fgFn("dim", "/ search · n/N next/prev · v select · g/G top/bottom · q/Esc exit")));
      } else if (safeWidth >= 40) {
        lines.push(clamp(fgFn("dim", "/:search  v:select  g/G:jump  q:exit")));
      } else {
        lines.push(clamp(fgFn("dim", "v:sel /:find q:exit")));
      }
    }

    return lines;
  }
}

/**
 * Scrollback Component factory conforming to ScrollbackFactory contract.
 */
export const createScrollbackComponent: ScrollbackFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: ScrollbackViewOptions,
): Component => {
  return new ScrollbackComponent(tui, theme, keybindings, done, ctx, options);
};

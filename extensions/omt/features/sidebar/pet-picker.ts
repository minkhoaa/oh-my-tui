import { matchesKey, Key, visibleWidth, truncateToWidth, type KeybindingsManager, type TUI, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { petEntries, petDemo, DEFAULT_PET, isClassic } from "./pet.ts";
import { PET_NAMES } from "./model.ts";

export interface PetPickerOptions {
  current?: string;
  anchorPet?: string;
  onSelect?: (entry: string) => void | Promise<void>;
  onClose?: () => void;
  viewportHeight?: number;
}

/**
 * Two-pane /pet dialog component.
 * Left pane: scrollable, searchable list of 25 pets + ascii + classic styles.
 * Right pane: passive live preview of the entry under cursor.
 */
export class PetPickerComponent implements Component {
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keybindings?: KeybindingsManager;
  private readonly done: (value?: unknown) => void;
  private readonly options?: PetPickerOptions;

  private filter = "";
  private cursor = 0;
  private entries: string[];
  private filteredIndices: number[] = [];
  private currentSelection: string;
  private isClosed = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager | undefined,
    done: (value?: unknown) => void,
    options?: PetPickerOptions,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.options = options;

    this.entries = petEntries();
    this.currentSelection = options?.current ?? DEFAULT_PET;
    this.reindex();

    // Initialize cursor on currentSelection if present
    const initIdx = this.filteredIndices.findIndex((idx) => this.entries[idx] === this.currentSelection);
    if (initIdx >= 0) this.cursor = initIdx;
  }

  private reindex(): void {
    const q = this.filter.trim().toLowerCase();
    this.filteredIndices = [];
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (!q || e.toLowerCase().includes(q)) {
        this.filteredIndices.push(i);
      }
    }
    if (this.cursor >= this.filteredIndices.length) {
      this.cursor = Math.max(0, this.filteredIndices.length - 1);
    }
  }

  getFilter(): string {
    return this.filter;
  }

  getCursor(): number {
    return this.cursor;
  }

  getSelectedEntry(): string | undefined {
    const entryIdx = this.filteredIndices[this.cursor];
    return entryIdx !== undefined ? this.entries[entryIdx] : undefined;
  }

  private close(selected?: string): void {
    if (this.isClosed) return;
    this.isClosed = true;
    if (selected && this.options?.onSelect) {
      void this.options.onSelect(selected);
    }
    this.options?.onClose?.();
    this.done(selected);
  }

  handleInput(data: string): void {
    if (this.isClosed) return;

    // Esc / Ctrl+C -> cancel
    if (
      this.keybindings?.matches?.(data, "tui.select.cancel") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.esc) ||
      data === "\x1b" ||
      data === "\x03"
    ) {
      this.close(undefined);
      return;
    }

    // Enter -> confirm
    if (this.keybindings?.matches?.(data, "tui.select.confirm") || matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      const selected = this.getSelectedEntry();
      this.close(selected);
      return;
    }

    // Up / Down
    if (this.keybindings?.matches?.(data, "tui.select.up") || matchesKey(data, Key.up) || data === "\x1b[A") {
      const n = this.filteredIndices.length;
      if (n > 0) {
        this.cursor = this.cursor > 0 ? this.cursor - 1 : n - 1;
        this.tui.requestRender?.();
      }
      return;
    }
    if (this.keybindings?.matches?.(data, "tui.select.down") || matchesKey(data, Key.down) || data === "\x1b[B") {
      const n = this.filteredIndices.length;
      if (n > 0) {
        this.cursor = this.cursor < n - 1 ? this.cursor + 1 : 0;
        this.tui.requestRender?.();
      }
      return;
    }

    // PageUp / PageDown
    if (this.keybindings?.matches?.(data, "tui.select.pageUp") || matchesKey(data, Key.pageUp)) {
      this.cursor = Math.max(0, this.cursor - 5);
      this.tui.requestRender?.();
      return;
    }
    if (this.keybindings?.matches?.(data, "tui.select.pageDown") || matchesKey(data, Key.pageDown)) {
      this.cursor = Math.min(this.filteredIndices.length - 1, this.cursor + 5);
      this.tui.requestRender?.();
      return;
    }

    // Backspace
    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.filter.length > 0) {
        this.filter = this.filter.slice(0, -1);
        this.reindex();
        this.tui.requestRender?.();
      }
      return;
    }

    // Typing filter
    if (data.length === 1 && data >= " " && data <= "~") {
      this.filter += data;
      this.reindex();
      this.tui.requestRender?.();
      return;
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.isClosed) return undefined;
    if (event.type === "wheel") {
      const delta = event.wheelDelta ?? 0;
      const n = this.filteredIndices.length;
      if (n > 0) {
        if (delta > 0) this.cursor = Math.min(n - 1, this.cursor + 1);
        else if (delta < 0) this.cursor = Math.max(0, this.cursor - 1);
        this.tui.requestRender?.();
        return { handled: true, render: true };
      }
    }
    if (event.type === "click" && event.button === "left") {
      // Click selection
      const selected = this.getSelectedEntry();
      if (selected) {
        this.close(selected);
        return { handled: true, render: true };
      }
    }
    return undefined;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.isClosed || width <= 0) return [];
    const w = Math.max(20, Math.floor(width));
    const win = Math.max(6, Math.min(18, Math.floor((this.options?.viewportHeight ?? 24) - 10)));

    const leftW = Math.max(14, Math.min(26, Math.floor(w * 0.4)));
    const rightW = Math.max(14, w - leftW - 7);

    const fg = (color: string, s: string) => {
      try {
        return (this.theme as any)?.fg?.(color, s) ?? s;
      } catch {
        return s;
      }
    };
    const bold = (s: string) => {
      try {
        return (this.theme as any)?.bold?.(s) ?? s;
      } catch {
        return s;
      }
    };
    const dim = (s: string) => fg("dim", s);

    // Left pane rows
    const total = this.filteredIndices.length;
    let start = 0;
    let end = total;
    let above = false;
    let below = false;
    if (total > win) {
      start = Math.max(0, this.cursor - Math.floor(win / 2));
      end = start + win;
      if (end > total) {
        end = total;
        start = Math.max(0, end - win);
      }
      above = start > 0;
      below = end < total;
    }

    const leftLines: string[] = [];
    if (above) {
      leftLines.push(dim(`…(+${start} above)`.padEnd(leftW)));
    }
    for (let fi = start; fi < end; fi++) {
      const idx = this.filteredIndices[fi]!;
      const name = this.entries[idx]!;
      const isCur = fi === this.cursor;
      const isSelected = name === this.currentSelection;
      const cursorMark = isCur ? "▸ " : "  ";
      const dotMark = isSelected ? fg("success", "● ") : "  ";
      const styledName = isCur ? bold(fg("text", name)) : dim(name);
      const row = `${cursorMark}${dotMark}${styledName}`;
      leftLines.push(truncateToWidth(row, leftW, ""));
    }
    if (below) {
      leftLines.push(dim(`…(+${total - end} below)`.padEnd(leftW)));
    }
    if (total === 0) {
      leftLines.push(dim("— no match —".padEnd(leftW)));
    }
    while (leftLines.length < win) {
      leftLines.push(" ".repeat(leftW));
    }

    // Right pane rows
    const selectedEntry = this.getSelectedEntry();
    const demo = selectedEntry ? petDemo(selectedEntry, this.options?.anchorPet ?? DEFAULT_PET) : null;
    const rightLines: string[] = [];
    if (!selectedEntry) {
      rightLines.push(dim("— no pet —"));
    } else {
      rightLines.push(bold(fg("text", selectedEntry)));
      if (demo && demo.length > 0) {
        for (const ln of demo) {
          rightLines.push(fg("text", ln));
        }
      }
    }
    while (rightLines.length < win) {
      rightLines.push(" ".repeat(rightW));
    }

    // Header and filter row
    const lines: string[] = [];
    lines.push(bold(fg("text", "PET SELECTOR")));
    lines.push(dim(`filter: ${this.filter}▌`));
    lines.push(
      bold(
        fg(
          "border",
          `${"PETS".padEnd(leftW)} │ ${"PREVIEW".padEnd(rightW)}`,
        ),
      ),
    );

    for (let i = 0; i < win; i++) {
      const l = leftLines[i] ?? " ".repeat(leftW);
      const r = rightLines[i] ?? " ".repeat(rightW);
      lines.push(`${truncateToWidth(l, leftW, "")} │ ${truncateToWidth(r, rightW, "")}`);
    }

    lines.push(dim("type to filter · ↑↓ select · Enter confirm · Esc cancel"));

    // Wrap in outer box border
    const outerW = Math.min(w, leftW + rightW + 5);
    const boxLines: string[] = [];
    boxLines.push(fg("border", `╭${"─".repeat(Math.max(0, outerW - 2))}╮`));
    for (const ln of lines) {
      const padded = truncateToWidth(ln, outerW - 4, "");
      const diff = Math.max(0, outerW - 4 - visibleWidth(padded));
      boxLines.push(fg("border", "│ ") + padded + " ".repeat(diff) + fg("border", " │"));
    }
    boxLines.push(fg("border", `╰${"─".repeat(Math.max(0, outerW - 2))}╯`));

    return boxLines;
  }

  dispose(): void {
    if (this.isClosed) return;
    this.isClosed = true;
  }
}

export function createPetPickerComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager | undefined,
  done: (value?: unknown) => void,
  options?: PetPickerOptions,
): PetPickerComponent {
  return new PetPickerComponent(tui, theme, keybindings, done, options);
}

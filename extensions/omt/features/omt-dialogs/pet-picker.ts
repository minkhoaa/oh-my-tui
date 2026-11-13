/**
 * OMT Pet Selector Dialog Component.
 *
 * Layout:
 * - 2-pane selector inside a rounded Unicode box (╭─╮, │ │, ╰─╯)
 * - Left pane: scrollable, searchable list of 25 animal pets + "ascii" and "classic" styles (27 total)
 *   - Cursor marker "▸ " on highlighted row (rowHiStyle: bold/accent)
 *   - Status dot "● " on currently selected pet (cMuted / success)
 *   - Windowing via exact fixedWin(cursor, total, win) algorithm
 *   - Bounded scroll markers "…(+N above)" and "…(+N below)"
 *   - Empty match fallback "— no match —"
 * - Right pane: passive live preview of highlighted pet
 *   - 4-row normalized ASCII art demo for animals and "ascii" style
 *   - 3-row kaomoji sampler for "classic" style (Idle, Working, Success)
 *   - Tab key toggles live preview style between ASCII art and Classic faces
 * - Spacing, padding, borders matching theme roles.
 * - Responsive layout containing 120, 80, 40, and 20 column viewports with zero overflow.
 */

import { matchesKey, Key, visibleWidth, truncateToWidth, stripTerminalSequences, type Component, type Focusable, type KeybindingsManager, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { selectedDialogRow } from "./presentation.ts";
import type { Theme, ThemeColor, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { petEntries, petDemo, DEFAULT_PET, STYLE_ASCII, STYLE_CLASSIC, isClassic, isStyle, classicFace, PET_NAMES, ART_ROWS } from "../sidebar/pet.ts";

export { DEFAULT_PET, STYLE_ASCII, STYLE_CLASSIC, PET_NAMES, ART_ROWS };
export const PET_ENTRIES = petEntries();

/**
 * PetItem interface matching omt-dialogs/types.ts
 */
export interface PetItem {
  id: string;
  name: string;
  description?: string;
  art?: string[];
}

/**
 * Options for PetPickerComponent and OmtPetSelectorComponent.
 */
export interface PetPickerOptions {
  title?: string;
  current?: string;
  currentPet?: string;
  anchorPet?: string;
  onSelect?: (entry: string) => void | Promise<void>;
  onSelectPet?: (petId: string) => void;
  onPreviewPet?: (petId: string) => void;
  onClose?: () => void;
  viewportHeight?: number;
  pets?: string[] | PetItem[];
  initialPreviewStyle?: "ascii" | "classic";
}

export type PetSelectorOptions = PetPickerOptions;

// =============================================================================
// Helper Functions Matching OMT Source
// =============================================================================

/**
 * fixedWin returns a scroll window of exactly win rows: data [start, end)
 * plus above/below markers that consume budget rows, so the dialog box
 * never resizes while scrolling.
 */
export function fixedWin(
  cursor: number,
  total: number,
  win: number,
): { start: number; end: number; above: boolean; below: boolean } {
  let start = cursor - 4;
  if (start < 0) {
    start = 0;
  }
  if (start + win > total) {
    start = total - win;
  }
  if (start < 0) {
    start = 0;
  }
  let cap = win;
  let above = start > 0;
  if (above) {
    cap--;
  }
  let end = start + cap;
  if (end > total) {
    end = total;
  }
  let below = end < total;
  if (below) {
    cap--;
    // the below-marker eats the last data row: shift the window down so cursor stays visible
    if (start + cap <= cursor) {
      start = cursor - cap + 1;
    }
    end = start + cap;
    if (end > total) {
      end = total;
    }
    above = start > 0;
  }
  return { start, end, above, below };
}

/**
 * petDialogPage is the number of pane rows the window can show.
 */
export function petDialogPage(viewportHeight = 24): number {
  let win = viewportHeight - 11;
  if (win < 1) {
    win = 1;
  }
  if (win > 24) {
    win = 24;
  }
  return win;
}

/**
 * petDialogBoxW follows adaptive box width:
 * winW - 10, floored at 70 so panes stay legible, capped at 120.
 * For constrained terminals (winW < 70), safely uses winW to prevent overflow.
 */
export function petDialogBoxW(winW: number): number {
  if (winW <= 0) return 20;
  if (winW < 70) return winW;
  let boxW = winW - 10;
  if (boxW < 70) {
    boxW = 70;
  }
  if (boxW > 120) {
    boxW = 120;
  }
  return Math.min(winW, boxW);
}

/**
 * Fit clamps s to exactly w display cells: truncates with "…" when too wide,
 * pads with spaces when narrow.
 */
export function fit(s: string, w: number): string {
  if (w <= 0) return "";
  const sw = visibleWidth(s);
  if (sw === w) return s;
  if (sw < w) return s + " ".repeat(w - sw);
  return truncateToWidth(s, w, "…");
}

/**
 * Short cuts s to at most n display cells, reserving one cell for "…".
 */
export function short(s: string, n: number): string {
  const clean = s.replace(/\n/g, " ⏎ ");
  if (visibleWidth(clean) <= n) return clean;
  return truncateToWidth(clean, n, "…");
}

/**
 * Pads a string with trailing spaces until its visible display width reaches targetW.
 */
function padEndVisible(s: string, targetW: number): string {
  const vw = visibleWidth(s);
  if (vw >= targetW) {
    return truncateToWidth(s, targetW, "");
  }
  return s + " ".repeat(targetW - vw);
}

/**
 * Safe theme role color accessor.
 */
function fgSafe(theme: Theme | undefined, role: string, text: string): string {
  try {
    return (theme as any)?.fg ? (theme as any).fg(role, text) : text;
  } catch {
    return text;
  }
}

/**
 * Safe theme bold accessor.
 */
function boldSafe(theme: Theme | undefined, text: string): string {
  try {
    return (theme as any)?.bold ? (theme as any).bold(text) : text;
  } catch {
    return text;
  }
}

/**
 * Safe theme dim / muted accessor.
 */
function dimSafe(theme: Theme | undefined, text: string): string {
  try {
    if (typeof (theme as any)?.dim === "function") {
      return (theme as any).dim(text);
    }
    return typeof (theme as any)?.fg === "function" ? (theme as any).fg("dim", text) : text;
  } catch {
    return text;
  }
}

/**
 * petDemoLines resolves the right-pane preview art for the given entry and anchor.
 * Supports style mode switching between ASCII art and Classic kaomoji.
 */
export function petDemoLines(
  entry: string,
  anchor: string,
  styleMode: "ascii" | "classic" = "ascii",
): string[] {
  if (styleMode === "classic" || isClassic(entry)) {
    return [
      classicFace("idle", 0),
      classicFace("working", 0),
      classicFace("success", 0),
    ];
  }
  let art = petDemo(entry, anchor);
  if (!art || art.length === 0) {
    art = petDemo(anchor, DEFAULT_PET); // "ascii": pinned animal
  }
  if (!art || art.length === 0) {
    art = petDemo(DEFAULT_PET, DEFAULT_PET);
  }
  if (!art) return [];
  let start = 0;
  while (start < art.length - 1 && art[start].trim() === "") {
    start++;
  }
  return art.slice(start);
}

// =============================================================================
// PetPickerComponent Implementation
// =============================================================================

export class PetPickerComponent implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keybindings?: KeybindingsManager;
  private readonly done: (value?: unknown) => void;
  private readonly ctx?: ExtensionContext;
  private readonly options?: PetPickerOptions;

  private filter = "";
  private cursor = 0;
  private entries: string[] = [];
  private filteredIndices: number[] = [];
  private currentSelection: string;
  private anchorPet: string;
  private previewStyle: "ascii" | "classic" = "ascii";
  private isClosed = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager | undefined,
    done: (value?: unknown) => void,
    ctxOrOptions?: ExtensionContext | PetPickerOptions,
    maybeOptions?: PetPickerOptions,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;

    // Support both 5-arg (sidebar signature) and 6-arg (dialogs signature)
    let opts: PetPickerOptions | undefined;
    if (ctxOrOptions && ("ui" in ctxOrOptions || "session" in ctxOrOptions)) {
      this.ctx = ctxOrOptions as ExtensionContext;
      opts = maybeOptions;
    } else {
      opts = ctxOrOptions as PetPickerOptions | undefined;
    }
    this.options = opts;

    // Load pet entries: custom options.pets or full standard set (25 pets + ascii + classic)
    if (opts?.pets && Array.isArray(opts.pets) && opts.pets.length > 0) {
      this.entries = opts.pets.map((item) =>
        typeof item === "string" ? item : item.name || item.id,
      );
    } else {
      this.entries = petEntries();
    }

    this.currentSelection = opts?.current ?? opts?.currentPet ?? DEFAULT_PET;
    this.anchorPet = opts?.anchorPet ?? DEFAULT_PET;

    if (opts?.initialPreviewStyle) {
      this.previewStyle = opts.initialPreviewStyle;
    } else if (isClassic(this.currentSelection)) {
      this.previewStyle = "classic";
    }

    this.reindex();

    // Initialize cursor on currentSelection if present
    const initIdx = this.filteredIndices.findIndex(
      (idx) => this.entries[idx] === this.currentSelection,
    );
    if (initIdx >= 0) {
      this.cursor = initIdx;
    }
  }

  /**
   * Re-indexes filteredIndices based on current filter substring.
   * Mirrors OMT Dialog.Reindex() behavior.
   */
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
      this.cursor = 0;
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

  getPreviewStyle(): "ascii" | "classic" {
    return this.previewStyle;
  }

  setPreviewStyle(style: "ascii" | "classic"): void {
    this.previewStyle = style;
    this.tui.requestRender?.();
  }

  togglePreviewStyle(): void {
    this.previewStyle = this.previewStyle === "ascii" ? "classic" : "ascii";
    this.tui.requestRender?.();
  }

  private getTerminalHeight(): number {
    return (
      this.options?.viewportHeight ??
      (this.tui as any)?.terminal?.rows ??
      (this.tui as any)?.height ??
      49
    );
  }

  getPageSize(): number {
    return petDialogPage(this.getTerminalHeight());
  }

  private close(selected?: string): void {
    if (this.isClosed) return;
    this.isClosed = true;
    if (selected) {
      if (this.options?.onSelect) {
        void this.options.onSelect(selected);
      }
      if (this.options?.onSelectPet) {
        this.options.onSelectPet(selected);
      }
    }
    this.options?.onClose?.();
    this.done(selected);
  }

  /**
   * Keyboard event handler for pet dialog.
   * Handles:
   * - KeyUp: cursor wrap up
   * - KeyDown: cursor wrap down
   * - KeyPgUp: cursor jump up by page
   * - KeyPgDown: cursor jump down by page
   * - Home / End: jump to first / last entry
   * - Tab: toggle preview style between ascii and classic
   * - KeyEnter: confirm selection
   * - KeyEsc / Ctrl+C: dismiss
   * - KeyBackspace: delete rune from filter
   * - Printable runes: append to filter
   */
  handleInput(data: string): void {
    if (this.isClosed) return;

    // Esc / Ctrl+C -> cancel and dismiss
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

    // Enter -> confirm selection
    if (
      this.keybindings?.matches?.(data, "tui.select.confirm") ||
      matchesKey(data, Key.enter) ||
      data === "\r" ||
      data === "\n"
    ) {
      const selected = this.getSelectedEntry();
      this.close(selected);
      return;
    }

    const n = this.filteredIndices.length;

    // Up -> wrap up
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A"
    ) {
      if (n > 0) {
        this.cursor = this.cursor > 0 ? this.cursor - 1 : n - 1;
        const sel = this.getSelectedEntry();
        if (sel) this.options?.onPreviewPet?.(sel);
        this.tui.requestRender?.();
      }
      return;
    }

    // Down -> wrap down
    if (
      this.keybindings?.matches?.(data, "tui.select.down") ||
      matchesKey(data, Key.down) ||
      data === "\x1b[B"
    ) {
      if (n > 0) {
        this.cursor = this.cursor < n - 1 ? this.cursor + 1 : 0;
        const sel = this.getSelectedEntry();
        if (sel) this.options?.onPreviewPet?.(sel);
        this.tui.requestRender?.();
      }
      return;
    }

    // PageUp -> clamp at top
    if (
      this.keybindings?.matches?.(data, "tui.select.pageUp") ||
      matchesKey(data, Key.pageUp) ||
      data === "\x1b[5~"
    ) {
      if (n > 0) {
        this.cursor = Math.max(0, this.cursor - this.getPageSize());
        const sel = this.getSelectedEntry();
        if (sel) this.options?.onPreviewPet?.(sel);
        this.tui.requestRender?.();
      }
      return;
    }

    // PageDown -> clamp at bottom
    if (
      this.keybindings?.matches?.(data, "tui.select.pageDown") ||
      matchesKey(data, Key.pageDown) ||
      data === "\x1b[6~"
    ) {
      if (n > 0) {
        this.cursor = Math.min(n - 1, this.cursor + this.getPageSize());
        const sel = this.getSelectedEntry();
        if (sel) this.options?.onPreviewPet?.(sel);
        this.tui.requestRender?.();
      }
      return;
    }

    // Home / End
    if (matchesKey(data, Key.home) || data === "\x1b[H") {
      if (n > 0) {
        this.cursor = 0;
        const sel = this.getSelectedEntry();
        if (sel) this.options?.onPreviewPet?.(sel);
        this.tui.requestRender?.();
      }
      return;
    }
    if (matchesKey(data, Key.end) || data === "\x1b[F") {
      if (n > 0) {
        this.cursor = n - 1;
        const sel = this.getSelectedEntry();
        if (sel) this.options?.onPreviewPet?.(sel);
        this.tui.requestRender?.();
      }
      return;
    }

    // Tab -> style switch between ascii and classic preview
    if (
      matchesKey(data, Key.tab) ||
      matchesKey(data, Key.shift("tab")) ||
      data === "\t" ||
      data === "\x1b[Z"
    ) {
      this.togglePreviewStyle();
      return;
    }

    // Backspace -> trim rune from filter
    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.filter.length > 0) {
        const runes = Array.from(this.filter);
        runes.pop();
        this.filter = runes.join("");
        this.reindex();
        this.tui.requestRender?.();
      }
      return;
    }

    // Printable runes / paste -> type to filter
    if (!data.startsWith("\x1b") && data.length > 0 && !/[\x00-\x1f\x7f]/.test(data)) {
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
        if (delta > 0) {
          this.cursor = Math.min(n - 1, this.cursor + 1);
        } else if (delta < 0) {
          this.cursor = Math.max(0, this.cursor - 1);
        }
        const sel = this.getSelectedEntry();
        if (sel) this.options?.onPreviewPet?.(sel);
        this.tui.requestRender?.();
        return { handled: true, render: true };
      }
    }
    if (event.type === "click" && event.button === "left") {
      const selected = this.getSelectedEntry();
      if (selected) {
        this.close(selected);
        return { handled: true, render: true };
      }
    }
    return undefined;
  }

  invalidate(): void {}

  /**
   * render draws the 2-pane /pet dialog inside the rounded Unicode box:
   * Left: list of pets (▸ cursor, ● entry in use, …(+N above/below) window)
   * Right: preview of highlighted entry (4-row ASCII art demo or classic faces)
   */
  render(width: number): string[] {
    if (this.isClosed || width <= 0) return [];

    const w = Math.max(20, Math.floor(width));
    const title = this.options?.title ?? "Select pet";

    // Dynamic box width following petDialogBoxW(w)
    let boxW = petDialogBoxW(w);
    if (w < 74) {
      boxW = Math.max(16, w - 2);
    }

    // Padding parameters: (1, 3)
    let padX = 3;
    let padY = 1;
    if (boxW < 70) {
      padX = boxW < 40 ? 0 : 1;
      padY = 0;
    }

    // Inner content width: boxW - 2 * padX
    const innerW = Math.max(16, boxW - padX * 2);

    // Dynamic pane width allocation
    let leftW: number;
    if (innerW >= 102) {
      leftW = 28;
    } else if (innerW >= 62) {
      leftW = 24;
    } else if (innerW >= 30) {
      leftW = Math.max(12, Math.floor((innerW - 3) * 0.45));
    } else {
      leftW = Math.max(6, Math.floor((innerW - 3) * 0.5));
    }
    let rightW = Math.max(6, innerW - leftW - 3);
    leftW = innerW - 3 - rightW; // Guarantee leftW + 3 + rightW === innerW exactly

    // Vertical budget: petDialogPage
    const win = petDialogPage(this.getTerminalHeight());

    // Styling helpers
    const fg = (role: string, s: string) => fgSafe(this.theme, role, s);
    const bold = (s: string) => boldSafe(this.theme, s);
    const dim = (s: string) => dimSafe(this.theme, s);

    // -------------------------------------------------------------------------
    // Left Pane: Pets List
    // -------------------------------------------------------------------------
    const total = this.filteredIndices.length;
    const { start, end, above, below } = fixedWin(this.cursor, total, win);

    const leftLines: string[] = [];

    // Scroll above marker
    if (above) {
      const aboveText = fit(`…(+${start} above)`, leftW - 2);
      leftLines.push("  " + dim(aboveText));
    }

    // Data rows
    for (let fi = start; fi < end; fi++) {
      const idx = this.filteredIndices[fi]!;
      const name = this.entries[idx]!;
      const isCur = fi === this.cursor;
      const isInUse = name === this.currentSelection;

      const mark = isCur ? "▸ " : "  ";
      const dot = isInUse ? dim("● ") : "  ";

      const nameFit = fit(name, Math.max(1, leftW - 4));
      const styledContent = isCur
        ? selectedDialogRow(this.theme, dot + nameFit, leftW - 2)
        : dot + dim(nameFit);

      leftLines.push(mark + styledContent);
    }

    // Scroll below marker
    if (below) {
      const belowText = fit(`…(+${total - end} below)`, leftW - 2);
      leftLines.push("  " + dim(belowText));
    }

    // Empty match fallback
    if (total === 0) {
      const noMatchText = fit("— no match —", leftW - 2);
      leftLines.push("  " + dim(noMatchText));
    }

    // Pad left lines to win height
    while (leftLines.length < win) {
      leftLines.push(" ".repeat(leftW));
    }

    // -------------------------------------------------------------------------
    // Right Pane: Demo Art Preview
    // -------------------------------------------------------------------------
    const selectedEntry = this.getSelectedEntry();
    let rightLines: string[] = [];

    if (!selectedEntry) {
      rightLines.push("  " + dim(fit("— no pet —", rightW - 2)));
    } else {
      const headLabel =
        this.previewStyle === "classic" && !isClassic(selectedEntry)
          ? `${selectedEntry} [classic]`
          : selectedEntry;
      const head = "  " + bold(fg("text", short(headLabel, rightW - 4)));
      rightLines.push(padEndVisible(head, rightW));

      const demo = petDemoLines(selectedEntry, this.anchorPet, this.previewStyle);
      for (const ln of demo) {
        const lineStr = "  " + dim(short(ln, rightW - 4));
        rightLines.push(padEndVisible(lineStr, rightW));
      }
    }

    // Pad right lines to win height
    while (rightLines.length < win) {
      rightLines.push(" ".repeat(rightW));
    }

    // Trim right pane to win budget if necessary
    if (rightLines.length > win) {
      rightLines = rightLines.slice(0, win);
    }

    // -------------------------------------------------------------------------
    // Combine Panes with Separator
    // -------------------------------------------------------------------------
    const sep = fg("border", "│");
    const headerLeft = "  " + bold(fg("text", fit("PETS", leftW - 2)));
    const headerRight = "  " + bold(fg("text", fit("PREVIEW", rightW - 2)));
    const headerRow = `${padEndVisible(headerLeft, leftW)} ${sep} ${padEndVisible(headerRight, rightW)}`;

    const contentRows: string[] = [];
    for (let i = 0; i < win; i++) {
      const l = leftLines[i] ?? " ".repeat(leftW);
      const r = rightLines[i] ?? " ".repeat(rightW);
      contentRows.push(`${padEndVisible(l, leftW)} ${sep} ${padEndVisible(r, rightW)}`);
    }

    // -------------------------------------------------------------------------
    // Inner Dialog Block Lines (Title, Filter, Blank, Headers, Content, Blank, Footer)
    // -------------------------------------------------------------------------
    const innerLines: string[] = [];

    // Title
    innerLines.push(bold(fg("text", fit(title, innerW))));

    // Filter bar
    innerLines.push(dim(fit(`filter: ${this.filter}▌`, innerW)));

    // Blank line
    innerLines.push(" ".repeat(innerW));

    // Pane headers
    innerLines.push(headerRow);

    // Pane content rows
    for (const row of contentRows) {
      innerLines.push(row);
    }

    // Blank line
    innerLines.push(" ".repeat(innerW));

    // Footer hint line
    let footerHint = "type to filter · ↑↓ select · Tab style · Enter confirm · Esc cancel";
    if (innerW < 60) {
      footerHint = "↑↓ select · Tab style · Enter ok · Esc";
    }
    if (innerW < 30) {
      footerHint = "↑↓ · Tab · ⏎ · Esc";
    }
    innerLines.push(dim(fit(footerHint, innerW)));

    // -------------------------------------------------------------------------
    // Outer Rounded Unicode Box (╭─╮, │ │, ╰─╯) with Padding
    // -------------------------------------------------------------------------
    const hPad = " ".repeat(padX);
    const borderFill = "─".repeat(Math.max(0, boxW));

    const boxLines: string[] = [];
    boxLines.push(fg("border", `╭${borderFill}╮`));

    // Top vertical padding
    for (let p = 0; p < padY; p++) {
      boxLines.push(fg("border", "│") + " ".repeat(Math.max(0, boxW)) + fg("border", "│"));
    }

    // Content lines with horizontal padding
    for (const ln of innerLines) {
      const paddedLn = padEndVisible(ln, innerW);
      boxLines.push(fg("border", "│") + hPad + paddedLn + hPad + fg("border", "│"));
    }

    // Bottom vertical padding
    for (let p = 0; p < padY; p++) {
      boxLines.push(fg("border", "│") + " ".repeat(Math.max(0, boxW)) + fg("border", "│"));
    }

    boxLines.push(fg("border", `╰${borderFill}╯`));

    return boxLines;
  }

  dispose(): void {
    if (this.isClosed) return;
    this.isClosed = true;
  }
}

// =============================================================================
// Aliases & Factories
// =============================================================================

export class OmtPetSelectorComponent extends PetPickerComponent {}

export function createPetPickerComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager | undefined,
  done: (value?: unknown) => void,
  options?: PetPickerOptions,
): PetPickerComponent {
  return new PetPickerComponent(tui, theme, keybindings, done, options);
}

export function createOmtPetSelectorComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager | undefined,
  done: (value?: unknown) => void,
  ctxOrOptions?: ExtensionContext | PetPickerOptions,
  maybeOptions?: PetPickerOptions,
): OmtPetSelectorComponent {
  return new OmtPetSelectorComponent(
    tui,
    theme,
    keybindings,
    done,
    ctxOrOptions,
    maybeOptions,
  );
}

/**
 * Pure render helper for testing and headless verification.
 */
export function renderPetDialog(
  options: PetPickerOptions,
  theme: Theme,
  width: number,
): string[] {
  const dummyTui = { requestRender: () => {} } as any;
  const picker = new PetPickerComponent(dummyTui, theme, undefined, () => {}, options);
  return picker.render(width);
}

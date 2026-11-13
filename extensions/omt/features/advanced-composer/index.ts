import { Container, Key, Text, matchesKey, truncateToWidth, visibleWidth, type Component, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { DynamicBorder, type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import type { AdvancedComposerState, ComposerDraft, ComposerMetrics } from "./types.ts";
import { getBorderStyler } from "../../presets/shared/style.ts";

export type { AdvancedComposerState, ComposerDraft, ComposerMetrics };

/**
 * Options for configuring the stash picker component.
 */
export interface StashPickerOptions {
  stash?: ComposerStash;
  initialDrafts?: ComposerDraft[];
  onSelect?: (draft: ComposerDraft) => void;
  onRestore?: (draft: ComposerDraft) => void;
  onDelete?: (draft: ComposerDraft) => void;
  onClear?: () => void;
}

/**
 * Factory type for the stash picker component.
 */
export type StashPickerFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: StashPickerOptions,
) => Component;

/**
 * Safely invoke theme.fg with graceful fallback to plain text.
 */
function safeFg(
  theme: Theme | undefined,
  color: Parameters<Theme["fg"]>[0],
  text: string,
): string {
  try {
    if (theme && typeof theme.fg === "function") {
      return theme.fg(color, text);
    }
  } catch {
    // Graceful fallback
  }
  return text;
}

/**
 * Safely invoke theme.bold with graceful fallback to plain text.
 */
function safeBold(theme: Theme | undefined, text: string): string {
  try {
    if (theme && typeof theme.bold === "function") {
      return theme.bold(text);
    }
  } catch {
    // Graceful fallback
  }
  return text;
}

/**
 * Safely invoke theme.dim with graceful fallback to plain text.
 */
function safeDim(theme: Theme | undefined, text: string): string {
  try {
    if (theme && typeof (theme as any).dim === "function") {
      return (theme as any).dim(text);
    }
    if (theme && typeof theme.fg === "function") {
      return theme.fg("dim", text);
    }
  } catch {
    // Graceful fallback
  }
  return text;
}

/**
 * Calculate editor composer metrics without touching CustomEditor internals.
 *
 * Estimates tokens using the universal ~4 characters per token heuristic.
 * Lines are 1-indexed. Clamps currentLine between 1 and total lines.
 */
export { calculateComposerMetrics, ComposerStash } from "./store.ts";
import { calculateComposerMetrics, ComposerStash } from "./store.ts";

/**
 * Format composer status badges without coordinate shifting or breaking CustomEditor.
 * Renders badges like [MULTI 3L], [~42 tok], [STASH] styled for the active theme preset.
 * Output is guaranteed to be a single row with no newline characters.
 */
export function formatComposerStatus(
  metrics: ComposerMetrics,
  theme: Theme,
  presetName?: string,
  width?: number,
): string {
  const badges: string[] = [];
  const preset = (presetName ?? "omt-clean").toLowerCase();

  // Preset-specific token colors
  let multiColor: Parameters<Theme["fg"]>[0] = "accent";
  let tokenColor: Parameters<Theme["fg"]>[0] = "muted";
  let stashColor: Parameters<Theme["fg"]>[0] = "warning";

  if (preset.includes("rail")) {
    multiColor = "accent";
    tokenColor = "success";
    stashColor = "warning";
  } else if (preset.includes("ember")) {
    multiColor = "accent";
    tokenColor = "dim";
    stashColor = "warning";
  } else if (preset.includes("minimal") || preset.includes("native")) {
    multiColor = "dim";
    tokenColor = "dim";
    stashColor = "accent";
  }

  const isCompact = width !== undefined && width < 45;
  const isUltraCompact = width !== undefined && width < 25;

  if (metrics.isMultiLine) {
    const label = isCompact ? `${metrics.lines}L` : `MULTI ${metrics.lines}L`;
    const open = safeDim(theme, "[");
    const close = safeDim(theme, "]");
    const text = safeFg(theme, multiColor, label);
    badges.push(`${open}${text}${close}`);
  }

  if (metrics.estimatedTokens > 0) {
    const label = isUltraCompact
      ? `~${metrics.estimatedTokens}t`
      : `~${metrics.estimatedTokens} tok`;
    const open = safeDim(theme, "[");
    const close = safeDim(theme, "]");
    const text = safeFg(theme, tokenColor, label);
    badges.push(`${open}${text}${close}`);
  }

  if (metrics.hasStash) {
    const label = isUltraCompact ? "S" : "STASH";
    const open = safeDim(theme, "[");
    const close = safeDim(theme, "]");
    const text = safeBold(theme, safeFg(theme, stashColor, label));
    badges.push(`${open}${text}${close}`);
  }

  if (badges.length === 0) {
    return "";
  }

  const joined = badges.join(" ");
  if (width !== undefined && width > 0) {
    return truncateToWidth(joined, width, "");
  }
  return joined;
}

/**
 * Scratchpad Manager Component: interactive picker to inspect, restore, and delete stashed drafts.
 */
export class StashPickerComponent extends Container implements Component {
  readonly capturesViewportInput: boolean = true;
  readonly wantsKeyRelease: boolean = false;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private stash: ComposerStash;
  private options?: StashPickerOptions;

  private selectedIndex: number = 0;
  private maxVisible: number = 6;
  private closed: boolean = false;

  private topBorder: DynamicBorder;
  private titleText: Text;
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
    options?: StashPickerOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;
    this.stash = options?.stash ?? new ComposerStash(options?.initialDrafts);

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.titleText = new Text("", 0, 0);
    this.midBorder = new DynamicBorder(borderStyle);
    this.listText = new Text("", 0, 0);
    this.statusText = new Text("", 0, 0);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.titleText);
    this.addChild(this.midBorder);
    this.addChild(this.listText);
    this.addChild(this.statusText);
    this.addChild(this.botBorder);
  }

  getStash(): ComposerStash {
    return this.stash;
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  isClosed(): boolean {
    return this.closed;
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    // Esc / 'q' to close
    if (
      this.keybindings?.matches?.(data, "tui.select.cancel") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.esc) ||
      data === "q" ||
      data === "Q" ||
      data === "\x1b"
    ) {
      this.close(null);
      return;
    }

    // Enter to restore selected draft
    if (
      this.keybindings?.matches?.(data, "tui.select.confirm") ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.return) ||
      data === "\r" ||
      data === "\n"
    ) {
      const drafts = this.stash.getAll();
      const selected = drafts[this.selectedIndex];
      if (selected) {
        this.options?.onRestore?.(selected);
        this.options?.onSelect?.(selected);
        this.close(selected);
      } else {
        this.close(null);
      }
      return;
    }

    // Up arrow
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A"
    ) {
      const count = this.stash.count();
      if (count > 0) {
        this.selectedIndex =
          this.selectedIndex <= 0 ? count - 1 : this.selectedIndex - 1;
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
      const count = this.stash.count();
      if (count > 0) {
        this.selectedIndex =
          this.selectedIndex >= count - 1 ? 0 : this.selectedIndex + 1;
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
      const count = this.stash.count();
      if (count > 0) {
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
      const count = this.stash.count();
      if (count > 0) {
        this.selectedIndex = Math.min(count - 1, this.selectedIndex + 5);
        this.tui.requestRender?.();
      }
      return;
    }

    // 'd' or Delete to remove draft
    if (
      data === "d" ||
      data === "D" ||
      matchesKey(data, Key.delete) ||
      data === "\x1b[3~"
    ) {
      const drafts = this.stash.getAll();
      const selected = drafts[this.selectedIndex];
      if (selected) {
        this.stash.remove(selected.id);
        this.options?.onDelete?.(selected);
        const newCount = this.stash.count();
        if (this.selectedIndex >= newCount) {
          this.selectedIndex = Math.max(0, newCount - 1);
        }
        this.tui.requestRender?.();
      }
      return;
    }

    // 'c' to clear all drafts
    if (data === "c" || data === "C") {
      this.stash.clear();
      this.options?.onClear?.();
      this.selectedIndex = 0;
      this.tui.requestRender?.();
      return;
    }
  }

  private updateView(width: number): void {
    const safeWidth = Math.max(1, width);
    const theme = this.theme;
    const drafts = this.stash.getAll();
    const count = drafts.length;

    // Header title
    const title =
      safeWidth >= 40
        ? safeBold(theme, safeFg(theme, "accent", "OMT Composer Scratchpad / Stash"))
        : safeBold(theme, safeFg(theme, "accent", "Composer Stash"));
    const hint =
      safeWidth >= 65
        ? safeDim(theme, "Enter: restore · d: delete · c: clear · Esc: close")
        : safeWidth >= 35
          ? safeDim(theme, "↵: restore · d: del · Esc")
          : "";

    if (hint && safeWidth >= 50) {
      const titleW = visibleWidth("OMT Composer Scratchpad / Stash");
      const hintW = visibleWidth("Enter: restore · d: delete · c: clear · Esc: close");
      const pad = Math.max(1, safeWidth - titleW - hintW);
      this.titleText.setText(
        truncateToWidth(`${title}${" ".repeat(pad)}${hint}`, safeWidth, ""),
      );
    } else {
      this.titleText.setText(truncateToWidth(title, safeWidth, ""));
    }

    // Body content
    if (count === 0) {
      const emptyMsg =
        safeWidth >= 35
          ? "  No stashed drafts available. (Press Esc to close)"
          : "  No drafts (Esc)";
      this.listText.setText(
        truncateToWidth(safeDim(theme, emptyMsg), safeWidth, ""),
      );
    } else {
      const start = Math.max(
        0,
        Math.min(
          this.selectedIndex - Math.floor(this.maxVisible / 2),
          count - this.maxVisible,
        ),
      );
      const end = Math.min(count, start + this.maxVisible);
      const visible = drafts.slice(start, end);

      const lines = visible.map((draft, idx) => {
        const absoluteIndex = start + idx;
        const isSelected = absoluteIndex === this.selectedIndex;
        const pointer = isSelected ? "> " : "  ";

        const numBadge = `[${absoluteIndex + 1}]`;
        const date = new Date(draft.timestamp);
        const timeStr = `${String(date.getHours()).padStart(2, "0")}:${String(
          date.getMinutes(),
        ).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;

        const previewClean = draft.text.replace(/\r?\n/g, " ").trim();
        const lineCount = draft.text.split(/\r?\n/).length;
        const meta = `(${lineCount}L, ${draft.text.length}c)`;

        let rowStr = "";
        if (safeWidth >= 80) {
          rowStr = `${pointer}${numBadge} ${draft.title} · ${timeStr} · ${meta} - ${previewClean}`;
        } else if (safeWidth >= 40) {
          rowStr = `${pointer}${numBadge} ${draft.title} · ${meta} - ${previewClean}`;
        } else {
          rowStr = `${pointer}${numBadge} ${draft.title}`;
        }

        if (isSelected) {
          rowStr = safeBold(theme, safeFg(theme, "accent", rowStr));
        } else {
          rowStr = safeDim(theme, rowStr);
        }

        return truncateToWidth(rowStr, safeWidth, "");
      });

      this.listText.setText(lines.join("\n"));
    }

    // Status footer
    const statusSummary =
      count === 0
        ? "0 drafts"
        : `Draft ${this.selectedIndex + 1}/${count} ${count > this.maxVisible ? "(↑↓ scroll)" : ""}`;
    const footerMsg =
      safeWidth >= 55
        ? `${statusSummary} · Enter: restore · d: delete · c: clear · Esc: close`
        : safeWidth >= 30
          ? `${statusSummary} · ↵: rst · d: del · Esc`
          : statusSummary;

    this.statusText.setText(
      truncateToWidth(safeDim(theme, footerMsg), safeWidth, ""),
    );
  }

  override render(width: number): string[] {
    this.updateView(width);
    return super.render(width);
  }
}

/**
 * Factory implementing StashPickerFactory for the composer scratchpad.
 */
export const createStashPickerComponent: StashPickerFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: StashPickerOptions,
): Component => {
  return new StashPickerComponent(tui, theme, keybindings, done, ctx, options);
};

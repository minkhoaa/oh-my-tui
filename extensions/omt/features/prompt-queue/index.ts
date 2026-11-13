import { Container, Key, Text, matchesKey, truncateToWidth, visibleWidth, type Component, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { DynamicBorder, type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import type { PromptQueueFactory, PromptQueueOptions, QueuedPrompt } from "./types.ts";
import { getBorderStyler } from "../../presets/shared/style.ts";

export type { PromptQueueFactory, PromptQueueOptions, QueuedPrompt };

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
 * Store managing queued prompts for steering and follow-up turns.
 */
export { PromptQueueStore } from "./store.ts";
import { PromptQueueStore } from "./store.ts";

/**
 * Format prompt queue status badge, e.g. [Queue: 2 (1 steer)].
 * Returns empty string if the queue has no prompts.
 */
export function formatQueueStatus(
  queue: PromptQueueStore | QueuedPrompt[],
  theme: Theme,
  width?: number,
): string {
  const prompts = Array.isArray(queue) ? queue : queue.getAll();
  const total = prompts.length;
  if (total === 0) {
    return "";
  }

  const steerCount = prompts.filter((p) => p.deliverAs === "steer").length;

  const isUltraNarrow = width !== undefined && width < 25;
  const isNarrow = width !== undefined && width < 45;

  let label: string;
  if (isUltraNarrow) {
    label = steerCount > 0 ? `Q:${total}(${steerCount}s)` : `Q:${total}`;
  } else if (isNarrow) {
    label = steerCount > 0 ? `Queue: ${total} (${steerCount}s)` : `Queue: ${total}`;
  } else {
    label = steerCount > 0 ? `Queue: ${total} (${steerCount} steer)` : `Queue: ${total}`;
  }

  const open = safeDim(theme, "[");
  const close = safeDim(theme, "]");
  const badgeColor: Parameters<Theme["fg"]>[0] = steerCount > 0 ? "warning" : "muted";
  const content = safeFg(theme, badgeColor, label);

  const formatted = `${open}${content}${close}`;
  if (width !== undefined && width > 0) {
    return truncateToWidth(formatted, width, "");
  }
  return formatted;
}

/**
 * Format timestamp into HH:MM:SS format.
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Interactive Prompt Queue and Steering Component.
 */
export class PromptQueueComponent extends Container implements Component {
  readonly capturesViewportInput: boolean = true;
  readonly wantsKeyRelease: boolean = false;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private queue: PromptQueueStore;
  private options?: PromptQueueOptions;

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
    options?: PromptQueueOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;
    this.queue =
      options?.prompts !== undefined
        ? new PromptQueueStore(options.prompts)
        : new PromptQueueStore();

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

  getQueue(): PromptQueueStore {
    return this.queue;
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
      this.close();
      return;
    }

    // Enter to inspect / confirm
    if (
      this.keybindings?.matches?.(data, "tui.select.confirm") ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.return) ||
      data === "\r" ||
      data === "\n"
    ) {
      const prompts = this.queue.getAll();
      const selected = prompts[this.selectedIndex];
      this.close(selected ?? null);
      return;
    }

    // Up arrow
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A"
    ) {
      const count = this.queue.count();
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
      const count = this.queue.count();
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
      const count = this.queue.count();
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
      const count = this.queue.count();
      if (count > 0) {
        this.selectedIndex = Math.min(count - 1, this.selectedIndex + 5);
        this.tui.requestRender?.();
      }
      return;
    }

    // 'p' to promote prompt to front of queue
    if (data === "p" || data === "P") {
      const prompts = this.queue.getAll();
      const selected = prompts[this.selectedIndex];
      if (selected) {
        this.queue.promote(selected.id);
        this.options?.onPromote?.(selected.id);
        this.selectedIndex = 0;
        this.tui.requestRender?.();
      }
      return;
    }

    // 'd' or Delete to remove prompt
    if (
      data === "d" ||
      data === "D" ||
      matchesKey(data, Key.delete) ||
      data === "\x1b[3~"
    ) {
      const prompts = this.queue.getAll();
      const selected = prompts[this.selectedIndex];
      if (selected) {
        this.queue.remove(selected.id);
        this.options?.onRemove?.(selected.id);
        const newCount = this.queue.count();
        if (this.selectedIndex >= newCount) {
          this.selectedIndex = Math.max(0, newCount - 1);
        }
        this.tui.requestRender?.();
      }
      return;
    }

    // 'c' to clear queue
    if (data === "c" || data === "C") {
      this.queue.clear();
      this.options?.onClear?.();
      this.selectedIndex = 0;
      this.tui.requestRender?.();
      return;
    }
  }

  private updateView(width: number): void {
    const safeWidth = Math.max(1, width);
    const theme = this.theme;
    const prompts = this.queue.getAll();
    const count = prompts.length;

    // Title line
    const steerCount = this.queue.getSteerCount();
    const titleBase =
      safeWidth >= 40
        ? "OMT Prompt Queue & Steering"
        : "Prompt Queue";
    const title = safeBold(theme, safeFg(theme, "accent", titleBase));

    const hint =
      safeWidth >= 70
        ? safeDim(theme, "p: promote · d: delete · c: clear · Esc: close")
        : safeWidth >= 40
          ? safeDim(theme, "p: prom · d: del · Esc")
          : "";

    if (hint && safeWidth >= 55) {
      const titleW = visibleWidth(titleBase);
      const hintW = visibleWidth("p: promote · d: delete · c: clear · Esc: close");
      const pad = Math.max(1, safeWidth - titleW - hintW);
      this.titleText.setText(
        truncateToWidth(`${title}${" ".repeat(pad)}${hint}`, safeWidth, ""),
      );
    } else {
      this.titleText.setText(truncateToWidth(title, safeWidth, ""));
    }

    // List of queued prompts
    if (count === 0) {
      const emptyMsg =
        safeWidth >= 35
          ? "  Queue is empty. (Press Esc to close)"
          : "  Empty queue (Esc)";
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
      const visible = prompts.slice(start, end);

      const lines = visible.map((prompt, idx) => {
        const absoluteIndex = start + idx;
        const isSelected = absoluteIndex === this.selectedIndex;
        const pointer = isSelected ? "> " : "  ";
        const numBadge = `[${absoluteIndex + 1}]`;

        // Delivery mode badge
        let modeBadge: string;
        if (safeWidth >= 60) {
          modeBadge =
            prompt.deliverAs === "steer"
              ? safeBold(theme, safeFg(theme, "warning", "[STEER]"))
              : safeFg(theme, "muted", "[FOLLOW-UP]");
        } else if (safeWidth >= 35) {
          modeBadge =
            prompt.deliverAs === "steer"
              ? safeBold(theme, safeFg(theme, "warning", "[STR]"))
              : safeFg(theme, "muted", "[F-UP]");
        } else {
          modeBadge =
            prompt.deliverAs === "steer"
              ? safeBold(theme, safeFg(theme, "warning", "[S]"))
              : safeFg(theme, "muted", "[F]");
        }

        const timeStr = formatTime(prompt.timestamp);
        const preview = prompt.text.replace(/\r?\n/g, " ").trim();

        let rowStr = "";
        if (safeWidth >= 80) {
          rowStr = `${pointer}${numBadge} ${modeBadge} ${timeStr} - ${preview}`;
        } else if (safeWidth >= 40) {
          rowStr = `${pointer}${numBadge} ${modeBadge} ${preview}`;
        } else {
          rowStr = `${pointer}${modeBadge} ${preview}`;
        }

        if (isSelected) {
          rowStr = safeBold(theme, safeFg(theme, "accent", rowStr));
        }

        return truncateToWidth(rowStr, safeWidth, "");
      });

      this.listText.setText(lines.join("\n"));
    }

    // Status footer
    const steerNote = steerCount > 0 ? ` (${steerCount} steer)` : "";
    const statusSummary =
      count === 0
        ? "0 queued"
        : `Showing ${this.selectedIndex + 1}/${count}${steerNote} ${count > this.maxVisible ? "(↑↓ scroll)" : ""}`;

    const footerMsg =
      safeWidth >= 65
        ? `${statusSummary} · p: promote · d: delete · c: clear · Esc: close`
        : safeWidth >= 35
          ? `${statusSummary} · p: prom · d: del · Esc`
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
 * Factory implementing PromptQueueFactory for the prompt queue and steering view.
 */
export const createPromptQueueComponent: PromptQueueFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: PromptQueueOptions,
): Component => {
  return new PromptQueueComponent(tui, theme, keybindings, done, ctx, options);
};

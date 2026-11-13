/**
 * Notification History Dialog Component (/notifications).
 *
 * Presentation & Data Adapter Contract:
 *   - Box width clamped into [40, 120] and winW - 2.
 *   - Content width cw = boxW - 6, rowW = cw - 2.
 *   - dlgStyle with rounded borders ╭─╮ and Padding(1, 3).
 *   - Header: "Notification history"
 *   - Subtitle: "Latest N of M · RAM only"
 *   - Filter line: "filter: ▌"
 *   - Rows with "● INFO" (green) or "× ERROR" (red) markers.
 *   - Selected row marked with "▸ " and full-width highlight.
 *   - Footer: "type to filter · ↑↓ select · PgUp/PgDn page · Ctrl+Y copy · Esc close".
 *   - Keybindings: Ctrl+Y copies item, PgUp/PgDn pages, Up/Down navigates, Esc closes.
 */

import { Container, visibleWidth, truncateToWidth, matchesKey, Key, type Component, type Focusable, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { copyToClipboard as nativeCopyToClipboard, type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { getBorderStyler } from "../../presets/shared/style.ts";
import { copyToClipboard, fit, fixedWin } from "./model.ts";

// -----------------------------------------------------------------------------
// Data Adapter Interfaces
// -----------------------------------------------------------------------------

export interface NotificationItem {
  id: string;
  text: string;
  level?: "info" | "error" | "warn" | "success" | string;
  timestamp?: number | string | Date;
  desc?: string;
  err?: boolean;
}

export interface NotificationHistoryOptions {
  items: NotificationItem[];
  terminalHeight?: number;
  targetHeight?: number;
  onSelect?: (item: NotificationItem) => void;
  onCopy?: (text: string) => void;
  onCopyNotification?: (item: NotificationItem) => void;
  clipboardWriter?: (text: string) => Promise<boolean> | boolean;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function fgSafe(theme: Theme | undefined, color: ThemeColor, text: string): string {
  try {
    return theme?.fg ? theme.fg(color, text) : text;
  } catch {
    return text;
  }
}

function boldSafe(theme: Theme | undefined, text: string): string {
  try {
    return theme?.bold ? theme.bold(text) : text;
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

function formatNotificationTime(ts: number | string | Date | undefined): string {
  if (!ts) return "";
  let d: Date;
  if (ts instanceof Date) {
    d = ts;
  } else if (typeof ts === "number") {
    d = new Date(ts < 1e11 ? ts * 1000 : ts);
  } else {
    const parsed = Date.parse(ts);
    d = isNaN(parsed) ? new Date() : new Date(parsed);
  }
  const pad = (n: number) => (n < 10 ? "0" + n : String(n));
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${mm}-${dd} ${hh}:${min}:${ss}`;
}

export function notificationGeom(
  winW: number,
  winH: number,
): { boxW: number; cw: number; rowW: number; win: number; blanks: number } {
  let boxW = winW - 10;
  if (boxW > 120) boxW = 120;
  if (boxW < 40) boxW = 40;
  if (boxW > winW - 2) boxW = winW - 2;
  if (boxW < 12) boxW = 12;

  let cw = boxW - 6;
  if (cw < 8) cw = 8;
  let rowW = cw - 2;
  if (rowW < 6) rowW = 6;

  const placeH = winH - 2;
  let blanks = 2;
  if (placeH < 14) blanks = 1;
  if (placeH < 11) blanks = 0;

  let win = placeH - 4 - 4 - blanks;
  if (win < 1) win = 1;
  if (win > 20) win = 20;

  return { boxW, cw, rowW, win, blanks };
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export class OmtNotificationHistoryComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx?: ExtensionContext;
  private options: NotificationHistoryOptions;

  private items: NotificationItem[];
  private cursor: number = 0;
  private query: string = "";
  private feedbackText: string = "";
  private closed: boolean = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings?: KeybindingsManager,
    done?: (value?: unknown) => void,
    ctxOrOptions?: ExtensionContext | NotificationHistoryOptions,
    maybeOptions?: NotificationHistoryOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done || (() => {});

    if (maybeOptions) {
      this.ctx = ctxOrOptions as ExtensionContext;
      this.options = maybeOptions;
    } else if (ctxOrOptions && "items" in ctxOrOptions) {
      this.options = ctxOrOptions as NotificationHistoryOptions;
    } else {
      this.ctx = ctxOrOptions as ExtensionContext;
      this.options = (maybeOptions || { items: [] }) as NotificationHistoryOptions;
    }

    this.items = Array.isArray(this.options.items) ? [...this.options.items] : [];
  }

  getFilteredItems(): NotificationItem[] {
    if (!this.query.trim()) return this.items;
    const q = this.query.toLowerCase().trim();
    return this.items.filter((item) => {
      const textMatch = item.text.toLowerCase().includes(q);
      const levelMatch = (item.level || "").toLowerCase().includes(q);
      const descMatch = (item.desc || "").toLowerCase().includes(q);
      return textMatch || levelMatch || descMatch;
    });
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.done();
    }
  }

  handleInput(data: string): void {
    if (this.closed) return;

    // Esc / Close
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      if (this.query.length > 0) {
        this.query = "";
        this.cursor = 0;
        this.tui.requestRender?.();
        return;
      }
      this.close();
      return;
    }

    // Up / k
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A"
    ) {
      const filtered = this.getFilteredItems();
      if (filtered.length > 0) {
        this.cursor = Math.max(0, this.cursor - 1);
        this.tui.requestRender?.();
      }
      return;
    }

    // Down / j
    if (
      this.keybindings?.matches?.(data, "tui.select.down") ||
      matchesKey(data, Key.down) ||
      data === "\x1b[B"
    ) {
      const filtered = this.getFilteredItems();
      if (filtered.length > 0) {
        this.cursor = Math.min(filtered.length - 1, this.cursor + 1);
        this.tui.requestRender?.();
      }
      return;
    }

    // PgUp
    if (matchesKey(data, Key.pageUp) || data === "\x1b[5~") {
      const termH = (this.tui as any)?.height ?? (this.tui as any)?.rows ?? 54;
      const { win } = notificationGeom(192, termH);
      this.cursor = Math.max(0, this.cursor - win);
      this.tui.requestRender?.();
      return;
    }

    // PgDown
    if (matchesKey(data, Key.pageDown) || data === "\x1b[6~") {
      const filtered = this.getFilteredItems();
      const termH = (this.tui as any)?.height ?? (this.tui as any)?.rows ?? 54;
      const { win } = notificationGeom(192, termH);
      this.cursor = Math.min(Math.max(0, filtered.length - 1), this.cursor + win);
      this.tui.requestRender?.();
      return;
    }

    // Ctrl+Y (\x19) or 'c' copy payload
    if (data === "\x19" || (data === "c" && this.query.length === 0)) {
      const filtered = this.getFilteredItems();
      const sel = filtered[this.cursor];
      if (sel) {
        const textToCopy = sel.text;
        if (typeof this.options.clipboardWriter === "function") {
          let writerRes: boolean | Promise<boolean>;
          try {
            writerRes = this.options.clipboardWriter(textToCopy);
          } catch (err: any) {
            this.feedbackText = `copy failed: ${err?.message || "error"}`;
            this.tui.requestRender?.();
            return;
          }

          if (typeof writerRes === "boolean") {
            if (writerRes) {
              this.feedbackText = `✓ copied ${textToCopy.length} chars to clipboard`;
              this.options.onCopy?.(textToCopy);
              this.options.onCopyNotification?.(sel);
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
                this.feedbackText = `✓ copied ${textToCopy.length} chars to clipboard`;
                this.options.onCopy?.(textToCopy);
                this.options.onCopyNotification?.(sel);
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
        this.feedbackText = `✓ copied ${textToCopy.length} chars to clipboard`;
        nativeCopyToClipboard(textToCopy)
          .then(() => {
            if (this.closed) return;
            this.options.onCopy?.(textToCopy);
            this.options.onCopyNotification?.(sel);
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

    // Enter
    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      const filtered = this.getFilteredItems();
      const sel = filtered[this.cursor];
      if (sel) {
        this.options.onSelect?.(sel);
      }
      return;
    }

    // Backspace
    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.cursor = 0;
        this.tui.requestRender?.();
      }
      return;
    }

    // Filter typing
    if (data.length === 1 && data >= " " && data <= "~") {
      this.query += data;
      this.cursor = 0;
      this.tui.requestRender?.();
      return;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(16, width);
    const termH =
      (this.tui as any)?.height ??
      (this.tui as any)?.rows ??
      this.options.terminalHeight ??
      54;
    const { boxW, cw, rowW, win, blanks } = notificationGeom(safeWidth, termH);

    const outerW = boxW + 2;
    const paddingH = 3;
    const leftMargin = " ".repeat(Math.max(0, Math.floor((safeWidth - outerW) / 2)));

    const borderStyler = getBorderStyler(this.theme);
    const borderVert = borderStyler(fgSafe(this.theme, "border", "│"));

    const frameRow = (content: string): string => {
      const padded = truncateToWidth(content, cw, "");
      const fillDiff = Math.max(0, cw - visibleWidth(padded));
      return `${leftMargin}${borderVert}${" ".repeat(paddingH)}${padded}${" ".repeat(fillDiff)}${" ".repeat(paddingH)}${borderVert}`;
    };

    const lines: string[] = [];
    const items = this.getFilteredItems();

    // 1. Top border
    lines.push(`${leftMargin}${borderStyler(`╭${"─".repeat(boxW)}╮`)}`);

    // 2. Top padding row (dlgStyle Padding(1, 3))
    lines.push(`${leftMargin}${borderVert}${" ".repeat(boxW)}${borderVert}`);

    // 3. Title: "Notification history" (bold text)
    lines.push(frameRow(boldSafe(this.theme, "Notification history")));

    // 4. Subtitle: "Latest N of M · RAM only"
    const totalCount = this.items.length;
    const maxRam = Math.min(totalCount, 50);
    const subtitle = `Latest ${maxRam} of ${totalCount} · RAM only`;
    lines.push(frameRow(dimSafe(this.theme, subtitle)));

    // 5. Filter row
    const filterText = `filter: ${this.query}▌`;
    lines.push(frameRow(dimSafe(this.theme, filterText)));

    // 6. Blank row if blanks > 0
    if (blanks > 0) {
      lines.push(frameRow(" ".repeat(cw)));
    }

    // 7. Rows
    const { start, end, hasAbove, hasBelow } = fixedWin(this.cursor, items.length, win);
    const listLines: string[] = [];

    if (hasAbove) {
      listLines.push("  " + dimSafe(this.theme, fit(`…(+${start} above)`, rowW)));
    }
    if (items.length === 0) {
      const emptyMsg = this.query ? "— no matching notifications —" : "— no notifications —";
      listLines.push("  " + dimSafe(this.theme, fit(emptyMsg, rowW)));
    } else {
      for (let i = start; i < end; i++) {
        const item = items[i]!;
        const isSel = i === this.cursor;
        const isErr = item.level === "error" || item.err === true;
        const marker = isErr ? "× ERROR" : "● INFO";
        const kindLabel = isErr ? "ERROR" : "INFO";
        const timeStr = formatNotificationTime(item.timestamp);
        const descStr = item.desc || (timeStr ? `${timeStr} · ${kindLabel}` : kindLabel);

        const gap = 2;
        const markerW = visibleWidth(marker);
        const descW = visibleWidth(descStr);
        const bodyW = Math.max(1, rowW - 2 - markerW - descW - gap * 2);
        const bodyFitted = fit(item.text, bodyW);

        if (isSel) {
          const plainRow = `${marker}${" ".repeat(gap)}${bodyFitted}${" ".repeat(gap)}${descStr}`;
          const styled = boldSafe(this.theme, fit(plainRow, rowW));
          listLines.push(`▸ ${styled}`);
        } else {
          const markerStyled = isErr
            ? fgSafe(this.theme, "error", marker)
            : fgSafe(this.theme, "success", marker);
          const bodyStyled = bodyFitted;
          const descStyled = dimSafe(this.theme, descStr);
          listLines.push(`  ${markerStyled}${" ".repeat(gap)}${bodyStyled}${" ".repeat(gap)}${descStyled}`);
        }
      }
    }
    if (hasBelow) {
      listLines.push("  " + dimSafe(this.theme, fit(`…(+${items.length - end} below)`, rowW)));
    }
    while (listLines.length < win) {
      listLines.push(" ".repeat(rowW));
    }
    for (const ln of listLines) {
      lines.push(frameRow(ln));
    }

    // 8. Blank row if blanks > 1
    if (blanks > 1) {
      lines.push(frameRow(" ".repeat(cw)));
    }

    // 9. Footer
    let footText: string;
    if (this.feedbackText) {
      footText = boldSafe(this.theme, fgSafe(this.theme, "success", this.feedbackText));
    } else {
      footText = dimSafe(
        this.theme,
        fit("type to filter · ↑↓ select · PgUp/PgDn page · Ctrl+Y copy · Esc close", cw),
      );
    }
    lines.push(frameRow(footText));

    // 10. Bottom padding row (dlgStyle Padding(1, 3))
    lines.push(`${leftMargin}${borderVert}${" ".repeat(boxW)}${borderVert}`);

    // 11. Bottom border
    lines.push(`${leftMargin}${borderStyler(`╰${"─".repeat(boxW)}╯`)}`);

    return lines;
  }
}

export function createOmtNotificationHistoryComponent(
  tui: TUI,
  theme: Theme,
  keybindings?: KeybindingsManager,
  done: (value?: unknown) => void = () => {},
  ctx?: ExtensionContext,
  options?: NotificationHistoryOptions,
): Component {
  return new OmtNotificationHistoryComponent(tui, theme, keybindings, done, ctx, options);
}

export function createNotificationHistoryComponent(
  tui: TUI,
  theme: Theme,
  keybindings?: KeybindingsManager,
  done: (value?: unknown) => void = () => {},
  ctx?: ExtensionContext,
  options?: NotificationHistoryOptions,
): Component {
  return new OmtNotificationHistoryComponent(tui, theme, keybindings, done, ctx, options);
}

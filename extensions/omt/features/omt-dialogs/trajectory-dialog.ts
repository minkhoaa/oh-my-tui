/**
 * OMT Trajectory Dialog.
 *
 * Layout:
 *   - Fixed-size Unicode rounded box (╭─╮ ╰─╯) with exact padding (1 vertical, 3 horizontal)
 *   - Left pane: Step index, timestamp, kind badge (user, assistant, tool, error), tool name, title
 *   - Right pane: Step detail & unified diff viewer with full syntax highlighting (header, hunk @@, add +, delete -, context)
 *   - Interactive: Live follow streaming turns (updateSteps), scrollable diff detail (wheel / PgUp / PgDn),
 *     filter input, semantic clipboard copy ('c' / 'y' / Ctrl+Y), Enter select, Esc close.
 */

import { matchesKey, Key, truncateToWidth, visibleWidth, type Component, type Focusable, type KeybindingsManager, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { copyToClipboard as nativeCopyToClipboard, type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import type { TraceStep, TrajectoryDialogOptions as BaseTrajectoryDialogOptions } from "./types.ts";

export interface TrajectoryDialogOptions extends BaseTrajectoryDialogOptions {
  onCopy?: (copiedText: string) => void;
  clipboardWriter?: (text: string) => Promise<boolean> | boolean;
  scope?: string;
  terminalHeight?: number;
  targetHeight?: number;
}
export type { TraceStep };
import { classifyDiffLine, copyToClipboard, filterItems, fit, fixedWin, resolveStableCursor, traceStepLabel, type DiffLineType } from "./model.ts";
import { selectedDialogRow } from "./presentation.ts";
import { signatureFg } from "../../presets/omt-signature/rendering.ts";

// =============================================================================
// Helper Color Resolvers
// =============================================================================

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

// =============================================================================
// Layout & Geometry
// =============================================================================

/**
 * Matches tool tags like [read: path] or [tool] for highlighting.
 */
export const TRAJ_TAG_RE = /\[[^\[\]]*\]/g;

export interface TrajGeometry {
  boxW: number;
  leftW: number;
  rightW: number;
  cw: number;
  paddingX: number;
  win: number;
  outerW: number;
}

/**
 * trajGeom calculates two-column layout from terminal width.
 * Calculates responsive geometry from the viewport dimensions.
 * Adds responsive down-scaling for narrow widths (<= 40, <= 20) to guarantee
 * zero overflow (visibleWidth <= terminal width).
 */
export function trajGeom(winW: number, winH: number = 30): TrajGeometry {
  let boxW: number;
  let paddingX = 3;

  if (winW >= 80) {
    boxW = Math.min(Math.max(winW - 10, 70), 150);
    // Guarantee boxW + 2 border <= winW
    if (boxW + 2 > winW) {
      boxW = winW - 2;
    }
  } else if (winW >= 40) {
    boxW = Math.max(36, winW - 2);
    paddingX = 1;
  } else {
    boxW = Math.max(16, winW - 2);
    paddingX = 1;
  }

  const outerW = boxW + 2;
  const cw = Math.max(10, boxW - 2 * paddingX);

  let leftW: number;
  if (boxW >= 120) {
    leftW = 42;
  } else if (boxW >= 100) {
    leftW = 36;
  } else if (boxW >= 70) {
    leftW = 28;
  } else if (cw >= 30) {
    leftW = Math.max(12, Math.floor(cw * 0.4));
  } else {
    leftW = Math.max(5, Math.floor(cw * 0.42));
  }

  let rightW = cw - leftW - 3;
  if (rightW < 6) {
    rightW = Math.max(4, cw - leftW - 1);
  }

  let win = winH - 14;
  if (win < 12) win = 12;
  if (win > 24) win = 24;

  return { boxW, leftW, rightW, cw, paddingX, win, outerW };
}

/**
 * trajContentW is the exact content width: boxW minus dialog horizontal padding.
 */
export function trajContentW(winW: number): number {
  return trajGeom(winW).cw;
}

// =============================================================================
// Colors & Formatting
// =============================================================================

/**
 * Maps a step kind to theme color role.
 */
export function trajKindStyle(kind: string, text: string, theme: Theme): string {
  switch (kind) {
    case "user":
      return typeof theme.style === "function" ? signatureFg(theme, "cyan", text) : fgSafe(theme, "accent", text);
    case "assistant":
      return boldSafe(theme, typeof theme.style === "function" ? signatureFg(theme, "plan", text) : fgSafe(theme, "accent", text));
    case "tool":
      return fgSafe(theme, "warning", text);
    case "bash":
      return fgSafe(theme, "success", text);
    case "error":
      return fgSafe(theme, "error", text);
    default:
      return dimSafe(theme, text);
  }
}

/**
 * Colors the step number dim, the role kind, and every [tag] span in yellow.
 */
export function trajColorRow(row: string, kind: string, theme: Theme): string {
  const parts = row.split(" ");
  if (parts.length === 0) return row;

  let num = "";
  let rest = row;
  if (parts.length > 1 && (parts[0]!.startsWith("#") || parts[0]!.endsWith(":"))) {
    num = parts[0]!;
    rest = row.slice(num.length + 1);
  }

  const tagRe = /\[[^\[\]]*\]/g;
  let lastIdx = 0;
  let styledRest = "";
  let match: RegExpExecArray | null;

  const styleKindToken = (s: string): string => {
    if (!kind) return fgSafe(theme, "text", s);
    const token = `${kind}:`;
    const idx = s.indexOf(token);
    if (idx >= 0) {
      return (
        fgSafe(theme, "text", s.slice(0, idx)) +
        trajKindStyle(kind, token, theme) +
        fgSafe(theme, "text", s.slice(idx + token.length))
      );
    }
    return fgSafe(theme, "text", s);
  };

  while ((match = tagRe.exec(rest)) !== null) {
    const before = rest.slice(lastIdx, match.index);
    styledRest += styleKindToken(before);
    styledRest += fgSafe(theme, "warning", match[0]);
    lastIdx = match.index + match[0].length;
  }
  styledRest += styleKindToken(rest.slice(lastIdx));

  if (num) {
    return `${dimSafe(theme, num)} ${styledRest}`;
  }
  return styledRest;
}

/**
 * trajLegend is the color key under the filter line.
 */
export function trajLegend(cw: number, theme: Theme): string {
  const parts: string[] = [];
  parts.push(dimSafe(theme, "legend "));
  parts.push(trajKindStyle("user", "user", theme));
  parts.push(" ");
  parts.push(trajKindStyle("assistant", "assistant", theme));
  parts.push(" ");
  parts.push(fgSafe(theme, "warning", "[tool]"));
  parts.push(" ");
  parts.push(fgSafe(theme, "success", "[bash]"));

  const raw = parts.join("");
  return truncateToWidth(raw, cw, "");
}

/**
 * trajPad pads s to exactly w cells without truncating ANSI sequences.
 */
export function trajPad(s: string, w: number): string {
  const cur = visibleWidth(s);
  if (cur < w) {
    return s + " ".repeat(w - cur);
  }
  return truncateToWidth(s, w, "");
}

/**
 * trajScroll clamps an offset into scrollable range of lines.
 */
export function trajScroll(off: number, total: number, win: number): number {
  const max = Math.max(0, total - win);
  if (off > max) return max;
  if (off < 0) return 0;
  return off;
}

// =============================================================================
// Diff Classification & Highlight
// =============================================================================

export type TrajDiffKind = "none" | "remove" | "add" | "header";

export function trajDiffKindOf(line: string): TrajDiffKind {
  const trimmed = line.trimStart();
  if (
    line.startsWith("- ") ||
    line.startsWith("---") ||
    trimmed.startsWith("---")
  ) {
    return "remove";
  }
  if (
    line.startsWith("+ ") ||
    line.startsWith("+++") ||
    trimmed.startsWith("+++")
  ) {
    return "add";
  }
  if (
    trimmed.startsWith("diff:") ||
    trimmed.startsWith("diff ") ||
    trimmed.startsWith("index ") ||
    trimmed.startsWith("@@")
  ) {
    return "header";
  }
  return "none";
}

export function styleDiffLine(line: string, kind: TrajDiffKind, theme: Theme): string {
  switch (kind) {
    case "remove":
      return fgSafe(theme, "error", line);
    case "add":
      return fgSafe(theme, "success", line);
    case "header":
      return boldSafe(theme, fgSafe(theme, "warning", line));
    default:
      return dimSafe(theme, line);
  }
}

export interface TrajDetailRow {
  text: string;
  isTitle: boolean;
  isMeta: boolean;
  diffKind: TrajDiffKind;
}

/**
 * Word-wraps long lines while keeping continuation rows classified
 * under the same diffKind.
 * Keeps wrapped continuation rows classified under the same diff kind.
 */
function wrapLine(line: string, maxW: number): string[] {
  if (line.length <= maxW) return [line];
  const out: string[] = [];
  let remaining = line;
  while (remaining.length > maxW) {
    let breakIdx = remaining.lastIndexOf(" ", maxW);
    if (breakIdx <= 0 || breakIdx < Math.floor(maxW * 0.4)) {
      breakIdx = maxW;
    }
    out.push(remaining.slice(0, breakIdx));
    remaining = remaining.slice(breakIdx).trimStart();
  }
  if (remaining.length > 0) {
    out.push(remaining);
  }
  return out;
}

export function parseTrajDetailRows(detail: string, maxW: number): TrajDetailRow[] {
  const lines = detail.split(/\r?\n/);
  const rows: TrajDetailRow[] = [];

  const firstIsDiff = lines.length > 0 && trajDiffKindOf(lines[0]!) !== "none";
  const hasGoHeader =
    !firstIsDiff &&
    lines.length >= 2 &&
    lines[0]!.startsWith("#") &&
    lines[1]!.includes("·");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const isTitle = hasGoHeader && i === 0;
    const isMeta = hasGoHeader && i === 1;
    const diffKind = isTitle || isMeta ? "none" : trajDiffKindOf(line);

    if (line.length === 0) {
      rows.push({ text: "", isTitle, isMeta, diffKind: "none" });
      continue;
    }

    const wrapped = wrapLine(line, Math.max(8, maxW));
    for (let j = 0; j < wrapped.length; j++) {
      rows.push({
        text: wrapped[j]!,
        isTitle: isTitle && j === 0,
        isMeta: isMeta && j === 0,
        diffKind,
      });
    }
  }

  return rows;
}

function formatTimestamp(ts: number | string | undefined): string {
  if (ts === undefined || ts === "") return "—";
  if (typeof ts === "number") {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      return d.toTimeString().slice(0, 8);
    }
  }
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    if (!isNaN(parsed)) {
      return new Date(parsed).toTimeString().slice(0, 8);
    }
    return ts.slice(0, 8);
  }
  return "—";
}

// =============================================================================
// OmtTrajectoryComponent
// =============================================================================

export class OmtTrajectoryComponent implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options: TrajectoryDialogOptions;

  private steps: TraceStep[];
  private stepCursor: number = 0;
  private detailScrollOffset: number = 0;
  private query: string = "";
  private feedbackText: string = "";
  private closed: boolean = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options: TrajectoryDialogOptions,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;
    this.steps = options.steps || [];

    // Initial cursor: focus newest step if available
    if (this.steps.length > 0) {
      this.stepCursor = this.steps.length - 1;
    }
  }

  /**
   * Live follow mode during streaming turns.
   * When a new step lands, the cursor always jumps to it (TrajOff = 0).
   * Otherwise, selection is preserved stably by step ID.
   */
  updateSteps(newSteps: TraceStep[]): void {
    const prevSel = this.getSelectedStep();
    const prevSelId = prevSel?.id;
    const prevNewestId = this.steps.length > 0 ? this.steps[this.steps.length - 1]?.id : undefined;
    const prevScrollOff = this.detailScrollOffset;

    this.steps = newSteps;
    const currentNewestId = this.steps.length > 0 ? this.steps[this.steps.length - 1]?.id : undefined;
    const newStepLanded = currentNewestId !== undefined && currentNewestId !== prevNewestId;

    if (newStepLanded) {
      const filtered = this.getFilteredSteps();
      if (filtered.length > 0) {
        const newestIdx = filtered.findIndex((s) => s.id === currentNewestId);
        this.stepCursor = newestIdx >= 0 ? newestIdx : filtered.length - 1;
      } else {
        this.stepCursor = 0;
      }
      this.detailScrollOffset = 0;
    } else {
      const { cursor } = resolveStableCursor(prevSelId, this.steps, this.query);
      this.stepCursor = cursor;
      const curSel = this.getSelectedStep();
      if (curSel && curSel.id === prevSelId) {
        this.detailScrollOffset = prevScrollOff;
      }
    }

    this.tui.requestRender?.();
  }

  /**
   * Subscribe to live trajectory step updates with subscription cleanup for parent.
   */
  subscribeLive(source: { onUpdate: (fn: (steps: TraceStep[]) => void) => () => void }): () => void {
    if (!source || typeof source.onUpdate !== "function") {
      return () => {};
    }
    const unsubscribe = source.onUpdate((newSteps: TraceStep[]) => {
      this.updateSteps(newSteps);
    });
    return unsubscribe;
  }

  private getFilteredSteps(): TraceStep[] {
    return filterItems(this.steps, this.query, (s) => [s.title, s.detail, s.kind, s.toolName]);
  }

  getSelectedStep(): TraceStep | undefined {
    const filtered = this.getFilteredSteps();
    if (filtered.length === 0) return undefined;
    if (this.stepCursor < 0) this.stepCursor = 0;
    if (this.stepCursor >= filtered.length) this.stepCursor = filtered.length - 1;
    return filtered[this.stepCursor];
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  invalidate(): void {
    // Invalidate cached state
  }

  /**
   * Mouse wheel handling:
   * Wheel over detail scrolls 3 lines per notch; wheel over steps moves selection.
   */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") {
      const delta = event.wheelDelta ?? 1;
      const isDown = delta > 0;
      const winH = this.tui.terminal?.rows ?? 30;
      const geom = trajGeom(event.width, winH);
      const leftMargin = Math.max(0, Math.floor((event.width - geom.outerW) / 2));
      const contentX = leftMargin + 1 + geom.paddingX;
      const detailX = contentX + geom.leftW + 3;

      const sel = this.getSelectedStep();
      const rows = sel ? parseTrajDetailRows(sel.detail, geom.rightW) : [];

      if (event.x >= detailX && rows.length > geom.win) {
        const step = isDown ? 3 : -3;
        this.detailScrollOffset = trajScroll(this.detailScrollOffset + step, rows.length, geom.win);
      } else {
        const filtered = this.getFilteredSteps();
        if (filtered.length > 0) {
          if (isDown) {
            this.stepCursor = Math.min(filtered.length - 1, this.stepCursor + 1);
          } else {
            this.stepCursor = Math.max(0, this.stepCursor - 1);
          }
          this.detailScrollOffset = 0;
        }
      }
      this.tui.requestRender?.();
      return { handled: true };
    }
    return undefined;
  }

  handleInput(data: string): void {
    if (this.closed) return;

    // Esc / Close
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      if (this.query.length > 0) {
        this.query = "";
        this.stepCursor = 0;
        this.detailScrollOffset = 0;
        this.tui.requestRender?.();
        return;
      }
      this.close();
      return;
    }

    // Step selection Up
    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k") {
      const items = this.getFilteredSteps();
      if (items.length > 0) {
        this.stepCursor = (this.stepCursor - 1 + items.length) % items.length;
        this.detailScrollOffset = 0;
      }
      this.tui.requestRender?.();
      return;
    }

    // Step selection Down
    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j") {
      const items = this.getFilteredSteps();
      if (items.length > 0) {
        this.stepCursor = (this.stepCursor + 1) % items.length;
        this.detailScrollOffset = 0;
      }
      this.tui.requestRender?.();
      return;
    }

    // First / Last step
    if (matchesKey(data, Key.home) || (data === "g" && this.query.length === 0)) {
      this.stepCursor = 0;
      this.detailScrollOffset = 0;
      this.tui.requestRender?.();
      return;
    }
    if (matchesKey(data, Key.end) || (data === "G" && this.query.length === 0)) {
      const items = this.getFilteredSteps();
      if (items.length > 0) {
        this.stepCursor = items.length - 1;
        this.detailScrollOffset = 0;
      }
      this.tui.requestRender?.();
      return;
    }

    // Detail scroll: PageUp / '['
    if (matchesKey(data, Key.pageUp) || data === "\x1b[5~" || (data === "[" && this.query.length === 0)) {
      this.detailScrollOffset = Math.max(0, this.detailScrollOffset - 5);
      this.tui.requestRender?.();
      return;
    }

    // Detail scroll: PageDown / ']'
    if (matchesKey(data, Key.pageDown) || data === "\x1b[6~" || (data === "]" && this.query.length === 0)) {
      this.detailScrollOffset += 5;
      this.tui.requestRender?.();
      return;
    }

    // Semantic copy of step detail: Ctrl+Y (\x19) always, or 'c' / 'y' when query is empty
    if (data === "\x19" || ((data === "c" || data === "y") && this.query.length === 0)) {
      const sel = this.getSelectedStep();
      if (sel) {
        const textToCopy = sel.detail;
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
              this.options.onCopyStep?.(sel);
              this.options.onCopy?.(textToCopy);
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
                this.options.onCopyStep?.(sel);
                this.options.onCopy?.(textToCopy);
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
            this.options.onCopyStep?.(sel);
            this.options.onCopy?.(textToCopy);
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

    // Enter / Select step
    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      const sel = this.getSelectedStep();
      if (sel) {
        this.options.onSelectStep?.(sel);
      }
      return;
    }

    // Filter Backspace
    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.stepCursor = 0;
        this.detailScrollOffset = 0;
        this.tui.requestRender?.();
      }
      return;
    }

    // Clear filter (Ctrl+U)
    if (data === "\x15") {
      if (this.query.length > 0) {
        this.query = "";
        this.stepCursor = 0;
        this.detailScrollOffset = 0;
        this.tui.requestRender?.();
      }
      return;
    }

    // Filter text entry (excluding hotkeys '[', ']')
    if (
      data.length === 1 &&
      data >= " " &&
      data <= "~" &&
      data !== "[" &&
      data !== "]"
    ) {
      this.query += data;
      this.stepCursor = 0;
      this.detailScrollOffset = 0;
      this.tui.requestRender?.();
      return;
    }
  }

  /**
   * Render the Trajectory dialog.
   */
  render(width: number): string[] {
    const safeWidth = Math.max(16, width);
    const winH = this.tui.terminal?.rows ?? 30;
    const geom = trajGeom(safeWidth, winH);
    const { boxW, leftW, rightW, cw, paddingX, win, outerW } = geom;

    // Helper to clamp plain/styled strings to exactly cw cells
    const fitCw = (s: string) => trajPad(s, cw);

    const contentLines: string[] = [];

    // Line 1: Title
    let title = `Trajectory (${this.options.scope || "all"})`;
    if (this.options.liveMode) {
      title += " [LIVE]";
    }
    const titleStr = boldSafe(this.theme, fgSafe(this.theme, "text", title));
    contentLines.push(fitCw(titleStr));

    contentLines.push(fitCw(dimSafe(this.theme, "harness-style run trace · ↑↓ move · Enter views the full step · type filters")));

    // Filter display
    const filterDisplay = dimSafe(this.theme, `filter: ${this.query}▌`);
    contentLines.push(fitCw(filterDisplay));

    // Line 3: Legend
    contentLines.push(fitCw(trajLegend(cw, this.theme)));

    // Line 4: Blank line
    contentLines.push(fitCw(""));

    // Line 5: Column Headers (STEPS │ DETAIL)
    const leftTitle = boldSafe(
      this.theme,
      fgSafe(this.theme, "text", fit("STEPS", leftW - 2)),
    );
    const rightTitle = boldSafe(
      this.theme,
      fgSafe(this.theme, "text", fit("DETAIL", rightW - 2)),
    );
    const sep = fgSafe(this.theme, "border", "│");
    const colHeader = `  ${leftTitle} ${sep}   ${rightTitle}`;
    contentLines.push(fitCw(colHeader));

    // -------------------------------------------------------------------------
    // Left Pane (Steps List)
    // -------------------------------------------------------------------------
    const items = this.getFilteredSteps();
    const { start, end, hasAbove, hasBelow } = fixedWin(
      this.stepCursor,
      items.length,
      win,
    );

    const leftLines: string[] = [];
    if (hasAbove) {
      leftLines.push(
        "  " + dimSafe(this.theme, fit(`…(+${start} above)`, leftW - 2)),
      );
    }
    if (items.length === 0) {
      const emptyMsg = this.query ? "— no match —" : "— no steps —";
      leftLines.push("  " + dimSafe(this.theme, fit(emptyMsg, leftW - 2)));
    } else {
      for (let i = start; i < end; i++) {
        const s = items[i]!;
        const isSel = i === this.stepCursor;
        const fitted = fit(traceStepLabel(s), leftW - 2);
        if (isSel) {
          const prefix = dimSafe(this.theme, "▸ ");
          const styled = selectedDialogRow(this.theme, fitted, leftW - 2);
          leftLines.push(prefix + styled);
        } else {
          const prefix = "  ";
          const styled = trajColorRow(fitted, s.kind, this.theme);
          leftLines.push(prefix + styled);
        }
      }
    }
    if (hasBelow) {
      leftLines.push(
        "  " +
          dimSafe(
            this.theme,
            fit(`…(+${items.length - end} below)`, leftW - 2),
          ),
      );
    }
    while (leftLines.length < win) {
      leftLines.push("  " + " ".repeat(Math.max(0, leftW - 2)));
    }

    // -------------------------------------------------------------------------
    // Right Pane (Step Detail & Diff Viewer)
    // -------------------------------------------------------------------------
    const sel = this.getSelectedStep();
    const rightLines: string[] = [];

    let totalDetailRows = 0;
    if (!sel) {
      rightLines.push(
        "  " + dimSafe(this.theme, fit("— no step selected —", rightW - 2)),
      );
    } else {
      const detailRows = parseTrajDetailRows(sel.detail, rightW - 4);
      totalDetailRows = detailRows.length;
      const off = trajScroll(this.detailScrollOffset, totalDetailRows, win);
      const shown = detailRows.slice(off, off + win);

      for (const r of shown) {
        const plain = fit(r.text, rightW - 2);
        let styled: string;
        if (r.isTitle) {
          styled = trajColorRow(plain, sel.kind, this.theme);
        } else if (r.isMeta) {
          styled = dimSafe(this.theme, plain);
        } else {
          styled = styleDiffLine(plain, r.diffKind, this.theme);
        }
        rightLines.push("  " + trajPad(styled, rightW - 2));
      }
    }
    while (rightLines.length < win) {
      rightLines.push("  " + " ".repeat(Math.max(0, rightW - 2)));
    }

    // -------------------------------------------------------------------------
    // Combine Columns with Divider (│)
    // -------------------------------------------------------------------------
    for (let i = 0; i < win; i++) {
      const l = trajPad(leftLines[i] ?? "", leftW);
      const r = trajPad(rightLines[i] ?? "", rightW);
      contentLines.push(fitCw(`${l} ${sep} ${r}`));
    }

    // -------------------------------------------------------------------------
    // Scroll Indicator
    // -------------------------------------------------------------------------
    const off = trajScroll(this.detailScrollOffset, totalDetailRows, win);
    const skipped = Math.max(0, totalDetailRows - off - win);
    let scrollStatus = "";
    if (off > 0 && skipped > 0) {
      scrollStatus = `…(+${off} lines above · +${skipped} below: PgUp/PgDn scrolls detail)`;
    } else if (off > 0) {
      scrollStatus = `…(+${off} lines above: PgUp scrolls up)`;
    } else if (skipped > 0) {
      scrollStatus = `…(+${skipped} lines below: PgDn scrolls down)`;
    }
    contentLines.push(fitCw(dimSafe(this.theme, scrollStatus)));

    // Blank line before footer
    contentLines.push(fitCw(""));

    // -------------------------------------------------------------------------
    // Footer / Key Hints
    // -------------------------------------------------------------------------
    if (this.feedbackText) {
      contentLines.push(
        fitCw(boldSafe(this.theme, fgSafe(this.theme, "success", this.feedbackText))),
      );
    } else {
      let foot =
        "type to filter · ↑↓ steps · wheel detail · Enter view in chat · Ctrl+Y copy · Esc close";
      if (items.length > 0) {
        const cur = Math.min(this.stepCursor + 1, items.length);
        const scopeStr = (this.options as any)?.scope || "all";
        foot += ` (${cur}/${items.length} · ${scopeStr})`;
      }
      contentLines.push(fitCw(dimSafe(this.theme, foot)));
    }

    // -------------------------------------------------------------------------
    // Unicode Rounded Box Framing (╭─╮ ╰─╯)
    // -------------------------------------------------------------------------
    const boxLines: string[] = [];
    const padStr = " ".repeat(paddingX);
    const bColor = (s: string) => fgSafe(this.theme, "border", s);

    // Top border
    boxLines.push(bColor(`╭${"─".repeat(boxW)}╮`));

    // Top padding row
    boxLines.push(bColor("│") + " ".repeat(boxW) + bColor("│"));

    // Content rows
    for (const cl of contentLines) {
      const vLen = visibleWidth(cl);
      const rightPad = Math.max(0, boxW - paddingX - vLen);
      boxLines.push(bColor("│") + padStr + cl + " ".repeat(rightPad) + bColor("│"));
    }

    // Bottom padding row
    boxLines.push(bColor("│") + " ".repeat(boxW) + bColor("│"));

    // Bottom border
    boxLines.push(bColor(`╰${"─".repeat(boxW)}╯`));

    // Center dialog in terminal viewport
    const leftMargin = " ".repeat(Math.max(0, Math.floor((safeWidth - outerW) / 2)));
    return boxLines.map((line) => leftMargin + line);
  }
}

export function createOmtTrajectoryComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options: TrajectoryDialogOptions,
): OmtTrajectoryComponent {
  return new OmtTrajectoryComponent(tui, theme, keybindings, done, ctx, options);
}

/**
 * Resume Dialog Component (/resume).
 *
 * Features:
 *   - Scope toggle via Tab between current workspace (scopeCurrent) and all workspaces (scopeAll).
 *   - Two-column fixed-geometry layout: left = session list, right = session preview.
 *   - Right pane preview of selected session: first user prompt, message count, token totals, cost, last updated ago (fmtAgo).
 *   - Session deletion on Delete key with feedback hint.
 *   - Semantic copy of session path on 'c' with feedback hint.
 *   - Spacing, padding, borders (rounded Unicode ╭─╮, ╰─╯, │), colors matching theme roles.
 */

import { Container, Text, visibleWidth, truncateToWidth, stripTerminalSequences, matchesKey, Key, type Component, type Focusable, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { DynamicBorder, copyToClipboard as nativeCopyToClipboard, type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { getBorderStyler } from "../../presets/shared/style.ts";
import { filterItems, fixedWin, shorten, fit, copyToClipboard, formatNumber } from "./model.ts";
import { selectedDialogRow } from "./presentation.ts";

// -----------------------------------------------------------------------------
// Constants and Types
// -----------------------------------------------------------------------------

export const scopeCurrent = "current" as const;
export const scopeAll = "all" as const;
export type ResumeScope = typeof scopeCurrent | typeof scopeAll;

export interface ResumeSessionItem {
  id: string;
  path: string;
  title: string;
  messageCount: number;
  modified: number | Date;
  cwd?: string;
  firstMessage?: string;
  firstUserPrompt?: string;
  isCurrent?: boolean;
  name?: string;
  tokens?: number | { total?: number; input?: number; output?: number };
  totalTokens?: number;
  tokenTotals?: number;
  cost?: number;
}

export interface ResumeDialogOptions {
  sessions: ResumeSessionItem[];
  scope?: ResumeScope;
  currentSessionId?: string;
  currentSessionPath?: string;
  cwd?: string;
  onSelectSession?: (session: ResumeSessionItem) => void;
  onDeleteSession?: (session: ResumeSessionItem) => Promise<boolean> | boolean;
  onScopeChange?: (scope: ResumeScope) => void;
  onCopyPath?: (path: string) => void;
  onCopy?: (copiedText: string) => void;
  clipboardWriter?: (text: string) => Promise<boolean> | boolean;
  terminalHeight?: number;
  targetHeight?: number;
}

// -----------------------------------------------------------------------------
// Helper Functions (Safe Styling & Formatting)
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

/**
 * Format relative time ago matching Go pirpc.Ago (e.g. "just now", "5m ago", "2h ago", "3d ago", "Jan 02").
 */
export function fmtAgo(d: number | Date | undefined): string {
  if (!d) return "—";
  const t = typeof d === "number" ? d : d.getTime();
  const diffMs = Date.now() - t;
  if (diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;

  const dt = new Date(t);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[dt.getMonth()]} ${String(dt.getDate()).padStart(2, "0")}`;
}

export const formatAgo = fmtAgo;

function formatDate(d: number | Date | undefined): string {
  if (!d) return "";
  const dt = typeof d === "number" ? new Date(d) : d;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function extractTokens(s: ResumeSessionItem): number | undefined {
  if (typeof s.tokenTotals === "number") return s.tokenTotals;
  if (typeof s.totalTokens === "number") return s.totalTokens;
  if (typeof s.tokens === "number") return s.tokens;
  if (typeof s.tokens === "object" && s.tokens !== null && typeof s.tokens.total === "number") {
    return s.tokens.total;
  }
  return undefined;
}

function formatCost(cost: number | undefined): string {
  if (cost === undefined || !Number.isFinite(cost)) return "—";
  if (cost < 0.01 && cost > 0) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

/**
 * Word-wraps detail lines to column width w without overflow.
 */
function wrapDetailText(text: string, maxW: number): string[] {
  if (maxW <= 0) return [];
  const lines: string[] = [];
  const rawLines = text.split(/\r?\n/);
  for (const raw of rawLines) {
    if (raw.length === 0) {
      lines.push("");
      continue;
    }
    let remaining = raw;
    while (remaining.length > 0) {
      if (visibleWidth(remaining) <= maxW) {
        lines.push(remaining);
        break;
      }
      let breakIdx = -1;
      let currW = 0;
      for (let i = 0; i < remaining.length; i++) {
        const charW = visibleWidth(remaining[i]!);
        if (currW + charW > maxW) break;
        currW += charW;
        if (remaining[i] === " " || remaining[i] === "\t") {
          breakIdx = i;
        }
      }
      if (breakIdx > 0) {
        lines.push(remaining.slice(0, breakIdx));
        remaining = remaining.slice(breakIdx + 1);
      } else {
        const chunk = truncateToWidth(remaining, maxW, "");
        lines.push(chunk);
        // truncateToWidth appends an SGR reset; it is not consumed source text.
        remaining = remaining.slice(stripTerminalSequences(chunk).length);
      }
    }
  }
  return lines;
}

// -----------------------------------------------------------------------------
// Component Implementation
// -----------------------------------------------------------------------------

export class ResumeDialogComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx?: ExtensionContext;
  private options: ResumeDialogOptions;

  private scope: ResumeScope = scopeCurrent;
  private sessionCursor: number = 0;
  private query: string = "";
  private feedbackText: string = "";
  private closed: boolean = false;
  private isDeletingSession: boolean = false;
  private sessions: ResumeSessionItem[] = [];

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings?: KeybindingsManager,
    done: (value?: unknown) => void = () => {},
    ctx?: ExtensionContext,
    options?: ResumeDialogOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;

    // Handle flexible options argument placement
    const opts = options ?? (ctx as unknown as ResumeDialogOptions) ?? { sessions: [], onSelectSession: () => {} };
    this.options = opts;
    this.scope = opts.scope ?? scopeCurrent;
    this.sessions = Array.isArray(opts.sessions) ? [...opts.sessions] : [];

    // Preselect current session if indicated
    if (opts.currentSessionId || opts.currentSessionPath) {
      const idx = this.sessions.findIndex(
        (s) => (opts.currentSessionId && s.id === opts.currentSessionId) ||
               (opts.currentSessionPath && s.path === opts.currentSessionPath) ||
               s.isCurrent,
      );
      if (idx >= 0) {
        this.sessionCursor = idx;
      }
    }
  }

  /**
   * Update sessions list dynamically while maintaining stable selection.
   */
  setSessions(newSessions: ResumeSessionItem[]): void {
    const curSel = this.getSelectedSession();
    this.sessions = [...newSessions];
    const filtered = this.getFilteredSessions();
    if (curSel) {
      const foundIdx = filtered.findIndex((s) => s.id === curSel.id || s.path === curSel.path);
      this.sessionCursor = foundIdx >= 0 ? foundIdx : Math.min(this.sessionCursor, Math.max(0, filtered.length - 1));
    } else {
      this.sessionCursor = Math.min(this.sessionCursor, Math.max(0, filtered.length - 1));
    }
    this.tui.requestRender?.();
  }

  /**
   * Set picker scope (current vs all) and notify callback.
   */
  setScope(scope: ResumeScope): void {
    if (this.scope === scope) return;
    this.scope = scope;
    this.options.onScopeChange?.(this.scope);
    this.sessionCursor = 0;
    this.tui.requestRender?.();
  }

  getScope(): ResumeScope {
    return this.scope;
  }

  getSelectedSession(): ResumeSessionItem | undefined {
    const items = this.getFilteredSessions();
    return items[this.sessionCursor];
  }

  getFilteredSessions(): ResumeSessionItem[] {
    let list = this.sessions;
    // When in scopeCurrent, filter by cwd if workspace cwd is available and items have cwd
    const workspaceCwd = this.options.cwd ?? this.ctx?.cwd;
    if (this.scope === scopeCurrent && workspaceCwd) {
      const scoped = list.filter((s) => !s.cwd || s.cwd === workspaceCwd);
      if (scoped.length > 0) {
        list = scoped;
      }
    }

    if (!this.query.trim()) {
      return list;
    }

    return filterItems(list, this.query, (s) => [
      s.title,
      s.path,
      s.cwd,
      s.name,
      s.firstMessage,
      s.firstUserPrompt,
    ]);
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    // Esc: clear filter first if typed, otherwise close dialog
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      if (this.query.length > 0) {
        this.query = "";
        this.sessionCursor = 0;
        this.tui.requestRender?.();
        return;
      }
      this.close();
      return;
    }

    // Tab: toggle scope between current workspace (scopeCurrent) and all workspaces (scopeAll)
    if (matchesKey(data, Key.tab) || data === "\t") {
      this.scope = this.scope === scopeCurrent ? scopeAll : scopeCurrent;
      this.options.onScopeChange?.(this.scope);
      this.sessionCursor = 0;
      this.tui.requestRender?.();
      return;
    }

    // Up / k: navigate up
    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k") {
      const items = this.getFilteredSessions();
      if (items.length > 0) {
        this.sessionCursor = (this.sessionCursor - 1 + items.length) % items.length;
      }
      this.tui.requestRender?.();
      return;
    }

    // Down / j: navigate down
    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j") {
      const items = this.getFilteredSessions();
      if (items.length > 0) {
        this.sessionCursor = (this.sessionCursor + 1) % items.length;
      }
      this.tui.requestRender?.();
      return;
    }

    // PageUp: jump up by page
    if (matchesKey(data, Key.pageUp) || data === "\x1b[5~") {
      this.sessionCursor = Math.max(0, this.sessionCursor - 8);
      this.tui.requestRender?.();
      return;
    }

    // PageDown: jump down by page
    if (matchesKey(data, Key.pageDown) || data === "\x1b[6~") {
      const items = this.getFilteredSessions();
      this.sessionCursor = Math.min(Math.max(0, items.length - 1), this.sessionCursor + 8);
      this.tui.requestRender?.();
      return;
    }

    // Enter: resume session
    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      const items = this.getFilteredSessions();
      const sel = items[this.sessionCursor];
      if (sel) {
        this.options.onSelectSession?.(sel);
        this.close(sel);
      }
      return;
    }

    // Delete session on Delete / Ctrl+D / Backspace when query is empty
    const isDeleteKey =
      data === "\x1b[3~" ||
      matchesKey(data, Key.delete) ||
      data === "\x04" ||
      (this.query.length === 0 && (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b"));

    if (isDeleteKey) {
      const items = this.getFilteredSessions();
      const sel = items[this.sessionCursor];
      if (sel) {
        const isCurrent =
          Boolean(sel.isCurrent) ||
          (Boolean(this.options.currentSessionId) && sel.id === this.options.currentSessionId) ||
          (Boolean(this.options.currentSessionPath) && sel.path === this.options.currentSessionPath) ||
          (Boolean((this.ctx as any)?.sessionFile) && sel.path === (this.ctx as any).sessionFile) ||
          (Boolean((this.ctx as any)?.sessionId) && sel.id === (this.ctx as any).sessionId);

        if (isCurrent) {
          this.feedbackText = "can't delete the current session — switch first";
          this.tui.requestRender?.();
          return;
        }

        if (!this.options.onDeleteSession) {
          this.feedbackText = "delete failed: no deletion handler provided";
          this.tui.requestRender?.();
          return;
        }

        if (this.isDeletingSession) {
          return;
        }

        let res: boolean | Promise<boolean>;
        try {
          res = this.options.onDeleteSession(sel);
        } catch (err: any) {
          this.feedbackText = `delete failed: ${err?.message || "error"}`;
          this.tui.requestRender?.();
          return;
        }

        const applySuccessfulDelete = () => {
          const idx = this.sessions.findIndex((s) => s.id === sel.id || s.path === sel.path);
          if (idx >= 0) {
            this.sessions.splice(idx, 1);
          }

          const remaining = this.getFilteredSessions();
          if (this.sessionCursor >= remaining.length) {
            this.sessionCursor = Math.max(0, remaining.length - 1);
          }

          if (this.sessions.length === 0 || remaining.length === 0) {
            this.feedbackText = "deleted session — no sessions left in this scope";
          } else {
            this.feedbackText = `deleted: ${shorten(sel.title || sel.path, 50)}`;
          }
          this.tui.requestRender?.();
        };

        if (typeof res === "boolean") {
          if (!res) {
            this.feedbackText = "delete failed";
            this.tui.requestRender?.();
            return;
          }
          applySuccessfulDelete();
          return;
        }

        // Async Promise
        this.isDeletingSession = true;
        Promise.resolve(res)
          .then((ok) => {
            this.isDeletingSession = false;
            if (this.closed) return;
            if (!ok) {
              this.feedbackText = "delete failed";
              this.tui.requestRender?.();
              return;
            }
            applySuccessfulDelete();
          })
          .catch((err: any) => {
            this.isDeletingSession = false;
            if (this.closed) return;
            this.feedbackText = `delete failed: ${err?.message || "error"}`;
            this.tui.requestRender?.();
          });
      }
      return;
    }

    // Semantic copy of session path on Ctrl+Y (\x19) or bare 'c' (when filter is empty)
    if (data === "\x19" || (data === "c" && this.query.length === 0)) {
      const items = this.getFilteredSessions();
      const sel = items[this.sessionCursor];
      if (sel) {
        const textToCopy = sel.path;
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
              this.options.onCopyPath?.(textToCopy);
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
                this.options.onCopyPath?.(textToCopy);
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
            this.options.onCopyPath?.(textToCopy);
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

    // Backspace: delete character from filter query
    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.sessionCursor = 0;
        this.tui.requestRender?.();
      }
      return;
    }

    // Filter typing: ordinary printable characters
    if (data.length === 1 && data >= " " && data <= "~") {
      this.query += data;
      this.sessionCursor = 0;
      this.tui.requestRender?.();
      return;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);

    // Box geometry matching OMT trajGeom / trajContentW:
    // boxW = clamp(winW - 10, 70, 150)
    let boxW = Math.max(70, Math.min(150, safeWidth - 10));
    if (safeWidth < 74) {
      boxW = Math.max(16, safeWidth - 2);
    }
    const outerW = boxW + 2;
    const paddingH = 3;
    const cw = Math.max(10, boxW - 6);

    // Two-column layout: left session names, right detail (odd cell goes to detail column)
    const leftW = Math.max(6, Math.floor((cw - 3) / 2));
    const rightW = Math.max(6, cw - 3 - leftW);

    // Dynamic height matching OMT trajWin: clamp(winH - 14, 12, 24)
    const termH =
      (this.tui as any)?.height ??
      (this.tui as any)?.rows ??
      (this.options as any)?.terminalHeight ??
      54;
    let win = termH - 14;
    if (win < 12) win = 12;
    if (win > 24) win = 24;

    const borderStyler = getBorderStyler(this.theme);
    const borderVert = borderStyler("│");
    const midSep = fgSafe(this.theme, "border", "│");

    const items = this.getFilteredSessions();
    const { start, end, hasAbove, hasBelow } = fixedWin(this.sessionCursor, items.length, win);

    // -------------------------------------------------------------------------
    // Left column: Session titles
    // -------------------------------------------------------------------------
    const leftLines: string[] = [];
    if (items.length === 0) {
      leftLines.push("  " + dimSafe(this.theme, fit("— no match —", leftW - 2)));
    } else {
      if (hasAbove) {
        leftLines.push("  " + dimSafe(this.theme, fit(`…(+${start} above)`, leftW - 2)));
      }
      for (let i = start; i < end; i++) {
        const s = items[i]!;
        const isSel = i === this.sessionCursor;
        const isCurrent =
          Boolean(s.isCurrent) ||
          s.id === this.options.currentSessionId ||
          s.path === this.options.currentSessionPath;

        let lineText: string;
        if (isSel) {
          const prefix = dimSafe(this.theme, "▸ ");
          const styledTitle = selectedDialogRow(this.theme, s.title, leftW - 2);
          lineText = `${prefix}${styledTitle}`;
        } else if (isCurrent) {
          const bullet = fgSafe(this.theme, "success", "● ");
          const plainTitle = dimSafe(this.theme, fit(s.title, leftW - 4));
          lineText = `  ${bullet}${plainTitle}`;
        } else {
          lineText = `  ${dimSafe(this.theme, fit(s.title, leftW - 2))}`;
        }
        leftLines.push(truncateToWidth(lineText, leftW, ""));
      }
      if (hasBelow) {
        leftLines.push("  " + dimSafe(this.theme, fit(`…(+${items.length - end} below)`, leftW - 2)));
      }
    }
    while (leftLines.length < win) {
      leftLines.push("  " + " ".repeat(Math.max(0, leftW - 2)));
    }

    // -------------------------------------------------------------------------
    // Right column: Detail preview (Go sessionDetail)
    // -------------------------------------------------------------------------
    const sel = items[this.sessionCursor];
    const rightLines: string[] = [];
    let totalDetailRows = 0;

    if (!sel) {
      rightLines.push("  " + dimSafe(this.theme, fit("— no session selected —", rightW - 2)));
    } else {
      const isCurrent =
        Boolean(sel.isCurrent) ||
        sel.id === this.options.currentSessionId ||
        sel.path === this.options.currentSessionPath;

      // Construct detail text matching OMT Go sessionDetail:
      // Line 1: Title
      // Line 2: N msgs · age · date
      // Line 3: shorten(Path)
      // Line 4: shorten(Cwd) (if cwd != "")
      // Line 5: "current session" (if isCurrent)
      // Line 6: "name: " + name (if name != "")
      // Line 7+: First user message (or "(no messages)")
      const dateStr = formatDate(sel.modified);
      const meta = `${sel.messageCount} msgs · ${fmtAgo(sel.modified)}${dateStr ? ` · ${dateStr}` : ""}`;
      // Keep full paths; source wraps the payload to the detail column instead
      // of replacing the filename with an ellipsis before wrapping can happen.
      const pathStr = sel.path;
      const cwdStr = sel.cwd ?? "";
      const rawPrompt = (sel.firstUserPrompt ?? sel.firstMessage ?? "").trim();
      let prompt = rawPrompt === "" ? "(no messages)" : rawPrompt;
      if (prompt.length > 600) {
        prompt = prompt.slice(0, 600) + "…";
      }

      interface DetailRow {
        text: string;
        title: boolean;
        meta: boolean;
      }
      const rawRows: DetailRow[] = [];
      rawRows.push({ text: sel.title, title: true, meta: false });
      rawRows.push({ text: meta, title: false, meta: true });
      for (const text of wrapDetailText(pathStr, rightW - 4)) rawRows.push({ text, title: false, meta: false });
      if (cwdStr) {
        for (const text of wrapDetailText(cwdStr, rightW - 4)) rawRows.push({ text, title: false, meta: false });
      }
      if (isCurrent) {
        rawRows.push({ text: "current session", title: false, meta: false });
      }
      if (sel.name && sel.name.trim() !== "") {
        rawRows.push({ text: `name: ${sel.name.trim()}`, title: false, meta: false });
      }

      // Word-wrap prompt lines
      const promptLines = wrapDetailText(prompt, rightW - 4);
      for (const pl of promptLines) {
        rawRows.push({ text: pl, title: false, meta: false });
      }

      totalDetailRows = rawRows.length;
      const shownRows = rawRows.slice(0, win);

      for (const r of shownRows) {
        const plain = fit(r.text, rightW - 4);
        let styled: string;
        if (r.title) {
          styled = boldSafe(this.theme, plain);
        } else if (r.meta) {
          styled = dimSafe(this.theme, plain);
        } else {
          styled = plain;
        }
        const padded = styled + " ".repeat(Math.max(0, rightW - 2 - visibleWidth(plain)));
        rightLines.push("  " + padded);
      }
    }
    while (rightLines.length < win) {
      rightLines.push("  " + " ".repeat(Math.max(0, rightW - 2)));
    }

    // -------------------------------------------------------------------------
    // Assemble dialog lines with rounded Unicode frame & centering
    // -------------------------------------------------------------------------
    const outLines: string[] = [];
    const padStr = " ".repeat(paddingH);
    const leftMargin = " ".repeat(Math.max(0, Math.floor((safeWidth - outerW) / 2)));

    const frameRow = (content: string): string => {
      const padded = truncateToWidth(content, cw, "");
      const fillDiff = Math.max(0, cw - visibleWidth(padded));
      return `${leftMargin}${borderVert}${padStr}${padded}${" ".repeat(fillDiff)}${padStr}${borderVert}`;
    };

    // Top border
    outLines.push(`${leftMargin}${borderStyler(`╭${"─".repeat(boxW)}╮`)}`);

    // Top padding row
    outLines.push(`${leftMargin}${borderVert}${" ".repeat(boxW)}${borderVert}`);

    // Title line: Resume session (current) or Resume session (all)
    const titleText = `Resume session (${this.scope})`;
    outLines.push(frameRow(boldSafe(this.theme, titleText)));

    // Filter input row
    const filterText = `filter: ${this.query}▌`;
    outLines.push(frameRow(dimSafe(this.theme, filterText)));

    // Blank row
    outLines.push(frameRow(" ".repeat(cw)));

    // Column header row: SESSIONS │ DETAIL
    const leftHeader = boldSafe(this.theme, fit("SESSIONS", leftW - 2));
    const rightHeader = boldSafe(this.theme, fit("DETAIL", rightW - 2));
    const headerRow = `  ${leftHeader} ${midSep}   ${rightHeader}`;
    outLines.push(frameRow(headerRow));

    // Data rows
    for (let r = 0; r < win; r++) {
      const l = leftLines[r] ?? "  " + " ".repeat(Math.max(0, leftW - 2));
      const rg = rightLines[r] ?? "  " + " ".repeat(Math.max(0, rightW - 2));
      const rowCombined = `${l} ${midSep} ${rg}`;
      outLines.push(frameRow(rowCombined));
    }

    // Skipped lines indicator if detail exceeds win
    if (totalDetailRows > win) {
      const skipped = totalDetailRows - win;
      outLines.push(frameRow(dimSafe(this.theme, `…(+${skipped} lines below: Enter resumes, detail stays in session)`)));
    }

    // Blank row
    outLines.push(frameRow(" ".repeat(cw)));

    // Footer row: Hints or active Feedback message
    let footText: string;
    if (this.feedbackText) {
      footText = boldSafe(this.theme, fgSafe(this.theme, "success", this.feedbackText));
    } else {
      let foot = "type to filter · ↑↓ select · Enter resume · Tab scope · Del delete · Esc close";
      if (items.length > 0) {
        const cur = Math.min(this.sessionCursor + 1, items.length);
        foot += ` (${cur}/${items.length} · ${this.scope})`;
      }
      footText = dimSafe(this.theme, fit(foot, cw));
    }
    outLines.push(frameRow(footText));

    // Bottom padding row
    outLines.push(`${leftMargin}${borderVert}${" ".repeat(boxW)}${borderVert}`);

    // Bottom border
    outLines.push(`${leftMargin}${borderStyler(`╰${"─".repeat(boxW)}╯`)}`);

    return outLines;
  }
}

// -----------------------------------------------------------------------------
// Public Factory & Aliases
// -----------------------------------------------------------------------------

export const OmtResumeComponent = ResumeDialogComponent;

export function createOmtResumeComponent(
  tui: TUI,
  theme: Theme,
  keybindings?: KeybindingsManager,
  done: (value?: unknown) => void = () => {},
  ctx?: ExtensionContext,
  options?: ResumeDialogOptions,
): ResumeDialogComponent {
  return new ResumeDialogComponent(tui, theme, keybindings, done, ctx, options);
}

export const createResumeDialogComponent = createOmtResumeComponent;

// -----------------------------------------------------------------------------
// Go App & RPC Source Mappings
// -----------------------------------------------------------------------------

/**
 * Maps to Go resumePickerMsg: formats parallel slices for picker options,
 * descriptions, paths, and right-column payloads.
 */
export function resumePickerMsg(
  scope: ResumeScope,
  list: ResumeSessionItem[],
  current: string,
  filter: string = "",
): {
  scope: ResumeScope;
  options: string[];
  descs: string[];
  paths: string[];
  payload: string[];
  filter: string;
} {
  const options: string[] = [];
  const descs: string[] = [];
  const paths: string[] = [];
  const payload: string[] = [];

  for (const s of list) {
    options.push(s.title);
    let desc = `${s.messageCount} msgs · ${fmtAgo(s.modified)}`;
    if (scope === scopeAll && s.cwd) {
      desc = `${shorten(s.cwd, 30)} · ${desc}`;
    }
    if (s.path === current || s.isCurrent) {
      desc = `current · ${desc}`;
    }
    descs.push(desc);
    paths.push(s.path);
    payload.push(sessionDetail(s, current));
  }

  return { scope, options, descs, paths, payload, filter };
}

/**
 * Maps to Go sessionDetail: generates multi-line string for the right-column preview.
 */
export function sessionDetail(s: ResumeSessionItem, current: string): string {
  const lines: string[] = [];
  lines.push(s.title);
  lines.push(`${s.messageCount} msgs · ${fmtAgo(s.modified)} · ${formatDate(s.modified)}`);
  lines.push(shorten(s.path, 60));
  if (s.cwd) {
    lines.push(shorten(s.cwd, 60));
  }
  if (s.path === current || s.isCurrent) {
    lines.push("current session");
  }
  if (s.name?.trim()) {
    lines.push(`name: ${s.name.trim()}`);
  }
  const tokens = extractTokens(s);
  if (tokens !== undefined || s.cost !== undefined) {
    lines.push(`tokens: ${tokens !== undefined ? formatNumber(tokens) : "—"} · cost: ${formatCost(s.cost)}`);
  }
  const first = (s.firstUserPrompt ?? s.firstMessage ?? "").trim();
  lines.push(first || "(no messages)");
  return lines.join("\n");
}

/**
 * Maps to Go resolveSessionArg: maps "/resume <arg>" to an existing session file.
 */
export function resolveSessionArg(sessions: ResumeSessionItem[], arg: string): ResumeSessionItem | undefined {
  if (!arg) return undefined;
  const trimmed = arg.trim();
  return sessions.find(
    (s) => s.path === trimmed || s.id === trimmed || s.title.toLowerCase() === trimmed.toLowerCase(),
  );
}

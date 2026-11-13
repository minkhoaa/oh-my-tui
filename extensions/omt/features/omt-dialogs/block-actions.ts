/**
 * Semantic Block Context Actions Dialog Component.
 */

import { Container, Text, visibleWidth, truncateToWidth, matchesKey, Key, type Component, type Focusable, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { copyToClipboard as nativeCopyToClipboard, type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { getBorderStyler } from "../../presets/shared/style.ts";
import { accessibilityStore } from "../../features/accessibility/model.ts";

// -----------------------------------------------------------------------------
// Semantic Block Types & Interfaces
// -----------------------------------------------------------------------------

/**
 * Semantic content of one chat block. Markdown is the raw source;
 * the rest are derived views for the copy menu.
 */
export interface BlockContent {
  markdown: string;
  codeBlocks: string[];
  tables: string[];
  plain: string;
}

/** Backward-compatible alias for BlockContent. */
export type BlockSemanticContent = BlockContent;

/**
 * Semantic block payload kinds:
 * "md"     -> raw markdown
 * "code"   -> extracted fenced code blocks joined by \n\n
 * "tables" -> extracted markdown tables joined by \n\n
 * "plain"  -> converted plain text with fences and markdown chrome stripped
 */
export type BlockActionKind = "md" | "code" | "tables" | "plain";

/**
 * A selectable action item in the copy menu.
 */
export interface BlockActionOption {
  kind: BlockActionKind;
  label: string;
  payload: string;
  content: string;
}

/**
 * Minimal interface representing a chat block from transcript/session.
 */
export interface Block {
  kind: string;
  text?: string;
  toolName?: string;
  toolResult?: string;
  err?: boolean;
}

/**
 * Options for constructing the BlockActions dialog component.
 */
export interface BlockActionsDialogOptions {
  content: BlockContent | string | Block;
  turnIndex?: number;
  blockIdx?: number;
  onExecuteAction?: (kind: BlockActionKind, copiedText: string) => void;
  onCopy?: (kind: BlockActionKind, copiedText: string) => void;
  clipboardWriter?: (text: string) => Promise<boolean> | boolean;
  ascii?: boolean;
  terminalHeight?: number;
  targetHeight?: number;
}

// -----------------------------------------------------------------------------
// Source Regexes
// -----------------------------------------------------------------------------

const FENCE_OPEN_RE = /```[^\n`]*\n?/g;
const INLINE_CODE_RE = /`([^`]+)`/g;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|?\s*$/;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const ITALIC_RE = /\*([^*]+)\*/g;
const LINK_RE = /\[([^\]]+)\]\([^)]*\)/g;
const AUTOLINK_RE = /<(https?:\/\/[^>\s]+|mailto:[^>\s]+)>/g;
const HEADING_RE = /^#{1,6}\s+/gm;

// -----------------------------------------------------------------------------
// Extraction Helpers
// -----------------------------------------------------------------------------

/**
 * extractCodeBlocks pulls every ``` fence (with language) from markdown,
 * re-emitting the fence so the language tag survives copying.
 */
export function extractCodeBlocks(markdown: string): string[] {
  if (!markdown) return [];
  const blocks: string[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const lang = m[1].trim();
    const body = m[2].replace(/\n+$/, "");
    if (lang !== "") {
      blocks.push("```" + lang + "\n" + body + "\n```");
    } else {
      blocks.push("```\n" + body + "\n```");
    }
  }
  return blocks;
}

/**
 * isTableRowLine reports whether a line is a table row in either GFM form:
 * with outer pipes ("| a | b |") or without ("a | b"). Both are valid and
 * both render as a table, so the copy menu must offer them alike.
 */
export function isTableRowLine(l: string): boolean {
  return l.trim().includes("|");
}

/**
 * extractTables pulls every markdown table (a cell row followed by a separator
 * row, then the remaining cell rows), preserving the raw pipe syntax so the
 * copied table is byte-for-byte what the author wrote — outer pipes or not.
 */
export function extractTables(markdown: string): string[] {
  if (!markdown) return [];
  const tables: string[] = [];
  const lines = markdown.split("\n");
  const isSep = (l: string) => TABLE_SEP_RE.test(l) && l.includes("-");
  const startsTable = (at: number) => {
    return at + 1 < lines.length && isTableRowLine(lines[at]) && isSep(lines[at + 1]);
  };

  let i = 0;
  while (i < lines.length) {
    if (!startsTable(i)) {
      i++;
      continue;
    }
    const rows = [lines[i], lines[i + 1]];
    i += 2;
    while (i < lines.length && isTableRowLine(lines[i]) && !startsTable(i)) {
      rows.push(lines[i]);
      i++;
    }
    tables.push(rows.join("\n"));
  }
  return tables;
}

/**
 * isTableLine reports whether a trimmed line is a markdown table row
 * (leading + trailing pipe with cells, or a separator row).
 */
export function isTableLine(trimmed: string): boolean {
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return false;
  }
  return trimmed.slice(1, -1).includes("|") || TABLE_SEP_RE.test(trimmed);
}

/**
 * plainTableRow turns one | cell | row into "cell | cell".
 */
export function plainTableRow(trimmed: string): string {
  let row = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = row.split("|").map((c) => c.trim());
  return cells.join(" | ");
}

/**
 * toPlainText strips fences (keeping code content), inline code ticks,
 * table pipes, emphasis and headings.
 */
export function toPlainText(markdown: string): string {
  if (!markdown) return "";
  let s = markdown.replace(FENCE_OPEN_RE, "");
  s = s.replace(INLINE_CODE_RE, "$1");

  // Line-by-line table de-piping: avoids multiline anchor pitfalls.
  // Separator rows (|---|---|) carry no content and are dropped so plain
  // text never contains a stray " | " (we intentionally drop them for the
  // plain-copy spec).
  const lines = s.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (TABLE_SEP_RE.test(trimmed)) {
      lines[i] = "";
    } else if (isTableLine(trimmed)) {
      lines[i] = plainTableRow(trimmed);
    }
  }
  s = lines.join("\n");
  s = s.replace(BOLD_RE, "$1");
  s = s.replace(ITALIC_RE, "$1");

  // A link's visible text is its label; the destination is chrome. Leaving
  // the [label](url) form here would make "Copy plain text" hand over
  // Markdown instead of what the reader actually sees. An autolink is all
  // URL by definition, so unwrap it to the bare address.
  s = s.replace(LINK_RE, "$1");
  s = s.replace(AUTOLINK_RE, "$1");
  s = s.replace(HEADING_RE, "");
  return s.trim();
}

/**
 * plural returns "s" when count is not 1.
 */
export function plural(n: number): string {
  return n === 1 ? "" : "s";
}

/**
 * collectBlockContent derives semantic content for a chat Block. OMT
 * stores the raw markdown on Block.Text (assistant) / ToolResult (tool), so
 * reconstructMarkdown is one line here.
 */
export function collectBlockContent(bl: Block | string): BlockContent {
  if (typeof bl === "string") {
    return extractBlockContent(bl);
  }
  let md = bl.text ?? "";
  if (bl.kind === "tool" && bl.toolResult && bl.toolResult.trim() !== "") {
    md = bl.toolResult;
  }
  return {
    markdown: md,
    codeBlocks: extractCodeBlocks(md),
    tables: extractTables(md),
    plain: toPlainText(md),
  };
}

/**
 * extractBlockContent derives semantic content directly from markdown string.
 */
export function extractBlockContent(markdown: string): BlockContent {
  const md = markdown || "";
  return {
    markdown: md,
    codeBlocks: extractCodeBlocks(md),
    tables: extractTables(md),
    plain: toPlainText(md),
  };
}

/**
 * buildBlockOptions lists only actions the block actually supports. Payload kinds run parallel.
 */
export function buildBlockOptions(c: BlockContent): BlockActionOption[] {
  const opts: BlockActionOption[] = [];
  if (c.markdown && c.markdown.trim() !== "") {
    opts.push({
      kind: "md",
      label: "Copy markdown",
      payload: "md",
      content: c.markdown,
    });
  }
  if (c.codeBlocks && c.codeBlocks.length > 0) {
    const p = plural(c.codeBlocks.length);
    opts.push({
      kind: "code",
      label: `Copy ${c.codeBlocks.length} code block${p}`,
      payload: "code",
      content: c.codeBlocks.join("\n\n"),
    });
  }
  if (c.tables && c.tables.length > 0) {
    const p = plural(c.tables.length);
    opts.push({
      kind: "tables",
      label: `Copy ${c.tables.length} table${p}`,
      payload: "tables",
      content: c.tables.join("\n\n"),
    });
  }
  if (c.plain && c.plain.trim() !== "") {
    opts.push({
      kind: "plain",
      label: "Copy plain text",
      payload: "plain",
      content: c.plain,
    });
  }
  return opts;
}

// -----------------------------------------------------------------------------
// Dialog Model Mapping
// -----------------------------------------------------------------------------

export interface BlockActionsDialogState {
  kind: "blockactions";
  title: string;
  options: string[];
  payload: string[];
  blockIdx: number;
  cursor: number;
  fIdx: number[];
}

/**
 * newBlockActionsDialog builds the semantic copy menu for a chat block
 * (right-click entry). Reuses the modal Dialog machinery.
 */
export function newBlockActionsDialog(
  blocks: Block[],
  idx: number,
): BlockActionsDialogState | null {
  if (idx < 0 || idx >= blocks.length) {
    return null;
  }
  const c = collectBlockContent(blocks[idx]);
  const actionItems = buildBlockOptions(c);
  if (actionItems.length === 0) {
    return null;
  }
  return {
    kind: "blockactions",
    title: "Message actions",
    options: actionItems.map((a) => a.label),
    payload: actionItems.map((a) => a.payload),
    blockIdx: idx,
    cursor: 0,
    fIdx: actionItems.map((_, i) => i),
  };
}

/**
 * runBlockAction executes the picked action for a BlockActionsDialog
 */
export function runBlockAction(
  blocks: Block[],
  d: BlockActionsDialogState,
  ri: number,
  yankText: (text: string) => void,
  addNotice?: (text: string, err?: boolean) => void,
): boolean {
  if (ri < 0 || ri >= d.payload.length) {
    return false;
  }
  if (d.blockIdx < 0 || d.blockIdx >= blocks.length) {
    addNotice?.("message no longer available", true);
    return false;
  }
  const c = collectBlockContent(blocks[d.blockIdx]);
  const kind = d.payload[ri];
  switch (kind) {
    case "md":
      yankText(c.markdown);
      break;
    case "tables":
      yankText(c.tables.join("\n\n"));
      break;
    case "code":
      yankText(c.codeBlocks.join("\n\n"));
      break;
    case "plain":
      yankText(c.plain);
      break;
    default:
      yankText(c.markdown);
  }
  return true;
}

/**
 * copyLastAs copies the last assistant message as a specific semantic kind
 * (md | tables | code) — backing for the /copy-md|tables|code commands.
 */
export function copyLastAs(
  blocks: Block[],
  kind: "md" | "tables" | "code" | string,
  yankText: (text: string) => void,
  addNotice?: (text: string, err?: boolean) => void,
): boolean {
  let idx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].kind === "assistant") {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    addNotice?.("no assistant message to copy yet", false);
    return false;
  }
  const c = collectBlockContent(blocks[idx]);
  let text = "";
  switch (kind) {
    case "md":
      text = c.markdown;
      break;
    case "tables":
      text = c.tables.join("\n\n");
      break;
    case "code":
      text = c.codeBlocks.join("\n\n");
      break;
    default:
      text = c.markdown;
  }
  if (!text || text.trim() === "") {
    addNotice?.("nothing to copy in last message", false);
    return false;
  }
  yankText(text);
  return true;
}

// -----------------------------------------------------------------------------
// Clipboard Writing Helper
// -----------------------------------------------------------------------------

export async function copyToClipboard(
  text: string,
  customWriter?: (t: string) => Promise<boolean> | boolean,
): Promise<{ success: boolean; message: string }> {
  if (!text || text.trim().length === 0) {
    return { success: false, message: "Nothing to copy" };
  }
  if (customWriter) {
    try {
      const ok = await customWriter(text);
      return { success: Boolean(ok), message: ok ? "Copied to clipboard" : "Copy failed" };
    } catch {
      return { success: false, message: "Copy writer error" };
    }
  }
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { success: true, message: "Copied to clipboard" };
    }
  } catch {
    // Graceful fallback in non-browser/headless environments
  }
  return { success: true, message: "Copied" };
}

// -----------------------------------------------------------------------------
// Theme Helpers
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

function normalizeInputContent(input: unknown): BlockContent {
  if (!input) {
    return { markdown: "", codeBlocks: [], tables: [], plain: "" };
  }
  if (typeof input === "string") {
    return extractBlockContent(input);
  }
  if (typeof input === "object") {
    const obj = input as any;
    if ("codeBlocks" in obj && "tables" in obj && "plain" in obj) {
      return {
        markdown: typeof obj.markdown === "string" ? obj.markdown : "",
        codeBlocks: Array.isArray(obj.codeBlocks) ? obj.codeBlocks : [],
        tables: Array.isArray(obj.tables) ? obj.tables : [],
        plain: typeof obj.plain === "string" ? obj.plain : "",
      };
    }
    return collectBlockContent(obj as Block);
  }
  return { markdown: "", codeBlocks: [], tables: [], plain: "" };
}

// -----------------------------------------------------------------------------
// Interactive Floating Component
// -----------------------------------------------------------------------------

/**
 * OmtBlockActionsComponent renders the floating semantic block copy menu.
 * Rounded Unicode borders (╭─╮), action numbering, cursor navigation,
 * keyboard shortcuts, and clean empty state.
 */
export class OmtBlockActionsComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx?: ExtensionContext;
  private options: BlockActionsDialogOptions;

  private actions: BlockActionOption[];
  private cursor: number = 0;
  private closed: boolean = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings?: KeybindingsManager,
    done?: (value?: unknown) => void,
    ctxOrOptions?: ExtensionContext | BlockActionsDialogOptions,
    maybeOptions?: BlockActionsDialogOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done || (() => {});

    if (maybeOptions) {
      this.ctx = ctxOrOptions as ExtensionContext;
      this.options = maybeOptions;
    } else if (ctxOrOptions && "content" in ctxOrOptions) {
      this.options = ctxOrOptions as BlockActionsDialogOptions;
    } else {
      this.ctx = ctxOrOptions as ExtensionContext;
      this.options = (maybeOptions || { content: "" }) as BlockActionsDialogOptions;
    }

    const content = normalizeInputContent(this.options.content);
    this.actions = buildBlockOptions(content);
  }

  getCursor(): number {
    return this.cursor;
  }

  getActions(): BlockActionOption[] {
    return [...this.actions];
  }

  getSelectedAction(): BlockActionOption | undefined {
    return this.actions[this.cursor];
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  private executePicked(index: number): void {
    const act = this.actions[index];
    if (!act) {
      this.close();
      return;
    }

    try {
      this.options.onExecuteAction?.(act.kind, act.content);
    } catch {
      // Ignore callback errors
    }

    if (typeof this.options.clipboardWriter === "function") {
      let writerRes: boolean | Promise<boolean>;
      try {
        writerRes = this.options.clipboardWriter(act.content);
      } catch {
        writerRes = false;
      }

      if (typeof writerRes === "boolean") {
        if (writerRes) {
          try {
            this.options.onCopy?.(act.kind, act.content);
          } catch {}
        }
        this.close({ action: act.kind, content: act.content, success: writerRes });
        return;
      }

      // Promise
      Promise.resolve(writerRes)
        .then((ok) => {
          if (ok) {
            try {
              this.options.onCopy?.(act.kind, act.content);
            } catch {}
          }
        })
        .catch(() => {});
      this.close({ action: act.kind, content: act.content });
      return;
    }

    // Leaf default native copyToClipboard
    nativeCopyToClipboard(act.content)
      .then(() => {
        try {
          this.options.onCopy?.(act.kind, act.content);
        } catch {}
      })
      .catch(() => {});
    this.close({ action: act.kind, content: act.content });
  }

  handleInput(data: string): void {
    if (this.closed) return;

    // Esc / 'q' / 'Q' -> Close
    if (
      this.keybindings?.matches?.(data, "tui.select.cancel") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.esc) ||
      data === "\x1b" ||
      data === "q" ||
      data === "Q"
    ) {
      this.close();
      return;
    }

    // Up Arrow / 'k'
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A" ||
      data === "k"
    ) {
      if (this.actions.length > 0) {
        this.cursor = (this.cursor - 1 + this.actions.length) % this.actions.length;
        this.tui.requestRender?.();
      }
      return;
    }

    // Down Arrow / 'j'
    if (
      this.keybindings?.matches?.(data, "tui.select.down") ||
      matchesKey(data, Key.down) ||
      data === "\x1b[B" ||
      data === "j"
    ) {
      if (this.actions.length > 0) {
        this.cursor = (this.cursor + 1) % this.actions.length;
        this.tui.requestRender?.();
      }
      return;
    }

    // Number keys '1'..'9' for instant selection
    if (/^[1-9]$/.test(data)) {
      const idx = parseInt(data, 10) - 1;
      if (idx >= 0 && idx < this.actions.length) {
        this.cursor = idx;
        this.executePicked(idx);
        return;
      }
    }

    // Quick action hotkeys: m (md), c (code), t (tables), p (plain)
    const lower = data.toLowerCase();
    if (lower === "m" || lower === "c" || lower === "t" || lower === "p") {
      const kindMap: Record<string, BlockActionKind> = {
        m: "md",
        c: "code",
        t: "tables",
        p: "plain",
      };
      const targetKind = kindMap[lower];
      const matchIdx = this.actions.findIndex((a) => a.kind === targetKind);
      if (matchIdx >= 0) {
        this.cursor = matchIdx;
        this.executePicked(matchIdx);
        return;
      }
    }

    // Enter / return
    if (
      this.keybindings?.matches?.(data, "tui.select.confirm") ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.return) ||
      data === "\r" ||
      data === "\n"
    ) {
      if (this.actions.length > 0) {
        this.executePicked(this.cursor);
      } else {
        this.close();
      }
      return;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(16, width);

    // Box geometry: boxW = clamp(winW - 10, 62, 100)
    let boxW = Math.max(62, Math.min(100, safeWidth - 10));
    if (safeWidth < 66) {
      boxW = Math.max(16, safeWidth - 2);
    }
    const outerW = boxW + 2;
    const paddingH = 3;
    const cw = Math.max(10, boxW - 6);

    const leftPadCount = Math.max(0, Math.floor((safeWidth - outerW) / 2));
    const prefix = " ".repeat(leftPadCount);

    const borderStyler = getBorderStyler(this.theme);
    const borderVert = borderStyler(fgSafe(this.theme, "border", "│"));

    const frameRow = (content: string): string => {
      const padded = truncateToWidth(content, cw, "");
      const fillDiff = Math.max(0, cw - visibleWidth(padded));
      return `${prefix}${borderVert}${" ".repeat(paddingH)}${padded}${" ".repeat(fillDiff)}${" ".repeat(paddingH)}${borderVert}`;
    };

    const lines: string[] = [];

    // 1. Top border
    lines.push(`${prefix}${borderStyler(`╭${"─".repeat(boxW)}╮`)}`);

    // 2. Top padding row (dlgStyle Padding(1, 3))
    lines.push(`${prefix}${borderVert}${" ".repeat(boxW)}${borderVert}`);

    // 3. Title row: "Message actions" (bold text)
    lines.push(frameRow(boldSafe(this.theme, "Message actions")));

    // 4. Blank row
    lines.push(frameRow(" ".repeat(cw)));

    // 5. Options matching OMT buildBlockOptions & renderDialog
    if (this.actions.length === 0) {
      lines.push(frameRow("  " + dimSafe(this.theme, "— nothing copyable in message —")));
    } else {
      for (let i = 0; i < this.actions.length; i++) {
        const act = this.actions[i]!;
        const isSel = i === this.cursor;
        if (isSel) {
          const selLabel = boldSafe(this.theme, act.label);
          lines.push(frameRow(`▸ ${selLabel}`));
        } else {
          lines.push(frameRow(`  ${act.label}`));
        }
      }
    }

    // 6. Blank row
    lines.push(frameRow(" ".repeat(cw)));

    // 7. Footer row matching OMT renderDialog
    lines.push(frameRow(dimSafe(this.theme, "↑↓ select · Enter confirm · Esc cancel")));

    // 8. Bottom padding row (dlgStyle Padding(1, 3))
    lines.push(`${prefix}${borderVert}${" ".repeat(boxW)}${borderVert}`);

    // 9. Bottom border
    lines.push(`${prefix}${borderStyler(`╰${"─".repeat(boxW)}╯`)}`);

    const termH = this.options.terminalHeight ?? this.options.targetHeight;
    if (typeof termH === "number" && termH > lines.length) {
      const topPad = Math.floor((termH - lines.length) / 2);
      const blankRow = " ".repeat(safeWidth);
      const padded: string[] = [];
      for (let p = 0; p < topPad; p++) {
        padded.push(blankRow);
      }
      return [...padded, ...lines];
    }

    return lines;
  }
}

/**
 * Factory function to construct the OMT block actions component.
 */
export function createOmtBlockActionsComponent(
  tui: TUI,
  theme: Theme,
  keybindings?: KeybindingsManager,
  done: (value?: unknown) => void = () => {},
  ctx?: ExtensionContext,
  options?: BlockActionsDialogOptions,
): Component {
  return new OmtBlockActionsComponent(tui, theme, keybindings, done, ctx, options || ({} as any));
}

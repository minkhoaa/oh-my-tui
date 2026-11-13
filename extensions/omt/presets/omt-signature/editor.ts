/**
 * Signature editor framing and statusline rendering.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, renderFakeCursor, sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import type { EditorRenderData } from "../shared/types.ts";
import { signatureFg, type SignatureColorRole } from "./rendering.ts";
import { accessibilityStore, asciiBorder } from "../../features/accessibility/model.ts";
import { omtStyle } from "../shared/style.ts";
import { truncateToDisplayWidth } from "./primitives.ts";

export interface SignatureEditorOptions {
  framed?: boolean;
  role?: SignatureColorRole;
  title?: string;
  status?: string;
  statusline?: string;
  hints?: string;
  stats?: string;
  focused?: boolean;
  placeholder?: string;
  scrollStart?: number;
}

export interface SignatureStatuslineData {
  model?: string;
  agent?: string;
  contextUsage?: { percent?: number | null; contextWindow?: number };
  totalTokens?: number;
  cost?: number;
  extStat?: string;
  hints?: string;
  isStreaming?: boolean;
  isThinking?: boolean;
  escArmed?: boolean;
  shellOn?: boolean;
  branchSummarizing?: boolean;
  compacting?: boolean;
}

export function formatSignatureStatsLine(data: SignatureStatuslineData): string {
  const model = data.model || "no model";
  const agent = data.agent ? ` · @${truncateToDisplayWidth(data.agent, 20, "…")}` : "";
  const pct = typeof data.contextUsage?.percent === "number" && Number.isFinite(data.contextUsage.percent)
    ? data.contextUsage.percent
    : 0;
  const tokens = typeof data.totalTokens === "number" && Number.isFinite(data.totalTokens) && data.totalTokens > 0
    ? data.totalTokens
    : 0;
  const cost = typeof data.cost === "number" && Number.isFinite(data.cost) && data.cost > 0
    ? data.cost
    : 0;

  const fmtNum = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(Math.round(n));
  };

  let stats = "";
  if (pct > 0) {
    stats = `${truncateToDisplayWidth(model, 30, "…")}${agent} · ${Math.round(pct)}% · ${fmtNum(tokens)} · $${cost.toFixed(2)}`;
  } else if (cost > 0 || tokens > 0) {
    stats = `${truncateToDisplayWidth(model, 30, "…")}${agent} · ${fmtNum(tokens)} · $${cost.toFixed(2)}`;
  } else {
    stats = truncateToDisplayWidth(model, 40, "…") + agent;
  }

  if (data.extStat) {
    stats = `${truncateToDisplayWidth(data.extStat, 30, "…")} · ${stats}`;
  }
  return stats;
}

export function formatSignatureHints(data: SignatureStatuslineData): string {
  if (data.shellOn) {
    return "↵ run · ↑↓ history · ^V paste · ^C clear/quit · Esc exit";
  }
  if (data.branchSummarizing) {
    return "Esc cancels";
  }
  if (data.compacting) {
    if (data.isThinking || data.isStreaming) {
      return data.escArmed ? "press Esc again to cancel" : "↵ steer · ⌥↵ follow-up · Esc×2 cancel";
    }
    return "↵ send · / commands · @ files · ^P model · ^C quit";
  }
  if (data.isThinking || data.isStreaming) {
    return data.escArmed ? "press Esc again to cancel" : "↵ steer · ⌥↵ follow-up · Esc×2 cancel";
  }
  return data.hints ?? "↵ send · / commands · @ files · ^P model · ^C quit";
}

export interface SignatureEditorBorderOptions {
  position?: "top" | "bottom";
  framed?: boolean;
  title?: string;
  status?: string;
  role?: SignatureColorRole;
  width?: number;
}

export interface SignatureEditorStatuslineOptions {
  left?: string;
  right?: string;
  framed?: boolean;
  role?: SignatureColorRole;
  useAscii?: boolean;
}

/**
 * Format embedded statusline indicators below the editor or inside the input box frame.
 * Hints yield to stats when space is tight; output stays strictly within width columns.
 */
export function signatureEditorStatusline(
  theme: Theme,
  width: number,
  options?: SignatureEditorStatuslineOptions,
): string {
  const innerW = Math.max(0, width - 4);
  const framed = options?.framed ?? false;
  const role = options?.role ?? "input";
  const useAscii = options?.useAscii ?? accessibilityStore.isPlainTextAsciiBorders();
  const borderCh = useAscii ? "|" : "│";

  let right = options?.right ?? "";
  let left = options?.left ?? "";

  // Hints yield to stats when viewport is constrained
  right = truncateToDisplayWidth(right, innerW, "…");
  const room = innerW - visibleWidth(right) - 1;
  if (room <= 0) {
    left = "";
  } else {
    left = truncateToDisplayWidth(left, room, "…");
  }

  // Gap calculation and statusBarStyle rendering
  const gap = Math.max(0, innerW - visibleWidth(left) - visibleWidth(right));
  const text = left + " ".repeat(gap) + right;
  const styledText = signatureFg(theme, "muted", text);

  if (framed) {
    // Wrap line with border edges: │ content │
    const leftBorder = signatureFg(theme, role, borderCh + " ");
    const rightBorder = signatureFg(theme, role, " " + borderCh);
    return leftBorder + styledText + rightBorder;
  }

  const pad = " ".repeat(2);
  return pad + styledText + pad;
}

/**
 * Decorate Signature editor body rows with side borders.
 *
 * In Pi's native architecture:
 * Replaces ONLY proven reserved blank chrome cells in columns 0 and width - 1
 * when framed presentation is enabled.
 * Preserves native Pi cursor positioning, IME markers, multiline editing, autocomplete list, and paste.
 */
export function signatureEditor(
  theme: Theme,
  { lines, width, boxHeight, padding, text }: EditorRenderData,
  options?: SignatureEditorOptions,
): string[] {
  if (!options?.framed) return lines;
  if (width < omtStyle.minWidth || padding < 2) return lines;
  const useAscii = accessibilityStore.isPlainTextAsciiBorders();
  const borderCh = useAscii ? "|" : "│";
  const role = options?.role ?? "input";
  const leftBorder = signatureFg(theme, role, borderCh);
  const rightBorder = signatureFg(theme, role, borderCh);
  const focused = options?.focused ?? false;
  const scrollStart = options?.scrollStart ?? 0;
  const placeholderText = options?.placeholder ?? "Type a message… (/ commands · ^V paste)";
  const isEmpty = !text || text.length === 0;

  return lines.map((line, row) => {
    // Only decorate visible editor content rows:
    // row 0 is top border, row boxHeight - 1 is bottom border,
    // row >= boxHeight are autocomplete dropdown rows.
    if (row <= 0 || row >= boxHeight - 1) return line;

    const bodyRow = row - 1;
    const isVisualLineZero = scrollStart + bodyRow === 0;

    if (isEmpty) {
      if (isVisualLineZero) {
        const promptGlyph = signatureFg(theme, focused ? "input" : "muted", "❯");
        const prompt = promptGlyph + " ";
        const innerW = Math.max(10, width - 4);
        const maxPlaceholderW = Math.max(1, innerW - 2);
        const linePlaceholder = sliceByColumn(placeholderText, 0, maxPlaceholderW);
        let textPart = "";
        if (focused) {
          const firstGrapheme = linePlaceholder.slice(0, 1) || " ";
          const restPlaceholder = linePlaceholder.slice(firstGrapheme.length);
          const cursorStr = renderFakeCursor(firstGrapheme);
          const restStyled = signatureFg(theme, "muted", restPlaceholder);
          textPart = CURSOR_MARKER + cursorStr + restStyled;
        } else {
          textPart = signatureFg(theme, "muted", linePlaceholder);
        }
        const fillLen = Math.max(0, width - 5 - visibleWidth(linePlaceholder));
        return leftBorder + " " + prompt + textPart + " ".repeat(fillLen) + rightBorder;
      } else {
        const innerW = Math.max(10, width - 4);
        const maxPlaceholderW = Math.max(1, innerW - 2);
        let continuationText = "";
        if (visibleWidth(placeholderText) > maxPlaceholderW && bodyRow === 1) {
          continuationText = sliceByColumn(placeholderText, maxPlaceholderW, maxPlaceholderW);
        }
        if (continuationText) {
          const contStyled = signatureFg(theme, "muted", continuationText);
          const fillLen = Math.max(0, width - 5 - visibleWidth(continuationText));
          return leftBorder + "   " + contStyled + " ".repeat(fillLen) + rightBorder;
        }
        return leftBorder + " ".repeat(width - 2) + rightBorder;
      }
    }

    // Check visible width matches viewport width
    if (visibleWidth(line) !== width) return line;

    if (line.startsWith("    ") && line.endsWith(" ")) {
      const prompt = isVisualLineZero
        ? signatureFg(theme, focused ? "input" : "muted", "❯") + " "
        : "  ";
      return leftBorder + " " + prompt + line.slice(4, -1) + rightBorder;
    }

    // Replace column 0 and column width - 1 ONLY if they are proven reserved blank chrome cells.
    if (!line.startsWith(" ") || !line.endsWith(" ")) return line;

    // Never overwrite CURSOR_MARKER or adjacent cursor positioning (hardware IME candidate placement)
    if (line.includes(CURSOR_MARKER)) {
      if (line.startsWith(CURSOR_MARKER) || line.endsWith(CURSOR_MARKER)) return line;
    }

    return leftBorder + line.slice(1, -1) + rightBorder;
  });
}

/**
 * Format editor border line in signature border color with optional rounded corners.
 *
 * Rounded corners replace only proven reserved blank border cells (─ / -)
 * when framed presentation is enabled, preserving scroll overflow markers (↑/↓),
 * status indicators, and exact column counts without text clipping or horizontal overflow.
 */
export function signatureEditorBorder(
  theme: Theme,
  border: string,
  optionsOrPosition?: "top" | "bottom" | SignatureEditorBorderOptions,
): string {
  const opts: SignatureEditorBorderOptions =
    typeof optionsOrPosition === "string"
      ? { position: optionsOrPosition, framed: false }
      : optionsOrPosition ?? { framed: false };

  const role = opts.role ?? "input";

  if (!opts.framed) {
    return signatureFg(theme, role, border);
  }

  const useAscii = accessibilityStore.isPlainTextAsciiBorders();
  const isBottom = opts.position === "bottom" || (!opts.position && border.includes("↓"));

  const leftCorner = useAscii ? "+" : isBottom ? "╰" : "╭";
  const rightCorner = useAscii ? "+" : isBottom ? "╯" : "╮";
  const horiz = useAscii ? "-" : "─";

  // If explicit title or status was provided in options for top border
  const explicitTitle = opts.title ?? opts.status;
  if (!isBottom && explicitTitle) {
    const targetW = opts.width ?? (border.length > 0 ? visibleWidth(border) : omtStyle.minWidth);
    const innerW = Math.max(10, targetW - 4);
    const title = truncateToDisplayWidth(explicitTitle, innerW - 1, "…");
    const fill = Math.max(0, innerW - visibleWidth(title) - 1);
    const prefix = leftCorner + horiz + " ";
    const suffix = " " + horiz.repeat(fill) + rightCorner;
    return (
      signatureFg(theme, role, prefix) +
      signatureFg(theme, "muted", title) +
      signatureFg(theme, role, suffix)
    );
  }

  if (border.length < 2) return signatureFg(theme, role, border);

  const firstChar = border[0] ?? "";
  const lastChar = border[border.length - 1] ?? "";

  const start = firstChar === "─" || firstChar === "-" ? leftCorner : firstChar;
  const end = lastChar === "─" || lastChar === "-" ? rightCorner : lastChar;
  const middle = useAscii ? asciiBorder(border.slice(1, -1)) : border.slice(1, -1);

  // If border already contains an embedded title/statusline indicator (e.g. "── Working... 7s ──────")
  // Frame prefix "╭─ " + statusBarStyle(title) + frame suffix " ───╮"
  const titleMatch = border.match(/^([─\-]{1,2}\s+)(.+?)(\s+[─\-]+)$/);
  if (!isBottom && titleMatch && !border.includes("↑") && !border.includes("↓")) {
    const targetWidth = opts.width ?? visibleWidth(border);
    const prefix = leftCorner + horiz + " ";
    // Native status can have extra leading padding. Rebuild against the whole
    // border width, not the old suffix after the title regexp consumed padding.
    const titleText = truncateToDisplayWidth(titleMatch[2] ?? "", Math.max(0, targetWidth - 5), "…");
    const fillCount = Math.max(0, targetWidth - visibleWidth(prefix) - visibleWidth(titleText) - 2);
    const suffix = " " + horiz.repeat(fillCount) + rightCorner;
    return (
      signatureFg(theme, role, prefix) +
      signatureFg(theme, "muted", titleText) +
      signatureFg(theme, role, suffix)
    );
  }

  return signatureFg(theme, role, start + middle + end);
}

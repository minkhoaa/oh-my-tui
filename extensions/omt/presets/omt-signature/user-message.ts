import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { UserMessageLayout } from "../shared/user-message.ts";
import { signatureFg } from "./rendering.ts";

/**
 * OMT user message presentation:
 *   - Rounded border ╭─╮ ╰─╯ in cBorder
 *   - Padding(0, 1) inside the box
 *   - Foreground(cText)
 * Wrapped with gutter:
 *   - First line:   ● ╭───────╮ (bullet in cMuted, top border in cBorder)
 *   - Content lines:  │ text  │ (2-space gutter + border + padding)
 *   - Bottom line:    ╰───────╯ (2-space gutter + bottom border in cBorder)
 * Preserves Pi shell integration escape sequences (OSC 133).
 */
export function signatureUserMessage(
  width: number,
  native: number,
  theme?: Theme,
): UserMessageLayout {
  if (width < 10) {
    return {
      padding: native,
      width,
      key: `signature:narrow:${theme?.appearance ?? "dark"}`,
    };
  }

  // Width allocation matching OMT:
  // transcript width w, content width cw = w - 2 (2 cells for gutter)
  // userStyle box width = cw (w - 2)
  // box padding (0, 1) and borders (2 cells) leave innerWidth = cw - 4 = w - 6
  const boxWidth = Math.max(4, width - 2);
  const innerWidth = Math.max(1, boxWidth - 4);
  const padding = 0;

  return {
    padding,
    width: innerWidth,
    key: `signature:${theme?.appearance ?? "dark"}:${theme?.getColorMode ? theme.getColorMode() : "truecolor"}`,
    style: {
      color: (text) => (theme ? signatureFg(theme, "text", text) : text),
      bgColor: (text) => text,
    },
    decorate(rows) {
      if (rows.length === 0) return rows;

      // Extract terminal shell integration escapes if present
      const startOsc = rows[0]?.match(/(\x1b\]133;[^\x07\x1b]*(?:\x07|\x1b\\))+/)?.[0] ?? "";
      const endOsc = rows[rows.length - 1]?.match(/(\x1b\]133;[^\x07\x1b]*(?:\x07|\x1b\\))+/)?.[0] ?? "";

      const border = (s: string) => (theme ? signatureFg(theme, "border", s) : s);
      const icon = theme ? signatureFg(theme, "muted", "●") : "●";

      // Extract raw text lines from child render (excluding OSC padding rows)
      const contentRows = rows.length > 2
        ? rows.slice(1, rows.length - 1)
        : rows.length === 2
          ? (/^\x1b\]133;[^\x07\x1b]*(?:\x07|\x1b\\)/.test(rows[0] ?? "") ? [rows[1]!] : rows)
          : rows.length === 1
            ? rows
            : [];

      // Top border row with gutter icon (gutterBox: icon + " " + topBorder)
      const topBorder = border("╭" + "─".repeat(Math.max(0, boxWidth - 2)) + "╮");
      const firstLine = truncateToWidth(startOsc + icon + " " + topBorder, width, "");

      // Content rows (gutterBox: "  " + line)
      const midLines: string[] = [];
      for (const rawLine of contentRows) {
        const clean = rawLine.replace(/\x1b\[4[89][^m]*m/g, "");
        const truncated = truncateToWidth(clean, innerWidth, "…");
        const vis = visibleWidth(truncated);
        const padRight = Math.max(0, innerWidth - vis);
        const paddedContent = truncated + " ".repeat(padRight);
        const framedLine = "  " + border("│") + " " + paddedContent + " " + border("│");
        midLines.push(truncateToWidth(framedLine, width, ""));
      }

      // Bottom border row (gutterBox: "  " + bottomBorder)
      const bottomBorder = border("╰" + "─".repeat(Math.max(0, boxWidth - 2)) + "╯");
      const lastLine = truncateToWidth("  " + bottomBorder + endOsc, width, "");

      return [firstLine, ...midLines, lastLine];
    },
  };
}

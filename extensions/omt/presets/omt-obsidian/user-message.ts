import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { UserMessageLayout } from "../shared/user-message.ts";
import { signatureFg } from "./rendering.ts";
import { resolveRailGlyph } from "../../core/theme-tokens.ts";

/**
 * OMT Signature user message presentation:
 *   - Left-Rail Spine architecture: replaces legacy 4-sided box layout (╭─╮, │...│, ╰─╯).
 *   - Drops topBorder and bottomBorder rows entirely.
 *   - Reclaims 4+ columns: boxWidth = width, innerWidth = width - 2 (gutter + space).
 *   - Single left-rail spine ("▎ content") colored cyan (active state) via resolveRailColor("active").
 *   - Preserves Pi shell integration escape sequences (OSC 133).
 */
export function obsidianUserMessage(
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

  // Reclaim 4+ columns: width allocation with left-rail spine
  const innerWidth = Math.max(1, width - 2);
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

      const spineGlyph = resolveRailGlyph("block");
      const spine = theme ? signatureFg(theme, "cyan", spineGlyph) : spineGlyph;

      // Extract raw text lines from child render (excluding OSC padding rows)
      const contentRows: string[] = [];
      for (const row of rows) {
        const withoutOsc = row.replace(/(\x1b\]133;[^\x07\x1b]*(?:\x07|\x1b\\))+/g, "");
        if (withoutOsc.trim().length > 0 || rows.length === 1) {
          contentRows.push(withoutOsc);
        }
      }

      if (contentRows.length === 0) {
        return [truncateToWidth(`${startOsc}${spine} ${endOsc}`, width, "")];
      }

      const formatted: string[] = [];
      for (let i = 0; i < contentRows.length; i++) {
        const rawLine = contentRows[i]!;
        const clean = rawLine.replace(/\x1b\[4[89][^m]*m/g, "");
        const truncated = truncateToWidth(clean, innerWidth, "…");
        const lineOscStart = i === 0 ? startOsc : "";
        const lineOscEnd = i === contentRows.length - 1 ? endOsc : "";
        formatted.push(truncateToWidth(`${lineOscStart}${spine} ${truncated}${lineOscEnd}`, width, ""));
      }

      return formatted;
    },
  };
}

export { obsidianUserMessage as signatureUserMessage };


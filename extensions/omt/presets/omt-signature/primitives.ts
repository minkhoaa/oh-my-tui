import type { Theme } from "@earendil-works/pi-coding-agent";
import { indexedColor, rgbColor, sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type PaletteSpec, type ResolvedPalette, parseColorSpec } from "./palette.ts";
import { ansiBackground } from "../shared/rendering.ts";

export const BLOCK_MIN_WIDTH = 20;
export const BLOCK_CHROME = 4;
export const SIDEBAR_WIDTH = 34;
export const SIDEBAR_INNER_WIDTH = 30;

export const DIFF_ADD_BG = "#1f3d24";
export const DIFF_ADD_FG = "#d6f5dc";
export const DIFF_DEL_BG = "#4a2026";
export const DIFF_DEL_FG = "#f8d7da";

const spacePad = "                                                                "; // 64 spaces

export function spaces(n: number): string {
  if (n <= 0) return "";
  if (n <= spacePad.length) return spacePad.slice(0, n);
  return " ".repeat(n);
}

export function escapeLen(s: string): number {
  if (s.length < 2 || s.charCodeAt(0) !== 0x1b) return 0;
  const c1 = s.charCodeAt(1);
  if (c1 === 0x5b) {
    // CSI: parameter bytes, intermediate bytes, final byte
    let i = 2;
    while (i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x3f) i++;
    while (i < s.length && s.charCodeAt(i) >= 0x20 && s.charCodeAt(i) <= 0x2f) i++;
    if (i < s.length && s.charCodeAt(i) >= 0x40 && s.charCodeAt(i) <= 0x7e) return i + 1;
    return 0;
  }
  if (c1 === 0x5d || c1 === 0x50 || c1 === 0x58 || c1 === 0x5e || c1 === 0x5f) {
    // String sequences up to BEL or ST (ESC \)
    for (let i = 2; i < s.length; i++) {
      if (s.charCodeAt(i) === 0x07) return i + 1;
      if (s.charCodeAt(i) === 0x1b && i + 1 < s.length && s.charCodeAt(i + 1) === 0x5c) return i + 2;
    }
    return 0;
  }
  if (c1 >= 0x20 && c1 <= 0x2f) {
    let i = 1;
    while (i < s.length && s.charCodeAt(i) >= 0x20 && s.charCodeAt(i) <= 0x2f) i++;
    if (i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x7e) return i + 1;
    return 0;
  }
  if (c1 >= 0x30 && c1 <= 0x7e) {
    return 2;
  }
  return 0;
}

export function displayWidth(s: string): number {
  return visibleWidth(s);
}

export function truncateToDisplayWidth(s: string, width: number, ellipsis: string = "…"): string {
  if (width <= 0) return "";
  const sw = visibleWidth(s);
  if (sw <= width) return s;
  const ew = visibleWidth(ellipsis);
  if (width <= ew) {
    return sliceByColumn(ellipsis, 0, width);
  }
  if (!s.includes("\x1b")) {
    let cells = 0;
    let res = "";
    for (const char of s) {
      const cw = visibleWidth(char);
      if (cells + cw > width - ew) break;
      cells += cw;
      res += char;
    }
    return res + ellipsis;
  }
  return truncateToWidth(s, width, ellipsis);
}

export function padToDisplayWidth(s: string, width: number): string {
  const sw = visibleWidth(s);
  if (sw >= width) return s;
  return s + spaces(width - sw);
}

export function fitToDisplayWidth(s: string, width: number, ellipsis: string = "…"): string {
  if (width <= 0) return "";
  const sw = visibleWidth(s);
  if (sw === width) return s;
  if (sw < width) return s + spaces(width - sw);
  return truncateToDisplayWidth(s, width, ellipsis);
}

export function joinVerticalLeft(blocks: string[]): string {
  if (blocks.length === 0) return "";
  if (blocks.length === 1) return blocks[0]!;

  const split: string[][] = [];
  const widths: number[][] = [];
  let maxWidth = 0;

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i]!.split("\n");
    split.push(lines);
    const lineW = lines.map((l) => visibleWidth(l));
    widths.push(lineW);
    for (const w of lineW) {
      if (w > maxWidth) maxWidth = w;
    }
  }

  const out: string[] = [];
  for (let i = 0; i < split.length; i++) {
    const block = split[i]!;
    const blockW = widths[i]!;
    for (let j = 0; j < block.length; j++) {
      const line = block[j]!;
      const pad = maxWidth - blockW[j]!;
      out.push(pad > 0 ? line + spaces(pad) : line);
    }
  }
  return out.join("\n");
}

export function joinHorizontalTop(blocks: string[]): string {
  if (blocks.length === 0) return "";
  if (blocks.length === 1) return blocks[0]!;

  const split: string[][] = [];
  const colWidths: number[] = [];
  let maxHeight = 0;

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i]!.split("\n");
    split.push(lines);
    if (lines.length > maxHeight) maxHeight = lines.length;
    let colMax = 0;
    for (const l of lines) {
      const w = visibleWidth(l);
      if (w > colMax) colMax = w;
    }
    colWidths.push(colMax);
  }

  const rows: string[] = [];
  for (let row = 0; row < maxHeight; row++) {
    let rowStr = "";
    for (let i = 0; i < split.length; i++) {
      const block = split[i]!;
      const colW = colWidths[i]!;
      if (row < block.length) {
        const line = block[row]!;
        const lw = visibleWidth(line);
        const pad = colW - lw;
        rowStr += pad > 0 ? line + spaces(pad) : line;
      } else {
        rowStr += spaces(colW);
      }
    }
    rows.push(rowStr);
  }
  return rows.join("\n");
}

export function specToColor(spec: PaletteSpec, mode?: string) {
  if (mode === "256color") {
    return indexedColor(spec.ansi256);
  }
  return rgbColor(...spec.rgb);
}

export function fillSeq(theme: Theme, color: PaletteSpec | string): string {
  const mode = typeof theme.getColorMode === "function" ? theme.getColorMode() : "truecolor";
  if ((mode as string) === "monochrome" || (mode as string) === "16color") {
    return "";
  }
  const spec: PaletteSpec = typeof color === "string" ? parseColorSpec(color) : color;
  if (!spec.raw && spec.rgb[0] === 0 && spec.rgb[1] === 0 && spec.rgb[2] === 0) {
    return "";
  }
  if (mode === "256color") {
    return `\x1b[48;5;${spec.ansi256}m`;
  }
  const [r, g, b] = spec.rgb;
  return `\x1b[48;2;${r};${g};${b}m`;
}

export function fillRow(row: string, seq: string): string {
  if (!seq || !row) return row;
  return seq + row.replaceAll("\x1b[0m", "\x1b[0m" + seq) + "\x1b[0m";
}

export function sgrPrefix(
  theme: Theme,
  style: {
    fg?: PaletteSpec | string;
    bg?: PaletteSpec | string;
    bold?: boolean;
    italic?: boolean;
  },
): string {
  const mode = typeof theme.getColorMode === "function" ? theme.getColorMode() : "truecolor";
  if ((mode as string) === "monochrome") {
    let s = "";
    if (style.bold) s += "\x1b[1m";
    if (style.italic) s += "\x1b[3m";
    return s;
  }

  let prefix = "";
  if (style.bold) prefix += "\x1b[1m";
  if (style.italic) prefix += "\x1b[3m";

  if (style.fg) {
    const spec = typeof style.fg === "string" ? parseColorSpec(style.fg) : style.fg;
    if (mode === "256color") {
      prefix += `\x1b[38;5;${spec.ansi256}m`;
    } else {
      const [r, g, b] = spec.rgb;
      prefix += `\x1b[38;2;${r};${g};${b}m`;
    }
  }

  if (style.bg) {
    const bgSeq = fillSeq(theme, style.bg);
    prefix += bgSeq;
  }

  return prefix;
}

export function paintRow(
  content: string,
  width: number,
  style: {
    fg?: PaletteSpec | string;
    bg?: PaletteSpec | string;
    bold?: boolean;
    italic?: boolean;
  },
  theme: Theme,
): string {
  const padded = padToDisplayWidth(content, width);
  const pre = sgrPrefix(theme, style);
  if (!pre) return padded;

  // Re-open style after every reset
  const withStyle = pre + padded.replaceAll("\x1b[0m", "\x1b[0m" + pre) + "\x1b[0m";
  return withStyle;
}

export function diffMarker(line: string): string {
  const b = line.trimStart();
  if (!b) return "";
  if (b.startsWith("+++") || b.startsWith("---") || b.startsWith("@@")) {
    return "";
  }
  if (b[0] === "+" || b[0] === "-") {
    return b[0];
  }
  const spaceIdx = b.indexOf(" ");
  if (spaceIdx > 0) {
    const first = b.slice(0, spaceIdx);
    const rest = b.slice(spaceIdx).trimStart();
    if (/^\d+$/.test(first) && rest.length > 0) {
      if (rest[0] === "+" || rest[0] === "-") {
        return rest[0];
      }
    }
  }
  return "";
}

export function formatDiffLine(line: string, width: number, theme: Theme): string {
  const mode = typeof theme.getColorMode === "function" ? theme.getColorMode() : "truecolor";
  const marker = diffMarker(line);
  const padded = padToDisplayWidth(line, width);

  if ((mode as string) === "monochrome" || (mode as string) === "16color") {
    if (marker === "+") return theme.style(padded, { fg: "success" });
    if (marker === "-") return theme.style(padded, { fg: "error" });
    return padded;
  }

  if (marker === "+") {
    const addBg = parseColorSpec(DIFF_ADD_BG);
    const addFg = parseColorSpec(DIFF_ADD_FG);
    return paintRow(padded, width, { bg: addBg, fg: addFg }, theme);
  }

  if (marker === "-") {
    const delBg = parseColorSpec(DIFF_DEL_BG);
    const delFg = parseColorSpec(DIFF_DEL_FG);
    return paintRow(padded, width, { bg: delBg, fg: delFg }, theme);
  }

  return padded;
}

export function selRow(
  content: string,
  width: number,
  focused: boolean,
  palette: ResolvedPalette,
  theme: Theme,
): { mark: string; styledRow: string } {
  const mark = theme.style("▸ ", { fg: specToColor(palette.accent, theme.getColorMode?.()), bold: true });
  const rowW = Math.max(1, width - 2);

  const style = focused
    ? { bg: palette.hiBg, fg: palette.hiFg, bold: true }
    : { bg: palette.hiBg, fg: palette.accent, bold: true };

  const styledRow = paintRow(content, rowW, style, theme);
  return { mark, styledRow };
}

export function blockInner(width: number): number {
  const w = width < BLOCK_MIN_WIDTH ? BLOCK_MIN_WIDTH : width;
  return w - BLOCK_CHROME;
}

export function framedBlock(
  rows: string[],
  width: number,
  blockTheme: { frame: PaletteSpec; fill: PaletteSpec },
  theme: Theme,
  options?: { ascii?: boolean },
): string {
  const w = Math.max(width, BLOCK_MIN_WIDTH);
  const innerW = w - BLOCK_CHROME;
  const isAscii = Boolean(options?.ascii);

  const topLeft = isAscii ? "+" : "╭";
  const topRight = isAscii ? "+" : "╮";
  const bottomLeft = isAscii ? "+" : "╰";
  const bottomRight = isAscii ? "+" : "╯";
  const horiz = isAscii ? "-" : "─";
  const vert = isAscii ? "|" : "│";

  const seq = fillSeq(theme, blockTheme.fill);
  const frameColor = specToColor(blockTheme.frame, theme.getColorMode?.());

  const styleFrame = (str: string) => {
    let res = theme.style(str, { fg: frameColor });
    if (seq) {
      res = seq + res.replaceAll("\x1b[0m", "\x1b[0m" + seq) + "\x1b[0m";
    }
    return res;
  };

  const topBorder = styleFrame(topLeft + horiz.repeat(w - 2) + topRight);
  const bottomBorder = styleFrame(bottomLeft + horiz.repeat(w - 2) + bottomRight);

  const outLines: string[] = [topBorder];

  for (const rawRow of rows) {
    const wrappedLines: string[] = [];
    if (visibleWidth(rawRow) <= innerW) {
      wrappedLines.push(rawRow);
    } else {
      // Split/wrap long lines to innerW
      let remaining = rawRow;
      while (remaining.length > 0 && visibleWidth(remaining) > innerW) {
        const chunk = sliceByColumn(remaining, 0, innerW);
        if (!chunk) break;
        wrappedLines.push(chunk);
        const remW = visibleWidth(remaining);
        remaining = sliceByColumn(remaining, innerW, Math.max(1, remW));
      }
      if (remaining.length > 0) {
        wrappedLines.push(remaining);
      }
    }

    for (const r of wrappedLines) {
      const paddedContent = padToDisplayWidth(r, innerW);
      const paintedContent = fillRow(paddedContent, seq);
      const leftEdge = styleFrame(vert + " ");
      const rightEdge = styleFrame(" " + vert);
      outLines.push(leftEdge + paintedContent + rightEdge);
    }
  }

  outLines.push(bottomBorder);
  return outLines.join("\n");
}

export function inputBox(
  title: string,
  lines: string[],
  innerWidth: number,
  borderColor: PaletteSpec | string,
  theme: Theme,
  options?: { ascii?: boolean },
): string {
  const isAscii = Boolean(options?.ascii);
  const spec = typeof borderColor === "string" ? parseColorSpec(borderColor) : borderColor;
  const frameColor = specToColor(spec, theme.getColorMode?.());

  const topLeft = isAscii ? "+" : "╭";
  const topRight = isAscii ? "+" : "╮";
  const bottomLeft = isAscii ? "+" : "╰";
  const bottomRight = isAscii ? "+" : "╯";
  const horiz = isAscii ? "-" : "─";
  const vert = isAscii ? "|" : "│";

  const frame = (s: string) => theme.style(s, { fg: frameColor });

  let top = "";
  if (!title) {
    top = frame(topLeft + horiz.repeat(innerWidth + 2) + topRight);
  } else {
    const t = truncateToDisplayWidth(title, innerWidth - 1);
    const tw = visibleWidth(t);
    const fill = Math.max(0, innerWidth - tw - 1);
    top = frame(topLeft + horiz + " ") + theme.style(t, { fg: "muted" }) + frame(" " + horiz.repeat(fill) + topRight);
  }

  const out: string[] = [top];
  for (const ln of lines) {
    // Pad to innerWidth
    const wln = fitToDisplayWidth(ln, innerWidth);
    out.push(frame(vert + " ") + wln + frame(" " + vert));
  }

  out.push(frame(bottomLeft + horiz.repeat(innerWidth + 2) + bottomRight));
  return out.join("\n");
}

export function inputBoxCentered(
  title: string,
  lines: string[],
  innerWidth: number,
  borderColor: PaletteSpec | string,
  theme: Theme,
  options?: { ascii?: boolean },
): string {
  const isAscii = Boolean(options?.ascii);
  const spec = typeof borderColor === "string" ? parseColorSpec(borderColor) : borderColor;
  const frameColor = specToColor(spec, theme.getColorMode?.());

  const topLeft = isAscii ? "+" : "╭";
  const topRight = isAscii ? "+" : "╮";
  const bottomLeft = isAscii ? "+" : "╰";
  const bottomRight = isAscii ? "+" : "╯";
  const horiz = isAscii ? "-" : "─";
  const vert = isAscii ? "|" : "│";

  const frame = (s: string) => theme.style(s, { fg: frameColor });

  const t = truncateToDisplayWidth(title, Math.max(1, innerWidth - 4));
  const tw = visibleWidth(t);
  const left = Math.max(1, Math.floor((innerWidth - tw) / 2));
  const right = Math.max(1, innerWidth - tw - left);

  const top =
    frame(topLeft + horiz.repeat(left) + " ") +
    theme.style(t, { fg: "muted" }) +
    frame(" " + horiz.repeat(right) + topRight);

  const out: string[] = [top];
  for (const ln of lines) {
    const wln = fitToDisplayWidth(ln, innerWidth);
    out.push(frame(vert + " ") + wln + frame(" " + vert));
  }

  out.push(frame(bottomLeft + horiz.repeat(innerWidth + 2) + bottomRight));
  return out.join("\n");
}

export function dividerRow(
  innerWidth: number,
  label: string,
  borderSpec: PaletteSpec | string,
  theme: Theme,
  options?: { ascii?: boolean },
): string {
  const isAscii = Boolean(options?.ascii);
  const horiz = isAscii ? "-" : "─";
  const spec = typeof borderSpec === "string" ? parseColorSpec(borderSpec) : borderSpec;
  const frameColor = specToColor(spec, theme.getColorMode?.());

  let head = horiz.repeat(3) + " " + label + " ";
  const hw = visibleWidth(head);
  if (innerWidth > hw) {
    head += horiz.repeat(innerWidth - hw);
  }
  return theme.style(head, { fg: frameColor });
}

export function renderResultRows(
  rows: string[],
  st: (s: string) => string,
  tree: boolean,
  options?: { ascii?: boolean },
): string {
  const isAscii = Boolean(options?.ascii);
  const branch = isAscii ? "|-- " : "├── ";
  const last = isAscii ? "`-- " : "└── ";

  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (!r.trim()) {
      out.push("");
      continue;
    }
    let formatted = r;
    if (tree) {
      formatted = (i === rows.length - 1 ? last : branch) + r;
    }
    out.push(st(formatted));
  }
  return out.join("\n");
}

export function signatureStyle(
  theme: Theme,
  text: string,
  options: {
    fg?: string;
    bg?: string;
    bold?: boolean;
    italic?: boolean;
  },
  palette?: string | ResolvedPalette,
): string {
  return paintRow(text, visibleWidth(text), options, theme);
}

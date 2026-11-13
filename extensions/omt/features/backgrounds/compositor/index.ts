import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";

export function hasWallpaperImage(line: string): boolean {
  return line.includes("\x1b_G") || line.includes("\x1b]1337;File=") || /\x1bP[\d;]*q/.test(line);
}

// Pi does not export its ANSI tokenizer. Accept only style/link/marker tokens;
// all unknown sequences yield the original row byte-for-byte.
function extractAnsiCode(line: string, offset: number): { code: string; length: number } | undefined {
  const code = /^(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b[\]_][^\x07\x1b]*(?:\x07|\x1b\\))/.exec(line.slice(offset))?.[0];
  return code ? { code, length: code.length } : undefined;
}

// Opaque native glyph spans, explicit styles, links and cursor cells win. Only
// unstyled margin/empty cells admit wallpaper; ANSI terminals have no alpha.
export type Part =
  | { text: string; column: number; width: number; hasBg: boolean }
  | { column: number; width: number };
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function hasBackgroundCode(code: string): boolean {
  if (!code.startsWith("\x1b[")) return false;
  const mIdx = code.indexOf("m");
  if (mIdx === -1) return false;
  const parts = code.slice(2, mIdx).split(";");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "48") return true;
    const n = Number(p);
    if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107)) return true;
  }
  return false;
}

function extractBgFromCell(cell: string): string | undefined {
  if (!cell || !cell.startsWith("\x1b[")) return undefined;
  const mIdx = cell.indexOf("m");
  if (mIdx === -1) return undefined;
  const sgr = cell.slice(2, mIdx);
  const parts = sgr.split(";");
  let bgCode: string | undefined;
  let fgCode: string | undefined;

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p === "48") {
      if (parts[i + 1] === "2" && parts[i + 4] !== undefined) {
        bgCode = `48;2;${parts[i + 2]};${parts[i + 3]};${parts[i + 4]}`;
        i += 4;
        continue;
      }
      if (parts[i + 1] === "5" && parts[i + 2] !== undefined) {
        bgCode = `48;5;${parts[i + 2]}`;
        i += 2;
        continue;
      }
    } else if (p === "38") {
      if (parts[i + 1] === "2" && parts[i + 4] !== undefined) {
        fgCode = `48;2;${parts[i + 2]};${parts[i + 3]};${parts[i + 4]}`;
        i += 4;
        continue;
      }
      if (parts[i + 1] === "5" && parts[i + 2] !== undefined) {
        fgCode = `48;5;${parts[i + 2]}`;
        i += 2;
        continue;
      }
    } else {
      const num = Number(p);
      if ((num >= 40 && num <= 47) || (num >= 100 && num <= 107)) {
        bgCode = `${num}`;
      } else if ((num >= 30 && num <= 37) || (num >= 90 && num <= 97)) {
        fgCode = `${num + 10}`;
      }
    }
  }
  return bgCode ?? fgCode;
}

function plan(line: string, width: number): Part[] {
  const tokens: { text: string; column: number; width: number; open: boolean }[] = [];
  let column = 0, styled = false, linked = false, cursor = false, hasBg = false;
  let first = width, last = 0;
  for (let i = 0; i < line.length;) {
    if (line[i] === "\x1b") {
      const ansi = extractAnsiCode(line, i);
      if (!ansi) return [{ text: line, column: 0, width, hasBg: false }];
      const code = ansi.code;
      if (/^\x1b\[[\d;:]*m$/.test(code)) {
        // Conservatively retain selective-reset styles as opaque until a full
        // reset. Never misread RGB channels (including zero) as SGR resets.
        if (/^\x1b\[(?:0)?m$/.test(code)) {
          styled = false;
          hasBg = false;
        } else {
          styled = true;
          if (hasBackgroundCode(code)) hasBg = true;
        }
      } else if (code.startsWith("\x1b]8;")) {
        linked = !/^\x1b\]8;[^;]*;(?:\x07|\x1b\\)$/.test(code);
      } else if (code === CURSOR_MARKER) cursor = true;
      else return [{ text: line, column: 0, width, hasBg: false }]; // Images/unknown controls remain native.
      tokens.push({ text: code, column, width: 0, open: false });
      i += ansi.length;
      continue;
    }
    const end = line.indexOf("\x1b", i);
    const text = line.slice(i, end < 0 ? undefined : end);
    for (const { segment } of graphemes.segment(text)) {
      if (/[\x00-\x1f\x7f]/.test(segment)) return [{ text: line, column: 0, width, hasBg: false }];
      const cells = visibleWidth(segment);
      const open = segment === " " && !styled && !linked && !cursor;
      if (segment !== " " || cursor) {
        first = Math.min(first, column);
        last = Math.max(last, column + cells);
      }
      tokens.push({ text: segment, column, width: cells, open });
      column += cells;
      cursor = false;
    }
    i += text.length;
  }
  if (column > width) return [{ text: line, column: 0, width, hasBg: false }];
  const parts: Part[] = [];
  function add(token: typeof tokens[number]) {
    const transparent = token.open && (token.column < first || token.column >= last);
    const previous = parts.at(-1);
    if (transparent) {
      if (previous && !("text" in previous) && previous.column + previous.width === token.column) {
        previous.width += token.width;
      } else {
        parts.push({ column: token.column, width: token.width });
      }
    } else if (previous && "text" in previous && previous.hasBg === hasBg) {
      previous.text += token.text;
      previous.width += token.width;
    } else {
      parts.push({ text: token.text, column: token.column, width: token.width, hasBg });
    }
  }
  for (const token of tokens) add(token);
  // A trailing open style/link/cursor is native-owned, not transparent padding.
  if (column < width && !styled && !linked && !cursor) parts.push({ column, width: width - column });
  return parts;
}

/**
 * A viewport-sized logical wallpaper buffer.
 * Accepts truecolor (38;2/48;2), 256-color (38;5/48;5), 16-color (30-37/40-47),
 * and plain unstyled character cells. Unknown sequences fail closed to blank cells.
 */
export function wallpaperCells(lines: readonly string[], width: number, height: number): string[][] {
  return Array.from({ length: height }, (_, row) => {
    const cells: string[] = [];
    const line = lines[row] ?? "";
    const tokens = line.match(/\x1b\[[\d;:]+m[^\x00-\x1f\x7f]\x1b\[0m|[^\x00-\x1f\x7f]/gu) ?? [];
    if (tokens.join("") !== line) return Array<string>(width).fill(" ");
    for (const token of tokens) {
      const glyph = token.startsWith("\x1b") ? token.slice(token.indexOf("m") + 1, -4) : token;
      const span = glyph.charCodeAt(0) < 0x7f ? 1 : visibleWidth(glyph);
      if (span === 0) {
        if (cells.length) cells[cells.length - 1] += token;
        continue;
      }
      if (cells.length + span > width) break;
      cells.push(span === 1 ? token : " ");
      for (let i = 1; i < span; i++) cells.push(" ");
      if (cells.length === width) break;
    }
    while (cells.length < width) cells.push(" ");
    return cells;
  });
}

/**
 * Bounded cache of visible foreground masks, never of the whole transcript.
 */
export class BackgroundCompositor {
  private cache = new Map<string, Part[]>();
  private width = 0;

  clear(): void {
    this.cache.clear();
  }

  compose(
    foreground: readonly string[],
    wallpaper: readonly string[],
    width: number,
    height: number,
    strict = false,
  ): string[] {
    // Kitty placements cover subsequent rows. Yield the entire viewport rather
    // than animate beneath an image or trigger uploads on every wallpaper tick.
    if (foreground.some(hasWallpaperImage)) return [...foreground];
    if (this.width !== width) {
      this.clear();
      this.width = width;
    }
    const buffer = wallpaperCells(wallpaper, width, height);
    const result: string[] = [];
    for (let row = 0; row < height; row++) {
      const line = foreground[row] ?? "";
      if (strict && line.replace(/\x1b\[[\d;:]*m/g, "").trim()) {
        result.push(line);
        continue;
      }
      let parts = this.cache.get(line);
      if (!parts) {
        parts = plan(line, width);
        this.cache.set(line, parts);
      }
      const background = buffer[row]!;
      result.push(
        parts
          .map((part) => {
            if (!("text" in part)) {
              return `\x1b[0m${background.slice(part.column, part.column + part.width).join("")}\x1b[0m`;
            }
            if (part.hasBg) {
              return part.text;
            }
            const wallCell = background[part.column];
            const bgSgr = wallCell ? extractBgFromCell(wallCell) : undefined;
            if (bgSgr) {
              return `\x1b[${bgSgr}m${part.text}\x1b[0m`;
            }
            return part.text;
          })
          .join(""),
      );
    }
    // Retain only a small number of visible frames, including empty rows.
    while (this.cache.size > Math.max(8, height * 2)) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    return result;
  }
}

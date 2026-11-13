import { wallpaperCells } from "./index.ts";

/** Resize artwork cells only, never foreground or native viewport geometry.
 * Both output and virtual artwork stay within the existing 80,000-cell budget.
 * Nearest-cell sampling preserves ANSI palettes and the one-column glyph contract.
 */
export function renderScaledWallpaper(
  width: number,
  height: number,
  textureScale: number | undefined,
  render: (width: number, height: number) => string[],
): string[] {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width <= 0 || height <= 0 || width * height > 80_000) return [];
  const scale = typeof textureScale === "number" && Number.isFinite(textureScale)
    ? Math.max(0.25, Math.min(2, textureScale)) : 1;
  if (scale === 1) return render(width, height);

  let cols = Math.ceil(width / scale), rows = Math.ceil(height / scale);
  const budget = Math.min(1, Math.sqrt(80_000 / (cols * rows)));
  cols = Math.max(1, Math.floor(cols * budget));
  rows = Math.max(1, Math.floor(rows * budget));
  const source = render(cols, rows);
  if (!source.length) return [];
  const result: string[] = [];
  let lastY = -1, cells: string[] = [];
  for (let y = 0; y < height; y++) {
    const sy = Math.min(rows - 1, Math.floor((y + 0.5) * rows / height));
    if (sy !== lastY) {
      cells = wallpaperCells([source[sy] ?? ""], cols, 1)[0]!;
      lastY = sy;
    }
    let line = "";
    for (let x = 0; x < width; x++) {
      line += cells[Math.min(cols - 1, Math.floor((x + 0.5) * cols / width))]!;
    }
    result.push(line);
  }
  return result;
}

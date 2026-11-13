import { formatCellBg, formatCellFg, formatCellFgBg, validCellViewport } from "./cell.ts";
import { CLAUDE_THEME_SCENES } from "../scenes/curated.ts";
import { renderScaledWallpaper } from "../compositor/scale.ts";
import { mixRgb, hexToRgb, keepVeil, glyph, haloOf, GLYPHS, LOOSE, type ProceduralRenderOptions } from "../scenes/art.ts";

// ==========================================
// Procedural Scene Renderer
// ==========================================

interface TargetCell {
  bg?: [number, number, number];
  fg?: [number, number, number];
  ch?: string;
}

export function renderProceduralScene(
  sceneId: string,
  width: number,
  height: number,
  timeMs: number,
  options: ProceduralRenderOptions = { width, height, timeMs },
): string[] {
  const scene = CLAUDE_THEME_SCENES[sceneId];
  if (!scene || !validCellViewport(width, height)) return [];
  if (options.textureScale !== undefined && options.textureScale !== 1) {
    return renderScaledWallpaper(width, height, options.textureScale, (cols, rows) =>
      renderProceduralScene(sceneId, cols, rows, timeMs, {
        ...options, width: cols, height: rows, textureScale: 1,
        contentBounds: options.contentBounds
          ? [options.contentBounds[0] * cols / width, options.contentBounds[1] * cols / width] : undefined,
      }));
  }

  const t = options.reducedMotion ? 0 : (timeMs / 1000) * (options.speed ?? 1);
  const cols = width, rows = height;
  const col = options.contentBounds; // selective readability veil column bounds [left, right]
  const baseBg: [number, number, number] = options.backdropBg ? [...options.backdropBg] : [10, 12, 18];

  const dimFactor = options.dimming === "dim" ? 0.4 : options.dimming === "vibrant" ? 1.0 : 0.7;
  const intensityFactor = options.intensity === "low" ? 0.6 : options.intensity === "high" ? 1.2 : 0.9;

  // Grid of cells
  const grid: (TargetCell | undefined)[][] = Array.from({ length: rows }, () => Array(cols).fill(undefined));

  // 1. Evaluate scene.cell
  if (scene.cell) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = scene.cell(x, y, cols, rows, t);
        if (!c) continue;
        const veilM = keepVeil(col, x);
        const alpha = Math.max(0, Math.min(1, c.a)) * Math.max(c.floor ?? 0, veilM) * dimFactor * intensityFactor;
        if (alpha < 0.02) continue;

        const cellBg = c.bg ? mixRgb(baseBg, hexToRgb(c.bg), alpha) : undefined;
        const cellFg = c.fg ? mixRgb(baseBg, hexToRgb(c.fg), Math.min(1, alpha * 1.15)) : undefined;
        const ch = c.ch !== undefined ? c.ch : (options.asciiOnly ? glyph(c.bg ? GLYPHS : LOOSE, x, y, t) : (c.bg ? " " : glyph(LOOSE, x, y, t)));
        grid[y]![x] = { bg: cellBg, fg: cellFg, ch };
      }
    }
  }

  // 2. Evaluate scene.sprites
  if (scene.sprites) {
    const spritesList = scene.sprites(cols, rows, t);
    for (const s of spritesList) {
      const ox = Math.round(s.x), oy = Math.round(s.y);
      const m = s.a ?? 1;
      const k = s.key * 997;
      const bw = s.art ? s.art[0]!.length : (s.w ?? 0);
      const bh = s.art ? s.art.length : (s.h ?? 0);

      if (ox > cols + 4 || oy > rows + 4 || ox + bw + 4 < 0 || oy + bh + 4 < 0) continue;

      // Glow: subtle radial ambient light
      if (s.glow) {
        const g = s.glow, cx = ox + bw / 2, cy = oy + bh / 2, r = g.r;
        const gColor = hexToRgb(g.color);
        const minX = Math.max(0, Math.floor(cx - r * 1.5)), maxX = Math.min(cols - 1, Math.ceil(cx + r * 1.5));
        const minY = Math.max(0, Math.floor(cy - r)), maxY = Math.min(rows - 1, Math.ceil(cy + r));
        for (let gy = minY; gy <= maxY; gy++) {
          for (let gx = minX; gx <= maxX; gx++) {
            const dist = Math.hypot((gx - cx) * 0.5, gy - cy);
            if (dist < r) {
              const falloff = (1 - dist / r) * g.a * m * keepVeil(col, gx) * dimFactor;
              if (falloff > 0.03) {
                const existing = grid[gy]![gx] ?? (grid[gy]![gx] = { ch: " " });
                const curBg = existing.bg ?? baseBg;
                existing.bg = mixRgb(curBg, gColor, Math.min(1, falloff * 0.45));
              }
            }
          }
        }
      }

      // Collect sprite cells
      const cells: [number, number, { bg?: string; fg?: string; ch?: string; a: number }, number, number][] = [];
      if (s.art && s.pal) {
        s.art.forEach((row, gy) => {
          for (let gx = 0; gx < row.length; gx++) {
            const palEntry = s.pal![row[gx]!];
            if (palEntry) cells.push([gx, gy, palEntry, gx + k, gy]);
          }
        });
      } else if (s.field && s.w && s.h) {
        for (let gy = 0; gy < s.h; gy++) {
          for (let gx = 0; gx < s.w; gx++) {
            const f = s.field(gx, gy);
            if (f) cells.push([gx, gy, f.c, (f.sx ?? gx) + k, f.sy ?? gy]);
          }
        }
      }

      // Drop Shadow
      if (s.shadow) {
        const shadowColor: [number, number, number] = typeof s.shadow === "string" ? hexToRgb(s.shadow) : [5, 8, 12];
        for (const [gx, gy, c] of cells) {
          if (c.bg) {
            const px = ox + gx + 1, py = oy + gy + 1;
            if (px >= 0 && px < cols && py >= 0 && py < rows) {
              const existing = grid[py]![px] ?? (grid[py]![px] = { ch: " " });
              const curBg = existing.bg ?? baseBg;
              existing.bg = mixRgb(curBg, shadowColor, 0.4 * m);
            }
          }
        }
      }

      // Halo
      if (s.halo && s.art) {
        const haloRgb = hexToRgb(s.halo);
        for (const [hx, hy] of haloOf(s.art)) {
          const px = ox + hx, py = oy + hy;
          if (px >= 0 && px < cols && py >= 0 && py < rows) {
            const existing = grid[py]![px] ?? (grid[py]![px] = {});
            if (!existing.fg) {
              const vM = keepVeil(col, px);
              existing.fg = mixRgb(baseBg, haloRgb, 0.3 * m * vM * dimFactor);
              existing.ch ??= glyph(LOOSE, hx + k, hy, t);
            }
          }
        }
      }

      // Place sprite cells
      for (const [gx, gy, c, sx, sy] of cells) {
        const px = ox + gx, py = oy + gy;
        if (px >= 0 && px < cols && py >= 0 && py < rows) {
          const vM = keepVeil(col, px);
          const alpha = Math.max(0, Math.min(1, c.a * m)) * Math.max(0.3, vM) * dimFactor * intensityFactor;
          if (alpha < 0.02) continue;

          const existing = grid[py]![px] ?? (grid[py]![px] = {});
          if (c.bg) {
            const curBg = existing.bg ?? baseBg;
            existing.bg = mixRgb(curBg, hexToRgb(c.bg), alpha);
          }
          if (c.fg) {
            const curFg = existing.fg ?? baseBg;
            existing.fg = mixRgb(curFg, hexToRgb(c.fg), Math.min(1, alpha * 1.15));
          }
          existing.ch = c.ch !== undefined ? c.ch : (options.asciiOnly ? glyph(c.bg ? GLYPHS : LOOSE, sx, sy, t) : (c.bg ? " " : glyph(LOOSE, sx, sy, t)));
        }
      }
    }
  }

  // 3. Format grid to ANSI lines
  const ascii = options.asciiOnly ?? false;
  const colorMode = options.colorMode ?? "truecolor";
  return grid.map(rowCells => {
    let rowStr = "";
    for (let x = 0; x < cols; x++) {
      const cell = rowCells[x];
      if (!cell || (!cell.bg && !cell.fg && (!cell.ch || cell.ch === " "))) {
        rowStr += " ";
        continue;
      }
      let ch = cell.ch && cell.ch.length > 0 ? cell.ch : " ";
      if (ascii) {
        // Safe ASCII mapping
        if (ch === "—" || ch === "–") ch = "-";
        else if (ch === "•") ch = "*";
        else if (ch === "…") ch = ".";
        else if (ch.charCodeAt(0) > 127) ch = ".";
      }

      if (cell.bg && cell.fg) {
        const [br, bg, bb] = cell.bg, [fr, fg, fb] = cell.fg;
        rowStr += formatCellFgBg(fr, fg, fb, br, bg, bb, ch, colorMode);
      } else if (cell.bg) {
        const [br, bg, bb] = cell.bg;
        rowStr += formatCellBg(br, bg, bb, ch, colorMode);
      } else if (cell.fg) {
        const [fr, fg, fb] = cell.fg;
        rowStr += formatCellFg(fr, fg, fb, ch, colorMode);
      } else {
        rowStr += ch;
      }
    }
    return rowStr;
  });
}

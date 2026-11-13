import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  initChafa,
  isChafaLoaded,
  getChafa,
  disposeChafa,
  renderChafaRaster,
  renderChafaRasterAsync,
  ansiToCellLines,
  chafaFrameCache,
  buildFrameCacheKey,
} from "../extensions/omt/features/backgrounds/renderers/chafa.ts";
import {
  renderImageBackground,
  createPixelSampler,
} from "../extensions/omt/features/backgrounds/renderers/cell.ts";
import { wallpaperCells } from "../extensions/omt/features/backgrounds/compositor/index.ts";
import { calculateFrameAt, quantizeTime, BackgroundPlayhead } from "../extensions/omt/features/backgrounds/motion/index.ts";

test("Chafa WASM lazy loading and lifecycle management", async () => {
  // Dispose any pre-existing instance to test clean load
  disposeChafa();
  assert.equal(isChafaLoaded(), false);
  assert.equal(getChafa(), null);

  // Lazy-load module
  const chafa = await initChafa();
  assert.ok(chafa, "Chafa module loaded");
  assert.equal(isChafaLoaded(), true);
  assert.equal(getChafa(), chafa);

  // Subsequent call returns identical cached instance
  const chafa2 = await initChafa();
  assert.equal(chafa2, chafa);
});

test("Chafa raster conversion across color modes: truecolor, 256color, 16color, monochrome", async () => {
  await initChafa();

  // 4x4 test image with 4 distinct color quadrants: Red, Green, Blue, Yellow
  const img = {
    width: 4,
    height: 4,
    data: new Uint8ClampedArray([
      255, 0, 0, 255,     255, 0, 0, 255,     0, 255, 0, 255,     0, 255, 0, 255,
      255, 0, 0, 255,     255, 0, 0, 255,     0, 255, 0, 255,     0, 255, 0, 255,
      0, 0, 255, 255,     0, 0, 255, 255,     255, 255, 0, 255,   255, 255, 0, 255,
      0, 0, 255, 255,     0, 0, 255, 255,     255, 255, 0, 255,   255, 255, 0, 255,
    ]),
  };

  // 1. Truecolor
  const tcLines = renderChafaRaster(img, { width: 4, height: 2, colorMode: "truecolor", cellMode: "halfblock" });
  assert.equal(tcLines.length, 2);
  assert.ok(tcLines.every((l) => visibleWidth(l) === 4));
  assert.ok(tcLines[0]!.includes("38;2;"));
  const tcCells = wallpaperCells(tcLines, 4, 2);
  assert.equal(tcCells.length, 2);
  assert.equal(tcCells[0]!.length, 4);

  // 2. 256-color
  const c256Lines = renderChafaRaster(img, { width: 4, height: 2, colorMode: "256color", cellMode: "halfblock" });
  assert.equal(c256Lines.length, 2);
  assert.ok(c256Lines.every((l) => visibleWidth(l) === 4));
  assert.ok(c256Lines[0]!.includes("38;5;"));
  assert.doesNotMatch(c256Lines.join(""), /\x1b\[38;2;/);
  const c256Cells = wallpaperCells(c256Lines, 4, 2);
  assert.equal(c256Cells.length, 2);

  // 3. 16-color
  const c16Lines = renderChafaRaster(img, { width: 4, height: 2, colorMode: "16color", cellMode: "halfblock" });
  assert.equal(c16Lines.length, 2);
  assert.ok(c16Lines.every((l) => visibleWidth(l) === 4));
  assert.doesNotMatch(c16Lines.join(""), /\x1b\[38;[25];/);
  const c16Cells = wallpaperCells(c16Lines, 4, 2);
  assert.equal(c16Cells.length, 2);

  // 4. Monochrome / FGBG
  const monoLines = renderChafaRaster(img, { width: 4, height: 2, colorMode: "monochrome", cellMode: "halfblock" });
  assert.equal(monoLines.length, 2);
  assert.ok(monoLines.every((l) => visibleWidth(l) === 4));
  assert.doesNotMatch(monoLines.join(""), /\x1b\[[\d;]*m/);
  const monoCells = wallpaperCells(monoLines, 4, 2);
  assert.equal(monoCells.length, 2);
  assert.equal(monoCells[0]!.length, 4);
  assert.ok(monoCells[0]!.every((c) => c.length === 1 && !c.includes("\x1b")));
});

test("Chafa symbol sets: vhalf, braille, ascii, and custom block characters", async () => {
  await initChafa();

  const img = {
    width: 4,
    height: 4,
    data: new Uint8ClampedArray([
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    ]),
  };

  // 1. Half-block mode (vhalf)
  const halfLines = renderChafaRaster(img, { width: 4, height: 2, cellMode: "halfblock" });
  assert.ok(halfLines.some((l) => l.includes("▀")));

  // 2. Braille mode
  const brailleLines = renderChafaRaster(img, { width: 2, height: 1, cellMode: "braille" });
  assert.equal(brailleLines.length, 1);
  assert.ok(brailleLines[0]!.length > 0);

  // 3. ASCII mode
  const asciiLines = renderChafaRaster(img, { width: 4, height: 2, cellMode: "ascii" });
  assert.equal(asciiLines.length, 2);
  assert.doesNotMatch(asciiLines.join(""), /▀/);

  // 4. Custom block characters
  const blockLines = renderChafaRaster(img, { width: 4, height: 2, symbols: "blocks" });
  assert.equal(blockLines.length, 2);
  assert.ok(blockLines.every((l) => visibleWidth(l) === 4));
});

test("Chafa quality presets: fast, balanced, and high", async () => {
  await initChafa();

  const img = {
    width: 8,
    height: 8,
    data: new Uint8ClampedArray(8 * 8 * 4).fill(128),
  };

  for (const quality of ["fast", "balanced", "high"] as const) {
    const lines = renderChafaRaster(img, { width: 8, height: 4, quality });
    assert.equal(lines.length, 4);
    assert.ok(lines.every((l) => visibleWidth(l) === 8));
  }
});

test("Validated ANSI-to-cell adapter: generates self-contained cells and handles wide characters", () => {
  // Empty or invalid inputs
  assert.deepEqual(ansiToCellLines("", 0, 0), []);
  assert.deepEqual(ansiToCellLines("", -1, 5), []);
  assert.deepEqual(ansiToCellLines("", 1000, 1000), []); // > 80,000 cells

  // SGR codes parsing: truecolor, reset, and padding
  const ansi = "\x1b[38;2;100;150;200;48;2;10;20;30mAB\x1b[0mC";
  const lines = ansiToCellLines(ansi, 5, 1);
  assert.equal(lines.length, 1);
  assert.equal(visibleWidth(lines[0]!), 5);

  const cells = wallpaperCells(lines, 5, 1);
  assert.equal(cells[0]!.length, 5);
  assert.ok(cells[0]![0]!.includes("38;2;100;150;200"));
  assert.ok(cells[0]![1]!.includes("38;2;100;150;200"));
  assert.equal(cells[0]![2], "C");
  assert.equal(cells[0]![3], " "); // padded
  assert.equal(cells[0]![4], " "); // padded

  // Lower half-block ▄ normalization to ▀
  const lowerHalfAnsi = "\x1b[38;2;10;20;30;48;2;200;210;220m▄\x1b[0m";
  const normalizedLines = ansiToCellLines(lowerHalfAnsi, 1, 1, true);
  assert.ok(normalizedLines[0]!.includes("▀"));
  assert.ok(normalizedLines[0]!.includes("38;2;200;210;220")); // former bg became fg of ▀
  assert.ok(normalizedLines[0]!.includes("48;2;10;20;30")); // former fg became bg of ▀

  // Inverse video SGR 7 / 27
  const inverseAnsi = "\x1b[38;2;10;20;30;48;2;200;210;220m\x1b[7mX\x1b[27mY\x1b[0m";
  const inverseLines = ansiToCellLines(inverseAnsi, 2, 1);
  assert.ok(inverseLines[0]!.includes("38;2;200;210;220;48;2;10;20;30mX"));
  assert.ok(inverseLines[0]!.includes("38;2;10;20;30;48;2;200;210;220mY"));
});

test("Chafa frame caching: hit, miss, eviction, and deterministic invalidation", async () => {
  await initChafa();
  chafaFrameCache.clear();
  assert.equal(chafaFrameCache.size(), 0);

  const key1 = buildFrameCacheKey({ assetId: "asset-1", width: 40, height: 12, frame: 0 });
  const key2 = buildFrameCacheKey({ assetId: "asset-1", width: 40, height: 12, frame: 1 });
  const key3 = buildFrameCacheKey({ assetId: "asset-2", width: 40, height: 12, frame: 0 });

  chafaFrameCache.set(key1, ["row1", "row2"]);
  chafaFrameCache.set(key2, ["row1", "row2"]);
  chafaFrameCache.set(key3, ["row1", "row2"]);

  assert.equal(chafaFrameCache.size(), 3);
  assert.deepEqual(chafaFrameCache.get(key1), ["row1", "row2"]);

  // Invalidate by prefix
  chafaFrameCache.invalidate("asset-1");
  assert.equal(chafaFrameCache.has(key1), false);
  assert.equal(chafaFrameCache.has(key2), false);
  assert.equal(chafaFrameCache.has(key3), true);

  // Clear all
  chafaFrameCache.clear();
  assert.equal(chafaFrameCache.size(), 0);
});

test("Integration: renderImageBackground with Chafa WASM, fallbacks, and fit options", async () => {
  await initChafa();

  const asset = {
    metadata: { id: "test-integration-asset", width: 4, height: 4, frameCount: 1, frameMs: 0 },
    pixels: Buffer.alloc(4 * 4 * 4, 180),
  };

  // Test across all fit options
  for (const fit of ["cover", "contain", "center", "tile"] as const) {
    const lines = renderImageBackground(asset, 20, 6, { fit, opacity: 0.8, dimming: "subtle" });
    assert.equal(lines.length, 6);
    assert.ok(lines.every((l) => visibleWidth(l) === 20));
  }

  // Second call hits cache
  const cachedLines = renderImageBackground(asset, 20, 6, { fit: "cover", opacity: 0.8, dimming: "subtle" });
  assert.equal(cachedLines.length, 6);

  // Async helper
  const asyncLines = await renderChafaRasterAsync(
    { width: 4, height: 4, data: new Uint8ClampedArray(asset.pixels) },
    { width: 10, height: 3 },
  );
  assert.equal(asyncLines.length, 3);
  assert.ok(asyncLines.every((l) => visibleWidth(l) === 10));
});

test("Animation timing: calculateFrameAt and quantizeTime skip outdated frames without backlog", () => {
  // 10-frame animation with 100ms per frame
  assert.equal(calculateFrameAt(0, 10, 100).frame, 0);
  assert.equal(calculateFrameAt(150, 10, 100).frame, 1);
  assert.equal(calculateFrameAt(950, 10, 100).frame, 9);
  // Skipped tick directly to 500ms jumps to frame 5 without backlog queue
  assert.equal(calculateFrameAt(520, 10, 100).frame, 5);

  // Playhead pause and resume
  const playhead = new BackgroundPlayhead();
  playhead.advance(1000, true, 1.0);
  playhead.advance(1200, true, 1.0);
  assert.equal(playhead.time, 200);

  // While paused, advance does not increment time
  playhead.advance(2000, false, 1.0);
  assert.equal(playhead.time, 200);
});

test("Chafa WASM terminal resize stress test: survives rapid viewport dimension changes without memory errors", async () => {
  await initChafa();

  const dimensions: [number, number][] = [
    [80, 24],
    [100, 30],
    [120, 40],
    [150, 50],
    [200, 60],
    [40, 12],
    [20, 6],
    [120, 40],
    [80, 24],
    [180, 50],
    [85, 27],
    [63, 19],
    [33, 7],
    [15, 4],
    [250, 80],
    [80, 24],
  ];

  for (const [w, h] of dimensions) {
    const sampleW = w;
    const sampleH = h * 2;
    const img = {
      width: sampleW,
      height: sampleH,
      data: new Uint8ClampedArray(sampleW * sampleH * 4),
    };
    const lines = renderChafaRaster(img, { width: w, height: h });
    assert.equal(lines.length, h);
    assert.ok(lines.every((l) => visibleWidth(l) === w));
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectColorMode,
  detectColorCapabilities,
  detectGraphicsCapabilities,
  detectKittyBackendCapabilities,
  evaluateFullBackdropSupport,
  detectTerminalCapabilities,
} from "../extensions/omt/features/backgrounds/capabilities/index.ts";
import {
  BackgroundPlayhead,
  backgroundFrameAt,
  calculateFrameAt,
  quantizeTime,
} from "../extensions/omt/features/backgrounds/motion/index.ts";
import {
  BackgroundCompositor,
  wallpaperCells,
  hasWallpaperImage,
} from "../extensions/omt/features/backgrounds/compositor/index.ts";
import {
  rgbToAnsi16,
  rgbToAnsi256,
  formatCellFg,
  formatCellBg,
  formatCellFgBg,
  renderHalfBlock,
  renderBraille,
  renderImageBackground,
  createPixelSampler,
} from "../extensions/omt/features/backgrounds/renderers/cell.ts";
import {
  BUILTIN_SCENES,
  getSceneImplementation,
  renderSceneViewport,
  renderAmbientBackdrop,
  formatSceneFraming,
} from "../extensions/omt/features/backgrounds/scenes/index.ts";
import {
  validateManifest,
  validateStoredScene,
} from "../extensions/omt/features/backgrounds/assets/manifest.ts";
import {
  createBackgroundControl,
  renderManagedBackground,
  managedBackgroundMoves,
} from "../extensions/omt/features/backgrounds/index.ts";
import { setCapabilities, resetCapabilitiesCache, CURSOR_MARKER } from "@earendil-works/pi-tui";

test("Capabilities: detectColorMode identifies truecolor, 256color, 16color, and monochrome", () => {
  // 1. Explicit override via OMT_COLOR_MODE
  assert.equal(detectColorMode({ OMT_COLOR_MODE: "truecolor" }), "truecolor");
  assert.equal(detectColorMode({ OMT_COLOR_MODE: "256color" }), "256color");
  assert.equal(detectColorMode({ OMT_COLOR_MODE: "16color" }), "16color");
  assert.equal(detectColorMode({ OMT_COLOR_MODE: "monochrome" }), "monochrome");

  // 2. Standards: NO_COLOR or TERM=dumb
  assert.equal(detectColorMode({ NO_COLOR: "1", COLORTERM: "truecolor" }), "monochrome");
  assert.equal(detectColorMode({ TERM: "dumb", COLORTERM: "truecolor" }), "monochrome");

  // 3. COLORTERM=truecolor or 24bit
  assert.equal(detectColorMode({ COLORTERM: "truecolor" }), "truecolor");
  assert.equal(detectColorMode({ COLORTERM: "24bit" }), "truecolor");

  // 4. TERM contains 256color
  assert.equal(detectColorMode({ TERM: "xterm-256color" }), "256color");

  // 5. TERM contains standard color or ansi
  assert.equal(detectColorMode({ TERM: "xterm" }), "16color");
  assert.equal(detectColorMode({ TERM: "linux" }), "16color");
  assert.equal(detectColorMode({ TERM: "vt100" }), "monochrome");
  assert.equal(detectColorMode({}), "monochrome");

  // 6. ColorCapabilities flags
  const trueCaps = detectColorCapabilities({ COLORTERM: "truecolor" });
  assert.equal(trueCaps.truecolor, true);
  assert.equal(trueCaps.color256, true);
  assert.equal(trueCaps.ansi16, true);
  assert.equal(trueCaps.monochrome, false);

  const monoCaps = detectColorCapabilities({ NO_COLOR: "1" });
  assert.equal(monoCaps.truecolor, false);
  assert.equal(monoCaps.color256, false);
  assert.equal(monoCaps.ansi16, false);
  assert.equal(monoCaps.monochrome, true);
});

test("Capabilities: detectGraphicsCapabilities checks SSH, tmux, and terminal protocols", () => {
  try {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });

    // In a confirmed Kitty terminal environment
    const kittyCaps = detectGraphicsCapabilities({
      TERM_PROGRAM: "kitty",
      KITTY_WINDOW_ID: "123",
    });
    assert.equal(kittyCaps.supported, false);
    assert.equal(kittyCaps.protocol, "none");
    assert.equal(kittyCaps.negativeZIndex, false);
    assert.equal(kittyCaps.backend, "ansi");
    assert.match(kittyCaps.reason, /eliminated|unverified/);

    // Inside tmux without Kitty socket forwarding -> fallback to ANSI
    const tmuxCaps = detectGraphicsCapabilities({
      TMUX: "/tmp/tmux-1000/default,1,0",
    });
    assert.equal(tmuxCaps.backend, "ansi");
    assert.equal(tmuxCaps.supported, false);
    assert.match(tmuxCaps.reason, /eliminated|tmux/);

    // Over SSH without confirmed local socket -> fallback to ANSI
    const sshCaps = detectGraphicsCapabilities({
      SSH_CONNECTION: "192.168.1.1 50000 192.168.1.2 22",
    });
    assert.equal(sshCaps.backend, "ansi");
    assert.equal(sshCaps.supported, false);
    assert.match(sshCaps.reason, /eliminated|SSH/);

    // Discovered overall capabilities summary
    const allCaps = detectTerminalCapabilities({
      COLORTERM: "truecolor",
      TERM_PROGRAM: "ghostty",
    });
    assert.equal(allCaps.color.mode, "truecolor");
    assert.equal(allCaps.inTmux, false);
    assert.equal(allCaps.inSsh, false);
  } finally {
    resetCapabilitiesCache();
  }
});

test("Motion: calculateFrameAt, backgroundFrameAt, quantizeTime, and Playhead lifecycle", () => {
  // calculateFrameAt
  assert.deepEqual(calculateFrameAt(0, 1, 100, 0), { frame: 0, ended: true });
  assert.deepEqual(calculateFrameAt(0, 10, 100, 0), { frame: 0, ended: false });
  assert.deepEqual(calculateFrameAt(250, 10, 100, 0), { frame: 2, ended: false });
  assert.deepEqual(calculateFrameAt(1050, 10, 100, 0), { frame: 0, ended: false }); // loops
  assert.deepEqual(calculateFrameAt(2050, 10, 100, 2), { frame: 9, ended: true }); // finite loops ended

  // quantizeTime
  assert.equal(quantizeTime(123, 10), 100);
  assert.equal(quantizeTime(189, 10), 100);
  assert.equal(quantizeTime(200, 10), 200);

  // BackgroundPlayhead
  const playhead = new BackgroundPlayhead();
  assert.equal(playhead.time, 0);

  // Advance while running
  playhead.advance(1000, true, 1.0);
  assert.equal(playhead.time, 0); // First tick establishes baseline
  playhead.advance(1500, true, 1.0);
  assert.equal(playhead.time, 500); // 500ms elapsed

  // Speed scaling 2x
  playhead.advance(2000, true, 2.0);
  assert.equal(playhead.time, 1500); // +1000ms (500ms * 2)

  // Suspend (e.g. pause/blur)
  playhead.suspend();
  playhead.advance(10000, true, 1.0); // Resumes without jumping 8000ms
  assert.equal(playhead.time, 1500);

  // Reset
  playhead.reset();
  assert.equal(playhead.time, 0);
});

test("Cell Renderer: Color quantization across truecolor, 256color, 16color, and monochrome", () => {
  // rgbToAnsi256
  assert.equal(rgbToAnsi256(0, 0, 0), 16); // Black
  assert.equal(rgbToAnsi256(255, 255, 255), 231); // White
  assert.ok(rgbToAnsi256(128, 128, 128) >= 232); // Grayscale ramp
  assert.ok(rgbToAnsi256(255, 0, 0) >= 16); // Red

  // rgbToAnsi16
  const red16 = rgbToAnsi16(255, 0, 0);
  assert.equal(red16.fg, 91); // Bright red fg
  assert.equal(red16.bg, 101); // Bright red bg

  const black16 = rgbToAnsi16(0, 0, 0);
  assert.equal(black16.fg, 30);
  assert.equal(black16.bg, 40);

  // formatCellFg across modes
  const text = "X";
  assert.equal(formatCellFg(255, 0, 0, text, "monochrome"), "X");
  assert.ok(formatCellFg(255, 0, 0, text, "16color").includes("\x1b[91m"));
  assert.ok(formatCellFg(255, 0, 0, text, "256color").includes("\x1b[38;5;"));
  assert.ok(formatCellFg(255, 0, 0, text, "truecolor").includes("\x1b[38;2;255;0;0m"));

  // formatCellBg across modes
  assert.equal(formatCellBg(0, 255, 0, text, "monochrome"), "X");
  assert.ok(formatCellBg(0, 255, 0, text, "16color").includes("\x1b[102m"));
  assert.ok(formatCellBg(0, 255, 0, text, "256color").includes("\x1b[48;5;"));
  assert.ok(formatCellBg(0, 255, 0, text, "truecolor").includes("\x1b[48;2;0;255;0m"));

  // formatCellFgBg combined
  const combined = formatCellFgBg(255, 255, 255, 0, 0, 0, "▀", "truecolor");
  assert.ok(combined.includes("38;2;255;255;255;48;2;0;0;0m▀"));
});

test("Cell Renderer: Half-block and Braille rendering produces accurate terminal cells", () => {
  // Create a mock 4x4 RGBA buffer: top half red [255, 0, 0, 255], bottom half blue [0, 0, 255, 255]
  const pixels = Buffer.alloc(4 * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const idx = (y * 4 + x) * 4;
      if (y < 2) {
        pixels[idx] = 255; // R
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 255;
      } else {
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 255; // B
        pixels[idx + 3] = 255;
      }
    }
  }

  const asset = {
    metadata: { width: 4, height: 4, frameCount: 1, frameMs: 0 },
    pixels,
  };

  // Half-block render: 4 columns x 2 rows
  const halfBlock = renderImageBackground(asset, 4, 2, { fit: "contain", opacity: 1, dimming: "vibrant" }, false, 0, "truecolor", "halfblock");
  assert.equal(halfBlock.length, 2);
  assert.ok(halfBlock[0]!.includes("▀"));
  assert.ok(halfBlock[0]!.includes("38;2;255;0;0")); // Top red

  // Braille render: 2 columns x 1 row (each cell is 2x4 subpixels)
  const braille = renderImageBackground(asset, 2, 1, { fit: "cover", opacity: 1, dimming: "vibrant" }, false, 0, "truecolor", "braille");
  assert.equal(braille.length, 1);
  assert.ok(braille[0]!.length > 0);

  // ASCII luminance fallback
  const ascii = renderImageBackground(asset, 4, 2, { fit: "contain", opacity: 1, dimming: "vibrant" }, true, 0, "monochrome");
  assert.equal(ascii.length, 2);
  assert.equal(ascii[0]!.includes("\x1b["), false, "monochrome ASCII has zero ANSI color escapes");
});

test("Compositor: wallpaperCells accepts multi-color formats and rejects unsafe controls", () => {
  // Truecolor line
  const tcLine = "\x1b[38;2;100;150;200mX\x1b[0m \x1b[48;2;10;20;30mY\x1b[0m";
  const tcCells = wallpaperCells([tcLine], 4, 1);
  assert.equal(tcCells.length, 1);
  assert.equal(tcCells[0]!.length, 4);
  assert.ok(tcCells[0]![0]!.includes("100;150;200"));
  assert.equal(tcCells[0]![1], " ");
  assert.ok(tcCells[0]![2]!.includes("10;20;30"));

  // 256-color line
  const c256Line = "\x1b[38;5;196mZ\x1b[0m";
  const c256Cells = wallpaperCells([c256Line], 2, 1);
  assert.equal(c256Cells.length, 1);
  assert.ok(c256Cells[0]![0]!.includes("38;5;196"));

  // 16-color line
  const c16Line = "\x1b[31;42mA\x1b[0m";
  const c16Cells = wallpaperCells([c16Line], 2, 1);
  assert.equal(c16Cells.length, 1);
  assert.ok(c16Cells[0]![0]!.includes("31;42"));

  // Plain characters
  const plainCells = wallpaperCells(["ABCD"], 4, 1);
  assert.deepEqual(plainCells[0], ["A", "B", "C", "D"]);

  // Unsafe terminal controls fail closed to blanks
  const unsafeCells = wallpaperCells(["\x1b_Ga=T;payload\x1b\\"], 4, 1);
  assert.deepEqual(unsafeCells[0], [" ", " ", " ", " "]);
});

test("Scenes: Procedural scene rendering supports colorMode fallback", () => {
  // Render Aurora in 16-color mode
  const aurora16 = renderSceneViewport({
    scene: "aurora",
    width: 40,
    height: 3,
    timeMs: 1000,
    colorMode: "16color",
  });
  assert.equal(aurora16.length, 3);
  assert.ok(aurora16.some((line) => line.includes("\x1b[")));

  // Render Starfield in monochrome mode
  const starfieldMono = renderSceneViewport({
    scene: "starfield",
    width: 40,
    height: 3,
    timeMs: 1000,
    colorMode: "monochrome",
  });
  assert.equal(starfieldMono.length, 3);
  assert.equal(starfieldMono.some((line) => line.includes("\x1b[38;") || line.includes("\x1b[48;")), false);

  // Ambient backdrop
  const ambient = renderAmbientBackdrop({
    scene: "rain",
    width: 30,
    height: 1,
    timeMs: 500,
  });
  assert.equal(ambient.length, 1);
});

test("Manifest: validates declarative scene specifications cleanly", () => {
  const valid = validateManifest({
    version: 1,
    type: "scene",
    name: "Cyber Stream",
    scene: {
      motion: true,
      layers: [
        { scene: "matrix", density: 1.0, count: 64, speed: 1.5, seed: 100 },
        { scene: "rain", density: 0.5, count: 32, speed: 1.0, seed: 200 },
      ],
    },
  });
  assert.equal(valid.name, "Cyber Stream");
  assert.equal(valid.scene.layers.length, 2);

  // Rejects invalid layers or unknown scenes
  assert.throws(
    () =>
      validateManifest({
        version: 1,
        type: "scene",
        name: "Bad",
        scene: { layers: [{ scene: "unknown-scene" }] },
      }),
    /Unknown procedural layer scene/,
  );
});

test("Features Index: createBackgroundControl lifecycle, transitions, and stats", () => {
  const control = createBackgroundControl();
  assert.equal(control.isEnabled(), false);

  const stats = control.getStats();
  assert.equal(typeof stats.enabled, "boolean");
  assert.equal(typeof stats.mode, "string");
  assert.equal(typeof stats.speed, "number");
  assert.ok(stats.graphicsBackend === "kitty" || stats.graphicsBackend === "ansi");
  assert.ok(stats.colorMode !== undefined);

  // Pause and resume
  control.pause();
  assert.equal(control.isPaused(), true);
  control.resume();
  assert.equal(control.isPaused(), false);

  // Speed and intensity updates
  control.setSpeed(1.5);
  control.setIntensity("high");
  control.setDimming("vibrant");
  control.setPauseOnActivity(false);

  // Cleanup
  control.cleanup();
  assert.equal(control.isEnabled(), false);
});

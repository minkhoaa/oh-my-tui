import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth, setCapabilities, resetCapabilitiesCache } from "@earendil-works/pi-tui";
import { renderSceneViewport, BUILTIN_SCENES } from "../extensions/omt/features/backgrounds/scenes/index.ts";
import { renderImageBackground, rgbToAnsi256 } from "../extensions/omt/features/backgrounds/renderers/cell.ts";
import { detectKittyBackendCapabilities, type ColorMode } from "../extensions/omt/features/backgrounds/capabilities/index.ts";
import { BackgroundAssetStore } from "../extensions/omt/features/backgrounds/assets/index.ts";
import { getPresetBackgroundPalette, THEME_NAMES } from "../extensions/omt/presets/index.ts";

const modes: ColorMode[] = ["truecolor", "256color", "16color", "monochrome"];
function assertMode(lines: string[], mode: ColorMode) {
  const text = lines.join("");
  if (mode !== "truecolor") assert.doesNotMatch(text, /\x1b\[(?:38|48);2;/);
  if (mode === "16color" || mode === "monochrome") assert.doesNotMatch(text, /\x1b\[(?:38|48);5;/);
  if (mode === "monochrome") assert.doesNotMatch(text, /\x1b/);
}

test("every scene and preset contains its cells and honors all color fallbacks deterministically", () => {
  for (const preset of THEME_NAMES) for (const scene of Object.keys(BUILTIN_SCENES)) {
    for (const mode of modes) for (const width of [1, 20, 40, 80, 120]) {
      const options = { scene: scene as keyof typeof BUILTIN_SCENES, width, height: 8, timeMs: 2500,
        preset, palette: getPresetBackgroundPalette(preset), colorMode: mode, asciiOnly: true };
      const lines = renderSceneViewport(options);
      assert.equal(lines.length, 8);
      for (const line of lines) {
        assert.equal(visibleWidth(line), width, `${preset}/${scene}/${mode}/${width}`);
        assert.doesNotMatch(line.replace(/\x1b\[[\d;]*m/g, ""), /[^\x20-\x7e]/);
      }
      assertMode(lines, mode);
      assert.deepEqual(renderSceneViewport(options), lines);
    }
  }
});

test("monochrome raster keeps luminance detail; explicit ASCII mode works without accessibility flag", () => {
  const asset = { metadata: { width: 2, height: 2, frameCount: 1, frameMs: 0 },
    pixels: Buffer.from([0,0,0,255, 255,255,255,255, 0,0,0,255, 255,255,255,255]) };
  const settings = { opacity: 1, dimming: "vibrant" as const };
  assert.deepEqual(renderImageBackground(asset, 2, 1, settings, false, 0, "monochrome"), [" @"]);
  const ascii = renderImageBackground(asset, 2, 1, settings, false, 0, "truecolor", "ascii");
  assert.doesNotMatch(ascii.join(""), /▀/);
  for (const mode of modes) assertMode(renderImageBackground(asset, 2, 1, settings, false, 0, mode), mode);
  for (const width of [NaN, Infinity, 0, -1, 1.5, 80_001]) {
    assert.deepEqual(renderImageBackground(asset, width, 1, settings), []);
    assert.deepEqual(renderSceneViewport({ scene: "aurora", width, height: 1, timeMs: 0 }), []);
  }
  assert.equal(rgbToAnsi256(128, 128, 128), 244);
});

test("graphics environment hints never bypass verified native placement and cleanup", () => {
  try {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    for (const env of [{}, { TERM_PROGRAM: "kitty" }, { OMT_BACKGROUND_BACKEND: "kitty" },
      { TMUX: "yes", KITTY_WINDOW_ID: "1" }, { SSH_TTY: "yes", WEZTERM_PANE: "1" }]) {
      assert.equal(detectKittyBackendCapabilities(env).backend, "ansi");
    }
  } finally { resetCapabilitiesCache(); }
});

test("procedural catalog adapter loads identity without decoding raster animation", () => {
  const store = new BackgroundAssetStore("/nonexistent/omt-test");
  try {
    const id = store.resolveId("moonlit")!;
    const asset = store.load(id, true);
    assert.equal(asset.metadata.alias, "moonlit");
    assert.equal(asset.pixels.length, 0);
    assert.ok(store.load(id).pixels.length > 0, "legacy raster API preserved");
  } finally { store.dispose(); }
});

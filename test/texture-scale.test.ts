import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { visibleWidth, TuiAltScreen } from "@earendil-works/pi-tui";
import { ConfigStore, configStore, DEFAULT_CONFIG, validateConfig } from "../extensions/omt/core/config.ts";
import { resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";
import { motionCoordinator, setActiveTui } from "../extensions/omt/core/motion.ts";
import { renderScaledWallpaper } from "../extensions/omt/features/backgrounds/compositor/scale.ts";
import { BackgroundCompositor } from "../extensions/omt/features/backgrounds/compositor/index.ts";
import { BUILTIN_SCENES, renderSceneViewport, renderAmbientBackdrop } from "../extensions/omt/features/backgrounds/scenes/index.ts";
import { createPixelSampler, renderImageBackground } from "../extensions/omt/features/backgrounds/renderers/cell.ts";
import { renderManagedBackground } from "../extensions/omt/features/backgrounds/managed.ts";
import { getPresetBackgroundPalette } from "../extensions/omt/presets/index.ts";
import omt from "../extensions/omt/index.ts";

const pixels = Buffer.from([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255]);
const raster = { metadata: { width: 4, height: 1, frameCount: 1, frameMs: 0 }, pixels };

test("texture scale defaults/migration, validation, session overrides and saved preferences", () => {
  assert.equal(DEFAULT_CONFIG.background.textureScale, 1);
  for (const value of [undefined, NaN, Infinity, "0.5", null]) {
    assert.equal(validateConfig({ background: { textureScale: value } }).background.textureScale, 1);
  }
  assert.equal(validateConfig({ background: { textureScale: -1 } }).background.textureScale, 0.25);
  assert.equal(validateConfig({ background: { textureScale: 100 } }).background.textureScale, 2);
  const dir = mkdtempSync(join(tmpdir(), "omt-texture-config-"));
  try {
    writeFileSync(join(dir, "omt.json"), JSON.stringify({ version: 1, background: { fit: "tile" } }));
    const store = new ConfigStore(dir); store.init(dir);
    assert.equal(store.getBackground().textureScale, 1);
    store.setBackgroundOverride("textureScale", 0.5);
    assert.equal(store.getBackground().textureScale, 0.5);
    store.clearSessionOverrides(); assert.equal(store.getBackground().textureScale, 1);
    store.setBackgroundOverride("textureScale", 0.75); assert.ok(store.saveCurrentAsDefaults());
    store.init(dir); assert.equal(store.getBackground().textureScale, 0.75);
    store.restoreDefaults(); assert.equal(store.getBackground().textureScale, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cell texture resizing is bounded, palette-safe, deterministic, and a no-op at 1x", () => {
  const original = ["AB", "CD"];
  assert.equal(renderScaledWallpaper(2, 2, 1, () => original), original);
  assert.deepEqual(renderScaledWallpaper(2, 1, 0.5, () => ["abcd", "efgh"]), ["fh"]);
  assert.deepEqual(renderScaledWallpaper(4, 2, 2, () => ["ab"]), ["aabb", "aabb"]);
  for (const [width, height] of [[1, 1], [120, 45], [400, 200]]) {
    let calls = 0;
    const lines = renderScaledWallpaper(width!, height!, 0.25, (w, h) => {
      calls++; assert.ok(w * h <= 80_000);
      return Array(h).fill("\x1b[38;5;42m.\x1b[0m".repeat(w));
    });
    assert.equal(calls, 1); assert.equal(lines.length, height);
    assert.ok(lines.every(line => visibleWidth(line) === width));
  }
  for (const width of [0, -1, NaN, Infinity, 0.5, 80_001]) {
    assert.deepEqual(renderScaledWallpaper(width, 1, 0.5, () => { throw Error("must not render"); }), []);
  }
});

test("every scene honors texture scale without resizing framing, ambient rows or foreground", () => {
  for (const scene of Object.keys(BUILTIN_SCENES) as (keyof typeof BUILTIN_SCENES)[]) {
    const options = { scene, width: 40, height: 8, timeMs: 1234, asciiOnly: true, colorMode: "monochrome" as const };
    const base = renderSceneViewport(options);
    assert.deepEqual(renderSceneViewport({ ...options, textureScale: 1 }), base);
    const small = renderSceneViewport({ ...options, textureScale: 0.5 });
    assert.notDeepEqual(small, base, scene);
    assert.deepEqual(renderSceneViewport({ ...options, textureScale: 0.5 }), small);
    for (const scale of [0.25, 0.75, 1.5, 2]) {
      const framed = renderSceneViewport({ ...options, textureScale: scale, framing: "rail" });
      assert.equal(framed.length, 8); assert.ok(framed.every(line => visibleWidth(line) === 40));
      assert.ok(framed.every(line => line.startsWith("| ")));
    }
    assert.equal(renderAmbientBackdrop({ ...options, height: 1, textureScale: 0.5 }).length, 1);
    const foreground = ["  Native text", "\x1b[44m opaque panel \x1b[0m"];
    const composed = new BackgroundCompositor().compose(foreground, small, 40, 8);
    assert.ok(composed[0]!.includes("Native text"));
    assert.ok(composed[1]!.startsWith(foreground[1]!));
  }
});

test("raster fit and tile sample the scaled source without allocating a scaled image", () => {
  const settings = { fit: "center" as const, opacity: 1, dimming: "vibrant" as const };
  const normal = createPixelSampler(raster, 4, 1, settings);
  const explicit = createPixelSampler(raster, 4, 1, { ...settings, textureScale: 1 });
  for (let x = 0; x < 4; x++) assert.deepEqual(normal.sample(x, 0), explicit.sample(x, 0));
  const small = createPixelSampler(raster, 4, 1, { ...settings, textureScale: 0.5 });
  assert.deepEqual(small.sample(0, 0), [0,0,0]);
  assert.deepEqual(small.sample(1, 0), [0,255,0]);
  assert.deepEqual(small.sample(2, 0), [255,255,255]);
  const tiled = createPixelSampler(raster, 4, 1, { ...settings, fit: "tile", textureScale: 0.5 });
  assert.deepEqual(tiled.sample(0, 0), tiled.sample(2, 0));
  for (const fit of ["cover", "contain", "center", "tile"] as const) {
    const lines = renderImageBackground(raster, 20, 4, { ...settings, fit, textureScale: 0.5 });
    assert.ok(lines.every(line => visibleWidth(line) === 20));
  }
});

test("managed curated aliases and declarative packs propagate the shared texture scale", () => {
  const dir = mkdtempSync(join(tmpdir(), "omt-texture-managed-"));
  const store = new ConfigStore(dir);
  try {
    const asset = store.assets.load(store.assets.resolveId("moonlit")!, true);
    const palette = getPresetBackgroundPalette("codex-inspired");
    const draw = (textureScale: number) => renderManagedBackground(store.assets, asset, 40, 12,
      { textureScale }, 1000, "codex-inspired", palette, true, "monochrome");
    assert.notDeepEqual(draw(0.5), draw(1));
    const layer = { scene: "matrix" as const, speed: 1, seed: 1, density: 1, count: 20 };
    const pack = { ...asset, metadata: { ...asset.metadata, alias: undefined,
      scene: { motion: true, layers: [layer] }, imageIds: [] } };
    const plain = renderManagedBackground(store.assets, pack, 40, 12, { textureScale: 1 }, 1000, "codex-inspired", palette);
    const small = renderManagedBackground(store.assets, pack, 40, 12, { textureScale: 0.5 }, 1000, "codex-inspired", palette);
    assert.notDeepEqual(small, plain);
  } finally { store.assets.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("scale commands validate input, preserve playback and invalidate native asset render caches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omt-texture-native-"));
  const terminal = { columns: 40, rows: 16, write() {}, hideCursor() {}, showCursor() {}, stop() {} };
  const tui = new TuiAltScreen(terminal as any, true), native = tui as any;
  native.altScreenActive = true; native.stopped = false;
  tui.addChild({ render: () => ["Native foreground", "", "draft"], invalidate() {} });
  const notices: string[] = [], events = new Map<string, Function>(); let command: any;
  const ctx = { cwd: dir, mode: "tui", hasUI: true, ui: { getBackgroundTui: () => tui,
    setWidget() {}, notify: (m: string) => notices.push(m) } } as any;
  try {
    configStore.init(dir); setActiveTheme("codex-inspired");
    configStore.setAnimationOverride("mode", "off");
    omt({ registerFlag() {}, registerToolRenderer() {}, getFlag() {},
      registerCommand(_: string, cmd: any) { command = cmd; },
      on(name: string, callback: Function) { events.set(name, callback); } } as any);
    const path = join(dir, "scene.json");
    writeFileSync(path, JSON.stringify({ version: 1, type: "scene", name: "Texture scene", scene: { motion: false, layers: [{ scene: "matrix" }] } }));
    const asset = await configStore.assets.importFile(path);
    await command.handler(`background select ${asset.id}`, ctx);
    native.doRender(); const original = tui.getScreenLines();
    await command.handler("background scale 0.5x", ctx); native.doRender();
    assert.equal(configStore.getBackground().textureScale, 0.5);
    assert.notDeepEqual(tui.getScreenLines(), original);
    assert.ok(notices.at(-1)!.includes("0.5x"));
    assert.ok(command.getArgumentCompletions("background scale ").some((c: any) => c.value === "background scale 1x"));
    for (const input of ["NaN", "Infinity", "0", "0.1", "3", "0.5junk", "0.5 x", ""]) {
      await command.handler(`background scale ${input}`, ctx);
      assert.match(notices.at(-1)!, /Invalid texture scale/);
      assert.equal(configStore.getBackground().textureScale, 0.5);
    }
    await command.handler("bg scale 1", ctx); native.doRender();
    assert.deepEqual(tui.getScreenLines(), original);
    assert.equal(configStore.getBackground().playing, true);
    assert.equal(motionCoordinator.hasActive(), false);
  } finally {
    await events.get("session_shutdown")?.({}, ctx);
    motionCoordinator.dispose(); setActiveTui(undefined); resetActiveTheme(); tui.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BackgroundAssetStore, ASSET_LIMITS } from "../extensions/omt/features/backgrounds/assets/index.ts";
import { ConfigStore, cloneConfig, DEFAULT_CONFIG, validateConfig } from "../extensions/omt/core/config.ts";
import { BackgroundPlayhead, backgroundFrameAt } from "../extensions/omt/features/backgrounds/motion/index.ts";
import { renderImageBackground } from "../extensions/omt/features/backgrounds/renderers/cell.ts";
import { BackgroundCompositor, wallpaperCells } from "../extensions/omt/features/backgrounds/compositor/index.ts";
import { validateManifest } from "../extensions/omt/features/backgrounds/assets/manifest.ts";
import { managedBackgroundMoves, renderManagedBackground } from "../extensions/omt/features/backgrounds/managed.ts";
import { THEME_NAMES, getPresetBackgroundPalette } from "../extensions/omt/presets/index.ts";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";

function fixture(path: string): void {
  const result = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=32x24:rate=10", "-frames:v", "1", "-threads", "1", "-y", path]);
  assert.equal(result.status, 0, result.stderr?.toString());
}

test("Built-in background library: ships curated offline wallpapers with aliases, metadata, and safe immutability", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omt-library-test-"));
  try {
    const store = new BackgroundAssetStore(join(dir, "agent"));
    const library = store.listLibrary();
    assert.equal(library.length, 11);
    assert(library.every(asset => asset.kind === "animation" && asset.frameCount === 40 && asset.width === 160 && asset.height === 90));

    // Alias and ID resolution
    for (const alias of ["moonlit", "koi-pond", "jellyfish", "neon-rain", "star-voyage"]) {
      const resolved = store.resolveId(alias);
      assert.ok(resolved);
      assert.equal(store.resolveId(alias.toUpperCase()), resolved, "case-insensitive alias resolution");
      const metadata = store.metadata(alias);
      assert.equal(metadata.id, resolved);
      assert.equal(metadata.alias, alias);
      const loaded = store.load(alias);
      assert.equal(loaded.metadata.id, resolved);
      assert.equal(loaded.pixels.length, 160 * 90 * 4 * 40);
      assert.equal(store.getFriendlyName(resolved), metadata.name);
    }

    // Built-in backgrounds cannot be removed
    assert.throws(() => store.remove("moonlit"), /cannot be deleted/);
    const moonlitId = store.resolveId("moonlit")!;
    assert.throws(() => store.remove(moonlitId), /cannot be deleted/);

    // User assets and library co-exist cleanly
    assert.deepEqual(store.list(), [], "library assets do not pollute user asset directory list");
    assert.equal(store.listAll().length, 11);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Phase 1: validated static formats, stable IDs, one managed cache and all cell fits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omt-assets-"));
  try {
    const store = new BackgroundAssetStore(join(dir, "agent"));
    for (const extension of ["png", "jpg", "jpeg", "webp"]) {
      const path = join(dir, `image with  two spaces.${extension}`);
      fixture(path);
      const metadata = await store.importFile(path);
      assert.equal(metadata.kind, "image");
      assert.equal((await store.importFile(path)).id, metadata.id);
      const loaded = store.load(metadata.id);
      assert.equal(store.load(metadata.id), loaded);
      assert.equal(loaded.pixels.length, 32 * 24 * 4);
      for (const fit of ["cover", "contain", "center", "tile"] as const) {
        const settings = { ...cloneConfig(DEFAULT_CONFIG).background, fit, opacity: 1, dimming: "vibrant" as const };
        const lines = renderImageBackground(loaded, 40, 12, settings);
        assert.equal(lines.length, 12);
        assert(lines.every(line => visibleWidth(line) === 40));
        assert(wallpaperCells(lines, 40, 12).flat().some(cell => cell.includes("▀")));
        const native = `  \x1b]8;;https://example.org\x07界 text\x1b]8;;\x07${CURSOR_MARKER}`;
        const result = new BackgroundCompositor().compose([native], lines, 40, 12);
        assert(result[0]!.includes(native.slice(2)));
        assert.equal(new BackgroundCompositor().compose([native], lines, 40, 12, true)[0], native);
        assert(renderImageBackground(loaded, 20, 3, settings, true).every(line => !line.includes("▀")));
      }
      store.clear();
      assert.notEqual(store.load(metadata.id), loaded);
    }
    assert(store.list().length >= 3);
    const id = store.list()[0]!.id;
    store.remove(id);
    assert.throws(() => store.load(id));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Phase 1: missing, malformed, oversized, unsafe and corrupt managed assets fail closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omt-assets-invalid-"));
  try {
    const store = new BackgroundAssetStore(join(dir, "agent"));
    const path = join(dir, "image.png");
    await assert.rejects(store.importFile(path));
    writeFileSync(path, "not a png\x1b]52;payload\x07");
    await assert.rejects(store.importFile(path));
    writeFileSync(path, Buffer.alloc(ASSET_LIMITS.sourceBytes + 1));
    await assert.rejects(store.importFile(path));
    fixture(path);
    const giant = readFileSync(path); giant.writeUInt32BE(100_000, 16); writeFileSync(join(dir, "giant.png"), giant);
    await assert.rejects(store.importFile(join(dir, "giant.png")), /dimensions/);
    symlinkSync(path, join(dir, "link.png"));
    await assert.rejects(store.importFile(join(dir, "link.png")));
    await assert.rejects(store.importFile(dir));
    assert.throws(() => store.load("../../escape"));
    const metadata = await store.importFile(path);
    writeFileSync(join(store.root, metadata.id, "frames.rgba"), "broken");
    assert.throws(() => store.load(metadata.id), /Corrupt/);
    const agent = join(dir, "unsafe"); mkdirSync(agent);
    symlinkSync(dir, join(agent, "omt-assets"));
    await assert.rejects(new BackgroundAssetStore(agent).importFile(path), /Unsafe/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Phase 2: GIF and animated WebP decode once with bounded timed frames and loop metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omt-animation-"));
  try {
    const store = new BackgroundAssetStore(join(dir, "agent"));
    for (const extension of ["gif", "webp"]) {
      const path = join(dir, `animation.${extension}`);
      const result = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=32x24:rate=5", "-t", "0.6", "-loop", "0", "-threads", "1", "-y", path]);
      assert.equal(result.status, 0, result.stderr.toString());
      const metadata = await store.importFile(path);
      assert.equal(metadata.kind, "animation");
      assert.equal(metadata.loops, 0);
      assert.equal(metadata.frameMs, 100);
      assert(metadata.frameCount >= 3 && metadata.frameCount <= 6);
      const loaded = store.load(metadata.id);
      assert(loaded.pixels.length <= ASSET_LIMITS.decodedBytes);
      assert.notDeepEqual(loaded.pixels.subarray(0, 32 * 24 * 4), loaded.pixels.subarray(-32 * 24 * 4));
      assert.deepEqual(backgroundFrameAt(loaded, 100), { frame: 1, ended: false });
      assert.equal(backgroundFrameAt(loaded, metadata.frameCount * 100).frame, 0);
      const finite = { ...loaded, metadata: { ...metadata, loops: 1 } };
      assert.deepEqual(backgroundFrameAt(finite, 99_999), { frame: metadata.frameCount - 1, ended: true });
      store.clear();
      assert.equal(new BackgroundAssetStore(join(dir, "agent")).load(metadata.id).metadata.kind, "animation");
    }
    const clock = new BackgroundPlayhead();
    clock.advance(1000, true, 1); assert.equal(clock.advance(1100, true, 1), 100);
    clock.suspend(); clock.advance(50_000, true, 2);
    assert.equal(clock.advance(50_100, true, 2), 300, "pause and resume exclude paused wall time; speed integrates");
    clock.advance(60_000, false, 1); clock.advance(80_000, true, 1);
    assert.equal(clock.time, 300, "reduced motion, focus and activity pauses freeze time");
    clock.reset(); assert.equal(clock.time, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("decoder resources: missing FFmpeg, cancellation, excessive timing and truncated animation fail without partial assets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omt-decoder-limits-"));
  const originalPath = process.env.PATH;
  try {
    const path = join(dir, "image.png"); fixture(path);
    const store = new BackgroundAssetStore(join(dir, "agent"));
    process.env.PATH = join(dir, "missing-bin");
    await assert.rejects(store.importFile(path), /FFmpeg/);
    process.env.PATH = originalPath;
    const importing = store.importFile(path); store.dispose();
    await assert.rejects(importing, /cancelled/); assert.deepEqual(store.list(), []);
    const gif = join(dir, "long.gif");
    const generated = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=32x24:rate=5", "-t", "0.6", "-threads", "1", "-y", gif]);
    assert.equal(generated.status, 0);
    const bytes = readFileSync(gif), control = bytes.indexOf(Buffer.from([0x21, 0xf9, 4]));
    assert(control > 0); bytes.writeUInt16LE(65535, control + 4); writeFileSync(gif, bytes);
    await assert.rejects(store.importFile(gif), /30 seconds/);
    writeFileSync(gif, bytes.subarray(0, 30)); await assert.rejects(store.importFile(gif));
    assert.deepEqual(store.list(), []);
  } finally { process.env.PATH = originalPath; rmSync(dir, { recursive: true, force: true }); }
});

test("Phase 3: declarative scenes and theme packs share storage, palettes, procedural renderers and all presets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omt-scenes-"));
  try {
    const store = new BackgroundAssetStore(join(dir, "agent"));
    const manifest = { version: 1, type: "scene", name: "Quiet cosmos", palette: { primary: "#aaccff", secondary: "#445588", dim: "#112233" }, scene: { motion: true, layers: [{ scene: "starfield", density: 1.5, seed: 3 }, { scene: "particles", count: 10, speed: 0.5 }, { scene: "rain", density: 0.5 }] } };
    const path = join(dir, "scene.json"); writeFileSync(path, JSON.stringify(manifest));
    const meta = await store.importFile(path);
    assert.equal(meta.kind, "scene"); assert.equal((await store.importFile(path)).id, meta.id);
    const scene = store.load(meta.id);
    assert.equal(managedBackgroundMoves(scene), true);
    for (const preset of THEME_NAMES) {
      const bg = cloneConfig(DEFAULT_CONFIG).background;
      const first = renderManagedBackground(store, scene, 80, 24, bg, 0, preset, getPresetBackgroundPalette(preset));
      const second = renderManagedBackground(store, scene, 80, 24, bg, 1000, preset, getPresetBackgroundPalette(preset));
      assert(first.every(line => visibleWidth(line) === 80)); assert.notDeepEqual(first, second);
    }
    fixture(join(dir, "image.png"));
    const packPath = join(dir, "pack.json");
    writeFileSync(packPath, JSON.stringify({ ...manifest, type: "theme-pack", images: ["image.png"] }));
    const pack = await store.importFile(packPath);
    assert.equal(pack.kind, "pack"); assert.equal(pack.imageIds!.length, 1);
    rmSync(join(dir, "image.png"));
    const loaded = new BackgroundAssetStore(join(dir, "agent")).load(pack.id);
    assert.equal(loaded.metadata.scene!.layers.length, 3);
    const rendered = renderManagedBackground(store, loaded, 40, 12, cloneConfig(DEFAULT_CONFIG).background, 0, "minimal", getPresetBackgroundPalette("minimal"));
    assert(rendered.some(row => row.includes("▀")), "managed optional image survives source removal");
    store.remove(pack.imageIds![0]!);
    assert.equal(renderManagedBackground(store, loaded, 40, 12, cloneConfig(DEFAULT_CONFIG).background, 0, "minimal", getPresetBackgroundPalette("minimal")).length, 12, "removed optional image yields scene only");
    const staticScene = validateManifest({ ...manifest, scene: { ...manifest.scene, motion: false } });
    assert.equal(managedBackgroundMoves({ metadata: { ...meta, scene: staticScene.scene }, pixels: Buffer.alloc(0) }), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Phase 3: manifests reject code, malformed layers, unsafe colors/paths, symlinks and partial packs atomically", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omt-scenes-invalid-"));
  try {
    const store = new BackgroundAssetStore(join(dir, "agent"));
    const base = { version: 1, type: "theme-pack", name: "Safe", scene: { layers: [{ scene: "particles" }] } };
    for (const change of [{ script: "process.exit()" }, { name: "\x1b]52;escape" }, { scene: { layers: [{ scene: "unknown" }] } }, { scene: { layers: [{ scene: "rain", count: 10000 }] } }, { scene: { layers: Array(5).fill({ scene: "rain" }) } }, { palette: { primary: "red" } }, { images: ["../escape.png"] }, { images: ["/tmp/escape.png"] }, { images: ["https://example.org/file.png"] }, { images: ["foo\\escape.png"] }]) assert.throws(() => validateManifest({ ...base, ...change }));
    const path = join(dir, "pack.json");
    fixture(join(dir, "ok.png"));
    writeFileSync(path, JSON.stringify({ ...base, images: ["ok.png", "missing.png"] }));
    await assert.rejects(store.importFile(path)); assert.deepEqual(store.list(), [], "failed pack import rolls back newly imported assets");
    symlinkSync(dir, join(dir, "linked"));
    writeFileSync(path, JSON.stringify({ ...base, images: ["linked/ok.png"] }));
    await assert.rejects(store.importFile(path), /Unsafe/);
    writeFileSync(path, "{"); await assert.rejects(store.importFile(path));
    writeFileSync(path, " ".repeat(65_537)); await assert.rejects(store.importFile(path), /64 KiB/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Phase 1: ConfigStore owns assets and distinguishes persisted selections from session overrides", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omt-asset-config-"));
  try {
    const path = join(dir, "fixture.png"); fixture(path);
    const store = new ConfigStore(dir); store.init();
    const { id } = await store.assets.importFile(path);
    store.selectBackgroundAsset(id);
    assert.equal(store.getEffectiveBackgroundAsset(), id);
    assert.equal(store.getSavedDefaults().background.assetId, null);
    assert(store.saveCurrentAsDefaults());
    store.selectBackgroundAsset(null);
    assert.equal(store.getEffectiveBackgroundAsset(), null);
    store.init(); assert.equal(store.getEffectiveBackgroundAsset(), id);
    store.removeBackgroundAsset(id);
    store.init(); assert.equal(store.getEffectiveBackgroundAsset(), null);
    assert.equal(validateConfig({ background: { assetId: "../unsafe", opacity: 7, fps: 100, contrast: -2 } }).background.assetId, null);
    assert.equal(validateConfig({ background: { opacity: 7, fps: 100, contrast: -2 } }).background.fps, 30);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

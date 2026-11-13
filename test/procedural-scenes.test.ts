import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth, stripTerminalSequences } from "@earendil-works/pi-tui";
import {
  CURATED_SCENES,
  isCuratedScene,
  renderProceduralScene,
  hash,
  glyph,
  ell,
  drift,
  near,
  twinkle,
  rising,
  sketch,
  shape,
  flip,
  frame,
  shade,
  tint,
  haloOf,
  keepVeil,
  hexToRgb,
  rgbToHex,
  mixRgb,
} from "../extensions/omt/features/backgrounds/scenes/procedural.ts";
import { BUILTIN_SCENES, renderSceneViewport } from "../extensions/omt/features/backgrounds/scenes/index.ts";
import { VALID_BACKGROUND_SCENES } from "../extensions/omt/core/config.ts";

const ALL_11_EMBER_SCENES = [
  "moonlit",
  "cloud-drift",
  "honu-lagoon",
  "koi-pond",
  "jellyfish",
  "lantern-night",
  "fireflies",
  "neon-rain",
  "sakura-dusk",
  "snow-cabin",
  "star-voyage",
] as const;

test("Core procedural helper kit: math, hashing, geometry, palettes and halo", () => {
  // Deterministic 32-bit hash in [0, 1)
  const h1 = hash(42, 100, 3);
  const h2 = hash(42, 100, 3);
  assert.equal(h1, h2);
  assert.ok(h1 >= 0 && h1 < 1);
  assert.notEqual(hash(42, 100, 3), hash(43, 100, 3));

  // Color math: hex to RGB, RGB to hex, mix, shade, tint
  assert.deepEqual(hexToRgb("#1b2242"), [27, 34, 66]);
  assert.equal(rgbToHex([27, 34, 66]), "#1b2242");
  assert.deepEqual(mixRgb([0, 0, 0], [100, 200, 100], 0.5), [50, 100, 50]);
  assert.equal(shade("#ff0000", -0.5), "#800000"); // 50% darker red
  assert.equal(shade("#000000", 0.5), "#808080"); // 50% lighter black

  const tinted = tint("#7088d8", "#18214a", [0.35, 0.5]);
  assert.equal(Object.keys(tinted).length, 2);
  assert.equal(tinted["1"]!.bg, "#7088d8");
  assert.equal(tinted["1"]!.fg, "#18214a");
  assert.equal(tinted["1"]!.a, 0.35);

  // Geometry: ell, drift
  assert.equal(ell(10, 10, 10, 10, 5, 5), 0);
  assert.equal(ell(15, 10, 10, 10, 5, 5), 1);
  assert.equal(ell(20, 10, 10, 10, 5, 5), 4);
  const d1 = drift(80, 0.5, 0, 1, 10);
  const d2 = drift(80, 0.5, 10, 1, 10);
  assert.notEqual(d1, d2);

  // String shapes & sketches
  const testSketch = sketch(6, 3, [[0, 0, "AA"], [1, 2, "BB"], [2, 4, "CC"]]);
  assert.equal(testSketch.length, 3);
  assert.equal(testSketch[0], "AA....");
  assert.equal(testSketch[1], "..BB..");
  assert.equal(testSketch[2], "....CC");

  const flipped = flip(testSketch);
  assert.equal(flipped[0], "....AA");

  const framed = frame(["A", "B", "C"], 2.5, 1);
  assert.equal(framed, "C");

  // Halo detection: finds surrounding cells around non-'.' pixels
  const art = ["..A..", ".AAA.", "..A.."];
  const halo = haloOf(art);
  assert.ok(halo.length > 0);
  assert.ok(halo.every(([x, y]) => x >= -1 && x <= 5 && y >= -1 && y <= 3));

  // Glyphs and twinkles
  const g = glyph("ABCDE", 5, 10, 1.2);
  assert.ok("ABCDE".includes(g));
  const tw = twinkle(5, 5, 1.0, "#ffffff", 1.0);
  assert.ok(tw);
  assert.ok(tw.ch === "+" || tw.ch === ".");
});

test("Selective readability veil preserves margins and respects floor", () => {
  // Reading column between column 20 and 60
  const col: [number, number] = [20, 60];

  // Outside reading area (left margin col 5) -> veil multiplier is 1.0 (full brightness)
  assert.equal(keepVeil(col, 5), 1.0);
  // Outside reading area (right margin col 75) -> veil multiplier is 1.0
  assert.equal(keepVeil(col, 75), 1.0);

  // Deep inside reading area (col 40) -> attenuated to DIM (0.25)
  assert.equal(keepVeil(col, 40), 0.25);

  // Unbounded (no content column specified) -> keepVeil is 1.0 everywhere
  assert.equal(keepVeil(undefined, 40), 1.0);
});

test("All 11 built-in procedural scenes exist, have distinct IDs and are registered in BUILTIN_SCENES", () => {
  assert.equal(Object.keys(CURATED_SCENES).length, 11);

  for (const id of ALL_11_EMBER_SCENES) {
    assert.ok(isCuratedScene(id), `${id} is recognized as built-in scene`);
    const scene = CURATED_SCENES[id];
    assert.ok(scene, `scene ${id} exists`);
    assert.equal(scene.id, id);
    assert.ok(scene.name.length > 0);
    assert.ok(scene.tagline.length > 0);
    assert.ok(scene.cell || scene.sprites, `${id} defines cell or sprites`);

    // Verify registration in BUILTIN_SCENES and VALID_BACKGROUND_SCENES
    assert.ok(BUILTIN_SCENES[id], `${id} registered in BUILTIN_SCENES`);
    assert.ok(VALID_BACKGROUND_SCENES.includes(id), `${id} in VALID_BACKGROUND_SCENES`);
  }
});

test("All 11 scenes render across widths (120, 80, 40, 20) and heights without overflow or crash", () => {
  const widths = [120, 80, 40, 20];
  const heights = [24, 12, 6];

  for (const id of ALL_11_EMBER_SCENES) {
    for (const w of widths) {
      for (const h of heights) {
        const lines = renderProceduralScene(id, w, h, 1500, { width: w, height: h, timeMs: 1500 });
        assert.equal(lines.length, h, `${id} produces exact row count ${h}`);
        for (let r = 0; r < h; r++) {
          const vis = visibleWidth(lines[r]!);
          assert.equal(vis, w, `${id} row ${r} visible width matches target width ${w}`);
        }
      }
    }
  }
});

test("Procedural scenes are 100% deterministic and advance predictably over time", () => {
  for (const id of ALL_11_EMBER_SCENES) {
    const frameAt1s = renderProceduralScene(id, 80, 20, 1000);
    const frameAt1sAgain = renderProceduralScene(id, 80, 20, 1000);
    assert.deepEqual(frameAt1s, frameAt1sAgain, `${id} is 100% deterministic at t=1000ms`);

    const frameAt5s = renderProceduralScene(id, 80, 20, 5000);
    // At t=5000ms, animated motion should produce differing frames
    assert.notDeepEqual(frameAt1s, frameAt5s, `${id} evolves over time (t=1s vs t=5s)`);
  }
});

test("Procedural scenes support tranquil static snapshots under reduced-motion mode", () => {
  for (const id of ALL_11_EMBER_SCENES) {
    const reduced1 = renderProceduralScene(id, 60, 15, 1000, { width: 60, height: 15, timeMs: 1000, reducedMotion: true });
    const reduced2 = renderProceduralScene(id, 60, 15, 8000, { width: 60, height: 15, timeMs: 8000, reducedMotion: true });
    // In reduced motion mode, t is clamped to 0 so all timestamps produce identical tranquil snapshot
    assert.deepEqual(reduced1, reduced2, `${id} remains static under reduced motion`);
  }
});

test("Procedural scenes support plain ASCII fallback mode", () => {
  for (const id of ALL_11_EMBER_SCENES) {
    const lines = renderProceduralScene(id, 80, 20, 2500, { width: 80, height: 20, timeMs: 2500, asciiOnly: true });
    assert.equal(lines.length, 20);
    for (const line of lines) {
      const stripped = stripTerminalSequences(line);
      assert.ok(/^[\x20-\x7e]*$/.test(stripped), `${id} contains only standard ASCII printable characters in asciiOnly mode`);
    }
  }
});

test("Scene-specific visual features and geometry: Moonlit", () => {
  // Moonlit crescent moon sits at cols * 0.74, rows * 0.22
  const lines = renderProceduralScene("moonlit", 100, 30, 2000, { width: 100, height: 30, timeMs: 2000, dimming: "vibrant" });
  const moonRow = Math.round(30 * 0.22);
  assert.ok(lines[moonRow]!.includes("48;2;"), "moon tile has background color in moon row");
  // Stars twinkle in the upper sky
  assert.ok(lines.slice(0, 10).some(line => line.includes("+") || line.includes(".")));
});

test("Scene-specific visual features and geometry: Neon Rain", () => {
  const lines = renderProceduralScene("neon-rain", 80, 25, 2000, { width: 80, height: 25, timeMs: 2000, dimming: "vibrant", intensity: "high" });
  // Ground street is at rows - 3
  const groundRow = lines[22]!;
  assert.ok(groundRow.includes("_") || groundRow.includes("o") || groundRow.includes("~"), "street puddles and reflections");
  // City building walls and rain streaks are rendered
  const allText = lines.join("\n");
  assert.ok(allText.includes("48;2;17;22;45") || allText.includes("48;2;27;34;66") || allText.includes("/"), "city buildings and rain streaks");
});

test("Scene-specific visual features and geometry: Sakura Dusk", () => {
  const lines = renderProceduralScene("sakura-dusk", 80, 24, 2000, { width: 80, height: 24, timeMs: 2000, dimming: "vibrant", intensity: "high" });
  // Cherry blossom branches at top corners
  const topRow = lines[0]!;
  assert.ok(topRow.includes("48;2;42;26;36") || topRow.includes("247;168;196"), "cherry blossom petal/branch colors in top row");
  // Falling petals tumble across the height
  assert.ok(lines.slice(5, 20).some(line => line.includes("P") || line.includes("'") || line.includes("247;168;196")), "falling petals");
});

test("Scene-specific visual features and geometry: Snow Cabin", () => {
  const lines = renderProceduralScene("snow-cabin", 80, 24, 2000, { width: 80, height: 24, timeMs: 2000, dimming: "vibrant", intensity: "high" });
  // Pine tree needles (#1f3a35 -> 31;58;53) and snow (#dbe6f6 -> 219;230;246)
  const allText = lines.join("\n");
  assert.ok(allText.includes("31;58;53") || allText.includes("219;230;246"), "pine trees and snow colors");
});

test("Scene-specific visual features and geometry: Star Voyage", () => {
  const lines = renderProceduralScene("star-voyage", 100, 30, 2000, { width: 100, height: 30, timeMs: 2000, dimming: "vibrant", intensity: "high" });
  // Rocket trail puffs, stars and cosmic glow
  const allText = lines.join("\n");
  assert.ok(allText.includes("+") || allText.includes(".") || allText.includes("o") || allText.includes("48;2;"), "rocket, planet and stardust");
});

test("renderSceneViewport integrates with all 11 built-in scenes and supports framing", () => {
  for (const id of ALL_11_EMBER_SCENES) {
    // Framing "bracket"
    const bracketed = renderSceneViewport({
      scene: id,
      width: 80,
      height: 4,
      timeMs: 1200,
      framing: "bracket",
    });
    assert.equal(bracketed.length, 4);
    assert.equal(visibleWidth(bracketed[0]!), 80);

    // Framing "rail"
    const railed = renderSceneViewport({
      scene: id,
      width: 80,
      height: 3,
      timeMs: 1200,
      framing: "rail",
    });
    assert.equal(railed.length, 3);
    assert.equal(visibleWidth(railed[0]!), 80);

    // Framing "none"
    const none = renderSceneViewport({
      scene: id,
      width: 60,
      height: 4,
      timeMs: 1200,
      framing: "none",
    });
    assert.equal(none.length, 4);
    assert.equal(visibleWidth(none[0]!), 60);
  }
});

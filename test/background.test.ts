import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConfigStore,
  DEFAULT_CONFIG,
  VALID_BACKGROUND_DIMMINGS,
  VALID_BACKGROUND_INTENSITIES,
  VALID_BACKGROUND_MODES,
  VALID_BACKGROUND_SCENES,
  validateConfig,
  type BackgroundDimming,
  type BackgroundIntensity,
  type BackgroundMode,
  type BackgroundScene,
} from "../extensions/omt/core/config.ts";
import { setActiveTheme, resetActiveTheme } from "../extensions/omt/core/theme.ts";
import {
  applyDimming,
  auroraScene,
  BUILTIN_SCENES,
  evaluateFullBackdropSupport,
  formatRgb,
  formatRgbBg,
  getSceneImplementation,
  lerpColor,
  matrixScene,
  particlesScene,
  rainScene,
  renderAmbientBackdrop,
  renderSceneViewport,
  starfieldScene,
} from "../extensions/omt/features/backgrounds/scenes/index.ts";
import {
  createBackgroundControl,
  OMT_BACKGROUND_BELOW_WIDGET_ID,
  OMT_BACKGROUND_WIDGET_ID,
} from "../extensions/omt/features/backgrounds/integration.ts";
import {
  createWallpaperViewerComponent,
  WallpaperViewerComponent,
} from "../extensions/omt/features/wallpaper-viewer/index.ts";
import {
  getPresetBackgroundPalette,
  PRESET_BACKGROUND_PALETTES,
} from "../extensions/omt/presets/index.ts";
import { motionCoordinator } from "../extensions/omt/core/motion.ts";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

test("validateConfig handles valid, partial, corrupt, and legacy background configurations", () => {
  // Empty / partial config defaults to disabled background
  const initial = validateConfig({});
  assert.equal(initial.background.enabled, false);
  assert.equal(initial.background.mode, "off");
  assert.equal(initial.background.scene, "aurora");
  assert.equal(initial.background.speed, 1.0);
  assert.equal(initial.background.intensity, "medium");
  assert.equal(initial.background.dimming, "subtle");
  assert.equal(initial.background.pauseOnActivity, true);
  assert.equal(initial.background.presetScenes?.["codex-inspired"], "matrix");
  assert.equal(initial.background.presetScenes?.["claude-code-inspired"], "aurora");
  assert.equal(initial.background.presetScenes?.["opencode-inspired"], "rain");
  assert.equal(initial.background.presetScenes?.["minimal"], "starfield");

  // Valid background configuration
  const valid = validateConfig({
    background: {
      enabled: true,
      mode: "scene",
      scene: "matrix",
      speed: 1.5,
      intensity: "high",
      dimming: "vibrant",
      pauseOnActivity: false,
      presetScenes: {
        "codex-inspired": "particles",
      },
    },
  });
  assert.equal(valid.background.enabled, true);
  assert.equal(valid.background.mode, "scene");
  assert.equal(valid.background.scene, "matrix");
  assert.equal(valid.background.speed, 1.5);
  assert.equal(valid.background.intensity, "high");
  assert.equal(valid.background.dimming, "vibrant");
  assert.equal(valid.background.pauseOnActivity, false);
  assert.equal(valid.background.presetScenes?.["codex-inspired"], "particles");

  // Invalid values fall back gracefully to safe defaults
  const invalid = validateConfig({
    background: {
      enabled: "yes",
      mode: "hyper-mode",
      scene: "fireworks",
      speed: -10,
      intensity: "extreme",
      dimming: "ultra-bright",
      pauseOnActivity: "never",
      presetScenes: {
        "codex-inspired": "invalid-scene",
      },
    },
  });
  assert.equal(invalid.background.enabled, false);
  assert.equal(invalid.background.mode, "off");
  assert.equal(invalid.background.scene, "aurora");
  assert.equal(invalid.background.speed, 1.0);
  assert.equal(invalid.background.intensity, "medium");
  assert.equal(invalid.background.dimming, "subtle");
  assert.equal(invalid.background.pauseOnActivity, true);
});

test("ConfigStore manages background overrides, per-preset scenes, and defaults", () => {
  const store = new ConfigStore();
  store.init();

  assert.equal(store.isBackgroundEnabled(), false);
  assert.equal(store.getEffectiveBackgroundScene(), "matrix"); // Codex default preset uses matrix

  // Enable background with scene mode
  store.setBackgroundOverride("enabled", true);
  store.setBackgroundOverride("mode", "scene");
  store.setBackgroundOverride("scene", "starfield");
  assert.equal(store.isBackgroundEnabled(), true);
  assert.equal(store.getBackground().mode, "scene");

  // Setting preset scene override
  store.setPresetSceneOverride("claude-code-inspired", "particles");
  store.setPresetOverride("claude-code-inspired");
  assert.equal(store.getEffectiveBackgroundScene(), "particles");

  // Overrides detection
  assert.equal(store.hasOverride("background"), true);
  assert.equal(store.hasOverride("mode"), true);

  // Clearing overrides restores defaults
  store.clearSessionOverrides();
  assert.equal(store.isBackgroundEnabled(), false);
  assert.equal(store.getBackground().mode, "off");
});

test("Color math, dimming factors, and ANSI formatting", () => {
  const baseColor: [number, number, number] = [100, 200, 50];

  const dim = applyDimming(baseColor, "dim");
  assert.deepEqual(dim, [35, 70, 18]); // 0.35x

  const subtle = applyDimming(baseColor, "subtle");
  assert.deepEqual(subtle, [65, 130, 33]); // 0.65x

  const vibrant = applyDimming(baseColor, "vibrant");
  assert.deepEqual(vibrant, [100, 200, 50]); // 1.0x

  // Lerp color
  const c1: [number, number, number] = [0, 0, 0];
  const c2: [number, number, number] = [100, 200, 50];
  const mid = lerpColor(c1, c2, 0.5);
  assert.deepEqual(mid, [50, 100, 25]);

  // ANSI formatting
  const ansiFg = formatRgb(10, 20, 30, "hello");
  assert.equal(ansiFg, "\x1b[38;2;10;20;30mhello\x1b[0m");

  const ansiBg = formatRgbBg(10, 20, 30, "world");
  assert.equal(ansiBg, "\x1b[48;2;10;20;30mworld\x1b[0m");
});

test("Preset background palettes match milestone aesthetic guidelines", () => {
  const codex = getPresetBackgroundPalette("codex-inspired");
  assert.equal(codex.defaultScene, "matrix");
  assert.deepEqual(codex.primary, [0, 255, 102]); // Cyber green

  const claude = getPresetBackgroundPalette("claude-code-inspired");
  assert.equal(claude.defaultScene, "aurora");
  assert.deepEqual(claude.primary, [215, 119, 87]); // Terracotta #d77757

  const opencode = getPresetBackgroundPalette("opencode-inspired");
  assert.equal(opencode.defaultScene, "rain");
  assert.deepEqual(opencode.primary, [0, 212, 255]); // Electric cyan

  const minimal = getPresetBackgroundPalette("minimal");
  assert.equal(minimal.defaultScene, "starfield");
  assert.deepEqual(minimal.primary, [180, 180, 180]); // Silver monochrome

  const native = getPresetBackgroundPalette("native");
  assert.equal(native.label, "Native Presentation (Disabled)");
});

test("All 5 built-in procedural scenes render within exact terminal widths without overflow", () => {
  const widths = [120, 80, 40, 20];
  const heights = [4, 3, 2];
  const scenes: BackgroundScene[] = ["aurora", "starfield", "rain", "matrix", "particles"];

  for (const scene of scenes) {
    const impl = getSceneImplementation(scene);
    assert.ok(impl);
    assert.equal(impl.name, scene);

    for (const width of widths) {
      for (const height of heights) {
        const lines = impl.render({
          width,
          height,
          timeMs: 1500,
          speed: 1.0,
          intensity: "medium",
          dimming: "subtle",
          reducedMotion: false,
          asciiOnly: false,
        });

        assert.equal(lines.length, height);
        for (const line of lines) {
          const vis = visibleWidth(line);
          assert.equal(vis, width, `Scene ${scene} at width ${width} had visible width ${vis}`);
        }
      }
    }
  }
});

test("Scenes support plain ASCII fallback and reduced-motion static snapshots", () => {
  const scenes: BackgroundScene[] = ["aurora", "starfield", "rain", "matrix", "particles"];

  for (const scene of scenes) {
    const impl = getSceneImplementation(scene);

    // ASCII-only fallback: no box drawing or non-ASCII unicode
    const asciiLines = impl.render({
      width: 60,
      height: 3,
      timeMs: 1000,
      speed: 1.0,
      intensity: "medium",
      dimming: "subtle",
      reducedMotion: false,
      asciiOnly: true,
    });
    for (const line of asciiLines) {
      const stripped = stripTerminalSequences(line);
      assert.match(stripped, /^[\x20-\x7E]*$/, `Scene ${scene} produced non-ASCII characters under asciiOnly`);
    }

    // Reduced motion: deterministic frozen frame across multiple render passes
    const static1 = impl.render({
      width: 60,
      height: 3,
      timeMs: 100,
      speed: 1.0,
      intensity: "medium",
      dimming: "subtle",
      reducedMotion: true,
      asciiOnly: false,
    });
    const static2 = impl.render({
      width: 60,
      height: 3,
      timeMs: 99999, // very different time
      speed: 1.0,
      intensity: "medium",
      dimming: "subtle",
      reducedMotion: true,
      asciiOnly: false,
    });
    assert.deepEqual(static1, static2, `Reduced-motion mode for ${scene} must remain static regardless of time`);
  }
});

test("evaluateFullBackdropSupport explicitly audits compositor boundaries and preserves scrollback", () => {
  const evaluation = evaluateFullBackdropSupport();
  assert.equal(evaluation.supported, false);
  assert.equal(evaluation.mode, "unsupported");
  assert.ok(evaluation.reason.includes("scrollback"));
  assert.ok(evaluation.limitations.length >= 2);
  assert.ok(evaluation.safeSurfaces.length >= 2);
});

test("renderAmbientBackdrop renders compact subtle 1-line backdrop", () => {
  const lines = renderAmbientBackdrop({
    width: 80,
    height: 1,
    timeMs: 1000,
    scene: "aurora",
  });
  assert.equal(lines.length, 1);
  assert.equal(visibleWidth(lines[0]!), 80);
});

test("BackgroundControl manages widget mounting, mode transitions, and motion coordination", () => {
  const mountedWidgets: Record<string, any> = {};
  const mockContext = {
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget: (id: string, widget: any) => {
        if (widget === undefined) delete mountedWidgets[id];
        else mountedWidgets[id] = widget;
      },
    },
  } as any;

  const bgControl = createBackgroundControl();

  // Initially disabled
  assert.equal(bgControl.isEnabled(), false);
  assert.equal(motionCoordinator.hasActive(), false);

  // Turn on background
  const onMsg = bgControl.on(mockContext);
  assert.match(onMsg, /OMT background on/);
  assert.equal(bgControl.isEnabled(), true);
  assert.ok(mountedWidgets[OMT_BACKGROUND_WIDGET_ID]);

  // Set mode to ambient
  const ambientMsg = bgControl.setMode("ambient", mockContext);
  assert.match(ambientMsg, /mode set to ambient/);
  assert.ok(mountedWidgets[OMT_BACKGROUND_WIDGET_ID]);
  assert.equal(mountedWidgets[OMT_BACKGROUND_BELOW_WIDGET_ID], undefined);

  // Unsupported full mode leaves the native layout untouched, no scene substitute.
  const fullMsg = bgControl.setMode("full", mockContext);
  assert.match(fullMsg, /mode set to full/);
  assert.match(fullMsg, /requires a recognized native TuiAltScreen/);
  assert.equal(mountedWidgets[OMT_BACKGROUND_WIDGET_ID], undefined);
  assert.equal(mountedWidgets[OMT_BACKGROUND_BELOW_WIDGET_ID], undefined);

  // Pause and resume
  assert.equal(bgControl.isPaused(), false);
  bgControl.pause();
  assert.equal(bgControl.isPaused(), true);
  bgControl.resume();
  assert.equal(bgControl.isPaused(), false);

  // Agent activity pause integration
  bgControl.notifyActivityStart();
  assert.equal(bgControl.isPaused(), true);
  bgControl.notifyActivityEnd();
  assert.equal(bgControl.isPaused(), false);

  // Turn off background
  const offMsg = bgControl.off(mockContext);
  assert.match(offMsg, /OMT background off/);
  assert.equal(bgControl.isEnabled(), false);
  assert.equal(mountedWidgets[OMT_BACKGROUND_WIDGET_ID], undefined);
  assert.equal(mountedWidgets[OMT_BACKGROUND_BELOW_WIDGET_ID], undefined);

  bgControl.cleanup(mockContext);
});

test("WallpaperViewerComponent renders interactive modal and handles keyboard input", () => {
  let doneCalled = false;
  let appliedScene: BackgroundScene | undefined;
  let appliedMode: BackgroundMode | undefined;

  const mockTui = {
    requestRender: () => {},
  } as any;

  const mockTheme = {
    fg: (_c: string, text: string) => text,
    bg: (_c: string, text: string) => text,
    bold: (text: string) => text,
    dim: (text: string) => text,
  } as any;

  const mockCtx = {
    mode: "tui",
    hasUI: true,
    ui: { notify: () => {} },
  } as any;

  const viewer = createWallpaperViewerComponent(
    mockTui,
    mockTheme,
    {} as any,
    () => { doneCalled = true; },
    mockCtx,
    {
      initialScene: "matrix",
      onApply: (scene, mode) => {
        appliedScene = scene;
        appliedMode = mode;
      },
    },
  );

  // Renders cleanly across widths (including degenerate narrow viewports <= 1 col)
  const widths = [120, 80, 40, 20];
  for (const w of widths) {
    const rendered = viewer.render(w);
    assert.ok(rendered.length > 5);
    for (const line of rendered) {
      assert.ok(visibleWidth(line) <= w, `Line exceeded target width ${w}`);
    }
  }

  // Degenerate terminal widths <= 1 must not throw RangeError
  assert.doesNotThrow(() => viewer.render(1));
  assert.doesNotThrow(() => viewer.render(0));

  // Keyboard navigation: cycle scene
  viewer.handleInput("l"); // Next scene
  // Cycle mode
  viewer.handleInput("m");
  // Cycle speed
  viewer.handleInput("s");
  // Cycle intensity
  viewer.handleInput("i");
  // Cycle dimming
  viewer.handleInput("d");
  // Pause / resume
  viewer.handleInput(" ");
  viewer.handleInput(" ");

  // Enter triggers onApply callback
  viewer.handleInput("\r");
  assert.ok(appliedScene);
  assert.ok(appliedMode);

  // 'q' dismisses
  assert.equal(doneCalled, false);
  viewer.handleInput("q");
  assert.equal(doneCalled, true);

  viewer.dispose();
});

test("Slash command completions include background and wallpaper controls", async () => {
  let registeredCommand: any;
  const mockPi = {
    registerFlag: () => {},
    registerToolRenderer: () => {},
    registerCommand: (name: string, cmd: any) => {
      if (name === "omt") registeredCommand = cmd;
    },
    on: () => {},
    getFlag: () => undefined,
  };

  const { default: omt } = await import("../extensions/omt/index.ts");
  omt(mockPi as any);
  assert.ok(registeredCommand);

  const bgCompletions = registeredCommand.getArgumentCompletions("background");
  assert.ok(bgCompletions && bgCompletions.length >= 5);
  assert.ok(bgCompletions.some((c: any) => c.value === "background on"));
  assert.ok(bgCompletions.some((c: any) => c.value === "background off"));
  assert.ok(bgCompletions.some((c: any) => c.value === "background mode scene"));
  assert.ok(bgCompletions.some((c: any) => c.value === "background scene matrix"));

  const wallCompletions = registeredCommand.getArgumentCompletions("wall");
  assert.ok(wallCompletions && wallCompletions.some((c: any) => c.value === "wallpaper"));

  // Command handlers
  const notifications: string[] = [];
  const mockCtx = {
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget: () => {},
      notify: (msg: string) => { notifications.push(msg); },
    },
  };

  await registeredCommand.handler("background on", mockCtx);
  assert.ok(notifications.some((m) => m.includes("OMT background on")));

  await registeredCommand.handler("background scene starfield", mockCtx);
  assert.ok(notifications.some((m) => m.includes("scene set to starfield")));

  await registeredCommand.handler("background mode ambient", mockCtx);
  assert.ok(notifications.some((m) => m.includes("mode set to ambient")));

  await registeredCommand.handler("background off", mockCtx);
  assert.ok(notifications.some((m) => m.includes("OMT background off")));
});

test("Matrix animation renders in designated region with framing and exact width containment", () => {
  const mountedWidgets: Record<string, any> = {};
  let capturedTui: any;
  const mockTui = {
    requestRender: () => {},
  };
  const mockContext = {
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget: (id: string, widget: any) => {
        if (widget === undefined) delete mountedWidgets[id];
        else {
          mountedWidgets[id] = widget;
          capturedTui = widget(mockTui, {});
        }
      },
    },
  } as any;

  setActiveTheme("codex-inspired");
  const bgControl = createBackgroundControl();
  bgControl.on(mockContext);
  bgControl.setScene("matrix", mockContext);

  assert.ok(capturedTui);

  // Across terminal widths: 120, 80, 50, 40, 20
  const widths = [120, 80, 50, 40, 20];
  for (const width of widths) {
    const lines = capturedTui.render(width);
    const expectedHeight = width >= 80 ? 4 : width >= 50 ? 3 : 2;
    assert.equal(lines.length, expectedHeight, `Line count mismatch at width ${width}`);

    for (const line of lines) {
      const vis = visibleWidth(line);
      assert.equal(vis, width, `Line visible width ${vis} did not match target width ${width}`);
      assert.ok(!line.includes("\n"), "Scene line must not contain embedded newlines");
      assert.ok(!line.includes("\r"), "Scene line must not contain carriage returns");

      // Verify framing: bracket delimiters present for Codex preset on standard viewports
      if (width >= 40) {
        const stripped = stripTerminalSequences(line);
        assert.ok(stripped.startsWith("╎ ") || stripped.startsWith("| "), "Expected bracket prefix delimiter");
        assert.ok(stripped.endsWith(" ╎") || stripped.endsWith(" |"), "Expected bracket suffix delimiter");
      }
    }
  }

  bgControl.cleanup(mockContext);
  resetActiveTheme();
});

test("Animation frames replace previous frames in place without accumulation or line growth", () => {
  const mountedWidgets: Record<string, any> = {};
  let comp: any;
  const mockTui = {
    requestRender: () => {},
  };
  const mockContext = {
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget: (id: string, widget: any) => {
        if (widget === undefined) delete mountedWidgets[id];
        else {
          mountedWidgets[id] = widget;
          comp = widget(mockTui, {});
        }
      },
    },
  } as any;

  const bgControl = createBackgroundControl();
  bgControl.on(mockContext);
  bgControl.setScene("matrix", mockContext);

  const width = 80;
  const frame1 = comp.render(width);
  const frame2 = comp.render(width);
  const frame3 = comp.render(width);

  // Deterministic line counts across all frames (no accumulation or height fluctuations)
  assert.equal(frame1.length, 4);
  assert.equal(frame2.length, 4);
  assert.equal(frame3.length, 4);

  for (let i = 0; i < 4; i++) {
    assert.equal(visibleWidth(frame1[i]!), width);
    assert.equal(visibleWidth(frame2[i]!), width);
    assert.equal(visibleWidth(frame3[i]!), width);
  }

  bgControl.cleanup(mockContext);
});

test("Activity pause prevents frame leaking into transcript during active agent execution", () => {
  const mountedWidgets: Record<string, any> = {};
  const mockContext = {
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget: (id: string, widget: any) => {
        if (widget === undefined) delete mountedWidgets[id];
        else mountedWidgets[id] = widget;
      },
    },
  } as any;

  const bgControl = createBackgroundControl();
  bgControl.on(mockContext);
  assert.equal(bgControl.isPaused(), false);
  assert.equal(motionCoordinator.hasActive(), true);

  // Activity start pauses motion
  bgControl.notifyActivityStart();
  assert.equal(bgControl.isPaused(), true);
  assert.equal(motionCoordinator.hasActive(), false);

  // Nested activity keeps paused
  bgControl.notifyActivityStart();
  assert.equal(bgControl.isPaused(), true);
  assert.equal(motionCoordinator.hasActive(), false);

  // Activity ends resume motion when all settled
  bgControl.notifyActivityEnd();
  assert.equal(bgControl.isPaused(), true);
  bgControl.notifyActivityEnd();
  assert.equal(bgControl.isPaused(), false);
  assert.equal(motionCoordinator.hasActive(), true);

  // Settling activity must not override an explicit user playback pause.
  bgControl.pause();
  assert.equal(bgControl.isPaused(), true);
  bgControl.notifySettled();
  assert.equal(bgControl.isPaused(), true);
  assert.equal(motionCoordinator.hasActive(), false);
  bgControl.resume();
  assert.equal(bgControl.isPaused(), false);
  assert.equal(motionCoordinator.hasActive(), true);

  bgControl.cleanup(mockContext);
  assert.equal(motionCoordinator.hasActive(), false);
});

test("Background off cleanly unmounts all widgets and restores original state", () => {
  const mountedWidgets: Record<string, any> = {};
  const mockContext = {
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget: (id: string, widget: any) => {
        if (widget === undefined) delete mountedWidgets[id];
        else mountedWidgets[id] = widget;
      },
    },
  } as any;

  const bgControl = createBackgroundControl();
  bgControl.on(mockContext);
  assert.ok(mountedWidgets[OMT_BACKGROUND_WIDGET_ID]);
  assert.equal(motionCoordinator.hasActive(), true);

  // Turn off
  const offMsg = bgControl.off(mockContext);
  assert.equal(offMsg, "OMT background off.");
  assert.equal(mountedWidgets[OMT_BACKGROUND_WIDGET_ID], undefined);
  assert.equal(mountedWidgets[OMT_BACKGROUND_BELOW_WIDGET_ID], undefined);
  assert.equal(motionCoordinator.hasActive(), false);

  // No residual timers or active sources
  assert.equal(bgControl.getStats().activeSources, 0);
  assert.equal(bgControl.isEnabled(), false);

  bgControl.cleanup(mockContext);
});


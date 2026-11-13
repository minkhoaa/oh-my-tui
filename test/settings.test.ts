import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_CONFIG,
  ConfigStore,
  loadConfig,
  saveConfig,
  validateConfig,
} from "../extensions/omt/core/config.ts";
import { createSettingsComponent } from "../extensions/omt/features/settings-ui/index.ts";

test("validateConfig handles valid, partial, corrupt, and legacy configurations safely", () => {
  // Empty or invalid inputs
  assert.deepEqual(validateConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(validateConfig(undefined), DEFAULT_CONFIG);
  assert.deepEqual(validateConfig("not an object"), DEFAULT_CONFIG);
  assert.deepEqual(validateConfig([]), DEFAULT_CONFIG);

  // Partial input merges with defaults
  const partial = validateConfig({ preset: "omt-ember" });
  assert.equal(partial.preset, "omt-ember");
  assert.deepEqual(partial.components, DEFAULT_CONFIG.components);
  assert.deepEqual(partial.animation, DEFAULT_CONFIG.animation);

  // Legacy aliases resolve correctly
  const aliasClean = validateConfig({ preset: "clean" });
  assert.equal(aliasClean.preset, "omt-clean");
  const aliasEmber = validateConfig({ preset: "ember" });
  assert.equal(aliasEmber.preset, "omt-ember");
  const aliasRail = validateConfig({ preset: "rail" });
  assert.equal(aliasRail.preset, "omt-rail");

  // Invalid values fall back to safe defaults
  const invalid = validateConfig({
    preset: "nonexistent-preset",
    components: { editor: "yes", messages: 123 },
    animation: { mode: "hyper", speed: -5, reducedMotion: "banana" },
  });
  assert.equal(invalid.preset, DEFAULT_CONFIG.preset);
  assert.equal(invalid.components.editor, true);
  assert.equal(invalid.components.messages, true);
  assert.equal(invalid.animation.mode, "full");
  assert.equal(invalid.animation.speed, 1.0);
  assert.equal(invalid.animation.reducedMotion, "auto");
});

test("loadConfig and saveConfig persist to disk and handle missing directories gracefully", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "omt-cfg-test-"));
  try {
    // Missing file returns default config
    const initial = loadConfig(tempDir);
    assert.deepEqual(initial, DEFAULT_CONFIG);

    // Saving valid config writes omt.json
    const updated = {
      ...DEFAULT_CONFIG,
      preset: "omt-rail" as const,
      components: { ...DEFAULT_CONFIG.components, editor: false },
      animation: { mode: "subtle" as const, speed: 1.5, reducedMotion: "reduced" as const },
    };
    const saved = saveConfig(updated, tempDir);
    assert.equal(saved, true);

    const reloaded = loadConfig(tempDir);
    assert.deepEqual(reloaded, updated);

    // Corrupt JSON falls back safely to default config
    writeFileSync(join(tempDir, "omt.json"), "invalid json content {{{");
    const corrupted = loadConfig(tempDir);
    assert.deepEqual(corrupted, DEFAULT_CONFIG);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ConfigStore acts as a single source of truth and distinguishes session overrides from saved defaults", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "omt-store-test-"));
  try {
    const store = new ConfigStore(tempDir);
    store.init();

    // Initially matches defaults, no overrides
    assert.deepEqual(store.getSavedDefaults(), DEFAULT_CONFIG);
    assert.deepEqual(store.getEffectiveConfig(), DEFAULT_CONFIG);
    assert.equal(store.hasAnyOverrides(), false);

    // Setting a session override changes effective config without modifying saved defaults
    store.setPresetOverride("omt-ember");
    store.setComponentOverride("footer", false);
    store.setAnimationOverride("mode", "subtle");

    assert.equal(store.getPreset(), "omt-ember");
    assert.equal(store.isComponentEnabled("footer"), false);
    assert.equal(store.isComponentEnabled("editor"), true);
    assert.equal(store.getAnimation().mode, "subtle");
    assert.equal(store.hasAnyOverrides(), true);
    assert.equal(store.hasOverride("preset"), true);
    assert.equal(store.hasOverride("footer"), true);
    assert.equal(store.hasOverride("editor"), false);

    // Saved defaults on disk remain untouched
    assert.equal(store.getSavedDefaults().preset, "omt-signature");
    assert.equal(store.getSavedDefaults().components.footer, true);

    // Clearing session overrides restores saved defaults
    store.clearSessionOverrides();
    assert.equal(store.hasAnyOverrides(), false);
    assert.equal(store.getPreset(), "omt-signature");
    assert.equal(store.isComponentEnabled("footer"), true);

    // Persisting session overrides as saved defaults
    store.setPresetOverride("minimal");
    store.setComponentOverride("thinking", false);
    const savedOk = store.saveCurrentAsDefaults();
    assert.equal(savedOk, true);
    assert.equal(store.hasAnyOverrides(), false);
    assert.equal(store.getSavedDefaults().preset, "minimal");
    assert.equal(store.getSavedDefaults().components.thinking, false);

    // Restore defaults resets everything back to factory defaults
    const restoredOk = store.restoreDefaults();
    assert.equal(restoredOk, true);
    assert.deepEqual(store.getEffectiveConfig(), DEFAULT_CONFIG);
    assert.deepEqual(store.getSavedDefaults(), DEFAULT_CONFIG);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Settings UI renders keyboard-friendly controls and provides immediate preview", () => {
  const dummyTheme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    dim: (text: string) => text,
    style: (text: string) => text,
  };

  const tempDir = mkdtempSync(join(tmpdir(), "omt-ui-test-"));
  try {
    const store = new ConfigStore(tempDir);
    store.init();

    let renderRequested = false;
    const fakeTui = {
      requestRender: () => { renderRequested = true; },
    };

    let doneCalled = false;
    const done = () => { doneCalled = true; };

    const appliedActions: string[] = [];
    const notifications: Array<[string, string]> = [];
    let themeResult = "theme applied";
    const controls = {
      editor: {
        on: () => { appliedActions.push("editor:on"); return "editor on"; },
        off: () => { appliedActions.push("editor:off"); return "editor off"; },
      },
      messages: {
        on: () => { appliedActions.push("messages:on"); return "messages on"; },
        off: () => { appliedActions.push("messages:off"); return "messages off"; },
      },
      tools: {
        on: () => { appliedActions.push("tools:on"); return "tools on"; },
        off: () => { appliedActions.push("tools:off"); return "tools off"; },
      },
      footer: {
        on: () => { appliedActions.push("footer:on"); return "footer on"; },
        off: () => { appliedActions.push("footer:off"); return "footer off"; },
      },
      thinking: {
        on: () => { appliedActions.push("thinking:on"); return "thinking on"; },
        off: () => { appliedActions.push("thinking:off"); return "thinking off"; },
        applyTheme: () => { appliedActions.push("thinking:applyTheme"); },
      },
      applyTheme: (name: string) => { appliedActions.push(`theme:${name}`); return themeResult; },
    };

    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: { theme: dummyTheme, notify: (text: string, level: string) => { notifications.push([text, level]); } },
    } as any;

    const component = createSettingsComponent(fakeTui, dummyTheme as any, {} as any, done, ctx, controls);

    // Initial render includes title and list
    const rendered = component.render(80).join("\n");
    assert.match(rendered, /Oh My TUI Settings/);
    assert.match(rendered, /Active preset/);
    assert.match(rendered, /Editor component/);
    assert.match(rendered, /Texture scale\s+1x/);
    assert.match(rendered, /Background picker/);
    assert.match(rendered, /Image fit/);
    // The expanded settings list scrolls instead of exceeding the viewport.
    for (let i = 0; i < 25; i++) component.handleInput("\x1b[B");
    const lower = component.render(80).join("\n");
    assert.match(lower, /Animation mode/);
    assert.match(lower, /Animation speed/);
    assert.match(lower, /Reduced motion/);
    assert.match(lower, /Restore defaults/);
    for (let i = 0; i < 25; i++) component.handleInput("\x1b[A");

    // The settingsList child is child index 3 (after border, title, subtitle)
    const settingsList = (component as any).children[3];
    assert.ok(settingsList);
    assert.equal(typeof component.handleInput, "function");

    // Simulate cycling preset directly on component: Enter on preset item
    renderRequested = false;
    appliedActions.length = 0;
    component.handleInput("\r"); // Enter cycles to next value
    assert.equal(renderRequested, true);
    assert.ok(appliedActions.some((a) => a.startsWith("theme:")));
    assert.deepEqual(notifications, [], "successful preview needs no extra warning");
    themeResult = "OMT theme set to minimal. Native fallback: OMT footer unavailable: missing ownership API.";
    component.handleInput("\r");
    assert.deepEqual(notifications, [[themeResult, "warning"]], "settings exposes partial activation instead of silent success");

    // Arrow navigation on component
    component.handleInput("\x1b[B"); // Arrow down

    // Simulate 'q' to close
    assert.equal(doneCalled, false);
    component.handleInput("q");
    assert.equal(doneCalled, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Settings slash command opens settings in TUI mode and provides completions", async () => {
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

  // Completions include settings
  const completions = registeredCommand.getArgumentCompletions("set");
  assert.deepEqual(completions, [{ value: "settings", label: "settings" }]);

  // Non-TUI mode notification
  const notifications: Array<[string, string]> = [];
  const nonTuiCtx = {
    mode: "text",
    hasUI: true,
    ui: {
      notify: (msg: string, type: string) => { notifications.push([msg, type]); },
    },
  };
  await registeredCommand.handler("settings", nonTuiCtx);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0]![0], /requires interactive TUI mode/);

  // TUI mode calls ctx.ui.custom
  let customCalled = false;
  const tuiCtx = {
    mode: "tui",
    hasUI: true,
    ui: {
      custom: async (factory: any) => {
        customCalled = true;
        const fakeDone = () => {};
        const comp = factory({}, { fg: (_c: string, t: string) => t, bold: (t: string) => t, dim: (t: string) => t } as any, {}, fakeDone);
        assert.ok(comp);
      },
      notify: () => {},
      theme: { fg: (_c: string, t: string) => t, bold: (t: string) => t, dim: (t: string) => t },
    },
  };
  await registeredCommand.handler("settings", tuiCtx);
  assert.equal(customCalled, true);
});


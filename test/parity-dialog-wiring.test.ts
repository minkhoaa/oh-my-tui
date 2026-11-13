import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InteractiveMode, initTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { configStore, loadConfig } from "../extensions/omt/core/config.ts";
import { getActiveTheme, resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";
import { createDialogs } from "../extensions/omt/integration/dialogs.ts";
import type { RuntimeServices } from "../extensions/omt/integration/contracts.ts";
import { OmtSettingsHubComponent } from "../extensions/omt/features/omt-dialogs/settings-hub.ts";

function fixture(act: (component: any) => void) {
  initTheme("dark");
  const theme = (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme;
  const keys = new KeybindingsManager(TUI_KEYBINDINGS);
  const notices: unknown[][] = [];
  const model = (provider: string) => ({ id: "shared-id", name: `${provider} fixture`, provider, api: "openai-responses" as const,
    baseUrl: "https://invalid.example", contextWindow: 12345, maxTokens: 2345, reasoning: true, input: ["text" as const],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
  });
  const models = [model("provider-a"), model("provider-b")];
  const ctx = { hasUI: true, mode: "tui", cwd: "/fixture", model: models[1], modelRegistry: {
    getAll: () => models, getAvailable: () => [models[0]], refresh() { throw new Error("model refresh forbidden"); },
  }, ui: {
    theme, notify: (...args: unknown[]) => { notices.push(args); },
    getEditorText: () => "existing draft", setEditorText() { throw new Error("draft overwrite forbidden"); },
    custom(factory: any, options: any) {
      assert.equal(options.overlay, true);
      return new Promise(resolve => {
        const component = factory({ terminal: { columns: 192, rows: 49 }, requestRender() {} }, theme, keys, resolve);
        component.render(192);
        act(component);
      });
    },
  } } as unknown as ExtensionContext;
  return { ctx, notices, models };
}
function controls(pi: any): RuntimeServices {
  const control = { applyTheme() {} };
  return { pi, editor: control, messages: control, footer: control, background: control,
    applyTheme() { throw new Error("palette must not switch OMT presets"); },
  } as unknown as RuntimeServices;
}

test("model dialog selects the exact provider-qualified registry model through native pi.setModel once", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("network forbidden"); });
  const root = mkdtempSync(join(tmpdir(), "omt-dialog-model-"));
  setActiveTheme("omt-signature"); configStore.init(root);
  try {
    const { ctx, models, notices } = fixture(component => { component.handleInput("\r"); component.handleInput("\r"); });
    const selected: unknown[] = [];
    const dialogs = createDialogs(controls({ async setModel(model: unknown) { selected.push(model); return false; } }));
    await dialogs.openModelPicker(ctx);
    await Promise.resolve();
    assert.deepEqual(selected, [models[1]]);
    assert.equal(selected[0], models[1], "the real registry object reaches the native operation");
    assert.ok(JSON.stringify(notices).includes("authentication unavailable for provider-b"));
    assert.equal(ctx.ui.getEditorText(), "existing draft");
  } finally { resetActiveTheme(); configStore.clearSessionOverrides(); rmSync(root, { recursive: true, force: true }); }
});

test("session scopes unwrap native { model, thinkingLevel } entries without losing current unauthenticated model", async () => {
  const root = mkdtempSync(join(tmpdir(), "omt-scoped-model-"));
  setActiveTheme("omt-signature"); configStore.init(root);
  try {
    let rendered = "";
    const { ctx, models } = fixture(component => {
      rendered = component.render(192).join("\n");
      component.handleInput("\x1b");
    });
    const other = { ...models[0], id: "excluded", name: "EXCLUDED_MODEL" };
    (ctx.modelRegistry as any).getAvailable = () => [models[0], other];
    (ctx as any).scopedModels = [{ model: models[0], thinkingLevel: "high" }];
    await createDialogs(controls({})).openModelPicker(ctx);
    assert.ok(rendered.includes("provider-a"));
    assert.ok(rendered.includes("provider-b"), "current provider remains visible even when unavailable");
    assert.ok(!rendered.includes("EXCLUDED_MODEL"));
    assert.equal(ctx.scopedModels[0]!.model, models[0]);
  } finally { resetActiveTheme(); configStore.clearSessionOverrides(); rmSync(root, { recursive: true, force: true }); }
});

test("favorites use provider + NUL + model ID, not ambiguous shared model IDs", async () => {
  const root = mkdtempSync(join(tmpdir(), "omt-dialog-favorite-"));
  setActiveTheme("omt-signature"); configStore.init(root);
  try {
    const { ctx } = fixture(component => { component.handleInput("\x06"); component.handleInput("\x1b"); });
    await createDialogs(controls({})).openModelPicker(ctx);
    assert.deepEqual(configStore.getSignature().favorites, ["provider-b\u0000shared-id"]);
    assert.deepEqual(loadConfig(root).signature.favorites, ["provider-b\u0000shared-id"]);
    assert.equal(ctx.ui.getEditorText(), "existing draft");
  } finally { resetActiveTheme(); configStore.clearSessionOverrides(); rmSync(root, { recursive: true, force: true }); }
});

test("/omt theme opens the hub Theme section; actual cursor preview follows source persistence without switching preset or scene", async () => {
  const root = mkdtempSync(join(tmpdir(), "omt-dialog-theme-"));
  setActiveTheme("omt-signature"); configStore.init(root);
  try {
    const { ctx } = fixture(component => {
      component.handleInput("\x1b[B"); // next palette
      component.handleInput("\x1b[C"); // backgrounds
      component.handleInput("\x1b[B"); // next surface
      component.handleInput("\x1b");
    });
    await createDialogs(controls({ getCommands: () => [], getSettings: () => ({}) })).openThemePicker(ctx);
    assert.equal(getActiveTheme().id, "omt-signature");
    assert.equal(configStore.getSignaturePalette(), "one-dark");
    assert.equal(loadConfig(root).signature.palette, "one-dark");
    assert.equal(configStore.getSignature().surface, "aura");
    assert.equal(loadConfig(root).signature.surface, "transparent");
    assert.equal(configStore.getBackground().enabled, false);
    assert.equal(configStore.getBackground().scene, "aurora");
    assert.equal(ctx.ui.getEditorText(), "existing draft");
  } finally { resetActiveTheme(); configStore.clearSessionOverrides(); rmSync(root, { recursive: true, force: true }); }
});

test("settings distinguishes unavailable inventories from empty and derives tool stats only from native branch results", async t => {
  setActiveTheme("omt-signature");
  const root = mkdtempSync(join(tmpdir(), "omt-settings-truth-")); configStore.init(root);
  const branch = [
    { type: "message", message: { role: "toolResult", toolName: "read", isError: false, durationMs: 12 } },
    { type: "message", message: { role: "toolResult", toolName: "read", isError: true, durationMs: 8 } },
    { type: "message", message: { role: "assistant", content: [] } },
  ];
  const before = JSON.stringify(branch);
  let observed = false;
  const render = OmtSettingsHubComponent.prototype.render;
  t.mock.method(OmtSettingsHubComponent.prototype, "render", function(this: any, width: number) {
    observed = true;
    assert.deepEqual(this.options.toolStats, [{ name: "read", count: 2, errors: 1, durationMs: 20 }]);
    for (const section of ["shortcut", "extension", "market", "mcp"]) {
      assert.equal(this.getSectionCount(section), -2);
      assert.equal(this.getSectionItems(section)[0].label, "— unavailable —");
    }
    assert.equal(this.getSectionCount("plugin"), 0, "curated suggestions are not installed packages");
    assert.equal(this.getSectionCount("tool"), 1);
    return render.call(this, width);
  });
  try {
    const { ctx } = fixture(component => component.handleInput("\x1b"));
    (ctx as any).sessionManager = { getBranch: () => branch };
    await createDialogs(controls({ getCommands: () => [], getSettings: () => ({ packages: [], extensions: ["not-loaded.ts"] }) })).openSettings(ctx);
    assert.ok(observed); assert.equal(JSON.stringify(branch), before);
  } finally { resetActiveTheme(); configStore.clearSessionOverrides(); rmSync(root, { recursive: true, force: true }); }
});

test("empty Signature trajectory reports the source notice without mounting a modal or changing history/draft", async () => {
  setActiveTheme("omt-signature");
  try {
    const { ctx, notices } = fixture(() => { throw new Error("empty trajectory must not mount UI"); });
    const entries: any[] = [];
    (ctx as any).sessionManager = { getTree: () => [], getEntries: () => entries };
    await createDialogs(controls({})).openToolInspector(ctx);
    assert.deepEqual(notices, [["no trajectory entries yet", "info"]]);
    assert.deepEqual(entries, []);
    assert.equal(ctx.ui.getEditorText(), "existing draft");
  } finally { resetActiveTheme(); }
});

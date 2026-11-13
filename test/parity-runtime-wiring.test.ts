import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { configStore } from "../extensions/omt/core/config.ts";
import { setActiveTheme, resetActiveTheme } from "../extensions/omt/core/theme.ts";
import { createSidebarActions } from "../extensions/omt/integration/sidebar-actions.ts";
import { signatureCommandPresentation } from "../extensions/omt/integration/command-presentation.ts";
import { readTrajectorySteps } from "../extensions/omt/integration/trajectory.ts";
import { assistantFixture } from "./assistant-fixture.ts";

test("picker command presentation preserves native dispatch and yields to external command ownership", () => {
  setActiveTheme("omt-signature");
  try {
    const pi = { getCommands: () => [] };
    for (const name of ["settings", "model", "resume", "tree", "trajectory", "theme", "pet"]) {
      assert.equal(signatureCommandPresentation(pi, `/${name}`), `/omt ${name}`);
      assert.equal(signatureCommandPresentation({ getCommands: () => [{ name }] }, `/${name}`), `/${name}`, "foreign commands and templates retain ownership");
      assert.equal(signatureCommandPresentation(pi, `/${name} argument`), `/${name} argument`, "arguments pass unchanged");
    }
    for (const text of ["hello 界", "/model provider/model", "/tree branch", "/login", "/unknown", "/omt model", "! echo hi", "hello\n/settings"]) {
      assert.equal(signatureCommandPresentation(pi, text), text);
    }
    const external = { getCommands: () => [{ name: "model", source: "extension" as const, description: "foreign" }] };
    assert.equal(signatureCommandPresentation(external, "/model"), "/model");
    for (const preset of ["minimal", "native"] as const) {
      setActiveTheme(preset);
      assert.equal(signatureCommandPresentation(pi, "/model"), "/model");
    }
  } finally { resetActiveTheme(); }
});

test("sidebar callbacks use exact native operations and retained callbacks become inert after ownership loss", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("network forbidden"); });
  const root = mkdtempSync(join(tmpdir(), "omt-sidebar-actions-"));
  configStore.init(root);
  try {
    let owned = true;
    const a = { id: "same", provider: "a" }, b = { id: "same", provider: "b" };
    const models: unknown[] = [], levels: string[] = [], notices: string[] = [];
    const pi = { async setModel(model: unknown) { models.push(model); return true; }, setThinkingLevel(level: string) { levels.push(level); } } as unknown as ExtensionAPI;
    const ctx = { modelRegistry: { getAll: () => [a, b] }, ui: { notify: (message: string) => notices.push(message) } } as unknown as ExtensionContext;
    const actions = createSidebarActions(pi, ctx, () => owned);
    await actions.onSelectModel("same");
    assert.equal(models.length, 0, "ambiguous IDs cannot silently select a different provider");
    assert.ok(notices[0]?.includes("ambiguous"));
    await actions.onSelectModel("b/same");
    assert.equal(models[0], b);
    actions.onSelectThinkingLevel("high");
    assert.deepEqual(levels, ["high"]);
    actions.onSelectThinkingLevel("invalid");
    assert.deepEqual(levels, ["high"]);
    actions.onSelectPet("dog");
    actions.onToggleFold("mcp", true);
    assert.equal(configStore.getSignature().pet, "dog");
    assert.equal(configStore.getSignature().folds.mcp, true);
    owned = false;
    await actions.onSelectModel("a/same"); actions.onSelectThinkingLevel("low"); actions.onSelectPet("cat");
    assert.deepEqual(models, [b]);
    assert.deepEqual(levels, ["high"]);
    assert.equal(configStore.getSignature().pet, "dog");
  } finally { configStore.clearSessionOverrides(); rmSync(root, { recursive: true, force: true }); }
});

test("trajectory includes actual user/assistant tree messages and omits harness state without changing entries", () => {
  const manager = SessionManager.inMemory("/fixture");
  manager.appendMessage({ role: "user", content: "hi", timestamp: 0 });
  manager.appendThinkingLevelChange("medium");
  manager.appendMessage({ ...assistantFixture(), content: [{ type: "text", text: "hello" }] });
  const before = JSON.stringify(manager.getEntries());
  const steps = readTrajectorySteps(manager);
  assert.deepEqual(steps.map(step => step.kind), ["user", "assistant"]);
  assert.deepEqual(steps.map(step => step.index), [1, 2]);
  assert.ok(steps[0]?.detail.includes("hi"));
  assert.ok(steps[1]?.detail.includes("hello"));
  assert.equal(JSON.stringify(manager.getEntries()), before);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore, loadConfig } from "../extensions/omt/core/config.ts";
import { createSignatureAppearanceActions } from "../extensions/omt/integration/appearance.ts";

test("palette browsing persists, while surface browsing stays live but unpersisted on Esc", () => {
  const root = mkdtempSync(join(tmpdir(), "omt-appearance-"));
  try {
    const store = new ConfigStore(root);
    let repaints = 0;
    const actions = createSignatureAppearanceActions(() => { repaints++; }, store);
    assert.equal(actions.currentTheme, "default");
    assert.equal(actions.currentBackground, "transparent");
    store.setPresetOverride("omt-signature");
    store.setComponentOverride("thinking", false);
    store.setBackgroundOverride("scene", "rain");
    assert.equal(actions.onPreviewTheme("dracula"), true);
    assert.equal(actions.onPreviewBackground("nord"), true);
    actions.onCancelTheme();
    assert.equal(store.getSignaturePalette(), "dracula");
    assert.equal(store.getSignature().surface, "nord");
    const saved = loadConfig(root);
    assert.equal(saved.signature.palette, "dracula");
    assert.equal(saved.signature.surface, "transparent");
    assert.equal(saved.components.thinking, true);
    assert.equal(saved.background.scene, "aurora");
    assert.equal(store.getPreset(), "omt-signature");
    assert.equal(store.isComponentEnabled("thinking"), false);
    assert.equal(repaints, 2);
    const bytes = readFileSync(join(root, "omt.json"), "utf8");
    actions.dispose();
    assert.equal(actions.onPreviewTheme("one-dark"), false);
    assert.equal(actions.onSelectBackground("github"), false);
    assert.equal(readFileSync(join(root, "omt.json"), "utf8"), bytes);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Enter saves only the selected surface and invalid palette/scene identifiers cannot change it", () => {
  const root = mkdtempSync(join(tmpdir(), "omt-appearance-confirm-"));
  try {
    const store = new ConfigStore(root);
    store.setSignatureOverride("pet", "dog");
    const actions = createSignatureAppearanceActions(() => {}, store);
    assert.equal(actions.onSelectBackground("github"), true);
    assert.equal(store.getSignature().surface, "github");
    assert.equal(loadConfig(root).signature.surface, "github");
    assert.equal(loadConfig(root).signature.pet, "cat");
    assert.equal(store.getSignature().pet, "dog");
    assert.equal(actions.onSelectTheme("minimal"), false, "preset IDs are not palette IDs");
    assert.equal(actions.onSelectBackground("rain"), false, "animated scenes are not solid surfaces");
    assert.equal(store.getSignature().surface, "github");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a failed appearance save reports failure and keeps saved and live state unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "omt-appearance-failure-"));
  try {
    const file = join(root, "not-a-directory");
    writeFileSync(file, "keep");
    const store = new ConfigStore(file);
    let repaints = 0;
    const actions = createSignatureAppearanceActions(() => { repaints++; }, store);
    assert.equal(actions.onSelectTheme("dracula"), false);
    assert.equal(store.getSignaturePalette(), "auto");
    assert.equal(repaints, 0);
    assert.equal(readFileSync(file, "utf8"), "keep");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

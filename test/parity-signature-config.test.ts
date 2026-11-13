import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ConfigStore, DEFAULT_CONFIG, loadConfig } from "../extensions/omt/core/config.ts";

test("confirming a signature preference persists only that preference, not other session overrides", () => {
  const root = mkdtempSync(join(tmpdir(), "omt-signature-config-"));
  const store = new ConfigStore(root);
  try {
    store.setPresetOverride("minimal");
    store.setComponentOverride("editor", false);
    store.setBackgroundOverride("speed", 2);
    store.setSignatureOverride("palette", "dracula");
    store.setSignatureOverride("surface", "nord");
    assert.equal(store.setSignatureDefault("palette", "dracula"), true);
    const persisted = loadConfig(root);
    assert.equal(persisted.signature.palette, "dracula");
    assert.equal(persisted.signature.surface, "transparent", "unconfirmed surface preview stays session-local");
    assert.equal(persisted.preset, DEFAULT_CONFIG.preset);
    assert.equal(persisted.components.editor, true);
    assert.equal(persisted.background.speed, DEFAULT_CONFIG.background.speed);
    assert.equal(store.getPreset(), "minimal");
    assert.equal(store.isComponentEnabled("editor"), false);
    assert.equal(store.getSignature().surface, "nord");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("ending an unconfirmed preview restores inheritance without rewriting persisted settings", () => {
  const root = mkdtempSync(join(tmpdir(), "omt-signature-preview-"));
  const store = new ConfigStore(root);
  try {
    assert.equal(store.setSignatureDefault("palette", "one-dark"), true);
    const savedBytes = readFileSync(join(root, "omt.json"), "utf8");
    store.setSignatureOverride("palette", "dracula");
    assert.equal(store.getSignaturePalette(), "dracula");
    store.setSignatureOverride("palette", undefined);
    assert.equal(store.getSignaturePalette(), "one-dark");
    assert.equal(store.getOverrides().signature, undefined);
    assert.equal(readFileSync(join(root, "omt.json"), "utf8"), savedBytes);
    store.setSignatureOverride("palette", "gruvbox");
    store.setSignatureOverride("surface", "nord");
    store.setSignatureOverride("surface", undefined);
    assert.deepEqual(store.getOverrides().signature, { palette: "gruvbox", favorites: undefined, visible: {}, folds: {} });
    assert.equal(store.getSignature().surface, "transparent");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("failed preference persistence does not update saved defaults", () => {
  const root = mkdtempSync(join(tmpdir(), "omt-signature-write-failure-"));
  try {
    const file = join(root, "not-a-directory");
    writeFileSync(file, "keep");
    const store = new ConfigStore(file);
    assert.equal(store.setSignatureDefault("palette", "dracula"), false);
    assert.equal(store.getSavedDefaults().signature.palette, DEFAULT_CONFIG.signature.palette);
    assert.equal(readFileSync(file, "utf8"), "keep");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

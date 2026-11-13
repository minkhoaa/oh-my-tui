import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InteractiveMode, initTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { configStore } from "../extensions/omt/core/config.ts";
import { setActiveTheme, resetActiveTheme } from "../extensions/omt/core/theme.ts";
import { createBackgroundControl } from "../extensions/omt/features/backgrounds/integration.ts";

test("solid signature surfaces mount an owned backdrop without enabling animated backgrounds and restore only owned hooks", () => {
  const root = mkdtempSync(join(tmpdir(), "omt-solid-surface-"));
  configStore.init(root); setActiveTheme("omt-signature"); initTheme("dark");
  const terminal = { columns: 192, rows: 49, start() {}, stop() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {},
    clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, clearProgress() {} };
  const tui = new TuiAltScreen(terminal as any, false, root);
  const native = (tui as any).applySearchHighlights;
  const control = createBackgroundControl();
  const ctx = { hasUI: true, mode: "tui", ui: {
    theme: (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme,
    setWidget() {}, getBackgroundTui: () => tui,
  } } as unknown as ExtensionContext;
  try {
    configStore.setSignatureOverride("surface", "nord");
    control.applyTheme(ctx);
    assert.equal(configStore.getBackground().enabled, false);
    assert.equal(configStore.getBackground().mode, "off");
    assert.equal(control.getStats().isFullBackdropSupported, true);
    assert.notEqual((tui as any).applySearchHighlights, native);
    configStore.setSignatureOverride("surface", "transparent");
    control.applyTheme(ctx);
    assert.equal((tui as any).applySearchHighlights, native);
    configStore.setSignatureOverride("surface", "nord");
    control.applyTheme(ctx);
    const retained = (tui as any).applySearchHighlights;
    const foreign = (screen: string[]) => screen;
    (tui as any).applySearchHighlights = foreign;
    control.cleanup(ctx);
    assert.equal((tui as any).applySearchHighlights, foreign);
    assert.deepEqual(retained.call(tui, ["foreground"], {}), native.call(tui, ["foreground"], {}));
  } finally {
    control.cleanup(ctx); configStore.clearSessionOverrides(); resetActiveTheme(); rmSync(root, { recursive: true, force: true });
  }
});

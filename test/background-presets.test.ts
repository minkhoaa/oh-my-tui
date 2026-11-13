import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TuiAltScreen, CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createBackgroundControl } from "../extensions/omt/features/backgrounds/integration.ts";
import { configStore } from "../extensions/omt/core/config.ts";
import { motionCoordinator, setActiveTui } from "../extensions/omt/core/motion.ts";
import { resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";
import { THEME_NAMES } from "../extensions/omt/presets/index.ts";

test("native full viewport survives every preset, color fallback, resize and cleanup", () => {
  const dir = mkdtempSync(join(tmpdir(), "omt-background-presets-"));
  const terminal = { columns: 80, rows: 24, write() {}, hideCursor() {}, showCursor() {}, stop() {} };
  const tui = new TuiAltScreen(terminal as any, true), host = tui as any;
  host.altScreenActive = true; host.stopped = false;
  const original = host.applySearchHighlights;
  const lines = ["  Native foreground 界 é", "", `\x1b[44m opaque panel \x1b[0m`, "", `draft ${CURSOR_MARKER} `];
  tui.addChild({ render: () => lines, invalidate() {} });
  const ctx = { mode: "tui", hasUI: true, ui: { getBackgroundTui: () => tui, setWidget() {}, notify() {} } } as any;
  const control = createBackgroundControl();
  const color = process.env.OMT_COLOR_MODE;
  try {
    configStore.init(dir); configStore.setAnimationOverride("mode", "off");
    control.setMode("full", ctx);
    for (const mode of ["truecolor", "256color", "16color", "monochrome"]) {
      process.env.OMT_COLOR_MODE = mode;
      for (const preset of THEME_NAMES) {
        setActiveTheme(preset); control.applyTheme(ctx);
        for (const width of [20, 40, 80, 120]) {
          terminal.columns = width;
          host.doRender();
          const screen: string[] = tui.getScreenLines();
          assert.equal(host.currentLayout.lines[0], lines[0], "native transcript source untouched");
          assert.ok(screen.some(row => stripTerminalSequences(row).includes("opaque panel")));
          assert.ok(screen.every(row => visibleWidth(row) <= width));
          assert.equal(control.getStats().isFullBackdropSupported, preset !== "native");
          assert.equal(motionCoordinator.hasActive(), false, "static fallback has no scheduler source");
        }
      }
    }
    control.off(ctx);
    assert.equal(host.applySearchHighlights, original);
  } finally {
    if (color === undefined) delete process.env.OMT_COLOR_MODE; else process.env.OMT_COLOR_MODE = color;
    control.cleanup(ctx); motionCoordinator.dispose(); setActiveTui(undefined); resetActiveTheme(); tui.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

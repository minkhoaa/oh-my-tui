import assert from "node:assert/strict";
import { test } from "node:test";
import { TuiAltScreen, CURSOR_MARKER, encodeKitty, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { BackgroundCompositor } from "../extensions/omt/features/backgrounds/compositor/index.ts";
import { installNativeBackdrop, supportsNativeBackdrop } from "../extensions/omt/features/backgrounds/pi.ts";
import { createBackgroundControl } from "../extensions/omt/features/backgrounds/integration.ts";
import { configStore } from "../extensions/omt/core/config.ts";
import { setActiveTheme, resetActiveTheme } from "../extensions/omt/core/theme.ts";
import { motionCoordinator } from "../extensions/omt/core/motion.ts";

function renderer(width = 40, height = 12) {
  const writes: string[] = [];
  const terminal = { columns: width, rows: height, write: (s: string) => writes.push(s), hideCursor() {}, showCursor() {}, stop() {} };
  const tui = new TuiAltScreen(terminal as any, true);
  // Native frame pipeline, without starting a real terminal or animation timer.
  const host = tui as any;
  host.altScreenActive = true;
  host.stopped = false;
  return { tui, host, terminal, writes };
}

test("logical compositor fills viewport, preserves native glyph spans, ANSI, links and Unicode", () => {
  const compositor = new BackgroundCompositor();
  const rows = ["", "  Header  ", "  界 é 👩🏽‍💻  ", "\x1b[48:2::1:2:3m     \x1b[0m", "\x1b]8;;https://example.org\x1b\\link here\x1b]8;;\x1b\\", `x ${CURSOR_MARKER} `];
  const output = compositor.compose(rows, Array(10).fill(".".repeat(40)), 40, 10);
  assert.equal(output.length, 10);
  assert.equal(stripTerminalSequences(output[0]!), ".".repeat(40));
  assert.equal(stripTerminalSequences(output[1]!), "..Header" + ".".repeat(32));
  for (let i = 2; i <= 5; i++) {
    assert.ok(output[i]!.includes(rows[i]!.trim()), `preserved row ${i}`);
    assert.equal(visibleWidth(output[i]!), 40);
  }
  assert.ok(output[5]!.includes(CURSOR_MARKER));
  assert.equal(stripTerminalSequences(output[2]!).indexOf("界"), 2);
  assert.ok(output[3]!.includes(rows[3]!));
});

test("unknown controls and image-bearing viewports fail closed byte-for-byte", () => {
  const compositor = new BackgroundCompositor();
  const wallpaper = ["*".repeat(20), "*".repeat(20)];
  for (const line of ["\x1b_Ga=T;AAAA\x1b\\", "\x1b]1337;File=AAAA\x07", "\x1bPqDATA\x1b\\"]) {
    assert.deepEqual(compositor.compose([line, ""], wallpaper, 20, 2), [line, ""]);
  }
  assert.equal(compositor.compose(["\x1b[3Gtext"], wallpaper, 20, 1)[0], "\x1b[3Gtext");
});

test("native alternate-screen frames preserve layout, cursor, selections, overlays, resize and restoration", () => {
  const { tui, host, terminal, writes } = renderer();
  const compositor = new BackgroundCompositor();
  let tick = 0;
  const lines = ["Header", "", "  Transcript 界 é", "", `Editor ${CURSOR_MARKER}draft`, "Footer"];
  tui.addChild({ render: () => lines, invalidate() {} });
  assert.equal(supportsNativeBackdrop(tui), true);
  assert.equal(supportsNativeBackdrop({ mode: "regular" }), false);
  const original = host.applySearchHighlights;
  const hook = installNativeBackdrop(tui, (screen, width, height) => compositor.compose(screen, Array(height).fill((tick ? "+" : ".").repeat(width)), width, height))!;
  try {
    assert.ok(hook);
    host.doRender();
    const first = tui.getScreenLines();
    assert.equal(first.length, 12);
    assert.equal(stripTerminalSequences(first[11]!), ".".repeat(40));
    assert.ok(first.some((line) => stripTerminalSequences(line).includes("Transcript 界 é")));
    assert.ok(writes.at(-1)!.includes("\x1b[5;8H"), "native cursor column/row unchanged");
    // Copy from a fixed UI region must never copy wallpaper glyphs.
    host.selectionAnchor = { row: 0, col: 0 };
    host.selectionFocus = { row: 0, col: 30 };
    assert.equal(host.getActiveSelectionText(), "Header");
    host.selectionAnchor = host.selectionFocus = undefined;
    tick++;
    host.doRender();
    assert.notDeepEqual(tui.getScreenLines(), first);
    assert.deepEqual(host.currentLayout.lines.filter((line: string) => line.includes("Transcript")), ["  Transcript 界 é"], "layout document stays native");
    const overlay = tui.showOverlay({ render: () => ["DIALOG"], invalidate() {} }, { width: 12, anchor: "center" });
    host.doRender();
    assert.ok(tui.getScreenLines().some((line) => stripTerminalSequences(line).includes("DIALOG")));
    overlay.hide();
    terminal.columns = 28;
    terminal.rows = 18;
    host.doRender();
    assert.equal(tui.getScreenLines().length, 18);
    assert.ok(tui.getScreenLines().every((line) => visibleWidth(line) <= 28));
  } finally { hook.dispose(); tui.stop(); }
  assert.equal(host.applySearchHighlights, original);
  assert.equal(Object.hasOwn(host, "applySearchHighlights"), false);
});

test("foreign owners are not overwritten and retained wrappers become inert", () => {
  const { tui, host } = renderer();
  const native = host.applySearchHighlights;
  const hook = installNativeBackdrop(tui, (screen) => screen.map(() => "wall"))!;
  const retained = host.applySearchHighlights;
  const foreign = function (screen: string[], layout: unknown) { return retained.call(host, screen, layout); };
  host.applySearchHighlights = foreign;
  assert.equal(hook.owned(), false);
  hook.dispose();
  assert.equal(host.applySearchHighlights, foreign);
  assert.deepEqual(foreign(["foreground"], {}), ["foreground"]);
  assert.equal(installNativeBackdrop(tui, (screen) => screen), undefined);
  host.applySearchHighlights = native;
  tui.stop();
});

test("full control uses no widget, pauses scheduling for focus/images/overlays and restores", () => {
  const { tui, host } = renderer();
  const control = createBackgroundControl();
  let widgetMounts = 0;
  const ctx = { mode: "tui", hasUI: true, ui: { getBackgroundTui: () => tui, setWidget: (_: string, value: unknown) => { if (value) widgetMounts++; } } } as any;
  const lines = ["Header", "", "Transcript", "Editor", "Footer"];
  tui.addChild({ render: () => lines, invalidate() {} });
  configStore.init();
  configStore.setAnimationOverride("mode", "subtle");
  configStore.setAnimationOverride("reducedMotion", "normal");
  setActiveTheme("omt-clean");
  try {
    assert.match(control.setMode("full", ctx), /Native alternate-screen viewport/);
    host.doRender();
    assert.equal(control.getStats().isFullBackdropSupported, true);
    assert.equal(widgetMounts, 0);
    assert.ok(motionCoordinator.hasActive());
    configStore.setAnimationOverride("mode", "off");
    host.doRender();
    assert.equal(motionCoordinator.hasActive(), false);
    const still = tui.getScreenLines();
    host.doRender();
    assert.deepEqual(tui.getScreenLines(), still);
    configStore.setAnimationOverride("mode", "subtle");
    configStore.setAnimationOverride("reducedMotion", "reduced");
    host.doRender();
    assert.equal(motionCoordinator.hasActive(), false);
    configStore.setAnimationOverride("reducedMotion", "normal");
    host.doRender();
    control.pause();
    assert.equal(motionCoordinator.hasActive(), false);
    host.doRender();
    const frozen = tui.getScreenLines();
    host.doRender();
    assert.deepEqual(tui.getScreenLines(), frozen);
    control.resume();
    host.handleViewportInput("\x1b[O");
    assert.equal(motionCoordinator.hasActive(), false);
    host.handleViewportInput("\x1b[I");
    assert.ok(motionCoordinator.hasActive());
    // A valid native Kitty image command, including its multi-row placement.
    host.imageProtocol = "kitty";
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZW0AAAAASUVORK5CYII=";
    lines.push(encodeKitty(png, { imageId: 361, columns: 4, rows: 3 }));
    host.doRender();
    assert.equal(motionCoordinator.hasActive(), false);
    assert.ok(tui.getScreenLines().some((line) => line.includes("\x1b_G")));
    host.doRender(); // unchanged placements must not accumulate animation frames
    assert.equal(motionCoordinator.hasActive(), false);
    lines.pop();
    host.doRender();
    assert.ok(motionCoordinator.hasActive());
    const overlay = tui.showOverlay({ render: () => ["Dialog"], invalidate() {} });
    host.doRender();
    assert.equal(motionCoordinator.hasActive(), false);
    overlay.hide();
    host.doRender();
    assert.ok(motionCoordinator.hasActive());
    control.off(ctx);
    assert.equal(control.getStats().isFullBackdropSupported, false);
    assert.equal(motionCoordinator.hasActive(), false);
    assert.equal(widgetMounts, 0);
  } finally {
    control.cleanup(ctx); motionCoordinator.dispose(); configStore.clearSessionOverrides(); resetActiveTheme(); tui.stop();
  }
});

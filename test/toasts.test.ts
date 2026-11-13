import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { InteractiveMode, initTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Text, TuiAltScreen, VStack, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { ToastQueue, TOAST_TTL_MS, toastGeometry } from "../extensions/omt/features/smart-notifications/toast-model.ts";
import { renderToastStack } from "../extensions/omt/features/smart-notifications/toast-view.ts";
import { createToastControl } from "../extensions/omt/features/smart-notifications/toasts.ts";
import { notificationStore } from "../extensions/omt/features/smart-notifications/store.ts";
import { observeNativeUIOwnership } from "../extensions/omt/core/native-ui.ts";
import { MotionCoordinator, motionCoordinator } from "../extensions/omt/core/motion.ts";
import { configStore } from "../extensions/omt/core/config.ts";

const proto = InteractiveMode.prototype as any;
const theme = () => { initTheme("dark"); return proto.createExtensionUIContext.call({}).theme; };

test("toast source geometry, capped stack and exact ten-second expiry", () => {
  const queue = new ToastQueue();
  for (let i = 0; i < 11; i++) queue.push(`message-${i}`, "info", 1000);
  assert.equal(queue.getAll(1000).length, 10);
  assert.equal(queue.getAll(1000)[0]!.message, "message-1");
  assert.equal(queue.getAll(10999).length, 10);
  assert.equal(queue.getAll(11000).length, 0);
  const box = toastGeometry(192, 49, true);
  assert.equal(box.row, 1); assert.equal(box.width, 54); assert.equal(box.col, 104);
  assert.equal(box.col + box.width, 158, "ends immediately before the actual 34-column dock");
  assert.equal(toastGeometry(80, 24, false).col + toastGeometry(80, 24, false).width, 80);
  assert.equal(toastGeometry(8, 8, false).visible, false);
});

test("toast rows preserve exact width, semantic icons/countdown and safe Unicode truncation", () => {
  const palette = theme();
  const message = "MCP tools are only reachable from codemode\n" + "界 é ".repeat(20) + "\x1b[2J";
  const items = [{ message, type: "warning" as const, at: 1000 }, { message: "error details", type: "error" as const, at: 1000 }];
  for (const width of [10, 20, 54, 80]) {
    const lines = renderToastStack(items, palette, width, 2000);
    assert.ok(lines.every(line => visibleWidth(line) === width), `exact visible width ${width}`);
    assert.ok(renderToastStack(items, palette, width, 1000).every(line => visibleWidth(line) === width), "10s countdown also fits narrow widths");
    assert.ok(!lines.join("").includes("\x1b[2J"));
    assert.match(stripTerminalSequences(lines[1]!), /●/);
    assert.match(stripTerminalSequences(lines[2]!), /×/);
    assert.match(stripTerminalSequences(lines[1]!), /9s/);
  }
  assert.ok(stripTerminalSequences(renderToastStack(items, palette, 54, 2000)[1]!).includes("…"));
});

function fakeTui() {
  const overlays: any[] = [];
  const tui = { mode: "fullscreen", terminal: { columns: 192, rows: 49 }, requestRender() {},
    showOverlay(component: any, options: any) {
      const item = { component, options, hidden: false };
      overlays.push(item);
      return { hide() { item.hidden = true; } };
    }, hideOverlay() { throw new Error("Never pop a foreign overlay"); },
  };
  return { tui, overlays };
}

function context(ui: any): ExtensionContext { return { hasUI: true, mode: "tui", ui } as ExtensionContext; }

test("real native UI captures startup notify before OMT session_start, stores full warning once, and restores retained wrappers safely", t => {
  theme(); notificationStore.clear();
  let now = 1000; t.mock.method(Date, "now", () => now);
  const { tui, overlays } = fakeTui(); const fallback: string[] = [];
  const control = createToastControl(() => true);
  const restore = observeNativeUIOwnership(event => control.receive(event));
  assert.ok(restore, "recognized native UI factory");
  try {
    const ui = proto.createExtensionUIContext.call({ renderer: tui, showExtensionNotify(message: string) { fallback.push(message); } });
    const retained = ui.notify;
    const warning = "MCP tools are only reachable from the codemode or tool_search tool, but neither is active; they cannot be called.";
    ui.notify(warning, "warning");
    assert.deepEqual(fallback, [], "early warning is queued, never inserted then removed from chat");
    const runnerUi = { ...ui }; // Installed ExtensionRunner.wrapUIPromptContext clones the raw UI.
    control.refresh(context(runnerUi), true);
    assert.equal(overlays.length, 1); assert.equal(overlays[0].options.nonCapturing, true);
    assert.equal(notificationStore.getAll().length, 1);
    assert.equal(notificationStore.getAll()[0]!.message, warning, "history is full, not the truncated toast");
    assert.ok(overlays[0].component.render(54).join("").includes("MCP"));
    assert.equal(overlays[0].options.col, 104);
    tui.terminal.columns = 120; assert.equal(overlays[0].options.col, 56, "resize uses current main pane geometry");
    now += TOAST_TTL_MS; control.tick(); assert.equal(overlays[0].hidden, true);
    assert.equal(notificationStore.getAll().length, 1, "expiry does not delete history");
    runnerUi.notify("after session_start", "info");
    assert.equal(overlays.length, 2, "notifications after startup route through the copied UI, too");
    assert.equal(notificationStore.getAll().length, 2);
    control.setBlocked(true); assert.equal(overlays[1].options.visible(), false, "blocking dialogs hide, not erase, the toast");
    control.setBlocked(false); assert.equal(overlays[1].options.visible(), true);
    const retainedCopy = runnerUi.notify;
    const foreign = () => {};
    runnerUi.notify = foreign;
    retainedCopy("after foreign takeover", "warning");
    assert.equal(notificationStore.getAll().length, 2, "retained copied wrapper yields after foreign takeover");
    restore!();
    assert.equal(runnerUi.notify, foreign, "cleanup does not replace a copied UI's foreign owner");
    retained("after cleanup", "warning");
    assert.deepEqual(fallback, ["after foreign takeover", "after cleanup"], "retained wrappers delegate safely");
  } finally { control.cleanup(); restore!(); motionCoordinator.clear(); notificationStore.clear(); }
});

test("native/off/unsupported toast paths delegate without losing warnings; foreign notify remains owned", () => {
  const palette = theme(); const { tui, overlays } = fakeTui(); const received: string[] = [];
  const ui = { theme: palette, getBackgroundTui: () => tui } as any;
  const event = (message: string) => ({ ui, message, type: "warning" as const, fallback: () => received.push(message) });
  const control = createToastControl(() => true);
  try {
    assert.equal(control.receive(event("queued native")), true);
    control.refresh(context(ui), false); assert.deepEqual(received, ["queued native"]);
    assert.equal(control.receive(event("off")), false); assert.equal(overlays.length, 0);
    assert.equal(control.receive({ ...event("unsupported"), ui: { theme: palette } as any }), false);
    const restore = observeNativeUIOwnership(() => { throw new Error("Should not run after foreign takeover"); });
    try {
      const nativeUi = proto.createExtensionUIContext.call({ showExtensionNotify() {} });
      const foreign = () => received.push("foreign"); nativeUi.notify = foreign;
      restore?.(); assert.equal(nativeUi.notify, foreign);
    } finally { restore?.(); }
  } finally { control.cleanup(); motionCoordinator.clear(); }
});

test("real TuiAltScreen keeps transcript/editor geometry, native keys/focus and foreign overlays intact", () => {
  const palette = theme(); let input: ((data: string) => void) | undefined;
  const terminal = { columns: 120, rows: 30, start(fn: (data: string) => void) { input = fn; }, stop() {}, write() {}, moveBy() {},
    hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, clearProgress() {} };
  const tui = new TuiAltScreen(terminal as any, true, tmpdir());
  let typed = "";
  const editor = { focused: false, render: () => ["NATIVE_EDITOR"], invalidate() {}, handleInput(s: string) { typed += s; } };
  const doc = new Container(); const text = new Text("NATIVE_TRANSCRIPT", 0, 0); doc.addChild(text);
  const root = new VStack([{ component: doc, grow: 1, basis: 0 }, { component: editor, basis: 1, shrink: 0 }]);
  tui.setLayoutRoot(root); tui.setFocus(editor); tui.start();
  const foreign = tui.showOverlay(new Text("FOREIGN_OVERLAY", 0, 0), { width: 20, row: 20, col: 0, nonCapturing: true });
  const control = createToastControl(() => true); const ui = { theme: palette, getBackgroundTui: () => tui } as any;
  try {
    control.refresh(context(ui), true);
    assert.equal(control.receive({ ui, message: "MCP_WARNING", type: "warning", fallback() { assert.fail("native fallback unexpected"); } }), true);
    tui.renderNow(true);
    const rows = tui.getScreenLines().map(stripTerminalSequences);
    assert.equal(tui.getFocusedComponent(), editor);
    input!("typed"); assert.equal(typed, "typed");
    assert.equal(rows.length, 30); assert.ok(rows.at(-1)!.includes("NATIVE_EDITOR"));
    assert.ok(rows[0]!.includes("NATIVE_TRANSCRIPT"));
    assert.ok(rows.join("\n").includes("MCP_WARNING"));
    assert.deepEqual(doc.children, [text]);
    control.cleanup(); tui.renderNow(true);
    assert.ok(tui.getScreenLines().join("\n").includes("FOREIGN_OVERLAY"));
    assert.equal(tui.getFocusedComponent(), editor);
  } finally { control.cleanup(); foreign.hide(); tui.stop(); motionCoordinator.clear(); notificationStore.clear(); }
});

test("essential semantic countdown uses the single coordinator even when animation is off", async () => {
  const coordinator = new MotionCoordinator(); let ticks = 0;
  configStore.setAnimationOverride("mode", "off");
  try {
    coordinator.setRenderCallback(() => ticks++);
    coordinator.register("visual", 16); assert.equal(coordinator.hasActive(), false);
    coordinator.register("toast-expiry", 16, { essential: true });
    await new Promise(resolve => setTimeout(resolve, 65));
    assert.ok(ticks > 0);
    coordinator.unregister("toast-expiry"); const stopped = ticks;
    await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(ticks, stopped);
    assert.equal(coordinator.hasActive(), false);
  } finally { coordinator.dispose(); configStore.clearSessionOverrides(); }
});

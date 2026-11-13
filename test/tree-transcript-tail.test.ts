import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { Container, ScrollView, Text, TuiAltScreen, VStack, stripTerminalSequences } from "@earendil-works/pi-tui";
import { observeNativeUIOwnership } from "../extensions/omt/core/native-ui.ts";
import { createModalHost } from "../extensions/omt/ui/modal.ts";

test("tree composes only native visible tail; scroll, history, overlays, draft and focus remain native", async () => {
  const restore = observeNativeUIOwnership();
  const terminal = { columns: 40, rows: 12, start() {}, stop() {}, write() {}, hideCursor() {}, showCursor() {},
    clearLine() {}, clearFromCursor() {}, clearScreen() {}, moveBy() {}, setTitle() {}, setProgress() {}, clearProgress() {} };
  const tui = new TuiAltScreen(terminal as any, false, tmpdir());
  const doc = new Container();
  const chat = new Container();
  doc.addChild(new Text("NATIVE_STARTUP_HEADER", 0, 0)); doc.addChild(chat);
  chat.addChild(new Text(Array.from({ length: 25 }, (_, i) => `native-${i}`).join("\n"), 0, 0));
  const children = [...doc.children];
  const scroll = new ScrollView(doc, { primary: true, follow: "end" });
  const editor = new Text("DRAFT 界", 0, 0);
  const root = new VStack([{ component: scroll, basis: 0, grow: 1 }, { component: editor, basis: 1 }]);
  tui.setLayoutRoot(root); tui.setFocus(editor);
  const ui = (InteractiveMode.prototype as any).createExtensionUIContext.call({ renderer: tui, fullscreenLayoutRoot: root, transcriptScrollView: scroll, documentContainer: doc, chatContainer: chat });
  assert.equal(typeof ui.getNativeTranscriptRows, "function");
  const frame = () => { tui.renderNow(); return tui.getScreenLines().map(stripTerminalSequences); };
  let complete: ((value?: unknown) => void) | undefined;
  ui.custom = (factory: any, options: any) => new Promise(resolve => {
    let overlay: ReturnType<typeof tui.showOverlay> | undefined;
    complete = value => { overlay?.hide(); resolve(value); };
    const component = factory(tui, {}, {}, complete);
    overlay = tui.showOverlay(component, options.overlayOptions());
  });
  const host = createModalHost();
  tui.start();
  try {
    frame(); scroll.scrollBy(-6); frame();
    const top = scroll.scrollTop, following = scroll.isFollowingEnd;
    const visible = ui.getNativeTranscriptRows(40, 12).map(stripTerminalSequences);
    assert.equal(visible.at(-1)?.trim(), "native-18");
    const foreign = tui.showOverlay(new Text("FOREIGN", 0, 0), { anchor: "top-right", width: 8, nonCapturing: true });
    frame();
    const pending = host.open({ hasUI: true, mode: "tui", ui } as any,
      () => ({ render: () => ["TREE", "PANEL"], invalidate() {} }),
      { anchor: "bottom-center", bottomInset: 2, transcriptTail: true });
    const rows = frame();
    assert.equal(rows[7]!.trim(), "native-18", `visible tail ends immediately above panel: ${JSON.stringify(rows)}`);
    assert.equal(rows[8]!.trim(), "TREE");
    assert.ok(!rows.join("\n").includes("DRAFT"));
    assert.ok(!rows.join("\n").includes("NATIVE_STARTUP_HEADER"));
    assert.ok(!rows.join("\n").includes("FOREIGN"), "foreign overlay pixels must not become transcript");
    assert.equal(scroll.scrollTop, top); assert.equal(scroll.isFollowingEnd, following);
    assert.deepEqual(doc.children, children); assert.equal((tui as any).layoutRoot, root);
    terminal.columns = 30; terminal.rows = 10;
    frame(); const resized = frame();
    assert.ok(resized.slice(0, 6).some(line => line.includes("native-")));
    assert.equal(resized[6]!.trim(), "TREE");
    host.reset(); await pending;
    assert.equal(tui.getFocusedComponent(), editor); assert.equal(foreign.isHidden(), false);
    assert.ok(frame().join("\n").includes("DRAFT 界"));
    foreign.hide();
    (chat.children[0] as Text).setText("ONLY_CHAT"); frame();
    const shortTail = ui.getNativeTranscriptRows(30, 10).map(stripTerminalSequences).join("\n");
    assert.ok(shortTail.includes("ONLY_CHAT"));
    assert.ok(!shortTail.includes("NATIVE_STARTUP_HEADER"), "short transcripts exclude native startup rows");
    (chat.children[0] as Text).setText(""); frame();
    assert.ok(ui.getNativeTranscriptRows(30, 10).map(stripTerminalSequences).join("\n").includes("NATIVE_STARTUP_HEADER"),
      "empty chat retains native welcome/startup content rather than a fabricated empty state");
    const nativeFrame = (tui as any).currentLayout;
    try {
      for (const badRoot of [{ component: root, children: {} }, { component: root, children: [null] }]) {
        (tui as any).currentLayout = { ...nativeFrame, root: badRoot };
        assert.equal(ui.getNativeTranscriptRows(30, 10), undefined, "unknown layout storage fails closed");
      }
      (tui as any).currentLayout = { ...nativeFrame, lines: nativeFrame.lines.map(() => "\x1b_Gimage-placement\x1b\\") };
      assert.equal(ui.getNativeTranscriptRows(30, 10), undefined, "image control sequences are not relocated");
    } finally { (tui as any).currentLayout = nativeFrame; }
    const foreignRoot = new VStack([new Text("foreign root", 0, 0)]);
    tui.setLayoutRoot(foreignRoot); frame();
    assert.equal(ui.getNativeTranscriptRows(30, 10), undefined);
    restore?.(); assert.equal(ui.getNativeTranscriptRows(30, 10), undefined, "retained observer is inert");
  } finally { complete?.(); tui.stop(); restore?.(); }
});

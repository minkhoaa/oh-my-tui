import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { InteractiveMode, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Container, HStack, ScrollView, Text, TuiAltScreen, VStack, visibleWidth } from "@earendil-works/pi-tui";
import { installNativeViewportPresentation, observeNativeUIOwnership } from "../extensions/omt/core/native-ui.ts";
import { adaptSidebarMetadata } from "../extensions/omt/features/omt-adapters/index.ts";

function fixture() {
  const terminal = {
    columns: 192, rows: 49,
    start() {}, stop() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {},
    setTitle() {}, setProgress() {}, clearProgress() {},
  };
  const tui = new TuiAltScreen(terminal as any, false, tmpdir());
  const document = new Container();
  document.addChild(new Text("native transcript", 0, 0));
  const transcript = new ScrollView(document, { follow: "end", primary: true, scrollbar: "hidden" });
  const dock = new VStack([new Text("native editor", 0, 0)]);
  const root = new VStack([{ component: transcript, grow: 1, basis: 0 }, dock]);
  tui.setLayoutRoot(root);
  const host = { renderer: tui, fullscreenLayoutRoot: root, transcriptScrollView: transcript };
  const ui = (InteractiveMode.prototype as any).createExtensionUIContext.call(host);
  return { terminal, tui, document, transcript, root, host, ui };
}

test("sidebar reads native resolved compaction default without inventing missing settings or accepting foreign managers", () => {
  const restore = observeNativeUIOwnership();
  try {
    const manager = SettingsManager.inMemory({});
    assert.equal(manager.getSettings().compaction, undefined);
    const ui = (InteractiveMode.prototype as any).createExtensionUIContext.call({ settingsManager: manager });
    const ctx = { cwd: "/fixture", ui, sessionManager: { getBranch: () => [] } } as any;
    assert.equal(adaptSidebarMetadata(undefined, ctx).autoCompact, manager.getCompactionEnabled());
    manager.setCompactionEnabled(false);
    assert.equal(adaptSidebarMetadata(undefined, ctx).autoCompact, false);
    const unknown = (InteractiveMode.prototype as any).createExtensionUIContext.call({ settingsManager: { getCompactionEnabled: () => true } });
    assert.equal(adaptSidebarMetadata(undefined, { ...ctx, ui: unknown }).autoCompact, undefined);
    restore?.();
    assert.equal(adaptSidebarMetadata(undefined, ctx).autoCompact, undefined, "retained observer is inert");
  } finally { restore?.(); }
});

test("owned viewport composition retains native components and restores exact root through public API", () => {
  const restore = observeNativeUIOwnership();
  assert.ok(restore);
  try {
    const f = fixture();
    const documentRows = [...f.document.children];
    let composition: HStack | undefined;
    const sidebar = new Text("sidebar", 0, 0);
    const binding = installNativeViewportPresentation(f.ui, (root, tui) => {
      assert.equal(root, f.root);
      assert.equal(tui, f.tui);
      composition = new HStack([
        { component: root, basis: 0, grow: 1, minSize: 1 },
        { component: sidebar, basis: 34, grow: 0, shrink: 0, minSize: 34, maxSize: 34,
          visible: viewport => viewport.width >= 80 },
      ]);
      return composition;
    });
    assert.ok(binding?.owned());
    assert.equal((f.tui as any).layoutRoot, composition);
    assert.equal(composition!.children[0], f.root);
    assert.equal(f.root.children[0], f.transcript);
    assert.deepEqual(f.document.children, documentRows, "history is not rebuilt or reparented");
    assert.equal(f.transcript.isFollowingEnd, true);
    for (const width of [20, 40, 79, 80, 120, 192]) {
      assert.ok(composition!.render(width).every(row => visibleWidth(row) <= width));
    }
    binding!.dispose();
    binding!.dispose();
    assert.equal((f.tui as any).layoutRoot, f.root);
    assert.equal(binding!.owned(), false);
  } finally { restore?.(); }
});

test("layout ownership yields to a preexisting or later third-party root", () => {
  const restore = observeNativeUIOwnership();
  try {
    const f = fixture();
    const foreign = new VStack([new Text("foreign layout", 0, 0)]);
    f.tui.setLayoutRoot(foreign);
    let composed = false;
    assert.equal(installNativeViewportPresentation(f.ui, root => { composed = true; return new HStack([root]); }), undefined);
    assert.equal(composed, false);
    f.tui.setLayoutRoot(f.root);
    const binding = installNativeViewportPresentation(f.ui, root => new HStack([root]));
    assert.ok(binding?.owned());
    f.tui.setLayoutRoot(foreign);
    assert.equal(binding!.owned(), false);
    binding!.dispose();
    assert.equal((f.tui as any).layoutRoot, foreign, "cleanup never restores over a newer owner");
  } finally { restore?.(); }
});

test("unknown/native viewport storage and non-fullscreen modes fail closed independently", () => {
  const restore = observeNativeUIOwnership();
  try {
    const f = fixture();
    const contexts = [
      {},
      { getNativeViewportPresentation: () => undefined },
      (InteractiveMode.prototype as any).createExtensionUIContext.call({ renderer: f.tui }),
      (InteractiveMode.prototype as any).createExtensionUIContext.call({ ...f.host, fullscreenLayoutRoot: new Container() }),
      (InteractiveMode.prototype as any).createExtensionUIContext.call({ ...f.host, transcriptScrollView: new Text("foreign", 0, 0) }),
    ];
    for (const ui of contexts) assert.equal(installNativeViewportPresentation(ui as any, root => new HStack([root])), undefined);
    assert.equal((f.tui as any).layoutRoot, f.root);
  } finally { restore?.(); }
});

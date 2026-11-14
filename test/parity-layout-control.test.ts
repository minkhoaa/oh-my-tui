import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { InteractiveMode, initTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, HStack, ScrollView, Text, TuiAltScreen, VStack } from "@earendil-works/pi-tui";
import { observeNativeUIOwnership } from "../extensions/omt/core/native-ui.ts";
import { resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";
import { createSignatureLayoutControl, type SidebarDockFactory } from "../extensions/omt/integration/layout.ts";

function fixture() {
  initTheme("dark");
  const terminal = { columns: 192, rows: 49, start() {}, stop() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, clearProgress() {} };
  const tui = new TuiAltScreen(terminal as any, false, tmpdir());
  const document = new Container();
  const transcript = new ScrollView(document, { primary: true, follow: "end" });
  const root = new VStack([{ component: transcript, grow: 1, basis: 0 }, new Text("editor", 0, 0)]);
  tui.setLayoutRoot(root);
  const ui = (InteractiveMode.prototype as any).createExtensionUIContext.call({ renderer: tui, fullscreenLayoutRoot: root, transcriptScrollView: transcript });
  const ctx = { mode: "tui", hasUI: true, ui } as ExtensionContext;
  let enabled = true;
  const docked: boolean[] = [];
  return {
    tui, root, ctx, docked,
    source: { getState: () => ({}), isEnabled: () => enabled, setDocked(value: boolean) { docked.push(value); } },
    disable() { enabled = false; },
  };
}

test("signature layout mounts one real dock and restores native root on preset change", async () => {
  const restore = observeNativeUIOwnership();
  setActiveTheme("omt-signature");
  let control: ReturnType<typeof createSignatureLayoutControl> | undefined;
  try {
    const f = fixture();
    let loads = 0;
    let disposed = 0;
    control = createSignatureLayoutControl(f.source, async () => {
      loads++;
      return () => ({ render: () => ["sidebar"], invalidate() {}, dispose() { disposed++; } });
    });
    assert.equal(await control.refresh(f.ctx), true);
    const composed = (f.tui as any).layoutRoot;
    assert.ok(composed instanceof HStack);
    assert.equal(composed.children[0], f.root);
    assert.equal(await control.refresh(f.ctx), true);
    assert.equal(loads, 1);
    assert.deepEqual(f.docked, [true]);
    setActiveTheme("native");
    assert.equal(await control.refresh(f.ctx), false);
    assert.equal((f.tui as any).layoutRoot, f.root);
    assert.deepEqual(f.docked, [true, false]);
    assert.equal(disposed, 1);
    assert.equal(control.getIssue(), undefined);
    control.cleanup();
    assert.equal(disposed, 1);
  } finally { control?.cleanup(); restore?.(); resetActiveTheme(); }
});

test("new-session layout handoff keeps the OMT viewport mounted while the next dock loads", async () => {
  const restore = observeNativeUIOwnership();
  setActiveTheme("omt-signature");
  let previous: ReturnType<typeof createSignatureLayoutControl> | undefined;
  let current: ReturnType<typeof createSignatureLayoutControl> | undefined;
  try {
    const f = fixture();
    let releaseNext: (() => void) | undefined;
    let previousDisposed = 0;
    previous = createSignatureLayoutControl(f.source, async () => () => ({
      render: () => ["previous sidebar"], invalidate() {}, dispose() { previousDisposed++; },
    }));
    assert.equal(await previous.refresh(f.ctx), true);
    const oldRoot = (f.tui as any).layoutRoot;
    const nextContext = { ...f.ctx } as ExtensionContext;
    current = createSignatureLayoutControl(f.source, () => new Promise(resolve => {
      releaseNext = () => resolve(() => ({ render: () => ["next sidebar"], invalidate() {} }));
    }));

    const pending = current.refresh(nextContext);
    await Promise.resolve();
    assert.equal((f.tui as any).layoutRoot, oldRoot, "keep the previous OMT viewport while lazy UI loads");
    releaseNext!();
    assert.equal(await pending, true);
    const nextRoot = (f.tui as any).layoutRoot;
    assert.ok(nextRoot instanceof HStack);
    assert.notEqual(nextRoot, oldRoot);
    assert.equal(nextRoot.children[0], f.root, "replace old composition with the native root, not a nested dock");
    assert.equal(previousDisposed, 1);
    assert.equal(current.isMounted(), true);
  } finally { current?.cleanup(); previous?.cleanup(); restore?.(); resetActiveTheme(); }
});

test("a later root owner is never overwritten; a native root restored by its owner may remount", async () => {
  const restore = observeNativeUIOwnership();
  setActiveTheme("omt-signature");
  let control: ReturnType<typeof createSignatureLayoutControl> | undefined;
  try {
    const f = fixture();
    let disposed = 0;
    control = createSignatureLayoutControl(f.source, async () => () => ({ render: () => [], invalidate() {}, dispose() { disposed++; } }));
    assert.equal(await control.refresh(f.ctx), true);
    const foreign = new Text("foreign root", 0, 0);
    f.tui.setLayoutRoot(foreign);
    assert.equal(await control.refresh(f.ctx), false);
    assert.equal((f.tui as any).layoutRoot, foreign);
    assert.equal(disposed, 1);
    assert.match(control.getIssue()!, /owned elsewhere/);
    f.tui.setLayoutRoot(f.root);
    assert.equal(await control.refresh(f.ctx), true);
    assert.equal(control.isMounted(), true);
    f.disable();
    assert.equal(await control.refresh(f.ctx), false);
    assert.equal((f.tui as any).layoutRoot, f.root);
  } finally { control?.cleanup(); restore?.(); resetActiveTheme(); }
});

test("cleanup and preset changes cancel in-flight lazy dock mounting", async () => {
  const restore = observeNativeUIOwnership();
  setActiveTheme("omt-signature");
  let control: ReturnType<typeof createSignatureLayoutControl> | undefined;
  try {
    const f = fixture();
    let finish: (factory: SidebarDockFactory) => void = () => {};
    let creates = 0;
    control = createSignatureLayoutControl(f.source, () => new Promise(resolve => { finish = resolve; }));
    const pending = control.refresh(f.ctx);
    control.cleanup();
    finish(() => { creates++; return new Text("unused", 0, 0); });
    assert.equal(await pending, false);
    assert.equal(creates, 0);
    assert.equal((f.tui as any).layoutRoot, f.root);
    assert.deepEqual(f.docked, []);
  } finally { control?.cleanup(); restore?.(); resetActiveTheme(); }
});

test("unsupported hosts and failed lazy factories produce diagnostics without claiming parity", async () => {
  const restore = observeNativeUIOwnership();
  setActiveTheme("omt-signature");
  let control: ReturnType<typeof createSignatureLayoutControl> | undefined;
  try {
    const f = fixture();
    control = createSignatureLayoutControl(f.source, async () => undefined);
    assert.equal(await control.refresh(f.ctx), false);
    assert.match(control.getIssue()!, /factory missing/);
    control.cleanup();
    control = createSignatureLayoutControl(f.source, async () => { throw new Error("fixture factory failure"); });
    assert.equal(await control.refresh(f.ctx), false);
    assert.match(control.getIssue()!, /fixture factory failure/);
    control.cleanup();
    control = createSignatureLayoutControl(f.source, async () => () => new Text("unused", 0, 0));
    const unknown = { ...f.ctx, ui: { theme: f.ctx.ui.theme } } as ExtensionContext;
    assert.equal(await control.refresh(unknown), false);
    assert.match(control.getIssue()!, /unsupported or owned elsewhere/);
    assert.equal((f.tui as any).layoutRoot, f.root);
  } finally { control?.cleanup(); restore?.(); resetActiveTheme(); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { InteractiveMode, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, TuiAltScreen, stripTerminalSequences } from "@earendil-works/pi-tui";
import { observeNativeUIOwnership, installNativeHeaderPresentation } from "../extensions/omt/core/native-ui.ts";
import { OMT_HEADER_OWNER, createHeaderControl } from "../extensions/omt/features/header/index.ts";
import { resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";

function fixture() {
  initTheme("dark");
  const resources = new Container(), document = new Container(), header = new Container();
  const transcript = new Text("native transcript", 0, 0);
  document.addChild(header);
  document.addChild(resources);
  document.addChild(transcript);

  const tui = new TuiAltScreen({ columns: 80, rows: 25, write() {}, start() {}, stop() {} } as any, false, tmpdir());
  const builtin = new Text("BUILTIN_HEADER", 0, 0);
  header.addChild(new Spacer(1));
  header.addChild(builtin);
  header.addChild(new Spacer(1));

  const host = Object.assign(Object.create(InteractiveMode.prototype), {
    renderer: tui,
    headerContainer: header,
    loadedResourcesContainer: resources,
    documentContainer: document,
    builtInHeader: builtin,
    customHeader: undefined,
    ui: tui,
    toolOutputExpanded: false,
    options: {},
  });

  const ui = (InteractiveMode.prototype as any).createExtensionUIContext.call(host);
  return { ui, header, resources, document, transcript, tui, host, builtin };
}

test("compact owned session header drops only its native trailing gap, preserving diagnostics, welcome and mouse coordinates", () => {
  const restore = observeNativeUIOwnership();
  let dispose: (() => void) | undefined;
  try {
    const f = fixture();
    const children = [...f.header.children];
    let enabled = true;
    let clicked = -1;
    (f.builtin as any).handleMouse = (event: any) => { clicked = event.y; return { handled: true }; };
    dispose = installNativeHeaderPresentation(f.ui, () => enabled, { compact: true });
    assert.ok(dispose);
    for (const width of [20, 80]) {
      const lines = f.header.render(width).map(l => stripTerminalSequences(l).trimEnd());
      assert.deepEqual(lines, ["BUILTIN_HEADER"]);
      f.header.handleMouse({ type: "click", button: "left", x: 1, y: 0, width, height: 1 } as any);
      assert.equal(clicked, 0);
      assert.equal(f.header.handleMouse({ type: "click", button: "left", x: 1, y: 1, width, height: 1 } as any), undefined);
    }
    assert.deepEqual(f.header.children, children);
    enabled = false;
    assert.equal(f.header.render(80).length, 3);
    enabled = true;
    f.builtin.setText("SESSION\nWELCOME");
    assert.equal(f.header.render(80).length, 3, "multi-row welcome keeps its trailing gap");
    f.builtin.setText("SESSION");
    f.header.addChild(new Text("native diagnostic", 0, 0));
    const withDiagnostic = f.header.render(80).map(stripTerminalSequences);
    assert.equal(withDiagnostic.length, 3, "extra native children forbid compact-gap cropping");
    assert.ok(withDiagnostic.at(-1)?.includes("native diagnostic"));
    f.header.removeChild(f.header.children.at(-1)!);
    const trailing = f.header.children[2]!;
    trailing.render = () => ["foreign gap"];
    assert.ok(f.header.render(80).at(-1)?.includes("foreign gap"));
    dispose(); dispose = undefined;
    assert.equal(f.header.render, Container.prototype.render);
  } finally { dispose?.(); restore?.(); }
});

test("Signature header crops leading native Spacer1 to begin at row0 and preserves children and other spacers", () => {
  const restore = observeNativeUIOwnership();
  let dispose: (() => void) | undefined;
  try {
    const f = fixture();
    const beforeChildren = [...f.header.children];
    assert.equal(f.header.children.length, 3);
    assert.ok(f.header.children[0] instanceof Spacer);
    assert.equal((f.header.children[0] as any).lines, 1);

    // With native header, line 0 is blank spacer
    const nativeLines = f.header.render(80).map((l) => stripTerminalSequences(l).trimEnd());
    assert.equal(nativeLines[0], "");
    assert.equal(nativeLines[1], "BUILTIN_HEADER");
    assert.equal(nativeLines[2], "");

    // Install presentation with owned header
    let enabled = true;
    let owned = true;
    dispose = installNativeHeaderPresentation(f.ui, () => enabled && owned);
    assert.ok(dispose);

    // With owned predicate active, but header is not yet replaced in f.header
    // It still crops first spacer because predicate returned true
    const croppedLines = f.header.render(80).map((l) => stripTerminalSequences(l).trimEnd());
    assert.equal(croppedLines.length, 2);
    assert.equal(croppedLines[0], "BUILTIN_HEADER");
    assert.equal(croppedLines[1], "");

    // Children array is strictly untouched
    assert.deepEqual(f.header.children, beforeChildren);

    // Disable restores native row 0 spacer
    enabled = false;
    assert.deepEqual(f.header.render(80).map((l) => stripTerminalSequences(l).trimEnd()), nativeLines);

    // Re-enable
    enabled = true;
    assert.equal(f.header.render(80).map((l) => stripTerminalSequences(l).trimEnd())[0], "BUILTIN_HEADER");

    // Dispose cleans up render hook and restores Container.prototype.render
    dispose();
    dispose = undefined;
    assert.equal(f.header.render, Container.prototype.render);
    assert.deepEqual(f.header.render(80).map((l) => stripTerminalSequences(l).trimEnd()), nativeLines);
  } finally {
    dispose?.();
    restore?.();
  }
});

test("real InteractiveMode setter with CleanHeaderComponent mounts at row0 under Signature and restores original spacer on disable/native", () => {
  const restore = observeNativeUIOwnership();
  setActiveTheme("omt-signature");
  let dispose: (() => void) | undefined;
  try {
    const f = fixture();
    const ctx = {
      mode: "tui",
      ui: f.ui,
      cwd: "/test/path",
      sessionManager: {
        getSessionName: () => "test-sess",
        getEntries: () => [{ type: "message", role: "user" }],
      },
    } as any;
    const control = createHeaderControl();
    control.on(ctx);

    let enabled = true;
    dispose = installNativeHeaderPresentation(f.ui, () => enabled && !!(f.ui as any).getHeaderComponent?.()?.[OMT_HEADER_OWNER]);
    assert.ok(dispose);

    // In f.host, setExtensionHeader was invoked by control.on
    // f.headerContainer now has [Spacer1, CleanHeaderComponent, Spacer1]
    assert.equal(f.header.children.length, 3);
    assert.ok(f.header.children[0] instanceof Spacer);

    const lines = f.header.render(80).map((l) => stripTerminalSequences(l).trimEnd());
    // Row 0 should immediately be the owned header text, not empty line!
    assert.ok(lines[0]!.length > 0, "row0 must be the owned header, not empty spacer");
    assert.doesNotMatch(lines[0]!, /^$/, "row0 cannot be blank");

    // Disable restores native first spacer
    enabled = false;
    const restoredLines = f.header.render(80).map((l) => stripTerminalSequences(l).trimEnd());
    assert.equal(restoredLines[0], "");
    assert.equal(restoredLines[1], lines[0]);

    // Theme switch to native
    setActiveTheme("native");
    control.applyTheme(ctx);
    enabled = true; // Enabled predicate checks OMT_HEADER_OWNER which is false now
    const nativeThemeLines = f.header.render(80).map((l) => stripTerminalSequences(l).trimEnd());
    assert.equal(nativeThemeLines[0], "", "native theme restores leading spacer");
    assert.equal(nativeThemeLines[1], "BUILTIN_HEADER");

    control.cleanup(ctx);
  } finally {
    dispose?.();
    restore?.();
    resetActiveTheme();
  }
});

test("header mouse coordinates and cache correctly map y to y+1 and ignore out-of-bounds", () => {
  const restore = observeNativeUIOwnership();
  let dispose: (() => void) | undefined;
  try {
    const f = fixture();
    let clickedY: number | undefined;
    const interactiveChild = new Text("CLICKABLE_HEADER\nLINE2", 0, 0);
    (interactiveChild as any).handleMouse = (event: any) => {
      clickedY = event.y;
      return { handled: true };
    };

    // Header has Spacer1, interactiveChild (2 lines), Spacer1
    f.header.children[1] = interactiveChild;
    let enabled = true;
    dispose = installNativeHeaderPresentation(f.ui, () => enabled);
    assert.ok(dispose);

    // Visible rendered lines are:
    // y=0: "CLICKABLE_HEADER" (source y=1)
    // y=1: "LINE2" (source y=2)
    // y=2: "" (source y=3, trailing spacer)
    const rendered = f.header.render(80);
    assert.equal(rendered.length, 3);

    // Click at visible row 0
    const res0 = f.header.handleMouse({
      type: "click", button: "left", x: 2, y: 0, width: 80, height: rendered.length,
      screenX: 2, screenY: 0, shift: false, ctrl: false, alt: false,
    });
    assert.ok(res0?.handled);
    assert.equal(clickedY, 0, "child relative y: source y was 1, child offset is 1, so event.y inside child is 0");

    // Click at visible row 1
    const res1 = f.header.handleMouse({
      type: "click", button: "left", x: 2, y: 1, width: 80, height: rendered.length,
      screenX: 2, screenY: 1, shift: false, ctrl: false, alt: false,
    });
    assert.ok(res1?.handled);
    assert.equal(clickedY, 1, "child relative y: source y was 2, child offset is 1, so event.y inside child is 1");

    // Click out of bounds (negative or beyond visible height)
    const resNeg = f.header.handleMouse({
      type: "click", button: "left", x: 2, y: -1, width: 80, height: rendered.length,
      screenX: 2, screenY: -1, shift: false, ctrl: false, alt: false,
    });
    assert.equal(resNeg, undefined);

    const resOverflow = f.header.handleMouse({
      type: "click", button: "left", x: 2, y: 3, width: 80, height: rendered.length,
      screenX: 2, screenY: 3, shift: false, ctrl: false, alt: false,
    });
    assert.equal(resOverflow, undefined);

    enabled = false;
    f.header.render(80);
    assert.doesNotThrow(() => f.header.handleMouse({
      type: "click", button: "left", x: 2, y: 0, width: 80, height: 4,
      screenX: 2, screenY: 0, shift: false, ctrl: false, alt: false,
    }), "disabled handler delegates to captured native mouse, not itself");
  } finally {
    dispose?.();
    restore?.();
  }
});

test("foreign render wrapper, foreign mouse handler, or foreign header ownership cause adapter to yield and make retained wrappers inert", () => {
  const restore = observeNativeUIOwnership();
  let dispose: (() => void) | undefined;
  try {
    const f = fixture();
    const nativeLines = f.header.render(80);

    // 1. Adapter yields if container already has foreign render wrapper
    const foreignRender = function(this: any, width: number) { return ["foreign surface"]; };
    f.header.render = foreignRender;
    assert.equal(installNativeHeaderPresentation(f.ui, () => true), undefined, "fails closed when render is not Container.prototype.render");
    delete (f.header as any).render;

    // 2. Adapter yields if container already has foreign mouse handler
    const foreignMouse = function(this: any) { return { handled: true }; };
    f.header.handleMouse = foreignMouse as any;
    assert.equal(installNativeHeaderPresentation(f.ui, () => true), undefined, "fails closed when handleMouse is not Container.prototype.handleMouse");
    delete (f.header as any).handleMouse;

    // 3. Foreign ownership during lifetime makes retained wrapper inert
    dispose = installNativeHeaderPresentation(f.ui, () => true);
    assert.ok(dispose);
    const retainedRender = f.header.render;
    const retainedMouse = f.header.handleMouse;

    // Simulate foreign extension taking over render
    f.header.render = foreignRender;
    // Calling retained render wrapper now must yield to native lines, not crop
    assert.deepEqual(retainedRender.call(f.header, 80), nativeLines);

    // Simulate foreign extension taking over mouse
    let foreignMouseClicked = false;
    f.header.handleMouse = function() { foreignMouseClicked = true; return { handled: true }; } as any;
    const mouseRes = retainedMouse.call(f.header, {
      type: "click", button: "left", x: 0, y: 0, width: 80, height: 3,
      screenX: 0, screenY: 0, shift: false, ctrl: false, alt: false,
    });
    assert.equal(foreignMouseClicked, false, "retained wrapper must be inert rather than call a replacement that may retain it");
    assert.equal(mouseRes, undefined);
    const foreignDecorator = function(this: Container, event: any) { return retainedMouse.call(this, event); };
    f.header.handleMouse = foreignDecorator;
    assert.doesNotThrow(() => f.header.handleMouse({
      type: "click", button: "left", x: 0, y: 0, width: 80, height: 3,
      screenX: 0, screenY: 0, shift: false, ctrl: false, alt: false,
    }), "foreign decorators retaining an old wrapper must not recurse");

    // Dispose cleans up only own hook if still attached, but here foreign is attached so it leaves it
    dispose();
    dispose = undefined;
    assert.equal(f.header.render, foreignRender);
    assert.equal(f.header.handleMouse, foreignDecorator);
  } finally {
    dispose?.();
    restore?.();
  }
});

test("guarded native boundary checks document children hierarchy and fails closed on foreign structure", () => {
  const restore = observeNativeUIOwnership();
  try {
    // 1. Corrupted hierarchy: document children reversed or missing transcript
    const f = fixture();
    assert.ok(f.ui.getNativeHeaderContainer());

    f.document.clear();
    f.document.addChild(f.resources);
    f.document.addChild(f.header); // inverted order!
    assert.equal(f.ui.getNativeHeaderContainer(), undefined, "must reject inverted hierarchy");

    f.document.clear();
    f.document.addChild(f.header);
    f.document.addChild(f.resources);
    // only 2 children, transcript missing
    assert.equal(f.ui.getNativeHeaderContainer(), undefined, "must reject missing transcript");

    // 2. Non-container document
    const badHost = Object.assign(Object.create(InteractiveMode.prototype), {
      renderer: f.tui,
      headerContainer: f.header,
      loadedResourcesContainer: f.resources,
      documentContainer: { children: [f.header, f.resources, f.transcript] }, // not Container instance
    });
    const badUi = (InteractiveMode.prototype as any).createExtensionUIContext.call(badHost);
    assert.equal(badUi.getNativeHeaderContainer(), undefined, "must reject non-Container document");
    for (const unsupported of [{}, { getNativeHeaderContainer: true }, { getNativeHeaderContainer: () => ({ render: Container.prototype.render, handleMouse: Container.prototype.handleMouse }) }]) {
      assert.equal(installNativeHeaderPresentation(unsupported as any, () => true), undefined, "unknown getter or lookalike container fails closed");
    }
  } finally {
    restore?.();
  }
});

test("header cropping rejects foreign spacer renderers and only removes exactly one recognized native row", () => {
  const restore = observeNativeUIOwnership();
  let dispose: (() => void) | undefined;
  try {
    const f = fixture();
    const spacer = f.header.children[0] as Spacer;
    dispose = installNativeHeaderPresentation(f.ui, () => true);
    assert.ok(dispose);
    const foreignSpacerRender = () => [""];
    spacer.render = foreignSpacerRender;
    assert.equal(f.header.render(20).length, 3, "foreign spacer renderer is never hidden");
    assert.equal(spacer.render, foreignSpacerRender);
    delete (spacer as Partial<Spacer>).render;
    (spacer as any).handleMouse = () => ({ handled: true });
    assert.equal(f.header.render(20).length, 3, "an interactive foreign spacer keeps its pointer row");
    delete (spacer as any).handleMouse;
    spacer.setLines(2);
    assert.equal(f.header.render(20).length, 4, "a two-row native spacer is not the recognized startup margin");
    spacer.setLines(1);
    for (const width of [20, 40, 80, 192]) {
      const rows = f.header.render(width).map(stripTerminalSequences);
      assert.equal(rows.length, 2);
      assert.equal(rows[0].trimEnd(), "BUILTIN_HEADER");
    }
    const childSnapshot = [...f.header.children];
    f.header.children[1] = new Text("FOREIGN_HEADER", 0, 0);
    // The actual runtime predicate observes ownership dynamically.
    dispose(); dispose = undefined;
    dispose = installNativeHeaderPresentation(f.ui, () => f.header.children[1] === childSnapshot[1]);
    assert.equal(f.header.render(80)[0], "", "losing header ownership restores native margin");
  } finally { dispose?.(); restore?.(); }
});

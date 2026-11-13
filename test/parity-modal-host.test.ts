import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, CURSOR_MARKER, ScrollView, stripTerminalSequences, Text, TuiAltScreen, visibleWidth, VStack } from "@earendil-works/pi-tui";
import { createModalHost } from "../extensions/omt/ui/modal.ts";

test("signature overlay measures source geometry at terminal width and retains focus/input/mouse", async () => {
  const terminal = { columns: 192, rows: 49 };
  const widths: number[] = [];
  const events: unknown[] = [];
  let focused = false;
  let disposed = 0;
  const component = {
    get focused() { return focused; },
    set focused(value: boolean) { focused = value; },
    capturesViewportInput: true,
    render(width: number) {
      widths.push(width);
      const boxWidth = Math.min(150, Math.max(20, width - 10));
      return [(focused ? CURSOR_MARKER : "") + "╭" + "─".repeat(boxWidth - 2) + "╮"];
    },
    handleInput(data: string) { events.push(data); },
    handleMouse(event: unknown) { events.push(event); return { handled: true }; },
    invalidate() { events.push("invalidate"); },
    dispose() { disposed++; },
  };
  const ctx = {
    hasUI: true, mode: "tui",
    ui: {
      async custom(factory: any, options: any) {
        assert.equal(options.overlay, true);
        let result: unknown;
        const wrapper = factory({ terminal }, {}, {}, (value: unknown) => { result = value; });
        assert.deepEqual(options.overlayOptions(), { width: "100%", maxHeight: "100%", row: 0, col: 0 });
        wrapper.focused = true;
        assert.equal(component.focused, true);
        assert.equal(wrapper.capturesViewportInput, true);

        // Full terminal blank background canvas mask rendered to 192 columns and 49 rows
        const rendered49 = wrapper.render(192);
        assert.equal(rendered49.length, 49, "Modal mask spans full terminal rows");
        assert.equal(visibleWidth(rendered49[0]), 192, "Top padding row spans full terminal width");
        assert.equal(rendered49[0].trim(), "", "Top padding row is blank");

        // Centered dialog row: boxWidth at 192 columns is 150. Centered left margin is (192 - 150) / 2 = 21
        const dialogRowIdx = Math.floor((Math.max(1, 49 - 2) - 1) / 2); // row 23
        const dialogRow = rendered49[dialogRowIdx];
        assert.equal(visibleWidth(dialogRow), 192, "Dialog line spans full terminal width with blank padding");
        assert.ok(dialogRow.includes(CURSOR_MARKER));
        assert.ok(dialogRow.includes("╭" + "─".repeat(148) + "╮"), "Inner dialog retains exact 150 col box geometry");
        const trimmedDialog = dialogRow.trim();
        assert.equal(visibleWidth(trimmedDialog), 150, "Inner dialog width remains exactly 150");

        wrapper.handleInput("界");

        // Mouse click inside child rectangle: leftPad = 21, topPad = 23.
        // Screen click at (25, 23) translates to child (4, 0).
        const mouseInside = { type: "click", button: "left", x: 25, y: dialogRowIdx, width: 192, height: 49 };
        assert.deepEqual(wrapper.handleMouse(mouseInside), { handled: true });

        // Mouse click outside child rectangle returns undefined
        const mouseOutside = { type: "click", button: "left", x: 5, y: 5, width: 192, height: 49 };
        assert.equal(wrapper.handleMouse(mouseOutside), undefined);

        wrapper.invalidate();
        assert.deepEqual(events, ["界", { ...mouseInside, x: 4, y: 0, width: 192, height: 1 }, "invalidate"]);

        terminal.columns = 80;
        terminal.rows = 24;
        assert.deepEqual(options.overlayOptions(), { width: "100%", maxHeight: "100%", row: 0, col: 0 });
        const rendered24 = wrapper.render(80);
        assert.equal(rendered24.length, 24);
        assert.equal(visibleWidth(rendered24[0]), 80);
        // Box width at 80 cols is min(150, max(20, 70)) = 70.
        const dialogRow24 = rendered24[Math.floor((Math.max(1, 24 - 2) - 1) / 2)];
        assert.equal(visibleWidth(dialogRow24), 80);
        assert.equal(visibleWidth(dialogRow24.trim()), 70, "Inner dialog width at 80 cols is 70");
        assert.ok(widths.every(width => width === 192 || width === 80));

        wrapper.dispose();
        return result;
      },
    },
  } as unknown as ExtensionContext;
  await createModalHost().open(ctx, () => component, {});
  assert.equal(disposed, 1);
});

test("bottom panels use native overlay anchor; ordinary presets retain inline custom UI", async () => {
  const calls: unknown[] = [];
  const ctx = {
    hasUI: true, mode: "tui",
    ui: {
      async custom(factory: any, options: any) {
        const child = factory({ terminal: { columns: 192, rows: 49 } }, {}, {}, () => {});
        calls.push(options?.overlayOptions?.());
        if (options) {
          assert.equal(options.overlay, true);
          const rendered = child.render(192);
          // Bottom-anchored overlay renders 48 blank rows above, 1 dialog row at bottom
          assert.equal(rendered.length, 49);
          assert.equal(rendered[0].trim(), "");
          assert.equal(rendered[48], "─".repeat(192));
        } else {
          assert.deepEqual(child.render(192), ["─".repeat(192)]);
        }
      },
    },
  } as unknown as ExtensionContext;
  const host = createModalHost();
  const component = { render: () => ["─".repeat(192)], invalidate() {} };
  await host.open(ctx, () => component, { anchor: "bottom-center" });
  await host.open(ctx, () => component);
  assert.deepEqual(calls, [{ width: "100%", maxHeight: "100%", row: 0, col: 0 }, undefined]);
});

test("modal guard prevents overlapping OMT interactions and recovers after completion/error", async () => {
  let complete: (value: unknown) => void = () => {};
  let reject: (error: Error) => void = () => {};
  let mounts = 0;
  const notices: unknown[] = [];
  const ctx = {
    hasUI: true, mode: "tui",
    ui: {
      custom(factory: any) {
        mounts++;
        return new Promise((resolve, fail) => {
          reject = fail;
          factory({ terminal: { columns: 192, rows: 49 } }, {}, {}, resolve);
        });
      },
      notify(...args: unknown[]) { notices.push(args); },
    },
  } as unknown as ExtensionContext;
  const host = createModalHost();
  const factory = (_tui: any, _theme: any, _keys: any, done: any) => {
    complete = done;
    return { render: () => [], invalidate() {} };
  };
  const first = host.open(ctx, factory, {});
  assert.equal(await host.open(ctx, factory, {}), undefined);
  assert.equal(mounts, 1);
  assert.deepEqual(notices, [["Another OMT dialog is already open.", "warning"]]);
  complete("selected");
  assert.equal(await first, "selected");
  const second = host.open(ctx, factory, {});
  reject(new Error("fixture failure"));
  await assert.rejects(second, /fixture failure/);
  const third = host.open(ctx, factory, {});
  complete(undefined);
  assert.equal(await third, undefined);
  assert.equal(mounts, 3);
});

test("reset closes only the owned dialog; stale completions cannot release a newer modal guard", async () => {
  const completions: Array<(value?: unknown) => void> = [];
  const notices: string[] = [];
  const ctx = { hasUI: true, mode: "tui", ui: {
    notify: (message: string) => notices.push(message),
    custom(factory: any) { return new Promise(resolve => { factory({ terminal: { columns: 192, rows: 49 } }, {}, {}, resolve); }); },
  } } as unknown as ExtensionContext;
  const host = createModalHost();
  const factory = (_tui: any, _theme: any, _keys: any, done: (value?: unknown) => void) => {
    completions.push(done); return { render: () => [], invalidate() {} };
  };
  const first = host.open(ctx, factory, {});
  host.reset();
  const second = host.open(ctx, factory, {});
  assert.equal(await first, undefined);
  completions[0]!("late result");
  assert.equal(await host.open(ctx, factory, {}), undefined);
  assert.equal(notices.length, 1, "old finalization did not unlock the newer dialog");
  completions[1]!("current result");
  assert.equal(await second, "current result");
});

test("already-centered source dialogs keep viewport width and are not centered a second time", async () => {
  const row = " ".repeat(20) + "╭" + "─".repeat(150) + "╮";
  const ctx = { hasUI: true, mode: "tui", ui: {
    async custom(factory: any, options: any) {
      const child = factory({ terminal: { columns: 192, rows: 49 } }, {}, {}, () => {});
      assert.deepEqual(options.overlayOptions(), { width: "100%", maxHeight: "100%", row: 0, col: 0 });
      const lines = child.render(192);
      assert.equal(lines.length, 49);
      assert.equal(lines[Math.floor((Math.max(1, 49 - 2) - 1) / 2)], row + " ".repeat(192 - visibleWidth(row)));
      assert.equal(visibleWidth(row), 172);
    },
  } } as unknown as ExtensionContext;
  await createModalHost().open(ctx, () => ({ render: () => [row], invalidate() {} }), { fullWidth: true });
});

test("full canvas preserves every native anchor and translates mouse into the same inner rectangle", async () => {
  const cases = [
    ["top-left", 0, 0], ["top-center", 3, 0], ["top-right", 6, 0],
    ["left-center", 0, 1], ["center", 3, 1], ["right-center", 6, 1],
    ["bottom-left", 0, 5], ["bottom-center", 3, 5], ["bottom-right", 6, 5],
  ] as const;
  for (const [anchor, col, row] of cases) {
    let received: any;
    const component = { render: () => ["╭──╮", "╰──╯"], invalidate() {}, handleMouse(event: any) { received = event; return { handled: true }; } };
    const ctx = { hasUI: true, mode: "tui", ui: { async custom(factory: any) {
      const canvas = factory({ terminal: { columns: 10, rows: 7 } }, {}, {}, () => {});
      const lines = canvas.render(10);
      assert.equal(lines.length, 7);
      assert.ok(lines.every((line: string) => visibleWidth(line) === 10));
      assert.equal(lines.findIndex((line: string) => line.includes("╭")), row, anchor);
      assert.equal(lines[row].indexOf("╭"), col, anchor);
      assert.deepEqual(canvas.handleMouse({ x: col + 1, y: row, width: 10, height: 7 }), { handled: true });
      assert.deepEqual(received, { x: 1, y: 0, width: 10, height: 2 });
      assert.equal(canvas.handleMouse({ x: -1, y: row, width: 10, height: 7 }), undefined);
    } } } as unknown as ExtensionContext;
    await createModalHost().open(ctx, () => component, { anchor });
  }
});

test("oversized modal is clipped to viewport height without dropping a visible Unicode cursor marker", async () => {
  let event: any;
  const component = { render: () => Array.from({ length: 10 }, (_, i) => (i === 0 ? CURSOR_MARKER : "") + `${i} 界 é`), invalidate() {}, handleMouse(value: any) { event = value; return { handled: true }; } };
  const ctx = { hasUI: true, mode: "tui", ui: { async custom(factory: any) {
    const canvas = factory({ terminal: { columns: 20, rows: 3 } }, {}, {}, () => {});
    const rows = canvas.render(20);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((line: string) => visibleWidth(line) === 20));
    assert.ok(rows[0].includes(CURSOR_MARKER));
    canvas.handleMouse({ x: 7, y: 0, width: 20, height: 3 });
    assert.equal(event.height, 3);
    assert.equal(canvas.handleMouse({ x: 7, y: 3, width: 20, height: 3 }), undefined);
  } } } as unknown as ExtensionContext;
  await createModalHost().open(ctx, () => component, {});
});

test("real native TuiAltScreen: modal mask hides background and restores native focus without removing foreign overlays", async () => {
  let terminalInput: ((data: string) => void) | undefined;
  const terminal = {
    columns: 80,
    rows: 20,
    start(onInput: (data: string) => void) { terminalInput = onInput; },
    stop() {},
    write() {},
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
    clearProgress() {},
  };

  const tui = new TuiAltScreen(terminal as any, true, tmpdir());
  const doc = new Container();
  const transcriptText = new Text("NATIVE_TRANSCRIPT_LINE", 0, 0);
  doc.addChild(transcriptText);
  const savedDocChildren = [...doc.children];

  let nativeEditorKeys = "";
  const editor = {
    focused: false,
    render(width: number) { return ["NATIVE_DOCK_EDITOR".padEnd(width)]; },
    invalidate() {},
    handleInput(data: string) { nativeEditorKeys += data; },
  };

  const scroll = new ScrollView(doc, { primary: true, follow: "end", scrollbar: "hidden" });
  const root = new VStack([{ component: scroll, grow: 1, basis: 0 }, { component: editor, basis: 1, shrink: 0 }]);
  tui.setLayoutRoot(root);
  tui.setFocus(editor);

  const getCleanLines = () => {
    tui.renderNow(true);
    return tui.getScreenLines().map(stripTerminalSequences);
  };

  tui.start();
  try {
    const initialFrame = getCleanLines().join("\n");
    assert.ok(initialFrame.includes("NATIVE_TRANSCRIPT_LINE"), "Initial screen shows native transcript");
    assert.ok(initialFrame.includes("NATIVE_DOCK_EDITOR"), "Initial screen shows native editor");
    assert.equal(tui.getFocusedComponent(), editor);
    const foreignOverlay = tui.showOverlay(new Text("FOREIGN_OVERLAY", 0, 0), { width: 15, anchor: "top-right", nonCapturing: true });

    let modalDoneCallback: ((value?: any) => void) | undefined;
    let modalInputReceived = "";
    let modalFocused = false;

    const modalComponent = {
      get focused() { return modalFocused; },
      set focused(v: boolean) { modalFocused = v; },
      render(width: number) {
        return [
          "╭" + "─".repeat(20) + "╮",
          "│ " + (modalFocused ? CURSOR_MARKER : "") + "DIALOG CONTENT    │",
          "╰" + "─".repeat(20) + "╯",
        ];
      },
      handleInput(data: string) { modalInputReceived += data; },
      handleMouse() { return { handled: true }; },
      invalidate() {},
    };

    const host = createModalHost();
    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: {
        custom(factory: any, options: any) {
          return new Promise(resolve => {
            let overlayHandle: ReturnType<typeof tui.showOverlay> | undefined;
            const done = (value?: unknown) => { overlayHandle?.hide(); resolve(value); };
            modalDoneCallback = done;
            const comp = factory(tui, {}, {}, done);
            overlayHandle = tui.showOverlay(comp, options.overlayOptions());
          });
        },
      },
    } as unknown as ExtensionContext;

    const modalPromise = host.open(ctx, (_t, _th, _k, done) => {
      return modalComponent;
    }, {});

    // Render screen while modal overlay is open
    const modalFrameLines = getCleanLines();
    const modalFrame = modalFrameLines.join("\n");

    // 1. Verify canvas mask blanks background: native transcript and dock editor are NOT visible
    assert.ok(!modalFrame.includes("NATIVE_TRANSCRIPT_LINE"), "Native transcript must be completely masked outside dialog box");
    assert.ok(!modalFrame.includes("NATIVE_DOCK_EDITOR"), "Native dock editor must be completely masked outside dialog box");
    assert.ok(modalFrame.includes("DIALOG CONTENT"), "Modal dialog content is visible");
    assert.ok(modalFrame.includes("╭" + "─".repeat(20) + "╮"), "Dialog box border is visible");

    // 2. Verify all 20 rows are rendered and non-dialog rows are full width spaces
    assert.equal(modalFrameLines.length, 20);
    for (let r = 0; r < modalFrameLines.length; r++) {
      assert.equal(visibleWidth(modalFrameLines[r]!), 80, `Row ${r} must span full 80 columns`);
    }

    // 3. Underlying native roots/children unchanged
    assert.deepEqual(doc.children, savedDocChildren);
    assert.equal(doc.children[0], transcriptText);

    // 4. Focus is on modal component
    assert.equal(tui.getFocusedComponent() !== editor, true);
    assert.equal(modalFocused, true);
    terminalInput!("界");
    assert.equal(modalInputReceived, "界");
    assert.equal(nativeEditorKeys, "", "modal input does not leak to the editor");

    // 5. IME/cursor position is detected on dialog content row
    const cursorLineIdx = modalFrameLines.findIndex(l => l.includes("DIALOG CONTENT"));
    assert.ok(cursorLineIdx >= 0);
    // Dialog has height 3, centered in 20 rows with winH-2 = 18: topPad = floor((18-3)/2) = 7.
    // Dialog content is line 1 inside dialog -> row 8.
    assert.equal(cursorLineIdx, 8);

    // Close modal
    modalDoneCallback!("completed");
    await modalPromise;
    assert.equal(foreignOverlay.isHidden(), false, "closing OMT never removes an older foreign overlay");
    assert.ok(getCleanLines().join("\n").includes("FOREIGN_OVERLAY"));
    assert.equal(tui.getFocusedComponent(), editor, "native handle restores focus without manual setFocus");
    terminalInput!("x");
    assert.equal(nativeEditorKeys, "x");
    foreignOverlay.hide();

    // 6. Restoration: after closing modal, native transcript and dock editor are restored
    const restoredFrame = getCleanLines().join("\n");
    assert.ok(restoredFrame.includes("NATIVE_TRANSCRIPT_LINE"), "Native transcript restored after close");
    assert.ok(restoredFrame.includes("NATIVE_DOCK_EDITOR"), "Native editor restored after close");
    assert.equal(tui.getFocusedComponent(), editor, "Focus restored to editor");
  } finally {
    tui.stop();
  }
});

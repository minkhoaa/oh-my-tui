import test from "node:test";
import assert from "node:assert/strict";
import { initTheme, InteractiveMode, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { registerCommands } from "../extensions/omt/integration/commands.ts";
import { createModalHost } from "../extensions/omt/ui/modal.ts";
import { OmtSettingsHubComponent } from "../extensions/omt/features/omt-dialogs/settings-hub.ts";
import { signatureTheme } from "../extensions/omt/presets/omt-signature/rendering.ts";

function commandFixture(open: () => Promise<void>) {
  let handler: any;
  const notices: unknown[][] = [];
  registerCommands({ registerCommand(_name: string, options: any) { handler = options.handler; } } as any,
    {} as any, { openThemePicker: open } as any);
  return { run: (mode: string, args = "theme") => handler(args, {
    mode, hasUI: true, ui: { notify: (...args: unknown[]) => notices.push(args) },
  }), notices };
}

test("Theme TUI picker completion is silent, while RPC status and explicit errors remain visible", async () => {
  let close: () => void = () => {};
  let opened = 0;
  const { run, notices } = commandFixture(() => { opened++; return new Promise<void>(resolve => { close = resolve; }); });
  const pending = run("tui");
  assert.equal(opened, 1); assert.deepEqual(notices, []);
  close(); await pending;
  assert.deepEqual(notices, [], "closing Theme must not create an unsolicited status toast");
  await run("rpc");
  assert.equal(opened, 1); assert.match(String(notices.at(-1)?.[0]), /^OMT theme:/);
  await run("tui", "theme unknown-preset-for-test");
  assert.match(String(notices.at(-1)?.[0]), /Unknown theme:/);
});

test("Theme picker errors propagate instead of emitting a false completion toast", async () => {
  const { run, notices } = commandFixture(async () => { throw new Error("dialog failed"); });
  await assert.rejects(run("tui"), /dialog failed/);
  assert.deepEqual(notices, []);
});

test("tree bottom inset reserves source hint rows and remaps mouse against the same visible rectangle", async () => {
  for (const rows of [1, 2, 10, 49]) {
    let clicked = -1;
    const ctx = { hasUI: true, mode: "tui", ui: {
      async custom(factory: any) {
        const child = factory({ terminal: { rows, columns: 20 } }, {}, {}, () => {});
        const frame = child.render(20);
        assert.equal(frame.length, rows);
        const at = Math.max(0, rows - 3);
        assert.equal(frame[at].trim(), "PANEL");
        for (let y = at + 1; y < rows; y++) assert.equal(frame[y].trim(), "");
        child.handleMouse({ x: 9, y: at, width: 20, height: rows });
        assert.equal(clicked, 0);
        assert.equal(child.handleMouse({ x: 9, y: at + 1, width: 20, height: rows }), undefined);
      },
    } } as unknown as ExtensionContext;
    await createModalHost().open(ctx, () => ({ render: () => ["PANEL"], invalidate() {},
      handleMouse(event: any) { clicked = event.y; return { handled: true }; },
    }), { anchor: "bottom-center", bottomInset: 2 });
  }
});

test("terminal transparency is not marked as a painted surface, and section headers stay bold", () => {
  initTheme("dark");
  const theme = signatureTheme((InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme);
  const tui = { terminal: { columns: 192, rows: 49 }, requestRender() {} } as any;
  for (const currentBackground of ["transparent", "aura"]) {
    const hub = new OmtSettingsHubComponent(tui, theme, { matches: () => false } as any, () => {}, {} as any,
      { initialSection: "theme", currentBackground });
    const plain = hub.render(192).map(stripTerminalSequences);
    const transparent = plain.find(l => l.includes("transparent"))!.split("│").at(-2)!;
    assert.ok(!transparent.includes("✓"), transparent);
    if (currentBackground === "aura") assert.ok(plain.find(l => /\baura\b/.test(l))!.includes("✓"));
    assert.equal(hub.getCurrentBackground(), currentBackground, "appearance selection is not mutated for parity");
  }
  for (const initialSection of ["agent", "plugin"] as const) {
    const boldSpans: string[] = [];
    // Native bold can legitimately be disabled in a non-TTY test process.
    // Observe the semantic style request without changing the host Theme.
    const observedTheme = new Proxy(theme, { get(target, key) {
      if (key === "bold") return (text: string) => { boldSpans.push(stripTerminalSequences(text).trim()); return target.bold(text); };
      return Reflect.get(target, key, target);
    } });
    const hub = new OmtSettingsHubComponent(tui, observedTheme, { matches: () => false } as any, () => {}, {} as any, { initialSection });
    assert.ok(hub.render(192).some(l => stripTerminalSequences(l).includes("SECTIONS")));
    assert.ok(boldSpans.includes("SECTIONS"), "section header must request title weight, not muted body style");
  }
});

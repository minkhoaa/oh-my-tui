import test from "node:test";
import assert from "node:assert/strict";
import { AssistantMessageComponent, InteractiveMode, getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Text, stripTerminalSequences, visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { createAssistantPresentation } from "../extensions/omt/presets/shared/assistant.ts";
import { observeAssistantMessages } from "../extensions/omt/core/native-ui.ts";
import { setActiveTheme, resetActiveTheme } from "../extensions/omt/core/theme.ts";
import { assistantFixture } from "./assistant-fixture.ts";

function palette() { initTheme("dark"); return (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme; }
const text = (value: string) => ({ type: "text" as const, text: value });
const thinking = (value: string) => ({ type: "thinking" as const, thinking: value });
const plain = (rows: string[]) => rows.map(stripTerminalSequences);
const click = (x: number, y: number): TuiMouseEvent => ({ type: "click", button: "left", x, y } as TuiMouseEvent);

function setup(content: ReturnType<typeof text | typeof thinking>[], hidden = false, padding = 1) {
  const theme = palette(); setActiveTheme("omt-signature");
  const message = { ...assistantFixture(), content };
  const component = new AssistantMessageComponent(message, hidden, getMarkdownTheme(), "Reasoning", padding);
  let enabled = true;
  const original = component.render;
  const presentation = createAssistantPresentation(() => enabled, () => theme, original);
  component.render = presentation.render;
  return { component, message, presentation, original, disable() { enabled = false; } };
}

test("alternating thinking/commentary use one-cell inset gutters independently of native outputPad", () => {
  try {
    for (const padding of [0, 1, 4]) {
      const { component } = setup([thinking("Inspecting guidance"), text("Reading the module"), thinking("Reviewing architecture"), text("Here is the answer")], false, padding);
      for (const width of [80, 40, 80]) {
        const rows = plain(component.render(width));
        const expected = [["Inspecting guidance", "○"], ["Reading the module", "●"], ["Reviewing architecture", "○"], ["Here is the answer", "●"]];
        for (const [body, icon] of expected) {
          const row = rows.find(line => line.includes(body!)); assert.ok(row, body);
          assert.ok(row.trimStart().startsWith(icon + " "), `semantic gutter for ${body}: ${row}`);
        }
        for (const [body, icon] of expected) {
          const row = rows.find(line => line.includes(body!))!;
          assert.ok(row.startsWith(" " + icon + " " + body), row);
        }
        assert.ok(rows.every(row => visibleWidth(row) <= width));
      }
    }
  } finally { resetActiveTheme(); }
});

test("narrow Signature frames clamp excessive native padding without overflow or lost text", () => {
  try {
    const { component } = setup([thinking("think carefully"), text("wrap safely")], false, 50);
    for (const width of [10, 11, 20]) {
      const rows = plain(component.render(width));
      assert.ok(rows.every(row => visibleWidth(row) <= width), rows.join("\n"));
      const content = rows.join("").replace(/[\s●○]/g, "");
      assert.ok(content.includes("thinkcarefully") && content.includes("wrapsafely"), content);
    }
  } finally { resetActiveTheme(); }
});

test("collapsed runs do not double-label, literal hollow circles in prose are not treated as thinking, and streaming retains all runs", () => {
  try {
    const { component, message } = setup([thinking("first summary"), text("literal ○ is prose"), thinking("second summary"), text("final commentary")], true);
    component.updateContent(message, true);
    const stream = plain(component.render(90));
    assert.ok(stream.some(row => row.startsWith(" ○ ") && row.includes("first summary")));
    assert.ok(stream.some(row => row.startsWith(" ○ ") && row.includes("second summary")));
    assert.ok(stream.some(row => row.startsWith(" ● literal ○ is prose")));
    assert.ok(stream.some(row => row.startsWith(" ● final commentary")));
    assert.ok(!stream.some(row => /○\s+○|●\s+○\s+(?:first|second)/.test(row)));
    component.updateContent(message, false);
    assert.deepEqual(plain(component.render(90)), stream);
    assert.deepEqual((component as any).lastMessage, message);
  } finally { resetActiveTheme(); }
});

test("table-led later commentary keeps boxed alignment and diagnostic text remains native", () => {
  try {
    const { component } = setup([text("initial commentary"), thinking("check the table"), text("| A | B |\n| --- | --- |\n| one | two |")]);
    const rows = plain(component.render(60));
    const table = rows.filter(row => row.includes("│") || row.includes("┌") || row.includes("└") || row.includes("├"));
    assert.ok(table.length >= 3);
    assert.ok(table[0]!.startsWith(" ● "), table[0]);
    assert.ok(table.slice(1).every(row => row.startsWith("   ")), table.join("\n"));
    const failed = { ...assistantFixture(), content: [text("partial answer")], stopReason: "error" as const, errorMessage: "AUDIT_FAILURE" };
    component.updateContent(failed);
    const errorRow = plain(component.render(60)).find(row => row.includes("AUDIT_FAILURE"));
    assert.ok(errorRow?.includes("Error: AUDIT_FAILURE")); assert.ok(!errorRow?.includes("●"));
  } finally { resetActiveTheme(); }
});

test("native OSC zones, text, padding/theme caches, off mode and foreign container additions are preserved", () => {
  try {
    const { component, original, presentation, disable } = setup([thinking("reasoning"), text("**answer** with `code`")]);
    const children = (component as any).contentContainer.children.map((outer: any) => outer.child ?? outer);
    const before = children.map((child: any) => ({ padding: child.paddingX, theme: child.theme, text: child.text }));
    const native = original.call(component, 80);
    const styled = component.render(80);
    const zones = (rows: string[]) => rows.join("\n").match(/\x1b\]133;[ABC]\x07/g);
    assert.deepEqual(zones(styled), zones(native));
    children.forEach((child: any, index: number) => assert.deepEqual({ padding: child.paddingX, theme: child.theme, text: child.text }, before[index]));
    disable(); presentation.invalidate(); assert.deepEqual(component.render(80), original.call(component, 80));
    const another = setup([text("native plus foreign")]);
    another.component.addChild(new Text("FOREIGN_CONTENT", 0, 0));
    assert.deepEqual(another.component.render(80), another.original.call(another.component, 80));
    const unsupported = createAssistantPresentation(() => true, palette, () => ["UNSUPPORTED_PARENT"]);
    assert.deepEqual(unsupported.render.call({ contentContainer: { children: [] } } as any, 80), ["UNSUPPORTED_PARENT"]);
  } finally { resetActiveTheme(); }
});

test("native reasoning click hitboxes follow the actual rendered row/column after alternating blocks and resize", () => {
  const theme = palette(); setActiveTheme("omt-signature");
  const cleanup = observeAssistantMessages(() => true, () => theme); assert.ok(cleanup);
  try {
    const component = new AssistantMessageComponent({ ...assistantFixture(), content: [text("commentary"), thinking("long reasoning body that can be collapsed"), text("final reply")] }, false, getMarkdownTheme(), "Reasoning", 1);
    let rows = plain(component.render(60));
    let y = rows.findIndex(row => row.includes("long reasoning body")); assert.ok(y >= 0);
    assert.ok(component.handleMouse(click(59, y))?.handled, "right edge of expanded thinking maps back into the native MouseRegion");
    rows = plain(component.render(60)); y = rows.findIndex(row => row.includes("long reasoning body"));
    assert.ok(rows[y]!.startsWith(" ○ "));
    assert.ok(component.handleMouse(click(1, y))?.handled, "collapsed OMT reasoning icon retains native toggle");
    rows = plain(component.render(30)); y = rows.findIndex(row => row.includes("long reasoning"));
    assert.ok(component.handleMouse(click(29, y))?.handled, "resized expanded row maps back correctly");
  } finally { cleanup?.(); resetActiveTheme(); }
});

test("assistant mouse ownership yields to a foreign handler and cleanup leaves retained callbacks inert", () => {
  const theme = palette(); setActiveTheme("omt-signature");
  const proto = AssistantMessageComponent.prototype;
  const nativeRender = proto.render, nativeMouse = proto.handleMouse;
  const cleanup = observeAssistantMessages(() => true, () => theme); assert.ok(cleanup);
  const retained = proto.render;
  const foreign = () => undefined;
  try {
    const foreignInstance = new AssistantMessageComponent({ ...assistantFixture(), content: [text("instance-owned mouse")] });
    foreignInstance.handleMouse = foreign;
    assert.deepEqual(foreignInstance.render(60), nativeRender.call(foreignInstance, 60), "instance-owned mouse must keep its original geometry");
    proto.handleMouse = foreign;
    cleanup!(); assert.equal(proto.handleMouse, foreign);
    const component = new AssistantMessageComponent({ ...assistantFixture(), content: [text("answer")] });
    assert.deepEqual(retained.call(component, 60), nativeRender.call(component, 60));
  } finally {
    cleanup?.(); proto.render = nativeRender; delete (proto as any).handleMouse;
    assert.equal(proto.handleMouse, nativeMouse); resetActiveTheme();
  }
});

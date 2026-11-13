import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessageComponent, InteractiveMode, getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";
import { createAssistantPresentation } from "../extensions/omt/presets/shared/assistant.ts";
import { assistantFixture, type AssistantFixture } from "./assistant-fixture.ts";

function theme() {
  initTheme("dark");
  return (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme;
}

test("foreign collapsed reasoning labels remain owned and do not reveal preview content", () => {
  setActiveTheme("omt-signature");
  try {
    const palette = theme();
    const message: AssistantFixture = { ...assistantFixture(), content: [
      { type: "thinking", thinking: "private reasoning content" },
      { type: "text", text: "public answer" },
    ] };
    const component = new AssistantMessageComponent(message, true, getMarkdownTheme(), "FOREIGN REASONING LABEL", 0);
    const presentation = createAssistantPresentation(() => true, () => palette, component.render);
    component.render = presentation.render;
    const output = component.render(80).map(stripTerminalSequences).join("\n");
    assert.ok(output.includes("FOREIGN REASONING LABEL"));
    assert.ok(!output.includes("private reasoning content"));
    assert.ok(output.includes("public answer"));
    assert.deepEqual((component as any).lastMessage, message);
  } finally { resetActiveTheme(); }
});

test("pre-render failures restore all temporary Markdown themes, padding and thinking labels", () => {
  setActiveTheme("omt-signature");
  try {
    theme();
    const message: AssistantFixture = { ...assistantFixture(), content: [
      { type: "text", text: "prose before reasoning" },
      { type: "thinking", thinking: "reasoning after prose" },
      { type: "text", text: "final answer" },
    ] };
    const component = new AssistantMessageComponent(message, true, getMarkdownTheme(), "Reasoning", 1);
    const children = (component as any).contentContainer.children.map((outer: any) => outer.child ?? outer);
    const before = children.map((child: any) => ({ paddingX: child.paddingX, theme: child.theme, text: child.text }));
    const presentation = createAssistantPresentation(() => true, () => { throw new Error("palette unavailable"); }, component.render);
    component.render = presentation.render;
    assert.throws(() => component.render(80), /palette unavailable/);
    children.forEach((child: any, index: number) => {
      assert.equal(child.paddingX, before[index].paddingX);
      assert.equal(child.theme, before[index].theme);
      assert.equal(child.text, before[index].text);
    });
    assert.deepEqual((component as any).lastMessage, message);
  } finally { resetActiveTheme(); }
});

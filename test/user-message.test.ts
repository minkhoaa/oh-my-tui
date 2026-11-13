import assert from "node:assert/strict";
import { test } from "node:test";
import { getMarkdownTheme, initTheme, SessionManager, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { setCodexPalette } from "../extensions/omt/presets/codex-inspired/rendering.ts";
import { createUserMessageControl, OMT_USER_MESSAGE_OWNER } from "../extensions/omt/features/user-message/index.ts";
import { setActiveTheme, resetActiveTheme } from "../extensions/omt/core/theme.ts";

const renderer = () => createUserMessageControl();

test("native user rendering keeps Markdown, Unicode, theme and compact row count", () => {
  const examples = ["hello\nsecond line", "# Heading\n\n**bold** and *italic*\n\n- item one\n- item two", "```ts\nconst x = '你好';\n```", "👩🏽‍💻 你好 🇻🇳 e\u0301 ".repeat(25), "[image #1] a pasted attachment"];
  for (const palette of ["dark", "light", "system"]) {
    initTheme(palette);
    setActiveTheme("codex-inspired");
    const control = renderer();
    try {
      for (const text of examples) {
        const message = new UserMessageComponent(text, getMarkdownTheme());
        for (const width of [10, 20, 40, 80, 120]) {
          control.off();
          const native = message.render(width);
          control.on();
          const clean = message.render(width);
          assert.ok(clean.every((line) => visibleWidth(line) === width));
          assert.ok(clean[0]!.includes("\x1b]133;A\x07"));
          assert.ok(clean.at(-1)!.includes("\x1b]133;B\x07\x1b]133;C\x07"));
          assert.ok(!clean.map(stripTerminalSequences).some((line) => /[─│┌┐└┘╭╮╰╯]/.test(line)));
          control.off();
          assert.deepEqual(message.render(width), native, "off restores cached messages at the same width");
        }
      }
    } finally { control.cleanup?.(); resetActiveTheme(); }
  }
});

test("one native row of vertical padding, shared content column and larger Pi outputPad", () => {
  initTheme("dark");
  setActiveTheme("codex-inspired");
  setCodexPalette({ background: { r: 0, g: 0, b: 0 } });
  const control = renderer();
  try {
    for (const padding of [0, 1, 3, 5]) {
      const message = new UserMessageComponent("hello", getMarkdownTheme(), padding);
      const lines = message.render(80).map(stripTerminalSequences);
      assert.equal(lines.length, 3, "no Markdown-transform padding layered over native padding");
      assert.equal(lines[1]!.indexOf("hello"), Math.max(2, padding));
      assert.ok(message.render(80).every((line) => line.includes("\x1b[48;2;")));
      control.off();
      assert.equal(message.render(80).map(stripTerminalSequences)[1]!.indexOf("hello"), padding);
      control.on();
    }
  } finally { control.cleanup?.(); setCodexPalette({}); resetActiveTheme(); }
});

test("narrow widths safely yield to native padding", () => {
  const control = renderer();
  try {
    const message = new UserMessageComponent("hi");
    for (const width of [3, 6, 8, 9]) {
      const clean = message.render(width);
      control.off();
      assert.deepEqual(message.render(width), clean);
      control.on();
    }
  } finally { control.cleanup?.(); }
});

test("cleanup restores original render, child padding and existing caches", () => {
  initTheme("dark");
  const original = UserMessageComponent.prototype.render;
  const message = new UserMessageComponent("cached");
  const native = message.render(80);
  const control = renderer();
  assert.notDeepEqual(message.render(80), native);
  control.cleanup?.();
  assert.equal(UserMessageComponent.prototype.render, original);
  assert.deepEqual(message.render(80), native);
  assert.equal((UserMessageComponent.prototype as unknown as Record<symbol, unknown>)[OMT_USER_MESSAGE_OWNER], undefined);
});

test("foreign overrides and duplicate OMT instances are left alone", () => {
  const target = UserMessageComponent.prototype;
  const original = target.render;
  target.render = function foreignRender() { return ["foreign"]; };
  try { assert.match(renderer().on(), /inactive/); }
  finally { target.render = original; }
  target.render = function render(width) { return original.call(this, width); };
  try { assert.match(renderer().on(), /inactive/, "same-named wrappers must also yield"); }
  finally { target.render = original; }
  const first = renderer();
  assert.match(renderer().on(), /inactive/);
  const wrapper = target.render;
  target.render = function laterRender(width) { return wrapper.call(this, width); };
  const later = target.render;
  first.cleanup?.();
  assert.equal(target.render, later, "cleanup must not overwrite a later wrapper");
  target.render = original;
});

test("toggle on and off immediately invalidates cached render", () => {
  initTheme("dark");
  const control = renderer();
  try {
    const message = new UserMessageComponent("test-cache");
    const clean = message.render(80);
    control.off();
    const native = message.render(80);
    assert.notDeepEqual(clean, native);
    control.on();
    const cleanAgain = message.render(80);
    assert.deepEqual(cleanAgain, clean);
  } finally {
    control.cleanup?.();
  }
});

test("presentation leaves native session text and image blocks unchanged", () => {
  const control = renderer();
  try {
    const session = SessionManager.inMemory(process.cwd());
    const message = { role: "user" as const, content: [{ type: "text" as const, text: "**Markdown** 👩🏽‍💻 [image #1]" }, { type: "image" as const, data: "AA==", mimeType: "image/png" }], timestamp: Date.now() };
    session.appendMessage(message);
    const snapshot = structuredClone(session.buildSessionProjection().messages);
    new UserMessageComponent(message.content[0]!.text!).render(80);
    assert.deepEqual(session.buildSessionProjection().messages, snapshot);
  } finally { control.cleanup?.(); }
});

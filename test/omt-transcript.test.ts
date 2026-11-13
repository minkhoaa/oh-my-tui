import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, InteractiveMode, Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createSignatureToolRenderer } from "../extensions/omt/presets/omt-signature/tools.ts";
import { setActiveTheme, resetActiveTheme } from "../extensions/omt/core/theme.ts";
import { signatureAssistant } from "../extensions/omt/presets/omt-signature/assistant.ts";
import { signatureUserMessage } from "../extensions/omt/presets/omt-signature/user-message.ts";

const proto = InteractiveMode.prototype as unknown as { createExtensionUIContext(this: unknown): { theme: Theme } };
function theme(): Theme {
  initTheme("dark");
  return proto.createExtensionUIContext.call({}).theme;
}
function context(overrides: Record<string, unknown> = {}): any {
  return {
    args: {}, state: {}, cwd: "/workspace/project", outputPad: 0,
    isPartial: false, isError: false, expanded: false,
    keyText: () => "ctrl+g",
    keyHint: (_id: string, description: string) => `ctrl+g ${description}`,
    ...overrides,
  };
}
function plain(rows: string[]): string[] { return rows.map(stripTerminalSequences); }

test("OMT transcript renderer keeps expanded output complete and collapsed rows header-only", () => {
  const active = theme();
  setActiveTheme("omt-signature");
  try {
    const renderer = createSignatureToolRenderer("bash");
    const output = Array.from({ length: 68 }, (_, i) => `output row ${i + 1}`).join("\n");
    const result = { content: [{ type: "text", text: output }], details: {} } as any;
    const collapsed = renderer.renderResult!(result, { expanded: false, isPartial: false }, active, context());
    assert.deepEqual(collapsed.render(80), []);
    const expanded = renderer.renderResult!(result, { expanded: true, isPartial: false }, active, context({ expanded: true }));
    const rows = plain(expanded.render(80));
    assert.ok(rows.some((row) => row.includes("output row 1")));
    assert.ok(rows.some((row) => row.includes("output row 68")));
    assert.equal(rows.length, 68);
  } finally { resetActiveTheme(); }
});

test("OMT shell output only syntax-highlights code-shaped results and leaves plain output unstyled", () => {
  const active = theme();
  setActiveTheme("omt-signature");
  try {
    const renderer = createSignatureToolRenderer("bash");
    const render = (text: string) => renderer.renderResult!(
      { content: [{ type: "text", text }], details: {} } as any,
      { expanded: true, isPartial: false }, active, context({ expanded: true }),
    ).render(80);
    const newline = String.fromCharCode(10);
    const ansi = String.fromCharCode(27) + "[38;";
    const prose = render(["first ordinary line", "second ordinary line"].join(newline));
    const colorCount = (rows: string[]) => rows.reduce((count, row) => count + row.split(ansi).length - 1, 0);
    assert.equal(colorCount(prose), prose.length * 2, "ordinary output keeps a single muted body color plus the gutter");
    const json = render(["{", '  "ok": true,', '  "count": 3', "}"].join(newline));
    assert.ok(colorCount(json) > json.length, "recognized JSON output uses additional syntax colors");
    assert.ok(plain(json).some(row => row.includes('"ok"')));
  } finally { resetActiveTheme(); }
});

test("OMT transcript renderer handles write line endings and multi-edit schemas without a line cap", () => {
  const active = theme();
  setActiveTheme("omt-signature");
  try {
    const write = createSignatureToolRenderer("write");
    const content = Array.from({ length: 63 }, (_, i) => `const value${i} = "雪";`).join("\r\n") + "\r\n";
    const written = write.renderResult!(
      { content: [], details: {} } as any,
      { expanded: true, isPartial: false }, active,
      context({ args: { path: "src/file.ts", content } }),
    );
    const writeRows = plain(written.render(52));
    assert.ok(writeRows[0]?.includes("Wrote 63 lines"));
    assert.ok(writeRows.some((row) => row.includes("63 +const value62")));
    for (const row of written.render(24)) assert.ok(visibleWidth(row) <= 24);

    const edit = createSignatureToolRenderer("edit");
    const edited = edit.renderResult!(
      { content: [], details: {} } as any,
      { expanded: true, isPartial: false }, active,
      context({ args: { path: "src/file.ts", edits: [
        { oldText: "old one\nold two\n", newText: "new one\n" },
        { oldText: "second old", newText: "second new" },
      ] } }),
    );
    const editRows = plain(edited.render(80));
    assert.ok(editRows[0]?.includes("(+2 -3)"));
    assert.ok(editRows.some((row) => row.includes("- old one")));
    assert.ok(editRows.some((row) => row.includes("+ second new")));
  } finally { resetActiveTheme(); }
});

test("OMT transcript renderer preserves failed and partial states and wraps expanded headers", () => {
  const active = theme();
  setActiveTheme("omt-signature");
  try {
    const edit = createSignatureToolRenderer("edit");
    const partial = edit.renderResult!(
      { content: [{ type: "text", text: "still editing" }], details: {} } as any,
      { expanded: true, isPartial: true }, active, context({ isPartial: true }),
    );
    assert.ok(plain(partial.render(40)).some((row) => row.includes("Running")));

    const failed = edit.renderResult!(
      { content: [{ type: "text", text: "match failed" }], details: { error: "could not apply edit" } } as any,
      { expanded: false, isPartial: false }, active, context({ isError: true }),
    );
    assert.deepEqual(failed.render(50), [], "collapsed failures are header-state only, matching the target");
    const openedFailure = edit.renderResult!(
      { content: [{ type: "text", text: "match failed" }], details: { error: "could not apply edit" } } as any,
      { expanded: true, isPartial: false }, active, context({ isError: true, expanded: true }),
    );
    const failureRows = plain(openedFailure.render(50));
    assert.ok(failureRows.some(row => row.includes("could not apply edit")));
    assert.ok(failureRows.some(row => row.includes("match failed")), "expansion retains both structured error and original output");

    const call = edit.renderCall!({ path: "src/非常に長い名前のファイル.ts" }, active,
      context({ expanded: true, outputPad: 1 }));
    const rows = call.render(22);
    assert.ok(rows.length > 1, "expanded call args wrap across rows");
    for (const row of rows) assert.ok(visibleWidth(row) <= 22);
  } finally { resetActiveTheme(); }
});

test("OMT transcript renderer produces unframed compact header with a one-cell inset regardless of outputPad", () => {
  const active = theme();
  setActiveTheme("omt-signature");
  try {
    const renderer = createSignatureToolRenderer("read");
    // Signature uses one inset cell regardless of outputPad, shared by all gutters.
    const header = renderer.renderCall!({ path: "src/a.ts" }, active, context({ outputPad: 3 }));
    const line = header.render(60)[0]!;
    assert.ok(stripTerminalSequences(line).includes("Read(src/a.ts)"), "collapsed header displays ● Read(src/a.ts)");
    assert.ok(!stripTerminalSequences(line).includes("to expand"), "collapsed header has no expand hint label");
    assert.ok(visibleWidth(line) <= 60);
    assert.ok(stripTerminalSequences(line).startsWith(" ● "), "Signature tool header has exactly one inset cell, independent of outputPad");

    const output = renderer.renderResult!(
      { content: [{ type: "text", text: "一二三四五六七八九十" }], details: {} } as any,
      { expanded: true, isPartial: false }, active, context({ outputPad: 2 }),
    );
    for (const row of output.render(18)) assert.ok(visibleWidth(row) <= 18);
  } finally { resetActiveTheme(); }
});

test("OMT transcript gutters preserve native message text and align boxed content", () => {
  const active = theme();
  setActiveTheme("omt-signature");
  try {
    const assistant = signatureAssistant(["| name | value |", "| --- | --- |", "| 雪 | 1 |"], {}, active, 40);
    const prose = signatureAssistant(["hello", "world"], {}, active, 40);
    const indented = signatureAssistant(["```ts", "  const value = 1;", "```"], {}, active, 40);
    assert.ok(stripTerminalSequences(assistant[0]!).includes("● | name"));
    assert.ok(stripTerminalSequences(assistant[1]!).startsWith("  |"));
    assert.equal(stripTerminalSequences(prose[1]!), "world");
    assert.equal(stripTerminalSequences(indented[1]!), "    const value = 1;", "boxed gutter preserves source indentation");

    const user = signatureUserMessage(50, 1, active);
    const rows = user.decorate?.(["", "hello 雪", ""]);
    assert.ok(rows?.[0] && stripTerminalSequences(rows[0]).includes("● ╭"));
    for (const row of rows ?? []) assert.ok(visibleWidth(row) <= 50);
  } finally { resetActiveTheme(); }
});

test("expanded long output preserves every character, whitespace boundary and Unicode grapheme", () => {
  const active = theme();
  setActiveTheme("omt-signature");
  try {
    const renderer = createSignatureToolRenderer("bash");
    const payload = "  begin   " + "界é👩🏽‍💻".repeat(18) + "   " + "x".repeat(110) + " END";
    for (const width of [12, 24, 40, 80]) {
      // One inset cell plus the four-cell result gutter.
      const component = renderer.renderResult!({ content: [{ type: "text", text: payload }], details: {} } as any,
        { expanded: true, isPartial: false }, active, context({ outputPad: 1 }));
      const rows = component.render(width);
      assert.ok(rows.every(row => visibleWidth(row) <= width));
      const reconstructed = plain(rows).map(row => row.slice(5)).join("");
      assert.equal(reconstructed, payload, `lost output at ${width} columns`);
      assert.ok(!reconstructed.includes("…"));
    }
    const ansiPayload = `\x1b[31m${"color_界_".repeat(20)}END\x1b[0m`;
    const colored = renderer.renderResult!({ content: [{ type: "text", text: ansiPayload }], details: {} } as any,
      { expanded: true, isPartial: false }, active, context());
    assert.equal(plain(colored.render(22)).map(row => row.slice(5)).join(""), stripTerminalSequences(ansiPayload));
    const tiny = renderer.renderResult!({ content: [{ type: "text", text: "界" }], details: {} } as any,
      { expanded: true, isPartial: false }, active, context());
    const tinyRows = tiny.render(1);
    assert.ok(tinyRows.every(row => visibleWidth(row) <= 1));
    assert.equal(plain(tinyRows).join(""), "\\u{754c}", "an unrenderable wide glyph is escaped, not dropped");
  } finally { resetActiveTheme(); }
});

test("expanded diff and write continuations retain tail content and full-row diff styling", () => {
  const active = theme();
  setActiveTheme("omt-signature");
  try {
    const payload = "ABC界é".repeat(30) + "TAIL_SENTINEL";
    for (const name of ["edit", "write"]) {
      const renderer = createSignatureToolRenderer(name);
      // Expanded output shares the one-cell inset of the call header.
      const component = renderer.renderResult!({ content: [], details: name === "edit" ? { diff: `+${payload}` } : {} } as any,
        { expanded: true, isPartial: false }, active, context({ args: { path: "f", content: payload }, outputPad: 2 }));
      const rows = component.render(80);
      // Strip the inset plus the four-cell gutter.
      const body = plain(rows.slice(1)).map(row => row.slice(5).trimEnd()).join("");
      assert.equal(body, name === "edit" ? `+${payload}` : `   1 +${payload}`);
      assert.ok(rows.slice(1).every(row => /\x1b\[48;/.test(row)), "every added-line continuation keeps its fill");
      for (const width of [8, 18, 36]) {
        const narrow = component.render(width);
        assert.ok(narrow.every(row => visibleWidth(row) <= width));
        // Chrome contracts only on tiny terminals.
        const pad = Math.min(1, Math.max(0, Math.floor((width - 6) / 2)));
        const gutter = Math.min(4, Math.max(0, width - pad * 2 - 2));
        const reconstructed = plain(narrow).map(row => row.slice(pad + gutter).trimEnd()).join("");
        assert.ok(reconstructed.includes(payload), `lost diff/write content at ${width} columns`);
      }
    }
  } finally { resetActiveTheme(); }
});

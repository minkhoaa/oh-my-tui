import assert from "node:assert/strict";
import { test } from "node:test";
import { InteractiveMode, initTheme } from "@earendil-works/pi-coding-agent";
import type { ToolRenderContext } from "../extensions/omt/presets/shared/tool-helpers.ts";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createRailToolRenderer } from "../extensions/omt/presets/omt-rail/tools.ts";
import { resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";

function context(args: Record<string, unknown>): ToolRenderContext {
  return { args, state: {}, cwd: "/tmp/work", outputPad: 1, argsComplete: true, executionStarted: true,
    toolCallId: "fixture", lastComponent: undefined, showImages: false, durationMs: 1,
    isPartial: false, isError: false, expanded: false, keyText: () => "ctrl+o", keyHint: () => "ctrl+o", invalidate() {} } as ToolRenderContext;
}

test("Rail fixed icon sibling matches the real pinned 40-column PTY continuation", (t) => {
  initTheme("dark"); setActiveTheme("rail"); t.after(resetActiveTheme);
  const theme = (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme;
  const renderer = createRailToolRenderer("read");
  const args = { path: "nested/long-directory/another-directory/hello.ts" };
  const row = renderer.renderCall!(args, theme, context(args));
  assert.deepEqual(row.render(40).map(stripTerminalSequences), [
    "     → Read nested/long-directory/", "       another-directory/hello.ts",
  ]);
  for (const width of [20, 40, 80, 120]) {
    const rows = row.render(width).map(stripTerminalSequences);
    assert.ok(rows.every((line) => visibleWidth(line) <= width));
    assert.ok(rows.slice(1).every((line) => line.startsWith("       ")));
    assert.equal(rows.join("").replace(/\s|→/g, ""), "Read" + args.path);
  }
});

test("Rail line_number gutter stays outside wrapped code; all content and trailing rows survive", (t) => {
  initTheme("dark"); setActiveTheme("rail"); t.after(resetActiveTheme);
  const theme = (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme;
  const renderer = createRailToolRenderer("write");
  const args = { path: "new.ts", content: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ你好\n" };
  const result = renderer.renderResult!({ content: [{ type: "text", text: "Written" }], details: undefined }, { expanded: true, isPartial: false }, theme, context(args));
  const rows = result.render(40).map(stripTerminalSequences);
  assert.ok(rows.some((row) => row.startsWith("  ┃   1 abc")));
  const index = rows.findIndex((row) => row.includes(" 1 abc"));
  assert.ok(rows[index + 1]!.startsWith("  ┃     "), "continuation reserves the same three cells as the number gutter");
  assert.ok(rows.some((row) => /┃   2\s*$/.test(row)), "terminal newline is a numbered code row");
  for (const width of [20, 40, 80, 120]) assert.ok(result.render(width).every((line) => visibleWidth(line) <= width));
});

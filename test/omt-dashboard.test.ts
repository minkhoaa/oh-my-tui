import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSidebarState, renderSidebar } from "../extensions/omt/features/sidebar/model.ts";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

test("dashboard extraction follows active branch and matches parallel tool results by call id", () => {
  const ctx = {
    cwd: "/work",
    model: { id: "m1", name: "Model", provider: "provider", contextWindow: 1000 },
    thinkingLevel: "off",
    isIdle: () => true,
    sessionManager: {
      getBranch: () => [
        { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "a", name: "read" }, { type: "toolCall", id: "b", name: "bash" }] } },
        { type: "message", message: { role: "toolResult", toolCallId: "b", isError: true } },
        { type: "message", message: { role: "toolResult", toolCallId: "a" } },
      ],
    },
    getContextUsage: () => ({ tokens: 0, contextWindow: 1000, percent: 0 }),
  } as any;
  const state = extractSidebarState(ctx, { todos: [], lsp: [], skills: [{ label: "loaded" }], mcp: [], plugins: [], subagents: [] });
  assert.deepEqual(state.tools?.map(({ name, status }) => [name, status]), [["read", "done"], ["bash", "error"]]);
  assert.equal(state.context?.tokens, 0);
  assert.equal(state.model?.label, "provider/Model");
  assert.deepEqual(state.todos, []);
  assert.deepEqual(state.skills, [{ label: "loaded" }]);
});

test("dashboard renders supplied width, unknown sections, and full frame", () => {
  const rows = renderSidebar({ todos: undefined, lsp: [], skills: [], mcp: [], plugins: [], subagents: [] }, 18);
  assert.ok(rows.every((row) => visibleWidth(stripTerminalSequences(row)) === 18));
  assert.equal(rows[0]?.startsWith("╭"), true);
  assert.equal(rows.at(-1)?.startsWith("╰"), true);
  assert.ok(rows.some((row) => stripTerminalSequences(row).includes("unavailable")));
});

import test from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import {
  signatureAssistant,
} from "../extensions/omt/presets/omt-signature/assistant.ts";
import {
  formatSettledFoot,
  hasTurnCompletionMetadata,
  resolveTurnMetadata,
  setTurnMetadataResolver,
} from "../extensions/omt/presets/omt-signature/message-model.ts";
import {
  renderSidebar as renderSidebarModel,
} from "../extensions/omt/features/sidebar/model.ts";
import {
  renderSidebar as renderSidebarSidepanels,
  renderRecentSection,
  renderLspSection,
} from "../extensions/omt/features/sidebar/sidepanels.ts";

function plain(lines: string[]): string[] {
  return lines.map((l) => stripTerminalSequences(l));
}

const mockTheme: any = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  dim: (text: string) => text,
  italic: (text: string) => text,
  style: (text: string) => text,
};

// =============================================================================
// 1. Assistant Settled Foot Badge (Historical vs Live Turn Completion)
// =============================================================================

test("historical assistant message with only model (resumed session) does not emit badge", () => {
  // A resumed session assistant message has only model information, no turn-completion metadata.
  // Matching OMT src/app/specification (stampTurnFoot exits if turnStart zero).
  const historicalHost = {
    isStreaming: false,
    hasToolCalls: false,
    lastMessage: { role: "assistant", content: [{ type: "text", text: "hello" }], model: "fake-model" },
  };

  const rendered = signatureAssistant(["hello"], historicalHost as any, mockTheme, 80);
  const plainText = plain(rendered);

  // Must not emit any footer badge (no "▣" or "fake-model")
  assert.ok(!plainText.some((line) => line.includes("▣")));
  assert.ok(!plainText.some((line) => line.includes("fake-model")));
  assert.equal(plainText.length, 1);
  assert.equal(plainText[0], "● hello");
});

test("settled turn with genuine turn-completion metadata emits opencode-style badge", () => {
  const settledHost = {
    isStreaming: false,
    hasToolCalls: false,
    lastMessage: { role: "assistant", model: "claude-3-5-sonnet" },
  };

  const metadata = {
    model: "claude-3-5-sonnet",
    thinkingLevel: "high",
    durationMs: 4200,
    settledAt: new Date("2026-11-12T14:30:00Z"),
  };

  const rendered = signatureAssistant(["hello"], settledHost as any, mockTheme, 80, { metadata });
  const plainText = plain(rendered);

  assert.ok(plainText.some((line) => line.includes("▣")));
  const footLine = plainText.find((line) => line.includes("▣"))!;
  assert.ok(footLine.startsWith("  ▣ "));
  assert.ok(footLine.includes("claude-3-5-sonnet"));
  assert.ok(footLine.includes("high"));
  assert.ok(footLine.includes("4s"));
  assert.ok(footLine.includes("done "));
});

test("hasTurnCompletionMetadata correctly gates turn-completion indicators", () => {
  // Model or thinkingLevel alone is NOT turn completion metadata
  assert.equal(hasTurnCompletionMetadata(undefined), false);
  assert.equal(hasTurnCompletionMetadata({}), false);
  assert.equal(hasTurnCompletionMetadata({ model: "fake-model" }), false);
  assert.equal(hasTurnCompletionMetadata({ model: "fake-model", thinkingLevel: "high" }), false);

  // Duration, settledAt, or pre-assembled foot ARE turn completion metadata
  assert.equal(hasTurnCompletionMetadata({ durationMs: 500 }), true);
  assert.equal(hasTurnCompletionMetadata({ settledAt: Date.now() }), true);
  assert.equal(hasTurnCompletionMetadata({ foot: "custom · foot" }), true);
  assert.equal(hasTurnCompletionMetadata({ model: "gpt-4o", durationMs: 1200 }), true);
});

test("formatSettledFoot returns empty string without turn completion metadata", () => {
  assert.equal(formatSettledFoot(undefined), "");
  assert.equal(formatSettledFoot({}), "");
  assert.equal(formatSettledFoot({ model: "fake-model" }), "");
  assert.equal(formatSettledFoot({ model: "fake-model", thinkingLevel: "high" }), "");

  // With turn completion metadata:
  assert.equal(formatSettledFoot({ model: "fake-model", durationMs: 400 }), "fake-model · 400ms");
});

test("resolveTurnMetadata ignores host or message with only model property", () => {
  try {
    const historicalMsg = { role: "assistant", model: "fake-model" };
    assert.equal(resolveTurnMetadata(historicalMsg), undefined);

    const historicalHost = { lastMessage: historicalMsg, model: "fake-model" };
    assert.equal(resolveTurnMetadata(historicalHost), undefined);

    // Live metadata from resolver is honored
    setTurnMetadataResolver((target: any) => {
      if (target?.model === "live-model") {
        return { model: "live-model", durationMs: 1500, settledAt: Date.now() };
      }
      return undefined;
    });

    const liveMsg = { role: "assistant", model: "live-model" };
    const resolved = resolveTurnMetadata(liveMsg);
    assert.ok(resolved);
    assert.equal(resolved?.model, "live-model");
    assert.equal(resolved?.durationMs, 1500);
  } finally {
    setTurnMetadataResolver(undefined);
  }
});

test("invalid completion timestamps fail closed without throwing", () => {
  for (const settledAt of [null, "not-a-date", {}, [], Number.NaN, Infinity, new Date("invalid")]) {
    const metadata = { model: "fixture", settledAt } as any;
    assert.equal(hasTurnCompletionMetadata(metadata), false);
    assert.equal(formatSettledFoot(metadata), "");
    assert.equal(resolveTurnMetadata({ turnMetadata: metadata }), undefined);
    assert.doesNotThrow(() => formatSettledFoot({ ...metadata, durationMs: 100 }));
  }
});

test("partial presentation metadata retains genuinely observed completion fields", () => {
  setTurnMetadataResolver(() => ({ model: "observed", durationMs: 1500, settledAt: 123456789 }));
  try {
    const host = { isStreaming: false, hasToolCalls: false, lastMessage: { model: "native-model" } };
    const rendered = plain(signatureAssistant(["hello"], host as any, mockTheme, 80, { metadata: { model: "display-name" } }));
    const foot = rendered.find(line => line.includes("▣"));
    assert.ok(foot?.includes("display-name · 2s · done "), "a model-label override must not drop the real observed completion");
  } finally { setTurnMetadataResolver(undefined); }
});

test("streaming and intermediate tool calls suppress footer even with metadata", () => {
  const metadata = { model: "claude-3-5", durationMs: 2000, settledAt: Date.now() };

  // Streaming suppresses footer
  const streamingHost = { isStreaming: true, hasToolCalls: false, lastMessage: { model: "claude-3-5" } };
  const streamingLines = signatureAssistant(["streaming text"], streamingHost as any, mockTheme, 80, { metadata });
  assert.ok(!plain(streamingLines).some((line) => line.includes("▣")));

  // Tool calls suppress footer
  const toolHost = { isStreaming: false, hasToolCalls: true, lastMessage: { model: "claude-3-5" } };
  const toolLines = signatureAssistant(["tool call text"], toolHost as any, mockTheme, 80, { metadata });
  assert.ok(!plain(toolLines).some((line) => line.includes("▣")));
});

// =============================================================================
// 2. Sidebar Details (Empty-Context 'left —', Recent Hint, LSP Padding)
// =============================================================================

test("sidebar empty-context renders 'left —' when context.percent is zero or unset", () => {
  // OMT src/app/specification: left := "—"; if m.Stats.ContextPct > 0 { left = fmt.Sprintf("%.0f%%", 100-m.Stats.ContextPct) }
  const stateEmptyZero = {
    stats: { inTokens: 0, outTokens: 0, totalTokens: 0, userMessages: 0, assistantMessages: 0 },
    context: { percent: 0 },
  };

  const modelLinesZero = renderSidebarModel(stateEmptyZero as any, 34, mockTheme);
  const textModelZero = plain(modelLinesZero).join("\n");
  assert.ok(textModelZero.includes("left —"), "model.ts must render 'left —' when ContextPct is 0");
  assert.ok(!textModelZero.includes("left 100%"), "model.ts must not render 'left 100%' for empty context");

  const sidepanelsLinesZero = renderSidebarSidepanels(stateEmptyZero as any, 34, mockTheme);
  const textSidepanelsZero = plain(sidepanelsLinesZero).join("\n");
  assert.ok(textSidepanelsZero.includes("left —"), "sidepanels.ts must render 'left —' when ContextPct is 0");
  assert.ok(!textSidepanelsZero.includes("left 100%"), "sidepanels.ts must not render 'left 100%' for empty context");

  // Non-empty context (e.g. 25% used) correctly renders "left 75%"
  const stateActive = {
    stats: { inTokens: 1000, outTokens: 200, totalTokens: 1200, userMessages: 1, assistantMessages: 1 },
    context: { percent: 25 },
  };
  const activeModel = plain(renderSidebarModel(stateActive as any, 34, mockTheme)).join("\n");
  assert.ok(activeModel.includes("left 75%"), "model.ts must render 'left 75%' for 25% context usage");
  const activeSidepanels = plain(renderSidebarSidepanels(stateActive as any, 34, mockTheme)).join("\n");
  assert.ok(activeSidepanels.includes("left 75%"), "sidepanels.ts must render 'left 75%' for 25% context usage");
});

test("sidebar recent-model hint shows 'click to switch · ^↑↓ scroll' only when operations are wired", () => {
  const state = {
    recentModels: [
      { id: "claude-3-5", label: "Claude 3.5 Sonnet", isCurrent: true },
      { id: "gpt-4o", label: "GPT-4o", isCurrent: false },
    ],
  };

  // 1. Operations wired: onSelectModel provided AND interactive: true
  const wiredSidepanels = plain(
    renderSidebarSidepanels(state as any, 34, mockTheme, {
      interactive: true,
      onSelectModel: async () => {},
    }),
  ).join("\n");
  assert.ok(
    wiredSidepanels.includes("click to switch · ^↑↓ scroll"),
    "sidepanels.ts must show 'click to switch · ^↑↓ scroll' when switching is wired",
  );

  const wiredModel = plain(
    renderSidebarModel(state as any, 34, mockTheme, {
      interactive: true,
      onSelectModel: async () => {},
    }),
  ).join("\n");
  assert.ok(
    wiredModel.includes("click to switch · ^↑↓ scroll"),
    "model.ts must show 'click to switch · ^↑↓ scroll' when switching is wired",
  );

  // 2. Operations NOT wired: onSelectModel is undefined
  const unwiredSidepanels = plain(
    renderSidebarSidepanels(state as any, 34, mockTheme, {
      interactive: true,
      // onSelectModel omitted
    }),
  ).join("\n");
  assert.ok(
    !unwiredSidepanels.includes("click to switch"),
    "sidepanels.ts must NOT advertise 'click to switch' when onSelectModel is unwired",
  );
  assert.ok(
    !unwiredSidepanels.includes("^R list"),
    "sidepanels.ts must NOT advertise false native '^R list' in Pi",
  );
  assert.ok(
    unwiredSidepanels.includes("^↑↓ scroll"),
    "sidepanels.ts should show '^↑↓ scroll' when scroll hints are active",
  );

  const unwiredModel = plain(
    renderSidebarModel(state as any, 34, mockTheme, {
      interactive: true,
      // onSelectModel omitted
    }),
  ).join("\n");
  assert.ok(
    !unwiredModel.includes("click to switch"),
    "model.ts must NOT advertise 'click to switch' when onSelectModel is unwired",
  );
  assert.ok(
    !unwiredModel.includes("Session model history"),
    "model.ts must not show hardcoded 'Session model history'",
  );
});

test("sidebar LSP inner lines have source-backed leading space padding", () => {
  // Empty state with no LSP data: " — run lsp_diagnostics for diagnostics" (with leading space)
  const lspUnranLines = renderLspSection(undefined, false, 30, mockTheme);
  const unranPlain = plain(lspUnranLines);
  assert.ok(
    unranPlain.some((line) => line === " — run lsp_diagnostics for diagnostics"),
    "Must have leading space before '— run lsp_diagnostics for diagnostics'",
  );

  // Clean state with 0 diags: " — no diagnostics" (with leading space)
  const lspCleanLines = renderLspSection([], false, 30, mockTheme);
  const cleanPlain = plain(lspCleanLines);
  assert.ok(
    cleanPlain.some((line) => line === " — no diagnostics"),
    "Must have leading space before '— no diagnostics'",
  );

  // Model LSP empty rendering in renderSidebarModel (line truncated to inner width 30)
  const modelEmptyLsp = plain(
    renderSidebarModel({ lsp: undefined } as any, 34, mockTheme, {
      visibleSections: { lsp: true },
      foldedSections: { lsp: false },
    }),
  );
  assert.ok(
    modelEmptyLsp.some((line) => line.includes(" — run lsp_diagnostics")),
    "model.ts must render ' — run lsp_diagnostics' with leading space",
  );

  const modelCleanLsp = plain(
    renderSidebarModel({ lsp: [] } as any, 34, mockTheme, {
      visibleSections: { lsp: true },
      foldedSections: { lsp: false },
    }),
  );
  assert.ok(
    modelCleanLsp.some((line) => line.includes(" — no diagnostics")),
    "model.ts must render ' — no diagnostics' with leading space",
  );
});

test("todos empty state and git metadata fail closed when owner unavailable", () => {
  // Todos when undefined shows "unavailable", never fabricated items
  const todosSidepanels = plain(
    renderSidebarSidepanels({ todos: undefined } as any, 34, mockTheme, {
      visibleSections: { todos: true },
      foldedSections: { todos: false },
    }),
  );
  assert.ok(todosSidepanels.some((l) => l.includes("unavailable")));

  // Workspace when ok is false shows "Git status unavailable", never fabricated commits/files
  const wsSidepanels = plain(
    renderSidebarSidepanels({ workspace: { ok: false, cwd: "/test" } } as any, 34, mockTheme, {
      visibleSections: { workspace: true },
      foldedSections: { workspace: false },
    }),
  );
  assert.ok(wsSidepanels.some((l) => l.includes("Git status unavailable")));
});

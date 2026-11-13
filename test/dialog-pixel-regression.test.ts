import test from "node:test";
import assert from "node:assert/strict";
import { initTheme, InteractiveMode } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { fit, shorten } from "../extensions/omt/features/omt-dialogs/model.ts";
import { OmtTreeDialogComponent, filterTreeNodesByMode } from "../extensions/omt/features/omt-dialogs/tree-dialog.ts";
import { signatureTheme } from "../extensions/omt/presets/omt-signature/rendering.ts";
import { OmtSettingsHubComponent } from "../extensions/omt/features/omt-dialogs/settings-hub.ts";
import { OmtModelPickerComponent } from "../extensions/omt/features/omt-dialogs/model-picker.ts";
import { PetPickerComponent } from "../extensions/omt/features/omt-dialogs/pet-picker.ts";
import { ResumeDialogComponent } from "../extensions/omt/features/omt-dialogs/resume-dialog.ts";
import { OmtTrajectoryComponent as TrajectoryDialogComponent } from "../extensions/omt/features/omt-dialogs/trajectory-dialog.ts";

function setup() {
  initTheme("dark");
  const theme = signatureTheme((InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme);
  const tui = { terminal: { columns: 192, rows: 49 }, requestRender() {} } as any;
  return { theme, tui, ctx: { hasUI: true, mode: "tui" } as any };
}
const plain = (rows: string[]) => rows.map(stripTerminalSequences);
function separators(row: string) { return [...row].flatMap((c, i) => c === "│" ? [i] : []); }
function aligned(rows: string[], header: string, expected: number[]) {
  const lines = plain(rows); const at = lines.findIndex(l => l.includes(header));
  assert.ok(at >= 0, header);
  assert.deepEqual(separators(lines[at]!), expected, "header columns follow reference geometry");
  for (const line of lines.slice(at + 1, at + 25)) {
    assert.deepEqual(separators(line), expected, "body separators align with headers including padded short rows");
  }
}
function highlighted(row: string) {
  assert.match(row, /\x1b\[48;(?:2|5);/, "selection must paint a background, not just bold foreground");
}

test("tree defaults hide bookkeeping without deleting it, and selection avoids duplicate role prefixes", () => {
  const { theme, tui, ctx } = setup();
  const nodes = [{ id: "u", parentId: null, role: "user" as const, summary: "User: hi" },
    { id: "a", parentId: "u", role: "assistant" as const, summary: "Assistant: hello", isCurrent: true },
    { id: "t", parentId: "a", entryType: "thinking_level_change", summary: "Thinking: medium" }];
  assert.deepEqual(filterTreeNodesByMode(nodes, "default").map(n => n.id), ["u", "a"]);
  assert.deepEqual(filterTreeNodesByMode(nodes, "all").map(n => n.id), ["u", "a", "t"]);
  const picker = new OmtTreeDialogComponent(tui, theme, undefined, () => {}, ctx, { nodes, onJumpToNode() {} });
  const rows = picker.render(192); const text = plain(rows).join("\n");
  assert.ok(!text.includes("user: User:")); assert.ok(!text.includes("assistant: Assistant:"));
  assert.ok(!/[└├⊟]/.test(text), "a linear message chain is not a branch");
  highlighted(rows.find(l => stripTerminalSequences(l).includes("›"))!);
});

test("dialog fitting counts styled grapheme cells, never ANSI bytes or UTF-16 units", () => {
  const text = "\x1b[1m界é🙂\x1b[22m";
  assert.equal(visibleWidth(fit(text, 12)), 12);
  assert.equal(stripTerminalSequences(fit(text, 12)), "界é🙂" + " ".repeat(7));
  assert.equal(visibleWidth(shorten(text, 4)), 4);
  assert.equal(stripTerminalSequences(shorten(text, 4)), "界é…");
});

test("hub header and every body row retain source separator columns with real ANSI styles", () => {
  const { theme, tui, ctx } = setup();
  for (const section of ["agent", "theme"] as const) {
    const hub = new OmtSettingsHubComponent(tui, theme, { matches: () => false } as any, () => {}, ctx, { initialSection: section });
    const rows = hub.render(192);
    aligned(rows, "SECTIONS", section === "theme" ? [0, 35, 114, 151] : [0, 35, 151]);
    if (section === "agent") highlighted(rows.find(l => stripTerminalSequences(l).includes("▸ Agent"))!);
    else {
      const header = plain(rows).find(l => l.includes("SECTIONS"))!;
      assert.ok(header.includes("▸ THEME · 25"));
      assert.ok(header.includes("BACKGROUND · 32"));
      highlighted(rows.find(l => stripTerminalSequences(l).includes("▸ default"))!);
      assert.ok(!plain(rows).some(l => /[■□] transparent/.test(l)), "background swatch is two colored cells, not a square glyph");
    }
  }
});

test("model header/body columns match reference and focused providers have a full selection surface", () => {
  const { theme, tui, ctx } = setup();
  const picker = new OmtModelPickerComponent(tui, theme, undefined, () => {}, ctx, {
    models: [{ id: "fake-model", provider: "fake-provider", contextWindow: 200000, maxTokens: 64000, keyStatus: "ready" }],
    currentModelId: "fake-model", onSelectModel() {},
  });
  const rows = picker.render(192);
  aligned(rows, "PROVIDERS", [0, 47, 104, 151]);
  highlighted(rows.find(l => stripTerminalSequences(l).includes("● fake-provider"))!);
  assert.ok(plain(rows).some(l => l.includes("200.0k")));
});

test("pet selection paints across the row, while retaining native filtering and preview", () => {
  const { theme, tui } = setup();
  const picker = new PetPickerComponent(tui, theme, undefined, () => {}, { currentPet: "cat" } as any);
  const rows = picker.render(192);
  highlighted(rows.find(l => stripTerminalSequences(l).includes("▸"))!);
  picker.handleInput("界");
  assert.ok(plain(picker.render(192)).some(l => l.includes("filter: 界")));
});

test("resume wraps complete path into detail rows instead of silently truncating it", () => {
  const { theme, tui, ctx } = setup();
  const path = "/" + "long-path-".repeat(12) + "session.jsonl";
  const picker = new ResumeDialogComponent(tui, theme, undefined, () => {}, ctx, {
    sessions: [{ id: "s", path, cwd: "/project", title: "hello", modified: Date.now(), messageCount: 2 }],
  });
  const rows = picker.render(192); const lines = plain(rows);
  const first = lines.findIndex(l => l.includes("SESSIONS"));
  const right = lines.slice(first + 1, first + 25).map(l => l.split("│")[2]?.trim() ?? "").join("");
  assert.ok(right.includes(path), right);
  highlighted(rows.find(l => stripTerminalSequences(l).includes("▸ hello"))!);
});

test("trajectory retains source title/help rows, exact 37-row geometry and selected step background", () => {
  const { theme, tui, ctx } = setup();
  const picker = new TrajectoryDialogComponent(tui, theme, { matches: () => false } as any, () => {}, ctx, {
    steps: [{ id: "a", index: 1, kind: "user", title: "hi", timestamp: "2024-01-01T00:00:00Z", detail: "#01 • user: hi\nuser · id a · 00:00:00\n\nhi" }],
  });
  const rows = picker.render(192); const lines = plain(rows);
  assert.equal(rows.length, 37);
  assert.ok(lines.some(l => l.includes("Trajectory (all)")));
  assert.ok(lines.some(l => l.includes("harness-style run trace")));
  assert.ok(lines.some(l => l.includes("#01 • user: hi")));
  highlighted(rows.find(l => stripTerminalSequences(l).includes("▸ #01"))!);
});

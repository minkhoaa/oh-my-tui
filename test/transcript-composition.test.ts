import test from "node:test";
import assert from "node:assert/strict";
import { AssistantMessageComponent, ToolExecutionComponent, InteractiveMode, getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences, visibleWidth, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { ToolGroups, toolGroupSummary } from "../extensions/omt/features/tools/groups.ts";
import { createGroupedToolRenderer } from "../extensions/omt/features/tools/group-renderer.ts";
import { createSignatureToolRenderer } from "../extensions/omt/presets/omt-signature/tools.ts";
import { createToolsControl } from "../extensions/omt/features/tools/index.ts";
import { observeAssistantMessages } from "../extensions/omt/core/native-ui.ts";
import { setActiveTheme, resetActiveTheme } from "../extensions/omt/core/theme.ts";
import { assistantFixture } from "./assistant-fixture.ts";

function palette() { initTheme("dark"); return (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme; }
const plain = (rows: string[]) => rows.map(stripTerminalSequences);
const call = (id: string, name = "read") => ({ type: "toolCall", id, name, arguments: { path: `${id}.ts` } });
const thinking = (thinking: string) => ({ type: "thinking", thinking });
const text = (text: string) => ({ type: "text", text });
const message = (content: unknown[], timestamp = 1) => ({ role: "assistant", provider: "test", model: "model", timestamp, content });
const click = (x: number, y: number, width = 120, height = 50): TuiMouseEvent => ({ type: "click", button: "left", x, y, screenX: x, screenY: y, width, height, shift: false, alt: false, ctrl: false });

function own(groups: ToolGroups, ids: string[], names = ids.map(() => "read")) {
  ids.forEach((id, index) => groups.register(id, names[index]!, "success", () => {}));
}

test("toolgroup source grammar counts mixed verbs in first-seen order and reflects running/failure states", () => {
  const groups = new ToolGroups();
  groups.observe(message([call("r1"), call("b", "bash"), call("r2"), call("r3")]));
  own(groups, ["r1", "b", "r2", "r3"], ["read", "bash", "read", "read"]);
  assert.equal(toolGroupSummary(groups.view("r1")!).text, "Read 3 files, ran 1 shell command");
  groups.result("b", "failure", false); assert.equal(toolGroupSummary(groups.view("r2")!).failed, true);
  groups.result("r3", "running", false);
  assert.deepEqual(toolGroupSummary(groups.view("r1")!), { text: "Reading 3 files, running 1 shell command…", running: true, failed: true });
  groups.reset();
});

test("visible thinking/prose, writes, foreign owners, images and duplicate IDs break groups; empty content/results do not", () => {
  const groups = new ToolGroups();
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  groups.observe(message([call("a"), thinking(" \n"), call("b"), thinking("visible boundary"), call("c"), text("commentary"), call("d"), call("w", "write"), call("e"), call("foreign"), call("f"), call("g"), call("h"), call("i")]));
  own(groups, ids);
  groups.observe({ role: "toolResult", toolCallId: "g", isError: false, content: [{ type: "image" }] });
  assert.deepEqual(groups.view("a")!.members.map(m => m.id), ["a", "b"]);
  for (const id of ["c", "d", "e", "f", "g"]) assert.equal(groups.view(id), undefined, id);
  assert.deepEqual(groups.view("h")!.members.map(m => m.id), ["h", "i"]);
  groups.observe(message([call("duplicate"), call("duplicate")], 2)); own(groups, ["duplicate"]);
  assert.equal(groups.view("duplicate"), undefined);
  groups.reset();
  groups.observe(message([call("before-error")], 3));
  groups.observe({ ...message([], 4), stopReason: "error", errorMessage: "visible diagnostic" });
  groups.observe(message([call("after-error")], 5));
  own(groups, ["before-error", "after-error"]);
  assert.equal(groups.view("before-error"), undefined, "native diagnostics are visible group boundaries");
  assert.equal(groups.view("after-error"), undefined);
  groups.reset();
});

test("streaming message updates replace, not duplicate, calls; result messages and invisible harness entries preserve adjacency", () => {
  const groups = new ToolGroups();
  groups.observe(message([thinking("plan"), call("a")])); own(groups, ["a", "b"]);
  assert.equal(groups.view("a"), undefined);
  groups.observe(message([thinking("plan"), call("a"), call("b")]));
  assert.equal(groups.view("a")!.members.length, 2);
  groups.observe({ role: "toolResult", toolCallId: "a", isError: true, content: [] });
  groups.observe({ role: "custom", display: false, content: "invisible" });
  groups.observe(message([call("c")], 2)); own(groups, ["c"]);
  assert.equal(groups.view("a")!.members.length, 3);
  assert.equal(toolGroupSummary(groups.view("a")!).failed, true);
  groups.observe({ role: "user", timestamp: 3, content: "next request" });
  groups.observe(message([call("d")], 4)); own(groups, ["d"]);
  assert.equal(groups.view("d"), undefined);
  groups.reset();
});

test("renderer invalidation is coalesced outside constructors and session reset cancels stale callbacks", async () => {
  const groups = new ToolGroups(); let invalidations = 0;
  groups.observe(message([call("a"), call("b")]));
  for (const id of ["a", "b"]) groups.register(id, "read", "running", () => invalidations++);
  assert.equal(invalidations, 0);
  await Promise.resolve(); assert.equal(invalidations, 2);
  groups.result("a", "failure", false); groups.reset();
  await Promise.resolve(); assert.equal(invalidations, 2);
});

function nativeGroup(outputPad = 1) {
  palette(); setActiveTheme("omt-signature");
  let global = false;
  const groups = new ToolGroups(() => global);
  groups.seed([message([thinking("reading project"), call("r1"), call("r2"), call("b", "bash"), call("r3")])]);
  const ui = { requestRender() {} } as TUI;
  const names = ["read", "read", "bash", "read"];
  const ids = ["r1", "r2", "b", "r3"];
  const tools = ids.map((id, index) => new ToolExecutionComponent(names[index]!, id,
    names[index] === "bash" ? { command: "false" } : { path: `${id}.ts` }, { outputPad },
    createGroupedToolRenderer(names[index]!, createSignatureToolRenderer(names[index]!), groups), ui, "/workspace"));
  tools.forEach((tool, index) => tool.updateResult({ content: [{ type: "text", text: `FULL_OUTPUT_${ids[index]}\n${"tail-content ".repeat(30)}` }], details: {}, isError: index === 2 }));
  const root = new Container(); tools.forEach(tool => root.addChild(tool));
  return { groups, tools, root, setGlobal(value: boolean) { global = value; tools.forEach(tool => tool.setExpanded(value)); } };
}

test("real native self-shell folds followers with zero blank rows; summary clicks open headers, native per-tool clicks reveal full errors", () => {
  const { groups, tools, root } = nativeGroup();
  const saved = [...root.children];
  try {
    let rows = plain(root.render(120));
    assert.equal(rows.length, 2, "one native spacer and one group row, no phantom follower gaps");
    assert.ok(rows[1]!.includes("Read 3 files, ran 1 shell command (click to expand)"));
    assert.ok(!rows.join("\n").includes("FULL_OUTPUT"));
    assert.ok(tools[0]!.handleMouse(click(10, 1))?.handled);
    rows = plain(root.render(120));
    assert.ok(rows.join("\n").includes("(click to collapse)"));
    assert.equal(rows.filter(row => /● (?:Read|Bash)\(/.test(row)).length, 4);
    assert.ok(!rows.join("\n").includes("FULL_OUTPUT"), "opening a group reveals calls, not all result bodies");
    assert.ok(tools[2]!.handleMouse(click(10, 1))?.handled);
    rows = plain(root.render(120));
    assert.ok(rows.join("\n").includes("FULL_OUTPUT_b"), "native per-tool expansion exposes original error output");
    assert.ok(rows.join("\n").includes("tail-content"));
    assert.ok(tools[0]!.handleMouse(click(10, 1))?.handled);
    assert.equal(root.render(120).length, 2);
    assert.deepEqual(root.children, saved, "no history reparenting/removal");
  } finally { groups.reset(); resetActiveTheme(); }
});

test("native grouped, individual and assistant gutters share a one-cell inset at every outputPad", () => {
  for (const outputPad of [0, 1, 2, 4]) {
    const { groups, tools, root, setGlobal } = nativeGroup(outputPad);
    const theme = palette();
    const restore = observeAssistantMessages(() => true, () => theme);
    try {
      const assistant = new AssistantMessageComponent({ ...assistantFixture(), content: [thinking("alignment reasoning"), text("alignment prose")] } as any,
        false, getMarkdownTheme(), "Reasoning", outputPad);
      const standalone = new ToolExecutionComponent("read", "solo", { path: "solo.ts" }, { outputPad },
        createSignatureToolRenderer("read"), { requestRender() {} } as TUI, "/workspace");
      standalone.updateResult({ content: [{ type: "text", text: "original output" }], isError: false });
      for (const width of [10, 40, 120]) {
        const assertGutters = (rows: string[], surface: string) => {
          assert.ok(rows.every(row => visibleWidth(row) <= width), `${surface} width=${width}, pad=${outputPad}`);
          const gutters = plain(rows).filter(row => /[●○]/u.test(row));
          assert.ok(gutters.length > 0, `${surface} must render a gutter`);
          assert.ok(gutters.every(row => /^ [●○]/u.test(row)), `${surface} width=${width}, pad=${outputPad}: ${JSON.stringify(gutters)}`);
        };
        assertGutters(assistant.render(width), "assistant");
        assertGutters(standalone.render(width), "standalone");
        assertGutters(root.render(width), "collapsed group");
        assert.ok(tools[0]!.handleMouse(click(0, 1, width))?.handled);
        assertGutters(root.render(width), "open group and individual calls");
        assert.ok(tools[0]!.handleMouse(click(0, 1, width))?.handled);
        setGlobal(true);
        assertGutters(root.render(width), "globally expanded group and output");
        setGlobal(false);
      }
    } finally { restore?.(); groups.reset(); resetActiveTheme(); }
  }
});

test("global native expansion, width/Unicode resizing and native preset delegation retain original result bodies", () => {
  const { groups, tools, root, setGlobal } = nativeGroup();
  try {
    setGlobal(true);
    let output = plain(root.render(90)).join("\n");
    for (const id of ["r1", "r2", "b", "r3"]) assert.ok(output.includes(`FULL_OUTPUT_${id}`));
    for (const width of [120, 40, 20, 10]) assert.ok(root.render(width).every(row => visibleWidth(row) <= width));
    setGlobal(false); assert.equal(root.render(120).length, 2);
    setActiveTheme("native");
    assert.ok(tools[1]!.render(120).length > 0, "captured follower is never hidden outside Signature");
  } finally { groups.reset(); resetActiveTheme(); }
});

test("session reseeding re-registers surviving public renderer components, without grouping an unowned captured tool", () => {
  const { groups, root, tools } = nativeGroup();
  try {
    groups.seed([message([call("r1"), call("r2")])]);
    root.render(100); // Native components register their current ownership on paint.
    assert.equal(root.render(100).filter(row => stripTerminalSequences(row).includes("click to expand")).length, 1);
    groups.seed([message([call("r1"), call("foreign"), call("r2")])]);
    root.render(100);
    assert.equal(groups.view("r1"), undefined); assert.equal(groups.view("r2"), undefined);
    assert.ok(tools[0]!.render(100).length > 0 && tools[1]!.render(100).length > 0);
  } finally { groups.reset(); resetActiveTheme(); }
});

test("raw thinking defaults to preview for every provider; click expands full raw text, and native/off restores original Markdown", () => {
  const theme = palette(); setActiveTheme("omt-signature"); let enabled = true;
  const restore = observeAssistantMessages(() => enabled, () => theme); assert.ok(restore);
  const raw = "**Inspecting project**\n\n" + "detail ".repeat(80) + "TAIL_SENTINEL\x1b[2J";
  try {
    for (const [provider, api] of [["openai", "openai-responses"], ["anthropic", "anthropic-messages"], ["google", "google-generative-ai"]]) {
      const input = { ...assistantFixture(), provider: provider!, api: api as any, content: [{ type: "thinking" as const, thinking: raw }, { type: "text" as const, text: "visible commentary" }] };
      const component = new AssistantMessageComponent(input, false, getMarkdownTheme(), "Reasoning", 1);
      let rows = plain(component.render(180));
      const preview = rows.findIndex(row => row.includes("**Inspecting project**"));
      assert.ok(preview >= 0); assert.ok(rows[preview]!.includes("⏎  ⏎"), "raw consecutive newlines are not collapsed into one marker");
      assert.ok(!rows.join("\n").includes("TAIL_SENTINEL"));
      assert.ok(rows.some(row => row.startsWith(" ● visible commentary")));
      assert.ok(component.handleMouse(click(1, preview, 180))?.handled);
      const expandedRows = component.render(180);
      assert.ok(!expandedRows.join("\n").includes("\x1b[2J"), "raw display cannot inject terminal control sequences");
      rows = plain(expandedRows);
      assert.ok(rows.join("\n").includes("TAIL_SENTINEL"));
      assert.ok(rows.join("\n").includes("**Inspecting project**"), "expanded source thinking is plain italic raw text, not reparsed Markdown");
      const expandedRow = rows.findIndex(row => row.includes("**Inspecting project**"));
      component.handleMouse(click(1, expandedRow, 180));
      assert.ok(!plain(component.render(180)).join("\n").includes("TAIL_SENTINEL"));
      enabled = false;
      rows = plain(component.render(180));
      assert.ok(rows.join("\n").includes("TAIL_SENTINEL"));
      assert.ok(!rows.join("\n").includes("**Inspecting project**"), "native Markdown is restored");
      assert.deepEqual((component as any).lastMessage, input);
      enabled = true;
    }
  } finally { restore?.(); resetActiveTheme(); }
});

test("public session hydration treats custom entries, compaction and displayed custom messages as conservative boundaries", () => {
  palette(); setActiveTheme("omt-signature");
  let resolver: any;
  const control = createToolsControl({ registerToolRenderer(fn: any) { resolver = fn; } } as any);
  let middle: unknown[] = [];
  const ctx = { hasUI: true, ui: { getToolsExpanded: () => false }, sessionManager: { getBranch: () => [
    { type: "message", message: message([call("first")], 1) }, ...middle,
    { type: "message", message: message([call("last")], 2) },
  ] } } as any;
  const root = new Container();
  const ui = { requestRender() {} } as TUI;
  try {
    control.syncSession!(ctx);
    for (const id of ["first", "last"]) {
      const tool = new ToolExecutionComponent("read", id, { path: id }, {}, resolver("read", () => undefined), ui, "/workspace");
      tool.updateResult({ content: [], isError: false }); root.addChild(tool);
    }
    root.render(100);
    assert.ok(plain(root.render(100)).join("\n").includes("Read 2 files"));
    for (const type of ["custom", "compaction", "branch_summary", "custom_message"]) {
      middle = [{ type, display: true, id: "boundary", customType: "foreign" }]; control.syncSession!(ctx);
      root.render(100);
      assert.ok(!plain(root.render(100)).join("\n").includes("Read 2 files"), type);
    }
    middle = [{ type: "custom_message", display: false }]; control.syncSession!(ctx); root.render(100);
    assert.ok(plain(root.render(100)).join("\n").includes("Read 2 files"));
    ctx.ui = {}; control.syncSession!(ctx); control.observeMessage!(message([call("first"), call("last")], 5));
    root.render(100);
    assert.ok(!plain(root.render(100)).join("\n").includes("Read 2 files"), "unsupported global expansion API must not hide native calls");
  } finally { control.cleanup?.(); resetActiveTheme(); }
});

test("public tool resolver still yields to foreign renderer ownership", () => {
  let resolver: any; const foreign = { renderCall: () => ({ render: () => ["FOREIGN"], invalidate() {} }) };
  const control = createToolsControl({ registerToolRenderer(fn: any) { resolver = fn; } } as any);
  try { setActiveTheme("omt-signature"); assert.equal(resolver("read", () => foreign), foreign); }
  finally { control.cleanup?.(); resetActiveTheme(); }
});

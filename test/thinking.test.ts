import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  AssistantMessageComponent, InteractiveMode, initTheme,
  type ExtensionAPI, type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createThinkingControl } from "../extensions/omt/features/thinking/index.ts";
import { observeNativeUIOwnership } from "../extensions/omt/core/native-ui.ts";
import { setActiveTheme } from "../extensions/omt/core/theme.ts";
// Minimal retains static, event-driven progress; animated presets have separate tests.
setActiveTheme("minimal");

function fixture(t: TestContext) {
  const restore = observeNativeUIOwnership();
  assert.ok(restore);
  t.after(restore);
  // Exercise actual native setters, loader, Markdown, labels and restoration.
  const host = Object.assign(Object.create(InteractiveMode.prototype), {
    workingMessage: undefined, workingIndicatorOptions: undefined, workingVisible: true,
    defaultWorkingMessage: "Working", defaultHiddenThinkingLabel: "Thinking...", hiddenThinkingLabel: "Thinking...",
    chatContainer: new Container(), statusContainer: new Container(),
    defaultEditor: { setWorkingStatusIndicator() {} }, editor: {},
    ui: { requestRender() {}, getClearOnShrink: () => false }, options: { tuiMode: "regular" },
    runtimeHost: { session: { isStreaming: true } },
  });
  const ui = host.createExtensionUIContext();
  const ctx = { mode: "tui", hasUI: true, ui } as ExtensionContext;
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => unknown>();
  const control = createThinkingControl({ on: (name, handler) => { handlers.set(name, handler); } } as ExtensionAPI);
  const emit = (name: string, event: any = {}) => handlers.get(name)?.(event, ctx);
  t.after(() => { host.clearStatusIndicator(); control.cleanup(ctx); });
  return { host, ui, ctx, control, emit };
}

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function message(stopReason = "stop", errorMessage?: string) {
  return { role: "assistant", content: [
    { type: "thinking", thinking: "Check 你好 é 👩🏽‍💻 carefully.\n\nKeep **all** reasoning." },
    { type: "text", text: "Answer 你好 🙂" },
  ], api: "openai-responses", provider: "test", model: "fixture", usage, timestamp: 1, stopReason, errorMessage } as any;
}

function text(lines: string[]) { return stripTerminalSequences(lines.join("\n")); }

test("native static loader follows stream phases without timers, content transforms or per-token setters", (t) => {
  initTheme("dark");
  const { host, ui, control, ctx, emit } = fixture(t);
  const timers = t.mock.method(globalThis, "setInterval", () => { throw new Error("OMT must not animate"); });
  assert.equal(control.on(ctx), "OMT thinking on.");
  host.showWorkingStatusIndicator();
  assert.match(text(host.statusContainer.render(80)), /· Working/);
  const changes = t.mock.method(ui, "setWorkingMessage");
  const presentationQueries = t.mock.method(ui, "getWorkingPresentation");
  const msg = message();
  const before = structuredClone(msg);
  for (const [type, label] of [["thinking_delta", "Thinking"], ["text_delta", "Streaming"], ["toolcall_delta", "Preparing tools"]] as const) {
    for (let i = 0; i < 50; i++) emit("message_update", { message: msg, assistantMessageEvent: { type } });
    assert.equal(host.workingMessage, label);
    assert.match(text(host.statusContainer.render(80)), new RegExp(`· ${label}`));
    emit("message_update", { message: msg, assistantMessageEvent: { type: type.replace("_delta", "_end") } });
    assert.equal(host.workingMessage, "Working", "ended blocks no longer claim active thinking/streaming");
  }
  assert.equal(changes.mock.callCount(), 6);
  assert.equal(presentationQueries.mock.callCount(), 6, "skips redundant ownership checks during streaming deltas");
  assert.deepEqual(msg, before);
  assert.equal(timers.mock.callCount(), 0);
});

test("parallel and nested tools stay running until the final observable execution ends", (t) => {
  initTheme("dark");
  const { host, control, ctx, emit } = fixture(t);
  control.on(ctx);
  emit("agent_start");
  for (const toolCallId of ["a", "b", "a/1"]) emit("tool_execution_start", { toolCallId });
  assert.equal(host.workingMessage, "Running tools");
  emit("tool_execution_end", { toolCallId: "a/1", isError: true });
  emit("tool_execution_end", { toolCallId: "b" });
  assert.equal(host.workingMessage, "Running tools", "one error is not an agent failure");
  emit("tool_execution_end", { toolCallId: "a" });
  assert.equal(host.workingMessage, "Working");
  emit("message_end", { message: message("aborted") });
  assert.equal(host.workingMessage, "Interrupted");
  emit("message_end", { message: message("error", "fixture failure") });
  assert.equal(host.workingMessage, "Error");
  emit("agent_settled", { aborted: false });
  assert.equal(host.workingMessage, "Working", "ready for next run, not a false completed state during retries");
});

test("native reasoning, Unicode, resize, completion, interruption and errors retain original content", (t) => {
  const { host, control, ctx } = fixture(t);
  for (const palette of ["dark", "light", "system"]) {
    initTheme(palette);
    for (const reason of ["stop", "aborted", "error", "length"]) {
      const msg = message(reason, reason === "error" ? "fixture failure 你好" : undefined);
      const before = structuredClone(msg);
      const component = new AssistantMessageComponent(msg);
      host.chatContainer.addChild(component);
      const native = [10, 20, 40, 80, 120].map((width) => component.render(width));
      control.on(ctx);
      for (const [i, width] of [10, 20, 40, 80, 120].entries()) {
        assert.deepEqual(component.render(width), native[i], "expanded reasoning is entirely native");
        for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
      }
      assert.match(text(component.render(120)), /Keep all reasoning/);
      component.setHideThinkingBlock(true);
      assert.match(text(component.render(80)), /Thinking/);
      assert.ok(!text(component.render(80)).includes("carefully"));
      component.setHideThinkingBlock(false);
      assert.match(text(component.render(80)), /carefully/);
      component.setHideThinkingBlock(true);
      control.off(ctx);
      assert.match(text(component.render(80)), /Thinking\.\.\./, "off restores already-created labels");
      component.setHideThinkingBlock(false);
      assert.deepEqual(component.render(80), native[3]);
      assert.deepEqual(msg, before);
      if (reason === "aborted") assert.match(text(component.render(80)), /Operation aborted/);
      if (reason === "error") assert.match(text(component.render(80)), /Error: fixture failure 你好/);
      if (reason === "length") assert.match(text(component.render(80)), /truncated before completion/);
      host.chatContainer.clear();
    }
  }
  control.on(ctx);
  host.showWorkingStatusIndicator();
  for (const width of [5, 10, 20, 40, 120, 20, 80]) {
    for (const line of host.statusContainer.render(width)) assert.ok(visibleWidth(line) <= width);
  }
  control.off(ctx);
  assert.equal(host.activeStatusIndicator.frames.length, 10, "live disable restores Pi's native spinner");
  control.on(ctx);
  assert.deepEqual(host.activeStatusIndicator.frames, ["·"], "Minimal live enable stops native animation");
  host.clearStatusIndicator("working");
  assert.deepEqual(host.statusContainer.render(80), [], "native completion removes progress, not reasoning");
  const empty = message();
  empty.content = [{ type: "thinking", thinking: "" }];
  const unavailable = new AssistantMessageComponent(empty, true, undefined, "Reasoning");
  assert.deepEqual(unavailable.render(80), [], "never invent reasoning when no content is available");
});

test("disable and cleanup restore only owned fields and yield to earlier/later owners", (t) => {
  initTheme("dark");
  const { host, ui, control, ctx, emit } = fixture(t);
  for (const apply of [() => ui.setWorkingMessage("Foreign"), () => ui.setWorkingIndicator({ frames: ["F"] }),
    () => ui.setHiddenThinkingLabel("Foreign reasoning"), () => { host.workingVisible = false; }]) {
    apply();
    assert.match(control.on(ctx), /another extension/);
    ui.setWorkingMessage(); ui.setWorkingIndicator(); ui.setHiddenThinkingLabel(); host.workingVisible = true;
  }
  control.on(ctx);
  const ownedIndicator = host.workingIndicatorOptions;
  control.on(ctx);
  assert.equal(host.workingIndicatorOptions, ownedIndicator, "on is idempotent");
  ui.setWorkingMessage("Foreign later");
  emit("message_update", { message: message(), assistantMessageEvent: { type: "thinking_delta" } });
  assert.equal(host.workingMessage, "Foreign later");
  control.off(ctx);
  assert.equal(host.workingMessage, "Foreign later");
  assert.equal(host.workingIndicatorOptions, undefined);
  assert.equal(host.hiddenThinkingLabel, "Thinking...");
  ui.setWorkingMessage();
  control.on(ctx);
  const foreign = { frames: ["Later"] };
  ui.setWorkingIndicator(foreign);
  ui.setHiddenThinkingLabel("Later reasoning");
  control.cleanup(ctx);
  assert.equal(host.workingMessage, undefined);
  assert.equal(host.workingIndicatorOptions, foreign);
  assert.equal(host.hiddenThinkingLabel, "Later reasoning");
});

test("unsupported or non-TUI contexts retain native presentation", (t) => {
  const { control, ctx, host } = fixture(t);
  for (const mode of ["rpc", "print", "json"]) assert.match(control.on({ ...ctx, mode } as ExtensionContext), /unavailable/);
  delete host.workingVisible;
  assert.match(control.on(ctx), /unavailable/);
  assert.equal(host.workingIndicatorOptions, undefined);
  const noGetter = { ...ctx, ui: { ...ctx.ui, getWorkingPresentation: undefined } } as ExtensionContext;
  assert.match(control.on(noGetter), /unavailable/);
});

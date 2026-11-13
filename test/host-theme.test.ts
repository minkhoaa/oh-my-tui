import test from "node:test";
import assert from "node:assert/strict";
import { Theme, AssistantMessageComponent, initTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { colorToHex, stripTerminalSequences, type MarkdownTheme } from "@earendil-works/pi-tui";
import { createHostThemeControl, createSignatureHostTheme, snapshotHostTheme } from "../extensions/omt/integration/host-theme.ts";
import { configStore } from "../extensions/omt/core/config.ts";
import { signatureColor } from "../extensions/omt/presets/omt-signature/rendering.ts";
import { assistantFixture } from "./assistant-fixture.ts";

function baseTheme(mode: "truecolor" | "256color" = "truecolor") {
  return new Theme({ text: "", muted: "#aabbcc", dim: "#778899", mdCode: "#ff00ff", mdListBullet: "#ff00ff", accent: "#8877ff", thinkingXhigh: "#8877ff" } as any,
    { userMessageBg: "", selectedBg: "#112233" } as any, mode, { name: "original", appearance: "dark", dim: ["dim"] });
}

function host(initial = baseTheme()) {
  let current = initial;
  const writes: Theme[] = [];
  // Simulate the installed UI's live facade; storing its reference is not a snapshot.
  const facade = new Proxy({} as Theme, { get: (_target, key) => {
    const value = Reflect.get(current, key, current);
    return typeof value === "function" ? value.bind(current) : value;
  } });
  const ctx = { hasUI: true, ui: { get theme() { return facade; }, setTheme(value: Theme) {
    assert.ok(value instanceof Theme, "use instance API, never persistent named selection");
    current = value; writes.push(value); return { success: true };
  } } } as unknown as ExtensionContext;
  return { ctx, writes, get current() { return current; }, replace(theme: Theme) { current = theme; } };
}

function withPalette(fn: () => void) {
  configStore.setSignatureOverride("palette", "auto");
  try { fn(); } finally { configStore.clearSessionOverrides(); }
}

test("host theme applies Signature Markdown/syntax tokens without mutating the original and restores a live facade snapshot", () => withPalette(() => {
  const h = host(); const original = h.current; const control = createHostThemeControl();
  const originalCode = original.fg("mdCode", "code");
  assert.equal(control.refresh(h.ctx, true, true), undefined);
  assert.equal(colorToHex(h.current.colors.mdCode), colorToHex(signatureColor(original, "red")));
  assert.equal(colorToHex(h.current.colors.mdHeading), colorToHex(signatureColor(original, "cyan")));
  assert.equal(colorToHex(h.current.colors.mdCodeBlock), colorToHex(signatureColor(original, "code")));
  assert.equal(colorToHex(h.current.colors.mdListBullet), colorToHex(signatureColor(original, "muted")));
  assert.equal(colorToHex(h.current.colors.syntaxString), colorToHex(signatureColor(original, "green")));
  assert.equal(original.fg("mdCode", "code"), originalCode);
  control.refresh(h.ctx, true); assert.equal(h.writes.length, 1, "unchanged palette does not invalidate host repeatedly");
  control.refresh(h.ctx, false);
  assert.equal(h.current.fg("mdCode", "code"), originalCode);
  assert.equal(h.current.getFgAnsi("text"), original.getFgAnsi("text"), "terminal-default foreground preserved");
  assert.equal(h.current.getBgAnsi("userMessageBg"), original.getBgAnsi("userMessageBg"), "terminal-default background preserved");
  assert.equal(h.current.fg("dim", "dim"), original.fg("dim", "dim"), "dim attribute preserved");
  control.cleanup(h.ctx); assert.equal(h.writes.length, 2, "cleanup is idempotent");
}));

test("host theme yields to external replacement, never restores over it, and requires explicit reacquisition", () => withPalette(() => {
  const h = host(); const control = createHostThemeControl(); control.refresh(h.ctx, true, true);
  const foreign = baseTheme(); h.replace(foreign);
  control.refresh(h.ctx, true); control.refresh(h.ctx, false); control.refresh(h.ctx, true);
  assert.equal(h.current, foreign); assert.equal(h.writes.length, 1);
  control.refresh(h.ctx, true, true); assert.notEqual(h.current, foreign);
  control.cleanup(h.ctx); assert.equal(h.current.fg("mdCode", "x"), foreign.fg("mdCode", "x"));
}));

test("palette changes recolor the host while preserving the pre-OMT baseline and explicit light/256-color appearance", () => withPalette(() => {
  const h = host(baseTheme("256color")); const control = createHostThemeControl(); const old = h.current.fg("mdCode", "x");
  control.refresh(h.ctx, true, true);
  configStore.setSignatureOverride("palette", "catppuccin-latte"); control.refresh(h.ctx, true);
  assert.equal(h.current.appearance, "light"); assert.equal(h.current.getColorMode(), "256color");
  assert.match(h.current.fg("mdCode", "x"), /\x1b\[38;5;/);
  control.cleanup(h.ctx); assert.equal(h.current.fg("mdCode", "x"), old);
}));

test("host theme handles missing API, headless contexts and rejected changes without taking ownership", () => withPalette(() => {
  const control = createHostThemeControl();
  assert.equal(control.refresh({ hasUI: false } as ExtensionContext, true), undefined);
  assert.match(control.refresh({ hasUI: true, ui: {} } as ExtensionContext, true)!, /unavailable/);
  const h = host(); const old = h.current;
  h.ctx.ui.setTheme = () => ({ success: false, error: "denied" });
  assert.match(control.refresh(h.ctx, true, true)!, /denied/);
  control.cleanup(h.ctx); assert.equal(h.current, old);
}));

test("real assistant Markdown can follow host tokens across streaming/update, expanded thinking and invalidate without content loss", () => withPalette(() => {
  initTheme("dark");
  const h = host(); const control = createHostThemeControl();
  const style = (token: any) => (s: string) => h.ctx.ui.theme.fg(token, s);
  const md: MarkdownTheme = {
    heading: style("text"), link: style("text"), linkUrl: style("muted"), code: style("mdCode"),
    codeBlock: style("mdCode"), codeBlockBorder: style("muted"), quote: style("muted"), quoteBorder: style("muted"),
    hr: style("muted"), listBullet: style("mdListBullet"), bold: s => s, italic: s => s, underline: s => s, strikethrough: s => s,
  };
  const message = { ...assistantFixture(), content: [{ type: "thinking" as const, thinking: "Inspect `module`" }, { type: "text" as const, text: "- Read `module`\n- Keep content" }] };
  const component = new AssistantMessageComponent(message, false, md);
  const before = component.render(80);
  control.refresh(h.ctx, true, true); component.invalidate();
  component.updateContent(message, true);
  const during = component.render(80);
  assert.notDeepEqual(during, before);
  assert.deepEqual(during.map(stripTerminalSequences), before.map(stripTerminalSequences));
  component.updateContent(message, false);
  assert.deepEqual(component.render(80).map(stripTerminalSequences), before.map(stripTerminalSequences));
  control.cleanup(h.ctx); component.invalidate();
  assert.deepEqual(component.render(80), before);
}));

test("public snapshot and host builder do not mutate caller Theme", () => withPalette(() => {
  const base = baseTheme(); const snapshot = snapshotHostTheme(base);
  assert.deepEqual(snapshot.colors, base.colors);
  const themed = createSignatureHostTheme(base, "omt-test");
  assert.equal(themed.name, "omt-test"); assert.equal(base.name, "original");
}));

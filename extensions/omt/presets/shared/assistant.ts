// Assistant message formatting and preset presentation for Pi.
import type { AssistantMessageComponent, Theme } from "@earendil-works/pi-coding-agent";
import { Text, stripTerminalSequences, type MarkdownTheme, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { getActiveTheme } from "../../core/theme.ts";
import { isCodexTheme, isOpenCodeTheme, isClaudeTheme, isSignatureTheme, contentPadding } from "./style.ts";
import { signatureAssistant, startsPreformatted, type SignatureAssistantBlock } from "../omt-signature/assistant.ts";
import { signatureThinkingLabel } from "../omt-signature/message-model.ts";
import { signatureFg } from "../omt-signature/rendering.ts";
import { codexAssistant } from "../codex-inspired/assistant.ts";
import { openCodeAssistant } from "../opencode-inspired/assistant.ts";
import { openCodeFg } from "../opencode-inspired/rendering.ts";
import { claudeAssistant, claudeThinkingLabel } from "../claude-code-inspired/assistant.ts";
import type { AssistantHost } from "./types.ts";

function extractThinkingRuns(message?: unknown): string[] {
  const msg = message as { content?: Array<{ type: string; thinking?: string }> } | undefined;
  if (!msg?.content || !Array.isArray(msg.content)) return [];
  const runs: string[] = [];
  for (let i = 0; i < msg.content.length; i++) {
    const item = msg.content[i];
    if (item?.type === "thinking") {
      const blocks: string[] = [];
      for (; i < msg.content.length && msg.content[i]?.type === "thinking"; i++) {
        const t = msg.content[i]?.thinking;
        if (typeof t === "string" && t.trim()) blocks.push(t);
      }
      i--;
      if (blocks.length > 0) {
        runs.push(blocks.join("\n\n"));
      }
    }
  }
  return runs;
}

export function createAssistantPresentation(enabled: () => boolean, palette: () => Theme, original: AssistantMessageComponent["render"]) {
  type Child = { paddingX?: number; theme?: MarkdownTheme; child?: Child; text?: string; setText?(text: string): void; render?(width: number): string[]; invalidate(): void };
  const layouts = new WeakMap<Child, { presentation: string; padding?: number }>();
  const seen = new Set<WeakRef<Child>>();
  const markdownThemes = new WeakMap<MarkdownTheme, MarkdownTheme>();
  let expandedThinking = new WeakMap<AssistantMessageComponent, Set<number>>();
  let mouseLayouts = new WeakMap<AssistantMessageComponent, { width: number; rows: Array<{ at: number; thinking: boolean } | undefined>; thinkingRuns: Array<number | undefined> }>();
  function omtAssistantRender(this: AssistantMessageComponent, width: number): string[] {
    const isEnabled = enabled();
    const activeTheme = getActiveTheme();
    const signature = isEnabled && width >= 10 && isSignatureTheme(activeTheme);
    const codex = isEnabled && width >= 10 && isCodexTheme(activeTheme);
    const opencode = isEnabled && width >= 10 && isOpenCodeTheme(activeTheme);
    const claude = isEnabled && width >= 10 && isClaudeTheme(activeTheme);
    const presentation = signature ? "signature" : codex ? "codex" : opencode ? "opencode" : claude ? "claude" : "native";
    const host = this as unknown as AssistantHost & { contentContainer?: { children?: Child[] } };
    const children = host.contentContainer?.children;
    mouseLayouts.delete(this);
    if (!Array.isArray(children) || (signature && (!Array.isArray(this.children) || this.children.length !== 1 || this.children[0] !== host.contentContainer))) return original.call(this, width);
    const changed: Array<[Child, number]> = [];
    const themes: Array<[Child, MarkdownTheme]> = [];
    const texts: Array<[Child, string]> = [];
    const renders: Array<{ child: Child; render: Child["render"]; own: boolean }> = [];
    const runByChild = new Map<Child, number>();
    const expanded = expandedThinking.get(this) ?? new Set<number>();
    if (signature) expandedThinking.set(this, expanded);
    const blockKinds = new Map<Child, Omit<SignatureAssistantBlock, "start" | "end">>();
    const thinkingRuns = extractThinkingRuns(host.lastMessage);
    let thinkingRunIdx = 0;
    try {
    for (const outer of children) {
      const child = outer.child ?? outer;
      const isCollapsedThinking = !!(outer.child && !child.theme && typeof child.text === "string" && typeof child.setText === "function");
      const isExpandedThinking = !!(outer.child && child.theme);

      const run = isCollapsedThinking || isExpandedThinking ? thinkingRunIdx++ : undefined;
      const thinkingContent = run === undefined ? "" : thinkingRuns[run] ?? "";
      const ownsThinking = run !== undefined && host.hiddenThinkingLabel === activeTheme.thinking.label;
      const ownsThinkingLabel = isCollapsedThinking && ownsThinking;
      if ((opencode || claude) && ownsThinkingLabel) {
        texts.push([child, child.text!]);
        const active = host.isStreaming && host.lastMessage?.content?.at(-1)?.type === "thinking";
        child.setText?.(
          claude ? claudeThinkingLabel(palette(), !!active)
          : openCodeFg(palette(), "warning", active ? "⋯ Thinking" : "+ Thought")
        );
      }
      // Keep one cell of Signature inset before the two-cell gutter. Set native
      // padding before wrapping, including thinking Text, and restore it afterwards.
      const next = (signature || codex || opencode || claude) && typeof child.paddingX === "number"
        ? (signature ? 1 : Math.min(contentPadding(child.paddingX), Math.floor((width - 2) / 2))) : child.paddingX;
      if (signature && ownsThinking && typeof child.render === "function") {
        // Pi's default expanded Markdown is not the reference default. Present raw
        // thinking as a 160-cell preview, independently of native hide/show flags.
        const theme = palette();
        const opened = expanded.has(run!);
        const display = stripTerminalSequences(thinkingContent).replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
        const body = opened ? signatureFg(theme, "border", theme.italic(display.trim()))
          : signatureThinkingLabel(theme, !!host.isStreaming, display);
        const view = new Text(body, typeof next === "number" ? next : 0, 0);
        renders.push({ child, render: child.render, own: Object.hasOwn(child, "render") });
        child.render = w => view.render(w);
        runByChild.set(outer, run!);
      }
      if (signature) blockKinds.set(outer, {
        kind: isExpandedThinking || ownsThinkingLabel ? "thinking" : !outer.child && child.theme ? "text" : "native",
        padding: typeof next === "number" ? next : 0,
        hasGutter: ownsThinking && !expanded.has(run!),
        boxed: !outer.child && !!child.theme && typeof child.text === "string" && startsPreformatted(child.text),
      });
      const previous = layouts.get(child);
      if (!previous) {
        for (const ref of seen) if (!ref.deref()) seen.delete(ref);
        seen.add(new WeakRef(child));
      }
      // Normal working ticks reuse Pi's Markdown cache; only presentation transitions invalidate.
      if (previous?.presentation !== presentation || previous?.padding !== next) child.invalidate();
      layouts.set(child, { presentation, padding: next });
      if ((signature || codex || opencode || claude) && child.theme && typeof child.theme.codeBlockBorder === "function") {
        const native = child.theme;
        let styled = markdownThemes.get(native);
        if (!styled) {
          styled = { ...native, codeBlockBorder: () => "", codeBlockIndent: "" };
          markdownThemes.set(native, styled);
        }
        themes.push([child, native]);
        child.theme = styled;
      }
      if (typeof child.paddingX === "number" && child.paddingX !== next) {
        changed.push([child, child.paddingX]); child.paddingX = next;
      }
    }
      // Signature adds a two-cell gutter; reserve it before native Markdown wraps.
      const lines = original.call(this, signature ? width - 2 : width);
      if (signature) {
        const blocks: SignatureAssistantBlock[] = [];
        const rowRuns: Array<number | undefined> = [];
        let offset = 0;
        for (const outer of children) {
          if (typeof outer.render !== "function") return lines;
          const height = outer.render(width - 2).length;
          blocks.push({ ...blockKinds.get(outer)!, start: offset, end: offset + height });
          const run = runByChild.get(outer);
          if (run !== undefined) for (let row = offset; row < offset + height; row++) rowRuns[row] = run;
          offset += height;
        }
        // A foreign parent renderer/container may add rows we do not own.
        if (offset !== lines.length) return lines;
        const rows: Array<{ at: number; thinking: boolean } | undefined> = new Array(lines.length);
        for (const block of blocks) {
          if (block.kind === "native") continue;
          let first = true;
          for (let row = block.start; row < block.end; row++) {
            if (!stripTerminalSequences(lines[row]!).trim()) continue;
            if (first) {
              first = false;
              if (!block.hasGutter) rows[row] = { at: block.padding, thinking: block.kind === "thinking" };
            } else if (block.boxed) rows[row] = { at: 0, thinking: false };
          }
        }
        const theme = palette();
        if (!theme) return lines;
        const decorated = signatureAssistant(lines, host, theme, width, { blocks });
        mouseLayouts.set(this, { width, rows, thinkingRuns: rowRuns });
        return decorated;
      }
      const theme = palette();
      if (!theme) return lines;
      if (opencode) return openCodeAssistant(lines, host, theme, width);
      if (codex) return codexAssistant(lines, host, theme, width);
      if (claude) {
        let proseOffset = 0;
        for (const outer of children) {
          if (!outer.child && outer.theme) break;
          proseOffset += outer.render?.(width).length ?? 0;
        }
        return claudeAssistant(lines, host, theme, proseOffset);
      }
      return lines;
    } finally {
      for (const entry of renders) {
        if (entry.own) entry.child.render = entry.render;
        else delete entry.child.render;
      }
      for (const [child, native] of changed) child.paddingX = native;
      for (const [child, native] of themes) child.theme = native;
      for (const [child, native] of texts) child.setText?.(native);
    }
  }
  return { render: omtAssistantRender,
    toggleThinking(component: AssistantMessageComponent, event: TuiMouseEvent): boolean {
      const layout = mouseLayouts.get(component);
      if (!enabled() || !isSignatureTheme(getActiveTheme()) || !layout || event.type !== "click" || event.button !== "left"
        || event.x < 0 || event.x >= layout.width || event.y < 0 || event.y >= layout.rows.length) return false;
      const run = layout.thinkingRuns[event.y];
      if (run === undefined) return false;
      const expanded = expandedThinking.get(component)!;
      if (expanded.has(run)) expanded.delete(run); else expanded.add(run);
      component.invalidate();
      return true;
    },
    mapMouse(component: AssistantMessageComponent, event: TuiMouseEvent): TuiMouseEvent | undefined {
      const layout = mouseLayouts.get(component);
      if (!enabled() || !isSignatureTheme(getActiveTheme()) || !layout) return event;
      if (event.y < 0 || event.y >= layout.rows.length || event.x < 0 || event.x >= layout.width) return;
      if (layout.thinkingRuns[event.y] !== undefined) return;
      const gutter = layout.rows[event.y];
      if (!gutter || event.x < gutter.at) return event;
      if (event.x < gutter.at + 2) return gutter.thinking ? { ...event, x: gutter.at } : undefined;
      return { ...event, x: event.x - 2 };
    },
    invalidate() {
    mouseLayouts = new WeakMap();
    expandedThinking = new WeakMap();
    for (const ref of seen) ref.deref()?.invalidate();
    seen.clear();
  } };
}

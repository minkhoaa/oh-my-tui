// Native render/cache ownership boundary. Preset layouts and attribution live in presets/.
import { UserMessageComponent, InteractiveMode, type Theme } from "@earendil-works/pi-coding-agent";
import { getActiveTheme } from "../../core/theme.ts";
import { isOpenCodeTheme, isClaudeTheme } from "../../presets/shared/style.ts";
import { userMessageLayout } from "../../presets/shared/user-message.ts";
import { observeAssistantMessages } from "../../core/native-ui.ts";

export const OMT_USER_MESSAGE_OWNER = Symbol.for("oh-my-tui.user-message-owner");

export interface UserMessageControl {
  on(): string;
  off(): string;
  isEnabled(): boolean;
  applyTheme?(): void;
  cleanup?(): void;
}

type MarkdownChild = { paddingX: number; defaultTextStyle?: { color?: (text: string) => string; bgColor?: (text: string) => string }; invalidate(): void };

/** Native Pi owns Markdown, panel colors, vertical padding and zones. */
export function createUserMessageControl(palette: () => Theme = () =>
  (InteractiveMode.prototype as unknown as { createExtensionUIContext(): { theme: Theme } }).createExtensionUIContext.call({}).theme,
): UserMessageControl {
  const target = UserMessageComponent?.prototype;
  if (typeof target?.render !== "function") {
    const unavailable = () => "OMT user messages unavailable: native user message render API required.";
    return { on: unavailable, off: unavailable, isEnabled: () => false };
  }
  const original = target.render;
  const owned = target as unknown as Record<symbol, unknown>;
  if (owned[OMT_USER_MESSAGE_OWNER] || original.name !== "render" || !original.toString().includes("super.render(")) {
    const inactive = () => "OMT user messages inactive: another extension owns the user message renderer.";
    return { on: inactive, off: inactive, isEnabled: () => false };
  }
  let enabled = true;
  const restoreAssistant = observeAssistantMessages(() => enabled, palette);
  const padding = new WeakMap<MarkdownChild, number>();
  const surfaces = new WeakMap<MarkdownChild, string>();
  const children = new Set<WeakRef<MarkdownChild>>();
  function invalidateAll() {
    for (const ref of children) {
      const child = ref.deref();
      if (child) child.invalidate();
      else children.delete(ref);
    }
  }

  function omtUserMessageRender(this: UserMessageComponent, width: number): string[] {
    const child = this.children?.[0] as unknown as MarkdownChild | undefined;
    if (!Array.isArray(this.children) || this.children.length !== 1 || typeof child?.paddingX !== "number" || typeof child.invalidate !== "function") {
      return original.call(this, width);
    }
    const native = child.paddingX;
    const layout = userMessageLayout(width, native, palette, enabled);
    const next = layout.padding;
    if (!padding.has(child)) {
      for (const ref of children) {
        if (!ref.deref()) children.delete(ref);
      }
      children.add(new WeakRef(child));
    }
    if (padding.get(child) !== next) child.invalidate();
    padding.set(child, next);
    child.paddingX = next;
    if (surfaces.get(child) !== layout.key) child.invalidate();
    surfaces.set(child, layout.key);
    const style = child.defaultTextStyle;
    if (layout.style) child.defaultTextStyle = layout.style;
    try {
      const lines = original.call(this, layout.width);
      return layout.decorate?.(lines) ?? lines;
    } finally {
      child.paddingX = native;
      child.defaultTextStyle = style;
    }
  }
  target.render = omtUserMessageRender;
  owned[OMT_USER_MESSAGE_OWNER] = omtUserMessageRender;

  return {
    on() {
      if (target.render !== omtUserMessageRender) return "OMT user messages inactive: another extension owns the user message renderer.";
      enabled = true;
      invalidateAll();
      const active = getActiveTheme();
      if (active.id === "native") return "OMT user messages on (native presentation).";
      if (isClaudeTheme(active)) return "OMT user messages on (Claude prompt surfaces).";
      return isOpenCodeTheme(active) ? "OMT user messages on (rail panels)." : "OMT user messages on (native theme background).";
    },
    off() {
      enabled = false;
      invalidateAll();
      return "OMT user messages off (native rendering).";
    },
    isEnabled(): boolean {
      return enabled;
    },
    applyTheme() {
      invalidateAll();
    },
    cleanup() {
      enabled = false;
      invalidateAll();
      children.clear();
      restoreAssistant?.();
      if (target.render === omtUserMessageRender) target.render = original;
      if (owned[OMT_USER_MESSAGE_OWNER] === omtUserMessageRender) delete owned[OMT_USER_MESSAGE_OWNER];
    },
  };
}

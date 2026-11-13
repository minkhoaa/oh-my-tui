import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { getActiveTheme } from "../../core/theme.ts";
import type { ThemePreset } from "./types.ts";
import { codexPanel } from "../codex-inspired/rendering.ts";
import { openCodeBg } from "../opencode-inspired/rendering.ts";
import { accessibilityStore, asciiBorder } from "../../features/accessibility/model.ts";

export function isCodexTheme(preset: ThemePreset = getActiveTheme()): boolean {
  return preset.id === "codex-inspired" || (preset.id as string) === "codex";
}

export function isClaudeTheme(preset: ThemePreset = getActiveTheme()): boolean {
  return preset.id === "claude-code-inspired";
}

export function isOpenCodeTheme(preset: ThemePreset = getActiveTheme()): boolean {
  return preset.id === "opencode-inspired";
}

export function isSignatureTheme(preset: ThemePreset = getActiveTheme()): boolean {
  return preset.id === "omt-signature" || (preset.id as string) === "signature" || (preset.id as string) === "omt";
}

/** Theme style proxy delegating to the active preset. */
export const omtStyle = {
  get color() { return getActiveTheme().color; },
  get spacing() { return getActiveTheme().spacing; },
  get glyph() { return getActiveTheme().glyph; },
  get thinking() { return getActiveTheme().thinking; },
  get editor() { return getActiveTheme().editor; },
  minWidth: 10,
};

/** Honor larger native output padding, but keep the shared content column. */
export function contentPadding(native = 1): number {
  return Math.max(getActiveTheme().spacing.content, Number.isFinite(native) ? Math.floor(native) : 1);
}

export function quiet(theme: Theme, text: string): string {
  return theme.fg(getActiveTheme().color.quiet, text);
}

export function panel(theme: Theme, text: string): string {
  const active = getActiveTheme();
  if (!active.panelBg) return text;
  if (isCodexTheme(active)) return codexPanel(theme, text);
  if (isOpenCodeTheme(active)) return openCodeBg(theme, "element", text);
  return theme.bg(active.color.panel, text);
}

export type ObservableAgentState = "thinking" | "streaming" | "executing" | "completed" | "interrupted" | "error";

/** Resolve the appropriate state glyph for any observable agent or tool state. */
export function getStateGlyph(
  state: ObservableAgentState | "running" | "success" | "failure",
  preset: ThemePreset = getActiveTheme(),
): string {
  switch (state) {
    case "thinking":
      return preset.thinking.indicator;
    case "streaming":
    case "executing":
    case "running":
      return preset.glyph.running;
    case "completed":
    case "success":
      return preset.glyph.success;
    case "interrupted":
      return preset.glyph.interrupted;
    case "error":
    case "failure":
      return preset.glyph.failure;
  }
}

/** Resolve the semantic theme color for any observable agent or tool state. */
export function getStateColor(
  state: ObservableAgentState | "running" | "success" | "failure",
  preset: ThemePreset = getActiveTheme(),
): ThemeColor {
  switch (state) {
    case "thinking":
    case "streaming":
    case "executing":
    case "running":
      return preset.color.secondary;
    case "completed":
    case "success":
      return preset.color.success;
    case "interrupted":
      return preset.color.warning;
    case "error":
    case "failure":
      return preset.color.error;
  }
}

/**
 * Returns a unified border formatter for all OMT dialogs and overlays,
 * adhering to the active preset border color and respecting ASCII border mode.
 */
export function getBorderStyler(theme: Theme): (s: string) => string {
  return (s: string) => {
    const palette = getActiveTheme();
    const styled = theme && typeof theme.fg === "function" ? theme.fg(palette.color.border, s) : s;
    return accessibilityStore.isPlainTextAsciiBorders() ? asciiBorder(styled) : styled;
  };
}

import type { ThemePreset } from "../shared/types.ts";

export const railPreset: ThemePreset = {
  id: "omt-rail",
  label: "OMT Rail",
  color: {
    text: "text",
    secondary: "muted",
    quiet: "dim",
    prompt: "accent",
    panel: "userMessageBg",
    success: "success",
    warning: "warning",
    error: "error",
    border: "border",
  },
  spacing: { content: 5, inset: 2, gap: "  ", separator: " · " },
  glyph: { prompt: "", running: "⋯", success: "→", failure: "→", interrupted: "→", branch: "" },
  thinking: { indicator: "⋯", label: "+ Thought" },
  editor: { frame: "blank" },
  panelBg: true,
};

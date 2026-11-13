import type { ThemePreset } from "../shared/types.ts";

export const emberPreset: ThemePreset = {
  id: "omt-ember",
  label: "OMT Ember",
  color: {
    text: "text",
    secondary: "muted",
    quiet: "dim",
    prompt: "accent",
    panel: "userMessageBg",
    success: "success",
    warning: "warning",
    error: "error",
    border: "dim",
  },
  spacing: { content: 2, inset: 0, gap: "  ", separator: " · " },
  glyph: { prompt: "❯", running: "●", success: "●", failure: "●", interrupted: "●", branch: "" },
  thinking: { indicator: "●", label: "∴ Thought" },
  editor: { frame: "line" },
  panelBg: false,
};

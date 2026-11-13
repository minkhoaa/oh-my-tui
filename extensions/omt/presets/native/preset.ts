import type { ThemePreset } from "../shared/types.ts";

export const nativePreset: ThemePreset = {
  id: "native",
  label: "Native Pi",
  color: {
    text: "text",
    secondary: "muted",
    quiet: "dim",
    prompt: "muted",
    panel: "userMessageBg",
    success: "success",
    warning: "warning",
    error: "error",
    border: "border",
  },
  spacing: { content: 1, inset: 0, gap: "  ", separator: " · " },
  glyph: { prompt: "", running: "●", success: "✔", failure: "✖", interrupted: "■", branch: "⎇ " },
  thinking: { indicator: "●", label: "Thinking..." },
  editor: { frame: "native" },
  panelBg: false,
};

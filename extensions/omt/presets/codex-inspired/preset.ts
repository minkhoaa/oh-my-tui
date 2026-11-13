import type { ThemePreset } from "../shared/types.ts";

export const codexPreset: ThemePreset = {
  id: "codex-inspired",
  label: "Codex Inspired",
  color: {
    text: "text",
    secondary: "muted",
    quiet: "dim",
    prompt: "muted",
    panel: "userMessageBg",
    success: "success",
    warning: "warning",
    error: "error",
    border: "dim",
  },
  spacing: { content: 2, inset: 0, gap: "  ", separator: " · " },
  glyph: { prompt: "›", running: "•", success: "•", failure: "•", interrupted: "•", branch: "" },
  thinking: { indicator: "•", label: "Reasoning" },
  editor: { frame: "blank" },
  panelBg: true,
};

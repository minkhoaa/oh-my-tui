import type { ThemePreset } from "../shared/types.ts";

export const claudePreset: ThemePreset = {
  id: "claude-code-inspired",
  label: "Claude Code Inspired",
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

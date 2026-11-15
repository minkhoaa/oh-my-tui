import type { ThemePreset } from "../shared/types.ts";

export const obsidianPreset: ThemePreset = {
  id: "omt-obsidian",
  label: "OMT Obsidian Studio",
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
  spacing: { content: 2, inset: 0, gap: "  ", separator: " ⌁ " },
  glyph: {
    prompt: "❯",
    running: "✦",
    success: "✔",
    failure: "✖",
    interrupted: "■",
    branch: "⎇ ",
  },
  thinking: {
    indicator: "✦",
    label: "Thinking",
  },
  editor: { frame: "line" },
  panelBg: false,
};

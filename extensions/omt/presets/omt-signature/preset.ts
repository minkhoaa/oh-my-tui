import type { ThemePreset } from "../shared/types.ts";

export const signaturePreset: ThemePreset = {
  id: "omt-signature",
  label: "OMT Signature",
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
  spacing: { content: 2, inset: 0, gap: "  ", separator: " ◈ " },
  glyph: {
    prompt: "◈",
    running: "◈",
    success: "✔",
    failure: "✖",
    interrupted: "■",
    branch: "⎇ ",
  },
  thinking: {
    indicator: "◈",
    label: "Reasoning",
  },
  editor: { frame: "line" },
  panelBg: false,
};

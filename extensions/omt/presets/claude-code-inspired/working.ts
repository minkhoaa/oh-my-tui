import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { claudeFg } from "./rendering.ts";

/** Ticks ~112ms, ~2s breath: endpoints linger. */
export const CLAUDE_FRAME_MS = 112;
export const CLAUDE_FRAMES = ["·", "·", "·", "·", "✢", "*", "✶", "✻", "✻", "✽", "✽", "✽", "✽", "✻", "✶", "*", "✢", "✢"] as const;
export function claudeSpinner(elapsed: number, animated = true): string {
  return animated ? CLAUDE_FRAMES[Math.floor(Math.max(0, elapsed) / CLAUDE_FRAME_MS) % CLAUDE_FRAMES.length]! : "●";
}
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function claudeWorkingLine(theme: Theme, elapsed: number, phase: string, key: string, width: number, animated = true): string {
  // Use observed Pi phases instead of Claude's randomly selected verbs/token counters.
  const label = phase === "Thinking" ? "Thinking…" : phase === "Streaming" ? "Streaming…" : phase === "Preparing tools" ? "Preparing tools…" : phase === "Running tools" ? "Running tools…" : "Working…";
  const position = Math.max(0, elapsed) / 90 % (visibleWidth(label) + 8) - 4;
  let column = 0;
  const text = [...graphemes.segment(label)].map(({ segment }) => {
    const shimmer = animated && Math.abs(column - position) < 1.5;
    column += visibleWidth(segment);
    return claudeFg(theme, shimmer ? "shimmer" : "accent", segment);
  }).join("");
  // Delays the elapsed suffix; no estimates, generated thoughts or token counts.
  const seconds = Math.max(0, Math.floor(elapsed / 1000));
  const elapsedText = seconds >= 2 ? claudeFg(theme, "muted", ` (${seconds}s)`) : "";
  const interrupt = key ? claudeFg(theme, "muted", ` · ${key} to interrupt`) : "";
  return truncateToWidth(claudeFg(theme, "accent", claudeSpinner(elapsed, animated) + " ") + text + elapsedText + interrupt, Math.max(0, width), "…");
}

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { emberFg } from "./rendering.ts";

/** Ticks ~112ms, ~2s breath: endpoints linger. */
export const EMBER_FRAME_MS = 112;
export const EMBER_FRAMES = ["·", "·", "·", "·", "✢", "*", "✶", "✻", "✻", "✽", "✽", "✽", "✽", "✻", "✶", "*", "✢", "✢"] as const;
export function emberSpinner(elapsed: number, animated = true): string {
  return animated ? EMBER_FRAMES[Math.floor(Math.max(0, elapsed) / EMBER_FRAME_MS) % EMBER_FRAMES.length]! : "●";
}
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function emberWorkingLine(theme: Theme, elapsed: number, phase: string, key: string, width: number, animated = true): string {
  // Use observed Pi phases instead of Ember's randomly selected verbs/token counters.
  const label = phase === "Thinking" ? "Thinking…" : phase === "Streaming" ? "Streaming…" : phase === "Preparing tools" ? "Preparing tools…" : phase === "Running tools" ? "Running tools…" : "Working…";
  const position = Math.max(0, elapsed) / 90 % (visibleWidth(label) + 8) - 4;
  let column = 0;
  const text = [...graphemes.segment(label)].map(({ segment }) => {
    const shimmer = animated && Math.abs(column - position) < 1.5;
    column += visibleWidth(segment);
    return emberFg(theme, shimmer ? "shimmer" : "accent", segment);
  }).join("");
  // Delays the elapsed suffix; no estimates, generated thoughts or token counts.
  const seconds = Math.max(0, Math.floor(elapsed / 1000));
  const elapsedText = seconds >= 2 ? emberFg(theme, "muted", ` (${seconds}s)`) : "";
  const interrupt = key ? emberFg(theme, "muted", ` · ${key} to interrupt`) : "";
  return truncateToWidth(emberFg(theme, "accent", emberSpinner(elapsed, animated) + " ") + text + elapsedText + interrupt, Math.max(0, width), "…");
}

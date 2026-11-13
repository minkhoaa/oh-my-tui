import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { signatureFg } from "../../presets/omt-signature/rendering.ts";
import { TOAST_TTL_MS, type ToastItem } from "./toast-model.ts";

/** One clipped row per toast, no transcript/layout mutation. */
export function renderToastStack(items: readonly ToastItem[], theme: Theme, width: number, now = Date.now()): string[] {
  if (!items.length || width < 10) return [];
  const inner = width - 2;
  const border = (s: string) => signatureFg(theme, "border", s);
  const rows = [border(`╭${"─".repeat(inner)}╮`)];
  for (const item of items) {
    const seconds = Math.max(1, Math.ceil((TOAST_TTL_MS - (now - item.at)) / 1000));
    const tag = inner < 10 ? ` ${seconds}s` : ` · ${seconds}s`;
    const budget = Math.max(0, inner - 4 - visibleWidth(tag));
    const clean = stripTerminalSequences(item.message).replace(/[\r\n\t]+/g, " ").replace(/[\x00-\x1f\x7f-\x9f]/g, "");
    const body = truncateToWidth(clean, budget, "…");
    const icon = signatureFg(theme, item.type === "error" ? "red" : "green", item.type === "error" ? "× " : "● ");
    const content = icon + signatureFg(theme, item.type === "error" ? "red" : "muted", body) + signatureFg(theme, "muted", tag);
    rows.push(border("│") + " " + content + " ".repeat(Math.max(0, inner - 1 - visibleWidth(content))) + border("│"));
  }
  rows.push(border(`╰${"─".repeat(inner)}╯`));
  return rows;
}

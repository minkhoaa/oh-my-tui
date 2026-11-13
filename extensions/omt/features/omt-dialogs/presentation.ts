import type { Theme } from "@earendil-works/pi-coding-agent";
import { rgbColor } from "@earendil-works/pi-tui";
import { signatureBg, signatureFg } from "../../presets/omt-signature/rendering.ts";
import { fit } from "./model.ts";

/** Paint the entire cell-width row, including
 * padding, and reopen the containing style after a nested dot/description reset.
 * Presentation only: selection and native focus/operations stay with the caller.
 */
export function dialogSwatch(theme: Theme, hex: string | undefined): string {
  if (!hex || typeof theme.style !== "function" || !/^#[\da-f]{6}$/i.test(hex)) return "  ";
  const mode = theme.getColorMode?.() as string | undefined;
  if (mode === "monochrome" || mode === "16color") return "  ";
  return theme.style("  ", { bg: rgbColor(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)) });
}

export function selectedDialogRow(theme: Theme, content: string, width: number, focused = true): string {
  const padded = fit(content, width);
  if (typeof theme.style !== "function") return theme.bold?.(padded) ?? padded;
  const paint = (text: string) => signatureBg(theme, "hiBg",
    theme.bold(signatureFg(theme, focused ? "hiFg" : "accent", text)));
  const marker = "\u2063";
  const [prefix, suffix] = paint(marker).split(marker);
  return prefix + padded.replace(/\x1b\[(?:0|22|39|49)?m/g, reset => reset + prefix) + suffix;
}

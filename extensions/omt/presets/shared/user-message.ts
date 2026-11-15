import type { Theme } from "@earendil-works/pi-coding-agent";
import { contentPadding, isCleanTheme, isRailTheme, isEmberTheme, isSignatureTheme, isObsidianTheme, omtStyle } from "./style.ts";
import { getActiveTheme } from "../../core/theme.ts";
import { emberUserMessage } from "../omt-ember/user-message.ts";
import { cleanUserMessage } from "../omt-clean/user-message.ts";
import { railUserMessage } from "../omt-rail/user-message.ts";
import { signatureUserMessage } from "../omt-signature/user-message.ts";
import { obsidianUserMessage } from "../omt-obsidian/user-message.ts";

export interface UserMessageLayout {
  padding: number;
  width: number;
  key: string;
  style?: { color?: (text: string) => string; bgColor?: (text: string) => string };
  decorate?: (lines: string[]) => string[];
}
export function userMessageLayout(width: number, native: number, palette: () => Theme, enabled: boolean): UserMessageLayout {
  if (!enabled || getActiveTheme().id === "native" || width < omtStyle.minWidth) return { padding: native, width, key: "native" };
  if (isObsidianTheme()) return obsidianUserMessage(width, native, palette());
  if (isSignatureTheme()) return signatureUserMessage(width, native, palette());
  if (isCleanTheme()) return cleanUserMessage(width, native, palette());
  if (isRailTheme()) return railUserMessage(width, native, palette());
  if (isEmberTheme()) return emberUserMessage(width, native, palette());
  return { padding: Math.min(contentPadding(native), Math.floor((width - 2) / 2)), width, key: "native" };
}

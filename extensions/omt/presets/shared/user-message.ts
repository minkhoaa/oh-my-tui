import type { Theme } from "@earendil-works/pi-coding-agent";
import { contentPadding, isCodexTheme, isOpenCodeTheme, isClaudeTheme, isSignatureTheme, omtStyle } from "./style.ts";
import { getActiveTheme } from "../../core/theme.ts";
import { claudeUserMessage } from "../claude-code-inspired/user-message.ts";
import { codexUserMessage } from "../codex-inspired/user-message.ts";
import { openCodeUserMessage } from "../opencode-inspired/user-message.ts";
import { signatureUserMessage } from "../omt-signature/user-message.ts";

export interface UserMessageLayout {
  padding: number;
  width: number;
  key: string;
  style?: { color?: (text: string) => string; bgColor?: (text: string) => string };
  decorate?: (lines: string[]) => string[];
}
export function userMessageLayout(width: number, native: number, palette: () => Theme, enabled: boolean): UserMessageLayout {
  if (!enabled || getActiveTheme().id === "native" || width < omtStyle.minWidth) return { padding: native, width, key: "native" };
  if (isSignatureTheme()) return signatureUserMessage(width, native, palette());
  if (isCodexTheme()) return codexUserMessage(width, native, palette());
  if (isOpenCodeTheme()) return openCodeUserMessage(width, native, palette());
  if (isClaudeTheme()) return claudeUserMessage(width, native, palette());
  return { padding: Math.min(contentPadding(native), Math.floor((width - 2) / 2)), width, key: "native" };
}

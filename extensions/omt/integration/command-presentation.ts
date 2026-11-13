import { getActiveTheme } from "../core/theme.ts";

/** Route bare Signature picker requests through Pi's existing /omt handler.
 * Text, command arguments, templates, third-party commands and native keys pass unchanged.
 */
export function signatureCommandPresentation(pi: { getCommands?: () => readonly { name: string }[] }, text: string): string {
  if (getActiveTheme().id !== "omt-signature" || typeof pi.getCommands !== "function") return text;
  const match = /^\/(settings|model|resume|tree|trajectory|theme|pet)\s*$/.exec(text);
  if (!match || pi.getCommands().some(command => command.name === match[1])) return text;
  return `/omt ${match[1]}`;
}

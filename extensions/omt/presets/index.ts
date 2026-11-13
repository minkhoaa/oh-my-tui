import { signaturePreset } from "./omt-signature/preset.ts";
import { codexPreset } from "./codex-inspired/preset.ts";
import { claudePreset } from "./claude-code-inspired/preset.ts";
import { opencodePreset } from "./opencode-inspired/preset.ts";
import { minimalPreset } from "./minimal/preset.ts";
import { nativePreset } from "./native/preset.ts";
import { signatureBackgroundPalette, SIGNATURE_BACKGROUND_DEFAULTS } from "./omt-signature/background.ts";
import { codexBackgroundPalette, CODEX_BACKGROUND_DEFAULTS } from "./codex-inspired/background.ts";
import { claudeBackgroundPalette, CLAUDE_BACKGROUND_DEFAULTS } from "./claude-code-inspired/background.ts";
import { opencodeBackgroundPalette, OPENCODE_BACKGROUND_DEFAULTS } from "./opencode-inspired/background.ts";
import { minimalBackgroundPalette, MINIMAL_BACKGROUND_DEFAULTS } from "./minimal/background.ts";
import { nativeBackgroundPalette, NATIVE_BACKGROUND_DEFAULTS } from "./native/background.ts";
import type { PresetBackgroundPalette } from "../features/backgrounds/scenes/index.ts";
import type { ThemeName, ThemePreset } from "./shared/types.ts";

export type { ThemeName, ThemePreset } from "./shared/types.ts";
export {
  signaturePreset,
  codexPreset,
  codexPreset as codexInspiredPreset,
  claudePreset,
  opencodePreset,
  minimalPreset,
  nativePreset,
  signatureBackgroundPalette,
  codexBackgroundPalette,
  claudeBackgroundPalette,
  opencodeBackgroundPalette,
  minimalBackgroundPalette,
  nativeBackgroundPalette,
  SIGNATURE_BACKGROUND_DEFAULTS,
  CODEX_BACKGROUND_DEFAULTS,
  CLAUDE_BACKGROUND_DEFAULTS,
  OPENCODE_BACKGROUND_DEFAULTS,
  MINIMAL_BACKGROUND_DEFAULTS,
  NATIVE_BACKGROUND_DEFAULTS,
};
export const THEME_NAMES: readonly ThemeName[] = [
  "omt-signature",
  "codex-inspired",
  "claude-code-inspired",
  "opencode-inspired",
  "minimal",
  "native",
];
export const THEME_ALIASES: Readonly<Record<string, ThemeName>> = {
  omt: "omt-signature",
  signature: "omt-signature",
  codex: "codex-inspired",
  claude: "claude-code-inspired",
  opencode: "opencode-inspired",
};
export const THEME_PRESETS: Readonly<
  Record<ThemeName, ThemePreset> & {
    omt: ThemePreset;
    signature: ThemePreset;
    codex: ThemePreset;
    claude: ThemePreset;
    opencode: ThemePreset;
  } & Record<string, ThemePreset | undefined>
> = {
  "omt-signature": signaturePreset,
  omt: signaturePreset,
  signature: signaturePreset,
  "codex-inspired": codexPreset,
  codex: codexPreset,
  "claude-code-inspired": claudePreset,
  claude: claudePreset,
  "opencode-inspired": opencodePreset,
  opencode: opencodePreset,
  minimal: minimalPreset,
  native: nativePreset,
};

export const PRESET_BACKGROUND_PALETTES: Readonly<Record<ThemeName, PresetBackgroundPalette>> = Object.freeze({
  "omt-signature": signatureBackgroundPalette,
  "codex-inspired": codexBackgroundPalette,
  "claude-code-inspired": claudeBackgroundPalette,
  "opencode-inspired": opencodeBackgroundPalette,
  minimal: minimalBackgroundPalette,
  native: nativeBackgroundPalette,
});

export function getPresetBackgroundPalette(name: string): PresetBackgroundPalette {
  const resolved = resolveThemeName(name);
  if (resolved && PRESET_BACKGROUND_PALETTES[resolved]) {
    return PRESET_BACKGROUND_PALETTES[resolved];
  }
  return signatureBackgroundPalette;
}

export function getPresetBackgroundDefaults(name: string) {
  const resolved = resolveThemeName(name);
  switch (resolved) {
    case "omt-signature":
      return SIGNATURE_BACKGROUND_DEFAULTS;
    case "codex-inspired":
      return CODEX_BACKGROUND_DEFAULTS;
    case "claude-code-inspired":
      return CLAUDE_BACKGROUND_DEFAULTS;
    case "opencode-inspired":
      return OPENCODE_BACKGROUND_DEFAULTS;
    case "minimal":
      return MINIMAL_BACKGROUND_DEFAULTS;
    case "native":
      return NATIVE_BACKGROUND_DEFAULTS;
    default:
      return SIGNATURE_BACKGROUND_DEFAULTS;
  }
}

export function resolveThemeName(name: string): ThemeName | undefined {
  if (THEME_NAMES.includes(name as ThemeName)) return name as ThemeName;
  return Object.hasOwn(THEME_ALIASES, name) ? THEME_ALIASES[name] : undefined;
}

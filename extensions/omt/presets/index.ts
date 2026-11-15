import { signaturePreset } from "./omt-signature/preset.ts";
import { obsidianPreset } from "./omt-obsidian/preset.ts";
import { cleanPreset } from "./omt-clean/preset.ts";
import { emberPreset } from "./omt-ember/preset.ts";
import { railPreset } from "./omt-rail/preset.ts";
import { minimalPreset } from "./minimal/preset.ts";
import { nativePreset } from "./native/preset.ts";
import { signatureBackgroundPalette, SIGNATURE_BACKGROUND_DEFAULTS } from "./omt-signature/background.ts";
import { obsidianBackgroundPalette, OBSIDIAN_BACKGROUND_DEFAULTS } from "./omt-obsidian/background.ts";
import { cleanBackgroundPalette, CLEAN_BACKGROUND_DEFAULTS } from "./omt-clean/background.ts";
import { emberBackgroundPalette, EMBER_BACKGROUND_DEFAULTS } from "./omt-ember/background.ts";
import { railBackgroundPalette, RAIL_BACKGROUND_DEFAULTS } from "./omt-rail/background.ts";
import { minimalBackgroundPalette, MINIMAL_BACKGROUND_DEFAULTS } from "./minimal/background.ts";
import { nativeBackgroundPalette, NATIVE_BACKGROUND_DEFAULTS } from "./native/background.ts";
import type { PresetBackgroundPalette } from "../features/backgrounds/scenes/index.ts";
import type { ThemeName, ThemePreset } from "./shared/types.ts";

export type { ThemeName, ThemePreset } from "./shared/types.ts";
export {
  signaturePreset,
  obsidianPreset,
  cleanPreset,
  emberPreset,
  railPreset,
  minimalPreset,
  nativePreset,
  signatureBackgroundPalette,
  obsidianBackgroundPalette,
  cleanBackgroundPalette,
  emberBackgroundPalette,
  railBackgroundPalette,
  minimalBackgroundPalette,
  nativeBackgroundPalette,
  SIGNATURE_BACKGROUND_DEFAULTS,
  OBSIDIAN_BACKGROUND_DEFAULTS,
  CLEAN_BACKGROUND_DEFAULTS,
  EMBER_BACKGROUND_DEFAULTS,
  RAIL_BACKGROUND_DEFAULTS,
  MINIMAL_BACKGROUND_DEFAULTS,
  NATIVE_BACKGROUND_DEFAULTS,
};
export const THEME_NAMES: readonly ThemeName[] = [
  "omt-signature",
  "omt-obsidian",
  "omt-clean",
  "omt-ember",
  "omt-rail",
  "minimal",
  "native",
];
export const THEME_ALIASES: Readonly<Record<string, ThemeName>> = {
  omt: "omt-signature",
  signature: "omt-signature",
  obsidian: "omt-obsidian",
  clean: "omt-clean",
  ember: "omt-ember",
  rail: "omt-rail",
};
export const THEME_PRESETS: Readonly<
  Record<ThemeName, ThemePreset> & {
    omt: ThemePreset;
    signature: ThemePreset;
    obsidian: ThemePreset;
    clean: ThemePreset;
    ember: ThemePreset;
    rail: ThemePreset;
  } & Record<string, ThemePreset | undefined>
> = {
  "omt-signature": signaturePreset,
  omt: signaturePreset,
  signature: signaturePreset,
  "omt-obsidian": obsidianPreset,
  obsidian: obsidianPreset,
  "omt-clean": cleanPreset,
  clean: cleanPreset,
  "omt-ember": emberPreset,
  ember: emberPreset,
  "omt-rail": railPreset,
  rail: railPreset,
  minimal: minimalPreset,
  native: nativePreset,
};

export const PRESET_BACKGROUND_PALETTES: Readonly<Record<ThemeName, PresetBackgroundPalette>> = Object.freeze({
  "omt-signature": signatureBackgroundPalette,
  "omt-obsidian": obsidianBackgroundPalette,
  "omt-clean": cleanBackgroundPalette,
  "omt-ember": emberBackgroundPalette,
  "omt-rail": railBackgroundPalette,
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
    case "omt-obsidian":
      return OBSIDIAN_BACKGROUND_DEFAULTS;
    case "omt-clean":
      return CLEAN_BACKGROUND_DEFAULTS;
    case "omt-ember":
      return EMBER_BACKGROUND_DEFAULTS;
    case "omt-rail":
      return RAIL_BACKGROUND_DEFAULTS;
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

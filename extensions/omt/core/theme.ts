import { signaturePreset, resolveThemeName, THEME_PRESETS, type ThemeName, type ThemePreset } from "../presets/index.ts";
import { configStore } from "./config.ts";

// The active-preset state. Controls retain their independent enable flags.
let activeTheme: ThemePreset = signaturePreset;
export function getActiveTheme(): ThemePreset { return activeTheme; }
export function setActiveTheme(name: ThemeName | string): ThemePreset {
  const resolved = resolveThemeName(name);
  const preset = resolved ? THEME_PRESETS[resolved] : undefined;
  if (!preset) throw new Error(`Unknown theme preset: ${name}`);
  activeTheme = preset;
  if (configStore.getPreset() !== resolved) {
    configStore.setPresetOverride(resolved);
  }
  return activeTheme;
}
export function resetActiveTheme(): void {
  activeTheme = signaturePreset;
  configStore.clearSessionOverrides();
}

import { configStore, type ConfigStore } from "../core/config.ts";
import { getBackgroundNames, isValidPaletteName } from "../presets/omt-signature/palette.ts";

/** Palette browsing persists; surface browsing is RAM-only.
 * Esc closes without rolling either appearance back. Enter persists a surface.
 * These are appearance preferences, never OMT preset IDs or animated scenes.
 */
export function createSignatureAppearanceActions(
  repaint: () => void,
  store: ConfigStore = configStore,
  automaticPalette = "default",
) {
  let active = true;
  const initial = store.getSignature();
  function persist(key: "palette" | "surface", value: string): boolean {
    if (!active || (key === "palette" ? !isValidPaletteName(value) : !getBackgroundNames().includes(value))) return false;
    if (!store.setSignatureDefault(key, value)) return false;
    store.setSignatureOverride(key, undefined);
    repaint();
    return true;
  }
  const palette = (value: string) => persist("palette", value);
  return {
    currentTheme: initial.palette === "auto" ? automaticPalette : initial.palette,
    currentBackground: initial.surface,
    onPreviewTheme: palette,
    onSelectTheme: palette,
    onPreviewBackground(value: string): boolean {
      if (!active || !getBackgroundNames().includes(value)) return false;
      store.setSignatureOverride("surface", value);
      repaint();
      return true;
    },
    onSelectBackground: (value: string) => persist("surface", value),
    onCancelTheme() { /* Source keeps the last browsed appearance. */ },
    dispose() { active = false; },
  };
}

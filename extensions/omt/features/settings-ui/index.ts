import { Container, SettingsList, type SettingItem, type SettingsListTheme, Text, type Component, type Focusable, matchesKey } from "@earendil-works/pi-tui";
import { DynamicBorder, type Theme, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { THEME_NAMES, getPresetBackgroundPalette, type ThemeName } from "../../presets/index.ts";
import { configStore, DEFAULT_CONFIG, VALID_BACKGROUND_SCENES, type AnimationMode, type BackgroundDimming, type BackgroundIntensity, type BackgroundMode, type BackgroundScene, type ReducedMotionPreference } from "../../core/config.ts";
import { getBorderStyler } from "../../presets/shared/style.ts";
import { renderManagedBackground } from "../backgrounds/managed.ts";
import { backgroundError, type BackgroundFit } from "../backgrounds/assets/index.ts";
import { accessibilityStore } from "../accessibility/model.ts";

export interface SettingsControls {
  editor: { on(ctx: ExtensionContext): string; off(ctx: ExtensionContext): string };
  messages: { on(): string; off(): string };
  tools: { on(): string; off(): string };
  footer: { on(ctx: ExtensionContext): string; off(ctx: ExtensionContext): string };
  thinking: { on(ctx: ExtensionContext): string; off(ctx: ExtensionContext): string; applyTheme(ctx: ExtensionContext): void };
  background?: {
    on(ctx: ExtensionContext): string;
    off(ctx: ExtensionContext): string;
    applyTheme(ctx: ExtensionContext): void;
    setMode(mode: BackgroundMode, ctx?: ExtensionContext): string;
    setScene(scene: BackgroundScene, ctx?: ExtensionContext): string;
    pause?(): void;
    resume?(): void;
  };
  applyTheme(name: string, ctx: ExtensionContext): string;
}

export function createSettingsTheme(theme: Theme): SettingsListTheme {
  return {
    label: (text, selected) => (selected ? theme.bold(theme.fg("accent", text)) : text),
    value: (text, selected) => {
      const friendly = configStore.assets.getFriendlyName(text);
      const display = friendly ?? (text.length === 64 ? `${text.slice(0, 8)}…` : text);
      return (selected ? theme.bold(theme.fg("accent", display)) : theme.fg("muted", display));
    },
    description: (text) => theme.fg("dim", text),
    cursor: theme.fg("accent", "→ "),
    hint: (text) => theme.fg("dim", text),
  };
}

/**
 * Top-level Settings container that implements Focusable and delegates keyboard
 * navigation and control to the internal SettingsList component.
 */
export class SettingsComponent extends Container implements Component, Focusable {
  focused = false;
  readonly capturesViewportInput = true;
  private settingsList: SettingsList;

  constructor(settingsList: SettingsList) {
    super();
    this.settingsList = settingsList;
  }

  handleInput(data: string): void {
    if (data === "q" || data === "Q" || matchesKey(data, "escape")) {
      this.settingsList.handleInput("\x1b");
      return;
    }
    this.settingsList.handleInput(data);
  }

  override handleMouse(event: any): any {
    const res = this.settingsList.handleMouse?.(event);
    if (res?.handled) return res;
    return super.handleMouse(event);
  }
}

export function createSettingsComponent(
  tui: { requestRender(): void },
  theme: Theme,
  _keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  controls: SettingsControls,
) {

  const titleText = new (class extends Text {
    constructor() {
      super("", 0, 0);
    }
    update(width: number) {
      const overrides = configStore.hasAnyOverrides() ? theme.fg("warning", " [session overrides active]") : "";
      this.setText(`${theme.bold(theme.fg("accent", "Oh My TUI Settings"))}${overrides}`);
    }
  })();

  const subtitleText = new (class extends Text {
    constructor() {
      super("", 0, 0);
    }
    update() {
      this.setText(theme.fg("muted", "Arrow keys to navigate · Enter/Space to cycle value · Esc to close"));
    }
  })();

  let perPreset = false;
  const buildItems = (): SettingItem[] => {
    const userAssets = configStore.assets.list();
    const libraryAssets = configStore.assets.listLibrary();
    const allAssets = [...userAssets, ...libraryAssets];
    const effectiveAssetId = configStore.getEffectiveBackgroundAsset();
    const selectedAsset = allAssets.find(a => a.id === effectiveAssetId);
    const assetDesc = selectedAsset
      ? `${selectedAsset.name} (${selectedAsset.alias ?? selectedAsset.kind}) · ${selectedAsset.width}×${selectedAsset.height} · ${selectedAsset.frameCount} frames`
      : "Built-in procedural scenes; select a library wallpaper or import custom assets";
    const preset = configStore.getPreset();
    const anim = configStore.getAnimation();
    const bg = configStore.getBackground();
    const hasOverrides = configStore.hasAnyOverrides();

    return [
      {
        id: "preset",
        label: "Active preset",
        description: `Visual preset (${THEME_NAMES.join(", ")})`,
        currentValue: preset,
        values: [...THEME_NAMES],
      },
      {
        id: "editor",
        label: "Editor component",
        description: "Enhanced input composer with preset styling and geometry",
        currentValue: configStore.isComponentEnabled("editor") ? "on" : "off",
        values: ["on", "off"],
      },
      {
        id: "messages",
        label: "Messages component",
        description: "Enhanced user messages with preset gutters and surfaces",
        currentValue: configStore.isComponentEnabled("messages") ? "on" : "off",
        values: ["on", "off"],
      },
      {
        id: "tools",
        label: "Tools component",
        description: "Enhanced tool execution, diffs, and results",
        currentValue: configStore.isComponentEnabled("tools") ? "on" : "off",
        values: ["on", "off"],
      },
      {
        id: "footer",
        label: "Footer component",
        description: "Single-line responsive statusline",
        currentValue: configStore.isComponentEnabled("footer") ? "on" : "off",
        values: ["on", "off"],
      },
      {
        id: "thinking",
        label: "Thinking component",
        description: "Clean working and thinking indicators with preset motion",
        currentValue: configStore.isComponentEnabled("thinking") ? "on" : "off",
        values: ["on", "off"],
      },
      {
        id: "background-enabled",
        label: "Dynamic background",
        description: "Built-in scenes, imported images, animations and declarative theme packs",
        currentValue: bg.enabled ? "on" : "off",
        values: ["on", "off"],
      },
      {
        id: "background-mode",
        label: "Background mode",
        description: "Rendering mode: off, ambient (subtle backdrop), scene (dedicated art), full (native fullscreen wallpaper; unsupported hosts yield)",
        currentValue: bg.mode,
        values: ["off", "ambient", "scene", "full"],
      },
      {
        id: "background-scene",
        label: "Background scene",
        description: "Procedural animated scene: aurora, starfield, rain, matrix, particles, and curated scenes",
        currentValue: bg.scene,
        values: [...VALID_BACKGROUND_SCENES],
      },
      {
        id: "background-asset", label: "Background picker",
        description: assetDesc,
        currentValue: effectiveAssetId ?? "built-in",
        values: ["built-in", ...userAssets.map(a => a.id), ...libraryAssets.map(a => a.id)],
      },
      { id: "background-assignment", label: "Assign background", description: "Changes are session-only until Save as defaults", currentValue: perPreset ? "this preset" : "global", values: ["global", "this preset"] },
      { id: "background-fit", label: "Image fit", currentValue: bg.fit, values: ["cover", "contain", "center", "tile"] },
      { id: "background-texture-scale", label: "Texture scale", description: "Artwork size only; below 1x makes textures smaller, without changing UI text", currentValue: `${bg.textureScale}x`, values: ["0.25x", "0.5x", "0.75x", "1x", "1.5x", "2x"] },
      { id: "background-opacity", label: "Image brightness", description: "Dimming multiplies this value; foreground remains opaque", currentValue: String(bg.opacity), values: ["0.25", "0.5", "0.75", "1"] },
      { id: "background-contrast", label: "Image contrast", currentValue: String(bg.contrast), values: ["0.5", "0.75", "1", "1.25", "1.5"] },
      { id: "background-readability", label: "Readability", description: "Strict leaves entire foreground-bearing rows untouched", currentValue: bg.readability, values: ["balanced", "strict"] },
      { id: "background-fps", label: "Background FPS cap", currentValue: String(bg.fps), values: ["5", "10", "15", "20", "30"] },
      {
        id: "background-speed",
        label: "Background speed",
        description: "Background animation speed multiplier (0.5x, 1x, 1.5x, 2x)",
        currentValue: `${bg.speed}x`,
        values: ["1x", "1.5x", "2x", "0.5x"],
      },
      {
        id: "background-intensity",
        label: "Background intensity",
        description: "Scene density and amplitude (low, medium, high)",
        currentValue: bg.intensity,
        values: ["low", "medium", "high"],
      },
      {
        id: "background-dimming",
        label: "Background dimming",
        description: "Color contrast and brightness: dim (quiet), subtle (balanced), vibrant (rich)",
        currentValue: bg.dimming,
        values: ["dim", "subtle", "vibrant"],
      },
      { id: "background-playback", label: "Background playback", description: "Freeze/resume without losing playback position; respects reduced motion", currentValue: bg.playing ? "playing" : "paused", values: ["playing", "paused"] },
      {
        id: "background-pause",
        label: "Pause on activity",
        description: "Pause background animation during agent activity to maximize focus",
        currentValue: bg.pauseOnActivity ? "on" : "off",
        values: ["on", "off"],
      },
      {
        id: "animation-mode",
        label: "Animation mode",
        description: "Animation level: full (rich motion), subtle (quiet cadence), off (static)",
        currentValue: anim.mode,
        values: ["full", "subtle", "off"],
      },
      {
        id: "animation-speed",
        label: "Animation speed",
        description: "Motion speed multiplier (0.5x, 1x, 1.5x, 2x)",
        currentValue: `${anim.speed}x`,
        values: ["1x", "1.5x", "2x", "0.5x"],
      },
      {
        id: "reduced-motion",
        label: "Reduced motion",
        description: "Reduced motion preference (auto detects system, reduced disables heavy motion, normal enables)",
        currentValue: anim.reducedMotion,
        values: ["auto", "reduced", "normal"],
      },
      {
        id: "save-defaults",
        label: "Save as defaults",
        description: hasOverrides ? "Save active session overrides to omt.json" : "Current settings match saved defaults in omt.json",
        currentValue: hasOverrides ? "save now" : "saved",
        values: ["save now", "saved"],
      },
      {
        id: "restore-defaults",
        label: "Restore defaults",
        description: "Reset all OMT settings to factory defaults",
        currentValue: "restore",
        values: ["restore"],
      },
    ];
  };

  function applyPreset(name: string) {
    const result = controls.applyTheme(name, ctx);
    if (result.includes("Native fallback:")) ctx.ui.notify(result, "warning");
  }

  const items = buildItems();

  function syncValues() {
    titleText.update(80);
    subtitleText.update();
    const updated = buildItems();
    for (const item of updated) {
      settingsList.updateValue(item.id, item.currentValue);
    }
  }

  const settingsList = new SettingsList(
    items,
    Math.max(3, Math.min(items.length + 1, 22, ((tui as { terminal?: { rows?: number } }).terminal?.rows ?? 40) - 16)),
    createSettingsTheme(theme),
    (id, newValue) => {
      switch (id) {
        case "preset": {
          configStore.setPresetOverride(newValue as ThemeName);
          applyPreset(newValue);
          break;
        }
        case "editor": {
          const enabled = newValue === "on";
          configStore.setComponentOverride("editor", enabled);
          if (enabled) controls.editor.on(ctx);
          else controls.editor.off(ctx);
          break;
        }
        case "messages": {
          const enabled = newValue === "on";
          configStore.setComponentOverride("messages", enabled);
          if (enabled) controls.messages.on();
          else controls.messages.off();
          break;
        }
        case "tools": {
          const enabled = newValue === "on";
          configStore.setComponentOverride("tools", enabled);
          if (enabled) controls.tools.on();
          else controls.tools.off();
          break;
        }
        case "footer": {
          const enabled = newValue === "on";
          configStore.setComponentOverride("footer", enabled);
          if (enabled) controls.footer.on(ctx);
          else controls.footer.off(ctx);
          break;
        }
        case "thinking": {
          const enabled = newValue === "on";
          configStore.setComponentOverride("thinking", enabled);
          if (enabled) controls.thinking.on(ctx);
          else controls.thinking.off(ctx);
          break;
        }
        case "background-enabled": {
          const enabled = newValue === "on";
          configStore.setBackgroundOverride("enabled", enabled);
          if (enabled) {
            if (configStore.getBackground().mode === "off") {
              configStore.setBackgroundOverride("mode", "scene");
            }
            controls.background?.on(ctx);
          } else {
            controls.background?.off(ctx);
          }
          break;
        }
        case "background-mode": {
          const mode = newValue as BackgroundMode;
          controls.background?.setMode(mode, ctx);
          break;
        }
        case "background-scene": {
          const scene = newValue as BackgroundScene;
          controls.background?.setScene(scene, ctx);
          break;
        }
        case "background-asset": {
          try {
            configStore.selectBackgroundAsset(newValue === "built-in" ? null : newValue, perPreset);
            controls.background?.setMode("full", ctx);
          } catch (error) { ctx.ui.notify(backgroundError(error), "error"); }
          break;
        }
        case "background-assignment": perPreset = newValue === "this preset"; break;
        case "background-fit": configStore.setBackgroundOverride("fit", newValue as BackgroundFit); break;
        case "background-texture-scale": configStore.setBackgroundOverride("textureScale", Number(newValue.replace(/x$/, ""))); break;
        case "background-opacity": configStore.setBackgroundOverride("opacity", Number(newValue)); break;
        case "background-contrast": configStore.setBackgroundOverride("contrast", Number(newValue)); break;
        case "background-readability": configStore.setBackgroundOverride("readability", newValue); break;
        case "background-fps": configStore.setBackgroundOverride("fps", Number(newValue)); break;
        case "background-speed": {
          const num = parseFloat(newValue.replace("x", ""));
          configStore.setBackgroundOverride("speed", num);
          break;
        }
        case "background-intensity": {
          configStore.setBackgroundOverride("intensity", newValue as BackgroundIntensity);
          controls.background?.applyTheme(ctx);
          break;
        }
        case "background-dimming": {
          configStore.setBackgroundOverride("dimming", newValue as BackgroundDimming);
          controls.background?.applyTheme(ctx);
          break;
        }
        case "background-playback": {
          configStore.setBackgroundOverride("playing", newValue === "playing");
          break;
        }
        case "background-pause": {
          configStore.setBackgroundOverride("pauseOnActivity", newValue === "on");
          break;
        }
        case "animation-mode": {
          configStore.setAnimationOverride("mode", newValue as AnimationMode);
          controls.thinking.applyTheme(ctx);
          break;
        }
        case "animation-speed": {
          const num = parseFloat(newValue.replace("x", ""));
          configStore.setAnimationOverride("speed", num);
          controls.thinking.applyTheme(ctx);
          break;
        }
        case "reduced-motion": {
          configStore.setAnimationOverride("reducedMotion", newValue as ReducedMotionPreference);
          controls.thinking.applyTheme(ctx);
          break;
        }
        case "save-defaults": {
          if (!configStore.saveCurrentAsDefaults()) ctx.ui.notify("Unable to save OMT defaults", "error");
          break;
        }
        case "restore-defaults": {
          configStore.restoreDefaults();
          applyPreset(DEFAULT_CONFIG.preset);
          controls.editor.on(ctx);
          controls.messages.on();
          controls.tools.on();
          controls.footer.on(ctx);
          controls.thinking.on(ctx);
          controls.background?.off(ctx);
          break;
        }
      }
      syncValues();
      tui.requestRender();
    },
    () => {
      done();
    },
    { enableSearch: false },
  );

  titleText.update(80);
  subtitleText.update();

  const container = new SettingsComponent(settingsList);
  const border = () => new DynamicBorder(getBorderStyler(theme));
  container.addChild(border());
  container.addChild(titleText);
  container.addChild(subtitleText);
  container.addChild(settingsList);
  container.addChild({
    render(width: number): string[] {
      const id = configStore.getEffectiveBackgroundAsset();
      if (!id) return [];
      try { return renderManagedBackground(configStore.assets, configStore.assets.load(id), Math.min(width, 80), 3, configStore.getBackground(), 0, configStore.getPreset(), getPresetBackgroundPalette(configStore.getPreset()), accessibilityStore.isPlainTextAsciiBorders()); }
      catch { return [theme.fg("warning", "Background unavailable — reset or re-import")]; }
    },
    invalidate() {},
  });
  container.addChild(border());

  return container;
}

export {
  createOmtSettingsHubComponent,
  OmtSettingsHubComponent,
  type SettingsHubOptions,
  type PsecId,
  type PsecRowItem,
} from "../omt-dialogs/index.ts";

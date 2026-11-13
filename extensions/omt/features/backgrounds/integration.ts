import { type Component, type TUI, indexedColor, rgbColor } from "@earendil-works/pi-tui";
import { getBackgroundHex, getPalette, parseColorSpec } from "../../presets/omt-signature/palette.ts";
import { ansiBackground } from "../../presets/shared/rendering.ts";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { configStore, type BackgroundDimming, type BackgroundIntensity, type BackgroundMode, type BackgroundScene } from "../../core/config.ts";
import { getActiveTheme } from "../../core/theme.ts";
import { installNativeBackdrop, readNativeBackgroundTui } from "./pi.ts";
import { isReducedMotionActive, motionCoordinator, setActiveTui } from "../../core/motion.ts";
import { accessibilityStore } from "../accessibility/model.ts";
import { getPresetBackgroundDefaults, getPresetBackgroundPalette } from "../../presets/index.ts";

import { detectColorMode, evaluateFullBackdropSupport, type ColorMode } from "./capabilities/index.ts";
import { BackgroundPlayhead, backgroundFrameAt, quantizeTime } from "./motion/index.ts";
import { BackgroundCompositor, hasWallpaperImage } from "./compositor/index.ts";
import { renderSceneViewport, renderAmbientBackdrop } from "./scenes/index.ts";
import { loadChafaRenderer, getActiveChafaRenderer } from "./renderers/cell.ts";

import { managedBackgroundMoves, renderManagedBackground } from "./managed.ts";
export interface BackgroundStats {
  enabled: boolean;
  mode: BackgroundMode;
  scene: BackgroundScene;
  speed: number;
  textureScale: number;
  intensity: BackgroundIntensity;
  dimming: BackgroundDimming;
  paused: boolean;
  activeSources: number;
  isFullBackdropSupported: boolean;
  graphicsBackend?: "kitty" | "ansi";
  colorMode?: ColorMode;
}

export interface BackgroundControl {
  on(ctx: ExtensionContext): string;
  off(ctx: ExtensionContext): string;
  isEnabled(): boolean;
  setMode(mode: BackgroundMode, ctx?: ExtensionContext): string;
  setScene(scene: BackgroundScene, ctx?: ExtensionContext): string;
  setSpeed(speed: number): void;
  setIntensity(intensity: BackgroundIntensity): void;
  setDimming(dimming: BackgroundDimming): void;
  setPauseOnActivity(pause: boolean): void;
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  requestRender(): void;
  applyTheme(ctx: ExtensionContext): void;
  notifyActivityStart(): void;
  notifyActivityEnd(): void;
  notifySettled(): void;
  cleanup(ctx?: ExtensionContext): void;
  getStats(): BackgroundStats;
}

export const OMT_BACKGROUND_WIDGET_ID = "omt-background";
export const OMT_BACKGROUND_BELOW_WIDGET_ID = "omt-background-below";

/**
 * Creates the BackgroundControl singleton instance for managing
 * dynamic background rendering across Pi's interactive UI surfaces.
 */
export function createBackgroundControl(): BackgroundControl {
  let currentContext: ExtensionContext | undefined;
  let activeTui: TUI | undefined;
  let enabled = false;
  let activityCount = 0;
  const isPaused = () =>
    !configStore.getBackground().playing ||
    (configStore.getBackground().pauseOnActivity && activityCount > 0);
  let backdrop: ReturnType<typeof installNativeBackdrop>;
  let focused = true;
  let imageVisible = false;
  let overlayVisible = false;
  let viewportAllowed = true;
  const playhead = new BackgroundPlayhead();
  let selectedAsset: string | null = null;
  let assetFailed = false;
  let renderCache: { key: string; lines: string[] } | undefined;
  let unsubscribe: (() => void) | undefined;

  function renderAsset(width: number, height: number): string[] {
    const id = configStore.getEffectiveBackgroundAsset();
    if (!id) return [];
    const asset = configStore.assets.load(id, true);
    const settings = configStore.getBackground();
    const capped = backgroundTime();
    const frame = asset.metadata.scene ? capped : backgroundFrameAt(asset, capped).frame;
    const ascii = accessibilityStore.isPlainTextAsciiBorders();
    const colorMode = detectColorMode();
    const key = JSON.stringify([
      id,
      width,
      height,
      frame,
      settings.fit,
      settings.textureScale,
      settings.opacity,
      settings.contrast,
      settings.dimming,
      settings.intensity,
      getActiveTheme().id,
      ascii,
      colorMode,
    ]);
    if (renderCache?.key === key) return renderCache.lines;
    const preset = getActiveTheme().id;
    const lines = renderManagedBackground(
      configStore.assets,
      asset,
      width,
      height,
      settings,
      capped,
      preset,
      getPresetBackgroundPalette(preset),
      ascii,
      colorMode,
    );
    renderCache = { key, lines };
    return lines;
  }

  function backgroundTime(): number {
    const settings = configStore.getBackground();
    const elapsed = playhead.advance(performance.now(), shouldAnimate(), settings.speed);
    return quantizeTime(elapsed, settings.fps);
  }

  let fullReason = evaluateFullBackdropSupport().reason;
  const compositor = new BackgroundCompositor();

  function isCompatible(ctx: ExtensionContext): boolean {
    return ctx.mode === "tui" && ctx.hasUI && typeof ctx.ui?.setWidget === "function";
  }

  function shouldAnimate(): boolean {
    const id = configStore.getEffectiveBackgroundAsset();
    if (id !== selectedAsset) {
      selectedAsset = id;
      playhead.reset();
      assetFailed = false;
      renderCache = undefined;
      configStore.assets.clear();
    }
    if (getActiveTheme().id === "omt-signature" && configStore.getSignature().surface !== "transparent") return false;
    if (!enabled || isPaused() || !focused || imageVisible || overlayVisible || !viewportAllowed) {
      return false;
    }
    const bg = configStore.getBackground();
    if (!bg.enabled || bg.mode === "off") return false;
    if (assetFailed) return false;
    if (id) {
      try {
        const asset = configStore.assets.load(id, true);
        if (
          !managedBackgroundMoves(asset) ||
          (!asset.metadata.scene && backgroundFrameAt(asset, playhead.time).ended)
        ) {
          return false;
        }
      } catch {
        assetFailed = true;
        return false;
      }
    }
    if (bg.mode === "full" && (!backdrop?.owned() || !backdrop.visible())) return false;
    const currentPreset = getActiveTheme().id;
    if (currentPreset === "native") return false;
    if (
      configStore.getAnimation().mode === "off" ||
      isReducedMotionActive(configStore.getAnimation().reducedMotion)
    ) {
      return false;
    }
    return true;
  }

  function getEffectiveFps(): number {
    const bg = configStore.getBackground();
    // Reduce background FPS when Pi is actively streaming or running tools to preserve responsiveness
    if (activityCount > 0 && !bg.pauseOnActivity) {
      return Math.min(5, Math.max(1, Math.floor(bg.fps / 2)));
    }
    return bg.fps;
  }

  function updateMotionRegistration(): void {
    if (shouldAnimate()) {
      const fps = getEffectiveFps();
      motionCoordinator.register("omt:background", 1000 / fps);
    } else {
      playhead.suspend();
      motionCoordinator.unregister("omt:background");
    }
  }

  function releaseBackdrop(): void {
    backdrop?.dispose();
    backdrop = undefined;
    imageVisible = false;
    overlayVisible = false;
    viewportAllowed = true;
    focused = true;
    compositor.clear();
    configStore.assets.clear();
    getActiveChafaRenderer()?.chafaFrameCache.clear();
    playhead.reset();
    assetFailed = false;
    renderCache = undefined;
  }

  function mountWidgets(ctx: ExtensionContext): void {
    if (!isCompatible(ctx)) return;
    unsubscribe ??= configStore.subscribe(() => {
      updateMotionRegistration();
      activeTui?.requestRender();
    });
    releaseBackdrop();

    const bg = configStore.getBackground();
    const currentPreset = getActiveTheme().id;
    const currentAssetId = configStore.getEffectiveBackgroundAsset();
    if (currentAssetId) {
      loadChafaRenderer().catch(() => {});
    }

    const solidSurface = currentPreset === "omt-signature" && configStore.getSignature().surface !== "transparent";
    if ((!solidSurface && (!enabled || bg.mode === "off")) || currentPreset === "native") {
      try {
        ctx.ui.setWidget(OMT_BACKGROUND_WIDGET_ID, undefined);
        ctx.ui.setWidget(OMT_BACKGROUND_BELOW_WIDGET_ID, undefined);
      } catch {}
      updateMotionRegistration();
      return;
    }

    if (solidSurface || bg.mode === "full") {
      ctx.ui.setWidget(OMT_BACKGROUND_WIDGET_ID, undefined);
      ctx.ui.setWidget(OMT_BACKGROUND_BELOW_WIDGET_ID, undefined);
      activeTui = readNativeBackgroundTui(ctx.ui);
      if (activeTui) {
        backdrop = installNativeBackdrop(
          activeTui,
          (screen, width, height) => {
            viewportAllowed = width * height <= 80_000;
            imageVisible = screen.some(hasWallpaperImage);
            overlayVisible = activeTui?.hasOverlay() ?? false;
            updateMotionRegistration();
            if (imageVisible || overlayVisible || !viewportAllowed) return screen;
            const settings = configStore.getBackground();
            const preset = getActiveTheme().id;
            if (preset === "native") return screen;
            const signature = configStore.getSignature();
            if (preset === "omt-signature" && signature.surface !== "transparent") {
              const mode = detectColorMode();
              if (mode === "monochrome" || mode === "16color" || !currentContext) return screen;
              const light = signature.palette === "auto" ? currentContext.ui.theme.appearance === "light" : getPalette(signature.palette).light;
              const hex = getBackgroundHex(signature.surface, !!light);
              if (!hex) return screen;
              const spec = parseColorSpec(hex);
              const color = mode === "256color" ? indexedColor(spec.ansi256) : rgbColor(...spec.rgb);
              const row = ansiBackground(currentContext.ui.theme, color, " ".repeat(width));
              return compositor.compose(screen, Array.from({ length: height }, () => row), width, height, settings.readability === "strict");
            }
            if (!enabled || settings.mode !== "full") return screen;
            const assetId = configStore.getEffectiveBackgroundAsset();
            if (assetId) {
              try {
                // Native row diffing has no verified persistent-image lifecycle.
                // Keep full viewport composition cell-based: never inject protocol
                // commands into transcript rows or bypass foreground masks.
                const wallpaper = renderAsset(width, height);
                return compositor.compose(
                  screen,
                  wallpaper,
                  width,
                  height,
                  settings.readability === "strict",
                );
              } catch {
                assetFailed = true;
                updateMotionRegistration();
                return screen;
              }
            }
            const time = backgroundTime();
            const colorMode = detectColorMode();
            const key = JSON.stringify([
              "builtin",
              width,
              height,
              time,
              preset,
              settings,
              accessibilityStore.isPlainTextAsciiBorders(),
              isReducedMotionActive(),
              configStore.getAnimation().mode,
              colorMode,
            ]);
            const wallpaper =
              renderCache?.key === key
                ? renderCache.lines
                : renderSceneViewport({
                    width,
                    height,
                    timeMs: time,
                    speed: 1,
                    intensity: settings.intensity,
                    dimming: settings.dimming,
                    textureScale: settings.textureScale,
                    reducedMotion:
                      isReducedMotionActive() || configStore.getAnimation().mode === "off",
                    preset,
                    palette: getPresetBackgroundPalette(preset),
                    asciiOnly: accessibilityStore.isPlainTextAsciiBorders(),
                    mode: "full",
                    scene: configStore.getEffectiveBackgroundScene(),
                    framing: "none",
                    colorMode,
                  });
            renderCache = { key, lines: wallpaper };
            return compositor.compose(
              screen,
              wallpaper,
              width,
              height,
              settings.readability === "strict",
            );
          },
          (visible) => {
            focused = visible;
            updateMotionRegistration();
            if (visible) activeTui?.requestRender(true);
          },
        );
        if (backdrop) {
          setActiveTui(activeTui);
          activeTui.requestRender(true);
        }
      }
      fullReason = evaluateFullBackdropSupport(!!backdrop).reason;
      if (!backdrop) ctx.ui.notify?.(fullReason, "warning");
      updateMotionRegistration();
      return;
    }

    // Scene or Ambient widget for aboveEditor
    const sceneWidget = (tui: TUI, _theme: Theme): Component => {
      activeTui = tui;
      setActiveTui(tui);
      updateMotionRegistration();

      return {
        render(width: number): string[] {
          if (!enabled || width <= 0) return [];
          const curPreset = getActiveTheme().id;
          if (curPreset === "native") return [];

          const curBg = configStore.getBackground();
          if (curBg.mode === "off") return [];

          const assetId = configStore.getEffectiveBackgroundAsset();
          if (assetId) {
            try {
              return renderAsset(width, curBg.mode === "ambient" ? 1 : 4);
            } catch {
              return [];
            }
          }
          const activeScene = configStore.getEffectiveBackgroundScene();
          const palette = getPresetBackgroundPalette(curPreset);
          const reduced =
            isReducedMotionActive(configStore.getAnimation().reducedMotion) ||
            configStore.getAnimation().mode === "off";
          const asciiOnly = accessibilityStore.isPlainTextAsciiBorders();
          const defaults = getPresetBackgroundDefaults(curPreset);
          const colorMode = detectColorMode();

          if (curBg.mode === "ambient") {
            return renderAmbientBackdrop({
              width,
              height: 1,
              timeMs: backgroundTime(),
              speed: 1,
              intensity: curBg.intensity,
              dimming: curBg.dimming,
              reducedMotion: reduced,
              preset: curPreset,
              palette,
              asciiOnly,
              mode: "ambient",
              textureScale: curBg.textureScale,
              scene: activeScene,
              colorMode,
            });
          }

          if (width < 10) return [];
          const sceneHeight =
            width >= 80 ? defaults.preferredHeight || 4 : width >= 50 ? 3 : 2;
          return renderSceneViewport({
            width,
            height: sceneHeight,
            timeMs: backgroundTime(),
            speed: 1,
            intensity: curBg.intensity,
            dimming: curBg.dimming,
            reducedMotion: reduced,
            preset: curPreset,
            palette,
            asciiOnly,
            mode: curBg.mode,
            textureScale: curBg.textureScale,
            scene: activeScene,
            framing: defaults.framing,
            colorMode,
          });
        },
        invalidate() {},
      };
    };

    ctx.ui.setWidget(OMT_BACKGROUND_WIDGET_ID, sceneWidget, { placement: "aboveEditor" });
    ctx.ui.setWidget(OMT_BACKGROUND_BELOW_WIDGET_ID, undefined);

    updateMotionRegistration();
  }

  function unmountWidgets(ctx?: ExtensionContext): void {
    const targetCtx = ctx ?? currentContext;
    if (targetCtx && isCompatible(targetCtx)) {
      try {
        targetCtx.ui.setWidget(OMT_BACKGROUND_WIDGET_ID, undefined);
        targetCtx.ui.setWidget(OMT_BACKGROUND_BELOW_WIDGET_ID, undefined);
      } catch {}
    }
    releaseBackdrop();
    configStore.assets.dispose();
    activeTui = undefined;
    motionCoordinator.unregister("omt:background");
  }

  return {
    on(ctx: ExtensionContext): string {
      currentContext = ctx;
      if (!isCompatible(ctx)) {
        return "OMT background unavailable: interactive TUI mode with widget APIs required.";
      }
      enabled = true;
      configStore.setBackgroundOverride("enabled", true);
      const bg = configStore.getBackground();
      if (bg.mode === "off") {
        configStore.setBackgroundOverride("mode", "scene");
      }
      mountWidgets(ctx);
      const status = `OMT background on (scene: ${configStore.getEffectiveBackgroundScene()}, mode: ${configStore.getBackground().mode}).`;
      return configStore.getBackground().mode === "full" ? `${status} ${fullReason}` : status;
    },

    off(ctx: ExtensionContext): string {
      currentContext = ctx;
      enabled = false;
      configStore.setBackgroundOverride("enabled", false);
      configStore.setBackgroundOverride("mode", "off");
      unmountWidgets(ctx);
      return "OMT background off.";
    },

    isEnabled(): boolean {
      return enabled && configStore.isBackgroundEnabled();
    },

    setMode(mode: BackgroundMode, ctx?: ExtensionContext): string {
      if (ctx) currentContext = ctx;
      configStore.setBackgroundOverride("mode", mode);
      if (mode === "off") {
        enabled = false;
        configStore.setBackgroundOverride("enabled", false);
        unmountWidgets(currentContext);
        return "OMT background mode set to off.";
      }

      enabled = true;
      configStore.setBackgroundOverride("enabled", true);
      if (currentContext) mountWidgets(currentContext);

      if (mode === "full") {
        return `OMT background mode set to full. ${fullReason}`;
      }
      return `OMT background mode set to ${mode}.`;
    },

    setScene(scene: BackgroundScene, ctx?: ExtensionContext): string {
      if (ctx) currentContext = ctx;
      configStore.setSignatureOverride("surface", "transparent");
      configStore.selectBackgroundAsset(null);
      configStore.setPresetSceneOverride(configStore.getPreset(), scene);
      configStore.setBackgroundOverride("scene", scene);
      if (currentContext && enabled) {
        mountWidgets(currentContext);
      }
      return `OMT background scene set to ${scene}.`;
    },

    setSpeed(speed: number): void {
      configStore.setBackgroundOverride("speed", speed);
    },

    setIntensity(intensity: BackgroundIntensity): void {
      configStore.setBackgroundOverride("intensity", intensity);
    },

    setDimming(dimming: BackgroundDimming): void {
      configStore.setBackgroundOverride("dimming", dimming);
    },

    setPauseOnActivity(pause: boolean): void {
      configStore.setBackgroundOverride("pauseOnActivity", pause);
    },

    pause(): void {
      configStore.setBackgroundOverride("playing", false);
      playhead.suspend();
      updateMotionRegistration();
    },

    resume(): void {
      configStore.setBackgroundOverride("playing", true);
      updateMotionRegistration();
    },

    isPaused(): boolean {
      return isPaused();
    },

    requestRender(): void {
      updateMotionRegistration();
      if (activeTui && enabled && focused && !imageVisible) {
        try {
          activeTui.requestRender();
        } catch {}
      }
    },

    applyTheme(ctx: ExtensionContext): void {
      currentContext = ctx;
      enabled = configStore.isBackgroundEnabled();
      const currentPreset = getActiveTheme().id;
      if (currentPreset === "native") {
        unmountWidgets(ctx);
        return;
      }
      if (enabled || (currentPreset === "omt-signature" && configStore.getSignature().surface !== "transparent")) {
        mountWidgets(ctx);
      } else {
        unmountWidgets(ctx);
      }
    },

    notifyActivityStart(): void {
      activityCount++;
      updateMotionRegistration();
    },

    notifyActivityEnd(): void {
      activityCount = Math.max(0, activityCount - 1);
      if (activityCount === 0) {
        this.notifySettled();
      }
    },

    notifySettled(): void {
      activityCount = 0;
      updateMotionRegistration();
    },

    cleanup(ctx?: ExtensionContext): void {
      enabled = false;
      activityCount = 0;
      unsubscribe?.();
      unsubscribe = undefined;
      unmountWidgets(ctx);
      currentContext = undefined;
    },

    getStats(): BackgroundStats {
      const bg = configStore.getBackground();
      return {
        enabled: this.isEnabled(),
        mode: bg.mode,
        scene: configStore.getEffectiveBackgroundScene(),
        speed: bg.speed,
        textureScale: bg.textureScale,
        intensity: bg.intensity,
        dimming: bg.dimming,
        paused: isPaused(),
        activeSources: motionCoordinator.activeCount(),
        isFullBackdropSupported: !!backdrop?.owned(),
        graphicsBackend: "ansi",
        colorMode: detectColorMode(),
      };
    },
  };
}

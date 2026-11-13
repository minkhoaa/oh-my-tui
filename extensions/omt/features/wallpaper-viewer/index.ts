import { type Component, type Focusable, type KeybindingsManager, type TUI, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { configStore, VALID_BACKGROUND_DIMMINGS, VALID_BACKGROUND_INTENSITIES, VALID_BACKGROUND_MODES, VALID_BACKGROUND_SCENES, type BackgroundDimming, type BackgroundIntensity, type BackgroundMode, type BackgroundScene } from "../../core/config.ts";
import { getActiveTheme } from "../../core/theme.ts";
import { getBorderStyler } from "../../presets/shared/style.ts";
import { accessibilityStore } from "../accessibility/model.ts";
import { applyDimming, BUILTIN_SCENES, formatRgb, getSceneImplementation, renderSceneViewport, type PresetBackgroundPalette } from "../backgrounds/scenes/index.ts";
import { getPresetBackgroundPalette } from "../../presets/index.ts";
import { isReducedMotionActive } from "../../core/motion.ts";
import { renderImageBackground, loadChafaRenderer } from "../backgrounds/renderers/cell.ts";
import { backgroundFrameAt } from "../backgrounds/motion/index.ts";
import { detectColorMode } from "../backgrounds/capabilities/index.ts";

export interface WallpaperViewerOptions {
  initialScene?: BackgroundScene;
  onApply?: (scene: BackgroundScene, mode: BackgroundMode) => void;
}

export type WallpaperItem =
  | { type: "asset"; id: string; name: string }
  | { type: "scene"; scene: BackgroundScene; name: string };

export class WallpaperViewerComponent implements Component, Focusable {
  focused = true;
  private tui: TUI;
  private theme: Theme;
  private done: (val?: unknown) => void;
  private ctx: ExtensionContext;
  private options: WallpaperViewerOptions;

  private items: WallpaperItem[] = [];
  private selectedIndex = 0;
  private scene: BackgroundScene;
  private mode: BackgroundMode;
  private speed: number;
  private intensity: BackgroundIntensity;
  private dimming: BackgroundDimming;
  private isPaused = false;
  private statusMessage = "";
  private statusTimer: NodeJS.Timeout | null = null;

  private frameCount = 0;
  private fps = 0;
  private lastFpsUpdate = performance.now();
  private framesSinceLastFps = 0;
  private animTimer: NodeJS.Timeout | null = null;
  private startTime = performance.now();

  constructor(
    tui: TUI,
    theme: Theme,
    _keybindings: KeybindingsManager,
    done: (val?: unknown) => void,
    ctx: ExtensionContext,
    options: WallpaperViewerOptions = {},
  ) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    const bg = configStore.getBackground();
    this.scene = options.initialScene ?? configStore.getEffectiveBackgroundScene();
    this.mode = bg.mode === "off" ? "scene" : bg.mode;
    this.speed = bg.speed;
    this.intensity = bg.intensity;
    this.dimming = bg.dimming;

    this.initItems(options.initialScene);
    loadChafaRenderer().catch(() => {});
    this.startAnimation();
  }

  private initItems(initialScene?: BackgroundScene): void {
    const list: WallpaperItem[] = [];

    // 1. User uploaded / imported raster assets (rendered via Chafa WASM)
    try {
      const userAssets = configStore.assets.list();
      for (const asset of userAssets) {
        list.push({
          type: "asset",
          id: asset.id,
          name: asset.name,
        });
      }
    } catch {}

    // 2. Built-in procedural scenes
    for (const sc of VALID_BACKGROUND_SCENES) {
      list.push({
        type: "scene",
        scene: sc,
        name: getSceneImplementation(sc).label,
      });
    }

    this.items = list;

    // Determine initial index
    if (initialScene) {
      const foundIdx = this.items.findIndex(
        (it) => it.type === "scene" && it.scene === initialScene,
      );
      if (foundIdx !== -1) {
        this.selectedIndex = foundIdx;
        return;
      }
    }

    const currentAssetId = configStore.getEffectiveBackgroundAsset();
    if (currentAssetId) {
      const foundIdx = this.items.findIndex(
        (it) => it.type === "asset" && it.id === currentAssetId,
      );
      if (foundIdx !== -1) {
        this.selectedIndex = foundIdx;
        return;
      }
    }

    const curScene = configStore.getEffectiveBackgroundScene();
    const sceneIdx = this.items.findIndex(
      (it) => it.type === "scene" && it.scene === curScene,
    );
    this.selectedIndex = sceneIdx !== -1 ? sceneIdx : 0;
  }

  private startAnimation(): void {
    const reduced = isReducedMotionActive(configStore.getAnimation().reducedMotion);
    if (reduced) return;

    // Run preview animation at ~20 FPS (50ms)
    this.animTimer = setInterval(() => {
      if (this.isPaused) return;
      this.frameCount++;
      this.framesSinceLastFps++;

      const now = performance.now();
      if (now - this.lastFpsUpdate >= 1000) {
        this.fps = this.framesSinceLastFps;
        this.framesSinceLastFps = 0;
        this.lastFpsUpdate = now;
      }

      try {
        this.tui.requestRender();
      } catch {}
    }, 50);
    this.animTimer.unref?.();
  }

  private showStatus(msg: string): void {
    this.statusMessage = msg;
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      this.statusMessage = "";
      try {
        this.tui.requestRender();
      } catch {}
    }, 2500);
    this.statusTimer.unref?.();
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.dispose();
      this.done();
      return;
    }

    if (matchesKey(data, "left") || matchesKey(data, "h")) {
      if (this.items.length > 0) {
        this.selectedIndex =
          (this.selectedIndex - 1 + this.items.length) % this.items.length;
        const cur = this.items[this.selectedIndex]!;
        if (cur.type === "scene") {
          this.scene = cur.scene;
          this.showStatus(`Scene: ${cur.name}`);
        } else {
          this.showStatus(`Chafa: ${cur.name}`);
        }
      }
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "right") || matchesKey(data, "l") || matchesKey(data, "tab")) {
      if (this.items.length > 0) {
        this.selectedIndex = (this.selectedIndex + 1) % this.items.length;
        const cur = this.items[this.selectedIndex]!;
        if (cur.type === "scene") {
          this.scene = cur.scene;
          this.showStatus(`Scene: ${cur.name}`);
        } else {
          this.showStatus(`Chafa: ${cur.name}`);
        }
      }
      this.tui.requestRender();
      return;
    }

    if (data === "m") {
      const modes: BackgroundMode[] = ["ambient", "scene", "full"];
      const idx = modes.indexOf(this.mode);
      const nextIdx = (idx + 1) % modes.length;
      this.mode = modes[nextIdx]!;
      this.showStatus(`Mode: ${this.mode}`);
      this.tui.requestRender();
      return;
    }

    if (data === "s") {
      const speeds = [0.5, 1.0, 1.5, 2.0];
      const idx = speeds.indexOf(this.speed);
      const nextIdx = (idx + 1) % speeds.length;
      this.speed = speeds[nextIdx]!;
      this.showStatus(`Speed: ${this.speed}x`);
      this.tui.requestRender();
      return;
    }

    if (data === "i") {
      const idx = VALID_BACKGROUND_INTENSITIES.indexOf(this.intensity);
      const nextIdx = (idx + 1) % VALID_BACKGROUND_INTENSITIES.length;
      this.intensity = VALID_BACKGROUND_INTENSITIES[nextIdx]!;
      this.showStatus(`Intensity: ${this.intensity}`);
      this.tui.requestRender();
      return;
    }

    if (data === "d") {
      const idx = VALID_BACKGROUND_DIMMINGS.indexOf(this.dimming);
      const nextIdx = (idx + 1) % VALID_BACKGROUND_DIMMINGS.length;
      this.dimming = VALID_BACKGROUND_DIMMINGS[nextIdx]!;
      this.showStatus(`Dimming: ${this.dimming}`);
      this.tui.requestRender();
      return;
    }

    if (data === " " || data === "p") {
      this.isPaused = !this.isPaused;
      this.showStatus(this.isPaused ? "Paused" : "Resumed");
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "return")) {
      const cur = this.items[this.selectedIndex];
      configStore.setBackgroundOverride("enabled", true);
      configStore.setBackgroundOverride("mode", this.mode);
      configStore.setBackgroundOverride("speed", this.speed);
      configStore.setBackgroundOverride("intensity", this.intensity);
      configStore.setBackgroundOverride("dimming", this.dimming);

      if (cur?.type === "asset") {
        configStore.selectBackgroundAsset(cur.id);
        this.options.onApply?.(this.scene, this.mode);
        this.showStatus(`Applied: ${cur.name} (${this.mode} mode)`);
        this.ctx.ui?.notify?.(`Wallpaper updated: ${cur.name} (${this.mode})`, "info");
      } else {
        const sc = cur?.scene ?? this.scene;
        this.scene = sc;
        configStore.selectBackgroundAsset(null);
        configStore.setBackgroundOverride("scene", sc);
        this.options.onApply?.(sc, this.mode);
        this.showStatus(`Applied: ${sc} (${this.mode} mode)`);
        this.ctx.ui?.notify?.(`Wallpaper updated: ${sc} (${this.mode})`, "info");
      }
      this.tui.requestRender();
      return;
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const safeWidth = Math.max(2, width);
    const innerWidth = safeWidth - 2;
    const isAscii = accessibilityStore.isPlainTextAsciiBorders();
    const borderStyler = getBorderStyler(th);

    const padRow = (str: string, targetWidth: number): string => {
      const vis = visibleWidth(str);
      if (vis >= targetWidth) return truncateToWidth(str, targetWidth);
      return str + " ".repeat(targetWidth - vis);
    };

    const lines: string[] = [];
    const reduced =
      isReducedMotionActive(configStore.getAnimation().reducedMotion) ||
      configStore.getAnimation().mode === "off";
    const curPreset = getActiveTheme().id;
    const palette = getPresetBackgroundPalette(curPreset);

    // Top border
    lines.push(
      borderStyler(
        th.fg(
          "border",
          isAscii ? `+${"-".repeat(innerWidth)}+` : `╭${"─".repeat(innerWidth)}╮`,
        ),
      ),
    );

    // Title & status row
    const title = th.bold(th.fg("accent", " Live Wallpaper & Backdrop Viewer "));
    const fpsBadge = reduced
      ? th.fg("muted", "[reduced-motion]")
      : this.isPaused
        ? th.fg("warning", "[PAUSED]")
        : th.fg("success", `${this.fps} FPS`);
    const presetBadge = th.fg("dim", `[Preset: ${curPreset}]`);
    const headerContent = ` ${title} ${presetBadge}  ${fpsBadge}`;
    lines.push(
      th.fg("border", isAscii ? "|" : "│") +
        padRow(headerContent, innerWidth) +
        th.fg("border", isAscii ? "|" : "│"),
    );

    // Divider
    lines.push(
      th.fg(
        "border",
        isAscii ? `+${"-".repeat(innerWidth)}+` : `├${"─".repeat(innerWidth)}┤`,
      ),
    );

    // Viewport (10 lines)
    const viewportHeight = 10;
    const viewportWidth = Math.max(10, width - 4);
    const curItem = this.items[this.selectedIndex];
    let previewLines: string[] = [];

    if (curItem?.type === "asset") {
      // Render asset through Chafa WASM
      try {
        const loadedAsset = configStore.assets.load(curItem.id);
        const elapsed = performance.now() - this.startTime;
        const frameIdx = backgroundFrameAt(loadedAsset, elapsed).frame;
        const colorMode = detectColorMode();
        previewLines = renderImageBackground(
          loadedAsset,
          viewportWidth,
          viewportHeight,
          {
            fit: configStore.getBackground().fit,
            textureScale: configStore.getBackground().textureScale,
            opacity: 0.95,
            dimming: this.dimming,
            intensity: this.intensity,
            speed: this.speed,
          },
          isAscii,
          frameIdx,
          colorMode,
        );
      } catch {
        previewLines = [];
      }
    }

    if (previewLines.length === 0) {
      // Render procedural scene
      const activeScene = curItem?.type === "scene" ? curItem.scene : this.scene;
      previewLines = renderSceneViewport({
        width: viewportWidth,
        height: viewportHeight,
        timeMs: performance.now() - this.startTime,
        speed: this.speed,
        textureScale: configStore.getBackground().textureScale,
        intensity: this.intensity,
        dimming: this.dimming,
        reducedMotion: reduced,
        preset: curPreset,
        palette,
        asciiOnly: isAscii,
        mode: this.mode,
        scene: activeScene,
      });
    }

    for (let y = 0; y < viewportHeight; y++) {
      const sceneRow = previewLines[y] ?? " ";
      const borderedRow = `  ${padRow(sceneRow, Math.max(0, safeWidth - 4))}`;
      lines.push(
        th.fg("border", isAscii ? "|" : "│") +
          padRow(borderedRow, innerWidth) +
          th.fg("border", isAscii ? "|" : "│"),
      );
    }

    // Divider
    lines.push(
      th.fg(
        "border",
        isAscii ? `+${"-".repeat(innerWidth)}+` : `├${"─".repeat(innerWidth)}┤`,
      ),
    );

    // Current settings metadata row
    let itemLabel = "";
    if (curItem?.type === "asset") {
      itemLabel = `Chafa: ${curItem.name}`;
    } else {
      const sc = curItem?.type === "scene" ? curItem.scene : this.scene;
      itemLabel = `Scene: ${getSceneImplementation(sc).label}`;
    }
    const metaRow = ` ${th.bold(th.fg("accent", itemLabel))} · Mode: ${th.fg("accent", this.mode)} · Speed: ${th.fg("accent", `${this.speed}x`)} · Intensity: ${th.fg("accent", this.intensity)} · Dimming: ${th.fg("accent", this.dimming)}`;
    lines.push(
      th.fg("border", isAscii ? "|" : "│") +
        padRow(metaRow, innerWidth) +
        th.fg("border", isAscii ? "|" : "│"),
    );

    // Keybindings / status row
    const statusText = this.statusMessage
      ? th.bold(th.fg("success", ` ${this.statusMessage}`))
      : th.fg(
          "dim",
          " [←/→] Wallpaper  [m] Mode  [s] Speed  [i] Intensity  [d] Dimming  [Space] Pause  [Enter] Apply  [q/Esc] Close",
        );
    lines.push(
      th.fg("border", isAscii ? "|" : "│") +
        padRow(statusText, innerWidth) +
        th.fg("border", isAscii ? "|" : "│"),
    );

    // Bottom border
    lines.push(
      borderStyler(
        th.fg(
          "border",
          isAscii ? `+${"-".repeat(innerWidth)}+` : `╰${"─".repeat(innerWidth)}╯`,
        ),
      ),
    );

    return lines;
  }

  dispose(): void {
    if (this.animTimer) {
      clearInterval(this.animTimer);
      this.animTimer = null;
    }
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
  }
}

export function createWallpaperViewerComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (val?: unknown) => void,
  ctx: ExtensionContext,
  options?: WallpaperViewerOptions,
): WallpaperViewerComponent {
  return new WallpaperViewerComponent(tui, theme, keybindings, done, ctx, options);
}

import type { BackgroundAssetStore, LoadedBackground } from "./assets/index.ts";
import { backgroundFrameAt } from "./motion/index.ts";
import { wallpaperCells } from "./compositor/index.ts";
import { renderImageBackground, validCellViewport, type ImageCellRenderSettings } from "./renderers/cell.ts";
import { isCuratedScene, renderProceduralScene, renderSceneViewport, type PresetBackgroundPalette } from "./scenes/index.ts";
import type { ThemeName } from "../../presets/shared/types.ts";
import type { ColorMode } from "./capabilities/index.ts";

/**
 * Checks whether an asset has animated motion.
 */
export function managedBackgroundMoves(asset: LoadedBackground): boolean {
  if (asset.metadata.alias && isCuratedScene(asset.metadata.alias)) return true;
  const scene = asset.metadata.scene;
  return scene
    ? scene.motion && scene.layers.some((layer) => layer.speed > 0 && layer.density > 0)
    : asset.metadata.frameCount > 1;
}

/**
 * Data adapter rendering managed backgrounds through the cell renderer
 * and procedural scene engine.
 */
export function renderManagedBackground(
  store: BackgroundAssetStore,
  asset: LoadedBackground,
  width: number,
  height: number,
  settings: ImageCellRenderSettings,
  elapsed: number,
  preset: ThemeName,
  palette: PresetBackgroundPalette,
  ascii = false,
  colorMode: ColorMode = "truecolor",
): string[] {
  if (!validCellViewport(width, height)) return [];
  const scene = asset.metadata.scene;
  if (!scene) {
    const alias = asset.metadata.alias;
    if (alias && isCuratedScene(alias)) {
      return renderProceduralScene(alias, width, height, elapsed, {
        width,
        height,
        timeMs: elapsed,
        speed: settings.speed ?? 1.0,
        intensity: settings.intensity ?? "medium",
        dimming: settings.dimming ?? "subtle",
        asciiOnly: ascii,
        backdropBg: palette.ambientBg,
        textureScale: settings.textureScale,
        colorMode,
      });
    }
    const frameIdx = backgroundFrameAt(asset, elapsed).frame;
    return renderImageBackground(
      asset,
      width,
      height,
      settings,
      ascii,
      frameIdx,
      colorMode,
    );
  }

  let base = Array.from({ length: height }, () => Array<string>(width).fill(" "));
  const imageId = asset.metadata.imageIds?.[0];
  if (imageId) {
    try {
      const image = store.load(imageId);
      if (image.metadata.kind === "image" || image.metadata.kind === "animation") {
        base = wallpaperCells(
          renderImageBackground(image, width, height, settings, ascii, 0, colorMode),
          width,
          height,
        );
      }
    } catch {
      // Missing or corrupt image does not suppress declarative scene
    }
  }

  for (const layer of scene.layers) {
    if (layer.density === 0) continue;
    const lines = renderSceneViewport({
      width,
      height,
      timeMs: (scene.motion ? elapsed : 0) * layer.speed + layer.seed * 1000,
      speed: 1,
      reducedMotion: false,
      intensity: settings.intensity ?? "medium",
      dimming: settings.dimming ?? "subtle",
      palette: scene.palette ?? palette,
      asciiOnly: ascii,
      preset,
      mode: "full",
      framing: "none",
      scene: layer.scene,
      density: layer.density,
      particleCount: Math.round(layer.count * layer.density),
      textureScale: settings.textureScale,
      colorMode,
    });
    const cells = wallpaperCells(lines, width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (cells[y]![x] !== " ") {
          base[y]![x] = cells[y]![x]!;
        }
      }
    }
  }
  return base.map((row) => row.join(""));
}


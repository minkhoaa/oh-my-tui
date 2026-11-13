import type { BackgroundScene } from "../../../core/config.ts";
import type { PresetBackgroundPalette } from "../scenes/index.ts";

export interface SceneLayer {
  scene: BackgroundScene;
  density: number;
  count: number;
  speed: number;
  seed: number;
}

export interface DeclarativeScene {
  motion: boolean;
  palette?: PresetBackgroundPalette;
  layers: SceneLayer[];
}

export interface BackgroundManifest {
  version: 1;
  type: "scene" | "theme-pack";
  name: string;
  scene: DeclarativeScene;
  images: string[];
}

const SCENES = ["aurora", "starfield", "rain", "matrix", "particles"];

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) {
    throw new Error("Unknown manifest property (only declarative scene data is allowed)");
  }
  return record;
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Scene number must be between ${min} and ${max}`);
  }
  return value;
}

function color(value: unknown): readonly [number, number, number] {
  if (typeof value !== "string" || !/^#[a-fA-F0-9]{6}$/.test(value)) {
    throw new Error("Scene colors must be #RRGGBB");
  }
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ];
}

export function validateManifest(raw: unknown): BackgroundManifest {
  const obj = object(raw, ["version", "type", "name", "palette", "scene", "images"]);
  if (obj.version !== 1 || !["scene", "theme-pack"].includes(String(obj.type))) {
    throw new Error("Manifest requires version: 1 and type: scene or theme-pack");
  }
  if (
    typeof obj.name !== "string" ||
    !obj.name.trim() ||
    obj.name.length > 80 ||
    /[\x00-\x1f\x7f-\x9f]/.test(obj.name)
  ) {
    throw new Error("Invalid scene name");
  }
  const scene = object(obj.scene, ["motion", "layers"]);
  if (scene.motion !== undefined && typeof scene.motion !== "boolean") {
    throw new Error("Scene motion must be boolean");
  }
  if (!Array.isArray(scene.layers) || scene.layers.length < 1 || scene.layers.length > 4) {
    throw new Error("Scenes require 1–4 layers");
  }
  const layers = scene.layers.map((rawLayer) => {
    const layer = object(rawLayer, ["scene", "density", "count", "speed", "seed"]);
    if (!SCENES.includes(String(layer.scene))) {
      throw new Error("Unknown procedural layer scene");
    }
    return {
      scene: layer.scene as BackgroundScene,
      density: number(layer.density, 1, 0, 2),
      count: Math.round(number(layer.count, 32, 1, 256)),
      speed: number(layer.speed, 1, 0, 4),
      seed: Math.round(number(layer.seed, 42, 0, 65535)),
    };
  });
  let palette: PresetBackgroundPalette | undefined;
  if (obj.palette !== undefined) {
    const colors = object(obj.palette, ["primary", "secondary", "dim", "glow", "ambientBg"]);
    palette = {
      primary: color(colors.primary),
      secondary: color(colors.secondary),
      dim: color(colors.dim),
      ...(colors.glow === undefined ? {} : { glow: color(colors.glow) }),
      ...(colors.ambientBg === undefined ? {} : { ambientBg: color(colors.ambientBg) }),
    };
  }
  if (
    obj.images !== undefined &&
    (obj.type !== "theme-pack" || !Array.isArray(obj.images) || obj.images.length > 4)
  ) {
    throw new Error("Only theme packs may contain up to four image paths");
  }
  const images = (obj.images ?? []) as unknown[];
  if (
    images.some(
      (path) =>
        typeof path !== "string" ||
        !path ||
        path.length > 240 ||
        /[\x00-\x1f\x7f-\x9f\\:]/.test(path) ||
        path.startsWith("/") ||
        path.split("/").some((part) => part === ".." || part === "." || part === ""),
    )
  ) {
    throw new Error("Theme pack images must be safe relative paths without traversal");
  }
  return {
    version: 1,
    type: obj.type as BackgroundManifest["type"],
    name: obj.name.trim(),
    scene: { motion: scene.motion !== false, palette, layers },
    images: images as string[],
  };
}

/**
 * Stored scene metadata uses canonical RGB arrays rather than user JSON colors.
 */
export function validateStoredScene(scene: DeclarativeScene): DeclarativeScene {
  const hex = (value: readonly number[]) => {
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
    ) {
      throw new Error("Invalid stored palette");
    }
    return `#${value.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  };
  const palette = scene?.palette
    ? Object.fromEntries(Object.entries(scene.palette).map(([k, v]) => [k, hex(v as number[])]))
    : undefined;
  return validateManifest({
    version: 1,
    type: "scene",
    name: "stored",
    scene: { motion: scene?.motion, layers: scene?.layers },
    ...(palette ? { palette } : {}),
  }).scene;
}

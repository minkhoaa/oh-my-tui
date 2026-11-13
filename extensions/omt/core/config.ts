import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { BackgroundAssetStore, isAssetId, resolveAssetId, type BackgroundFit } from "../features/backgrounds/assets/index.ts";
import { THEME_NAMES, resolveThemeName, type ThemeName } from "../presets/index.ts";
import { getPalette, isValidPaletteName, getBackgroundNames } from "../presets/omt-signature/palette.ts";

export type AnimationMode = "full" | "subtle" | "off";
export type ReducedMotionPreference = "auto" | "reduced" | "normal";

export type BackgroundMode = "off" | "ambient" | "scene" | "full";
export type BackgroundScene =
  | "aurora"
  | "starfield"
  | "rain"
  | "matrix"
  | "particles"
  | "moonlit"
  | "cloud-drift"
  | "honu-lagoon"
  | "koi-pond"
  | "jellyfish"
  | "lantern-night"
  | "fireflies"
  | "neon-rain"
  | "sakura-dusk"
  | "snow-cabin"
  | "star-voyage";
export type BackgroundIntensity = "low" | "medium" | "high";
export type BackgroundDimming = "dim" | "subtle" | "vibrant";

export interface OmtBackgroundConfig {
  enabled: boolean;
  mode: BackgroundMode;
  scene: BackgroundScene;
  speed: number;
  intensity: BackgroundIntensity;
  dimming: BackgroundDimming;
  pauseOnActivity: boolean;
  presetScenes?: Partial<Record<ThemeName, BackgroundScene>>;
  assetId: string | null;
  presetAssets: Partial<Record<ThemeName, string | null>>;
  fit: BackgroundFit;
  textureScale: number;
  opacity: number;
  contrast: number;
  readability: "balanced" | "strict";
  fps: number;
  playing: boolean;
}

export interface OmtComponentsConfig {
  editor: boolean;
  messages: boolean;
  tools: boolean;
  footer: boolean;
  thinking: boolean;
}

export interface OmtAnimationConfig {
  mode: AnimationMode;
  speed: number;
  reducedMotion: ReducedMotionPreference;
}

export interface SignaturePreferences {
  palette: string;
  surface: string;
  framed: boolean;
  pet: string;
  petStyle: "ascii" | "classic";
  favorites: string[];
  visible: Record<string, boolean>;
  folds: Record<string, boolean>;
}

const signatureDefaults: SignaturePreferences = {
  palette: "auto", surface: "transparent", framed: true, pet: "cat", petStyle: "ascii",
  favorites: [], visible: {}, folds: {},
};
const sideKeys = ["pet", "session", "model", "stats", "cost", "recent", "commands", "plugins", "mcp", "todos", "lsp", "tools", "skills", "subagents", "workspace"];
function signatureConfig(raw: unknown): SignaturePreferences {
  const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const booleans = (raw: unknown) => Object.fromEntries(Object.entries(raw && typeof raw === "object" ? raw : {}).filter(([key, value]) => sideKeys.includes(key) && typeof value === "boolean"));
  return {
    palette: typeof obj.palette === "string" && isValidPaletteName(obj.palette) ? getPalette(obj.palette).name : "auto",
    surface: typeof obj.surface === "string" && getBackgroundNames().includes(obj.surface) ? obj.surface : "transparent",
    framed: typeof obj.framed === "boolean" ? obj.framed : true,
    pet: typeof obj.pet === "string" && /^[a-z0-9-]{1,64}$/.test(obj.pet) ? obj.pet : "cat",
    petStyle: obj.petStyle === "classic" ? "classic" : "ascii",
    favorites: Array.isArray(obj.favorites) ? [...new Set(obj.favorites.filter((v): v is string => typeof v === "string" && v.length <= 256))].slice(0, 100) : [],
    visible: booleans(obj.visible), folds: booleans(obj.folds),
  };
}

export interface OmtConfig {
  version: number;
  preset: ThemeName;
  components: OmtComponentsConfig;
  animation: OmtAnimationConfig;
  background: OmtBackgroundConfig;
  signature: SignaturePreferences;
}

export const VALID_ANIMATION_MODES: readonly AnimationMode[] = ["full", "subtle", "off"];
export const VALID_ANIMATION_SPEEDS: readonly number[] = [0.5, 1.0, 1.5, 2.0];
export const VALID_REDUCED_MOTION: readonly ReducedMotionPreference[] = ["auto", "reduced", "normal"];

export const VALID_BACKGROUND_MODES: readonly BackgroundMode[] = ["off", "ambient", "scene", "full"];
export const VALID_BACKGROUND_SCENES: readonly BackgroundScene[] = [
  "aurora",
  "starfield",
  "rain",
  "matrix",
  "particles",
  "moonlit",
  "cloud-drift",
  "honu-lagoon",
  "koi-pond",
  "jellyfish",
  "lantern-night",
  "fireflies",
  "neon-rain",
  "sakura-dusk",
  "snow-cabin",
  "star-voyage",
];
export const VALID_BACKGROUND_INTENSITIES: readonly BackgroundIntensity[] = ["low", "medium", "high"];
export const VALID_BACKGROUND_DIMMINGS: readonly BackgroundDimming[] = ["dim", "subtle", "vibrant"];

export const DEFAULT_CONFIG: Readonly<OmtConfig> = Object.freeze({
  version: 1,
  preset: "omt-signature" as ThemeName,
  signature: Object.freeze({ ...signatureDefaults, favorites: Object.freeze([]) as unknown as string[], visible: Object.freeze({}), folds: Object.freeze({}) }),
  components: Object.freeze({
    editor: true,
    messages: true,
    tools: true,
    footer: true,
    thinking: true,
  }),
  animation: Object.freeze({
    mode: "full" as AnimationMode,
    speed: 1.0,
    reducedMotion: "auto" as ReducedMotionPreference,
  }),
  background: Object.freeze({
    enabled: false,
    mode: "off" as BackgroundMode,
    scene: "aurora" as BackgroundScene,
    speed: 1.0,
    intensity: "medium" as BackgroundIntensity,
    dimming: "subtle" as BackgroundDimming,
    pauseOnActivity: true,
    assetId: null,
    presetAssets: Object.freeze({}),
    fit: "cover" as BackgroundFit,
    textureScale: 1,
    opacity: 0.5,
    contrast: 1,
    readability: "balanced" as const,
    fps: 15,
    playing: true,
    presetScenes: Object.freeze({
      "omt-signature": "matrix" as BackgroundScene,
      "codex-inspired": "matrix" as BackgroundScene,
      "claude-code-inspired": "aurora" as BackgroundScene,
      "opencode-inspired": "rain" as BackgroundScene,
      "minimal": "starfield" as BackgroundScene,
      "native": "aurora" as BackgroundScene,
    }),
  }),
});

export function getConfigPath(agentDir?: string): string {
  const dir = agentDir ?? getAgentDirSafe();
  return join(dir, "omt.json");
}

function getAgentDirSafe(): string {
  try {
    return getAgentDir();
  } catch {
    return process.env.PI_AGENT_DIR ?? join(process.env.HOME ?? "/tmp", ".pi", "agent");
  }
}

/**
 * Validates any raw configuration object, filling in missing or invalid
 * properties with safe defaults and migrating older schema versions.
 */
export function validateConfig(raw: unknown): OmtConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return cloneConfig(DEFAULT_CONFIG);
  }

  const obj = raw as Record<string, unknown>;

  // Preset validation & alias resolution
  let preset: ThemeName = DEFAULT_CONFIG.preset;
  if (typeof obj.preset === "string") {
    const resolved = resolveThemeName(obj.preset);
    if (resolved && THEME_NAMES.includes(resolved)) {
      preset = resolved;
    }
  }

  // Component flags
  const rawComp = (obj.components && typeof obj.components === "object" && !Array.isArray(obj.components))
    ? (obj.components as Record<string, unknown>)
    : {};
  const components: OmtComponentsConfig = {
    editor: typeof rawComp.editor === "boolean" ? rawComp.editor : DEFAULT_CONFIG.components.editor,
    messages: typeof rawComp.messages === "boolean" ? rawComp.messages : DEFAULT_CONFIG.components.messages,
    tools: typeof rawComp.tools === "boolean" ? rawComp.tools : DEFAULT_CONFIG.components.tools,
    footer: typeof rawComp.footer === "boolean" ? rawComp.footer : DEFAULT_CONFIG.components.footer,
    thinking: typeof rawComp.thinking === "boolean" ? rawComp.thinking : DEFAULT_CONFIG.components.thinking,
  };

  // Animation configuration
  const rawAnim = (obj.animation && typeof obj.animation === "object" && !Array.isArray(obj.animation))
    ? (obj.animation as Record<string, unknown>)
    : {};

  let mode: AnimationMode = DEFAULT_CONFIG.animation.mode;
  if (typeof rawAnim.mode === "string" && VALID_ANIMATION_MODES.includes(rawAnim.mode as AnimationMode)) {
    mode = rawAnim.mode as AnimationMode;
  }

  let speed: number = DEFAULT_CONFIG.animation.speed;
  if (typeof rawAnim.speed === "number" && Number.isFinite(rawAnim.speed) && rawAnim.speed > 0) {
    // Snap to nearest supported speed or preserve if reasonable (0.25 to 4.0)
    speed = Math.max(0.25, Math.min(4.0, rawAnim.speed));
  }

  let reducedMotion: ReducedMotionPreference = DEFAULT_CONFIG.animation.reducedMotion;
  if (typeof rawAnim.reducedMotion === "string" && VALID_REDUCED_MOTION.includes(rawAnim.reducedMotion as ReducedMotionPreference)) {
    reducedMotion = rawAnim.reducedMotion as ReducedMotionPreference;
  }

  // Background configuration
  const rawBg = (obj.background && typeof obj.background === "object" && !Array.isArray(obj.background))
    ? (obj.background as Record<string, unknown>)
    : {};

  const bgEnabled = typeof rawBg.enabled === "boolean" ? rawBg.enabled : DEFAULT_CONFIG.background.enabled;

  let bgMode: BackgroundMode = DEFAULT_CONFIG.background.mode;
  if (typeof rawBg.mode === "string" && VALID_BACKGROUND_MODES.includes(rawBg.mode as BackgroundMode)) {
    bgMode = rawBg.mode as BackgroundMode;
  }

  let bgScene: BackgroundScene = DEFAULT_CONFIG.background.scene;
  if (typeof rawBg.scene === "string" && VALID_BACKGROUND_SCENES.includes(rawBg.scene as BackgroundScene)) {
    bgScene = rawBg.scene as BackgroundScene;
  }

  let bgSpeed: number = DEFAULT_CONFIG.background.speed;
  if (typeof rawBg.speed === "number" && Number.isFinite(rawBg.speed) && rawBg.speed > 0) {
    bgSpeed = Math.max(0.25, Math.min(4.0, rawBg.speed));
  }

  let bgIntensity: BackgroundIntensity = DEFAULT_CONFIG.background.intensity;
  if (typeof rawBg.intensity === "string" && VALID_BACKGROUND_INTENSITIES.includes(rawBg.intensity as BackgroundIntensity)) {
    bgIntensity = rawBg.intensity as BackgroundIntensity;
  }

  let bgDimming: BackgroundDimming = DEFAULT_CONFIG.background.dimming;
  if (typeof rawBg.dimming === "string" && VALID_BACKGROUND_DIMMINGS.includes(rawBg.dimming as BackgroundDimming)) {
    bgDimming = rawBg.dimming as BackgroundDimming;
  }

  const bgPause = typeof rawBg.pauseOnActivity === "boolean" ? rawBg.pauseOnActivity : DEFAULT_CONFIG.background.pauseOnActivity;

  const presetScenes: Partial<Record<ThemeName, BackgroundScene>> = { ...DEFAULT_CONFIG.background.presetScenes };
  if (rawBg.presetScenes && typeof rawBg.presetScenes === "object" && !Array.isArray(rawBg.presetScenes)) {
    for (const [k, v] of Object.entries(rawBg.presetScenes)) {
      if (typeof v === "string" && VALID_BACKGROUND_SCENES.includes(v as BackgroundScene)) {
        presetScenes[k as ThemeName] = v as BackgroundScene;
      }
    }
  }

  const presetAssets: OmtBackgroundConfig["presetAssets"] = {};
  if (rawBg.presetAssets && typeof rawBg.presetAssets === "object") {
    for (const name of THEME_NAMES) {
      const value = (rawBg.presetAssets as Record<string, unknown>)[name];
      if (value === null) presetAssets[name] = null;
      else if (typeof value === "string") {
        const resolved = resolveAssetId(value);
        if (resolved) presetAssets[name] = resolved;
      }
    }
  }
  const bounded = (value: unknown, min: number, max: number, fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  return {
    version: 1,
    preset,
    signature: signatureConfig(obj.signature),
    components,
    animation: {
      mode,
      speed,
      reducedMotion,
    },
    background: {
      enabled: bgEnabled,
      mode: bgMode,
      scene: bgScene,
      speed: bgSpeed,
      intensity: bgIntensity,
      dimming: bgDimming,
      pauseOnActivity: bgPause,
      presetScenes,
      assetId: typeof rawBg.assetId === "string" ? (resolveAssetId(rawBg.assetId) ?? null) : null,
      presetAssets,
      fit: ["cover", "contain", "center", "tile"].includes(String(rawBg.fit)) ? rawBg.fit as BackgroundFit : "cover",
      textureScale: bounded(rawBg.textureScale, 0.25, 2, 1),
      opacity: bounded(rawBg.opacity, 0, 1, 0.5),
      contrast: bounded(rawBg.contrast, 0.5, 1.5, 1),
      readability: rawBg.readability === "strict" ? "strict" : "balanced",
      fps: Math.round(bounded(rawBg.fps, 1, 30, 15)),
      playing: typeof rawBg.playing === "boolean" ? rawBg.playing : true,
    },
  };
}

export function cloneConfig(cfg: OmtConfig): OmtConfig {
  return {
    version: cfg.version,
    preset: cfg.preset,
    signature: signatureConfig(cfg.signature),
    components: { ...cfg.components },
    animation: { ...cfg.animation },
    background: {
      ...cfg.background,
      presetAssets: { ...cfg.background.presetAssets },
      presetScenes: cfg.background.presetScenes ? { ...cfg.background.presetScenes } : undefined,
    },
  };
}

/**
 * Loads persistent preferences from omt.json, falling back gracefully
 * to DEFAULT_CONFIG on missing file, read failure, or parse error.
 */
export function loadConfig(agentDir?: string): OmtConfig {
  const filePath = getConfigPath(agentDir);
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content);
      return validateConfig(parsed);
    }
  } catch {
    // Safe fallback to defaults on any I/O or JSON parse error
  }
  return cloneConfig(DEFAULT_CONFIG);
}

/**
 * Saves configuration persistently to omt.json.
 */
export function saveConfig(config: OmtConfig, agentDir?: string): boolean {
  const filePath = getConfigPath(agentDir);
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}

export interface SessionOverrides {
  preset?: ThemeName;
  signature?: Partial<SignaturePreferences>;
  components?: Partial<OmtComponentsConfig>;
  animation?: Partial<OmtAnimationConfig>;
  background?: Partial<OmtBackgroundConfig>;
}

/**
 * Single source of truth for active runtime configuration.
 * Distinguishes session-local overrides (from CLI flags / slash commands)
 * from saved persistent defaults.
 */
export class ConfigStore {
  private savedDefaults: OmtConfig;
  private overrides: SessionOverrides = {};
  private agentDir?: string;
  private assetStore?: BackgroundAssetStore;
  get assets(): BackgroundAssetStore { return this.assetStore ??= new BackgroundAssetStore(dirname(getConfigPath(this.agentDir))); }
  private listeners = new Set<(cfg: OmtConfig) => void>();

  constructor(agentDir?: string) {
    this.agentDir = agentDir;
    this.savedDefaults = cloneConfig(DEFAULT_CONFIG);
  }

  init(agentDir?: string): void {
    if (agentDir) this.agentDir = agentDir;
    this.assetStore?.dispose();
    this.assetStore = undefined;
    this.savedDefaults = loadConfig(this.agentDir);
    this.overrides = {};
    this.notify();
  }

  getSavedDefaults(): OmtConfig {
    return cloneConfig(this.savedDefaults);
  }

  getOverrides(): SessionOverrides {
    return {
      preset: this.overrides.preset,
      signature: this.overrides.signature ? { ...this.overrides.signature, favorites: this.overrides.signature.favorites ? [...this.overrides.signature.favorites] : undefined, visible: { ...this.overrides.signature.visible }, folds: { ...this.overrides.signature.folds } } : undefined,
      components: this.overrides.components ? { ...this.overrides.components } : undefined,
      animation: this.overrides.animation ? { ...this.overrides.animation } : undefined,
      background: this.overrides.background ? { ...this.overrides.background,
        ...(this.overrides.background.presetAssets ? { presetAssets: { ...this.overrides.background.presetAssets } } : {}),
        ...(this.overrides.background.presetScenes ? { presetScenes: { ...this.overrides.background.presetScenes } } : {}),
      } : undefined,
    };
  }

  getEffectiveConfig(): OmtConfig {
    return {
      version: 1,
      preset: this.overrides.preset ?? this.savedDefaults.preset,
      signature: this.getSignature(),
      components: {
        ...this.savedDefaults.components,
        ...this.overrides.components,
      },
      animation: {
        ...this.savedDefaults.animation,
        ...this.overrides.animation,
      },
      background: {
        ...this.savedDefaults.background,
        ...this.overrides.background,
        presetAssets: { ...(this.overrides.background?.presetAssets ?? this.savedDefaults.background.presetAssets) },
        presetScenes: {
          ...this.savedDefaults.background.presetScenes,
          ...this.overrides.background?.presetScenes,
        },
      },
    };
  }

  getSignature(): SignaturePreferences {
    const value = { ...this.savedDefaults.signature, ...this.overrides.signature };
    return { ...value, favorites: [...value.favorites], visible: { ...value.visible }, folds: { ...value.folds } };
  }

  getSignaturePalette(): string {
    return this.overrides.signature?.palette ?? this.savedDefaults.signature.palette;
  }

  setSignatureOverride<K extends keyof SignaturePreferences>(key: K, value: SignaturePreferences[K] | undefined): void {
    if (value === undefined) {
      if (this.overrides.signature) {
        delete this.overrides.signature[key];
        if (Object.keys(this.overrides.signature).length === 0) delete this.overrides.signature;
      }
    } else {
      this.overrides.signature = { ...this.overrides.signature, [key]: signatureConfig({ ...this.getSignature(), [key]: value })[key] };
    }
    this.notify();
  }

  /** Confirm one presentation preference without persisting unrelated session overrides. */
  setSignatureDefault<K extends keyof SignaturePreferences>(key: K, value: SignaturePreferences[K]): boolean {
    const signature = signatureConfig({ ...this.savedDefaults.signature, [key]: value });
    const next = { ...this.savedDefaults, signature };
    if (!saveConfig(next, this.agentDir)) return false;
    this.savedDefaults = next;
    this.notify();
    return true;
  }

  getPreset(): ThemeName {
    return this.overrides.preset ?? this.savedDefaults.preset;
  }

  isComponentEnabled(name: keyof OmtComponentsConfig): boolean {
    return this.overrides.components?.[name] ?? this.savedDefaults.components[name];
  }

  getAnimation(): OmtAnimationConfig {
    return {
      ...this.savedDefaults.animation,
      ...this.overrides.animation,
    };
  }

  getBackground(): OmtBackgroundConfig {
    return {
      ...this.savedDefaults.background,
      ...this.overrides.background,
      presetAssets: { ...(this.overrides.background?.presetAssets ?? this.savedDefaults.background.presetAssets) },
      presetScenes: {
        ...this.savedDefaults.background.presetScenes,
        ...this.overrides.background?.presetScenes,
      },
    };
  }

  isBackgroundEnabled(): boolean {
    const bg = this.getBackground();
    return bg.enabled && bg.mode !== "off";
  }

  getEffectiveBackgroundAsset(): string | null {
    const bg = this.getBackground();
    return bg.presetAssets[this.getPreset()] !== undefined ? bg.presetAssets[this.getPreset()]! : bg.assetId;
  }

  selectBackgroundAsset(id: string | null, perPreset = false): void {
    if (id !== null) {
      const resolved = this.assets.resolveId(id);
      if (!resolved) throw new Error(`Unknown background asset "${id}"`);
      this.assets.load(resolved);
      id = resolved;
    }
    if (perPreset) this.setBackgroundOverride("presetAssets", { ...this.getBackground().presetAssets, [this.getPreset()]: id });
    else {
      // Explicit global selection also clears the active preset's assignment.
      const assignments = { ...this.getBackground().presetAssets };
      delete assignments[this.getPreset()];
      this.setBackgroundOverride("presetAssets", assignments);
      this.setBackgroundOverride("assetId", id);
    }
  }

  removeBackgroundAsset(id: string): void {
    this.assets.remove(id);
    const scrub = (bg: Partial<OmtBackgroundConfig>) => {
      if (bg.assetId === id) bg.assetId = null;
      for (const name of THEME_NAMES) if (bg.presetAssets?.[name] === id) bg.presetAssets[name] = null;
    };
    scrub(this.savedDefaults.background);
    if (this.overrides.background) scrub(this.overrides.background);
    if (!saveConfig(this.savedDefaults, this.agentDir)) throw new Error("Asset removed, but saved preferences could not be updated");
    this.notify();
  }

  getEffectiveBackgroundScene(): BackgroundScene {
    const bg = this.getBackground();
    const currentPreset = this.getPreset();
    if (bg.presetScenes?.[currentPreset]) {
      return bg.presetScenes[currentPreset]!;
    }
    return bg.scene;
  }

  /**
   * Set and persist the default theme preset to disk.
   */
  setPreset(preset: ThemeName): boolean {
    this.savedDefaults = {
      ...this.savedDefaults,
      preset,
    };
    if (this.overrides.preset !== undefined) {
      delete this.overrides.preset;
    }
    const ok = saveConfig(this.savedDefaults, this.agentDir);
    this.notify();
    return ok;
  }

  /**
   * Set a session-local override (e.g. from `/omt editor off` or `/omt theme opencode`).
   */
  setPresetOverride(preset: ThemeName | undefined): void {
    this.overrides.preset = preset;
    this.notify();
  }

  setComponentOverride(name: keyof OmtComponentsConfig, enabled: boolean | undefined): void {
    if (enabled === undefined) {
      if (this.overrides.components) {
        delete this.overrides.components[name];
        if (Object.keys(this.overrides.components).length === 0) {
          delete this.overrides.components;
        }
      }
    } else {
      if (!this.overrides.components) this.overrides.components = {};
      this.overrides.components[name] = enabled;
    }
    this.notify();
  }

  setAnimationOverride(key: keyof OmtAnimationConfig, value: unknown): void {
    if (value === undefined) {
      if (this.overrides.animation) {
        delete this.overrides.animation[key];
        if (Object.keys(this.overrides.animation).length === 0) {
          delete this.overrides.animation;
        }
      }
    } else {
      if (!this.overrides.animation) this.overrides.animation = {};
      (this.overrides.animation as Record<string, unknown>)[key] = value;
    }
    this.notify();
  }

  setBackgroundOverride(key: keyof OmtBackgroundConfig, value: unknown): void {
    if (value === undefined) {
      if (this.overrides.background) {
        delete this.overrides.background[key];
        if (Object.keys(this.overrides.background).length === 0) {
          delete this.overrides.background;
        }
      }
    } else {
      if (!this.overrides.background) this.overrides.background = {};
      (this.overrides.background as Record<string, unknown>)[key] = validateConfig({ background: { ...this.getBackground(), [key]: value } }).background[key];
    }
    this.notify();
  }

  setPresetSceneOverride(preset: ThemeName, scene: BackgroundScene): void {
    if (!this.overrides.background) this.overrides.background = {};
    const existingPresetScenes = this.overrides.background.presetScenes ?? {};
    this.overrides.background.presetScenes = {
      ...existingPresetScenes,
      [preset]: scene,
    };
    this.notify();
  }

  clearSessionOverrides(): void {
    this.overrides = {};
    this.notify();
  }

  hasOverride(category: "preset" | "components" | "animation" | "background" | string): boolean {
    if (category === "preset") return this.overrides.preset !== undefined;
    if (category === "signature") return !!this.overrides.signature;
    if (category === "components") return !!this.overrides.components && Object.keys(this.overrides.components).length > 0;
    if (category === "animation") return !!this.overrides.animation && Object.keys(this.overrides.animation).length > 0;
    if (category === "background") return !!this.overrides.background && Object.keys(this.overrides.background).length > 0;
    if (category in DEFAULT_CONFIG.components) {
      return this.overrides.components?.[category as keyof OmtComponentsConfig] !== undefined;
    }
    if (category in DEFAULT_CONFIG.background) {
      return this.overrides.background?.[category as keyof OmtBackgroundConfig] !== undefined;
    }
    return false;
  }

  hasAnyOverrides(): boolean {
    return this.overrides.preset !== undefined
      || !!this.overrides.signature
      || (!!this.overrides.components && Object.keys(this.overrides.components).length > 0)
      || (!!this.overrides.animation && Object.keys(this.overrides.animation).length > 0)
      || (!!this.overrides.background && Object.keys(this.overrides.background).length > 0);
  }

  /**
   * Persists the current effective runtime state to disk as the new defaults,
   * clearing session overrides that now match the saved state.
   */
  saveCurrentAsDefaults(): boolean {
    const effective = this.getEffectiveConfig();
    const ok = saveConfig(effective, this.agentDir);
    if (ok) {
      this.savedDefaults = cloneConfig(effective);
      this.overrides = {};
      this.notify();
    }
    return ok;
  }

  /**
   * Restores all settings to factory defaults:
   * clears session overrides and persists DEFAULT_CONFIG to disk.
   */
  restoreDefaults(): boolean {
    const ok = saveConfig(cloneConfig(DEFAULT_CONFIG), this.agentDir);
    this.savedDefaults = cloneConfig(DEFAULT_CONFIG);
    this.overrides = {};
    this.notify();
    return ok;
  }

  subscribe(listener: (config: OmtConfig) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    const effective = this.getEffectiveConfig();
    for (const listener of this.listeners) {
      try {
        listener(effective);
      } catch {
        /* ignore listener errors */
      }
    }
  }
}

export const configStore = new ConfigStore();

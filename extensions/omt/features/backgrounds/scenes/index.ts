import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { renderScaledWallpaper } from "../compositor/scale.ts";
import type {
  BackgroundDimming,
  BackgroundIntensity,
  BackgroundMode,
  BackgroundScene,
} from "../../../core/config.ts";
import type { ThemeName } from "../../../presets/shared/types.ts";
import { CLAUDE_THEME_SCENES, renderProceduralScene, isClaudeThemeScene, type ProceduralScene } from "./procedural.ts";
import { applyDimming, formatRgb, formatRgbBg, lerpColor, formatCellFg, formatCellBg, validCellViewport } from "../renderers/cell.ts";
import { evaluateFullBackdropSupport, type FullBackdropEvaluation, type ColorMode } from "../capabilities/index.ts";

export type {
  BackgroundDimming,
  BackgroundIntensity,
  BackgroundMode,
  BackgroundScene,
  ThemeName,
  FullBackdropEvaluation,
};

export {
  CLAUDE_THEME_SCENES,
  renderProceduralScene,
  isClaudeThemeScene,
  applyDimming,
  formatRgb,
  formatRgbBg,
  lerpColor,
  evaluateFullBackdropSupport,
};

export interface PresetBackgroundPalette {
  readonly primary: readonly [number, number, number];
  readonly secondary: readonly [number, number, number];
  readonly dim: readonly [number, number, number];
  readonly glow?: readonly [number, number, number];
  readonly ambientBg?: readonly [number, number, number];
  readonly label?: string;
  readonly defaultScene?: BackgroundScene;
}

export interface SceneRenderOptions {
  width: number;
  height: number;
  timeMs: number;
  speed?: number;
  intensity?: BackgroundIntensity;
  dimming?: BackgroundDimming;
  reducedMotion?: boolean;
  preset?: ThemeName;
  palette?: PresetBackgroundPalette;
  asciiOnly?: boolean;
  mode?: BackgroundMode;
  framing?: "bracket" | "rail" | "rule" | "none";
  density?: number;
  particleCount?: number;
  textureScale?: number;
  colorMode?: ColorMode;
}

function fitRow(rawText: string, targetWidth: number): string {
  if (targetWidth <= 0) return "";
  const vis = visibleWidth(rawText);
  if (vis === targetWidth) return rawText;
  if (vis > targetWidth) return truncateToWidth(rawText, targetWidth, "", true);
  return rawText + " ".repeat(targetWidth - vis);
}

// Pseudo-random deterministic hash for noise/stars
function pseudoNoise(x: number, y: number, seed = 42): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

export interface SceneImplementation {
  name: BackgroundScene;
  label: string;
  description: string;
  render(opts: SceneRenderOptions): string[];
}

/**
 * 1. Aurora: Undulating celestial atmospheric curtains with waving color ribbons.
 */
export const auroraScene: SceneImplementation = {
  name: "aurora",
  label: "Aurora Borealis",
  description: "Undulating celestial atmospheric curtains with waving color ribbons",
  render(opts: SceneRenderOptions): string[] {
    const { width, height, timeMs, speed = 1.0, intensity = "medium", dimming = "subtle", reducedMotion, asciiOnly, colorMode = "truecolor" } = opts;
    if (width <= 0 || height <= 0) return [];

    const p = opts.palette ?? {
      primary: [0, 240, 160],
      secondary: [60, 200, 255],
      dim: [80, 50, 180],
      glow: [210, 120, 255],
    };

    const effectiveTime = reducedMotion ? 12345 : timeMs * speed;
    const waveAmp = intensity === "high" ? 2.5 : intensity === "low" ? 1.0 : 1.8;
    const glyphs = asciiOnly ? ["~", "-", "=", "*", ".", "+"] : ["░", "▒", "≈", "~", "·", "*", "•"];

    const lines: string[] = [];

    for (let y = 0; y < height; y++) {
      let rowStr = "";
      for (let x = 0; x < width; x++) {
        // Multi-frequency wave formula
        const nx = x * 0.07;
        const nt = effectiveTime * 0.0018;
        const wave1 = Math.sin(nx + nt);
        const wave2 = Math.sin(nx * 1.7 - nt * 0.8) * 0.5;
        const wave3 = Math.cos(nx * 0.5 + nt * 1.2) * 0.3;
        const waveVal = (wave1 + wave2 + wave3) * waveAmp;

        const targetY = (height / 2) + waveVal;
        const dist = Math.abs(y - targetY);

        if (dist < 1.8) {
          const intensityNorm = Math.max(0, 1 - dist / 1.8);
          const colorT = (Math.sin(nx * 0.5 + nt * 0.5) + 1) / 2;
          const baseColor = lerpColor(p.primary, p.secondary, colorT);
          const finalColor = lerpColor(baseColor, p.glow ?? [220, 255, 230], intensityNorm * 0.6);
          const dimmed = applyDimming(finalColor, dimming);

          const gIdx = Math.floor(intensityNorm * (glyphs.length - 1));
          const char = glyphs[gIdx] ?? glyphs[0]!;
          rowStr += formatCellFg(dimmed[0], dimmed[1], dimmed[2], char, colorMode);
        } else if (dist < 3.2 && intensity !== "low") {
          const faintNorm = Math.max(0, 1 - dist / 3.2) * 0.4;
          const dimmed = applyDimming(p.dim, dimming);
          const char = glyphs[0]!;
          rowStr += formatCellFg(dimmed[0] * faintNorm, dimmed[1] * faintNorm, dimmed[2] * faintNorm, char, colorMode);
        } else {
          rowStr += " ";
        }
      }
      lines.push(fitRow(rowStr, width));
    }

    return lines;
  },
};

/**
 * 2. Starfield: Parallax celestial cosmos with drifting stars and twinkling nebulae.
 */
export const starfieldScene: SceneImplementation = {
  name: "starfield",
  label: "Deep Starfield",
  description: "Parallax celestial cosmos with drifting stars and twinkling nebulae",
  render(opts: SceneRenderOptions): string[] {
    const { width, height, timeMs, speed = 1.0, intensity = "medium", dimming = "subtle", reducedMotion, asciiOnly, colorMode = "truecolor" } = opts;
    if (width <= 0 || height <= 0) return [];

    const p = opts.palette ?? {
      primary: [255, 255, 255],
      secondary: [160, 200, 255],
      dim: [60, 80, 140],
      glow: [255, 230, 160],
    };

    const effectiveTime = reducedMotion ? 54321 : timeMs * speed;
    const densityMod = (intensity === "high" ? 0.08 : intensity === "low" ? 0.03 : 0.05) * (opts.density ?? 1);
    const starGlyphs = asciiOnly ? ["*", "+", ".", "x"] : ["✦", "★", "*", "·", "•", "✧"];

    const lines: string[] = [];

    for (let y = 0; y < height; y++) {
      let rowStr = "";
      for (let x = 0; x < width; x++) {
        // 3 parallax layers with different drift speeds
        let hasStar = false;
        let starChar = " ";
        let starColor: readonly [number, number, number] = [0, 0, 0];

        // Layer 1: Distant faint stars (slow)
        const l1Drift = Math.floor(effectiveTime * 0.003);
        const l1X = (x + l1Drift) % (width * 2);
        const n1 = pseudoNoise(l1X, y, 101);
        if (n1 < densityMod) {
          hasStar = true;
          starChar = asciiOnly ? "." : "·";
          starColor = p.dim;
        }

        // Layer 2: Mid-distance stars
        if (!hasStar) {
          const l2Drift = Math.floor(effectiveTime * 0.008);
          const l2X = (x + l2Drift) % (width * 3);
          const n2 = pseudoNoise(l2X, y, 202);
          if (n2 < densityMod * 0.6) {
            hasStar = true;
            starChar = starGlyphs[2] ?? "*";
            starColor = p.secondary;
          }
        }

        // Layer 3: Foreground bright twinkling stars
        if (!hasStar) {
          const l3Drift = Math.floor(effectiveTime * 0.015);
          const l3X = (x + l3Drift) % (width * 4);
          const n3 = pseudoNoise(l3X, y, 303);
          if (n3 < densityMod * 0.25) {
            hasStar = true;
            // Twinkle cycle
            const twinklePhase = Math.sin((effectiveTime * 0.004) + (x * 0.3) + (y * 0.7));
            const isTwinkling = twinklePhase > 0.3;
            starChar = isTwinkling ? (starGlyphs[0] ?? "*") : (starGlyphs[3] ?? "·");
            starColor = isTwinkling ? (p.glow ?? [255, 240, 180]) : p.primary;
          }
        }

        if (hasStar) {
          const dimmed = applyDimming(starColor, dimming);
          rowStr += formatCellFg(dimmed[0], dimmed[1], dimmed[2], starChar, colorMode);
        } else {
          rowStr += " ";
        }
      }
      lines.push(fitRow(rowStr, width));
    }

    return lines;
  },
};

/**
 * 3. Rain: Cyberpunk rainfall streaks with terminal ripple splashes.
 */
export const rainScene: SceneImplementation = {
  name: "rain",
  label: "Atmospheric Rain",
  description: "Atmospheric cyberpunk rainfall streaks with velocity gradients and bottom splash ripples",
  render(opts: SceneRenderOptions): string[] {
    const { width, height, timeMs, speed = 1.0, intensity = "medium", dimming = "subtle", reducedMotion, asciiOnly, colorMode = "truecolor" } = opts;
    if (width <= 0 || height <= 0) return [];

    const p = opts.palette ?? {
      primary: [0, 220, 255],
      secondary: [0, 140, 200],
      dim: [20, 60, 100],
      glow: [180, 240, 255],
    };

    const effectiveTime = reducedMotion ? 99999 : timeMs * speed;
    const fallSpeed = 0.012;
    const dropDensity = (intensity === "high" ? 0.12 : intensity === "low" ? 0.04 : 0.08) * (opts.density ?? 1);
    const dropChars = asciiOnly ? ["|", "!", ":", "."] : ["│", "┃", "┆", "·", "•", "°"];
    const rippleChars = asciiOnly ? ["-", "=", "~", "."] : ["~", "≈", "·", "°", "╌"];

    const lines: string[] = [];

    for (let y = 0; y < height; y++) {
      let rowStr = "";
      for (let x = 0; x < width; x++) {
        // Slanted fall: x shifts slightly with y
        const fallOffset = Math.floor(effectiveTime * fallSpeed);
        const virtualY = (y - fallOffset + 10000);
        const colHash = pseudoNoise(x, Math.floor(virtualY / 4), 505);

        let isDrop = false;
        let isHead = false;
        let isSplash = false;

        // Bottom row splash ripple check
        if (y === height - 1) {
          const splashNoise = pseudoNoise(x, Math.floor(effectiveTime * 0.005), 707);
          if (splashNoise < dropDensity * 1.5) {
            isSplash = true;
          }
        }

        if (!isSplash && colHash < dropDensity) {
          const subY = virtualY % 4;
          if (subY === 0) {
            isDrop = true;
            isHead = true;
          } else if (subY <= 2) {
            isDrop = true;
          }
        }

        if (isSplash) {
          const dimmed = applyDimming(p.glow ?? [180, 240, 255], dimming);
          const rChar = rippleChars[Math.floor(pseudoNoise(x, y, 909) * rippleChars.length)] ?? "~";
          rowStr += formatCellFg(dimmed[0], dimmed[1], dimmed[2], rChar, colorMode);
        } else if (isDrop) {
          const color = isHead ? (p.glow ?? p.primary) : p.secondary;
          const dimmed = applyDimming(color, dimming);
          const dChar = isHead ? (dropChars[1] ?? "|") : (dropChars[0] ?? "|");
          rowStr += formatCellFg(dimmed[0], dimmed[1], dimmed[2], dChar, colorMode);
        } else {
          rowStr += " ";
        }
      }
      lines.push(fitRow(rowStr, width));
    }

    return lines;
  },
};

/**
 * 4. Matrix: Cyber code cascade with glowing character heads and fading phosphor trails.
 */
export const matrixScene: SceneImplementation = {
  name: "matrix",
  label: "Digital Phosphor Matrix",
  description: "Digital phosphor cyber code cascades with glowing heads and fading trails",
  render(opts: SceneRenderOptions): string[] {
    const { width, height, timeMs, speed = 1.0, intensity = "medium", dimming = "subtle", reducedMotion, asciiOnly, colorMode = "truecolor" } = opts;
    if (width <= 0 || height <= 0) return [];

    const p = opts.palette ?? {
      primary: [0, 255, 120],
      secondary: [0, 180, 80],
      dim: [0, 70, 30],
      glow: [220, 255, 230],
    };

    const effectiveTime = reducedMotion ? 33333 : timeMs * speed;
    const fallSpeed = 0.007;
    const streamDensity = (intensity === "high" ? 0.35 : intensity === "low" ? 0.15 : 0.25) * (opts.density ?? 1);

    const matrixChars = asciiOnly
      ? ["0", "1", "x", "z", "k", "7", "#", "*", "+", ":"]
      : ["0", "1", "ﾊ", "ﾐ", "ﾋ", "ｰ", "ｳ", "ｼ", "ﾅ", "ﾓ", "ｸ", "ﾘ", "0", "1", "Z", "X", "7", "9", ":", "•"];

    const lines: string[] = [];

    for (let y = 0; y < height; y++) {
      let rowStr = "";
      for (let x = 0; x < width; x++) {
        const streamActive = pseudoNoise(x, 0, 777) < streamDensity;

        if (!streamActive) {
          rowStr += " ";
          continue;
        }

        const streamLen = 5 + Math.floor(pseudoNoise(x, 1, 888) * 8);
        const streamSpeed = fallSpeed * (0.8 + pseudoNoise(x, 2, 999) * 0.6);
        const yHead = Math.floor((effectiveTime * streamSpeed) + (pseudoNoise(x, 3, 111) * 20)) % (height + streamLen);
        const distFromHead = yHead - y;

        if (distFromHead >= 0 && distFromHead < streamLen) {
          const charIdx = Math.floor(pseudoNoise(x, y + Math.floor(effectiveTime * 0.002), 444) * matrixChars.length);
          const char = matrixChars[charIdx] ?? "1";

          let cellColor: readonly [number, number, number];
          if (distFromHead === 0) {
            cellColor = p.glow ?? [220, 255, 230];
          } else if (distFromHead < 3) {
            cellColor = p.primary;
          } else {
            const fade = 1 - (distFromHead / streamLen);
            cellColor = lerpColor(p.dim, p.secondary, fade);
          }

          const dimmed = applyDimming(cellColor, dimming);
          rowStr += formatCellFg(dimmed[0], dimmed[1], dimmed[2], char, colorMode);
        } else {
          rowStr += " ";
        }
      }
      lines.push(fitRow(rowStr, width));
    }

    return lines;
  },
};

/**
 * 5. Particles: Floating harmonic dust motes and organic orbital energy specks.
 */
export const particlesScene: SceneImplementation = {
  name: "particles",
  label: "Ambient Dust Motes",
  description: "Ambient dust motes undergoing harmonic brownian and orbital motion",
  render(opts: SceneRenderOptions): string[] {
    const { width, height, timeMs, speed = 1.0, intensity = "medium", dimming = "subtle", reducedMotion, asciiOnly, colorMode = "truecolor" } = opts;
    if (width <= 0 || height <= 0) return [];

    const p = opts.palette ?? {
      primary: [255, 200, 100],
      secondary: [220, 130, 80],
      dim: [80, 50, 40],
      glow: [255, 240, 200],
    };

    const effectiveTime = reducedMotion ? 77777 : timeMs * speed;
    const baseCount = Math.round(width * (intensity === "high" ? 0.35 : intensity === "low" ? 0.15 : 0.22) * (opts.density ?? 1));
    const count = opts.particleCount ?? baseCount;
    const moteChars = asciiOnly ? ["*", "o", "+", "."] : ["•", "·", "°", "✦", "*", "∘"];

    // Initialize blank grid
    const grid: ({ char: string; color: readonly [number, number, number] } | null)[][] = Array.from(
      { length: height },
      () => Array(width).fill(null),
    );

    for (let i = 0; i < count; i++) {
      const seedX = pseudoNoise(i, 10, 12);
      const seedY = pseudoNoise(i, 20, 34);
      const freqX = 0.0008 + pseudoNoise(i, 30, 56) * 0.0012;
      const freqY = 0.0005 + pseudoNoise(i, 40, 78) * 0.0010;

      // Harmonic Lissajous motion
      const px = Math.floor((seedX * width) + (Math.sin((effectiveTime * freqX) + (seedY * 6.28)) * (width * 0.25))) % width;
      const py = Math.floor((seedY * height) + (Math.cos((effectiveTime * freqY) + (seedX * 6.28)) * (height * 0.35))) % height;

      const safeX = (px + width) % width;
      const safeY = (py + height) % py < 0 ? 0 : py >= height ? height - 1 : py;

      if (safeY >= 0 && safeY < height && safeX >= 0 && safeX < width) {
        const pulse = (Math.sin((effectiveTime * 0.003) + (i * 0.8)) + 1) / 2;
        const charIdx = Math.floor(pulse * (moteChars.length - 1));
        const char = moteChars[charIdx] ?? moteChars[0]!;

        const color = pulse > 0.6 ? (p.glow ?? p.primary) : pulse > 0.3 ? p.secondary : p.dim;
        grid[safeY]![safeX] = { char, color };
      }
    }

    const lines: string[] = [];
    for (let y = 0; y < height; y++) {
      let rowStr = "";
      for (let x = 0; x < width; x++) {
        const cell = grid[y]![x];
        if (cell) {
          const dimmed = applyDimming(cell.color, dimming);
          rowStr += formatCellFg(dimmed[0], dimmed[1], dimmed[2], cell.char, colorMode);
        } else {
          rowStr += " ";
        }
      }
      lines.push(fitRow(rowStr, width));
    }

    return lines;
  },
};

// ==========================================
// Scene Registry & Dispatcher
// ==========================================

export const BUILTIN_SCENES: Readonly<Record<BackgroundScene, SceneImplementation>> = Object.freeze({
  aurora: auroraScene,
  starfield: starfieldScene,
  rain: rainScene,
  matrix: matrixScene,
  particles: particlesScene,
  // Curated procedural scenes
  moonlit: { name: "moonlit", label: "Moonlit", description: "Crescent moon shining over serene mountains and tranquil clouds", render: (opts) => renderProceduralScene("moonlit", opts.width, opts.height, opts.timeMs, opts) },
  "cloud-drift": { name: "cloud-drift", label: "Cloud Drift", description: "Floating volumetric clouds over vibrant gradient skies", render: (opts) => renderProceduralScene("cloud-drift", opts.width, opts.height, opts.timeMs, opts) },
  "honu-lagoon": { name: "honu-lagoon", label: "Honu Lagoon", description: "Pacific sea turtle swimming through turquoise coral reef waters", render: (opts) => renderProceduralScene("honu-lagoon", opts.width, opts.height, opts.timeMs, opts) },
  "koi-pond": { name: "koi-pond", label: "Koi Pond", description: "Graceful Japanese koi carp swimming beneath lotus lily pads", render: (opts) => renderProceduralScene("koi-pond", opts.width, opts.height, opts.timeMs, opts) },
  jellyfish: { name: "jellyfish", label: "Bioluminescent Jellyfish", description: "Floating luminescent sea jellies undulating in abyssal ocean depths", render: (opts) => renderProceduralScene("jellyfish", opts.width, opts.height, opts.timeMs, opts) },
  "lantern-night": { name: "lantern-night", label: "Lantern Night", description: "Glowing sky paper lanterns rising into midnight mountain peaks", render: (opts) => renderProceduralScene("lantern-night", opts.width, opts.height, opts.timeMs, opts) },
  fireflies: { name: "fireflies", label: "Twilight Fireflies", description: "Soft glowing insect motes hovering over quiet summer reeds", render: (opts) => renderProceduralScene("fireflies", opts.width, opts.height, opts.timeMs, opts) },
  "neon-rain": { name: "neon-rain", label: "Neon Rain", description: "Cyberpunk neon rain reflections across futuristic Tokyo cityscapes", render: (opts) => renderProceduralScene("neon-rain", opts.width, opts.height, opts.timeMs, opts) },
  "sakura-dusk": { name: "sakura-dusk", label: "Sakura Dusk", description: "Drifting cherry blossom petals swirling over Mount Fuji sunsets", render: (opts) => renderProceduralScene("sakura-dusk", opts.width, opts.height, opts.timeMs, opts) },
  "snow-cabin": { name: "snow-cabin", label: "Snow Cabin", description: "Cozy timber cabin with glowing windows nestled under winter pine snow", render: (opts) => renderProceduralScene("snow-cabin", opts.width, opts.height, opts.timeMs, opts) },
  "star-voyage": { name: "star-voyage", label: "Star Voyage", description: "Interstellar space probe drifting past ringed planets and nebula belts", render: (opts) => renderProceduralScene("star-voyage", opts.width, opts.height, opts.timeMs, opts) },
});

export function getSceneImplementation(scene: BackgroundScene): SceneImplementation {
  if (scene in BUILTIN_SCENES) {
    return BUILTIN_SCENES[scene];
  }
  return auroraScene;
}

export function formatSceneFraming(
  lines: string[],
  targetWidth: number,
  framing: "bracket" | "rail" | "rule" | "none" = "none",
  palette?: PresetBackgroundPalette,
  asciiOnly = false,
  colorMode: ColorMode = "truecolor",
): string[] {
  if (framing === "none" || targetWidth <= 0) {
    return lines.map((l) => fitRow(l, targetWidth));
  }

  const dimColor = palette?.dim ?? [80, 80, 80];
  const secColor = palette?.secondary ?? [120, 120, 120];

  return lines.map((line) => {
    let formatted = line;

    if (framing === "bracket") {
      if (targetWidth >= 40) {
        const leftBracket = asciiOnly ? "| " : "╎ ";
        const rightBracket = asciiOnly ? " |" : " ╎";
        const innerWidth = Math.max(1, targetWidth - 4);
        const fittedInner = fitRow(line, innerWidth);
        const styledLeft = formatCellFg(dimColor[0], dimColor[1], dimColor[2], leftBracket, colorMode);
        const styledRight = formatCellFg(dimColor[0], dimColor[1], dimColor[2], rightBracket, colorMode);
        formatted = styledLeft + fittedInner + styledRight;
      } else if (targetWidth >= 20) {
        const leftBracket = asciiOnly ? "|" : "╎";
        const rightBracket = asciiOnly ? "|" : "╎";
        const innerWidth = Math.max(1, targetWidth - 2);
        const fittedInner = fitRow(line, innerWidth);
        const styledLeft = formatCellFg(dimColor[0], dimColor[1], dimColor[2], leftBracket, colorMode);
        const styledRight = formatCellFg(dimColor[0], dimColor[1], dimColor[2], rightBracket, colorMode);
        formatted = styledLeft + fittedInner + styledRight;
      } else {
        formatted = fitRow(line, targetWidth);
      }
    } else if (framing === "rail") {
      if (targetWidth >= 30) {
        const leftRail = asciiOnly ? "| " : "┃ ";
        const innerWidth = Math.max(1, targetWidth - 2);
        const fittedInner = fitRow(line, innerWidth);
        const styledRail = formatCellFg(secColor[0], secColor[1], secColor[2], leftRail, colorMode);
        formatted = styledRail + fittedInner;
      } else {
        const leftRail = asciiOnly ? "|" : "┃";
        const innerWidth = Math.max(1, targetWidth - 1);
        const fittedInner = fitRow(line, innerWidth);
        const styledRail = formatCellFg(secColor[0], secColor[1], secColor[2], leftRail, colorMode);
        formatted = styledRail + fittedInner;
      }
    } else if (framing === "rule") {
      if (targetWidth >= 40) {
        const leftPad = "  ";
        const rightPad = "  ";
        const innerWidth = Math.max(1, targetWidth - 4);
        const fittedInner = fitRow(line, innerWidth);
        formatted = leftPad + fittedInner + rightPad;
      } else {
        formatted = fitRow(line, targetWidth);
      }
    }

    return fitRow(formatted, targetWidth);
  });
}

/**
 * Renders dedicated scene viewport (2-4 rows tall).
 */
export function renderSceneViewport(options: SceneRenderOptions & { scene: BackgroundScene }): string[] {
  const impl = getSceneImplementation(options.scene);
  const width = options.width;
  if (!validCellViewport(width, options.height)) return [];
  const framing = options.framing;
  const render = (w: number) => renderScaledWallpaper(w, options.height, options.textureScale,
    (width, height) => impl.render({ ...options, width, height, textureScale: 1 }));

  if (!framing || framing === "none") {
    return render(width);
  }

  let gutterWidth = 0;
  if (framing === "bracket") {
    gutterWidth = width >= 40 ? 4 : width >= 20 ? 2 : 0;
  } else if (framing === "rail") {
    gutterWidth = width >= 30 ? 2 : 1;
  } else if (framing === "rule") {
    gutterWidth = width >= 40 ? 4 : 0;
  }

  const innerWidth = Math.max(1, width - gutterWidth);
  const innerLines = render(innerWidth);
  return formatSceneFraming(innerLines, width, framing, options.palette, options.asciiOnly, options.colorMode);
}

/**
 * Renders subtle ambient backdrop (1-2 rows tall) for interactive widgets.
 */
export function renderAmbientBackdrop(options: SceneRenderOptions & { scene: BackgroundScene }): string[] {
  if (!validCellViewport(options.width, options.height)) return [];
  const ambientOpts: SceneRenderOptions & { scene: BackgroundScene } = {
    ...options,
    height: Math.max(1, Math.min(2, options.height || 1)),
    dimming: "dim", // Ambient mode defaults to very subtle contrast
    framing: "none",
  };
  return renderSceneViewport(ambientOpts);
}

/**
 * Signature rendering utilities and palette definitions.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { indexedColor, rgbColor, sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { ansiBackground } from "../shared/rendering.ts";
import { configStore } from "../../core/config.ts";
import { type ResolvedPalette, getPalette } from "./palette.ts";

export const SIGNATURE_FRAME_MS = 100;
export const SIGNATURE_SPINNER_FRAMES = ["◈", "◇", "◆", "◇"] as const;
export const OMT_BRAILLE_SPINNER_FRAMES = [
  "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"
] as const;

export type SignatureColorRole =
  | "accent"
  | "border"
  | "muted"
  | "text"
  | "code"
  | "green"
  | "red"
  | "yellow"
  | "cyan"
  | "plan"
  | "shell"
  | "input"
  | "inputDim"
  | "hiBg"
  | "hiFg"
  | "toolPending"
  | "toolSuccess"
  | "toolError"
  | "toolNeutral"
  | "dim"
  | "teal"
  | "indigo"
  | "success"
  | "warning"
  | "error"
  | "surface"
  | "toolFrame"
  | "toolFrameRun"
  | "toolFrameErr"
  | "toolRead"
  | "toolWrite"
  | "toolEdit"
  | "toolShell"
  | "toolDir"
  | "toolSearch"
  | "toolOther";

export interface PaletteSpec {
  rgb: [number, number, number];
  ansi256: number;
  raw?: string;
  hex?: string;
}

/**
 * OMT Default Monochrome palette (opencode-like, subtle borders, dim text, no rainbow).
 */
export const OMT_DEFAULT_PALETTE: Record<SignatureColorRole, PaletteSpec> = {
  accent: { rgb: [255, 255, 255], ansi256: 15 },    // cAccent: ANSI 15 (white / bright white)
  border: { rgb: [88, 88, 88], ansi256: 240 },       // cBorder: ANSI 240 (dark gray)
  muted: { rgb: [118, 118, 118], ansi256: 243 },     // cMuted: ANSI 243 (medium dim gray)
  text: { rgb: [208, 208, 208], ansi256: 252 },      // cText: ANSI 252 (light gray / off-white)
  code: { rgb: [188, 188, 188], ansi256: 250 },      // cCode: ANSI 250
  green: { rgb: [135, 215, 135], ansi256: 114 },    // cGreen: ANSI 114 (soft green)
  red: { rgb: [255, 95, 95], ansi256: 203 },         // cRed: ANSI 203 (soft red)
  yellow: { rgb: [255, 255, 0], ansi256: 11 },       // cYellow: ANSI 11 (yellow)
  cyan: { rgb: [0, 205, 205], ansi256: 6 },          // cCyan: ANSI 6 (cyan)
  plan: { rgb: [255, 0, 255], ansi256: 13 },         // cPlan: ANSI 13 (purple)
  shell: { rgb: [0, 205, 205], ansi256: 6 },         // cShell: cCyan
  input: { rgb: [208, 208, 208], ansi256: 252 },     // cInput: ANSI 252
  inputDim: { rgb: [88, 88, 88], ansi256: 240 },     // cInputDim: ANSI 240
  hiBg: { rgb: [68, 68, 68], ansi256: 238 },         // cHiBg: ANSI 238
  hiFg: { rgb: [255, 255, 255], ansi256: 15 },       // cHiFg: ANSI 15
  toolPending: { rgb: [40, 40, 50], ansi256: 236 },  // #282832
  toolSuccess: { rgb: [40, 50, 40], ansi256: 236 },  // #283228
  toolError: { rgb: [60, 40, 40], ansi256: 237 },    // #3c2828
  toolNeutral: { rgb: [43, 43, 51], ansi256: 236 },  // #2b2b33
  dim: { rgb: [118, 118, 118], ansi256: 243 },
  teal: { rgb: [0, 205, 205], ansi256: 6 },
  indigo: { rgb: [255, 0, 255], ansi256: 13 },
  success: { rgb: [135, 215, 135], ansi256: 114 },
  warning: { rgb: [255, 255, 0], ansi256: 11 },
  error: { rgb: [255, 95, 95], ansi256: 203 },
  surface: { rgb: [68, 68, 68], ansi256: 238 },
  toolFrame: { rgb: [88, 88, 88], ansi256: 240 },
  toolFrameRun: { rgb: [118, 118, 118], ansi256: 243 },
  toolFrameErr: { rgb: [255, 95, 95], ansi256: 203 },
  toolRead: { rgb: [0, 205, 205], ansi256: 6 },
  toolWrite: { rgb: [135, 215, 135], ansi256: 114 },
  toolEdit: { rgb: [255, 255, 0], ansi256: 11 },
  toolShell: { rgb: [255, 255, 255], ansi256: 15 },
  toolDir: { rgb: [188, 188, 188], ansi256: 250 },
  toolSearch: { rgb: [208, 208, 208], ansi256: 252 },
  toolOther: { rgb: [118, 118, 118], ansi256: 243 },
};

/**
 * OMT One Dark palette.
 */
export const OMT_ONE_DARK_PALETTE: Record<SignatureColorRole, PaletteSpec> = {
  accent: { rgb: [97, 175, 239], ansi256: 75 },       // #61AFEF
  border: { rgb: [62, 68, 81], ansi256: 238 },        // #3E4451
  muted: { rgb: [92, 99, 112], ansi256: 241 },        // #5C6370
  text: { rgb: [171, 178, 191], ansi256: 249 },       // #ABB2BF
  code: { rgb: [171, 178, 191], ansi256: 249 },       // #ABB2BF
  green: { rgb: [152, 195, 121], ansi256: 114 },      // #98C379
  red: { rgb: [224, 108, 117], ansi256: 168 },        // #E06C75
  yellow: { rgb: [229, 192, 123], ansi256: 180 },     // #E5C07B
  cyan: { rgb: [86, 182, 194], ansi256: 73 },         // #56B6C2
  plan: { rgb: [198, 120, 221], ansi256: 176 },       // #C678DD
  shell: { rgb: [86, 182, 194], ansi256: 73 },        // #56B6C2
  input: { rgb: [97, 175, 239], ansi256: 75 },        // #61AFEF
  inputDim: { rgb: [92, 99, 112], ansi256: 241 },     // #5C6370
  hiBg: { rgb: [62, 68, 81], ansi256: 238 },          // #3E4451
  hiFg: { rgb: [171, 178, 191], ansi256: 249 },       // #ABB2BF
  toolPending: { rgb: [44, 50, 60], ansi256: 237 },   // #2C323C
  toolSuccess: { rgb: [44, 58, 46], ansi256: 237 },   // #2C3A2E
  toolError: { rgb: [62, 44, 44], ansi256: 237 },     // #3E2C2C
  toolNeutral: { rgb: [44, 50, 60], ansi256: 237 },   // #2C323C
  dim: { rgb: [92, 99, 112], ansi256: 241 },
  teal: { rgb: [86, 182, 194], ansi256: 73 },
  indigo: { rgb: [198, 120, 221], ansi256: 176 },
  success: { rgb: [152, 195, 121], ansi256: 114 },
  warning: { rgb: [229, 192, 123], ansi256: 180 },
  error: { rgb: [224, 108, 117], ansi256: 168 },
  surface: { rgb: [62, 68, 81], ansi256: 238 },
  toolFrame: { rgb: [62, 68, 81], ansi256: 238 },
  toolFrameRun: { rgb: [92, 99, 112], ansi256: 241 },
  toolFrameErr: { rgb: [224, 108, 117], ansi256: 168 },
  toolRead: { rgb: [86, 182, 194], ansi256: 73 },
  toolWrite: { rgb: [152, 195, 121], ansi256: 114 },
  toolEdit: { rgb: [229, 192, 123], ansi256: 180 },
  toolShell: { rgb: [97, 175, 239], ansi256: 75 },
  toolDir: { rgb: [171, 178, 191], ansi256: 249 },
  toolSearch: { rgb: [171, 178, 191], ansi256: 249 },
  toolOther: { rgb: [92, 99, 112], ansi256: 241 },
};

/**
 * OMT Light palette.
 */
export const OMT_LIGHT_PALETTE: Record<SignatureColorRole, PaletteSpec> = {
  accent: { rgb: [136, 57, 239], ansi256: 99 },       // #8839EF
  border: { rgb: [204, 208, 218], ansi256: 251 },     // #CCD0DA
  muted: { rgb: [156, 160, 176], ansi256: 247 },      // #9CA0B0
  text: { rgb: [76, 79, 105], ansi256: 239 },         // #4C4F69
  code: { rgb: [92, 95, 119], ansi256: 60 },         // #5C5F77
  green: { rgb: [64, 160, 43], ansi256: 28 },         // #40A02B
  red: { rgb: [210, 15, 57], ansi256: 160 },          // #D20F39
  yellow: { rgb: [223, 142, 29], ansi256: 172 },      // #DF8E1D
  cyan: { rgb: [4, 165, 229], ansi256: 38 },          // #04A5E5
  plan: { rgb: [136, 57, 239], ansi256: 99 },         // #8839EF
  shell: { rgb: [4, 165, 229], ansi256: 38 },         // #04A5E5
  input: { rgb: [136, 57, 239], ansi256: 99 },        // #8839EF
  inputDim: { rgb: [156, 160, 176], ansi256: 247 },   // #9CA0B0
  hiBg: { rgb: [188, 192, 204], ansi256: 250 },       // #BCC0CC
  hiFg: { rgb: [76, 79, 105], ansi256: 239 },         // #4C4F69
  toolPending: { rgb: [230, 233, 239], ansi256: 254 },// #E6E9EF
  toolSuccess: { rgb: [220, 235, 218], ansi256: 253 },// #DCEBDA
  toolError: { rgb: [243, 220, 224], ansi256: 253 },  // #F3DCE0
  toolNeutral: { rgb: [239, 241, 245], ansi256: 255 },// #EFF1F5
  dim: { rgb: [156, 160, 176], ansi256: 247 },
  teal: { rgb: [4, 165, 229], ansi256: 38 },
  indigo: { rgb: [136, 57, 239], ansi256: 99 },
  success: { rgb: [64, 160, 43], ansi256: 28 },
  warning: { rgb: [223, 142, 29], ansi256: 172 },
  error: { rgb: [210, 15, 57], ansi256: 160 },
  surface: { rgb: [188, 192, 204], ansi256: 250 },
  toolFrame: { rgb: [204, 208, 218], ansi256: 251 },
  toolFrameRun: { rgb: [156, 160, 176], ansi256: 247 },
  toolFrameErr: { rgb: [210, 15, 57], ansi256: 160 },
  toolRead: { rgb: [4, 165, 229], ansi256: 38 },
  toolWrite: { rgb: [64, 160, 43], ansi256: 28 },
  toolEdit: { rgb: [223, 142, 29], ansi256: 172 },
  toolShell: { rgb: [136, 57, 239], ansi256: 99 },
  toolDir: { rgb: [92, 95, 119], ansi256: 60 },
  toolSearch: { rgb: [76, 79, 105], ansi256: 239 },
  toolOther: { rgb: [156, 160, 176], ansi256: 247 },
};

let memoPaletteName: string | undefined;
let memoPalette: ResolvedPalette | undefined;

/** Get the configured color representation matching current terminal capabilities. */
export function signatureColor(
  theme: Theme,
  role: SignatureColorRole,
  palette?: string | ResolvedPalette,
) {
  const mode = typeof theme.getColorMode === "function" ? theme.getColorMode() : "truecolor";
  let spec: PaletteSpec;
  const selected = configStore.getSignaturePalette();
  palette ??= selected === "auto" ? undefined : selected;
  if (palette) {
    if (typeof palette === "string" && (memoPaletteName !== palette || !memoPalette)) {
      memoPaletteName = palette;
      memoPalette = getPalette(palette);
    }
    const resolved = typeof palette === "string" ? memoPalette! : palette;
    spec = (resolved as any)[role] ?? resolved.accent;
  } else {
    const appearance = theme.appearance === "light" ? "light" : "dark";
    const pal = appearance === "light" ? OMT_LIGHT_PALETTE : OMT_DEFAULT_PALETTE;
    spec = pal[role] ?? OMT_DEFAULT_PALETTE[role] ?? { rgb: [255, 255, 255], ansi256: 15 };
  }
  if (mode === "256color") {
    return indexedColor(spec.ansi256);
  }
  return rgbColor(...spec.rgb);
}

/** Format text with signature foreground styling. */
export function signatureFg(
  theme: Theme,
  role: SignatureColorRole,
  text: string,
  palette?: string | ResolvedPalette,
): string {
  const mode = typeof theme.getColorMode === "function" ? theme.getColorMode() : "truecolor";
  if ((mode as string) === "monochrome") {
    if (role === "accent" || role === "success" || role === "green") return theme.bold(text);
    if (role === "dim" || role === "muted" || role === "border") return `\x1b[2m${text}\x1b[22m`;
    return text;
  }
  if ((mode as string) === "16color") {
    const fallbackRole =
      role === "accent" || role === "indigo" || role === "plan"
        ? "accent"
        : role === "cyan" || role === "teal" || role === "shell"
          ? "accent"
          : role === "success" || role === "green"
            ? "success"
            : role === "warning" || role === "yellow"
              ? "warning"
              : role === "error" || role === "red"
                ? "error"
                : role === "dim" || role === "muted" || role === "border" || role === "inputDim"
                  ? "muted"
                  : "text";
    return theme.fg(fallbackRole as any, text);
  }
  return theme.style(text, { fg: signatureColor(theme, role, palette) });
}

/** Format text with signature background styling. */
export function signatureBg(
  theme: Theme,
  role: SignatureColorRole,
  text: string,
  palette?: string | ResolvedPalette,
): string {
  const mode = typeof theme.getColorMode === "function" ? theme.getColorMode() : "truecolor";
  if ((mode as string) === "monochrome" || (mode as string) === "16color") {
    return text;
  }
  return ansiBackground(theme, signatureColor(theme, role, palette), text);
}

/** Format an elegant pill badge, e.g. [ ◈ ts ] or [ ⚡ npm test ]. */
export function signatureBadge(
  theme: Theme,
  text: string,
  role: SignatureColorRole = "accent",
  palette?: string | ResolvedPalette,
): string {
  return (
    signatureFg(theme, "dim", "[", palette) +
    signatureFg(theme, role, text, palette) +
    signatureFg(theme, "dim", "]", palette)
  );
}

/** Subtle duration tag: (140ms) or (2.4s). */
export function signatureDuration(theme: Theme, ms: number, palette?: string | ResolvedPalette): string {
  if (ms < 1000) return signatureFg(theme, "dim", `(${Math.round(ms)}ms)`, palette);
  const sec = (ms / 1000).toFixed(1);
  return signatureFg(theme, "dim", `(${sec}s)`, palette);
}

/** Context percentage meter bar: [████░░░░] 45%. */
export function signatureContextBar(
  theme: Theme,
  percent: number,
  width: number = 8,
  palette?: string | ResolvedPalette,
): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const barRole: SignatureColorRole = clamped > 90 ? "error" : clamped > 75 ? "warning" : "cyan";
  const filledChars = "█".repeat(filled);
  const emptyChars = "░".repeat(empty);
  return (
    signatureFg(theme, "dim", "[", palette) +
    signatureFg(theme, barRole, filledChars, palette) +
    signatureFg(theme, "dim", emptyChars, palette) +
    signatureFg(theme, "dim", "] ", palette) +
    signatureFg(theme, barRole, `${clamped}%`, palette)
  );
}

/** Signature framed border with subtle OMT cBorder styling. */
export function signatureBorder(theme: Theme, borderStr: string, palette?: string | ResolvedPalette): string {
  return signatureFg(theme, "border", borderStr, palette);
}

/**
 * OMT Diff styling:
 * diffAddStyle: Background("#1f3d24").Foreground("#d6f5dc")
 * diffDelStyle: Background("#4a2026").Foreground("#f8d7da")
 */
export function omtDiffAdd(theme: Theme, text: string): string {
  const mode = typeof theme.getColorMode === "function" ? theme.getColorMode() : "truecolor";
  if ((mode as string) === "monochrome" || (mode as string) === "16color") {
    return signatureFg(theme, "green", text);
  }
  const bg = rgbColor(31, 61, 36);
  const fg = rgbColor(214, 245, 220);
  return theme.style(ansiBackground(theme, bg, text), { fg });
}


export function omtDiffDel(theme: Theme, text: string): string {
  const mode = typeof theme.getColorMode === "function" ? theme.getColorMode() : "truecolor";
  if ((mode as string) === "monochrome" || (mode as string) === "16color") {
    return signatureFg(theme, "red", text);
  }
  const bg = rgbColor(74, 32, 38);
  const fg = rgbColor(248, 215, 218);
  return theme.style(ansiBackground(theme, bg, text), { fg });
}


/** Theme view for OMT-owned surfaces only; never mutates Pi's active Theme. */
export function signatureTheme(theme: Theme): Theme {
  if (typeof theme.style !== "function") return theme;
  const roles: Record<string, SignatureColorRole> = {
    accent: "accent", border: "border", borderMuted: "border", borderAccent: "accent",
    text: "text", muted: "muted", dim: "muted", success: "green", error: "red", warning: "yellow",
    toolTitle: "text", toolOutput: "code", thinkingText: "border",
  };
  return new Proxy(theme, {
    get(target, key) {
      if (key === "fg") return (token: string, text: string) => roles[token] ? signatureFg(target, roles[token]!, text) : target.fg(token as any, text);
      if (key === "bg") return (token: string, text: string) => token === "selectedBg" ? signatureBg(target, "hiBg", text) : target.bg(token as any, text);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// Re-export pure palette and primitive modules
export * from "./palette.ts";
export * from "./primitives.ts";


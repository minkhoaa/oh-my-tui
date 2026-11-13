import { getCapabilities } from "@earendil-works/pi-tui";

export type ColorMode = "truecolor" | "256color" | "16color" | "monochrome";

export interface ColorCapabilities {
  mode: ColorMode;
  truecolor: boolean;
  color256: boolean;
  ansi16: boolean;
  monochrome: boolean;
}

export type GraphicsProtocol = "kitty" | "none";

export interface KittyBackendCapabilities {
  supported: boolean;
  negativeZIndexSupported: boolean;
  backend: "kitty" | "ansi";
  reason: string;
}

export interface GraphicsCapabilities {
  supported: boolean;
  protocol: GraphicsProtocol;
  negativeZIndex: boolean;
  backend: "kitty" | "ansi";
  reason: string;
}

export interface FullBackdropEvaluation {
  supported: boolean;
  mode: "viewport-compositor" | "unsupported";
  reason: string;
  limitations: string[];
  safeSurfaces: string[];
}

export interface TerminalCapabilities {
  color: ColorCapabilities;
  graphics: GraphicsCapabilities;
  backdrop: FullBackdropEvaluation;
  inTmux: boolean;
  inSsh: boolean;
}

/**
 * Detects color depth capability of the current terminal environment.
 * Pure function: inspects environment without mutating state.
 */
export function detectColorMode(env: NodeJS.ProcessEnv = process.env): ColorMode {
  // Explicit override via environment
  const override = (env.OMT_COLOR_MODE || "").toLowerCase();
  if (override === "truecolor" || override === "256color" || override === "16color" || override === "monochrome") {
    return override;
  }

  // Standards: NO_COLOR or TERM=dumb
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") {
    return "monochrome";
  }
  if (env.TERM === "dumb") {
    return "monochrome";
  }

  // 24-bit Truecolor
  const colorterm = (env.COLORTERM || "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") {
    return "truecolor";
  }

  // 256-color
  const term = (env.TERM || "").toLowerCase();
  if (term.includes("256color")) {
    return "256color";
  }

  // 16-color ANSI
  if (term.includes("color") || term.includes("ansi") || term.includes("xterm") || term.includes("screen") || term.includes("tmux") || term.includes("rxvt") || term === "linux") {
    return "16color";
  }

  // Unknown/legacy terminals (including VT100) do not prove color support.
  return "monochrome";
}

/**
 * Summarizes color capabilities into boolean flags and active mode.
 */
export function detectColorCapabilities(env: NodeJS.ProcessEnv = process.env): ColorCapabilities {
  const mode = detectColorMode(env);
  return {
    mode,
    truecolor: mode === "truecolor",
    color256: mode === "truecolor" || mode === "256color",
    ansi16: mode !== "monochrome",
    monochrome: mode === "monochrome",
  };
}

/**
 * Evaluates whether graphics protocols are active.
 * Oh My TUI uses Pi's native cell renderer and Chafa WASM for raster conversion;
 * custom graphics protocols (Kitty/Sixel/iTerm) are eliminated in favor of portable cells.
 */
export function detectKittyBackendCapabilities(
  _env: NodeJS.ProcessEnv = process.env,
  _verifiedPlacementLifecycle = false,
): KittyBackendCapabilities {
  return {
    supported: false,
    negativeZIndexSupported: false,
    backend: "ansi",
    reason: "Graphics protocols eliminated; Chafa WASM cell rendering active",
  };
}

/**
 * Graphics capability detection.
 * Always resolves to ANSI cell rendering; custom graphics protocols are disabled.
 */
export function detectGraphicsCapabilities(_env: NodeJS.ProcessEnv = process.env): GraphicsCapabilities {
  return {
    supported: false,
    protocol: "none",
    negativeZIndex: false,
    backend: "ansi",
    reason: "Native cell rendering active; graphics protocols eliminated",
  };
}

/**
 * Audits terminal compositor and documents Full Backdrop feasibility.
 */
export function evaluateFullBackdropSupport(supported = false): FullBackdropEvaluation {
  return {
    supported,
    mode: supported ? "viewport-compositor" : "unsupported",
    reason: supported
      ? "Native alternate-screen viewport compositing before overlays, selections and terminal diff output."
      : "Full wallpaper requires a recognized native TuiAltScreen pipeline. Regular-screen scrollback and unsupported renderers remain unchanged; choose scene explicitly.",
    limitations: [
      "Foreground glyph spans and styled cells are opaque; ANSI has no alpha transparency.",
      "Image-bearing viewports suspend the wallpaper to preserve native image placements.",
    ],
    safeSurfaces: ["Native alternate-screen viewport", "Explicit optional scene widget"],
  };
}

/**
 * Discovers complete terminal capabilities in a single inspection pass.
 */
export function detectTerminalCapabilities(env: NodeJS.ProcessEnv = process.env): TerminalCapabilities {
  const inTmux = !!env.TMUX;
  const inSsh = !!(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);

  return {
    color: detectColorCapabilities(env),
    graphics: detectGraphicsCapabilities(env),
    backdrop: evaluateFullBackdropSupport(false),
    inTmux,
    inSsh,
  };
}

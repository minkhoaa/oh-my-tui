import type { AdaptiveLayoutMetrics, LayoutMode } from "./types.ts";
import { sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type { AdaptiveLayoutMetrics, LayoutMode } from "./types.ts";

// ==========================================
// Layout Mode State Management
// ==========================================

let activeLayoutMode: LayoutMode = "standard";
let previousNonFocusMode: LayoutMode = "standard";

/** Return the currently active layout mode. */
export function getActiveLayoutMode(): LayoutMode {
  return activeLayoutMode;
}

/** Set the active layout mode. */
export function setActiveLayoutMode(mode: LayoutMode): void {
  if (mode !== "focus") {
    previousNonFocusMode = mode;
  }
  activeLayoutMode = mode;
}

/** Check whether focus mode is currently active. */
export function isFocusMode(): boolean {
  return activeLayoutMode === "focus";
}

/** Enable or disable focus mode, restoring prior mode on disable. */
export function setFocusMode(enabled: boolean): void {
  if (enabled) {
    if (activeLayoutMode !== "focus") {
      previousNonFocusMode = activeLayoutMode;
      activeLayoutMode = "focus";
    }
  } else {
    if (activeLayoutMode === "focus") {
      activeLayoutMode = previousNonFocusMode === "focus" ? "standard" : previousNonFocusMode;
    }
  }
}

/** Toggle focus mode on or off. Returns new focus mode state. */
export function toggleFocusMode(): boolean {
  const next = !isFocusMode();
  setFocusMode(next);
  return next;
}

/** Reset layout mode to the default standard mode. */
export function resetLayoutMode(): void {
  activeLayoutMode = "standard";
  previousNonFocusMode = "standard";
}

// ==========================================
// Layout Metrics Calculation
// ==========================================

/**
 * Calculate adaptive layout metrics based on viewport dimensions and mode.
 *
 * Rules:
 * - width < 30: isUltraNarrow = true, isNarrow = true, contentPadding = 0,
 *   maxOutputRows = 5, showExtendedStatus = false, showLineNumbers = false.
 * - width < 60: isNarrow = true, isUltraNarrow = false, contentPadding = 1,
 *   maxOutputRows = 10, showExtendedStatus = false, showLineNumbers = false.
 * - width >= 60: isNarrow = false, isUltraNarrow = false, contentPadding = 2,
 *   maxOutputRows = 20, showExtendedStatus = true, showLineNumbers = true.
 * - mode === "focus": maxOutputRows = 3, contentPadding = 1 (or 0 if ultra-narrow),
 *   showExtendedStatus = false (clean distraction-free conversation area).
 * - mode === "compact": maxOutputRows = 5, contentPadding = 1 (or 0 if ultra-narrow).
 * - mode === "standard": default metrics based on width/height.
 */
export function getLayoutMetrics(
  width: number,
  height: number,
  mode?: LayoutMode,
): AdaptiveLayoutMetrics {
  const effectiveMode: LayoutMode = mode ?? getActiveLayoutMode();
  const isUltraNarrow = width < 30;
  const isNarrow = width < 60;

  let contentPadding: number;
  let maxOutputRows: number;
  let showExtendedStatus: boolean;
  let showLineNumbers: boolean;

  if (isUltraNarrow) {
    contentPadding = 0;
    maxOutputRows = 5;
    showExtendedStatus = false;
    showLineNumbers = false;
  } else if (isNarrow) {
    contentPadding = 1;
    maxOutputRows = 10;
    showExtendedStatus = false;
    showLineNumbers = false;
  } else {
    contentPadding = 2;
    maxOutputRows = 20;
    showExtendedStatus = true;
    showLineNumbers = true;
  }

  if (effectiveMode === "focus") {
    maxOutputRows = 3;
    contentPadding = isUltraNarrow ? 0 : 1;
    showExtendedStatus = false;
  } else if (effectiveMode === "compact") {
    maxOutputRows = 5;
    contentPadding = isUltraNarrow ? 0 : 1;
  }

  return {
    mode: effectiveMode,
    width,
    height,
    isNarrow,
    isUltraNarrow,
    contentPadding,
    showExtendedStatus,
    showLineNumbers,
    maxOutputRows,
  };
}

// ==========================================
// Responsive Formatting Helpers
// ==========================================

/**
 * Safely wraps/truncates lines to fit within a given target width,
 * taking into account metrics padding, East Asian characters, and emoji widths.
 */
export function adaptContentForWidth(
  lines: string[],
  width: number,
  metrics?: AdaptiveLayoutMetrics,
): string[] {
  if (width <= 0) return [];

  const padding = metrics ? metrics.contentPadding : 0;
  const targetWidth = Math.max(1, width > padding * 2 ? width - padding * 2 : width);
  const result: string[] = [];

  for (const rawLine of lines) {
    const sublines = rawLine.split(/\r?\n/);
    for (const line of sublines) {
      if (line.length === 0) {
        result.push("");
        continue;
      }
      if (visibleWidth(line) <= targetWidth) {
        result.push(line);
        continue;
      }
      const wrapped = wrapTextWithAnsi(line, targetWidth);
      if (wrapped.length === 0) {
        result.push("");
        continue;
      }
      for (const part of wrapped) {
        if (visibleWidth(part) <= targetWidth) {
          result.push(part);
        } else {
          const clipped = sliceByColumn(part, 0, targetWidth, true);
          result.push(clipped);
        }
      }
    }
  }

  return result;
}

/**
 * Truncates output lines according to the active layout mode and row budget.
 */
export function truncateOutputForMode(
  lines: string[],
  mode: LayoutMode,
  maxRows?: number,
): string[] {
  const defaultLimit = mode === "focus" ? 3 : mode === "compact" ? 5 : 20;
  const limit = Math.max(0, maxRows ?? defaultLimit);
  return lines.slice(0, limit);
}

/**
 * Format a responsive single-line header with title and metadata.
 * In wide viewports, space separates title and metadata.
 * In compact viewports or compact mode, a compact dot separator is used.
 * In narrow viewports, secondary metadata is dropped to preserve title readability.
 */
export function formatResponsiveHeader(
  title: string,
  metadata: string,
  width: number,
  isCompact?: boolean,
): string {
  if (width <= 0) return "";
  const titleClean = title ?? "";
  const metaClean = metadata ?? "";

  if (!titleClean && !metaClean) return "";
  if (!metaClean) {
    return visibleWidth(titleClean) <= width
      ? titleClean
      : truncateToWidth(titleClean, width, "…");
  }
  if (!titleClean) {
    return visibleWidth(metaClean) <= width
      ? metaClean
      : truncateToWidth(metaClean, width, "…");
  }

  const titleW = visibleWidth(titleClean);
  const metaW = visibleWidth(metaClean);

  if (!isCompact && width >= 40) {
    const gap = width - titleW - metaW;
    if (gap >= 4) {
      return titleClean + " ".repeat(gap) + metaClean;
    }
  }

  const separator = " · ";
  const sepW = visibleWidth(separator);
  if (titleW + sepW + metaW <= width) {
    return `${titleClean}${separator}${metaClean}`;
  }

  if (titleW <= width) {
    return titleClean;
  }

  return truncateToWidth(titleClean, width, "…");
}

/**
 * Determines whether footer activity (e.g. running tool or background task)
 * should be displayed given terminal width and layout mode.
 */
export function shouldDisplayFooterActivity(width: number, mode: LayoutMode): boolean {
  if (width < 40) return false;
  if (mode === "focus") return width >= 80;
  if (mode === "compact") return width >= 50;
  return true;
}

/**
 * Determines whether footer Git branch indicator should be displayed
 * given terminal width and layout mode.
 */
export function shouldDisplayFooterBranch(width: number, mode: LayoutMode): boolean {
  if (width < 60) return false;
  if (mode === "focus") return false;
  if (mode === "compact") return width >= 80;
  return true;
}

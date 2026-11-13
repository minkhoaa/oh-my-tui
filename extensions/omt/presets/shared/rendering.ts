// Shared presentation rendering utilities.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, visibleWidth, type Color } from "@earendil-works/pi-tui";

/** Replace padding cells, never content or OSC 133 prompt-zone markers. */
export function reservedMarker(line: string, marker: string, column = 0): string {
  const zones = line.match(/\x1b\]133;[ABC]\x07/g)?.join("") ?? "";
  return zones + " ".repeat(column) + marker + sliceByColumn(line.replace(/\x1b\]133;[ABC]\x07/g, ""), column + 2, Math.max(0, visibleWidth(line) - column - 2));
}
/** Restore a containing surface after native syntax/intraline background resets. */
export function ansiBackground(theme: Theme, color: Color, text: string): string {
  const [prefix, suffix] = theme.style("\u0001", { bg: color }).split("\u0001");
  return prefix + text.replace(/\x1b\[(?:49|0)?m/g, (reset) => reset + prefix) + suffix;
}

/** Settled tool layouts cache by width and layout identity, not by animation frame. */
export class LayoutRow {
  layout: (width: number) => string[] = () => [];
  cache = false;
  private cachedWidth?: number;
  private cachedLayout?: (width: number) => string[];
  private cachedRows?: string[];
  protected format(rows: string[], _width: number): string[] { return rows; }
  render(width: number): string[] {
    if (width <= 0) return [];
    if (this.cache && this.cachedWidth === width && this.cachedLayout === this.layout && this.cachedRows) return this.cachedRows;
    const rows = this.format(this.layout(width), width);
    this.cachedWidth = width; this.cachedLayout = this.layout; this.cachedRows = rows;
    return rows;
  }
  invalidate(): void { this.cachedRows = undefined; }
}

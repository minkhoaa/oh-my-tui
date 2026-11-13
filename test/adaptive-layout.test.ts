import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  adaptContentForWidth,
  formatResponsiveHeader,
  getActiveLayoutMode,
  getLayoutMetrics,
  isFocusMode,
  resetLayoutMode,
  setActiveLayoutMode,
  setFocusMode,
  shouldDisplayFooterActivity,
  shouldDisplayFooterBranch,
  toggleFocusMode,
  truncateOutputForMode,
} from "../extensions/omt/features/adaptive-layout/index.ts";

describe("Adaptive Layout & Focus Mode (M19)", () => {
  beforeEach(() => {
    resetLayoutMode();
  });

  after(() => {
    resetLayoutMode();
  });

  describe("getLayoutMetrics - across viewport widths", () => {
    it("calculates metrics for standard wide viewports (120 cols)", () => {
      const metrics = getLayoutMetrics(120, 40, "standard");
      assert.equal(metrics.width, 120);
      assert.equal(metrics.height, 40);
      assert.equal(metrics.mode, "standard");
      assert.equal(metrics.isNarrow, false);
      assert.equal(metrics.isUltraNarrow, false);
      assert.equal(metrics.contentPadding, 2);
      assert.equal(metrics.maxOutputRows, 20);
      assert.equal(metrics.showExtendedStatus, true);
      assert.equal(metrics.showLineNumbers, true);
    });

    it("calculates metrics for standard 80-col viewports", () => {
      const metrics = getLayoutMetrics(80, 24, "standard");
      assert.equal(metrics.width, 80);
      assert.equal(metrics.height, 24);
      assert.equal(metrics.mode, "standard");
      assert.equal(metrics.isNarrow, false);
      assert.equal(metrics.isUltraNarrow, false);
      assert.equal(metrics.contentPadding, 2);
      assert.equal(metrics.maxOutputRows, 20);
      assert.equal(metrics.showExtendedStatus, true);
      assert.equal(metrics.showLineNumbers, true);
    });

    it("calculates metrics at the 60-col boundary", () => {
      const metrics = getLayoutMetrics(60, 24, "standard");
      assert.equal(metrics.isNarrow, false);
      assert.equal(metrics.isUltraNarrow, false);
      assert.equal(metrics.contentPadding, 2);
      assert.equal(metrics.maxOutputRows, 20);
      assert.equal(metrics.showExtendedStatus, true);
      assert.equal(metrics.showLineNumbers, true);
    });

    it("calculates metrics for narrow viewports (50 cols)", () => {
      const metrics = getLayoutMetrics(50, 24, "standard");
      assert.equal(metrics.width, 50);
      assert.equal(metrics.height, 24);
      assert.equal(metrics.mode, "standard");
      assert.equal(metrics.isNarrow, true);
      assert.equal(metrics.isUltraNarrow, false);
      assert.equal(metrics.contentPadding, 1);
      assert.equal(metrics.maxOutputRows, 10);
      assert.equal(metrics.showExtendedStatus, false);
      assert.equal(metrics.showLineNumbers, false);
    });

    it("calculates metrics at the 30-col boundary", () => {
      const metrics = getLayoutMetrics(30, 24, "standard");
      assert.equal(metrics.isNarrow, true);
      assert.equal(metrics.isUltraNarrow, false);
      assert.equal(metrics.contentPadding, 1);
      assert.equal(metrics.maxOutputRows, 10);
      assert.equal(metrics.showExtendedStatus, false);
      assert.equal(metrics.showLineNumbers, false);
    });

    it("calculates metrics for ultra-narrow viewports (25 cols)", () => {
      const metrics = getLayoutMetrics(25, 20, "standard");
      assert.equal(metrics.width, 25);
      assert.equal(metrics.height, 20);
      assert.equal(metrics.mode, "standard");
      assert.equal(metrics.isNarrow, true);
      assert.equal(metrics.isUltraNarrow, true);
      assert.equal(metrics.contentPadding, 0);
      assert.equal(metrics.maxOutputRows, 5);
      assert.equal(metrics.showExtendedStatus, false);
      assert.equal(metrics.showLineNumbers, false);
    });
  });

  describe("getLayoutMetrics - across layout modes", () => {
    it("applies standard mode defaults", () => {
      const metrics = getLayoutMetrics(80, 24, "standard");
      assert.equal(metrics.mode, "standard");
      assert.equal(metrics.maxOutputRows, 20);
      assert.equal(metrics.contentPadding, 2);
      assert.equal(metrics.showExtendedStatus, true);
      assert.equal(metrics.showLineNumbers, true);
    });

    it("applies compact mode metrics (5 output rows, 1 padding)", () => {
      const metrics = getLayoutMetrics(80, 24, "compact");
      assert.equal(metrics.mode, "compact");
      assert.equal(metrics.maxOutputRows, 5);
      assert.equal(metrics.contentPadding, 1);
      assert.equal(metrics.showExtendedStatus, true);
      assert.equal(metrics.showLineNumbers, true);
    });

    it("applies focus mode metrics (3 output rows, 1 padding, extended status off)", () => {
      const metrics = getLayoutMetrics(80, 24, "focus");
      assert.equal(metrics.mode, "focus");
      assert.equal(metrics.maxOutputRows, 3);
      assert.equal(metrics.contentPadding, 1);
      assert.equal(metrics.showExtendedStatus, false);
    });

    it("falls back to active layout mode if mode is omitted", () => {
      assert.equal(getLayoutMetrics(80, 24).mode, "standard");

      setActiveLayoutMode("compact");
      assert.equal(getLayoutMetrics(80, 24).mode, "compact");
      assert.equal(getLayoutMetrics(80, 24).maxOutputRows, 5);

      setActiveLayoutMode("focus");
      assert.equal(getLayoutMetrics(80, 24).mode, "focus");
      assert.equal(getLayoutMetrics(80, 24).maxOutputRows, 3);
    });

    it("handles ultra-narrow widths in focus and compact modes", () => {
      const focusUltra = getLayoutMetrics(25, 20, "focus");
      assert.equal(focusUltra.isUltraNarrow, true);
      assert.equal(focusUltra.maxOutputRows, 3);
      assert.equal(focusUltra.contentPadding, 0);

      const compactUltra = getLayoutMetrics(25, 20, "compact");
      assert.equal(compactUltra.isUltraNarrow, true);
      assert.equal(compactUltra.maxOutputRows, 5);
      assert.equal(compactUltra.contentPadding, 0);
    });
  });

  describe("Layout mode state transitions", () => {
    it("starts in standard mode", () => {
      assert.equal(getActiveLayoutMode(), "standard");
      assert.equal(isFocusMode(), false);
    });

    it("switches modes via setActiveLayoutMode", () => {
      setActiveLayoutMode("compact");
      assert.equal(getActiveLayoutMode(), "compact");
      assert.equal(isFocusMode(), false);

      setActiveLayoutMode("focus");
      assert.equal(getActiveLayoutMode(), "focus");
      assert.equal(isFocusMode(), true);

      setActiveLayoutMode("standard");
      assert.equal(getActiveLayoutMode(), "standard");
      assert.equal(isFocusMode(), false);
    });

    it("toggles focus mode on and off", () => {
      const toggledOn = toggleFocusMode();
      assert.equal(toggledOn, true);
      assert.equal(isFocusMode(), true);
      assert.equal(getActiveLayoutMode(), "focus");

      const toggledOff = toggleFocusMode();
      assert.equal(toggledOff, false);
      assert.equal(isFocusMode(), false);
      assert.equal(getActiveLayoutMode(), "standard");
    });

    it("restores prior compact mode after disabling focus mode", () => {
      setActiveLayoutMode("compact");
      assert.equal(getActiveLayoutMode(), "compact");

      setFocusMode(true);
      assert.equal(getActiveLayoutMode(), "focus");
      assert.equal(isFocusMode(), true);

      setFocusMode(false);
      assert.equal(getActiveLayoutMode(), "compact");
      assert.equal(isFocusMode(), false);
    });

    it("resets layout mode to standard via resetLayoutMode", () => {
      setActiveLayoutMode("focus");
      assert.equal(isFocusMode(), true);

      resetLayoutMode();
      assert.equal(getActiveLayoutMode(), "standard");
      assert.equal(isFocusMode(), false);
    });
  });

  describe("adaptContentForWidth", () => {
    it("returns empty array for empty inputs or zero width", () => {
      assert.deepEqual(adaptContentForWidth([], 80), []);
      assert.deepEqual(adaptContentForWidth(["hello"], 0), []);
      assert.deepEqual(adaptContentForWidth(["hello"], -1), []);
    });

    it("preserves lines that fit comfortably within width", () => {
      const input = ["short line 1", "short line 2"];
      const result = adaptContentForWidth(input, 50);
      assert.deepEqual(result, input);
    });

    it("preserves empty lines within text", () => {
      const input = ["paragraph 1", "", "paragraph 2"];
      const result = adaptContentForWidth(input, 50);
      assert.deepEqual(result, input);
    });

    it("wraps long lines exceeding target width", () => {
      const longLine = "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda";
      const result = adaptContentForWidth([longLine], 25);
      assert(result.length > 1);
      for (const line of result) {
        assert(visibleWidth(line) <= 25, `Line exceeded 25 cols: "${line}"`);
      }
    });

    it("safely wraps East Asian full-width characters (CJK)", () => {
      const cjkText = "こんにちは世界！日本語の文章が指定した幅で折り返されるか検証します。";
      const result = adaptContentForWidth([cjkText], 20);
      assert(result.length > 1);
      for (const line of result) {
        assert(visibleWidth(line) <= 20, `CJK line exceeded 20 cols: "${line}" (${visibleWidth(line)})`);
      }
    });

    it("safely wraps emoji and symbols with multi-column widths", () => {
      const emojiText = "🚀🌟🎉🔥✨💥🎈🎨🎯🛠️📦💻";
      const result = adaptContentForWidth([emojiText], 8);
      assert(result.length > 1);
      for (const line of result) {
        assert(visibleWidth(line) <= 8, `Emoji line exceeded 8 cols: "${line}" (${visibleWidth(line)})`);
      }
    });

    it("handles narrow widths safely", () => {
      const result = adaptContentForWidth(["supercalifragilistic"], 5);
      assert(result.length > 1);
      for (const line of result) {
        assert(visibleWidth(line) <= 5, `Line exceeded 5 cols: "${line}"`);
      }
    });

    it("takes AdaptiveLayoutMetrics contentPadding into account", () => {
      const metrics = getLayoutMetrics(60, 24, "standard"); // padding = 2
      const text = "A".repeat(70);
      const result = adaptContentForWidth([text], 60, metrics);
      const usableWidth = 60 - metrics.contentPadding * 2; // 56
      for (const line of result) {
        assert(visibleWidth(line) <= usableWidth, `Line exceeded usable width ${usableWidth}: "${line}"`);
      }
    });

    it("splits embedded newlines in input elements", () => {
      const input = ["line 1\nline 2\nline 3"];
      const result = adaptContentForWidth(input, 40);
      assert.deepEqual(result, ["line 1", "line 2", "line 3"]);
    });
  });

  describe("truncateOutputForMode", () => {
    const testLines = Array.from({ length: 30 }, (_, i) => `Row ${i + 1}`);

    it("truncates to 20 lines in standard mode", () => {
      const result = truncateOutputForMode(testLines, "standard");
      assert.equal(result.length, 20);
      assert.equal(result[0], "Row 1");
      assert.equal(result[19], "Row 20");
    });

    it("truncates to 5 lines in compact mode", () => {
      const result = truncateOutputForMode(testLines, "compact");
      assert.equal(result.length, 5);
      assert.equal(result[0], "Row 1");
      assert.equal(result[4], "Row 5");
    });

    it("truncates to 3 lines in focus mode", () => {
      const result = truncateOutputForMode(testLines, "focus");
      assert.equal(result.length, 3);
      assert.equal(result[0], "Row 1");
      assert.equal(result[2], "Row 3");
    });

    it("does not truncate if input has fewer lines than mode budget", () => {
      const short = ["Row 1", "Row 2"];
      assert.deepEqual(truncateOutputForMode(short, "standard"), short);
      assert.deepEqual(truncateOutputForMode(short, "compact"), short);
      assert.deepEqual(truncateOutputForMode(short, "focus"), short);
    });

    it("respects explicit maxRows override", () => {
      const result = truncateOutputForMode(testLines, "standard", 7);
      assert.equal(result.length, 7);
      assert.equal(result[6], "Row 7");

      const empty = truncateOutputForMode(testLines, "focus", 0);
      assert.equal(empty.length, 0);
    });
  });

  describe("formatResponsiveHeader", () => {
    it("returns empty string on non-positive widths or empty inputs", () => {
      assert.equal(formatResponsiveHeader("Title", "Meta", 0), "");
      assert.equal(formatResponsiveHeader("Title", "Meta", -5), "");
      assert.equal(formatResponsiveHeader("", "", 80), "");
    });

    it("formats wide header with spaced gap in standard mode", () => {
      const header = formatResponsiveHeader("Oh My TUI", "v0.1.0", 50);
      assert(header.startsWith("Oh My TUI"));
      assert(header.endsWith("v0.1.0"));
      assert.equal(visibleWidth(header), 50);
    });

    it("formats compact header with dot separator when isCompact is true", () => {
      const header = formatResponsiveHeader("Oh My TUI", "v0.1.0", 50, true);
      assert.equal(header, "Oh My TUI · v0.1.0");
      assert(visibleWidth(header) <= 50);
    });

    it("falls back to compact dot separator when gap is too tight for spacing", () => {
      // "App" (3) + " · " (3) + "v1.0" (4) = 10 cols
      const header = formatResponsiveHeader("App", "v1.0", 10, false);
      assert.equal(header, "App · v1.0");
    });

    it("drops metadata and preserves title when viewport is narrow", () => {
      // "Settings Window" (15), metadata "v1.0.0" cannot fit in 18 cols with gap or separator
      const header = formatResponsiveHeader("Settings Window", "v1.0.0", 16);
      assert.equal(header, "Settings Window");
      assert(visibleWidth(header) <= 16);
    });

    it("truncates title cleanly on ultra-narrow viewports", () => {
      const header = formatResponsiveHeader("Long Application Title", "Metadata", 8);
      assert(visibleWidth(header) <= 8);
      assert(header.includes("…"));
    });

    it("handles headers with only title or only metadata", () => {
      assert.equal(formatResponsiveHeader("Only Title", "", 30), "Only Title");
      assert.equal(formatResponsiveHeader("", "Only Metadata", 30), "Only Metadata");
    });
  });

  describe("Footer display decision helpers", () => {
    describe("shouldDisplayFooterActivity", () => {
      it("hides activity for ultra-narrow widths (< 40)", () => {
        assert.equal(shouldDisplayFooterActivity(25, "standard"), false);
        assert.equal(shouldDisplayFooterActivity(39, "compact"), false);
        assert.equal(shouldDisplayFooterActivity(30, "focus"), false);
      });

      it("displays activity in standard mode for width >= 40", () => {
        assert.equal(shouldDisplayFooterActivity(40, "standard"), true);
        assert.equal(shouldDisplayFooterActivity(60, "standard"), true);
        assert.equal(shouldDisplayFooterActivity(100, "standard"), true);
      });

      it("displays activity in compact mode for width >= 50", () => {
        assert.equal(shouldDisplayFooterActivity(45, "compact"), false);
        assert.equal(shouldDisplayFooterActivity(50, "compact"), true);
        assert.equal(shouldDisplayFooterActivity(80, "compact"), true);
      });

      it("hides activity in focus mode unless wide (>= 80)", () => {
        assert.equal(shouldDisplayFooterActivity(50, "focus"), false);
        assert.equal(shouldDisplayFooterActivity(70, "focus"), false);
        assert.equal(shouldDisplayFooterActivity(80, "focus"), true);
        assert.equal(shouldDisplayFooterActivity(120, "focus"), true);
      });
    });

    describe("shouldDisplayFooterBranch", () => {
      it("hides branch for widths < 60 across all modes", () => {
        assert.equal(shouldDisplayFooterBranch(25, "standard"), false);
        assert.equal(shouldDisplayFooterBranch(50, "standard"), false);
        assert.equal(shouldDisplayFooterBranch(59, "compact"), false);
        assert.equal(shouldDisplayFooterBranch(50, "focus"), false);
      });

      it("displays branch in standard mode for width >= 60", () => {
        assert.equal(shouldDisplayFooterBranch(60, "standard"), true);
        assert.equal(shouldDisplayFooterBranch(80, "standard"), true);
        assert.equal(shouldDisplayFooterBranch(120, "standard"), true);
      });

      it("displays branch in compact mode only when width >= 80", () => {
        assert.equal(shouldDisplayFooterBranch(60, "compact"), false);
        assert.equal(shouldDisplayFooterBranch(70, "compact"), false);
        assert.equal(shouldDisplayFooterBranch(80, "compact"), true);
        assert.equal(shouldDisplayFooterBranch(100, "compact"), true);
      });

      it("never displays branch in focus mode (distraction-free)", () => {
        assert.equal(shouldDisplayFooterBranch(60, "focus"), false);
        assert.equal(shouldDisplayFooterBranch(80, "focus"), false);
        assert.equal(shouldDisplayFooterBranch(120, "focus"), false);
      });
    });
  });
});

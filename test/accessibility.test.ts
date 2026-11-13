import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  accessibilityStore,
  AccessibilityStore,
  adaptThemeForHighContrast,
  asciiBorder,
  createShortcutHelpComponent,
  DEFAULT_SHORTCUT_HELP_ENTRIES,
  filterShortcutEntries,
  HIGH_CONTRAST_PALETTE,
  styleAccessible,
} from "../extensions/omt/features/accessibility/index.ts";

function createMockTheme(): Theme {
  return {
    appearance: "dark",
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
    dim: (text: string) => `\x1b[2m${text}\x1b[22m`,
    fg: (_color: string, text: string) => `\x1b[36m${text}\x1b[39m`,
    bg: (_color: string, text: string) => `\x1b[40m${text}\x1b[49m`,
    style: (text: string) => text,
  } as unknown as Theme;
}

function createPlainTheme(): Theme {
  return {
    appearance: "light",
    bold: (text: string) => text,
    dim: (text: string) => text,
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    style: (text: string) => text,
  } as unknown as Theme;
}

// ==========================================
// Accessibility Store Tests
// ==========================================

test("AccessibilityStore initial state, updates, toggles, and subscriptions", () => {
  const store = new AccessibilityStore();

  // Initial defaults
  assert.deepEqual(store.getSettings(), {
    highContrast: false,
    screenReaderFriendly: false,
    plainTextAsciiBorders: false,
    reducedMotion: false,
  });
  assert.equal(store.isHighContrast(), false);
  assert.equal(store.isScreenReaderFriendly(), false);
  assert.equal(store.isPlainTextAsciiBorders(), false);
  assert.equal(store.isReducedMotion(), false);

  // Toggles
  assert.equal(store.toggleHighContrast(), true);
  assert.equal(store.isHighContrast(), true);
  assert.equal(store.toggleHighContrast(), false);
  assert.equal(store.isHighContrast(), false);

  assert.equal(store.toggleScreenReaderFriendly(), true);
  assert.equal(store.isScreenReaderFriendly(), true);

  assert.equal(store.togglePlainTextAsciiBorders(), true);
  assert.equal(store.isPlainTextAsciiBorders(), true);

  assert.equal(store.toggleReducedMotion(), true);
  assert.equal(store.isReducedMotion(), true);

  // Setters
  store.setHighContrast(true);
  store.setScreenReaderFriendly(false);
  store.setPlainTextAsciiBorders(false);
  store.setReducedMotion(false);
  assert.equal(store.isHighContrast(), true);
  assert.equal(store.isScreenReaderFriendly(), false);

  // Subscriptions
  let notifyCount = 0;
  let lastSettings = store.getSettings();
  const unsubscribe = store.subscribe((s) => {
    notifyCount++;
    lastSettings = s;
  });

  store.updateSettings({ screenReaderFriendly: true, reducedMotion: true });
  assert.equal(notifyCount, 1);
  assert.equal(lastSettings.screenReaderFriendly, true);
  assert.equal(lastSettings.reducedMotion, true);

  // Unsubscribe
  unsubscribe();
  store.updateSettings({ highContrast: false });
  assert.equal(notifyCount, 1); // Not called after unsubscribe

  // Reset
  store.reset();
  assert.deepEqual(store.getSettings(), {
    highContrast: false,
    screenReaderFriendly: false,
    plainTextAsciiBorders: false,
    reducedMotion: false,
  });
});

// ==========================================
// High Contrast Palette & Helpers Tests
// ==========================================

test("High contrast palette and adaptThemeForHighContrast", () => {
  assert.ok(HIGH_CONTRAST_PALETTE.foreground);
  assert.ok(HIGH_CONTRAST_PALETTE.accent);
  assert.ok(HIGH_CONTRAST_PALETTE.border);

  const baseTheme = createMockTheme();
  const hcTheme = adaptThemeForHighContrast(baseTheme);

  // In high contrast, bold wraps in ANSI bold
  const boldText = hcTheme.bold("Notice");
  assert.ok(boldText.includes("\x1b[1m"));

  // In high contrast, error uses bright red
  const errorText = hcTheme.fg("error", "Failed");
  assert.ok(errorText.includes("\x1b[1;91m"));

  // In high contrast, accent uses bright yellow
  const accentText = hcTheme.fg("accent", "Selected");
  assert.ok(accentText.includes("\x1b[1;93m"));

  // In high contrast, dim is bright white (not faint)
  const dimText = hcTheme.fg("dim", "Help");
  assert.ok(dimText.includes("\x1b[97m"));

  // Background inversion
  const bgAccent = hcTheme.bg("accent" as any, "Tab");
  assert.ok(bgAccent.includes("\x1b[43;30m"));

  // styleAccessible helper
  const styledNormal = styleAccessible(baseTheme, "accent", "Target", { highContrast: false });
  assert.ok(styledNormal.includes("Target"));

  const styledHc = styleAccessible(baseTheme, "accent", "Target", { highContrast: true });
  assert.ok(styledHc.includes("\x1b[93m"));
});

// ==========================================
// Plain Text ASCII Border Converter Tests
// ==========================================

test("asciiBorder replaces box drawing glyphs (╭─╰│) with (+-|*) and handles complex boxes", () => {
  // Direct test of requirement: (╭─╰│) with (+-|*)
  const sampleBox = "╭───╮\n│ • │\n╰───╯";
  const converted = asciiBorder(sampleBox);
  assert.equal(converted, "+---+\n| * |\n+---+");

  // Corners and edges
  assert.equal(asciiBorder("┌──┐"), "+--+");
  assert.equal(asciiBorder("└──┘"), "+--+");
  assert.equal(asciiBorder("╔══╗"), "+--+");
  assert.equal(asciiBorder("╚══╝"), "+--+");

  // T-junctions & crosses
  assert.equal(asciiBorder("├┼┤"), "+++");
  assert.equal(asciiBorder("┬┴"), "++");

  // Bullets and markers
  assert.equal(asciiBorder("• ● ○ ◆ ◇ ■ □"), "* * * * * * *");

  // Arrows
  assert.equal(asciiBorder("→ ← ↑ ↓ ▶ ◀"), "-> <- ^ v > <");

  // Block markers and ellipsis
  assert.equal(asciiBorder("▏▎▍▌…"), "||||...");

  // Checkmarks and crosses
  assert.equal(asciiBorder("✔ ✖"), "[v] [x]");

  // Empty string handling
  assert.equal(asciiBorder(""), "");
});

// ==========================================
// Shortcut Help Table & Component Tests
// ==========================================

test("DEFAULT_SHORTCUT_HELP_ENTRIES contains categorized shortcuts across Navigation, Presets, Toggles, Actions", () => {
  const categories = new Set(DEFAULT_SHORTCUT_HELP_ENTRIES.map((e) => e.category));
  assert.ok(categories.has("Navigation"));
  assert.ok(categories.has("Presets"));
  assert.ok(categories.has("Toggles"));
  assert.ok(categories.has("Actions"));

  // Navigation shortcuts
  assert.ok(DEFAULT_SHORTCUT_HELP_ENTRIES.some((e) => e.category === "Navigation" && e.key.includes("Up / Down")));
  assert.ok(DEFAULT_SHORTCUT_HELP_ENTRIES.some((e) => e.category === "Navigation" && e.key.includes("g / G")));

  // Presets
  assert.ok(DEFAULT_SHORTCUT_HELP_ENTRIES.some((e) => e.category === "Presets" && e.key.includes("/omt theme codex")));

  // Toggles
  assert.ok(DEFAULT_SHORTCUT_HELP_ENTRIES.some((e) => e.category === "Toggles" && e.key.includes("Ctrl+P")));
  assert.ok(DEFAULT_SHORTCUT_HELP_ENTRIES.some((e) => e.category === "Toggles" && e.key.includes("v")));

  // Actions
  assert.ok(DEFAULT_SHORTCUT_HELP_ENTRIES.some((e) => e.category === "Actions" && e.key.includes("Enter")));
  assert.ok(DEFAULT_SHORTCUT_HELP_ENTRIES.some((e) => e.category === "Actions" && e.key.includes("y")));
  assert.ok(DEFAULT_SHORTCUT_HELP_ENTRIES.some((e) => e.category === "Actions" && e.key.includes("Esc")));
});

test("filterShortcutEntries filters shortcuts by key, description, and category", () => {
  const entries = DEFAULT_SHORTCUT_HELP_ENTRIES;

  // Exact match
  const nav = filterShortcutEntries(entries, "Navigation");
  assert.ok(nav.length > 0);
  assert.ok(nav.every((e) => e.category === "Navigation" || e.description.includes("Navigation")));

  // Key match
  const codex = filterShortcutEntries(entries, "codex");
  assert.ok(codex.some((e) => e.key.includes("codex")));

  // Multi-token match
  const copyAction = filterShortcutEntries(entries, "copy clipboard");
  assert.ok(copyAction.some((e) => e.key === "y"));

  // No match
  const noMatch = filterShortcutEntries(entries, "nonexistentquery12345");
  assert.equal(noMatch.length, 0);

  // Empty query returns all
  assert.equal(filterShortcutEntries(entries, "").length, entries.length);
});

test("createShortcutHelpComponent renders cleanly across widths (120, 80, 40, 20) and themes", () => {
  const themes = [createMockTheme(), createPlainTheme()];
  const widths = [120, 80, 40, 20];

  for (const theme of themes) {
    for (const width of widths) {
      let renderRequested = false;
      const fakeTui: any = {
        requestRender: () => {
          renderRequested = true;
        },
      };
      let doneValue: unknown;
      const done = (val?: unknown) => {
        doneValue = val;
      };

      const comp = createShortcutHelpComponent(
        fakeTui,
        theme,
        {} as any,
        done,
        {} as any,
      );

      const lines = comp.render(width);
      assert.ok(Array.isArray(lines));
      assert.ok(lines.length >= 5);

      // Verify no line exceeds width
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const len = visibleWidth(line);
        assert.ok(
          len <= width,
          `Line ${i} visibleWidth (${len}) exceeded target width (${width}): "${line}"`,
        );
      }
    }
  }
});

test("createShortcutHelpComponent keyboard navigation: typing filter, Up/Down, Esc/q close", () => {
  let doneCalled = false;
  let doneValue: unknown = undefined;
  const done = (val?: unknown) => {
    doneCalled = true;
    doneValue = val;
  };

  let rendered = false;
  const fakeTui: any = {
    requestRender: () => {
      rendered = true;
    },
  };

  const comp = createShortcutHelpComponent(
    fakeTui,
    createPlainTheme(),
    {} as any,
    done,
    {} as any,
  ) as any;

  // Initial state
  assert.equal(comp.getSelectedIndex(), 0);
  assert.equal(comp.getQuery(), "");

  // Type filter query 'codex'
  for (const char of "codex") {
    comp.handleInput(char);
  }
  assert.equal(comp.getQuery(), "codex");
  assert.ok(comp.getFilteredEntries().length > 0);
  assert.ok(comp.getFilteredEntries().every((e: any) => e.key.toLowerCase().includes("codex") || e.description.toLowerCase().includes("codex")));

  // Up/Down navigation within filtered entries
  comp.handleInput("\x1b[B"); // Down
  assert.equal(comp.getSelectedIndex(), comp.getFilteredEntries().length > 1 ? 1 : 0);

  comp.handleInput("\x1b[A"); // Up
  assert.equal(comp.getSelectedIndex(), 0);

  // Backspace deletes characters
  comp.handleInput("\x7f");
  assert.equal(comp.getQuery(), "code");

  // Esc closes
  comp.handleInput("\x1b");
  assert.equal(doneCalled, true);
});

test("createShortcutHelpComponent 'q' closes when query is empty", () => {
  let doneCalled = false;
  const done = () => {
    doneCalled = true;
  };

  const fakeTui: any = { requestRender: () => {} };
  const comp = createShortcutHelpComponent(
    fakeTui,
    createPlainTheme(),
    {} as any,
    done,
    {} as any,
  );

  comp.handleInput?.("q");
  assert.equal(doneCalled, true);
});

test("createShortcutHelpComponent respects plainTextAsciiBorders in accessibilityStore", () => {
  accessibilityStore.setPlainTextAsciiBorders(true);
  try {
    const fakeTui: any = { requestRender: () => {} };
    const comp = createShortcutHelpComponent(
      fakeTui,
      createPlainTheme(),
      {} as any,
      () => {},
      {} as any,
    );

    const lines = comp.render(80);
    const text = lines.join("\n");
    // Should NOT contain unicode box drawing character '─'
    assert.equal(text.includes("─"), false);
    // Should contain ASCII border '-'
    assert.ok(text.includes("-"));
  } finally {
    accessibilityStore.setPlainTextAsciiBorders(false);
  }
});

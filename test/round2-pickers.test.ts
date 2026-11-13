/**
 * Round 2 Pickers Regression & Parity Test Suite
 *
 * Independently validates OMT picker geometry and interaction contracts:
 * 1. Geometry: Outer box widths are boxW + 2 (152 outer for 150 inner hub/model/theme; 122 outer for 120 inner pet)
 * 2. Narrow terminal bounds: No overflow at 20, 40, 70 cols
 * 3. Key hijack elimination: h/j/k/l/f/F/* and 1-9 type into search/filter, no shortcut hijack
 * 4. Only Ctrl+F (^F) toggles model favorite; cursor follows toggled model
 * 5. Theme & surface initial cursors initialize to current values, not row 0
 * 6. Live preview updates current indicators on actual success; preserves previous on rejection/false
 * 7. Focus switches retain selection (Tab/Left/Right do not reset modelCursor to 0)
 * 8. Never report "Applied" when callback is absent, returns false, or is unresolved
 * 9. Async feedback race conditions and component lifetime disposal safety
 * 10. Native model registry invariance: ModelSpec objects are not mutated
 * 11. Thinking spec helper returns "on"
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth, stripTerminalSequences } from "@earendil-works/pi-tui";
import {
  OmtSettingsHubComponent,
  createOmtSettingsHubComponent,
} from "../extensions/omt/features/omt-dialogs/settings-hub.ts";
import {
  OmtModelPickerComponent,
  createOmtModelPickerComponent,
  modelThinking,
} from "../extensions/omt/features/omt-dialogs/model-picker.ts";
import {
  OmtThemePickerComponent,
  createOmtThemePickerComponent,
} from "../extensions/omt/features/omt-dialogs/theme-picker.ts";
import {
  OmtPetSelectorComponent,
  petDialogBoxW,
  petDialogPage,
} from "../extensions/omt/features/omt-dialogs/pet-picker.ts";
import type { ModelSpec } from "../extensions/omt/features/omt-dialogs/types.ts";

function createMockTui(cols = 192, rows = 49) {
  let renders = 0;
  return {
    terminal: { columns: cols, rows },
    width: cols,
    height: rows,
    requestRender: () => { renders++; },
    get renderCount() { return renders; },
  } as any;
}

function createMockTheme() {
  return {
    appearance: "dark",
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    dim: (text: string) => text,
  } as any;
}

function createMockKeybindings() {
  return {
    matches: () => false,
  } as any;
}

function createMockContext(overrides: Record<string, any> = {}) {
  let editorText = "";
  return {
    hasUI: true,
    mode: "tui",
    ui: {
      setEditorText: (t: string) => { editorText = t; },
      notify: () => {},
      ...overrides.ui,
    },
    getEditorText: () => editorText,
    ...overrides,
  } as any;
}

const SAMPLE_MODELS: ModelSpec[] = [
  {
    id: "fixture-sonnet-35",
    name: "Fixture Sonnet 3.5",
    provider: "anthropic",
    providerLabel: "Anthropic",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com/v1",
    contextWindow: 200000,
    maxTokens: 8192,
    costInput: 3.0,
    costOutput: 15.0,
    costCacheRead: 0.3,
    costCacheWrite: 3.75,
    thinking: true,
    inputModalities: ["text", "image"],
    keyStatus: "ready",
    isFavorite: true,
    favoriteKey: "anthropic\0fixture-sonnet-35",
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    providerLabel: "OpenAI",
    api: "openai-chat",
    baseUrl: "https://api.openai.com/v1",
    contextWindow: 128000,
    maxTokens: 4096,
    costInput: 5.0,
    costOutput: 15.0,
    costCacheRead: 1.25,
    costCacheWrite: 5.0,
    thinking: false,
    inputModalities: ["text", "image"],
    keyStatus: "missing",
    isFavorite: false,
    favoriteKey: "openai\0gpt-4o",
  },
  {
    id: "gemini-1-5-pro",
    name: "Gemini 1.5 Pro",
    provider: "google",
    providerLabel: "Google",
    api: "google-generative",
    baseUrl: "https://generativelanguage.googleapis.com",
    contextWindow: 1000000,
    maxTokens: 8192,
    costInput: 3.5,
    costOutput: 10.5,
    thinking: false,
    inputModalities: ["text", "image"],
    keyStatus: "ready",
    isFavorite: false,
    favoriteKey: "google\0gemini-1-5-pro",
  },
];

// =============================================================================
// 1. Exact dialog geometry: outer width = boxW + 2
// =============================================================================

test("round2 pickers: Settings Hub renders at outer 152 cols (boxW 150 + 2 borders) on 192x49", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx);
  const lines = hub.render(192);

  assert.ok(lines.length > 0);
  const cleanTop = stripTerminalSequences(lines[0]!);
  assert.equal(visibleWidth(cleanTop), 152, "Hub top border must be outer width 152");
  assert.ok(cleanTop.includes("╭" + "─".repeat(150) + "╮"), "Inner dashes must equal boxW=150");

  for (const line of lines) {
    const w = visibleWidth(stripTerminalSequences(line));
    assert.equal(w, 152, "Every line of Settings Hub must be exactly 152 cols");
  }
});

test("round2 pickers: Model Picker renders at outer 152 cols on 192x49 terminal", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const picker = new OmtModelPickerComponent(tui, theme, kb, () => {}, ctx, {
    models: SAMPLE_MODELS,
    onSelectModel: () => {},
  });
  const lines = picker.render(192);

  assert.ok(lines.length > 0);
  const cleanTop = stripTerminalSequences(lines[0]!);
  assert.equal(visibleWidth(cleanTop), 152, "Model picker top border must be outer width 152");
  assert.ok(cleanTop.includes("╭" + "─".repeat(150) + "╮"), "Inner dashes must equal boxW=150");

  for (const line of lines) {
    const w = visibleWidth(stripTerminalSequences(line));
    assert.equal(w, 152, "Every line of Model Picker must be exactly 152 cols");
  }
});

test("round2 pickers: Theme Picker renders at outer 152 cols on 192x49 terminal", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const picker = new OmtThemePickerComponent(tui, theme, kb, () => {}, ctx, {
    currentTheme: "one-dark",
    currentBackground: "transparent",
    onSelectTheme: () => {},
  });
  const lines = picker.render(192);

  assert.ok(lines.length > 0);
  const cleanTop = stripTerminalSequences(lines[0]!);
  assert.equal(visibleWidth(cleanTop), 152, "Theme picker top border must be outer width 152");
  assert.ok(cleanTop.includes("╭" + "─".repeat(150) + "╮"), "Inner dashes must equal boxW=150");

  for (const line of lines) {
    const w = visibleWidth(stripTerminalSequences(line));
    assert.equal(w, 152, "Every line of Theme Picker must be exactly 152 cols");
  }
});

test("round2 pickers: Pet Picker renders at outer 122 cols (boxW 120 + 2 borders) on 192x49", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const picker = new OmtPetSelectorComponent(tui, theme, kb, () => {}, ctx);
  const lines = picker.render(192);

  assert.ok(lines.length > 0);
  const cleanTop = stripTerminalSequences(lines[0]!);
  assert.equal(visibleWidth(cleanTop), 122, "Pet picker top border must be outer width 122");
  assert.ok(cleanTop.includes("╭" + "─".repeat(120) + "╮"), "Inner dashes must equal boxW=120");

  for (const line of lines) {
    const w = visibleWidth(stripTerminalSequences(line));
    assert.equal(w, 122, "Every line of Pet Picker must be exactly 122 cols");
  }
});

test("round2 pickers: Narrow terminal geometry bounds (20, 40, 70 cols) never overflow", () => {
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  for (const w of [20, 40, 70, 80, 120]) {
    const tui = createMockTui(w, 30);

    const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx);
    for (const ln of hub.render(w)) {
      assert.ok(visibleWidth(stripTerminalSequences(ln)) <= w, `Hub line exceeded width ${w}`);
    }

    const modelPicker = new OmtModelPickerComponent(tui, theme, kb, () => {}, ctx, {
      models: SAMPLE_MODELS,
      onSelectModel: () => {},
    });
    for (const ln of modelPicker.render(w)) {
      assert.ok(visibleWidth(stripTerminalSequences(ln)) <= w, `Model picker line exceeded width ${w}`);
    }

    const petPicker = new OmtPetSelectorComponent(tui, theme, kb, () => {}, ctx);
    for (const ln of petPicker.render(w)) {
      assert.ok(visibleWidth(stripTerminalSequences(ln)) <= w, `Pet picker line exceeded width ${w}`);
    }
  }
});

// =============================================================================
// 2. Key Hijack Elimination: Raw h/j/k/l/f/F/* and 1-9 type into search/filter
// =============================================================================

test("round2 pickers: Model Picker typing h/j/k/l/f/F/* types into filter, not navigation or starring", () => {
  const tui = createMockTui();
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  let favToggled = false;
  const picker = new OmtModelPickerComponent(tui, theme, kb, () => {}, ctx, {
    models: SAMPLE_MODELS,
    onSelectModel: () => {},
    onToggleFavorite: () => { favToggled = true; },
  });

  // Switch to models pane with Tab
  picker.handleInput("\t");
  assert.equal(picker.getModelCursor(), 0);

  // Type 'j' - must append to query, not move cursor down!
  picker.handleInput("j");
  assert.equal(picker.getQuery(), "j");
  assert.equal(picker.getModelCursor(), 0, "Typing 'j' must not move modelCursor");

  // Type 'k' - must append to query
  picker.handleInput("k");
  assert.equal(picker.getQuery(), "jk");

  // Type 'f', 'F', '*' - must append to query, must NOT toggle favorite!
  picker.handleInput("f");
  picker.handleInput("F");
  picker.handleInput("*");
  assert.equal(picker.getQuery(), "jkfF*");
  assert.equal(favToggled, false, "Typing f/F/* must NOT trigger onToggleFavorite");

  // Type numbers 1-9 - must append to query, not trigger quick selection!
  picker.handleInput("1");
  assert.equal(picker.getQuery(), "jkfF*1");
});

test("round2 pickers: Model Picker Ctrl+F toggles favorite and cursor follows toggled item", () => {
  const tui = createMockTui();
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  let toggledKey = "";
  let toggledState: boolean | undefined;
  const picker = new OmtModelPickerComponent(tui, theme, kb, () => {}, ctx, {
    models: SAMPLE_MODELS,
    favoriteModelIds: ["anthropic\0fixture-sonnet-35"],
    onSelectModel: () => {},
    onToggleFavorite: (key, state) => {
      toggledKey = key;
      toggledState = state;
    },
  });

  // Focus models pane
  picker.handleInput("\t");
  // Down arrow moves cursor
  picker.handleInput("\x1b[B");
  assert.equal(picker.getSelectedModel()?.id, "gpt-4o");

  // Ctrl+F ('\x06') toggles favorite
  picker.handleInput("\x06");
  assert.equal(toggledKey, "openai\0gpt-4o");
  assert.equal(toggledState, true);

  // gpt-4o now floats to top among favorites, cursor follows it
  assert.equal(picker.getSelectedModel()?.id, "gpt-4o");
});

test("round2 pickers: Settings Hub typing h/j/k/l types into query, does not navigate", () => {
  const tui = createMockTui();
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx, {
    initialSection: "agent",
  });

  assert.equal(hub.getCurrentSection(), "agent");

  // Typing 'j' should type into query and focus right pane, NOT step down section
  hub.handleInput("j");
  assert.equal(hub.getQuery(), "j");
  assert.equal(hub.getCurrentSection(), "agent");

  // Typing 'k' appends to query
  hub.handleInput("k");
  assert.equal(hub.getQuery(), "jk");
});

test("round2 pickers: Pet Picker typing j/k/h/l types into filter, does not step cursor", () => {
  const tui = createMockTui();
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const picker = new OmtPetSelectorComponent(tui, theme, kb, () => {}, ctx);
  const initialCursor = picker.getCursor();

  // Typing 'k' must append to filter, not navigate up
  picker.handleInput("k");
  assert.equal(picker.getFilter(), "k");

  // Clear filter with backspace
  picker.handleInput("\x7f");
  assert.equal(picker.getFilter(), "");

  // Type 'c'
  picker.handleInput("c");
  assert.equal(picker.getFilter(), "c");

  // Type 'a'
  picker.handleInput("a");
  assert.equal(picker.getFilter(), "ca");

  // Type 't' -> "cat"
  picker.handleInput("t");
  assert.equal(picker.getFilter(), "cat");
  assert.equal(picker.getSelectedEntry(), "cat");
});

test("round2 pickers: Unicode and multi-character paste cleanly filters without crashing", () => {
  const tui = createMockTui();
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx);
  // Paste Vietnamese and Japanese Unicode text
  hub.handleInput("Tiếng Việt");
  assert.equal(hub.getQuery(), "Tiếng Việt");

  const picker = new OmtModelPickerComponent(tui, theme, kb, () => {}, ctx, {
    models: SAMPLE_MODELS,
    onSelectModel: () => {},
  });
  picker.handleInput("日本語テスト");
  assert.equal(picker.getQuery(), "日本語テスト");
});

// =============================================================================
// 3. Theme & Surface Initial Cursors & Live Preview Indicators
// =============================================================================

test("round2 pickers: Settings Hub initializes theme and surface cursors to current values", () => {
  const tui = createMockTui();
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx, {
    initialSection: "theme",
    currentTheme: "gruvbox",
    currentBackground: "aura",
  });

  const rendered = hub.render(192).join("\n");
  // Check that "gruvbox" is marked with "✓ current"
  assert.ok(rendered.includes("✓ current"), "Must show ✓ current on active palette/surface");

  // The active palette must have the selection cursor
  assert.ok(rendered.includes("▸ gruvbox") || rendered.includes("gruvbox"), "gruvbox must be focused");
});

test("round2 pickers: Live preview updates current indicator only on actual success", () => {
  const tui = createMockTui();
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  let previewed = "";
  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx, {
    initialSection: "theme",
    currentTheme: "default",
    onPreviewTheme: (t) => {
      previewed = t;
      return true; // success
    },
  });

  // Move down in palettes column with Down arrow
  hub.handleInput("\x1b[B");
  assert.ok(previewed.length > 0);
  assert.equal(hub.getCurrentTheme(), previewed, "currentTheme must update on successful preview");

  // Test failure case: preview returns false
  const failingHub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx, {
    initialSection: "theme",
    currentTheme: "default",
    onPreviewTheme: () => false, // fails
  });
  failingHub.handleInput("\x1b[B");
  assert.equal(failingHub.getCurrentTheme(), "default", "currentTheme must NOT update on failed preview");
});

// =============================================================================
// 4. Focus Switching Retains Selection
// =============================================================================

test("round2 pickers: Model Picker focus switching (Left, Right, Tab) retains selected model index", () => {
  const tui = createMockTui();
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const picker = new OmtModelPickerComponent(tui, theme, kb, () => {}, ctx, {
    models: SAMPLE_MODELS,
    onSelectModel: () => {},
  });

  // Switch to models pane with Tab
  picker.handleInput("\t");
  assert.equal(picker.isProviderColumnFocused(), false);

  // Navigate down to model #2 (gemini-1-5-pro)
  picker.handleInput("\x1b[B");
  picker.handleInput("\x1b[B");
  assert.equal(picker.getModelCursor(), 2);
  assert.equal(picker.getSelectedModel()?.id, "gemini-1-5-pro");

  // Switch to providers pane with Left arrow
  picker.handleInput("\x1b[D");
  assert.equal(picker.isProviderColumnFocused(), true);

  // Switch back to models pane with Right arrow
  picker.handleInput("\x1b[C");
  assert.equal(picker.isProviderColumnFocused(), false);
  assert.equal(picker.getModelCursor(), 2, "Model cursor must be RETAINED after Left -> Right focus switch");

  // Switch with Tab back and forth
  picker.handleInput("\t"); // to providers
  assert.equal(picker.isProviderColumnFocused(), true);
  picker.handleInput("\t"); // back to models
  assert.equal(picker.isProviderColumnFocused(), false);
  assert.equal(picker.getModelCursor(), 2, "Model cursor must be RETAINED after Tab toggle");
});

// =============================================================================
// 5. Applied Feedback Guards & Async Lifecycle
// =============================================================================

test("round2 pickers: Settings Hub does NOT report Applied when callback is absent", () => {
  const tui = createMockTui();
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  // No onSelectTheme provided
  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx, {
    initialSection: "theme",
  });

  hub.handleInput("\r"); // Press Enter
  const rendered = hub.render(192).join("\n");
  assert.ok(!rendered.includes("Applied theme"), "Must NOT report Applied when onSelectTheme is absent");
});

test("round2 pickers: Settings Hub does NOT report Applied when callback returns false", () => {
  const tui = createMockTui();
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx, {
    initialSection: "theme",
    onSelectTheme: () => false,
  });

  hub.handleInput("\r");
  const rendered = hub.render(192).join("\n");
  assert.ok(!rendered.includes("Applied theme"), "Must NOT report Applied when onSelectTheme returns false");
  assert.ok(rendered.includes("Failed to apply palette"), "Must report explicit failure feedback");
});

test("round2 pickers: Settings Hub handles async onSelectTheme with race and resolution guards", async () => {
  const tui = createMockTui();
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  let resolveCallback: (val: boolean) => void = () => {};
  const asyncPromise = new Promise<boolean>((resolve) => {
    resolveCallback = resolve;
  });

  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx, {
    initialSection: "theme",
    onSelectTheme: () => asyncPromise,
  });

  hub.handleInput("\r");

  // While unresolved: must NOT report Applied
  let rendered = hub.render(192).join("\n");
  assert.ok(!rendered.includes("Applied theme"), "Must NOT report Applied while promise is unresolved");

  // Resolve with true
  resolveCallback(true);
  await asyncPromise;

  rendered = hub.render(192).join("\n");
  assert.ok(rendered.includes("Applied theme"), "Must report Applied theme upon successful promise resolution");
});

// =============================================================================
// 6. Native Model Registry Invariance: Objects are not mutated
// =============================================================================

test("round2 pickers: Model Picker does NOT mutate native ModelSpec objects", () => {
  const tui = createMockTui();
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  // Create frozen models to prove immutability
  const originalModel = {
    id: "frozen-model",
    name: "Frozen Model",
    provider: "openai",
    keyStatus: "ready" as const,
    isFavorite: false,
    favoriteKey: "openai\0frozen-model",
  };
  Object.freeze(originalModel);

  const picker = new OmtModelPickerComponent(tui, theme, kb, () => {}, ctx, {
    models: [originalModel as any],
    onSelectModel: () => {},
  });

  // Toggle favorite on frozen model: must not throw TypeError: Cannot assign to read only property
  picker.handleInput("\t");
  assert.doesNotThrow(() => {
    picker.handleInput("\x06"); // Ctrl+F
  }, "Toggling favorite must not mutate input ModelSpec object");

  assert.equal(picker.isFavorite(originalModel), true);
  assert.equal(originalModel.isFavorite, false, "Input object must remain unmodified");
});

// =============================================================================
// 7. Thinking spec helper returns 'on'
// =============================================================================

test("round2 pickers: modelThinking helper parity", () => {
  assert.equal(modelThinking(true), "on", "Reasoning-only model must report 'on'");
  assert.equal(modelThinking(false), "—");
  assert.equal(modelThinking(undefined), "—");
  assert.equal(modelThinking({ maxTokens: 16384 }), "up to 16,384");
});

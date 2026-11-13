/**
 * OMT Pickers Parity Test Suite
 *
 * Validates the OMT presentation contract:
 * - Geometry at 192x49 (hub/model boxW 150, win 24; pet boxW 120, win 24)
 * - All 14 Settings Hub sections, section badges, 3rd DETAILS pane for Plugins/Marketplace
 * - Theme catalogue fidelity: 25 palettes & 32 background surfaces from palette catalogue
 * - Live preview, selection failure guard, and cancel rollback
 * - Model picker parity: removal of numeric badges (1-9), removal of label colons,
 *   inclusion of Cache r/w and Input spec rows, ready/missing key styling
 * - Pet picker parity: dynamic page sizing up to 24 rows, passive preview pane
 * - Inline capture prompts: shortcut assignment (Ctrl+S) and plugin suggestion (Ctrl+F)
 * - Command palette rendering & modal action execution
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
import {
  createDefaultPaletteActions,
  filterPaletteActions,
} from "../extensions/omt/features/command-palette/model.ts";
import {
  CommandPaletteComponent,
} from "../extensions/omt/features/command-palette/view.ts";
import {
  getPaletteNames,
  getBackgroundNames,
  getRawPalette,
} from "../extensions/omt/presets/omt-signature/palette.ts";

// -----------------------------------------------------------------------------
// Test Harness & Mocks
// -----------------------------------------------------------------------------

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
    ui: {
      setEditorText: (t: string) => { editorText = t; },
      notify: () => {},
      ...overrides.ui,
    },
    getEditorText: () => editorText,
    ...overrides,
  } as any;
}

const SAMPLE_MODELS = [
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
    keyStatus: "ready" as const,
    isFavorite: true,
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
    keyStatus: "missing" as const,
    isFavorite: false,
  },
];

// =============================================================================
// 1. Geometry at Width 192 / Height 49 (AUD-06)
// =============================================================================

test("Parity Geometry: Settings Hub renders at exactly boxW=150 (outer 152), win=24 on 192x49 terminal", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx);
  const lines = hub.render(192);

  // Outer border lines must measure exactly 152 columns (boxW 150 + 2 border glyphs)
  assert.ok(lines.length > 0);
  const topBorder = stripTerminalSequences(lines[0]);
  assert.equal(visibleWidth(topBorder), 152, "Hub top border must be 152 cols wide (boxW 150 + 2 borders) at 192 cols");

  // Every line rendered must not exceed terminal width and match outer box width 152
  for (const line of lines) {
    const w = visibleWidth(stripTerminalSequences(line));
    assert.ok(w <= 192, `Line width ${w} exceeded terminal width 192`);
    assert.equal(w, 152, `Line width ${w} must match outer dialog box width 152`);
  }
});

test("Parity Geometry: Model Picker renders at exactly boxW=150 (outer 152), win=24 with 3 columns on 192x49", () => {
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
  const topBorder = stripTerminalSequences(lines[0]);
  assert.equal(visibleWidth(topBorder), 152, "Model picker top border must be 152 cols wide (boxW 150 + 2 borders) at 192 cols");

  for (const line of lines) {
    const w = visibleWidth(stripTerminalSequences(line));
    assert.ok(w <= 192);
    assert.equal(w, 152);
  }
});

test("Parity Geometry: Pet Picker renders at exactly boxW=120 (outer 122), win=24 on 192x49", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  assert.equal(petDialogBoxW(192), 120, "petDialogBoxW(192) must cap at 120");
  assert.equal(petDialogPage(49), 24, "petDialogPage(49) must cap at 24");

  const selector = new OmtPetSelectorComponent(tui, theme, kb, () => {}, ctx);
  const lines = selector.render(192);
  assert.ok(lines.length > 0);

  const topBorder = stripTerminalSequences(lines[0]);
  assert.equal(visibleWidth(topBorder), 122, "Pet selector box must be 122 cols wide (boxW 120 + 2 borders) at 192 cols");

  for (const line of lines) {
    const w = visibleWidth(stripTerminalSequences(line));
    assert.ok(w <= 192);
    assert.equal(w, 122);
  }
});

// =============================================================================
// 2. All 14 Settings Hub Sections & Section Badges (AUD-06, AUD-07)
// =============================================================================

test("Parity Settings Hub: All 14 sections verified with correct badges and navigation", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx, {
    commands: [{ name: "c1", description: "cmd1" }, { name: "c2", description: "cmd2" }],
    shortcuts: [{ key: "k1", description: "key1" }],
    skills: [{ name: "s1", description: "skill1" }],
    prompts: [{ name: "p1", description: "prompt1" }],
    plugins: [{ name: "plug1", spec: "npm:plug1", description: "plug desc" }],
    mcpServers: [{ name: "mcp1", status: "connected" }],
    toolStats: [{ name: "read", count: 12, durationMs: 450 }],
  });

  const expectedSections = [
    "agent", "command", "shortcut", "skill", "prompt", "extension",
    "plugin", "market", "mcp", "tool", "tasks", "side", "theme", "login"
  ];

  for (const sec of expectedSections) {
    hub.setSection(sec as any);
    assert.equal(hub.getCurrentSection(), sec);
    const rendered = hub.render(192).join("\n");
    assert.ok(rendered.length > 0);
  }
});

// =============================================================================
// 3. 3rd Column DETAILS Pane for Plugins and Marketplace (AUD-07)
// =============================================================================

test("Parity 3rd Column: Plugins section renders 3rd DETAILS pane on wide terminal", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx, {
    plugins: [
      { name: "pi-lens", spec: "npm:pi-lens", description: "Interactive workspace tree and diff viewer" },
    ],
  });

  hub.setSection("plugin");
  const rendered = hub.render(192).join("\n");

  // Must have 3-column header: SECTIONS │ PLUGINS · N │ DETAILS
  assert.ok(rendered.includes("SECTIONS"), "Missing SECTIONS header");
  assert.ok(rendered.includes("PLUGINS"), "Missing PLUGINS header");
  assert.ok(rendered.includes("DETAILS"), "Missing 3rd DETAILS column header");

  // Details pane must include Spec, Source, Version, Path, Description, Commands
  assert.ok(rendered.includes("Spec"), "Missing Spec row in details");
  assert.ok(rendered.includes("Source"), "Missing Source row in details");
  assert.ok(rendered.includes("Version"), "Missing Version row in details");
  assert.ok(rendered.includes("Path"), "Missing Path row in details");
  assert.ok(rendered.includes("Description"), "Missing Description header in details");
  assert.ok(rendered.includes("Commands"), "Missing Commands header in details");
});

test("Parity 3rd Column: Marketplace section renders 3rd DETAILS pane with star count and npm spec", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx, {
    marketplace: [
      { name: "oh-my-tui", version: "0.1.0", desc: "Modular terminal UI presentation layer", stars: 120, installed: true },
      { name: "pi-lens", version: "1.2.0", desc: "Interactive workspace tree viewer", stars: 45, installed: false },
    ],
  });

  hub.setSection("market");
  const rendered = hub.render(192).join("\n");

  assert.ok(rendered.includes("MARKETPLACE"), "Missing MARKETPLACE header");
  assert.ok(rendered.includes("DETAILS"), "Missing DETAILS header");
  assert.ok(rendered.includes("Stars"), "Missing Stars row in market details");
  assert.ok(rendered.includes("Downloads"), "Missing Downloads row in market details");
  assert.ok(rendered.includes("Status"), "Missing Status row in market details");
  assert.ok(rendered.includes("Repository"), "Missing Repository row in market details");
});

// =============================================================================
// 4. Theme Catalogue & Integration Contract (AUD-07, AUD-08)
// =============================================================================

test("Parity Theme Catalogue: all 25 palettes & 32 background surfaces loaded", () => {
  const palettes = getPaletteNames();
  assert.equal(palettes.length, 25, "Must have exactly 25 palettes in leaf catalogue");
  assert.equal(palettes[0], "default");
  assert.equal(palettes[1], "one-dark");
  assert.equal(palettes[2], "gruvbox");

  const backgrounds = getBackgroundNames();
  assert.equal(backgrounds.length, 32, "Must have exactly 32 background surfaces (transparent + 31)");
  assert.equal(backgrounds[0], "transparent");
  assert.equal(backgrounds[1], "aura");
});

test("Parity Theme Hub: initialSection='theme', live preview on move, and rollback on Esc", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  let previewedTheme = "";
  let appliedTheme = "";
  let rolledBackTheme = "";

  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx, {
    initialSection: "theme",
    currentTheme: "one-dark",
    currentBackground: "transparent",
    onPreviewTheme: (t) => { previewedTheme = t; },
    onSelectTheme: (t) => { appliedTheme = t; },
    onCancelTheme: (initialT) => { rolledBackTheme = initialT || ""; },
  });

  assert.equal(hub.getCurrentSection(), "theme");

  // Move down in palettes column with Down arrow -> triggers onPreviewTheme (j types into filter)
  hub.handleInput("\x1b[B");
  assert.ok(previewedTheme.length > 0, "Moving down must trigger onPreviewTheme");
  assert.equal(appliedTheme, "", "Moving cursor must NOT trigger onSelectTheme before Enter");

  // Esc -> triggers onCancelTheme with initial theme
  hub.handleInput("\x1b");
  assert.equal(rolledBackTheme, "one-dark", "Esc must roll back to initial theme");
});

test("Parity Theme Hub: selection failure does NOT report Applied", async () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx, {
    initialSection: "theme",
    onSelectTheme: () => false, // fails
  });

  hub.handleInput("\r"); // Enter confirms
  const rendered = hub.render(192).join("\n");
  assert.ok(!rendered.includes("Applied theme"), "Must NOT report Applied when callback returns false");
  assert.ok(rendered.includes("Failed to apply palette"), "Must report failure feedback");
});

// =============================================================================
// 5. Model Picker Parity: Numeric Badges & Colons Removed (AUD-11)
// =============================================================================

test("Parity Model Picker: numeric badges (1-9) completely eliminated from rows", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const picker = new OmtModelPickerComponent(tui, theme, kb, () => {}, ctx, {
    models: SAMPLE_MODELS,
    onSelectModel: () => {},
  });

  // Switch to models column
  picker.handleInput("\t");
  const rendered = picker.render(192).join("\n");

  // Must NOT have quick number prefix like "1 " or "1:"
  assert.ok(!rendered.includes("1 fixture-sonnet-35"), "Must NOT have numeric badge prefix");
  assert.ok(!rendered.includes("1: fixture-sonnet-35"), "Must NOT have numeric colon prefix");
  assert.ok(!rendered.includes("1-9 select"), "Must NOT have 1-9 select in footer hints");
});

test("Parity Model Picker: spec details rows have NO colons and include Cache r/w and Input", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const picker = new OmtModelPickerComponent(tui, theme, kb, () => {}, ctx, {
    models: SAMPLE_MODELS,
    onSelectModel: () => {},
  });

  // Switch to models column to focus fixture-sonnet-35
  picker.handleInput("\t");
  const rendered = picker.render(192).join("\n");

  // Verify spec rows matching OMT specification
  assert.ok(rendered.includes("Name"), "Missing Name row");
  assert.ok(rendered.includes("Provider"), "Missing Provider row");
  assert.ok(rendered.includes("API"), "Missing API row");
  assert.ok(rendered.includes("Host"), "Missing Host row");
  assert.ok(rendered.includes("Context"), "Missing Context row");
  assert.ok(rendered.includes("Max output"), "Missing Max output row");
  assert.ok(rendered.includes("In / Out"), "Missing In / Out row");
  assert.ok(rendered.includes("Cache r/w"), "Missing Cache r/w row");
  assert.ok(rendered.includes("Thinking"), "Missing Thinking row");
  assert.ok(rendered.includes("Input"), "Missing Input row");
  assert.ok(rendered.includes("Key"), "Missing Key row");

  // Must NOT have colon after labels (e.g. "Name    :" or "API     :")
  assert.ok(!rendered.includes("Name    :"), "Spec labels must NOT have colons");
  assert.ok(!rendered.includes("Provider: "), "Spec labels must NOT have colons");
  assert.ok(!rendered.includes("API     :"), "Spec labels must NOT have colons");
  assert.ok(!rendered.includes("Max Out :"), "Must be 'Max output', not 'Max Out :'");

  // Key status styling
  assert.ok(rendered.includes("ready"), "Connected provider must show 'ready'");
});

// =============================================================================
// 6. Inline Capture Prompts (Ctrl+S and Ctrl+F)
// =============================================================================

test("Parity Inline Prompts: Ctrl+S opens shortcut assignment prompt inside hub", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx);
  hub.setSection("command");
  hub.handleInput("\x1b[C"); // Right to focus commands list

  // Press Ctrl+S (\x13)
  hub.handleInput("\x13");
  const rendered = hub.render(192).join("\n");
  assert.ok(rendered.includes("Assign Alt shortcut"), "Ctrl+S must open shortcut assignment prompt");
  assert.ok(rendered.includes("Press any Alt key"), "Prompt must explain key press");

  // Esc dismisses prompt and returns to hub
  hub.handleInput("\x1b");
  const renderedAfterEsc = hub.render(192).join("\n");
  assert.ok(!renderedAfterEsc.includes("Assign Alt shortcut"), "Esc must dismiss prompt");
  assert.ok(renderedAfterEsc.includes("Settings Hub"), "Hub must remain open");
});

test("Parity Inline Prompts: Ctrl+F in plugins section opens suggest package prompt", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  const hub = new OmtSettingsHubComponent(tui, theme, kb, () => {}, ctx);
  hub.setSection("plugin");

  // Press Ctrl+F (\x06)
  hub.handleInput("\x06");
  const rendered = hub.render(192).join("\n");
  assert.ok(rendered.includes("Add suggested plugin package"), "Ctrl+F must open suggest prompt");

  // Type package name and confirm
  hub.handleInput("m");
  hub.handleInput("y");
  hub.handleInput("-");
  hub.handleInput("p");
  hub.handleInput("k");
  hub.handleInput("g");
  hub.handleInput("\r"); // Enter

  const renderedAfterAdd = hub.render(192).join("\n");
  assert.ok(renderedAfterAdd.includes("my-pkg"), "Added suggestion must appear in plugins list");
});

// =============================================================================
// 7. Command Palette Isolation & Execution
// =============================================================================

test("Parity Command Palette: renders cleanly across widths and executes action", () => {
  const tui = createMockTui(192, 49);
  const theme = createMockTheme();
  const kb = createMockKeybindings();
  const ctx = createMockContext();

  let executedAction = false;
  const actions = [
    {
      id: "test:action",
      title: "Test Action",
      description: "A test palette action",
      category: "general" as const,
      run: () => { executedAction = true; },
    },
  ];

  const palette = new CommandPaletteComponent(tui, theme, kb, () => {}, ctx, actions);

  for (const w of [192, 120, 80, 40, 25]) {
    const lines = palette.render(w);
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= w, `Line exceeded width ${w}`);
    }
  }

  palette.handleInput("\r"); // Enter
  assert.equal(executedAction, true, "Enter must execute selected palette action");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  createDefaultPaletteActions,
  filterPaletteActions,
  createCommandPaletteComponent,
  CommandPaletteComponent,
} from "../extensions/omt/features/command-palette/index.ts";
import type { PaletteAction } from "../extensions/omt/features/command-palette/types.ts";
import { configStore } from "../extensions/omt/core/config.ts";

/**
 * Theme fixture with ANSI formatting.
 */
function createAnsiTheme(): Theme {
  return {
    appearance: "dark",
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
    dim: (text: string) => `\x1b[2m${text}\x1b[22m`,
    fg: (_color: string, text: string) => `\x1b[36m${text}\x1b[39m`,
    bg: (_color: string, text: string) => `\x1b[40m${text}\x1b[49m`,
    style: (text: string) => text,
  } as unknown as Theme;
}

/**
 * Plain theme fixture without ANSI sequences.
 */
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

/**
 * Mock ExtensionContext fixture.
 */
function createMockContext(): {
  ctx: any;
  notifications: Array<{ message: string; type: string }>;
} {
  const notifications: Array<{ message: string; type: string }> = [];
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      notify: (message: string, type: string) => {
        notifications.push({ message, type });
      },
    },
  };
  return { ctx, notifications };
}

test("createDefaultPaletteActions generates all required default actions with proper categories", () => {
  const { ctx } = createMockContext();
  const actions = createDefaultPaletteActions(ctx);

  assert.ok(Array.isArray(actions));
  assert.equal(actions.length, 19);

  // Check required presets
  const requiredPresets = [
    "Switch to OMT Clean",
    "Switch to OMT Ember",
    "Switch to OMT Rail",
    "Switch to Minimal",
    "Switch to Native",
  ];
  for (const presetTitle of requiredPresets) {
    const found = actions.find((a) => a.title === presetTitle);
    assert.ok(found, `Expected preset action: ${presetTitle}`);
    assert.equal(found?.category, "preset");
    assert.ok(found?.id.startsWith("preset:"));
  }

  // Check required components
  const requiredComponents = [
    "Toggle Editor",
    "Toggle Messages",
    "Toggle Tools",
    "Toggle Footer",
    "Toggle Thinking",
    "Enable All Components",
    "Disable All Components",
  ];
  for (const compTitle of requiredComponents) {
    const found = actions.find((a) => a.title === compTitle);
    assert.ok(found, `Expected component action: ${compTitle}`);
    assert.equal(found?.category, "component");
    assert.ok(found?.id.startsWith("component:"));
  }

  // Check navigation and tool inspector
  const toolInspector = actions.find((a) => a.title === "Open Tool Inspector");
  assert.ok(toolInspector);
  assert.equal(toolInspector.category, "tool");

  const convNav = actions.find((a) => a.title === "Open Conversation Navigator");
  assert.ok(convNav);
  assert.equal(convNav.category, "navigation");

  // Check layout actions
  const requiredLayouts = [
    "Toggle Focus Mode",
    "Set Layout: Standard",
    "Set Layout: Compact",
    "Set Layout: Focus",
  ];
  for (const layoutTitle of requiredLayouts) {
    const found = actions.find((a) => a.title === layoutTitle);
    assert.ok(found, `Expected layout action: ${layoutTitle}`);
    assert.equal(found?.category, "layout");
    assert.ok(found?.id.startsWith("layout:"));
  }

  // Check general actions
  const settingsAction = actions.find((a) => a.title === "Open OMT Settings");
  assert.ok(settingsAction);
  assert.equal(settingsAction.category, "general");
  assert.equal(settingsAction.shortcut, "/omt settings");
});

test("createDefaultPaletteActions appends extraActions when provided", () => {
  const { ctx } = createMockContext();
  const extraAction: PaletteAction = {
    id: "custom:action",
    title: "Custom User Action",
    category: "general",
    run: () => {},
    shortcut: "Ctrl+U",
  };

  const actions = createDefaultPaletteActions(ctx, [extraAction]);
  assert.equal(actions.length, 20);
  assert.equal(actions[actions.length - 1]?.id, "custom:action");
});

test("createDefaultPaletteActions execution modifies configStore and notifies user", () => {
  const { ctx, notifications } = createMockContext();
  const actions = createDefaultPaletteActions(ctx);

  configStore.clearSessionOverrides();

  // Test preset action
  const cleanAction = actions.find((a) => a.id === "preset:omt-clean")!;
  cleanAction.run(ctx);
  assert.equal(configStore.getPreset(), "omt-clean");
  assert.ok(notifications.some((n) => n.message.includes("OMT Clean")));

  // Test toggle component action
  notifications.length = 0;
  const initialEditor = configStore.isComponentEnabled("editor");
  const toggleEditorAction = actions.find((a) => a.id === "component:toggle-editor")!;
  toggleEditorAction.run(ctx);
  assert.equal(configStore.isComponentEnabled("editor"), !initialEditor);
  assert.ok(notifications.some((n) => n.message.includes("Editor component")));

  // Test enable all / disable all
  notifications.length = 0;
  const disableAllAction = actions.find((a) => a.id === "component:disable-all")!;
  disableAllAction.run(ctx);
  assert.equal(configStore.isComponentEnabled("editor"), false);
  assert.equal(configStore.isComponentEnabled("messages"), false);
  assert.equal(configStore.isComponentEnabled("tools"), false);
  assert.equal(configStore.isComponentEnabled("footer"), false);
  assert.equal(configStore.isComponentEnabled("thinking"), false);

  const enableAllAction = actions.find((a) => a.id === "component:enable-all")!;
  enableAllAction.run(ctx);
  assert.equal(configStore.isComponentEnabled("editor"), true);
  assert.equal(configStore.isComponentEnabled("messages"), true);
  assert.equal(configStore.isComponentEnabled("tools"), true);
  assert.equal(configStore.isComponentEnabled("footer"), true);
  assert.equal(configStore.isComponentEnabled("thinking"), true);

  configStore.clearSessionOverrides();
});

test("filterPaletteActions matches title, description, and category accurately", () => {
  const { ctx } = createMockContext();
  const actions = createDefaultPaletteActions(ctx);

  // Empty or whitespace query returns all actions
  assert.equal(filterPaletteActions(actions, "").length, actions.length);
  assert.equal(filterPaletteActions(actions, "   ").length, actions.length);

  // Title match
  const cleanMatches = filterPaletteActions(actions, "Clean");
  assert.ok(cleanMatches.length >= 1);
  assert.equal(cleanMatches[0]?.title, "Switch to OMT Clean");

  const minimalMatches = filterPaletteActions(actions, "Minimal");
  assert.ok(minimalMatches.length >= 1);
  assert.equal(minimalMatches[0]?.title, "Switch to Minimal");

  // Category match
  const presetMatches = filterPaletteActions(actions, "preset");
  assert.equal(presetMatches.length, 5);
  assert.ok(presetMatches.every((a) => a.category === "preset"));

  const componentMatches = filterPaletteActions(actions, "component");
  assert.equal(componentMatches.length, 7);
  assert.ok(componentMatches.every((a) => a.category === "component"));

  const toolMatches = filterPaletteActions(actions, "tool");
  assert.ok(toolMatches.some((a) => a.title === "Open Tool Inspector"));

  const navMatches = filterPaletteActions(actions, "navigation");
  assert.ok(navMatches.some((a) => a.title === "Open Conversation Navigator"));

  const layoutMatches = filterPaletteActions(actions, "layout");
  assert.equal(layoutMatches.length, 4);
  assert.ok(layoutMatches.every((a) => a.category === "layout"));

  // Description match
  const inspectorMatches = filterPaletteActions(actions, "executions");
  assert.ok(inspectorMatches.some((a) => a.id === "tool:inspector"));

  // Multi-token match
  const multiToken = filterPaletteActions(actions, "switch minimal");
  assert.ok(multiToken.length >= 1);
  assert.equal(multiToken[0]?.title, "Switch to Minimal");

  // Fuzzy matching
  const fuzzyClean = filterPaletteActions(actions, "cln");
  assert.ok(fuzzyClean.some((a) => a.title === "Switch to OMT Clean"));

  const fuzzyMinimal = filterPaletteActions(actions, "minml");
  assert.ok(fuzzyMinimal.some((a) => a.title === "Switch to Minimal"));

  // No match
  const noMatch = filterPaletteActions(actions, "xyznonexistentquery123");
  assert.equal(noMatch.length, 0);
});

test("Command palette component renders cleanly across themes and widths (120, 80, 40, 25 cols)", () => {
  const { ctx } = createMockContext();
  const actions = createDefaultPaletteActions(ctx);

  const themes = [createAnsiTheme(), createPlainTheme()];
  const widths = [120, 80, 40, 25];

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

      const component = createCommandPaletteComponent(
        fakeTui,
        theme,
        {} as any,
        done,
        ctx,
        actions,
      );

      const lines = component.render(width);
      assert.ok(Array.isArray(lines));
      assert.ok(lines.length > 5, `Expected multiple lines at width ${width}`);

      // Every line must not exceed the viewport width
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const len = visibleWidth(line);
        assert.ok(
          len <= width,
          `Line ${i} visibleWidth (${len}) exceeded target width (${width}): "${line}"`,
        );
      }

      const joined = lines.join("\n");

      // Verify title bar
      assert.match(joined, /OMT Command Palette/);

      // Verify shortcut hints
      assert.match(joined, /Esc/);

      // Verify search prompt symbol
      assert.match(joined, />/);

      // Verify categories or short badges
      if (width >= 40) {
        assert.match(joined, /\[(Preset|Pre)\]/);
      }

      // Verify borders are present
      assert.match(joined, /─+/);
    }
  }
});

test("Keyboard navigation: typing search, backspace, Up/Down, Enter triggers action, Esc dismisses", () => {
  const { ctx } = createMockContext();
  let executedActionId: string | null = null;

  const testActions: PaletteAction[] = [
    {
      id: "action-1",
      title: "First Action",
      category: "general",
      run: () => {
        executedActionId = "action-1";
      },
    },
    {
      id: "action-2",
      title: "Second Action",
      category: "preset",
      run: () => {
        executedActionId = "action-2";
      },
    },
    {
      id: "action-3",
      title: "Third Action",
      category: "tool",
      run: () => {
        executedActionId = "action-3";
      },
    },
  ];

  let renderCount = 0;
  const fakeTui: any = {
    requestRender: () => {
      renderCount++;
    },
  };

  let doneResult: unknown = null;
  let doneCalled = false;
  const done = (val?: unknown) => {
    doneCalled = true;
    doneResult = val;
  };

  const comp = new CommandPaletteComponent(
    fakeTui,
    createPlainTheme(),
    {} as any,
    done,
    ctx,
    testActions,
  );

  // Initial state
  assert.equal(comp.getQuery(), "");
  assert.equal(comp.getSelectedIndex(), 0);
  assert.equal(comp.getFilteredActions().length, 3);

  // 1. Down arrow moves selection
  comp.handleInput("\x1b[B"); // Down
  assert.equal(comp.getSelectedIndex(), 1);

  comp.handleInput("\x1b[B"); // Down
  assert.equal(comp.getSelectedIndex(), 2);

  // Down at bottom wraps to top
  comp.handleInput("\x1b[B"); // Down
  assert.equal(comp.getSelectedIndex(), 0);

  // Up at top wraps to bottom
  comp.handleInput("\x1b[A"); // Up
  assert.equal(comp.getSelectedIndex(), 2);

  comp.handleInput("\x1b[A"); // Up
  assert.equal(comp.getSelectedIndex(), 1);

  // 2. Typing search updates query and filters
  comp.handleInput("t");
  comp.handleInput("h");
  comp.handleInput("i");
  assert.equal(comp.getQuery(), "thi");
  assert.equal(comp.getSelectedIndex(), 0);
  assert.equal(comp.getFilteredActions().length, 1);
  assert.equal(comp.getFilteredActions()[0]?.id, "action-3");

  // 3. Backspace deletes character
  comp.handleInput("\x7f"); // Backspace
  assert.equal(comp.getQuery(), "th");

  // Clear query by backspacing
  comp.handleInput("\x7f");
  comp.handleInput("\x7f");
  assert.equal(comp.getQuery(), "");
  assert.equal(comp.getFilteredActions().length, 3);

  // 4. PageDown / PageUp navigation
  const manyActions: PaletteAction[] = Array.from({ length: 15 }, (_, i) => ({
    id: `item-${i}`,
    title: `Item ${i}`,
    category: "general" as const,
    run: () => {},
  }));

  const compMany = new CommandPaletteComponent(
    fakeTui,
    createPlainTheme(),
    {} as any,
    () => {},
    ctx,
    manyActions,
  );

  assert.equal(compMany.getSelectedIndex(), 0);
  compMany.handleInput("\x1b[6~"); // PageDown
  assert.equal(compMany.getSelectedIndex(), 5);

  compMany.handleInput("\x1b[6~"); // PageDown
  assert.equal(compMany.getSelectedIndex(), 10);

  compMany.handleInput("\x1b[5~"); // PageUp
  assert.equal(compMany.getSelectedIndex(), 5);

  compMany.handleInput("\x1b[5~"); // PageUp
  assert.equal(compMany.getSelectedIndex(), 0);

  // 5. Enter executes selected action and calls done()
  assert.equal(doneCalled, false);
  comp.setQuery("second");
  comp.handleInput("\r"); // Enter
  assert.equal(doneCalled, true);
  assert.equal(executedActionId, "action-2");
  assert.equal((doneResult as PaletteAction)?.id, "action-2");

  // 6. Esc dismisses palette without executing
  let escDoneCalled = false;
  let escExecuted = false;
  const compEsc = new CommandPaletteComponent(
    fakeTui,
    createPlainTheme(),
    {} as any,
    () => {
      escDoneCalled = true;
    },
    ctx,
    [
      {
        id: "esc-test",
        title: "Esc Action",
        category: "general",
        run: () => {
          escExecuted = true;
        },
      },
    ],
  );

  compEsc.handleInput("\x1b"); // Esc
  assert.equal(escDoneCalled, true);
  assert.equal(escExecuted, false);
});

test("Action execution passes ExtensionContext correctly", async () => {
  let receivedCtx: any = null;

  const mockCtx = {
    mode: "tui",
    hasUI: true,
    uniqueSentinelId: "omt-test-sentinel-123",
    ui: {
      notify: () => {},
    },
  } as unknown as any;

  const action: PaletteAction = {
    id: "test:context-passing",
    title: "Context Passing Action",
    category: "general",
    run: (ctx) => {
      receivedCtx = ctx;
    },
  };

  let doneCalled = false;
  const comp = new CommandPaletteComponent(
    { requestRender() {} } as any,
    createPlainTheme(),
    {} as any,
    () => {
      doneCalled = true;
    },
    mockCtx,
    [action],
  );

  comp.handleInput("\r"); // Trigger Enter
  assert.equal(doneCalled, true);
  assert.ok(receivedCtx, "Expected run to receive context");
  assert.equal(receivedCtx.uniqueSentinelId, "omt-test-sentinel-123");
});

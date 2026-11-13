import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  createTabBarComponent,
  DEFAULT_TABS,
  TabBarComponent,
} from "../extensions/omt/features/multi-view-tabs/index.ts";
import type { TabId, TabItem } from "../extensions/omt/features/multi-view-tabs/types.ts";

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

test("TabBarComponent default tabs conform to required items (Chat, Inspector, Git, Sessions, Doctor)", () => {
  assert.equal(DEFAULT_TABS.length, 5);
  assert.deepEqual(
    DEFAULT_TABS.map((t) => ({ id: t.id, shortcut: t.shortcut })),
    [
      { id: "chat", shortcut: "1" },
      { id: "inspector", shortcut: "2" },
      { id: "git", shortcut: "3" },
      { id: "sessions", shortcut: "4" },
      { id: "doctor", shortcut: "5" },
    ],
  );
});

test("TabBarComponent active tab changes and triggers onSelectTab callback", () => {
  let selectedTab: TabId | null = null;
  const onSelectTab = (id: TabId) => {
    selectedTab = id;
  };

  let renderCount = 0;
  const fakeTui: any = {
    requestRender: () => {
      renderCount++;
    },
  };

  const bar = new TabBarComponent(fakeTui, createPlainTheme(), {
    activeTab: "chat",
    onSelectTab,
  });

  assert.equal(bar.getActiveTab(), "chat");

  // Cycle to next tab (Right arrow)
  bar.handleInput("\x1b[C");
  assert.equal(bar.getActiveTab(), "inspector");
  assert.equal(selectedTab, "inspector");

  // Next tab via 'l'
  bar.handleInput("l");
  assert.equal(bar.getActiveTab(), "git");
  assert.equal(selectedTab, "git");

  // Previous tab via Left arrow (\x1b[D)
  bar.handleInput("\x1b[D");
  assert.equal(bar.getActiveTab(), "inspector");
  assert.equal(selectedTab, "inspector");

  // Previous tab via 'h'
  bar.handleInput("h");
  assert.equal(bar.getActiveTab(), "chat");
  assert.equal(selectedTab, "chat");

  // Wrap around left from first tab to last tab
  bar.handleInput("h");
  assert.equal(bar.getActiveTab(), "doctor");
  assert.equal(selectedTab, "doctor");

  // Wrap around right from last tab to first tab
  bar.handleInput("l");
  assert.equal(bar.getActiveTab(), "chat");
  assert.equal(selectedTab, "chat");
});

test("TabBarComponent number key navigation '1'..'5' jumps directly to tab", () => {
  let selectedTab: TabId | null = null;
  const onSelectTab = (id: TabId) => {
    selectedTab = id;
  };

  const fakeTui: any = { requestRender: () => {} };
  const bar = new TabBarComponent(fakeTui, createPlainTheme(), {
    activeTab: "chat",
    onSelectTab,
  });

  // Jump to Git (3)
  bar.handleInput("3");
  assert.equal(bar.getActiveTab(), "git");
  assert.equal(selectedTab, "git");

  // Jump to Doctor (5)
  bar.handleInput("5");
  assert.equal(bar.getActiveTab(), "doctor");
  assert.equal(selectedTab, "doctor");

  // Jump to Inspector (2)
  bar.handleInput("2");
  assert.equal(bar.getActiveTab(), "inspector");
  assert.equal(selectedTab, "inspector");

  // Jump to Sessions (4)
  bar.handleInput("4");
  assert.equal(bar.getActiveTab(), "sessions");
  assert.equal(selectedTab, "sessions");

  // Jump to Chat (1)
  bar.handleInput("1");
  assert.equal(bar.getActiveTab(), "chat");
  assert.equal(selectedTab, "chat");
});

test("TabBarComponent Tab and Shift+Tab cycling", () => {
  const fakeTui: any = { requestRender: () => {} };
  const bar = new TabBarComponent(fakeTui, createPlainTheme(), {
    activeTab: "chat",
  });

  bar.handleInput("\t");
  assert.equal(bar.getActiveTab(), "inspector");

  bar.handleInput("\x1b[Z"); // Shift+Tab
  assert.equal(bar.getActiveTab(), "chat");
});

test("TabBarComponent renders full labels on wide viewports (>= 60 cols) with active highlighted", () => {
  const fakeTui: any = { requestRender: () => {} };
  const bar = new TabBarComponent(fakeTui, createPlainTheme(), {
    activeTab: "inspector",
  });

  const lines = bar.render(80);
  assert.ok(lines.length >= 2);
  const text = lines[0]!;

  // Must contain full labels
  assert.ok(text.includes("[1:Chat]"));
  assert.ok(text.includes("[2:Inspector]"));
  assert.ok(text.includes("[3:Git]"));
  assert.ok(text.includes("[4:Sessions]"));
  assert.ok(text.includes("[5:Doctor]"));
});

test("TabBarComponent collapses labels on narrow viewports ([1:C] [2:T]/[2:I] [3:G] [4:S] [5:D])", () => {
  const fakeTui: any = { requestRender: () => {} };
  const customTabs: TabItem[] = [
    { id: "chat", label: "Chat", shortcut: "1" },
    { id: "inspector", label: "Tools", shortcut: "2" },
    { id: "git", label: "Git", shortcut: "3" },
    { id: "sessions", label: "Sessions", shortcut: "4" },
    { id: "doctor", label: "Doctor", shortcut: "5" },
  ];

  const bar = new TabBarComponent(fakeTui, createPlainTheme(), {
    activeTab: "chat",
    tabs: customTabs,
  });

  // At width 40, full labels "[1:Chat]  [2:Tools]  ..." won't fit comfortably, so collapses to [1:C] [2:T] [3:G] [4:S] [5:D]
  const lines = bar.render(40);
  assert.ok(lines.length >= 2);
  const text = lines[0]!;

  assert.ok(text.includes("[1:C]"));
  assert.ok(text.includes("[2:T]"));
  assert.ok(text.includes("[3:G]"));
  assert.ok(text.includes("[4:S]"));
  assert.ok(text.includes("[5:D]"));
});

test("TabBarComponent factory createTabBarComponent and bounds safety across 120, 80, 40, 20 cols", () => {
  const themes = [createMockTheme(), createPlainTheme()];
  const widths = [120, 80, 40, 20];

  for (const theme of themes) {
    for (const width of widths) {
      const comp = createTabBarComponent(
        { requestRender: () => {} } as any,
        theme,
        { activeTab: "git" },
      );

      const lines = comp.render(width);
      assert.ok(Array.isArray(lines));
      assert.ok(lines.length >= 2);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const len = visibleWidth(line);
        assert.ok(
          len <= width,
          `Line ${i} visibleWidth (${len}) exceeded target width (${width}) at width ${width}: "${line}"`,
        );
      }
    }
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  NotificationStore,
  formatNotificationBanner,
  createNotificationCenterComponent,
  NotificationCenterComponent,
  NOTIFICATION_LEVEL_MAP,
} from "../extensions/omt/features/smart-notifications/index.ts";
import type { SmartNotification } from "../extensions/omt/features/smart-notifications/types.ts";

/**
 * ANSI theme fixture.
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
 * Plain theme fixture.
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

test("NotificationStore: push, markRead, markAllRead, getUnreadCount, clear, getById, remove", () => {
  const store = new NotificationStore(10);
  assert.equal(store.count, 0);
  assert.equal(store.getUnreadCount(), 0);

  // Push notifications
  const n1 = store.push("System startup complete", "info");
  assert.ok(n1.id.startsWith("notif-"));
  assert.equal(n1.message, "System startup complete");
  assert.equal(n1.level, "info");
  assert.equal(n1.read, false);
  assert.equal(n1.sticky, false);

  const n2 = store.push("High memory usage", "warning", 5000, true);
  assert.equal(n2.level, "warning");
  assert.equal(n2.sticky, true);
  assert.equal(n2.durationMs, 5000);

  const n3 = store.push("Tool execution failed", "error");
  const n4 = store.push("Build succeeded", "success");

  assert.equal(store.count, 4);
  assert.equal(store.getUnreadCount(), 4);

  // getAll returns newest first
  const all = store.getAll();
  assert.equal(all.length, 4);
  assert.equal(all[0]?.id, n4.id);
  assert.equal(all[3]?.id, n1.id);

  // getById
  const found = store.getById(n2.id);
  assert.ok(found);
  assert.equal(found?.id, n2.id);
  assert.equal(store.getById("non-existent"), undefined);

  // markRead
  assert.equal(store.markRead(n2.id), true);
  assert.equal(store.getById(n2.id)?.read, true);
  assert.equal(store.getUnreadCount(), 3);
  assert.equal(store.markRead("non-existent"), false);

  // markAllRead
  store.markAllRead();
  assert.equal(store.getUnreadCount(), 0);

  // remove
  assert.equal(store.remove(n3.id), true);
  assert.equal(store.count, 3);
  assert.equal(store.remove("non-existent"), false);

  // capacity constraint
  const smallStore = new NotificationStore(2);
  smallStore.push("First");
  smallStore.push("Second");
  smallStore.push("Third");
  assert.equal(smallStore.count, 2);
  assert.equal(smallStore.getAll()[0]?.message, "Third");

  // clear
  store.clear();
  assert.equal(store.count, 0);
  assert.equal(store.getAll().length, 0);
});

test("formatNotificationBanner: formats compact banner across levels and widths without overflowing", () => {
  const theme = createPlainTheme();
  const ansiTheme = createAnsiTheme();

  const notifs: SmartNotification[] = [
    { id: "1", message: "Task completed successfully", level: "success", timestamp: Date.now() },
    { id: "2", message: "High latency detected on network", level: "warning", timestamp: Date.now() },
    { id: "3", message: "Command failed with status code 1", level: "error", timestamp: Date.now() },
    { id: "4", message: "OMT extension loaded cleanly", level: "info", timestamp: Date.now() },
  ];

  const widths = [120, 80, 60, 45, 30, 20, 10];

  for (const notif of notifs) {
    for (const width of widths) {
      for (const th of [theme, ansiTheme]) {
        const banner = formatNotificationBanner(notif, th, width);
        assert.ok(banner.length > 0, "Banner should not be empty");
        const vWidth = visibleWidth(banner);
        assert.ok(
          vWidth <= width,
          `Banner width ${vWidth} exceeded target width ${width}: "${banner}"`,
        );

        // Icon check
        const info = NOTIFICATION_LEVEL_MAP[notif.level];
        if (width >= 20) {
          assert.ok(
            banner.includes(info.icon) || banner.includes(info.badge) || banner.includes(info.shortBadge),
            `Banner at width ${width} should contain icon or badge`,
          );
        }
      }
    }
  }
});

test("NotificationCenterComponent: renders across 120, 80, 40, 20 columns without horizontal overflow", () => {
  const dummyTui: any = { requestRender: () => {} };
  const done = () => {};
  const ctx: any = { mode: "tui" };

  const testNotifications: SmartNotification[] = [
    {
      id: "n-1",
      message: "Git repository dirty with uncommitted changes",
      level: "warning",
      timestamp: Date.now() - 60000,
      read: false,
    },
    {
      id: "n-2",
      message: "Build verification passed with 219 tests",
      level: "success",
      timestamp: Date.now() - 30000,
      read: true,
    },
    {
      id: "n-3",
      message: "Critical error connecting to upstream model API",
      level: "error",
      timestamp: Date.now(),
      read: false,
    },
  ];

  const themes = [createPlainTheme(), createAnsiTheme()];
  const widths = [120, 80, 40, 20];

  for (const theme of themes) {
    for (const width of widths) {
      const comp = createNotificationCenterComponent(
        dummyTui,
        theme,
        {} as any,
        done,
        ctx,
        { notifications: testNotifications },
      );

      const lines = comp.render(width);
      assert.ok(Array.isArray(lines));
      assert.ok(lines.length >= 5, `Expected multiple lines at width ${width}`);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const len = visibleWidth(line);
        assert.ok(
          len <= width,
          `Line ${i} visibleWidth (${len}) exceeded target width (${width}): "${line}"`,
        );
      }

      const joined = lines.join("\n");
      assert.ok(joined.includes("Notif") || joined.includes("[") || joined.includes("]"));
    }
  }
});

test("NotificationCenterComponent: renders empty state gracefully without overflow", () => {
  const dummyTui: any = { requestRender: () => {} };
  const done = () => {};
  const ctx: any = { mode: "tui" };

  for (const width of [120, 80, 40, 20]) {
    const comp = createNotificationCenterComponent(
      dummyTui,
      createPlainTheme(),
      {} as any,
      done,
      ctx,
      { notifications: [] },
    );

    const lines = comp.render(width);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const len = visibleWidth(line);
      assert.ok(
        len <= width,
        `Empty state line ${i} visibleWidth (${len}) exceeded ${width}`,
      );
    }
    const joined = lines.join("\n");
    assert.match(joined, /No notifications/);
  }
});

test("NotificationCenterComponent: keyboard navigation, marking read, clearing, and closing", () => {
  let renderCount = 0;
  const dummyTui: any = {
    requestRender: () => {
      renderCount++;
    },
  };

  let doneCalled = false;
  const done = () => {
    doneCalled = true;
  };

  let clearCalled = false;
  const onClear = () => {
    clearCalled = true;
  };

  const notifications: SmartNotification[] = [
    { id: "1", message: "Msg 1", level: "info", timestamp: 1000, read: false },
    { id: "2", message: "Msg 2", level: "warning", timestamp: 2000, read: false },
    { id: "3", message: "Msg 3", level: "error", timestamp: 3000, read: false },
  ];

  const comp = new NotificationCenterComponent(
    dummyTui,
    createPlainTheme(),
    {} as any,
    done,
    {} as any,
    { notifications, onClear },
  );

  assert.equal(comp.getSelectedIndex(), 0);
  assert.equal(comp.getSelectedNotification()?.id, "1");

  // Move Down ('j' or down arrow)
  comp.handleInput("\x1b[B");
  assert.equal(comp.getSelectedIndex(), 1);
  assert.equal(comp.getSelectedNotification()?.id, "2");

  // Move Down again
  comp.handleInput("j");
  assert.equal(comp.getSelectedIndex(), 2);
  assert.equal(comp.getSelectedNotification()?.id, "3");

  // Wrap around Down
  comp.handleInput("j");
  assert.equal(comp.getSelectedIndex(), 0);

  // Move Up ('k' or up arrow)
  comp.handleInput("k");
  assert.equal(comp.getSelectedIndex(), 2);

  comp.handleInput("\x1b[A");
  assert.equal(comp.getSelectedIndex(), 1);

  // Mark selected as read (Enter or 'r')
  assert.equal(comp.getSelectedNotification()?.read, false);
  comp.handleInput("r");
  assert.equal(comp.getSelectedNotification()?.read, true);

  // Clear ('c')
  comp.handleInput("c");
  assert.equal(comp.getNotifications().length, 0);
  assert.equal(clearCalled, true);

  // Close ('q' or Esc)
  assert.equal(doneCalled, false);
  comp.handleInput("q");
  assert.equal(doneCalled, true);
});

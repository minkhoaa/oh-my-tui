import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { configStore } from "../core/config.ts";

import { setActiveLayoutMode, toggleFocusMode } from "../features/adaptive-layout/index.ts";
import { accessibilityStore } from "../features/accessibility/model.ts";

import type { PaletteAction } from "../features/command-palette/types.ts";

import type { RuntimeServices } from "./contracts.ts";
import type { createDialogs } from "./dialogs.ts";
type DialogOpeners = Omit<ReturnType<typeof createDialogs>, "reset">;

export function buildPaletteActions(services: RuntimeServices & DialogOpeners, ctx: ExtensionContext): PaletteAction[] {
  const { editor, messages, tools, footer, thinking, background, sidebar, composerStash, promptQueueStore, applyTheme, activateComponents, openToolInspector, openGitExplorer, openConversationNavigator, openSessionManager, openSessionTree, openCommandPalette, openSettings, openWallpaperViewer, openPromptQueue, openStashPicker, openNotificationCenter, openDoctor, openShortcutHelp, openScrollback, openPermissionReview, openTabBar, openSidebar } = services;
    return [
      // Presets
      {
        id: "preset:omt-clean",
        title: "Switch to OMT Clean",
        description: "Activate OMT Clean aesthetic preset",
        category: "preset",
        run: (c) => { applyTheme("omt-clean", c); },
      },
      {
        id: "preset:omt-ember",
        title: "Switch to OMT Ember",
        description: "Activate OMT Ember presentation preset",
        category: "preset",
        run: (c) => { applyTheme("omt-ember", c); },
      },
      {
        id: "preset:omt-rail",
        title: "Switch to OMT Rail",
        description: "Activate OMT Rail presentation preset",
        category: "preset",
        run: (c) => { applyTheme("omt-rail", c); },
      },
      {
        id: "preset:minimal",
        title: "Switch to Minimal",
        description: "Activate distraction-free compact minimal preset",
        category: "preset",
        run: (c) => { applyTheme("minimal", c); },
      },
      {
        id: "preset:native",
        title: "Switch to Native",
        description: "Restore default native Pi presentation",
        category: "preset",
        run: (c) => { applyTheme("native", c); },
      },

      // Components
      {
        id: "component:toggle-editor",
        title: "Toggle Editor",
        description: "Toggle enhanced input composer",
        category: "component",
        run: (c) => {
          const next = !configStore.isComponentEnabled("editor");
          configStore.setComponentOverride("editor", next);
          if (next) editor.on(c); else editor.off(c);
          c.ui?.notify?.(`Editor ${next ? "enabled" : "disabled"}.`, "info");
        },
      },
      {
        id: "component:toggle-messages",
        title: "Toggle Messages",
        description: "Toggle enhanced user messages",
        category: "component",
        run: (c) => {
          const next = !configStore.isComponentEnabled("messages");
          configStore.setComponentOverride("messages", next);
          if (next) messages.on(); else messages.off();
          c.ui?.notify?.(`Messages ${next ? "enabled" : "disabled"}.`, "info");
        },
      },
      {
        id: "component:toggle-tools",
        title: "Toggle Tools",
        description: "Toggle enhanced tool call display",
        category: "component",
        run: (c) => {
          const next = !configStore.isComponentEnabled("tools");
          configStore.setComponentOverride("tools", next);
          if (next) tools.on(); else tools.off();
          c.ui?.notify?.(`Tools ${next ? "enabled" : "disabled"}.`, "info");
        },
      },
      {
        id: "component:toggle-footer",
        title: "Toggle Footer",
        description: "Toggle responsive statusline footer",
        category: "component",
        run: (c) => {
          const next = !configStore.isComponentEnabled("footer");
          configStore.setComponentOverride("footer", next);
          if (next) footer.on(c); else footer.off(c);
          c.ui?.notify?.(`Footer ${next ? "enabled" : "disabled"}.`, "info");
        },
      },
      {
        id: "component:toggle-thinking",
        title: "Toggle Thinking",
        description: "Toggle clean thinking progress indicator",
        category: "component",
        run: (c) => {
          const next = !configStore.isComponentEnabled("thinking");
          configStore.setComponentOverride("thinking", next);
          if (next) thinking.on(c); else thinking.off(c);
          c.ui?.notify?.(`Thinking ${next ? "enabled" : "disabled"}.`, "info");
        },
      },
      {
        id: "component:enable-all",
        title: "Enable All Components",
        description: "Enable all OMT presentation components",
        category: "component",
        run: (c) => {
          configStore.setComponentOverride("editor", true);
          configStore.setComponentOverride("messages", true);
          configStore.setComponentOverride("tools", true);
          configStore.setComponentOverride("footer", true);
          configStore.setComponentOverride("thinking", true);
          editor.on(c); messages.on(); tools.on(); footer.on(c); thinking.on(c);
          c.ui?.notify?.("All OMT components enabled.", "info");
        },
      },
      {
        id: "component:disable-all",
        title: "Disable All Components",
        description: "Disable all OMT presentation components",
        category: "component",
        run: (c) => {
          configStore.setComponentOverride("editor", false);
          configStore.setComponentOverride("messages", false);
          configStore.setComponentOverride("tools", false);
          configStore.setComponentOverride("footer", false);
          configStore.setComponentOverride("thinking", false);
          editor.off(c); messages.off(); tools.off(); footer.off(c); thinking.off(c);
          c.ui?.notify?.("All OMT components disabled.", "info");
        },
      },

      // Tools
      {
        id: "tool:inspector",
        title: "Open Tool Inspector",
        description: "Inspect tool executions, arguments, diffs, and results",
        category: "tool",
        shortcut: "alt+i",
        run: (c) => {
          queueMicrotask(() => { void openToolInspector(c); });
        },
      },
      {
        id: "tool:git-explorer",
        title: "Open Git Changes Explorer",
        description: "Inspect changed files, staged/unstaged diffs, and branch stats",
        category: "tool",
        shortcut: "alt+g",
        run: (c) => {
          queueMicrotask(() => { void openGitExplorer(c); });
        },
      },

      // Navigation & Sessions
      {
        id: "nav:conversation-navigator",
        title: "Open Conversation Navigator",
        description: "Search and navigate messages, tools, errors, and bookmarks",
        category: "navigation",
        shortcut: "alt+n",
        run: (c) => {
          queueMicrotask(() => { void openConversationNavigator(c); });
        },
      },
      {
        id: "nav:session-manager",
        title: "Open Session Manager",
        description: "List, resume, manage, and export conversation sessions",
        category: "navigation",
        run: (c) => {
          queueMicrotask(() => { void openSessionManager(c); });
        },
      },
      {
        id: "nav:session-tree",
        title: "Open Session Tree & Branch Explorer",
        description: "Explore session tree hierarchy, branch points, and forks",
        category: "navigation",
        run: (c) => {
          queueMicrotask(() => { void openSessionTree(c); });
        },
      },
      {
        id: "nav:export-conversation",
        title: "Export Conversation",
        description: "Export current conversation to Markdown, JSON, HTML, or Text",
        category: "navigation",
        run: async (c) => {
          const { exportConversation } = await import("../features/session-manager-ui/index.ts");
          const entries = c.sessionManager?.getEntries?.() ?? [];
          const output = exportConversation(entries as any, { format: "markdown", includeTools: true });
          c.ui?.notify?.(`Exported ${entries.length} entries to Markdown (${output.length} bytes).`, "info");
        },
      },
      {
        id: "nav:scrollback",
        title: "Open Transcript Scrollback & Selection",
        description: "Navigate transcript history, search terms, and copy text",
        category: "navigation",
        shortcut: "alt+s",
        run: (c) => {
          queueMicrotask(() => { void openScrollback(c); });
        },
      },
      {
        id: "nav:sidebar",
        title: "Open OMT Sidebar Companion",
        description: "Inspect live session, ASCII pet, tokens, and workspace git status",
        category: "navigation",
        run: (c) => {
          queueMicrotask(() => { void openSidebar(c); });
        },
      },

      // Composer & Queue
      {
        id: "composer:stash",
        title: "Stash Current Composer Draft",
        description: "Save current input buffer to scratchpad stash",
        category: "component",
        run: (c) => {
          const text = c.ui?.getEditorText?.() ?? "";
          if (text.trim()) {
            composerStash.stash(text);
            c.ui?.setEditorText?.("");
            c.ui?.notify?.("Draft stashed to scratchpad.", "info");
          } else {
            c.ui?.notify?.("Composer is empty; nothing to stash.", "warning");
          }
        },
      },
      {
        id: "composer:unstash",
        title: "Restore Stashed Draft",
        description: "Pop the most recent draft from scratchpad stash into composer",
        category: "component",
        run: (c) => {
          const draft = composerStash.pop();
          if (draft) {
            c.ui?.setEditorText?.(draft.text);
            c.ui?.notify?.("Draft restored to editor.", "info");
          } else {
            c.ui?.notify?.("No drafts in stash.", "warning");
          }
        },
      },
      {
        id: "composer:stash-picker",
        title: "Open Draft Scratchpad Picker",
        description: "Inspect, restore, or manage stashed composer drafts",
        category: "component",
        run: (c) => {
          queueMicrotask(() => { void openStashPicker(c); });
        },
      },
      {
        id: "queue:manage",
        title: "Open Prompt Queue & Steering UI",
        description: "Manage queued and steering prompt items",
        category: "component",
        run: (c) => {
          queueMicrotask(() => { void openPromptQueue(c); });
        },
      },

      // System Interaction
      {
        id: "general:notifications",
        title: "Open Notification Center",
        description: "Review recent toast notifications, warnings, and alerts",
        category: "general",
        run: (c) => {
          queueMicrotask(() => { void openNotificationCenter(c); });
        },
      },
      {
        id: "general:doctor",
        title: "Run TUI Diagnostics Doctor",
        description: "Audit terminal capabilities, Unicode, color, and performance",
        category: "general",
        run: (c) => {
          queueMicrotask(() => { void openDoctor(c); });
        },
      },
      {
        id: "general:permissions",
        title: "Review Permissions & Safety",
        description: "Inspect permission requests and security heuristics",
        category: "general",
        run: (c) => {
          queueMicrotask(() => { void openPermissionReview(c); });
        },
      },

      // Layout & Accessibility
      {
        id: "layout:tabs",
        title: "Open Multi-View Tabs Bar",
        description: "Switch between Chat, Inspector, Git, Sessions, and Doctor",
        category: "layout",
        shortcut: "alt+t",
        run: (c) => {
          queueMicrotask(() => { void openTabBar(c); });
        },
      },
      {
        id: "layout:toggle-focus",
        title: "Toggle Focus Mode",
        description: "Toggle distraction-free focus mode",
        category: "layout",
        shortcut: "alt+f",
        run: (c) => {
          const next = toggleFocusMode();
          c.ui?.notify?.(`Focus mode ${next ? "enabled" : "disabled"}.`, "info");
        },
      },
      {
        id: "layout:set-standard",
        title: "Set Layout: Standard",
        description: "Apply standard layout with normal spacing and gutters",
        category: "layout",
        run: (c) => {
          setActiveLayoutMode("standard");
          c.ui?.notify?.("Layout set to Standard.", "info");
        },
      },
      {
        id: "layout:set-compact",
        title: "Set Layout: Compact",
        description: "Apply compact layout optimized for density",
        category: "layout",
        run: (c) => {
          setActiveLayoutMode("compact");
          c.ui?.notify?.("Layout set to Compact.", "info");
        },
      },
      {
        id: "layout:set-focus",
        title: "Set Layout: Focus",
        description: "Apply focus layout maximizing conversation space",
        category: "layout",
        run: (c) => {
          setActiveLayoutMode("focus");
          c.ui?.notify?.("Layout set to Focus.", "info");
        },
      },
      {
        id: "accessibility:high-contrast",
        title: "Toggle High Contrast Mode",
        description: "Toggle high-contrast color scheme for enhanced visibility",
        category: "layout",
        run: (c) => {
          const next = !accessibilityStore.isHighContrast();
          accessibilityStore.setHighContrast(next);
          c.ui?.notify?.(`High contrast mode ${next ? "enabled" : "disabled"}.`, "info");
        },
      },
      {
        id: "accessibility:ascii-borders",
        title: "Toggle Plain ASCII Borders",
        description: "Toggle plain-text ASCII borders for compatibility",
        category: "layout",
        run: (c) => {
          const next = !accessibilityStore.isPlainTextAsciiBorders();
          accessibilityStore.setPlainTextAsciiBorders(next);
          c.ui?.notify?.(`Plain ASCII borders ${next ? "enabled" : "disabled"}.`, "info");
        },
      },
      {
        id: "accessibility:shortcuts",
        title: "Open Keyboard Shortcuts Reference",
        description: "View comprehensive keyboard navigation and shortcut reference",
        category: "general",
        shortcut: "alt+?",
        run: (c) => {
          queueMicrotask(() => { void openShortcutHelp(c); });
        },
      },

      // Dynamic Backgrounds & Live Wallpapers
      {
        id: "background:wallpaper",
        title: "Open Live Wallpaper & Backdrop Viewer",
        description: "Interactive preview of animated procedural wallpapers and backdrops",
        category: "general",
        shortcut: "alt+w",
        run: (c) => {
          queueMicrotask(() => { void openWallpaperViewer(c); });
        },
      },
      {
        id: "background:toggle",
        title: "Toggle Dynamic Background",
        description: "Toggle animated background backdrops on or off",
        category: "component",
        run: (c) => {
          const next = !background.isEnabled();
          if (next) background.on(c);
          else background.off(c);
          c.ui?.notify?.(`Dynamic background ${next ? "enabled" : "disabled"}.`, "info");
        },
      },
      {
        id: "background:scene-aurora",
        title: "Background Scene: Aurora Borealis",
        description: "Switch dynamic background to undulating celestial aurora ribbons",
        category: "component",
        run: (c) => {
          background.setScene("aurora", c);
          c.ui?.notify?.("Background scene set to Aurora Borealis.", "info");
        },
      },
      {
        id: "background:scene-starfield",
        title: "Background Scene: Deep Starfield",
        description: "Switch dynamic background to drifting parallax celestial cosmos",
        category: "component",
        run: (c) => {
          background.setScene("starfield", c);
          c.ui?.notify?.("Background scene set to Deep Starfield.", "info");
        },
      },
      {
        id: "background:scene-rain",
        title: "Background Scene: Ambient Rain",
        description: "Switch dynamic background to atmospheric rainfall with splash ripples",
        category: "component",
        run: (c) => {
          background.setScene("rain", c);
          c.ui?.notify?.("Background scene set to Ambient Rain.", "info");
        },
      },
      {
        id: "background:scene-matrix",
        title: "Background Scene: Digital Matrix",
        description: "Switch dynamic background to phosphor cyber glyph streams",
        category: "component",
        run: (c) => {
          background.setScene("matrix", c);
          c.ui?.notify?.("Background scene set to Digital Matrix.", "info");
        },
      },
      {
        id: "background:scene-particles",
        title: "Background Scene: Floating Particles",
        description: "Switch dynamic background to harmonic brownian dust motes",
        category: "component",
        run: (c) => {
          background.setScene("particles", c);
          c.ui?.notify?.("Background scene set to Floating Particles.", "info");
        },
      },
      {
        id: "background:cycle-mode",
        title: "Cycle Background Mode",
        description: "Cycle background rendering mode (off → ambient → scene → full)",
        category: "component",
        run: (c) => {
          const modes: ("off" | "ambient" | "scene" | "full")[] = ["off", "ambient", "scene", "full"];
          const curMode = configStore.getBackground().mode;
          const nextMode = modes[(modes.indexOf(curMode) + 1) % modes.length]!;
          const msg = background.setMode(nextMode, c);
          c.ui?.notify?.(msg, "info");
        },
      },

      // General Settings
      {
        id: "general:settings",
        title: "Open OMT Settings",
        description: "Configure presets, components, animations, and defaults",
        category: "general",
        run: (c) => {
          queueMicrotask(() => { void openSettings(c); });
        },
      },
    ];
  }


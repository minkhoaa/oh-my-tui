import { type Component, type TUI } from "@earendil-works/pi-tui";
import { type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import type { PaletteAction } from "./types.ts";
import { configStore, type OmtComponentsConfig } from "../../core/config.ts";


/**
 * Category badge configurations with styling hints.
 */
const CATEGORY_BADGES: Record<
  PaletteAction["category"],
  { full: string; short: string; color: ThemeColor }
> = {
  preset: { full: "[Preset]", short: "[Pre]", color: "accent" },
  component: { full: "[Component]", short: "[Comp]", color: "muted" },
  tool: { full: "[Tool]", short: "[Tool]", color: "warning" },
  navigation: { full: "[Navigation]", short: "[Nav]", color: "accent" },
  layout: { full: "[Layout]", short: "[Lay]", color: "muted" },
  general: { full: "[General]", short: "[Gen]", color: "dim" },
};

/**
 * Fallback badge for unexpected categories.
 */
function getCategoryBadge(category: string): { full: string; short: string; color: ThemeColor } {
  return (
    CATEGORY_BADGES[category as PaletteAction["category"]] ?? {
      full: `[${category}]`,
      short: `[${category.slice(0, 3)}]`,
      color: "dim",
    }
  );
}

/**
 * Format category badge string according to viewport width.
 */
function formatCategoryBadge(category: string, width: number, theme: Theme): string {
  const info = getCategoryBadge(category);
  const colorFn = (str: string) => (theme.fg ? theme.fg(info.color, str) : str);

  if (width >= 60) {
    return colorFn(info.full.padEnd(12));
  }
  if (width >= 35) {
    return colorFn(info.short.padEnd(7));
  }
  return "";
}

/**
 * Default OMT palette actions factory.
 */
export function createDefaultPaletteActions(
  ctx: ExtensionContext,
  extraActions?: PaletteAction[],
): PaletteAction[] {
  const defaults: PaletteAction[] = [
    // Presets
    {
      id: "preset:omt-clean",
      title: "Switch to OMT Clean",
      description: "Activate OMT Clean aesthetic preset",
      category: "preset",
      run: (runCtx) => {
        configStore.setPresetOverride("omt-clean");
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify("Switched to OMT Clean preset", "info");
        }
      },
    },
    {
      id: "preset:omt-ember",
      title: "Switch to OMT Ember",
      description: "Activate OMT Ember presentation preset",
      category: "preset",
      run: (runCtx) => {
        configStore.setPresetOverride("omt-ember");
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify("Switched to OMT Ember preset", "info");
        }
      },
    },
    {
      id: "preset:omt-rail",
      title: "Switch to OMT Rail",
      description: "Activate OMT Rail presentation preset",
      category: "preset",
      run: (runCtx) => {
        configStore.setPresetOverride("omt-rail");
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify("Switched to OMT Rail preset", "info");
        }
      },
    },
    {
      id: "preset:minimal",
      title: "Switch to Minimal",
      description: "Activate clean, unobtrusive Minimal preset",
      category: "preset",
      run: (runCtx) => {
        configStore.setPresetOverride("minimal");
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify("Switched to Minimal preset", "info");
        }
      },
    },
    {
      id: "preset:native",
      title: "Switch to Native",
      description: "Activate default Native Pi presentation preset",
      category: "preset",
      run: (runCtx) => {
        configStore.setPresetOverride("native");
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify("Switched to Native preset", "info");
        }
      },
    },

    // Components
    {
      id: "component:toggle-editor",
      title: "Toggle Editor",
      description: "Toggle enhanced composer input box styling",
      category: "component",
      run: (runCtx) => {
        const next = !configStore.isComponentEnabled("editor");
        configStore.setComponentOverride("editor", next);
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify(`Editor component ${next ? "enabled" : "disabled"}`, "info");
        }
      },
    },
    {
      id: "component:toggle-messages",
      title: "Toggle Messages",
      description: "Toggle styled user message surfaces and gutters",
      category: "component",
      run: (runCtx) => {
        const next = !configStore.isComponentEnabled("messages");
        configStore.setComponentOverride("messages", next);
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify(`Messages component ${next ? "enabled" : "disabled"}`, "info");
        }
      },
    },
    {
      id: "component:toggle-tools",
      title: "Toggle Tools",
      description: "Toggle enhanced tool call and diff presentation",
      category: "component",
      run: (runCtx) => {
        const next = !configStore.isComponentEnabled("tools");
        configStore.setComponentOverride("tools", next);
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify(`Tools component ${next ? "enabled" : "disabled"}`, "info");
        }
      },
    },
    {
      id: "component:toggle-footer",
      title: "Toggle Footer",
      description: "Toggle responsive statusline footer",
      category: "component",
      run: (runCtx) => {
        const next = !configStore.isComponentEnabled("footer");
        configStore.setComponentOverride("footer", next);
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify(`Footer component ${next ? "enabled" : "disabled"}`, "info");
        }
      },
    },
    {
      id: "component:toggle-thinking",
      title: "Toggle Thinking",
      description: "Toggle clean thinking and progress animation",
      category: "component",
      run: (runCtx) => {
        const next = !configStore.isComponentEnabled("thinking");
        configStore.setComponentOverride("thinking", next);
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify(`Thinking component ${next ? "enabled" : "disabled"}`, "info");
        }
      },
    },
    {
      id: "component:enable-all",
      title: "Enable All Components",
      description: "Turn on all OMT presentation components",
      category: "component",
      run: (runCtx) => {
        const components: Array<keyof OmtComponentsConfig> = [
          "editor",
          "messages",
          "tools",
          "footer",
          "thinking",
        ];
        for (const name of components) {
          configStore.setComponentOverride(name, true);
        }
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify("All OMT components enabled", "info");
        }
      },
    },
    {
      id: "component:disable-all",
      title: "Disable All Components",
      description: "Turn off all OMT presentation components",
      category: "component",
      run: (runCtx) => {
        const components: Array<keyof OmtComponentsConfig> = [
          "editor",
          "messages",
          "tools",
          "footer",
          "thinking",
        ];
        for (const name of components) {
          configStore.setComponentOverride(name, false);
        }
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify("All OMT components disabled", "info");
        }
      },
    },

    // Navigation / Tools
    {
      id: "tool:inspector",
      title: "Open Tool Inspector",
      description: "Inspect interactive tool executions, arguments, and results",
      category: "tool",
      run: (runCtx) => {
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify("Opening Tool Inspector...", "info");
        }
      },
    },
    {
      id: "nav:conversation-navigator",
      title: "Open Conversation Navigator",
      description: "Search and jump between conversation messages and checkpoints",
      category: "navigation",
      run: (runCtx) => {
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify("Opening Conversation Navigator...", "info");
        }
      },
    },

    // Layout
    {
      id: "layout:toggle-focus",
      title: "Toggle Focus Mode",
      description: "Toggle distraction-free focus mode layout",
      category: "layout",
      run: (runCtx) => {
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify("Toggled Focus Mode", "info");
        }
      },
    },
    {
      id: "layout:set-standard",
      title: "Set Layout: Standard",
      description: "Apply standard layout with normal borders and spacing",
      category: "layout",
      run: (runCtx) => {
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify("Layout set to Standard", "info");
        }
      },
    },
    {
      id: "layout:set-compact",
      title: "Set Layout: Compact",
      description: "Apply compact layout optimized for smaller viewports",
      category: "layout",
      run: (runCtx) => {
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify("Layout set to Compact", "info");
        }
      },
    },
    {
      id: "layout:set-focus",
      title: "Set Layout: Focus",
      description: "Apply minimal focus layout with maximum transcript room",
      category: "layout",
      run: (runCtx) => {
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify("Layout set to Focus", "info");
        }
      },
    },

    // General
    {
      id: "general:settings",
      title: "Open OMT Settings",
      description: "Open interactive Oh My TUI settings configuration",
      category: "general",
      shortcut: "/omt settings",
      run: (runCtx) => {
        const c = runCtx ?? ctx;
        if (c?.hasUI && c.ui?.notify) {
          c.ui.notify("Opening OMT Settings...", "info");
        }
      },
    },
  ];

  if (extraActions && extraActions.length > 0) {
    return [...defaults, ...extraActions];
  }
  return defaults;
}

/**
 * Filter palette actions using exact substring matching and fuzzy matching across
 * title, category, and description fields.
 */
export function filterPaletteActions(actions: PaletteAction[], query: string): PaletteAction[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return actions.slice();
  }

  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  const qLower = trimmed.toLowerCase();
  const scored: Array<{ action: PaletteAction; score: number }> = [];

  for (const action of actions) {
    const title = action.title.toLowerCase();
    const desc = (action.description ?? "").toLowerCase();
    const cat = action.category.toLowerCase();
    const full = `${title} ${desc} ${cat}`;

    // Exact title match
    if (title === qLower) {
      scored.push({ action, score: -1000 });
      continue;
    }

    // Substring match on title
    if (title.includes(qLower)) {
      scored.push({ action, score: -500 + title.indexOf(qLower) });
      continue;
    }

    // Category exact match
    if (cat === qLower) {
      scored.push({ action, score: -350 });
      continue;
    }

    // Category starts with query
    if (cat.startsWith(qLower)) {
      scored.push({ action, score: -300 });
      continue;
    }

    // All tokens present in title
    if (tokens.every((t) => title.includes(t))) {
      scored.push({ action, score: -250 });
      continue;
    }

    // Substring match on description
    if (desc.includes(qLower)) {
      scored.push({ action, score: -150 });
      continue;
    }

    // All tokens present in combined text
    if (tokens.every((t) => full.includes(t))) {
      scored.push({ action, score: -100 });
      continue;
    }

    // Fuzzy matching against title
    const titleFuzzy = checkFuzzy(trimmed, title);
    if (titleFuzzy.matches) {
      scored.push({ action, score: titleFuzzy.score - 40 });
      continue;
    }

    // Fuzzy matching against category
    const catFuzzy = checkFuzzy(trimmed, cat);
    if (catFuzzy.matches) {
      scored.push({ action, score: catFuzzy.score - 20 });
      continue;
    }
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.action);
}

/**
 * Basic fuzzy matching helper: checks if all query characters appear sequentially.
 */
function checkFuzzy(query: string, text: string): { matches: boolean; score: number } {
  let queryIdx = 0;
  let textIdx = 0;
  let score = 0;
  let lastMatch = -1;

  while (queryIdx < query.length && textIdx < text.length) {
    if (query[queryIdx]?.toLowerCase() === text[textIdx]?.toLowerCase()) {
      if (lastMatch === textIdx - 1) {
        score -= 5; // Consecutive match bonus
      } else if (lastMatch >= 0) {
        score += (textIdx - lastMatch - 1) * 2; // Gap penalty
      }
      lastMatch = textIdx;
      queryIdx++;
    }
    textIdx++;
  }

  if (queryIdx === query.length) {
    return { matches: true, score };
  }
  return { matches: false, score: Infinity };
}

/**
 * Unified Command Palette Component for Oh My TUI.
 */

export { formatCategoryBadge };

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { backgroundError } from "../features/backgrounds/assets/index.ts";

import { THEME_NAMES, resolveThemeName } from "../presets/index.ts";
import { getActiveTheme } from "../core/theme.ts";
import { configStore, VALID_BACKGROUND_MODES, VALID_BACKGROUND_SCENES, VALID_BACKGROUND_INTENSITIES, VALID_BACKGROUND_DIMMINGS } from "../core/config.ts";

import type { ExportFormat } from "../features/session-manager-ui/index.ts";

import { getActiveLayoutMode, setActiveLayoutMode, setFocusMode, toggleFocusMode } from "../features/adaptive-layout/index.ts";
import { accessibilityStore } from "../features/accessibility/model.ts";
import type { TabId } from "../features/multi-view-tabs/index.ts";

import type { RuntimeServices } from "./contracts.ts";
import type { createDialogs } from "./dialogs.ts";
import { withFallback } from "./status.ts";
import { isValidPaletteName, getPaletteNames } from "../presets/omt-signature/palette.ts";

export function registerCommands(pi: ExtensionAPI, services: RuntimeServices, dialogs: ReturnType<typeof createDialogs>) {
  const { editor, messages, tools, footer, thinking, background, sidebar, composerStash, promptQueueStore, applyTheme, activateComponents } = services;
  const {
    openToolInspector,
    openGitExplorer,
    openConversationNavigator,
    openSessionManager,
    openSessionTree,
    openCommandPalette,
    openSettings,
    openWallpaperViewer,
    openPromptQueue,
    openStashPicker,
    openNotificationCenter,
    openDoctor,
    openShortcutHelp,
    openScrollback,
    openPermissionReview,
    openTabBar,
    openSidebar,
    openModelPicker,
    openThemePicker,
    openPetPicker,
    openBlockActions,
  } = dialogs;
  pi.registerCommand("omt", {
    description: "Oh My TUI controls: settings, palette, inspect, git, navigate, session, tree, queue, doctor, tabs",
    getArgumentCompletions: (prefix) => {
      const items = [
        "settings",
        "save",
        "palette",
        "inspect",
        "trace",
        "trajectory",
        "git",
        "navigate",
        "session",
        "sessions",
        "resume",
        "tree",
        "model",
        "models",
        "pet",
        "pets",
        "actions",
        "export",
        "export markdown",
        "export json",
        "export html",
        "export text",
        "stash",
        "unstash",
        "drafts",
        "queue",
        "notifications",
        "doctor",
        "permissions",
        "sidebar",
        "sidebar on",
        "sidebar off",
        "sidebar toggle",
        "sidebar show",
        "sidebar inspect",
        "sidebar modal",
        "tabs",
        "tabs chat",
        "tabs inspector",
        "tabs git",
        "tabs sessions",
        "tabs doctor",
        "scroll",
        "shortcuts",
        "high-contrast on",
        "high-contrast off",
        "ascii on",
        "ascii off",
        "layout standard",
        "layout compact",
        "layout focus",
        "all on",
        "all off",
        "on",
        "off",
        "editor on",
        "editor off",
        "messages on",
        "messages off",
        "tools on",
        "tools off",
        "footer on",
        "footer off",
        "thinking on",
        "thinking off",
        "theme omt-signature",
        "theme omt-obsidian",
        "theme omt-clean",
        "theme omt-ember",
        "theme omt-rail",
        "theme minimal",
        "theme native",
        "preset omt-signature",
        "preset omt-obsidian",
        "preset omt-clean",
        "preset omt-ember",
        "preset omt-rail",
        "preset minimal",
        "preset native",
        "omt",
        "signature",
        "obsidian",
        "clean",
        "ember",
        "rail",
        "minimal",
        "native",
        "wallpaper",
        "bg",
        "background upload ",
        "background import ",
        "background list",
        "background select ",
        "background remove ",
        "background reset",
        "background pause",
        "background resume",
        ...[5, 10, 15, 20, 30].map(n => `background fps ${n}`),
        ...[0.25, 0.5, 0.75, 1, 1.5, 2].map(n => `background scale ${n}x`),
        ...["cover", "contain", "center", "tile"].map(fit => `background fit ${fit}`),
        ...configStore.assets.listLibrary().map(a => `background select ${a.alias ?? a.id}`),
        ...configStore.assets.list().map(a => `background select ${a.id}`),
        "background on",
        "background off",
        "background mode off",
        "background mode ambient",
        "background mode scene",
        "background mode full",
        "background scene aurora",
        "background scene starfield",
        "background scene rain",
        "background scene matrix",
        "background scene particles",
        "background speed 0.5x",
        "background speed 1x",
        "background speed 1.5x",
        "background speed 2x",
        "background intensity low",
        "background intensity medium",
        "background intensity high",
        "background dimming dim",
        "background dimming subtle",
        "background dimming vibrant",
        "background pause on",
        "background pause off",
      ];
      if (prefix.startsWith("focus")) {
        items.push("focus on", "focus off", "focus toggle");
      }
      const matched = items.filter((value) => value.startsWith(prefix));
      return matched.length ? matched.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const assetCommand = /^(?:background|bg)\s+(upload|import|list|select|remove|reset)(?:\s+([\s\S]*))?$/.exec(args.trim());
      if (assetCommand) {
        try {
          const [, action, raw = ""] = assetCommand;
          const value = raw.replace(/^(["'])([\s\S]*)\1$/, "$2");
          let result = "";
          if (action === "upload" || action === "import") {
            const { resolve } = await import("node:path");
            const asset = await configStore.assets.importFile(resolve(ctx.cwd, value));
            if (action === "import") {
              configStore.selectBackgroundAsset(asset.id);
              background.applyTheme(ctx);
              result = `Imported & selected ${asset.name}: ${asset.id} (${asset.width}×${asset.height}).`;
            } else {
              result = `Imported ${asset.name}: ${asset.id} (${asset.width}×${asset.height}). Use /omt background select ${asset.id}`;
            }
          } else if (action === "list") {
            const userAssets = configStore.assets.list();
            const library = configStore.assets.listLibrary();
            const lines: string[] = [];
            if (userAssets.length) {
              lines.push("Imported backgrounds:");
              for (const a of userAssets) lines.push(`  ${a.id}  ${a.kind}  ${a.name}`);
            }
            if (library.length) {
              if (lines.length) lines.push("");
              lines.push("Built-in library:");
              for (const a of library) lines.push(`  ${(a.alias ?? "").padEnd(14)} ${a.id.slice(0, 16)}…  ${a.name}`);
            }
            result = lines.join("\n") || "No backgrounds available. Use /omt background upload <path>.";
          } else if (action === "select") {
            const resolved = configStore.assets.resolveId(value);
            if (!resolved) throw new Error(`Unknown background "${value}". Use /omt background list.`);
            configStore.selectBackgroundAsset(resolved);
            result = background.setMode("full", ctx);
          } else if (action === "remove") {
            const resolved = configStore.assets.resolveId(value);
            if (!resolved) throw new Error(`Invalid background ID: ${value}`);
            configStore.removeBackgroundAsset(resolved);
            background.applyTheme(ctx);
            result = "Background removed; matching saved and session assignments cleared.";
          } else {
            configStore.selectBackgroundAsset(null);
            background.applyTheme(ctx);
            result = "Built-in background restored (session only).";
          }
          ctx.ui?.notify?.(result, "info");
        } catch (error) { ctx.ui?.notify?.(`Background: ${backgroundError(error)}`, "error"); }
        return;
      }
      const command = args.trim().replace(/\s+/g, " ");
      let message: string;

      if (command === "") {
        message = "Oh My TUI is active.";
      } else if (command === "settings") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT settings requires interactive TUI mode.";
        } else {
          await openSettings(ctx);
          return;
        }
      } else if (command === "inspect" || command === "inspector" || command === "trace" || command === "trajectory") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT tool inspector requires interactive TUI mode.";
        } else {
          await openToolInspector(ctx);
          return;
        }
      } else if (command === "git") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT Git explorer requires interactive TUI mode.";
        } else {
          await openGitExplorer(ctx);
          return;
        }
      } else if (command === "navigate" || command === "nav") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT conversation navigator requires interactive TUI mode.";
        } else {
          await openConversationNavigator(ctx);
          return;
        }
      } else if (command === "session" || command === "sessions" || command === "resume") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT session manager requires interactive TUI mode.";
        } else {
          await openSessionManager(ctx);
          return;
        }
      } else if (command === "tree") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT session tree requires interactive TUI mode.";
        } else {
          await openSessionTree(ctx);
          return;
        }
      } else if (command === "model" || command === "models") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT model picker requires interactive TUI mode.";
        } else {
          await openModelPicker(ctx);
          return;
        }
      } else if (command === "pet" || command === "pets") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT pet picker requires interactive TUI mode.";
        } else {
          await openPetPicker(ctx);
          return;
        }
      } else if (command === "actions" || command === "action" || command.startsWith("actions ")) {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT block actions requires interactive TUI mode.";
        } else {
          const content = command.startsWith("actions ") ? command.slice(8).trim() : undefined;
          await openBlockActions(ctx, content);
          return;
        }
      } else if (command.startsWith("export")) {
        const { exportConversation } = await import("../features/session-manager-ui/index.ts");
        const parts = command.split(" ");
        const fmt = (parts[1] ?? "markdown").toLowerCase() as ExportFormat;
        const validFormats: ExportFormat[] = ["markdown", "json", "html", "text"];
        const targetFmt = validFormats.includes(fmt) ? fmt : "markdown";
        const entries = ctx.sessionManager?.getEntries?.() ?? [];
        const result = exportConversation(entries as any, { format: targetFmt, includeTools: true });
        message = `Exported session (${entries.length} entries) in ${targetFmt.toUpperCase()} format (${result.length} characters).`;
      } else if (command === "palette") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT command palette requires interactive TUI mode.";
        } else {
          await openCommandPalette(ctx);
          return;
        }
      } else if (command === "stash") {
        const text = ctx.ui?.getEditorText?.() ?? "";
        if (text.trim()) {
          composerStash.stash(text);
          ctx.ui?.setEditorText?.("");
          message = "Draft stashed to scratchpad.";
        } else {
          message = "Composer is empty; nothing to stash.";
        }
      } else if (command === "unstash") {
        const draft = composerStash.pop();
        if (draft) {
          ctx.ui?.setEditorText?.(draft.text);
          message = "Draft restored to composer.";
        } else {
          message = "No drafts in scratchpad stash.";
        }
      } else if (command === "drafts") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT draft picker requires interactive TUI mode.";
        } else {
          await openStashPicker(ctx);
          return;
        }
      } else if (command === "queue") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT prompt queue requires interactive TUI mode.";
        } else {
          await openPromptQueue(ctx);
          return;
        }
      } else if (command === "notifications" || command === "notify") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT notification center requires interactive TUI mode.";
        } else {
          await openNotificationCenter(ctx);
          return;
        }
      } else if (command === "doctor") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT compatibility doctor requires interactive TUI mode.";
        } else {
          await openDoctor(ctx);
          return;
        }
      } else if (["sidebar", "sidebar show", "sidebar inspect", "sidebar modal"].includes(command)) {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT sidebar requires interactive TUI mode.";
        } else {
          await openSidebar(ctx);
          return;
        }
      } else if (command === "sidebar toggle") {
        message = sidebar.toggle(ctx);
      } else if (command === "sidebar on") {
        message = sidebar.on(ctx);
      } else if (command === "sidebar off") {
        message = sidebar.off(ctx);
      } else if (command === "permissions") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT permission review requires interactive TUI mode.";
        } else {
          await openPermissionReview(ctx);
          return;
        }
      } else if (command.startsWith("tabs")) {
        const parts = command.split(" ");
        const targetTab = parts[1] as TabId | undefined;
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT tab navigation requires interactive TUI mode.";
        } else if (targetTab === "inspector") {
          await openToolInspector(ctx);
          return;
        } else if (targetTab === "git") {
          await openGitExplorer(ctx);
          return;
        } else if (targetTab === "sessions") {
          await openSessionManager(ctx);
          return;
        } else if (targetTab === "doctor") {
          await openDoctor(ctx);
          return;
        } else {
          await openTabBar(ctx, "chat");
          return;
        }
      } else if (command === "scroll" || command === "scrollback") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT transcript scrollback requires interactive TUI mode.";
        } else {
          await openScrollback(ctx);
          return;
        }
      } else if (command === "shortcuts" || command === "keys" || command === "?") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT keyboard shortcuts requires interactive TUI mode.";
        } else {
          await openShortcutHelp(ctx);
          return;
        }
      } else if (command === "high-contrast on") {
        accessibilityStore.setHighContrast(true);
        message = "High contrast mode enabled.";
      } else if (command === "high-contrast off") {
        accessibilityStore.setHighContrast(false);
        message = "High contrast mode disabled.";
      } else if (command === "high-contrast") {
        const next = !accessibilityStore.isHighContrast();
        accessibilityStore.setHighContrast(next);
        message = `High contrast mode ${next ? "enabled." : "disabled."}`;
      } else if (command === "ascii on") {
        accessibilityStore.setPlainTextAsciiBorders(true);
        message = "Plain ASCII borders enabled.";
      } else if (command === "ascii off") {
        accessibilityStore.setPlainTextAsciiBorders(false);
        message = "Plain ASCII borders disabled.";
      } else if (command === "ascii") {
        const next = !accessibilityStore.isPlainTextAsciiBorders();
        accessibilityStore.setPlainTextAsciiBorders(next);
        message = `Plain ASCII borders ${next ? "enabled." : "disabled."}`;
      } else if (command === "focus on") {
        setFocusMode(true);
        message = "OMT focus mode on.";
      } else if (command === "focus off") {
        setFocusMode(false);
        message = "OMT focus mode off.";
      } else if (command === "focus" || command === "focus toggle") {
        const next = toggleFocusMode();
        message = `OMT focus mode ${next ? "on." : "off."}`;
      } else if (command === "layout standard") {
        setActiveLayoutMode("standard");
        message = "OMT layout set to standard.";
      } else if (command === "layout compact") {
        setActiveLayoutMode("compact");
        message = "OMT layout set to compact.";
      } else if (command === "layout focus") {
        setActiveLayoutMode("focus");
        message = "OMT layout set to focus.";
      } else if (command === "layout") {
        message = `OMT active layout mode: ${getActiveLayoutMode()}.`;
      } else if (command === "on" || command === "all on") {
        configStore.setComponentOverride("editor", true);
        configStore.setComponentOverride("messages", true);
        configStore.setComponentOverride("tools", true);
        configStore.setComponentOverride("footer", true);
        configStore.setComponentOverride("thinking", true);
        services.header?.on(ctx);
        if (getActiveTheme().id === "omt-signature") sidebar.on(ctx);
        message = withFallback("OMT all components on.", activateComponents(ctx));
      } else if (command === "off" || command === "all off") {
        configStore.setComponentOverride("editor", false);
        configStore.setComponentOverride("messages", false);
        configStore.setComponentOverride("tools", false);
        configStore.setComponentOverride("footer", false);
        configStore.setComponentOverride("thinking", false);
        editor.off(ctx);
        messages.off();
        tools.off();
        footer.off(ctx);
        thinking.off(ctx);
        services.header?.off(ctx);
        sidebar.off(ctx);
        message = "OMT all components off.";
      } else if (command === "editor on") {
        configStore.setComponentOverride("editor", true);
        message = editor.on(ctx);
      } else if (command === "editor off") {
        configStore.setComponentOverride("editor", false);
        message = editor.off(ctx);
      } else if (command === "messages on") {
        configStore.setComponentOverride("messages", true);
        message = messages.on();
      } else if (command === "messages off") {
        configStore.setComponentOverride("messages", false);
        message = messages.off();
      } else if (command === "tools on") {
        configStore.setComponentOverride("tools", true);
        message = tools.on();
      } else if (command === "tools off") {
        configStore.setComponentOverride("tools", false);
        message = tools.off();
      } else if (command === "footer on") {
        configStore.setComponentOverride("footer", true);
        message = footer.on(ctx);
      } else if (command === "footer off") {
        configStore.setComponentOverride("footer", false);
        message = footer.off(ctx);
      } else if (command === "wallpaper" || command === "bg") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          message = "OMT wallpaper viewer requires interactive TUI mode.";
        } else {
          await openWallpaperViewer(ctx);
          return;
        }
      } else if (/^(background|bg) (pause|resume)$/.test(command)) {
        if (command.endsWith("resume")) background.resume(); else background.pause();
        message = `OMT background ${background.isPaused() ? "paused" : "playing"}.`;
      } else if (/^(background|bg) fit /.test(command)) {
        const fit = command.split(" ").at(-1)!;
        if (["cover", "contain", "center", "tile"].includes(fit)) { configStore.setBackgroundOverride("fit", fit); message = `OMT background fit: ${fit}.`; }
        else message = "Invalid fit: cover, contain, center or tile required.";
      } else if (/^(background|bg) scale(?: |$)/.test(command)) {
        const raw = command.split(" ").slice(2).join(" ");
        const scale = /^(?:\d+(?:\.\d+)?|\.\d+)x?$/.test(raw) ? Number(raw.replace(/x$/, "")) : NaN;
        if (Number.isFinite(scale) && scale >= 0.25 && scale <= 2) {
          configStore.setBackgroundOverride("textureScale", scale);
          message = `OMT background texture scale: ${scale}x.`;
        } else message = "Invalid texture scale: number 0.25–2 (optional x suffix) required.";
      } else if (/^(background|bg) fps /.test(command)) {
        const fps = Number(command.split(" ").at(-1));
        if (Number.isInteger(fps) && fps >= 1 && fps <= 30) { configStore.setBackgroundOverride("fps", fps); message = `OMT background FPS cap: ${fps}.`; }
        else message = "Invalid FPS: integer 1–30 required.";
      } else if (command === "background on" || command === "bg on") {
        message = background.on(ctx);
      } else if (command === "background off" || command === "bg off") {
        message = background.off(ctx);
      } else if (command.startsWith("background mode ") || command.startsWith("bg mode ")) {
        const mode = command.split(" ")[2] as any;
        message = VALID_BACKGROUND_MODES.includes(mode) ? background.setMode(mode, ctx) : "Invalid background mode.";
      } else if (command.startsWith("background scene ") || command.startsWith("bg scene ")) {
        const scene = command.split(" ")[2] as any;
        message = VALID_BACKGROUND_SCENES.includes(scene) ? background.setScene(scene, ctx) : "Invalid background scene.";
      } else if (command.startsWith("background speed ") || command.startsWith("bg speed ")) {
        const raw = command.split(" ")[2]!.replace("x", "");
        const num = parseFloat(raw);
        if (Number.isFinite(num) && num > 0) {
          background.setSpeed(Math.max(0.25, Math.min(4, num)));
          message = `OMT background speed set to ${configStore.getBackground().speed}x.`;
        } else {
          message = `Invalid background speed: ${raw}.`;
        }
      } else if (command.startsWith("background intensity ") || command.startsWith("bg intensity ")) {
        const intensity = command.split(" ")[2] as any;
        if (VALID_BACKGROUND_INTENSITIES.includes(intensity)) { background.setIntensity(intensity); message = `OMT background intensity set to ${intensity}.`; }
        else message = "Invalid background intensity.";
      } else if (command.startsWith("background dimming ") || command.startsWith("bg dimming ")) {
        const dimming = command.split(" ")[2] as any;
        if (VALID_BACKGROUND_DIMMINGS.includes(dimming)) { background.setDimming(dimming); message = `OMT background dimming set to ${dimming}.`; }
        else message = "Invalid background dimming.";
      } else if (command === "background pause on" || command === "bg pause on") {
        background.setPauseOnActivity(true);
        message = "OMT background pause on activity enabled.";
      } else if (command === "background pause off" || command === "bg pause off") {
        background.setPauseOnActivity(false);
        message = "OMT background pause on activity disabled.";
      } else if (command === "background" || command === "bg status") {
        const stats = background.getStats();
        message = `OMT background: ${stats.enabled ? "on" : "off"} (scene: ${stats.scene}, mode: ${stats.mode}, speed: ${stats.speed}x, texture scale: ${stats.textureScale}x, intensity: ${stats.intensity}, dimming: ${stats.dimming}${stats.paused ? ", [PAUSED]" : ""}).${stats.mode === "full" && !stats.isFullBackdropSupported ? " Full viewport unavailable; native rendering unchanged." : ""}`;
      } else if (command === "thinking on") {
        configStore.setComponentOverride("thinking", true);
        message = thinking.on(ctx);
      } else if (command === "thinking off") {
        configStore.setComponentOverride("thinking", false);
        message = thinking.off(ctx);
      } else if (command === "theme" || command === "themes") {
        if (ctx.hasUI && ctx.mode === "tui") {
          await openThemePicker(ctx);
          return; // Closing a picker is not a new theme-status notification.
        }
        message = `OMT theme: ${getActiveTheme().id}. Available: ${THEME_NAMES.join(", ")}`;
      } else if (command === "preset" || command === "presets") {
        message = `OMT theme: ${getActiveTheme().id}. Available: ${THEME_NAMES.join(", ")}`;
      } else if (command === "save" || command === "save-defaults") {
        const ok = configStore.saveCurrentAsDefaults();
        message = ok ? "OMT configuration saved as default." : "Failed to save OMT configuration.";
      } else if (command.startsWith("theme ") || command.startsWith("preset ")) {
        const rawArg = command.replace(/^(theme|preset)\s+/, "").trim();
        const sessionOnly = /\s+(--session|session)$/.test(rawArg);
        const themeName = rawArg.replace(/\s+(--session|session)$/, "").trim();
        const resolved = resolveThemeName(themeName);
        if (resolved) {
          message = applyTheme(resolved, ctx, { sessionOnly });
        } else if (isValidPaletteName(themeName)) {
          configStore.setSignatureOverride("palette", themeName);
          applyTheme("omt-signature", ctx, { sessionOnly });
          message = `OMT theme set to omt-signature (palette: ${themeName}).`;
        } else {
          message = `Unknown theme: ${themeName}. Available themes: ${THEME_NAMES.join(", ")}`;
        }
      } else if (resolveThemeName(command)) {
        const resolved = resolveThemeName(command)!;
        message = applyTheme(resolved, ctx);
      } else if (isValidPaletteName(command)) {
        configStore.setSignatureOverride("palette", command);
        applyTheme("omt-signature", ctx);
        message = `OMT theme set to omt-signature (palette: ${command}).`;
      } else {
        message = "Usage: /omt [settings|palette|inspect|git|navigate|session|tree|queue|doctor|tabs|wallpaper|background|theme|on|off]";
      }
      await services.refreshLayout?.(ctx);
      if (ctx.hasUI) ctx.ui.notify(message, message.includes("Native fallback:") || / unavailable:| inactive:/.test(message) ? "warning" : "info");
    },
  });
}

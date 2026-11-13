import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { createPermissionRequest } from "../features/approval-ux/model.ts";
import { getActiveTheme } from "../core/theme.ts";
import { configStore } from "../core/config.ts";
import { getActiveTui } from "../core/motion.ts";
import { signatureTheme } from "../presets/omt-signature/rendering.ts";
import { createSignatureAppearanceActions } from "./appearance.ts";
import { createSidebarActions } from "./sidebar-actions.ts";
import { notificationStore } from "../features/smart-notifications/store.ts";
import type { PsecId } from "../features/omt-dialogs/types.ts";

import type { TabId } from "../features/multi-view-tabs/index.ts";
import type { PermissionRequest } from "../features/approval-ux/types.ts";

import type { RuntimeServices } from "./contracts.ts";
import { createModalHost, type ModalFactory, type ModalPresentation } from "../ui/modal.ts";
import { buildPaletteActions } from "./actions.ts";

export function createDialogs(services: RuntimeServices) {
  const { editor, messages, tools, footer, thinking, background, composerStash, promptQueueStore, applyTheme, activateComponents } = services;
  const modal = createModalHost();
  const openModal = <T>(ctx: ExtensionContext, factory: ModalFactory<T>, presentation?: ModalPresentation) => {
    const signature = getActiveTheme().id === "omt-signature";
    return modal.open<T>(ctx, (tui, theme, keys, done) =>
      factory(tui, signature ? signatureTheme(theme) : theme, keys, done), signature ? (presentation ?? {}) : undefined);
  };

  async function openToolInspector(ctx: ExtensionContext) {
    if (getActiveTheme().id === "omt-signature") {
      const { createOmtTrajectoryComponent } = await import("../features/omt-dialogs/trajectory-dialog.ts");
      const { readTrajectorySteps } = await import("./trajectory.ts");
      const steps = readTrajectorySteps(ctx.sessionManager);
      // Do not open a trajectory modal without entries.
      if (!steps.length) {
        ctx.ui.notify("no trajectory entries yet", "info");
        return;
      }
      await openModal(ctx, (tui, theme, keybindings, done) => {
        return createOmtTrajectoryComponent(tui, theme, keybindings, done, ctx, {
          steps,
        });
      }, { fullWidth: true });
      return;
    }
    const { createToolInspectorComponent } = await import("../features/tool-inspector/index.ts");
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createToolInspectorComponent(tui, theme, keybindings, done, ctx);
    });
  }

  async function openGitExplorer(ctx: ExtensionContext) {
    const { createGitExplorerComponent } = await import("../features/git-explorer/index.ts");
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createGitExplorerComponent(tui, theme, keybindings, done, ctx);
    });
  }

  async function openConversationNavigator(ctx: ExtensionContext) {
    const { createConversationNavigatorComponent } = await import("../features/conversation-navigator/index.ts");
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createConversationNavigatorComponent(tui, theme, keybindings, done, ctx);
    });
  }

  async function openSessionManager(ctx: ExtensionContext) {
    if (getActiveTheme().id === "omt-signature") {
      const { createOmtResumeComponent } = await import("../features/omt-dialogs/resume-dialog.ts");
      const { SessionManager } = await import("@earendil-works/pi-coding-agent");
      const adapt = (items: Awaited<ReturnType<typeof SessionManager.list>>) => items.map(session => ({
        id: session.id, path: session.path, title: session.name || session.firstMessage || session.id,
        name: session.name, messageCount: session.messageCount, modified: session.modified,
        cwd: session.cwd, firstMessage: session.firstMessage, firstUserPrompt: session.firstMessage,
      }));
      const loadCurrent = () => SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
      const sessions = adapt(await loadCurrent());
      let component: ReturnType<typeof createOmtResumeComponent> | undefined;
      let open = true;
      let generation = 0;
      const reload = async (scope: "current" | "all") => {
        const epoch = ++generation;
        const next = adapt(await (scope === "all" ? SessionManager.listAll() : loadCurrent()));
        if (open && epoch === generation) component?.setSessions(next);
      };
      try {
        await openModal(ctx, (tui, theme, keybindings, done) => {
          component = createOmtResumeComponent(tui, theme, keybindings, done, ctx, {
            sessions, cwd: ctx.cwd, currentSessionId: ctx.sessionManager.getSessionId(),
            currentSessionPath: ctx.sessionManager.getSessionFile(),
            onScopeChange: scope => { void reload(scope).catch(error => ctx.ui.notify(`Session list: ${String(error)}`, "error")); },
            onSelectSession: session => {
              if (session.path && typeof (ctx as any).switchSession === "function") {
                void (ctx as any).switchSession(session.path).catch((error: unknown) => ctx.ui.notify(`Session unchanged: ${String(error)}`, "error"));
              } else ctx.ui.notify("Session unchanged: native session switching API unavailable.", "warning");
            },
          });
          return component;
        }, { fullWidth: true });
      } finally { open = false; generation++; }
      return;
    }
    const { createSessionManagerComponent } = await import("../features/session-manager-ui/index.ts");
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createSessionManagerComponent(tui, theme, keybindings, done, ctx, {
        onSelectSession: (session) => {
          if (session.filePath && (ctx as any).switchSession) {
            void (ctx as any).switchSession(session.filePath);
          }
        },
      });
    });
  }

  async function openSessionTree(ctx: ExtensionContext) {
    if (getActiveTheme().id === "omt-signature") {
      const { createOmtTreeComponent } = await import("../features/omt-dialogs/tree-dialog.ts");
      const { buildSessionTreeItems, flattenSessionTree } = await import("../features/session-tree/model.ts");
      const sm = (ctx as any)?.sessionManager;
      let nodes: any[] = [];
      if (sm && typeof sm.getTree === "function") {
        const tree = sm.getTree();
        const leafId = typeof sm.getLeafId === "function" ? sm.getLeafId() : undefined;
        const roots = buildSessionTreeItems(tree, leafId);
        const flattened = flattenSessionTree(roots);
        nodes = flattened.map(({ node }) => ({
          id: node.id,
          parentId: node.parentId ?? null,
          role: node.type === "toolResult" ? "tool" : node.type,
          entryType: node.type,
          summary: node.summary,
          label: node.label,
          timestamp: node.timestamp,
          isCurrent: node.isCurrent,
          isLeaf: node.isLeaf,
        }));
      }
      await openModal(ctx, (tui, theme, keybindings, done) => {
        return createOmtTreeComponent(tui, theme, keybindings, done, ctx, {
          nodes,
          onJumpToNode: (nodeId) => {
            if ((ctx as any).navigateTree) {
              void (ctx as any).navigateTree(nodeId);
            }
          },
          onForkNode: (nodeId) => {
            if ((ctx as any).fork) {
              void (ctx as any).fork(nodeId);
            }
          },
        });
      }, { anchor: "bottom-center", bottomInset: 2, transcriptTail: true });
      return;
    }
    const { createSessionTreeComponent } = await import("../features/session-tree/index.ts");
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createSessionTreeComponent(tui, theme, keybindings, done, ctx, {
        onJumpToNode: (nodeId) => {
          if ((ctx as any).navigateTree) {
            void (ctx as any).navigateTree(nodeId);
          }
        },
        onForkNode: (nodeId) => {
          if ((ctx as any).fork) {
            void (ctx as any).fork(nodeId);
          }
        },
      });
    });
  }

  async function openCommandPalette(ctx: ExtensionContext) {
    const { createCommandPaletteComponent } = await import("../features/command-palette/index.ts");
    const actions = buildPaletteActions({ ...services, ...openers }, ctx);
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createCommandPaletteComponent(tui, theme, keybindings, done, ctx, actions);
    });
  }

  async function openSignatureSettings(ctx: ExtensionContext, initialSection?: PsecId) {
    const { createOmtSettingsHubComponent } = await import("../features/omt-dialogs/settings-hub.ts");
    const appearance = createSignatureAppearanceActions(() => {
      services.refreshHostTheme?.(ctx);
      editor.applyTheme(ctx);
      messages.applyTheme?.();
      footer.applyTheme(ctx);
      services.header?.applyTheme(ctx);
      background.applyTheme(ctx);
      getActiveTui()?.requestRender?.();
    }, configStore, ctx.ui.theme.appearance === "light" ? "catppuccin-latte" : "default");
    const commands = services.pi?.getCommands?.() ?? [];
    const settings = services.pi?.getSettings?.();
    const toolStats = new Map<string, { name: string; count: number; errors: number; durationMs?: number }>();
    let branch: ReturnType<ExtensionContext["sessionManager"]["getBranch"]> | undefined;
    try { branch = ctx.sessionManager?.getBranch?.(); } catch { /* Unknown is not empty history. */ }
    for (const entry of branch ?? []) {
      if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
      const message = entry.message;
      const stat = toolStats.get(message.toolName) ?? { name: message.toolName, count: 0, errors: 0 };
      stat.count++;
      if (message.isError) stat.errors++;
      if (typeof message.durationMs === "number" && (stat.count === 1 || stat.durationMs !== undefined)) {
        stat.durationMs = (stat.durationMs ?? 0) + message.durationMs;
      } else stat.durationMs = undefined; // never present a partial sum as the total
      toolStats.set(message.toolName, stat);
    }
    try {
      await openModal(ctx, (tui, theme, keybindings, done) => createOmtSettingsHubComponent(tui, theme, keybindings, done, ctx, {
        ...appearance, initialSection,
        commands: commands.map(command => ({ name: command.name, description: command.description ?? "", source: command.source })),
        skills: commands.filter(command => command.source === "skill").map(command => ({ name: command.name, description: command.description ?? "" })),
        prompts: commands.filter(command => command.source === "prompt").map(command => ({ name: command.name, description: command.description ?? "" })),
        extensions: (settings?.extensions ?? []).map(name => ({ name, description: "" })),
        plugins: (settings?.packages ?? []).map(pkg => { const spec = typeof pkg === "string" ? pkg : pkg.source; return { name: spec, spec }; }),
        shortcuts: [], marketplace: [], mcpServers: [], toolStats: [...toolStats.values()],
        unavailableSections: {
          shortcut: "Native shortcut inventory is not exposed.",
          extension: "Configured paths are not a loaded-extension inventory.",
          market: "No native marketplace observation.",
          mcp: "Registered servers do not expose connection state.",
          ...(!branch ? { tool: "Native branch history is unavailable." } : {}),
          ...(!services.pi?.getCommands ? { command: "Command registry unavailable.", skill: "Skill registry unavailable.", prompt: "Prompt registry unavailable." } : {}),
          ...(!settings ? { plugin: "Package settings unavailable." } : {}),
        },
      }));
    } finally { appearance.dispose(); }
  }

  async function openSettings(ctx: ExtensionContext) {
    if (getActiveTheme().id === "omt-signature") {
      await openSignatureSettings(ctx);
      return;
    }
    const { createSettingsComponent } = await import("../features/settings-ui/index.ts");
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createSettingsComponent(tui, theme, keybindings, done, ctx, {
        editor,
        messages,
        tools,
        footer,
        thinking,
        background,
        applyTheme,
      });
    });
  }

  async function openWallpaperViewer(ctx: ExtensionContext) {
    const { createWallpaperViewerComponent } = await import("../features/wallpaper-viewer/index.ts");
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createWallpaperViewerComponent(tui, theme, keybindings, done, ctx, {
        onApply: (scene, mode) => {
          background.setScene(scene, ctx);
          background.setMode(mode, ctx);
        },
      });
    });
  }

  async function openPromptQueue(ctx: ExtensionContext) {
    const { createPromptQueueComponent } = await import("../features/prompt-queue/index.ts");
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createPromptQueueComponent(tui, theme, keybindings, done, ctx, {
        prompts: promptQueueStore.getAll(),
        onPromote: (id) => { promptQueueStore.promote(id); },
        onRemove: (id) => { promptQueueStore.remove(id); },
        onClear: () => { promptQueueStore.clear(); },
      });
    });
  }

  async function openStashPicker(ctx: ExtensionContext) {
    const { createStashPickerComponent } = await import("../features/advanced-composer/index.ts");
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createStashPickerComponent(tui, theme, keybindings, done, ctx, {
        stash: composerStash,
      });
    });
  }

  async function openNotificationCenter(ctx: ExtensionContext) {
    if (getActiveTheme().id === "omt-signature") {
      const { createNotificationHistoryComponent } = await import("../features/omt-dialogs/notification-history.ts");
      await openModal(ctx, (tui, theme, keys, done) => createNotificationHistoryComponent(tui, theme, keys, done, ctx, {
        items: notificationStore.getAll().map(item => ({ id: item.id, text: item.message, level: item.level, timestamp: item.timestamp })),
      }), { fullWidth: true });
      return;
    }
    const { createNotificationCenterComponent } = await import("../features/smart-notifications/index.ts");
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createNotificationCenterComponent(tui, theme, keybindings, done, ctx);
    });
  }

  async function openDoctor(ctx: ExtensionContext) {
    const { createDoctorComponent } = await import("../features/doctor/index.ts");
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createDoctorComponent(tui, theme, keybindings, done, ctx);
    });
  }

  async function openShortcutHelp(ctx: ExtensionContext) {
    const { createShortcutHelpComponent } = await import("../features/accessibility/view.ts");
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createShortcutHelpComponent(tui, theme, keybindings, done, ctx);
    });
  }

  async function openScrollback(ctx: ExtensionContext) {
    const { createScrollbackComponent } = await import("../features/scrollback-mode/index.ts");
    const entries = ctx.sessionManager?.getEntries?.() ?? [];
    const lines: string[] = [];
    for (const entry of entries as any[]) {
      if (entry.type === "message" && entry.message) {
        const role = entry.message.role ?? "message";
        const text = typeof entry.message.content === "string"
          ? entry.message.content
          : Array.isArray(entry.message.content)
            ? entry.message.content.map((c: any) => c.text ?? "").join("\n")
            : "";
        lines.push(`[${role.toUpperCase()}]: ${text}`);
      } else if (entry.type === "compaction") {
        lines.push(`[COMPACTION]: ${entry.summary ?? ""}`);
      } else if (entry.type === "label") {
        lines.push(`[BOOKMARK]: ${entry.label ?? ""}`);
      }
    }
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createScrollbackComponent(tui, theme, keybindings, done, ctx, {
        lines: lines.length > 0 ? lines : ["(No conversation entries in current session)"],
      });
    });
  }

  async function openPermissionReview(ctx: ExtensionContext, req?: PermissionRequest) {
    const { createPermissionReviewComponent } = await import("../features/approval-ux/index.ts");
    const request = req ?? createPermissionRequest(
      "bash",
      { command: "git status" },
      "System permission review and safety diagnostics.",
    );
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createPermissionReviewComponent(tui, theme, keybindings, done, ctx, {
        request,
      });
    });
  }

  async function openTabBar(ctx: ExtensionContext, activeTab: TabId = "chat") {
    const { createTabBarComponent } = await import("../features/multi-view-tabs/index.ts");
    await openModal(ctx, (tui, theme, _keybindings, done) => {
      return createTabBarComponent(tui, theme, {
        activeTab,
        onSelectTab: (tabId) => {
          done(tabId);
          queueMicrotask(() => {
            if (tabId === "inspector") void openToolInspector(ctx);
            else if (tabId === "git") void openGitExplorer(ctx);
            else if (tabId === "sessions") void openSessionManager(ctx);
            else if (tabId === "doctor") void openDoctor(ctx);
          });
        },
      });
    });
  }

  async function openSidebar(ctx: ExtensionContext) {
    const { createSidebarComponent } = await import("../features/sidebar/view.ts");
    let open = true;
    try {
      await openModal(ctx, (tui, theme, keybindings, done) =>
        createSidebarComponent(tui, theme, keybindings, done, ctx, {
          getState: () => services.sidebar.getState(ctx), ...createSidebarActions(services.pi, ctx, () => open),
        }));
    } finally { open = false; }
  }

  async function openModelPicker(ctx: ExtensionContext) {
    const { createOmtModelPickerComponent } = await import("../features/omt-dialogs/model-picker.ts");
    const curModel = ctx.model;
    const key = (model: { provider: string; id: string }) => `${model.provider}\u0000${model.id}`;
    const registry = ctx.modelRegistry;
    const all = registry?.getAll?.() ?? [];
    const availableModels = registry?.getAvailable?.() ?? [];
    const available = new Set(availableModels.map(key));
    const scoped = Array.isArray(ctx.scopedModels) ? ctx.scopedModels : [];
    const scopeKeys = new Set(scoped.map(entry => key(entry.model)));
    // Show all known models regardless of credential/availability state so every
    // provider is visible in the picker. keyStatus still reflects whether the
    // model is ready or missing, letting the user see what needs to be connected.
    const catalogue = all.length > 0 ? all : availableModels;
    const rawModels = catalogue.filter(model =>
      (scopeKeys.size === 0 || scopeKeys.has(key(model))) || (curModel && key(curModel) === key(model))
    );
    if (curModel && !rawModels.some(model => key(model) === key(curModel))) rawModels.unshift(curModel);
    if (rawModels.length === 0 && all.length === 0 && curModel) rawModels.push(curModel);
    const favorites = configStore.getSignature().favorites;
    const models = rawModels.map(model => ({
      id: model.id, name: model.name, provider: model.provider, api: model.api, baseUrl: model.baseUrl,
      contextWindow: model.contextWindow, maxTokens: model.maxTokens,
      costInput: model.cost?.input, costOutput: model.cost?.output,
      costCacheRead: model.cost?.cacheRead, costCacheWrite: model.cost?.cacheWrite,
      thinking: model.reasoning, inputModalities: model.input ? [...model.input] : undefined,
      keyStatus: available.has(key(model)) ? "ready" as const : "missing" as const,
      favoriteKey: key(model), isFavorite: favorites.includes(key(model)),
    }));
    await openModal(ctx, (tui, theme, keybindings, done) => createOmtModelPickerComponent(tui, theme, keybindings, done, ctx, {
      models, favoriteModelIds: favorites,
      currentModelId: curModel?.id, currentModelProvider: curModel?.provider,
      onToggleFavorite: (id, favorite) => {
        const next = new Set(configStore.getSignature().favorites);
        if (favorite) next.add(id); else next.delete(id);
        configStore.setSignatureOverride("favorites", [...next]);
        if (configStore.setSignatureDefault("favorites", [...next])) configStore.setSignatureOverride("favorites", undefined);
        else ctx.ui.notify("Favorite updated for this session; saving failed.", "warning");
      },
      onSelectModel: selected => {
        const model = rawModels.find(candidate => key(candidate) === key(selected));
        if (!model || !services.pi?.setModel) {
          ctx.ui.notify("Model selection unavailable: native model API required.", "warning");
          return;
        }
        void services.pi.setModel(model).then(success => {
          if (!success) ctx.ui.notify(`Model unchanged: authentication unavailable for ${model.provider}.`, "warning");
          getActiveTui()?.requestRender?.();
        }).catch(error => ctx.ui.notify(`Model unchanged: ${String(error)}`, "error"));
      },
    }));
  }

  async function openThemePicker(ctx: ExtensionContext) {
    if (getActiveTheme().id === "omt-signature") await openSignatureSettings(ctx, "theme");
    else await openSettings(ctx);
  }

  async function openPetPicker(ctx: ExtensionContext) {
    const { createOmtPetSelectorComponent } = await import("../features/omt-dialogs/pet-picker.ts");
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createOmtPetSelectorComponent(tui, theme, keybindings, done, ctx, {
        currentPet: configStore.getSignature().pet,
        onSelectPet: (petId) => {
          const saved = configStore.setSignatureDefault("pet", petId);
          configStore.setSignatureOverride("pet", saved ? undefined : petId);
          ctx.ui.notify(saved ? `Pet set to ${petId}` : `Pet set to ${petId} for this session; saving failed.`, saved ? "info" : "warning");
        },
      });
    });
  }

  async function openBlockActions(ctx: ExtensionContext, content?: any) {
    const { createOmtBlockActionsComponent } = await import("../features/omt-dialogs/block-actions.ts");
    let blockContent = content;
    if (!blockContent) {
      const entries = ctx.sessionManager?.getEntries?.() ?? [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry?.type === "message" && entry.message?.role === "assistant") {
          const c = entry.message.content;
          blockContent = typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => p.text ?? "").join("\n") : "";
          break;
        }
      }
      if (!blockContent) {
        blockContent = "";
      }
    }
    await openModal(ctx, (tui, theme, keybindings, done) => {
      return createOmtBlockActionsComponent(tui, theme, keybindings, done, ctx, {
        content: blockContent,
      });
    }, { fullWidth: true });
  }

  const openers = {
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
  };
  return { ...openers, reset: modal.reset };
}

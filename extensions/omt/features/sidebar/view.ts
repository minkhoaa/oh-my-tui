import { matchesKey, Key, visibleWidth, truncateToWidth, stripTerminalSequences, type KeybindingsManager, type TUI, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { SidebarState, SidebarOptions, SidebarFolds } from "./types.ts";
import { SidePet, SideSession, SideModel, SideStats, SideCost, SideRecent, SideCommands, SidePlugins, SideMCP, SideTodos, SideLSP, SideTools, SideSkills, SideSubagents, SideWorkspace, sideOrder, SIDE_ORDER, sideLabel, DefaultSideVisible, isSideVisible, FOLDABLE_SECTIONS, DEFAULT_FOLDS, foldMark, SIDE_W, SIDE_INNER_W, ART_ROWS, fmtDur, PET_NAMES, DEFAULT_PET, rotatePet, PET_ROTATE_EVERY, renderSidepanels, buildSidebarContent, renderPetSection, renderSessionSection, renderModelSection, renderStatsSection, renderCostSection, renderRecentSection, renderCommandsSection, renderPluginsSection, renderMcpSection, renderTodosSection, renderLspSection, renderToolsSection, renderSkillsSection, renderSubagentsSection, renderWorkspaceSection, renderSidepanelsViewport, applyHover, type SideSectionKey, type FoldableSectionKey, type SidePanelFolds } from "./sidepanels.ts";
import { renderPetAnim, renderPetAnimToString, PetAnimComponent, createPetAnimState, stepPetAnim, isBusyStatus, isFlashingStatus, classicFace, PET_CADENCE_IDLE, PET_CADENCE_BUSY, PET_FLASH_DELAY, type PetStatus } from "./pet-anim.ts";
import { extractSidebarState } from "./model.ts";
import { motionCoordinator, isAnimationActive, scaleElapsed } from "../../core/motion.ts";
import { getActiveTheme } from "../../core/theme.ts";
import { signatureTheme } from "../../presets/omt-signature/rendering.ts";
import { buildFleetDashboardState, renderFleetDashboardFramed } from "../agent-fleet/index.ts";
import type { FleetChild, FleetTab } from "../agent-fleet/index.ts";

let nextMotionSource = 0;

export interface SidebarComponentOptions extends SidebarOptions {
  state?: SidebarState;
  getState?: () => SidebarState;
  onCyclePet?: (petName: string) => void;
  onSelectPet?: (petNameOrStyle: string) => void | Promise<void>;
  onSelectModel?: (modelId: string) => void | Promise<void>;
  onSelectThinkingLevel?: (level: string) => void | Promise<void>;
  onToggleFold?: (sectionKey: string, folded: boolean) => void;
  onToggleSection?: (sectionKey: string, visible: boolean) => void;
}

/**
 * Renders the 15-section OMT sidebar with full fidelity.
 * Preserves backward-compatible default commands visibility while strictly
 * following OMT sideOrder and sidepanels engine.
 */
export function renderSidebar(
  state: SidebarState = {},
  width = SIDE_W,
  theme?: any,
  options?: SidebarOptions,
): string[] {
  const mergedOptions: SidebarOptions = {
    ...options,
    visibleSections: {
      commands: options?.visibleSections?.commands ?? true,
      ...state.visible,
      ...options?.visibleSections,
    },
  };
  return renderSidepanels(state, width, theme, mergedOptions);
}

export {
  SidePet,
  SideSession,
  SideModel,
  SideStats,
  SideCost,
  SideRecent,
  SideCommands,
  SidePlugins,
  SideMCP,
  SideTodos,
  SideLSP,
  SideTools,
  SideSkills,
  SideSubagents,
  SideWorkspace,
  sideOrder,
  SIDE_ORDER,
  sideLabel,
  DefaultSideVisible,
  isSideVisible,
  FOLDABLE_SECTIONS,
  DEFAULT_FOLDS,
  foldMark,
  SIDE_W,
  SIDE_INNER_W,
  ART_ROWS,
  PET_NAMES,
  DEFAULT_PET,
  rotatePet,
  PET_ROTATE_EVERY,
  renderSidepanels,
  buildSidebarContent,
  renderPetSection,
  renderSessionSection,
  renderModelSection,
  renderStatsSection,
  renderCostSection,
  renderRecentSection,
  renderCommandsSection,
  renderPluginsSection,
  renderMcpSection,
  renderTodosSection,
  renderLspSection,
  renderToolsSection,
  renderSkillsSection,
  renderSubagentsSection,
  renderWorkspaceSection,
  renderSidepanelsViewport,
  renderPetAnim,
  renderPetAnimToString,
  PetAnimComponent,
  createPetAnimState,
  stepPetAnim,
  isBusyStatus,
  isFlashingStatus,
  classicFace,
};
export type { SideSectionKey, FoldableSectionKey, SidePanelFolds };

/**
 * Interactive sidebar component for Pi (usable as modal overlay or container widget).
 * Handles 15-section OMT dashboard following exact sideOrder:
 * Pet, Session, Model, Stats, Cost, Recent, Commands, Plugins, MCP, Todos, LSP, Tools, Skills, Subagents, Workspace.
 * Supports bounded scrolling with hints, keyboard navigation, fullscreen mouse routing,
 * fold collapsing (▸/▾), genuine model/thinking selection, and pet animation/rotation.
 */
export class SidebarComponent implements Component {
  protected readonly tui: TUI;
  protected readonly theme: Theme;
  protected readonly keybindings?: KeybindingsManager;
  protected readonly done: (value?: unknown) => void;
  protected readonly ctx: ExtensionContext;
  protected options?: SidebarComponentOptions;

  protected state: SidebarState;
  protected scrollOffset = 0;
  protected isClosed = false;
  protected petIndex = 0;
  protected foldedSections: SidePanelFolds;
  protected lastRenderedLines: string[] = [];
  protected readonly motionSource = `sidebar:${++nextMotionSource}`;
  protected readonly startedAt = performance.now();
  protected rotationAnchorAt = this.startedAt;
  protected hoverRow = -1;
  protected hoverLevel = "";

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager | undefined,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options?: SidebarComponentOptions,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    this.state =
      options?.state ??
      options?.getState?.() ??
      (typeof extractSidebarState === "function" ? extractSidebarState(ctx) : {});
    this.foldedSections = {
      ...(options?.foldedSections ?? (this.state.folds as SidePanelFolds) ?? DEFAULT_FOLDS),
    };

    const initialPet = this.state.pet?.name ?? DEFAULT_PET;
    const foundIdx = PET_NAMES.indexOf(initialPet);
    this.petIndex = foundIdx >= 0 ? foundIdx : 0;

    if (this.options?.visibleSections?.pet !== false && this.state.visible?.pet !== false) {
      const status = (this.state.pet?.status as PetStatus) ?? "idle";
      const cadence = isBusyStatus(status) ? PET_CADENCE_BUSY : PET_CADENCE_IDLE;
      motionCoordinator.register(this.motionSource, cadence);
    }
  }

  protected getViewportHeight(): number {
    return Math.max(
      1,
      Math.floor(this.options?.viewportHeight ?? Math.max(3, (this.tui.terminal?.rows ?? 30) - 10)),
    );
  }

  protected shouldFillViewport(): boolean {
    return this.options?.fillViewport ?? false;
  }

  getState(): SidebarState {
    return this.state;
  }

  setState(newState: SidebarState): void {
    this.state = newState;
    this.tui.requestRender?.();
  }

  getScrollOffset(): number {
    return this.scrollOffset;
  }

  setScrollOffset(offset: number): void {
    this.scrollOffset = Math.max(0, offset);
    this.tui.requestRender?.();
  }

  getFolds(): SidePanelFolds {
    return { ...this.foldedSections };
  }

  toggleFold(sectionKey: FoldableSectionKey | keyof SidebarFolds | string): boolean {
    const key = sectionKey as FoldableSectionKey;
    const current = !!this.foldedSections[key];
    const next = !current;
    this.foldedSections[key] = next;
    this.options?.onToggleFold?.(sectionKey, next);
    this.tui.requestRender?.();
    return next;
  }

  private close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    motionCoordinator.unregister(this.motionSource);
    this.done();
  }

  /** Cycles to the next ASCII pet */
  cyclePet(): string {
    this.rotationAnchorAt = performance.now();
    this.petIndex = (this.petIndex + 1) % PET_NAMES.length;
    const nextPet = PET_NAMES[this.petIndex] ?? DEFAULT_PET;
    this.state = {
      ...this.state,
      pet: {
        ...this.state.pet,
        name: nextPet,
        status: this.state.pet?.status ?? "idle",
        tick: 0,
      },
    };
    this.options?.onCyclePet?.(nextPet);
    if (this.options?.onSelectPet) {
      void this.options.onSelectPet(nextPet);
    }
    this.tui.requestRender?.();
    return nextPet;
  }

  /** Toggles between ASCII art pet and classic kaomoji look */
  togglePetStyle(): "ascii" | "classic" {
    const curStyle = this.state.pet?.style ?? "ascii";
    const nextStyle = curStyle === "classic" ? "ascii" : "classic";
    this.state = {
      ...this.state,
      pet: {
        ...this.state.pet,
        name: this.state.pet?.name ?? DEFAULT_PET,
        status: this.state.pet?.status ?? "idle",
        style: nextStyle,
      },
    };
    if (this.options?.onSelectPet) {
      void this.options.onSelectPet(nextStyle);
    }
    this.tui.requestRender?.();
    return nextStyle;
  }

  /** Selects a model by ID or label */
  selectModel(modelId: string): void {
    if (!modelId) return;
    if (!this.options?.onSelectModel) {
      // Callback absent must not fake a successful model operation
      return;
    }
    const apply = () => {
      if (!this.options?.getState) {
        if (this.state.recentModels) {
          this.state.recentModels = this.state.recentModels.map((m) => ({
            ...m,
            isCurrent: m.id === modelId || m.label === modelId,
          }));
        }
        if (this.state.model) {
          this.state.model = { ...this.state.model, label: modelId };
        }
      }
      this.tui.requestRender?.();
    };
    const result = this.options.onSelectModel(modelId);
    if (result && typeof (result as Promise<void>).then === "function") {
      void (result as Promise<void>).then(apply, () => {});
    } else {
      apply();
    }
  }

  /** Selects thinking level */
  selectThinkingLevel(level: string): void {
    if (!level) return;
    if (!this.options?.onSelectThinkingLevel) {
      // Callback absent must not fake a successful thinking operation
      return;
    }
    const apply = () => {
      if (!this.options?.getState) {
        if (this.state.model) {
          this.state.model = { ...this.state.model, thinkLevel: level };
        }
      }
      this.tui.requestRender?.();
    };
    const result = this.options.onSelectThinkingLevel(level);
    if (result && typeof (result as Promise<void>).then === "function") {
      void (result as Promise<void>).then(apply, () => {});
    } else {
      apply();
    }
  }

  /** Cycles through available thinking levels */
  cycleThinkingLevel(): string | undefined {
    const levels = this.state.model?.thinkLevels ?? ["off", "low", "medium", "high"];
    if (!levels || levels.length === 0) return undefined;
    if (!this.options?.onSelectThinkingLevel) return undefined;
    const current = this.state.model?.thinkLevel ?? "off";
    const curIdx = levels.indexOf(current);
    const nextIdx = (curIdx + 1) % levels.length;
    const nextLevel = levels[nextIdx] ?? levels[0]!;
    this.selectThinkingLevel(nextLevel);
    return nextLevel;
  }

  /** Cycles through recent models */
  cycleRecentModel(): string | undefined {
    const recents = this.state.recentModels;
    if (!recents || recents.length === 0) return undefined;
    if (!this.options?.onSelectModel) return undefined;
    const curIdx = recents.findIndex((r) => r.isCurrent);
    const nextIdx = curIdx >= 0 ? (curIdx + 1) % recents.length : 0;
    const nextModel = recents[nextIdx]!;
    this.selectModel(nextModel.id);
    return nextModel.id;
  }

  handleInput(data: string): void {
    if (this.isClosed) return;

    // Esc / 'q' / 'Q' / Ctrl+C -> Close
    if (
      this.keybindings?.matches?.(data, "tui.select.cancel") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.esc) ||
      data === "\x1b" ||
      data === "q" ||
      data === "Q" ||
      data === "\x03"
    ) {
      this.close();
      return;
    }

    // 'p' / 'P' -> Cycle next pet
    if (data === "p" || data === "P") {
      this.cyclePet();
      return;
    }

    // Shift+P -> Toggle pet style (ascii <-> classic)
    if (data === "\x10") {
      this.togglePetStyle();
      return;
    }

    // 'm' / 'M' -> Cycle recent model
    if (data === "m" || data === "M") {
      this.cycleRecentModel();
      return;
    }

    // 't' / 'T' -> Cycle thinking level
    if (data === "t" || data === "T") {
      this.cycleThinkingLevel();
      return;
    }

    // 'f' / 'F' -> Cycle through foldable sections and toggle fold
    if (data === "f" || data === "F") {
      for (const section of FOLDABLE_SECTIONS) {
        this.toggleFold(section);
      }
      return;
    }

    // '1'..'9' -> Quick select recent model
    if (data >= "1" && data <= "9") {
      const idx = parseInt(data, 10) - 1;
      const recents = this.state.recentModels;
      if (recents && idx >= 0 && idx < recents.length) {
        this.selectModel(recents[idx]!.id);
        return;
      }
    }

    // 'r' / 'R' -> Refresh state from context
    if (data === "r" || data === "R") {
      this.state =
        this.options?.getState?.() ??
        (typeof extractSidebarState === "function" ? extractSidebarState(this.ctx) : {});
      this.tui.requestRender?.();
      return;
    }

    // PageDown / Space / Ctrl+Down / Alt+Down
    if (
      this.keybindings?.matches?.(data, "tui.select.pageDown") ||
      matchesKey(data, Key.pageDown) ||
      data === " " ||
      data === "\x1b[6~" ||
      data === "\x1b[1;5B" ||
      data === "\x1b\x1b[B"
    ) {
      this.scrollOffset += Math.max(1, this.getViewportHeight() - 2);
      this.tui.requestRender?.();
      return;
    }

    // PageUp / Ctrl+Up / Alt+Up
    if (
      this.keybindings?.matches?.(data, "tui.select.pageUp") ||
      matchesKey(data, Key.pageUp) ||
      data === "\x1b[5~" ||
      data === "\x1b[1;5A" ||
      data === "\x1b\x1b[A"
    ) {
      this.scrollOffset = Math.max(0, this.scrollOffset - Math.max(1, this.getViewportHeight() - 2));
      this.tui.requestRender?.();
      return;
    }

    // Home / 'g' -> Top
    if (matchesKey(data, Key.home) || data === "g" || data === "\x1b[H") {
      this.scrollOffset = 0;
      this.tui.requestRender?.();
      return;
    }

    // End / 'G' -> Bottom
    if (matchesKey(data, Key.end) || data === "G" || data === "\x1b[F") {
      this.scrollOffset = 999999;
      this.tui.requestRender?.();
      return;
    }

    // Up Arrow / 'k' -> Scroll sidebar up
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A" ||
      data === "k"
    ) {
      if (this.scrollOffset > 0) {
        this.scrollOffset--;
        this.tui.requestRender?.();
      }
      return;
    }

    // Down Arrow / 'j' -> Scroll sidebar down
    if (
      this.keybindings?.matches?.(data, "tui.select.down") ||
      matchesKey(data, Key.down) ||
      data === "\x1b[B" ||
      data === "j"
    ) {
      this.scrollOffset++;
      this.tui.requestRender?.();
      return;
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.isClosed) return undefined;

    // Mouse move -> Hover detection
    if (event.type === "move") {
      const boxWidth = this.options?.stretchWidth ? Math.max(1, Math.floor(this.tui.terminal?.columns ?? 80)) : SIDE_W;
      if (event.x >= 0 && event.x < boxWidth) {
        const contentRow = event.y - 1 + this.scrollOffset;
        if (contentRow >= 0 && contentRow !== this.hoverRow) {
          this.hoverRow = contentRow;
          const targetLine = this.lastRenderedLines[1 + contentRow];
          if (targetLine) {
            const plain = stripTerminalSequences(targetLine);
            const levels = this.state.model?.thinkLevels ?? [];
            let found = "";
            for (const l of levels) {
              if (plain.includes(l)) {
                found = l;
                break;
              }
            }
            this.hoverLevel = found;
          } else {
            this.hoverLevel = "";
          }
          this.tui.requestRender?.();
          return { handled: true, render: true };
        }
      } else if (this.hoverRow !== -1) {
        this.hoverRow = -1;
        this.hoverLevel = "";
        this.tui.requestRender?.();
        return { handled: true, render: true };
      }
      return undefined;
    }

    // Preserve text selection across chat/sidebar boundary
    if (event.type === "drag") {
      return undefined;
    }

    // Wheel scrolling
    if (event.type === "wheel") {
      const delta = event.wheelDelta ?? 0;
      if (delta < 0) {
        this.scrollOffset = Math.max(0, this.scrollOffset - Math.max(1, Math.abs(delta)));
      } else if (delta > 0) {
        this.scrollOffset += Math.max(1, delta);
      }
      this.tui.requestRender?.();
      return { handled: true, render: true };
    }

    // Left click handling
    if (
      (event.type === "click" || event.type === "press" || event.type === "release") &&
      (event.button === "left" || event.button === "none")
    ) {
      const height = this.getViewportHeight();

      // Top border click: scroll up / top
      if (event.y === 0) {
        if (this.scrollOffset > 0) {
          this.scrollOffset = Math.max(0, this.scrollOffset - 5);
          this.tui.requestRender?.();
        }
        return { handled: true, render: true };
      }

      // Bottom border click: scroll down / bottom
      if (event.y >= height - 1) {
        this.scrollOffset += 5;
        this.tui.requestRender?.();
        return { handled: true, render: true };
      }

      // Content row hit-testing
      const contentRow = event.y - 1 + this.scrollOffset;
      const targetLine = this.lastRenderedLines[1 + contentRow];
      if (targetLine) {
        const plain = stripTerminalSequences(targetLine);

        // Header click toggles fold
        if (plain.includes("PLUGINS")) {
          this.toggleFold("plugins");
          return { handled: true, render: true };
        }
        if (plain.includes("MCP Servers")) {
          this.toggleFold("mcp");
          return { handled: true, render: true };
        }
        if (plain.includes("Todos")) {
          this.toggleFold("todos");
          return { handled: true, render: true };
        }
        if (plain.includes("LSP")) {
          this.toggleFold("lsp");
          return { handled: true, render: true };
        }
        if (plain.includes("WORKSPACE")) {
          this.toggleFold("workspace");
          return { handled: true, render: true };
        }

        // Thinking level click
        const levels = this.state.model?.thinkLevels;
        if (levels && levels.length > 0) {
          for (const l of levels) {
            if (plain.includes(l)) {
              this.selectThinkingLevel(l);
              return { handled: true, render: true };
            }
          }
        }

        // Recent model click
        const modelMatch = plain.match(/(\d+)\.\s+(\S+)/);
        if (modelMatch && modelMatch[1]) {
          const idx = parseInt(modelMatch[1], 10) - 1;
          const recents = this.state.recentModels;
          if (recents && idx >= 0 && idx < recents.length) {
            this.selectModel(recents[idx]!.id);
            return { handled: true, render: true };
          }
        }

        // Pet section click: cycle pet
        const petVisible = this.options?.visibleSections?.pet !== false && this.state.visible?.pet !== false;
        if (petVisible) {
          const petName = this.state.pet?.name ?? DEFAULT_PET;
          const isClassic = this.state.pet?.style === "classic";
          const petRowCount = isClassic ? 2 : 5;
          if (contentRow < petRowCount || plain.includes(petName)) {
            this.cyclePet();
            return { handled: true, render: true };
          }
        }
      }

      return { handled: true, render: true };
    }

    return undefined;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.isClosed || width <= 0) return [];
    const safeWidth = Math.max(1, Math.floor(width));
    const latest = this.options?.getState?.();
    if (latest) {
      const selected = latest.pet?.name ?? DEFAULT_PET;
      if (selected !== this.state.pet?.name) {
        const index = PET_NAMES.indexOf(selected);
        this.petIndex = index < 0 ? 0 : index;
        this.rotationAnchorAt = performance.now();
      }
      this.state = latest;
    }

    const currentStatus = (this.state.pet?.status as PetStatus) ?? "idle";
    if (this.options?.visibleSections?.pet === false || this.state.visible?.pet === false) {
      motionCoordinator.unregister(this.motionSource);
    } else {
      const cadence = isBusyStatus(currentStatus) ? PET_CADENCE_BUSY : PET_CADENCE_IDLE;
      motionCoordinator.register(this.motionSource, cadence);
    }

    // Shared motion coordinator: calculate tick and rotation deterministically from elapsed time
    const elapsed = scaleElapsed(performance.now() - this.startedAt);
    const tickInterval = isBusyStatus(currentStatus) ? PET_CADENCE_BUSY : PET_CADENCE_IDLE;
    const tick = (this.state.pet?.tick ?? 0) + (isAnimationActive() ? Math.floor(elapsed / tickInterval) : 0);

    // Idle rotation every 20s if in ascii mode and animation active
    let shownPet = PET_NAMES[this.petIndex] ?? DEFAULT_PET;
    if (this.state.pet?.style !== "classic" && isAnimationActive()) {
      const rotationStep = Math.floor(scaleElapsed(performance.now() - this.rotationAnchorAt) / PET_ROTATE_EVERY);
      if (rotationStep > 0) {
        shownPet = rotatePet(shownPet, rotationStep);
      }
    }

    const mergedOptions: SidebarOptions = {
      ...this.options,
      foldedSections: this.foldedSections,
    };

    const state: SidebarState = {
      ...this.state,
      pet: this.state.pet ? { ...this.state.pet, name: shownPet, tick } : undefined,
    };

    const nativeTheme = this.ctx.ui?.theme ?? this.theme;
    const activeTheme = getActiveTheme().id === "omt-signature" ? signatureTheme(nativeTheme) : nativeTheme;
    const boxWidth = this.options?.stretchWidth ? safeWidth : Math.min(safeWidth, SIDE_W);
    const framed = renderSidebar(state, boxWidth, activeTheme, mergedOptions);
    this.lastRenderedLines = framed;

    const height = this.getViewportHeight();
    if (height < 3) return framed.slice(0, height);

    const maxOffset = Math.max(0, framed.length - height);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));

    const isPlainAscii = this.options?.plainAscii ?? false;
    const tl = isPlainAscii ? "+" : "╭";
    const tr = isPlainAscii ? "+" : "╮";
    const bl = isPlainAscii ? "+" : "╰";
    const br = isPlainAscii ? "+" : "╯";
    const hz = isPlainAscii ? "-" : "─";
    const vt = isPlainAscii ? "|" : "│";

    const fgBorder = (s: string) => {
      try {
        return (activeTheme as any)?.fg?.("border", s) ?? s;
      } catch {
        return s;
      }
    };
    const fgWarning = (s: string) => {
      try {
        return (activeTheme as any)?.fg?.("warning", s) ?? s;
      } catch {
        return s;
      }
    };

    if (framed.length <= height) {
      if (!this.shouldFillViewport()) return framed;
      const neededPadding = height - framed.length;
      if (neededPadding <= 0) return framed;

      const topBorder = framed[0]!;
      const botBorder = framed[framed.length - 1]!;
      const innerRows = framed.slice(1, -1);

      const leftEdge = fgBorder(`${vt} `);
      const rightEdge = fgBorder(` ${vt}`);
      const innerW = Math.max(0, boxWidth - 4);
      const emptyRow = `${leftEdge}${" ".repeat(innerW)}${rightEdge}`;
      const paddingRows = new Array(neededPadding).fill(emptyRow);

      if (this.options?.quitArmed && innerRows.length > 0) {
        const quitFooter = innerRows[innerRows.length - 1]!;
        const contentBefore = innerRows.slice(0, -1);
        return [topBorder, ...contentBefore, ...paddingRows, quitFooter, botBorder];
      }

      return [topBorder, ...innerRows, ...paddingRows, botBorder];
    }

    // Top border with scroll hint if scrolled down
    let topBorder = framed[0]!;
    if (this.scrollOffset > 0 && this.options?.showScrollHints !== false) {
      const hint = ` ▲ ${this.scrollOffset} above `;
      if (boxWidth >= visibleWidth(hint) + 4) {
        const fill = Math.max(0, boxWidth - 2 - visibleWidth(hint));
        const lFill = Math.floor(fill / 2);
        const rFill = fill - lFill;
        topBorder = fgBorder(`${tl}${hz.repeat(lFill)}`) + fgWarning(hint) + fgBorder(`${hz.repeat(rFill)}${tr}`);
      }
    }

    // Bottom border with scroll hint if content remains below
    let botBorder = framed[framed.length - 1]!;
    const remaining = maxOffset - this.scrollOffset;
    if (remaining > 0 && this.options?.showScrollHints !== false) {
      const hint = ` ▼ ${remaining} more `;
      if (boxWidth >= visibleWidth(hint) + 4) {
        const fill = Math.max(0, boxWidth - 2 - visibleWidth(hint));
        const lFill = Math.floor(fill / 2);
        const rFill = fill - lFill;
        botBorder = fgBorder(`${bl}${hz.repeat(lFill)}`) + fgWarning(hint) + fgBorder(`${hz.repeat(rFill)}${br}`);
      }
    }

    let visibleInner = framed.slice(1 + this.scrollOffset, height - 1 + this.scrollOffset);
    if (this.hoverRow >= 0) {
      const relHover = this.hoverRow - this.scrollOffset;
      if (relHover >= 0 && relHover < visibleInner.length) {
        visibleInner = applyHover(visibleInner, relHover, this.hoverLevel, activeTheme);
      }
    }
    return [topBorder, ...visibleInner, botBorder];
  }

  dispose(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    motionCoordinator.unregister(this.motionSource);
  }
}

/** Factory function for creating a SidebarComponent */
export function createSidebarComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager | undefined,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: SidebarComponentOptions,
): SidebarComponent {
  return new SidebarComponent(tui, theme, keybindings, done, ctx, options);
}

/**
 * Permanent 34-column full-terminal-height sidebar dock component.
 * Lazily instantiated by parent for HStack lateral dock layout.
 * Does NOT close on q or Esc (native editor keeps input focus).
 */
export class SidebarDockComponent extends SidebarComponent {
  private readonly explicitViewportHeight?: number;
  private readonly getFleetChildren?: () => readonly FleetChild[];
  private fleetMode = false;
  private fleetTab: FleetTab = "fleet";
  private fleetSelection = 0;
  private lastFleetClickX = -1;
  private lastFleetClickY = -1;
  private lastFleetClickAt = 0;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager | undefined,
    ctx: ExtensionContext,
    options?: { getState?: () => SidebarState; getFleetChildren?: () => readonly FleetChild[] } & SidebarComponentOptions,
  ) {
    super(tui, theme, keybindings, () => {}, ctx, options);
    this.explicitViewportHeight = options?.viewportHeight;
    this.getFleetChildren = options?.getFleetChildren;
  }

  protected override getViewportHeight(): number {
    if (this.explicitViewportHeight !== undefined) {
      return Math.max(1, Math.floor(this.explicitViewportHeight));
    }
    const rows = this.tui.terminal?.rows ?? 49;
    return Math.max(1, Math.floor(rows));
  }

  protected override shouldFillViewport(): boolean {
    return true;
  }

  override handleInput(data: string): void {
    // In a permanent dock alongside the editor, q and Esc belong to the editor
    // or native application commands, never closing the permanent dock.
    if (
      data === "q" ||
      data === "Q" ||
      matchesKey(data, "q") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.esc) ||
      data === "\x1b" ||
      this.keybindings?.matches?.(data, "tui.select.cancel")
    ) {
      return;
    }
    super.handleInput(data);
  }

  override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.fleetMode && event.type === "wheel") {
      const count = this.getFleetChildren?.().length ?? 0;
      const delta = event.wheelDelta ?? 0;
      if (delta !== 0) {
        this.fleetSelection = Math.max(0, Math.min(Math.max(0, count - 1), this.fleetSelection + Math.sign(delta) * Math.max(1, Math.abs(delta))));
        this.tui.requestRender?.();
      }
      return { handled: true, render: true };
    }
    if (!this.fleetMode && event.type === "move") {
      // Dock header occupies three screen rows before the inherited sidebar frame.
      // Translate back to the base component's border-relative hit-test origin.
      if (event.y < 3) {
        if (this.hoverRow !== -1) {
          this.hoverRow = -1;
          this.hoverLevel = "";
          this.tui.requestRender?.();
          return { handled: true, render: true };
        }
        return undefined;
      }
      return super.handleMouse({ ...event, y: event.y - 2 });
    }
    if (event.type !== "click" || (event.button !== "left" && event.button !== "none")) return super.handleMouse(event);
    if (event.y === 1) {
      this.fleetMode = event.x >= 16;
      if (this.fleetMode) this.fleetTab = "fleet";
      this.tui.requestRender?.();
      return { handled: true, render: true };
    }
    if (!this.fleetMode) return super.handleMouse({ ...event, y: event.y - 2 });
    if (event.y >= 6 && this.lastFleetClickX === event.x && this.lastFleetClickY === event.y
        && Date.now() - this.lastFleetClickAt <= 700) {
      this.fleetTab = "inspect";
      this.lastFleetClickAt = 0;
      this.tui.requestRender?.();
      return { handled: true, render: true };
    }
    const children = this.getFleetChildren?.() ?? [];
    const state = buildFleetDashboardState(children, "fleet", this.fleetSelection);
    const maxRows = Math.max(1, this.getViewportHeight() - 14);
    const start = Math.max(0, Math.min(state.selectedIndex - Math.floor(maxRows / 2), state.agents.length - maxRows));
    const firstAgentRow = 6 + (start > 0 ? 1 : 0);
    const index = start + event.y - firstAgentRow;
    if (index >= start && index < Math.min(state.agents.length, start + maxRows)) {
      this.fleetTab = "fleet";
      this.lastFleetClickX = event.x;
      this.lastFleetClickY = event.y;
      this.lastFleetClickAt = Date.now();
      this.fleetSelection = index;
      this.tui.requestRender?.();
      return { handled: true, render: true };
    }
    return { handled: true, render: true };
  }

  private renderDockHeader(width: number, active: "overview" | "agents" | "inspect", count: number): string[] {
    const outer = Math.min(34, Math.max(1, Math.floor(width)));
    const inner = Math.max(1, outer - 4);
    const state = this.getState();
    const activity = state.pet?.status && state.pet.status !== "idle"
      ? `${state.pet.status[0]!.toUpperCase()}${state.pet.status.slice(1)}` : "Ready";
    const elapsed = state.stats?.elapsedMs !== undefined ? ` ${fmtDur(state.stats.elapsedMs)}` : "";
    const left = "🦉 OMT";
    const right = `${activity}${elapsed}`;
    const gap = Math.max(1, inner - visibleWidth(left) - visibleWidth(right));
    let brand = `${left}${" ".repeat(gap)}${right}`;
    const activeTab = active === "overview" ? "overview" : "agents";
    const tabs = [
      { id: "overview", text: "Overview" },
      { id: "agents", text: `Agents (${count})` },
    ];
    let tabText = tabs.map(tab => {
      const label = tab.id === activeTab ? `[ ${tab.text} ]` : `  ${tab.text}  `;
      try { return tab.id === activeTab ? this.theme.bold(this.theme.fg("accent", label)) : this.theme.fg("muted", label); }
      catch { return label; }
    }).join("│");
    brand = truncateToWidth(brand, inner, "…");
    tabText = truncateToWidth(tabText, inner, "");
    let border = "│";
    let line = "─".repeat(outer - 2);
    try { border = this.theme.fg("border", border); line = this.theme.fg("border", line); }
    catch {}
    const fit = (value: string) => {
      const fitted = truncateToWidth(value, inner, "");
      return `${border} ${fitted}${" ".repeat(Math.max(0, inner - visibleWidth(fitted)))} ${border}`;
    };
    return [
      `${this.theme.fg?.("border", "╭") ?? "╭"} ${truncateToWidth(brand, inner, "")}${" ".repeat(Math.max(0, inner - visibleWidth(brand)))} ${this.theme.fg?.("border", "╮") ?? "╮"}`,
      `${border} ${tabText}${" ".repeat(Math.max(0, inner - visibleWidth(tabText)))} ${border}`,
      `${this.theme.fg?.("border", "├") ?? "├"}${line}${this.theme.fg?.("border", "┤") ?? "┤"}`,
    ];
  }

  override render(width: number): string[] {
    const children = this.getFleetChildren?.() ?? [];
    const count = children.length;
    const height = this.getViewportHeight();
    if (this.fleetMode) {
      const state = buildFleetDashboardState(children, this.fleetTab, this.fleetSelection);
      const content = renderFleetDashboardFramed(state, Math.min(34, width), this.theme, Math.max(1, height - 14));
      const header = this.renderDockHeader(width, this.fleetTab === "inspect" ? "inspect" : "agents", count);
      const body = content.slice(1, -1).slice(0, Math.max(0, height - header.length - 1));
      const border = content.at(-1) ?? "";
      return [...header, ...body, ...Array(Math.max(0, height - header.length - body.length - 1)).fill(" ".repeat(Math.max(0, width))), border];
    }
    const overview = super.render(width);
    if (overview.length < 2) return overview;
    const header = this.renderDockHeader(width, "overview", count);
    const allContentRows = overview.slice(1, -1);
    const visibleRows = Math.max(0, height - header.length - 1);
    const contentRows = this.options?.quitArmed && allContentRows.length > visibleRows
      ? [...allContentRows.slice(0, Math.max(0, visibleRows - 1)), allContentRows.at(-1)!]
      : allContentRows.slice(0, visibleRows);
    const bottom = overview.at(-1) ?? "";
    return [...header, ...contentRows, ...Array(Math.max(0, height - header.length - contentRows.length - 1)).fill(" ".repeat(Math.max(0, width))), bottom];
  }
}

/**
 * Factory function for creating a SidebarDockComponent.
 * Lazily imported by parent to mount true 34-column full-terminal-height sidebar.
 */
export function createSidebarDockComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager | undefined,
  ctx: ExtensionContext,
  options?: { getState?: () => SidebarState; getFleetChildren?: () => readonly FleetChild[] } & SidebarComponentOptions,
): SidebarDockComponent {
  return new SidebarDockComponent(tui, theme, keybindings, ctx, options);
}

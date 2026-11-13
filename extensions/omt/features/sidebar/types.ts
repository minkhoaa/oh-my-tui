import type { Theme, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Pet animation display state. */
export type PetStatus = "idle" | "thinking" | "writing" | "working" | "success" | "error";

/** A named pet with 2 normalized frames (rest [0] and movement/blink [1]). */
export interface PetDefinition {
  name: string;
  frames: [string[], string[]];
}

/** Timing and dimension constants for OMT sidebar & pets. */
export interface SidebarConfig {
  sideW: 34;
  sideInnerW: 30;
  artRows: 4;
  defaultPet: string;
  animCycle: number;
  animCycleBusy: number;
  animBlinkFrom: number;
}

export interface SidebarSessionState {
  id?: string;
  name?: string;
  filePath?: string;
  firstPrompt?: string;
  startedAt?: Date | string;
  status?: string;
}

export interface SidebarModelState {
  label: string;
  id?: string;
  provider?: string;
  thinkLevel?: string;
  thinkLevels?: string[];
}

export interface SidebarContextState {
  percent?: number | null;
  tokens?: number | null;
  contextWindow?: number;
  autoCompact?: boolean;
}

export interface SidebarStatsState {
  inTokens: number;
  outTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  userMessages: number;
  assistantMessages: number;
  totalMessages: number;
  cost?: number;
  elapsedMs?: number;
  lastDurationMs?: number;
  lastSpeed?: number;
}

export interface SidebarToolItem {
  id?: string;
  name: string;
  status: "done" | "error" | "running";
}

export interface SidebarWorkspaceFile {
  path: string;
  add: number;
  del: number;
}

export interface SidebarWorkspaceState {
  cwd: string;
  branch?: string;
  files?: SidebarWorkspaceFile[];
  moreFiles?: number;
  untracked?: number;
  ok?: boolean;
}

export interface SidebarPetState {
  name: string;
  status: PetStatus;
  tick?: number;
  since?: Date | number;
  style?: "ascii" | "classic";
}

export interface SidebarRecentModel {
  id: string;
  modelId?: string;
  label?: string;
  isCurrent?: boolean;
}

export interface SidebarCommandsState {
  ext: number;
  prompt: number;
  skill: number;
  builtin?: number;
  queueSteer?: number;
  queueFollow?: number;
}

export interface SidebarCostItem {
  key: string;
  cost: number;
}

export interface SidebarSectionItem {
  label: string;
  detail?: string;
  // MCP rich status fields
  name?: string;
  connected?: boolean;
  disabled?: boolean;
  direct?: number;
  total?: number;
  tokens?: number;
  // Subagents rich status fields
  status?: string;
  elapsed?: string;
  statusLabel?: string;
  // LSP rich diagnostics fields
  kind?: "file" | "diag" | "summary";
  file?: string;
  errs?: number;
  warns?: number;
  line?: number;
  col?: number;
  severity?: string;
  source?: string;
  code?: string;
  message?: string;
}

export interface SidebarState {
  session?: SidebarSessionState;
  model?: SidebarModelState;
  context?: SidebarContextState;
  stats?: SidebarStatsState;
  tools?: SidebarToolItem[];
  workspace?: SidebarWorkspaceState;
  pet?: SidebarPetState;
  recentModels?: SidebarRecentModel[];
  commands?: SidebarCommandsState;
  costBreakdown?: SidebarCostItem[];
  todos?: SidebarSectionItem[];
  lsp?: SidebarSectionItem[];
  skills?: SidebarSectionItem[];
  mcp?: SidebarSectionItem[];
  plugins?: SidebarSectionItem[];
  subagents?: SidebarSectionItem[];
  visible?: SidebarSectionsVisibility;
  folds?: SidebarFolds;
}

export interface SidebarSectionsVisibility {
  pet?: boolean;
  session?: boolean;
  model?: boolean;
  stats?: boolean;
  cost?: boolean;
  recent?: boolean;
  commands?: boolean;
  tools?: boolean;
  workspace?: boolean;
  todos?: boolean;
  lsp?: boolean;
  skills?: boolean;
  mcp?: boolean;
  plugins?: boolean;
  subagents?: boolean;
}

/** Fold state for collapsible sidebar sections (▸ folded / ▾ open) */
export interface SidebarFolds {
  plugins?: boolean;
  mcp?: boolean;
  todos?: boolean;
  lsp?: boolean;
  workspace?: boolean;
}

export interface SidebarOptions {
  visibleSections?: SidebarSectionsVisibility;
  foldedSections?: SidebarFolds;
  quitArmed?: boolean;
  interactive?: boolean;
  plainAscii?: boolean;
  viewportHeight?: number;
  fillViewport?: boolean;
  showScrollHints?: boolean;
  fixedWidth?: boolean;
  stretchWidth?: boolean;
  onSelectModel?: (modelId: string) => void | Promise<void>;
  onSelectThinkingLevel?: (level: string) => void | Promise<void>;
  onSelectPet?: (petNameOrStyle: string) => void | Promise<void>;
  onCyclePet?: (petName: string) => void;
  onToggleFold?: (sectionKey: string, folded: boolean) => void;
  onToggleSection?: (sectionKey: string, visible: boolean) => void;
}

export interface SidebarControl {
  on(ctx: ExtensionContext): string;
  off(ctx: ExtensionContext): string;
  toggle(ctx: ExtensionContext): string;
  isEnabled(): boolean;
  getState(ctx: ExtensionContext): SidebarState;
  observe?(type: string, event?: unknown): void;
  render(state?: SidebarState, width?: number, theme?: Theme, options?: SidebarOptions): string[];
  cleanup?(ctx?: ExtensionContext): void;
  setDocked?(docked: boolean, ctx?: ExtensionContext): void;
}

export type { PetPureState, PetAction } from "./pet.ts";

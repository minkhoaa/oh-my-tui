/**
 * Types and interfaces for OMT Dialog Toolkit.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

// -----------------------------------------------------------------------------
// Settings Hub (14 Sections)
// -----------------------------------------------------------------------------

export const PSEC_IDS = [
  "agent",
  "command",
  "shortcut",
  "skill",
  "prompt",
  "extension",
  "plugin",
  "market",
  "mcp",
  "tool",
  "tasks",
  "side",
  "theme",
  "login",
] as const;

export type PsecId = typeof PSEC_IDS[number];

export interface PsecSectionMeta {
  id: PsecId;
  label: string;
  badge?: number | string;
  hint: string;
}

export interface PsecRowItem {
  id?: string;
  label: string;
  desc?: string;
  payload?: string;
  badge?: string;
  count?: number;
  disabled?: boolean;
  isCurrent?: boolean;
  installed?: boolean;
  suggested?: boolean;
  stars?: number;
}

export interface SettingsHubOptions {
  initialSection?: PsecId;
  /** Missing native inventories are unknown, not observed empty lists. */
  unavailableSections?: Partial<Record<PsecId, string>>;
  sections?: Partial<Record<PsecId, PsecRowItem[]>>;
  commands?: Array<{ name: string; description: string; source?: string; tag?: string }>;
  shortcuts?: Array<{ key: string; description: string; category?: string; command?: string }>;
  skills?: Array<{ name: string; description: string }>;
  prompts?: Array<{ name: string; description: string }>;
  extensions?: Array<{ name: string; description: string; tag?: string }>;
  plugins?: Array<{ name: string; spec: string; description?: string; suggested?: boolean; busy?: boolean }>;
  marketplace?: Array<{ name: string; version?: string; desc: string; stars?: number; installed?: boolean }>;
  marketLoading?: boolean;
  marketError?: string;
  mcpServers?: Array<{
    name: string;
    status: "connected" | "disabled" | "disconnected";
    tokens?: number;
    direct?: number;
    total?: number;
  }>;
  toolStats?: Array<{ name: string; count: number; durationMs?: number; errors?: number }>;
  taskSettings?: Array<{ key: string; label: string; value: string; values: string[] }>;
  sidebarSections?: Array<{ key: string; label: string; visible: boolean }>;
  palettes?: string[];
  backgrounds?: string[];
  currentTheme?: string;
  currentBackground?: string;
  onDelegateCommand?: (cmd: string) => void;
  onToggleSideSection?: (sectionKey: string) => void;
  onCycleTaskSetting?: (key: string, nextValue: string) => void;
  onSelectTheme?: (themeName: string) => void;
  onSelectBackground?: (bgName: string) => void;
  onInstallPlugin?: (spec: string) => Promise<void> | void;
  onUninstallPlugin?: (spec: string) => Promise<void> | void;
  onSearchMarketplace?: (query: string) => Promise<void> | void;
  onAssignShortcut?: (command: string) => void;
}

// -----------------------------------------------------------------------------
// Model Picker & Spec
// -----------------------------------------------------------------------------

export interface ModelSpec {
  id: string;
  name?: string;
  provider: string;
  providerLabel?: string;
  api?: string;
  baseUrl?: string;
  contextWindow?: number;
  maxTokens?: number;
  costInput?: number;
  costOutput?: number;
  costCacheRead?: number;
  costCacheWrite?: number;
  thinking?: boolean | { maxTokens?: number };
  inputModalities?: string[];
  keyStatus?: "ready" | "missing" | "unneeded";
  isFavorite?: boolean;
  favoriteKey?: string;
  isRecent?: boolean;
  lastUsed?: number;
}

export interface ModelPickerOptions {
  models: ModelSpec[];
  recentModelIds?: string[];
  favoriteModelIds?: string[];
  currentModelId?: string;
  currentModelProvider?: string;
  onSelectModel: (model: ModelSpec) => void;
  onToggleFavorite?: (modelId: string, isFav: boolean) => void;
}

// -----------------------------------------------------------------------------
// Theme & Background Selectors
// -----------------------------------------------------------------------------

export interface ThemeItem {
  id: string;
  name: string;
  accent?: string;
  light?: boolean;
  isCurrent?: boolean;
}

export interface BackgroundItem {
  id: string;
  name: string;
  hex?: string;
  isCurrent?: boolean;
}

export interface ThemePickerOptions {
  themes: ThemeItem[];
  backgrounds: BackgroundItem[];
  currentTheme?: string;
  currentBackground?: string;
  onPreviewTheme?: (themeId: string) => void;
  onSelectTheme: (themeId: string) => void;
  onSelectBackground: (backgroundId: string) => void;
}

// -----------------------------------------------------------------------------
// Pet Selector
// -----------------------------------------------------------------------------

export interface PetItem {
  id: string;
  name: string;
  label?: string;
  art: string[];
  isCurrent?: boolean;
}

export interface PetSelectorOptions {
  pets: PetItem[];
  currentPet?: string;
  onSelectPet: (petId: string) => void;
  onPreviewPet?: (petId: string) => void;
}

// -----------------------------------------------------------------------------
// Sessions / Resume Dialog
// -----------------------------------------------------------------------------

export interface ResumeSessionItem {
  id: string;
  path: string;
  title: string;
  messageCount: number;
  modified: number | Date;
  cwd?: string;
  firstMessage?: string;
  isCurrent?: boolean;
}

export interface ResumeDialogOptions {
  sessions: ResumeSessionItem[];
  scope?: "current" | "all";
  currentSessionId?: string;
  onSelectSession: (session: ResumeSessionItem) => void;
  onDeleteSession?: (session: ResumeSessionItem) => Promise<boolean> | boolean;
  onScopeChange?: (scope: "current" | "all") => void;
}

// -----------------------------------------------------------------------------
// Tree Explorer & Summary Dialog
// -----------------------------------------------------------------------------

export interface OmtTreeNode {
  id: string;
  parentId: string | null;
  /** Native entry kind, retained so default/all views can distinguish bookkeeping. */
  entryType?: string;
  label?: string;
  summary?: string;
  role?: "user" | "assistant" | "tool" | "system";
  timestamp?: number | string;
  children?: string[];
  isFolded?: boolean;
  isCurrent?: boolean;
  isLeaf?: boolean;
}


export type TreeFilterMode = "default" | "no-tools" | "user-only" | "labeled-only" | "all";
export type TreeSummaryChoice = "keep" | "summarize" | "custom";

export interface OmtTreeDialogOptions {
  nodes: OmtTreeNode[];
  currentNodeId?: string;
  onJumpToNode: (nodeId: string) => void;
  onForkNode?: (nodeId: string) => void;
  onSetLabel?: (nodeId: string, label: string) => void;
  onBranchSummary?: (choice: TreeSummaryChoice, customText?: string) => void;
}


// -----------------------------------------------------------------------------
// Trajectory / Trace Steps & Live Snapshot
// -----------------------------------------------------------------------------

export interface TraceStep {
  id: string;
  index: number;
  timestamp: number | string;
  kind: "user" | "assistant" | "tool" | "error";
  title: string;
  detail: string;
  toolName?: string;
  durationMs?: number;
}

export interface TrajectoryDialogOptions {
  steps: TraceStep[];
  liveMode?: boolean;
  onSelectStep?: (step: TraceStep) => void;
  onCopyStep?: (step: TraceStep) => void;
}

// -----------------------------------------------------------------------------
// Notification History
// -----------------------------------------------------------------------------

export interface OmtNotificationItem {
  id: string;
  timestamp: number;
  level: "info" | "warning" | "error" | "success";
  text: string;
  read?: boolean;
}


export interface OmtNotificationOptions {
  items: OmtNotificationItem[];
  onClear?: () => void;
  onMarkRead?: (id: string) => void;
  onCopyNotification?: (item: OmtNotificationItem) => void;
}


// -----------------------------------------------------------------------------
// Semantic Block Copy Actions
// -----------------------------------------------------------------------------

export interface BlockSemanticContent {
  markdown: string;
  codeBlocks: string[];
  tables: string[];
  plain: string;
}

export type BlockActionKind = "md" | "code" | "tables" | "plain";

export interface BlockActionOption {
  kind: BlockActionKind;
  label: string;
  content: string;
}

export interface BlockActionsDialogOptions {
  content: BlockSemanticContent;
  turnIndex?: number;
  onExecuteAction: (kind: BlockActionKind, copiedText: string) => void;
}

// -----------------------------------------------------------------------------
// Fixed Window and Geometry Types
// -----------------------------------------------------------------------------

export interface FixedWindowResult {
  start: number;
  end: number;
  hasAbove: boolean;
  hasBelow: boolean;
}

export interface DialogGeometry {
  boxW: number;
  leftW: number;
  rightW: number;
  detW?: number;
  winH: number;
  contentW: number;
}

// -----------------------------------------------------------------------------
// Generic Factory
// -----------------------------------------------------------------------------

export type OmtDialogFactory<TOptions> = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options: TOptions,
) => Component;

import type { SidebarSectionItem } from "../sidebar/types.ts";

// --- Tasks / Todos ---

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  readonly id: string;
  readonly content: string;
  readonly status: TodoStatus;
  readonly subAction?: string;
  readonly blockedBy?: readonly string[];
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

export type TaskSortOrder = "id" | "status" | "active" | "recent" | "oldest";

export interface TaskDisplaySettings {
  readonly sortOrder?: TaskSortOrder;
  readonly collapseCompleted?: boolean;
  readonly showAll?: boolean;
  readonly maxVisible?: number;
  readonly hiddenAt?: "top" | "bottom";
}

export interface TaskSnapshot {
  readonly items: readonly TodoItem[];
  readonly total: number;
  readonly completedCount: number;
  readonly inProgressCount: number;
  readonly pendingCount: number;
  readonly activeTaskId?: string;
  readonly stale: boolean;
  readonly empty: boolean;
  readonly lastToolName?: string;
  readonly lastUpdatedAt?: number;
  readonly lastError?: string;
}

// --- LSP Diagnostics ---

export type LspSeverity = "error" | "warning" | "info" | "hint" | "diagnostic";

export interface LspDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly severity: LspSeverity;
  readonly source?: string;
  readonly code?: string;
  readonly message: string;
}

export interface LspFileGroup {
  readonly file: string;
  readonly diagnostics: readonly LspDiagnostic[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly hintCount: number;
}

export interface LspStatusReason {
  readonly server?: string;
  readonly clean: boolean;
  readonly skipped: readonly string[];
  readonly note?: string;
  readonly rawSummary?: string;
}

export interface LspSnapshot {
  readonly files: readonly LspFileGroup[];
  readonly totalErrors: number;
  readonly totalWarnings: number;
  readonly totalOther: number;
  readonly status?: LspStatusReason;
  readonly statusSummary: string;
  readonly empty: boolean;
  readonly rawOutput?: string;
}

// --- Skills ---

export type SkillProvenanceSource = "user-command" | "model-read" | "delegated";

export interface LoadedSkill {
  readonly name: string;
  readonly path?: string;
  readonly description?: string;
  readonly source: SkillProvenanceSource;
  readonly knownCatalog: boolean;
  readonly loadTimestamp?: number;
}

export interface SkillsSnapshot {
  readonly skills: readonly LoadedSkill[];
  readonly totalCount: number;
  readonly empty: boolean;
}

// --- Packages vs Plugins ---

export interface ConfiguredPackage {
  readonly spec: string;
  readonly name: string;
  readonly status: "configured";
  readonly detail: string;
}

export interface LoadedPlugin {
  readonly name: string;
  readonly source: "extension" | "builtin";
  readonly status: "loaded";
  readonly commandCount?: number;
  readonly detail: string;
}

export interface PluginsSnapshot {
  readonly configuredPackages: readonly ConfiguredPackage[];
  readonly loadedPlugins: readonly LoadedPlugin[];
  readonly empty: boolean;
}

// --- MCP Servers ---

export type McpConnectionState = "connected" | "disconnected" | "registered_only" | "unknown";

export interface McpServerItem {
  readonly name: string;
  readonly connectionState: McpConnectionState;
  readonly detail: string;
  readonly directTools?: number;
  readonly totalTools?: number;
  readonly disabled?: boolean;
}

export interface McpSnapshot {
  readonly servers: readonly McpServerItem[];
  readonly connectedCount: number;
  readonly registeredCount: number;
  readonly empty: boolean;
}

// --- Subagents / Team ---

export type SubagentStatus = "pending" | "running" | "completed" | "failed" | "aborted" | "stalled";

export interface SubagentItem {
  readonly id: string;
  readonly name: string;
  readonly agentName?: string;
  readonly task: string;
  readonly tool: string;
  readonly status: SubagentStatus;
  readonly statusLabel?: string;
  readonly turns?: number;
  readonly cost?: number;
  readonly errorMessage?: string;
  readonly resultSummary?: string;
  readonly startedAt?: number;
  readonly updatedAt?: number;
  readonly isError: boolean;
}

export interface SubagentSnapshot {
  readonly items: readonly SubagentItem[];
  readonly runningCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly empty: boolean;
}

// --- State and Options ---

export interface OmtAdapterState {
  readonly todos: TaskSnapshot;
  readonly lsp: LspSnapshot;
  readonly skills: SkillsSnapshot;
  readonly plugins: PluginsSnapshot;
  readonly mcp: McpSnapshot;
  readonly subagents: SubagentSnapshot;
  readonly generation: number;
  readonly lastObservedAt: number;
}


export interface ReconstructionOptions {
  readonly taskDisplay?: TaskDisplaySettings;
  readonly maxTodosVisible?: number;
  readonly maxLspRows?: number;
  readonly maxSkillsVisible?: number;
  readonly maxSubagentsVisible?: number;
}

export interface AdapterSectionItems {
  readonly todos?: SidebarSectionItem[];
  readonly lsp?: SidebarSectionItem[];
  readonly skills?: SidebarSectionItem[];
  readonly mcp?: SidebarSectionItem[];
  readonly plugins?: SidebarSectionItem[];
  readonly subagents?: SidebarSectionItem[];
}

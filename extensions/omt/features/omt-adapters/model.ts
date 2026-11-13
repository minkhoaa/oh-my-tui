import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { resolve } from "node:path";
import type { SidebarSectionItem } from "../sidebar/types.ts";
import type {
  ConfiguredPackage,
  LoadedPlugin,
  LoadedSkill,
  LspDiagnostic,
  LspFileGroup,
  LspSeverity,
  LspSnapshot,
  LspStatusReason,
  McpConnectionState,
  McpServerItem,
  McpSnapshot,
  PluginsSnapshot,
  SkillProvenanceSource,
  SkillsSnapshot,
  SubagentItem,
  SubagentSnapshot,
  SubagentStatus,
  TaskDisplaySettings,
  TaskSnapshot,
  TaskSortOrder,
  TodoItem,
  TodoStatus,
} from "./types.ts";

// --- Sanitization & Helpers ---

export function sanitizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return stripTerminalSequences(value).replace(/[\x00-\x1f\x7f]/g, " ").trim();
}

export function truncateString(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, Math.max(0, maxLen - 1)) + "…";
}

// --- Task / Todo Modeling ---

export function normalizeTodoStatus(raw: unknown): TodoStatus {
  if (typeof raw === "string") {
    const s = raw.toLowerCase().replace(/[-_\s]+/g, "_").trim();
    if (["in_progress", "active", "inprogress", "working", "started", "running"].includes(s)) {
      return "in_progress";
    }
    if (["completed", "done", "complete", "finished"].includes(s)) {
      return "completed";
    }
    return "pending";
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.done === true || obj.completed === true) return "completed";
    if (obj.in_progress === true || obj.active === true) return "in_progress";
    if (typeof obj.status === "string") return normalizeTodoStatus(obj.status);
  }
  return "pending";
}

export function parseTodoContent(m: Record<string, unknown>): string {
  for (const k of ["content", "text", "title", "subject", "name", "label"]) {
    const val = sanitizeText(m[k]);
    if (val) return val;
  }
  return "";
}

/**
 * Parses TaskList text (e.g. from pi-tasks: "#1 [pending] subject [blocked by #2]").
 */
export function parseTodoLines(text: string): TodoItem[] {
  const items: TodoItem[] = [];
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    let rest = rawLine.trim();
    if (!rest) continue;
    if (rest.startsWith("#")) rest = rest.slice(1).trim();
    let i = 0;
    while (i < rest.length && rest[i] >= "0" && rest[i] <= "9") i++;
    if (i === 0) continue;
    const id = rest.slice(0, i);
    rest = rest.slice(i).trim().replace(/^[.):]+/, "").trim();

    let status: TodoStatus = "pending";
    let content = rest;
    const bracketStart = content.indexOf("[");
    if (bracketStart >= 0) {
      const bracketEnd = content.indexOf("]", bracketStart);
      if (bracketEnd >= 0) {
        status = normalizeTodoStatus(content.slice(bracketStart + 1, bracketEnd));
        const after = content.slice(bracketEnd + 1).trim();
        if (after) content = after;
      }
    }

    const blockedIdx = content.indexOf(" [blocked by");
    let blockedBy: string[] | undefined;
    if (blockedIdx >= 0) {
      const blockedPart = content.slice(blockedIdx);
      content = content.slice(0, blockedIdx).trim();
      const matches = blockedPart.match(/#(\d+)/g);
      if (matches) blockedBy = matches.map((m) => m.slice(1));
    }

    if (!content) continue;
    items.push({ id, content, status, blockedBy });
  }
  return items;
}

export function parseTodosFromPayload(raw: unknown): TodoItem[] | undefined {
  if (!raw) return undefined;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "null") return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      return parseTodosFromPayload(parsed);
    } catch {
      const lines = parseTodoLines(trimmed);
      return lines.length > 0 ? lines : undefined;
    }
  }

  if (typeof raw !== "object") return undefined;

  let arr: unknown[] | undefined;
  if (Array.isArray(raw)) {
    arr = raw;
  } else {
    const obj = raw as Record<string, unknown>;
    for (const key of ["todos", "todoList", "items", "list", "tasks"]) {
      if (Array.isArray(obj[key])) {
        arr = obj[key] as unknown[];
        break;
      }
    }
  }

  if (!Array.isArray(arr) || arr.length === 0) return undefined;

  const result: TodoItem[] = [];
  for (let i = 0; i < arr.length; i++) {
    const entry = arr[i];
    if (!entry || typeof entry !== "object") continue;
    const m = entry as Record<string, unknown>;

    // Skip message or block wrappers
    const t = String(m.type ?? "").toLowerCase().replace(/_/g, "");
    if (["text", "thinking", "image", "toolcall", "toolresult"].includes(t)) continue;

    const content = parseTodoContent(m);
    if (!content) continue;

    let id = String(i + 1);
    if (typeof m.id === "string" && m.id.trim()) {
      id = m.id.trim();
    } else if (typeof m.id === "number") {
      id = String(m.id);
    }

    const subAction = sanitizeText(m.subAction ?? m.activeForm) || undefined;
    let blockedBy: string[] | undefined;
    if (Array.isArray(m.blockedBy)) {
      blockedBy = m.blockedBy.map((b) => String(b).replace(/^#/, "")).filter(Boolean);
    }

    const createdAt = typeof m.createdAt === "number" ? m.createdAt : undefined;
    const updatedAt = typeof m.updatedAt === "number" ? m.updatedAt : undefined;

    result.push({
      id,
      content,
      status: normalizeTodoStatus(m),
      subAction,
      blockedBy,
      createdAt,
      updatedAt,
    });
  }

  return result.length > 0 ? result : undefined;
}

export function orderTasks(tasks: readonly TodoItem[], order: TaskSortOrder = "id"): TodoItem[] {
  const out = [...tasks];
  const rank = (s: TodoStatus): number => {
    switch (s) {
      case "in_progress":
        return 0;
      case "pending":
        return 1;
      case "completed":
        return 2;
    }
  };

  switch (order) {
    case "status":
      // Completed items first
      out.sort((a, b) => (2 - rank(a.status)) - (2 - rank(b.status)));
      break;
    case "active":
      out.sort((a, b) => rank(a.status) - rank(b.status));
      break;
    case "recent":
      out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      break;
    case "oldest":
      out.sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
      break;
    case "id":
    default: {
      out.sort((a, b) => {
        const numA = Number(a.id);
        const numB = Number(b.id);
        if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
          return numA - numB;
        }
        return a.id.localeCompare(b.id);
      });
      break;
    }
  }

  return out;
}

export function collapseCompletedTasks(
  tasks: readonly TodoItem[],
  collapse: boolean,
): { kept: TodoItem[]; completedCount: number } {
  if (!collapse) {
    return { kept: [...tasks], completedCount: 0 };
  }
  const kept: TodoItem[] = [];
  let completedCount = 0;
  for (const t of tasks) {
    if (t.status === "completed") {
      completedCount++;
    } else {
      kept.push(t);
    }
  }
  return { kept, completedCount };
}

export function formatBlockedSuffix(allTasks: readonly TodoItem[], item: TodoItem): string {
  if (item.status !== "pending" || !item.blockedBy || item.blockedBy.length === 0) {
    return "";
  }
  const statusById = new Map<string, TodoStatus>(allTasks.map((t) => [t.id, t.status]));
  const openBlockers = item.blockedBy.filter((id) => statusById.get(id) !== "completed");
  if (openBlockers.length === 0) return "";
  return ` › blocked by ${openBlockers.map((id) => `#${id}`).join(", ")}`;
}

export function buildTaskSnapshot(
  items: readonly TodoItem[],
  options?: {
    lastToolName?: string;
    lastUpdatedAt?: number;
    lastError?: string;
    settings?: TaskDisplaySettings;
  },
): TaskSnapshot {
  let completedCount = 0;
  let inProgressCount = 0;
  let pendingCount = 0;
  let activeTaskId: string | undefined;
  let maxActiveUpdated = -1;

  for (const item of items) {
    switch (item.status) {
      case "completed":
        completedCount++;
        break;
      case "in_progress":
        inProgressCount++;
        if ((item.updatedAt ?? 0) >= maxActiveUpdated) {
          maxActiveUpdated = item.updatedAt ?? 0;
          activeTaskId = item.id;
        }
        break;
      case "pending":
        pendingCount++;
        break;
    }
  }

  return {
    items,
    total: items.length,
    completedCount,
    inProgressCount,
    pendingCount,
    activeTaskId,
    stale: false,
    empty: items.length === 0,
    lastToolName: options?.lastToolName,
    lastUpdatedAt: options?.lastUpdatedAt,
    lastError: options?.lastError,
  };
}

export function taskSnapshotToSectionItems(
  snapshot: TaskSnapshot,
  settings?: TaskDisplaySettings,
): SidebarSectionItem[] {
  if (snapshot.empty) return [];

  const ordered = orderTasks(snapshot.items, settings?.sortOrder ?? "id");
  const { kept, completedCount } = collapseCompletedTasks(ordered, settings?.collapseCompleted ?? false);

  const maxRows = Math.min(100, Math.max(5, settings?.maxVisible ?? 10));
  let displayed = kept;
  let hidden = 0;
  const fromTop = settings?.hiddenAt === "top";

  if (!settings?.showAll && kept.length > maxRows) {
    hidden = kept.length - maxRows;
    displayed = fromTop ? kept.slice(hidden) : kept.slice(0, maxRows);
  }

  const result: SidebarSectionItem[] = [];

  if (fromTop && hidden > 0) {
    result.push({ label: `… and ${hidden} more` });
  }

  for (const item of displayed) {
    const glyph = item.status === "completed" ? "✓" : item.status === "in_progress" ? "●" : "○";
    const label = `${glyph} ${item.content}`;
    const blocked = formatBlockedSuffix(snapshot.items, item);
    let detail = item.subAction;
    if (blocked) {
      detail = detail ? `${detail} ${blocked}` : blocked.trim();
    }
    const sectionItem: SidebarSectionItem = {
      label,
      detail: detail || undefined,
    };
    result.push(sectionItem);
  }

  if (!fromTop && hidden > 0) {
    result.push({ label: `… and ${hidden} more` });
  }

  if (completedCount > 0) {
    result.push({ label: `✓ ${completedCount} completed` });
  }

  return result;
}

// --- LSP Diagnostics Modeling ---

const lspSummaryHeader = /^(\S+) LSP diagnostics: \d+ diagnostic\(s\) across \d+ file\(s\)\.$/;
const lspSkippedLine = /^Skipped unavailable default LSP server\(s\):\s*(.+?)\.?$/;
const lspNotFoundLine = /^(\S+) LSP command not found:\s*(\S+)/;
const lspDiagLine = /^(.+?):(\d+)(?::(\d+))?:?\s+(error|warning|info|hint|diagnostic):?\s*(.+)$/i;

const lspSeverityRank: Record<LspSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
  diagnostic: 4,
};

export function parseLspDiagnostics(output: string): {
  diagnostics: LspDiagnostic[];
  status: LspStatusReason;
  rawLines: string[];
} {
  const diagnostics: LspDiagnostic[] = [];
  const rawLines: string[] = [];
  let server: string | undefined;
  let clean = false;

  const skippedServers: string[] = [];
  let note: string | undefined;

  for (let rawLine of output.split(/\r?\n/)) {
    rawLine = rawLine.replace(/\r$/, "");
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed === "---") continue;

    const summaryMatch = lspSummaryHeader.exec(trimmed);
    if (summaryMatch) {
      server = summaryMatch[1];
      clean = true;
      continue;
    }

    const skippedMatch = lspSkippedLine.exec(trimmed);
    if (skippedMatch) {
      for (const s of skippedMatch[1].split(",")) {
        const item = s.trim();
        if (item) skippedServers.push(item);
      }
      continue;
    }

    if (lspNotFoundLine.test(trimmed)) {
      if (!note) note = trimmed;
      continue;
    }

    if (trimmed.endsWith(": no diagnostics")) {
      clean = true;
      continue;
    }

    const diagMatch = lspDiagLine.exec(rawLine);
    if (diagMatch) {
      const file = diagMatch[1].trim();
      const line = Number(diagMatch[2]);
      const col = diagMatch[3] ? Number(diagMatch[3]) : 0;
      const severity = diagMatch[4].toLowerCase() as LspSeverity;
      const rest = diagMatch[5];

      let head = rest;
      let message = "";
      const colonIdx = rest.indexOf(": ");
      if (colonIdx >= 0) {
        head = rest.slice(0, colonIdx);
        message = rest.slice(colonIdx + 2).trim();
      } else {
        message = rest.trim();
      }

      const fields = head.trim().split(/\s+/);
      const source = fields[0] || undefined;
      const code = fields.length > 1 ? fields.slice(1).join(" ") : undefined;

      diagnostics.push({
        file,
        line,
        col,
        severity,
        source: message ? source : undefined,
        code: message ? code : undefined,
        message: message || head,
      });
      continue;
    }

    rawLines.push(trimmed);
    if (!note) {
      note = trimmed;
    }
  }

  return {
    diagnostics,
    status: {
      server,
      clean,
      skipped: skippedServers,
      note,
    },
    rawLines,
  };
}

export function groupLspDiagnostics(diagnostics: readonly LspDiagnostic[]): LspFileGroup[] {
  const byFile = new Map<string, LspDiagnostic[]>();
  for (const d of diagnostics) {
    const list = byFile.get(d.file) ?? [];
    list.push(d);
    byFile.set(d.file, list);
  }

  const groups: LspFileGroup[] = [];
  for (const [file, rows] of byFile.entries()) {
    rows.sort((a, b) => {
      const ra = lspSeverityRank[a.severity] ?? 4;
      const rb = lspSeverityRank[b.severity] ?? 4;
      if (ra !== rb) return ra - rb;
      if (a.line !== b.line) return a.line - b.line;
      if (a.col !== b.col) return a.col - b.col;
      return a.message.localeCompare(b.message);
    });

    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    let hintCount = 0;

    for (const r of rows) {
      if (r.severity === "error") errorCount++;
      else if (r.severity === "warning") warningCount++;
      else if (r.severity === "info") infoCount++;
      else hintCount++;
    }

    groups.push({
      file,
      diagnostics: rows,
      errorCount,
      warningCount,
      infoCount,
      hintCount,
    });
  }

  groups.sort((a, b) => {
    if (a.errorCount !== b.errorCount) return b.errorCount - a.errorCount;
    if (a.warningCount !== b.warningCount) return b.warningCount - a.warningCount;
    return a.file.localeCompare(b.file);
  });

  return groups;
}

export function buildLspSnapshot(output?: string): LspSnapshot {
  if (!output || !output.trim()) {
    return {
      files: [],
      totalErrors: 0,
      totalWarnings: 0,
      totalOther: 0,
      statusSummary: "",
      empty: true,
      rawOutput: output,
    };
  }

  const { diagnostics, status, rawLines } = parseLspDiagnostics(output);
  const files = groupLspDiagnostics(diagnostics);

  let totalErrors = 0;
  let totalWarnings = 0;
  let totalOther = 0;

  for (const f of files) {
    totalErrors += f.errorCount;
    totalWarnings += f.warningCount;
    totalOther += f.infoCount + f.hintCount;
  }

  let statusSummary = "";
  if (status.skipped.length > 0 && status.note) {
    statusSummary = status.note.replace(/\.+$/, "");
  } else if (status.skipped.length > 0) {
    statusSummary = `no LSP server available (${status.skipped.length} skipped)`;
  } else if (status.note) {
    statusSummary = status.note;
  } else if (status.clean && status.server) {
    statusSummary = `${status.server} clean`;
  }

  return {
    files,
    totalErrors,
    totalWarnings,
    totalOther,
    status,
    statusSummary,
    empty: files.length === 0 && !statusSummary && rawLines.length === 0,
    rawOutput: output,
  };
}

export function lspSnapshotToSectionItems(
  snapshot: LspSnapshot,
  maxRows: number = 20,
): SidebarSectionItem[] {
  if (snapshot.empty) return [];

  const items: SidebarSectionItem[] = [];

  if (snapshot.files.length === 0) {
    if (snapshot.statusSummary) {
      items.push({ label: snapshot.statusSummary, errs: snapshot.totalErrors, warns: snapshot.totalWarnings });
    } else if (snapshot.rawOutput) {
      for (const line of snapshot.rawOutput.split(/\r?\n/).filter((l) => l.trim())) {
        items.push({ label: line.trim(), errs: snapshot.totalErrors, warns: snapshot.totalWarnings });
      }
    }
    return items;
  }

  for (const group of snapshot.files) {
    if (items.length >= maxRows) break;
    items.push({
      kind: "file",
      label: group.file,
      file: group.file,
      errs: group.errorCount,
      warns: group.warningCount,
    });
    for (const d of group.diagnostics) {
      if (items.length >= maxRows) {
        items.push({
          label: `… +${snapshot.totalErrors + snapshot.totalWarnings + snapshot.totalOther - maxRows} more`,
          errs: snapshot.totalErrors,
          warns: snapshot.totalWarnings,
        });
        return items;
      }
      const pos = d.col > 0 ? `${d.file}:${d.line}:${d.col}` : `${d.file}:${d.line}`;
      const label = `${pos} ${d.severity}: ${d.message}`;
      const sectionItem: SidebarSectionItem = {
        kind: "diag",
        label,
        file: d.file,
        line: d.line,
        col: d.col,
        severity: d.severity,
        source: d.source,
        code: d.code,
        message: d.message,
        errs: snapshot.totalErrors,
        warns: snapshot.totalWarnings,
      };
      if (d.source) sectionItem.detail = d.source + (d.code ? ` (${d.code})` : "");
      items.push(sectionItem);
    }
  }

  return items;
}

// --- Skills Modeling ---

export const skillFile = "SKILL.md";
export const skillSlugRe = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const skillBlockRe = /^<skill name="([^"]+)"(?: location="([^"]*)")?/m;

export function cleanSkillPath(p: string): string {
  let cleaned = p.trim().replace(/\\/g, "/");
  if (!cleaned) return "";

  // Cut trailing grep :line or :line:col
  cleaned = cleaned.replace(/:\d+(?::\d+)?$/, "");
  cleaned = cleaned.replace(/^~\//, "").replace(/^\.\//, "");
  return cleaned.replace(/\/+$/, "");
}

export function countPathSegs(p: string): number {
  return p.split("/").filter((s) => s && s !== ".").length;
}

export function trimHeredoc(s: string): string {
  const idx = s.indexOf("<<");
  return idx >= 0 ? s.slice(0, idx) : s;
}

export function hasShellVar(tok: string): boolean {
  return tok.includes("$");
}

export function isSkillLoadTool(name: string): boolean {
  switch (name) {
    case "write":
    case "edit":
    case "multiedit":
    case "apply_patch":
    case "task":
    case "delegate_task":
    case "agent":
      return false;
    default:
      return true;
  }
}

export function extractDelegatedSkillNames(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.skills)) {
    return obj.skills.map(String).filter(Boolean);
  }
  return [];
}

export function skillsSnapshotToSectionItems(
  snapshot: SkillsSnapshot,
  maxRows: number = 10,
): SidebarSectionItem[] {
  if (snapshot.empty) return [];
  const shown = snapshot.skills.slice(0, maxRows);
  const items: SidebarSectionItem[] = [];

  for (const s of shown) {
    const item: SidebarSectionItem = { label: s.name };
    if (s.description) item.detail = s.description;
    items.push(item);
  }

  if (snapshot.skills.length > maxRows) {
    items.push({ label: `… +${snapshot.skills.length - maxRows} more` });
  }

  return items;
}

// --- Package vs Plugin Modeling ---

export function parsePackageSpec(spec: string): { spec: string; name: string } {
  let name = spec.trim();
  const colonIdx = name.indexOf(":");
  if (colonIdx >= 0) {
    name = name.slice(colonIdx + 1);
  }
  return { spec, name };
}

export function buildPluginsSnapshot(
  packages?: unknown[],
  extensionCommands?: Array<{ name: string; source: string; sourceInfo?: { path?: string } }>,
): PluginsSnapshot {
  const configuredPackages: ConfiguredPackage[] = [];
  if (Array.isArray(packages)) {
    for (const pkg of packages) {
      const spec = sanitizeText(typeof pkg === "string" ? pkg : (pkg as any)?.source);
      if (!spec) continue;
      const { name } = parsePackageSpec(spec);
      configuredPackages.push({
        spec,
        name,
        status: "configured",
        detail: "configured package",
      });
    }
  }

  const loadedPlugins: LoadedPlugin[] = [];
  if (Array.isArray(extensionCommands)) {
    const extNames = new Set<string>();
    for (const cmd of extensionCommands) {
      if (cmd.source === "extension") {
        const extName = cmd.name.split(":")[0] || "extension";
        extNames.add(extName);
      }
    }
    for (const name of extNames) {
      loadedPlugins.push({
        name,
        source: "extension",
        status: "loaded",
        detail: "loaded extension",
      });
    }
  }

  return {
    configuredPackages,
    loadedPlugins,
    empty: configuredPackages.length === 0 && loadedPlugins.length === 0,
  };
}

export function pluginsSnapshotToSectionItems(snapshot: PluginsSnapshot): SidebarSectionItem[] {
  if (snapshot.empty) return [];
  const items: SidebarSectionItem[] = [];

  for (const p of snapshot.configuredPackages) {
    items.push({ label: p.spec, detail: "configured package" });
  }

  for (const lp of snapshot.loadedPlugins) {
    items.push({ label: lp.name, detail: "loaded plugin" });
  }

  return items;
}

// --- MCP Servers Modeling ---

export function buildMcpSnapshot(
  servers?: Array<{ name: string }>,
  observedSuccessfulTools?: Set<string>,
): McpSnapshot {
  if (!Array.isArray(servers) || servers.length === 0) {
    return {
      servers: [],
      connectedCount: 0,
      registeredCount: 0,
      empty: true,
    };
  }

  let connectedCount = 0;
  const items: McpServerItem[] = [];

  for (const s of servers) {
    const name = sanitizeText(s.name);
    if (!name) continue;

    const isObservedConnected = (s as any).connectionState === "connected" || (observedSuccessfulTools
      ? [...observedSuccessfulTools].some((t) => t.startsWith(`${name}_`) || t.startsWith(`mcp__${name}__`))
      : false);

    const connectionState: McpConnectionState = (s as any).connectionState ?? (isObservedConnected ? "connected" : "unknown");
    if (connectionState === "connected") connectedCount++;

    const detail = (s as any).detail ?? (isObservedConnected
      ? "connected (observed call)"
      : "extension registration; connection unknown");

    items.push({
      name,
      connectionState,
      detail,
      directTools: (s as any).directTools,
      totalTools: (s as any).totalTools,
      disabled: (s as any).disabled,
    });
  }

  return {
    servers: items,
    connectedCount,
    registeredCount: items.length,
    empty: items.length === 0,
  };
}

export function mcpSnapshotToSectionItems(snapshot: McpSnapshot): SidebarSectionItem[] {
  if (snapshot.empty) return [];
  return snapshot.servers.map((s) => ({
    label: s.name,
    name: s.name,
    detail: s.detail,
    connected: s.connectionState === "connected",
    disabled: s.disabled,
    direct: s.directTools,
    total: s.totalTools,
  }));
}

// --- Subagent / Team Activity Modeling ---

export function parseSubagentArgs(raw: unknown): {
  name: string;
  agentName: string;
  task: string;
  interactive: boolean;
} {
  if (!raw || typeof raw !== "object") {
    return { name: "", agentName: "", task: "", interactive: false };
  }
  const obj = raw as Record<string, unknown>;
  const name = sanitizeText(obj.name);
  const agentName = sanitizeText(obj.agent ?? obj.profile);
  let task = "";
  for (const k of ["task", "prompt", "message", "instruction"]) {
    const val = sanitizeText(obj[k]);
    if (val) {
      task = val;
      break;
    }
  }
  const interactive = obj.interactive === true;
  return { name, agentName, task, interactive };
}

export function isSubagentTool(name: string): boolean {
  const n = name.toLowerCase().trim();
  return ["subagent", "run_agent", "run_workflow", "fork", "agent", "subagent_wait", "subagent_resume"].includes(n);
}

export function isSubagentRowCreatorTool(name: string): boolean {
  const n = name.toLowerCase().trim();
  return ["subagent", "run_agent", "run_workflow", "fork", "agent"].includes(n);
}

export function buildSubagentSnapshot(items: readonly SubagentItem[]): SubagentSnapshot {
  let runningCount = 0;
  let completedCount = 0;
  let failedCount = 0;

  for (const item of items) {
    if (item.status === "running") runningCount++;
    else if (item.status === "completed") completedCount++;
    else if (item.status === "failed" || item.status === "aborted") failedCount++;
  }

  return {
    items,
    runningCount,
    completedCount,
    failedCount,
    empty: items.length === 0,
  };
}

export function subagentSnapshotToSectionItems(
  snapshot: SubagentSnapshot,
  maxRows: number = 8,
): SidebarSectionItem[] {
  if (snapshot.empty) return [];
  const items: SidebarSectionItem[] = [];

  for (const item of snapshot.items.slice(0, maxRows)) {
    const glyph = item.status === "completed" ? "✓" : item.status === "running" ? "●" : item.status === "failed" ? "✖" : "○";
    const displayName = item.agentName || item.name || "subagent";
    const preview = truncateString(item.task || "task", 28);
    const label = `${glyph} ${displayName}: ${preview}`;

    let detail = item.statusLabel;
    if (!detail && item.resultSummary) {
      detail = truncateString(item.resultSummary, 32);
    } else if (!detail && item.status) {
      detail = item.status;
    }

    let elapsed = "";
    if (item.startedAt) {
      const end = item.updatedAt || Date.now();
      const dur = Math.max(0, end - item.startedAt);
      if (dur < 1000) elapsed = `${Math.round(dur)}ms`;
      else {
        const secs = Math.round(dur / 1000);
        if (secs < 60) elapsed = `${secs}s`;
        else elapsed = `${Math.floor(secs / 60)}m${secs % 60}s`;
      }
    }

    const sectionItem: SidebarSectionItem = {
      label,
      name: displayName,
      status: item.status,
      statusLabel: item.statusLabel,
      elapsed,
    };
    if (detail) sectionItem.detail = detail;
    items.push(sectionItem);
  }

  if (snapshot.items.length > maxRows) {
    items.push({ label: `… +${snapshot.items.length - maxRows} more` });
  }

  return items;
}

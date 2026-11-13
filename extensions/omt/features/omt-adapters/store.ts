import { resolve } from "node:path";
import { buildLspSnapshot, buildMcpSnapshot, buildPluginsSnapshot, buildSubagentSnapshot, buildTaskSnapshot, cleanSkillPath, countPathSegs, extractDelegatedSkillNames, hasShellVar, isSkillLoadTool, isSubagentRowCreatorTool, isSubagentTool, lspSnapshotToSectionItems, mcpSnapshotToSectionItems, parseSubagentArgs, parseTodosFromPayload, pluginsSnapshotToSectionItems, sanitizeText, skillBlockRe, skillFile, skillsSnapshotToSectionItems, skillSlugRe, subagentSnapshotToSectionItems, taskSnapshotToSectionItems, trimHeredoc } from "./model.ts";
import type {
  AdapterSectionItems,
  LoadedSkill,
  OmtAdapterState,
  ReconstructionOptions,
  SubagentItem,
  SubagentStatus,
  TodoItem,
} from "./types.ts";

export interface AdapterObservationContext {
  readonly cwd?: string;
  readonly commands?: Array<{
    name: string;
    source: string;
    description?: string;
    sourceInfo?: { path?: string };
  }>;
  readonly settings?: {
    packages?: unknown[];
    compaction?: { enabled?: boolean };
  };
  readonly mcpServers?: Array<{ name: string }>;
}

export class OmtAdapterStore {
  private _state: OmtAdapterState;
  private _generation = 0;

  constructor() {
    this._state = this._createEmptyState(0);
  }

  public get generation(): number {
    return this._generation;
  }

  public getState(): OmtAdapterState {
    return this._state;
  }

  public reset(): void {
    this._generation++;
    this._state = this._createEmptyState(this._generation);
  }

  /**
   * Deterministically reconstructs state from active branch messages and public host metadata.
   * Defends against stale generations, interleaved tool calls, and failed updates.
   */
  public reconstructFromBranch(
    branchEntries: unknown[],
    options?: ReconstructionOptions,
    context?: AdapterObservationContext,
  ): OmtAdapterState {
    const currentGen = this._generation;
    const cwd = context?.cwd || process.cwd();

    // Catalog skills indexing
    const catalogByPath = new Map<string, string>();
    const catalogNames = new Set<string>();
    const catalogDescs = new Map<string, string>();

    if (Array.isArray(context?.commands)) {
      for (const cmd of context.commands) {
        if (cmd.source === "skill") {
          const name = cmd.name.replace(/^skill:/, "").trim();
          if (name) {
            catalogNames.add(name);
            if (cmd.description) {
              catalogDescs.set(name, sanitizeText(cmd.description));
            }
            if (cmd.sourceInfo?.path) {
              const cleaned = cleanSkillPath(cmd.sourceInfo.path);
              const abs = resolve(cwd, cleaned);
              catalogByPath.set(abs, name);
              catalogByPath.set(cleaned, name);
            }
          }
        }
      }
    }

    let lastTodos: TodoItem[] | undefined;
    let lastTodoTool: string | undefined;
    let lastTodoUpdated: number | undefined;
    let lastTodoError: string | undefined;

    let lastLspOutput: string | undefined;

    const skills = new Map<string, LoadedSkill>();
    const skillPathName = new Map<string, string>();
    const subagents = new Map<string, SubagentItem>();
    const observedSuccessfulTools = new Set<string>();

    const calls = new Map<string, { id: string; name: string; arguments?: Record<string, unknown> }>();

    for (const rawEntry of branchEntries) {
      if (!rawEntry || typeof rawEntry !== "object") continue;
      const entry = rawEntry as Record<string, unknown>;
      if (entry.type !== "message" || !entry.message || typeof entry.message !== "object") continue;

      const msg = entry.message as Record<string, unknown>;
      const role = String(msg.role ?? "");

      // 1. User messages (check for pi /skill:name expansion)
      if (role === "user") {
        let userText = "";
        if (typeof msg.content === "string") {
          userText = msg.content;
        } else if (Array.isArray(msg.content)) {
          userText = msg.content
            .filter((c: any) => c && typeof c.text === "string")
            .map((c: any) => c.text)
            .join("\n");
        }
        const m = skillBlockRe.exec(userText);
        if (m) {
          const name = sanitizeText(m[1]);
          const location = m[2] ? resolve(cwd, cleanSkillPath(m[2])) : undefined;
          if (name) {
            skills.set(name, {
              name,
              path: location,
              description: catalogDescs.get(name),
              source: "user-command",
              knownCatalog: catalogNames.has(name),
            });
            if (location) {
              skillPathName.set(location, name);
            }
          }
        }
        continue;
      }

      // 2. Assistant messages (capture tool calls)
      if (role === "assistant") {
        const parts = Array.isArray(msg.content)
          ? msg.content
          : Array.isArray((msg as any).toolCalls)
            ? (msg as any).toolCalls
            : [];

        for (const part of parts) {
          if (!part || typeof part !== "object") continue;
          if (part.type === "toolCall" || part.name) {
            const id = String(part.id ?? "");
            const name = String(part.name ?? "");
            const args = part.arguments && typeof part.arguments === "object" ? part.arguments : {};
            if (id) {
              calls.set(id, { id, name, arguments: args });

              if (isSubagentRowCreatorTool(name)) {
                const parsed = parseSubagentArgs(args);
                subagents.set(id, {
                  id,
                  name: parsed.name || `subagent-${id.slice(0, 8)}`,
                  agentName: parsed.agentName,
                  task: parsed.task,
                  tool: name,
                  status: "running",
                  statusLabel: "running",
                  isError: false,
                  startedAt: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
                });
              }
            }
          }
        }
        continue;
      }

      // 3. Tool results
      if (role === "toolResult" || role === "tool") {
        const callId = String(msg.toolCallId ?? "");
        const call = callId ? calls.get(callId) : undefined;
        const toolName = String(msg.toolName || call?.name || "");
        const isError = msg.isError === true;

        if (isError) {
          // Record error on subagents if applicable
          if (callId && subagents.has(callId)) {
            const prev = subagents.get(callId)!;
            subagents.set(callId, {
              ...prev,
              status: "failed",
              statusLabel: "failed",
              isError: true,
              errorMessage: sanitizeText(msg.content ?? "Tool call failed") || "failed",
              updatedAt: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
            });
          }
          if (/todo|task/i.test(toolName)) {
            lastTodoError = "Tool call returned error";
          }
          // Do not adopt failed updates for skills, LSP, or todos
          continue;
        }

        observedSuccessfulTools.add(toolName);

        // A. Tasks / Todos
        if (/todo|task/i.test(toolName)) {
          const details = msg.details as any;
          if (details?.action === "clear" || (Array.isArray(details?.todos) && details.todos.length === 0)) {
            lastTodos = [];
          } else {
            const snapshot = parseTodosFromPayload(details) ?? parseTodosFromPayload(msg.content);
            if (snapshot) {
              lastTodos = snapshot;
              lastTodoError = undefined;
            }
          }
          lastTodoTool = toolName;
          lastTodoUpdated = typeof msg.timestamp === "number" ? msg.timestamp : Date.now();
        }

        // B. LSP Diagnostics
        if (toolName === "lsp_diagnostics") {
          let outputText = "";
          if (typeof msg.content === "string") {
            outputText = msg.content;
          } else if (Array.isArray(msg.content)) {
            outputText = msg.content
              .filter((c: any) => c && typeof c.text === "string")
              .map((c: any) => c.text)
              .join("\n");
          }
          if (outputText.trim()) {
            lastLspOutput = outputText;
          }
        }

        // C. Loaded Skills (via real successful reads or inspection)
        if (isSkillLoadTool(toolName)) {
          const rawPath = call?.arguments?.path ?? call?.arguments?.file_path;
          if (typeof rawPath === "string") {
            const cleaned = cleanSkillPath(rawPath.replace(/^@/, ""));
            const abs = resolve(cwd, cleaned);
            let skillName = catalogByPath.get(abs) ?? catalogByPath.get(cleaned) ?? skillPathName.get(abs);
            let known = Boolean(skillName);

            if (!skillName && (cleaned.endsWith("/" + skillFile) || cleaned === skillFile)) {
              if (countPathSegs(cleaned) >= 2) {
                const parts = cleaned.split("/");
                const dir = parts[parts.length - 2];
                if (dir && dir !== "." && dir !== ".." && skillSlugRe.test(dir) && !hasShellVar(dir)) {
                  skillName = dir;
                }
              }
            }

            if (skillName) {
              skills.set(skillName, {
                name: skillName,
                path: abs,
                description: catalogDescs.get(skillName),
                source: "model-read",
                knownCatalog: known,
              });
            }
          }

          // Scan command string for bash if applicable
          if (toolName === "bash" && typeof call?.arguments?.command === "string") {
            const cmdLine = trimHeredoc(call.arguments.command);
            const tokens = cmdLine.split(/[ \t\n\r"';|&<>(){}[\],=*?!]+/);
            for (const tok of tokens) {
              if (!tok || hasShellVar(tok)) continue;
              const cleaned = cleanSkillPath(tok);
              const abs = resolve(cwd, cleaned);
              const knownName = catalogByPath.get(abs) ?? catalogByPath.get(cleaned);
              if (knownName) {
                skills.set(knownName, {
                  name: knownName,
                  path: abs,
                  description: catalogDescs.get(knownName),
                  source: "model-read",
                  knownCatalog: true,
                });
              }
            }
          }
        }

        // Delegated skills in task-like tools
        const delegated = extractDelegatedSkillNames(call?.arguments);
        for (const n of delegated) {
          const name = sanitizeText(n);
          if (name && (catalogNames.has(name) || skillSlugRe.test(name))) {
            skills.set(name, {
              name,
              description: catalogDescs.get(name),
              source: "delegated",
              knownCatalog: catalogNames.has(name),
            });
          }
        }

        // D. Subagents
        if (isSubagentTool(toolName) && callId && subagents.has(callId)) {
          const prev = subagents.get(callId)!;
          let status: SubagentStatus = "completed";
          let statusLabel = "done";
          let turns: number | undefined;
          let cost: number | undefined;
          let resultSummary: string | undefined;

          const details = msg.details as any;
          if (details?.results && Array.isArray(details.results) && details.results.length > 0) {
            const r = details.results[0];
            if (r.status === "failed" || r.status === "aborted") {
              status = "failed";
              statusLabel = "failed";
            }
            turns = r.usage?.turns;
            cost = r.usage?.cost;
            resultSummary = r.errorMessage || (r.stderr ? r.stderr.trim() : undefined);
          }

          if (!resultSummary && Array.isArray(msg.content)) {
            const txt = msg.content
              .filter((c: any) => c && typeof c.text === "string")
              .map((c: any) => c.text)
              .join(" ")
              .trim();
            if (txt) resultSummary = txt;
          }

          subagents.set(callId, {
            ...prev,
            status,
            statusLabel,
            turns,
            cost,
            resultSummary,
            updatedAt: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
          });
        }
      }
    }

    // Build immutable snapshots
    const todoSnapshot = buildTaskSnapshot(lastTodos ?? [], {
      lastToolName: lastTodoTool,
      lastUpdatedAt: lastTodoUpdated,
      lastError: lastTodoError,
      settings: options?.taskDisplay,
    });

    const lspSnapshot = buildLspSnapshot(lastLspOutput);

    const skillList = Array.from(skills.values());
    const skillsSnapshot = {
      skills: skillList,
      totalCount: skillList.length,
      empty: skillList.length === 0,
    };

    const pluginsSnapshot = buildPluginsSnapshot(context?.settings?.packages, context?.commands);
    const mcpSnapshot = buildMcpSnapshot(context?.mcpServers, observedSuccessfulTools);
    const subagentsSnapshot = buildSubagentSnapshot(Array.from(subagents.values()));

    // Stale generation check
    if (currentGen !== this._generation) {
      return this._state;
    }

    this._state = {
      todos: todoSnapshot,
      lsp: lspSnapshot,
      skills: skillsSnapshot,
      plugins: pluginsSnapshot,
      mcp: mcpSnapshot,
      subagents: subagentsSnapshot,
      generation: this._generation,
      lastObservedAt: Date.now(),
    };

    return this._state;
  }

  /**
   * Translates current adapter state into standard SidebarSectionItem arrays
   * compatible with existing sidebar presentation.
   */
  public getSectionItems(options?: ReconstructionOptions): AdapterSectionItems {
    const s = this._state;
    return {
      todos: s.todos.empty ? undefined : taskSnapshotToSectionItems(s.todos, options?.taskDisplay),
      lsp: s.lsp.empty ? undefined : lspSnapshotToSectionItems(s.lsp, options?.maxLspRows),
      skills: s.skills.empty ? undefined : skillsSnapshotToSectionItems(s.skills, options?.maxSkillsVisible),
      plugins: s.plugins.empty ? undefined : pluginsSnapshotToSectionItems(s.plugins),
      mcp: s.mcp.empty ? undefined : mcpSnapshotToSectionItems(s.mcp),
      subagents: s.subagents.empty ? undefined : subagentSnapshotToSectionItems(s.subagents, options?.maxSubagentsVisible),
    };
  }

  private _createEmptyState(generation: number): OmtAdapterState {
    return {
      todos: buildTaskSnapshot([]),
      lsp: buildLspSnapshot(undefined),
      skills: { skills: [], totalCount: 0, empty: true },
      plugins: buildPluginsSnapshot(undefined, undefined),
      mcp: buildMcpSnapshot(undefined, undefined),
      subagents: buildSubagentSnapshot([]),
      generation,
      lastObservedAt: 0,
    };
  }
}

export function createOmtAdapterStore(): OmtAdapterStore {
  return new OmtAdapterStore();
}

export const OMTAdapterStore = OmtAdapterStore;
export const createOMTAdapterStore = createOmtAdapterStore;


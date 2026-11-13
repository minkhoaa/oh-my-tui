import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { copyToClipboard, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { GitFileStatusCode, GitFileStatus, GitDiffView, GitExplorerOptions as BaseGitExplorerOptions, GitExplorerFactory } from "./types.ts";


export interface GitExplorerOptions extends BaseGitExplorerOptions {
  branch?: string;
  repoName?: string;
}

export type {
  GitFileStatusCode,
  GitFileStatus,
  GitDiffView,
  GitExplorerFactory,
};

const execFileAsync = promisify(execFile);

// ============================================================================
// Types
// ============================================================================

export interface DiffHunkLine {
  type: "add" | "del" | "context";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffHunkLine[];
}

export type StagedFilterMode = "all" | "staged" | "unstaged";

// ============================================================================
// Safe Theme Helpers
// ============================================================================

function fgSafe(theme: Theme, color: any, text: string): string {
  try {
    return typeof theme.fg === "function" ? theme.fg(color, text) : text;
  } catch {
    return text;
  }
}

function boldSafe(theme: Theme, text: string): string {
  try {
    return typeof theme.bold === "function" ? theme.bold(text) : text;
  } catch {
    return text;
  }
}

function dimSafe(theme: Theme, text: string): string {
  try {
    if (typeof (theme as any).dim === "function") {
      return (theme as any).dim(text);
    }
    return typeof theme.fg === "function" ? theme.fg("dim" as any, text) : text;
  } catch {
    return text;
  }
}

function diffAddedSafe(theme: Theme, text: string): string {
  try {
    if (typeof (theme as any).diffAdded === "function") return (theme as any).diffAdded(text);
    if (typeof theme.fg === "function") {
      const res = theme.fg("toolDiffAdded" as any, text);
      if (res) return res;
      return theme.fg("success", text);
    }
  } catch {}
  return text;
}

function diffRemovedSafe(theme: Theme, text: string): string {
  try {
    if (typeof (theme as any).diffRemoved === "function") return (theme as any).diffRemoved(text);
    if (typeof theme.fg === "function") {
      const res = theme.fg("toolDiffRemoved" as any, text);
      if (res) return res;
      return theme.fg("error", text);
    }
  } catch {}
  return text;
}

function diffContextSafe(theme: Theme, text: string): string {
  try {
    if (typeof (theme as any).diffContext === "function") return (theme as any).diffContext(text);
    if (typeof theme.fg === "function") {
      const res = theme.fg("toolDiffContext" as any, text);
      if (res) return res;
      return theme.fg("muted", text);
    }
  } catch {}
  return text;
}

// ============================================================================
// Unicode & Width Alignment Helpers
// ============================================================================

export function fitToWidth(text: string, targetWidth: number): string {
  if (targetWidth <= 0) return "";
  const current = visibleWidth(text);
  if (current === targetWidth) return text;
  if (current > targetWidth) {
    const truncated = truncateToWidth(text, targetWidth, "");
    const tw = visibleWidth(truncated);
    return tw < targetWidth ? truncated + " ".repeat(targetWidth - tw) : truncated;
  }
  return text + " ".repeat(targetWidth - current);
}

function unquoteGitPath(p: string): string {
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) {
    return p.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return p;
}

export function getStatusGlyph(status: GitFileStatusCode): string {
  switch (status) {
    case "modified":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "untracked":
      return "?";
    default:
      return "M";
  }
}

// ============================================================================
// Clipboard Safe Helper
// ============================================================================

export async function copyGitContent(content: string): Promise<boolean> {
  try {
    await copyToClipboard(content);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Parsing Helpers
// ============================================================================

export function parseGitStatusOutput(output: string): GitFileStatus[] {
  if (!output || typeof output !== "string") return [];

  const lines = output.split(/\r?\n/);
  const files: GitFileStatus[] = [];

  for (const rawLine of lines) {
    if (!rawLine || rawLine.startsWith("##") || rawLine.length < 3) continue;

    const x = rawLine[0]!;
    const y = rawLine[1]!;
    const rest = rawLine.slice(3).trim();
    if (!rest) continue;

    let oldPath: string | undefined;
    let filePath = rest;

    if (rest.includes(" -> ")) {
      const parts = rest.split(" -> ");
      oldPath = unquoteGitPath(parts[0]!.trim());
      filePath = unquoteGitPath(parts[1]!.trim());
    } else {
      filePath = unquoteGitPath(rest);
    }

    // Untracked file
    if (x === "?" && y === "?") {
      files.push({
        path: filePath,
        status: "untracked",
        staged: false,
      });
      continue;
    }

    // Staged change (X != ' ' and X != '?')
    if (x !== " " && x !== "?") {
      let status: GitFileStatusCode = "modified";
      if (x === "A" || x === "C") status = "added";
      else if (x === "D") status = "deleted";
      else if (x === "R") status = "renamed";

      files.push({
        path: filePath,
        oldPath: x === "R" ? oldPath : undefined,
        status,
        staged: true,
      });
    }

    // Unstaged change (Y != ' ' and Y != '?')
    if (y !== " " && y !== "?") {
      let status: GitFileStatusCode = "modified";
      if (y === "D") status = "deleted";
      else if (y === "A") status = "added";

      files.push({
        path: filePath,
        status,
        staged: false,
      });
    }
  }

  return files;
}

export function parseGitDiffNumstat(
  numstatOutput: string,
): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>();
  if (!numstatOutput || typeof numstatOutput !== "string") return map;

  const lines = numstatOutput.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length >= 3) {
      const addStr = parts[0]!.trim();
      const delStr = parts[1]!.trim();
      let rawPath = parts.slice(2).join("\t").trim();

      if (rawPath.includes(" => ")) {
        if (rawPath.includes("{") && rawPath.includes("}")) {
          rawPath = rawPath.replace(/\{.*?=> (.*?)\}/, "$1").replace(/\/\//g, "/");
        } else {
          const pParts = rawPath.split(" => ");
          rawPath = pParts[1]!.trim();
        }
      }
      rawPath = unquoteGitPath(rawPath);

      const additions = addStr === "-" ? 0 : parseInt(addStr, 10) || 0;
      const deletions = delStr === "-" ? 0 : parseInt(delStr, 10) || 0;

      map.set(rawPath, { additions, deletions });
    }
  }
  return map;
}

export function parseDiffHunks(diffText: string): DiffHunk[] {
  if (!diffText || typeof diffText !== "string") return [];

  const rawLines = diffText.split(/\r?\n/);
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let curOld = 1;
  let curNew = 1;

  for (const rawLine of rawLines) {
    // Check if line is a hunk header: @@ -10,4 +10,5 @@ ...
    const hunkMatch = rawLine.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@(.*)$/);
    if (hunkMatch) {
      curOld = parseInt(hunkMatch[1]!, 10);
      curNew = parseInt(hunkMatch[2]!, 10);
      currentHunk = {
        header: rawLine.trim(),
        lines: [],
      };
      hunks.push(currentHunk);
      continue;
    }

    // Skip file header metadata lines before any hunk
    if (
      !currentHunk &&
      (rawLine.startsWith("---") ||
        rawLine.startsWith("+++") ||
        rawLine.startsWith("diff ") ||
        rawLine.startsWith("index ") ||
        rawLine.startsWith("new file mode ") ||
        rawLine.startsWith("deleted file mode ") ||
        rawLine.startsWith("similarity index ") ||
        rawLine.startsWith("rename from ") ||
        rawLine.startsWith("rename to ") ||
        rawLine.startsWith("old mode ") ||
        rawLine.startsWith("new mode ") ||
        rawLine.startsWith("Binary files "))
    ) {
      continue;
    }

    // Skip git diff EOF marker
    if (rawLine.startsWith("\\ No newline at end of file")) {
      continue;
    }

    // Fallback hunk if content appears before @@
    if (!currentHunk) {
      currentHunk = {
        header: "@@ Changes @@",
        lines: [],
      };
      hunks.push(currentHunk);
    }

    // Addition line
    const trimmed = rawLine.trimStart();
    if (trimmed.startsWith("+") && !trimmed.startsWith("+++")) {
      const matchWithNum = trimmed.match(/^\+(\s*\d+)\s+(.*)$/);
      if (matchWithNum) {
        const lineNum = parseInt(matchWithNum[1]!.trim(), 10);
        const resolvedNum = Number.isFinite(lineNum) ? lineNum : curNew++;
        curNew = resolvedNum + 1;
        currentHunk.lines.push({
          type: "add",
          text: matchWithNum[2]!,
          newLine: resolvedNum,
        });
      } else {
        currentHunk.lines.push({
          type: "add",
          text: trimmed.slice(1),
          newLine: curNew++,
        });
      }
      continue;
    }

    // Deletion line
    if (trimmed.startsWith("-") && !trimmed.startsWith("---")) {
      const matchWithNum = trimmed.match(/^-(\s*\d+)\s+(.*)$/);
      if (matchWithNum) {
        const lineNum = parseInt(matchWithNum[1]!.trim(), 10);
        const resolvedNum = Number.isFinite(lineNum) ? lineNum : curOld++;
        curOld = resolvedNum + 1;
        currentHunk.lines.push({
          type: "del",
          text: matchWithNum[2]!,
          oldLine: resolvedNum,
        });
      } else {
        currentHunk.lines.push({
          type: "del",
          text: trimmed.slice(1),
          oldLine: curOld++,
        });
      }
      continue;
    }

    // Context line with line numbers: " 123 code"
    const ctxWithNum = rawLine.match(/^[\s](\s*\d+)\s+(.*)$/);
    if (ctxWithNum) {
      const lineNum = parseInt(ctxWithNum[1]!.trim(), 10);
      const resolvedNum = Number.isFinite(lineNum) ? lineNum : curNew++;
      currentHunk.lines.push({
        type: "context",
        text: ctxWithNum[2]!,
        oldLine: curOld++,
        newLine: resolvedNum,
      });
      curNew = resolvedNum + 1;
      continue;
    }

    // Standard context line starting with space
    if (rawLine.startsWith(" ")) {
      currentHunk.lines.push({
        type: "context",
        text: rawLine.slice(1),
        oldLine: curOld++,
        newLine: curNew++,
      });
      continue;
    }

    // Fallback line
    if (rawLine.length > 0) {
      currentHunk.lines.push({
        type: "context",
        text: rawLine,
        oldLine: curOld++,
        newLine: curNew++,
      });
    }
  }

  return hunks;
}

// ============================================================================
// Git Extraction Helpers
// ============================================================================

export async function extractGitBranch(
  cwd: string,
  options?: GitExplorerOptions,
): Promise<string> {
  if (options && "branch" in options && typeof (options as any).branch === "string") {
    return (options as any).branch;
  }
  try {
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
      cwd,
      timeout: 3000,
    });
    const branch = stdout.trim();
    if (branch) return branch;

    const rev = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      timeout: 3000,
    });
    const commit = rev.stdout.trim();
    return commit ? `(${commit})` : "HEAD";
  } catch {
    return "HEAD";
  }
}

export async function extractGitStatus(
  cwd: string,
  options?: GitExplorerOptions,
): Promise<GitFileStatus[]> {
  if (options?.files) {
    return [...options.files];
  }

  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1"], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 5000,
    });

    const files = parseGitStatusOutput(stdout);
    if (files.length === 0) return files;

    // Enrich files with additions & deletions stats via diff --numstat
    try {
      const [unstagedRes, stagedRes] = await Promise.allSettled([
        execFileAsync("git", ["diff", "--numstat"], { cwd, timeout: 5000 }),
        execFileAsync("git", ["diff", "--cached", "--numstat"], { cwd, timeout: 5000 }),
      ]);

      const unstagedMap =
        unstagedRes.status === "fulfilled"
          ? parseGitDiffNumstat(unstagedRes.value.stdout)
          : new Map<string, { additions: number; deletions: number }>();

      const stagedMap =
        stagedRes.status === "fulfilled"
          ? parseGitDiffNumstat(stagedRes.value.stdout)
          : new Map<string, { additions: number; deletions: number }>();

      for (const file of files) {
        const stats = file.staged ? stagedMap.get(file.path) : unstagedMap.get(file.path);
        if (stats) {
          file.additions = stats.additions;
          file.deletions = stats.deletions;
        }
      }
    } catch {
      // Non-fatal, return files without numstat
    }

    return files;
  } catch {
    // Non-git directory or error
    return [];
  }
}

export async function extractGitDiff(
  cwd: string,
  filePath: string,
  staged: boolean,
  options?: GitExplorerOptions,
): Promise<string> {
  if (options?.diffs) {
    const cacheKey = `${staged ? "staged:" : "unstaged:"}${filePath}`;
    if (options.diffs[cacheKey] !== undefined) {
      return options.diffs[cacheKey]!;
    }
    if (options.diffs[filePath] !== undefined) {
      return options.diffs[filePath]!;
    }
  }

  try {
    const args = staged
      ? ["diff", "--cached", "--", filePath]
      : ["diff", "--", filePath];

    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 5000,
    });

    if (stdout && stdout.length > 0) {
      return stdout;
    }

    // Untracked or newly added file fallback: read file contents if diff returned empty
    if (!staged) {
      try {
        const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
        const stat = await fs.promises.lstat(fullPath);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.size < 5 * 1024 * 1024) {
          const content = await fs.promises.readFile(fullPath, "utf-8");
          const lines = content.split(/\r?\n/);
          const syntheticLines = [
            `--- /dev/null`,
            `+++ b/${filePath}`,
            `@@ -0,0 +1,${lines.length} @@`,
            ...lines.map((l) => `+${l}`),
          ];
          return syntheticLines.join("\n");
        }
      } catch {
        // file missing or unreadable
      }
    }

    return "";
  } catch (err: any) {
    if (err?.stdout && typeof err.stdout === "string") {
      return err.stdout;
    }
    return "";
  }
}

// ============================================================================
// Component Implementation
// ============================================================================


export { fgSafe, boldSafe, dimSafe, diffAddedSafe, diffRemovedSafe, diffContextSafe };

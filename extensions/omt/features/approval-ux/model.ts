import { type Component } from "@earendil-works/pi-tui";
import { type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import type { DangerLevel, PermissionRequest, PermissionReviewOptions, PermissionReviewFactory } from "./types.ts";


export type {
  DangerLevel,
  PermissionRequest,
  PermissionReviewOptions,
  PermissionReviewFactory,
};

/**
 * Styling and badge metadata per danger level.
 */
export interface DangerLevelInfo {
  badge: string;
  shortBadge: string;
  color: ThemeColor;
  icon: string;
}

export const DANGER_LEVEL_MAP: Record<DangerLevel, DangerLevelInfo> = {
  critical: { badge: "[CRITICAL DANGER]", shortBadge: "[CRIT]", color: "error", icon: "✖" },
  high: { badge: "[HIGH RISK]", shortBadge: "[HIGH]", color: "error", icon: "▲" },
  medium: { badge: "[MEDIUM RISK]", shortBadge: "[MED ]", color: "warning", icon: "⚠" },
  low: { badge: "[LOW RISK]", shortBadge: "[LOW ]", color: "success", icon: "✓" },
};

/**
 * Safe Theme styling helpers.
 */
function fgSafe(theme: Theme | undefined, color: ThemeColor, text: string): string {
  try {
    return theme?.fg ? theme.fg(color, text) : text;
  } catch {
    return text;
  }
}

function boldSafe(theme: Theme | undefined, text: string): string {
  try {
    return theme?.bold ? theme.bold(text) : text;
  } catch {
    return text;
  }
}

function dimSafe(theme: Theme | undefined, text: string): string {
  try {
    if (typeof (theme as any)?.dim === "function") {
      return (theme as any).dim(text);
    }
    return typeof theme?.fg === "function" ? theme.fg("dim", text) : text;
  } catch {
    return text;
  }
}

/**
 * Assesses the security and operational risk of a tool execution.
 * Classifies danger level as low, medium, high, or critical based on heuristics.
 */
export function assessRisk(
  toolName: string,
  args: unknown,
): { dangerLevel: DangerLevel; explanation: string; warnings: string[] } {
  const tool = (toolName ?? "").toLowerCase().trim();
  const warnings: string[] = [];

  // 1. Shell commands inspection
  if (tool === "bash" || tool === "sh" || tool === "exec" || tool === "shell" || tool === "powershell") {
    let cmd = "";
    if (typeof args === "string") {
      cmd = args;
    } else if (typeof args === "object" && args !== null) {
      const rec = args as Record<string, unknown>;
      cmd = String(rec.command ?? rec.cmd ?? "");
    }

    const trimmed = cmd.trim();

    // Critical shell patterns
    if (
      /\brm\s+-[a-zA-Z]*(?:r.*f|f.*r)[a-zA-Z]*\s+(?:\/(?:\s|$|\*)|~(?:\s|$|\/)|(?:\$HOME)(?:\s|$|\/))/i.test(trimmed) ||
      /\brm\s+(?:-[a-zA-Z]+\s+)*(?:\/(?:\s|$|\*)|~(?:\s|$|\/)|(?:\$HOME)(?:\s|$|\/))/i.test(trimmed)
    ) {
      warnings.push("Detected root or whole-home recursive deletion.");
      warnings.push("Command will permanently destroy system or user files.");
      return {
        dangerLevel: "critical",
        explanation: "Critical destructive file system deletion command.",
        warnings,
      };
    }

    if (/\b(mkfs|dd\s+.*of=\/dev\/|fdisk|parted|sfdisk|wipefs)/i.test(trimmed)) {
      warnings.push("Detected direct block device formatting or raw disk writing.");
      return {
        dangerLevel: "critical",
        explanation: "Hardware partition or disk formatting operation.",
        warnings,
      };
    }

    if (/\b(drop\s+(database|schema|table)|truncate\s+table)\b/i.test(trimmed)) {
      warnings.push("Detected database deletion command that permanently destroys schemas/tables.");
      return {
        dangerLevel: "critical",
        explanation: "Irreversible database schema destruction.",
        warnings,
      };
    }

    if (/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(trimmed)) {
      warnings.push("Detected fork bomb pattern designed to crash host system.");
      return {
        dangerLevel: "critical",
        explanation: "Denial of service attack pattern.",
        warnings,
      };
    }

    if (/\b(curl|wget)\b.*\|\s*(sudo\s+)?(bash|sh|zsh)\b/i.test(trimmed)) {
      warnings.push("Piping remote web script directly into root or user shell.");
      return {
        dangerLevel: "critical",
        explanation: "Unverified remote code execution.",
        warnings,
      };
    }

    // High shell patterns
    if (/\brm\s+-[a-zA-Z]*r[a-zA-Z]*\b/i.test(trimmed) || /\brmdir\s+--ignore-fail-on-non-empty\b/i.test(trimmed)) {
      warnings.push("Recursive directory removal: deleted files cannot be restored.");
      return {
        dangerLevel: "high",
        explanation: "Recursive directory deletion.",
        warnings,
      };
    }

    if (/\bgit\s+reset\s+--hard\b/i.test(trimmed)) {
      warnings.push("Hard reset will permanently discard all uncommitted changes and uncommitted files.");
      return {
        dangerLevel: "high",
        explanation: "Destructive git operation discarding uncommitted work.",
        warnings,
      };
    }

    if (/\bgit\s+(clean\s+-[a-zA-Z]*f[a-zA-Z]*|push\s+.*--force)\b/i.test(trimmed)) {
      warnings.push("Forced git operation can overwrite remote history or permanently delete untracked files.");
      return {
        dangerLevel: "high",
        explanation: "Destructive git branch or clean action.",
        warnings,
      };
    }

    if (/\b(kill\s+-9|killall\s+-9|pkill\s+-9)\b/i.test(trimmed)) {
      warnings.push("Forced SIGKILL process termination bypasses clean shutdown handlers.");
      return {
        dangerLevel: "high",
        explanation: "Forced process termination (SIGKILL).",
        warnings,
      };
    }

    if (/\bchmod\s+(-[a-zA-Z]*R\s+)?777\b/i.test(trimmed)) {
      warnings.push("Granting universal read/write/execute permissions weakens filesystem security.");
      return {
        dangerLevel: "high",
        explanation: "Overly permissive permission alteration (777).",
        warnings,
      };
    }

    // Medium shell patterns
    if (/\b(kill|killall|pkill)\b/i.test(trimmed)) {
      warnings.push("Process termination requested.");
      return {
        dangerLevel: "medium",
        explanation: "Process termination command.",
        warnings,
      };
    }

    if (/\bsudo\b/i.test(trimmed)) {
      warnings.push("Command requests superuser administrative elevation.");
      return {
        dangerLevel: "medium",
        explanation: "Elevated superuser execution.",
        warnings,
      };
    }

    if (/\b(systemctl\s+(stop|restart)|reboot|shutdown|init\s+0)\b/i.test(trimmed)) {
      warnings.push("System service state change or host power cycle requested.");
      return {
        dangerLevel: "medium",
        explanation: "Service or host reboot operation.",
        warnings,
      };
    }

    if (/\bgit\s+(checkout\s+-f|restore\s+\.)(?:\s|$)/i.test(trimmed)) {
      warnings.push("May discard uncommitted file modifications.");
      return {
        dangerLevel: "medium",
        explanation: "Git working tree discard operation.",
        warnings,
      };
    }

    // Low shell patterns: default safe or routine commands
    return {
      dangerLevel: "low",
      explanation: "Standard shell command execution.",
      warnings: [],
    };
  }

  // 2. File write or edit inspection
  if (tool === "write" || tool === "edit") {
    let filePath = "";
    if (typeof args === "object" && args !== null) {
      const rec = args as Record<string, unknown>;
      filePath = String(rec.path ?? rec.filePath ?? "");
    }

    const normPath = filePath.replace(/\\/g, "/");

    // Critical paths
    if (
      normPath.startsWith("/etc/") ||
      normPath.startsWith("/boot/") ||
      normPath.startsWith("/dev/") ||
      normPath.startsWith("/sys/") ||
      normPath.includes(".ssh/authorized_keys") ||
      normPath.includes("id_rsa") ||
      normPath.includes("id_ed25519")
    ) {
      warnings.push(`Target path '${filePath}' affects system security or SSH authentication.`);
      return {
        dangerLevel: "critical",
        explanation: "Writing to protected system file or authentication credential.",
        warnings,
      };
    }

    // High paths
    if (
      normPath.includes(".bashrc") ||
      normPath.includes(".zshrc") ||
      normPath.includes(".profile") ||
      normPath.endsWith(".env") ||
      normPath.includes(".env.") ||
      normPath.includes("credentials.json") ||
      normPath.includes("secrets.") ||
      normPath.startsWith("/usr/") ||
      normPath.startsWith("/bin/") ||
      normPath.startsWith("/sbin/")
    ) {
      warnings.push(`Target path '${filePath}' modifies shell configuration or environment secrets.`);
      return {
        dangerLevel: "high",
        explanation: "Writing to shell environment startup or secret credentials file.",
        warnings,
      };
    }

    // Medium paths: critical repository configuration files
    if (
      normPath.endsWith("package.json") ||
      normPath.endsWith("tsconfig.json") ||
      normPath.includes(".git/") ||
      normPath.endsWith("Dockerfile") ||
      normPath.endsWith("docker-compose.yml")
    ) {
      warnings.push(`Target path '${filePath}' modifies project build or container configuration.`);
      return {
        dangerLevel: "medium",
        explanation: "Modifying core project configuration file.",
        warnings,
      };
    }

    // Low paths: standard application source code or docs
    return {
      dangerLevel: "low",
      explanation: "Standard file modification within workspace.",
      warnings: [],
    };
  }

  // 3. File deletion tool
  if (tool === "delete" || tool === "rm") {
    warnings.push("Tool performs permanent file removal.");
    return {
      dangerLevel: "high",
      explanation: "File deletion operation.",
      warnings,
    };
  }

  // 4. Default / unknown tools
  return {
    dangerLevel: "medium",
    explanation: `Execution of tool '${toolName}'. User inspection recommended.`,
    warnings: ["Custom or unclassified tool execution."],
  };
}

/**
 * Helper to construct a PermissionRequest from a tool invocation.
 */
export function createPermissionRequest(
  toolName: string,
  args: unknown,
  diffPreview?: string,
): PermissionRequest {
  const risk = assessRisk(toolName, args);
  let type: PermissionRequest["type"] = "tool";
  let command: string | undefined;
  let path: string | undefined;

  if (toolName === "bash" || toolName === "sh" || toolName === "exec") {
    type = "bash";
    if (typeof args === "string") {
      command = args;
    } else if (typeof args === "object" && args !== null) {
      const rec = args as Record<string, unknown>;
      command = String(rec.command ?? rec.cmd ?? "");
    }
  } else if (toolName === "write" || toolName === "edit") {
    type = "file_write";
    if (typeof args === "object" && args !== null) {
      const rec = args as Record<string, unknown>;
      path = String(rec.path ?? rec.filePath ?? "");
    }
  } else if (toolName === "delete" || toolName === "rm") {
    type = "file_delete";
    if (typeof args === "object" && args !== null) {
      const rec = args as Record<string, unknown>;
      path = String(rec.path ?? rec.filePath ?? "");
    }
  }

  let preview = diffPreview;
  if (!preview) {
    if (command) {
      preview = command;
    } else if (typeof args === "object" && args !== null) {
      const rec = args as Record<string, unknown>;
      if (typeof rec.diff === "string") preview = rec.diff;
      else if (typeof rec.content === "string") preview = rec.content;
      else preview = JSON.stringify(args, null, 2);
    } else {
      preview = String(args ?? "");
    }
  }

  return {
    id: `perm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    toolName,
    command,
    path,
    dangerLevel: risk.dangerLevel,
    explanation: risk.explanation,
    diffPreview: preview,
    timestamp: Date.now(),
  };
}

/**
 * Interactive Permission & Safety Review Component.
 */

export { fgSafe, boldSafe, dimSafe };

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, type Component, type KeybindingsManager, type TUI, matchesKey, Key, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getBorderStyler } from "../../presets/shared/style.ts";
import type { InspectedToolCall, ToolInspectorFactory, ToolInspectorOptions } from "./types.ts";
import { fgSafe, boldSafe, dimSafe, formatDuration, renderOutcomeBadge, copyToolContent, parseDiffHunks, formatToolSummary, extractSessionToolCalls } from "./model.ts";

export class ToolInspectorComponent extends Container implements Component {
  private tui: { requestRender(): void };
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private tools: InspectedToolCall[];
  private selectedIndex: number;
  private focus: "list" | "detail" = "list";
  private scrollOffset = 0;
  private listScroll = 0;
  private toastMessage: string | null = null;
  private toastTimeout: NodeJS.Timeout | null = null;

  private borderTop: DynamicBorder;
  private borderMid: DynamicBorder;
  private borderBottom: DynamicBorder;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options?: ToolInspectorOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;

    if (options?.toolCalls !== undefined) {
      this.tools = [...options.toolCalls];
    } else if (ctx?.sessionManager) {
      this.tools = extractSessionToolCalls(ctx.sessionManager);
    } else {
      this.tools = [];
    }

    if (this.tools.length > 0) {
      if (options?.initialToolId) {
        const idx = this.tools.findIndex((t) => t.id === options.initialToolId);
        this.selectedIndex = idx >= 0 ? idx : 0;
      } else {
        this.selectedIndex = 0;
      }
    } else {
      this.selectedIndex = -1;
    }

    const borderStyle = getBorderStyler(theme);
    this.borderTop = new DynamicBorder(borderStyle);
    this.borderMid = new DynamicBorder(borderStyle);
    this.borderBottom = new DynamicBorder(borderStyle);

    this.addChild(this.borderTop);
    this.addChild(this.borderMid);
    this.addChild(this.borderBottom);
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getFocus(): "list" | "detail" {
    return this.focus;
  }

  getTools(): InspectedToolCall[] {
    return [...this.tools];
  }

  getSelectedTool(): InspectedToolCall | undefined {
    return this.selectedIndex >= 0 ? this.tools[this.selectedIndex] : undefined;
  }

  getScrollOffset(): number {
    return this.scrollOffset;
  }

  private getToolContent(tool: InspectedToolCall): string {
    if (!tool) return "";
    const args = (typeof tool.args === "object" && tool.args !== null ? tool.args : {}) as Record<string, unknown>;

    if (tool.name === "edit") {
      if (typeof tool.result === "string" && tool.result.length > 0) return tool.result;
      if (typeof args.diff === "string") return args.diff;
      return JSON.stringify(tool.args, null, 2);
    }
    if (tool.name === "read") {
      if (typeof tool.result === "string") return tool.result;
      return String(args.path ?? args.filePath ?? "");
    }
    if (tool.name === "write") {
      if (typeof args.content === "string") return args.content;
      if (typeof tool.result === "string") return tool.result;
      return String(args.path ?? args.filePath ?? "");
    }
    if (tool.name === "bash" || tool.name === "powershell") {
      if (typeof tool.result === "string") return tool.result;
      return String(args.command ?? args.cmd ?? "");
    }
    if (typeof tool.result === "string" && tool.result.length > 0) return tool.result;
    return JSON.stringify(tool.args, null, 2);
  }

  handleInput(data: string): void {
    // 1. Close overlay: Esc or 'q' / 'Q'
    if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
        this.toastTimeout = null;
      }
      this.done();
      return;
    }

    // 2. Switch focus: Tab, Shift+Tab, Left, Right
    if (
      matchesKey(data, Key.tab) ||
      matchesKey(data, "shift+tab") ||
      data === "\x1b[Z" ||
      matchesKey(data, Key.left) ||
      matchesKey(data, Key.right)
    ) {
      this.focus = this.focus === "list" ? "detail" : "list";
      this.tui.requestRender();
      return;
    }

    // 3. Up arrow
    if (matchesKey(data, Key.up)) {
      if (this.focus === "list") {
        if (this.selectedIndex > 0) {
          this.selectedIndex--;
          this.scrollOffset = 0;
          if (this.selectedIndex < this.listScroll) {
            this.listScroll = this.selectedIndex;
          }
          this.tui.requestRender();
        }
      } else {
        if (this.scrollOffset > 0) {
          this.scrollOffset--;
          this.tui.requestRender();
        }
      }
      return;
    }

    // 4. Down arrow
    if (matchesKey(data, Key.down)) {
      if (this.focus === "list") {
        if (this.selectedIndex < this.tools.length - 1) {
          this.selectedIndex++;
          this.scrollOffset = 0;
          const maxVisible = 5;
          if (this.selectedIndex >= this.listScroll + maxVisible) {
            this.listScroll = this.selectedIndex - maxVisible + 1;
          }
          this.tui.requestRender();
        }
      } else {
        this.scrollOffset++;
        this.tui.requestRender();
      }
      return;
    }

    // 5. Page Up
    if (matchesKey(data, Key.pageUp)) {
      if (this.scrollOffset > 0) {
        this.scrollOffset = Math.max(0, this.scrollOffset - 10);
        this.tui.requestRender();
      }
      return;
    }

    // 6. Page Down
    if (matchesKey(data, Key.pageDown)) {
      this.scrollOffset += 10;
      this.tui.requestRender();
      return;
    }

    // 7. Enter: switch focus to detail if on list
    if (matchesKey(data, Key.enter) && this.focus === "list" && this.tools.length > 0) {
      this.focus = "detail";
      this.tui.requestRender();
      return;
    }

    // 8. Copy active tool content: 'c', 'C', 'y', 'Y'
    if (data === "c" || data === "C" || data === "y" || data === "Y") {
      const tool = this.tools[this.selectedIndex];
      if (tool) {
        const text = this.getToolContent(tool);
        this.toastMessage = "Copying...";
        this.tui.requestRender();
        void copyToolContent(text).then((success) => {
          this.toastMessage = success ? "Copied to clipboard!" : "Copy failed";
          if (this.toastTimeout) clearTimeout(this.toastTimeout);
          this.toastTimeout = setTimeout(() => {
            this.toastMessage = null;
            this.tui.requestRender();
          }, 2500);
          this.tui.requestRender();
        });
      }
      return;
    }
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(10, width || 80);
    const clampLine = (line: string): string => {
      if (visibleWidth(line) > safeWidth) {
        return truncateToWidth(line, safeWidth, "");
      }
      return line;
    };

    const lines: string[] = [];

    // --- Section 1: Title & Focus ---
    if (safeWidth >= 70) {
      const title = `${boldSafe(this.theme, fgSafe(this.theme, "accent", "◆ Tool Inspector"))} ${dimSafe(this.theme, `(${this.tools.length} call${this.tools.length === 1 ? "" : "s"})`)}`;
      const badgeText = this.focus === "list" ? "[Focus: List (Tab to detail)]" : "[Focus: Detail (Tab to list)]";
      const badge = fgSafe(this.theme, "accent", badgeText);
      lines.push(clampLine(` ${title}  ${badge}`));
    } else if (safeWidth >= 40) {
      const title = `${boldSafe(this.theme, fgSafe(this.theme, "accent", "◆ Inspector"))} ${dimSafe(this.theme, `(${this.tools.length})`)}`;
      const badge = fgSafe(this.theme, "accent", `[${this.focus}]`);
      lines.push(clampLine(` ${title}  ${badge}`));
    } else {
      lines.push(clampLine(` ${boldSafe(this.theme, fgSafe(this.theme, "accent", "Inspector"))} (${this.tools.length})`));
    }

    // --- Section 2: Top Border ---
    lines.push(clampLine(this.borderTop.render(safeWidth)[0] ?? "─".repeat(safeWidth)));

    // --- Section 3: Tool List ---
    if (this.tools.length === 0) {
      lines.push(clampLine(`  ${dimSafe(this.theme, "No tool calls recorded in this session.")}`));
    } else {
      const maxVisible = 5;
      const start = this.listScroll;
      const end = Math.min(this.tools.length, start + maxVisible);

      for (let i = start; i < end; i++) {
        const tool = this.tools[i]!;
        const isSelected = i === this.selectedIndex;
        const cursor = isSelected
          ? (this.focus === "list" ? boldSafe(this.theme, fgSafe(this.theme, "accent", "▶ ")) : fgSafe(this.theme, "muted", "▷ "))
          : "  ";

        let badge: string;
        if (safeWidth >= 50) {
          if (tool.outcome === "running") {
            badge = fgSafe(this.theme, "secondary", "[⋯ running]");
          } else if (tool.outcome === "failure" || tool.isError) {
            badge = fgSafe(this.theme, "error", "[✗ error]");
          } else if (tool.outcome === "interrupted") {
            badge = fgSafe(this.theme, "warning", "[⊘ abort]");
          } else {
            badge = fgSafe(this.theme, "success", "[✓ success]");
          }
        } else {
          if (tool.outcome === "running") {
            badge = fgSafe(this.theme, "secondary", "⋯");
          } else if (tool.outcome === "failure" || tool.isError) {
            badge = fgSafe(this.theme, "error", "✗");
          } else if (tool.outcome === "interrupted") {
            badge = fgSafe(this.theme, "warning", "⊘");
          } else {
            badge = fgSafe(this.theme, "success", "✓");
          }
        }

        const nameStr = isSelected ? boldSafe(this.theme, fgSafe(this.theme, "accent", tool.name)) : fgSafe(this.theme, "text", tool.name);
        const summary = formatToolSummary(tool);

        if (safeWidth >= 50) {
          lines.push(clampLine(`${cursor}${badge} ${nameStr} ${dimSafe(this.theme, summary)}`));
        } else {
          lines.push(clampLine(`${cursor}${badge} ${nameStr}`));
        }
      }

      if (this.tools.length > maxVisible) {
        lines.push(clampLine(`  ${dimSafe(this.theme, `[${start + 1}-${end} of ${this.tools.length}]`)}`));
      }
    }

    // --- Section 4: Middle Border ---
    lines.push(clampLine(this.borderMid.render(safeWidth)[0] ?? "─".repeat(safeWidth)));

    // --- Section 5: Detail View ---
    if (this.tools.length === 0 || this.selectedIndex < 0) {
      lines.push(clampLine(`  ${dimSafe(this.theme, "No details to display.")}`));
    } else {
      const tool = this.tools[this.selectedIndex]!;
      const detailLines: string[] = [];
      const args = (typeof tool.args === "object" && tool.args !== null ? tool.args : {}) as Record<string, unknown>;

      // Meta header line 1: Tool name, outcome, duration
      const durStr = tool.durationMs !== undefined ? formatDuration(tool.durationMs) : "";
      if (safeWidth >= 70) {
        detailLines.push(
          `  ${boldSafe(this.theme, "Tool:")} ${fgSafe(this.theme, "accent", tool.name)}  ${boldSafe(this.theme, "Outcome:")} ${renderOutcomeBadge(tool, this.theme)}  ${durStr ? `${boldSafe(this.theme, "Duration:")} ${durStr}` : ""}`.trimEnd()
        );
      } else {
        detailLines.push(`  ${boldSafe(this.theme, tool.name)} (${tool.outcome || "unknown"}) ${durStr}`);
      }

      // Meta header line 2: Target / Path / Command
      if (tool.name === "read" || tool.name === "write" || tool.name === "edit") {
        const p = String(args.path ?? args.filePath ?? args.file ?? "(unknown path)");
        if (safeWidth >= 50) {
          detailLines.push(`  ${boldSafe(this.theme, "File:")} ${fgSafe(this.theme, "accent", p)}`);
        } else {
          detailLines.push(`  ${fgSafe(this.theme, "accent", p)}`);
        }
      } else if (tool.name === "bash" || tool.name === "powershell") {
        const cmd = String(args.command ?? args.cmd ?? "(no command)");
        if (safeWidth >= 50) {
          detailLines.push(`  ${boldSafe(this.theme, "Command:")} ${fgSafe(this.theme, "accent", cmd)}`);
        } else {
          detailLines.push(`  $ ${cmd}`);
        }
      } else {
        const entries = Object.entries(args);
        if (entries.length > 0) {
          detailLines.push(`  ${boldSafe(this.theme, "Args:")} ${dimSafe(this.theme, JSON.stringify(args))}`);
        }
      }

      // Content inspection per tool type
      if (tool.name === "edit") {
        const diffText = typeof tool.result === "string" ? tool.result : typeof args.diff === "string" ? args.diff : "";
        const hunks = parseDiffHunks(diffText);
        let adds = 0;
        let dels = 0;
        for (const h of hunks) {
          for (const l of h.lines) {
            if (l.type === "add") adds++;
            else if (l.type === "del") dels++;
          }
        }
        detailLines.push(`  ${boldSafe(this.theme, "Changes:")} ${fgSafe(this.theme, "toolDiffAdded", `+${adds}`)} / ${fgSafe(this.theme, "toolDiffRemoved", `-${dels}`)} (${hunks.length} hunk${hunks.length === 1 ? "" : "s"})`);
        detailLines.push("");

        if (hunks.length === 0) {
          detailLines.push(`  ${dimSafe(this.theme, "(no diff content)")}`);
        } else {
          for (const hunk of hunks) {
            detailLines.push(`  ${fgSafe(this.theme, "toolDiffContext", hunk.header)}`);
            for (const l of hunk.lines) {
              if (l.type === "add") {
                const num = safeWidth >= 50 && l.newLine ? String(l.newLine).padStart(4) + " " : "+ ";
                detailLines.push(`  ${fgSafe(this.theme, "toolDiffAdded", `${num}${l.text}`)}`);
              } else if (l.type === "del") {
                const num = safeWidth >= 50 && l.oldLine ? String(l.oldLine).padStart(4) + " " : "- ";
                detailLines.push(`  ${fgSafe(this.theme, "toolDiffRemoved", `${num}${l.text}`)}`);
              } else {
                const num = safeWidth >= 50 && l.newLine ? String(l.newLine).padStart(4) + " " : "  ";
                detailLines.push(`  ${fgSafe(this.theme, "toolDiffContext", `${num}${l.text}`)}`);
              }
            }
          }
        }
      } else if (tool.name === "read") {
        const text = typeof tool.result === "string" ? tool.result : "";
        const linesArr = text ? text.split("\n") : [];
        const byteCount = Buffer.byteLength(text, "utf8");
        detailLines.push(`  ${boldSafe(this.theme, "Stats:")} ${linesArr.length} line${linesArr.length === 1 ? "" : "s"} (${byteCount} bytes)`);
        detailLines.push("");
        if (linesArr.length === 0) {
          detailLines.push(`  ${dimSafe(this.theme, "(empty file)")}`);
        } else {
          for (let li = 0; li < linesArr.length; li++) {
            const num = safeWidth >= 50 ? `${String(li + 1).padStart(4)} │ ` : "";
            detailLines.push(`  ${dimSafe(this.theme, num)}${linesArr[li]}`);
          }
        }
      } else if (tool.name === "write") {
        const text = typeof args.content === "string" ? args.content : typeof tool.result === "string" ? tool.result : "";
        const linesArr = text ? text.split("\n") : [];
        const byteCount = Buffer.byteLength(text, "utf8");
        detailLines.push(`  ${boldSafe(this.theme, "Written:")} ${linesArr.length} line${linesArr.length === 1 ? "" : "s"} (${byteCount} bytes)`);
        detailLines.push("");
        if (linesArr.length === 0) {
          detailLines.push(`  ${dimSafe(this.theme, "(no content)")}`);
        } else {
          for (let li = 0; li < linesArr.length; li++) {
            const num = safeWidth >= 50 ? `${String(li + 1).padStart(4)} │ ` : "";
            detailLines.push(`  ${dimSafe(this.theme, num)}${linesArr[li]}`);
          }
        }
      } else if (tool.name === "bash" || tool.name === "powershell") {
        if (tool.isError) {
          detailLines.push(`  ${fgSafe(this.theme, "error", "Execution failed / returned error")}`);
        } else if (tool.outcome === "interrupted") {
          detailLines.push(`  ${fgSafe(this.theme, "warning", "Execution interrupted / cancelled")}`);
        }
        detailLines.push("");
        const text = typeof tool.result === "string" ? tool.result : "";
        const linesArr = text ? text.split("\n") : [];
        if (linesArr.length === 0) {
          detailLines.push(`  ${dimSafe(this.theme, "(no output)")}`);
        } else {
          for (const outLine of linesArr) {
            if (tool.isError) {
              detailLines.push(`  ${fgSafe(this.theme, "error", outLine)}`);
            } else {
              detailLines.push(`  ${outLine}`);
            }
          }
        }
      } else {
        // Custom tools
        if (tool.isError) {
          detailLines.push(`  ${fgSafe(this.theme, "error", "Tool reported failure")}`);
        }
        detailLines.push(`  ${boldSafe(this.theme, "Arguments:")}`);
        detailLines.push(`  ${dimSafe(this.theme, JSON.stringify(tool.args, null, 2).replace(/\n/g, "\n  "))}`);
        detailLines.push("");
        detailLines.push(`  ${boldSafe(this.theme, "Result:")}`);
        const text = typeof tool.result === "string" ? tool.result : "";
        if (text) {
          for (const line of text.split("\n")) {
            detailLines.push(`  ${line}`);
          }
        } else {
          detailLines.push(`  ${dimSafe(this.theme, "(no result)")}`);
        }
      }

      // Slicing and scrolling detail lines
      const maxDetailVisible = 12;
      const maxScroll = Math.max(0, detailLines.length - maxDetailVisible);
      this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
      const visibleSlice = detailLines.slice(this.scrollOffset, this.scrollOffset + maxDetailVisible);

      for (const line of visibleSlice) {
        lines.push(clampLine(line));
      }

      if (detailLines.length > maxDetailVisible) {
        lines.push(
          clampLine(`  ${dimSafe(this.theme, `[Scroll ${this.scrollOffset + 1}-${Math.min(detailLines.length, this.scrollOffset + maxDetailVisible)} of ${detailLines.length} (PgUp/PgDn to page)]`)}`)
        );
      }
    }

    // --- Section 6: Bottom Border ---
    lines.push(clampLine(this.borderBottom.render(safeWidth)[0] ?? "─".repeat(safeWidth)));

    // --- Section 7: Footer Hints & Status Toast ---
    if (this.toastMessage) {
      lines.push(clampLine(`  ${boldSafe(this.theme, fgSafe(this.theme, "accent", `✔ ${this.toastMessage}`))}`));
    } else {
      if (safeWidth >= 70) {
        lines.push(clampLine(`  ${dimSafe(this.theme, "↑/↓: nav/scroll · Tab: switch focus · c/y: copy · Esc/q: close")}`));
      } else if (safeWidth >= 40) {
        lines.push(clampLine(`  ${dimSafe(this.theme, "↑/↓: nav · Tab: focus · c: copy · Esc: close")}`));
      } else {
        lines.push(clampLine(`  ${dimSafe(this.theme, "Tab:focus c:copy q:close")}`));
      }
    }

    return lines;
  }
}

export const createToolInspectorComponent: ToolInspectorFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: ToolInspectorOptions,
): Component => {
  return new ToolInspectorComponent(tui, theme, keybindings, done, ctx, options);
};

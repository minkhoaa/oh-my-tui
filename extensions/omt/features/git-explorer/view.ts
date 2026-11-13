

import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, type Component, type KeybindingsManager, type TUI, matchesKey, Key, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { GitFileStatus, GitExplorerFactory } from "./types.ts";
import { getBorderStyler } from "../../presets/shared/style.ts";
import { type GitExplorerOptions, type StagedFilterMode, fgSafe, boldSafe, dimSafe, diffAddedSafe, diffRemovedSafe, diffContextSafe, fitToWidth, getStatusGlyph, copyGitContent, parseDiffHunks, extractGitBranch, extractGitStatus, extractGitDiff } from "./model.ts";

export class GitChangesExplorerComponent extends Container implements Component {
  private tui: { requestRender(): void };
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options?: GitExplorerOptions;
  private cwd: string;

  // State
  private allFiles: GitFileStatus[] = [];
  private diffCache = new Map<string, string>();
  private branch = "HEAD";
  private stagedFilter: StagedFilterMode = "all";
  private selectedIndex = 0;
  private focus: "files" | "diff" = "files";
  private fileListScroll = 0;
  private diffScrollOffset = 0;
  private isGitRepo = true;

  // Toast
  private toastMessage: string | null = null;
  private toastTimeout: NodeJS.Timeout | null = null;

  // Borders
  private borderTop: DynamicBorder;
  private borderMid: DynamicBorder;
  private borderBottom: DynamicBorder;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options?: GitExplorerOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;
    this.cwd = ctx?.cwd ?? process.cwd();

    // Initial filter setting
    if (options?.initialStaged !== undefined) {
      this.stagedFilter = options.initialStaged ? "staged" : "unstaged";
    } else {
      this.stagedFilter = "all";
    }

    // In-memory diffs preload
    if (options?.diffs) {
      for (const [k, v] of Object.entries(options.diffs)) {
        this.diffCache.set(k, v);
      }
    }

    // Branch preselection
    if (options && "branch" in options && typeof (options as any).branch === "string") {
      this.branch = (options as any).branch;
    }

    // Synchronous files initialization
    if (options?.files) {
      this.allFiles = [...options.files];
      this.initSelection();
    } else {
      // Background async git discovery
      void this.loadGitData();
    }

    const borderStyle = getBorderStyler(theme);
    this.borderTop = new DynamicBorder(borderStyle);
    this.borderMid = new DynamicBorder(borderStyle);
    this.borderBottom = new DynamicBorder(borderStyle);

    this.addChild(this.borderTop);
    this.addChild(this.borderMid);
    this.addChild(this.borderBottom);
  }

  private initSelection(): void {
    const filtered = this.getFilteredFiles();
    if (filtered.length > 0) {
      if (this.options?.selectedFile) {
        const idx = filtered.findIndex((f) => f.path === this.options!.selectedFile);
        this.selectedIndex = idx >= 0 ? idx : 0;
      } else {
        this.selectedIndex = 0;
      }
    } else {
      this.selectedIndex = -1;
    }
  }

  async loadGitData(): Promise<void> {
    try {
      const [files, branch] = await Promise.all([
        extractGitStatus(this.cwd, this.options),
        extractGitBranch(this.cwd, this.options),
      ]);
      this.allFiles = files;
      this.branch = branch;
      this.isGitRepo = true;
      this.initSelection();
    } catch {
      this.allFiles = [];
      this.isGitRepo = false;
      this.selectedIndex = -1;
    }
    this.tui.requestRender();
  }

  // --- Getters for testing and introspection ---

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getFocus(): "files" | "diff" {
    return this.focus;
  }

  getFiles(): GitFileStatus[] {
    return [...this.allFiles];
  }

  getFilteredFiles(): GitFileStatus[] {
    if (this.stagedFilter === "staged") {
      return this.allFiles.filter((f) => f.staged);
    }
    if (this.stagedFilter === "unstaged") {
      return this.allFiles.filter((f) => !f.staged);
    }
    return this.allFiles;
  }

  getSelectedFile(): GitFileStatus | undefined {
    const filtered = this.getFilteredFiles();
    return this.selectedIndex >= 0 && this.selectedIndex < filtered.length
      ? filtered[this.selectedIndex]
      : undefined;
  }

  getScrollOffset(): number {
    return this.diffScrollOffset;
  }

  getStagedFilter(): StagedFilterMode {
    return this.stagedFilter;
  }

  getStagedCount(): number {
    return this.allFiles.filter((f) => f.staged).length;
  }

  getUnstagedCount(): number {
    return this.allFiles.filter((f) => !f.staged && f.status !== "untracked").length;
  }

  getUntrackedCount(): number {
    return this.allFiles.filter((f) => f.status === "untracked").length;
  }

  getBranch(): string {
    return this.branch;
  }

  getDiffContent(file?: GitFileStatus): string {
    const target = file ?? this.getSelectedFile();
    if (!target) return "";
    const key = `${target.staged ? "staged:" : "unstaged:"}${target.path}`;
    if (this.diffCache.has(key)) return this.diffCache.get(key)!;
    if (this.diffCache.has(target.path)) return this.diffCache.get(target.path)!;

    // Trigger async diff loading
    void extractGitDiff(this.cwd, target.path, target.staged, this.options).then((diff) => {
      this.diffCache.set(key, diff);
      // Auto-compute additions/deletions if missing
      if (target.additions === undefined || target.deletions === undefined) {
        const hunks = parseDiffHunks(diff);
        let adds = 0;
        let dels = 0;
        for (const h of hunks) {
          for (const l of h.lines) {
            if (l.type === "add") adds++;
            else if (l.type === "del") dels++;
          }
        }
        target.additions = adds;
        target.deletions = dels;
      }
      this.tui.requestRender();
    });

    return "";
  }

  // --- Mutators ---

  setStagedFilter(mode: StagedFilterMode): void {
    this.stagedFilter = mode;
    const filtered = this.getFilteredFiles();
    if (this.selectedIndex >= filtered.length) {
      this.selectedIndex = Math.max(0, filtered.length - 1);
    }
    this.fileListScroll = 0;
    this.diffScrollOffset = 0;
    this.tui.requestRender();
  }

  toggleStagedFilter(): void {
    if (this.options?.initialStaged !== undefined) {
      this.setStagedFilter(this.stagedFilter === "staged" ? "unstaged" : "staged");
    } else {
      if (this.stagedFilter === "all") {
        this.setStagedFilter("staged");
      } else if (this.stagedFilter === "staged") {
        this.setStagedFilter("unstaged");
      } else {
        this.setStagedFilter("all");
      }
    }
  }

  setFocus(focus: "files" | "diff"): void {
    this.focus = focus;
    this.tui.requestRender();
  }

  // --- Input Handling ---

  handleInput(data: string): void {
    // 1. Close: Esc or 'q' / 'Q'
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
      this.focus = this.focus === "files" ? "diff" : "files";
      this.tui.requestRender();
      return;
    }

    // 3. Enter: switch focus to diff if on files
    if (
      (matchesKey(data, Key.enter) || data === "\r" || data === "\n") &&
      this.focus === "files" &&
      this.getFilteredFiles().length > 0
    ) {
      this.focus = "diff";
      this.tui.requestRender();
      return;
    }

    // 4. Toggle staged vs unstaged filter: 's' / 'S'
    if (data === "s" || data === "S") {
      this.toggleStagedFilter();
      return;
    }

    // 5. Up Arrow
    if (matchesKey(data, Key.up) || data === "\x1b[A") {
      if (this.focus === "files") {
        if (this.selectedIndex > 0) {
          this.selectedIndex--;
          this.diffScrollOffset = 0;
          if (this.selectedIndex < this.fileListScroll) {
            this.fileListScroll = this.selectedIndex;
          }
          this.tui.requestRender();
        }
      } else {
        if (this.diffScrollOffset > 0) {
          this.diffScrollOffset--;
          this.tui.requestRender();
        }
      }
      return;
    }

    // 6. Down Arrow
    if (matchesKey(data, Key.down) || data === "\x1b[B") {
      const filtered = this.getFilteredFiles();
      if (this.focus === "files") {
        if (this.selectedIndex < filtered.length - 1) {
          this.selectedIndex++;
          this.diffScrollOffset = 0;
          const maxVisible = 6;
          if (this.selectedIndex >= this.fileListScroll + maxVisible) {
            this.fileListScroll = this.selectedIndex - maxVisible + 1;
          }
          this.tui.requestRender();
        }
      } else {
        this.diffScrollOffset++;
        this.tui.requestRender();
      }
      return;
    }

    // 7. Page Up
    if (matchesKey(data, Key.pageUp) || data === "\x1b[5~") {
      if (this.focus === "diff") {
        this.diffScrollOffset = Math.max(0, this.diffScrollOffset - 10);
      } else {
        this.selectedIndex = Math.max(0, this.selectedIndex - 5);
        this.fileListScroll = Math.max(0, this.fileListScroll - 5);
      }
      this.tui.requestRender();
      return;
    }

    // 8. Page Down
    if (matchesKey(data, Key.pageDown) || data === "\x1b[6~") {
      const filtered = this.getFilteredFiles();
      if (this.focus === "diff") {
        this.diffScrollOffset += 10;
      } else {
        this.selectedIndex = Math.min(filtered.length - 1, this.selectedIndex + 5);
      }
      this.tui.requestRender();
      return;
    }

    // 9. Copy: 'c', 'C', 'y', 'Y'
    if (data === "c" || data === "C" || data === "y" || data === "Y") {
      const current = this.getSelectedFile();
      if (current) {
        const textToCopy =
          this.focus === "diff"
            ? this.getDiffContent(current) || current.path
            : current.path;

        this.toastMessage = "Copying...";
        this.tui.requestRender();

        void copyGitContent(textToCopy).then((success) => {
          this.toastMessage = success
            ? this.focus === "diff"
              ? "Copied diff to clipboard!"
              : "Copied file path to clipboard!"
            : "Copy failed (clipboard unavailable)";

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

  // --- Rendering ---

  override render(width: number): string[] {
    const safeWidth = Math.max(10, width || 80);
    const clampLine = (line: string): string => {
      if (visibleWidth(line) > safeWidth) {
        return truncateToWidth(line, safeWidth, "");
      }
      return line;
    };

    const lines: string[] = [];

    // --- Section 1: Header with Repo / Branch & Counts ---
    const stagedCount = this.getStagedCount();
    const unstagedCount = this.getUnstagedCount();
    const untrackedCount = this.getUntrackedCount();

    if (safeWidth >= 100) {
      const title = `${boldSafe(this.theme, fgSafe(this.theme, "accent", "◆ Git Explorer"))} ${fgSafe(this.theme, "muted", `⎇ ${this.branch}`)}`;
      const counts = `${fgSafe(this.theme, "success", `● ${stagedCount} staged`)} · ${fgSafe(this.theme, "warning", `○ ${unstagedCount} unstaged`)} · ${fgSafe(this.theme, "muted", `? ${untrackedCount} untracked`)}`;
      const filterBadge = fgSafe(this.theme, "accent", `[Filter: ${this.stagedFilter}]`);
      const focusBadge = fgSafe(this.theme, "accent", `[Focus: ${this.focus === "files" ? "Files" : "Diff"}]`);
      lines.push(clampLine(` ${title}  ${counts}  ${filterBadge} ${focusBadge}`));
    } else if (safeWidth >= 65) {
      const title = `${boldSafe(this.theme, fgSafe(this.theme, "accent", "◆ Git"))} (${this.branch})`;
      const counts = `${fgSafe(this.theme, "success", `${stagedCount}S`)} ${fgSafe(this.theme, "warning", `${unstagedCount}U`)} ${fgSafe(this.theme, "muted", `${untrackedCount}?`)}`;
      const focusBadge = fgSafe(this.theme, "accent", `[${this.focus}] [${this.stagedFilter}]`);
      lines.push(clampLine(` ${title} │ ${counts} │ ${focusBadge}`));
    } else if (safeWidth >= 35) {
      const title = `${boldSafe(this.theme, "Git")} (${this.branch})`;
      const counts = `[${stagedCount}S ${unstagedCount}U ${untrackedCount}?]`;
      const badge = `[${this.focus}]`;
      lines.push(clampLine(` ${title} ${counts} ${badge}`));
    } else {
      lines.push(clampLine(` ${boldSafe(this.theme, "Git")} [${stagedCount}S ${unstagedCount}U]`));
    }

    // --- Section 2: Top Border ---
    lines.push(clampLine(this.borderTop.render(safeWidth)[0] ?? "─".repeat(safeWidth)));

    const filtered = this.getFilteredFiles();
    const current = this.getSelectedFile();

    // Prepare diff lines for current file
    const diffRaw = current ? this.getDiffContent(current) : "";
    const hunks = parseDiffHunks(diffRaw);

    const formattedDiffLines: string[] = [];
    if (!current) {
      formattedDiffLines.push(dimSafe(this.theme, "  No file selected"));
    } else if (!diffRaw && hunks.length === 0) {
      formattedDiffLines.push(dimSafe(this.theme, "  (no diff content)"));
    } else {
      let totalAdds = 0;
      let totalDels = 0;
      for (const h of hunks) {
        for (const l of h.lines) {
          if (l.type === "add") totalAdds++;
          else if (l.type === "del") totalDels++;
        }
      }

      for (const hunk of hunks) {
        formattedDiffLines.push(`  ${diffContextSafe(this.theme, hunk.header)}`);
        for (const l of hunk.lines) {
          if (l.type === "add") {
            const num = safeWidth >= 50 && l.newLine ? String(l.newLine).padStart(4) + " " : "+ ";
            formattedDiffLines.push(`  ${diffAddedSafe(this.theme, `${num}${l.text}`)}`);
          } else if (l.type === "del") {
            const num = safeWidth >= 50 && l.oldLine ? String(l.oldLine).padStart(4) + " " : "- ";
            formattedDiffLines.push(`  ${diffRemovedSafe(this.theme, `${num}${l.text}`)}`);
          } else {
            const num = safeWidth >= 50 && l.newLine ? String(l.newLine).padStart(4) + " " : "  ";
            formattedDiffLines.push(`  ${diffContextSafe(this.theme, `${num}${l.text}`)}`);
          }
        }
      }
    }

    // --- Section 3: Pane Layout (Side-by-Side when width >= 80, Stacked when narrow) ---
    if (safeWidth >= 80) {
      // Split Pane layout
      const leftWidth = Math.min(38, Math.max(26, Math.floor(safeWidth * 0.32)));
      const divider = " │ ";
      const rightWidth = safeWidth - leftWidth - visibleWidth(divider);

      // Build left pane rows
      const leftRows: string[] = [];
      const leftHeader = this.focus === "files"
        ? boldSafe(this.theme, fgSafe(this.theme, "accent", ` Changed Files (${filtered.length})`))
        : dimSafe(this.theme, ` Changed Files (${filtered.length})`);
      leftRows.push(fitToWidth(leftHeader, leftWidth));

      if (filtered.length === 0) {
        leftRows.push(fitToWidth(dimSafe(this.theme, "  Working tree clean"), leftWidth));
      } else {
        const maxVisible = 10;
        const start = this.fileListScroll;
        const end = Math.min(filtered.length, start + maxVisible);

        for (let i = start; i < end; i++) {
          const file = filtered[i]!;
          const isSelected = i === this.selectedIndex;
          const cursor = isSelected
            ? (this.focus === "files" ? boldSafe(this.theme, fgSafe(this.theme, "accent", "▶ ")) : fgSafe(this.theme, "muted", "▷ "))
            : "  ";

          const stageGlyph = file.staged
            ? fgSafe(this.theme, "success", "[S]")
            : file.status === "untracked"
              ? dimSafe(this.theme, "[?]")
              : fgSafe(this.theme, "warning", "[U]");

          const statusGlyph = file.status === "added"
            ? fgSafe(this.theme, "success", "A")
            : file.status === "deleted"
              ? fgSafe(this.theme, "error", "D")
              : file.status === "renamed"
                ? fgSafe(this.theme, "accent", "R")
                : file.status === "untracked"
                  ? dimSafe(this.theme, "?")
                  : fgSafe(this.theme, "warning", "M");

          // File stats
          let statsStr = "";
          if (file.additions !== undefined || file.deletions !== undefined) {
            const add = file.additions ?? 0;
            const del = file.deletions ?? 0;
            statsStr = ` ${diffAddedSafe(this.theme, `+${add}`)}/${diffRemovedSafe(this.theme, `-${del}`)}`;
          }

          const nameStr = isSelected
            ? boldSafe(this.theme, fgSafe(this.theme, "accent", file.path))
            : file.path;

          const rowContent = `${cursor}${stageGlyph} ${statusGlyph} ${nameStr}${statsStr}`;
          leftRows.push(fitToWidth(rowContent, leftWidth));
        }

        if (filtered.length > maxVisible) {
          leftRows.push(
            fitToWidth(dimSafe(this.theme, `  [${start + 1}-${end} of ${filtered.length}]`), leftWidth),
          );
        }
      }

      // Build right pane rows
      const rightRows: string[] = [];
      const statsBadge = current && (current.additions !== undefined || current.deletions !== undefined)
        ? ` (${diffAddedSafe(this.theme, `+${current.additions ?? 0}`)} / ${diffRemovedSafe(this.theme, `-${current.deletions ?? 0}`)})`
        : "";

      const rightHeader = this.focus === "diff"
        ? boldSafe(this.theme, fgSafe(this.theme, "accent", ` Diff: ${current?.path ?? "(no file)"}${statsBadge}`))
        : dimSafe(this.theme, ` Diff: ${current?.path ?? "(no file)"}${statsBadge}`);
      rightRows.push(fitToWidth(rightHeader, rightWidth));

      const maxDiffVisible = 10;
      const maxScroll = Math.max(0, formattedDiffLines.length - maxDiffVisible);
      this.diffScrollOffset = Math.min(this.diffScrollOffset, maxScroll);
      const diffSlice = formattedDiffLines.slice(this.diffScrollOffset, this.diffScrollOffset + maxDiffVisible);

      for (const line of diffSlice) {
        rightRows.push(fitToWidth(line, rightWidth));
      }

      if (formattedDiffLines.length > maxDiffVisible) {
        rightRows.push(
          fitToWidth(
            dimSafe(
              this.theme,
              `  [Scroll ${this.diffScrollOffset + 1}-${Math.min(formattedDiffLines.length, this.diffScrollOffset + maxDiffVisible)} of ${formattedDiffLines.length}]`,
            ),
            rightWidth,
          ),
        );
      }

      // Combine side-by-side rows
      const totalRows = Math.max(leftRows.length, rightRows.length);
      for (let r = 0; r < totalRows; r++) {
        const left = leftRows[r] ?? " ".repeat(leftWidth);
        const right = rightRows[r] ?? "";
        const combined = `${left}${dimSafe(this.theme, divider)}${right}`;
        lines.push(clampLine(combined));
      }
    } else {
      // Stacked Top / Bottom Layout for narrow viewports (< 80 cols)
      // Top: Changed Files
      const filesHeader = ` ${boldSafe(this.theme, "Files")} (${filtered.length}) ${dimSafe(this.theme, `[${this.stagedFilter}]`)}`;
      lines.push(clampLine(filesHeader));

      if (filtered.length === 0) {
        lines.push(clampLine(`  ${dimSafe(this.theme, "Working tree clean")}`));
      } else {
        const maxVisible = 5;
        const start = this.fileListScroll;
        const end = Math.min(filtered.length, start + maxVisible);

        for (let i = start; i < end; i++) {
          const file = filtered[i]!;
          const isSelected = i === this.selectedIndex;
          const cursor = isSelected
            ? (this.focus === "files" ? boldSafe(this.theme, fgSafe(this.theme, "accent", "▶ ")) : fgSafe(this.theme, "muted", "▷ "))
            : "  ";

          const stageGlyph = file.staged ? "[S]" : file.status === "untracked" ? "[?]" : "[U]";
          const statusGlyph = getStatusGlyph(file.status);

          let stat = "";
          if (safeWidth >= 40 && (file.additions !== undefined || file.deletions !== undefined)) {
            stat = ` +${file.additions ?? 0}/-${file.deletions ?? 0}`;
          }

          lines.push(clampLine(`${cursor}${stageGlyph} ${statusGlyph} ${file.path}${stat}`));
        }

        if (filtered.length > maxVisible) {
          lines.push(clampLine(`  ${dimSafe(this.theme, `[${start + 1}-${end} of ${filtered.length}]`)}`));
        }
      }

      // Middle Border
      lines.push(clampLine(this.borderMid.render(safeWidth)[0] ?? "─".repeat(safeWidth)));

      // Bottom: Diff Viewer
      const diffTitle = current
        ? ` Diff: ${current.path}`
        : " Diff: (no file)";
      lines.push(clampLine(boldSafe(this.theme, diffTitle)));

      const maxDiffVisible = 7;
      const maxScroll = Math.max(0, formattedDiffLines.length - maxDiffVisible);
      this.diffScrollOffset = Math.min(this.diffScrollOffset, maxScroll);
      const diffSlice = formattedDiffLines.slice(this.diffScrollOffset, this.diffScrollOffset + maxDiffVisible);

      for (const line of diffSlice) {
        lines.push(clampLine(line));
      }

      if (formattedDiffLines.length > maxDiffVisible) {
        lines.push(
          clampLine(
            dimSafe(
              this.theme,
              `  [Scroll ${this.diffScrollOffset + 1}-${Math.min(formattedDiffLines.length, this.diffScrollOffset + maxDiffVisible)} of ${formattedDiffLines.length}]`,
            ),
          ),
        );
      }
    }

    // --- Section 4: Bottom Border ---
    lines.push(clampLine(this.borderBottom.render(safeWidth)[0] ?? "─".repeat(safeWidth)));

    // --- Section 5: Footer Hints & Status Toast ---
    if (this.toastMessage) {
      lines.push(clampLine(`  ${boldSafe(this.theme, fgSafe(this.theme, "accent", `✔ ${this.toastMessage}`))}`));
    } else {
      if (safeWidth >= 80) {
        lines.push(
          clampLine(`  ${dimSafe(this.theme, "↑/↓: nav/scroll · Tab: switch pane · s: toggle filter · c: copy · Esc/q: close")}`),
        );
      } else if (safeWidth >= 45) {
        lines.push(
          clampLine(`  ${dimSafe(this.theme, "↑/↓: nav · Tab: pane · s: filter · c: copy · Esc: close")}`),
        );
      } else {
        lines.push(clampLine(`  ${dimSafe(this.theme, "Tab:pane s:filter q:close")}`));
      }
    }

    return lines;
  }
}

export { GitChangesExplorerComponent as GitExplorerComponent };

export const createGitExplorerComponent: GitExplorerFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: GitExplorerOptions,
): Component => {
  return new GitChangesExplorerComponent(tui, theme, keybindings, done, ctx, options);
};

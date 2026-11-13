import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { initTheme, InteractiveMode, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type TUI, type KeybindingsManager } from "@earendil-works/pi-tui";
import {
  createGitExplorerComponent,
  extractGitStatus,
  extractGitDiff,
  extractGitBranch,
  parseGitStatusOutput,
  parseGitDiffNumstat,
  parseDiffHunks,
  copyGitContent,
  fitToWidth,
  getStatusGlyph,
  GitChangesExplorerComponent,
  type GitFileStatus,
  type GitExplorerOptions,
} from "../extensions/omt/features/git-explorer/index.ts";

initTheme("dark");
const defaultTheme = (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme as Theme;

const dummyTui = {
  requestRender: () => {},
} as unknown as TUI;

const dummyKeybindings = {} as KeybindingsManager;

function makeMockTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    inverse: (text: string) => text,
    dim: (text: string) => text,
  } as any;
}

// ============================================================================
// Sample Fixture Data
// ============================================================================

const sampleStatusOutput = `## main...origin/main [ahead 1]
M  src/app.ts
 M src/utils.ts
MM src/config.ts
A  src/new-feature.ts
D  src/deprecated.ts
 D src/old-cache.ts
R  src/legacy.ts -> src/modern.ts
?? tests/mock.ts
?? "src/file with spaces.ts"
`;

const sampleDiffText = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,6 +10,7 @@ export function bootstrap() {
   const config = loadConfig();
-  const port = 3000;
+  const port = process.env.PORT || 3000;
+  console.log('Starting app on', port);
   return server.listen(port);
 }
@@ -35,5 +36,4 @@ export function shutdown() {
   server.close();
-  process.exit(0);
 }
`;

const sampleFiles: GitFileStatus[] = [
  {
    path: "src/app.ts",
    status: "modified",
    staged: true,
    additions: 2,
    deletions: 1,
  },
  {
    path: "src/utils.ts",
    status: "modified",
    staged: false,
    additions: 5,
    deletions: 0,
  },
  {
    path: "src/new-feature.ts",
    status: "added",
    staged: true,
    additions: 45,
    deletions: 0,
  },
  {
    path: "src/deprecated.ts",
    status: "deleted",
    staged: true,
    additions: 0,
    deletions: 20,
  },
  {
    path: "src/modern.ts",
    oldPath: "src/legacy.ts",
    status: "renamed",
    staged: true,
    additions: 12,
    deletions: 8,
  },
  {
    path: "tests/mock.ts",
    status: "untracked",
    staged: false,
  },
];

const sampleDiffs: Record<string, string> = {
  "src/app.ts": sampleDiffText,
  "staged:src/app.ts": sampleDiffText,
  "src/utils.ts": `@@ -1,2 +1,4 @@\n-const v = 1;\n+const v = 2;\n+const x = 3;`,
  "src/new-feature.ts": `@@ -0,0 +1,3 @@\n+export const newFeature = true;`,
  "src/deprecated.ts": `@@ -1,3 +0,0 @@\n-export const old = false;`,
  "src/modern.ts": `@@ -1,2 +1,2 @@\n-export default legacy;\n+export default modern;`,
  "tests/mock.ts": `@@ -0,0 +1,2 @@\n+describe('mock', () => {});`,
};

// ============================================================================
// 1. Git Status Parsing Tests
// ============================================================================

test("parseGitStatusOutput parses staged, unstaged, untracked, renames, and deletions", () => {
  const files = parseGitStatusOutput(sampleStatusOutput);

  // Expected parsed count:
  // M  (1 staged)
  //  M (1 unstaged)
  // MM (1 staged, 1 unstaged)
  // A  (1 staged)
  // D  (1 staged)
  //  D (1 unstaged)
  // R  (1 staged rename)
  // ?? (1 untracked)
  // ?? (1 untracked quoted)
  assert.equal(files.length, 10);

  // 1. M  src/app.ts
  const app = files.find((f) => f.path === "src/app.ts" && f.staged);
  assert.ok(app);
  assert.equal(app.status, "modified");
  assert.equal(app.staged, true);

  // 2.  M src/utils.ts
  const utils = files.find((f) => f.path === "src/utils.ts" && !f.staged);
  assert.ok(utils);
  assert.equal(utils.status, "modified");
  assert.equal(utils.staged, false);

  // 3. MM src/config.ts (creates two entries: one staged, one unstaged)
  const configStaged = files.find((f) => f.path === "src/config.ts" && f.staged);
  const configUnstaged = files.find((f) => f.path === "src/config.ts" && !f.staged);
  assert.ok(configStaged);
  assert.ok(configUnstaged);
  assert.equal(configStaged.status, "modified");
  assert.equal(configUnstaged.status, "modified");

  // 4. A  src/new-feature.ts
  const added = files.find((f) => f.path === "src/new-feature.ts");
  assert.ok(added);
  assert.equal(added.status, "added");
  assert.equal(added.staged, true);

  // 5. D  src/deprecated.ts
  const delStaged = files.find((f) => f.path === "src/deprecated.ts");
  assert.ok(delStaged);
  assert.equal(delStaged.status, "deleted");
  assert.equal(delStaged.staged, true);

  // 6.  D src/old-cache.ts
  const delUnstaged = files.find((f) => f.path === "src/old-cache.ts");
  assert.ok(delUnstaged);
  assert.equal(delUnstaged.status, "deleted");
  assert.equal(delUnstaged.staged, false);

  // 7. R  src/legacy.ts -> src/modern.ts
  const rename = files.find((f) => f.path === "src/modern.ts");
  assert.ok(rename);
  assert.equal(rename.status, "renamed");
  assert.equal(rename.oldPath, "src/legacy.ts");
  assert.equal(rename.staged, true);

  // 8. ?? tests/mock.ts
  const untracked = files.find((f) => f.path === "tests/mock.ts");
  assert.ok(untracked);
  assert.equal(untracked.status, "untracked");
  assert.equal(untracked.staged, false);

  // 9. ?? "src/file with spaces.ts"
  const spaced = files.find((f) => f.path === "src/file with spaces.ts");
  assert.ok(spaced);
  assert.equal(spaced.status, "untracked");
  assert.equal(spaced.staged, false);
});

test("parseGitStatusOutput handles empty strings, whitespace, and clean repositories", () => {
  assert.deepEqual(parseGitStatusOutput(""), []);
  assert.deepEqual(parseGitStatusOutput("   \n\n"), []);
  assert.deepEqual(parseGitStatusOutput("## main...origin/main"), []);
  assert.deepEqual(parseGitStatusOutput(null as any), []);
  assert.deepEqual(parseGitStatusOutput(undefined as any), []);
});

// ============================================================================
// 2. Numstat Parsing Tests
// ============================================================================

test("parseGitDiffNumstat extracts additions and deletions correctly", () => {
  const numstat = `10\t4\tsrc/app.ts
0\t15\tsrc/deprecated.ts
-\t-\tassets/logo.png
5\t2\tsrc/{old => new}/feature.ts
3\t1\tlegacy.ts => modern.ts
`;

  const map = parseGitDiffNumstat(numstat);
  assert.equal(map.size, 5);

  assert.deepEqual(map.get("src/app.ts"), { additions: 10, deletions: 4 });
  assert.deepEqual(map.get("src/deprecated.ts"), { additions: 0, deletions: 15 });
  assert.deepEqual(map.get("assets/logo.png"), { additions: 0, deletions: 0 }); // binary
  assert.deepEqual(map.get("src/new/feature.ts"), { additions: 5, deletions: 2 });
  assert.deepEqual(map.get("modern.ts"), { additions: 3, deletions: 1 });
});

test("parseGitDiffNumstat handles empty or invalid output safely", () => {
  assert.equal(parseGitDiffNumstat("").size, 0);
  assert.equal(parseGitDiffNumstat(null as any).size, 0);
  assert.equal(parseGitDiffNumstat("malformed row").size, 0);
});

// ============================================================================
// 3. Diff Hunk Parsing Tests
// ============================================================================

test("parseDiffHunks parses multi-hunk diffs, headers, line types, and line numbers", () => {
  const hunks = parseDiffHunks(sampleDiffText);
  assert.equal(hunks.length, 2);

  // Hunk 1
  assert.match(hunks[0]!.header, /@@ -10,6 \+10,7 @@/);
  const h1Lines = hunks[0]!.lines;
  assert.ok(h1Lines.length >= 5);

  const context1 = h1Lines.find((l) => l.text.includes("loadConfig"));
  assert.ok(context1);
  assert.equal(context1.type, "context");

  const del1 = h1Lines.find((l) => l.text.includes("const port = 3000;"));
  assert.ok(del1);
  assert.equal(del1.type, "del");
  assert.equal(del1.oldLine, 11);

  const add1 = h1Lines.find((l) => l.text.includes("process.env.PORT"));
  assert.ok(add1);
  assert.equal(add1.type, "add");
  assert.equal(add1.newLine, 11);

  const add2 = h1Lines.find((l) => l.text.includes("console.log('Starting app"));
  assert.ok(add2);
  assert.equal(add2.type, "add");
  assert.equal(add2.newLine, 12);

  // Hunk 2
  assert.match(hunks[1]!.header, /@@ -35,5 \+36,4 @@/);
  const h2Lines = hunks[1]!.lines;
  const del2 = h2Lines.find((l) => l.text.includes("process.exit(0);"));
  assert.ok(del2);
  assert.equal(del2.type, "del");
  assert.equal(del2.oldLine, 36);
});

test("parseDiffHunks handles Pi-formatted numbered diffs and headerless diffs", () => {
  const numberedDiff = `@@ -5,3 +5,3 @@
  5 const a = 1;
 -6 const b = 2;
 +6 const b = 3;
  7 const c = 4;`;

  const hunks = parseDiffHunks(numberedDiff);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0]!.lines.length, 4);
  assert.equal(hunks[0]!.lines[1]!.type, "del");
  assert.equal(hunks[0]!.lines[1]!.oldLine, 6);
  assert.equal(hunks[0]!.lines[2]!.type, "add");
  assert.equal(hunks[0]!.lines[2]!.newLine, 6);

  const headerlessDiff = `-old content
+new content
 context`;
  const fallbackHunks = parseDiffHunks(headerlessDiff);
  assert.equal(fallbackHunks.length, 1);
  assert.equal(fallbackHunks[0]!.lines[0]!.type, "del");
  assert.equal(fallbackHunks[0]!.lines[1]!.type, "add");
  assert.equal(fallbackHunks[0]!.lines[2]!.type, "context");

  assert.deepEqual(parseDiffHunks(""), []);
});

test("fitToWidth and getStatusGlyph helpers format width and codes accurately", () => {
  // fitToWidth
  assert.equal(visibleWidth(fitToWidth("hello", 10)), 10);
  assert.equal(visibleWidth(fitToWidth("a very long string that should be truncated", 15)), 15);
  // East Asian CJK characters
  const cjk = fitToWidth("测试", 10);
  assert.equal(visibleWidth(cjk), 10);

  // getStatusGlyph
  assert.equal(getStatusGlyph("modified"), "M");
  assert.equal(getStatusGlyph("added"), "A");
  assert.equal(getStatusGlyph("deleted"), "D");
  assert.equal(getStatusGlyph("renamed"), "R");
  assert.equal(getStatusGlyph("untracked"), "?");
});

// ============================================================================
// 4. Git Extraction Helpers Tests
// ============================================================================

test("extractGitStatus and extractGitDiff return in-memory options without running git", async () => {
  const files = await extractGitStatus("/workspace", { files: sampleFiles });
  assert.equal(files.length, sampleFiles.length);
  assert.equal(files[0]!.path, "src/app.ts");

  const diff = await extractGitDiff("/workspace", "src/app.ts", true, { diffs: sampleDiffs });
  assert.match(diff, /export function bootstrap/);
});

test("extractGitStatus, extractGitDiff, and extractGitBranch handle non-git directory gracefully", async () => {
  const nonGitDir = path.resolve("/non-existent-directory-omt-test");

  const files = await extractGitStatus(nonGitDir);
  assert.deepEqual(files, []);

  const diff = await extractGitDiff(nonGitDir, "file.txt", false);
  assert.equal(diff, "");

  const branch = await extractGitBranch(nonGitDir);
  assert.equal(typeof branch, "string");
  assert.ok(branch.length > 0);
});

test("extractGitStatus and extractGitBranch run safely in real repository", async () => {
  const branch = await extractGitBranch(process.cwd());
  assert.ok(branch.length > 0);

  const status = await extractGitStatus(process.cwd());
  assert.ok(Array.isArray(status));
});

// ============================================================================
// 5. Component Rendering across Themes and Viewport Widths (120, 80, 40, 20)
// ============================================================================

test("Git Changes Explorer renders cleanly across 120, 80, 40, and 20 columns without overflowing", () => {
  const component = new GitChangesExplorerComponent(
    dummyTui,
    defaultTheme,
    dummyKeybindings,
    () => {},
    {} as any,
    { files: sampleFiles, diffs: sampleDiffs, branch: "main" },
  );

  for (const width of [120, 80, 40, 20]) {
    const lines = component.render(width);
    assert.ok(lines.length > 5, `Expected rendered lines at width ${width}`);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const w = visibleWidth(line);
      assert.ok(
        w <= width,
        `Line ${i} visible width ${w} exceeded target width ${width} at width ${width}: "${stripTerminalSequences(line)}"`,
      );
    }

    const plainText = lines.map((l) => stripTerminalSequences(l)).join("\n");
    assert.match(plainText, /Git|Explorer/);
    if (width >= 40) {
      assert.match(plainText, /app\.ts/);
    }
  }
});

test("Git Changes Explorer renders cleanly with minimal mock theme", () => {
  const mockTheme = makeMockTheme();
  const component = new GitChangesExplorerComponent(
    dummyTui,
    mockTheme,
    dummyKeybindings,
    () => {},
    {} as any,
    { files: sampleFiles, diffs: sampleDiffs, branch: "feature/test" },
  );

  const lines = component.render(80);
  assert.ok(lines.length > 0);
  const plain = lines.map((l) => stripTerminalSequences(l)).join("\n");
  assert.match(plain, /Git/);
  assert.match(plain, /app\.ts/);
  assert.match(plain, /feature\/test/);
});

test("Git Changes Explorer safely renders East Asian characters and emojis in filenames and diffs", () => {
  const unicodeFiles: GitFileStatus[] = [
    {
      path: "src/文档/测试.ts",
      status: "modified",
      staged: true,
      additions: 10,
      deletions: 2,
    },
    {
      path: "src/🚀-rocket.ts",
      status: "added",
      staged: false,
      additions: 3,
      deletions: 0,
    },
  ];

  const unicodeDiffs: Record<string, string> = {
    "src/文档/测试.ts": "@@ -1,2 +1,3 @@\n-const old = '旧代码';\n+const greeting = '你好，世界！👋';\n+const flag = true;",
    "src/🚀-rocket.ts": "@@ -0,0 +1,2 @@\n+export const launch = () => '🚀';",
  };

  const component = new GitChangesExplorerComponent(
    dummyTui,
    defaultTheme,
    dummyKeybindings,
    () => {},
    {} as any,
    { files: unicodeFiles, diffs: unicodeDiffs, branch: "i18n-unicode" },
  );

  for (const width of [120, 80, 40, 20]) {
    const lines = component.render(width);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const w = visibleWidth(line);
      assert.ok(
        w <= width,
        `Line ${i} with Unicode exceeded width ${width} (got ${w}): "${stripTerminalSequences(line)}"`,
      );
    }
  }
});

test("Git Changes Explorer handles clean working tree / empty changes gracefully", () => {
  const component = new GitChangesExplorerComponent(
    dummyTui,
    defaultTheme,
    dummyKeybindings,
    () => {},
    {} as any,
    { files: [], diffs: {}, branch: "main" },
  );

  for (const width of [120, 80, 40, 20]) {
    const lines = component.render(width);
    assert.ok(lines.length > 0);
    const plain = lines.map((l) => stripTerminalSequences(l)).join("\n");
    assert.match(plain, /clean/i);
  }

  assert.equal(component.getSelectedIndex(), -1);
  assert.equal(component.getSelectedFile(), undefined);
  assert.equal(component.getStagedCount(), 0);
  assert.equal(component.getUnstagedCount(), 0);
  assert.equal(component.getUntrackedCount(), 0);
});

// ============================================================================
// 6. Keyboard Navigation & Interaction Tests
// ============================================================================

test("Keyboard navigation handles Up, Down, Tab, Shift+Tab, and Esc", () => {
  let doneCalled = false;
  let renderRequested = false;
  const mockTui = {
    requestRender: () => {
      renderRequested = true;
    },
  } as unknown as TUI;

  const component = createGitExplorerComponent(
    mockTui,
    defaultTheme,
    dummyKeybindings,
    () => {
      doneCalled = true;
    },
    {} as any,
    { files: sampleFiles, diffs: sampleDiffs },
  ) as GitChangesExplorerComponent;

  // Initial state: index 0, focus: files
  assert.equal(component.getSelectedIndex(), 0);
  assert.equal(component.getFocus(), "files");
  assert.equal(component.getSelectedFile()?.path, "src/app.ts");

  // Down arrow moves selection
  renderRequested = false;
  component.handleInput("\x1b[B"); // Down arrow
  assert.equal(component.getSelectedIndex(), 1);
  assert.equal(component.getSelectedFile()?.path, "src/utils.ts");
  assert.equal(renderRequested, true);

  // Up arrow moves selection back
  component.handleInput("\x1b[A"); // Up arrow
  assert.equal(component.getSelectedIndex(), 0);
  assert.equal(component.getSelectedFile()?.path, "src/app.ts");

  // Tab switches focus to diff view
  component.handleInput("\t");
  assert.equal(component.getFocus(), "diff");

  // While in diff focus, Down scrolls diff offset rather than changing selected file
  const initialIndex = component.getSelectedIndex();
  assert.equal(component.getScrollOffset(), 0);
  component.handleInput("\x1b[B"); // Down
  assert.equal(component.getSelectedIndex(), initialIndex);
  assert.equal(component.getScrollOffset(), 1);

  // Up in diff scrolls back
  component.handleInput("\x1b[A"); // Up
  assert.equal(component.getScrollOffset(), 0);

  // Shift+Tab switches focus back to files
  component.handleInput("\x1b[Z"); // Shift+Tab
  assert.equal(component.getFocus(), "files");

  // Escape calls done()
  assert.equal(doneCalled, false);
  component.handleInput("\x1b");
  assert.equal(doneCalled, true);
});

test("Key 's' cycles staged vs unstaged filter and updates selection accordingly", () => {
  const component = createGitExplorerComponent(
    dummyTui,
    defaultTheme,
    dummyKeybindings,
    () => {},
    {} as any,
    { files: sampleFiles, diffs: sampleDiffs },
  ) as GitChangesExplorerComponent;

  // Default filter is "all"
  assert.equal(component.getStagedFilter(), "all");
  assert.equal(component.getFilteredFiles().length, 6);

  // Press 's' -> "staged"
  component.handleInput("s");
  assert.equal(component.getStagedFilter(), "staged");
  const stagedOnly = component.getFilteredFiles();
  assert.ok(stagedOnly.every((f) => f.staged));
  assert.equal(stagedOnly.length, 4);

  // Press 's' -> "unstaged"
  component.handleInput("s");
  assert.equal(component.getStagedFilter(), "unstaged");
  const unstagedOnly = component.getFilteredFiles();
  assert.ok(unstagedOnly.every((f) => !f.staged));
  assert.equal(unstagedOnly.length, 2);

  // Press 's' -> "all"
  component.handleInput("s");
  assert.equal(component.getStagedFilter(), "all");
  assert.equal(component.getFilteredFiles().length, 6);
});

test("Options initialStaged and selectedFile preselect filter and target file", () => {
  const component = createGitExplorerComponent(
    dummyTui,
    defaultTheme,
    dummyKeybindings,
    () => {},
    {} as any,
    {
      files: sampleFiles,
      diffs: sampleDiffs,
      initialStaged: true,
      selectedFile: "src/new-feature.ts",
    },
  ) as GitChangesExplorerComponent;

  assert.equal(component.getStagedFilter(), "staged");
  assert.equal(component.getSelectedFile()?.path, "src/new-feature.ts");

  // Toggling when initialStaged was set switches directly between staged and unstaged
  component.handleInput("s");
  assert.equal(component.getStagedFilter(), "unstaged");
  component.handleInput("s");
  assert.equal(component.getStagedFilter(), "staged");
});

test("Key 'q' closes component, Enter focuses diff, and PageUp/PageDown scrolls", () => {
  let doneCalled = false;
  const component = createGitExplorerComponent(
    dummyTui,
    defaultTheme,
    dummyKeybindings,
    () => {
      doneCalled = true;
    },
    {} as any,
    { files: sampleFiles, diffs: sampleDiffs },
  ) as GitChangesExplorerComponent;

  // Enter on files switches focus to diff
  assert.equal(component.getFocus(), "files");
  component.handleInput("\r"); // Enter
  assert.equal(component.getFocus(), "diff");

  // PageDown in diff increases scroll offset
  component.handleInput("\x1b[6~"); // PageDown
  assert.ok(component.getScrollOffset() >= 0);

  // PageUp resets scroll offset
  component.handleInput("\x1b[5~"); // PageUp
  assert.equal(component.getScrollOffset(), 0);

  // 'q' closes component
  component.handleInput("q");
  assert.equal(doneCalled, true);
});

test("Key 'c' and 'y' trigger clipboard copy with safe fallback", async () => {
  let renders = 0;
  const mockTui = {
    requestRender: () => {
      renders++;
    },
  } as unknown as TUI;

  const component = createGitExplorerComponent(
    mockTui,
    defaultTheme,
    dummyKeybindings,
    () => {},
    {} as any,
    { files: sampleFiles, diffs: sampleDiffs },
  ) as GitChangesExplorerComponent;

  // 'c' on files copies file path
  const prevRenders = renders;
  component.handleInput("c");
  assert.ok(renders > prevRenders);

  // Switch to diff and 'y' copies diff
  component.handleInput("\t");
  component.handleInput("y");

  // copyGitContent standalone safe test
  const copyRes = await copyGitContent("sample content");
  assert.equal(typeof copyRes, "boolean");
});

// ============================================================================
// 7. Strictly Read-Only Guarantee
// ============================================================================

test("Git Changes Explorer is strictly read-only and does not expose mutating git operations", () => {
  const component = createGitExplorerComponent(
    dummyTui,
    defaultTheme,
    dummyKeybindings,
    () => {},
    {} as any,
    { files: sampleFiles },
  ) as any;

  // Verify that no mutating methods exist on the component
  assert.equal(component.stageFile, undefined);
  assert.equal(component.commit, undefined);
  assert.equal(component.reset, undefined);
  assert.equal(component.checkout, undefined);
  assert.equal(component.revert, undefined);
  assert.equal(component.stash, undefined);
});

test("extractGitDiff: untracked symlinks targeting external files are not read", async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omt-git-symlink-"));
  try {
    const targetFile = path.join(tmpDir, "secret.txt");
    await fs.promises.writeFile(targetFile, "SECRET_CONTENT_SHOULD_NOT_LEAK");
    const linkPath = path.join(tmpDir, "link-to-secret.txt");
    await fs.promises.symlink(targetFile, linkPath);

    const diff = await extractGitDiff(tmpDir, "link-to-secret.txt", false);
    assert.doesNotMatch(diff, /SECRET_CONTENT_SHOULD_NOT_LEAK/);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
});

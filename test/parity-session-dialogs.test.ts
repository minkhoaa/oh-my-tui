/**
 * Parity and verification test suite for Session Dialogs seam:
 * - Resume Dialog (/resume)
 * - Tree Dialog (/tree)
 * - Trajectory Dialog (/trajectory, /trace)
 * - Block Actions Dialog (context menu)
 * - Notification History Dialog (/notifications)
 *
 * Validates OMT dialog behavior and visual contracts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  KeybindingsManager,
  TUI_KEYBINDINGS,
  type TUI,
} from "@earendil-works/pi-tui";

import {
  ResumeDialogComponent,
  createResumeDialogComponent,
  scopeCurrent,
  scopeAll,
} from "../extensions/omt/features/omt-dialogs/resume-dialog.ts";
import {
  OmtTreeDialogComponent,
  createOmtTreeComponent,
} from "../extensions/omt/features/omt-dialogs/tree-dialog.ts";
import {
  OmtTrajectoryComponent,
  createOmtTrajectoryComponent,
} from "../extensions/omt/features/omt-dialogs/trajectory-dialog.ts";
import {
  OmtBlockActionsComponent,
  createOmtBlockActionsComponent,
  buildBlockOptions,
  extractCodeBlocks,
  extractTables,
} from "../extensions/omt/features/omt-dialogs/block-actions.ts";
import {
  OmtNotificationHistoryComponent,
  createNotificationHistoryComponent,
} from "../extensions/omt/features/omt-dialogs/notification-history.ts";

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b_[^\x07]*\x07/g, "");
}

const mockTheme: any = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  dim: (text: string) => text,
};

const mockTui: any = {
  requestRender() {},
  height: 54,
  rows: 54,
};

const mockCtx: any = {
  cwd: "/home/khoa/orca/projects/oh-my-tui",
};

const realKeybindings = new KeybindingsManager(TUI_KEYBINDINGS);

// =============================================================================
// 1. Resume Dialog Parity Tests
// =============================================================================

test("ResumeDialogComponent: 192-col geometry matches OMT clamp(winW-10, 70, 150)", () => {
  const sessions = [
    {
      id: "session-1",
      path: "/home/khoa/.pi/sessions/session-alpha.jsonl",
      title: "alpha-feat",
      cwd: "/home/khoa/orca/projects/oh-my-tui",
      firstUserPrompt: "Implement OMT session dialogs with 100% visual parity",
      messageCount: 14,
      modified: Date.now() - 25 * 60 * 1000,
      isCurrent: true,
      name: "alpha-feat",
    },
  ];

  const comp = new ResumeDialogComponent(mockTui, mockTheme, realKeybindings, () => {}, mockCtx, {
    sessions,
    currentSessionId: "session-1",
    currentSessionPath: sessions[0].path,
    terminalHeight: 54,
  });

  const lines = comp.render(192);
  assert.ok(lines.length > 0, "must render lines");

  // Find top border line: should have ╭ and ╮ with 150 ─ chars -> outer width 152
  const topBorder = lines.find((l) => stripAnsi(l).includes("╭"));
  assert.ok(topBorder, "must have top border");
  const cleanTop = stripAnsi(topBorder);
  assert.ok(cleanTop.includes("╭" + "─".repeat(150) + "╮"), "outer box width must be 152 (150 inner width + 2 borders)");

  // Check left margin centering: (192 - 152) / 2 = 20 spaces
  const match = cleanTop.match(/^(\s*)╭/);
  assert.ok(match, "must match leading spaces before border");
  assert.equal(match[1].length, 20, "left margin must be exactly 20 spaces to center 152 box in 192 width");
});

test("ResumeDialogComponent: detail pane contains exact OMT labels without artificial prefixes", () => {
  const sessions = [
    {
      id: "session-1",
      path: "/home/khoa/.pi/sessions/session-alpha.jsonl",
      title: "alpha-feat",
      cwd: "/home/khoa/orca/projects/oh-my-tui",
      firstUserPrompt: "Implement OMT session dialogs with 100% visual parity",
      messageCount: 14,
      modified: new Date("2026-11-11T14:35:00Z"),
      isCurrent: true,
      name: "alpha-feat",
    },
  ];

  const comp = new ResumeDialogComponent(mockTui, mockTheme, realKeybindings, () => {}, mockCtx, {
    sessions,
    currentSessionId: "session-1",
    currentSessionPath: sessions[0].path,
    terminalHeight: 54,
  });

  const plain = linesToClean(comp.render(192));

  // Must NOT contain artificial prefixes
  assert.ok(!plain.includes("Path: /"), "must NOT contain 'Path: ' prefix in detail view");
  assert.ok(!plain.includes("Cwd: "), "must NOT contain 'Cwd: ' prefix in detail view");
  assert.ok(!plain.includes("First prompt:"), "must NOT contain 'First prompt:' prefix in detail view");
  assert.ok(!plain.includes("Prompt: (no messages)"), "must NOT contain 'Prompt: (no messages)' prefix");
  assert.ok(!plain.includes("● current session"), "must NOT contain bullet in current session marker");

  // Must contain raw path, cwd, current session, prompt
  assert.ok(plain.includes("alpha-feat"), "must contain title");
  assert.ok(plain.includes("14 msgs"), "must contain message count");
  assert.ok(plain.includes("current session"), "must contain 'current session'");
  assert.ok(plain.includes("name: alpha-feat"), "must contain name");
  assert.ok(plain.includes("Implement OMT session dialogs with 100% visual parity"), "must contain first prompt");
});

test("ResumeDialogComponent: footer matches OMT copy and scope badge", () => {
  const sessions = [
    {
      id: "s1",
      path: "/s1.jsonl",
      title: "session 1",
      messageCount: 1,
      modified: Date.now(),
    },
  ];

  const comp = new ResumeDialogComponent(mockTui, mockTheme, realKeybindings, () => {}, mockCtx, {
    sessions,
    scope: scopeCurrent,
  });

  const plain = linesToClean(comp.render(192));
  assert.ok(
    plain.includes("type to filter · ↑↓ select · Enter resume · Tab scope · Del delete · Esc close (1/1 · current)"),
    "footer must match OMT copy exactly",
  );
});

// =============================================================================
// 2. Tree Dialog Parity Tests
// =============================================================================

test("OmtTreeDialogComponent: full-width bottom panel layout with horizontal rules (no rounded box)", () => {
  const nodes = [
    {
      id: "u1",
      parentId: null,
      role: "user" as const,
      label: "Analyze session dialogs",
      summary: "Analyze session dialogs",
      timestamp: Date.now(),
    },
    {
      id: "a1",
      parentId: "u1",
      role: "assistant" as const,
      label: "Inspecting Go source code",
      summary: "Inspecting Go source code",
      timestamp: Date.now() + 1000,
    },
  ];

  const comp = new OmtTreeDialogComponent(mockTui, mockTheme, realKeybindings, () => {}, mockCtx, {
    nodes,
    currentLeafId: "a1",
  });

  const lines = comp.render(192);
  const plain = lines.map(stripAnsi);

  // Must NOT have rounded box corners
  assert.ok(!plain.some((l) => l.includes("╭")), "must NOT contain ╭ rounded box corner");
  assert.ok(!plain.some((l) => l.includes("╰")), "must NOT contain ╰ rounded box corner");

  // Must have 192-column full-width divider rules
  const rule = "─".repeat(192);
  const ruleCount = plain.filter((l) => l.includes(rule)).length;
  assert.ok(ruleCount >= 3, `must contain at least 3 full-width horizontal divider rules (got ${ruleCount})`);

  // Must contain OMT title and help items
  assert.ok(plain.some((l) => l.includes("Session Tree")), "must contain Session Tree title");
  assert.ok(plain.some((l) => l.includes("↑/↓ move · ←/→ page")), "must contain help items line");
  assert.ok(plain.some((l) => l.includes("Type to search:")), "must contain search prompt line");

  // Presentation metadata for parent modal anchor
  assert.equal(comp.presentationAnchor, "bottom-center", "must expose bottom-center presentation anchor");
  assert.equal(comp.presentationFullWidth, true, "must expose full-width presentation flag");
});

test("OmtTreeDialogComponent: treeSummary screen matches OMT bottom panel layout", () => {
  const comp = new OmtTreeDialogComponent(mockTui, mockTheme, realKeybindings, () => {}, mockCtx, {
    nodes: [],
  });
  comp.screen = "treeSummary";

  const lines = comp.render(192);
  const plain = lines.map(stripAnsi);

  assert.ok(!plain.some((l) => l.includes("╭")), "treeSummary must NOT have rounded box");
  assert.ok(plain.some((l) => l.includes("Summarize branch?")), "must contain Summarize branch? title");
  assert.ok(plain.some((l) => l.includes("No summary")), "must contain No summary option");
  assert.ok(plain.some((l) => l.includes("Summarize with custom prompt")), "must contain custom prompt option");
  assert.ok(plain.some((l) => l.includes("↑↓ navigate  enter select  escape/ctrl+c cancel")), "must contain hint");
});

test("OmtTreeDialogComponent: preserves native focus and viewport input capture", () => {
  const comp = new OmtTreeDialogComponent(mockTui, mockTheme, realKeybindings, () => {}, mockCtx, {
    nodes: [],
  });
  assert.equal(comp.focused, true, "focused must be true");
  assert.equal(comp.capturesViewportInput, true, "capturesViewportInput must be true");
});

// =============================================================================
// 3. Trajectory Dialog Parity Tests
// =============================================================================

test("OmtTrajectoryComponent: 192-col geometry and legend match OMT", () => {
  const steps = [
    {
      id: "s1",
      index: 1,
      kind: "user" as const,
      title: "analyze session dialogs",
      detail: "#01 • user: analyze session dialogs\n15:00:01 · user · id: u-101\n\nanalyze",
      timestamp: Date.now(),
    },
  ];

  const comp = new OmtTrajectoryComponent(mockTui, mockTheme, realKeybindings, () => {}, mockCtx, {
    steps,
  });

  const lines = comp.render(192);
  const plain = lines.map(stripAnsi);

  // Box width 150 + 2 border = 152, centered in 192 with 20 leading spaces
  const topBorder = plain.find((l) => l.includes("╭"));
  assert.ok(topBorder, "must have top border");
  assert.ok(topBorder.includes("╭" + "─".repeat(150) + "╮"), "box width must be 150 inner (152 outer)");
  assert.ok(topBorder.startsWith(" ".repeat(20) + "╭"), "must have 20 spaces leading margin");

  // Legend line must match OMT: legend user assistant [tool] [bash] (no [error])
  const legendLine = plain.find((l) => l.includes("legend user assistant"));
  assert.ok(legendLine, "must have legend line");
  assert.ok(!legendLine.includes("[error]"), "legend line must NOT contain [error]");

  // Column header
  assert.ok(plain.some((l) => l.includes("STEPS") && l.includes("DETAIL")), "must have STEPS │ DETAIL column headers");

  // Footer line
  const footerLine = plain.find((l) => l.includes("type to filter"));
  assert.ok(footerLine, "must have footer line");
  assert.ok(footerLine.includes("Ctrl+Y copy"), "footer must advertise Ctrl+Y copy");
  assert.ok(!footerLine.includes("'c'/'y' copy"), "footer must NOT advertise bare 'c'/'y' copy");
});

test("OmtTrajectoryComponent: Ctrl+Y triggers clipboard copy and live update API works", () => {
  let copied = "";
  const steps = [
    {
      id: "s1",
      index: 1,
      kind: "user" as const,
      title: "step 1",
      detail: "Full payload for step 1",
      timestamp: Date.now(),
    },
  ];

  const comp = new OmtTrajectoryComponent(mockTui, mockTheme, realKeybindings, () => {}, mockCtx, {
    steps,
    clipboardWriter: (text: string) => {
      copied = text;
      return true;
    },
  });

  // Test live update API
  assert.equal(typeof comp.updateSteps, "function", "must provide updateSteps API");
  comp.updateSteps([
    ...steps,
    {
      id: "s2",
      index: 2,
      kind: "assistant" as const,
      title: "step 2",
      detail: "Live payload step 2",
      timestamp: Date.now() + 1000,
    },
  ]);

  const plain = linesToClean(comp.render(192));
  assert.ok(plain.includes("(2/2 · all)"), "must reflect newly updated steps in count");

  // Ctrl+Y keypress: \x19
  comp.handleInput("\x19");
  assert.equal(copied, "Live payload step 2", "Ctrl+Y must copy active step detail to clipboard");
});

// =============================================================================
// 4. Block Actions Dialog Parity Tests
// =============================================================================

test("OmtBlockActionsComponent: renders standard dialog layout", () => {
  const md = "## Summary\n\n| Item | Status |\n|---|---|\n| Session | OK |\n\n```go\nfunc Test() {}\n```\n\nPlain text here.";
  const comp = new OmtBlockActionsComponent(mockTui, mockTheme, realKeybindings, () => {}, mockCtx, {
    content: md,
  });

  const lines = comp.render(192);
  const plain = lines.map(stripAnsi);

  // Standard dialog box width: clamp(192-10, 62, 100) = 100. Outer width = 102.
  const topBorder = plain.find((l) => l.includes("╭"));
  assert.ok(topBorder, "must have top border");
  assert.ok(topBorder.includes("╭" + "─".repeat(100) + "╮"), "box width must be 100 inner (102 outer)");

  // Centering margin: (192 - 102) / 2 = 45 spaces
  assert.ok(topBorder.startsWith(" ".repeat(45) + "╭"), "margin must be 45 spaces");

  // Must NOT contain ├─┤ dividers or numbered prefixes like "1. ", "2. "
  assert.ok(!plain.some((l) => l.includes("├")), "must NOT contain ├─┤ dividers");
  assert.ok(!plain.some((l) => l.includes("1. ")), "must NOT contain '1. ' number prefix");
  assert.ok(!plain.some((l) => l.includes("2. ")), "must NOT contain '2. ' number prefix");

  // Options must match OMT buildBlockOptions exactly
  assert.ok(plain.some((l) => l.includes("Copy markdown")), "must contain 'Copy markdown'");
  assert.ok(plain.some((l) => l.includes("Copy 1 code block")), "must contain 'Copy 1 code block'");
  assert.ok(plain.some((l) => l.includes("Copy 1 table")), "must contain 'Copy 1 table'");
  assert.ok(plain.some((l) => l.includes("Copy plain text")), "must contain 'Copy plain text'");

  // Footer must match standard OMT dialog foot
  assert.ok(plain.some((l) => l.includes("↑↓ select · Enter confirm · Esc cancel")), "footer must match OMT");
});

// =============================================================================
// 5. Notification History Leaf Tests
// =============================================================================

test("OmtNotificationHistoryComponent: renders notification history", () => {
  let copied = "";
  const notifs = [
    {
      id: "n1",
      text: "model switched → claude-3-5-sonnet",
      level: "info" as const,
      timestamp: Date.now() - 10 * 60 * 1000,
    },
    {
      id: "n2",
      text: "tool failed: exit status 1: file not found",
      level: "error" as const,
      timestamp: Date.now() - 5 * 60 * 1000,
    },
  ];

  const comp = new OmtNotificationHistoryComponent(mockTui, mockTheme, realKeybindings, () => {}, mockCtx, {
    items: notifs,
    terminalHeight: 54,
    clipboardWriter: (text: string) => {
      copied = text;
      return true;
    },
  });

  const lines = comp.render(192);
  const plain = lines.map(stripAnsi);

  // Box geometry: clamped into [40, 120] -> 120 inner, 122 outer
  const topBorder = plain.find((l) => l.includes("╭"));
  assert.ok(topBorder, "must have top border");
  assert.ok(topBorder.includes("╭" + "─".repeat(120) + "╮"), "box width must be 120 inner (122 outer)");

  // Centering margin: (192 - 122) / 2 = 35 spaces
  assert.ok(topBorder.startsWith(" ".repeat(35) + "╭"), "margin must be 35 spaces");

  // Title and subtitle
  assert.ok(plain.some((l) => l.includes("Notification history")), "must have Notification history title");
  assert.ok(plain.some((l) => l.includes("Latest 2 of 2 · RAM only")), "must have RAM only subtitle");

  // Rows with ● INFO and × ERROR
  assert.ok(plain.some((l) => l.includes("● INFO")), "must have ● INFO marker");
  assert.ok(plain.some((l) => l.includes("× ERROR")), "must have × ERROR marker");

  // Footer
  assert.ok(
    plain.some((l) => l.includes("type to filter · ↑↓ select · PgUp/PgDn page · Ctrl+Y copy · Esc close")),
    "must have notification footer",
  );

  // Key handling: Ctrl+Y copies selected notification
  comp.handleInput("\x19");
  assert.equal(copied, notifs[0].text, "Ctrl+Y must copy selected notification text");
});

// =============================================================================
// Helpers
// =============================================================================

function linesToClean(lines: string[]): string {
  return lines.map(stripAnsi).join("\n");
}

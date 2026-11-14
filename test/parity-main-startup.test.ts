import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { InteractiveMode, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Text, TuiAltScreen, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { observeNativeUIOwnership, installNativeStartupPresentation } from "../extensions/omt/core/native-ui.ts";
import { OmtTreeDialogComponent } from "../extensions/omt/features/omt-dialogs/tree-dialog.ts";
import { createSidebarDockComponent } from "../extensions/omt/features/sidebar/view.ts";
import { resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";

function fixture() {
  initTheme("dark");
  const resources = new Container(), document = new Container(), header = new Container();
  // Real InteractiveMode has header, resources, then transcript (also in 1.5.2).
  document.addChild(header);
  document.addChild(resources);
  const transcript = new Text("native transcript", 0, 0); document.addChild(transcript);
  const tui = new TuiAltScreen({ columns: 192, rows: 49, write() {}, start() {}, stop() {} } as any, false, tmpdir());
  const host = Object.assign(Object.create(InteractiveMode.prototype), {
    renderer: tui, headerContainer: header, loadedResourcesContainer: resources, documentContainer: document,
    customFooter: undefined, customHeader: undefined,
    getStartupExpansionState: () => false, getCompactExtensionLabels: () => ["owned-extension"],
    buildScopeGroups: () => [], formatDiagnostics: () => ["warning preserved"], getBuiltInCommandConflictDiagnostics: () => [],
    runtimeHost: { session: {
      promptTemplates: [], extensionRunner: { getCommandDiagnostics: () => [], getShortcutDiagnostics: () => [] },
      resourceLoader: {
        getSkills: () => ({ skills: [{ name: "owned-skill", filePath: "/fixture/skill" }], diagnostics: [{ type: "warning", message: "warning preserved" }] }),
        getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }),
        getExtensions: () => ({ extensions: [{ path: "/fixture/extension" }], errors: [], warnings: [] }),
        getSystemPromptSource: () => undefined, getAppendSystemPromptSources: () => [], getAgentsFiles: () => ({ agentsFiles: [] }),
      },
    } },
  });
  (InteractiveMode.prototype as any).showLoadedResources.call(host, { force: true });
  const ui = (InteractiveMode.prototype as any).createExtensionUIContext.call(host);
  return { ui, resources, document, transcript, tui };
}

test("Signature startup suppresses only native listings, preserves diagnostics/foreign rows and remaps mouse without changing children", () => {
  const restore = observeNativeUIOwnership();
  let dispose: (() => void) | undefined;
  try {
    const f = fixture();
    const theme = f.ui.theme;
    let clicked = false;
    const foreign = new Text("foreign row", 0, 0);
    (foreign as any).handleMouse = (() => { clicked = true; return { handled: true }; }) as any;
    f.resources.addChild(foreign);
    const before = [...f.resources.children];
    const native = f.resources.render(80).map(stripTerminalSequences).join("\n");
    assert.ok(native.includes("[Skills]") && native.includes("[Extensions]"));
    let enabled = true;
    dispose = installNativeStartupPresentation(f.ui, () => enabled);
    assert.ok(dispose);
    assert.equal(installNativeStartupPresentation(f.ui, () => false), dispose, "a replacement session adopts the existing owned filter");
    const shown = f.resources.render(80).map(stripTerminalSequences);
    assert.ok(!shown.join("\n").includes("[Skills]"));
    assert.ok(!shown.join("\n").includes("[Extensions]"));
    assert.ok(shown.join("\n").includes("[Skill warnings]"));
    assert.ok(shown.join("\n").includes("warning preserved"));
    const y = shown.findIndex(line => line.includes("foreign row"));
    f.resources.handleMouse({ type: "click", button: "left", x: 0, y, width: 80, height: shown.length, screenX: 0, screenY: y, shift: false, ctrl: false, alt: false });
    assert.equal(clicked, true);
    assert.deepEqual(f.resources.children, before);
    assert.equal(f.document.children[2], f.transcript);
    enabled = false;
    assert.equal(f.resources.render(80).map(stripTerminalSequences).join("\n"), native);
    dispose(); dispose = undefined;
    assert.equal(f.resources.render, Container.prototype.render);
    const tree = new OmtTreeDialogComponent(f.tui, theme, undefined, () => {}, { nodes: [] });
    const rows = tree.render(20);
    assert.ok(rows.every(row => visibleWidth(row) <= 20));
    assert.ok(rows.map(stripTerminalSequences).join("").replace(/\s/g, "").includes("filtersctrl+d/t/u/l/a"), "help wraps without losing keys");
  } finally { dispose?.(); restore?.(); }
});

test("startup presentation yields to foreign renderer and retained wrappers become inert", () => {
  const restore = observeNativeUIOwnership();
  let dispose: (() => void) | undefined;
  try {
    const f = fixture();
    const native = f.resources.render(80);
    dispose = installNativeStartupPresentation(f.ui, () => true);
    assert.ok(dispose);
    const retained = f.resources.render;
    const foreign = () => ["foreign surface"];
    f.resources.render = foreign;
    assert.equal(installNativeStartupPresentation(f.ui, () => true), undefined);
    dispose(); dispose = undefined;
    assert.equal(f.resources.render, foreign);
    assert.deepEqual(retained.call(f.resources, 80), native);
  } finally { dispose?.(); restore?.(); }
});

test("main dock honors native visibility, source paint order and Signature palette instead of native blue chrome", () => {
  setActiveTheme("omt-signature");
  let dock: ReturnType<typeof createSidebarDockComponent> | undefined;
  try {
    const f = fixture();
    dock = createSidebarDockComponent(f.tui, f.ui.theme, undefined, { ui: f.ui } as any, { state: {
      visible: { commands: false, todos: true, lsp: true },
      todos: [], lsp: [],
    } });
    const rows = dock.render(34);
    const text = rows.map(stripTerminalSequences).join("\n");
    assert.equal(rows.length, 49);
    assert.ok(!text.includes("COMMANDS"));
    assert.ok(text.indexOf("Todos") < text.indexOf("LSP"));
    assert.ok(rows.every(row => visibleWidth(row) === 34));
  } finally { dock?.dispose(); resetActiveTheme(); }
});

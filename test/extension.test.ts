import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  CustomEditor,
  UserMessageComponent,
  initTheme,
  type ExtensionUIContext,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const signatureIndicator = { frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], intervalMs: 500 };

test("native Pi discovers OMT, runs /omt, reloads, and unloads without agent changes", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "omt-test-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = sandbox;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  const network = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Verification must not make network requests");
  });
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: sandbox,
    agentDir: sandbox,
    settingsManager,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({
    authPath: join(sandbox, "auth.json"),
    modelsPath: join(sandbox, "models.json"),
    modelsStorePath: join(sandbox, "models-store.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const { session } = await createAgentSession({
    cwd: sandbox,
    agentDir: sandbox,
    settingsManager,
    resourceLoader,
    modelRuntime,
    sessionManager: SessionManager.inMemory(sandbox),
  });
  t.after(() => session.dispose());
  await session.bindExtensions({});
  const originalPrompt = session.systemPrompt;
  const originalTools = session.getActiveToolNames();
  assert.deepEqual(resourceLoader.getExtensions().extensions, []);

  settingsManager.setPackages([packageDir]);
  await session.reload();
  const { extensions, errors, warnings } = resourceLoader.getExtensions();
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings ?? [], []);
  assert.equal(extensions.length, 1);
  const extension = extensions[0]!;
  assert.equal(extension.resolvedPath, join(packageDir, "extensions/omt/index.ts"));
  assert.deepEqual([...extension.commands.keys()], ["omt"]);
  assert.deepEqual([...extension.handlers.keys()].sort(), [
    "agent_end",
    "agent_settled",
    "agent_start",
    "message_end",
    "message_update",
    "model_select",
    "session_compact",
    "session_shutdown",
    "session_start",
    "session_tree",
    "thinking_level_select",
    "tool_execution_end",
    "tool_execution_start",
    "turn_end",
    "turn_start",
    "ui_prompt_end",
    "ui_prompt_start",
  ]);
  assert.equal(extension.tools.size, 0);
  assert.deepEqual([...extension.flags.keys()], ["omt-theme"]);
  assert.equal(extension.shortcuts.size, 0, "Agent Fleet must not alter native keybindings");
  assert.equal(extension.markdownTransformer, undefined, "no display-content transforms needed");
  assert.equal(extension.toolRenderers?.length, 1);

  // Non-UI mode consumes /omt too, without adding a model-facing message.
  await session.prompt("/omt");
  const notifications: Array<[string, string | undefined]> = [];
  type Factory = Parameters<ExtensionUIContext["setEditorComponent"]>[0];
  type FooterFactory = Parameters<ExtensionUIContext["setFooter"]>[0];
  let editor: Factory;
  let footer: FooterFactory;
  let workingMessage: string | undefined;
  let workingIndicator: Parameters<ExtensionUIContext["setWorkingIndicator"]>[0];
  let hiddenThinkingLabel = "Thinking...";
  let draft = "draft 你好 👩🏽‍💻";
  initTheme("dark");
  let hostTheme = session.extensionRunner.getUIContext().theme;
  await session.bindExtensions({
    mode: "tui",
    uiContext: {
      ...session.extensionRunner.getUIContext(),
      notify: (message, type) => { notifications.push([message, type]); },
      get theme() { return hostTheme; },
      setTheme: value => {
        assert.notEqual(typeof value, "string", "OMT must not persist a named host selection");
        hostTheme = value as typeof hostTheme;
        return { success: true };
      },
      getEditorComponent: () => editor,
      setEditorComponent: (factory) => { editor = factory; },
      getEditorText: () => draft,
      setEditorText: (text) => { draft = text; },
      setFooter: (f) => { footer = f; },
      setWorkingMessage: (message) => { workingMessage = message; },
      setWorkingIndicator: (indicator) => { workingIndicator = indicator; },
      setHiddenThinkingLabel: (label) => { hiddenThinkingLabel = label ?? "Thinking..."; },
      ...{
        getFooterComponent: () => footer,
        getWorkingPresentation: () => ({ message: workingMessage, indicator: workingIndicator,
          hiddenThinkingLabel, defaultHiddenThinkingLabel: "Thinking...", visible: true }),
      },
    },
  });
  assert.equal(typeof editor, "function", "automatically activates in TUI mode");
  await session.prompt("/omt");
  assert.deepEqual(notifications, [["Oh My TUI is active.", "info"]]);
  const owned = editor;
  await session.prompt("/omt editor on");
  assert.equal(editor, owned, "on is idempotent");
  await session.prompt("/omt editor off");
  assert.equal(editor, undefined);
  assert.equal(draft, "draft 你好 👩🏽‍💻");
  await session.prompt("/omt editor on");
  assert.equal(editor, owned);
  initTheme("dark");
  const message = new UserMessageComponent("hello");
  const render = () => message.render(80);
  const cleanMessage = render();
  await session.prompt("/omt messages off");
  const nativeMessage = render();
  assert.notDeepEqual(nativeMessage, cleanMessage);
  assert.equal(editor, owned, "message controls do not touch the editor");
  await session.prompt("/omt messages on");
  assert.deepEqual(render(), cleanMessage);

  const foreign: Factory = (tui, theme, keys) => new CustomEditor(tui, theme, keys);
  editor = foreign;
  await session.prompt("/omt editor off");
  assert.equal(editor, foreign, "off must not clear a later editor owner");
  await session.prompt("/omt editor on");
  assert.equal(editor, foreign, "on must yield to an existing editor");
  await session.prompt("/omt theme opencode");
  assert.equal(notifications.at(-1)![1], "warning");
  assert.match(notifications.at(-1)![0], /Native fallback:.*another extension owns the editor/);
  assert.equal(editor, foreign, "theme changes must not reclaim a foreign editor");
  await session.prompt("/omt theme omt-signature");
  await session.reload();
  assert.equal(editor, foreign, "startup and shutdown must respect a foreign editor");
  assert.equal(notifications.at(-1)![1], "warning", "startup reports inactive components too");
  editor = undefined;
  await session.prompt("/omt editor on");
  assert.notEqual(editor, undefined);
  await session.prompt("/omt editor off");
  assert.equal(editor, undefined);
  await session.reload();
  assert.equal(typeof editor, "function", "reload resets session-local disable");
  await session.prompt("/omt messages off");
  assert.deepEqual(render(), nativeMessage);
  await session.reload();
  assert.deepEqual(render(), cleanMessage, "reload resets message control");
  await session.prompt("/omt tools off");
  assert.deepEqual(notifications.at(-1), ["OMT tools off (native rendering).", "info"]);
  const nativeRead = session.extensionRunner.resolveToolRenderers("read", () => session.getToolDefinition("read"));
  assert.equal(nativeRead?.renderShell, undefined);

  await session.prompt("/omt tools on");
  assert.deepEqual(notifications.at(-1), ["OMT tools on.", "info"]);
  const cleanRead = session.extensionRunner.resolveToolRenderers("read", () => session.getToolDefinition("read"));
  assert.equal(cleanRead?.renderShell, "self");

  const omtCmd = session.extensionRunner.getRegisteredCommands().find((cmd) => cmd.name === "omt")!;
  assert.ok(omtCmd.getArgumentCompletions);
  const completions = await omtCmd.getArgumentCompletions!("f");
  assert.deepEqual(completions, [
    { value: "footer on", label: "footer on" },
    { value: "footer off", label: "footer off" },
  ]);

  await session.prompt("/omt footer off");
  assert.deepEqual(notifications.at(-1), ["OMT footer off (native footer restored).", "info"]);
  assert.equal(footer, undefined);

  await session.reload();
  assert.notEqual(footer, undefined, "reload resets footer control to enabled");

  await session.prompt("/omt footer off");
  assert.equal(footer, undefined);

  await session.prompt("/omt footer on");
  assert.deepEqual(notifications.at(-1), ["OMT footer on.", "info"]);
  assert.notEqual(footer, undefined);

  assert.equal(workingMessage, "Working");
  assert.deepEqual(workingIndicator, signatureIndicator);
  assert.equal(hiddenThinkingLabel, "Reasoning");
  await session.prompt("/omt thinking off");
  assert.equal(workingMessage, undefined);
  assert.equal(workingIndicator, undefined);
  assert.equal(hiddenThinkingLabel, "Thinking...");
  const thinkingCompletions = await omtCmd.getArgumentCompletions!("thinking");
  assert.deepEqual(thinkingCompletions, [
    { value: "thinking on", label: "thinking on" },
    { value: "thinking off", label: "thinking off" },
  ]);
  await session.reload();
  assert.equal(hiddenThinkingLabel, "Reasoning", "reload resets thinking control");
  await session.prompt("/omt thinking off");
  await session.prompt("/omt thinking on");
  assert.equal(hiddenThinkingLabel, "Reasoning");
  assert.equal(footer !== undefined, true, "thinking controls preserve footer");

  await session.prompt("/omt editor invalid");
  assert.deepEqual(notifications.at(-1), ["Usage: /omt [settings|palette|inspect|git|navigate|session|tree|queue|doctor|tabs|wallpaper|background|theme|on|off]", "info"]);

  // Theme presets and live switching
  const themeCompletions = await omtCmd.getArgumentCompletions!("theme");
  assert.deepEqual(themeCompletions, [
    { value: "theme omt-signature", label: "theme omt-signature" },
    { value: "theme codex-inspired", label: "theme codex-inspired" },
    { value: "theme claude-code-inspired", label: "theme claude-code-inspired" },
    { value: "theme opencode-inspired", label: "theme opencode-inspired" },
    { value: "theme minimal", label: "theme minimal" },
    { value: "theme native", label: "theme native" },
  ]);

  const readThemeStatus = async () => {
    const beforePicker = notifications.length;
    await session.prompt("/omt theme");
    assert.equal(notifications.length, beforePicker, "closing TUI Theme must not emit a status toast");
    await session.prompt("/omt preset"); // Explicit status query remains supported.
  };
  await readThemeStatus();
  const defaultThemeStatus = "OMT theme: omt-signature. Available: omt-signature, codex-inspired, claude-code-inspired, opencode-inspired, minimal, native";
  assert.deepEqual(notifications.at(-1), [defaultThemeStatus, "info"]);

  await session.prompt("/omt theme omt");
  assert.deepEqual(notifications.at(-1), ["OMT theme set to omt-signature.", "info"]);
  assert.equal(hiddenThinkingLabel, "Reasoning");
  assert.deepEqual(workingIndicator, signatureIndicator);

  await session.prompt("/omt theme claude");
  assert.deepEqual(notifications.at(-1), ["OMT theme set to claude-code-inspired.", "info"]);
  assert.equal(hiddenThinkingLabel, "∴ Thought");
  assert.deepEqual(workingIndicator, { frames: ["·", "·", "·", "·", "✢", "*", "✶", "✻", "✻", "✽", "✽", "✽", "✽", "✻", "✶", "*", "✢", "✢"], intervalMs: 112 });
  await session.prompt("/omt theme claude-code-inspired");
  assert.deepEqual(notifications.at(-1), ["OMT theme set to claude-code-inspired.", "info"]);

  await session.prompt("/omt theme opencode");
  assert.deepEqual(notifications.at(-1), ["OMT theme set to opencode-inspired.", "info"]);
  assert.equal(hiddenThinkingLabel, "+ Thought");
  assert.deepEqual(workingIndicator, { frames: ["■", "⬝"], intervalMs: 40 });
  await session.prompt("/omt theme opencode-inspired");
  assert.deepEqual(notifications.at(-1), ["OMT theme set to opencode-inspired.", "info"]);

  await session.prompt("/omt theme minimal");
  assert.deepEqual(notifications.at(-1), ["OMT theme set to minimal.", "info"]);
  assert.equal(hiddenThinkingLabel, "Thinking");
  assert.deepEqual(workingIndicator, { frames: ["·"] });

  // Native preset restores original Pi presentation wherever supported
  await session.prompt("/omt theme native");
  assert.deepEqual(notifications.at(-1), ["OMT theme set to native (native presentation restored).", "info"]);
  assert.equal(editor, undefined, "native preset restores native editor");
  assert.equal(footer, undefined, "native preset restores native footer");
  assert.equal(hiddenThinkingLabel, "Thinking...", "native preset restores native thinking label");
  assert.equal(workingIndicator, undefined, "native preset restores native indicator");

  // Switching back to codex-inspired restores OMT components
  await session.prompt("/omt theme codex-inspired");
  assert.deepEqual(notifications.at(-1), ["OMT theme set to codex-inspired.", "info"]);
  assert.notEqual(editor, undefined, "codex restores clean editor");
  assert.notEqual(footer, undefined, "codex restores clean footer");
  assert.equal(hiddenThinkingLabel, "Reasoning");
  assert.deepEqual(workingIndicator, { frames: ["•", "◦"], intervalMs: 32 });

  // Backward-compatible alias 'codex' also switches to codex-inspired
  await session.prompt("/omt theme claude");
  await session.prompt("/omt theme codex");
  assert.deepEqual(notifications.at(-1), ["OMT theme set to codex-inspired.", "info"]);
  assert.equal(hiddenThinkingLabel, "Reasoning");
  assert.deepEqual(workingIndicator, { frames: ["•", "◦"], intervalMs: 32 });
  const codexMessage = render();
  assert.deepEqual(render(), codexMessage, "legacy alias retains canonical message rendering");
  await session.prompt("/omt theme omt-signature");
  assert.deepEqual(render(), cleanMessage, "signature preset restores clean message");
  await readThemeStatus();
  assert.deepEqual(notifications.at(-1), [defaultThemeStatus, "info"]);
  for (const name of ["unknown", "constructor", "toString", "__proto__"]) {
    const currentEditor: Factory = editor;
    const currentFooter: FooterFactory = footer;
    await session.prompt(`/omt theme ${name}`);
    assert.deepEqual(notifications.at(-1), [`Unknown theme: ${name}. Available themes: omt-signature, codex-inspired, claude-code-inspired, opencode-inspired, minimal, native`, "info"]);
    assert.equal(editor, currentEditor);
    assert.equal(footer, currentFooter);
    assert.deepEqual(render(), cleanMessage);
  }

  // Theme selection is persisted by default: reload retains the selected theme.
  await session.prompt("/omt theme minimal");
  await session.reload();
  await readThemeStatus();
  assert.deepEqual(notifications.at(-1), ["OMT theme: minimal. Available: omt-signature, codex-inspired, claude-code-inspired, opencode-inspired, minimal, native", "info"]);
  assert.equal(hiddenThinkingLabel, "Thinking");
  assert.deepEqual(workingIndicator, { frames: ["·"] });
  await session.prompt("/omt theme omt-signature");

  // Preserving independent toggles across theme switches
  await session.prompt("/omt editor off");
  assert.equal(editor, undefined);
  await session.prompt("/omt theme claude");
  assert.equal(editor, undefined, "editor stays off after theme switch");
  await session.prompt("/omt editor on");
  assert.notEqual(editor, undefined, "turning editor on restores it under active theme");
  await session.prompt("/omt theme codex-inspired");
  // Master toggle: all off and all on
  await session.prompt("/omt all off");
  assert.deepEqual(notifications.at(-1), ["OMT all components off.", "info"]);
  assert.equal(editor, undefined);
  assert.equal(footer, undefined);

  await session.prompt("/omt all on");
  assert.deepEqual(notifications.at(-1), ["OMT all components on.", "info"]);
  assert.notEqual(editor, undefined);
  assert.notEqual(footer, undefined);

  // Imported backgrounds are slash-command-only presentation, never agent data.
  const scenePath = join(sandbox, "background  scene.json");
  await writeFile(scenePath, JSON.stringify({ version: 1, type: "scene", name: "Native session scene", scene: { layers: [{ scene: "starfield" }] } }));
  await session.prompt(`/omt background upload "${scenePath}"`);
  const importedId = notifications.at(-1)![0].match(/: ([a-f0-9]{64}) /)?.[1];
  assert.ok(importedId, notifications.at(-1)![0]);
  await session.prompt("/omt background list");
  assert.ok(notifications.at(-1)![0].includes(importedId));
  await session.prompt(`/omt background select ${importedId}`);
  assert.match(notifications.at(-1)![0], /Full wallpaper requires/, "unsupported fullscreen boundary yields without changing native UI");
  await session.prompt("/omt background reset");
  await session.prompt(`/omt background remove ${importedId}`);
  assert.match(notifications.at(-1)![0], /Background removed/);
  assert.equal(session.systemPrompt, originalPrompt);
  assert.deepEqual(session.getActiveToolNames(), originalTools);
  assert.deepEqual(session.messages, []);

  const notificationCount = notifications.length;
  await session.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  assert.deepEqual(session.extensionRunner.getRegisteredCommands().map((cmd) => cmd.name), ["omt"]);
  await session.prompt("/omt");
  assert.equal(notifications.length, notificationCount + 1);
  assert.deepEqual(notifications.at(-1), ["Oh My TUI is active.", "info"]);
  assert.equal(session.systemPrompt, originalPrompt);
  assert.deepEqual(session.getActiveToolNames(), originalTools);
  assert.deepEqual(session.messages, []);

  // Saved defaults survive reload; only an explicitly supplied flag overrides them.
  const configPath = join(sandbox, "omt.json");
  await writeFile(configPath, JSON.stringify({ preset: "claude", components: { editor: false } }));
  await session.reload();
  await readThemeStatus();
  assert.match(notifications.at(-1)![0], /^OMT theme: claude-code-inspired\./);
  assert.equal(hiddenThinkingLabel, "∴ Thought");
  assert.equal(editor, undefined, "saved independent component toggles are respected");
  await session.prompt("/omt theme minimal --session");
  await session.reload();
  assert.equal(hiddenThinkingLabel, "∴ Thought", "session selection does not replace saved defaults");
  session.extensionRunner.setFlagValue("omt-theme", "codex");
  await session.reload();
  assert.equal(hiddenThinkingLabel, "Reasoning", "explicit CLI selection wins over saved preset");
  assert.equal(editor, undefined, "CLI selection does not reset saved component toggles");
  session.extensionRunner.setFlagValue("omt-theme", "not-a-preset");
  await session.reload();
  assert.deepEqual(notifications.at(-1), ["Unknown OMT startup theme: not-a-preset. Using claude-code-inspired.", "warning"]);
  session.extensionRunner.setFlagValue("omt-theme", undefined as any);
  await session.reload();
  assert.equal(hiddenThinkingLabel, "∴ Thought", "removing CLI override restores saved preset");
  await writeFile(configPath, "invalid JSON");
  await session.reload();
  assert.equal(hiddenThinkingLabel, "Reasoning", "corrupt config still uses factory defaults");
  await rm(configPath);

  // Verify accessibilityStore resets on reload/session_shutdown
  await session.prompt("/omt ascii on");
  assert.deepEqual(notifications.at(-1), ["Plain ASCII borders enabled.", "info"]);
  await session.reload();
  await session.prompt("/omt ascii on");
  assert.deepEqual(notifications.at(-1), ["Plain ASCII borders enabled.", "info"]);

  // Native flag resolution precedes the first OMT mount, including reload.
  for (const [flag, selected, label] of [["opencode", "opencode-inspired", "+ Thought"], ["claude", "claude-code-inspired", "∴ Thought"], ["native", "native", "Thinking..."]] as const) {
    session.extensionRunner.setFlagValue("omt-theme", flag);
    await session.reload();
    assert.equal(hiddenThinkingLabel, label);
    assert.equal(typeof editor, selected === "native" ? "undefined" : "function");
    await readThemeStatus();
    assert.match(notifications.at(-1)![0], new RegExp(`^OMT theme: ${selected}\\.`));
  }
  session.extensionRunner.setFlagValue("omt-theme", "not-a-preset");
  await session.reload();
  assert.deepEqual(notifications.at(-1), ["Unknown OMT startup theme: not-a-preset. Using omt-signature.", "warning"]);
  assert.equal(hiddenThinkingLabel, "Reasoning");
  assert.equal(session.systemPrompt, originalPrompt);
  assert.deepEqual(session.messages, []);

  settingsManager.setPackages([]);
  await session.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  assert.deepEqual(resourceLoader.getExtensions().extensions, []);
  assert.deepEqual(session.extensionRunner.getMarkdownTransformers(), []);
  assert.deepEqual(render(), nativeMessage, "unload restores existing message presentation");
  assert.equal(editor, undefined, "unload restores the native editor");
  assert.equal(footer, undefined, "unload restores the native footer");
  assert.equal(workingMessage, undefined, "unload restores native working text");
  assert.equal(workingIndicator, undefined, "unload restores native spinner");
  assert.equal(hiddenThinkingLabel, "Thinking...", "unload restores collapsed reasoning labels");
  assert.deepEqual(session.extensionRunner.getRegisteredCommands(), []);
  assert.equal(session.systemPrompt, originalPrompt);
  assert.deepEqual(session.getActiveToolNames(), originalTools);
  assert.deepEqual(session.messages, []);
  assert.equal(network.mock.callCount(), 0);
});

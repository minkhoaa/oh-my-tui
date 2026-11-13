// Deterministic ANSI snapshot probe for the behavior-preserving M12 migration.
// OMT_REGRESSION_SOURCE can select an untouched source copy outside the checkout.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { AssistantMessageComponent, UserMessageComponent, InteractiveMode, initTheme, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
const base = process.env.OMT_REGRESSION_SOURCE ?? resolve("extensions/omt");
const load = (name: string) => import(pathToFileURL(resolve(base, name)).href);
const legacy = !!process.env.OMT_REGRESSION_SOURCE;
const design = await load(legacy ? "design.ts" : "core/theme.ts");
const { CleanEditor } = await load(legacy ? "editor.ts" : "features/editor/index.ts");
const { createUserMessageControl } = await load(legacy ? "user-message.ts" : "features/user-message/index.ts");
const tools = await load(legacy ? "tools.ts" : "features/tools/index.ts");
const { formatFooterLine } = await load(legacy ? "footer.ts" : "features/footer/index.ts");
const { setCodexPalette } = await load(process.env.OMT_REGRESSION_SOURCE ? "codex.ts" : "presets/codex-inspired/rendering.ts");
setCodexPalette({ foreground: { r: 238, g: 238, b: 238 }, background: { r: 10, g: 10, b: 10 } });
const result: Record<string, string> = {};
const hash = (key: string, value: unknown) => { result[key] = createHash("sha256").update(JSON.stringify(value)).digest("hex"); };
for (const appearance of ["dark", "light"]) {
  initTheme(appearance);
  const theme = (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme;
  for (const name of ["codex-inspired", "opencode-inspired", "minimal", "native"]) {
    design.setActiveTheme(name);
    const control = createUserMessageControl(() => theme);
    try {
      for (const width of [10, 20, 40, 80, 120]) {
        const key = `${appearance}/${name}/${width}`;
        const user = new UserMessageComponent("hello **world** 你好\n\nsecond paragraph");
        const assistant = new AssistantMessageComponent({ role: "assistant", model: "fixture", content: [{ type: "text", text: "hello **world**\n\n```ts\nconst x = 1;\n```" }], stopReason: "stop" } as any);
        const editor = new CleanEditor({ terminal: { rows: 32, columns: width }, requestRender() {} }, { borderColor: (s: string) => s, selectList: getSelectListTheme() }, new KeybindingsManager(TUI_KEYBINDINGS), () => theme, () => "Fixture · local");
        editor.setText("hello 你好\nsecond row");
        hash(key + "/messages", [user.render(width), assistant.render(width)]);
        hash(key + "/editor", editor.render(width));
        hash(key + "/footer", formatFooterLine(width, theme, { branch: "main", cwd: "/tmp/work", extensionStatuses: ["warning: fixture"], modelId: "fixture", contextUsage: { percent: 12, contextWindow: 200000 }, reasoning: true, thinkingLevel: "high" }));
        for (const [tool, renderer, args, details] of [
          ["read", tools.createCleanReadRenderer(), { path: "hello.ts", offset: 2, limit: 3 }, undefined],
          ["write", tools.createCleanWriteRenderer(), { path: "new.ts", content: "const a = 1;\n// 你好\n" }, undefined],
          ["edit", tools.createCleanEditRenderer(), { path: "hello.ts" }, { diff: "-1 old\n+1 new" }],
          ["bash", tools.createCleanBashRenderer(), { command: "printf hello\nprintf world" }, { exitCode: 0 }],
        ] as any[]) {
          for (const expanded of [false, true]) {
            const ctx = { args, state: {}, cwd: "/tmp/work", outputPad: 1, isPartial: false, isError: false, argsComplete: true, executionStarted: true, durationMs: 123,
              keyText: () => "ctrl+o", keyHint: (_: string, text: string) => `ctrl+o ${text}` };
            const call = renderer.renderCall(args, theme, ctx);
            const output = renderer.renderResult({ content: [{ type: "text", text: "one\ntwo\nthree\nfour\nfive\nsix\n" }], details }, { expanded, isPartial: false }, theme, ctx);
            hash(key + "/" + tool + "/" + expanded, [call.render(width), output.render(width)]);
          }
        }
      }
    } finally { control.cleanup(); }
  }
}
design.resetActiveTheme();
console.log(JSON.stringify(result, null, 2));

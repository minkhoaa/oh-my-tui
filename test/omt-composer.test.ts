import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, InteractiveMode, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { FooterRenderData } from "../extensions/omt/presets/shared/footer.ts";
import type { EditorRenderData } from "../extensions/omt/presets/shared/types.ts";
import { signatureEditor } from "../extensions/omt/presets/omt-signature/editor.ts";
import { signatureFooter } from "../extensions/omt/presets/omt-signature/footer.ts";
import { omtSpinner } from "../extensions/omt/presets/omt-signature/motion.ts";
import { signatureWorking } from "../extensions/omt/presets/omt-signature/working.ts";

const proto = InteractiveMode.prototype as unknown as {
  createExtensionUIContext(this: unknown): { theme: Theme };
};
function theme(): Theme {
  initTheme("dark");
  return proto.createExtensionUIContext.call({}).theme;
}

test("OMT signature editor leaves native geometry and content untouched", () => {
  const t = theme();
  const rows = ["╭──────╮", "│ ◈ 界é  │", "│ wrapped text │", "╰──────╯", "completion"];
  const data: EditorRenderData = {
    lines: rows,
    width: 24,
    boxHeight: 4,
    padding: 2,
    text: "界é\nwrapped text",
    metadata: "gpt-4o · invented metadata",
  };

  for (const width of [24, 80]) {
    const rendered = signatureEditor(t, { ...data, width });
    assert.deepEqual(rendered, rows);
    assert.equal(rendered.length, rows.length);
    assert.ok(rendered.some((line) => stripTerminalSequences(line).includes("◈ 界é")));
    assert.ok(!rendered.join("").includes("Composer"));
    assert.ok(!rendered.join("").includes("tokens"));
  }
});

test("OMT footer shows only available real stats and yields left hints to them", () => {
  const t = theme();
  const data: FooterRenderData = {
    outputPad: 1,
    cwd: "/workspace/界",
    branch: "feature/omtdev",
    extensionStatuses: [],
    activity: { type: "tool", name: "bash", detail: "npm test" },
    contextUsage: { percent: 42.4, contextWindow: 200000 },
    modelId: "gpt-4o-long-name",
  };
  const wide = signatureFooter(120, t, data);
  const medium = signatureFooter(55, t, data);
  for (const [width, rendered] of [[120, wide], [55, medium], [24, signatureFooter(24, t, data)], [12, signatureFooter(12, t, data)]] as const) {
    assert.ok(visibleWidth(rendered) <= width, `${visibleWidth(rendered)} columns exceeds ${width}`);
  }
  const plainWide = stripTerminalSequences(wide);
  assert.ok(plainWide.includes("gpt-4o-long-name"));
  assert.ok(plainWide.includes("42%"));
  assert.ok(plainWide.includes("feature/omtdev"));
  assert.ok(plainWide.includes("npm test"));
  assert.ok(plainWide.includes("界"));
  assert.ok(!plainWide.includes("tokens"));
  assert.ok(!plainWide.includes("$0.00"));
  const plainMedium = stripTerminalSequences(medium);
  assert.ok(plainMedium.includes("gpt-4o-long-name"));
  assert.ok(plainMedium.includes("42%"));
  assert.ok(!plainMedium.includes("npm test"));

  const partial = signatureFooter(80, t, { ...data, contextUsage: undefined, branch: null, activity: undefined });
  assert.ok(stripTerminalSequences(partial).includes("gpt-4o-long-name"));
  assert.ok(!stripTerminalSequences(partial).includes("%"));
});

test("OMT working label stays native and spinner frames are deterministic", () => {
  const t = theme();
  const row = stripTerminalSequences(signatureWorking.render(t, 2400, "Compacting context...", "esc", 80));
  assert.ok(row.includes("Compacting context..."));
  assert.ok(!row.includes("interrupt"));
  assert.ok(!row.includes("2s"));
  assert.equal(omtSpinner(0), "⠋");
  assert.equal(omtSpinner(499), "⠋");
  assert.equal(omtSpinner(500), "⠙");
  assert.equal(omtSpinner(500, false), "⠋");
});

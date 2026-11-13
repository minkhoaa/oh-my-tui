import assert from "node:assert/strict";
import { test } from "node:test";
import { TuiAltScreen, stripTerminalSequences } from "@earendil-works/pi-tui";
import { BackgroundCompositor } from "../extensions/omt/features/backgrounds/compositor/index.ts";
import { installNativeBackdrop } from "../extensions/omt/features/backgrounds/pi.ts";

test("changing streaming foreground keeps masks bounded and leaves no layout/scroll drift", () => {
  const compositor = new BackgroundCompositor();
  const terminal = { columns: 80, rows: 32, write() {}, hideCursor() {}, showCursor() {}, stop() {} };
  const tui = new TuiAltScreen(terminal as any, false);
  const host = tui as any;
  host.altScreenActive = true;
  const lines = Array.from({ length: 5000 }, (_, i) => `  Native output ${i} 界 é`);
  tui.addChild({ render: () => lines, invalidate() {} });
  let frame = 0;
  const hook = installNativeBackdrop(tui, (screen, width, height) => compositor.compose(screen, Array(height).fill((frame % 2 ? "." : "+").repeat(width)), width, height))!;
  try {
    for (frame = 0; frame < 800; frame++) {
      lines[4999] = `  Streaming ${frame} 界 é`;
      host.doRender();
      assert.equal(host.viewportTop, 4968);
      assert.equal(tui.getScreenLines().length, 32);
      assert.ok(stripTerminalSequences(tui.getScreenLines()[31]!).includes(`Streaming ${frame} 界 é`));
      assert.ok((compositor as any).cache.size <= 64);
      assert.equal(host.currentLayout.lines[31], lines[4999]);
    }
    assert.equal(host.fullRedrawCount, 1, "animation uses native incremental rows, not screen clears");
    host.handleViewportInput("\x1b[<64;20;10M");
    host.doRender();
    const scrolled = host.viewportTop;
    assert.ok(scrolled < 4968);
    for (let i = 0; i < 20; i++) { frame++; host.doRender(); assert.equal(host.viewportTop, scrolled); }
  } finally { hook.dispose(); compositor.clear(); tui.stop(); }
  assert.equal((compositor as any).cache.size, 0);
});

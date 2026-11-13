import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";

// An optional installed-host path repeats this check without modifying dependencies.
const host = process.env.OMT_INSTRUCTION_HOST
  ? resolve(process.env.OMT_INSTRUCTION_HOST, "dist/core/resource-loader.js")
  : resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "core/resource-loader.js");
const { loadProjectContextFiles } = await import(pathToFileURL(host).href);

test("native instruction discovery is ancestor-only with explicit nested scope precedence", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "omt-instructions-"));
  try {
    const agentDir = join(sandbox, "agent"), cwd = join(sandbox, "project");
    mkdirSync(agentDir); mkdirSync(join(cwd, "child"), { recursive: true });
    writeFileSync(join(agentDir, "AGENTS.md"), "global");
    writeFileSync(join(cwd, "AGENTS.md"), "root");
    writeFileSync(join(cwd, "child/AGENTS.md"), "child");
    const load = (dir: string) => loadProjectContextFiles({ cwd: dir, agentDir })
      .filter((f: { path: string }) => f.path.startsWith(sandbox));
    assert.deepEqual(load(cwd).map((f: { content: string }) => f.content), ["global", "root"]);
    // Reading the nested file cannot modify native discovery for the launch cwd.
    assert.equal(readFileSync(join(cwd, "child/AGENTS.md"), "utf8"), "child");
    assert.equal(load(cwd).length, 2);
    assert.deepEqual(load(join(cwd, "child")).map((f: { content: string }) => f.content), ["global", "root", "child"]);
    writeFileSync(join(cwd, "child/AGENTS.override.md"), "override");
    assert.equal(load(join(cwd, "child")).at(-1).content, "override");
  } finally { rmSync(sandbox, { recursive: true, force: true }); }
});

test("repository root startup excludes descendant scopes and keeps instructions small", () => {
  const cwd = resolve(".");
  const project = loadProjectContextFiles({ cwd, agentDir: join(tmpdir(), "omt-no-agent-instructions") })
    .filter((f: { path: string }) => f.path.startsWith(cwd + "/"));
  assert.deepEqual(project.map((f: { path: string }) => f.path), [join(cwd, "AGENTS.md")]);
  assert.ok(Buffer.byteLength(project[0].content) < 800);
});

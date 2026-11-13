import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { stripTypeScriptTypes } from "node:module";

const root = resolve("extensions/omt");
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(resolve(dir, e.name)) : e.name.endsWith(".ts") ? [resolve(dir, e.name)] : []);
}
const sources = files(root);
const graph = new Map<string, string[]>();
const lazyGraph = new Map<string, string[]>();
for (const file of sources) {
  const js = stripTypeScriptTypes(readFileSync(file, "utf8"));
  const deps: string[] = [];
  for (const match of js.matchAll(/(?:import|export)\s+(?:[^;]*?\s+from\s+)?["'](\.[^"']+)["']/g)) {
    deps.push(resolve(dirname(file), match[1]!));
  }
  graph.set(file, deps);
  lazyGraph.set(file, [...deps, ...[...js.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)]
    .map(m => resolve(dirname(file), m[1]!))]);
}

test("runtime modules form an acyclic graph with resolvable imports", () => {
  const visited = new Set<string>();
  const stack: string[] = [];
  function visit(file: string) {
    assert.ok(existsSync(file), `missing ${relative(root, file)}`);
    assert.ok(!stack.includes(file), `cycle: ${[...stack, file].map(f => relative(root, f)).join(" → ")}`);
    if (visited.has(file)) return;
    stack.push(file);
    for (const dep of lazyGraph.get(file) ?? []) visit(dep);
    stack.pop();
    visited.add(file);
  }
  for (const file of sources) visit(file);
});

test("startup leaves optional interactive views and graphics codecs unloaded", () => {
  const visited = new Set<string>();
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    for (const dep of graph.get(file) ?? []) visit(dep);
  }
  visit(resolve(root, "index.ts"));
  for (const file of visited) {
    assert.doesNotMatch(relative(root, file), /\/view\.ts$/);
    assert.notEqual(file, resolve(root, "features/backgrounds/renderers/chafa.ts"));
  }
  assert.ok(readFileSync(resolve(root, "index.ts"), "utf8").split("\n").length < 10);
});

test("feature models and stores never depend on interactive views or integration", () => {
  for (const file of sources) {
    if (!/\/(model|store)\.ts$/.test(file)) continue;
    for (const dep of lazyGraph.get(file) ?? []) {
      assert.doesNotMatch(relative(root, dep), /(?:^integration\/|\/view\.ts$)/);
    }
  }
});

test("background internals do not import Pi integration, configuration or unrelated features", () => {
  for (const file of sources) {
    const name = relative(root, file);
    if (!/^features\/backgrounds\/(assets|scenes|renderers|compositor|motion|capabilities)\//.test(name)) continue;
    for (const dep of graph.get(file) ?? []) {
      assert.ok(relative(root, dep).startsWith("features/backgrounds/"), `${name} → ${relative(root, dep)}`);
      assert.notEqual(dep, resolve(root, "features/backgrounds/index.ts"));
      assert.notEqual(dep, resolve(root, "features/backgrounds/integration.ts"));
    }
  }
});

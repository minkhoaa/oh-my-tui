import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { isBuiltin, stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const publicFiles = ["package.json", "README.md", "LICENSE", "NOTICE"];

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}
function runtimeImports(file: string): string[] {
  const js = stripTypeScriptTypes(readFileSync(join(root, file), "utf8"));
  return [
    ...js.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g),
    ...js.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map(match => match[1]!);
}
const sources = sourceFiles("extensions/omt");
const catalogPath = "extensions/omt/backgrounds/catalog.json";
const catalog = JSON.parse(readFileSync(join(root, catalogPath), "utf8"));

test("npm tarball contains exactly the runtime, catalog assets, public docs and legal files", t => {
  const cache = mkdtempSync(join(tmpdir(), "omt-pack-test-"));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  // Inspect npm's real allowlist resolution without scripts, network or a repository artifact.
  const output = execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json", "--offline"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, npm_config_cache: cache, npm_config_update_notifier: "false" },
  });
  const [pack] = JSON.parse(output);
  const packed = new Set<string>(pack.files.map((file: { path: string }) => file.path));
  const expected = new Set([
    ...sources, ...publicFiles, catalogPath,
    ...catalog.backgrounds.map((entry: { metadata: { id: string } }) =>
      `extensions/omt/backgrounds/${entry.metadata.id}.rgba.gz`),
  ]);
  assert.deepEqual([...packed].sort(), [...expected].sort(), "review unexpected or missing published files");
  assert.equal(pack.name, manifest.name);
  assert.equal(pack.version, manifest.version);
  assert.deepEqual(pack.bundled, [], "native Pi and the codec must not be bundled");
  for (const path of manifest.pi.extensions) assert.ok(packed.has(path.replace(/^\.\//, "")));

  for (const file of sources) {
    for (const specifier of runtimeImports(file)) {
      if (!specifier.startsWith(".")) continue;
      assert.ok(packed.has(posix.normalize(posix.join(dirname(file), specifier))), `${file}: unpackaged import ${specifier}`);
    }
  }
});

test("runtime external imports are declared and native Pi is host-provided", () => {
  const peers = manifest.peerDependencies;
  for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
    assert.equal(peers[name], "*");
    assert.equal(manifest.peerDependenciesMeta[name].optional, true);
    assert.equal(manifest.dependencies[name], undefined);
  }
  for (const file of sources) {
    for (const specifier of runtimeImports(file)) {
      if (specifier.startsWith(".") || isBuiltin(specifier)) continue;
      const parts = specifier.split("/");
      const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
      assert.ok(manifest.dependencies[name] || peers[name], `${file}: undeclared runtime dependency ${name}`);
    }
  }
  assert.equal(manifest.publishConfig.access, "public");
  assert.deepEqual(manifest.repository, { type: "git", url: "git+https://github.com/minkhoaa/oh-my-tui.git" });
  assert.ok(manifest.keywords.includes("pi-package"));
  assert.equal(manifest.license, "MIT");
});

test("shipped background assets match their pinned catalog hashes and dimensions", () => {
  for (const entry of catalog.backgrounds) {
    assert.match(entry.metadata.id, /^[a-f0-9]{64}$/);
    const pixels = gunzipSync(readFileSync(join(root, `extensions/omt/backgrounds/${entry.metadata.id}.rgba.gz`)));
    assert.equal(createHash("sha256").update(pixels).digest("hex"), entry.framesSha256, entry.alias);
    assert.equal(pixels.length, entry.metadata.width * entry.metadata.height * 4 * entry.metadata.frameCount, entry.alias);
  }
});

test("release version is documented and the lockfile matches the manifest", () => {
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  assert.ok(changelog.includes(`## [${manifest.version}]`), "document the release before publishing");
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, manifest.version);
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
  assert.deepEqual(lock.packages[""].devDependencies, manifest.devDependencies);
  assert.deepEqual(lock.packages[""].peerDependencies, manifest.peerDependencies);
});

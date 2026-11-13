// Run the same native-component/session tests against any locally installed host.
// Usage: node --experimental-strip-types test/host-compatibility.ts /path/to/pi-coding-agent
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire, findPackageJSON } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const host = process.argv[2]
  ? resolve(process.argv[2], "package.json")
  : resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "../package.json");
const hostRequire = createRequire(host);
const nativeSuites = ["extension", "dialog-pixel-regression", "host-theme", "assistant-blocks", "transcript-composition", "working-border", "toasts", "motion", "visual", "editor", "user-message", "tools", "footer", "thinking", "settings", "background", "background-compositor", "background-stress", "background-assets", "background-assets-integration", "background-presets", "terminal-first", "modular-backgrounds", "procedural-scenes", "chafa-background", "texture-scale", "signature", "sidebar", "omt-transcript", "omt-composer", "omt-dashboard", "omt-integration", "parity-main-startup", "parity-modal-host", "parity-native-viewport", "tree-transcript-tail", "parity-dialog-wiring"];
const suites = [...nativeSuites, ...readdirSync(dirname(fileURLToPath(import.meta.url)))
  .filter(name => /^quick-.*\.test\.ts$/.test(name))
  .map(name => name.slice(0, -".test.ts".length))];
const suite = process.argv[3];
if (suite) {
  if (!suites.includes(suite)) throw new Error(`Unknown suite: ${suite}`);
  const { createJiti } = hostRequire("jiti");
  const jiti = createJiti(import.meta.url, {
    alias: {
      "@earendil-works/pi-coding-agent": hostRequire.resolve("./dist/index.js"),
      "@earendil-works/pi-tui": hostRequire.resolve("@earendil-works/pi-tui"),
      // pi-ai has an import-only root export in 1.5.2; require.resolve rejects it.
      "@earendil-works/pi-ai": (() => {
        const manifest = findPackageJSON("@earendil-works/pi-ai", pathToFileURL(host));
        if (!manifest) throw new Error("Installed host pi-ai package not found");
        const entry = createRequire(manifest)(manifest).exports["."].import;
        if (typeof entry !== "string") throw new Error("Installed host pi-ai import export missing");
        return resolve(dirname(manifest), entry);
      })(),
    },
  });
  await jiti.import(resolve(dirname(fileURLToPath(import.meta.url)), `${suite}.test.ts`));
} else {
  console.log(`Testing Pi ${hostRequire("./package.json").version} at ${dirname(host)}`);
  // Match node --test's file isolation: presets, prototypes and mocks are global.
  for (const name of suites) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url), dirname(host), name], { stdio: "inherit" });
    if (child.error) throw child.error;
    if (child.status !== 0) process.exit(child.status ?? 1);
  }
}

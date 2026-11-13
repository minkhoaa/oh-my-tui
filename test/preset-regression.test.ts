import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("440 baseline ANSI cases retain provenance with 18 explicit layout corrections", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const { OMT_REGRESSION_SOURCE: _source, ...env } = process.env;
  const actual = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "test/preset-regression.ts"], { cwd: root, env, encoding: "utf8", timeout: 30000 }));
  const expected = JSON.parse(readFileSync(new URL("./fixtures/preset-regression.json", import.meta.url), "utf8"));
  assert.equal(Object.keys(expected).length, 440);
  const corrections = JSON.parse(readFileSync(new URL("./fixtures/layout-corrections.json", import.meta.url), "utf8")).cases;
  assert.equal(Object.keys(corrections).length, 18);
  for (const [key, correction] of Object.entries(corrections) as [string, { before: string; after: string }][]) {
    assert.match(key, /^(dark|light)\/opencode-inspired\/(10|20|40|80|120)\/(read|write)\/(true|false)$/);
    assert.equal(expected[key], correction.before, "retain original snapshot provenance");
    expected[key] = correction.after;
  }
  assert.deepEqual(actual, expected);
});

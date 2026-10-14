import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { closure, findMissing, unpackedNames } from "./check-unpack.mjs";

/**
 * `check:unpack` keeps the packaged assistant loadable: everything the unpacked
 * `node-llama-cpp` imports must be unpacked beside it. 2.0.0 to 2.0.2 shipped
 * without that, and no test outside a packaged build could see it.
 */

const YML = [
  "files:",
  "  - out/**/*",
  "asarUnpack:",
  "  - node_modules/better-sqlite3-multiple-ciphers/**/*",
  "  # a comment line",
  '  - "node_modules/@node-llama-cpp/**/*"',
  "  - node_modules/chalk/**/*",
  "  - node_modules/@huggingface/jinja/**/*",
  "  - node_modules/sharp/build/**/*",
  "npmRebuild: false",
  "  - node_modules/after-the-list/**/*",
].join("\r\n");

describe("unpackedNames", () => {
  it("reads whole packages and scopes from the list, and nothing past it", () => {
    expect([...unpackedNames(YML)].sort()).toEqual([
      "@huggingface/jinja",
      "@node-llama-cpp",
      "better-sqlite3-multiple-ciphers",
      "chalk",
    ]);
  });

  it("refuses a file without the list rather than passing over it", () => {
    expect(() => unpackedNames("files:\n  - out/**/*\n")).toThrow(/asarUnpack/);
  });
});

describe("findMissing", () => {
  it("accepts a package covered by its own entry or by its scope", () => {
    expect(findMissing(YML, ["chalk", "@node-llama-cpp/win-x64", "@huggingface/jinja"])).toEqual([]);
  });

  it("names the rest, sorted — including a package unpacked only in part", () => {
    expect(findMissing(YML, ["sharp", "lifecycle-utils", "@huggingface/hub"])).toEqual([
      "@huggingface/hub",
      "lifecycle-utils",
      "sharp",
    ]);
  });
});

describe("closure", () => {
  const root = mkdtempSync(join(tmpdir(), "check-unpack-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const pkg = (dir, manifest) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  };
  const modules = join(root, "node_modules");
  pkg(join(modules, "llama"), {
    name: "llama",
    dependencies: { utils: "^1", ipull: "^1" },
    optionalDependencies: { "@llama/other-platform": "1" },
    devDependencies: { vitest: "^4" },
  });
  pkg(join(modules, "utils"), { name: "utils", version: "2.0.0" });
  pkg(join(modules, "ipull"), { name: "ipull", dependencies: { utils: "^1", "@scope/deep": "1" } });
  pkg(join(modules, "ipull", "node_modules", "utils"), { name: "utils", version: "1.0.0" });
  pkg(join(modules, "@scope", "deep"), { name: "@scope/deep", dependencies: { llama: "*" } });
  pkg(join(modules, "vitest"), { name: "vitest" });

  it("follows dependencies and optional ones, through nesting and cycles, and skips what is not installed", () => {
    expect([...closure(["llama"], root)].sort()).toEqual(["@scope/deep", "ipull", "llama", "utils"]);
  });
});

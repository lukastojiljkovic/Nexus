import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The hook runs in a child process: Vitest transforms `.ts` itself and would
 * pass with or without the resolve hook, so only a plain Node process proves it.
 */
describe("ts-import", () => {
  it("imports a core .ts module through its .js specifiers, in plain Node", () => {
    const hook = new URL("./ts-import.mjs", import.meta.url).href;
    const core = new URL("../../packages/core/src/games/nonogram/nonogram.ts", import.meta.url).href;
    const script = [
      `await import(${JSON.stringify(hook)});`,
      `const core = await import(${JSON.stringify(core)});`,
      `console.log(core.cluesOf([true, true, false, true]).join(","));`,
    ].join("\n");
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    expect(out.trim()).toBe("2,1");
  });
});

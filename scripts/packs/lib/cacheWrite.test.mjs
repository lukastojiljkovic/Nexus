import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeCacheFile } from "./cacheWrite.mjs";

/**
 * The two properties a cache under `%TEMP%` needs from its writer: the bytes land
 * at the name the caller asked for, and the attempt leaves nothing behind. The
 * third, that a name planted by another process cannot be followed, is what
 * `mkdtemp` gives and what a single-process test cannot demonstrate; the writer's
 * own header carries that argument.
 */
describe("writeCacheFile", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cache-write-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the bytes at the name it was given", () => {
    const path = join(dir, "body.bin");
    writeCacheFile(path, Buffer.from([1, 2, 3]));
    expect([...readFileSync(path)]).toEqual([1, 2, 3]);
  });

  it("replaces a file that is already there, because a cache is refreshed in place", () => {
    const path = join(dir, "body.bin");
    writeFileSync(path, "old");
    writeCacheFile(path, "new");
    expect(readFileSync(path, "utf8")).toBe("new");
  });

  it("leaves no scratch directory behind", () => {
    writeCacheFile(join(dir, "body.bin"), "x");
    expect(readdirSync(dir)).toEqual(["body.bin"]);
  });

  it("keeps the file to its owner where the platform has that mode", () => {
    const path = join(dir, "body.bin");
    writeCacheFile(path, "x");
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });
});

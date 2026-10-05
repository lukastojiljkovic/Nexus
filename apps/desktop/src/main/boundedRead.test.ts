import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readFileBounded } from "./boundedRead.js";

/**
 * The six file picks in main all read a path the user chose in a native dialog,
 * and js/file-system-race (#25-#30) is what the old shape cost them: `stat`
 * followed by `readFile` is two lookups of one path, so the size the cap was
 * checked against could belong to a different file than the bytes that landed
 * in memory. One handle is the fix, and these are the answers it has to give.
 *
 * The scratch directory is `mkdtempSync`'s, so no case here can touch another
 * process's temp files, and it is removed after each one.
 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-bounded-read-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readFileBounded", () => {
  const CSV = "naziv,iznos\na,1\n";

  it("answers the bytes and the size the cap was measured against", async () => {
    const path = join(dir, "cells.csv");
    writeFileSync(path, CSV);

    const read = await readFileBounded(path, 1024);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.bytes.toString("utf8")).toBe(CSV);
    expect(read.size).toBe(CSV.length);
  });

  it("refuses a file over the cap before its bytes are loaded", async () => {
    const path = join(dir, "big.bin");
    // Sparse: the size is the fact under test and the disk does not have to
    // hold four kilobytes for it.
    writeFileSync(path, "");
    truncateSync(path, 4096);

    expect(await readFileBounded(path, 1024)).toEqual({ status: "too-large" });
  });

  it("still reads a file of exactly the cap", async () => {
    const path = join(dir, "exact.bin");
    writeFileSync(path, Buffer.alloc(1024, 7));

    const read = await readFileBounded(path, 1024);
    expect(read.status).toBe("ok");
    if (read.status === "ok") expect(read.bytes.byteLength).toBe(1024);
  });

  it("refuses a path that is not there", async () => {
    expect(await readFileBounded(join(dir, "gone.csv"), 1024)).toEqual({ status: "unreadable" });
  });

  it("refuses a directory where a file was expected", async () => {
    const path = join(dir, "a-directory");
    mkdirSync(path);

    // Windows answers the open itself (EISDIR, so "unreadable"); POSIX opens a
    // directory and answers from the handle's own stat ("not-a-file"). Both are
    // the same refusal to every picker, which is why the type keeps them apart
    // and the pickers do not.
    const read = await readFileBounded(path, 1024);
    expect(["unreadable", "not-a-file"]).toContain(read.status);
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addLibrary,
  isValidLibraryId,
  librariesPath,
  libraryIdFromPath,
  libraryPresent,
  parseLibraries,
  readLibraries,
  removeLibrary,
  writeLibraries,
  type ZimLibraryRecord,
} from "./libraries.js";

/**
 * The device-level library index: what it accepts, what it refuses, and what it
 * keeps when a file goes away.
 *
 * Every case runs against a real directory under the system temp directory, so
 * the atomic write and the "is the file still there" check are exercised rather
 * than mocked.
 */
describe("the ZIM library index", () => {
  let userData: string;

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), "nx-zim-lib-"));
  });

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true });
  });

  const record = (overrides: Partial<ZimLibraryRecord> = {}): ZimLibraryRecord => ({
    id: "wikipedia-sr-mini",
    title: "Wikipedia (sr)",
    path: join(userData, "wikipedia.zim"),
    bytes: 2_029_773_550,
    integrity: "none",
    checksum: "2fb62a7110deffd3b192d922dffa02c1",
    source: null,
    language: "srp",
    addedAt: 1_760_000_000_000,
    ...overrides,
  });

  it("answers an empty list when nothing is installed", () => {
    expect(readLibraries(userData)).toEqual([]);
  });

  it("round-trips a record", () => {
    writeLibraries(userData, [record()]);
    expect(readLibraries(userData)).toEqual([record()]);
  });

  it("adds a second library and replaces a record for the same file", () => {
    addLibrary(userData, record());
    addLibrary(userData, record({ id: "other", title: "Other", path: join(userData, "other.zim") }));
    expect(readLibraries(userData)).toHaveLength(2);
    // The same FILE, re-added: the id is kept and the record is the newer one.
    addLibrary(userData, record({ title: "Wikipedia, renamed" }));
    const libraries = readLibraries(userData);
    expect(libraries).toHaveLength(2);
    expect(libraries.find((row) => row.path === record().path)?.title).toBe("Wikipedia, renamed");
  });

  it("forgets a library without touching its file", () => {
    writeFileSync(record().path, "not really a zim");
    addLibrary(userData, record());
    const libraries = removeLibrary(userData, "wikipedia-sr-mini");
    expect(libraries).toEqual([]);
    expect(libraryPresent(record())).toBe(true);
  });

  it("reports a library whose file has gone", () => {
    const missing = record({ path: join(userData, "gone.zim") });
    expect(libraryPresent(missing)).toBe(false);
  });

  it("refuses a file that is not this version's index", () => {
    // The directory has to exist before a hand-written file can land in it;
    // writing through the store is also what makes this a file the next read
    // would otherwise accept.
    writeLibraries(userData, []);
    writeFileSync(librariesPath(userData), JSON.stringify({ version: 99, libraries: [record()] }), "utf8");
    expect(readLibraries(userData)).toEqual([]);
    writeFileSync(librariesPath(userData), "{ not json", "utf8");
    expect(readLibraries(userData)).toEqual([]);
  });

  it("drops a record an id cannot name, and keeps its neighbours", () => {
    const good = record();
    expect(
      parseLibraries({
        version: 1,
        libraries: [
          { ...good, id: "Not A Host" },
          { ...good, id: "ok-id", path: "" },
          { ...good, id: "bad-checksum", checksum: "nope" },
          { ...good, id: "good-id" },
          { ...good, id: "good-id" },
        ],
      }),
    ).toEqual([{ ...good, id: "good-id" }]);
  });

  it("only accepts ids a standard URL scheme could name again", () => {
    expect(isValidLibraryId("wikipedia-sr-mini")).toBe(true);
    expect(isValidLibraryId("wikipedia_sr_mini")).toBe(false);
    expect(isValidLibraryId("Wikipedia")).toBe(false);
    expect(isValidLibraryId("-leading")).toBe(false);
    expect(isValidLibraryId(`a${"b".repeat(64)}`)).toBe(false);
  });

  it("derives an id from a file name, and makes it unique", () => {
    expect(libraryIdFromPath("C:\\Downloads\\Wikipedia SR mini 2026-09.zim", new Set())).toBe(
      "wikipedia-sr-mini-2026-09",
    );
    expect(libraryIdFromPath("/tmp/кон.jpg", new Set())).toBe("zim");
    expect(libraryIdFromPath("/a/dup.zim", new Set(["dup"]))).toBe("dup-2");
    expect(libraryIdFromPath("/a/dup.zim", new Set(["dup", "dup-2"]))).toBe("dup-3");
  });
});

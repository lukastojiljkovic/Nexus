import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NexusDatabase, WikiStore, openDatabase, uuidv7 } from "@nexus/db";
import type { Tool, ToolContext } from "@nexus/core";
import { wikiTools } from "./wiki.js";

/**
 * The WIKI tool over a real database: what was read, and what was kept. Both
 * halves answer with the page's own two columns — a title and the path inside
 * the ZIM — because that is what the user sees in „Skorije čitano".
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-wiki-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function store(): WikiStore {
  return new WikiStore(db.raw, profileId);
}

function context(locale: "sr" | "en"): ToolContext {
  return {
    profileId,
    locale,
    signal: new AbortController().signal,
    confirm: () => Promise.resolve(true),
  };
}

function tool(): Tool {
  const found = wikiTools({ profileDb: (id, open) => open(db.raw, id) }).find(
    (entry) => entry.name === "wiki.recent",
  );
  if (found === undefined) throw new Error('Test setup: no tool "wiki.recent".');
  return found;
}

const PLACE = {
  libraryId: "wikipedija-sr",
  zimPath: "A/Andrićgrad",
  title: "Andrićgrad",
} as const;

describe("wiki.recent", () => {
  it("reads a visit and a kept place, each with its own day", async () => {
    store().recordVisit(PLACE, NOW_ISO);
    store().bookmark(PLACE, NOW_ISO);

    const result = await tool().run({}, context("sr"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Skorije čitano (1):",
        "- Andrićgrad — A/Andrićgrad (čitano 10. oktobar 2026)",
        "Obeleženo (1):",
        "- Andrićgrad — A/Andrićgrad (sačuvano 10. oktobar 2026)",
      ].join("\n"),
    });
  });

  it("says both sides are empty on a machine that has read nothing", async () => {
    const result = await tool().run({}, context("en"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Nothing has been read from the reference library yet.",
        "Nothing is kept.",
      ].join("\n"),
    });
  });

  it("caps each half at the limit it was given", async () => {
    store().recordVisit(PLACE, NOW_ISO);
    // A minute later, so "newest first" is a fact about the rows rather than
    // about which of two identical instants SQLite happened to return first.
    store().recordVisit(
      { ...PLACE, zimPath: "B/Beograd", title: "Beograd" },
      new Date(NOW_MS + 60_000).toISOString(),
    );

    const result = await tool().run({ limit: 1 }, context("en"));
    expect(result.content).toBe(
      ["Recently read (2):", "- Beograd — B/Beograd (read 10 October 2026)", "…and 1 more.", "Nothing is kept."].join(
        "\n",
      ),
    );
  });
});

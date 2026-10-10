import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NexusDatabase, ReaderStore, openDatabase, uuidv7 } from "@nexus/db";
import type { Tool, ToolContext } from "@nexus/core";
import type { InstalledPackView } from "../../../shared/ipc.js";
import { readerTools } from "./reader.js";

/**
 * The READER tool over a real database.
 *
 * A position names a pack id and the title a person reads comes from the Packs
 * service, so this suite pins both ends: the installed book by its title, and a
 * book that has since been removed by the id the row still carries.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();
const PACK_ID = "knjiga-1";

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-reader-"));
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

function store(): ReaderStore {
  return new ReaderStore(db.raw, profileId);
}

function pack(id: string, title: string): InstalledPackView {
  return {
    id,
    version: "2026.1",
    kind: "content",
    notice: null,
    title: { sr: title, en: title },
    description: { sr: "Knjiga.", en: "A book." },
    licence: {
      spdx: "CC-BY-4.0",
      attribution: "Neki autor",
      url: "https://creativecommons.org/licenses/by/4.0/",
    },
    source: { name: "Neki autor", url: "https://example.org" },
    size: 1_000,
    fileCount: 2,
    installedAt: NOW_MS,
  };
}

function toolWith(packs: readonly InstalledPackView[]): Tool {
  const found = readerTools({
    profileDb: (id, open) => open(db.raw, id),
    packs: { list: () => Promise.resolve(packs) },
  }).find((entry) => entry.name === "reader.progress");
  if (found === undefined) throw new Error('Test setup: no tool "reader.progress".');
  return found;
}

function context(locale: "sr" | "en"): ToolContext {
  return {
    profileId,
    locale,
    signal: new AbortController().signal,
    confirm: () => Promise.resolve(true),
  };
}

describe("reader.progress", () => {
  it("names the book by its installed title and reads the bookmark beside it", async () => {
    store().setPosition(PACK_ID, "clanci/uvod.md", NOW_ISO);
    store().setBookmark(PACK_ID, "clanci/uvod.md", "Ovde se vraćam", NOW_ISO);

    const result = await toolWith([pack(PACK_ID, "Mapa Srbije")]).run({}, context("sr"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Nastavi sa čitanjem (1):",
        "- Mapa Srbije: clanci/uvod.md (poslednji put 10. oktobar 2026)",
        "Obeleživači (1):",
        "- Mapa Srbije: clanci/uvod.md — Ovde se vraćam",
      ].join("\n"),
    });
  });

  it("falls back to the pack id when the book is gone, and says nothing is open", async () => {
    store().setPosition("otklonjena-knjiga", "clanci/uvod.md", NOW_ISO);
    const gone = await toolWith([]).run({}, context("en"));
    expect(gone.content).toBe(
      [
        "Continue reading (1):",
        "- otklonjena-knjiga: clanci/uvod.md (last read 10 October 2026)",
        "There are no bookmarks.",
      ].join("\n"),
    );
  });

  it("says there is nothing to continue when no book was ever opened", async () => {
    const result = await toolWith([pack(PACK_ID, "Knjiga")]).run({}, context("en"));
    expect(result).toEqual({
      ok: true,
      content: [
        "No book has been opened, so there is nothing to continue.",
        "There are no bookmarks.",
      ].join("\n"),
    });
  });
});

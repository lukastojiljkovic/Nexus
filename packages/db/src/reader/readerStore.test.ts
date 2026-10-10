import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, uuidv7, type NexusDatabase } from "../index.js";
import {
  MAX_READER_NOTE_LENGTH,
  ReaderStore,
  ReaderValidationError,
  type ReaderTextSize,
} from "./readerStore.js";

/**
 * READER's storage (migration 084, ADR-100).
 *
 * The assertions are about the two rules the schema is shaped around: one
 * position per pack (keyed by the pair, not accumulated), and one bookmark per
 * article whose note can be rewritten without losing when it was first taken.
 * The transaction `replaceFromArchive` opens is tested through the only thing a
 * reader can check from outside it - that a payload the store refuses leaves the
 * profile exactly as it found it.
 *
 * ONE database for the whole file, and a fresh PROFILE per case: every row here
 * is scoped by `profile_id`, so a new profile is as isolated as a new file while
 * paying for the migration set once instead of twelve times.
 */

let dir: string;
let db: NexusDatabase;
let profileId: string;
const NOW = "2026-10-10T09:00:00.000Z";
const LATER = "2026-10-10T10:00:00.000Z";

function store(profile = profileId): ReaderStore {
  return new ReaderStore(db.raw, profile);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-reader-"));
  db = openDatabase({ path: join(dir, "reader.db") });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "P", NOW);
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("positions", () => {
  it("holds one position per pack and moves it rather than adding a second", () => {
    store().setPosition("prva-pomoc", "uvod.md", NOW);
    store().setPosition("prva-pomoc", "opekotine.md", LATER);

    expect(store().listPositions()).toEqual([
      { packId: "prva-pomoc", articlePath: "opekotine.md", updatedAt: LATER },
    ]);
    expect(store().position("prva-pomoc")).toEqual({
      packId: "prva-pomoc",
      articlePath: "opekotine.md",
      updatedAt: LATER,
    });
  });

  it("answers null for a pack this profile never opened", () => {
    expect(store().position("nema")).toBeNull();
    expect(store().listPositions()).toEqual([]);
  });

  it("keeps two profiles' positions apart", () => {
    const other = uuidv7();
    db.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(other, "personal", "Q", NOW);
    store().setPosition("prva-pomoc", "uvod.md", NOW);
    store(other).setPosition("prva-pomoc", "krvarenje.md", NOW);

    expect(store().position("prva-pomoc")?.articlePath).toBe("uvod.md");
    expect(store(other).position("prva-pomoc")?.articlePath).toBe("krvarenje.md");
  });

  it("refuses a pack id, a path or an instant that could never be a row", () => {
    expect(() => store().setPosition("", "uvod.md", NOW)).toThrow(ReaderValidationError);
    expect(() => store().setPosition("a".repeat(65), "uvod.md", NOW)).toThrow(/1\.\.64/);
    expect(() => store().setPosition("prva-pomoc", "", NOW)).toThrow(/1\.\.240/);
    expect(() => store().setPosition("prva-pomoc", "uvod.md", "juce")).toThrow(/not an instant/);
  });
});

describe("bookmarks", () => {
  it("takes one bookmark per article and keeps when it was first taken", () => {
    const first = store().setBookmark("prva-pomoc", "uvod.md", "", NOW);
    const rewritten = store().setBookmark("prva-pomoc", "uvod.md", "vidi tabelu", LATER);

    expect(store().bookmarksOf("prva-pomoc")).toHaveLength(1);
    expect(rewritten.note).toBe("vidi tabelu");
    expect(rewritten.createdAt).toBe(NOW);
    expect(rewritten.updatedAt).toBe(LATER);
    expect(rewritten.id).toBe(first.id);
  });

  it("lists this profile's bookmarks by pack and article, and removes one", () => {
    store().setBookmark("prva-pomoc", "uvod.md", "", NOW);
    store().setBookmark("prva-pomoc", "krvarenje.md", "hitno", NOW);
    store().setBookmark("zakoni", "ustav.md", "", NOW);

    expect(store().listBookmarks().map((bookmark) => `${bookmark.packId}/${bookmark.articlePath}`)).toEqual([
      "prva-pomoc/krvarenje.md",
      "prva-pomoc/uvod.md",
      "zakoni/ustav.md",
    ]);
    expect(store().removeBookmark("prva-pomoc", "uvod.md")).toBe(true);
    // A second removal answers false rather than throwing: a double click is not
    // an error, and the page re-reads either way.
    expect(store().removeBookmark("prva-pomoc", "uvod.md")).toBe(false);
    expect(store().bookmarksOf("prva-pomoc").map((bookmark) => bookmark.articlePath)).toEqual([
      "krvarenje.md",
    ]);
  });

  it("refuses a note longer than the column allows", () => {
    expect(() => store().setBookmark("prva-pomoc", "uvod.md", "x".repeat(501), NOW)).toThrow(
      /at most 500/,
    );
    expect(store().setBookmark("prva-pomoc", "uvod.md", "x".repeat(MAX_READER_NOTE_LENGTH), NOW).note)
      .toHaveLength(MAX_READER_NOTE_LENGTH);
  });
});

describe("settings and acknowledgements", () => {
  it("answers the default before anything is chosen, and stores a chosen size", () => {
    expect(store().settings()).toEqual({ textSize: "m" });
    expect(store().setTextSize("l", NOW)).toEqual({ textSize: "l" });
    expect(store().setTextSize("s", LATER)).toEqual({ textSize: "s" });
    expect(store().settings()).toEqual({ textSize: "s" });
  });

  it("records an acknowledgement once, per pack", () => {
    store().acknowledge("prva-pomoc", NOW);
    store().acknowledge("prva-pomoc", LATER);
    store().acknowledge("zakoni", NOW);
    expect(store().listAcknowledged()).toEqual(["prva-pomoc", "zakoni"]);
  });
});

describe("the archive replace", () => {
  const payload = {
    positions: [{ packId: "prva-pomoc", articlePath: "opekotine.md" }],
    bookmarks: [
      { packId: "prva-pomoc", articlePath: "uvod.md", note: "" },
      { packId: "zakoni", articlePath: "ustav.md", note: "clan 4" },
    ],
    textSize: "l" as ReaderTextSize,
    acknowledged: ["prva-pomoc"],
  };

  it("replaces everything the module holds with what the archive carried", () => {
    store().setPosition("zakoni", "ustav.md", NOW);
    store().setBookmark("prva-pomoc", "krvarenje.md", "staro", NOW);
    store().setTextSize("s", NOW);

    store().replaceFromArchive(payload, NOW);

    expect(store().listPositions().map((row) => row.articlePath)).toEqual(["opekotine.md"]);
    expect(store().bookmarksOf("prva-pomoc").map((row) => row.articlePath)).toEqual(["uvod.md"]);
    expect(store().bookmarksOf("zakoni").map((row) => row.note)).toEqual(["clan 4"]);
    expect(store().settings()).toEqual({ textSize: "l" });
    expect(store().listAcknowledged()).toEqual(["prva-pomoc"]);
  });

  it("empties the archived state when the archive says nothing, default included", () => {
    store().setPosition("prva-pomoc", "uvod.md", NOW);
    store().setBookmark("prva-pomoc", "uvod.md", "x", NOW);
    store().setTextSize("l", NOW);
    store().acknowledge("prva-pomoc", NOW);

    store().replaceFromArchive(
      { positions: [], bookmarks: [], textSize: null, acknowledged: [] },
      NOW,
    );

    expect(store().listPositions()).toEqual([]);
    expect(store().listBookmarks()).toEqual([]);
    expect(store().listAcknowledged()).toEqual([]);
    // The row is GONE rather than holding today's default, so the default stays
    // written down in exactly one place.
    expect(
      db.raw
        .prepare("SELECT count(*) AS n FROM reader_settings WHERE profile_id = ?")
        .get(profileId) as { n: number },
    ).toEqual({ n: 0 });
    expect(store().settings()).toEqual({ textSize: "m" });
  });

  it("refuses a payload it cannot read whole, leaving the profile exactly as it found it", () => {
    store().setBookmark("prva-pomoc", "uvod.md", "moj", NOW);

    const broken = [
      { ...payload, bookmarks: [{ packId: "prva-pomoc", articlePath: "uvod.md", note: "" }, { packId: "prva-pomoc", articlePath: "uvod.md", note: "x" }] },
      { ...payload, positions: [{ packId: "prva-pomoc", articlePath: "a.md" }, { packId: "prva-pomoc", articlePath: "b.md" }] },
      { ...payload, bookmarks: [{ packId: "prva-pomoc", articlePath: "uvod.md", note: "x".repeat(501) }] },
    ];
    for (const input of broken) {
      expect(() => store().replaceFromArchive(input, NOW)).toThrow(ReaderValidationError);
    }
    expect(store().bookmarksOf("prva-pomoc").map((bookmark) => bookmark.note)).toEqual(["moj"]);
  });
});

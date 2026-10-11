import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MAX_WIKI_BOOKMARKS,
  MAX_WIKI_HISTORY,
  NexusDatabase,
  openDatabase,
  WikiNotFoundError,
  WikiStore,
  WikiValidationError,
  uuidv7,
} from "../index.js";

const NOW = "2026-10-10T08:00:00.000Z";
const LATER = "2026-10-10T09:00:00.000Z";

/**
 * ONE database for the whole file, and a fresh PROFILE per test.
 *
 * The store scopes every statement by `profile_id`, so a profile per test is
 * exactly as isolating as a database per test — and the database is the
 * expensive part: `openDatabase` runs all 88 migrations, and a per-test one cost
 * this file about five seconds of its six. The rows a test writes are its own
 * profile's, and the cap test's five hundred rows are its own profile's too.
 */
let dir: string;
let db: NexusDatabase;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-wiki-"));
  db = openDatabase({ path: join(dir, "wiki.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

function store(profileId = createProfile()): WikiStore {
  return new WikiStore(db.raw, profileId);
}

const place = {
  libraryId: "wikipedia-sr-mini",
  zimPath: "A/Кава.html",
  title: "Кава",
};

describe("WikiStore history", () => {
  it("records a visit and lists it newest first", () => {
    const wiki = store();
    wiki.recordVisit(place, NOW);
    wiki.recordVisit({ ...place, zimPath: "A/Čaj.html", title: "Čaj" }, LATER);

    const history = wiki.history();
    expect(history.map((row) => row.title)).toEqual(["Čaj", "Кава"]);
    expect(history[0]?.visitedAt).toBe(LATER);
    expect(history[1]?.visitedAt).toBe(NOW);
  });

  it("moves an existing row rather than adding a second one", () => {
    const wiki = store();
    wiki.recordVisit(place, NOW);
    wiki.recordVisit(place, LATER);

    const history = wiki.history();
    expect(history).toHaveLength(1);
    expect(history[0]?.visitedAt).toBe(LATER);
  });

  it("keeps the newest MAX_WIKI_HISTORY rows and drops the rest", () => {
    const wiki = store();
    // One more than the cap, so exactly the oldest row is gone. The instants
    // ascend, so „which row went" is a fact about the trim and not about the
    // clock.
    for (let index = 0; index <= MAX_WIKI_HISTORY; index += 1) {
      const at = new Date(Date.parse(NOW) + index * 1000).toISOString();
      wiki.recordVisit({ ...place, zimPath: `A/P${String(index)}.html` }, at);
    }
    const history = wiki.history();
    expect(history).toHaveLength(MAX_WIKI_HISTORY);
    expect(history.some((row) => row.zimPath === "A/P0.html")).toBe(false);
    expect(history.some((row) => row.zimPath === "A/P1.html")).toBe(true);
    expect(history[0]?.zimPath).toBe(`A/P${String(MAX_WIKI_HISTORY)}.html`);
  });

  it("clears the log without touching the marks", () => {
    const wiki = store();
    wiki.recordVisit(place, NOW);
    wiki.bookmark(place, NOW);
    wiki.clearHistory();
    expect(wiki.history()).toEqual([]);
    expect(wiki.bookmarks()).toHaveLength(1);
  });
});

describe("WikiStore bookmarks", () => {
  it("keeps a page, and moves the row rather than adding a second", () => {
    const wiki = store();
    const first = wiki.bookmark(place, NOW);
    const again = wiki.bookmark({ ...place, title: "Kafa" }, LATER);
    expect(again.id).toBe(first.id);
    expect(again.createdAt).toBe(NOW);
    expect(wiki.bookmarks()).toHaveLength(1);
    expect(wiki.bookmarks()[0]?.title).toBe("Kafa");
  });

  it("orders the marks by title in the Serbian collator's order", () => {
    const wiki = store();
    wiki.bookmark({ ...place, zimPath: "A/Šetnja.html", title: "Šetnja" }, NOW);
    wiki.bookmark({ ...place, zimPath: "A/Kafa.html", title: "Kafa" }, NOW);
    wiki.bookmark({ ...place, zimPath: "A/Čaj.html", title: "Čaj" }, NOW);
    // „Čaj" before „Kafa" before „Šetnja": plain BINARY order would put Š last
    // and K first, which is the defect this sort exists for.
    expect(wiki.bookmarks().map((row) => row.title)).toEqual(["Čaj", "Kafa", "Šetnja"]);
  });

  it("removes a mark, and refuses an id it does not hold", () => {
    const wiki = store();
    const mark = wiki.bookmark(place, NOW);
    wiki.unbookmark(mark.id);
    expect(wiki.bookmarks()).toEqual([]);
    expect(() => wiki.unbookmark(mark.id)).toThrow(WikiNotFoundError);
  });

  it("refuses a mark past the cap", () => {
    const profileId = createProfile();
    const wiki = new WikiStore(db.raw, profileId);
    // The cap itself, then one more — and the rows go in with ONE statement each
    // rather than through `bookmark`, so the test proves the CAP rather than the
    // speed of the store. The cap is the exact bound, not a smaller proxy for it:
    // a test that proved „a lot of marks is refused" would pass with the number
    // set wrongly.
    const insert = db.raw.prepare(
      `INSERT INTO wiki_bookmarks
         (id, profile_id, library_id, path, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    db.raw.transaction(() => {
      for (let index = 0; index < MAX_WIKI_BOOKMARKS; index += 1) {
        insert.run(uuidv7(), profileId, "lib", `A/P${String(index)}.html`, `P${String(index)}`, NOW, NOW);
      }
    })();
    expect(() => wiki.bookmark({ ...place, zimPath: "A/one-too-many.html" }, NOW)).toThrow(
      WikiValidationError,
    );
    // An EXISTING mark is still movable: the cap is on how many pages a profile
    // keeps, not on how often one of them is touched. (The rows above carry the
    // `lib` library id, so this is about the same page as `A/P1.html`.)
    expect(
      wiki.bookmark({ libraryId: "lib", zimPath: "A/P1.html", title: "Preimenovano" }, LATER),
    ).toBeDefined();
    expect(wiki.bookmarks().some((row) => row.title === "Preimenovano")).toBe(true);
  });
});

describe("WikiStore validation", () => {
  it("refuses a library id that is not the shape the URL scheme can name", () => {
    const wiki = store();
    for (const libraryId of ["", "Wikipedia", "wiki_sr", "-leading", "a".repeat(65)]) {
      expect(() => wiki.recordVisit({ ...place, libraryId }, NOW)).toThrow(WikiValidationError);
    }
  });

  it("refuses an empty path, an over-long path, a blank title and a wall-clock", () => {
    const wiki = store();
    expect(() => wiki.recordVisit({ ...place, zimPath: "" }, NOW)).toThrow(WikiValidationError);
    expect(() => wiki.recordVisit({ ...place, zimPath: "a".repeat(513) }, NOW)).toThrow(
      WikiValidationError,
    );
    expect(() => wiki.recordVisit({ ...place, title: "   " }, NOW)).toThrow(WikiValidationError);
    expect(() => wiki.recordVisit(place, "yesterday")).toThrow(WikiValidationError);
  });
});

describe("WikiStore archive", () => {
  it("replaces the marks and empties the history", () => {
    const wiki = store();
    wiki.bookmark(place, NOW);
    wiki.recordVisit({ ...place, zimPath: "A/old.html" }, NOW);
    wiki.replaceFromArchive(
      { bookmarks: [{ libraryId: "lib", zimPath: "A/new.html", title: "Nov" }] },
      LATER,
    );
    expect(wiki.bookmarks().map((row) => row.title)).toEqual(["Nov"]);
    expect(wiki.history()).toEqual([]);
  });

  it("treats a payload that says nothing as empty, not as unchanged", () => {
    const wiki = store();
    wiki.bookmark(place, NOW);
    wiki.replaceFromArchive(null, LATER);
    expect(wiki.bookmarks()).toEqual([]);
  });

  it("refuses the same page twice in one archive, and writes nothing", () => {
    const wiki = store();
    wiki.bookmark(place, NOW);
    expect(() =>
      wiki.replaceFromArchive(
        {
          bookmarks: [
            { libraryId: "lib", zimPath: "A/x.html", title: "X" },
            { libraryId: "lib", zimPath: "A/x.html", title: "X" },
          ],
        },
        LATER,
      ),
    ).toThrow(WikiValidationError);
    // The refusal is before the transaction opens, so the profile still holds
    // exactly what it held.
    expect(wiki.bookmarks().map((row) => row.zimPath)).toEqual([place.zimPath]);
  });
});

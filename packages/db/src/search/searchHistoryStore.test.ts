import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_SEARCH_HISTORY_ENTRIES,
  MAX_SEARCH_HISTORY_QUERY_LENGTH,
  NexusDatabase,
  SearchHistoryStore,
  SearchValidationError,
  openDatabase,
  uuidv7,
} from "../index.js";

/**
 * `SearchHistoryStore` (SRCH-009 / migration 050): the profile's remembered
 * queries. Every assertion here is about the three promises the feature makes
 * — deduped, recency-ordered, bounded — plus the two refusals that keep a
 * history honest (nothing empty, nothing another profile's).
 */

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-search-history-"));
  db = openDatabase({ path: join(dir, "search-history.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(name = "P"): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, new Date().toISOString());
  return id;
}

const CLOCK_BASE = Date.parse("2026-01-01T00:00:00.000Z");

/** `n` seconds after a fixed instant — a monotonic clock, so ordering assertions read as plain numbers. */
function at(second: number): string {
  return new Date(CLOCK_BASE + second * 1000).toISOString();
}

describe("SearchHistoryStore", () => {
  it("records a query and reads it back with the moment it was used", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    store.record("beleške sa sastanka", at(1));
    expect(store.list()).toEqual([{ query: "beleške sa sastanka", usedAt: at(1) }]);
  });

  it("keeps the query EXACTLY as typed, operators included", () => {
    // A history that dropped `#oznaka` or `rok:danas` would replay as a
    // different search than the one it claims to remember.
    const store = new SearchHistoryStore(db.raw, createProfile());
    store.record("#posao rok:danas z: ispit", at(1));
    expect(store.list()[0]?.query).toBe("#posao rok:danas z: ispit");
  });

  it("orders newest first, ties broken by the query text so the order is total", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    store.record("prva", at(1));
    store.record("druga", at(2));
    store.record("treca", at(2));
    expect(store.list().map((entry) => entry.query)).toEqual(["druga", "treca", "prva"]);
  });

  it("dedupes: re-running an old query moves it to the top instead of adding a row", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    store.record("prva", at(1));
    store.record("druga", at(2));
    store.record("prva", at(3));
    expect(store.list()).toEqual([
      { query: "prva", usedAt: at(3) },
      { query: "druga", usedAt: at(2) },
    ]);
  });

  it("trims the outer whitespace only, so „ upit “ and „upit“ are one entry", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    store.record("upit", at(1));
    store.record("  upit  ", at(2));
    expect(store.list()).toEqual([{ query: "upit", usedAt: at(2) }]);
  });

  it("leaves the INTERIOR of a query alone — spacing between tokens is part of what was typed", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    store.record("prvi   drugi", at(1));
    expect(store.list()[0]?.query).toBe("prvi   drugi");
  });

  it("refuses an empty or whitespace-only query rather than remembering nothing", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    for (const query of ["", "   ", "\t\n"]) {
      expect(() => store.record(query, at(1))).toThrow(SearchValidationError);
    }
    expect(store.list()).toEqual([]);
  });

  it("refuses a query past the length cap rather than truncating it into a different search", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    const tooLong = "b".repeat(MAX_SEARCH_HISTORY_QUERY_LENGTH + 1);
    expect(() => store.record(tooLong, at(1))).toThrow(SearchValidationError);
    expect(() => store.record("b".repeat(MAX_SEARCH_HISTORY_QUERY_LENGTH), at(1))).not.toThrow();
  });

  it("refuses a malformed timestamp", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    expect(() => store.record("upit", "juče")).toThrow(SearchValidationError);
  });

  it("keeps at most MAX_SEARCH_HISTORY_ENTRIES, evicting the oldest", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    for (let index = 0; index < MAX_SEARCH_HISTORY_ENTRIES + 5; index += 1) {
      store.record(`upit-${index}`, at(index + 1));
    }
    const entries = store.list();
    expect(entries).toHaveLength(MAX_SEARCH_HISTORY_ENTRIES);
    expect(entries[0]?.query).toBe(`upit-${MAX_SEARCH_HISTORY_ENTRIES + 4}`);
    // The five oldest are gone, and gone from the TABLE — not merely hidden by
    // the read's own limit.
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM search_history").get() as { n: number }).n,
    ).toBe(MAX_SEARCH_HISTORY_ENTRIES);
    expect(entries.some((entry) => entry.query === "upit-0")).toBe(false);
  });

  it("re-using an old query rescues it from eviction instead of counting as a new one", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    store.record("stara", at(1));
    for (let index = 0; index < MAX_SEARCH_HISTORY_ENTRIES - 1; index += 1) {
      store.record(`upit-${index}`, at(index + 2));
    }
    // At the cap and „stara" is the oldest — re-using it makes it the newest,
    // so the next record evicts `upit-0` rather than it.
    store.record("stara", at(100));
    store.record("nova", at(101));
    const queries = store.list().map((entry) => entry.query);
    expect(queries).toHaveLength(MAX_SEARCH_HISTORY_ENTRIES);
    expect(queries[0]).toBe("nova");
    expect(queries).toContain("stara");
    expect(queries).not.toContain("upit-0");
  });

  it("honours an explicit read limit without touching what is stored", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    store.record("prva", at(1));
    store.record("druga", at(2));
    store.record("treca", at(3));
    expect(store.list(2).map((entry) => entry.query)).toEqual(["treca", "druga"]);
    expect(store.list()).toHaveLength(3);
  });

  it("refuses a limit that is not a positive whole number", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      expect(() => store.list(limit)).toThrow(SearchValidationError);
    }
  });

  it("clamps a read limit to the cap — nothing beyond it exists to read", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    store.record("prva", at(1));
    expect(store.list(MAX_SEARCH_HISTORY_ENTRIES * 10)).toHaveLength(1);
  });

  it("removes one entry, leaving its neighbours standing", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    store.record("prva", at(1));
    store.record("druga", at(2));
    store.remove("prva");
    expect(store.list().map((entry) => entry.query)).toEqual(["druga"]);
  });

  it("trims the query a removal names, so a row can always be removed the way it is shown", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    store.record("prva", at(1));
    store.remove("  prva  ");
    expect(store.list()).toEqual([]);
  });

  it("treats removing something that is not there as done, not as an error", () => {
    // The renderer's list can be one keystroke stale — a removal that raced a
    // clear must not surface as a failure the user has to read.
    const store = new SearchHistoryStore(db.raw, createProfile());
    expect(() => store.remove("nikad zabeleženo")).not.toThrow();
  });

  it("refuses an empty removal rather than quietly matching nothing", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    expect(() => store.remove("   ")).toThrow(SearchValidationError);
  });

  it("clears the whole history and reports how many entries went", () => {
    const store = new SearchHistoryStore(db.raw, createProfile());
    store.record("prva", at(1));
    store.record("druga", at(2));
    expect(store.clear()).toBe(2);
    expect(store.list()).toEqual([]);
    expect(store.clear()).toBe(0);
  });

  it("scopes every statement by profile: neither profile can read, evict or clear the other's", () => {
    const profileA = createProfile("A");
    const profileB = createProfile("B");
    const storeA = new SearchHistoryStore(db.raw, profileA);
    const storeB = new SearchHistoryStore(db.raw, profileB);

    storeA.record("samo A", at(1));
    storeB.record("samo B", at(2));
    // The same text in both profiles is two independent entries.
    storeA.record("zajednički", at(3));
    storeB.record("zajednički", at(4));

    expect(storeA.list().map((entry) => entry.query)).toEqual(["zajednički", "samo A"]);
    expect(storeB.list().map((entry) => entry.query)).toEqual(["zajednički", "samo B"]);

    storeA.remove("samo B");
    expect(storeB.list().map((entry) => entry.query)).toEqual(["zajednički", "samo B"]);

    expect(storeA.clear()).toBe(2);
    expect(storeB.list().map((entry) => entry.query)).toEqual(["zajednički", "samo B"]);
  });

  it("fills one profile's history to the cap without evicting a single row of another's", () => {
    const profileA = createProfile("A");
    const profileB = createProfile("B");
    const storeA = new SearchHistoryStore(db.raw, profileA);
    const storeB = new SearchHistoryStore(db.raw, profileB);

    storeB.record("B ostaje", at(1));
    for (let index = 0; index < MAX_SEARCH_HISTORY_ENTRIES + 5; index += 1) {
      storeA.record(`upit-${index}`, at(index + 2));
    }
    expect(storeB.list()).toEqual([{ query: "B ostaje", usedAt: at(1) }]);
  });
});

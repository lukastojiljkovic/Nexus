import { describe, expect, it } from "vitest";
import {
  entryTitle,
  formatBytes,
  formatDayKey,
  formatTimeOfDay,
  joinTags,
  localDayKey,
  matchesQuery,
  splitTags,
} from "./entries.js";

/**
 * The recorder's reads of its own list: the words a row wears, the day it is
 * filed under, what it costs and whether it answers a search.
 *
 * The expected strings are the ones this machine's ICU produces, measured
 * through the SAME `renderer/intl.ts` factories the page calls — which is what
 * makes them a check on the call rather than a second definition of it. The day
 * helpers are asserted as exact calendar arithmetic, because that part is ours.
 */

/** A recording made at 22:05 in this machine's zone (UTC+2 in October). */
const MADE_AT = "2026-10-10T20:05:00.000Z";

describe("entryTitle", () => {
  it("uses the title the user gave, trimmed", () => {
    expect(entryTitle("  Šetnja  ", MADE_AT, "sr")).toBe("Šetnja");
  });

  it("draws the instant in the language being read when there is no title", () => {
    // Copy rather than data: the same recording reads differently in each
    // language, because nothing wrote a Serbian date into the row.
    expect(entryTitle("", MADE_AT, "sr")).toBe(
      new Intl.DateTimeFormat(["sr-Latn", "sr"], { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(MADE_AT),
      ),
    );
    expect(entryTitle("", MADE_AT, "en")).toBe(
      // The app's own tag list for English (`strings.ts`'s `INTL_TAGS`): `en-GB`
      // first, which is what every formatter in the renderer is built from.
      new Intl.DateTimeFormat(["en-GB", "en"], {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(MADE_AT)),
    );
    expect(entryTitle("", MADE_AT, "sr")).not.toBe(entryTitle("", MADE_AT, "en"));
  });

  it("falls back to the stored text when the instant cannot be read", () => {
    expect(entryTitle("", "nije instant", "sr")).toBe("nije instant");
  });
});

describe("formatTimeOfDay and formatDayKey", () => {
  it("reads the moment on the user's own clock, through `Intl`", () => {
    // The local clock, not UTC: `Intl` is what knows this machine's zone, and
    // the page never spells one.
    expect(formatTimeOfDay(MADE_AT, "sr")).toBe(
      new Intl.DateTimeFormat(["sr-Latn", "sr"], { hour: "2-digit", minute: "2-digit" }).format(
        new Date(MADE_AT),
      ),
    );
    expect(formatTimeOfDay("nije instant", "sr")).toBe("");
  });

  it("reads a day key in UTC, which is the frame the day was grouped in", () => {
    // 2026-10-10 is a Saturday; formatted in UTC so the heading cannot slide to
    // the day before on a machine west of Greenwich.
    expect(formatDayKey("2026-10-10", "sr")).toBe("subota, 10. oktobar");
    // Measured for the app's own tags: `en-GB` writes the day before the month
    // and joins them without a comma.
    expect(formatDayKey("2026-10-10", "en")).toBe("Saturday 10 October");
    expect(formatDayKey("nije dan", "sr")).toBe("nije dan");
  });
});

describe("localDayKey", () => {
  it("reads the day off the user's own calendar, not off UTC", () => {
    // Constructed from LOCAL fields, so the answer is the same whatever zone the
    // machine runs in — which is the property a „today" has to have.
    expect(localDayKey(new Date(2026, 9, 10, 23, 50))).toBe("2026-10-10");
    expect(localDayKey(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
    expect(localDayKey(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});

describe("formatBytes", () => {
  it("reads each magnitude in the unit a person would say, in the active locale", () => {
    // Measured on this machine's ICU: the short form of the byte unit is
    // „512 byte" in English, so bytes are read with the long form.
    expect(formatBytes(512, "sr")).toBe("512 bajtova");
    expect(formatBytes(512, "en")).toBe("512 bytes");
    // 1 500 000 bytes is 1.5 MB: one digit after the point, grouped the way the
    // locale sets it.
    expect(formatBytes(1_500_000, "sr")).toBe("1,5 MB");
    expect(formatBytes(1_500_000, "en")).toBe("1.5 MB");
    // An hour of 128 kbit/s Opus, the figure the report states.
    expect(formatBytes(57_600_000, "sr")).toBe("57,6 MB");
    // The store's own cap, 512 MiB.
    expect(formatBytes(536_870_912, "sr")).toBe("536,9 MB");
    expect(formatBytes(536_870_912, "en")).toBe("536.9 MB");
  });
});

describe("matchesQuery", () => {
  const entry = {
    title: "Šetnja pored reke",
    tags: ["glas", "napolju"],
    notes: "Vetar u mikrofonu.",
  };

  it("finds a row through diacritics either way", () => {
    // Folding both sides is what makes this true: a Serbian keyboard's „š" and
    // an ASCII „s" are the same search.
    expect(matchesQuery(entry, "setnja")).toBe(true);
    expect(matchesQuery(entry, "ŠETNJA")).toBe(true);
    expect(matchesQuery(entry, "šetnja")).toBe(true);
  });

  it("searches the tags and the note as well as the title", () => {
    expect(matchesQuery(entry, "glas")).toBe(true);
    expect(matchesQuery(entry, "napolju")).toBe(true);
    expect(matchesQuery(entry, "vetar")).toBe(true);
  });

  it("needs every term, wherever in the row it lands", () => {
    expect(matchesQuery(entry, "setnja vetar")).toBe(true);
    expect(matchesQuery(entry, "setnja kisa")).toBe(false);
    expect(matchesQuery(entry, "reke napolju")).toBe(true);
  });

  it("matches everything for an empty query, and nothing it does not carry", () => {
    expect(matchesQuery(entry, "")).toBe(true);
    expect(matchesQuery(entry, "   ")).toBe(true);
    expect(matchesQuery(entry, "kiša")).toBe(false);
  });
});

describe("splitTags / joinTags", () => {
  it("reads the field's one separator, drops empty pieces and cuts at the store's cap", () => {
    expect(splitTags("glas, napolju", 12)).toEqual(["glas", "napolju"]);
    expect(splitTags("  glas ,, napolju ,", 12)).toEqual(["glas", "napolju"]);
    expect(splitTags("", 12)).toEqual([]);
    // The cap comes from the view; the field is cut so the draft stays usable.
    expect(splitTags("a, b, c", 2)).toEqual(["a", "b"]);
  });

  it("writes a list back into the field", () => {
    expect(joinTags(["glas", "napolju"])).toBe("glas, napolju");
    expect(joinTags([])).toBe("");
  });
});

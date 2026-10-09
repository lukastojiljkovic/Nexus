import { describe, expect, it } from "vitest";
import { DEFAULT_CULTURE_TOP_ARTISTS, MAX_CULTURE_TOP_ARTISTS, summarizeCulture } from "./stats.js";
import { VISIT_KINDS } from "./kinds.js";

/**
 * The fixture is Serbian on purpose: the module exists for a Serbian user, and
 * the one rule a plain `sort` gets wrong here is the sr-Latn collation of the
 * tie-break. `Lola Novaković` and `Ljubiša Stojanović` both carry two entries,
 * and the collator puts `Lola` first because `lj` is a single letter AFTER `l`
 * in the Serbian alphabet, while a UTF-16 comparison puts `Ljubiša` first
 * because `j` (U+006A) sits below `o` (U+006F). The two orders are opposites,
 * so this fixture fails the moment the collator is dropped.
 */
const VISITS = [
  { kind: "museum" as const, venue: "Narodni muzej" },
  { kind: "museum" as const, venue: "narodni muzej" },
  { kind: "museum" as const, venue: "  Narodni muzej  " },
  { kind: "theatre" as const, venue: "Narodno pozorište" },
  { kind: "theatre" as const, venue: "narodno pozorište" },
  { kind: "concert" as const, venue: "Sava Centar" },
];

const ENTRIES = [
  { artist: "Zdravko Čolić" },
  { artist: "Zdravko Čolić" },
  { artist: "Zdravko Čolić" },
  { artist: "Lola Novaković" },
  { artist: "lola novaković" },
  { artist: "Ljubiša Stojanović" },
  { artist: "Ljubiša Stojanović" },
  { artist: "Đorđe Balašević" },
];

const TRACKS = [
  { playCount: 5, durationMs: 214_000 },
  { playCount: 0, durationMs: 180_000 },
  { playCount: 2, durationMs: 300_000 },
];

describe("summarizeCulture", () => {
  it("counts visits per kind over the whole vocabulary, zeros included", () => {
    const stats = summarizeCulture({ visits: VISITS, entries: [], tracks: [] });

    expect(stats.visits.byKind).toEqual([
      { kind: "museum", count: 3 },
      { kind: "gallery", count: 0 },
      { kind: "exhibition", count: 0 },
      { kind: "theatre", count: 2 },
      { kind: "opera", count: 0 },
      { kind: "ballet", count: 0 },
      { kind: "concert", count: 1 },
      { kind: "cinema", count: 0 },
      { kind: "festival", count: 0 },
      { kind: "other", count: 0 },
    ]);
    expect(stats.visits.byKind.map((row) => row.kind)).toEqual([...VISIT_KINDS]);
    expect(stats.visits.total).toBe(6);
    // The invariant a caller may rely on: the parts add up to the whole.
    expect(stats.visits.byKind.reduce((sum, row) => sum + row.count, 0)).toBe(stats.visits.total);
  });

  it("counts a venue once however it was spelled, and keeps the first spelling", () => {
    const stats = summarizeCulture({ visits: VISITS, entries: [], tracks: [] });

    expect(stats.visits.venues).toBe(3);
    expect(stats.visits.topVenue).toEqual({ venue: "Narodni muzej", count: 3 });
  });

  it("breaks a venue tie alphabetically, so two files of the same data agree", () => {
    const stats = summarizeCulture({
      visits: [
        { kind: "gallery", venue: "Zepter" },
        { kind: "gallery", venue: "Aeromiting" },
      ],
      entries: [],
      tracks: [],
    });

    expect(stats.visits.topVenue).toEqual({ venue: "Aeromiting", count: 1 });
  });

  it("ranks artists by entries, breaking ties with the sr-Latn collator", () => {
    const stats = summarizeCulture({ visits: [], entries: ENTRIES, tracks: [] });

    expect(stats.music.entries).toBe(8);
    expect(stats.music.topArtists).toEqual([
      { artist: "Zdravko Čolić", count: 3 },
      { artist: "Lola Novaković", count: 2 },
      { artist: "Ljubiša Stojanović", count: 2 },
      { artist: "Đorđe Balašević", count: 1 },
    ]);
  });

  it("cuts the artist table to N, and the collator decides who is in it", () => {
    const stats = summarizeCulture({ visits: [], entries: ENTRIES, tracks: [] }, { topArtists: 2 });

    expect(stats.music.topArtists).toEqual([
      { artist: "Zdravko Čolić", count: 3 },
      { artist: "Lola Novaković", count: 2 },
    ]);
  });

  it("counts a misspelled artist once, on the venue rule", () => {
    const stats = summarizeCulture({ visits: [], entries: ENTRIES, tracks: [] }, { topArtists: 1 });

    expect(stats.music.topArtists).toEqual([{ artist: "Zdravko Čolić", count: 3 }]);
  });

  it("total listening time is play counts times durations, and nothing else", () => {
    // 5 x 3:34 + 0 x 3:00 + 2 x 5:00 = 1 070 000 + 0 + 600 000.
    const stats = summarizeCulture({ visits: [], entries: [], tracks: TRACKS });

    expect(stats.music.totalListeningMs).toBe(1_670_000);
    expect(stats.music.entries).toBe(0);
  });

  it("answers an empty period with zeros and no invented winner", () => {
    const stats = summarizeCulture({ visits: [], entries: [], tracks: [] });

    expect(stats.visits.total).toBe(0);
    expect(stats.visits.venues).toBe(0);
    expect(stats.visits.topVenue).toBeNull();
    expect(stats.music.entries).toBe(0);
    expect(stats.music.topArtists).toEqual([]);
    expect(stats.music.totalListeningMs).toBe(0);
  });

  it("defaults to five artists and refuses a count outside the bench", () => {
    expect(DEFAULT_CULTURE_TOP_ARTISTS).toBe(5);
    expect(MAX_CULTURE_TOP_ARTISTS).toBe(50);
    const data = { visits: [], entries: ENTRIES, tracks: [] };
    expect(summarizeCulture(data).music.topArtists).toHaveLength(4);
    expect(
      summarizeCulture(data, { topArtists: MAX_CULTURE_TOP_ARTISTS }).music.topArtists,
    ).toHaveLength(4);
    for (const topArtists of [0, -1, 51, 2.5, NaN]) {
      expect(() => summarizeCulture(data, { topArtists })).toThrow(RangeError);
    }
  });

  it("refuses a blank artist or venue rather than counting a group with no name", () => {
    // The store never writes one (its own validators refuse a blank), so a blank
    // here is a caller bug rather than a row to fold silently into an "" bucket.
    expect(() =>
      summarizeCulture({ visits: [], entries: [{ artist: "  " }], tracks: [] }),
    ).toThrow(RangeError);
    expect(() =>
      summarizeCulture({ visits: [{ kind: "museum", venue: " " }], entries: [], tracks: [] }),
    ).toThrow(RangeError);
  });

  it("refuses a count no store could have written", () => {
    const base = { visits: [], entries: [], tracks: [] };
    expect(() =>
      summarizeCulture({ ...base, tracks: [{ playCount: -1, durationMs: 1_000 }] }),
    ).toThrow(RangeError);
    expect(() =>
      summarizeCulture({ ...base, tracks: [{ playCount: 1, durationMs: -1 }] }),
    ).toThrow(RangeError);
  });
});

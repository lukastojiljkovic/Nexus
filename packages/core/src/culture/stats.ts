import { VISIT_KINDS, isVisitKind, type VisitKind } from "./kinds.js";

/**
 * What a period of the culture corner adds up to, derived from rows the store
 * hands over — never from a query of its own. The engine is pure because the
 * period is the CALLER's: stage 2 asks the store for the visits and entries
 * between two dates and passes them here, which is what lets the same function
 * answer for a month, a year, or everything.
 *
 * **Two spellings of one name are one name, folded the same way in both
 * tables.** A venue typed as `Narodni muzej` today and `narodni muzej` next week
 * is one venue, and an artist typed with a lowercase initial is the same artist
 * — otherwise a "most visited" list is a list of typos. The fold is trim,
 * collapse inner whitespace, lowercase, and DELIBERATELY not the search fold
 * (`foldSearchText`), which strips diacritics: `šuma` and `suma` are different
 * words here, and a statistics table that merged them would be wrong about the
 * data it was given.
 *
 * **Ties are broken by `Intl.Collator(["sr-Latn", "sr"])`, never by the default
 * sort.** A tie in a "top N" is not a detail: which of two artists with the same
 * number of entries is shown is decided here, and it has to be decided the same
 * way twice. Plain `"sr"` mis-tailors the Latin š, č and ć — the house rule —
 * and the default `sort` compares UTF-16 code units, which puts `Ljubiša` before
 * `Lola` where a Serbian reader expects the opposite.
 */

/** What one visit contributes to the statistics. */
export interface CultureVisitSource {
  readonly kind: VisitKind;
  readonly venue: string;
}

/** What one listening entry contributes. */
export interface CultureEntrySource {
  readonly artist: string;
}

/**
 * What one of the user's own tracks contributes: what it was played, and how
 * long it lasts. The play count is the track's own (`recordPlay`), so time
 * listened is counted from the library rather than from the log — a log entry
 * is a memory, and a memory has no duration.
 */
export interface CultureTrackPlaySource {
  readonly playCount: number;
  readonly durationMs: number;
}

export interface CultureStatsInput {
  readonly visits: readonly CultureVisitSource[];
  readonly entries: readonly CultureEntrySource[];
  readonly tracks: readonly CultureTrackPlaySource[];
}

/** One row of "visits per kind". Every kind is present, including the ones at zero. */
export interface CultureKindCount {
  readonly kind: VisitKind;
  readonly count: number;
}

export interface CultureVenueCount {
  readonly venue: string;
  readonly count: number;
}

export interface CultureArtistCount {
  readonly artist: string;
  readonly count: number;
}

export interface CultureStats {
  readonly visits: {
    readonly total: number;
    /** Every kind in `VISIT_KINDS` order, zeros included: a kind absent from the list would be indistinguishable from a kind that does not exist. */
    readonly byKind: readonly CultureKindCount[];
    /** Distinct venues, counted after the fold above. */
    readonly venues: number;
    /** The most visited venue, or null when the period holds no visit at all. */
    readonly topVenue: CultureVenueCount | null;
  };
  readonly music: {
    readonly entries: number;
    /** The most-listened artists, at most `topArtists` of them, most entries first. */
    readonly topArtists: readonly CultureArtistCount[];
    /** Play counts times durations, over the user's OWN tracks. */
    readonly totalListeningMs: number;
  };
}

/** How many artists the table holds unless the caller says otherwise — a sidebar panel is read at a glance, not scrolled. */
export const DEFAULT_CULTURE_TOP_ARTISTS = 5;

/** The most a caller may ask for, so one call cannot build a table of the whole library to hide it behind a scrollbar. */
export const MAX_CULTURE_TOP_ARTISTS = 50;

export interface CultureStatsOptions {
  readonly topArtists?: number;
}

const CULTURE_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/**
 * The key two spellings of one name share. The DISPLAY spelling is always the
 * first one seen, so a sorted table shows the user's own words and not the
 * folded ones.
 */
function nameKey(value: string, what: string): string {
  const key = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (key.length === 0) {
    throw new RangeError(`An ${what} with no name cannot be counted.`);
  }
  return key;
}

/** One counted name, kept as a map value so a second spelling only ever adds to the count. */
interface CountedName {
  display: string;
  count: number;
}

/** Adds one spelling to a counted name — the ONE place the fold and the kept spelling meet, so no two counters can drift. */
function addCount(counts: Map<string, CountedName>, value: string, what: string): void {
  const key = nameKey(value, what);
  const entry = counts.get(key);
  if (entry === undefined) {
    counts.set(key, { display: value.trim().replace(/\s+/g, " "), count: 1 });
  } else {
    entry.count += 1;
  }
}

/**
 * The whole period in one answer: visits per kind, how many venues were
 * visited and which most often, how many entries were logged and by whom, and
 * how much of the user's own music was played.
 */
export function summarizeCulture(
  input: CultureStatsInput,
  options: CultureStatsOptions = {},
): CultureStats {
  const topArtists = options.topArtists ?? DEFAULT_CULTURE_TOP_ARTISTS;
  if (!Number.isInteger(topArtists) || topArtists < 1 || topArtists > MAX_CULTURE_TOP_ARTISTS) {
    throw new RangeError(
      `"topArtists" must be a whole number between 1 and ${MAX_CULTURE_TOP_ARTISTS}.`,
    );
  }

  const byKind = new Map<VisitKind, number>(VISIT_KINDS.map((kind) => [kind, 0]));
  const venues = new Map<string, CountedName>();
  for (const visit of input.visits) {
    // The type says `VisitKind`, but this is the statistics boundary and a cast
    // is not a promise: a kind nothing here counts would leave `total` above the
    // sum of its parts, and every reader of this answer adds the parts up.
    if (!isVisitKind(visit.kind)) {
      throw new RangeError(`A visit with kind ${JSON.stringify(visit.kind)} cannot be counted.`);
    }
    byKind.set(visit.kind, (byKind.get(visit.kind) ?? 0) + 1);
    addCount(venues, visit.venue, "venue");
  }

  const artists = new Map<string, CountedName>();
  for (const entry of input.entries) addCount(artists, entry.artist, "artist");

  let totalListeningMs = 0;
  for (const track of input.tracks) {
    if (!Number.isSafeInteger(track.playCount) || track.playCount < 0) {
      throw new RangeError("A play count must be a non-negative whole number.");
    }
    if (!Number.isSafeInteger(track.durationMs) || track.durationMs < 0) {
      throw new RangeError("A track's duration must be a non-negative whole number of milliseconds.");
    }
    totalListeningMs += track.playCount * track.durationMs;
    if (!Number.isSafeInteger(totalListeningMs)) {
      throw new RangeError("Total listening time must stay a safe integer of milliseconds.");
    }
  }

  const byPosition = (left: CountedName, right: CountedName): number =>
    right.count - left.count || CULTURE_COLLATOR.compare(left.display, right.display);
  const topVenue = [...venues.values()].sort(byPosition)[0] ?? null;

  return {
    visits: {
      total: input.visits.length,
      byKind: VISIT_KINDS.map((kind) => ({ kind, count: byKind.get(kind) ?? 0 })),
      venues: venues.size,
      topVenue: topVenue === null ? null : { venue: topVenue.display, count: topVenue.count },
    },
    music: {
      entries: input.entries.length,
      topArtists: [...artists.values()]
        .sort(byPosition)
        .slice(0, topArtists)
        .map((entry) => ({ artist: entry.display, count: entry.count })),
      totalListeningMs,
    },
  };
}

/**
 * The LIBRARY item: what it may be, what it may hold, and the two rules that
 * read one of its passes.
 *
 * **The vocabulary is closed and lives here, in one place, because three
 * parties have to agree about it.** The store refuses an unknown kind or status
 * (with a sentence naming the field), the archive reader validates a whole
 * exported value before anything is written, and stage 2's IPC layer passes
 * untrusted strings straight through — and none of them may invent a fourth
 * kind or a fifth status of its own. So the two lists, the bounds and the
 * predicates are stated here and imported by all three; the migrations repeat
 * the same vocabulary as SQL CHECKs, which are the backstop rather than the
 * message (`HabitStore`'s documented arrangement).
 *
 * **Progress is six nullable columns, not four kinds of item.** A book's pages
 * and a series' seasons and episodes are the same thing — a count, an optional
 * total, and a rule that the count cannot pass the total — so they are six
 * columns whose SHAPE depends on the kind, and `validateLibraryProgress`
 * answers the one question a field-by-field check cannot: which of the six is
 * impossible for THIS kind. A film has all six null, which is not a special
 * case in the table and is one refusal away in the store.
 *
 * **A pass is what a re-read is.** The item carries no dates: `library_passes`
 * holds one row per reading or watching, and the item's `status` and `rating`
 * are re-derived from the pass that is then LATEST on every pass write
 * (`deriveLibraryStatusFromPass` / `deriveLibraryRatingFromPass` below). That is
 * the brief's "the item's status and dates reflecting the latest pass", made
 * concrete in two pure functions rather than in three store methods that could
 * each remember a different part of it. The dates themselves are never copied
 * onto the item: a second pass would have to overwrite the first one's, and the
 * history is the point.
 */

/** The three kinds of thing this module logs. There is no fourth: a podcast or a game would be its own module with its own progress shape. */
export const LIBRARY_KINDS = ["book", "film", "series"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/**
 * Where an item stands. `planned` and `done` are the two the collection
 * progress reads, `in-progress` is what a started pass derives, and `dropped` is
 * the one a user sets by hand — the only status this module ever means as „I
 * stopped", which is why it is not derived from anything.
 */
export const LIBRARY_STATUSES = ["planned", "in-progress", "done", "dropped"] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

/** 1 to 10, whole: the ten-point scale the brief names, and no half points. */
export const LIBRARY_MIN_RATING = 1;
export const LIBRARY_MAX_RATING = 10;

/**
 * A work's year, as four digits. The bound is the SHAPE of the value a person
 * types rather than a claim about when anything was published — a film from
 * 1896 and a poem from 1200 both fit, and a negative year (a date before the
 * common era) does not, deliberately: what this module logs is the printed or
 * released edition a user can name.
 */
export const LIBRARY_MIN_YEAR = 1;
export const LIBRARY_MAX_YEAR = 9999;

/**
 * The ceiling on a count — pages, seasons, episodes. Not a statement about
 * books: an untrusted caller's number goes into an INTEGER column that a total
 * is compared against, and a bound is cheaper than discovering the absence of
 * one (`MAX_HABIT_COUNT`'s reasoning, one module over).
 */
export const LIBRARY_MAX_COUNT = 100_000;

/** A title is a label, not a body; the bound stops a ten-megabyte one from landing. It covers an original title too — that is a title. */
export const LIBRARY_MAX_TITLE_LENGTH = 300;

/** How many names a creator list may hold. Authors, directors and series creators are all „a short ordered list", and twenty is past every case a person types. */
export const LIBRARY_MAX_CREATORS = 20;
export const LIBRARY_MAX_CREATOR_LENGTH = 120;

/** How many tags one item may carry, and how long one may be. */
export const LIBRARY_MAX_TAGS = 20;
export const LIBRARY_MAX_TAG_LENGTH = 40;

/** The summary note's bound: a short note about the work, not a review. */
export const LIBRARY_MAX_SUMMARY_LENGTH = 2_000;

/** One journal entry's bound — a thought is a paragraph or two, not a document. */
export const LIBRARY_MAX_THOUGHT_LENGTH = 4_000;

/** A collection's name and description bounds — `task_lists`' own name bound, one step wider for a phrase. */
export const LIBRARY_MAX_COLLECTION_NAME_LENGTH = 120;
export const LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH = 500;

/**
 * The byte cap on one cover image. The value is `MAX_NOTE_ATTACHMENT_BYTES`',
 * copied rather than reinvented: a cover is a row in the same content-addressed
 * blob store, so a second number would only be a second answer to „how big may
 * a file be" (`MAX_TASK_ATTACHMENT_BYTES`' own comment, one module over).
 */
export const LIBRARY_MAX_COVER_BYTES = 52_428_800;

const WIKIDATA_ID = /^Q[1-9]\d{0,17}$/;

const BARE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The ISO-8601 date-time shape every `now` and every stored timestamp in this
 * module carries. Stated here rather than imported from `@nexus/db`'s
 * `money.ts`, which core cannot reach — and used by BOTH sides on purpose: the
 * store's `now` gate and the archive reader must agree about what a stored
 * timestamp is, and one predicate is the only way that is true.
 */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

export function isLibraryKind(value: unknown): value is LibraryKind {
  return (LIBRARY_KINDS as readonly unknown[]).includes(value);
}

export function isLibraryStatus(value: unknown): value is LibraryStatus {
  return (LIBRARY_STATUSES as readonly unknown[]).includes(value);
}

/** A whole rating inside 1..10 — never a float, and never a zero. */
export function isLibraryRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= LIBRARY_MIN_RATING &&
    value <= LIBRARY_MAX_RATING
  );
}

/** A whole year inside 1..9999. */
export function isLibraryYear(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= LIBRARY_MIN_YEAR &&
    value <= LIBRARY_MAX_YEAR
  );
}

/** A whole count of at least one — a page total, a season, an episode, a total. */
export function isLibraryCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= LIBRARY_MAX_COUNT
  );
}

/**
 * A whole count that may be ZERO — pages read, which is zero on the day a book
 * is opened. Deliberately not `isLibraryCount`: „no pages read yet" and „zero
 * seasons watched" are the same number on purpose, while a page TOTAL of zero
 * is a book with no pages.
 */
export function isLibraryReadPages(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= LIBRARY_MAX_COUNT
  );
}

/**
 * A bare local calendar day, `YYYY-MM-DD`, and a REAL one — `Date.parse` alone
 * rolls `2026-02-30` into March, which is exactly the corrupt-but-parseable
 * value a journal must refuse (`@nexus/db`'s `isBareDate` states the same rule;
 * this is its twin, because core cannot import it).
 */
export function isLibraryDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = BARE_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
}

/** The shape every stored timestamp and every `now` has. */
export function isLibraryTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_8601_DATETIME.test(value);
}

/**
 * A Wikidata Q-id: `Q` and a positive integer with no leading zero. Stored as
 * TEXT and never parsed as a number — a Q-id is an opaque identifier, and one
 * past 2^53 would silently lose its last digits as a double.
 */
export function isWikidataId(value: unknown): value is string {
  return typeof value === "string" && WIKIDATA_ID.test(value);
}

/**
 * A creator list from an untrusted caller, in canonical form, or null. Names
 * are trimmed, empty ones are DROPPED, and EXACT duplicates collapse — in the
 * order given, because „authors, directors and creators" is an ordered list and
 * reordering it would be inventing a credit order the user did not type.
 * Dropping rather than refusing is deliberate and applies to tags below for the
 * same reason: an empty entry is the blank form row a user left alone, not an
 * attempt to name somebody nameless — while a non-string or an over-long name
 * is a caller that built the value wrong, and that is refused. Nothing is
 * title-cased or otherwise rewritten: a name is spelled how its owner spells it.
 */
export function validateLibraryCreators(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > LIBRARY_MAX_CREATORS) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    const name = entry.trim();
    if (name.length === 0) continue;
    if (name.length > LIBRARY_MAX_CREATOR_LENGTH) return null;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * A tag list from an untrusted caller, in canonical form, or null. Tags are
 * folded case-insensitively for the duplicate test — „Teretana" and „teretana"
 * are one tag to a person, and two rows that a filter would treat as one are the
 * „two spellings of one thing" defect — and the FIRST spelling given is the one
 * kept. Order is the caller's: a tag list is a set the user arranged.
 */
export function validateLibraryTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > LIBRARY_MAX_TAGS) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    const tag = entry.trim();
    if (tag.length === 0) continue;
    if (tag.length > LIBRARY_MAX_TAG_LENGTH) return null;
    const folded = tag.toLowerCase();
    if (!out.some((each) => each.toLowerCase() === folded)) out.push(tag);
  }
  return out;
}

/**
 * The stored text of a string-list column — one JSON array, in the order given.
 * Used for `creators_json` AND `tags_json`, deliberately: the two columns hold
 * the same shape, and one text function means a creator list and a tag list
 * cannot end up spelled differently („one canonical form", `serializeHabitSchedule`'s
 * own reason).
 */
export function serializeLibraryList(values: readonly string[]): string {
  return JSON.stringify([...values]);
}

/** The six progress fields, in the order the item carries them. */
export const LIBRARY_PROGRESS_FIELDS = [
  "pagesRead",
  "pagesTotal",
  "season",
  "episode",
  "seasonsTotal",
  "episodesTotal",
] as const;

export type LibraryProgressField = (typeof LIBRARY_PROGRESS_FIELDS)[number];

export interface LibraryProgress {
  /** Pages read so far, or null. A book's. Zero is „opened it". */
  readonly pagesRead: number | null;
  /** How many pages the book has, or null when the user does not know. */
  readonly pagesTotal: number | null;
  /** The last watched season, or null. A series'. */
  readonly season: number | null;
  /** The last watched episode, or null. */
  readonly episode: number | null;
  /** How many seasons the series has, or null. */
  readonly seasonsTotal: number | null;
  /** How many episodes the series has in all, or null; an episode count can never exceed it. */
  readonly episodesTotal: number | null;
}

/**
 * Which of the six progress fields cannot be true for an item of `kind` — an
 * empty array means the progress is possible. Three questions, and each names
 * the field the CALLER can fix:
 *
 * - a kind that carries no such progress at all (a film with pages, a book with
 *   seasons) names every field that is not null;
 * - a count past its total names the COUNT rather than the total: the read
 *   count is the one that is wrong, and naming both would report one mistake
 *   twice (`validateBodyMeasurement`'s rule about a problem derived from
 *   another).
 *
 * Integrality and range are deliberately NOT here: those are the store's own
 * refusals, because it is the store that writes a sentence naming the field and
 * the range, and a second answer here could only disagree with it.
 */
export function validateLibraryProgress(
  kind: LibraryKind,
  progress: LibraryProgress,
): LibraryProgressField[] {
  const problems: LibraryProgressField[] = [];

  if (kind === "book") {
    for (const field of ["season", "episode", "seasonsTotal", "episodesTotal"] as const) {
      if (progress[field] !== null) problems.push(field);
    }
  } else {
    for (const field of ["pagesRead", "pagesTotal"] as const) {
      if (progress[field] !== null) problems.push(field);
    }
  }

  if (
    kind === "book" &&
    progress.pagesRead !== null &&
    progress.pagesTotal !== null &&
    progress.pagesRead > progress.pagesTotal
  ) {
    problems.push("pagesRead");
  }
  if (
    progress.season !== null &&
    progress.seasonsTotal !== null &&
    progress.season > progress.seasonsTotal
  ) {
    problems.push("season");
  }
  if (
    progress.episode !== null &&
    progress.episodesTotal !== null &&
    progress.episode > progress.episodesTotal
  ) {
    problems.push("episode");
  }

  return problems;
}

/** One cover image's index row — never the bytes, which live on disk in main's content-addressed blob store, keyed by `sha256` (`NoteAttachment`'s arrangement). */
export interface LibraryCover {
  /** The item this cover belongs to — the primary key, because a work has one cover. */
  readonly itemId: string;
  readonly fileName: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One reading or watching. The item's own dates do not exist — these are them. */
export interface LibraryPassOutcome {
  /** The day it was started, or null. A bare local day. */
  readonly startedOn: string | null;
  /** The day it was finished, or null. A bare local day. */
  readonly finishedOn: string | null;
  /** This pass's rating, or null. 1..10, whole. */
  readonly rating: number | null;
}

/** One pass as the store returns it. `seq` orders the passes of one item and never restarts. */
export interface LibraryPass extends LibraryPassOutcome {
  readonly id: string;
  readonly itemId: string;
  /** 1-based, ascending in the order the passes were recorded — the latest pass is the one with the greatest `seq`. */
  readonly seq: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One dated journal entry. The column is `entry_date`, not `date`: a column
 * called `date` collides with SQLite's own `DATE()` in a reader's head, which is
 * why `fin_transactions` spells `tx_date` and `fit_measurements` spells `day`.
 */
export interface LibraryThought {
  readonly id: string;
  readonly itemId: string;
  readonly entryDate: string;
  readonly text: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * What one work is. Flat, and one field per column, because this shape is also
 * what the archive carries: a nested progress object would have to be unfolded
 * on the way to SQL and refolded on the way back, for no reader's benefit.
 */
export interface LibraryItem extends LibraryProgress {
  readonly id: string;
  /** The profile that owns the row. Kept on the value because the ARCHIVE carries it (every other row of a profile archive does), while `importData` writes its own. */
  readonly profileId: string;
  readonly kind: LibraryKind;
  readonly title: string;
  /** The work's title in the language it was made in, where the user knows it and it differs from `title`. */
  readonly originalTitle: string | null;
  /** Authors, directors or creators, in the order given. */
  readonly creators: readonly string[];
  readonly year: number | null;
  readonly status: LibraryStatus;
  readonly rating: number | null;
  readonly tags: readonly string[];
  /** The short summary note, or null. Deliberately NOT the journal — that is `LibraryThought`. */
  readonly summary: string | null;
  /** The work's Wikidata Q-id, or null. This is what an adopted collection matches on first. */
  readonly wikidataId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A pass write re-derives the item's status from the pass that is then LATEST.
 *
 * - finished ⇒ `done`, whatever it said before;
 * - started but not finished ⇒ `in-progress`;
 * - a pass that records neither date says nothing about where the work is, so
 *   the status stands;
 * - NO pass at all (the last one was removed) says the same: nothing to derive.
 *
 * An explicit status write stands until the next pass write. That is the whole
 * precedence, and it is why `dropped` is not special-cased: a pass that starts
 * something the user has dropped honestly says they went back to it.
 */
export function deriveLibraryStatusFromPass(
  latest: LibraryPassOutcome | null,
  current: LibraryStatus,
): LibraryStatus {
  if (latest === null) return current;
  if (latest.finishedOn !== null) return "done";
  if (latest.startedOn !== null) return "in-progress";
  return current;
}

/**
 * The item's rating follows the latest pass's rating when that pass carries
 * one, and otherwise stands. It is NOT cleared when the pass that carried a
 * rating is removed: the store cannot tell a rating that came from a pass from
 * one the user typed on the item, and silently dropping a rating is the worse
 * of the two mistakes.
 */
export function deriveLibraryRatingFromPass(
  latest: LibraryPassOutcome | null,
  current: number | null,
): number | null {
  return latest !== null && latest.rating !== null ? latest.rating : current;
}

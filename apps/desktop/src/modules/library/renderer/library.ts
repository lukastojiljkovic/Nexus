import type { IconName } from "@nexus/ui";
import {
  LIBRARY_MAX_COUNT,
  LIBRARY_MAX_RATING,
  LIBRARY_MAX_YEAR,
  LIBRARY_MIN_RATING,
  LIBRARY_MIN_YEAR,
  LIBRARY_SORT_KEYS,
  normalizeLibraryTitle,
  sortLibraryItems,
  type LibraryKind,
  type LibrarySortKey,
  type LibraryStatus,
} from "@nexus/core";
import { dateTimeFormat, numberFormat } from "../../../renderer/src/intl.js";
import type { Locale } from "../../../renderer/src/strings.js";
import type {
  LibraryItemView,
  LibraryPassView,
  LibrarySuggestionItemView,
  LibraryUpdateItemPayload,
} from "../shared/ipc.js";

/**
 * BIBLIOTEKA's pure half: everything the page computes that is worth testing
 * without a DOM.
 *
 * **Why these are here and not inside `Page.tsx`.** A progress line, a search
 * fold, a move's two neighbours and a form's number reading are the parts of
 * this page that can be WRONG in a way nobody sees - a figure that reads
 * "320/120", a filter that drops a work whose title has no diacritics, a move
 * that puts a row in the wrong place - and this repository's renderer tests run
 * under Node with no DOM library, so they can only reach what lives outside a
 * component. The page keeps the drawing and the wiring; the arithmetic is here.
 *
 * **Every locale-dependent answer takes the locale as an argument** rather than
 * reading `activeLocale()` itself, so a test can assert Serbian and English from
 * one call site - and so nothing here is frozen at import time, which is the
 * trap `intl.ts`'s header records. The FORMATTING still goes through the app's
 * own `Intl` door, so the digits, the date order and the unit spacing are the
 * ones the interface uses everywhere else.
 */

/** The mark each kind wears in a row. A word names the kind as well (`copy.kinds`), because a glyph is not a vocabulary. */
export const KIND_ICONS: Readonly<Record<LibraryKind, IconName>> = {
  book: "book",
  film: "play",
  series: "list",
};

/** The kinds, in the order the quick-add form offers them. */
export const KIND_OPTIONS: readonly LibraryKind[] = ["book", "film", "series"];

/** The statuses, in the order they read: what you want, what you are in, what is done, what you put down. */
export const STATUS_OPTIONS: readonly LibraryStatus[] = [
  "planned",
  "in-progress",
  "done",
  "dropped",
];

/** The four orders the list can be shown in - the store's own vocabulary rather than a second one. */
export const SORT_OPTIONS: readonly LibrarySortKey[] = LIBRARY_SORT_KEYS;

/** The rating scale, from the module's own closed vocabulary: whole numbers 1..10, and a select row for each. */
export const RATING_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * The latest pass of one work, or null while it has none.
 *
 * By `seq`, not by array position: the store returns a work's passes oldest
 * first today, and the item's status and rating follow the pass with the
 * GREATEST seq, so reading the last element would be a second answer that could
 * disagree.
 */
export function latestPass(item: { readonly passes: readonly LibraryPassView[] }): LibraryPassView | null {
  let latest: LibraryPassView | null = null;
  for (const pass of item.passes) {
    if (latest === null || pass.seq > latest.seq) latest = pass;
  }
  return latest;
}

/** When the latest pass started and ended, or both null while there is no pass. */
export function latestPassDates(item: {
  readonly passes: readonly LibraryPassView[];
}): { readonly startedOn: string | null; readonly finishedOn: string | null } {
  const latest = latestPass(item);
  return { startedOn: latest?.startedOn ?? null, finishedOn: latest?.finishedOn ?? null };
}

/**
 * What one work's progress reads as, or null when it has none to show.
 *
 * - A book: pages read against the total, either half alone when only one is
 *   known, and nothing when neither is.
 * - A series: `S2 E5`, with the episode total appended when the user knows it.
 * - A film: null, always - a film has no progress columns, which is the store's
 *   own rule (`validateLibraryProgress`), so there is nothing to fall back to.
 *
 * The unit words arrive from the copy table rather than being spelled here, so
 * English reads `320 p.` where Serbian reads `320 str.`.
 */
export function formatProgress(
  item: LibraryItemView,
  locale: Locale,
  units: { readonly pages: string; readonly episodes: string },
): string | null {
  const count = (value: number): string => numberFormat({}, locale).format(value);
  if (item.kind === "film") return null;

  if (item.kind === "book") {
    if (item.pagesRead === null && item.pagesTotal === null) return null;
    if (item.pagesRead !== null && item.pagesTotal !== null) {
      return `${count(item.pagesRead)} / ${count(item.pagesTotal)} ${units.pages}`;
    }
    const only = item.pagesRead ?? item.pagesTotal;
    return only === null ? null : `${count(only)} ${units.pages}`;
  }

  if (item.season === null && item.episode === null) return null;
  const marks = [
    item.season === null ? null : `S${count(item.season)}`,
    item.episode === null ? null : `E${count(item.episode)}`,
  ].filter((mark): mark is string => mark !== null);
  const where = marks.join(" ");
  return item.episodesTotal === null
    ? where
    : `${where} / ${count(item.episodesTotal)} ${units.episodes}`;
}

/** One work's rating as `8/10`, or null while it has none. Ten is the module's own ceiling, so it is not a second number. */
export function formatRating(rating: number | null, locale: Locale): string | null {
  return rating === null ? null : `${numberFormat({}, locale).format(rating)}/10`;
}

/** A bare day as the locale writes it - `12. mar 2026.` / `12 Mar 2026` - or the raw string when it is not a day. */
export function formatDay(day: string | null, locale: Locale): string | null {
  if (day === null) return null;
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return dateTimeFormat(
    { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" },
    locale,
  ).format(date);
}

/** Today as a bare local day, which is what the store's day columns hold. Built from the local clock, not `toISOString`, so a user east of UTC late in the evening files a thought under the day they are living. */
export function localDayKey(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * A comma-separated field as a list of names: trimmed, with the blank entries
 * dropped.
 *
 * A semicolon separates too, because a creator list and a tag list are both
 * things a person types by hand and the two marks are used interchangeably for
 * the same job. Nothing is title-cased: a creator's name is spelled how its
 * owner spells it (the store's own rule).
 */
export function parseListField(text: string): string[] {
  return text
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** The same list back into the field, so editing shows what is stored. */
export function formatListField(values: readonly string[]): string {
  return values.join(", ");
}

/** An empty field means "clear this", which the wire's nullable fields spell as null. */
export function blankToNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * A number field's reading: empty is "not recorded", a whole number inside the
 * range is the value, and everything else is refused.
 *
 * The three answers are kept apart deliberately. `null` would mean both "cleared"
 * and "typed wrong", and a form that sent the second as the first would clear a
 * page count because somebody typed `abc` into it. The store's own range is what
 * the bounds are, so a value this accepts is one it takes.
 */
export function readCount(
  text: string,
  min: number,
  max: number,
): { readonly ok: true; readonly value: number | null } | { readonly ok: false } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= min && value <= max
    ? { ok: true, value }
    : { ok: false };
}

/** What the list is showing: a search text, a kind (or all of them), a status (or all of them). */
export interface LibraryFilter {
  readonly query: string;
  readonly kind: LibraryKind | "all";
  readonly status: LibraryStatus | "all";
}

export const NO_FILTER: LibraryFilter = { query: "", kind: "all", status: "all" };

/**
 * Whether one work answers the filter.
 *
 * The search text is folded with `normalizeLibraryTitle` - the store's OWN fold,
 * the one that decides whether a curated entry and a hand-logged work are the
 * same title - so `cica gorio` finds `Čića Gorio`, `the great gatsby` finds
 * `Great Gatsby`, and the page's search cannot disagree with the adoption about
 * what two titles being "the same" means. A query that folds to nothing (only
 * punctuation) is not a filter: it would otherwise match nothing at all.
 */
export function matchesFilter(item: LibraryItemView, filter: LibraryFilter): boolean {
  if (filter.kind !== "all" && item.kind !== filter.kind) return false;
  if (filter.status !== "all" && item.status !== filter.status) return false;

  const needle = normalizeLibraryTitle(filter.query);
  if (needle.length === 0) return true;
  const haystack = [
    item.title,
    item.originalTitle ?? "",
    ...item.creators,
    ...item.tags,
  ]
    .map((part) => normalizeLibraryTitle(part))
    .join(" ");
  return haystack.includes(needle);
}

/** The list as the page draws it: filtered, then ordered by the store's own comparator. */
export function visibleItems(
  items: readonly LibraryItemView[],
  filter: LibraryFilter,
  sort: LibrarySortKey,
): LibraryItemView[] {
  return sortLibraryItems(
    items.filter((item) => matchesFilter(item, filter)),
    sort,
  );
}

/**
 * The two neighbours a move happens between, or null when the row is already at
 * that end of the collection.
 *
 * `delta` is -1 for up and +1 for down. The pair is what
 * `LibraryStore.moveCollectionItem` takes - `beforeId` and `afterId`, either of
 * which is null at an end - and it is computed from the ORDER the user is
 * looking at rather than from any stored rank, because the ranks are fractional
 * and private to the store.
 */
export function moveNeighbours(
  itemIds: readonly string[],
  itemId: string,
  delta: -1 | 1,
): { readonly beforeId: string | null; readonly afterId: string | null } | null {
  const index = itemIds.indexOf(itemId);
  if (index < 0) return null;
  const to = index + delta;
  if (to < 0 || to >= itemIds.length) return null;
  return delta < 0
    ? { beforeId: itemIds[to - 1] ?? null, afterId: itemIds[to] ?? null }
    : { beforeId: itemIds[to] ?? null, afterId: itemIds[to + 1] ?? null };
}

/** One suggested work's title in the language being read, falling back to the other half. Never a Wikidata id, and never an empty line where a title exists in the other language. */
export function suggestionTitle(
  title: LibrarySuggestionItemView["title"],
  locale: Locale,
): string {
  return (locale === "sr" ? title.sr : title.en) ?? title.sr ?? title.en ?? "";
}

/** The suggestion's own title pair, on the same rule - the layout requires both, so this is the fallback for a malformed one. */
export function suggestionCollectionTitle(
  title: { readonly sr: string; readonly en: string },
  locale: Locale,
): string {
  return (locale === "sr" ? title.sr : title.en) || title.sr || title.en;
}

/** A suggestion row's one-line meta: its year when it has one, then its creators. */
export function suggestionItemMeta(
  item: LibrarySuggestionItemView,
  locale: Locale,
  yearUnknown: string,
): string {
  const year = item.year === null ? yearUnknown : numberFormat({ useGrouping: false }, locale).format(item.year);
  return [year, ...item.creators].join(" · ");
}

/**
 * The item edit form's whole state, as text - which is what an `<input>` holds.
 *
 * Every nullable field is a string here and empties to `null` on the way out, so
 * the form has one shape for a book, a film and a series: the store refuses a
 * progress field a kind cannot carry, and a form that hid those fields would
 * still have to send something for them.
 */
export interface LibraryItemDraft {
  readonly title: string;
  readonly originalTitle: string;
  readonly creators: string;
  readonly year: string;
  readonly status: LibraryStatus;
  readonly rating: string;
  readonly pagesRead: string;
  readonly pagesTotal: string;
  readonly season: string;
  readonly episode: string;
  readonly seasonsTotal: string;
  readonly episodesTotal: string;
  readonly tags: string;
  readonly summary: string;
}

/** Everything `updateItem` takes beyond the profile and the row - what the form is responsible for. */
export type LibraryItemFields = Omit<LibraryUpdateItemPayload, "profileId" | "id">;

/** The form's opening state for one work: every stored value spelled as the field shows it. */
export function itemDraftOf(item: LibraryItemView): LibraryItemDraft {
  const number = (value: number | null): string => (value === null ? "" : String(value));
  return {
    title: item.title,
    originalTitle: item.originalTitle ?? "",
    creators: formatListField(item.creators),
    year: number(item.year),
    status: item.status,
    rating: number(item.rating),
    pagesRead: number(item.pagesRead),
    pagesTotal: number(item.pagesTotal),
    season: number(item.season),
    episode: number(item.episode),
    seasonsTotal: number(item.seasonsTotal),
    episodesTotal: number(item.episodesTotal),
    tags: formatListField(item.tags),
    summary: item.summary ?? "",
  };
}

/**
 * The draft as the wire's payload fields, or a refusal.
 *
 * A refusal rather than a best-effort reading, and one refusal for the whole
 * form: a page that sent the numbers it could read and dropped the ones it could
 * not would clear a page count because somebody typed a word into it. The bounds
 * are the store's own constants, so a draft this accepts is one it takes.
 */
export function readItemDraft(
  draft: LibraryItemDraft,
): { readonly ok: true; readonly fields: LibraryItemFields } | { readonly ok: false } {
  const title = blankToNull(draft.title);
  if (title === null) return { ok: false };

  /** One number field's three answers, folded into "invalid" / "cleared" / a value. */
  const value = (reading: ReturnType<typeof readCount>): number | null | undefined =>
    reading.ok ? reading.value : undefined;

  const year = value(readCount(draft.year, LIBRARY_MIN_YEAR, LIBRARY_MAX_YEAR));
  const rating = value(readCount(draft.rating, LIBRARY_MIN_RATING, LIBRARY_MAX_RATING));
  const pagesRead = value(readCount(draft.pagesRead, 0, LIBRARY_MAX_COUNT));
  const pagesTotal = value(readCount(draft.pagesTotal, 1, LIBRARY_MAX_COUNT));
  const season = value(readCount(draft.season, 1, LIBRARY_MAX_COUNT));
  const episode = value(readCount(draft.episode, 1, LIBRARY_MAX_COUNT));
  const seasonsTotal = value(readCount(draft.seasonsTotal, 1, LIBRARY_MAX_COUNT));
  const episodesTotal = value(readCount(draft.episodesTotal, 1, LIBRARY_MAX_COUNT));
  if (
    year === undefined ||
    rating === undefined ||
    pagesRead === undefined ||
    pagesTotal === undefined ||
    season === undefined ||
    episode === undefined ||
    seasonsTotal === undefined ||
    episodesTotal === undefined
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    fields: {
      title,
      originalTitle: blankToNull(draft.originalTitle),
      creators: parseListField(draft.creators),
      tags: parseListField(draft.tags),
      summary: blankToNull(draft.summary),
      status: draft.status,
      year,
      rating,
      pagesRead,
      pagesTotal,
      season,
      episode,
      seasonsTotal,
      episodesTotal,
    },
  };
}

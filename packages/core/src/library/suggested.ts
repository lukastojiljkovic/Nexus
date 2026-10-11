/**
 * The shape of a bundled, curated list — and the reason it is declared now,
 * before any list exists.
 *
 * The maintainer's plan is a set of small curated collections (from Wikidata,
 * CC0) that a person can adopt in one tap: the list's three works land in their
 * library, already in a collection, without them typing a title. That plan is
 * only safe if the FORMAT is fixed first: a list is data that ships with the
 * app, and a second version of it would have to be understood by an older
 * build that has never heard of it. So version 1 is written down here, with a
 * validator strict enough to refuse a list that was hand-edited into an
 * inconsistency, and `LibraryStore.adoptSuggestedCollection` is the only
 * consumer.
 *
 * **Both languages, on every title.** Serbian is the default locale, so an item
 * created from a list is created in Serbian — which means the English title has
 * to be here too, or the list's author would have to pick one language for
 * every work and the store could never show the other. The outer title is a pair
 * for the same reason (`{ sr, en }`, the brief's own shape); a list whose titles
 * were single strings could not be adopted by a user in either locale without
 * losing something.
 *
 * **`wikidataId` is OPTIONAL, and the fallback is the point.** It is what the
 * adoption matches on FIRST, so a second adoption of the same list — or a user
 * who already logged one of the works by hand — resolves to the item they
 * already have instead of a duplicate. An entry that carries none is matched by
 * normalised title + year + kind instead (`LibraryStore`'s `MatchIndex`), which
 * is the second step of the brief's own matching order rather than a hole in
 * it: the format serves curated lists whose source does not name every work,
 * and refusing such an entry would withhold a list rather than duplicate a work.
 * An id that IS present is still refused unless it is a Wikidata Q-id, because
 * the column it lands in is.
 *
 * **Nothing here is a real list.** The format is validated by its tests against
 * a three-item fixture written by hand; no curated data ships in this module,
 * and none should until the lists themselves are sourced and licensed.
 */

import { MAX_ID_LENGTH } from "../ids.js";
import {
  LIBRARY_MAX_COLLECTION_NAME_LENGTH,
  LIBRARY_MAX_TITLE_LENGTH,
  isLibraryKind,
  isLibraryYear,
  isWikidataId,
  validateLibraryCreators,
} from "./item.js";
import type { LibraryKind } from "./item.js";

/**
 * How many entries one bundled list may carry. A curated list is a page of the
 * catalogue rather than the whole of it — „Nobel laureates", „films of 1972" —
 * and the cap is what keeps an adoption a single transaction over a bounded
 * amount of work rather than a surprise that allocates for a minute.
 */
export const LIBRARY_MAX_SUGGESTION_ITEMS = 5_000;

/** A title in the app's two languages. Both are required; see the file header. */
export interface SuggestedTitle {
  readonly sr: string;
  readonly en: string;
}

export interface SuggestedCollectionItemV1 {
  /** The work's Wikidata Q-id, where the list's source has one. Absent means "match by title and year". */
  readonly wikidataId?: string;
  readonly kind: LibraryKind;
  readonly title: SuggestedTitle;
  /** The work's year, where the list's source knows it. */
  readonly year?: number;
  /** Authors / directors / creators, in the order the list gives them. */
  readonly creators?: readonly string[];
}

export interface SuggestedCollectionV1 {
  /** Stable id of the LIST, not of any work in it — this is what makes a second adoption of the same list a no-op. */
  readonly id: string;
  readonly title: SuggestedTitle;
  /** Where the list came from, in prose: „Wikidata", or the query it was built from. */
  readonly source: string;
  /** The licence the list ships under: „CC0 1.0". Not for the app's own copy — for whoever reads the bundle. */
  readonly licence: string;
  readonly items: readonly SuggestedCollectionItemV1[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every required key present, every optional key allowed, and NOTHING else — an unknown key means the value was not produced by this format. */
function hasKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const own = Object.keys(value);
  const allowed = [...required, ...optional];
  return (
    required.every((key) => own.includes(key)) && own.every((key) => allowed.includes(key))
  );
}

/**
 * A trimmed, bounded string — the shape every piece of copy in this format has.
 * Refuses a value that is not already trimmed rather than trimming it: the
 * validator answers „is this a value this format produced" (`hasKeys`' rule),
 * and rewriting one would hide a bundle that was edited by hand.
 */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > max || value !== value.trim()) return null;
  return value;
}

function titleOf(value: unknown): SuggestedTitle | null {
  if (!isRecord(value) || !hasKeys(value, ["sr", "en"])) return null;
  const sr = text(value["sr"], LIBRARY_MAX_TITLE_LENGTH);
  const en = text(value["en"], LIBRARY_MAX_TITLE_LENGTH);
  if (sr === null || en === null) return null;
  return { sr, en };
}

function suggestionItemOf(value: unknown): SuggestedCollectionItemV1 | null {
  if (!isRecord(value) || !hasKeys(value, ["kind", "title"], ["wikidataId", "year", "creators"])) {
    return null;
  }
  const kind = value["kind"];
  const title = titleOf(value["title"]);
  if (!isLibraryKind(kind) || title === null) {
    return null;
  }
  const rawWikidataId = value["wikidataId"];
  const wikidataId = rawWikidataId === undefined ? undefined : text(rawWikidataId, MAX_ID_LENGTH);
  // A Wikidata id that IS given has its GRAMMAR required here, not merely being
  // a string: it is written into `library_items.wikidata_id`, whose CHECK and
  // whose matching rule are both Wikidata-shaped, so a list carrying a catalogue
  // slug would be a list the store could not adopt. See `isWikidataId` and
  // migration 072. An id that is absent is not a refusal — see the file header.
  if (wikidataId !== undefined && !isWikidataId(wikidataId)) return null;

  const out: {
    wikidataId?: string;
    kind: LibraryKind;
    title: SuggestedTitle;
    year?: number;
    creators?: string[];
  } =
    wikidataId === undefined
      ? // The key order is the format's own, so a value this function answers
        // serialises back to the shape a reader of the format expects.
        { kind, title }
      : { wikidataId, kind, title };

  const year = value["year"];
  if (year !== undefined) {
    if (!isLibraryYear(year)) return null;
    out.year = year;
  }
  const creators = value["creators"];
  if (creators !== undefined) {
    const canonical = validateLibraryCreators(creators);
    if (canonical === null) return null;
    out.creators = canonical;
  }
  return out;
}

/**
 * An untrusted value as a suggested collection, in canonical form, or null.
 * Strict on purpose (`hasKeys`' rule): a bundle is versioned by this format, so
 * a key this build does not know is a bundle from a newer build or a hand edit,
 * and adopting half of it silently would be worse than refusing it.
 */
export function validateSuggestedCollection(value: unknown): SuggestedCollectionV1 | null {
  if (!isRecord(value) || !hasKeys(value, ["id", "title", "source", "licence", "items"])) {
    return null;
  }
  const id = text(value["id"], MAX_ID_LENGTH);
  const title = titleOf(value["title"]);
  const source = text(value["source"], LIBRARY_MAX_COLLECTION_NAME_LENGTH);
  const licence = text(value["licence"], LIBRARY_MAX_COLLECTION_NAME_LENGTH);
  if (id === null || title === null || source === null || licence === null) return null;

  const raw = value["items"];
  // One entry at least: an empty list would adopt into an empty collection,
  // which is a row nobody can do anything with.
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LIBRARY_MAX_SUGGESTION_ITEMS) {
    return null;
  }
  const items: SuggestedCollectionItemV1[] = [];
  for (const entry of raw) {
    const item = suggestionItemOf(entry);
    if (item === null) return null;
    items.push(item);
  }
  return { id, title, source, licence, items };
}

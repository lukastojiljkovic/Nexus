/**
 * The library's versioned interchange value — what `LibraryStore.exportData`
 * returns and `LibraryStore.importData` accepts.
 *
 * **Why a version, and why the version is checked first.** Stage 2 folds this
 * value into the profile archive, which means it will be read by a build that
 * is not the one that wrote it. A `{ version: 1 }` at the top is the whole
 * contract: a reader that meets a version it does not know MUST refuse the
 * value rather than importing the part of it that happens to be shaped as
 * expected, because the fields it cannot see are exactly the ones that changed.
 *
 * **Live content only — the archive's own rule.** A soft-deleted item is not in
 * this value, its passes and thoughts are not either, and a deleted collection
 * takes its links with it. That is what every other module's archive does: the
 * file carries what the profile HOLDS, while „undo that delete" is the UI's own
 * affordance, and a trash bin that travelled in a backup would resurrect
 * everything a person had thrown away (`ProfileData`'s readers filter
 * `deleted_at IS NULL` for the same reason).
 *
 * **The validator accepts exactly what the writer produces, and nothing that
 * merely looks close.** Text is trimmed, lists are canonical, ids are bounded,
 * timestamps are ISO-8601 date-times, progress is possible for its kind, and
 * every reference names a row that is in the SAME value. A value that fails any
 * of that is refused WHOLE — `importData` writes nothing at all unless every
 * row passed, because a partially-imported archive is a library nobody can
 * explain, and rewriting a near-miss into a canonical form would make the
 * round trip a lie.
 *
 * **The three patterns restated here are restated deliberately.** The file-name,
 * MIME and SHA-256 rules are `NoteAttachmentStore`'s; core cannot import them
 * (`@nexus/db` is the SQLite layer and depends on core, never the reverse), and
 * the two sides must agree — an archive that carried a cover the live write path
 * refuses would be a profile that cannot be restored. They are the small,
 * closed patterns a cover row has, and they say so in one comment each.
 */

import { MAX_ID_LENGTH } from "../ids.js";
import { isRank } from "../order/rank.js";
import {
  LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH,
  LIBRARY_MAX_COLLECTION_NAME_LENGTH,
  LIBRARY_MAX_COVER_BYTES,
  LIBRARY_MAX_SUMMARY_LENGTH,
  LIBRARY_MAX_THOUGHT_LENGTH,
  LIBRARY_MAX_TITLE_LENGTH,
  isLibraryCount,
  isLibraryDay,
  isLibraryKind,
  isLibraryRating,
  isLibraryReadPages,
  isLibraryStatus,
  isLibraryTimestamp,
  isLibraryYear,
  isWikidataId,
  validateLibraryCreators,
  validateLibraryProgress,
  validateLibraryTags,
} from "./item.js";
import type {
  LibraryCover,
  LibraryItem,
  LibraryPass,
  LibraryProgress,
  LibraryThought,
} from "./item.js";
import type { LibraryCollection, LibraryCollectionItem } from "./collections.js";

/** The only version this build writes, and the only one it reads. */
export const LIBRARY_EXPORT_VERSION = 1;

/**
 * The ceiling on the rows one value may carry, across all six tables. Not a
 * statement about libraries: the value arrives from a FILE, is validated before
 * anything is written, and a validator that walks an unbounded array is a way to
 * make the app allocate without limit (`LIBRARY_MAX_COUNT`'s reasoning, applied
 * to the archive).
 */
export const LIBRARY_MAX_IMPORT_ROWS = 100_000;

/** Everything a profile's library holds, as plain JSON. */
export interface LibraryExportV1 {
  readonly version: 1;
  readonly items: readonly LibraryItem[];
  readonly covers: readonly LibraryCover[];
  readonly passes: readonly LibraryPass[];
  readonly thoughts: readonly LibraryThought[];
  readonly collections: readonly LibraryCollection[];
  readonly collectionItems: readonly LibraryCollectionItem[];
}

const VERSION_KEYS = [
  "version",
  "items",
  "covers",
  "passes",
  "thoughts",
  "collections",
  "collectionItems",
] as const;

const ITEM_KEYS = [
  "id",
  "profileId",
  "kind",
  "title",
  "originalTitle",
  "creators",
  "year",
  "status",
  "rating",
  "pagesRead",
  "pagesTotal",
  "season",
  "episode",
  "seasonsTotal",
  "episodesTotal",
  "tags",
  "summary",
  "wikidataId",
  "createdAt",
  "updatedAt",
] as const;

const COVER_KEYS = [
  "itemId",
  "fileName",
  "mime",
  "sizeBytes",
  "sha256",
  "createdAt",
  "updatedAt",
] as const;

const PASS_KEYS = [
  "id",
  "itemId",
  "seq",
  "startedOn",
  "finishedOn",
  "rating",
  "createdAt",
  "updatedAt",
] as const;

const THOUGHT_KEYS = ["id", "itemId", "entryDate", "text", "createdAt", "updatedAt"] as const;

const COLLECTION_KEYS = [
  "id",
  "profileId",
  "name",
  "description",
  "suggestedId",
  "createdAt",
  "updatedAt",
] as const;

const COLLECTION_ITEM_KEYS = [
  "id",
  "collectionId",
  "itemId",
  "rank",
  "createdAt",
  "updatedAt",
] as const;

/** The SHA-256 hex form, `NoteAttachmentStore`'s own (sixty-four lower-case digits). */
const SHA256 = /^[0-9a-f]{64}$/;

/** Lower-case `type/subtype`, the shape every attachment row's MIME has. */
const MIME = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

/**
 * The answer a nullable field gives when it is neither null nor valid. A unique
 * symbol, so `=== BAD` narrows the union and the compiler carries the proof that
 * a field was checked — a sentinel of `undefined` could not, because `undefined`
 * is a value a caller may legitimately want to tell apart from a refusal.
 */
const BAD = Symbol("library-export-invalid");
type Bad = typeof BAD;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exactly these own keys, no more and no fewer — the format is versioned, so an unknown key is a value this build did not write. */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function nullable<T>(
  value: unknown,
  is: (candidate: unknown) => candidate is T,
): T | null | Bad {
  if (value === null) return null;
  return is(value) ? value : BAD;
}

/** A bounded, already-trimmed id — the reader's own rule (`MAX_ID_LENGTH`), restated for a value that comes from a file. */
function idOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_ID_LENGTH || value !== value.trim()) {
    return null;
  }
  return value;
}

/** Non-empty, bounded, already-trimmed text. */
function textOf(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > max || value !== value.trim()) return null;
  return value;
}

/** A nullable text field: null, valid text, or `BAD`. */
function nullableText(value: unknown, max: number): string | null | Bad {
  return nullable(value, (candidate): candidate is string => textOf(candidate, max) !== null);
}

/**
 * A canonical-list column, refused unless the value ALREADY IS the canonical
 * form — same entries, same order. The list validators canonicalise (they trim,
 * drop the blank row, collapse a duplicate), and that is right on the LIVE path
 * where the caller is a form; here it is not, because a value that merely looks
 * close did not come out of `exportData`, and quietly rewriting it would make
 * the round trip a lie.
 */
function exactlyCanonical(canonical: string[] | null, raw: unknown): string[] | null {
  if (canonical === null) return null;
  const list = raw as readonly unknown[];
  const same =
    list.length === canonical.length && list.every((entry, index) => entry === canonical[index]);
  return same ? canonical : null;
}

/** The item's six progress fields and its five other nullable ones, or null when any of them is malformed. */
function itemOptionals(value: Record<string, unknown>): {
  originalTitle: string | null;
  year: number | null;
  rating: number | null;
  summary: string | null;
  wikidataId: string | null;
  progress: LibraryProgress;
} | null {
  const originalTitle = nullableText(value["originalTitle"], LIBRARY_MAX_TITLE_LENGTH);
  const year = nullable(value["year"], isLibraryYear);
  const rating = nullable(value["rating"], isLibraryRating);
  const summary = nullableText(value["summary"], LIBRARY_MAX_SUMMARY_LENGTH);
  const wikidataId = nullable(value["wikidataId"], isWikidataId);
  const pagesRead = nullable(value["pagesRead"], isLibraryReadPages);
  const pagesTotal = nullable(value["pagesTotal"], isLibraryCount);
  const season = nullable(value["season"], isLibraryCount);
  const episode = nullable(value["episode"], isLibraryCount);
  const seasonsTotal = nullable(value["seasonsTotal"], isLibraryCount);
  const episodesTotal = nullable(value["episodesTotal"], isLibraryCount);
  if (
    originalTitle === BAD ||
    year === BAD ||
    rating === BAD ||
    summary === BAD ||
    wikidataId === BAD ||
    pagesRead === BAD ||
    pagesTotal === BAD ||
    season === BAD ||
    episode === BAD ||
    seasonsTotal === BAD ||
    episodesTotal === BAD
  ) {
    return null;
  }
  return {
    originalTitle,
    year,
    rating,
    summary,
    wikidataId,
    progress: { pagesRead, pagesTotal, season, episode, seasonsTotal, episodesTotal },
  };
}

function itemOf(value: unknown): LibraryItem | null {
  if (!isRecord(value) || !hasExactKeys(value, ITEM_KEYS)) return null;

  const id = idOf(value["id"]);
  const profileId = idOf(value["profileId"]);
  const kind = value["kind"];
  const title = textOf(value["title"], LIBRARY_MAX_TITLE_LENGTH);
  const creators = exactlyCanonical(validateLibraryCreators(value["creators"]), value["creators"]);
  const status = value["status"];
  const tags = exactlyCanonical(validateLibraryTags(value["tags"]), value["tags"]);
  const createdAt = value["createdAt"];
  const updatedAt = value["updatedAt"];

  if (
    id === null ||
    profileId === null ||
    !isLibraryKind(kind) ||
    title === null ||
    creators === null ||
    !isLibraryStatus(status) ||
    tags === null ||
    !isLibraryTimestamp(createdAt) ||
    !isLibraryTimestamp(updatedAt)
  ) {
    return null;
  }

  const optionals = itemOptionals(value);
  if (optionals === null) return null;
  if (validateLibraryProgress(kind, optionals.progress).length > 0) return null;

  return {
    id,
    profileId,
    kind,
    title,
    originalTitle: optionals.originalTitle,
    creators,
    year: optionals.year,
    status,
    rating: optionals.rating,
    ...optionals.progress,
    tags,
    summary: optionals.summary,
    wikidataId: optionals.wikidataId,
    createdAt,
    updatedAt,
  };
}

function coverOf(value: unknown): LibraryCover | null {
  if (!isRecord(value) || !hasExactKeys(value, COVER_KEYS)) return null;
  const itemId = idOf(value["itemId"]);
  const fileName = textOf(value["fileName"], 255);
  const mime = value["mime"];
  const sizeBytes = value["sizeBytes"];
  const sha256 = value["sha256"];
  const createdAt = value["createdAt"];
  const updatedAt = value["updatedAt"];
  if (
    itemId === null ||
    fileName === null ||
    typeof mime !== "string" ||
    mime.length > 100 ||
    !MIME.test(mime) ||
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > LIBRARY_MAX_COVER_BYTES ||
    typeof sha256 !== "string" ||
    !SHA256.test(sha256) ||
    !isLibraryTimestamp(createdAt) ||
    !isLibraryTimestamp(updatedAt)
  ) {
    return null;
  }
  return { itemId, fileName, mime, sizeBytes, sha256, createdAt, updatedAt };
}

function passOf(value: unknown): LibraryPass | null {
  if (!isRecord(value) || !hasExactKeys(value, PASS_KEYS)) return null;
  const id = idOf(value["id"]);
  const itemId = idOf(value["itemId"]);
  const seq = value["seq"];
  const startedOn = nullable(value["startedOn"], isLibraryDay);
  const finishedOn = nullable(value["finishedOn"], isLibraryDay);
  const rating = nullable(value["rating"], isLibraryRating);
  const createdAt = value["createdAt"];
  const updatedAt = value["updatedAt"];
  if (
    id === null ||
    itemId === null ||
    !isLibraryCount(seq) ||
    !isLibraryTimestamp(createdAt) ||
    !isLibraryTimestamp(updatedAt) ||
    startedOn === BAD ||
    finishedOn === BAD ||
    rating === BAD
  ) {
    return null;
  }
  // The one cross-field rule a pass has, and the database's own CHECK as well.
  if (startedOn !== null && finishedOn !== null && startedOn > finishedOn) return null;
  return { id, itemId, seq, startedOn, finishedOn, rating, createdAt, updatedAt };
}

function thoughtOf(value: unknown): LibraryThought | null {
  if (!isRecord(value) || !hasExactKeys(value, THOUGHT_KEYS)) return null;
  const id = idOf(value["id"]);
  const itemId = idOf(value["itemId"]);
  const entryDate = value["entryDate"];
  const text = textOf(value["text"], LIBRARY_MAX_THOUGHT_LENGTH);
  const createdAt = value["createdAt"];
  const updatedAt = value["updatedAt"];
  if (
    id === null ||
    itemId === null ||
    !isLibraryDay(entryDate) ||
    text === null ||
    !isLibraryTimestamp(createdAt) ||
    !isLibraryTimestamp(updatedAt)
  ) {
    return null;
  }
  return { id, itemId, entryDate, text, createdAt, updatedAt };
}

function collectionOf(value: unknown): LibraryCollection | null {
  if (!isRecord(value) || !hasExactKeys(value, COLLECTION_KEYS)) return null;
  const id = idOf(value["id"]);
  const profileId = idOf(value["profileId"]);
  const name = textOf(value["name"], LIBRARY_MAX_COLLECTION_NAME_LENGTH);
  const description = nullableText(value["description"], LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH);
  const suggestedId = nullable(value["suggestedId"], (candidate): candidate is string => idOf(candidate) !== null);
  const createdAt = value["createdAt"];
  const updatedAt = value["updatedAt"];
  if (
    id === null ||
    profileId === null ||
    name === null ||
    !isLibraryTimestamp(createdAt) ||
    !isLibraryTimestamp(updatedAt) ||
    description === BAD ||
    suggestedId === BAD
  ) {
    return null;
  }
  return { id, profileId, name, description, suggestedId, createdAt, updatedAt };
}

function collectionItemOf(value: unknown): LibraryCollectionItem | null {
  if (!isRecord(value) || !hasExactKeys(value, COLLECTION_ITEM_KEYS)) return null;
  const id = idOf(value["id"]);
  const collectionId = idOf(value["collectionId"]);
  const itemId = idOf(value["itemId"]);
  const rank = value["rank"];
  const createdAt = value["createdAt"];
  const updatedAt = value["updatedAt"];
  if (
    id === null ||
    collectionId === null ||
    itemId === null ||
    !isRank(rank) ||
    !isLibraryTimestamp(createdAt) ||
    !isLibraryTimestamp(updatedAt)
  ) {
    return null;
  }
  return { id, collectionId, itemId, rank, createdAt, updatedAt };
}

/**
 * The `version` an untrusted value declares, or null when it declares none —
 * read BEFORE the whole value is validated, so a refusal can name the version it
 * was handed instead of reporting „not valid" to somebody who opened a file from
 * a newer build.
 */
export function libraryExportVersion(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const version = value["version"];
  return typeof version === "number" && Number.isInteger(version) ? version : null;
}

/**
 * The whole value: imported, or null. Every rule `LibraryStore.importData`
 * depends on is answered here — row shapes, bounds, progress-versus-kind, and
 * the six references between the tables — so the store's write path never has to
 * half-validate anything.
 */
export function validateLibraryExport(value: unknown): LibraryExportV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, VERSION_KEYS)) return null;
  if (value["version"] !== LIBRARY_EXPORT_VERSION) return null;

  const rawItems = value["items"];
  const rawCovers = value["covers"];
  const rawPasses = value["passes"];
  const rawThoughts = value["thoughts"];
  const rawCollections = value["collections"];
  const rawLinks = value["collectionItems"];
  for (const rows of [rawItems, rawCovers, rawPasses, rawThoughts, rawCollections, rawLinks]) {
    if (!Array.isArray(rows)) return null;
  }
  const arrays = [
    rawItems as readonly unknown[],
    rawCovers as readonly unknown[],
    rawPasses as readonly unknown[],
    rawThoughts as readonly unknown[],
    rawCollections as readonly unknown[],
    rawLinks as readonly unknown[],
  ];
  const rowCount = arrays.reduce((total, rows) => total + rows.length, 0);
  if (rowCount > LIBRARY_MAX_IMPORT_ROWS) return null;

  const items: LibraryItem[] = [];
  const itemIds = new Set<string>();
  /** `profileId` + Q-id, which the live table makes unique: one work, one row. */
  const workKeys = new Set<string>();
  for (const raw of arrays[0] as readonly unknown[]) {
    const item = itemOf(raw);
    if (item === null || itemIds.has(item.id)) return null;
    if (item.wikidataId !== null) {
      const key = `${item.profileId}\u001f${item.wikidataId}`;
      if (workKeys.has(key)) return null;
      workKeys.add(key);
    }
    itemIds.add(item.id);
    items.push(item);
  }

  const covers: LibraryCover[] = [];
  const coveredItems = new Set<string>();
  for (const raw of arrays[1] as readonly unknown[]) {
    const cover = coverOf(raw);
    // One cover per item is the table's primary key, so a second row for one
    // item is a value this build cannot produce.
    if (cover === null || !itemIds.has(cover.itemId) || coveredItems.has(cover.itemId)) return null;
    coveredItems.add(cover.itemId);
    covers.push(cover);
  }

  const passes: LibraryPass[] = [];
  const passIds = new Set<string>();
  const passSeqs = new Set<string>();
  for (const raw of arrays[2] as readonly unknown[]) {
    const pass = passOf(raw);
    if (pass === null || !itemIds.has(pass.itemId) || passIds.has(pass.id)) return null;
    const seqKey = `${pass.itemId}\u001f${pass.seq}`;
    if (passSeqs.has(seqKey)) return null;
    passSeqs.add(seqKey);
    passIds.add(pass.id);
    passes.push(pass);
  }

  const thoughts: LibraryThought[] = [];
  const thoughtIds = new Set<string>();
  for (const raw of arrays[3] as readonly unknown[]) {
    const thought = thoughtOf(raw);
    if (thought === null || !itemIds.has(thought.itemId) || thoughtIds.has(thought.id)) return null;
    thoughtIds.add(thought.id);
    thoughts.push(thought);
  }

  const collections: LibraryCollection[] = [];
  const collectionIds = new Set<string>();
  const adoptedKeys = new Set<string>();
  for (const raw of arrays[4] as readonly unknown[]) {
    const collection = collectionOf(raw);
    if (collection === null || collectionIds.has(collection.id)) return null;
    // At most one collection per suggestion per profile — the live partial
    // unique index migration 072 creates, and what makes adopt idempotent.
    if (collection.suggestedId !== null) {
      const key = `${collection.profileId}\u001f${collection.suggestedId}`;
      if (adoptedKeys.has(key)) return null;
      adoptedKeys.add(key);
    }
    collectionIds.add(collection.id);
    collections.push(collection);
  }

  const collectionItems: LibraryCollectionItem[] = [];
  const linkIds = new Set<string>();
  const linkPairs = new Set<string>();
  for (const raw of arrays[5] as readonly unknown[]) {
    const link = collectionItemOf(raw);
    if (
      link === null ||
      !collectionIds.has(link.collectionId) ||
      !itemIds.has(link.itemId) ||
      linkIds.has(link.id)
    ) {
      return null;
    }
    const pair = `${link.collectionId}\u001f${link.itemId}`;
    if (linkPairs.has(pair)) return null;
    linkPairs.add(pair);
    linkIds.add(link.id);
    collectionItems.push(link);
  }

  return {
    version: LIBRARY_EXPORT_VERSION,
    items,
    covers,
    passes,
    thoughts,
    collections,
    collectionItems,
  };
}

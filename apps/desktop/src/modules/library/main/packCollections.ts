import { join } from "node:path";
import { readFileBounded } from "../../../main/boundedRead.js";
import { packVersionDir, type InstalledPack } from "../../../main/packs/registry.js";
import {
  LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH,
  LIBRARY_MAX_SUGGESTION_ITEMS,
  LIBRARY_MAX_TITLE_LENGTH,
  isLibraryKind,
  isLibraryYear,
  isWikidataId,
  validateLibraryCreators,
  type LibraryKind,
  type SuggestedCollectionItemV1,
  type SuggestedCollectionV1,
} from "@nexus/core";
import type { LibrarySuggestionItemView, LibrarySuggestionView } from "../shared/ipc.js";

/**
 * The curated lists an installed `dataset` pack may carry, and the reader that
 * turns them into what the library store adopts.
 *
 * **Why the pack carries its own layout rather than the store's shape.** A pack
 * is built by whoever curates the list, out of somebody else's catalogue, and
 * the two formats answer two different questions: the pack file is a PAGE of a
 * catalogue (`layout`, `collections`, an item's `type` and its optional
 * `wikidata`), while `SuggestedCollectionV1` is what the store's adoption
 * consumes (`id`, `kind`, `source`, `licence`). This file is the one place they
 * meet, which is why it is the file with the tests for both the parsing and the
 * translation: a pack that this build cannot read is refused before anything is
 * offered, and a list it can read is translated into the store's order rather
 * than read as if it already were.
 *
 * **The layout is version 1 and a version this build does not know is refused.**
 * The same rule the interchange follows: the fields a reader cannot see are
 * exactly the ones that changed, so a `layout: 2` file is not best-effort
 * parsed. Everything else is refused too - an unknown key, a title with no
 * language, a `type` outside the three kinds, a `wikidata` that is not a Q-id -
 * because the alternative is a collection that adopts half of what it says.
 *
 * **Nothing here reads a pack the registry did not list.** `readPackCollections`
 * takes an `InstalledPack` - the value `readInstalled` built after verifying the
 * manifest's signature - and refuses to open a file the manifest does not
 * declare. The declared SIZE is checked against what the bytes are, which is the
 * manifest's own signed claim about the file; the hashes are not re-computed
 * here, because that is what the Packs card's own "Verify" is for and an
 * adoption is not the place to hash a pack.
 */

/** The one file name a `dataset` pack's curated lists live in, relative to the pack's version folder. */
export const LIBRARY_COLLECTIONS_FILE = "collections.json";

/** The only layout this build reads, and the only one it accepts. */
export const LIBRARY_COLLECTIONS_LAYOUT = 1;

/**
 * The byte cap on the list file itself, before it is read.
 *
 * Not a statement about catalogues: the file arrives from outside this machine,
 * and a reader that loads whatever size a tampered folder declares is a way to
 * make the main process allocate without limit. Four mebibytes is roughly a
 * hundred times the largest list this module's own entry cap allows
 * (`LIBRARY_MAX_SUGGESTION_ITEMS` titles of `LIBRARY_MAX_TITLE_LENGTH` in two
 * languages is under a mebibyte), so nothing a curator writes approaches it.
 */
export const LIBRARY_MAX_COLLECTIONS_BYTES = 4 * 1024 * 1024;

/**
 * How many collections one pack file may carry, and how long a collection's own
 * id may be.
 *
 * The id bound is there for the COMPOSED id: an adopted collection is marked
 * with `libpack:<pack id>:<collection id>` so that two packs naming "classics"
 * are two lists rather than one, and that string has to stay inside
 * `MAX_ID_LENGTH` (200). With a pack id of at most `PACK_LIMITS.idLength` (64)
 * and the eight characters of the prefix, 120 leaves room to spare.
 */
const MAX_PACK_COLLECTIONS = 500;
const MAX_PACK_COLLECTION_ID_LENGTH = 120;

/** One title pair a collection must carry in both languages, on the module's own copy rules. */
export interface PackCollectionTitle {
  readonly sr: string;
  readonly en: string;
}

/**
 * One work as the pack names it. `title` carries at least one language and the
 * other is null - a curated source may know a work by one of its names, and the
 * page shows the one it has rather than a Wikidata id.
 */
export interface PackCollectionItem {
  readonly kind: LibraryKind;
  readonly title: { readonly sr: string | null; readonly en: string | null };
  readonly year: number | null;
  readonly creators: readonly string[];
  readonly wikidataId: string | null;
}

/** One curated list, in canonical form: what the page offers and what the store adopts. */
export interface PackCollection {
  readonly id: string;
  readonly title: PackCollectionTitle;
  readonly description: PackCollectionTitle | null;
  readonly small: boolean;
  readonly items: readonly PackCollectionItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exactly this own key set - the format is versioned, so an unknown key is a value this build did not write. */
function hasKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const own = Object.keys(value);
  const allowed = [...required, ...optional];
  return required.every((key) => own.includes(key)) && own.every((key) => allowed.includes(key));
}

/**
 * A trimmed, bounded, non-empty string. Refuses a value that is not already
 * trimmed rather than trimming it: this reader answers "is this a value the
 * format produced", and rewriting one would hide a file somebody hand-edited.
 */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > max || value !== value.trim()) return null;
  return value;
}

/** A pair that must carry BOTH languages, for the copy a collection is named and described by. */
function fullPair(value: unknown, max: number): PackCollectionTitle | null {
  if (!isRecord(value) || !hasKeys(value, ["sr", "en"])) return null;
  const sr = text(value["sr"], max);
  const en = text(value["en"], max);
  return sr === null || en === null ? null : { sr, en };
}

/** A pair that must carry AT LEAST ONE language - an item's own title, whose missing half the page fills in from the one that is written. */
function itemPair(value: unknown): PackCollectionItem["title"] | null {
  if (!isRecord(value) || !hasKeys(value, [], ["sr", "en"])) return null;
  const sr = value["sr"] === undefined ? null : text(value["sr"], LIBRARY_MAX_TITLE_LENGTH);
  const en = value["en"] === undefined ? null : text(value["en"], LIBRARY_MAX_TITLE_LENGTH);
  if (value["sr"] !== undefined && sr === null) return null;
  if (value["en"] !== undefined && en === null) return null;
  return sr === null && en === null ? null : { sr, en };
}

function itemOf(value: unknown): PackCollectionItem | null {
  if (
    !isRecord(value) ||
    !hasKeys(value, ["type", "title"], ["year", "creators", "wikidata"])
  ) {
    return null;
  }
  const kind = value["type"];
  const title = itemPair(value["title"]);
  if (!isLibraryKind(kind) || title === null) return null;

  const rawYear = value["year"];
  const year = rawYear === undefined ? null : rawYear;
  if (year !== null && !isLibraryYear(year)) return null;

  const rawCreators = value["creators"];
  let creators: string[] = [];
  if (rawCreators !== undefined) {
    const canonical = validateLibraryCreators(rawCreators);
    if (canonical === null) return null;
    creators = canonical;
  }

  const rawWikidata = value["wikidata"];
  const wikidataId = rawWikidata === undefined ? null : rawWikidata;
  if (wikidataId !== null && !isWikidataId(wikidataId)) return null;

  return { kind, title, year, creators, wikidataId };
}

function collectionOf(value: unknown): PackCollection | null {
  if (
    !isRecord(value) ||
    !hasKeys(value, ["id", "title", "items"], ["description", "small"])
  ) {
    return null;
  }
  const id = text(value["id"], MAX_PACK_COLLECTION_ID_LENGTH);
  const title = fullPair(value["title"], LIBRARY_MAX_TITLE_LENGTH);
  if (id === null || title === null) return null;

  const rawDescription = value["description"];
  const description =
    rawDescription === undefined
      ? null
      : fullPair(rawDescription, LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH);
  if (rawDescription !== undefined && description === null) return null;

  // `small?: true` is the layout's own spelling, so a value that says anything
  // else - including `false` - did not come out of this format.
  const rawSmall = value["small"];
  if (rawSmall !== undefined && rawSmall !== true) return null;

  const rawItems = value["items"];
  // One entry at least: a list that adopts into an empty collection is a row
  // nobody can do anything with (`validateSuggestedCollection`'s own rule).
  if (
    !Array.isArray(rawItems) ||
    rawItems.length === 0 ||
    rawItems.length > LIBRARY_MAX_SUGGESTION_ITEMS
  ) {
    return null;
  }
  const items: PackCollectionItem[] = [];
  for (const raw of rawItems) {
    const item = itemOf(raw);
    if (item === null) return null;
    items.push(item);
  }

  return { id, title, description, small: rawSmall === true, items };
}

/**
 * One pack's `collections.json`, in canonical form, or null when this build will
 * not read it.
 *
 * Whole-value or nothing, deliberately: a reader that answered the collections
 * it could parse would offer a list with works missing from it, and the user
 * would have no way to tell that from a short list.
 */
export function parsePackCollections(value: unknown): PackCollection[] | null {
  if (!isRecord(value) || !hasKeys(value, ["layout", "collections"])) return null;
  if (value["layout"] !== LIBRARY_COLLECTIONS_LAYOUT) return null;
  const raw = value["collections"];
  if (!Array.isArray(raw) || raw.length > MAX_PACK_COLLECTIONS) return null;

  const collections: PackCollection[] = [];
  const ids = new Set<string>();
  for (const entry of raw) {
    const collection = collectionOf(entry);
    // Two collections sharing one id would adopt into one user collection: the
    // store marks an adoption with the list's own id (`suggestedId`).
    if (collection === null || ids.has(collection.id)) return null;
    ids.add(collection.id);
    collections.push(collection);
  }
  return collections;
}

/**
 * The marker an adopted collection carries: `libpack:<pack id>:<collection id>`.
 *
 * It exists because `library_collections.suggested_id` is unique per profile
 * and is what makes a second adoption a no-op - and a collection's own id is
 * only unique WITHIN its pack, so two packs offering their own "classics" would
 * otherwise be one list as far as the store could tell. The length fits
 * `MAX_ID_LENGTH` by construction: see the two bounds above.
 */
export function suggestedCollectionId(packId: string, collectionId: string): string {
  return `libpack:${packId}:${collectionId}`;
}

/**
 * One curated list as the store's adoption consumes it.
 *
 * The translation is deliberately thin and total: the collection's own title
 * pair is written in both languages (the layout requires it), an item's
 * one-language title is mirrored into the missing half so the store's
 * both-languages shape is satisfied without inventing a title, and the pack's
 * own `source.name` and `licence.spdx` become the list's attribution - which is
 * what a curated list adopted from a pack has to carry, since the pack file
 * itself names no source.
 */
export function suggestedCollectionOf(
  pack: InstalledPack,
  collection: PackCollection,
): SuggestedCollectionV1 {
  const items: SuggestedCollectionItemV1[] = collection.items.map((item) => {
    const sr = item.title.sr ?? item.title.en ?? "";
    const en = item.title.en ?? item.title.sr ?? "";
    const entry: {
      wikidataId?: string;
      kind: LibraryKind;
      title: { sr: string; en: string };
      year?: number;
      creators?: string[];
    } = { kind: item.kind, title: { sr, en } };
    if (item.wikidataId !== null) entry.wikidataId = item.wikidataId;
    if (item.year !== null) entry.year = item.year;
    if (item.creators.length > 0) entry.creators = [...item.creators];
    return entry;
  });

  return {
    id: suggestedCollectionId(pack.manifest.id, collection.id),
    title: { ...collection.title },
    source: pack.manifest.source.name,
    licence: pack.manifest.licence.spdx,
    items,
  };
}

/**
 * One suggestion as the page draws it. `small` and the attribution travel
 * because the row shows both, and `adopted` is decided HERE rather than in the
 * page: the marker an adopted collection carries is composed by
 * `suggestedCollectionId`, and a renderer that recomposed it would be a second
 * implementation of one format.
 */
export function suggestionViewOf(
  pack: InstalledPack,
  collection: PackCollection,
  adopted: boolean,
): LibrarySuggestionView {
  const items: LibrarySuggestionItemView[] = collection.items.map((item) => ({
    kind: item.kind,
    title: { sr: item.title.sr, en: item.title.en },
    year: item.year,
    creators: [...item.creators],
    wikidataId: item.wikidataId,
  }));
  return {
    packId: pack.manifest.id,
    packVersion: pack.manifest.version,
    collectionId: collection.id,
    title: { ...collection.title },
    description: collection.description === null ? null : { ...collection.description },
    small: collection.small,
    adopted,
    source: pack.manifest.source.name,
    licence: pack.manifest.licence.spdx,
    items,
  };
}

/**
 * The curated lists one installed `dataset` pack carries, or null.
 *
 * Null covers everything a caller cannot act on - the pack names no
 * `collections.json`, the file is not on disk, it is larger than the cap, or its
 * bytes are not the size the signed manifest declares - because the caller's
 * answer is the same for all of them: this pack offers no lists. The FILE is
 * read with the shared bounded reader (one handle, the cap measured against the
 * file that is really opened), and decoded as strict UTF-8: a file that is not
 * UTF-8 is not JSON this build wrote.
 */
export async function readPackCollections(
  userData: string,
  pack: InstalledPack,
): Promise<PackCollection[] | null> {
  if (pack.manifest.kind !== "dataset") return null;
  const declared = pack.manifest.files.find((file) => file.path === LIBRARY_COLLECTIONS_FILE);
  // A file the manifest does not list is a file whose bytes nothing has vouched
  // for, and `packVersionDir` is only ever joined with a declared path.
  if (declared === undefined || declared.size > LIBRARY_MAX_COLLECTIONS_BYTES) return null;

  const path = join(packVersionDir(userData, pack.manifest.id, pack.manifest.version), LIBRARY_COLLECTIONS_FILE);
  const read = await readFileBounded(path, LIBRARY_MAX_COLLECTIONS_BYTES);
  if (read.status !== "ok" || read.size !== declared.size) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes));
  } catch {
    return null;
  }
  return parsePackCollections(parsed);
}

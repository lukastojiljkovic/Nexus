import type { LibraryKind, LibraryStatus } from "@nexus/core";
import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * BIBLIOTEKA's contract: the channels it answers on, the payload each one takes,
 * and the API its page calls - declared once, in its own folder (ADR-090).
 *
 * **Three processes read this file.** Main globs it through
 * `main/moduleIpc.ts`'s registration glue, the preload through
 * `preload/moduleBridge.ts`, and this module's page imports its types. None of
 * them lists a channel: `contract.channels` IS the allowlist, and the op names
 * are the channel names, so "every channel starts with `library:`" is a property
 * of the declaration rather than of anybody's care.
 *
 * **Every mutation answers with the whole view.** A library is a few tables that
 * a person reads together - what is on the shelf, which shelf, what the curated
 * packs offer - and one read is smaller than the bookkeeping a per-op delta
 * would need. It is also what makes a wrong local guess impossible: the page
 * renders what main says, never what it hoped (Tajmeri's rule, one module over).
 *
 * **The row types are declared here rather than imported from `@nexus/db`.** The
 * store's rows live in `packages/db`, which is SQLite and therefore Node-only,
 * and the renderer shares this file. `main/register.ts` is the one place the two
 * shapes are mapped onto each other, and the compiler is what keeps them in step
 * - the store's row is what it maps FROM.
 *
 * **What the view deliberately does NOT carry.** A cover's bytes: the store
 * indexes them (stage 1), this build never creates a cover row, and a blob needs
 * a carrier in the archive that the kit's opaque payload does not have. Nor the
 * two vocabularies' own words - `kind` and `status` cross the wire as their
 * closed enum members, and the page names them in the language being read.
 */

/** One reading or watching, as it crosses the wire. The dates live HERE, not on the item: a re-read is a second pass, and the item's status is re-derived from the latest one. */
export interface LibraryPassView {
  readonly id: string;
  /** 1-based, ascending in the order the passes were recorded - the latest pass is the greatest `seq`. */
  readonly seq: number;
  readonly startedOn: string | null;
  readonly finishedOn: string | null;
  readonly rating: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One dated thought about a work, in the order it was written. */
export interface LibraryThoughtView {
  readonly id: string;
  readonly entryDate: string;
  readonly text: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One work on the shelf: its own columns, its passes and its journal.
 *
 * The children travel inside the item rather than as a second read because the
 * page always draws an item and its story together - the list shows the latest
 * pass's dates, and the detail shows every pass and every thought - so a
 * separate read would be a second round trip for something already in hand.
 */
export interface LibraryItemView {
  readonly id: string;
  readonly kind: LibraryKind;
  readonly title: string;
  readonly originalTitle: string | null;
  readonly creators: readonly string[];
  readonly year: number | null;
  readonly status: LibraryStatus;
  readonly rating: number | null;
  readonly pagesRead: number | null;
  readonly pagesTotal: number | null;
  readonly season: number | null;
  readonly episode: number | null;
  readonly seasonsTotal: number | null;
  readonly episodesTotal: number | null;
  readonly tags: readonly string[];
  readonly summary: string | null;
  readonly wikidataId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly passes: readonly LibraryPassView[];
  readonly thoughts: readonly LibraryThoughtView[];
}

/** One of the user's own collections, with the computed progress and the works it holds, in the user's own order. */
export interface LibraryCollectionView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  /** The curated list this collection was adopted from, or null for one the user made. */
  readonly suggestedId: string | null;
  readonly progress: { readonly done: number; readonly total: number };
  readonly itemIds: readonly string[];
}

/** One work inside a suggested collection, before it is adopted. Only the tick is required: a curated source may know a title's language and nothing else. */
export interface LibrarySuggestionItemView {
  readonly kind: LibraryKind;
  /** At least one language is written; the page shows the other one when the active locale's half is missing. Never a Wikidata id. */
  readonly title: { readonly sr: string | null; readonly en: string | null };
  readonly year: number | null;
  readonly creators: readonly string[];
  readonly wikidataId: string | null;
}

/**
 * One curated collection an installed `dataset` pack offers.
 *
 * `packId` and `packVersion` travel with it because ADOPTING reads the pack file
 * again in main: the renderer names the collection it saw, never the payload a
 * write then lands - a renderer-supplied body would be a way to make main write
 * rows nobody read (`PacksIpc`'s own rule, one surface over).
 */
export interface LibrarySuggestionView {
  readonly packId: string;
  readonly packVersion: string;
  readonly collectionId: string;
  readonly title: { readonly sr: string; readonly en: string };
  readonly description: { readonly sr: string; readonly en: string } | null;
  /** The curated list itself says it is short. Shown as such, and nothing else depends on it. */
  readonly small: boolean;
  /** True when this profile already holds a live collection adopted from this list: the page then offers no second adoption, which the store would refuse as a no-op anyway. */
  readonly adopted: boolean;
  /** The pack's own source name and licence, so the row can credit where the list came from. */
  readonly source: string;
  readonly licence: string;
  readonly items: readonly LibrarySuggestionItemView[];
}

/** Everything one read of this module answers with, and what every mutation answers with too. */
export interface LibraryView {
  /** Every live work in the profile, sr-Latn alphabetical (`sortLibraryItems`' own order). */
  readonly items: readonly LibraryItemView[];
  /** The user's own collections, sr-Latn alphabetical, each with its computed progress. */
  readonly collections: readonly LibraryCollectionView[];
  /** What the installed `dataset` packs offer, in pack order; empty when none is installed. */
  readonly suggestions: readonly LibrarySuggestionView[];
}

/** One read: whose view is being asked for. */
export interface LibraryListPayload {
  profileId: string;
}

/** The quick add: a title and a kind, which is all the brief asks a person to type before the work exists. */
export interface LibraryAddItemPayload {
  profileId: string;
  kind: LibraryKind;
  title: string;
}

/**
 * The item edit form, as a WHOLE value rather than a patch: the form shows every
 * field, so what it sends is what the user sees, and a nullable field that is
 * left empty arrives as an explicit null rather than as a key that is absent.
 *
 * Six progress fields travel even for a kind that carries none of them, and the
 * page sends nulls for those: the store is what refuses progress a kind cannot
 * have (`validateLibraryProgress`), and a shape that changed per kind would be
 * two payloads to keep in step.
 */
export interface LibraryUpdateItemPayload {
  profileId: string;
  id: string;
  title: string;
  originalTitle: string | null;
  creators: readonly string[];
  year: number | null;
  status: LibraryStatus;
  rating: number | null;
  pagesRead: number | null;
  pagesTotal: number | null;
  season: number | null;
  episode: number | null;
  seasonsTotal: number | null;
  episodesTotal: number | null;
  tags: readonly string[];
  summary: string | null;
}

/** One row of this module's tables, by its own id. The store scopes it to the profile. */
export interface LibraryRowPayload {
  profileId: string;
  id: string;
}

/** A work and the row being written to (or removed from) its story. */
export interface LibraryChildRowPayload {
  profileId: string;
  itemId: string;
  id: string;
}

/** One reading or watching, as the form records it. Any combination of the three is legal - a pass may hold only a start date. */
export interface LibraryPassPayload {
  profileId: string;
  itemId: string;
  startedOn: string | null;
  finishedOn: string | null;
  rating: number | null;
}

/** One thought, dated. */
export interface LibraryThoughtPayload {
  profileId: string;
  itemId: string;
  date: string;
  text: string;
}

export interface LibraryCreateCollectionPayload {
  profileId: string;
  name: string;
  description: string | null;
}

export interface LibraryUpdateCollectionPayload {
  profileId: string;
  id: string;
  name: string;
  description: string | null;
}

/** One work's membership of one collection. */
export interface LibraryCollectionItemPayload {
  profileId: string;
  collectionId: string;
  itemId: string;
}

/**
 * A move inside a collection: the work, and the neighbours it goes between.
 * Either may be null at an end, and a pair that does not describe a gap is
 * refused by the store rather than guessed at (`LibraryStore.moveCollectionItem`).
 */
export interface LibraryMoveCollectionItemPayload {
  profileId: string;
  collectionId: string;
  itemId: string;
  beforeId: string | null;
  afterId: string | null;
}

/** Which curated list to adopt: the pack that carries it, and the list's own id inside that pack. */
export interface LibraryAdoptSuggestionPayload {
  profileId: string;
  packId: string;
  packVersion: string;
  collectionId: string;
}

/**
 * The declared ops, as a payload-to-result map. `ModuleApiOf` turns this into
 * the `nexus.modules.library.*` methods the page calls, and
 * `defineModuleContract` turns the keys into the channels main answers on.
 */
type LibraryOps = {
  list: { request: LibraryListPayload; response: LibraryView };
  addItem: { request: LibraryAddItemPayload; response: LibraryView };
  updateItem: { request: LibraryUpdateItemPayload; response: LibraryView };
  removeItem: { request: LibraryRowPayload; response: LibraryView };
  restoreItem: { request: LibraryRowPayload; response: LibraryView };
  addPass: { request: LibraryPassPayload; response: LibraryView };
  removePass: { request: LibraryChildRowPayload; response: LibraryView };
  addThought: { request: LibraryThoughtPayload; response: LibraryView };
  updateThought: { request: LibraryThoughtPayload & { id: string }; response: LibraryView };
  removeThought: { request: LibraryChildRowPayload; response: LibraryView };
  createCollection: { request: LibraryCreateCollectionPayload; response: LibraryView };
  updateCollection: { request: LibraryUpdateCollectionPayload; response: LibraryView };
  removeCollection: { request: LibraryRowPayload; response: LibraryView };
  restoreCollection: { request: LibraryRowPayload; response: LibraryView };
  addToCollection: { request: LibraryCollectionItemPayload; response: LibraryView };
  removeFromCollection: { request: LibraryCollectionItemPayload; response: LibraryView };
  moveCollectionItem: { request: LibraryMoveCollectionItemPayload; response: LibraryView };
  adoptSuggestion: { request: LibraryAdoptSuggestionPayload; response: LibraryView };
};

/** This module's renderer API: one method per op, named after the op. */
export type LibraryApi = ModuleApiOf<LibraryOps>;

/**
 * The contract the preload builds the bridge from and main refuses foreign ops
 * against. Exported as `contract` because that is the ONE name the kit's globs
 * agree on (`preload/moduleBridge.ts` reads `module.contract` from every
 * `modules/*&#47;shared/ipc.ts`).
 */
export const contract = defineModuleContract<"library", LibraryOps>("library", [
  "list",
  "addItem",
  "updateItem",
  "removeItem",
  "restoreItem",
  "addPass",
  "removePass",
  "addThought",
  "updateThought",
  "removeThought",
  "createCollection",
  "updateCollection",
  "removeCollection",
  "restoreCollection",
  "addToCollection",
  "removeFromCollection",
  "moveCollectionItem",
  "adoptSuggestion",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here,
 * which is what makes `window.nexus.modules.library.list(...)` typed in this
 * module's own page and in its dashboard card without a line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    library: LibraryApi;
  }
}

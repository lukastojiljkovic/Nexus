import {
  LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH,
  LIBRARY_MAX_COLLECTION_NAME_LENGTH,
  LIBRARY_MAX_COUNT,
  LIBRARY_MAX_CREATOR_LENGTH,
  LIBRARY_MAX_CREATORS,
  LIBRARY_MAX_RATING,
  LIBRARY_MAX_SUMMARY_LENGTH,
  LIBRARY_MAX_TAGS,
  LIBRARY_MAX_TAG_LENGTH,
  LIBRARY_MAX_THOUGHT_LENGTH,
  LIBRARY_MAX_TITLE_LENGTH,
  LIBRARY_MAX_YEAR,
  LIBRARY_MIN_RATING,
  LIBRARY_MIN_YEAR,
  isLibraryKind,
  isLibraryStatus,
  type LibraryItem,
  type LibraryKind,
  type LibraryStatus,
  type LibraryExportV1,
} from "@nexus/core";
import { LibraryStore } from "@nexus/db";
import { readInstalled, type InstalledPack } from "../../../main/packs/registry.js";
import type { ModuleCall, ModuleHostSurface } from "../../../main/moduleIpc.js";
import {
  contract,
  type LibraryCollectionView,
  type LibraryItemView,
  type LibraryPassView,
  type LibrarySuggestionView,
  type LibraryThoughtView,
  type LibraryView,
} from "../shared/ipc.js";
import { buildLibraryExport, parseLibraryExport } from "./imex.js";
import {
  readPackCollections,
  suggestedCollectionId,
  suggestedCollectionOf,
  suggestionViewOf,
} from "./packCollections.js";

/**
 * BIBLIOTEKA in the main process (ADR-090): its handlers, its validators, and
 * its two archive halves.
 *
 * **Every payload field is validated here, and the store re-validates what
 * matters.** The renderer is untrusted (SEC-EL-02), so each field is checked for
 * SHAPE and bound against the same constant the store enforces - a title against
 * `LIBRARY_MAX_TITLE_LENGTH`, a count against `LIBRARY_MAX_COUNT`, an id with
 * `asId` - while the SEMANTIC rules (a pass finished before it was started, a
 * progress field a kind cannot carry, a day that is not a calendar day) stay in
 * the store, which is where the sentence naming the field is written. Two
 * answers to one question is the drift this arrangement avoids.
 *
 * **The whole view is one read, and every mutation answers it.** A library is
 * six tables a person reads together, and the page draws its list, its detail
 * and its shelves from one value; a per-op delta would be bookkeeping nobody
 * asked for and a second way for the page to be wrong. The extra queries that
 * build it (an item's passes and its thoughts, a collection's links) are
 * prepared statements over indexed columns - the same shape the store's own
 * reads have, and the same reason Tajmeri reads its whole state on every write.
 *
 * **The curated lists come from installed packs, read HERE.** The renderer never
 * learns a pack's path: it receives the collections a pack offers and, when the
 * user adopts one, names the pack and the list it saw - and the adoption reads
 * THAT pack file again, in main, so what lands is what the file says now rather
 * than what a renderer claimed (PacksIpc's rule, one surface over).
 */

/** What an archive that says nothing about this module means: no works, no passes, no thoughts, no collections. */
const EMPTY_LIBRARY_EXPORT: LibraryExportV1 = {
  version: 1,
  items: [],
  covers: [],
  passes: [],
  thoughts: [],
  collections: [],
  collectionItems: [],
};

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  function library(call: StoreBearer, profileId: string): LibraryStore {
    return call.profileDb(profileId, (db, id) => new LibraryStore(db, id));
  }

  /**
   * The installed packs this build may read. `readInstalled` answers from the
   * packs index when it is usable and rebuilds it from disk when it is not, and
   * both of those are reads: an adoption never writes a pack or its index.
   */
  function installedPacks(call: PacksBearer): {
    readonly userData: string;
    readonly packs: readonly InstalledPack[];
  } {
    const access = call.packs();
    const userData = access.userData();
    return { userData, packs: readInstalled(userData, access.publicKeyPem) };
  }

  /**
   * Every curated list every installed `dataset` pack offers, in pack order.
   *
   * A pack whose list file is missing, unreadable or not in this build's layout
   * contributes nothing and is not an error: a `dataset` pack may hold data for
   * anything, and "this pack carries no lists this module understands" is the
   * honest answer rather than a failed screen.
   */
  async function suggestionsOf(
    call: PacksBearer,
    adoptedIds: ReadonlySet<string>,
  ): Promise<LibrarySuggestionView[]> {
    const { userData, packs } = installedPacks(call);
    const suggestions: LibrarySuggestionView[] = [];
    for (const pack of packs) {
      if (pack.manifest.kind !== "dataset") continue;
      const collections = await readPackCollections(userData, pack);
      if (collections === null) continue;
      for (const collection of collections) {
        const marker = suggestedCollectionId(pack.manifest.id, collection.id);
        suggestions.push(suggestionViewOf(pack, collection, adoptedIds.has(marker)));
      }
    }
    return suggestions;
  }

  /**
   * One work as the wire declares it. The mapping is explicit field by field, so
   * a renamed column is a compile error here rather than `undefined` on screen
   * (`Tajmeri`'s own arrangement, one module over).
   */
  function itemView(store: LibraryStore, item: LibraryItem): LibraryItemView {
    const passes: LibraryPassView[] = store.listPasses(item.id).map((pass) => ({
      id: pass.id,
      seq: pass.seq,
      startedOn: pass.startedOn,
      finishedOn: pass.finishedOn,
      rating: pass.rating,
      createdAt: pass.createdAt,
      updatedAt: pass.updatedAt,
    }));
    const thoughts: LibraryThoughtView[] = store.listThoughts(item.id).map((thought) => ({
      id: thought.id,
      entryDate: thought.entryDate,
      text: thought.text,
      createdAt: thought.createdAt,
      updatedAt: thought.updatedAt,
    }));
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      originalTitle: item.originalTitle,
      creators: item.creators,
      year: item.year,
      status: item.status,
      rating: item.rating,
      pagesRead: item.pagesRead,
      pagesTotal: item.pagesTotal,
      season: item.season,
      episode: item.episode,
      seasonsTotal: item.seasonsTotal,
      episodesTotal: item.episodesTotal,
      tags: item.tags,
      summary: item.summary,
      wikidataId: item.wikidataId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      passes,
      thoughts,
    };
  }

  async function viewOf(call: CallBearer, profileId: string): Promise<LibraryView> {
    const store = library(call, profileId);
    const items = store.listItems().map((item) => itemView(store, item));
    const rows = store.listCollections();
    const collections: LibraryCollectionView[] = rows.map((collection) => ({
      id: collection.id,
      name: collection.name,
      description: collection.description,
      suggestedId: collection.suggestedId,
      progress: { done: collection.progress.done, total: collection.progress.total },
      itemIds: store.listCollectionLinks(collection.id).map((link) => link.itemId),
    }));
    // One read of the collections feeds both the shelves and the "already
    // adopted" mark on a suggested list, so the two cannot disagree.
    const adoptedIds = new Set<string>();
    for (const row of rows) if (row.suggestedId !== null) adoptedIds.add(row.suggestedId);
    return { items, collections, suggestions: await suggestionsOf(call, adoptedIds) };
  }

  /** What every mutation answers with: the rows read back, which is also what the page then draws. */
  function changed(call: CallBearer, profileId: string): Promise<LibraryView> {
    return viewOf(call, profileId);
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId);
  });

  ctx.handle("addItem", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).createItem(
      { kind: kindOf(payload.kind), title: titleOf(call, payload.title) },
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("updateItem", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).updateItem(
      call.as.asId(payload.id, "id"),
      {
        title: titleOf(call, payload.title),
        originalTitle: nullableTitle(call, payload.originalTitle, "originalTitle"),
        creators: textList(
          call,
          payload.creators,
          "creators",
          LIBRARY_MAX_CREATORS,
          LIBRARY_MAX_CREATOR_LENGTH,
        ),
        year: nullableBounded(call, payload.year, "year", LIBRARY_MIN_YEAR, LIBRARY_MAX_YEAR),
        status: statusOf(payload.status),
        rating: nullableBounded(
          call,
          payload.rating,
          "rating",
          LIBRARY_MIN_RATING,
          LIBRARY_MAX_RATING,
        ),
        // A read count may be zero; every other count starts at one, which is the
        // store's own `isLibraryReadPages` / `isLibraryCount` split.
        pagesRead: nullableBounded(call, payload.pagesRead, "pagesRead", 0, LIBRARY_MAX_COUNT),
        pagesTotal: nullableBounded(call, payload.pagesTotal, "pagesTotal", 1, LIBRARY_MAX_COUNT),
        season: nullableBounded(call, payload.season, "season", 1, LIBRARY_MAX_COUNT),
        episode: nullableBounded(call, payload.episode, "episode", 1, LIBRARY_MAX_COUNT),
        seasonsTotal: nullableBounded(
          call,
          payload.seasonsTotal,
          "seasonsTotal",
          1,
          LIBRARY_MAX_COUNT,
        ),
        episodesTotal: nullableBounded(
          call,
          payload.episodesTotal,
          "episodesTotal",
          1,
          LIBRARY_MAX_COUNT,
        ),
        tags: textList(call, payload.tags, "tags", LIBRARY_MAX_TAGS, LIBRARY_MAX_TAG_LENGTH),
        summary: nullableCapped(call, payload.summary, "summary", LIBRARY_MAX_SUMMARY_LENGTH),
      },
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("removeItem", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).softDeleteItem(call.as.asId(payload.id, "id"), instant(call.now()));
    return changed(call, profileId);
  });

  ctx.handle("restoreItem", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).restoreItem(call.as.asId(payload.id, "id"), instant(call.now()));
    return changed(call, profileId);
  });

  ctx.handle("addPass", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).addPass(
      call.as.asId(payload.itemId, "itemId"),
      {
        startedOn: nullableDay(call, payload.startedOn, "startedOn"),
        finishedOn: nullableDay(call, payload.finishedOn, "finishedOn"),
        rating: nullableBounded(
          call,
          payload.rating,
          "rating",
          LIBRARY_MIN_RATING,
          LIBRARY_MAX_RATING,
        ),
      },
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("removePass", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).removePass(
      call.as.asId(payload.itemId, "itemId"),
      call.as.asId(payload.id, "id"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("addThought", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).addThought(
      call.as.asId(payload.itemId, "itemId"),
      { date: dayOf(call, payload.date), text: thoughtOf(call, payload.text) },
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("updateThought", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).updateThought(
      call.as.asId(payload.itemId, "itemId"),
      call.as.asId(payload.id, "id"),
      { date: dayOf(call, payload.date), text: thoughtOf(call, payload.text) },
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("removeThought", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).removeThought(
      call.as.asId(payload.itemId, "itemId"),
      call.as.asId(payload.id, "id"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("createCollection", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).createCollection(
      {
        name: collectionNameOf(call, payload.name),
        description: nullableCapped(
          call,
          payload.description,
          "description",
          LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH,
        ),
      },
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("updateCollection", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).updateCollection(
      call.as.asId(payload.id, "id"),
      {
        name: collectionNameOf(call, payload.name),
        description: nullableCapped(
          call,
          payload.description,
          "description",
          LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH,
        ),
      },
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("removeCollection", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).softDeleteCollection(
      call.as.asId(payload.id, "id"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("restoreCollection", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).restoreCollection(
      call.as.asId(payload.id, "id"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("addToCollection", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).addToCollection(
      call.as.asId(payload.collectionId, "collectionId"),
      call.as.asId(payload.itemId, "itemId"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("removeFromCollection", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).removeFromCollection(
      call.as.asId(payload.collectionId, "collectionId"),
      call.as.asId(payload.itemId, "itemId"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("moveCollectionItem", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    library(call, profileId).moveCollectionItem(
      call.as.asId(payload.collectionId, "collectionId"),
      call.as.asId(payload.itemId, "itemId"),
      // Either neighbour may be absent at an end of the list, and `null` is the
      // only way to say so: `beforeId`/`afterId` are never optional, and an
      // omitted one would be read as the store's own "no neighbour" anyway.
      payload.beforeId === null ? null : call.as.asId(payload.beforeId, "beforeId"),
      payload.afterId === null ? null : call.as.asId(payload.afterId, "afterId"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("adoptSuggestion", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const packId = call.as.asId(payload.packId, "packId");
    const packVersion = call.as.asCappedChars(
      call.as.asNonEmptyString(payload.packVersion, "packVersion"),
      "packVersion",
      20,
    );
    const collectionId = call.as.asId(payload.collectionId, "collectionId");

    // The file is read AGAIN, here: what the renderer named is a pack and a list
    // it saw, and what lands is what that file says now - so an adoption cannot
    // be a way to make main write rows nobody read.
    const { userData, packs } = installedPacks(call);
    const pack = packs.find(
      (candidate) => candidate.manifest.id === packId && candidate.manifest.version === packVersion,
    );
    const collections = pack === undefined ? null : await readPackCollections(userData, pack);
    const collection = collections?.find((candidate) => candidate.id === collectionId) ?? null;
    // The pack or the list is gone, or it never carried this list: a refusal
    // naming that is what the page can act on, and it is the one case reading the
    // pack again has to distinguish.
    if (pack === undefined || collection === null) {
      throw new Error(
        `No installed pack "${packId}" ${packVersion} offers a collection "${collectionId}".`,
      );
    }

    library(call, profileId).adoptSuggestedCollection(
      suggestedCollectionOf(pack, collection),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  // --- The archive (ADR-090 §imex) -----------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    return buildLibraryExport(library(session, profileId));
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload - the version first - and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parseLibraryExport,
    // The writing half. `undefined` is an archive that says nothing about the
    // Library, which for a restore that replaces a profile whole means empty: no
    // works, no passes, no thoughts, no collections. The store's `importData`
    // empties this profile's six tables and writes exactly what the value holds.
    apply: (payload, session) => {
      for (const profileId of session.profileIds) {
        library(session, profileId).importData(payload ?? EMPTY_LIBRARY_EXPORT);
      }
    },
  });
}

/**
 * Something with a profile's database, as a handler's call and a session both
 * have it - so the store opener below is one function rather than two that drift.
 */
interface StoreBearer {
  readonly profileDb: ModuleCall["profileDb"];
}

/** Something that can read the installed packs, and open a profile's database. */
interface PacksBearer {
  packs(): { userData(): string; publicKeyPem: string };
}

/** Everything a handler's call must offer: the store's bearer and the packs'. */
type CallBearer = ModuleCall;

/**
 * The one profile a session is about, or `null` when it names none or several.
 *
 * An archive is written ONE profile at a time (`main/imex.ts`'s `handleExport`
 * gathers one profile's `ProfileData`), so "several" is not a shape the exporter
 * meets. Answering `null` rather than guessing is what keeps that true: if a
 * session ever did name several, this module has no single library its payload
 * belongs to, and the honest payload is none at all.
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** The validators a handler is handed, narrowed to what the helpers below use. */
type As = ModuleCall["as"];

function titleOf(call: { as: As }, value: unknown, field = "title"): string {
  return call.as.asCappedChars(
    call.as.asNonEmptyString(value, field),
    field,
    LIBRARY_MAX_TITLE_LENGTH,
  );
}

/** A title the user may leave empty: null clears it. An empty STRING is refused rather than folded to null, because the store refuses it too and two answers would be one too many. */
function nullableTitle(call: { as: As }, value: unknown, field: string): string | null {
  return value === null ? null : titleOf(call, value, field);
}

function kindOf(value: unknown): LibraryKind {
  if (!isLibraryKind(value)) {
    throw new Error('Invalid IPC payload: "kind" must be book, film or series.');
  }
  return value;
}

function statusOf(value: unknown): LibraryStatus {
  if (!isLibraryStatus(value)) {
    throw new Error(
      'Invalid IPC payload: "status" must be planned, in-progress, done or dropped.',
    );
  }
  return value;
}

/** A nullable whole number inside a closed range - a year, a rating, a page count, a season. */
function nullableBounded(
  call: { as: As },
  value: unknown,
  field: string,
  min: number,
  max: number,
): number | null {
  return value === null ? null : call.as.asBoundedInteger(value, field, min, max);
}

/** A nullable string with a cap, for what the store keeps as text. */
function nullableCapped(
  call: { as: As },
  value: unknown,
  field: string,
  max: number,
): string | null {
  const text = call.as.asNullableString(value, field);
  return text === null ? null : call.as.asCappedChars(text, field, max);
}

/** A bare calendar day. Ten characters is the whole shape of one, so a ten-megabyte "date" never reaches the store's own check. */
function nullableDay(call: { as: As }, value: unknown, field: string): string | null {
  const day = call.as.asNullableString(value, field);
  return day === null ? null : call.as.asCappedChars(day, field, 10);
}

/** A required bare day: what a thought is filed under. */
function dayOf(call: { as: As }, value: unknown): string {
  return call.as.asCappedChars(call.as.asNonEmptyString(value, "date"), "date", 10);
}

/** A thought's text, bounded as the store bounds it. */
function thoughtOf(call: { as: As }, value: unknown): string {
  return call.as.asCappedChars(
    call.as.asNonEmptyString(value, "text"),
    "text",
    LIBRARY_MAX_THOUGHT_LENGTH,
  );
}

function collectionNameOf(call: { as: As }, value: unknown): string {
  return call.as.asCappedChars(
    call.as.asNonEmptyString(value, "name"),
    "name",
    LIBRARY_MAX_COLLECTION_NAME_LENGTH,
  );
}

/** A list of names or tags off the wire: strings, bounded in count and in length. Canonicalisation itself belongs to the store's own validators, and a second copy of it here could only disagree with them. */
function textList(
  call: { as: As },
  value: unknown,
  field: string,
  maxItems: number,
  maxChars: number,
): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid IPC payload: "${field}" must be an array.`);
  }
  if (value.length > maxItems) {
    throw new Error(`Invalid IPC payload: "${field}" must hold at most ${maxItems} entries.`);
  }
  return value.map((entry, index) =>
    call.as.asCappedChars(
      call.as.asString(entry, `${field}[${index}]`),
      `${field}[${index}]`,
      maxChars,
    ),
  );
}

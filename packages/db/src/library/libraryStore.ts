import type Database from "better-sqlite3-multiple-ciphers";
import {
  LIBRARY_COLLATOR,
  LIBRARY_EXPORT_VERSION,
  LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH,
  LIBRARY_MAX_COLLECTION_NAME_LENGTH,
  LIBRARY_MAX_COVER_BYTES,
  LIBRARY_MAX_SUMMARY_LENGTH,
  LIBRARY_MAX_THOUGHT_LENGTH,
  LIBRARY_MAX_TITLE_LENGTH,
  deriveLibraryRatingFromPass,
  deriveLibraryStatusFromPass,
  isLibraryCount,
  isLibraryDay,
  isLibraryReadPages,
  isLibraryRating,
  isLibraryStatus,
  isLibraryTimestamp,
  isLibraryYear,
  isWikidataId,
  libraryExportVersion,
  rankBetween,
  serializeLibraryList,
  sortLibraryItems,
  titleMatchKey,
  validateLibraryCreators,
  validateLibraryExport,
  validateLibraryProgress,
  validateLibraryTags,
  validateSuggestedCollection,
} from "@nexus/core";
import type {
  LibraryCollection,
  LibraryCollectionItem,
  LibraryCollectionProgress,
  LibraryCover,
  LibraryExportV1,
  LibraryItem,
  LibraryKind,
  LibraryPass,
  LibraryPassOutcome,
  LibraryProgress,
  LibraryProgressField,
  LibraryStatus,
  LibraryThought,
  SuggestedCollectionItemV1,
  SuggestedCollectionV1,
} from "@nexus/core";
import {
  LibraryNotFoundError,
  LibraryValidationError,
  isUniqueConstraintViolation,
} from "../errors.js";
import { uuidv7 } from "../ids.js";
import { placeBetween } from "../tasks/taskListStore.js";

type DatabaseHandle = Database.Database;

/**
 * The wire/store cap on one cover's byte size. The value is
 * `MAX_NOTE_ATTACHMENT_BYTES`', copied rather than reinvented: a cover is a row
 * in the same content-addressed blob store, so a second number would only be a
 * second answer to „how big may a file be" (`MAX_TASK_ATTACHMENT_BYTES`' own
 * comment, one module over).
 */
export const MAX_LIBRARY_COVER_BYTES = LIBRARY_MAX_COVER_BYTES;

const MAX_FILE_NAME_LENGTH = 255;
const MAX_MIME_LENGTH = 100;
const MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Fields for a cover row. `mime`, `sizeBytes` and `sha256` are derived by main from the blob itself, never from the renderer's claim (SEC-FILE-02). */
export interface LibraryCoverInput {
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * What creating an item accepts. Every field but the kind and the title is
 * optional, and a progress field the item's kind cannot carry must be absent or
 * null — the refusal names it. Spelled out rather than derived from
 * `LibraryProgress`, whose fields are the STORED shape (all six present, most of
 * them null): a caller creating a film should not have to write five nulls.
 */
export interface CreateLibraryItemInput {
  kind: LibraryKind;
  title: string;
  originalTitle?: string | null;
  creators?: readonly string[];
  year?: number | null;
  status?: LibraryStatus;
  rating?: number | null;
  tags?: readonly string[];
  summary?: string | null;
  wikidataId?: string | null;
  pagesRead?: number | null;
  pagesTotal?: number | null;
  season?: number | null;
  episode?: number | null;
  seasonsTotal?: number | null;
  episodesTotal?: number | null;
}

/**
 * A partial patch. An omitted key is left untouched; an explicit `null` clears a
 * nullable field. `kind` is deliberately NOT here: a book is not a film later,
 * and letting the kind move would either discard the pages a user recorded or
 * refuse the edit for a reason the form never showed.
 *
 * Written out rather than derived with `Partial`, and that is not verbosity: a
 * mapped `?:` admits an explicit `undefined` under `exactOptionalPropertyTypes`,
 * and `"year" in fields` cannot tell that from an omission — so a caller passing
 * `undefined` would silently CLEAR the year. This shape refuses it at compile
 * time, which leaves `null` as the only way to say „clear this".
 */
export interface UpdateLibraryItemFields {
  title?: string;
  originalTitle?: string | null;
  creators?: readonly string[];
  year?: number | null;
  status?: LibraryStatus;
  rating?: number | null;
  tags?: readonly string[];
  summary?: string | null;
  wikidataId?: string | null;
  pagesRead?: number | null;
  pagesTotal?: number | null;
  season?: number | null;
  episode?: number | null;
  seasonsTotal?: number | null;
  episodesTotal?: number | null;
}

/** What recording a pass accepts; every field optional, and any combination is legal. */
export interface AddLibraryPassInput {
  startedOn?: string | null;
  finishedOn?: string | null;
  rating?: number | null;
}

/** A partial pass patch, on `UpdateLibraryItemFields`' terms. */
export type UpdateLibraryPassFields = AddLibraryPassInput;

export interface AddLibraryThoughtInput {
  date: string;
  text: string;
}

export type UpdateLibraryThoughtFields = {
  [K in keyof AddLibraryThoughtInput]?: AddLibraryThoughtInput[K];
};

export interface CreateLibraryCollectionInput {
  name: string;
  description?: string | null;
}

export type UpdateLibraryCollectionFields = {
  [K in keyof CreateLibraryCollectionInput]?: CreateLibraryCollectionInput[K];
};

/** A collection as the store reads it: the row, plus its computed progress. */
export interface LibraryCollectionWithProgress extends LibraryCollection {
  /** `done / total` over the collection's LIVE items — computed on every read, never stored (`collectionProgress` in `@nexus/core`). */
  readonly progress: LibraryCollectionProgress;
}

/**
 * One work as the store reads it: the row, plus its one cover. The cover travels
 * with the item rather than as a second read because a list wants a thumbnail
 * per row, and the store reads every cover of the profile in one query
 * (`coverMap`) — the shape migration 068 gave a circuit and its chassis, where a
 * 1:1 child is a field of its parent.
 */
export interface LibraryItemWithCover extends LibraryItem {
  readonly cover: LibraryCover | null;
}

/** What `adoptSuggestedCollection` did: the collection, and the two counts that say what it cost. */
export interface AdoptResult {
  readonly collection: LibraryCollectionWithProgress;
  /** False when this profile already had a live collection adopted from this list — a repeat adoption changes nothing, and both counts are then zero. */
  readonly created: boolean;
  /** Entries the adoption had to create, as `planned`. */
  readonly createdItems: number;
  /** Entries that matched a work already in this profile, counted per entry (before the collection's own „once" dedupe). */
  readonly reusedItems: number;
}

/** How many rows one `importData` wrote, per table. */
export interface LibraryImportCounts {
  readonly items: number;
  readonly covers: number;
  readonly passes: number;
  readonly thoughts: number;
  readonly collections: number;
  readonly collectionItems: number;
}

interface ItemRow {
  id: string;
  profile_id: string;
  kind: string;
  title: string;
  original_title: string | null;
  creators_json: string;
  year: number | null;
  status: string;
  rating: number | null;
  pages_read: number | null;
  pages_total: number | null;
  season: number | null;
  episode: number | null;
  seasons_total: number | null;
  episodes_total: number | null;
  tags_json: string;
  summary: string | null;
  wikidata_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CoverRow {
  item_id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  updated_at: string;
}

interface PassRow {
  id: string;
  item_id: string;
  seq: number;
  started_on: string | null;
  finished_on: string | null;
  rating: number | null;
  created_at: string;
  updated_at: string;
}

interface ThoughtRow {
  id: string;
  item_id: string;
  entry_date: string;
  text: string;
  created_at: string;
  updated_at: string;
}

interface CollectionRow {
  id: string;
  profile_id: string;
  name: string;
  description: string | null;
  suggested_id: string | null;
  created_at: string;
  updated_at: string;
}

interface LinkRow {
  id: string;
  collection_id: string;
  item_id: string;
  rank: string;
  created_at: string;
  updated_at: string;
}

interface ProgressRow {
  collection_id: string;
  done: number;
  total: number;
}

interface MatchRow {
  id: string;
  kind: string;
  title: string;
  original_title: string | null;
  year: number | null;
  wikidata_id: string | null;
}

const ITEM_COLUMNS =
  "id, profile_id, kind, title, original_title, creators_json, year, status, rating, " +
  "pages_read, pages_total, season, episode, seasons_total, episodes_total, tags_json, " +
  "summary, wikidata_id, created_at, updated_at";

const COVER_COLUMNS = "item_id, file_name, mime, size_bytes, sha256, created_at, updated_at";

const PASS_COLUMNS =
  "id, item_id, seq, started_on, finished_on, rating, created_at, updated_at";

const THOUGHT_COLUMNS = "id, item_id, entry_date, text, created_at, updated_at";

const COLLECTION_COLUMNS =
  "id, profile_id, name, description, suggested_id, created_at, updated_at";

const LINK_COLUMNS = "id, collection_id, item_id, rank, created_at, updated_at";

/** The item columns, aliased with `i.`, for the one query that joins a child table. */
const JOINED_ITEM_COLUMNS = ITEM_COLUMNS.split(", ")
  .map((column) => `i.${column}`)
  .join(", ");

/**
 * The LIBRARY module's storage for one profile (migration 072): the works, their
 * passes, their journal, their covers, and the collections that organise them.
 * One store over six tables, because a pass or a thought is not a thing with a
 * page of its own — it is part of the work's story, and splitting the store
 * would only mean two objects that both had to know the item's rules.
 *
 * **Every item statement is scoped by `profile_id`; every CHILD statement is
 * scoped through its parent.** `library_passes`, `library_thoughts`,
 * `library_item_covers` and `library_collection_items` deliberately carry no
 * `profile_id` (migration 072), so a write naming another profile's item or
 * collection is resolved away first and refused — `HabitStore`'s arrangement,
 * and the reason `requireItemRow`/`requireCollectionRow` gate every mutation.
 *
 * **What this store refuses, and why a refusal is a sentence.** Everything a
 * renderer can send is revalidated here (SEC-EL-02): kinds and statuses against
 * their closed vocabularies, text against its bound after trimming, counts
 * against their ranges, progress against the item's KIND (the rule no
 * field-by-field check can see), a pass's `startedOn` against its `finishedOn`,
 * a bare day against the calendar, and a `wikidataId` against the `Q…` grammar.
 * Migration 072's CHECKs say the same things as a backstop; the store is the
 * message, and `isUniqueConstraintViolation` covers the three UNIQUE indexes no
 * CHECK can state.
 *
 * **`updatedAt` is the item's last activity.** A pass, a thought or a cover
 * write bumps the item's own `updated_at` in the same transaction — that is what
 * makes „poredano po aktivnosti" one column rather than a max over three child
 * tables, and it is the one place this store's timestamps differ from, say, a
 * note's (whose body lives in another table and moves only with itself).
 *
 * `now` is supplied by the caller and validated here — main stamps the clock,
 * the renderer never does (`HabitStore`'s rule).
 */
export class LibraryStore {
  private readonly insertItem: Database.Statement;
  private readonly selectItem: Database.Statement;
  private readonly selectItems: Database.Statement;
  private readonly selectItemsForExport: Database.Statement;
  private readonly selectItemMatches: Database.Statement;
  private readonly updateItemFields: Database.Statement;
  private readonly updateItemDerived: Database.Statement;
  private readonly markItemDeleted: Database.Statement;
  private readonly markItemRestored: Database.Statement;
  private readonly touchItem: Database.Statement;

  private readonly upsertCover: Database.Statement;
  private readonly selectCover: Database.Statement;
  private readonly selectCoversForProfile: Database.Statement;
  private readonly selectCoversForExport: Database.Statement;
  private readonly deleteCover: Database.Statement;

  private readonly selectPasses: Database.Statement;
  private readonly selectPass: Database.Statement;
  private readonly selectLatestPass: Database.Statement;
  private readonly selectMaxPassSeq: Database.Statement;
  private readonly insertPass: Database.Statement;
  private readonly updatePassFields: Database.Statement;
  private readonly deletePass: Database.Statement;
  private readonly selectPassesForExport: Database.Statement;

  private readonly selectThoughts: Database.Statement;
  private readonly selectThought: Database.Statement;
  private readonly insertThought: Database.Statement;
  private readonly updateThoughtFields: Database.Statement;
  private readonly deleteThought: Database.Statement;
  private readonly selectThoughtsForExport: Database.Statement;

  private readonly insertCollection: Database.Statement;
  private readonly selectCollection: Database.Statement;
  private readonly selectCollections: Database.Statement;
  private readonly selectCollectionsForExport: Database.Statement;
  private readonly selectCollectionProgress: Database.Statement;
  private readonly selectOneCollectionProgress: Database.Statement;
  private readonly selectAdoptedCollection: Database.Statement;
  private readonly updateCollectionFields: Database.Statement;
  private readonly touchCollection: Database.Statement;
  private readonly markCollectionDeleted: Database.Statement;
  private readonly markCollectionRestored: Database.Statement;

  private readonly selectLinkItems: Database.Statement;
  private readonly selectLinks: Database.Statement;
  private readonly selectLink: Database.Statement;
  private readonly selectMaxLinkRank: Database.Statement;
  private readonly insertLink: Database.Statement;
  private readonly updateLinkRank: Database.Statement;
  private readonly deleteLink: Database.Statement;
  private readonly selectLinksForExport: Database.Statement;

  private readonly wipeLinks: Database.Statement;
  private readonly wipeCovers: Database.Statement;
  private readonly wipePasses: Database.Statement;
  private readonly wipeThoughts: Database.Statement;
  private readonly wipeCollections: Database.Statement;
  private readonly wipeItems: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    const liveItems = "i.deleted_at IS NULL";
    const progressSelect =
      `SELECT c.id AS collection_id,
              coalesce(sum(CASE WHEN i.status = 'done' THEN 1 ELSE 0 END), 0) AS done,
              count(i.id) AS total
         FROM library_collections c
         LEFT JOIN library_collection_items l ON l.collection_id = c.id
         LEFT JOIN library_items i ON i.id = l.item_id AND ${liveItems}`;

    this.insertItem = db.prepare(
      `INSERT INTO library_items
         (id, profile_id, kind, title, original_title, creators_json, year, status, rating,
          pages_read, pages_total, season, episode, seasons_total, episodes_total, tags_json,
          summary, wikidata_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectItem = db.prepare(
      `SELECT ${ITEM_COLUMNS} FROM library_items
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectItems = db.prepare(
      `SELECT ${ITEM_COLUMNS} FROM library_items
        WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    // The archive's read: live rows only, in id order, so two exports of
    // unchanged data are identical (`export.ts`'s own rule).
    this.selectItemsForExport = db.prepare(
      `SELECT ${ITEM_COLUMNS} FROM library_items
        WHERE profile_id = ? AND deleted_at IS NULL ORDER BY id`,
    );
    /**
     * What the adopt operation matches against: this profile's live items, and
     * nothing else. The WHOLE set arrives in one query rather than as a `LIKE`
     * per suggestion entry, because the fold that decides „the same work" is
     * `titleMatchKey` in `@nexus/core` — a SQL pattern would be a SECOND
     * implementation of it, and the two would disagree the first time either
     * changed.
     */
    this.selectItemMatches = db.prepare(
      `SELECT id, kind, title, original_title, year, wikidata_id FROM library_items
        WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateItemFields = db.prepare(
      `UPDATE library_items
          SET title = ?, original_title = ?, creators_json = ?, year = ?, status = ?,
              rating = ?, pages_read = ?, pages_total = ?, season = ?, episode = ?,
              seasons_total = ?, episodes_total = ?, tags_json = ?, summary = ?,
              wikidata_id = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // What a pass writes onto its item: the two derived columns and the last
    // activity stamp, in one statement.
    this.updateItemDerived = db.prepare(
      `UPDATE library_items SET status = ?, rating = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markItemDeleted = db.prepare(
      `UPDATE library_items SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markItemRestored = db.prepare(
      `UPDATE library_items SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.touchItem = db.prepare(
      `UPDATE library_items SET updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );

    this.upsertCover = db.prepare(
      `INSERT INTO library_item_covers
         (item_id, file_name, mime, size_bytes, sha256, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (item_id) DO UPDATE SET
         file_name = excluded.file_name,
         mime = excluded.mime,
         size_bytes = excluded.size_bytes,
         sha256 = excluded.sha256,
         updated_at = excluded.updated_at`,
    );
    this.selectCover = db.prepare(
      `SELECT ${COVER_COLUMNS} FROM library_item_covers WHERE item_id = ?`,
    );
    this.selectCoversForProfile = db.prepare(
      `SELECT c.item_id AS item_id, c.file_name AS file_name, c.mime AS mime,
              c.size_bytes AS size_bytes, c.sha256 AS sha256,
              c.created_at AS created_at, c.updated_at AS updated_at
         FROM library_item_covers c
         JOIN library_items i ON i.id = c.item_id
        WHERE i.profile_id = ? AND ${liveItems}`,
    );
    this.selectCoversForExport = db.prepare(
      `SELECT c.item_id AS item_id, c.file_name AS file_name, c.mime AS mime,
              c.size_bytes AS size_bytes, c.sha256 AS sha256,
              c.created_at AS created_at, c.updated_at AS updated_at
         FROM library_item_covers c
         JOIN library_items i ON i.id = c.item_id
        WHERE i.profile_id = ? AND ${liveItems}
        ORDER BY c.item_id`,
    );
    this.deleteCover = db.prepare(`DELETE FROM library_item_covers WHERE item_id = ?`);

    this.selectPasses = db.prepare(
      `SELECT ${PASS_COLUMNS} FROM library_passes WHERE item_id = ? ORDER BY seq`,
    );
    this.selectPass = db.prepare(
      `SELECT ${PASS_COLUMNS} FROM library_passes WHERE id = ? AND item_id = ?`,
    );
    this.selectLatestPass = db.prepare(
      `SELECT ${PASS_COLUMNS} FROM library_passes WHERE item_id = ? ORDER BY seq DESC LIMIT 1`,
    );
    this.selectMaxPassSeq = db.prepare(
      `SELECT max(seq) AS maxSeq FROM library_passes WHERE item_id = ?`,
    );
    this.insertPass = db.prepare(
      `INSERT INTO library_passes
         (id, item_id, seq, started_on, finished_on, rating, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.updatePassFields = db.prepare(
      `UPDATE library_passes SET started_on = ?, finished_on = ?, rating = ?, updated_at = ?
        WHERE id = ? AND item_id = ?`,
    );
    this.deletePass = db.prepare(`DELETE FROM library_passes WHERE id = ? AND item_id = ?`);
    this.selectPassesForExport = db.prepare(
      `SELECT p.id AS id, p.item_id AS item_id, p.seq AS seq, p.started_on AS started_on,
              p.finished_on AS finished_on, p.rating AS rating,
              p.created_at AS created_at, p.updated_at AS updated_at
         FROM library_passes p
         JOIN library_items i ON i.id = p.item_id
        WHERE i.profile_id = ? AND ${liveItems}
        ORDER BY p.item_id, p.seq`,
    );

    this.selectThoughts = db.prepare(
      `SELECT ${THOUGHT_COLUMNS} FROM library_thoughts
        WHERE item_id = ? ORDER BY entry_date, created_at, id`,
    );
    this.selectThought = db.prepare(
      `SELECT ${THOUGHT_COLUMNS} FROM library_thoughts WHERE id = ? AND item_id = ?`,
    );
    this.insertThought = db.prepare(
      `INSERT INTO library_thoughts (id, item_id, entry_date, text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.updateThoughtFields = db.prepare(
      `UPDATE library_thoughts SET entry_date = ?, text = ?, updated_at = ?
        WHERE id = ? AND item_id = ?`,
    );
    this.deleteThought = db.prepare(`DELETE FROM library_thoughts WHERE id = ? AND item_id = ?`);
    this.selectThoughtsForExport = db.prepare(
      `SELECT t.id AS id, t.item_id AS item_id, t.entry_date AS entry_date, t.text AS text,
              t.created_at AS created_at, t.updated_at AS updated_at
         FROM library_thoughts t
         JOIN library_items i ON i.id = t.item_id
        WHERE i.profile_id = ? AND ${liveItems}
        ORDER BY t.item_id, t.entry_date, t.id`,
    );

    this.insertCollection = db.prepare(
      `INSERT INTO library_collections
         (id, profile_id, name, description, suggested_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectCollection = db.prepare(
      `SELECT ${COLLECTION_COLUMNS} FROM library_collections
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectCollections = db.prepare(
      `SELECT ${COLLECTION_COLUMNS} FROM library_collections
        WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectCollectionsForExport = db.prepare(
      `SELECT ${COLLECTION_COLUMNS} FROM library_collections
        WHERE profile_id = ? AND deleted_at IS NULL ORDER BY id`,
    );
    // The computed progress, in ONE query for every collection of the profile —
    // a card per collection would otherwise be a query per card. The item join
    // is filtered on `deleted_at`, which is what makes „all items" mean the live
    // ones (`collections.ts`).
    this.selectCollectionProgress = db.prepare(
      `${progressSelect} WHERE c.profile_id = ? AND c.deleted_at IS NULL GROUP BY c.id`,
    );
    this.selectOneCollectionProgress = db.prepare(
      `${progressSelect} WHERE c.id = ? AND c.profile_id = ? GROUP BY c.id`,
    );
    // What makes a second adoption a no-op: at most one LIVE collection per
    // suggested list per profile (migration 072's partial unique index).
    this.selectAdoptedCollection = db.prepare(
      `SELECT ${COLLECTION_COLUMNS} FROM library_collections
        WHERE profile_id = ? AND suggested_id = ? AND deleted_at IS NULL`,
    );
    this.updateCollectionFields = db.prepare(
      `UPDATE library_collections SET name = ?, description = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.touchCollection = db.prepare(
      `UPDATE library_collections SET updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markCollectionDeleted = db.prepare(
      `UPDATE library_collections SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markCollectionRestored = db.prepare(
      `UPDATE library_collections SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );

    // The collection's contents in the user's order. A soft-deleted item is
    // filtered out here while its link row stays where it is, so restoring the
    // item puts it back in the place the user had it — `HabitStore`'s soft
    // delete, applied to a link.
    this.selectLinkItems = db.prepare(
      `SELECT ${JOINED_ITEM_COLUMNS}
         FROM library_items i
         JOIN library_collection_items l ON l.item_id = i.id
        WHERE l.collection_id = ? AND ${liveItems}
        ORDER BY l.rank, l.id`,
    );
    this.selectLinks = db.prepare(
      `SELECT ${LINK_COLUMNS} FROM library_collection_items
        WHERE collection_id = ? ORDER BY rank, id`,
    );
    this.selectLink = db.prepare(
      `SELECT ${LINK_COLUMNS} FROM library_collection_items
        WHERE collection_id = ? AND item_id = ?`,
    );
    this.selectMaxLinkRank = db.prepare(
      `SELECT max(rank) AS maxRank FROM library_collection_items WHERE collection_id = ?`,
    );
    this.insertLink = db.prepare(
      `INSERT INTO library_collection_items
         (id, collection_id, item_id, rank, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.updateLinkRank = db.prepare(
      `UPDATE library_collection_items SET rank = ?, updated_at = ?
        WHERE collection_id = ? AND item_id = ?`,
    );
    this.deleteLink = db.prepare(
      `DELETE FROM library_collection_items WHERE collection_id = ? AND item_id = ?`,
    );
    this.selectLinksForExport = db.prepare(
      `SELECT l.id AS id, l.collection_id AS collection_id, l.item_id AS item_id,
              l.rank AS rank, l.created_at AS created_at, l.updated_at AS updated_at
         FROM library_collection_items l
         JOIN library_collections c ON c.id = l.collection_id
         JOIN library_items i ON i.id = l.item_id
        WHERE c.profile_id = ? AND c.deleted_at IS NULL AND ${liveItems}
        ORDER BY l.id`,
    );

    // `importData`'s wipe: children BEFORE parents, in this order, and never
    // leaning on `ON DELETE CASCADE` to reach a row (`RESTORE_WIPE_TABLES`' rule,
    // restated for the ONE path that replaces a profile's library).
    this.wipeLinks = db.prepare(
      `DELETE FROM library_collection_items
        WHERE collection_id IN (SELECT id FROM library_collections WHERE profile_id = ?)`,
    );
    this.wipeCovers = db.prepare(
      `DELETE FROM library_item_covers
        WHERE item_id IN (SELECT id FROM library_items WHERE profile_id = ?)`,
    );
    this.wipePasses = db.prepare(
      `DELETE FROM library_passes
        WHERE item_id IN (SELECT id FROM library_items WHERE profile_id = ?)`,
    );
    this.wipeThoughts = db.prepare(
      `DELETE FROM library_thoughts
        WHERE item_id IN (SELECT id FROM library_items WHERE profile_id = ?)`,
    );
    this.wipeCollections = db.prepare(
      `DELETE FROM library_collections WHERE profile_id = ?`,
    );
    this.wipeItems = db.prepare(`DELETE FROM library_items WHERE profile_id = ?`);
  }

  // --- items ---------------------------------------------------------------

  /** This profile's live items, sr-Latn alphabetical (`sortLibraryItems`' own order), each carrying its cover. */
  listItems(): LibraryItemWithCover[] {
    const rows = this.selectItems.all(this.profileId) as ItemRow[];
    const covers = this.coverMap();
    return sortLibraryItems(
      rows.map((row) => this.toItem(row, covers.get(row.id) ?? null)),
      "title",
    );
  }

  /** One live item in this profile, or throws. */
  getItem(id: string): LibraryItemWithCover {
    return this.toItem(this.requireItemRow(id), this.toCoverOrNull(id));
  }

  /** Inserts a work and returns the stored row. An absent `status` is `planned` — a work added is a work not yet started. */
  createItem(input: CreateLibraryItemInput, now: string): LibraryItemWithCover {
    const validNow = validateNow(now);
    const resolved = resolveItem({
      kind: input.kind,
      title: input.title,
      originalTitle: input.originalTitle ?? null,
      creators: [...(input.creators ?? [])],
      year: input.year ?? null,
      status: input.status ?? "planned",
      rating: input.rating ?? null,
      pagesRead: input.pagesRead ?? null,
      pagesTotal: input.pagesTotal ?? null,
      season: input.season ?? null,
      episode: input.episode ?? null,
      seasonsTotal: input.seasonsTotal ?? null,
      episodesTotal: input.episodesTotal ?? null,
      tags: [...(input.tags ?? [])],
      summary: input.summary ?? null,
      wikidataId: input.wikidataId ?? null,
    });
    const id = uuidv7();
    this.runItemWrite(() => {
      this.insertItem.run(
        id, this.profileId, resolved.kind, resolved.title, resolved.originalTitle,
        serializeLibraryList(resolved.creators), resolved.year, resolved.status,
        resolved.rating, resolved.pagesRead, resolved.pagesTotal, resolved.season,
        resolved.episode, resolved.seasonsTotal, resolved.episodesTotal,
        serializeLibraryList(resolved.tags), resolved.summary, resolved.wikidataId,
        validNow, validNow,
      );
    });
    return this.getItem(id);
  }

  /**
   * Applies a partial patch to a live item. `status` and `rating` are editable
   * directly and STAND until the next PASS write, which re-derives them from the
   * pass that is then latest (`deriveLibraryStatusFromPass`).
   */
  updateItem(id: string, fields: UpdateLibraryItemFields, now: string): LibraryItemWithCover {
    const validNow = validateNow(now);
    const current = this.requireItemRow(id);
    const resolved = resolveItem({
      kind: current.kind as LibraryKind,
      title: fields.title ?? current.title,
      originalTitle:
        "originalTitle" in fields ? (fields.originalTitle ?? null) : current.original_title,
      creators: "creators" in fields ? [...(fields.creators ?? [])] : parseCreators(current),
      year: "year" in fields ? (fields.year ?? null) : current.year,
      status: fields.status ?? (current.status as LibraryStatus),
      rating: "rating" in fields ? (fields.rating ?? null) : current.rating,
      pagesRead: "pagesRead" in fields ? (fields.pagesRead ?? null) : current.pages_read,
      pagesTotal: "pagesTotal" in fields ? (fields.pagesTotal ?? null) : current.pages_total,
      season: "season" in fields ? (fields.season ?? null) : current.season,
      episode: "episode" in fields ? (fields.episode ?? null) : current.episode,
      seasonsTotal:
        "seasonsTotal" in fields ? (fields.seasonsTotal ?? null) : current.seasons_total,
      episodesTotal:
        "episodesTotal" in fields ? (fields.episodesTotal ?? null) : current.episodes_total,
      tags: "tags" in fields ? [...(fields.tags ?? [])] : parseTags(current),
      summary: "summary" in fields ? (fields.summary ?? null) : current.summary,
      wikidataId: "wikidataId" in fields ? (fields.wikidataId ?? null) : current.wikidata_id,
    });
    this.runItemWrite(() => {
      this.updateItemFields.run(
        resolved.title, resolved.originalTitle, serializeLibraryList(resolved.creators),
        resolved.year, resolved.status, resolved.rating, resolved.pagesRead,
        resolved.pagesTotal, resolved.season, resolved.episode, resolved.seasonsTotal,
        resolved.episodesTotal, serializeLibraryList(resolved.tags), resolved.summary,
        resolved.wikidataId, validNow, id, this.profileId,
      );
    });
    return this.getItem(id);
  }

  /** Soft-deletes a live item, reversible via `restoreItem`. Its passes, thoughts, cover and collection links are UNTOUCHED. */
  softDeleteItem(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markItemDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new LibraryNotFoundError(`No live library item "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted item, with every pass, thought, cover and collection link it had. */
  restoreItem(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markItemRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new LibraryNotFoundError(`No deleted library item "${id}" to restore in this profile.`);
    }
  }

  // --- covers --------------------------------------------------------------

  /**
   * Sets (or replaces) one item's cover. The row holds the blob's INDEX — name,
   * MIME, size, hash — never the bytes, which main writes into its
   * content-addressed store before calling this (ADR-014, `NoteAttachmentStore`'s
   * arrangement). Replacing a cover keeps the row's `createdAt`: the item has had
   * a cover since then.
   */
  setCover(itemId: string, input: LibraryCoverInput, now: string): LibraryItemWithCover {
    const validNow = validateNow(now);
    const cover = validateCover(input);
    this.requireItemRow(itemId);
    this.db.transaction(() => {
      this.upsertCover.run(
        itemId, cover.fileName, cover.mime, cover.sizeBytes, cover.sha256, validNow, validNow,
      );
      this.touchItem.run(validNow, itemId, this.profileId);
    })();
    return this.getItem(itemId);
  }

  /** Removes an item's cover. Removing one that is not there is not an error — the item ends up with no cover, which is what was asked for. */
  clearCover(itemId: string, now: string): LibraryItemWithCover {
    const validNow = validateNow(now);
    this.requireItemRow(itemId);
    this.db.transaction(() => {
      const { changes } = this.deleteCover.run(itemId);
      if (changes > 0) this.touchItem.run(validNow, itemId, this.profileId);
    })();
    return this.getItem(itemId);
  }

  // --- passes --------------------------------------------------------------

  /** One item's passes, oldest first. */
  listPasses(itemId: string): LibraryPass[] {
    this.requireItemRow(itemId);
    return (this.selectPasses.all(itemId) as PassRow[]).map(toPass);
  }

  /**
   * Records one reading or watching. The item's `status` — and its `rating`, when
   * this pass carries one — is re-derived from the pass that is then LATEST, in
   * the same transaction. See `deriveLibraryStatusFromPass` for the rule, which
   * lives in `@nexus/core` because three methods here have to answer it
   * identically.
   */
  addPass(itemId: string, input: AddLibraryPassInput, now: string): LibraryPass {
    const validNow = validateNow(now);
    this.requireItemRow(itemId);
    const outcome = resolvePass({
      startedOn: input.startedOn ?? null,
      finishedOn: input.finishedOn ?? null,
      rating: input.rating ?? null,
    });

    return this.db.transaction((): LibraryPass => {
      const id = uuidv7();
      const max = (this.selectMaxPassSeq.get(itemId) as { maxSeq: number | null }).maxSeq ?? 0;
      this.insertPass.run(
        id, itemId, max + 1, outcome.startedOn, outcome.finishedOn, outcome.rating,
        validNow, validNow,
      );
      this.applyLatestPass(itemId, validNow);
      return toPass(this.selectPass.get(id, itemId) as PassRow);
    })();
  }

  /** Patches one pass and re-derives the item from the latest one, on `addPass`' terms. */
  updatePass(
    itemId: string,
    passId: string,
    fields: UpdateLibraryPassFields,
    now: string,
  ): LibraryPass {
    const validNow = validateNow(now);
    this.requireItemRow(itemId);
    const current = this.requirePassRow(itemId, passId);
    const outcome = resolvePass({
      startedOn: "startedOn" in fields ? (fields.startedOn ?? null) : current.started_on,
      finishedOn: "finishedOn" in fields ? (fields.finishedOn ?? null) : current.finished_on,
      rating: "rating" in fields ? (fields.rating ?? null) : current.rating,
    });
    return this.db.transaction((): LibraryPass => {
      this.updatePassFields.run(
        outcome.startedOn, outcome.finishedOn, outcome.rating, validNow, passId, itemId,
      );
      this.applyLatestPass(itemId, validNow);
      return toPass(this.selectPass.get(passId, itemId) as PassRow);
    })();
  }

  /**
   * Removes one pass. The item's status and rating are re-derived from the pass
   * that is THEN latest — and with no pass left, both STAND, because „I deleted
   * the record of a reading" is not „I never read it"
   * (`deriveLibraryStatusFromPass`).
   */
  removePass(itemId: string, passId: string, now: string): void {
    const validNow = validateNow(now);
    this.requireItemRow(itemId);
    this.db.transaction(() => {
      const { changes } = this.deletePass.run(passId, itemId);
      if (changes === 0) {
        throw new LibraryNotFoundError(`No pass "${passId}" on item "${itemId}".`);
      }
      this.applyLatestPass(itemId, validNow);
    })();
  }

  // --- thoughts ------------------------------------------------------------

  /** One item's journal, oldest first, with `id` closing a day two entries share. */
  listThoughts(itemId: string): LibraryThought[] {
    this.requireItemRow(itemId);
    return (this.selectThoughts.all(itemId) as ThoughtRow[]).map(toThought);
  }

  /** Writes one dated entry. Separate from the item's `summary` on purpose: a thought is a dated observation, the summary is what the work IS. */
  addThought(itemId: string, input: AddLibraryThoughtInput, now: string): LibraryThought {
    const validNow = validateNow(now);
    this.requireItemRow(itemId);
    const entryDate = validateDay(input.date, "date");
    const text = validateThought(input.text);
    const id = uuidv7();
    this.db.transaction(() => {
      this.insertThought.run(id, itemId, entryDate, text, validNow, validNow);
      this.touchItem.run(validNow, itemId, this.profileId);
    })();
    return toThought(this.selectThought.get(id, itemId) as ThoughtRow);
  }

  /** Patches one entry. */
  updateThought(
    itemId: string,
    thoughtId: string,
    fields: UpdateLibraryThoughtFields,
    now: string,
  ): LibraryThought {
    const validNow = validateNow(now);
    this.requireItemRow(itemId);
    const current = this.requireThoughtRow(itemId, thoughtId);
    const entryDate = validateDay(fields.date ?? current.entry_date, "date");
    const text = validateThought(fields.text ?? current.text);
    this.db.transaction(() => {
      this.updateThoughtFields.run(entryDate, text, validNow, thoughtId, itemId);
      this.touchItem.run(validNow, itemId, this.profileId);
    })();
    return toThought(this.selectThought.get(thoughtId, itemId) as ThoughtRow);
  }

  /** Removes one entry. Removing one that is not there is still an error: the caller named a row, and it is not this item's row. */
  removeThought(itemId: string, thoughtId: string, now: string): void {
    const validNow = validateNow(now);
    this.requireItemRow(itemId);
    this.db.transaction(() => {
      const { changes } = this.deleteThought.run(thoughtId, itemId);
      if (changes === 0) {
        throw new LibraryNotFoundError(`No thought "${thoughtId}" on item "${itemId}".`);
      }
      this.touchItem.run(validNow, itemId, this.profileId);
    })();
  }

  // --- collections ---------------------------------------------------------

  /** This profile's live collections, sr-Latn alphabetical, each carrying its computed progress. */
  listCollections(): LibraryCollectionWithProgress[] {
    const rows = this.selectCollections.all(this.profileId) as CollectionRow[];
    const progress = this.progressMap();
    return rows
      .map((row) => toCollection(row, progress.get(row.id) ?? EMPTY_PROGRESS))
      .sort(
        (left, right) =>
          LIBRARY_COLLATOR.compare(left.name, right.name) || left.id.localeCompare(right.id),
      );
  }

  /** One live collection in this profile, or throws. */
  getCollection(id: string): LibraryCollectionWithProgress {
    const row = this.requireCollectionRow(id);
    const progress = this.selectOneCollectionProgress.get(id, this.profileId) as
      | ProgressRow
      | undefined;
    return toCollection(row, toProgress(progress));
  }

  createCollection(
    input: CreateLibraryCollectionInput,
    now: string,
  ): LibraryCollectionWithProgress {
    const validNow = validateNow(now);
    const name = validateCollectionName(input.name);
    const description = validateDescription(input.description ?? null);
    const id = uuidv7();
    this.insertCollection.run(id, this.profileId, name, description, null, validNow, validNow);
    return this.getCollection(id);
  }

  updateCollection(
    id: string,
    fields: UpdateLibraryCollectionFields,
    now: string,
  ): LibraryCollectionWithProgress {
    const validNow = validateNow(now);
    const current = this.requireCollectionRow(id);
    const name = validateCollectionName(fields.name ?? current.name);
    const description =
      "description" in fields
        ? validateDescription(fields.description ?? null)
        : current.description;
    this.updateCollectionFields.run(name, description, validNow, id, this.profileId);
    return this.getCollection(id);
  }

  /** Soft-deletes a live collection. Its LINKS stay where they are, so restoring it brings back the order the user had. */
  softDeleteCollection(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markCollectionDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new LibraryNotFoundError(`No live collection "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted collection, links and all. */
  restoreCollection(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markCollectionRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new LibraryNotFoundError(`No deleted collection "${id}" to restore in this profile.`);
    }
  }

  /** The works in one collection, in the user's order. A soft-deleted work is not among them; its link is untouched. */
  listCollectionItems(collectionId: string): LibraryItemWithCover[] {
    this.requireCollectionRow(collectionId);
    const covers = this.coverMap();
    return (this.selectLinkItems.all(collectionId) as ItemRow[]).map((row) =>
      this.toItem(row, covers.get(row.id) ?? null),
    );
  }

  /** The collection's rows themselves, in the user's order — what a reorder reads and what an export carries. */
  listCollectionLinks(collectionId: string): LibraryCollectionItem[] {
    this.requireCollectionRow(collectionId);
    return (this.selectLinks.all(collectionId) as LinkRow[]).map(toLink);
  }

  /**
   * Puts a work at the end of a collection. Idempotent: a work already in the
   * collection stays EXACTLY where the user had it (a double tap is not an error,
   * and re-adding must not move it to the bottom), and the row returned is the
   * one that is there.
   */
  addToCollection(collectionId: string, itemId: string, now: string): LibraryCollectionItem {
    const validNow = validateNow(now);
    this.requireCollectionRow(collectionId);
    this.requireItemRow(itemId);
    return this.db.transaction((): LibraryCollectionItem => {
      const existing = this.selectLink.get(collectionId, itemId) as LinkRow | undefined;
      if (existing) return toLink(existing);

      const max = (this.selectMaxLinkRank.get(collectionId) as { maxRank: string | null })
        .maxRank;
      // An append off a fractional rank is an integer increment (`rankBetween`),
      // so the key does not grow with the list.
      const rank = rankBetween(max, null) ?? FIRST_LINK_RANK;
      const id = uuidv7();
      try {
        this.insertLink.run(id, collectionId, itemId, rank, validNow, validNow);
      } catch (error) {
        // The UNIQUE (collection_id, item_id) index is the guarantee; this is the
        // sentence. Only a concurrent writer can reach it, because the read
        // above already answered the ordinary case.
        if (isUniqueConstraintViolation(error)) {
          throw new LibraryValidationError(
            `Item "${itemId}" is already in collection "${collectionId}".`,
          );
        }
        throw error;
      }
      this.touchCollection.run(validNow, collectionId, this.profileId);
      return toLink(this.selectLink.get(collectionId, itemId) as LinkRow);
    })();
  }

  /** Takes a work out of one collection. Removing one that is not there is not an error; the work's other collections are untouched. */
  removeFromCollection(collectionId: string, itemId: string, now: string): void {
    const validNow = validateNow(now);
    this.requireCollectionRow(collectionId);
    this.db.transaction(() => {
      const { changes } = this.deleteLink.run(collectionId, itemId);
      if (changes > 0) this.touchCollection.run(validNow, collectionId, this.profileId);
    })();
  }

  /**
   * Moves one work inside its collection. `beforeId`/`afterId` name the
   * neighbours it goes between — either may be null at an end — and a pair that
   * does not describe a gap (the same row twice, the wrong way round, or an id
   * that is not in this collection) is refused rather than guessed at
   * (`DashboardSetStore.move`'s contract). One row is written; nothing is
   * renumbered, which is why a move cannot exhaust anything.
   */
  moveCollectionItem(
    collectionId: string,
    itemId: string,
    beforeId: string | null,
    afterId: string | null,
    now: string,
  ): void {
    const validNow = validateNow(now);
    this.requireCollectionRow(collectionId);
    this.requireLinkRow(collectionId, itemId);
    if (beforeId === itemId || afterId === itemId) {
      throw new LibraryValidationError(
        `"beforeId" and "afterId" must name other works than the one being moved ("${itemId}").`,
      );
    }
    const rank = placeBetween(
      (siblingId) => this.requireLinkRow(collectionId, siblingId).rank,
      beforeId,
      afterId,
    );
    if (rank === null) {
      throw new LibraryValidationError(
        '"beforeId" and "afterId" do not describe a gap in this collection.',
      );
    }
    this.db.transaction(() => {
      this.updateLinkRank.run(rank, validNow, collectionId, itemId);
      this.touchCollection.run(validNow, collectionId, this.profileId);
    })();
  }

  // --- suggested collections ----------------------------------------------

  /**
   * Turns one curated list into a user collection: every entry that already
   * exists is REUSED — by Wikidata id first, then by normalised title + year +
   * kind (the brief's order) — and the rest are created as `planned`, then
   * linked in the list's order. Nothing is duplicated, and adopting the same
   * list twice is a no-op that returns the collection the first adoption made:
   * migration 072's partial unique index is what makes that a structural fact
   * rather than a promise.
   *
   * The value is revalidated here even though its type says it is valid
   * (SEC-EL-02, `HabitStore`'s own posture) — a bundled list is a constant this
   * build ships, and the check is what stops a hand-edited one from writing half
   * a collection.
   */
  adoptSuggestedCollection(suggestion: SuggestedCollectionV1, now: string): AdoptResult {
    const validNow = validateNow(now);
    const list = validateSuggestedCollection(suggestion);
    if (list === null) {
      throw new LibraryValidationError("Not a valid suggested collection (version 1).");
    }

    return this.db.transaction((): AdoptResult => {
      const existing = this.selectAdoptedCollection.get(this.profileId, list.id) as
        | CollectionRow
        | undefined;
      if (existing) {
        return {
          collection: this.getCollection(existing.id),
          created: false,
          createdItems: 0,
          reusedItems: 0,
        };
      }

      const matches = new MatchIndex(this.selectItemMatches.all(this.profileId) as MatchRow[]);
      const linked: string[] = [];
      let createdItems = 0;
      let reusedItems = 0;

      for (const entry of list.items) {
        let itemId = matches.find(entry);
        if (itemId === null) {
          itemId = this.createItemFromSuggestion(entry, validNow);
          matches.add(itemId, entry);
          createdItems += 1;
        } else {
          reusedItems += 1;
        }
        // A list may name one work twice (two entries that match one existing
        // item). The collection holds it once, at its FIRST position.
        if (!linked.includes(itemId)) linked.push(itemId);
      }

      const collectionId = uuidv7();
      this.insertCollection.run(
        collectionId, this.profileId, list.title.sr, null, list.id, validNow, validNow,
      );
      let rank: string | null = null;
      for (const itemId of linked) {
        rank = rankBetween(rank, null) ?? FIRST_LINK_RANK;
        this.insertLink.run(uuidv7(), collectionId, itemId, rank, validNow, validNow);
      }

      return {
        collection: this.getCollection(collectionId),
        created: true,
        createdItems,
        reusedItems,
      };
    })();
  }

  // --- archive -------------------------------------------------------------

  /**
   * Everything this profile's library holds, as the versioned plain value
   * `@nexus/core` validates — LIVE content only, which is the archive's own rule
   * (see `export.ts`). Rows come out in id order, so two exports of unchanged
   * data are identical.
   *
   * The COVERS travel as index rows (name, MIME, size, hash); their bytes belong
   * to main's blob store, and whoever folds this value into the profile archive
   * carries those blobs by hash exactly as the note and task attachments already
   * do.
   */
  exportData(): LibraryExportV1 {
    return {
      version: LIBRARY_EXPORT_VERSION,
      items: (this.selectItemsForExport.all(this.profileId) as ItemRow[]).map((row) =>
        // `itemFields`, NOT `toItem`: the archive's row is the item's own
        // columns, and a `cover` key here would be a field this format does not
        // have — which its own validator refuses, on purpose.
        itemFields(row),
      ),
      covers: (this.selectCoversForExport.all(this.profileId) as CoverRow[]).map(toCover),
      passes: (this.selectPassesForExport.all(this.profileId) as PassRow[]).map(toPass),
      thoughts: (this.selectThoughtsForExport.all(this.profileId) as ThoughtRow[]).map(toThought),
      collections: (this.selectCollectionsForExport.all(this.profileId) as CollectionRow[]).map(
        toCollectionRow,
      ),
      collectionItems: (this.selectLinksForExport.all(this.profileId) as LinkRow[]).map(toLink),
    };
  }

  /**
   * REPLACES this profile's library with `value`, in one transaction, or writes
   * nothing at all. The whole value is validated first
   * (`validateLibraryExport`) — shapes, bounds, progress against kind, and every
   * reference between the six tables — so the write path never half-validates.
   * An unknown `version` is refused by NAME rather than as „not valid", because
   * the caller opened a file some other build wrote.
   *
   * Replacement rather than merge is the archive's semantics: the value IS the
   * whole of a profile's library, and a merge could not express a deletion. Rows
   * are written with THIS store's profile id, never the value's
   * (`RestoreStore`'s R4) — while the value's ROW IDS are reused, because every
   * link in it points at them. That is the same constraint every other module's
   * archive carries: a value is one profile's library, restored onto the profile
   * it came from, and two profiles on one machine share the id space.
   */
  importData(value: unknown): LibraryImportCounts {
    const version = libraryExportVersion(value);
    if (version !== LIBRARY_EXPORT_VERSION) {
      throw new LibraryValidationError(
        `Library export version ${version ?? "?"} is not supported; this build imports ` +
          `version ${LIBRARY_EXPORT_VERSION}.`,
      );
    }
    const parsed = validateLibraryExport(value);
    if (parsed === null) {
      throw new LibraryValidationError("The library export value is not valid.");
    }

    this.db.transaction(() => {
      this.wipeLinks.run(this.profileId);
      this.wipeCovers.run(this.profileId);
      this.wipePasses.run(this.profileId);
      this.wipeThoughts.run(this.profileId);
      this.wipeCollections.run(this.profileId);
      this.wipeItems.run(this.profileId);

      for (const item of parsed.items) {
        this.insertItem.run(
          item.id, this.profileId, item.kind, item.title, item.originalTitle,
          serializeLibraryList(item.creators), item.year, item.status, item.rating,
          item.pagesRead, item.pagesTotal, item.season, item.episode, item.seasonsTotal,
          item.episodesTotal, serializeLibraryList(item.tags), item.summary, item.wikidataId,
          item.createdAt, item.updatedAt,
        );
      }
      for (const cover of parsed.covers) {
        this.upsertCover.run(
          cover.itemId, cover.fileName, cover.mime, cover.sizeBytes, cover.sha256,
          cover.createdAt, cover.updatedAt,
        );
      }
      for (const pass of parsed.passes) {
        this.insertPass.run(
          pass.id, pass.itemId, pass.seq, pass.startedOn, pass.finishedOn, pass.rating,
          pass.createdAt, pass.updatedAt,
        );
      }
      for (const thought of parsed.thoughts) {
        this.insertThought.run(
          thought.id, thought.itemId, thought.entryDate, thought.text, thought.createdAt,
          thought.updatedAt,
        );
      }
      for (const collection of parsed.collections) {
        this.insertCollection.run(
          collection.id, this.profileId, collection.name, collection.description,
          collection.suggestedId, collection.createdAt, collection.updatedAt,
        );
      }
      for (const link of parsed.collectionItems) {
        this.insertLink.run(
          link.id, link.collectionId, link.itemId, link.rank, link.createdAt, link.updatedAt,
        );
      }
    })();

    return {
      items: parsed.items.length,
      covers: parsed.covers.length,
      passes: parsed.passes.length,
      thoughts: parsed.thoughts.length,
      collections: parsed.collections.length,
      collectionItems: parsed.collectionItems.length,
    };
  }

  // --- internals -----------------------------------------------------------

  /** Reads a live item row in this profile or throws — the gate every item statement and every child write passes. */
  private requireItemRow(id: string): ItemRow {
    const row = this.selectItem.get(id, this.profileId) as ItemRow | undefined;
    if (!row) {
      throw new LibraryNotFoundError(`No live library item "${id}" in this profile.`);
    }
    return row;
  }

  private requireCollectionRow(id: string): CollectionRow {
    const row = this.selectCollection.get(id, this.profileId) as CollectionRow | undefined;
    if (!row) {
      throw new LibraryNotFoundError(`No live library collection "${id}" in this profile.`);
    }
    return row;
  }

  private requirePassRow(itemId: string, passId: string): PassRow {
    const row = this.selectPass.get(passId, itemId) as PassRow | undefined;
    if (!row) {
      throw new LibraryNotFoundError(`No pass "${passId}" on item "${itemId}".`);
    }
    return row;
  }

  private requireThoughtRow(itemId: string, thoughtId: string): ThoughtRow {
    const row = this.selectThought.get(thoughtId, itemId) as ThoughtRow | undefined;
    if (!row) {
      throw new LibraryNotFoundError(`No thought "${thoughtId}" on item "${itemId}".`);
    }
    return row;
  }

  private requireLinkRow(collectionId: string, itemId: string): LinkRow {
    const row = this.selectLink.get(collectionId, itemId) as LinkRow | undefined;
    if (!row) {
      throw new LibraryNotFoundError(`Item "${itemId}" is not in collection "${collectionId}".`);
    }
    return row;
  }

  /**
   * Re-reads the pass that is now latest and writes its consequence onto the
   * item: `status` and `rating` (both `@nexus/core`'s rules) and the item's
   * `updated_at`, because the work was touched.
   */
  private applyLatestPass(itemId: string, now: string): void {
    const current = this.requireItemRow(itemId);
    const latestRow = this.selectLatestPass.get(itemId) as PassRow | undefined;
    const latest: LibraryPassOutcome | null = latestRow
      ? {
          startedOn: latestRow.started_on,
          finishedOn: latestRow.finished_on,
          rating: latestRow.rating,
        }
      : null;
    const status = deriveLibraryStatusFromPass(latest, current.status as LibraryStatus);
    const rating = deriveLibraryRatingFromPass(latest, current.rating);
    this.updateItemDerived.run(status, rating, now, itemId, this.profileId);
  }

  /** Creates one item from a suggestion entry — `planned`, in Serbian, with the English title kept as the original where the two differ. */
  private createItemFromSuggestion(entry: SuggestedCollectionItemV1, now: string): string {
    const id = uuidv7();
    const originalTitle = entry.title.en === entry.title.sr ? null : entry.title.en;
    this.insertItem.run(
      id, this.profileId, entry.kind, entry.title.sr, originalTitle,
      serializeLibraryList([...(entry.creators ?? [])]), entry.year ?? null, "planned",
      null, null, null, null, null, null, null, serializeLibraryList([]), null,
      entry.wikidataId, now, now,
    );
    return id;
  }

  /** Translates the UNIQUE indexes no CHECK can state into sentences (`isUniqueConstraintViolation`'s whole job). */
  private runItemWrite(write: () => void): void {
    try {
      write();
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new LibraryValidationError(
          "Another live item in this profile already carries that Wikidata id.",
        );
      }
      throw error;
    }
  }

  private toItem(row: ItemRow, cover: LibraryCover | null): LibraryItemWithCover {
    return { ...itemFields(row), cover };
  }

  private toCoverOrNull(itemId: string): LibraryCover | null {
    const row = this.selectCover.get(itemId) as CoverRow | undefined;
    return row ? toCover(row) : null;
  }

  /** One query for the profile's covers, keyed by item — the shape that keeps a list of a hundred items at two queries. */
  private coverMap(): Map<string, LibraryCover> {
    const rows = this.selectCoversForProfile.all(this.profileId) as CoverRow[];
    return new Map(rows.map((row) => [row.item_id, toCover(row)]));
  }

  private progressMap(): Map<string, LibraryCollectionProgress> {
    const rows = this.selectCollectionProgress.all(this.profileId) as ProgressRow[];
    return new Map(rows.map((row) => [row.collection_id, toProgress(row)]));
  }
}

/** A collection whose query answered nothing — the progress map's fallback. */
const EMPTY_PROGRESS: LibraryCollectionProgress = { done: 0, total: 0 };

/** `rankBetween(null, null)`'s answer: where the first row of a scope starts. */
const FIRST_LINK_RANK = rankBetween(null, null) ?? "i0";

/**
 * The index an adoption matches against: this profile's live items, answerable
 * by Wikidata id FIRST and by normalised title + year + kind second (the brief's
 * order). Both the item's title AND its original title are keyed, so a user who
 * logged „Rat i mir" and a user who logged „War and Peace" both match a list that
 * names either.
 */
class MatchIndex {
  private readonly byWikidata = new Map<string, string>();
  private readonly byKey = new Map<string, string>();

  constructor(rows: readonly MatchRow[]) {
    for (const row of rows) {
      if (row.wikidata_id !== null) this.byWikidata.set(row.wikidata_id, row.id);
      for (const title of [row.title, row.original_title]) {
        if (title === null) continue;
        const key = matchKey({ kind: row.kind, title, year: row.year });
        if (key !== null) this.byKey.set(key, row.id);
      }
    }
  }

  find(entry: SuggestedCollectionItemV1): string | null {
    const byId = this.byWikidata.get(entry.wikidataId);
    if (byId !== undefined) return byId;
    for (const title of [entry.title.sr, entry.title.en]) {
      const key = matchKey({ kind: entry.kind, title, year: entry.year ?? null });
      const found = key === null ? undefined : this.byKey.get(key);
      if (found !== undefined) return found;
    }
    return null;
  }

  /** Registers a just-created item, so a list naming it twice links it once. */
  add(itemId: string, entry: SuggestedCollectionItemV1): void {
    this.byWikidata.set(entry.wikidataId, itemId);
    for (const title of [entry.title.sr, entry.title.en]) {
      const key = matchKey({ kind: entry.kind, title, year: entry.year ?? null });
      if (key !== null) this.byKey.set(key, itemId);
    }
  }
}

/** One work's match key, or null when its title holds nothing to match on (`titleMatchKey`'s own rule). */
function matchKey(part: { kind: string; title: string; year: number | null }): string | null {
  const title = titleMatchKey(part.title);
  return title === null ? null : `${part.kind}\u001f${title}\u001f${part.year ?? ""}`;
}

function itemFields(row: ItemRow): LibraryItem {
  return {
    id: row.id,
    profileId: row.profile_id,
    kind: row.kind as LibraryKind,
    title: row.title,
    originalTitle: row.original_title,
    creators: parseCreators(row),
    year: row.year,
    status: row.status as LibraryStatus,
    rating: row.rating,
    pagesRead: row.pages_read,
    pagesTotal: row.pages_total,
    season: row.season,
    episode: row.episode,
    seasonsTotal: row.seasons_total,
    episodesTotal: row.episodes_total,
    tags: parseTags(row),
    summary: row.summary,
    wikidataId: row.wikidata_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Reads a stored JSON list column back. This store writes only
 * `serializeLibraryList` output, so anything that fails to validate is
 * corruption — a hand-edited file, a bad restore — rather than input to coerce,
 * and reading it as `[]` would silently un-credit an author. It throws naming
 * the row (`HabitStore.parseStoredSchedule`'s posture).
 */
function parseCreators(row: ItemRow): string[] {
  const creators = validateLibraryCreators(parseListJson(row.creators_json));
  if (creators === null) {
    throw new LibraryValidationError(
      `Library item "${row.id}" carries a stored creator list that is not valid.`,
    );
  }
  return creators;
}

function parseTags(row: ItemRow): string[] {
  const tags = validateLibraryTags(parseListJson(row.tags_json));
  if (tags === null) {
    throw new LibraryValidationError(
      `Library item "${row.id}" carries a stored tag list that is not valid.`,
    );
  }
  return tags;
}

function parseListJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toCover(row: CoverRow): LibraryCover {
  return {
    itemId: row.item_id,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPass(row: PassRow): LibraryPass {
  return {
    id: row.id,
    itemId: row.item_id,
    seq: row.seq,
    startedOn: row.started_on,
    finishedOn: row.finished_on,
    rating: row.rating,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toThought(row: ThoughtRow): LibraryThought {
  return {
    id: row.id,
    itemId: row.item_id,
    entryDate: row.entry_date,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCollectionRow(row: CollectionRow): LibraryCollection {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    description: row.description,
    suggestedId: row.suggested_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCollection(
  row: CollectionRow,
  progress: LibraryCollectionProgress,
): LibraryCollectionWithProgress {
  return { ...toCollectionRow(row), progress };
}

function toProgress(row: ProgressRow | undefined): LibraryCollectionProgress {
  return row ? { done: row.done, total: row.total } : EMPTY_PROGRESS;
}

function toLink(row: LinkRow): LibraryCollectionItem {
  return {
    id: row.id,
    collectionId: row.collection_id,
    itemId: row.item_id,
    rank: row.rank,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** An item's own fields, with the ones the ROW rather than the caller decides already resolved. */
interface ResolvedItem extends LibraryProgress {
  kind: LibraryKind;
  title: string;
  originalTitle: string | null;
  creators: string[];
  year: number | null;
  status: LibraryStatus;
  rating: number | null;
  tags: string[];
  summary: string | null;
  wikidataId: string | null;
}

/** How one kind is named in a refusal, so a message reads „not a field a film has" rather than naming an enum member. */
const KIND_LABELS: Readonly<Record<LibraryKind, string>> = {
  book: "book",
  film: "film",
  series: "series",
};

/** The total a count is bounded by, for the „greater than its total" sentence. */
const TOTAL_OF: Readonly<Partial<Record<LibraryProgressField, LibraryProgressField>>> = {
  pagesRead: "pagesTotal",
  season: "seasonsTotal",
  episode: "episodesTotal",
};

/**
 * Validates and resolves a whole item's fields — the ONE place every refusal
 * lives, so `createItem` and `updateItem` cannot drift on what a work is allowed
 * to be (`HabitStore.resolve`'s arrangement).
 */
function resolveItem(fields: ResolvedItem): ResolvedItem {
  const title = validateTitle(fields.title, "title");
  const originalTitle =
    fields.originalTitle === null ? null : validateTitle(fields.originalTitle, "originalTitle");
  const creators = validateLibraryCreators(fields.creators);
  if (creators === null) {
    throw new LibraryValidationError(
      '"creators" must be at most 20 names of 1-120 characters each.',
    );
  }
  const tags = validateLibraryTags(fields.tags);
  if (tags === null) {
    throw new LibraryValidationError('"tags" must be at most 20 tags of 1-40 characters each.');
  }
  if (fields.year !== null && !isLibraryYear(fields.year)) {
    throw new LibraryValidationError('"year" must be a whole year between 1 and 9999.');
  }
  if (!isLibraryStatus(fields.status)) {
    throw new LibraryValidationError(
      '"status" must be one of planned, in-progress, done, dropped.',
    );
  }
  if (fields.rating !== null && !isLibraryRating(fields.rating)) {
    throw new LibraryValidationError('"rating" must be a whole number between 1 and 10.');
  }
  if (fields.wikidataId !== null && !isWikidataId(fields.wikidataId)) {
    throw new LibraryValidationError('"wikidataId" must be a Wikidata id of the form Q123.');
  }
  // A blank summary collapses to null: clearing the field clears the column.
  const summary =
    fields.summary === null || fields.summary.trim().length === 0
      ? null
      : validateSummary(fields.summary);

  const progress: LibraryProgress = {
    pagesRead: validateProgressCount(fields.pagesRead, "pagesRead", true),
    pagesTotal: validateProgressCount(fields.pagesTotal, "pagesTotal", false),
    season: validateProgressCount(fields.season, "season", false),
    episode: validateProgressCount(fields.episode, "episode", false),
    seasonsTotal: validateProgressCount(fields.seasonsTotal, "seasonsTotal", false),
    episodesTotal: validateProgressCount(fields.episodesTotal, "episodesTotal", false),
  };
  for (const field of validateLibraryProgress(fields.kind, progress)) {
    const total = TOTAL_OF[field];
    const past =
      total !== undefined &&
      progress[field] !== null &&
      progress[total] !== null &&
      (progress[field] as number) > (progress[total] as number);
    throw new LibraryValidationError(
      past
        ? `"${field}" must not be greater than "${total}".`
        : `"${field}" is not a field a ${KIND_LABELS[fields.kind]} has.`,
    );
  }

  return {
    ...progress,
    kind: fields.kind,
    title,
    originalTitle,
    creators,
    year: fields.year,
    status: fields.status,
    rating: fields.rating,
    tags,
    summary,
    wikidataId: fields.wikidataId,
  };
}

/** A pass's three fields, validated and resolved — `addPass` and `updatePass`'s one gate. */
function resolvePass(fields: LibraryPassOutcome): LibraryPassOutcome {
  const startedOn = validateDay(fields.startedOn, "startedOn");
  const finishedOn = validateDay(fields.finishedOn, "finishedOn");
  if (startedOn !== null && finishedOn !== null && startedOn > finishedOn) {
    throw new LibraryValidationError('"startedOn" must not be after "finishedOn".');
  }
  if (fields.rating !== null && !isLibraryRating(fields.rating)) {
    throw new LibraryValidationError('"rating" must be a whole number between 1 and 10.');
  }
  return { startedOn, finishedOn, rating: fields.rating };
}

function validateCover(input: LibraryCoverInput): LibraryCoverInput {
  const fileName = input.fileName.trim();
  if (
    fileName.length === 0 ||
    fileName.length > MAX_FILE_NAME_LENGTH ||
    fileName.includes("/") ||
    fileName.includes("\\")
  ) {
    throw new LibraryValidationError(
      `"fileName" must be 1-${MAX_FILE_NAME_LENGTH} characters and contain no path separator.`,
    );
  }
  if (input.mime.length > MAX_MIME_LENGTH || !MIME_PATTERN.test(input.mime)) {
    throw new LibraryValidationError('"mime" must be a MIME type such as image/jpeg.');
  }
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_LIBRARY_COVER_BYTES
  ) {
    throw new LibraryValidationError(
      `"sizeBytes" must be a positive integer of at most ${MAX_LIBRARY_COVER_BYTES} bytes.`,
    );
  }
  if (!SHA256_PATTERN.test(input.sha256)) {
    throw new LibraryValidationError('"sha256" must be a 64-character lower-case hex digest.');
  }
  return { ...input, fileName };
}

function validateTitle(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > LIBRARY_MAX_TITLE_LENGTH) {
    throw new LibraryValidationError(
      `"${field}" must be 1-${LIBRARY_MAX_TITLE_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateSummary(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > LIBRARY_MAX_SUMMARY_LENGTH) {
    throw new LibraryValidationError(
      `"summary" must be at most ${LIBRARY_MAX_SUMMARY_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateThought(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > LIBRARY_MAX_THOUGHT_LENGTH) {
    throw new LibraryValidationError(
      `"text" must be 1-${LIBRARY_MAX_THOUGHT_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateCollectionName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > LIBRARY_MAX_COLLECTION_NAME_LENGTH) {
    throw new LibraryValidationError(
      `"name" must be 1-${LIBRARY_MAX_COLLECTION_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/** A blank description collapses to null — clearing the field clears the column (`HabitStore.validateUnit`'s rule). */
function validateDescription(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH) {
    throw new LibraryValidationError(
      `"description" must be at most ${LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH} ` +
        "characters after trimming.",
    );
  }
  return trimmed;
}

/** A progress count's RANGE, which is the store's own refusal — the cross-field rule is `@nexus/core`'s. */
function validateProgressCount(
  value: number | null,
  field: LibraryProgressField,
  allowZero: boolean,
): number | null {
  if (value === null) return null;
  const ok = allowZero ? isLibraryReadPages(value) : isLibraryCount(value);
  if (!ok) {
    throw new LibraryValidationError(
      allowZero
        ? `"${field}" must be a whole number between 0 and 100000.`
        : `"${field}" must be a whole number between 1 and 100000.`,
    );
  }
  return value;
}

function validateDay(value: string | null, field: string): string | null {
  if (value === null) return null;
  if (!isLibraryDay(value)) {
    throw new LibraryValidationError(`"${field}" must be a real bare date (YYYY-MM-DD).`);
  }
  return value;
}

function validateNow(value: string): string {
  if (!isLibraryTimestamp(value)) {
    throw new LibraryValidationError('"now" must be an ISO-8601 date-time.');
  }
  return value;
}

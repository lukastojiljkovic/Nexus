import type Database from "better-sqlite3-multiple-ciphers";
import {
  bytesToBase64url,
  decodeRowState,
  encodeRowState,
  formatHlc,
  hlcSend,
  hlcZero,
  isJsonObject,
  parseHlc,
  parseJsonValue,
  type Hlc,
  type JsonValue,
  type RowState,
} from "@nexus/sync-crypto";
import { classify, collections, sweepRow, type SyncCollection } from "@nexus/sync";
import { uuidv7 } from "../ids.js";

/**
 * The SQLite half of ADR-083's change journal: it reads the dirt migration 063's
 * triggers recorded, resolves each entry against the row it names, and leaves a
 * stamped `RowState` behind for the push to seal.
 *
 * The pure half — what a row projects to and which of its fields actually
 * changed — is `@nexus/sync`'s `sweepRow`, which has no database in it and runs
 * unmodified in a browser tab. Everything here is the part that genuinely needs
 * SQLite: reading a row by an object id that may be a natural key, remembering
 * what was last sealed, and doing all of it in one transaction with the journal
 * entry that caused it.
 *
 * **Why the whole sweep is one transaction.** Step five writes `sync_row_state`
 * and step six deletes the journal entry. A crash between them in either order
 * is a defect: delete-then-crash loses the change for good, write-then-crash
 * leaves an entry that will be resolved again — and only the second is
 * survivable, which is why they share a transaction and why the dirty set is
 * safe to re-resolve.
 *
 * **Blobs travel as base64url.** `note_updates.update_blob` and
 * `note_versions.snapshot` are the two BLOB columns in the synced schema, and a
 * field map is JSON. The conversion happens here rather than in `@nexus/sync`
 * because it is a fact about SQLite's type system; the apply side reverses it
 * from the same column types.
 */

/** One object the sweep resolved into something worth pushing. */
export interface SweptObject {
  readonly collection: string;
  readonly objectId: string;
  readonly state: RowState;
}

/** The journal, the shadow state, and the clock that stamps them. */
export class SyncJournal {
  private readonly db: Database.Database;
  private readonly columnCache = new Map<string, readonly string[]>();
  private readonly readCache = new Map<string, Database.Statement>();

  private readonly metaRead: Database.Statement;
  private readonly metaWrite: Database.Statement;
  private readonly journalTake: Database.Statement;
  private readonly journalCount: Database.Statement;
  private readonly journalDrop: Database.Statement;
  private readonly journalForget: Database.Statement;
  private readonly journalClear: Database.Statement;
  private readonly stateRead: Database.Statement;
  private readonly stateWrite: Database.Statement;
  private readonly stateForget: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    // Prepared once, on this store's usual terms. A sweep resolves up to
    // `limit` entries inside one transaction, and re-compiling the same four
    // statements for every one of them is work no row asked for.
    this.metaRead = db.prepare("SELECT value FROM meta WHERE key = ?");
    this.metaWrite = db.prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );
    this.journalTake = db.prepare(
      `SELECT collection, object_id FROM sync_journal
        WHERE profile_id = ? ORDER BY collection, object_id LIMIT ?`,
    );
    this.journalCount = db.prepare("SELECT count(*) AS n FROM sync_journal WHERE profile_id = ?");
    this.journalDrop = db.prepare(
      "DELETE FROM sync_journal WHERE profile_id = ? AND collection = ? AND object_id = ?",
    );
    this.journalForget = db.prepare("DELETE FROM sync_journal WHERE profile_id = ?");
    this.journalClear = db.prepare("DELETE FROM sync_journal");
    this.stateRead = db.prepare(
      `SELECT state_json FROM sync_row_state
        WHERE profile_id = ? AND collection = ? AND object_id = ?`,
    );
    this.stateWrite = db.prepare(
      `INSERT INTO sync_row_state (profile_id, collection, object_id, state_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (profile_id, collection, object_id) DO UPDATE SET
         state_json = excluded.state_json,
         updated_at = excluded.updated_at`,
    );
    this.stateForget = db.prepare("DELETE FROM sync_row_state WHERE profile_id = ?");
  }

  /** Whether migration 063's triggers are recording anything at all. */
  isEnabled(): boolean {
    return this.meta(JOURNAL_FLAG) === "1";
  }

  /**
   * Turns journaling on or off.
   *
   * Switching ON enqueues every object of `profileIds` in the same transaction
   * as the flag, because the triggers only see writes made after the flag is
   * set and everything already in the file is, from the server's point of view,
   * a change it has never been told about. Only the profiles named are enqueued:
   * a profile the user keeps local has no content key on the server, so
   * journaling it would be work whose product could never be sent.
   *
   * Switching OFF empties the journal but **keeps `sync_row_state`**. That table
   * is a baseline, not a queue: on a later re-enable the sweeper diffs against
   * it and stamps only what really changed in between, instead of restamping the
   * user's whole database and beating every concurrent edit made elsewhere.
   */
  setEnabled(enabled: boolean, profileIds: readonly string[] = []): void {
    this.db.transaction(() => {
      this.metaWrite.run(JOURNAL_FLAG, enabled ? "1" : "0");
      if (!enabled) {
        this.journalClear.run();
        return;
      }
      for (const profileId of profileIds) this.enqueueProfile(profileId);
    })();
  }

  /** How many objects of this profile are waiting to be resolved. */
  pendingCount(profileId: string): number {
    return (this.journalCount.get(profileId) as { n: number }).n;
  }

  /**
   * Drops everything this device remembers about one profile's sync state —
   * both the queue and the baseline. For a profile that stops syncing entirely,
   * where keeping the baseline would be keeping a second copy of data whose
   * whole point is that it does not leave this machine.
   */
  forget(profileId: string): void {
    this.db.transaction(() => {
      this.journalForget.run(profileId);
      this.stateForget.run(profileId);
    })();
  }

  /**
   * Resolves up to `limit` of this profile's journal entries and returns the
   * ones that turned out to say something. An entry whose row is unchanged
   * produces nothing at all and is still consumed — that is the point of the
   * diff, and it is what stops a bulk re-save beating a real edit made a second
   * earlier on another device.
   */
  sweep(profileId: string, now: string, limit = 500): SweptObject[] {
    return this.db.transaction((): SweptObject[] => {
      const entries = this.journalTake.all(profileId, limit) as {
        collection: string;
        object_id: string;
      }[];
      if (entries.length === 0) return [];

      const nowMs = Date.parse(now);
      if (!Number.isFinite(nowMs)) {
        throw new TypeError(`Sweep needs an ISO timestamp, got ${JSON.stringify(now)}.`);
      }
      const nodeId = this.nodeId();
      let clock = this.readClock(nodeId);
      const swept: SweptObject[] = [];

      for (const entry of entries) {
        const collection = classify(entry.collection);
        // A collection this build no longer carries. The map is the current
        // truth and the entry can never be pushed, so it is discarded rather
        // than left to fail forever — the alternative is a queue that never
        // drains again after a table is retired.
        if (collection === undefined || collection.kind !== "collection") {
          this.journalDrop.run(profileId, entry.collection, entry.object_id);
          continue;
        }

        clock = hlcSend(clock, nowMs);
        const next = sweepRow({
          collection,
          columns: this.columnsOf(collection.table),
          row: this.readRow(collection, profileId, entry.object_id),
          previous: this.readState(profileId, entry.collection, entry.object_id),
          now: clock,
        });

        if (next !== null) {
          this.writeState(profileId, entry.collection, entry.object_id, next, now);
          swept.push({ collection: entry.collection, objectId: entry.object_id, state: next });
        }
        this.journalDrop.run(profileId, entry.collection, entry.object_id);
      }

      this.writeClock(clock);
      return swept;
    })();
  }

  /** What this device last sealed or merged for one object. */
  readState(profileId: string, collection: string, objectId: string): RowState | null {
    const row = this.stateRead.get(profileId, collection, objectId) as
      | { state_json: string }
      | undefined;
    return row === undefined ? null : decodeState(row.state_json);
  }

  // ---------------------------------------------------------------------------

  private writeState(
    profileId: string,
    collection: string,
    objectId: string,
    state: RowState,
    now: string,
  ): void {
    this.stateWrite.run(profileId, collection, objectId, encodeState(state), now);
  }

  /** The row an entry names, with its blobs already encoded, or `null` if it is gone. */
  private readRow(
    collection: SyncCollection,
    profileId: string,
    objectId: string,
  ): Record<string, JsonValue> | null {
    const values = splitObjectId(objectId, collection);
    const scoped = this.columnsOf(collection.table).includes("profile_id");
    const row = this.readStatement(collection, scoped).get(
      ...(scoped ? [profileId, ...values] : values),
    ) as Record<string, unknown> | undefined;
    if (row === undefined) return null;

    const out: Record<string, JsonValue> = {};
    for (const [name, value] of Object.entries(row)) out[name] = jsonValue(name, value);
    return out;
  }

  private readStatement(collection: SyncCollection, scoped: boolean): Database.Statement {
    const cached = this.readCache.get(collection.table);
    if (cached !== undefined) return cached;
    // Every identifier here comes from the collection map, never from user
    // input; every value is bound.
    const predicates = [
      ...(scoped ? ["profile_id = ?"] : []),
      ...collection.identity.map((column) => `${column} = ?`),
    ];
    const statement = this.db.prepare(
      `SELECT * FROM ${collection.table} WHERE ${predicates.join(" AND ")}`,
    );
    this.readCache.set(collection.table, statement);
    return statement;
  }

  private columnsOf(table: string): readonly string[] {
    const cached = this.columnCache.get(table);
    if (cached !== undefined) return cached;
    const columns = (
      this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    ).map((column) => column.name);
    this.columnCache.set(table, columns);
    return columns;
  }

  /**
   * Marks every object of one profile dirty, which is what "this server has
   * never heard of me" looks like as a queue. Written as one statement per
   * collection rather than a read-then-insert loop so the whole enqueue is a
   * handful of index scans instead of a row per round trip.
   */
  private enqueueProfile(profileId: string): void {
    for (const entry of SYNC_COLLECTIONS) {
      const objectId = objectIdSql("", entry.identity);
      const sql =
        entry.profileVia === undefined
          ? `INSERT OR IGNORE INTO sync_journal (profile_id, collection, object_id)
               SELECT profile_id, '${entry.table}', ${objectId} FROM ${entry.table}
                WHERE profile_id = ?`
          : `INSERT OR IGNORE INTO sync_journal (profile_id, collection, object_id)
               SELECT p.profile_id, '${entry.table}', ${objectIdSql(`${entry.table}.`, entry.identity)}
                 FROM ${entry.table}
                 JOIN ${entry.profileVia.parent} p ON p.id = ${entry.table}.${entry.profileVia.key}
                WHERE p.profile_id = ?`;
      this.db.prepare(sql).run(profileId);
    }
  }

  private meta(key: string): string | null {
    const row = this.metaRead.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.metaWrite.run(key, value);
  }

  /**
   * This device's HLC node id, minted once and never again. It lives in `meta`,
   * which is device-local and never synced — two installs sharing a node id
   * would make `compareHlc`'s tie-break, which exists only for the impossible
   * case, load-bearing.
   */
  private nodeId(): string {
    const existing = this.meta(NODE_ID_KEY);
    if (existing !== null && existing !== "") return existing;
    const minted = uuidv7();
    this.setMeta(NODE_ID_KEY, minted);
    return minted;
  }

  /**
   * The clock, rebuilt around THIS device's node id rather than the one that was
   * stored. The wall clock and counter are the part that must not go backwards;
   * the node id is who we are, and if a restored file disagrees about that, we
   * are still us.
   */
  private readClock(nodeId: string): Hlc {
    const stored = this.meta(CLOCK_KEY);
    const parsed = stored === null ? null : parseHlc(stored);
    if (parsed === null) return hlcZero(nodeId);
    return { wallMs: parsed.wallMs, counter: parsed.counter, nodeId };
  }

  private writeClock(clock: Hlc): void {
    this.setMeta(CLOCK_KEY, formatHlc(clock));
  }
}

/** The `meta` key migration 063's triggers read on every write. */
const JOURNAL_FLAG = "sync_journal_enabled";
const NODE_ID_KEY = "sync_node_id";
const CLOCK_KEY = "sync_hlc";

/** The ASCII unit separator, exactly the character migration 063's triggers join with. */
const UNIT_SEPARATOR = "\u001f";

/** Every collection of the live map, resolved once at module load. */
const SYNC_COLLECTIONS: readonly SyncCollection[] = collections();

/**
 * SQLite for an object id: the identity columns joined by `char(31)`, or the
 * empty string for a per-profile singleton. `prefix` qualifies the columns when
 * the statement joins another table.
 */
function objectIdSql(prefix: string, identity: readonly string[]): string {
  if (identity.length === 0) return "''";
  return identity.map((column) => `${prefix}${column}`).join(" || char(31) || ");
}

/** The identity values an object id was built from, in the map's order. */
function splitObjectId(objectId: string, collection: SyncCollection): string[] {
  if (collection.identity.length === 0) return [];
  const parts = objectId.split(UNIT_SEPARATOR);
  if (parts.length !== collection.identity.length) {
    // Only a trigger writes this table, so a mismatch means the schema and the
    // map disagree about what identifies an object — loud, because a silent
    // skip here is a row that never syncs and never says why.
    throw new TypeError(
      `Journal entry for ${collection.table} has ${String(parts.length)} identity parts, ` +
        `expected ${String(collection.identity.length)}.`,
    );
  }
  return parts;
}

/** A SQLite value as JSON. Blobs become base64url; everything else is already JSON. */
function jsonValue(name: string, value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Uint8Array) return bytesToBase64url(value);
  throw new TypeError(`Column ${name} holds a ${typeof value}, which is not a syncable value.`);
}

/**
 * `{ v, d, s }` — the version and the tombstone bit beside the encoded state
 * rather than inside it, because `decodeRowState` refuses an object carrying any
 * key but `f` and `d`, and that strictness is the whole reason it can be trusted
 * with bytes that came off a wire.
 *
 * The duplication of `d` is deliberate and is the same shape the server row will
 * have: `decodeRowState` cross-checks the envelope's tombstone against the one
 * inside the encoded state, so writing the outer copy from `state.deleted` and
 * reading it back out is a real check that the two halves of a stored row still
 * agree. Deriving the envelope from the blob it is meant to check would have
 * made that check say nothing.
 */
function encodeState(state: RowState): string {
  return JSON.stringify({ v: state.version, d: state.deleted.value, s: encodeRowState(state) });
}

function decodeState(text: string): RowState | null {
  const raw = parseJsonValue(text);
  if (!isJsonObject(raw)) return null;
  const version = raw["v"];
  const deleted = raw["d"];
  const state = raw["s"];
  if (typeof version !== "number" || typeof deleted !== "boolean") return null;
  if (!isJsonObject(state)) return null;
  return decodeRowState(state, { version, deleted });
}

import type Database from "better-sqlite3-multiple-ciphers";
import {
  base64urlToBytes,
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
import {
  classify,
  collections,
  deriveColumns,
  splitObjectId,
  sweepRow,
  UNIT_SEPARATOR,
  type SyncCollection,
} from "@nexus/sync";
import { uuidv7 } from "../ids.js";

/**
 * The SQLite half of ADR-083, in both directions: the sweep that turns a local
 * edit into a stamped `RowState` for the push to seal, and the apply that writes
 * a merged `RowState` back into the tables it came from.
 *
 * The pure halves — what a row projects to, which of its fields actually
 * changed, what a merged state's columns are — are `@nexus/sync`'s `sweepRow`
 * and `deriveColumns`, which have no database in them and run unmodified in a
 * browser tab. Everything here is the part that genuinely needs SQLite: reading
 * and writing a row by an object id that may be a natural key, remembering what
 * was last sealed or merged, and doing all of it in one transaction with the
 * journal entry that caused it.
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
 * because it is a fact about SQLite's type system, and both directions read the
 * same declared column type so neither can drift from the other.
 */

/** One object the sweep resolved into something worth pushing. */
export interface SweptObject {
  readonly collection: string;
  readonly objectId: string;
  readonly state: RowState;
}

/**
 * One object the server does not have — what `sweep` produced and no push has
 * yet landed.
 *
 * `attempts` is not telemetry. `planPush` can refuse an object outright, and the
 * server can refuse it by a rule that will not change, so without a count there
 * is no way to tell „the network was down" from „this row can never be sent" —
 * and no way to stop the second from sitting at the head of the queue for ever.
 */
export interface OwedObject {
  readonly collection: string;
  readonly objectId: string;
  /** Exactly what the sweep decided, so the push seals what was swept. */
  readonly state: RowState;
  readonly attempts: number;
}

/** One merged object waiting to be written back into the table it came from. */
export interface ApplyRequest {
  readonly collection: string;
  readonly objectId: string;
  /** `PullApplied.merged` — what this device now believes about the object. */
  readonly merged: RowState;
  /**
   * `PullApplied.changed` — the merge differs from what this device held.
   *
   * When it is false the local row is already correct and only the shadow state
   * moves. That is not an optimisation: `changed` is computed through
   * `encodeRowState`, which excludes the VERSION on purpose, so an unchanged row
   * can still carry a version the server advanced — and the version is what the
   * next push's compare-and-swap is built on. Skipping the state write for an
   * unchanged row would make every later push collide.
   */
  readonly changed: boolean;
}

export type ApplyStatus =
  /** The row and its shadow state were both written. */
  | "written"
  /** Only the shadow state moved; the local row already carried the merge. */
  | "state-only"
  /**
   * A local edit for this object is still in the journal, so the merge was
   * computed against a baseline that is no longer what this device holds.
   * Sweep, merge again, apply again — see {@link SyncJournal.apply}.
   */
  | "stale"
  /** A collection this build's map no longer carries. */
  | "unknown"
  /** SQLite refused the row. Usually a parent that has not arrived yet. */
  | "refused";

export interface ApplyOutcome {
  readonly collection: string;
  readonly objectId: string;
  readonly status: ApplyStatus;
  /** Present only for `refused`, and it is SQLite's own message. */
  readonly error?: string;
}

/** The journal, the shadow state, and the clock that stamps them. */
export class SyncJournal {
  private readonly db: Database.Database;
  private readonly columnCache = new Map<string, TableInfo>();
  private readonly readCache = new Map<string, Database.Statement>();
  private readonly writeCache = new Map<string, Database.Statement>();

  private readonly metaRead: Database.Statement;
  private readonly metaWrite: Database.Statement;
  private readonly journalTake: Database.Statement;
  private readonly journalCount: Database.Statement;
  private readonly journalHas: Database.Statement;
  private readonly journalDrop: Database.Statement;
  private readonly journalForget: Database.Statement;
  private readonly journalClear: Database.Statement;
  private readonly stateRead: Database.Statement;
  private readonly stateWrite: Database.Statement;
  private readonly stateForget: Database.Statement;
  private readonly outboxQueue: Database.Statement;
  private readonly outboxTake: Database.Statement;
  private readonly outboxDrop: Database.Statement;
  private readonly outboxFail: Database.Statement;
  private readonly outboxForget: Database.Statement;

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
    this.journalHas = db.prepare(
      "SELECT 1 AS hit FROM sync_journal WHERE profile_id = ? AND collection = ? AND object_id = ?",
    );
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
    // A re-sweep RESETS the count and clears the last outcome: the payload is a
    // new one, and how the previous version of this object was refused says
    // nothing about how this one will be. It also puts a freshly edited object
    // back at the head of the queue, which is where the user would expect it.
    this.outboxQueue = db.prepare(
      `INSERT INTO sync_outbox (profile_id, collection, object_id, queued_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (profile_id, collection, object_id) DO UPDATE SET
         queued_at = excluded.queued_at, attempts = 0, last_code = NULL, last_message = NULL`,
    );
    // An INNER JOIN, and it is safe because `sweep` writes both rows in one
    // transaction: an outbox row without a state cannot be created. Ordered by
    // `attempts` first so an object that can never be sent sinks to the back
    // instead of occupying the limit for ever; the last two columns only make the
    // order total, so a page is the same page twice.
    this.outboxTake = db.prepare(
      `SELECT o.collection, o.object_id, o.attempts, s.state_json
         FROM sync_outbox o
         JOIN sync_row_state s
           ON s.profile_id = o.profile_id
          AND s.collection = o.collection
          AND s.object_id  = o.object_id
        WHERE o.profile_id = ?
        ORDER BY o.attempts, o.queued_at, o.collection, o.object_id
        LIMIT ?`,
    );
    this.outboxDrop = db.prepare(
      "DELETE FROM sync_outbox WHERE profile_id = ? AND collection = ? AND object_id = ?",
    );
    this.outboxFail = db.prepare(
      `UPDATE sync_outbox SET attempts = attempts + 1, last_code = ?, last_message = ?
        WHERE profile_id = ? AND collection = ? AND object_id = ?`,
    );
    this.outboxForget = db.prepare("DELETE FROM sync_outbox WHERE profile_id = ?");
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
      this.outboxForget.run(profileId);
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
          // In the SAME transaction as the state, and that is the whole point:
          // „this object was swept" and „the server does not have it" have to be
          // one fact. Written apart, a crash between them leaves an object clean
          // locally and unsent, which no later sweep can rediscover — `sweepRow`
          // diffs against the state that was just written and answers `null`.
          this.outboxQueue.run(profileId, entry.collection, entry.object_id, now);
          swept.push({ collection: entry.collection, objectId: entry.object_id, state: next });
        }
        this.journalDrop.run(profileId, entry.collection, entry.object_id);
      }

      this.writeClock(clock);
      return swept;
    })();
  }

  /**
   * Writes merged rows back into the tables they came from, and records what was
   * merged. The other half of {@link sweep}, and the last step of a pull.
   *
   * Four rules, three of which are invisible from the file that would need them:
   *
   * **The row and its shadow state are ONE write.** Migration 063 puts
   * `sync_row_state` in the same SQLite file precisely so this can be true. Split
   * across two stores, a crash between them leaves a device claiming to have
   * merged something it did not apply, or applying something it will merge
   * again — and the second is not idempotent once the field stamps have moved.
   * Per object, not per batch: a savepoint each, so one row whose parent has not
   * arrived does not roll back forty that applied cleanly.
   *
   * **The apply must not echo.** Every synced table carries a 063 trigger, so
   * writing a merged row re-dirties `sync_journal`, the next sweep resolves it,
   * and the device pushes back what it just received — forever, and on both
   * devices, because the peer does the same with ours. The flag those triggers
   * read is flipped off for the duration of the transaction, which is atomic with
   * the writes and self-restoring on rollback. A per-table exemption or a marker
   * column would be a second place that has to agree with the first.
   *
   * **A dirty object is refused, not applied.** If a local edit is journaled and
   * not yet swept, `sync_row_state` still holds the pre-edit baseline; the caller
   * merged the remote row against THAT, and writing the result would erase the
   * user's edit on the device that made it, with no conflict recorded anywhere.
   * The check cannot live in the caller — `applyPull` is async and the user can
   * save a note while it awaits the AEAD — so it lives here, inside the
   * transaction, where nothing can slip between the test and the write. The
   * caller's answer to `stale` is to sweep, merge again, and apply again.
   *
   * **`profileId` scopes the write and never comes off the wire.** It is the
   * profile whose content key opened the row, so a server that re-pointed a row
   * at another profile has already failed the AEAD in `applyPull`.
   */
  apply(profileId: string, requests: readonly ApplyRequest[], now: string): ApplyOutcome[] {
    if (requests.length === 0) return [];
    return this.db.transaction((): ApplyOutcome[] => {
      const restore = this.meta(JOURNAL_FLAG) ?? "0";
      this.setMeta(JOURNAL_FLAG, "0");
      try {
        return requests.map((request) => this.applyOne(profileId, request, now));
      } finally {
        this.setMeta(JOURNAL_FLAG, restore);
      }
    })();
  }

  /**
   * What the server does not have, least-failed first.
   *
   * The push plans from THIS rather than from the sweep's return value, and the
   * difference is the whole reason the table exists: a sweep's return value lives
   * for one round, while an object stays owed across restarts until a server
   * accepts it.
   */
  owed(profileId: string, limit = 500): OwedObject[] {
    const rows = this.outboxTake.all(profileId, limit) as {
      collection: string;
      object_id: string;
      attempts: number;
      state_json: string;
    }[];
    const owed: OwedObject[] = [];
    for (const row of rows) {
      const state = decodeState(row.state_json);
      // A shadow state that will not decode is a corrupt local file, not a sync
      // condition — nothing the server does can cause it, because this column is
      // only ever written by `writeState`. It is SKIPPED rather than thrown on,
      // so one unreadable row cannot stall every round for ever, and it is left
      // in the outbox rather than deleted, so it is neither lost nor silently
      // resolved: the row is still there to be counted and reported.
      if (state === null) continue;
      owed.push({
        collection: row.collection,
        objectId: row.object_id,
        state,
        attempts: row.attempts,
      });
    }
    return owed;
  }

  /**
   * The server took it: store the version it accepted and stop owing the object.
   *
   * `next` is `PushAccepted.next` — the same fields and tombstone at `version + 1`
   * — and it must be the planner's copy rather than one recomputed here, because
   * a local state left at the observed version would push the same number twice
   * and be refused by NX001 for ever.
   *
   * One transaction, for the reason the apply path has one: a crash between the
   * two leaves either an object that will be pushed again at a version the server
   * has already stored, or one recorded as sent at a version nobody accepted.
   * There is no echo to guard against here — migration 063's triggers are on the
   * module tables, and this writes only the shadow state.
   */
  confirmPushed(
    profileId: string,
    collection: string,
    objectId: string,
    next: RowState,
    now: string,
  ): void {
    this.db.transaction(() => {
      this.writeState(profileId, collection, objectId, next, now);
      this.outboxDrop.run(profileId, collection, objectId);
    })();
  }

  /**
   * The push did not land. The object stays owed and the state is left exactly as
   * the sweep wrote it, because nothing about the object changed — only what is
   * known about the server's opinion of it.
   */
  recordPushFailure(
    profileId: string,
    collection: string,
    objectId: string,
    code: string,
    message: string | null,
  ): void {
    this.outboxFail.run(code, message, profileId, collection, objectId);
  }

  /** What this device last sealed or merged for one object. */
  readState(profileId: string, collection: string, objectId: string): RowState | null {
    const row = this.stateRead.get(profileId, collection, objectId) as
      | { state_json: string }
      | undefined;
    return row === undefined ? null : decodeState(row.state_json);
  }

  // ---------------------------------------------------------------------------

  private applyOne(profileId: string, request: ApplyRequest, now: string): ApplyOutcome {
    const { collection: name, objectId, changed } = request;
    const collection = classify(name);
    if (collection === undefined || collection.kind !== "collection") {
      return { collection: name, objectId, status: "unknown" };
    }
    if (this.journalHas.get(profileId, name, objectId) !== undefined) {
      return { collection: name, objectId, status: "stale" };
    }

    try {
      this.db.transaction(() => {
        if (changed) this.writeRow(collection, profileId, objectId, request.merged);
        this.writeState(profileId, name, objectId, request.merged, now);
      })();
    } catch (error) {
      // Reported rather than thrown: a row whose parent has not arrived yet is
      // an ordinary state of a cursor walk, and one of them must not stop the
      // batch. The message is SQLite's own, because „it was refused" without
      // saying by what is a report nobody can act on.
      return {
        collection: name,
        objectId,
        status: "refused",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return { collection: name, objectId, status: changed ? "written" : "state-only" };
  }

  /**
   * The merged state as an actual row: identity from the object id, the profile
   * from the caller, and every other column from `deriveColumns`.
   *
   * An UPSERT on the identity because an apply cannot know whether this device
   * has ever seen the object — the first pull after adopting an account is one
   * long list of rows that do not exist here, and a merge that follows an edit
   * made elsewhere is one that does. `deriveColumns` runs the coupled-CHECK
   * repair, so what arrives here is already a shape SQLite will take.
   *
   * A field naming a column this build does not have is SKIPPED, not an error: a
   * peer on a newer version legitimately sends columns this one has never heard
   * of. Nothing is lost by skipping — `projectRow` iterates the LOCAL columns, so
   * the next sweep never sees the extra field, never diffs it, and pushes it back
   * untouched with the stamp it arrived with.
   */
  private writeRow(
    collection: SyncCollection,
    profileId: string,
    objectId: string,
    state: RowState,
  ): void {
    const info = this.tableInfo(collection.table);
    const values: Record<string, SqlValue> = {};

    const identity = splitObjectId(objectId, collection);
    collection.identity.forEach((column, index) => {
      values[column] = identity[index] ?? null;
    });
    // The eight collections that reach their profile through a parent carry no
    // such column. Their parent link travelled all the same — for six of them as
    // an ordinary field, and for `note_versions` and `note_updates` inside the
    // object id, since their identity begins with it. The loop above has already
    // written it in that case, which is why this needs no branch of its own.
    if (info.types.has("profile_id")) values["profile_id"] = profileId;

    for (const [column, value] of Object.entries(deriveColumns(collection, state))) {
      const declared = info.types.get(column);
      if (declared === undefined) continue;
      values[column] = sqlValue(collection.table, column, declared, value);
    }

    const names = Object.keys(values);
    this.writeStatement(collection, names).run(names.map((column) => values[column] ?? null));
  }

  private writeStatement(collection: SyncCollection, names: readonly string[]): Database.Statement {
    // Keyed by the column list as well as the table: two rows of one collection
    // can legitimately name different columns when a peer sends a field this
    // build knows and another peer's row does not carry it.
    const key = `${collection.table}${names.join(",")}`;
    const cached = this.writeCache.get(key);
    if (cached !== undefined) return cached;

    // A per-profile singleton has no identity columns of its own; `profile_id`
    // IS its primary key, and therefore its conflict target.
    const conflict = collection.identity.length === 0 ? ["profile_id"] : collection.identity;
    const updates = names.filter((column) => !conflict.includes(column));
    // Every identifier comes from the collection map or `PRAGMA table_info`,
    // never from the wire; every value is bound.
    const statement = this.db.prepare(
      `INSERT INTO ${collection.table} (${names.join(", ")})
         VALUES (${names.map(() => "?").join(", ")})
       ON CONFLICT (${conflict.join(", ")}) DO UPDATE SET
         ${updates.map((column) => `${column} = excluded.${column}`).join(", ")}`,
    );
    this.writeCache.set(key, statement);
    return statement;
  }

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
    return this.tableInfo(table).names;
  }

  /**
   * A table's columns and their DECLARED types, read once.
   *
   * The types are what makes the blob round trip honest: `jsonValue` encodes a
   * `Uint8Array` to base64url on the way out and {@link sqlValue} decodes it on
   * the way back, and both decide from this one answer rather than from a list
   * of column names somebody would have to keep current.
   */
  private tableInfo(table: string): TableInfo {
    const cached = this.columnCache.get(table);
    if (cached !== undefined) return cached;
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
      type: string;
    }[];
    const info: TableInfo = {
      names: rows.map((column) => column.name),
      types: new Map(rows.map((column) => [column.name, column.type])),
    };
    this.columnCache.set(table, info);
    return info;
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

/** Every collection of the live map, resolved once at module load. */
const SYNC_COLLECTIONS: readonly SyncCollection[] = collections();

/**
 * SQLite for an object id: the identity columns joined by the unit separator, or
 * the empty string for a per-profile singleton. `prefix` qualifies the columns
 * when the statement joins another table.
 *
 * The code point comes from `@nexus/sync` so this half cannot drift from the
 * half that takes an object id apart. Migration 063 spells `char(31)` out
 * literally instead, and must: its triggers are in every user's file already, so
 * what they compose is history rather than a decision a constant still gets to
 * make. The two are held together by the journal tests, which write the 31 out
 * by hand and drive the real triggers — a change here reddens them at once.
 */
function objectIdSql(prefix: string, identity: readonly string[]): string {
  if (identity.length === 0) return "''";
  const separator = `char(${String(UNIT_SEPARATOR.charCodeAt(0))})`;
  return identity.map((column) => `${prefix}${column}`).join(` || ${separator} || `);
}

/** One table's columns, and what each was declared as. */
interface TableInfo {
  readonly names: readonly string[];
  readonly types: ReadonlyMap<string, string>;
}

/** What better-sqlite3 will bind. */
type SqlValue = string | number | Uint8Array | null;

/**
 * The inverse of {@link jsonValue}: a merged field as something SQLite can store.
 *
 * Three conversions, each the mirror of one the sweep made. A BLOB column takes
 * its base64url back as bytes; a boolean becomes 0 or 1, because SQLite has no
 * boolean type and better-sqlite3 refuses to bind one; everything else already
 * is what the column holds.
 *
 * An object or array THROWS rather than being stringified. A JSON column in this
 * schema holds a string — the sweep read it as a string and stamped a string —
 * so a structured value here means a peer sealed a shape this build does not
 * understand, and quietly writing `[object Object]` into the user's row is the
 * silent corruption the throw exists to prevent. It surfaces as one `refused`
 * outcome for one object, not as a failed batch.
 */
function sqlValue(table: string, column: string, declared: string, value: JsonValue): SqlValue {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    return declared.toUpperCase().includes("BLOB") ? base64urlToBytes(value) : value;
  }
  throw new TypeError(
    `${table}.${column} received a ${Array.isArray(value) ? "array" : "object"}, ` +
      `which is not a value this schema stores.`,
  );
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

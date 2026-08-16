import type Database from "better-sqlite3-multiple-ciphers";

/**
 * What this device knows about its walk of the server's log: how far it has read
 * per collection, and which objects it read and could not open.
 *
 * Both are products of the same pull, which is why they share a store, and both
 * exist for the same reason — a sync round has to be interruptible. Everything
 * `applyPull` computes lives in memory for the length of one batch; these two
 * facts have to outlive the process, or a restart re-downloads a lifetime of
 * ciphertext and silently forgets what it could not read.
 *
 * ─── The watermark is LOCAL because it is authoritative ─────────────────────
 *
 * The server has a copy — `sync_state.last_seq`, which `cursor.ts` writes — and
 * migration 001 is explicit that it is advisory: a floor a client raises, never a
 * number it obeys. Obeying it would hand a hostile server two attacks for one.
 * Rewind it and the device re-downloads everything; advance it and the device
 * SKIPS every row in between and never learns that it did. So the number that
 * decides is here, and the server's is a convenience for a device that has been
 * reinstalled.
 *
 * ─── The `max` is in the SQL, not at the call site ──────────────────────────
 *
 * A pull deliberately starts BEHIND the stored cursor: `pullWindow` subtracts
 * `PULL_OVERLAP`, because an identity column is assigned before its transaction
 * commits and two writes can take 41 and 42 and commit in the other order. That
 * makes „the number this page produced is lower than the one already stored" the
 * NORMAL case, not an error — and a store that simply assigned it would walk the
 * cursor backwards a little on every sync, re-reading a growing tail forever
 * without ever being visibly broken.
 *
 * `advanceCursor` in `@nexus/sync-transport` states the same rule as a pure
 * function, and this is not a second copy of it: it is the same rule enforced at
 * the boundary where it cannot be skipped. A caller that forgets the helper still
 * cannot lower a watermark, because there is no statement here that can.
 *
 * ─── Quarantine is not the outbox, and the CHECK says which reasons belong ──
 *
 * `sync_outbox` holds objects the SERVER does not have; this holds objects THIS
 * DEVICE could not read. The remedies are opposite — one is re-pushed, the other
 * re-fetched by key — which is why they are two tables and not one with a
 * direction column.
 *
 * Only the refusals that let the cursor MOVE PAST them land here. `no-key` does
 * not: it holds the cursor instead, so the row is already going to be served
 * again from the same watermark, and recording it would be filing „unreadable"
 * against a row that is merely waiting for a key rotation to finish. Migration
 * 066's CHECK is what makes that a refusal rather than a convention.
 */

/** One object the server served that this device could not open. */
export interface QuarantinedObject {
  readonly collection: string;
  readonly objectId: string;
  /** Where it sat in the log — evidence for a human, and the order to re-fetch in. */
  readonly seq: number;
  /** `aead-failed` is a server or a bad disk; `bad-plaintext` is a peer this build cannot parse. */
  readonly reason: "aead-failed" | "bad-plaintext";
  readonly seenAt: string;
}

export class SyncProgressStore {
  private readonly cursorRead: Database.Statement;
  private readonly cursorAll: Database.Statement;
  private readonly cursorRaise: Database.Statement;
  private readonly cursorForget: Database.Statement;
  private readonly quarantineWrite: Database.Statement;
  private readonly quarantineAll: Database.Statement;
  private readonly quarantineDrop: Database.Statement;
  private readonly quarantineForget: Database.Statement;

  constructor(db: Database.Database) {
    this.cursorRead = db.prepare(
      "SELECT last_seq FROM sync_cursor WHERE profile_id = ? AND collection = ?",
    );
    this.cursorAll = db.prepare(
      "SELECT collection, last_seq FROM sync_cursor WHERE profile_id = ? ORDER BY collection",
    );
    // `max(last_seq, excluded.last_seq)` is the whole design of this table; see
    // the header. `last_seq` unqualified inside DO UPDATE is the STORED row's.
    this.cursorRaise = db.prepare(
      `INSERT INTO sync_cursor (profile_id, collection, last_seq) VALUES (?, ?, ?)
       ON CONFLICT (profile_id, collection) DO UPDATE SET
         last_seq = max(last_seq, excluded.last_seq)`,
    );
    this.cursorForget = db.prepare("DELETE FROM sync_cursor WHERE profile_id = ?");
    this.quarantineWrite = db.prepare(
      `INSERT INTO sync_quarantine (profile_id, collection, object_id, seq, reason, seen_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id, collection, object_id) DO UPDATE SET
         seq = excluded.seq, reason = excluded.reason, seen_at = excluded.seen_at`,
    );
    this.quarantineAll = db.prepare(
      `SELECT collection, object_id, seq, reason, seen_at FROM sync_quarantine
        WHERE profile_id = ? ORDER BY collection, object_id`,
    );
    this.quarantineDrop = db.prepare(
      "DELETE FROM sync_quarantine WHERE profile_id = ? AND collection = ? AND object_id = ?",
    );
    this.quarantineForget = db.prepare("DELETE FROM sync_quarantine WHERE profile_id = ?");
  }

  /** How far this device has walked one collection. `0` for one it has never pulled. */
  cursor(profileId: string, collection: string): number {
    const row = this.cursorRead.get(profileId, collection) as { last_seq: number } | undefined;
    return row?.last_seq ?? 0;
  }

  /** Every collection this profile has a watermark for — what a round reads to start. */
  cursors(profileId: string): ReadonlyMap<string, number> {
    const rows = this.cursorAll.all(profileId) as { collection: string; last_seq: number }[];
    return new Map(rows.map((row) => [row.collection, row.last_seq]));
  }

  /**
   * Raises the watermark to `seq` if that is forward, and returns what is stored
   * either way — so a caller can see that its number was not the one kept.
   */
  advance(profileId: string, collection: string, seq: number): number {
    // Migration 066's CHECK refuses a negative, but it would happily store `1.5`
    // and every later comparison would be against a number no `seq` can equal.
    // The guard is the load-bearing one; the CHECK is the backstop.
    if (!Number.isSafeInteger(seq) || seq < 0) {
      throw new TypeError(`A sync watermark must be a whole non-negative number, got ${seq}.`);
    }
    this.cursorRaise.run(profileId, collection, seq);
    return this.cursor(profileId, collection);
  }

  /**
   * Records objects the cursor moved past unread. One row per object, so a second
   * failure updates the first rather than piling up a history nobody reads.
   */
  quarantine(profileId: string, rows: readonly QuarantinedObject[]): void {
    if (rows.length === 0) return;
    for (const row of rows) {
      this.quarantineWrite.run(
        profileId,
        row.collection,
        row.objectId,
        row.seq,
        row.reason,
        row.seenAt,
      );
    }
  }

  /** Everything this profile knows it could not read, oldest collection first. */
  quarantined(profileId: string): QuarantinedObject[] {
    const rows = this.quarantineAll.all(profileId) as {
      collection: string;
      object_id: string;
      seq: number;
      reason: "aead-failed" | "bad-plaintext";
      seen_at: string;
    }[];
    return rows.map((row) => ({
      collection: row.collection,
      objectId: row.object_id,
      seq: row.seq,
      reason: row.reason,
      seenAt: row.seen_at,
    }));
  }

  /** One object has finally been read — a key arrived, or this build understands it now. */
  release(profileId: string, collection: string, objectId: string): void {
    this.quarantineDrop.run(profileId, collection, objectId);
  }

  /** Everything this store knows about one profile, gone. */
  forget(profileId: string): void {
    this.cursorForget.run(profileId);
    this.quarantineForget.run(profileId);
  }
}

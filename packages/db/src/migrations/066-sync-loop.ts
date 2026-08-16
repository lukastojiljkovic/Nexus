import type { Migration } from "./migrations.js";

/**
 * Migration 66 — the three things a sync ROUND has to survive being interrupted.
 *
 * Everything the loop calls already exists: `planPush`, `applyPull`,
 * `SyncJournal.sweep`, `SyncJournal.apply`, and the transport. What none of them
 * can do is remember anything between two rounds, and each of these tables is one
 * fact that has to outlive the process.
 *
 * ─── `sync_cursor` — the watermark, and why it is local and AUTHORITATIVE ────
 *
 * The server has a copy: `sync_state.last_seq`, written by `cursor.ts`. It is
 * explicitly advisory. Migration 001 says the client owns the authoritative value
 * and that a server rewinding it must be harmless, which is why every read of it
 * goes through `advanceCursor` — a `max`, never an assignment. Obeying the
 * server's number instead would hand it two attacks for the price of one: rewind
 * it and a device re-downloads a lifetime of ciphertext, advance it and the device
 * SKIPS every row in between and never learns that it did.
 *
 * So the number that decides is here, and the server's copy is a convenience for a
 * device that has been reinstalled. Per collection, because that is the grain
 * `pullPage` walks and `sync_state` stores.
 *
 * ─── `sync_outbox` — the one of the three that closes a DEFECT ──────────────
 *
 * `sweep` writes the new `RowState` into `sync_row_state` and drops the journal
 * entry, and both happen before a push is even attempted. Nothing anywhere
 * recorded that the server had not got it. A push that came back `unavailable`
 * therefore left an object that was clean locally and unsent — and it would never
 * be swept again, because `sweepRow` diffs the row against `sync_row_state` and
 * returns `null` when they agree, which after the sweep they do.
 *
 * It is not data loss, which is why it could sit there unnoticed: a push seals the
 * WHOLE `RowState`, so the next edit of that object carries the missing fields
 * along with it. But an object edited once and never again — which is most objects
 * — never reaches the server at all, and nothing reports it. That is the bug.
 *
 * The row is written inside `sweep`'s OWN transaction, so „this object was swept"
 * and „the server does not have it" are one fact that cannot half-happen, and it
 * is deleted only when the server accepts. **This is deliberately not the journal
 * reused.** The two have different lifetimes and answer different questions:
 * a journal entry means „something changed here" and dies at the sweep that
 * resolves it; an outbox row means „the server does not have this" and dies at the
 * push that lands it. One table doing both could not let a sweep consume its own
 * entry.
 *
 * `attempts` and `last_code` are not telemetry. `planPush` can refuse an object
 * outright — a collection name the server's CHECK would reject, an object id over
 * 255 bytes — and those refusals are permanent client-side defects that will
 * answer the same way for ever. Without the last outcome recorded, the engine has
 * no way to tell „the network was down" from „this row can never be sent", and
 * retrying the second is a loop with a round trip in it.
 *
 * ─── `sync_quarantine` — the same durability, in the opposite direction ─────
 *
 * `applyPull` reports `quarantined`: rows the cursor MOVED PAST because retrying
 * them cannot help — the AEAD failed, or the plaintext is a shape this client
 * version cannot parse. The cursor has already advanced, so nothing will ever
 * serve them again by walking the log, and a device that only kept them in memory
 * forgets them at the next restart and never knows what it is missing.
 *
 * Separate from `sync_outbox` because the remedy is the opposite one: an outbox
 * row is re-pushed, a quarantined object is re-FETCHED by key, once the client is
 * upgraded or a human is told. `no-key` never lands here — it holds the cursor
 * instead, so the row is already going to be served again.
 *
 * ─── The cleanup trigger is REPLACED rather than joined ────────────────────
 *
 * Migration 063 created `profiles_sync_ad` to empty the two tables it added when a
 * profile goes away. Three more tables need the same treatment, and SQLite would
 * happily run a second AFTER DELETE trigger beside the first — but then „what
 * happens to sync state when a profile is deleted" would be answered in two
 * places, and the next table to be added would have a choice about which one to
 * join. One trigger, dropped and rewritten, so there is one answer.
 *
 * None of the three carries a foreign key to `profiles`, for the reason 063 gives:
 * a cascade fires the child's DELETE trigger, and a journal trigger inserting a
 * row that points at the profile being deleted turns „delete this profile" into a
 * foreign-key error.
 */
export const migration066: Migration = {
  version: 66,
  up(db) {
    db.exec(`
      CREATE TABLE sync_cursor (
        profile_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        last_seq   INTEGER NOT NULL CHECK (last_seq >= 0),
        PRIMARY KEY (profile_id, collection)
      ) WITHOUT ROWID;

      CREATE TABLE sync_outbox (
        profile_id   TEXT NOT NULL,
        collection   TEXT NOT NULL,
        object_id    TEXT NOT NULL,
        queued_at    TEXT NOT NULL,
        attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        last_code    TEXT,
        last_message TEXT,
        PRIMARY KEY (profile_id, collection, object_id)
      ) WITHOUT ROWID;

      CREATE TABLE sync_quarantine (
        profile_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        object_id  TEXT NOT NULL,
        seq        INTEGER NOT NULL CHECK (seq >= 1),
        reason     TEXT NOT NULL CHECK (reason IN ('aead-failed', 'bad-plaintext')),
        seen_at    TEXT NOT NULL,
        PRIMARY KEY (profile_id, collection, object_id)
      ) WITHOUT ROWID;
    `);

    db.exec(`
      DROP TRIGGER profiles_sync_ad;

      CREATE TRIGGER profiles_sync_ad AFTER DELETE ON profiles BEGIN
        DELETE FROM sync_journal    WHERE profile_id = old.id;
        DELETE FROM sync_row_state  WHERE profile_id = old.id;
        DELETE FROM sync_cursor     WHERE profile_id = old.id;
        DELETE FROM sync_outbox     WHERE profile_id = old.id;
        DELETE FROM sync_quarantine WHERE profile_id = old.id;
      END;
    `);
  },
};

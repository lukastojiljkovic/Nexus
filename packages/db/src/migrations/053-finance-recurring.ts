import type { Migration } from "./migrations.js";

/**
 * Migration 53 — FIN subscriptions: recurring charges (FIN slice d). Exactly the
 * attachment migration 051 planned for, built on the pieces that already exist
 * rather than on new ones.
 *
 * **`fin_recurring` is a TEMPLATE plus a SCHEDULE, and nothing else.** The
 * template half (`account_id`, `category_id`, `amount`, `payee`, `note`) is the
 * `fin_transactions` row each charge will be, field for field; the schedule half
 * is ADR-024's rule language — the SAME canonical JSON `tasks.recurrence` and
 * `events.recurrence` carry (migration 018) — beside the `anchor_date` it phases
 * from. One rule language, one validator, one hundred table tests already
 * written: a second recurrence grammar for money would be the mistake this
 * column shape exists to prevent, and `@nexus/core`'s `validateRecurrenceRule`
 * is the gate here exactly as it is for the other two columns (SQLite cannot
 * parse JSON in a CHECK, so no constraint can express the tagged union).
 *
 * `amount` is signed exactly as a transaction's is — negative leaves
 * `account_id`, positive arrives in it — so a salary is as expressible as a
 * Netflix charge, and the generated row copies the number rather than deriving a
 * sign from anything. The money CHECKs are `fin_transactions`' own, restated:
 * `typeof(amount) = 'integer'` (affinity alone would accept `12.5` into an
 * INTEGER column) and `amount <> 0`.
 *
 * **`next_run` is a CURSOR, and it is NULLABLE.** It holds the first occurrence
 * date that has NOT been charged yet; NULL means the series is exhausted (its
 * `until`/`count` end has been passed) and there is nothing left to generate.
 * A sentinel date would have to be compared against everywhere and would sort
 * into the middle of real dates; NULL is the honest shape for "no next one".
 *
 * **The idempotence is the SCHEMA's, not the generator's.**
 * `fin_transactions_recurring_occurrence` is `UNIQUE (recurring_id, tx_date)`
 * over the rows that name a subscription — so one subscription can hold at most
 * one charge per calendar day, and a second attempt at an occurrence already
 * charged cannot be written AT ALL: not by a re-run of the generator, not by a
 * crash between the insert and the cursor advance, not by a restored archive
 * whose cursor disagrees with its rows, not by a hand-edited file. A cursor the
 * code maintains would have to be right every time; an index has to be right
 * once. `FinRecurringStore.generateDue` inserts through
 * `ON CONFLICT (recurring_id, tx_date) WHERE recurring_id IS NOT NULL DO
 * NOTHING`, whose conflict target names THIS index and only it — so an
 * already-charged occurrence is a no-op while every other constraint
 * (the money CHECKs, the foreign keys) still fails loudly.
 *
 * The index deliberately counts SOFT-DELETED rows too — it carries no
 * `WHERE deleted_at IS NULL`. That is the answer to "what happens if the user
 * deletes a generated charge": the row stays on disk holding its slot, so the
 * charge does not silently reappear on the next generation. A charge the user
 * threw away is a decision, and a generator that undid it every minute would be
 * arguing with them.
 *
 * `recurring_id` lands on `fin_transactions` by plain `ALTER TABLE … ADD COLUMN`
 * — nullable, defaulting to NULL, `ON DELETE SET NULL` — exactly the additive
 * path migration 051 documented and left available. A generated row is an
 * ORDINARY transaction in every other respect: same table, same soft delete,
 * same editability, so the derived balance, the `fin_flows` transfer-free view,
 * the month report and the archive all keep working without a line of change.
 * The view itself needs no rebuild: it names its columns, so a new one on the
 * base table is simply not in it — a subscription's provenance is not something
 * an income/expense aggregate has any business reading.
 *
 * A subscription is never a transfer: there is no `counter_account_id` here and
 * no way to write one, because a standing order between your own two accounts
 * moves nothing over time and the whole point of a template is that every charge
 * it makes is the same kind of thing. `category_id` is `ON DELETE SET NULL` for
 * `fin_transactions.category_id`'s reason — deleting a label must never delete
 * the schedule.
 *
 * **The notification source widens to `'subscription'`** in both places
 * migration 009 closed it and migrations 019/021 last widened it: the
 * `notifications` ledger and `ntf_source_settings`, the latter because a renewal
 * reminder IS silenceable (unlike migration 037's `'security'`, which was
 * deliberately left out of the narrower CHECK). SQLite cannot alter a CHECK, so
 * each table is rebuilt by the standard create-new / copy / drop / rename
 * sequence, re-creating `notifications_profile_status_updated` afterwards —
 * `DROP TABLE` takes a table's indexes with it, while `UNIQUE (profile_id,
 * source, entity_id, occurrence_key)` comes back with the table because it is
 * part of the declaration.
 *
 * **Why the rebuild is safe here, re-verified rather than inherited.** ADR-042
 * proved what a rebuild costs when the dropped table is a referenced PARENT:
 * the implicit DELETE inside `DROP TABLE` fires every `ON DELETE CASCADE` that
 * points at it, and `PRAGMA foreign_keys` is a NO-OP inside the transaction
 * `runMigrations` wraps each migration in, so it cannot be switched off — which
 * is why migration 047 chose three UPDATEs over a rebuild of `cards`. Neither
 * table here is such a parent, and the schema has been re-read as it stands at
 * version 52: nothing anywhere declares `REFERENCES notifications` or
 * `REFERENCES ntf_source_settings`, no view selects from either, and migration
 * 017's search-index triggers name neither. Both are pure CHILDREN of
 * `profiles`, which this migration does not touch, so every copied row's
 * `profile_id` already satisfied the very constraint it is re-checked against.
 * `migrations.test.ts` proves it rather than asserting it: a fixture at version
 * 52 carrying ledger rows, source settings and a full FIN ledger is migrated and
 * every row is counted afterwards.
 */
export const migration053: Migration = {
  version: 53,
  up(db) {
    db.exec(`
      CREATE TABLE fin_recurring (
        id            TEXT PRIMARY KEY,
        profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        account_id    TEXT NOT NULL REFERENCES fin_accounts(id) ON DELETE CASCADE,
        category_id   TEXT REFERENCES fin_categories(id) ON DELETE SET NULL,
        name          TEXT NOT NULL CHECK (length(name) > 0),
        amount        INTEGER NOT NULL
                        CHECK (typeof(amount) = 'integer' AND amount <> 0),
        payee         TEXT,
        note          TEXT,
        -- ADR-024's canonical JSON, the shape migration 018 already stores.
        recurrence    TEXT NOT NULL,
        -- The date the rule phases from; the series' first possible charge.
        anchor_date   TEXT NOT NULL,
        -- The first occurrence NOT yet charged; NULL once the series is spent.
        next_run      TEXT,
        -- Whole days before a charge to remind, or NULL for "do not remind me".
        -- ONE number rather than a ladder (tasks.reminder_offsets): a renewal
        -- is a scheduled fact the user set themselves, not an external deadline
        -- to escalate towards.
        reminder_days INTEGER
                        CHECK (reminder_days IS NULL OR
                               (typeof(reminder_days) = 'integer' AND
                                reminder_days >= 0 AND reminder_days <= 365)),
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        deleted_at    TEXT
      );

      -- The two reads there are: "this profile's live subscriptions" (the page,
      -- the calendar, the widget) and "which of them are due" (the generator,
      -- which scans by next_run).
      CREATE INDEX fin_recurring_profile_active
        ON fin_recurring (profile_id, next_run, id)
        WHERE deleted_at IS NULL;

      ALTER TABLE fin_transactions
        ADD COLUMN recurring_id TEXT REFERENCES fin_recurring(id) ON DELETE SET NULL;

      -- The idempotence, enforced by the file rather than remembered by code.
      -- No "deleted_at IS NULL": a deleted charge keeps its slot, so it does not
      -- come back on the next generation.
      CREATE UNIQUE INDEX fin_transactions_recurring_occurrence
        ON fin_transactions (recurring_id, tx_date)
        WHERE recurring_id IS NOT NULL;

      CREATE TABLE notifications_new (
        id              TEXT PRIMARY KEY,
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        source          TEXT NOT NULL
                          CHECK (source IN ('document', 'exam', 'study-day', 'event', 'task',
                                            'security', 'subscription')),
        entity_id       TEXT NOT NULL,
        occurrence_key  TEXT NOT NULL,
        title           TEXT NOT NULL,
        body            TEXT NOT NULL,
        status          TEXT NOT NULL
                          CHECK (status IN ('delivered', 'snoozed', 'dismissed')),
        snoozed_until   TEXT,
        delivered_at    TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        UNIQUE (profile_id, source, entity_id, occurrence_key)
      );

      INSERT INTO notifications_new
        (id, profile_id, source, entity_id, occurrence_key, title, body, status,
         snoozed_until, delivered_at, created_at, updated_at)
        SELECT id, profile_id, source, entity_id, occurrence_key, title, body, status,
               snoozed_until, delivered_at, created_at, updated_at
        FROM notifications;

      DROP TABLE notifications;
      ALTER TABLE notifications_new RENAME TO notifications;

      -- Dropped with the old table; re-created verbatim from migration 009.
      CREATE INDEX notifications_profile_status_updated
        ON notifications (profile_id, status, updated_at);

      CREATE TABLE ntf_source_settings_new (
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        source      TEXT NOT NULL
                      CHECK (source IN ('document', 'exam', 'study-day', 'event', 'task',
                                        'subscription')),
        enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        PRIMARY KEY (profile_id, source)
      );

      INSERT INTO ntf_source_settings_new (profile_id, source, enabled)
        SELECT profile_id, source, enabled FROM ntf_source_settings;

      DROP TABLE ntf_source_settings;
      ALTER TABLE ntf_source_settings_new RENAME TO ntf_source_settings;
    `);
  },
};

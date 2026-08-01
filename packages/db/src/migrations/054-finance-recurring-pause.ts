import type { Migration } from "./migrations.js";

/**
 * Migration 54 — PAUSING a subscription (ADR-074). One nullable timestamp, which
 * is the whole of it.
 *
 * **A pause is not a delete.** Until now the only way to stop being charged was
 * to soft-delete the subscription: the row left every list, and „vrati se na
 * ovo u septembru" meant remembering what had been thrown away. `paused_at`
 * makes „zadrži pretplatu, ali me ne naplaćuj" a state of its own — the row
 * stays in `listActive`, stays editable, and simply stops being generated from.
 *
 * `paused_at` and `deleted_at` are two INDEPENDENT nullable timestamps, the
 * house idiom, rather than one `status` enum. They answer two different
 * questions — "is this being charged" and "is this still here" — and a single
 * column would have to invent a precedence between them: soft-deleting a paused
 * subscription and restoring it must give back a subscription that is still
 * paused, because the pause is a fact about the subscription and the delete is a
 * fact about its visibility. Two columns say that without a rule.
 *
 * **It lands by plain `ALTER TABLE … ADD COLUMN`, never a table rebuild**, and
 * that is a correctness requirement rather than a convenience.
 * `fin_transactions.recurring_id` REFERENCES `fin_recurring`, so this table is a
 * referenced PARENT — and ADR-042 proved what a rebuild costs one: the implicit
 * DELETE inside `DROP TABLE` fires every `ON DELETE` action pointing at it, and
 * `PRAGMA foreign_keys` is a NO-OP inside the transaction `runMigrations` wraps
 * each migration in, so it cannot be switched off. A rebuild here would silently
 * detach (`ON DELETE SET NULL`) every generated charge from the subscription
 * that made it, inside the very transaction that claims to be adding a column.
 * `migrations.test.ts` pins it rather than asserting it: a fixture at version 53
 * carrying a subscription and its generated charges is migrated, and every
 * charge is counted afterwards still naming its subscription.
 *
 * SQLite rewrites no rows for the ADD COLUMN, so every existing subscription
 * reads back with a NULL — which is exactly the right thing for it to say: a
 * subscription written before this migration was never paused, and „not paused"
 * is what NULL means here.
 *
 * No index. The two reads that matter — this profile's live subscriptions and
 * the ones due for generation — already run through
 * `fin_recurring_profile_active`, and the pause is a filter applied to a handful
 * of rows the index has already narrowed to one profile. A subscription list is
 * a page of a dozen rows, not a table to scan.
 *
 * No CHECK either: the column holds an ISO-8601 instant exactly as `deleted_at`
 * and `created_at` do, and SQLite can express no more about that than they do.
 * `FinRecurringStore` validates it on the way in, which is where the other three
 * timestamps are validated too.
 */
export const migration054: Migration = {
  version: 54,
  up(db) {
    db.exec(`
      ALTER TABLE fin_recurring ADD COLUMN paused_at TEXT;
    `);
  },
};

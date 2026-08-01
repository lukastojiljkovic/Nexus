import type { Migration } from "./migrations.js";

/**
 * Migration 52 — the IMPORT FINGERPRINT on a transaction (FIN slice e). One
 * additive column and one partial unique index, which is the whole mechanism
 * that makes importing the same bank statement twice add nothing.
 *
 * It lands by plain `ALTER TABLE … ADD COLUMN`, exactly the additive path
 * migration 051's own header reserved for the columns it knew would follow —
 * SQLite rewrites no rows for it, every existing transaction reads back with a
 * NULL key, and NULL is precisely the right thing for them to say: a row the
 * user typed was never recognised by any import, and never will be.
 *
 * **What the fingerprint is over, and why.** `finImportKey` (`@nexus/core`)
 * composes it from the row's own facts — the local day, the signed minor units,
 * the payee and the note AS STORED (already trimmed and capped) — plus the
 * OCCURRENCE NUMBER of the row among rows identical in those four. Each input
 * earns its place:
 *
 *  - The four facts are what a bank statement actually repeats. The same
 *    purchase can arrive again next month inside an overlapping export written
 *    in a different column order under a different delimiter, and it must be
 *    recognised then too — so nothing about the FILE (its name, its line number,
 *    the mapping that read it) is in the key. That is also what makes the key
 *    re-derivable from the stored row alone.
 *  - The ACCOUNT is deliberately NOT in it. The row names its account in a
 *    column of its own, and the uniqueness below is over the pair. That is not
 *    only tidier, it is what lets a foreign import (ADR-043) carry a fingerprint
 *    into another profile UNCHANGED while the planner re-mints the account
 *    around it: a key that had baked the source's account id in would name a
 *    row that no longer exists.
 *  - The CATEGORY is not in it either — it is the user's later answer about a
 *    row the bank already described, and folding it in would make re-filing a
 *    transaction enough to un-recognise it.
 *  - **The occurrence number is what keeps two identical coffees two coffees.**
 *    Two 350-dinar coffees on one day with the same description are a real thing
 *    that really happens, and a fingerprint over the four facts alone would
 *    silently drop the second one — forever, and with no way for the user to
 *    tell. So identical rows are numbered as they are read: ordinals 1 and 2,
 *    two different keys, both imported. The SAME statement read again numbers
 *    them the same way, so both are recognised and neither is duplicated; a
 *    later statement that genuinely holds a THIRD coffee gives it ordinal 3,
 *    which no key matches, and exactly one row arrives.
 *
 * **The index is over EVERY row, live or soft-deleted** — `WHERE import_key IS
 * NOT NULL` and nothing else, unlike migration 051's own indexes, which all
 * carry `deleted_at IS NULL`. That is the deliberate difference: if a deleted
 * row's key left the index, re-importing an overlapping statement would put the
 * row the user threw away straight back, silently undoing a deliberate delete.
 * A skip for a deleted row is reported under its own name so the sentence the
 * user reads is „you imported this and deleted it", never „nothing happened".
 *
 * **It is a UNIQUE index rather than a store convention.** The import already
 * asks the store which keys exist and drops those rows by name — the index is
 * what makes the promise binding: two imports racing, or a mapping that somehow
 * produced the same key twice, fail the transaction instead of doubling
 * somebody's ledger. `(profile_id, account_id, import_key)` is the exact scope
 * the fingerprint claims: the same statement legitimately imports into two
 * different accounts of the same profile (two people's export of a joint
 * account), and nothing about that is a duplicate.
 *
 * Editing an imported row does NOT clear its key, and that is the right
 * behaviour rather than an oversight: the user changed a row the import brought
 * in, and re-importing the statement must not hand them a second, unedited copy
 * of what they just corrected.
 */
export const migration052: Migration = {
  version: 52,
  up(db) {
    db.exec(`
      ALTER TABLE fin_transactions ADD COLUMN import_key TEXT;

      CREATE UNIQUE INDEX fin_transactions_import_key
        ON fin_transactions (profile_id, account_id, import_key)
        WHERE import_key IS NOT NULL;
    `);
  },
};

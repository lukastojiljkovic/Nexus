import type { Migration } from "./migrations.js";

/**
 * Migration 51 — the FIN module's ledger (FIN slice a). Four tables and one
 * view, and every one of the five decisions this module was designed around is
 * written into the schema rather than left to a store to remember.
 *
 * **Money is an INTEGER in minor units, everywhere.** Every money column
 * carries `CHECK (typeof(x) = 'integer')`, not merely `INTEGER` affinity:
 * SQLite's affinity converts a REAL to an INTEGER only when the conversion is
 * lossless, so `12.5` would otherwise sit happily in an `INTEGER NOT NULL`
 * column and every sum over it would be a float from then on. The CHECK is what
 * makes „nikad float" a fact of the file instead of a convention. There is no
 * scale column and no decimal anywhere: 1234 in an RSD account is 12,34 RSD, and
 * turning that into a string happens at the display edge alone.
 *
 * **Currency is per ACCOUNT, and there is no FX.** `fin_accounts.currency` is a
 * three-letter upper-case ISO-4217 code (`length = 3 AND currency =
 * upper(currency)` — `upper()` is ASCII-only, which is exactly the alphabet
 * ISO-4217 uses). Nothing here holds a rate, because this app has no network
 * feed to get an honest one from and a stale invented rate is worse than no
 * total at all. So every total is per currency, which is why `fin_budgets`
 * carries a `currency` of its own: an allowance of „30000" means nothing until
 * it says which money it is 30000 of.
 *
 * **Balances are DERIVED, never stored.** There is deliberately no `balance`
 * column on `fin_accounts` — only `opening_balance`, which is a fact about the
 * day the account was added and never changes afterwards. An account's balance
 * is that opening figure plus its transactions, computed on read
 * (`FinAccountStore.listBalances`). A stored mutable balance is the classic
 * drift bug: one write that fails halfway and the number lies forever, with
 * nothing anywhere able to notice.
 *
 * **A transfer is ONE row, not two.** A transaction names its `account_id` and,
 * when it is a transfer, the `counter_account_id` it moves to; `amount` is
 * signed from `account_id`'s point of view, so the counter account simply
 * receives `-amount`. Two CHECKs make the modelling binding: a transfer's two
 * sides may not be the same account, and a transfer may not carry a category
 * (it is neither income nor expense, so there is no category that could
 * honestly describe it). Both foreign keys CASCADE, so a hard-deleted account
 * takes its transfers with it — a half-transfer naming an account that no
 * longer exists is not a row anyone can read.
 *
 * `fin_flows` is how „excluded from income/expense aggregates BY CONSTRUCTION"
 * is delivered rather than promised. It is the live, non-transfer rows, and it
 * does not project `counter_account_id` at all — so a caller reading the view
 * cannot filter transfers wrongly, cannot forget to filter them, and cannot even
 * ask the question. Every income/expense aggregate in `FinTransactionStore`
 * reads this view and nothing else; the raw table is for CRUD and for the
 * balance derivation, which is the one read that genuinely does want both sides.
 *
 * **Categories are FLAT, carrying an income/expense kind** — ADR-072's argument
 * for note categories, applied unchanged: a hierarchy of categories IS a folder
 * tree, one tree per app is enough, and a second one is expensive to undo later.
 * Nothing about the shape invites a `parent_id` back. Uniqueness is
 * `(profile_id, kind, name)` rather than `note_categories`' `(profile_id,
 * name)`, and the extra column is the honest difference between the two tables:
 * „Pokloni" is a perfectly ordinary EXPENSE category (gifts given) and an
 * equally ordinary INCOME one (gifts received), the two never appear in the same
 * picker, and collapsing them would refuse a distinction real ledgers make.
 * `fin_transactions.category_id` is `ON DELETE SET NULL` for
 * `notes.category_id`'s reason: deleting a category must never delete the money
 * that was spent under it.
 *
 * Two invariants SQLite cannot express and the stores own instead, each with a
 * named error: a transfer's two accounts must share a currency (there is no FX
 * to convert with), and a budget's category must be an EXPENSE category (a
 * budget is a spending limit; an income category would need a target, which
 * compares in the opposite direction — see `FinCategoryStore.setBudget`).
 * Neither is a foreign key into a filtered set, which is the only thing that
 * could have made them schema-level.
 *
 * **Where subscriptions attach (a later slice).** A recurring charge is a
 * TEMPLATE plus a schedule, and it needs nothing from this migration: a later
 * `fin_recurring` table holds the template's own fields (`account_id`,
 * `category_id`, `amount`, `payee`, `note`) beside a recurrence rule in the
 * shape `tasks`/`events` already store one (migration 018) and a `next_run`
 * bare date, and every charge it produces is an ORDINARY `fin_transactions` row
 * — which is exactly why the balance derivation, the flows view and the archive
 * all keep working without a line of change. The single column that slice may
 * want here is a nullable `recurring_id TEXT REFERENCES fin_recurring(id) ON
 * DELETE SET NULL` on `fin_transactions`, so a generated row can point back at
 * the subscription that made it; it lands by plain `ALTER TABLE … ADD COLUMN`
 * (the additive path migration 021 documents for `tasks`), which is available
 * precisely because nothing was crammed into this migration to anticipate it.
 */
export const migration051: Migration = {
  version: 51,
  up(db) {
    db.exec(`
      CREATE TABLE fin_accounts (
        id              TEXT PRIMARY KEY,
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name            TEXT NOT NULL CHECK (length(name) > 0),
        kind            TEXT NOT NULL
                          CHECK (kind IN ('cash', 'current', 'card', 'savings')),
        currency        TEXT NOT NULL
                          CHECK (length(currency) = 3 AND currency = upper(currency)),
        opening_balance INTEGER NOT NULL DEFAULT 0
                          CHECK (typeof(opening_balance) = 'integer'),
        archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        deleted_at      TEXT
      );

      -- The only account read there is: "this profile's live accounts, by name".
      CREATE INDEX fin_accounts_profile_active
        ON fin_accounts (profile_id, name, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE fin_categories (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name        TEXT NOT NULL CHECK (length(name) > 0),
        kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      -- Binding, not advisory: the store checks the same rule first so a
      -- collision is a named domain error rather than a raw constraint failure,
      -- and this index is what makes that check mean something. It also covers
      -- the read — "this profile's categories of this kind, by name".
      CREATE UNIQUE INDEX fin_categories_profile_kind_name
        ON fin_categories (profile_id, kind, name);

      CREATE TABLE fin_transactions (
        id                 TEXT PRIMARY KEY,
        profile_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        account_id         TEXT NOT NULL REFERENCES fin_accounts(id) ON DELETE CASCADE,
        counter_account_id TEXT REFERENCES fin_accounts(id) ON DELETE CASCADE,
        category_id        TEXT REFERENCES fin_categories(id) ON DELETE SET NULL,
        tx_date            TEXT NOT NULL,
        amount             INTEGER NOT NULL
                             CHECK (typeof(amount) = 'integer' AND amount <> 0),
        payee              TEXT,
        note               TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        deleted_at         TEXT,
        -- A transfer to itself moves nothing and would still count twice in the
        -- balance derivation, which reads both sides.
        CHECK (counter_account_id IS NULL OR counter_account_id <> account_id),
        -- A transfer is neither income nor expense, so no category can honestly
        -- describe it (the flows view already hides it; this stops the row from
        -- ever claiming otherwise).
        CHECK (counter_account_id IS NULL OR category_id IS NULL)
      );

      -- The ledger read: "this profile's live transactions, newest day first".
      CREATE INDEX fin_transactions_profile_date
        ON fin_transactions (profile_id, tx_date, id)
        WHERE deleted_at IS NULL;
      -- The two halves of the balance derivation, one index each: a row counts
      -- for the account it names and, negated, for the account it transfers to.
      CREATE INDEX fin_transactions_account_active
        ON fin_transactions (account_id)
        WHERE deleted_at IS NULL;
      CREATE INDEX fin_transactions_counter_active
        ON fin_transactions (counter_account_id)
        WHERE deleted_at IS NULL AND counter_account_id IS NOT NULL;

      -- Live, non-transfer rows — and NO counter_account_id column, deliberately
      -- (see the file doc): this is what makes "transfers are out of every
      -- income/expense aggregate" structural rather than a rule each caller has
      -- to remember.
      CREATE VIEW fin_flows AS
        SELECT id, profile_id, account_id, category_id, tx_date, amount, payee, note
          FROM fin_transactions
         WHERE deleted_at IS NULL AND counter_account_id IS NULL;

      CREATE TABLE fin_budgets (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES fin_categories(id) ON DELETE CASCADE,
        currency    TEXT NOT NULL
                      CHECK (length(currency) = 3 AND currency = upper(currency)),
        amount      INTEGER NOT NULL
                      CHECK (typeof(amount) = 'integer' AND amount > 0),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      -- One allowance per category per currency: a second currency is a second
      -- allowance (there is no FX to fold them with), never a second row for
      -- the same one. CASCADE above means deleting a category takes its
      -- allowance — unlike its transactions, an allowance is nothing without it.
      CREATE UNIQUE INDEX fin_budgets_profile_category_currency
        ON fin_budgets (profile_id, category_id, currency);
    `);
  },
};

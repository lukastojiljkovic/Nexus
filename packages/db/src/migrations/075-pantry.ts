import type { Migration } from "./migrations.js";

/**
 * Migration 75 — the PANTRY module's storage. Three tables, and the decisions
 * the module turns on are written into the schema rather than left to a store to
 * remember.
 *
 * **One item table serves food, medicine, hygiene, emergency supplies and
 * everything else.** The category is a closed CHECK, and the only field that
 * distinguishes a medicine is `dose_note` — free text for how the thing is
 * taken. There is deliberately NO dosage column, no strength, no per-kilogram
 * arithmetic and no field this app could compute a dose from: Nexus records what
 * the box says and derives nothing about it. A migration that later adds one
 * would be adding a feature this product has decided not to have, which is why
 * the reason is written down here rather than in a review comment.
 *
 * **`pantry_locations.rank` is a fractional rank from the first row.** A
 * location list is hand-orderable the moment it exists („Frižider, Ostava, Prva
 * pomoć“ is an order somebody chose), and migration 062 settled that a
 * hand-orderable scope starts on a rank rather than on a spacing of 1024 that a
 * renumber has to rescue. So there is no `position` here and no gap to exhaust:
 * an insert between two shelves takes a rank between theirs, and a move is a
 * one-row write.
 *
 * **Quantities are REAL and bounded**, and the CHECKs say what they mean rather
 * than trusting affinity: a quantity is never negative (an item that has run out
 * is 0, and the store refuses a change that would leave it below), a
 * `min_quantity` is strictly above zero (`0` would be a minimum nothing can be
 * under), and both live under a million, past which the number is a typo. NaN
 * arrives as NULL and is caught by `NOT NULL`; an infinity is caught by the
 * upper bound.
 *
 * **A barcode is TEXT, digits only, and one of the four real lengths.** Storing
 * it as an integer would eat the leading zero of every EAN that starts with one,
 * and the column would then hold a different code than the packet does. The
 * CHECK spells the rule out in SQL — `length IN (8,12,13,14)` plus
 * `NOT GLOB '*[^0-9]*'` — so a padded or spaced value is refused here as well as
 * in `@nexus/core`'s validator, which is the message rather than the guarantee.
 *
 * **The log is append-only history, and its date is the change's own day.** One
 * row per quantity move, written in the SAME transaction as the quantity it
 * explains (`PantryStore.changeQuantity`), so a number and its reason can never
 * land apart. `changed_at` is the instant main stamped and there is no
 * `updated_at`, because nothing ever updates a log row: its date part is the day
 * the change counts for, which is what the waste report adds up over.
 *
 * **The reason carries a sign, and the schema is the backstop.** `bought` adds,
 * `used` and `expired` subtract, `correction` may go either way — mirrored from
 * `@nexus/core`'s `validatePantryChange` as migration 055 mirrors its own pair
 * CHECK. That is what lets „what did I throw away“ be a sum of `-delta` rather
 * than a guess about which way a row points.
 *
 * **Soft delete is the item's, and it does not touch the log.** A pantry that
 * quietly drops the history of everything the user has thrown away would answer
 * the waste report with nothing the moment somebody tidied up; `softDeleteItem`
 * is an UPDATE, so `restoreItem` brings the item back with every change it ever
 * had. Only a HARD delete (a profile deletion, or a cascade) takes the log rows,
 * which is what the CASCADE below is for.
 *
 * **No journal triggers, and deliberately not in `RESTORE_WIPE_TABLES`.** Sync
 * is on hold permanently, and a new collection is journaled only when its own
 * migration writes migration 063's shape for it (`circuit_parts` in 067,
 * `circuit_chassis` in 068). Writing those triggers here would put this module
 * into the sweep, the collector map and the repair before any of it is designed
 * against the pantry. But a table cannot be added to the restore wipe list
 * without joining that map — `collectionGuard.test.ts` holds the two lists equal
 * — so the three tables are documented-exempt in `restoreStore.test.ts`'s T3
 * ledger instead, with that reason beside them. **Stage 2 owes the wipe entry,
 * the sync-map classification and the three triggers in the same pass that wires
 * `exportData`/`importData` into the profile archive**, because a restore that
 * wiped a table it cannot refill is the one direction this must never move in.
 *
 * **Three indexes, each one earned by a read.** `pantry_locations_profile_rank`
 * is the location list itself, in the user's order.
 * `pantry_items_profile_active` is the pantry list. `pantry_log_item` is the
 * join the log read makes — one item's changes, oldest first — and it is also
 * the only order the log is ever read in. There is deliberately no index on
 * `changed_at` alone: nothing asks for „every change on a day“ without already
 * asking for the profile's items, which the log read reaches through `item_id`.
 */
export const migration075: Migration = {
  version: 75,
  up(db) {
    db.exec(`
      CREATE TABLE pantry_locations (
        id         TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name       TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 60),
        -- A fractional rank (migration 062), never an integer position: this is
        -- a scope the user drags from its second row onwards.
        rank       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      -- The location list, in the order the user put it in.
      CREATE INDEX pantry_locations_profile_rank
        ON pantry_locations (profile_id, rank, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE pantry_items (
        id              TEXT PRIMARY KEY,
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        -- SET NULL and not CASCADE: a location is a shelf, and removing the
        -- shelf must never take the food with it. The store refuses to delete a
        -- location that still holds live items; this is the backstop for a
        -- profile deletion, where the items are going anyway.
        location_id     TEXT REFERENCES pantry_locations(id) ON DELETE SET NULL,
        name            TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 80),
        category        TEXT NOT NULL CHECK (category IN
                          ('food', 'medicine', 'hygiene', 'emergency', 'other')),
        quantity        REAL NOT NULL CHECK (quantity >= 0 AND quantity <= 1000000),
        unit            TEXT NOT NULL CHECK (unit IN ('pcs', 'g', 'kg', 'ml', 'l', 'pack')),
        min_quantity    REAL CHECK (min_quantity IS NULL OR
                          (min_quantity > 0 AND min_quantity <= 1000000)),
        -- Bare local days, "YYYY-MM-DD". No CHECK on the shape, on the same
        -- terms habits.reminder_time carries none: the store validates what goes
        -- in, and a date that is not a day is corruption rather than input.
        expiry_date     TEXT,
        opened_date     TEXT,
        use_within_days INTEGER CHECK (use_within_days IS NULL OR
                          (typeof(use_within_days) = 'integer' AND
                           use_within_days BETWEEN 1 AND 3650)),
        notes           TEXT CHECK (notes IS NULL OR length(notes) <= 500),
        -- TEXT, never an integer: a leading zero is part of the code.
        barcode         TEXT CHECK (barcode IS NULL OR
                          (length(barcode) IN (8, 12, 13, 14) AND
                           barcode NOT GLOB '*[^0-9]*')),
        dose_note       TEXT CHECK (dose_note IS NULL OR length(dose_note) <= 300),
        archived_at     TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        deleted_at      TEXT
      );

      -- The pantry list: this profile's live items, and nothing else, ever.
      CREATE INDEX pantry_items_profile_active
        ON pantry_items (profile_id, name, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE pantry_log (
        id         TEXT PRIMARY KEY,
        item_id    TEXT NOT NULL REFERENCES pantry_items(id) ON DELETE CASCADE,
        -- The instant the change was stamped; its date part is the day it counts
        -- for. There is no updated_at: a log row is never updated.
        changed_at TEXT NOT NULL,
        delta      REAL NOT NULL CHECK (delta <> 0 AND
                          delta >= -1000000 AND delta <= 1000000),
        reason     TEXT NOT NULL CHECK (reason IN
                          ('bought', 'used', 'expired', 'correction')),
        -- The sign rule, mirrored from @nexus/core's validatePantryChange.
        CHECK (
          (reason = 'bought' AND delta > 0) OR
          (reason IN ('used', 'expired') AND delta < 0) OR
          reason = 'correction'
        )
      );

      -- One item's changes, oldest first — the only way the log is read.
      CREATE INDEX pantry_log_item ON pantry_log (item_id, changed_at, id);
    `);
  },
};

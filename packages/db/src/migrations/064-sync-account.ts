import type { Migration } from "./migrations.js";

/**
 * Migration 64 — the one row that says this computer is part of a sync account.
 *
 * **A singleton, enforced by `CHECK (id = 1)` rather than by convention.** A
 * Nexus file has one local data key, and `local_wrap` is the master key wrapped
 * under exactly that key. Two rows would mean two master keys claiming the same
 * file, which is not a state with a correct resolution — so it is not a state
 * this table can hold.
 *
 * **Why the wrap lives here and not on the server.** MK is wrapped three times:
 * under K_wrap and under the Sync Recovery Code, both of which the server keeps,
 * and under DK, which it must never see. That third wrap is what lets this
 * desktop open its own master key at rest without the web password — and it is
 * the reason a user who has turned cloud back off still has a working, readable
 * database rather than one full of ciphertext it cannot open.
 *
 * **Turning sync OFF does not delete this row, and that is the important rule.**
 * The mint is a singleton per account: a second attempt is answered
 * `already_minted` and, by design, is given no route to the existing key — the
 * two routes are pairing with a device that holds it and the Recovery Kit, both
 * proofs a password thief does not have. So a switch-off that deleted the local
 * wrap would leave a computer holding the only offline copy of a key it had just
 * thrown away, and „turn it back on" would be an unrecoverable operation
 * disguised as a toggle. Off means „stop reaching the network". {@link
 * SyncAccountStore.forget} is the separate, deliberate act of disconnecting this
 * computer from the account, and the screen offering it says what it costs.
 *
 * **`refresh_token` is nullable and is a secret at rest.** It sits inside the
 * SQLCipher file with everything else, which is the honest place for it: an
 * adversary who can read this column has already opened the database and holds
 * the user's whole corpus, so the token adds no exposure it did not have. Null
 * means signed out — a state the app can be in while still being enabled, and
 * the one it enters whenever a refresh is refused.
 *
 * **No access token column.** It lives for an hour and is re-derived from the
 * refresh token on demand; persisting it would mean writing a credential to disk
 * so that it could be found expired the next time it was read.
 */
export const migration064: Migration = {
  version: 64,
  up: (db) => {
    db.exec(`
      CREATE TABLE sync_account (
        id            INTEGER PRIMARY KEY CHECK (id = 1),
        user_id       TEXT NOT NULL CHECK (length(user_id) > 0),
        email         TEXT NOT NULL CHECK (length(email) > 0),
        device_id     TEXT,
        local_wrap    TEXT NOT NULL CHECK (length(local_wrap) > 0),
        refresh_token TEXT,
        enabled_at    TEXT NOT NULL
      );
    `);
  },
};

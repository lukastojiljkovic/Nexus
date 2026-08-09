import type Database from "better-sqlite3-multiple-ciphers";
import { parseJsonValue, parseSealedKey, type SealedKey } from "@nexus/sync-crypto";

/**
 * The `sync_account` singleton: which account this computer belongs to, the
 * master key wrapped under this file's own data key, and the refresh token — or
 * nothing at all, which is what every 1.0.0 file holds and what a user who never
 * turns cloud on keeps holding.
 *
 * Migration 064's header carries the design; this file is the gate on it. Two
 * things are worth repeating at the point where they are enforced:
 *
 *  * **`local_wrap` is validated on the way OUT as well as in.** `parseSealedKey`
 *    refuses unknown keys, a wrong version, and a field whose base64url does not
 *    decode to the right length. A wrap read back as „whatever JSON was in the
 *    column" would be handed straight to `unwrapKey`, and the failure of a
 *    corrupt row would surface as a cryptographic error nobody could place.
 *  * **{@link SyncAccountStore.forget} is not the opposite of enabling.**
 *    Switching cloud off leaves this row exactly where it is. Forgetting throws
 *    away this computer's offline copy of the master key, and the only ways back
 *    are pairing with a device that still holds it and the Recovery Kit.
 */

/** What this computer knows about its sync account. */
export interface SyncAccount {
  readonly userId: string;
  /** Canonical, lower-cased — it is half of the web KDF's salt. */
  readonly email: string;
  /** The server's id for this device's row, or null when the mint could not read it back. */
  readonly deviceId: string | null;
  /** MK under DK. Never leaves this machine. */
  readonly localWrap: SealedKey;
  /** Null means signed out — a state an enabled account can be in. */
  readonly refreshToken: string | null;
  /** ISO 8601, when sync was first turned on here. */
  readonly enabledAt: string;
}

/** What {@link SyncAccountStore.save} is given, at the moment sync is enabled. */
export interface SyncAccountInput {
  readonly userId: string;
  readonly email: string;
  readonly deviceId: string | null;
  readonly localWrap: SealedKey;
  readonly refreshToken: string | null;
  readonly enabledAt: string;
}

export class SyncAccountStore {
  private readonly readRow: Database.Statement;
  private readonly writeRow: Database.Statement;
  private readonly writeRefresh: Database.Statement;
  private readonly writeDevice: Database.Statement;
  private readonly deleteRow: Database.Statement;

  constructor(db: Database.Database) {
    this.readRow = db.prepare(
      `SELECT user_id, email, device_id, local_wrap, refresh_token, enabled_at
         FROM sync_account WHERE id = 1`,
    );
    this.writeRow = db.prepare(
      `INSERT INTO sync_account
         (id, user_id, email, device_id, local_wrap, refresh_token, enabled_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         user_id = excluded.user_id,
         email = excluded.email,
         device_id = excluded.device_id,
         local_wrap = excluded.local_wrap,
         refresh_token = excluded.refresh_token,
         enabled_at = excluded.enabled_at`,
    );
    this.writeRefresh = db.prepare("UPDATE sync_account SET refresh_token = ? WHERE id = 1");
    this.writeDevice = db.prepare("UPDATE sync_account SET device_id = ? WHERE id = 1");
    this.deleteRow = db.prepare("DELETE FROM sync_account");
  }

  /** The account, or null — which is what „cloud has never been turned on here" is. */
  read(): SyncAccount | null {
    const row = this.readRow.get() as
      | {
          user_id: string;
          email: string;
          device_id: string | null;
          local_wrap: string;
          refresh_token: string | null;
          enabled_at: string;
        }
      | undefined;
    if (row === undefined) return null;

    const localWrap = parseSealedKey(parseJsonValue(row.local_wrap));
    // A row whose wrap cannot be read is not an account. Reporting it as „no
    // account" would silently offer to mint a second master key for an account
    // that already has one, so it is loud instead: the file is damaged, and the
    // way back is the Recovery Kit.
    if (localWrap === null) {
      throw new TypeError(
        "sync_account.local_wrap is not a readable key wrap. This file's copy of the " +
          "master key is damaged; recover the account with the Recovery Kit.",
      );
    }
    if (localWrap.purpose !== "mk/local-data-key") {
      throw new TypeError(
        `sync_account.local_wrap is a ${localWrap.purpose} wrap, which no key on this ` +
          "machine opens. This file's copy of the master key is damaged.",
      );
    }

    return {
      userId: row.user_id,
      email: row.email,
      deviceId: row.device_id,
      localWrap,
      refreshToken: row.refresh_token,
      enabledAt: row.enabled_at,
    };
  }

  /** Writes the singleton, replacing whatever was there. */
  save(input: SyncAccountInput): void {
    if (input.localWrap.purpose !== "mk/local-data-key") {
      throw new TypeError(
        `A ${input.localWrap.purpose} wrap must not be stored as this computer's local wrap.`,
      );
    }
    this.writeRow.run(
      input.userId,
      input.email,
      input.deviceId,
      JSON.stringify(input.localWrap),
      input.refreshToken,
      input.enabledAt,
    );
  }

  /**
   * Rotates the stored refresh token, or clears it on sign-out.
   *
   * Its own statement rather than a `save` of the whole row, because a refresh
   * happens on an ordinary call and a whole-row write would need the caller to
   * hold — and re-supply — the local wrap every time it did.
   */
  setRefreshToken(token: string | null): void {
    this.writeRefresh.run(token);
  }

  /** Fills in the device id when a mint could not read it back at the time. */
  setDeviceId(deviceId: string | null): void {
    this.writeDevice.run(deviceId);
  }

  /**
   * Disconnects this computer from the account, throwing away its offline copy
   * of the master key. **Not** what switching cloud off does — see the class
   * header and migration 064.
   */
  forget(): void {
    this.deleteRow.run();
  }
}

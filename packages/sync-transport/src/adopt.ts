/**
 * How a computer that has never seen this account gets hold of its master key.
 *
 * ─── The circle this breaks ────────────────────────────────────────────────
 *
 * A second desktop is stuck: `nexus_device_register` wants a proof derived from
 * MK, MK lives in `key_wraps`, and every read of `key_wraps` is gated on
 * `nexus_session_is_live()` — a live `devices` row naming the caller's session.
 * No key without a row, no row without the key.
 *
 * The way out is written into the schema on purpose and is easy to miss, so it
 * is spelled out here:
 *
 *  1. **A client may insert its OWN device row**, and a client cannot write
 *     `platform` — the column is absent from the grant — so the row lands as
 *     `web`. `devices_insert_requires_aal2` is what makes that safe: a session
 *     holding nothing but the password cannot mint itself a voucher.
 *  2. That row makes the session *live*, which opens `key_wraps`.
 *  3. **`mk_under_src` is deliberately NOT desktop-only.** Migration 010 confines
 *     `mk_under_kwrap` to desktops and leaves the recovery slot readable, for
 *     exactly this flow: the computer trying to become a desktop has no row yet.
 *     It costs nothing, because that wrap's opener is the Sync Recovery Code and
 *     the web password does not yield it.
 *  4. With MK in hand the machine signs in a SECOND time — an `aal1` session,
 *     created after the step-up and therefore surviving the revocation it caused
 *     — and buys a real `platform = 'desktop'` row with the MK proof.
 *  5. The bootstrap row is retired on the way out. It was scaffolding.
 *
 * ─── What is in this file, and what is not ─────────────────────────────────
 *
 * Only the two requests that flow does not already have: inserting the caller's
 * own device row, and reading the recovery wrap alone. The sign-ins, the step-up,
 * the registration and the retirement are `auth.ts`, `register.ts` and
 * `devices.ts` — this is a protocol assembled from parts, not a new endpoint.
 *
 * There is no Edge Function here and there is no migration behind it. Every rule
 * this leans on was already written and already tested; what was missing was a
 * client that walked the path.
 */

import { byteaToBase64url } from "./bytea.js";
import { postgrestPath, type HttpRequest } from "./http.js";
import { KEY_WRAP_COLUMNS, type SealedNameFields } from "./enable.js";
// The web barrel, like every other module here: this package is built for the
// browser too, and nothing in it may reach a Node-only export.
import type { Argon2idParams } from "@nexus/sync-crypto/web";

/** A uuid the server issued. Checked because it is interpolated into a filter. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything the bootstrap row needs. The account and the session, and a name. */
export interface WebDeviceInput {
  /** The account uuid. Written explicitly because `user_id` has no default. */
  readonly userId: string;
  /** The session this row vouches for — the caller's own, or the policy refuses it. */
  readonly sessionId: string;
  /**
   * Sealed under a subkey of MK … which this machine does not have yet. See below.
   *
   * When it IS sealed — here, or in the PATCH that retires the row — it must be
   * bound to `platform: "web"`. `platform` is absent from the INSERT grant, so
   * this row is `web` whatever its author intended, and `openDeviceName` rebuilds
   * its AAD from the row's stated platform. A `desktop`-bound name written here
   * authenticates for nobody, in a way no test of the write can see.
   */
  readonly deviceName: SealedNameFields;
}

/**
 * Inserts the caller's own device row.
 *
 * `Prefer: return=representation` and `select=id`, because the id is not a
 * convenience here: this row is scaffolding and the caller must retire it when
 * the real one arrives. A row it cannot name is a row that stays live forever,
 * and every live row counts against the account's device list.
 *
 * **On the name.** The machine has no MK at the moment it writes this row, so it
 * cannot seal a real device name — the caller passes the name it will use for
 * the real row *after* MK is open, or, on the bootstrap row, whatever it can
 * seal. The row lives for the length of one adoption and is retired by the same
 * function that created it; naming it well is a courtesy to anybody watching the
 * account's device list during those few seconds, not a property anything rests
 * on.
 */
export function webDeviceInsertRequest(input: WebDeviceInput): HttpRequest {
  return {
    method: "POST",
    path: postgrestPath("devices", [["select", "id"]]),
    headers: { "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: input.userId,
      session_id: input.sessionId,
      name_nonce: input.deviceName.nonce,
      name_ciphertext: input.deviceName.ciphertext,
    }),
  };
}

/**
 * Retires the bootstrap row and gives it a readable name on the way out.
 *
 * ONE REQUEST BECAUSE IT IS ONE FACT. The row was written before this machine
 * could open the master key, so its name is 17 bytes of noise — nothing can ever
 * decrypt it, and `devices` rows are never deleted, so that noise would sit in
 * the account's device list forever as an entry no browser and no desktop can
 * read. Now that MK is open the real name can be sealed, and the same PATCH that
 * ends the row's life writes it: history the user can read, rather than a
 * permanent question mark next to a date.
 *
 * `Prefer: return=representation` for the same reason `retireDeviceRequest` uses
 * it — a PATCH matching no row is 200 with an empty array, and „the scaffolding
 * is gone" is a claim, not a hope.
 *
 * `deviceName` is `web`-bound, exactly as at the insert: this row's platform did
 * not change because its name did. See {@link WebDeviceInput.deviceName}.
 */
export function retireBootstrapDeviceRequest(
  deviceId: string,
  deviceName: SealedNameFields,
  nowIso: string,
): HttpRequest {
  if (!UUID.test(deviceId)) {
    throw new TypeError(`sync: not a device id: ${JSON.stringify(deviceId)}`);
  }
  return {
    method: "PATCH",
    path: postgrestPath("devices", [
      ["id", `eq.${deviceId}`],
      ["select", "id"],
    ]),
    headers: { "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      name_nonce: deviceName.nonce,
      name_ciphertext: deviceName.ciphertext,
      revoked_at: nowIso,
    }),
  };
}

/**
 * The recovery wrap, and only it.
 *
 * `keyWrapReadbackRequest` asks for both master-key slots because the mint's
 * verification compares both. Here the caller is a session that is not a desktop
 * yet, and `key_wraps_master_key_is_desktop_only` is a RESTRICTIVE policy — so
 * `mk_under_kwrap` would not come back anyway. Asking for one row rather than
 * filtering two is the difference between „the server withheld it" and „it was
 * never wanted", and only one of those is a fact a caller can act on.
 */
export function recoveryWrapRequest(): HttpRequest {
  return {
    method: "GET",
    path: postgrestPath("key_wraps", [
      ["select", KEY_WRAP_COLUMNS],
      ["kind", "eq.mk_under_src"],
    ]),
    headers: {},
    body: null,
  };
}

/** The recovery slot in this package's units: every byte field is base64url. */
export interface RecoveryWrapRow {
  readonly nonce: string;
  readonly wrapped: string;
  readonly commitTag: string;
  readonly kdfSalt: string;
  readonly kdfParams: Argon2idParams;
}

/** A first row that reads like a first row, or null. */
function first(rows: readonly unknown[]): Record<string, unknown> | null {
  const row = rows[0];
  return typeof row === "object" && row !== null && !Array.isArray(row)
    ? (row as Record<string, unknown>)
    : null;
}

/** PostgREST answers `bytea` as hex; this package's callers speak base64url. */
function bytes(value: unknown): string | null {
  return byteaToBase64url(value);
}

function params(value: unknown): Argon2idParams | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const memoryKiB = record["memoryKiB"];
  const iterations = record["iterations"];
  const parallelism = record["parallelism"];
  if (
    typeof memoryKiB !== "number" ||
    typeof iterations !== "number" ||
    typeof parallelism !== "number"
  ) {
    return null;
  }
  return { memoryKiB, iterations, parallelism };
}

/**
 * Reads the recovery row, or answers null.
 *
 * Never throws, and every field is checked rather than cast: this is a server's
 * answer, the server is not trusted, and the next thing that happens to these
 * bytes is an Argon2id run and an AEAD open. A missing `kdf_salt` in particular
 * must be caught HERE — migration 009 made the salt belong to the recovery slot
 * alone, so a null one means the row is not the row this thinks it is.
 */
export function parseRecoveryWrapRows(rows: readonly unknown[]): RecoveryWrapRow | null {
  const row = first(rows);
  if (row === null) return null;
  const nonce = bytes(row["nonce"]);
  const wrapped = bytes(row["wrapped"]);
  const commitTag = bytes(row["commit_tag"]);
  const kdfSalt = bytes(row["kdf_salt"]);
  const kdfParams = params(row["kdf_params"]);
  if (!nonce || !wrapped || !commitTag || !kdfSalt || !kdfParams) return null;
  return { nonce, wrapped, commitTag, kdfSalt, kdfParams };
}

/** The id PostgREST hands back for the row just inserted, or null. */
export function parseInsertedDeviceId(rows: readonly unknown[]): string | null {
  const row = first(rows);
  const id = row?.["id"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

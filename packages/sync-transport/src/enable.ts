/**
 * The `sync-enable` call: the request, every answer it can give, and the check
 * that what the server stored is what the desktop sent.
 *
 * ─── Why this file speaks base64url strings and not `SealedKey` ─────────────
 *
 * `@nexus/sync-crypto`'s desktop barrel holds the two capabilities `web.ts`
 * exists to withhold — minting a master key and deriving K_wrap. This package is
 * imported by the browser build (that is why `bytea.ts` imports from
 * `@nexus/sync-crypto/web` and not from the main barrel), so a `import type {
 * SealedKey }` here would put the desktop barrel on a browser bundle's import
 * graph and make `scripts/web-key-surface.test.mjs` right to complain.
 *
 * The inputs below are therefore STRUCTURAL: any object with the three
 * base64url fields a `SealedKey` has satisfies them, so the desktop passes its
 * `SealedKey` unchanged and nothing is copied by hand. The one rename in the
 * product — `SealedKey.ciphertext`/`commitment` to the server's
 * `wrapped`/`commit_tag` — happens once, in {@link syncEnableRequest}, and the
 * round-trip check below reads it back.
 *
 * ─── What „verified" means here ─────────────────────────────────────────────
 *
 * `prepareSyncEnable` has already proved the wraps open back to the master key,
 * so what remains to be proved is only that the SERVER holds those same bytes.
 * {@link syncEnableRoundTripProblem} is a byte comparison and deliberately not a
 * second decryption: it needs no key, so the desktop can run it after K_wrap and
 * the recovery key are gone, and the two facts compose — these bytes open to MK,
 * and the server has these bytes.
 */

import { base64urlToBytes, bytesToBase64url, type Argon2idParams } from "@nexus/sync-crypto/web";

import { byteaToBase64url } from "./bytea.js";
import {
  jsonHeaders,
  postgrestPath,
  type FunctionPort,
  type FunctionRequest,
  type HttpRequest,
  type HttpResponse,
} from "./http.js";

/** The function's name at `/functions/v1/…`. The port builds the rest of the URL. */
export const SYNC_ENABLE_FUNCTION = "sync-enable";

/**
 * The header carrying the ephemeral `aal2` token that authorises this one mint.
 *
 * A header and not a body field, and the endpoint's own header says why: a
 * bearer token in a JSON field ends up in request logs, replay fixtures and
 * error reports. The name is spelled here and in the Edge Function, which is one
 * copy too many and unavoidable — the two live in different runtimes with no
 * shared module — so `supabase/tests/static/` pins them to each other.
 */
export const AUTHORISING_TOKEN_HEADER = "x-nexus-authorising-token";

/** A wrap as the crypto layer produces it: three unpadded base64url fields. */
export interface SealedKeyFields {
  readonly nonce: string;
  readonly ciphertext: string;
  readonly commitment: string;
}

/** A sealed device name as the crypto layer produces it. */
export interface SealedNameFields {
  readonly nonce: string;
  readonly ciphertext: string;
}

/** Everything `sync-enable` needs, in the units this package speaks. */
export interface SyncEnableInput {
  /** The ephemeral `aal2` access token. Used once, then signed out by the caller. */
  readonly authorisingToken: string;
  /** The device name under a subkey of MK. */
  readonly deviceName: SealedNameFields;
  /** MK under K_wrap — becomes `mk_under_kwrap`. Carries no salt; K_wrap's is derived. */
  readonly passwordWrap: SealedKeyFields;
  readonly passwordKdfParams: Argon2idParams;
  /** MK under the Sync Recovery Code — becomes `mk_under_src`. */
  readonly recoveryWrap: SealedKeyFields;
  readonly recoveryKdfParams: Argon2idParams;
  /** The recovery salt, base64url, 16 bytes. Stored beside the recovery wrap. */
  readonly recoverySalt: string;
  /**
   * The device-registration proof, base64url, 32 bytes — HKDF over MK.
   *
   * It travels with the MINT and nowhere else, because the mint is the only
   * transaction that can store it: `private.mk_verifiers` has no client grants,
   * so nothing can add it afterwards. An account minted without one could never
   * register a second desktop, and a desktop whose session died would be
   * stranded with the key on its own disk. Migration 013 carries the argument.
   */
  readonly registerProof: string;
}

/** The JSON body, in the server's spelling. Exported so a test can read it. */
export interface SyncEnableBody {
  readonly device_name_nonce: string;
  readonly device_name_ciphertext: string;
  readonly kwrap: {
    readonly nonce: string;
    readonly wrapped: string;
    readonly commit_tag: string;
    readonly kdf_params: Argon2idParams;
  };
  readonly src: {
    readonly nonce: string;
    readonly wrapped: string;
    readonly commit_tag: string;
    readonly kdf_salt: string;
    readonly kdf_params: Argon2idParams;
  };
  readonly mk_verifier: string;
}

export function syncEnableBody(input: SyncEnableInput): SyncEnableBody {
  return {
    device_name_nonce: input.deviceName.nonce,
    device_name_ciphertext: input.deviceName.ciphertext,
    // NO `kdf_salt` ON THIS SLOT. `key_wraps_kdf_salt_presence` refuses one, and
    // so does the endpoint: K_wrap's salt is SHA-256("nexus/web-kdf/v1" ‖
    // lowercase(email)), derived on every device and never stored.
    kwrap: {
      nonce: input.passwordWrap.nonce,
      wrapped: input.passwordWrap.ciphertext,
      commit_tag: input.passwordWrap.commitment,
      kdf_params: input.passwordKdfParams,
    },
    src: {
      nonce: input.recoveryWrap.nonce,
      wrapped: input.recoveryWrap.ciphertext,
      commit_tag: input.recoveryWrap.commitment,
      kdf_salt: input.recoverySalt,
      kdf_params: input.recoveryKdfParams,
    },
    mk_verifier: input.registerProof,
  };
}

export function syncEnableRequest(input: SyncEnableInput): FunctionRequest {
  return {
    name: SYNC_ENABLE_FUNCTION,
    headers: { ...jsonHeaders(), [AUTHORISING_TOKEN_HEADER]: input.authorisingToken },
    body: JSON.stringify(syncEnableBody(input)),
  };
}

/**
 * Every way the mint can refuse, named.
 *
 * These are the `error` strings the Edge Function sends, not a re-interpretation
 * of them: each one needs a different sentence on the desktop — „confirm your
 * email address" is not „turn on two-factor" — and collapsing them into „failed"
 * would leave a user with a spinner and no next step. `unknown` is a server that
 * answered something this client was not written against, which is itself a fact
 * worth showing rather than a case to guess at.
 */
export type SyncEnableRefusal =
  | "unauthenticated"
  | "session_not_live"
  | "second_factor_required"
  | "factor_must_predate_session"
  | "email_not_confirmed"
  | "sessions_from_different_accounts"
  | "sessions_must_differ"
  | "bad_request"
  | "rejected_by_schema"
  | "mint_failed"
  | "unavailable"
  | "unknown";

const KNOWN_REFUSALS: readonly SyncEnableRefusal[] = [
  "unauthenticated",
  "session_not_live",
  "second_factor_required",
  "factor_must_predate_session",
  "email_not_confirmed",
  "sessions_from_different_accounts",
  "sessions_must_differ",
  "bad_request",
  "rejected_by_schema",
  "mint_failed",
  "unavailable",
];

export type SyncEnableResult =
  /**
   * This device minted the account's master key. `deviceId` is read back by the
   * endpoint rather than assumed, and it is null when the row could not be read
   * — the mint still happened, so this is „enabled, device id unknown" and not a
   * failure.
   */
  | { readonly outcome: "minted"; readonly deviceId: string | null }
  /**
   * An MK already exists and this device did not choose it. There is no
   * adoption path by design: the routes to an existing MK are pairing with a
   * device that holds it and the Recovery Kit, and both are proofs a password
   * thief does not have.
   */
  | { readonly outcome: "already_minted" }
  | {
      readonly outcome: "refused";
      readonly reason: SyncEnableRefusal;
      readonly httpStatus: number;
      readonly detail: string | null;
    };

/**
 * Reads the endpoint's answer. Never throws: the body is a server's, and a
 * server this client cannot parse is a fact to report, not an exception to let a
 * hostile party raise inside the caller.
 */
export function parseSyncEnableResponse(response: HttpResponse): SyncEnableResult {
  let value: unknown;
  try {
    value = JSON.parse(response.body);
  } catch {
    value = null;
  }
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const detail = typeof record["detail"] === "string" ? record["detail"] : null;

  if (response.status === 200) {
    const status = record["status"];
    if (status === "already_minted") return { outcome: "already_minted" };
    if (status === "minted") {
      const id = record["device_id"];
      return { outcome: "minted", deviceId: typeof id === "string" ? id : null };
    }
    // A 200 that says neither is not a success this client can act on: it would
    // leave the desktop believing sync is on with no master key behind it.
    return { outcome: "refused", reason: "unknown", httpStatus: 200, detail };
  }

  const error = record["error"];
  const reason = KNOWN_REFUSALS.find((known) => known === error) ?? "unknown";
  return { outcome: "refused", reason, httpStatus: response.status, detail };
}

/** Builds the request, calls the port, reads the answer. */
export async function enableSync(
  port: FunctionPort,
  input: SyncEnableInput,
): Promise<SyncEnableResult> {
  return parseSyncEnableResponse(await port(syncEnableRequest(input)));
}

// ---------------------------------------------------------------------------
// Reading the mint back
// ---------------------------------------------------------------------------
/** The columns the verification compares. `id` is absent: nothing here is about it. */
export const KEY_WRAP_COLUMNS = "kind,nonce,wrapped,commit_tag,kdf_salt,kdf_params";

/**
 * The two master-key rows of the signed-in account.
 *
 * No `user_id` filter, and that is not an omission: `key_wraps` is under row
 * level security and the policy scopes every select to `auth.uid()`, so a filter
 * here would be a second opinion about identity taken from a token this package
 * does not hold. Filtering on `kind` is different — it is about which rows are
 * wanted, not which account they belong to.
 */
export function keyWrapReadbackRequest(): HttpRequest {
  return {
    method: "GET",
    path: postgrestPath("key_wraps", [
      ["select", KEY_WRAP_COLUMNS],
      ["kind", "in.(mk_under_kwrap,mk_under_src)"],
    ]),
    headers: {},
    body: null,
  };
}

/**
 * Compares what the server stored against what was sent, and names the first
 * difference — or returns null when the two agree in every byte.
 *
 * A STRING RATHER THAN A BOOLEAN, because the caller's next action is to refuse
 * to turn sync on and say why, and „the wraps do not match" is not something a
 * user or a log can act on. The message is English: it is a developer-facing
 * fault report, not user copy.
 *
 * A mismatch is not an ordinary condition. It means the mint stored something
 * other than what this desktop composed, which is either a server that rewrote
 * it or a client that sent a different thing than it kept — and in both cases
 * continuing would leave an account whose master key nothing can recover.
 */
export function syncEnableRoundTripProblem(
  input: SyncEnableInput,
  rows: readonly unknown[],
): string | null {
  const expected = syncEnableBody(input);
  const wanted = [
    { kind: "mk_under_kwrap", wrap: expected.kwrap, salt: null as string | null },
    { kind: "mk_under_src", wrap: expected.src, salt: expected.src.kdf_salt },
  ];

  const records = rows.map(asRecord).filter((row): row is Record<string, unknown> => row !== null);

  for (const { kind, wrap, salt } of wanted) {
    const matches = records.filter((row) => row["kind"] === kind);
    const row = matches[0];
    if (matches.length !== 1 || row === undefined) {
      return `expected exactly one ${kind} row, the server returned ${matches.length}`;
    }

    for (const [column, sent] of [
      ["nonce", wrap.nonce],
      ["wrapped", wrap.wrapped],
      ["commit_tag", wrap.commit_tag],
      ["kdf_salt", salt],
    ] as const) {
      const problem = compareBytes(`${kind}.${column}`, row[column], sent);
      if (problem !== null) return problem;
    }

    const paramProblem = kdfParamsProblem(kind, row["kdf_params"], wrap.kdf_params);
    if (paramProblem !== null) return paramProblem;
  }

  return null;
}

/**
 * One `bytea` column against the base64url this device sent, compared as BYTES.
 *
 * Both sides are put through the same canonical encoder rather than compared as
 * text. `byteaToBase64url` accepts upper-case hex, which Postgres does not emit
 * but the format permits, and `base64urlToBytes` refuses padding and the
 * standard `+`/`/` alphabet outright — so „the same bytes spelled differently"
 * would otherwise read as tampering, and refuse to enable sync on an account
 * where nothing is wrong.
 *
 * `null` on either side means „no value here", and it is compared in BOTH
 * directions: a salt appearing on the slot that must not have one is as much a
 * corruption as a wrong salt, and a check written only as „if we sent one, it
 * matches" would walk past it.
 */
function compareBytes(field: string, stored: unknown, sent: string | null): string | null {
  if (sent === null) {
    return stored === null || stored === undefined ? null : `${field} is set, and must not be`;
  }
  if (stored === null || stored === undefined) return `${field} is missing`;

  const theirs = byteaToBase64url(stored);
  if (theirs === null) return `${field} is not a bytea`;

  const bytes = base64urlToBytes(sent);
  // A client bug, not a server one, and worth saying so: everything on this side
  // was produced by `@nexus/sync-crypto`, which emits canonical base64url only.
  if (bytes === null) return `${field} was not canonical base64url when this device sent it`;

  return theirs === bytesToBase64url(bytes)
    ? null
    : `${field} is not the value this device sent`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The three cost parameters, compared one by one.
 *
 * Not `JSON.stringify` on both sides: `jsonb` does not preserve key order, so a
 * server that stored exactly the right object would fail a string comparison
 * roughly half the time. Field-by-field is also what makes the failure legible —
 * „iterations is 1, this device sent 3" names the downgrade.
 */
function kdfParamsProblem(kind: string, stored: unknown, sent: Argon2idParams): string | null {
  const record = asRecord(stored);
  if (record === null) return `${kind}.kdf_params is not an object`;
  const keys = ["memoryKiB", "iterations", "parallelism"] as const;
  // The count as well as the values. An object carrying a fourth key is storage
  // this device did not ask for and a schema this client does not implement, and
  // a per-key loop alone would walk straight past it.
  if (Object.keys(record).length !== keys.length) {
    return `${kind}.kdf_params has ${Object.keys(record).length} keys, this device sent ${keys.length}`;
  }
  for (const key of keys) {
    if (record[key] !== sent[key]) {
      return `${kind}.kdf_params.${key} is ${String(record[key])}, this device sent ${sent[key]}`;
    }
  }
  return null;
}

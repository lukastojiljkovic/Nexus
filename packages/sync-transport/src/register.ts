/**
 * Asking for a device row back, after this desktop has lost its session.
 *
 * ─── What this is for ──────────────────────────────────────────────────────
 *
 * A `devices` row binds one client to one auth session and its `session_id` is
 * immutable. Sessions die on their own — verifying an MFA factor revokes every
 * OTHER session the account holds, so a second machine merely ATTEMPTING to
 * enable sync ends the first machine's session — and a desktop whose session has
 * died is refused every read and every write while the master key sits unopened
 * on its own disk. This endpoint is the way back, and migration 013 carries the
 * whole argument for its price.
 *
 * ─── The price, in one sentence, because it is the reason this file exists ──
 *
 * It costs the MASTER KEY and not the second factor. A `platform = 'desktop'`
 * row is what `key_wraps_master_key_is_desktop_only` accepts as authority over
 * `mk_under_kwrap`, and K_wrap comes from the web password — so „password plus
 * TOTP ⇒ a desktop row" would be „password plus TOTP ⇒ MK", which is that policy
 * repealed. And a step-up would revoke every sibling desktop's session, so two
 * machines would take turns rescuing and stranding each other, forever.
 *
 * ─── What crosses the wire ─────────────────────────────────────────────────
 *
 * One bearer token (the fresh `aal1` device session), the 32-byte proof, and the
 * device name sealed under a subkey of MK. No password, no wrap, no key.
 */

import { jsonHeaders, type FunctionPort, type FunctionRequest, type HttpResponse } from "./http.js";
import type { SealedNameFields } from "./enable.js";

export const DEVICE_REGISTER_FUNCTION = "device-register";

/** Everything `device-register` needs, in the units this package speaks. */
export interface DeviceRegisterInput {
  /**
   * The proof of master-key possession, base64url, 32 bytes.
   *
   * Derived offline from the MK this desktop already holds at rest, which is the
   * point: the machine that has to prove something is the machine that cannot
   * currently ask the server for anything.
   */
  readonly proof: string;
  /** What this machine is called, under a subkey of MK. */
  readonly deviceName: SealedNameFields;
}

/** The JSON body, in the server's spelling. Exported so a test can read it. */
export interface DeviceRegisterBody {
  readonly mk_verifier: string;
  readonly device_name_nonce: string;
  readonly device_name_ciphertext: string;
}

export function deviceRegisterBody(input: DeviceRegisterInput): DeviceRegisterBody {
  return {
    mk_verifier: input.proof,
    device_name_nonce: input.deviceName.nonce,
    device_name_ciphertext: input.deviceName.ciphertext,
  };
}

/**
 * No second token, unlike `sync-enable`.
 *
 * The mint takes two because it needs an `aal2` session to authorise it and must
 * keep the desktop's own session `aal1`. Here the authorisation IS the proof, and
 * the single session in play is the one the row will name — so a second token
 * would be a second thing to get wrong, and the endpoint refuses an `aal2`
 * session outright (NX405).
 */
export function deviceRegisterRequest(input: DeviceRegisterInput): FunctionRequest {
  return {
    name: DEVICE_REGISTER_FUNCTION,
    headers: jsonHeaders(),
    body: JSON.stringify(deviceRegisterBody(input)),
  };
}

/**
 * Every way registration can refuse, named.
 *
 * `proof_rejected` is the one that matters and the one whose sentence must be
 * exact: it means this machine does not hold the account's master key, and the
 * ways to get it are pairing with a machine that does or the Recovery Kit — not
 * „try again".
 */
export type DeviceRegisterRefusal =
  | "unauthenticated"
  | "session_not_live"
  /** The session was stepped up. A desktop's working session must be `aal1`. */
  | "session_not_aal1"
  /** The account has never minted, so there is nothing to prove possession of. */
  | "not_enabled"
  /** The proof did not match. This machine does not hold MK. */
  | "proof_rejected"
  /** Twenty live desktops already. The way out is the web device list. */
  | "too_many_devices"
  | "bad_request"
  /**
   * The endpoint's own validation let a payload through that the schema then
   * refused. That is a defect in one of the two and never something the user can
   * act on — named rather than folded into `unknown` so a bug report can say
   * which of the two it was.
   */
  | "rejected_by_schema"
  | "register_failed"
  | "unavailable"
  | "unknown";

const KNOWN_REFUSALS: readonly DeviceRegisterRefusal[] = [
  "unauthenticated",
  "session_not_live",
  "session_not_aal1",
  "not_enabled",
  "proof_rejected",
  "too_many_devices",
  "bad_request",
  "rejected_by_schema",
  "register_failed",
  "unavailable",
];

export type DeviceRegisterResult =
  /** This session now owns a live desktop row. `deviceId` is the row the server wrote. */
  | { readonly outcome: "registered"; readonly deviceId: string }
  | {
      readonly outcome: "refused";
      readonly reason: DeviceRegisterRefusal;
      readonly httpStatus: number;
      readonly detail: string | null;
    };

/**
 * Reads the endpoint's answer. Never throws, for the reason
 * `parseSyncEnableResponse` does not: the body is a server's, and a server this
 * client cannot parse is a fact to report rather than an exception to let a
 * hostile party raise inside the caller.
 */
export function parseDeviceRegisterResponse(response: HttpResponse): DeviceRegisterResult {
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
    const id = record["device_id"];
    // A 200 WITHOUT AN ID IS A REFUSAL HERE, and deliberately not the „enabled,
    // device id unknown" the mint allows itself. There, the mint had already
    // happened and the id was a convenience. Here the id IS the outcome: without
    // it the caller has no way to write `last_seen_at` or to retire this machine
    // later, and „registered" would be a claim nothing behind it supports.
    if (typeof id === "string" && id.length > 0) return { outcome: "registered", deviceId: id };
    return { outcome: "refused", reason: "unknown", httpStatus: 200, detail };
  }

  const error = record["error"];
  const reason = KNOWN_REFUSALS.find((known) => known === error) ?? "unknown";
  return { outcome: "refused", reason, httpStatus: response.status, detail };
}

/** Builds the request, calls the port, reads the answer. */
export async function registerDevice(
  port: FunctionPort,
  input: DeviceRegisterInput,
): Promise<DeviceRegisterResult> {
  return parseDeviceRegisterResponse(await port(deviceRegisterRequest(input)));
}

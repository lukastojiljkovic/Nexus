/**
 * Turning sync on: four network round trips in an order that is a protocol, and
 * one master key that must never exist in two versions.
 *
 * ─── The order, and why nothing here may be reordered ───────────────────────
 *
 * `supabase/functions/sync-enable/index.ts` derives it from a measured fact:
 * **verifying an MFA factor revokes every other session the account holds.** So
 *
 *   1. sign in                       → a session at `aal1`
 *   2. challenge + verify the factor → THAT session becomes `aal2`, and every
 *                                      other session on the account dies. This
 *                                      is the AUTHORISING session.
 *   3. sign in again                 → the DEVICE session, `aal1`, created after
 *                                      the revocation and therefore surviving it
 *   4. call `sync-enable` with both
 *   5. sign the authorising session out
 *
 * Backwards — device session first — the desktop destroys its own device session
 * at step 2 and the endpoint answers 401, which says nothing about ordering and
 * is the sort of failure somebody debugs for a day.
 *
 * ─── Why the password is put through Argon2id twice ─────────────────────────
 *
 * Signing in needs K_auth; wrapping MK needs K_wrap; both come out of one
 * 64 MiB Argon2id run, so deriving once and keeping the pair would be the
 * instinct. It would also mean holding K_wrap — the one key this whole design
 * keeps away from everything that does not need it — in memory across four
 * network round trips and a user typing a six-digit code. `prepareSyncEnable`
 * derives its own, uses it, and erases it in a `finally`; the second run costs
 * a few hundred milliseconds on a flow that happens once per computer, and buys
 * back the property that K_wrap's lifetime is one function call.
 *
 * ─── What this function does NOT do ─────────────────────────────────────────
 *
 * It does not store anything. The local wrap, the recovery code and the master
 * key come back to the caller, which owns every byte of them — including
 * zeroizing {@link EnabledSync.masterKey} when the session that holds it ends.
 * Storage is a database concern and this file has no database in it, which is
 * also what lets it be tested against three fake ports and nothing else.
 */

import {
  WEB_KDF_PARAMS,
  bytesToBase64url,
  deriveWebAuthPassword,
  normalizeWebEmail,
  prepareSyncEnable,
  zeroize,
  type CryptoPort,
  type SealedKey,
  type WebPasswordInput,
} from "@nexus/sync-crypto";
import {
  enableSync,
  keyWrapReadbackRequest,
  listTotpFactors,
  parseRows,
  signIn,
  signOut,
  startChallenge,
  syncEnableRoundTripProblem,
  verifyChallenge,
  type AuthRefusal,
  type AuthSession,
  type SyncEnableInput as SyncEnableWireInput,
  type SyncEnableRefusal,
} from "@nexus/sync-transport";

import type { CloudPorts } from "./port.js";
import type { SessionHolder } from "./session.js";

export interface EnableSyncInput {
  readonly email: string;
  /** The password the user typed. Never sent — see the header. */
  readonly password: string;
  /** Six digits from the authenticator app. */
  readonly totpCode: string;
  /** What this computer is called, in the clear only in this process. */
  readonly deviceName: string;
  /** The desktop's existing SQLCipher data key (DK). */
  readonly localDataKey: Uint8Array;
  /**
   * Which second factor to use, when the account has more than one. Absent is
   * the normal case: the web app enrols exactly one.
   */
  readonly factorId?: string;
}

export interface EnableSyncDeps {
  readonly crypto: CryptoPort;
  readonly ports: CloudPorts;
  /**
   * Receives the DEVICE session — and only it. The authorising session never
   * reaches the holder, which refuses `aal2` outright.
   */
  readonly holder: SessionHolder;
}

export interface EnabledSync {
  readonly kind: "enabled";
  /** Read back by the endpoint; null means the mint happened and the row was not read. */
  readonly deviceId: string | null;
  /** Shown to the user ONCE and never stored. */
  readonly recoveryCode: string;
  /** MK under DK. The caller persists this; it is the only wrap that stays here. */
  readonly localWrap: SealedKey;
  /** **The caller must zeroize this** when the session holding it ends. */
  readonly masterKey: Uint8Array;
}

/**
 * Everything that can stop the flow, as one flat set.
 *
 * Flat on purpose: the screen showing this has one message per reason, and a
 * caller that had to first ask „was it an auth failure or a mint failure" would
 * be re-deriving a distinction that means nothing to the person reading it.
 */
export type EnableRefusal =
  | AuthRefusal
  | SyncEnableRefusal
  /** The account has several second factors and the caller named none. */
  | "mfa_ambiguous"
  /** The verify call succeeded and the session did not come back at `aal2`. */
  | "step_up_failed"
  /** The server stored something other than what this desktop sent. */
  | "round_trip_mismatch";

export type EnableSyncResult =
  | EnabledSync
  /**
   * An MK already exists and this device did not choose it. There is no
   * adoption path by design — the routes to an existing MK are pairing and the
   * Recovery Kit, and both are proofs a password thief does not have.
   */
  | { readonly kind: "already_minted" }
  | { readonly kind: "refused"; readonly reason: EnableRefusal; readonly detail: string | null };

const refused = (reason: EnableRefusal, detail: string | null = null): EnableSyncResult => ({
  kind: "refused",
  reason,
  detail,
});

export async function enableSyncOnThisDevice(
  deps: EnableSyncDeps,
  input: EnableSyncInput,
): Promise<EnableSyncResult> {
  const { auth } = deps.ports;
  const email = normalizeWebEmail(input.email);
  const web: WebPasswordInput = { email, password: input.password, params: WEB_KDF_PARAMS };

  const authPassword = await deriveWebAuthPassword(deps.crypto, web);

  // ── 1. The first session ──────────────────────────────────────────────────
  const first = await signIn(auth, email, authPassword);
  if (!first.ok) return refused(first.reason, first.detail);

  // ── 2. The second factor, which the desktop reads and never enrols ────────
  const factors = await listTotpFactors(auth, first.value.accessToken);
  if (!factors.ok) return refused(factors.reason, factors.detail);
  const factor =
    input.factorId === undefined
      ? factors.value.length === 1
        ? factors.value[0]
        : undefined
      : factors.value.find((candidate) => candidate.id === input.factorId);
  if (factor === undefined) {
    // „None" and „several, none named" are different instructions: enrol one on
    // the web, versus choose which one. Naming them apart is the whole reason
    // this is not a single „mfa problem".
    return refused(factors.value.length === 0 ? "mfa_not_enrolled" : "mfa_ambiguous");
  }

  const challenge = await startChallenge(auth, first.value.accessToken, factor.id);
  if (!challenge.ok) return refused(challenge.reason, challenge.detail);

  // ── 3. The step-up, which also revokes every other session ────────────────
  const stepped = await verifyChallenge(
    auth,
    first.value.accessToken,
    factor.id,
    challenge.value,
    input.totpCode,
  );
  if (!stepped.ok) return refused(stepped.reason, stepped.detail);
  // GoTrue writes the assurance level on the session row, so a verify that
  // answered 200 without raising it means the account is not in the state the
  // mint requires — and `nexus_mk_mint` would refuse with NX302 four calls
  // later. Stopping here says the same thing at the point it became true.
  if (stepped.value.aal !== "aal2") return refused("step_up_failed");

  const authorising = stepped.value;
  try {
    return await mint(deps, input, web, authPassword, authorising);
  } finally {
    // Best effort, and that is defensible rather than resigned. A sign-out that
    // fails leaves an `aal2` session alive until GoTrue expires it — but its
    // token existed only in this process, is dropped on the next line, and was
    // never written anywhere. Nobody can present it. Retrying, by contrast,
    // would mean holding it longer.
    await signOut(auth, authorising.accessToken).catch(() => undefined);
  }
}

async function mint(
  deps: EnableSyncDeps,
  input: EnableSyncInput,
  web: WebPasswordInput,
  authPassword: string,
  authorising: AuthSession,
): Promise<EnableSyncResult> {
  const { auth, functions, http } = deps.ports;

  // ── 4. The device session: aal1, created after the revocation ─────────────
  const device = await signIn(auth, web.email, authPassword);
  if (!device.ok) return refused(device.reason, device.detail);
  if (device.value.sessionId === authorising.sessionId) {
    // The mint refuses this itself (NX306) and this check will never fire
    // against a correct auth server. It is here because the failure it prevents
    // — one session presented twice — is indistinguishable from success at
    // every layer above, and costs one comparison to rule out.
    return refused("sessions_must_differ");
  }
  // From here the REST port presents the device token, which is what the
  // readback below needs and what every later sync call will use.
  deps.holder.setSession(device.value);

  const material = await prepareSyncEnable(deps.crypto, {
    userId: device.value.userId,
    web,
    localDataKey: input.localDataKey,
    deviceName: input.deviceName,
  });

  // Every path from here that does not return `enabled` must erase MK: a master
  // key that was minted and not stored is a key nothing can recover and nothing
  // needs, and leaving it in memory is the only way it becomes a liability.
  const discard = (result: EnableSyncResult): EnableSyncResult => {
    zeroize(material.masterKey);
    return result;
  };

  const wire: SyncEnableWireInput = {
    authorisingToken: authorising.accessToken,
    deviceName: material.sealedDeviceName,
    passwordWrap: material.passwordWrap,
    passwordKdfParams: material.passwordKdfParams,
    recoveryWrap: material.recoveryWrap,
    recoveryKdfParams: material.recoveryKdfParams,
    recoverySalt: bytesToBase64url(material.recoverySalt),
    // Travels with the MINT and nowhere else, because the mint is the only
    // transaction that can store it. Without it this account could never
    // register a second desktop, and this very machine could never come back
    // from a dead session — see `device-register.ts` in `@nexus/sync-crypto`.
    registerProof: bytesToBase64url(material.registerProof),
  };

  // ── 5. The mint ───────────────────────────────────────────────────────────
  const minted = await enableSync(functions, wire);
  if (minted.outcome === "already_minted") return discard({ kind: "already_minted" });
  if (minted.outcome === "refused") return discard(refused(minted.reason, minted.detail));

  // ── 6. Reading it back, byte for byte ─────────────────────────────────────
  // Not belt-and-braces. The mint is the only moment this account's master key
  // comes into existence, and a server that stored something else — or a client
  // that sent something other than what it kept — produces an account whose key
  // nothing can recover, silently, and only discovers it the first time someone
  // signs in on a second machine.
  const readback = await http(keyWrapReadbackRequest());
  const rows = readback.status === 200 ? parseRows(readback.body) : null;
  if (rows === null) {
    return discard(
      refused("round_trip_mismatch", `the key wraps could not be read back (${readback.status})`),
    );
  }
  const problem = syncEnableRoundTripProblem(wire, rows);
  if (problem !== null) return discard(refused("round_trip_mismatch", problem));

  return {
    kind: "enabled",
    deviceId: minted.deviceId,
    recoveryCode: material.recoveryCode,
    localWrap: material.localWrap,
    masterKey: material.masterKey,
  };
}

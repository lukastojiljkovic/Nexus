/**
 * Getting this computer back onto its account, in the two steps it actually
 * takes.
 *
 * ─── Why there are two, and not one ────────────────────────────────────────
 *
 * A `devices` row binds one client to one auth SESSION, so „is this desktop
 * connected" is really two questions with different answers and different costs.
 *
 *  1. **Is this process holding a live session?** After every launch the answer
 *     is no — the holder is memory, and memory does not survive a restart. But
 *     the account row holds a refresh token, and a refresh keeps the SAME
 *     `session_id`, so the device row that names it is still the right one.
 *     Nothing has to be proved and nothing has to be typed: {@link resumeSync}
 *     is one request, and it is the normal case every single time.
 *  2. **Does that session still exist at all?** Sessions die. Verifying an MFA
 *     factor revokes every other session on the account, so a second machine
 *     merely ATTEMPTING to enable sync ends this one's; refresh tokens expire;
 *     the user signs out everywhere. Then the refresh fails, the device row
 *     names a session that is gone, and `nexus_session_is_live()` refuses
 *     everything — while the master key sits openable on this machine's own
 *     disk. {@link reconnectSync} is the way back, and it costs a password and a
 *     round trip that PROVES this computer holds MK.
 *
 * Keeping them apart is what stops the product asking for a password every time
 * it starts, and what stops it silently doing the expensive, account-visible
 * thing (a new device row) when a one-request refresh would have done.
 *
 * ─── Why re-registering costs MK and not the second factor ─────────────────
 *
 * Migration 013 carries the full argument; the short form is that a `devices`
 * row with `platform = 'desktop'` is authority over `mk_under_kwrap`, whose
 * opener is derived from the web password — so „password + TOTP ⇒ a desktop row"
 * would be „password + TOTP ⇒ the master key", and the policy that keeps a
 * phished password away from the root of the hierarchy would be worth nothing.
 * A step-up would also revoke every sibling desktop's session, so two machines
 * would take turns rescuing and stranding each other forever.
 *
 * So this file signs in ONCE, at `aal1`, and proves possession of MK with a value
 * derived from the key it already holds. There is no challenge and no clock: the
 * proof is deterministic, which is what lets a machine that cannot currently
 * reach the server compute it before it can.
 *
 * ─── What this file does not do ────────────────────────────────────────────
 *
 * It does not store anything and it does not open the database. The caller hands
 * it the account row and the data key, and takes back what to write.
 */

import {
  WEB_KDF_PARAMS,
  bytesToBase64url,
  deriveDeviceRegisterProof,
  deriveWebAuthPassword,
  normalizeWebEmail,
  sealDeviceName,
  unwrapKey,
  zeroize,
  type CryptoPort,
  type SealedKey,
} from "@nexus/sync-crypto";
import {
  refreshSession,
  registerDevice,
  signIn,
  type AuthRefusal,
  type AuthSession,
  type DeviceRegisterRefusal,
} from "@nexus/sync-transport";

import type { CloudPorts } from "./port.js";
import type { SessionHolder } from "./session.js";

export interface ReconnectDeps {
  readonly crypto: CryptoPort;
  readonly ports: CloudPorts;
  readonly holder: SessionHolder;
}

export interface ResumeSyncInput {
  /** From the stored account row. Null means this desktop has never kept one. */
  readonly refreshToken: string | null;
}

export type ResumeSyncResult =
  /** The session is live again, with the SAME `session_id` the device row names. */
  | { readonly kind: "resumed"; readonly session: AuthSession }
  /**
   * The token is gone or refused. Not an error to show: it is the ordinary end
   * of a session's life, and its answer is {@link reconnectSync}.
   */
  | { readonly kind: "expired" };

/**
 * One request, no password, no proof.
 *
 * A refresh that succeeds returns a session with the same `session_id` — GoTrue
 * rotates the refresh token, not the session — so the `devices` row that names it
 * is still valid and nothing about this account changes. That identity is the
 * whole reason this step exists rather than everything going through
 * {@link reconnectSync}: re-registering would mint a second device row for a
 * machine that already has a perfectly good one, and would ask for a password
 * the user has no reason to be typing.
 */
export async function resumeSync(
  deps: ReconnectDeps,
  input: ResumeSyncInput,
): Promise<ResumeSyncResult> {
  if (input.refreshToken === null) return { kind: "expired" };
  const refreshed = await refreshSession(deps.ports.auth, input.refreshToken);
  if (!refreshed.ok) return { kind: "expired" };
  // `setSession` refuses `aal2` outright, and that refusal is worth reaching:
  // a stored token belonging to a stepped-up session would otherwise become this
  // desktop's permanent identity, and `aal` survives every refresh.
  try {
    deps.holder.setSession(refreshed.value);
  } catch {
    return { kind: "expired" };
  }
  return { kind: "resumed", session: refreshed.value };
}

export interface ReconnectSyncInput {
  /** The account's own address, from the stored row rather than retyped. */
  readonly email: string;
  /** The web password. Never sent — `deriveWebAuthPassword` turns it into K_auth. */
  readonly password: string;
  /** What this machine is called. A new row, so it may legitimately be a new name. */
  readonly deviceName: string;
  /** MK under DK, from the stored row. Opened here and erased before returning. */
  readonly localWrap: SealedKey;
  /** The desktop's SQLCipher data key. The caller owns its lifetime. */
  readonly localDataKey: Uint8Array;
  /** The account uuid, which binds both the wrap and the proof. */
  readonly userId: string;
}

export type ReconnectRefusal =
  | AuthRefusal
  | DeviceRegisterRefusal
  /**
   * The stored wrap did not open under this computer's data key. The wrap or the
   * key is damaged; either way this machine no longer holds MK and the way back
   * is pairing or the Recovery Kit, not another attempt.
   */
  | "master_key_unreadable"
  /** Signing in produced a session for a different account than the stored one. */
  | "account_mismatch";

export type ReconnectSyncResult =
  | { readonly kind: "reconnected"; readonly session: AuthSession; readonly deviceId: string }
  | {
      readonly kind: "refused";
      readonly reason: ReconnectRefusal;
      readonly detail: string | null;
    };

const refused = (reason: ReconnectRefusal, detail: string | null = null): ReconnectSyncResult => ({
  kind: "refused",
  reason,
  detail,
});

/**
 * Signs in afresh and buys a new device row with a proof of master-key
 * possession.
 *
 * The order matters in one place: MK is opened FIRST, before any network call.
 * A machine whose local wrap will not open cannot be reconnected by anything
 * this function does, and finding that out after a sign-in would mean a session
 * created for nothing and a password held across a round trip that was never
 * going to help.
 */
export async function reconnectSync(
  deps: ReconnectDeps,
  input: ReconnectSyncInput,
): Promise<ReconnectSyncResult> {
  const email = normalizeWebEmail(input.email);

  let masterKey: Uint8Array;
  try {
    masterKey = await unwrapKey(deps.crypto, input.localDataKey, input.localWrap, {
      purpose: "mk/local-data-key",
      userId: input.userId,
    });
  } catch {
    return refused("master_key_unreadable");
  }

  try {
    const proof = await deriveDeviceRegisterProof(deps.crypto, masterKey, input.userId);
    const sealedName = await sealDeviceName(
      deps.crypto,
      masterKey,
      { userId: input.userId, platform: "desktop" },
      input.deviceName,
    );

    const authPassword = await deriveWebAuthPassword(deps.crypto, {
      email,
      password: input.password,
      params: WEB_KDF_PARAMS,
    });
    const session = await signIn(deps.ports.auth, email, authPassword);
    if (!session.ok) return refused(session.reason, session.detail);
    // The account the wrap is bound to and the account just signed into must be
    // the same one, or the proof is about a different key than the row it would
    // be attached to. It cannot happen with a stored address, which is why the
    // address is not retyped — but „cannot happen" is not a check.
    if (session.value.userId !== input.userId) return refused("account_mismatch");

    // The holder is set BEFORE the call, because `functions` presents whatever
    // token the holder has and this request must carry the session that will own
    // the row. A refusal below leaves it set, which is correct: the session is
    // real and live, it simply has no device row yet.
    try {
      deps.holder.setSession(session.value);
    } catch {
      // `signIn` cannot produce `aal2`, so this is unreachable against a correct
      // auth server. It costs one branch to make sure a surprising one cannot
      // hand this desktop browser powers for the life of the machine.
      return refused("session_not_aal1");
    }

    const registered = await registerDevice(deps.ports.functions, {
      proof: bytesToBase64url(proof),
      deviceName: sealedName,
    });
    if (registered.outcome === "refused") {
      return refused(registered.reason, registered.detail);
    }
    return { kind: "reconnected", session: session.value, deviceId: registered.deviceId };
  } finally {
    // MK is of no further use here in either direction: the caller keeps its
    // wrap, not the key, and re-opens it whenever something needs it.
    zeroize(masterKey);
  }
}

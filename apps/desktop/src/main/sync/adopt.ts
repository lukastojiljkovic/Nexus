/**
 * A second computer joining an account that already has a master key.
 *
 * ─── The circle, and the one door out of it ─────────────────────────────────
 *
 * `nexus_device_register` wants a proof derived from MK. MK lives in
 * `key_wraps`. Every read of `key_wraps` is gated on `nexus_session_is_live()`,
 * which wants a live `devices` row naming the caller's session. No key without a
 * row, no row without the key — and a machine that has never seen this account
 * has neither.
 *
 * The door is `devices_owner_insert`: a client may write its OWN row, and it
 * cannot write `platform`, so the row lands as `web`. What makes that safe is
 * `devices_insert_requires_aal2` — a session holding nothing but the password
 * cannot mint itself a voucher. So the flow is:
 *
 *   1. sign in                        → S1, `aal1`
 *   2. challenge + verify the factor  → S1 becomes `aal2`, and every OTHER
 *                                       session on the account dies
 *   3. insert a bootstrap `devices` row for S1 — the row lands as `web`, and S1
 *      is now live for row level security
 *   4. read `mk_under_src`, which migration 010 deliberately left readable by a
 *      session that is not a desktop, FOR THIS FLOW
 *   5. Argon2id(the Sync Recovery Code) → open the wrap → **MK**
 *   6. sign in again                   → S2, `aal1`, created after the
 *                                       revocation and therefore surviving it
 *   7. `device-register` under S2, paying the MK proof → a real `desktop` row
 *   8. rename and retire the bootstrap row, and sign S1 out
 *
 * Steps 1, 2, 6 and 8 are the mint's own order and for the mint's own reason:
 * verifying a factor revokes every other session, so the session this computer
 * KEEPS must be created after the step-up.
 *
 * ─── Why the scaffolding row is renamed rather than left ────────────────────
 *
 * At step 3 this machine cannot seal a device name — sealing needs MK, which is
 * what it is here to fetch — so the row goes up with 17 bytes of noise where a
 * name belongs. `devices` rows are never deleted, so that noise would sit in the
 * account's device list forever as an entry nothing can decrypt. Step 8 writes
 * the real sealed name and `revoked_at` in one PATCH: the history reads as a
 * name and a date rather than a permanent question mark.
 *
 * That name is sealed TWICE, under two different AADs, and the reason is worth a
 * sentence because getting it wrong is invisible. `deviceNameAad` binds the
 * platform, and `openDeviceName` rebuilds it from what the SERVER says the row
 * is — so a name bound to `desktop` written into a row the schema calls `web`
 * authenticates for nobody. The scaffolding gets a `web`-bound name and the real
 * row gets a `desktop`-bound one: same words to the user, two ciphertexts,
 * because they are two rows and each is read through its own platform.
 *
 * ─── Why this is not an Edge Function ───────────────────────────────────────
 *
 * A `sync-adopt` function holding the service-role key could hand the recovery
 * wrap over in one call and skip the scaffolding entirely. It would also move
 * the decision „may this caller read this account's wrap" out of row level
 * security and into TypeScript I would have to write, review and keep correct.
 * The database is the authority on tenancy; a function that re-derives it is a
 * second opinion that can disagree. The scaffolding row is the cheaper mistake.
 *
 * ─── What this file does not do ─────────────────────────────────────────────
 *
 * It stores nothing and opens no database. The caller hands it the data key and
 * takes back the wrap, the master key and the device id.
 */

import {
  WEB_KDF_PARAMS,
  assertDeviceName,
  base64urlToBytes,
  bytesToBase64url,
  deriveDeviceRegisterProof,
  deriveSyncRecoveryKey,
  deriveWebAuthPassword,
  normalizeWebEmail,
  sealDeviceName,
  unwrapKey,
  wrapKey,
  zeroize,
  type CryptoPort,
  type SealedDeviceName,
  type SealedKey,
} from "@nexus/sync-crypto";
import {
  listTotpFactors,
  parseInsertedDeviceId,
  parseRecoveryWrapRows,
  parseRows,
  recoveryWrapRequest,
  registerDevice,
  retireBootstrapDeviceRequest,
  signIn,
  signOut,
  startChallenge,
  verifyChallenge,
  webDeviceInsertRequest,
  type AuthRefusal,
  type AuthSession,
  type DeviceRegisterRefusal,
} from "@nexus/sync-transport";

import type { CloudPorts } from "./port.js";
import type { SessionHolder } from "./session.js";

export interface AdoptDeps {
  readonly crypto: CryptoPort;
  readonly ports: CloudPorts;
  /** Receives the DEVICE session (S2) and only it — the holder refuses `aal2`. */
  readonly holder: SessionHolder;
  readonly now: () => Date;
}

export interface AdoptSyncInput {
  readonly email: string;
  /** The web password. Never sent — `deriveWebAuthPassword` turns it into K_auth. */
  readonly password: string;
  /** Six digits from the authenticator app. */
  readonly totpCode: string;
  /** The Sync Recovery Code, as typed. Normalised inside `deriveSyncRecoveryKey`. */
  readonly recoveryCode: string;
  /** What this computer is called. */
  readonly deviceName: string;
  /** The desktop's existing SQLCipher data key (DK). The caller owns its lifetime. */
  readonly localDataKey: Uint8Array;
  /** Which factor, when the account has several. Absent is the normal case. */
  readonly factorId?: string;
}

export type AdoptRefusal =
  | AuthRefusal
  | DeviceRegisterRefusal
  /** The account has several second factors and the caller named none. */
  | "mfa_ambiguous"
  /** The verify call succeeded and the session did not come back at `aal2`. */
  | "step_up_failed"
  /** The bootstrap row could not be written, so nothing on this account is readable. */
  | "bootstrap_failed"
  /** This account has no `mk_under_src` row: sync was never enabled on it. */
  | "not_minted"
  /** The recovery code did not open the wrap. Nothing else is wrong. */
  | "recovery_code_rejected";

export interface AdoptedSync {
  readonly kind: "adopted";
  readonly deviceId: string;
  /** MK under DK. The caller persists this. */
  readonly localWrap: SealedKey;
  /** **The caller must zeroize this.** */
  readonly masterKey: Uint8Array;
  readonly userId: string;
  /** The normalised address, which is what a later sign-in must derive from. */
  readonly email: string;
  readonly refreshToken: string;
}

export type AdoptSyncResult =
  | AdoptedSync
  | { readonly kind: "refused"; readonly reason: AdoptRefusal; readonly detail: string | null };

const refused = (reason: AdoptRefusal, detail: string | null = null): AdoptSyncResult => ({
  kind: "refused",
  reason,
  detail,
});

/**
 * The bootstrap row's name, before there is a key to seal one with.
 *
 * A 24-byte nonce and 17 bytes of noise — the smallest thing the schema's CHECK
 * accepts, because it is not a name and pretending otherwise by making it longer
 * would only make it look like one. It is replaced with the real sealed name in
 * the same PATCH that retires the row.
 */
function placeholderName(port: CryptoPort): SealedDeviceName {
  return {
    nonce: bytesToBase64url(port.randomBytes(24)),
    ciphertext: bytesToBase64url(port.randomBytes(17)),
  };
}

export async function adoptWithRecoveryCode(
  deps: AdoptDeps,
  input: AdoptSyncInput,
): Promise<AdoptSyncResult> {
  const { auth } = deps.ports;
  // Before anything, because step 2 REVOKES every other session on the account.
  // Discovering at step 7 that this computer's name is unacceptable would mean
  // the user's other machines were signed out to learn it.
  assertDeviceName(input.deviceName);
  const email = normalizeWebEmail(input.email);
  const authPassword = await deriveWebAuthPassword(deps.crypto, {
    email,
    password: input.password,
    params: WEB_KDF_PARAMS,
  });

  // ── 1. The first session ──────────────────────────────────────────────────
  const first = await signIn(auth, email, authPassword);
  if (!first.ok) return refused(first.reason, first.detail);

  // ── 2. The second factor ──────────────────────────────────────────────────
  const factors = await listTotpFactors(auth, first.value.accessToken);
  if (!factors.ok) return refused(factors.reason, factors.detail);
  const factor =
    input.factorId === undefined
      ? factors.value.length === 1
        ? factors.value[0]
        : undefined
      : factors.value.find((candidate) => candidate.id === input.factorId);
  if (factor === undefined) {
    return refused(factors.value.length === 0 ? "mfa_not_enrolled" : "mfa_ambiguous");
  }

  const challenge = await startChallenge(auth, first.value.accessToken, factor.id);
  if (!challenge.ok) return refused(challenge.reason, challenge.detail);

  const stepped = await verifyChallenge(
    auth,
    first.value.accessToken,
    factor.id,
    challenge.value,
    input.totpCode,
  );
  if (!stepped.ok) return refused(stepped.reason, stepped.detail);
  // A 200 that did not raise the assurance level means the insert at step 3
  // would be refused by `devices_insert_requires_aal2` — with a PostgREST error
  // that says nothing about why. Stopping here says it at the point it is true.
  if (stepped.value.aal !== "aal2") return refused("step_up_failed");

  const authorising = stepped.value;
  try {
    return await adopt(deps, input, email, authPassword, authorising);
  } finally {
    // Best effort, exactly as the mint argues: a sign-out that fails leaves an
    // `aal2` token that existed only in this process and is dropped on the next
    // line. Retrying would mean holding it longer.
    await signOut(auth, authorising.accessToken).catch(() => undefined);
  }
}

async function adopt(
  deps: AdoptDeps,
  input: AdoptSyncInput,
  email: string,
  authPassword: string,
  authorising: AuthSession,
): Promise<AdoptSyncResult> {
  // The one port in the product that presents a token the holder will not keep.
  // Its two calls are the two that must be `aal2`; see `CloudPorts.httpAs`.
  const stepped = deps.ports.httpAs(authorising.accessToken);

  // ── 3. The bootstrap row ──────────────────────────────────────────────────
  const inserted = await stepped(
    webDeviceInsertRequest({
      userId: authorising.userId,
      sessionId: authorising.sessionId,
      deviceName: placeholderName(deps.crypto),
    }),
  );
  const insertedRows = inserted.status === 201 || inserted.status === 200
    ? parseRows(inserted.body)
    : null;
  const bootstrapId = insertedRows === null ? null : parseInsertedDeviceId(insertedRows);
  if (bootstrapId === null) {
    return refused("bootstrap_failed", `the bootstrap device row was refused (${inserted.status})`);
  }

  // Everything from here has a row to clean up, and it is cleaned up on every
  // path — including the ones that fail. A live `web` row for a session that is
  // about to be signed out is scaffolding nobody comes back for.
  //
  // The name it will be retired under is sealed as soon as there is a key to
  // seal with, and it belongs to this function rather than to `register`,
  // because the row does: it is bound to `platform: "web"`, which is what the
  // server will say this row is when somebody reads it back.
  let sealedName: SealedDeviceName | null = null;
  try {
    // ── 4. The recovery wrap ────────────────────────────────────────────────
    const response = await stepped(recoveryWrapRequest());
    const rows = response.status === 200 ? parseRows(response.body) : null;
    const wrap = rows === null ? null : parseRecoveryWrapRows(rows);
    if (wrap === null) {
      // No row, or a row this client will not use. Both mean the same thing to
      // the user: this account has no key to adopt, so sync was never enabled on
      // it, and the answer is to enable it here rather than to retype anything.
      return refused("not_minted");
    }

    // ── 5. The master key ───────────────────────────────────────────────────
    const salt = base64urlToBytes(wrap.kdfSalt);
    if (salt === null) return refused("not_minted", "the recovery salt was not base64url");
    let recoveryKey: Uint8Array;
    try {
      recoveryKey = await deriveSyncRecoveryKey(deps.crypto, {
        code: input.recoveryCode,
        salt,
        params: wrap.kdfParams,
      });
    } catch {
      // A malformed code, or parameters outside the band this client accepts.
      // Both are „that code will not do", and neither is worth two messages.
      return refused("recovery_code_rejected");
    }

    let masterKey: Uint8Array;
    try {
      masterKey = await unwrapKey(
        deps.crypto,
        recoveryKey,
        { v: 2, purpose: "mk/sync-recovery", nonce: wrap.nonce, ciphertext: wrap.wrapped, commitment: wrap.commitTag },
        { purpose: "mk/sync-recovery", userId: authorising.userId },
      );
    } catch {
      return refused("recovery_code_rejected");
    } finally {
      zeroize(recoveryKey);
    }

    try {
      sealedName = await sealDeviceName(
        deps.crypto,
        masterKey,
        { userId: authorising.userId, platform: "web" },
        input.deviceName,
      );
      return await register(deps, input, email, authPassword, authorising, masterKey);
    } finally {
      zeroize(masterKey);
    }
  } finally {
    // ── 8a. The scaffolding, named if a name was ever sealed ────────────────
    // `retireBootstrapDeviceRequest` needs a name, and on a failing path there
    // may be none — the row is retired with the placeholder it was born with,
    // because a revoked row nobody can name is still better than a live one.
    await deps.ports
      .httpAs(authorising.accessToken)(
        retireBootstrapDeviceRequest(
          bootstrapId,
          sealedName ?? placeholderName(deps.crypto),
          deps.now().toISOString(),
        ),
      )
      .catch(() => undefined);
  }
}

/**
 * Steps 6 and 7, with MK open.
 *
 * Split out so the `finally` that erases MK sits around exactly this and not
 * around the two network round trips that precede it.
 */
async function register(
  deps: AdoptDeps,
  input: AdoptSyncInput,
  email: string,
  authPassword: string,
  authorising: AuthSession,
  masterKey: Uint8Array,
): Promise<AdoptSyncResult> {
  const { auth, functions } = deps.ports;
  const userId = authorising.userId;

  // Bound to `desktop`, which is what the row this is about to buy will be. See
  // the header on why the scaffolding's copy of the same words is a different
  // ciphertext.
  const sealed = await sealDeviceName(
    deps.crypto,
    masterKey,
    { userId, platform: "desktop" },
    input.deviceName,
  );

  // ── 6. The session this computer keeps ────────────────────────────────────
  const device = await signIn(auth, email, authPassword);
  if (!device.ok) return refused(device.reason, device.detail);
  if (device.value.sessionId === authorising.sessionId) {
    // Unreachable against a correct auth server, and one comparison to rule out:
    // `nexus_device_register` refuses an `aal2` session (NX405), so this would
    // otherwise surface as a refusal that says nothing about ordering.
    return refused("session_not_aal1");
  }
  deps.holder.setSession(device.value);

  // ── 7. The real device row ────────────────────────────────────────────────
  const proof = await deriveDeviceRegisterProof(deps.crypto, masterKey, userId);
  const registered = await registerDevice(functions, {
    proof: bytesToBase64url(proof),
    deviceName: sealed,
  });
  if (registered.outcome === "refused") return refused(registered.reason, registered.detail);

  const localWrap = await wrapKey(deps.crypto, input.localDataKey, masterKey, {
    purpose: "mk/local-data-key",
    userId,
  });

  return {
    kind: "adopted",
    deviceId: registered.deviceId,
    localWrap,
    // A COPY, because the caller outlives the `finally` that erases the one this
    // function was given. Handing back the same array would hand back 32 zeroes.
    masterKey: Uint8Array.from(masterKey),
    userId,
    email,
    refreshToken: device.value.refreshToken,
  };
}

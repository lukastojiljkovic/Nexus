/**
 * Turning sync on, for the first desktop of an account: everything that has to
 * exist before `sync-enable` is called, produced in one place.
 *
 * ─── What „first" means, and why there is no second time ────────────────────
 *
 * `nexus_mk_mint` mints an account's master key exactly once and tells a caller
 * that arrives second only `already_minted` — no ciphertext, no salt, no route
 * to the key. That is deliberate (see the Edge Function's header: the web
 * password is assumed phishable, so knowing it must not be a way to adopt an
 * existing MK). The consequence for this file is that everything it produces is
 * *provisional* until the server says `minted`: a lost race means the master key
 * and the recovery code generated here are discarded unused, and the desktop
 * pairs or recovers instead. Nothing here writes anything.
 *
 * ─── Why it derives K_wrap itself instead of being handed it ────────────────
 *
 * The caller has already derived K_wrap once — `deriveWebPasswordKeys` returns
 * it alongside the sign-in password, and signing in is what produces the
 * `userId` this function needs. Taking it as a parameter would mean also taking
 * the Argon2id parameters as a parameter, and those two are then two facts that
 * must agree: the key was derived under *these* parameters, and *those*
 * parameters are what gets stored beside the wrap. When they disagree, the wrap
 * is stored under a cost nothing will ever reproduce and the account's master
 * key is unopenable by password forever — a permanent, silent, unrecoverable
 * loss, discovered on some future device.
 *
 * So this function takes the password and derives the key, and the parameters it
 * reports are, by construction, the parameters it used. It pays a second
 * Argon2id, once per account, ever.
 *
 * The same argument applies to the recovery code: the code, its salt, its
 * parameters and the wrap under it are produced together here and never
 * assembled from parts by a caller.
 *
 * ─── The self-check ─────────────────────────────────────────────────────────
 *
 * Every wrap is opened again before it is returned, and the result compared to
 * the master key. Two adapters implement {@link CryptoPort} — `node:crypto` plus
 * WASM Argon2 in Electron, WebCrypto plus the same WASM in a browser — and an
 * adapter that seals correctly but cannot open its own output is a defect whose
 * natural discovery point is a user's next device, months later, with the only
 * copy of the key already gone. Three unwraps at enable time cost nothing next
 * to the Argon2id that has just run, and they turn that into a failure here.
 *
 * ─── What this file does not know ───────────────────────────────────────────
 *
 * Column names, `bytea` spelling, HTTP. `@nexus/sync-transport` shapes the
 * request and verifies what came back; this package has never named a server
 * column and does not start here.
 */

import { constantTimeEqual, zeroize } from "./bytes.js";
import { assertDeviceName, sealDeviceName, type SealedDeviceName } from "./device-name.js";
import { deriveDeviceRegisterProof } from "./device-register.js";
import { SyncCryptoError } from "./errors.js";
import { deriveWebPasswordKeys, type WebPasswordInput } from "./kdf.js";
import { AEAD_KEY_BYTES, type Argon2idParams, type CryptoPort } from "./port.js";
import {
  SYNC_RECOVERY_KDF_PARAMS,
  deriveSyncRecoveryKey,
  generateSyncRecoveryCode,
  generateSyncRecoverySalt,
} from "./recovery.js";
import { generateMasterKey, unwrapKey, wrapKey, type SealedKey, type WrapContext } from "./wrap.js";

/** What {@link prepareSyncEnable} needs, and nothing it can derive for itself. */
export interface SyncEnableInput {
  /**
   * The account uuid, from the session that has just signed in. It binds every
   * wrap and the device name, so it is required rather than optional: a wrap
   * bound to the wrong account opens under the right key and decrypts nothing.
   */
  readonly userId: string;
  /**
   * The email, password and Argon2id cost — **the same object that was used to
   * sign in**. See the header on why the password is taken rather than the key
   * derived from it.
   */
  readonly web: WebPasswordInput;
  /**
   * The desktop's existing local data key (DK). MK is wrapped under it so the
   * desktop can open its own master key at rest without the web password, and
   * this is the ONE wrap that never leaves the machine.
   */
  readonly localDataKey: Uint8Array;
  /** What this machine is called. Validated by `device-name.ts` before anything is generated. */
  readonly deviceName: string;
}

/**
 * Everything the enable flow needs afterwards. The caller owns the lifetime of
 * every byte array here: {@link masterKey} is live key material and must be
 * zeroized when the session that holds it ends.
 */
export interface SyncEnableMaterial {
  /** The account's master key. Never leaves the desktop unwrapped. */
  readonly masterKey: Uint8Array;
  /**
   * The Sync Recovery Code, canonical (upper case, undashed). Shown to the user
   * ONCE, printed into the Recovery Kit, and never stored — the server holds
   * only a wrap it opens.
   */
  readonly recoveryCode: string;
  /** The 16 bytes stored beside `mk_under_src`. Public; see `recovery.ts`. */
  readonly recoverySalt: Uint8Array;
  /** MK under DK. **Stored locally**, and by the caller, not by the server. */
  readonly localWrap: SealedKey;
  /** MK under K_wrap. Becomes the `mk_under_kwrap` row. */
  readonly passwordWrap: SealedKey;
  /** MK under the recovery key. Becomes the `mk_under_src` row. */
  readonly recoveryWrap: SealedKey;
  /** The cost {@link passwordWrap} was actually derived under. Stored with it. */
  readonly passwordKdfParams: Argon2idParams;
  /** The cost {@link recoveryWrap} was actually derived under. Stored with it. */
  readonly recoveryKdfParams: Argon2idParams;
  /** The device name, sealed under a subkey of MK, in the shape `devices` stores. */
  readonly sealedDeviceName: SealedDeviceName;
  /**
   * The 32-byte proof of MK possession, stored by the mint and presented later
   * by a desktop asking for a new device row.
   *
   * It is produced HERE, at the mint, and not by whatever needs it later,
   * because the mint is the only transaction that can store it: the table has no
   * client grants and nothing can add a row to it afterwards. An account minted
   * without one could never recover a stranded desktop. See
   * `device-register.ts` — the argument is the same one this file already makes
   * about `mk_under_src`.
   */
  readonly registerProof: Uint8Array;
}

/**
 * Mints a master key and everything wrapped around it. Pure: no clock, no I/O,
 * no storage — the caller decides whether any of it is ever kept.
 *
 * Throws `TypeError` for a caller error (a bad device name, a key of the wrong
 * length) and `SyncCryptoError` with `enable/round-trip-mismatch` if the port
 * cannot open what it has just sealed.
 */
export async function prepareSyncEnable(
  port: CryptoPort,
  input: SyncEnableInput,
): Promise<SyncEnableMaterial> {
  // Every caller error is refused BEFORE a key, a code or an Argon2id run.
  // Refusing after the mint would leave the caller holding a master key and a
  // recovery code it has to decide what to do with, which is a decision nobody
  // should have to make on the failure path of a validation.
  if (input.userId.length === 0) throw new TypeError("SyncEnableInput.userId must not be empty.");
  assertDeviceName(input.deviceName);
  // `wrapKey` would refuse this too, but three statements later and after the
  // mint. Checking it here is what makes the sentence above true rather than
  // nearly true, and the message names the field the caller passed.
  if (input.localDataKey.length !== AEAD_KEY_BYTES) {
    throw new TypeError(
      `SyncEnableInput.localDataKey must be ${AEAD_KEY_BYTES} bytes, ` +
        `got ${input.localDataKey.length}.`,
    );
  }

  const masterKey = generateMasterKey(port);
  const recoveryCode = generateSyncRecoveryCode(port);
  const recoverySalt = generateSyncRecoverySalt(port);

  const localContext: WrapContext = { purpose: "mk/local-data-key", userId: input.userId };
  const passwordContext: WrapContext = { purpose: "mk/web-password", userId: input.userId };
  const recoveryContext: WrapContext = { purpose: "mk/sync-recovery", userId: input.userId };

  // Declared out here and derived INSIDE the try, one after the other, so that
  // every exit path has something exact to erase. Concurrently would be the
  // instinct — and it would leave one derived key unreachable and unerased
  // whenever the other rejected, because `Promise.all` discards what already
  // resolved. The two Argon2id runs do not overlap on one thread anyway, so the
  // sequential form costs nothing that was ever being saved.
  let passwordKek: Uint8Array | null = null;
  let recoveryKek: Uint8Array | null = null;

  try {
    passwordKek = (await deriveWebPasswordKeys(port, input.web)).wrapKey;
    recoveryKek = await deriveSyncRecoveryKey(port, {
      code: recoveryCode,
      salt: recoverySalt,
      params: SYNC_RECOVERY_KDF_PARAMS,
    });

    const [localWrap, passwordWrap, recoveryWrap, sealedDeviceName, registerProof] =
      await Promise.all([
        wrapKey(port, input.localDataKey, masterKey, localContext),
        wrapKey(port, passwordKek, masterKey, passwordContext),
        wrapKey(port, recoveryKek, masterKey, recoveryContext),
        sealDeviceName(
          port,
          masterKey,
          { userId: input.userId, platform: "desktop" },
          input.deviceName,
        ),
        deriveDeviceRegisterProof(port, masterKey, input.userId),
      ]);

    await assertOpensToMasterKey(port, masterKey, [
      [input.localDataKey, localWrap, localContext],
      [passwordKek, passwordWrap, passwordContext],
      [recoveryKek, recoveryWrap, recoveryContext],
    ]);

    return {
      masterKey,
      recoveryCode,
      recoverySalt,
      localWrap,
      passwordWrap,
      recoveryWrap,
      passwordKdfParams: input.web.params,
      recoveryKdfParams: SYNC_RECOVERY_KDF_PARAMS,
      sealedDeviceName,
      registerProof,
    };
  } catch (error) {
    // The master key is of no use to anybody now, including this process. It is
    // erased on the failure path only: on the success path the caller owns it.
    zeroize(masterKey);
    throw error;
  } finally {
    // Neither KEK is of further use, and K_wrap in particular is the key this
    // whole design keeps away from everything that does not need it — including
    // the caller, which never sees it.
    if (passwordKek !== null) zeroize(passwordKek);
    if (recoveryKek !== null) zeroize(recoveryKek);
  }
}

/**
 * Opens each wrap under the key that made it and compares.
 *
 * `unwrapKey` already refuses a wrong purpose and a wrong key at the commitment
 * check, so a failure here arrives as `SyncCryptoError` from that function; the
 * comparison below catches the remaining case, which is an AEAD that returns
 * plaintext of the right length and the wrong content.
 */
async function assertOpensToMasterKey(
  port: CryptoPort,
  masterKey: Uint8Array,
  wraps: ReadonlyArray<readonly [Uint8Array, SealedKey, WrapContext]>,
): Promise<void> {
  for (const [kek, sealed, context] of wraps) {
    const opened = await unwrapKey(port, kek, sealed, context);
    const same = constantTimeEqual(opened, masterKey);
    zeroize(opened);
    if (!same) {
      throw new SyncCryptoError(
        "enable/round-trip-mismatch",
        `The ${sealed.purpose} wrap did not open back to the master key. This crypto port ` +
          "cannot read what it has just written; enabling sync with it would store a key " +
          "nothing can recover.",
      );
    }
  }
}

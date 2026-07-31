import { argon2id } from "hash-wasm";
import {
  deriveRecoveryKey,
  unwrapDataKey,
  wrapDataKey,
  type KdfParams,
  type WrappedKey,
} from "../auth/keyChain.js";
import { normalizePasscode } from "../auth/passcode.js";

/**
 * The private-notes key chain (ADR-057): the PRIV DEK and its two wraps.
 * Private notes get their own data-encryption key — 32 random bytes per
 * profile, never derived from anything — wrapped twice, exactly the way
 * ADR-018 wraps the SQLCipher data key:
 *
 *   credential --argon2id(salt)--> HKDF-SHA256(salt=deviceSecret,
 *                                  info="nexus/priv-wrap/v1") --> KEK_credential
 *   recoveryCode --argon2id(privKitSalt)---------------------> KEK_kit
 *   privDek (32 random bytes) --AES-256-GCM(KEK)--> WrappedKey
 *
 * The credential is either the account passcode or a separate passphrase —
 * this module does not care which; the caller records which was used. Either
 * way the chain is `derivePasscodeKey`'s, verbatim, under PRIV's own versioned
 * HKDF `info` string, so the two uses can never derive the same KEK from the
 * same credential (a leak of one wrap's KEK says nothing about the other's).
 *
 * There is deliberately NO `derivePrivKitKey` twin of `deriveRecoveryKey`:
 * that function is pure Argon2id over (code, salt), so a distinct PRIV kit
 * salt IS the domain separation, and a twin would be a copy. The kit-wrap
 * helpers below call `deriveRecoveryKey` with the PRIV salt directly — one
 * code path, keyed apart by salt alone. KDF parameters are likewise reused:
 * PRIV defines no parameter set of its own, the caller passes the keychain's
 * (`DEFAULT_KDF_PARAMS` at account scale).
 *
 * WebCrypto only (`globalThis.crypto`) plus `hash-wasm`'s WASM Argon2id, like
 * the rest of the key chain: no `node:*` import, no `Buffer`, so this runs
 * unchanged under Vitest, in the Electron main process, and in a browser.
 * Exported via the `@nexus/core/auth` subpath — Argon2id's WASM stays out of
 * the `.` barrel's bundle, same as `keyChain.ts` itself.
 */

const PRIV_DEK_BYTES = 32;
const ARGON2_HASH_LENGTH = 32;

/** The versioned HKDF `info` string — PRIV's domain separation from `keyChain.ts`'s "nexus/passcode-wrap/v1", and what lets a future PRIV chain coexist with this one. */
const PRIV_WRAP_INFO = new TextEncoder().encode("nexus/priv-wrap/v1");

/** 32 random bytes — the PRIV DEK. Never derived from anything (mirrors `generateDataKey`). */
export function generatePrivDek(): Uint8Array {
  const bytes = new Uint8Array(PRIV_DEK_BYTES);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Argon2id over the credential, then HKDF-SHA256 salted with the device
 * secret — EXACTLY `derivePasscodeKey`'s chain under PRIV's own `info` (see
 * the module header). The device binding buys the same property it buys the
 * passcode: a stolen database file alone gives an attacker no HKDF salt to
 * even begin an offline guessing attack against the credential.
 *
 * The credential is normalized through `normalizePasscode` (NFKC) whichever
 * kind it is — passcode or separate passphrase, it is a typed secret, and
 * "one key regardless of keyboard/IME" applies identically; deriving from the
 * raw string would make that guarantee decorative.
 */
export async function derivePrivCredentialKey(
  credential: string,
  salt: Uint8Array,
  deviceSecret: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  const argonOutput = await argon2id({
    password: normalizePasscode(credential),
    salt,
    parallelism: params.parallelism,
    memorySize: params.memoryKiB,
    iterations: params.iterations,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: "binary",
  });

  const ikm = await crypto.subtle.importKey("raw", argonOutput, "HKDF", false, ["deriveBits"]);
  const kek = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: deviceSecret, info: PRIV_WRAP_INFO },
    ikm,
    256,
  );
  return new Uint8Array(kek);
}

/** `wrapDataKey`, reused verbatim: a PRIV DEK is a 32-byte payload like any other key material. Fresh random nonce every call. */
export const wrapPrivDek = wrapDataKey;

/** `unwrapDataKey`, reused verbatim — failures stay `KeyUnwrapError`, the one typed error the key chain throws for a wrong credential/code or edited bytes. */
export const unwrapPrivDek = unwrapDataKey;

/**
 * Wraps the PRIV DEK under the account's Recovery Kit code (ADR-057 §4): the
 * kit KEK is `deriveRecoveryKey` over the code with PRIV's OWN salt — see the
 * module header on why that reuse, not a twin, is the domain separation. The
 * regenerate-kit flow calls this alongside its existing data-key re-wrap, so
 * ONE new code (with two salts) opens both wraps independently.
 *
 * `recoveryCode` is assumed to already be canonical
 * (`recoveryCode.ts`'s `normalizeRecoveryCode`) — `deriveRecoveryKey`'s own
 * documented contract; rejecting a malformed code is the caller's job.
 */
export async function wrapPrivDekWithKit(
  privDek: Uint8Array,
  recoveryCode: string,
  kitSalt: Uint8Array,
  params: KdfParams,
): Promise<WrappedKey> {
  return wrapPrivDek(privDek, await deriveRecoveryKey(recoveryCode, kitSalt, params));
}

/** The inverse of `wrapPrivDekWithKit`; a wrong code or edited wrap stays `KeyUnwrapError`. */
export async function unwrapPrivDekWithKit(
  wrapped: WrappedKey,
  recoveryCode: string,
  kitSalt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  return unwrapPrivDek(wrapped, await deriveRecoveryKey(recoveryCode, kitSalt, params));
}

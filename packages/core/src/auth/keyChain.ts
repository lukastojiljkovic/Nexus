import { argon2id } from "hash-wasm";
import { normalizeArchivePassphrase } from "../imex/archivePassphrase.js";
import { normalizePasscode } from "./passcode.js";

/**
 * The local account's key chain (ADR-018): derivation, device binding, and
 * key wrapping. Implements the ADR's chain literally —
 *
 *   passcode --argon2id(salt)--> HKDF-SHA256(salt=deviceSecret) --> KEK_passcode
 *   recoveryCode --argon2id(recoverySalt)--------------------------> KEK_recovery
 *   dataKey (32 random bytes) --AES-256-GCM(KEK)--> WrappedKey
 *
 * — using only WebCrypto (`globalThis.crypto`) and `hash-wasm`'s WASM Argon2id,
 * so this module runs unchanged in Node (Vitest), the Electron main process,
 * and a browser: no native module, no ABI, nothing from `node:*`.
 *
 * The device secret is mixed into the passcode KEK as HKDF's *salt*, not
 * offered as a second, independent way to reach the data key. That is what
 * makes a stolen database file unattackable on its own: without the OS
 * keystore blob (slice b wires this to Electron's `safeStorage`/DPAPI), there
 * is no HKDF salt to even begin an offline guessing attack against the
 * passcode. The recovery key is deliberately built without that binding — see
 * `deriveRecoveryKey`.
 */

export interface KdfParams {
  algorithm: "argon2id";
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

/** OWASP baseline configuration (64 MiB, t=3, p=1); recorded in the keychain file so it can be raised later without locking anyone out. */
export const DEFAULT_KDF_PARAMS: KdfParams = {
  algorithm: "argon2id",
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
};

/**
 * Argon2id parameters for an export archive (ADR-022) — deliberately heavier
 * than `DEFAULT_KDF_PARAMS` (128 MiB, t=4, p=1 vs. 64 MiB, t=3, p=1). The
 * passcode's KEK is device-bound (see this file's header comment on
 * `derivePasscodeKey`), so a stolen database file is not offline-attackable
 * at all without the OS keystore secret; an archive carries its own salt in
 * its own header and travels anywhere, so it is offline-attackable forever,
 * and the KDF's work factor is the *only* defence standing between the file
 * and its contents. Export is also a deliberate, one-off action, not
 * something on the unlock hot path, so paying roughly a second of Argon2id
 * here is an acceptable trade the passcode's UX cannot afford.
 */
export const ARCHIVE_KDF_PARAMS: KdfParams = {
  algorithm: "argon2id",
  memoryKiB: 128 * 1024,
  iterations: 4,
  parallelism: 1,
};

/** A key wrapped with AES-256-GCM; both fields base64, `nonce` 12 bytes, `ciphertext` includes the 16-byte tag. */
export interface WrappedKey {
  nonce: string;
  ciphertext: string;
}

/** The only error this module throws for a wrong passcode / recovery code / edited file. A GCM auth failure cannot tell those apart, so it doesn't pretend to. */
export class KeyUnwrapError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "KeyUnwrapError";
  }
}

const DATA_KEY_BYTES = 32;
const DEVICE_SECRET_BYTES = 32;
const SALT_BYTES = 16;
const GCM_NONCE_BYTES = 12;
const ARGON2_HASH_LENGTH = 32;

/** The versioned HKDF `info` string — versioning it is what lets a future key-chain change coexist with this one instead of silently reinterpreting old keychain files. */
const PASSCODE_WRAP_INFO = new TextEncoder().encode("nexus/passcode-wrap/v1");

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** 32 random bytes — the SQLCipher data key. Never derived from anything. */
export function generateDataKey(): Uint8Array {
  return randomBytes(DATA_KEY_BYTES);
}

/** 32 random bytes — the device secret the OS keystore will hold (slice b). */
export function generateDeviceSecret(): Uint8Array {
  return randomBytes(DEVICE_SECRET_BYTES);
}

/** 16 random bytes. */
export function generateSalt(): Uint8Array {
  return randomBytes(SALT_BYTES);
}

/** The 64-hex-character form `openDatabase` takes. */
export function dataKeyToHex(dataKey: Uint8Array): string {
  return Array.from(dataKey, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Base64-encodes a `Uint8Array` with no `Buffer` (this package is platform-free). */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The inverse of `toBase64`. */
function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function runArgon2id(
  password: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  return argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    memorySize: params.memoryKiB,
    iterations: params.iterations,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: "binary",
  });
}

/**
 * Argon2id over the passcode, then HKDF-SHA256 salted with the device secret.
 * The device secret is what makes a stolen database file unattackable: without
 * the user's OS keystore there is no way to even begin guessing the passcode.
 */
export async function derivePasscodeKey(
  passcode: string,
  salt: Uint8Array,
  deviceSecret: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  // Deriving from the raw string would make normalizePasscode's whole point —
  // one key regardless of keyboard/IME — decorative.
  const argonOutput = await runArgon2id(normalizePasscode(passcode), salt, params);

  const ikm = await crypto.subtle.importKey("raw", argonOutput, "HKDF", false, ["deriveBits"]);
  const kek = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: deviceSecret, info: PASSCODE_WRAP_INFO },
    ikm,
    256,
  );
  return new Uint8Array(kek);
}

/**
 * Argon2id over the recovery code alone — deliberately NOT device-bound, so the
 * Recovery Kit still works on a new machine (ADR-018: it doubles as the
 * device-migration path). Safe precisely because the code is 160 random bits.
 *
 * `code` is assumed to already be in canonical form (`recoveryCode.ts`'s
 * `normalizeRecoveryCode`) — unlike a passcode, a recovery code can be
 * *invalid*, and this function has no way to reject one and no error type
 * documented for doing so. Rejecting a bad code is the caller's job, before
 * this function is ever called.
 */
export async function deriveRecoveryKey(
  code: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  return runArgon2id(code, salt, params);
}

/**
 * Argon2id over the export-archive passphrase alone — no HKDF, no device
 * binding, the same deliberate omission as `deriveRecoveryKey` and for the
 * same reason: an archive must open on a machine that has never seen this
 * installation's OS keystore, so there is nothing to bind it to. Normalizes
 * through `normalizeArchivePassphrase` (imported from `../imex/`, not
 * duplicated here) so the form used to derive a key can never drift from the
 * form `validateArchivePassphrase` judged when the user typed it — two
 * different normalizations of "the same" passphrase would otherwise derive
 * two different keys.
 */
export async function deriveArchiveKey(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  return runArgon2id(normalizeArchivePassphrase(passphrase), salt, params);
}

/** Wraps `dataKey` with AES-256-GCM under `kek`, using a fresh random nonce every call. */
export async function wrapDataKey(dataKey: Uint8Array, kek: Uint8Array): Promise<WrappedKey> {
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const key = await crypto.subtle.importKey("raw", kek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, dataKey);
  return { nonce: toBase64(nonce), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

/**
 * Throws `KeyUnwrapError` when the KEK is wrong or the ciphertext was tampered
 * with. AES-GCM's tag check is what tells them apart from silent corruption —
 * a mismatch throws a bare `OperationError` from WebCrypto, which is caught
 * here and re-thrown as the one typed error this module promises, because the
 * caller's whole job is to tell "wrong passcode" apart from "something is
 * broken", and a raw DOMException tells it neither.
 */
export async function unwrapDataKey(wrapped: WrappedKey, kek: Uint8Array): Promise<Uint8Array> {
  try {
    const key = await crypto.subtle.importKey("raw", kek, "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(wrapped.nonce) },
      key,
      fromBase64(wrapped.ciphertext),
    );
    return new Uint8Array(plaintext);
  } catch (error) {
    throw new KeyUnwrapError(
      "Could not unwrap the data key: the passcode/recovery code is wrong, or the keychain file was edited.",
      { cause: error },
    );
  }
}

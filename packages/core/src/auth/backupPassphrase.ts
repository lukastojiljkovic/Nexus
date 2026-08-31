/**
 * The scheduled backup's passphrase wrap (SET-011 / ADR-056): the passphrase a
 * scheduled export seals archives under is set once, wrapped by the main
 * process under a key derived from the profile's ADR-018 data key, and stored
 * in the `backup_settings` row — the plaintext passphrase never touches disk.
 *
 *   dataKey --HKDF-SHA256(salt=empty, info="nexus/backup-passphrase/v1")--> purpose key
 *   passphrase (UTF-8) --AES-256-GCM(purpose key)--> WrappedKey --JSON--> stored text
 *
 * The purpose key is HKDF-derived exactly the way `blobCrypto.ts` derives the
 * blob store's subkeys — empty extract salt (the data key is already a full-
 * strength uniformly random key, RFC 5869's condition for skipping it) and a
 * versioned `info` string keying this use apart from every other derivation,
 * so a leak of this wrap's key reveals nothing about blob keys or the data key
 * itself. The GCM wrap reuses `wrapDataKey`/`unwrapDataKey` verbatim: a
 * passphrase's UTF-8 bytes are a payload like any other key material.
 *
 * The serialized form is versioned JSON (`{"v":1,...}`) rather than the bare
 * `WrappedKey` pair, so a future format change can coexist with rows written
 * under this one instead of silently misreading them — the same reasoning as
 * the versioned HKDF `info` strings themselves.
 *
 * WebCrypto only (`globalThis.crypto`), like the rest of this directory: no
 * `node:*` import, no `Buffer`, so it runs unchanged under Vitest and in the
 * Electron main process.
 */

import { asBufferSource } from "../bytes.js";
import { KeyUnwrapError, unwrapDataKey, wrapDataKey, type WrappedKey } from "./keyChain.js";

const DATA_KEY_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;
const EMPTY_SALT = new Uint8Array(0);
const BACKUP_PASSPHRASE_INFO = new TextEncoder().encode("nexus/backup-passphrase/v1");
const WRAP_VERSION = 1;

/** The serialized wrap's shape on disk; `nonce`/`ciphertext` are `WrappedKey`'s own base64 fields. */
interface SerializedWrap extends WrappedKey {
  v: number;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * The backup wrap's purpose key: HKDF-SHA256 over the data key, keyed apart by
 * `info` alone (see the module header). Hex case is normalized before decoding
 * for `deriveBlobKeys`'s reason: two casings of one key must derive one key.
 */
async function deriveBackupWrapKey(dataKeyHex: string): Promise<Uint8Array> {
  if (!DATA_KEY_HEX_PATTERN.test(dataKeyHex)) {
    throw new TypeError(
      `dataKeyHex must be 64 hex characters (the @nexus/db data key), got: ${JSON.stringify(dataKeyHex)}`,
    );
  }
  const dataKey = hexToBytes(dataKeyHex.toLowerCase());
  const ikm = await crypto.subtle.importKey("raw", asBufferSource(dataKey), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: EMPTY_SALT, info: BACKUP_PASSPHRASE_INFO },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * Wraps `passphrase` for the `backup_settings` row. The passphrase is stored
 * exactly as typed — normalization stays `deriveArchiveKey`'s job at use time,
 * so the wrap can never disagree with the manual export about what "the same
 * passphrase" means. A fresh nonce every call (from `wrapDataKey`), so
 * re-setting the same passphrase still produces a different row value.
 */
export async function wrapBackupPassphrase(
  dataKeyHex: string,
  passphrase: string,
): Promise<string> {
  const key = await deriveBackupWrapKey(dataKeyHex);
  const wrapped = await wrapDataKey(new TextEncoder().encode(passphrase), key);
  const serialized: SerializedWrap = { v: WRAP_VERSION, ...wrapped };
  return JSON.stringify(serialized);
}

/**
 * The inverse of `wrapBackupPassphrase`. Throws `KeyUnwrapError` for anything
 * short of an authenticated open: a serialized form that is not a v1 wrap
 * (an edited or foreign row), a wrong data key, or tampered ciphertext — GCM's
 * tag check cannot tell the last two apart, so this doesn't pretend to. A
 * malformed `dataKeyHex` stays a `TypeError`, `blobCrypto.ts`'s division:
 * a programming error in the caller, never a runtime "this wrap is bad".
 */
export async function unwrapBackupPassphrase(
  dataKeyHex: string,
  serialized: string,
): Promise<string> {
  const key = await deriveBackupWrapKey(dataKeyHex);

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new KeyUnwrapError("The stored backup-passphrase wrap is not valid JSON.", {
      cause: error,
    });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as SerializedWrap).v !== WRAP_VERSION ||
    typeof (parsed as SerializedWrap).nonce !== "string" ||
    typeof (parsed as SerializedWrap).ciphertext !== "string"
  ) {
    throw new KeyUnwrapError("The stored backup-passphrase wrap is not a v1 wrap.");
  }

  const { nonce, ciphertext } = parsed as SerializedWrap;
  const bytes = await unwrapDataKey({ nonce, ciphertext }, key);
  return new TextDecoder().decode(bytes);
}

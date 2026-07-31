/**
 * The `@nexus/core/auth` subpath (ADR-018): the local account's crypto core.
 * A separate export subpath from `.` on purpose — `hash-wasm`'s Argon2id WASM
 * has no business in the renderer's bundle for every screen that isn't the
 * lock screen, and this barrel is the only thing that pulls it in.
 */

export {
  MAX_PASSCODE_LENGTH,
  MIN_PASSCODE_LENGTH,
  normalizePasscode,
  validatePasscode,
} from "./passcode.js";
export type { PasscodeProblem } from "./passcode.js";

export {
  formatRecoveryCode,
  generateRecoveryCode,
  normalizeRecoveryCode,
} from "./recoveryCode.js";

export {
  ARCHIVE_KDF_PARAMS,
  DEFAULT_KDF_PARAMS,
  KeyUnwrapError,
  dataKeyToHex,
  deriveArchiveKey,
  derivePasscodeKey,
  deriveRecoveryKey,
  generateDataKey,
  generateDeviceSecret,
  generateSalt,
  unwrapDataKey,
  wrapDataKey,
} from "./keyChain.js";
export type { KdfParams, WrappedKey } from "./keyChain.js";

export {
  FREE_ATTEMPTS,
  INITIAL_ATTEMPT_STATE,
  registerFailedAttempt,
  remainingLockMs,
} from "./unlockThrottle.js";
export type { AttemptState } from "./unlockThrottle.js";

export {
  BlobDecryptError,
  blobStorageName,
  decryptBlob,
  deriveBlobKeys,
  encryptBlob,
} from "./blobCrypto.js";
export type { BlobKeys } from "./blobCrypto.js";

export { unwrapBackupPassphrase, wrapBackupPassphrase } from "./backupPassphrase.js";

// The PRIV key chain (ADR-057) lives in `priv/` but exports through THIS
// subpath: `derivePrivCredentialKey` runs Argon2id, which has no business in
// the `.` barrel's bundle — the same rule that put keyChain.ts here.
export {
  derivePrivCredentialKey,
  generatePrivDek,
  unwrapPrivDek,
  unwrapPrivDekWithKit,
  wrapPrivDek,
  wrapPrivDekWithKit,
} from "../priv/privKeys.js";

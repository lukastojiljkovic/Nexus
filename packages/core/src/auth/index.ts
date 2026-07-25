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
  DEFAULT_KDF_PARAMS,
  KeyUnwrapError,
  dataKeyToHex,
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

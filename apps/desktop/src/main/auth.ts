import { timingSafeEqual } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { join } from "node:path";
import { safeStorage } from "electron";
import {
  DEFAULT_KDF_PARAMS,
  KeyUnwrapError,
  dataKeyToHex,
  derivePasscodeKey,
  deriveRecoveryKey,
  generateDataKey,
  generateDeviceSecret,
  generateRecoveryCode,
  generateSalt,
  normalizeRecoveryCode,
  registerFailedAttempt,
  remainingLockMs,
  unwrapDataKey,
  validatePasscode,
  wrapDataKey,
  INITIAL_ATTEMPT_STATE,
  type AttemptState,
  type KdfParams,
  type WrappedKey,
} from "@nexus/core/auth";

/**
 * The local account's key chain file and unlock flows (ADR-018, slice 018-b).
 * Everything impure lives here: `keychain.json` on disk and the OS keystore
 * (`safeStorage`, DPAPI on Windows) — nothing else from `electron`, and
 * nothing from the renderer. `@nexus/core/auth` (018-a) owns every actual
 * cryptographic step (Argon2id, HKDF, AES-GCM wrap/unwrap, the throttle
 * arithmetic); this module only composes those steps in the right order and
 * persists the result. Every function takes the `userData` directory as its
 * first argument — the same discipline `main/attachments.ts` uses — so
 * nothing here resolves `app.getPath` itself; `main/index.ts` is the only
 * place that does.
 */

export type AuthState = "uninitialized" | "locked" | "unlocked";

export interface AuthStatus {
  state: AuthState;
  /** Milliseconds still to wait before another attempt is accepted; 0 when none. */
  lockedForMs: number;
  /** False when the OS keystore is unavailable — creation is refused rather than silently downgraded. */
  keystoreAvailable: boolean;
  /**
   * True when this data was carried over from another machine or Windows
   * account: the guard blob is DPAPI-bound and cannot be decrypted here, so
   * the passcode is unusable and only the Recovery Kit can open the database
   * (ADR-018 — the Kit is deliberately not device-bound precisely for this).
   * The renderer shows the recovery form instead of the passcode form.
   */
  requiresRecovery: boolean;
}

/**
 * The unlock throttle as it stood immediately before a successful attempt
 * cleared it (NTF-007) — `null` whenever no wait had ever been imposed since
 * the last success.
 *
 * This is the ONLY way the trip can be reported at all: it happens while the
 * database is locked (that is what being throttled means), so nothing can be
 * written to the ledger at the moment it occurs. What survives is the guard
 * blob's own persisted state, and a successful unlock resets it — so the
 * instant before that reset is the single point where the fact still exists.
 * Every function here that resets the guard hands it back rather than silently
 * destroying it.
 */
export interface ClearedThrottle {
  failedAttempts: number;
  /** ISO-8601 instant the last imposed wait ran to; non-null by construction (a state with no `lockedUntil` never counts as tripped). */
  lockedUntil: string;
}

/** The tripped throttle a success is about to clear, or `null` when the failures never reached the point of imposing a wait. */
function clearedThrottle(state: AttemptState): ClearedThrottle | null {
  return state.lockedUntil === null
    ? null
    : { failedAttempts: state.failedAttempts, lockedUntil: state.lockedUntil };
}

/** Why an auth call was refused. The renderer maps each to its own Serbian sentence — never this class's `message`, which is a debug string only. */
export type AuthErrorReason =
  | "notInitialized"
  | "alreadyInitialized"
  | "wrongPasscode"
  | "wrongRecoveryCode"
  | "throttled"
  | "weakPasscode"
  | "keystoreUnavailable"
  | "otherDevice"
  | "corruptKeychain";

/** Thrown for every expected refusal. `main/index.ts`'s IPC handlers catch this and translate it into an `AuthResult`; anything else (a filesystem error, a broken database) is left to propagate as a genuine unexpected failure. */
export class AuthError extends Error {
  constructor(
    readonly reason: AuthErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const KEYCHAIN_FILE_NAME = "keychain.json";

/** The keychain file's on-disk shape, exactly ADR-018's. Only `guard` is secret, and it is OS-encrypted; every other field is a public parameter of the key chain. */
interface KeychainFile {
  version: 1;
  kdf: KdfParams;
  passcodeSalt: string;
  passcodeWrap: WrappedKey;
  recoverySalt: string;
  recoveryWrap: WrappedKey;
  guard: string;
}

/**
 * The `guard` blob's plaintext, once decrypted through `safeStorage`
 * (SEC-LOC-02): the device secret plus the unlock-attempt throttle state,
 * together — never the attempt counter beside the file in plain JSON, which
 * would let it be reset with a text editor.
 */
interface GuardPayload {
  /** Base64. Never leaves this module except wrapped inside `guard`. */
  deviceSecret: string;
  failedAttempts: number;
  lockedUntil: string | null;
}

function keychainPath(dir: string): string {
  return join(dir, KEYCHAIN_FILE_NAME);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

const HEX_KEY_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * The inverse of core's `dataKeyToHex` (core only ever needed the forward
 * direction). `dataKeyHex` here is always a value main itself produced from a
 * previous unlock — never renderer input — so this only guards against an
 * internal mistake, not a hostile caller.
 */
function dataKeyFromHex(hex: string): Uint8Array {
  if (!HEX_KEY_PATTERN.test(hex)) {
    throw new Error("Internal error: dataKeyHex is not a well-formed 256-bit hex key.");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function isWrappedKeyShape(value: unknown): value is WrappedKey {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.nonce === "string" && typeof v.ciphertext === "string";
}

function isKdfParamsShape(value: unknown): value is KdfParams {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.algorithm === "argon2id" &&
    typeof v.memoryKiB === "number" &&
    typeof v.iterations === "number" &&
    typeof v.parallelism === "number"
  );
}

/** Structural check for a parsed `keychain.json`: wrong shape or a `version` other than 1 both count as corrupt, never as "uninitialized" — see `readKeychainFile`'s doc comment for why that distinction matters. */
function isKeychainFileShape(value: unknown): value is KeychainFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    isKdfParamsShape(v.kdf) &&
    typeof v.passcodeSalt === "string" &&
    isWrappedKeyShape(v.passcodeWrap) &&
    typeof v.recoverySalt === "string" &&
    isWrappedKeyShape(v.recoveryWrap) &&
    typeof v.guard === "string"
  );
}

function isGuardPayloadShape(value: unknown): value is GuardPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.deviceSecret === "string" &&
    typeof v.failedAttempts === "number" &&
    (v.lockedUntil === null || typeof v.lockedUntil === "string")
  );
}

/**
 * Reads and parses `keychain.json`. A missing file means "no account yet" —
 * `null`, never an error. A file that EXISTS but fails to parse, or whose
 * `version` is not 1, throws `corruptKeychain`: treating it as "uninitialized"
 * would offer to create a brand-new account right over an existing encrypted
 * database, silently stranding whatever the founder already has.
 */
function readKeychainFile(dir: string): KeychainFile | null {
  let raw: string;
  try {
    raw = readFileSync(keychainPath(dir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error; // an unexpected filesystem error (permissions, ...) is not ours to reinterpret
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AuthError("corruptKeychain", "keychain.json exists but could not be parsed as JSON.");
  }
  if (!isKeychainFileShape(parsed)) {
    throw new AuthError("corruptKeychain", "keychain.json has an unrecognized shape or version.");
  }
  return parsed;
}

/**
 * Writes `keychain.json` atomically: the full contents go to a sibling
 * `.tmp` file first, `fsync`'d before its handle closes, then `renameSync`
 * lands it on the real path. `renameSync` on the same volume is a single
 * filesystem operation — a reader (or a crash) only ever sees the old file or
 * the fully-written new one, never a half-written one. A half-written
 * keychain file would be unrecoverable data loss: it is the only copy of the
 * wrapped key to `nexus.db`.
 */
function writeKeychainFileAtomic(dir: string, file: KeychainFile): void {
  const path = keychainPath(dir);
  const tmpPath = `${path}.tmp`;
  const fd = openSync(tmpPath, "w");
  try {
    writeSync(fd, JSON.stringify(file, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, path);
}

function persistGuard(dir: string, file: KeychainFile, payload: GuardPayload): void {
  writeKeychainFileAtomic(dir, { ...file, guard: encryptGuard(payload) });
}

function encryptGuard(payload: GuardPayload): string {
  return safeStorage.encryptString(JSON.stringify(payload)).toString("base64");
}

/**
 * Decrypts and parses `guard`, or returns `null` when the OS keystore refuses
 * it. Only called once the keystore is known to be available
 * (`assertKeystoreAvailable`), so that refusal has exactly one meaning: the
 * blob was produced by a **different machine or Windows account**. That is not
 * corruption — it is the supported device-migration case (ADR-018), where the
 * copied `keychain.json` still holds a perfectly good `recoveryWrap` that was
 * never device-bound. Callers decide what to do with `null`: the passcode
 * paths refuse with `otherDevice`, and `unlockWithRecovery` proceeds and mints
 * a fresh device secret for this machine.
 *
 * A blob that DOES decrypt but then fails to parse is a different story and
 * still `corruptKeychain` — the OS vouched for those bytes, so garbage inside
 * them means the file really was mangled.
 */
function decryptGuard(guardBase64: string): GuardPayload | null {
  let json: string;
  try {
    json = safeStorage.decryptString(Buffer.from(guardBase64, "base64"));
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new AuthError("corruptKeychain", "The keychain guard's contents could not be parsed.");
  }
  if (!isGuardPayloadShape(parsed)) {
    throw new AuthError("corruptKeychain", "The keychain guard has an unrecognized shape.");
  }
  return parsed;
}

/**
 * Whether the OS keystore can encrypt at all. Device-global — `safeStorage`
 * knows nothing about accounts — so `main/index.ts` reads it directly when
 * there is no account to run `readStatus` against yet (a first-ever launch,
 * ADR-044), rather than pointing that function at a directory it invented.
 */
export function isKeystoreAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/** Refuses up front — no silent PIN-only downgrade (ADR-018) — for every call that needs the device-bound half of the key chain. */
function assertKeystoreAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new AuthError("keystoreUnavailable", "The OS keystore is unavailable.");
  }
}

/**
 * The local account's status, purely from what is on disk. Never throws for a
 * missing file (`"uninitialized"`). A file that exists is always at least
 * `"locked"` from this function's point of view — it has no way to know the
 * database is already open in this session; only `main/index.ts`'s
 * `auth:status` handler knows that, and upgrades this result to `"unlocked"`
 * when its own database handle is non-null.
 *
 * When the keystore is unavailable, `guard` cannot be decrypted at all, so the
 * real throttle state is unknowable right now — this reports `lockedForMs: 0`
 * rather than throwing, so the renderer can still show "locked" plus
 * `keystoreAvailable: false` (there is a real account; it simply cannot be
 * unlocked from this OS session at this moment).
 */
export function readStatus(dir: string): AuthStatus {
  const keystoreAvailable = safeStorage.isEncryptionAvailable();
  const file = readKeychainFile(dir);
  if (file === null) {
    return { state: "uninitialized", lockedForMs: 0, keystoreAvailable, requiresRecovery: false };
  }
  if (!keystoreAvailable) {
    return { state: "locked", lockedForMs: 0, keystoreAvailable, requiresRecovery: false };
  }

  const guard = decryptGuard(file.guard);
  if (guard === null) {
    // Carried over from another machine/account: the passcode cannot be
    // derived here at all, so there is no throttle state to report either.
    return { state: "locked", lockedForMs: 0, keystoreAvailable, requiresRecovery: true };
  }
  const lockedForMs = remainingLockMs(
    { failedAttempts: guard.failedAttempts, lockedUntil: guard.lockedUntil },
    new Date().toISOString(),
  );
  return { state: "locked", lockedForMs, keystoreAvailable, requiresRecovery: false };
}

/**
 * Reads the guard for a passcode path, refusing with `otherDevice` when it
 * belongs to another machine/account. Deriving a passcode key needs the device
 * secret that is inside it, so there is nothing sensible to attempt without
 * one — and telling the user "wrong passcode" for a passcode that is in fact
 * correct would be a lie that sends them looking for the wrong problem.
 */
function requireLocalGuard(file: KeychainFile): GuardPayload {
  const guard = decryptGuard(file.guard);
  if (guard === null) {
    throw new AuthError(
      "otherDevice",
      "This data was created on another machine or Windows account; unlock it with the Recovery Kit.",
    );
  }
  return guard;
}

/**
 * First run: generates the whole key chain, wraps the data key under both the
 * passcode and a fresh Recovery Kit code, and writes `keychain.json`. Returns
 * the data key (hex, ready for `openDatabase`/`encryptDatabaseInPlace`) and
 * the Recovery Kit code — the ONLY time this function (or any other) ever
 * hands the code back; losing it after this call means writing it down was
 * the user's only chance.
 */
export async function createAccount(
  dir: string,
  passcode: string,
): Promise<{ dataKeyHex: string; recoveryCode: string }> {
  if (readKeychainFile(dir) !== null) {
    throw new AuthError("alreadyInitialized", "A local account already exists.");
  }
  assertKeystoreAvailable();
  const problem = validatePasscode(passcode);
  if (problem !== null) {
    throw new AuthError("weakPasscode", `Passcode rejected: ${problem}`);
  }

  const dataKey = generateDataKey();
  const deviceSecret = generateDeviceSecret();
  const passcodeSalt = generateSalt();
  const recoverySalt = generateSalt();

  const recoveryCode = generateRecoveryCode();
  const canonicalRecovery = normalizeRecoveryCode(recoveryCode);
  if (canonicalRecovery === null) {
    // Unreachable in practice — a freshly generated code is always canonical.
    // This would only fire if recoveryCode.ts's own alphabet/length constants
    // had drifted out of sync with themselves.
    throw new Error("Internal error: freshly generated recovery code failed to normalize.");
  }

  const passcodeKek = await derivePasscodeKey(passcode, passcodeSalt, deviceSecret, DEFAULT_KDF_PARAMS);
  const passcodeWrap = await wrapDataKey(dataKey, passcodeKek);

  const recoveryKek = await deriveRecoveryKey(canonicalRecovery, recoverySalt, DEFAULT_KDF_PARAMS);
  const recoveryWrap = await wrapDataKey(dataKey, recoveryKek);

  writeKeychainFileAtomic(dir, {
    version: 1,
    kdf: DEFAULT_KDF_PARAMS,
    passcodeSalt: toBase64(passcodeSalt),
    passcodeWrap,
    recoverySalt: toBase64(recoverySalt),
    recoveryWrap,
    guard: encryptGuard({ deviceSecret: toBase64(deviceSecret), ...INITIAL_ATTEMPT_STATE }),
  });

  return { dataKeyHex: dataKeyToHex(dataKey), recoveryCode };
}

/**
 * Verifies a passcode against the existing key chain and returns the data key
 * (hex), plus whatever throttle state the success just cleared (NTF-007 — see
 * `ClearedThrottle` for why this is reported here and nowhere else). Throttle is
 * checked FIRST, before any Argon2id work: a throttled caller gets `throttled`
 * immediately, with the guard file untouched. Only a `KeyUnwrapError` (wrong
 * passcode, or a tampered wrap) folds one failed attempt into the guard and
 * persists it before rethrowing as `wrongPasscode`; success resets the throttle
 * state and persists that instead.
 */
export async function unlockWithPasscode(
  dir: string,
  passcode: string,
): Promise<{ dataKeyHex: string; clearedThrottle: ClearedThrottle | null }> {
  const file = readKeychainFile(dir);
  if (file === null) {
    throw new AuthError("notInitialized", "No local account exists yet.");
  }
  assertKeystoreAvailable();

  const guard = requireLocalGuard(file);
  const now = new Date().toISOString();
  const attemptState: AttemptState = { failedAttempts: guard.failedAttempts, lockedUntil: guard.lockedUntil };
  const lockedForMs = remainingLockMs(attemptState, now);
  if (lockedForMs > 0) {
    throw new AuthError("throttled", `Too many attempts; try again in ${lockedForMs}ms.`);
  }

  const deviceSecret = fromBase64(guard.deviceSecret);
  const kek = await derivePasscodeKey(passcode, fromBase64(file.passcodeSalt), deviceSecret, file.kdf);

  try {
    const dataKey = await unwrapDataKey(file.passcodeWrap, kek);
    persistGuard(dir, file, { deviceSecret: guard.deviceSecret, ...INITIAL_ATTEMPT_STATE });
    return { dataKeyHex: dataKeyToHex(dataKey), clearedThrottle: clearedThrottle(attemptState) };
  } catch (error) {
    if (!(error instanceof KeyUnwrapError)) throw error;
    const updated = registerFailedAttempt(attemptState, now);
    persistGuard(dir, file, { deviceSecret: guard.deviceSecret, ...updated });
    throw new AuthError("wrongPasscode", "The passcode is incorrect.");
  }
}

/**
 * Verifies a passcode against an ALREADY-UNLOCKED session (ADR-058 — the
 * profile-switch gate), without ever touching the database: the wrap is
 * unwrapped exactly as `unlockWithPasscode` unwraps it, and the result is
 * constant-time-compared to the data key the session is holding
 * (`sessionDataKeyHex`, main's `unlockedDataKeyHex`). Same throttle counter,
 * same discipline — checked first, folded on a wrong passcode, reset on
 * success — because a passcode guess is a passcode guess wherever it is
 * typed, and a gate with its own counter would be an unthrottled oracle for
 * the one secret an attacker at an open session does not have
 * (`changePasscode`'s reasoning, verbatim).
 *
 * A passcode that unwraps to a key that is NOT the session's is not a wrong
 * passcode — it means `keychain.json` was swapped under a live session — so it
 * throws a plain `Error` (an unexpected failure, not an expected refusal) and
 * deliberately leaves the guard untouched.
 */
export async function verifyPasscode(
  dir: string,
  passcode: string,
  sessionDataKeyHex: string,
): Promise<ClearedThrottle | null> {
  const sessionKey = dataKeyFromHex(sessionDataKeyHex);

  const file = readKeychainFile(dir);
  if (file === null) {
    throw new AuthError("notInitialized", "No local account exists yet.");
  }
  assertKeystoreAvailable();

  const guard = requireLocalGuard(file);
  const now = new Date().toISOString();
  const attemptState: AttemptState = {
    failedAttempts: guard.failedAttempts,
    lockedUntil: guard.lockedUntil,
  };
  const lockedForMs = remainingLockMs(attemptState, now);
  if (lockedForMs > 0) {
    throw new AuthError("throttled", `Too many attempts; try again in ${lockedForMs}ms.`);
  }

  const deviceSecret = fromBase64(guard.deviceSecret);
  const kek = await derivePasscodeKey(passcode, fromBase64(file.passcodeSalt), deviceSecret, file.kdf);

  let dataKey: Uint8Array;
  try {
    dataKey = await unwrapDataKey(file.passcodeWrap, kek);
  } catch (error) {
    if (!(error instanceof KeyUnwrapError)) throw error;
    const updated = registerFailedAttempt(attemptState, now);
    persistGuard(dir, file, { deviceSecret: guard.deviceSecret, ...updated });
    throw new AuthError("wrongPasscode", "The passcode is incorrect.");
  }

  if (dataKey.length !== sessionKey.length || !timingSafeEqual(dataKey, sessionKey)) {
    throw new Error("Internal error: the keychain no longer matches the unlocked session.");
  }

  persistGuard(dir, file, { deviceSecret: guard.deviceSecret, ...INITIAL_ATTEMPT_STATE });
  return clearedThrottle(attemptState);
}

/**
 * Recovers from a forgotten passcode with the Recovery Kit code, setting a
 * new passcode in the same call (recovering without one would lock the user
 * out again next launch). The recovery code itself is deliberately NOT
 * rotated by this call — it returns only the data key, never a new code;
 * regenerating one is `regenerateRecoveryCode`'s separate, explicit action.
 *
 * Same throttle discipline as `unlockWithPasscode`: checked first, folded on
 * failure, reset on success. `recoveryCode` is normalized before anything
 * else — `deriveRecoveryKey` assumes a canonical code and has no way to
 * reject a malformed one itself (018-a's own documented limit), so a
 * non-canonical input is rejected here as `wrongRecoveryCode`, before it ever
 * reaches key derivation.
 */
export async function unlockWithRecovery(
  dir: string,
  recoveryCode: string,
  newPasscode: string,
): Promise<{ dataKeyHex: string; clearedThrottle: ClearedThrottle | null }> {
  const canonical = normalizeRecoveryCode(recoveryCode);
  if (canonical === null) {
    throw new AuthError("wrongRecoveryCode", "The recovery code is not valid.");
  }
  const problem = validatePasscode(newPasscode);
  if (problem !== null) {
    throw new AuthError("weakPasscode", `New passcode rejected: ${problem}`);
  }

  const file = readKeychainFile(dir);
  if (file === null) {
    throw new AuthError("notInitialized", "No local account exists yet.");
  }
  assertKeystoreAvailable();

  // A guard this machine cannot decrypt means the account was carried over
  // from another machine or Windows account — the case the Recovery Kit
  // exists to serve (ADR-018), since `recoveryWrap` was never device-bound.
  // There is then no throttle state to honour (it lived in that unreadable
  // blob), which costs nothing: the code being guessed is 160 random bits.
  const guard = decryptGuard(file.guard);
  const now = new Date().toISOString();
  const attemptState: AttemptState =
    guard !== null
      ? { failedAttempts: guard.failedAttempts, lockedUntil: guard.lockedUntil }
      : INITIAL_ATTEMPT_STATE;
  const lockedForMs = remainingLockMs(attemptState, now);
  if (lockedForMs > 0) {
    throw new AuthError("throttled", `Too many attempts; try again in ${lockedForMs}ms.`);
  }

  const recoveryKek = await deriveRecoveryKey(canonical, fromBase64(file.recoverySalt), file.kdf);

  let dataKey: Uint8Array;
  try {
    dataKey = await unwrapDataKey(file.recoveryWrap, recoveryKek);
  } catch (error) {
    if (!(error instanceof KeyUnwrapError)) throw error;
    // Only persist a failed attempt when there is a readable guard to fold it
    // into; on a foreign one, rewriting it here would destroy the device
    // secret of whatever machine legitimately owns it.
    if (guard !== null) {
      const updated = registerFailedAttempt(attemptState, now);
      persistGuard(dir, file, { deviceSecret: guard.deviceSecret, ...updated });
    }
    throw new AuthError("wrongRecoveryCode", "The recovery code is incorrect.");
  }

  // On this machine, keep the device secret the passcode wrap was already
  // bound to. On a migrated account there is no readable one, so this machine
  // mints its own — which is exactly what re-binds the new passcode wrap to
  // *this* device and completes the migration. Either way
  // `recoveryWrap`/`recoverySalt` are untouched: the Kit the user just used
  // keeps working until they explicitly regenerate it.
  const deviceSecret = guard !== null ? fromBase64(guard.deviceSecret) : generateDeviceSecret();
  const newPasscodeSalt = generateSalt();
  const newKek = await derivePasscodeKey(newPasscode, newPasscodeSalt, deviceSecret, file.kdf);
  const newPasscodeWrap = await wrapDataKey(dataKey, newKek);

  writeKeychainFileAtomic(dir, {
    ...file,
    passcodeSalt: toBase64(newPasscodeSalt),
    passcodeWrap: newPasscodeWrap,
    guard: encryptGuard({ deviceSecret: toBase64(deviceSecret), ...INITIAL_ATTEMPT_STATE }),
  });

  // Reported for the same reason the passcode path reports it: this write is
  // where the trip's only record stops existing. On a migrated account there
  // was no readable guard to begin with, so `attemptState` is the initial one
  // and this is `null` — correctly, since the failures it counted happened on
  // a machine that is not this one.
  return { dataKeyHex: dataKeyToHex(dataKey), clearedThrottle: clearedThrottle(attemptState) };
}

/**
 * Changes the passcode: verifies `currentPasscode` still unwraps the data
 * key, then rewraps it under `nextPasscode` with a FRESH salt and a fresh
 * nonce (`wrapDataKey` always mints one). `recoveryWrap`/`recoverySalt` are
 * left completely untouched — changing the passcode must never invalidate a
 * Recovery Kit the user has already written down.
 *
 * Returns whatever throttle state the successful change cleared, exactly as the
 * two unlock paths do: this verifies the current passcode against the SAME
 * counter, so a wrong-attempt burst inside the change dialog trips it just as
 * one at the lock screen does — and this write is equally the moment that
 * evidence would otherwise be destroyed.
 */
export async function changePasscode(
  dir: string,
  currentPasscode: string,
  nextPasscode: string,
): Promise<ClearedThrottle | null> {
  const problem = validatePasscode(nextPasscode);
  if (problem !== null) {
    throw new AuthError("weakPasscode", `New passcode rejected: ${problem}`);
  }

  const file = readKeychainFile(dir);
  if (file === null) {
    throw new AuthError("notInitialized", "No local account exists yet.");
  }
  assertKeystoreAvailable();

  const guard = requireLocalGuard(file);
  // Throttled on the same counter as unlocking, for the same reason: this
  // verifies the current passcode, so leaving it open would hand an attacker
  // at an unlocked session an unlimited oracle for the passcode itself — the
  // one secret they do not already have.
  const now = new Date().toISOString();
  const attemptState: AttemptState = {
    failedAttempts: guard.failedAttempts,
    lockedUntil: guard.lockedUntil,
  };
  const lockedForMs = remainingLockMs(attemptState, now);
  if (lockedForMs > 0) {
    throw new AuthError("throttled", `Too many attempts; try again in ${lockedForMs}ms.`);
  }

  const deviceSecret = fromBase64(guard.deviceSecret);
  const currentKek = await derivePasscodeKey(currentPasscode, fromBase64(file.passcodeSalt), deviceSecret, file.kdf);

  let dataKey: Uint8Array;
  try {
    dataKey = await unwrapDataKey(file.passcodeWrap, currentKek);
  } catch (error) {
    if (!(error instanceof KeyUnwrapError)) throw error;
    const updated = registerFailedAttempt(attemptState, now);
    persistGuard(dir, file, { deviceSecret: guard.deviceSecret, ...updated });
    throw new AuthError("wrongPasscode", "The current passcode is incorrect.");
  }

  const newSalt = generateSalt();
  const newKek = await derivePasscodeKey(nextPasscode, newSalt, deviceSecret, file.kdf);
  const newWrap = await wrapDataKey(dataKey, newKek);

  // One write: the new wrap AND the reset throttle, so a successful change
  // cannot leave a stale attempt counter behind.
  writeKeychainFileAtomic(dir, {
    ...file,
    passcodeSalt: toBase64(newSalt),
    passcodeWrap: newWrap,
    guard: encryptGuard({ deviceSecret: guard.deviceSecret, ...INITIAL_ATTEMPT_STATE }),
  });

  return clearedThrottle(attemptState);
}

/**
 * Issues a fresh Recovery Kit code, rewrapping the data key under a new
 * recovery salt and invalidating the old code. Takes the already-unlocked
 * data key (hex, as `main/index.ts` holds it for the duration of the unlocked
 * session) rather than a passcode — the caller reaching this action already
 * proved possession once this session, and recovery-key derivation was never
 * device-bound in the first place (`deriveRecoveryKey`), so there is nothing
 * here that needs the keystore.
 */
export async function regenerateRecoveryCode(dir: string, dataKeyHex: string): Promise<string> {
  const file = readKeychainFile(dir);
  if (file === null) {
    throw new AuthError("notInitialized", "No local account exists yet.");
  }

  const dataKey = dataKeyFromHex(dataKeyHex);
  const recoveryCode = generateRecoveryCode();
  const canonical = normalizeRecoveryCode(recoveryCode);
  if (canonical === null) {
    // Unreachable in practice — see the identical guard in `createAccount`.
    throw new Error("Internal error: freshly generated recovery code failed to normalize.");
  }

  const newSalt = generateSalt();
  const kek = await deriveRecoveryKey(canonical, newSalt, file.kdf);
  const wrap = await wrapDataKey(dataKey, kek);

  writeKeychainFileAtomic(dir, {
    ...file,
    recoverySalt: toBase64(newSalt),
    recoveryWrap: wrap,
  });

  return recoveryCode;
}

/**
 * „Ask for the passcode" — the remembered unlock (ADR-110).
 *
 * The setting the user picks in Podešavanja → Profil i sigurnost → Sigurnost
 * says how often the passcode is asked for. `"every-time"` is the default and
 * is what the app did before this existed; every other member lets main keep the
 * data key WRAPPED BY THE OS KEYSTORE (`safeStorage`, DPAPI on Windows) in the
 * account's folder for that long, so a launch inside the window opens without a
 * prompt and one after it does not.
 *
 * WHAT IT GIVES UP, PLAINLY. The wrap is bound to the Windows ACCOUNT, not to a
 * secret: anyone who can use this Windows session — someone at the unlocked
 * machine, or any program running as this user — can have `safeStorage` open it,
 * which is exactly what this module does at startup. It still keeps out another
 * Windows user, a copied disk and a stolen profile folder, because none of those
 * can ask this user's DPAPI to decrypt it. ADR-018 rejected this shape as the
 * ONLY route to the data key and that rejection stands: the passcode wrap is
 * untouched, the wrap here is a second, optional convenience, and every lock the
 * user asks for deletes it (see `forgetRememberedKey`).
 *
 * WHY EVERYTHING IMPURE IS INJECTED. A test that cannot move the clock cannot
 * check an expiry, and a test that cannot refuse to encrypt cannot check the
 * keystore branch — so `safeStorage`, the platform and the clock arrive as
 * `RememberedUnlockDeps` and the production wiring is one object literal in
 * `index.ts`. Nothing here imports `electron`: this module is the whole of the
 * feature's logic and all of it runs under Vitest.
 *
 * THE FILE. `<account>/remembered-unlock.json`, plaintext on purpose — it holds
 * no secret, only the choice and a keystore blob:
 *
 *     { "version": 1, "setting": "1d", "wrap": { "wrappedAt": "<ISO>", "blob": "<base64>" } }
 *
 * `wrap` is `null` whenever nothing may be remembered right now („every time",
 * or a lock that deleted it), and the setting survives that: a user who chose
 * „after 1 day" and then locked has chosen a POLICY, not a one-off, and the next
 * passcode unlock writes a fresh wrap under the same policy. Both halves are
 * validated on read and anything unrecognised is treated as the STRONGEST
 * reading — no wrap, and `"every-time"` — because a corrupt or tampered file
 * must fail towards asking for the passcode, never away from it.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_UNLOCK_SETTING,
  UNLOCK_SETTING_MINUTES,
  UNLOCK_SETTINGS,
  settingNeedsPasscode,
  type UnlockPolicy,
  type UnlockSetting,
  type UnlockSettingUnavailableReason,
} from "../shared/ipc.js";

const FILE_NAME = "remembered-unlock.json";

/**
 * The two `safeStorage` calls this module makes, plus the platform question
 * `getSelectedStorageBackend` answers. Narrowed to an interface rather than
 * taken as Electron's own object so a test can be the keystore: the point of
 * this file is that every branch is reachable without DPAPI.
 */
export interface Keystore {
  isEncryptionAvailable(): boolean;
  /** Linux only; the union is Electron's own. */
  getSelectedStorageBackend(): string;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface RememberedUnlockDeps {
  readonly keystore: Keystore;
  readonly platform: NodeJS.Platform;
  /** Injected so a test can drive an expiry to its boundary and past it. */
  readonly now: () => Date;
}

/** The wrap as it is stored. `blob` is base64 of the keystore's own bytes. */
interface StoredWrap {
  readonly wrappedAt: string;
  readonly blob: string;
}

/** The whole file. `wrap` is absent/null whenever nothing is remembered. */
interface StoredPolicy {
  readonly version: 1;
  readonly setting: UnlockSetting;
  readonly wrap: StoredWrap | null;
}

// --- the setting -------------------------------------------------------------

/** Whether `value` is one of the six settings. The IPC validator and the file reader both want this. */
export function isUnlockSetting(value: unknown): value is UnlockSetting {
  return typeof value === "string" && (UNLOCK_SETTINGS as readonly string[]).includes(value);
}

/**
 * The setting a payload names, or a thrown error naming the field. The IPC
 * boundary's validator (SEC-EL-02), kept here rather than in `index.ts` so it
 * can be tested: `index.ts` imports `electron` and no suite can load it.
 */
export function asUnlockSetting(value: unknown, field: string): UnlockSetting {
  if (!isUnlockSetting(value)) {
    throw new Error(`${field} must be one of: ${UNLOCK_SETTINGS.join(", ")}.`);
  }
  return value;
}

/** How long a wrap written under `setting` stays good for, in minutes; `null` = no expiry. */
export function settingMinutes(setting: UnlockSetting): number | null {
  return UNLOCK_SETTING_MINUTES[setting];
}

/**
 * Whether a wrap written at `wrappedAt` may still open the app at `now`.
 *
 * The boundary is EXCLUSIVE of the full duration: „after 1 hour" means a launch
 * one hour and one millisecond later asks for the passcode, and a launch at
 * exactly one hour does too, because `now - wrappedAt < duration` is the
 * question being asked. `"never"` has no expiry; `"every-time"` is never
 * remembered at all, so it answers false whatever the timestamps say.
 */
export function isWrapFresh(setting: UnlockSetting, wrappedAt: Date, now: Date): boolean {
  const minutes = settingMinutes(setting);
  if (minutes === null) return true;
  if (minutes === 0) return false;
  return now.getTime() - wrappedAt.getTime() < minutes * 60_000;
}

// --- the keystore question ---------------------------------------------------

/**
 * Why this machine cannot honour a remembered unlock, or `null` when it can.
 *
 * `basic_text` is checked only on Linux, and the check is not redundant with
 * `isEncryptionAvailable`: Electron answers `true` there and encrypts with a
 * hard-coded key, so a wrap under it is a plaintext key in a file that LOOKS
 * protected — the one failure mode this feature must not have.
 */
export function rememberingProblem(
  deps: RememberedUnlockDeps,
): UnlockSettingUnavailableReason | null {
  if (!deps.keystore.isEncryptionAvailable()) return "keystore";
  if (deps.platform === "linux" && deps.keystore.getSelectedStorageBackend() === "basic_text") {
    return "plaintext-backend";
  }
  return null;
}

// --- the file ----------------------------------------------------------------

function policyPath(dir: string): string {
  return join(dir, FILE_NAME);
}

function isStoredWrap(value: unknown): value is StoredWrap {
  if (typeof value !== "object" || value === null) return false;
  const wrap = value as Record<string, unknown>;
  if (typeof wrap.wrappedAt !== "string" || typeof wrap.blob !== "string") return false;
  // An unparseable timestamp is not a wrap we can reason about, so it is not a
  // wrap: `Date.parse` answering NaN here would make every comparison false and
  // silently keep a key alive forever.
  return !Number.isNaN(Date.parse(wrap.wrappedAt));
}

/**
 * The file as it stands, or the strongest reading when there is none: a missing
 * file is „no wrap, every time", and a file that is unparseable or shaped
 * wrongly is the same thing rather than an error. A locked account has no way to
 * report a corrupt policy file, and the answer it must give is the passcode
 * prompt — failing towards the prompt is the only safe direction.
 */
function readPolicy(dir: string): StoredPolicy {
  let raw: string;
  try {
    raw = readFileSync(policyPath(dir), "utf8");
  } catch {
    return { version: 1, setting: DEFAULT_UNLOCK_SETTING, wrap: null };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) throw new Error("shape");
    const file = parsed as Record<string, unknown>;
    // An unknown `version` is refused rather than read for the fields this
    // version knows: a file written by a later format may mean something else
    // by the same member names, and the safe reading of „I do not know this
    // file" is the passcode prompt.
    if (file.version !== 1) throw new Error("shape");
    const setting = file.setting;
    if (!isUnlockSetting(setting)) throw new Error("shape");
    const wrap = file.wrap === null || file.wrap === undefined ? null : file.wrap;
    if (wrap !== null && !isStoredWrap(wrap)) throw new Error("shape");
    return { version: 1, setting, wrap };
  } catch {
    return { version: 1, setting: DEFAULT_UNLOCK_SETTING, wrap: null };
  }
}

/**
 * Writes the file atomically — a sibling `.tmp` renamed onto the real path, the
 * same discipline `keychain.json` uses and for the same reason: a half-written
 * file must never be the thing a launch reads. It is not load-bearing the way
 * the key chain is (the worst case is a prompt), but the cost is one line.
 */
function writePolicy(dir: string, policy: StoredPolicy): void {
  const path = policyPath(dir);
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(policy, null, 2));
  renameSync(tmpPath, path);
}

/** Zeroes a key buffer once its bytes have been encoded. JS strings cannot be erased; the buffers this module makes can, and that is the half worth doing. */
function erase(buffer: Buffer): void {
  buffer.fill(0);
}

// --- what the renderer reads -------------------------------------------------

/** The stored setting plus whether this machine can honour it — the Settings card's whole state. */
export function readUnlockPolicy(deps: RememberedUnlockDeps, dir: string): UnlockPolicy {
  const problem = rememberingProblem(deps);
  return {
    setting: readPolicy(dir).setting,
    available: problem === null,
    reason: problem,
  };
}

// --- the two things that change the file -------------------------------------

/**
 * Stores `setting`, and — when it is one that remembers — wraps `dataKeyHex`
 * with the keystore as of now.
 *
 * Called from the two places that have just PROVED the passcode: a successful
 * unlock, and a successful change of this very setting (which requires it). The
 * wrap is rewritten, never appended to, so there is exactly one key on disk and
 * the clock restarts from the proof.
 *
 * Returns false when the setting could NOT be stored because the machine cannot
 * encrypt: any wrap already on disk is dropped — a stale one must not outlive
 * the refusal — while the setting that was already stored is kept, and the
 * CALLER decides what to say. The IPC handler reports `keystoreUnavailable`; the
 * unlock path keeps the session it has just opened and simply does not remember
 * it.
 */
export function storeUnlockPolicy(
  deps: RememberedUnlockDeps,
  dir: string,
  setting: UnlockSetting,
  dataKeyHex: string | null,
): boolean {
  const problem = rememberingProblem(deps);
  if (problem !== null) {
    // The setting is KEPT and only the wrap goes: this machine cannot encrypt
    // right now, which is a fact about the machine and not a reason to throw
    // away the choice the user made on a day it could.
    forgetRememberedKey(dir);
    return false;
  }
  if (!settingNeedsPasscode(setting) || dataKeyHex === null) {
    // „Every time" is stored in as many words rather than by deleting the file:
    // the card reads the choice back, and a missing file and „every time" would
    // otherwise be indistinguishable to anyone reading the folder.
    writePolicy(dir, { version: 1, setting, wrap: null });
    return true;
  }
  const blob = deps.keystore.encryptString(dataKeyHex);
  const base64 = blob.toString("base64");
  erase(blob);
  writePolicy(dir, {
    version: 1,
    setting,
    wrap: { wrappedAt: deps.now().toISOString(), blob: base64 },
  });
  return true;
}

/**
 * Deletes the wrap and keeps the setting: what every lock the user asks for
 * does, and what a passcode change and a recovery-code unlock do. The next
 * passcode unlock writes a fresh wrap under the same policy.
 */
export function forgetRememberedKey(dir: string): void {
  // Nothing to forget and nothing to create: an account that never chose a
  // setting has no such file, and a lock must not be the reason one appears.
  if (!existsSync(policyPath(dir))) return;
  const policy = readPolicy(dir);
  writePolicy(dir, { version: 1, setting: policy.setting, wrap: null });
}

/**
 * The data key this account may open without a prompt, or `null` when the
 * passcode must be asked for.
 *
 * `null` covers six cases that all end at the prompt: no wrap at all, a setting
 * of „every time", a wrap past its window, a blob this keystore refuses to
 * decrypt (a different Windows account, a copied profile, an edited file), a
 * plaintext that is not a 256-bit key, and a machine that cannot encrypt. Every
 * one of those that HAS a wrap is FORGOTTEN here — the file is rewritten without
 * it — because a wrap shown to be unusable must not be tried again on every
 * launch, and because an expired one is a key sitting on disk for no reason.
 */
export function takeRememberedKey(deps: RememberedUnlockDeps, dir: string): string | null {
  const policy = readPolicy(dir);
  if (policy.wrap === null || !settingNeedsPasscode(policy.setting)) return null;
  if (rememberingProblem(deps) !== null) {
    forgetRememberedKey(dir);
    return null;
  }
  const wrappedAt = new Date(policy.wrap.wrappedAt);
  if (!isWrapFresh(policy.setting, wrappedAt, deps.now())) {
    forgetRememberedKey(dir);
    return null;
  }
  const blob = Buffer.from(policy.wrap.blob, "base64");
  let plain: string;
  try {
    plain = deps.keystore.decryptString(blob);
  } catch {
    forgetRememberedKey(dir);
    return null;
  } finally {
    erase(blob);
  }
  // The shape is checked on the way OUT as well as on the way in, and the check
  // is not a formality: `openEncrypted` is handed this value, so a wrap whose
  // blob decrypts to anything but a 256-bit hex key would otherwise fail the
  // database open at startup — a refused launch where the prompt is the right
  // answer, and the tampering case this feature has to assume.
  if (!/^[0-9a-f]{64}$/i.test(plain)) {
    forgetRememberedKey(dir);
    return null;
  }
  return plain;
}

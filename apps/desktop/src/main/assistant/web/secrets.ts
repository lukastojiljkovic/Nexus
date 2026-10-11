import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

import type { WebProviderId } from "./providers.js";

/**
 * THE ONE SECRET THIS FEATURE HAS, AND HOW IT IS KEPT (ADR-097).
 *
 * Brave Search needs the user's own key, and a key is not a setting: a settings
 * file is read by anything running as the user, copied by a backup tool and
 * synced by a folder that happens to include `userData`. So the key goes
 * through the SAME device-bound encryption the account keychain uses
 * (`safeStorage`, DPAPI on Windows - `main/auth.ts`), and what lands on disk is
 * a base64 ciphertext in a file of its own beside `cloud.json` and
 * `network.json`.
 *
 * WHY ITS OWN FILE RATHER THAN A FIELD IN `assistant-web.json`. That file is a
 * plain record a user may reasonably edit and read („is web search on", „which
 * instance"); this one holds ciphertext where a wrong edit is unrecoverable. Two
 * files with two shapes is the version of this that cannot be got wrong by
 * accident, and it is why `readWebConfig` can stay a simple fail-closed parse.
 *
 * NEVER LOGGED, and the reason it is a property of the module rather than a
 * promise: nothing in this file (or in `providers.ts`, which builds the request
 * the key travels on) writes to a log, a console or a thrown message that
 * carries the key. The transport's errors carry a status and a URL, and the URL
 * never contains the key - the header does. `secrets.test.ts` asserts the two
 * halves of that: the plaintext key is absent from the bytes written to disk,
 * and the source of this module contains no logging call at all.
 *
 * A KEY THAT THIS MACHINE CANNOT DECRYPT IS `null`, not an error: the file came
 * from another machine or another Windows account, which is `auth.ts`'s
 * `decryptGuard` case exactly. The user's answer is to paste the key again, and
 * the copy says so; a thrown exception here would only reach whoever called
 * `web.search`.
 */

/** The device-bound cipher, as a port. `safeStorage` in main; a reversible stand-in in tests. */
export interface SecretCipher {
  /** `safeStorage.isEncryptionAvailable()`: false when the OS has no key store to use. */
  available(): boolean;
  /** Encrypts to base64, or throws when the key store refuses. */
  encrypt(plaintext: string): string;
  /** Decrypts base64, or `null` when these bytes were not produced for this device and account. */
  decrypt(ciphertext: string): string | null;
}

export interface WebSecrets {
  /** The stored key for a provider, or `null`. Never throws. */
  apiKey(provider: WebProviderId): string | null;
  /** Stores a key. Throws `WebSecretError` when the key or the key store is unusable. */
  setApiKey(provider: WebProviderId, key: string): void;
  /** Forgets a key. A no-op when there is none. */
  clearApiKey(provider: WebProviderId): void;
}

/** Why a key could not be stored. Machine codes; the settings surface maps them. */
export type SecretProblem =
  /** `safeStorage` cannot encrypt on this machine, so nothing is written - a silent plaintext fallback is not an option. */
  | "keystore-unavailable"
  /** The value is not a key: empty, too long, or carrying whitespace or control characters. */
  | "key";

export class WebSecretError extends Error {
  readonly problem: SecretProblem;

  constructor(problem: SecretProblem, message: string) {
    super(message);
    this.name = "WebSecretError";
    this.problem = problem;
  }
}

/**
 * The shape of the only secret on this device's disk.
 *
 * `version` for `network.json`'s reason: the file is a small record whose SHAPE
 * may grow (a second provider's key), and a build that meets a version it does
 * not know must answer „no keys" rather than guess.
 */
const SECRETS_VERSION = 1;

const SECRETS_FILE = "assistant-web-secrets.json";

export function webSecretsPath(dir: string): string {
  return join(dir, SECRETS_FILE);
}

/**
 * A pasted key, or `null`.
 *
 * A key is pasted once, from a page that may be showing it in a code block: a
 * trailing newline, a couple of spaces or a zero-width character from a copied
 * block all survive into a naive store, and the failure they produce - „Brave
 * says 401 and the key on screen looks right" - is the worst kind, because it
 * is invisible. The shape is deliberately permissive about WHICH characters are
 * allowed and strict about whitespace and control characters, because the
 * token alphabet is Brave's business and not this file's.
 */
export function normalizeApiKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (key.length < 8 || key.length > 512) return null;
  for (const char of key) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return null;
  }
  return key;
}

/** What is on disk: a base64 blob per provider, and nothing else. */
type StoredKeys = Partial<Record<WebProviderId, string>>;

/**
 * Reads the stored blobs. Any doubt - a missing file, a truncated one, a
 * version this build does not know, a value that is not a string - reads as „no
 * keys", for `readWebConfig`'s reason: „I could not tell" and „there is
 * nothing" must not be two different outcomes.
 */
function readStoredKeys(dir: string): StoredKeys {
  let raw: string;
  try {
    raw = readFileSync(webSecretsPath(dir), "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const record = parsed as { version?: unknown; keys?: unknown };
  if (record.version !== SECRETS_VERSION) return {};
  if (typeof record.keys !== "object" || record.keys === null) return {};
  const keys: StoredKeys = {};
  for (const [provider, value] of Object.entries(record.keys as Record<string, unknown>)) {
    if (typeof value !== "string" || value === "") continue;
    keys[provider as WebProviderId] = value;
  }
  return keys;
}

/** Writes the record atomically: `writeWebConfig`'s reasoning, one file over. */
function writeStoredKeys(dir: string, keys: StoredKeys): void {
  const path = webSecretsPath(dir);
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  const fd = openSync(tmpPath, "w");
  try {
    writeSync(fd, `${JSON.stringify({ version: SECRETS_VERSION, keys }, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, path);
}

export function createWebSecrets(dir: string, cipher: SecretCipher): WebSecrets {
  return {
    apiKey(provider) {
      const stored = readStoredKeys(dir)[provider];
      if (stored === undefined) return null;
      const plaintext = cipher.decrypt(stored);
      if (plaintext === null) return null;
      return normalizeApiKey(plaintext);
    },
    setApiKey(provider, key) {
      const normalized = normalizeApiKey(key);
      if (normalized === null) {
        throw new WebSecretError("key", "The value is not shaped like an API key.");
      }
      // Refused rather than downgraded: writing the key in the clear would be
      // the one outcome this file exists to prevent, and `auth.ts` refuses
      // account creation for the same reason.
      if (!cipher.available()) {
        throw new WebSecretError("keystore-unavailable", "The OS key store is unavailable.");
      }
      writeStoredKeys(dir, { ...readStoredKeys(dir), [provider]: cipher.encrypt(normalized) });
    },
    clearApiKey(provider) {
      const keys = readStoredKeys(dir);
      if (keys[provider] === undefined) return;
      delete keys[provider];
      writeStoredKeys(dir, keys);
    },
  };
}

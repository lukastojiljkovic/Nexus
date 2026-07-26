import { existsSync } from "node:fs";
import Database from "better-sqlite3-multiple-ciphers";
import { foldSearchText } from "@nexus/core";
import { DatabaseKeyError, DatabaseLockedError } from "./errors.js";
import { runMigrations } from "./migrations/migrations.js";

type DatabaseHandle = Database.Database;

export interface OpenDatabaseOptions {
  /** Filesystem path to the SQLite file. Created if it does not exist. */
  path: string;
  /**
   * Optional 256-bit data key as 64 hexadecimal characters (ADR-004). When
   * present, the file is opened as a SQLCipher-compatible encrypted database.
   * The key is used *raw* (no KDF) — it is already the derived data key.
   */
  encryptionKey?: string;
}

const RAW_KEY_HEX = /^[0-9a-fA-F]{64}$/;

/** Thin owning wrapper over a better-sqlite3 connection. */
export class NexusDatabase {
  constructor(readonly raw: DatabaseHandle) {}

  close(): void {
    this.raw.close();
  }
}

/**
 * Opens (creating if absent) the SQLite file, decrypting it when an
 * `encryptionKey` is given, enabling WAL and foreign keys, and running pending
 * migrations. A wrong or missing key surfaces as a typed `DatabaseLockedError`
 * and a future-schema file as a `SchemaVersionError` — never a raw driver throw.
 */
export function openDatabase(options: OpenDatabaseOptions): NexusDatabase {
  const db = new Database(options.path);
  try {
    if (options.encryptionKey !== undefined) {
      applyEncryptionKey(db, options.encryptionKey);
    }
    assertReadable(db, options.encryptionKey !== undefined);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    registerSearchFold(db);
    runMigrations(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return new NexusDatabase(db);
}

/**
 * True when the file exists and opens readable WITHOUT a key — i.e. it
 * predates encryption (ADR-018). A missing file is `false`: there is nothing
 * to migrate, not an error. Opens its own short-lived connection with
 * `fileMustExist` so a concurrently-deleted path is never auto-created as a
 * side effect of merely checking it.
 */
export function isPlaintextDatabase(path: string): boolean {
  if (!existsSync(path)) return false;
  const db = new Database(path, { fileMustExist: true });
  try {
    db.prepare("SELECT count(*) FROM sqlite_master").get();
    return true;
  } catch (error) {
    if (isNotADatabaseError(error)) return false;
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Encrypts an existing plaintext database in place (SQLCipher rekey), so an
 * install made before passcodes existed gains encryption at rest without
 * losing its data (ADR-018). Validates `encryptionKey` with the same raw-hex
 * guard `openDatabase` uses, then runs the sequence probed against
 * SQLite3MultipleCiphers before this ADR was written: `PRAGMA
 * cipher='sqlcipher';` followed by `PRAGMA rekey="x'<hex>'";`, which rewrites
 * the file under the new key and leaves it immediately readable.
 *
 * Refuses (throws `DatabaseKeyError`) when the file is not currently
 * plaintext — missing, already encrypted, or not a database at all. Rekeying
 * a file that is already encrypted, using a raw `key`/`rekey` pair the file
 * was never opened with, does not fail loudly; it silently produces an
 * unreadable file. Refusing up front is the only safe option.
 */
export function encryptDatabaseInPlace(path: string, encryptionKey: string): void {
  assertValidKeyHex(encryptionKey);
  if (!isPlaintextDatabase(path)) {
    throw new DatabaseKeyError(
      "Cannot encrypt: the file is missing, already encrypted, or not a valid SQLite database.",
    );
  }
  const db = new Database(path, { fileMustExist: true });
  try {
    db.pragma("cipher = 'sqlcipher'");
    db.pragma(`rekey = "x'${encryptionKey}'"`);
  } finally {
    db.close();
  }
}

/**
 * Registers `nx_fold` as a deterministic SQL function backed by `@nexus/core`'s
 * `foldSearchText` (ADR-021). Global search's index (migration 017) is
 * maintained entirely by triggers written in SQL, and folding — the one step
 * SQLite's own FTS5 tokenizer cannot do for Serbian (it does not fold `đ`, and
 * nothing at all for Cyrillic) — has to happen inside those triggers. This is
 * the one place a connection acquires that ability. It runs BEFORE
 * `runMigrations`: migration 017's one-time backfill of existing rows calls
 * `nx_fold` directly, so the function must already exist when that migration
 * runs, not just when the app's own trigger-driven writes happen later. A
 * `NULL` input yields a `NULL` output rather than throwing or coercing to a
 * string, matching ordinary SQL NULL-propagation semantics.
 */
function registerSearchFold(db: DatabaseHandle): void {
  db.function("nx_fold", { deterministic: true }, (value: unknown) =>
    typeof value === "string" ? foldSearchText(value) : null,
  );
}

/**
 * Selects the SQLCipher-compatible cipher and installs the raw key BEFORE any
 * other statement touches the file. Sequence per the SQLite3MultipleCiphers
 * docs (cipher_sqlcipher): `PRAGMA cipher='sqlcipher';` then `PRAGMA key=...`.
 * The key is passed as a raw-key literal `x'<hex>'` so SQLCipher uses it
 * directly with no KDF. `PRAGMA key` cannot be parameterized; the strict hex
 * check above guarantees the interpolated value can carry no SQL.
 */
function applyEncryptionKey(db: DatabaseHandle, key: string): void {
  assertValidKeyHex(key);
  db.pragma("cipher = 'sqlcipher'");
  db.pragma(`key = "x'${key}'"`);
}

/** The one place both `openDatabase` and `encryptDatabaseInPlace` check that a key is a well-formed raw 256-bit hex string, so a bad value can carry no SQL into an interpolated PRAGMA. */
function assertValidKeyHex(key: string): void {
  if (!RAW_KEY_HEX.test(key)) {
    throw new DatabaseKeyError(
      "encryptionKey must be a 256-bit key encoded as 64 hexadecimal characters.",
    );
  }
}

/**
 * Forces a read so a wrong or missing key surfaces now as a typed
 * `DatabaseLockedError` instead of a raw `SQLITE_NOTADB` later (ADR-001).
 */
function assertReadable(db: DatabaseHandle, encrypted: boolean): void {
  try {
    db.prepare("SELECT count(*) FROM sqlite_master").get();
  } catch (error) {
    if (isNotADatabaseError(error)) {
      throw new DatabaseLockedError(
        encrypted
          ? "Could not open the database: the encryption key is wrong, or the file is corrupt."
          : "The database file is encrypted or not a valid SQLite database; an encryption key is required.",
        { cause: error },
      );
    }
    throw error;
  }
}

function isNotADatabaseError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "SQLITE_NOTADB"
  );
}

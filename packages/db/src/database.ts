import Database from "better-sqlite3-multiple-ciphers";
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
    runMigrations(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return new NexusDatabase(db);
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
  if (!RAW_KEY_HEX.test(key)) {
    throw new DatabaseKeyError(
      "encryptionKey must be a 256-bit key encoded as 64 hexadecimal characters.",
    );
  }
  db.pragma("cipher = 'sqlcipher'");
  db.pragma(`key = "x'${key}'"`);
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

/** Base class for every `@nexus/db` error, so callers can catch the whole family. */
export class DatabaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Thrown when an encrypted database cannot be decrypted: a wrong or missing
 * encryption key, or an encrypted file opened without one. The underlying
 * `SQLITE_NOTADB` is wrapped so callers never see a raw driver error (ADR-001).
 */
export class DatabaseLockedError extends DatabaseError {}

/** Thrown when the supplied encryption key is not a valid 256-bit hex string. */
export class DatabaseKeyError extends DatabaseError {}

/**
 * Thrown when the file's `PRAGMA user_version` is newer than the latest
 * migration this build knows about. Forward-only rule (ADR-001, SET-011):
 * refuse rather than risk corrupting data written by a newer app.
 */
export class SchemaVersionError extends DatabaseError {}

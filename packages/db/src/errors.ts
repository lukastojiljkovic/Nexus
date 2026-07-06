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

/**
 * Thrown when a write is rejected at a store boundary because its input breaks a
 * domain rule the UI is expected to have caught already — an empty task title, a
 * value outside a closed enum, or a malformed timestamp (TASK-001). The store
 * revalidates because renderer input is untrusted (SEC-EL-02).
 */
export class TaskValidationError extends DatabaseError {}

/**
 * Thrown when a task operation targets an id that is not an active row in the
 * store's own profile — unknown, soft-deleted (for a mutation), or owned by
 * another profile. Surfacing this uniformly keeps one profile's tasks invisible
 * to a store scoped to another.
 */
export class TaskNotFoundError extends DatabaseError {}

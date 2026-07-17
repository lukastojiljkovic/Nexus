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

/**
 * Thrown when a calendar write is rejected at the store boundary because its
 * input breaks a domain rule the UI is expected to have caught already — an
 * empty event title, a malformed timestamp, or an end that precedes its start
 * (CAL-001). The store revalidates because renderer input is untrusted (SEC-EL-02).
 */
export class EventValidationError extends DatabaseError {}

/**
 * Thrown when an event operation targets an id that is not an active row in the
 * store's own profile — unknown, soft-deleted (for a mutation), or owned by
 * another profile. Surfacing this uniformly keeps one profile's events invisible
 * to a store scoped to another.
 */
export class EventNotFoundError extends DatabaseError {}

/**
 * Thrown when a document write is rejected at the store boundary because its
 * input breaks a domain rule the UI is expected to have caught already — an
 * empty label, an unknown document type, a malformed expiry date, or a reminder
 * ladder that is not a list of non-negative integers (CAL-004). The store
 * revalidates because renderer input is untrusted (SEC-EL-02).
 */
export class DocumentValidationError extends DatabaseError {}

/**
 * Thrown when a document operation targets an id that is not an active row in the
 * store's own profile — unknown, soft-deleted (for a mutation), or owned by
 * another profile. Surfacing this uniformly keeps one profile's documents
 * invisible to a store scoped to another.
 */
export class DocumentNotFoundError extends DatabaseError {}

/**
 * Thrown when a subject write is rejected at the store boundary because its input
 * breaks a domain rule the UI is expected to have caught already — an empty name
 * or a colour outside the closed palette (STUDY). The store revalidates because
 * renderer input is untrusted (SEC-EL-02).
 */
export class SubjectValidationError extends DatabaseError {}

/**
 * Thrown when a subject operation targets an id that is not an active row in the
 * store's own profile — unknown, soft-deleted (for a mutation), or owned by
 * another profile. Surfacing this uniformly keeps one profile's subjects
 * invisible to a store scoped to another.
 */
export class SubjectNotFoundError extends DatabaseError {}

/**
 * Thrown when an exam write is rejected at the store boundary because its input
 * breaks a domain rule the UI is expected to have caught already — an unknown
 * exam type, a malformed exam date, or a `subjectId` that does not resolve to a
 * subject in this profile (STUDY). The store revalidates because renderer input
 * is untrusted (SEC-EL-02).
 */
export class ExamValidationError extends DatabaseError {}

/**
 * Thrown when an exam operation targets an id that is not an active row in the
 * store's own profile — unknown, soft-deleted (for a mutation), or owned by
 * another profile. Surfacing this uniformly keeps one profile's exams invisible
 * to a store scoped to another.
 */
export class ExamNotFoundError extends DatabaseError {}

/**
 * Thrown when a deck write is rejected at the store boundary because its input
 * breaks a domain rule the UI is expected to have caught already — an empty or
 * too-long name, or a `subjectId` that does not resolve to a subject in this
 * profile (STUDY flashcards). The store revalidates because renderer input is
 * untrusted (SEC-EL-02).
 */
export class DeckValidationError extends DatabaseError {}

/**
 * Thrown when a deck operation targets an id that is not an active row in the
 * store's own profile — unknown, soft-deleted (for a mutation), or owned by
 * another profile. Surfacing this uniformly keeps one profile's decks invisible
 * to a store scoped to another.
 */
export class DeckNotFoundError extends DatabaseError {}

/**
 * Thrown when a card write is rejected at the store boundary because its input
 * breaks a domain rule the UI is expected to have caught already — empty/too-long
 * front or back, a malformed `now`, an out-of-range review rating, a `deckId` that
 * does not resolve to a deck in this profile, or an undo with no review to undo
 * (STUDY flashcards / FSRS). The store revalidates because renderer input is
 * untrusted (SEC-EL-02).
 */
export class CardValidationError extends DatabaseError {}

/**
 * Thrown when a card operation targets an id that is not an active row in the
 * store's own profile — unknown, soft-deleted (for a mutation), or owned by
 * another profile. Surfacing this uniformly keeps one profile's cards invisible
 * to a store scoped to another.
 */
export class CardNotFoundError extends DatabaseError {}

/**
 * Thrown when a study-plan write is rejected at the store boundary because its
 * input breaks a domain rule the UI is expected to have caught already — an
 * exam that is not strictly in the future, a start date on/after the exam
 * date, an out-of-range `dailyMinutes`, a malformed `now`/`today`, an `examId`
 * that does not resolve to an active exam in this profile, a second active
 * plan for an exam that already has one (including a restore that would
 * collide with one created meanwhile), or an unknown block status (STUDY exam
 * planner). The store revalidates because renderer input is untrusted
 * (SEC-EL-02).
 */
export class PlanValidationError extends DatabaseError {}

/**
 * Thrown when a study-plan or study-block operation targets an id that is not
 * an active row in the store's own profile — unknown, soft-deleted (for a
 * plan mutation), or owned by another profile. Surfacing this uniformly keeps
 * one profile's plans/blocks invisible to a store scoped to another.
 */
export class PlanNotFoundError extends DatabaseError {}

/**
 * Thrown when a focus-session write is rejected at the store boundary because
 * its input breaks a domain rule the UI is expected to have caught already —
 * a malformed `now`/`startedAt`/`endedAt`, an `endedAt` that does not strictly
 * follow `startedAt`, a malformed `fromDate`/`toDate` range, or a `subjectId`
 * that does not resolve to an active subject in this profile (STUDY stats /
 * focus sessions). The store revalidates because renderer input is untrusted
 * (SEC-EL-02).
 */
export class FocusValidationError extends DatabaseError {}

/**
 * Thrown when a focus-session operation targets an id that is not an active
 * row in the store's own profile — unknown, soft-deleted (for a mutation), or
 * owned by another profile. Surfacing this uniformly keeps one profile's
 * focus sessions invisible to a store scoped to another.
 */
export class FocusNotFoundError extends DatabaseError {}

/**
 * Thrown when a notification write is rejected at the store boundary because
 * its input breaks a domain rule the caller is expected to have caught
 * already — a malformed "HH:MM" quiet-hours/morning-hour time, quiet hours
 * set on only one side of the pair, an unknown source, an empty or too-long
 * title/body, a malformed `now`/`until`, an `until` that does not strictly
 * follow `now`, or a UNIQUE collision on (profile, source, entity, occurrence)
 * — an occurrence is recorded once; a re-fire after a snooze goes through
 * `markRefired`, never a second `recordDelivered` (NTF). The store
 * revalidates because renderer input is untrusted (SEC-EL-02).
 */
export class NotificationValidationError extends DatabaseError {}

/**
 * Thrown when a notification-ledger operation targets an id that is not a row
 * in the store's own profile — unknown, owned by another profile, or (for
 * `markRefired`) not currently `snoozed`. Surfacing this uniformly keeps one
 * profile's notifications invisible to a store scoped to another.
 */
export class NotificationNotFoundError extends DatabaseError {}

/**
 * Thrown when a note write is rejected at the store boundary because its input
 * breaks a domain rule the caller is expected to have caught already — an
 * empty or over-256 KB Yjs update blob, a title longer than 200 characters
 * after trimming, a malformed `now`, a compaction whose `coveredSeq` would
 * regress below the snapshot already stored (NOTE / ADR-012), or more than
 * 500 outbound wiki-links in one `setOutboundLinks` call (ADR-013 / NOTE-004).
 * The store revalidates because renderer input is untrusted (SEC-EL-02).
 */
export class NoteValidationError extends DatabaseError {}

/**
 * Thrown when a note operation targets an id that is not an active row in the
 * store's own profile — unknown, soft-deleted, or owned by another profile.
 * Every update/snapshot access is gated through this check (`requireActive`),
 * so one profile's notes and their child rows are invisible to a store scoped
 * to another.
 */
export class NoteNotFoundError extends DatabaseError {}

/**
 * Thrown when a note-folder write is rejected at the store boundary because its
 * input breaks a domain rule the caller is expected to have caught already — an
 * empty or over-100-character name, a colour outside the closed palette, a
 * malformed `now`, or a move that would make a folder its own ancestor (a cycle)
 * (NOTE organization / ADR-012). The store revalidates because renderer input is
 * untrusted (SEC-EL-02).
 */
export class NoteFolderValidationError extends DatabaseError {}

/**
 * Thrown when a note-folder operation targets an id that is not a folder in the
 * store's own profile — unknown or owned by another profile — including a
 * `parentId`/`folderId` reference that does not resolve there. Surfacing this
 * uniformly keeps one profile's folders invisible to a store scoped to another.
 */
export class NoteFolderNotFoundError extends DatabaseError {}

/**
 * Thrown when a note-tag write is rejected at the store boundary because its
 * input breaks a domain rule the caller is expected to have caught already — an
 * empty or over-50-character name, or a rename that would collide with another
 * tag's name in this profile (the UNIQUE(profile_id, name) index, surfaced as a
 * domain error rather than a raw driver error) (NOTE organization). The store
 * revalidates because renderer input is untrusted (SEC-EL-02).
 */
export class NoteTagValidationError extends DatabaseError {}

/**
 * Thrown when a note-tag operation targets an id that is not a tag in the
 * store's own profile — unknown or owned by another profile. Surfacing this
 * uniformly keeps one profile's tags invisible to a store scoped to another.
 */
export class NoteTagNotFoundError extends DatabaseError {}

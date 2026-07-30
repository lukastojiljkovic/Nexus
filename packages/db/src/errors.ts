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

/**
 * Thrown when an encryption key cannot be applied: it is not a valid 256-bit
 * hex string, or (ADR-018's `encryptDatabaseInPlace`) the target file is not
 * the plaintext database that key was meant to convert. Both are "this key
 * cannot be used here", as opposed to `DatabaseLockedError`'s "this key was
 * used and it was the wrong one".
 */
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
 * Thrown when a task-list or task-section write is rejected at the store
 * boundary because its input breaks a domain rule the caller is expected to
 * have caught already — an empty or over-long name after trimming, a view
 * outside the closed `list`/`kanban` set, a malformed `now`, a move that would
 * make a list its own ancestor (a cycle), a delete or a move aimed at the
 * profile's Inbox (which is neither), or a `beforeId`/`afterId` pair that
 * describes no gap in the target scope (TASK-004 / ADR-029). One class covers
 * both row kinds because one store owns both: a section is a heading inside a
 * list, sharing its ordering helper and every list-scoped invariant, so
 * splitting the validation error would only ask callers to catch two names for
 * one boundary. The store revalidates because renderer input is untrusted
 * (SEC-EL-02).
 */
export class TaskListValidationError extends DatabaseError {}

/**
 * Thrown when a task-list operation targets an id that is not an active row in
 * the store's own profile — unknown, soft-deleted (for a mutation), or owned by
 * another profile — including a `parentId`/`listId` reference that does not
 * resolve there. Surfacing this uniformly keeps one profile's lists invisible to
 * a store scoped to another.
 */
export class TaskListNotFoundError extends DatabaseError {}

/**
 * Thrown when a task-section operation targets an id that is not a section of a
 * list in the store's own profile — unknown, belonging to another list, or
 * reached through a list this profile does not own. Sections carry no
 * `profile_id` of their own, so this gate (always a join through `task_lists`)
 * is the whole of their profile scoping.
 */
export class TaskSectionNotFoundError extends DatabaseError {}

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
 * Thrown when a person write is rejected at the store boundary because its
 * input breaks a domain rule the UI is expected to have caught already — an
 * empty name, an unknown kind, a malformed `now`, a birth year outside the
 * accepted range, or a (month, day) pair that is no calendar day in any year
 * (CAL-007 / ADR-026). The last one is the reason this class exists at all:
 * migration 020's per-column CHECKs cannot see the pair, so the store is the
 * only gate for it. Inputs are revalidated here because the renderer is
 * untrusted (SEC-EL-02).
 */
export class PersonValidationError extends DatabaseError {}

/**
 * Thrown when a person operation targets an id that is not an active row in
 * the store's own profile — unknown, soft-deleted (for a mutation), or owned
 * by another profile. Surfacing this uniformly keeps one profile's people
 * invisible to a store scoped to another.
 */
export class PersonNotFoundError extends DatabaseError {}

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

/**
 * Thrown when a note-attachment write is rejected at the store boundary
 * because its input breaks a domain rule the caller is expected to have
 * caught already — an empty, over-255-character, or path-separator-carrying
 * `fileName`, a malformed or over-100-character `mime`, a `sizeBytes` that is
 * not a positive integer within `MAX_NOTE_ATTACHMENT_BYTES`, a malformed
 * `sha256`, or a malformed `now` (ADR-014 / NOTE-003). The store revalidates
 * because renderer input is untrusted (SEC-EL-02).
 */
export class NoteAttachmentValidationError extends DatabaseError {}

/**
 * Thrown when a note-attachment operation targets a note that is not active
 * in the store's own profile (unknown, soft-deleted, or owned by another
 * profile — surfaced as `NoteNotFoundError`, the same gate every other note
 * child table uses), or when `remove` targets an attachment id that is not a
 * row of that note (unknown, or belonging to a different note) (ADR-014 /
 * NOTE-003).
 */
export class NoteAttachmentNotFoundError extends DatabaseError {}

/**
 * Thrown when `loadVersion` targets a `covered_seq` that has no checkpoint
 * row for that note — never captured, or pruned past the `MAX_NOTE_VERSIONS`
 * retention window (ADR-015 / NOTE-008). The note itself being missing,
 * soft-deleted, or owned by another profile surfaces as `NoteNotFoundError`
 * instead, the same gate every other note child table uses.
 */
export class NoteVersionNotFoundError extends DatabaseError {}

/**
 * Thrown when a note-template write is rejected at the store boundary
 * because its input breaks a domain rule the caller is expected to have
 * caught already — an empty or over-100-character name after trimming, a
 * rename that would collide with another template's name in this profile
 * (the UNIQUE(profile_id, name) index, surfaced as a domain error rather
 * than a raw driver error — the `renameTag` precedent), empty content, a
 * content string over `MAX_NOTE_TEMPLATE_BYTES`, content that is not valid
 * JSON, or JSON that does not parse to an object with `type: "doc"` (ADR-016
 * / NOTE-009). The store revalidates because renderer input is untrusted
 * (SEC-EL-02); this is a semantic check of an otherwise opaque column, not a
 * schema check of the document's own blocks.
 */
export class NoteTemplateValidationError extends DatabaseError {}

/**
 * Thrown when a note-template operation targets an id that is not a
 * template in the store's own profile — unknown or owned by another
 * profile. Surfacing this uniformly keeps one profile's templates invisible
 * to a store scoped to another (ADR-016 / NOTE-009).
 */
export class NoteTemplateNotFoundError extends DatabaseError {}

/**
 * Thrown when a global-search read is rejected at the store boundary because
 * its input breaks a domain rule the caller is expected to have caught
 * already — an empty or whitespace-only `match`, an empty `kinds` array, an
 * unknown search kind, a non-integer/zero/negative `limit`, or a malformed
 * FTS5 MATCH expression the driver itself rejected (ADR-021). The store
 * revalidates because renderer input is untrusted (SEC-EL-02): a
 * well-formed expression from `toFtsMatchExpression` (`@nexus/core`) can
 * never trigger the last case, but the store's boundary does not get to
 * assume its caller built one correctly.
 */
export class SearchValidationError extends DatabaseError {}

/**
 * Thrown when a `RestoreStore.replaceProfileData` call is given a `ProfileData`
 * that is internally inconsistent in a way `@nexus/core`'s `parseImportArchive`
 * cannot check on its own — currently: a note whose `snapshot` is non-null with
 * no matching entry in the caller-supplied `derived` map (IMEX / ADR-023). The
 * parser validates one archive file at a time and has no way to demand a
 * companion map of derived values from the caller; the restore boundary is what
 * enforces that pairing before anything is written, rather than silently
 * persisting a snapshot with an empty, unsearchable plaintext body.
 */
export class RestoreValidationError extends DatabaseError {}

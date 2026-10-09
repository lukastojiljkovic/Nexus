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
 * Thrown when a task-tag write is rejected at the store boundary because its
 * input breaks a domain rule the caller is expected to have caught already — an
 * empty or over-50-character name, a malformed `now`, or a rename that would
 * collide with another tag's name in this profile (the UNIQUE(profile_id, name)
 * index, surfaced as a domain error rather than a raw driver error). The rules
 * are `NoteTagValidationError`'s verbatim, because task tags are the `note_tags`
 * feature applied to tasks (migration 023). The store revalidates because
 * renderer input is untrusted (SEC-EL-02).
 */
export class TaskTagValidationError extends DatabaseError {}

/**
 * Thrown when a task-tag operation targets an id that is not a tag in the
 * store's own profile — unknown or owned by another profile. Surfacing this
 * uniformly keeps one profile's tags invisible to a store scoped to another
 * (the `NoteTagNotFoundError` arrangement).
 */
export class TaskTagNotFoundError extends DatabaseError {}

/**
 * Thrown when a task-attachment write is rejected at the store boundary
 * because its input breaks a domain rule the caller is expected to have caught
 * already — an empty, over-255-character, or path-separator-carrying
 * `fileName`, a malformed or over-100-character `mime`, a `sizeBytes` that is
 * not a positive integer within `MAX_TASK_ATTACHMENT_BYTES`, a malformed
 * `sha256`, or a malformed `now` (migration 024). The rules are
 * `NoteAttachmentValidationError`'s verbatim, because a task attachment is the
 * NOTE-003 feature applied to tasks. The store revalidates because renderer
 * input is untrusted (SEC-EL-02).
 */
export class TaskAttachmentValidationError extends DatabaseError {}

/**
 * Thrown when a task-attachment operation targets a task that is not active in
 * the store's own profile (unknown, soft-deleted, or owned by another profile —
 * surfaced as `TaskNotFoundError`, the same gate `TaskTagStore.attachTag`
 * uses), or when `remove` targets an attachment id that is not a row of that
 * task (unknown, or belonging to a different task). The
 * `NoteAttachmentNotFoundError` arrangement, one module over.
 */
export class TaskAttachmentNotFoundError extends DatabaseError {}

/**
 * Thrown when a task template's name or payload breaks a rule the UI should
 * have caught — an empty name, a payload field outside its domain, a reminder
 * ladder or recurrence rule with no `dueOffsetDays` to anchor on. Raised on the
 * way IN (an untrusted caller, SEC-EL-02) and equally on the way OUT, where it
 * reports a stored row that no longer parses — corruption, never something to
 * coerce, exactly as `TaskStore`'s own stored-column readers treat it.
 */
export class TaskTemplateValidationError extends DatabaseError {}

/**
 * Thrown when a task-template operation targets an id that is not a template in
 * the store's own profile — unknown or owned by another profile (the
 * `NoteTemplateNotFoundError` arrangement).
 */
export class TaskTemplateNotFoundError extends DatabaseError {}

/**
 * Thrown when a task-dependency write is rejected at the store boundary because
 * it would break the one rule the schema cannot state (ADR-037): a task blocking
 * itself, or an edge that would close a loop in the blocker graph. No `CHECK`
 * can walk a graph, so this guard — a recursive CTE over the blocker chain — is
 * the whole of it on the live path, with `importArchive.ts`'s parser twin
 * covering the one path that bypasses the store entirely.
 *
 * There is deliberately no `TaskDependencyNotFoundError` beside it, unlike the
 * task-tag pair above: both ends of an edge are TASKS, so an id that does not
 * resolve in this profile is already `TaskNotFoundError`, and removing an edge
 * that is not there is a silent no-op (`detachTag`'s rule) rather than an error
 * needing a name.
 */
export class TaskDependencyValidationError extends DatabaseError {}

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
 * Thrown when an event template's name or payload breaks a rule the UI should
 * have caught (CAL-009) — an empty name, a payload field outside its domain, a
 * time of day on an all-day template, a duration that would carry the event past
 * the end of its own day. Raised on the way IN (an untrusted caller, SEC-EL-02)
 * and equally on the way OUT, where it reports a stored row that no longer
 * parses — corruption, never something to coerce, exactly as
 * `TaskTemplateValidationError` is used one module over.
 */
export class EventTemplateValidationError extends DatabaseError {}

/**
 * Thrown when an event-template operation targets an id that is not a template
 * in the store's own profile — unknown or owned by another profile (the
 * `TaskTemplateNotFoundError` arrangement).
 */
export class EventTemplateNotFoundError extends DatabaseError {}

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
 * Thrown when a subject-material write is rejected at the store boundary
 * because its input breaks a domain rule the caller is expected to have caught
 * already — an empty, over-255-character, or path-separator-carrying
 * `fileName`, a malformed or over-100-character `mime`, a `sizeBytes` that is
 * not a positive integer within `MAX_SUBJECT_ATTACHMENT_BYTES`, a malformed
 * `sha256`, or a malformed `now` (migration 035). The rules are
 * `TaskAttachmentValidationError`'s verbatim, because a subject material is the
 * NOTE-003 feature applied to subjects. The store revalidates because renderer
 * input is untrusted (SEC-EL-02).
 */
export class SubjectAttachmentValidationError extends DatabaseError {}

/**
 * Thrown when a subject-material operation targets a subject that is not active
 * in the store's own profile (unknown, soft-deleted, or owned by another
 * profile — surfaced as `SubjectNotFoundError`), or when `remove` targets a
 * material id that is not a row of that subject (unknown, or belonging to a
 * different subject). The `TaskAttachmentNotFoundError` arrangement, one module
 * over.
 */
export class SubjectAttachmentNotFoundError extends DatabaseError {}

/**
 * Thrown when a subject↔note link write carries a malformed `now` (migration
 * 035). Deliberately the only rule this class covers: both ends of a link are
 * ROWS, so an id that does not resolve in this profile is already
 * `SubjectNotFoundError` or `NoteNotFoundError`, unlinking something that is not
 * there is a silent no-op (`removeDependency`'s rule), and a link has no graph
 * to keep acyclic — nothing else here needs a name of its own.
 */
export class SubjectNoteLinkValidationError extends DatabaseError {}

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
 * Thrown when an exam-topic write is rejected at the store boundary because
 * its input breaks a domain rule the UI is expected to have caught already —
 * an empty or over-long name after trimming, a confidence outside 0..100, a
 * rank outside the exam's contiguous 0..n-1 range, a `deckId` or `examId`
 * that does not resolve to an active row in this profile, or a malformed
 * `now` (ADR-063). The store revalidates because renderer input is untrusted
 * (SEC-EL-02).
 */
export class ExamTopicValidationError extends DatabaseError {}

/**
 * Thrown when an exam-topic operation targets an id that is not an active row
 * in the store's own profile — unknown, soft-deleted (for a mutation), or
 * owned by another profile. Surfacing this uniformly keeps one profile's
 * topics invisible to a store scoped to another.
 */
export class ExamTopicNotFoundError extends DatabaseError {}

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
 * Thrown when a note-category write is rejected at the store boundary because
 * its input breaks a domain rule the caller is expected to have caught already
 * — an empty or over-50-character name, a colour outside the closed palette, a
 * malformed `now`, or a create/rename colliding with another category's name in
 * this profile (migration 049's `UNIQUE (profile_id, name)`, surfaced as a
 * domain error rather than a raw driver error) (NOTE-002). The store revalidates
 * because renderer input is untrusted (SEC-EL-02).
 */
export class NoteCategoryValidationError extends DatabaseError {}

/**
 * Thrown when a note-category operation targets an id that is not a category in
 * the store's own profile — unknown or owned by another profile — including a
 * `categoryId` reference that does not resolve there. Surfacing this uniformly
 * keeps one profile's categories invisible to a store scoped to another.
 */
export class NoteCategoryNotFoundError extends DatabaseError {}

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
 * row for that note — never captured, or since thinned out by the tiered
 * retention schedule (ADR-015 / NOTE-008). The note itself being missing,
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
 *
 * Shared with `SearchHistoryStore` (SRCH-009), whose refusals are the same
 * kind of thing about the same feature: an empty or whitespace-only query —
 * what an UNUSED search box contains, and remembering it would be remembering
 * nothing — one past `MAX_SEARCH_HISTORY_QUERY_LENGTH`, a non-integer or
 * non-positive read limit, or a malformed `now`. One error class rather than
 * two, because a renderer that mishandles one mishandles the other
 * identically: both mean "the search surface sent something a search surface
 * never sends".
 */
export class SearchValidationError extends DatabaseError {}

/**
 * Thrown when „Datoteke"'s browse read is handed a filter no filter bar can
 * produce (DOC): an owner kind outside the three PUBLIC attachment surfaces, a
 * mime family outside `MIME_FAMILIES`, or a query longer than
 * `MAX_ATTACHMENT_QUERY_LENGTH`. The store revalidates because renderer input
 * is untrusted (SEC-EL-02), and the owner-kind refusal in particular is the one
 * that matters: a fourth kind arriving here would be a request for a table this
 * union deliberately does not read.
 */
export class AttachmentIndexValidationError extends DatabaseError {}

/**
 * Thrown when an archive-apply store — `RestoreStore.replaceProfileData`
 * (ADR-023) or `ForeignImportStore.insertPlanned` (ADR-043) — is given a
 * `ProfileData` that is internally inconsistent in a way `@nexus/core`'s
 * `parseImportArchive` cannot check on its own: a note whose `snapshot` is
 * non-null with no matching entry in the caller-supplied `derived` map (both
 * stores), or a task naming no list in an import plan, which the planner
 * resolves onto the target's Inbox and so can only mean the planner was
 * bypassed. The parser validates one archive file at a time and has no way to
 * demand a companion map of derived values — or a target profile — from the
 * caller; the apply boundary is what enforces those pairings before anything is
 * written, rather than silently persisting a snapshot with an empty,
 * unsearchable plaintext body or a task no list can show.
 */
export class RestoreValidationError extends DatabaseError {}

/**
 * Thrown when a dashboard-settings write breaks a rule migration 030's CHECKs
 * cannot express on their own (SET-006 / ADR-041): a background hash that is
 * not a 64-character lowercase sha256, a mime outside `isInlineImageMime`'s
 * four raster formats, a non-positive size, or a dim that is not a whole
 * number inside 0..`MAX_BACKGROUND_DIM`. The store revalidates because renderer
 * input is untrusted (SEC-EL-02) — even though main sniffs the mime and caps
 * the bytes itself, a store is never the place that assumes its caller did.
 */
export class DashboardSettingsValidationError extends DatabaseError {}

/**
 * Thrown when a backup-settings write breaks a rule migration 044's CHECKs
 * cannot express on their own or would leave the row in a state they forbid
 * (SET-011 / ADR-056): enabling a schedule before a folder and a wrapped
 * passphrase exist, a cadence outside `daily`/`weekly`, a `keepLast` that is
 * not a whole number inside `MIN_BACKUP_KEEP_LAST`..`MAX_BACKUP_KEEP_LAST`, an
 * empty or oversized folder path or wrap, a run record whose error does not
 * match its status, or a malformed timestamp. The store revalidates because
 * renderer input is untrusted (SEC-EL-02), even though main validates the same
 * fields at the IPC boundary — a store is never the place that assumes its
 * caller did.
 */
export class BackupSettingsValidationError extends DatabaseError {}

/**
 * Thrown when a calendar-settings write breaks a rule migration 042's CHECKs
 * cannot express on their own (CAL-010 / ADR-054): a half-set pair (the table
 * tolerates one so a single upsert can stage the halves; a term with one edge
 * means nothing), a value that is not a REAL calendar day (the GLOB knows
 * shapes, not February), or a start after its end. The store revalidates
 * because renderer input is untrusted (SEC-EL-02), even after main has already
 * checked the same three rules.
 */
export class CalendarSettingsValidationError extends DatabaseError {}

/**
 * Thrown when the cross-profile calendar overlay (CAL-005 / ADR-058 §5) is
 * asked something it must refuse: a viewer and foreign profile that are the
 * same id (an overlay of yourself is a caller bug, not a query), an empty id
 * on either side, a bound that is not a real calendar day, a reversed range,
 * or a span wider than `MAX_OVERLAY_RANGE_DAYS` (the DoS bound on recurrence
 * expansion). The store revalidates because renderer input is untrusted
 * (SEC-EL-02), even after main has checked the same rules at the IPC boundary.
 */
export class CalendarOverlayValidationError extends DatabaseError {}

/**
 * Thrown when a study-settings write breaks a rule migration 034's CHECKs
 * cannot express on their own (STUDY-007): a target retention outside
 * `MIN_TARGET_RETENTION`..`MAX_TARGET_RETENTION` or not a finite number at all,
 * a `newPerDay` that is not a whole number inside 0..`MAX_NEW_PER_DAY`, a
 * review cap that is neither `null` (uncapped) nor a whole number inside
 * 1..`MAX_REVIEWS_PER_DAY`, or a malformed `now`. The store revalidates because
 * renderer input is untrusted (SEC-EL-02).
 */
export class StudySettingsValidationError extends DatabaseError {}

/**
 * Thrown when a dashboard-layout write breaks a rule migration 032's CHECK
 * cannot express on its own (DASH-002 / ADR-045): a size outside `S`/`M`/`L`, a
 * widget id that is not a `moduleId:widgetId` slug, a `now` that is not an
 * ISO-8601 date-time, or a move whose `beforeId`/`afterId` describe no gap at
 * all — the same two ids, or the two given the wrong way round. Which widgets
 * EXIST is deliberately not among these: the catalogue lives in the module
 * manifests, and a layout must be able to hold a placement this build cannot
 * currently draw.
 */
export class DashboardWidgetValidationError extends DatabaseError {}

/** Thrown when a dashboard-layout call names a placement this profile does not have — the moved widget itself, or a neighbour it was to be ordered against. */
export class DashboardWidgetNotFoundError extends DatabaseError {}

/**
 * Thrown when a dashboard-set write breaks a rule migration 043's schema cannot
 * express on its own (DASH-008 / ADR-055): an empty or over-100-character name
 * after trimming, a malformed `now`, or a reorder whose `beforeId`/`afterId`
 * describe no gap at all — the moved set among them, or the two given the
 * wrong way round. The store revalidates because renderer input is untrusted
 * (SEC-EL-02).
 */
export class DashboardSetValidationError extends DatabaseError {}

/**
 * Thrown when a dashboard-set operation names a set this profile does not have —
 * unknown, or owned by another profile. Raised for the set itself, for a
 * reorder's neighbours, AND by `DashboardWidgetStore` for a layout scope that
 * names no set of this profile — the same uniform gate that keeps one profile's
 * rows invisible to a store scoped to another. The NULL scope is never in
 * question: „Početna“ is not a row, so there is nothing to fail to find.
 */
export class DashboardSetNotFoundError extends DatabaseError {}

/**
 * Thrown when a profile write breaks a rule the schema cannot fully express on
 * its own: a picture trio outside SET-001's bounds (a hash that is not a
 * 64-character lowercase sha256, a mime outside `isInlineImageMime`'s four
 * raster formats, a non-positive size), or — `ProfileStore.create` (ADR-058) —
 * a kind outside migration 001's CHECK domain, a name over 100 characters
 * after trimming, or a malformed `now`. The store revalidates for
 * `DashboardSettingsValidationError`'s reason — even where main produces the
 * values itself, a store is never the place that assumes its caller did.
 */
export class ProfileValidationError extends DatabaseError {}

/** Thrown when a profile write names an id no `profiles` row carries. */
export class ProfileNotFoundError extends DatabaseError {}

/**
 * Thrown when `ProfileStore.delete` targets the account's anchor — the
 * `kind === "personal"` profile (ADR-058). Business profiles come and go; the
 * personal profile is the account's identity, so deleting it is refused
 * outright rather than gated behind any confirmation.
 */
export class ProfileAnchorDeleteError extends DatabaseError {}

/**
 * Thrown when `ProfileStore.delete` would remove the last remaining profile.
 * A database with zero profiles is a state nothing above it can render or
 * recover from — every other store is constructed around a profile id — so
 * the last row is undeletable regardless of its kind.
 */
export class ProfileLastDeleteError extends DatabaseError {}

/**
 * Thrown when a private-note write breaks a rule migration 045's schema cannot
 * express on its own (ADR-057): empty sealed bytes, a non-positive version
 * sequence, a malformed `now`, or an id that names another profile's row —
 * the one cross-profile write the global `private_notes` primary key could
 * otherwise let through. The store revalidates because renderer input is
 * untrusted (SEC-EL-02), even though main is the only caller today.
 */
export class PrivateNoteValidationError extends DatabaseError {}

/** Thrown when a private-note call names an id this profile has no row for — unknown, or owned by another profile (the same uniform gate every scoped store keeps). */
export class PrivateNoteNotFoundError extends DatabaseError {}

/**
 * Thrown when a private-settings write breaks a rule migration 045's CHECKs
 * cannot fully express (ADR-057): a second setup for a profile that already
 * has one, a kit salt without a kit wrap (or the reverse), an empty or
 * oversized opaque field, an auto-lock outside 1..60 whole minutes, or a
 * malformed `now`. `updateLockPrefs`/`replaceWraps` against a profile that
 * never set PRIV up land here too — there is no row for them to mean.
 */
export class PrivateSettingsValidationError extends DatabaseError {}

/**
 * Thrown when a finance-account write is rejected at the store boundary because
 * its input breaks a domain rule the caller is expected to have caught already
 * (FIN, migration 051): an empty or over-60-character name, a `kind` outside the
 * closed cash/current/card/savings vocabulary, a `currency` that is not a
 * three-letter upper-case ISO-4217 code, an `openingBalance` that is not a safe
 * INTEGER of minor units, or a malformed `now`. The store revalidates because
 * renderer input is untrusted (SEC-EL-02).
 */
export class FinAccountValidationError extends DatabaseError {}

/**
 * Thrown when a finance operation targets an id that is not an active account in
 * the store's own profile — unknown, soft-deleted, or owned by another profile —
 * including a transaction's `accountId` or `counterAccountId` reference that does
 * not resolve there. Surfacing this uniformly keeps one profile's accounts
 * invisible to a store scoped to another.
 */
export class FinAccountNotFoundError extends DatabaseError {}

/**
 * Thrown when a finance-category write is rejected at the store boundary because
 * its input breaks a domain rule (FIN, migration 051): an empty or
 * over-60-character name, a `kind` outside income/expense, a malformed `now`, or
 * a create/rename colliding with another category of the SAME kind in this
 * profile (migration 051's `UNIQUE (profile_id, kind, name)`, surfaced as a
 * domain error rather than a raw driver error).
 */
export class FinCategoryValidationError extends DatabaseError {}

/**
 * Thrown when a finance operation targets an id that is not a category in the
 * store's own profile — unknown or owned by another profile — including a
 * transaction's or a budget's `categoryId` reference that does not resolve
 * there. Surfacing this uniformly keeps one profile's categories invisible to a
 * store scoped to another.
 */
export class FinCategoryNotFoundError extends DatabaseError {}

/**
 * Thrown when a transaction write is rejected at the store boundary (FIN,
 * migration 051): a `date` that is not a real bare `YYYY-MM-DD` local day, an
 * `amount` that is not a non-zero safe INTEGER of minor units, an over-length
 * `payee`/`note`, a malformed `now`, a backwards or malformed reporting period,
 * or any of the three transfer refusals — a transfer whose two sides are the
 * same account, a transfer across two different currencies (there is no FX in
 * this app and a stale invented rate is worse than no total), and a transfer
 * carrying a category (it is neither income nor expense, so no category could
 * honestly describe it).
 *
 * Deliberately NOT among them: a category whose kind seems to contradict the
 * amount's sign. A refund is money coming back under the very expense category
 * it went out of, and refusing it would force the user to either lose the label
 * or invent „Povraćaj". The kind classifies (which picker, which report); the
 * sign carries the direction.
 */
export class FinTransactionValidationError extends DatabaseError {}

/**
 * Thrown when a transaction operation targets an id that is not an active
 * transaction in the store's own profile — unknown, soft-deleted, or owned by
 * another profile.
 */
export class FinTransactionNotFoundError extends DatabaseError {}

/**
 * Thrown when a budget write is rejected at the store boundary (FIN, migration
 * 051): an `amount` that is not a positive safe INTEGER of minor units, a
 * `currency` that is not a three-letter upper-case ISO-4217 code, a malformed
 * `now`, or a budget set on an INCOME category. That last one is a deliberate
 * refusal rather than an oversight: a budget is a spending LIMIT, and an income
 * category would need a target — which compares in the opposite direction (under
 * is bad, not good), so one row meaning both would make every reader ask which
 * way is good and answer it with a join.
 */
export class FinBudgetValidationError extends DatabaseError {}

/**
 * Thrown when a budget operation targets an id that is not a budget in the
 * store's own profile — unknown or owned by another profile.
 */
export class FinBudgetNotFoundError extends DatabaseError {}

/**
 * Thrown when a subscription write is rejected at the store boundary (FIN slice
 * d, migration 053): an `amount` that is not a non-zero safe INTEGER of minor
 * units, an empty or over-long `name`, a `startDate` that is not a real calendar
 * day, a `reminderDays` outside 0..365, a malformed `now`/`today`, or — the one
 * worth naming out loud — a `recurrence` that is not a valid ADR-024 rule. FIN
 * has no rule language of its own: `validateRecurrenceRule` is the same gate
 * `TaskStore` and `EventStore` run every rule through, so a schedule that would
 * be refused on a task is refused on a subscription for the identical reason.
 */
export class FinRecurringValidationError extends DatabaseError {}

/**
 * Thrown when a subscription operation targets an id that is not an active
 * subscription in the store's own profile — unknown, soft-deleted, or owned by
 * another profile.
 */
export class FinRecurringNotFoundError extends DatabaseError {}

/**
 * Thrown when a habit or habit-entry write is rejected at the store boundary
 * (HABIT slice a, migration 055): an empty or over-long `name`, a `colour`
 * outside the folder palette, a `target`/`value` that is not a positive whole
 * count, a `unit` on a habit with no target to count, a malformed
 * `reminderTime`/`now`, an entry day that is not a real calendar day — or the one
 * worth naming out loud, a `schedule` that is not a valid `HabitSchedule`.
 *
 * That last refusal is where HABIT's central decision is enforced: this module
 * has its own two-kind schedule vocabulary and deliberately does NOT speak
 * ADR-024's rule language (`habitSchedule.ts`), so a recurrence rule offered here
 * is refused exactly as a habit schedule would be on a task.
 */
export class HabitValidationError extends DatabaseError {}

/**
 * Thrown when a habit operation targets an id that is not a live habit in the
 * store's own profile — unknown, soft-deleted, or owned by another profile. An
 * ARCHIVED habit is NOT among these: archiving hides a habit from today's list
 * and says nothing about whether it is still here (migration 055's two
 * independent timestamps), so it stays editable and its history stays
 * correctable.
 */
export class HabitNotFoundError extends DatabaseError {}

/**
 * Thrown when a recording or marker write is rejected at the store boundary
 * because its input breaks a domain rule the UI is expected to have caught
 * already (RECORDER slice a, migration 077): a `kind` outside `audio`/`video`, a
 * `mime` outside the closed list `RECORDING_MIME_TYPES` — or a mime whose family
 * disagrees with the kind, which is two answers to one question — a
 * `durationMs`/`sizeBytes` that is not a positive whole number within its cap, a
 * `sha256` that is not 64 lowercase hex characters, an over-long title, note,
 * transcript or marker label, too many tags or markers, a diary flag with no
 * date to file it under, a diary date on a recording that is not a diary, a
 * malformed `now`, a marker whose `atMs` falls outside its recording's duration,
 * or an imported archive value that is not this store's own format.
 *
 * The import case is the one worth naming: `importData` validates the WHOLE
 * value before it writes anything, so a refusal here means the profile still
 * holds exactly what it held before the call. The store revalidates because the
 * archive is a file the user picked and stage 2's IPC passes it through
 * (SEC-EL-02).
 */
export class RecorderValidationError extends DatabaseError {}

/**
 * Thrown when a recording operation targets an id that is not a live recording
 * in the store's own profile — unknown, soft-deleted, or owned by another
 * profile. A MARKER reaches its recording through the row it names and never
 * through a `profile_id` of its own (migration 077), so every marker operation
 * surfaces the same error when the recording it names is missing, deleted or
 * another profile's.
 */
export class RecorderNotFoundError extends DatabaseError {}

/**
 * Thrown when a USER FOOD write is rejected at the store boundary (FIT slice a,
 * migration 057): an empty or over-long `name`, a `category` outside
 * `FOOD_CATEGORIES`, a nutrient that is not a finite non-negative number, a
 * serving with a blank label or a non-positive gram weight, over-long `notes`.
 *
 * The catalogue's own sanity gates (`validateFoodEntry`) are deliberately NOT
 * applied here — see `FitFoodStore` for why a user copying a number off a packet
 * must not be refused by rules written for a curated dataset.
 */
export class FitFoodValidationError extends DatabaseError {}

/** Thrown when a user-food operation targets an id that is not a live food in the store's own profile — unknown, soft-deleted, or owned by another profile. */
export class FitFoodNotFoundError extends DatabaseError {}

/**
 * Thrown when a logged meal item is rejected at the store boundary (FIT slice a,
 * migration 057): a `slot` outside the five, a `foodRef` that is not a legal
 * reference (`parseFoodRef`), a blank `label`, a `grams` that is not strictly
 * positive, a snapshot nutrient that is not a finite non-negative number, or a
 * day/instant that is not a real date.
 */
export class FitMealValidationError extends DatabaseError {}

/** Thrown when a meal-item operation targets an id that is not a live item in the store's own profile. */
export class FitMealItemNotFoundError extends DatabaseError {}

/**
 * Thrown when a nutrition goal is rejected at the store boundary (FIT slice a,
 * migration 057): a goal that is not null and not a finite non-negative number.
 * NULL is „no goal set" and is always accepted — it is the ONLY way to say that,
 * which is why zero is never coerced into it.
 */
export class FitTargetValidationError extends DatabaseError {}

/**
 * Thrown when a canvas board write is rejected at the store boundary (CANV slice
 * a, migration 059): an empty or over-long `name`, a malformed `now` — or the two
 * worth naming out loud, a `scene` that is not a valid scene document and one
 * past `MAX_CANVAS_SCENE_LENGTH`.
 *
 * That size refusal is deliberately a NAMED error rather than a SQL CHECK: the
 * only thing that realistically reaches the ceiling is an embedded image, and the
 * user who just pasted a photograph into a diagram needs a sentence they can act
 * on rather than a constraint failure from inside a transaction.
 *
 * It is also thrown on the way OUT, when a stored scene fails to parse. That is
 * corruption rather than input — this store writes nothing but canonical
 * `serializeCanvasScene` text — and reading it back as an empty board would
 * silently replace somebody's drawing with a blank page.
 */
export class CanvasValidationError extends DatabaseError {}

/** Thrown when a board operation targets an id that is not a live board in the store's own profile — unknown, soft-deleted, or owned by another profile. */
export class CanvasBoardNotFoundError extends DatabaseError {}

/**
 * Thrown when a calculator write is rejected at the store boundary (CALC,
 * migration 079): an empty or over-long expression, a result past its own cap,
 * a malformed `now`, an export whose version this build does not know, or an
 * imported value with one bad row in it.
 *
 * Most of what it reports is `@nexus/core`'s answer rather than this store's:
 * `parseCalculatorSession` is the session's storage gate — a variable holding a
 * number instead of text, a function with no parameters, a name that is not an
 * identifier — and `CalculatorStore` renames its refusal into this, because a
 * caller that is main's IPC layer is untrusted (SEC-EL-02).
 *
 * It is also thrown on the way OUT, when a stored session no longer parses.
 * That is corruption rather than input — the store writes nothing but core's own
 * serialized form — and reading it back as an empty session would silently
 * discard somebody's variables.
 */
export class CalculatorValidationError extends DatabaseError {}

/** Thrown when a history operation names an entry that is not in the store's own profile. */
export class CalcHistoryNotFoundError extends DatabaseError {}

/**
 * Thrown when a circuit, a placed part or a wire is rejected at the store
 * boundary (ELEC, migration 067).
 *
 * Most of what it reports is `@nexus/core`'s own answer, not this store's:
 * `validateCircuitHeader`, `validatePart` and `validateWire` are the domain's
 * storage gate, and `ElectronicsStore` hands them the candidate row and
 * renames their first problem into this. So a blank name, a coordinate off
 * the working area, a rotation that is not a quarter turn, a value at or
 * below zero, a colour outside the nine jumpers and a wire from a pin to
 * itself all arrive here already named by the field at fault.
 *
 * Two refusals are the STORE's own, because a row in isolation cannot see
 * them: a wire whose ends are not live parts of that same circuit — the
 * invariant migration 067 documents as unstatable, since a CHECK cannot hold
 * a sub-query — and a malformed `now`.
 */
export class CircuitValidationError extends DatabaseError {}

/** Thrown when a circuit, part or wire operation targets an id that is not a live row reachable from the store's own profile — unknown, soft-deleted, on a soft-deleted circuit, or owned by another profile. */
export class CircuitNotFoundError extends DatabaseError {}

/**
 * Thrown when a runner-settings write breaks a rule migration 069's CHECKs
 * cannot express on their own or would leave the row in a state they forbid
 * (ADR-085 E6): a `choice` outside `@nexus/core`'s three profiles, an empty or
 * oversized `distro`, a `consentedAt` that is not an ISO-8601 date-time, a
 * choice remembered on a runner that is OFF, a distribution beside a choice
 * that is not `wsl`, and — the one the whole feature exists to make impossible
 * — **enabled with no consent on record**.
 *
 * The store revalidates because renderer input is untrusted (SEC-EL-02), even
 * though main validates the same fields at the IPC boundary and would never
 * build a command line from them: a store is never the place that assumes its
 * caller did.
 */
export class ElecSettingsValidationError extends DatabaseError {}

/**
 * Thrown when a USER exercise write is rejected at the store boundary (FIT
 * training, migration 060): an empty or over-80-character `name`, an over-80
 * `nameEn`, over-500-character `notes`, an empty `primaryMuscles` list, any
 * muscle outside `MUSCLE_GROUPS`, or an `equipment`/`pattern`/`metric` outside
 * its closed core vocabulary.
 *
 * Raised on the way IN (an untrusted caller, SEC-EL-02) and equally on the way
 * OUT, where it reports a stored `primary_muscles_json`/`secondary_muscles_json`
 * that no longer parses to an array of known muscle groups — corruption, never
 * something to coerce to `[]`, the `TaskTemplateValidationError` posture applied
 * to this module's own JSON column.
 *
 * The catalogue's own gate (`validateExerciseEntry`) is deliberately NOT applied
 * here — `FitFoodValidationError`'s reason restated: a user's own accessory
 * movement is their claim about their own exercise, not a curated dataset entry.
 */
export class FitExerciseValidationError extends DatabaseError {}

/** Thrown when an exercise operation targets an id that is not a live exercise in the store's own profile — unknown, soft-deleted, or owned by another profile. */
export class FitExerciseNotFoundError extends DatabaseError {}

/**
 * Thrown when a routine write is rejected at the store boundary (FIT training,
 * migration 060): an empty or over-80-character `name`, over-500-character
 * `notes`, more than 60 items, an item's `exerciseRef` that is not
 * `catalogue:<id>`/`user:<id>` shaped or over 200 characters, an empty or
 * over-80-character item `label`, a non-positive `targetSets`, or a
 * `targetRepsMin`/`targetRepsMax` pair that runs backwards. That last refusal is
 * named here rather than left to migration 060's own CHECK, which is the
 * backstop and not the message (ADR-081 §6).
 */
export class FitRoutineValidationError extends DatabaseError {}

/** Thrown when a routine operation targets an id that is not a live routine in the store's own profile — unknown, soft-deleted, or owned by another profile. */
export class FitRoutineNotFoundError extends DatabaseError {}

/**
 * Thrown when a workout write is rejected at the store boundary (FIT training,
 * migration 060): a malformed `day`/`now`, an `exerciseRef` that is not legally
 * shaped, a blank `label`, a `metric`/`kind` outside its closed vocabulary, an
 * empty `primaryMuscles` list or a muscle outside `MUSCLE_GROUPS`, a numeric
 * field outside its bound (a negative `weightKg`/`seconds`/`distanceM`, a
 * non-integer or negative `reps`, an `rir` outside 0-5), more than 200
 * `exerciseRefs` in one `lastPerformed` call — or one of the three session
 * refusals migration 060's `fit_workouts_profile_open` UNIQUE partial index
 * exists to make unrepresentable: `start`/`reopen` while another session is
 * already open, and `finish` on a session that is not open. The index is the
 * backstop; this is the message a raw `SQLITE_CONSTRAINT` would not have given.
 */
export class FitWorkoutValidationError extends DatabaseError {}

/** Thrown when a workout operation targets an id that is not a live workout in the store's own profile — unknown, soft-deleted, or owned by another profile. */
export class FitWorkoutNotFoundError extends DatabaseError {}

/** Thrown when a set operation targets an id that is not a row of the store's own profile — unknown, or belonging to a different profile. `fit_workout_sets` carries no soft delete (`removeSet` is a hard delete), so there is no deleted state to distinguish here. */
export class FitSetNotFoundError extends DatabaseError {}

/**
 * Thrown when a measurement write is rejected at the store boundary (FIT body,
 * migration 060), naming the failing field from `@nexus/core`'s
 * `validateBodyMeasurement` (`BodyProblem[]`) rather than the raw problem list —
 * a day that is not real or is in the future, a `weightKg` outside its bound, a
 * `bodyFatPercent`/`waterPercent` outside (0, 100), a `muscle` reading whose unit
 * is neither `percent` nor `kg` or whose value exceeds the same day's weight, or
 * a circumference outside its bound.
 */
export class FitMeasurementValidationError extends DatabaseError {}

/**
 * Thrown when a body-profile write is rejected at the store boundary (FIT body,
 * migration 060), naming the failing field from `@nexus/core`'s
 * `validateBodyProfile`: a `sex` outside `BODY_SEXES` (and not null), a
 * `birthDate` that is not real or is in the future, a `heightCm` outside its
 * bound, or an `activity` outside `ACTIVITY_LEVELS`.
 */
export class FitBodyProfileValidationError extends DatabaseError {}

/**
 * Thrown when a library write is rejected at the store boundary (LIBRARY,
 * migration 072): a `kind`/`status` outside its closed vocabulary, an empty or
 * over-long `title`/creator/tag/note, a `year` outside 1..9999, a `rating`
 * outside 1..10, a count that is not a whole number in range, progress that is
 * impossible for the item's kind or a count past its total, a bare date that is
 * no calendar day, a malformed `now`, a `wikidataId` that is not a `Q…`
 * grammar — or, on the way OUT, a stored JSON list column that no longer parses
 * to a valid creator or tag list, which is corruption rather than input to
 * coerce (`HabitStore`'s posture on its own JSON column).
 *
 * It is also the archive reader's refusal: `importData` validates the whole
 * value before it writes anything, so an unknown `version`, an unknown key, a
 * reference to a row the value does not carry, a second cover for one item and a
 * second link for one pair all arrive here — as one sentence about the value,
 * because that is what the caller handed over.
 */
export class LibraryValidationError extends DatabaseError {}

/**
 * Thrown when a library operation targets an id that is not a live row reachable
 * from the store's own profile — an unknown item, a soft-deleted item, an item
 * of another profile, or a pass, thought or collection link that does not belong
 * to the item or collection the call named. Surfacing this uniformly keeps one
 * profile's library invisible to a store scoped to another, and it is the whole
 * of the scoping for `library_passes`, `library_thoughts` and
 * `library_collection_items`, which carry no `profile_id` of their own.
 */
export class LibraryNotFoundError extends DatabaseError {}

/**
 * Thrown when a culture write is rejected at the store boundary (CULTURE,
 * migration 073): a `kind` outside `VISIT_KINDS` or `MUSIC_LOG_KINDS`, a title,
 * venue, artist or playlist name that is empty or over its bound after
 * trimming, a `date` that is not a real calendar day, a `startTime` that is not
 * a wall clock `HH:MM`, a `rating` outside 1-10, an amount that is not a
 * non-negative whole number of minor units, a currency that is not three
 * upper-case ISO-4217 letters, a price missing one of its two halves, a
 * `durationMs` that is negative or past a day, a `releaseYear` outside four
 * digits, a `mime` outside the five audio formats, a malformed
 * `fileName`/`sizeBytes`/`sha256`, or a `trackId` that is not a live track of
 * this profile.
 *
 * Also the archive reader's refusal: `importData` raises this for a value whose
 * `version` is not 1, for a row that is not shaped like this module's export,
 * and for a reference between rows that the archive cannot satisfy - all before
 * a single row is written.
 *
 * Raised on the way IN (an untrusted caller, SEC-EL-02) and equally on the way
 * OUT, where it reports a stored `rank` that is no longer a rank - corruption,
 * never something to coerce, exactly as `parseStoredSchedule` treats a damaged
 * habit schedule.
 */
export class CultureValidationError extends DatabaseError {}

/**
 * Thrown when a culture operation names a row that is not live in the store's
 * own profile - unknown, soft-deleted, or another profile's - including a photo
 * that is not on the visit it was addressed through, an item that is not in the
 * playlist it was addressed through, and a `trackId` no live track carries.
 *
 * One class for four row kinds because one store owns them all, and because the
 * caller's question is the same in every case: "is this still here, and is it
 * mine?"
 */
export class CultureNotFoundError extends DatabaseError {}

/**
 * Thrown when a vehicle, an odometer reading, a service entry, a service
 * interval, a fuel entry, a fault or a receipt is refused at the store boundary
 * (CAR stage 1, migration 074).
 *
 * Four of its refusals are the reason this class exists rather than the schema
 * alone:
 *
 * - a VIN that is not seventeen characters of the ISO 3779 alphabet (no I, O or
 *   Q). The check digit is deliberately NOT recomputed — it is a North-American
 *   rule and enforcing it would refuse every European vehicle.
 * - an odometer reading that DECREASES without the replaced-odometer override.
 *   That refusal carries the way out in its own message, because the number is
 *   legitimate and only its segment is wrong.
 * - a reading that opens a new segment while something is already dated after
 *   it, which would leave the older reading on the far side of the boundary.
 * - a model year past next year, which no clock-free CHECK can state.
 *
 * The rest is the ordinary vocabulary of a store boundary: trimmed lengths,
 * closed enums (`fuel_type`, `distance_unit`, `category`, `status`), a
 * non-negative reading, a positive quantity, a price that is a safe integer of
 * minor units with a three-letter currency beside it, a bare date, a
 * well-formed `now`, a receipt's file name/mime/size/sha, and a referenced
 * service entry that is not a live row of the same vehicle.
 *
 * It is also thrown on the way OUT of `importData`, whose whole value is
 * validated before a single row is written — including its version, its ids, its
 * cross-references and the monotone-within-a-segment rule — and on the way out
 * of no reader: this module stores nothing but what it wrote, so a stored row
 * that does not parse is corruption rather than input to coerce.
 */
export class CarValidationError extends DatabaseError {}

/**
 * Thrown when a CAR operation names an id that is not a live row reachable from
 * the store's own profile — unknown, soft-deleted (for a mutation), archived
 * where a mutation needs a current vehicle, or owned by another profile.
 *
 * One class for all seven tables, because one store owns them all and every
 * method reaches its row through the same gate: the vehicle is resolved in this
 * profile first, and each child statement is scoped through it. Surfacing them
 * uniformly keeps one profile's cars invisible to a store scoped to another, and
 * it is why a child row of another profile's vehicle can never be written —
 * that is a `CarNotFoundError` about the vehicle, never a row.
 *
 * An ARCHIVED vehicle is deliberately NOT among the refusals for a read or an
 * edit (`HabitNotFoundError`'s own note): archiving a sold car is how its
 * history stays reachable, so the history must stay correctable.
 */
export class CarNotFoundError extends DatabaseError {}

/**
 * Thrown when a pantry write is rejected at the store boundary (PANTRY,
 * migration 075), naming the failing field from `@nexus/core`'s
 * `validatePantryItem`/`validatePantryLocation`/`validatePantryChange`
 * (`PantryProblem[]`) rather than the raw problem list — an empty or over-long
 * name, a category or unit outside its closed list, a negative or unbounded
 * quantity, a minimum that is not above zero, an expiry or opening date that is
 * not a real calendar day, an opening date in the future, a use-within that is
 * not a whole number of days, an over-long note, a barcode that is not 8, 12, 13
 * or 14 digits, an unbounded location id, a change of zero, or a change whose
 * sign contradicts its reason.
 *
 * It is also the error the store raises for the rules a validator cannot see: a
 * patch that tries to set `quantity` — quantity moves only through
 * `changeQuantity`, which is what writes the log — a change that would leave the
 * item below zero, a reorder whose neighbours do not describe a gap, a location
 * that still holds live items, and every refusal in `importData`.
 *
 * Raised on the way IN because renderer input is untrusted (SEC-EL-02): main
 * validates the same fields at the IPC boundary, and a store is never the place
 * that assumes its caller did.
 */
export class PantryValidationError extends DatabaseError {}

/**
 * Thrown when a pantry operation targets a row that is not there for THIS store
 * — an unknown item or location, a soft-deleted one, or a row owned by another
 * profile. Every statement in
 * `PantryStore` is scoped by `profile_id`, so another profile's pantry is not
 * merely invisible: naming it is this error.
 */
export class PantryNotFoundError extends DatabaseError {}

/**
 * Thrown when a recipe, an ingredient line or a step is rejected at the store
 * boundary (COOK, migration 076): an empty or over-long title, a `course` outside
 * the eleven, a `servings` that is not a whole number in range, a prep/cook time
 * or step timer outside its bound, more tags/ingredients/steps than the module
 * holds, a unit outside `INGREDIENT_UNITS`, a range with no lower end or one that
 * runs backwards, a `gramsPerUnit` with no `foodRef` to be the weight of, a food
 * reference that is not `catalogue:<id>`/`user:<uuid>` shaped, a photo whose
 * name/mime/size/hash is not a legal attachment index row, or a malformed `now`.
 *
 * The two refusals worth naming out loud are the licence pair: an `imported`
 * recipe without all five licence fields is refused, and an `own` recipe that
 * carries one is refused too — a recipe credited to a source it did not come from
 * is worse than one with no attribution at all, and the store does not get to
 * decide the caller meant the other value.
 *
 * It is also what `importData` throws, for a whole archive at once: an unknown
 * `version`, a field missing, a duplicated id. That import validates the entire
 * value before it writes anything is the property this class is the signal of —
 * a caller that sees it knows nothing was replaced.
 */
export class RecipeValidationError extends DatabaseError {}

/** Thrown when a recipe operation targets an id that is not a live recipe in the store's own profile — unknown, soft-deleted, or owned by another profile. */
export class RecipeNotFoundError extends DatabaseError {}

/**
 * Thrown when an emergency-card write is rejected at the store boundary
 * (EMERGENCY, migration 078): a blood type, an organ-donor answer, an allergy
 * severity or a print language outside its closed vocabulary, a `dateOfBirth`
 * that is not a real bare day or that lies in the future of the moment being
 * stamped, a free-text field past its bound, a contact that names BOTH a person
 * and its own text (or neither), a `personId`/`documentId` that does not resolve
 * to a live row of this profile, a document that is already on the card, a rank
 * past `rankBetween`'s reach, a malformed `now`, or an export value that is not
 * this module's version 1.
 *
 * It is also thrown on the way OUT, for a stored JSON list that no longer parses
 * - corruption rather than input, and never something to coerce to an empty list,
 * because an empty list means "the user says there are none" and replacing a
 * damaged one with it would invent that answer.
 *
 * The store revalidates all of it because stage 2's IPC layer hands it untrusted
 * renderer input (SEC-EL-02), exactly as every store added since `NoteStore`
 * does.
 */
export class EmergencyCardValidationError extends DatabaseError {}

/**
 * Thrown when an emergency-card operation names something this profile does not
 * have: no live card (a second `create`, an `update` or a child write with no
 * card to hang off, a `restore` of a card that was never deleted), a contact or a
 * document reference that is not a row of this profile's card, or a `move` whose
 * neighbour ids are not live siblings. One class, because the card, its contacts
 * and its document references are one aggregate - the `FitSetNotFoundError`
 * posture, one module over.
 */
export class EmergencyCardNotFoundError extends DatabaseError {}

/**
 * Thrown when an arcade score write or an arcade archive is rejected at the store
 * boundary (GAMES, migration 080): a `game` outside the closed two, a `variant`
 * that is not a lower-case board key, a `timeMs`/`score`/`lines` that is not a
 * whole number inside its bound, a malformed `now`, a won Minesweeper game with
 * no time to record — or an `importData` value that is not a version this build
 * reads, is missing a field, carries one twice, or holds a row that mixes the two
 * games' columns. The store revalidates because renderer input is untrusted
 * (SEC-EL-02), and it validates an imported archive in full before writing a row
 * because a half-applied archive is worse than a refused one.
 */
export class ArcadeValidationError extends DatabaseError {}

/**
 * Whether a driver error is a violated UNIQUE (or partial-UNIQUE) index.
 *
 * A store that leans on such an index to make a state unrepresentable — the
 * study plan's one-active-plan rule, the notification dedupe key, FIT's
 * one-open-session rule — has to translate the raw `SQLITE_CONSTRAINT_UNIQUE`
 * into a sentence, because the index is the guarantee and the store is the
 * message. This predicate had been written out three times, once per store, and
 * each copy is a chance for the next one to test a different property of the
 * same error object.
 *
 * Deliberately narrow: `SQLITE_CONSTRAINT_UNIQUE` and not the whole
 * `SQLITE_CONSTRAINT` family. A violated CHECK or foreign key is a different
 * fact and must not be reported as „that already exists".
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

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

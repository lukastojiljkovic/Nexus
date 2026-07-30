/**
 * The complete IPC contract between the Electron main process and the renderer.
 * Imported by all three sides — main (handler registration), preload
 * (contextBridge surface), and renderer (`window.nexus` typings) — so there is a
 * single source of truth for channel names and payload shapes.
 *
 * SEC-EL-02: the channel set is a fixed, minimal allowlist. There is deliberately
 * no generic "invoke any channel" passthrough, and every request payload is
 * revalidated in the main process (renderer input is untrusted).
 */

/** The only channels the preload bridge and the main handlers agree on. */
export const IpcChannel = {
  authStatus: "auth:status",
  authCreate: "auth:create",
  authUnlock: "auth:unlock",
  authRecover: "auth:recover",
  authChangePasscode: "auth:change-passcode",
  authRegenerateRecovery: "auth:regenerate-recovery",
  authLock: "auth:lock",
  profilesList: "profiles:list",
  profilesRename: "profiles:rename",
  flagsGet: "flags:get",
  flagsSet: "flags:set",
  tasksList: "tasks:list",
  tasksCreate: "tasks:create",
  tasksUpdate: "tasks:update",
  tasksSetDone: "tasks:set-done",
  tasksDelete: "tasks:delete",
  tasksRestore: "tasks:restore",
  eventsList: "events:list",
  eventsCreate: "events:create",
  eventsUpdate: "events:update",
  eventsDelete: "events:delete",
  eventsRestore: "events:restore",
  tasksCompleteOccurrence: "tasks:complete-occurrence",
  eventsAddRecurrenceExdate: "events:add-recurrence-exdate",
  eventsSplitRecurrence: "events:split-recurrence",
  peopleList: "people:list",
  peopleCreate: "people:create",
  peopleUpdate: "people:update",
  peopleDelete: "people:delete",
  peopleRestore: "people:restore",
  documentsList: "documents:list",
  documentsCreate: "documents:create",
  documentsUpdate: "documents:update",
  documentsDelete: "documents:delete",
  documentsRestore: "documents:restore",
  documentsRenew: "documents:renew",
  documentsRenewals: "documents:renewals",
  subjectsList: "subjects:list",
  subjectsCreate: "subjects:create",
  subjectsUpdate: "subjects:update",
  subjectsDelete: "subjects:delete",
  subjectsRestore: "subjects:restore",
  examsList: "exams:list",
  examsCreate: "exams:create",
  examsUpdate: "exams:update",
  examsDelete: "exams:delete",
  examsRestore: "exams:restore",
  decksList: "decks:list",
  decksCreate: "decks:create",
  decksUpdate: "decks:update",
  decksDelete: "decks:delete",
  decksRestore: "decks:restore",
  cardsListByDeck: "cards:list-by-deck",
  cardsCreate: "cards:create",
  cardsUpdate: "cards:update",
  cardsDelete: "cards:delete",
  cardsRestore: "cards:restore",
  cardsCounts: "cards:counts",
  reviewQueue: "review:queue",
  reviewGrade: "review:grade",
  reviewUndo: "review:undo",
  reviewPreview: "review:preview",
  plansList: "plans:list",
  plansCreate: "plans:create",
  plansUpdate: "plans:update",
  plansDelete: "plans:delete",
  plansRestore: "plans:restore",
  plansSyncAll: "plans:sync-all",
  blocksListByPlan: "blocks:list-by-plan",
  blocksRange: "blocks:range",
  blocksSetStatus: "blocks:set-status",
  focusStart: "focus:start",
  focusStop: "focus:stop",
  focusStatus: "focus:status",
  focusCancel: "focus:cancel",
  focusListRange: "focus:list-range",
  focusDelete: "focus:delete",
  focusRestore: "focus:restore",
  statsStudy: "stats:study",
  notificationsCenterList: "notifications:center-list",
  notificationsSnooze: "notifications:snooze",
  notificationsDismiss: "notifications:dismiss",
  notificationsSettingsGet: "notifications:settings-get",
  notificationsSettingsUpdate: "notifications:settings-update",
  notificationsSourceToggle: "notifications:source-toggle",
  notificationsChanged: "notifications:changed",
  notesList: "notes:list",
  notesCreate: "notes:create",
  notesLoad: "notes:load",
  notesAppendUpdate: "notes:append-update",
  notesDelete: "notes:delete",
  notesRestore: "notes:restore",
  noteFoldersList: "note-folders:list",
  noteFoldersCreate: "note-folders:create",
  noteFoldersUpdate: "note-folders:update",
  noteFoldersMove: "note-folders:move",
  noteFoldersDelete: "note-folders:delete",
  noteTagsList: "note-tags:list",
  noteTagsCreate: "note-tags:create",
  noteTagsRename: "note-tags:rename",
  noteTagsDelete: "note-tags:delete",
  noteTagsAttach: "note-tags:attach",
  noteTagsDetach: "note-tags:detach",
  noteTagLinksList: "note-tag-links:list",
  notesSetFolder: "notes:set-folder",
  notesSetPinned: "notes:set-pinned",
  notesSetLinks: "notes:set-links",
  notesBacklinks: "notes:backlinks",
  notesVersions: "notes:versions",
  notesVersionLoad: "notes:version-load",
  notesVersionCapture: "notes:version-capture",
  notesTemplatesList: "notes:templates-list",
  notesTemplateSave: "notes:template-save",
  notesTemplateRename: "notes:template-rename",
  notesTemplateDelete: "notes:template-delete",
  notesCardsSync: "notes:cards-sync",
  notesCardDeckSet: "notes:card-deck-set",
  noteAttachmentsList: "note-attachments:list",
  noteAttachmentsAdd: "note-attachments:add",
  noteAttachmentsRemove: "note-attachments:remove",
  noteAttachmentsOpen: "note-attachments:open",
  noteAttachmentsSaveAs: "note-attachments:save-as",
  searchQuery: "search:query",
  searchRecent: "search:recent",
  searchRebuild: "search:rebuild",
  imexExport: "imex:export",
  imexRestorePick: "imex:restore-pick",
  imexRestorePreview: "imex:restore-preview",
  imexRestoreApply: "imex:restore-apply",
  imexRestoreUndo: "imex:restore-undo",
  imexRestoreStatus: "imex:restore-status",
  imexRestoreCancel: "imex:restore-cancel",
  appInfo: "app:info",
} as const;

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel];

/**
 * The local account's session state (ADR-018): `"uninitialized"` (no account
 * yet), `"locked"` (an account exists but the database is not open), or
 * `"unlocked"`. Computed by combining what is on disk with main's own runtime
 * knowledge of whether the database is currently open — never from disk
 * alone, since "is the database open in this process" cannot be recovered
 * from a file.
 */
export type AuthState = "uninitialized" | "locked" | "unlocked";

/**
 * Why an auth call was refused. Mirrors `@nexus/core/auth`'s `AuthErrorReason`
 * exactly; redeclared here (the same pattern every other closed domain in
 * this file follows) so the renderer never imports the core auth subpath —
 * its Argon2id WASM has no business in a renderer bundle for every screen
 * that isn't the lock screen.
 */
export type AuthErrorReason =
  | "notInitialized"
  | "alreadyInitialized"
  | "wrongPasscode"
  | "wrongRecoveryCode"
  | "throttled"
  | "weakPasscode"
  | "keystoreUnavailable"
  | "otherDevice"
  | "corruptKeychain";

/**
 * Minimum passcode length (founder decision 2026-07-26, ADR-018). Mirrors
 * `@nexus/core/auth`'s `MIN_PASSCODE_LENGTH` — redeclared here, like every
 * other closed domain in this file, so the renderer can pre-check a passcode
 * without importing the core auth subpath and dragging Argon2id's WASM into
 * its bundle. `validatePasscode` in the main process stays authoritative.
 */
export const PASSCODE_MIN_LENGTH = 8;

/** The local account's status (ADR-018) — the first thing the renderer asks about, before profiles or flags. */
export interface AuthStatus {
  state: AuthState;
  /** Milliseconds still to wait before another attempt is accepted; 0 when none. */
  lockedForMs: number;
  /** False when the OS keystore is unavailable — account creation is refused rather than silently downgraded. */
  keystoreAvailable: boolean;
  /**
   * True when this data was carried over from another machine or Windows
   * account: its OS-bound guard cannot be read here, so the passcode is
   * unusable and only the Recovery Kit can open it (ADR-018 — the Kit is
   * deliberately not device-bound precisely for this). The lock screen shows
   * the recovery form instead of the passcode form.
   */
  requiresRecovery: boolean;
}

/**
 * The outcome of every auth mutation (create/unlock/recover/change-passcode/
 * regenerate-recovery): a discriminated result rather than a thrown error for
 * every EXPECTED refusal. Electron's IPC serializes a thrown `Error`'s
 * `message` only, and the renderer needs `reason` to pick its Serbian copy —
 * a raw thrown error gives it nothing to branch on. An unexpected failure (a
 * corrupt database, a filesystem error) still throws; that is the renderer's
 * generic error path, not this one.
 */
export type AuthResult =
  | { ok: true; recoveryCode?: string }
  | { ok: false; reason: AuthErrorReason; lockedForMs?: number };

export interface AuthCreateRequest {
  passcode: string;
}

export interface AuthUnlockRequest {
  passcode: string;
}

/** Recovering without setting a new passcode in the same call would lock the user out again next launch, so both arrive together. */
export interface AuthRecoverRequest {
  recoveryCode: string;
  newPasscode: string;
}

/** Re-verifies `currentPasscode` before rewrapping under `nextPasscode` — a defense against someone at an already-unlocked session changing the passcode without knowing it. */
export interface AuthChangePasscodeRequest {
  currentPasscode: string;
  nextPasscode: string;
}

/** A profile row as seen by the renderer (mirrors the `profiles` table, ADR-001). */
export interface Profile {
  id: string;
  kind: "personal" | "business";
  name: string;
  createdAt: string;
}

/**
 * Per-profile module enable/disable overrides, keyed by module id. Structurally
 * identical to `@nexus/core`'s `FlagState`; redeclared here so the wire contract
 * stays self-contained and the renderer never imports Node/DB code.
 */
export type FlagState = Record<string, boolean>;

export interface FlagsGetRequest {
  profileId: string;
}

export interface FlagsSetRequest {
  profileId: string;
  moduleId: string;
  enabled: boolean;
}

/**
 * Renames an existing profile (ONB lite: naming the first-run profile). The
 * main process re-trims and re-validates the name (1–80 chars after trimming)
 * and rejects unknown profile ids — renderer-side checks are UX only.
 */
export interface ProfilesRenameRequest {
  id: string;
  name: string;
}

/** Weekday index, 0 = Monday … 6 = Sunday — Monday-first, as everything Serbian in Nexus is. */
export type RecurrenceWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Which occurrence of a weekday inside a month; `-1` is the last one. */
export type RecurrenceOrdinal = 1 | 2 | 3 | 4 | -1;

/** How often a series fires; every `interval` is 1..99 and every period that cannot hold the pattern is skipped, never clamped (ADR-024). */
export type RecurrenceFreq =
  | { kind: "daily"; interval: number }
  | { kind: "weekdays" }
  | { kind: "weekly"; interval: number; days: RecurrenceWeekday[] }
  | { kind: "monthly-date"; interval: number; day: number }
  | { kind: "monthly-ordinal"; interval: number; ordinal: RecurrenceOrdinal; weekday: RecurrenceWeekday }
  | { kind: "yearly"; interval: number };

/** When a series stops: never, on an inclusive bare `YYYY-MM-DD` date, or after a total number of occurrences (the first one included). */
export type RecurrenceEnd =
  | { kind: "never" }
  | { kind: "until"; date: string }
  | { kind: "count"; total: number };

/**
 * The rule language shared by recurring tasks and recurring events (ADR-024).
 * Mirrors `@nexus/core`'s `RecurrenceRule` exactly. Redeclared rather than
 * imported — the same pattern `AuthErrorReason` and `RestoreProblemCode`
 * follow — because this file deliberately imports nothing. `main/index.ts`
 * assigns core's `RecurrenceRule` to this type and hands the result on to the
 * stores, which take core's, so drift in either direction is a compile error
 * rather than a wire that quietly carries a rule the engine cannot run.
 */
export interface RecurrenceRule {
  freq: RecurrenceFreq;
  end: RecurrenceEnd;
}

/** Closed task status domain (mirrors `@nexus/db`; redeclared so the renderer never imports DB code). */
export type TaskStatus = "todo" | "doing" | "done";

/** Closed task priority domain — the four levels of TASK-001. */
export type TaskPriority = "none" | "low" | "medium" | "high";

/**
 * A task as seen by the renderer (mirrors the `tasks` table via the store's
 * mapping, PRD 03). Field keys line up with a views-engine `CollectionSchema`.
 */
export interface Task {
  id: string;
  profileId: string;
  parentId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  done: boolean;
  dueDate: string | null;
  startDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** The rule this task advances by when an occurrence is completed (ADR-024), or null for a one-off. Never non-null without a bare-date `dueDate` — the date the rule phases from. */
  recurrence: RecurrenceRule | null;
  /**
   * Whole DAYS before `dueDate` at which to remind (ADR-028), ascending and
   * duplicate-free; empty for a task with no reminders. Days, not minutes like
   * an event's ladder: a task's deadline is a day, so this is the
   * document-expiry model. Never non-empty without a bare-date `dueDate` — the
   * same anchor a recurrence rule phases from.
   */
  reminderOffsets: number[];
}

/** Fields for a new task; only `title` is required (TASK-001). The main process revalidates each. */
export interface NewTaskFields {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  startDate?: string | null;
  parentId?: string | null;
  recurrence?: RecurrenceRule | null;
  /** Reminder lead times in whole DAYS before the due date (ADR-028); omitted means none. The store canonicalizes and caps them. */
  reminderOffsets?: number[];
}

/** A partial edit of a task's own fields; an omitted key is untouched, `null` clears it. */
export interface TaskFieldChanges {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  startDate?: string | null;
  recurrence?: RecurrenceRule | null;
  /** Reminder lead times in whole DAYS before the due date (ADR-028); an empty array clears every reminder. */
  reminderOffsets?: number[];
}

export interface TasksListRequest {
  profileId: string;
}

export interface TasksCreateRequest {
  profileId: string;
  task: NewTaskFields;
}

export interface TasksUpdateRequest {
  profileId: string;
  id: string;
  changes: TaskFieldChanges;
}

export interface TasksSetDoneRequest {
  profileId: string;
  id: string;
  done: boolean;
}

export interface TasksDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete (TASK-011): restores a previously deleted task. */
export interface TasksRestoreRequest {
  profileId: string;
  id: string;
}

/** "This occurrence is done" (ADR-024) — the one completion path for every task. `now` is stamped by main, never accepted from the renderer. */
export interface TasksCompleteOccurrenceRequest {
  profileId: string;
  id: string;
}

/**
 * A calendar event as seen by the renderer (mirrors the `events` table via the
 * store's mapping, PRD 04). Redeclared here so the renderer never imports DB code.
 */
export interface Event {
  id: string;
  profileId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
  /** The rule that makes this row a series master the calendar expands virtually (ADR-024), or null for a one-off. Anchored on `startAt`'s own day. */
  recurrence: RecurrenceRule | null;
  /** Bare `YYYY-MM-DD` occurrence dates removed from the series, ascending; empty whenever `recurrence` is null. Settable only through `addEventRecurrenceExdate`, never through create/update — hence its absence from the two shapes below. */
  recurrenceExdates: string[];
  /** Whole minutes before the start at which to remind, ascending and duplicate-free (CAL-006); empty for an event with no reminders. Every occurrence of a series carries the master's ladder. */
  reminderOffsets: number[];
}

/** Fields for a new event; only `title` and `startAt` are required (CAL-001). The main process revalidates each. */
export interface NewEventFields {
  title: string;
  startAt: string;
  endAt?: string | null;
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
  category?: string | null;
  recurrence?: RecurrenceRule | null;
  /** Reminder lead times in whole minutes (CAL-006); omitted means none. The store canonicalizes and caps them. */
  reminderOffsets?: number[];
}

/** A partial edit of an event's own fields; an omitted key is untouched, `null` clears it. */
export interface EventFieldChanges {
  title?: string;
  startAt?: string;
  endAt?: string | null;
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
  category?: string | null;
  recurrence?: RecurrenceRule | null;
  /** Reminder lead times in whole minutes (CAL-006); an empty array clears every reminder. */
  reminderOffsets?: number[];
}

export interface EventsListRequest {
  profileId: string;
}

export interface EventsCreateRequest {
  profileId: string;
  event: NewEventFields;
}

export interface EventsUpdateRequest {
  profileId: string;
  id: string;
  changes: EventFieldChanges;
}

export interface EventsDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted event. */
export interface EventsRestoreRequest {
  profileId: string;
  id: string;
}

/** Excepts one bare `YYYY-MM-DD` occurrence from a series (ADR-024). Idempotent; `now` is stamped by main, never accepted from the renderer. */
export interface EventsAddRecurrenceExdateRequest {
  profileId: string;
  id: string;
  date: string;
}

/** Truncates a series so its last occurrence is the day before `occurrenceDate` (ADR-024). `now` is stamped by main, never accepted from the renderer. */
export interface EventsSplitRecurrenceRequest {
  profileId: string;
  id: string;
  occurrenceDate: string;
}

/** Closed person-kind domain (mirrors `PERSON_KINDS` in `@nexus/db`; redeclared so the renderer never imports DB code). */
export type PersonKind = "birthday" | "anniversary";

/**
 * A person as seen by the renderer (mirrors the `people` table via the store's
 * mapping, CAL-007 / ADR-026). `month`/`day` are the yearless recurring fact —
 * a birthday recurs forever and has no year attached; `year` is the separately
 * known birth/start year, null when the user never supplied one. Redeclared
 * here so the renderer never imports DB code.
 */
export interface Person {
  id: string;
  profileId: string;
  name: string;
  kind: PersonKind;
  month: number;
  day: number;
  year: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new person; only `year` and `note` are optional (CAL-007). The main process revalidates each. */
export interface NewPersonFields {
  name: string;
  kind: PersonKind;
  month: number;
  day: number;
  year?: number | null;
  note?: string | null;
}

/** A partial edit of a person's own fields; an omitted key is untouched, `null` clears `year`/`note`. */
export interface PersonFieldChanges {
  name?: string;
  kind?: PersonKind;
  month?: number;
  day?: number;
  year?: number | null;
  note?: string | null;
}

export interface PeopleListRequest {
  profileId: string;
}

export interface PeopleCreateRequest {
  profileId: string;
  person: NewPersonFields;
}

export interface PeopleUpdateRequest {
  profileId: string;
  id: string;
  changes: PersonFieldChanges;
}

export interface PeopleDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted person. */
export interface PeopleRestoreRequest {
  profileId: string;
  id: string;
}

/** Closed document-type domain (mirrors `@nexus/db`; redeclared so the renderer never imports DB code). */
export type DocumentType =
  | "licna_karta"
  | "pasos"
  | "vozacka"
  | "registracija"
  | "kartica"
  | "polisa"
  | "custom";

/** Derived expiry state: on time, inside the reminder window, or already expired. */
export type DocumentStatus = "ok" | "uskoro" | "istekao";

/**
 * A tracked document as seen by the renderer (mirrors the `tracked_documents`
 * table via the store's mapping, CAL-004). `status` and `daysUntilExpiry` are
 * derived at read time. Redeclared here so the renderer never imports DB code.
 */
export interface TrackedDocument {
  id: string;
  profileId: string;
  docType: DocumentType;
  label: string;
  expiryDate: string;
  reminderOffsets: number[];
  notes: string | null;
  status: DocumentStatus;
  daysUntilExpiry: number;
  createdAt: string;
  updatedAt: string;
}

/** A single renewal record — the expiry that was replaced and when (CAL-004 history). */
export interface DocumentRenewal {
  id: string;
  documentId: string;
  previousExpiry: string;
  renewedAt: string;
}

/** Fields for a new document; `reminderOffsets` defaults from the type's ladder. The main process revalidates each. */
export interface NewDocumentFields {
  docType: DocumentType;
  label: string;
  expiryDate: string;
  reminderOffsets?: number[];
  notes?: string | null;
}

/** A partial edit of a document's own fields; an omitted key is untouched, `null` clears `notes`. */
export interface DocumentFieldChanges {
  docType?: DocumentType;
  label?: string;
  expiryDate?: string;
  reminderOffsets?: number[];
  notes?: string | null;
}

export interface DocumentsListRequest {
  profileId: string;
}

export interface DocumentsCreateRequest {
  profileId: string;
  document: NewDocumentFields;
}

export interface DocumentsUpdateRequest {
  profileId: string;
  id: string;
  changes: DocumentFieldChanges;
}

export interface DocumentsDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted document. */
export interface DocumentsRestoreRequest {
  profileId: string;
  id: string;
}

/** Moves a document's expiry forward, recording the previous expiry in history (CAL-004). */
export interface DocumentsRenewRequest {
  profileId: string;
  id: string;
  newExpiryDate: string;
}

export interface DocumentsRenewalsRequest {
  profileId: string;
  id: string;
}

/** Closed subject-colour domain (mirrors `@nexus/db`; redeclared so the renderer never imports DB code). */
export type SubjectColor = "jade" | "gold" | "bronze" | "burgundy" | "crimson" | "graphite";

/**
 * A subject as seen by the renderer (mirrors the `subjects` table via the store's
 * mapping, STUDY). `archived` subjects stay in the list. Redeclared here so the
 * renderer never imports DB code.
 */
export interface Subject {
  id: string;
  profileId: string;
  name: string;
  color: SubjectColor;
  semester: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new subject; only `name` is required, colour defaults to 'jade'. The main process revalidates each. */
export interface NewSubjectFields {
  name: string;
  color?: SubjectColor;
  semester?: string | null;
}

/** A partial edit of a subject's own fields; an omitted key is untouched, `null` clears `semester`. */
export interface SubjectFieldChanges {
  name?: string;
  color?: SubjectColor;
  semester?: string | null;
  archived?: boolean;
}

export interface SubjectsListRequest {
  profileId: string;
}

export interface SubjectsCreateRequest {
  profileId: string;
  subject: NewSubjectFields;
}

export interface SubjectsUpdateRequest {
  profileId: string;
  id: string;
  changes: SubjectFieldChanges;
}

export interface SubjectsDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted subject. */
export interface SubjectsRestoreRequest {
  profileId: string;
  id: string;
}

/** Closed exam-type domain (mirrors `@nexus/db`; redeclared so the renderer never imports DB code). */
export type ExamType = "pismeni" | "usmeni" | "kolokvijum";

/**
 * An exam as seen by the renderer (mirrors the `exams` table via the store's
 * mapping, STUDY). Its subject is carried by id. Redeclared here so the renderer
 * never imports DB code.
 */
export interface Exam {
  id: string;
  profileId: string;
  subjectId: string;
  examType: ExamType;
  examDate: string;
  scope: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new exam; `subjectId`, `examType` and `examDate` are required. The main process revalidates each. */
export interface NewExamFields {
  subjectId: string;
  examType: ExamType;
  examDate: string;
  scope?: string | null;
}

/** A partial edit of an exam's own fields; an omitted key is untouched, `null` clears `scope`. */
export interface ExamFieldChanges {
  subjectId?: string;
  examType?: ExamType;
  examDate?: string;
  scope?: string | null;
}

export interface ExamsListRequest {
  profileId: string;
}

export interface ExamsCreateRequest {
  profileId: string;
  exam: NewExamFields;
}

export interface ExamsUpdateRequest {
  profileId: string;
  id: string;
  changes: ExamFieldChanges;
}

export interface ExamsDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted exam. */
export interface ExamsRestoreRequest {
  profileId: string;
  id: string;
}

/**
 * A deck as seen by the renderer (mirrors the `decks` table via the store's
 * mapping, STUDY flashcards). Its subject is carried by id. Redeclared here so
 * the renderer never imports DB code.
 */
export interface Deck {
  id: string;
  profileId: string;
  subjectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new deck; both `subjectId` and `name` are required. The main process revalidates each. */
export interface NewDeckFields {
  subjectId: string;
  name: string;
}

/** A partial edit of a deck's own fields; an omitted key is untouched. */
export interface DeckFieldChanges {
  subjectId?: string;
  name?: string;
}

export interface DecksListRequest {
  profileId: string;
}

export interface DecksCreateRequest {
  profileId: string;
  deck: NewDeckFields;
}

export interface DecksUpdateRequest {
  profileId: string;
  id: string;
  changes: DeckFieldChanges;
}

export interface DecksDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted deck. */
export interface DecksRestoreRequest {
  profileId: string;
  id: string;
}

/**
 * Closed FSRS card-state domain (mirrors `@nexus/db`'s `CardState`, itself
 * mirroring `ts-fsrs`'s `State` enum: New, Learning, Review, Relearning).
 * Redeclared here so the renderer never imports DB code.
 */
export type CardState = 0 | 1 | 2 | 3;

/** Maximum length of a card side — `CardStore`'s own cap, mirrored on the wire. */
export const CARD_TEXT_MAX_LENGTH = 10_000;

/**
 * A flashcard as seen by the renderer (mirrors the `cards` table via the
 * store's mapping, STUDY flashcards / FSRS). `front`/`back` may contain `$…$`
 * KaTeX math, stored verbatim. Redeclared here so the renderer never imports
 * DB code.
 */
export interface Card {
  id: string;
  profileId: string;
  deckId: string;
  front: string;
  back: string;
  /**
   * The note and block this card was generated from, or both null for a
   * hand-made card (NOTE-006). A note-sourced card's text is owned by that
   * note's block — STUDY must not offer to edit it, since the next sync
   * would overwrite the edit.
   */
  sourceNoteId: string | null;
  sourceBlockKey: string | null;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: CardState;
  lastReview: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new card; `deckId`, `front` and `back` are all required. The main process revalidates each. */
export interface NewCardFields {
  deckId: string;
  front: string;
  back: string;
}

/** A partial edit of a card's own content/placement fields; never touches FSRS scheduling state. */
export interface CardFieldChanges {
  deckId?: string;
  front?: string;
  back?: string;
}

export interface CardsListByDeckRequest {
  profileId: string;
  deckId: string;
}

export interface CardsCreateRequest {
  profileId: string;
  card: NewCardFields;
}

export interface CardsUpdateRequest {
  profileId: string;
  id: string;
  changes: CardFieldChanges;
}

export interface CardsDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted card. */
export interface CardsRestoreRequest {
  profileId: string;
  id: string;
}

export interface CardsCountsRequest {
  profileId: string;
}

/** Per-deck review-queue badge counts (STUDY flashcards). */
export interface DeckCounts {
  deckId: string;
  newCount: number;
  dueCount: number;
}

/** Closed FSRS review-rating domain (Again/Hard/Good/Easy). Manual (0) is never accepted. */
export type CardRating = 1 | 2 | 3 | 4;

/** Optional scope for the review queue: at most one of `deckId`/`subjectId`, plus a cap on New cards. */
export interface ReviewQueueScope {
  deckId?: string;
  subjectId?: string;
  newLimit?: number;
}

/** The review queue: optionally scoped to one deck or one subject, plus a cap on New cards. `now` is stamped by main, never accepted from the renderer. */
export interface ReviewQueueRequest extends ReviewQueueScope {
  profileId: string;
}

/** Grades one review. `now` is stamped by main, never accepted from the renderer. */
export interface ReviewGradeRequest {
  profileId: string;
  id: string;
  rating: CardRating;
}

/** Undoes the most recent review of a card. `now` is stamped by main, never accepted from the renderer. */
export interface ReviewUndoRequest {
  profileId: string;
  id: string;
}

/** The four would-be next due dates for a card, one per rating, without persisting anything. */
export interface PreviewIntervals {
  again: string;
  hard: string;
  good: string;
  easy: string;
}

/** Previews the four would-be next due dates for a card. `now` is stamped by main, never accepted from the renderer. */
export interface ReviewPreviewRequest {
  profileId: string;
  id: string;
}

/** Closed study-block status domain (mirrors `@nexus/db`'s `StudyBlockStatus`; redeclared so the renderer never imports DB code). `missed` is only ever set by main's sync, never accepted from `setBlockStatus`. */
export type StudyBlockStatus = "planned" | "done" | "missed";

/**
 * A study plan as seen by the renderer (mirrors the `study_plans` table via the
 * store's mapping, STUDY exam planner). Its exam is carried by id. Redeclared
 * here so the renderer never imports DB code.
 */
export interface StudyPlan {
  id: string;
  profileId: string;
  examId: string;
  dailyMinutes: number;
  startDate: string;
  examWeekBoost: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new plan; all four are required. The main process revalidates each and stamps `now`/`today` itself. */
export interface NewPlanFields {
  examId: string;
  dailyMinutes: number;
  startDate: string;
  examWeekBoost: boolean;
}

/** A partial edit of a plan's own fields; an omitted key is untouched. */
export interface PlanFieldChanges {
  dailyMinutes?: number;
  startDate?: string;
  examWeekBoost?: boolean;
}

/**
 * A single generated study session as seen by the renderer (mirrors the
 * `study_blocks` table via the store's mapping). Redeclared here so the
 * renderer never imports DB code.
 */
export interface StudyBlock {
  id: string;
  planId: string;
  profileId: string;
  blockDate: string;
  minutes: number;
  status: StudyBlockStatus;
  createdAt: string;
  updatedAt: string;
}

/** A block joined with its plan's exam id — the calendar-merge read path (`listBlocksInRange`). */
export interface StudyBlockWithExam extends StudyBlock {
  examId: string;
}

export interface PlansListRequest {
  profileId: string;
}

export interface PlansCreateRequest {
  profileId: string;
  plan: NewPlanFields;
}

export interface PlansUpdateRequest {
  profileId: string;
  id: string;
  changes: PlanFieldChanges;
}

export interface PlansDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted plan. */
export interface PlansRestoreRequest {
  profileId: string;
  id: string;
}

/** Syncs every active plan of this profile whose exam is still active. `now`/`today` are stamped by main, never accepted from the renderer. */
export interface PlansSyncAllRequest {
  profileId: string;
}

export interface BlocksListByPlanRequest {
  profileId: string;
  planId: string;
}

export interface BlocksRangeRequest {
  profileId: string;
  fromDate: string;
  toDate: string;
}

export interface BlocksSetStatusRequest {
  profileId: string;
  id: string;
  status: StudyBlockStatus;
}

/**
 * A completed focus (study-timer) session as seen by the renderer (mirrors the
 * `focus_sessions` table via the store's mapping, STUDY stats). Redeclared
 * here so the renderer never imports DB code.
 */
export interface FocusSession {
  id: string;
  profileId: string;
  subjectId: string;
  startedAt: string;
  endedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The in-progress focus timer for one profile, as tracked by the main process
 * in memory only — it is never a `focus_sessions` row (see that table's doc
 * comment): a crash or app restart simply loses the running timer.
 */
export interface RunningFocusSession {
  subjectId: string;
  startedAt: string;
}

/** Starts a focus timer. `startedAt` is stamped by main, never accepted from the renderer. */
export interface FocusStartRequest {
  profileId: string;
  subjectId: string;
}

/** Stops the running focus timer, persisting it (unless it ended in the same instant it started). */
export interface FocusStopRequest {
  profileId: string;
}

export interface FocusStatusRequest {
  profileId: string;
}

/** Discards the running focus timer without saving anything. */
export interface FocusCancelRequest {
  profileId: string;
}

export interface FocusListRangeRequest {
  profileId: string;
  fromDate: string;
  toDate: string;
}

export interface FocusDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted focus session. */
export interface FocusRestoreRequest {
  profileId: string;
  id: string;
}

/**
 * The composed STUDY stats payload for one profile's date range: per-subject
 * focus minutes, the set of days with any study activity, review counts, and
 * study-block totals (STUDY stats).
 */
export interface StudyStats {
  subjectMinutes: Array<{ subjectId: string; minutes: number }>;
  activityDays: string[];
  reviews: { total: number; perDay: Array<{ day: string; count: number }> };
  blocks: { done: number; missed: number };
}

export interface StatsStudyRequest {
  profileId: string;
  fromDate: string;
  toDate: string;
}

/** The five NTF-001..003/CAL-006/ADR-028 source kinds (mirrors `@nexus/core`'s `NotificationSource`; redeclared here so the renderer never imports core/DB code). */
export type NotificationSource = "document" | "exam" | "study-day" | "event" | "task";

/** Closed ledger-status domain (mirrors `@nexus/db`'s `NotificationStatus`). Dismissal is terminal. */
export type NotificationStatus = "delivered" | "snoozed" | "dismissed";

/** The four snooze presets offered on a reminder; main resolves each to an absolute `until` from its own clock. */
export type SnoozePreset = "10m" | "1h" | "tonight" | "tomorrow-morning";

/**
 * A notification-ledger row as seen by the renderer (mirrors the
 * `notifications` table via `NotificationStore`'s mapping, NTF). Redeclared
 * here so the renderer never imports DB code.
 */
export interface NotificationRecord {
  id: string;
  profileId: string;
  source: NotificationSource;
  entityId: string;
  occurrenceKey: string;
  title: string;
  body: string;
  status: NotificationStatus;
  snoozedUntil: string | null;
  deliveredAt: string;
  createdAt: string;
  updatedAt: string;
}

/** This profile's resolved NTF preferences (mirrors `@nexus/db`'s `NotificationSettings`). */
export interface NotificationSettings {
  quietFrom: string | null;
  quietTo: string | null;
  morningHour: string;
  enabledSources: NotificationSource[];
}

/** A partial patch of NTF settings; an omitted key is left untouched, `null` clears a quiet-hours bound. */
export interface NotificationSettingsChanges {
  quietFrom?: string | null;
  quietTo?: string | null;
  morningHour?: string;
}

export interface NotificationsCenterListRequest {
  profileId: string;
}

/** Snoozes a notification until an absolute time main resolves from `preset` and its own clock — never accepted from the renderer. */
export interface NotificationsSnoozeRequest {
  profileId: string;
  id: string;
  preset: SnoozePreset;
}

export interface NotificationsDismissRequest {
  profileId: string;
  id: string;
}

export interface NotificationsSettingsGetRequest {
  profileId: string;
}

export interface NotificationsSettingsUpdateRequest {
  profileId: string;
  changes: NotificationSettingsChanges;
}

export interface NotificationsSourceToggleRequest {
  profileId: string;
  source: NotificationSource;
  enabled: boolean;
}

/**
 * Maximum size, in bytes, of a single Yjs update accepted by
 * `notes:append-update`. The renderer uses it pre-flight — a merged batch that
 * would exceed it is sent as its individual updates instead — while the main
 * process and the store re-check it authoritatively (renderer input is
 * untrusted, SEC-EL-02). MUST equal `MAX_NOTE_UPDATE_BYTES` in `@nexus/db`:
 * the same wire limit, declared on both sides so neither imports the other
 * (the renderer never pulls DB/Node code into its bundle).
 */
export const NOTE_UPDATE_MAX_BYTES = 262_144;

/**
 * Maximum number of outbound wiki-links `notes:set-links` accepts in one call.
 * MUST equal `MAX_NOTE_LINKS` in `@nexus/db`: the same wire limit, declared on
 * both sides so neither imports the other (NOTE-004).
 */
export const NOTE_LINKS_MAX_COUNT = 500;

/** Maximum number of generated flashcards `notes:cards-sync` accepts for one note. */
export const NOTE_CARDS_MAX_COUNT = 500;

/** Maximum length of a generated card's reconcile key (the block's `cardKey` plus a cloze ordinal). */
export const NOTE_CARD_KEY_MAX_LENGTH = 200;

/**
 * A note's metadata as seen by the renderer (mirrors the `notes` table via
 * `NoteStore`'s mapping, NOTE slice a1 / ADR-012). The document itself is
 * never carried here — that is `notes:load`'s payload. Redeclared here so the
 * renderer never imports DB code.
 */
export interface NoteMeta {
  id: string;
  profileId: string;
  title: string;
  folderId: string | null;
  pinned: boolean;
  /** The deck this note's generated cards go to, null until the author picks one (NOTE-006). */
  cardDeckId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One note's persisted Yjs document state (ADR-012): the merged snapshot (or
 * null before the first compaction) plus every update past it, in order. The
 * renderer replays them onto a fresh `Y.Doc` and binds the editor.
 *
 * Binary crosses this boundary as `Uint8Array` over Electron's structured
 * clone — never base64, never JSON. The renderer only ever *sends* opaque
 * update blobs (`notes:append-update`) and *receives* this payload; the
 * per-note `seq` ordering and the compaction lifecycle are owned entirely by
 * the main process and the store (SEC-EL-02) — no renderer input reaches them.
 */
export interface NoteDocPayload {
  title: string;
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
}

/**
 * One version-history checkpoint's metadata as seen by the renderer (mirrors
 * `note_versions` via `NoteStore`'s mapping, ADR-015 / NOTE-008). The
 * snapshot blob itself is `notes:version-load`'s payload, never this one —
 * `notes:versions` returns browse-list metadata only. Redeclared here so the
 * renderer never imports DB code.
 */
export interface NoteVersionMeta {
  coveredSeq: number;
  title: string;
  createdAt: string;
}

/**
 * Maximum size, in bytes, of one template's `content` that
 * `notes:template-save` accepts. MUST equal `MAX_NOTE_TEMPLATE_BYTES` in
 * `@nexus/db`: the same wire limit, declared on both sides so neither
 * imports the other. The renderer uses it pre-flight; the store re-checks
 * it authoritatively (renderer input is untrusted, SEC-EL-02).
 */
export const NOTE_TEMPLATE_MAX_BYTES = 262_144;

/**
 * A user-defined note template as seen by the renderer (mirrors the
 * `note_templates` table via `NoteTemplateStore`'s mapping, ADR-016 /
 * NOTE-009 slice 009-a). `content` is a ProseMirror document, JSON-encoded —
 * never a Yjs snapshot, since a template is never concurrently edited.
 * Redeclared here so the renderer never imports DB code.
 */
export interface NoteTemplate {
  id: string;
  profileId: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * An optional note-list filter (NOTE-002): omitted = every active note,
 * `{ folderId: null }` = unfiled notes, `{ folderId: "<id>" }` = one folder's
 * notes. Presence of the `folderId` key — not its value — distinguishes "all"
 * from "unfiled", so the wire payload either carries the key or omits it.
 */
export interface NotesListRequest {
  profileId: string;
  folderId?: string | null;
}

export interface NotesCreateRequest {
  profileId: string;
}

export interface NotesLoadRequest {
  profileId: string;
  id: string;
}

/**
 * Appends one batched Yjs update (1..256 KB, validated in main AND re-checked
 * in the store) plus the renderer-derived `title` (first non-empty line,
 * ≤ 200 chars after trimming — trust-consistent: the renderer authors the
 * content itself). `now` is stamped by main, never accepted from the renderer.
 */
export interface NotesAppendUpdateRequest {
  profileId: string;
  id: string;
  update: Uint8Array;
  title: string;
}

export interface NotesDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted note. */
export interface NotesRestoreRequest {
  profileId: string;
  id: string;
}

/** Closed note-folder colour domain (mirrors `@nexus/db`; redeclared so the renderer never imports DB code). */
export type NoteFolderColor =
  | "zlato"
  | "bronza"
  | "maslina"
  | "suma"
  | "zad"
  | "ruza"
  | "bordo"
  | "grafit";

/**
 * A note folder as seen by the renderer (mirrors the `note_folders` table via
 * `NoteOrgStore`'s mapping, NOTE-002). `parentId` is null at the tree's root.
 * Redeclared here so the renderer never imports DB code.
 */
export interface NoteFolder {
  id: string;
  profileId: string;
  parentId: string | null;
  name: string;
  color: NoteFolderColor | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A note tag as seen by the renderer (mirrors the `note_tags` table via
 * `NoteOrgStore`'s mapping, NOTE-002) — a per-profile label, unique by name.
 * Redeclared here so the renderer never imports DB code.
 */
export interface NoteTag {
  id: string;
  profileId: string;
  name: string;
  createdAt: string;
}

/** One note-tag attachment (mirrors the `note_tag_links` join table, NOTE-002). */
export interface NoteTagLink {
  noteId: string;
  tagId: string;
}

export interface NoteFoldersListRequest {
  profileId: string;
}

export interface NoteFoldersCreateRequest {
  profileId: string;
  input: { parentId: string | null; name: string; color: NoteFolderColor | null };
}

/** A partial edit of a folder's own fields; an omitted key is untouched, `null` clears `color`. */
export interface NoteFolderFieldChanges {
  name?: string;
  color?: NoteFolderColor | null;
}

export interface NoteFoldersUpdateRequest {
  profileId: string;
  id: string;
  fields: NoteFolderFieldChanges;
}

export interface NoteFoldersMoveRequest {
  profileId: string;
  id: string;
  newParentId: string | null;
}

export interface NoteFoldersDeleteRequest {
  profileId: string;
  id: string;
}

export interface NoteTagsListRequest {
  profileId: string;
}

export interface NoteTagsCreateRequest {
  profileId: string;
  name: string;
}

export interface NoteTagsRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

export interface NoteTagsDeleteRequest {
  profileId: string;
  id: string;
}

export interface NoteTagLinksListRequest {
  profileId: string;
}

export interface NoteTagsAttachRequest {
  profileId: string;
  noteId: string;
  tagId: string;
}

export interface NoteTagsDetachRequest {
  profileId: string;
  noteId: string;
  tagId: string;
}

export interface NotesSetFolderRequest {
  profileId: string;
  noteId: string;
  folderId: string | null;
}

export interface NotesSetPinnedRequest {
  profileId: string;
  noteId: string;
  pinned: boolean;
}

/**
 * Replaces a note's full outbound wiki-link set (NOTE-004). `targetIds` is
 * renderer-declared like `title` on `notes:append-update` — the renderer
 * authors its own document content — and main/the store re-validate: dropping
 * a self-link, an unknown id, or one outside this profile, and capping the
 * count at `NOTE_LINKS_MAX_COUNT` (SEC-EL-02).
 */
export interface NotesSetLinksRequest {
  profileId: string;
  id: string;
  targetIds: string[];
}

export interface NotesBacklinksRequest {
  profileId: string;
  id: string;
}

export interface NotesVersionsRequest {
  profileId: string;
  id: string;
}

export interface NotesVersionLoadRequest {
  profileId: string;
  id: string;
  coveredSeq: number;
}

/** The pre-restore safety checkpoint (ADR-015): main merges only stored state, no renderer bytes involved. */
export interface NotesVersionCaptureRequest {
  profileId: string;
  id: string;
}

export interface NotesTemplatesListRequest {
  profileId: string;
}

/**
 * Saves the open note's content as a template (ADR-016 / NOTE-009). `content`
 * is a JSON-encoded ProseMirror document the renderer authored — the same
 * trust model as `title` on `notes:append-update` — capped at
 * `NOTE_TEMPLATE_MAX_BYTES` on the wire and re-parsed by the store, which
 * requires it to be an object with `type: "doc"`. Saving under an existing
 * template's `name` replaces its content rather than adding a second row:
 * naming IS the edit mechanism, since there is no template editor.
 */
export interface NotesTemplateSaveRequest {
  profileId: string;
  name: string;
  content: string;
}

export interface NotesTemplateRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

export interface NotesTemplateDeleteRequest {
  profileId: string;
  id: string;
}

/** One generated flashcard as the editor reports it: the block's reconcile key plus the rendered sides. */
export interface NoteCardSpec {
  key: string;
  front: string;
  back: string;
}

/**
 * Syncs this note's generated flashcards (NOTE-006): like `title` on
 * `notes:append-update` and `targetIds` on `notes:set-links`, `cards` is
 * renderer-declared derived data about the note's own content — the editor's
 * current read of its `Pitanje :: Odgovor` / `{{cloze}}` blocks — and main
 * plus `CardStore` re-validate it: the note and deck must both be live and in
 * this profile, each key is capped and unique, and the whole call is rejected
 * rather than partially applied.
 */
export interface NotesCardsSyncRequest {
  profileId: string;
  id: string;
  deckId: string;
  cards: NoteCardSpec[];
}

/** Points (or unpoints, with `null`) this note's generated cards at a deck (NOTE-006). */
export interface NotesCardDeckSetRequest {
  profileId: string;
  id: string;
  deckId: string | null;
}

/**
 * Maximum size, in bytes, of one note attachment `note-attachments:add`
 * accepts. MUST equal `MAX_NOTE_ATTACHMENT_BYTES` in `@nexus/db`: the same
 * wire limit, declared on both sides so neither imports the other (ADR-014 /
 * NOTE-003).
 */
export const NOTE_ATTACHMENT_MAX_BYTES = 52_428_800;

/**
 * A note attachment's index row as seen by the renderer (mirrors the
 * `note_attachments` table via `NoteAttachmentStore`'s mapping, ADR-014 /
 * NOTE-003 slice 003-a). The attachment's bytes never cross this boundary
 * except once, at attach time (`attachNoteFile`'s `bytes` parameter) — every
 * other read/write refers to the blob only by this row's `sha256` (e.g. an
 * `nx-blob:<sha256>` URL for a future inline preview, slice 003-b).
 * Redeclared here so the renderer never imports DB code.
 */
export interface NoteAttachment {
  id: string;
  noteId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface NoteAttachmentsListRequest {
  profileId: string;
  id: string;
}

/**
 * Attaches a file to a note: the renderer sends the raw `bytes` (≤
 * `NOTE_ATTACHMENT_MAX_BYTES`) plus a display-only `fileName` — main sniffs
 * the real MIME type from the bytes themselves (SEC-FILE-02) and never trusts
 * the renderer's claim about what the file is.
 */
export interface NoteAttachmentsAddRequest {
  profileId: string;
  id: string;
  fileName: string;
  bytes: Uint8Array;
}

export interface NoteAttachmentsRemoveRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface NoteAttachmentsOpenRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface NoteAttachmentsSaveAsRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

/**
 * The outcome of a native "save attachment as" dialog (ADR-014 / NOTE-003):
 * either the user canceled, or the blob was copied to `path`. Deliberately a
 * shape of its own rather than a reuse of `ExportResult` — there is no
 * `totalRecords` concept for a single saved file, so forcing that field onto
 * this result would not fit.
 */
export type SaveAttachmentResult = { canceled: true } | { canceled: false; path: string };

/**
 * Global search (ADR-021 / PRD 08 SRCH-001/002). The index itself (migration
 * 017) and its read-only store already exist; these three channels are the
 * palette's entire main-process surface: a typed query, the recency-ordered
 * list an empty query shows, and a from-scratch repair.
 */

/** Hard cap on the raw query string the renderer may send. A palette input is a few words; anything longer is a paste, and the parser caps terms anyway. */
export const SEARCH_QUERY_MAX_BYTES = 500;
/** Hard cap on how many results one request may return. */
export const SEARCH_RESULT_MAX_LIMIT = 100;

/**
 * The kinds of entity global search indexes. MUST equal `SearchKind` in
 * `@nexus/core`: declared on both sides so neither imports the other, the same
 * rule the byte caps above follow. Unlike those, this one cannot drift
 * silently — main assigns a core `SearchKind` into `SearchResult.kind` below,
 * so a member added on one side and not the other fails to compile.
 */
export type SearchKind =
  | "task"
  | "event"
  | "note"
  | "document"
  | "subject"
  | "exam"
  | "deck"
  | "card"
  | "attachment";

/** A half-open `[start, end)` range into the string it accompanies, for highlighting the matched part. */
export type SearchHighlight = readonly [number, number];

/**
 * One displayable global-search result (ADR-021). `title`/`snippet` are the
 * ORIGINAL text with highlight ranges computed by core, never the folded
 * matching form — `titleRanges`/`snippetRanges` index into their OWN string
 * (`title`/`snippet` respectively), not into the source entity's full text.
 * `parentId` is what the deep link needs for a card's deck or an attachment's
 * note (null when the kind has none); `contextDate` is whatever date that
 * kind carries — due/start/expiry/exam date, null when the kind has none.
 */
export interface SearchResult {
  kind: SearchKind;
  entityId: string;
  parentId: string | null;
  title: string;
  titleRanges: SearchHighlight[];
  snippet: string;
  snippetRanges: SearchHighlight[];
  contextDate: string | null;
  updatedAt: string;
}

export interface SearchQueryRequest {
  profileId: string;
  query: string;
  /**
   * Required, never optional: an optional numeric field plus
   * `exactOptionalPropertyTypes` is a trap for no benefit, and the caller
   * always knows its own page size.
   */
  limit: number;
}

export interface SearchRecentRequest {
  profileId: string;
  limit: number;
}

/** `profileId` only proves the caller is in a real session — the rebuild itself is whole-file, not scoped to it (see the handler's own doc comment). */
export interface SearchRebuildRequest {
  profileId: string;
}

/**
 * `passphrase` is renderer-declared like every other explicit user choice on
 * this wire (SEC-EL-02: untrusted input, re-validated in main) — `null` is
 * the explicitly-confirmed plaintext export, a non-null string is re-checked
 * against `validateArchivePassphrase` before it ever reaches `deriveArchiveKey`.
 */
export interface ImexExportRequest {
  profileId: string;
  passphrase: string | null;
}

/**
 * The outcome of a full-data export (IMEX slice a1, PRD 14 IMEX-001, extended
 * by ADR-022): either the user canceled the native save dialog, or the
 * archive was written to `path` with `totalRecords` interchange records
 * inside it. The renderer never supplies `path` itself — it always comes back
 * from the dialog main owns (SEC-EL: untrusted input never reaches the
 * filesystem).
 *
 * `missingAttachments` (ADR-022) is non-zero when one or more NOTE attachment
 * blobs were not found in the blob store: the archive is otherwise complete,
 * just missing that many attachment files — a lost blob never fails the whole
 * export.
 *
 * `encrypted` (ADR-022) is true when the archive was sealed under a
 * passphrase-derived key — an `.nexus` `NXA1` container — and false for the
 * explicitly-confirmed plaintext `.nexus.zip`. The renderer reports honestly
 * which kind of archive it wrote, since the two need different follow-up copy
 * (`settings.backup.savedEncryptedSuffix` vs. nothing extra).
 */
export type ExportResult =
  | { canceled: true }
  | {
      canceled: false;
      path: string;
      totalRecords: number;
      missingAttachments: number;
      encrypted: boolean;
    };

/**
 * Why an archive could not be opened (IMEX slice 3c, ADR-023). Lives here
 * rather than in `main/archiveReader.ts` — the module that actually produces
 * it — because this file is the one place every wire shape is declared once;
 * `archiveReader.ts` imports it type-only and re-exports it, so its existing
 * consumers see no difference. The renderer maps these to Serbian copy; this
 * module never produces user-facing prose.
 */
export type ArchiveReadErrorCode =
  | "not-an-archive" // neither an NXA1 container nor a readable zip
  | "passphrase-required" // an NXA1 container, and no passphrase was supplied
  | "passphrase-wrong" // an NXA1 container whose frames do not authenticate under the derived key
  | "damaged" // structurally broken: truncated, corrupt central directory, duplicate entries
  | "too-large"; // a limit below was exceeded

/**
 * Mirrors `@nexus/core`'s `ImportProblemCode` exactly. Redeclared rather than
 * imported — the same pattern `AuthErrorReason` follows — because this file
 * deliberately imports nothing. `main/restore.ts` assigns a core
 * `ImportProblemCode` to this type, so a code added in core and forgotten here
 * is a compile error rather than a silent gap.
 */
export type RestoreProblemCode =
  | "missing-manifest"
  | "invalid-manifest"
  | "unsupported-schema-version"
  | "missing-data-file"
  | "checksum-mismatch"
  | "invalid-json"
  | "unknown-record-type"
  | "invalid-record"
  | "duplicate-id"
  | "unknown-reference"
  | "reference-cycle"
  | "invalid-ydoc"
  | "missing-ydoc"
  | "missing-blob";

/** One thing wrong with an archive. `detail` is a machine-ish English fragment (a field name, an id) — never a sentence for a user; the renderer owns all Serbian copy. */
export interface RestoreProblem {
  severity: "error" | "warning";
  code: RestoreProblemCode;
  path?: string;
  line?: number;
  detail?: string;
}

/** Record counts per archive module — exactly `buildExportArchive`'s own manifest grouping (`countProfileModules`, `@nexus/core`). */
export interface RestoreModuleCounts {
  tasks: number;
  calendar: number;
  study: number;
  notifications: number;
  notes: number;
}

/** The outcome of the native "pick a restore archive" dialog (IMEX slice 3c). Mirrors `SaveAttachmentResult`'s shape, plus what a restore preview needs before it can even ask for a passphrase: the file's display name and whether it is an `NXA1` container. */
export type RestorePickResult =
  | { canceled: true }
  | { canceled: false; path: string; fileName: string; encrypted: boolean };

/**
 * A dry run of a real restore, computed by actually parsing the picked
 * archive (ADR-023 section 1) — never an estimate. `current`/`incoming` are
 * the SAME module grouping (`countProfileModules`), so the confirmation
 * screen compares like with like.
 */
export interface RestorePreview {
  /** Identifies this exact parse. `applyRestore` refuses any other value, so a stale screen can never apply a preview the user did not see. */
  token: string;
  fileName: string;
  encrypted: boolean;
  /** From the archive's manifest. */
  createdAt: string;
  appVersion: string;
  sourceProfileName: string;
  /** The profile about to be overwritten, as it is right now. */
  targetProfileName: string;
  current: RestoreModuleCounts;
  incoming: RestoreModuleCounts;
  /** Warning-severity problems only (today: a `missing-blob` per attachment row whose file the archive lacks). Errors never reach a preview — they refuse it. */
  warnings: RestoreProblem[];
  /** Blobs present in the archive whose bytes did not hash to their own name: their attachment rows restore, their files do not. */
  corruptBlobs: number;
}

/**
 * `"no-file"` when nothing has been picked yet; `"unreadable"` when the
 * archive itself could not be opened (wrong/missing passphrase, damage,
 * limits); `"invalid"` when it opened but failed validation (a bad manifest,
 * a checksum mismatch, an unknown record) — every error-severity problem
 * found, never withheld; `"ready"` is the only state `applyRestore` accepts.
 */
export type RestorePreviewResult =
  | { status: "no-file" }
  | { status: "unreadable"; code: ArchiveReadErrorCode }
  | { status: "invalid"; problems: RestoreProblem[] }
  | { status: "ready"; preview: RestorePreview };

/** What a completed restore actually wrote (ADR-023 section 1: applying writes exactly what the preview showed — nothing is re-read or re-validated). */
export interface RestoreApplyResult {
  restored: RestoreModuleCounts;
  /** Every row `RestoreStore.replaceProfileData` wrote, across all tables — not just the five modules above. */
  rowsWritten: number;
  /** Attachment blobs whose bytes were new to the store. A blob already present is not counted, and is not undone. */
  blobsAdded: number;
  /** Attachment rows restored whose blob the archive did not carry (or carried corrupt): the rows exist, the files do not. */
  missingBlobs: number;
}

/** What undoing a restore actually wrote (ADR-023 section 3: undo removes only the blobs the restore itself added, and only once nothing else references them). */
export interface RestoreUndoResult {
  rowsWritten: number;
  /** Blobs the restore had added and that nothing references anymore. */
  blobsRemoved: number;
}

/** What a freshly reloaded renderer asks for, since the reload replaced the screen that would have shown the undo banner (IMEX-006). */
export interface RestoreStatus {
  undo: { appliedAt: string; summary: RestoreApplyResult } | null;
}

/**
 * Picking an archive (`imex:restore-pick`) and dropping the picked one
 * (`imex:restore-cancel`) carry no payload at all — main holds the pick, so
 * there is nothing for the renderer to name — and so declare no request shape
 * here.
 */
export interface ImexRestorePreviewRequest {
  profileId: string;
  /**
   * `null` for a plain `.nexus.zip`, which needs none. Deliberately NOT held
   * to `validateArchivePassphrase`, unlike `ImexExportRequest`'s: an EXPORT
   * passphrase is a policy decision — we refuse to WRITE a weak archive — while
   * a RESTORE passphrase is merely an attempt at a file that already exists.
   * The file on disk is the authority on what opens it, so main only bounds
   * this value's length and never policy-checks it; a wrong one simply fails
   * AEAD authentication (`deriveArchiveKey` canonicalizes through
   * `normalizeArchivePassphrase`, so form differences never matter).
   */
  passphrase: string | null;
}

/** `token` names the exact preview being confirmed — main refuses any other value, so a stale screen can never apply a parse the user did not see. */
export interface ImexRestoreApplyRequest {
  profileId: string;
  token: string;
}

export interface ImexRestoreUndoRequest {
  profileId: string;
}

export interface ImexRestoreStatusRequest {
  profileId: string;
}

/** Runtime and environment facts, proving the main-process path end to end. */
export interface AppInfo {
  name: string;
  version: string;
  userDataPath: string;
  databasePath: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
    v8: string;
  };
}

/**
 * The exact object exposed on `window.nexus`: one method per channel, nothing
 * generic. Frozen at exposure time (see preload).
 */
export interface NexusApi {
  /** ADR-018: the local account's status. The first thing the renderer asks about, before profiles or flags — there is no code path where a data channel is called before this. */
  getAuthStatus(): Promise<AuthStatus>;
  /** First run: creates the local account (encrypting an existing plaintext database in place if one predates this) and returns the one-time Recovery Kit code on success — the only time it is ever handed back. */
  createAccount(passcode: string): Promise<AuthResult>;
  /** Opens the database with the passcode-derived key, or a throttled/wrong-passcode refusal. */
  unlockWithPasscode(passcode: string): Promise<AuthResult>;
  /** Recovers from a forgotten passcode: verifies the Recovery Kit code and sets a new passcode in the same call. */
  unlockWithRecovery(recoveryCode: string, newPasscode: string): Promise<AuthResult>;
  /** Rewraps the data key under a new passcode; never re-encrypts the database, never touches the Recovery Kit already written down. */
  changePasscode(currentPasscode: string, nextPasscode: string): Promise<AuthResult>;
  /** Issues a fresh Recovery Kit code, invalidating the old one. Unlocked session only. */
  regenerateRecoveryCode(): Promise<AuthResult>;
  /** Closes the database and drops the data key from memory. */
  lock(): Promise<void>;
  listProfiles(): Promise<Profile[]>;
  renameProfile(id: string, name: string): Promise<void>;
  getFlags(profileId: string): Promise<FlagState>;
  setFlag(profileId: string, moduleId: string, enabled: boolean): Promise<void>;
  listTasks(profileId: string): Promise<Task[]>;
  createTask(profileId: string, task: NewTaskFields): Promise<Task>;
  updateTask(profileId: string, id: string, changes: TaskFieldChanges): Promise<Task>;
  setTaskDone(profileId: string, id: string, done: boolean): Promise<Task>;
  deleteTask(profileId: string, id: string): Promise<void>;
  restoreTask(profileId: string, id: string): Promise<void>;
  /**
   * "This occurrence is done" (ADR-024): a one-off completes, while a recurring
   * task advances in place to its next due date and comes back as `todo` again.
   * This is the checkbox/kanban path for EVERY task — the caller never needs to
   * know whether the task recurs, and `setTaskDone(…, true)` refuses a
   * recurring one precisely so the two paths cannot drift apart.
   */
  completeTaskOccurrence(profileId: string, id: string): Promise<Task>;
  listEvents(profileId: string): Promise<Event[]>;
  createEvent(profileId: string, event: NewEventFields): Promise<Event>;
  updateEvent(profileId: string, id: string, changes: EventFieldChanges): Promise<Event>;
  deleteEvent(profileId: string, id: string): Promise<void>;
  restoreEvent(profileId: string, id: string): Promise<void>;
  /** Removes one occurrence date from a series (ADR-024) — the "delete just this one" / "detach it into its own event" primitive. Adding a date the series already excepts changes nothing. */
  addEventRecurrenceExdate(profileId: string, id: string, date: string): Promise<Event>;
  /**
   * The "this and future occurrences" truncation (ADR-024): the master's series
   * ends the day before `occurrenceDate`, and the truncated master comes back.
   * Carrying the edited fields forward is a separate, ordinary `createEvent` —
   * so a split, a "delete from here on", and a "change the rule from here on"
   * are all this one call plus whatever the caller does next.
   */
  splitEventRecurrence(profileId: string, id: string, occurrenceDate: string): Promise<Event>;
  /** This profile's people, name-ordered by SQLite's binary collation (CAL-007); the renderer re-sorts with `Intl.Collator(["sr-Latn","sr"])`. */
  listPeople(profileId: string): Promise<Person[]>;
  createPerson(profileId: string, person: NewPersonFields): Promise<Person>;
  updatePerson(profileId: string, id: string, changes: PersonFieldChanges): Promise<Person>;
  deletePerson(profileId: string, id: string): Promise<void>;
  restorePerson(profileId: string, id: string): Promise<void>;
  listDocuments(profileId: string): Promise<TrackedDocument[]>;
  createDocument(profileId: string, doc: NewDocumentFields): Promise<TrackedDocument>;
  updateDocument(
    profileId: string,
    id: string,
    changes: DocumentFieldChanges,
  ): Promise<TrackedDocument>;
  deleteDocument(profileId: string, id: string): Promise<void>;
  restoreDocument(profileId: string, id: string): Promise<void>;
  renewDocument(profileId: string, id: string, newExpiryDate: string): Promise<TrackedDocument>;
  listDocumentRenewals(profileId: string, id: string): Promise<DocumentRenewal[]>;
  listSubjects(profileId: string): Promise<Subject[]>;
  createSubject(profileId: string, subject: NewSubjectFields): Promise<Subject>;
  updateSubject(profileId: string, id: string, changes: SubjectFieldChanges): Promise<Subject>;
  deleteSubject(profileId: string, id: string): Promise<void>;
  restoreSubject(profileId: string, id: string): Promise<void>;
  listExams(profileId: string): Promise<Exam[]>;
  createExam(profileId: string, exam: NewExamFields): Promise<Exam>;
  updateExam(profileId: string, id: string, changes: ExamFieldChanges): Promise<Exam>;
  deleteExam(profileId: string, id: string): Promise<void>;
  restoreExam(profileId: string, id: string): Promise<void>;
  listDecks(profileId: string): Promise<Deck[]>;
  createDeck(profileId: string, deck: NewDeckFields): Promise<Deck>;
  updateDeck(profileId: string, id: string, changes: DeckFieldChanges): Promise<Deck>;
  deleteDeck(profileId: string, id: string): Promise<void>;
  restoreDeck(profileId: string, id: string): Promise<void>;
  listCardsByDeck(profileId: string, deckId: string): Promise<Card[]>;
  createCard(profileId: string, card: NewCardFields): Promise<Card>;
  updateCard(profileId: string, id: string, changes: CardFieldChanges): Promise<Card>;
  deleteCard(profileId: string, id: string): Promise<void>;
  restoreCard(profileId: string, id: string): Promise<void>;
  cardCounts(profileId: string): Promise<DeckCounts[]>;
  reviewQueue(profileId: string, scope?: ReviewQueueScope): Promise<Card[]>;
  gradeReview(profileId: string, id: string, rating: CardRating): Promise<Card>;
  undoReview(profileId: string, id: string): Promise<Card>;
  previewReview(profileId: string, id: string): Promise<PreviewIntervals>;
  listPlans(profileId: string): Promise<StudyPlan[]>;
  createPlan(profileId: string, plan: NewPlanFields): Promise<StudyPlan>;
  updatePlan(profileId: string, id: string, changes: PlanFieldChanges): Promise<StudyPlan>;
  deletePlan(profileId: string, id: string): Promise<void>;
  restorePlan(profileId: string, id: string): Promise<void>;
  syncAllPlans(profileId: string): Promise<number>;
  listBlocksByPlan(profileId: string, planId: string): Promise<StudyBlock[]>;
  listBlocksInRange(
    profileId: string,
    fromDate: string,
    toDate: string,
  ): Promise<StudyBlockWithExam[]>;
  setBlockStatus(profileId: string, id: string, status: StudyBlockStatus): Promise<StudyBlock>;
  startFocus(profileId: string, subjectId: string): Promise<RunningFocusSession>;
  stopFocus(profileId: string): Promise<FocusSession | null>;
  focusStatus(profileId: string): Promise<RunningFocusSession | null>;
  cancelFocus(profileId: string): Promise<void>;
  listFocusRange(profileId: string, fromDate: string, toDate: string): Promise<FocusSession[]>;
  deleteFocus(profileId: string, id: string): Promise<void>;
  restoreFocus(profileId: string, id: string): Promise<void>;
  studyStats(profileId: string, fromDate: string, toDate: string): Promise<StudyStats>;
  listCenterNotifications(profileId: string): Promise<NotificationRecord[]>;
  snoozeNotification(
    profileId: string,
    id: string,
    preset: SnoozePreset,
  ): Promise<NotificationRecord>;
  dismissNotification(profileId: string, id: string): Promise<void>;
  getNotificationSettings(profileId: string): Promise<NotificationSettings>;
  updateNotificationSettings(
    profileId: string,
    changes: NotificationSettingsChanges,
  ): Promise<NotificationSettings>;
  setNotificationSourceEnabled(
    profileId: string,
    source: NotificationSource,
    enabled: boolean,
  ): Promise<void>;
  /**
   * Subscribes to the single `notifications:changed` push event (no payload —
   * the listener re-fetches). Returns an unsubscribe function. The one
   * deliberate exception to "one method per channel": this is still exactly
   * one fixed channel, never a generic `on(channel, ...)` passthrough.
   */
  onNotificationsChanged(listener: () => void): () => void;
  listNotes(profileId: string, filter?: { folderId?: string | null }): Promise<NoteMeta[]>;
  createNote(profileId: string): Promise<NoteMeta>;
  loadNote(profileId: string, noteId: string): Promise<NoteDocPayload>;
  appendNoteUpdate(
    profileId: string,
    noteId: string,
    update: Uint8Array,
    title: string,
  ): Promise<void>;
  deleteNote(profileId: string, noteId: string): Promise<void>;
  restoreNote(profileId: string, noteId: string): Promise<void>;
  listNoteFolders(profileId: string): Promise<NoteFolder[]>;
  createNoteFolder(
    profileId: string,
    input: { parentId: string | null; name: string; color: NoteFolderColor | null },
  ): Promise<NoteFolder>;
  updateNoteFolder(
    profileId: string,
    id: string,
    fields: NoteFolderFieldChanges,
  ): Promise<void>;
  moveNoteFolder(profileId: string, id: string, newParentId: string | null): Promise<void>;
  deleteNoteFolder(profileId: string, id: string): Promise<void>;
  listNoteTags(profileId: string): Promise<NoteTag[]>;
  createNoteTag(profileId: string, name: string): Promise<NoteTag>;
  renameNoteTag(profileId: string, id: string, name: string): Promise<void>;
  deleteNoteTag(profileId: string, id: string): Promise<void>;
  listNoteTagLinks(profileId: string): Promise<NoteTagLink[]>;
  attachNoteTag(profileId: string, noteId: string, tagId: string): Promise<void>;
  detachNoteTag(profileId: string, noteId: string, tagId: string): Promise<void>;
  setNoteFolder(profileId: string, noteId: string, folderId: string | null): Promise<void>;
  setNotePinned(profileId: string, noteId: string, pinned: boolean): Promise<void>;
  setNoteLinks(profileId: string, noteId: string, targetIds: string[]): Promise<void>;
  listNoteBacklinks(profileId: string, noteId: string): Promise<NoteMeta[]>;
  /** Browse-list metadata for this note's checkpoints, newest first (ADR-015 / NOTE-008). */
  listNoteVersions(profileId: string, noteId: string): Promise<NoteVersionMeta[]>;
  /** One checkpoint's full snapshot bytes, for a read-only version preview. */
  loadNoteVersion(profileId: string, noteId: string, coveredSeq: number): Promise<Uint8Array>;
  /** The pre-restore safety checkpoint — no age gate, deduped by covered_seq. */
  captureNoteVersion(profileId: string, noteId: string): Promise<void>;
  /** This profile's user-defined templates, name-ordered (ADR-016 / NOTE-009); the renderer re-sorts with `Intl.Collator(["sr-Latn","sr"])`. */
  listNoteTemplates(profileId: string): Promise<NoteTemplate[]>;
  /** Upserts on name (ADR-016): saving under an existing template's name replaces its content, keeping the same id. */
  saveNoteTemplate(profileId: string, name: string, content: string): Promise<NoteTemplate>;
  /** Renaming to the template's own current name is a no-op; onto another template's name rejects. */
  renameNoteTemplate(profileId: string, id: string, name: string): Promise<void>;
  deleteNoteTemplate(profileId: string, id: string): Promise<void>;
  /** Syncs this note's generated flashcards: a full reconcile of its card-syntax blocks against `deckId`, keyed by each spec's `key` (NOTE-006). */
  syncNoteCards(profileId: string, noteId: string, deckId: string, cards: NoteCardSpec[]): Promise<void>;
  /** Points (or unpoints, with `null`) this note's generated cards at a deck (NOTE-006). */
  setNoteCardDeck(profileId: string, noteId: string, deckId: string | null): Promise<void>;
  listNoteAttachments(profileId: string, noteId: string): Promise<NoteAttachment[]>;
  /** Attaches a file to a note; main sniffs `bytes` for the real MIME type (SEC-FILE-02) — `fileName` is display-only. */
  attachNoteFile(
    profileId: string,
    noteId: string,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<NoteAttachment>;
  removeNoteAttachment(profileId: string, noteId: string, attachmentId: string): Promise<void>;
  /** Copies the attachment's blob to a main-owned temp file and opens it with the OS default handler. */
  openNoteAttachment(profileId: string, noteId: string, attachmentId: string): Promise<void>;
  /** Copies the attachment's blob to a path chosen via a native save dialog. Resolves after the dialog is settled — canceled or written. */
  saveNoteAttachmentAs(
    profileId: string,
    noteId: string,
    attachmentId: string,
  ): Promise<SaveAttachmentResult>;
  /** Runs the query pipeline (parse -> FTS match -> bm25 candidates -> rank), falling back to `searchRecent`'s order when the query has no matchable terms (ADR-021). */
  searchQuery(profileId: string, query: string, limit: number): Promise<SearchResult[]>;
  /** The profile's most recently touched entries, already in their final order — no ranking pass, unlike `searchQuery`. */
  searchRecent(profileId: string, limit: number): Promise<SearchResult[]>;
  /** Rebuilds the ENTIRE file's search index from scratch (corruption recovery, not a per-profile operation); returns the resulting row count. */
  rebuildSearchIndex(profileId: string): Promise<number>;
  /**
   * Full-data export (IMEX slice a1, extended by ADR-022). `passphrase` seals
   * the archive under a passphrase-derived key (an `.nexus` `NXA1`
   * container); `null` means the explicitly-confirmed plaintext `.nexus.zip`
   * export. Resolves after the native save dialog is settled — canceled or
   * written.
   */
  exportData(profileId: string, passphrase: string | null): Promise<ExportResult>;
  /** Opens the native "pick a restore archive" dialog (IMEX slice 3c, ADR-023). Main remembers the pick, which is why nothing below ever names a path. */
  pickRestoreArchive(): Promise<RestorePickResult>;
  /** Dry-runs the restore by really parsing the picked archive — never an estimate. `passphrase` is `null` for a plain `.nexus.zip`; a wrong one comes back as `{ status: "unreadable", code: "passphrase-wrong" }` rather than as a rejection. */
  previewRestore(profileId: string, passphrase: string | null): Promise<RestorePreviewResult>;
  /** Confirms the preview `token` names, replacing this profile's entire contents. The renderer is reloaded shortly AFTER this resolves, so nothing may depend on the reload having already happened. */
  applyRestore(profileId: string, token: string): Promise<RestoreApplyResult>;
  /** Puts the profile back exactly as it was before the last applied restore (ADR-023 section 3). Rejects when there is nothing to undo. */
  undoRestore(profileId: string): Promise<RestoreUndoResult>;
  /** Whether a restore is still undoable — the first thing a reloaded renderer asks, since the reload replaced the screen that would have shown the banner. */
  restoreStatus(profileId: string): Promise<RestoreStatus>;
  /** Drops the picked archive without applying it, releasing the OS file lock an opened one holds. */
  cancelRestore(): Promise<void>;
  appInfo(): Promise<AppInfo>;
}

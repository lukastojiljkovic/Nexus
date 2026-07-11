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
  imexExport: "imex:export",
  appInfo: "app:info",
} as const;

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel];

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
}

/** A partial edit of a task's own fields; an omitted key is untouched, `null` clears it. */
export interface TaskFieldChanges {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  startDate?: string | null;
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

/** The three NTF-001..003 source kinds (mirrors `@nexus/core`'s `NotificationSource`; redeclared here so the renderer never imports core/DB code). */
export type NotificationSource = "document" | "exam" | "study-day";

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

export interface ImexExportRequest {
  profileId: string;
}

/**
 * The outcome of a full-data export (IMEX slice a1, PRD 14 IMEX-001): either
 * the user canceled the native save dialog, or the `.nexus.zip` archive was
 * written to `path` with `totalRecords` interchange records inside it. The
 * renderer never supplies `path` itself — it always comes back from the
 * dialog main owns (SEC-EL: untrusted input never reaches the filesystem).
 */
export type ExportResult =
  | { canceled: true }
  | { canceled: false; path: string; totalRecords: number };

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
  listEvents(profileId: string): Promise<Event[]>;
  createEvent(profileId: string, event: NewEventFields): Promise<Event>;
  updateEvent(profileId: string, id: string, changes: EventFieldChanges): Promise<Event>;
  deleteEvent(profileId: string, id: string): Promise<void>;
  restoreEvent(profileId: string, id: string): Promise<void>;
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
  /** Full-data export to a `.nexus.zip` archive (IMEX slice a1). Resolves after the native save dialog is settled — canceled or written. */
  exportData(profileId: string): Promise<ExportResult>;
  appInfo(): Promise<AppInfo>;
}

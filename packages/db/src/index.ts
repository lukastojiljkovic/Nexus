export { NexusDatabase, openDatabase } from "./database.js";
export type { OpenDatabaseOptions } from "./database.js";

export {
  CardNotFoundError,
  CardValidationError,
  DatabaseError,
  DatabaseKeyError,
  DatabaseLockedError,
  DeckNotFoundError,
  DeckValidationError,
  DocumentNotFoundError,
  DocumentValidationError,
  EventNotFoundError,
  EventValidationError,
  ExamNotFoundError,
  ExamValidationError,
  FocusNotFoundError,
  FocusValidationError,
  NoteFolderNotFoundError,
  NoteFolderValidationError,
  NoteNotFoundError,
  NoteTagNotFoundError,
  NoteTagValidationError,
  NoteValidationError,
  NotificationNotFoundError,
  NotificationValidationError,
  PlanNotFoundError,
  PlanValidationError,
  SchemaVersionError,
  SubjectNotFoundError,
  SubjectValidationError,
  TaskNotFoundError,
  TaskValidationError,
} from "./errors.js";

export { MIGRATIONS, runMigrations } from "./migrations/migrations.js";
export type { Migration } from "./migrations/migrations.js";

export { SqliteFlagStore } from "./flags/sqliteFlagStore.js";

export { TaskStore, TASK_PRIORITIES, TASK_STATUSES } from "./tasks/taskStore.js";
export type {
  CreateTaskInput,
  Task,
  TaskPriority,
  TaskStatus,
  UpdateTaskFields,
} from "./tasks/taskStore.js";

export { EventStore } from "./events/eventStore.js";
export type { CreateEventInput, Event, UpdateEventFields } from "./events/eventStore.js";

export {
  DocumentStore,
  DOCUMENT_TYPES,
  DEFAULT_REMINDER_LADDERS,
} from "./documents/documentStore.js";
export type {
  CreateDocumentInput,
  DocumentRenewal,
  DocumentStatus,
  DocumentType,
  TrackedDocument,
  UpdateDocumentFields,
} from "./documents/documentStore.js";

export { SubjectStore, SUBJECT_COLORS } from "./study/subjectStore.js";
export type {
  CreateSubjectInput,
  Subject,
  SubjectColor,
  UpdateSubjectFields,
} from "./study/subjectStore.js";

export { ExamStore, EXAM_TYPES } from "./study/examStore.js";
export type {
  CreateExamInput,
  Exam,
  ExamType,
  UpdateExamFields,
} from "./study/examStore.js";

export { DeckStore } from "./study/deckStore.js";
export type { CreateDeckInput, Deck, UpdateDeckFields } from "./study/deckStore.js";

export { CardStore, CARD_RATINGS } from "./study/cardStore.js";
export type {
  Card,
  CardRating,
  CardState,
  CreateCardInput,
  DueQueueOptions,
  DeckCounts,
  PreviewIntervals,
  ReviewLogEntry,
  UpdateCardFields,
} from "./study/cardStore.js";

export { PlanStore, STUDY_BLOCK_STATUSES } from "./study/planStore.js";
export type {
  CreatePlanInput,
  StudyBlock,
  StudyBlockStatus,
  StudyBlockWithExam,
  StudyPlan,
  UpdatePlanFields,
} from "./study/planStore.js";

export { FocusStore } from "./study/focusStore.js";
export type { CreateFocusSessionInput, FocusSession } from "./study/focusStore.js";

export { StatsStore } from "./study/statsStore.js";
export type { BlockTotals, ReviewCounts, SubjectMinutes } from "./study/statsStore.js";

export { NotificationStore, NOTIFICATION_STATUSES } from "./notify/notificationStore.js";
export type {
  NotificationLedgerKey,
  NotificationRecord,
  NotificationSettings,
  NotificationStatus,
  RecordDeliveredInput,
  UpdateNotificationSettingsInput,
} from "./notify/notificationStore.js";

export { NoteStore, MAX_NOTE_UPDATE_BYTES } from "./notes/noteStore.js";
export type { NoteCompactionRead, NoteDoc, NoteMeta } from "./notes/noteStore.js";

export { NoteOrgStore, NOTE_FOLDER_COLORS } from "./notes/noteOrgStore.js";
export type { NoteFolder, NoteFolderColor, NoteTag, NoteTagLink } from "./notes/noteOrgStore.js";

export { uuidv7 } from "./ids.js";

export {
  NexusDatabase,
  encryptDatabaseInPlace,
  isPlaintextDatabase,
  openDatabase,
} from "./database.js";
export type { OpenDatabaseOptions } from "./database.js";

export {
  CardNotFoundError,
  CardValidationError,
  DashboardSettingsValidationError,
  DashboardWidgetNotFoundError,
  DashboardWidgetValidationError,
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
  NoteAttachmentNotFoundError,
  NoteAttachmentValidationError,
  NoteFolderNotFoundError,
  NoteFolderValidationError,
  NoteNotFoundError,
  NoteTagNotFoundError,
  NoteTagValidationError,
  NoteTemplateNotFoundError,
  NoteTemplateValidationError,
  NoteValidationError,
  NoteVersionNotFoundError,
  NotificationNotFoundError,
  NotificationValidationError,
  PersonNotFoundError,
  PersonValidationError,
  PlanNotFoundError,
  PlanValidationError,
  RestoreValidationError,
  SchemaVersionError,
  SearchValidationError,
  StudySettingsValidationError,
  SubjectNotFoundError,
  SubjectValidationError,
  TaskAttachmentNotFoundError,
  TaskAttachmentValidationError,
  TaskDependencyValidationError,
  TaskListNotFoundError,
  TaskListValidationError,
  TaskNotFoundError,
  TaskSectionNotFoundError,
  TaskTagNotFoundError,
  TaskTagValidationError,
  TaskTemplateNotFoundError,
  TaskTemplateValidationError,
  TaskValidationError,
} from "./errors.js";

export { MIGRATIONS, runMigrations } from "./migrations/migrations.js";
export type { Migration } from "./migrations/migrations.js";

export { SqliteFlagStore } from "./flags/sqliteFlagStore.js";

export {
  DashboardSettingsStore,
  DEFAULT_BACKGROUND_DIM,
  MAX_BACKGROUND_DIM,
} from "./dashboard/dashboardSettingsStore.js";
export type { DashboardSettings } from "./dashboard/dashboardSettingsStore.js";

export {
  DashboardWidgetStore,
  DASHBOARD_WIDGET_SIZES,
  DEFAULT_DASHBOARD_LAYOUT,
} from "./dashboard/dashboardWidgetStore.js";
export type {
  DashboardWidget,
  DashboardWidgetInstance,
  DashboardWidgetSize,
} from "./dashboard/dashboardWidgetStore.js";

export {
  TaskStore,
  MAX_TASK_BULK_IDS,
  MAX_TASK_REMINDERS,
  MAX_TASK_REMINDER_DAYS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "./tasks/taskStore.js";
export type {
  CreateTaskInput,
  Task,
  TaskPriority,
  TaskStatus,
  UpdateTaskFields,
} from "./tasks/taskStore.js";

export {
  TaskListStore,
  MAX_TASK_LIST_NAME_LENGTH,
  TASK_LIST_VIEWS,
  TASK_ORDER_GAP,
  placeBetween,
  positionBetween,
} from "./tasks/taskListStore.js";
export type {
  CreateTaskListInput,
  DeleteListMode,
  TaskList,
  TaskListView,
  TaskSection,
} from "./tasks/taskListStore.js";

export { TaskTagStore, MAX_TASK_TAG_NAME_LENGTH } from "./tasks/taskTagStore.js";
export type { TaskTag, TaskTagLink } from "./tasks/taskTagStore.js";

export { TaskAttachmentStore, MAX_TASK_ATTACHMENT_BYTES } from "./tasks/taskAttachmentStore.js";
export type {
  AddTaskAttachmentInput,
  TaskAttachment,
  TaskAttachmentCount,
} from "./tasks/taskAttachmentStore.js";

export {
  TaskTemplateStore,
  MAX_TASK_TEMPLATE_DUE_OFFSET_DAYS,
  MAX_TASK_TEMPLATE_NAME_LENGTH,
  MAX_TASK_TEMPLATE_SUBTASKS,
  MAX_TASK_TEMPLATE_TAGS,
} from "./tasks/taskTemplateStore.js";
export type { TaskTemplate, TaskTemplatePayload } from "./tasks/taskTemplateStore.js";
export { TaskDependencyStore } from "./tasks/taskDependencyStore.js";
export type { TaskDependencyLink } from "./tasks/taskDependencyStore.js";

export {
  EventStore,
  MAX_EVENT_REMINDERS,
  MAX_EVENT_REMINDER_MINUTES,
} from "./events/eventStore.js";
export type { CreateEventInput, Event, UpdateEventFields } from "./events/eventStore.js";

export { PeopleStore, PERSON_KINDS } from "./people/peopleStore.js";
export type {
  CreatePersonInput,
  Person,
  PersonKind,
  UpdatePersonFields,
} from "./people/peopleStore.js";

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

export { CardStore, CARD_KINDS, CARD_RATINGS, MAX_QUEUE_DECK_IDS } from "./study/cardStore.js";
export type {
  Card,
  CardKind,
  CardRating,
  CardState,
  CreateCardInput,
  DueQueueOptions,
  DeckCounts,
  NoteCardSpecInput,
  PreviewIntervals,
  ReviewLogEntry,
  ReviewQueue,
  SyncFromNoteResult,
  UpdateCardFields,
} from "./study/cardStore.js";

export {
  StudySettingsStore,
  DEFAULT_NEW_PER_DAY,
  DEFAULT_TARGET_RETENTION,
  MAX_NEW_PER_DAY,
  MAX_REVIEWS_PER_DAY,
  MAX_TARGET_RETENTION,
  MIN_TARGET_RETENTION,
} from "./study/studySettingsStore.js";
export type { StudySettings } from "./study/studySettingsStore.js";

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

export {
  NotificationStore,
  NOTIFICATION_SOURCES,
  NOTIFICATION_STATUSES,
} from "./notify/notificationStore.js";
export type {
  NotificationLedgerKey,
  NotificationRecord,
  NotificationSettings,
  NotificationStatus,
  RecordDeliveredInput,
  UpdateNotificationSettingsInput,
} from "./notify/notificationStore.js";

export {
  NoteStore,
  MAX_NOTE_UPDATE_BYTES,
  MAX_NOTE_LINKS,
  MAX_NOTE_VERSIONS,
} from "./notes/noteStore.js";
export type { NoteCompactionRead, NoteDoc, NoteMeta, NoteVersionMeta } from "./notes/noteStore.js";

export { NoteOrgStore, NOTE_FOLDER_COLORS } from "./notes/noteOrgStore.js";
export type { NoteFolder, NoteFolderColor, NoteTag, NoteTagLink } from "./notes/noteOrgStore.js";

export { NoteAttachmentStore, MAX_NOTE_ATTACHMENT_BYTES } from "./notes/noteAttachmentStore.js";
export type { AddNoteAttachmentInput, NoteAttachment } from "./notes/noteAttachmentStore.js";

export { NoteTemplateStore, MAX_NOTE_TEMPLATE_BYTES } from "./notes/noteTemplateStore.js";
export type { NoteTemplate } from "./notes/noteTemplateStore.js";

export {
  SearchStore,
  BODY_BM25_WEIGHT,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_BROWSE_LIMIT,
  MAX_SEARCH_LIMIT,
  TITLE_BM25_WEIGHT,
  rebuildSearchIndex,
} from "./search/searchStore.js";
export type { RecentOptions, SearchOptions } from "./search/searchStore.js";

export { uuidv7 } from "./ids.js";

export { RestoreStore, RESTORE_WIPE_TABLES } from "./imex/restoreStore.js";
export type { RestoreProfileInput, RestoredNoteDerived } from "./imex/restoreStore.js";

export { ForeignImportStore } from "./imex/foreignImportStore.js";

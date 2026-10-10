export {
  NexusDatabase,
  encryptDatabaseInPlace,
  isPlaintextDatabase,
  openDatabase,
  prepareConnection,
} from "./database.js";
export type { OpenDatabaseOptions } from "./database.js";

export {
  ATTACHMENT_TEXT_CANDIDATE_MIMES,
  ATTACHMENT_TEXT_MAX_CHARS,
} from "./attachmentText.js";
export type { AttachmentTextCandidate } from "./attachmentText.js";

export {
  ArcadeValidationError,
  BackupSettingsValidationError,
  CardGameValidationError,
  PrivateNoteNotFoundError,
  PrivateNoteValidationError,
  PrivateSettingsValidationError,
  AttachmentIndexValidationError,
  CalendarOverlayValidationError,
  CalendarSettingsValidationError,
  CalcHistoryNotFoundError,
  CalculatorValidationError,
  CanvasBoardNotFoundError,
  CanvasValidationError,
  CarNotFoundError,
  CarValidationError,
  CardNotFoundError,
  CardValidationError,
  ChessNotFoundError,
  ChessValidationError,
  CircuitNotFoundError,
  CircuitValidationError,
  CultureNotFoundError,
  CultureValidationError,
  DashboardSetNotFoundError,
  DashboardSetValidationError,
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
  ElecSettingsValidationError,
  EmergencyCardNotFoundError,
  EmergencyCardValidationError,
  EventNotFoundError,
  EventTemplateNotFoundError,
  EventTemplateValidationError,
  EventValidationError,
  ExamNotFoundError,
  ExamTopicNotFoundError,
  ExamTopicValidationError,
  ExamValidationError,
  FinAccountNotFoundError,
  FinAccountValidationError,
  FinBudgetNotFoundError,
  FinBudgetValidationError,
  FinCategoryNotFoundError,
  FinCategoryValidationError,
  FinRecurringNotFoundError,
  FinRecurringValidationError,
  FinTransactionNotFoundError,
  FinTransactionValidationError,
  FitBodyProfileValidationError,
  FitExerciseNotFoundError,
  FitExerciseValidationError,
  FitFoodNotFoundError,
  FitFoodValidationError,
  FitMealItemNotFoundError,
  FitMealValidationError,
  FitMeasurementValidationError,
  FitRoutineNotFoundError,
  FitRoutineValidationError,
  FitSetNotFoundError,
  FitTargetValidationError,
  FitWorkoutNotFoundError,
  FitWorkoutValidationError,
  FocusNotFoundError,
  FocusValidationError,
  HabitNotFoundError,
  HabitValidationError,
  LibraryNotFoundError,
  LibraryValidationError,
  NoteAttachmentNotFoundError,
  NoteAttachmentValidationError,
  NoteCategoryNotFoundError,
  NoteCategoryValidationError,
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
  PantryNotFoundError,
  PantryValidationError,
  PersonNotFoundError,
  PersonValidationError,
  PlanNotFoundError,
  PlanValidationError,
  ProfileAnchorDeleteError,
  ProfileLastDeleteError,
  ProfileNotFoundError,
  ProfileValidationError,
  RecipeNotFoundError,
  RecipeValidationError,
  RecorderNotFoundError,
  RecorderValidationError,
  RestoreValidationError,
  SchemaVersionError,
  SearchValidationError,
  StudySettingsValidationError,
  SubjectAttachmentNotFoundError,
  SubjectAttachmentValidationError,
  SubjectNotFoundError,
  SubjectNoteLinkValidationError,
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
  ProfileStore,
  MAX_PROFILE_NAME_LENGTH,
  PROFILE_KINDS,
} from "./profiles/profileStore.js";
export type { ProfileKind, ProfileRecord } from "./profiles/profileStore.js";

export {
  DashboardSettingsStore,
  DEFAULT_BACKGROUND_DIM,
  MAX_BACKGROUND_DIM,
} from "./dashboard/dashboardSettingsStore.js";
export type { DashboardSettings } from "./dashboard/dashboardSettingsStore.js";

export { CalendarSettingsStore } from "./calendar/calendarSettingsStore.js";
export type { CalendarSettings } from "./calendar/calendarSettingsStore.js";

export {
  CalendarOverlayStore,
  MAX_OVERLAY_RANGE_DAYS,
} from "./calendar/calendarOverlayStore.js";
export type { CalendarOverlayEvent } from "./calendar/calendarOverlayStore.js";

export {
  BackupSettingsStore,
  BACKUP_CADENCES,
  BACKUP_RUN_STATUSES,
  DEFAULT_BACKUP_KEEP_LAST,
  MAX_BACKUP_KEEP_LAST,
  MIN_BACKUP_KEEP_LAST,
} from "./backup/backupSettingsStore.js";
export type {
  BackupCadence,
  BackupRunStatus,
  BackupSettings,
} from "./backup/backupSettingsStore.js";

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
  DashboardSetStore,
  MAX_DASHBOARD_SET_NAME_LENGTH,
} from "./dashboard/dashboardSetStore.js";
export type { DashboardSet } from "./dashboard/dashboardSetStore.js";

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
  placeBetween,
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

export {
  EventTemplateStore,
  MAX_EVENT_TEMPLATE_END_MINUTES,
  MAX_EVENT_TEMPLATE_NAME_LENGTH,
  MIN_EVENT_TEMPLATE_DURATION_MINUTES,
} from "./events/eventTemplateStore.js";
export type { EventTemplate, EventTemplatePayload } from "./events/eventTemplateStore.js";

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

export {
  SubjectAttachmentStore,
  MAX_SUBJECT_ATTACHMENT_BYTES,
} from "./study/subjectAttachmentStore.js";
export type {
  AddSubjectAttachmentInput,
  SubjectAttachment,
} from "./study/subjectAttachmentStore.js";

export { SubjectNoteLinkStore } from "./study/subjectNoteLinkStore.js";
export type { LinkedNote, SubjectNoteLink } from "./study/subjectNoteLinkStore.js";

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

export { TopicStore } from "./study/topicStore.js";
export type {
  CreateExamTopicInput,
  EffectiveExamTopic,
  ExamTopicRecord,
} from "./study/topicStore.js";

export { PlanStore, STUDY_BLOCK_KINDS, STUDY_BLOCK_STATUSES } from "./study/planStore.js";
export type {
  CreatePlanInput,
  PlanHealth,
  ScopeCutProposal,
  StudyBlock,
  StudyBlockKind,
  StudyBlockStatus,
  StudyBlockWithExam,
  StudyPlan,
  UpdatePlanFields,
} from "./study/planStore.js";

// FOCUS — the ONE focus timer (migration 057). Under `focus/` rather than
// `study/`: it stopped being STUDY's the moment one timer served both modules.
export {
  FocusStore,
  MAX_FOCUS_CYCLE_INDEX,
  MAX_FOCUS_LABEL_LENGTH,
  MAX_FOCUS_PLANNED_MINUTES,
} from "./focus/focusStore.js";
export type { CreateFocusSessionInput, FocusSession } from "./focus/focusStore.js";

export { StatsStore } from "./study/statsStore.js";
export type {
  BlockTotals,
  MaturedCards,
  PlanAdherence,
  ReviewCounts,
  StudyLogDay,
  SubjectMinutes,
  SubjectStudyLog,
} from "./study/statsStore.js";

export {
  DEFAULT_SNOOZE_PRESET,
  NotificationStore,
  NOTIFICATION_SOURCES,
  NOTIFICATION_STATUSES,
  SNOOZE_PRESETS,
  TOGGLEABLE_NOTIFICATION_SOURCES,
} from "./notify/notificationStore.js";
export type {
  NotificationLedgerKey,
  NotificationRecord,
  NotificationSettings,
  NotificationStatus,
  RecordDeliveredInput,
  SnoozePreset,
  UpdateNotificationSettingsInput,
} from "./notify/notificationStore.js";

export {
  NoteStore,
  MAX_NOTE_UPDATE_BYTES,
  MAX_NOTE_LINKS,
  MAX_NOTE_VERSIONS,
} from "./notes/noteStore.js";
export type { NoteCompactionRead, NoteDoc, NoteMeta, NoteVersionMeta } from "./notes/noteStore.js";

export { NoteOrgStore, NOTE_FOLDER_COLORS, NOTE_FOLDER_VIEWS } from "./notes/noteOrgStore.js";
export type {
  NoteCategory,
  NoteFolder,
  NoteFolderColor,
  NoteFolderView,
  NoteTag,
  NoteTagLink,
} from "./notes/noteOrgStore.js";

export { NoteAttachmentStore, MAX_NOTE_ATTACHMENT_BYTES } from "./notes/noteAttachmentStore.js";
export type { AddNoteAttachmentInput, NoteAttachment } from "./notes/noteAttachmentStore.js";

export { NoteTemplateStore, MAX_NOTE_TEMPLATE_BYTES } from "./notes/noteTemplateStore.js";
export type { NoteTemplate } from "./notes/noteTemplateStore.js";

// --- DOC („Datoteke") -------------------------------------------------------
//
// A read over the three attachment tables above, owning none of them: the store
// that writes a file is still the store that removes it.

export {
  AttachmentIndexStore,
  MAX_ATTACHMENT_INDEX_ENTRIES,
  MAX_ATTACHMENT_QUERY_LENGTH,
} from "./files/attachmentIndexStore.js";
export type {
  AttachmentIndexEntry,
  AttachmentIndexFilter,
  AttachmentIndexPage,
  AttachmentOwnerKind,
} from "./files/attachmentIndexStore.js";

// --- FIN (migration 051) ----------------------------------------------------
//
// The three predicates are exported deliberately, ahead of a caller: main's IPC
// validators (SEC-EL-02) must check a currency code, an amount of minor units
// and a bare date on the way in from the renderer, and they have to check them
// by the SAME rule the stores refuse by. One definition, or the wire and the
// store quietly disagree about what money is.
export { isBareDate, isCurrencyCode, isMinorUnits } from "./finance/money.js";
export type { FinCurrencyTotal } from "./finance/money.js";

export {
  FinAccountStore,
  FIN_ACCOUNT_KINDS,
  MAX_FIN_ACCOUNT_NAME_LENGTH,
} from "./finance/accountStore.js";
export type {
  CreateFinAccountInput,
  FinAccount,
  FinAccountBalance,
  FinAccountKind,
  UpdateFinAccountFields,
} from "./finance/accountStore.js";

export {
  FinCategoryStore,
  FIN_CATEGORY_KINDS,
  MAX_FIN_CATEGORY_NAME_LENGTH,
} from "./finance/categoryStore.js";
export type {
  FinBudget,
  FinCategory,
  FinCategoryKind,
  SetFinBudgetInput,
} from "./finance/categoryStore.js";

export {
  FinTransactionStore,
  MAX_FIN_NOTE_LENGTH,
  MAX_FIN_PAYEE_LENGTH,
} from "./finance/transactionStore.js";
export type {
  CreateFinTransactionInput,
  FinCategorySpend,
  FinPeriod,
  FinTransaction,
  UpdateFinTransactionFields,
} from "./finance/transactionStore.js";

export {
  FinRecurringStore,
  MAX_FIN_RECURRING_NAME_LENGTH,
  MAX_FIN_REMINDER_DAYS,
} from "./finance/recurringStore.js";
export type {
  CreateFinRecurringInput,
  FinRecurring,
  FinRenewalWindow,
  FinUpcomingRenewal,
  UpdateFinRecurringFields,
} from "./finance/recurringStore.js";

// --- HABIT (migration 055) --------------------------------------------------
export {
  HabitStore,
  MAX_HABIT_COUNT,
  MAX_HABIT_NAME_LENGTH,
  MAX_HABIT_UNIT_LENGTH,
} from "./habits/habitStore.js";
export type {
  CreateHabitInput,
  Habit,
  HabitDayRange,
  HabitEntry,
  UpdateHabitFields,
} from "./habits/habitStore.js";

// --- FIT (nutrition, migration 057) -----------------------------------------
//
// Three stores and NO catalogue: the app-shipped food data lives as JSON in
// `@nexus/core` and is deliberately not a table (see migration 057). A meal item
// SNAPSHOTS the macros it was logged with, which is why none of these ever reads
// that data.
export {
  FitFoodStore,
  MAX_FIT_FOOD_NAME_LENGTH,
  MAX_FIT_FOOD_NOTES_LENGTH,
  MAX_FIT_FOOD_QUERY_LENGTH,
  MAX_FIT_FOOD_RESULTS,
  MAX_FIT_FOOD_SERVINGS,
  MAX_FIT_NUTRIENT,
  MAX_FIT_SERVING_GRAMS,
  MAX_FIT_SERVING_LABEL_LENGTH,
} from "./fitness/foodStore.js";
export type {
  CreateFitFoodInput,
  FitFood,
  UpdateFitFoodFields,
} from "./fitness/foodStore.js";
export {
  FitMealStore,
  MAX_MEAL_ITEM_GRAMS,
  MAX_MEAL_ITEM_LABEL_LENGTH,
  MAX_MEAL_NUTRIENT,
  MAX_MEAL_RANGE_DAYS,
  MEAL_SLOTS,
} from "./fitness/mealStore.js";
export type {
  AddMealItemInput,
  FitMealItem,
  MealDay,
  MealDayRange,
  MealDayTotals,
  MealSlot,
  UpdateMealItemFields,
} from "./fitness/mealStore.js";
export { FitTargetStore, MAX_FIT_TARGET } from "./fitness/nutritionTargetStore.js";
export type { FitTargetGoals, FitTargets } from "./fitness/nutritionTargetStore.js";

// --- FIT training & body (migration 060) ------------------------------------
//
// Five stores over the seven tables migration 060 adds. Like the nutrition
// slice above, there is no exercise-catalogue table: the app-shipped catalogue
// lives as JSON in `@nexus/core` and a logged set SNAPSHOTS the metric and
// muscles it was performed with, which is why none of these ever reads it.
export { FitBodyProfileStore } from "./fitness/bodyProfileStore.js";
export type { FitBodyProfile } from "./fitness/bodyProfileStore.js";

export { FitMeasurementStore } from "./fitness/measurementStore.js";
export type { FitMeasurement } from "./fitness/measurementStore.js";

export {
  FitExerciseStore,
  MAX_FIT_EXERCISE_NAME_EN_LENGTH,
  MAX_FIT_EXERCISE_NAME_LENGTH,
  MAX_FIT_EXERCISE_NOTES_LENGTH,
} from "./fitness/exerciseStore.js";
export type {
  CreateFitExerciseInput,
  FitExercise,
  UpdateFitExerciseFields,
} from "./fitness/exerciseStore.js";

export {
  FitRoutineStore,
  MAX_FIT_ROUTINE_ITEMS,
  MAX_FIT_ROUTINE_ITEM_LABEL_LENGTH,
  MAX_FIT_ROUTINE_NAME_LENGTH,
  MAX_FIT_ROUTINE_NOTES_LENGTH,
} from "./fitness/routineStore.js";
export type {
  CreateFitRoutineInput,
  FitRoutine,
  FitRoutineItem,
  FitRoutineItemInput,
  UpdateFitRoutineFields,
} from "./fitness/routineStore.js";

export {
  FitWorkoutStore,
  MAX_FIT_LAST_PERFORMED_REFS,
  MAX_FIT_WORKOUT_NOTES_LENGTH,
} from "./fitness/workoutStore.js";
export type {
  FitLastPerformed,
  FitWorkout,
  FitWorkoutSet,
  LogFitSetInput,
  StartFitWorkoutInput,
  UpdateFitSetFields,
  UpdateFitWorkoutFields,
} from "./fitness/workoutStore.js";

// --- CANV (canvas boards, migration 059) ------------------------------------
//
// ONE store over ONE table, and the drawing is read only when somebody asks for
// it: `listActive` never selects the scene column, which is why a board list
// costs nothing to draw.
// `resolveRefs` is the other half: what the Nexus objects pinned to a board
// currently ARE, one read per kind. A reference that answers nothing comes back
// missing rather than dropped, and a private note (migration 045) can never
// answer at all — `REF_SELECTS`' comment carries why.
export {
  CanvasStore,
  MAX_CANVAS_BOARD_NAME_LENGTH,
  MAX_CANVAS_REF_BATCH,
} from "./canvas/canvasStore.js";
export type { CanvasBoard, CanvasBoardWithScene, CanvasRefCard } from "./canvas/canvasStore.js";

// --- ELEC (circuits, migration 067) -----------------------------------------
//
// ONE store over THREE tables, because a circuit is three tables (ADR-085 §4)
// — and the two child tables reach a profile only through their circuit, so
// every read here joins for its scope rather than filtering a column that is
// deliberately not there.
//
// The COMPONENTS are not among them and never will be: the catalogue ships as
// constants in `@nexus/core`, versioned with the application, so a part row
// carries a `componentId` this store never resolves.
export { ElectronicsStore } from "./electronics/electronicsStore.js";
export type {
  NewCircuitPart,
  NewCircuitWire,
  StoredCircuit,
  StoredCircuitDetail,
  StoredCircuitPart,
  StoredCircuitWire,
  UpdateCircuitPartFields,
} from "./electronics/electronicsStore.js";

// The external runner's settings, one table over (migration 069, ADR-085 E6) —
// deliberately NOT folded into the store above: a circuit is the profile's
// content and travels in an archive, while this row is a fact about the machine
// (which toolchain exists here, and whether its owner ever agreed to have one
// run), and it is device-local for that reason.
export {
  ElecSettingsStore,
  MAX_RUNNER_DISTRO_LENGTH,
} from "./electronics/elecSettingsStore.js";
export type { ElecSettings, ElecSettingsChanges } from "./electronics/elecSettingsStore.js";

export {
  SearchStore,
  BODY_BM25_WEIGHT,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_BROWSE_LIMIT,
  MAX_SEARCH_LIMIT,
  SEARCH_SOURCE_VIEWS,
  TITLE_BM25_WEIGHT,
  rebuildSearchIndex,
} from "./search/searchStore.js";
export type { RecentOptions, SearchOptions } from "./search/searchStore.js";

export {
  MAX_SEARCH_HISTORY_ENTRIES,
  MAX_SEARCH_HISTORY_QUERY_LENGTH,
  SearchHistoryStore,
} from "./search/searchHistoryStore.js";
export type { SearchHistoryEntry } from "./search/searchHistoryStore.js";

export { MAX_PRIVATE_NOTE_VERSIONS, PrivateNoteStore } from "./priv/privateNoteStore.js";
export type { PrivateNoteMeta, PrivateNoteVersionMeta } from "./priv/privateNoteStore.js";

export {
  DEFAULT_PRIV_AUTO_LOCK_MINUTES,
  MAX_PRIV_AUTO_LOCK_MINUTES,
  MIN_PRIV_AUTO_LOCK_MINUTES,
  PrivateSettingsStore,
} from "./priv/privateSettingsStore.js";
export type {
  CreatePrivateSettingsInput,
  PrivateSettings,
  ReplacePrivateWrapsInput,
} from "./priv/privateSettingsStore.js";

export { uuidv7 } from "./ids.js";

export { RestoreStore, RESTORE_WIPE_TABLES } from "./imex/restoreStore.js";
export type {
  RestoredPrivateNote,
  RestoredPrivateNoteVersion,
  RestoredPrivateRows,
  RestoreProfileInput,
  RestoredNoteDerived,
} from "./imex/restoreStore.js";

export { ForeignImportStore } from "./imex/foreignImportStore.js";

// --- TIMERS (migration 071, ADR-090) ----------------------------------------
//
// ONE store over THREE tables, on `ElectronicsStore`'s terms: a preset, a
// running countdown and the module's one preference are one subject, and the
// module that owns them is one folder.
//
// Its two error classes live beside it rather than in `errors.ts`, and that is a
// decision rather than an oversight: `errors.ts` is the package's shared
// vocabulary with a doc comment per class, and a module built on the kit adds
// nothing there. They extend the same `DatabaseError`, so a caller that catches
// by the base class sees no difference at all.
export {
  MAX_TIMER_DURATION_SECONDS,
  MAX_TIMER_NAME_LENGTH,
  TimersNotFoundError,
  TimersStore,
  TimersValidationError,
} from "./timers/timersStore.js";
export type { TimersCountdown, TimersPreset, TimersSettings } from "./timers/timersStore.js";

export { SyncJournal } from "./sync/syncJournal.js";
export type {
  ApplyOutcome,
  ApplyRequest,
  ApplyStatus,
  OwedObject,
  SweptObject,
} from "./sync/syncJournal.js";
export { SyncAccountStore } from "./sync/syncAccount.js";
export type { SyncAccount, SyncAccountInput } from "./sync/syncAccount.js";
export { SyncProgressStore } from "./sync/syncProgress.js";
export type { QuarantinedObject } from "./sync/syncProgress.js";
export { syncStoreFor } from "./sync/syncStore.js";

// --- LIBRARY (books, films and series, migration 072) ----------------------
//
// ONE store over SIX tables, because a pass or a thought is not a thing with a
// page of its own: it is part of the work's story. Everything a renderer can
// send is revalidated here (SEC-EL-02), the collection's progress is computed on
// every read and never stored, and `exportData`/`importData` are the versioned
// value the profile archive will carry in stage 2 — see the module's own docs for
// why the six tables are not yet in `RESTORE_WIPE_TABLES`.
export { LibraryStore, MAX_LIBRARY_COVER_BYTES } from "./library/libraryStore.js";
export type {
  AddLibraryPassInput,
  AddLibraryThoughtInput,
  AdoptResult,
  CreateLibraryCollectionInput,
  CreateLibraryItemInput,
  LibraryCollectionWithProgress,
  LibraryCoverInput,
  LibraryImportCounts,
  LibraryItemWithCover,
  UpdateLibraryCollectionFields,
  UpdateLibraryItemFields,
  UpdateLibraryPassFields,
  UpdateLibraryThoughtFields,
} from "./library/libraryStore.js";

// --- CULTURE (the culture corner, migration 073) ----------------------------
//
// ONE store over six tables: visits with their photos, the listening log, the
// user's own tracks and playlists over them. The groups are read together (the
// period statistics take visits, entries and tracks at once) and they travel
// together - `exportData`/`importData` are one versioned value, which is the
// piece stage 2 plugs into the profile archive.
//
// The photos and the tracks name BLOBS but never hold them: the bytes live in
// the content-addressed store main owns (`apps/desktop/src/main/attachments.ts`,
// the same one the note, task and subject attachments use), and these rows
// carry the name, the mime, the size and the hash exactly as those three do.
export {
  CULTURE_EXPORT_VERSION,
  CultureStore,
  MAX_CULTURE_CITY_LENGTH,
  MAX_CULTURE_COMPANIONS_LENGTH,
  MAX_CULTURE_DURATION_MS,
  MAX_CULTURE_NAME_LENGTH,
  MAX_CULTURE_NOTES_LENGTH,
  MAX_CULTURE_PHOTO_BYTES,
  MAX_CULTURE_PLAYLIST_NAME_LENGTH,
  MAX_CULTURE_PLAY_COUNT,
  MAX_CULTURE_TITLE_LENGTH,
  MAX_CULTURE_TRACK_BYTES,
  MAX_CULTURE_TRACK_NUMBER,
  MAX_CULTURE_VENUE_LENGTH,
  MAX_CULTURE_YEAR,
  MIN_CULTURE_YEAR,
} from "./culture/cultureStore.js";
export type {
  CreateEntryInput,
  CreateTrackInput,
  CreateVisitInput,
  CultureDateRange,
  CultureExport,
  CultureExportEntry,
  CultureExportItem,
  CultureExportPhoto,
  CultureExportPlaylist,
  CultureExportTrack,
  CultureExportVisit,
  CultureImportSummary,
  CultureMusicEntry,
  CulturePhotoInput,
  CulturePlaylist,
  CulturePlaylistItem,
  CulturePrice,
  CultureTrack,
  CultureVisit,
  CultureVisitPhoto,
  UpdateEntryFields,
  UpdateTrackFields,
  UpdateVisitFields,
} from "./culture/cultureStore.js";

/**
 * CAR (migration 074) — vehicles and everything that hangs off one. Stage 1 is
 * the store and the logic only; the page, the IPC channels and the profile
 * archive wiring arrive with the module kit.
 */
export {
  CarStore,
  DEFAULT_DUE_SOON_DAYS,
  DEFAULT_DUE_SOON_DISTANCE,
  MAX_FAULT_FIX_NOTES_LENGTH,
  MAX_FAULT_SYMPTOM_LENGTH,
  MAX_FUEL_QUANTITY,
  MAX_DUE_SOON_DAYS,
  MAX_INTERVAL_KM,
  MAX_INTERVAL_MONTHS,
  MAX_ODOMETER_READING,
  MAX_SERVICE_ATTACHMENT_BYTES,
  MAX_SERVICE_DESCRIPTION_LENGTH,
  MAX_SERVICE_PARTS_LENGTH,
  MAX_SERVICE_WORKSHOP_LENGTH,
  MAX_VEHICLE_MAKE_LENGTH,
  MAX_VEHICLE_MODEL_LENGTH,
  MAX_VEHICLE_NAME_LENGTH,
  MAX_VEHICLE_NOTES_LENGTH,
  MAX_VEHICLE_PLATE_LENGTH,
} from "./car/carStore.js";
export type {
  AddOdometerReadingInput,
  AddServiceAttachmentInput,
  CarExport,
  CarSettings,
  CreateFaultInput,
  CreateFuelEntryInput,
  CreateServiceInput,
  CreateVehicleInput,
  Fault,
  FuelEntry,
  OdometerReading,
  ServiceAttachment,
  ServiceEntry,
  ServiceInterval,
  SetServiceIntervalInput,
  UpdateFaultFields,
  UpdateFuelEntryFields,
  UpdateServiceFields,
  UpdateVehicleFields,
  Vehicle,
} from "./car/carStore.js";

// --- PANTRY (migration 075) -------------------------------------------------
//
// THREE tables and one store, and it is the store that owns every rule a
// validator cannot see: a location id that has to resolve, a reorder that has to
// describe a gap, a quantity change that must not go below zero, and an import
// whose references must all be inside the value it came in.
//
// `exportData`/`importData` are a versioned plain JSON value rather than an
// archive record type: stage 2 is what carries it into the profile archive, and
// the version check is why an older build refuses a newer file outright instead
// of importing half of it.
export {
  DEFAULT_PANTRY_EXPIRY_WINDOW_DAYS,
  MAX_PANTRY_EXPORT_ROWS,
  MAX_PANTRY_EXPIRY_WINDOW_DAYS,
  PANTRY_EXPORT_VERSION,
  PantryStore,
  parsePantryExport,
} from "./pantry/pantryStore.js";
export type {
  AddPantryShoppingLineInput,
  CreatePantryItemInput,
  CreatePantryLocationInput,
  PantryExport,
  PantryExportItem,
  PantryExportLocation,
  PantryExportLogEntry,
  PantryItem,
  PantryLocation,
  PantryLogEntry,
  PantrySettings,
  PantryShoppingLine,
  UpdatePantryItemFields,
} from "./pantry/pantryStore.js";

// --- COOK (the cookbook, migration 076) -------------------------------------
//
// ONE store over THREE tables: a recipe, its ingredient lines and its steps. The
// two child tables reach a profile only through their recipe, so every read joins
// for its scope rather than filtering a column that is deliberately not there.
//
// A recipe's photo is the attachment INDEX row, not the bytes: the blob lives
// content-addressed on disk under main's ownership, exactly as `note_attachments`
// (migration 013) and the dashboard's background (migration 030) already work.
// `exportData`/`importData` are the module's arm of the profile archive — a
// versioned plain JSON value, validated whole before anything is written.
export {
  COOKBOOK_EXPORT_VERSION,
  MAX_INGREDIENT_GROUP_LENGTH,
  MAX_INGREDIENT_NAME_LENGTH,
  MAX_INGREDIENT_PREPARATION_LENGTH,
  MAX_INGREDIENT_QUANTITY,
  MAX_INGREDIENT_UNIT_GRAMS,
  MAX_LICENCE_ATTRIBUTION_LENGTH,
  MAX_LICENCE_TEXT_LENGTH,
  MAX_LICENCE_URL_LENGTH,
  MAX_RECIPE_CUISINE_LENGTH,
  MAX_RECIPE_DESCRIPTION_LENGTH,
  MAX_RECIPE_INGREDIENTS,
  MAX_RECIPE_NOTES_LENGTH,
  MAX_RECIPE_PHOTO_BYTES,
  MAX_RECIPE_SERVINGS,
  MAX_RECIPE_STEPS,
  MAX_RECIPE_STEP_TEXT_LENGTH,
  MAX_RECIPE_STEP_TIMER_MINUTES,
  MAX_RECIPE_TAGS,
  MAX_RECIPE_TAG_LENGTH,
  MAX_RECIPE_TIME_MINUTES,
  MAX_RECIPE_TITLE_LENGTH,
  RecipeStore,
} from "./cookbook/recipeStore.js";
export type {
  CookbookExport,
  CreateRecipeInput,
  ExportedIngredient,
  ExportedRecipe,
  ExportedStep,
  Recipe,
  RecipeIngredient,
  RecipeIngredientInput,
  RecipePhoto,
  RecipeStepInput,
  RecipeStepRow,
  UpdateRecipeFields,
} from "./cookbook/recipeStore.js";

// --- RECORDER (voice and video diary, migration 077) ------------------------
//
// ONE store over TWO tables, because a recording is a recording plus the markers
// inside it — and the markers reach a profile only through their recording, so
// every marker statement here resolves that recording first (migration 077's
// `habit_entries` arrangement).
//
// The media never enters this package: `create` takes the `sha256` main's blob
// store returned after writing the bytes, so the recorder reuses the ONE
// content-addressed store every attachment uses rather than growing a second.
// `MAX_RECORDING_BYTES` says how large the existing whole-buffer write path can
// be taken, with the measurement behind it; `exportData`/`importData` are the
// profile archive's half of the module, metadata only, for stage 2 to plug in.
export {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_DURATION_MS,
  MAX_RECORDING_LABEL_LENGTH,
  MAX_RECORDING_MARKERS,
  MAX_RECORDING_NOTES_LENGTH,
  MAX_RECORDING_TAG_LENGTH,
  MAX_RECORDING_TAGS,
  MAX_RECORDING_TITLE_LENGTH,
  MAX_RECORDING_TRANSCRIPT_LENGTH,
  RECORDER_EXPORT_VERSION,
  RecorderStore,
} from "./recorder/recorderStore.js";
export type {
  AddMarkerInput,
  CreateRecordingInput,
  ExportedRecording,
  RecorderExport,
  RecorderImportResult,
  Recording,
  RecordingMarker,
  UpdateMarkerFields,
  UpdateRecordingFields,
} from "./recorder/recorderStore.js";

// --- EMERGENCY (the emergency card, migration 078) --------------------------
//
// The card and the two ordered lists it owns, in ONE aggregate store per profile.
// `exportData`/`importData` carry the whole module as a versioned plain JSON value
// so stage 2's profile archive can plug it in without a second definition of what
// a card is.
export {
  EMERGENCY_EXPORT_VERSION,
  EmergencyCardStore,
} from "./emergency/emergencyCardStore.js";
export type {
  AddEmergencyContactInput,
  AddEmergencyDocumentInput,
  CreateEmergencyCardInput,
  EmergencyCard,
  EmergencyCardContact,
  EmergencyCardDocumentRef,
  EmergencyCardExport,
  EmergencyCardFieldsInput,
  ExportedEmergencyCard,
  ExportedEmergencyCardContact,
  ExportedEmergencyCardDocument,
  UpdateEmergencyCardFields,
  UpdateEmergencyContactFields,
  UpdateEmergencyDocumentFields,
} from "./emergency/emergencyCardStore.js";

// --- CALC (the calculator's history and session, migration 079) --------------
//
// One store over two tables, and neither of them holds an evaluated value: an
// entry is the expression that was typed and the string that was displayed, and
// the session is `@nexus/core`'s own JSON re-validated through
// `parseCalculatorSession` on the way in and on the way out. That is what keeps
// mathjs out of this package.
//
// `importData` takes a `now` beside the value, unlike the other readers here:
// every write in this package is stamped by main rather than by a clock inside
// the store (CLAUDE.md's rule), and an import writes a session row.
export {
  CALCULATOR_EXPORT_VERSION,
  CALC_HISTORY_UNPINNED_LIMIT,
  CalculatorStore,
  MAX_CALC_HISTORY_IMPORT_ENTRIES,
  MAX_CALC_HISTORY_READ,
  MAX_CALC_HISTORY_RESULT_LENGTH,
} from "./calculator/calculatorStore.js";
export type {
  AddCalcHistoryInput,
  CalcHistoryEntry,
  CalcHistoryExportEntry,
  CalculatorExport,
} from "./calculator/calculatorStore.js";

// --- GAMES (the arcade's scores, migration 080) ------------------------------
//
// ONE store over ONE table, and the row is a running total rather than a game: a
// finished game folds into (profile, game, variant) in a single transaction, so
// the two bests, the two streaks and „when" can never disagree about a game that
// happened. The variant is the BOARD — a Minesweeper preset's own name or
// `custom:CxRxM`, derived by `@nexus/core`'s `minesweeperVariant` rather than
// named by a caller — because a best time across two board shapes means nothing.
//
// `exportData`/`importData` are the profile archive's door: a versioned plain
// value in, a full validation before a single row moves, and an unknown version
// refused rather than guessed at.
export {
  ARCADE_EXPORT_VERSION,
  ARCADE_GAMES,
  ArcadeScoreStore,
  MAX_ARCADE_LINES,
  MAX_ARCADE_SCORE,
  MAX_ARCADE_TIME_MS,
  MAX_ARCADE_VARIANT_LENGTH,
} from "./games/arcade/arcadeStore.js";
export type {
  ArcadeExport,
  ArcadeExportScore,
  ArcadeGame,
  ArcadeResult,
  ArcadeScore,
} from "./games/arcade/arcadeStore.js";

// --- GAMES: cards (stage 1 — the engines' storage, migration 081) ------------
//
// Two tables and one store, keyed by (profile, game, variant) so that Klondike
// draw-one and draw-three are two records and two saved games rather than one.
//
// The validation is the ENGINE's: this store hands every move list to the same
// `replay*` fold the renderer's own moves go through, so nothing here has to know
// what a legal Spider move is. `exportData`/`importData` are the module's door
// into stage 2's profile archive, and `importData` refuses an unknown version
// before it writes anything.
export {
  CardGameStore,
  CARD_GAME_ARCHIVE_VERSION,
  MAX_CARD_GAME_ELAPSED_SECONDS,
  MAX_CARD_GAME_MOVES,
  MAX_CARD_GAME_MOVES_BYTES,
} from "./games/cards/cardGameStore.js";
export type {
  CardGameData,
  CardGameProgress,
  CardGameProgressInput,
  CardGameResultInput,
  CardGameStats,
} from "./games/cards/cardGameStore.js";

// --- CHESS (migration 082) ---------------------------------------------------
//
// Saved games, the one game in progress, and the ladder record. Deliberately NOT
// in `RESTORE_WIPE_TABLES`: that list and `@nexus/sync`'s collection map are held
// equal by `sync/collectionGuard.test.ts`, sync is on hold, and these tables carry
// no journal triggers — the pair of edits belongs together on the day sync
// resumes. `ON DELETE CASCADE` is what takes them when a profile goes, which is
// the path privacy depends on.
export {
  ChessStore,
  MAX_CHESS_LEVEL,
  MAX_CHESS_PGN_LENGTH,
  MAX_CHESS_RESUME_MOVES,
} from "./games/chess/chessStore.js";
export type {
  ChessArchive,
  ChessArchiveGame,
  ChessArchiveResume,
  ChessArchiveStats,
  ChessGameResult,
  ChessLevelStats,
  ChessOpponent,
  ResumableGame,
  SaveGameInput,
  SavedGame,
  SetResumeInput,
} from "./games/chess/chessStore.js";

// --- READER (migration 086, ADR-100) -----------------------------------------
//
// The reading positions, the bookmarks and their notes, the reading size, and
// the safety notices a profile has accepted - one store, four tables, and not a
// byte of a pack's own content: a pack belongs to no profile (ADR-091 Â§5), and
// what this module stores is what the person WROTE while reading it.
//
// Deliberately NOT in `RESTORE_WIPE_TABLES`: a kit module replaces its own rows
// inside one restore (`ModuleContext.importData`), and that list is held equal to
// `@nexus/sync`'s collection map by `sync/collectionGuard.test.ts`, which a
// module may not edit. The four names are documented in
// `imex/restoreStore.test.ts` beside the timers module's, with the same reason.
export {
  MAX_READER_ARTICLE_PATH_LENGTH,
  MAX_READER_NOTE_LENGTH,
  MAX_READER_PACK_ID_LENGTH,
  READER_DEFAULT_TEXT_SIZE,
  READER_TEXT_SIZES,
  ReaderStore,
  ReaderValidationError,
} from "./reader/readerStore.js";
export type {
  ReaderArchiveInput,
  ReaderBookmark,
  ReaderPosition,
  ReaderSettings,
  ReaderTextSize,
} from "./reader/readerStore.js";

// --- CULTURE stage 2 (migration 073's three later tables) --------------------
//
// Appended rather than folded into the CULTURE block above so the edit stays one
// mechanical block at the end of the file: the places, the programme and the
// module's one preference arrived with stage 2, and a second block over one
// module has a precedent here already (a store whose later slice added exports
// beside its own earlier ones).
export { MAX_CULTURE_LINK_LENGTH, parseCultureExportPayload } from "./culture/cultureStore.js";
export type {
  CreateCulturePlanInput,
  CreateVenueInput,
  CultureExportPlan,
  CultureExportVenue,
  CulturePlan,
  CulturePlanCompletion,
  CulturePlanKind,
  CultureSettings,
  CultureVenue,
  UpdateCulturePlanFields,
  UpdateVenueFields,
} from "./culture/cultureStore.js";

// --- COOK (the cookbook, migration 076) -------------------------------------
//
// Stage 2's additions to the cookbook's own store, added as one block at the end
// of this file rather than inside the COOK section above: several runs append to
// this index at once, and a block nobody has to thread between other lines is
// what keeps the merge mechanical. The module's archive section reads
// `parseCookbookExport` (the same validator `RecipeStore.importData` runs), and
// `foldIngredientName` is the key an ingredient link is remembered under.
export {
  DEFAULT_UNIT_SYSTEM,
  MAX_FOOD_MATCHES,
  MAX_INGREDIENT_RAW_LENGTH,
  RECIPE_UNIT_SYSTEMS,
  foldIngredientName,
  parseCookbookExport,
} from "./cookbook/recipeStore.js";
export type {
  CookbookSettings,
  FoodMatch,
  FoodMatchInput,
  RecipeUnitSystem,
} from "./cookbook/recipeStore.js";

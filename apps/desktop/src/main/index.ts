import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  mkdir as mkdirAsync,
  readdir as readdirAsync,
  readFile as readFileAsync,
  rename as renameAsync,
  stat as statAsync,
  unlink as unlinkAsync,
  writeFile as writeFileAsync,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, protocol, session } from "electron";
import type { IpcMainInvokeEvent, OpenDialogOptions } from "electron";
// `electron-updater` is deliberately NOT imported — see the disarmed
// auto-update section below for the three conditions that must hold first.
import { devServerOrigin, isRequestAllowed, shouldBlockResolver } from "./net/offline.js";
import { buildCloudEnv } from "./sync/config.js";
import { electronCloudFetch } from "./sync/electronFetch.js";
import { createSyncService, type SyncService } from "./sync/service.js";
import {
  ACTIVITY_LEVELS,
  applySearchOperators,
  ARCHIVE_MODULE_IDS,
  BODY_SEXES,
  buildSearchSnippet,
  buildSearchTagFacets,
  catalogueComponent,
  catalogueExercise,
  catalogueFood,
  CHASSIS_LENGTHS,
  CHASSIS_MASSES,
  CHASSIS_MAX_CM,
  CHASSIS_MAX_GRAMS,
  chordAccelerator,
  countSearchKinds,
  dayKeyToUtcMs,
  EXERCISE_CATALOGUE,
  EXERCISE_EQUIPMENT,
  EXERCISE_METRICS,
  exerciseRefText,
  FOCUS_PHASE_KINDS,
  foldSearchTag,
  FOOD_CATALOGUE,
  FOOD_CATEGORIES,
  foodRefText,
  generateCode,
  isChassisShape,
  isInlineImageMime,
  isMount,
  isValidDayKey,
  MAX_ARCHIVE_PASSPHRASE_LENGTH,
  MAX_CANVAS_SCENE_LENGTH,
  MAX_CIRCUIT_NAME_LENGTH,
  MAX_CIRCUIT_NOTES_LENGTH,
  MAX_CIRCUMFERENCE_CM,
  MAX_EXERCISE_REF_LENGTH,
  MAX_HEIGHT_CM,
  MAX_ID_LENGTH,
  MAX_PART_COORDINATE,
  MAX_PART_LABEL_LENGTH,
  MAX_WEIGHT_KG,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  normalizeChordKey,
  openPrivBlob,
  PART_ROTATIONS,
  parseCanvasScene,
  parseExerciseRef,
  parseFoodRef,
  parseSearchQuery,
  phaseProgress,
  rankSearchResults,
  resolveDueRange,
  resolveEnabled,
  searchExercises,
  searchFoods,
  serializeWidgetConfig,
  SET_KINDS,
  shiftDayKey,
  sniffMime,
  toFtsMatchExpression,
  TOOL_PACKS,
  validateArchivePassphrase,
  validateHabitSchedule,
  validateRecurrenceRule,
  validateTaskViewConfig,
  validateWidgetConfig,
  WIRE_COLOURS,
} from "@nexus/core";
import type {
  BodyMeasurement,
  BodyProfile,
  Chassis,
  ChassisField,
  CircuitPart,
  CircuitWire,
  ExerciseEntry,
  ExerciseMetric,
  FocusOutcome,
  FocusPhaseKind,
  FoodCategory,
  FoodEntry,
  FoodMacros,
  FoodServing,
  HabitSchedule,
  Mount,
  MuscleGroup,
  MuscleReading,
  PartRotation,
  SetKind,
  TaskViewConfig,
  WireColour,
  WireEnd,
} from "@nexus/core";
import type {
  ArchiveModuleId,
  ArchiveProfilePicture,
  ExportArchiveInput,
  NotificationSource,
  ParsedSearchQuery,
  SearchHit,
  SearchKind,
  SearchOperatorFilters,
  SearchTagMatch,
  TagFacetSource,
} from "@nexus/core";
import {
  DEFAULT_KDF_PARAMS,
  MAX_PASSCODE_LENGTH,
  blobStorageName,
  deriveBlobKeys,
  unwrapBackupPassphrase,
  wrapBackupPassphrase,
  type BlobKeys,
} from "@nexus/core/auth";
import {
  type AttachmentIndexFilter,
  AttachmentIndexStore,
  BackupSettingsStore,
  CalendarOverlayStore,
  CalendarSettingsStore,
  type CanvasBoard,
  type CanvasBoardWithScene,
  type CanvasRefCard,
  CanvasStore,
  type Card,
  CARD_RATINGS,
  type CardRating,
  CardStore,
  type CreateCardInput,
  type CreateDeckInput,
  type CreateDocumentInput,
  type CreateEventInput,
  type CreateExamInput,
  type CreateFinAccountInput,
  type CreateFinRecurringInput,
  type CreateFinTransactionInput,
  type CreateFitExerciseInput,
  type CreateFitFoodInput,
  type CreateHabitInput,
  type CreatePersonInput,
  type CreatePlanInput,
  type CreateSubjectInput,
  type CreateTaskInput,
  DashboardSetStore,
  DashboardSettingsStore,
  DashboardWidgetStore,
  DatabaseLockedError,
  type Deck,
  type DeckCounts,
  DeckStore,
  type DeleteListMode,
  DOCUMENT_TYPES,
  type DocumentRenewal,
  DocumentStore,
  type DocumentType,
  type DueQueueOptions,
  type EffectiveExamTopic,
  ElectronicsStore,
  ElecSettingsStore,
  type NewCircuitPart,
  type NewCircuitWire,
  encryptDatabaseInPlace,
  type Event,
  EventStore,
  type EventTemplate,
  EventTemplateStore,
  type Exam,
  EXAM_TYPES,
  ExamStore,
  type ExamType,
  FIN_ACCOUNT_KINDS,
  FIN_CATEGORY_KINDS,
  type FinAccount,
  type FinAccountBalance,
  type FinAccountKind,
  FinAccountStore,
  type FinBudget,
  type FinCategory,
  type FinCategoryKind,
  type FinCategorySpend,
  FinCategoryStore,
  type FinCurrencyTotal,
  type FinPeriod,
  type FinRecurring,
  FinRecurringStore,
  type FinRenewalWindow,
  type FinTransaction,
  FinTransactionStore,
  type FinUpcomingRenewal,
  FitBodyProfileStore,
  FitExerciseStore,
  type FitFood,
  FitFoodStore,
  type FitMealItem,
  FitMealStore,
  FitMeasurementStore,
  // The STORED routine, aliased apart from the wire's `FitRoutine`: the two
  // differ by exactly the two fields `toWireRoutine` resolves, and letting one
  // name mean both is how a resolve gets skipped without anything noticing.
  type FitRoutine as StoredFitRoutine,
  FitRoutineStore,
  type FitTargetGoals,
  type FitTargets,
  FitTargetStore,
  FitWorkoutStore,
  type FocusSession,
  FocusStore,
  ForeignImportStore,
  type Habit,
  type HabitDayRange,
  type HabitEntry,
  HabitStore,
  isCurrencyCode,
  isMinorUnits,
  isPlaintextDatabase,
  type LinkedNote,
  MAX_BACKUP_KEEP_LAST,
  MAX_CANVAS_BOARD_NAME_LENGTH,
  MAX_EVENT_REMINDER_MINUTES,
  MAX_EVENT_REMINDERS,
  MAX_FIT_EXERCISE_NAME_LENGTH,
  MAX_FIT_EXERCISE_NOTES_LENGTH,
  MAX_FIT_FOOD_NAME_LENGTH,
  MAX_FIT_FOOD_NOTES_LENGTH,
  MAX_FIT_FOOD_QUERY_LENGTH,
  MAX_FIT_FOOD_RESULTS,
  MAX_FIT_FOOD_SERVINGS,
  MAX_FIT_LAST_PERFORMED_REFS,
  MAX_FIT_NUTRIENT,
  MAX_FIT_ROUTINE_ITEMS,
  MAX_FIT_ROUTINE_NAME_LENGTH,
  MAX_FIT_ROUTINE_NOTES_LENGTH,
  MAX_FIT_SERVING_GRAMS,
  MAX_FIT_SERVING_LABEL_LENGTH,
  MAX_FIT_TARGET,
  MAX_FOCUS_CYCLE_INDEX,
  MAX_FOCUS_LABEL_LENGTH,
  MAX_FOCUS_PLANNED_MINUTES,
  MAX_HABIT_COUNT,
  MAX_MEAL_ITEM_GRAMS,
  MAX_NOTE_ATTACHMENT_BYTES,
  MAX_NOTE_LINKS,
  MAX_NOTE_TEMPLATE_BYTES,
  MAX_NOTE_UPDATE_BYTES,
  MAX_PRIV_AUTO_LOCK_MINUTES,
  MAX_QUEUE_DECK_IDS,
  MAX_SEARCH_BROWSE_LIMIT,
  MAX_SEARCH_LIMIT,
  MAX_SUBJECT_ATTACHMENT_BYTES,
  MAX_TASK_ATTACHMENT_BYTES,
  MAX_TASK_BULK_IDS,
  MAX_TASK_LIST_NAME_LENGTH,
  MAX_TASK_REMINDER_DAYS,
  MAX_TASK_REMINDERS,
  MAX_TASK_TEMPLATE_DUE_OFFSET_DAYS,
  MEAL_SLOTS,
  type MealSlot,
  MIN_BACKUP_KEEP_LAST,
  MIN_PRIV_AUTO_LOCK_MINUTES,
  type NexusDatabase,
  NOTE_FOLDER_COLORS,
  NOTE_FOLDER_VIEWS,
  type NoteAttachment,
  NoteAttachmentNotFoundError,
  NoteAttachmentStore,
  type NoteCategory,
  type NoteFolder,
  type NoteFolderColor,
  type NoteFolderView,
  type NoteMeta,
  NoteOrgStore,
  NoteStore,
  type NoteTag,
  type NoteTagLink,
  type NoteTemplate,
  NoteTemplateStore,
  type NotificationRecord,
  type NotificationSettings,
  NotificationStore,
  openDatabase,
  PeopleStore,
  type Person,
  PERSON_KINDS,
  type PersonKind,
  type PlanHealth,
  PlanStore,
  type PreviewIntervals,
  PrivateNoteStore,
  PrivateSettingsStore,
  PROFILE_KINDS,
  ProfileStore,
  rebuildSearchIndex,
  RestoreStore,
  type ScopeCutProposal,
  SearchHistoryStore,
  SearchStore,
  type SetFinBudgetInput,
  SNOOZE_PRESETS,
  SqliteFlagStore,
  StatsStore,
  STUDY_BLOCK_STATUSES,
  type StudyBlock,
  type StudyBlockStatus,
  type StudyBlockWithExam,
  type StudyPlan,
  StudySettingsStore,
  type Subject,
  SUBJECT_COLORS,
  type SubjectAttachment,
  SubjectAttachmentNotFoundError,
  SubjectAttachmentStore,
  type SubjectColor,
  SubjectNoteLinkStore,
  SubjectStore,
  type Task,
  TASK_LIST_VIEWS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskAttachment,
  type TaskAttachmentCount,
  TaskAttachmentNotFoundError,
  TaskAttachmentStore,
  type TaskDependencyLink,
  TaskDependencyStore,
  type TaskList,
  TaskListStore,
  type TaskListView,
  TaskNotFoundError,
  type TaskPriority,
  type TaskSection,
  type TaskStatus,
  TaskStore,
  type TaskTag,
  type TaskTagLink,
  TaskTagStore,
  type TaskTemplate,
  type TaskTemplatePayload,
  TaskTemplateStore,
  TOGGLEABLE_NOTIFICATION_SOURCES,
  TopicStore,
  type TrackedDocument,
  type UpdateCardFields,
  type UpdateCircuitPartFields,
  type UpdateDeckFields,
  type UpdateDocumentFields,
  type UpdateEventFields,
  type UpdateExamFields,
  type UpdateFinAccountFields,
  type UpdateFinRecurringFields,
  type UpdateFinTransactionFields,
  type UpdateFitExerciseFields,
  type UpdateFitFoodFields,
  type UpdateFitSetFields,
  type UpdateHabitFields,
  type UpdateNotificationSettingsInput,
  type UpdatePersonFields,
  type UpdatePlanFields,
  type UpdateSubjectFields,
  type UpdateTaskFields,
  SyncAccountStore,
  SyncJournal,
  SyncProgressStore,
  syncStoreFor,
  uuidv7,
} from "@nexus/db";
import {
  blobStorePaths,
  deleteBlobIfOrphaned,
  migrateLegacyBlobs,
  openExternally,
  pickAttachmentFiles,
  readBlob,
  registerBlobProtocol,
  saveAttachmentAs,
  saveBlob,
  type BlobStorePaths,
} from "./attachments.js";
import {
  DELETING_DIR_SUFFIX,
  MAX_ACCOUNT_LABEL_LENGTH,
  absorbLegacyFlatData,
  accountDir,
  accountExists,
  beginAccountDir,
  deleteAccount,
  readRegistry,
  registerAccount,
  renameAccount,
  resumeAccountsMigration,
  selectAccount,
  sweepDeletedAccountDirs,
} from "./accounts.js";
import {
  AuthError,
  changePasscode,
  createAccount,
  isKeystoreAvailable,
  readDeviceSecret,
  readStatus,
  regenerateRecoveryCode,
  unlockWithPasscode,
  unlockWithRecovery,
  verifyPasscode,
} from "./auth.js";
import {
  privAddAttachment,
  privCaptureAndLock,
  privCapturePendingVersions,
  privCaptureVersion,
  privCollectForExport,
  privDelete,
  privHandleMinimize,
  privHasPendingCaptures,
  privList,
  privListVersions,
  privLock,
  privMarkIndexStale,
  privRead,
  privReadAttachmentForExport,
  privReadVersion,
  privResealForRestore,
  privSearch,
  privSessionBlobKey,
  privSetLockPrefs,
  privSetup,
  privStatus,
  privSweepOrphanBlobs,
  privUnlock,
  privUnlockedFor,
  privWrite,
  rewrapPrivKitsForNewCode,
  type AccountPasscodeCheck,
  type PrivDeps,
} from "./priv.js";
import { moveNoteToPrivate, movePrivateNoteOut, type PrivMoveDeps } from "./privMove.js";
import {
  runBackupNow,
  startBackupScheduler,
  stopBackupScheduler,
  type BackupRunnerDeps,
} from "./backup.js";
import {
  backfillAttachmentText,
  extractAttachmentText,
  type AttachmentTextTarget,
} from "./attachmentText.js";
import { localToday } from "./clock.js";
import { toCircuitDocument, toWireDocument } from "./elecDocument.js";
import { createElecRunner } from "./elecRunner.js";
import { createElecRunnerIpc, type ElecRunnerIpc } from "./elecRunnerIpc.js";
import {
  decodePreviewText,
  isAllowedPreviewNavigation,
  isTextPreviewAttachment,
  minimalPdfBytes,
} from "./docPreview.js";
import { releaseGlobalCapture, setGlobalCaptureAccelerator } from "./globalCapture.js";
import { handleExport, handleIcsExport, writeProfileArchive, type ImexArchiveDeps } from "./imex.js";
import { handleMarkdownImport } from "./markdownImport.js";
import { checklistToTasks, countNoteChecklistItems } from "./noteChecklistTasks.js";
import { duplicateNote } from "./noteDuplicate.js";
import {
  cancelIdleCompactions,
  captureNoteVersion,
  compactIfNeeded,
  compactNow,
  healNotes,
  scheduleIdleCompaction,
} from "./notes.js";
import { resolveActiveProfileId } from "./activeProfile.js";
import {
  deliverSecurityNotices,
  runCheckNow,
  startNotificationScheduler,
  stopNotificationScheduler,
  type NotificationSchedulerDeps,
  type SecurityNotificationDeps,
} from "./notifications.js";
import { filterSearchHitsByModules } from "./searchGate.js";
import { asCanvasRefs } from "./canvasRefs.js";
import { focusPhaseEndCopy, restEndCopy } from "./notificationStrings.js";
import type { SecurityNotice } from "./notificationStrings.js";
import {
  ANKI_DECK_FILTER_NAME,
  ARCHIVE_FILTER_NAME,
  CALENDAR_FILTER_NAME,
  CSV_TABLE_FILTER_NAME,
  IMAGE_FILTER_NAME,
  ROS_WORKSPACE_DIALOG_BUTTON,
  ROS_WORKSPACE_DIALOG_TITLE,
  SKETCH_FILTER_NAME,
  STATEMENT_DIALOG_TITLE,
  STATEMENT_FILTER_NAME,
} from "./shellStrings.js";
import { computeSnoozeUntil, resolveDefaultSnoozePreset } from "./snooze.js";
import { pickProfilePicture } from "./profilePicture.js";
import {
  applyApkgImport,
  applyCsvImport,
  applyFinCsvImport,
  applyIcsImport,
  applyImport,
  applyLlmImport,
  applyRestore,
  cancelApkgImport,
  cancelCsvImport,
  cancelFinCsvImport,
  cancelIcsImport,
  cancelImport,
  cancelLlmImport,
  cancelRestore,
  clearRestoreState,
  mapCsvImport,
  mapFinCsvImport,
  pickApkgFile,
  pickCsvFile,
  pickFinCsvFile,
  pickIcsFile,
  pickImportFile,
  pickRestoreFile,
  previewApkgImport,
  previewCsvImport,
  previewFinCsvImport,
  previewIcsImport,
  previewImport,
  previewLlmImport,
  previewRestore,
  privateUndoPending,
  replanImport,
  replanLlmImport,
  restoreStatus,
  undoRestore,
  type ImportDeps,
} from "./restore.js";
import {
  type AccountSummary,
  APKG_IMPORT_MAX_SUBJECT_NAME_LENGTH,
  type ApkgImportApplyResult,
  type ApkgImportPickResult,
  type ApkgImportPreviewResult,
  type ApkgImportSubjectChoice,
  type AppInfo,
  type AuthResult,
  type AuthStatus,
  BACKUP_CADENCES,
  type BackupCadence,
  type BackupSettingsView,
  type CalendarOverlayEvent,
  type CalendarSettings,
  CARD_KINDS,
  CARD_TEXT_MAX_LENGTH,
  type CardKind,
  type CodeExportResult,
  CSV_IMPORT_COLUMN_ROLES,
  CSV_IMPORT_MAX_COLUMNS,
  CSV_IMPORT_MAX_LIST_NAME_LENGTH,
  type CsvImportApplyResult,
  type CsvImportColumnRole,
  type CsvImportDelimiter,
  type CsvImportListChoice,
  type CsvImportMapResult,
  type CsvImportPickResult,
  type CsvImportPreviewResult,
  DASHBOARD_SET_NAME_MAX_LENGTH,
  type DashboardPickResult,
  type DashboardSetsCreated,
  type DashboardSetsState,
  type DashboardSettings,
  type DashboardWidgetInstance,
  type DashboardWidgetSize,
  DOC_MIME_FAMILIES,
  DOC_TEXT_PREVIEW_MAX_BYTES,
  type DocAttachmentList,
  type DocAttachmentModule,
  type DocMimeFamily,
  type DocTextContent,
  DEMO_PROFILE_NAME,
  type ElecCircuit,
  type ElecCircuitDocument,
  type ExportResult,
  FIN_CSV_IMPORT_COLUMN_ROLES,
  FIN_CSV_IMPORT_SIGN_CONVENTIONS,
  type FinCsvImportApplyResult,
  type FinCsvImportColumnRole,
  type FinCsvImportMapResult,
  type FinCsvImportPreviewResult,
  type FinCsvImportSignConvention,
  type FitBodyProfile,
  type FitDay,
  type FitDayTotals,
  type FitExercise,
  type FitExerciseOption,
  type FitFoodOption,
  type FitLastPerformed,
  type FitMeasurement,
  type FitRestTimer,
  type FitRoutine,
  type FitRoutineItemInput,
  type FitWorkout,
  type FitWorkoutSet,
  type FlagState,
  type GlobalShortcutChord,
  type GlobalShortcutResult,
  type IcsExportResult,
  type IcsImportApplyResult,
  type IcsImportPickResult,
  type IcsImportPreviewResult,
  IMPORT_DUPLICATE_TYPES,
  type ImportApplyResult,
  type ImportDuplicateChoices,
  type ImportDuplicateType,
  type ImportPickResult,
  type ImportPreviewResult,
  IpcChannel,
  LLM_IMPORT_KINDS,
  LLM_IMPORT_MAX_ANSWER_LENGTH,
  LLM_IMPORT_MAX_DECK_NAME_LENGTH,
  type LlmImportApplyResult,
  type LlmImportDeckChoice,
  type LlmImportKind,
  type LlmImportPreviewResult,
  type MarkdownImportResult,
  type MarkdownImportSource,
  MAX_BACKGROUND_BYTES,
  MAX_BACKGROUND_DIM,
  MAX_EVENT_TEMPLATE_NAME_LENGTH,
  MAX_FIT_EXERCISE_QUERY_LENGTH,
  MAX_FIT_EXERCISE_RESULTS,
  MAX_FIT_REST_SECONDS,
  MAX_FIT_WORKOUT_NOTES_LENGTH,
  MAX_NEW_PER_DAY,
  MAX_PROFILE_PICTURE_BYTES,
  MAX_REVIEWS_PER_DAY,
  MAX_TARGET_RETENTION,
  MAX_TASK_TAG_NAME_LENGTH,
  MAX_TASK_TEMPLATE_NAME_LENGTH,
  MIN_FIT_REST_SECONDS,
  MIN_TARGET_RETENTION,
  NOTE_CARD_DISPOSITIONS,
  NOTE_CARD_KEY_MAX_LENGTH,
  NOTE_CARDS_MAX_COUNT,
  type NoteCardDisposition,
  type NoteCardSpec,
  type NoteChecklistTasksResult,
  type NoteDocPayload,
  type NoteDuplicateResult,
  type NoteVersionMeta,
  PRIV_ATTACHMENT_MAX_BYTES,
  PRIV_ATTACHMENTS_MAX_COUNT,
  PRIV_PLAINTEXT_MAX_BYTES,
  PRIV_STATE_MAX_BYTES,
  PRIV_TITLE_MAX_BYTES,
  type PrivAttachmentPickResult,
  type PrivAttachmentRef,
  type PrivMoveInResult,
  type PrivMoveOutResult,
  type PrivNoteEnvelopePayload,
  type PrivNoteListEntry,
  type PrivNoteVersionMeta,
  type PrivSetupResult,
  type PrivStatus,
  type PrivUnlockResult,
  type Profile,
  type ProfileKind,
  type ProfilePicturePickResult,
  type RecurrenceRule,
  type RestoreApplyResult,
  type RestorePickResult,
  type RestorePreviewResult,
  type RestoreStatus,
  type RestoreUndoResult,
  type ReviewQueue,
  type RunnerDetection,
  type RunnerPlanResult,
  type RunnerSettings,
  type RunnerStartResult,
  type RunnerState,
  type RunnerStopState,
  type RunningFocusSession,
  type SaveAttachmentResult,
  SEARCH_PAGE_MAX_RESULTS,
  SEARCH_QUERY_MAX_BYTES,
  SEARCH_RESULT_MAX_LIMIT,
  type SearchHistoryEntry,
  type SearchPageResult,
  type SearchResult,
  type SnoozePreset,
  type StudySettings,
  type StudyStats,
  type SubjectAttachmentsAddResult,
  type SubjectStudyLog,
  type SyncActivityView,
  type SyncAdoptView,
  type SyncEnableView,
  type SyncReconnectView,
  type SyncStatusView,
  type TaskAttachmentsAddResult,
  type TaskListsSnapshot,
  type TopicMoveDirection,
  WINDOW_VIEW_COMMANDS,
  type WindowState,
  type WindowViewCommand,
} from "../shared/ipc.js";
import { businessProfileFlags, createModuleRegistry, LOCKED_MODULE_IDS } from "../shared/modules.js";
import { DEMO_BUSINESS_PROFILE_NAME, seedDemoBusiness, seedDemoProfile } from "./demo/index.js";
import type { DemoAttachmentIo } from "./demo/attachments.js";
import { duplicateStems, missingCoverage, runShots } from "./shots/index.js";

/**
 * Reads a harness flag off the command line — and answers false for every one
 * of them in a packaged build.
 *
 * The three flags below are development tools with a person's authority: two of
 * them wipe a directory, all three mint an account whose passcode is printed in
 * this very file, and each then drives the app unattended. That was safe only
 * because nobody was expected to type them at an installed `Nexus.exe`, which is
 * an expectation, not a defence — `process.argv` on a shipped app belongs to
 * whoever launches it, including a shortcut or a scheduled task somebody else
 * wrote. The comment that used to sit here claimed these modes were "never
 * reachable from a packaged install"; nothing made that true, so it is made
 * true here instead of asserted.
 *
 * `app.isPackaged` is readable before `ready` (it is decided by where the
 * executable is, not by app state), so the check can live at module scope with
 * the flags themselves rather than at each of the eight places that branch on
 * one. Funnelling every flag through one function is the point: three separate
 * `&& !app.isPackaged` clauses are three chances for a fourth harness to be
 * added without one.
 */
function developmentFlag(flag: string): boolean {
  return !app.isPackaged && process.argv.includes(flag);
}

/**
 * `--smoke`: prove the shell is wired end to end against a disposable
 * `userData` subdirectory and its own throwaway account, then exit with a
 * verdict on stdout.
 */
const isSmoke = developmentFlag("--smoke");

/**
 * `--shots`: photograph every surface, in both themes, at three window sizes,
 * and report what the page's own geometry says is wrong with it (`shots/`).
 *
 * Like `--smoke` it redirects `userData` into a disposable subdirectory,
 * creates its own throwaway account, and exits when it is done.
 */
const isShots = developmentFlag("--shots");

/**
 * `--demo`: add a fully populated account to THIS device and exit, so the whole
 * product can be looked at without typing several hundred rows by hand.
 *
 * Unlike the two modes above this one writes into the real `%APPDATA%\Nexus` —
 * that is the point, since the account has to still be there when the app is
 * opened normally afterwards. It is strictly additive: accounts are separate
 * directories with separate key chains (ADR-044), so seeding one cannot reach
 * another's data. Which is why it survived the audit that closed the other two,
 * and it is still refused in a packaged build for a plainer reason: `DEMO_PASSCODE`
 * is a constant four lines below, so on a real install the account it adds is an
 * unlock anyone who has read this repository already knows.
 */
const isDemo = developmentFlag("--demo");

/** The label and passcode `--demo` creates its account with. Printed on exit, because an account nobody can unlock is not a demo. */
const DEMO_ACCOUNT_LABEL = "Demo";
const DEMO_PASSCODE = "demo-nexus-2026";

/**
 * True for every launch that is a harness rather than a person.
 *
 * Five things in this process are switched off for such a run — the
 * notification scheduler, the security-notice ledger, the profile-switch
 * rescheduling, the OS-wide hotkey claim, and the update check — and each of
 * them used to test `isSmoke` directly. The rule they were all reaching for
 * was never "the smoke run" but "nobody is sitting in front of this", so it is
 * written once here: a second harness would otherwise have had to remember all
 * five, and a toast firing into a screenshot sweep would corrupt the very
 * frames it exists to produce.
 */
const isAutomatedRun = isSmoke || isShots || isDemo;

/** Fixed passcode the smoke run creates its own throwaway account with (ADR-018) — satisfies `validatePasscode` (8+ chars, letter and digit) and is never used for anything but the smoke harness's own disposable `userData/smoke` directory. */
const SMOKE_PASSCODE = "smoke-passcode-1";

/** The label the smoke run's throwaway account is created with (ADR-044) — proves the registry keeps what `auth:create` was handed. */
const SMOKE_ACCOUNT_LABEL = "Smoke nalog";

/** The second account the multi-account rehearsal adds, with a passcode of its own — two accounts must never share a key chain (ADR-044). */
const SMOKE_SECOND_LABEL = "Drugi smoke nalog";
const SMOKE_SECOND_PASSCODE = "second-passcode-2";

// SEC-EL: registers the `nx-blob:` scheme as privileged (ADR-014) — MUST run
// at module scope, before the app's "ready" event, or Electron ignores it.
// `standard` gives it normal URL parsing (so the attachment hash can be read
// back off the host); `secure` + the CSP's `img-src` entry are what let a
// future inline `<img src="nx-blob://...">` (slice 003-b) load at all.
protocol.registerSchemesAsPrivileged([
  { scheme: "nx-blob", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  // The private section's read protocol (PRIV v1 / ADR-057): same privileges,
  // entirely different gate — it serves ONLY while a section is unlocked.
  { scheme: "priv-blob", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Stable product name so userData resolves to a clean, branded directory
// (%APPDATA%\Nexus) rather than the scoped package name. Set before any
// getPath("userData") call.
app.setName("Nexus");

// SEC-NET: the resolver-level layer of the cloud-off boundary.
//
// MUST run at module scope, for the same reason the scheme registration above
// does: a Chromium command-line switch is read once while the browser process
// is starting, and appending it after `ready` changes nothing while looking
// like it changed something. And it MUST run after `app.setName`, because
// `shouldBlockResolver` reads `cloud.json` out of `userData` and that path is
// what the line above decides.
//
// This is the layer that cannot be lifted at runtime, and the asymmetry is the
// design rather than a shortcoming: the state this product has to be able to
// guarantee is the DEFAULT one, and every launch builds it from scratch before
// a line of renderer code has run. `net/offline.ts` covers the other three
// layers and why turning cloud ON needs no restart while turning it off does.
//
// `MAP * ~NOTFOUND` blocks NAMES, not literal IPs, which is exactly why it is
// the third line of defence and not the only one — `webRequest` does not care
// how the destination was spelled.
if (shouldBlockResolver(app.getPath("userData"))) {
  app.commandLine.appendSwitch("host-resolver-rules", "MAP * ~NOTFOUND");
}

// The screenshot sweep only. Two switches, because Chromium has two separate
// mechanisms for standing a window down and `backgroundThrottling: false` in
// `webPreferences` only reaches one of them: it stops the RENDERER being
// throttled, while occlusion detection is a browser-process decision that
// suspends compositing regardless. A sweep needs both off — one dead run hung
// for ever on an animation frame that never came, and the run before it died on
// `capturePage` answering `VizSentEmptyBitmap`, which is what a window with no
// live compositor has to give.
//
// Guarded on `--shots` and never shipped: throttling an invisible window is
// correct behaviour that a laptop's battery depends on. This is a measurement
// instrument asking not to be stood down while it measures.
if (isShots) {
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
}

// Interim brand glyph (four-pointed star, see build/make-icon.ps1). Resolved
// via getAppPath() so the same relative path works unpacked (dev/smoke, app
// root = apps/desktop) and packaged (app root = the asar root; electron-builder
// ships both icon files alongside out/, see electron-builder.yml `files`).
//
// The FORMAT is per-platform, not per-taste: Chromium's ICO decoder is compiled
// in on Windows only, so on Linux `icon: …/icon.ico` is not a smaller icon — it
// is no icon, silently, with the window falling back to the toolkit default.
// Both files come out of the same generator so they cannot drift.
const iconFile = process.platform === "win32" ? "build/icon.ico" : "build/icon.png";
const iconPath = join(app.getAppPath(), iconFile);

let db: NexusDatabase | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * The unlocked session's data key (hex), held only for as long as the
 * database is open — needed by `auth:regenerate-recovery`, which rewraps the
 * Recovery Kit without asking for the passcode again (the caller already
 * proved possession once this session). `auth:lock` (and nothing else) drops
 * it. Nothing besides that one handler ever reads it.
 */
let unlockedDataKeyHex: string | null = null;

/**
 * The attachment blob store's keys (ADR-019), derived from `unlockedDataKeyHex`
 * the moment it is adopted and sharing its lifetime exactly: set together in
 * `adoptUnlockedKey`, cleared together in `performLock`. Nothing about the
 * data key itself is recoverable from these — they are one-way HKDF outputs.
 */
let blobKeys: BlobKeys | null = null;

/**
 * The unlock's background legacy-blob migration, kept only so something can
 * *wait* for it: nothing in the app does (that is the whole point of running it
 * unawaited), but the smoke rehearsal must know the pass it did not start has
 * finished before it writes a legacy blob of its own, or the two would race
 * over the same directory and make the gate flaky.
 */
let legacyMigrationTask: Promise<unknown> = Promise.resolve();

// The ONE focus timer (STUDY piece 4a, widened by UTIL slice b / ADR-077): the
// *running* phase is deliberately never a database row (see the `focus_sessions`
// migration's doc comment) — it lives only as this main-process runtime state,
// keyed by profile id, so a crash or app restart simply loses the in-progress
// phase instead of persisting a fabricated duration. Only `FocusStore.create`
// (on `focus:stop`, or on the `before-quit` sweep) ever writes a row.
//
// ONE per profile, which is the invariant the whole timer rests on: a second
// running phase would make „koliko sam danas fokusiran bio" a sum of overlapping
// spans, and no reading of that number would be true.
const runningFocusSessions = new Map<string, RunningFocusPhase>();

/**
 * The running phase, plus the one thing the wire does not carry: the OS-alarm
 * handle. The timer is main's own bookkeeping and no renderer's business, so it
 * is added here rather than widening `RunningFocusSession` — which is exactly
 * what `focus:status` answers with, minus this field.
 */
interface RunningFocusPhase extends RunningFocusSession {
  /**
   * The `setTimeout` that fires the phase-end notification, or null when there
   * is nothing to fire: an open-ended phase (no plan to reach), a paused one
   * (cancelled on pause, re-armed on resume), or one already past its plan.
   *
   * A handle rather than a wall-clock check on a shared interval, for the
   * reason `phaseProgress` is wall-clock: the alarm is a single scheduled event
   * and the DISPLAY is derived arithmetic, so a machine that slept through the
   * planned end shows the overrun honestly the moment it wakes, and the alarm
   * that did not fire on time simply fires late rather than never.
   */
  timer: NodeJS.Timeout | null;
}

/** What `focus:*` answers with — the phase without main's private alarm handle. */
function toRunningFocusSession(phase: RunningFocusPhase): RunningFocusSession {
  const { timer: _timer, ...running } = phase;
  return running;
}

/**
 * Cancels a phase's pending alarm, if it has one. Called on pause, on stop, on
 * cancel and before re-arming — a handle that outlived its phase would fire a
 * notification about a phase nobody is running.
 */
function disarmFocusAlarm(phase: RunningFocusPhase): void {
  if (phase.timer !== null) {
    clearTimeout(phase.timer);
    phase.timer = null;
  }
}

/**
 * Arms the phase-end alarm for whatever is LEFT of a planned phase, measured
 * from the wall clock rather than from the plan: a phase resumed after a
 * ten-minute pause has ten more minutes to run, and `phaseProgress` is the one
 * place that arithmetic lives.
 *
 * Nothing is armed for an open-ended phase (there is no end to announce), for a
 * paused one (its clock is frozen), or for one already past its plan — that
 * last case is the honest one: the notification fired when the plan was reached
 * and the phase is now in overrun, which the page states rather than the OS
 * repeating.
 *
 * The alarm does NOT end the phase. Ending is a deliberate act (`focusSession.ts`
 * on `phaseProgress`), so all this does is say so out loud.
 */
function armFocusAlarm(profileId: string, phase: RunningFocusPhase): void {
  disarmFocusAlarm(phase);
  if (phase.plannedMinutes === null || phase.pausedAt !== null) return;
  const progress = phaseProgress(phase, new Date().toISOString());
  if (progress.remainingSeconds <= 0) return;

  phase.timer = setTimeout(() => {
    const current = runningFocusSessions.get(profileId);
    // The phase that armed this must still be the phase that is running: a stop
    // and a fresh start inside the window would otherwise announce the end of
    // something that already ended.
    if (current !== phase) return;
    current.timer = null;
    if (!Notification.isSupported() || current.plannedMinutes === null) return;
    const copy = focusPhaseEndCopy(current.kind, current.plannedMinutes, current.label);
    const notification = new Notification({ title: copy.title, body: copy.body });
    notification.on("click", () => {
      const win = mainWindow;
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    });
    notification.show();
  }, progress.remainingSeconds * 1000);
}

/**
 * Ends the running phase and persists it, or answers `null` when there is
 * nothing to persist — no phase, or one whose end landed in the same
 * millisecond as its start (the store's `ended_at > started_at` CHECK, honoured
 * here rather than caught).
 *
 * `outcome` is the caller's, because only the caller knows why it ended: a
 * phase that reached its plan and was acknowledged is `completed`, everything
 * else — a hand stop, an open-ended session, the quit sweep — is `stopped`.
 * There is deliberately no third value (see `FOCUS_OUTCOMES`).
 *
 * `pausedSeconds` folds in a pause still running at the moment of the stop:
 * stopping a paused phase must not count the pause as attention.
 */
function endRunningFocusPhase(
  profileId: string,
  outcome: FocusOutcome,
  endedAt: string,
): FocusSession | null {
  const phase = runningFocusSessions.get(profileId);
  if (!phase) return null;
  disarmFocusAlarm(phase);
  runningFocusSessions.delete(profileId);
  if (endedAt <= phase.startedAt) return null; // sub-millisecond stop: discarded, not persisted

  const pausedSeconds = phase.pausedSeconds + closedPauseSeconds(phase.pausedAt, endedAt);
  return focusStore(profileId).create(
    {
      subjectId: phase.subjectId,
      startedAt: phase.startedAt,
      endedAt,
      kind: phase.kind,
      plannedMinutes: phase.plannedMinutes,
      // Floored at the span itself: the store refuses more, and a clock that
      // stepped backwards mid-pause must not turn into a refusal the user sees
      // as „your session could not be saved".
      pausedSeconds: Math.min(pausedSeconds, spanSeconds(phase.startedAt, endedAt)),
      outcome,
      cycleIndex: phase.cycleIndex,
      taskId: phase.taskId,
      label: phase.label,
    },
    endedAt,
  );
}

/**
 * Drops the running phase without persisting anything — `focus:cancel`, and the
 * restore path's own discard. The alarm goes with it: a `setTimeout` left behind
 * would announce the end of a phase that no longer exists.
 */
function discardRunningFocusPhase(profileId: string): void {
  const phase = runningFocusSessions.get(profileId);
  if (!phase) return;
  disarmFocusAlarm(phase);
  runningFocusSessions.delete(profileId);
}

/**
 * Closes every running phase with a REAL end time as the app goes down
 * (`before-quit`, which fires while the database is still open — `will-quit`
 * closes it).
 *
 * This is what makes a crash and a quit different facts, and the difference is
 * the whole reason slice a has no `abandoned` outcome: a clean quit writes an
 * honest row ending now, so a phase that is STILL missing after a restart can
 * only mean the process was killed — and that phase is simply gone, which is
 * the honest outcome for time nobody witnessed the end of.
 *
 * Outcome `stopped`, always: quitting is not reaching a plan.
 *
 * Failures are swallowed, one profile at a time. The app is on its way out and
 * a locked or half-closed database must not stop it from getting there; a lost
 * row here is the same loss a crash would have caused anyway.
 */
function closeRunningFocusPhasesOnQuit(): void {
  const endedAt = new Date().toISOString();
  for (const profileId of [...runningFocusSessions.keys()]) {
    try {
      endRunningFocusPhase(profileId, "stopped", endedAt);
    } catch (error) {
      console.error("Nexus: a running focus phase could not be closed on quit:", error);
      discardRunningFocusPhase(profileId);
    }
  }
}

/** Whole seconds of a pause that started at `pausedAt` and is closing at `until`; 0 when none was running. */
function closedPauseSeconds(pausedAt: string | null, until: string): number {
  if (pausedAt === null) return 0;
  const seconds = Math.floor((Date.parse(until) - Date.parse(pausedAt)) / 1000);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

/** A phase's wall span in whole seconds — the ceiling `pausedSeconds` may not exceed. */
function spanSeconds(startedAt: string, endedAt: string): number {
  const seconds = Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1000);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

// The rest countdown between sets (FIT slice c, ADR-081 §7). It borrows the
// runtime shape directly above it and nothing else: a Map keyed by profile, a
// `setTimeout` that only ANNOUNCES, and no row anywhere.
//
// What it deliberately does NOT borrow is the ending. A focus phase ends by
// writing a `focus_sessions` row, which is what makes it a tracked timer; this
// one ends by being over. It records nothing, so „koliko sam danas bio
// fokusiran" cannot absorb it and the one-timer rule stays exactly where
// ADR-077 put it.
//
// ONE per profile, for the reason there is one open workout: a rest is the rest
// after the set you just did, and two of them would be two answers to „koliko mi
// je još ostalo".
const runningRestTimers = new Map<string, RunningRestTimer>();

/** The running rest, plus the alarm handle the wire has no business carrying (`RunningFocusPhase`'s arrangement). */
interface RunningRestTimer extends FitRestTimer {
  timer: NodeJS.Timeout | null;
}

/** What `fit:rest-*` answers with — the countdown without main's private alarm handle. */
function toWireRestTimer(rest: RunningRestTimer): FitRestTimer {
  const { timer: _timer, ...wire } = rest;
  return wire;
}

/**
 * Drops the running countdown and its alarm. Called on stop, before starting a
 * fresh one, and when the profile goes away — a handle that outlived its
 * countdown would announce a rest nobody is taking.
 */
function clearRestTimer(profileId: string): void {
  const rest = runningRestTimers.get(profileId);
  if (rest === undefined) return;
  if (rest.timer !== null) clearTimeout(rest.timer);
  runningRestTimers.delete(profileId);
}

/**
 * Starts a countdown of `seconds`, replacing whatever was running: logging
 * another set mid-rest restarts the rest, because that is what actually
 * happened.
 *
 * The alarm says the rest is over and does nothing else — there is no state to
 * transition, and the entry stays in the map afterwards so a page that comes
 * back can still see that the rest it started has elapsed rather than finding
 * nothing and drawing no timer at all.
 */
function startRestTimer(profileId: string, seconds: number): FitRestTimer {
  clearRestTimer(profileId);
  const startedAt = new Date();
  const rest: RunningRestTimer = {
    startedAt: startedAt.toISOString(),
    endsAt: new Date(startedAt.getTime() + seconds * 1000).toISOString(),
    seconds,
    timer: null,
  };
  rest.timer = setTimeout(() => {
    // The countdown that armed this must still be the one in the map: a stop and
    // a fresh start inside the window would otherwise announce the wrong rest.
    if (runningRestTimers.get(profileId) !== rest) return;
    rest.timer = null;
    if (!Notification.isSupported()) return;
    const copy = restEndCopy(seconds);
    const notification = new Notification({ title: copy.title, body: copy.body });
    notification.on("click", () => {
      const win = mainWindow;
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    });
    notification.show();
  }, seconds * 1000);
  runningRestTimers.set(profileId, rest);
  return toWireRestTimer(rest);
}

// --- Accounts (ADR-044) -----------------------------------------------------

/**
 * Which local account every path below resolves against, and which one the
 * seven original auth channels act on. Set once at startup (`lastActiveId`, or
 * the sole account) and changed only by `auth:select-account` /
 * `auth:create-additional` — both of which lock first, so there is never more
 * than one unlocked account. Null only until the very first account exists.
 */
let activeAccountId: string | null = null;

/**
 * ADR-058 (NTF active-profile rule): which profile the renderer's shell is
 * standing in — reported over `profiles:set-active` at unlock landing and on
 * every verified switch, held here so the notification scheduler serves the
 * ACTIVE profile only. Null while locked and until the first report after an
 * unlock, which `resolveActiveProfileId` reads as "the personal anchor" — the
 * rule's own default.
 */
let activeProfileId: string | null = null;

/**
 * The module manifests, registered once per process (ADR-008: static,
 * compiled-in data) — the same list the renderer registers, imported from the
 * one `shared/modules.ts` both sides read. Main needs it for exactly one
 * thing: resolving a profile's enabled-module set for the search-result gate
 * (ADR-058 §5, `searchGate.ts`).
 */
const moduleRegistry = createModuleRegistry();

/** The `userData` directory itself — the registry's home, and the root every account directory hangs off. */
function userDataDir(): string {
  return app.getPath("userData");
}

/**
 * `<userData>/accounts/<activeAccountId>` — what every `main/auth.ts` function
 * takes as its first argument, and what every data path below is built from.
 * Throws when no account is selected: every caller either runs after startup
 * chose one or after a create made one, so a null here is an internal ordering
 * mistake, not a state the user can reach.
 */
function activeAccountDir(): string {
  if (activeAccountId === null) {
    throw new Error("Internal error: no local account is selected.");
  }
  return accountDir(userDataDir(), activeAccountId);
}

// --- Database ---------------------------------------------------------------

function databasePath(): string {
  return join(activeAccountDir(), "nexus.db");
}

/** `<account>/blobs` (encrypted) + `<account>/attachments` (legacy plaintext) — the NOTE attachment blob store's roots (ADR-014, encrypted at rest per ADR-019). */
function blobStorePathsFor(): BlobStorePaths {
  return blobStorePaths(activeAccountDir());
}

/** `<account>/tmp-open` — where `openExternally` copies a blob before handing it to the OS's default app. */
function tmpOpenDirPath(): string {
  return join(activeAccountDir(), "tmp-open");
}

/** `<account>/private-blobs` — the sealed private-attachment store (PRIV v1 / ADR-057): one NXPB container per file, named by its random reference id. No content addressing, no dedup, by design. */
function privBlobsDirPath(): string {
  return join(activeAccountDir(), "private-blobs");
}

/** Removes a directory and everything under it, forgiving the busy files Windows refuses to delete — see `wipeTmpOpenDir`. */
function wipeDirBestEffort(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Busy files stay behind until a later attempt; nothing here is worth failing a lock over.
  }
}

/**
 * Wipes the decrypted copies `openExternally` leaves for the OS shell
 * (ADR-019). Best-effort on purpose: on Windows a file still open in Word or a
 * PDF viewer cannot be deleted, and `rmSync`'s `force` only forgives a missing
 * path, not a busy one. Locking the app must never fail because a viewer is
 * still holding a temp copy — the next lock or launch clears it.
 */
function wipeTmpOpenDir(): void {
  if (activeAccountId === null) return;
  wipeDirBestEffort(tmpOpenDirPath());
}

/**
 * Every account's `tmp-open`, for the startup sweep. A lock only ever wipes the
 * account it locked, and a process that died never locked at all — so the one
 * pass that has to be exhaustive is this one, which cannot know which account
 * the previous run was on.
 */
function wipeAllTmpOpenDirs(): void {
  const userData = userDataDir();
  for (const account of readRegistry(userData).accounts) {
    wipeDirBestEffort(join(accountDir(userData, account.id), "tmp-open"));
  }
}

const SIDECAR_SUFFIXES = ["-wal", "-shm"] as const;

/**
 * Copies a SQLite main file plus whichever of its WAL/SHM sidecars currently
 * exist, so the destination is a complete, self-consistent snapshot even when
 * the source is a WAL-mode database with writes not yet checkpointed into the
 * main file (`openDatabase` always turns on `journal_mode = WAL`, so a plain
 * `nexus.db` file copy alone could silently miss the most recent transactions
 * — this is the difference between a backup that is actually restorable and
 * one that merely looks like it is). Nothing is writing to `from` at any point
 * this runs (the app that owns this call has exclusive access), so a plain
 * filesystem copy of all three files is a valid snapshot. Any sidecar at the
 * destination with no matching source file is removed — left over from
 * whatever used to be there, and otherwise able to silently reintroduce stale
 * WAL frames the next time SQLite opens the destination.
 */
function copyDatabaseTriplet(from: string, to: string): void {
  copyFileSync(from, to);
  for (const suffix of SIDECAR_SUFFIXES) {
    const src = `${from}${suffix}`;
    const dst = `${to}${suffix}`;
    if (existsSync(src)) copyFileSync(src, dst);
    else rmSync(dst, { force: true });
  }
}

/** Removes a SQLite main file and its WAL/SHM sidecars (if any) — the inverse of the snapshot `copyDatabaseTriplet` makes, used once a migration or a restore no longer needs it. */
function removeDatabaseTriplet(path: string): void {
  rmSync(path, { force: true });
  for (const suffix of SIDECAR_SUFFIXES) rmSync(`${path}${suffix}`, { force: true });
}

/**
 * Encrypts a plaintext `nexus.db` in place (ADR-018 step 2): back it up first
 * (2a — the source is already plaintext, so the copy adds no exposure, and it
 * is the difference between an interrupted rekey being an inconvenience and
 * being total data loss), rekey it (2b), reopen it with the new key to prove
 * the rekey actually took (2c), and only then discard the backup (2d).
 */
function migratePlaintextInPlace(path: string, backupPath: string, dataKeyHex: string): void {
  copyDatabaseTriplet(path, backupPath); // 2a
  encryptDatabaseInPlace(path, dataKeyHex); // 2b
  db = openDatabase({ path, encryptionKey: dataKeyHex }); // 2c
  removeDatabaseTriplet(backupPath); // 2d
}

/**
 * Opens `nexus.db` under `dataKeyHex`, encrypting/migrating/recovering it as
 * needed, and sets the module-level `db`. Used by every unlock path
 * (`auth:create`/`auth:unlock`/`auth:recover`, and the smoke harness's own
 * setup) — never called with the database already open.
 *
 * Order of operations, in the order they are tried:
 *
 * 1. No `nexus.db` at all → `openDatabase` creates it already encrypted.
 *    Nothing else to do.
 * 2. `nexus.db` exists and is plaintext → this install predates encryption
 *    (or a previous attempt died before finishing this same step — see the
 *    crash-recovery branch below, which lands back here after restoring a
 *    known-good backup). `migratePlaintextInPlace` runs the full
 *    backup/rekey/reopen/discard sequence.
 * 3. Otherwise the file is already encrypted — the ordinary case on every
 *    later launch. Just open it.
 * 4. Crash recovery: if step 3 throws `DatabaseLockedError` AND a leftover
 *    `nexus.db.pre-encryption` exists, the previous run's rekey (step 2b)
 *    started rewriting `nexus.db` and never finished — a partially rekeyed
 *    file opens as neither valid plaintext (so step 2's check already said
 *    false) nor validly encrypted (so this open just failed). The backup is
 *    the last known-good plaintext snapshot; restoring it and retrying the
 *    whole migration from step 2 turns "total data loss" into "redo one
 *    rekey". Done at most once — a second failure after a fresh restore is a
 *    real error, not a transient crash artifact, and must not be masked by
 *    retrying forever.
 */
function openEncrypted(dataKeyHex: string): void {
  const path = databasePath();
  const backupPath = `${path}.pre-encryption`;

  if (!existsSync(path)) {
    db = openDatabase({ path, encryptionKey: dataKeyHex }); // 1
  } else if (isPlaintextDatabase(path)) {
    migratePlaintextInPlace(path, backupPath, dataKeyHex); // 2
  } else {
    try {
      db = openDatabase({ path, encryptionKey: dataKeyHex }); // 3
    } catch (error) {
      if (!(error instanceof DatabaseLockedError) || !existsSync(backupPath)) {
        throw error;
      }
      copyDatabaseTriplet(backupPath, path); // 4: restore...
      migratePlaintextInPlace(path, backupPath, dataKeyHex); // ...then redo the migration once.
    }
  }

  // Can only run once the database is open.
  seedFirstRunProfile(requireDb());
}

/**
 * The `profiles` table's own store (SET-001, migration 040) — the one store
 * constructed without a profile id, because this table IS the profile list. See
 * `ProfileStore`'s class doc for why that is not a hole in the per-profile
 * scoping rule.
 */
function profileStore(): ProfileStore {
  return new ProfileStore(requireDb().raw);
}

/**
 * Every profile, as the renderer sees one. `ProfileRecord` and the wire
 * `Profile` are field-for-field identical by design (the wire type mirrors the
 * table), so this is a pass-through rather than a mapping — the columns are
 * already named once, in the store.
 */
function listProfiles(database: NexusDatabase): Profile[] {
  return new ProfileStore(database.raw).list();
}

/** Reads one profile by id; throws when it matches no row (IMEX export needs the profile's name and picture for the manifest). */
function requireProfile(database: NexusDatabase, id: string): Profile {
  const profile = new ProfileStore(database.raw).get(id);
  if (profile === null) {
    throw new Error("Invalid IPC payload: unknown profile id.");
  }
  return profile;
}

/**
 * One profile's identity in the shape an archive's manifest carries it
 * (`@nexus/core`'s `ExportArchiveInput["profile"]`).
 *
 * Constructed field by field, deliberately: `buildExportArchive` writes this
 * object into `manifest.json` verbatim, so handing it a whole `Profile` would
 * quietly publish `createdAt` — and every column the row gains later — into
 * the interchange contract, where nothing decided they belong. `kind` IS here
 * because interchange `1.22.0` decided it belongs (ADR-058): what kind of
 * profile an archive is OF is part of its identity, and the restore preview
 * refuses a kind-mismatched pair by name.
 */
function archiveProfileOf(profile: Profile): ExportArchiveInput["profile"] {
  return {
    id: profile.id,
    name: profile.name,
    kind: profile.kind,
    picture: profilePictureOf(profile),
  };
}

/** The picture trio as the interchange's nested object, or null — the trio moves together (migration 040's CHECKs), so one guard covers all three. */
function profilePictureOf(profile: Profile): ArchiveProfilePicture | null {
  if (
    profile.pictureHash === null ||
    profile.pictureMime === null ||
    profile.pictureSizeBytes === null
  ) {
    return null;
  }
  return {
    hash: profile.pictureHash,
    mime: profile.pictureMime,
    sizeBytes: profile.pictureSizeBytes,
  };
}

/** Renames an existing profile; throws when the id matches no row (ONB lite). */
function renameProfile(database: NexusDatabase, id: string, name: string): void {
  const result = database.raw
    .prepare("UPDATE profiles SET name = ? WHERE id = ?")
    .run(name, id);
  if (result.changes === 0) {
    throw new Error("Invalid IPC payload: unknown profile id.");
  }
}

/**
 * First-run seeding: create exactly one personal profile if the table is empty.
 * The name is intentionally blank — profile naming belongs to onboarding (ONB)
 * later, so we do not invent a personal name here.
 *
 * The Inbox comes with it (TASK-004 / ADR-029): it is the list `TaskStore.create`
 * defaults to, so a profile without one is a profile no task can be added to.
 * Migration 022 backfills every profile that predates this slice; this is the
 * same row for every profile created after it.
 */
function seedFirstRunProfile(database: NexusDatabase): void {
  const { count } = database.raw
    .prepare("SELECT count(*) AS count FROM profiles")
    .get() as { count: number };
  if (count > 0) return;
  const id = uuidv7();
  const now = new Date().toISOString();
  database.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "", now);
  new TaskListStore(database.raw, id).ensureInbox(now);
}

/**
 * `profiles:create` (ADR-058): the store mints the row, then main seeds what
 * the profile STARTS WITH — its Inbox (the `seedFirstRunProfile` precedent:
 * `TaskStore` refuses to place a task without one) and, for a business
 * profile, `businessProfileFlags` (`shared/modules.ts`). The seed order is deliberate: the Inbox
 * first, because a profile without one is broken while a profile without flag
 * rows merely runs on defaults.
 */
async function handleProfilesCreate(kind: ProfileKind, name: string): Promise<Profile> {
  const database = requireDb();
  const now = new Date().toISOString();
  const created = new ProfileStore(database.raw).create(kind, name, now);
  new TaskListStore(database.raw, created.id).ensureInbox(now);
  if (kind === "business") {
    const flags = new SqliteFlagStore(database.raw, created.id);
    for (const { moduleId, enabled } of businessProfileFlags(moduleRegistry)) {
      await flags.set(moduleId, enabled);
    }
  }
  return created;
}

/**
 * `profiles:create-demo`: the „Demo" profile, filled.
 *
 * **Why this is a handler and not a renderer loop.** Everything it writes is
 * already reachable through the ordinary channels — a renderer could make a
 * profile and then create every task, note and transaction one call at a time.
 * It would take thousands of round trips, it would be a second implementation
 * of the seeders, and it would drift from them the first time either changed.
 * Main already owns `seedDemoProfile`, because `--shots` and `--demo` need it.
 *
 * **What bounds it.** Exactly one demo profile per account, ever: a second call
 * is refused rather than being allowed to write another few hundred rows. The
 * test is the NAME, which is what a user sees and what they would rename or
 * delete if they wanted it gone — and either of those is a deliberate act that
 * legitimately re-opens the offer. There is nothing here for a compromised
 * renderer to widen: it writes into a NEW profile of the account it is already
 * inside, reads nothing, and cannot name what gets written.
 *
 * The seed is asynchronous and takes a moment; it runs at the end of first-run
 * onboarding, where the user has just pressed a button and is expecting a
 * pause, and never on a timer or at startup. (It awaits the blob store because
 * the profile's files are written into it — `seedDemoProfile`'s own doc.)
 *
 * It does NOT set the profile's private section up, and that asymmetry with
 * `fillDemoProfile` is the honest one: PRIV's setup wraps under the account
 * passcode, which main holds no copy of — it verifies one and keeps none — so
 * there is nothing here to derive a wrap from. The user sets it up themselves,
 * with a credential only they have, which is the same flow everybody else gets.
 */
async function handleProfilesCreateDemo(): Promise<Profile> {
  const database = requireDb();
  if (listProfiles(database).some((profile) => profile.name === DEMO_PROFILE_NAME)) {
    throw new Error("Invalid IPC payload: this account already has a demo profile.");
  }
  const now = Date.now();
  const created = new ProfileStore(database.raw).create(
    "personal",
    DEMO_PROFILE_NAME,
    new Date(now).toISOString(),
  );
  await seedDemoProfile(database.raw, created.id, now, demoBlobSink());
  return created;
}

/**
 * `profiles:delete` (ADR-058): collects the blob hashes the profile's rows
 * name BEFORE the delete (afterwards there is no row left to ask), lets the
 * store's transaction take the row and its data, then runs the existing
 * refcount-gated orphan walk over exactly those hashes — `undoRestore`'s own
 * arrangement. A blob another profile still names keeps a non-zero refcount
 * and survives; everything only this profile named is unlinked from disk.
 */
async function handleProfilesDelete(id: string): Promise<void> {
  const database = requireDb();
  const store = new ProfileStore(database.raw);
  if (store.get(id) === null) {
    throw new Error("Invalid IPC payload: unknown profile id.");
  }
  const hashes = store.blobHashes(id);
  store.delete(id, new Date().toISOString());
  for (const sha256 of hashes) {
    await deleteBlobIfOrphaned(
      blobStorePathsFor(),
      requireBlobKeys(),
      sha256,
      blobRefCount(id, sha256),
    );
  }
}

/**
 * `profiles:verify-switch` (ADR-058): proves the account passcode against the
 * CURRENT unlocked session — the gate in front of switching into a profile.
 * `verifyPasscode` never touches the database and charges the SAME throttle
 * counter the lock screen uses (see its doc for why both halves matter). The
 * cleared-throttle notice is recorded exactly as the unlock's is (NTF-007):
 * a wrong-attempt burst at this gate is the same fact wherever it happened.
 */
async function handleProfilesVerifySwitch(passcode: string): Promise<AuthResult> {
  const sessionKeyHex = requireUnlockedDataKeyHex();
  try {
    const clearedThrottle = await verifyPasscode(activeAccountDir(), passcode, sessionKeyHex);
    if (clearedThrottle !== null) {
      recordSecurityNotice({
        kind: "unlock-throttle",
        at: new Date().toISOString(),
        ...clearedThrottle,
      });
    }
    return { ok: true };
  } catch (error) {
    return authResultFromError(error, activeAccountDir());
  }
}

/**
 * Build- and device-level facts only. Nothing here may reach for the active
 * account: the title bar calls this at mount to print the version, and on a
 * first run that is before any account exists — see `AppInfo` in shared/ipc.ts.
 */
function appInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    userDataPath: app.getPath("userData"),
    versions: {
      electron: process.versions.electron ?? "",
      chrome: process.versions.chrome ?? "",
      node: process.versions.node,
      v8: process.versions.v8,
    },
  };
}

// --- IPC (typed, allowlisted, validated) ------------------------------------
//
// SEC-EL-02: every payload is structurally revalidated before it reaches the DB,
// and every message must originate from our own window's web contents. Handlers
// throw on bad input, which rejects the renderer's promise — no partial writes.

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("IPC message rejected: unrecognized sender.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid IPC payload: expected an object.");
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid IPC payload: "${field}" must be a non-empty string.`);
  }
  return value;
}

/**
 * An IDENTIFIER off the wire — a row's own id, a foreign key, a registry key —
 * bounded on `MAX_ID_LENGTH`'s terms.
 *
 * **Every id here used to be a bare `asNonEmptyString`, which caps nothing.** An
 * id is the field nobody thinks of as untrusted input, so it got the check that
 * asks whether the string exists and nothing about what it is. The renderer IS
 * untrusted (SEC-EL), no id column in any migration carries a CHECK past
 * `NOT NULL`, and several handlers write a renderer-supplied key rather than
 * minting one — so the wire is the only bound those values ever meet.
 *
 * Same three questions as the archive reader's `idStr`, because it is the same
 * rule at the other boundary: non-empty, no outer whitespace (nothing in this
 * codebase mints an id with a space on either end, and trimming would forge a
 * key rather than refuse one), and inside `MAX_ID_LENGTH`. `check:ids` is what
 * keeps the next handler from reaching for `asNonEmptyString` again.
 */
function asId(value: unknown, field: string): string {
  const id = asNonEmptyString(value, field);
  if (id !== id.trim() || id.length > MAX_ID_LENGTH) {
    throw new Error(`Invalid IPC payload: "${field}" is not a well-formed id.`);
  }
  return id;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid IPC payload: "${field}" must be a boolean.`);
  }
  return value;
}

/** A plain string field that may be empty (structural check only; semantics stay in the store). */
function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  return value;
}

/**
 * A passcode field: a non-empty string capped at `MAX_PASSCODE_LENGTH`
 * (`@nexus/core/auth`) before it ever reaches Argon2id (SEC-EL-02) — the real
 * length/character-class policy (`validatePasscode`) is `main/auth.ts`'s job,
 * not this structural check's.
 */
function asPasscode(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PASSCODE_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a non-empty string of at most ${MAX_PASSCODE_LENGTH} characters.`,
    );
  }
  return value;
}

/** The formatted Recovery Kit code is 39 characters (32 + 7 dashes); 64 is generous headroom for stray whitespace, before `normalizeRecoveryCode` rejects anything that still isn't a valid code. */
const MAX_RECOVERY_CODE_LENGTH = 64;

/** A recovery-code field: a non-empty string capped at `MAX_RECOVERY_CODE_LENGTH`, before it ever reaches Argon2id (SEC-EL-02). */
function asRecoveryCodeInput(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_RECOVERY_CODE_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a non-empty string of at most ${MAX_RECOVERY_CODE_LENGTH} characters.`,
    );
  }
  return value;
}

/**
 * A binary field crossing the boundary over structured clone: must arrive as
 * a genuine, non-empty `Uint8Array` no larger than `maxBytes`. The size cap is
 * enforced here AND re-checked in the store (SEC-EL-02: renderer input is
 * untrusted, and the cap is the wire contract, not a UI courtesy).
 */
function asUint8Array(value: unknown, field: string, maxBytes: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error(`Invalid IPC payload: "${field}" must be a non-empty Uint8Array.`);
  }
  if (value.byteLength > maxBytes) {
    throw new Error(`Invalid IPC payload: "${field}" must not exceed ${maxBytes} bytes.`);
  }
  return value;
}

/**
 * A UTF-8 string field within a byte cap — the JSON-document payloads. The cap is
 * enforced here AND re-checked in the store (SEC-EL-02: renderer input is
 * untrusted, and the cap is the wire contract, not a UI courtesy).
 */
function asCappedString(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error(`Invalid IPC payload: "${field}" must not exceed ${maxBytes} bytes.`);
  }
  return value;
}

/**
 * The CHARACTER-counting sibling of `asCappedString`, for the caps a store
 * defines in characters rather than bytes.
 *
 * The distinction is not pedantry in this app: every Serbian letter carrying a
 * diacritic — š, č, ć, ž, đ — is two bytes in UTF-8, so a byte cap applied to a
 * character limit refuses legal input, and refuses it *only for text written in
 * the product's own language*. `CARD_TEXT_MAX_LENGTH` is documented as mirroring
 * `CardStore`'s cap, and that cap is 10 000 CHARACTERS (`trimmed.length`), so
 * byte-capping it made the wire stricter than the store it claims to mirror and
 * produced a „must not exceed 10000 bytes" refusal for a card the store would
 * have taken. Found while reviewing UTIL slice b, whose `asFocusLabel` had to
 * dodge the same trap.
 *
 * Rule: match the unit the STORE measures in. A cap named `_BYTES` keeps
 * `asCappedString`; a cap the store checks with `.length` comes here.
 */
function asCappedChars(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  if (value.length > maxChars) {
    throw new Error(`Invalid IPC payload: "${field}" must not exceed ${maxChars} characters.`);
  }
  return value;
}

/**
 * An array of non-empty strings, each capped at `maxItemLength`, the array
 * itself capped at `maxItems` (structural checks only; the store owns the
 * self-link/unknown-id/cross-profile filtering, NOTE-004).
 */
function asStringArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxItemLength: number,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be an array of at most ${maxItems} items.`,
    );
  }
  if (
    !value.every(
      (item) => typeof item === "string" && item.length > 0 && item.length <= maxItemLength,
    )
  ) {
    throw new Error(
      `Invalid IPC payload: "${field}" must contain only non-empty strings of at most ${maxItemLength} characters.`,
    );
  }
  return value as string[];
}

/**
 * Validates the renderer's generated-card array for `notes:cards-sync`
 * (SEC-EL-02). Structural checks only — `key` uniqueness and the semantics of
 * "new vs. reconciled vs. removed" stay in `CardStore.syncFromNote`'s own
 * reconcile; emptiness after trimming is likewise a domain rule the store
 * owns (the same division `noteTagsCreate` uses for tag names), so an empty
 * `front`/`back` is not rejected here.
 */
function asNoteCardSpecArray(value: unknown, field: string): NoteCardSpec[] {
  if (!Array.isArray(value) || value.length > NOTE_CARDS_MAX_COUNT) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be an array of at most ${NOTE_CARDS_MAX_COUNT} items.`,
    );
  }
  return value.map((entry, index) => {
    const spec = asRecord(entry);
    const key = spec.key;
    if (typeof key !== "string" || key.length === 0 || key.length > NOTE_CARD_KEY_MAX_LENGTH) {
      throw new Error(
        `Invalid IPC payload: "${field}[${index}].key" must be a non-empty string of at most ${NOTE_CARD_KEY_MAX_LENGTH} characters.`,
      );
    }
    return {
      key,
      front: asCappedChars(spec.front, `${field}[${index}].front`, CARD_TEXT_MAX_LENGTH),
      back: asCappedChars(spec.back, `${field}[${index}].back`, CARD_TEXT_MAX_LENGTH),
      // Structural again: the pair rule and "this ordinal is in this template"
      // are `CardStore`'s to enforce, exactly as `key` uniqueness is.
      kind: asCardKind(spec.kind, `${field}[${index}].kind`),
      clozeText:
        spec.clozeText === null
          ? null
          : asCappedChars(spec.clozeText, `${field}[${index}].clozeText`, CARD_TEXT_MAX_LENGTH),
      clozeOrdinal:
        spec.clozeOrdinal === null
          ? null
          : asInteger(spec.clozeOrdinal, `${field}[${index}].clozeOrdinal`),
    };
  });
}

/** The app menu's „Prikaz" vocabulary — the whole of `window:view`'s payload, so an unknown command reaches no window API at all. */
function asWindowViewCommand(value: unknown, field: string): WindowViewCommand {
  if (typeof value === "string" && (WINDOW_VIEW_COMMANDS as readonly string[]).includes(value)) {
    return value as WindowViewCommand;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid window view command.`);
}

/**
 * A `feature_flags` key the renderer is allowed to write: a registered,
 * unlockable module id, or `pack:<id>` for a pack in `TOOL_PACKS`.
 *
 * **This channel used to take any non-empty string**, and the table it writes to
 * has no constraint of its own — it is a generic per-profile key→boolean store,
 * which is exactly what made it the right home for packs and exactly why it
 * needed a gate. Without one, a compromised renderer could fill a profile's flag
 * table with rows nothing ever reads and nothing ever cleans up; more mundanely,
 * one typo in a caller writes `pack:softwer` and the pack silently never turns
 * on, with the row sitting in the file looking like an answer.
 *
 * SEC-EL's rule is that the store re-validates semantics, and „is this the name
 * of something that exists" is the whole semantics of this payload. A closed
 * domain checked here turns both of those into an error at the boundary.
 *
 * LOCKED modules are refused too, and that is not extra strictness: `dashboard`
 * and `settings` cannot be switched off anywhere in the UI (`LOCKED_MODULE_IDS`,
 * SET-007), so a row for one is a stored fact no surface can act on and no
 * surface should be able to create.
 */
function asFlagKey(value: unknown): string {
  if (typeof value === "string") {
    const pack = value.startsWith("pack:") ? value.slice("pack:".length) : null;
    if (pack !== null && (TOOL_PACKS as readonly string[]).includes(pack)) {
      return value;
    }
    if (pack === null && moduleRegistry.get(value) != null && !LOCKED_MODULE_IDS.has(value)) {
      return value;
    }
  }
  throw new Error(`Invalid IPC payload: "moduleId" is not a settable module or pack.`);
}

/** The closed card-kind domain (ADR-042); anything else is rejected before it reaches the store. */
function asCardKind(value: unknown, field: string): CardKind {
  if (typeof value === "string" && (CARD_KINDS as readonly string[]).includes(value)) {
    return value as CardKind;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid card kind.`);
}

/** Account label (ADR-044): the same shape rule as a profile name — string, 1–80 chars after trimming, trimmed value stored. `main/accounts.ts` re-checks it before it ever reaches the registry. */
function asAccountLabel(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_ACCOUNT_LABEL_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be 1-${MAX_ACCOUNT_LABEL_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/**
 * An account id the registry actually knows. Membership is the check that
 * matters, not the string's shape: this value becomes a directory name, and
 * only ids the registry itself wrote are ever turned into one — a renderer can
 * name no path main did not already create.
 */
function asAccountId(value: unknown, field: string): string {
  const id = asId(value, field);
  if (!accountExists(userDataDir(), id)) {
    throw new Error(`Invalid IPC payload: "${field}" is not a known account id.`);
  }
  return id;
}

/** Profile display name: string, 1–80 chars after trimming; the trimmed value is stored. */
function asProfileName(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be 1-80 characters after trimming.`,
    );
  }
  return trimmed;
}

/** A profile kind: one of migration 001's CHECK domain (ADR-058). The store re-validates; this is the wire's own gate. */
function asProfileKind(value: unknown, field: string): ProfileKind {
  for (const kind of PROFILE_KINDS) {
    if (kind === value) return kind;
  }
  throw new Error(`Invalid IPC payload: "${field}" must be a profile kind.`);
}

/** `profiles:create`'s name: the EMPTY string is allowed — the deliberate ONB-lite "not yet named" sentinel — otherwise exactly `asProfileName`'s 1–80 rule. */
function asProfileCreateName(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  if (value.trim().length === 0) return "";
  return asProfileName(value, field);
}

/** A nullable optional string field: either a string or an explicit null. */
function asNullableString(value: unknown, field: string): string | null {
  if (value === null || typeof value === "string") return value;
  throw new Error(`Invalid IPC payload: "${field}" must be a string or null.`);
}

/**
 * An optional id: `null`, or an {@link asId}. An empty string is a bug on the
 * wire, never "no id" — that is what `null` says.
 */
function asNullableId(value: unknown, field: string): string | null {
  if (value === null) return null;
  return asId(value, field);
}

/**
 * `imex:export`'s passphrase field (ADR-022): `null` for the explicitly-
 * confirmed plaintext export, otherwise a string that must itself pass
 * `validateArchivePassphrase` — the renderer's own form validation is UX only,
 * never trusted here.
 */
function asArchivePassphrase(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || validateArchivePassphrase(value) !== null) {
    throw new Error(`Invalid IPC payload: "${field}" must be null or a valid archive passphrase.`);
  }
  return value;
}

/**
 * `backup:set-passphrase`'s field (ADR-056): the manual export's passphrase
 * policy verbatim — same `validateArchivePassphrase`, same 12-character floor —
 * but never null, because this surface has no plaintext branch to mean by it:
 * SEC-DAR-02 allows plaintext only behind a per-export confirmation a schedule
 * cannot give.
 */
function asBackupPassphrase(value: unknown, field: string): string {
  if (typeof value !== "string" || validateArchivePassphrase(value) !== null) {
    throw new Error(`Invalid IPC payload: "${field}" must be a valid archive passphrase.`);
  }
  return value;
}

/** `backup:set-settings`' cadence — the closed two-value domain migration 044's CHECK also holds. */
function asBackupCadence(value: unknown, field: string): BackupCadence {
  if (typeof value === "string" && (BACKUP_CADENCES as readonly string[]).includes(value)) {
    return value as BackupCadence;
  }
  throw new Error(`Invalid IPC payload: "${field}" must be "daily" or "weekly".`);
}

/** `backup:set-settings`' keep-last — the store's whole 2..50 range, not just the card's curated choices (the select is UX, never the gate). */
function asBackupKeepLast(value: unknown, field: string): number {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_BACKUP_KEEP_LAST &&
    value <= MAX_BACKUP_KEEP_LAST
  ) {
    return value;
  }
  throw new Error(
    `Invalid IPC payload: "${field}" must be a whole number between ${MIN_BACKUP_KEEP_LAST} and ${MAX_BACKUP_KEEP_LAST}.`,
  );
}

/** `priv:set-lock-prefs`' minutes — the store's whole 1..60 range (migration 045's CHECK), mirrored at the wire (SEC-EL-02). */
function asPrivAutoLockMinutes(value: unknown, field: string): number {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_PRIV_AUTO_LOCK_MINUTES &&
    value <= MAX_PRIV_AUTO_LOCK_MINUTES
  ) {
    return value;
  }
  throw new Error(
    `Invalid IPC payload: "${field}" must be a whole number between ${MIN_PRIV_AUTO_LOCK_MINUTES} and ${MAX_PRIV_AUTO_LOCK_MINUTES}.`,
  );
}

/**
 * One private attachment reference, rebuilt field by field (SEC-EL-02). The
 * id must be exactly the UUID shape main itself mints — it names a file under
 * `private-blobs` AND is the container's AAD, so an arbitrary string here
 * would be a path component the renderer chose.
 */
function asPrivAttachmentRef(value: unknown, field: string): PrivAttachmentRef {
  const body = asRecord(value);
  const id = asId(body.id, `${field}.id`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new Error(`Invalid IPC payload: "${field}.id" is not a private attachment id.`);
  }
  const fileName = asNonEmptyString(body.fileName, `${field}.fileName`);
  const mime = asNonEmptyString(body.mime, `${field}.mime`);
  if (fileName.length > 255 || mime.length > 255) {
    throw new Error(`Invalid IPC payload: "${field}" carries an over-long fileName or mime.`);
  }
  const sizeBytes = body.sizeBytes;
  if (
    typeof sizeBytes !== "number" ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes < 1 ||
    sizeBytes > PRIV_ATTACHMENT_MAX_BYTES
  ) {
    throw new Error(
      `Invalid IPC payload: "${field}.sizeBytes" must be a whole number of 1..${PRIV_ATTACHMENT_MAX_BYTES} bytes.`,
    );
  }
  return { id, fileName, mime, sizeBytes };
}

/**
 * `priv:write`'s envelope, rebuilt field by field (SEC-EL-02): three capped
 * text fields plus up to `PRIV_ATTACHMENTS_MAX_COUNT` attachment references,
 * each re-validated — the reference list is renderer-authored content exactly
 * like the note's text, and the id shape is the load-bearing check (see
 * `asPrivAttachmentRef`).
 */
function asPrivEnvelope(value: unknown, field: string): PrivNoteEnvelopePayload {
  const body = asRecord(value);
  const title = asCappedString(body.title, `${field}.title`, PRIV_TITLE_MAX_BYTES);
  const yjsState = asCappedString(body.yjsState, `${field}.yjsState`, PRIV_STATE_MAX_BYTES);
  const plaintext = asCappedString(body.plaintext, `${field}.plaintext`, PRIV_PLAINTEXT_MAX_BYTES);
  if (!Array.isArray(body.attachments) || body.attachments.length > PRIV_ATTACHMENTS_MAX_COUNT) {
    throw new Error(
      `Invalid IPC payload: "${field}.attachments" must be an array of at most ${PRIV_ATTACHMENTS_MAX_COUNT} references.`,
    );
  }
  const attachments = body.attachments.map((entry, index) =>
    asPrivAttachmentRef(entry, `${field}.attachments[${index}]`),
  );
  return { title, yjsState, plaintext, attachments };
}

/**
 * `imex:export`'s module subset (IMEX-003): `undefined` for the whole-profile
 * export, otherwise a non-empty array of `ARCHIVE_MODULE_IDS` members. Returned
 * as a `Set`, which is both what `buildExportArchive` takes and what makes a
 * repeated id harmless.
 *
 * Empty is REFUSED rather than read as "everything" (SEC-EL-02: the renderer's
 * own disabled button is UX, never the gate): an archive of no modules is not
 * something a user can have meant, and silently turning it into an archive of
 * ALL of them would answer a request with its opposite.
 */
function asArchiveModules(
  value: unknown,
  field: string,
): ReadonlySet<ArchiveModuleId> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > ARCHIVE_MODULE_IDS.length) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be an array of 1-${ARCHIVE_MODULE_IDS.length} archive module ids.`,
    );
  }
  const modules = new Set<ArchiveModuleId>();
  for (const item of value) {
    if (typeof item !== "string" || !(ARCHIVE_MODULE_IDS as readonly string[]).includes(item)) {
      throw new Error(`Invalid IPC payload: "${field}" contains an unknown archive module id.`);
    }
    modules.add(item as ArchiveModuleId);
  }
  return modules;
}

/**
 * `imex:restore-preview`'s passphrase field (ADR-023): `null` for a plain
 * `.nexus.zip`, otherwise a non-empty string capped at
 * `MAX_ARCHIVE_PASSPHRASE_LENGTH`. Deliberately NOT held to
 * `validateArchivePassphrase` the way `asArchivePassphrase` above is: that one
 * guards what we WRITE — we refuse to seal an archive under a weak passphrase
 * — while this one is only an attempt at a file that already exists. The file
 * on disk is the authority on what opens it, so an archive written under an
 * older, laxer policy must stay openable, and a wrong guess simply fails AEAD
 * authentication. The cap is the SEC-EL-02 half, mirroring `asPasscode`: it
 * bounds what can ever reach Argon2id.
 */
function asRestorePassphrase(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ARCHIVE_PASSPHRASE_LENGTH
  ) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be null or a non-empty string of at most ${MAX_ARCHIVE_PASSPHRASE_LENGTH} characters.`,
    );
  }
  return value;
}

/** A restore token is 32 hex characters (`randomBytes(16)`, `main/restore.ts`); 64 is headroom, and the point is only that an opaque value echoed back by the renderer can never grow unbounded. */
const MAX_RESTORE_TOKEN_LENGTH = 64;

/** `imex:restore-apply`'s token field: a non-empty string within `MAX_RESTORE_TOKEN_LENGTH`. Whether it is the CURRENT preview's token is `applyRestore`'s call, not this structural check's — the same division `asRecoveryCodeInput` follows. */
/**
 * `imex:import-replan`'s duplicate choices (ADR-051). Validated against the
 * CLOSED `IMPORT_DUPLICATE_TYPES` domain on both axes — an unknown group name
 * and an unknown answer are each refused by name — and rebuilt into a fresh
 * object rather than passed through, so nothing the renderer put on that value
 * (an extra key, a prototype, a getter) ever reaches the planner. Absent keys
 * stay absent: the planner reads an unanswered group as `"skip"`, which is the
 * safe direction, and an empty object is a perfectly legitimate payload.
 */
function asImportDuplicateChoices(value: unknown, field: string): ImportDuplicateChoices {
  const body = asRecord(value);
  const choices: ImportDuplicateChoices = {};
  for (const key of Object.keys(body)) {
    if (!(IMPORT_DUPLICATE_TYPES as readonly string[]).includes(key)) {
      throw new Error(`Invalid IPC payload: "${field}" names an unknown duplicate group.`);
    }
    const answer = body[key];
    if (answer !== "skip" && answer !== "import") {
      throw new Error(`Invalid IPC payload: "${field}.${key}" must be "skip" or "import".`);
    }
    choices[key as ImportDuplicateType] = answer;
  }
  return choices;
}

/**
 * `imex:import-apkg-preview`'s subject choice (ADR-052). Structurally validated
 * here — EXACTLY one of the two fields non-null, and a new name within the same
 * ceiling the subject form itself is held to — and semantically validated in
 * `restore.ts`, which is where the profile's live subjects can be asked whether
 * the named one actually exists. The same division `asRestoreToken` follows.
 *
 * "Exactly one" is checked rather than "at least one" on purpose: a payload
 * carrying both would leave the decision to whichever branch happened to be
 * read first, which is not a decision anybody made.
 */
function asApkgSubjectChoice(value: unknown, field: string): ApkgImportSubjectChoice {
  const body = asRecord(value);
  const existingSubjectId = asNullableId(body.existingSubjectId, `${field}.existingSubjectId`);
  const newSubjectName = asNullableString(body.newSubjectName, `${field}.newSubjectName`);
  if ((existingSubjectId === null) === (newSubjectName === null)) {
    throw new Error(
      `Invalid IPC payload: "${field}" must name exactly one of an existing subject or a new subject name.`,
    );
  }
  if (newSubjectName !== null) {
    const trimmed = newSubjectName.trim();
    if (trimmed.length === 0 || trimmed.length > APKG_IMPORT_MAX_SUBJECT_NAME_LENGTH) {
      throw new Error(
        `Invalid IPC payload: "${field}.newSubjectName" must be 1..${APKG_IMPORT_MAX_SUBJECT_NAME_LENGTH} characters.`,
      );
    }
  }
  return { existingSubjectId, newSubjectName };
}

/** `imex:import-csv-preview`'s delimiter override (ADR-062): null lets the sniff decide; anything else must be one of the two delimiters the reader knows. */
function asCsvImportDelimiter(value: unknown, field: string): CsvImportDelimiter | null {
  if (value === null || value === "," || value === ";") return value;
  throw new Error(`Invalid IPC payload: "${field}" must be ",", ";" or null.`);
}

/** The header override, on the same terms: null lets the sniff decide. */
function asCsvImportHeaderFlag(value: unknown, field: string): boolean | null {
  if (value === null || typeof value === "boolean") return value;
  throw new Error(`Invalid IPC payload: "${field}" must be a boolean or null.`);
}

/**
 * `imex:import-csv-map`'s role array (ADR-062): one role per column, each from
 * the closed vocabulary, exactly one of them `"title"`, and no other non-ignore
 * role repeated — a mapping that named a role twice would leave the decision to
 * whichever column happened to be read first, which is not a decision anybody
 * made. Length is bounded here by the same cap the preview refuses files over;
 * whether it matches the SESSION's column count is `restore.ts`'s check, since
 * only the session knows the parse.
 */
function asCsvImportRoles(value: unknown, field: string): CsvImportColumnRole[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > CSV_IMPORT_MAX_COLUMNS) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be an array of 1..${CSV_IMPORT_MAX_COLUMNS} roles.`,
    );
  }
  const seen = new Set<CsvImportColumnRole>();
  const roles = value.map((entry, index) => {
    const role = CSV_IMPORT_COLUMN_ROLES.find((candidate) => candidate === entry);
    if (role === undefined) {
      throw new Error(`Invalid IPC payload: "${field}[${index}]" is not a column role.`);
    }
    if (role !== "ignore") {
      if (seen.has(role)) {
        throw new Error(`Invalid IPC payload: "${field}" names the role "${role}" twice.`);
      }
      seen.add(role);
    }
    return role;
  });
  if (!seen.has("title")) {
    throw new Error(`Invalid IPC payload: "${field}" must map exactly one column to "title".`);
  }
  return roles;
}

/**
 * `imex:import-csv-map`'s destination list (ADR-062) — `asApkgSubjectChoice`'s
 * twin, one module over: EXACTLY one of the two fields non-null, and a new name
 * within the ceiling the list form itself is held to. Whether the named list
 * actually exists is `restore.ts`'s to prove against the live stores.
 */
function asCsvImportListChoice(value: unknown, field: string): CsvImportListChoice {
  const body = asRecord(value);
  const existingListId = asNullableId(body.existingListId, `${field}.existingListId`);
  const newListName = asNullableString(body.newListName, `${field}.newListName`);
  if ((existingListId === null) === (newListName === null)) {
    throw new Error(
      `Invalid IPC payload: "${field}" must name exactly one of an existing list or a new list name.`,
    );
  }
  if (newListName !== null) {
    const trimmed = newListName.trim();
    if (trimmed.length === 0 || trimmed.length > CSV_IMPORT_MAX_LIST_NAME_LENGTH) {
      throw new Error(
        `Invalid IPC payload: "${field}.newListName" must be 1..${CSV_IMPORT_MAX_LIST_NAME_LENGTH} characters.`,
      );
    }
  }
  return { existingListId, newListName };
}

/**
 * `imex:import-fin-csv-map`'s role array (FIN slice e) — `asCsvImportRoles`'
 * twin over the statement vocabulary, minus its required-role check: what a
 * statement's mapping must contain is a DATE column plus EITHER one signed
 * amount column OR an outflow/inflow pair, and that rule involves three roles at
 * once, so it is `translateCsvFinance`'s to state once rather than this edge's to
 * restate. What is checked here is the wire's own business: a closed vocabulary,
 * a bounded length, and no non-ignore role twice — a mapping that named a role
 * twice would leave the decision to whichever column happened to be read first,
 * which is not a decision anybody made.
 */
function asFinCsvImportRoles(value: unknown, field: string): FinCsvImportColumnRole[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > CSV_IMPORT_MAX_COLUMNS) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be an array of 1..${CSV_IMPORT_MAX_COLUMNS} roles.`,
    );
  }
  const seen = new Set<FinCsvImportColumnRole>();
  return value.map((entry, index) => {
    const role = FIN_CSV_IMPORT_COLUMN_ROLES.find((candidate) => candidate === entry);
    if (role === undefined) {
      throw new Error(`Invalid IPC payload: "${field}[${index}]" is not a column role.`);
    }
    if (role !== "ignore") {
      if (seen.has(role)) {
        throw new Error(`Invalid IPC payload: "${field}" names the role "${role}" twice.`);
      }
      seen.add(role);
    }
    return role;
  });
}

/** `imex:import-fin-csv-map`'s sign convention (FIN slice e): the closed pair the mapping dialog offers, so nothing but one of two values can decide which way somebody's money points. */
function asFinCsvImportSignConvention(
  value: unknown,
  field: string,
): FinCsvImportSignConvention {
  const convention = FIN_CSV_IMPORT_SIGN_CONVENTIONS.find((candidate) => candidate === value);
  if (convention === undefined) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be one of ${FIN_CSV_IMPORT_SIGN_CONVENTIONS.join(", ")}.`,
    );
  }
  return convention;
}

/**
 * `imex:import-llm-preview`'s kind (IMEX-005) — the closed domain the renderer's
 * own picker offers, checked here so nothing but one of three values ever
 * reaches the parser.
 */
function asLlmImportKind(value: unknown, field: string): LlmImportKind {
  const kind = LLM_IMPORT_KINDS.find((candidate) => candidate === value);
  if (kind === undefined) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be one of ${LLM_IMPORT_KINDS.join(", ")}.`,
    );
  }
  return kind;
}

/**
 * The pasted chat answer. Bounded at the EDGE rather than only inside the
 * parser: the renderer is untrusted (SEC-EL-02), and refusing a megabyte before
 * it is scanned for braces costs nothing. Emptiness is deliberately NOT refused
 * here — `parseLlmAnswer` answers that with a named status the screen has copy
 * for, and a thrown error would be a worse sentence for the same fact.
 */
function asLlmAnswerText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > LLM_IMPORT_MAX_ANSWER_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a string of at most ${LLM_IMPORT_MAX_ANSWER_LENGTH} characters.`,
    );
  }
  return value;
}

/**
 * `imex:import-llm-preview`'s deck choice (IMEX-005) — `asApkgSubjectChoice`'s
 * twin, with the null arm the `.apkg` has no use for: only a card import needs
 * a deck at all. Structurally validated here — EXACTLY one of the two arms, a
 * new name within the same ceiling the deck store itself enforces, and a
 * subject named exactly when a deck is being created — and semantically
 * validated in `restore.ts`, which is where the profile's live decks and
 * subjects can be asked whether the named rows actually exist.
 */
function asLlmDeckChoice(value: unknown, field: string): LlmImportDeckChoice | null {
  if (value === null) return null;
  const body = asRecord(value);
  const existingDeckId = asNullableId(body.existingDeckId, `${field}.existingDeckId`);
  const newDeckName = asNullableString(body.newDeckName, `${field}.newDeckName`);
  const subjectId = asNullableId(body.subjectId, `${field}.subjectId`);
  if ((existingDeckId === null) === (newDeckName === null)) {
    throw new Error(
      `Invalid IPC payload: "${field}" must name exactly one of an existing deck or a new deck name.`,
    );
  }
  if (existingDeckId !== null) {
    if (subjectId !== null) {
      throw new Error(
        `Invalid IPC payload: "${field}.subjectId" belongs to a new deck, not an existing one.`,
      );
    }
    return { existingDeckId };
  }
  const trimmed = (newDeckName ?? "").trim();
  if (trimmed.length === 0 || trimmed.length > LLM_IMPORT_MAX_DECK_NAME_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}.newDeckName" must be 1..${LLM_IMPORT_MAX_DECK_NAME_LENGTH} characters.`,
    );
  }
  if (subjectId === null) {
    throw new Error(`Invalid IPC payload: "${field}.subjectId" must name the new deck's subject.`);
  }
  return { newDeckName: trimmed, subjectId };
}

function asRestoreToken(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_RESTORE_TOKEN_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a non-empty string of at most ${MAX_RESTORE_TOKEN_LENGTH} characters.`,
    );
  }
  return value;
}

/**
 * A recurrence rule field (ADR-024): `null` is "no rule" (and, on a patch,
 * clears one), anything else must satisfy `validateRecurrenceRule`. What is
 * passed on is the CANONICAL rule the validator rebuilds — never the
 * renderer's own object, which is untrusted (SEC-EL-02) and may carry a
 * different member order or a duplicated weekday. The canonical form is the
 * only one whose serialization describes what the engine will actually do, so
 * it is the only form the stores should ever see.
 */
function asRecurrenceRule(value: unknown, field: string): RecurrenceRule | null {
  if (value === null) return null;
  const rule = validateRecurrenceRule(value);
  if (rule === null) {
    throw new Error(`Invalid IPC payload: "${field}" must be null or a valid recurrence rule.`);
  }
  return rule;
}

/** A bare "YYYY-MM-DD" day field: a real calendar day, so `2026-02-30` is rejected rather than silently rolled into March. */
function asBareDate(value: unknown, field: string): string {
  const date = asNonEmptyString(value, field);
  if (!isValidDayKey(date)) {
    throw new Error(`Invalid IPC payload: "${field}" must be a "YYYY-MM-DD" calendar day.`);
  }
  return date;
}

function asTaskStatus(value: unknown, field: string): TaskStatus {
  if (typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value)) {
    return value as TaskStatus;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid task status.`);
}

function asTaskPriority(value: unknown, field: string): TaskPriority {
  if (typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value)) {
    return value as TaskPriority;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid task priority.`);
}

/**
 * A task's reminder ladder (ADR-028): whole DAYS of lead time, unique, within
 * the store's own caps — which are imported from it rather than respelled here,
 * so there is exactly one number to change. Days, not the minutes
 * `asEventReminderOffsets` below speaks: a task's deadline is a day, so its
 * ladder is the DOCUMENT model. Structural checks only; `TaskStore`
 * re-canonicalizes (sorts, revalidates, refuses a ladder with no bare-date due
 * date to count back from) whatever it is handed.
 */
function asTaskReminderOffsets(value: unknown, field: string): number[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_TASK_REMINDERS ||
    !value.every(
      (n) =>
        typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_TASK_REMINDER_DAYS,
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(
      `Invalid IPC payload: "${field}" must hold at most ${MAX_TASK_REMINDERS} distinct whole days between 0 and ${MAX_TASK_REMINDER_DAYS}.`,
    );
  }
  return value as number[];
}

/**
 * A batch action's id list (ADR-038): an array of non-empty id-shaped strings,
 * capped at the store's own `MAX_TASK_BULK_IDS` — imported, never respelled, so
 * there is exactly one number to change. Emptiness, duplicates and whether the
 * ids name anything are `TaskStore`'s to judge; this is the structural half.
 * The 64-character per-id bound is `notesLinksSet`'s, for the same reason: an
 * id is a uuidv7, and nothing longer needs to reach a prepared statement.
 */
function asTaskIdArray(value: unknown, field: string): string[] {
  return asStringArray(value, field, MAX_TASK_BULK_IDS, 64);
}

/** Validates a `NewTaskFields` payload into a store input; only present keys are carried. */
function asNewTaskInput(value: unknown): CreateTaskInput {
  const task = asRecord(value);
  const input: CreateTaskInput = { title: asNonEmptyString(task.title, "task.title") };
  if (task.description !== undefined) {
    input.description = asNullableString(task.description, "task.description");
  }
  if (task.status !== undefined) input.status = asTaskStatus(task.status, "task.status");
  if (task.priority !== undefined) input.priority = asTaskPriority(task.priority, "task.priority");
  if (task.dueDate !== undefined) input.dueDate = asNullableString(task.dueDate, "task.dueDate");
  if (task.startDate !== undefined) {
    input.startDate = asNullableString(task.startDate, "task.startDate");
  }
  if (task.parentId !== undefined) input.parentId = asNullableId(task.parentId, "task.parentId");
  if (task.recurrence !== undefined) {
    input.recurrence = asRecurrenceRule(task.recurrence, "task.recurrence");
  }
  if (task.reminderOffsets !== undefined) {
    input.reminderOffsets = asTaskReminderOffsets(task.reminderOffsets, "task.reminderOffsets");
  }
  // Placement (TASK-004): structural checks only — that the list is this
  // profile's, that the section belongs to that list, and that a subtask
  // inherits its parent's placement instead are all `TaskStore.create`'s rules.
  if (task.listId !== undefined) input.listId = asId(task.listId, "task.listId");
  if (task.sectionId !== undefined) {
    input.sectionId = asNullableId(task.sectionId, "task.sectionId");
  }
  return input;
}

/**
 * A list or section name (ADR-029): a string that is non-empty and within
 * `MAX_TASK_LIST_NAME_LENGTH` after trimming — the cap imported from the store
 * rather than respelled here, so there is exactly one number to change. The
 * TRIMMED value is what travels on, mirroring `asProfileName`; `TaskListStore`
 * trims and re-checks it regardless (SEC-EL-02).
 */
function asTaskListName(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TASK_LIST_NAME_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be 1-${MAX_TASK_LIST_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/**
 * A task-tag name (migration 023): `asTaskListName`'s rule with the tag cap —
 * non-empty and within `MAX_TASK_TAG_NAME_LENGTH` after trimming, the TRIMMED
 * value travelling on. The cap comes from the wire contract (which mirrors
 * `@nexus/db`'s constant of the same name); `TaskTagStore` trims and re-checks
 * regardless, and stays authoritative (SEC-EL-02).
 */
function asTaskTagName(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TASK_TAG_NAME_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be 1-${MAX_TASK_TAG_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/**
 * A task-template name (ADR-035): `asTaskListName`'s rule with the template cap
 * — non-empty and within `MAX_TASK_TEMPLATE_NAME_LENGTH` after trimming, the
 * TRIMMED value travelling on. `TaskTemplateStore` trims and re-checks
 * regardless, and stays authoritative (SEC-EL-02).
 *
 * This is the ONLY template field that ever crosses the wire: a template's
 * payload is read out of the database by `captureTaskTemplatePayload` below, so
 * there is no renderer-supplied task shape here to validate.
 */
function asTaskTemplateName(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TASK_TEMPLATE_NAME_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be 1-${MAX_TASK_TEMPLATE_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/**
 * An event-template name (CAL-009): `asTaskTemplateName`'s rule against the CAL
 * module's own cap. `EventTemplateStore` trims and re-checks regardless, and
 * stays authoritative (SEC-EL-02).
 *
 * This and a day key are the ONLY template fields that ever cross the wire: a
 * template's payload is derived from a stored event by
 * `EventTemplateStore.captureFromEvent`, so there is no renderer-supplied event
 * shape here to validate — the same arrangement ADR-035 chose for tasks.
 */
function asEventTemplateName(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EVENT_TEMPLATE_NAME_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be 1-${MAX_EVENT_TEMPLATE_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/** Which shape a list opens in (TASK-005), checked against the store's own closed domain. */
function asTaskListView(value: unknown, field: string): TaskListView {
  if (typeof value === "string" && (TASK_LIST_VIEWS as readonly string[]).includes(value)) {
    return value as TaskListView;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid task list view.`);
}

/**
 * What a list remembers about its views (ADR-050), checked against the very
 * grammar the store writes through — `validateTaskViewConfig` returns null for
 * anything that is not a config, and `null`/absent is the honest "clear it".
 * Rejected HERE as well as in the store, so a hostile renderer's shape never
 * reaches a JSON column that has no CHECK behind it.
 */
function asTaskViewConfig(value: unknown, field: string): TaskViewConfig | null {
  if (value === undefined || value === null) return null;
  const config = validateTaskViewConfig(value);
  if (config === null) {
    throw new Error(`Invalid IPC payload: "${field}" is not a valid task view configuration.`);
  }
  return config;
}

/**
 * What deleting a list does with its tasks. Required and explicit: the two
 * modes lose different things, so an absent or unrecognized one is a rejection
 * rather than a default — there is no answer this handler may pick for the user.
 */
function asDeleteListMode(value: unknown, field: string): DeleteListMode {
  if (value === "move-to-inbox" || value === "delete-tasks") return value;
  throw new Error(
    `Invalid IPC payload: "${field}" must be "move-to-inbox" or "delete-tasks".`,
  );
}

/** Which attachment table a `doc:*` request resolves against (ADR-064) — the closed three-member union; PRIV attachments are deliberately not a member (the recorded v1 limit). */
function asDocAttachmentModule(value: unknown, field: string): DocAttachmentModule {
  if (value === "note" || value === "task" || value === "subject") return value;
  throw new Error(`Invalid IPC payload: "${field}" must be "note", "task" or "subject".`);
}

/** One of `DOC_MIME_FAMILIES`, or `null` for „no family filter" — the browse bar's own vocabulary, checked against the wire's closed list. */
function asDocMimeFamily(value: unknown, field: string): DocMimeFamily | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && (DOC_MIME_FAMILIES as readonly string[]).includes(value)) {
    return value as DocMimeFamily;
  }
  throw new Error(
    `Invalid IPC payload: "${field}" must be one of ${DOC_MIME_FAMILIES.join(", ")} or null.`,
  );
}

/**
 * „Datoteke"'s filter, field by field. Each of the three is optional on the
 * wire but explicit here: an absent owner kind means "every surface", never
 * "whichever one main felt like", and the query is a plain string this side
 * only length-checks — the folding and the refusal past
 * `MAX_ATTACHMENT_QUERY_LENGTH` are the store's, which is where the same rule
 * protects every other caller too.
 */
function asDocAttachmentFilter(value: unknown): AttachmentIndexFilter {
  const filter = asRecord(value);
  return {
    ownerKind:
      filter.ownerKind === undefined || filter.ownerKind === null
        ? null
        : asDocAttachmentModule(filter.ownerKind, "filter.ownerKind"),
    family: asDocMimeFamily(filter.family, "filter.family"),
    query: filter.query === undefined || filter.query === null
      ? null
      : asString(filter.query, "filter.query"),
  };
}

/** Validates a `TaskFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asTaskFieldChanges(value: unknown): UpdateTaskFields {
  const changes = asRecord(value);
  const patch: UpdateTaskFields = {};
  if (changes.title !== undefined) patch.title = asNonEmptyString(changes.title, "changes.title");
  if (changes.description !== undefined) {
    patch.description = asNullableString(changes.description, "changes.description");
  }
  if (changes.status !== undefined) patch.status = asTaskStatus(changes.status, "changes.status");
  if (changes.priority !== undefined) {
    patch.priority = asTaskPriority(changes.priority, "changes.priority");
  }
  if (changes.dueDate !== undefined) {
    patch.dueDate = asNullableString(changes.dueDate, "changes.dueDate");
  }
  if (changes.startDate !== undefined) {
    patch.startDate = asNullableString(changes.startDate, "changes.startDate");
  }
  if (changes.recurrence !== undefined) {
    patch.recurrence = asRecurrenceRule(changes.recurrence, "changes.recurrence");
  }
  if (changes.reminderOffsets !== undefined) {
    patch.reminderOffsets = asTaskReminderOffsets(
      changes.reminderOffsets,
      "changes.reminderOffsets",
    );
  }
  return patch;
}

/**
 * An event's reminder ladder (CAL-006): whole minutes of lead time, unique,
 * within the store's own caps — which are imported from it rather than
 * respelled here, so there is exactly one number to change. Distinct from
 * `asReminderOffsets` below, which is the DOCUMENT ladder: whole days, and
 * uncapped. Structural checks only; `EventStore` re-canonicalizes (sorts,
 * revalidates) whatever it is handed.
 */
function asEventReminderOffsets(value: unknown, field: string): number[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_EVENT_REMINDERS ||
    !value.every(
      (n) =>
        typeof n === "number" &&
        Number.isInteger(n) &&
        n >= 0 &&
        n <= MAX_EVENT_REMINDER_MINUTES,
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(
      `Invalid IPC payload: "${field}" must hold at most ${MAX_EVENT_REMINDERS} distinct whole minutes between 0 and ${MAX_EVENT_REMINDER_MINUTES}.`,
    );
  }
  return value as number[];
}

/**
 * Validates a `NewEventFields` payload into a store input; only present keys are
 * carried. Structural checks only — semantic date/range validation stays in the
 * store, the same division of labour as the task validators.
 */
function asNewEventInput(value: unknown): CreateEventInput {
  const event = asRecord(value);
  const input: CreateEventInput = {
    title: asNonEmptyString(event.title, "event.title"),
    startAt: asNonEmptyString(event.startAt, "event.startAt"),
  };
  if (event.endAt !== undefined) input.endAt = asNullableString(event.endAt, "event.endAt");
  if (event.allDay !== undefined) input.allDay = asBoolean(event.allDay, "event.allDay");
  if (event.location !== undefined) {
    input.location = asNullableString(event.location, "event.location");
  }
  if (event.description !== undefined) {
    input.description = asNullableString(event.description, "event.description");
  }
  if (event.category !== undefined) {
    input.category = asNullableString(event.category, "event.category");
  }
  if (event.recurrence !== undefined) {
    input.recurrence = asRecurrenceRule(event.recurrence, "event.recurrence");
  }
  if (event.reminderOffsets !== undefined) {
    input.reminderOffsets = asEventReminderOffsets(
      event.reminderOffsets,
      "event.reminderOffsets",
    );
  }
  return input;
}

/** Validates an `EventFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asEventFieldChanges(value: unknown): UpdateEventFields {
  const changes = asRecord(value);
  const patch: UpdateEventFields = {};
  if (changes.title !== undefined) patch.title = asNonEmptyString(changes.title, "changes.title");
  if (changes.startAt !== undefined) {
    patch.startAt = asNonEmptyString(changes.startAt, "changes.startAt");
  }
  if (changes.endAt !== undefined) patch.endAt = asNullableString(changes.endAt, "changes.endAt");
  if (changes.allDay !== undefined) patch.allDay = asBoolean(changes.allDay, "changes.allDay");
  if (changes.location !== undefined) {
    patch.location = asNullableString(changes.location, "changes.location");
  }
  if (changes.description !== undefined) {
    patch.description = asNullableString(changes.description, "changes.description");
  }
  if (changes.category !== undefined) {
    patch.category = asNullableString(changes.category, "changes.category");
  }
  if (changes.recurrence !== undefined) {
    patch.recurrence = asRecurrenceRule(changes.recurrence, "changes.recurrence");
  }
  if (changes.reminderOffsets !== undefined) {
    patch.reminderOffsets = asEventReminderOffsets(
      changes.reminderOffsets,
      "changes.reminderOffsets",
    );
  }
  return patch;
}

function asPersonKind(value: unknown, field: string): PersonKind {
  if (typeof value === "string" && (PERSON_KINDS as readonly string[]).includes(value)) {
    return value as PersonKind;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid person kind.`);
}

/**
 * A dashboard widget's size preset (ADR-045), checked against the closed domain
 * migration 032's CHECK also holds. Required and explicit — there is no size
 * this handler may pick on the user's behalf.
 */
function asDashboardWidgetSize(value: unknown, field: string): DashboardWidgetSize {
  if (value === "S" || value === "M" || value === "L") return value;
  throw new Error(`Invalid IPC payload: "${field}" must be "S", "M" or "L".`);
}

/** An integer field inside an inclusive structural range — the per-column halves of a person's yearless date. */
/**
 * A widget channel's board scope (ADR-055): absent or null means the default
 * board („Početna“), anything else must be a non-empty id — structural here,
 * semantic in the store, which gates a non-null id against the profile's own
 * sets (SEC-EL-02's usual split).
 */
function asDashboardSetScope(value: unknown): string | null {
  return value === undefined ? null : asNullableId(value, "setId");
}

/** A dashboard set's name (ADR-055): a string that trims to 1..100 characters, returned TRIMMED — the store re-trims and re-checks (SEC-EL-02). */
function asDashboardSetName(value: unknown, field: string): string {
  const trimmed = asNonEmptyString(value, field).trim();
  if (trimmed.length === 0 || trimmed.length > DASHBOARD_SET_NAME_MAX_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be 1..${DASHBOARD_SET_NAME_MAX_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function asBoundedInteger(value: unknown, field: string, min: number, max: number): number {
  const int = asInteger(value, field);
  if (int < min || int > max) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a whole number between ${min} and ${max}.`,
    );
  }
  return int;
}

/** An optional whole number: an explicit null, or an integer (any range check stays in the store). */
function asNullableInteger(value: unknown, field: string): number | null {
  return value === null ? null : asInteger(value, field);
}

/** "F12" is the longest key any chord can carry, so anything past this is not a chord at all (SEC-EL-02: bound the string before it is looked at). */
const MAX_CHORD_KEY_LENGTH = 3;

/**
 * A chord on its way to `globalShortcut` (TASK-002). The one payload in this
 * file that ends up in a *system* call rather than the database, so it is
 * checked twice over: the three modifiers must be genuine booleans, and the key
 * must be short enough to bother reading and then survive core's own
 * `normalizeChordKey` unchanged — the same function the renderer's capture
 * surface gates on, so main accepts exactly the shapes the app can produce.
 *
 * The accelerator string itself is never taken from the renderer; the caller
 * derives it from this validated chord with `chordAccelerator`.
 */
function asGlobalShortcutChord(value: unknown, field: string): GlobalShortcutChord {
  const chord = asRecord(value);
  const key = asNonEmptyString(chord.key, `${field}.key`);
  if (key.length > MAX_CHORD_KEY_LENGTH || normalizeChordKey(key) !== key) {
    throw new Error(`Invalid IPC payload: "${field}.key" is not a normalized chord key.`);
  }
  return {
    ctrl: asBoolean(chord.ctrl, `${field}.ctrl`),
    alt: asBoolean(chord.alt, `${field}.alt`),
    shift: asBoolean(chord.shift, `${field}.shift`),
    key,
  };
}

/**
 * A finite REAL field inside an inclusive range — the target retention
 * (STUDY-007) is the one number crossing this bridge that is deliberately not a
 * whole one, since it is a probability the scheduler aims for.
 */
function asBoundedNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a number between ${min} and ${max}.`,
    );
  }
  return value;
}

/** An optional bounded whole number: an explicit null — which MEANS "no cap" — or an integer inside the range. */
function asNullableBoundedInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number | null {
  return value === null ? null : asBoundedInteger(value, field, min, max);
}

// A person's date is (month, day) rather than a date string, so each half is
// bounded on its own here. These are the PER-COLUMN bounds only — that the pair
// names a real calendar day (never 30 February) and that a year falls inside
// the store's 1900–2100 window are semantic checks, and `PeopleStore` owns
// those, the same division of labour as the event/document validators above.
const PERSON_MONTH_MIN = 1;
const PERSON_MONTH_MAX = 12;
const PERSON_DAY_MIN = 1;
const PERSON_DAY_MAX = 31;

/** Validates a `NewPersonFields` payload into a store input; only present keys are carried. */
function asNewPersonInput(value: unknown): CreatePersonInput {
  const person = asRecord(value);
  const input: CreatePersonInput = {
    name: asNonEmptyString(person.name, "person.name"),
    kind: asPersonKind(person.kind, "person.kind"),
    month: asBoundedInteger(person.month, "person.month", PERSON_MONTH_MIN, PERSON_MONTH_MAX),
    day: asBoundedInteger(person.day, "person.day", PERSON_DAY_MIN, PERSON_DAY_MAX),
  };
  if (person.year !== undefined) input.year = asNullableInteger(person.year, "person.year");
  if (person.note !== undefined) input.note = asNullableString(person.note, "person.note");
  return input;
}

/** Validates a `PersonFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asPersonFieldChanges(value: unknown): UpdatePersonFields {
  const changes = asRecord(value);
  const patch: UpdatePersonFields = {};
  if (changes.name !== undefined) patch.name = asNonEmptyString(changes.name, "changes.name");
  if (changes.kind !== undefined) patch.kind = asPersonKind(changes.kind, "changes.kind");
  if (changes.month !== undefined) {
    patch.month = asBoundedInteger(changes.month, "changes.month", PERSON_MONTH_MIN, PERSON_MONTH_MAX);
  }
  if (changes.day !== undefined) {
    patch.day = asBoundedInteger(changes.day, "changes.day", PERSON_DAY_MIN, PERSON_DAY_MAX);
  }
  if (changes.year !== undefined) patch.year = asNullableInteger(changes.year, "changes.year");
  if (changes.note !== undefined) patch.note = asNullableString(changes.note, "changes.note");
  return patch;
}

function asDocumentType(value: unknown, field: string): DocumentType {
  if (typeof value === "string" && (DOCUMENT_TYPES as readonly string[]).includes(value)) {
    return value as DocumentType;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid document type.`);
}

/** A reminder ladder: an array of non-negative integer day-counts (structural check only). */
function asReminderOffsets(value: unknown, field: string): number[] {
  if (
    !Array.isArray(value) ||
    !value.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0)
  ) {
    throw new Error(`Invalid IPC payload: "${field}" must be an array of non-negative integers.`);
  }
  return value as number[];
}

/**
 * Validates a `NewDocumentFields` payload into a store input; only present keys
 * are carried. Structural checks only — semantic date/ladder validation stays in
 * the store, the same division of labour as the event validators.
 */
function asNewDocumentInput(value: unknown): CreateDocumentInput {
  const document = asRecord(value);
  const input: CreateDocumentInput = {
    docType: asDocumentType(document.docType, "document.docType"),
    label: asNonEmptyString(document.label, "document.label"),
    expiryDate: asNonEmptyString(document.expiryDate, "document.expiryDate"),
  };
  if (document.reminderOffsets !== undefined) {
    input.reminderOffsets = asReminderOffsets(document.reminderOffsets, "document.reminderOffsets");
  }
  if (document.notes !== undefined) {
    input.notes = asNullableString(document.notes, "document.notes");
  }
  return input;
}

/** Validates a `DocumentFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asDocumentFieldChanges(value: unknown): UpdateDocumentFields {
  const changes = asRecord(value);
  const patch: UpdateDocumentFields = {};
  if (changes.docType !== undefined) {
    patch.docType = asDocumentType(changes.docType, "changes.docType");
  }
  if (changes.label !== undefined) patch.label = asNonEmptyString(changes.label, "changes.label");
  if (changes.expiryDate !== undefined) {
    patch.expiryDate = asNonEmptyString(changes.expiryDate, "changes.expiryDate");
  }
  if (changes.reminderOffsets !== undefined) {
    patch.reminderOffsets = asReminderOffsets(changes.reminderOffsets, "changes.reminderOffsets");
  }
  if (changes.notes !== undefined) patch.notes = asNullableString(changes.notes, "changes.notes");
  return patch;
}

function asSubjectColor(value: unknown, field: string): SubjectColor {
  if (typeof value === "string" && (SUBJECT_COLORS as readonly string[]).includes(value)) {
    return value as SubjectColor;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid subject colour.`);
}

/**
 * Validates a `NewSubjectFields` payload into a store input; only present keys are
 * carried. Structural checks only — the store owns the trim/enum revalidation, the
 * same division of labour as the document validators.
 */
function asNewSubjectInput(value: unknown): CreateSubjectInput {
  const subject = asRecord(value);
  const input: CreateSubjectInput = { name: asNonEmptyString(subject.name, "subject.name") };
  if (subject.color !== undefined) input.color = asSubjectColor(subject.color, "subject.color");
  if (subject.semester !== undefined) {
    input.semester = asNullableString(subject.semester, "subject.semester");
  }
  return input;
}

/** Validates a `SubjectFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asSubjectFieldChanges(value: unknown): UpdateSubjectFields {
  const changes = asRecord(value);
  const patch: UpdateSubjectFields = {};
  if (changes.name !== undefined) patch.name = asNonEmptyString(changes.name, "changes.name");
  if (changes.color !== undefined) patch.color = asSubjectColor(changes.color, "changes.color");
  if (changes.semester !== undefined) {
    patch.semester = asNullableString(changes.semester, "changes.semester");
  }
  if (changes.archived !== undefined) patch.archived = asBoolean(changes.archived, "changes.archived");
  return patch;
}

/**
 * What a note's delete does to the flashcards it generated (PRD 09 section 7).
 * An ABSENT field resolves to `keep` — the disposition that destroys nothing —
 * so an untrusted renderer can never cost the user their review history by
 * omitting a key; anything else present but unrecognised is still a refusal.
 */
function asNoteCardDisposition(value: unknown, field: string): NoteCardDisposition {
  if (value === undefined) return "keep";
  if (typeof value === "string" && (NOTE_CARD_DISPOSITIONS as readonly string[]).includes(value)) {
    return value as NoteCardDisposition;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid note card disposition.`);
}

/** Which markdown picker `imex:import-markdown` opens — a closed two-value domain, so nothing else can reach the dialog code. */
function asMarkdownImportSource(value: unknown, field: string): MarkdownImportSource {
  if (value === "files" || value === "folder") return value;
  throw new Error(`Invalid IPC payload: "${field}" must be "files" or "folder".`);
}

function asNoteFolderColor(value: unknown, field: string): NoteFolderColor {
  if (typeof value === "string" && (NOTE_FOLDER_COLORS as readonly string[]).includes(value)) {
    return value as NoteFolderColor;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid note folder colour.`);
}

function asNullableNoteFolderColor(value: unknown, field: string): NoteFolderColor | null {
  return value === null ? null : asNoteFolderColor(value, field);
}

/** Which shape a folder's notes are drawn in (NOTE-002), checked against the store's own closed domain. */
function asNoteFolderView(value: unknown, field: string): NoteFolderView {
  if (typeof value === "string" && (NOTE_FOLDER_VIEWS as readonly string[]).includes(value)) {
    return value as NoteFolderView;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid note folder view.`);
}

/** Validates a note-folder create input; only `parentId`/`name`/`color` are structurally checked — the store owns the trim/enum/parent-FK revalidation. */
function asNoteFolderCreateInput(value: unknown): {
  parentId: string | null;
  name: string;
  color: NoteFolderColor | null;
} {
  const input = asRecord(value);
  return {
    parentId: asNullableId(input.parentId, "input.parentId"),
    name: asString(input.name, "input.name"),
    color: asNullableNoteFolderColor(input.color, "input.color"),
  };
}

/**
 * Validates a note-folder `fields` patch; an omitted key stays omitted, an
 * explicit `color: null` clears the colour — presence is checked with `in`,
 * never `!== undefined`, so the two cases are distinguishable.
 */
function asNoteFolderFieldChanges(value: unknown): { name?: string; color?: NoteFolderColor | null } {
  const rec = asRecord(value);
  const patch: { name?: string; color?: NoteFolderColor | null } = {};
  if ("name" in rec) patch.name = asString(rec.name, "name");
  if ("color" in rec) patch.color = asNullableNoteFolderColor(rec.color, "color");
  return patch;
}

/**
 * Validates a note-CATEGORY create input (NOTE-002). Structural checks only —
 * the trim, the length cap and the per-profile name collision are the store's,
 * exactly as `asNoteFolderCreateInput` leaves those to `NoteOrgStore`. The
 * colour goes through the FOLDER validator because it is the same closed
 * palette; one list, one gate.
 */
function asNoteCategoryCreateInput(value: unknown): {
  name: string;
  color: NoteFolderColor | null;
} {
  const input = asRecord(value);
  return {
    name: asString(input.name, "input.name"),
    color: asNullableNoteFolderColor(input.color, "input.color"),
  };
}

/** Validates a note-category `fields` patch, on `asNoteFolderFieldChanges`' terms: `in`, never `!== undefined`, so `color: null` stays distinguishable from an omission. */
function asNoteCategoryFieldChanges(value: unknown): {
  name?: string;
  color?: NoteFolderColor | null;
} {
  const rec = asRecord(value);
  const patch: { name?: string; color?: NoteFolderColor | null } = {};
  if ("name" in rec) patch.name = asString(rec.name, "name");
  if ("color" in rec) patch.color = asNullableNoteFolderColor(rec.color, "color");
  return patch;
}

function asExamType(value: unknown, field: string): ExamType {
  if (typeof value === "string" && (EXAM_TYPES as readonly string[]).includes(value)) {
    return value as ExamType;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid exam type.`);
}

/**
 * Validates a `NewExamFields` payload into a store input; only present keys are
 * carried. Structural checks only — semantic date validation and the same-profile
 * subject-FK check stay in the store, the same division of labour as the document
 * validators.
 */
function asNewExamInput(value: unknown): CreateExamInput {
  const exam = asRecord(value);
  const input: CreateExamInput = {
    subjectId: asId(exam.subjectId, "exam.subjectId"),
    examType: asExamType(exam.examType, "exam.examType"),
    examDate: asNonEmptyString(exam.examDate, "exam.examDate"),
  };
  if (exam.scope !== undefined) input.scope = asNullableString(exam.scope, "exam.scope");
  return input;
}

/** Validates an `ExamFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asExamFieldChanges(value: unknown): UpdateExamFields {
  const changes = asRecord(value);
  const patch: UpdateExamFields = {};
  if (changes.subjectId !== undefined) {
    patch.subjectId = asId(changes.subjectId, "changes.subjectId");
  }
  if (changes.examType !== undefined) patch.examType = asExamType(changes.examType, "changes.examType");
  if (changes.examDate !== undefined) {
    patch.examDate = asNonEmptyString(changes.examDate, "changes.examDate");
  }
  if (changes.scope !== undefined) patch.scope = asNullableString(changes.scope, "changes.scope");
  return patch;
}

/**
 * Validates a `NewDeckFields` payload into a store input; only present keys are
 * carried. Structural checks only — the store owns the trim/length and
 * same-profile subject-FK checks, the same division of labour as the exam
 * validators.
 */
function asNewDeckInput(value: unknown): CreateDeckInput {
  const deck = asRecord(value);
  return {
    subjectId: asId(deck.subjectId, "deck.subjectId"),
    name: asNonEmptyString(deck.name, "deck.name"),
  };
}

/** Validates a `DeckFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asDeckFieldChanges(value: unknown): UpdateDeckFields {
  const changes = asRecord(value);
  const patch: UpdateDeckFields = {};
  if (changes.subjectId !== undefined) {
    patch.subjectId = asId(changes.subjectId, "changes.subjectId");
  }
  if (changes.name !== undefined) patch.name = asNonEmptyString(changes.name, "changes.name");
  return patch;
}

/**
 * Validates a `NewCardFields` payload into a store input; all three fields are
 * required. Structural checks only — the store owns the trim/length and
 * same-profile deck-FK checks. `front`/`back` may contain `$…$` KaTeX math and
 * are passed through verbatim (no sanitizing).
 */
function asNewCardInput(value: unknown): CreateCardInput {
  const card = asRecord(value);
  return {
    deckId: asId(card.deckId, "card.deckId"),
    front: asNonEmptyString(card.front, "card.front"),
    back: asNonEmptyString(card.back, "card.back"),
  };
}

/**
 * Validates a `CardFieldChanges` payload into a store patch; an omitted key
 * stays omitted. Structural checks only — which of `front`/`back`,
 * `clozeText` and `problemSteps` a given card actually accepts is decided by
 * the ROW's kind, and that is `CardStore.update`'s call, not a shape question
 * this layer can answer (ADR-042 / ADR-046).
 *
 * `problemSteps` is the one field whose `null` is MEANINGFUL rather than
 * absent: it is how the renderer says "this card no longer has a worked
 * solution", so null passes straight through instead of being refused as a
 * non-string.
 */
function asCardFieldChanges(value: unknown): UpdateCardFields {
  const changes = asRecord(value);
  const patch: UpdateCardFields = {};
  if (changes.deckId !== undefined) patch.deckId = asId(changes.deckId, "changes.deckId");
  if (changes.front !== undefined) patch.front = asNonEmptyString(changes.front, "changes.front");
  if (changes.back !== undefined) patch.back = asNonEmptyString(changes.back, "changes.back");
  if (changes.clozeText !== undefined) {
    patch.clozeText = asCappedChars(changes.clozeText, "changes.clozeText", CARD_TEXT_MAX_LENGTH);
  }
  if (changes.problemSteps !== undefined) {
    patch.problemSteps =
      changes.problemSteps === null
        ? null
        : asCappedChars(changes.problemSteps, "changes.problemSteps", CARD_TEXT_MAX_LENGTH);
  }
  return patch;
}

/** A plain integer field (structural check only; range validation stays in the store). */
function asInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Invalid IPC payload: "${field}" must be an integer.`);
  }
  return value;
}

/** A `coveredSeq` field: an integer, and additionally ≥ 1 — seq 0 never names a version (ADR-015). */
function asPositiveInteger(value: unknown, field: string): number {
  const int = asInteger(value, field);
  if (int < 1) {
    throw new Error(`Invalid IPC payload: "${field}" must be a positive integer.`);
  }
  return int;
}

/** The closed FSRS review-rating domain (Again/Hard/Good/Easy); Manual (0) and anything else is rejected. */
function asCardRating(value: unknown, field: string): CardRating {
  if (typeof value === "number" && (CARD_RATINGS as readonly number[]).includes(value)) {
    return value as CardRating;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid review rating.`);
}

/**
 * The weekday vector's bounds (ADR-063), mirroring `PlanStore`'s rule at the
 * IPC edge: exactly 7 entries Mon..Sun, each an integer 0..480, at least one
 * positive — a week of nothing is not a plan. Null passes through: it means
 * "every day = dailyMinutes". The store revalidates identically.
 */
const WEEKDAY_VECTOR_LENGTH = 7;
const MAX_WEEKDAY_MINUTES = 480;

function asWeekdayMinutes(value: unknown, field: string): number[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== WEEKDAY_VECTOR_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be null or an array of exactly ${WEEKDAY_VECTOR_LENGTH} entries.`,
    );
  }
  const vector = value.map((entry, index) =>
    asBoundedInteger(entry, `${field}[${index}]`, 0, MAX_WEEKDAY_MINUTES),
  );
  if (!vector.some((entry) => entry > 0)) {
    throw new Error(`Invalid IPC payload: "${field}" must have at least one positive entry.`);
  }
  return vector;
}

/**
 * Validates a `NewPlanFields` payload into a store input; the first four
 * fields are required, the weekday vector optional (ADR-063). Structural
 * checks only — the store owns the exam-lookup, date-ordering, and
 * `dailyMinutes`-range validation, the same division of labour as the
 * exam/deck validators. `now`/`today` are never taken from this payload —
 * they are stamped by main from its own clock.
 */
function asNewPlanInput(value: unknown): CreatePlanInput {
  const plan = asRecord(value);
  const input: CreatePlanInput = {
    examId: asId(plan.examId, "plan.examId"),
    dailyMinutes: asInteger(plan.dailyMinutes, "plan.dailyMinutes"),
    startDate: asNonEmptyString(plan.startDate, "plan.startDate"),
    examWeekBoost: asBoolean(plan.examWeekBoost, "plan.examWeekBoost"),
  };
  if (plan.weekdayMinutes !== undefined) {
    input.weekdayMinutes = asWeekdayMinutes(plan.weekdayMinutes, "plan.weekdayMinutes");
  }
  return input;
}

/** Validates a `PlanFieldChanges` payload into a store patch; an omitted key stays omitted, and `weekdayMinutes: null` clears the vector. */
function asPlanFieldChanges(value: unknown): UpdatePlanFields {
  const changes = asRecord(value);
  const patch: UpdatePlanFields = {};
  if (changes.dailyMinutes !== undefined) {
    patch.dailyMinutes = asInteger(changes.dailyMinutes, "changes.dailyMinutes");
  }
  if (changes.startDate !== undefined) {
    patch.startDate = asNonEmptyString(changes.startDate, "changes.startDate");
  }
  if (changes.examWeekBoost !== undefined) {
    patch.examWeekBoost = asBoolean(changes.examWeekBoost, "changes.examWeekBoost");
  }
  if (changes.weekdayMinutes !== undefined) {
    patch.weekdayMinutes = asWeekdayMinutes(changes.weekdayMinutes, "changes.weekdayMinutes");
  }
  return patch;
}

/** The closed study-block status domain; `setBlockStatus`'s own semantic check rejects "missed" (sync-only). */
function asBlockStatus(value: unknown, field: string): StudyBlockStatus {
  if (typeof value === "string" && (STUDY_BLOCK_STATUSES as readonly string[]).includes(value)) {
    return value as StudyBlockStatus;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid block status.`);
}

/** The closed rank-move domain (ADR-063): one step toward the top or the bottom, nothing else. */
function asTopicMoveDirection(value: unknown, field: string): TopicMoveDirection {
  if (value === "up" || value === "down") return value;
  throw new Error(`Invalid IPC payload: "${field}" is not a valid move direction.`);
}

/**
 * A scope-cut acceptance's topic ids (STUDY-004): bounded like every other id
 * array on this bridge. The bound is a generous DoS guard, not a domain fact —
 * the store refuses any id that is not an active topic of this profile, which
 * is the check that actually matters.
 */
const MAX_SCOPE_CUT_TOPIC_IDS = 500;

function asScopeCutTopicIds(value: unknown, field: string): string[] {
  return asStringArray(value, field, MAX_SCOPE_CUT_TOPIC_IDS, 64);
}

/**
 * The four snooze presets `notifications:snooze` accepts, checked against
 * `@nexus/db`'s exported `SNOOZE_PRESETS` — the very list `NotificationStore`
 * validates a stored default against and migration 041's CHECK is written from
 * — rather than another hand-typed copy of the same four strings. Main still
 * resolves each to an absolute `until` from its own clock (SEC-EL-02).
 */
function asSnoozePreset(value: unknown, field: string): SnoozePreset {
  if (typeof value === "string" && (SNOOZE_PRESETS as readonly string[]).includes(value)) {
    return value as SnoozePreset;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid snooze preset.`);
}

/**
 * The five NTF/CAL-006/ADR-028 source kinds a profile may switch on and off,
 * checked against `@nexus/db`'s exported `TOGGLEABLE_NOTIFICATION_SOURCES` — the
 * very list `NotificationStore` validates a toggle against and `RestoreStore`
 * writes from — rather than another hand-typed copy of the migration's CHECK. A
 * source added by a future migration widens this validator for free instead of
 * being silently refused on the wire.
 *
 * Deliberately the TOGGLEABLE list rather than the ledger's wider one: both
 * channels below are about preferences, and `"security"` (NTF-007) is not one.
 * A renderer asking to silence it is refused here, before the store ever sees
 * it — and refused again by the store, and a third time by the table's own
 * CHECK.
 */
function asNotificationSource(value: unknown, field: string): NotificationSource {
  if (
    typeof value === "string" &&
    (TOGGLEABLE_NOTIFICATION_SOURCES as readonly string[]).includes(value)
  ) {
    return value as NotificationSource;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid notification source.`);
}

/**
 * The NTF-008 appetite answer's `sources` (ADR-033): either an array of known
 * sources — bounded by the closed set's own size, since a longer one could only
 * be repeats — or `null` for "keep the current settings", which is what both
 * "keep the defaults" and a dismissal send. Each entry is checked against the
 * imported closed set, never a respelling of it.
 */
function asNotificationSourceListOrNull(
  value: unknown,
  field: string,
): NotificationSource[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > TOGGLEABLE_NOTIFICATION_SOURCES.length) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be null or an array of at most ${TOGGLEABLE_NOTIFICATION_SOURCES.length} notification sources.`,
    );
  }
  return value.map((entry, index) => asNotificationSource(entry, `${field}[${index}]`));
}

/** Validates a `notifications:settings-update` payload's `changes`; an omitted key stays omitted. Structural checks only — the store owns "HH:MM"/coherence validation. */
function asNotificationSettingsChanges(value: unknown): UpdateNotificationSettingsInput {
  const changes = asRecord(value);
  const patch: UpdateNotificationSettingsInput = {};
  if (changes.quietFrom !== undefined) {
    patch.quietFrom = asNullableString(changes.quietFrom, "changes.quietFrom");
  }
  if (changes.quietTo !== undefined) {
    patch.quietTo = asNullableString(changes.quietTo, "changes.quietTo");
  }
  if (changes.morningHour !== undefined) {
    patch.morningHour = asNonEmptyString(changes.morningHour, "changes.morningHour");
  }
  if (changes.snoozeDefault !== undefined) {
    patch.snoozeDefault = asSnoozePreset(changes.snoozeDefault, "changes.snoozeDefault");
  }
  return patch;
}

// --- Finansije (FIN slice b) validators --------------------------------------
//
// SEC-EL-02 as everywhere else: structural checks here, semantics in the store.
// The one rule worth restating is the module's own — **money is an INTEGER of
// minor units**: `asMinorUnits` refuses a float outright rather than rounding
// it, so the wire cannot be the place a decimal enters a ledger that has none.
// The store re-validates every one of these afterwards, because a store is
// never the place that assumes its caller did.

/** An amount in minor units: a SAFE integer (the round trip through SQLite and back into a `number` has to survive it). Never a float — a rounded "12.5" would be a silently different amount. */
function asMinorUnits(value: unknown, field: string): number {
  if (typeof value !== "number" || !isMinorUnits(value)) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a safe INTEGER of minor units — money is never a float.`,
    );
  }
  return value;
}

/** An ISO-4217 code: exactly three upper-case ASCII letters, never up-cased here — a caller sending „rsd" has a bug worth naming. */
function asCurrencyCode(value: unknown, field: string): string {
  if (typeof value !== "string" || !isCurrencyCode(value)) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a three-letter upper-case ISO-4217 code.`,
    );
  }
  return value;
}

function asFinAccountKind(value: unknown, field: string): FinAccountKind {
  if (typeof value === "string" && (FIN_ACCOUNT_KINDS as readonly string[]).includes(value)) {
    return value as FinAccountKind;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid account kind.`);
}

function asFinCategoryKind(value: unknown, field: string): FinCategoryKind {
  if (typeof value === "string" && (FIN_CATEGORY_KINDS as readonly string[]).includes(value)) {
    return value as FinCategoryKind;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid category kind.`);
}

/** Validates a `NewFinAccountFields` payload into a store input; only present keys are carried. */
function asNewFinAccountInput(value: unknown): CreateFinAccountInput {
  const account = asRecord(value);
  const input: CreateFinAccountInput = {
    name: asNonEmptyString(account.name, "account.name"),
    kind: asFinAccountKind(account.kind, "account.kind"),
    currency: asCurrencyCode(account.currency, "account.currency"),
  };
  if (account.openingBalance !== undefined) {
    input.openingBalance = asMinorUnits(account.openingBalance, "account.openingBalance");
  }
  return input;
}

/** Validates a `FinAccountFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asFinAccountFieldChanges(value: unknown): UpdateFinAccountFields {
  const changes = asRecord(value);
  const patch: UpdateFinAccountFields = {};
  if (changes.name !== undefined) patch.name = asNonEmptyString(changes.name, "changes.name");
  if (changes.kind !== undefined) patch.kind = asFinAccountKind(changes.kind, "changes.kind");
  if (changes.currency !== undefined) {
    patch.currency = asCurrencyCode(changes.currency, "changes.currency");
  }
  if (changes.openingBalance !== undefined) {
    patch.openingBalance = asMinorUnits(changes.openingBalance, "changes.openingBalance");
  }
  if (changes.archived !== undefined) {
    patch.archived = asBoolean(changes.archived, "changes.archived");
  }
  return patch;
}

/**
 * Validates a `NewFinBudgetFields` payload into a store input. The POSITIVITY
 * of the amount and the "only on an expense category" refusal both stay with
 * `FinCategoryStore.setBudget` — the second needs the category LOOKED UP, which
 * is a database question, and splitting the first away from it would leave two
 * places to keep in step.
 */
function asSetFinBudgetInput(value: unknown): SetFinBudgetInput {
  const budget = asRecord(value);
  return {
    categoryId: asId(budget.categoryId, "budget.categoryId"),
    currency: asCurrencyCode(budget.currency, "budget.currency"),
    amount: asMinorUnits(budget.amount, "budget.amount"),
  };
}

/**
 * Validates a `FinPeriod` payload — two real calendar days. That `from` may not
 * be after `to` is the store's own refusal, kept there so one rule has one home.
 */
function asFinPeriod(value: unknown): FinPeriod {
  const period = asRecord(value);
  return {
    from: asBareDate(period.from, "period.from"),
    to: asBareDate(period.to, "period.to"),
  };
}

/**
 * Validates a `NewFinTransactionFields` payload into a store input. Nothing
 * here knows what a transfer may be: the same-account, cross-currency and
 * "a transfer carries no category" refusals are `FinTransactionStore.resolve`'s
 * alone, because each of them needs the accounts LOOKED UP, which is a database
 * question and not a wire one.
 */
function asNewFinTransactionInput(value: unknown): CreateFinTransactionInput {
  const transaction = asRecord(value);
  const input: CreateFinTransactionInput = {
    accountId: asId(transaction.accountId, "transaction.accountId"),
    date: asBareDate(transaction.date, "transaction.date"),
    amount: asMinorUnits(transaction.amount, "transaction.amount"),
  };
  if (transaction.counterAccountId !== undefined) {
    input.counterAccountId = asNullableId(
      transaction.counterAccountId,
      "transaction.counterAccountId",
    );
  }
  if (transaction.categoryId !== undefined) {
    input.categoryId = asNullableId(transaction.categoryId, "transaction.categoryId");
  }
  if (transaction.payee !== undefined) {
    input.payee = asNullableString(transaction.payee, "transaction.payee");
  }
  if (transaction.note !== undefined) {
    input.note = asNullableString(transaction.note, "transaction.note");
  }
  return input;
}

/**
 * Validates a `FinTransactionFieldChanges` payload into a store patch. An
 * omitted key stays omitted and an explicit `null` clears — which matters here
 * more than usual: clearing `counterAccountId` is how a transfer stops being
 * one, and the store re-checks the WHOLE merged row afterwards precisely
 * because that is not visible from the patched field alone.
 */
function asFinTransactionFieldChanges(value: unknown): UpdateFinTransactionFields {
  const changes = asRecord(value);
  const patch: UpdateFinTransactionFields = {};
  if (changes.accountId !== undefined) {
    patch.accountId = asId(changes.accountId, "changes.accountId");
  }
  if (changes.counterAccountId !== undefined) {
    patch.counterAccountId = asNullableId(changes.counterAccountId, "changes.counterAccountId");
  }
  if (changes.categoryId !== undefined) {
    patch.categoryId = asNullableId(changes.categoryId, "changes.categoryId");
  }
  if (changes.date !== undefined) patch.date = asBareDate(changes.date, "changes.date");
  if (changes.amount !== undefined) patch.amount = asMinorUnits(changes.amount, "changes.amount");
  if (changes.payee !== undefined) patch.payee = asNullableString(changes.payee, "changes.payee");
  if (changes.note !== undefined) patch.note = asNullableString(changes.note, "changes.note");
  return patch;
}

/**
 * A subscription's schedule (FIN slice d): required and never null, unlike a
 * task's or an event's — a subscription IS its rule, so there is no "no rule"
 * reading for this field. Runs through the SAME `asRecurrenceRule` those two
 * use, and refuses the null it would accept, so one grammar has one gate.
 */
function asRequiredRecurrenceRule(value: unknown, field: string): RecurrenceRule {
  const rule = value === null ? null : asRecurrenceRule(value, field);
  if (rule === null) {
    throw new Error(`Invalid IPC payload: "${field}" must be a valid recurrence rule.`);
  }
  return rule;
}

/** A renewal reminder lead: null („ne podsećaj me") or a whole 0..365, mirroring migration 053's own CHECK. */
function asReminderDays(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 365) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be null or a whole number of days between 0 and 365.`,
    );
  }
  return value;
}

/**
 * Validates a `NewFinRecurringFields` payload into a store input; only present
 * keys are carried. Nothing here resolves an account or a category — those are
 * database questions, and `FinRecurringStore.resolve` owns them, exactly as it
 * owns what a valid rule is on the way into the column.
 */
function asNewFinRecurringInput(value: unknown): CreateFinRecurringInput {
  const subscription = asRecord(value);
  const input: CreateFinRecurringInput = {
    accountId: asId(subscription.accountId, "subscription.accountId"),
    name: asNonEmptyString(subscription.name, "subscription.name"),
    amount: asMinorUnits(subscription.amount, "subscription.amount"),
    recurrence: asRequiredRecurrenceRule(subscription.recurrence, "subscription.recurrence"),
    startDate: asBareDate(subscription.startDate, "subscription.startDate"),
  };
  if (subscription.categoryId !== undefined) {
    input.categoryId = asNullableId(subscription.categoryId, "subscription.categoryId");
  }
  if (subscription.payee !== undefined) {
    input.payee = asNullableString(subscription.payee, "subscription.payee");
  }
  if (subscription.note !== undefined) {
    input.note = asNullableString(subscription.note, "subscription.note");
  }
  if (subscription.reminderDays !== undefined) {
    input.reminderDays = asReminderDays(subscription.reminderDays, "subscription.reminderDays");
  }
  return input;
}

/** Validates a `FinRecurringFieldChanges` payload into a store patch; an omitted key stays omitted and an explicit `null` clears. */
function asFinRecurringFieldChanges(value: unknown): UpdateFinRecurringFields {
  const changes = asRecord(value);
  const patch: UpdateFinRecurringFields = {};
  if (changes.accountId !== undefined) {
    patch.accountId = asId(changes.accountId, "changes.accountId");
  }
  if (changes.categoryId !== undefined) {
    patch.categoryId = asNullableId(changes.categoryId, "changes.categoryId");
  }
  if (changes.name !== undefined) patch.name = asNonEmptyString(changes.name, "changes.name");
  if (changes.amount !== undefined) patch.amount = asMinorUnits(changes.amount, "changes.amount");
  if (changes.payee !== undefined) patch.payee = asNullableString(changes.payee, "changes.payee");
  if (changes.note !== undefined) patch.note = asNullableString(changes.note, "changes.note");
  if (changes.recurrence !== undefined) {
    patch.recurrence = asRequiredRecurrenceRule(changes.recurrence, "changes.recurrence");
  }
  if (changes.startDate !== undefined) {
    patch.startDate = asBareDate(changes.startDate, "changes.startDate");
  }
  if (changes.reminderDays !== undefined) {
    patch.reminderDays = asReminderDays(changes.reminderDays, "changes.reminderDays");
  }
  return patch;
}

/** Validates a `FinRenewalWindow` payload — two real calendar days; that `from` may not be after `to` stays the store's own refusal. */
function asFinRenewalWindow(value: unknown): FinRenewalWindow {
  const window = asRecord(value);
  return {
    from: asBareDate(window.from, "window.from"),
    to: asBareDate(window.to, "window.to"),
  };
}

// --- Navike (HABIT slice b) validators ---------------------------------------
//
// SEC-EL-02 as everywhere else: structural checks here, semantics in the store.
// The one that earns its place is `asHabitSchedule` — a schedule reaches the
// column as JSON, so an UNVALIDATED one on this wire is exactly the hole the
// two-kind vocabulary exists to close. It runs core's own validator, the very
// function the store runs, rather than a second reading of what a schedule may
// be.

/**
 * A `HabitSchedule` from an untrusted caller, through HABIT's OWN validator —
 * so an ADR-024 recurrence rule offered here is refused at the wire rather than
 * at the column. Returns the CANONICAL form (sorted, deduplicated weekdays),
 * which is what the store then re-validates and serializes.
 */
function asHabitSchedule(value: unknown, field: string): HabitSchedule {
  const schedule = validateHabitSchedule(value);
  if (schedule === null) {
    throw new Error(`Invalid IPC payload: "${field}" is not a valid habit schedule.`);
  }
  return schedule;
}

/** A whole positive count — a `target` or a day's `value`. Never a float: „pola čaše" is not something this module records. */
function asHabitCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_HABIT_COUNT) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a whole number between 1 and ${MAX_HABIT_COUNT}.`,
    );
  }
  return value;
}

/** A `target`: null for a binary habit, otherwise a count. */
function asNullableHabitCount(value: unknown, field: string): number | null {
  return value === null ? null : asHabitCount(value, field);
}

/**
 * Validates a `NewHabitFields` payload into a store input; only present keys are
 * carried. That a `unit` needs a `target` to be the unit OF stays the store's
 * refusal — it is a rule about the whole habit rather than about any one field,
 * and the store re-checks the merged row on an update too, which nothing here
 * could see.
 */
function asNewHabitInput(value: unknown): CreateHabitInput {
  const habit = asRecord(value);
  const input: CreateHabitInput = {
    name: asNonEmptyString(habit.name, "habit.name"),
    schedule: asHabitSchedule(habit.schedule, "habit.schedule"),
  };
  if (habit.color !== undefined) {
    input.color = asNullableNoteFolderColor(habit.color, "habit.color");
  }
  if (habit.target !== undefined) {
    input.target = asNullableHabitCount(habit.target, "habit.target");
  }
  if (habit.unit !== undefined) input.unit = asNullableString(habit.unit, "habit.unit");
  if (habit.reminderTime !== undefined) {
    input.reminderTime = asNullableString(habit.reminderTime, "habit.reminderTime");
  }
  return input;
}

/** Validates a `HabitFieldChanges` payload into a store patch; an omitted key stays omitted and an explicit `null` clears. */
function asHabitFieldChanges(value: unknown): UpdateHabitFields {
  const changes = asRecord(value);
  const patch: UpdateHabitFields = {};
  if (changes.name !== undefined) patch.name = asNonEmptyString(changes.name, "changes.name");
  if (changes.color !== undefined) {
    patch.color = asNullableNoteFolderColor(changes.color, "changes.color");
  }
  if (changes.schedule !== undefined) {
    patch.schedule = asHabitSchedule(changes.schedule, "changes.schedule");
  }
  if (changes.target !== undefined) {
    patch.target = asNullableHabitCount(changes.target, "changes.target");
  }
  if (changes.unit !== undefined) patch.unit = asNullableString(changes.unit, "changes.unit");
  if (changes.reminderTime !== undefined) {
    patch.reminderTime = asNullableString(changes.reminderTime, "changes.reminderTime");
  }
  return patch;
}

/**
 * The day a tick is being recorded FOR (HABIT slice c). A real bare calendar
 * day, and never one after `localToday()`.
 *
 * **This reads like a weakening of the clock rule and is the opposite of one.**
 * Slice b let main stamp `localToday()` and carried no day at all; the rule that
 * protected is „the renderer may not lie about NOW", and it still holds — nothing
 * on this wire asks what today is. A day the user named by clicking a cell of
 * their own history is INPUT, exactly as a FIN transaction's `tx_date` is: chosen
 * by the user, validated here, never taken as a claim about the clock. What main
 * still owns is the clock itself, which is precisely what makes the refusal below
 * enforceable: the future is not a fact about a habit, and only main can say
 * where the future starts.
 *
 * The other bound — a day before the habit's own `createdAt` — needs the row and
 * so lives in `assertHabitExisted`.
 */
function asHabitEntryDay(value: unknown, field: string): string {
  const day = asBareDate(value, field);
  if (day > localToday()) {
    throw new Error(`Invalid IPC payload: "${field}" must not be in the future.`);
  }
  return day;
}

/**
 * Refuses a tick on a day BEFORE the habit existed. The history grid draws those
 * days as `unjudged` for a reason — a habit made on Wednesday must not show
 * eleven weeks of misses behind it — and a write there would create history for a
 * period the habit was not in.
 *
 * A habit this profile does not have is deliberately left to the store: `setEntry`
 * and `clearEntry` both resolve it themselves, and their „No live habit" is the
 * message the page already maps to Serbian copy.
 */
function assertHabitExisted(store: HabitStore, habitId: string, day: string): void {
  const habit = store.listActive().find((row) => row.id === habitId);
  if (habit === undefined) return;
  if (day < habit.createdAt.slice(0, 10)) {
    throw new Error(`Invalid IPC payload: "day" is before the habit existed.`);
  }
}

/** Validates a `HabitDayRange` payload — two real calendar days; that `from` may not be after `to` stays the store's own refusal. */
function asHabitDayRange(value: unknown): HabitDayRange {
  const range = asRecord(value);
  return {
    from: asBareDate(range.from, "range.from"),
    to: asBareDate(range.to, "range.to"),
  };
}

// --- Ishrana (FIT slice b, migration 058) validators -------------------------
//
// SEC-EL-02 as everywhere else: structural checks here, semantics in the store.
// Two things about this block are worth naming, because neither is ordinary.
//
// **The caps are counted in CHARACTERS, through `asCappedChars`.** Every FIT cap
// is defined in `@nexus/db` with `.length` — `MAX_FIT_FOOD_NAME_LENGTH`,
// `MAX_FIT_SERVING_LABEL_LENGTH`, `MAX_FIT_FOOD_NOTES_LENGTH`,
// `MAX_FIT_FOOD_QUERY_LENGTH` — and this is a Serbian food catalogue, where
// „šargarepa", „ćurka" and „đuveč" each carry two-byte letters. Byte-capping any
// of them would make the wire stricter than the store it claims to mirror, and
// stricter *only for text written in the product's own language*. See
// `asCappedChars`' own doc for the defect that rule was written from.
//
// **`resolveLoggedFood` is the module's security boundary, not a convenience.**
// The renderer names a food and says how much; main looks the food up and writes
// the snapshot. A wire that accepted macros beside a reference would let a
// compromised renderer log a 0-kcal čokolada under a real food's name — and the
// whole point of the snapshot (migration 058) is that it records what was
// actually eaten.

/** One of the five slots — assigned into the store's own `MealSlot`, so a member added on one side and not the other is a compile error. */
function asFitMealSlot(value: unknown, field: string): MealSlot {
  for (const slot of MEAL_SLOTS) {
    if (slot === value) return slot;
  }
  throw new Error(`Invalid IPC payload: "${field}" must be one of the five meal slots.`);
}

/**
 * The day a meal is being logged FOR. A real bare calendar day, and never one
 * after `localToday()`.
 *
 * `asHabitEntryDay`'s reasoning exactly, and for the same reason: a day the user
 * named with the page's own navigation is INPUT, not a claim about the clock —
 * correcting yesterday's lunch is the ordinary use of a food diary. What main
 * still owns is the clock, which is what makes the one refusal enforceable: a
 * meal is a fact about a day that happened, and tomorrow has not.
 */
function asFitDay(value: unknown, field: string): string {
  const day = asBareDate(value, field);
  if (day > localToday()) {
    throw new Error(`Invalid IPC payload: "${field}" must not be in the future.`);
  }
  return day;
}

/** A finite number in `[0, max]`. NOT an integer: 0,72 g of carbohydrate per 100 g is what a real source publishes (contrast HABIT's counts). */
function asFitAmount(value: unknown, field: string, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a finite number between 0 and ${max}.`,
    );
  }
  return value;
}

/** A logged portion: strictly positive, because an item weighing nothing is the absence of an item. */
function asFitGrams(value: unknown, field: string): number {
  const grams = asFitAmount(value, field, MAX_MEAL_ITEM_GRAMS);
  if (grams <= 0) {
    throw new Error(`Invalid IPC payload: "${field}" must be above 0.`);
  }
  return grams;
}

// --- Trening i telo (FIT slice b, migration 060) -----------------------------
//
// The module's security boundary is `resolveLoggedExercise`, and it is the same
// boundary `resolveLoggedFood` draws one table over. A logged set stores its
// `metric` and its muscle list as a SNAPSHOT, because a later edit to the
// exercise must not re-interpret what was already lifted (migration 060) — and
// a snapshot is only a snapshot if the TRUSTED side takes it. A wire that let
// the renderer declare a set's metric could log a plank as `weight_reps`, and
// every tonnage and hard-set total downstream would absorb it in silence.

/** A day a training surface named. Unlike a meal, a session may be back-dated freely, and unlike a meal it is still never in the future. */
function asFitTrainingDay(value: unknown, field: string): string {
  return asFitDay(value, field);
}

/** One of the four set kinds. Closed here AND in the schema, because volume reads are scoped by it. */
function asFitSetKind(value: unknown, field: string): SetKind {
  if (typeof value !== "string" || !(SET_KINDS as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be one of ${SET_KINDS.join(", ")}.`,
    );
  }
  return value as SetKind;
}

/** A nullable non-negative measurement on a set. `undefined` and `null` both mean "not recorded" and both arrive as null. */
function asFitSetNumber(value: unknown, field: string, max: number): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be null or a finite number between 0 and ${max}.`,
    );
  }
  return value;
}

/** Reps in reserve: a whole number 0–5, or absent. */
function asFitRir(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 5) {
    throw new Error(`Invalid IPC payload: "${field}" must be null or a whole number 0–5.`);
  }
  return value;
}

/** A nullable whole count on a set — reps are counted, never measured. */
function asFitSetCount(value: unknown, field: string, max: number): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be null or a whole number between 0 and ${max}.`,
    );
  }
  return value;
}

/**
 * Turns the reference the renderer sent into the label, the metric and the
 * muscle list the set (or routine item) will be stamped with. **The module's
 * security boundary** — see the block comment above.
 *
 * `catalogue:<slug>` is looked up in the app's own shipped data; a slug this
 * build no longer ships is refused rather than logged as a name with no meaning.
 * `user:<uuid>` goes through the exercise store, which answers only for a LIVE
 * exercise in THIS profile — so a soft-deleted exercise cannot be logged afresh,
 * while every set already logged with it stays exactly as it was.
 */
function resolveLoggedExercise(
  profileId: string,
  reference: unknown,
): { exerciseRef: string; label: string; metric: ExerciseMetric; primaryMuscles: MuscleGroup[] } {
  if (typeof reference !== "string") {
    throw new Error(`Invalid IPC payload: "exerciseRef" must be a string.`);
  }
  const parsed = parseExerciseRef(reference);
  if (parsed === null) {
    throw new Error(
      `Invalid IPC payload: "exerciseRef" must be "catalogue:<slug>" or "user:<id>".`,
    );
  }
  if (parsed.kind === "catalogue") {
    const entry = catalogueExercise(parsed.id);
    if (entry === undefined) {
      throw new Error(`Invalid IPC payload: "exerciseRef" names no exercise this build ships.`);
    }
    return {
      exerciseRef: reference,
      label: entry.name,
      metric: entry.metric,
      primaryMuscles: [...entry.primaryMuscles],
    };
  }
  const own = fitExerciseStore(profileId).get(parsed.id);
  return {
    exerciseRef: reference,
    label: own.name,
    metric: own.metric,
    primaryMuscles: own.primaryMuscles,
  };
}

/**
 * The same lookup `resolveLoggedExercise` performs, in the shape a READ needs:
 * it answers `null` instead of throwing, and it reads the profile's own
 * exercises ONCE for however many references the caller is about to resolve.
 *
 * Both differences are the difference between a write and a read.
 *
 * - **A write must refuse.** Logging a set against an exercise that does not
 *   exist would put a name with no meaning in the history, so
 *   `resolveLoggedExercise` throws and the act fails.
 * - **A read must not.** A routine is allowed to name an exercise the user
 *   deleted afterwards — nothing stops them, `exercise_ref` is text with no
 *   foreign key by design — and answering that whole routine with an exception
 *   would take a working page down over one stale line. `null` is what lets
 *   „Trening" draw that one line as unusable and the other eleven as usable.
 * - **One `list()` for the batch.** `fit:routines-list` resolves every item of
 *   every routine; a per-item store call would be the N+1 `fit:last-performed`
 *   exists to avoid, on a read that happens on every mount of the page.
 */
function fitExerciseLookup(
  profileId: string,
): (reference: string) => { label: string; metric: ExerciseMetric } | null {
  let own: Map<string, FitExercise> | null = null;
  return (reference) => {
    const parsed = parseExerciseRef(reference);
    if (parsed === null) return null;
    if (parsed.kind === "catalogue") {
      const entry = catalogueExercise(parsed.id);
      return entry === undefined ? null : { label: entry.name, metric: entry.metric };
    }
    // Read on first use rather than eagerly: a profile with no routines, or one
    // whose routines are all catalogue movements, never touches the table.
    own ??= new Map(fitExerciseStore(profileId).list().map((entry) => [entry.id, entry]));
    const entry = own.get(parsed.id);
    return entry === undefined ? null : { label: entry.name, metric: entry.metric };
  };
}

/**
 * A stored routine as the wire declares it: every item's `label` and `metric`
 * resolved LIVE, with the stored label kept as the fallback for a reference that
 * resolves to nothing (`FitRoutineItem` carries the reasoning).
 */
function toWireRoutine(
  routine: StoredFitRoutine,
  lookup: (reference: string) => { label: string; metric: ExerciseMetric } | null,
): FitRoutine {
  return {
    ...routine,
    items: routine.items.map((item) => {
      const resolved = lookup(item.exerciseRef);
      return {
        ...item,
        label: resolved?.label ?? item.label,
        metric: resolved?.metric ?? null,
      };
    }),
  };
}

/** One catalogue exercise as the picker reads it. `catalogue: true` is what tells a surface there is no row here to edit. */
function catalogueExerciseOption(entry: ExerciseEntry): FitExerciseOption {
  return {
    ref: exerciseRefText({ kind: "catalogue", id: entry.id }),
    name: entry.name,
    nameEn: entry.nameEn,
    primaryMuscles: [...entry.primaryMuscles],
    secondaryMuscles: [...entry.secondaryMuscles],
    equipment: entry.equipment,
    pattern: entry.pattern,
    unilateral: entry.unilateral,
    metric: entry.metric,
    catalogue: true,
  };
}

/** One of the profile's own exercises as the picker reads it. */
function userExerciseOption(entry: FitExercise): FitExerciseOption {
  return {
    ref: exerciseRefText({ kind: "user", id: entry.id }),
    name: entry.name,
    nameEn: entry.nameEn,
    primaryMuscles: entry.primaryMuscles,
    secondaryMuscles: entry.secondaryMuscles,
    equipment: entry.equipment,
    pattern: entry.pattern,
    unilateral: entry.unilateral,
    metric: entry.metric,
    catalogue: false,
  };
}

/**
 * A new exercise, every field validated on its own and the object built up
 * explicitly rather than assembled loosely and asserted into shape.
 *
 * The distinction matters at this boundary specifically: `as unknown as T` on a
 * payload from an untrusted renderer means the compiler has stopped checking
 * exactly where the checking is the point. The store re-validates all of it
 * anyway, but a cast here would hide a field that stopped being read at all.
 */
function asNewFitExercise(value: unknown): CreateFitExerciseInput {
  const body = asRecord(value);
  const base: CreateFitExerciseInput = {
    name: asCappedChars(body.name, "name", MAX_FIT_EXERCISE_NAME_LENGTH),
    primaryMuscles: asMuscleGroups(body.primaryMuscles, "primaryMuscles"),
    equipment: asClosedMember(body.equipment, "equipment", EXERCISE_EQUIPMENT),
    pattern: asClosedMember(body.pattern, "pattern", MOVEMENT_PATTERNS),
    metric: asClosedMember(body.metric, "metric", EXERCISE_METRICS),
  };
  return { ...base, ...asFitExerciseOptionals(body) };
}

/** A partial patch. An omitted key stays omitted — `exactOptionalPropertyTypes` is on, so „absent" and „present and undefined" are not the same thing here. */
function asFitExerciseChanges(value: unknown): UpdateFitExerciseFields {
  const body = asRecord(value);
  const changes: UpdateFitExerciseFields = { ...asFitExerciseOptionals(body) };
  if (body.name !== undefined) {
    changes.name = asCappedChars(body.name, "name", MAX_FIT_EXERCISE_NAME_LENGTH);
  }
  if (body.primaryMuscles !== undefined) {
    changes.primaryMuscles = asMuscleGroups(body.primaryMuscles, "primaryMuscles");
  }
  if (body.equipment !== undefined) {
    changes.equipment = asClosedMember(body.equipment, "equipment", EXERCISE_EQUIPMENT);
  }
  if (body.pattern !== undefined) {
    changes.pattern = asClosedMember(body.pattern, "pattern", MOVEMENT_PATTERNS);
  }
  if (body.metric !== undefined) {
    changes.metric = asClosedMember(body.metric, "metric", EXERCISE_METRICS);
  }
  return changes;
}

/** The four fields that are optional on BOTH a create and a patch, read once for both. */
function asFitExerciseOptionals(body: Record<string, unknown>): {
  nameEn?: string;
  secondaryMuscles?: MuscleGroup[];
  unilateral?: boolean;
  notes?: string;
} {
  const out: { nameEn?: string; secondaryMuscles?: MuscleGroup[]; unilateral?: boolean; notes?: string } = {};
  if (body.nameEn !== undefined) {
    out.nameEn = asCappedChars(body.nameEn, "nameEn", MAX_FIT_EXERCISE_NAME_LENGTH);
  }
  if (body.secondaryMuscles !== undefined) {
    out.secondaryMuscles = asMuscleGroups(body.secondaryMuscles, "secondaryMuscles");
  }
  if (body.unilateral !== undefined) out.unilateral = asBoolean(body.unilateral, "unilateral");
  if (body.notes !== undefined) {
    out.notes = asCappedChars(body.notes, "notes", MAX_FIT_EXERCISE_NOTES_LENGTH);
  }
  return out;
}

/** A member of one of `@nexus/core`'s closed vocabularies, named in the error so a caller can see which list it missed. */
function asClosedMember<T extends string>(
  value: unknown,
  field: string,
  members: readonly T[],
): T {
  if (typeof value !== "string" || !(members as readonly string[]).includes(value)) {
    throw new Error(`Invalid IPC payload: "${field}" must be one of ${members.join(", ")}.`);
  }
  return value as T;
}

/** A list of known muscle groups — at most one per group, and never longer than the vocabulary itself. */
function asMuscleGroups(value: unknown, field: string): MuscleGroup[] {
  if (!Array.isArray(value) || value.length > MUSCLE_GROUPS.length) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be an array of at most ${MUSCLE_GROUPS.length} muscle groups.`,
    );
  }
  return value.map((entry, index) => asClosedMember(entry, `${field}[${index}]`, MUSCLE_GROUPS));
}

/**
 * The routine lines as the renderer sends them: a reference and its targets,
 * never a label.
 *
 * Every bound below is the SAME bound the corresponding logged-set field
 * carries (`fit:set-log`), and deliberately so: a routine that could prescribe
 * a number the log refuses to record would put the refusal a whole session
 * later, on the set where it mattered.
 */
function asFitRoutineItemInputs(value: unknown): FitRoutineItemInput[] {
  if (!Array.isArray(value) || value.length > MAX_FIT_ROUTINE_ITEMS) {
    throw new Error(
      `Invalid IPC payload: "items" must be an array of at most ${MAX_FIT_ROUTINE_ITEMS} entries.`,
    );
  }
  return value.map((entry, index) => {
    const item = asRecord(entry);
    return {
      exerciseRef: asNonEmptyString(item.exerciseRef, `items[${index}].exerciseRef`),
      targetSets: asFitSetCount(item.targetSets, `items[${index}].targetSets`, 99),
      targetRepsMin: asFitSetCount(item.targetRepsMin, `items[${index}].targetRepsMin`, 999),
      targetRepsMax: asFitSetCount(item.targetRepsMax, `items[${index}].targetRepsMax`, 999),
      targetSeconds: asFitSetNumber(item.targetSeconds, `items[${index}].targetSeconds`, 86_400),
      targetWeightKg: asFitSetNumber(
        item.targetWeightKg,
        `items[${index}].targetWeightKg`,
        MAX_WEIGHT_KG,
      ),
      targetDistanceM: asFitSetNumber(
        item.targetDistanceM,
        `items[${index}].targetDistanceM`,
        1_000_000,
      ),
      // The rest timer's own ceiling, not a number invented here — see the
      // column's CHECK in migration 061.
      restSeconds: asFitSetCount(
        item.restSeconds,
        `items[${index}].restSeconds`,
        MAX_FIT_REST_SECONDS,
      ),
    };
  });
}

/** One day's body reading. `weightKg` is the only required number — it is what makes the row an observation. */
function asFitMeasurementInput(value: unknown): BodyMeasurement {
  const body = asRecord(value);
  const circumferences = body.circumferences === undefined ? {} : asRecord(body.circumferences);
  const site = (key: string): number | null =>
    asFitSetNumber(circumferences[key], `circumferences.${key}`, MAX_CIRCUMFERENCE_CM);
  return {
    day: asFitTrainingDay(body.day, "day"),
    weightKg: asFitAmount(body.weightKg, "weightKg", MAX_WEIGHT_KG),
    bodyFatPercent: asFitSetNumber(body.bodyFatPercent, "bodyFatPercent", 100),
    muscle: asFitMuscleReading(body.muscle),
    waterPercent: asFitSetNumber(body.waterPercent, "waterPercent", 100),
    circumferences: {
      neck: site("neck"),
      chest: site("chest"),
      upperArm: site("upperArm"),
      waist: site("waist"),
      hip: site("hip"),
      thigh: site("thigh"),
    },
  };
}

/** A scale's muscle figure, in the unit the scale printed. Both halves or neither — the schema says the same thing with a table CHECK. */
function asFitMuscleReading(value: unknown): MuscleReading | null {
  if (value === undefined || value === null) return null;
  const body = asRecord(value);
  const unit = asClosedMember(body.unit, "muscle.unit", ["percent", "kg"] as const);
  const amount = asFitAmount(body.value, "muscle.value", unit === "percent" ? 100 : MAX_WEIGHT_KG);
  return unit === "percent" ? { unit: "percent", value: amount } : { unit: "kg", value: amount };
}

/**
 * The routine body both `fit:routine-create` and `fit:routine-update` send, with
 * every reference resolved to the label main found for it.
 *
 * One reader for both, because the two channels differ only in whether an `id`
 * accompanies the body — and two readers would be two places for the resolve
 * boundary to be forgotten in.
 */
function readFitRoutineBody(payload: unknown): {
  profileId: string;
  name: string;
  notes: string;
  // `FitRoutineItemInput` plus the label main resolved — spelled as an
  // intersection rather than restated field by field, so migration 061's four
  // targets (and whatever comes next) reach the store without a second list
  // here quietly dropping them on the floor.
  items: (FitRoutineItemInput & { label: string })[];
} {
  const body = asRecord(payload);
  const profileId = asId(body.profileId, "profileId");
  return {
    profileId,
    name: asCappedChars(body.name, "name", MAX_FIT_ROUTINE_NAME_LENGTH),
    notes:
      body.notes === undefined
        ? ""
        : asCappedChars(body.notes, "notes", MAX_FIT_ROUTINE_NOTES_LENGTH),
    items: asFitRoutineItemInputs(body.items).map((item) => ({
      ...item,
      label: resolveLoggedExercise(profileId, item.exerciseRef).label,
    })),
  };
}

/** The four fields the wire declares, and only those — see the `fit:body-profile` handler. */
function toWireBodyProfile(row: BodyProfile): FitBodyProfile {
  return {
    sex: row.sex,
    birthDate: row.birthDate,
    heightCm: row.heightCm,
    activity: row.activity,
  };
}

/** The four facts about a person. `sex` is null when not given, and null survives this boundary rather than becoming a guess. */
function asFitBodyProfileInput(value: unknown): BodyProfile {
  const body = asRecord(value);
  return {
    sex:
      body.sex === undefined || body.sex === null
        ? null
        : asClosedMember(body.sex, "sex", BODY_SEXES),
    birthDate: asBareDate(body.birthDate, "birthDate"),
    heightCm: asFitAmount(body.heightCm, "heightCm", MAX_HEIGHT_CM),
    activity: asClosedMember(body.activity, "activity", ACTIVITY_LEVELS),
  };
}

/** The catalogue's own closed list of shelves, checked against it rather than respelled. */
function asFoodCategory(value: unknown, field: string): FoodCategory {
  for (const category of FOOD_CATEGORIES) {
    if (category === value) return category;
  }
  throw new Error(`Invalid IPC payload: "${field}" must be a food category.`);
}

/** The seven per-100 g numbers, each finite, non-negative and bounded. */
function asFoodMacros(value: unknown, field: string): FoodMacros {
  const macros = asRecord(value);
  const read = (key: keyof FoodMacros): number =>
    asFitAmount(macros[key], `${field}.${key}`, MAX_FIT_NUTRIENT);
  return {
    kcal: read("kcal"),
    protein: read("protein"),
    carbs: read("carbs"),
    fat: read("fat"),
    fiber: read("fiber"),
    sugar: read("sugar"),
    sodiumMg: read("sodiumMg"),
  };
}

/** The household measures. An EMPTY list is a legitimate answer — brašno is weighed, and inventing „1 komad" for it would be inventing data. */
function asFoodServings(value: unknown, field: string): FoodServing[] {
  if (!Array.isArray(value) || value.length > MAX_FIT_FOOD_SERVINGS) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be an array of at most ${MAX_FIT_FOOD_SERVINGS} servings.`,
    );
  }
  return value.map((serving: unknown, index) => {
    const record = asRecord(serving);
    return {
      label: asCappedChars(
        record.label,
        `${field}[${index}].label`,
        MAX_FIT_SERVING_LABEL_LENGTH,
      ),
      grams: asFitAmount(record.grams, `${field}[${index}].grams`, MAX_FIT_SERVING_GRAMS),
    };
  });
}

/** Validates a `NewFitFoodFields` payload into a store input; only present keys are carried. */
function asNewFitFoodInput(value: unknown): CreateFitFoodInput {
  const food = asRecord(value);
  const input: CreateFitFoodInput = {
    name: asCappedChars(food.name, "food.name", MAX_FIT_FOOD_NAME_LENGTH),
    category: asFoodCategory(food.category, "food.category"),
    per100g: asFoodMacros(food.per100g, "food.per100g"),
  };
  if (food.servings !== undefined) {
    input.servings = asFoodServings(food.servings, "food.servings");
  }
  if (food.notes !== undefined) {
    input.notes = asCappedChars(food.notes, "food.notes", MAX_FIT_FOOD_NOTES_LENGTH);
  }
  return input;
}

/** Validates a `FitFoodFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asFitFoodChanges(value: unknown): UpdateFitFoodFields {
  const changes = asRecord(value);
  const patch: UpdateFitFoodFields = {};
  if (changes.name !== undefined) {
    patch.name = asCappedChars(changes.name, "changes.name", MAX_FIT_FOOD_NAME_LENGTH);
  }
  if (changes.category !== undefined) {
    patch.category = asFoodCategory(changes.category, "changes.category");
  }
  if (changes.per100g !== undefined) {
    patch.per100g = asFoodMacros(changes.per100g, "changes.per100g");
  }
  if (changes.servings !== undefined) {
    patch.servings = asFoodServings(changes.servings, "changes.servings");
  }
  if (changes.notes !== undefined) {
    patch.notes = asCappedChars(changes.notes, "changes.notes", MAX_FIT_FOOD_NOTES_LENGTH);
  }
  return patch;
}

/** One daily goal: `null` is „no goal" and passes through untouched, never coerced to zero — and zero is never coerced to it. */
function asFitTargetGoal(value: unknown, field: string): number | null {
  return value === null ? null : asFitAmount(value, field, MAX_FIT_TARGET);
}

/** All four goals, every time — `FitTargetStore.save` has no patch, deliberately. */
function asFitTargetGoals(value: unknown): FitTargetGoals {
  const goals = asRecord(value);
  return {
    kcal: asFitTargetGoal(goals.kcal, "goals.kcal"),
    proteinG: asFitTargetGoal(goals.proteinG, "goals.proteinG"),
    carbsG: asFitTargetGoal(goals.carbsG, "goals.carbsG"),
    fatG: asFitTargetGoal(goals.fatG, "goals.fatG"),
  };
}

/**
 * Turns the reference the renderer sent into the label and the seven numbers the
 * item will be stamped with. **The module's security boundary** — see the block
 * comment above.
 *
 * `catalogue:<id>` is looked up in the app's own shipped data; an id this build
 * no longer ships is refused rather than logged as a name with no numbers.
 * `user:<uuid>` goes through the food store, which answers only for a LIVE food
 * in THIS profile — so a soft-deleted food cannot be logged afresh, while every
 * item already logged with it stays exactly as it was.
 */
function resolveLoggedFood(
  profileId: string,
  reference: unknown,
): { foodRef: string; label: string; per100g: FoodMacros } {
  if (typeof reference !== "string") {
    throw new Error(`Invalid IPC payload: "foodRef" must be a string.`);
  }
  const parsed = parseFoodRef(reference);
  if (parsed === null) {
    throw new Error(`Invalid IPC payload: "foodRef" must be "catalogue:<id>" or "user:<id>".`);
  }
  if (parsed.kind === "catalogue") {
    const food = catalogueFood(parsed.id);
    if (food === undefined) {
      throw new Error(`Invalid IPC payload: "foodRef" names no food this build ships.`);
    }
    return { foodRef: reference, label: food.name, per100g: food.per100g };
  }
  const food = fitFoodStore(profileId).get(parsed.id);
  return { foodRef: reference, label: food.name, per100g: food.per100g };
}

/** One catalogue entry as the picker reads it — its provenance rides along, which is the reason the catalogue was built the way it was. */
function catalogueOption(food: FoodEntry): FitFoodOption {
  return {
    ref: foodRefText({ kind: "catalogue", id: food.id }),
    name: food.name,
    category: food.category,
    per100g: food.per100g,
    servings: [...food.servings],
    notes: food.notes,
    source: food.source,
  };
}

/**
 * One of the profile's own foods as the picker reads it. `source` is null, and
 * the absence is deliberate: a catalogue entry must cite something anyone can
 * re-check because the APP asserts the number, while somebody's own food is
 * their claim about their own food — demanding a citation for it would be asking
 * them to prove something to their own diary.
 */
function userFoodOption(food: FitFood): FitFoodOption {
  return {
    ref: foodRefText({ kind: "user", id: food.id }),
    name: food.name,
    category: food.category,
    per100g: food.per100g,
    servings: food.servings,
    notes: food.notes,
    source: null,
  };
}

// --- Tabla (CANV slice a, migration 059) validators --------------------------
//
// SEC-EL-02 as everywhere: structural checks here, semantics in the store. Two
// things about this block are worth naming.
//
// **The name is capped in CHARACTERS, through `asCappedChars`** — migration
// 059's CHECK is `length(name)`, which SQLite counts in characters, and
// „Arhitektura“ and „Šema baze“ carry two-byte letters. See `asCappedChars`' own
// doc for the defect that rule was written from.
//
// **The scene is checked for LENGTH before it is parsed.** A scene arrives as
// text, and the one part of it with no natural size is an embedded image; the
// bound must therefore be applied to the string rather than after `JSON.parse`
// has already built a multi-megabyte object out of untrusted input.

/** A board's name: a non-empty string capped where migration 059's own CHECK caps it. */
function asCanvasBoardName(value: unknown, field: string): string {
  const name = asCappedChars(value, field, MAX_CANVAS_BOARD_NAME_LENGTH);
  if (name.trim().length === 0) {
    throw new Error(`Invalid IPC payload: "${field}" must not be blank.`);
  }
  return name;
}

/**
 * A scene document from an untrusted caller, through CANV's OWN validator — so a
 * JSON file that is not a scene is refused at the wire rather than at the column.
 *
 * Returns the text UNCHANGED rather than the canonical re-serialisation: the
 * store re-validates and canonicalises it anyway (it is the one that owns the
 * column's form), and canonicalising twice would mean serialising several
 * megabytes for nothing.
 */
function asCanvasScene(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  if (value.length > MAX_CANVAS_SCENE_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must not exceed ${MAX_CANVAS_SCENE_LENGTH} characters.`,
    );
  }
  if (parseCanvasScene(value) === null) {
    throw new Error(`Invalid IPC payload: "${field}" is not a valid canvas scene document.`);
  }
  return value;
}

// The card batch's validator is `asCanvasRefs` in `./canvasRefs.js` rather than
// here, and its own header says why: it is the one CANV validator whose refusals
// are worth a test, and nothing in this file is reachable from Vitest.

// --- ELEC: circuits, parts and wires (slice E1, migration 067) ---------------
//
// SEC-EL-02 as everywhere: structural checks here, semantics in the store — and
// the store re-asks every one of them through `@nexus/core`'s own gate, because
// a store never assumes its caller did. What this layer adds is the narrowing
// the wire cannot do. `rotation` and `colour` arrive as a plain number and a
// plain string, because the renderer is untrusted and the type it CLAIMS to
// send is not evidence; they leave as members of the two closed lists migration
// 067's CHECKs enforce.

function asCircuitName(value: unknown, field: string): string {
  const name = asCappedChars(value, field, MAX_CIRCUIT_NAME_LENGTH);
  if (name.trim().length === 0) {
    throw new Error(`Invalid IPC payload: "${field}" must not be blank.`);
  }
  return name;
}

/** Bounded, and allowed to be empty: a circuit nobody wrote a note about is the ordinary one. */
function asCircuitNotes(value: unknown, field: string): string {
  return asCappedChars(value, field, MAX_CIRCUIT_NOTES_LENGTH);
}

/**
 * Where a ROS 2 package goes: the user points at a colcon workspace's `src/`
 * and Nexus makes the package folder inside it (ADR-085 E4b).
 *
 * `createDirectory` so a first-ever workspace can be made in the picker rather
 * than in a terminal first; macOS shows the button, Windows always has one.
 */
const ROS_WORKSPACE_DIALOG: OpenDialogOptions = {
  title: ROS_WORKSPACE_DIALOG_TITLE,
  buttonLabel: ROS_WORKSPACE_DIALOG_BUTTON,
  properties: ["openDirectory", "createDirectory"],
};

/**
 * That a generated file's path really is inside the package directory.
 *
 * Nothing the renderer sends reaches here — `generateRosPackage` builds every
 * one of these paths, from a package name that is `[a-z0-9_]` by construction
 * — so this can only fire if that generator changes. Which is the point: it
 * makes „a future edit introduces a `..`" a thrown error rather than eight
 * files written somewhere the user did not choose.
 */
function assertInsidePackage(path: string): void {
  const outside =
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
  if (outside) throw new Error(`Generated package path escapes its directory: ${path}`);
}

function asPartCoordinate(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid IPC payload: "${field}" must be a finite number.`);
  }
  if (Math.abs(value) > MAX_PART_COORDINATE) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be within ±${MAX_PART_COORDINATE} of the origin.`,
    );
  }
  return value;
}

function asPartRotation(value: unknown, field: string): PartRotation {
  if (!(PART_ROTATIONS as readonly unknown[]).includes(value)) {
    throw new Error(`Invalid IPC payload: "${field}" must be one of 0, 90, 180 or 270.`);
  }
  return value as PartRotation;
}

/**
 * A component's chosen value — a resistor's ohms, a capacitor's farads.
 *
 * Whether the component takes one AT ALL is a catalogue question, and it is
 * asked by `circuitProblems` where the component is in hand. What is asked here
 * is only what migration 067's CHECK asks: that a stated one is a positive
 * finite number, because zero and negative resistances are not values a user
 * chose.
 */
function asPartValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid IPC payload: "${field}" must be a positive finite number.`);
  }
  return value;
}

/**
 * Which face of the machine a part sits on (ADR-085 E4c).
 *
 * A NAME rather than three coordinates, so a sensor's origin stays derived from
 * the body the user already dimensioned. WHETHER the part is one the simulator
 * has physics for is a catalogue question, asked in the generator — which lists
 * what it skipped rather than refusing the circuit. A mount on a resistor is
 * harmless and is reported honestly.
 */
function asPartMount(value: unknown, field: string): Mount {
  if (!isMount(value)) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be one of the five mounting faces by name.`,
    );
  }
  return value;
}

/**
 * The machine, all nine numbers at once (ADR-085 E4c).
 *
 * A LOOP over the two field lists, which is the opposite choice from
 * `asCircuitPartFields` above and for the opposite reason: there every key is
 * optional, so a loop would have to invent a default for each absent one, while
 * here every key is required and nine hand-written lines would be nine chances
 * to type one bound wrong once.
 *
 * The bounds are `chassis.ts`'s own constants, so this validator, the domain's
 * `chassisProblems` and migration 068's CHECKs are one number in one place.
 * Zero is refused along with the negatives: a body 0 cm long has zero inertia,
 * and a simulator does not refuse that — it simulates a machine that cannot be
 * pushed, which is the silent wrong answer.
 */
function asChassis(value: unknown, field: string): Chassis {
  const record = asRecord(value);
  const shape = record.shape;
  if (!isChassisShape(shape)) {
    throw new Error(`Invalid IPC payload: "${field}.shape" must be a chassis shape by name.`);
  }
  const measured = {} as Record<ChassisField, number>;
  for (const [names, max] of [
    [CHASSIS_LENGTHS, CHASSIS_MAX_CM],
    [CHASSIS_MASSES, CHASSIS_MAX_GRAMS],
  ] as const) {
    for (const name of names) {
      const number = record[name];
      if (typeof number !== "number" || !Number.isFinite(number) || number <= 0 || number > max) {
        throw new Error(
          `Invalid IPC payload: "${field}.${name}" must be a number above 0 and at most ${max}.`,
        );
      }
      measured[name] = number;
    }
  }
  return { shape, ...measured };
}

function asWireColour(value: unknown, field: string): WireColour {
  if (!(WIRE_COLOURS as readonly unknown[]).includes(value)) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be one of the nine jumper colours by name.`,
    );
  }
  return value as WireColour;
}

function asWireEnd(value: unknown, field: string): WireEnd {
  const end = asRecord(value);
  return {
    partId: asId(end.partId, `${field}.partId`),
    pinId: asId(end.pinId, `${field}.pinId`),
  };
}

/** A placed part, as `elec:add-part` carries it: everything but the id and the clock, which are main's. */
function asNewCircuitPart(value: unknown, field: string): NewCircuitPart {
  const part = asRecord(value);
  const chosen = part.value;
  return {
    componentId: asId(part.componentId, `${field}.componentId`),
    label: asCappedChars(part.label, `${field}.label`, MAX_PART_LABEL_LENGTH),
    x: asPartCoordinate(part.x, `${field}.x`),
    y: asPartCoordinate(part.y, `${field}.y`),
    rotation: asPartRotation(part.rotation, `${field}.rotation`),
    ...(chosen === undefined ? {} : { value: asPartValue(chosen, `${field}.value`) }),
    ...(part.mount === undefined ? {} : { mount: asPartMount(part.mount, `${field}.mount`) }),
  };
}

/**
 * A partial edit of a placed part — the payload that fires on every drag.
 *
 * Three states per field rather than two, and the middle one is why this
 * validator cannot be a loop over `asPartCoordinate`: an ABSENT key leaves the
 * field alone, a value replaces it, and `value: null` CLEARS it. A validator
 * that turned the absent key into a default would rewrite the four fields the
 * caller did not mention, on every drag.
 */
function asCircuitPartFields(value: unknown, field: string): UpdateCircuitPartFields {
  const fields = asRecord(value);
  return {
    ...(fields.label === undefined
      ? {}
      : { label: asCappedChars(fields.label, `${field}.label`, MAX_PART_LABEL_LENGTH) }),
    ...(fields.x === undefined ? {} : { x: asPartCoordinate(fields.x, `${field}.x`) }),
    ...(fields.y === undefined ? {} : { y: asPartCoordinate(fields.y, `${field}.y`) }),
    ...(fields.rotation === undefined
      ? {}
      : { rotation: asPartRotation(fields.rotation, `${field}.rotation`) }),
    ...(fields.value === undefined
      ? {}
      : { value: fields.value === null ? null : asPartValue(fields.value, `${field}.value`) }),
    ...(fields.mount === undefined
      ? {}
      : { mount: fields.mount === null ? null : asPartMount(fields.mount, `${field}.mount`) }),
  };
}

/** A wire, as `elec:add-wire` carries it. Whether its ends are parts OF THAT CIRCUIT is the store's question — no payload can answer it. */
function asNewCircuitWire(value: unknown, field: string): NewCircuitWire {
  const wire = asRecord(value);
  return {
    from: asWireEnd(wire.from, `${field}.from`),
    to: asWireEnd(wire.to, `${field}.to`),
    colour: asWireColour(wire.colour, `${field}.colour`),
  };
}

// `toWireDocument` and `toCircuitDocument` — the store's flat rows as the
// domain's nested documents — live in `elecDocument.ts`, next door. That file
// says why the conversion is main-side at all, and why it is not private to
// this one.

// --- FOCUS: the one running phase (UTIL slice b, ADR-077) --------------------
//
// SEC-EL-02 as everywhere: structural checks here, semantics in the store. Two
// of these fields are load-bearing beyond the column they land in —
// `plannedMinutes` decides how long main's own `setTimeout` sleeps for, and
// `kind` decides which notification the user is shown — so both are bounded
// against the store's OWN constants rather than against a second reading of
// what a phase may be.
//
// Every field is optional, and an ABSENT one means what `focus:start` meant
// before this slice: a subjectless, unplanned, uncounted `work` phase. That is
// how STUDY's timer keeps working through a widened channel without sending a
// single new key.

/** One of the three phase kinds, defaulting to `work` when the caller says nothing. */
function asFocusPhaseKind(value: unknown, field: string): FocusPhaseKind {
  if (value === undefined) return "work";
  if (typeof value !== "string" || !(FOCUS_PHASE_KINDS as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be one of: ${FOCUS_PHASE_KINDS.join(", ")}.`,
    );
  }
  return value as FocusPhaseKind;
}

/**
 * The phase's plan in whole minutes, or null for an open-ended one (STUDY's
 * timer). Bounded by the store's own ceiling, which is `validateFocusConfig`'s
 * widest — a renderer that asked for a million-minute phase would otherwise
 * arm a `setTimeout` main has to hold for two years.
 */
function asFocusPlannedMinutes(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  return asBoundedInteger(value, field, 1, MAX_FOCUS_PLANNED_MINUTES);
}

/** Which phase of the cycle this is; 0 (the store's own default) when the caller keeps no count. */
function asFocusCycleIndex(value: unknown, field: string): number {
  if (value === undefined) return 0;
  return asBoundedInteger(value, field, 0, MAX_FOCUS_CYCLE_INDEX);
}

/**
 * The phase's label snapshot. Capped in CHARACTERS rather than bytes, because
 * that is the store's own unit (`MAX_FOCUS_LABEL_LENGTH` is measured after a
 * trim) — `asCappedString`'s byte ceiling would refuse a perfectly legal
 * 200-character Serbian label the moment it carried enough š/č/ć to cross 200
 * bytes. That the label TRIMS, and that a blank one collapses to null, stays the
 * store's `validateLabel`: restating it here would be two places to change.
 */
function asFocusLabel(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > MAX_FOCUS_LABEL_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a string of at most ${MAX_FOCUS_LABEL_LENGTH} characters.`,
    );
  }
  return value;
}

function requireDb(): NexusDatabase {
  if (!db) throw new Error("Database is locked.");
  return db;
}

/** Mirrors `requireDb()`'s idiom for the attachment blob store's keys (ADR-019): absent means the session is locked. */
function requireBlobKeys(): BlobKeys {
  if (!blobKeys) throw new Error("The attachment store is locked.");
  return blobKeys;
}

function taskStore(profileId: string): TaskStore {
  return new TaskStore(requireDb().raw, profileId);
}

function taskListStore(profileId: string): TaskListStore {
  return new TaskListStore(requireDb().raw, profileId);
}

function taskTagStore(profileId: string): TaskTagStore {
  return new TaskTagStore(requireDb().raw, profileId);
}

function taskAttachmentStore(profileId: string): TaskAttachmentStore {
  return new TaskAttachmentStore(requireDb().raw, profileId);
}

function taskTemplateStore(profileId: string): TaskTemplateStore {
  return new TaskTemplateStore(requireDb().raw, profileId);
}

// --- Task templates (ADR-035): capture and apply -----------------------------
//
// Both directions live in main rather than in the renderer, and that is the
// whole security shape of this feature: the renderer names a task or a template
// and never sends a task-shaped payload, so there is nothing for it to forge.
// Main reads the row it is told to capture out of the database it already owns,
// and stamps every clock itself.

/**
 * A task's due date as a template's RELATIVE offset. Absent stays absent; a
 * date already past clamps to 0 rather than going negative, because "overdue by
 * three days" is not a shape worth reproducing — what the user is saving is the
 * habit, and today is the earliest honest reading of it. The clamp can never
 * strip an anchor: 0 is still a due date, so a captured rule or ladder keeps
 * something to phase from (`TaskTemplateStore` would refuse it otherwise).
 *
 * A `dueDate` that is not a bare calendar day derives to null. `TaskStore`
 * accepts a timestamped due date only on a task carrying neither a rule nor a
 * ladder (`assertDueDateAnchors`), so this can never drop an anchor either.
 * Beyond a year out, the offset saturates at the store's own cap — a template
 * is a habit, and a habit does not start in 2029.
 */
function taskTemplateDueOffset(dueDate: string | null, today: string): number | null {
  if (dueDate === null || !isValidDayKey(dueDate)) return null;
  const days = Math.round((dayKeyToUtcMs(dueDate) - dayKeyToUtcMs(today)) / 86_400_000);
  return Math.min(Math.max(days, 0), MAX_TASK_TEMPLATE_DUE_OFFSET_DAYS);
}

/**
 * Reads one task of `profileId` and everything a template captures WITH it: its
 * direct live subtasks, in the order the list draws them, and the names of the
 * tags it carries. `listActive()` is already scoped, ordered
 * (list/section/rank) and free of soft-deleted rows, so the two derivations
 * below need nothing beyond a filter — and a deleted subtask is left out for
 * the same reason a recurring advance does not reopen one.
 */
function captureTaskTemplatePayload(profileId: string, taskId: string): TaskTemplatePayload {
  const tasks = taskStore(profileId).listActive();
  const task = tasks.find((row) => row.id === taskId);
  if (!task) {
    throw new TaskNotFoundError(`No active task "${taskId}" in this profile.`);
  }

  const tags = taskTagStore(profileId);
  const tagIds = new Set(
    tags.listTagLinks().filter((link) => link.taskId === taskId).map((link) => link.tagId),
  );
  const tagNames = tags.listTags().filter((tag) => tagIds.has(tag.id)).map((tag) => tag.name);

  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueOffsetDays: taskTemplateDueOffset(task.dueDate, localToday()),
    reminderOffsets: task.reminderOffsets,
    recurrence: task.recurrence,
    tagNames,
    subtaskTitles: tasks.filter((row) => row.parentId === taskId).map((row) => row.title),
  };
}

/**
 * Creates a task from a template, in one transaction over the store calls: the
 * parent, its tags (get-or-created by name — which is what makes a template
 * outlive the tags it was captured with) and its subtasks are one act, and half
 * of it is a task the user did not ask for. `TaskStore.create` owns the list /
 * section / anchor rules, so this function validates none of them itself.
 *
 * The subtasks inherit their parent's placement, which `TaskStore.create`
 * enforces on its own — the `listId`/`sectionId` are deliberately not repeated
 * on them.
 */
function applyTaskTemplate(
  profileId: string,
  templateId: string,
  listId: string,
  sectionId: string | null,
): Task {
  const template = taskTemplateStore(profileId).get(templateId);
  const { payload } = template;
  const now = new Date().toISOString();
  const dueDate =
    payload.dueOffsetDays === null ? null : shiftDayKey(localToday(), payload.dueOffsetDays);
  const tasks = taskStore(profileId);
  const tags = taskTagStore(profileId);

  return requireDb().raw.transaction((): Task => {
    const parent = tasks.create({
      title: payload.title,
      description: payload.description,
      priority: payload.priority,
      dueDate,
      recurrence: payload.recurrence,
      reminderOffsets: payload.reminderOffsets,
      listId,
      sectionId,
    });

    for (const name of payload.tagNames) {
      tags.attachTag(parent.id, tags.createTag(name, now).id);
    }

    for (const title of payload.subtaskTitles) {
      tasks.create({ title, parentId: parent.id });
    }

    return parent;
  })();
}

function taskDependencyStore(profileId: string): TaskDependencyStore {
  return new TaskDependencyStore(requireDb().raw, profileId);
}

function eventStore(profileId: string): EventStore {
  return new EventStore(requireDb().raw, profileId);
}

function eventTemplateStore(profileId: string): EventTemplateStore {
  return new EventTemplateStore(requireDb().raw, profileId);
}

function calendarSettingsStore(profileId: string): CalendarSettingsStore {
  return new CalendarSettingsStore(requireDb().raw, profileId);
}

function peopleStore(profileId: string): PeopleStore {
  return new PeopleStore(requireDb().raw, profileId);
}

function documentStore(profileId: string): DocumentStore {
  return new DocumentStore(requireDb().raw, profileId);
}

function subjectStore(profileId: string): SubjectStore {
  return new SubjectStore(requireDb().raw, profileId);
}

function subjectAttachmentStore(profileId: string): SubjectAttachmentStore {
  return new SubjectAttachmentStore(requireDb().raw, profileId);
}

function subjectNoteLinkStore(profileId: string): SubjectNoteLinkStore {
  return new SubjectNoteLinkStore(requireDb().raw, profileId);
}

function examStore(profileId: string): ExamStore {
  return new ExamStore(requireDb().raw, profileId);
}

function deckStore(profileId: string): DeckStore {
  return new DeckStore(requireDb().raw, profileId);
}

function cardStore(profileId: string): CardStore {
  return new CardStore(requireDb().raw, profileId);
}

function planStore(profileId: string): PlanStore {
  return new PlanStore(requireDb().raw, profileId);
}

function topicStore(profileId: string): TopicStore {
  return new TopicStore(requireDb().raw, profileId);
}

/** One exam's effective topic list — the uniform answer of every topics:* channel (ADR-063). */
function effectiveTopics(profileId: string, examId: string): EffectiveExamTopic[] {
  return topicStore(profileId).listEffectiveByExam(examId, localToday());
}

function studySettingsStore(profileId: string): StudySettingsStore {
  return new StudySettingsStore(requireDb().raw, profileId);
}

function focusStore(profileId: string): FocusStore {
  return new FocusStore(requireDb().raw, profileId);
}

function statsStore(profileId: string): StatsStore {
  return new StatsStore(requireDb().raw, profileId);
}

function notificationStore(profileId: string): NotificationStore {
  return new NotificationStore(requireDb().raw, profileId);
}

function noteStore(profileId: string): NoteStore {
  return new NoteStore(requireDb().raw, profileId);
}

function noteOrgStore(profileId: string): NoteOrgStore {
  return new NoteOrgStore(requireDb().raw, profileId);
}

function noteAttachmentStore(profileId: string): NoteAttachmentStore {
  return new NoteAttachmentStore(requireDb().raw, profileId);
}

/** „Datoteke"'s read across the three attachment tables (DOC) — it writes nothing, so no handler above ever reaches for it. */
function attachmentIndexStore(profileId: string): AttachmentIndexStore {
  return new AttachmentIndexStore(requireDb().raw, profileId);
}

function noteTemplateStore(profileId: string): NoteTemplateStore {
  return new NoteTemplateStore(requireDb().raw, profileId);
}

function searchStore(profileId: string): SearchStore {
  return new SearchStore(requireDb().raw, profileId);
}

function searchHistoryStore(profileId: string): SearchHistoryStore {
  return new SearchHistoryStore(requireDb().raw, profileId);
}

/**
 * Finds one attachment via `list` and throws `NoteAttachmentNotFoundError` if
 * absent — `open`/`save-as` need the full row (file name, mime, hash) but the
 * store has no separate `get`, and its `list` is already scoped to an active
 * note in this profile, so this keeps that same profile/note gating intact.
 */
function requireNoteAttachment(profileId: string, noteId: string, attachmentId: string): NoteAttachment {
  const found = noteAttachmentStore(profileId)
    .list(noteId)
    .find((attachment) => attachment.id === attachmentId);
  if (!found) {
    throw new NoteAttachmentNotFoundError(`No attachment "${attachmentId}" on note "${noteId}".`);
  }
  return found;
}

/** `requireNoteAttachment`'s twin for tasks, and for the same reason: `TaskAttachmentStore.list` is already scoped to an active task of this profile, so resolving through it keeps that gate intact. */
function requireTaskAttachment(profileId: string, taskId: string, attachmentId: string): TaskAttachment {
  const found = taskAttachmentStore(profileId)
    .list(taskId)
    .find((attachment) => attachment.id === attachmentId);
  if (!found) {
    throw new TaskAttachmentNotFoundError(`No attachment "${attachmentId}" on task "${taskId}".`);
  }
  return found;
}

/** `requireTaskAttachment`'s twin for subjects, and for the same reason: `SubjectAttachmentStore.list` is already scoped to an active subject of this profile, so resolving through it keeps that gate intact. */
function requireSubjectAttachment(
  profileId: string,
  subjectId: string,
  attachmentId: string,
): SubjectAttachment {
  const found = subjectAttachmentStore(profileId)
    .list(subjectId)
    .find((attachment) => attachment.id === attachmentId);
  if (!found) {
    throw new SubjectAttachmentNotFoundError(
      `No material "${attachmentId}" on subject "${subjectId}".`,
    );
  }
  return found;
}

/**
 * The `doc:*` channels' one resolution path (ADR-064):
 * `requireNoteAttachment` / `requireTaskAttachment` / `requireSubjectAttachment`,
 * selected by the request's module — the SAME stores the per-module
 * open/save-as handlers resolve through, so their profile/record gates hold
 * here verbatim, and a hash only ever comes out of a row main resolved itself.
 */
function requireDocAttachment(
  module: DocAttachmentModule,
  profileId: string,
  id: string,
  attachmentId: string,
): NoteAttachment | TaskAttachment | SubjectAttachment {
  switch (module) {
    case "note":
      return requireNoteAttachment(profileId, id, attachmentId);
    case "task":
      return requireTaskAttachment(profileId, id, attachmentId);
    case "subject":
      return requireSubjectAttachment(profileId, id, attachmentId);
  }
}

// --- Blob reference counting (ADR-014/ADR-019 + migrations 024/030/035/040) --
//
// THE place that enumerates every table naming a blob. One on-disk store is
// shared by every module that lets a user hang bytes off a row, so a blob is
// orphaned only when NO table names it anymore — a GC that consulted one table
// would delete a file another still points at, and that is silent data loss.
// That is also what makes a dashboard background shared byte-for-byte with an
// attachment ONE file on disk that survives either row's deletion (ADR-041).
// Both helpers below are DELIBERATELY profile-agnostic (each store's own
// `refCount`/`mimeForHash` is, see their doc comments): the store is
// content-addressed across the whole database, so a count that saw one
// profile's rows would be the same bug one profile smaller.
//
// A module that gains blobs widens exactly these two functions.

/** How many rows — across every blob-naming table and every profile — hold this hash. */
function blobRefCount(profileId: string, sha256: string): number {
  return (
    noteAttachmentStore(profileId).refCount(sha256) +
    taskAttachmentStore(profileId).refCount(sha256) +
    subjectAttachmentStore(profileId).refCount(sha256) +
    dashboardSettingsStore(profileId).refCount(sha256) +
    // The `profiles` table itself (SET-001, migration 040) — the fifth member,
    // and the only one whose store takes no profile id, because that table IS
    // the profile list. Its count is profile-agnostic like every other here.
    profileStore().refCount(sha256)
  );
}

/** The main-sniffed mime registered for this hash by whichever table holds it, or null when no row anywhere does. */
function blobMimeForHash(profileId: string, sha256: string): string | null {
  return (
    noteAttachmentStore(profileId).mimeForHash(sha256) ??
    taskAttachmentStore(profileId).mimeForHash(sha256) ??
    subjectAttachmentStore(profileId).mimeForHash(sha256) ??
    dashboardSettingsStore(profileId).mimeForHash(sha256) ??
    // A profile picture is served by `nx-blob:` on exactly the terms an inline
    // note image is, and THIS line is the gate: `registerBlobProtocol` 404s any
    // hash whose mime resolves to null, so a picture becomes servable at the
    // moment `profiles` joins this union and not before.
    profileStore().mimeForHash(sha256)
  );
}

function flagStore(profileId: string): SqliteFlagStore {
  return new SqliteFlagStore(requireDb().raw, profileId);
}

function dashboardSettingsStore(profileId: string): DashboardSettingsStore {
  return new DashboardSettingsStore(requireDb().raw, profileId);
}

function dashboardWidgetStore(profileId: string): DashboardWidgetStore {
  return new DashboardWidgetStore(requireDb().raw, profileId);
}

function backupSettingsStore(profileId: string): BackupSettingsStore {
  return new BackupSettingsStore(requireDb().raw, profileId);
}

function privateNoteStore(profileId: string): PrivateNoteStore {
  return new PrivateNoteStore(requireDb().raw, profileId);
}

function privateSettingsStore(profileId: string): PrivateSettingsStore {
  return new PrivateSettingsStore(requireDb().raw, profileId);
}

function dashboardSetStore(profileId: string): DashboardSetStore {
  return new DashboardSetStore(requireDb().raw, profileId);
}

// FIN (migration 051). Both interchange flows gather through these — which is
// what made a FIN row ride in every archive and every restore from the day the
// tables existed rather than from the day a page could draw them — and since
// slice b the `fin-*:*` channels below serve the „Finansije" page from the
// same three stores.
function finAccountStore(profileId: string): FinAccountStore {
  return new FinAccountStore(requireDb().raw, profileId);
}

function finCategoryStore(profileId: string): FinCategoryStore {
  return new FinCategoryStore(requireDb().raw, profileId);
}

function finTransactionStore(profileId: string): FinTransactionStore {
  return new FinTransactionStore(requireDb().raw, profileId);
}

function finRecurringStore(profileId: string): FinRecurringStore {
  return new FinRecurringStore(requireDb().raw, profileId);
}

function habitStore(profileId: string): HabitStore {
  return new HabitStore(requireDb().raw, profileId);
}

// FIT (migration 058). Three stores and no fourth: the app's food catalogue
// ships as JSON inside `@nexus/core` rather than as rows, so nothing here reads
// or writes it.
function fitFoodStore(profileId: string): FitFoodStore {
  return new FitFoodStore(requireDb().raw, profileId);
}

function fitMealStore(profileId: string): FitMealStore {
  return new FitMealStore(requireDb().raw, profileId);
}

function fitTargetStore(profileId: string): FitTargetStore {
  return new FitTargetStore(requireDb().raw, profileId);
}

// FIT training and body (migration 060). Five more stores, and still no store
// for the exercise catalogue: it ships as JSON inside `@nexus/core` exactly as
// the food catalogue does, so nothing here reads or writes it.
function fitExerciseStore(profileId: string): FitExerciseStore {
  return new FitExerciseStore(requireDb().raw, profileId);
}

function fitRoutineStore(profileId: string): FitRoutineStore {
  return new FitRoutineStore(requireDb().raw, profileId);
}

function fitWorkoutStore(profileId: string): FitWorkoutStore {
  return new FitWorkoutStore(requireDb().raw, profileId);
}

function fitMeasurementStore(profileId: string): FitMeasurementStore {
  return new FitMeasurementStore(requireDb().raw, profileId);
}

function fitBodyProfileStore(profileId: string): FitBodyProfileStore {
  return new FitBodyProfileStore(requireDb().raw, profileId);
}

// CANV (migration 059). One store over one table — a board IS its drawing, so
// there is no second store for the scenes.
function canvasStore(profileId: string): CanvasStore {
  return new CanvasStore(requireDb().raw, profileId);
}

// ELEC (migration 067). One store over THREE tables, because a circuit is
// three tables: its own row, the parts placed on it and the wires between
// them. The COMPONENTS are not among them — the catalogue ships as constants
// in `@nexus/core` and is versioned with the application.
function electronicsStore(profileId: string): ElectronicsStore {
  return new ElectronicsStore(requireDb().raw, profileId);
}

/** The whole sets state every `dash:*-set` channel answers with (ADR-055): the named boards in board order plus the active choice. */
function dashboardSetsState(profileId: string): DashboardSetsState {
  const store = dashboardSetStore(profileId);
  return {
    sets: store.list().map((set) => ({ id: set.id, name: set.name })),
    activeSetId: store.activeSetId(),
  };
}

/**
 * Mirrors `requireDb()`'s idiom for the session's data key: absent means
 * locked. Only two things ever read the key — `auth:regenerate-recovery` (its
 * own inline check predates this helper) and the backup passphrase wrap/unwrap
 * (ADR-056), both unreachable from a locked renderer, so a throw here is a
 * renderer bug surfacing, never an expected refusal.
 */
function requireUnlockedDataKeyHex(): string {
  if (unlockedDataKeyHex === null) throw new Error("The data key is locked.");
  return unlockedDataKeyHex;
}

// --- Sync (the cloud half) --------------------------------------------------
//
// ONE service, built once per launch, and everything network-shaped decided
// inside it at that moment: `cloud.json` and the build's project configuration
// are read at construction, and the ports either exist or do not. That is why
// this is a memoised singleton rather than a fresh object per call — a second
// instance could read a `cloud.json` the first one has since rewritten, and the
// two halves of the boundary would disagree about the same launch.
//
// The two accessors it is given are the ones the rest of main already uses for
// „is the session open": both throw while locked, and the service turns that
// into a named refusal rather than letting it surface as an exception.
let syncServiceInstance: SyncService | null = null;

function syncService(): SyncService {
  syncServiceInstance ??= createSyncService({
    userDataPath: userDataDir(),
    env: buildCloudEnv(),
    // The one socket in the application — `net.fetch`, on the default session,
    // and therefore inside all four cloud-off layers. See `sync/port.ts`.
    fetch: electronCloudFetch,
    accountStore: () => new SyncAccountStore(requireDb().raw),
    dataKeyHex: requireUnlockedDataKeyHex,
    // Resolved per round, exactly like every other store literal in this file:
    // `requireDb()` throws while locked, and a handle captured once would be a
    // handle to a database the user has since closed.
    syncStore: (profileId) => {
      const raw = requireDb().raw;
      return syncStoreFor(new SyncJournal(raw), new SyncProgressStore(raw), profileId);
    },
    now: () => new Date(),
    // The window watches instead of polling. Nothing here is key-shaped — a
    // profile id, a phase, four counts and a machine-readable problem — and a
    // window that has gone away is simply not sent to.
    onActivity: (activity) => {
      mainWindow?.webContents.send(IpcChannel.syncActivityChanged, activity);
    },
  });
  return syncServiceInstance;
}

// --- Elektronika's external runner (ADR-085 E6, DEV-007) ---------------------
//
// ONE runner, built once per launch, on `syncService`'s terms and for a sharper
// reason: it is the app's second capability boundary — the network was the first
// — and a second instance would be a second process table the app could not see
// the whole of. `stopping` is not per-window and not per-profile; it is a fact
// about this computer.
//
// The timeouts are here rather than in `elecRunner.ts` because they are
// decisions about a USER's machine and not about the runner's logic: how long a
// stop waits before it stops believing the CLI, and how long a probe may take
// before the panel is told the tool did not answer. The consent copy's promise
// is that nothing runs without the user asking; these three numbers are what the
// app does when the thing it asked does not answer.
let elecRunnerIpc: ElecRunnerIpc | null = null;

function runnerIpc(): ElecRunnerIpc {
  elecRunnerIpc ??= createElecRunnerIpc({
    runner: createElecRunner(
      {
        // A `docker.exe` that will not die is not evidence that the container
        // did; this is how long the ladder waits before asking the container.
        stopTimeoutMs: 5_000,
        // A tool that is installed but hangs — which is what `wsl.exe` does
        // with the WSL service stopped — must not leave the panel silent.
        probeTimeoutMs: 10_000,
        // The container's own probe, against a local daemon. A daemon that is
        // not answering is a daemon whose answer is „still running", which is
        // what the threat model asks for rather than a clean bill of health.
        containerTimeoutMs: 10_000,
      },
      {
        // A window that has gone away is simply not sent to, `syncService`'s
        // arrangement: the run belongs to main and outlives any one window.
        output: (text) => {
          mainWindow?.webContents.send(IpcChannel.elecRunnerOutput, { text });
        },
        changed: (state) => {
          mainWindow?.webContents.send(IpcChannel.elecRunnerChanged, state);
        },
      },
    ),
    // A fresh store per call, exactly like every other store literal in this
    // file: `requireDb()` throws while locked, and a handle captured once would
    // be a handle to a database the user has since closed.
    settings: (profileId) => elecSettingsStore(profileId).get(),
    save: (profileId, changes, now) => elecSettingsStore(profileId).update(changes, now),
    circuit: (profileId, id) => toCircuitDocument(electronicsStore(profileId).read(id)),
    accountDir: activeAccountDir,
    now: () => new Date().toISOString(),
  });
  return elecRunnerIpc;
}

/**
 * `elec_settings` — the runner's switch, choice and consent (migration 069).
 *
 * A fresh store per call, `electronicsStore`'s own arrangement: the handle has
 * to be resolved at the moment of use, because a database the user has locked
 * between two calls must not be written through a handle captured before it.
 */
function elecSettingsStore(profileId: string): ElecSettingsStore {
  return new ElecSettingsStore(requireDb().raw, profileId);
}

// --- Search (ADR-021): the query pipeline -----------------------------------
//
// Extracted as named functions rather than closures inside `ipcMain.handle`,
// because `runSmokeSearchRehearsal` below calls the exact same code path the
// renderer does.

/** How many bm25 candidates the store is asked for per requested result: `rankSearchResults` re-orders by recency/kind prior/title on top of bm25, and it can only re-order what it was given. */
const SEARCH_CANDIDATE_FACTOR = 3;

/** Radius (chars) `buildSearchSnippet` reaches around a title's first match — generous enough that most titles fit whole, while still bounding a pathologically long one. */
const TITLE_SNIPPET_RADIUS = 120;

/**
 * The two kinds whose INDEXED body carries text their result row does not show
 * (migration 048): a task, which matches on its attached files' contents behind
 * their names, and a note attachment, whose own file's contents ride its entry.
 * Every other kind's `body_folded` is exactly `nx_fold(body)`, so a match on one
 * of those is always visible in the snippet — which is what makes the
 * "highlighted nothing" test below sound rather than a guess.
 */
const ATTACHMENT_TEXT_KINDS: ReadonlySet<SearchKind> = new Set<SearchKind>(["task", "attachment"]);

/**
 * Maps one store hit to the wire shape. Reusing `buildSearchSnippet` for the
 * TITLE too is deliberate: it is the same operation as for the body — find
 * the matched span, return the surrounding text plus highlight ranges — and
 * it doubles as a bound on a pathologically long title. `title`/`titleRanges`
 * and `snippet`/`snippetRanges` are each internally consistent (the ranges
 * index into their own returned string), never into the source entity's full
 * text.
 *
 * `fromAttachment` is read off those same ranges rather than fetched: a hit
 * that came back from FTS with terms typed, and yet highlights nothing in
 * either string, matched something indexed but not displayed — and after
 * migration 048 the only such text in the whole index is an attachment's
 * extracted contents, on exactly the two kinds above. Costs no extra query and
 * no extra column; the alternative would be re-reading every result's
 * attachment rows to compare strings against them.
 *
 * `matchedByFts` is what makes that reasoning sound, and is stated by the
 * caller rather than inferred from `terms`: rows sourced from `recent` never
 * matched anything at all, so "highlights nothing" says nothing about them —
 * and the browse paths really can carry terms (a query whose every term is
 * unusable as an FTS expression falls through to `recent` with those terms
 * still in hand).
 */
function toSearchResult(
  hit: SearchHit,
  terms: readonly string[],
  matchedByFts: boolean,
): SearchResult {
  const title = buildSearchSnippet(hit.title, terms, { radius: TITLE_SNIPPET_RADIUS });
  const snippet = buildSearchSnippet(hit.body, terms);
  return {
    kind: hit.kind,
    entityId: hit.entityId,
    parentId: hit.parentId,
    title: title.text,
    titleRanges: [...title.ranges],
    snippet: snippet.text,
    snippetRanges: [...snippet.ranges],
    contextDate: hit.contextDate,
    updatedAt: hit.updatedAt,
    fromAttachment:
      matchedByFts &&
      terms.length > 0 &&
      title.ranges.length === 0 &&
      snippet.ranges.length === 0 &&
      ATTACHMENT_TEXT_KINDS.has(hit.kind),
  };
}

/** `SearchStore.recent`'s hits, kind-filtered when asked — the raw rows behind `runRecentSearch` and the operator-only query path below. */
function recentHits(
  profileId: string,
  limit: number,
  kinds: readonly SearchKind[],
): SearchHit[] {
  const store = searchStore(profileId);
  return kinds.length > 0 ? store.recent({ limit, kinds }) : store.recent({ limit });
}

/**
 * The profile's enabled-module set (SET-007), resolved exactly as the shell
 * resolves it — the same `resolveEnabled` over the same shared manifests, fed
 * by the profile's own flag rows. This is what drives the search-result module
 * gate (ADR-058 §5, `filterSearchHitsByModules`): results gain the gate the
 * palette's COMMANDS have always had renderer-side, from the same two inputs.
 */
async function enabledModuleIdsFor(profileId: string): Promise<ReadonlySet<string>> {
  return new Set(resolveEnabled(moduleRegistry, await flagStore(profileId).get()));
}

/**
 * The profile's most recently touched entries, already in their FINAL order
 * (`SearchStore.recent`) — deliberately NOT passed through
 * `rankSearchResults`, which would reorder them by kind prior/recency instead
 * of the plain "most recently touched" order an empty query is supposed to
 * show. Snippet terms are empty, so each snippet is just the head of its body.
 *
 * `kinds` matters because this is also where a *kind-only* query lands: the
 * palette's chips send `z:` with no words behind it, which has no matchable
 * term and so falls through here from `runSearchQuery`. Dropping the filter at
 * that point would answer "show me only my tasks" with everything.
 *
 * Sourced at `MAX_SEARCH_LIMIT` rather than `limit` since the module gate
 * (ADR-058 §5) became a post-filter: a list cut to `limit` BEFORE gating would
 * come up short exactly when a module is disabled. Order is untouched — the
 * gate only removes rows — so the first `limit` survivors are the same rows
 * the ungated list would have led with.
 */
async function runRecentSearch(
  profileId: string,
  limit: number,
  kinds: readonly SearchKind[] = [],
): Promise<SearchResult[]> {
  const enabled = await enabledModuleIdsFor(profileId);
  return filterSearchHitsByModules(recentHits(profileId, MAX_SEARCH_LIMIT, kinds), enabled)
    .slice(0, limit)
    .map((hit) => toSearchResult(hit, [], false));
}

/** Every entity id carrying a tag whose `foldSearchTag` form starts with `token`, for one `#` token and one module. */
function tagFilterIds(
  tags: ReadonlyArray<{ readonly id: string; readonly folded: string }>,
  linksByTagId: ReadonlyMap<string, readonly string[]>,
  token: string,
): Set<string> {
  const ids = new Set<string>();
  for (const tag of tags) {
    if (!tag.folded.startsWith(token)) continue;
    for (const entityId of linksByTagId.get(tag.id) ?? []) ids.add(entityId);
  }
  return ids;
}

/** Groups tag links by their tag id, so each `#` token walks the tags once instead of the whole link table. */
function groupLinksByTagId(
  links: ReadonlyArray<{ readonly entityId: string; readonly tagId: string }>,
): Map<string, string[]> {
  const byTag = new Map<string, string[]>();
  for (const link of links) {
    const bucket = byTag.get(link.tagId);
    if (bucket) bucket.push(link.entityId);
    else byTag.set(link.tagId, [link.entityId]);
  }
  return byTag;
}

/**
 * One `{ taskIds, noteIds }` set per `#` token, computed from an already-read
 * `tagFacetSources` snapshot (each name folded exactly ONCE however many
 * tokens were typed — the per-token work is a prefix scan over an
 * already-folded list). Taking the sources rather than a profileId is what
 * lets `runSearchPage` share ONE read between this filter and its facet rows.
 */
function buildTagMatches(
  sources: readonly TagFacetSource[],
  tokens: readonly string[],
): SearchTagMatch[] {
  const note = sources.find((source) => source.kind === "note");
  const task = sources.find((source) => source.kind === "task");
  const foldTags = (source: TagFacetSource | undefined) =>
    (source?.tags ?? []).map((tag) => ({ id: tag.id, folded: foldSearchTag(tag.name) }));
  const foldedNoteTags = foldTags(note);
  const foldedTaskTags = foldTags(task);
  const noteLinks = groupLinksByTagId(note?.links ?? []);
  const taskLinks = groupLinksByTagId(task?.links ?? []);

  return tokens.map((token) => ({
    taskIds: tagFilterIds(foldedTaskTags, taskLinks, token),
    noteIds: tagFilterIds(foldedNoteTags, noteLinks, token),
  }));
}

/**
 * Resolves the parsed operators against this profile's data: each `#` token
 * into the ids it matches, and a `rok:` filter into real day bounds using
 * MAIN's local today — the renderer never gets to say what day it is (SEC-EL).
 * Returns null when the query carries no operators at all, which is also what
 * tells the caller to keep the untouched pipeline (and what keeps an ordinary
 * query from touching the tag tables at all).
 */
function searchOperatorFilters(
  profileId: string,
  parsed: ParsedSearchQuery,
): SearchOperatorFilters | null {
  if (parsed.tags.length === 0 && parsed.due === null) return null;
  return {
    tagMatches: parsed.tags.length > 0 ? buildTagMatches(tagFacetSources(profileId), parsed.tags) : [],
    dueRange: parsed.due === null ? null : resolveDueRange(parsed.due, localToday()),
  };
}

/**
 * Parses the raw query, asks the store for bm25 candidates (more than
 * `limit` — see `SEARCH_CANDIDATE_FACTOR` — since `rankSearchResults` can
 * only re-order what it was given), re-ranks them with recency/kind
 * prior/title boosts on top of bm25, then truncates to `limit`. Falls back to
 * `runRecentSearch` when the query has no matchable terms:
 * `toFtsMatchExpression` returns null for exactly that case, precisely so an
 * empty or punctuation-only query never reaches the store as a malformed FTS
 * expression.
 *
 * The `#oznaka` / `rok:` operators are POST-filters (see `searchOperators.ts`
 * on why they cannot be SQL), which changes candidate sourcing in two places:
 * with an operator active the store is asked for `MAX_SEARCH_LIMIT` candidates
 * rather than a small multiple of `limit`, since an unknown share of them is
 * about to be filtered away; and an operator with NO text terms — a perfectly
 * ordinary "#posao" — takes the `recent` path instead of falling through to an
 * unfiltered recent list, keeping that method's own recency order (it must
 * never be re-ranked, per its contract) rather than pretending to a relevance
 * it has no query to measure.
 */
async function runSearchQuery(
  profileId: string,
  rawQuery: string,
  limit: number,
): Promise<SearchResult[]> {
  const parsed = parseSearchQuery(rawQuery);
  const filters = searchOperatorFilters(profileId, parsed);
  const match = toFtsMatchExpression(parsed.terms, { prefixLast: parsed.prefixLast });

  if (match === null) {
    if (filters === null) return runRecentSearch(profileId, limit, parsed.kinds);
    const enabled = await enabledModuleIdsFor(profileId);
    const hits = filterSearchHitsByModules(
      recentHits(profileId, MAX_SEARCH_LIMIT, parsed.kinds),
      enabled,
    );
    return applySearchOperators(hits, filters)
      .slice(0, limit)
      .map((hit) => toSearchResult(hit, [], false));
  }

  const store = searchStore(profileId);
  // Clamped to `MAX_SEARCH_LIMIT` HERE rather than left to the store: the
  // store's own ceiling rose to `MAX_SEARCH_BROWSE_LIMIT` for the ADR-039
  // page, and without this the palette would silently start pulling 300
  // candidates where it used to be cut off at 200. 200 is still the palette's
  // bound (ADR-030 §3 / ADR-039 §4) — an overlay showing a couple of screens
  // of results has no use for more.
  const candidateLimit =
    filters === null
      ? Math.min(limit * SEARCH_CANDIDATE_FACTOR, MAX_SEARCH_LIMIT)
      : MAX_SEARCH_LIMIT;
  const candidates =
    parsed.kinds.length > 0
      ? store.search({ match, limit: candidateLimit, kinds: parsed.kinds })
      : store.search({ match, limit: candidateLimit });
  // The enabled-module gate (ADR-058 §5) is applied to the CANDIDATES, before
  // operators and ranking, so a page of `limit` results is filled from rows
  // that may actually be shown rather than thinned after the cut.
  const gated = filterSearchHitsByModules(candidates, await enabledModuleIdsFor(profileId));
  const filtered = filters === null ? gated : applySearchOperators(gated, filters);

  const ranked = rankSearchResults(filtered, { now: new Date().toISOString(), query: parsed });
  return ranked.slice(0, limit).map((hit) => toSearchResult(hit, parsed.terms, true));
}

/**
 * The tag data facet counting is computed from, read the same way for both
 * modules that carry tags. Extracted so the search page and any future tag
 * reader cannot drift on which rows count as "this profile's tags": both
 * stores already scope every statement by `profile_id`, and both list the
 * ACTIVE (non-soft-deleted) links only, so no filtering is layered on here.
 *
 * `entityId` is the one normalization: the stores spell the owning id
 * `noteId`/`taskId`, while core's facet helper is deliberately kind-agnostic.
 */
function tagFacetSources(profileId: string): TagFacetSource[] {
  const notes = noteOrgStore(profileId);
  const tasks = taskTagStore(profileId);
  return [
    {
      kind: "note",
      tags: notes.listTags(),
      links: notes.listTagLinks().map((link) => ({ entityId: link.noteId, tagId: link.tagId })),
    },
    {
      kind: "task",
      tags: tasks.listTags(),
      links: tasks.listTagLinks().map((link) => ({ entityId: link.taskId, tagId: link.tagId })),
    },
  ];
}

/**
 * The ADR-039 search page pipeline. Same parse/rank pieces as
 * `runSearchQuery`, differing in three ways that are the whole point of the
 * page:
 *
 *  1. Candidates are sourced over **every** kind at `MAX_SEARCH_BROWSE_LIMIT`,
 *     never narrowed in SQL, because the facet counts have to be computed
 *     over the un-narrowed set — a chip that reads "Zadaci 12" is answering
 *     "what would this narrowing give you", which it cannot do if the
 *     narrowing already happened upstream of the count.
 *  2. Kind narrowing therefore happens here, in memory, AFTER counting.
 *  3. `truncated` is reported honestly: when the candidate array came back
 *     exactly at the bound, the store had no way to tell us whether more
 *     existed, so `total` is a floor and the page must say so rather than
 *     print a number it never measured.
 *
 * The termless path keeps `SearchStore.recent`'s recency order and is NOT
 * re-ranked — that method's documented contract, the same rule
 * `runRecentSearch` follows.
 *
 * Operators (`#oznaka`, `rok:`) are resolved exactly as in `runSearchQuery` —
 * `parseSearchQuery` keeps the tokens out of the FTS text itself and
 * `applySearchOperators` post-filters (ADR-030, inherited unchanged per
 * ADR-039's consequence note) — with one difference: the tag tables are read
 * ONCE per request (`tagFacetSources`) and shared between the operator filter
 * and the facet rows, where the palette path reads them only when a `#` token
 * is present.
 */
async function runSearchPage(profileId: string, rawQuery: string): Promise<SearchPageResult> {
  const parsed = parseSearchQuery(rawQuery);
  const match = toFtsMatchExpression(parsed.terms, { prefixLast: parsed.prefixLast });
  const store = searchStore(profileId);

  const sourced: SearchHit[] =
    match === null
      ? store.recent({ limit: MAX_SEARCH_BROWSE_LIMIT })
      : store.search({ match, limit: MAX_SEARCH_BROWSE_LIMIT });
  // Read off the PRE-gate length: the bound is the store's, and only a sourced
  // set that hit it can be hiding more rows.
  const truncated = sourced.length >= MAX_SEARCH_BROWSE_LIMIT;
  // ADR-058 §5: the enabled-module gate, applied before the operators and
  // before EVERY count below — so a disabled module surfaces neither rows nor
  // phantom facet chips (`kindCounts`/`tagFacets` are computed strictly
  // post-gate, and a kind with nothing left simply never appears in them).
  const candidates = filterSearchHitsByModules(sourced, await enabledModuleIdsFor(profileId));

  const sources = tagFacetSources(profileId);
  const filters: SearchOperatorFilters | null =
    parsed.tags.length === 0 && parsed.due === null
      ? null
      : {
          tagMatches: parsed.tags.length > 0 ? buildTagMatches(sources, parsed.tags) : [],
          dueRange: parsed.due === null ? null : resolveDueRange(parsed.due, localToday()),
        };
  // Operators are applied BEFORE the facets are counted (ADR-039 §3 step 3),
  // so a facet row reports what it would leave you with rather than what you
  // already asked for.
  const operated = filters === null ? candidates : applySearchOperators(candidates, filters);

  // Counted over the pre-kind set (ADR-039 §3 step 3).
  const kindCounts = countSearchKinds(operated);
  const tagFacets = buildSearchTagFacets(operated, sources);

  const kinds = new Set(parsed.kinds);
  const narrowed = kinds.size > 0 ? operated.filter((hit) => kinds.has(hit.kind)) : operated;
  const ordered =
    match === null
      ? narrowed
      : rankSearchResults(narrowed, { now: new Date().toISOString(), query: parsed });

  return {
    hits: ordered
      .slice(0, SEARCH_PAGE_MAX_RESULTS)
      .map((hit) => toSearchResult(hit, parsed.terms, match !== null)),
    total: ordered.length,
    truncated,
    kindCounts: kindCounts.map(({ kind, count }) => ({ kind, count })),
    tagFacets: tagFacets.map(({ name, token, count }) => ({ name, token, count })),
  };
}

// --- Auth (ADR-018): the local account gate ---------------------------------
//
// `main/auth.ts` owns the keychain file and the OS keystore; everything here
// composes its functions with this process's own state (`db`, the
// notification scheduler) and turns its thrown `AuthError`s into the wire-safe
// `AuthResult` every expected refusal returns. An unexpected failure (a
// corrupt database, a filesystem error) is left to throw — the renderer's
// generic error path exists for those, and `AuthError` narrowing below is
// exactly what tells the two apart.

/**
 * One account's on-disk status, with a damaged key chain reported as a plain
 * locked account instead of a thrown error. `auth:status` answers for EVERY
 * account at once (ADR-044), so one unparseable file must not be able to take
 * the whole picker down and strand the healthy accounts beside it. Nothing is
 * hidden by this: the moment that account is actually unlocked,
 * `unlockWithPasscode` raises the same `corruptKeychain` and the lock screen
 * says so in as many words — which is the screen where the user can do
 * something about it, unlike the generic load-failure page a thrown status
 * would have produced.
 */
function readAccountStatusSafely(dir: string): Omit<AuthStatus, "accounts" | "selectedAccountId"> {
  try {
    return readStatus(dir);
  } catch {
    return {
      state: "locked",
      lockedForMs: 0,
      keystoreAvailable: isKeystoreAvailable(),
      requiresRecovery: false,
    };
  }
}

/**
 * `auth.readStatus` can only ever report "uninitialized" or "locked" — it has
 * no way to know the database is open in this process. Only `db !== null`
 * means genuinely unlocked this session, so that is layered on top here.
 *
 * The per-account flags (`state`, `lockedForMs`, `requiresRecovery`) describe
 * the SELECTED account (ADR-044); `accounts` carries every account's label plus
 * the one live fact the picker draws a state line from. `requiresRecovery` is
 * read per account rather than assumed device-wide precisely because each
 * account's guard is bound to its own device secret — one carried in from
 * another machine needs its Kit while its neighbours unlock normally.
 */
function computeAuthStatus(): AuthStatus {
  const userData = userDataDir();
  const accounts: AccountSummary[] = readRegistry(userData).accounts.map((entry) => ({
    ...entry,
    requiresRecovery: readAccountStatusSafely(accountDir(userData, entry.id)).requiresRecovery,
  }));

  if (activeAccountId === null) {
    return {
      state: "uninitialized",
      lockedForMs: 0,
      keystoreAvailable: isKeystoreAvailable(),
      requiresRecovery: false,
      accounts,
      selectedAccountId: null,
    };
  }

  const fileStatus = readAccountStatusSafely(activeAccountDir());
  return {
    ...fileStatus,
    ...(db !== null ? { state: "unlocked" as const } : {}),
    accounts,
    selectedAccountId: activeAccountId,
  };
}

/**
 * The scheduler's store bundle, resolved at call time like every other deps
 * literal here. Extracted because TWO places now start the scheduler — the
 * unlock path below and the `profiles:set-active` restart (ADR-058) — and the
 * two must never drift on what it reads. `activeProfileId` resolves through
 * `resolveActiveProfileId` on every call, so the scheduler always serves a
 * LIVE profile: the reported one, or the personal anchor before any report
 * lands (the rule's unlock default).
 */
function notificationSchedulerDeps(): NotificationSchedulerDeps {
  return {
    listProfiles: () => listProfiles(requireDb()),
    activeProfileId: () => resolveActiveProfileId(listProfiles(requireDb()), activeProfileId),
    documentStore,
    eventStore,
    examStore,
    subjectStore,
    planStore,
    taskStore,
    // FIN slice d: the check both GENERATES the charges that have come due and
    // reminds about the renewals ahead, so it needs the subscriptions — and the
    // accounts, for the currency a reminder's amount is stated in.
    finRecurringStore,
    finAccountStore,
    // HABIT slice c: the habits that carry a `reminder_time`, and the week of
    // ticks that says which of them are already done.
    habitStore,
    notificationStore,
    // SET-007: a module switched off stops reminding, the way it already stops
    // appearing in the sidebar, on the dashboard and in search. Read on every
    // check rather than captured once — a flag toggled in Podešavanja must take
    // effect on the next cycle, not on the next unlock.
    enabledModuleIds: (profileId) =>
      new Set(resolveEnabled(moduleRegistry, flagStore(profileId).getSync())),
    getMainWindow: () => mainWindow,
  };
}

/** Starts everything that only makes sense once the database is open. Never during an automated run — a scheduled check firing mid-sweep would make its deterministic exit flaky, the same reason `app.whenReady` used to skip it. */
function startUnlockedServices(): void {
  if (isAutomatedRun) return;
  startNotificationScheduler(notificationSchedulerDeps());
  // Sync follows the profile that is open, on the same rule and through the same
  // resolver the notification scheduler uses — so the two can never be serving
  // different profiles. A machine with cloud off, or with no account, refuses
  // its first round before making any request and the loop stops itself; there
  // is deliberately no second copy of „should we be syncing" here. A file with
  // no profile at all has nothing to bind to; `profiles:set-active` opens the
  // loop the moment the first one is created and landed on.
  const syncProfileId = resolveActiveProfileId(listProfiles(requireDb()), activeProfileId);
  if (syncProfileId !== null) syncService().openProfile(syncProfileId);

  // The one-time note-healing sweep (see `notes.ts`'s doc comment).
  // Unawaited, mirroring `adoptUnlockedKey`'s legacy-blob drain: an unlock
  // must not block on walking every note of every profile. Identity, not
  // null-ness, is "still this session" — `performLock` sets `db = null` and a
  // later unlock installs a NEW instance, so this stops the sweep both on
  // lock and when a newer session has superseded it.
  const session = requireDb();
  const stores = listProfiles(session).map((profile) => ({
    notes: noteStore(profile.id),
    cards: cardStore(profile.id),
  }));
  healNotes(stores, () => db === session).catch((error: unknown) => {
    console.error(
      `Note healing sweep failed (will retry on the next unlock): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });

  // The attachment-text backfill (SRCH-008): everything attached before this
  // feature existed has no extracted text, and the migration could not produce
  // it — the bytes are encrypted outside the database. One bounded pass here,
  // on the same unawaited terms as the sweep above.
  scheduleAttachmentTextBackfill();

  // Scheduled backups (ADR-056): the immediate check inside is the catch-up —
  // a slot missed while locked or powered off runs now, at unlock, exactly
  // when the data key exists again.
  startBackupScheduler(backupRunnerDeps());
}

/**
 * Every attachment table whose file names the search index already carries, for
 * every profile — `note_attachments` and `task_attachments`, and deliberately
 * NOT `subject_attachments`, whose names are not projected either (migration
 * 035). Private attachments are absent by construction: they live in their own
 * sealed tables with no projection at all, and this feature must not become the
 * exception to that.
 */
function attachmentTextTargets(session: NexusDatabase): AttachmentTextTarget[] {
  return listProfiles(session).flatMap((profile) => [
    noteAttachmentStore(profile.id),
    taskAttachmentStore(profile.id),
  ]);
}

/**
 * Records what a freshly attached file contributes to the search index, right
 * where its bytes are already in hand (SRCH-008) — so a text file is findable
 * by its contents the moment it lands, not after the next unlock.
 *
 * Every row this build inserts is CLAIMED: a file that is not indexable text
 * stores the empty string, migration 048's "attempted, nothing there" value, so
 * the backfill only ever deals with rows that predate this feature or arrived
 * through a restore.
 *
 * A failure here is logged and swallowed rather than propagated: the file IS
 * attached at this point, and failing the user's action over index bookkeeping
 * would be the wrong trade — the row simply stays pending, which is exactly the
 * state the backfill exists to resolve.
 */
function indexAttachmentText(
  store: AttachmentTextTarget,
  row: { id: string; fileName: string; mime: string; sizeBytes: number },
  bytes: Uint8Array,
): void {
  try {
    store.setExtractedText(row.id, extractAttachmentText(row, bytes));
  } catch (error) {
    console.error(`Indexing attachment "${row.id}"'s text failed (left for the backfill):`, error);
  }
}

/**
 * Starts ONE bounded attachment-text pass and does not wait for it — an unlock
 * (or a restore) must never block on housekeeping. Called at unlock and at the
 * end of every restore/import apply and undo: the extracted text deliberately
 * does not travel in an archive (it is derived from bytes that already do), so
 * rows those flows write arrive with nothing extracted, and this is what covers
 * them without waiting for a relaunch.
 *
 * Identity, not null-ness, is "still this session", exactly as `healNotes`
 * reads it: `performLock` sets `db = null` and a later unlock installs a NEW
 * instance, so the pass stops both on lock and when a newer session has
 * superseded it.
 */
function scheduleAttachmentTextBackfill(): void {
  const session = requireDb();
  backfillAttachmentText({
    targets: attachmentTextTargets(session),
    readBytes: (sha256) => readBlob(blobStorePathsFor(), requireBlobKeys(), sha256),
    stillThisSession: () => db === session,
  }).catch((error: unknown) => {
    console.error(
      `Attachment text backfill failed (will resume on the next unlock): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
}

// --- Security notifications (NTF-007) ---------------------------------------
//
// The four security-relevant events that actually happen locally — the unlock
// throttle tripping, a passcode change, a Recovery Kit reissue, another
// account's deletion — are recorded as `security` notifications, which no quiet
// hour and no appetite setting may suppress (`ALWAYS_ON_SOURCES`,
// `@nexus/core`).
//
// Two of the four happen while the database is OPEN and are delivered on the
// spot. The other two cannot be: the throttle trips precisely because the
// account is locked, and a deletion is normally done from the picker with
// nothing unlocked at all. Those wait in memory for the next unlock — see
// `pendingSecurityNotices`.

/**
 * Security notices that could not be delivered when they happened, because no
 * database was open to record them in. Drained by the first successful unlock
 * after the fact, whichever account that turns out to be — which is exactly
 * right for the two events that land here: "someone tried to open a lock on
 * this device" and "an account was deleted from this device" are facts about
 * the DEVICE, not about one account's data.
 *
 * **In memory, deliberately.** Nothing here is persisted. The only durable
 * place available while everything is locked is the plaintext registry, which
 * is plaintext for one narrow reason (the lock screen has to list account
 * labels before anything is unlocked) — and parking a deletion notice there
 * would turn it into a standing record of an account this device was just asked
 * to erase, readable by anyone with the disk. That is a worse outcome than the
 * honest limit this accepts instead: **a notice queued here is lost if the app
 * quits before any account is unlocked.** For the throttle that costs nothing —
 * its guard state still says so at the next unlock, which is where the notice
 * comes from in the first place. For a deletion it is a real gap, since the
 * account it names is gone by then. Recorded as such rather than solved with a
 * persistence layer this design does not want.
 */
let pendingSecurityNotices: SecurityNotice[] = [];

/** The security path's slice of the scheduler's deps, resolved at call time exactly like every other deps literal here. */
function securityNotificationDeps(): SecurityNotificationDeps {
  return {
    listProfiles: () => listProfiles(requireDb()),
    notificationStore,
    getMainWindow: () => mainWindow,
  };
}

/**
 * Queues one security event and delivers it right away when there is an open
 * database to record it in; otherwise it waits for the next unlock.
 *
 * Never during the smoke run, for the same reason the notification scheduler
 * never runs there: the rehearsal deletes an account on purpose, and a real OS
 * toast (plus a ledger row) fired from that would make a deterministic exit
 * flakier for no gain.
 */
function recordSecurityNotice(notice: SecurityNotice): void {
  if (isAutomatedRun) return;
  pendingSecurityNotices.push(notice);
  flushSecurityNotices();
}

/** Delivers everything queued, if a database is open to record it in. A no-op while locked — the queue simply keeps waiting. */
function flushSecurityNotices(): void {
  if (db === null || pendingSecurityNotices.length === 0) return;
  const notices = pendingSecurityNotices;
  pendingSecurityNotices = [];
  deliverSecurityNotices(securityNotificationDeps(), notices);
}

/**
 * Seals whatever close capture the open private section still owes, BEFORE a
 * caller tears the session down (ADR-057): `performLock` zeroes the PRIV DEK
 * those captures have to be sealed under, and a capture that cannot seal is a
 * lost capture. A no-op while nothing is open, and it never refuses — every
 * per-note failure is logged inside `privCapturePendingVersions`.
 *
 * Deliberately NOT wired into `performLock` itself: that function is
 * synchronous on purpose (it is also the quit and smoke path), and a lock must
 * never be delayed by, or made to depend on, bookkeeping. The handlers that
 * CAN afford one await call this first; everything else still gets the
 * unconditional wipe.
 */
async function capturePrivBeforeSessionTeardown(): Promise<void> {
  if (db !== null) await privCapturePendingVersions(privDeps());
}

/** Closes the database, stops the scheduler, and drops the data key (and the blob keys derived from it) from memory. Shared by the `auth:lock` handler and the smoke run's own lock/unlock exercise. */
function performLock(): void {
  // An app lock IS a PRIV lock (ADR-057 §5): the PRIV DEK must never outlive
  // the session whose database holds its sealed rows. Unconditional, first —
  // nothing below may run against a still-open private section.
  privLock();
  stopNotificationScheduler();
  // A round needs the data key and the open database; both die here. Optional
  // chaining rather than `syncService()`, because constructing the service to
  // stop a loop that was never started would read `cloud.json` at lock time.
  syncServiceInstance?.closeProfile();
  // ADR-058: the active-profile report dies with the session — the next unlock
  // may be a DIFFERENT account, and the renderer re-reports its landing anyway.
  // Until it does, `resolveActiveProfileId` serves the personal anchor.
  activeProfileId = null;
  // A backup run needs the data key and the open database; both die here. A
  // run already in flight bails on its own `stillThisSession` check.
  stopBackupScheduler();
  // A pending idle-compaction timer (scheduled from `notesAppendUpdate`) would
  // otherwise fire against a database this lock is about to close — throwing
  // where nothing can observe it, and holding open exactly the kind of
  // background work a lock is supposed to stop.
  cancelIdleCompactions();
  // A picked archive holds decrypted bytes and an undo snapshot holds a whole
  // profile's plaintext — both must die with the session's keys (ADR-023).
  clearRestoreState();
  // The rest countdowns hold nothing secret and write nothing, so this is about
  // lifetime rather than secrecy: a lock ends the session, and a kitchen timer
  // that outlived it would ring for a set nobody is in the middle of.
  for (const profileId of [...runningRestTimers.keys()]) clearRestTimer(profileId);
  try {
    db?.close();
  } catch {
    // best-effort close; we are locking regardless
  }
  db = null;
  unlockedDataKeyHex = null;
  blobKeys = null;
  // `openExternally` must hand the OS a real plaintext file to open with its
  // default app, so its temp copies are an unavoidable plaintext residue
  // living outside both blob stores. What IS controllable is that they never
  // outlive the session that made them — wiped here on every lock, and once
  // more at startup (`app.whenReady`) in case the process died before a lock
  // ever ran.
  wipeTmpOpenDir();
  // The same discipline for the PDF preview windows (ADR-064): each one is
  // decrypted attachment bytes on screen, and an open preview must not outlive
  // the session that could read it. Closed on EVERY lock, unconditionally.
  closeDocPreviewWindows();
}

/**
 * Adopts a freshly-verified data key for the rest of the unlocked session:
 * remembers it (`unlockedDataKeyHex`), derives the attachment blob store's
 * keys from it (ADR-019), and kicks off draining any legacy plaintext blobs
 * in the background. Never awaited by its own caller — an unlock must not
 * block on a potentially large migration — and a migration failure is logged
 * and swallowed rather than left to crash the process as an unhandled
 * rejection; the legacy directory simply stays put for the next unlock to
 * try again.
 */
async function adoptUnlockedKey(dataKeyHex: string): Promise<void> {
  unlockedDataKeyHex = dataKeyHex;
  const sessionKeys = await deriveBlobKeys(dataKeyHex);
  blobKeys = sessionKeys;
  // Identity, not null-ness, is what "still this session" means: `performLock`
  // clears `blobKeys`, and a later unlock installs a NEW object — so this pass
  // stops both when the app locks and when it has been superseded, which is
  // what keeps two passes from ever walking the same tree at once.
  const stillThisSession = (): boolean => blobKeys === sessionKeys;
  legacyMigrationTask = migrateLegacyBlobs(blobStorePathsFor(), sessionKeys, stillThisSession).catch(
    (error: unknown) => {
      console.error(
        `Legacy attachment migration failed (will retry on the next unlock): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  );
}

/** Converts an `AuthError` into the `AuthResult` the renderer branches on; a `"throttled"` reason additionally carries a freshly computed `lockedForMs` (the guard file was left untouched by the throttle check that raised it, so re-reading it here is exact, not stale) read from `dir` — the account the refused call was about, which is not always the selected one. Anything that is NOT an `AuthError` is rethrown — an unexpected failure, not an expected refusal. */
function authResultFromError(error: unknown, dir: string): AuthResult {
  if (error instanceof AuthError) {
    if (error.reason === "throttled") {
      return { ok: false, reason: error.reason, lockedForMs: readStatus(dir).lockedForMs };
    }
    return { ok: false, reason: error.reason };
  }
  throw error;
}

/**
 * Creates an account and opens it, in the one order that survives a failure at
 * every step (ADR-044 section 4):
 *
 * 1. Claim a directory. `beginAccountDir` resumes into a keychain-less one, so
 *    a create that died — or was refused for a weak passcode — leaves a
 *    directory the NEXT attempt reuses rather than a fresh one beside it.
 * 2. For the first account only, absorb a pre-ADR-044 flat install's data into
 *    that directory. It has to happen before `openEncrypted` looks for the
 *    database, or the encrypt-in-place ladder would create an empty one beside
 *    the user's real file. An additional account never absorbs anything: by
 *    then startup has already given any flat residue to `accounts[0]`.
 * 3. Write the key chain. Only once that lands is there an account at all.
 * 4. Write the registry entry — after the key chain, never before, so the list
 *    can never advertise an account nothing is able to unlock.
 * 5. Select and open. `activeAccountId` moves only after the key chain exists,
 *    so a refused create can never leave the app pointing at a directory with
 *    nothing in it.
 */
async function createLocalAccount(
  label: string,
  passcode: string,
  absorbLegacy: boolean,
): Promise<AuthResult> {
  const userData = userDataDir();
  const accountId = beginAccountDir(userData);
  const dir = accountDir(userData, accountId);
  try {
    if (absorbLegacy) absorbLegacyFlatData(userData, accountId);
    const { dataKeyHex, recoveryCode } = await createAccount(dir, passcode);
    registerAccount(userData, accountId, label, new Date().toISOString());
    activeAccountId = accountId;
    openEncrypted(dataKeyHex);
    await adoptUnlockedKey(dataKeyHex);
    startUnlockedServices();
    // A create opens a database just as an unlock does, so anything still
    // queued (NTF-007) is deliverable here too — which matters for the one case
    // where it is the ONLY moment: the last account was deleted, so there is no
    // survivor left to unlock, and this new one is the first place that fact can
    // be recorded.
    flushSecurityNotices();
    return { ok: true, recoveryCode };
  } catch (error) {
    return authResultFromError(error, dir);
  }
}

/** First run: refused outright once any account exists, so it can never close a database somebody is using. `auth:create-additional` is the channel that may. */
async function handleAuthCreate(label: string, passcode: string): Promise<AuthResult> {
  if (readRegistry(userDataDir()).accounts.length > 0) {
    return { ok: false, reason: "alreadyInitialized" };
  }
  return createLocalAccount(label, passcode, true);
}

/** Adds an account from the picker and switches to it. Locks first — exactly what switching does, and for the same reason: two unlocked accounts would mean two open databases and two sets of keys in memory. */
async function handleAuthCreateAdditional(label: string, passcode: string): Promise<AuthResult> {
  performLock();
  return createLocalAccount(label, passcode, false);
}

/**
 * Points every other auth channel at a different account. Switching away from
 * an unlocked one is exactly `performLock()` first (ADR-044 section 5) — the
 * whole session teardown, not a subset of it — so no reminder, undo slot, focus
 * timer or blob key can survive into the account that follows. Re-selecting the
 * account already active is a no-op rather than a needless lock.
 */
function handleAuthSelectAccount(accountId: string): AuthStatus {
  if (accountId !== activeAccountId) {
    performLock();
    activeAccountId = accountId;
    selectAccount(userDataDir(), accountId);
  }
  return computeAuthStatus();
}

/** Renames an account's label. Allowed while locked: the label lives in the plaintext registry, not behind the key chain. */
function handleAuthRenameAccount(accountId: string, label: string): AuthStatus {
  renameAccount(userDataDir(), accountId, label);
  return computeAuthStatus();
}

/**
 * Deletes an account outright (ADR-048). The picker only offers this while
 * locked, but the renderer is untrusted, so deleting the SELECTED account is
 * handled properly rather than assumed away: it is `performLock()` first — the
 * whole session teardown, exactly as switching is — because a `renameSync` over
 * a directory whose `nexus.db` still has an open handle is precisely what
 * Windows refuses.
 *
 * `activeAccountId` then moves by the boot rule, not by the registry's field
 * alone: `lastActiveId` can legitimately be null (a fresh install that never
 * selected anything) while accounts remain, and leaving the module pointing at
 * nothing there would strand the picker on an account it cannot open.
 *
 * The label is read BEFORE the delete and carried in memory into the NTF-007
 * notice, because a moment later there is nowhere left to read it from: the
 * registry entry is gone and the directory with it. That is also the whole
 * reason this notice may have to wait — the picker deletes while everything is
 * locked, so there is usually no database open to record it in (see
 * `pendingSecurityNotices`).
 */
function handleAuthDeleteAccount(accountId: string): AuthStatus {
  const wasActive = accountId === activeAccountId;
  const label = readRegistry(userDataDir()).accounts.find((entry) => entry.id === accountId)?.label;
  if (wasActive) performLock();
  const registry = deleteAccount(userDataDir(), accountId);
  if (wasActive) activeAccountId = registry.lastActiveId ?? registry.accounts[0]?.id ?? null;
  if (label !== undefined) {
    recordSecurityNotice({ kind: "account-deleted", at: new Date().toISOString(), label });
  }
  return computeAuthStatus();
}

async function handleAuthUnlock(passcode: string): Promise<AuthResult> {
  try {
    const { dataKeyHex, clearedThrottle } = await unlockWithPasscode(activeAccountDir(), passcode);
    // The passcode is always fully verified above, regardless of session
    // state — only the database (re)open is idempotent: a redundant-but-
    // correct unlock while already unlocked must not call `openDatabase` a
    // second time, which would leak the first connection's file handle
    // without ever closing it. (A WRONG passcode never reaches this line —
    // `unlockWithPasscode` already threw.)
    if (db === null) {
      openEncrypted(dataKeyHex);
      await adoptUnlockedKey(dataKeyHex);
      startUnlockedServices();
    }
    // NTF-007. The throttle tripped while this account was locked, so this
    // unlock is the first moment anything can be written about it — and the
    // last moment the fact exists at all, since the guard was just reset.
    if (clearedThrottle !== null) {
      recordSecurityNotice({
        kind: "unlock-throttle",
        at: new Date().toISOString(),
        ...clearedThrottle,
      });
    }
    flushSecurityNotices(); // whatever piled up while nothing was open
    return { ok: true };
  } catch (error) {
    return authResultFromError(error, activeAccountDir());
  }
}

async function handleAuthRecover(recoveryCode: string, newPasscode: string): Promise<AuthResult> {
  try {
    const { dataKeyHex, clearedThrottle } = await unlockWithRecovery(
      activeAccountDir(),
      recoveryCode,
      newPasscode,
    );
    // Same idempotent-open discipline as `handleAuthUnlock` — the recovered
    // data key is unchanged from whatever is already open, so there is
    // nothing to reopen, but the recovery code and new passcode are always
    // fully verified/applied above regardless of session state.
    if (db === null) {
      openEncrypted(dataKeyHex);
      await adoptUnlockedKey(dataKeyHex);
      startUnlockedServices();
    }
    if (clearedThrottle !== null) {
      recordSecurityNotice({
        kind: "unlock-throttle",
        at: new Date().toISOString(),
        ...clearedThrottle,
      });
    }
    flushSecurityNotices();
    return { ok: true };
  } catch (error) {
    return authResultFromError(error, activeAccountDir());
  }
}

async function handleAuthChangePasscode(currentPasscode: string, nextPasscode: string): Promise<AuthResult> {
  try {
    const clearedThrottle = await changePasscode(activeAccountDir(), currentPasscode, nextPasscode);
    // NTF-007, both facts: the change itself, and — before it — any
    // wrong-attempt burst this very call's success just wiped off the guard.
    // The burst first, because that is the order they happened in.
    const at = new Date().toISOString();
    if (clearedThrottle !== null) {
      recordSecurityNotice({ kind: "unlock-throttle", at, ...clearedThrottle });
    }
    recordSecurityNotice({ kind: "passcode-changed", at });
    return { ok: true };
  } catch (error) {
    return authResultFromError(error, activeAccountDir());
  }
}

async function handleAuthRegenerateRecovery(): Promise<AuthResult> {
  if (unlockedDataKeyHex === null) {
    // Only reachable via a renderer bug (the Settings action that calls this
    // does not exist while locked) — not a user-facing "expected refusal", so
    // this throws rather than returning an `AuthResult`; no `AuthErrorReason`
    // fits "you are not even unlocked".
    throw new Error("Cannot regenerate the recovery code while locked.");
  }
  try {
    const recoveryCode = await regenerateRecoveryCode(activeAccountDir(), unlockedDataKeyHex);
    // NTF-007. Always while unlocked (the guard above), so this is recorded and
    // shown on the spot.
    recordSecurityNotice({ kind: "recovery-kit-reissued", at: new Date().toISOString() });
    // The PRIV half (ADR-057 §4): every profile whose private section keeps a
    // kit wrap is settled against the new code — re-wrapped where the DEK is
    // in hand, dropped to credential-only where it is sealed away — so no
    // wrap the just-invalidated code still opens survives the reissue.
    await rewrapPrivKitsForNewCode(privDeps(), recoveryCode);
    return { ok: true, recoveryCode };
  } catch (error) {
    return authResultFromError(error, activeAccountDir());
  }
}

/**
 * Everything `main/restore.ts` runs on (ADR-023 slice 3c, extended by ADR-043):
 * the same store getters the `imex:export` handler hands `handleExport` — that
 * shared shape is exactly why undo's snapshot and an ordinary export are
 * provably identical (`profileData.ts`) — plus the pieces only a restore needs
 * and the one only a foreign import does. ONE literal for both flows, since a
 * superset satisfies either: the module holds their state apart, not their
 * dependencies. Built fresh per call, like the export handler's own deps
 * literal: every getter resolves `requireDb()`/`requireBlobKeys()` at use time,
 * so a deps object can never outlive the session that made it.
 */
function restoreDeps(): ImportDeps {
  return {
    taskStore,
    taskListStore,
    taskTagStore,
    taskAttachmentStore,
    taskTemplateStore,
    taskDependencyStore,
    eventStore,
    eventTemplateStore,
    calendarSettingsStore,
    peopleStore,
    documentStore,
    subjectStore,
    subjectAttachmentStore,
    subjectNoteLinkStore,
    examStore,
    deckStore,
    cardStore,
    topicStore,
    planStore,
    studySettingsStore,
    focusStore,
    notificationStore,
    noteStore,
    noteOrgStore,
    noteTemplateStore,
    noteAttachmentStore,
    flagStore,
    restoreStore: (profileId) => new RestoreStore(requireDb().raw, profileId),
    // The additive counterpart (ADR-043): the ONLY thing an import needs that a
    // restore does not — every fact it reads about the target profile comes
    // through the same store getters above.
    foreignImportStore: (profileId) => new ForeignImportStore(requireDb().raw, profileId),
    getProfile: (profileId) => {
      const profile = requireProfile(requireDb(), profileId);
      return {
        id: profile.id,
        name: profile.name,
        kind: profile.kind,
        picture: profilePictureOf(profile),
      };
    },
    pickArchiveFile: async () => {
      // One filter for both archive kinds: an encrypted export is `.nexus` and
      // a plaintext one `.nexus.zip`, and the reader tells them apart by the
      // file's own magic bytes, never by its extension.
      const options: OpenDialogOptions = {
        properties: ["openFile"],
        filters: [{ name: ARCHIVE_FILTER_NAME, extensions: ["nexus", "zip"] }],
      };
      const { canceled, filePaths } = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      return canceled ? null : (filePaths[0] ?? null);
    },
    // ADR-052's picker. Its OWN injection rather than an argument on the one
    // above, so that no call on the archive surface can open this dialog and no
    // call here can open that one. The filter is a convenience, not a check:
    // `readApkg` decides what the file is from its own bytes.
    pickApkgFile: async () => {
      const options: OpenDialogOptions = {
        properties: ["openFile"],
        filters: [{ name: ANKI_DECK_FILTER_NAME, extensions: ["apkg"] }],
      };
      const { canceled, filePaths } = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      return canceled ? null : (filePaths[0] ?? null);
    },
    // ADR-062's picker, on the `.apkg` picker's exact terms: its own injection,
    // so no surface can open another's dialog. `.txt` rides beside `.csv`
    // because a hand-kept table is often saved as one; the filter is a
    // convenience, not a check — the parse decides what the file is.
    pickCsvFile: async () => {
      const options: OpenDialogOptions = {
        properties: ["openFile"],
        filters: [{ name: CSV_TABLE_FILTER_NAME, extensions: ["csv", "txt"] }],
      };
      const { canceled, filePaths } = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      return canceled ? null : (filePaths[0] ?? null);
    },
    // FIN slice e's picker. The same file EXTENSIONS as the one above and still
    // its own injection, on the standing rule: a request on one surface must
    // never be able to open another's dialog, and „a bank statement" is a
    // different thing to pick than „a task table" even when both end in `.csv`.
    // The dialog's own title says which, so the user is never left guessing what
    // the file they are choosing will be read as.
    pickFinCsvFile: async () => {
      const options: OpenDialogOptions = {
        properties: ["openFile"],
        title: STATEMENT_DIALOG_TITLE,
        filters: [{ name: STATEMENT_FILTER_NAME, extensions: ["csv", "txt"] }],
      };
      const { canceled, filePaths } = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      return canceled ? null : (filePaths[0] ?? null);
    },
    // ADR-061's picker, on the exact terms of the one above — its own
    // injection, so no surface can open another's dialog. The filter name is
    // the ICS export dialog's, because it is the same kind of file going the
    // other way.
    pickIcsFile: async () => {
      const options: OpenDialogOptions = {
        properties: ["openFile"],
        filters: [{ name: CALENDAR_FILTER_NAME, extensions: ["ics"] }],
      };
      const { canceled, filePaths } = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      return canceled ? null : (filePaths[0] ?? null);
    },
    // The renderer comes back UNLOCKED: main keeps the open database and the
    // data key across this reload (ADR-023 section 7) — all it discards is the
    // renderer's own view of a profile that just changed under it.
    reloadRenderer: () => {
      mainWindow?.webContents.reload();
    },
    // Discarded, never persisted — exactly what `focus:cancel` does, and for a
    // sharper reason here: the row it would have written is about to be wiped
    // by the very restore asking for this.
    cancelFocusSession: (profileId) => {
      discardRunningFocusPhase(profileId);
    },
    dashboardSettingsStore,
    dashboardWidgetStore,
    dashboardSetStore,
    finAccountStore,
    finCategoryStore,
    finRecurringStore,
    finTransactionStore,
    habitStore,
    fitFoodStore,
    fitMealStore,
    fitTargetStore,
    fitExerciseStore,
    fitRoutineStore,
    fitWorkoutStore,
    fitMeasurementStore,
    fitBodyProfileStore,
    canvasStore,
    electronicsStore,
    saveBlob: (bytes) => saveBlob(blobStorePathsFor(), requireBlobKeys(), bytes),
    // Injected rather than reached for, so `restore.ts` never has to know WHICH
    // tables reference a blob — that union lives in exactly one place
    // (`blobRefCount`), which is what keeps an undo from deleting a file some
    // other module still names.
    blobRefCount,
    deleteBlobIfOrphaned: (sha256, refCount) =>
      deleteBlobIfOrphaned(blobStorePathsFor(), requireBlobKeys(), sha256, refCount),
    // The private section's five restore seams (ADR-057 §6): the sealed store
    // undo's parallel capture reads through, the gate the preview reports,
    // the re-seal `main/priv.ts` owns (the DEK lives there), the best-effort
    // unlink undo cleans a re-seal's fresh files with, and the orphan sweep
    // undo runs once its slot can no longer put sealed rows back.
    privateNoteStore,
    privUnlocked: (profileId) => privUnlockedFor(profileId),
    resealPrivateNotes: (profileId, data, readArchiveBlob) =>
      privResealForRestore(privDeps(), profileId, data, readArchiveBlob),
    removePrivateBlob: (id) => privBlobFiles.remove(id),
    sweepPrivateBlobs: async (profileId) => {
      await privSweepOrphanBlobs(privDeps(), profileId);
    },
  };
}

/**
 * The archive writer's whole surface (`ImexArchiveDeps`) as ONE literal, handed
 * verbatim to both flows that write an archive — the `imex:export` handler
 * (plus its window) and the scheduled backup (ADR-056) — so the two can never
 * gather different profiles. Built fresh per call, like `restoreDeps` and for
 * its reason: every getter resolves `requireDb()`/`requireBlobKeys()` at use
 * time, so a deps object can never outlive the session that made it.
 */
function imexArchiveDeps(): ImexArchiveDeps {
  return {
    taskStore,
    taskListStore,
    taskTagStore,
    taskAttachmentStore,
    taskTemplateStore,
    taskDependencyStore,
    eventStore,
    eventTemplateStore,
    calendarSettingsStore,
    peopleStore,
    documentStore,
    subjectStore,
    subjectAttachmentStore,
    subjectNoteLinkStore,
    examStore,
    deckStore,
    cardStore,
    topicStore,
    planStore,
    studySettingsStore,
    focusStore,
    notificationStore,
    noteStore,
    noteOrgStore,
    noteTemplateStore,
    noteAttachmentStore,
    dashboardSettingsStore,
    dashboardWidgetStore,
    dashboardSetStore,
    finAccountStore,
    finCategoryStore,
    finRecurringStore,
    finTransactionStore,
    habitStore,
    fitFoodStore,
    fitMealStore,
    fitTargetStore,
    fitExerciseStore,
    fitRoutineStore,
    fitWorkoutStore,
    fitMeasurementStore,
    fitBodyProfileStore,
    canvasStore,
    electronicsStore,
    flagStore,
    readBlob: (sha256) => readBlob(blobStorePathsFor(), requireBlobKeys(), sha256),
    // A private attachment's decrypted bytes, under whatever section is open
    // right now (ADR-057 §6) — null for a locked section or an unreadable
    // file, which the writer counts as missing. Only ever invoked for entries
    // a supplied `privateNotes` input declared; the scheduled backup supplies
    // none, so this never runs for it.
    readPrivateBlob: (id) => privReadAttachmentForExport(privDeps(), id),
  };
}

// --- Scheduled backups (SET-011 / ADR-056) -----------------------------------

/**
 * Everything `main/backup.ts` runs on. The session is captured HERE, at deps
 * creation, and `stillThisSession` is the `db === session` identity guard the
 * note-healing sweep and the legacy-blob drain already use: `performLock` sets
 * `db = null` and a later unlock installs a NEW instance, so a run started
 * under this session stops writing both when the app locks and when a newer
 * session has superseded it.
 */
function backupRunnerDeps(): BackupRunnerDeps {
  const session = requireDb();
  return {
    listProfileIds: () => listProfiles(requireDb()).map((profile) => profile.id),
    backupSettings: backupSettingsStore,
    archiveProfile: (profileId) => archiveProfileOf(requireProfile(requireDb(), profileId)),
    unwrapPassphrase: (wrapped) => unwrapBackupPassphrase(requireUnlockedDataKeyHex(), wrapped),
    // The exact function the manual export writes with (`imex.ts`), over the
    // exact deps literal it gathers with — a scheduled archive IS a manual one.
    // With one deliberate absence (ADR-057 §6): no `privateNotes` input, ever.
    // The PRIV card promises private notes stay out of automatic copies, and a
    // backup whose contents depended on whether the section happened to be
    // unlocked at run time would be one nobody could reason about.
    writeArchive: async (profile, passphrase, filePath) => {
      await writeProfileArchive(imexArchiveDeps(), profile, passphrase, filePath);
    },
    stillThisSession: () => db === session,
    now: () => new Date(),
  };
}

/** The renderer's view of one profile's backup settings: the store row with the wrap STRIPPED to a boolean — the passphrase surface is write-only (ADR-056). */
function backupSettingsView(profileId: string): BackupSettingsView {
  const { passphraseWrapped, ...rest } = backupSettingsStore(profileId).get();
  return { ...rest, passphraseSet: passphraseWrapped !== null };
}

// --- Private notes (PRIV v1 / ADR-057) ---------------------------------------

/**
 * Everything `main/priv.ts` runs on, resolved at call time like every other
 * deps literal here — with the session captured for `stillThisSession`, the
 * `backupRunnerDeps` arrangement. The two auth seams adapt `main/auth.ts`
 * (which `priv.ts` must never import — it pulls `electron`):
 * `verifyAccountPasscode` charges the lock screen's OWN throttle counter and
 * reports a cleared trip exactly as `profiles:verify-switch` does (NTF-007),
 * and `regenerateRecoveryKit` is the existing reissue flow, security notice
 * included.
 */
/**
 * A private attachment's reference id — main mints these with
 * `crypto.randomUUID`, and NOTHING else may ever become a file name under
 * `private-blobs`: an id is used in `join(dir, id)`, so this shape check is
 * the path-traversal gate for every read, write and unlink below (an envelope
 * is renderer-authored content, and a hand-edited one could otherwise name
 * `..\\..` as an "id").
 */
const PRIV_BLOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function privBlobFilePath(id: string): string {
  if (!PRIV_BLOB_ID_PATTERN.test(id)) {
    throw new Error("Invalid private attachment id.");
  }
  return join(privBlobsDirPath(), id);
}

/**
 * `PrivDeps.privBlobs` over the real filesystem. Writes are atomic
 * (temp + rename, `saveBlob`'s own arrangement) so a crash mid-write can
 * never leave a half-sealed container at the real path; `remove` is
 * best-effort by the seam's contract — a busy or missing file is logged and
 * forgiven, since a sealed stray is disk space, never a correctness problem.
 */
const privBlobFiles: PrivDeps["privBlobs"] = {
  async write(id, sealed) {
    const path = privBlobFilePath(id);
    await mkdirAsync(privBlobsDirPath(), { recursive: true });
    const tempPath = `${path}.tmp-${randomBytes(8).toString("hex")}`;
    await writeFileAsync(tempPath, sealed);
    await renameAsync(tempPath, path);
  },
  async read(id) {
    return readFileAsync(privBlobFilePath(id));
  },
  async remove(id) {
    try {
      await unlinkAsync(privBlobFilePath(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`Failed to remove private blob "${id}":`, error);
      }
    }
  },
  async list() {
    let names: string[];
    try {
      names = await readdirAsync(privBlobsDirPath());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; // nothing sealed yet
      throw error;
    }
    // Only id-shaped names: everything else in this directory is either a
    // crashed atomic write's `.tmp-…` leftover (its writer's business, and not
    // a sealed container) or something this app never put there — and the
    // sweep must be able to hand every name it answers straight back to
    // `read`/`remove`, which accept nothing else (`privBlobFilePath`).
    return names.filter((name) => PRIV_BLOB_ID_PATTERN.test(name));
  },
};

function privDeps(): PrivDeps {
  const session = requireDb();
  return {
    privateNotes: privateNoteStore,
    privateSettings: privateSettingsStore,
    privBlobs: privBlobFiles,
    listProfileIds: () => listProfiles(requireDb()).map((profile) => profile.id),
    deviceSecret: () => readDeviceSecret(activeAccountDir()),
    kdfParams: () => DEFAULT_KDF_PARAMS,
    verifyAccountPasscode: async (credential): Promise<AccountPasscodeCheck> => {
      try {
        const clearedThrottle = await verifyPasscode(
          activeAccountDir(),
          credential,
          requireUnlockedDataKeyHex(),
        );
        if (clearedThrottle !== null) {
          recordSecurityNotice({
            kind: "unlock-throttle",
            at: new Date().toISOString(),
            ...clearedThrottle,
          });
        }
        return { ok: true };
      } catch (error) {
        if (error instanceof AuthError && error.reason === "wrongPasscode") {
          return { ok: false, reason: "wrongPasscode" };
        }
        if (error instanceof AuthError && error.reason === "throttled") {
          return {
            ok: false,
            reason: "throttled",
            lockedForMs: readStatus(activeAccountDir()).lockedForMs,
          };
        }
        throw error;
      }
    },
    regenerateRecoveryKit: async () => {
      const recoveryCode = await regenerateRecoveryCode(
        activeAccountDir(),
        requireUnlockedDataKeyHex(),
      );
      // NTF-007, exactly as `auth:regenerate-recovery` records it: this IS a
      // Recovery Kit reissue, whichever dialog asked for it.
      recordSecurityNotice({ kind: "recovery-kit-reissued", at: new Date().toISOString() });
      return recoveryCode;
    },
    runInTransaction: (write) => requireDb().raw.transaction(write)(),
    // The orphan sweep's ordering gate (see `privSweepOrphanBlobs`): the one
    // undo slot `restore.ts` owns is the only thing that can put sealed rows
    // — and therefore blob references — back after they left the tables.
    privateUndoPending,
    stillThisSession: () => db === session,
    now: () => new Date(),
  };
}

/** Everything `main/privMove.ts` runs on — `privDeps` plus the public-note half, every getter resolved at call time like the rest. */
function privMoveDeps(): PrivMoveDeps {
  return {
    priv: privDeps(),
    notes: noteStore,
    noteAttachments: noteAttachmentStore,
    cards: cardStore,
    readBlob: (sha256) => readBlob(blobStorePathsFor(), requireBlobKeys(), sha256),
    saveBlob: (bytes) => saveBlob(blobStorePathsFor(), requireBlobKeys(), bytes),
    releaseBlob: (profileId, sha256) =>
      deleteBlobIfOrphaned(
        blobStorePathsFor(),
        requireBlobKeys(),
        sha256,
        blobRefCount(profileId, sha256),
      ),
    sniffMime,
    runInTransaction: (write) => requireDb().raw.transaction(write)(),
    rebuildSearchIndex: () => {
      rebuildSearchIndex(requireDb().raw);
    },
    now: () => new Date(),
  };
}

/**
 * The whole private-attachment pick flow (PRIV v1 / ADR-057), in main and
 * nowhere else: the native dialog is the ONLY source of a path (SEC-EL), the
 * size gate is a `stat` BEFORE the read (the dashboard picker's reasoning —
 * a cap checked after the read is decorative), the mime is sniffed from the
 * bytes (SEC-FILE-02), and the sealed container is on disk before the
 * reference is answered. The renderer's next `priv:write` is what makes the
 * reference durable — see the channel comment in `shared/ipc.ts`.
 */
async function handlePrivAttachmentPick(profileId: string): Promise<PrivAttachmentPickResult> {
  const options: OpenDialogOptions = { properties: ["openFile"] };
  const { canceled, filePaths } = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  const filePath = canceled ? null : (filePaths[0] ?? null);
  if (filePath === null) return { status: "canceled" };

  let bytes: Uint8Array;
  try {
    const stats = await statAsync(filePath);
    if (!stats.isFile() || stats.size === 0) return { status: "rejected", code: "unreadable" };
    if (stats.size > PRIV_ATTACHMENT_MAX_BYTES) return { status: "rejected", code: "too-large" };
    bytes = await readFileAsync(filePath);
  } catch {
    return { status: "rejected", code: "unreadable" };
  }
  if (bytes.byteLength === 0) return { status: "rejected", code: "unreadable" };
  if (bytes.byteLength > PRIV_ATTACHMENT_MAX_BYTES) return { status: "rejected", code: "too-large" };

  const ref = await privAddAttachment(privDeps(), profileId, {
    // The display name is derived from the dialog's own path, never accepted
    // from the renderer — `pickAttachmentFiles`' arrangement.
    fileName: basename(filePath).slice(0, 255),
    mime: sniffMime(bytes),
    bytes,
  });
  return { status: "ok", ref };
}

// --- Dashboard background (SET-006 / ADR-041) --------------------------------

/**
 * The whole pick flow, in main and nowhere else (SEC-EL): the native image
 * dialog, the size gate, the read, the sniff, the encrypt-into-the-blob-store,
 * and only then the settings row. The renderer sends no path and no bytes —
 * exactly the note-attachment precedent, minus even the bytes, since here main
 * opens the file itself.
 *
 * Order matters and is deliberate:
 *
 * 1. `stat` BEFORE the read, so a 4 GB file is refused without ever being
 *    loaded — reading first and measuring after would make the cap decorative.
 * 2. Sniff the bytes, never the extension (SEC-FILE-02). A `.png` whose content
 *    is a PDF sniffs as a PDF and is refused by name; nothing is ever
 *    re-encoded to make it fit, because silently converting a user's file is a
 *    bigger surprise than declining it.
 * 3. Write the blob, then the row. A blob with no row is collectable garbage
 *    the next GC pass reclaims; a row with no blob is a dashboard pointing at
 *    bytes that are not there.
 * 4. GC the PREVIOUS hash afterwards, refcount-gated — replacing a background
 *    is exactly as much a release of the old bytes as clearing one is.
 */
async function handleDashboardPick(profileId: string): Promise<DashboardPickResult> {
  const options: OpenDialogOptions = {
    properties: ["openFile"],
    filters: [{ name: IMAGE_FILTER_NAME, extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
  };
  const { canceled, filePaths } = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  const filePath = canceled ? null : (filePaths[0] ?? null);
  if (filePath === null) return { status: "canceled" };

  let bytes: Uint8Array;
  try {
    const stats = await statAsync(filePath);
    if (stats.size > MAX_BACKGROUND_BYTES) return { status: "rejected", code: "too-large" };
    bytes = await readFileAsync(filePath);
  } catch {
    return { status: "rejected", code: "unreadable" };
  }

  const mime = sniffMime(bytes);
  if (!isInlineImageMime(mime)) return { status: "rejected", code: "unsupported-format" };

  const store = dashboardSettingsStore(profileId);
  const previousHash = store.get().backgroundHash;
  const { sha256 } = await saveBlob(blobStorePathsFor(), requireBlobKeys(), bytes);

  let settings: DashboardSettings;
  try {
    settings = store.setBackground(sha256, mime, bytes.byteLength, new Date().toISOString());
  } catch (error) {
    // The blob was already written (write-if-absent); if the row failed, GC it
    // so a failed pick never leaves an orphan file — but only if nothing else
    // references it. The note-attachment add path's own arrangement.
    await deleteBlobIfOrphaned(
      blobStorePathsFor(),
      requireBlobKeys(),
      sha256,
      blobRefCount(profileId, sha256),
    );
    throw error;
  }

  await releaseReplacedBlob(profileId, previousHash, sha256);
  return { status: "ok", settings };
}

/**
 * Garbage-collects an image a profile just stopped using — a dashboard
 * background (ADR-041) or a profile picture (SET-001), which are the same
 * operation over two columns. `nextHash` is what replaced it (null when it was
 * simply cleared): re-picking the SAME image must not delete it, and the
 * refcount would say so anyway — the explicit comparison just avoids the
 * pointless round trip through the stores and the filesystem.
 */
async function releaseReplacedBlob(
  profileId: string,
  previousHash: string | null,
  nextHash: string | null,
): Promise<void> {
  if (previousHash === null || previousHash === nextHash) return;
  await deleteBlobIfOrphaned(
    blobStorePathsFor(),
    requireBlobKeys(),
    previousHash,
    blobRefCount(profileId, previousHash),
  );
}

// --- Profile picture (SET-001) -----------------------------------------------

/**
 * The whole pick flow for a profile picture, in main and nowhere else — the
 * dashboard background's arrangement above, with the file handling and the
 * image processing both in `main/profilePicture.ts` (see that module for the
 * posture this keeps, and for why there is deliberately no interactive crop).
 *
 * The same four-step order, and for the same reasons: the dialog and the size
 * gate first, then the bytes MAIN produced go into the blob store, then the row,
 * then the previous picture's blob is released. The one difference is what is
 * stored — never the file the user chose, always the square PNG this process
 * re-encoded, which is what strips the original's EXIF.
 */
async function handleProfilePicturePick(profileId: string): Promise<ProfilePicturePickResult> {
  // Resolved BEFORE the dialog: an unknown id is a bad payload, and putting a
  // file picker in front of the user only to throw once they have chosen would
  // be the rudest possible way to report one.
  const store = profileStore();
  const previous = store.get(profileId);
  if (previous === null) {
    throw new Error("Invalid IPC payload: unknown profile id.");
  }

  const picked = await pickProfilePicture(mainWindow, MAX_PROFILE_PICTURE_BYTES);
  if (picked.status !== "ok") return picked;

  const { bytes, mime } = picked.picture;
  const { sha256 } = await saveBlob(blobStorePathsFor(), requireBlobKeys(), bytes);

  let profile: Profile;
  try {
    profile = store.setPicture(profileId, sha256, mime, bytes.byteLength);
  } catch (error) {
    // The blob was already written (write-if-absent); if the row failed, GC it
    // so a failed pick never leaves an orphan file — but only if nothing else
    // references it. The dashboard background's own arrangement.
    await deleteBlobIfOrphaned(
      blobStorePathsFor(),
      requireBlobKeys(),
      sha256,
      blobRefCount(profileId, sha256),
    );
    throw error;
  }

  await releaseReplacedBlob(profileId, previous.pictureHash, sha256);
  return { status: "ok", profile };
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.authStatus, (event): AuthStatus => {
    assertTrustedSender(event);
    return computeAuthStatus();
  });

  ipcMain.handle(IpcChannel.authCreate, (event, payload): Promise<AuthResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const label = asAccountLabel(body.label, "label");
    const passcode = asPasscode(body.passcode, "passcode");
    return handleAuthCreate(label, passcode);
  });

  ipcMain.handle(IpcChannel.authCreateAdditional, async (event, payload): Promise<AuthResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const label = asAccountLabel(body.label, "label");
    const passcode = asPasscode(body.passcode, "passcode");
    // Both of these lock the current session on their way through
    // (`performLock`), which is an app lock as far as the private section is
    // concerned — so its pending close captures are sealed first, exactly as
    // `auth:lock` does it. A DELETE deliberately has no twin: the database
    // those versions would land in is about to be erased.
    await capturePrivBeforeSessionTeardown();
    return handleAuthCreateAdditional(label, passcode);
  });

  ipcMain.handle(IpcChannel.authSelectAccount, async (event, payload): Promise<AuthStatus> => {
    assertTrustedSender(event);
    const accountId = asAccountId(asRecord(payload).accountId, "accountId");
    await capturePrivBeforeSessionTeardown();
    return handleAuthSelectAccount(accountId);
  });

  ipcMain.handle(IpcChannel.authRenameAccount, (event, payload): AuthStatus => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const accountId = asAccountId(body.accountId, "accountId");
    const label = asAccountLabel(body.label, "label");
    return handleAuthRenameAccount(accountId, label);
  });

  ipcMain.handle(IpcChannel.authDeleteAccount, (event, payload): AuthStatus => {
    assertTrustedSender(event);
    const accountId = asAccountId(asRecord(payload).accountId, "accountId");
    return handleAuthDeleteAccount(accountId);
  });

  ipcMain.handle(IpcChannel.authUnlock, (event, payload): Promise<AuthResult> => {
    assertTrustedSender(event);
    const passcode = asPasscode(asRecord(payload).passcode, "passcode");
    return handleAuthUnlock(passcode);
  });

  ipcMain.handle(IpcChannel.authRecover, (event, payload): Promise<AuthResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const recoveryCode = asRecoveryCodeInput(body.recoveryCode, "recoveryCode");
    const newPasscode = asPasscode(body.newPasscode, "newPasscode");
    return handleAuthRecover(recoveryCode, newPasscode);
  });

  ipcMain.handle(IpcChannel.authChangePasscode, (event, payload): Promise<AuthResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const currentPasscode = asPasscode(body.currentPasscode, "currentPasscode");
    const nextPasscode = asPasscode(body.nextPasscode, "nextPasscode");
    return handleAuthChangePasscode(currentPasscode, nextPasscode);
  });

  ipcMain.handle(IpcChannel.authRegenerateRecovery, (event): Promise<AuthResult> => {
    assertTrustedSender(event);
    return handleAuthRegenerateRecovery();
  });

  ipcMain.handle(IpcChannel.authLock, async (event): Promise<void> => {
    assertTrustedSender(event);
    await capturePrivBeforeSessionTeardown();
    performLock();
  });

  ipcMain.handle(IpcChannel.profilesList, (event): Profile[] => {
    assertTrustedSender(event);
    return listProfiles(requireDb());
  });

  ipcMain.handle(IpcChannel.profilesCreate, (event, payload): Promise<Profile> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const kind = asProfileKind(body.kind, "kind");
    const name = asProfileCreateName(body.name, "name");
    return handleProfilesCreate(kind, name);
  });

  ipcMain.handle(IpcChannel.profilesCreateDemo, (event): Promise<Profile> => {
    assertTrustedSender(event);
    // No payload at all — the renderer names nothing about what is written, so
    // there is no field to validate and none to get wrong.
    return handleProfilesCreateDemo();
  });

  ipcMain.handle(IpcChannel.profilesDelete, (event, payload): Promise<void> => {
    assertTrustedSender(event);
    const id = asId(asRecord(payload).id, "id");
    return handleProfilesDelete(id);
  });

  ipcMain.handle(IpcChannel.profilesVerifySwitch, (event, payload): Promise<AuthResult> => {
    assertTrustedSender(event);
    const passcode = asPasscode(asRecord(payload).passcode, "passcode");
    return handleProfilesVerifySwitch(passcode);
  });

  // ADR-058 (NTF active-profile rule): the renderer reports which profile its
  // shell is standing in — at unlock landing and on every verified switch. A
  // REAL change of the profile the scheduler serves restarts it, which re-arms
  // the session's launch pass, so the profile being entered gets its backlog
  // as the catch-up burst („Dok te nije bilo: N“) — its ledger is per-profile
  // and stayed untouched while it was inactive, so exactly the missed
  // reminders are what that first pass derives. A report that matches what the
  // scheduler already serves (the unlock landing on the personal default) is
  // recorded without a restart, so unlock never double-fires the first check.
  ipcMain.handle(IpcChannel.profilesSetActive, (event, payload): void => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    const database = requireDb();
    requireProfile(database, profileId); // an unknown id is refused, never stored
    const alreadyServed =
      profileId === resolveActiveProfileId(listProfiles(database), activeProfileId);
    activeProfileId = profileId;
    if (alreadyServed) return;
    // Never during an automated run — neither scheduler runs there at all. The
    // sync loop follows the same switch, and its own `open` is idempotent for
    // the profile already bound, so the `alreadyServed` return above is the
    // notification scheduler's rule rather than a second one repeated here.
    if (!isAutomatedRun) {
      startNotificationScheduler(notificationSchedulerDeps());
      syncService().openProfile(profileId);
    }
  });

  ipcMain.handle(IpcChannel.profilesRename, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const id = asId(body.id, "id");
    const name = asProfileName(body.name, "name");
    renameProfile(requireDb(), id, name);
  });

  // Profile picture (SET-001). The renderer names no file and — unlike every
  // other image path in this app — never sends bytes either: main opens the
  // picker, reads under a cap, sniffs, decodes, crops, resizes, re-encodes and
  // stores. These two handlers therefore validate exactly one field, a profile
  // id, because that is genuinely all that crosses IPC.
  ipcMain.handle(
    IpcChannel.profilesPicturePick,
    (event, payload): Promise<ProfilePicturePickResult> => {
      assertTrustedSender(event);
      const profileId = asId(asRecord(payload).profileId, "profileId");
      return handleProfilePicturePick(profileId);
    },
  );

  ipcMain.handle(IpcChannel.profilesPictureClear, async (event, payload): Promise<Profile> => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");

    const store = profileStore();
    const previous = store.get(profileId);
    if (previous === null) {
      throw new Error("Invalid IPC payload: unknown profile id.");
    }
    const profile = store.clearPicture(profileId);
    await releaseReplacedBlob(profileId, previous.pictureHash, null);
    return profile;
  });

  ipcMain.handle(IpcChannel.flagsGet, (event, payload): Promise<FlagState> => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return new SqliteFlagStore(requireDb().raw, profileId).get();
  });

  ipcMain.handle(IpcChannel.flagsSet, async (event, payload): Promise<void> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const flagKey = asFlagKey(body.moduleId);
    const enabled = asBoolean(body.enabled, "enabled");
    await new SqliteFlagStore(requireDb().raw, profileId).set(flagKey, enabled);
  });

  ipcMain.handle(IpcChannel.tasksList, (event, payload): Task[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return taskStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.tasksCreate, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return taskStore(profileId).create(asNewTaskInput(body.task));
  });

  ipcMain.handle(IpcChannel.tasksUpdate, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return taskStore(profileId).update(id, asTaskFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.tasksSetDone, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const done = asBoolean(body.done, "done");
    return taskStore(profileId).setDone(id, done);
  });

  ipcMain.handle(IpcChannel.tasksDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    taskStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.tasksRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    taskStore(profileId).restore(id);
  });

  // SEC-EL-02: `now` is stamped here from main's own clock — when an occurrence
  // was completed (and so where a series continues from) is never the
  // renderer's to say.
  ipcMain.handle(IpcChannel.tasksCompleteOccurrence, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return taskStore(profileId).completeOccurrence(id, new Date().toISOString());
  });

  // --- Task lists and sections (TASK-004 / ADR-029) ---------------------
  //
  // SEC-EL-02 as everywhere else: `assertTrustedSender` first, every field
  // through an `as*` validator, and every `now` stamped from main's own clock —
  // when a list was renamed or reordered is never the renderer's to say.

  ipcMain.handle(IpcChannel.taskListsList, (event, payload): TaskListsSnapshot => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    const lists = taskListStore(profileId);
    const active = lists.listActive();
    // One reply for the whole rail: the sections follow the same list order, so
    // the renderer can never hold sections of a list this reply did not list.
    return { lists: active, sections: active.flatMap((list) => lists.listSections(list.id)) };
  });

  ipcMain.handle(IpcChannel.taskListsCreate, (event, payload): TaskList => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const name = asTaskListName(body.name, "name");
    const parentId = asNullableId(body.parentId, "parentId");
    return taskListStore(profileId).createList({ name, parentId }, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskListsRename, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const name = asTaskListName(body.name, "name");
    taskListStore(profileId).renameList(id, name, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskListsSetView, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const view = asTaskListView(body.view, "view");
    taskListStore(profileId).setDefaultView(id, view, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskListsSetViewConfig, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const config = asTaskViewConfig(body.config, "config");
    taskListStore(profileId).setViewConfig(id, config, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskListsMove, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const parentId = asNullableId(body.parentId, "parentId");
    const beforeId = asNullableId(body.beforeId, "beforeId");
    const afterId = asNullableId(body.afterId, "afterId");
    taskListStore(profileId).moveList(id, parentId, beforeId, afterId, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskListsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const mode = asDeleteListMode(body.mode, "mode");
    taskListStore(profileId).deleteList(id, mode, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskListsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    taskListStore(profileId).restoreList(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskSectionsCreate, (event, payload): TaskSection => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const listId = asId(body.listId, "listId");
    const name = asTaskListName(body.name, "name");
    return taskListStore(profileId).createSection(listId, name, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskSectionsRename, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const name = asTaskListName(body.name, "name");
    taskListStore(profileId).renameSection(id, name, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskSectionsMove, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const beforeId = asNullableId(body.beforeId, "beforeId");
    const afterId = asNullableId(body.afterId, "afterId");
    taskListStore(profileId).moveSection(id, beforeId, afterId, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskSectionsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    taskListStore(profileId).deleteSection(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.tasksMoveToList, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const listId = asId(body.listId, "listId");
    return taskStore(profileId).moveToList(id, listId, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.tasksMoveToSection, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const sectionId = asNullableId(body.sectionId, "sectionId");
    return taskStore(profileId).moveToSection(id, sectionId, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.tasksReorder, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const beforeId = asNullableId(body.beforeId, "beforeId");
    const afterId = asNullableId(body.afterId, "afterId");
    return taskStore(profileId).reorder(id, beforeId, afterId, new Date().toISOString());
  });

  // --- Task batch actions (ADR-038) --------------------------------------
  //
  // Five channels over a hand-picked selection. SEC-EL-02 as everywhere: sender
  // checked first, every field through an `as*` validator (the id array
  // element-wise, under the store's own cap), and the placement `now` stamped
  // from main's clock. Each store method is one transaction that refuses the
  // whole batch on any per-row failure, so a rejected promise here means the
  // database is exactly as the renderer last read it.

  ipcMain.handle(IpcChannel.tasksBulkMove, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const ids = asTaskIdArray(body.ids, "ids");
    const listId = asId(body.listId, "listId");
    const sectionId = asNullableId(body.sectionId, "sectionId");
    taskStore(profileId).bulkMoveToList(ids, listId, sectionId, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.tasksBulkPriority, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const ids = asTaskIdArray(body.ids, "ids");
    const priority = asTaskPriority(body.priority, "priority");
    taskStore(profileId).bulkSetPriority(ids, priority);
  });

  ipcMain.handle(IpcChannel.tasksBulkDue, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const ids = asTaskIdArray(body.ids, "ids");
    const dueDate = asNullableString(body.dueDate, "dueDate");
    taskStore(profileId).bulkSetDueDate(ids, dueDate);
  });

  ipcMain.handle(IpcChannel.tasksBulkDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const ids = asTaskIdArray(body.ids, "ids");
    // The shared `deleted_at` the store returns stays in main: the undo offer
    // is keyed by the very id set the renderer just sent, so handing the stamp
    // over would only be a second name for something it already holds.
    taskStore(profileId).bulkSoftDelete(ids);
  });

  ipcMain.handle(IpcChannel.tasksBulkRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const ids = asTaskIdArray(body.ids, "ids");
    taskStore(profileId).bulkRestore(ids);
  });

  // --- Task tags (migration 023) -----------------------------------------
  //
  // The `note-tags:*` surface one module over, channel for channel: the same
  // feature on a different entity, so a second set of semantics would only mean
  // two things for the UI to explain. SEC-EL-02 as everywhere: sender checked
  // first, every field through an `as*` validator, and `createTag`'s `now`
  // stamped from main's own clock.

  ipcMain.handle(IpcChannel.taskTagsList, (event, payload): TaskTag[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return taskTagStore(profileId).listTags();
  });

  ipcMain.handle(IpcChannel.taskTagsCreate, (event, payload): TaskTag => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const name = asTaskTagName(body.name, "name");
    return taskTagStore(profileId).createTag(name, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskTagsRename, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const name = asTaskTagName(body.name, "name");
    taskTagStore(profileId).renameTag(id, name);
  });

  ipcMain.handle(IpcChannel.taskTagsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    taskTagStore(profileId).deleteTag(id);
  });

  ipcMain.handle(IpcChannel.taskTagLinksList, (event, payload): TaskTagLink[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return taskTagStore(profileId).listTagLinks();
  });

  ipcMain.handle(IpcChannel.taskTagsAttach, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const taskId = asId(body.taskId, "taskId");
    const tagId = asId(body.tagId, "tagId");
    taskTagStore(profileId).attachTag(taskId, tagId);
  });

  ipcMain.handle(IpcChannel.taskTagsDetach, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const taskId = asId(body.taskId, "taskId");
    const tagId = asId(body.tagId, "tagId");
    taskTagStore(profileId).detachTag(taskId, tagId);
  });

  // --- Task attachments (migration 024) ------------------------------------
  //
  // The `note-attachments:*` surface one module over, with one deliberate
  // difference: `add` takes no bytes and no path. Main opens the native picker,
  // reads the chosen files itself, sniffs each one's real mime from its bytes
  // (SEC-FILE-02) and stamps `now` from its own clock — so a task's files never
  // cross the bridge in either direction, and the size cap is the store's own
  // (`MAX_TASK_ATTACHMENT_BYTES`, imported, never respelled here).

  ipcMain.handle(IpcChannel.taskAttachmentsList, (event, payload): TaskAttachment[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return taskAttachmentStore(profileId).list(id);
  });

  /**
   * Attaches every file the native picker returns, one at a time. A per-file
   * failure after the blob is written GCs that blob (only when nothing else
   * references it, `blobRefCount`) and then propagates: a row that would not
   * insert means the task itself is gone or not this profile's, which is not
   * something the next file in the pick would survive either.
   */
  ipcMain.handle(
    IpcChannel.taskAttachmentsAdd,
    async (event, payload): Promise<TaskAttachmentsAddResult> => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const id = asId(body.id, "id");

      const picked = await pickAttachmentFiles(mainWindow, MAX_TASK_ATTACHMENT_BYTES);
      if (picked.canceled) return { canceled: true };

      const store = taskAttachmentStore(profileId);
      let added = 0;
      for (const file of picked.files) {
        const mime = sniffMime(file.bytes);
        const { sha256 } = await saveBlob(blobStorePathsFor(), requireBlobKeys(), file.bytes);
        try {
          const row = store.add(
            id,
            { fileName: file.fileName, mime, sizeBytes: file.bytes.byteLength, sha256 },
            new Date().toISOString(),
          );
          indexAttachmentText(store, row, file.bytes);
          added += 1;
        } catch (error) {
          await deleteBlobIfOrphaned(
            blobStorePathsFor(),
            requireBlobKeys(),
            sha256,
            blobRefCount(profileId, sha256),
          );
          throw error;
        }
      }
      return { canceled: false, added, skippedTooLarge: picked.skippedTooLarge };
    },
  );

  ipcMain.handle(IpcChannel.taskAttachmentsRemove, async (event, payload): Promise<void> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const attachmentId = asId(body.attachmentId, "attachmentId");

    const removed = taskAttachmentStore(profileId).remove(id, attachmentId);
    await deleteBlobIfOrphaned(
      blobStorePathsFor(),
      requireBlobKeys(),
      removed.sha256,
      blobRefCount(profileId, removed.sha256),
    );
  });

  ipcMain.handle(IpcChannel.taskAttachmentsOpen, async (event, payload): Promise<void> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const attachmentId = asId(body.attachmentId, "attachmentId");

    const attachment = requireTaskAttachment(profileId, id, attachmentId);
    await openExternally(blobStorePathsFor(), requireBlobKeys(), tmpOpenDirPath(), attachment);
  });

  ipcMain.handle(
    IpcChannel.taskAttachmentsSaveAs,
    (event, payload): Promise<SaveAttachmentResult> => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const id = asId(body.id, "id");
      const attachmentId = asId(body.attachmentId, "attachmentId");

      const attachment = requireTaskAttachment(profileId, id, attachmentId);
      return saveAttachmentAs(mainWindow, blobStorePathsFor(), requireBlobKeys(), attachment);
    },
  );

  ipcMain.handle(IpcChannel.taskAttachmentsCounts, (event, payload): TaskAttachmentCount[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return taskAttachmentStore(profileId).countsByTask();
  });

  // --- Task templates (migration 027 / ADR-035) ---------------------------
  //
  // Four channels, and deliberately no "create a template from these fields"
  // among them: a template is captured FROM a task and applied INTO a list, so
  // the only things the renderer ever sends are ids and a name. That is what
  // keeps the payload — the one value here a store cannot re-derive — out of an
  // untrusted process entirely. SEC-EL-02 as everywhere: sender checked first,
  // every field through an `as*` validator, and both clocks stamped by main.

  ipcMain.handle(IpcChannel.taskTemplatesList, (event, payload): TaskTemplate[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return taskTemplateStore(profileId).list();
  });

  ipcMain.handle(IpcChannel.taskTemplatesSaveFromTask, (event, payload): TaskTemplate => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const taskId = asId(body.taskId, "taskId");
    const name = asTaskTemplateName(body.name, "name");
    // Read and write in one transaction: the payload describes the task as it
    // stands, and a save that captured half of it (say, after another window
    // deleted a subtask mid-read) would store a shape the user never had.
    return requireDb().raw.transaction((): TaskTemplate => {
      const captured = captureTaskTemplatePayload(profileId, taskId);
      return taskTemplateStore(profileId).saveByName(
        name,
        captured,
        new Date().toISOString(),
      );
    })();
  });

  ipcMain.handle(IpcChannel.taskTemplatesApply, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const templateId = asId(body.templateId, "templateId");
    // Structural checks only: that the list is this profile's and the section
    // belongs to it are `TaskStore.create`'s rules, and re-spelling them here
    // would be a second, drifting copy of them.
    const listId = asId(body.listId, "listId");
    const sectionId = asNullableId(body.sectionId, "sectionId");
    return applyTaskTemplate(profileId, templateId, listId, sectionId);
  });

  ipcMain.handle(IpcChannel.taskTemplatesDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    taskTemplateStore(profileId).delete(id);
  });

  // --- Task dependencies (migration 029 / ADR-037) ------------------------
  //
  // The task-tag surface one concept over: one list read and two pair writes,
  // no per-edge row to name. SEC-EL-02 as everywhere: sender checked first,
  // every field through an `as*` validator. No clock is stamped here because an
  // edge has no timestamp — it is either there or it is not.

  ipcMain.handle(IpcChannel.taskDependenciesList, (event, payload): TaskDependencyLink[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return taskDependencyStore(profileId).listLinks();
  });

  ipcMain.handle(IpcChannel.taskDependenciesAdd, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const blockerId = asId(body.blockerId, "blockerId");
    const blockedId = asId(body.blockedId, "blockedId");
    taskDependencyStore(profileId).addDependency(blockerId, blockedId);
  });

  ipcMain.handle(IpcChannel.taskDependenciesRemove, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const blockerId = asId(body.blockerId, "blockerId");
    const blockedId = asId(body.blockedId, "blockedId");
    taskDependencyStore(profileId).removeDependency(blockerId, blockedId);
  });

  ipcMain.handle(IpcChannel.eventsList, (event, payload): Event[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return eventStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.eventsCreate, (event, payload): Event => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return eventStore(profileId).create(asNewEventInput(body.event));
  });

  ipcMain.handle(IpcChannel.eventsUpdate, (event, payload): Event => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return eventStore(profileId).update(id, asEventFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.eventsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    eventStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.eventsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    eventStore(profileId).restore(id);
  });

  // ADR-024: the two series operations. The occurrence date is the renderer's
  // (it names a day the user pointed at), but `now` is stamped here from main's
  // own clock, as everywhere else on this wire.
  ipcMain.handle(IpcChannel.eventsAddRecurrenceExdate, (event, payload): Event => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const date = asBareDate(body.date, "date");
    return eventStore(profileId).addRecurrenceExdate(id, date, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.eventsSplitRecurrence, (event, payload): Event => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const occurrenceDate = asBareDate(body.occurrenceDate, "occurrenceDate");
    return eventStore(profileId).splitRecurrence(id, occurrenceDate, new Date().toISOString());
  });

  // --- Event templates (migration 036 / CAL-009) ---------------------------
  //
  // Four channels, and deliberately no "create a template from these fields"
  // among them — ADR-035's shape, one module over: a template is captured FROM
  // an event and applied ONTO a day, so the only things the renderer ever sends
  // are two ids, a name and a day key. That is what keeps the payload — the one
  // value here a store cannot re-derive — out of an untrusted process entirely.
  // SEC-EL-02 as everywhere: sender checked first, every field through an `as*`
  // validator, and both clocks stamped by main.

  ipcMain.handle(IpcChannel.eventTemplatesList, (event, payload): EventTemplate[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return eventTemplateStore(profileId).list();
  });

  ipcMain.handle(IpcChannel.eventTemplatesCapture, (event, payload): EventTemplate => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const eventId = asId(body.eventId, "eventId");
    const name = asEventTemplateName(body.name, "name");
    // The read and the write are one act inside the store, which does both over
    // the same handle — unlike a task capture, no second store is involved, so
    // there is no transaction to open here.
    return eventTemplateStore(profileId).captureFromEvent(
      eventId,
      name,
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.eventTemplatesApply, (event, payload): Event => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const templateId = asId(body.templateId, "templateId");
    // A real calendar day, so `2026-02-30` is refused here rather than becoming
    // an event nothing can expand. The store re-checks it regardless.
    const dayKey = asBareDate(body.dayKey, "dayKey");
    return eventTemplateStore(profileId).apply(templateId, dayKey);
  });

  ipcMain.handle(IpcChannel.eventTemplatesDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    eventTemplateStore(profileId).delete(id);
  });

  // The calendar's semester dates (CAL-010 / ADR-054). SEC-EL-02 as everywhere
  // else: `assertTrustedSender` first, `asRecord` on the payload, each date
  // through the bare-day validator when present — and the pair rule plus the
  // order re-checked HERE, before the store re-checks both again, because a
  // store is never the place that assumes its caller did.
  ipcMain.handle(IpcChannel.calendarGetSettings, (event, payload): CalendarSettings => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return calendarSettingsStore(profileId).get();
  });

  ipcMain.handle(IpcChannel.calendarSetSettings, (event, payload): CalendarSettings => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    // Both together, never one at a time: a term with one edge means nothing,
    // so a half-set pair is refused before anything reaches the store.
    const semesterStart =
      body.semesterStart === null ? null : asBareDate(body.semesterStart, "semesterStart");
    const semesterEnd =
      body.semesterEnd === null ? null : asBareDate(body.semesterEnd, "semesterEnd");
    if ((semesterStart === null) !== (semesterEnd === null)) {
      throw new Error(
        `Invalid IPC payload: "semesterStart" and "semesterEnd" must be set together or cleared together.`,
      );
    }
    if (semesterStart !== null && semesterEnd !== null && semesterStart > semesterEnd) {
      throw new Error(`Invalid IPC payload: "semesterStart" must not be after "semesterEnd".`);
    }
    return calendarSettingsStore(profileId).save({ semesterStart, semesterEnd });
  });

  // CAL-005 (founder decision #4) / ADR-058 §5: the ONE cross-profile read in
  // the system — the OTHER profile's events for the calendar grid. The
  // renderer names only the profile it is SHOWING; the other side of the read
  // is derived HERE from the profiles list, so no channel ever carries another
  // profile's id renderer→main. Rows come back minimized and pre-marked by the
  // store (no description/location/category — the renderer never even receives
  // what it must not show) with series already expanded for the validated,
  // bounded range. SRCH-005 stays intact by construction and is pinned here:
  // this is a read-only reply, never a write — the per-profile search index
  // (`search_entries.profile_id`) never sees an overlay row, so foreign events
  // cannot surface in the viewer's search.
  ipcMain.handle(IpcChannel.calendarOverlay, (event, payload): CalendarOverlayEvent[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const from = asBareDate(body.from, "from");
    const to = asBareDate(body.to, "to");
    const database = requireDb();
    requireProfile(database, profileId);
    return listProfiles(database)
      .filter((profile) => profile.id !== profileId)
      .flatMap((other) =>
        new CalendarOverlayStore(database.raw, profileId, other.id).listRange(from, to),
      );
  });

  // CAL-007 (ADR-026). `PeopleStore` takes `now` from its caller rather than
  // reading the clock, so every mutating handler below stamps it here from
  // main's own clock — when a person was added or edited is never the
  // renderer's to say (SEC-EL-02), exactly as with the task/event writes above.
  ipcMain.handle(IpcChannel.peopleList, (event, payload): Person[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return peopleStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.peopleCreate, (event, payload): Person => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return peopleStore(profileId).create(asNewPersonInput(body.person), new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.peopleUpdate, (event, payload): Person => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return peopleStore(profileId).update(
      id,
      asPersonFieldChanges(body.changes),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.peopleDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    peopleStore(profileId).softDelete(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.peopleRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    peopleStore(profileId).restore(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.documentsList, (event, payload): TrackedDocument[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return documentStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.documentsCreate, (event, payload): TrackedDocument => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return documentStore(profileId).create(asNewDocumentInput(body.document));
  });

  ipcMain.handle(IpcChannel.documentsUpdate, (event, payload): TrackedDocument => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return documentStore(profileId).update(id, asDocumentFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.documentsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    documentStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.documentsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    documentStore(profileId).restore(id);
  });

  ipcMain.handle(IpcChannel.documentsRenew, (event, payload): TrackedDocument => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const newExpiryDate = asNonEmptyString(body.newExpiryDate, "newExpiryDate");
    return documentStore(profileId).renew(id, newExpiryDate);
  });

  ipcMain.handle(IpcChannel.documentsRenewals, (event, payload): DocumentRenewal[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return documentStore(profileId).listRenewals(id);
  });

  ipcMain.handle(IpcChannel.subjectsList, (event, payload): Subject[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return subjectStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.subjectsCreate, (event, payload): Subject => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return subjectStore(profileId).create(asNewSubjectInput(body.subject));
  });

  ipcMain.handle(IpcChannel.subjectsUpdate, (event, payload): Subject => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return subjectStore(profileId).update(id, asSubjectFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.subjectsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    subjectStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.subjectsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    subjectStore(profileId).restore(id);
  });

  // --- Subject materials (migration 035 / STUDY-001) ------------------------
  //
  // The `task-attachments:*` surface, one module over, verbatim: `add` takes no
  // bytes and no path — main opens the native picker, reads the chosen files
  // itself, sniffs each one's real mime from its bytes (SEC-FILE-02) and stamps
  // `now` from its own clock — so a subject's files never cross the bridge in
  // either direction, and the size cap is the store's own
  // (`MAX_SUBJECT_ATTACHMENT_BYTES`, imported, never respelled here).
  //
  // Deliberately no `counts` twin of `task-attachments:counts`: STUDY draws
  // every subject's panel at once and already holds each one's list, so a
  // separate per-subject count would be a second answer to a question the rows
  // on screen have already answered.

  ipcMain.handle(IpcChannel.subjectAttachmentsList, (event, payload): SubjectAttachment[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return subjectAttachmentStore(profileId).list(id);
  });

  /**
   * Attaches every file the native picker returns, one at a time — the task
   * handler's loop, and its failure rule: a per-file failure after the blob is
   * written GCs that blob (only when nothing else references it, `blobRefCount`)
   * and then propagates, because a row that would not insert means the subject
   * itself is gone or not this profile's.
   */
  ipcMain.handle(
    IpcChannel.subjectAttachmentsAdd,
    async (event, payload): Promise<SubjectAttachmentsAddResult> => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const id = asId(body.id, "id");

      const picked = await pickAttachmentFiles(mainWindow, MAX_SUBJECT_ATTACHMENT_BYTES);
      if (picked.canceled) return { canceled: true };

      const store = subjectAttachmentStore(profileId);
      let added = 0;
      for (const file of picked.files) {
        const mime = sniffMime(file.bytes);
        const { sha256 } = await saveBlob(blobStorePathsFor(), requireBlobKeys(), file.bytes);
        try {
          store.add(
            id,
            { fileName: file.fileName, mime, sizeBytes: file.bytes.byteLength, sha256 },
            new Date().toISOString(),
          );
          added += 1;
        } catch (error) {
          await deleteBlobIfOrphaned(
            blobStorePathsFor(),
            requireBlobKeys(),
            sha256,
            blobRefCount(profileId, sha256),
          );
          throw error;
        }
      }
      return { canceled: false, added, skippedTooLarge: picked.skippedTooLarge };
    },
  );

  ipcMain.handle(IpcChannel.subjectAttachmentsRemove, async (event, payload): Promise<void> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const attachmentId = asId(body.attachmentId, "attachmentId");

    const removed = subjectAttachmentStore(profileId).remove(id, attachmentId);
    await deleteBlobIfOrphaned(
      blobStorePathsFor(),
      requireBlobKeys(),
      removed.sha256,
      blobRefCount(profileId, removed.sha256),
    );
  });

  ipcMain.handle(IpcChannel.subjectAttachmentsOpen, async (event, payload): Promise<void> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const attachmentId = asId(body.attachmentId, "attachmentId");

    const attachment = requireSubjectAttachment(profileId, id, attachmentId);
    await openExternally(blobStorePathsFor(), requireBlobKeys(), tmpOpenDirPath(), attachment);
  });

  ipcMain.handle(
    IpcChannel.subjectAttachmentsSaveAs,
    (event, payload): Promise<SaveAttachmentResult> => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const id = asId(body.id, "id");
      const attachmentId = asId(body.attachmentId, "attachmentId");

      const attachment = requireSubjectAttachment(profileId, id, attachmentId);
      return saveAttachmentAs(mainWindow, blobStorePathsFor(), requireBlobKeys(), attachment);
    },
  );

  // --- Subject↔note links (migration 035 / STUDY-001) -----------------------
  //
  // `task-dependencies:*`'s three channels with one end in another module. Both
  // ids are plain strings on the wire and the store resolves each against a LIVE
  // row of this profile (SEC-EL-02's usual split: shape here, semantics there);
  // `now` is stamped by main, never accepted from the renderer.

  ipcMain.handle(IpcChannel.subjectNotesLinked, (event, payload): LinkedNote[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return subjectNoteLinkStore(profileId).listLinkedNotes(id);
  });

  ipcMain.handle(IpcChannel.subjectNotesLink, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const noteId = asId(body.noteId, "noteId");
    subjectNoteLinkStore(profileId).linkNote(id, noteId, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.subjectNotesUnlink, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const noteId = asId(body.noteId, "noteId");
    subjectNoteLinkStore(profileId).unlinkNote(id, noteId);
  });

  ipcMain.handle(IpcChannel.examsList, (event, payload): Exam[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return examStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.examsCreate, (event, payload): Exam => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return examStore(profileId).create(asNewExamInput(body.exam));
  });

  ipcMain.handle(IpcChannel.examsUpdate, (event, payload): Exam => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return examStore(profileId).update(id, asExamFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.examsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    examStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.examsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    examStore(profileId).restore(id);
  });

  ipcMain.handle(IpcChannel.decksList, (event, payload): Deck[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return deckStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.decksCreate, (event, payload): Deck => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return deckStore(profileId).create(asNewDeckInput(body.deck));
  });

  ipcMain.handle(IpcChannel.decksUpdate, (event, payload): Deck => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return deckStore(profileId).update(id, asDeckFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.decksDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    deckStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.decksRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    deckStore(profileId).restore(id);
  });

  ipcMain.handle(IpcChannel.cardsListByDeck, (event, payload): Card[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const deckId = asId(body.deckId, "deckId");
    return cardStore(profileId).listByDeck(deckId);
  });

  ipcMain.handle(IpcChannel.cardsCreate, (event, payload): Card => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return cardStore(profileId).create(asNewCardInput(body.card), new Date().toISOString());
  });

  // Only the TEMPLATE crosses the wire (ADR-042): `createCloze` finds the
  // deletions and derives every sibling's sides itself, so the renderer cannot
  // hand in sides that disagree with the text they claim to come from.
  ipcMain.handle(IpcChannel.cardsCreateCloze, (event, payload): Card[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const deckId = asId(body.deckId, "deckId");
    const text = asCappedChars(body.text, "text", CARD_TEXT_MAX_LENGTH);
    return cardStore(profileId).createCloze(deckId, text, new Date().toISOString());
  });

  // Same discipline for a problem card (ADR-046): the statement and the STEPS
  // cross the wire, never the `back` — `createProblem` derives it from the
  // steps by the one grammar every reader shares.
  ipcMain.handle(IpcChannel.cardsCreateProblem, (event, payload): Card => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const deckId = asId(body.deckId, "deckId");
    const front = asCappedChars(body.front, "front", CARD_TEXT_MAX_LENGTH);
    const stepsText = asCappedChars(body.stepsText, "stepsText", CARD_TEXT_MAX_LENGTH);
    return cardStore(profileId).createProblem(deckId, front, stepsText, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.cardsUpdate, (event, payload): Card => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return cardStore(profileId).update(id, asCardFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.cardsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    cardStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.cardsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    cardStore(profileId).restore(id);
  });

  ipcMain.handle(IpcChannel.cardsCounts, (event, payload): DeckCounts[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return cardStore(profileId).countsByDeck(new Date().toISOString());
  });

  // SEC-EL-02: `now` is always stamped here from the main process's own clock —
  // the renderer's `now` is never trusted for FSRS scheduling decisions.
  ipcMain.handle(IpcChannel.reviewQueue, (event, payload): ReviewQueue => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    // Field by field, only the keys that arrived — the store then judges the
    // semantics (which scopes may co-exist, whether the ids resolve, ADR-047).
    const scope: DueQueueOptions = {};
    if (body.deckId !== undefined) scope.deckId = asId(body.deckId, "deckId");
    if (body.subjectId !== undefined) scope.subjectId = asId(body.subjectId, "subjectId");
    if (body.deckIds !== undefined) {
      scope.deckIds = asStringArray(body.deckIds, "deckIds", MAX_QUEUE_DECK_IDS, 64);
    }
    if (body.problemsOnly !== undefined) {
      scope.problemsOnly = asBoolean(body.problemsOnly, "problemsOnly");
    }
    if (body.newLimit !== undefined) scope.newLimit = asInteger(body.newLimit, "newLimit");
    return cardStore(profileId).dueQueue(scope, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.reviewGrade, (event, payload): Card => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const rating = asCardRating(body.rating, "rating");
    return cardStore(profileId).review(id, rating, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.reviewUndo, (event, payload): Card => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return cardStore(profileId).undoLastReview(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.reviewPreview, (event, payload): PreviewIntervals => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return cardStore(profileId).previewIntervals(id, new Date().toISOString());
  });

  // SEC-EL-02: `now`/`today` are always stamped here from the main process's own
  // clock — the renderer never supplies either for plan/block date math.
  ipcMain.handle(IpcChannel.plansList, (event, payload): StudyPlan[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return planStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.plansCreate, (event, payload): StudyPlan => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return planStore(profileId).createPlan(
      asNewPlanInput(body.plan),
      new Date().toISOString(),
      localToday(),
    );
  });

  ipcMain.handle(IpcChannel.plansUpdate, (event, payload): StudyPlan => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return planStore(profileId).updatePlan(
      id,
      asPlanFieldChanges(body.changes),
      new Date().toISOString(),
      localToday(),
    );
  });

  ipcMain.handle(IpcChannel.plansDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    planStore(profileId).softDelete(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.plansRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    planStore(profileId).restore(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.plansSyncAll, (event, payload): PlanHealth[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    // One honesty report per synced plan (ADR-063 invariant 5) — the health
    // line every plan card renders. The pre-063 synced COUNT died here.
    return planStore(profileId).syncAll(new Date().toISOString(), localToday());
  });

  ipcMain.handle(IpcChannel.plansScopeCutProposal, (event, payload): ScopeCutProposal => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const planId = asId(body.planId, "planId");
    return planStore(profileId).scopeCutProposal(planId, localToday());
  });

  // The ONLY wire that ever cuts a topic (ADR-063: explicit user acceptance,
  // never the machine). Acceptance and the plan's re-sync are one act: the
  // fresh blocks exclude the cut topics immediately, and the returned health
  // says whether the plan now fits — `requireActivePlan` inside `sync` is also
  // what holds `planId` to an active plan of THIS profile.
  ipcMain.handle(IpcChannel.plansAcceptScopeCut, (event, payload): PlanHealth => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const planId = asId(body.planId, "planId");
    const topicIds = asScopeCutTopicIds(body.topicIds, "topicIds");
    const store = planStore(profileId);
    store.acceptScopeCut(topicIds, new Date().toISOString());
    return store.sync(planId, new Date().toISOString(), localToday());
  });

  ipcMain.handle(IpcChannel.blocksListByPlan, (event, payload): StudyBlock[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const planId = asId(body.planId, "planId");
    return planStore(profileId).listBlocks(planId);
  });

  ipcMain.handle(IpcChannel.blocksRange, (event, payload): StudyBlockWithExam[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const fromDate = asNonEmptyString(body.fromDate, "fromDate");
    const toDate = asNonEmptyString(body.toDate, "toDate");
    return planStore(profileId).listBlocksInRange(fromDate, toDate);
  });

  ipcMain.handle(IpcChannel.blocksSetStatus, (event, payload): StudyBlock => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const status = asBlockStatus(body.status, "status");
    return planStore(profileId).setBlockStatus(id, status, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.blocksSetPinned, (event, payload): StudyBlock => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const pinned = asBoolean(body.pinned, "pinned");
    return planStore(profileId).setBlockPinned(id, pinned, new Date().toISOString());
  });

  // --- Exam topics (ADR-063) ------------------------------------------------
  //
  // Every mutation below answers with the exam's fresh EFFECTIVE list — the
  // one read the renderer is allowed to hold (manual-else-derived confidence,
  // resolved by the store; the renderer never derives). `today` for the
  // derivation window is always stamped by `effectiveTopics` from main's own
  // clock (SEC-EL-02).

  ipcMain.handle(IpcChannel.topicsListByExam, (event, payload): EffectiveExamTopic[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const examId = asId(body.examId, "examId");
    return effectiveTopics(profileId, examId);
  });

  ipcMain.handle(IpcChannel.topicsCreate, (event, payload): EffectiveExamTopic[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const examId = asId(body.examId, "examId");
    const name = asNonEmptyString(body.name, "name");
    topicStore(profileId).create({ examId, name }, new Date().toISOString());
    return effectiveTopics(profileId, examId);
  });

  ipcMain.handle(IpcChannel.topicsRename, (event, payload): EffectiveExamTopic[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const name = asNonEmptyString(body.name, "name");
    const renamed = topicStore(profileId).rename(id, name, new Date().toISOString());
    return effectiveTopics(profileId, renamed.examId);
  });

  ipcMain.handle(IpcChannel.topicsSetConfidence, (event, payload): EffectiveExamTopic[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    // The closed manual-confidence domain at the IPC edge: null clears, else 0..100.
    const confidence = asNullableBoundedInteger(body.confidence, "confidence", 0, 100);
    const updated = topicStore(profileId).setConfidence(id, confidence, new Date().toISOString());
    return effectiveTopics(profileId, updated.examId);
  });

  ipcMain.handle(IpcChannel.topicsSetDeck, (event, payload): EffectiveExamTopic[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    // Structural only — that a non-null id names a LIVE deck of THIS profile
    // is the store's semantic re-check (`resolveDeck`).
    const deckId = asNullableId(body.deckId, "deckId");
    const updated = topicStore(profileId).setDeck(id, deckId, new Date().toISOString());
    return effectiveTopics(profileId, updated.examId);
  });

  ipcMain.handle(IpcChannel.topicsMove, (event, payload): EffectiveExamTopic[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const direction = asTopicMoveDirection(body.direction, "direction");
    const store = topicStore(profileId);
    const moved = store.listAll().find((topic) => topic.id === id);
    if (!moved) {
      throw new Error(`No active exam topic "${id}" in this profile.`);
    }
    // One rank step; an edge move is a quiet no-op rather than an error — the
    // renderer disables the buttons at the edges, but a concurrent reorder
    // must not turn a click into a failure toast.
    const siblings = store.listByExam(moved.examId);
    const toRank = direction === "up" ? moved.rank - 1 : moved.rank + 1;
    if (toRank >= 0 && toRank < siblings.length) {
      store.moveTopic(id, toRank, new Date().toISOString());
    }
    return effectiveTopics(profileId, moved.examId);
  });

  ipcMain.handle(IpcChannel.topicsDelete, (event, payload): EffectiveExamTopic[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const store = topicStore(profileId);
    const doomed = store.listAll().find((topic) => topic.id === id);
    if (!doomed) {
      throw new Error(`No active exam topic "${id}" in this profile.`);
    }
    store.softDelete(id, new Date().toISOString());
    return effectiveTopics(profileId, doomed.examId);
  });

  // The ONLY wire that ever CLEARS `cut` (ADR-063), the mirror of
  // `plans:accept-scope-cut`. Structural validation only here — that the id is
  // an active topic of THIS profile and that it is actually cut are
  // `PlanStore.restoreScopeCut`'s own named refusals, so a stale click fails
  // loudly instead of writing nothing. The plan's re-sync rides on the
  // renderer's usual post-topic-write refresh, which is also what surfaces the
  // wider scope's overflow.
  ipcMain.handle(IpcChannel.topicsRestoreToPlan, (event, payload): EffectiveExamTopic[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const restored = topicStore(profileId)
      .listAll()
      .find((topic) => topic.id === id);
    if (!restored) {
      throw new Error(`No active exam topic "${id}" in this profile.`);
    }
    planStore(profileId).restoreScopeCut([id], new Date().toISOString());
    return effectiveTopics(profileId, restored.examId);
  });

  // SEC-EL-02: `startedAt`/`endedAt`/`now` are always stamped here from the
  // main process's own clock — the renderer never supplies a timer boundary.
  // The running phase itself lives only in `runningFocusSessions` (see its
  // declaration); a crash or restart loses it honestly, never a fabricated row.
  //
  // ONE channel for both callers (UTIL slice b): STUDY sends only a `subjectId`
  // and gets exactly the open-ended `work` phase it always had, while FOKUS
  // sends a kind and a plan. A second start channel would be the second timer
  // migration 057 merged away.
  ipcMain.handle(IpcChannel.focusStart, (event, payload): RunningFocusSession => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    if (runningFocusSessions.has(profileId)) {
      throw new Error("A focus session is already running for this profile.");
    }
    const rawSubjectId = body.subjectId;
    // Validated BEFORE the phase is recorded — a running phase is never started
    // against an unknown/foreign/soft-deleted subject. A Pomodoro phase usually
    // names none at all, which is the ordinary case rather than the exception.
    const subjectId =
      rawSubjectId === undefined || rawSubjectId === null
        ? null
        : focusStore(profileId).resolveSubject(asId(rawSubjectId, "subjectId"));

    const running: RunningFocusPhase = {
      subjectId,
      startedAt: new Date().toISOString(),
      kind: asFocusPhaseKind(body.kind, "kind"),
      plannedMinutes: asFocusPlannedMinutes(body.plannedMinutes, "plannedMinutes"),
      cycleIndex: asFocusCycleIndex(body.cycleIndex, "cycleIndex"),
      // Deliberately NOT resolved against `tasks`: a focus session is a
      // historical fact about time somebody spent and must survive the deletion
      // of whatever it pointed at (migration 057's note). Structural only.
      taskId: body.taskId === undefined ? null : asNullableId(body.taskId, "taskId"),
      label: asFocusLabel(body.label, "label"),
      pausedAt: null,
      pausedSeconds: 0,
      timer: null,
    };
    runningFocusSessions.set(profileId, running);
    armFocusAlarm(profileId, running);
    return toRunningFocusSession(running);
  });

  // ONE stop channel, and the outcome is derived from the CLOCK rather than
  // named by the caller: a phase whose plan the wall clock says was met ends
  // `completed`, everything else `stopped`. Letting the renderer name it would
  // let a compromised one record a twenty-second phase as a completed Pomodoro,
  // and the outcome is the one field of a focus row nobody should be able to
  // assert about themselves.
  //
  // An open-ended phase always lands on `stopped`, for the engine's own reason
  // (`FOCUS_OUTCOMES`): it was ended by hand, because it had no planned end to
  // reach.
  ipcMain.handle(IpcChannel.focusStop, (event, payload): FocusSession | null => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const phase = runningFocusSessions.get(profileId);
    if (!phase) {
      throw new Error("No focus session is running for this profile.");
    }
    const endedAt = new Date().toISOString();
    const met =
      phase.plannedMinutes !== null && phaseProgress(phase, endedAt).remainingSeconds === 0;
    return endRunningFocusPhase(profileId, met ? "completed" : "stopped", endedAt);
  });

  // Pause and resume are the only genuinely NEW acts this slice adds, which is
  // why they are the only new channels. Both are idempotent: pausing a paused
  // phase and resuming a running one answer the phase unchanged rather than
  // throwing, because a double-click on a button must not be an error.
  ipcMain.handle(IpcChannel.focusPause, (event, payload): RunningFocusSession => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    const phase = runningFocusSessions.get(profileId);
    if (!phase) {
      throw new Error("No focus session is running for this profile.");
    }
    if (phase.pausedAt === null) {
      phase.pausedAt = new Date().toISOString();
      // The alarm goes with the clock: a paused phase must not announce an end
      // it is no longer approaching.
      disarmFocusAlarm(phase);
    }
    return toRunningFocusSession(phase);
  });

  ipcMain.handle(IpcChannel.focusResume, (event, payload): RunningFocusSession => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    const phase = runningFocusSessions.get(profileId);
    if (!phase) {
      throw new Error("No focus session is running for this profile.");
    }
    if (phase.pausedAt !== null) {
      // The pause that just ENDED joins the accumulator; the one still running
      // is never in it (`FocusPhaseTiming`'s rule).
      phase.pausedSeconds += closedPauseSeconds(phase.pausedAt, new Date().toISOString());
      phase.pausedAt = null;
      // Re-armed for what is LEFT, not for the whole plan — `armFocusAlarm`
      // measures the remainder off the wall clock.
      armFocusAlarm(profileId, phase);
    }
    return toRunningFocusSession(phase);
  });

  ipcMain.handle(IpcChannel.focusStatus, (event, payload): RunningFocusSession | null => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    const phase = runningFocusSessions.get(profileId);
    return phase === undefined ? null : toRunningFocusSession(phase);
  });

  ipcMain.handle(IpcChannel.focusCancel, (event, payload): void => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    discardRunningFocusPhase(profileId);
  });

  ipcMain.handle(IpcChannel.focusListRange, (event, payload): FocusSession[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const fromDate = asNonEmptyString(body.fromDate, "fromDate");
    const toDate = asNonEmptyString(body.toDate, "toDate");
    return focusStore(profileId).listRange(fromDate, toDate);
  });

  ipcMain.handle(IpcChannel.focusDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    focusStore(profileId).softDelete(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.focusRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    focusStore(profileId).restore(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.statsStudy, (event, payload): StudyStats => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const fromDate = asNonEmptyString(body.fromDate, "fromDate");
    const toDate = asNonEmptyString(body.toDate, "toDate");
    const stats = statsStore(profileId);
    return {
      subjectMinutes: stats.subjectMinutes(fromDate, toDate),
      activityDays: stats.activityDays(fromDate, toDate),
      reviews: stats.reviewCounts(fromDate, toDate),
      blocks: stats.blockTotals(fromDate, toDate),
      // The two named STUDY-013 metrics travel on this same channel rather than
      // one of their own: they are read for the same profile over the same
      // range, by the same caller, on the same refresh.
      matured: stats.cardsMatured(fromDate, toDate),
      adherence: stats.planAdherence(fromDate, toDate),
    };
  });

  // One subject's study log (STUDY-014) — a read, nothing else. Both bounds go
  // through `asBareDate` rather than the plain string the older stats channel
  // accepts: they are calendar days, so "2026-02-30" is refused here instead of
  // reaching the store as a day that does not exist.
  ipcMain.handle(IpcChannel.studyLog, (event, payload): SubjectStudyLog => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const subjectId = asId(body.subjectId, "subjectId");
    const fromDay = asBareDate(body.fromDay, "fromDay");
    const toDay = asBareDate(body.toDay, "toDay");
    return statsStore(profileId).studyLogForSubject(subjectId, fromDay, toDay);
  });

  // Study preferences (STUDY-007). SEC-EL-02 as everywhere else:
  // `assertTrustedSender` first, `asRecord` on the payload, one `as*` validator
  // per field mirroring migration 034's own CHECKs — and the store re-validates
  // all three after this, because a store is never the place that assumes its
  // caller did. `now` is stamped from main's own clock.
  ipcMain.handle(IpcChannel.studySettingsGet, (event, payload): StudySettings => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return studySettingsStore(profileId).get();
  });

  ipcMain.handle(IpcChannel.studySettingsSet, (event, payload): StudySettings => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    // All three together, never one at a time: they are one form, and a write
    // that carried two of them would leave the third describing a decision the
    // user did not make.
    return studySettingsStore(profileId).save(
      {
        targetRetention: asBoundedNumber(
          body.targetRetention,
          "targetRetention",
          MIN_TARGET_RETENTION,
          MAX_TARGET_RETENTION,
        ),
        newPerDay: asBoundedInteger(body.newPerDay, "newPerDay", 0, MAX_NEW_PER_DAY),
        // `null` is the value, not a missing field: it MEANS "no cap at all",
        // which is why the floor below it is 1 rather than 0.
        maxReviewsPerDay: asNullableBoundedInteger(
          body.maxReviewsPerDay,
          "maxReviewsPerDay",
          1,
          MAX_REVIEWS_PER_DAY,
        ),
      },
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.notificationsCenterList, (event, payload): NotificationRecord[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return notificationStore(profileId).listCenter();
  });

  ipcMain.handle(IpcChannel.notificationsSnooze, (event, payload): NotificationRecord => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const store = notificationStore(profileId);
    const settings = store.getSettings();
    const now = new Date();
    // An omitted preset is the center's plain „Odloži“ button (NTF-009): the
    // profile's own default, read here rather than sent by the renderer, so the
    // button cannot go stale against a preference changed in another window —
    // and resolved through `resolveDefaultSnoozePreset`, so a default of
    // „Večeras“ still works after 18:00 rather than failing every evening.
    const preset =
      body.preset === undefined
        ? resolveDefaultSnoozePreset(settings.snoozeDefault, now)
        : asSnoozePreset(body.preset, "preset");
    const until = computeSnoozeUntil(preset, now, settings.morningHour);
    const record = store.snooze(id, until, now.toISOString());
    mainWindow?.webContents.send(IpcChannel.notificationsChanged);
    return record;
  });

  ipcMain.handle(IpcChannel.notificationsDismiss, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    notificationStore(profileId).dismiss(id, new Date().toISOString());
    mainWindow?.webContents.send(IpcChannel.notificationsChanged);
  });

  ipcMain.handle(IpcChannel.notificationsSettingsGet, (event, payload): NotificationSettings => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return notificationStore(profileId).getSettings();
  });

  ipcMain.handle(IpcChannel.notificationsSettingsUpdate, (event, payload): NotificationSettings => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const changes = asNotificationSettingsChanges(body.changes);
    return notificationStore(profileId).updateSettings(changes, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.notificationsSourceToggle, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const source = asNotificationSource(body.source, "source");
    const enabled = asBoolean(body.enabled, "enabled");
    notificationStore(profileId).setSourceEnabled(source, enabled, new Date().toISOString());
  });

  /**
   * The one-time NTF-008 appetite answer (ADR-033). `sources` non-null writes
   * the whole set at once — every known source is set explicitly, so a preset
   * means exactly the same thing here as it does on the Settings page rather
   * than "enable these and leave the rest as they were". `null` writes nothing
   * and only closes the question, which is what "keep the defaults" and a
   * dismissal both mean.
   *
   * Marking always happens, whatever the answer: the question is asked once,
   * ever. The immediate check afterwards is the point of the whole exchange —
   * the scheduler held this cycle back to put the question, so the reminders
   * behind it fire now, under the appetite just chosen, instead of after
   * another minute of silence.
   */
  ipcMain.handle(IpcChannel.notificationsAppetiteAnswer, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const sources = asNotificationSourceListOrNull(body.sources, "sources");
    const now = new Date().toISOString();
    const store = notificationStore(profileId);
    if (sources !== null) {
      for (const source of TOGGLEABLE_NOTIFICATION_SOURCES) {
        store.setSourceEnabled(source, sources.includes(source), now);
      }
    }
    store.markAppetiteAsked(now);
    runCheckNow();
  });

  // NOTE slice a1 (ADR-012): binary Yjs updates cross this boundary as
  // Uint8Array over structured clone. The store assigns the per-note seq and
  // main owns the compaction lifecycle — neither ever takes renderer input —
  // and `now` is always stamped here from main's own clock (SEC-EL-02).
  ipcMain.handle(IpcChannel.notesList, (event, payload): NoteMeta[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const filter =
      "folderId" in body ? { folderId: asNullableId(body.folderId, "folderId") } : undefined;
    return noteStore(profileId).list(filter);
  });

  ipcMain.handle(IpcChannel.notesCreate, (event, payload): NoteMeta => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return noteStore(profileId).create(new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.notesLoad, (event, payload): NoteDocPayload => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return noteStore(profileId).load(id);
  });

  ipcMain.handle(IpcChannel.notesAppendUpdate, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const update = asUint8Array(body.update, "update", MAX_NOTE_UPDATE_BYTES);
    const title = asString(body.title, "title");
    const store = noteStore(profileId);
    store.appendUpdate(id, update, title, new Date().toISOString());
    compactIfNeeded(store, id);
    // ADR-021 / SRCH-002 freshness fix: below the compaction threshold the
    // note's searchable body would otherwise only catch up at the NEXT
    // compaction, which could be an entire session away. Re-resolved through
    // `noteStore` rather than closing over `store` so a lock+relock between
    // now and the timer firing can never hand `compactNow` a store built on a
    // stale/closed database handle.
    scheduleIdleCompaction(`${profileId}:${id}`, () => {
      if (!db) return; // locked/closed by the time the timer fired — nothing to do
      compactNow(noteStore(profileId), id);
    });
  });

  /**
   * Soft-deletes a note and settles what becomes of the flashcards it
   * generated (PRD 09 section 7) — one transaction across both stores, so a
   * crash can never leave cards detached from a note that is still there.
   *
   * `keep` detaches the cards AND unmaps the note from its deck. The unmap is
   * what keeps undo coherent: the note's card blocks are still in its text, so
   * a restore of a still-mapped note would regenerate fresh, historyless
   * copies of the very cards the user just chose to keep. An unmapped note
   * comes back as plain text until its author deliberately points it at a deck
   * again. It is skipped when nothing was detached, so a note that generated
   * no cards is deleted exactly as it always was.
   *
   * `delete` soft-deletes them at the note's OWN `deleted_at` stamp, which is
   * what `notes:restore` below matches to undo precisely this act.
   */
  ipcMain.handle(IpcChannel.notesDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const disposition = asNoteCardDisposition(body.cards, "cards");
    const now = new Date().toISOString();
    const notes = noteStore(profileId);
    const cards = cardStore(profileId);

    requireDb().raw.transaction((): void => {
      if (disposition === "delete") {
        cards.deleteCardsOfNote(id, now);
      } else if (cards.detachCardsFromNote(id) > 0) {
        notes.setCardDeck(id, null, now);
      }
      notes.softDelete(id, now);
    })();
  });

  /**
   * „Dupliraj belešku" (NOTE-010). The whole operation — the document rewrite
   * and every row that travels with it — lives in `noteDuplicate.ts`, which
   * also documents what deliberately does NOT travel (the pin, the version
   * history, the deck mapping). Here: the trust gate, the note id, and main's
   * own clock.
   */
  ipcMain.handle(IpcChannel.notesDuplicate, (event, payload): NoteDuplicateResult => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return duplicateNote(
      {
        notes: noteStore(profileId),
        org: noteOrgStore(profileId),
        attachments: noteAttachmentStore(profileId),
        runInTransaction: (write) => requireDb().raw.transaction(write)(),
      },
      id,
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.notesRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const notes = noteStore(profileId);
    const cards = cardStore(profileId);

    // Unconditional, and free for the `keep` branch: the stamp the note was
    // deleted at matches cards only if they were deleted in that same act.
    requireDb().raw.transaction((): void => {
      const deletedAt = notes.restore(id, new Date().toISOString());
      cards.restoreCardsOfNote(id, deletedAt);
    })();
  });

  ipcMain.handle(IpcChannel.notesCardsCount, (event, payload): number => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return cardStore(profileId).countCardsOfNote(id);
  });

  /**
   * „Pretvori u zadatke" (NOTE §6), and the probe the action is offered on.
   * Nothing about the note's CONTENT crosses the boundary — unlike
   * `notes:cards-sync`, main reads the note's own merged document — so the
   * payload is two ids and a list id, each re-checked against this profile by
   * the stores themselves. The whole operation lives in `noteChecklistTasks.ts`,
   * which also documents what deliberately does not carry across (and why the
   * note is never modified).
   */
  ipcMain.handle(IpcChannel.notesChecklistCount, (event, payload): number => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return countNoteChecklistItems(noteStore(profileId), id);
  });

  ipcMain.handle(
    IpcChannel.notesChecklistToTasks,
    (event, payload): NoteChecklistTasksResult => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const id = asId(body.id, "id");
      const listId = asId(body.listId, "listId");
      return checklistToTasks(
        {
          notes: noteStore(profileId),
          tasks: taskStore(profileId),
          lists: taskListStore(profileId),
          runInTransaction: (write) => requireDb().raw.transaction(write)(),
        },
        id,
        listId,
      );
    },
  );

  // NOTE-002 (organization): folders/tags/pins. `now` is always stamped here
  // from main's own clock, never accepted from the renderer (SEC-EL-02).
  ipcMain.handle(IpcChannel.noteFoldersList, (event, payload): NoteFolder[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return noteOrgStore(profileId).listFolders();
  });

  ipcMain.handle(IpcChannel.noteFoldersCreate, (event, payload): NoteFolder => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return noteOrgStore(profileId).createFolder(
      asNoteFolderCreateInput(body.input),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.noteFoldersUpdate, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    noteOrgStore(profileId).updateFolder(
      id,
      asNoteFolderFieldChanges(body.fields),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.noteFoldersMove, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const newParentId = asNullableId(body.newParentId, "newParentId");
    noteOrgStore(profileId).moveFolder(id, newParentId, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.noteFoldersDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    noteOrgStore(profileId).deleteFolder(id, new Date().toISOString());
  });

  // ADR-036 (folder preferences). The template id is checked for SHAPE only
  // here; whether it names a real template is `NoteOrgStore`'s call, since only
  // the store can see both halves of the union (the built-in constants and this
  // profile's rows).
  ipcMain.handle(IpcChannel.noteFoldersSetTemplate, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const templateId = asNullableId(body.templateId, "templateId");
    noteOrgStore(profileId).setDefaultTemplate(id, templateId, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.noteFoldersSetCapture, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    // `null` is a real, meaningful value here — it clears the profile's mark.
    const id = asNullableId(body.id, "id");
    noteOrgStore(profileId).setCaptureDefault(id, new Date().toISOString());
  });

  // NOTE-002: which shape this folder's notes are drawn in. Only a FOLDER has a
  // row to remember one in — the root's own choice is a device preference in the
  // renderer (`notePrefs.ts`) and never reaches main.
  ipcMain.handle(IpcChannel.noteFoldersSetView, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const view = asNoteFolderView(body.view, "view");
    noteOrgStore(profileId).setFolderView(id, view, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.noteTagsList, (event, payload): NoteTag[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return noteOrgStore(profileId).listTags();
  });

  ipcMain.handle(IpcChannel.noteTagsCreate, (event, payload): NoteTag => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return noteOrgStore(profileId).createTag(asString(body.name, "name"), new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.noteTagsRename, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    noteOrgStore(profileId).renameTag(id, asString(body.name, "name"));
  });

  ipcMain.handle(IpcChannel.noteTagsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    noteOrgStore(profileId).deleteTag(id);
  });

  ipcMain.handle(IpcChannel.noteTagLinksList, (event, payload): NoteTagLink[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return noteOrgStore(profileId).listTagLinks();
  });

  ipcMain.handle(IpcChannel.noteTagsAttach, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const noteId = asId(body.noteId, "noteId");
    const tagId = asId(body.tagId, "tagId");
    noteOrgStore(profileId).attachTag(noteId, tagId);
  });

  ipcMain.handle(IpcChannel.noteTagsDetach, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const noteId = asId(body.noteId, "noteId");
    const tagId = asId(body.tagId, "tagId");
    noteOrgStore(profileId).detachTag(noteId, tagId);
  });

  // NOTE-002's third axis (migration 049): what KIND a note is. CRUD sits on
  // `NoteOrgStore` beside the folders and tags; the per-note assignment sits on
  // `NoteStore` beside `setFolder`, because it is a column on `notes`.
  ipcMain.handle(IpcChannel.noteCategoriesList, (event, payload): NoteCategory[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return noteOrgStore(profileId).listCategories();
  });

  ipcMain.handle(IpcChannel.noteCategoriesCreate, (event, payload): NoteCategory => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return noteOrgStore(profileId).createCategory(
      asNoteCategoryCreateInput(body.input),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.noteCategoriesUpdate, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    noteOrgStore(profileId).updateCategory(
      id,
      asNoteCategoryFieldChanges(body.fields),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.noteCategoriesDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    noteOrgStore(profileId).deleteCategory(id);
  });

  ipcMain.handle(IpcChannel.notesSetCategory, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const noteId = asId(body.noteId, "noteId");
    // `null` is a real, meaningful value here — it uncategorizes the note.
    const categoryId = asNullableId(body.categoryId, "categoryId");
    noteStore(profileId).setCategory(noteId, categoryId);
  });

  ipcMain.handle(IpcChannel.notesSetFolder, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const noteId = asId(body.noteId, "noteId");
    const folderId = asNullableId(body.folderId, "folderId");
    noteStore(profileId).setFolder(noteId, folderId);
  });

  ipcMain.handle(IpcChannel.notesSetPinned, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const noteId = asId(body.noteId, "noteId");
    const pinned = asBoolean(body.pinned, "pinned");
    noteStore(profileId).setPinned(noteId, pinned);
  });

  // NOTE-004: `targetIds` is renderer-declared like `title` on
  // notes:append-update (the renderer authors its own document content); the
  // store re-validates semantics (self-link, unknown id, cross-profile id).
  ipcMain.handle(IpcChannel.notesSetLinks, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const targetIds = asStringArray(body.targetIds, "targetIds", MAX_NOTE_LINKS, 64);
    noteStore(profileId).setOutboundLinks(id, targetIds);
  });

  ipcMain.handle(IpcChannel.notesBacklinks, (event, payload): NoteMeta[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return noteStore(profileId).listBacklinks(id);
  });

  // NOTE-008 (version history, ADR-015): checkpoints cross this boundary as
  // browse-list metadata (`notesVersions`) or an opaque snapshot blob
  // (`notesVersionLoad`) — the renderer replays the latter onto a throwaway
  // Y.Doc for a read-only preview. `notesVersionCapture` triggers the
  // pre-restore safety checkpoint; main merges only stored state, so no
  // renderer bytes are involved (the same bounded-harm shape as compaction).
  ipcMain.handle(IpcChannel.notesVersions, (event, payload): NoteVersionMeta[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return noteStore(profileId).listVersions(id);
  });

  ipcMain.handle(IpcChannel.notesVersionLoad, (event, payload): Uint8Array => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const coveredSeq = asPositiveInteger(body.coveredSeq, "coveredSeq");
    return noteStore(profileId).loadVersion(id, coveredSeq);
  });

  ipcMain.handle(IpcChannel.notesVersionCapture, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    captureNoteVersion(noteStore(profileId), id);
  });

  // NOTE-009 (templates, slice 009-a, ADR-016): a template crosses this
  // boundary as an opaque JSON-document string whose semantics the store
  // re-validates (parses to `{ type: "doc", ... }`) — main only checks shape
  // and the byte cap. `now` is stamped here, never accepted from the
  // renderer. `name` is passed through `asString` (not `asNonEmptyString`)
  // deliberately: emptiness after trimming is a domain rule the store owns
  // and reports as `NoteTemplateValidationError`, the same treatment
  // `noteTagsCreate`/`noteTagsRename` give tag names.
  ipcMain.handle(IpcChannel.notesTemplatesList, (event, payload): NoteTemplate[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return noteTemplateStore(profileId).list();
  });

  ipcMain.handle(IpcChannel.notesTemplateSave, (event, payload): NoteTemplate => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const name = asString(body.name, "name");
    const content = asCappedString(body.content, "content", MAX_NOTE_TEMPLATE_BYTES);
    return noteTemplateStore(profileId).save(name, content, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.notesTemplateRename, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const name = asString(body.name, "name");
    noteTemplateStore(profileId).rename(id, name, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.notesTemplateDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    noteTemplateStore(profileId).remove(id);
  });

  // NOTE-006 (inline flashcards): `cards` is renderer-declared derived data
  // about the note's own content, the same trust model as `targetIds` on
  // notes:set-links — main only checks shape/caps, and
  // `CardStore.syncFromNote` re-validates that the note and deck are both
  // live in this profile before reconciling. The returned create/update/
  // remove counts are discarded: the editor already knows what it sent, and
  // the counts exist for the store's own tests.
  ipcMain.handle(IpcChannel.notesCardsSync, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const deckId = asId(body.deckId, "deckId");
    const cards = asNoteCardSpecArray(body.cards, "cards");
    cardStore(profileId).syncFromNote(id, deckId, cards, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.notesCardDeckSet, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const deckId = asNullableId(body.deckId, "deckId");
    noteStore(profileId).setCardDeck(id, deckId, new Date().toISOString());
  });

  // NOTE-003 (attachments, slice 003-a, ADR-014): bytes are content-addressed
  // on disk (main/attachments.ts) — only this index row crosses IPC as
  // structured data; `mime` is always main-sniffed from `bytes` (SEC-FILE-02),
  // never the renderer's claim, and `now` is stamped here, never accepted
  // from the renderer.
  ipcMain.handle(IpcChannel.noteAttachmentsList, (event, payload): NoteAttachment[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return noteAttachmentStore(profileId).list(id);
  });

  ipcMain.handle(IpcChannel.noteAttachmentsAdd, async (event, payload): Promise<NoteAttachment> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const fileName = asNonEmptyString(body.fileName, "fileName");
    const bytes = asUint8Array(body.bytes, "bytes", MAX_NOTE_ATTACHMENT_BYTES);

    const store = noteAttachmentStore(profileId);
    const mime = sniffMime(bytes);
    const { sha256 } = await saveBlob(blobStorePathsFor(), requireBlobKeys(), bytes);
    try {
      const row = store.add(
        id,
        { fileName, mime, sizeBytes: bytes.byteLength, sha256 },
        new Date().toISOString(),
      );
      indexAttachmentText(store, row, bytes);
      return row;
    } catch (error) {
      // The blob was already written (write-if-absent); if the row failed to
      // insert (e.g. an unknown/soft-deleted note), GC it so a failed add
      // never leaves an orphan file — but only if nothing else references it,
      // counted across every table that names a hash (`blobRefCount`): an
      // attachment on either module, or a dashboard background.
      await deleteBlobIfOrphaned(
        blobStorePathsFor(),
        requireBlobKeys(),
        sha256,
        blobRefCount(profileId, sha256),
      );
      throw error;
    }
  });

  ipcMain.handle(IpcChannel.noteAttachmentsRemove, async (event, payload): Promise<void> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const attachmentId = asId(body.attachmentId, "attachmentId");

    const removed = noteAttachmentStore(profileId).remove(id, attachmentId);
    await deleteBlobIfOrphaned(
      blobStorePathsFor(),
      requireBlobKeys(),
      removed.sha256,
      blobRefCount(profileId, removed.sha256),
    );
  });

  ipcMain.handle(IpcChannel.noteAttachmentsOpen, async (event, payload): Promise<void> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const attachmentId = asId(body.attachmentId, "attachmentId");

    const attachment = requireNoteAttachment(profileId, id, attachmentId);
    await openExternally(blobStorePathsFor(), requireBlobKeys(), tmpOpenDirPath(), attachment);
  });

  ipcMain.handle(
    IpcChannel.noteAttachmentsSaveAs,
    (event, payload): Promise<SaveAttachmentResult> => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const id = asId(body.id, "id");
      const attachmentId = asId(body.attachmentId, "attachmentId");

      const attachment = requireNoteAttachment(profileId, id, attachmentId);
      return saveAttachmentAs(mainWindow, blobStorePathsFor(), requireBlobKeys(), attachment);
    },
  );

  // Dashboard background (SET-006 / ADR-041). The renderer never names a file
  // and never sends bytes: `handleDashboardPick` owns the dialog, the size
  // gate, the sniff and the blob write, and these four handlers validate only
  // what actually crosses IPC — a profile id, and a dim.
  ipcMain.handle(IpcChannel.dashboardGetSettings, (event, payload): DashboardSettings => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return dashboardSettingsStore(profileId).get();
  });

  ipcMain.handle(IpcChannel.dashboardPickBackground, (event, payload): Promise<DashboardPickResult> => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return handleDashboardPick(profileId);
  });

  ipcMain.handle(IpcChannel.dashboardClearBackground, async (event, payload): Promise<DashboardSettings> => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");

    const store = dashboardSettingsStore(profileId);
    const previousHash = store.get().backgroundHash;
    const settings = store.clearBackground(new Date().toISOString());
    await releaseReplacedBlob(profileId, previousHash, null);
    return settings;
  });

  ipcMain.handle(IpcChannel.dashboardSetDim, (event, payload): DashboardSettings => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const dim = asBoundedInteger(body.dim, "dim", 0, MAX_BACKGROUND_DIM);
    return dashboardSettingsStore(profileId).setDim(dim, new Date().toISOString());
  });

  // Dashboard layout (DASH-002 / ADR-045; per-board since ADR-055). SEC-EL-02
  // as everywhere else: `assertTrustedSender` first, every field through an
  // `as*` validator, and every `now` stamped from main's own clock. Each
  // answers with the WHOLE resulting layout — a mutation can re-space its
  // neighbours, so a reply naming only the touched row would leave the renderer
  // holding a stale order. `setId` (null/absent = the default board) scopes
  // every one of them.
  ipcMain.handle(
    IpcChannel.dashboardWidgetsList,
    (event, payload): DashboardWidgetInstance[] => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      return dashboardWidgetStore(profileId).listLayout(asDashboardSetScope(body.setId));
    },
  );

  ipcMain.handle(
    IpcChannel.dashboardWidgetsAdd,
    (event, payload): DashboardWidgetInstance[] => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      // Structural here, semantic in the store (SEC-EL-02's usual split): the
      // `moduleId:widgetId` slug rule is `DashboardWidgetStore`'s, and which
      // widgets actually EXIST is neither's — that catalogue lives in the module
      // manifests, and a layout deliberately keeps placements this build cannot
      // draw (migration 032).
      const widgetId = asId(body.widgetId, "widgetId");
      const size = asDashboardWidgetSize(body.size, "size");
      return dashboardWidgetStore(profileId).add(
        asDashboardSetScope(body.setId),
        widgetId,
        size,
        new Date().toISOString(),
      );
    },
  );

  ipcMain.handle(
    IpcChannel.dashboardWidgetsRemove,
    (event, payload): DashboardWidgetInstance[] => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const instanceId = asId(body.instanceId, "instanceId");
      return dashboardWidgetStore(profileId).remove(
        asDashboardSetScope(body.setId),
        instanceId,
        new Date().toISOString(),
      );
    },
  );

  ipcMain.handle(
    IpcChannel.dashboardWidgetsSetSize,
    (event, payload): DashboardWidgetInstance[] => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const instanceId = asId(body.instanceId, "instanceId");
      const size = asDashboardWidgetSize(body.size, "size");
      return dashboardWidgetStore(profileId).setSize(
        asDashboardSetScope(body.setId),
        instanceId,
        size,
        new Date().toISOString(),
      );
    },
  );

  ipcMain.handle(
    IpcChannel.dashboardWidgetsSetConfig,
    (event, payload): DashboardWidgetInstance[] => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const instanceId = asId(body.instanceId, "instanceId");
      const scope = asDashboardSetScope(body.setId);
      const store = dashboardWidgetStore(profileId);
      // The domain `config` is validated into is the CONTRACT of the widget
      // this placement draws (DASH-004 / ADR-059) — resolved from the board's
      // own layout (a not-yet-materialized default entry included), never from
      // anything the renderer claims about itself.
      const entry = store.listLayout(scope).find((row) => row.instanceId === instanceId);
      if (entry === undefined) {
        throw new Error('Invalid IPC payload: "instanceId" names no placement of this board.');
      }
      // A placement whose widget this build does not publish declares nothing,
      // so the empty declaration accepts exactly one config: the clear (`{}`).
      const contract = moduleRegistry.findWidget(entry.widgetId) ?? {};
      const config = validateWidgetConfig(contract, body.config);
      if (config === null) {
        throw new Error(
          'Invalid IPC payload: "config" is not a valid configuration for this widget.',
        );
      }
      return store.setConfig(
        scope,
        instanceId,
        serializeWidgetConfig(config),
        new Date().toISOString(),
      );
    },
  );

  ipcMain.handle(
    IpcChannel.dashboardWidgetsMove,
    (event, payload): DashboardWidgetInstance[] => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const instanceId = asId(body.instanceId, "instanceId");
      const beforeId = asNullableId(body.beforeId, "beforeId");
      const afterId = asNullableId(body.afterId, "afterId");
      return dashboardWidgetStore(profileId).move(
        asDashboardSetScope(body.setId),
        instanceId,
        beforeId,
        afterId,
        new Date().toISOString(),
      );
    },
  );

  // Named dashboards (DASH-008 / ADR-055): the switcher's five channels. Every
  // answer is the WHOLE sets state — a delete can move the active pointer, and
  // a renderer patching one row locally would be one fallback away from
  // disagreeing with what is stored. Names are trimmed here and re-checked in
  // the store; the default board needs no channel at all, because it is not a
  // row.
  ipcMain.handle(IpcChannel.dashboardSetsList, (event, payload): DashboardSetsState => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return dashboardSetsState(profileId);
  });

  ipcMain.handle(IpcChannel.dashboardSetCreate, (event, payload): DashboardSetsCreated => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const name = asDashboardSetName(body.name, "name");
    const created = dashboardSetStore(profileId).create(name, new Date().toISOString());
    return { ...dashboardSetsState(profileId), createdSetId: created.id };
  });

  ipcMain.handle(IpcChannel.dashboardSetRename, (event, payload): DashboardSetsState => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const setId = asId(body.setId, "setId");
    const name = asDashboardSetName(body.name, "name");
    dashboardSetStore(profileId).rename(setId, name, new Date().toISOString());
    return dashboardSetsState(profileId);
  });

  ipcMain.handle(IpcChannel.dashboardSetDelete, (event, payload): DashboardSetsState => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const setId = asId(body.setId, "setId");
    dashboardSetStore(profileId).delete(setId, new Date().toISOString());
    return dashboardSetsState(profileId);
  });

  ipcMain.handle(IpcChannel.dashboardSetActivate, (event, payload): DashboardSetsState => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const setId = asNullableId(body.setId, "setId");
    dashboardSetStore(profileId).setActive(setId, new Date().toISOString());
    return dashboardSetsState(profileId);
  });

  // Finansije (FIN slice b, migration 051). SEC-EL-02 as everywhere else:
  // `assertTrustedSender` first, `asRecord` on the payload, one `as*` validator
  // per field — and the store re-validates all of it afterwards, because a
  // store is never the place that assumes its caller did. `now` is stamped from
  // main's own clock on every write: when money moved is never the renderer's
  // to say.
  ipcMain.handle(IpcChannel.finAccountsList, (event, payload): FinAccount[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return finAccountStore(profileId).listActive();
  });

  // A DERIVED read, computed from the transactions on every call — there is no
  // balance column for this to go stale against.
  ipcMain.handle(IpcChannel.finAccountsBalances, (event, payload): FinAccountBalance[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return finAccountStore(profileId).listBalances();
  });

  // Per currency, always a LIST — the store has no method answering a single
  // number, so there is nothing here that could be folded into one.
  ipcMain.handle(IpcChannel.finAccountsTotals, (event, payload): FinCurrencyTotal[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return finAccountStore(profileId).totalsByCurrency();
  });

  ipcMain.handle(IpcChannel.finAccountsCreate, (event, payload): FinAccount => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return finAccountStore(profileId).create(
      asNewFinAccountInput(body.account),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.finAccountsUpdate, (event, payload): FinAccount => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return finAccountStore(profileId).update(
      id,
      asFinAccountFieldChanges(body.changes),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.finAccountsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    finAccountStore(profileId).softDelete(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.finAccountsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    finAccountStore(profileId).restore(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.finCategoriesList, (event, payload): FinCategory[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return finCategoryStore(profileId).list();
  });

  ipcMain.handle(IpcChannel.finCategoriesCreate, (event, payload): FinCategory => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const name = asNonEmptyString(body.name, "name");
    const kind = asFinCategoryKind(body.kind, "kind");
    return finCategoryStore(profileId).create({ name, kind }, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.finCategoriesRename, (event, payload): FinCategory => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const name = asNonEmptyString(body.name, "name");
    return finCategoryStore(profileId).rename(id, name, new Date().toISOString());
  });

  // A hard delete, and deliberately so: migration 051 leaves the transactions
  // standing and uncategorized (`ON DELETE SET NULL`), which is the whole of
  // what "this label no longer exists" should mean. Nothing to restore, hence
  // no undo channel beside it.
  ipcMain.handle(IpcChannel.finCategoriesDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    finCategoryStore(profileId).delete(id);
  });

  // Budgets (FIN slice c). Their own three channels because they are their own
  // table; the amount crosses as an integer of minor units like every other
  // amount on this wire.
  ipcMain.handle(IpcChannel.finBudgetsList, (event, payload): FinBudget[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return finCategoryStore(profileId).listBudgets();
  });

  ipcMain.handle(IpcChannel.finBudgetsSet, (event, payload): FinBudget => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return finCategoryStore(profileId).setBudget(
      asSetFinBudgetInput(body.budget),
      new Date().toISOString(),
    );
  });

  // One CURRENCY's allowance, never the category's whole set: an allowance in
  // another currency is a different fact and survives this call.
  ipcMain.handle(IpcChannel.finBudgetsClear, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const categoryId = asId(body.categoryId, "categoryId");
    const currency = asCurrencyCode(body.currency, "currency");
    finCategoryStore(profileId).clearBudget(categoryId, currency);
  });

  ipcMain.handle(IpcChannel.finTransactionsList, (event, payload): FinTransaction[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return finTransactionStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.finTransactionsCreate, (event, payload): FinTransaction => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return finTransactionStore(profileId).create(
      asNewFinTransactionInput(body.transaction),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.finTransactionsUpdate, (event, payload): FinTransaction => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return finTransactionStore(profileId).update(
      id,
      asFinTransactionFieldChanges(body.changes),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.finTransactionsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    finTransactionStore(profileId).softDelete(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.finTransactionsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    finTransactionStore(profileId).restore(id, new Date().toISOString());
  });

  // The month report's two reads. Both go over `fin_flows`, the transfer-free
  // view, so a transfer between the user's own accounts cannot reach either
  // answer — and both answer PER CURRENCY, which is why there are two lists
  // here and no channel anywhere returning a single figure.
  ipcMain.handle(IpcChannel.finTransactionsSpend, (event, payload): FinCategorySpend[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return finTransactionStore(profileId).spendByCategory(asFinPeriod(body.period));
  });

  ipcMain.handle(IpcChannel.finTransactionsIncome, (event, payload): FinCurrencyTotal[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return finTransactionStore(profileId).incomeByCurrency(asFinPeriod(body.period));
  });

  // Subscriptions (FIN slice d, migration 053). There is deliberately NO
  // „generate now" channel beside these: posting the charges that have come due
  // is a main-process act, run from the reminder check beside `plans.syncAll`,
  // and a renderer that could ask for it could ask twice. (It could not
  // double-charge — the schema's unique index makes that impossible — but a
  // write path nobody needs is a write path nobody should have.)
  ipcMain.handle(IpcChannel.finRecurringList, (event, payload): FinRecurring[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return finRecurringStore(profileId).listActive();
  });

  // Derived from each RULE on every call — never a read of transaction rows,
  // because a renewal that has not happened yet has none.
  ipcMain.handle(IpcChannel.finRecurringUpcoming, (event, payload): FinUpcomingRenewal[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return finRecurringStore(profileId).upcoming(asFinRenewalWindow(body.window));
  });

  ipcMain.handle(IpcChannel.finRecurringCreate, (event, payload): FinRecurring => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return finRecurringStore(profileId).create(
      asNewFinRecurringInput(body.subscription),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.finRecurringUpdate, (event, payload): FinRecurring => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return finRecurringStore(profileId).update(
      id,
      asFinRecurringFieldChanges(body.changes),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.finRecurringDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    finRecurringStore(profileId).softDelete(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.finRecurringRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    finRecurringStore(profileId).restore(id, new Date().toISOString());
  });

  // Pausing (ADR-074): „ne naplaćuj me, ali zadrži pretplatu". Stops generation
  // and every renewal the schedule would have placed, and nothing else.
  ipcMain.handle(IpcChannel.finRecurringPause, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    finRecurringStore(profileId).pause(id, new Date().toISOString());
  });

  // Resuming re-anchors the cursor to the first occurrence on or after today —
  // `localToday()`, the very function the generation pass reads its day from, so
  // „danas" cannot mean two different days inside one app.
  ipcMain.handle(IpcChannel.finRecurringResume, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    finRecurringStore(profileId).resume(id, new Date().toISOString(), localToday());
  });

  // Navike (HABIT slice b, migration 055). SEC-EL-02 as everywhere else:
  // `assertTrustedSender` first, `asRecord` on the payload, one `as*` validator
  // per field — and the store re-validates all of it, because a store is never
  // the place that assumes its caller did. `now` is main's clock on every write,
  // and so is the DAY a tick lands on: „danas" is decided here, by the same
  // `localToday()` slice c's reminder check will read.
  ipcMain.handle(IpcChannel.habitsList, (event, payload): Habit[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return habitStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.habitsCreate, (event, payload): Habit => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return habitStore(profileId).create(asNewHabitInput(body.habit), new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.habitsUpdate, (event, payload): Habit => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return habitStore(profileId).update(
      id,
      asHabitFieldChanges(body.changes),
      new Date().toISOString(),
    );
  });

  // A soft delete: the entries are UNTOUCHED, so the undo beside it brings the
  // habit back with every tick it ever had.
  ipcMain.handle(IpcChannel.habitsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    habitStore(profileId).softDelete(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.habitsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    habitStore(profileId).restore(id, new Date().toISOString());
  });

  // Archiving (migration 055): „gotov sam s ovim", which is a different act from
  // throwing it away — the habit leaves „Danas" and keeps every day it recorded.
  ipcMain.handle(IpcChannel.habitsArchive, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    habitStore(profileId).archive(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.habitsUnarchive, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    habitStore(profileId).unarchive(id, new Date().toISOString());
  });

  // One day's tick — today's, or a past one the user is correcting from the
  // history grid. The day is validated here on both bounds; see
  // `asHabitEntryDay` for why a named day is data rather than a clock claim.
  ipcMain.handle(IpcChannel.habitsSetEntry, (event, payload): HabitEntry => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const habitId = asId(body.habitId, "habitId");
    const day = asHabitEntryDay(body.day, "day");
    const value = asHabitCount(body.value, "value");
    const store = habitStore(profileId);
    assertHabitExisted(store, habitId, day);
    return store.setEntry(habitId, day, value, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.habitsClearEntry, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const habitId = asId(body.habitId, "habitId");
    const day = asHabitEntryDay(body.day, "day");
    const store = habitStore(profileId);
    assertHabitExisted(store, habitId, day);
    store.clearEntry(habitId, day);
  });

  // Every live habit's ticks over one window, in ONE query — the page's today
  // list, its history grid and its streaks are all read off this single answer.
  ipcMain.handle(IpcChannel.habitsEntries, (event, payload): HabitEntry[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return habitStore(profileId).listAllEntries(asHabitDayRange(body.range));
  });

  // Ishrana (FIT slice b, migration 058). SEC-EL-02 as everywhere: trusted
  // sender, `asRecord`, one `as*` per field, and the store re-validates all of
  // it. `now` is main's clock on every write, and so is the bound on which DAY a
  // meal may be logged for.
  //
  // The merged food search. ONE ranked list over both sources, through core's
  // own `searchFoods` — the catalogue that ships in the app and this profile's
  // `fit_foods`, told apart only by the reference each hit carries. Two lists
  // ranked separately and merged here would be a SECOND definition of „best
  // match", and the day it drifted the picker would start ordering results by
  // where the food happened to live.
  //
  // The pool is deliberately light: a candidate is an id and a name, and only
  // the hits are built into full options — a screen's worth of objects rather
  // than the whole catalogue's, on every keystroke.
  ipcMain.handle(IpcChannel.fitFoodSearch, (event, payload): FitFoodOption[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const query = asCappedChars(body.query, "query", MAX_FIT_FOOD_QUERY_LENGTH);
    const limit = Math.min(asPositiveInteger(body.limit, "limit"), MAX_FIT_FOOD_RESULTS);

    type Candidate =
      | { id: string; name: string; catalogue: FoodEntry }
      | { id: string; name: string; user: FitFood };
    const pool: Candidate[] = [
      ...FOOD_CATALOGUE.map((food) => ({
        id: foodRefText({ kind: "catalogue", id: food.id }),
        name: food.name,
        catalogue: food,
      })),
      ...fitFoodStore(profileId)
        .list()
        .map((food) => ({
          id: foodRefText({ kind: "user", id: food.id }),
          name: food.name,
          user: food,
        })),
    ];
    return searchFoods(pool, query, limit).map((hit) =>
      "catalogue" in hit ? catalogueOption(hit.catalogue) : userFoodOption(hit.user),
    );
  });

  // One day of the diary: the five slots and the total the SAME rows add up to,
  // in one answer. Both halves together for the page's sake — a render holding
  // the rows but not their total would show a figure that no longer follows from
  // the list above it — and the total is the store's own `sumMacros`, never a
  // second arithmetic here.
  ipcMain.handle(IpcChannel.fitDay, (event, payload): FitDay => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const day = asFitDay(body.day, "day");
    const store = fitMealStore(profileId);
    return { day, slots: store.listDay(day), totals: store.dayTotals(day) };
  });

  // The resolve-then-snapshot boundary (see `resolveLoggedFood`): the renderer
  // names a food and says how much, main looks the food up and stamps the seven
  // numbers it found. Nothing on this wire lets a caller supply macros for a
  // food it named.
  ipcMain.handle(IpcChannel.fitItemAdd, (event, payload): FitMealItem => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const resolved = resolveLoggedFood(profileId, body.foodRef);
    return fitMealStore(profileId).addItem(
      {
        date: asFitDay(body.day, "day"),
        slot: asFitMealSlot(body.slot, "slot"),
        grams: asFitGrams(body.grams, "grams"),
        ...resolved,
      },
      new Date().toISOString(),
    );
  });

  // Only the weight and the slot. The snapshot is untouched by construction —
  // the store has no statement that could reach it — because re-reading the food
  // here would silently restate the row under today's numbers, which is the
  // exact failure the snapshot exists to prevent.
  ipcMain.handle(IpcChannel.fitItemUpdate, (event, payload): FitMealItem => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const changes: { grams?: number; slot?: MealSlot } = {};
    if (body.grams !== undefined) changes.grams = asFitGrams(body.grams, "grams");
    if (body.slot !== undefined) changes.slot = asFitMealSlot(body.slot, "slot");
    return fitMealStore(profileId).updateItem(id, changes, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.fitItemRemove, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    fitMealStore(profileId).removeItem(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.fitItemRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    fitMealStore(profileId).restoreItem(id, new Date().toISOString());
  });

  // The profile's OWN foods. The catalogue has no CRUD anywhere on this wire,
  // because it is not a table — see migration 058.
  ipcMain.handle(IpcChannel.fitFoodsList, (event, payload): FitFood[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return fitFoodStore(profileId).list();
  });

  ipcMain.handle(IpcChannel.fitFoodCreate, (event, payload): FitFood => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return fitFoodStore(profileId).create(
      asNewFitFoodInput(body.food),
      new Date().toISOString(),
    );
  });

  // Correcting a food changes what you log from now on and leaves last Tuesday
  // exactly as it was — every logged item carries its own snapshot.
  ipcMain.handle(IpcChannel.fitFoodUpdate, (event, payload): FitFood => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return fitFoodStore(profileId).update(
      id,
      asFitFoodChanges(body.changes),
      new Date().toISOString(),
    );
  });

  // A soft delete: everything already logged with this food stays readable, and
  // the undo beside it puts the food back under the very same id.
  ipcMain.handle(IpcChannel.fitFoodDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    fitFoodStore(profileId).softDelete(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.fitFoodRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    fitFoodStore(profileId).restore(id, new Date().toISOString());
  });

  // One total per day, straight off the store's own range read — which is where
  // the „a day with nothing logged is ABSENT" rule lives, and this handler adds
  // nothing to it. The store caps the span; a screen asking for a decade of
  // totals is a screen with a bug.
  ipcMain.handle(IpcChannel.fitDayTotalsRange, (event, payload): FitDayTotals[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return fitMealStore(profileId).rangeTotals({
      from: asFitDay(body.from, "from"),
      to: asFitDay(body.to, "to"),
    });
  });

  ipcMain.handle(IpcChannel.fitTargets, (event, payload): FitTargets => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return fitTargetStore(profileId).get();
  });

  // All four goals in one write. `null` is „no goal" and `0` is „a goal of zero"
  // — the two are different claims and nothing here collapses them.
  ipcMain.handle(IpcChannel.fitTargetsSave, (event, payload): FitTargets => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return fitTargetStore(profileId).save(
      asFitTargetGoals(body.goals),
      new Date().toISOString(),
    );
  });

  // Trening i telo (FIT slice b, migration 060). SEC-EL-02 throughout: trusted
  // sender, `asRecord`, one `as*` per field, and the store re-validates every
  // bit of it because a store is never the place that assumes its caller did.
  // `now` is main's clock on every write.
  //
  // The one thing to keep in view while reading these: NOTHING here lets a
  // caller supply a set's `label`, `metric` or muscle list. Every one of those
  // comes out of `resolveLoggedExercise`, on the trusted side, from the
  // reference the caller named. See that function for what it is defending.
  ipcMain.handle(IpcChannel.fitExerciseSearch, (event, payload): FitExerciseOption[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const query = asCappedChars(body.query, "query", MAX_FIT_EXERCISE_QUERY_LENGTH);
    const limit = Math.min(asPositiveInteger(body.limit, "limit"), MAX_FIT_EXERCISE_RESULTS);

    // One pool, one ranking. Two lists merged by the renderer would be a second
    // definition of "best match" — `fit:food-search`'s own reason.
    type Candidate =
      | { id: string; name: string; nameEn: string; catalogue: ExerciseEntry }
      | { id: string; name: string; nameEn: string; own: FitExercise };
    const pool: Candidate[] = [
      ...EXERCISE_CATALOGUE.map((entry) => ({
        id: exerciseRefText({ kind: "catalogue", id: entry.id }),
        name: entry.name,
        nameEn: entry.nameEn,
        catalogue: entry,
      })),
      ...fitExerciseStore(profileId)
        .list()
        .map((entry) => ({
          id: exerciseRefText({ kind: "user", id: entry.id }),
          name: entry.name,
          nameEn: entry.nameEn,
          own: entry,
        })),
    ];
    return searchExercises(pool, query, limit).map((hit) =>
      "catalogue" in hit ? catalogueExerciseOption(hit.catalogue) : userExerciseOption(hit.own),
    );
  });

  ipcMain.handle(IpcChannel.fitExercisesList, (event, payload): FitExercise[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return fitExerciseStore(profileId).list();
  });

  ipcMain.handle(IpcChannel.fitExerciseCreate, (event, payload): FitExercise => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return fitExerciseStore(profileId).create(
      asNewFitExercise(body.exercise),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.fitExerciseUpdate, (event, payload): FitExercise => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return fitExerciseStore(profileId).update(
      id,
      asFitExerciseChanges(body.changes),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.fitExerciseDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    fitExerciseStore(profileId).remove(asId(body.id, "id"), new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.fitExerciseRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    fitExerciseStore(profileId).restore(asId(body.id, "id"), new Date().toISOString());
  });

  // Every routine's items are resolved LIVE against one read of the profile's
  // own exercises — see `toWireRoutine` for why a routine's label and metric are
  // not the snapshot a logged set's are.
  ipcMain.handle(IpcChannel.fitRoutinesList, (event, payload): FitRoutine[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    const lookup = fitExerciseLookup(profileId);
    return fitRoutineStore(profileId)
      .list()
      .map((routine) => toWireRoutine(routine, lookup));
  });

  // Create and rewrite share one body-reader: both send the routine WHOLE, and
  // main resolves every reference to write the label itself — a routine whose
  // label was the caller's claim could name one exercise and point at another.
  ipcMain.handle(IpcChannel.fitRoutineCreate, (event, payload): FitRoutine => {
    assertTrustedSender(event);
    const { profileId, name, notes, items } = readFitRoutineBody(payload);
    return toWireRoutine(
      fitRoutineStore(profileId).create({ name, notes, items }, new Date().toISOString()),
      fitExerciseLookup(profileId),
    );
  });

  ipcMain.handle(IpcChannel.fitRoutineUpdate, (event, payload): FitRoutine => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const id = asId(body.id, "id");
    const { profileId, name, notes, items } = readFitRoutineBody(payload);
    return toWireRoutine(
      fitRoutineStore(profileId).update(id, { name, notes, items }, new Date().toISOString()),
      fitExerciseLookup(profileId),
    );
  });

  ipcMain.handle(IpcChannel.fitRoutineDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    fitRoutineStore(profileId).remove(asId(body.id, "id"), new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.fitRoutineRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    fitRoutineStore(profileId).restore(asId(body.id, "id"), new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.fitWorkoutOpen, (event, payload): FitWorkout | null => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return fitWorkoutStore(profileId).open();
  });

  ipcMain.handle(IpcChannel.fitWorkoutStart, (event, payload): FitWorkout => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const day = asFitTrainingDay(body.day, "day");
    const notes =
      body.notes === undefined
        ? ""
        : asCappedChars(body.notes, "notes", MAX_FIT_WORKOUT_NOTES_LENGTH);
    // The routine's NAME is main's, taken now, from the routine it actually
    // found. A session started from a routine that is later renamed still says
    // what it was started from.
    if (body.routineRef === undefined || body.routineRef === null) {
      return fitWorkoutStore(profileId).start({ day, notes }, new Date().toISOString());
    }
    const routine = fitRoutineStore(profileId).get(asNonEmptyString(body.routineRef, "routineRef"));
    return fitWorkoutStore(profileId).start(
      { day, routineRef: routine.id, routineLabel: routine.name, notes },
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.fitWorkoutFinish, (event, payload): FitWorkout => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return fitWorkoutStore(profileId).finish(
      asId(body.id, "id"),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.fitWorkoutReopen, (event, payload): FitWorkout => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return fitWorkoutStore(profileId).reopen(
      asId(body.id, "id"),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.fitWorkoutUpdate, (event, payload): FitWorkout => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const changes: { day?: string; notes?: string } = {};
    if (body.day !== undefined) changes.day = asFitTrainingDay(body.day, "day");
    if (body.notes !== undefined) {
      changes.notes = asCappedChars(body.notes, "notes", MAX_FIT_WORKOUT_NOTES_LENGTH);
    }
    return fitWorkoutStore(profileId).updateWorkout(id, changes, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.fitWorkoutDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    fitWorkoutStore(profileId).remove(asId(body.id, "id"), new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.fitWorkoutRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    fitWorkoutStore(profileId).restore(asId(body.id, "id"), new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.fitWorkoutsRange, (event, payload): FitWorkout[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return fitWorkoutStore(profileId).listRange(
      asBareDate(body.from, "from"),
      asBareDate(body.to, "to"),
    );
  });

  // The resolve-then-snapshot boundary. The renderer names an exercise and
  // gives the numbers; main looks the exercise up and stamps the label, the
  // metric and the muscles it found.
  ipcMain.handle(IpcChannel.fitSetLog, (event, payload): FitWorkoutSet => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const workoutId = asId(body.workoutId, "workoutId");
    const resolved = resolveLoggedExercise(profileId, body.exerciseRef);
    return fitWorkoutStore(profileId).logSet(
      workoutId,
      {
        ...resolved,
        kind: asFitSetKind(body.kind, "kind"),
        weightKg: asFitSetNumber(body.weightKg, "weightKg", MAX_WEIGHT_KG),
        reps: asFitSetCount(body.reps, "reps", 9999),
        seconds: asFitSetNumber(body.seconds, "seconds", 86_400),
        distanceM: asFitSetNumber(body.distanceM, "distanceM", 1_000_000),
        rir: asFitRir(body.rir, "rir"),
      },
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.fitSetUpdate, (event, payload): FitWorkoutSet => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    // Only the numbers and the kind. The snapshot is not on this wire at all,
    // so no payload can reach it.
    const changes: UpdateFitSetFields = {};
    if (body.kind !== undefined) changes.kind = asFitSetKind(body.kind, "kind");
    if (body.weightKg !== undefined) {
      changes.weightKg = asFitSetNumber(body.weightKg, "weightKg", MAX_WEIGHT_KG);
    }
    if (body.reps !== undefined) changes.reps = asFitSetCount(body.reps, "reps", 9999);
    if (body.seconds !== undefined) {
      changes.seconds = asFitSetNumber(body.seconds, "seconds", 86_400);
    }
    if (body.distanceM !== undefined) {
      changes.distanceM = asFitSetNumber(body.distanceM, "distanceM", 1_000_000);
    }
    if (body.rir !== undefined) changes.rir = asFitRir(body.rir, "rir");
    return fitWorkoutStore(profileId).updateSet(id, changes, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.fitSetRemove, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    fitWorkoutStore(profileId).removeSet(asId(body.id, "id"));
  });

  ipcMain.handle(IpcChannel.fitLastPerformed, (event, payload): FitLastPerformed[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const refs = asStringArray(
      body.exerciseRefs,
      "exerciseRefs",
      MAX_FIT_LAST_PERFORMED_REFS,
      MAX_EXERCISE_REF_LENGTH,
    );
    return fitWorkoutStore(profileId).lastPerformed(refs);
  });

  ipcMain.handle(IpcChannel.fitMeasurements, (event, payload): FitMeasurement[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return fitMeasurementStore(profileId).listRange(
      asBareDate(body.from, "from"),
      asBareDate(body.to, "to"),
    );
  });

  ipcMain.handle(IpcChannel.fitMeasurementSave, (event, payload): FitMeasurement => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return fitMeasurementStore(profileId).save(
      asFitMeasurementInput(body.measurement),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.fitMeasurementRemove, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    fitMeasurementStore(profileId).remove(asBareDate(body.day, "day"));
  });

  // The store's row carries `createdAt`/`updatedAt` for the interchange's sake;
  // the WIRE declares four fields and must therefore send four. Structural
  // typing would let the wider object through silently, which is how a contract
  // starts describing something other than what crosses it.
  ipcMain.handle(IpcChannel.fitBodyProfile, (event, payload): FitBodyProfile | null => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    const row = fitBodyProfileStore(profileId).get();
    return row === null ? null : toWireBodyProfile(row);
  });

  ipcMain.handle(IpcChannel.fitBodyProfileSave, (event, payload): FitBodyProfile => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return toWireBodyProfile(
      fitBodyProfileStore(profileId).save(
        asFitBodyProfileInput(body.profile),
        new Date().toISOString(),
      ),
    );
  });

  // The rest countdown. SEC-EL-02 exactly as `focus:*`: both instants are
  // main's clock, and the renderer supplies only how long — a countdown whose
  // start the renderer could name would be a timer that can be told it began in
  // the past. Nothing here touches the database, because there is nothing to
  // write (`runningRestTimers`).
  ipcMain.handle(IpcChannel.fitRestStart, (event, payload): FitRestTimer => {
    assertTrustedSender(event);
    // The one thing this handler needs the database for: not to read it, but to
    // require that the session is UNLOCKED. `performLock` clears every running
    // countdown, so a rest started while locked would be an orphan nothing ever
    // cancels — and every other channel is implicitly gated the same way by
    // touching a store.
    requireDb();
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const seconds = asPositiveInteger(body.seconds, "seconds");
    if (seconds < MIN_FIT_REST_SECONDS || seconds > MAX_FIT_REST_SECONDS) {
      throw new Error(
        `Invalid IPC payload: "seconds" must be between ${MIN_FIT_REST_SECONDS} and ${MAX_FIT_REST_SECONDS}.`,
      );
    }
    return startRestTimer(profileId, seconds);
  });

  // Idempotent: a rest that already elapsed is stopped the same way one still
  // running is, because dismissing a finished countdown is the ordinary way it
  // ends and must not read as an error.
  ipcMain.handle(IpcChannel.fitRestStop, (event, payload): void => {
    assertTrustedSender(event);
    clearRestTimer(asId(asRecord(payload).profileId, "profileId"));
  });

  ipcMain.handle(IpcChannel.fitRestStatus, (event, payload): FitRestTimer | null => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    const rest = runningRestTimers.get(profileId);
    return rest === undefined ? null : toWireRestTimer(rest);
  });

  // Tabla (CANV slice a, migration 059). SEC-EL-02 as everywhere: trusted
  // sender, `asRecord`, one `as*` per field, and the store re-validates all of
  // it — including the scene, which it parses a second time on its own terms
  // because a store is never the place that assumes its caller did. `now` is
  // main's clock on every write.
  //
  // The list read answers METADATA and the open read answers a DRAWING, two
  // channels rather than one, because the first is asked for on every mount and
  // the second carries megabytes (see the channel list's own note).
  ipcMain.handle(IpcChannel.canvasList, (event, payload): CanvasBoard[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return canvasStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.canvasOpen, (event, payload): CanvasBoardWithScene => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return canvasStore(profileId).readScene(id);
  });

  // An ABSENT `scene` is „prazna tabla", read off the key being missing rather
  // than off a sentinel — the store owns what an empty document is, so nothing
  // here has to construct one.
  ipcMain.handle(IpcChannel.canvasCreate, (event, payload): CanvasBoardWithScene => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const name = asCanvasBoardName(body.name, "name");
    const input =
      body.scene === undefined
        ? { name }
        : { name, scene: asCanvasScene(body.scene, "scene") };
    return canvasStore(profileId).create(input, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.canvasRename, (event, payload): CanvasBoard => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const name = asCanvasBoardName(body.name, "name");
    return canvasStore(profileId).rename(id, name, new Date().toISOString());
  });

  // The autosave — the one channel here that fires while somebody is working.
  // It carries no name and answers no scene: the caller already has the
  // document, and echoing it back would double the cost of every save.
  ipcMain.handle(IpcChannel.canvasSaveScene, (event, payload): CanvasBoard => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const scene = asCanvasScene(body.scene, "scene");
    return canvasStore(profileId).saveScene(id, scene, new Date().toISOString());
  });

  // A soft delete: the drawing is UNTOUCHED, so the undo beside it brings the
  // board back exactly as it was.
  ipcMain.handle(IpcChannel.canvasDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    canvasStore(profileId).softDelete(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.canvasRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    canvasStore(profileId).restore(id, new Date().toISOString());
  });

  // The cards on a board (CANV slice b2). The references arrive as the very
  // `nexus://…` strings the elements carry, and `asCanvasRefs` — the grammar,
  // not a shape check — is what decides which of them may become a query.
  ipcMain.handle(IpcChannel.canvasResolveRefs, (event, payload): CanvasRefCard[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const refs = asCanvasRefs(body.refs, "refs");
    return canvasStore(profileId).resolveRefs(refs);
  });

  // Elektronika (ELEC slice E1, migration 067). Twelve channels over one store
  // and three tables, and the store re-validates everything below through
  // `@nexus/core`'s own gate — including the invariant no payload can carry,
  // that a wire's two ends are live parts of the circuit the wire is on. `now`
  // is main's clock on every write.
  //
  // The COMPONENT catalogue is absent from this whole block and there is no
  // channel for it: it ships as constants in `@nexus/core`, which the renderer
  // imports directly.
  ipcMain.handle(IpcChannel.elecList, (event, payload): ElecCircuit[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return electronicsStore(profileId).listActive();
  });

  // The one read that carries a whole circuit. It answers the DOCUMENT shape
  // rather than the store's rows — see `toCircuitDocument`.
  ipcMain.handle(IpcChannel.elecOpen, (event, payload): ElecCircuitDocument => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return toCircuitDocument(electronicsStore(profileId).read(id));
  });

  // An ABSENT `notes` is an empty one, read off the key being missing rather
  // than off a sentinel — the store owns what „no notes" is.
  ipcMain.handle(IpcChannel.elecCreate, (event, payload): ElecCircuit => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const name = asCircuitName(body.name, "name");
    const input =
      body.notes === undefined ? { name } : { name, notes: asCircuitNotes(body.notes, "notes") };
    return electronicsStore(profileId).createCircuit(input, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.elecRename, (event, payload): ElecCircuit => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const name = asCircuitName(body.name, "name");
    return electronicsStore(profileId).renameCircuit(id, name, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.elecSetNotes, (event, payload): ElecCircuit => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const notes = asCircuitNotes(body.notes, "notes");
    return electronicsStore(profileId).setNotes(id, notes, new Date().toISOString());
  });

  // A soft delete: every part and wire is UNTOUCHED, so the undo beside it
  // brings the canvas back exactly as it was rather than as an empty circuit.
  ipcMain.handle(IpcChannel.elecDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    electronicsStore(profileId).softDelete(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.elecRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    electronicsStore(profileId).restore(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.elecAddPart, (event, payload): CircuitPart => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const circuitId = asId(body.circuitId, "circuitId");
    const part = asNewCircuitPart(body.part, "part");
    return electronicsStore(profileId).addPart(circuitId, part, new Date().toISOString());
  });

  // The channel that fires while somebody is working — one drag is one call —
  // so it carries the narrowest payload there is: an id and whichever fields
  // actually changed. It cannot rename the circuit and cannot touch a wire.
  ipcMain.handle(IpcChannel.elecUpdatePart, (event, payload): CircuitPart => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const fields = asCircuitPartFields(body.fields, "fields");
    return electronicsStore(profileId).updatePart(id, fields, new Date().toISOString());
  });

  // Answers with the WIRES that went with the part. SQLite's `ON DELETE
  // CASCADE` fires on a hard delete and this is a soft one, so the store takes
  // them itself — and the canvas has to erase them from a document it is
  // holding, which re-opening the circuit would tell it at the cost of every
  // other row on it.
  ipcMain.handle(IpcChannel.elecRemovePart, (event, payload): string[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return electronicsStore(profileId).removePart(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.elecAddWire, (event, payload): CircuitWire => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const circuitId = asId(body.circuitId, "circuitId");
    const wire = asNewCircuitWire(body.wire, "wire");
    return toWireDocument(
      electronicsStore(profileId).addWire(circuitId, wire, new Date().toISOString()),
    );
  });

  // Colour is the only field of a wire this channel can reach, and the narrowing
  // is `asWireColour`'s — the same one `elec:add-wire` runs, so a colour cannot
  // enter the file by one door that the other door would have refused.
  ipcMain.handle(IpcChannel.elecSetWireColour, (event, payload): CircuitWire => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const colour = asWireColour(body.colour, "colour");
    return toWireDocument(
      electronicsStore(profileId).setWireColour(id, colour, new Date().toISOString()),
    );
  });

  ipcMain.handle(IpcChannel.elecRemoveWire, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    electronicsStore(profileId).removeWire(id, new Date().toISOString());
  });

  // ADR-085 E4c: the machine the circuit is the electronics of. `null` removes
  // it — a circuit that turned out to be a breadboard after all — and the two
  // arms are one channel rather than two because they are one edit to the user:
  // the form's „ovo nije mašina" is the same save button as its nine fields.
  //
  // It answers the chassis rather than the whole document. Nothing else moved,
  // and re-reading every part and wire to say so would be the expensive read
  // the caller is already holding.
  ipcMain.handle(IpcChannel.elecSetChassis, (event, payload): Chassis | null => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const chassis = body.chassis === null ? null : asChassis(body.chassis, "chassis");
    electronicsStore(profileId).setChassis(id, chassis, new Date().toISOString());
    return chassis;
  });

  // ADR-085 E4: the generated code onto disk. The payload is an id and nothing
  // else — main reads the circuit from its own store and generates the text
  // here, so the bytes written are the circuit as stored rather than a string
  // the renderer composed. The path comes only from the native dialog (SEC-EL);
  // `handleIcsExport` in `main/imex.ts` is the shape this follows.
  //
  // **Which dialog the user sees is derived, never asked for.** A sketch is one
  // file and a ROS 2 package is a directory of eight, so `generateCode` decides
  // by reading the stored circuit's board. A renderer cannot ask for the wrong
  // one, because it cannot ask for either.
  //
  // The refusals ride back rather than throwing. „This circuit has two boards"
  // is a true sentence about the circuit, not a failure of the export, and the
  // renderer already hides the button for it — reaching this arm means the
  // canvas changed under the click, which is worth saying out loud and is
  // certainly worth NOT overwriting the file the user just pointed at.
  ipcMain.handle(IpcChannel.elecExportCode, async (event, payload): Promise<CodeExportResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");

    const circuit = toCircuitDocument(electronicsStore(profileId).read(id));
    const code = generateCode(circuit, catalogueComponent);
    if (code.kind === "refused") {
      return { canceled: false, outcome: "refused", reason: code.reason };
    }

    if (code.kind === "sketch") {
      const dialogOptions = {
        defaultPath: code.filename,
        filters: [{ name: SKETCH_FILTER_NAME, extensions: ["ino"] }],
      };
      const { canceled, filePath } = mainWindow
        ? await dialog.showSaveDialog(mainWindow, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);
      if (canceled || !filePath) return { canceled: true };

      await writeFileAsync(filePath, code.source, "utf8");
      const libraries = code.libraries.length;
      return { canceled: false, outcome: "sketch", path: filePath, libraries };
    }

    // A package is a DIRECTORY, so the user picks its parent — a colcon
    // workspace's `src/` — and Nexus makes the package folder inside it. That
    // is the layout `colcon build` requires, and writing the eight files
    // straight into the chosen directory would scatter a `package.xml` into a
    // workspace that already has several.
    const chosen = mainWindow
      ? await dialog.showOpenDialog(mainWindow, ROS_WORKSPACE_DIALOG)
      : await dialog.showOpenDialog(ROS_WORKSPACE_DIALOG);
    const parent = chosen.filePaths[0];
    if (chosen.canceled || parent === undefined) return { canceled: true };

    const root = join(parent, code.name);
    // Never over an existing directory. The generated README tells the user to
    // fill in the licence and to write their own node beside `wiring.py`, so a
    // second export that overwrote this would destroy work Nexus asked for.
    if (existsSync(root)) return { canceled: false, outcome: "exists", path: root };

    for (const file of code.files) {
      // Belt and braces. Every path here is generated — the package name is
      // `[a-z0-9_]` by construction and the rest are literals — so this can
      // only fire if the generator itself changes. That is the point: it turns
      // „a future edit puts a `..` in a path" from a write outside the user's
      // chosen directory into a thrown error.
      assertInsidePackage(file.path);
      const target = join(root, file.path);
      await mkdirAsync(dirname(target), { recursive: true });
      await writeFileAsync(target, file.contents, "utf8");
    }
    return { canceled: false, outcome: "package", path: root, files: code.files.length };
  });

  // The external runner (ADR-085 slice E6, DEV-007). Ten channels over one
  // stateful object, and the ONLY ones in this file through which a process can
  // be started on the user's machine.
  //
  // **The three run channels carry a circuit id and NOTHING ELSE**, which is
  // DEV-007's third mitigation: the command line comes from `@nexus/core`'s
  // closed table, the profile comes from the user's own settings row, and the
  // renderer cannot influence either. `assertTrustedSender`, `asRecord` and
  // `asId` are everything this file does to the payload; what a field may BE is
  // decided in `elecRunnerIpc.ts`, beside the code that acts on it.
  //
  // The two settings writes are separate channels because they are two powers:
  // `enable` is the CONSENT — it is what records `consented_at`, and nothing
  // else may — while `choice` is a preference that cannot even be stored on a
  // runner that is off.
  ipcMain.handle(IpcChannel.elecRunnerDetect, (event, payload): Promise<RunnerDetection[]> => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return runnerIpc().detect(profileId);
  });

  ipcMain.handle(IpcChannel.elecRunnerPlan, (event, payload): RunnerPlanResult => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return runnerIpc().plan(profileId, id);
  });

  ipcMain.handle(IpcChannel.elecRunnerStart, (event, payload): RunnerStartResult => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    return runnerIpc().start(profileId, id);
  });

  ipcMain.handle(IpcChannel.elecRunnerStop, (event, payload): Promise<RunnerStopState> => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return runnerIpc().stop(profileId);
  });

  ipcMain.handle(IpcChannel.elecRunnerState, (event, payload): RunnerState => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return runnerIpc().state(profileId);
  });

  ipcMain.handle(IpcChannel.elecRunnerSettings, (event, payload): RunnerSettings => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return runnerIpc().settings(profileId);
  });

  ipcMain.handle(IpcChannel.elecRunnerEnable, (event, payload): RunnerSettings => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return runnerIpc().enable(profileId, body.enabled);
  });

  ipcMain.handle(IpcChannel.elecRunnerChoice, (event, payload): RunnerSettings => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    return runnerIpc().choice(profileId, body.choice, body.distro);
  });

  // Global search (ADR-021 / PRD 08 SRCH-001/002): `runSearchQuery`/
  // `runRecentSearch` own the actual pipeline (see their doc comments) so the
  // smoke rehearsal can call the exact same code the renderer does.
  ipcMain.handle(IpcChannel.searchQuery, (event, payload): Promise<SearchResult[]> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const query = asCappedString(body.query, "query", SEARCH_QUERY_MAX_BYTES);
    const limit = Math.min(asPositiveInteger(body.limit, "limit"), SEARCH_RESULT_MAX_LIMIT);
    return runSearchQuery(profileId, query, limit);
  });

  ipcMain.handle(IpcChannel.searchRecent, (event, payload): Promise<SearchResult[]> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const limit = Math.min(asPositiveInteger(body.limit, "limit"), SEARCH_RESULT_MAX_LIMIT);
    return runRecentSearch(profileId, limit);
  });

  /**
   * The ADR-039 search page. No `limit` on the wire: the page's size is a
   * property of the surface (`SEARCH_PAGE_MAX_RESULTS`, applied inside
   * `runSearchPage`), not something the renderer negotiates — so there is one
   * fewer number to validate and no way for a caller to ask for more than the
   * page was designed to carry. An empty query is browse mode, which is why
   * `query` is capped but not required to be non-empty.
   */
  ipcMain.handle(IpcChannel.searchPage, (event, payload): Promise<SearchPageResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const query = asCappedString(body.query, "query", SEARCH_QUERY_MAX_BYTES);
    return runSearchPage(profileId, query);
  });

  /**
   * Rebuilds the ENTIRE file's search index (`rebuildSearchIndex`), not just
   * this profile's slice of it — deliberately whole-file, since the index is
   * derived data and a repair cannot be half-done. `profileId` is validated
   * only to prove the caller is in a real, unlocked session; it plays no part
   * in what gets rebuilt.
   */
  ipcMain.handle(IpcChannel.searchRebuild, (event, payload): number => {
    assertTrustedSender(event);
    asId(asRecord(payload).profileId, "profileId");
    return rebuildSearchIndex(requireDb().raw);
  });

  /**
   * The search HISTORY (SRCH-009 / migration 050): the profile's remembered
   * queries, which are a different list from `search:recent`'s entities and
   * never replace them.
   *
   * All four channels are ordinary profile-scoped store calls — no ranking, no
   * index, no module gate: a query is text the user typed, not a row that
   * belongs to a module, so a disabled module cannot make one of them
   * unshowable. `now` comes from MAIN's clock, like every other timestamp on
   * this wire — the renderer never gets to say when something happened
   * (SEC-EL).
   *
   * The three mutations answer with the resulting list rather than `void`, so
   * a surface that just changed the history repaints from what main actually
   * holds instead of from its own guess at it — `dash:*`'s arrangement. Clear
   * is the exception: it can only ever leave an empty list, so the useful
   * answer is how many entries went.
   */
  ipcMain.handle(IpcChannel.searchHistory, (event, payload): SearchHistoryEntry[] => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return searchHistoryStore(profileId).list();
  });

  ipcMain.handle(IpcChannel.searchHistoryRecord, (event, payload): SearchHistoryEntry[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const query = asCappedString(body.query, "query", SEARCH_QUERY_MAX_BYTES);
    const store = searchHistoryStore(profileId);
    // The store re-validates the semantics this boundary cannot (SEC-EL-02):
    // an empty or whitespace-only query is REFUSED there rather than quietly
    // dropped here, because a renderer that sends one is a renderer that lost
    // track of what its user did — and a silent no-op would hide that.
    store.record(query, new Date().toISOString());
    return store.list();
  });

  ipcMain.handle(IpcChannel.searchHistoryRemove, (event, payload): SearchHistoryEntry[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const query = asCappedString(body.query, "query", SEARCH_QUERY_MAX_BYTES);
    const store = searchHistoryStore(profileId);
    store.remove(query);
    return store.list();
  });

  ipcMain.handle(IpcChannel.searchHistoryClear, (event, payload): number => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return searchHistoryStore(profileId).clear();
  });

  // IMEX slice a1 (PRD 14 IMEX-001, extended by ADR-022): gathers this
  // profile's data and streams it to a path the native save dialog returns —
  // never a path the renderer supplies (SEC-EL) — either as a plain
  // `.nexus.zip` or, when `passphrase` is non-null, sealed into an `.nexus`
  // `NXA1` container under a key derived from it. `modules` narrows what the
  // archive carries (IMEX-003); absent, it carries the whole profile.
  ipcMain.handle(IpcChannel.imexExport, (event, payload): Promise<ExportResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const passphrase = asArchivePassphrase(body.passphrase, "passphrase");
    const modules = asArchiveModules(body.modules, "modules");
    const profile = requireProfile(requireDb(), profileId);
    return handleExport(
      {
        ...imexArchiveDeps(),
        getMainWindow: () => mainWindow,
        // ADR-057 §6: the private section rides only into an ENCRYPTED manual
        // export while UNLOCKED — `privCollectForExport` owns the gate and the
        // named skip. The scheduled backup deliberately never calls this: the
        // PRIV card promises private notes stay out of automatic copies.
        collectPrivateNotes: (exportProfileId, encrypted) =>
          privCollectForExport(privDeps(), exportProfileId, encrypted),
      },
      archiveProfileOf(profile),
      passphrase,
      modules,
    );
  });

  // CAL-008: the calendar alone, as an RFC 5545 `.ics` at a path the same kind
  // of native save dialog returns. `profileId` is the whole payload — an ICS is
  // one open text file with nothing to seal, so there is no passphrase to
  // validate and no plaintext confirmation to honour.
  ipcMain.handle(IpcChannel.imexExportIcs, (event, payload): Promise<IcsExportResult> => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    const profile = requireProfile(requireDb(), profileId);
    return handleIcsExport({ eventStore, getMainWindow: () => mainWindow }, profile);
  });

  // IMEX restore (ADR-023, slice 3c). Each of these is a thin validation shim
  // over `main/restore.ts`, which owns the whole sequence — pick, dry-run
  // preview, apply, undo — and holds the only state involved. The renderer
  // never supplies a filesystem path: `imex:restore-pick` is the sole source of
  // one, and every later call refers to that pick without naming it (SEC-EL).
  ipcMain.handle(IpcChannel.imexRestorePick, (event): Promise<RestorePickResult> => {
    assertTrustedSender(event);
    return pickRestoreFile(restoreDeps());
  });

  ipcMain.handle(IpcChannel.imexRestorePreview, (event, payload): Promise<RestorePreviewResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const passphrase = asRestorePassphrase(body.passphrase, "passphrase");
    return previewRestore(restoreDeps(), profileId, passphrase);
  });

  ipcMain.handle(
    IpcChannel.imexRestoreApply,
    async (event, payload): Promise<RestoreApplyResult> => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const token = asRestoreToken(body.token, "token");
      const result = await applyRestore(restoreDeps(), profileId, token);
      // An archive carries an attachment's BYTES but not the text derived from
      // them (SRCH-008: derived data that can go stale is not worth the weight),
      // so restored rows land with nothing extracted. Covered here rather than
      // left for the next relaunch — bounded and unawaited, so the restore's own
      // reply is not held up by it.
      scheduleAttachmentTextBackfill();
      return result;
    },
  );

  ipcMain.handle(IpcChannel.imexRestoreUndo, async (event, payload): Promise<RestoreUndoResult> => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    const result = await undoRestore(restoreDeps(), profileId);
    // The undo just put a different set of sealed rows back, wholesale and
    // without passing through `privWrite` — so whatever the open section's
    // search index says about them is no longer true (the apply's own half of
    // this is inside `privResealForRestore`).
    privMarkIndexStale();
    // The public half of the same fact: the snapshot the undo replayed carries
    // the attachment INDEX rows, not the text extracted from their bytes, so
    // the rows it put back have nothing extracted again (SRCH-008).
    scheduleAttachmentTextBackfill();
    return result;
  });

  ipcMain.handle(IpcChannel.imexRestoreStatus, (event, payload): RestoreStatus => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    return restoreStatus(profileId);
  });

  ipcMain.handle(IpcChannel.imexRestoreCancel, (event): Promise<void> => {
    assertTrustedSender(event);
    return cancelRestore();
  });

  // Foreign import (ADR-043): the additive counterpart of the four handlers
  // above, on its OWN channels and its own pick — a preview taken here can only
  // be applied here, and nothing on either surface reaches the other's archive.
  // There is no import-specific undo or status: both operations share one undo
  // slot and one banner, which `imex:restore-undo`/`imex:restore-status` serve.
  ipcMain.handle(IpcChannel.imexImportPick, (event): Promise<ImportPickResult> => {
    assertTrustedSender(event);
    return pickImportFile(restoreDeps());
  });

  ipcMain.handle(IpcChannel.imexImportPreview, (event, payload): Promise<ImportPreviewResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const passphrase = asRestorePassphrase(body.passphrase, "passphrase");
    return previewImport(restoreDeps(), profileId, passphrase);
  });

  // ADR-051: the same plan, re-computed under different duplicate choices. The
  // renderer names the plan it is looking at by token and nothing else — no
  // path, no passphrase, no archive — so a re-plan can only ever touch the
  // archive main already has open for this profile.
  ipcMain.handle(IpcChannel.imexImportReplan, (event, payload): ImportPreviewResult => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const token = asRestoreToken(body.token, "token");
    const choices = asImportDuplicateChoices(body.choices, "choices");
    return replanImport(restoreDeps(), profileId, token, choices);
  });

  ipcMain.handle(
    IpcChannel.imexImportApply,
    async (event, payload): Promise<ImportApplyResult> => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const token = asRestoreToken(body.token, "token");
      const result = await applyImport(restoreDeps(), profileId, token);
      // Same reason as `imex:restore-apply`: imported attachment rows arrive
      // with nothing extracted, and this covers them without a relaunch.
      scheduleAttachmentTextBackfill();
      return result;
    },
  );

  ipcMain.handle(IpcChannel.imexImportCancel, (event): Promise<void> => {
    assertTrustedSender(event);
    return cancelImport();
  });

  // The Anki `.apkg` import (ADR-052 / STUDY-011): its own pick, its own
  // preview and its own apply, on the same four-step shape and sharing the same
  // one undo slot. The renderer never supplies a filesystem path here either —
  // `imex:import-apkg-pick` is the sole source of one (SEC-EL).
  ipcMain.handle(IpcChannel.imexImportApkgPick, (event): Promise<ApkgImportPickResult> => {
    assertTrustedSender(event);
    return pickApkgFile(restoreDeps());
  });

  // The SUBJECT rides here rather than on the apply, because the plan depends on
  // it: whether a subject row is created at all is what this choice decides.
  // Structurally validated below, semantically in `restore.ts` against the
  // profile's own live subjects.
  ipcMain.handle(
    IpcChannel.imexImportApkgPreview,
    (event, payload): Promise<ApkgImportPreviewResult> => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const subject = asApkgSubjectChoice(body.subject, "subject");
      return previewApkgImport(restoreDeps(), profileId, subject);
    },
  );

  ipcMain.handle(IpcChannel.imexImportApkgApply, (event, payload): Promise<ApkgImportApplyResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const token = asRestoreToken(body.token, "token");
    return applyApkgImport(restoreDeps(), profileId, token);
  });

  ipcMain.handle(IpcChannel.imexImportApkgCancel, (event): void => {
    assertTrustedSender(event);
    cancelApkgImport();
  });

  // The CSV task import (ADR-062): its own pick, preview, MAP and apply, on
  // the `.apkg` session shape plus the one step a schemaless format needs —
  // the confirmed mapping. The renderer never supplies a filesystem path
  // (`imex:import-csv-pick` is the sole source of one, SEC-EL) and never sends
  // cell data back: the parsed rows stay in main's pending session, and
  // `imex:import-csv-map` carries role assignments and choices only.
  ipcMain.handle(IpcChannel.imexImportCsvPick, (event): Promise<CsvImportPickResult> => {
    assertTrustedSender(event);
    return pickCsvFile(restoreDeps());
  });

  // The delimiter/header overrides ride here: null lets the sniff decide, a
  // value re-parses the text main already read under that choice. `profileId`
  // is validated only to keep the request shape uniform with its siblings —
  // the columns step reads nothing of the profile.
  ipcMain.handle(
    IpcChannel.imexImportCsvPreview,
    (event, payload): Promise<CsvImportPreviewResult> => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      asId(body.profileId, "profileId");
      const delimiter = asCsvImportDelimiter(body.delimiter, "delimiter");
      const hasHeader = asCsvImportHeaderFlag(body.hasHeader, "hasHeader");
      return previewCsvImport(restoreDeps(), delimiter, hasHeader);
    },
  );

  // Structurally validated below (closed roles, one title, exactly-one list
  // arm), semantically in `restore.ts` — the session's column count and the
  // profile's live lists are facts only that side knows.
  ipcMain.handle(IpcChannel.imexImportCsvMap, (event, payload): CsvImportMapResult => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const roles = asCsvImportRoles(body.roles, "roles");
    const list = asCsvImportListChoice(body.list, "list");
    return mapCsvImport(restoreDeps(), profileId, roles, list);
  });

  ipcMain.handle(IpcChannel.imexImportCsvApply, (event, payload): Promise<CsvImportApplyResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const token = asRestoreToken(body.token, "token");
    return applyCsvImport(restoreDeps(), profileId, token);
  });

  ipcMain.handle(IpcChannel.imexImportCsvCancel, (event): void => {
    assertTrustedSender(event);
    cancelCsvImport();
  });

  // The bank-statement import (FIN slice e): the same five steps over the same
  // session discipline, writing the FIN ledger instead of the task tables. Main
  // owns the picker and reads the bytes — a path never crosses from the renderer
  // (SEC-EL) — and the renderer never sends cell data back either: what
  // `imex:import-fin-csv-map` carries is role assignments, an account id and a
  // sign convention.
  ipcMain.handle(IpcChannel.imexImportFinCsvPick, (event): Promise<CsvImportPickResult> => {
    assertTrustedSender(event);
    return pickFinCsvFile(restoreDeps());
  });

  ipcMain.handle(
    IpcChannel.imexImportFinCsvPreview,
    (event, payload): Promise<FinCsvImportPreviewResult> => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      asId(body.profileId, "profileId");
      const delimiter = asCsvImportDelimiter(body.delimiter, "delimiter");
      const hasHeader = asCsvImportHeaderFlag(body.hasHeader, "hasHeader");
      return previewFinCsvImport(restoreDeps(), delimiter, hasHeader);
    },
  );

  // Structurally validated below (closed roles, no repeat, a closed sign
  // convention), semantically in `restore.ts` and in `@nexus/core`: the
  // session's column count, the profile's live accounts and the date/amount
  // conventions the file itself admits are facts only those sides know.
  ipcMain.handle(IpcChannel.imexImportFinCsvMap, (event, payload): FinCsvImportMapResult => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const roles = asFinCsvImportRoles(body.roles, "roles");
    const accountId = asId(body.accountId, "accountId");
    const signConvention = asFinCsvImportSignConvention(body.signConvention, "signConvention");
    return mapFinCsvImport(restoreDeps(), profileId, roles, accountId, signConvention);
  });

  ipcMain.handle(
    IpcChannel.imexImportFinCsvApply,
    (event, payload): Promise<FinCsvImportApplyResult> => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const token = asRestoreToken(body.token, "token");
      return applyFinCsvImport(restoreDeps(), profileId, token);
    },
  );

  ipcMain.handle(IpcChannel.imexImportFinCsvCancel, (event): void => {
    assertTrustedSender(event);
    cancelFinCsvImport();
  });

  // The calendar `.ics` import (ADR-061): its own pick, its own preview and its
  // own apply, on the same four-step shape and sharing the same one undo slot.
  // The renderer never supplies a filesystem path here either —
  // `imex:import-ics-pick` is the sole source of one (SEC-EL).
  ipcMain.handle(IpcChannel.imexImportIcsPick, (event): Promise<IcsImportPickResult> => {
    assertTrustedSender(event);
    return pickIcsFile(restoreDeps());
  });

  // The DUPLICATE answer rides here rather than on a replan channel, because it
  // is the one answer this flow carries (ADR-051's event group) — re-previewing
  // under the other answer re-plans the events main already parsed, exactly as
  // a changed `.apkg` subject re-plans the collection main already read.
  ipcMain.handle(
    IpcChannel.imexImportIcsPreview,
    (event, payload): Promise<IcsImportPreviewResult> => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const importDuplicates = asBoolean(body.importDuplicates, "importDuplicates");
      return previewIcsImport(restoreDeps(), profileId, importDuplicates);
    },
  );

  ipcMain.handle(IpcChannel.imexImportIcsApply, (event, payload): Promise<IcsImportApplyResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const token = asRestoreToken(body.token, "token");
    return applyIcsImport(restoreDeps(), profileId, token);
  });

  ipcMain.handle(IpcChannel.imexImportIcsCancel, (event): void => {
    assertTrustedSender(event);
    cancelIcsImport();
  });

  // The LLM-assisted import (IMEX-005): no pick, because there is no file — the
  // source is text the user pasted out of their own chat, and it rides on the
  // preview request. The DECK rides here too, for the reason the `.apkg`
  // subject does: the plan depends on it, and re-previewing under a different
  // one re-parses the same paste rather than asking for it again.
  ipcMain.handle(IpcChannel.imexImportLlmPreview, (event, payload): LlmImportPreviewResult => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const kind = asLlmImportKind(body.kind, "kind");
    const text = asLlmAnswerText(body.text, "text");
    // Structurally validated here, semantically in `restore.ts` against the
    // profile's own live decks and subjects — the same division
    // `asApkgSubjectChoice` follows.
    const deck = asLlmDeckChoice(body.deck, "deck");
    return previewLlmImport(restoreDeps(), profileId, kind, text, deck);
  });

  // ADR-051 for the LLM flow: the same records, re-planned under a changed
  // duplicate answer. The renderer names the plan it is looking at by token and
  // nothing else — no text, no deck — so a re-plan can only ever touch the
  // answer main already parsed for this profile.
  ipcMain.handle(IpcChannel.imexImportLlmReplan, (event, payload): LlmImportPreviewResult => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const token = asRestoreToken(body.token, "token");
    const importDuplicates = asBoolean(body.importDuplicates, "importDuplicates");
    return replanLlmImport(restoreDeps(), profileId, token, importDuplicates);
  });

  ipcMain.handle(IpcChannel.imexImportLlmApply, (event, payload): Promise<LlmImportApplyResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const token = asRestoreToken(body.token, "token");
    return applyLlmImport(restoreDeps(), profileId, token);
  });

  ipcMain.handle(IpcChannel.imexImportLlmCancel, (event): void => {
    assertTrustedSender(event);
    cancelLlmImport();
  });

  // IMEX-007's markdown slice: plain `.md` files into real notes. One call does
  // the whole thing — pick, read, parse, write — because there is nothing to
  // preview and nothing to undo (an import that only ADDS notes is undone by
  // deleting them). The renderer names a target folder and which dialog to
  // open, and main validates both before a single file is touched.
  ipcMain.handle(IpcChannel.imexImportMarkdown, (event, payload): Promise<MarkdownImportResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const folderId = asNullableId(body.folderId, "folderId");
    const source = asMarkdownImportSource(body.source, "source");
    return handleMarkdownImport(
      {
        noteStore,
        noteOrgStore,
        getMainWindow: () => mainWindow,
        runInTransaction: (write) => requireDb().raw.transaction(write)(),
      },
      profileId,
      folderId,
      source,
    );
  });

  // Scheduled backups (SET-011 / ADR-056). Five thin validation shims over
  // `main/backup.ts` and `BackupSettingsStore`; every answer is the same
  // `backupSettingsView`, which strips the passphrase wrap to a boolean — the
  // renderer NEVER sees the passphrase back, in any form.
  ipcMain.handle(IpcChannel.backupGetSettings, (event, payload): BackupSettingsView => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    requireProfile(requireDb(), profileId);
    return backupSettingsView(profileId);
  });

  ipcMain.handle(IpcChannel.backupSetSettings, (event, payload): BackupSettingsView => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const enabled = asBoolean(body.enabled, "enabled");
    const cadence = asBackupCadence(body.cadence, "cadence");
    const keepLast = asBackupKeepLast(body.keepLast, "keepLast");
    requireProfile(requireDb(), profileId);
    // The store re-validates the semantics (SEC-EL-02), including the one rule
    // the structural checks above cannot see: enabling requires a folder and a
    // wrapped passphrase to already exist.
    backupSettingsStore(profileId).setSchedule(
      { enabled, cadence, keepLast },
      new Date().toISOString(),
    );
    return backupSettingsView(profileId);
  });

  // The native directory picker, in main — the sole source of a folder path on
  // this surface (SEC-EL; the markdown import's folder pick is the precedent).
  ipcMain.handle(
    IpcChannel.backupPickFolder,
    async (event, payload): Promise<BackupSettingsView> => {
      assertTrustedSender(event);
      const profileId = asId(asRecord(payload).profileId, "profileId");
      requireProfile(requireDb(), profileId);
      const options: OpenDialogOptions = { properties: ["openDirectory"] };
      const { canceled, filePaths } = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      const folder = canceled ? null : (filePaths[0] ?? null);
      if (folder !== null) {
        backupSettingsStore(profileId).setFolderPath(folder, new Date().toISOString());
      }
      return backupSettingsView(profileId);
    },
  );

  // Write-only: the passphrase arrives, is wrapped under the session's data
  // key (`@nexus/core/auth`, ADR-056), and only the wrap is stored. Changing
  // it re-wraps for FUTURE runs — archives already on disk keep opening under
  // whatever sealed them, which the card's copy says out loud.
  ipcMain.handle(
    IpcChannel.backupSetPassphrase,
    async (event, payload): Promise<BackupSettingsView> => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asId(body.profileId, "profileId");
      const passphrase = asBackupPassphrase(body.passphrase, "passphrase");
      requireProfile(requireDb(), profileId);
      const wrapped = await wrapBackupPassphrase(requireUnlockedDataKeyHex(), passphrase);
      backupSettingsStore(profileId).setPassphraseWrapped(wrapped, new Date().toISOString());
      return backupSettingsView(profileId);
    },
  );

  // The manual trigger, through the scheduled path's own in-flight guard; the
  // view it answers carries the run's recorded outcome, which is the report.
  ipcMain.handle(IpcChannel.backupRunNow, async (event, payload): Promise<BackupSettingsView> => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    requireProfile(requireDb(), profileId);
    await runBackupNow(backupRunnerDeps(), profileId);
    return backupSettingsView(profileId);
  });

  // Private notes (PRIV v1 / ADR-057). Ten thin validation shims over
  // `main/priv.ts`, which holds the one secret this surface turns on — the
  // unwrapped PRIV DEK — and never lets anything key-shaped cross the bridge.
  // Decrypted envelopes flow to the renderer ONLY while the section is
  // unlocked; every data handler's `privDeps()` resolves against the live
  // session, and `requireProfile` proves the caller names a real profile
  // before anything else runs.
  ipcMain.handle(IpcChannel.privStatus, (event, payload): PrivStatus => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    requireProfile(requireDb(), profileId);
    return privStatus(privDeps(), profileId);
  });

  ipcMain.handle(IpcChannel.privSetup, (event, payload): Promise<PrivSetupResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const credential = asPasscode(body.credential, "credential");
    const usesAccountPasscode = asBoolean(body.usesAccountPasscode, "usesAccountPasscode");
    const regenerateKit = asBoolean(body.regenerateKit, "regenerateKit");
    requireProfile(requireDb(), profileId);
    return privSetup(privDeps(), profileId, { credential, usesAccountPasscode, regenerateKit });
  });

  ipcMain.handle(IpcChannel.privUnlock, async (event, payload): Promise<PrivUnlockResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const credential = asPasscode(body.credential, "credential");
    requireProfile(requireDb(), profileId);
    const result = await privUnlock(privDeps(), profileId, credential);
    // The boot-time orphan-blob sweep (ADR-057): an unlock is the FIRST moment
    // this process holds the key the referenced-id set is sealed behind, so it
    // is where the crash case gets cleaned up — a restore whose undo slot died
    // with the last session leaves files nothing names. Never awaited: an
    // unlock must not wait on housekeeping, and the sweep refuses on its own
    // while an undo could still bring rows back.
    if (result.ok) {
      void privSweepOrphanBlobs(privDeps(), profileId).catch((error: unknown) => {
        console.error("Private orphan-blob sweep failed after unlock:", error);
      });
    }
    return result;
  });

  // The panic path: payload-free, allowed in ANY state — locking must never be
  // refused, so there is deliberately no requireDb() here (privLock touches
  // only main's own memory). What it DOES do first, when there is a database to
  // write into, is seal whatever close capture the section owes: the key it
  // needs is the one this call is about to zero (`privCaptureAndLock` locks in
  // a `finally`, so a failing capture cannot leave the section open).
  ipcMain.handle(IpcChannel.privLock, async (event): Promise<void> => {
    assertTrustedSender(event);
    if (db === null) {
      privLock();
      return;
    }
    await privCaptureAndLock(privDeps());
  });

  ipcMain.handle(IpcChannel.privList, (event, payload): Promise<PrivNoteListEntry[]> => {
    assertTrustedSender(event);
    const profileId = asId(asRecord(payload).profileId, "profileId");
    requireProfile(requireDb(), profileId);
    return privList(privDeps(), profileId);
  });

  ipcMain.handle(IpcChannel.privRead, (event, payload): Promise<PrivNoteEnvelopePayload> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    requireProfile(requireDb(), profileId);
    return privRead(privDeps(), profileId, id);
  });

  ipcMain.handle(IpcChannel.privWrite, (event, payload): Promise<{ id: string }> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asNullableId(body.id, "id");
    const envelope = asPrivEnvelope(body.envelope, "envelope");
    requireProfile(requireDb(), profileId);
    return privWrite(privDeps(), profileId, id, envelope);
  });

  ipcMain.handle(IpcChannel.privDelete, (event, payload): Promise<void> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    requireProfile(requireDb(), profileId);
    return privDelete(privDeps(), profileId, id);
  });

  ipcMain.handle(
    IpcChannel.privAttachmentPick,
    (event, payload): Promise<PrivAttachmentPickResult> => {
      assertTrustedSender(event);
      const profileId = asId(asRecord(payload).profileId, "profileId");
      requireProfile(requireDb(), profileId);
      return handlePrivAttachmentPick(profileId);
    },
  );

  ipcMain.handle(IpcChannel.privMoveIn, (event, payload): Promise<PrivMoveInResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const noteId = asId(body.noteId, "noteId");
    requireProfile(requireDb(), profileId);
    return moveNoteToPrivate(privMoveDeps(), profileId, noteId);
  });

  ipcMain.handle(IpcChannel.privMoveOut, (event, payload): Promise<PrivMoveOutResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    requireProfile(requireDb(), profileId);
    return movePrivateNoteOut(privMoveDeps(), profileId, id);
  });

  ipcMain.handle(IpcChannel.privSearch, (event, payload): Promise<string[]> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const query = asCappedString(body.query, "query", SEARCH_QUERY_MAX_BYTES);
    requireProfile(requireDb(), profileId);
    return privSearch(privDeps(), profileId, query);
  });

  // The sealed version history. `priv:versions` answers cleartext FACTS (seq +
  // capture time), `priv:version-read` answers ONE unsealed envelope for
  // display, and `priv:version-capture` is the explicit close capture — all
  // three refused while the section is locked, by `priv.ts`'s own gate.
  ipcMain.handle(IpcChannel.privVersions, (event, payload): PrivNoteVersionMeta[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    requireProfile(requireDb(), profileId);
    return privListVersions(privDeps(), profileId, id);
  });

  ipcMain.handle(IpcChannel.privVersionRead, (event, payload): Promise<PrivNoteEnvelopePayload> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    const seq = asPositiveInteger(body.seq, "seq");
    requireProfile(requireDb(), profileId);
    return privReadVersion(privDeps(), profileId, id, seq);
  });

  ipcMain.handle(IpcChannel.privVersionCapture, async (event, payload): Promise<void> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const id = asId(body.id, "id");
    requireProfile(requireDb(), profileId);
    await privCaptureVersion(privDeps(), profileId, id);
  });

  ipcMain.handle(IpcChannel.privSetLockPrefs, (event, payload): PrivStatus => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const autoLockMinutes = asPrivAutoLockMinutes(body.autoLockMinutes, "autoLockMinutes");
    const lockOnMinimize = asBoolean(body.lockOnMinimize, "lockOnMinimize");
    requireProfile(requireDb(), profileId);
    return privSetLockPrefs(privDeps(), profileId, { autoLockMinutes, lockOnMinimize });
  });

  // --- In-app file preview (DOC / ADR-064) ---------------------------------
  //
  // One pair of channels across the three public attachment surfaces. Both
  // resolve the row through the module's own store (`requireDocAttachment`),
  // so the profile/record gates of `*-attachments:open` hold here verbatim,
  // and both refuse by the STORED mime — what the renderer read off a row is
  // an offer, never an instruction.

  ipcMain.handle(IpcChannel.docPreview, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const module = asDocAttachmentModule(body.module, "module");
    const id = asId(body.id, "id");
    const attachmentId = asId(body.attachmentId, "attachmentId");

    const attachment = requireDocAttachment(module, profileId, id, attachmentId);
    // The dedicated window exists for exactly one mime: the one Chromium
    // renders with its own viewer. Every other previewable kind is the
    // renderer's dialog (images by `nx-blob:` URL, text over `doc:read-text`),
    // and everything else keeps „Otvori" — refused here BY NAME so a
    // repurposed call can never turn the plugins-enabled window into a
    // generic browser over the blob store.
    if (attachment.mime !== "application/pdf") {
      throw new Error(`Attachment "${attachmentId}" is not a PDF.`);
    }
    openDocPreviewWindow(attachment);
  });

  ipcMain.handle(IpcChannel.docReadText, async (event, payload): Promise<DocTextContent> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const module = asDocAttachmentModule(body.module, "module");
    const id = asId(body.id, "id");
    const attachmentId = asId(body.attachmentId, "attachmentId");

    const attachment = requireDocAttachment(module, profileId, id, attachmentId);
    // Refused by the stored mime, with the one recorded widening: an
    // octet-stream row whose NAME says `.txt`/`.md` predates the text sniff
    // and may be read — the display-only extension reading ADR-064 allows for
    // OFFERING a preview. The stored mime itself stays untouched.
    if (!isTextPreviewAttachment(attachment.mime, attachment.fileName)) {
      throw new Error(`Attachment "${attachmentId}" is not previewable as text.`);
    }
    // The row's size first (no read at all for an oversize file), the bytes
    // actually read second — the cap is the wire contract, and an index row,
    // however validated at add time, is not the bytes.
    if (attachment.sizeBytes > DOC_TEXT_PREVIEW_MAX_BYTES) {
      throw new Error(`Attachment "${attachmentId}" exceeds the text-preview cap.`);
    }
    const bytes = await readBlob(blobStorePathsFor(), requireBlobKeys(), attachment.sha256);
    if (bytes === null) {
      throw new Error(`Attachment "${attachment.fileName}" was not found in the blob store.`);
    }
    if (bytes.byteLength > DOC_TEXT_PREVIEW_MAX_BYTES) {
      throw new Error(`Attachment "${attachmentId}" exceeds the text-preview cap.`);
    }
    return { name: attachment.fileName, text: decodePreviewText(bytes) };
  });

  // „Datoteke"'s one read (DOC). Every value the renderer sends is a FILTER —
  // there is no id here at all — so the whole of the gate is the profile and
  // the closed vocabularies each field is checked against; the store then
  // scopes every branch of its union through the owning record's own
  // `profile_id`, exactly as the per-module stores do.
  ipcMain.handle(IpcChannel.docListAttachments, (event, payload): DocAttachmentList => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asId(body.profileId, "profileId");
    const filter: AttachmentIndexFilter = asDocAttachmentFilter(body.filter);
    return attachmentIndexStore(profileId).list(filter);
  });

  // ADR-040 / TASK-002. The renderer owns the chord (it lives in this device's
  // `localStorage`) and main owns the registration, so this is the one channel
  // where the renderer asks for something OUTSIDE the app's own window. It is
  // handled the same way as every other: sender checked, payload revalidated,
  // and — because a system call is on the other end — the accelerator derived
  // here from the validated fields rather than accepted as a string.
  ipcMain.handle(IpcChannel.shortcutsSetGlobal, (event, payload): GlobalShortcutResult => {
    assertTrustedSender(event);
    const chord = asGlobalShortcutChord(asRecord(payload).chord, "chord");
    // The smoke run never claims an OS-wide combination: it would take a hotkey
    // off the developer's session for the length of the run, and on a headless
    // box there is no window manager to claim it from. Answered `ok` so the
    // renderer under smoke renders its normal state — the same "not during the
    // smoke run" rule the notification scheduler already follows.
    if (isAutomatedRun) return { ok: true };
    const accelerator = chordAccelerator(chord);
    if (accelerator === null) return { ok: false };
    return { ok: setGlobalCaptureAccelerator(accelerator, fireGlobalCapture) };
  });

  // --- The drawn window frame ------------------------------------------------
  //
  // Every one of these acts on the window that SENT it, never on a window named
  // in a payload — there is no payload. `assertTrustedSender` already refuses a
  // sender that is not one of ours; resolving the target from that same sender
  // is what makes „which window“ unforgeable rather than merely validated.
  ipcMain.handle(IpcChannel.windowMinimize, (event): void => {
    assertTrustedSender(event);
    senderWindow(event)?.minimize();
  });

  ipcMain.handle(IpcChannel.windowToggleMaximize, (event): WindowState => {
    assertTrustedSender(event);
    const win = senderWindow(event);
    if (win === null) return BLANK_WINDOW_STATE;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return windowStateOf(win);
  });

  ipcMain.handle(IpcChannel.windowClose, (event): void => {
    assertTrustedSender(event);
    // `close()`, never `destroy()`: the window's own `close` handler is what
    // seals the private section's pending captures on the way out (ADR-057).
    // A drawn close button that skipped it would lose data an OS one kept.
    senderWindow(event)?.close();
  });

  ipcMain.handle(IpcChannel.windowState, (event): WindowState => {
    assertTrustedSender(event);
    const win = senderWindow(event);
    return win === null ? BLANK_WINDOW_STATE : windowStateOf(win);
  });

  // „Prikaz" in the app menu. The renderer names an INTENT and main owns the
  // arithmetic — see `WINDOW_VIEW_COMMANDS` on why a target level never crosses.
  ipcMain.handle(IpcChannel.windowView, (event, payload): void => {
    assertTrustedSender(event);
    const command = asWindowViewCommand(asRecord(payload).command, "command");
    const win = senderWindow(event);
    if (win === null) return;
    switch (command) {
      case "zoom-in":
        setZoomLevel(win, win.webContents.getZoomLevel() + ZOOM_STEP);
        break;
      case "zoom-out":
        setZoomLevel(win, win.webContents.getZoomLevel() - ZOOM_STEP);
        break;
      case "zoom-reset":
        setZoomLevel(win, 0);
        break;
      case "fullscreen-toggle":
        win.setFullScreen(!win.isFullScreen());
        // No push here: `enter-full-screen`/`leave-full-screen` are already
        // wired in `pushWindowState`, and pushing again would send the state
        // twice for one action.
        break;
    }
  });

  // Sync (the cloud half). Validation shims over `main/sync/service.ts`, which
  // holds the ports, the session and the whole protocol. Deliberately no count
  // in this sentence: it said „four" through two channels being added, which is
  // the one thing a comment must never do — be confidently wrong about the code
  // directly beneath it.
  //
  // `sync:status` answers while LOCKED, deliberately: the settings screen has to
  // be able to say „cloud is off" before anyone signs in, and the account read it
  // needs fails closed to `null` inside the service. The other three do not — the
  // service refuses `locked` for the enable, and `disconnect` needs the account
  // row it is about to delete.
  ipcMain.handle(IpcChannel.syncStatus, (event): SyncStatusView => {
    assertTrustedSender(event);
    return syncService().status();
  });

  ipcMain.handle(IpcChannel.syncSetCloud, (event, payload): SyncStatusView => {
    assertTrustedSender(event);
    const enabled = asBoolean(asRecord(payload).enabled, "enabled");
    return syncService().setCloudEnabled(enabled);
  });

  // Every field is validated for SHAPE here and for meaning by the layers below:
  // the address by the KDF's normaliser, the device name by `device-name.ts`'s
  // one rule, and the whole payload again by the Edge Function and by eleven
  // CHECK constraints. The password crosses this bridge and stops here — it is
  // put through Argon2id in main and never reaches a socket.
  ipcMain.handle(IpcChannel.syncEnable, async (event, payload): Promise<SyncEnableView> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const email = asNonEmptyString(body.email, "email");
    const password = asNonEmptyString(body.password, "password");
    const totpCode = asNonEmptyString(body.totpCode, "totpCode");
    const deviceName = asNonEmptyString(body.deviceName, "deviceName");
    const factorId = body.factorId === undefined ? undefined : asId(body.factorId, "factorId");
    return syncService().enable({
      email,
      password,
      totpCode,
      deviceName,
      ...(factorId === undefined ? {} : { factorId }),
    });
  });

  // Adopting takes everything enabling does plus the Sync Recovery Code, and
  // the code is validated for SHAPE only here — `deriveSyncRecoveryKey` owns the
  // rule about what a code IS, and a second copy of it at the bridge would be a
  // rule that can drift from the one the derivation actually applies. Like the
  // password, it stops in main: Argon2id runs here and neither reaches a socket.
  ipcMain.handle(IpcChannel.syncAdopt, async (event, payload): Promise<SyncAdoptView> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const email = asNonEmptyString(body.email, "email");
    const password = asNonEmptyString(body.password, "password");
    const totpCode = asNonEmptyString(body.totpCode, "totpCode");
    const recoveryCode = asNonEmptyString(body.recoveryCode, "recoveryCode");
    const deviceName = asNonEmptyString(body.deviceName, "deviceName");
    const factorId = body.factorId === undefined ? undefined : asId(body.factorId, "factorId");
    return syncService().adopt({
      email,
      password,
      totpCode,
      recoveryCode,
      deviceName,
      ...(factorId === undefined ? {} : { factorId }),
    });
  });

  // The cheap way back and the expensive one. `sync:resume` takes nothing and
  // answers the status: a refresh that fails is the ordinary end of a session's
  // life, not an error, and what it means for the screen is already in
  // `signedIn: false`. `sync:reconnect` takes a password that stops here — it is
  // put through Argon2id in main and never reaches a socket — and buys a new
  // device row with a proof derived from the master key this machine holds.
  ipcMain.handle(IpcChannel.syncResume, async (event): Promise<SyncStatusView> => {
    assertTrustedSender(event);
    return syncService().resume();
  });

  ipcMain.handle(IpcChannel.syncReconnect, async (event, payload): Promise<SyncReconnectView> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    return syncService().reconnect({
      password: asNonEmptyString(body.password, "password"),
      deviceName: asNonEmptyString(body.deviceName, "deviceName"),
    });
  });

  ipcMain.handle(IpcChannel.syncDisconnect, async (event): Promise<SyncStatusView> => {
    assertTrustedSender(event);
    return syncService().disconnect();
  });

  ipcMain.handle(IpcChannel.syncActivity, (event): SyncActivityView => {
    assertTrustedSender(event);
    return syncService().activity();
  });

  // No payload: the round is about the profile the loop is already bound to, and
  // that is main's own fact. A `profileId` here would be a way for a renderer to
  // aim a round at a profile whose data it is not currently showing.
  ipcMain.handle(IpcChannel.syncNow, (event): SyncActivityView => {
    assertTrustedSender(event);
    return syncService().syncNow();
  });

  ipcMain.handle(IpcChannel.appInfo, (event): AppInfo => {
    assertTrustedSender(event);
    return appInfo();
  });
}

/**
 * The global hotkey firing (TASK-002). Two things happen, in this order and for
 * different reasons.
 *
 * First the window comes up — restored if minimized, shown if hidden, focused
 * either way. That half runs whatever the session state is: the point of the
 * chord is "bring Nexus here", and it must not become a no-op just because the
 * app is locked.
 *
 * Then, and ONLY while unlocked, the capture intent is pushed to the renderer.
 * A locked session deliberately gets nothing further: quick-add writes to the
 * database, the database is closed while locked, and the lock screen is where
 * the user has to act anyway — so the window arriving on the passcode prompt is
 * the whole of the correct behaviour, with nothing to announce.
 */
function fireGlobalCapture(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); // also raises and focuses a window that was merely hidden
  win.focus();
  if (computeAuthStatus().state !== "unlocked") return;
  win.webContents.send(IpcChannel.shortcutsGlobalCapture);
}

// --- Window (hardened) ------------------------------------------------------

/** The window a renderer request came from. Null only if it was torn down mid-flight. */
function senderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

/** What a torn-down window reports. Named rather than repeated, so a field added to `WindowState` cannot be forgotten on one of the two paths. */
const BLANK_WINDOW_STATE: WindowState = {
  maximized: false,
  focused: false,
  fullScreen: false,
  zoomLevel: 0,
};

/**
 * One press of „Uvećaj"/„Umanji", in Chromium zoom LEVELS.
 *
 * The scale is `1.2 ** level`, so half a level is ~9.5 % — small enough that
 * the step reads as a nudge rather than a jump, and it takes four presses to
 * reach the ~1.44× that a full two levels would reach in two. The bounds are
 * where this app's own layout stops working rather than where Chromium stops:
 * below −2 (0.69×) the 11px eyebrow type falls under 8 device pixels, and above
 * +3 (1.73×) the 220px sidebar rail eats a third of a 900px window.
 */
const ZOOM_STEP = 0.5;
const ZOOM_MIN = -2;
const ZOOM_MAX = 3;

/** Clamps, applies, and pushes — zoom fires no `BrowserWindow` event of its own, so the strip has to be told. */
function setZoomLevel(win: BrowserWindow, level: number): void {
  win.webContents.setZoomLevel(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level)));
  if (!win.isDestroyed()) win.webContents.send(IpcChannel.windowStateChanged, windowStateOf(win));
}

function windowStateOf(win: BrowserWindow): WindowState {
  return {
    maximized: win.isMaximized(),
    focused: win.isFocused(),
    fullScreen: win.isFullScreen(),
    zoomLevel: win.webContents.getZoomLevel(),
  };
}

/**
 * Keeps a drawn title strip in step with the window under it.
 *
 * Six events, not two: maximise and unmaximise are the obvious pair, but a
 * window also leaves the maximised state by being restored from minimised or
 * by leaving full screen, and a strip that only listened to the pair would draw
 * the restore glyph on a window that is no longer maximised. Focus is here for
 * the reason `WindowState.focused` exists at all — an OS frame dims itself and
 * a drawn one has to be told to.
 */
function pushWindowState(win: BrowserWindow): void {
  const send = (): void => {
    if (win.isDestroyed()) return;
    win.webContents.send(IpcChannel.windowStateChanged, windowStateOf(win));
  };
  // Listed one by one rather than looped: `BrowserWindow.on` is a set of
  // per-event overloads, so a union of names has no single signature to match.
  win.on("maximize", send);
  win.on("unmaximize", send);
  win.on("restore", send);
  win.on("enter-full-screen", send);
  win.on("leave-full-screen", send);
  win.on("focus", send);
  win.on("blur", send);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 720,
    // Nexus draws its own title strip (`TitleBar.tsx`). The OS frame is not a
    // neutral container: it is a strip of another product's design language
    // across the top of this one, in the one place a person looks first.
    //
    // What is given up is Windows 11's Snap Layouts flyout, which only appears
    // on hover over an OS-drawn maximise button. Drag-to-edge snapping, Win+
    // arrow, and double-click-to-maximise all still work, because they are
    // driven by the drag region (`-webkit-app-region`) rather than the frame.
    frame: false,
    // A floor, so the pinned sidebar foot is structurally guaranteed to fit.
    // These are OUTER dimensions — `useContentSize` is not set. They used to
    // lose ~39 px to the Windows frame, which is how a 720-high window ended up
    // with a 681 px viewport; with `frame: false` the outer and inner heights
    // are the same, and the drawn strip takes its share back out of the
    // document instead. The floor is unchanged on purpose: the strip costs
    // about what the frame did, so the space below it has not moved.
    minWidth: 900,
    minHeight: 600,
    // No `backgroundColor` here on purpose. It would have to be a literal
    // colour, and this app allows none outside `packages/tokens` — the theme is
    // a CSS variable the main process cannot read. The white base it would have
    // covered is already handled where it belongs: `body` now carries
    // `--nx-bg` (`app.css`), and the window is only shown on `ready-to-show`.
    show: false, // shown on ready-to-show to avoid a blank-white first paint
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true, // SEC-EL-01
      nodeIntegration: false, // SEC-EL-01
      sandbox: true, // SEC-EL-01
      // SEC-NET: Chromium's spellchecker defaults to ON and downloads its
      // dictionary from a Google host the first time an editable field is
      // focused. That is a network call the shipped 1.0.0 made, contradicting
      // its own privacy copy, and it is not one anybody chose. Off here and
      // emptied on the session in `whenReady` — two switches, because either
      // one alone leaves the other able to fire.
      spellcheck: false,
      // Chromium suspends `requestAnimationFrame`, and stops compositing
      // altogether, in a window it considers not visible — occluded by another
      // window, minimised, or on a desktop that is not the current one. For the
      // shipped app that is exactly right: it is what stops an idle Nexus
      // spending a laptop's battery on animations nobody can see, so the
      // default stays on for real windows.
      //
      // For the screenshot sweep it is fatal, and it took two dead runs to see
      // that both deaths were this one cause. `settle()` awaits two animation
      // frames, so an occluded window hangs the sweep FOR EVER — 1 215 frames
      // in, with no output and no error. And `capturePage()` on a window with
      // no live compositor answers `VizSentEmptyBitmap`, which is how the run
      // before it died at 2 200. The sweep drives a real window for
      // twenty-five minutes on a machine somebody is using; „nothing will ever
      // cover it" is not an assumption it is entitled to make.
      ...(isShots ? { backgroundThrottling: false } : {}),
      // webSecurity is left at its secure default and never touched (SEC-EL-01).
    },
  });

  win.once("ready-to-show", () => win.show());
  pushWindowState(win);

  // PRIV's minimize hook (ADR-057 §5): a minimized window with an open private
  // section is exactly the walked-away-from screen `lock_on_minimize` exists
  // for. Guarded on the session — while locked there is no section to close
  // and no database for the deps to reach.
  win.on("minimize", () => {
    if (db !== null) privHandleMinimize(privDeps());
  });

  // The private section's close capture on the way out (ADR-057): closing the
  // window leaves the private surface exactly as locking does, and the capture
  // it owes has to be SEALED before the process stops being able to. The close
  // is deferred exactly once, and only when something is actually owed —
  // `closing` makes the second pass unconditional, and the `finally` closes the
  // window whatever the capture did, so this can never strand a window open.
  let closing = false;
  win.on("close", (event) => {
    if (closing || db === null || !privHasPendingCaptures()) return;
    closing = true;
    event.preventDefault();
    void privCaptureAndLock(privDeps())
      .catch((error: unknown) => {
        console.error("Failed to capture closing private-note versions on window close:", error);
      })
      .finally(() => {
        if (!win.isDestroyed()) win.close();
      });
  });

  // SEC-EL-03: deny every attempt to open a new window. The shell has no external
  // links yet; a vetted shell.openExternal wrapper lands with the first one.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // SEC-EL-03: lock navigation to the app's own document; block anything else.
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

/**
 * Every open PDF preview window (ADR-064), tracked for exactly one reason:
 * `performLock` must close them all — an open preview is decrypted attachment
 * bytes on screen, the same residue class as `openExternally`'s temp copies,
 * and it must never outlive the session that could read it.
 */
const docPreviewWindows = new Set<BrowserWindow>();

/** Closes every open preview window. `destroy` rather than `close`: a lock must not wait on (or be argued with by) a renderer. */
function closeDocPreviewWindows(): void {
  for (const win of docPreviewWindows) {
    if (!win.isDestroyed()) win.destroy();
  }
  docPreviewWindows.clear();
}

/**
 * The dedicated PDF preview window (DOC tier 1, ADR-064). A SEPARATE window,
 * never a flag on the shell: `plugins: true` — what turns Chromium's built-in
 * PDFium viewer on — goes here and nowhere else, and the window is otherwise
 * locked down harder than the shell itself: sandboxed, context-isolated, no
 * node integration, and NO preload at all, so a PDFium compromise lands in a
 * renderer with no IPC surface to speak to. It loads the `nx-blob:` URL as its
 * MAIN FRAME document — no iframe — so the shell's CSP is not in play and
 * needs no widening.
 *
 * The viewer's own toolbar is deliberately left UNINTERCEPTED in v1: its
 * download button triggers Electron's default save dialog — functionally the
 * „Sačuvaj kao" the attachment row already offers — and print opens the OS
 * print dialog; neither is wired to anything of ours.
 *
 * Memory note, acknowledged rather than "fixed": `readBlob` buffers a whole
 * container per request, and the viewer may re-fetch the URL while rendering —
 * each fetch is a fresh full decrypt. The attachment size caps bound the worst
 * case.
 */
function openDocPreviewWindow(attachment: { fileName: string; sha256: string }): BrowserWindow {
  const blobUrl = `nx-blob://${attachment.sha256}`;
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    title: attachment.fileName,
    icon: iconPath,
    webPreferences: {
      // createWindow's hardening ritual (SEC-EL-01) minus the preload, plus
      // the one addition this window exists for.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true,
      spellcheck: false, // SEC-NET, as in createWindow.
      // webSecurity is left at its secure default and never touched (SEC-EL-01).
    },
  });

  // SEC-EL-03, createWindow's ritual adapted: no child windows ever, and
  // navigation locked to exactly the one blob URL this window was opened with
  // (Chromium may normalize a standard-scheme URL with a trailing slash;
  // nothing else passes).
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedPreviewNavigation(blobUrl, url)) event.preventDefault();
  });

  // The title is the STORED file name. Chromium would replace it with the
  // document's own metadata title on load — a PDF's claim about itself, which
  // is exactly the kind of file-authored value the UI must not echo.
  win.on("page-title-updated", (event) => event.preventDefault());

  docPreviewWindows.add(win);
  win.on("closed", () => docPreviewWindows.delete(win));

  void win.loadURL(blobUrl);
  return win;
}

// --- Smoke check ------------------------------------------------------------
//
// `--smoke`: prove the shell is wired end to end, then exit deterministically.
// Combines an authoritative main-side DB read with confirmation that the
// renderer completed a real window.nexus round trip (renderer -> preload -> IPC
// -> DB -> renderer). No extra IPC channel is added: the renderer flags its own
// readiness on `window`, which main reads via executeJavaScript.
//
// ADR-018: the app now starts locked, so the renderer's own round trip needs
// the database open before the window even loads — `runSmokeAuthSetup` (called
// from `app.whenReady` before `createWindow`) creates the smoke run's own
// throwaway account for exactly that reason. This function then proves the
// rest of the auth cycle for real: unlocked -> lock -> locked -> unlock (right
// passcode) -> unlock (wrong passcode) -> still-working data channel.

/** Runs before the window exists: creates the smoke run's own account so the renderer's readiness round-trip (which calls a data channel) has something to succeed against. */
async function runSmokeAuthSetup(): Promise<void> {
  const before = computeAuthStatus();
  if (before.state !== "uninitialized") {
    throw new Error(`expected an uninitialized account before smoke setup, got "${before.state}"`);
  }
  if (before.accounts.length !== 0 || before.selectedAccountId !== null) {
    throw new Error(`expected no accounts before smoke setup, got ${JSON.stringify(before.accounts)}`);
  }
  const created = await handleAuthCreate(SMOKE_ACCOUNT_LABEL, SMOKE_PASSCODE);
  if (!created.ok) {
    throw new Error(`smoke account creation failed: ${created.reason}`);
  }
  const after = computeAuthStatus();
  if (after.accounts.length !== 1 || after.selectedAccountId !== after.accounts[0]?.id) {
    throw new Error(`expected exactly one selected account after setup, got ${JSON.stringify(after)}`);
  }
  if (after.accounts[0]?.label !== SMOKE_ACCOUNT_LABEL) {
    throw new Error(`expected the created account to keep its label, got ${JSON.stringify(after.accounts)}`);
  }
  if (created.recoveryCode === undefined) {
    throw new Error("account creation returned no Recovery Kit code");
  }
  smokeRecoveryCode = created.recoveryCode;
}

/**
 * The Recovery Kit code the smoke account was created with — kept only so the
 * migration rehearsal below can use it. A real account hands the code to the
 * user once and never holds on to it.
 */
let smokeRecoveryCode = "";

/** The passcode the migration rehearsal sets while recovering, to prove the re-bound wrap actually works afterwards. */
const SMOKE_MIGRATED_PASSCODE = "migrated-passcode-2";

/**
 * Rehearses the device-migration path (ADR-018) end to end against the real OS
 * keystore — the one flow that cannot be unit-tested, because its whole point
 * is what DPAPI does with a blob it did not produce.
 *
 * Carrying `nexus.db` + `keychain.json` to another machine (or another Windows
 * account) is simulated by overwriting `guard` with bytes this machine's DPAPI
 * cannot decrypt, which is exactly what a foreign blob looks like from here.
 * The passcode must then refuse with `otherDevice` rather than lie about being
 * wrong, the Recovery Kit must still open the database, and the new passcode it
 * sets must be usable on the next lock — that last step is what proves recovery
 * re-bound the wrap to *this* device instead of leaving the account permanently
 * recovery-only.
 */
async function runSmokeMigrationRehearsal(): Promise<void> {
  performLock();

  const keychainFile = join(activeAccountDir(), "keychain.json");
  const parsed: unknown = JSON.parse(readFileSync(keychainFile, "utf8"));
  const foreignGuard = { ...(parsed as Record<string, unknown>), guard: randomBytes(64).toString("base64") };
  writeFileSync(keychainFile, JSON.stringify(foreignGuard, null, 2));

  const migratedStatus = computeAuthStatus();
  if (!migratedStatus.requiresRecovery || migratedStatus.state !== "locked") {
    throw new Error(
      `expected a foreign guard to read as locked + requiresRecovery, got ${JSON.stringify(migratedStatus)}`,
    );
  }

  const passcodeOnOtherDevice = await handleAuthUnlock(SMOKE_PASSCODE);
  if (passcodeOnOtherDevice.ok || passcodeOnOtherDevice.reason !== "otherDevice") {
    throw new Error(
      `expected the passcode to refuse with "otherDevice", got ${JSON.stringify(passcodeOnOtherDevice)}`,
    );
  }

  const recovered = await handleAuthRecover(smokeRecoveryCode, SMOKE_MIGRATED_PASSCODE);
  if (!recovered.ok) {
    throw new Error(`expected the Recovery Kit to open a migrated account, got reason "${recovered.reason}"`);
  }
  if (listProfiles(requireDb()).length < 1) {
    throw new Error("expected the profile to be readable after recovery");
  }

  performLock();
  const afterMigration = await handleAuthUnlock(SMOKE_MIGRATED_PASSCODE);
  if (!afterMigration.ok) {
    throw new Error(
      `expected the passcode set during recovery to work on this device, got reason "${afterMigration.reason}"`,
    );
  }
}

/**
 * Rehearses the ADR-019 attachment-encryption migration end to end against
 * the real filesystem — the one flow that cannot be exercised by
 * `@nexus/core/auth`'s own unit tests, because its whole point is what a real
 * `<userData>/attachments` legacy tree looks like to `migrateLegacyBlobs`.
 * Runs after `runSmokeMigrationRehearsal`, which leaves the app unlocked (its
 * final step is a passcode unlock on the migrated account), so `blobKeys` is
 * already populated here.
 *
 * Proves, in order: (1) a hand-written legacy plaintext blob is readable
 * through the dual-read window before any migration runs; (2) migrating it
 * moves it into the encrypted store as a genuine `NXB1` container and removes
 * the now-empty legacy tree; (3) a fresh `saveBlob` never touches plaintext
 * on disk either; (4) running the migration again is a true no-op.
 */
async function runSmokeBlobMigrationRehearsal(): Promise<void> {
  const paths = blobStorePathsFor();
  const keys = requireBlobKeys();
  // The last unlock started a migration pass of its own; let it finish before
  // planting a legacy blob, so the two never walk the tree at the same time.
  await legacyMigrationTask;

  // 1. The dual-read window.
  const legacyBytes = Buffer.from("legacy attachment bytes for the smoke rehearsal");
  const legacySha256 = createHash("sha256").update(legacyBytes).digest("hex");
  const legacyFanoutDir = join(paths.legacyDir, legacySha256.slice(0, 2));
  mkdirSync(legacyFanoutDir, { recursive: true });
  writeFileSync(join(legacyFanoutDir, legacySha256), legacyBytes);

  const beforeMigration = await readBlob(paths, keys, legacySha256);
  if (beforeMigration === null || !Buffer.from(beforeMigration).equals(legacyBytes)) {
    throw new Error("expected readBlob to serve the hand-written legacy blob before migration");
  }

  // 2. The migration.
  const migrationResult = await migrateLegacyBlobs(paths, keys, () => true);
  if (migrationResult.migrated < 1 || migrationResult.skipped !== 0) {
    throw new Error(
      `expected the migration to move at least one blob with nothing skipped, got ${JSON.stringify(migrationResult)}`,
    );
  }
  if (existsSync(join(legacyFanoutDir, legacySha256))) {
    throw new Error("expected the legacy blob file to be gone after migration");
  }
  if (existsSync(paths.legacyDir)) {
    throw new Error("expected the legacy attachments directory to be removed after a clean migration");
  }

  const legacyStorageName = await blobStorageName(keys.nameKey, legacySha256);
  const migratedContainer = readFileSync(
    join(paths.dir, legacyStorageName.slice(0, 2), legacyStorageName),
  );
  if (migratedContainer.subarray(0, 4).toString("ascii") !== "NXB1") {
    throw new Error("expected the migrated blob's on-disk container to start with the NXB1 magic");
  }
  if (migratedContainer.includes(legacyBytes)) {
    throw new Error("expected the migrated blob's on-disk container to NOT contain its plaintext");
  }

  const afterMigration = await readBlob(paths, keys, legacySha256);
  if (afterMigration === null || !Buffer.from(afterMigration).equals(legacyBytes)) {
    throw new Error("expected readBlob to still serve the migrated blob's original bytes");
  }

  // 3. A fresh save is encrypted, never plaintext, on disk.
  const freshBytes = Buffer.from("fresh attachment bytes written after unlock");
  const { sha256: freshSha256 } = await saveBlob(paths, keys, freshBytes);
  const freshStorageName = await blobStorageName(keys.nameKey, freshSha256);
  const freshContainer = readFileSync(join(paths.dir, freshStorageName.slice(0, 2), freshStorageName));
  if (freshContainer.subarray(0, 4).toString("ascii") !== "NXB1") {
    throw new Error("expected a freshly saved blob's on-disk container to start with the NXB1 magic");
  }
  if (freshContainer.includes(freshBytes)) {
    throw new Error("expected a freshly saved blob's on-disk container to NOT contain its plaintext");
  }
  const freshReadBack = await readBlob(paths, keys, freshSha256);
  if (freshReadBack === null || !Buffer.from(freshReadBack).equals(freshBytes)) {
    throw new Error("expected readBlob to round-trip a freshly saved blob");
  }

  // 4. Idempotence: nothing left to migrate, and it must not throw.
  const secondPass = await migrateLegacyBlobs(paths, keys, () => true);
  if (secondPass.migrated !== 0 || secondPass.skipped !== 0) {
    throw new Error(`expected a second migration pass to be a no-op, got ${JSON.stringify(secondPass)}`);
  }
}

/**
 * Rehearses global search end to end (ADR-021 / PRD 08 SRCH-002) through the
 * real store, `runSearchQuery`/`runRecentSearch` and `rebuildSearchIndex` —
 * the diacritic fold is the one thing that is worth proving against the
 * packaged app's own connection (the `nx_fold` SQL function `openDatabase`
 * registers), not just against `@nexus/core`'s pure functions in isolation.
 */
async function runSmokeSearchRehearsal(): Promise<void> {
  const [profile] = listProfiles(requireDb());
  if (!profile) throw new Error("expected at least one profile for the search rehearsal");

  const task = taskStore(profile.id).create({ title: "Rešenje za Đorđa" });
  try {
    for (const query of ["resenje", "djordja"]) {
      const results = await runSearchQuery(profile.id, query, 10);
      const hit = results.find((result) => result.entityId === task.id);
      if (!hit) {
        throw new Error(
          `expected query "${query}" to find the diacritic task, got ${JSON.stringify(results)}`,
        );
      }
      if (hit.titleRanges.length === 0) {
        throw new Error(`expected query "${query}" to produce a non-empty titleRanges`);
      }
    }

    const recent = await runRecentSearch(profile.id, 10);
    if (!recent.some((result) => result.entityId === task.id)) {
      throw new Error("expected the freshly created task to appear in runRecentSearch");
    }

    // A kind chip clicked with nothing typed sends exactly this: a kind prefix
    // and no words. It has no matchable term, so it falls through to the
    // recent list — which still has to honour the filter, or "show me only my
    // tasks" answers with everything.
    const note = noteStore(profile.id).create(new Date().toISOString());
    try {
      const kindOnly = await runSearchQuery(profile.id, "z:", 10);
      if (!kindOnly.some((result) => result.entityId === task.id)) {
        throw new Error('expected the kind-only query "z:" to still list the task');
      }
      if (kindOnly.some((result) => result.kind !== "task")) {
        throw new Error(
          `expected the kind-only query "z:" to return tasks only, got ${JSON.stringify(
            kindOnly.map((result) => result.kind),
          )}`,
        );
      }
    } finally {
      noteStore(profile.id).softDelete(note.id, new Date().toISOString());
    }

    const rawDb = requireDb().raw;
    const rebuiltCount = rebuildSearchIndex(rawDb);
    const { count: indexedCount } = rawDb
      .prepare("SELECT count(*) AS count FROM search_entries")
      .get() as { count: number };
    if (rebuiltCount !== indexedCount) {
      throw new Error(
        `expected rebuildSearchIndex's returned count (${rebuiltCount}) to match search_entries' row count (${indexedCount})`,
      );
    }

    const afterRebuild = await runSearchQuery(profile.id, "resenje", 10);
    if (!afterRebuild.some((result) => result.entityId === task.id)) {
      throw new Error("expected the task to still be findable after rebuildSearchIndex");
    }

    await rehearseAttachmentTextSearch(profile.id, task.id);
    rehearseSearchHistory(profile.id);
  } finally {
    taskStore(profile.id).softDelete(task.id);
  }
}

/**
 * The search HISTORY (SRCH-009 / migration 050) against the packaged app's own
 * encrypted connection: that the table is there, that the upsert-plus-eviction
 * transaction runs, and that a re-used query moves rather than duplicates.
 * Ends by clearing, so the smoke account is left exactly as it was found.
 */
function rehearseSearchHistory(profileId: string): void {
  const history = searchHistoryStore(profileId);
  if (history.list().length !== 0) {
    throw new Error("expected a fresh smoke profile to have no search history");
  }

  history.record("#posao rok:danas", "2026-01-01T09:00:00.000Z");
  history.record("resenje", "2026-01-01T09:01:00.000Z");
  history.record("#posao rok:danas", "2026-01-01T09:02:00.000Z");

  const entries = history.list();
  if (entries.length !== 2) {
    throw new Error(
      `expected a re-used query to move rather than duplicate, got ${JSON.stringify(entries)}`,
    );
  }
  // Stored as typed, operators included, and back on top.
  if (entries[0]?.query !== "#posao rok:danas") {
    throw new Error(`expected the re-used query on top, got ${JSON.stringify(entries)}`);
  }

  history.remove("resenje");
  if (history.list().length !== 1) {
    throw new Error("expected removing one history entry to leave exactly one");
  }
  if (history.clear() !== 1) {
    throw new Error("expected clearing the history to report the one remaining entry");
  }
}

/**
 * The attachment-content half of the search rehearsal (SRCH-008), against the
 * real encrypted blob store and this connection's own `nx_fold`.
 *
 * The row is written WITHOUT its text on purpose — the state every file
 * attached before this feature existed, and every file a restore brings in — so
 * what is proved here is the BACKFILL: bytes that only exist encrypted on disk
 * are decrypted, decoded, stored and projected into the owning task's entry.
 * Then the honesty marker, which is the whole reason the projection splits
 * matchable from displayed text: a word only the FILE contains finds the task
 * and reports itself as an attachment match, while a word the task's own title
 * contains highlights normally and does not.
 */
async function rehearseAttachmentTextSearch(profileId: string, taskId: string): Promise<void> {
  const bytes = Buffer.from("Zapisnik: kvartalni izvestaj o naplati.", "utf8");
  if (sniffMime(bytes) !== "text/plain") {
    throw new Error("expected the fixture text file to sniff as text/plain");
  }

  const store = taskAttachmentStore(profileId);
  const { sha256 } = await saveBlob(blobStorePathsFor(), requireBlobKeys(), bytes);
  const attachment = store.add(
    taskId,
    { fileName: "zapisnik.txt", mime: "text/plain", sizeBytes: bytes.byteLength, sha256 },
    new Date().toISOString(),
  );

  const beforeBackfill = await runSearchQuery(profileId, "naplati", 10);
  if (beforeBackfill.some((result) => result.entityId === taskId)) {
    throw new Error("expected the file's contents to be unsearchable before the backfill runs");
  }

  const session = requireDb();
  const claimed = await backfillAttachmentText({
    targets: attachmentTextTargets(session),
    readBytes: (hash) => readBlob(blobStorePathsFor(), requireBlobKeys(), hash),
    stillThisSession: () => db === session,
  });
  if (claimed < 1) {
    throw new Error(`expected the backfill to claim at least the fixture row, claimed ${claimed}`);
  }

  const byContent = (await runSearchQuery(profileId, "naplati", 10)).find(
    (result) => result.entityId === taskId,
  );
  if (!byContent) {
    throw new Error("expected a word only the attached FILE contains to find its task");
  }
  if (byContent.snippetRanges.length > 0 || byContent.titleRanges.length > 0) {
    throw new Error("expected an attachment-content match to highlight nothing the row displays");
  }
  if (!byContent.fromAttachment) {
    throw new Error("expected an attachment-content match to be reported as one");
  }

  const byTitle = (await runSearchQuery(profileId, "resenje", 10)).find(
    (result) => result.entityId === taskId,
  );
  if (!byTitle || byTitle.titleRanges.length === 0 || byTitle.fromAttachment) {
    throw new Error("expected a title match to highlight normally and NOT claim an attachment");
  }

  store.remove(taskId, attachment.id);
  await deleteBlobIfOrphaned(
    blobStorePathsFor(),
    requireBlobKeys(),
    sha256,
    blobRefCount(profileId, sha256),
  );
}

/**
 * Rehearses multiple local accounts end to end (ADR-044): add a second account,
 * switch back to the first, rename the second. Runs LAST, so nothing before it
 * has to care that the selected account moved, and it is the only place the
 * per-account directory layout is proved against a real filesystem and a real
 * OS keystore at once — a second account with its own key chain, its own
 * database and its own device secret.
 *
 * By this point the first account's passcode is `SMOKE_MIGRATED_PASSCODE`: the
 * migration rehearsal above recovered it and set that one.
 */
async function runSmokeMultiAccountRehearsal(): Promise<void> {
  const firstId = computeAuthStatus().selectedAccountId;
  if (firstId === null) throw new Error("expected an account to be selected before adding a second");

  const created = await handleAuthCreateAdditional(SMOKE_SECOND_LABEL, SMOKE_SECOND_PASSCODE);
  if (!created.ok) {
    throw new Error(`expected a second account to be created, got reason "${created.reason}"`);
  }

  const added = computeAuthStatus();
  if (added.accounts.length !== 2) {
    throw new Error(`expected two accounts after adding one, got ${JSON.stringify(added.accounts)}`);
  }
  if (added.state !== "unlocked" || added.selectedAccountId === firstId) {
    throw new Error(`expected the new account to be selected and open, got ${JSON.stringify(added)}`);
  }
  const secondId = added.selectedAccountId;
  if (secondId === null) throw new Error("expected the new account to be selected");
  // Its own database, seeded from scratch — never the first account's rows.
  if (listProfiles(requireDb()).length !== 1) {
    throw new Error("expected the second account to open a freshly seeded database of its own");
  }

  // Switching is a lock plus a select: the previous account's database must be
  // closed, not merely unreferenced.
  const switched = handleAuthSelectAccount(firstId);
  if (switched.state !== "locked" || switched.selectedAccountId !== firstId) {
    throw new Error(`expected switching back to leave the first account locked, got ${JSON.stringify(switched)}`);
  }
  if (db !== null) {
    throw new Error("expected switching accounts to close the open database");
  }

  const reopened = await handleAuthUnlock(SMOKE_MIGRATED_PASSCODE);
  if (!reopened.ok) {
    throw new Error(`expected the first account to unlock after a switch, got reason "${reopened.reason}"`);
  }
  if (listProfiles(requireDb()).length < 1) {
    throw new Error("expected the first account's own data to come back after the switch");
  }

  // A label is plaintext registry data, so renaming the account that is NOT
  // open works without unlocking it.
  const renamed = handleAuthRenameAccount(secondId, `${SMOKE_SECOND_LABEL} 2`);
  const renamedEntry = renamed.accounts.find((account) => account.id === secondId);
  if (renamedEntry?.label !== `${SMOKE_SECOND_LABEL} 2`) {
    throw new Error(`expected the locked account to be renameable, got ${JSON.stringify(renamed.accounts)}`);
  }
  if (renamed.selectedAccountId !== firstId || renamed.state !== "unlocked") {
    throw new Error(`expected a rename to leave the session alone, got ${JSON.stringify(renamed)}`);
  }

  // Deletion (ADR-048) is immediate and total: the entry goes, the directory
  // goes with it — tombstone included, since nothing here holds a handle on it
  // — and the account that stayed behind is untouched.
  const deleted = handleAuthDeleteAccount(secondId);
  if (deleted.accounts.some((account) => account.id === secondId)) {
    throw new Error(`expected the deleted account to leave the registry, got ${JSON.stringify(deleted.accounts)}`);
  }
  const erasedDir = accountDir(userDataDir(), secondId);
  if (existsSync(erasedDir) || existsSync(`${erasedDir}${DELETING_DIR_SUFFIX}`)) {
    throw new Error("expected a deleted account's directory and its tombstone to both be gone");
  }
  if (deleted.selectedAccountId !== firstId || deleted.state !== "unlocked") {
    throw new Error(`expected deleting another account to leave the session alone, got ${JSON.stringify(deleted)}`);
  }

  // And the survivor still OPENS — not merely "was never closed".
  performLock();
  const survivor = await handleAuthUnlock(SMOKE_MIGRATED_PASSCODE);
  if (!survivor.ok) {
    throw new Error(`expected the surviving account to unlock after a delete, got reason "${survivor.reason}"`);
  }
  if (listProfiles(requireDb()).length < 1) {
    throw new Error("expected the surviving account's own data to come back after a delete");
  }
}

/**
 * Rehearses the ADR-064 PDF preview end to end — THE spike the ADR calls for:
 * custom-protocol PDF hosting has version-specific history in Electron, so the
 * one thing worth proving against the real, built app is that a
 * `plugins: true` window pointed at an `nx-blob:` URL actually RENDERS the
 * document instead of downloading it or crashing.
 *
 * The fixture PDF (`minimalPdfBytes`) is stored through the real attachment
 * path — sniffed, blob-written, index row on a throwaway note — and the window
 * is opened through the same resolve-then-open pair the `doc:preview` handler
 * runs. Proves, in order: (1) the window reaches `did-finish-load`; (2) no
 * download started and the renderer did not crash getting there; (3)
 * `performLock` closes the window — ADR-064's closed-on-every-lock rule — and
 * the account re-unlocks afterwards. Runs LAST, after the multi-account
 * rehearsal has settled which account (and passcode) is open.
 */
async function runSmokeDocPreviewRehearsal(): Promise<void> {
  const [profile] = listProfiles(requireDb());
  if (!profile) throw new Error("expected at least one profile for the doc-preview rehearsal");

  const pdfBytes = minimalPdfBytes();
  if (sniffMime(pdfBytes) !== "application/pdf") {
    throw new Error("expected the fixture PDF to sniff as application/pdf");
  }

  const note = noteStore(profile.id).create(new Date().toISOString());
  const { sha256 } = await saveBlob(blobStorePathsFor(), requireBlobKeys(), pdfBytes);
  const attachment = noteAttachmentStore(profile.id).add(
    note.id,
    { fileName: "smoke.pdf", mime: "application/pdf", sizeBytes: pdfBytes.byteLength, sha256 },
    new Date().toISOString(),
  );

  // A download instead of a render is exactly the failure mode this spike
  // exists to catch (a viewer that will not host the scheme falls back to
  // downloading the document) — watched on the session, where it would fire.
  let downloadStarted = false;
  const onWillDownload = (): void => {
    downloadStarted = true;
  };
  session.defaultSession.on("will-download", onWillDownload);
  try {
    const resolved = requireDocAttachment("note", profile.id, note.id, attachment.id);
    if (resolved.mime !== "application/pdf") {
      throw new Error(`expected the stored fixture row to keep application/pdf, got "${resolved.mime}"`);
    }
    const win = openDocPreviewWindow(resolved);
    let renderProcessGone: string | null = null;
    win.webContents.on("render-process-gone", (_event, details) => {
      renderProcessGone = details.reason;
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("the preview window did not reach did-finish-load within 15s")),
        15_000,
      );
      win.webContents.once("did-finish-load", () => {
        clearTimeout(timer);
        resolve();
      });
      win.webContents.on(
        "did-fail-load",
        (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
          if (!isMainFrame) return;
          clearTimeout(timer);
          reject(new Error(`the preview window failed to load: ${errorCode} ${errorDescription}`));
        },
      );
    });
    // A download or a renderer crash is emitted AROUND the load rather than
    // strictly before did-finish-load — give either a beat to surface.
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (downloadStarted) {
      throw new Error("expected the PDF to render inline, but a download started");
    }
    if (renderProcessGone !== null) {
      throw new Error(`expected the preview renderer to survive, but it went: ${renderProcessGone}`);
    }
    if (win.isDestroyed()) {
      throw new Error("expected the preview window to stay open until the lock");
    }

    performLock();
    if (!win.isDestroyed()) {
      throw new Error("expected performLock to close the preview window (ADR-064)");
    }
  } finally {
    session.defaultSession.removeListener("will-download", onWillDownload);
  }

  const reopened = await handleAuthUnlock(SMOKE_MIGRATED_PASSCODE);
  if (!reopened.ok) {
    throw new Error(`expected the account to unlock after the preview lock, got reason "${reopened.reason}"`);
  }
  noteStore(profile.id).softDelete(note.id, new Date().toISOString());
}

async function runSmoke(win: BrowserWindow): Promise<void> {
  const profiles = listProfiles(requireDb());
  if (profiles.length < 1) {
    throw new Error("expected at least one profile after first-run seeding");
  }

  const rendererOk: unknown = await win.webContents.executeJavaScript(
    `new Promise((resolve) => {
       if (window.__nexusReady === true) return resolve(true);
       if (window.__nexusError === true) return resolve(false);
       window.addEventListener("nexus-ready", () => resolve(true), { once: true });
       window.addEventListener("nexus-error", () => resolve(false), { once: true });
       setTimeout(() => resolve(window.__nexusReady === true), 8000);
     })`,
  );
  if (rendererOk !== true) {
    throw new Error("renderer IPC round-trip did not succeed");
  }

  const unlockedStatus = computeAuthStatus();
  if (unlockedStatus.state !== "unlocked") {
    throw new Error(`expected "unlocked" status, got "${unlockedStatus.state}"`);
  }

  performLock();
  const lockedStatus = computeAuthStatus();
  if (lockedStatus.state !== "locked") {
    throw new Error(`expected "locked" status after auth:lock, got "${lockedStatus.state}"`);
  }

  const rightUnlock = await handleAuthUnlock(SMOKE_PASSCODE);
  if (!rightUnlock.ok) {
    throw new Error(`expected the correct passcode to unlock, got reason "${rightUnlock.reason}"`);
  }

  const wrongUnlock = await handleAuthUnlock("definitely-wrong-1");
  if (wrongUnlock.ok || wrongUnlock.reason !== "wrongPasscode") {
    throw new Error(
      `expected a wrong passcode to return { ok: false, reason: "wrongPasscode" }, got ${JSON.stringify(wrongUnlock)}`,
    );
  }

  // The existing profile/renderer checks still pass after the lock/unlock
  // cycle — proves re-unlocking after a lock reopens a genuinely working
  // database, not just a non-null handle.
  const profilesAfterRelock = listProfiles(requireDb());
  if (profilesAfterRelock.length < 1) {
    throw new Error("expected the profile to still be readable after re-unlocking");
  }

  await runSmokeMigrationRehearsal();
  await runSmokeBlobMigrationRehearsal();
  await runSmokeSearchRehearsal();
  await runSmokeMultiAccountRehearsal();
  await runSmokeDocPreviewRehearsal();
}

// --- `--shots` and `--demo` --------------------------------------------------

/** Where the sweep writes. Beside the app source in dev, which is the only place `--shots` ever runs. */
function shotsOutputDir(): string {
  return join(app.getAppPath(), "shots");
}

/**
 * The screenshot sweep's own throwaway account, and the demo profile inside it.
 *
 * Runs before `createWindow` for exactly the reason `runSmokeAuthSetup` does:
 * the renderer's first paint calls a data channel, so the database has to be
 * open — and, here, already full. Photographing the app while it seeds would
 * produce a sweep of loading states.
 */
async function runShotsAuthSetup(): Promise<void> {
  const created = await handleAuthCreate(DEMO_ACCOUNT_LABEL, DEMO_PASSCODE);
  if (!created.ok) throw new Error(`shots account creation failed: ${created.reason}`);
  await fillDemoProfile();
}

/**
 * Where the demo seed's attachments put their bytes: this session's own
 * encrypted, content-addressed blob store — the same one `attach:pick-files`
 * writes into, over the same unlocked keys, so a demo file is openable,
 * previewable and content-searchable exactly like one a person attached.
 * Returns the plaintext SHA-256, which is what the index row quotes.
 *
 * A named function rather than an inline literal so the arrow's own `saveBlob`
 * is unambiguously the imported one — the object's key is not a binding, but
 * the two names for one thing read badly in a diff.
 */
function demoBlobSink(): DemoAttachmentIo {
  return {
    saveBlob: async (bytes) => {
      const { sha256 } = await saveBlob(blobStorePathsFor(), requireBlobKeys(), bytes);
      return sha256;
    },
  };
}

/**
 * Puts the demo profile's private section into the state a real one is in once
 * somebody has set it up: a wrap set on disk, and a section that asks for the
 * credential before it shows anything.
 *
 * WHY THIS IS HERE AND NOT IN `demo/`. Everything else a demo profile holds is a
 * row, and a row can be written by a seeder that knows nothing but the database.
 * PRIV's first-time setup is not a row: the wrap it stores is derived from the
 * ACCOUNT PASSCODE, which lives in this file and in no table — it is verified
 * against the live session and never kept — so the only callers that can do this
 * are the ones that just created an account with a passcode they know, which is
 * `--shots` and `--demo` and nothing else. The renderer's „Dodaj demo profil"
 * seeds the same profile with the rows and leaves the section unset up, which is
 * the honest state there: main knows of no credential to wrap under.
 *
 * `regenerateKit: false`, deliberately. Minting the Recovery Kit here is possible
 * and would be a code NOBODY HAS SEEN — the flow shows it exactly once, to the
 * person who asked for it — so the card would report a kit that opens nothing.
 * Opting out leaves the kit columns null, and the card then says so.
 *
 * LOCKED, immediately, and that is deliberate too. Setup ends by adopting the
 * DEK with a five-minute idle timer on it, so a sweep that reached the settings
 * card early would photograph an unlocked section and one that reached it late
 * would photograph a locked one: the same frame, two answers, decided by how
 * long the run had been going. Dropping the key here makes both the state the
 * section is in whenever a person reopens the account, and the state a sweep can
 * rely on.
 */
async function setUpDemoPrivateSection(profileId: string): Promise<void> {
  const result = await privSetup(privDeps(), profileId, {
    credential: DEMO_PASSCODE,
    usesAccountPasscode: true,
    regenerateKit: false,
  });
  if (!result.ok) {
    throw new Error(
      `expected the demo profile's private section to set up, got "${result.reason}"`,
    );
  }
  privLock();
}

/**
 * Names the just-created account's first-run profile, fills it, and adds the
 * account's BUSINESS profile beside it. Shared by both harnesses so they cannot
 * drift apart.
 *
 * Both kinds, because ADR-058 gives the top layer two and a demo of one of them
 * is a demo of half the product (founder, 2026-08-08). They live under ONE
 * account on purpose — that is what a business profile IS here: the same
 * person's work, behind the same passcode, with its own data and its own module
 * set. Two accounts would have demonstrated the lock screen, not the profiles.
 */
async function fillDemoProfile(): Promise<void> {
  const database = requireDb();
  const now = Date.now();
  const profile = listProfiles(database)[0];
  if (profile === undefined) throw new Error("expected a first-run profile to seed");
  renameProfile(database, profile.id, DEMO_PROFILE_NAME);
  await seedDemoProfile(database.raw, profile.id, now, demoBlobSink());
  // Only on this path — see the comment on it: the passcode it wraps under is
  // this file's, and the renderer's own demo-profile button has none.
  await setUpDemoPrivateSection(profile.id);

  const business = new ProfileStore(database.raw).create(
    "business",
    DEMO_BUSINESS_PROFILE_NAME,
    new Date(now).toISOString(),
  );
  seedDemoBusiness(database.raw, business.id, now);
}

/**
 * `--demo`: put a full account on this device and say how to open it.
 *
 * Additive by construction. If the device has no account yet this is the first
 * one; if it already has some, `handleAuthCreateAdditional` adds another and
 * selects it, which is the same path the account picker's „Dodaj nalog“ takes.
 * Neither branch can reach an existing account's data — separate directory,
 * separate key chain (ADR-044).
 */
async function runDemoSeed(): Promise<void> {
  const existing = readRegistry(userDataDir()).accounts.length;
  const created =
    existing === 0
      ? await handleAuthCreate(DEMO_ACCOUNT_LABEL, DEMO_PASSCODE)
      : await handleAuthCreateAdditional(DEMO_ACCOUNT_LABEL, DEMO_PASSCODE);
  if (!created.ok) throw new Error(`demo account creation failed: ${created.reason}`);
  await fillDemoProfile();
  process.stdout.write(
    `DEMO OK — nalog „${DEMO_ACCOUNT_LABEL}“, lozinka „${DEMO_PASSCODE}“, ` +
      `profili „${DEMO_PROFILE_NAME}“ (lični) i „${DEMO_BUSINESS_PROFILE_NAME}“ (poslovni)\n`,
  );
}

// --- Auto-update (SEC-EL-07) — DISARMED, deliberately ------------------------
//
// **This is off, and it must stay off until the three conditions below are all
// true.** It was armed, and that was a live remote-code-execution hole in a
// shipped build rather than a future concern:
//
//   - `checkForUpdatesAndNotify()` runs with electron-updater's own defaults,
//     and those defaults are `autoDownload: true` and
//     `autoInstallOnAppQuit: true`. Nobody clicks anything: the installer is
//     fetched during the session and executed at the next quit.
//   - `electron-builder.yml` carries no signing configuration at all, so the
//     build is unsigned and the generated `app-update.yml` has no
//     `publisherName`. electron-updater's Windows signature check compares the
//     downloaded installer's Authenticode publisher against that field — and
//     when the field is absent the check RETURNS AS THOUGH IT PASSED. It is a
//     documented no-op, not a weak check.
//
// So the only thing standing between an attacker and native code on the user's
// machine was that the feed repository does not exist yet. That is an accident
// of scheduling, not a control. And the payoff grows the day sync ships: native
// code on the device reaches `DK`, the DPAPI device secret, and — once cloud is
// enabled — `MK`, every profile content key, and the stored refresh token,
// which keeps working after the machine is wiped.
//
// Before this may be re-armed, ALL THREE:
//   1. the build is Authenticode-signed and `win.publisherName` is set, so the
//      check stops being a no-op;
//   2. `autoDownload: false` and `autoInstallOnAppQuit: false`, with an
//      `update-available` handler that asks the user;
//   3. a detached Ed25519 signature over `latest.yml`, verified against a
//      public key COMPILED INTO THE BINARY, before `quitAndInstall`. Signing
//      alone defends TLS and the GitHub account; it does not defend a stolen
//      release token. The pinned key is what survives that.
//
// Until then the app never reaches for a feed, which is also why `autoUpdater`
// is no longer imported: an unused import of an update client is the next
// person's invitation to call it.

function shutdown(code: number): void {
  stopNotificationScheduler();
  cancelIdleCompactions(); // same reasoning as `performLock` — about to close `db`
  try {
    db?.close();
  } catch {
    // best-effort close; we are exiting anyway
  }
  // Force-exit so the smoke run returns a deterministic code without waiting on
  // window / GPU teardown.
  app.exit(code);
}

// --- Lifecycle --------------------------------------------------------------

app.whenReady().then(async () => {
  // SEC-EL: kill Electron's stock application menu, and answer no to every web
  // permission.
  //
  // `frame: false` removed the menu BAR from the screen; it did not remove the
  // MENU. Its accelerators stayed registered, so a shipped commercial build
  // still answered Ctrl+R, Ctrl+Shift+R and Ctrl+Shift+I — reload, force
  // reload, and DevTools on a window holding the user's decrypted life. The
  // drawn strip's own comment asserted the opposite as settled fact, which is
  // the part that kept anyone from re-checking: a false claim in a comment is
  // worse than the omission it hides.
  //
  // Clipboard shortcuts survive this on Windows. The Cut/Copy/Paste menu ROLES
  // are only load-bearing on macOS; Chromium handles the chords natively for
  // editable content everywhere else, and this app is Windows-only (DPAPI, the
  // Windows credential vault, Segoe UI Variable).
  Menu.setApplicationMenu(null);

  // The one rung of the Electron hardening set that had neither code nor a
  // stated reason. Nexus asks the web platform for nothing — notifications are
  // raised by `Notification` in MAIN, not by the renderer's Notification API,
  // and there is no camera, microphone, geolocation, MIDI or clipboard-read
  // path anywhere in the product. So both handlers deny unconditionally rather
  // than switching on a permission name: an allowlist with no entries is a
  // list somebody eventually adds to, and a flat refusal is a decision.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  // SEC-NET: the three runtime layers of the cloud-off boundary. The fourth
  // (`host-resolver-rules`) went on at module scope; `net/offline.ts` carries
  // the full reasoning for all four.
  //
  // `allowedRemoteOrigins` is EXACTLY the project's two Supabase origins —
  // `https://<host>` for PostgREST and the Edge Functions, `wss://<host>` for
  // Realtime — and only when this launch has cloud switched on AND this build
  // knows which project it is. Every other case is the empty list, which is the
  // value it held for the whole of 1.0.0.
  //
  // Read from the service rather than computed here, because the service is what
  // decides whether the ports exist at all: „a port was built" and „its origin is
  // admitted" have to be the same decision, or one of them is a second opinion.
  const allowedRemoteOrigins: readonly string[] = syncService().allowedOrigins();
  const devOrigin = devServerOrigin(process.env);

  // Layer 1: every request Chromium initiates — fetch, XHR, a stylesheet
  // `url()`, an `<img>`, a redirect, a service worker, a preconnect.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isRequestAllowed(details.url, allowedRemoteOrigins, devOrigin) });
  });

  // Layer 2: nowhere to connect even if something reaches the socket layer.
  // Port 9 is `discard`; nothing listens on it.
  //
  // `<-loopback>` UNDOES Chromium's built-in „never proxy loopback" rule, which
  // would otherwise leave every 127.0.0.1 destination reachable — including a
  // local relay a compromised renderer could be talked into using. It is
  // omitted in development for the one reason it has to be: the dev server IS
  // on loopback, and `loadURL` goes through this same stack. `ELECTRON_RENDERER_URL`
  // is undefined in every packaged build, so the weaker form is not reachable
  // from a shipped app.
  void session.defaultSession.setProxy({
    proxyRules: "http=127.0.0.1:9;https=127.0.0.1:9",
    ...(devOrigin === null ? { proxyBypassRules: "<-loopback>" } : {}),
  });

  // Layer 4: the one network client Chromium runs without being asked. The
  // windows below set `spellcheck: false`, and this empties the download URL as
  // well, because the two are separate switches: the shipped 1.0.0 fetched a
  // Google-hosted dictionary while its own privacy copy told the user the only
  // outbound request was a version check.
  //
  // ONE CALL, NOT TWO, and the missing one is deliberate.
  //
  // The security review's wording was to also call
  // `setSpellCheckerDictionaryDownloadURL('')`. That cannot be done safely, and
  // finding out cost two smoke runs. Electron refuses an empty string („not a
  // valid URL") — and it refuses it by rejecting a promise it created
  // INTERNALLY, while the method itself returns `void`. So there is nothing to
  // `await`, nothing to `.catch()`, and a `try`/`catch` around the call catches
  // nothing; the rejection surfaces as an unhandled rejection inside
  // `app.whenReady().then(…)` and strands the rest of startup. Both times, the
  // symptom was a window open at 0% CPU until the run was killed.
  //
  // The line is dropped rather than made to work with some other URL, because
  // the thing it was defending is already defended three times: the
  // spellchecker is off for the session here, off per-window (`spellcheck:
  // false` in both `webPreferences` blocks), and any dictionary request would
  // be cancelled by layer 1 above. A fourth layer that can take the application
  // down at startup is not defence in depth — it is the control breaking the
  // product it protects.
  session.defaultSession.setSpellCheckerEnabled(false);

  // Never the developer's real `%APPDATA%\Nexus` — a nested, disposable
  // directory, one per harness. Wiped up front (Electron only auto-creates the
  // DEFAULT userData path, not one redirected here, and a leftover
  // keychain.json from a previous run would make the very first smoke
  // assertion below false on the second run onward) then recreated, since
  // nothing else will create it before the first file write into it.
  //
  // `--demo` is deliberately absent: its whole purpose is an account that is
  // still there after the process exits, so it writes where a real launch
  // reads. It stays safe by being additive — a new account is a new directory
  // with its own key chain (ADR-044).
  const sandboxDir = isSmoke ? "smoke" : isShots ? "shots" : null;
  if (sandboxDir !== null) {
    const sandboxUserDataPath = join(app.getPath("userData"), sandboxDir);
    try {
      rmSync(sandboxUserDataPath, { recursive: true, force: true });
      mkdirSync(sandboxUserDataPath, { recursive: true });
    } catch (error) {
      // `force` forgives a MISSING path, not a BUSY one. On Windows a directory
      // holding a file another process has open cannot be removed at all, and
      // the `EPERM` that raises names neither the file nor the run holding it —
      // so a second `shots` run against the first run's sandbox read as an
      // inexplicable crash. It is a refusal, and it has to be one: a run whose
      // sandbox still holds the previous run's key chain is not the
      // deterministic run its frames claim to be. `scripts/run-lock.mjs` keeps
      // two runs from reaching this at all; this is what happens if they do.
      process.stderr.write(
        `Nexus: the ${sandboxDir} sandbox could not be cleared — ${String(error)}\n` +
          `  Another ${sandboxDir} run is probably using it. Refusing to start rather\n` +
          `  than running against a sandbox that still holds its files.\n`,
      );
      app.exit(1);
      return;
    }
    app.setPath("userData", sandboxUserDataPath);
  }

  try {
    // ADR-044, and strictly before anything answers the renderer: bring the
    // on-disk layout up to the per-account one (resuming an interrupted move),
    // then choose which account this launch is about. `lastActiveId` is what
    // the previous session left; a registry that has forgotten it (or never
    // had one) falls back to the oldest account, which is the only account at
    // all on every install that has just one.
    const bootRegistry = resumeAccountsMigration(userDataDir());
    activeAccountId = bootRegistry.lastActiveId ?? bootRegistry.accounts[0]?.id ?? null;

    // See `performLock`'s doc comment: `openExternally`'s temp copies are an
    // unavoidable plaintext residue outside both blob stores. Wiping them once
    // here catches whatever a previous run left behind if the process died
    // before a lock ever ran (a graceful lock already wipes this directory) —
    // across EVERY account, since nothing on disk records which one that was.
    wipeAllTmpOpenDirs();

    // ADR-048, and for the same reason as the sweep above: a deletion whose
    // final erase lost a race with a file another process still held open
    // leaves a `.deleting` tombstone nothing will ever come back for. It is
    // already unreachable — excluded from every scan and absent from the
    // registry — so this is disk space, not correctness.
    sweepDeletedAccountDirs(userDataDir());

    // ADR-018: the main process starts LOCKED. No database is opened here —
    // `db` stays null until `auth:create`/`auth:unlock`/`auth:recover`
    // succeeds (via `openEncrypted`), so every data channel's `requireDb()`
    // genuinely has nothing to hand back until the passcode is verified.
    registerIpc();

    // ADR-014 / ADR-041: `blobMimeForHash` is the union over every table that
    // names a hash — an attachment row on either module, or a dashboard
    // background — and every member of it is deliberately profile-agnostic, so
    // the placeholder profile id is never read. The lookup itself is wrapped:
    // while locked, the store getters throw through `requireDb()` — caught here
    // and turned into a clean 404 (`registerBlobProtocol` already 404s on a
    // null mime) rather than a generic network error surfacing in the renderer
    // for every image on screen while locked.
    registerBlobProtocol(
      (sha256) => {
        try {
          return blobMimeForHash("", sha256);
        } catch {
          return null;
        }
      },
      // Lazy for the same reason the key getter is: the blob roots move with
      // the selected account (ADR-044), and this registration outlives every
      // switch. Read only after the key check below it, which is what
      // guarantees an account is selected by the time it runs.
      blobStorePathsFor,
      () => blobKeys,
    );

    // The private section's read protocol (PRIV v1 / ADR-057): decrypts a
    // sealed attachment ONLY while a section is unlocked — a locked section
    // answers 404 for everything, and so does a container the open section's
    // key does not authenticate (another profile's file, edited bytes, a
    // swapped id: AES-GCM cannot tell them apart and neither does this). The
    // served Content-Type is sniffed from the DECRYPTED bytes (SEC-FILE-02) —
    // an envelope's mime claim is renderer-authored and never trusted here.
    protocol.handle("priv-blob", async (request) => {
      const host = new URL(request.url).hostname;
      let sealed: Uint8Array;
      try {
        // `privBlobFilePath` re-checks the id shape — the path-traversal gate.
        sealed = await readFileAsync(privBlobFilePath(host));
      } catch {
        return new Response(null, { status: 404 });
      }
      const key = await privSessionBlobKey();
      if (key === null) return new Response(null, { status: 404 });
      let bytes: Uint8Array;
      try {
        bytes = await openPrivBlob(key, host, sealed);
      } catch {
        return new Response(null, { status: 404 });
      }
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Type": sniffMime(bytes), "X-Content-Type-Options": "nosniff" },
      });
    });

    if (isSmoke) {
      // Unlike a real launch, the smoke run cannot wait for a renderer-driven
      // auth:create/auth:unlock call: the renderer's own readiness round-trip
      // (below, after the window loads) calls a data channel, so the database
      // must already be open before `createWindow` runs.
      await runSmokeAuthSetup();
    }

    // `--demo` never opens a window at all: it writes an account and stops, so
    // that the app opened normally afterwards finds it in the picker.
    if (isDemo) {
      await runDemoSeed();
      shutdown(0);
      return;
    }

    if (isShots) await runShotsAuthSetup();

    mainWindow = createWindow();

    // Never in dev, never during the smoke run — only a real packaged install.
    // No update check. See the disarmed auto-update section: the check ran
    // with auto-download and auto-install-on-quit at their defaults against an
    // unsigned build whose signature verification is a no-op. It comes back
    // only with signing, an explicit prompt, and a pinned-key signature over
    // the feed manifest.

    if (isSmoke) {
      mainWindow.webContents.once("did-finish-load", () => {
        void runSmoke(mainWindow!)
          .then(() => {
            process.stdout.write("SMOKE OK\n");
            shutdown(0);
          })
          .catch((error: unknown) => {
            process.stderr.write(
              `SMOKE FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
            );
            shutdown(1);
          });
      });
    }

    if (isShots) {
      mainWindow.webContents.once("did-finish-load", () => {
        // The passcode goes WITH the account it opens: `runShotsAuthSetup`
        // created that account with `DEMO_PASSCODE` a few lines above, and the
        // sweep's lock scene has to be able to unlock what it locked. It is
        // handed in rather than written down in `shots/` so that the one copy
        // of it stays here — see `ShotFixtures`.
        void runShots(mainWindow!, shotsOutputDir(), { passcode: DEMO_PASSCODE })
          .then((frames) => {
            const findings = frames.reduce((total, frame) => total + frame.findings.length, 0);
            // The duplicate count is on the HEADLINE and not only in the
            // report, because the headline is what a reader takes away — and
            // a run that had quietly lost frames printed exactly what a clean
            // one prints.
            const duplicates = duplicateStems(frames);
            const collided =
              duplicates.length === 0 ? "" : `, ${String(duplicates.length)} duplicate stems`;
            // And the coverage that is owed and was not taken, on the same
            // argument one field over: the headline is what a reader takes away,
            // and „0 findings" over a set that is one surface short is a clean
            // bill of health for something that was not looked at. A refused
            // maximise reports itself on stderr; that is where a reader who is
            // already suspicious looks, and the headline is where everyone does.
            const missing = missingCoverage(frames);
            const absent =
              missing.length === 0 ? "" : `, NO ${missing.join("/")} frame (the window would not maximise)`;
            process.stdout.write(
              `SHOTS OK — ${String(frames.length)} frames, ${String(findings)} findings` +
                `${collided}${absent} → ${shotsOutputDir()}\n`,
            );
            shutdown(0);
          })
          .catch((error: unknown) => {
            // The frames taken before the failure, and the report over them,
            // are written anyway — see `runShots`. Said out loud, because the
            // reader's next question is whether the run left anything usable
            // behind, and the answer used to be „no" and is now „yes, up to
            // here".
            process.stderr.write(
              `SHOTS FAIL: ${error instanceof Error ? error.message : String(error)}\n` +
                `  frames taken before the failure, and their report, are in ${shotsOutputDir()}\n`,
            );
            shutdown(1);
          });
      });
    }
  } catch (error) {
    process.stderr.write(
      `Startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    shutdown(1);
  }

  app.on("activate", () => {
    if (!isAutomatedRun && BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
}).catch((error: unknown) => {
  // THE `try` INSIDE THE CALLBACK DOES NOT COVER THE CALLBACK. It begins after
  // the sandbox wipe, the proxy switch and the spellcheck switch, and a throw in
  // any of those — or in the listener registrations at the end — used to surface
  // as an unhandled rejection: Electron reports that to a console nobody is
  // reading, and the application stops half started, with a window at 0 % CPU,
  // no message and no exit. That is not a hypothetical shape; it has cost this
  // project three runs — twice through `setSpellCheckerDictionaryDownloadURL`,
  // whose rejected promise cannot be caught at the call site because the method
  // returns `void`, and once through a sandbox `rmSync` two `shots` runs were
  // fighting over.
  //
  // This is the guard that makes the class impossible rather than merely absent.
  // From here on, every throw out of startup ends the process with a sentence and
  // a non-zero code, whatever it was.
  process.stderr.write(
    `Startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  shutdown(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// BEFORE `will-quit`, deliberately: the running phases are written through a
// database `will-quit` is about to close, and a row cannot be inserted into a
// closed file. See `closeRunningFocusPhasesOnQuit` for why a clean quit must
// leave a real end time behind.
app.on("before-quit", () => {
  closeRunningFocusPhasesOnQuit();
});

app.on("will-quit", () => {
  releaseGlobalCapture(); // Electron requires the registration be given back before the process exits
  // A simulation left running after the window closed is a process the user
  // cannot see and did not keep. `dispose` is synchronous by construction:
  // nothing here may await, and the container profile's removal is issued
  // detached so that it outlives this process. `?.` because the runner is built
  // lazily — a launch where nobody opened Elektronika has none to stop.
  elecRunnerIpc?.dispose();
  stopNotificationScheduler();
  cancelIdleCompactions(); // same reasoning as `performLock` — about to close `db`
  clearRestoreState(); // likewise: decrypted archive bytes and a plaintext undo snapshot must not outlive the session
  try {
    db?.close();
  } catch {
    // ignore
  }
});

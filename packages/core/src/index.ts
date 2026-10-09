export { MAX_ID_LENGTH } from "./ids.js";

export { MODULE_GROUPS } from "./modules/manifest.js";
export type { ModuleGroup, ModuleManifest } from "./modules/manifest.js";
export type {
  ModuleCopyDeclaration,
  ModuleKindCopy,
  ModuleText,
} from "./modules/copy.js";
export type { LabelText } from "./contracts/labels.js";
export { ModuleRegistry } from "./modules/registry.js";

export { resolveEnabled } from "./flags/flags.js";
export type { FlagState, FlagStore } from "./flags/flags.js";

export type {
  JsonSchema,
  WidgetChoiceField,
  WidgetChoiceOption,
  WidgetConfigField,
  WidgetContract,
  WidgetCountField,
  WidgetSize,
  WidgetTaskListsField,
} from "./contracts/widgets.js";
export {
  parseWidgetConfig,
  serializeWidgetConfig,
  validateWidgetConfig,
  WIDGET_CONFIG_MAX_TASK_LISTS,
  widgetChoice,
  widgetCount,
  widgetTaskLists,
} from "./contracts/widgetConfig.js";
export type {
  ParseWidgetConfigOptions,
  WidgetConfig,
  WidgetConfigValue,
} from "./contracts/widgetConfig.js";
export type {
  SettingsChoiceControl,
  SettingsChoiceOption,
  SettingsControl,
  SettingsFactControl,
  SettingsPanel,
  SettingsStorage,
  SettingsToggleControl,
  SettingsValueControl,
} from "./contracts/settings.js";
export type { SearchIndexer } from "./contracts/search.js";
export type { StatsContribution } from "./contracts/stats.js";
export type {
  AutomationAction,
  AutomationCatalog,
  AutomationTrigger,
} from "./contracts/automation.js";
export type { ImexHandler } from "./contracts/imex.js";
export {
  TOOL_CATEGORIES,
  TOOL_CONSTANT_TIERS,
  TOOL_DRAWERS,
  TOOL_PACKS,
  TOOL_RISK_CLASSES,
  enabledPacks,
  packFlagKey,
  toolDrawer,
  toolForbidsVerdict,
  toolVisibleToPacks,
} from "./contracts/tools.js";
export type {
  ToolCategory,
  ToolConstantTier,
  ToolDrawer,
  ToolPack,
  ToolRegistration,
  ToolRiskClass,
} from "./contracts/tools.js";

export type {
  CollectionSchema,
  FieldDef,
  FieldType,
  ScalarFieldDef,
  SelectFieldDef,
} from "./views/fields.js";
export type {
  CalendarViewConfig,
  CardsViewConfig,
  FilterSpec,
  KanbanViewConfig,
  ListViewConfig,
  SortSpec,
  ViewConfig,
} from "./views/viewConfig.js";
export {
  applyFilters,
  applySort,
  arrangeKanbanColumns,
  groupForKanban,
  moveBetweenGroups,
  orderKanbanColumnKeys,
  ViewConfigError,
} from "./views/engine.js";
export type { KanbanGroup } from "./views/engine.js";

export {
  distributeBacklog,
  distributeBacklogCapped,
  planBlockDates,
  planDayCapacity,
} from "./study/planEngine.js";
export type {
  DistributedBacklog,
  PlanBlockDate,
  PlanBlockDatesInput,
  PlanBlockKind,
  PlanCapacitySpec,
  PlanTopic,
} from "./study/planEngine.js";

export { computeStreak } from "./study/studyStats.js";
export type { StreakResult } from "./study/studyStats.js";

// --- HABIT (migration 055) --------------------------------------------------
//
// A schedule vocabulary of its own, deliberately NOT ADR-024's — see
// `habitSchedule.ts`'s header for the reasoning, which is the one thing about
// this module a reader must not have to rediscover.
export {
  HABIT_MAX_PER_WEEK,
  HABIT_MAX_WEEKDAY,
  HABIT_MIN_WEEKDAY,
  serializeHabitSchedule,
  validateHabitSchedule,
} from "./habits/habitSchedule.js";
export type { HabitSchedule } from "./habits/habitSchedule.js";
export { computeHabitStreak } from "./habits/habitStreak.js";
export type { HabitStreakResult } from "./habits/habitStreak.js";
// THE „urađeno" rule (slice c): moved out of the renderer once main needed the
// same sentence for the reminder source, so there is still exactly one of it.
export { countsAsDone } from "./habits/habitDone.js";
export { habitReminderInputs } from "./habits/habitReminder.js";
export type { HabitReminderSource } from "./habits/habitReminder.js";

// --- FOCUS (the one focus timer) --------------------------------------------
//
// The pure Pomodoro rules and the wall-clock arithmetic behind a running phase.
// One row is one PHASE, and STUDY's open-ended timer is a `work` phase with no
// plan — there is exactly one focus timer in this product (`focusSession.ts`).
export {
  DEFAULT_FOCUS_CONFIG,
  FOCUS_OUTCOMES,
  FOCUS_PHASE_KINDS,
  nextPhase,
  phaseProgress,
  validateFocusConfig,
} from "./focus/focusSession.js";
export type {
  FocusConfig,
  FocusConfigResult,
  FocusOutcome,
  FocusPhaseKind,
  FocusPhaseProgress,
  FocusPhaseTiming,
} from "./focus/focusSession.js";

// --- CANV (the canvas module, migration 059) --------------------------------
//
// A board's drawing is Excalidraw's own `serializeAsJSON` document kept VERBATIM
// — never re-modelled into rows — and what this package validates is the
// envelope alone. `canvasScene.ts`'s header carries the reasoning, which is the
// one thing about this module a reader must not have to rediscover.
export {
  CANVAS_SCENE_TYPE,
  MAX_CANVAS_SCENE_LENGTH,
  emptyCanvasScene,
  parseCanvasScene,
  serializeCanvasScene,
  validateCanvasScene,
} from "./canvas/canvasScene.js";
export type { CanvasScene } from "./canvas/canvasScene.js";
// A card on a board is an Excalidraw EMBEDDABLE, and an embeddable whose host
// renderer returns nothing falls through to a real iframe — so the grammar that
// decides whether a `link` is one of ours is a security boundary, not a
// formatting nicety. `canvasRef.ts`'s header carries that reasoning.
export {
  CANVAS_REF_KINDS,
  CANVAS_REF_SCHEME,
  MAX_CANVAS_REF_LENGTH,
  canvasRefText,
  isCanvasRefText,
  parseCanvasRef,
} from "./canvas/canvasRef.js";
export type { CanvasRef, CanvasRefKind } from "./canvas/canvasRef.js";

// --- FIT (the nutrition and training module, migration 058) -----------------
//
// Both catalogues are APP-SHIPPED read-only data rather than database rows, and
// a logged meal snapshots the macros it used — the two decisions the whole
// module rests on. `catalogue.ts` and `food.ts` carry the reasoning; `@nexus/db`
// deliberately reads neither.
export {
  EMPTY_MACROS,
  FOOD_CATEGORIES,
  FOOD_ENERGY_TOLERANCE,
  foodRefText,
  macrosFor,
  MAX_FOOD_REF_LENGTH,
  parseFoodRef,
  searchFoods,
  sumMacros,
  validateFoodEntry,
} from "./fitness/food.js";
export type {
  FoodCategory,
  FoodEntry,
  FoodEntryProblem,
  FoodMacros,
  FoodProblemCode,
  FoodRef,
  FoodServing,
  FoodSource,
  RecipeComponent,
  SearchableFood,
} from "./fitness/food.js";
// An exercise entry declares what one SET of it records (`metric`), which is
// what lets the arithmetic below refuse a plank's tonnage instead of answering
// zero — and `assisted_reps` is a metric of its own because assistance improves
// downward. `exercise.ts`'s header carries that reasoning.
export {
  EXERCISE_EQUIPMENT,
  EXERCISE_METRICS,
  exerciseRefText,
  exercisesForMuscle,
  MAX_EXERCISE_REF_LENGTH,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  parseExerciseRef,
  searchExercises,
  validateExerciseEntry,
} from "./fitness/exercise.js";
export type {
  ExerciseEntry,
  ExerciseEntryProblem,
  ExerciseEquipment,
  ExerciseMetric,
  ExerciseProblemCode,
  ExerciseRef,
  MovementPattern,
  MuscleExercises,
  MuscleGroup,
} from "./fitness/exercise.js";
// The training arithmetic and, more to the point, its refusals: no estimated
// 1RM above ten reps (past which the two published formulas stop describing the
// same lift), no tonnage for a metric that has none, no calorie burn and no
// body-fat percentage at all. `training.ts`'s header says why each one is a
// refusal rather than a gap.
export {
  BODY_WEIGHT_MIN_SAMPLES,
  BODY_WEIGHT_WINDOW_DAYS,
  countsTowardVolume,
  estimateOneRepMax,
  movingAverage,
  ONE_RM_DEFAULT_FORMULA,
  ONE_RM_FORMULAS,
  ONE_RM_MAX_REPS,
  sessionTonnage,
  SET_KINDS,
  setTonnage,
  trendChange,
  workingSets,
} from "./fitness/training.js";
export type {
  DailyReading,
  LoggedSet,
  OneRepMaxEstimate,
  OneRepMaxFormula,
  SetKind,
  TonnageTotal,
  TrendChange,
  TrendPoint,
} from "./fitness/training.js";
// What a training log adds up to over weeks (ADR-081 §5), and — as everywhere
// in FIT — what it refuses to add up: nothing is stored, warm-ups are never
// volume, and a record only exists where its question does. „The heaviest
// assisted pull-up" is the one figure this module will not print, because there
// a bigger number is LESS work. `progress.ts`'s header carries the reasoning.
export { exerciseRecords, mondayOf, weeklyVolume } from "./fitness/progress.js";
export type { ExerciseRecords, ProgressSet, RecordAt, WeekVolume } from "./fitness/progress.js";
export {
  catalogueExercise,
  catalogueFood,
  EXERCISE_CATALOGUE,
  FOOD_CATALOGUE,
} from "./fitness/catalogue.js";

// --- FIT: the body profile and energy expenditure (slice a2) ----------------
//
// A profile (sex, birth date, height, activity) and a measurement (weight and
// whatever a scale reported that day) are different kinds of thing, and age is
// DERIVED from the birth date on a reference day rather than stored. Three
// tiers of expenditure — measured from the user's own intake and weight trend,
// Katch–McArdle off a measured body-fat percentage, Mifflin–St Jeor otherwise —
// and `energyTiers` reports which one the data supports and what the others are
// missing. `body.ts`'s header carries the reasoning, including what this module
// refuses to compute (no body-fat estimation, no workout calorie burn) and why
// nothing here writes `fit_targets`.
export {
  ACTIVITY_FACTORS,
  ACTIVITY_LEVELS,
  BODY_SEXES,
  CIRCUMFERENCE_SITES,
  ENERGY_METHODS,
  KCAL_PER_KG_BODY_MASS,
  MAX_CIRCUMFERENCE_CM,
  MAX_HEIGHT_CM,
  MAX_WEIGHT_KG,
  MEASURED_MIN_INTAKE_COVERAGE,
  MEASURED_MIN_TREND_READINGS,
  MEASURED_MIN_WINDOW_DAYS,
  MEASURED_TREND_DAYS,
  MIN_HEIGHT_CM,
  NO_CIRCUMFERENCES,
  WEIGHT_GOALS,
  ageOnDay,
  bmiFor,
  energyTiers,
  katchMcArdleBmr,
  leanBodyMassKg,
  measuredEnergy,
  mifflinStJeorBmr,
  muscleMassKg,
  restingEnergy,
  suggestDailyEnergy,
  totalEnergy,
  validateBodyMeasurement,
  validateBodyProfile,
} from "./fitness/body.js";
export type {
  ActivityLevel,
  BmiCaveat,
  BmiReading,
  BodyCircumferences,
  CircumferenceSite,
  BodyMeasurement,
  BodyProblem,
  BodyProblemCode,
  BodyProfile,
  BodySex,
  EnergyAssumption,
  EnergyEstimate,
  EnergyGap,
  EnergyMethod,
  EnergyRequirement,
  EnergyTierInput,
  EnergyTierReport,
  IntakeDay,
  MeasuredEnergyDetail,
  MeasuredEnergyInput,
  MeasuredEnergyRefusal,
  MeasuredEnergyRefusalCode,
  MeasuredEnergyResult,
  MuscleReading,
  SuggestedEnergyTarget,
  WeightGoal,
  WeightReading,
} from "./fitness/body.js";
// --- end FIT slice a2 -------------------------------------------------------

// --- UTIL (the tool drawer's arithmetic) ------------------------------------
//
// Pure conversion and calculation, with no surface of their own. Two decisions
// carry the module: a unit is a FUNCTION PAIR rather than a scale factor (a
// factor table is silently wrong for temperature, which has an offset), and the
// ambiguous data units are offered under BOTH conventions rather than resolved
// by guessing — kB and KiB are different quantities. Nothing here rounds;
// `roundForDisplay` is the surface's own explicit step.
export {
  DATA_CONVENTIONS,
  TOOL_DISPLAY_PRECISION,
  UNIT_KINDS,
  convertUnit,
  findUnit,
  isRatioUnit,
  roundForDisplay,
  unitsOfKind,
} from "./tools/units.js";
export type { DataConvention, UnitDef, UnitKind } from "./tools/units.js";
export {
  PDV_RATE_REDUCED,
  PDV_RATE_STANDARD,
  PDV_RATES,
  addVat,
  annuityPlan,
  applyPercentChange,
  compareUnitPrices,
  extractVat,
  percentChange,
  percentOf,
  whatPercent,
} from "./tools/calculators.js";
export type {
  LoanPlan,
  LoanTerms,
  PackageOffer,
  UnitPriceRow,
  VatBreakdown,
} from "./tools/calculators.js";
export {
  TOOL_MAX_DECIMALS,
  parseToolNumber,
  toolNumberInputValue,
} from "./tools/numberInput.js";

export {
  ALWAYS_ON_SOURCES,
  deriveNotificationCandidates,
  isAlwaysOnSource,
  isDeliverable,
} from "./notify/notificationEngine.js";
export type {
  DeliveryGate,
  DeriveNotificationCandidatesInput,
  DocumentReminderInput,
  EventReminderInput,
  ExamReminderInput,
  HabitReminderInput,
  NotificationCandidate,
  NotificationPriority,
  NotificationSource,
  StudyDayReminderInput,
  SubscriptionReminderInput,
  TaskReminderInput,
} from "./notify/notificationEngine.js";

export { isWithinQuietHours } from "./notify/quietHours.js";

export {
  COALESCE_WINDOW_MS,
  DIGEST_COUNT_THRESHOLD,
  coalesceDeliveries,
  emptyDeliveryWindow,
} from "./notify/deliveryWindow.js";
export type {
  CoalesceDeliveriesInput,
  CoalesceResult,
  DeliveryWindow,
  DigestReason,
} from "./notify/deliveryWindow.js";

export { collectNoteLinkIds, mergeNoteState } from "./notes/yjsMerge.js";
export type { MergedNoteState } from "./notes/yjsMerge.js";

export { extractNoteLinkTargets, remapNoteState } from "./notes/noteLinks.js";

export { duplicateNoteState } from "./notes/noteDuplicate.js";
export type { DuplicatedNoteState, DuplicateNoteStateInput } from "./notes/noteDuplicate.js";

export { collectNoteCards, NOTE_CARD_MAX_TEXT_LENGTH, parseCardBlock } from "./notes/noteCards.js";
export type { CardKind, CardSyntaxSpan, NoteCardSpec, ParsedBlock, ParsedCard } from "./notes/noteCards.js";

export { collectChecklistItems } from "./notes/noteChecklist.js";
export type { ChecklistItem } from "./notes/noteChecklist.js";

export { NOTE_VERSION_RETENTION_TIERS, thinNoteVersions } from "./notes/noteRetention.js";
export type {
  NoteVersionCheckpoint,
  NoteVersionRetentionTier,
  ThinNoteVersionsInput,
  ThinNoteVersionsResult,
} from "./notes/noteRetention.js";

export {
  CALLOUT_VARIANTS,
  DEFAULT_CALLOUT_VARIANT,
  isCalloutVariant,
  normalizeCalloutVariant,
} from "./notes/noteBlocks.js";
export type { CalloutVariant } from "./notes/noteBlocks.js";

export {
  CLOZE_MASK,
  MAX_CLOZE_NUMBER,
  clozeDeletionEdits,
  clozeNumbers,
  findClozeRuns,
  nextClozeNumber,
  renderClozeCard,
  renderClozeSide,
  splitClozeSegments,
  withClozeDeletion,
} from "./study/clozeText.js";
export type { ClozeEdit, ClozeRun, ClozeSegment } from "./study/clozeText.js";

export {
  PROBLEM_STEP_SEPARATOR,
  renderProblemBack,
  splitProblemSteps,
} from "./study/problemSteps.js";

export { interleavePractice } from "./study/interleave.js";

export { replaceNoteContent } from "./notes/yjsRestore.js";

export { xmlTextContent } from "./notes/yjsText.js";

export {
  BUILTIN_NOTE_TEMPLATE_IDS,
  isBuiltinNoteTemplateId,
} from "./notes/noteTemplateIds.js";
export type { BuiltinNoteTemplateId } from "./notes/noteTemplateIds.js";

export { claimUniqueName, sanitizePathSegment, UNTITLED_NOTE_NAME } from "./imex/archivePaths.js";

export { toCsv } from "./imex/csv.js";
export type { CsvValue } from "./imex/csv.js";

export {
  CSV_COLUMN_ROLES,
  CSV_LIST_SOURCE_ID,
  parseCsv,
  readCsvDueDate,
  readCsvPriority,
  readCsvStatus,
  sniffCsvDelimiter,
  sniffCsvHeader,
  splitCsvTags,
  suggestCsvMapping,
  suggestCsvRoles,
  translateCsvTasks,
} from "./imex/csvImport.js";
export type {
  CsvColumnRole,
  CsvDelimiter,
  CsvDueDateReading,
  CsvListChoice,
  CsvRowDrop,
  CsvRowDropCode,
  CsvTranslateReport,
  CsvTranslateTarget,
  CsvTranslation,
} from "./imex/csvImport.js";

export {
  CSV_FINANCE_ACCOUNT_SOURCE_ID,
  CSV_FINANCE_COLUMN_ROLES,
  currencyMinorDigits,
  finImportKey,
  readCsvFinanceAmount,
  readCsvFinanceDate,
  sniffCsvFinanceAmountFormat,
  sniffCsvFinanceDateFormat,
  suggestCsvFinanceMapping,
  translateCsvFinance,
} from "./imex/csvFinance.js";
export type {
  CsvFinanceAmountFormat,
  CsvFinanceAmountReading,
  CsvFinanceColumnRole,
  CsvFinanceDateFormat,
  CsvFinanceDateReading,
  CsvFinanceFormats,
  CsvFinanceRefusal,
  CsvFinanceRefusalCode,
  CsvFinanceReport,
  CsvFinanceRowDrop,
  CsvFinanceRowDropCode,
  CsvFinanceRowSkip,
  CsvFinanceRowSkipCode,
  CsvFinanceSignConvention,
  CsvFinanceTarget,
  CsvFinanceTranslation,
} from "./imex/csvFinance.js";

export {
  extensionForMime,
  isInlineImageMime,
  isPreviewableMime,
  MIME_FAMILIES,
  mimeFamily,
  sniffMime,
} from "./files/sniff.js";
export type { MimeFamily } from "./files/sniff.js";
export { centerSquareCrop, PROFILE_PICTURE_SIZE } from "./files/squareCrop.js";
export type { CropRect } from "./files/squareCrop.js";

export {
  FIRST_RANK,
  isRank,
  MAX_RANK_SEQUENCE,
  normalizeRank,
  RANK_ALPHABET,
  rankAfter,
  rankBetween,
  rankForInteger,
  rankSequence,
} from "./order/rank.js";

export {
  ARCHIVE_MODULE_IDS,
  ARCHIVE_PROFILE_KINDS,
  base64ToBytes,
  buildExportArchive,
  countProfileModules,
  DATA_FILES,
} from "./imex/exportArchive.js";
export type {
  ArchiveModuleId,
  ArchiveProfileKind,
  ArchiveProfilePicture,
  ExportArchive,
  ExportArchiveInput,
  ExportBinaryEntry,
  ExportCalendarSettings,
  ExportCard,
  ExportDashboardSet,
  ExportDashboardSettings,
  ExportDashboardWidget,
  ExportDeck,
  ExportDocument,
  ExportEvent,
  ExportEventTemplate,
  ExportEventTemplatePayload,
  ExportCanvasBoard,
  ExportCircuit,
  ExportCircuitChassis,
  ExportCircuitPart,
  ExportCircuitWire,
  ExportExam,
  ExportExamTopic,
  ExportFinAccount,
  ExportFinBudget,
  ExportFinCategory,
  ExportFinRecurring,
  ExportFinTransaction,
  ExportFitBodyProfile,
  ExportFitExercise,
  ExportFitFood,
  ExportFitMealItem,
  ExportFitMeasurement,
  ExportFitRoutine,
  ExportFitRoutineItem,
  ExportFitTarget,
  ExportFitWorkout,
  ExportFitWorkoutSet,
  ExportFocusSession,
  ExportHabit,
  ExportHabitEntry,
  ExportNote,
  ExportNoteAttachment,
  ExportNoteCategory,
  ExportNoteFolder,
  ExportNoteTag,
  ExportNoteTagLink,
  ExportNoteTemplate,
  ExportNoteVersion,
  ExportNotification,
  ExportPerson,
  ExportPrivateAttachment,
  ExportPrivateNote,
  ExportPrivateNotes,
  ExportPrivateNoteVersion,
  ExportRenewal,
  ExportReviewLogEntry,
  ExportSettings,
  ExportStudyBlock,
  ExportStudyPlan,
  ExportStudySettings,
  ExportSubject,
  ExportSubjectAttachment,
  ExportSubjectNoteLink,
  ExportTask,
  ExportTaskAttachment,
  ExportTaskDependency,
  ExportTaskList,
  ExportTaskSection,
  ExportTaskTag,
  ExportTaskTagLink,
  ExportTaskTemplate,
  ExportTaskTemplatePayload,
  ExportModuleData,
  ProfileData,
} from "./imex/exportArchive.js";

export { INTERCHANGE_SCHEMA_VERSION, parseImportArchive } from "./imex/importArchive.js";
export type {
  ArchiveRecordType,
  ImportArchiveInput,
  ImportArchiveResult,
  ImportDrop,
  ImportDropReason,
  ImportManifest,
  ImportMode,
  ImportProblem,
  ImportProblemCode,
} from "./imex/importArchive.js";

export {
  documentDuplicateKey,
  eventDuplicateKey,
  finBudgetKey,
  personDuplicateKey,
  planForeignImport,
  IMPORT_DUPLICATE_TYPES,
} from "./imex/foreignImport.js";
export type {
  ForeignImportPlan,
  ForeignImportSource,
  ForeignImportTarget,
  ForeignImportTargetTag,
  ImportDuplicateChoice,
  ImportDuplicateChoices,
  ImportDuplicateGroup,
  ImportDuplicateType,
  ImportModuleCounts,
  ImportPlanReport,
  ImportSkipCode,
  ImportSkipReason,
} from "./imex/foreignImport.js";

export {
  ankiNotetypeKind,
  APKG_SKIP_CODES,
  APKG_SUBJECT_SOURCE_ID,
  canonicalizeCloze,
  freshCardScheduling,
  stripAnkiHtml,
  translateApkg,
} from "./imex/ankiTranslate.js";
export type {
  AnkiFieldText,
  ApkgCard,
  ApkgDeck,
  ApkgNote,
  ApkgNotetype,
  ApkgSkip,
  ApkgSkipCode,
  ApkgSubjectChoice,
  ApkgTranslateReport,
  ApkgTranslateTarget,
  ApkgTranslation,
  ClozeCanonical,
  ClozeCanonicalRefusal,
  ParsedApkg,
} from "./imex/ankiTranslate.js";

export { ProtoWalkError, walkProtoFields } from "./imex/protoWalk.js";
export type { ProtoField } from "./imex/protoWalk.js";

export {
  buildLlmPrompt,
  LLM_DECK_SOURCE_ID,
  LLM_ENVELOPE_KEY,
  LLM_ENVELOPE_VERSION,
  LLM_IMPORT_KINDS,
  LLM_MAX_ANSWER_LENGTH,
  LLM_MAX_RECORDS,
  LLM_MAX_TEXT_LENGTH,
  LLM_PROMPT_LANGUAGES,
  LLM_SUBJECT_SOURCE_ID,
  parseLlmAnswer,
  translateLlmRecords,
} from "./imex/llmPrompts.js";
export type {
  LlmAnswer,
  LlmAnswerProblem,
  LlmAnswerReport,
  LlmCardRecord,
  LlmDeckChoice,
  LlmEventRecord,
  LlmImportKind,
  LlmPromptLanguage,
  LlmRecords,
  LlmSkipReason,
  LlmSkippedRecord,
  LlmTaskRecord,
  LlmTranslateTarget,
  LlmTranslation,
} from "./imex/llmPrompts.js";

export { renderNoteMarkdown } from "./imex/noteMarkdown.js";
export type { NoteMarkdownAttachment, NoteMarkdownContext } from "./imex/noteMarkdown.js";

export { buildNoteUpdate, parseMarkdownNote } from "./imex/markdownImport.js";
export type {
  MarkdownBlock,
  MarkdownInline,
  MarkdownInlineMarks,
  MarkdownTaskItem,
  ParsedMarkdownNote,
} from "./imex/markdownImport.js";

export { buildIcsCalendar } from "./imex/icsExport.js";
export type {
  IcsCalendar,
  IcsCalendarOptions,
  IcsEvent,
  IcsSkippedEvent,
  IcsSkipReason,
} from "./imex/icsExport.js";

export { ICS_IMPORT_SKIP_CODES, parseIcsCalendar, translateIcsEvents } from "./imex/icsImport.js";
export type {
  IcsCalendarProblem,
  IcsImportSkip,
  IcsImportSkipCode,
  IcsParseResult,
  IcsParsedCalendar,
  IcsParsedEvent,
  IcsSkippedComponent,
  IcsTranslateTarget,
} from "./imex/icsImport.js";

export {
  MAX_ARCHIVE_PASSPHRASE_LENGTH,
  MIN_ARCHIVE_PASSPHRASE_LENGTH,
  normalizeArchivePassphrase,
  validateArchivePassphrase,
} from "./imex/archivePassphrase.js";
export type { ArchivePassphraseProblem } from "./imex/archivePassphrase.js";

export {
  ARCHIVE_CHUNK_BYTES,
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_MAGIC,
  ARCHIVE_MAX_HEADER_BLOCK_BYTES,
  ARCHIVE_NONCE_PREFIX_BYTES,
  ARCHIVE_SALT_BYTES,
  ARCHIVE_TAG_BYTES,
  ArchiveDecryptError,
  ArchiveFormatError,
  createArchiveReader,
  createArchiveWriter,
  parseArchiveHeader,
  parseFramePrefix,
} from "./imex/archiveContainer.js";
export type {
  ArchiveHeader,
  ArchiveKdfParams,
  ArchiveReader,
  ArchiveWriter,
  ArchiveWriterOptions,
} from "./imex/archiveContainer.js";

export { openArchivePlaintext } from "./imex/archivePlaintext.js";
export type { ArchiveByteSource, ArchivePlaintext } from "./imex/archivePlaintext.js";

export {
  MAX_SPAN_DAYS,
  MIN_TIMED_MINUTES,
  MINUTES_PER_DAY,
  dayKeyToUtcMs,
  daySpanKeys,
  isValidDayKey,
  isoWeekNumber,
  layoutMonthBars,
  layoutTimedColumns,
  monthGridDays,
  monthKeyOf,
  shiftDayKey,
  shiftMonthKey,
  weekDayKeys,
  weekOpeningDayKey,
} from "./calendar/calendarGrid.js";
export type {
  DayKey,
  MonthBar,
  MonthGridDay,
  MonthKey,
  SpanItem,
  TimedColumn,
  TimedItem,
  WeekStart,
} from "./calendar/calendarGrid.js";

export {
  TIME_GRID_DRAG_THRESHOLD_PX,
  TIME_GRID_MAX_END_MINUTES,
  TIME_GRID_MIN_EVENT_MINUTES,
  TIME_GRID_SNAP_MINUTES,
  exceedsTimeGridDragThreshold,
  resolveTimeGridColumn,
  resolveTimeGridMove,
  resolveTimeGridResize,
  snapTimeGridMinutes,
  timeGridPixelsToMinutes,
} from "./calendar/timeGridDrag.js";
export type { TimeGridSpan } from "./calendar/timeGridDrag.js";

export { ageAtOccurrence, birthdayOccurrencesInRange } from "./calendar/birthdays.js";
export type { BirthdayPerson } from "./calendar/birthdays.js";

export {
  DEFAULT_OCCURRENCE_LIMIT,
  MAX_RECURRENCE_COUNT,
  MAX_RECURRENCE_INTERVAL,
  nextOccurrenceDate,
  occurrenceDatesInRange,
  serializeRecurrenceRule,
  validateRecurrenceRule,
} from "./recurrence/recurrence.js";
export type {
  RecurrenceEnd,
  RecurrenceFreq,
  RecurrenceOrdinal,
  RecurrenceRule,
  RecurrenceWeekday,
} from "./recurrence/recurrence.js";

export {
  buildSearchSnippet,
  DEFAULT_SNIPPET_RADIUS,
  foldSearchText,
  foldWithOffsets,
} from "./search/searchText.js";
export type { FoldedText, SearchSnippet } from "./search/searchText.js";

export {
  MAX_SEARCH_TERMS,
  MAX_TERM_LENGTH,
  parseSearchQuery,
  SEARCH_KINDS,
  SEARCH_KIND_PREFIXES,
  toFtsMatchExpression,
} from "./search/searchQuery.js";
export type {
  ParsedSearchQuery,
  SearchDueFilter,
  SearchDuePreset,
  SearchKind,
} from "./search/searchQuery.js";

export {
  applySearchOperators,
  foldSearchTag,
  resolveDueRange,
  SEARCH_DUE_WEEK_DAYS,
  searchContextDay,
} from "./search/searchOperators.js";
export type {
  SearchDayRange,
  SearchOperatorFilters,
  SearchTagMatch,
} from "./search/searchOperators.js";

export {
  buildSearchTagFacets,
  countSearchKinds,
  MAX_TAG_FACETS,
} from "./search/searchFacets.js";
export type {
  FacetTag,
  FacetTagLink,
  SearchFacetHit,
  SearchKindCount,
  SearchTagFacet,
  TagFacetSource,
} from "./search/searchFacets.js";

export {
  KIND_PRIOR,
  rankSearchResults,
  RECENCY_DECAY_DAYS,
  RECENCY_WEIGHT,
  RELEVANCE_WEIGHT,
  TITLE_EXACT_BOOST,
  TITLE_PREFIX_BOOST,
} from "./search/searchRanking.js";
export type { RankedSearchHit, SearchHit } from "./search/searchRanking.js";

export { MAX_RELATIVE_DAYS, parseQuickAddDate } from "./tasks/quickAddDate.js";
export type { QuickAddDateMatch } from "./tasks/quickAddDate.js";

export {
  compareSmartListTasks,
  matchesSmartList,
  selectSmartList,
  SMART_LIST_IDS,
  splitZavrseno,
  TASK_ARCHIVE_AFTER_DAYS,
} from "./tasks/taskSmartLists.js";
export type { SmartListContext, SmartListId, SmartListTask } from "./tasks/taskSmartLists.js";

export {
  isEmptyTaskViewConfig,
  normalizeTaskViewConfig,
  parseStoredTaskViewConfig,
  serializeTaskViewConfig,
  TASK_VIEW_FILTER_PRIORITIES,
  TASK_VIEW_FILTER_STATUSES,
  TASK_VIEW_KANBAN_GROUPS,
  TASK_VIEW_SORT_DIRECTIONS,
  TASK_VIEW_SORT_FIELDS,
  taskViewFilterSpecs,
  validateTaskViewConfig,
} from "./tasks/taskViewConfig.js";
export type {
  TaskCalendarViewSettings,
  TaskKanbanViewSettings,
  TaskSortedViewSettings,
  TaskViewConfig,
  TaskViewFilterPriority,
  TaskViewFilterStatus,
  TaskViewFilters,
  TaskViewKanbanGroup,
  TaskViewSort,
  TaskViewSortDirection,
  TaskViewSortField,
} from "./tasks/taskViewConfig.js";

export {
  PrivSealError,
  derivePrivBlobKey,
  openPrivBlob,
  openPrivNote,
  sealPrivBlob,
  sealPrivNote,
} from "./priv/privEnvelope.js";
export type { PrivAttachmentRef, PrivNoteEnvelope } from "./priv/privEnvelope.js";

export { buildPrivIndex, searchPrivIndex } from "./priv/privIndex.js";
export type { PrivIndex, PrivIndexEntry, PrivIndexNote } from "./priv/privIndex.js";

export {
  chordAccelerator,
  chordFromEvent,
  findChordConflict,
  formatChord,
  isBindableChord,
  isModifierKey,
  matchesChord,
  MODULE_NAV_CONFLICT,
  MODULE_NAV_MAX,
  moduleNavChord,
  moduleNavPosition,
  normalizeChordKey,
  parseChord,
} from "./shortcuts/shortcuts.js";
export type { Chord, ChordEvent } from "./shortcuts/shortcuts.js";
export {
  areaPath,
  extent,
  heatmapWeeks,
  linePath,
  niceStep,
  niceTicks,
  scaleLinear,
} from "./charts/geometry.js";
export type { Point } from "./charts/geometry.js";

// --- ELEC: the electronics component model and catalogue (slice E1) ---------
//
// `validateComponent` is exported alongside the data because it is what makes a
// user-defined component a first-class one: the same gate runs over what we ship
// and over what the user types, so a part they add is refused for the same
// reasons and drawn by the same canvas. See ADR-085.
export {
  BUS_KINDS,
  COMPONENT_KINDS,
  PIN_FUNCTIONS,
  validateComponent,
} from "./electronics/component.js";
export type {
  Bus,
  BusKind,
  ComponentDef,
  ComponentKind,
  ComponentProblem,
  ComponentProblemCode,
  Pin,
  PinFunction,
  ValueUnit,
} from "./electronics/component.js";
export {
  catalogueComponent,
  COMPONENT_CATALOGUE,
  componentsOfKind,
} from "./electronics/catalogue.js";
export {
  circuitProblems,
  MAX_PART_COORDINATE,
  MAX_CIRCUIT_NAME_LENGTH,
  MAX_CIRCUIT_NOTES_LENGTH,
  MAX_PART_LABEL_LENGTH,
  PART_ROTATIONS,
  validateCircuitHeader,
  validatePart,
  validateWire,
  WIRE_COLOURS,
} from "./electronics/circuit.js";
export type {
  Circuit,
  CircuitHeader,
  CircuitPart,
  CircuitProblem,
  CircuitProblemCode,
  CircuitWire,
  PartRotation,
  WireColour,
  WireEnd,
} from "./electronics/circuit.js";
// ADR-085 slice E4c — the machine the circuit is the electronics of. The form
// that asks for the nine numbers, the IPC layer that re-checks them and the
// generator that turns them into a URDF all read these, so unlike `wiring.ts`
// and the two generators there is nothing here worth keeping to a reachability
// set: a bound the screen cannot name is a bound the screen cannot enforce, and
// then „<= 500 cm" is written down twice and drifts.
//
// `mountOrigin` is deliberately NOT here. Where a named face lands in metres is
// a fact about the URDF format, and a caller outside the generator that wanted
// it would be a second generator.
export {
  CHASSIS_LENGTHS,
  CHASSIS_MASSES,
  CHASSIS_MAX_CM,
  CHASSIS_MAX_GRAMS,
  CHASSIS_SHAPES,
  chassisProblems,
  isChassisShape,
  isMount,
  MOUNTS,
} from "./electronics/chassis.js";
export type {
  Chassis,
  ChassisField,
  ChassisLength,
  ChassisMass,
  ChassisShape,
  Mount,
} from "./electronics/chassis.js";
// ADR-085 slice E3. `buildNets` is exported beside the rules rather than kept
// private to them, because it is the derived fact E4 (sketch generation) and E5
// (simulation) are specified to consume — §2's „E3 comes before E4 and E5". A
// generator that re-derived connectivity would be a second rules engine, and
// the day the two disagreed the user would get code contradicting the warning
// on their own screen.
export { buildNets } from "./electronics/nets.js";
export type { CircuitNets, Net, PinRef } from "./electronics/nets.js";
export { circuitRules } from "./electronics/rules.js";
export type { RuleCode, RuleFinding, RuleSeverity, RuleValue } from "./electronics/rules.js";
// ADR-085 slice E4. Pure, and deliberately so: the main process calls it and
// writes the result at a path the user picks in a native dialog, exactly as the
// `.ics` export does — the renderer never supplies a filesystem path.
//
// Two artefacts, one derivation. `wiring.ts` answers what the board is wired to
// and both generators print it in their own dialect; it is not exported,
// because it is the shape of the answer rather than the answer, and a caller
// that reached for it would be a third generator nobody had noticed writing.
//
// `generateCode` is the door the app goes through, and it is the ONLY door:
// the choice between the two artefacts is one field on the board, so a screen
// that called `generateSketch` by name would be a screen that had decided what
// a Raspberry Pi is. Neither generator is exported for the same reason
// `wiring.ts` is not — the rule is worth more as a reachability set than as
// this paragraph. Their result TYPES are exported, because the dialog that
// renders a `Sketch` and the one that renders a `RosPackage` are one component
// switching on `GeneratedCode`'s tag.
export { generateCode } from "./electronics/code.js";
export type { CodeRefusal, GeneratedCode, GeneratedLanguage } from "./electronics/code.js";
// E6 needs the package itself and not only its type: the runner's workspace is
// WRITTEN from these files, where the export dialog writes them to a directory
// the user picked. One generator, two destinations.
export { generateRosPackage } from "./electronics/ros.js";
export type { Sketch, SketchConnection, SketchRefusal } from "./electronics/sketch.js";
export type {
  RosFile,
  RosPackage,
  RosPin,
  RosRefusal,
  RosRole,
  RosSkip,
  RosSkipped,
} from "./electronics/ros.js";
// The URDF's own result types, for the same reason and no more: the dialog
// renders what the description contains and what it left out, and the strings
// table keys its „why" column on `UrdfSkip`. `generateUrdf` itself stays
// unexported beside the other two generators — a `RosPackage` already carries
// its `robot`, and a caller that generated one separately would be generating a
// model of a machine nobody had asked the package for.
export type {
  RobotDescription,
  UrdfRefusal,
  UrdfSensor,
  UrdfSkip,
  UrdfSkipped,
} from "./electronics/urdf.js";
// ADR-085 slice E5 — the bench. Three functions rather than one door, because
// unlike the generators these are not one artefact produced once: the model is
// built when the panel opens, and a frame is produced for every tick the clock
// advances. `channelValueAt` is the third, so a preview strip can be drawn
// without standing up a whole frame — the same closed form and the same
// quantization, asked one channel at a time. `waveAt` is deliberately NOT here:
// a caller with a raw wave value has skipped the rule that says what the channel
// can carry.
//
// The module's own bounds and defaults stay inside it. They are asserted by its
// tests, which import the file directly; putting them here would widen the
// package's API by three constants nothing imports.
export { buildSimBench, channelValueAt, simulateFrame } from "./electronics/simulate.js";
export type {
  SimBench,
  SimChannel,
  SimFlow,
  SimFrame,
  SimModel,
  SimRange,
  SimRefusal,
  SimSkip,
  SimSkipped,
  SimUnit,
  SimValue,
  SimWave,
} from "./electronics/simulate.js";
// ADR-085 slice E6 — the external runner's CLOSED TABLE. This is the one export
// in this file that is a security boundary rather than an API: the command
// lines `colcon`, `ros2`, `docker` and `wsl.exe` are ever invoked with are
// written down in `runner.ts` and nowhere else, and `buildCommand` is the only
// way to obtain one. The renderer imports it for the same reason main does —
// the consent screen must print the command that will actually run, and the
// only way for those to be one string is for both sides to call this.
//
// `RUNNER_IMAGE` goes with it because the consent screen names the image, and
// a screen that spelled it out again would be a second pin that could drift
// from the one that runs.
export {
  appendLog,
  buildCommand,
  CONTAINER_WORKSPACE,
  containerName,
  containerProbe,
  containerRemove,
  EMPTY_LOG,
  LOG_CAP_BYTES,
  logText,
  outputText,
  readDistroList,
  readStatusProbe,
  rosDistroIn,
  runnerTarget,
  RUNNER_IMAGE,
  RUNNER_PROBES,
  RUNNER_PROFILES,
  wslProbe,
} from "./electronics/runner.js";
export type {
  ProbeResult,
  RunnerLog,
  RunnerPlan,
  RunnerProfileId,
  RunnerRefusal,
  RunnerTarget,
} from "./electronics/runner.js";

/**
 * ADR-086 — „Priprema": the signals a first run collects, the lexicon that
 * reads a trade out of a sentence, and the plan that turns both into one
 * person's Nexus.
 */
export {
  KEEPS,
  TEMPOS,
  WEEK_SHAPES,
  keeps,
  tempoOf,
  tradePacks,
  weekShapes,
} from "./profile/signals.js";
export type { Keep, Signal, Tempo, WeekShape } from "./profile/signals.js";
export { TRADE_ACTIVITIES, TRADE_STEMS, recognizeTrades } from "./profile/lexicon.js";
export type { TradeActivity, TradeMatch, TradeStem } from "./profile/lexicon.js";
export { buildProfilePlan } from "./profile/plan.js";
export type {
  PlanBoardEntry,
  PlanCalendarView,
  PlanReason,
  ProfilePlan,
} from "./profile/plan.js";

// --- LIBRARY (items, passes, thoughts, collections, migration 072) ----------
//
// Pure logic only: the vocabulary and its bounds (kinds, statuses, ratings,
// years, the length caps), the validators the store and the archive reader both
// call, the title fold that decides whether a curated list's entry and a work a
// person already logged are the SAME work, the four orders, the year's
// statistics, the shape of a bundled list, and the versioned value the profile
// archive will carry.
//
// The ROW SHAPES live here too (`LibraryItem`, `LibraryPass`, …), deliberately:
// the sorters, the statistics and the archive validator all read them, and one
// shape that cannot drift from itself is worth more than a second copy in
// `@nexus/db` — the store returns exactly these values (`electronics`'
// `Chassis`, one module over).
export {
  LIBRARY_EXPORT_VERSION,
  LIBRARY_MAX_IMPORT_ROWS,
  libraryExportVersion,
  validateLibraryExport,
} from "./library/export.js";
export type { LibraryExportV1 } from "./library/export.js";
export {
  LIBRARY_COLLATOR,
  LIBRARY_SORT_KEYS,
  compareLibraryItems,
  compareLibraryItemsBy,
  sortLibraryItems,
} from "./library/sort.js";
export type { LibrarySortableItem, LibrarySortKey } from "./library/sort.js";
export { LIBRARY_MAX_SUGGESTION_ITEMS, validateSuggestedCollection } from "./library/suggested.js";
export type { SuggestedCollectionItemV1, SuggestedCollectionV1, SuggestedTitle } from "./library/suggested.js";
export { libraryYearStats } from "./library/stats.js";
export type { LibraryStatsItem, LibraryStatsPass, LibraryYearStats } from "./library/stats.js";
export { normalizeLibraryTitle, titleMatchKey } from "./library/title.js";
export { collectionProgress } from "./library/collections.js";
export type {
  LibraryCollection,
  LibraryCollectionItem,
  LibraryCollectionProgress,
} from "./library/collections.js";
export {
  LIBRARY_KINDS,
  LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH,
  LIBRARY_MAX_COLLECTION_NAME_LENGTH,
  LIBRARY_MAX_COUNT,
  LIBRARY_MAX_COVER_BYTES,
  LIBRARY_MAX_CREATORS,
  LIBRARY_MAX_CREATOR_LENGTH,
  LIBRARY_MAX_RATING,
  LIBRARY_MAX_SUMMARY_LENGTH,
  LIBRARY_MAX_TAGS,
  LIBRARY_MAX_TAG_LENGTH,
  LIBRARY_MAX_THOUGHT_LENGTH,
  LIBRARY_MAX_TITLE_LENGTH,
  LIBRARY_MAX_YEAR,
  LIBRARY_MIN_RATING,
  LIBRARY_MIN_YEAR,
  LIBRARY_PROGRESS_FIELDS,
  LIBRARY_STATUSES,
  deriveLibraryRatingFromPass,
  deriveLibraryStatusFromPass,
  isLibraryCount,
  isLibraryDay,
  isLibraryKind,
  isLibraryRating,
  isLibraryReadPages,
  isLibraryStatus,
  isLibraryTimestamp,
  isLibraryYear,
  isWikidataId,
  serializeLibraryList,
  validateLibraryCreators,
  validateLibraryProgress,
  validateLibraryTags,
} from "./library/item.js";
export type {
  LibraryCover,
  LibraryItem,
  LibraryKind,
  LibraryPass,
  LibraryPassOutcome,
  LibraryProgress,
  LibraryProgressField,
  LibraryStatus,
  LibraryThought,
} from "./library/item.js";

/**
 * CULTURE - the culture corner: what you went to see, what you listened to, and
 * the music you own. Stage 1 is this logic and the store behind it; the page
 * arrives on the module kit.
 *
 * Three files, split by what a caller is asking. `kinds.ts` is the VOCABULARY -
 * the ten visit kinds, the four listening kinds, the 1-10 rating scale and the
 * five audio formats the library accepts - and it is exported because the store
 * refuses a value outside those lists and stage 2's pickers have to offer
 * exactly them; one list, read by both, is the only way a picker cannot offer a
 * kind the schema rejects. `stats.ts` answers a PERIOD (the caller passes the
 * rows a store read returned, which is what makes the same function answer for
 * a month or for everything) and `format.ts` is the two durations the page
 * draws.
 */
export {
  CULTURE_AUDIO_MIMES,
  MAX_CULTURE_RATING,
  MIN_CULTURE_RATING,
  MUSIC_LOG_KINDS,
  VISIT_KINDS,
  isCultureAudioMime,
  isCultureRating,
  isMusicLogKind,
  isVisitKind,
} from "./culture/kinds.js";
export type { CultureAudioMime, MusicLogKind, VisitKind } from "./culture/kinds.js";
export { culturePlaylistTotalMs, formatCultureDuration } from "./culture/format.js";
export type { CultureDurationSource } from "./culture/format.js";
export {
  DEFAULT_CULTURE_TOP_ARTISTS,
  MAX_CULTURE_TOP_ARTISTS,
  summarizeCulture,
} from "./culture/stats.js";
export type {
  CultureArtistCount,
  CultureEntrySource,
  CultureKindCount,
  CultureStats,
  CultureStatsInput,
  CultureStatsOptions,
  CultureTrackPlaySource,
  CultureVenueCount,
  CultureVisitSource,
} from "./culture/stats.js";

/**
 * CAR — what a car was, what it is due for, and what it costs (stage 1: the
 * logic and the data, no UI). The vocabularies in `./car/vehicle.js` are the
 * module's own language and migration 074's CHECKs spell out the same sets, so
 * everything that reads a fuel type, a distance unit, a service category or a
 * fault status reads it from here.
 */
export {
  CAR_COST_CATEGORIES,
  DISTANCE_UNITS,
  FAULT_STATUSES,
  FUEL_TYPES,
  KM_PER_MILE,
  MIN_VEHICLE_YEAR,
  SERVICE_CATEGORIES,
  VIN_LENGTH,
  fromKilometres,
  fuelQuantityUnit,
  normalizeVin,
  toKilometres,
} from "./car/vehicle.js";
export type {
  CarCostCategory,
  DistanceUnit,
  FaultStatus,
  FuelQuantityUnit,
  FuelType,
  ServiceCategory,
} from "./car/vehicle.js";

export { addMonthsClamped, dayNumber, daysBetween } from "./car/dates.js";

export {
  checkOdometerReading,
  currentSegment,
  estimateOdometerForDate,
  segmentForDate,
} from "./car/odometer.js";
export type { OdometerPoint, OdometerVerdict } from "./car/odometer.js";

export { fuelConsumption } from "./car/consumption.js";
export type {
  ConsumptionSegment,
  FuelConsumption,
  FuelFill,
  OverallConsumption,
} from "./car/consumption.js";

export { whatIsDue } from "./car/due.js";
export type {
  DueInput,
  DueItem,
  DueStatus,
  DueThresholds,
  ServiceIntervalSpec,
  ServiceRecord,
} from "./car/due.js";

export {
  costPerDistance,
  distanceCovered,
  fuelCostMinor,
  totalsByCategory,
  totalsByMonth,
  vehicleCosts,
} from "./car/costs.js";
export type {
  CarCost,
  CategoryTotal,
  DistanceCost,
  FuelCostFields,
  MonthlyTotal,
  ServiceCostFields,
} from "./car/costs.js";

// --- PANTRY (migration 075) -------------------------------------------------
//
// What is at home and when it expires, as pure arithmetic: the effective expiry
// (the earlier of the printed date and „opened + use within N days“), the
// expiry verdict against a ladder the caller supplies, the shopping list, and
// the waste report. The vocabularies and the three validators are exported
// beside it for FIN's reason — stage 2's IPC layer must refuse a barcode, a unit
// or a category by the SAME rule the store does, and one definition is the only
// way the wire and the store cannot quietly disagree about what a minimum
// quantity is.
//
// What is deliberately NOT here: anything that computes a dose. `doseNote` is
// free text this module never parses.
export {
  MAX_PANTRY_DOSE_NOTE_LENGTH,
  MAX_PANTRY_LOCATION_NAME_LENGTH,
  MAX_PANTRY_NAME_LENGTH,
  MAX_PANTRY_NOTES_LENGTH,
  MAX_PANTRY_QUANTITY,
  MAX_PANTRY_USE_WITHIN_DAYS,
  PANTRY_BARCODE_LENGTHS,
  PANTRY_CATEGORIES,
  PANTRY_LOG_REASONS,
  PANTRY_UNITS,
  isPantryBarcode,
  isPantryCategory,
  isPantryLogReason,
  isPantryUnit,
  validatePantryChange,
  validatePantryItem,
  validatePantryLocation,
} from "./pantry/pantryItem.js";
export type {
  PantryCategory,
  PantryChange,
  PantryItemFields,
  PantryLogReason,
  PantryProblem,
  PantryProblemCode,
  PantryUnit,
} from "./pantry/pantryItem.js";
export {
  PantryInputError,
  effectiveExpiry,
  shoppingList,
  stockStatus,
  wasteReport,
} from "./pantry/pantryStock.js";
export type {
  PantryEffectiveExpiry,
  PantryExpirySource,
  PantryExpiryStatus,
  PantryLocationRef,
  PantryShoppingGroup,
  PantryShoppingLine,
  PantryStockItem,
  PantryStockStatus,
  PantryWasteEntry,
  PantryWasteInput,
  PantryWasteItem,
  PantryWasteRow,
} from "./pantry/pantryStock.js";

/**
 * COOK (the cookbook, stage 1: the logic and no UI). A recipe's units and their
 * exact conversions, the line shape an ingredient has, scaling, the typed-line
 * parser, per-serving nutrition off the same food table the fitness log reads,
 * and the shopping list. Stage 2's page and IPC sit on this and own none of it.
 */
export {
  COUNT_UNITS,
  INGREDIENT_UNITS,
  MASS_UNITS,
  VOLUME_UNITS,
  compatibleUnits,
  convertQuantity,
  isIngredientUnit,
  unitFamily,
} from "./cookbook/units.js";
export type {
  CountUnit,
  IngredientUnit,
  MassUnit,
  UnitFamily as CookbookUnitFamily,
  VolumeUnit,
} from "./cookbook/units.js";
export { roundToKitchen, scaleIngredients } from "./cookbook/ingredient.js";
export type { IngredientLine, ScalableIngredient } from "./cookbook/ingredient.js";
export { parseIngredientLine } from "./cookbook/parse.js";
export { nutritionPerServing } from "./cookbook/nutrition.js";
export type {
  NutritionLine,
  RecipeNutrition,
  UncountedIngredient,
  UncountedReason,
} from "./cookbook/nutrition.js";
export { buildShoppingList } from "./cookbook/shopping.js";
export type { ShoppingLine } from "./cookbook/shopping.js";
export {
  COOKBOOK_COURSES,
  PUBLIC_DOMAIN_LICENCE_ID,
  RECIPE_SOURCES,
  isRecipeLicenceId,
} from "./cookbook/recipe.js";
export type {
  CookbookCourse,
  RecipeLicence,
  RecipeSource,
  RecipeStep,
} from "./cookbook/recipe.js";

// --- RECORDER (voice and video diary, migration 077) ------------------------
//
// The capture side is `MediaRecorder`, so the two kinds and the four mime
// strings it can actually produce are a CLOSED list declared here rather than a
// pattern: the store refuses anything else on the way in, and stage 2 must
// check the mime the browser reports after `start()` against the same list —
// one definition, or the wire and the store disagree about what a recording is.
export {
  RECORDING_KINDS,
  RECORDING_MIME_TYPES,
  isRecordingMime,
  recordingKindForMime,
} from "./recorder/recording.js";
export type { RecordingKind, RecordingMime } from "./recorder/recording.js";
export { formatRecordingDuration } from "./recorder/duration.js";
export {
  diaryMonthSummary,
  groupByCreationDay,
  groupByDiaryDate,
  recordingStorageSummary,
} from "./recorder/recordingGroups.js";
export type {
  RecorderEntry,
  RecorderMonthSummary,
  RecordingGroup,
  RecordingStorageSummary,
  RecordingTotals,
} from "./recorder/recordingGroups.js";

// --- EMERGENCY (the emergency card, migration 078) --------------------------
//
// The card POINTS at People and Documents instead of copying them, so a person
// or a document either module has lost comes back from `buildCardModel` as a
// MISSING row rather than quietly disappearing from the page. The model returns
// the page in print order with the section headings left to the renderer's own
// copy, and `cardCompleteness` names the recommended fields still unanswered.
export {
  ALLERGY_SEVERITIES,
  BLOOD_TYPES,
  BLOOD_TYPE_UNKNOWN,
  CARD_DOCUMENT_MODES,
  CARD_LANGUAGES,
  isAllergySeverity,
  isBloodType,
  isCardDocumentMode,
  isCardLanguage,
  isCardPrintLanguage,
  isOrganDonor,
  MAX_CARD_ALLERGY_LABEL_LENGTH,
  MAX_CARD_CONDITION_LENGTH,
  MAX_CARD_CONTACTS,
  MAX_CARD_CONTACT_NAME_LENGTH,
  MAX_CARD_CONTACT_RELATION_LENGTH,
  MAX_CARD_DOCUMENTS,
  MAX_CARD_DOCTOR_NAME_LENGTH,
  MAX_CARD_FULL_NAME_LENGTH,
  MAX_CARD_INSURANCE_NUMBER_LENGTH,
  MAX_CARD_LIST_ITEMS,
  MAX_CARD_MEDICATION_DOSE_LENGTH,
  MAX_CARD_MEDICATION_NAME_LENGTH,
  MAX_CARD_NOTES_LENGTH,
  MAX_CARD_PHONE_LENGTH,
  ORGAN_DONOR_CHOICES,
  serializeCardAllergies,
  serializeCardConditions,
  serializeCardMedications,
  validateCardAllergies,
  validateCardConditions,
  validateCardMedications,
} from "./emergency/cardFields.js";
export type {
  AllergySeverity,
  BloodType,
  CardAllergy,
  CardBloodType,
  CardDocumentMode,
  CardLanguage,
  CardMedication,
  CardPrintLanguage,
  OrganDonor,
} from "./emergency/cardFields.js";
export { buildCardModel } from "./emergency/cardModel.js";
export type {
  CardBlock,
  CardBlockKey,
  CardContactSource,
  CardDocument,
  CardDocumentSource,
  CardModel,
  CardPass,
  CardPerson,
  EmergencyCardFields,
  EmergencyCardSource,
  EmergencyCardWithContacts,
  ResolvedCardContact,
  ResolvedCardDocument,
} from "./emergency/cardModel.js";
export { cardCompleteness } from "./emergency/cardCompleteness.js";
export type { CardGap } from "./emergency/cardCompleteness.js";

// --- CALC (the calculator's engine, no UI) -----------------------------------
//
// The expression engine over mathjs, narrowed to the boundary the security page
// asks for: `engine.ts`'s header says what is disabled and why, and `limits.ts`
// carries the bounds that keep a typed expression from becoming a way to make
// the process work forever. Two decisions a reader should not have to
// rediscover:
//
//  - **`display` is not `value`.** `value` is mathjs's own lexical form and is
//    what the session stores; `display` is the reader's, and `display.ts` is the
//    pure function that produces it from a locale.
//  - **A session is plain JSON.** `session.ts` holds variables as the TEXT of
//    their values and user functions as a signature plus a body, which is what
//    lets `@nexus/db` store one and validate it without mathjs.
export {
  CALCULATOR_DISPLAY_PRECISION,
  CALCULATOR_LOCALES,
  DEFAULT_CALCULATOR_FORMAT,
  formatCalculatorDisplay,
} from "./calculator/display.js";
export type { CalculatorFormatOptions, CalculatorLocale } from "./calculator/display.js";
export {
  BIG_NUMBER_PRECISION,
  CALCULATOR_ANGLE_MODES,
  CALCULATOR_CODES,
  CALCULATOR_PRECISIONS,
  createCalculatorEngine,
} from "./calculator/engine.js";
export type {
  CalculatorAngleMode,
  CalculatorCode,
  CalculatorEngine,
  CalculatorEvaluateOptions,
  CalculatorFailure,
  CalculatorOutcome,
  CalculatorPrecision,
  CalculatorProgrammerView,
  CalculatorSuccess,
} from "./calculator/engine.js";
export {
  MAX_EXPRESSION_LENGTH,
  MAX_FACTORIAL_ARGUMENT,
  MAX_MATRIX_ELEMENTS,
} from "./calculator/limits.js";
export {
  CALCULATOR_SESSION_VERSION,
  MAX_CALCULATOR_FUNCTION_PARAMS,
  MAX_CALCULATOR_NAME_LENGTH,
  MAX_CALCULATOR_SESSION_FUNCTIONS,
  MAX_CALCULATOR_SESSION_VARIABLES,
  MAX_CALCULATOR_VALUE_LENGTH,
  emptyCalculatorSession,
  parseCalculatorSession,
  parseCalculatorSessionText,
  serializeCalculatorSession,
} from "./calculator/session.js";
export type { CalculatorFunctionDefinition, CalculatorSession } from "./calculator/session.js";

// --- GAMES (the arcade: Minesweeper and Blocks, migration 080) --------------
//
// Two engines, both pure, both playable from an input log: a seeded source is
// handed in, every clock reading is handed in, and the whole game is a VALUE on
// the way out. `games/random.ts` carries the argument for the source, and each
// engine's own header carries its rules — including why the falling-blocks game
// is called Blocks and drawn by us rather than by the trademarked game's look.
export { createSeededRandom, randomBelow, shuffled } from "./games/random.js";
export type { SeededRandom } from "./games/random.js";

export {
  MINESWEEPER_MAX_COLUMNS,
  MINESWEEPER_MAX_ROWS,
  MINESWEEPER_MIN_COLUMNS,
  MINESWEEPER_MIN_FREE_CELLS,
  MINESWEEPER_MIN_MINES,
  MINESWEEPER_MIN_ROWS,
  MINESWEEPER_PRESETS,
  MINESWEEPER_PRESET_IDS,
  chordCell,
  createMinesweeper,
  cycleMark,
  minesweeperElapsedMs,
  minesweeperFaces,
  minesweeperFromMines,
  minesweeperIndex,
  minesweeperRemainingMines,
  minesweeperVariant,
  revealCell,
  validateMinesweeperConfig,
} from "./games/minesweeper/minesweeper.js";
export type {
  MinesweeperCell,
  MinesweeperConfig,
  MinesweeperConfigResult,
  MinesweeperFace,
  MinesweeperMark,
  MinesweeperOptions,
  MinesweeperPresetId,
  MinesweeperState,
  MinesweeperStatus,
  MinesweeperVariant,
} from "./games/minesweeper/minesweeper.js";

export { BLOCKS_PIECE_IDS, pieceCells, pieceFrame } from "./games/blocks/pieces.js";
export type { BlockCell, BlockPieceId } from "./games/blocks/pieces.js";
export {
  BLOCKS_BOARD_CAPACITY,
  BLOCKS_CLEAR_SCORES,
  BLOCKS_COLUMNS,
  BLOCKS_GRAVITY_BASE_MS,
  BLOCKS_GRAVITY_MIN_MS,
  BLOCKS_GRAVITY_STEP_MS,
  BLOCKS_HARD_DROP_POINTS,
  BLOCKS_LINES_PER_LEVEL,
  BLOCKS_LOCK_DELAY_MS,
  BLOCKS_MAX_LOCK_RESETS,
  BLOCKS_PREVIEW_COUNT,
  BLOCKS_ROWS,
  BLOCKS_SOFT_DROP_POINTS,
  BLOCKS_TICK_MS,
  activeCells,
  blocksFrom,
  createBlocks,
  ghostCells,
  gravityIntervalMs,
  levelForLines,
  lineScore,
  step,
} from "./games/blocks/blocks.js";
export type {
  BlocksInput,
  BlocksPiece,
  BlocksSetup,
  BlocksState,
  BlocksStatus,
} from "./games/blocks/blocks.js";

// --- GAMES: cards (stage 1 — the engines, no UI) -----------------------------
//
// Three solitaires in one area, because they are one family: one card model, one
// shuffled-deal contract, one action log with undo in it, and one answer to „may
// this card go home by itself". The engines are pure — no clock, no randomness
// but the seed they are handed, no storage — so the deal is a function of
// `(variant, seed)` and a saved game is three fields long.
//
// `CARD_GAME_VARIANTS` and the two seed predicates are exported beside the
// engines rather than kept inside them, on `finance/money.ts`'s terms: the store's
// enum check, stage 2's pickers and the engines must refuse by the SAME rule, or
// the wire and the store quietly disagree about what a variant is.
export {
  CARD_CODES,
  cardCode,
  cardFromCode,
  colourOf,
  deckOf,
  isCard,
  RANKS,
  rankBelow,
  sameCard,
  standardDeck,
  SUITS,
} from "./games/cards/card.js";
export type { Card, CardColour, Rank, Suit } from "./games/cards/card.js";
export { shuffle } from "./games/cards/shuffle.js";
export type { RandomSource } from "./games/cards/shuffle.js";
export { autoplaySafe, autoplaySafeCards } from "./games/cards/autoplay.js";
export {
  isGameLogEntry,
  isUndoEntry,
  logCanUndo,
  logMoves,
  logPushMove,
  logPushUndo,
  UNDO_ENTRY,
} from "./games/cards/log.js";
export type { GameLogEntry, GameUndoEntry } from "./games/cards/log.js";
export {
  CARD_GAMES,
  CARD_GAME_VARIANTS,
  CardGameError,
  FREE_CELL_MAX_DEAL,
  FREE_CELL_MIN_DEAL,
  IllegalMoveError,
  isCardGameId,
  isCardGameVariant,
  isCardSeed,
  isFreeCellDeal,
  MAX_CARD_SEED,
} from "./games/cards/game.js";
export type {
  CardGameId,
  CardGameRefusal,
  CardGameRefusalCode,
  CardGameReplay,
  CardGameVariant,
  FreeCellVariant,
  KlondikeVariant,
  SpiderVariant,
} from "./games/cards/game.js";
export {
  applyKlondike,
  canUndoKlondike,
  dealKlondike,
  hasKlondikeMoves,
  isKlondikeEntry,
  isKlondikeMove,
  isKlondikeMoveLegal,
  isKlondikeWon,
  KLONDIKE_COLUMNS,
  KLONDIKE_SCORE,
  klondikeAllFaceUp,
  klondikeAutoComplete,
  klondikeAutoMoves,
  klondikeHint,
  klondikeMoves,
  replayKlondike,
  undoKlondike,
} from "./games/cards/klondike.js";
export type {
  KlondikeBoard,
  KlondikeCard,
  KlondikeMove,
  KlondikePile,
  KlondikeReplay,
  KlondikeState,
} from "./games/cards/klondike.js";
export {
  applyFreeCell,
  canUndoFreeCell,
  dealFreeCell,
  FREE_CELL_COLUMNS,
  FREE_CELL_COUNT,
  FREE_CELL_SCORE,
  freeCellAutoMoves,
  freeCellHint,
  freeCellMoves,
  freeCellSupermoveLimit,
  hasFreeCellMoves,
  isFreeCellEntry,
  isFreeCellMove,
  isFreeCellMoveLegal,
  isFreeCellWon,
  replayFreeCell,
  undoFreeCell,
} from "./games/cards/freecell.js";
export type {
  FreeCellBoard,
  FreeCellMove,
  FreeCellReplay,
  FreeCellSlot,
  FreeCellState,
} from "./games/cards/freecell.js";
export {
  applySpider,
  canUndoSpider,
  dealSpider,
  hasSpiderMoves,
  isSpiderEntry,
  isSpiderMove,
  isSpiderMoveLegal,
  isSpiderWon,
  replaySpider,
  SPIDER_COLUMNS,
  SPIDER_FOUNDATIONS,
  SPIDER_RUN,
  SPIDER_SCORE,
  SPIDER_SUITS,
  spiderAutoMoves,
  spiderDealCount,
  spiderHint,
  spiderMoves,
  undoSpider,
} from "./games/cards/spider.js";
export type {
  SpiderBoard,
  SpiderCard,
  SpiderMove,
  SpiderReplay,
  SpiderState,
} from "./games/cards/spider.js";

// --- GAMES / CHESS (stage 1) -------------------------------------------------
//
// The module's LOGIC: no UI, no IPC, no database. Three layers meet here, and
// which one a caller is in is spelled out in `games/chess/index.ts`.
//
// The RULES — `createGame`, `gameStatus`, `applyUci`, `gamePgn`, `replayUci` —
// are `chess.js` (BSD-2-Clause), and it is a dependency of THIS package and of
// nothing else, because the renderer must reach the rules through us and never
// through a second copy of its own.
//
// The ENGINE — `parseFen`, `legalMoves`, `perft`, `searchPosition`,
// `chooseEngineMove` — is this project's own: a 0x88 move generator proved by
// perft against the published counts, and a small alpha-beta search with
// quiescence, a fixed transposition table and a level ladder from a beginner's
// opponent to a sound one. It is interruptible, and it reads neither the clock
// nor a random source: `now`, `rng` and `shouldStop` are passed in, which is what
// lets stage 2 run it in a worker and stop it.
export {
  ChessError,
  CHESS_LEVELS,
  MATE_SCORE,
  START_FEN,
  applyUci,
  chessLevel,
  chooseEngineMove,
  createGame,
  evaluate,
  gamePgn,
  gameStatus,
  isCapture,
  isValidFen,
  legalMoves,
  legalUci,
  loadGamePgn,
  materialBalance,
  moveSquares,
  moveToUci,
  parseFen,
  perft,
  perftAt,
  playMove,
  replayUci,
  resultToken,
  searchPosition,
  squareIndex,
  squareName,
  toFen,
  uciToMove,
} from "./games/chess/index.js";
export type {
  Chess,
  ChessColor,
  ChessLevel,
  ChessResultToken,
  EnginePosition,
  GameSnapshot,
  Move,
  MoveSquares,
  SearchLimits,
  SearchOptions,
  SearchResult,
  Side,
  Square,
} from "./games/chess/index.js";

// --- SKY (the astronomy engine, stage 1: no store, no UI) --------------------
//
// Offline sun, moon and sky for any place and date, from Jean Meeus'
// „Astronomical Algorithms“ and nothing else — no dependency, no network, and
// no time zone: every function takes an instant in UT and every instant it
// returns is one, because turning them into somebody's clock is the shell's job.
//
// The eight functions are the product. `sunPosition` and `moonPosition` answer
// „where is it now“, `sunDay`, `moonDay` and `sunTwilight` answer „what happens
// today“ — each of which reports a state (`always-above`, `always-below`)
// instead of a time when the body does not cross, so polar day and polar night
// are answers rather than errors — `moonPhase` and `nextMoonPhases` answer what
// the Moon looks like and when it next changes, and `sunOrientation` turns the
// Sun into a compass. Everything lower down (Julian days, ΔT, the sidereal time,
// the refraction curve, the topocentric correction) is reachable inside this
// package for tests and for the next slice, and is deliberately not part of the
// cross-package surface: a caller that wanted the obliquity would be a second
// astronomy module.
export type { SkyInstant } from "./sky/julian.js";
export type { SkyPlace, SkyPosition } from "./sky/horizontal.js";
export { sunPosition } from "./sky/sun.js";
export type { SunEquatorial, SunPosition } from "./sky/sun.js";
export { moonPosition } from "./sky/moon.js";
export type { MoonEcliptic, MoonPosition } from "./sky/moon.js";
export { moonDay, sunDay, sunTwilight } from "./sky/horizon.js";
export type { MoonDay, SkyDayState, SkyTwilight, SunDay, TwilightWindow } from "./sky/horizon.js";
export { MOON_PHASE_NAMES, moonPhase, nextMoonPhases } from "./sky/phases.js";
export type { MoonPhaseName, MoonPhaseReading, NextMoonPhases } from "./sky/phases.js";
export { northFromSun, sunOrientation } from "./sky/orientation.js";
export type { SunOrientation } from "./sky/orientation.js";

// --- SIGNALS (Morse, ASCII, the tuner and the sound meter) -------------------
export {
  MAX_WPM,
  MIN_WPM,
  MORSE_TRANSLITERATIONS,
  PARIS_DIT_MS,
  charForMorse,
  decodeMorse,
  ditMs,
  encodeMorse,
  farnsworthGapUnits,
  farnsworthWordGapUnits,
  morseAlphabet,
  morseForChar,
  morseSchedule,
  scheduleDurationMs,
} from "./signals/morse.js";
export type {
  MorseDecodeOptions,
  MorseDecodeResult,
  MorseDecodedChar,
  MorseEncodeResult,
  MorseInterval,
  MorseTiming,
} from "./signals/morse.js";
export { MORSE_ALPHABET, MORSE_BY_CHARACTER, MORSE_BY_CODE } from "./signals/morseTable.js";
export type { MorseCharacter } from "./signals/morseTable.js";
export {
  ASCII_CODES,
  ASCII_RADICES,
  asciiEntry,
  asciiFromCode,
  codeFromAscii,
  codesFromText,
  formatAsciiCode,
  formatAsciiString,
  formatCodePoint,
  isAsciiCode,
  isAsciiText,
  parseAsciiCode,
  textFromCodes,
  textToCodePoints,
} from "./signals/ascii.js";
export type { AsciiChar, AsciiRadix } from "./signals/ascii.js";
export {
  DEFAULT_CLARITY,
  DEFAULT_MAX_HZ,
  DEFAULT_MIN_HZ,
  MIN_FRAME_SAMPLES,
  detectPitch,
} from "./signals/pitch.js";
export type { PitchDetection, PitchDetectionOptions, PitchOptions } from "./signals/pitch.js";
export {
  CHROMATIC_PRESET,
  CONCERT_A4_HZ,
  MAX_A4_HZ,
  MIN_A4_HZ,
  NOTE_NAMES,
  SEMITONE_RATIO,
  TUNING_PRESETS,
  centsBetween,
  isValidA4,
  noteForFrequency,
  noteFrequencyHz,
  noteLabel,
  shiftCents,
  targetFor,
} from "./signals/notes.js";
export type { InstrumentPreset, NoteReading, PitchReading, TuningTarget } from "./signals/notes.js";
export {
  DEFAULT_LEVEL_GATE_DB,
  LeqWindow,
  SILENCE_FLOOR_DB,
  aWeightingDb,
  amplitudeFromDbfs,
  applyAWeighting,
  biquadCascadeDb,
  dBfsFromAmplitude,
  dBfsFromPeak,
  dBfsFromRms,
  designAWeighting,
  frameLevel,
  leqFromFrameLevels,
  leqFromFrameRms,
  peak,
  rms,
  splFromDbfs,
} from "./signals/soundLevel.js";
export type { AWeightingFilter, Biquad, FrameLevel } from "./signals/soundLevel.js";

// --- GAMES: the board games' engines (slice 1 of 2, no store) ---------------
//
// Six engines, each with the same six functions — `initialState`, `legalMoves`,
// `applyMove`, `result`, `bestMove` and the `toJSON`/`fromJSON` pair — so they
// are exported as six NAMESPACES rather than as sixty names: `reversi
// .legalMoves(state)` says which game it is, and `legalMoves` alone could not.
// Each game's own file (`games/<game>/<game>.ts`) is the module comment that
// explains its rules and cites them, and stage 2 reaches one game at a time.
//
// The shared pieces are exported directly, because they are what makes the six
// one shape: `Rng` and `createRng` (no engine reads `Math.random`, so a saved
// game replays its dice), `InvalidStateError` (what `applyMove` and `fromJSON`
// refuse an untrusted move or saved game with, and which carries a machine token
// rather than copy), `Outcome` with its `win` and `draw` for the games that end
// in a win or a draw, and `search` with its `SearchGame`/`SearchLimits`/`Choice`
// shape for the games whose computer opponent is the alpha-beta in
// `boards-shared`. Backgammon, whose result carries a gammon and a cube, and
// ludo, which has up to four seats and so cannot use `Player = 0 | 1`, define
// their own result types and are the only two that do.
export * as reversi from "./games/reversi/reversi.js";
export * as draughts from "./games/draughts/draughts.js";
export * as mlin from "./games/mlin/mlin.js";
export * as backgammon from "./games/backgammon/backgammon.js";
export * as fourInARow from "./games/four-in-a-row/fourInARow.js";
export * as ludo from "./games/ludo/ludo.js";

export { createRng, rollDie, rollDice } from "./games/boards-shared/rng.js";
export type { Rng } from "./games/boards-shared/rng.js";
export { InvalidStateError } from "./games/boards-shared/errors.js";
export { IN_PROGRESS, draw, win } from "./games/boards-shared/outcome.js";
export type { Outcome, Player } from "./games/boards-shared/outcome.js";
export { search } from "./games/boards-shared/search.js";
export type { Choice, SearchGame, SearchLimits as BoardSearchLimits } from "./games/boards-shared/search.js";

// --- GAMES: the puzzle engines (stage 1, no store) ---------------------------
//
// Sudoku, 2048, nonograms, mahjong solitaire, Broj, and the snake and brick
// arcade engines — pure logic, one folder each, with no store of their own: a
// result joins the arcade scores table in stage 2. Every one of them takes its
// random source in and none of them reads a clock, so a seed plus a move log is
// a whole game and a report that carries its seed is a reproduction.
//
// `step` is the name both arcade engines use for their one entry point, so the
// two are exported under the game they belong to. `puzzles-shared/random.ts` is
// the seeded source they draw from; its shuffle and its bounded draw stay
// internal, because a caller that needs one has taken on the rule that decides
// what a draw means.
export { createPuzzleRandom } from "./games/puzzles-shared/random.js";
export type { PuzzleRandom } from "./games/puzzles-shared/random.js";

export {
  SUDOKU_UNITS,
  countSudokuSolutions,
  generateSudoku,
  solveSudokuLogically,
  sudokuCandidates,
  sudokuConflicts,
  sudokuDifficulty,
  sudokuHint,
  sudokuSolution,
} from "./games/sudoku/sudoku.js";
export type {
  SudokuCells,
  SudokuDifficulty,
  SudokuEliminateHint,
  SudokuFillHint,
  SudokuHint,
  SudokuLogicalSolve,
  SudokuNarrowHint,
  SudokuOptions,
  SudokuPuzzle,
  SudokuTechnique,
} from "./games/sudoku/sudoku.js";

export {
  TILE_2048_SIZES,
  TILE_2048_WIN,
  canMoveTile2048,
  continueAfterWin,
  createTile2048,
  highestTile,
  mergeLine,
  moveTile2048,
  nextTileValue,
  tile2048From,
  undoLastMove,
} from "./games/tile2048/tile2048.js";
export type {
  Tile2048Move,
  Tile2048Setup,
  Tile2048Size,
  Tile2048Snapshot,
  Tile2048State,
} from "./games/tile2048/tile2048.js";

export {
  NONOGRAM_ATTEMPT_LIMIT,
  NONOGRAM_MAX,
  NONOGRAM_MIN,
  checkNonogram,
  cluesOf,
  generateNonogram,
  solveNonogramLines,
} from "./games/nonogram/nonogram.js";
export type {
  NonogramCell,
  NonogramCheck,
  NonogramPuzzle,
} from "./games/nonogram/nonogram.js";

export {
  MAHJONG_FACES,
  MAHJONG_SOLVER_NODE_BUDGET,
  TURTLE,
  TURTLE_LAYER_COUNTS,
  TURTLE_SLOTS,
  createMahjongDeal,
  createMahjongGame,
  isMahjongFree,
  mahjongBoard,
  mahjongFacesMatch,
  mahjongFreeSlots,
  mahjongGameFrom,
  mahjongGroupOf,
  mahjongHint,
  mahjongLegalPairs,
  mahjongRemove,
  mahjongShuffle,
  mahjongUndo,
  mahjongWon,
  solveMahjong,
} from "./games/mahjong/mahjong.js";
export type {
  MahjongBoard,
  MahjongDeal,
  MahjongGame,
  MahjongGroup,
  MahjongMove,
  MahjongNeighbourhood,
  MahjongSlot,
  MahjongSolution,
} from "./games/mahjong/mahjong.js";

export {
  BROJ_FIFTH_CHOICES,
  BROJ_SIXTH_CHOICES,
  BROJ_SMALL_MAX,
  BROJ_SMALL_MIN,
  BROJ_TARGET_MAX,
  BROJ_TARGET_MIN,
  BROJ_VALUE_LIMIT,
  brojNumbersOf,
  checkBrojExpression,
  createBrojPuzzle,
  evaluateBroj,
  formatBroj,
  solveBroj,
} from "./games/broj/broj.js";
export type {
  BrojCheck,
  BrojExpression,
  BrojOperation,
  BrojOptions,
  BrojPuzzle,
  BrojRefusal,
  BrojSolution,
} from "./games/broj/broj.js";

export {
  SNAKE_COLUMNS,
  SNAKE_FOOD_POINTS,
  SNAKE_MAX_TICKS_PER_STEP,
  SNAKE_MIN_TICK_MS,
  SNAKE_POINTS_PER_LEVEL,
  SNAKE_ROWS,
  SNAKE_START_LENGTH,
  SNAKE_TICK_MS,
  SNAKE_TICK_STEP_MS,
  createSnake,
  snakeTickMs,
  step as stepSnake,
} from "./games/snake/snake.js";
export type { SnakeDirection, SnakeInput, SnakeState } from "./games/snake/snake.js";

export {
  BRICKS_BALL_RADIUS,
  BRICKS_BASE_SPEED,
  BRICKS_BRICK_POINTS,
  BRICKS_BRICK_TOP,
  BRICKS_COLUMNS,
  BRICKS_LEVEL_BONUS,
  BRICKS_LIVES,
  BRICKS_MAX_BRICK_ROWS,
  BRICKS_MAX_SPEED,
  BRICKS_MAX_TICKS_PER_STEP,
  BRICKS_PADDLE_HEIGHT,
  BRICKS_PADDLE_SPEED,
  BRICKS_PADDLE_WIDTH,
  BRICKS_ROWS,
  BRICKS_TENTHS,
  BRICKS_TICK_MS,
  bricksRemaining,
  bricksSpeed,
  createBricks,
  step as stepBricks,
} from "./games/bricks/bricks.js";
export type { BricksInput, BricksState } from "./games/bricks/bricks.js";

export { MODULE_CATEGORIES } from "./modules/manifest.js";
export type { ModuleCategory, ModuleManifest } from "./modules/manifest.js";
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
export { TOOL_CATEGORIES } from "./contracts/tools.js";
export type { ToolCategory, ToolRegistration } from "./contracts/tools.js";

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
  workingSets,
} from "./fitness/training.js";
export type {
  DailyReading,
  LoggedSet,
  OneRepMaxEstimate,
  OneRepMaxFormula,
  SetKind,
  TonnageTotal,
  TrendPoint,
} from "./fitness/training.js";
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
  ExportExam,
  ExportExamTopic,
  ExportFinAccount,
  ExportFinBudget,
  ExportFinCategory,
  ExportFinRecurring,
  ExportFinTransaction,
  ExportFitFood,
  ExportFitMealItem,
  ExportFitTarget,
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

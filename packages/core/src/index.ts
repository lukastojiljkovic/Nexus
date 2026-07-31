export { MODULE_CATEGORIES } from "./modules/manifest.js";
export type { ModuleCategory, ModuleManifest } from "./modules/manifest.js";
export { ModuleRegistry } from "./modules/registry.js";

export { resolveEnabled } from "./flags/flags.js";
export type { FlagState, FlagStore } from "./flags/flags.js";

export type { JsonSchema, WidgetContract, WidgetSize } from "./contracts/widgets.js";
export type {
  SettingDefinition,
  SettingScope,
  SettingsSection,
  SettingType,
} from "./contracts/settings.js";
export type { SearchIndexer } from "./contracts/search.js";
export type { StatsContribution } from "./contracts/stats.js";
export type {
  AutomationAction,
  AutomationCatalog,
  AutomationTrigger,
} from "./contracts/automation.js";
export type { ImexHandler } from "./contracts/imex.js";
export type { ToolRegistration } from "./contracts/tools.js";

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
  groupForKanban,
  moveBetweenGroups,
  ViewConfigError,
} from "./views/engine.js";
export type { KanbanGroup } from "./views/engine.js";

export { distributeBacklog, planBlockDates } from "./study/planEngine.js";
export type { PlanBlockDate, PlanBlockDatesInput } from "./study/planEngine.js";

export { computeStreak } from "./study/studyStats.js";
export type { StreakResult } from "./study/studyStats.js";

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
  NotificationCandidate,
  NotificationPriority,
  NotificationSource,
  StudyDayReminderInput,
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

export {
  CALLOUT_VARIANTS,
  DEFAULT_CALLOUT_VARIANT,
  isCalloutVariant,
  normalizeCalloutVariant,
} from "./notes/noteBlocks.js";
export type { CalloutVariant } from "./notes/noteBlocks.js";

export {
  CLOZE_MASK,
  findClozeRuns,
  renderClozeCard,
  renderClozeSide,
  splitClozeSegments,
} from "./study/clozeText.js";
export type { ClozeRun, ClozeSegment } from "./study/clozeText.js";

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

export { isInlineImageMime, sniffMime } from "./files/sniff.js";
export { centerSquareCrop, PROFILE_PICTURE_SIZE } from "./files/squareCrop.js";
export type { CropRect } from "./files/squareCrop.js";

export { ARCHIVE_MODULE_IDS, buildExportArchive, countProfileModules, DATA_FILES } from "./imex/exportArchive.js";
export type {
  ArchiveModuleId,
  ArchiveProfilePicture,
  ExportArchive,
  ExportArchiveInput,
  ExportBinaryEntry,
  ExportCard,
  ExportDashboardSettings,
  ExportDashboardWidget,
  ExportDeck,
  ExportDocument,
  ExportEvent,
  ExportEventTemplate,
  ExportEventTemplatePayload,
  ExportExam,
  ExportFocusSession,
  ExportNote,
  ExportNoteAttachment,
  ExportNoteFolder,
  ExportNoteTag,
  ExportNoteTagLink,
  ExportNoteTemplate,
  ExportNoteVersion,
  ExportNotification,
  ExportPerson,
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
  parseLlmAnswer,
  translateLlmRecords,
} from "./imex/llmPrompts.js";
export type {
  LlmAnswer,
  LlmAnswerProblem,
  LlmAnswerReport,
  LlmCardRecord,
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

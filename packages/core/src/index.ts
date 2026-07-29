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

export { deriveNotificationCandidates } from "./notify/notificationEngine.js";
export type {
  DeriveNotificationCandidatesInput,
  DocumentReminderInput,
  EventReminderInput,
  ExamReminderInput,
  NotificationCandidate,
  NotificationPriority,
  NotificationSource,
  StudyDayReminderInput,
} from "./notify/notificationEngine.js";

export { isWithinQuietHours } from "./notify/quietHours.js";

export { collectNoteLinkIds, mergeNoteState } from "./notes/yjsMerge.js";
export type { MergedNoteState } from "./notes/yjsMerge.js";

export { extractNoteLinkTargets } from "./notes/noteLinks.js";

export { collectNoteCards, NOTE_CARD_MAX_TEXT_LENGTH, parseCardBlock } from "./notes/noteCards.js";
export type { CardSyntaxSpan, NoteCardSpec, ParsedBlock, ParsedCard } from "./notes/noteCards.js";

export { replaceNoteContent } from "./notes/yjsRestore.js";

export { claimUniqueName, sanitizePathSegment, UNTITLED_NOTE_NAME } from "./imex/archivePaths.js";

export { toCsv } from "./imex/csv.js";
export type { CsvValue } from "./imex/csv.js";

export { isInlineImageMime, sniffMime } from "./files/sniff.js";

export { ARCHIVE_MODULE_IDS, buildExportArchive, countProfileModules, DATA_FILES } from "./imex/exportArchive.js";
export type {
  ArchiveModuleId,
  ExportArchive,
  ExportArchiveInput,
  ExportBinaryEntry,
  ExportCard,
  ExportDeck,
  ExportDocument,
  ExportEvent,
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
  ExportSubject,
  ExportTask,
  ProfileData,
} from "./imex/exportArchive.js";

export { INTERCHANGE_SCHEMA_VERSION, parseImportArchive } from "./imex/importArchive.js";
export type {
  ImportArchiveInput,
  ImportArchiveResult,
  ImportManifest,
  ImportProblem,
  ImportProblemCode,
} from "./imex/importArchive.js";

export { renderNoteMarkdown } from "./imex/noteMarkdown.js";
export type { NoteMarkdownAttachment, NoteMarkdownContext } from "./imex/noteMarkdown.js";

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
  daySpanKeys,
  isValidDayKey,
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
export type { ParsedSearchQuery, SearchKind } from "./search/searchQuery.js";

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

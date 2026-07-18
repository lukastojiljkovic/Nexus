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
  ExamReminderInput,
  NotificationCandidate,
  NotificationPriority,
  NotificationSource,
  StudyDayReminderInput,
} from "./notify/notificationEngine.js";

export { isWithinQuietHours } from "./notify/quietHours.js";

export { collectNoteLinkIds, mergeNoteState } from "./notes/yjsMerge.js";
export type { MergedNoteState } from "./notes/yjsMerge.js";

export { replaceNoteContent } from "./notes/yjsRestore.js";

export { toCsv } from "./imex/csv.js";
export type { CsvValue } from "./imex/csv.js";

export { isInlineImageMime, sniffMime } from "./files/sniff.js";

export { buildExportArchive } from "./imex/exportArchive.js";
export type {
  ExportArchive,
  ExportArchiveInput,
  ExportCard,
  ExportDeck,
  ExportDocument,
  ExportEvent,
  ExportExam,
  ExportFocusSession,
  ExportNotification,
  ExportRenewal,
  ExportReviewLogEntry,
  ExportSettings,
  ExportStudyBlock,
  ExportStudyPlan,
  ExportSubject,
  ExportTask,
} from "./imex/exportArchive.js";

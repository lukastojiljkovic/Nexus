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

// The only imports this contract makes, and they are type-only (erased at build
// time, so preload and main gain no runtime dependency). A task list's view
// config is a nested grammar shared by the store, the archive reader and this
// wire, and the three of them must not each carry their own copy of it. The two
// focus unions are here for a narrower reason: they are the closed vocabularies
// the store's CHECK constraints enforce, so a redeclared copy could drift into
// naming a phase the database would refuse to store. Every other shape here
// stays redeclared — those are flat records and one-off unions, where a copy
// costs nothing and cannot drift silently.
//
// FIT's four (slice b) join on the FIRST of those grounds, not the second:
// `FoodMacros`/`FoodServing`/`FoodSource` are the nested grammar the catalogue,
// the two stores and the archive reader already share, and `FoodCategory` is a
// seventeen-member closed list the food store validates against. A redeclared
// copy of any of them would be a second answer to „what is a food" — which is
// exactly the drift `TaskViewConfig` is imported to avoid.
//
// `CanvasRefKind` (CANV slice b2) joins on the closed-vocabulary ground: it is
// the three-member list `parseCanvasRef` admits and the store's card reader
// switches on, so a redeclared copy could drift into naming a kind neither of
// them answers.
import type {
  ActivityLevel,
  BodyCircumferences,
  BodySex,
  CanvasRefKind,
  Chassis,
  CircuitPart,
  CircuitWire,
  ExerciseEquipment,
  ExerciseMetric,
  FocusOutcome,
  FocusPhaseKind,
  FoodCategory,
  FoodMacros,
  FoodServing,
  FoodSource,
  MovementPattern,
  MuscleGroup,
  MuscleReading,
  SearchKind,
  SetKind,
  TaskViewConfig,
  WireEnd,
} from "@nexus/core";
// The sync surface's refusal vocabulary joins on the closed-list ground stated
// above, and on a sharper version of it: these two unions are what the auth
// server and `nexus_mk_mint` actually answer, and a redeclared copy would drift
// into naming a state the protocol cannot produce — or, worse, into omitting one
// it can, which is a screen with no message for a case that happens.
import type { AuthRefusal, DeviceRegisterRefusal, SyncEnableRefusal } from "@nexus/sync-transport";

/** The only channels the preload bridge and the main handlers agree on. */
/**
 * The name `profiles:create-demo` gives the profile it makes.
 *
 * In `shared/` because THREE sides need the same word and none of them may
 * import another's: main guards on it (one demo profile per account), the
 * renderer decides whether to offer the action at all, and the seeders name
 * it. It is a plain name and not a kind or a flag on purpose — a user can
 * rename it or delete it, and either is a deliberate act that legitimately
 * makes the offer available again.
 */
export const DEMO_PROFILE_NAME = "Demo";

/**
 * Every language the copy layer can serve, as its locale codes.
 *
 * The renderer derives the same union from its own `LOCALES` record; this is
 * the copy the IPC contract can see, and the value a `locale:set` payload is
 * validated against. A third language is one entry there, one entry here, and
 * a compile error wherever the two are compared.
 */
export type AppLocale = "sr" | "en";

export const IpcChannel = {
  authStatus: "auth:status",
  authCreate: "auth:create",
  authUnlock: "auth:unlock",
  authRecover: "auth:recover",
  authChangePasscode: "auth:change-passcode",
  authRegenerateRecovery: "auth:regenerate-recovery",
  authLock: "auth:lock",
  authSelectAccount: "auth:select-account",
  authCreateAdditional: "auth:create-additional",
  authRenameAccount: "auth:rename-account",
  authDeleteAccount: "auth:delete-account",
  profilesList: "profiles:list",
  profilesCreate: "profiles:create",
  // The demo profile, offered once at first run and never again — a second
  // profile in the SAME account, filled with a believable life, so somebody
  // who has just installed Nexus can see what a full app looks like without
  // typing five hundred rows. Its own channel rather than a flag on
  // `profiles:create`, because it is a different authority: `profiles:create`
  // makes an empty profile the user then fills, and this one writes hundreds
  // of rows on the renderer's word. The handler is what bounds it.
  profilesCreateDemo: "profiles:create-demo",
  profilesDelete: "profiles:delete",
  // Verifies the account passcode against the CURRENT unlocked session
  // (ADR-058): the gate in front of switching INTO a profile. Its own channel
  // rather than a mode on `auth:unlock`, because the two do different things —
  // an unlock may (re)open the database, while a verify must never touch it —
  // and a shared channel would put that difference behind a boolean.
  profilesVerifySwitch: "profiles:verify-switch",
  // ADR-058 (NTF active-profile rule): the renderer reports which profile its
  // shell is standing in — at unlock landing and on every verified switch —
  // so main can serve notifications for the ACTIVE profile only. A report,
  // not a request: it changes what the scheduler serves, never what the
  // renderer may read, so there is nothing here for a compromised renderer
  // to widen.
  profilesSetActive: "profiles:set-active",
  // The renderer reports the language it is serving (the renderer's own
  // `LOCALES`, mirrored here as a closed union because the two sides must agree
  // before any copy is written in it). Main's dialogs and OS notifications are
  // composed there and cannot read the renderer's preference, so this is how
  // they learn it. A report, not a request, like `profiles:set-active`: it
  // changes what main writes NEXT and nothing the renderer may read.
  localeSet: "locale:set",
  profilesRename: "profiles:rename",
  profilesPicturePick: "profiles:picture-pick",
  profilesPictureClear: "profiles:picture-clear",
  flagsGet: "flags:get",
  flagsSet: "flags:set",
  tasksList: "tasks:list",
  tasksCreate: "tasks:create",
  tasksUpdate: "tasks:update",
  tasksSetDone: "tasks:set-done",
  tasksDelete: "tasks:delete",
  tasksRestore: "tasks:restore",
  taskListsList: "task-lists:list",
  taskListsCreate: "task-lists:create",
  taskListsRename: "task-lists:rename",
  taskListsSetView: "task-lists:set-view",
  taskListsSetViewConfig: "task-lists:set-view-config",
  taskListsMove: "task-lists:move",
  taskListsDelete: "task-lists:delete",
  taskListsRestore: "task-lists:restore",
  taskSectionsCreate: "task-sections:create",
  taskSectionsRename: "task-sections:rename",
  taskSectionsMove: "task-sections:move",
  taskSectionsDelete: "task-sections:delete",
  tasksMoveToList: "tasks:move-to-list",
  tasksMoveToSection: "tasks:move-to-section",
  tasksReorder: "tasks:reorder",
  tasksBulkMove: "tasks:bulk-move",
  tasksBulkPriority: "tasks:bulk-priority",
  tasksBulkDue: "tasks:bulk-due",
  tasksBulkDelete: "tasks:bulk-delete",
  tasksBulkRestore: "tasks:bulk-restore",
  taskTagsList: "task-tags:list",
  taskTagsCreate: "task-tags:create",
  taskTagsRename: "task-tags:rename",
  taskTagsDelete: "task-tags:delete",
  taskTagsAttach: "task-tags:attach",
  taskTagsDetach: "task-tags:detach",
  taskTagLinksList: "task-tag-links:list",
  taskAttachmentsList: "task-attachments:list",
  taskAttachmentsAdd: "task-attachments:add",
  taskAttachmentsRemove: "task-attachments:remove",
  taskAttachmentsOpen: "task-attachments:open",
  taskAttachmentsSaveAs: "task-attachments:save-as",
  taskAttachmentsCounts: "task-attachments:counts",
  taskTemplatesList: "task-templates:list",
  taskTemplatesSaveFromTask: "task-templates:save-from-task",
  taskTemplatesApply: "task-templates:apply",
  taskTemplatesDelete: "task-templates:delete",
  taskDependenciesList: "task-dependencies:list",
  taskDependenciesAdd: "task-dependencies:add",
  taskDependenciesRemove: "task-dependencies:remove",
  eventsList: "events:list",
  eventsCreate: "events:create",
  eventsUpdate: "events:update",
  eventsDelete: "events:delete",
  eventsRestore: "events:restore",
  tasksCompleteOccurrence: "tasks:complete-occurrence",
  eventsAddRecurrenceExdate: "events:add-recurrence-exdate",
  eventsSplitRecurrence: "events:split-recurrence",
  eventTemplatesList: "event-templates:list",
  eventTemplatesCapture: "event-templates:capture",
  eventTemplatesApply: "event-templates:apply",
  eventTemplatesDelete: "event-templates:delete",
  calendarGetSettings: "calendar:get-settings",
  calendarSetSettings: "calendar:set-settings",
  // CAL-005 (founder decision #4) / ADR-058 §5: the ONE cross-profile read in
  // the system — the other profile's EVENTS (and only events) for the calendar
  // grid, minimized and pre-marked. The renderer names only the profile it is
  // SHOWING; main derives the other profile(s) from the profiles list itself,
  // so no other profile's id ever travels renderer→main.
  calendarOverlay: "calendar:overlay",
  peopleList: "people:list",
  peopleCreate: "people:create",
  peopleUpdate: "people:update",
  peopleDelete: "people:delete",
  peopleRestore: "people:restore",
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
  subjectAttachmentsList: "subject-attachments:list",
  subjectAttachmentsAdd: "subject-attachments:add",
  subjectAttachmentsRemove: "subject-attachments:remove",
  subjectAttachmentsOpen: "subject-attachments:open",
  subjectAttachmentsSaveAs: "subject-attachments:save-as",
  subjectNotesLink: "subjects:notes-link",
  subjectNotesUnlink: "subjects:notes-unlink",
  subjectNotesLinked: "subjects:notes-linked",
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
  cardsCreateCloze: "cards:create-cloze",
  cardsCreateProblem: "cards:create-problem",
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
  // The scope-cut conversation (ADR-063 / STUDY-004): the proposal is a pure
  // READ, and acceptance is its own channel — the ONLY wire that ever cuts a
  // topic, so "cut only by explicit user acceptance" stays a structural fact.
  plansScopeCutProposal: "plans:scope-cut-proposal",
  plansAcceptScopeCut: "plans:accept-scope-cut",
  blocksListByPlan: "blocks:list-by-plan",
  blocksRange: "blocks:range",
  blocksSetStatus: "blocks:set-status",
  blocksSetPinned: "blocks:set-pinned",
  // Exam topics (ADR-063): every mutation answers with the exam's fresh
  // EFFECTIVE list, so the renderer always renders manual-else-derived
  // confidence and never derives anything itself.
  topicsListByExam: "topics:list-by-exam",
  topicsCreate: "topics:create",
  topicsRename: "topics:rename",
  topicsSetConfidence: "topics:set-confidence",
  topicsSetDeck: "topics:set-deck",
  topicsMove: "topics:move",
  topicsDelete: "topics:delete",
  // „Vrati u plan": the inverse of `plans:accept-scope-cut` (ADR-063) — the
  // only wire that ever CLEARS `cut`. It lives here rather than under plans:*
  // because the affordance is a topic row's, and the answer is the exam's
  // fresh effective list every other topics:* channel already returns; the
  // plan re-sync rides on the same refresh the renderer runs after any topic
  // write.
  topicsRestoreToPlan: "topics:restore-to-plan",
  // The ONE focus timer (UTIL slice b, ADR-077). `focus:start`/`focus:status`
  // were WIDENED rather than twinned: STUDY's open-ended study timer and a
  // Pomodoro phase are the same running phase with different fields, so a
  // parallel `pomodoro:*` set would be exactly the second timer migration 057
  // merged away. Only pause/resume are new, because only they are new acts.
  focusStart: "focus:start",
  focusStop: "focus:stop",
  focusPause: "focus:pause",
  focusResume: "focus:resume",
  focusStatus: "focus:status",
  focusCancel: "focus:cancel",
  focusListRange: "focus:list-range",
  focusDelete: "focus:delete",
  focusRestore: "focus:restore",
  statsStudy: "stats:study",
  studyLog: "study:log",
  studySettingsGet: "study:settings-get",
  studySettingsSet: "study:settings-set",
  notificationsCenterList: "notifications:center-list",
  notificationsSnooze: "notifications:snooze",
  notificationsDismiss: "notifications:dismiss",
  notificationsSettingsGet: "notifications:settings-get",
  notificationsSettingsUpdate: "notifications:settings-update",
  notificationsSourceToggle: "notifications:source-toggle",
  notificationsChanged: "notifications:changed",
  notificationsAppetiteAsk: "notifications:appetite-ask",
  notificationsAppetiteAnswer: "notifications:appetite-answer",
  notesList: "notes:list",
  notesCreate: "notes:create",
  notesLoad: "notes:load",
  notesAppendUpdate: "notes:append-update",
  notesDelete: "notes:delete",
  notesDuplicate: "notes:duplicate",
  notesRestore: "notes:restore",
  noteFoldersList: "note-folders:list",
  noteFoldersCreate: "note-folders:create",
  noteFoldersUpdate: "note-folders:update",
  noteFoldersMove: "note-folders:move",
  noteFoldersDelete: "note-folders:delete",
  noteFoldersSetTemplate: "note-folders:set-template",
  noteFoldersSetCapture: "note-folders:set-capture",
  noteFoldersSetView: "note-folders:set-view",
  noteTagsList: "note-tags:list",
  noteTagsCreate: "note-tags:create",
  noteTagsRename: "note-tags:rename",
  noteTagsDelete: "note-tags:delete",
  noteTagsAttach: "note-tags:attach",
  noteTagsDetach: "note-tags:detach",
  noteTagLinksList: "note-tag-links:list",
  noteCategoriesList: "note-categories:list",
  noteCategoriesCreate: "note-categories:create",
  noteCategoriesUpdate: "note-categories:update",
  noteCategoriesDelete: "note-categories:delete",
  notesSetCategory: "notes:set-category",
  notesSetFolder: "notes:set-folder",
  notesSetPinned: "notes:set-pinned",
  notesSetLinks: "notes:set-links",
  notesBacklinks: "notes:backlinks",
  notesVersions: "notes:versions",
  notesVersionLoad: "notes:version-load",
  notesVersionCapture: "notes:version-capture",
  notesTemplatesList: "notes:templates-list",
  notesTemplateSave: "notes:template-save",
  notesTemplateRename: "notes:template-rename",
  notesTemplateDelete: "notes:template-delete",
  notesCardsSync: "notes:cards-sync",
  notesCardsCount: "notes:cards-count",
  notesCardDeckSet: "notes:card-deck-set",
  notesChecklistCount: "notes:checklist-count",
  notesChecklistToTasks: "notes:checklist-to-tasks",
  noteAttachmentsList: "note-attachments:list",
  noteAttachmentsAdd: "note-attachments:add",
  noteAttachmentsRemove: "note-attachments:remove",
  noteAttachmentsOpen: "note-attachments:open",
  noteAttachmentsSaveAs: "note-attachments:save-as",
  dashboardGetSettings: "dashboard:get-settings",
  dashboardPickBackground: "dashboard:pick-background",
  dashboardClearBackground: "dashboard:clear-background",
  dashboardSetDim: "dashboard:set-dim",
  dashboardWidgetsList: "dashboard:widgets-list",
  dashboardWidgetsAdd: "dashboard:widgets-add",
  dashboardWidgetsRemove: "dashboard:widgets-remove",
  dashboardWidgetsSetSize: "dashboard:widgets-set-size",
  dashboardWidgetsSetConfig: "dashboard:widgets-set-config",
  dashboardWidgetsMove: "dashboard:widgets-move",
  // Named dashboards (DASH-008 / ADR-055) — the wire names ADR-055 decided.
  dashboardSetsList: "dash:list-sets",
  dashboardSetCreate: "dash:create-set",
  dashboardSetRename: "dash:rename-set",
  dashboardSetDelete: "dash:delete-set",
  dashboardSetActivate: "dash:set-active-set",
  // Finansije (FIN slice b, migration 051). One channel per store operation the
  // page performs, split by TABLE the way `tasks:*`/`task-tags:*` are: an
  // account, a category and a transaction are three different things to be
  // wrong about, and a shared channel would be one validated field away from
  // letting a request to rename a category delete an account.
  //
  // The three account READS are three channels rather than one snapshot,
  // deliberately: `listBalances` and `totalsByCurrency` are DERIVED reads the
  // store computes on demand, and folding them into the row read would invite a
  // caller to believe a balance is a column. Every amount on every one of these
  // channels is an integer of minor units, in both directions.
  finAccountsList: "fin-accounts:list",
  finAccountsBalances: "fin-accounts:balances",
  // Net worth PER CURRENCY — a list, never a number. There is deliberately no
  // channel answering a single total: with no exchange rate to convert with, a
  // cross-currency sum could only be invented, and the wire makes asking for
  // one impossible rather than merely discouraged.
  finAccountsTotals: "fin-accounts:totals",
  finAccountsCreate: "fin-accounts:create",
  finAccountsUpdate: "fin-accounts:update",
  finAccountsDelete: "fin-accounts:delete",
  finAccountsRestore: "fin-accounts:restore",
  finCategoriesList: "fin-categories:list",
  finCategoriesCreate: "fin-categories:create",
  finCategoriesRename: "fin-categories:rename",
  finCategoriesDelete: "fin-categories:delete",
  // Budgets (FIN slice c) — their OWN table, so their own prefix, on the same
  // rule that splits accounts from categories from transactions. A budget is
  // one standing allowance per (category, currency): per currency because
  // „30000" says nothing without saying of what, and there is no rate that
  // could fold two currencies into one figure.
  finBudgetsList: "fin-budgets:list",
  finBudgetsSet: "fin-budgets:set",
  finBudgetsClear: "fin-budgets:clear",
  finTransactionsList: "fin-transactions:list",
  finTransactionsCreate: "fin-transactions:create",
  finTransactionsUpdate: "fin-transactions:update",
  finTransactionsDelete: "fin-transactions:delete",
  finTransactionsRestore: "fin-transactions:restore",
  // The month report's two aggregate reads (FIN slice c), both over
  // `fin_flows` — the transfer-free view — and both answering PER CURRENCY.
  // Two channels rather than one report channel: they are two different
  // questions with two different shapes, and a combined one would have to
  // invent a container that could hold a cross-currency total.
  finTransactionsSpend: "fin-transactions:spend",
  finTransactionsIncome: "fin-transactions:income",
  // Subscriptions — recurring charges (FIN slice d, migration 053). Their own
  // table, so their own prefix. There is deliberately NO „generate now" channel:
  // generation is a main-process act that runs at the same moment the plan sync
  // does (the per-unlock / per-day-change reminder check), and a renderer that
  // could ask for it could ask twice.
  finRecurringList: "fin-recurring:list",
  // What the SCHEDULE says is coming, expanded from each rule over a window —
  // never a read of rows, because a charge that has not happened is not a row.
  // The calendar source and the dashboard card are its two callers.
  finRecurringUpcoming: "fin-recurring:upcoming",
  finRecurringCreate: "fin-recurring:create",
  finRecurringUpdate: "fin-recurring:update",
  finRecurringDelete: "fin-recurring:delete",
  finRecurringRestore: "fin-recurring:restore",
  // Pausing a subscription (ADR-074) — „zadrži je, ali me ne naplaćuj", which is
  // a different act from throwing it away and needs its own pair. TWO channels
  // rather than one `set-paused` boolean, deliberately: resuming carries a
  // `today` that main stamps and re-anchors the cursor to, and pausing carries
  // nothing of the sort, so a shared channel would have to ignore that field
  // half the time — and a field a handler ignores is a field nobody validates.
  finRecurringPause: "fin-recurring:pause",
  finRecurringResume: "fin-recurring:resume",
  // Navike (HABIT slice b, migration 055). One channel per store operation, on
  // the `fin-*:*` rule: a habit and a day's TICK are two different things to be
  // wrong about, and a shared channel would be one validated field away from
  // letting a request to record a glass of water rewrite the habit's schedule.
  //
  // Archiving is its OWN pair rather than a field on `habits:update`, exactly as
  // pausing a subscription is (ADR-074): `archived_at` and `deleted_at` are
  // independent facts (migration 055), and a boolean on the patch would put
  // „gotov sam s ovim" behind the same validator that renames a habit.
  habitsList: "habits:list",
  habitsCreate: "habits:create",
  habitsUpdate: "habits:update",
  habitsDelete: "habits:delete",
  habitsRestore: "habits:restore",
  habitsArchive: "habits:archive",
  habitsUnarchive: "habits:unarchive",
  // A day's tick and its removal, two channels rather than one nullable value:
  // the store has no zero row (an untick is a DELETE), so a shared channel would
  // have to read „obriši" out of a value field nobody else may send.
  habitsSetEntry: "habits:set-entry",
  habitsClearEntry: "habits:clear-entry",
  // EVERY live habit's ticks over one day range, in ONE call (`listAllEntries`).
  // Deliberately not per habit: the „Danas" list, the history grid and the
  // streaks all read the same window, and an N+1 per habit is the obvious wrong
  // shape for a page that draws a grid.
  habitsEntries: "habits:entries",
  // Ishrana (FIT slice b, migration 058). One channel per store operation, on
  // the `fin-*:*`/`habits:*` rule — and one channel here carries a power none of
  // the others do.
  //
  // **`fit:item-add` takes a REFERENCE and a weight, never macros.** Main
  // resolves the reference — `catalogue:<id>` against `@nexus/core`'s shipped
  // catalogue, `user:<uuid>` against this profile's own `fit_foods` — and writes
  // the snapshot from what it found. A wire that let the renderer name a food AND
  // supply its calories could log a 0-kcal čokolada, and the entire point of the
  // snapshot (migration 058) is that it records what was actually eaten. So the
  // resolve happens on the trusted side, once, and the item's `label` and
  // `per100g` are main's answer rather than the caller's claim.
  //
  // The search is ONE channel over BOTH sources, for the same reason `habits:
  // entries` is one call: the picker draws a single ranked list, and two calls
  // the renderer merged itself would be a second definition of „best match".
  fitFoodSearch: "fit:food-search",
  fitDay: "fit:day",
  fitItemAdd: "fit:item-add",
  fitItemUpdate: "fit:item-update",
  fitItemRemove: "fit:item-remove",
  fitItemRestore: "fit:item-restore",
  // The user's OWN foods (`fit_foods`) — the catalogue is not a table and has no
  // CRUD at all, which is why these four say `food` and the search above says
  // neither.
  fitFoodsList: "fit:foods-list",
  fitFoodCreate: "fit:food-create",
  fitFoodUpdate: "fit:food-update",
  fitFoodDelete: "fit:food-delete",
  fitFoodRestore: "fit:food-restore",
  // One TOTAL per day across a span — what „Merenja"'s measured-expenditure tier
  // reads (ADR-081 §8a). A separate channel from `fit:day` and not a loop over
  // it: tier 1 needs at least fourteen days of intake to say anything at all, and
  // fourteen round trips carrying every logged item to add up four numbers per
  // day would be the N+1 `fit:last-performed` already exists to avoid.
  //
  // Days with nothing logged are ABSENT rather than zero, which is the store's
  // own rule and load-bearing here: „nisam jeo" and „nisam upisao" are different
  // facts, and the tier's 80 % coverage refusal is built on exactly that
  // difference.
  fitDayTotalsRange: "fit:day-totals-range",
  // The four daily goals, read and written whole (`FitTargetStore.save`): with
  // `null` already spoken for as „no goal", a patch would need a third value that
  // reads identically in JSON on this wire — see the store's own doc.
  fitTargets: "fit:targets",
  fitTargetsSave: "fit:targets-save",
  // Trening (FIT slice b, migration 060). One channel per store operation, the
  // rule everything above follows — and one of them carries the same power
  // `fit:item-add` does, for the same reason.
  //
  // **`fit:set-log` takes a REFERENCE and never a metric or a muscle list.**
  // Main resolves the exercise — `catalogue:<slug>` against the list that ships
  // in `@nexus/core`, `user:<uuid>` against this profile's own `fit_exercises`
  // — and stamps `label`, `metric` and the muscles from what it found. A wire
  // that let the renderer name an exercise AND declare its metric could log a
  // plank as `weight_reps`, and every volume total downstream would absorb it
  // without complaint. The snapshot exists precisely so that a later edit
  // cannot re-interpret a logged set (migration 060), and it is only a snapshot
  // if the trusted side is the one taking it. `fit:routine-*` writes an item's
  // label the same way, from the same resolve.
  //
  // The search is ONE channel over BOTH sources, exactly as `fit:food-search`
  // is: the picker draws a single ranked list, and two calls merged by the
  // renderer would be a second definition of "best match".
  fitExerciseSearch: "fit:exercise-search",
  // The profile's OWN exercises. The catalogue is not a table and has no CRUD
  // anywhere on this wire, because there is no row to touch.
  fitExercisesList: "fit:exercises-list",
  fitExerciseCreate: "fit:exercise-create",
  fitExerciseUpdate: "fit:exercise-update",
  fitExerciseDelete: "fit:exercise-delete",
  fitExerciseRestore: "fit:exercise-restore",
  // A routine is a SHAPE of a session and holds nothing about when (ADR-081
  // §6). Items are written WHOLE — see `FitRoutineSaveRequest` for why a patch
  // API cannot exist across a JSON wire.
  fitRoutinesList: "fit:routines-list",
  fitRoutineCreate: "fit:routine-create",
  fitRoutineUpdate: "fit:routine-update",
  fitRoutineDelete: "fit:routine-delete",
  fitRoutineRestore: "fit:routine-restore",
  // The session. `fit:workout-open` answers the ONE unfinished session or null,
  // which is what the page opens on; the schema allows no second one.
  //
  // There is deliberately no read-one-by-id channel beside these. Every workout
  // this module hands back — from `fit:workout-open`, from `fit:workouts-range`,
  // from each mutation — already arrives with its sets nested, so a surface that
  // holds a workout never has an id it has to go back and resolve. One existed
  // anyway for a while, fully validated and called by nobody: a rung of the
  // bridge is attack surface whether or not anything stands on it, and this one
  // was surface for nothing.
  fitWorkoutOpen: "fit:workout-open",
  fitWorkoutStart: "fit:workout-start",
  fitWorkoutFinish: "fit:workout-finish",
  fitWorkoutReopen: "fit:workout-reopen",
  fitWorkoutUpdate: "fit:workout-update",
  fitWorkoutDelete: "fit:workout-delete",
  fitWorkoutRestore: "fit:workout-restore",
  // One channel for a day and a range alike: a day is a range of one, and two
  // channels would be two places for the same `deleted_at IS NULL` scope.
  fitWorkoutsRange: "fit:workouts-range",
  fitSetLog: "fit:set-log",
  fitSetUpdate: "fit:set-update",
  fitSetRemove: "fit:set-remove",
  // "What did I do last time?" for a whole list of exercises in ONE call
  // (ADR-081 §6). Deliberately not per exercise: starting a routine asks about
  // every movement in it at once, and an N+1 is the obvious wrong shape for the
  // read the module exists for.
  fitLastPerformed: "fit:last-performed",
  // Merenja. A range read rather than a "latest" one: the trend IS the number
  // the page shows (a 7-day moving average, ADR-081 §8), so a single most-recent
  // row could not answer any question the surface asks.
  fitMeasurements: "fit:measurements",
  fitMeasurementSave: "fit:measurement-save",
  fitMeasurementRemove: "fit:measurement-remove",
  // Facts about a person rather than observations, and null while never set —
  // never a default-shaped guess, which is what lets the energy estimate say
  // which tier produced it.
  fitBodyProfile: "fit:body-profile",
  fitBodyProfileSave: "fit:body-profile-save",
  // The rest countdown between sets (ADR-081 §7). It is NOT the focus timer and
  // it is not a second one either, because it is not a tracked timer at all: it
  // writes no row, keeps no history, produces no statistic and appears nowhere
  // in „Fokus". The one-timer rule is about what the product RECORDS as time
  // spent, of which there remains exactly one.
  //
  // It lives in MAIN's memory for the reason the running focus phase does: a
  // countdown that a page navigation or a window reload silently cancelled would
  // be a kitchen timer that lies, and the alarm has to be able to fire while the
  // user is looking at another app. Losing it on a crash is honest — there was
  // never a row to lose.
  fitRestStart: "fit:rest-start",
  fitRestStop: "fit:rest-stop",
  fitRestStatus: "fit:rest-status",
  // Table (CANV slice a, migration 059). One channel per store operation, on the
  // `fin-*:*`/`habits:*` rule, and here it does real work: `canvas:save-scene`
  // fires every few seconds while somebody draws, so it must not be able to
  // rename or delete anything, and `canvas:rename` must not be able to carry a
  // drawing. The store keeps them apart with two statements; this list keeps
  // them apart on the wire.
  //
  // **`canvas:list` and `canvas:open` are two channels because a scene is
  // LARGE.** The list answers metadata only — it is what the board strip draws,
  // and it is asked for on every mount — while `canvas:open` is the one call
  // that carries a whole drawing across this boundary. A single channel would
  // put several megabytes on the cheap read.
  canvasList: "canvas:list",
  canvasOpen: "canvas:open",
  canvasCreate: "canvas:create",
  canvasRename: "canvas:rename",
  canvasSaveScene: "canvas:save-scene",
  canvasDelete: "canvas:delete",
  canvasRestore: "canvas:restore",
  // What the Nexus objects pinned to a board currently ARE (CANV slice b2). Its
  // own channel rather than a field on `canvas:open`, and for once that is not
  // only the one-channel-per-operation rule: the cards must be re-resolved
  // WITHOUT re-reading the drawing every time a title changes or an object is
  // deleted, and the scene is the expensive half of that pair.
  canvasResolveRefs: "canvas:resolve-refs",
  // Elektronika (ELEC slice E1, migration 067). One channel per store
  // operation, on the `canvas:*` rule, and here it does the same real work it
  // does there: `elec:update-part` fires on every drag and must not be able to
  // rename the circuit, while `elec:rename` must not be able to move anything.
  // The store keeps those apart with separate statements; this list keeps them
  // apart on the wire.
  //
  // **There is no channel for the component CATALOGUE, and there will not be
  // one.** It ships as constants in `@nexus/core` and the renderer imports it —
  // see the request shapes below.
  //
  // `elec:list` and `elec:open` are two channels on `canvas:list`/`canvas:open`'s
  // grounds, though the cost differs in kind rather than in size: a circuit's
  // parts and wires are rows, not megabytes, but the picker asks on every mount
  // and has no use for what is on any circuit but the one being opened.
  elecList: "elec:list",
  elecOpen: "elec:open",
  elecCreate: "elec:create",
  elecRename: "elec:rename",
  elecSetNotes: "elec:set-notes",
  elecDelete: "elec:delete",
  elecRestore: "elec:restore",
  elecAddPart: "elec:add-part",
  elecUpdatePart: "elec:update-part",
  elecRemovePart: "elec:remove-part",
  elecAddWire: "elec:add-wire",
  elecSetWireColour: "elec:set-wire-colour",
  elecRemoveWire: "elec:remove-wire",
  // ADR-085 slice E4c. Dimensioning the machine is its own channel on
  // `elec:rename`'s grounds — a wheel radius must not be able to arrive on the
  // channel that fires while a part is being dragged — and it carries the whole
  // chassis rather than one field at a time, because nine numbers are all
  // present or the machine does not exist. `null` says there is no machine.
  elecSetChassis: "elec:set-chassis",
  // ADR-085 slice E4. The renderer already generates the code for its own
  // preview — `generateCode` is pure and lives in `@nexus/core` — so this
  // channel exists for exactly one thing the renderer may not do: put a file on
  // the user's disk. Main regenerates from its OWN store rather than writing
  // text the renderer sent, which costs a few milliseconds and means the bytes
  // on disk are the circuit as stored, not as a renderer described it.
  //
  // One channel for both artefacts, and the payload says nothing about which.
  // An Arduino sketch is one file and a ROS 2 package is a directory of eight,
  // so the two need different native dialogs — and main derives WHICH from the
  // stored circuit's board, never from a field the renderer sent. A channel
  // that took „save me a directory" would be a channel a renderer could use to
  // ask for the wrong one.
  elecExportCode: "elec:export-code",
  // ADR-085 slice E6 — the external runner, and the only channels in this file
  // through which a process can be started on the user's machine.
  //
  // **The three run channels take a circuit id and NOTHING ELSE.** Not a
  // command, not a profile, not a distribution: which toolchain runs with which
  // arguments is decided by `@nexus/core`'s closed table from the profile the
  // user enabled in their own settings, so the renderer cannot influence the
  // command line at all. DEV-007's third mitigation is that sentence, and this
  // is where it is enforced rather than intended.
  //
  // Detection is its own channel because it SPAWNS: a probe is a process, so
  // opening a panel must not do it. `elec:runner-plan` is separate from
  // `elec:runner-start` because the consent screen has to show the literal
  // command BEFORE anything is started — a screen that showed it afterwards
  // would be a description rather than a consent.
  elecRunnerDetect: "elec:runner-detect",
  elecRunnerPlan: "elec:runner-plan",
  elecRunnerStart: "elec:runner-start",
  elecRunnerStop: "elec:runner-stop",
  elecRunnerState: "elec:runner-state",
  // Two events, and they travel the other way: `notifications:changed`'s shape.
  // `output` carries the log as it is produced, because a build's output is the
  // reason to watch a run at all; `changed` carries the STATE, so a panel
  // learns that a run ended — or that another window started one — without
  // polling for it.
  elecRunnerOutput: "elec:runner-output",
  elecRunnerChanged: "elec:runner-changed",
  // The switch, and the choice of profile. Two channels rather than one because
  // they are two powers: `enable` is the CONSENT (it is what records
  // `consented_at`, and nothing else may), while `choice` is a preference that
  // cannot be written on a runner that is off.
  elecRunnerSettings: "elec:runner-settings",
  elecRunnerEnable: "elec:runner-enable",
  elecRunnerChoice: "elec:runner-choice",
  searchQuery: "search:query",
  searchRecent: "search:recent",
  searchPage: "search:page",
  searchRebuild: "search:rebuild",
  // The profile's remembered QUERIES (SRCH-009 / migration 050) — a different
  // list from `search:recent`, which answers with the ENTITIES the profile
  // touched. Four channels rather than one with a mode field: recording,
  // forgetting one and forgetting all are three different powers over a
  // privacy surface, and a shared channel would be one validated field away
  // from letting a request to read the history erase it.
  searchHistory: "search:history",
  searchHistoryRecord: "search:history-record",
  searchHistoryRemove: "search:history-remove",
  searchHistoryClear: "search:history-clear",
  imexExport: "imex:export",
  // The calendar alone, as an RFC 5545 `.ics` (CAL-008). Its own channel rather
  // than a mode on `imex:export`: it writes a different file, in a different
  // format, with no passphrase branch at all — and a shared channel would be one
  // validated field away from letting a request for a calendar produce an
  // archive of the whole profile.
  imexExportIcs: "imex:export-ics",
  imexRestorePick: "imex:restore-pick",
  imexRestorePreview: "imex:restore-preview",
  imexRestoreApply: "imex:restore-apply",
  imexRestoreUndo: "imex:restore-undo",
  imexRestoreStatus: "imex:restore-status",
  imexRestoreCancel: "imex:restore-cancel",
  // A foreign import (ADR-043) gets its OWN channels rather than a mode flag on
  // the restore ones. The two surfaces do opposite things — one REPLACES a
  // profile preserving ids, one MERGES into it minting new ones — and a shared
  // channel would be one validated field away from letting a renderer that
  // asked for a merge trigger a replace. Undo and status are deliberately NOT
  // duplicated: both operations share ONE undo slot and ONE banner.
  imexImportPick: "imex:import-pick",
  imexImportPreview: "imex:import-preview",
  // ADR-051: re-plans the archive already open for THIS preview under different
  // duplicate choices. Its own channel rather than a field on the preview one,
  // because the two ask different things of main: a preview OPENS a file (and,
  // for an NXA1 container, runs Argon2id and needs the passphrase), while a
  // re-plan may do neither — it re-uses the parse inputs the open archive is
  // already holding, so changing a choice can never re-ask for a passphrase.
  imexImportReplan: "imex:import-replan",
  imexImportApply: "imex:import-apply",
  imexImportCancel: "imex:import-cancel",
  // An Anki `.apkg` (ADR-052 / STUDY-011). Its OWN four channels, on exactly
  // the reasoning that gave the foreign import its own: an `.apkg` is somebody
  // else's SQLite database inside a plain zip, read by a different reader under
  // different caps, and a shared channel would be one validated field away from
  // letting a request for one produce the other. The pick/preview/apply/cancel
  // SHAPE is deliberately identical, though — same one-slot undo, same named
  // skips, same token — because the user is doing the same thing.
  //
  // No replan channel: an `.apkg` has no duplicate groups to answer. What it
  // has instead is a SUBJECT choice, and that rides on the preview request —
  // re-previewing with a different subject re-plans the archive main already
  // has open, exactly as `imex:import-replan` re-plans on a changed choice.
  imexImportApkgPick: "imex:import-apkg-pick",
  imexImportApkgPreview: "imex:import-apkg-preview",
  imexImportApkgApply: "imex:import-apkg-apply",
  imexImportApkgCancel: "imex:import-apkg-cancel",
  // A CSV of tasks (ADR-062). Its OWN five channels, on the reasoning that gave
  // the `.apkg` its four — a different reader under different caps, and a shared
  // channel would be one validated field away from letting a request for one
  // produce the other. FIVE rather than four because a CSV has no fixed schema:
  // between the preview (columns, samples, a SUGGESTED mapping) and the apply
  // sits the MAPPING step, where the user says which column is which and where
  // the imported tasks land. The parsed cells stay in MAIN's pending session;
  // `imex:import-csv-map` sends role assignments and choices, never data.
  //
  // No replan channel, deliberately: re-mapping IS the re-plan. Calling
  // `imex:import-csv-map` again re-translates and re-plans the rows main
  // already holds — `imex:import-replan`'s precedent, in the form this flow
  // takes — and re-calling the preview with a delimiter/header override
  // re-parses the TEXT main already read, never the file.
  imexImportCsvPick: "imex:import-csv-pick",
  imexImportCsvPreview: "imex:import-csv-preview",
  imexImportCsvMap: "imex:import-csv-map",
  imexImportCsvApply: "imex:import-csv-apply",
  imexImportCsvCancel: "imex:import-csv-cancel",
  // A bank statement into the FIN ledger (FIN slice e). Its OWN five channels
  // rather than a `mode` on the task CSV's, on exactly the reasoning that gave
  // the `.apkg` its four: the two surfaces write different tables under
  // different rules, and a shared channel would be one validated field away
  // from letting a request to file somebody's tasks write into their money.
  //
  // The SHAPE is deliberately the task CSV's — pick, preview (columns, samples,
  // a suggested mapping), MAP, apply, cancel, one-slot undo, one banner —
  // because the user is doing the same thing. What differs is only what a
  // mapping has to say: a statement's roles, the destination ACCOUNT, and the
  // sign convention a signed amount column is read under, which is stated
  // rather than sniffed (both conventions are common and a column of nothing
  // but expenses looks identical under either).
  imexImportFinCsvPick: "imex:import-fin-csv-pick",
  imexImportFinCsvPreview: "imex:import-fin-csv-preview",
  imexImportFinCsvMap: "imex:import-fin-csv-map",
  imexImportFinCsvApply: "imex:import-fin-csv-apply",
  imexImportFinCsvCancel: "imex:import-fin-csv-cancel",
  // A calendar file straight into CAL (ADR-061). Its OWN four channels, on the
  // reasoning that gave the `.apkg` its own: an `.ics` is somebody else's
  // calendar in a line-oriented text format, read by a different reader under a
  // different cap, and a shared channel would be one validated field away from
  // letting a request for one produce the other. The pick/preview/apply/cancel
  // SHAPE is deliberately identical, though — same one-slot undo, same named
  // skips, same token — because the user is doing the same thing.
  //
  // No replan channel: the one answer an `.ics` preview can change is the
  // event duplicate group (ADR-051), and that rides on the preview request —
  // re-previewing under the other answer re-plans the events main already
  // parsed, exactly as a changed `.apkg` subject re-plans the collection main
  // already read. The raw text is dropped the moment it is parsed; only the
  // parsed events live in the pending session.
  imexImportIcsPick: "imex:import-ics-pick",
  imexImportIcsPreview: "imex:import-ics-preview",
  imexImportIcsApply: "imex:import-ics-apply",
  imexImportIcsCancel: "imex:import-ics-cancel",
  // The LLM-assisted import (IMEX-005). Four channels, not five: there is no
  // FILE to pick — the "source" is text the user pasted out of their own chat,
  // which travels with the preview request. The prompt itself needs no channel
  // at all: `buildLlmPrompt` is pure, so the renderer builds it in place and
  // main never sees it.
  //
  // Its own channels for the same reason every other import has its own: a
  // shared one would be a validated field away from letting a paste trigger a
  // restore. The preview/replan/apply/cancel shape is deliberately identical,
  // though — same one-slot undo, same token — because the user is doing the
  // same thing. The replan is `imex:import-replan`'s twin: it re-plans the
  // records main already parsed under a changed duplicate answer, so changing
  // that answer never re-sends (or re-parses) the paste.
  imexImportLlmPreview: "imex:import-llm-preview",
  imexImportLlmReplan: "imex:import-llm-replan",
  imexImportLlmApply: "imex:import-llm-apply",
  imexImportLlmCancel: "imex:import-llm-cancel",
  // Plain `.md` files into notes (IMEX-007). Deliberately NOT a mode on the
  // archive channels above: there is no manifest to read, nothing to preview
  // and nothing to undo — main picks, parses and writes in one call, exactly
  // the shape `dashboard:background-pick` already has.
  imexImportMarkdown: "imex:import-markdown",
  // Scheduled backups (SET-011 / ADR-056): the encrypted export above, run by
  // main on a schedule. Five channels, none of which ever carries a filesystem
  // path FROM the renderer (`backup:pick-folder`'s native dialog is the sole
  // source of one, SEC-EL) and none of which ever carries the passphrase BACK:
  // the settings view says only whether one is set. There is deliberately no
  // plaintext option anywhere on this surface — SEC-DAR-02 allows plaintext
  // only behind an explicit per-export confirmation, and a schedule cannot
  // confirm.
  backupGetSettings: "backup:get-settings",
  backupSetSettings: "backup:set-settings",
  backupPickFolder: "backup:pick-folder",
  backupSetPassphrase: "backup:set-passphrase",
  backupRunNow: "backup:run-now",
  // Private notes (PRIV v1 / ADR-057). The renderer sees decrypted envelopes
  // ONLY while the section is unlocked — the PRIV DEK lives in main and never
  // crosses this bridge in any form, wrapped or not. `priv:lock` doubles as
  // the renderer's panic path (the remappable `privLock` shortcut); main also
  // locks on its own idle timer, on minimize when the preference says so, and
  // unconditionally inside every app lock.
  privStatus: "priv:status",
  privSetup: "priv:setup",
  privUnlock: "priv:unlock",
  privLock: "priv:lock",
  privList: "priv:list",
  privRead: "priv:read",
  privWrite: "priv:write",
  privDelete: "priv:delete",
  privSearch: "priv:search",
  privSetLockPrefs: "priv:set-lock-prefs",
  // The sealed version history (ADR-057). `priv:versions` answers the two
  // CLEARTEXT facts a version row has (its sequence and its capture time) —
  // never a sealed byte; `priv:version-read` unseals ONE version in main and
  // answers the cleartext envelope, exactly what the unlocked editor already
  // receives for the live note. `priv:version-capture` is the explicit close
  // capture (a note switched away, a restore's pre-overwrite checkpoint), a
  // no-op unless the note was written since its last capture.
  privVersions: "priv:versions",
  privVersionRead: "priv:version-read",
  privVersionCapture: "priv:version-capture",
  // `priv:attachment-pick` is the ONE way bytes enter the private store: the
  // native dialog in main picks the file (the renderer never names a path,
  // SEC-EL), main seals the bytes and answers with the reference — the
  // RENDERER then owns writing that reference into the envelope, because the
  // envelope is renderer-authored content exactly like the note's text.
  privAttachmentPick: "priv:attachment-pick",
  // The two move flows (ADR-057 §5). Whole-note transactions in main: move-in
  // seals a public note as a NEW private one and tears the public one down
  // (hard delete + FTS scrub + blob migration); move-out is the exact inverse
  // through the NORMAL note-creation path, so triggers index the result.
  privMoveIn: "priv:move-in",
  privMoveOut: "priv:move-out",
  // In-app file preview (DOC / ADR-064). ONE pair of channels across the three
  // public attachment surfaces (notes, tasks, subject materials) rather than a
  // per-module trio, because the request is the same everywhere: the module
  // names WHICH store resolves it, and main re-resolves the row through that
  // store's own profile/record gate — the renderer never names a hash or a
  // path on either channel, exactly as on `*-attachments:open`.
  //
  // `doc:preview` opens the dedicated hardened PDF window (application/pdf
  // only, refused by name for anything else); `doc:read-text` answers a
  // text/markdown attachment's decoded content for the in-app dialog. Text
  // crosses as a structured reply, deliberately not as a fetchable URL: the
  // packaged CSP's `connect-src 'self'` blocks a renderer fetch of `nx-blob:`,
  // and the house posture — the attachment's bytes never cross this boundary
  // as bytes — stays exactly as it was.
  docPreview: "doc:preview",
  docReadText: "doc:read-text",
  // „Datoteke"'s one read (DOC): every file the profile's three public surfaces
  // carry, as one filtered list. Its own channel rather than a mode on the pair
  // above, because it asks a different question of a different store — those
  // two resolve ONE row through the module that owns it, this one reads across
  // all three and owns nothing — and a shared channel would be one validated
  // field away from letting a browse request open a window.
  //
  // Read-only by design: the page offers no delete, so there is no write
  // channel to widen. Removing a file stays with the surface that owns it,
  // where its undo already lives.
  docListAttachments: "doc:list-attachments",
  // ADR-040's OS-level half (TASK-002). The chord lives in the renderer's
  // `localStorage` (a device preference, never profile data), so the renderer
  // is the only side that knows it — it tells main at boot and on every remap,
  // and main answers whether the system let it have the combination.
  shortcutsSetGlobal: "shortcuts:set-global",
  shortcutsGlobalCapture: "shortcuts:global-capture",
  // The window's own frame (`frame: false`). Nexus draws its title strip
  // itself, so the three things the OS frame used to do have to cross IPC.
  //
  // None of them carries a window id, deliberately. Each acts on the window
  // that SENT the request, resolved from `event.sender` — so a renderer cannot
  // name a window it does not own, and the PDF preview windows (ADR-064) get
  // the same three controls for free rather than a second set of channels.
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowClose: "window:close",
  windowState: "window:state",
  windowStateChanged: "window:state-changed",
  // The rest of what an OS menu bar used to offer: page zoom and full screen.
  // ONE channel with a closed command vocabulary rather than four, because they
  // are the same kind of request — „change how this window presents itself" —
  // and each one is a bare enum with no other field to validate. Four channels
  // would be four handlers repeating the same three lines.
  windowView: "window:view",
  // Every exit waits for what the open editors owe (DC-149). The renderer's own
  // exits — the lock, the panic shortcut, the private section's button — flush
  // before they ask main to lock, and need no channel for it. Main's own exits
  // (the private section's idle lock, lock-on-minimize, closing the window) run
  // before any renderer event could, so main asks: `editors:flush-requested` is
  // pushed with a request id, and `editors:flushed` answers that id once every
  // open editor's write has answered.
  //
  // The answer is honoured in ANY auth state, because all it does is resolve a
  // promise main is already holding; it opens nothing and reads nothing. And
  // main never waits past `EDITOR_FLUSH_GRACE_MS` for it.
  editorsFlushRequested: "editors:flush-requested",
  editorsFlushed: "editors:flushed",
  // Sync (the cloud half). The smallness is the design — no count here, because
  // the number in this line was wrong for two channels before anyone noticed.
  //
  // `sync:status` is the only read, and it answers no token, no key and no
  // server message — an address, a device id, a date and four booleans.
  // `sync:set-cloud` writes `cloud.json` and says a restart is needed, which
  // both directions are; it does NOT lift the boundary in this run, because the
  // resolver-level layer is a command-line switch fixed for the life of the
  // process. `sync:enable` runs the whole mint protocol in main and returns the
  // Sync Recovery Code exactly once, because the user has to write it down.
  //
  // There is deliberately no „sign out" beside `sync:disconnect`. A desktop's
  // authority is a live `devices` row naming its `session_id`, and the grant on
  // that table withholds `session_id` from every client — so a desktop that
  // ends its session can never re-point its row at a new one. „Signed out but
  // still enabled" would be a dead end presented as a toggle.
  syncStatus: "sync:status",
  syncSetCloud: "sync:set-cloud",
  syncEnable: "sync:enable",
  // The answer to what `sync:enable` returns as `already-minted`. Same four
  // fields plus the Sync Recovery Code, and a different protocol behind them:
  // this computer has no master key, so it buys a bootstrap `devices` row with
  // a stepped-up session, opens the account's recovery wrap with the code, and
  // pays for a real desktop row with a proof derived from what it found. The
  // code stops in main and is put through Argon2id there, exactly as the
  // password is — neither ever reaches a socket.
  syncAdopt: "sync:adopt",
  // Getting back onto the account, in the two steps it actually takes.
  // `sync:resume` is one request and no password — a refresh keeps the same
  // `session_id`, so the device row that names it is still the right one, and
  // this is what runs on an ordinary launch. `sync:reconnect` is for when that
  // session is gone for good: a fresh sign-in and a NEW device row, bought with
  // a proof that this computer holds the master key. Not with a second factor —
  // a desktop row is authority over `mk_under_kwrap`, whose opener comes from
  // the password, and a step-up would revoke every sibling desktop's session.
  syncResume: "sync:resume",
  syncReconnect: "sync:reconnect",
  syncDisconnect: "sync:disconnect",
  // The loop itself, and the three things a screen needs of it. `sync:activity`
  // is the read a page does when it opens; `sync:activity-changed` is main
  // pushing the same view on every phase change, so a page that stays open
  // watches instead of polling a five-minute cadence once a second. `sync:now`
  // is the user's button, and it is also the way back from a halt: pressing it
  // is the evidence that whatever the loop stopped for has been dealt with.
  syncNow: "sync:now",
  syncActivity: "sync:activity",
  syncActivityChanged: "sync:activity-changed",
  appInfo: "app:info",
} as const;

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel];

/**
 * The longest any exit waits for the editors that are open to send what they
 * owe (DC-149) — a lock, closing the window, the private section's idle timer.
 * Main's request and the renderer's own flush both use it.
 *
 * Bounded because a lock must never be refused, or held hostage, by a write that
 * does not answer: past the grace the exit goes ahead without it. Long enough
 * for one IPC write, sealing a private note included, on a loaded machine.
 */
export const EDITOR_FLUSH_GRACE_MS = 1_500;

/**
 * The local account's session state (ADR-018): `"uninitialized"` (no account
 * yet), `"locked"` (an account exists but the database is not open), or
 * `"unlocked"`. Computed by combining what is on disk with main's own runtime
 * knowledge of whether the database is currently open — never from disk
 * alone, since "is the database open in this process" cannot be recovered
 * from a file.
 */
export type AuthState = "uninitialized" | "locked" | "unlocked";

/**
 * Why an auth call was refused. Mirrors `@nexus/core/auth`'s `AuthErrorReason`
 * exactly; redeclared here (the same pattern every other closed domain in
 * this file follows) so the renderer never imports the core auth subpath —
 * its Argon2id WASM has no business in a renderer bundle for every screen
 * that isn't the lock screen.
 */
export type AuthErrorReason =
  | "notInitialized"
  | "alreadyInitialized"
  | "wrongPasscode"
  | "wrongRecoveryCode"
  | "throttled"
  | "weakPasscode"
  | "keystoreUnavailable"
  | "otherDevice"
  | "corruptKeychain";

/**
 * Minimum passcode length (founder decision 2026-07-26, ADR-018). Mirrors
 * `@nexus/core/auth`'s `MIN_PASSCODE_LENGTH` — redeclared here, like every
 * other closed domain in this file, so the renderer can pre-check a passcode
 * without importing the core auth subpath and dragging Argon2id's WASM into
 * its bundle. `validatePasscode` in the main process stays authoritative.
 */
export const PASSCODE_MIN_LENGTH = 8;

/** Longest account label the create form and the picker's rename accept. Mirrors `main/accounts.ts`'s `MAX_ACCOUNT_LABEL_LENGTH`, redeclared here so the renderer can cap its own input; main stays authoritative. */
export const MAX_ACCOUNT_LABEL_LENGTH = 80;

/**
 * One local account as the lock screen sees it (ADR-044). The registry's three
 * plaintext fields plus the one live fact the picker needs to draw a state line
 * for an account it has not selected.
 *
 * `label` is PLAINTEXT on disk by design: it is what the picker lists before
 * anything is unlocked, so it cannot live inside an encrypted database. The
 * create form says so where the field is typed.
 */
export interface AccountSummary {
  id: string;
  label: string;
  createdAt: string;
  /**
   * Per-account, not per-device: each account's guard blob is bound to its own
   * device secret, so one carried over from another machine needs its Recovery
   * Kit while the others on this machine unlock normally.
   */
  requiresRecovery: boolean;
}

/** The local account's status (ADR-018) — the first thing the renderer asks about, before profiles or flags. */
export interface AuthStatus {
  state: AuthState;
  /** Milliseconds still to wait before another attempt is accepted; 0 when none. */
  lockedForMs: number;
  /** False when the OS keystore is unavailable — account creation is refused rather than silently downgraded. Device-global: `safeStorage` knows nothing about accounts. */
  keystoreAvailable: boolean;
  /**
   * True when this data was carried over from another machine or Windows
   * account: its OS-bound guard cannot be read here, so the passcode is
   * unusable and only the Recovery Kit can open it (ADR-018 — the Kit is
   * deliberately not device-bound precisely for this). The lock screen shows
   * the recovery form instead of the passcode form.
   */
  requiresRecovery: boolean;
  /**
   * Every local account on this device (ADR-044), oldest first. Empty on a
   * first-ever launch, which is exactly when `state` is `"uninitialized"`.
   */
  accounts: AccountSummary[];
  /**
   * The account `state`, `lockedForMs` and `requiresRecovery` above describe,
   * and the one every other auth channel acts on. Null only when there are no
   * accounts yet.
   */
  selectedAccountId: string | null;
}

/**
 * The outcome of every auth mutation (create/unlock/recover/change-passcode/
 * regenerate-recovery): a discriminated result rather than a thrown error for
 * every EXPECTED refusal. Electron's IPC serializes a thrown `Error`'s
 * `message` only, and the renderer needs `reason` to pick its Serbian copy —
 * a raw thrown error gives it nothing to branch on. An unexpected failure (a
 * corrupt database, a filesystem error) still throws; that is the renderer's
 * generic error path, not this one.
 */
export type AuthResult =
  | { ok: true; recoveryCode?: string }
  | { ok: false; reason: AuthErrorReason; lockedForMs?: number };

/** `label` names the account on the lock screen and is stored in plaintext (see `AccountSummary`); creation is refused outright once any account exists. */
export interface AuthCreateRequest {
  label: string;
  passcode: string;
}

/**
 * A second (third, …) account, created from the picker while others already
 * exist (ADR-044 section 4). Payload-identical to `AuthCreateRequest`, and
 * deliberately a channel of its own rather than a flag on it: this one LOCKS
 * the current session before it creates anything (there is never more than one
 * unlocked account), while `auth:create` can only ever run when nothing is
 * unlocked at all. Collapsing the two would put "may close the open database"
 * behind a boolean.
 */
export interface AuthCreateAdditionalRequest {
  label: string;
  passcode: string;
}

/** Switches which account every other auth channel acts on. Switching away from an unlocked one locks it first (ADR-044 section 5). */
export interface AuthSelectAccountRequest {
  accountId: string;
}

/** Renames an account's lock-screen label. Works while locked — the label is plaintext registry data, not something behind the key chain. */
export interface AuthRenameAccountRequest {
  accountId: string;
  label: string;
}

/**
 * Deletes an account and everything it owns (ADR-048), immediately and
 * irreversibly. There is deliberately NO passcode field: an account that
 * `requiresRecovery` — one whose data came from another device — can produce no
 * passcode proof here at all, so a PIN gate would make exactly the accounts
 * users most want gone the only ones they could not delete, and every attempt
 * would burn the unlock throttle. Intent is proved in the picker instead, by
 * typing the account's own label.
 */
export interface AuthDeleteAccountRequest {
  accountId: string;
}

export interface AuthUnlockRequest {
  passcode: string;
}

/** Recovering without setting a new passcode in the same call would lock the user out again next launch, so both arrive together. */
export interface AuthRecoverRequest {
  recoveryCode: string;
  newPasscode: string;
}

/** Re-verifies `currentPasscode` before rewrapping under `nextPasscode` — a defense against someone at an already-unlocked session changing the passcode without knowing it. */
export interface AuthChangePasscodeRequest {
  currentPasscode: string;
  nextPasscode: string;
}

/** The `profiles.kind` CHECK's closed domain (ADR-058). Mirrors `@nexus/db`'s `ProfileKind` — redeclared, like every closed domain here, so the renderer never imports DB code; main's assignment of the store's value to this type is the drift check. */
export type ProfileKind = "personal" | "business";

/** A profile row as seen by the renderer (mirrors the `profiles` table, ADR-001). */
export interface Profile {
  id: string;
  kind: ProfileKind;
  name: string;
  createdAt: string;
  /**
   * The blob store's plaintext sha256 for this profile's picture (SET-001,
   * migration 040), or null for none. What the renderer turns into an
   * `nx-blob://<hash>` URL — the same read protocol the dashboard background and
   * inline note images use. The bytes themselves never cross IPC in EITHER
   * direction: main opens, decodes and re-encodes the file, and the renderer
   * only ever names the hash back to a protocol handler.
   */
  pictureHash: string | null;
  /** The main-process-sniffed mime `nx-blob:` serves those bytes as; null exactly when `pictureHash` is. Always `image/png` for a picture this build produced. */
  pictureMime: string | null;
  /** The picture's byte length; null exactly when `pictureHash` is. Carried for the archive's blob inventory, not for display. */
  pictureSizeBytes: number | null;
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

/**
 * Creates a profile (ADR-058 — the business profile's front door, though the
 * kind domain is the CHECK's, not "business only"). `name` may be EMPTY — the
 * deliberate "not yet named" sentinel that routes the new profile through the
 * ONB-lite first-entry naming screen — or 1–80 chars after trimming, the same
 * wire cap the rename takes. Main seeds what the new profile starts with (its
 * Inbox; for a business profile, the module preset with STUDY off) — the
 * renderer names only what kind and what to call it.
 */
export interface ProfilesCreateRequest {
  kind: ProfileKind;
  name: string;
}

/**
 * Deletes a profile and everything it owns, immediately and with no undo
 * (ADR-058). Main refuses the personal profile (the account's anchor) and the
 * last remaining profile outright; the renderer's confirmation UI is UX only.
 * Blobs the profile's rows named are garbage-collected refcount-gated, so a
 * file another profile still shows survives.
 */
export interface ProfilesDeleteRequest {
  id: string;
}

/**
 * Proves the account passcode at the profile-switch gate (ADR-058). Verified
 * against the CURRENT session's key — never by reopening the database — and
 * charged against the SAME throttle counter the lock screen uses: a passcode
 * guess is a passcode guess wherever it is typed. Answers with the unlock's
 * own `AuthResult` vocabulary (`ok`/`reason`/`lockedForMs`); `recoveryCode`
 * is never set here.
 */
export interface ProfilesVerifySwitchRequest {
  passcode: string;
}

/**
 * Reports which profile the renderer's shell is standing in (ADR-058, the NTF
 * active-profile rule) — sent at unlock landing and on every verified switch.
 * Main validates the id against the live profile list and restarts the
 * notification scheduler on a real change, which is what re-arms the catch-up
 * burst („Dok te nije bilo: N“) for the profile being entered.
 */
export interface ProfilesSetActiveRequest {
  profileId: string;
}

/**
 * Maximum size, in bytes, of an image `profiles:picture-pick` will accept.
 * 10 MiB: a phone photograph with room to spare, and half the dashboard
 * background's cap because nothing here keeps the original — the file is decoded
 * and re-encoded down to a 512px square, so what a larger allowance would buy is
 * a longer decode, not a better picture. Stat'ed BEFORE the read, so an
 * oversized file is refused without ever being loaded.
 */
export const MAX_PROFILE_PICTURE_BYTES = 10_485_760;

/**
 * Why a picture the user chose was refused. `too-large` is over
 * `MAX_PROFILE_PICTURE_BYTES`; `unsupported-format` is anything the main-process
 * sniff did not recognise as one of the four inline raster formats; `unreadable`
 * is a file that could not be stat'ed or read at all; `undecodable` is a file
 * that IS one of the four but that Electron's image decoder could not open —
 * a real and separate case (it documents itself as handling PNG and JPEG), and
 * one the user can act on differently.
 */
export type ProfilePicturePickErrorCode =
  | "too-large"
  | "unsupported-format"
  | "unreadable"
  | "undecodable";

/**
 * The outcome of the native "pick a profile picture" dialog: the user canceled,
 * the file was refused for a NAMED reason, or the profile row now points at the
 * square PNG main produced from it.
 *
 * `profile` rather than just the hash, for `DashboardPickResult`'s reason: a
 * pick can change more than one field, and a renderer patching its copy from a
 * partial reply would be maintaining a second, drifting model of the row.
 */
export type ProfilePicturePickResult =
  | { status: "canceled" }
  | { status: "rejected"; code: ProfilePicturePickErrorCode }
  | { status: "ok"; profile: Profile };

/** Both picture channels take just the profile — the renderer names no file, and sends no bytes (SEC-EL). */
export interface ProfilesPictureRequest {
  profileId: string;
}

/** Weekday index, 0 = Monday … 6 = Sunday — Monday-first, as everything Serbian in Nexus is. */
export type RecurrenceWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Which occurrence of a weekday inside a month; `-1` is the last one. */
export type RecurrenceOrdinal = 1 | 2 | 3 | 4 | -1;

/** How often a series fires; every `interval` is 1..99 and every period that cannot hold the pattern is skipped, never clamped (ADR-024). */
export type RecurrenceFreq =
  | { kind: "daily"; interval: number }
  | { kind: "weekdays" }
  | { kind: "weekly"; interval: number; days: RecurrenceWeekday[] }
  | { kind: "monthly-date"; interval: number; day: number }
  | { kind: "monthly-ordinal"; interval: number; ordinal: RecurrenceOrdinal; weekday: RecurrenceWeekday }
  | { kind: "yearly"; interval: number };

/** When a series stops: never, on an inclusive bare `YYYY-MM-DD` date, or after a total number of occurrences (the first one included). */
export type RecurrenceEnd =
  | { kind: "never" }
  | { kind: "until"; date: string }
  | { kind: "count"; total: number };

/**
 * The rule language shared by recurring tasks and recurring events (ADR-024).
 * Mirrors `@nexus/core`'s `RecurrenceRule` exactly. Redeclared rather than
 * imported — the same pattern `AuthErrorReason` and `RestoreProblemCode`
 * follow — because this file deliberately imports nothing. `main/index.ts`
 * assigns core's `RecurrenceRule` to this type and hands the result on to the
 * stores, which take core's, so drift in either direction is a compile error
 * rather than a wire that quietly carries a rule the engine cannot run.
 */
export interface RecurrenceRule {
  freq: RecurrenceFreq;
  end: RecurrenceEnd;
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
  /** The rule this task advances by when an occurrence is completed (ADR-024), or null for a one-off. Never non-null without a bare-date `dueDate` — the date the rule phases from. */
  recurrence: RecurrenceRule | null;
  /**
   * Whole DAYS before `dueDate` at which to remind (ADR-028), ascending and
   * duplicate-free; empty for a task with no reminders. Days, not minutes like
   * an event's ladder: a task's deadline is a day, so this is the
   * document-expiry model. Never non-empty without a bare-date `dueDate` — the
   * same anchor a recurrence rule phases from.
   */
  reminderOffsets: number[];
  /** The list this task lives in (TASK-004 / ADR-029). Never null: every task has a list, the profile's Inbox by default. */
  listId: string;
  /** The section (a heading inside `listId`) this task sits under, or null for the list body. */
  sectionId: string | null;
  /**
   * Where this task sits in its (list, section) scope: a fractional rank,
   * compared as a plain string. Never an index and never a count — the display
   * order is what it expresses, and a move rewrites exactly the row that moved.
   */
  rank: string;
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
  recurrence?: RecurrenceRule | null;
  /** Reminder lead times in whole DAYS before the due date (ADR-028); omitted means none. The store canonicalizes and caps them. */
  reminderOffsets?: number[];
  /** Where the task lands (TASK-004); omitted means the profile's Inbox. Ignored when `parentId` is set — a subtask lives where its parent lives. */
  listId?: string;
  /** A section of `listId`; omitted or null puts the task in the list body. Ignored when `parentId` is set, for the same reason. */
  sectionId?: string | null;
}

/** A partial edit of a task's own fields; an omitted key is untouched, `null` clears it. */
export interface TaskFieldChanges {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  startDate?: string | null;
  recurrence?: RecurrenceRule | null;
  /** Reminder lead times in whole DAYS before the due date (ADR-028); an empty array clears every reminder. */
  reminderOffsets?: number[];
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

/** "This occurrence is done" (ADR-024) — the one completion path for every task. `now` is stamped by main, never accepted from the renderer. */
export interface TasksCompleteOccurrenceRequest {
  profileId: string;
  id: string;
}

/** Which shape a list opens in (TASK-004/005, ADR-050). Mirrors `@nexus/db`'s `TASK_LIST_VIEWS`; redeclared so the renderer never imports DB code. */
export type TaskListView = "list" | "kanban" | "cards" | "calendar";

/**
 * Longest list/section name after trimming. Mirrors `@nexus/db`'s
 * `MAX_TASK_LIST_NAME_LENGTH` — redeclared here, like `PASSCODE_MIN_LENGTH`, so
 * the rail's inputs can bound what a user types without importing DB code. The
 * store and the main-process validator stay authoritative.
 */
export const MAX_TASK_LIST_NAME_LENGTH = 100;

/**
 * A task list as seen by the renderer (mirrors the `task_lists` table via the
 * store's mapping, ADR-029). `parentId` is null at the root; the Inbox is the
 * one list a task lands in when the user names none — renamable, but never
 * deletable or movable, which the store refuses outright.
 */
export interface TaskList {
  id: string;
  profileId: string;
  parentId: string | null;
  name: string;
  isInbox: boolean;
  defaultView: TaskListView;
  /**
   * What this list remembers about each of its four views (ADR-050), or null
   * when it has expressed no preference. The one type on this wire imported
   * rather than redeclared: `@nexus/core` is renderer-safe (the page already
   * imports the views engine from it), the shape is a nested grammar rather
   * than a string union, and a hand-copied third version of it is exactly the
   * drift the store, the archive reader and this contract cannot afford. The
   * import is type-only, so preload and main link nothing new.
   */
  viewConfig: TaskViewConfig | null;
  /** Where this list sits among its siblings: a fractional rank, compared as a plain string. */
  rank: string;
  createdAt: string;
  updatedAt: string;
}

/** A heading inside one list (ADR-029). Scoped through its list, so it carries no `profileId` of its own. */
export interface TaskSection {
  id: string;
  listId: string;
  name: string;
  /** Where this heading sits in its list: a fractional rank, compared as a plain string. */
  rank: string;
  createdAt: string;
  updatedAt: string;
}

/** What deleting a list does with the tasks it holds — the two answers a user can give, and there is no third. */
export type DeleteListMode = "move-to-inbox" | "delete-tasks";

/**
 * Everything the left rail draws, in one fetch: every active list of the
 * profile plus every section of those lists. Two round trips would let the rail
 * render sections for a list that the same render no longer shows.
 */
export interface TaskListsSnapshot {
  /** Root lists first, then each parent's children, every scope in its own rank order. */
  lists: TaskList[];
  /** Grouped by list in that same order, each list's sections in rank order. */
  sections: TaskSection[];
}

export interface TaskListsListRequest {
  profileId: string;
}

/** `parentId` null makes it a root list. */
export interface TaskListsCreateRequest {
  profileId: string;
  name: string;
  parentId: string | null;
}

export interface TaskListsRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

/** The view this list opens in (TASK-005) — the per-list replacement for the old localStorage view memory. */
export interface TaskListsSetViewRequest {
  profileId: string;
  id: string;
  view: TaskListView;
}

/**
 * What this list remembers about its views (ADR-050) — the WHOLE config, never
 * one knob: the page holds the config it is editing, and a per-knob channel
 * would ask main to merge two halves it cannot tell apart. `null` clears it.
 */
export interface TaskListsSetViewConfigRequest {
  profileId: string;
  id: string;
  config: TaskViewConfig | null;
}

/** Re-parents and re-orders in one call: `parentId` names the scope, `beforeId`/`afterId` the live siblings it lands between there (either null at an end). */
export interface TaskListsMoveRequest {
  profileId: string;
  id: string;
  parentId: string | null;
  beforeId: string | null;
  afterId: string | null;
}

/** `mode` is always explicit — what happens to the tasks is the user's answer, never a default. */
export interface TaskListsDeleteRequest {
  profileId: string;
  id: string;
  mode: DeleteListMode;
}

/** Undo of a list delete: brings back the list together with exactly the tasks that delete took down with it. */
export interface TaskListsRestoreRequest {
  profileId: string;
  id: string;
}

export interface TaskSectionsCreateRequest {
  profileId: string;
  listId: string;
  name: string;
}

export interface TaskSectionsRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

/** Re-orders a section within its own list; `beforeId`/`afterId` are its siblings there. */
export interface TaskSectionsMoveRequest {
  profileId: string;
  id: string;
  beforeId: string | null;
  afterId: string | null;
}

/** Deleting a section promotes its tasks to the list body — a heading is not a container things are lost in. */
export interface TaskSectionsDeleteRequest {
  profileId: string;
  id: string;
}

/** Moves a task and its whole live subtree into another list, appended at that list's body end. */
export interface TasksMoveToListRequest {
  profileId: string;
  id: string;
  listId: string;
}

/** Moves one task between the sections of the list it is already in; `null` is the list body. */
export interface TasksMoveToSectionRequest {
  profileId: string;
  id: string;
  sectionId: string | null;
}

/** Re-orders a task between two live neighbours of its own (list, section) scope; either is null at an end of it. */
export interface TasksReorderRequest {
  profileId: string;
  id: string;
  beforeId: string | null;
  afterId: string | null;
}

/**
 * Moves a whole selection into `listId`, under `sectionId` (null = the list
 * body). One transaction in the store: if any id is refused, nothing moves.
 *
 * `ids` is validated element-wise in main and bounded there by `@nexus/db`'s
 * own `MAX_TASK_BULK_IDS` — unlike the name caps above, the renderer never
 * needs the number, so it is not restated here. The same holds for the four
 * batch requests below.
 */
export interface TasksBulkMoveRequest {
  profileId: string;
  ids: string[];
  listId: string;
  sectionId: string | null;
}

export interface TasksBulkPriorityRequest {
  profileId: string;
  ids: string[];
  priority: TaskPriority;
}

/** `null` clears the rok — refused, for the whole batch, where a recurrence rule or a reminder ladder anchors on it. */
export interface TasksBulkDueRequest {
  profileId: string;
  ids: string[];
  dueDate: string | null;
}

export interface TasksBulkDeleteRequest {
  profileId: string;
  ids: string[];
}

/** Undo of a batch delete: the exact id set the delete removed. */
export interface TasksBulkRestoreRequest {
  profileId: string;
  ids: string[];
}

/**
 * Longest task-tag name after trimming. Mirrors the cap `TaskTagStore` enforces
 * (itself copied from `note_tags` — a label is a label whichever entity carries
 * it), redeclared here like `MAX_TASK_LIST_NAME_LENGTH` so the rail's tag input
 * can bound what a user types without importing DB code, and so main can bound
 * the wire without waiting for the store to refuse. The store stays
 * authoritative: it trims and re-checks whatever it is handed.
 */
export const MAX_TASK_TAG_NAME_LENGTH = 50;

/**
 * A task tag as seen by the renderer (mirrors the `task_tags` table via
 * `TaskTagStore`'s mapping, migration 023) — a per-profile label, unique by
 * name. Redeclared here so the renderer never imports DB code; `NoteTag` above
 * is the same shape on a different entity, deliberately.
 */
export interface TaskTag {
  id: string;
  profileId: string;
  name: string;
  createdAt: string;
}

/** One task-tag attachment (mirrors the `task_tag_links` join table, migration 023). */
export interface TaskTagLink {
  taskId: string;
  tagId: string;
}

export interface TaskTagsListRequest {
  profileId: string;
}

/** Get-or-create by trimmed name: an existing tag of this profile comes back rather than being duplicated. */
export interface TaskTagsCreateRequest {
  profileId: string;
  name: string;
}

export interface TaskTagsRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

/** Deleting a tag prunes its attachments through the schema's CASCADE — no task is touched. */
export interface TaskTagsDeleteRequest {
  profileId: string;
  id: string;
}

export interface TaskTagLinksListRequest {
  profileId: string;
}

export interface TaskTagsAttachRequest {
  profileId: string;
  taskId: string;
  tagId: string;
}

export interface TaskTagsDetachRequest {
  profileId: string;
  taskId: string;
  tagId: string;
}

/**
 * A task attachment's index row as seen by the renderer (mirrors the
 * `task_attachments` table via `TaskAttachmentStore`'s mapping, migration 024).
 * `NoteAttachment` below is the same shape on a different entity, deliberately.
 * The attachment's BYTES never cross this boundary at all — unlike a note's,
 * which the renderer hands over once at attach time: a task's files are picked
 * through a native dialog and read by main itself (see
 * `TaskAttachmentsAddRequest`), so every reference here is by `sha256` alone
 * (e.g. an `nx-blob://<sha256>` URL for a thumbnail). Redeclared here so the
 * renderer never imports DB code.
 */
export interface TaskAttachment {
  id: string;
  taskId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface TaskAttachmentsListRequest {
  profileId: string;
  id: string;
}

/**
 * Attaches one or more files to a task. The payload carries NO file data and no
 * path: main opens the native "pick files" dialog itself, reads what the user
 * chose, sniffs each file's real MIME type from its bytes (SEC-FILE-02) and
 * stamps `createdAt` from its own clock.
 *
 * Deliberately different from `note-attachments:add`, which takes the
 * renderer's `bytes` (the note editor also accepts a drag-drop, which has no
 * dialog to open). A form has no such source, so nothing here needs to hand
 * 50 MB across the bridge — and a flow where main owns both the dialog and the
 * read is strictly the smaller attack surface (SEC-EL: the renderer never names
 * a filesystem path).
 */
export interface TaskAttachmentsAddRequest {
  profileId: string;
  id: string;
}

/**
 * The outcome of that dialog: either the user canceled, or `added` files were
 * attached. `skippedTooLarge` counts files main refused for exceeding the store's
 * own byte cap — reported rather than thrown, because refusing one oversize file
 * must not lose the others the same pick succeeded with.
 */
export type TaskAttachmentsAddResult =
  | { canceled: true }
  | { canceled: false; added: number; skippedTooLarge: number };

export interface TaskAttachmentsRemoveRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface TaskAttachmentsOpenRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface TaskAttachmentsSaveAsRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface TaskAttachmentsCountsRequest {
  profileId: string;
}

/**
 * Longest task-template name after trimming. Mirrors
 * `MAX_TASK_TEMPLATE_NAME_LENGTH` in `@nexus/db` — redeclared here, like
 * `MAX_TASK_TAG_NAME_LENGTH` above, so the save prompt can bound what a user
 * types without importing DB code, and so main can bound the wire without
 * waiting for the store to refuse. The store stays authoritative.
 */
export const MAX_TASK_TEMPLATE_NAME_LENGTH = 80;

/**
 * The task-shaped body a template carries (ADR-035), as the renderer sees it —
 * mirrors `@nexus/db`'s `TaskTemplatePayload` via the store's mapping.
 * Redeclared here so the renderer never imports DB code.
 *
 * The renderer never CONSTRUCTS one of these: a template is captured from an
 * existing task by main (`saveTaskTemplateFromTask`) and applied by main
 * (`applyTaskTemplate`), so this type is read-only from the UI's side — which
 * is why there is no "create a template by hand" channel and no validator for
 * one. What the renderer sends is a name and an id, nothing more.
 */
export interface TaskTemplatePayload {
  title: string;
  description: string | null;
  priority: TaskPriority;
  /** Whole days from the day the template is APPLIED to the created task's due date, or null for none. */
  dueOffsetDays: number | null;
  /** Whole days before that computed due date, ascending. */
  reminderOffsets: number[];
  recurrence: RecurrenceRule | null;
  /** Tag NAMES — get-or-created at apply time, so a template survives the deletion of the tag it was captured with. */
  tagNames: string[];
  /** Titles of the direct subtasks the template creates. */
  subtaskTitles: string[];
}

/** A task template as seen by the renderer (mirrors the `task_templates` table, migration 027 / ADR-035). */
export interface TaskTemplate {
  id: string;
  profileId: string;
  name: string;
  payload: TaskTemplatePayload;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTemplatesListRequest {
  profileId: string;
}

/**
 * How many attachments one live task carries — the per-row count chip's whole
 * payload, one entry per task that has any (a task with none is absent, not
 * reported as zero). Mirrors `DeckCounts`' flat-row shape rather than a map,
 * for the same reason: a plain array survives structured clone without a
 * thought.
 */
export interface TaskAttachmentCount {
  taskId: string;
  count: number;
}

/**
 * Captures an existing task as a template under `name` (ADR-035). Main reads the
 * task, its direct live subtasks and its tag names itself — the renderer names
 * only WHICH task and WHAT to call it, so there is no task-shaped payload on the
 * wire to validate or to get wrong. Saving under a name that already exists
 * REPLACES that template, which is the edit mechanism.
 */
export interface TaskTemplatesSaveFromTaskRequest {
  profileId: string;
  taskId: string;
  name: string;
}

/**
 * Creates a task from a template, in `listId` (and `sectionId`, or the list
 * body). The destination is the caller's, never the template's: a template is
 * applied where the user is standing, and one that carried a stored destination
 * would file tasks into a list nobody is looking at. Returns the created PARENT
 * task; its subtasks and tags come back with the page's next refetch.
 */
export interface TaskTemplatesApplyRequest {
  profileId: string;
  templateId: string;
  listId: string;
  sectionId: string | null;
}

/** Deleting a template is final — nothing references one (migration 027). */
export interface TaskTemplatesDeleteRequest {
  profileId: string;
  id: string;
}

/**
 * One dependency edge as seen by the renderer (mirrors the `task_dependencies`
 * join table via `TaskDependencyStore`'s mapping, migration 029 / ADR-037):
 * `blockedId` waits on `blockerId`. Redeclared here so the renderer never
 * imports DB code, exactly as `TaskTagLink` above is.
 *
 * There is no "blocked" flag anywhere on the wire, deliberately: a task is
 * blocked while any of its blockers is live and not done, and the page already
 * holds both the tasks and these pairs — a second, stored answer could only
 * drift from the first.
 */
export interface TaskDependencyLink {
  blockerId: string;
  blockedId: string;
}

export interface TaskDependenciesListRequest {
  profileId: string;
}

/** Adding an edge that already exists is a no-op; a self-edge or one that would close a cycle is refused by the store. */
export interface TaskDependenciesAddRequest {
  profileId: string;
  blockerId: string;
  blockedId: string;
}

/** Removing an edge that is not there is a silent no-op — `detachTaskTag`'s rule. */
export interface TaskDependenciesRemoveRequest {
  profileId: string;
  blockerId: string;
  blockedId: string;
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
  /** The rule that makes this row a series master the calendar expands virtually (ADR-024), or null for a one-off. Anchored on `startAt`'s own day. */
  recurrence: RecurrenceRule | null;
  /** Bare `YYYY-MM-DD` occurrence dates removed from the series, ascending; empty whenever `recurrence` is null. Settable only through `addEventRecurrenceExdate`, never through create/update — hence its absence from the two shapes below. */
  recurrenceExdates: string[];
  /** Whole minutes before the start at which to remind, ascending and duplicate-free (CAL-006); empty for an event with no reminders. Every occurrence of a series carries the master's ladder. */
  reminderOffsets: number[];
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
  recurrence?: RecurrenceRule | null;
  /** Reminder lead times in whole minutes (CAL-006); omitted means none. The store canonicalizes and caps them. */
  reminderOffsets?: number[];
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
  recurrence?: RecurrenceRule | null;
  /** Reminder lead times in whole minutes (CAL-006); an empty array clears every reminder. */
  reminderOffsets?: number[];
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

/** Excepts one bare `YYYY-MM-DD` occurrence from a series (ADR-024). Idempotent; `now` is stamped by main, never accepted from the renderer. */
export interface EventsAddRecurrenceExdateRequest {
  profileId: string;
  id: string;
  date: string;
}

/** Truncates a series so its last occurrence is the day before `occurrenceDate` (ADR-024). `now` is stamped by main, never accepted from the renderer. */
export interface EventsSplitRecurrenceRequest {
  profileId: string;
  id: string;
  occurrenceDate: string;
}

/**
 * Longest event-template name after trimming. Mirrors
 * `MAX_EVENT_TEMPLATE_NAME_LENGTH` in `@nexus/db` — redeclared here, exactly as
 * `MAX_TASK_TEMPLATE_NAME_LENGTH` above is, so the save prompt can bound what a
 * user types without importing DB code, and so main can bound the wire without
 * waiting for the store to refuse. The store stays authoritative.
 */
export const MAX_EVENT_TEMPLATE_NAME_LENGTH = 80;

/**
 * The event-shaped body a template carries (CAL-009), as the renderer sees it —
 * mirrors `@nexus/db`'s `EventTemplatePayload` via the store's mapping.
 * Redeclared here so the renderer never imports DB code.
 *
 * The renderer never CONSTRUCTS one of these, exactly as it never constructs a
 * `TaskTemplatePayload`: a template is captured from an existing event by main
 * and applied by main, so this type is read-only from the UI's side — which is
 * why there is no "create a template by hand" channel and no validator for one.
 * What the renderer sends is a name, an id and a day key, nothing more.
 *
 * Nothing here is a date. A template says "18:30, for ninety minutes, weekly";
 * the DAY comes from wherever it is applied.
 */
export interface EventTemplatePayload {
  title: string;
  allDay: boolean;
  /** Wall-clock `HH:MM` the created event starts at; null on an all-day template. */
  startTime: string | null;
  /** Whole minutes the created event lasts, or null for one with no end. Timed templates only. */
  durationMinutes: number | null;
  location: string | null;
  description: string | null;
  category: string | null;
  /** Whole minutes before the created event's start at which to remind (CAL-006), ascending. */
  reminderOffsets: number[];
  /** The rule the created event's series runs on (ADR-024), or null. Phased from the day the template is applied to. */
  recurrence: RecurrenceRule | null;
}

/** An event template as seen by the renderer (mirrors the `event_templates` table, migration 036 / CAL-009). */
export interface EventTemplate {
  id: string;
  profileId: string;
  name: string;
  payload: EventTemplatePayload;
  createdAt: string;
  updatedAt: string;
}

export interface EventTemplatesListRequest {
  profileId: string;
}

/**
 * Captures an existing event as a template under `name` (CAL-009). Main reads
 * the event and relativizes it itself — the renderer names only WHICH event and
 * WHAT to call it, so there is no event-shaped payload on the wire to validate
 * or to get wrong. Saving under a name that already exists REPLACES that
 * template, which is the edit mechanism.
 */
export interface EventTemplatesCaptureRequest {
  profileId: string;
  eventId: string;
  name: string;
}

/**
 * Creates an event from a template, on `dayKey` (a bare `YYYY-MM-DD`). The day
 * is the caller's, never the template's: a template is applied where the user is
 * standing, and one that carried its own date would rot the moment that date
 * passed.
 */
export interface EventTemplatesApplyRequest {
  profileId: string;
  templateId: string;
  dayKey: string;
}

/**
 * One foreign event as the cross-profile calendar overlay hands it to the
 * renderer (CAL-005, founder decision #4 / ADR-058 §5). Mirrors `@nexus/db`'s
 * `CalendarOverlayEvent` — redeclared like every closed shape here, and main's
 * assignment of the store's rows to this type is the drift check.
 *
 * MINIMIZED by design: no description, no location, no category — data
 * minimization across the trust boundary, so the renderer never even receives
 * what it must not show. No recurrence either: a series arrives already
 * expanded into concrete occurrences (which share the master's `id`; the day
 * tells them apart). `foreign` is always true — stamped at the source so no
 * layer can forget to mark a guest row.
 */
export interface CalendarOverlayEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  foreign: true;
}

/**
 * `calendar:overlay` — the system's ONE cross-profile read. `profileId` names
 * the profile the renderer is SHOWING (main derives the other profile(s) from
 * the profiles list itself, so no other profile's id ever travels
 * renderer→main); `from`/`to` are the visible range's inclusive bare day
 * keys, bounded in main and again in the store (`MAX_OVERLAY_RANGE_DAYS`).
 */
export interface CalendarOverlayRequest {
  profileId: string;
  from: string;
  to: string;
}

/** Deleting a template is final — nothing references one (migration 036). */
export interface EventTemplatesDeleteRequest {
  profileId: string;
  id: string;
}

/**
 * The calendar's per-profile facts (CAL-010 / ADR-054, migration 042) — the
 * semester's fixed dates the Semestar view anchors to. Both bare `YYYY-MM-DD`
 * day keys, both-or-neither: both null means "no term set" and the view slides
 * as it always did. Mirrors `@nexus/db`'s `CalendarSettings`; redeclared so
 * the renderer never imports DB code.
 */
export interface CalendarSettings {
  /** First day of the term; null exactly when `semesterEnd` is. */
  semesterStart: string | null;
  /** Last day of the term, inclusive; never before `semesterStart`. */
  semesterEnd: string | null;
}

/** Reads this profile's calendar settings. Never writes. */
export interface CalendarSettingsRequest {
  profileId: string;
}

/**
 * Writes the WHOLE pair at once — both dates, or both null to clear. One
 * channel rather than per-field setters, because a term with one edge means
 * nothing: main re-checks the pair rule and the order (SEC-EL-02), and the
 * store re-checks both after main.
 */
export interface CalendarSettingsSetRequest extends CalendarSettings {
  profileId: string;
}

/** Closed person-kind domain (mirrors `PERSON_KINDS` in `@nexus/db`; redeclared so the renderer never imports DB code). */
export type PersonKind = "birthday" | "anniversary";

/**
 * A person as seen by the renderer (mirrors the `people` table via the store's
 * mapping, CAL-007 / ADR-026). `month`/`day` are the yearless recurring fact —
 * a birthday recurs forever and has no year attached; `year` is the separately
 * known birth/start year, null when the user never supplied one. Redeclared
 * here so the renderer never imports DB code.
 */
export interface Person {
  id: string;
  profileId: string;
  name: string;
  kind: PersonKind;
  month: number;
  day: number;
  year: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new person; only `year` and `note` are optional (CAL-007). The main process revalidates each. */
export interface NewPersonFields {
  name: string;
  kind: PersonKind;
  month: number;
  day: number;
  year?: number | null;
  note?: string | null;
}

/** A partial edit of a person's own fields; an omitted key is untouched, `null` clears `year`/`note`. */
export interface PersonFieldChanges {
  name?: string;
  kind?: PersonKind;
  month?: number;
  day?: number;
  year?: number | null;
  note?: string | null;
}

export interface PeopleListRequest {
  profileId: string;
}

export interface PeopleCreateRequest {
  profileId: string;
  person: NewPersonFields;
}

export interface PeopleUpdateRequest {
  profileId: string;
  id: string;
  changes: PersonFieldChanges;
}

export interface PeopleDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted person. */
export interface PeopleRestoreRequest {
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

/**
 * A subject material's index row as seen by the renderer (mirrors the
 * `subject_attachments` table via `SubjectAttachmentStore`'s mapping, migration
 * 035). `TaskAttachment` above is the same shape on a different entity,
 * deliberately, and the same rule holds here: the material's BYTES never cross
 * this boundary at all — main opens the native picker and reads the file itself,
 * so every reference is by `sha256` alone (e.g. an `nx-blob://<sha256>` URL for
 * a thumbnail). Redeclared here so the renderer never imports DB code.
 */
export interface SubjectAttachment {
  id: string;
  subjectId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface SubjectAttachmentsListRequest {
  profileId: string;
  id: string;
}

/**
 * Attaches one or more files to a subject. Carries NO file data and no path:
 * main opens the native "pick files" dialog itself, reads what the user chose,
 * sniffs each file's real MIME type from its bytes (SEC-FILE-02) and stamps
 * `createdAt` from its own clock — `task-attachments:add`'s arrangement,
 * verbatim, and for its reason (the renderer never names a filesystem path).
 */
export interface SubjectAttachmentsAddRequest {
  profileId: string;
  id: string;
}

/** The outcome of that dialog — `TaskAttachmentsAddResult`'s shape, with the same meaning for `skippedTooLarge`. */
export type SubjectAttachmentsAddResult =
  | { canceled: true }
  | { canceled: false; added: number; skippedTooLarge: number };

export interface SubjectAttachmentsRemoveRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface SubjectAttachmentsOpenRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface SubjectAttachmentsSaveAsRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

/**
 * A note filed under a subject, as the subject panel draws it (migration 035):
 * enough to render one row and open it through the existing note reveal, and
 * deliberately nothing more — the note's body never comes through here.
 */
export interface LinkedNote {
  id: string;
  title: string;
  updatedAt: string;
  /** When the link was made — the order the section lists them in. */
  linkedAt: string;
}

export interface SubjectNotesLinkedRequest {
  profileId: string;
  id: string;
}

/** Files a live note under a live subject. `now` is stamped by main, never sent. */
export interface SubjectNotesLinkRequest {
  profileId: string;
  id: string;
  noteId: string;
}

export interface SubjectNotesUnlinkRequest {
  profileId: string;
  id: string;
  noteId: string;
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
 * Maximum length of a card side — `CardStore`'s own cap, mirrored on the wire. A
 * cloze template lives under the same cap.
 *
 * **In CHARACTERS, because that is the unit the store measures in**
 * (`trimmed.length`). Validate it with main's `asCappedChars`, never
 * `asCappedString`: the latter counts UTF-8 bytes, and every Serbian letter with
 * a diacritic is two of them, so a byte cap would make this wire stricter than
 * the store it says it mirrors — and stricter *only* for text written in the
 * product's own language. Caps meant in bytes are named `_BYTES` here.
 */
export const CARD_TEXT_MAX_LENGTH = 10_000;

/**
 * Closed card-kind domain (mirrors `@nexus/db`'s `CardKind`, itself mirroring
 * the `cards.kind` CHECK of migration 031). Redeclared here so the renderer
 * never imports DB code.
 */
export type CardKind = "basic" | "cloze";

/**
 * Card kinds in schema order — the closed wire domain a `NoteCardSpec`'s
 * `kind` is validated against. The card editor's form toggle does NOT read
 * this: „Zadatak" is a third FORM, not a third kind (ADR-046), so that toggle
 * has its own three-value union in the renderer.
 */
export const CARD_KINDS: readonly CardKind[] = ["basic", "cloze"];

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
  /**
   * The note and block this card was generated from, or both null for a
   * hand-made card (NOTE-006). A note-sourced card's text is owned by that
   * note's block — STUDY must not offer to edit it, since the next sync
   * would overwrite the edit.
   */
  sourceNoteId: string | null;
  sourceBlockKey: string | null;
  /**
   * What kind of card this is (STUDY-006 / ADR-042). A `cloze` card's
   * `front`/`back` are DERIVED by the store from `clozeText`/`clozeOrdinal`
   * and are never written directly — the reviewer renders the template so the
   * blank stays in its context, and the editor edits the template.
   *
   * `clozeOrdinal` is the deletion's NUMBER (ADR-068): its `{{cN::…}}` label,
   * or its position + 1 when it carries none. 1-based, and never a position —
   * a blank inserted ahead of this one leaves this card asking exactly what it
   * asked before.
   */
  kind: CardKind;
  clozeText: string | null;
  clozeOrdinal: number | null;
  /**
   * A problem card's worked solution (ADR-046): the steps its `back` is
   * DERIVED from, separated by a line that is nothing but `--`. Null for a card
   * with no worked solution. A problem card is a `basic` card with this field
   * set — NOT a third kind — so the reviewer reveals its steps one at a time
   * while the editor edits the steps, never the back.
   */
  problemSteps: string | null;
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

/** Fields for a new BASIC card; `deckId`, `front` and `back` are all required. The main process revalidates each. */
export interface NewCardFields {
  deckId: string;
  front: string;
  back: string;
}

/**
 * A partial edit of a card's own content/placement fields; never touches FSRS
 * scheduling state. Which text field applies is decided by the card's KIND:
 * `front`/`back` for a basic card, `clozeText` for a cloze one — the store
 * refuses the wrong pairing rather than guessing (ADR-042).
 */
export interface CardFieldChanges {
  deckId?: string;
  front?: string;
  back?: string;
  clozeText?: string;
  /**
   * A basic card's worked solution (ADR-046). A string sets the steps and has
   * the store re-derive `back` from them — so `back` is never sent alongside;
   * `null` clears them, leaving a plain basic card. Refused on a cloze card.
   */
  problemSteps?: string | null;
}

export interface CardsListByDeckRequest {
  profileId: string;
  deckId: string;
}

export interface CardsCreateRequest {
  profileId: string;
  card: NewCardFields;
}

/**
 * Creates one cloze card per `{{…}}` deletion in `text` (STUDY-006 /
 * ADR-042), atomically. Only the template crosses the wire: every row's
 * `front`/`back` is derived in the main process by the same grammar the note
 * generator and the reviewer read, so the renderer can never make a cloze
 * card's stored sides disagree with its template.
 */
export interface CardsCreateClozeRequest {
  profileId: string;
  deckId: string;
  text: string;
}

/**
 * Creates one problem card (ADR-046): a BASIC card carrying the worked
 * solution its `back` is derived from. Only the statement and the steps cross
 * the wire — `back` is derived in the main process by the same grammar the
 * editor counts steps with and the reviewer reveals them by, so the renderer
 * can never make a problem card's stored answer disagree with its steps.
 */
export interface CardsCreateProblemRequest {
  profileId: string;
  deckId: string;
  front: string;
  stepsText: string;
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

/**
 * Optional scope for the review queue, hand-mirroring `DueQueueOptions` in
 * `@nexus/db`: at most ONE of `deckId`/`subjectId`/`deckIds` — naming two is
 * refused by the store, not silently resolved — plus the problems-only filter
 * and a cap on New cards.
 *
 * This is the whole wire contract of a session's SELECTION. How a practice
 * session then ORDERS what it gets back (the interleave seed, and that it is a
 * practice session at all) is renderer-only state: the queue answers what is
 * studiable, never in what order the reviewer asks it.
 */
export interface ReviewQueueScope {
  deckId?: string;
  subjectId?: string;
  /** A SET of decks to draw from (ADR-047): the topic-shaped selection interleaved practice is built on. */
  deckIds?: readonly string[];
  /** Keep only problem cards — rows carrying a worked solution (ADR-046); a problem card's `kind` is `basic`, so no kind filter can say this. */
  problemsOnly?: boolean;
  newLimit?: number;
}

/** The review queue under one `ReviewQueueScope`. `now` is stamped by main, never accepted from the renderer. */
export interface ReviewQueueRequest extends ReviewQueueScope {
  profileId: string;
}

/**
 * What one queue fetch answers with (mirrors `ReviewQueue` in `@nexus/db`): the
 * cards, plus whether the profile's daily review cap cut the due section short
 * (STUDY-007).
 *
 * `capReached` is a fact about this QUEUE, not about the setting — a profile
 * with nothing due gets `false`. The end-of-session summary is the one surface
 * that reads it, because "you are finished" and "you have hit today's ceiling"
 * are different things to tell someone.
 */
export interface ReviewQueue {
  cards: Card[];
  capReached: boolean;
}

/**
 * Bounds on the study preferences, mirroring `@nexus/db`'s
 * `study/studySettingsStore.ts` and migration 034's three CHECKs: the same
 * numbers, declared on both sides so neither imports the other. Main
 * re-validates every one of them (SEC-EL-02), and the store re-validates after
 * main.
 */
export const MIN_TARGET_RETENTION = 0.7;
export const MAX_TARGET_RETENTION = 0.97;
export const MAX_NEW_PER_DAY = 100;
export const MAX_REVIEWS_PER_DAY = 1000;

/** The retention a profile that has never chosen one is scheduled at — ts-fsrs's own default, and migration 034's column default. */
export const DEFAULT_TARGET_RETENTION = 0.9;

/** New cards a day for a profile that has never chosen — migration 034's column default. */
export const DEFAULT_NEW_PER_DAY = 20;

/**
 * The retention presets „Ciljana zapamćenost" offers. A closed set rather than a
 * free field: the number is a probability the scheduler aims for, not a
 * quantity anyone has an intuition about at three decimal places, and five
 * sensible steps say everything a slider would.
 */
export const TARGET_RETENTION_PRESETS = [0.8, 0.85, 0.9, 0.93, 0.95] as const;

/** This profile's resolved study preferences (defaults already applied by the store). */
export interface StudySettings {
  /** ts-fsrs's `request_retention`, `MIN_TARGET_RETENTION`..`MAX_TARGET_RETENTION`. */
  targetRetention: number;
  /** How many New cards one day's queue may offer, 0..`MAX_NEW_PER_DAY`. */
  newPerDay: number;
  /** How many reviews one local day may hold, 1..`MAX_REVIEWS_PER_DAY`, or `null` for no cap at all. */
  maxReviewsPerDay: number | null;
}

/** Reads this profile's study preferences. Never writes. */
export interface StudySettingsRequest {
  profileId: string;
}

/** Writes all three preferences at once — they are one form, and a per-field channel would let a renderer leave one of them describing a decision nobody made. */
export interface StudySettingsSetRequest extends StudySettings {
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

/** Closed study-block kind domain (mirrors `@nexus/db`'s `StudyBlockKind`; migration 046's CHECK, ADR-063). */
export type StudyBlockKind = "coverage" | "revision" | "recall";

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
  /** Mon..Sun capacity vector (ADR-063), or null for "every day = dailyMinutes". */
  weekdayMinutes: readonly number[] | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fields for a new plan; the first four are required. `weekdayMinutes` is the
 * optional Mon..Sun vector — null (or absent) means "every day =
 * dailyMinutes". The main process revalidates each and stamps `now`/`today`
 * itself.
 */
export interface NewPlanFields {
  examId: string;
  dailyMinutes: number;
  startDate: string;
  examWeekBoost: boolean;
  weekdayMinutes?: readonly number[] | null;
}

/** A partial edit of a plan's own fields; an omitted key is untouched, and `weekdayMinutes: null` clears the vector. */
export interface PlanFieldChanges {
  dailyMinutes?: number;
  startDate?: string;
  examWeekBoost?: boolean;
  weekdayMinutes?: readonly number[] | null;
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
  /** The topic this block serves (ADR-063), or null on an undifferentiated block. */
  topicId: string | null;
  kind: StudyBlockKind;
  /** A pinned block survives regeneration exactly as done/missed rows do — the user's own hold on a slot. */
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One plan's honesty report (ADR-063 invariant 5), one per plan from
 * `plans:sync-all` (mirrors `@nexus/db`'s `PlanHealth`): `overflowMinutes` is
 * the backlog no remaining day could absorb (the scope-cut conversation's
 * trigger, STUDY-004), and `examPassedBacklogMinutes` the missed time a plan
 * whose exam already passed will never absorb. Never both non-zero.
 */
export interface PlanHealth {
  planId: string;
  overflowMinutes: number;
  examPassedBacklogMinutes: number;
}

/**
 * One plan's scope-cut proposal (STUDY-004; mirrors `@nexus/db`'s
 * `ScopeCutProposal`): the lowest-ranked topics whose removal brings the
 * remaining load inside the remaining capacity. A pure COMPUTATION — nothing
 * is written until the user explicitly accepts it over
 * `plans:accept-scope-cut`, the only wire that ever sets `cut`.
 */
export interface ScopeCutProposal {
  planId: string;
  /** Σ day capacity over the remaining days (effective start .. exam-eve). */
  capacityMinutes: number;
  /** Remaining non-done minutes: future planned blocks plus the missed backlog. */
  loadMinutes: number;
  /** Topic ids to cut, walking the rank list from the bottom; empty when the load already fits. */
  topicIds: readonly string[];
  /** The non-done minutes those cuts would free. */
  freedMinutes: number;
}

/**
 * An exam topic as seen by the renderer (mirrors `@nexus/db`'s
 * `EffectiveExamTopic` — the store's record WITH its effective confidence
 * resolved, ADR-063). Every topics:* channel answers with these, so the
 * renderer renders manual-else-derived confidence and never derives.
 */
export interface ExamTopic {
  id: string;
  profileId: string;
  examId: string;
  name: string;
  /** The user's rank: 0 = the list's top = most important — curriculum order AND scope-cut priority. */
  rank: number;
  /** The user's own 0-100 self-assessment, or null for unknown. */
  confidence: number | null;
  /** The flashcard deck this topic is drilled from, or null for none. */
  deckId: string | null;
  /** Set ONLY via `plans:accept-scope-cut`, cleared ONLY via `topics:restore-to-plan` — never by the machine. */
  cut: boolean;
  /** Manual confidence when set, else derived from a LIVE linked deck, else null — what the weakness column renders. */
  effectiveConfidence: number | null;
  /**
   * A `deckId` whose deck is no longer a live deck of this profile. Such a link
   * derives nothing, so the row draws „Nedostupan špil" where the „izvedeno"
   * hint would have been — the number and the chip never contradict each other.
   */
  deckMissing: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A rank move as the wire carries it: one step toward the top or the bottom. Main clamps an edge move to a no-op. */
export type TopicMoveDirection = "up" | "down";

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

/** Pins or unpins a block (ADR-063): a pinned block survives regeneration exactly as done/missed rows do. */
export interface BlocksSetPinnedRequest {
  profileId: string;
  id: string;
  pinned: boolean;
}

/** Reads one plan's scope-cut proposal (STUDY-004). `today` is stamped by main, never accepted from the renderer. */
export interface PlansScopeCutProposalRequest {
  profileId: string;
  planId: string;
}

/**
 * Accepts a scope cut: marks `topicIds` cut and re-syncs `planId`, answering
 * with its fresh health. The ONLY wire that ever sets `cut` (ADR-063).
 */
export interface PlansAcceptScopeCutRequest {
  profileId: string;
  planId: string;
  topicIds: readonly string[];
}

export interface TopicsListByExamRequest {
  profileId: string;
  examId: string;
}

/** Appends a topic at the bottom rank of an exam; confidence/deck start unset (their own channels set them). */
export interface TopicsCreateRequest {
  profileId: string;
  examId: string;
  name: string;
}

export interface TopicsRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

/** Sets (0-100) or clears (null) the manual confidence. */
export interface TopicsSetConfidenceRequest {
  profileId: string;
  id: string;
  confidence: number | null;
}

/** Sets or clears the topic ↔ deck link; that the deck is live in this profile is the store's semantic re-check. */
export interface TopicsSetDeckRequest {
  profileId: string;
  id: string;
  deckId: string | null;
}

export interface TopicsMoveRequest {
  profileId: string;
  id: string;
  direction: TopicMoveDirection;
}

export interface TopicsDeleteRequest {
  profileId: string;
  id: string;
}

/**
 * Returns one cut topic to the plan (ADR-063) — the ONLY wire that ever clears
 * `cut`. That the id names an active topic of this profile AND that it is
 * actually cut are the store's own named refusals (`PlanStore.restoreScopeCut`).
 */
export interface TopicsRestoreToPlanRequest {
  profileId: string;
  id: string;
}

/**
 * A FINISHED focus session as seen by the renderer (mirrors the `focus_sessions`
 * table via the store's mapping). Redeclared here so the renderer never imports
 * DB code.
 *
 * Since migration 057 this is the one focus session the product has: STUDY's
 * open-ended study timer is `kind: "work"` with `plannedMinutes: null`, and a
 * Pomodoro phase is the same row with a plan. That is why `subjectId` is now
 * **nullable** — a Pomodoro phase usually belongs to no subject — and every
 * reader that joined on it has to say what it does with a subjectless row.
 */
export interface FocusSession {
  id: string;
  profileId: string;
  subjectId: string | null;
  startedAt: string;
  endedAt: string;
  kind: FocusPhaseKind;
  /** Minutes the phase was set for; null for an open-ended session. */
  plannedMinutes: number | null;
  /** Seconds of the span that were paused — never more than the span itself. */
  pausedSeconds: number;
  /** How it ended, or null when nothing was recorded (every pre-057 row). */
  outcome: FocusOutcome | null;
  cycleIndex: number;
  /** Carries no foreign key: the session outlives whatever it pointed at. */
  taskId: string | null;
  /** What it was CALLED at the time — a snapshot, readable after the task is gone. */
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The in-progress focus PHASE for one profile, as tracked by the main process
 * in memory only — it is never a `focus_sessions` row (see that table's doc
 * comment): a crash or app restart simply loses the running timer.
 *
 * Widened in UTIL slice b to carry the whole phase rather than only a subject
 * and a start, because those two fields could describe exactly one timer and
 * the product has one timer for two callers. Everything here except the two
 * pause fields is written verbatim onto the row when the phase ends; `pausedAt`
 * has no column at all, because a paused phase is by definition still running.
 *
 * `subjectId` is nullable and `plannedMinutes` is nullable, and the two
 * nullabilities are what make one shape serve both callers: STUDY starts a
 * subject-scoped phase with no plan, FOKUS a planned phase usually with no
 * subject.
 */
export interface RunningFocusSession {
  subjectId: string | null;
  startedAt: string;
  kind: FocusPhaseKind;
  /** Minutes the phase was set for; null for an open-ended session (STUDY's timer). */
  plannedMinutes: number | null;
  /** Which phase of the running cycle this is; 0 when the caller keeps no count. */
  cycleIndex: number;
  /** What is being worked on. No foreign key — the row outlives whatever it names. */
  taskId: string | null;
  /** What the phase is CALLED, snapshotted onto the row so it stays readable later. */
  label: string | null;
  /** When the CURRENT pause began, or null while the phase runs. Never a column. */
  pausedAt: string | null;
  /** Seconds of pauses that have already ENDED — the running one is `pausedAt`. */
  pausedSeconds: number;
}

/**
 * Starts a focus phase. `startedAt` is stamped by main, never accepted from the
 * renderer (SEC-EL-02) — the renderer says WHAT the phase is, main says when.
 *
 * Every field but `profileId` is optional, and the omitted shape is exactly what
 * `focus:start` meant before this slice: a subjectless, unplanned, uncounted
 * `work` phase.
 */
export interface FocusStartRequest {
  profileId: string;
  subjectId?: string | null;
  kind?: FocusPhaseKind;
  plannedMinutes?: number | null;
  cycleIndex?: number;
  taskId?: string | null;
  label?: string | null;
}

/** Stops the running focus timer, persisting it (unless it ended in the same instant it started). */
export interface FocusStopRequest {
  profileId: string;
}

/** Freezes the running phase's clock. A second pause on an already-paused phase is a no-op. */
export interface FocusPauseRequest {
  profileId: string;
}

/** Folds the current pause into `pausedSeconds` and restarts the clock. A no-op on a running phase. */
export interface FocusResumeRequest {
  profileId: string;
}

export interface FocusStatusRequest {
  profileId: string;
}

/** Mirrors `MAX_FOCUS_LABEL_LENGTH` in `@nexus/db`, so the field can cap its own input; the store stays authoritative. */
export const MAX_FOCUS_LABEL_LENGTH = 200;

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
 * focus minutes, the set of days with any study activity, review counts,
 * study-block totals, and the two named STUDY-013 metrics (cards matured, plan
 * adherence).
 *
 * Every field but `matured.total` is a fact about the requested range;
 * `matured.total` is a live census of the whole collection and rides along
 * because it is the number that gives `matured.inRange` its scale.
 */
export interface StudyStats {
  subjectMinutes: Array<{ subjectId: string; minutes: number }>;
  activityDays: string[];
  reviews: { total: number; perDay: Array<{ day: string; count: number }> };
  blocks: { done: number; missed: number };
  /** Cards that crossed the mature interval threshold in range, and how many are mature now. */
  matured: { inRange: number; total: number };
  /** Study blocks kept vs. let go in range; `ratio` is null when nothing was due. */
  adherence: { done: number; missed: number; ratio: number | null };
}

export interface StatsStudyRequest {
  profileId: string;
  fromDate: string;
  toDate: string;
}

/**
 * One local calendar day of a subject's study log (STUDY-014), as seen by the
 * renderer (mirrors `@nexus/db`'s `StudyLogDay`). Redeclared here so the
 * renderer never imports DB code. Exam names are not carried: the renderer
 * already holds this subject's exams and resolves each id against them.
 */
export interface StudyLogDay {
  day: string;
  reviews: number;
  focusMinutes: number;
  plannedMinutes: number;
  examIds: string[];
}

/** A subject's study log over one bounded range, newest day first, plus whether anything predates it. */
export interface SubjectStudyLog {
  days: StudyLogDay[];
  hasOlder: boolean;
}

/** One bounded page of a subject's study log; both bounds are bare "YYYY-MM-DD" calendar days. */
export interface StudyLogRequest {
  profileId: string;
  subjectId: string;
  fromDay: string;
  toDay: string;
}

/**
 * The source kinds a notification row can carry (mirrors `@nexus/core`'s
 * `NotificationSource`; redeclared here so the renderer never imports core/DB
 * code). All but one are reminders the user can switch on and off;
 * `"security"` (NTF-007) is recorded by main when a security-relevant event
 * actually happens and can never be switched off.
 */
export type NotificationSource =
  | "document"
  | "exam"
  | "study-day"
  | "event"
  | "task"
  | "security"
  | "subscription"
  | "habit";

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
  /** Only ever the toggleable sources — an always-on one (`"security"`) is not an appetite (NTF-007). */
  enabledSources: NotificationSource[];
  /** Which preset the center's plain „Odloži“ button means (NTF-009); the four stay offered explicitly beside it. */
  snoozeDefault: SnoozePreset;
  /** Whether the one-time "how much should Nexus remind you" question has already been put to this profile (NTF-008 / ADR-033). */
  appetiteAsked: boolean;
}

/** A partial patch of NTF settings; an omitted key is left untouched, `null` clears a quiet-hours bound. */
export interface NotificationSettingsChanges {
  quietFrom?: string | null;
  quietTo?: string | null;
  morningHour?: string;
  snoozeDefault?: SnoozePreset;
}

export interface NotificationsCenterListRequest {
  profileId: string;
}

/**
 * Snoozes a notification until an absolute time main resolves from `preset` and
 * its own clock — never accepted from the renderer. `preset` is OPTIONAL: an
 * omitted one means the profile's own `snoozeDefault` (NTF-009), which main
 * reads from the store it is already holding, so the plain „Odloži“ button
 * never has to know what the default currently is.
 */
export interface NotificationsSnoozeRequest {
  profileId: string;
  id: string;
  preset?: SnoozePreset;
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

/**
 * The user's answer to the one-time NTF-008 appetite question (ADR-033).
 * `sources` is the exact set to enable — one of the Settings presets — or
 * `null` for "keep whatever is configured", which is what both "Zadrži
 * podrazumevano" and a dismissal send. Either way the question is marked as
 * asked: it is asked once, ever, and an answer of "don't change anything" is
 * still an answer. Main stamps the clock and then runs one immediate scheduler
 * check, so the reminders held back for the ask fire under the chosen appetite
 * instead of waiting out the next 60-second tick.
 */
export interface NotificationsAppetiteAnswerRequest {
  profileId: string;
  sources: NotificationSource[] | null;
}

/**
 * Maximum size, in bytes, of a single Yjs update accepted by
 * `notes:append-update`. The renderer uses it pre-flight — a merged batch that
 * would exceed it is sent as its individual updates instead — while the main
 * process and the store re-check it authoritatively (renderer input is
 * untrusted, SEC-EL-02). MUST equal `MAX_NOTE_UPDATE_BYTES` in `@nexus/db`:
 * the same wire limit, declared on both sides so neither imports the other
 * (the renderer never pulls DB/Node code into its bundle).
 */
export const NOTE_UPDATE_MAX_BYTES = 262_144;

/**
 * Maximum number of outbound wiki-links `notes:set-links` accepts in one call.
 * MUST equal `MAX_NOTE_LINKS` in `@nexus/db`: the same wire limit, declared on
 * both sides so neither imports the other (NOTE-004).
 */
export const NOTE_LINKS_MAX_COUNT = 500;

/** Maximum number of generated flashcards `notes:cards-sync` accepts for one note. */
export const NOTE_CARDS_MAX_COUNT = 500;

/** Maximum length of a generated card's reconcile key (the block's `cardKey` plus a cloze ordinal). */
export const NOTE_CARD_KEY_MAX_LENGTH = 200;

/**
 * What becomes of a note's generated flashcards when the note is deleted
 * (PRD 09 section 7). The user is asked whenever there is at least one:
 *
 * - `keep` — the cards are detached and live on as ordinary hand-made cards,
 *   FSRS history intact, in the deck they were already studied in. The note
 *   is also unmapped from that deck, so a restore cannot silently regenerate
 *   duplicates of the very cards the user chose to keep.
 * - `delete` — the cards are soft-deleted with the note, in the same act, and
 *   `notes:restore` brings both back together.
 *
 * Omitting it on the wire means `keep`: the disposition that destroys nothing
 * is the only safe default for a field an untrusted renderer may not send.
 */
export type NoteCardDisposition = "keep" | "delete";

/** The two dispositions, for validators on both sides of the boundary. */
export const NOTE_CARD_DISPOSITIONS: readonly NoteCardDisposition[] = ["keep", "delete"];

/**
 * A note's metadata as seen by the renderer (mirrors the `notes` table via
 * `NoteStore`'s mapping, NOTE slice a1 / ADR-012). The document itself is
 * never carried here — that is `notes:load`'s payload. Redeclared here so the
 * renderer never imports DB code.
 */
export interface NoteMeta {
  id: string;
  profileId: string;
  title: string;
  folderId: string | null;
  /** What KIND of note this is (NOTE-002) — at most one `NoteCategory` id, null when uncategorized. */
  categoryId: string | null;
  pinned: boolean;
  /** The deck this note's generated cards go to, null until the author picks one (NOTE-006). */
  cardDeckId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What `notes:duplicate` answers with (NOTE-010). A result rather than a bare
 * `NoteMeta` because the operation has exactly one refusal worth naming: the
 * copy is written through the same `notes:append-update` path every other new
 * note uses, so a document whose merged state exceeds `NOTE_UPDATE_MAX_BYTES`
 * cannot be written in one call. Nothing is left behind when that happens — the
 * whole copy is one transaction — and the UI says which of the two it was
 * rather than guessing.
 */
export type NoteDuplicateResult =
  | { ok: true; note: NoteMeta }
  | { ok: false; reason: "too-large" };

/**
 * One note's persisted Yjs document state (ADR-012): the merged snapshot (or
 * null before the first compaction) plus every update past it, in order. The
 * renderer replays them onto a fresh `Y.Doc` and binds the editor.
 *
 * Binary crosses this boundary as `Uint8Array` over Electron's structured
 * clone — never base64, never JSON. The renderer only ever *sends* opaque
 * update blobs (`notes:append-update`) and *receives* this payload; the
 * per-note `seq` ordering and the compaction lifecycle are owned entirely by
 * the main process and the store (SEC-EL-02) — no renderer input reaches them.
 */
export interface NoteDocPayload {
  title: string;
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
}

/**
 * One version-history checkpoint's metadata as seen by the renderer (mirrors
 * `note_versions` via `NoteStore`'s mapping, ADR-015 / NOTE-008). The
 * snapshot blob itself is `notes:version-load`'s payload, never this one —
 * `notes:versions` returns browse-list metadata only. Redeclared here so the
 * renderer never imports DB code.
 */
export interface NoteVersionMeta {
  coveredSeq: number;
  title: string;
  createdAt: string;
}

/**
 * Maximum size, in bytes, of one template's `content` that
 * `notes:template-save` accepts. MUST equal `MAX_NOTE_TEMPLATE_BYTES` in
 * `@nexus/db`: the same wire limit, declared on both sides so neither
 * imports the other. The renderer uses it pre-flight; the store re-checks
 * it authoritatively (renderer input is untrusted, SEC-EL-02).
 */
export const NOTE_TEMPLATE_MAX_BYTES = 262_144;

/**
 * A user-defined note template as seen by the renderer (mirrors the
 * `note_templates` table via `NoteTemplateStore`'s mapping, ADR-016 /
 * NOTE-009 slice 009-a). `content` is a ProseMirror document, JSON-encoded —
 * never a Yjs snapshot, since a template is never concurrently edited.
 * Redeclared here so the renderer never imports DB code.
 */
export interface NoteTemplate {
  id: string;
  profileId: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * An optional note-list filter (NOTE-002): omitted = every active note,
 * `{ folderId: null }` = unfiled notes, `{ folderId: "<id>" }` = one folder's
 * notes. Presence of the `folderId` key — not its value — distinguishes "all"
 * from "unfiled", so the wire payload either carries the key or omits it.
 */
export interface NotesListRequest {
  profileId: string;
  folderId?: string | null;
}

export interface NotesCreateRequest {
  profileId: string;
}

export interface NotesLoadRequest {
  profileId: string;
  id: string;
}

/**
 * Appends one batched Yjs update (1..256 KB, validated in main AND re-checked
 * in the store) plus the renderer-derived `title` (first non-empty line,
 * ≤ 200 chars after trimming — trust-consistent: the renderer authors the
 * content itself). `now` is stamped by main, never accepted from the renderer.
 */
export interface NotesAppendUpdateRequest {
  profileId: string;
  id: string;
  update: Uint8Array;
  title: string;
}

export interface NotesDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted note. */
export interface NotesRestoreRequest {
  profileId: string;
  id: string;
}

/** Closed note-folder colour domain (mirrors `@nexus/db`; redeclared so the renderer never imports DB code). */
export type NoteFolderColor =
  | "zlato"
  | "bronza"
  | "maslina"
  | "suma"
  | "zad"
  | "ruza"
  | "bordo"
  | "grafit";

/**
 * Which shape the note list draws while a folder is selected (NOTE-002).
 * Mirrors `@nexus/db`'s `NOTE_FOLDER_VIEWS`; redeclared so the renderer never
 * imports DB code. Narrower than `TaskListView` on purpose — a note has neither
 * a select field to make board columns from nor a date to sit on a grid.
 */
export type NoteFolderView = "list" | "cards";

/**
 * A note folder as seen by the renderer (mirrors the `note_folders` table via
 * `NoteOrgStore`'s mapping, NOTE-002). `parentId` is null at the tree's root.
 * Redeclared here so the renderer never imports DB code.
 */
export interface NoteFolder {
  id: string;
  profileId: string;
  parentId: string | null;
  name: string;
  color: NoteFolderColor | null;
  /**
   * The template a note created in this folder opens with (ADR-036), or null.
   * A built-in template's constant id (`BUILTIN_NOTE_TEMPLATE_IDS`,
   * `@nexus/core`) or a `NoteTemplate` row's id. An id the profile can no
   * longer resolve means "no template" — never an error.
   */
  defaultTemplateId: string | null;
  /** Whether a context-free "Nova beleška" (the palette's) files into this folder. At most one folder per profile. */
  isCaptureDefault: boolean;
  /** The shape the note list opens in while this folder is selected (NOTE-002). `"list"` for every folder that predates the toggle. */
  defaultView: NoteFolderView;
  createdAt: string;
  updatedAt: string;
}

/**
 * A note tag as seen by the renderer (mirrors the `note_tags` table via
 * `NoteOrgStore`'s mapping, NOTE-002) — a per-profile label, unique by name.
 * Redeclared here so the renderer never imports DB code.
 */
export interface NoteTag {
  id: string;
  profileId: string;
  name: string;
  createdAt: string;
}

/** One note-tag attachment (mirrors the `note_tag_links` join table, NOTE-002). */
export interface NoteTagLink {
  noteId: string;
  tagId: string;
}

/**
 * A note category as seen by the renderer (mirrors the `note_categories` table
 * via `NoteOrgStore`'s mapping, NOTE-002) — what KIND of note something is:
 * sastanak, ideja, dnevnik, recept. Redeclared here so the renderer never
 * imports DB code.
 *
 * The third organizational axis, and NOT a fourth spelling of the other two: a
 * folder is a place (one per note, hierarchical), a tag is a subject (many per
 * note, flat), a category is a type (exactly one per note, optional, FLAT —
 * there is no `parentId` here, and there will not be one).
 *
 * `color` is a `NoteFolderColor`, reused rather than respelled: there is one
 * swatch palette in this app, and a second eight-value copy of it could drift.
 */
export interface NoteCategory {
  id: string;
  profileId: string;
  name: string;
  color: NoteFolderColor | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteFoldersListRequest {
  profileId: string;
}

export interface NoteFoldersCreateRequest {
  profileId: string;
  input: { parentId: string | null; name: string; color: NoteFolderColor | null };
}

/** A partial edit of a folder's own fields; an omitted key is untouched, `null` clears `color`. */
export interface NoteFolderFieldChanges {
  name?: string;
  color?: NoteFolderColor | null;
}

export interface NoteFoldersUpdateRequest {
  profileId: string;
  id: string;
  fields: NoteFolderFieldChanges;
}

export interface NoteFoldersMoveRequest {
  profileId: string;
  id: string;
  newParentId: string | null;
}

export interface NoteFoldersDeleteRequest {
  profileId: string;
  id: string;
}

/** ADR-036: points a folder at a default template, or clears it with `null`. The store validates the id against built-ins + this profile's templates. */
export interface NoteFoldersSetTemplateRequest {
  profileId: string;
  id: string;
  templateId: string | null;
}

/** ADR-036: moves this profile's quick-capture mark onto one folder, or clears it entirely with `null`. */
export interface NoteFoldersSetCaptureRequest {
  profileId: string;
  /** `null` clears the mark; the store keeps at most one marked folder per profile. */
  id: string | null;
}

/** NOTE-002: the shape the note list opens in while this folder is selected. */
export interface NoteFoldersSetViewRequest {
  profileId: string;
  id: string;
  view: NoteFolderView;
}

export interface NoteTagsListRequest {
  profileId: string;
}

export interface NoteTagsCreateRequest {
  profileId: string;
  name: string;
}

export interface NoteTagsRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

export interface NoteTagsDeleteRequest {
  profileId: string;
  id: string;
}

export interface NoteTagLinksListRequest {
  profileId: string;
}

export interface NoteTagsAttachRequest {
  profileId: string;
  noteId: string;
  tagId: string;
}

export interface NoteTagsDetachRequest {
  profileId: string;
  noteId: string;
  tagId: string;
}

export interface NoteCategoriesListRequest {
  profileId: string;
}

export interface NoteCategoriesCreateRequest {
  profileId: string;
  input: { name: string; color: NoteFolderColor | null };
}

/** A partial edit of a category's own fields; an omitted key is untouched, `null` clears `color`. */
export interface NoteCategoryFieldChanges {
  name?: string;
  color?: NoteFolderColor | null;
}

export interface NoteCategoriesUpdateRequest {
  profileId: string;
  id: string;
  fields: NoteCategoryFieldChanges;
}

export interface NoteCategoriesDeleteRequest {
  profileId: string;
  id: string;
}

/** NOTE-002: what KIND this note is, or `null` to leave it uncategorized. At most one — setting a second REPLACES the first. */
export interface NotesSetCategoryRequest {
  profileId: string;
  noteId: string;
  categoryId: string | null;
}

export interface NotesSetFolderRequest {
  profileId: string;
  noteId: string;
  folderId: string | null;
}

export interface NotesSetPinnedRequest {
  profileId: string;
  noteId: string;
  pinned: boolean;
}

/**
 * Replaces a note's full outbound wiki-link set (NOTE-004). `targetIds` is
 * renderer-declared like `title` on `notes:append-update` — the renderer
 * authors its own document content — and main/the store re-validate: dropping
 * a self-link, an unknown id, or one outside this profile, and capping the
 * count at `NOTE_LINKS_MAX_COUNT` (SEC-EL-02).
 */
export interface NotesSetLinksRequest {
  profileId: string;
  id: string;
  targetIds: string[];
}

export interface NotesBacklinksRequest {
  profileId: string;
  id: string;
}

export interface NotesVersionsRequest {
  profileId: string;
  id: string;
}

export interface NotesVersionLoadRequest {
  profileId: string;
  id: string;
  coveredSeq: number;
}

/** The pre-restore safety checkpoint (ADR-015): main merges only stored state, no renderer bytes involved. */
export interface NotesVersionCaptureRequest {
  profileId: string;
  id: string;
}

export interface NotesTemplatesListRequest {
  profileId: string;
}

/**
 * Saves the open note's content as a template (ADR-016 / NOTE-009). `content`
 * is a JSON-encoded ProseMirror document the renderer authored — the same
 * trust model as `title` on `notes:append-update` — capped at
 * `NOTE_TEMPLATE_MAX_BYTES` on the wire and re-parsed by the store, which
 * requires it to be an object with `type: "doc"`. Saving under an existing
 * template's `name` replaces its content rather than adding a second row:
 * naming IS the edit mechanism, since there is no template editor.
 */
export interface NotesTemplateSaveRequest {
  profileId: string;
  name: string;
  content: string;
}

export interface NotesTemplateRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

export interface NotesTemplateDeleteRequest {
  profileId: string;
  id: string;
}

/**
 * One generated flashcard as the editor reports it: the block's reconcile key,
 * the rendered sides, and — for a card the block's `{{…}}` syntax authored —
 * the template and ordinal they were rendered from (ADR-042). Both cloze
 * fields are set exactly when `kind` is `cloze`; main and `CardStore` both
 * re-check that, and that the ordinal is really in the template.
 */
export interface NoteCardSpec {
  key: string;
  front: string;
  back: string;
  kind: CardKind;
  clozeText: string | null;
  clozeOrdinal: number | null;
}

/**
 * Syncs this note's generated flashcards (NOTE-006): like `title` on
 * `notes:append-update` and `targetIds` on `notes:set-links`, `cards` is
 * renderer-declared derived data about the note's own content — the editor's
 * current read of its `Pitanje :: Odgovor` / `{{cloze}}` blocks — and main
 * plus `CardStore` re-validate it: the note and deck must both be live and in
 * this profile, each key is capped and unique, and the whole call is rejected
 * rather than partially applied.
 */
export interface NotesCardsSyncRequest {
  profileId: string;
  id: string;
  deckId: string;
  cards: NoteCardSpec[];
}

/** Points (or unpoints, with `null`) this note's generated cards at a deck (NOTE-006). */
export interface NotesCardDeckSetRequest {
  profileId: string;
  id: string;
  deckId: string | null;
}

/** How many tasks „Pretvori u zadatke" would make out of this note — the probe the action is offered on. */
export interface NotesChecklistCountRequest {
  profileId: string;
  id: string;
}

/**
 * „Pretvori u zadatke" (NOTE §6): copies this note's checklist out into real
 * TASK rows in `listId`. Unlike `notes:cards-sync`, nothing about the content is
 * renderer-declared — main reads the note's own merged document, so the payload
 * is only the two ids, both re-checked against this profile (the note through
 * `NoteStore`, the list through `TaskListStore`).
 */
export interface NotesChecklistToTasksRequest {
  profileId: string;
  id: string;
  listId: string;
}

/**
 * What „Pretvori u zadatke" made. `created` counts every task written,
 * `completed` how many of those were written already done (a ticked box carried
 * across), and `skipped` the checklist rows that had no text to be a title.
 */
export interface NoteChecklistTasksResult {
  created: number;
  completed: number;
  skipped: number;
}

/**
 * Maximum size, in bytes, of one note attachment `note-attachments:add`
 * accepts. MUST equal `MAX_NOTE_ATTACHMENT_BYTES` in `@nexus/db`: the same
 * wire limit, declared on both sides so neither imports the other (ADR-014 /
 * NOTE-003).
 */
export const NOTE_ATTACHMENT_MAX_BYTES = 52_428_800;

/**
 * A note attachment's index row as seen by the renderer (mirrors the
 * `note_attachments` table via `NoteAttachmentStore`'s mapping, ADR-014 /
 * NOTE-003 slice 003-a). The attachment's bytes never cross this boundary
 * except once, at attach time (`attachNoteFile`'s `bytes` parameter) — every
 * other read/write refers to the blob only by this row's `sha256` (e.g. an
 * `nx-blob:<sha256>` URL for a future inline preview, slice 003-b).
 * Redeclared here so the renderer never imports DB code.
 */
export interface NoteAttachment {
  id: string;
  noteId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface NoteAttachmentsListRequest {
  profileId: string;
  id: string;
}

/**
 * Attaches a file to a note: the renderer sends the raw `bytes` (≤
 * `NOTE_ATTACHMENT_MAX_BYTES`) plus a display-only `fileName` — main sniffs
 * the real MIME type from the bytes themselves (SEC-FILE-02) and never trusts
 * the renderer's claim about what the file is.
 */
export interface NoteAttachmentsAddRequest {
  profileId: string;
  id: string;
  fileName: string;
  bytes: Uint8Array;
}

export interface NoteAttachmentsRemoveRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface NoteAttachmentsOpenRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface NoteAttachmentsSaveAsRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

/**
 * The outcome of a native "save attachment as" dialog (ADR-014 / NOTE-003):
 * either the user canceled, or the blob was copied to `path`. Deliberately a
 * shape of its own rather than a reuse of `ExportResult` — there is no
 * `totalRecords` concept for a single saved file, so forcing that field onto
 * this result would not fit.
 */
export type SaveAttachmentResult = { canceled: true } | { canceled: false; path: string };

/**
 * Which attachment table a `doc:*` request resolves against (ADR-064). A
 * closed union of the three PUBLIC attachment surfaces, deliberately not a
 * module id: PRIV attachments are excluded in v1 (ADR-057's recorded limit),
 * and a table that gains previewable files joins by widening this union, not
 * by satisfying a looser check.
 */
export type DocAttachmentModule = "note" | "task" | "subject";

/**
 * `doc:preview` and `doc:read-text` (ADR-064): the same
 * `{ profileId, id, attachmentId }` triple the per-module open/save-as
 * channels carry — `id` is the owning note/task/subject, exactly as on
 * `*-attachments:open` — plus the module that names the store to resolve it
 * through. The renderer never names a hash; main re-resolves the row and
 * refuses non-previewable mimes by name.
 */
export interface DocPreviewRequest {
  profileId: string;
  module: DocAttachmentModule;
  /** The owning record — a note, task or subject id. */
  id: string;
  attachmentId: string;
}

export type DocReadTextRequest = DocPreviewRequest;

/**
 * Maximum size, in bytes, of a text attachment `doc:read-text` reads (1 MiB,
 * ADR-064). A bigger "text file" is not for reading in a pane: the row keeps
 * „Otvori"/„Sačuvaj kao" and the preview simply is not offered — the renderer
 * pre-checks against the row's `sizeBytes`, and main re-checks both the row
 * and the bytes actually read (the cap is the wire contract, not a UI
 * courtesy).
 */
export const DOC_TEXT_PREVIEW_MAX_BYTES = 1_048_576;

/** What `doc:read-text` answers: the stored display name and the whole decoded text (UTF-8, BOM stripped in main). */
export interface DocTextContent {
  name: string;
  text: string;
}

/**
 * The coarse buckets „Datoteke" filters by. Redeclared here rather than
 * imported, on this file's own rule (see the header): it is a string union, and
 * a copy of one cannot drift silently — `filePrefs.test.ts` pins this array
 * against `@nexus/core`'s `MIME_FAMILIES`, which is the definition both the
 * page's chips and the store's SQL read.
 */
export const DOC_MIME_FAMILIES = ["slika", "pdf", "tekst", "ostalo"] as const;

export type DocMimeFamily = (typeof DOC_MIME_FAMILIES)[number];

/**
 * `doc:list-attachments`' filter. Every field nullable and every combination
 * legal; they compose as AND. `query` is matched, Serbian-folded, against the
 * file name AND the owner's title — a file is as findable by what carries it as
 * by what it is called.
 */
export interface DocAttachmentFilter {
  ownerKind: DocAttachmentModule | null;
  family: DocMimeFamily | null;
  query: string;
}

/**
 * One row of „Datoteke": the attachment's own index row plus the title of
 * whatever carries it. `ownerKind`/`ownerId` are what „Idi na…" deep-links
 * with — the page never navigates by anything it did not get from main.
 *
 * `ownerTitle` may be the empty string (an untitled note has no title, and
 * inventing one here would be the wire making copy); the page draws its own
 * „Bez naslova" for that case.
 */
export interface DocAttachmentEntry {
  id: string;
  ownerKind: DocAttachmentModule;
  ownerId: string;
  ownerTitle: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

/**
 * The browse cap „Datoteke" stops at — the search page's own
 * (`MAX_SEARCH_BROWSE_LIMIT`), not a second number. Declared on the wire so the
 * page can word its "N+" floor without guessing what main did.
 */
export const DOC_ATTACHMENT_LIST_LIMIT = 500;

/** What `doc:list-attachments` answers. `truncated` means there were MORE than the cap: the page must then state its count as a floor, never as a total. */
export interface DocAttachmentList {
  entries: DocAttachmentEntry[];
  truncated: boolean;
}

/**
 * The dashboard's custom background and dim (SET-006 / ADR-041). Four channels,
 * and deliberately none of them carries a path or a byte: main owns the native
 * image picker, reads the file, sniffs its type and writes it into the
 * encrypted blob store, exactly as the task-attachment picker does. The
 * renderer only ever asks — "pick one", "drop it", "dim it this much" — and
 * renders whatever comes back.
 */

/**
 * Maximum size, in bytes, of an image `dashboard:pick-background` will accept.
 * 20 MiB: a wallpaper-sized photograph with room to spare, and small enough
 * that the file is read once into memory without thought. Stat'ed BEFORE the
 * read, so an oversized file is refused without ever being loaded.
 */
export const MAX_BACKGROUND_BYTES = 20_971_520;

/**
 * Maximum dim the slider (and `dashboard:set-dim`) accept. MUST equal
 * `MAX_BACKGROUND_DIM` in `@nexus/db` and migration 030's CHECK: the same
 * bound, declared on both sides so neither imports the other.
 */
export const MAX_BACKGROUND_DIM = 90;

/** The dim a profile that has never touched the slider gets. MUST equal `DEFAULT_BACKGROUND_DIM` in `@nexus/db` and migration 030's column default. */
export const DEFAULT_BACKGROUND_DIM = 40;

/**
 * The dashboard's resolved settings for one profile (defaults already applied
 * by the store). `backgroundHash` is what the renderer turns into an
 * `nx-blob://<hash>` URL — the same read protocol inline note images use; the
 * bytes themselves never cross IPC.
 */
export interface DashboardSettings {
  backgroundHash: string | null;
  backgroundMime: string | null;
  backgroundSizeBytes: number | null;
  backgroundDim: number;
}

/** Why an image the user picked was refused. `too-large` is over `MAX_BACKGROUND_BYTES`; `unsupported-format` is anything the main-process sniff did not recognise as one of the four inline raster formats; `unreadable` is a file that could not be stat'ed or read at all. */
export type DashboardPickErrorCode = "too-large" | "unsupported-format" | "unreadable";

/**
 * The outcome of the native "pick a background" dialog: the user canceled, the
 * file was refused for a NAMED reason (never silently re-encoded), or the
 * settings row now points at it.
 */
export type DashboardPickResult =
  | { status: "canceled" }
  | { status: "rejected"; code: DashboardPickErrorCode }
  | { status: "ok"; settings: DashboardSettings };

export interface DashboardSettingsRequest {
  profileId: string;
}

export interface DashboardSetDimRequest {
  profileId: string;
  /** A whole number, 0..`MAX_BACKGROUND_DIM`. Revalidated in main and again in the store. */
  dim: number;
}

/**
 * The dashboard's widget layout (DASH-002 / ADR-045, migration 032). Six
 * channels, all of them answering with the WHOLE resulting layout rather than
 * with the row they touched: a layout is an ordered list, every mutation can
 * re-space its neighbours, and a renderer that patched one entry locally would
 * be one renumber away from disagreeing with what is stored.
 */

/** How many columns the layout grid has. A size preset spans a whole number of these — see `DASHBOARD_WIDGET_SPANS`. */
export const DASHBOARD_GRID_COLUMNS = 6;

/**
 * The size presets a placed widget may take. MUST equal
 * `DASHBOARD_WIDGET_SIZES` in `@nexus/db`, `WidgetSize` in `@nexus/core` and
 * migration 032's CHECK: one domain, declared on each side so none imports
 * another.
 */
export type DashboardWidgetSize = "S" | "M" | "L";

/**
 * How many of `DASHBOARD_GRID_COLUMNS` each preset spans: a third, a half, the
 * full width. Presets rather than a free resize (PRD 02 DASH OQ#1) — three
 * widths that always tile cleanly beat a drag handle that produces layouts
 * nothing can lay out.
 */
export const DASHBOARD_WIDGET_SPANS: Record<DashboardWidgetSize, number> = {
  S: 2,
  M: 3,
  L: 6,
};

/**
 * One entry of the layout, in the order it is drawn — the array's own order IS
 * the position, so no sort key crosses IPC.
 *
 * `widgetId` is a `moduleId:widgetId` id a module's manifest publishes
 * (`ModuleRegistry.findWidget` resolves one). A layout deliberately KEEPS
 * entries whose widget this build does not publish, or whose module is switched
 * off — a placement must survive a flag being toggled and come back when it is
 * toggled again — so the renderer is what filters, and an unresolvable entry
 * simply draws nothing.
 */
export interface DashboardWidgetInstance {
  /** This PLACEMENT's identity; the same widget may be placed more than once. */
  instanceId: string;
  widgetId: string;
  size: DashboardWidgetSize;
  /**
   * Per-widget JSON text, or null (DASH-004 / ADR-059). Null — and every field
   * the text does not carry — means the widget's own defaults, i.e. exactly
   * how the card ships; the renderer reads it through `parseWidgetConfig`
   * against the contract's `configFields`, never by hand.
   */
  config: string | null;
}

export interface DashboardWidgetsListRequest {
  profileId: string;
  /** The board the layout belongs to (DASH-008 / ADR-055): a named set's id, or null/absent for the default one („Početna“). Main validates and the store gates a non-null id against the profile's own sets. */
  setId?: string | null;
}

/** Places a widget at the end of the layout. No `config`: a fresh placement starts on the widget's own defaults. */
export interface DashboardWidgetsAddRequest {
  profileId: string;
  widgetId: string;
  size: DashboardWidgetSize;
  setId?: string | null;
}

export interface DashboardWidgetsRemoveRequest {
  profileId: string;
  instanceId: string;
  setId?: string | null;
}

export interface DashboardWidgetsSetSizeRequest {
  profileId: string;
  instanceId: string;
  size: DashboardWidgetSize;
  setId?: string | null;
}

/**
 * Writes one placement's per-widget configuration (DASH-004 / ADR-059).
 * `config` is canonical — only the fields that differ from the widget's own
 * defaults, so `{}` clears back to exactly how the card ships. Main revalidates
 * it FIELD BY FIELD against the contract the placement's widget declares in
 * `shared/modules.ts` (SEC-EL-02: the renderer's JSON is never trusted), and
 * the store re-checks the shape.
 */
export interface DashboardWidgetsSetConfigRequest {
  profileId: string;
  instanceId: string;
  config: Record<string, number | string | string[]>;
  setId?: string | null;
}

/** Re-orders one placement: `beforeId`/`afterId` are the placements it lands between, either null at an end — the pair API `task-lists:move` established. */
export interface DashboardWidgetsMoveRequest {
  profileId: string;
  instanceId: string;
  beforeId: string | null;
  afterId: string | null;
  setId?: string | null;
}

/**
 * Named dashboards (DASH-008 / ADR-055). One profile holds any number of named
 * boards („table“) over the one default board, which is NOT a row: „Početna“
 * is `set_id NULL`, undeletable and un-renamable by construction, so it never
 * appears in `sets` and is addressed as `null` everywhere a board is named.
 */

/** MUST equal `MAX_DASHBOARD_SET_NAME_LENGTH` in `@nexus/db` — one domain, declared on each side so neither imports the other. */
export const DASHBOARD_SET_NAME_MAX_LENGTH = 100;

/** One named board as the switcher lists it. No position: the array's own order IS the board order. */
export interface DashboardSetSummary {
  id: string;
  name: string;
}

/**
 * The whole sets state, answered by every set channel: the named boards in
 * board order plus which board is showing (null = „Početna“). Whole rather
 * than per-row, for the reason every widget channel answers with the whole
 * layout — a delete can move the active pointer, and a renderer patching
 * locally would be one fallback away from disagreeing with what is stored.
 */
export interface DashboardSetsState {
  sets: DashboardSetSummary[];
  activeSetId: string | null;
}

/** `dash:create-set`'s answer: the resulting state plus which id the new board got — the caller typically activates it next. */
export interface DashboardSetsCreated extends DashboardSetsState {
  createdSetId: string;
}

export interface DashboardSetsListRequest {
  profileId: string;
}

/** `name` is trimmed in main and re-trimmed in the store, 1..100 characters (SEC-EL-02's usual split). */
export interface DashboardSetCreateRequest {
  profileId: string;
  name: string;
}

export interface DashboardSetRenameRequest {
  profileId: string;
  setId: string;
  name: string;
}

/** Deletes the board AND its widget rows (they are arrangement, not content); the active board falls back to „Početna“ when it was this one. */
export interface DashboardSetDeleteRequest {
  profileId: string;
  setId: string;
}

/** Writes which board the profile is looking at — one choice per profile (ADR-055's recorded limit), not per device. Null returns to „Početna“. */
export interface DashboardSetActivateRequest {
  profileId: string;
  setId: string | null;
}

// --- Finansije (FIN slice b, migration 051) ----------------------------------
//
// Every shape below mirrors `@nexus/db`'s finance stores and is redeclared here
// so the renderer never imports DB code — the rule this whole file follows.
//
// **Money crosses this wire as an INTEGER of minor units, always.** There is no
// field anywhere in this section that carries a decimal string, and that is the
// contract rather than a convention: the renderer parses what the user types
// into minor units before it sends anything (`money.ts`), main re-checks that
// the value is a safe integer, and the store re-checks it again. A channel that
// accepted „12,34" would be the one place a float could enter a ledger that has
// no float anywhere else.

/** Closed account-kind domain (migration 051's CHECK; mirrors `FIN_ACCOUNT_KINDS` in `@nexus/db`). */
export type FinAccountKind = "cash" | "current" | "card" | "savings";

/** The kinds in the order the account form offers them. */
export const FIN_ACCOUNT_KINDS: readonly FinAccountKind[] = ["cash", "current", "card", "savings"];

/** Closed category-kind domain: money coming in, or money going out. */
export type FinCategoryKind = "income" | "expense";

/** The kinds in the order the category form offers them. */
export const FIN_CATEGORY_KINDS: readonly FinCategoryKind[] = ["income", "expense"];

/** Mirrors `MAX_FIN_ACCOUNT_NAME_LENGTH` in `@nexus/db`, so the field can cap its own input; the store stays authoritative. */
export const MAX_FIN_ACCOUNT_NAME_LENGTH = 60;
/** Mirrors `MAX_FIN_CATEGORY_NAME_LENGTH` in `@nexus/db`. */
export const MAX_FIN_CATEGORY_NAME_LENGTH = 60;
/** Mirrors `MAX_FIN_RECURRING_NAME_LENGTH` in `@nexus/db` (FIN slice d). */
export const MAX_FIN_RECURRING_NAME_LENGTH = 60;
/** Mirrors `MAX_FIN_PAYEE_LENGTH` in `@nexus/db`. */
export const MAX_FIN_PAYEE_LENGTH = 120;
/** Mirrors `MAX_FIN_NOTE_LENGTH` in `@nexus/db`. */
export const MAX_FIN_NOTE_LENGTH = 500;

/**
 * An account as the renderer sees it. There is deliberately NO `balance` field,
 * exactly as there is no `balance` column: a balance is DERIVED and arrives on
 * its own channel (`fin-accounts:balances`), so nothing here can go stale
 * against the transactions that make it.
 */
export interface FinAccount {
  id: string;
  profileId: string;
  name: string;
  kind: FinAccountKind;
  /** ISO-4217, upper-case. The ONLY place a currency is decided; nothing converts between two of them. */
  currency: string;
  /** Minor units, INTEGER. A fact about the day the account was added; it never changes as money moves. */
  openingBalance: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One account's derived balance, in that account's own currency. */
export interface FinAccountBalance {
  accountId: string;
  currency: string;
  minorUnits: number;
}

/**
 * A total that is meaningful only together with the currency it is in. Every
 * FIN aggregate answers with a LIST of these and never with a single number,
 * which is what makes a cross-currency sum impossible to ask for rather than
 * merely discouraged — there is no exchange rate this app could honestly use.
 */
export interface FinCurrencyTotal {
  currency: string;
  minorUnits: number;
}

/** Fields for a new account; `openingBalance` absent means 0 — an account opened at nothing. */
export interface NewFinAccountFields {
  name: string;
  kind: FinAccountKind;
  currency: string;
  openingBalance?: number;
}

/** A partial edit of an account's own fields; an omitted key is untouched. `archived` is how the page closes an account without deleting it. */
export interface FinAccountFieldChanges {
  name?: string;
  kind?: FinAccountKind;
  currency?: string;
  openingBalance?: number;
  archived?: boolean;
}

/** A flat category with an income/expense kind; there is no `parentId` to read and none to write. */
export interface FinCategory {
  id: string;
  profileId: string;
  name: string;
  kind: FinCategoryKind;
  createdAt: string;
  updatedAt: string;
}

/**
 * One category's standing monthly allowance in ONE currency (FIN slice c).
 * Per currency because there is no FX to fold two of them with, and only ever
 * on an EXPENSE category: a budget is a LIMIT, while income would want a
 * TARGET, which compares the opposite way. The store refuses the income case by
 * name.
 */
export interface FinBudget {
  id: string;
  profileId: string;
  categoryId: string;
  currency: string;
  /** Minor units, INTEGER, always positive — an allowance of nothing is `clearFinBudget`, not a zero. */
  amount: number;
  createdAt: string;
  updatedAt: string;
}

/** What „Postavi budžet" sends: which category, in which currency, how much. */
export interface NewFinBudgetFields {
  categoryId: string;
  currency: string;
  amount: number;
}

/** An inclusive span of local days — the shape both report reads are asked over. */
export interface FinPeriod {
  from: string;
  to: string;
}

/**
 * What one category cost over a period, in ONE currency. `categoryId` null is
 * the uncategorized line: real money the user has not labelled, reported rather
 * than folded into anything. `minorUnits` is POSITIVE for ordinary spending and
 * NEGATIVE when the period's refunds outweighed its purchases — the page says
 * so in words rather than clamping it into a lie.
 */
export interface FinCategorySpend {
  categoryId: string | null;
  currency: string;
  minorUnits: number;
}

/**
 * One movement of money. A TRANSFER between the user's own accounts is this
 * SAME row with `counterAccountId` filled — never a pair of rows: `amount` is
 * signed from `accountId`'s point of view, so the counter account receives
 * `-amount`, and the two halves of a transfer are one fact that cannot fall out
 * of step with itself. A transfer never carries a category, and its two sides
 * must share a currency (there is no FX); the store refuses both by name.
 */
export interface FinTransaction {
  id: string;
  profileId: string;
  accountId: string;
  counterAccountId: string | null;
  categoryId: string | null;
  /** The LOCAL day, as a bare `YYYY-MM-DD`. */
  date: string;
  /** Minor units, INTEGER, never zero. Negative leaves `accountId`, positive arrives in it. */
  amount: number;
  payee: string | null;
  note: string | null;
  /**
   * The subscription that generated this charge (FIN slice d), or null for a
   * typed one. READ-ONLY on this wire: no create or update payload carries it,
   * because only main's generation pass ever writes it — the row is otherwise an
   * ordinary transaction, editable and deletable exactly like a typed one.
   */
  recurringId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One recurring charge (FIN slice d, migration 053): a transaction TEMPLATE plus
 * an ADR-024 schedule — the same `RecurrenceRule` a task and an event carry, so
 * the renderer edits it with the very `RecurrencePicker` those two use.
 *
 * `amount` is signed exactly as a transaction's is, and there is no
 * `counterAccountId`: a subscription is never a transfer.
 */
export interface FinRecurring {
  id: string;
  profileId: string;
  accountId: string;
  categoryId: string | null;
  name: string;
  /** Minor units, INTEGER, never zero. Negative leaves `accountId`, positive arrives in it. */
  amount: number;
  payee: string | null;
  note: string | null;
  recurrence: RecurrenceRule;
  /** The bare day the rule phases from, and the series' first possible charge. */
  startDate: string;
  /**
   * The first occurrence NOT yet charged, or null once the series is spent. A
   * CURSOR, not a promise: nothing is posted for it until that day has arrived.
   */
  nextRun: string | null;
  /** Whole days before a charge to remind, or null for „ne podsećaj me". */
  reminderDays: number | null;
  /**
   * When its owner paused the charging (ADR-074), or null while it charges. A
   * paused subscription is still LISTED and still editable — that is the whole
   * difference from deleting it — but it generates nothing and places no renewal
   * in `finUpcomingRenewals`, so the calendar, the dashboard card and the
   * reminders go quiet about it together. Written only by the two channels
   * below, never by an update payload.
   */
  pausedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new subscription; `reminderDays` absent means no renewal reminder. */
export interface NewFinRecurringFields {
  accountId: string;
  categoryId?: string | null;
  name: string;
  amount: number;
  payee?: string | null;
  note?: string | null;
  recurrence: RecurrenceRule;
  startDate: string;
  reminderDays?: number | null;
}

/**
 * A partial edit; an omitted key is untouched, an explicit `null` clears a
 * nullable field. Changing `startDate` or `recurrence` re-anchors the cursor —
 * a different schedule is a different series — while the charges already
 * generated stay exactly where they are.
 */
export interface FinRecurringFieldChanges {
  accountId?: string;
  categoryId?: string | null;
  name?: string;
  amount?: number;
  payee?: string | null;
  note?: string | null;
  recurrence?: RecurrenceRule;
  startDate?: string;
  reminderDays?: number | null;
}

/**
 * One renewal the SCHEDULE places inside a window — derived from the rule on
 * every read and never stored, which is exactly why nothing is posted ahead of
 * time. Carries the account's currency, because an amount without one is a
 * number rather than money.
 */
export interface FinUpcomingRenewal {
  recurringId: string;
  /** The bare day the charge falls on. */
  date: string;
  name: string;
  accountId: string;
  currency: string;
  categoryId: string | null;
  amount: number;
}

/** An inclusive span of local days — the window `fin-recurring:upcoming` answers over. */
export interface FinRenewalWindow {
  from: string;
  to: string;
}

/** Fields for a new transaction; `counterAccountId` is what makes it a transfer. */
export interface NewFinTransactionFields {
  accountId: string;
  counterAccountId?: string | null;
  categoryId?: string | null;
  date: string;
  amount: number;
  payee?: string | null;
  note?: string | null;
}

/** A partial edit; an omitted key is untouched, an explicit `null` clears a nullable field. */
export interface FinTransactionFieldChanges {
  accountId?: string;
  counterAccountId?: string | null;
  categoryId?: string | null;
  date?: string;
  amount?: number;
  payee?: string | null;
  note?: string | null;
}

export interface FinAccountsListRequest {
  profileId: string;
}

export interface FinAccountsCreateRequest {
  profileId: string;
  account: NewFinAccountFields;
}

export interface FinAccountsUpdateRequest {
  profileId: string;
  id: string;
  changes: FinAccountFieldChanges;
}

export interface FinAccountsDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: the account and every transaction it carries come back together. */
export interface FinAccountsRestoreRequest {
  profileId: string;
  id: string;
}

export interface FinCategoriesListRequest {
  profileId: string;
}

export interface FinCategoriesCreateRequest {
  profileId: string;
  name: string;
  kind: FinCategoryKind;
}

/** Renames a category. The KIND is deliberately not patchable — flipping it would silently re-classify every transaction filed under it. */
export interface FinCategoriesRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

/** A HARD delete, unlike an account's: the transactions filed under it survive, uncategorized (migration 051's `ON DELETE SET NULL`). */
export interface FinCategoriesDeleteRequest {
  profileId: string;
  id: string;
}

export interface FinBudgetsListRequest {
  profileId: string;
}

/** Sets or re-sets one allowance. An existing one for the same `(category, currency)` keeps its id and takes the new amount — re-setting a limit is not a new limit. */
export interface FinBudgetsSetRequest {
  profileId: string;
  budget: NewFinBudgetFields;
}

/** Clears ONE currency's allowance on a category, leaving any allowance it has in another currency standing. */
export interface FinBudgetsClearRequest {
  profileId: string;
  categoryId: string;
  currency: string;
}

export interface FinTransactionsListRequest {
  profileId: string;
}

export interface FinTransactionsCreateRequest {
  profileId: string;
  transaction: NewFinTransactionFields;
}

export interface FinTransactionsUpdateRequest {
  profileId: string;
  id: string;
  changes: FinTransactionFieldChanges;
}

export interface FinTransactionsDeleteRequest {
  profileId: string;
  id: string;
}

export interface FinTransactionsRestoreRequest {
  profileId: string;
  id: string;
}

/** Both report reads take the same inclusive day span; `from` after `to` is refused by the store. */
export interface FinTransactionsSpendRequest {
  profileId: string;
  period: FinPeriod;
}

export interface FinTransactionsIncomeRequest {
  profileId: string;
  period: FinPeriod;
}

export interface FinRecurringListRequest {
  profileId: string;
}

/** The window the rules are expanded over; `from` after `to` is refused by the store. */
export interface FinRecurringUpcomingRequest {
  profileId: string;
  window: FinRenewalWindow;
}

export interface FinRecurringCreateRequest {
  profileId: string;
  subscription: NewFinRecurringFields;
}

export interface FinRecurringUpdateRequest {
  profileId: string;
  id: string;
  changes: FinRecurringFieldChanges;
}

export interface FinRecurringDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete. The cursor is where it was, so the next check catches up whatever came due meanwhile — and a subscription deleted while PAUSED comes back paused. */
export interface FinRecurringRestoreRequest {
  profileId: string;
  id: string;
}

/** Stops the charging without giving the subscription up (ADR-074). Main stamps the moment. */
export interface FinRecurringPauseRequest {
  profileId: string;
  id: string;
}

/**
 * Starts the charging again, re-anchoring the cursor to the first occurrence the
 * rule places on or after TODAY — main's local day, never the renderer's, like
 * every other clock on this wire. The occurrences the pause skipped are not
 * back-charged: that is the whole difference between pausing and deleting.
 */
export interface FinRecurringResumeRequest {
  profileId: string;
  id: string;
}

// --- Navike (HABIT slice b, migration 055) -----------------------------------
//
// Every shape below mirrors `@nexus/db`'s habit store and `@nexus/core`'s
// schedule vocabulary, redeclared here so the renderer never imports either —
// the rule this whole file follows.
//
// **A habit carries NO recurrence rule, and that is the module's central
// decision rather than an omission.** `RecurrenceRule` above answers „when does
// this next occur"; a habit needs „was this period satisfied", and the rule
// language can express schedules over which a streak is undefinable (`until`,
// `count`, „every 3rd Tuesday"). `packages/core/src/habits/habitSchedule.ts`
// carries the argument in full. Two kinds here, and there will not be a third.

/** Mirrors `HABIT_MIN_WEEKDAY` in `@nexus/core`: ISO-8601 weekdays, 1 = Monday … 7 = Sunday — deliberately NOT `RecurrenceWeekday`'s 0-based index. */
export const HABIT_MIN_WEEKDAY = 1;
/** Mirrors `HABIT_MAX_WEEKDAY` in `@nexus/core`. */
export const HABIT_MAX_WEEKDAY = 7;
/** Mirrors `HABIT_MAX_PER_WEEK` — seven, because an eighth day does not exist. */
export const HABIT_MAX_PER_WEEK = 7;
/** Mirrors `MAX_HABIT_NAME_LENGTH` in `@nexus/db`, so the field can cap its own input; the store stays authoritative. */
export const MAX_HABIT_NAME_LENGTH = 60;
/** Mirrors `MAX_HABIT_UNIT_LENGTH` in `@nexus/db` — „čaša", „km", „strana": a unit is a word, not a sentence. */
export const MAX_HABIT_UNIT_LENGTH = 16;
/** Mirrors `MAX_HABIT_COUNT` in `@nexus/db` — the ceiling on a `target` and on a day's `value`. */
export const MAX_HABIT_COUNT = 100_000;

/**
 * When a habit is expected. Mirrors `@nexus/core`'s `HabitSchedule` exactly,
 * redeclared for `RecurrenceRule`'s reason — main runs core's
 * `validateHabitSchedule` over the wire payload and assigns the result into the
 * store's input, so drift in either direction is a compile error rather than a
 * wire that quietly carries a schedule no streak can be computed over.
 *
 * `days` — the listed ISO weekdays, sorted and unique. „Svaki dan" is all seven
 * spelled out, not a kind of its own. `quota` — any `perWeek` days inside a
 * week, whichever ones; the week's boundaries are the DEVICE's first-day
 * preference, which is why nothing computing over this type ever guesses them.
 */
export type HabitSchedule =
  | { kind: "days"; weekdays: number[] }
  | { kind: "quota"; perWeek: number };

/**
 * One habit as the renderer sees it.
 *
 * `target` null is a BINARY habit whose tick is worth 1; a non-null target makes
 * a day count once its entry reaches it — one nullable field is what makes
 * „teretana" and „8 čaša vode" the same model. `unit` names what the target
 * counts and is meaningless without one, which both the schema and the store
 * refuse.
 *
 * `archivedAt` and `deletedAt` are INDEPENDENT (migration 055): a habit you have
 * finished with is not one you threw away — its history is the point. So an
 * archived habit is still on this list, still editable, and simply stays out of
 * „Danas". There is no `deletedAt` here at all, because a deleted habit is not
 * returned.
 *
 * `reminderTime` rides this wire. When this slice landed nothing read it, so no
 * form offered it — a control that silently does nothing is worse than an absent
 * one. It has a control now, and that is the rule working rather than the rule
 * being broken: HABITS' header switch reveals a `type="time"` field for it,
 * `habitReminder.ts` turns the field into reminder rows, and `notifications.ts`
 * delivers them.
 */
export interface Habit {
  id: string;
  profileId: string;
  name: string;
  /** A `note_folders` swatch key, reused rather than respelled — the app has exactly one palette. */
  color: NoteFolderColor | null;
  schedule: HabitSchedule;
  /** Whole units a day must reach to count, or null for a binary habit. */
  target: number | null;
  /** What `target` counts, or null. Never set without a target. */
  unit: string | null;
  /** Wall-clock `HH:MM`, or null. Written by HABITS' reminder switch, read by `habitReminder.ts`. */
  reminderTime: string | null;
  /** When the user finished with this habit, or null while it is current. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One day's tick. At most one per habit per day — that is the SCHEMA's promise
 * (`UNIQUE (habit_id, entry_date)`), not a guard anybody has to remember.
 * `value` is never zero: an untick is `habits:clear-entry`, not a zero row.
 */
export interface HabitEntry {
  id: string;
  habitId: string;
  /** The bare local day, `YYYY-MM-DD`. */
  date: string;
  /** Whole units done that day; 1 for a binary habit. */
  value: number;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new habit; an absent optional key means null. */
export interface NewHabitFields {
  name: string;
  color?: NoteFolderColor | null;
  schedule: HabitSchedule;
  target?: number | null;
  unit?: string | null;
  reminderTime?: string | null;
}

/**
 * A partial edit; an omitted key is untouched, an explicit `null` clears a
 * nullable field. Changing the SCHEDULE leaves every entry exactly where it is
 * — a tick is a fact about a day that happened, and re-reading the old days
 * under the new schedule is what makes the streak recompute correctly.
 */
export interface HabitFieldChanges {
  name?: string;
  color?: NoteFolderColor | null;
  schedule?: HabitSchedule;
  target?: number | null;
  unit?: string | null;
  reminderTime?: string | null;
}

/** An inclusive span of local days — the window `habits:entries` answers over. */
export interface HabitDayRange {
  from: string;
  to: string;
}

export interface HabitsListRequest {
  profileId: string;
}

export interface HabitsCreateRequest {
  profileId: string;
  habit: NewHabitFields;
}

export interface HabitsUpdateRequest {
  profileId: string;
  id: string;
  changes: HabitFieldChanges;
}

/** A soft delete. The entries are UNTOUCHED, so a restore brings the habit back with every tick it ever had. */
export interface HabitsDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of that delete — and a habit thrown away while archived comes back archived, because the archiving was never about whether it was on screen. */
export interface HabitsRestoreRequest {
  profileId: string;
  id: string;
}

/** „Gotov sam s ovim": the habit leaves „Danas" and keeps its history. Main stamps the moment. */
export interface HabitsArchiveRequest {
  profileId: string;
  id: string;
}

export interface HabitsUnarchiveRequest {
  profileId: string;
  id: string;
}

/**
 * Records what was done on one DAY, replacing whatever that day said before.
 * `value` is 1 for a binary habit and the count for a measured one; whether the
 * day COUNTS is read off the habit's own `target` and never stored, so a target
 * the user later raises re-judges the days already recorded.
 *
 * **`day` is DATA, and that is not a weakening of the clock rule (slice c).**
 * Slice b carried no day at all and let main stamp `localToday()`, which read as
 * the stricter design and was in fact a missing feature: a user who forgot to
 * tick yesterday could not fix it, while the history grid sat right there showing
 * the miss. The rule main's stamping actually protects is „the renderer may not
 * lie about NOW" — and it still holds, because nothing here asks what today is.
 * A day the user deliberately names by clicking a cell in their own history is
 * input, exactly as a FIN transaction's `tx_date` is: chosen by the user,
 * validated by main, and never taken as a claim about the clock.
 *
 * So main validates it as a real bare `YYYY-MM-DD` and refuses two kinds of day
 * outright: one AFTER `localToday()` — the future is not a fact about a habit,
 * and the clock main reads is what makes that refusal meaningful — and one before
 * the habit's own `createdAt`, because the grid draws those as unjudged for a
 * reason and a tick there would invent history for a period the habit did not
 * exist in.
 *
 * The „Danas" controls send today, and now say so explicitly rather than relying
 * on main to guess what they meant.
 */
export interface HabitsSetEntryRequest {
  profileId: string;
  habitId: string;
  /** The bare local day this tick is FOR (`YYYY-MM-DD`) — never after today, never before the habit. */
  day: string;
  value: number;
}

/** Un-ticks one day, on exactly the terms above. Removing a tick that is not there is not an error; naming a habit this profile does not have still is. */
export interface HabitsClearEntryRequest {
  profileId: string;
  habitId: string;
  /** The bare local day being un-ticked, validated exactly as `HabitsSetEntryRequest.day` is. */
  day: string;
}

/** Every live habit's ticks over one inclusive day span; `from` after `to` is refused by the store. */
export interface HabitsEntriesRequest {
  profileId: string;
  range: HabitDayRange;
}

// --- Ishrana (FIT slice b, migration 058) ------------------------------------
//
// The module's whole wire, and two of slice a's decisions run through every
// shape below rather than being restated by any of them.
//
// **A logged item carries a SNAPSHOT, and main is what takes it.** The seven
// per-100 g numbers are copied in when the item is logged and never re-read
// afterwards: the catalogue ships inside the app and changes between builds, a
// user's own food can be corrected at any moment, and a log that silently
// rewrote yesterday's calories would be a lying log. Which is why
// `FitItemAddRequest` carries a REFERENCE and a weight and nothing else — see
// the channel block's own comment.
//
// **The catalogue is not a table.** `FitFoodOption` is what a merged search
// answers with: a catalogue entry and one of the profile's own foods, side by
// side, told apart only by their `ref`. There is no create/update/delete for a
// catalogue food anywhere on this wire, because there is no row to touch.

/** Mirrors `MAX_FIT_FOOD_NAME_LENGTH` in `@nexus/db` — CHARACTERS, so the field can cap its own input; the store stays authoritative. */
export const MAX_FIT_FOOD_NAME_LENGTH = 80;
/** Mirrors `MAX_FIT_FOOD_NOTES_LENGTH` — the sentence a user writes about their own food. */
export const MAX_FIT_FOOD_NOTES_LENGTH = 500;
/** Mirrors `MAX_FIT_FOOD_SERVINGS` — past a dozen a shortcut list stops being a shortcut. */
export const MAX_FIT_FOOD_SERVINGS = 12;
/** Mirrors `MAX_FIT_SERVING_LABEL_LENGTH` — „1 kašika", „1 kriška". */
export const MAX_FIT_SERVING_LABEL_LENGTH = 40;
/** Mirrors `MAX_FIT_FOOD_QUERY_LENGTH` — a picker's box, not a document. */
export const MAX_FIT_FOOD_QUERY_LENGTH = 100;
/** Mirrors `MAX_FIT_FOOD_RESULTS` — how many foods one search answers with, catalogue and user foods together. */
export const MAX_FIT_FOOD_RESULTS = 50;
/** Mirrors `MAX_FIT_NUTRIENT` — the ceiling on any single per-100 g figure. */
export const MAX_FIT_NUTRIENT = 100_000;
/** Mirrors `MAX_FIT_SERVING_GRAMS` — a serving weighs something a person eats. */
export const MAX_FIT_SERVING_GRAMS = 10_000;
/** Mirrors `MAX_MEAL_ITEM_GRAMS` — one logged portion; ten kilograms is not a portion. */
export const MAX_MEAL_ITEM_GRAMS = 10_000;
/** Mirrors `MAX_FIT_TARGET` — the ceiling on a daily goal a progress bar divides by. */
export const MAX_FIT_TARGET = 100_000;

/**
 * The seven per-100 g numbers, the household measures, the seventeen shelves and
 * the provenance union — `@nexus/core`'s own, re-exported so a page reads the
 * whole food vocabulary off this one contract. See the import at the top of this
 * file for why these four are imported rather than redeclared.
 */
export type { FoodCategory, FoodMacros, FoodServing, FoodSource };

/**
 * The five slots a Serbian day is eaten in, in the order a day happens. Mirrors
 * `MEAL_SLOTS` in `@nexus/db` AND migration 058's own CHECK — main assigns this
 * type into the store's `MealSlot`, so a member added on one side and not the
 * other is a compile error rather than a row the database refuses at runtime.
 */
export const FIT_MEAL_SLOTS = ["dorucak", "uzina1", "rucak", "uzina2", "vecera"] as const;

export type FitMealSlot = (typeof FIT_MEAL_SLOTS)[number];

/**
 * One food a picker may offer — a catalogue entry or one of the profile's own,
 * in one shape, told apart by `ref`.
 *
 * `ref` is `catalogue:<id>` or `user:<uuid>` and is the ONLY thing the renderer
 * ever sends back to log this food: main resolves it and takes the snapshot, so
 * the numbers below are what the user was shown AND what gets recorded, without
 * the renderer being trusted with either.
 *
 * `source` is null for a user's own food, and that absence is deliberate rather
 * than missing data — a catalogue entry must cite something anyone can re-check
 * because the APP is asserting the number, while somebody's own „mamin ajvar" is
 * their claim about their own food. Everything else carries its provenance so
 * the page can answer „odakle ovaj broj", and a `stated` entry carries its
 * uncertainty in `basis`/`range` for the same reason.
 */
export interface FitFoodOption {
  ref: string;
  name: string;
  category: FoodCategory;
  per100g: FoodMacros;
  servings: FoodServing[];
  notes: string;
  /** Where the number came from, or null for a food the user typed themselves. */
  source: FoodSource | null;
}

/** One of the profile's own foods, as the „Moje namirnice" list reads it. */
export interface FitFood {
  id: string;
  profileId: string;
  name: string;
  category: FoodCategory;
  per100g: FoodMacros;
  servings: FoodServing[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new user food; an absent optional key means „none". */
export interface NewFitFoodFields {
  name: string;
  category: FoodCategory;
  per100g: FoodMacros;
  servings?: FoodServing[];
  notes?: string;
}

/** A partial edit. An omitted key is untouched; `servings` and `notes` are replaced wholesale when given. */
export interface FitFoodFieldChanges {
  name?: string;
  category?: FoodCategory;
  per100g?: FoodMacros;
  servings?: FoodServing[];
  notes?: string;
}

/**
 * One logged item, snapshot included. `foodRef` is provenance rather than a key
 * — the food it names may be a catalogue entry this build no longer ships, or a
 * user food since deleted, and `label` plus `per100g` are what keep the row
 * readable either way.
 */
export interface FitMealItem {
  id: string;
  profileId: string;
  /** The bare local day, `YYYY-MM-DD`. */
  date: string;
  slot: FitMealSlot;
  foodRef: string;
  label: string;
  grams: number;
  per100g: FoodMacros;
  createdAt: string;
  updatedAt: string;
}

/**
 * One day of the food diary: the five slots and the day's own total, in ONE
 * answer. Both halves come back together because the page draws them together —
 * a render holding the rows but not the total they add up to would show a figure
 * that no longer follows from the list above it.
 *
 * Every slot is present; an unused one is an empty array, so the page draws five
 * sections without asking which exist.
 */
export interface FitDay {
  day: string;
  slots: Record<FitMealSlot, FitMealItem[]>;
  /** The day's total, summed by the store from the same rows — never a second arithmetic. */
  totals: FoodMacros;
}

/**
 * One day's total, for the range read the energy tiers stand on.
 *
 * A day with nothing logged is simply NOT in the answer — the store's own rule,
 * and the one this read depends on most: „nisam jeo" and „nisam upisao" are
 * different facts, the store knows only the second, and tier 1's 80 % coverage
 * refusal is built on being able to tell them apart. A zero row here would make
 * a fortnight of forgetting look like a fortnight of fasting.
 */
export interface FitDayTotals {
  day: string;
  totals: FoodMacros;
}

/** An inclusive span of local days. The store caps how wide it may be. */
export interface FitDayTotalsRangeRequest {
  profileId: string;
  from: string;
  to: string;
}

/**
 * The profile's daily goals. Every one is independently nullable and NULL means
 * „no goal" — never zero: „nisam postavio cilj kalorija" and „moj cilj je nula"
 * are different claims, and the schema, the store and this wire all keep them
 * apart. `updatedAt` is null EXACTLY when no row exists, which is how „nikad
 * nisam ni gledao" is told from „postavio pa obrisao".
 */
export interface FitTargets {
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  updatedAt: string | null;
}

/** What „Sačuvaj" sends: all four goals, every time — see `FitTargetStore.save` for why there is no patch. */
export type FitTargetGoals = Omit<FitTargets, "updatedAt">;

/** A merged search over the catalogue and this profile's own foods. A blank query answers NOTHING rather than everything. */
export interface FitFoodSearchRequest {
  profileId: string;
  query: string;
  limit: number;
}

/**
 * One day of the diary. `day` is DATA — a day the user named with the page's own
 * navigation, exactly as a habit's corrected tick is (`HabitsSetEntryRequest`) —
 * and main validates it as a real bare date.
 */
export interface FitDayRequest {
  profileId: string;
  day: string;
}

/**
 * Logs one item. Carries the REFERENCE and the weight, and deliberately neither
 * the label nor the macros: main resolves the reference and writes the snapshot
 * from what it resolved. See the channel block for why that boundary is the
 * module's, not a courtesy.
 *
 * `day` may be any past day — correcting yesterday's lunch is the ordinary use —
 * but never one after today: a meal is a fact about a day that happened, and
 * main's clock is what makes that refusal meaningful.
 */
export interface FitItemAddRequest {
  profileId: string;
  day: string;
  slot: FitMealSlot;
  /** `catalogue:<id>` or `user:<uuid>`; main refuses one it cannot resolve. */
  foodRef: string;
  grams: number;
}

/**
 * Corrects how much, or which meal it belonged to. Never the food, its label or
 * its snapshot — swapping those would be logging a different thing while keeping
 * this row's identity, and „obriši pa dodaj" says that honestly.
 */
export interface FitItemUpdateRequest {
  profileId: string;
  id: string;
  grams?: number;
  slot?: FitMealSlot;
}

/** A soft delete, with the undo every other list in this app has. */
export interface FitItemRemoveRequest {
  profileId: string;
  id: string;
}

/** Undo of that delete — the item comes back exactly as it was logged, snapshot, day and slot included. */
export interface FitItemRestoreRequest {
  profileId: string;
  id: string;
}

export interface FitFoodsListRequest {
  profileId: string;
}

export interface FitFoodCreateRequest {
  profileId: string;
  food: NewFitFoodFields;
}

export interface FitFoodUpdateRequest {
  profileId: string;
  id: string;
  changes: FitFoodFieldChanges;
}

/**
 * Soft-deletes one of the profile's own foods. Everything already LOGGED with it
 * is untouched and stays readable — `food_ref` is text with no foreign key, and
 * the item's own label and snapshot are what make it legible. Deleting „mamin
 * ajvar" is a statement about the food list, never about what was eaten.
 */
export interface FitFoodDeleteRequest {
  profileId: string;
  id: string;
}

export interface FitFoodRestoreRequest {
  profileId: string;
  id: string;
}

export interface FitTargetsRequest {
  profileId: string;
}

/** Writes all four goals at once; clearing is a save of four nulls. */
export interface FitTargetsSaveRequest {
  profileId: string;
  goals: FitTargetGoals;
}

// --- Trening i telo (FIT slice b, migration 060) -----------------------------
//
// Every shape below mirrors `@nexus/db`'s training stores, redeclared here so
// the renderer never imports them — the rule this whole file follows. The
// closed vocabularies are the exception and are imported from `@nexus/core`
// (see the import at the top of this file): `metric` decides how a set's four
// numbers are READ and `kind` decides whether it counts toward volume, so a
// redeclared copy drifting by one member would be a set nothing downstream
// knows what to do with.
//
// **The catalogue is not a table, again.** `FitExerciseOption` is what a merged
// search answers with — a shipped entry and one of the profile's own, side by
// side, told apart only by `ref` and the `catalogue` flag. There is no
// create/update/delete for a catalogue exercise anywhere on this wire.

/** Mirrors `MAX_FIT_EXERCISE_NAME_LENGTH` in `@nexus/db`; the store stays authoritative. */
export const MAX_FIT_EXERCISE_NAME_LENGTH = 80;
/** Mirrors `MAX_FIT_EXERCISE_NOTES_LENGTH`. */
export const MAX_FIT_EXERCISE_NOTES_LENGTH = 500;
/** Mirrors `MAX_FIT_ROUTINE_NAME_LENGTH`. */
export const MAX_FIT_ROUTINE_NAME_LENGTH = 80;
/** Mirrors `MAX_FIT_ROUTINE_NOTES_LENGTH`. */
export const MAX_FIT_ROUTINE_NOTES_LENGTH = 500;
/** Mirrors `MAX_FIT_ROUTINE_ITEMS` — past this a routine stops being a shape somebody reads off and starts being a spreadsheet. */
export const MAX_FIT_ROUTINE_ITEMS = 60;
/** Mirrors `MAX_FIT_WORKOUT_NOTES_LENGTH` in `@nexus/db` — CHARACTERS, and the same 500 the store enforces. A wire looser than its store turns a clean refusal into a confusing one. */
export const MAX_FIT_WORKOUT_NOTES_LENGTH = 500;
/** How many exercises one "what did I do last time" call may ask about. Mirrors `MAX_FIT_LAST_PERFORMED_REFS`. */
export const MAX_FIT_LAST_PERFORMED_REFS = 200;
/** A picker's box, not a document — `MAX_FIT_FOOD_QUERY_LENGTH`'s bound for the exercise picker. */
export const MAX_FIT_EXERCISE_QUERY_LENGTH = 100;
/** How many exercises one search answers with, catalogue and user entries together. */
export const MAX_FIT_EXERCISE_RESULTS = 50;

/**
 * The closed vocabularies a training surface needs, re-exported so a page reads
 * the whole training vocabulary off this one contract rather than reaching into
 * `@nexus/core` itself.
 */
export type {
  ActivityLevel,
  BodyCircumferences,
  BodySex,
  ExerciseEquipment,
  ExerciseMetric,
  MovementPattern,
  MuscleGroup,
  MuscleReading,
  SetKind,
};

/**
 * One exercise a picker may offer — a catalogue entry or one of the profile's
 * own, in one shape, told apart by `ref` and by `catalogue`.
 *
 * `ref` is `catalogue:<slug>` or `user:<uuid>` and is the ONLY thing the
 * renderer ever sends back to log a set of this exercise: main resolves it and
 * stamps the snapshot, so the fields below are both what the user was shown and
 * what gets recorded, without the renderer being trusted with either.
 *
 * `catalogue` is what a surface reads to decide whether "Izmeni" may be offered
 * at all — there is no row behind a catalogue entry to edit.
 */
export interface FitExerciseOption {
  ref: string;
  name: string;
  /** "RDL", "hip thrust" — searched, never displayed. Empty for a user's own accessory movement. */
  nameEn: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: ExerciseEquipment;
  pattern: MovementPattern;
  unilateral: boolean;
  metric: ExerciseMetric;
  catalogue: boolean;
}

/** One of the profile's own exercises, as the "Moje vežbe" list reads it. */
export interface FitExercise {
  id: string;
  profileId: string;
  name: string;
  nameEn: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: ExerciseEquipment;
  pattern: MovementPattern;
  unilateral: boolean;
  metric: ExerciseMetric;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** What "Nova vežba" sends. `metric` is the field that carries the module (ADR-081 §3), so it is required rather than defaulted. */
export interface NewFitExerciseFields {
  name: string;
  nameEn?: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles?: MuscleGroup[];
  equipment: ExerciseEquipment;
  pattern: MovementPattern;
  unilateral?: boolean;
  metric: ExerciseMetric;
  notes?: string;
}

/** A partial patch of one of the profile's own exercises; an omitted key is left untouched. */
export type FitExerciseFieldChanges = Partial<NewFitExerciseFields>;

/**
 * One line of a routine. Every target is nullable: "bench, as many sets as it
 * takes" is a real prescription, and `null` is "no target" rather than a target
 * of zero.
 *
 * **`label` and `metric` are resolved when the routine is READ, not stored as a
 * snapshot** — and the difference from a logged set is the whole point. A set is
 * history and must keep meaning what it meant; a routine is a SHAPE (ADR-081
 * §6), so a renamed exercise should carry its new name into every routine that
 * names it, and a corrected `metric` must reach the input the session draws for
 * that line or the page would offer kilograms for a plank.
 *
 * When the reference no longer resolves — a user exercise since deleted, a
 * catalogue slug a later build dropped — `metric` is `null` and `label` falls
 * back to the name the line was written with. That pair is what lets „Trening"
 * draw the line as unusable and still say what it used to be, instead of either
 * crashing on the read or showing an empty row nobody can explain.
 */
export interface FitRoutineItem {
  id: string;
  exerciseRef: string;
  label: string;
  /** What one set of it records — `null` exactly when the reference resolves to nothing. */
  metric: ExerciseMetric | null;
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  /**
   * The targets a rep range cannot state (migration 061). WHICH of these a line
   * may carry is decided by `metric`, exactly as it is for a logged set — three
   * of the seven metrics have no reps at all, and a plank's only number is how
   * long it is held.
   */
  targetSeconds: number | null;
  targetWeightKg: number | null;
  targetDistanceM: number | null;
  /**
   * Rest after each set of THIS line. `0` means „straight into the next set";
   * `null` means the routine has no opinion and the session default stands.
   * Bounded by `MAX_FIT_REST_SECONDS`, so a routine can never prescribe a rest
   * the timer refuses to run.
   */
  restSeconds: number | null;
}

export interface FitRoutine {
  id: string;
  profileId: string;
  name: string;
  notes: string;
  items: FitRoutineItem[];
  createdAt: string;
  updatedAt: string;
}

/**
 * One line as the renderer SENDS it: a reference and its targets, and no label.
 * Main resolves the reference and writes the label from what it found, exactly
 * as `fit:set-log` does — a routine whose label was the caller's claim could
 * name one exercise and point at another.
 */
export interface FitRoutineItemInput {
  exerciseRef: string;
  targetSets?: number | null;
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
  targetSeconds?: number | null;
  targetWeightKg?: number | null;
  targetDistanceM?: number | null;
  restSeconds?: number | null;
}

/**
 * Creates or rewrites a routine. **Items are sent WHOLE, every time**, and
 * their order IS their position.
 *
 * A patch API would need a third value meaning "leave this list alone",
 * distinct from an empty array meaning "remove every item" — and across a JSON
 * wire `undefined` and "absent" are the same byte, so the day somebody sent a
 * partial object the routine would silently lose its exercises. The store makes
 * the same argument about its own `save` (`FitTargetStore`), one layer down.
 */
export interface FitRoutineSaveRequest {
  profileId: string;
  /** Absent for a create; present for a rewrite of an existing routine. */
  id?: string;
  name: string;
  notes?: string;
  items: FitRoutineItemInput[];
}

export interface FitRoutineIdRequest {
  profileId: string;
  id: string;
}

/**
 * One logged set. `metric` and `primaryMuscles` are the SNAPSHOT main took when
 * the set was logged, not the exercise's current values — a set re-interpreted
 * by a later edit would be arithmetic performed on a different lift.
 */
export interface FitWorkoutSet {
  id: string;
  workoutId: string;
  position: number;
  exerciseRef: string;
  label: string;
  metric: ExerciseMetric;
  primaryMuscles: MuscleGroup[];
  kind: SetKind;
  /** For `assisted_reps` this is the assistance SUBTRACTED — a magnitude, and still non-negative. */
  weightKg: number | null;
  reps: number | null;
  seconds: number | null;
  distanceM: number | null;
  /** Reps in reserve, 0–5, or null. RIR rather than RPE: it is the question a person can actually answer. */
  rir: number | null;
  createdAt: string;
  updatedAt: string;
}

/** One session, with its sets in position order. `endedAt` is null exactly while the session is the open one. */
export interface FitWorkout {
  id: string;
  profileId: string;
  day: string;
  startedAt: string;
  endedAt: string | null;
  routineRef: string | null;
  /** The routine's name AT THE TIME, or empty for an ad-hoc session. */
  routineLabel: string;
  notes: string;
  sets: FitWorkoutSet[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Opens a session. Refuses when one is already open — the schema's own UNIQUE
 * partial index, which exists because every set is logged into "the current
 * workout" and a second open session would make that phrase ambiguous.
 */
export interface FitWorkoutStartRequest {
  profileId: string;
  day: string;
  /** The routine it starts from, or null for an ad-hoc session. Main resolves it and writes the label. */
  routineRef?: string | null;
  notes?: string;
}

export interface FitWorkoutIdRequest {
  profileId: string;
  id: string;
}

/** Corrects the session's own day or notes — never its sets, which have their own three channels. */
export interface FitWorkoutUpdateRequest {
  profileId: string;
  id: string;
  day?: string;
  notes?: string;
}

/** A day is a range of one; the page asks for a week or a month the same way. */
export interface FitWorkoutsRangeRequest {
  profileId: string;
  from: string;
  to: string;
}

/**
 * Logs one set. Carries the REFERENCE and the numbers, and deliberately neither
 * the label, the metric nor the muscles: main resolves the reference and stamps
 * all three. See the channel block for why that boundary is the module's rather
 * than a courtesy.
 */
export interface FitSetLogRequest {
  profileId: string;
  workoutId: string;
  exerciseRef: string;
  kind: SetKind;
  weightKg?: number | null;
  reps?: number | null;
  seconds?: number | null;
  distanceM?: number | null;
  rir?: number | null;
}

/** Corrects one set's numbers or its kind. Never its exercise, label, metric or muscles — swapping those would be logging a different lift while keeping this row's identity. */
export interface FitSetUpdateRequest {
  profileId: string;
  id: string;
  kind?: SetKind;
  weightKg?: number | null;
  reps?: number | null;
  seconds?: number | null;
  distanceM?: number | null;
  rir?: number | null;
}

/** A HARD delete: an unlogged set is a typo rather than history, and the remaining positions close the gap. */
export interface FitSetRemoveRequest {
  profileId: string;
  id: string;
}

/** The last FINISHED session that logged one exercise, and every set of it. A session in progress is not "last time". */
export interface FitLastPerformed {
  exerciseRef: string;
  day: string;
  workoutId: string;
  sets: FitWorkoutSet[];
}

/** Asks about a whole list in one call — starting a routine asks about every movement in it at once. */
export interface FitLastPerformedRequest {
  profileId: string;
  exerciseRefs: string[];
}

/**
 * One day's reading. Only the weight makes the row an observation; the rest are
 * what a smart scale hands over in the same step, each independently null
 * because a bathroom scale gives one of them and a caliper gives another.
 *
 * `muscle` keeps the UNIT the device printed. Normalising kilograms into a
 * percentage at entry would store a number the app computed while making it
 * look like one the scale measured.
 */
export interface FitMeasurement {
  day: string;
  weightKg: number;
  bodyFatPercent: number | null;
  muscle: MuscleReading | null;
  waterPercent: number | null;
  circumferences: BodyCircumferences;
  createdAt: string;
  updatedAt: string;
}

/** A range read, ascending. The trend IS the number the page shows (a 7-day moving average), so a single most-recent row could not answer it. */
export interface FitMeasurementsRequest {
  profileId: string;
  from: string;
  to: string;
}

/** Upserts one day's reading — one row per (profile, day), stated by the schema's primary key. */
export interface FitMeasurementSaveRequest {
  profileId: string;
  measurement: {
    day: string;
    weightKg: number;
    bodyFatPercent?: number | null;
    muscle?: MuscleReading | null;
    waterPercent?: number | null;
    circumferences?: Partial<BodyCircumferences>;
  };
}

/** A HARD delete: a mis-typed weigh-in is corrected or removed, and a soft-deleted reading would sit in the file looking like it might still count. */
export interface FitMeasurementRemoveRequest {
  profileId: string;
  day: string;
}

/**
 * Facts about a person rather than observations. `sex` is null when not given —
 * never "unknown, assume male" — and its absence is what closes the
 * Mifflin–St Jeor tier and makes the surface say so.
 */
export interface FitBodyProfile {
  sex: BodySex | null;
  /** Age is DERIVED from this. Storing "30" once means being wrong from the next birthday onward, silently, inside a BMR nobody re-checks. */
  birthDate: string;
  heightCm: number;
  activity: ActivityLevel;
}

export interface FitBodyProfileRequest {
  profileId: string;
}

export interface FitBodyProfileSaveRequest {
  profileId: string;
  profile: FitBodyProfile;
}

/** The shortest rest a countdown may be set to. Below this a timer costs more attention than it saves. */
export const MIN_FIT_REST_SECONDS = 15;

/**
 * The longest. Ten minutes covers the heaviest single a person rests for; past
 * it this stops being „the rest between two sets" and starts being a session
 * somebody left running, and this timer records nothing that could explain it
 * later.
 */
export const MAX_FIT_REST_SECONDS = 600;

/**
 * The running rest countdown — ADR-081 §7's kitchen timer, and the one thing on
 * this contract that is neither a row nor derived from one.
 *
 * Both instants are stamped by MAIN's clock (SEC-EL-02, `focus:*`'s rule), so a
 * renderer cannot declare when a rest began or when it ends; it subtracts
 * `endsAt` from its own clock to draw the number, which is the same machine's
 * clock and therefore the same answer. `seconds` travels too so the surface can
 * say what was ASKED for after the countdown is over, without inferring it back
 * out of two timestamps.
 */
export interface FitRestTimer {
  startedAt: string;
  endsAt: string;
  seconds: number;
}

export interface FitRestStartRequest {
  profileId: string;
  seconds: number;
}

export interface FitRestRequest {
  profileId: string;
}

/** A picker query over both sources at once. A blank query answers nothing rather than everything. */
export interface FitExerciseSearchRequest {
  profileId: string;
  query: string;
  limit: number;
}

export interface FitExercisesListRequest {
  profileId: string;
}

export interface FitExerciseCreateRequest {
  profileId: string;
  exercise: NewFitExerciseFields;
}

export interface FitExerciseUpdateRequest {
  profileId: string;
  id: string;
  changes: FitExerciseFieldChanges;
}

/**
 * Soft-deletes one of the profile's own exercises. Everything already LOGGED
 * with it is untouched and stays readable — `exercise_ref` is text with no
 * foreign key, and the set's own label, metric and muscle snapshot are what
 * make it legible. Deleting an exercise is a statement about the exercise list,
 * never about what was lifted.
 */
export interface FitExerciseIdRequest {
  profileId: string;
  id: string;
}

// --- Tabla (CANV slice a, migration 059) -------------------------------------
//
// Every shape below mirrors `@nexus/db`'s canvas store, redeclared here so the
// renderer never imports it — the rule this whole file follows.
//
// **The scene crosses this wire as TEXT, not as an object**, and that is
// deliberate. The renderer already has it as a string (`serializeAsJSON`
// produces one) and main hands it straight to a column that holds one, so
// parsing it into an object at the bridge and re-serialising it on the other
// side would be two conversions in service of nothing. Main validates the text
// through `@nexus/core`'s `validateCanvasScene` exactly as it would an object —
// the untrusted-input rule is unaffected by the encoding.

/** Mirrors `MAX_CANVAS_BOARD_NAME_LENGTH` in `@nexus/db`, so the field can cap its own input; the store stays authoritative. */
export const MAX_CANVAS_BOARD_NAME_LENGTH = 60;
/**
 * Mirrors `MAX_CANVAS_SCENE_LENGTH` in `@nexus/core` — the ceiling on one
 * stored drawing. It is not a limit on how much anyone can draw (a scene of
 * thousands of shapes is a few hundred kilobytes) but a bound on the one part of
 * the document with no natural size: an embedded image, which rides as a base64
 * data URL inside the scene.
 */
export const MAX_CANVAS_SCENE_LENGTH = 8 * 1024 * 1024;

/**
 * One board WITHOUT its drawing — what the board strip lists.
 *
 * The scene is absent from this shape rather than nullable, exactly as it is
 * from the store's own `CanvasBoard`: the list read never selects that column,
 * so a field here would be a value this type can never carry.
 */
export interface CanvasBoard {
  id: string;
  profileId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** One board WITH its drawing — what `canvas:open` and `canvas:create` answer. */
export interface CanvasBoardWithScene extends CanvasBoard {
  /** Canonical `serializeCanvasScene` text — Excalidraw's own document, kept verbatim. */
  scene: string;
}

export interface CanvasListRequest {
  profileId: string;
}

export interface CanvasOpenRequest {
  profileId: string;
  id: string;
}

/**
 * Creates a board. An ABSENT `scene` means an empty one — „napravi mi praznu
 * tablu" is the ordinary case and must not require the renderer to construct a
 * document it has no opinion about.
 */
export interface CanvasCreateRequest {
  profileId: string;
  name: string;
  scene?: string;
}

/** Renames a board. Cannot carry a drawing — see the channel list's own note. */
export interface CanvasRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

/**
 * Replaces a board's drawing. Cannot carry a name.
 *
 * This is the ONE channel the app calls while the user is working — the
 * autosave — so it is deliberately the narrowest: one id, one document, and a
 * reply of METADATA rather than an echo of the several megabytes it was just
 * handed.
 */
export interface CanvasSaveSceneRequest {
  profileId: string;
  id: string;
  scene: string;
}

/** A soft delete. The drawing stays exactly where it is, so the undo brings the whole board back. */
export interface CanvasDeleteRequest {
  profileId: string;
  id: string;
}

export interface CanvasRestoreRequest {
  profileId: string;
  id: string;
}

/**
 * Mirrors `MAX_CANVAS_REF_BATCH` in `@nexus/db` — the most references one card
 * resolution may name. The store stays authoritative; this copy exists so the
 * field can cap its own input before main builds an array out of untrusted JSON.
 */
export const MAX_CANVAS_REF_BATCH = 500;

/**
 * Resolves the Nexus objects a board's cards point at.
 *
 * **`refs` crosses as TEXT — the very `nexus://<kind>/<id>` strings Excalidraw
 * stores in an element's `link`** — rather than as parsed `{kind, id}` pairs.
 * That is the security shape, not a convenience: the renderer holds these
 * strings and nothing else, and main's `parseCanvasRef` is then the ONE place
 * that decides what a legal reference is. A wire carrying a pre-split kind and
 * id would let a caller name a kind the grammar would have refused.
 */
export interface CanvasResolveRefsRequest {
  profileId: string;
  refs: string[];
}

/**
 * One card's answer, in the caller's own order and one per reference asked
 * about — a reference whose object is gone comes back `missing` rather than
 * omitted, because that is a state the card renders rather than a blank it falls
 * through. Mirrors `@nexus/db`'s `CanvasRefCard`.
 */
export type CanvasRefCard =
  | {
      kind: CanvasRefKind;
      id: string;
      missing: false;
      title: string;
      /** The module's own context line: a task's due date, an event's start, nothing for a note. Raw column text; the renderer formats it. */
      detail: string | null;
    }
  | { kind: CanvasRefKind; id: string; missing: true };

// --- Elektronika: circuits, parts and wires (ELEC slice E1, migration 067) ---
//
// **The component CATALOGUE does not cross this wire, and no channel answers
// it.** The 153 components ship as constants in `@nexus/core`, which the
// renderer imports directly: they are not the profile's data, they never touch
// the database, and a channel would be main answering a question the caller can
// already answer — at the cost of a second copy that could drift from the one
// `circuitProblems` resolves against.
//
// The circuit DOCUMENT is imported rather than redeclared, which is the
// `TaskViewConfig` exception rather than a lapse in the redeclare rule. A part
// and a wire are the nested grammar the store gate, the domain validator and
// this wire all share, and the renderer hands the very object below straight to
// `circuitProblems` — two declarations of it would be two answers to „what is a
// part", drifting silently the first time one of them gained a field.

/**
 * One circuit WITHOUT its contents — what the circuit picker lists.
 *
 * `notes` rides even on the cheap read, unlike CANV's scene: a note is a
 * sentence about the circuit rather than a document, so the picker can show it
 * and the editor needs no second call to have it.
 */
export interface ElecCircuit {
  id: string;
  profileId: string;
  name: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One circuit AND everything on it — what `elec:open` answers and the canvas
 * draws. Assignable to `@nexus/core`'s `Circuit`, which is the point: the page
 * runs `circuitProblems` on exactly this object.
 */
export interface ElecCircuitDocument extends ElecCircuit {
  parts: CircuitPart[];
  wires: CircuitWire[];
  /**
   * The machine, when the user has dimensioned one (ADR-085 E4c). Absent is the
   * ordinary case and is what the generator refuses a URDF for — a chassis
   * defaulted here would be nine measurements nobody took.
   */
  chassis?: Chassis;
}

export interface ElecListRequest {
  profileId: string;
}

export interface ElecOpenRequest {
  profileId: string;
  id: string;
}

/** Creates a circuit. An ABSENT `notes` is an empty one — a new circuit is the ordinary case. */
export interface ElecCreateRequest {
  profileId: string;
  name: string;
  notes?: string;
}

/** Renames a circuit. Cannot carry notes — see the channel list's own note. */
export interface ElecRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

/** Replaces a circuit's notes. Cannot rename it. */
export interface ElecSetNotesRequest {
  profileId: string;
  id: string;
  notes: string;
}

/** A soft delete. Everything on the circuit stays, so the undo brings the whole canvas back. */
export interface ElecDeleteRequest {
  profileId: string;
  id: string;
}

export interface ElecRestoreRequest {
  profileId: string;
  id: string;
}

/**
 * Places a component on a circuit.
 *
 * `rotation` crosses as a plain `number` rather than as `PartRotation`: the
 * renderer is untrusted, so the type it claims to send is not evidence, and
 * main narrows it to one of the four quarter turns before the store ever sees
 * it. `value` is absent for a component that takes none — never null, which the
 * column does not have either. `mount` crosses as a plain `string` for
 * `rotation`'s reason and is absent for a part that is not on the machine.
 */
export interface ElecAddPartRequest {
  profileId: string;
  circuitId: string;
  part: {
    componentId: string;
    label: string;
    x: number;
    y: number;
    rotation: number;
    value?: number;
    mount?: string;
  };
}

/**
 * Edits a placed part — the channel that fires on every drag.
 *
 * Three states per field, not two: absent leaves it alone, a value replaces it,
 * and `value: null` CLEARS it. Without the null there would be no way to say
 * „this resistor should not have a value after all", and a resistor that cannot
 * lose its value is a row the user cannot correct. `mount: null` says the same
 * thing about the machine: a sensor taken off the robot must be expressible.
 */
export interface ElecUpdatePartRequest {
  profileId: string;
  id: string;
  fields: {
    label?: string;
    x?: number;
    y?: number;
    rotation?: number;
    value?: number | null;
    mount?: string | null;
  };
}

/** Removes a placed part. Answers with the WIRES that went with it — see `removeCircuitPart`. */
export interface ElecRemovePartRequest {
  profileId: string;
  id: string;
}

/**
 * Runs a wire between two pins.
 *
 * `colour` crosses as a plain `string` for `rotation`'s reason exactly: main
 * narrows it to one of the nine jumper names, and a wire whose colour arrived
 * as a CSS value would be a stored colour the canvas then had to paint rather
 * than a name it resolves through a `--nx-elec-wire-*` token.
 */
export interface ElecAddWireRequest {
  profileId: string;
  circuitId: string;
  wire: {
    from: WireEnd;
    to: WireEnd;
    colour: string;
  };
}

/**
 * Recolours a wire — the only edit a wire admits, and a channel of its own for
 * `elec:rename`/`elec:set-notes`' reason: a recolour must not be able to move an
 * end. `colour` crosses as a plain `string` and is narrowed by main, exactly as
 * it is on the way in.
 */
export interface ElecSetWireColourRequest {
  profileId: string;
  id: string;
  colour: string;
}

export interface ElecRemoveWireRequest {
  profileId: string;
  id: string;
}

/**
 * Dimensions the machine, or says there is not one (ADR-085 E4c).
 *
 * The whole chassis crosses at once, never a field at a time: nine numbers are
 * all present or the machine does not exist, and a per-field channel would make
 * „half a chassis" a state the wire could express — which is the state
 * migration 068 made unrepresentable in the database on purpose.
 *
 * `shape` crosses as a plain `string`, and every number as a plain `number`,
 * for `rotation`'s reason: what the renderer claims to send is not evidence.
 * `chassis: null` REMOVES it — the machine that turned out not to be one.
 */
export interface ElecSetChassisRequest {
  profileId: string;
  id: string;
  chassis: {
    shape: string;
    bodyLength: number;
    bodyWidth: number;
    bodyHeight: number;
    wheelRadius: number;
    wheelWidth: number;
    wheelTrack: number;
    wheelBase: number;
    bodyMass: number;
    wheelMass: number;
  } | null;
}

/**
 * Global search (ADR-021 / PRD 08 SRCH-001/002). The index itself (migration
 * 017) and its read-only store already exist; these three channels are the
 * palette's entire main-process surface: a typed query, the recency-ordered
 * list an empty query shows, and a from-scratch repair.
 */

/** Hard cap on the raw query string the renderer may send. A palette input is a few words; anything longer is a paste, and the parser caps terms anyway. */
export const SEARCH_QUERY_MAX_BYTES = 500;
/** Hard cap on how many results one request may return. */
export const SEARCH_RESULT_MAX_LIMIT = 100;

/**
 * The kinds of entity global search indexes — IMPORTED, and this is a
 * correction rather than an omission.
 *
 * It was declared here with a comment arguing it „cannot drift silently: main
 * assigns a core `SearchKind` into `SearchResult.kind`, so a member added on
 * one side and not the other fails to compile". The argument holds for ONE
 * direction. Adding a kind to core and not here fails, which is what happens
 * whenever a kind is added properly; adding a kind HERE and not to core
 * compiles, and the wire would then carry a kind the index cannot produce —
 * the failing direction is exactly the one nobody would hit by accident, which
 * is the definition of a copy that costs nothing until it costs everything.
 *
 * The tenth kind (circuits, 2026-09-22) is what made that concrete: the
 * compiler DID catch it, in the harmless direction, and the harmless direction
 * is the only one there was. It joins the import list above on the rule that
 * header already states — a closed vocabulary a store enforces is imported,
 * a flat record is redeclared — and `search_entries.kind` plus the ten
 * `search_source_<kind>` views are exactly that.
 */
export type { SearchKind };

/** A half-open `[start, end)` range into the string it accompanies, for highlighting the matched part. */
export type SearchHighlight = readonly [number, number];

/**
 * One displayable global-search result (ADR-021). `title`/`snippet` are the
 * ORIGINAL text with highlight ranges computed by core, never the folded
 * matching form — `titleRanges`/`snippetRanges` index into their OWN string
 * (`title`/`snippet` respectively), not into the source entity's full text.
 * `parentId` is what the deep link needs for a card's deck or an attachment's
 * note (null when the kind has none); `contextDate` is whatever date that
 * kind carries — due/start/expiry/exam date, null when the kind has none.
 */
export interface SearchResult {
  kind: SearchKind;
  entityId: string;
  parentId: string | null;
  title: string;
  titleRanges: SearchHighlight[];
  snippet: string;
  snippetRanges: SearchHighlight[];
  contextDate: string | null;
  updatedAt: string;
  /**
   * This row matched inside an ATTACHED FILE's contents rather than in anything
   * shown here (SRCH-008 / migration 048). Set only when the query had terms
   * and neither `titleRanges` nor `snippetRanges` came back with one — which,
   * after migration 048, can mean exactly one thing: the match landed in the
   * one piece of text this index carries but never displays, an attachment's
   * extracted contents. Both surfaces say so out loud, because a result row
   * that appears to match nothing is a result row that lies.
   */
  fromAttachment: boolean;
}

export interface SearchQueryRequest {
  profileId: string;
  query: string;
  /**
   * Required, never optional: an optional numeric field plus
   * `exactOptionalPropertyTypes` is a trap for no benefit, and the caller
   * always knows its own page size.
   */
  limit: number;
}

export interface SearchRecentRequest {
  profileId: string;
  limit: number;
}

/** `profileId` only proves the caller is in a real session — the rebuild itself is whole-file, not scoped to it (see the handler's own doc comment). */
export interface SearchRebuildRequest {
  profileId: string;
}

/**
 * The ADR-039 search page's single channel. Unlike `searchQuery`, this one
 * carries no `limit`: the page is the browse surface, so its size is a
 * property of the surface (`SEARCH_PAGE_MAX_RESULTS`) rather than something
 * the renderer negotiates. The renderer pages through what comes back in
 * chunks of its own choosing.
 */
export interface SearchPageRequest {
  profileId: string;
  query: string;
}

/** One kind's share of the pre-narrowing hit set (ADR-039 §3). */
export interface SearchKindCount {
  kind: SearchKind;
  count: number;
}

/** One tag chip: the original spelling to show, the `#token` to splice, and how many results it would keep. */
export interface SearchTagFacet {
  name: string;
  token: string;
  count: number;
}

/**
 * Hard cap on how many results one search-page response may carry. Equal to
 * `MAX_SEARCH_BROWSE_LIMIT` in `@nexus/db` by intent but declared
 * independently here, the same rule `SEARCH_QUERY_MAX_BYTES` follows — the
 * shared IPC contract imports nothing from the database package.
 */
export const SEARCH_PAGE_MAX_RESULTS = 500;

/**
 * The search page's whole payload (ADR-039 §3). `kindCounts` and `tagFacets`
 * are computed over the set BEFORE `kinds` narrowing, so a chip answers
 * "what would this narrowing give you" rather than "what does the narrowing
 * you already applied contain".
 */
export interface SearchPageResult {
  /** Ranked and capped at `SEARCH_PAGE_MAX_RESULTS`. */
  hits: SearchResult[];
  /** How many hits matched before the response cap — may exceed `hits.length`. */
  total: number;
  /** Candidate sourcing hit its bound, so `total` is a floor, not an exact count. */
  truncated: boolean;
  kindCounts: SearchKindCount[];
  tagFacets: SearchTagFacet[];
}

/**
 * The profile's search HISTORY (SRCH-009 / migration 050) — the queries it
 * typed, not the entities it opened. Deliberately not folded into the channels
 * above: `searchRecent` answers "what did you touch", this answers "what did
 * you look for", and the two lists appear side by side without one standing in
 * for the other.
 *
 * Stored per profile in the encrypted database and **excluded from the export
 * archive and from the restore wipe alike** — the `backup_settings` shape (see
 * migration 050's doc comment). Nothing here rides in an archive, so no
 * interchange version accompanies it.
 */

/** One remembered search: the query exactly as it was typed, operators included, and when it was last used. */
export interface SearchHistoryEntry {
  query: string;
  usedAt: string;
}

/** Reads this profile's remembered queries, newest first. Bounded by the store's own cap — the renderer never negotiates a size for a list this short. */
export interface SearchHistoryRequest {
  profileId: string;
}

/**
 * Remembers one query as USED. The renderer calls this only at a moment the
 * user committed to a query — opening a result found by it, or carrying it to
 * the full search page — never per keystroke: a debounced box would otherwise
 * store „b", „be", „bel", „bele", which is a worse history than none.
 * `query` is capped exactly like `searchQuery`'s.
 */
export interface SearchHistoryRecordRequest {
  profileId: string;
  query: string;
}

/** Forgets one remembered query — the „×" on a history row. */
export interface SearchHistoryRemoveRequest {
  profileId: string;
  query: string;
}

/** Forgets everything this profile searched for — Settings' „Obriši istoriju pretrage". */
export interface SearchHistoryClearRequest {
  profileId: string;
}

/**
 * `passphrase` is renderer-declared like every other explicit user choice on
 * this wire (SEC-EL-02: untrusted input, re-validated in main) — `null` is
 * the explicitly-confirmed plaintext export, a non-null string is re-checked
 * against `validateArchivePassphrase` before it ever reaches `deriveArchiveKey`.
 */
export interface ImexExportRequest {
  profileId: string;
  passphrase: string | null;
  /**
   * Which archive modules to write (IMEX-003), as `ArchiveModuleName`s.
   * ABSENT means all of them — the whole-profile export, and what a caller that
   * offers no choice keeps asking for.
   *
   * Untrusted like every other field here (SEC-EL-02): main checks each entry
   * against `@nexus/core`'s `ARCHIVE_MODULE_IDS` and refuses an empty array
   * outright, since an archive of nothing is not something the user can have
   * meant. A subset is a complete archive of fewer modules — restoring it
   * replaces the whole profile and the omitted modules simply come back empty,
   * exactly as a restore has always worked.
   */
  modules?: readonly ArchiveModuleName[];
}

/**
 * The outcome of a full-data export (IMEX slice a1, PRD 14 IMEX-001, extended
 * by ADR-022): either the user canceled the native save dialog, or the
 * archive was written to `path` with `totalRecords` interchange records
 * inside it. The renderer never supplies `path` itself — it always comes back
 * from the dialog main owns (SEC-EL: untrusted input never reaches the
 * filesystem).
 *
 * `missingAttachments` (ADR-022) is non-zero when one or more NOTE attachment
 * blobs were not found in the blob store: the archive is otherwise complete,
 * just missing that many attachment files — a lost blob never fails the whole
 * export.
 *
 * `encrypted` (ADR-022) is true when the archive was sealed under a
 * passphrase-derived key — an `.nexus` `NXA1` container — and false for the
 * explicitly-confirmed plaintext `.nexus.zip`. The renderer reports honestly
 * which kind of archive it wrote, since the two need different follow-up copy
 * (`settings.backup.savedEncryptedSuffix` vs. nothing extra).
 */
/**
 * Why an export excluded the private section (ADR-057 §6): `"locked"` while
 * the section was sealed, `"plaintext"` for an export written in the clear —
 * dominant over a lock, since unlocking would change nothing about it. Null on
 * the result means "nothing was excluded": the notes rode, or there were none.
 */
export type PrivateNotesExportSkip = "locked" | "plaintext";

export type ExportResult =
  | { canceled: true }
  | {
      canceled: false;
      path: string;
      totalRecords: number;
      missingAttachments: number;
      encrypted: boolean;
      /**
       * How many private notes RODE in this archive (ADR-057 §6) — zero
       * whenever they did not. Reported out loud because their inclusion is
       * the sharpest fact an export result can carry: the user must never
       * learn from a zip listing that their most guarded notes left the app.
       */
      privateNotes: number;
      /** Why the private section did NOT ride, or null (see the type's own doc). The card renders its named sentence — a silent exclusion is the one kind this flow refuses to have. */
      privateNotesSkipped: PrivateNotesExportSkip | null;
    };

/**
 * An ICS calendar export (CAL-008 / IMEX-001's "ICS for calendar" clause). Only
 * the profile is named: this writes ONE open, unencrypted text file of the
 * user's own appointments — there is nothing to seal and no passphrase branch,
 * which is exactly why it is its own channel rather than a flag on
 * `ImexExportRequest`.
 */
export interface ImexExportIcsRequest {
  profileId: string;
}

/**
 * The outcome of an ICS export, shaped like `ExportResult`'s: either the user
 * canceled the native save dialog, or the file was written to the `path` that
 * dialog returned (never one the renderer supplied — SEC-EL).
 *
 * `events` is how many `VEVENT`s were written and `skipped` how many rows could
 * not be expressed as one — a start date that is not a real calendar day today.
 * Reported rather than swallowed, for the reason `missingAttachments` is: a
 * partial export the user is not told about is the one failure an export cannot
 * afford.
 */
export type IcsExportResult =
  | { canceled: true }
  | { canceled: false; path: string; events: number; skipped: number };

/**
 * Why a circuit produced no code (ADR-085 E4) — `@nexus/core`'s
 * `SketchRefusal | RosRefusal`, redeclared on `AuthErrorReason`'s terms because
 * this file imports nothing. Main assigns the generator's own value to it, so a
 * drift is a compile error rather than a silent gap.
 *
 * Machine codes, never prose: the renderer owns the Serbian sentence.
 */
export type CodeRefusal = "no-board" | "many-boards" | "not-programmable" | "not-ros";

/**
 * The outcome of a code export (ADR-085 E4), shaped like `IcsExportResult`'s —
 * the user canceled, or it was written at the path the native dialog returned,
 * never one the renderer supplied (SEC-EL).
 *
 * `outcome` rather than a bare `path`, because the two artefacts are different
 * things on disk: a sketch is a file the user named, a package is a directory
 * Nexus created under a directory the user picked. „Sačuvana je skica" and
 * „napravljen je paket od osam fajlova" are different sentences and the
 * renderer has to be able to tell which it is saying.
 *
 * `refused` is not an error: a circuit with two boards has no code to give. The
 * renderer says so in its own dialog and shows no save button there at all, so
 * reaching that arm means the circuit changed between the preview and the click
 * — worth reporting rather than writing an empty file over whatever the user
 * pointed at.
 *
 * `exists` is the one refusal main makes on its own, and it is deliberate: the
 * generated package tells the user to fill in its licence and to write their
 * own node beside it, so a second export that silently overwrote the directory
 * would destroy work Nexus itself asked for.
 */
export type CodeExportResult =
  | { canceled: true }
  | { canceled: false; outcome: "refused"; reason: CodeRefusal }
  /** A `.ino` at the path the save dialog returned. `libraries` is how many to install. */
  | { canceled: false; outcome: "sketch"; path: string; libraries: number }
  /** A package directory, freshly created. `path` is the directory, not its parent. */
  | { canceled: false; outcome: "package"; path: string; files: number }
  | { canceled: false; outcome: "exists"; path: string };

/**
 * ADR-085 slice E6 — the external runner.
 *
 * Redeclared from `@nexus/core`'s `runner.ts` rather than imported, on this
 * file's standing rule that it imports nothing. The values are the toolchain's
 * own names because the closed table's ids ARE those names — a second spelling
 * would be a second table.
 */
export const RUNNER_PROFILES = ["native", "wsl", "docker"] as const;
export type RunnerProfileId = (typeof RUNNER_PROFILES)[number];

/**
 * One distribution a probe listed, and whether the toolchain is inside it.
 *
 * The name is VERBATIM from `wsl.exe -l -q`: it is what `-d` will be asked for,
 * so an app that trimmed or re-cased it would be asking for something the user
 * does not have.
 */
export interface RunnerDistro {
  name: string;
  /**
   * False when the user's own shell inside it answered with no ROS distribution
   * — `wslProbe`'s `echo "$ROS_DISTRO"`, which is the question the WSL choice
   * actually needs answered. The panel shows it as a choice that will not work
   * rather than as an absent one: the distribution IS there, its shell just has
   * no toolchain sourced in it.
   */
  usable: boolean;
}

/** What one profile's probe found. Presence is a fact; `detail` is a version when the tool prints one and null when it does not. */
export interface RunnerDetection {
  profile: RunnerProfileId;
  present: boolean;
  detail: string | null;
  /**
   * The probe was started and never answered.
   *
   * A third answer rather than a kind of `present: false`: a tool that is
   * installed but hangs — which is what `wsl.exe` does when the WSL service is
   * not running — is a different thing to tell the user than one that is not
   * there at all, and reporting it as „not found" would send them looking for
   * an installation they already have.
   */
  timedOut: boolean;
  /** WSL only, and empty for every other profile. */
  distros: RunnerDistro[];
}

/** The switch, the remembered choice, and when the user consented. `choice` and `distro` are null until the user picks one. */
export interface RunnerSettings {
  enabled: boolean;
  choice: RunnerProfileId | null;
  distro: string | null;
  consentedAt: string | null;
}

/**
 * Why a command could not be built.
 *
 * The first three come from the closed table itself (`@nexus/core`'s
 * `RunnerRefusal`); the rest are main's own, and each is decided BEFORE the
 * table is consulted because each is a reason there is no target to build one
 * for. The plan and the start share this union on purpose: the consent screen
 * prints the literal command a start would run, so a refusal that stopped one
 * has to be able to stop the other, and two unions would be two chances for
 * them to disagree about what „there is no command" means.
 */
export type RunnerRefusal =
  | "path-not-absolute"
  | "path-not-representable"
  | "distro-leading-dash"
  /** The runner is off — the switch, which is a recorded consent and not a preference. */
  | "not-enabled"
  /** On, but with no profile chosen yet. */
  | "no-choice"
  /**
   * WSL is chosen and no distribution under it is.
   *
   * Its own member rather than a second meaning of `no-choice`, because a
   * refusal is answered by ONE sentence: „no profile is chosen" beside a radio
   * that is visibly chosen is a sentence telling the user about a screen they
   * are not looking at, and the repair (pick one of the distributions the probe
   * listed) is a different action. It is reachable on the ordinary path —
   * choosing WSL writes the choice with `distro: null` until one is picked — so
   * it is not a corner.
   */
  | "no-distro"
  /** The circuit produced no ROS 2 package — the generator's own refusals, collapsed to one. */
  | "no-package";

/**
 * The literal command a start would run — what the consent screen prints, and
 * the reason this channel exists separately from `start`.
 */
export type RunnerPlanResult =
  | { kind: "refused"; reason: RunnerRefusal }
  | {
      kind: "command";
      /** `argv[0]` is the program. Shown to the user verbatim. */
      argv: string[];
      cwd: string;
      /** The directory Nexus generated, and the only value the command line receives. */
      workspace: string;
      /** True for the Docker profile, whose image is pulled from a registry the first time. The consent copy must say so. */
      pullsImage: boolean;
    };

/**
 * How a start went. `message` carries the child's own words when there are any
 * — a spawn failure the user can act on.
 *
 * `reason` is `"none"` exactly when `started` is true, so a caller can log the
 * outcome without narrowing first. `write-failed` covers both halves of
 * preparing a workspace: the write itself and the confirmation that the
 * directory is still inside the account's own folder.
 */
export interface RunnerStartResult {
  started: boolean;
  reason: RunnerRefusal | "already-running" | "write-failed" | "spawn-failed" | "none";
  message: string | null;
  workspace: string | null;
}

/**
 * What the stop path ACHIEVED, not what it attempted.
 *
 * The distinction is the whole of D4 in the threat model: `docker.exe` exiting
 * on Windows leaves the container running, so „stopped" must be established by
 * asking the profile whether the work is gone. `still-running` is the honest
 * answer to „we asked, and it is", and the UI says which of the two it is
 * rather than printing a success either way.
 */
export type RunnerStopState = "exited" | "still-running" | "idle";

/** The run in progress, as any window may see it. `argv` is here so a second window shows the same literal command the first one consented to. */
export interface RunnerRunView {
  profileId: string;
  choice: RunnerProfileId;
  workspace: string;
  argv: string[];
  startedAt: string;
  /** True once output was dropped to stay inside the cap — the log is then a window on the run rather than all of it. */
  truncated: boolean;
}

/**
 * How a run ENDED — and the distinction it exists for.
 *
 * `exitCode` is about the process this app started; `state` is about the WORK.
 * For Docker they are not the same question: `docker.exe` exiting on Windows
 * leaves the container going, so a panel that inferred „stopped" from the exit
 * code would be telling the user something it never checked. `state` is
 * therefore established by asking the profile, and `still-running` is the
 * honest answer when the answer is „yes".
 */
export interface RunnerOutcome {
  /** True when the user asked it to stop, false when it ended on its own. */
  stopped: boolean;
  exitCode: number | null;
  state: "exited" | "still-running";
  /** The child's own words when the process could not be started at all — a missing program, a refused mount. Null otherwise. */
  message: string | null;
  /**
   * Whether the build PRODUCED the package, or only reported that it had.
   *
   * `colcon build` exits 0 over a workspace with nothing in it, so an exit status
   * is a claim about the tool and not about the user's machine — and „uspešno
   * izgrađeno" is exactly the sentence an exit code cannot support. Main answers
   * this by looking for `install/<package>` under the workspace, which can only
   * be the current run's because the workspace is wiped before every run.
   *
   * `null` is a third state and not a hedge: a run that exited non-zero, or that
   * never started, makes NO claim about an artefact, and a panel that printed
   * „paket nije napravljen" there would be drawing a conclusion from a build that
   * was never asked the question.
   */
  artifact: "present" | "missing" | null;
}

/** What the runner is doing now. One run at a time, app-wide, enforced in main — `phase` is that fact, not a UI hint. */
export interface RunnerState {
  phase: "idle" | "running" | "stopping";
  run: RunnerRunView | null;
  /** How the last run ended, until another starts. Null when none has run in this session. */
  last: RunnerOutcome | null;
}

/** One chunk of output, already stripped of escapes and control characters by main. Rendered as TEXT, never as markup. */
export interface RunnerOutputEvent {
  text: string;
}

/**
 * The scheduled backup's cadence (SET-011 / ADR-056). Mirrors `@nexus/db`'s
 * `BACKUP_CADENCES` exactly — redeclared rather than imported, the
 * `AuthErrorReason` pattern, because this file deliberately imports nothing;
 * main assigns the store's own value to this type, so a drift is a compile
 * error rather than a silent gap.
 */
export const BACKUP_CADENCES = ["daily", "weekly"] as const;
export type BackupCadence = (typeof BACKUP_CADENCES)[number];

/** How the last recorded backup run ended — `@nexus/db`'s `BackupRunStatus`, redeclared on `BackupCadence`'s terms. */
export type BackupRunStatus = "ok" | "failed";

/**
 * Why a scheduled backup run failed (`backup_settings.last_error` on the
 * wire). Machine codes, never prose — the renderer maps each to its own
 * Serbian sentence, exactly as `ArchiveReadErrorCode` below works.
 */
export type BackupRunErrorCode =
  | "folder-unreachable" // the configured folder is missing or not a directory at run time
  | "passphrase-unreadable" // the stored wrap does not open under this account's data key (an edited/corrupt row)
  | "write-failed"; // the archive write or its rename into place failed

/** The keep-last choices the settings card offers; main validates the store's whole 2..50 range, so the curated list is UX, never the gate. */
export const BACKUP_KEEP_LAST_CHOICES = [2, 3, 5, 10, 20, 50] as const;

/**
 * One profile's scheduled-backup settings as the renderer sees them (SET-011 /
 * ADR-056). Deliberately NOT the store's own row: `passphrase_wrapped` never
 * crosses the bridge in either direction — the passphrase surface is
 * write-only, and `passphraseSet` is everything the card needs to say
 * „postavljena".
 */
export interface BackupSettingsView {
  enabled: boolean;
  cadence: BackupCadence;
  /** The folder the native directory picker chose, shown verbatim in the card; null while none is chosen. */
  folderPath: string | null;
  /** Whether a wrapped passphrase exists — never the wrap, never the passphrase. */
  passphraseSet: boolean;
  keepLast: number;
  /** When the last run was ATTEMPTED (`lastStatus` says how it went), or null before the first. */
  lastRunAt: string | null;
  lastStatus: BackupRunStatus | null;
  /** A `BackupRunErrorCode` when `lastStatus` is "failed", else null. Typed as string because the row outlives this build's code list; the renderer keeps a fallback sentence. */
  lastError: string | null;
}

// --- Private notes (PRIV v1 / ADR-057) ---------------------------------------

/** The auto-lock bound `@nexus/db`'s `private_settings` CHECK also holds — redeclared on `BACKUP_CADENCES`' terms (this file imports nothing; main assigns the store's values, so drift is a compile error). */
export const PRIV_MIN_AUTO_LOCK_MINUTES = 1;
export const PRIV_MAX_AUTO_LOCK_MINUTES = 60;

/** Byte caps on one envelope's three text fields (SEC-EL-02) — structural bounds on the wire, not editor rules. */
export const PRIV_TITLE_MAX_BYTES = 1024;
export const PRIV_STATE_MAX_BYTES = 8_388_608; // the whole Yjs document state, base64 — a private note carries no incremental update log
export const PRIV_PLAINTEXT_MAX_BYTES = 2_097_152;

/** One private attachment's byte cap (`priv:attachment-pick`, stat-before-read) and how many references one envelope may carry. */
export const PRIV_ATTACHMENT_MAX_BYTES = 104_857_600; // 100 MB
export const PRIV_ATTACHMENTS_MAX_COUNT = 50;

/**
 * The private section's whole visible state (`priv:status`). While `setUp` is
 * false the lock preferences report the defaults a fresh setup would write
 * (5 minutes, lock on minimize) — there is no row yet for them to come from.
 */
export interface PrivStatus {
  setUp: boolean;
  unlocked: boolean;
  /** Whether the credential is the account passcode (true) or a separate passphrase (false). */
  usesAccountPasscode: boolean;
  /** Whether the Recovery Kit wrap exists (setup's `regenerateKit`, or a later regeneration while unlocked) — the Settings status line's one fact. False also before setup. */
  hasRecoveryKit: boolean;
  autoLockMinutes: number;
  lockOnMinimize: boolean;
}

/** One attachment's reference INSIDE the sealed envelope — mirrors `@nexus/core`'s `PrivAttachmentRef`, redeclared (main assigns one to the other, so drift is a compile error). `id` is main-minted (a UUID) and is BOTH the sealed blob's file name and its AES-GCM AAD. */
export interface PrivAttachmentRef {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
}

/**
 * `priv:attachment-pick`'s outcome. `rejected` carries the one reason the UI
 * has a distinct sentence for (the 100 MB cap) plus the catch-all `unreadable`;
 * a canceled dialog is not an error. On `ok` the blob is already sealed on
 * disk — the renderer's next `priv:write` is what makes the reference durable,
 * and a reference never written simply leaves an orphaned sealed file behind
 * (encrypted, unreachable, reclaimed when the note is deleted or never).
 */
export type PrivAttachmentPickResult =
  | { status: "canceled" }
  | { status: "rejected"; code: "too-large" | "unreadable" }
  | { status: "ok"; ref: PrivAttachmentRef };

/**
 * `priv:move-in`'s outcome (public note → private, ADR-057 §5). `too-large`
 * is a merged public document whose sealed envelope would exceed the wire's
 * own caps; `too-many-attachments` is a note past `PRIV_ATTACHMENTS_MAX_COUNT`.
 * Both refuse BEFORE anything is written — the public note stands untouched.
 */
export type PrivMoveInResult =
  | { ok: true; id: string }
  | { ok: false; reason: "too-large" | "too-many-attachments" };

/**
 * `priv:move-out`'s outcome (private note → public). `too-large` is a private
 * document past the public creation path's own per-update cap — the same
 * honest limit `notes:duplicate` inherits; the private note stands untouched.
 */
export type PrivMoveOutResult = { ok: true; note: NoteMeta } | { ok: false; reason: "too-large" };

/** A private note's entire decrypted payload — `@nexus/core`'s `PrivNoteEnvelope`, redeclared on `PrivAttachmentRef`'s terms. Crosses the bridge ONLY while the section is unlocked. */
export interface PrivNoteEnvelopePayload {
  title: string;
  /** The note's whole Yjs document state, base64 — opaque to main and to this wire. */
  yjsState: string;
  /** The flat text mirror the in-memory search index folds (SEC-ZK-05). */
  plaintext: string;
  attachments: PrivAttachmentRef[];
}

/**
 * One row of `priv:list`: the cleartext facts (id, updatedAt) plus the title
 * the DEK just opened. A row whose container fails to open is reported as a
 * named unreadable entry (`title: null, unreadable: true`) rather than
 * crashing the list — the other notes are still the user's to read.
 */
export interface PrivNoteListEntry {
  id: string;
  title: string | null;
  updatedAt: string;
  unreadable: boolean;
}

/**
 * One row of `priv:versions`: the two CLEARTEXT facts a sealed version row has
 * — its bound sequence number and when it was captured. Mirrors `@nexus/db`'s
 * `PrivateNoteVersionMeta`, redeclared on `PrivAttachmentRef`'s terms (main
 * assigns one to the other, so drift is a compile error). Deliberately carries
 * no title: unlike the public history, a private version's title lives inside
 * its sealed container, and opening every container just to label a list is
 * work the panel does one selection at a time (`priv:version-read`).
 */
export interface PrivNoteVersionMeta {
  seq: number;
  createdAt: string;
}

/**
 * Why `priv:setup` was refused. `wrongPasscode`/`throttled` come from the
 * account-passcode verification (the SAME throttle counter the lock screen
 * charges — see `main/auth.ts`'s `verifyPasscode`); `weakCredential` is a
 * separate passphrase failing the account passcode's own 8+/letter-digit rule.
 */
export type PrivSetupErrorReason = "alreadySetUp" | "weakCredential" | "wrongPasscode" | "throttled";

export type PrivSetupResult =
  | {
      ok: true;
      status: PrivStatus;
      /** The freshly minted Recovery Kit code when `regenerateKit` was asked for — shown EXACTLY once, held nowhere. Null when the user opted out. */
      recoveryCode: string | null;
    }
  | { ok: false; reason: Exclude<PrivSetupErrorReason, "throttled"> }
  | { ok: false; reason: "throttled"; lockedForMs: number };

/** Why `priv:unlock` was refused. The throttle is PRIV's own in-memory escalating delay (no permanent lockout; state dies with the process), not the keystore counter. */
export type PrivUnlockErrorReason = "notSetUp" | "wrongCredential" | "throttled";

export type PrivUnlockResult =
  | { ok: true; status: PrivStatus }
  | { ok: false; reason: Exclude<PrivUnlockErrorReason, "throttled"> }
  | { ok: false; reason: "throttled"; lockedForMs: number };

/**
 * Why an archive could not be opened (IMEX slice 3c, ADR-023). Lives here
 * rather than in `main/archiveReader.ts` — the module that actually produces
 * it — because this file is the one place every wire shape is declared once;
 * `archiveReader.ts` imports it type-only and re-exports it, so its existing
 * consumers see no difference. The renderer maps these to Serbian copy; this
 * module never produces user-facing prose.
 */
export type ArchiveReadErrorCode =
  | "not-an-archive" // neither an NXA1 container nor a readable zip
  | "passphrase-required" // an NXA1 container, and no passphrase was supplied
  | "passphrase-wrong" // an NXA1 container whose frames do not authenticate under the derived key
  | "damaged" // structurally broken: truncated, corrupt central directory, duplicate entries
  | "too-large"; // a limit below was exceeded

/**
 * Mirrors `@nexus/core`'s `ImportProblemCode` — plus ONE code of main's own.
 * Redeclared rather than imported — the same pattern `AuthErrorReason`
 * follows — because this file deliberately imports nothing. `main/restore.ts`
 * assigns a core `ImportProblemCode` to this type, so a code added in core and
 * forgotten here is a compile error rather than a silent gap.
 *
 * `profile-kind-mismatch` is the one code the core parser can never produce:
 * it needs the TARGET profile, which only main knows (ADR-058). A restore
 * archive fits only its own KIND of profile — a business archive does not
 * restore into a personal profile, nor the reverse — so main's preview refuses
 * the pair by name. The foreign IMPORT deliberately has no such rule: an
 * import copies rows, and rows are rows whichever kind of profile wrote them.
 */
export type RestoreProblemCode =
  | "missing-manifest"
  | "invalid-manifest"
  | "unsupported-schema-version"
  | "missing-data-file"
  | "checksum-mismatch"
  | "invalid-json"
  | "unknown-record-type"
  | "invalid-record"
  | "duplicate-id"
  | "unknown-reference"
  | "reference-cycle"
  | "invalid-ydoc"
  | "missing-ydoc"
  | "missing-blob"
  | "profile-kind-mismatch";

/** One thing wrong with an archive. `detail` is a machine-ish English fragment (a field name, an id) — never a sentence for a user; the renderer owns all Serbian copy. */
export interface RestoreProblem {
  severity: "error" | "warning";
  code: RestoreProblemCode;
  path?: string;
  line?: number;
  detail?: string;
}

/** Record counts per archive module — exactly `buildExportArchive`'s own manifest grouping (`countProfileModules`, `@nexus/core`). */
export interface RestoreModuleCounts {
  tasks: number;
  calendar: number;
  study: number;
  notifications: number;
  notes: number;
  /** Zero or one — the profile's dashboard background row (SET-006 / ADR-041). */
  dashboard: number;
  /** The whole ledger — accounts, categories, transactions (transfers included, since a transfer IS a row) and budgets (FIN, migration 051). */
  finance: number;
  /** The habits and every day they were ticked (HABIT, migration 055) — the entries count too, because they ARE the module's substance: a streak is derived from them and nothing else. */
  habits: number;
  /**
   * The user's OWN foods, every logged meal item and the goals row (FIT,
   * migration 058). The app's food catalogue is counted nowhere, because it
   * ships as JSON inside the app rather than as rows and is never in an archive
   * at all — a diary stays complete regardless, since every item carries the
   * snapshot it was logged with.
   */
  fitness: number;
  /**
   * The boards (CANV, migration 059) — a count of BOARDS, never of what is drawn
   * on them. One board is one row, drawing and all: the number a restore preview
   * must be right about is how many boards are about to be replaced, and „412
   * shapes" would name something nobody has a name for.
   */
  canvas: number;
  /**
   * The circuits, their placed parts and the wires between them (ELEC,
   * migration 067) — all three summed, unlike `canvas` above. A circuit is
   * the unit the user names, so „4" would understate what a restore
   * replaces; a part and a wire are rows of theirs too. What is counted
   * NOWHERE is the component catalogue: it ships inside the app rather than
   * as rows, exactly as the food catalogue does.
   */
  electronics: number;
}

/** The outcome of the native "pick a restore archive" dialog (IMEX slice 3c). Mirrors `SaveAttachmentResult`'s shape, plus what a restore preview needs before it can even ask for a passphrase: the file's display name and whether it is an `NXA1` container. */
export type RestorePickResult =
  | { canceled: true }
  | { canceled: false; path: string; fileName: string; encrypted: boolean };

/**
 * A dry run of a real restore, computed by actually parsing the picked
 * archive (ADR-023 section 1) — never an estimate. `current`/`incoming` are
 * the SAME module grouping (`countProfileModules`), so the confirmation
 * screen compares like with like.
 */
export interface RestorePreview {
  /** Identifies this exact parse. `applyRestore` refuses any other value, so a stale screen can never apply a preview the user did not see. */
  token: string;
  fileName: string;
  encrypted: boolean;
  /** From the archive's manifest. */
  createdAt: string;
  appVersion: string;
  sourceProfileName: string;
  /** The profile about to be overwritten, as it is right now. */
  targetProfileName: string;
  current: RestoreModuleCounts;
  incoming: RestoreModuleCounts;
  /** Warning-severity problems only (today: a `missing-blob` per attachment row whose file the archive lacks). Errors never reach a preview — they refuse it. */
  warnings: RestoreProblem[];
  /** Blobs present in the archive whose bytes did not hash to their own name: their attachment rows restore, their files do not. */
  corruptBlobs: number;
  /**
   * Present exactly when the archive CARRIES private notes (ADR-057 §6): how
   * many, and whether this apply will restore them — false while the target's
   * private section is locked or was never set up, in which case the card shows
   * the named skip sentence and the profile's existing sealed rows stand
   * untouched. The count is stated either way: an archive holding somebody's
   * private notes is a fact the person confirming a restore must see.
   */
  privateNotes: { count: number; willRestore: boolean } | null;
}

/**
 * `"no-file"` when nothing has been picked yet; `"unreadable"` when the
 * archive itself could not be opened (wrong/missing passphrase, damage,
 * limits); `"invalid"` when it opened but failed validation (a bad manifest,
 * a checksum mismatch, an unknown record) — every error-severity problem
 * found, never withheld; `"ready"` is the only state `applyRestore` accepts.
 */
export type RestorePreviewResult =
  | { status: "no-file" }
  | { status: "unreadable"; code: ArchiveReadErrorCode }
  | { status: "invalid"; problems: RestoreProblem[] }
  | { status: "ready"; preview: RestorePreview };

/** What a completed restore actually wrote (ADR-023 section 1: applying writes exactly what the preview showed — nothing is re-read or re-validated). */
export interface RestoreApplyResult {
  restored: RestoreModuleCounts;
  /** Every row `RestoreStore.replaceProfileData` wrote, across all tables — not just the five modules above. */
  rowsWritten: number;
  /** Attachment blobs whose bytes were new to the store. A blob already present is not counted, and is not undone. */
  blobsAdded: number;
  /**
   * Attachment rows restored whose blob the archive did not carry (or carried
   * corrupt): the rows exist, the files do not. Deliberately attachment-scoped
   * — a dashboard background the archive lacked (ADR-041) is reported as a
   * preview `missing-blob` warning, which is where the user actually decides
   * whether to go ahead, and folding it in here would make this number mean two
   * different things at once.
   */
  missingBlobs: number;
}

/** What undoing a restore actually wrote (ADR-023 section 3: undo removes only the blobs the restore itself added, and only once nothing else references them). */
export interface RestoreUndoResult {
  rowsWritten: number;
  /** Blobs the restore had added and that nothing references anymore. */
  blobsRemoved: number;
}

/**
 * What a freshly reloaded renderer asks for, since the reload replaced the
 * screen that would have shown the undo banner (IMEX-006). ONE slot covers
 * whichever archive operation ran last (ADR-043 section 4, extended by ADR-052
 * to the Anki import) — `kind` is what the banner names, since "poništi
 * vraćanje" and "poništi uvoz" undo very different things even though the
 * mechanism putting them back is identical. `"apkg"` is its own value rather
 * than a second `"import"` for exactly that reason: the sentence that names it
 * is about an Anki deck, not about a Nexus archive — and `"llm"` (IMEX-005) is
 * its own for the same one, since what it undoes came out of a chat window.
 * `"csv"` (ADR-062) joins on identical terms: the sentence that names it is
 * about somebody's spreadsheet — and `"ics"` (ADR-061) likewise, since what
 * it undoes came out of a calendar file. `"fin-csv"` (FIN slice e) is its own
 * for the sharpest version of the same reason: undoing a bank statement is
 * about somebody's money, and a banner that called it „uvoz zadataka" would be
 * naming the wrong thing at the one moment naming matters.
 */
export type RestoreUndoKind =
  | "restore"
  | "import"
  | "apkg"
  | "llm"
  | "csv"
  | "fin-csv"
  | "ics";

export interface RestoreStatus {
  undo: {
    kind: RestoreUndoKind;
    appliedAt: string;
    summary: RestoreApplyResult;
  } | null;
}

/**
 * Picking an archive (`imex:restore-pick`) and dropping the picked one
 * (`imex:restore-cancel`) carry no payload at all — main holds the pick, so
 * there is nothing for the renderer to name — and so declare no request shape
 * here.
 */
export interface ImexRestorePreviewRequest {
  profileId: string;
  /**
   * `null` for a plain `.nexus.zip`, which needs none. Deliberately NOT held
   * to `validateArchivePassphrase`, unlike `ImexExportRequest`'s: an EXPORT
   * passphrase is a policy decision — we refuse to WRITE a weak archive — while
   * a RESTORE passphrase is merely an attempt at a file that already exists.
   * The file on disk is the authority on what opens it, so main only bounds
   * this value's length and never policy-checks it; a wrong one simply fails
   * AEAD authentication (`deriveArchiveKey` canonicalizes through
   * `normalizeArchivePassphrase`, so form differences never matter).
   */
  passphrase: string | null;
}

/** `token` names the exact preview being confirmed — main refuses any other value, so a stale screen can never apply a parse the user did not see. */
export interface ImexRestoreApplyRequest {
  profileId: string;
  token: string;
}

export interface ImexRestoreUndoRequest {
  profileId: string;
}

export interface ImexRestoreStatusRequest {
  profileId: string;
}

// --- Foreign import (ADR-043) -----------------------------------------------

/**
 * The archive modules an import's arithmetic is grouped by — `RestoreModuleCounts`'
 * own keys, so the set is declared exactly once in this file. `main` assigns
 * `@nexus/core`'s `Record<ArchiveModuleId, …>` to the report below, which makes
 * a module added in core and forgotten here a compile error.
 *
 * The same names an EXPORT names its module subset by (`ImexExportRequest.modules`,
 * IMEX-003): one archive-module vocabulary on this wire, not two.
 */
export type ArchiveModuleName = keyof RestoreModuleCounts;

/**
 * Mirrors `@nexus/core`'s `ArchiveRecordType` exactly — the `type` discriminant
 * an interchange row carries. Redeclared rather than imported, the same pattern
 * `RestoreProblemCode` follows and for the same reason: this file deliberately
 * imports nothing, and `main`'s assignment of a core value to this type is what
 * turns a record type added in core into a compile error here.
 */
export type ImportRecordType =
  | "task"
  | "task-list"
  | "task-section"
  | "task-tag"
  | "task-tag-link"
  | "task-attachment"
  | "task-template"
  | "task-dependency"
  | "event"
  | "event-template"
  | "document"
  | "renewal"
  | "person"
  | "calendar-settings"
  | "subject"
  | "subject-attachment"
  | "subject-note-link"
  | "exam"
  | "deck"
  | "card"
  | "review"
  | "exam-topic"
  | "plan"
  | "block"
  | "focus-session"
  | "study-settings"
  | "notification"
  | "note-folder"
  | "note-tag"
  | "note-category"
  | "note"
  | "note-tag-link"
  | "note-attachment"
  | "note-version"
  | "note-template"
  | "dashboard-settings"
  | "dashboard-set"
  | "dashboard-widget"
  | "private-note"
  | "private-note-version"
  | "fin-account"
  | "fin-category"
  | "fin-recurring"
  | "fin-transaction"
  | "fin-budget"
  | "habit"
  | "habit-entry"
  | "fit-food"
  | "fit-meal-item"
  | "fit-target"
  | "fit-exercise"
  | "fit-routine"
  | "fit-routine-item"
  | "fit-workout"
  | "fit-workout-set"
  | "fit-measurement"
  | "fit-body-profile"
  | "canvas-board"
  | "circuit"
  | "circuit-chassis"
  | "circuit-part"
  | "circuit-wire";

/**
 * Why rows the archive carried are not in the plan. Mirrors `@nexus/core`'s
 * `ImportSkipCode`: either salvage mode could not read them (the first seven,
 * which are `RestoreProblemCode`s) or the planner skips them BY DESIGN. The
 * renderer maps each to Serbian copy; nothing here is user-facing prose.
 */
export type ImportSkipCode =
  | "unknown-record-type"
  | "invalid-record"
  | "duplicate-id"
  | "unknown-reference"
  | "reference-cycle"
  | "missing-ydoc"
  | "invalid-ydoc"
  | "settings-not-imported"
  | "notifications-not-imported"
  | "dashboard-settings-not-imported"
  | "dashboard-sets-not-imported"
  | "dashboard-widgets-not-imported"
  | "study-settings-not-imported"
  /** A FIT goals row (migration 058): the target user's own decision about their own body, never the archive author's. Its own code, on `study-settings-not-imported`'s terms. */
  | "fit-targets-not-imported"
  /** The profile's own body facts — sex, birth date, height, activity (migration 060). `fit-targets-not-imported`'s exact reasoning, restated for the row beside it. */
  | "fit-body-profile-not-imported"
  /** A body-weight log entry (migration 060): keyed by `(profileId, day)`, so importing it could only ever collide with or silently duplicate the target's own reading for that day. */
  | "fit-measurements-not-imported"
  | "calendar-settings-not-imported"
  | "profile-picture-not-imported"
  | "private-notes-not-imported"
  | "template-name-taken"
  | "source-inbox-collapsed"
  | "duplicate-of-existing"
  /** A FIN budget whose (category, currency) the target already limits (migration 051) — its own code, because the sentence a user needs is about a slot rather than a name. */
  | "budget-slot-taken";

/** One named, counted group of skipped rows, grouped by `(code, module, type)` in first-seen order. `module`/`type` are null for a skip that belongs to neither (the manifest's settings). */
export interface ImportSkipReason {
  code: ImportSkipCode;
  module: ArchiveModuleName | null;
  type: ImportRecordType | null;
  count: number;
}

/**
 * The kinds of row an import can recognise as something this profile ALREADY
 * HAS (ADR-051 / IMEX-008). Mirrors `@nexus/core`'s `ImportDuplicateType`
 * exactly, redeclared here like every other shape in this file; `main`'s
 * assignment of a core value to this type is what turns a group added in core
 * into a compile error rather than a row the screen silently cannot label.
 *
 * `"attachment"` is one group across all three attachment tables: the identity
 * is the FILE („ista datoteka"), which is the same sentence wherever the row
 * hangs. The report still counts the skips per module.
 */
export type ImportDuplicateType = "event" | "person" | "document" | "attachment";

/** Every `ImportDuplicateType`, in the order the preview lists them — also the closed domain `main` validates a re-plan payload against. */
export const IMPORT_DUPLICATE_TYPES = ["event", "person", "document", "attachment"] as const;

/** What to do with one group. `"skip"` is the default for every group main has not been told about. */
export type ImportDuplicateChoice = "skip" | "import";

/** The renderer's answer per group — partial, because a group nobody has answered is skipped. */
export type ImportDuplicateChoices = Partial<Record<ImportDuplicateType, ImportDuplicateChoice>>;

/** One detected group and how many rows it covers. Reported whichever way the group's choice currently points, so the screen can always offer the other one. */
export interface ImportDuplicateGroup {
  type: ImportDuplicateType;
  count: number;
}

/** One module's arithmetic. `parsed` always equals `imported + merged + skipped` — a report that did not balance would be worse than no report at all. */
export interface ImportModuleCounts {
  /** Everything the archive carried for this module, including the rows salvage mode dropped. */
  parsed: number;
  /** Rows the import will insert as new rows. */
  imported: number;
  /** Rows that resolved onto something the target already has (a tag matched by name, a link that collapsed onto an existing pair). */
  merged: number;
  /** Rows that will not be inserted at all — every one of them named in `skips`. */
  skipped: number;
}

/** The whole honest account of what an import would do, straight off `planForeignImport`'s own report. */
export interface ImportPlanReport {
  modules: Record<ArchiveModuleName, ImportModuleCounts>;
  skips: ImportSkipReason[];
  /** Every duplicate group detected (ADR-051), groups with none omitted — one choice row each on the preview screen. */
  duplicates: ImportDuplicateGroup[];
}

/**
 * The outcome of the native "pick an archive to import" dialog. Structurally a
 * `RestorePickResult` and deliberately declared as one: the two flows pick the
 * same kind of file through the same dialog, and only what happens NEXT differs.
 */
export type ImportPickResult = RestorePickResult;

/**
 * A dry run of a real import (ADR-043 section 3), computed by actually parsing
 * the picked archive in `"import"` mode and really planning it against this
 * profile — never an estimate. Unlike a restore's preview it does not compare
 * "current" with "incoming": nothing is being replaced, so the only honest
 * numbers are what would be ADDED, and what would not.
 */
export interface ImportPreview {
  /** Identifies this exact parse-and-plan. `applyImport` refuses any other value, so a stale screen can never apply a plan the user did not see. */
  token: string;
  fileName: string;
  encrypted: boolean;
  /** From the archive's manifest. */
  createdAt: string;
  appVersion: string;
  /** The profile the archive was exported FROM — somebody else's, or the user's own other account. */
  sourceProfileName: string;
  /** The profile the rows would be merged INTO, as it is right now. */
  targetProfileName: string;
  report: ImportPlanReport;
  /** Warning-severity problems only. In import mode this is where every salvaged row is named, one warning each; errors refuse the archive outright. */
  warnings: RestoreProblem[];
  /** Blobs present in the archive whose bytes did not hash to their own name: their attachment rows import, their files do not. */
  corruptBlobs: number;
}

/**
 * `"no-file"` when nothing has been picked yet; `"unreadable"` when the archive
 * could not be opened (wrong/missing passphrase, damage, limits); `"invalid"`
 * when it opened but failed validation at the ARCHIVE level — a bad manifest, a
 * checksum mismatch, an unsupported version — which import mode refuses exactly
 * as a restore does, since a corrupt container is not something to guess at.
 * `"ready"` is the only state `applyImport` accepts.
 */
export type ImportPreviewResult =
  | { status: "no-file" }
  | { status: "unreadable"; code: ArchiveReadErrorCode }
  | { status: "invalid"; problems: RestoreProblem[] }
  | { status: "ready"; preview: ImportPreview };

/**
 * What a completed import actually wrote. Deliberately the SAME shape a restore
 * reports, because the two are undone through one slot and shown through one
 * banner (ADR-043 section 4): `restored` counts the rows this operation put into
 * the profile, which is what both operations mean by it. The plan's own
 * arithmetic — parsed/imported/merged/skipped per module — belongs to the
 * PREVIEW, where the user decides, not to the receipt.
 */
export type ImportApplyResult = RestoreApplyResult;

/**
 * Picking an archive (`imex:import-pick`) and dropping the picked one
 * (`imex:import-cancel`) carry no payload — main holds the pick — and so declare
 * no request shape. Undo and status have no import-specific request either: one
 * slot, one banner, `imex:restore-undo`/`imex:restore-status` for both.
 */
export interface ImexImportPreviewRequest {
  profileId: string;
  /** `null` for a plain `.nexus.zip`. Bounded but never policy-checked, for exactly the reason `ImexRestorePreviewRequest`'s is not: the file on disk is the authority on what opens it. */
  passphrase: string | null;
}

/**
 * Re-plans the archive THIS preview already has open, under different duplicate
 * choices (ADR-051). `token` names the plan being replaced — main refuses any
 * other value, exactly as an apply does, so a stale screen can never re-plan an
 * archive it is no longer looking at.
 *
 * The answer is a full `ImportPreviewResult`: re-planning mints a FRESH token
 * (the old plan is gone, and a screen still holding its token must not be able
 * to apply it), so the renderer needs the whole preview back rather than a diff.
 * No passphrase field, and deliberately so — the archive is already open, so a
 * re-plan never touches the KDF and the user is never asked twice.
 */
export interface ImexImportReplanRequest {
  profileId: string;
  token: string;
  choices: ImportDuplicateChoices;
}

/** `token` names the exact plan being confirmed — main refuses any other value, so a stale screen can never apply a plan the user did not see. */
export interface ImexImportApplyRequest {
  profileId: string;
  token: string;
}

// --- Markdown import (IMEX-007) ---------------------------------------------

/**
 * Which dialog `imex:import-markdown` opens. Two values rather than one
 * everything-picker because Electron's `showOpenDialog` cannot be both on
 * Windows and Linux: `["openFile", "openDirectory"]` silently degrades to a
 * DIRECTORY picker there, which would take the "choose files" button's meaning
 * away on the platform this app ships on first.
 */
export type MarkdownImportSource = "files" | "folder";

/** Maximum size of one `.md` file, checked by `stat` before it is ever read. */
export const MARKDOWN_IMPORT_MAX_BYTES = 1_048_576;

/** Maximum number of files one pick may turn into notes; the rest are reported, never silently dropped. */
export const MARKDOWN_IMPORT_MAX_FILES = 200;

// --- Anki .apkg import (ADR-052 / STUDY-011) ---------------------------------

/**
 * Every bound `main/apkgReader.ts` enforces on an `.apkg`, declared here beside
 * `MARKDOWN_IMPORT_*` because this file is where every limit the app is willing
 * to state lives.
 *
 * An `.apkg` is a plain zip carrying somebody else's SQLite DATABASE, which is
 * a wider attack surface than any other file this app opens: the reader has to
 * hand those bytes to SQLite itself. Every one of these is a NAMED REFUSAL —
 * the file is rejected with a reason the screen can say out loud — and never a
 * truncation, because half of somebody's deck arriving silently is the one
 * outcome an import must never produce.
 */

/** The `.apkg` file itself, on disk. Anki's own shared decks top out far below this; anything larger is not a deck, it is a payload. */
export const APKG_IMPORT_MAX_FILE_BYTES = 524_288_000; // 500 MiB

/**
 * The UNCOMPRESSED collection database. Lower than the file cap, and
 * deliberately so: this one becomes RESIDENT — the whole database is held in
 * main's heap while it is read (there is no temp file and nothing on disk) — so
 * it is the number that protects the process, exactly as `maxResidentBytes`
 * does for a Nexus archive. Also the ceiling a zstd-compressed collection is
 * decompressed under, so a compression bomb never allocates past it.
 */
export const APKG_IMPORT_MAX_COLLECTION_BYTES = 268_435_456; // 256 MiB

/** Entries in the zip's central directory, counting the ones the reader skips — the cost of the walk itself. */
export const APKG_IMPORT_MAX_ENTRIES = 10_000;

/** Rows read out of the collection's `notes` table. */
export const APKG_IMPORT_MAX_NOTES = 200_000;

/** Rows read out of the collection's `cards` table — higher than the note cap, since one note makes several. */
export const APKG_IMPORT_MAX_CARDS = 500_000;

/** Entries the `media` manifest may declare. Counted, never fetched: v1 imports no media. */
export const APKG_IMPORT_MAX_MEDIA_ENTRIES = 200_000;

/** One field of one note, in UTF-8 bytes. A card's text, not a file: past this the field is not text somebody typed. */
export const APKG_IMPORT_MAX_FIELD_BYTES = 262_144; // 256 KiB

/**
 * Why an `.apkg` could not be read at all. The counterpart of
 * `ArchiveReadErrorCode` for this file type, and separate from it because the
 * failures are genuinely different ones — there is no passphrase here, and
 * there are two ways to be unreadable that a Nexus archive has no equivalent
 * of.
 *
 * `unsupported-schema` is the honest name for a collection this build will not
 * GUESS about. Both versions Anki itself exports are read completely — schema
 * 11 („Support older Anki versions") and schema 18 (`collection.anki21b`) — so
 * what remains is a schema NEWER than 18 (a future Anki), one of the in-place
 * upgrade steps 12–17 no exporter writes, or something older than 11. A
 * guessed read could put a cloze note's raw `{{c1::…}}` text on the front of a
 * "basic" card, so all three are refused by name instead.
 */
export type ApkgReadErrorCode =
  | "not-an-apkg"
  | "no-collection"
  | "unsupported-schema"
  | "zstd-unavailable"
  | "damaged"
  | "too-large";

/**
 * Why something the `.apkg` carried is not in the plan. Mirrors `@nexus/core`'s
 * `ApkgSkipCode` exactly — redeclared here like every other closed domain in
 * this file, so `main`'s assignment of a core value to this type turns a code
 * added in core into a compile error rather than a line the screen cannot
 * label.
 */
export type ApkgImportSkipCode =
  | "unknown-notetype"
  | "unknown-deck"
  | "empty-note"
  | "empty-deck"
  | "template-unsupported"
  | "cloze-nested"
  | "cloze-no-deletions"
  | "cloze-unrepresentable"
  | "cloze-hint-dropped"
  | "extra-fields-dropped"
  | "media-stripped"
  | "tags-dropped"
  | "history-dropped"
  | "card-without-note";

/** One named, counted group of things that will not arrive. */
export interface ApkgImportSkip {
  code: ApkgImportSkipCode;
  count: number;
}

/**
 * Where the imported decks land. Exactly one of the two is non-null, which main
 * validates before a single row is planned: an `.apkg` has no subject of its
 * own, so this is a decision only the user can make and the preview cannot be
 * computed without it.
 */
export interface ApkgImportSubjectChoice {
  /** An existing subject of this profile. */
  existingSubjectId: string | null;
  /** A subject this import creates. */
  newSubjectName: string | null;
}

/** Longest name „Nova oblast" accepts — the same ceiling the subject form itself is held to. */
export const APKG_IMPORT_MAX_SUBJECT_NAME_LENGTH = 120;

/**
 * The outcome of the native "pick an .apkg" dialog. Structurally a
 * `RestorePickResult` minus its `encrypted` flag, which an `.apkg` has no
 * concept of — a plain zip is the only shape this file comes in.
 */
export type ApkgImportPickResult =
  | { canceled: true }
  | { canceled: false; path: string; fileName: string };

/**
 * A dry run of a real `.apkg` import: the file really read, really translated
 * and really planned against this profile under the subject the request named.
 *
 * Two reports, and they answer different questions. `modules` is
 * `planForeignImport`'s own per-module arithmetic, the same table the archive
 * import shows — what the plan will insert. `skips` is the TRANSLATOR's: every
 * Anki-shaped thing that does not survive the crossing, named and counted, from
 * the media this build does not carry to the review history it deliberately
 * drops.
 */
export interface ApkgImportPreview {
  /** Identifies this exact read-and-plan. The apply refuses any other value, so a stale screen can never write a plan the user did not see. */
  token: string;
  fileName: string;
  /** The subject the decks will hang off, by name — the existing one the user picked, or the one this import will create. */
  subjectName: string;
  /** True when that subject does not exist yet, so the screen can say the import will create it. */
  subjectIsNew: boolean;
  /** What the collection carried, before any of this build's rules ran. */
  sourceDecks: number;
  sourceNotes: number;
  sourceCards: number;
  /** What the plan will actually create. `plannedNotes` counts Anki NOTES that produced at least one card, so it is comparable with `sourceNotes` — Nexus itself has no note row here. */
  plannedDecks: number;
  plannedNotes: number;
  plannedCards: number;
  /** `planForeignImport`'s own arithmetic, per archive module — only STUDY is ever non-zero for an `.apkg`. */
  modules: Record<ArchiveModuleName, ImportModuleCounts>;
  skips: ApkgImportSkip[];
}

/**
 * `"no-file"` when nothing has been picked yet; `"unreadable"` when the file
 * could not be read at all (not a zip, no collection inside, a schema this
 * build refuses to guess about, a cap); `"ready"` is the only state the apply
 * accepts.
 *
 * There is no `"invalid"` arm, unlike an archive's: an `.apkg` carries no
 * manifest to be wrong and no checksum to mismatch, so every way it can fail is
 * a way it could not be READ.
 */
export type ApkgImportPreviewResult =
  | { status: "no-file" }
  | { status: "unreadable"; code: ApkgReadErrorCode }
  | { status: "ready"; preview: ApkgImportPreview };

/** What a completed `.apkg` import wrote. The same shape both archive operations report, because it is undone through the same one slot and shown through the same one banner. */
export type ApkgImportApplyResult = RestoreApplyResult;

/**
 * Picking a file (`imex:import-apkg-pick`) and dropping the picked one
 * (`imex:import-apkg-cancel`) carry no payload — main holds the pick — and so
 * declare no request shape. Undo and status have none either: one slot, one
 * banner, `imex:restore-undo`/`imex:restore-status` for all three operations.
 *
 * The SUBJECT rides on the preview request rather than on the apply, because
 * the plan depends on it: which subject the decks hang off decides whether a
 * subject row is created at all. Re-previewing under a different subject
 * re-plans the file main already has open — the same precedent
 * `imex:import-replan` sets, and for the same reason: changing an answer must
 * not cost what opening the file cost.
 */
export interface ImexImportApkgPreviewRequest {
  profileId: string;
  subject: ApkgImportSubjectChoice;
}

/** `token` names the exact plan being confirmed — main refuses any other value. */
export interface ImexImportApkgApplyRequest {
  profileId: string;
  token: string;
}

// --- CSV task import (ADR-062) -----------------------------------------------

/**
 * The CSV file itself, on disk — checked by a stat BEFORE the read, so an
 * oversized file is refused without a byte of it entering main's heap. A CSV
 * this import reads is a hand-kept table; past five megabytes it is not one.
 */
export const CSV_IMPORT_MAX_FILE_BYTES = 5_242_880; // 5 MiB

/**
 * Columns one file may carry. A hand-kept table has tens; past this the file
 * is a matrix, not a task list — and every column costs the wire a header, a
 * role select and three samples, so the bound protects the mapping step
 * itself. A NAMED refusal, like every cap on this wire, never a truncation.
 */
export const CSV_IMPORT_MAX_COLUMNS = 128;

/** Longest name the mapping step's new-list input accepts — `MAX_TASK_LIST_NAME_LENGTH`, the ceiling the list form itself is held to. */
export const CSV_IMPORT_MAX_LIST_NAME_LENGTH = MAX_TASK_LIST_NAME_LENGTH;

/**
 * Why a picked CSV could not be turned into columns at all. `empty` covers a
 * file with no rows AND one whose header is its only row — either way there is
 * no data row to map. No `not-a-csv`: the format has no magic bytes, so any
 * text IS one — what varies is only how it reads.
 */
export type CsvImportReadErrorCode = "too-large" | "empty" | "too-many-columns" | "unreadable";

/**
 * Mirrors `@nexus/core`'s `CsvColumnRole` exactly — redeclared here like every
 * other closed domain in this file, so `main`'s assignment of a core value to
 * this type turns a role added in core into a compile error rather than an
 * option the screen cannot label.
 */
export type CsvImportColumnRole =
  | "title"
  | "description"
  | "dueDate"
  | "priority"
  | "status"
  | "list"
  | "section"
  | "tags"
  | "ignore";

/** Every role, in the order the mapping dialog's selects offer them — and what main validates an incoming one against. */
export const CSV_IMPORT_COLUMN_ROLES: readonly CsvImportColumnRole[] = [
  "title",
  "description",
  "dueDate",
  "priority",
  "status",
  "list",
  "section",
  "tags",
  "ignore",
];

/** The two delimiters the reader sniffs between — RFC 4180's comma, and the semicolon Serbian-locale Excel writes. Mirrors core's `CsvDelimiter`. */
export type CsvImportDelimiter = "," | ";";

/** Both delimiters, in the order the mapping dialog's toggle offers them. */
export const CSV_IMPORT_DELIMITERS: readonly CsvImportDelimiter[] = [",", ";"];

/** How many sample values each column of the mapping step shows — enough to recognise a column, few enough that the dialog stays a dialog. */
export const CSV_IMPORT_SAMPLE_ROWS = 3;

/** One detected column of the mapping step: what it calls itself, what its first rows hold, and the role the header table suggests. */
export interface CsvImportColumn {
  /** The header cell, or null when the file has no header row — the screen then names the column by position. */
  header: string | null;
  /** The column's first `CSV_IMPORT_SAMPLE_ROWS` data values, empty cells included. */
  samples: string[];
  /** The bilingual header table's suggestion (ADR-062) — a suggestion the user confirms in the mapping step, never a silent guess. */
  suggestedRole: CsvImportColumnRole;
}

/**
 * The columns step: the file really read and really parsed under the delimiter
 * and header choice the request named (or the sniff's own answer, when it
 * named none). What it deliberately is NOT is a plan — no counts, no drops:
 * those need a confirmed mapping, which is `imex:import-csv-map`'s answer.
 */
export interface CsvImportPreview {
  fileName: string;
  /** The delimiter this parse used — the sniff's answer, or the override that replaced it. What the dialog's toggle shows. */
  delimiter: CsvImportDelimiter;
  /** Whether the first row was read as a header — the sniff's answer, or the override. */
  hasHeader: boolean;
  columns: CsvImportColumn[];
  /** Data rows under this parse, header excluded, blank lines included. */
  rows: number;
}

export type CsvImportPreviewResult =
  | { status: "no-file" }
  | { status: "unreadable"; code: CsvImportReadErrorCode }
  | { status: "ready"; preview: CsvImportPreview };

/**
 * Where the imported tasks land — ALL of them: a CSV import targets ONE list
 * (ADR-062). Exactly one of the two fields is non-null, which main validates
 * structurally (`ApkgImportSubjectChoice`'s rule) and `restore.ts` semantically
 * against the profile's live lists.
 */
export interface CsvImportListChoice {
  /** An existing list of this profile — the Inbox included; it is a list like any other here. */
  existingListId: string | null;
  /** A list this import creates. A name an active list already carries means THAT list — the same get-or-create reading a new deck's name gets (IMEX-005). */
  newListName: string | null;
}

/**
 * Why one data row lost something. Mirrors `@nexus/core`'s `CsvRowDropCode`
 * exactly, on the same drift-check terms as every closed domain here.
 */
export type CsvImportRowDropCode = "empty-title" | "bad-due-date";

/** One named loss, with the 1-based data-row number (header excluded) so the user can find the cell in their spreadsheet. */
export interface CsvImportRowDrop {
  row: number;
  code: CsvImportRowDropCode;
}

/**
 * The confirmed mapping's dry run: the session's rows really translated and
 * really planned against this profile — never an estimate. Two reports, as on
 * an `.apkg` preview: `modules` is `planForeignImport`'s own arithmetic (the
 * merged column is real — a tag the profile already has merges onto it), and
 * the drop fields are the TRANSLATOR's account of what the spreadsheet loses.
 */
export interface CsvImportPlanPreview {
  /** Identifies this exact mapping-and-plan. The apply refuses any other value, so a stale screen can never write a plan the user did not see. */
  token: string;
  fileName: string;
  /** The destination list, by name — the existing one chosen, or the one this import will create. */
  listName: string;
  /** True when that list does not exist yet, so the screen can say the import will create it. */
  listIsNew: boolean;
  /** Data rows read, blank lines included. */
  rows: number;
  /** Task rows the plan will insert. */
  tasks: number;
  /** Rows whose every cell was empty — skipped silently, counted so the arithmetic balances. */
  blankRows: number;
  /** `planForeignImport`'s own arithmetic, per archive module — only TASKS is ever non-zero for a CSV. */
  modules: Record<ArchiveModuleName, ImportModuleCounts>;
  drops: CsvImportRowDrop[];
  /** Non-empty cells of a column mapped `"list"` — counted, never honoured, since the import targets ONE list (ADR-062). */
  listCellsDropped: number;
}

/**
 * `roles` names one role per detected column, in column order — its length
 * must equal the preview's column count, exactly one entry must be `"title"`,
 * and no other role may repeat (main checks the shape, `restore.ts` the
 * session). The mapping travels; the DATA never does — the parsed cells live
 * in main's pending session (SEC-EL).
 */
export interface ImexImportCsvMapRequest {
  profileId: string;
  roles: CsvImportColumnRole[];
  list: CsvImportListChoice;
}

export type CsvImportMapResult =
  | { status: "no-file" }
  | { status: "ready"; preview: CsvImportPlanPreview };

/** What a completed CSV import wrote. The same shape every archive operation reports, because it is undone through the same one slot and shown through the same one banner. */
export type CsvImportApplyResult = RestoreApplyResult;

/** The outcome of the native "pick a CSV" dialog — `ApkgImportPickResult`'s shape, for the same file-with-no-encryption reason. */
export type CsvImportPickResult =
  | { canceled: true }
  | { canceled: false; path: string; fileName: string };

// --- Bank statement CSV → FIN (FIN slice e) ----------------------------------

/**
 * Mirrors `@nexus/core`'s `CsvFinanceColumnRole` exactly — redeclared here like
 * every other closed domain in this file, so `main`'s assignment of a core value
 * to this type turns a role added in core into a compile error rather than an
 * option the screen cannot label.
 *
 * The amount side has three members because Serbian bank exports come both ways:
 * one signed `amount` column, or a separate outflow/inflow pair. The pair is
 * named by MEANING (money leaving, money arriving) rather than by
 * „duguje"/„potražuje", which mean opposite things depending on whose books are
 * being read.
 */
export type FinCsvImportColumnRole =
  | "date"
  | "amount"
  | "outflow"
  | "inflow"
  | "payee"
  | "note"
  | "currency"
  | "ignore";

/** Every role, in the order the mapping dialog's selects offer them — and what main validates an incoming one against. */
export const FIN_CSV_IMPORT_COLUMN_ROLES: readonly FinCsvImportColumnRole[] = [
  "date",
  "amount",
  "outflow",
  "inflow",
  "payee",
  "note",
  "currency",
  "ignore",
];

/** Which way a SIGNED amount column points — the user's answer, never a sniff. Mirrors core's `CsvFinanceSignConvention`. */
export type FinCsvImportSignConvention = "negative-is-expense" | "positive-is-expense";

/** Both conventions, in the order the mapping dialog offers them. The default is first: it is FIN's own sign rule (negative leaves the account). */
export const FIN_CSV_IMPORT_SIGN_CONVENTIONS: readonly FinCsvImportSignConvention[] = [
  "negative-is-expense",
  "positive-is-expense",
];

/** Mirrors core's `CsvFinanceAmountFormat` — what the preview SAYS the file's numbers were read as, so the convention is visible rather than trusted. */
export type FinCsvImportAmountFormat = "decimal-comma" | "decimal-dot";

/** Mirrors core's `CsvFinanceDateFormat`, on the same terms. */
export type FinCsvImportDateFormat = "iso" | "dmy-dot" | "dmy-slash" | "mdy-slash";

/** Mirrors core's `CsvFinanceRefusalCode`: why the WHOLE file is refused rather than half-read. Every one is a case where reading on would mean choosing a number out of two. */
export type FinCsvImportRefusalCode =
  | "ambiguous-amount-format"
  | "unreadable-amount-format"
  | "ambiguous-date-format"
  | "unreadable-date-format"
  | "foreign-currency";

/** A named refusal of the file, with the column it is about and the offending cell verbatim, so the user can find it in their own spreadsheet. */
export interface FinCsvImportRefusal {
  code: FinCsvImportRefusalCode;
  /** 0-based column index — the screen names it from the preview's own headers. */
  column: number;
  sample: string;
}

/** Mirrors core's `CsvFinanceRowDropCode`. `text-truncated` is the only one that does not cost the row its place. */
export type FinCsvImportRowDropCode =
  | "bad-date"
  | "no-amount"
  | "both-amounts"
  | "bad-amount"
  | "text-truncated";

/** One named loss, with the 1-based data-row number (header excluded). */
export interface FinCsvImportRowDrop {
  row: number;
  code: FinCsvImportRowDropCode;
}

/** Mirrors core's `CsvFinanceRowSkipCode`: why a row is already in the ledger (migration 052). Two codes, because „you already have this" and „you had this and deleted it" are different sentences. */
export type FinCsvImportRowSkipCode = "already-imported" | "already-imported-deleted";

export interface FinCsvImportRowSkip {
  row: number;
  code: FinCsvImportRowSkipCode;
}

/** One detected column of the mapping step — `CsvImportColumn`'s twin over this surface's own role vocabulary. */
export interface FinCsvImportColumn {
  /** The header cell, or null when the file has no header row — the screen then names the column by position. */
  header: string | null;
  /** The column's first `CSV_IMPORT_SAMPLE_ROWS` data values, empty cells included. */
  samples: string[];
  suggestedRole: FinCsvImportColumnRole;
}

/**
 * The columns step: the statement really read and really parsed under the
 * delimiter and header choice the request named (or the sniff's own answer).
 * Not a plan — counts and drops need a confirmed mapping, which is
 * `imex:import-fin-csv-map`'s answer.
 */
export interface FinCsvImportPreview {
  fileName: string;
  delimiter: CsvImportDelimiter;
  hasHeader: boolean;
  columns: FinCsvImportColumn[];
  /** Data rows under this parse, header excluded, blank lines included. */
  rows: number;
}

export type FinCsvImportPreviewResult =
  | { status: "no-file" }
  | { status: "unreadable"; code: CsvImportReadErrorCode }
  | { status: "ready"; preview: FinCsvImportPreview };

/**
 * The confirmed mapping's dry run: the session's rows really translated and
 * really planned against this profile — never an estimate.
 *
 * `formats` is what makes the two conventions VISIBLE: the file's numbers and
 * dates were settled over whole columns, and the screen says which reading won
 * rather than asking the user to trust one.
 */
export interface FinCsvImportPlanPreview {
  /** Identifies this exact mapping-and-plan. The apply refuses any other value, so a stale screen can never write a plan the user did not see. */
  token: string;
  fileName: string;
  /** The destination account, by name, and its currency — the one that governed every amount read. */
  accountName: string;
  currency: string;
  /** Data rows read, blank lines included. */
  rows: number;
  /** Ledger rows the plan will insert. */
  transactions: number;
  /** Rows whose every cell was empty — skipped silently, counted so the arithmetic balances. */
  blankRows: number;
  /** `planForeignImport`'s own arithmetic, per archive module — only FINANCE is ever non-zero for a statement. */
  modules: Record<ArchiveModuleName, ImportModuleCounts>;
  drops: FinCsvImportRowDrop[];
  /** Rows migration 052's fingerprint recognised as already imported — every one named, never a bare count. */
  skips: FinCsvImportRowSkip[];
  amountFormat: FinCsvImportAmountFormat;
  dateFormat: FinCsvImportDateFormat;
  signConvention: FinCsvImportSignConvention;
}

/**
 * `roles` names one role per detected column, in column order — its length must
 * equal the preview's column count, and no role but `ignore` may repeat (main
 * checks the shape; the translator checks that a date column exists and that the
 * amount arrives as EITHER one signed column OR an outflow/inflow pair). The
 * mapping travels; the DATA never does — the parsed cells live in main's pending
 * session (SEC-EL).
 */
export interface ImexImportFinCsvMapRequest {
  profileId: string;
  roles: FinCsvImportColumnRole[];
  /** An existing account of this profile. There is no „new account" option: an account carries a currency and an opening balance a statement cannot supply. */
  accountId: string;
  signConvention: FinCsvImportSignConvention;
}

export type FinCsvImportMapResult =
  | { status: "no-file" }
  /** The file could not be read CONFIDENTLY — refused whole, by name, rather than half-read (FIN slice e). */
  | { status: "refused"; refusal: FinCsvImportRefusal }
  | { status: "ready"; preview: FinCsvImportPlanPreview };

/** What a completed statement import wrote. The same shape every archive operation reports, because it is undone through the same one slot and shown through the same one banner. */
export type FinCsvImportApplyResult = RestoreApplyResult;

/**
 * Picking (`imex:import-fin-csv-pick`) and dropping the pick
 * (`imex:import-fin-csv-cancel`) carry no payload — main holds the pick. The
 * delimiter/header OVERRIDES ride on the preview request, exactly as they do on
 * the task CSV's.
 */
export interface ImexImportFinCsvPreviewRequest {
  profileId: string;
  delimiter: CsvImportDelimiter | null;
  hasHeader: boolean | null;
}

/** `token` names the exact plan being confirmed — main refuses any other value. */
export interface ImexImportFinCsvApplyRequest {
  profileId: string;
  token: string;
}

// --- Calendar .ics import (ADR-061) ------------------------------------------

/**
 * The one bound `main/icsReader.ts` enforces on an `.ics`, declared here beside
 * the `.apkg` caps because this file is where every limit the app is willing to
 * state lives. A calendar is line-oriented text somebody's app wrote — twenty
 * mebibytes is years of a busy calendar, and past it the file is not a calendar,
 * it is a payload. One cap and not seven, unlike the `.apkg`'s: there is no zip
 * to walk, no SQLite image to hold resident and no per-field blob — the text IS
 * the whole cost, and it is read once and dropped the moment it is parsed.
 */
export const ICS_IMPORT_MAX_FILE_BYTES = 20_971_520; // 20 MiB

/**
 * Why an `.ics` could not be read at all. Two members, not six: a text file has
 * exactly two ways to be unreadable — bigger than the cap, or not a calendar
 * once the parser looks (no `VCALENDAR` anywhere in it). Anything else the file
 * carries is a per-event skip, named in the preview, never a refusal of the
 * whole file.
 */
export type IcsImportReadErrorCode = "too-large" | "not-a-calendar";

/**
 * Why something a VEVENT carried is not (or not wholly) in the plan. Mirrors
 * `@nexus/core`'s `IcsImportSkipCode` exactly — redeclared here like every
 * other closed domain in this file, so `main`'s assignment of a core value to
 * this type turns a code added in core into a compile error rather than a line
 * the screen cannot label.
 */
export type IcsImportSkipCode =
  | "invalid-start"
  | "unknown-timezone"
  | "empty-summary"
  | "invalid-end"
  | "invalid-exdate"
  | "recurrence-unmappable"
  | "detached-override"
  | "categories-dropped";

/** One named, counted group of things that will not (wholly) arrive. */
export interface IcsImportSkip {
  code: IcsImportSkipCode;
  count: number;
}

/** One component the file carried and the import does not read — a VTODO, a VALARM, anything unknown — counted by its own name, because a loss with no name is a loss nobody agreed to. */
export interface IcsImportSkippedComponent {
  name: string;
  count: number;
}

/** The outcome of the native "pick an .ics" dialog — structurally the `.apkg`'s, for the same reason: a plain text file has no `encrypted` flag to carry. */
export type IcsImportPickResult =
  | { canceled: true }
  | { canceled: false; path: string; fileName: string };

/**
 * Picking (`imex:import-csv-pick`) and dropping the pick
 * (`imex:import-csv-cancel`) carry no payload — main holds the pick. The
 * delimiter/header OVERRIDES ride on the preview request: null means "the
 * sniff decides", a value re-parses the text main already read under that
 * choice (the sniff is overridable, never a silent commitment — ADR-062).
 */
export interface ImexImportCsvPreviewRequest {
  profileId: string;
  delimiter: CsvImportDelimiter | null;
  hasHeader: boolean | null;
}

/** `token` names the exact plan being confirmed — main refuses any other value. */
export interface ImexImportCsvApplyRequest {
  profileId: string;
  token: string;
}

/**
 * A dry run of a real `.ics` import: the file really read, really parsed and
 * really planned against this profile — never an estimate.
 *
 * Two reports, answering two different questions, exactly as the `.apkg`
 * preview's do. `modules` is `planForeignImport`'s own per-module arithmetic —
 * what the plan will insert, with the duplicate rule already applied — and only
 * CAL is ever non-zero for an `.ics`. `components` and `skips` are the
 * PARSER's: everything in the file this import does not carry, named and
 * counted, from the VTODOs beside the events to the recurrence rule that
 * outgrew the six shapes.
 */
export interface IcsImportPreview {
  /** Identifies this exact read-and-plan. The apply refuses any other value, so a stale screen can never write a plan the user did not see. */
  token: string;
  fileName: string;
  /** VEVENTs the file carried, refused ones included. */
  sourceEvents: number;
  /** Events the plan will insert. */
  plannedEvents: number;
  /**
   * Events the planner RECOGNISED as ones this profile already holds (ADR-051
   * — an event's identity is its title, start and all-day flag). Reported
   * whichever way the current choice points — skipped by default, imported
   * after a re-preview said so — because the screen must always be able to
   * offer the other answer.
   */
  duplicates: number;
  /** `planForeignImport`'s own arithmetic, per archive module. */
  modules: Record<ArchiveModuleName, ImportModuleCounts>;
  components: IcsImportSkippedComponent[];
  skips: IcsImportSkip[];
}

/**
 * `"no-file"` when nothing has been picked yet; `"unreadable"` when the file
 * could not be read at all; `"ready"` is the only state the apply accepts.
 * There is no `"invalid"` arm, for the `.apkg`'s reason: an `.ics` carries no
 * manifest to be wrong and no checksum to mismatch.
 */
export type IcsImportPreviewResult =
  | { status: "no-file" }
  | { status: "unreadable"; code: IcsImportReadErrorCode }
  | { status: "ready"; preview: IcsImportPreview };

/** What a completed `.ics` import wrote. The same shape every archive operation reports, because it is undone through the same one slot and shown through the same one banner. */
export type IcsImportApplyResult = RestoreApplyResult;

/**
 * Picking a file (`imex:import-ics-pick`) and dropping the picked one
 * (`imex:import-ics-cancel`) carry no payload — main holds the pick — and so
 * declare no request shape. Undo and status have none either: one slot, one
 * banner, `imex:restore-undo`/`imex:restore-status` for every operation.
 *
 * The duplicate answer rides on the preview request rather than on a replan
 * channel of its own, because it is the only answer this flow has to carry —
 * ADR-051's one group an `.ics` can produce. Re-previewing under the other
 * answer re-plans the events main already parsed, on the `.apkg` subject's
 * exact precedent: changing an answer must not cost what opening the file cost.
 */
export interface ImexImportIcsPreviewRequest {
  profileId: string;
  /** `true` plans the recognised duplicates as new rows; `false` — the default the first preview always uses — skips them (ADR-051). */
  importDuplicates: boolean;
}

/** `token` names the exact plan being confirmed — main refuses any other value. */
export interface ImexImportIcsApplyRequest {
  profileId: string;
  token: string;
}

// --- LLM-assisted import (IMEX-005) ------------------------------------------

/**
 * What one prompt — and the answer it produces — is about. Mirrors
 * `@nexus/core`'s `LlmImportKind`, redeclared here like every other closed
 * domain in this file so main's assignment of a core value to this type turns a
 * kind added in core into a compile error rather than a value the screen cannot
 * label.
 */
export type LlmImportKind = "tasks" | "events" | "cards";

/** Every kind, in the order the picker offers them — and what main validates an incoming one against. */
export const LLM_IMPORT_KINDS: readonly LlmImportKind[] = ["tasks", "events", "cards"];

/** Which language the generated prompt is written in. Mirrors `@nexus/core`'s `LlmPromptLanguage`. */
export type LlmPromptLanguage = "sr" | "en";

/** Both languages, in the order the toggle offers them. */
export const LLM_PROMPT_LANGUAGES: readonly LlmPromptLanguage[] = ["sr", "en"];

/**
 * Longest pasted answer main will look at, in characters. Mirrors
 * `@nexus/core`'s `LLM_MAX_ANSWER_LENGTH`, and enforced at the IPC edge as
 * well as inside the parser: the renderer is untrusted (SEC-EL-02), and a
 * refusal that happens before a megabyte is scanned costs nothing.
 */
export const LLM_IMPORT_MAX_ANSWER_LENGTH = 1_048_576;

/**
 * Why one entry of the answer's `records` array is not in the plan. Mirrors
 * `@nexus/core`'s `LlmSkipReason` exactly, for `ApkgImportSkipCode`'s reason.
 */
export type LlmImportSkipReason =
  | "not-an-object"
  | "missing-field"
  | "invalid-field"
  | "text-too-long"
  | "unknown-card-shape"
  | "no-cloze-deletion"
  | "over-record-cap";

/** One skipped entry, named by its position in the answer so the user can find it in their own chat. */
export interface LlmImportSkip {
  index: number;
  reason: LlmImportSkipReason;
  /** The field the reason is about, or null when it is about the whole record. */
  field: string | null;
}

/**
 * Why a pasted answer could not be read at all — a fact about the whole paste
 * rather than about one record. Mirrors `@nexus/core`'s `LlmAnswerProblem`
 * whole, `"too-long"` included: the IPC edge refuses an oversized paste first, so
 * that code should never arrive here — but the copy map over this domain must
 * stay total, and dropping the member would leave the one path that DOES reach
 * it (a future caller inside main) a sentence short.
 */
export type LlmImportAnswerProblem =
  | "empty"
  | "too-long"
  | "no-json"
  | "not-json"
  | "not-an-envelope"
  | "unsupported-version"
  | "unknown-kind";

/**
 * A dry run of a real LLM import: the pasted answer really parsed and really
 * planned against this profile — never an estimate.
 *
 * `records`/`accepted`/`planned` are three different numbers on purpose. The
 * first is what the answer carried, the second how many of those this build
 * could read, and the third how many ROWS they become — which for cards is
 * larger, since one cloze template makes one card per blank.
 */
export interface LlmImportPreview {
  /** Identifies this exact parse-and-plan. The apply refuses any other value, so a stale screen can never write a plan the user did not see. */
  token: string;
  /** The kind the ANSWER declared. Main refuses one that disagrees with the request, so this is always what was asked for. */
  kind: LlmImportKind;
  /** Entries the answer's `records` array carried. */
  records: number;
  /** Entries this build could read. */
  accepted: number;
  /** Rows the plan will insert. */
  planned: number;
  /**
   * Rows the planner RECOGNISED as ones this profile already holds (ADR-051 —
   * an event's identity is its title, start and all-day flag). Only ever
   * non-zero for `"events"`. Reported whichever way the current choice points
   * — skipped by default, imported after an `imex:import-llm-replan` said so —
   * because the screen must always be able to offer the other answer.
   */
  duplicates: number;
  skipped: LlmImportSkip[];
  /** Keys the answer carried that this build has no field for. Dropped, counted, never guessed at. */
  droppedFields: number;
}

/**
 * `"unreadable"` when the paste is not an answer this build can read at all;
 * `"kind-mismatch"` when it IS one but for another kind than the screen asked
 * for — its own status rather than an `"unreadable"` code, because it is the
 * one failure the user fixes by changing a picker rather than by re-asking the
 * assistant.
 */
export type LlmImportPreviewResult =
  | { status: "unreadable"; code: LlmImportAnswerProblem }
  | { status: "kind-mismatch"; answered: LlmImportKind }
  | { status: "ready"; preview: LlmImportPreview };

/** What a completed LLM import wrote. The same shape every other archive operation reports, because it is undone through the same one slot and shown through the same one banner. */
export type LlmImportApplyResult = RestoreApplyResult;

/**
 * Longest name „Novi špil" accepts — the ceiling `@nexus/db`'s own `DeckStore`
 * holds every deck name to, redeclared here (like every other cap on this wire)
 * so main can bound the payload without waiting for the store to refuse.
 */
export const LLM_IMPORT_MAX_DECK_NAME_LENGTH = 200;

/**
 * Where imported cards land (IMEX-005): a deck the profile already has, or one
 * the import creates under an existing subject. `ApkgImportSubjectChoice`'s
 * precedent one level down — a deck cannot exist outside a subject, so the new
 * arm has to say which one. Told apart by which field is present; main
 * validates the shape structurally and `restore.ts` proves the ids are live
 * rows of THIS profile, the same division the `.apkg` subject follows.
 */
export type LlmImportDeckChoice =
  | { existingDeckId: string }
  | { newDeckName: string; subjectId: string };

/**
 * The whole source of an LLM import: the kind being imported, the text the user
 * pasted, and — for `"cards"` only — the deck the cards land in.
 *
 * `deck` is null for the other two kinds, and required for cards: an answer
 * out of a chat names no deck, and a Nexus card lives in one, so it is the one
 * decision only the user can make. Tasks need no such choice — they land in
 * this profile's own default list, exactly as an imported archive's do — and
 * events need none at all.
 */
export interface ImexImportLlmPreviewRequest {
  profileId: string;
  kind: LlmImportKind;
  /** The pasted answer, capped at `LLM_IMPORT_MAX_ANSWER_LENGTH`. */
  text: string;
  deck: LlmImportDeckChoice | null;
}

/**
 * Re-plans the answer THIS preview already parsed, under a different duplicate
 * choice (ADR-051) — `ImexImportReplanRequest`'s twin, narrowed to the one
 * group an LLM answer can produce: events. `token` names the plan being
 * replaced, and main refuses any other value; the reply mints a fresh one,
 * exactly as the archive re-plan does. The pasted text is deliberately absent —
 * a re-plan re-uses the records main already holds, never a second paste.
 */
export interface ImexImportLlmReplanRequest {
  profileId: string;
  token: string;
  /** True imports the recognised duplicates as new, independent rows; false (the default every fresh preview is planned on) skips them. */
  importDuplicates: boolean;
}

/** `token` names the exact plan being confirmed — main refuses any other value. */
export interface ImexImportLlmApplyRequest {
  profileId: string;
  token: string;
}

/**
 * Why one file of a pick did not become a note. Every one of these is REPORTED
 * by name beside the file it happened to — a batch never aborts on a single
 * bad file, and never quietly loses one either.
 *
 * `too-long` is not `too-large`: the file passed the size gate, but the note
 * it parses to exceeds `NOTE_UPDATE_MAX_BYTES`, the per-update wire limit
 * every note write in the app is held to.
 */
export type MarkdownImportSkipCode =
  | "too-large"
  | "too-long"
  | "unreadable"
  | "empty"
  | "too-many"
  | "not-markdown";

export interface MarkdownImportSkip {
  /** The file's own name, as it was on disk — the only way the user can tell which one this was. */
  name: string;
  reason: MarkdownImportSkipCode;
}

/**
 * The outcome of one markdown import: canceled at the dialog, or a count of
 * the notes written plus every file that did not become one.
 *
 * `imagesAsText` is the honesty clause: this slice imports no blobs, so every
 * image in every file arrived as plain text carrying its alt and URL, and the
 * screen says how many rather than letting the user find out later.
 */
export type MarkdownImportResult =
  | { canceled: true }
  | {
      canceled: false;
      created: number;
      skipped: MarkdownImportSkip[];
      imagesAsText: number;
    };

/** `folderId` is an existing note folder of this profile, or null for the unfiled root; main validates it before a single file is read. */
export interface ImexImportMarkdownRequest {
  profileId: string;
  folderId: string | null;
  source: MarkdownImportSource;
}

/**
 * A key combination on the wire (ADR-040 / TASK-002). Mirrors `@nexus/core`'s
 * `Chord` exactly — redeclared here, like every other shared shape in this
 * file, so the renderer never imports core through the IPC contract. `key` is
 * a single character (already lowercased) or a function key by name.
 *
 * Main deliberately takes the CHORD, not a finished accelerator string: it
 * re-derives the accelerator itself with core's `chordAccelerator`, so no
 * string the renderer composed is ever handed to `globalShortcut.register`.
 */
export interface GlobalShortcutChord {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

/** Whether the OS granted the requested global combination. `false` leaves the previous registration (if any) in place. */
export interface GlobalShortcutResult {
  ok: boolean;
}

/**
 * What the drawn title strip has to know about the window it is drawn on.
 *
 * `maximized` decides which of the two shapes the middle control is (restore
 * or maximize) — the one piece of window state a custom frame cannot infer,
 * since the renderer has no window object of its own to ask.
 *
 * `focused` exists because an OS frame dims itself when the window loses focus,
 * and a drawn one that does not looks like it is still the front window when it
 * is not. That is a real misread on a multi-window desktop, not a flourish.
 */
export interface WindowState {
  maximized: boolean;
  focused: boolean;
  /** Drawn separately from `maximized`: a full-screen window has no strip to restore from, so the menu offers „leave" instead. */
  fullScreen: boolean;
  /** Chromium's zoom LEVEL, not a factor — the scale is `1.2 ** level`, and 0 is „stvarna veličina". */
  zoomLevel: number;
}

/**
 * What the „Prikaz" section of the app menu can ask of its own window.
 *
 * A closed list rather than a number, so the renderer never names a zoom level:
 * main owns the step and the clamp, and a renderer that asked for level 40
 * would get the same answer as one that asked for level 4. The alternative —
 * sending a target level and range-checking it — validates the same request
 * twice and still leaves the step size in two places.
 */
export const WINDOW_VIEW_COMMANDS = [
  "zoom-in",
  "zoom-out",
  "zoom-reset",
  "fullscreen-toggle",
] as const;

export type WindowViewCommand = (typeof WINDOW_VIEW_COMMANDS)[number];

/**
 * Runtime and environment facts, proving the main-process path end to end.
 *
 * Every field here is a property of the BUILD and of the device, and none of
 * them is a property of an account — deliberately, because the title bar asks
 * for this at mount to print the version, which is before an account exists on
 * a first run. It used to carry `databasePath` as well, and that one field
 * needed a selected account, so the whole call rejected on the first screen a
 * new user ever sees: the version line silently vanished from the menu and main
 * logged „Internal error: no local account is selected" for a completely
 * ordinary state. Nothing ever read the field. Anything account-scoped belongs
 * on a call that is about an account.
 */
export interface AppInfo {
  name: string;
  version: string;
  userDataPath: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
    v8: string;
  };
}

/**
 * The sync surface as the renderer sees it: an address, a device id, a date and
 * four booleans.
 *
 * No token, no key, no wrap and no server message. Everything the protocol
 * produces that is not one of these fields stays in main — the English `detail`
 * strings in particular, which are developer fault reports and would eventually
 * be shown to somebody if they crossed.
 */
export interface SyncStatusView {
  /**
   * The cloud switch AS STORED — the position the settings checkbox shows, and
   * the value the next launch will come up under.
   *
   * Deliberately the stored value rather than the running one. They differ for
   * the whole of the session in which the switch is changed, and the renderer
   * needs the stored one: a user who ticks the box, walks to another page and
   * comes back must find it still ticked. Whether THIS launch has the boundary
   * lifted is main's business — nothing in the renderer can act on it, because
   * every operation that would is refused in main by name.
   */
  cloudEnabled: boolean;
  /**
   * True while the stored switch differs from the one this launch came up with,
   * in EITHER direction — see `cloudRequiresRestart`, which is the one place
   * that rule is written and which explains why enabling mid-session is not a
   * thing that can work.
   */
  cloudRestartRequired: boolean;
  /** Whether this build knows which project to talk to at all. */
  configured: boolean;
  /** Null until sync has been enabled on this computer. */
  account: {
    email: string;
    deviceId: string | null;
    enabledAt: string;
  } | null;
  /** Whether main is currently holding a live session for that account. */
  signedIn: boolean;
}

/**
 * Why the last sync round did not do what it set out to. Machine codes, never
 * prose — the renderer maps each to its own Serbian sentence, as
 * {@link SyncEnableProblem} does.
 *
 * Declared HERE and derived in main rather than the other way round, for the
 * reason the three view types are: the renderer has to have a sentence for every
 * member, and a second declaration of the list is a member that eventually has
 * no sentence. `main/sync/round.ts` takes all of these except `nonce_reuse` —
 * that one is not a refusal to run a round, it is what a round that RAN came
 * back and said.
 */
export type SyncProblem =
  /** Cloud is off for this launch, or this build carries no project. */
  | "cloud_off"
  /** Sync has never been turned on for this computer. */
  | "not_enabled"
  /** The database is locked, so there is no data key to open anything with. */
  | "locked"
  /** No live session, and the stored token did not buy one. */
  | "signed_out"
  /** The server could not be reached, or answered with nothing to learn from. */
  | "offline"
  /** The session is dead, or this device has been revoked. */
  | "forbidden"
  /** The server served something this build cannot read as its own data. */
  | "malformed"
  /**
   * This machine holds no key that opens what it would have to seal or read.
   * Waiting does not fix it — pairing or the Recovery Kit does.
   */
  | "key_unavailable"
  /** The key slot was taken and then read back empty: a server disagreeing with itself. */
  | "contested"
  /**
   * A content key was used twice with one nonce. Latched — sync does not come
   * back for this profile until the key has been rotated, and the user is told
   * so rather than watching a loop that silently never succeeds.
   */
  | "nonce_reuse";

/**
 * What sync is doing right now.
 *
 * `problem` is one field rather than „why it stopped" and „what the last round
 * said" separately, because a screen given both has to decide which one it
 * means — and the failure of deciding wrong is telling the user their session
 * died when their wifi dropped. `phase` is what says whether the loop will try
 * again.
 */
export interface SyncActivityView {
  /** The profile the loop is bound to, or null when nothing is open. */
  profileId: string | null;
  /** `waiting` between rounds, `running` during one, `halted`/`stopped` when it will not try again on its own. */
  phase: "stopped" | "waiting" | "running" | "halted";
  problem: SyncProblem | null;
  /** Epoch milliseconds of the next scheduled round, or null when none is. */
  nextRunAt: number | null;
  /** Epoch milliseconds of the last round's end, or null before the first. */
  lastRunAt: number | null;
  /**
   * What the last round moved. Null before the first one.
   *
   * FOUR of the engine's six, and the two that are missing are missing on
   * purpose. `pulled` counts rows fetched, including the ones this device
   * already had, so „Preuzeto" is `applied` — the number that describes what
   * actually changed here. `conflicts` counts pushes the server refused because
   * a peer's row was newer, which the next round merges by itself; it is a fact
   * about the protocol working, not about the user's data. Neither has a Serbian
   * sentence, and a number on a contract that no surface names is a number
   * nobody reads (DC-55). They come back the day a screen has a name for them.
   */
  lastRound: {
    /** Rows from other devices written into this one. */
    applied: number;
    pushed: number;
    /** Rows the server served that this device could not open. They are kept, not dropped. */
    quarantined: number;
    /** Local changes still waiting to be sent. */
    owed: number;
  } | null;
  /** Consecutive failed rounds. Zero after any round that did not fail. */
  failures: number;
}

/**
 * Why turning sync on was refused. Machine codes, never prose — the renderer
 * maps each to its own Serbian sentence, exactly as `BackupRunErrorCode` does.
 *
 * The first two unions are the protocol's own and are IMPORTED rather than
 * copied: `AuthRefusal` is what the auth server answers, `SyncEnableRefusal` is
 * what `nexus_mk_mint` answers, and a redeclared copy would drift into naming a
 * state neither can produce or omitting one they can.
 */
export type SyncEnableProblem =
  | AuthRefusal
  | SyncEnableRefusal
  /** The account has several second factors and none was named. */
  | "mfa_ambiguous"
  /** The verify call succeeded and the session did not come back at `aal2`. */
  | "step_up_failed"
  /** The server stored something other than what this desktop sent. Nothing was enabled. */
  | "round_trip_mismatch"
  /** Cloud is switched off for this launch, or this build has no project. */
  | "cloud_off"
  /** The database is locked, so there is no data key to wrap a master key under. */
  | "locked"
  /** Sync is already on here. Enabling twice would mint a second master key. */
  | "already_enabled"
  /** A caller-side fault: a device name this schema cannot store, a bad key length. */
  | "bad_request";

/**
 * Why getting back onto the account failed.
 *
 * `AuthRefusal` and `DeviceRegisterRefusal` are the protocol's own and are
 * IMPORTED, for the reason {@link SyncEnableProblem} imports its two: a
 * redeclared copy drifts into naming a state the server cannot produce, or —
 * worse — omitting one it can.
 */
export type SyncReconnectProblem =
  | AuthRefusal
  | DeviceRegisterRefusal
  /** The stored wrap did not open. This machine no longer holds the master key. */
  | "master_key_unreadable"
  /** The sign-in produced a session for a different account than the stored one. */
  | "account_mismatch"
  /** Cloud is switched off for this launch, or this build has no project. */
  | "cloud_off"
  /** The database is locked, so the wrapped master key cannot be opened. */
  | "locked"
  /** Sync was never turned on here, so there is no account to get back onto. */
  | "not_enabled_here"
  /** A caller-side fault: a device name this schema cannot store. */
  | "bad_request";

/** Everything `reconnectSync` can answer. */
export type SyncReconnectView =
  | { outcome: "reconnected"; status: SyncStatusView }
  | { outcome: "refused"; reason: SyncReconnectProblem };

/**
 * Why joining an account that already has a master key failed.
 *
 * Distinct from {@link SyncEnableProblem} even though the two flows share their
 * first four steps, because they diverge on the one question the user acts on:
 * enabling can be told `already_minted`, and adopting is the answer TO that. A
 * shared union would mean every screen handling one had to handle states the
 * other produces.
 *
 */
export type SyncAdoptProblem =
  | AuthRefusal
  | DeviceRegisterRefusal
  /** The account has several second factors and none was named. */
  | "mfa_ambiguous"
  /** The verify call succeeded and the session did not come back at `aal2`. */
  | "step_up_failed"
  /** The bootstrap device row was refused, so nothing on the account is readable. */
  | "bootstrap_failed"
  /** This account has no recovery wrap: sync was never enabled on it. Enable it here. */
  | "not_minted"
  /** The Sync Recovery Code did not open the wrap. Nothing else is wrong. */
  | "recovery_code_rejected"
  /** Cloud is switched off for this launch, or this build has no project. */
  | "cloud_off"
  /** The database is locked, so there is no data key to wrap the master key under. */
  | "locked"
  /** This computer already belongs to an account. Adopting would replace it. */
  | "already_enabled"
  /** A caller-side fault: a device name this schema cannot store. */
  | "bad_request";

/** Everything `adoptSync` can answer. There is no code to show: the user has it. */
export type SyncAdoptView =
  | { outcome: "adopted"; status: SyncStatusView }
  | { outcome: "refused"; reason: SyncAdoptProblem };

/** Everything `enableSync` can answer. */
export type SyncEnableView =
  | {
      outcome: "enabled";
      /**
       * The Sync Recovery Code, shown ONCE and never stored. It crosses this
       * bridge because the user has to be able to write it down; nothing else
       * key-shaped ever does.
       */
      recoveryCode: string;
      status: SyncStatusView;
    }
  /** The account already has a master key this computer did not mint: pair, or recover. */
  | { outcome: "already-minted" }
  | { outcome: "refused"; reason: SyncEnableProblem };

/**
 * The exact object exposed on `window.nexus`: one method per channel, nothing
 * generic. Frozen at exposure time (see preload).
 */
export interface NexusApi {
  /** ADR-018: the local account's status. The first thing the renderer asks about, before profiles or flags — there is no code path where a data channel is called before this. */
  getAuthStatus(): Promise<AuthStatus>;
  /** First run: creates the local account (encrypting an existing plaintext database in place if one predates this) and returns the one-time Recovery Kit code on success — the only time it is ever handed back. */
  createAccount(label: string, passcode: string): Promise<AuthResult>;
  /** Adds another local account and switches to it, locking whatever was open first (ADR-044). Returns the new account's one-time Recovery Kit code, exactly as `createAccount` does. */
  createAdditionalAccount(label: string, passcode: string): Promise<AuthResult>;
  /** Points every other auth channel at a different account, locking the current one first when it was open. Answers with the freshly computed status so the picker never has to ask twice. */
  selectAccount(accountId: string): Promise<AuthStatus>;
  /** Renames an account's lock-screen label; allowed while locked. Answers with the freshly computed status. */
  renameAccount(accountId: string, label: string): Promise<AuthStatus>;
  /** Deletes an account and every byte it owns, immediately and with no undo (ADR-048). Answers with the freshly computed status — an empty `accounts` means that was the last one. */
  deleteAccount(accountId: string): Promise<AuthStatus>;
  /** Opens the database with the passcode-derived key, or a throttled/wrong-passcode refusal. */
  unlockWithPasscode(passcode: string): Promise<AuthResult>;
  /** Recovers from a forgotten passcode: verifies the Recovery Kit code and sets a new passcode in the same call. */
  unlockWithRecovery(recoveryCode: string, newPasscode: string): Promise<AuthResult>;
  /** Rewraps the data key under a new passcode; never re-encrypts the database, never touches the Recovery Kit already written down. */
  changePasscode(currentPasscode: string, nextPasscode: string): Promise<AuthResult>;
  /** Issues a fresh Recovery Kit code, invalidating the old one. Unlocked session only. */
  regenerateRecoveryCode(): Promise<AuthResult>;
  /** Closes the database and drops the data key from memory. */
  lock(): Promise<void>;
  listProfiles(): Promise<Profile[]>;
  /** Creates a profile and seeds what it starts with (ADR-058); an empty `name` is the deliberate ONB-lite "not yet named" sentinel. */
  createProfile(kind: ProfileKind, name: string): Promise<Profile>;
  /**
   * Adds the „Demo" profile to THIS account and fills it (ADR-058 §profiles;
   * the seeders in `main/demo/`). Offered at first run and refused once the
   * account already has one, so it can never be used to write the database
   * full. Answers with the created profile.
   */
  createDemoProfile(): Promise<Profile>;
  /** Deletes a profile and everything it owns, immediately and with no undo (ADR-058). Refused for the personal anchor and for the last remaining profile. */
  deleteProfile(id: string): Promise<void>;
  /** Proves the account passcode at the profile-switch gate (ADR-058), on the unlock's own throttle counter and `AuthResult` vocabulary — the session stays untouched either way. */
  verifyProfileSwitch(passcode: string): Promise<AuthResult>;
  /** Reports which profile the shell is standing in (ADR-058, NTF active-profile rule) — at unlock landing and on every verified switch — so main serves notifications for the active profile only. */
  setActiveProfile(profileId: string): Promise<void>;
  /** Reports the language the interface is being served in, so main's native dialogs and OS notifications follow the same choice. */
  setLocale(locale: AppLocale): Promise<void>;
  renameProfile(id: string, name: string): Promise<void>;
  /**
   * Opens the native picker and, if the user chooses a file, stores the square
   * PNG main makes of it (SET-001). No path and no bytes cross this call in
   * either direction — see `main/profilePicture.ts` for why that is the whole
   * point, and why there is deliberately no interactive crop.
   */
  pickProfilePicture(profileId: string): Promise<ProfilePicturePickResult>;
  /** Drops the profile's picture and releases its blob when nothing else references it. */
  clearProfilePicture(profileId: string): Promise<Profile>;
  getFlags(profileId: string): Promise<FlagState>;
  setFlag(profileId: string, moduleId: string, enabled: boolean): Promise<void>;
  listTasks(profileId: string): Promise<Task[]>;
  createTask(profileId: string, task: NewTaskFields): Promise<Task>;
  updateTask(profileId: string, id: string, changes: TaskFieldChanges): Promise<Task>;
  setTaskDone(profileId: string, id: string, done: boolean): Promise<Task>;
  deleteTask(profileId: string, id: string): Promise<void>;
  restoreTask(profileId: string, id: string): Promise<void>;
  /**
   * "This occurrence is done" (ADR-024): a one-off completes, while a recurring
   * task advances in place to its next due date and comes back as `todo` again.
   * This is the checkbox/kanban path for EVERY task — the caller never needs to
   * know whether the task recurs, and `setTaskDone(…, true)` refuses a
   * recurring one precisely so the two paths cannot drift apart.
   */
  completeTaskOccurrence(profileId: string, id: string): Promise<Task>;
  /** Everything the task rail draws — lists and their sections — in one fetch (ADR-029). */
  listTaskLists(profileId: string): Promise<TaskListsSnapshot>;
  /** Creates a list, appended at the end of its parent scope; `parentId` null makes it a root list. */
  createTaskList(profileId: string, name: string, parentId: string | null): Promise<TaskList>;
  /** Renames a list. The Inbox renames like any other — only its deletion and its placement are fixed. */
  renameTaskList(profileId: string, id: string, name: string): Promise<void>;
  /** Remembers which shape this list opens in (TASK-005): the per-list view memory the view toggle writes. */
  setTaskListView(profileId: string, id: string, view: TaskListView): Promise<void>;
  /** Remembers what this list's views are set to (ADR-050) — the whole config, `null` to clear it. */
  setTaskListViewConfig(
    profileId: string,
    id: string,
    config: TaskViewConfig | null,
  ): Promise<void>;
  /** Re-parents and re-orders in one call; refuses a cycle, and refuses to move the Inbox at all. */
  moveTaskList(
    profileId: string,
    id: string,
    parentId: string | null,
    beforeId: string | null,
    afterId: string | null,
  ): Promise<void>;
  /**
   * Deletes a list, taking its tasks one of the two ways the user can mean
   * (`"move-to-inbox"` / `"delete-tasks"`); child lists always promote to the
   * deleted list's own parent. Reversible through `restoreTaskList` — which
   * brings back exactly the tasks THIS delete removed, so the undo of a
   * "move-to-inbox" restores the list without dragging the moved tasks back.
   */
  deleteTaskList(profileId: string, id: string, mode: DeleteListMode): Promise<void>;
  restoreTaskList(profileId: string, id: string): Promise<void>;
  createTaskSection(profileId: string, listId: string, name: string): Promise<TaskSection>;
  renameTaskSection(profileId: string, id: string, name: string): Promise<void>;
  moveTaskSection(
    profileId: string,
    id: string,
    beforeId: string | null,
    afterId: string | null,
  ): Promise<void>;
  /** Deletes a section and promotes its tasks to the list body, appended at its end. */
  deleteTaskSection(profileId: string, id: string): Promise<void>;
  /** Moves a task (and its live subtree) into another list — the rail's drop target. */
  moveTaskToList(profileId: string, id: string, listId: string): Promise<Task>;
  /** Moves one task into a section of its own list, or back to the body with `null`. */
  moveTaskToSection(profileId: string, id: string, sectionId: string | null): Promise<Task>;
  /** Re-orders a task within its own scope — the list view's drag between two rows. */
  reorderTask(
    profileId: string,
    id: string,
    beforeId: string | null,
    afterId: string | null,
  ): Promise<Task>;
  /**
   * The five batch actions over a hand-picked selection (ADR-038). Each is one
   * store transaction and refuses the WHOLE batch on any per-row failure, so a
   * rejected promise means nothing changed.
   *
   * All five reply with nothing on purpose: a batch moves and re-positions rows
   * it was never asked about (a move re-appends a subtree; a delete renumbers
   * nothing but hides children), so the page re-reads rather than patching what
   * a reply could only partly describe.
   */
  bulkMoveTasksToList(
    profileId: string,
    ids: string[],
    listId: string,
    sectionId: string | null,
  ): Promise<void>;
  bulkSetTaskPriority(profileId: string, ids: string[], priority: TaskPriority): Promise<void>;
  /** `null` clears the rok; the batch is refused where a rule or a reminder ladder anchors on it. */
  bulkSetTaskDueDate(profileId: string, ids: string[], dueDate: string | null): Promise<void>;
  bulkDeleteTasks(profileId: string, ids: string[]): Promise<void>;
  bulkRestoreTasks(profileId: string, ids: string[]): Promise<void>;
  /** This profile's task tags, alphabetical by name (the rail re-sorts with `Intl.Collator(["sr-Latn","sr"])`). */
  listTaskTags(profileId: string): Promise<TaskTag[]>;
  /** Get-or-create by trimmed name: tagging with a name the profile already has returns that tag rather than a second one. */
  createTaskTag(profileId: string, name: string): Promise<TaskTag>;
  renameTaskTag(profileId: string, id: string, name: string): Promise<void>;
  /** Deletes a tag; the schema's CASCADE takes its attachments with it, so the tag disappears from every task at once. */
  deleteTaskTag(profileId: string, id: string): Promise<void>;
  /** Every task-tag attachment of the profile in one fetch — the page indexes them by task rather than asking per row. Attachments of soft-deleted tasks are hidden, not dropped. */
  listTaskTagLinks(profileId: string): Promise<TaskTagLink[]>;
  attachTaskTag(profileId: string, taskId: string, tagId: string): Promise<void>;
  detachTaskTag(profileId: string, taskId: string, tagId: string): Promise<void>;
  /** One task's attachments, oldest first. Only an ACTIVE task of this profile has any to list. */
  listTaskAttachments(profileId: string, taskId: string): Promise<TaskAttachment[]>;
  /** Opens the native file picker and attaches whatever the user chooses — main reads the files, the renderer never touches a path or a byte. Resolves once the dialog is settled and every chosen file has been handled. */
  attachTaskFiles(profileId: string, taskId: string): Promise<TaskAttachmentsAddResult>;
  removeTaskAttachment(profileId: string, taskId: string, attachmentId: string): Promise<void>;
  /** Copies the attachment's blob to a main-owned temp file and opens it with the OS default handler. */
  openTaskAttachment(profileId: string, taskId: string, attachmentId: string): Promise<void>;
  /** Copies the attachment's blob to a path chosen via a native save dialog. Resolves after the dialog is settled — canceled or written. */
  saveTaskAttachmentAs(
    profileId: string,
    taskId: string,
    attachmentId: string,
  ): Promise<SaveAttachmentResult>;
  /** Every live task's attachment count in one fetch — the page indexes them by task rather than asking per row (the `cardCounts` idiom). */
  taskAttachmentCounts(profileId: string): Promise<TaskAttachmentCount[]>;
  /** This profile's task templates, alphabetical by name (the popover re-sorts with `Intl.Collator(["sr-Latn","sr"])`). */
  listTaskTemplates(profileId: string): Promise<TaskTemplate[]>;
  /** Captures `taskId` — its own fields, its direct live subtasks and its tags — as a template called `name`. An existing name is REPLACED. */
  saveTaskTemplateFromTask(profileId: string, taskId: string, name: string): Promise<TaskTemplate>;
  /** Creates a task from a template in the given list/section, returning the created parent. */
  applyTaskTemplate(
    profileId: string,
    templateId: string,
    listId: string,
    sectionId: string | null,
  ): Promise<Task>;
  /** Deletes a template; no task created from it is touched. */
  deleteTaskTemplate(profileId: string, id: string): Promise<void>;
  /** Every dependency of the profile whose both ends are live tasks, in one fetch — the page derives "blocked" from these plus the tasks it already has. */
  listTaskDependencies(profileId: string): Promise<TaskDependencyLink[]>;
  /** Records "`blockedId` waits on `blockerId`". Idempotent; rejects a self-edge and any edge that would close a cycle. */
  addTaskDependency(profileId: string, blockerId: string, blockedId: string): Promise<void>;
  removeTaskDependency(profileId: string, blockerId: string, blockedId: string): Promise<void>;
  listEvents(profileId: string): Promise<Event[]>;
  createEvent(profileId: string, event: NewEventFields): Promise<Event>;
  updateEvent(profileId: string, id: string, changes: EventFieldChanges): Promise<Event>;
  deleteEvent(profileId: string, id: string): Promise<void>;
  restoreEvent(profileId: string, id: string): Promise<void>;
  /** Removes one occurrence date from a series (ADR-024) — the "delete just this one" / "detach it into its own event" primitive. Adding a date the series already excepts changes nothing. */
  addEventRecurrenceExdate(profileId: string, id: string, date: string): Promise<Event>;
  /**
   * The "this and future occurrences" truncation (ADR-024): the master's series
   * ends the day before `occurrenceDate`, and the truncated master comes back.
   * Carrying the edited fields forward is a separate, ordinary `createEvent` —
   * so a split, a "delete from here on", and a "change the rule from here on"
   * are all this one call plus whatever the caller does next.
   */
  splitEventRecurrence(profileId: string, id: string, occurrenceDate: string): Promise<Event>;
  /** This profile's event templates, alphabetical by name (the popover re-sorts with `Intl.Collator(["sr-Latn","sr"])`). */
  listEventTemplates(profileId: string): Promise<EventTemplate[]>;
  /** Captures `eventId`'s SHAPE — its time of day, length, reminders, rule and text — as a template called `name`. An existing name is REPLACED. */
  captureEventTemplate(profileId: string, eventId: string, name: string): Promise<EventTemplate>;
  /** Creates an event from a template on `dayKey` (a bare `YYYY-MM-DD`), returning the created row. */
  applyEventTemplate(profileId: string, templateId: string, dayKey: string): Promise<Event>;
  /** Deletes a template; no event created from it is touched. */
  deleteEventTemplate(profileId: string, id: string): Promise<void>;
  /** The other profile's events for the visible range, minimized and pre-marked (CAL-005 / ADR-058 §5) — the system's ONE cross-profile read. Never writes; the rows never join search, drag or selection. */
  calendarOverlay(profileId: string, from: string, to: string): Promise<CalendarOverlayEvent[]>;
  /** This profile's semester dates (CAL-010 / ADR-054), both null while no term is set. Never writes. */
  calendarSettings(profileId: string): Promise<CalendarSettings>;
  /** Writes the whole pair at once — both dates, or both null to clear — and answers with what is now stored. */
  setCalendarSettings(profileId: string, settings: CalendarSettings): Promise<CalendarSettings>;
  /** This profile's people, name-ordered by SQLite's binary collation (CAL-007); the renderer re-sorts with `Intl.Collator(["sr-Latn","sr"])`. */
  listPeople(profileId: string): Promise<Person[]>;
  createPerson(profileId: string, person: NewPersonFields): Promise<Person>;
  updatePerson(profileId: string, id: string, changes: PersonFieldChanges): Promise<Person>;
  deletePerson(profileId: string, id: string): Promise<void>;
  restorePerson(profileId: string, id: string): Promise<void>;
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
  /** One active subject's materials, oldest first (STUDY-001 / migration 035). */
  listSubjectAttachments(profileId: string, subjectId: string): Promise<SubjectAttachment[]>;
  /** Opens the native picker in MAIN and attaches whatever comes back — no bytes and no path cross the bridge. */
  attachSubjectFiles(profileId: string, subjectId: string): Promise<SubjectAttachmentsAddResult>;
  removeSubjectAttachment(
    profileId: string,
    subjectId: string,
    attachmentId: string,
  ): Promise<void>;
  /** Hands the decrypted file to the OS through a temp copy — `openTaskAttachment`'s route, one module over. */
  openSubjectAttachment(profileId: string, subjectId: string, attachmentId: string): Promise<void>;
  saveSubjectAttachmentAs(
    profileId: string,
    subjectId: string,
    attachmentId: string,
  ): Promise<SaveAttachmentResult>;
  /** The live notes filed under one live subject (STUDY-001 / migration 035). */
  listSubjectLinkedNotes(profileId: string, subjectId: string): Promise<LinkedNote[]>;
  linkSubjectNote(profileId: string, subjectId: string, noteId: string): Promise<void>;
  unlinkSubjectNote(profileId: string, subjectId: string, noteId: string): Promise<void>;
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
  /** Creates one cloze card per deletion NUMBER in `text`, atomically; returns the siblings in number order (ADR-042 / ADR-068). */
  createClozeCards(profileId: string, deckId: string, text: string): Promise<Card[]>;
  /** Creates one problem card — a basic card whose `back` the main process derives from `stepsText` (ADR-046). */
  createProblemCard(
    profileId: string,
    deckId: string,
    front: string,
    stepsText: string,
  ): Promise<Card>;
  updateCard(profileId: string, id: string, changes: CardFieldChanges): Promise<Card>;
  deleteCard(profileId: string, id: string): Promise<void>;
  restoreCard(profileId: string, id: string): Promise<void>;
  cardCounts(profileId: string): Promise<DeckCounts[]>;
  /**
   * The session's cards, plus whether the profile's daily review cap truncated
   * the due section (STUDY-007). `newLimit` is deliberately never sent by the
   * reviewer: omitted, the store resolves it from the profile's own
   * „Novih kartica dnevno".
   */
  reviewQueue(profileId: string, scope?: ReviewQueueScope): Promise<ReviewQueue>;
  gradeReview(profileId: string, id: string, rating: CardRating): Promise<Card>;
  undoReview(profileId: string, id: string): Promise<Card>;
  previewReview(profileId: string, id: string): Promise<PreviewIntervals>;
  /** This profile's target retention and daily caps, defaults already applied (STUDY-007). Never writes. */
  studySettings(profileId: string): Promise<StudySettings>;
  /** Writes all three preferences and answers with the fresh row. Existing cards are never retro-rescheduled. */
  setStudySettings(profileId: string, settings: StudySettings): Promise<StudySettings>;
  listPlans(profileId: string): Promise<StudyPlan[]>;
  createPlan(profileId: string, plan: NewPlanFields): Promise<StudyPlan>;
  updatePlan(profileId: string, id: string, changes: PlanFieldChanges): Promise<StudyPlan>;
  deletePlan(profileId: string, id: string): Promise<void>;
  restorePlan(profileId: string, id: string): Promise<void>;
  /** Syncs every active plan whose exam is still active; answers one honesty report per synced plan (ADR-063). */
  syncAllPlans(profileId: string): Promise<PlanHealth[]>;
  /** One plan's scope-cut proposal (STUDY-004) — a pure read; nothing is cut until `acceptScopeCut`. */
  scopeCutProposal(profileId: string, planId: string): Promise<ScopeCutProposal>;
  /** Marks `topicIds` cut and re-syncs the plan — the ONLY path that ever sets `cut`. */
  acceptScopeCut(
    profileId: string,
    planId: string,
    topicIds: readonly string[],
  ): Promise<PlanHealth>;
  listBlocksByPlan(profileId: string, planId: string): Promise<StudyBlock[]>;
  listBlocksInRange(
    profileId: string,
    fromDate: string,
    toDate: string,
  ): Promise<StudyBlockWithExam[]>;
  setBlockStatus(profileId: string, id: string, status: StudyBlockStatus): Promise<StudyBlock>;
  setBlockPinned(profileId: string, id: string, pinned: boolean): Promise<StudyBlock>;
  /** One exam's topics with effective confidences resolved, in rank order (ADR-063). */
  listExamTopics(profileId: string, examId: string): Promise<ExamTopic[]>;
  /** Appends a topic at the exam's bottom rank; answers with the exam's fresh effective list. */
  createExamTopic(profileId: string, examId: string, name: string): Promise<ExamTopic[]>;
  renameExamTopic(profileId: string, id: string, name: string): Promise<ExamTopic[]>;
  setExamTopicConfidence(
    profileId: string,
    id: string,
    confidence: number | null,
  ): Promise<ExamTopic[]>;
  setExamTopicDeck(profileId: string, id: string, deckId: string | null): Promise<ExamTopic[]>;
  /** Moves a topic one rank step; an edge move is a no-op. Answers with the fresh effective list. */
  moveExamTopic(
    profileId: string,
    id: string,
    direction: TopicMoveDirection,
  ): Promise<ExamTopic[]>;
  /** Soft-deletes a topic (its blocks become undifferentiated); answers with the exam's fresh effective list. */
  deleteExamTopic(profileId: string, id: string): Promise<ExamTopic[]>;
  /** „Vrati u plan": clears one topic's `cut` — the ONLY path that ever does. Answers with the exam's fresh effective list. */
  restoreExamTopicToPlan(profileId: string, id: string): Promise<ExamTopic[]>;
  /**
   * Starts the ONE focus phase this profile may have running. `phase` omitted
   * entirely is an open-ended, subjectless `work` phase — the shape STUDY's
   * timer has always had.
   */
  startFocus(
    profileId: string,
    phase?: Omit<FocusStartRequest, "profileId">,
  ): Promise<RunningFocusSession>;
  stopFocus(profileId: string): Promise<FocusSession | null>;
  /** Freezes the running phase's clock; answers the frozen phase. A no-op if it is already paused. */
  pauseFocus(profileId: string): Promise<RunningFocusSession>;
  /** Restarts the clock, folding the pause just ended into `pausedSeconds`. A no-op if it is running. */
  resumeFocus(profileId: string): Promise<RunningFocusSession>;
  focusStatus(profileId: string): Promise<RunningFocusSession | null>;
  cancelFocus(profileId: string): Promise<void>;
  listFocusRange(profileId: string, fromDate: string, toDate: string): Promise<FocusSession[]>;
  deleteFocus(profileId: string, id: string): Promise<void>;
  restoreFocus(profileId: string, id: string): Promise<void>;
  studyStats(profileId: string, fromDate: string, toDate: string): Promise<StudyStats>;
  subjectStudyLog(
    profileId: string,
    subjectId: string,
    fromDay: string,
    toDay: string,
  ): Promise<SubjectStudyLog>;
  listCenterNotifications(profileId: string): Promise<NotificationRecord[]>;
  /** Omitting `preset` snoozes by the profile's own default (NTF-009) — main reads it, the renderer never needs to know it. */
  snoozeNotification(
    profileId: string,
    id: string,
    preset?: SnoozePreset,
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
  /**
   * Subscribes to the single `notifications:appetite-ask` push event (NTF-008 /
   * ADR-033) — payload-free, exactly like `onNotificationsChanged`, since the
   * only thing it carries is "now is the moment to ask". Main may push it again
   * on a later check while the question is still unanswered, so the listener
   * guards against opening the dialog twice. Returns an unsubscribe function.
   */
  onNotificationAppetiteAsk(listener: () => void): () => void;
  /** Answers the one-time appetite question; `sources` null keeps the current settings. Marks the question asked either way. */
  answerNotificationAppetite(
    profileId: string,
    sources: NotificationSource[] | null,
  ): Promise<void>;
  listNotes(profileId: string, filter?: { folderId?: string | null }): Promise<NoteMeta[]>;
  createNote(profileId: string): Promise<NoteMeta>;
  loadNote(profileId: string, noteId: string): Promise<NoteDocPayload>;
  appendNoteUpdate(
    profileId: string,
    noteId: string,
    update: Uint8Array,
    title: string,
  ): Promise<void>;
  /**
   * Soft-deletes a note, together with the disposition of the flashcards it
   * generated (PRD 09 section 7). `cards` defaults to `"keep"`, which is what
   * a note with no generated cards sends — for it, both dispositions are a
   * no-op and the delete is exactly what it always was.
   */
  deleteNote(profileId: string, noteId: string, cards?: NoteCardDisposition): Promise<void>;
  /**
   * Copies a note into a new, independent one (NOTE-010): same content, fresh
   * card keys, its own attachment rows, the same tags and folder — unpinned,
   * unmapped from any deck, and with no version history of its own yet.
   */
  duplicateNote(profileId: string, noteId: string): Promise<NoteDuplicateResult>;
  /** Undo of `deleteNote`: restores the note, and the cards deleted in that same act (never any other). */
  restoreNote(profileId: string, noteId: string): Promise<void>;
  /** How many live flashcards this note currently generates — what the delete dialog counts (PRD 09 section 7). */
  countNoteCards(profileId: string, noteId: string): Promise<number>;
  /**
   * How many tasks „Pretvori u zadatke" would make out of this note's checklist
   * — rows with no text are not counted, because they would be skipped. Probed
   * before the action is offered, exactly as `countNoteCards` is probed before
   * the delete dialog: an action that can only report doing nothing is not
   * offered at all.
   */
  countNoteChecklistItems(profileId: string, noteId: string): Promise<number>;
  /**
   * Copies this note's checklist out into real tasks in `listId` (NOTE section 6).
   * The note is NOT changed — the checklist stays where it is.
   */
  convertNoteChecklistToTasks(
    profileId: string,
    noteId: string,
    listId: string,
  ): Promise<NoteChecklistTasksResult>;
  listNoteFolders(profileId: string): Promise<NoteFolder[]>;
  createNoteFolder(
    profileId: string,
    input: { parentId: string | null; name: string; color: NoteFolderColor | null },
  ): Promise<NoteFolder>;
  updateNoteFolder(
    profileId: string,
    id: string,
    fields: NoteFolderFieldChanges,
  ): Promise<void>;
  moveNoteFolder(profileId: string, id: string, newParentId: string | null): Promise<void>;
  deleteNoteFolder(profileId: string, id: string): Promise<void>;
  /** ADR-036: the template new notes in this folder open with; `null` clears it. Rejects an id that is neither a built-in nor one of this profile's templates. */
  setNoteFolderTemplate(profileId: string, id: string, templateId: string | null): Promise<void>;
  /** ADR-036: moves this profile's quick-capture mark onto `id`, or clears it with `null`. */
  setNoteFolderCaptureDefault(profileId: string, id: string | null): Promise<void>;
  /** NOTE-002: the shape the note list opens in while this folder is selected. The root's own choice is a device preference (`notePrefs.ts`), not this. */
  setNoteFolderView(profileId: string, id: string, view: NoteFolderView): Promise<void>;
  listNoteTags(profileId: string): Promise<NoteTag[]>;
  createNoteTag(profileId: string, name: string): Promise<NoteTag>;
  renameNoteTag(profileId: string, id: string, name: string): Promise<void>;
  deleteNoteTag(profileId: string, id: string): Promise<void>;
  listNoteTagLinks(profileId: string): Promise<NoteTagLink[]>;
  attachNoteTag(profileId: string, noteId: string, tagId: string): Promise<void>;
  detachNoteTag(profileId: string, noteId: string, tagId: string): Promise<void>;
  /** NOTE-002: this profile's categories, name-ordered; the renderer re-sorts with `Intl.Collator(["sr-Latn","sr"])`. */
  listNoteCategories(profileId: string): Promise<NoteCategory[]>;
  /** Rejects a name this profile already uses — unlike a tag, a category is never get-or-created. */
  createNoteCategory(
    profileId: string,
    input: { name: string; color: NoteFolderColor | null },
  ): Promise<NoteCategory>;
  /** A partial patch: an omitted key is untouched, an explicit `color: null` clears the swatch. */
  updateNoteCategory(
    profileId: string,
    id: string,
    fields: NoteCategoryFieldChanges,
  ): Promise<void>;
  /** Deletes a category; its notes are NOT deleted — they simply become uncategorized. */
  deleteNoteCategory(profileId: string, id: string): Promise<void>;
  /** NOTE-002: what KIND this note is; `null` clears it. Exactly one, so setting a second replaces the first. */
  setNoteCategory(profileId: string, noteId: string, categoryId: string | null): Promise<void>;
  setNoteFolder(profileId: string, noteId: string, folderId: string | null): Promise<void>;
  setNotePinned(profileId: string, noteId: string, pinned: boolean): Promise<void>;
  setNoteLinks(profileId: string, noteId: string, targetIds: string[]): Promise<void>;
  listNoteBacklinks(profileId: string, noteId: string): Promise<NoteMeta[]>;
  /** Browse-list metadata for this note's checkpoints, newest first (ADR-015 / NOTE-008). */
  listNoteVersions(profileId: string, noteId: string): Promise<NoteVersionMeta[]>;
  /** One checkpoint's full snapshot bytes, for a read-only version preview. */
  loadNoteVersion(profileId: string, noteId: string, coveredSeq: number): Promise<Uint8Array>;
  /** The pre-restore safety checkpoint — no age gate, deduped by covered_seq. */
  captureNoteVersion(profileId: string, noteId: string): Promise<void>;
  /** This profile's user-defined templates, name-ordered (ADR-016 / NOTE-009); the renderer re-sorts with `Intl.Collator(["sr-Latn","sr"])`. */
  listNoteTemplates(profileId: string): Promise<NoteTemplate[]>;
  /** Upserts on name (ADR-016): saving under an existing template's name replaces its content, keeping the same id. */
  saveNoteTemplate(profileId: string, name: string, content: string): Promise<NoteTemplate>;
  /** Renaming to the template's own current name is a no-op; onto another template's name rejects. */
  renameNoteTemplate(profileId: string, id: string, name: string): Promise<void>;
  deleteNoteTemplate(profileId: string, id: string): Promise<void>;
  /** Syncs this note's generated flashcards: a full reconcile of its card-syntax blocks against `deckId`, keyed by each spec's `key` (NOTE-006). */
  syncNoteCards(profileId: string, noteId: string, deckId: string, cards: NoteCardSpec[]): Promise<void>;
  /** Points (or unpoints, with `null`) this note's generated cards at a deck (NOTE-006). */
  setNoteCardDeck(profileId: string, noteId: string, deckId: string | null): Promise<void>;
  listNoteAttachments(profileId: string, noteId: string): Promise<NoteAttachment[]>;
  /** Attaches a file to a note; main sniffs `bytes` for the real MIME type (SEC-FILE-02) — `fileName` is display-only. */
  attachNoteFile(
    profileId: string,
    noteId: string,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<NoteAttachment>;
  removeNoteAttachment(profileId: string, noteId: string, attachmentId: string): Promise<void>;
  /** Copies the attachment's blob to a main-owned temp file and opens it with the OS default handler. */
  openNoteAttachment(profileId: string, noteId: string, attachmentId: string): Promise<void>;
  /** Copies the attachment's blob to a path chosen via a native save dialog. Resolves after the dialog is settled — canceled or written. */
  saveNoteAttachmentAs(
    profileId: string,
    noteId: string,
    attachmentId: string,
  ): Promise<SaveAttachmentResult>;
  /**
   * Opens the dedicated, hardened preview window over a PDF attachment
   * (DOC tier 1, ADR-064) — `application/pdf` only, refused by the STORED
   * mime for anything else. Main re-resolves the row through the module's own
   * store; the renderer names ids, never a hash. Resolves once the window is
   * opened, not when it loads.
   */
  previewAttachment(
    profileId: string,
    module: DocAttachmentModule,
    id: string,
    attachmentId: string,
  ): Promise<void>;
  /** A text/markdown attachment's decoded content for the in-app preview dialog (DOC tier 0, ADR-064): ≤ `DOC_TEXT_PREVIEW_MAX_BYTES`, UTF-8, BOM stripped in main. */
  readAttachmentText(
    profileId: string,
    module: DocAttachmentModule,
    id: string,
    attachmentId: string,
  ): Promise<DocTextContent>;
  /**
   * Every file the profile's three public attachment surfaces carry, newest
   * first, narrowed by `filter` (DOC / „Datoteke"). Capped at
   * `DOC_ATTACHMENT_LIST_LIMIT` with `truncated` saying so. Never writes, and
   * the private section is not merely filtered out but structurally absent —
   * a sealed note's files live in its envelope, not in a table this reads.
   */
  listAttachments(profileId: string, filter: DocAttachmentFilter): Promise<DocAttachmentList>;
  /** This profile's dashboard background and dim, defaults already applied (SET-006 / ADR-041). Never writes. */
  dashboardSettings(profileId: string): Promise<DashboardSettings>;
  /**
   * Opens the native image picker in MAIN, which reads, sniffs and encrypts the
   * chosen file into the blob store before the settings row is written — the
   * renderer sends no path and no bytes. Resolves once the dialog is settled:
   * canceled, refused with a named reason, or applied.
   */
  pickDashboardBackground(profileId: string): Promise<DashboardPickResult>;
  /** Drops the background, keeping the dim; the blob is garbage-collected in main if nothing else references it. */
  clearDashboardBackground(profileId: string): Promise<DashboardSettings>;
  /** Sets how far the scrim dims the image, 0..`MAX_BACKGROUND_DIM`. */
  setDashboardDim(profileId: string, dim: number): Promise<DashboardSettings>;
  /**
   * One board's dashboard layout in draw order (DASH-002 / ADR-045; per-board
   * since ADR-055 — `setId` null is „Početna“) — the DEFAULT arrangement while
   * that board has never been arranged, which is a resolved answer and not an
   * empty one. Never writes.
   */
  dashboardWidgets(
    profileId: string,
    setId: string | null,
  ): Promise<DashboardWidgetInstance[]>;
  /**
   * Places `widgetId` at the end of the board's layout and answers with the
   * whole resulting layout. The first mutation of a board still on the default
   * writes that default out as real rows first, so adding a sixth widget never
   * costs the five that were there.
   */
  addDashboardWidget(
    profileId: string,
    widgetId: string,
    size: DashboardWidgetSize,
    setId: string | null,
  ): Promise<DashboardWidgetInstance[]>;
  /**
   * Removes one placement, answering with the resulting layout. Removing the
   * LAST one puts the default arrangement back: no rows IS the default, so
   * "remove everything" is also how a user resets — per board.
   */
  removeDashboardWidget(
    profileId: string,
    instanceId: string,
    setId: string | null,
  ): Promise<DashboardWidgetInstance[]>;
  /** Changes one placement's size preset, leaving its place in the order alone. */
  setDashboardWidgetSize(
    profileId: string,
    instanceId: string,
    size: DashboardWidgetSize,
    setId: string | null,
  ): Promise<DashboardWidgetInstance[]>;
  /**
   * Writes one placement's per-widget configuration (DASH-004 / ADR-059) —
   * only the fields differing from the widget's defaults, `{}` to clear.
   * Revalidated in main against the widget's own contract declaration.
   */
  setDashboardWidgetConfig(
    profileId: string,
    instanceId: string,
    config: Record<string, number | string | string[]>,
    setId: string | null,
  ): Promise<DashboardWidgetInstance[]>;
  /** Re-orders one placement between two others, either null at an end of the layout. Neighbours resolve within the same board only. */
  moveDashboardWidget(
    profileId: string,
    instanceId: string,
    beforeId: string | null,
    afterId: string | null,
    setId: string | null,
  ): Promise<DashboardWidgetInstance[]>;
  /** The named boards in board order plus which one is showing (DASH-008 / ADR-055). Never writes. */
  dashboardSets(profileId: string): Promise<DashboardSetsState>;
  /** Creates a named board (its layout starts as the default arrangement) and answers the resulting state plus the new board's id. */
  createDashboardSet(profileId: string, name: string): Promise<DashboardSetsCreated>;
  /** Renames one named board. „Početna“ has no id to pass here — it is not a row. */
  renameDashboardSet(
    profileId: string,
    setId: string,
    name: string,
  ): Promise<DashboardSetsState>;
  /** Deletes one named board and its widget rows; the active board falls back to „Početna“ when it was this one. */
  deleteDashboardSet(profileId: string, setId: string): Promise<DashboardSetsState>;
  /** Writes which board this profile is looking at — null returns to „Početna“. */
  setActiveDashboardSet(
    profileId: string,
    setId: string | null,
  ): Promise<DashboardSetsState>;
  /** This profile's live accounts, sr-Latn alphabetical — archived ones included and flagged, since a closed account still has a balance worth showing. */
  listFinAccounts(profileId: string): Promise<FinAccount[]>;
  /**
   * Each live account's DERIVED balance, in that account's own currency —
   * opening balance plus everything that moved, computed on every read. Never a
   * stored figure: there is no `balance` column, precisely so one cannot drift.
   */
  finAccountBalances(profileId: string): Promise<FinAccountBalance[]>;
  /**
   * Net worth PER CURRENCY across the live, non-archived accounts — one entry
   * per currency. There is deliberately no sibling answering a single number:
   * with no exchange rate available, a cross-currency total could only be
   * invented, so this API makes inventing one impossible rather than merely
   * discouraged.
   */
  finCurrencyTotals(profileId: string): Promise<FinCurrencyTotal[]>;
  /** Creates an account. `openingBalance` is minor units, an integer — never a decimal string. */
  createFinAccount(profileId: string, account: NewFinAccountFields): Promise<FinAccount>;
  updateFinAccount(
    profileId: string,
    id: string,
    changes: FinAccountFieldChanges,
  ): Promise<FinAccount>;
  /** Soft-deletes an account; its transactions stay on disk and come back with it. */
  deleteFinAccount(profileId: string, id: string): Promise<void>;
  restoreFinAccount(profileId: string, id: string): Promise<void>;
  /** This profile's categories, both kinds together, sr-Latn alphabetical — the picker filters to the kind it needs. */
  listFinCategories(profileId: string): Promise<FinCategory[]>;
  /** Creates a category; refuses a name this profile already holds UNDER THE SAME KIND, by name. */
  createFinCategory(profileId: string, name: string, kind: FinCategoryKind): Promise<FinCategory>;
  renameFinCategory(profileId: string, id: string, name: string): Promise<FinCategory>;
  /** Deletes a category. Its transactions are NOT deleted — they simply become uncategorized. */
  deleteFinCategory(profileId: string, id: string): Promise<void>;
  /** This profile's standing allowances, ordered by currency then by the category's own name. */
  listFinBudgets(profileId: string): Promise<FinBudget[]>;
  /**
   * Sets one category's allowance in one currency. `amount` is minor units, a
   * positive integer. Refused by name on an INCOME category: a budget is a
   * limit, and a target compares the opposite way.
   */
  setFinBudget(profileId: string, budget: NewFinBudgetFields): Promise<FinBudget>;
  /** Clears ONE currency's allowance; the category's allowances in other currencies stand. */
  clearFinBudget(profileId: string, categoryId: string, currency: string): Promise<void>;
  /** This profile's live transactions, newest day first — the ledger's own order, which the views engine then leaves untouched. */
  listFinTransactions(profileId: string): Promise<FinTransaction[]>;
  /** Creates a transaction — or a transfer, when `counterAccountId` is given. `amount` is minor units, an integer, signed from `accountId`'s point of view. */
  createFinTransaction(
    profileId: string,
    transaction: NewFinTransactionFields,
  ): Promise<FinTransaction>;
  updateFinTransaction(
    profileId: string,
    id: string,
    changes: FinTransactionFieldChanges,
  ): Promise<FinTransaction>;
  /** Soft-deletes a transaction; the balance derivation stops counting it immediately. */
  deleteFinTransaction(profileId: string, id: string): Promise<void>;
  restoreFinTransaction(profileId: string, id: string): Promise<void>;
  /**
   * What each EXPENSE category cost over an inclusive span of local days, PER
   * CURRENCY, plus one line for the uncategorized spending. Transfers are
   * absent by construction — the store reads a view they are not in — so money
   * moved between the user's own accounts can never surface here as spending.
   */
  finSpendByCategory(profileId: string, period: FinPeriod): Promise<FinCategorySpend[]>;
  /**
   * What arrived over the same span, PER CURRENCY — a list, never a number, for
   * `finCurrencyTotals`' reason. Income categories only: an unlabelled arrival
   * belongs to `finSpendByCategory`'s uncategorized line, so the two reads
   * partition the period rather than overlapping on it.
   */
  finIncomeByCurrency(profileId: string, period: FinPeriod): Promise<FinCurrencyTotal[]>;
  /** This profile's live subscriptions, sr-Latn alphabetical by name (FIN slice d). */
  listFinRecurring(profileId: string): Promise<FinRecurring[]>;
  /**
   * What the SCHEDULES say is coming inside `window`, soonest first — expanded
   * from each rule on every call. Never a read of transaction rows: a renewal
   * that has not happened yet has none, which is precisely why nothing is posted
   * into the future.
   */
  finUpcomingRenewals(
    profileId: string,
    window: FinRenewalWindow,
  ): Promise<FinUpcomingRenewal[]>;
  /** Creates a subscription; its cursor opens on `startDate` and main charges it from there on the next check. */
  createFinRecurring(
    profileId: string,
    subscription: NewFinRecurringFields,
  ): Promise<FinRecurring>;
  updateFinRecurring(
    profileId: string,
    id: string,
    changes: FinRecurringFieldChanges,
  ): Promise<FinRecurring>;
  /** Soft-deletes a subscription; generation skips it immediately and the charges it already made stay. */
  deleteFinRecurring(profileId: string, id: string): Promise<void>;
  restoreFinRecurring(profileId: string, id: string): Promise<void>;
  /** Stops charging a subscription while KEEPING it (ADR-074) — it stays listed and editable, and stops placing renewals. */
  pauseFinRecurring(profileId: string, id: string): Promise<void>;
  /** Starts it charging again from the first occurrence on or after today; the months it was paused for are never back-charged. */
  resumeFinRecurring(profileId: string, id: string): Promise<void>;
  /**
   * This profile's live habits, sr-Latn alphabetical — ARCHIVED ones included
   * and flagged by their own `archivedAt`. The caller decides what to show:
   * „Danas" wants only the current ones, while the history grid and the stats
   * want the archived ones too, and a read that had already dropped them would
   * make the second view impossible without a second call.
   */
  listHabits(profileId: string): Promise<Habit[]>;
  /** Creates a habit; the schedule is validated against HABIT's own two-kind vocabulary before it reaches the store. */
  createHabit(profileId: string, habit: NewHabitFields): Promise<Habit>;
  /** Applies a partial patch. An ARCHIVED habit is editable — archiving says „ne pitaj me više za ovo", never „ne diraj me". */
  updateHabit(profileId: string, id: string, changes: HabitFieldChanges): Promise<Habit>;
  /** Soft-deletes a habit. Its entries stay exactly where they are, so the undo brings back the whole history. */
  deleteHabit(profileId: string, id: string): Promise<void>;
  restoreHabit(profileId: string, id: string): Promise<void>;
  /** Marks a habit as finished with: out of „Danas", still in the list, still answering the stats. */
  archiveHabit(profileId: string, id: string): Promise<void>;
  unarchiveHabit(profileId: string, id: string): Promise<void>;
  /** Records one DAY's value for a habit. The day is named by the caller and validated by main — never after today, never before the habit (`HabitsSetEntryRequest`). */
  setHabitEntry(profileId: string, habitId: string, day: string, value: number): Promise<HabitEntry>;
  /** Removes one day's tick, on the same terms. */
  clearHabitEntry(profileId: string, habitId: string, day: string): Promise<void>;
  /** EVERY live habit's ticks over one inclusive day span, in one call — the today list, the grid and the streaks all read this one window. */
  habitEntries(profileId: string, range: HabitDayRange): Promise<HabitEntry[]>;
  /**
   * The foods whose names match `query` — the app's catalogue and this profile's
   * own foods, merged and ranked ONCE (prefix matches first, then sr-Latn, with
   * „djuvec" reaching „Đuveč" through the app's one folding table).
   *
   * A blank query answers an empty list rather than everything: a picker with an
   * empty box has nothing to rank, and the front of the catalogue dressed up as
   * „your best matches" is a different claim.
   */
  fitFoodSearch(profileId: string, query: string, limit: number): Promise<FitFoodOption[]>;
  /** One day of the diary: the five slots, and the total the same rows add up to. */
  fitDay(profileId: string, day: string): Promise<FitDay>;
  /**
   * Logs one item. The caller names the food by REFERENCE and says how much;
   * main resolves it and records the snapshot — a renderer able to supply macros
   * for a food it named could log a 0-kcal čokolada.
   */
  fitAddItem(
    profileId: string,
    day: string,
    slot: FitMealSlot,
    foodRef: string,
    grams: number,
  ): Promise<FitMealItem>;
  /** Corrects the weight and/or the slot. The snapshot is never touched. */
  fitUpdateItem(
    profileId: string,
    id: string,
    changes: { grams?: number; slot?: FitMealSlot },
  ): Promise<FitMealItem>;
  fitRemoveItem(profileId: string, id: string): Promise<void>;
  fitRestoreItem(profileId: string, id: string): Promise<void>;
  /** This profile's own foods, sr-Latn alphabetical. The catalogue is not in here — it is not a table. */
  fitFoods(profileId: string): Promise<FitFood[]>;
  fitCreateFood(profileId: string, food: NewFitFoodFields): Promise<FitFood>;
  /** Editing a food changes what you log FROM NOW ON; everything already logged keeps the numbers it was logged with. */
  fitUpdateFood(profileId: string, id: string, changes: FitFoodFieldChanges): Promise<FitFood>;
  fitDeleteFood(profileId: string, id: string): Promise<void>;
  fitRestoreFood(profileId: string, id: string): Promise<void>;
  /** One total per day across an inclusive span, oldest first. A day with nothing logged is ABSENT, never a zero. */
  fitDayTotals(profileId: string, from: string, to: string): Promise<FitDayTotals[]>;
  /** The four daily goals — four nulls while nothing has been set, which is the ordinary case. */
  fitTargets(profileId: string): Promise<FitTargets>;
  /** Writes all four at once; `null` clears one, and `0` is a goal of zero rather than none. */
  fitSaveTargets(profileId: string, goals: FitTargetGoals): Promise<FitTargets>;
  /**
   * One ranked list of exercises over BOTH sources — the catalogue that ships
   * in the app and this profile's own. A blank query answers an empty list
   * rather than everything: a picker with an empty box has nothing to rank.
   * Both names are matched, because the lifting world writes "RDL".
   */
  fitSearchExercises(profileId: string, query: string, limit: number): Promise<FitExerciseOption[]>;
  /** This profile's own exercises, sr-Latn alphabetical. The catalogue is not in here — it is not a table. */
  fitExercises(profileId: string): Promise<FitExercise[]>;
  fitCreateExercise(profileId: string, exercise: NewFitExerciseFields): Promise<FitExercise>;
  /** Editing an exercise changes what you LOG from now on; every set already logged keeps the metric and muscles it was logged with. */
  fitUpdateExercise(
    profileId: string,
    id: string,
    changes: FitExerciseFieldChanges,
  ): Promise<FitExercise>;
  fitDeleteExercise(profileId: string, id: string): Promise<void>;
  fitRestoreExercise(profileId: string, id: string): Promise<void>;
  /** This profile's routines, each with its items in order. A routine is a shape, never a schedule. */
  fitRoutines(profileId: string): Promise<FitRoutine[]>;
  /**
   * Creates a routine, or rewrites one whole. Items are sent every time and
   * their ORDER is their position; main resolves each reference and writes the
   * label, so a routine cannot name one exercise and point at another.
   */
  fitSaveRoutine(
    profileId: string,
    routine: { id?: string; name: string; notes?: string; items: FitRoutineItemInput[] },
  ): Promise<FitRoutine>;
  fitDeleteRoutine(profileId: string, id: string): Promise<void>;
  fitRestoreRoutine(profileId: string, id: string): Promise<void>;
  /** The one unfinished session, or null. What the "Trening" page opens on. */
  fitOpenWorkout(profileId: string): Promise<FitWorkout | null>;
  /** Opens a session. Refuses when one is already open — the schema allows exactly one. */
  fitStartWorkout(
    profileId: string,
    day: string,
    routineRef?: string | null,
    notes?: string,
  ): Promise<FitWorkout>;
  fitFinishWorkout(profileId: string, id: string): Promise<FitWorkout>;
  /** Reopens a finished session for a correction. Refuses while another is open. */
  fitReopenWorkout(profileId: string, id: string): Promise<FitWorkout>;
  fitUpdateWorkout(
    profileId: string,
    id: string,
    changes: { day?: string; notes?: string },
  ): Promise<FitWorkout>;
  fitDeleteWorkout(profileId: string, id: string): Promise<void>;
  /** Undo of that delete. Refuses when it would resurrect a SECOND open session. */
  fitRestoreWorkout(profileId: string, id: string): Promise<void>;
  /** Every session in a day range, ascending. A day is a range of one. */
  fitWorkouts(profileId: string, from: string, to: string): Promise<FitWorkout[]>;
  /**
   * Logs one set. The caller names the exercise by REFERENCE and gives the
   * numbers; main resolves it and stamps the label, the metric and the muscles
   * — a renderer able to declare a set's metric could log a plank as
   * `weight_reps` and every volume total would absorb it.
   */
  fitLogSet(
    profileId: string,
    workoutId: string,
    set: {
      exerciseRef: string;
      kind: SetKind;
      weightKg?: number | null;
      reps?: number | null;
      seconds?: number | null;
      distanceM?: number | null;
      rir?: number | null;
    },
  ): Promise<FitWorkoutSet>;
  /** Corrects the numbers or the kind. The snapshot is never touched. */
  fitUpdateSet(
    profileId: string,
    id: string,
    changes: {
      kind?: SetKind;
      weightKg?: number | null;
      reps?: number | null;
      seconds?: number | null;
      distanceM?: number | null;
      rir?: number | null;
    },
  ): Promise<FitWorkoutSet>;
  /** A hard delete; the remaining positions close the gap. */
  fitRemoveSet(profileId: string, id: string): Promise<void>;
  /** "What did I do last time?" for a whole list at once — one call, never one per exercise. */
  fitLastPerformed(profileId: string, exerciseRefs: string[]): Promise<FitLastPerformed[]>;
  /** Every reading in a day range, ascending. The trend is computed from the range, never from two raw weigh-ins. */
  fitMeasurements(profileId: string, from: string, to: string): Promise<FitMeasurement[]>;
  /** Upserts one day's reading. */
  fitSaveMeasurement(
    profileId: string,
    measurement: FitMeasurementSaveRequest["measurement"],
  ): Promise<FitMeasurement>;
  fitRemoveMeasurement(profileId: string, day: string): Promise<void>;
  /** The body profile, or null while it has never been set — never a default-shaped guess. */
  fitBodyProfile(profileId: string): Promise<FitBodyProfile | null>;
  fitSaveBodyProfile(profileId: string, profile: FitBodyProfile): Promise<FitBodyProfile>;
  /** Starts the rest countdown, replacing whatever was running — a new set logged mid-rest restarts the rest, which is what actually happened. */
  fitStartRest(profileId: string, seconds: number): Promise<FitRestTimer>;
  /** Cancels it. Idempotent: stopping a timer that already elapsed is not an error, it is the ordinary way one ends. */
  fitStopRest(profileId: string): Promise<void>;
  /** The running countdown, or null. What the page asks for on mount — a rest survives leaving the page. */
  fitRestStatus(profileId: string): Promise<FitRestTimer | null>;
  /** This profile's boards, sr-Latn alphabetical and WITHOUT their drawings — the cheap read the board strip is built from. */
  listCanvasBoards(profileId: string): Promise<CanvasBoard[]>;
  /** One board AND its whole drawing. The one call on this surface that carries a scene back. */
  openCanvasBoard(profileId: string, id: string): Promise<CanvasBoardWithScene>;
  /** Creates a board; an absent `scene` is an empty one. */
  createCanvasBoard(profileId: string, name: string, scene?: string): Promise<CanvasBoardWithScene>;
  /** Renames a board. Cannot touch the drawing. */
  renameCanvasBoard(profileId: string, id: string, name: string): Promise<CanvasBoard>;
  /**
   * Replaces a board's drawing — the autosave. Cannot touch the name, and
   * answers with METADATA rather than echoing the document back.
   */
  saveCanvasScene(profileId: string, id: string, scene: string): Promise<CanvasBoard>;
  /** Soft-deletes a board. The drawing stays, so the undo brings the whole thing back. */
  deleteCanvasBoard(profileId: string, id: string): Promise<void>;
  restoreCanvasBoard(profileId: string, id: string): Promise<void>;
  /**
   * What the objects on a board's cards currently are — titles and context
   * lines, one answer per reference and in the order asked. `refs` are the
   * `nexus://…` strings the elements carry; anything that is not one is refused
   * by main, never resolved to an empty card.
   */
  resolveCanvasRefs(profileId: string, refs: string[]): Promise<CanvasRefCard[]>;
  /** This profile's circuits, sr-Latn alphabetical and WITHOUT their contents — the cheap read the picker is built from. */
  listCircuits(profileId: string): Promise<ElecCircuit[]>;
  /** One circuit AND everything on it — the document the canvas draws and `circuitProblems` reads. */
  openCircuit(profileId: string, id: string): Promise<ElecCircuitDocument>;
  /** Creates a circuit; absent notes are empty ones. Answers the header, since a new circuit has nothing on it. */
  createCircuit(profileId: string, name: string, notes?: string): Promise<ElecCircuit>;
  /** Renames a circuit. Cannot touch the notes. */
  renameCircuit(profileId: string, id: string, name: string): Promise<ElecCircuit>;
  /** Replaces a circuit's notes. Cannot rename it. */
  setCircuitNotes(profileId: string, id: string, notes: string): Promise<ElecCircuit>;
  /** Soft-deletes a circuit. Everything on it stays, so the undo brings the whole canvas back. */
  deleteCircuit(profileId: string, id: string): Promise<void>;
  restoreCircuit(profileId: string, id: string): Promise<void>;
  /** Places a component on a circuit. */
  addCircuitPart(
    profileId: string,
    circuitId: string,
    part: ElecAddPartRequest["part"],
  ): Promise<CircuitPart>;
  /** Edits a placed part — the call that fires on every drag. `value: null` clears the value. */
  updateCircuitPart(
    profileId: string,
    id: string,
    fields: ElecUpdatePartRequest["fields"],
  ): Promise<CircuitPart>;
  /**
   * Removes a placed part, and answers with the IDS OF THE WIRES that went with
   * it — every wire touching it, from either end.
   *
   * The answer is load-bearing rather than informative. The caller is a canvas
   * holding the document in memory; „the part is gone" alone leaves it drawing
   * wires to nothing, and re-opening the circuit to find out would cost every
   * other part and wire on it on every delete.
   */
  removeCircuitPart(profileId: string, id: string): Promise<string[]>;
  /** Runs a wire between two pins of one circuit. Both ends must be live parts of it. */
  addCircuitWire(
    profileId: string,
    circuitId: string,
    wire: ElecAddWireRequest["wire"],
  ): Promise<CircuitWire>;
  /**
   * Recolours a wire, and answers with it as it now stands.
   *
   * A jumper's colour is how the trade says what a wire carries, so it is the
   * one thing about a run that gets corrected after the run is made. Correcting
   * it by deleting and re-running would mint a new `id` — a different object to
   * sync, and the same one to the user.
   */
  setCircuitWireColour(profileId: string, id: string, colour: string): Promise<CircuitWire>;
  /** Removes a wire. Both its parts stay exactly where they are. */
  removeCircuitWire(profileId: string, id: string): Promise<void>;
  /**
   * Dimensions the machine this circuit is the electronics of, or removes it
   * (ADR-085 E4c). `null` is „this is not a robot after all".
   *
   * Answers with the chassis as stored, or `null` — nothing else, because
   * nothing else changed: the parts, the wires and the circuit's own name are
   * exactly where they were, and echoing the whole document back would be the
   * expensive read the caller already has in memory.
   */
  setCircuitChassis(
    profileId: string,
    id: string,
    chassis: ElecSetChassisRequest["chassis"],
  ): Promise<Chassis | null>;
  /**
   * Writes this circuit's generated code (ADR-085 E4) where the user picks in
   * a native dialog. Resolves once that dialog is settled.
   *
   * Takes no text and no path, and says nothing about WHICH artefact it wants.
   * Main regenerates from its own store, so what lands on disk is the circuit
   * as stored — and the renderer, which can already produce the identical
   * string for its preview, is not the thing that decides what a file on the
   * user's machine contains, nor whether the user is shown a file picker or a
   * directory one.
   */
  exportCircuitCode(profileId: string, id: string): Promise<CodeExportResult>;
  /**
   * ADR-085 E6 — the external runner.
   *
   * Every one of the three run methods takes a circuit id and NOTHING ELSE, and
   * that is the security property rather than an incidental shape: the command
   * line is built in main from a closed table and the profile the user enabled
   * in their own settings, so nothing the renderer sends can reach it. A future
   * edit that added a `command` or a `profile` parameter here would be the
   * change DEV-007 exists to prevent.
   *
   * `detect` SPAWNS a probe per profile, so it is a method the user's own click
   * calls rather than something a panel does on mount.
   */
  runnerDetect(profileId: string): Promise<RunnerDetection[]>;
  /** The literal command a start would run, or why there is none. Shown to the user BEFORE anything runs. */
  runnerPlan(profileId: string, id: string): Promise<RunnerPlanResult>;
  /** Starts the run the plan described. Refuses when the runner is off, when the plan is refused, and when a run is already going. */
  runnerStart(profileId: string, id: string): Promise<RunnerStartResult>;
  /** Asks the run to stop and answers with the STATE achieved — see `RunnerStopState`. A run belonging to another profile is left alone and answered as `idle`. */
  runnerStop(profileId: string): Promise<RunnerStopState>;
  /** What the runner is doing now, for a panel that mounted mid-run. */
  runnerState(profileId: string): Promise<RunnerState>;
  /** The switch and the remembered choice. */
  runnerSettings(profileId: string): Promise<RunnerSettings>;
  /** Turns the runner on or off. Turning it ON records when the user consented; turning it off leaves the record. */
  runnerEnable(profileId: string, enabled: boolean): Promise<RunnerSettings>;
  /**
   * Remembers which profile to run. `null` clears the choice.
   *
   * The distribution is STORED AS GIVEN and not re-probed here: it came out of
   * a probe the renderer had just run, and a name that has since been removed
   * fails at the run with `wsl.exe`'s own words, which is a better sentence than
   * anything this layer could write. What is checked here is the SHAPE — a
   * bounded, non-empty string, and a distribution only on the WSL choice — and
   * the CHECK constraint behind the store refuses the rest.
   *
   * Turning the runner off clears the choice with it, because a remembered
   * choice on a runner that is off is a choice the user cannot see.
   */
  runnerChoice(
    profileId: string,
    choice: RunnerProfileId | null,
    distro: string | null,
  ): Promise<RunnerSettings>;
  /** Output arrives as it is produced. Returns the unsubscribe, `onNotificationsChanged`'s shape. */
  onRunnerOutput(handler: (event: RunnerOutputEvent) => void): () => void;
  /** The runner's state changes: a run started, a stop was asked for, a run ended. `onNotificationsChanged`'s shape. */
  onRunnerChanged(handler: (state: RunnerState) => void): () => void;
  /** Runs the query pipeline (parse -> FTS match -> bm25 candidates -> rank), falling back to `searchRecent`'s order when the query has no matchable terms (ADR-021). */
  searchQuery(profileId: string, query: string, limit: number): Promise<SearchResult[]>;
  /** The profile's most recently touched entries, already in their final order — no ranking pass, unlike `searchQuery`. */
  searchRecent(profileId: string, limit: number): Promise<SearchResult[]>;
  /** The ADR-039 search page: the same pipeline over a wider candidate bound, plus the kind/tag facet counts the page's chip rows draw. An empty query is browse mode, not an error. */
  searchPage(profileId: string, query: string): Promise<SearchPageResult>;
  /** Rebuilds the ENTIRE file's search index from scratch (corruption recovery, not a per-profile operation); returns the resulting row count. */
  rebuildSearchIndex(profileId: string): Promise<number>;
  /** This profile's remembered QUERIES, newest first (SRCH-009) — the list beside `searchRecent`'s entities, never a replacement for it. */
  searchHistory(profileId: string): Promise<SearchHistoryEntry[]>;
  /**
   * Remembers `query` as used just now, deduped and capped by the store, and
   * answers with the resulting list — so the surface that recorded it needs no
   * second round trip to show what changed. Called only when a query was
   * COMMITTED to (a result opened from it, or it carried to the full page),
   * never per keystroke.
   */
  recordSearchHistory(profileId: string, query: string): Promise<SearchHistoryEntry[]>;
  /** Forgets one remembered query, answering with what is left. Removing something already gone is done, not an error. */
  removeSearchHistory(profileId: string, query: string): Promise<SearchHistoryEntry[]>;
  /** Forgets every remembered query, returning how many went — what Settings' „Obriši istoriju pretrage" reports. */
  clearSearchHistory(profileId: string): Promise<number>;
  /**
   * Full-data export (IMEX slice a1, extended by ADR-022). `passphrase` seals
   * the archive under a passphrase-derived key (an `.nexus` `NXA1`
   * container); `null` means the explicitly-confirmed plaintext `.nexus.zip`
   * export. `modules` narrows the archive to those modules (IMEX-003) and
   * omitting it exports all of them. Resolves after the native save dialog is
   * settled — canceled or written.
   */
  exportData(
    profileId: string,
    passphrase: string | null,
    modules?: readonly ArchiveModuleName[],
  ): Promise<ExportResult>;
  /** The calendar alone, as an RFC 5545 `.ics` (CAL-008) — one open text file, no passphrase branch. Resolves after the native save dialog is settled. */
  exportCalendarIcs(profileId: string): Promise<IcsExportResult>;
  /** Opens the native "pick a restore archive" dialog (IMEX slice 3c, ADR-023). Main remembers the pick, which is why nothing below ever names a path. */
  pickRestoreArchive(): Promise<RestorePickResult>;
  /** Dry-runs the restore by really parsing the picked archive — never an estimate. `passphrase` is `null` for a plain `.nexus.zip`; a wrong one comes back as `{ status: "unreadable", code: "passphrase-wrong" }` rather than as a rejection. */
  previewRestore(profileId: string, passphrase: string | null): Promise<RestorePreviewResult>;
  /** Confirms the preview `token` names, replacing this profile's entire contents. The renderer is reloaded shortly AFTER this resolves, so nothing may depend on the reload having already happened. */
  applyRestore(profileId: string, token: string): Promise<RestoreApplyResult>;
  /** Puts the profile back exactly as it was before the last applied restore (ADR-023 section 3). Rejects when there is nothing to undo. */
  undoRestore(profileId: string): Promise<RestoreUndoResult>;
  /** Whether a restore OR an import is still undoable — the first thing a reloaded renderer asks, since the reload replaced the screen that would have shown the banner. One slot: `kind` says which operation it is offering to undo. */
  restoreStatus(profileId: string): Promise<RestoreStatus>;
  /** Drops the picked archive without applying it, releasing the OS file lock an opened one holds. */
  cancelRestore(): Promise<void>;
  /**
   * Opens the native "pick an archive to import" dialog (ADR-043). A separate
   * channel from `pickRestoreArchive` on purpose: main holds the two picks
   * apart, so a preview of one can never be applied as the other.
   */
  pickImportArchive(): Promise<ImportPickResult>;
  /**
   * Dry-runs the import by really parsing the picked archive in salvage mode and
   * really planning it against this profile — never an estimate. `passphrase` is
   * `null` for a plain `.nexus.zip`; a wrong one comes back as
   * `{ status: "unreadable", code: "passphrase-wrong" }` rather than as a rejection.
   */
  previewImport(profileId: string, passphrase: string | null): Promise<ImportPreviewResult>;
  /**
   * Re-plans the archive `token`'s preview already has open, under `choices`
   * (ADR-051), and answers a fresh preview carrying a fresh token. Never
   * re-opens the file, never re-runs the KDF and never asks for the passphrase
   * again — changing a duplicate choice costs a re-plan, not a re-read.
   */
  replanImport(
    profileId: string,
    token: string,
    choices: ImportDuplicateChoices,
  ): Promise<ImportPreviewResult>;
  /**
   * Confirms the plan `token` names, MERGING it into this profile: every row is
   * added under a new id and nothing already there is touched. Undoable through
   * `undoRestore`, which the two operations share. The renderer is reloaded
   * shortly AFTER this resolves, so nothing may depend on the reload having
   * already happened.
   */
  applyImport(profileId: string, token: string): Promise<ImportApplyResult>;
  /** Drops the picked import archive without applying it, releasing the OS file lock an opened one holds. */
  cancelImport(): Promise<void>;
  /**
   * Opens the native "pick an .apkg" dialog (ADR-052). Its own pick, held apart
   * from both archive picks for the reason they are held apart from each other:
   * nothing on one surface may ever reach another's file.
   */
  pickApkgFile(): Promise<ApkgImportPickResult>;
  /**
   * Dry-runs the `.apkg` import by really reading the file, really translating
   * it and really planning it against this profile under `subject` — never an
   * estimate. Calling it again with a different `subject` re-plans the file main
   * already has open, at the cost of a re-plan rather than a re-read.
   */
  previewApkgImport(
    profileId: string,
    subject: ApkgImportSubjectChoice,
  ): Promise<ApkgImportPreviewResult>;
  /**
   * Confirms the plan `token` names, ADDING its decks and cards to this profile.
   * Undoable through `undoRestore`, which all three archive operations share.
   * The renderer is reloaded shortly AFTER this resolves.
   */
  applyApkgImport(profileId: string, token: string): Promise<ApkgImportApplyResult>;
  /** Drops the picked `.apkg` without applying it, releasing the OS file lock an opened one holds. */
  cancelApkgImport(): Promise<void>;
  /**
   * Opens the native "pick a CSV" dialog (ADR-062). Its own pick, held apart
   * from every other import's for the reason theirs are held apart: nothing on
   * one surface may ever reach another's file.
   */
  pickCsvFile(): Promise<CsvImportPickResult>;
  /**
   * Reads and parses the picked CSV into columns with headers, samples and a
   * SUGGESTED mapping — the step before the user confirms which column is
   * which. `null` overrides mean "the sniff decides"; a value re-parses the
   * text main already read under that choice, never the file again.
   */
  previewCsvImport(
    profileId: string,
    delimiter: CsvImportDelimiter | null,
    hasHeader: boolean | null,
  ): Promise<CsvImportPreviewResult>;
  /**
   * Applies the confirmed mapping in MAIN against the session's parsed rows —
   * the renderer sends role assignments and the target-list choice, never data
   * — and answers the real plan: counts, and every named drop with its row
   * number. Calling it again with different choices re-plans the same rows.
   */
  mapCsvImport(
    profileId: string,
    roles: readonly CsvImportColumnRole[],
    list: CsvImportListChoice,
  ): Promise<CsvImportMapResult>;
  /**
   * Confirms the plan `token` names, ADDING its tasks to this profile through
   * the planner's same apply path. Undoable through `undoRestore`, which every
   * import shares. The renderer is reloaded shortly AFTER this resolves.
   */
  applyCsvImport(profileId: string, token: string): Promise<CsvImportApplyResult>;
  /** Drops the picked CSV without applying it — what it releases is the file's text and parsed cells in main's memory. */
  cancelCsvImport(): Promise<void>;
  /**
   * Opens the native "pick a bank statement" dialog (FIN slice e). Its own pick,
   * held apart from the task CSV's for the reason every import's is held apart:
   * nothing on one surface may ever reach another's file.
   */
  pickFinCsvFile(): Promise<CsvImportPickResult>;
  /**
   * Reads and parses the picked statement into columns with headers, samples and
   * a SUGGESTED mapping. `null` overrides mean "the sniff decides"; a value
   * re-parses the text main already read, never the file again.
   */
  previewFinCsvImport(
    profileId: string,
    delimiter: CsvImportDelimiter | null,
    hasHeader: boolean | null,
  ): Promise<FinCsvImportPreviewResult>;
  /**
   * Applies the confirmed mapping in MAIN against the session's parsed rows and
   * answers the real plan: what lands, what is dropped by name, and what
   * migration 052's fingerprint recognised as already imported. The renderer
   * sends role assignments, the account and the sign convention — never data.
   * Answers `"refused"` when the file cannot be read CONFIDENTLY.
   */
  mapFinCsvImport(
    profileId: string,
    roles: readonly FinCsvImportColumnRole[],
    accountId: string,
    signConvention: FinCsvImportSignConvention,
  ): Promise<FinCsvImportMapResult>;
  /**
   * Confirms the plan `token` names, ADDING its transactions to this profile
   * through the planner's same apply path. Undoable through `undoRestore`, which
   * every import shares. The renderer is reloaded shortly AFTER this resolves.
   */
  applyFinCsvImport(profileId: string, token: string): Promise<FinCsvImportApplyResult>;
  /** Drops the picked statement without applying it — releasing somebody's whole bank ledger from main's memory. */
  cancelFinCsvImport(): Promise<void>;
  /**
   * Opens the native "pick an .ics" dialog (ADR-061). Its own pick, held apart
   * from the three picks beside it for the reason they are held apart from each
   * other: nothing on one surface may ever reach another's file.
   */
  pickIcsFile(): Promise<IcsImportPickResult>;
  /**
   * Dry-runs the `.ics` import by really reading the file, really parsing it
   * and really planning it against this profile — never an estimate. Calling it
   * again with the other `importDuplicates` answer re-plans the events main
   * already parsed, at the cost of a re-plan rather than a re-read; the raw
   * text was dropped the moment the first preview parsed it.
   */
  previewIcsImport(profileId: string, importDuplicates: boolean): Promise<IcsImportPreviewResult>;
  /**
   * Confirms the plan `token` names, ADDING its events to this profile.
   * Undoable through `undoRestore`, which every import shares. The renderer is
   * reloaded shortly AFTER this resolves.
   */
  applyIcsImport(profileId: string, token: string): Promise<IcsImportApplyResult>;
  /** Drops the picked `.ics` and the parsed events main is holding for it. No file handle is involved — the reader closed the file before the preview answered. */
  cancelIcsImport(): Promise<void>;
  /**
   * Dry-runs the LLM import (IMEX-005) by really parsing the pasted answer and
   * really planning it against this profile. No file and no dialog: the source
   * is `text`, which the user pasted out of their own chat, and the prompt that
   * produced it was built in the renderer by `@nexus/core`'s pure
   * `buildLlmPrompt` — Nexus talks to no model, here or anywhere. `deck` is
   * required for `"cards"` and null otherwise — an existing deck, or a new one
   * this import creates under an existing subject.
   */
  previewLlmImport(
    profileId: string,
    kind: LlmImportKind,
    text: string,
    deck: LlmImportDeckChoice | null,
  ): Promise<LlmImportPreviewResult>;
  /**
   * Re-plans the answer `token`'s preview already parsed, under a changed
   * duplicate choice (ADR-051), and answers a fresh preview carrying a fresh
   * token — `replanImport`'s twin. Never re-sends the paste: changing the
   * answer costs a re-plan of records main already holds, nothing more.
   */
  replanLlmImport(
    profileId: string,
    token: string,
    importDuplicates: boolean,
  ): Promise<LlmImportPreviewResult>;
  /**
   * Confirms the plan `token` names, ADDING its rows to this profile. Undoable
   * through `undoRestore`, which every import shares. The renderer is reloaded
   * shortly AFTER this resolves.
   */
  applyLlmImport(profileId: string, token: string): Promise<LlmImportApplyResult>;
  /** Drops the parsed answer without applying it. No file handle is involved — what it releases is the plan main is holding. */
  cancelLlmImport(): Promise<void>;
  /**
   * Opens the native `.md` picker in MAIN (files or a folder, per `source`),
   * reads and parses every file there, and writes each one as a real note in
   * `folderId` — the renderer sends no path and no bytes, exactly as with the
   * dashboard background. Resolves once every file has been settled: nothing
   * is previewed and nothing is undone, so the reply IS the report.
   */
  importMarkdownNotes(
    profileId: string,
    folderId: string | null,
    source: MarkdownImportSource,
  ): Promise<MarkdownImportResult>;
  /** This profile's scheduled-backup settings (SET-011 / ADR-056), the passphrase already stripped to `passphraseSet`. Never writes. */
  backupSettings(profileId: string): Promise<BackupSettingsView>;
  /**
   * Sets the schedule's three choices together. Enabling is refused by main
   * (and the store) while no folder or no passphrase exists — the card's
   * disabled toggle is UX, never the gate.
   */
  setBackupSettings(
    profileId: string,
    settings: { enabled: boolean; cadence: BackupCadence; keepLast: number },
  ): Promise<BackupSettingsView>;
  /**
   * Opens the native directory picker in MAIN and stores the chosen absolute
   * path — the renderer sends no path and sees only the stored result (SEC-EL).
   * Resolves once the dialog is settled; a cancel answers the unchanged view.
   */
  pickBackupFolder(profileId: string): Promise<BackupSettingsView>;
  /**
   * Sets or replaces the passphrase future scheduled archives are sealed
   * under, validated to the manual export's own rules. Write-only: main wraps
   * it under the profile's data key and nothing ever sends it back — archives
   * already written keep opening under whatever sealed them.
   */
  setBackupPassphrase(profileId: string, passphrase: string): Promise<BackupSettingsView>;
  /** Runs one backup immediately through the scheduled path's own guard, and answers the settings view carrying the run's recorded outcome. */
  runBackupNow(profileId: string): Promise<BackupSettingsView>;
  /** The private section's state (PRIV v1 / ADR-057). Safe while locked — it answers facts, never contents. */
  privStatus(profileId: string): Promise<PrivStatus>;
  /**
   * First-time PRIV setup. `credential` is what the user typed either way:
   * with `usesAccountPasscode` main first proves it IS the account passcode
   * against the live session (charging the lock screen's own throttle);
   * otherwise it must pass the 8+/letter-digit rule. `regenerateKit` mints a
   * NEW Recovery Kit code that re-wraps BOTH the account data key and the
   * PRIV DEK — returned once in the result, held nowhere. Ends unlocked.
   */
  privSetup(
    profileId: string,
    credential: string,
    usesAccountPasscode: boolean,
    regenerateKit: boolean,
  ): Promise<PrivSetupResult>;
  /** Unlocks the private section: main derives, unwraps and HOLDS the DEK — nothing key-shaped ever crosses back. Wrong attempts pay an escalating in-memory delay. */
  privUnlock(profileId: string, credential: string): Promise<PrivUnlockResult>;
  /** Drops the held PRIV DEK immediately — the renderer's panic path, and what every app lock also does on its own. */
  privLock(): Promise<void>;
  /** The unlocked section's notes, newest-touched first, each title freshly decrypted; a row that fails to open arrives as a named unreadable entry. */
  privList(profileId: string): Promise<PrivNoteListEntry[]>;
  /** One note's decrypted envelope. Only while unlocked. */
  privRead(profileId: string, id: string): Promise<PrivNoteEnvelopePayload>;
  /** Writes one note's envelope (`id: null` mints a new note; main owns the id). Every 5th write per note per session also captures a sealed version row. This slice accepts only `attachments: []`. */
  privWrite(
    profileId: string,
    id: string | null,
    envelope: PrivNoteEnvelopePayload,
  ): Promise<{ id: string }>;
  /** HARD-deletes a private note and its version history — no undo bar, deliberately (ADR-057): the renderer's typed confirm is the only gate. */
  privDelete(profileId: string, id: string): Promise<void>;
  /**
   * Ranked note ids for a query, matched in main against the in-memory index
   * built at unlock over decrypted envelopes and dropped at lock. IDS only:
   * the list already holds every title it shows, so no snippet — and no body
   * text the list does not show — needs to cross. Only while unlocked.
   */
  privSearch(profileId: string, query: string): Promise<string[]>;
  /** One note's captured versions, newest first — sequence and capture time, the two cleartext facts a sealed version row has. Only while unlocked. */
  privListVersions(profileId: string, id: string): Promise<PrivNoteVersionMeta[]>;
  /** One version's decrypted envelope, for read-only display — main unseals it at its own bound sequence; the sealed container never crosses. Only while unlocked. */
  privReadVersion(profileId: string, id: string, seq: number): Promise<PrivNoteEnvelopePayload>;
  /** Captures the note's CURRENT state as a version — the close capture, and a version restore's checkpoint before it overwrites anything. Writes nothing unless the note was written since its last capture, so calling it twice is safe. */
  privCaptureVersion(profileId: string, id: string): Promise<void>;
  /** Sets the two lock preferences; a running idle clock adopts the new interval immediately. */
  privSetLockPrefs(
    profileId: string,
    autoLockMinutes: number,
    lockOnMinimize: boolean,
  ): Promise<PrivStatus>;
  /**
   * Attaches one file to the unlocked private section: the native dialog in
   * MAIN picks it (no path ever crosses this bridge), main seals the bytes,
   * and the returned reference is the renderer's to write into the envelope —
   * see `priv:attachment-pick`'s channel comment. Rejects while locked.
   */
  privPickAttachment(profileId: string): Promise<PrivAttachmentPickResult>;
  /** Moves a PUBLIC note into the private section (ADR-057 §5): seals it as a new private note, then tears the public one down — hard delete, FTS scrub, attachment bytes re-sealed privately. Requires the section unlocked. */
  privMoveIn(profileId: string, noteId: string): Promise<PrivMoveInResult>;
  /** Moves a PRIVATE note out into an ordinary, searchable note through the normal creation path, then hard-deletes the sealed rows and their blobs. Requires the section unlocked. */
  privMoveOut(profileId: string, id: string): Promise<PrivMoveOutResult>;
  /**
   * Asks main to hold `chord` as an OS-wide hotkey (TASK-002), replacing
   * whatever it held before. Called once at boot — after the renderer has read
   * its `localStorage` overrides, which main cannot see — and again on every
   * remap. `ok: false` means the system refused the combination (another
   * application owns it); main keeps its previous working registration, so the
   * caller only has a message to show, never a state to repair.
   */
  setGlobalShortcut(chord: GlobalShortcutChord): Promise<GlobalShortcutResult>;
  /**
   * Subscribes to the single `shortcuts:global-capture` push event — the
   * OS hotkey firing while Nexus was in the background. Payload-free, exactly
   * like `onNotificationsChanged`: main has already restored and focused the
   * window, and the only thing this carries is "open a task for capture".
   * Never pushed to a locked session. Returns an unsubscribe function.
   */
  onGlobalCapture(listener: () => void): () => void;
  /** Minimises the calling window. */
  windowMinimize(): Promise<void>;
  /** Maximises the calling window, or restores it if it already is, and answers with the state it ended in. */
  windowToggleMaximize(): Promise<WindowState>;
  /** Closes the calling window — the same path the OS close button took, so the private section's closing capture still runs (ADR-057). */
  windowClose(): Promise<void>;
  /** The window's state right now. Read once on mount; every change after that arrives through `onWindowStateChanged`. */
  windowState(): Promise<WindowState>;
  /** Subscribes to maximise/restore/focus changes for the calling window. Returns an unsubscribe function. */
  onWindowStateChanged(listener: (state: WindowState) => void): () => void;
  /** Zoom or full screen for the calling window. The resulting state arrives through `onWindowStateChanged`, never as a reply — one path, so the strip can never disagree with itself. */
  windowView(command: WindowViewCommand): Promise<void>;
  /** Subscribes to main asking for what the open editors owe, pushed before an exit main starts itself: the private section's idle lock, lock-on-minimize, closing the window (DC-149). Answer with {@link NexusApi.editorsFlushed}. Returns an unsubscribe function. */
  onEditorsFlushRequested(listener: (requestId: number) => void): () => void;
  /** Answers one {@link NexusApi.onEditorsFlushRequested} request, once every open editor's write has answered. */
  editorsFlushed(requestId: number): Promise<void>;
  /** Whether cloud is on for this launch, whether this build has a project, and which account this computer belongs to. Answers while locked. */
  syncStatus(): Promise<SyncStatusView>;
  /** Writes the cloud switch and answers with the whole status. Takes effect on the NEXT launch — `cloudRestartRequired` comes back true in both directions, and the settings card says so. */
  setCloudEnabled(enabled: boolean): Promise<SyncStatusView>;
  /**
   * Turns sync on for this computer: signs in with the derived key, steps the
   * session up with the TOTP code, mints the account's master key, and reads
   * the stored wraps back byte for byte before calling any of it done. The
   * password never leaves main and never leaves this machine.
   */
  enableSync(request: {
    email: string;
    password: string;
    totpCode: string;
    deviceName: string;
    factorId?: string;
  }): Promise<SyncEnableView>;
  /**
   * Joins an account that already has a master key — what to do when
   * {@link NexusApi.enableSync} answers `already-minted`.
   *
   * Same fields as enabling plus the Sync Recovery Code from the other
   * computer's Recovery Kit. Neither the password nor the code leaves main.
   */
  adoptSync(request: {
    email: string;
    password: string;
    totpCode: string;
    recoveryCode: string;
    deviceName: string;
    factorId?: string;
  }): Promise<SyncAdoptView>;
  /** Tries the stored refresh token. One request, no password, and the same session id — so the device row stays valid. Failing is ordinary: the answer is `reconnectSync`. */
  resumeSync(): Promise<SyncStatusView>;
  /**
   * Signs in afresh and buys a NEW device row with a proof that this computer
   * holds the account's master key. For when the session is gone for good —
   * which a second machine's step-up does to every other session on the account.
   */
  reconnectSync(request: { password: string; deviceName: string }): Promise<SyncReconnectView>;
  /** Retires this computer's device row, ends its session, and forgets its copy of the master key. Coming back needs pairing or the Recovery Kit. */
  disconnectSync(): Promise<SyncStatusView>;
  /** What sync is doing right now. Read once on mount; every change after that arrives through `onSyncActivity`. */
  syncActivity(): Promise<SyncActivityView>;
  /**
   * Runs a round now, whatever the loop was waiting for — and it is also the way
   * back from a halt, since pressing it is the evidence that whatever stopped
   * the loop has been dealt with. Answers with the activity on the way out; what
   * the round finds arrives through `onSyncActivity`.
   */
  syncNow(): Promise<SyncActivityView>;
  /** Subscribes to every change in what sync is doing. Returns an unsubscribe function. */
  onSyncActivity(listener: (activity: SyncActivityView) => void): () => void;
  appInfo(): Promise<AppInfo>;
}

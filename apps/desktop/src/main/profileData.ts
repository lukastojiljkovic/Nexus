/**
 * One profile's complete interchange state, read out of the stores main
 * already owns (ADR-022 section 3). This exists as its own module for the
 * reason ADR-023 section 5 gives: a restore's undo is the profile's
 * pre-restore state, and it is captured with **the exact function the exporter
 * gathers with**, so the undo snapshot and the export archive are provably the
 * same shape. Any module a future slice forgets to gather here is a module
 * both of them lose — one bug, in one place, and a type error rather than a
 * silent omission (which is precisely the failure ADR-022 was written to
 * repair).
 *
 * Deliberately Electron-free — no `app`, no `dialog`, no `BrowserWindow` —
 * unlike `imex.ts`, which owns the save dialog. That is what lets the restore
 * path that depends on this be exercised under plain Node/Vitest.
 */

import { extractNoteLinkTargets, mergeNoteState } from "@nexus/core";
import type {
  ExportNote,
  ExportCanvasBoard,
  ExportCircuit,
  ExportCircuitPart,
  ExportCircuitWire,
  ExportNoteAttachment,
  ExportNoteCategory,
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
  ExportHabit,
  ExportHabitEntry,
  ExportNoteFolder,
  ExportNoteTag,
  ExportNoteTagLink,
  ExportNoteTemplate,
  ExportNoteVersion,
  ExportSettings,
  ProfileData,
} from "@nexus/core";
import type {
  RestoredNoteDerived,
  RestoredPrivateNote,
  RestoredPrivateNoteVersion,
  RestoredPrivateRows,
} from "@nexus/db";
import type {
  CalendarSettingsStore,
  PrivateNoteStore,
  CardStore,
  DashboardSetStore,
  DashboardSettingsStore,
  DashboardWidgetStore,
  DeckStore,
  DocumentStore,
  CanvasStore,
  ElectronicsStore,
  EventStore,
  EventTemplateStore,
  ExamStore,
  FinAccountStore,
  FinCategoryStore,
  FinRecurringStore,
  FinTransactionStore,
  FitBodyProfileStore,
  FitExerciseStore,
  FitFoodStore,
  FitMealStore,
  FitMeasurementStore,
  FitRoutineStore,
  FitTargetStore,
  FitWorkoutStore,
  FocusStore,
  HabitStore,
  NoteAttachmentStore,
  NoteOrgStore,
  NoteStore,
  NoteTemplateStore,
  NotificationStore,
  PeopleStore,
  PlanStore,
  SqliteFlagStore,
  StudySettingsStore,
  SubjectAttachmentStore,
  SubjectNoteLinkStore,
  SubjectStore,
  TaskAttachmentStore,
  TaskDependencyStore,
  TaskListStore,
  TaskStore,
  TaskTagStore,
  TaskTemplateStore,
  TopicStore,
} from "@nexus/db";

/**
 * Everything a full profile read goes through, as plain functions rather than
 * a direct `requireDb()` dependency — mirrors `NotificationSchedulerDeps`
 * (`main/notifications.ts`): keeps this module decoupled from `main/index.ts`'s
 * module-level state, with every store swap explicit at the call site.
 */
export interface ProfileDataDeps {
  taskStore(profileId: string): TaskStore;
  taskListStore(profileId: string): TaskListStore;
  taskTagStore(profileId: string): TaskTagStore;
  taskAttachmentStore(profileId: string): TaskAttachmentStore;
  taskTemplateStore(profileId: string): TaskTemplateStore;
  taskDependencyStore(profileId: string): TaskDependencyStore;
  eventStore(profileId: string): EventStore;
  eventTemplateStore(profileId: string): EventTemplateStore;
  calendarSettingsStore(profileId: string): CalendarSettingsStore;
  peopleStore(profileId: string): PeopleStore;
  documentStore(profileId: string): DocumentStore;
  subjectStore(profileId: string): SubjectStore;
  subjectAttachmentStore(profileId: string): SubjectAttachmentStore;
  subjectNoteLinkStore(profileId: string): SubjectNoteLinkStore;
  examStore(profileId: string): ExamStore;
  deckStore(profileId: string): DeckStore;
  cardStore(profileId: string): CardStore;
  topicStore(profileId: string): TopicStore;
  planStore(profileId: string): PlanStore;
  studySettingsStore(profileId: string): StudySettingsStore;
  focusStore(profileId: string): FocusStore;
  notificationStore(profileId: string): NotificationStore;
  noteStore(profileId: string): NoteStore;
  noteOrgStore(profileId: string): NoteOrgStore;
  noteTemplateStore(profileId: string): NoteTemplateStore;
  noteAttachmentStore(profileId: string): NoteAttachmentStore;
  flagStore(profileId: string): SqliteFlagStore;
  dashboardSettingsStore(profileId: string): DashboardSettingsStore;
  dashboardWidgetStore(profileId: string): DashboardWidgetStore;
  dashboardSetStore(profileId: string): DashboardSetStore;
  finAccountStore(profileId: string): FinAccountStore;
  finCategoryStore(profileId: string): FinCategoryStore;
  finRecurringStore(profileId: string): FinRecurringStore;
  finTransactionStore(profileId: string): FinTransactionStore;
  habitStore(profileId: string): HabitStore;
  fitFoodStore(profileId: string): FitFoodStore;
  fitMealStore(profileId: string): FitMealStore;
  fitTargetStore(profileId: string): FitTargetStore;
  fitExerciseStore(profileId: string): FitExerciseStore;
  fitRoutineStore(profileId: string): FitRoutineStore;
  fitWorkoutStore(profileId: string): FitWorkoutStore;
  fitMeasurementStore(profileId: string): FitMeasurementStore;
  fitBodyProfileStore(profileId: string): FitBodyProfileStore;
  canvasStore(profileId: string): CanvasStore;
  electronicsStore(profileId: string): ElectronicsStore;
}

/** Every NOTE-module row `ProfileData` requires (ADR-022 section 3) — `gatherNotes`'s return shape. */
interface GatheredNoteData {
  notes: ExportNote[];
  noteFolders: ExportNoteFolder[];
  noteTags: ExportNoteTag[];
  noteCategories: ExportNoteCategory[];
  noteTagLinks: ExportNoteTagLink[];
  noteTemplates: ExportNoteTemplate[];
  noteAttachments: ExportNoteAttachment[];
  noteVersions: ExportNoteVersion[];
}

/**
 * Gathers every NOTE-module row for one profile — kept out of
 * `gatherProfileData` itself since the per-note version/attachment fan-out
 * makes it long enough on its own.
 *
 * `noteStore.list()` already excludes soft-deleted notes — its `selectActive`
 * statement filters `deleted_at IS NULL`, the same gate `requireActive` uses
 * everywhere else in `NoteStore` — so nothing extra is needed here for
 * ADR-022's "live rows only" rule.
 *
 * A note's merged Yjs state is computed only when there is something to
 * merge: a never-edited note (`snapshot === null` AND `updates.length === 0`)
 * yields `snapshot: null` rather than the encoding of an empty document —
 * that null is what tells `buildExportArchive` to skip the `.ydoc` file and
 * emit an empty Markdown mirror instead.
 */
function gatherNotes(
  deps: Pick<ProfileDataDeps, "noteStore" | "noteOrgStore" | "noteTemplateStore" | "noteAttachmentStore">,
  profileId: string,
): GatheredNoteData {
  const notesStore = deps.noteStore(profileId);
  const orgStore = deps.noteOrgStore(profileId);
  const attachmentStore = deps.noteAttachmentStore(profileId);

  const notes: ExportNote[] = [];
  const noteVersions: ExportNoteVersion[] = [];
  const noteAttachments: ExportNoteAttachment[] = [];

  for (const meta of notesStore.list()) {
    const doc = notesStore.load(meta.id);
    const hasState = doc.snapshot !== null || doc.updates.length > 0;
    const snapshot = hasState ? mergeNoteState(doc.snapshot, doc.updates).snapshot : null;
    notes.push({ ...meta, snapshot });

    for (const version of notesStore.listVersions(meta.id)) {
      noteVersions.push({
        ...version,
        noteId: meta.id,
        snapshot: notesStore.loadVersion(meta.id, version.coveredSeq),
      });
    }

    noteAttachments.push(...attachmentStore.list(meta.id));
  }

  return {
    notes,
    noteFolders: orgStore.listFolders(),
    noteTags: orgStore.listTags(),
    noteCategories: orgStore.listCategories(),
    noteTagLinks: orgStore.listTagLinks(),
    noteTemplates: deps.noteTemplateStore(profileId).list(),
    noteAttachments,
    noteVersions,
  };
}

/**
 * Every live row of one profile, in the interchange shape both
 * `buildExportArchive` (writing an archive) and `RestoreStore` (writing a
 * profile) speak. Synchronous, because every store read here is synchronous
 * SQLite; only the feature flags are async, which is why settings are gathered
 * separately below.
 */
export function gatherProfileData(deps: ProfileDataDeps, profileId: string): ProfileData {
  const documentsStore = deps.documentStore(profileId);
  const documents = documentsStore.listActive();

  const decksStore = deps.deckStore(profileId);
  const decks = decksStore.listActive();

  const cardsStore = deps.cardStore(profileId);

  const plansStore = deps.planStore(profileId);
  const plans = plansStore.listActive();

  // Sections carry no profile scope of their own — they are read one list at a
  // time, through the already-scoped lists (TASK-004 / ADR-029).
  const listsStore = deps.taskListStore(profileId);
  const taskLists = listsStore.listActive();

  // Tags and their links are both profile-wide reads (migration 023) — the
  // links reach their tasks through the store's own scoping, so there is no
  // per-task fan-out here.
  const tagsStore = deps.taskTagStore(profileId);

  // Attachments, unlike tags, ARE read one task at a time (migration 024's
  // store is scoped through its task, exactly as the note one is through its
  // note), so the live task list is read once and reused for both.
  const tasks = deps.taskStore(profileId).listActive();
  const taskAttachmentsStore = deps.taskAttachmentStore(profileId);

  // Subject materials are read one subject at a time too (migration 035's store
  // is scoped through its subject, exactly as the task one is through its task),
  // so the live subject list is read once and reused for the fan-out below.
  const subjects = deps.subjectStore(profileId).listActive();
  const subjectAttachmentsStore = deps.subjectAttachmentStore(profileId);

  return {
    tasks,
    taskLists,
    taskSections: taskLists.flatMap((list) => listsStore.listSections(list.id)),
    taskTags: tagsStore.listTags(),
    taskTagLinks: tagsStore.listTagLinks(),
    taskAttachments: tasks.flatMap((task) => taskAttachmentsStore.list(task.id)),
    // Templates are a plain profile-wide read (migration 027): a template hangs
    // off no task and points at no list, so there is nothing to fan out over.
    taskTemplates: deps.taskTemplateStore(profileId).list(),
    // Also a profile-wide read (migration 029), and also filtered to live tasks
    // by the store itself — an edge hanging off a soft-deleted task is not part
    // of what the profile currently IS, which is what an export carries.
    taskDependencies: deps.taskDependencyStore(profileId).listLinks(),
    events: deps.eventStore(profileId).listActive(),
    // A plain profile-wide read (migration 036), like the task templates above:
    // a template hangs off no event and points at no day, so there is nothing to
    // fan out over.
    eventTemplates: deps.eventTemplateStore(profileId).list(),
    documents,
    renewals: documents.flatMap((document) => documentsStore.listRenewals(document.id)),
    people: deps.peopleStore(profileId).listActive(),
    // Always exactly one row (ADR-054), on the `dashboardSettings` argument
    // below: `get` resolves the both-null default a profile with no row still
    // has, so the archive says "no term set" out loud — and the undo snapshot
    // can put back the dates the user had set, which an omission could not.
    calendarSettings: [{ profileId, ...deps.calendarSettingsStore(profileId).get() }],
    subjects,
    subjectAttachments: subjects.flatMap((subject) => subjectAttachmentsStore.list(subject.id)),
    // A profile-wide read (migration 035), and filtered to live BOTH ends by the
    // store itself — a link running through a trashed note or subject is not
    // part of what the profile currently IS, which is what an export carries.
    subjectNoteLinks: deps.subjectNoteLinkStore(profileId).listLinks(),
    exams: deps.examStore(profileId).listActive(),
    decks,
    cards: decks.flatMap((deck) => cardsStore.listByDeck(deck.id)),
    reviewLog: cardsStore.listReviewLog(),
    // A profile-wide read (migration 046 / ADR-063), grouped by exam in rank
    // order by the store itself — the ranked curriculum, cuts included. The
    // store speaks `rank`, the interchange spells the column (`sortOrder`).
    examTopics: deps
      .topicStore(profileId)
      .listAll()
      .map(({ rank, ...topic }) => ({ ...topic, sortOrder: rank })),
    plans,
    blocks: plans.flatMap((plan) => plansStore.listBlocks(plan.id)),
    focusSessions: deps.focusStore(profileId).listActive(),
    // Always exactly one row (STUDY-007), on the `dashboardSettings` argument
    // below: `get` resolves the defaults a profile with no row still has, so an
    // archive that carried nothing here would restore as "retention 0.9, 20 new
    // a day, no review cap" anyway — writing the resolved values says the same
    // thing out loud, and lets the undo snapshot put back caps the user had set.
    studySettings: [{ profileId, ...deps.studySettingsStore(profileId).get() }],
    notifications: deps.notificationStore(profileId).listAll(),
    ...gatherNotes(deps, profileId),
    // Always exactly one row (ADR-041), because `get` resolves the defaults a
    // profile with no row still has: an archive that carried nothing here would
    // restore as "no background, dim 40" anyway, so writing the resolved values
    // says the same thing out loud — and makes the undo snapshot able to put
    // back a dim the user had set, which an omission could not. `activeSetId`
    // (ADR-055) rides in the same resolved row, its null meaning „Početna“.
    dashboardSettings: [{ profileId, ...deps.dashboardSettingsStore(profileId).get() }],
    // The named boards (DASH-008 / ADR-055): plain stored rows, one per board
    // the user made — the default board is not a row and so is not gathered.
    dashboardSets: deps.dashboardSetStore(profileId).list(),
    // The STORED rows, not the resolved layout — the opposite choice from the
    // settings row above, and for the opposite reason (ADR-045). A board that
    // never was rearranged has no rows, and that emptiness is itself
    // the fact worth carrying: it says "on the default arrangement", so a
    // restore leaves the target there and a later change to the default still
    // reaches it. Writing out the resolved five instead would silently freeze
    // every board onto today's default the first time it was backed up.
    dashboardWidgets: deps.dashboardWidgetStore(profileId).listAll(),
    ...gatherFinance(deps, profileId),
    ...gatherHabits(deps, profileId),
    ...gatherFitness(deps, profileId),
    ...gatherCanvas(deps, profileId),
    ...gatherElectronics(deps, profileId),
  };
}

/**
 * Gathers every CANV-module row for one profile: ONE read, and it is the read
 * that carries the DRAWINGS (`listActiveWithScenes`) rather than the cheap
 * metadata one the page draws its list from. A board IS its drawing, so an
 * archive of board names would restore a profile whose every diagram is a blank
 * page.
 *
 * Embedded images ride whole, inside the scene's own `files` rather than in
 * `blobs/` (see `SCHEMA_VERSION`'s `1.36.0` entry), so there is no second gather
 * to keep in step with this one — and no attachment row anywhere that could go
 * missing.
 *
 * The store hands back canonical TEXT (it is what the column holds); the
 * interchange carries the nested object, so it is parsed here and re-serialised
 * by `canvasSceneText` on the way back in. The parse cannot fail: the store
 * already re-validated it on the way out, and a scene that did not parse threw
 * there rather than arriving here.
 */
function gatherCanvas(
  deps: Pick<ProfileDataDeps, "canvasStore">,
  profileId: string,
): { canvasBoards: ExportCanvasBoard[] } {
  return {
    canvasBoards: deps
      .canvasStore(profileId)
      .listActiveWithScenes()
      .map((board) => ({
        id: board.id,
        profileId: board.profileId,
        name: board.name,
        scene: JSON.parse(board.scene) as ExportCanvasBoard["scene"],
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
      })),
  };
}

/** Every ELEC-module row `ProfileData` requires (migration 067) — `gatherElectronics`'s return shape. */
interface GatheredElectronicsData {
  circuits: ExportCircuit[];
  circuitParts: ExportCircuitPart[];
  circuitWires: ExportCircuitWire[];
}

/**
 * Gathers every ELEC-module row for one profile: three reads, one per table,
 * and never one per circuit — `listAllForExport` exists so that a profile with
 * forty circuits is three statements rather than eighty-one.
 *
 * **Nothing about the COMPONENTS is gathered, and there is no second call to
 * keep in step with this one.** The 153 the app ships are constants in
 * `@nexus/core`, versioned with the application, so a part carries a
 * `componentId` and the build that opens the archive resolves it — the food
 * catalogue's arrangement one module over, for a stronger reason: a corrected
 * datasheet must not be frozen into every backup ever taken.
 *
 * The store already excludes a soft-deleted circuit AND everything on it, which
 * is what keeps the three collections consistent with each other: an archive
 * carrying the parts of a circuit it does not carry would be refused by a
 * foreign key on the way back in.
 */
function gatherElectronics(
  deps: Pick<ProfileDataDeps, "electronicsStore">,
  profileId: string,
): GatheredElectronicsData {
  const all = deps.electronicsStore(profileId).listAllForExport();
  return { circuits: all.circuits, circuitParts: all.parts, circuitWires: all.wires };
}

/** Every HABIT-module row `ProfileData` requires (migration 055) — `gatherHabits`'s return shape. */
interface GatheredHabitData {
  habits: ExportHabit[];
  habitEntries: ExportHabitEntry[];
}

/**
 * Gathers every HABIT-module row for one profile: two profile-wide reads and no
 * fan-out at all, because the entry read answers for every habit at once
 * (`listAllEntries`) rather than per habit — an N+1 over a year of days would be
 * the obvious wrong shape here.
 *
 * `listActive` includes ARCHIVED habits, and that is exactly what an archive
 * needs: archiving is a fact about today's list, not about whether the row is
 * here, so a gather that dropped them would restore a profile with its finished
 * habits — and their whole history — simply gone.
 *
 * Nothing DERIVED travels: a streak is computed from these days on every read
 * (`computeHabitStreak`), so an archive carrying one could only ever contradict
 * the rows beside it. The window below is the widest a day key can express, so
 * "every entry this profile has" is what rides.
 */
function gatherHabits(
  deps: Pick<ProfileDataDeps, "habitStore">,
  profileId: string,
): GatheredHabitData {
  const habits = deps.habitStore(profileId);
  return {
    habits: habits.listActive(),
    habitEntries: habits.listAllEntries({ from: MIN_DAY_KEY, to: MAX_DAY_KEY }),
  };
}

/** Every FIT-module row `ProfileData` requires (migrations 058 and 060) — `gatherFitness`'s return shape. */
interface GatheredFitnessData {
  fitFoods: ExportFitFood[];
  fitMealItems: ExportFitMealItem[];
  fitTargets: ExportFitTarget[];
  fitExercises: ExportFitExercise[];
  fitRoutines: ExportFitRoutine[];
  fitRoutineItems: ExportFitRoutineItem[];
  fitWorkouts: ExportFitWorkout[];
  fitWorkoutSets: ExportFitWorkoutSet[];
  fitMeasurements: ExportFitMeasurement[];
  fitBodyProfile: ExportFitBodyProfile[];
}

/**
 * Gathers every FIT-module row for one profile: three profile-wide reads and no
 * fan-out at all.
 *
 * **The app's food CATALOGUE is deliberately not gathered, and there is nothing
 * here that could gather it.** Those several hundred foods ship as JSON inside
 * `@nexus/core` rather than as rows, so `fitFoodStore.list()` answers with the
 * user's OWN foods and nothing else — which is exactly what an archive of user
 * data should carry. Nothing is lost by it: every logged item carries the food's
 * label and the seven per-100 g values it was logged with, so the diary is
 * complete on its own terms even in a build whose catalogue has moved on.
 *
 * `listAll` rather than a widest-window range read (HABIT's own shape one module
 * over): the meal store's range reads are capped at `MAX_MEAL_RANGE_DAYS`
 * because a screen asking for a decade of totals is a screen with a bug, while
 * „every row this profile has" is precisely what a backup must not truncate.
 *
 * The goals row is zero or one, and which it is is a REAL fact: `updatedAt` is
 * null exactly when the profile never saved any goals, so an absent row here
 * says „never decided" while a row of four nulls says „decided to have none".
 *
 * FIT's training half (migration 060) rides in the same gather. `fitRoutines`/
 * `fitWorkouts` are read as their own store's nested shape (a routine with its
 * items, a workout with its sets) and then split in two here — the parent row
 * and the flattened children — because `ProfileData` carries the two as
 * separate collections, `taskLists`/`taskSections`' arrangement. `listRange`
 * over the widest possible span is `gatherHabits`' idiom restated: "every
 * workout/measurement this profile has", never a screen-sized window truncating
 * a backup. `FitWorkoutStore`'s own `FitWorkoutSet` and
 * `FitMeasurementStore`'s own `FitMeasurement` carry no `profileId` of their
 * own (an instance-scoped store's ordinary shape) — added here, at the one
 * place that already knows it, `calendarSettings`'/`studySettings`' pattern
 * just above. So does `FitBodyProfileStore.get()`'s zero-or-one row.
 */
function gatherFitness(
  deps: Pick<
    ProfileDataDeps,
    | "fitFoodStore"
    | "fitMealStore"
    | "fitTargetStore"
    | "fitExerciseStore"
    | "fitRoutineStore"
    | "fitWorkoutStore"
    | "fitMeasurementStore"
    | "fitBodyProfileStore"
  >,
  profileId: string,
): GatheredFitnessData {
  const targets = deps.fitTargetStore(profileId).get();
  const routines = deps.fitRoutineStore(profileId).list();
  const workouts = deps.fitWorkoutStore(profileId).listRange(MIN_DAY_KEY, MAX_DAY_KEY);
  const bodyProfile = deps.fitBodyProfileStore(profileId).get();
  return {
    fitFoods: deps.fitFoodStore(profileId).list(),
    fitMealItems: deps.fitMealStore(profileId).listAll(),
    fitTargets:
      targets.updatedAt === null
        ? []
        : [
            {
              profileId,
              kcal: targets.kcal,
              proteinG: targets.proteinG,
              carbsG: targets.carbsG,
              fatG: targets.fatG,
              updatedAt: targets.updatedAt,
            },
          ],
    fitExercises: deps.fitExerciseStore(profileId).list(),
    fitRoutines: routines.map(({ items: _items, ...routine }) => routine),
    fitRoutineItems: routines.flatMap((routine) => routine.items),
    fitWorkouts: workouts.map(({ sets: _sets, ...workout }) => workout),
    fitWorkoutSets: workouts.flatMap((workout) =>
      workout.sets.map((set) => ({ ...set, profileId })),
    ),
    fitMeasurements: deps
      .fitMeasurementStore(profileId)
      .listRange(MIN_DAY_KEY, MAX_DAY_KEY)
      .map((measurement) => ({ ...measurement, profileId })),
    fitBodyProfile: bodyProfile === null ? [] : [{ profileId, ...bodyProfile }],
  };
}

/**
 * How „every entry this profile has" is asked for over a range-shaped read. The
 * lower bound is 1900 rather than year 1 because `isBareDate` refuses a
 * two-digit year (`Date.UTC(1, …)` rolls into 1901), and it needs no defending:
 * a habit is something a person is doing now, and this app cannot record a tick
 * on a day before software existed.
 */
const MIN_DAY_KEY = "1900-01-01";
const MAX_DAY_KEY = "9999-12-31";

/** Every FIN-module row `ProfileData` requires (migrations 051 and 053) — `gatherFinance`'s return shape. */
interface GatheredFinanceData {
  finAccounts: ExportFinAccount[];
  finCategories: ExportFinCategory[];
  finRecurring: ExportFinRecurring[];
  finTransactions: ExportFinTransaction[];
  finBudgets: ExportFinBudget[];
}

/**
 * Gathers every FIN-module row for one profile. Four plain profile-wide reads,
 * with no fan-out at all: a transaction hangs off its account but the store is
 * scoped by profile rather than by account (unlike the note/task/subject
 * attachment stores), and a budget is read with its categories.
 *
 * Every store here already excludes soft-deleted rows — `listActive` on the
 * accounts and the transactions, and the categories have no soft delete —
 * so nothing extra is needed for ADR-022's "live rows only" rule. And nothing
 * DERIVED travels: an account's balance is computed from these rows on every
 * read, so an archive carrying one could only ever contradict them.
 */
function gatherFinance(
  deps: Pick<
    ProfileDataDeps,
    "finAccountStore" | "finCategoryStore" | "finRecurringStore" | "finTransactionStore"
  >,
  profileId: string,
): GatheredFinanceData {
  const categories = deps.finCategoryStore(profileId);
  return {
    finAccounts: deps.finAccountStore(profileId).listActive(),
    finCategories: categories.list(),
    // A subscription's `nextRun` cursor travels with it, deliberately: the
    // charges it has already generated are in this same archive, so a restore
    // that reset the cursor would re-charge every one of them (migration 053's
    // unique index would refuse the duplicates, but the balance would still be
    // a lie about which occurrences are outstanding). Its `pausedAt` travels for
    // the sharper version of the same reason (ADR-074): a restore that dropped
    // it would resume somebody's billing.
    //
    // `listActive` is the right read here even so — a PAUSED subscription is a
    // live row, and it is precisely the one the archive must not lose.
    finRecurring: deps.finRecurringStore(profileId).listActive(),
    finTransactions: deps.finTransactionStore(profileId).listActive(),
    finBudgets: categories.listBudgets(),
  };
}

/**
 * The profile-level settings an archive carries beside its rows (founder
 * decision #11): feature flags and notification preferences. Split from
 * `gatherProfileData` only because `flagStore.get()` is async — keeping the
 * row gather synchronous means a caller inside a database transaction can use
 * it without an await in the middle.
 */
export async function gatherProfileSettings(
  deps: Pick<ProfileDataDeps, "flagStore" | "notificationStore">,
  profileId: string,
): Promise<ExportSettings> {
  const notificationSettings = deps.notificationStore(profileId).getSettings();
  return {
    flags: await deps.flagStore(profileId).get(),
    notifications: {
      quietFrom: notificationSettings.quietFrom,
      quietTo: notificationSettings.quietTo,
      morningHour: notificationSettings.morningHour,
      enabledSources: notificationSettings.enabledSources,
      // NTF-009 (`1.19.0`): the resolved value, never an omission — the same
      // choice `studySettings`/`dashboardSettings` make just above. A profile
      // that never chose one exports „10 min“, which is what its snooze button
      // means, so a restore puts back a fact rather than a silence.
      snoozeDefault: notificationSettings.snoozeDefault,
    },
  };
}

/**
 * Re-derives, for every note, the two things a restore has to write but an
 * archive deliberately does not carry (ADR-023 section 6): the searchable
 * plaintext migration 017's index projects, and the outbound wiki-links
 * `note_links` holds.
 *
 * Both are normally produced by a running renderer — the editor reports its
 * links at flush time (ADR-013) and the plaintext falls out of compaction —
 * and a restore has no renderer, so they are recomputed here from the Yjs
 * state itself. A note with no state at all (`snapshot === null`) derives to
 * empty plaintext and no links, which is exactly what a never-edited note has.
 *
 * Used by both sides of a restore: the archive's notes on the way in, and the
 * profile's own notes when capturing the undo snapshot — the same reason
 * `gatherProfileData` is shared.
 */
export function deriveRestoredNotes(
  notes: readonly ExportNote[],
): Map<string, RestoredNoteDerived> {
  const derived = new Map<string, RestoredNoteDerived>();
  for (const note of notes) {
    if (note.snapshot === null) {
      derived.set(note.id, { plaintext: "", linkTargets: [] });
      continue;
    }
    derived.set(note.id, {
      plaintext: mergeNoteState(note.snapshot, []).plaintext,
      linkTargets: extractNoteLinkTargets(note.snapshot),
    });
  }
  return derived;
}

/**
 * The undo snapshot's PRIVATE half (ADR-057 §6): every sealed container of one
 * profile's private section, verbatim — bytes, never envelopes. Deliberately
 * OUTSIDE `ProfileData` and outside `gatherProfileData`, unlike every public
 * collection: the gather reads live rows in cleartext, while these rows are
 * opaque without the PRIV DEK — and undoing a restore must NOT need the DEK,
 * because the section may well have locked between the apply and the undo
 * click. Captured only when a restore is actually about to replace the private
 * tables, and put back byte-for-byte through the same conditional
 * `privateSealed` path (`RestoreStore.replaceProfileData`) it was captured for.
 */
export function gatherPrivateSealedRows(store: PrivateNoteStore): RestoredPrivateRows {
  const notes: RestoredPrivateNote[] = [];
  const versions: RestoredPrivateNoteVersion[] = [];
  for (const meta of store.list()) {
    notes.push({
      id: meta.id,
      sealed: store.readSealed(meta.id),
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    });
    for (const version of store.listVersions(meta.id)) {
      versions.push({
        noteId: meta.id,
        seq: version.seq,
        sealed: store.readVersion(meta.id, version.seq),
        createdAt: version.createdAt,
      });
    }
  }
  return { notes, versions };
}

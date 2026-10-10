import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIRST_RANK, rankBetween, rankSequence, renderClozeCard } from "@nexus/core";
import type {
  ExportEvent,
  ExportNote,
  ExportNoteFolder,
  ExportSettings,
  ExportStudyBlock,
  ExportTask,
  ProfileData,
} from "@nexus/core";
import {
  CalendarSettingsStore,
  CardStore,
  DashboardSetStore,
  DashboardSettingsStore,
  DashboardWidgetStore,
  DEFAULT_DASHBOARD_LAYOUT,
  DEFAULT_BACKGROUND_DIM,
  DEFAULT_NEW_PER_DAY,
  DEFAULT_TARGET_RETENTION,
  DeckStore,
  DocumentStore,
  EventStore,
  EventTemplateStore,
  ExamStore,
  FinAccountStore,
  FinCategoryStore,
  FinRecurringStore,
  FinTransactionStore,
  FocusStore,
  FitBodyProfileStore,
  FitExerciseStore,
  FitFoodStore,
  FitMealStore,
  FitMeasurementStore,
  FitRoutineStore,
  FitTargetStore,
  FitWorkoutStore,
  CanvasStore,
  ElectronicsStore,
  HabitStore,
  NexusDatabase,
  NoteAttachmentStore,
  NoteOrgStore,
  NoteStore,
  NoteTemplateStore,
  NotificationStore,
  PeopleStore,
  PlanStore,
  TopicStore,
  PrivateNoteStore,
  ProfileStore,
  RestoreStore,
  RestoreValidationError,
  RESTORE_WIPE_TABLES,
  SearchHistoryStore,
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
  TOGGLEABLE_NOTIFICATION_SOURCES,
  openDatabase,
  uuidv7,
} from "../index.js";
import type {
  Card,
  Deck,
  Event,
  EventTemplate,
  Exam,
  FocusSession,
  NoteFolder,
  NoteMeta,
  NoteTag,
  NoteTemplate,
  NotificationRecord,
  Person,
  RestoredNoteDerived,
  RestoredPrivateRows,
  StudyPlan,
  Subject,
  Task,
  TaskList,
  TaskSection,
  TaskTag,
  TaskTemplate,
  TrackedDocument,
} from "../index.js";

let dir: string;
let db: NexusDatabase;
/**
 * A second, independent database file standing in for a **fresh install** — the
 * shape PRD 14 §8's round-trip criterion actually describes, and the only place
 * an archive's rows can land without meeting their own ids. Row ids are
 * preserved by design (ADR-023 §1) and are GLOBAL primary keys, so an archive
 * cannot be restored *beside* the profile it came from; see the collision test
 * at the bottom of this file, which pins that down.
 */
let freshDb: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-restore-"));
  db = openDatabase({ path: join(dir, "restore.db") });
  freshDb = openDatabase({ path: join(dir, "fresh.db") });
});

afterEach(() => {
  db.close();
  freshDb.close();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = "2026-02-01T00:00:00.000Z";

function createProfile(handle: NexusDatabase, name: string): string {
  const id = uuidv7();
  const created = new Date().toISOString();
  handle.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, created);
  // Every profile has an Inbox (TASK-004): migration 022 backfills the ones
  // that predate ADR-029 and `main` seeds it for the ones it creates, so a
  // fixture without one would be a database state the app cannot reach.
  new TaskListStore(handle.raw, id).ensureInbox(created);
  return id;
}

/** A deterministic non-empty binary blob of `length` bytes — mirrors `noteStore.test.ts`'s helper. `RestoreStore` never decodes a note's snapshot bytes (only the caller-supplied `derived.plaintext`/`linkTargets` feed anything readable), so an opaque blob stands in for a real Yjs update throughout this suite. */
function bytes(length: number, offset = 0): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i + offset) % 256;
  return out;
}

/**
 * The goals row as the interchange carries it: zero rows while nothing was ever
 * saved (`updatedAt === null`), one otherwise — `gatherProfileData`'s own
 * mapping, restated here so the round trip exercises the same shape main builds.
 */
function fitTargetRows(profileId: string, store: FitTargetStore): ProfileData["fitTargets"] {
  const targets = store.get();
  if (targets.updatedAt === null) return [];
  return [
    {
      profileId,
      kcal: targets.kcal,
      proteinG: targets.proteinG,
      carbsG: targets.carbsG,
      fatG: targets.fatG,
      updatedAt: targets.updatedAt,
    },
  ];
}

/**
 * The boards as the interchange carries them — `gatherCanvas`'s own mapping,
 * restated here so the round trip exercises the same shape main builds: the
 * store answers canonical TEXT, the archive carries the nested document.
 */
function canvasBoardRows(store: CanvasStore): ProfileData["canvasBoards"] {
  return store.listActiveWithScenes().map((board) => ({
    id: board.id,
    profileId: board.profileId,
    name: board.name,
    scene: JSON.parse(board.scene) as ProfileData["canvasBoards"][number]["scene"],
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  }));
}

const FIT_TRAINING_MIN_DAY = "1900-01-01";
const FIT_TRAINING_MAX_DAY = "9999-12-31";

/**
 * FIT training & body (migration 060) rows as the interchange carries them —
 * `gatherFitness`'s own split of a store's nested shape (a routine with its
 * items, a workout with its sets) into the separate collections `ProfileData`
 * holds, restated here so the round trip exercises the same shape main builds.
 */
function fitRoutineRows(store: FitRoutineStore): ProfileData["fitRoutines"] {
  return store.list().map(({ items: _items, ...routine }) => routine);
}

function fitRoutineItemRows(store: FitRoutineStore): ProfileData["fitRoutineItems"] {
  return store.list().flatMap((routine) => routine.items);
}

function fitWorkoutRows(store: FitWorkoutStore): ProfileData["fitWorkouts"] {
  return store
    .listRange(FIT_TRAINING_MIN_DAY, FIT_TRAINING_MAX_DAY)
    .map(({ sets: _sets, ...workout }) => workout);
}

function fitWorkoutSetRows(
  profileId: string,
  store: FitWorkoutStore,
): ProfileData["fitWorkoutSets"] {
  return store
    .listRange(FIT_TRAINING_MIN_DAY, FIT_TRAINING_MAX_DAY)
    .flatMap((workout) => workout.sets.map((set) => ({ ...set, profileId })));
}

function fitMeasurementRows(
  profileId: string,
  store: FitMeasurementStore,
): ProfileData["fitMeasurements"] {
  return store
    .listRange(FIT_TRAINING_MIN_DAY, FIT_TRAINING_MAX_DAY)
    .map((measurement) => ({ ...measurement, profileId }));
}

function fitBodyProfileRows(
  profileId: string,
  store: FitBodyProfileStore,
): ProfileData["fitBodyProfile"] {
  const profile = store.get();
  return profile === null ? [] : [{ profileId, ...profile }];
}

function emptyProfileData(): ProfileData {
  return {
    tasks: [],
    taskLists: [],
    taskSections: [],
    taskTags: [],
    taskTagLinks: [],
    taskAttachments: [],
    taskDependencies: [],
    habits: [],
    habitEntries: [],
    fitFoods: [],
    fitMealItems: [],
    fitTargets: [],
    fitExercises: [],
    fitRoutines: [],
    fitRoutineItems: [],
    fitWorkouts: [],
    fitWorkoutSets: [],
    fitMeasurements: [],
    fitBodyProfile: [],
    canvasBoards: [],
    circuits: [],
    circuitChassis: [],
    circuitParts: [],
    circuitWires: [],
    // The kit's section (ADR-090): empty here, because no module is adopted in a
    // database-level test and a module's own payload is not a row this store
    // writes. A restore applies it through `restoreModuleData`, one level up.
    modules: [],
    events: [],
    eventTemplates: [],
    documents: [],
    renewals: [],
    people: [],
    calendarSettings: [],
    subjects: [],
    subjectAttachments: [],
    subjectNoteLinks: [],
    exams: [],
    decks: [],
    cards: [],
    reviewLog: [],
    examTopics: [],
    plans: [],
    blocks: [],
    focusSessions: [],
    studySettings: [],
    notifications: [],
    notes: [],
    noteFolders: [],
    noteTags: [],
    noteCategories: [],
    noteTagLinks: [],
    noteTemplates: [],
    noteAttachments: [],
    noteVersions: [],
    taskTemplates: [],
    dashboardSettings: [],
    dashboardSets: [],
    dashboardWidgets: [],
    finAccounts: [],
    finCategories: [],
    finRecurring: [],
    finTransactions: [],
    finBudgets: [],
  };
}

function emptySettings(): ExportSettings {
  return {
    flags: {},
    notifications: {
      quietFrom: null,
      quietTo: null,
      morningHour: "08:00",
      enabledSources: [],
      snoozeDefault: "10m",
    },
  };
}

/** A minimal, valid `ExportNote` — `profileId` is a placeholder: `RestoreStore` ignores it entirely (R4). */
function makeNote(overrides: Partial<ExportNote> & { id: string }): ExportNote {
  return {
    profileId: "ignored",
    title: "",
    folderId: null,
    categoryId: null,
    pinned: false,
    cardDeckId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    snapshot: null,
    ...overrides,
  };
}

interface FixtureIds {
  parentTask: Task;
  childTask: Task;
  list: TaskList;
  section: TaskSection;
  taskTag: TaskTag;
  event: Event;
  person: Person;
  document: TrackedDocument;
  subject: Subject;
  exam: Exam;
  deck: Deck;
  card: Card;
  plan: StudyPlan;
  session: FocusSession;
  notification: NotificationRecord;
  folder: NoteFolder;
  tag: NoteTag;
  editedNote: NoteMeta;
  neverEditedNote: NoteMeta;
  template: NoteTemplate;
  taskTemplate: TaskTemplate;
  eventTemplate: EventTemplate;
}

interface Fixture {
  data: ProfileData;
  derived: Map<string, RestoredNoteDerived>;
  ids: FixtureIds;
}

/**
 * Seeds one profile with a real row in every module, entirely through the
 * actual store classes (never hand-built rows) — the same trust boundary a
 * real IMEX export walks. Returns the gathered `ProfileData`/`derived` a
 * restore would receive, plus the ids of one representative row per module
 * for tests that need to query back through a scoped store method.
 */
function seedFixture(handle: NexusDatabase, profileId: string, name: string): Fixture {
  const t0 = "2026-01-01T00:00:00.000Z";
  const t1 = "2026-01-01T00:01:00.000Z";
  const t2 = "2026-01-01T00:02:00.000Z";
  const t3 = "2026-01-01T00:03:00.000Z";

  const taskStore = new TaskStore(handle.raw, profileId);
  const taskListStore = new TaskListStore(handle.raw, profileId);
  const taskTagStore = new TaskTagStore(handle.raw, profileId);
  const taskAttachmentStore = new TaskAttachmentStore(handle.raw, profileId);
  const taskDependencyStore = new TaskDependencyStore(handle.raw, profileId);
  const eventStore = new EventStore(handle.raw, profileId);
  const peopleStore = new PeopleStore(handle.raw, profileId);
  const documentStore = new DocumentStore(handle.raw, profileId);
  const subjectStore = new SubjectStore(handle.raw, profileId);
  const subjectAttachmentStore = new SubjectAttachmentStore(handle.raw, profileId);
  const subjectNoteLinkStore = new SubjectNoteLinkStore(handle.raw, profileId);
  const examStore = new ExamStore(handle.raw, profileId);
  const deckStore = new DeckStore(handle.raw, profileId);
  const cardStore = new CardStore(handle.raw, profileId);
  const topicStore = new TopicStore(handle.raw, profileId);
  const planStore = new PlanStore(handle.raw, profileId);
  const focusStore = new FocusStore(handle.raw, profileId);
  const notificationStore = new NotificationStore(handle.raw, profileId);
  const noteStore = new NoteStore(handle.raw, profileId);
  const orgStore = new NoteOrgStore(handle.raw, profileId);
  const attachmentStore = new NoteAttachmentStore(handle.raw, profileId);
  const templateStore = new NoteTemplateStore(handle.raw, profileId);
  const taskTemplateStore = new TaskTemplateStore(handle.raw, profileId);
  const eventTemplateStore = new EventTemplateStore(handle.raw, profileId);
  const dashboardStore = new DashboardSettingsStore(handle.raw, profileId);
  const dashboardWidgetStore = new DashboardWidgetStore(handle.raw, profileId);
  const dashboardSetStore = new DashboardSetStore(handle.raw, profileId);
  const studySettingsStore = new StudySettingsStore(handle.raw, profileId);
  const calendarSettingsStore = new CalendarSettingsStore(handle.raw, profileId);
  const finAccountStore = new FinAccountStore(handle.raw, profileId);
  const finCategoryStore = new FinCategoryStore(handle.raw, profileId);
  const finRecurringStore = new FinRecurringStore(handle.raw, profileId);
  const finTransactionStore = new FinTransactionStore(handle.raw, profileId);
  const habitStore = new HabitStore(handle.raw, profileId);
  const fitFoodStore = new FitFoodStore(handle.raw, profileId);
  const fitMealStore = new FitMealStore(handle.raw, profileId);
  const fitTargetStore = new FitTargetStore(handle.raw, profileId);
  const fitExerciseStore = new FitExerciseStore(handle.raw, profileId);
  const fitRoutineStore = new FitRoutineStore(handle.raw, profileId);
  const fitWorkoutStore = new FitWorkoutStore(handle.raw, profileId);
  const fitMeasurementStore = new FitMeasurementStore(handle.raw, profileId);
  const fitBodyProfileStore = new FitBodyProfileStore(handle.raw, profileId);
  const canvasStore = new CanvasStore(handle.raw, profileId);
  const electronicsStore = new ElectronicsStore(handle.raw, profileId);

  // The merged Yjs state and derived body an export would carry for the edited
  // note — stand-ins for real Yjs bytes (see `bytes()`), but genuinely stored
  // by `compact` below and genuinely reproduced by a restore.
  const editedSnapshot = bytes(8, 99);
  const editedPlaintext = `${name} note plaintext`;

  // A real list with a real section, and the task filed INSIDE it (TASK-004):
  // the placement is what a restore has to reproduce, and the Inbox-only shape
  // would prove nothing about it.
  const list = taskListStore.createList({ name: `${name} list` }, t0);
  const section = taskListStore.createSection(list.id, `${name} section`, t0);

  // Dated and laddered (ADR-028), so the full round trip below carries a task
  // whose reminders have somewhere to count back from.
  const parentTask = taskStore.create({
    title: `${name} parent task`,
    dueDate: "2026-09-01",
    reminderOffsets: [1, 0],
    listId: list.id,
    sectionId: section.id,
  });
  const childTask = taskStore.create({ title: `${name} child task`, parentId: parentTask.id });

  // A real tag on a real task (migration 023): the link is what a restore has to
  // reproduce, and a bare tag with nothing attached would prove only half of it.
  const taskTag = taskTagStore.createTag(`${name} task tag`, t0);
  taskTagStore.attachTag(parentTask.id, taskTag.id);

  // A real file on a real task (migration 024), sharing its hash with NOTHING —
  // the note attachment below uses "a"×64, so the two tables' blobs stay
  // distinguishable in every assertion.
  taskAttachmentStore.add(
    parentTask.id,
    { fileName: "ugovor.pdf", mime: "application/pdf", sizeBytes: 30, sha256: "c".repeat(64) },
    t2,
  );

  // A template with every payload field set (ADR-035): the nested payload is the
  // one value in this fixture a restore has to re-serialize rather than copy, so
  // an empty one would prove nothing about it.
  const taskTemplate = taskTemplateStore.saveByName(
    `${name} task template`,
    {
      title: `${name} from template`,
      description: "Opis",
      priority: "high",
      dueOffsetDays: 7,
      reminderOffsets: [0, 1],
      recurrence: { freq: { kind: "weekly", interval: 1, days: [1] }, end: { kind: "never" } },
      tagNames: [`${name} task tag`],
      subtaskTitles: ["Prvi korak", "Drugi korak"],
    },
    t0,
  );
  // A real dependency between the two tasks (migration 029 / ADR-037): the
  // DIRECTION is the whole record, so a restore that reversed it would be as
  // wrong as one that dropped it — and only a seeded edge can catch either.
  taskDependencyStore.addDependency(childTask.id, parentTask.id);

  const event = eventStore.create({
    title: `${name} event`,
    startAt: "2026-03-01T10:00:00.000Z",
    reminderOffsets: [15, 1440],
  });

  // An event template with every payload field set (CAL-009) — the second nested
  // payload in this fixture, and the second value a restore has to re-serialize
  // rather than copy. Captured FROM the event above, so the relativizing is real
  // rather than a hand-built payload nobody's store ever produced.
  const eventTemplate = eventTemplateStore.captureFromEvent(
    event.id,
    `${name} event template`,
    t0,
  );

  // A leap-day birthday with a known year: the shape whose (month, day) pair
  // no SQL CHECK can vet, so a restore that wrote it back wrong would be
  // caught here rather than by a user in February 2028.
  const person = peopleStore.create(
    { name: `${name} person`, kind: "birthday", month: 2, day: 29, year: 1992, note: "Beleška" },
    t0,
  );

  const document = documentStore.create({
    docType: "pasos",
    label: `${name} document`,
    expiryDate: "2027-01-01",
  });
  documentStore.renew(document.id, "2028-01-01");

  const subject = subjectStore.create({ name: `${name} subject` });
  // A real material on a real subject (migration 035), with a hash of its own —
  // "c"×64 is the task's file and "a"×64 the note's, so all three tables' blobs
  // stay distinguishable in every assertion.
  subjectAttachmentStore.add(
    subject.id,
    { fileName: "skripta.pdf", mime: "application/pdf", sizeBytes: 40, sha256: "d".repeat(64) },
    t2,
  );
  const exam = examStore.create({ subjectId: subject.id, examType: "pismeni", examDate: "2030-01-01" });
  const deck = deckStore.create({ subjectId: subject.id, name: `${name} deck` });
  const createdCard = cardStore.create({ deckId: deck.id, front: "Q", back: "A" }, t0);
  cardStore.review(createdCard.id, 3, "2026-01-02T00:00:00.000Z");
  // A cloze card in the fixture (ADR-042), so `cards: cardStore.listByDeck(...)`
  // below carries the kind columns and every "restores exactly what was
  // gathered" assertion covers them.
  cardStore.createCloze(deck.id, "Glavni grad je {{Beograd}}, a reka je {{Sava}}.", t0);

  // A deck-linked, confidence-carrying topic (ADR-063) BEFORE the plan, so the
  // plan's generated blocks carry topic/kind columns and the round-trip
  // assertions below cover them.
  topicStore.create({ examId: exam.id, name: `${name} topic`, confidence: 40, deckId: deck.id }, t0);
  const plan = planStore.createPlan(
    {
      examId: exam.id,
      dailyMinutes: 30,
      startDate: "2026-06-01",
      examWeekBoost: true,
      weekdayMinutes: [30, 30, 30, 30, 30, 0, 60],
    },
    t0,
    "2026-01-01",
  );

  // A real ledger (migration 051): two same-currency accounts so a TRANSFER can
  // ride as the one row it is, an expense category with a budget, an income
  // category, and an ordinary categorized expense. A restore that reproduced
  // the transfer as anything but this single row would fail the round trip
  // below — and so would one that turned any amount into a float.
  const finAccount = finAccountStore.create(
    { name: `${name} tekući`, kind: "current", currency: "RSD", openingBalance: 1000_00 },
    t0,
  );
  const finSavings = finAccountStore.create(
    { name: `${name} štednja`, kind: "savings", currency: "RSD" },
    t0,
  );
  const finCategory = finCategoryStore.create({ name: `${name} hrana`, kind: "expense" }, t0);
  finCategoryStore.create({ name: `${name} plata`, kind: "income" }, t0);
  finCategoryStore.setBudget(
    { categoryId: finCategory.id, currency: "RSD", amount: 300_00 },
    t0,
  );
  finTransactionStore.create(
    {
      accountId: finAccount.id,
      categoryId: finCategory.id,
      date: "2026-02-02",
      amount: -12_50,
      payee: "Maxi",
    },
    t0,
  );
  finTransactionStore.create(
    {
      accountId: finAccount.id,
      counterAccountId: finSavings.id,
      date: "2026-02-04",
      amount: -300_00,
    },
    t0,
  );
  // FIN slice d (migration 053): a subscription with an ADR-024 rule and a
  // reminder lead, plus one charge it has actually generated. The round trip
  // below is what proves both halves travel — the rule in canonical form and
  // the `nextRun` CURSOR, which must come back where it was rather than at the
  // start date, or a restore would re-charge history that is in the same
  // archive.
  finRecurringStore.create(
    {
      accountId: finAccount.id,
      categoryId: finCategory.id,
      name: `${name} Netflix`,
      amount: -11_90,
      recurrence: { freq: { kind: "monthly-date", interval: 1, day: 5 }, end: { kind: "never" } },
      startDate: "2026-02-05",
      reminderDays: 2,
    },
    t0,
  );
  finRecurringStore.generateDue(t0, "2026-02-20");
  // …and a second one that is PAUSED (ADR-074). It sorts after „Netflix" under
  // sr-Latn, so it never disturbs the cursor assertion on the first. A pause is
  // the one field whose loss in transit would make the restored profile start
  // charging somebody again, so the round trip has to carry a paused row.
  const pausedSubscription = finRecurringStore.create(
    {
      accountId: finAccount.id,
      name: `${name} Teretana`,
      amount: -30_00,
      recurrence: { freq: { kind: "monthly-date", interval: 1, day: 8 }, end: { kind: "never" } },
      startDate: "2026-02-08",
      reminderDays: null,
    },
    t0,
  );
  finRecurringStore.pause(pausedSubscription.id, "2026-02-25T10:00:00.000Z");

  // HABIT (migration 055): both schedule kinds, both target shapes, one habit
  // ARCHIVED, and real days ticked on each — a streak is derived from those days
  // and nothing else, so a round trip that dropped them would restore a profile
  // whose every run silently reads zero.
  const binaryHabit = habitStore.create(
    { name: `${name} teretana`, color: "maslina", schedule: { kind: "days", weekdays: [1, 3, 5] }, reminderTime: "07:30" },
    t0,
  );
  const countedHabit = habitStore.create(
    { name: `${name} voda`, schedule: { kind: "quota", perWeek: 5 }, target: 8, unit: "čaša" },
    t0,
  );
  // Archived, not deleted: the two facts are independent columns (migration
  // 055), so a restore that folded them together would fail here.
  const archivedHabit = habitStore.create(
    { name: `${name} čitanje`, color: "zlato", schedule: { kind: "days", weekdays: [1, 2, 3, 4, 5, 6, 7] } },
    t0,
  );
  habitStore.archive(archivedHabit.id, t2);
  habitStore.setEntry(binaryHabit.id, "2026-06-01", 1, t1);
  habitStore.setEntry(binaryHabit.id, "2026-06-03", 1, t1);
  habitStore.setEntry(countedHabit.id, "2026-06-02", 8, t1);
  habitStore.setEntry(archivedHabit.id, "2026-06-02", 1, t1);

  // FIT (migration 058): one user food, two logged items — one naming that food
  // and one naming the app's CATALOGUE, which is not in the archive at all — and
  // a calorie-only goal.
  //
  // The catalogue-referencing item is the round trip's real subject: it survives
  // because it carries its own label and snapshot, and a restore that tried to
  // resolve `food_ref` against a table would have nothing to resolve it to.
  const fitFood = fitFoodStore.create(
    {
      name: `${name} ajvar`,
      category: "povrce",
      per100g: { kcal: 120, protein: 1.5, carbs: 9, fat: 8.5, fiber: 2.5, sugar: 5, sodiumMg: 480 },
      servings: [{ label: "1 kašika", grams: 15 }],
      notes: "Domaći.",
    },
    t0,
  );
  fitMealStore.addItem(
    {
      date: "2026-06-01",
      slot: "rucak",
      foodRef: "catalogue:pilece-belo-meso-peceno",
      label: "Pileće belo meso, pečeno",
      grams: 187.5,
      per100g: { kcal: 165, protein: 31, carbs: 0, fat: 3.57, fiber: 0, sugar: 0, sodiumMg: 74 },
    },
    t1,
  );
  fitMealStore.addItem(
    {
      date: "2026-06-01",
      slot: "vecera",
      foodRef: `user:${fitFood.id}`,
      label: fitFood.name,
      grams: 30,
      per100g: fitFood.per100g,
    },
    t1,
  );
  // A calorie goal and nothing else — three nulls beside it, so a restore that
  // read NULL as 0 (or 0 as NULL) would fail the round trip.
  fitTargetStore.save({ kcal: 2200, proteinG: null, carbsG: null, fatG: null }, t2);

  // FIT training & body (migration 060): a user exercise, a routine with two
  // items (one targeted, one open-ended — "as many sets as it takes" is a real
  // prescription), a FINISHED session started from that routine with two logged
  // sets (one naming the app's CATALOGUE, which is not in the archive at all,
  // exactly as the meal item above), a full body-weight reading and the body
  // facts row. The catalogue-referencing set is this slice's own real subject,
  // on `fitMealItems`' precedent: it survives on its own snapshotted
  // `metric`/`primaryMuscles` and label, with nothing for a restore to resolve.
  const fitExercise = fitExerciseStore.create(
    {
      name: `${name} zgib`,
      nameEn: "Pull-up variation",
      primaryMuscles: ["latovi", "biceps"],
      secondaryMuscles: ["podlaktica"],
      equipment: "sopstvena-tezina",
      pattern: "vertikalno-privlacenje",
      metric: "reps",
      notes: "Uža hvat.",
    },
    t0,
  );
  const fitRoutine = fitRoutineStore.create(
    {
      name: `${name} povuci dan`,
      notes: "Leđa i biceps.",
      items: [
        { exerciseRef: "catalogue:zgibovi", label: "Zgibovi", targetSets: 4, targetRepsMin: 6, targetRepsMax: 10 },
        { exerciseRef: `user:${fitExercise.id}`, label: fitExercise.name },
      ],
    },
    t0,
  );
  const startedWorkout = fitWorkoutStore.start(
    { day: "2026-01-01", routineRef: fitRoutine.id, routineLabel: fitRoutine.name },
    t1,
  );
  fitWorkoutStore.logSet(
    startedWorkout.id,
    { exerciseRef: "catalogue:zgibovi", label: "Zgibovi", metric: "reps", primaryMuscles: ["latovi", "biceps"], kind: "working", reps: 10 },
    t1,
  );
  fitWorkoutStore.logSet(
    startedWorkout.id,
    {
      exerciseRef: `user:${fitExercise.id}`, label: fitExercise.name, metric: "weighted_reps",
      primaryMuscles: ["latovi", "biceps", "podlaktica"], kind: "drop", weightKg: 10, reps: 6,
    },
    t1,
  );
  fitWorkoutStore.finish(startedWorkout.id, t2);
  // A FULL reading — every optional field present, so the round trip proves the
  // whole nested shape (`muscle`, all six `circumferences` sites) survives.
  fitMeasurementStore.save(
    {
      day: "2026-01-01", weightKg: 82.4, bodyFatPercent: 18.5,
      muscle: { unit: "percent", value: 44.2 }, waterPercent: 55,
      circumferences: { neck: 40, chest: 105, upperArm: 36, waist: 88, hip: 100, thigh: 58 },
    },
    t2,
  );
  fitBodyProfileStore.save(
    { sex: "male", birthDate: "1996-03-14", heightCm: 181, activity: "moderate" },
    t0,
  );

  // CANV (migration 059): a board with something drawn on it AND an embedded
  // image, which is the round trip's real subject here — the image lives inside
  // the scene's own `files` rather than in `blobs/`, so a restore that lifted it
  // out or dropped it would fail below rather than quietly ship a blank frame.
  canvasStore.create(
    {
      name: `${name} šema`,
      scene: JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "nexus",
        elements: [
          { id: "el-rect", type: "rectangle", x: 10, y: 20, width: 100, height: 60 },
          { id: "el-img", type: "image", fileId: "file-1", x: 0, y: 0 },
        ],
        appState: { gridSize: 20 },
        files: { "file-1": { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" } },
      }),
    },
    t1,
  );

  // ELEC (migrations 067, 068): a circuit with a machine, three parts and a
  // wire between two of them — four tables whose references only work if the
  // restore writes them in order, so a round trip that ended with a
  // foreign-key failure would say so here rather than the first time a user
  // restored a backup. `R1` carries a value the board does not and the ranger
  // carries a mount neither of them does, which are the two nullable columns.
  const circuit = electronicsStore.createCircuit({ name: `${name} kolo`, notes: "5 V" }, t1);
  const board = electronicsStore.addPart(
    circuit.id,
    { componentId: "arduino-uno", label: "", x: 0, y: 0, rotation: 0 },
    t1,
  );
  const resistor = electronicsStore.addPart(
    circuit.id,
    { componentId: "resistor", label: "R1", x: 180, y: 40, rotation: 90, value: 220 },
    t1,
  );
  electronicsStore.addWire(
    circuit.id,
    { from: { partId: board.id, pinId: "D9" }, to: { partId: resistor.id, pinId: "1" }, colour: "yellow" },
    t1,
  );

  // Migration 068's half of the same round trip: a sensor bolted to a face of
  // the machine, and the machine itself — the one row a restore writes with no
  // id of its own, keyed on the circuit that owns it.
  electronicsStore.addPart(
    circuit.id,
    { componentId: "vl53l0x", label: "Daljinar", x: -60, y: 120, rotation: 180, mount: "front" },
    t1,
  );
  electronicsStore.setChassis(
    circuit.id,
    {
      shape: "diff-rover",
      bodyLength: 20, bodyWidth: 14, bodyHeight: 6,
      wheelRadius: 3.2, wheelWidth: 2.5, wheelTrack: 16, wheelBase: 12,
      bodyMass: 900, wheelMass: 40,
    },
    t1,
  );

  const session = focusStore.create(
    { subjectId: subject.id, startedAt: "2026-01-01T09:00:00.000Z", endedAt: "2026-01-01T09:30:00.000Z" },
    "2026-01-01T09:31:00.000Z",
  );

  const notification = notificationStore.recordDelivered(
    { source: "exam", entityId: exam.id, occurrenceKey: `${name}-occ`, title: "Reminder", body: "Body text" },
    "2026-01-01T08:00:00.000Z",
  );

  const folder = orgStore.createFolder({ parentId: null, name: `${name} folder`, color: "zlato" }, t0);
  const tag = orgStore.createTag(`${name} tag`, t0);
  // NOTE-002's third axis, coloured so a restore that dropped the swatch would
  // fail here rather than quietly.
  const category = orgStore.createCategory({ name: `${name} kategorija`, color: "bordo" }, t0);

  const editedNote = noteStore.create(t0);
  noteStore.setFolder(editedNote.id, folder.id);
  noteStore.setCategory(editedNote.id, category.id);
  noteStore.appendUpdate(editedNote.id, bytes(8), `${name} note`, t1);
  orgStore.attachTag(editedNote.id, tag.id);
  attachmentStore.add(
    editedNote.id,
    { fileName: "a.png", mime: "image/png", sizeBytes: 10, sha256: "a".repeat(64) },
    t2,
  );
  noteStore.captureVersion(editedNote.id, bytes(8, 1), 1, t3);
  // Compacted for real, so this profile genuinely HOLDS the snapshot the
  // gathered `ProfileData` below claims it does. Without this the fixture
  // would describe a note whose stored snapshot is null, and every assertion
  // about an *untouched* profile would be comparing against a snapshot that
  // only ever existed in the test's imagination.
  noteStore.compact(editedNote.id, editedSnapshot, editedPlaintext, 1, t3);

  // The edited note filed under the subject (migration 035): a cross-MODULE
  // edge, so a restore that wrote the two modules independently would drop it.
  subjectNoteLinkStore.linkNote(subject.id, editedNote.id, t3);

  const neverEditedNote = noteStore.create("2026-01-01T00:04:00.000Z");

  const template = templateStore.save(
    `${name} template`,
    JSON.stringify({ type: "doc", content: [] }),
    "2026-01-01T00:05:00.000Z",
  );

  // ADR-036: the folder carries BOTH preferences, so the round trip below
  // proves migration 028's two columns survive a full export/restore cycle
  // rather than silently defaulting back on the way in.
  orgStore.setDefaultTemplate(folder.id, template.id, "2026-01-01T00:06:00.000Z");
  orgStore.setCaptureDefault(folder.id, "2026-01-01T00:06:00.000Z");
  // A dashboard background sharing the attachment's hash on purpose (ADR-041):
  // one blob, two rows naming it, so the restore round trip proves the settings
  // row travels AND that the shared blob is not double-counted.
  dashboardStore.setBackground("a".repeat(64), "image/png", 10, t2);
  dashboardStore.setDim(65, t2);
  // ADR-045: a REARRANGED dashboard, so the round trip carries real layout rows
  // rather than the get-or-default emptiness a untouched profile would give.
  // Adding one widget materializes the default five beside it.
  dashboardWidgetStore.add(null, "study:ispiti", "L", t2);
  // ADR-055: a NAMED board, active and with its own arranged layout, so the
  // round trip carries a set row, per-set widget rows AND the active pointer.
  const dashboardSet = dashboardSetStore.create(`${name} tabla`, t2);
  dashboardWidgetStore.add(dashboardSet.id, "tasks:predstojece", "S", t2);
  dashboardSetStore.setActive(dashboardSet.id, t2);
  // STUDY-007: NON-default on all three, so the round trip below would fail if
  // the settings row were dropped rather than passing on the defaults.
  studySettingsStore.save({ targetRetention: 0.95, newPerDay: 7, maxReviewsPerDay: 120 }, t2);
  // ADR-054: a SET term, so the round trip below would fail if the row were
  // dropped rather than passing on the both-null default.
  calendarSettingsStore.save({ semesterStart: "2026-10-01", semesterEnd: "2027-01-31" });

  const taskLists = taskListStore.listActive();
  const electronics = electronicsStore.listAllForExport();
  const data: ProfileData = {
    tasks: taskStore.listActive(),
    taskLists,
    taskSections: taskLists.flatMap((row) => taskListStore.listSections(row.id)),
    taskTags: taskTagStore.listTags(),
    taskTagLinks: taskTagStore.listTagLinks(),
    taskAttachments: taskAttachmentStore.list(parentTask.id),
    taskTemplates: taskTemplateStore.list(),
    taskDependencies: taskDependencyStore.listLinks(),
    events: eventStore.listActive(),
    eventTemplates: eventTemplateStore.list(),
    documents: documentStore.listActive(),
    renewals: documentStore.listRenewals(document.id),
    people: peopleStore.listActive(),
    subjects: subjectStore.listActive(),
    subjectAttachments: subjectAttachmentStore.list(subject.id),
    subjectNoteLinks: subjectNoteLinkStore.listLinks(),
    exams: examStore.listActive(),
    decks: deckStore.listActive(),
    cards: cardStore.listByDeck(deck.id),
    reviewLog: cardStore.listReviewLog(),
    // The store speaks `rank`; the interchange spells the column (`sortOrder`)
    // — the same mapping `gatherProfileData` makes.
    examTopics: topicStore.listAll().map(({ rank, ...topic }) => ({ ...topic, sortOrder: rank })),
    plans: planStore.listActive(),
    blocks: planStore.listBlocks(plan.id),
    focusSessions: focusStore.listActive(),
    notifications: notificationStore.listAll(),
    notes: noteStore.list().map((meta) => ({
      ...meta,
      snapshot: meta.id === editedNote.id ? editedSnapshot : null,
    })),
    noteFolders: orgStore.listFolders(),
    noteTags: orgStore.listTags(),
    noteCategories: orgStore.listCategories(),
    noteTagLinks: orgStore.listTagLinks(),
    noteTemplates: templateStore.list(),
    noteAttachments: attachmentStore.list(editedNote.id),
    noteVersions: noteStore.listVersions(editedNote.id).map((version) => ({
      noteId: editedNote.id,
      coveredSeq: version.coveredSeq,
      title: version.title,
      createdAt: version.createdAt,
      snapshot: noteStore.loadVersion(editedNote.id, version.coveredSeq),
    })),
    studySettings: [{ profileId, ...studySettingsStore.get() }],
    calendarSettings: [{ profileId, ...calendarSettingsStore.get() }],
    dashboardSettings: [{ profileId, ...dashboardStore.get() }],
    dashboardSets: dashboardSetStore.list(),
    dashboardWidgets: dashboardWidgetStore.listAll(),
    finAccounts: finAccountStore.listActive(),
    finCategories: finCategoryStore.list(),
    finRecurring: finRecurringStore.listActive(),
    finTransactions: finTransactionStore.listActive(),
    finBudgets: finCategoryStore.listBudgets(),
    habits: habitStore.listActive(),
    habitEntries: habitStore.listAllEntries({ from: "2026-01-01", to: "2026-12-31" }),
    fitFoods: fitFoodStore.list(),
    // `listAll`, exactly as `gatherFitness` reads it — a hand-built order here
    // could disagree with the store's and turn a real round-trip mismatch into
    // a puzzle about which list was wrong.
    fitMealItems: fitMealStore.listAll(),
    fitTargets: fitTargetRows(profileId, fitTargetStore),
    fitExercises: fitExerciseStore.list(),
    fitRoutines: fitRoutineRows(fitRoutineStore),
    fitRoutineItems: fitRoutineItemRows(fitRoutineStore),
    fitWorkouts: fitWorkoutRows(fitWorkoutStore),
    fitWorkoutSets: fitWorkoutSetRows(profileId, fitWorkoutStore),
    fitMeasurements: fitMeasurementRows(profileId, fitMeasurementStore),
    fitBodyProfile: fitBodyProfileRows(profileId, fitBodyProfileStore),
    canvasBoards: canvasBoardRows(canvasStore),
    circuits: electronics.circuits,
    circuitChassis: electronics.chassis,
    circuitParts: electronics.parts,
    circuitWires: electronics.wires,
    // The kit's section (ADR-090): this store writes no module's payload, so the
    // fixture carries none — `main/restore.ts` applies it through
    // `restoreModuleData` after the replace, which is where the desktop tests
    // cover it.
    modules: [],
  };

  const derived = new Map<string, RestoredNoteDerived>([
    [editedNote.id, { plaintext: editedPlaintext, linkTargets: [] }],
  ]);

  return {
    data,
    derived,
    ids: {
      parentTask,
      childTask,
      list,
      section,
      taskTag,
      event,
      person,
      document,
      subject,
      exam,
      deck,
      card: createdCard,
      plan,
      session,
      notification,
      folder,
      tag,
      editedNote,
      neverEditedNote,
      template,
      taskTemplate,
      eventTemplate,
    },
  };
}

function stripDocumentDerived(
  document: TrackedDocument,
): Omit<TrackedDocument, "status" | "daysUntilExpiry"> {
  const { status: _status, daysUntilExpiry: _days, ...rest } = document;
  return rest;
}

/**
 * A small archive built from scratch with brand-new ids — "somebody else's
 * backup". Used wherever a test must restore into a database that already
 * holds other rows: reusing a seeded fixture's ids there would collide on the
 * global primary keys rather than test what the case is about.
 */
function freshArchiveData(): ProfileData {
  const timestamps = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  const listId = uuidv7();
  return {
    ...emptyProfileData(),
    taskLists: [
      {
        id: listId, profileId: "ignored", parentId: null, name: "Inbox", isInbox: true,
        defaultView: "list", viewConfig: null, rank: FIRST_RANK, ...timestamps,
      },
    ],
    tasks: [
      {
        id: uuidv7(), profileId: "ignored", parentId: null, title: "Fresh task", description: null,
        status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
        completedAt: null, recurrence: null, reminderOffsets: [],
        listId, sectionId: null, rank: FIRST_RANK, ...timestamps,
      },
    ],
    subjects: [
      {
        id: uuidv7(), profileId: "ignored", name: "Fresh subject", color: "jade", semester: null,
        archived: false, ...timestamps,
      },
    ],
    noteTemplates: [
      {
        id: uuidv7(), profileId: "ignored", name: "Fresh template",
        content: JSON.stringify({ type: "doc", content: [] }), ...timestamps,
      },
    ],
    taskTemplates: [
      {
        id: uuidv7(), profileId: "ignored", name: "Fresh task template", ...timestamps,
        payload: {
          title: "Fresh", description: null, priority: "none", dueOffsetDays: null,
          reminderOffsets: [], recurrence: null, tagNames: [], subtaskTitles: [],
        },
      },
    ],
    eventTemplates: [
      {
        id: uuidv7(), profileId: "ignored", name: "Fresh event template", ...timestamps,
        payload: {
          title: "Fresh", allDay: false, startTime: "18:30", durationMinutes: 90,
          location: null, description: null, category: null,
          reminderOffsets: [], recurrence: null,
        },
      },
    ],
  };
}

/** `expect` against a profile's own id — the shape every "nothing else changed" assertion below takes. */
function withProfile<T extends { profileId: string }>(rows: readonly T[], profileId: string): T[] {
  return rows.map((row) => ({ ...row, profileId }));
}

/**
 * Re-reads every module from `readProfileId` through the same store classes
 * `seedFixture` used, and asserts it matches `fixture.data` with `profileId`
 * remapped to `remapTo` — `remapTo === readProfileId` proves an untouched
 * profile (T10); `remapTo` pointing at a different profile than the one that
 * originally produced `fixture` proves a faithful restore (T1).
 */
function assertModulesMatch(
  handle: NexusDatabase,
  readProfileId: string,
  fixture: Fixture,
  remapTo: string,
): void {
  const remap = <T extends { profileId: string }>(rows: readonly T[]): T[] =>
    rows.map((row) => ({ ...row, profileId: remapTo }));

  expect(new TaskStore(handle.raw, readProfileId).listActive()).toEqual(remap(fixture.data.tasks));
  const listsRead = new TaskListStore(handle.raw, readProfileId);
  expect(listsRead.listActive()).toEqual(remap(fixture.data.taskLists));
  expect(listsRead.listActive().flatMap((row) => listsRead.listSections(row.id))).toEqual(
    fixture.data.taskSections,
  );
  const tagsRead = new TaskTagStore(handle.raw, readProfileId);
  expect(tagsRead.listTags()).toEqual(remap(fixture.data.taskTags));
  expect(tagsRead.listTagLinks()).toEqual(fixture.data.taskTagLinks);
  expect(
    new TaskAttachmentStore(handle.raw, readProfileId).list(fixture.ids.parentTask.id),
  ).toEqual(fixture.data.taskAttachments);
  // Read back through the store, which re-parses the JSON column: a payload the
  // restore wrote in some other shape would fail here rather than silently
  // become a template the user never saved.
  expect(new TaskTemplateStore(handle.raw, readProfileId).list()).toEqual(
    remap(fixture.data.taskTemplates),
  );
  // No `remap`: an edge is a pair of TASK ids, and task ids are preserved
  // verbatim by a restore — only `profileId` fields are retargeted.
  expect(new TaskDependencyStore(handle.raw, readProfileId).listLinks()).toEqual(
    fixture.data.taskDependencies,
  );
  expect(new EventStore(handle.raw, readProfileId).listActive()).toEqual(remap(fixture.data.events));
  // Read back through the store, which re-parses the JSON column — the same
  // reason the task-template assertion above goes through its own store.
  expect(new EventTemplateStore(handle.raw, readProfileId).list()).toEqual(
    remap(fixture.data.eventTemplates),
  );
  expect(new PeopleStore(handle.raw, readProfileId).listActive()).toEqual(remap(fixture.data.people));
  // Stripped on BOTH sides: `seedFixture` gathers documents through
  // `listActive()`, so at runtime `fixture.data.documents` carries the derived
  // `status`/`daysUntilExpiry` that `ExportDocument` does not declare and that
  // no column stores.
  expect(new DocumentStore(handle.raw, readProfileId).listActive().map(stripDocumentDerived)).toEqual(
    remap(fixture.data.documents.map((row) => stripDocumentDerived(row as TrackedDocument))),
  );
  expect(new DocumentStore(handle.raw, readProfileId).listRenewals(fixture.ids.document.id)).toEqual(
    fixture.data.renewals,
  );
  expect(new SubjectStore(handle.raw, readProfileId).listActive()).toEqual(remap(fixture.data.subjects));
  expect(new ExamStore(handle.raw, readProfileId).listActive()).toEqual(remap(fixture.data.exams));
  expect(new DeckStore(handle.raw, readProfileId).listActive()).toEqual(remap(fixture.data.decks));
  expect(new CardStore(handle.raw, readProfileId).listByDeck(fixture.ids.deck.id)).toEqual(
    remap(fixture.data.cards),
  );
  expect(new CardStore(handle.raw, readProfileId).listReviewLog()).toEqual(remap(fixture.data.reviewLog));
  expect(
    new TopicStore(handle.raw, readProfileId)
      .listAll()
      .map(({ rank, ...topic }) => ({ ...topic, sortOrder: rank })),
  ).toEqual(remap(fixture.data.examTopics));
  expect(new PlanStore(handle.raw, readProfileId).listActive()).toEqual(remap(fixture.data.plans));
  expect(new PlanStore(handle.raw, readProfileId).listBlocks(fixture.ids.plan.id)).toEqual(
    remap(fixture.data.blocks),
  );
  expect(new FocusStore(handle.raw, readProfileId).listActive()).toEqual(remap(fixture.data.focusSessions));
  expect(new NotificationStore(handle.raw, readProfileId).listAll()).toEqual(
    remap(fixture.data.notifications),
  );
  expect(new NoteOrgStore(handle.raw, readProfileId).listFolders()).toEqual(remap(fixture.data.noteFolders));
  expect(new NoteOrgStore(handle.raw, readProfileId).listTags()).toEqual(remap(fixture.data.noteTags));
  expect(new NoteOrgStore(handle.raw, readProfileId).listCategories()).toEqual(
    remap(fixture.data.noteCategories),
  );
  expect(new NoteOrgStore(handle.raw, readProfileId).listTagLinks()).toEqual(fixture.data.noteTagLinks);
  expect(new NoteTemplateStore(handle.raw, readProfileId).list()).toEqual(remap(fixture.data.noteTemplates));
  expect(new NoteAttachmentStore(handle.raw, readProfileId).list(fixture.ids.editedNote.id)).toEqual(
    fixture.data.noteAttachments,
  );

  const notesRead = new NoteStore(handle.raw, readProfileId);
  const expectedMetas = fixture.data.notes.map(({ snapshot: _snapshot, ...meta }) => ({
    ...meta,
    profileId: remapTo,
  }));
  expect(notesRead.list()).toEqual(expectedMetas);

  for (const version of fixture.data.noteVersions) {
    expect(notesRead.loadVersion(version.noteId, version.coveredSeq)).toEqual(version.snapshot);
  }
  expect(notesRead.listVersions(fixture.ids.editedNote.id).map((v) => v.coveredSeq)).toEqual(
    fixture.data.noteVersions.map((v) => v.coveredSeq),
  );

  // Unconditional on purpose. `seedFixture` always compacts the edited note, so
  // guarding these on "if the fixture happens to carry a snapshot" would only
  // let the file's strongest two assertions quietly skip themselves the day
  // that stops being true.
  const editedExpected = fixture.data.notes.find((note) => note.id === fixture.ids.editedNote.id);
  expect(editedExpected?.snapshot).toBeInstanceOf(Uint8Array);
  expect(notesRead.load(fixture.ids.editedNote.id).snapshot).toEqual(editedExpected?.snapshot);
  // The plaintext beside it is what migration 017's note projection indexes, so
  // a restore that reproduced the bytes but lost this would leave a note that
  // is present everywhere except search.
  expect(notesRead.storedPlaintext(fixture.ids.editedNote.id)).toBe(
    fixture.derived.get(fixture.ids.editedNote.id)?.plaintext,
  );

  // STUDY-007: the retention and both daily caps, remapped onto the reading
  // profile exactly as every row below is.
  expect(
    [{ profileId: remapTo, ...new StudySettingsStore(handle.raw, readProfileId).get() }],
  ).toEqual(remap(fixture.data.studySettings));

  // ADR-054: the semester's fixed dates, remapped onto the reading profile
  // exactly as every row around them is.
  expect(
    [{ profileId: remapTo, ...new CalendarSettingsStore(handle.raw, readProfileId).get() }],
  ).toEqual(remap(fixture.data.calendarSettings));

  // ADR-041: the dashboard's background and dim, remapped onto the reading
  // profile exactly as every row above is.
  expect(
    [{ profileId: remapTo, ...new DashboardSettingsStore(handle.raw, readProfileId).get() }],
  ).toEqual(remap(fixture.data.dashboardSettings));

  // ADR-045: the layout too — every placement reproduced under its own instance
  // id, size, order and timestamps, retargeted onto the reading profile.
  expect(new DashboardWidgetStore(handle.raw, readProfileId).listAll()).toEqual(
    remap(fixture.data.dashboardWidgets),
  );

  // ADR-055: the named boards, reproduced under their own ids and timestamps —
  // and note the active pointer already rode in `dashboardSettings` above.
  expect(new DashboardSetStore(handle.raw, readProfileId).list()).toEqual(
    remap(fixture.data.dashboardSets),
  );

  // FIN (migration 051): the whole ledger, ids, currencies and INTEGER minor
  // units alike. The transfer among the transactions is the sharp assertion —
  // it comes back as the ONE row it left as, naming both accounts.
  const finAccountsRead = new FinAccountStore(handle.raw, readProfileId);
  expect(finAccountsRead.listActive()).toEqual(remap(fixture.data.finAccounts));
  const finCategoriesRead = new FinCategoryStore(handle.raw, readProfileId);
  expect(finCategoriesRead.list()).toEqual(remap(fixture.data.finCategories));
  expect(finCategoriesRead.listBudgets()).toEqual(remap(fixture.data.finBudgets));
  // FIN slice d (migration 053): the subscriptions come back with their rules in
  // canonical form AND their `nextRun` cursors where the archive left them — a
  // cursor reset to the start date would claim a charge already in this very
  // archive is still outstanding.
  const finRecurringRead = new FinRecurringStore(handle.raw, readProfileId).listActive();
  expect(finRecurringRead).toEqual(remap(fixture.data.finRecurring));
  expect(finRecurringRead[0]?.nextRun).toBe("2026-03-05");
  expect(finRecurringRead[0]?.pausedAt).toBeNull();
  // ADR-074: the paused one comes back paused — the restore reproduces the
  // decision rather than resuming the billing.
  expect(finRecurringRead[1]?.pausedAt).toBe("2026-02-25T10:00:00.000Z");
  const finTransactionsRead = new FinTransactionStore(handle.raw, readProfileId).listActive();
  expect(finTransactionsRead).toEqual(remap(fixture.data.finTransactions));
  expect(finTransactionsRead.filter((row) => row.counterAccountId !== null)).toHaveLength(1);
  // The generated charge is back as an ordinary row that still remembers what
  // made it — and it points at the SUBSCRIPTION this restore just wrote.
  expect(finTransactionsRead.filter((row) => row.recurringId !== null)).toHaveLength(1);
  // And the DERIVED balances agree with the reproduced rows — the strongest
  // statement available that nothing about the money was lost or rounded, since
  // no column stores them.
  // 1000,00 opening − 12,50 groceries − 11,90 the generated Netflix charge; the
  // transfer moves money between two of the profile's own accounts and so nets
  // to nothing across them.
  expect(finAccountsRead.totalsByCurrency()).toEqual([{ currency: "RSD", minorUnits: 975_60 }]);

  // HABIT (migration 055): both schedule kinds come back canonical, the archived
  // one comes back ARCHIVED rather than back in today's list, and every ticked
  // day comes back with it — the streak is derived from those days and nothing
  // else, so losing them would silently reset every run to zero.
  const habitsRead = new HabitStore(handle.raw, readProfileId);
  const restoredHabits = habitsRead.listActive();
  expect(restoredHabits).toEqual(remap(fixture.data.habits));
  expect(restoredHabits.filter((habit) => habit.archivedAt !== null)).toHaveLength(1);
  expect(restoredHabits.map((habit) => habit.schedule)).toEqual(
    expect.arrayContaining([
      { kind: "days", weekdays: [1, 3, 5] },
      { kind: "quota", perWeek: 5 },
    ]),
  );
  expect(habitsRead.listAllEntries({ from: "2026-01-01", to: "2026-12-31" })).toEqual(
    fixture.data.habitEntries,
  );

  // FIT training & body (migration 060): every one of the seven tables
  // `RESTORE_WIPE_TABLES` empties, proven to come back — the exercise, the
  // routine with its two items (parent read back before the child, on the
  // items' own stored position order), the finished workout with its two
  // logged sets, the full body-weight reading (`muscle`, all six
  // `circumferences` sites) and the body-facts row.
  expect(new FitExerciseStore(handle.raw, readProfileId).list()).toEqual(
    remap(fixture.data.fitExercises),
  );
  const restoredRoutines = new FitRoutineStore(handle.raw, readProfileId).list();
  expect(restoredRoutines.map(({ items: _items, ...routine }) => routine)).toEqual(
    remap(fixture.data.fitRoutines),
  );
  expect(restoredRoutines.flatMap((routine) => routine.items)).toEqual(
    remap(fixture.data.fitRoutineItems),
  );
  const restoredWorkouts = new FitWorkoutStore(handle.raw, readProfileId).listRange(
    FIT_TRAINING_MIN_DAY,
    FIT_TRAINING_MAX_DAY,
  );
  expect(restoredWorkouts.map(({ sets: _sets, ...workout }) => workout)).toEqual(
    remap(fixture.data.fitWorkouts),
  );
  expect(
    restoredWorkouts.flatMap((workout) =>
      workout.sets.map((set) => ({ ...set, profileId: remapTo })),
    ),
  ).toEqual(remap(fixture.data.fitWorkoutSets));
  expect(
    new FitMeasurementStore(handle.raw, readProfileId)
      .listRange(FIT_TRAINING_MIN_DAY, FIT_TRAINING_MAX_DAY)
      .map((measurement) => ({ ...measurement, profileId: remapTo })),
  ).toEqual(remap(fixture.data.fitMeasurements));
  const restoredBodyProfile = new FitBodyProfileStore(handle.raw, readProfileId).get();
  expect(
    restoredBodyProfile === null ? [] : [{ profileId: remapTo, ...restoredBodyProfile }],
  ).toEqual(remap(fixture.data.fitBodyProfile));

  // ELEC (migrations 067, 068), through the store's own export read — the only
  // thing that reads all four tables at once, so this is the assertion that a
  // restored circuit comes back WHOLE. Four things it catches that nothing else
  // would: a machine written under no circuit, a mount dropped on the way
  // through, a part whose `value` came back as a null it never was, and a wire
  // whose ends stopped pointing at real parts.
  const elecRead = new ElectronicsStore(handle.raw, readProfileId).listAllForExport();
  expect(elecRead.circuits).toEqual(remap(fixture.data.circuits));
  // No `remap`: a machine has no profile of its own — it reaches one through
  // the circuit, which is the whole reason `circuit_id` is its primary key.
  expect(elecRead.chassis).toEqual(fixture.data.circuitChassis);
  expect(elecRead.parts).toEqual(fixture.data.circuitParts);
  expect(elecRead.wires).toEqual(fixture.data.circuitWires);
}

describe("RestoreStore", () => {
  it("T1: fresh-install round trip — every module reproduced in a new database, ids/timestamps preserved, profile_id retargeted", () => {
    const profileA = createProfile(db, "A");
    const fixtureA = seedFixture(db, profileA, "A");
    // A genuinely fresh install: its own database file, its own profile id.
    // This is PRD 14 §8's criterion verbatim, and the only faithful shape for
    // it — see `freshDb`'s comment on why an archive cannot land beside the
    // profile it came from.
    const profileB = createProfile(freshDb, "B-target");

    const settings: ExportSettings = {
      flags: { notes: true, tasks: false },
      notifications: {
        quietFrom: "22:00",
        quietTo: "07:00",
        morningHour: "08:30",
        enabledSources: ["document", "exam"],
        snoozeDefault: "10m",
      },
    };

    const written = new RestoreStore(freshDb.raw, profileB).replaceProfileData(
      { profileName: "Restored profile", profilePicture: null, settings, data: fixtureA.data, derived: fixtureA.derived },
      NOW,
    );
    expect(written).toBeGreaterThan(0);

    assertModulesMatch(freshDb, profileB, fixtureA, profileB);

    const profileRow = freshDb.raw.prepare("SELECT name FROM profiles WHERE id = ?").get(profileB) as {
      name: string;
    };
    expect(profileRow.name).toBe("Restored profile");
  });

  it("T1b: restores a profile's own archive back over itself — the common case, where every id already exists", () => {
    const profileA = createProfile(db, "A");
    const fixtureA = seedFixture(db, profileA, "A");
    // The week of work the user wants to undo by restoring last week's backup.
    new TaskStore(db.raw, profileA).create({ title: "Added after the backup was taken" });

    new RestoreStore(db.raw, profileA).replaceProfileData(
      { profileName: "A", profilePicture: null, settings: emptySettings(), data: fixtureA.data, derived: fixtureA.derived },
      NOW,
    );

    // Every id in the archive already existed in this profile a moment ago; the
    // wipe running first inside the same transaction is what makes reinserting
    // them work rather than collide.
    assertModulesMatch(db, profileA, fixtureA, profileA);
    expect(new TaskStore(db.raw, profileA).listActive().map((task) => task.title)).not.toContain(
      "Added after the backup was taken",
    );
  });

  it("T1c: an archive with no tasks and no lists still restores a profile WITH an Inbox", () => {
    // The case a tasks-excluded subset export (IMEX-003) always produces, and a
    // pre-1.3.0 archive with zero tasks always was: the wipe removes every list
    // including the Inbox, and nothing in the data brings one back. A profile
    // without an Inbox is one where quick-add and the palette throw — so the
    // restore must leave one standing, minted fresh when the archive carries
    // none.
    const profileB = createProfile(db, "B");
    seedFixture(db, profileB, "Old");

    new RestoreStore(db.raw, profileB).replaceProfileData(
      {
        profileName: "B prazan", profilePicture: null,
        settings: emptySettings(),
        data: emptyProfileData(),
        derived: new Map(),
      },
      NOW,
    );

    const lists = new TaskListStore(db.raw, profileB).listActive();
    expect(lists.filter((list) => list.isInbox)).toHaveLength(1);
    // And it is usable: a task created with no list named lands in it.
    const task = new TaskStore(db.raw, profileB).create({ title: "Posle vraćanja" });
    expect(task.listId).toBe(lists.find((list) => list.isInbox)?.id);
  });

  it("T2: totality of replacement — old rows gone, new rows exact, every module the archive omits ends up empty", () => {
    const profileB = createProfile(db, "B");
    seedFixture(db, profileB, "Old"); // B starts with live rows in every module.
    const fresh = freshArchiveData(); // tasks, subjects and templates only

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "B replaced", profilePicture: null, settings: emptySettings(), data: fresh, derived: new Map() },
      NOW,
    );

    // Exactly the archive's rows, and nothing B held before.
    expect(new TaskStore(db.raw, profileB).listActive()).toEqual(withProfile(fresh.tasks, profileB));
    expect(new SubjectStore(db.raw, profileB).listActive()).toEqual(
      withProfile(fresh.subjects, profileB),
    );
    expect(new NoteTemplateStore(db.raw, profileB).list()).toEqual(
      withProfile(fresh.noteTemplates, profileB),
    );
    expect(new TaskTemplateStore(db.raw, profileB).list()).toEqual(
      withProfile(fresh.taskTemplates, profileB),
    );

    // Every module the archive carried zero rows for is empty, though B had one in each.
    expect(new EventStore(db.raw, profileB).listActive()).toEqual([]);
    expect(new PeopleStore(db.raw, profileB).listActive()).toEqual([]);
    expect(new DocumentStore(db.raw, profileB).listActive()).toEqual([]);
    expect(new ExamStore(db.raw, profileB).listActive()).toEqual([]);
    expect(new DeckStore(db.raw, profileB).listActive()).toEqual([]);
    expect(new CardStore(db.raw, profileB).listReviewLog()).toEqual([]);
    expect(new PlanStore(db.raw, profileB).listActive()).toEqual([]);
    expect(new FocusStore(db.raw, profileB).listActive()).toEqual([]);
    expect(new NotificationStore(db.raw, profileB).listAll()).toEqual([]);
    expect(new NoteStore(db.raw, profileB).list()).toEqual([]);
    expect(new NoteOrgStore(db.raw, profileB).listFolders()).toEqual([]);
    expect(new NoteOrgStore(db.raw, profileB).listTags()).toEqual([]);
    expect(new TaskTagStore(db.raw, profileB).listTags()).toEqual([]);
    // The ranked curriculum goes with the rest of the STUDY module (ADR-063).
    expect(new TopicStore(db.raw, profileB).listAll()).toEqual([]);
    // An archive carrying no study-settings row puts the profile back on the
    // scheduler's own defaults (STUDY-007) — B's chosen retention and caps are
    // gone, not merely unreferenced.
    expect(new StudySettingsStore(db.raw, profileB).get()).toEqual({
      targetRetention: DEFAULT_TARGET_RETENTION,
      newPerDay: DEFAULT_NEW_PER_DAY,
      maxReviewsPerDay: null,
    });
    // An archive carrying no calendar-settings row puts the profile back on
    // "no term set" (ADR-054) — the semester dates B had are gone, and the
    // Semestar view slides again.
    expect(new CalendarSettingsStore(db.raw, profileB).get()).toEqual({
      semesterStart: null,
      semesterEnd: null,
    });
    // An archive carrying no dashboard row puts the profile back on the
    // dashboard's own defaults (ADR-041) — the background B had is gone, not
    // merely unreferenced.
    expect(new DashboardSettingsStore(db.raw, profileB).get()).toEqual({
      backgroundHash: null,
      backgroundMime: null,
      backgroundSizeBytes: null,
      backgroundDim: DEFAULT_BACKGROUND_DIM,
      activeSetId: null,
    });
    // And the same for the layout (ADR-045): B's rearranged dashboard is wiped,
    // which leaves no rows — and no rows IS the default arrangement, so B opens
    // on exactly what the archive's own profile had. B's named boards (ADR-055)
    // go the same way: sets are arrangement, and an archive carrying none
    // leaves only „Početna“, which is not a row.
    expect(
      (db.raw
        .prepare("SELECT count(*) AS n FROM dashboard_widgets WHERE profile_id = ?")
        .get(profileB) as { n: number }).n,
    ).toBe(0);
    expect(new DashboardWidgetStore(db.raw, profileB).listLayout(null).map((e) => e.widgetId)).toEqual(
      DEFAULT_DASHBOARD_LAYOUT.map((e) => e.widgetId),
    );
    expect(new DashboardSetStore(db.raw, profileB).list()).toEqual([]);

    // Including the child tables no store lists on its own — the ones a wipe
    // that leaned on ON DELETE CASCADE would be most likely to miss.
    for (const table of [
      "document_renewals",
      "task_sections",
      "task_tag_links",
      "task_attachments",
      "task_dependencies",
      "subject_attachments",
      "subject_note_links",
      "note_versions",
      "note_attachments",
      "note_tag_links",
    ]) {
      const { n } = db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      expect({ table, n }).toEqual({ table, n: 0 });
    }
  });

  it("T3: RESTORE_WIPE_TABLES accounts for every table except the documented exemptions", () => {
    const tables = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    ).map((row) => row.name);

    // Exempt from RESTORE_WIPE_TABLES, and why a restore must never touch them:
    //  - meta: global schema version + auth key material, not per-profile data.
    //  - profiles: the restore renames the row in place (UPDATE); it never
    //    deletes/reinserts the profile itself.
    //  - search_entries / search_fts and its FTS5 shadow tables: maintained
    //    ENTIRELY by migration 017's triggers off the source tables above —
    //    RestoreStore never writes to them directly (R11).
    //  - backup_settings (migration 044 / ADR-056): deliberately DEVICE-LOCAL,
    //    excluded from the export archive and from the wipe alike. An absolute
    //    folder path is meaningless on another machine, the passphrase wrap
    //    opens only under this account's data key — and a restore deliberately
    //    does not touch the device's backup routine: backups keep running
    //    right through a restore, which is when they matter most.
    //  - private_notes / private_note_versions (migration 045 / ADR-057 §6):
    //    NOT in the unconditional wipe list because they join the replace
    //    CONDITIONALLY — wiped and refilled only when private records are
    //    actually being restored (`RestoreProfileInput.privateSealed`, the
    //    re-sealed rows main produced under the live DEK). An archive with no
    //    private records — or a locked/un-set-up target section — passes no
    //    `privateSealed`, and the sealed rows stand UNTOUCHED: a restore must
    //    never cost a profile sealed rows the archive says nothing about.
    //    The conditional-replace tests below pin both directions.
    //  - private_settings (migration 045 / ADR-057): the per-profile KEY CHAIN
    //    — wraps and lock preferences — which no archive ever carries and no
    //    restore may ever touch: destroying it would destroy the only paths to
    //    the DEK that opens the rows the conditional replace just preserved
    //    (or wrote).
    //  - search_history (migration 050 / SRCH-009): deliberately DEVICE-LOCAL,
    //    on `backup_settings`' exact terms — excluded from the export archive
    //    and from the wipe alike. What this device's user searched for is a
    //    fact about how the machine was USED, not content the profile
    //    contains: an archive must not carry a person's queries to whoever
    //    they hand it to, and replacing a profile's rows does not change what
    //    was typed into this install's search box. A restore that wiped it
    //    would be answering a question nobody asked; one that FILLED it would
    //    be a privacy leak in the other direction.
    //  - sync_journal / sync_row_state (migration 063 / ADR-083): sync
    //    bookkeeping, not content — and both are deliberately left alone for
    //    the same reason, from opposite ends. The wipe and refill fire
    //    migration 063's triggers on every row they touch, so the JOURNAL
    //    fills itself with exactly the objects the restore changed; wiping it
    //    first would only throw away entries the same statement is about to
    //    re-create. `sync_row_state` matters more: it is the baseline the
    //    sweep diffs against AND it carries the server's version counter per
    //    object. Delete it and the next sweep restamps the entire profile as
    //    new at version 0, which the server rejects as stale on every single
    //    row. Leaving it is also what makes the restore travel CORRECTLY —
    //    the sweep diffs the restored rows against what was last sealed and
    //    sends the fields that really moved.
    //  - sync_account (migration 064): DEVICE-LOCAL and singleton, on
    //    `backup_settings`' terms and then some. It holds which Nexus account
    //    THIS COMPUTER belongs to and its copy of the master key wrapped under
    //    the local data key — none of which an archive carries, and none of
    //    which a restore has any business changing: a restore replaces a
    //    profile's content, while this row is a fact about the machine. Wiping
    //    it would be worse than pointless. The mint is a singleton per account,
    //    so there is no route back to the existing master key from a desktop
    //    that has forgotten its wrap — „restore a backup" would silently become
    //    „leave the sync account", which is the one operation on this table that
    //    the settings card makes the user confirm by name.
    //  - sync_cursor / sync_outbox / sync_quarantine (migration 066): the same
    //    rule as `sync_row_state`, and each one earns it separately. All three
    //    describe this device's RELATIONSHIP WITH THE SERVER, and a restore
    //    replaces a profile's content without changing a single thing about how
    //    far this device has walked the server's log. `sync_cursor` wiped means
    //    re-downloading and re-merging the entire history of every collection,
    //    for nothing. `sync_quarantine` wiped means silently forgetting the
    //    objects this device already knows it cannot read — the one record that
    //    it is missing something. `sync_outbox` is the sharpest of the three:
    //    the restore's own writes fire migration 063's triggers and the next
    //    sweep re-queues everything it touched, so wiping would only lose the
    //    rows for objects the restore did NOT touch — which are precisely the
    //    ones still owed to the server, and losing them is exactly the defect
    //    the table was added to close.
    //  - elec_settings (migration 069 / ADR-085 E6): DEVICE-LOCAL, on
    //    `sync_account`'s terms and then further. Every column describes THIS
    //    COMPUTER — which of the three profiles its toolchain runs under, which
    //    of ITS WSL distributions the build happens in, and when a person here
    //    agreed to let Nexus start a process at all. A distribution name is
    //    meaningless on a machine that does not have it, and the consent is the
    //    sharpest of the three: carried by an archive it would become somebody
    //    else's yes, and a desktop that never gave one would run builds because
    //    another one did. That is DEV-007's whole subject, and a restore is not
    //    a thing that may grant it. It is also not CONTENT in the archive's
    //    sense: nothing here is something the user wrote, so there is no
    //    version of it an archive could hold and no journal trigger on it.
    //  - library_items / library_item_covers / library_passes / library_thoughts
//    / library_collections / library_collection_items (migration 072): a KIT
//    module's tables, and deliberately NOT in `RESTORE_WIPE_TABLES` for the
//    TIMERS reason below rather than for a sequencing one. Stage 2 wired
//    `LibraryStore.exportData`/`importData` into the archive (it is the
//    module's `main/imex.ts`), so a restore DOES replace these rows — but
//    it replaces them through the module's own `apply`, which runs in the same
//    transaction as every other module's and is handed `undefined` by an
//    archive that says nothing about the Library. Adding them to the wipe list
//    instead would owe a matching entry in `@nexus/sync`'s collection map,
//    which `collectionGuard.test.ts` holds EQUAL to that list and which a
//    module built on the kit may not edit; the kit's own rule is the opposite
//    one, and the TIMERS entry below states it in full.
    //  - the six culture tables (migration 073) are exempt, and this is the
    //    entry to remove when stage 2 lands. They ARE ordinary user content,
    //    but their archive section does not exist yet: stage 1 built the store
    //    and its own versioned `exportData`/`importData`, and stage 2 wires
    //    that section into the profile archive. Until then a restore neither
    //    wipes nor refills them. They are absent from `RESTORE_WIPE_TABLES` for
    //    the reason they also carry no journal triggers — sync is on hold, and
    //    that list is tied to `@nexus/sync`'s map by
    //    `collectionGuard.test.ts`, which goes red the moment one side names a
    //    table the other does not. The profile DELETE is unaffected: these
    //    tables cascade from `profiles` like every other content table, which
    //    the cascade audit in `profileStore.test.ts` proves for all six,
    //    photos and playlist items included.
    //  - CAR's seven tables (migration 074): the module arrived in two stages,
    //    and this is the boundary between them. Stage 1 built the store and the
    //    logic and deliberately left `RESTORE_WIPE_TABLES` ALONE, because a wipe
    //    without a refill is how a restore DESTROYS data: the wipe empties a
    //    table and the archive that was just read is what fills it again — and
    //    no archive carries a CAR table yet, since the module has no kit entry
    //    to export it through. Adding them to the wipe list would therefore
    //    delete a user's whole car history on the first restore. They join that
    //    list in stage 2, in the same pass as the archive's own half, which is
    //    also the pass that must add them to `@nexus/sync`'s collection map:
    //    `collectionGuard.test.ts` holds the map and the wipe list EQUAL, so a
    //    table cannot be in one without the other. Until then this entry is the
    //    decision the rule asks for, and the reason is that the module has no
    //    archive yet.
    //  - pantry_locations / pantry_items / pantry_log (migration 075): CONTENT,
    //    and deliberately not wiped YET rather than never. Sync is on hold
    //    permanently, and a table joins this list only by joining `@nexus/sync`'s
    //    collection map — `collectionGuard.test.ts` holds the two lists equal —
    //    which in turn owes migration 063's journal triggers for every
    //    collection it names. Stage 2 is the pass that takes the pantry the whole
    //    way into the archive, and it owes all three of those edits in the same
    //    run that wires `PantryStore.exportData`/`importData` into
    //    `ProfileData`: the map entries, the triggers, and these three names.
    //    Wiping them NOW is the one direction migration 067's own commit message
    //    warns about — this guard requires a table to be wiped OR documented, and
    //    does NOT require a wiped table to be written back, so a restore would
    //    silently destroy every pantry in the profile while the pantry is still
    //    not something an archive can carry.
    //  - cookbook_recipes / cookbook_ingredients / cookbook_steps (migration
    //    076): NOT in the wipe list, and the reason is SEQUENCING rather than
    //    device-locality, so it expires. These three ARE the user's own content
    //    and they belong in the archive — what does not exist yet is the
    //    archive's half of that: `ProfileData` carries no cookbook field, so
    //    `RestoreStore` has nothing to write these tables back FROM, and an
    //    entry in `RESTORE_WIPE_TABLES` today would turn every restore into a
    //    silent deletion of the user's recipes. The module's own
    //    `RecipeStore.exportData`/`importData` pair is the other end of the
    //    same change, and the day stage 2 plugs it into the archive these three
    //    lines move into `RESTORE_WIPE_TABLES` — together with `@nexus/sync`'s
    //    collection map, which `src/sync/collectionGuard.test.ts` holds equal to
    //    that list (and which is frozen with sync itself).
    //  - recordings / recording_markers (migration 077): the same sequencing
    //    as the cookbook. They are the user's own content and belong in the
    //    archive, but `ProfileData` carries no recorder field yet, so wiping
    //    them today would delete every recording on restore. Stage 2 wires
    //    `RecorderStore.exportData`/`importData` into the archive and moves
    //    these two names into `RESTORE_WIPE_TABLES`.
    //  - arcade_scores (migration 080): the same sequencing. A profile's
    //    scores are its own and go into the archive with stage 2, which wires
    //    `ArcadeStore.exportData`/`importData` in and moves this name into
    //    `RESTORE_WIPE_TABLES`; until then a wipe would lose them on restore.
    //  - chess_games / chess_resume / chess_level_stats (migration 082): the
    //    same sequencing as the arcade. Stage 2 wires `ChessStore.exportData`/
    //    `importData` into the archive and moves these three names into
    //    `RESTORE_WIPE_TABLES`.
    //  - emergency_cards / emergency_contacts / emergency_documents (migration
    //    078): the card IS user content, and it is deliberately NOT here yet
    //    rather than exempt on its merits. The module ships in two stages, and
    //    the profile archive is stage 2's job: it plugs this store's own
    //    `exportData`/`importData` into the archive, and the three tables move
    //    into `RESTORE_WIPE_TABLES` (with their sync classification) in that
    //    pass. Exempting them HERE keeps a restore from emptying a table nothing
    //    in this build refills - which is the lossy direction, not the safe one.
    //  - calc_history / calc_sessions (migration 079): CONTENT, and the one
    //    pair in this ledger that is here only until the next stage of the same
    //    module lands. The calculator was built in two passes — the engine and
    //    this store first, the page, the IPC and the profile archive second —
    //    and until the archive carries a calculator there is nothing for a
    //    restore to WRITE here. Wiping either table now would destroy history
    //    and variables the archive cannot put back, which is the one direction
    //    this guard exists to prevent; leaving them standing loses nothing,
    //    because a restore is not a thing that should delete what it cannot
    //    reproduce. When the archive learns about the calculator, both tables
    //    move into `RESTORE_WIPE_TABLES` (children first, and here there are no
    //    children) and this entry goes with them.
    const allowlist = new Set<string>([
      "meta",
      "profiles",
      "search_entries",
      "search_fts",
      "search_fts_data",
      "search_fts_idx",
      "search_fts_docsize",
      "search_fts_config",
      "backup_settings",
      "private_notes",
      "private_note_versions",
      "private_settings",
      "search_history",
      "sync_journal",
      "sync_row_state",
      "sync_account",
      "sync_cursor",
      "sync_outbox",
      "sync_quarantine",
      "elec_settings",
      // The TIMERS module's three tables (migration 071, ADR-090). A KIT
      // module's tables are deliberately NOT in `RESTORE_WIPE_TABLES`, and the
      // reason is structural rather than a preference: that list is DERIVED into
      // `@nexus/sync`'s collection map, which `collectionGuard.test.ts` holds it
      // equal to, and a module built on the kit may not edit `@nexus/sync` (its
      // whole point is that a new module edits no shared file). So the kit's rule
      // is the opposite one, stated in `ModuleContext.importData`: a module
      // REPLACES ITS OWN ROWS, inside the same restore, and `main/restore.ts`
      // calls `restoreModuleData` immediately after the replace has rewritten
      // every table above. Every adopted module runs there, in ONE transaction,
      // and one the archive's section does not name is handed `undefined` and
      // resets its own rows to empty — so these tables not being on the wipe list
      // is not a hole: an archive that says nothing about Timers leaves a profile
      // with no presets, exactly as a pre-1.42 archive does.
      "timers_presets",
      "timers_countdowns",
      "timers_settings",
      "library_items",
      "library_item_covers",
      "library_passes",
      "library_thoughts",
      "library_collections",
      "library_collection_items",
      "culture_visits",
      "culture_visit_photos",
      "culture_tracks",
      "culture_music_entries",
      "culture_playlists",
      "culture_playlist_items",
      "vehicles",
      "odometer_readings",
      "service_entries",
      "service_intervals",
      "fuel_entries",
      "faults",
      "service_attachments",
      "pantry_locations",
      "pantry_items",
      "pantry_log",
      "cookbook_recipes",
      "cookbook_ingredients",
      "cookbook_steps",
      "recordings",
      "recording_markers",
      "arcade_scores",
      "emergency_cards",
      "emergency_contacts",
      "emergency_documents",
      "calc_history",
      "calc_sessions",
      //  - cardgame_stats / cardgame_saves (migration 081, GAMES cards stage 1):
      //    a DEFERRAL, not an exemption by nature — and it is written down here
      //    because the alternative was to leave the gate red. Both tables hold
      //    per-profile content, so they belong in this list the moment the
      //    archive carries them: the module's own door is `CardGameStore.
      //    exportData`/`importData`, and wiring them into the profile archive is
      //    stage 2's job (it owns the module kit and the archive plug-in). Listing
      //    them HERE alone would not be enough either — `collectionGuard.test.ts`
      //    asserts that `RESTORE_WIPE_TABLES` and `@nexus/sync`'s collection map
      //    are the same set, and sync is on hold with no new collections, so the
      //    two lists have to gain these two tables together, in the run that
      //    teaches the archive about GAMES. Until then a restore leaves whatever
      //    game data this device has exactly where it is.
      "cardgame_stats",
      "cardgame_saves",
      "chess_games",
      "chess_resume",
      "chess_level_stats",
      //  - the READER module's four tables (migration 086, ADR-100): a KIT
      //    module's tables are deliberately not in `RESTORE_WIPE_TABLES`, and
      //    the reason is the structural one the timers entry above gives - a
      //    module built on the kit replaces its own rows inside the restore
      //    (`ModuleContext.importData`), because that list is derived into
      //    `@nexus/sync`'s collection map and a module may not edit sync. So a
      //    restore that names no Reader section leaves a profile with no
      //    positions, no bookmarks and no reading size, which is exactly what a
      //    fresh profile answers.
      "reader_positions",
      "reader_bookmarks",
      "reader_settings",
      "reader_acknowledged",
    ]);

    const wipeTables = new Set<string>(RESTORE_WIPE_TABLES);
    const unaccounted = tables.filter((table) => !wipeTables.has(table) && !allowlist.has(table));

    expect(unaccounted).toEqual([]);
  });

  // --- The private tables' CONDITIONAL replace (ADR-057 §6) ------------------

  /** Seeds one sealed note with one sealed version through the real store — opaque bytes; the crypto is main's business, never this store's. */
  function seedSealedRows(profileId: string): { note: Uint8Array; version: Uint8Array } {
    const store = new PrivateNoteStore(db.raw, profileId);
    const note = new TextEncoder().encode(`sealed-live-${profileId}`);
    const version = new TextEncoder().encode(`sealed-v1-${profileId}`);
    store.writeSealed("priv-1", note, NOW);
    store.writeVersion("priv-1", 1, version, NOW);
    return { note, version };
  }

  function sealedRowsOf(profileId: string): { id: string; sealed: Buffer }[] {
    return db.raw
      .prepare("SELECT id, sealed FROM private_notes WHERE profile_id = ? ORDER BY id")
      .all(profileId) as { id: string; sealed: Buffer }[];
  }

  it("T3b: leaves the sealed private tables UNTOUCHED when no privateSealed is supplied — absent and null alike", () => {
    const profileA = createProfile(db, "A");
    const fixtureA = seedFixture(db, profileA, "A");
    const seeded = seedSealedRows(profileA);

    new RestoreStore(db.raw, profileA).replaceProfileData(
      { profileName: "A", profilePicture: null, settings: emptySettings(), data: fixtureA.data, derived: fixtureA.derived },
      NOW,
    );
    new RestoreStore(db.raw, profileA).replaceProfileData(
      { profileName: "A", profilePicture: null, settings: emptySettings(), data: fixtureA.data, derived: fixtureA.derived, privateSealed: null },
      NOW,
    );

    // Byte-for-byte: two whole-profile replaces later, the sealed rows stand.
    const store = new PrivateNoteStore(db.raw, profileA);
    expect(new Uint8Array(store.readSealed("priv-1"))).toEqual(seeded.note);
    expect(new Uint8Array(store.readVersion("priv-1", 1))).toEqual(seeded.version);
  });

  it("T3b2: leaves the DEVICE-LOCAL search history standing across a whole-profile replace (SRCH-009)", () => {
    // The other half of migration 050's promise. The T3 guard above proves the
    // wipe list does not NAME `search_history`; this proves what that means in
    // practice — a restore neither erases the queries this device's user typed
    // nor invents any, because an archive carries none to invent them from.
    const profileA = createProfile(db, "A");
    const fixtureA = seedFixture(db, profileA, "A");
    const history = new SearchHistoryStore(db.raw, profileA);
    history.record("#posao rok:danas", "2026-01-15T09:00:00.000Z");

    new RestoreStore(db.raw, profileA).replaceProfileData(
      { profileName: "A", profilePicture: null, settings: emptySettings(), data: fixtureA.data, derived: fixtureA.derived },
      NOW,
    );

    expect(history.list()).toEqual([
      { query: "#posao rok:danas", usedAt: "2026-01-15T09:00:00.000Z" },
    ]);
  });

  it("T3c: wipes and refills the private tables byte-for-byte when privateSealed IS supplied, counting the rows written", () => {
    const profileA = createProfile(db, "A");
    const fixtureA = seedFixture(db, profileA, "A");
    seedSealedRows(profileA);

    const incoming: RestoredPrivateRows = {
      notes: [
        { id: "arch-1", sealed: new TextEncoder().encode("resealed-live"), createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-02T00:00:00.000Z" },
      ],
      versions: [
        { noteId: "arch-1", seq: 3, sealed: new TextEncoder().encode("resealed-v3"), createdAt: "2026-02-01T00:00:00.000Z" },
      ],
    };
    // The first replace leaves the seeded sealed rows standing (T3b's fact),
    // so the second one's wipe genuinely has something to prove.
    const withoutPrivate = new RestoreStore(db.raw, profileA).replaceProfileData(
      { profileName: "A", profilePicture: null, settings: emptySettings(), data: fixtureA.data, derived: fixtureA.derived },
      NOW,
    );
    const withPrivate = new RestoreStore(db.raw, profileA).replaceProfileData(
      { profileName: "A", profilePicture: null, settings: emptySettings(), data: fixtureA.data, derived: fixtureA.derived, privateSealed: incoming },
      NOW,
    );
    expect(withPrivate).toBe(withoutPrivate + 2);

    // The old rows are gone whole — versions with them — and the supplied ones
    // stand verbatim, timestamps from the archive rows themselves.
    expect(sealedRowsOf(profileA).map((row) => row.id)).toEqual(["arch-1"]);
    const store = new PrivateNoteStore(db.raw, profileA);
    expect(new Uint8Array(store.readSealed("arch-1"))).toEqual(new TextEncoder().encode("resealed-live"));
    expect(store.listVersions("arch-1")).toEqual([{ seq: 3, createdAt: "2026-02-01T00:00:00.000Z" }]);
    expect(new Uint8Array(store.readVersion("arch-1", 3))).toEqual(new TextEncoder().encode("resealed-v3"));
    expect(store.list().map((meta) => ({ id: meta.id, createdAt: meta.createdAt, updatedAt: meta.updatedAt }))).toEqual([
      { id: "arch-1", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-02T00:00:00.000Z" },
    ]);
  });

  it("T3d: scopes the conditional wipe to THIS profile — another profile's sealed rows survive", () => {
    const profileA = createProfile(db, "A");
    const profileB = createProfile(db, "B");
    const fixtureA = seedFixture(db, profileA, "A");
    seedSealedRows(profileB);

    new RestoreStore(db.raw, profileA).replaceProfileData(
      {
        profileName: "A", profilePicture: null, settings: emptySettings(), data: fixtureA.data,
        derived: fixtureA.derived, privateSealed: { notes: [], versions: [] },
      },
      NOW,
    );

    expect(sealedRowsOf(profileB).map((row) => row.id)).toEqual(["priv-1"]);
    // And an EMPTY supplied payload honestly empties this profile's tables.
    expect(sealedRowsOf(profileA)).toEqual([]);
  });

  it("T4: succeeds when a task's parent appears after its child in the archive's own array", () => {
    const profileB = createProfile(db, "T4-tasks");
    const parentId = uuidv7();
    const childId = uuidv7();
    const base = {
      description: null,
      status: "todo" as const,
      priority: "none" as const,
      done: false,
      dueDate: null,
      startDate: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      recurrence: null,
      reminderOffsets: [],
      // No list: this archive is an OLDER one, and the fallback Inbox is what
      // catches it (see the era-default test at the bottom of this file).
      listId: null,
      sectionId: null,
      // Disregarded by the restore for a listless task — it re-ranks the
      // fallback Inbox's tasks itself — so any valid rank does here.
      rank: FIRST_RANK,
    };
    const child: ExportTask = { id: childId, profileId: "ignored", parentId, title: "Child", ...base };
    const parent: ExportTask = { id: parentId, profileId: "ignored", parentId: null, title: "Parent", ...base };

    const data: ProfileData = { ...emptyProfileData(), tasks: [child, parent] }; // child BEFORE parent

    expect(() =>
      new RestoreStore(db.raw, profileB).replaceProfileData(
        { profileName: "T4", profilePicture: null, settings: emptySettings(), data, derived: new Map() },
        NOW,
      ),
    ).not.toThrow();

    const ids = new TaskStore(db.raw, profileB).listActive().map((t) => t.id);
    expect(ids.sort()).toEqual([childId, parentId].sort());
  });

  it("T4: succeeds when a note folder's parent appears after its child in the archive's own array", () => {
    const profileB = createProfile(db, "T4-folders");
    const parentId = uuidv7();
    const childId = uuidv7();
    const child: ExportNoteFolder = {
      id: childId,
      profileId: "ignored",
      parentId,
      name: "Child",
      color: null,
      defaultTemplateId: null,
      isCaptureDefault: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const parent: ExportNoteFolder = {
      id: parentId,
      profileId: "ignored",
      parentId: null,
      name: "Parent",
      color: null,
      defaultTemplateId: null,
      isCaptureDefault: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const data: ProfileData = { ...emptyProfileData(), noteFolders: [child, parent] }; // child BEFORE parent

    expect(() =>
      new RestoreStore(db.raw, profileB).replaceProfileData(
        { profileName: "T4", profilePicture: null, settings: emptySettings(), data, derived: new Map() },
        NOW,
      ),
    ).not.toThrow();

    const ids = new NoteOrgStore(db.raw, profileB).listFolders().map((f) => f.id);
    expect(ids.sort()).toEqual([childId, parentId].sort());
  });

  // NOTE-002 / migration 049 / interchange 1.27.0.
  it("T4b: restores a category and the note that names it, retargeting only the profile", () => {
    const profileB = createProfile(db, "T4b");
    const categoryId = uuidv7();
    const noteId = uuidv7();
    const at = "2026-01-01T00:00:00.000Z";
    const data: ProfileData = {
      ...emptyProfileData(),
      noteCategories: [
        { id: categoryId, profileId: "ignored", name: "sastanak", color: "zlato", createdAt: at, updatedAt: at },
      ],
      notes: [makeNote({ id: noteId, categoryId })],
    };

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "T4b", profilePicture: null, settings: emptySettings(), data, derived: new Map() },
      NOW,
    );

    expect(new NoteOrgStore(db.raw, profileB).listCategories()).toEqual([
      { id: categoryId, profileId: profileB, name: "sastanak", color: "zlato", createdAt: at, updatedAt: at },
    ]);
    expect(new NoteStore(db.raw, profileB).list()[0]?.categoryId).toBe(categoryId);
  });

  // A pre-1.27.0 archive carries no `note-category` row and no `categoryId`;
  // the parser fills the field with null, and this is what that restores as.
  it("T4c: restores a profile with no categories at all from an archive that carries none", () => {
    const profileB = createProfile(db, "T4c");
    seedFixture(db, profileB, "Old"); // B starts with a category of its own.
    expect(new NoteOrgStore(db.raw, profileB).listCategories()).toHaveLength(1);

    new RestoreStore(db.raw, profileB).replaceProfileData(
      {
        profileName: "T4c", profilePicture: null, settings: emptySettings(),
        data: { ...emptyProfileData(), notes: [makeNote({ id: uuidv7() })] },
        derived: new Map(),
      },
      NOW,
    );

    expect(new NoteOrgStore(db.raw, profileB).listCategories()).toEqual([]);
    expect(new NoteStore(db.raw, profileB).list()[0]?.categoryId).toBeNull();
  });

  it("T5: a failing row rolls back the entire restore, leaving profile B's existing rows untouched", () => {
    const profileB = createProfile(db, "T5");
    const tasksB = new TaskStore(db.raw, profileB);
    const existingTask = tasksB.create({ title: "Pre-existing" });

    const badBlock: ExportStudyBlock = {
      id: uuidv7(),
      planId: uuidv7(),
      profileId: "ignored",
      blockDate: "2026-01-01",
      minutes: 0, // migration 007's CHECK (minutes > 0) rejects this.
      status: "planned",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const data: ProfileData = { ...emptyProfileData(), blocks: [badBlock] };

    expect(() =>
      new RestoreStore(db.raw, profileB).replaceProfileData(
        { profileName: "Should not stick", profilePicture: null, settings: emptySettings(), data, derived: new Map() },
        NOW,
      ),
    ).toThrow();

    expect(tasksB.listActive()).toEqual([existingTask]);
    const profileRow = db.raw.prepare("SELECT name FROM profiles WHERE id = ?").get(profileB) as {
      name: string;
    };
    expect(profileRow.name).toBe("T5");
  });

  it("T6: the search index rebuilds itself via migration 017's triggers for a restored note and task", () => {
    const profileB = createProfile(db, "T6");
    const note = makeNote({ id: uuidv7(), title: "Search Note", snapshot: bytes(4) });
    const task: ExportTask = {
      id: uuidv7(),
      profileId: "ignored",
      parentId: null,
      title: "Search Task",
      description: "A task description body that should be indexed.",
      status: "todo",
      priority: "none",
      done: false,
      dueDate: null,
      startDate: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      recurrence: null,
      reminderOffsets: [],
      listId: null,
      sectionId: null,
      rank: FIRST_RANK,
    };

    const data: ProfileData = { ...emptyProfileData(), notes: [note], tasks: [task] };
    const derived = new Map<string, RestoredNoteDerived>([
      [note.id, { plaintext: "Ovo je stvarni tekst beleške za pretragu.", linkTargets: [] }],
    ]);

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "T6", profilePicture: null, settings: emptySettings(), data, derived },
      NOW,
    );

    const noteEntry = db.raw
      .prepare("SELECT body FROM search_entries WHERE kind = 'note' AND entity_id = ?")
      .get(note.id) as { body: string } | undefined;
    expect(noteEntry?.body).toContain("stvarni tekst beleške");

    const taskEntry = db.raw
      .prepare("SELECT body FROM search_entries WHERE kind = 'task' AND entity_id = ?")
      .get(task.id) as { body: string } | undefined;
    expect(taskEntry?.body).toContain("A task description body");
  });

  it("T7: note_links keeps only the resolvable target of a note's derived link set", () => {
    const profileB = createProfile(db, "T7");
    const note1 = makeNote({ id: uuidv7(), title: "Note 1", snapshot: bytes(4) });
    const note2 = makeNote({ id: uuidv7(), title: "Note 2" });
    const missingTarget = uuidv7();

    const data: ProfileData = { ...emptyProfileData(), notes: [note1, note2] };
    const derived = new Map<string, RestoredNoteDerived>([
      [note1.id, { plaintext: "Note 1 text", linkTargets: [note2.id, missingTarget] }],
    ]);

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "T7", profilePicture: null, settings: emptySettings(), data, derived },
      NOW,
    );

    const links = db.raw
      .prepare("SELECT source_note_id, target_note_id FROM note_links")
      .all() as { source_note_id: string; target_note_id: string }[];
    expect(links).toEqual([{ source_note_id: note1.id, target_note_id: note2.id }]);
  });

  it("T8: covered_seq is the max restored version, 0 with none, and the next appended update never collides", () => {
    const profileB = createProfile(db, "T8");
    const noteWithVersions = makeNote({ id: uuidv7(), title: "With versions", snapshot: bytes(4) });
    const noteNoVersions = makeNote({ id: uuidv7(), title: "No versions", snapshot: bytes(4) });

    const data: ProfileData = {
      ...emptyProfileData(),
      notes: [noteWithVersions, noteNoVersions],
      noteVersions: [
        {
          noteId: noteWithVersions.id,
          coveredSeq: 3,
          title: "v3",
          createdAt: "2026-01-01T00:00:00.000Z",
          snapshot: bytes(4, 3),
        },
        {
          noteId: noteWithVersions.id,
          coveredSeq: 7,
          title: "v7",
          createdAt: "2026-01-01T00:01:00.000Z",
          snapshot: bytes(4, 7),
        },
      ],
    };
    const derived = new Map<string, RestoredNoteDerived>([
      [noteWithVersions.id, { plaintext: "with versions", linkTargets: [] }],
      [noteNoVersions.id, { plaintext: "no versions", linkTargets: [] }],
    ]);

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "T8", profilePicture: null, settings: emptySettings(), data, derived },
      NOW,
    );

    const snapWith = db.raw
      .prepare("SELECT covered_seq FROM note_snapshots WHERE note_id = ?")
      .get(noteWithVersions.id) as { covered_seq: number };
    expect(snapWith.covered_seq).toBe(7);

    const snapWithout = db.raw
      .prepare("SELECT covered_seq FROM note_snapshots WHERE note_id = ?")
      .get(noteNoVersions.id) as { covered_seq: number };
    expect(snapWithout.covered_seq).toBe(0);

    const notesB = new NoteStore(db.raw, profileB);
    notesB.appendUpdate(noteWithVersions.id, bytes(4, 42), "With versions", "2026-01-01T00:02:00.000Z");
    const pending = notesB.readForCompaction(noteWithVersions.id).updates;
    expect(pending.map((u) => u.seq)).toEqual([8]);
  });

  it("T8b: a restored history keeps the exact shape it was exported in — restoring never thins", () => {
    const profileB = createProfile(db, "T8b");
    const note = makeNote({ id: uuidv7(), title: "Long history", snapshot: bytes(4) });

    // Three years of weekly checkpoints plus a same-hour cluster at the end —
    // a history `NoteStore.captureVersion`'s tiered schedule would thin hard
    // (`MAX_NOTE_VERSIONS` alone would cut it to 50). Restoring is not
    // capturing: it reproduces what the archive holds, row for row.
    const start = Date.parse("2023-01-01T00:00:00.000Z");
    const noteVersions = Array.from({ length: 160 }, (_, i) => ({
      noteId: note.id,
      coveredSeq: i + 1,
      title: `v${i + 1}`,
      createdAt: new Date(start + i * 7 * 86_400_000).toISOString(),
      snapshot: bytes(4, i),
    }));
    // Four inside one hour, so a schedule applied here would collapse them.
    for (let i = 0; i < 4; i += 1) {
      noteVersions.push({
        noteId: note.id,
        coveredSeq: 200 + i,
        title: `cluster${i}`,
        createdAt: new Date(start + 160 * 7 * 86_400_000 + i * 10 * 60_000).toISOString(),
        snapshot: bytes(4, 200 + i),
      });
    }

    const data: ProfileData = { ...emptyProfileData(), notes: [note], noteVersions };
    const derived = new Map<string, RestoredNoteDerived>([
      [note.id, { plaintext: "long history", linkTargets: [] }],
    ]);

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "T8b", profilePicture: null, settings: emptySettings(), data, derived },
      NOW,
    );

    const restored = new NoteStore(db.raw, profileB).listVersions(note.id);
    expect(restored.map((v) => v.coveredSeq)).toEqual(
      noteVersions.map((v) => v.coveredSeq).sort((a, b) => b - a),
    );
    expect(restored).toHaveLength(noteVersions.length);
  });

  it("T9: settings round trip — flags, notification prefs (incl. a disabled source), and the profile rename", async () => {
    const profileB = createProfile(db, "Before rename");

    const settings: ExportSettings = {
      flags: { notes: true, tasks: false, calendar: true },
      notifications: {
        quietFrom: "22:00",
        quietTo: "06:30",
        morningHour: "07:45",
        enabledSources: ["document", "exam"], // "study-day" absent => disabled
        snoozeDefault: "tonight",
      },
    };

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "After rename", profilePicture: null, settings, data: emptyProfileData(), derived: new Map() },
      NOW,
    );

    const flagStore = new SqliteFlagStore(db.raw, profileB);
    await expect(flagStore.get()).resolves.toEqual({ notes: true, tasks: false, calendar: true });

    const notificationStore = new NotificationStore(db.raw, profileB);
    expect(notificationStore.getSettings()).toEqual({
      quietFrom: "22:00",
      quietTo: "06:30",
      morningHour: "07:45",
      enabledSources: ["document", "exam"],
      // NTF-009 (`1.19.0`): the snooze default DOES travel — a preference the
      // user chose is theirs to get back, unlike the appetite flag below.
      snoozeDefault: "tonight",
      // NTF-008 (ADR-033): the appetite flag deliberately does not travel in an
      // archive, so a restored profile comes back UNASKED and is asked again at
      // its next visible reminder — the harmless direction.
      appetiteAsked: false,
    });

    const profileRow = db.raw.prepare("SELECT name FROM profiles WHERE id = ?").get(profileB) as {
      name: string;
    };
    expect(profileRow.name).toBe("After rename");
  });

  // SET-001: the picture is written beside the name, from the manifest, and a
  // REPLACE honours "no picture" as loudly as it honours a picture — a restore
  // that left the target's own face on would be a merge, not a replace.
  describe("T9b: the profile picture rides with the name", () => {
    const PICTURE = { hash: "e".repeat(64), mime: "image/png", sizeBytes: 4096 };

    const readPicture = (profileId: string) =>
      db.raw
        .prepare(
          "SELECT picture_hash, picture_mime, picture_size_bytes FROM profiles WHERE id = ?",
        )
        .get(profileId);

    it("writes the archive's picture onto a profile that had none", () => {
      const profileB = createProfile(db, "B");
      new RestoreStore(db.raw, profileB).replaceProfileData(
        {
          profileName: "B",
          profilePicture: PICTURE,
          settings: emptySettings(),
          data: emptyProfileData(),
          derived: new Map(),
        },
        NOW,
      );
      expect(readPicture(profileB)).toEqual({
        picture_hash: PICTURE.hash,
        picture_mime: PICTURE.mime,
        picture_size_bytes: PICTURE.sizeBytes,
      });
    });

    it("clears the target's own picture when the archive carries none", () => {
      const profileB = createProfile(db, "B");
      new ProfileStore(db.raw).setPicture(profileB, "f".repeat(64), "image/png", 128);

      new RestoreStore(db.raw, profileB).replaceProfileData(
        {
          profileName: "B",
          profilePicture: null,
          settings: emptySettings(),
          data: emptyProfileData(),
          derived: new Map(),
        },
        NOW,
      );
      expect(readPicture(profileB)).toEqual({
        picture_hash: null,
        picture_mime: null,
        picture_size_bytes: null,
      });
    });

    it("never touches another profile's picture", () => {
      const profileA = createProfile(db, "A");
      const profileB = createProfile(db, "B");
      new ProfileStore(db.raw).setPicture(profileA, "f".repeat(64), "image/png", 128);

      new RestoreStore(db.raw, profileB).replaceProfileData(
        {
          profileName: "B",
          profilePicture: PICTURE,
          settings: emptySettings(),
          data: emptyProfileData(),
          derived: new Map(),
        },
        NOW,
      );
      expect(readPicture(profileA)).toEqual({
        picture_hash: "f".repeat(64),
        picture_mime: "image/png",
        picture_size_bytes: 128,
      });
    });
  });

  it("T10: restoring into profile B never touches profile A's rows", () => {
    const profileA = createProfile(db, "A");
    const fixtureA = seedFixture(db, profileA, "A");
    const profileB = createProfile(db, "B");
    seedFixture(db, profileB, "B-old");

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "B restored", profilePicture: null, settings: emptySettings(), data: freshArchiveData(), derived: new Map() },
      NOW,
    );

    assertModulesMatch(db, profileA, fixtureA, profileA);
  });

  it("refuses, atomically, an archive whose row ids already belong to another profile in this database", () => {
    // Row ids are preserved rather than re-minted (ADR-023 §1: a note's Yjs
    // document embeds other rows' ids inside its own content, so re-minting
    // them would mean rewriting ids inside CRDT documents), and every one of
    // them is a GLOBAL primary key. So an archive can only land somewhere that
    // does not already hold its ids under a different profile: the profile it
    // came from (T1b) or a fresh install (T1). Restoring beside its own source
    // profile is the one remaining case, and it must fail loudly and leave
    // both profiles exactly as they were — never write half an archive.
    const profileA = createProfile(db, "A");
    const fixtureA = seedFixture(db, profileA, "A");
    const profileB = createProfile(db, "B");
    const fixtureB = seedFixture(db, profileB, "B");

    expect(() =>
      new RestoreStore(db.raw, profileB).replaceProfileData(
        { profileName: "B", profilePicture: null, settings: emptySettings(), data: fixtureA.data, derived: fixtureA.derived },
        NOW,
      ),
    ).toThrow(/UNIQUE constraint failed/);

    assertModulesMatch(db, profileA, fixtureA, profileA);
    assertModulesMatch(db, profileB, fixtureB, profileB);
  });

  it("restores a recurring task's rule and ladder, and a series master's rule, exceptions and ladder verbatim (ADR-024/CAL-006/ADR-028)", () => {
    const profileB = createProfile(db, "recurrence");
    const timestamps = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const listId = uuidv7();
    const list: TaskList = {
      id: listId, profileId: "ignored", parentId: null, name: "Inbox", isInbox: true,
      defaultView: "list", viewConfig: null, rank: FIRST_RANK, ...timestamps,
    };
    const task: ExportTask = {
      id: uuidv7(), profileId: "ignored", parentId: null, title: "Prvog u mesecu", description: null,
      status: "todo", priority: "none", done: false, dueDate: "2026-08-01", startDate: null,
      completedAt: null,
      recurrence: { freq: { kind: "monthly-date", interval: 1, day: 1 }, end: { kind: "count", total: 12 } },
      reminderOffsets: [7, 0], // deliberately unsorted, like the event's below
      listId, sectionId: null, rank: FIRST_RANK,
      ...timestamps,
    };
    const event: ExportEvent = {
      id: uuidv7(), profileId: "ignored", title: "Petkom", description: null,
      startAt: "2026-07-10T09:00:00.000Z", endAt: null, allDay: false, location: null, category: null,
      recurrence: { freq: { kind: "weekly", interval: 1, days: [4] }, end: { kind: "never" } },
      recurrenceExdates: ["2026-08-14", "2026-07-17"], // deliberately unsorted; order carries no meaning in an archive
      reminderOffsets: [1440, 15], // likewise unsorted — and 1440 > 15 proves the sort is numeric, not lexical
      ...timestamps,
    };
    const data: ProfileData = {
      ...emptyProfileData(), taskLists: [list], tasks: [task], events: [event],
    };

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "Recurrence", profilePicture: null, settings: emptySettings(), data, derived: new Map() },
      NOW,
    );

    // Read back through the stores, so this also proves the restore wrote the
    // exact canonical text those stores accept — anything else reads as
    // corruption and throws rather than returning a row.
    expect(new TaskStore(db.raw, profileB).listActive()).toEqual([
      { ...task, profileId: profileB, reminderOffsets: [0, 7] },
    ]);
    // The exceptions and the reminder ladder come back ascending: both columns
    // are canonical however the archive happened to list them.
    expect(new EventStore(db.raw, profileB).listActive()).toEqual([
      {
        ...event,
        profileId: profileB,
        recurrenceExdates: ["2026-07-17", "2026-08-14"],
        reminderOffsets: [15, 1440],
      },
    ]);
  });

  it("restores a task's list, section and rank verbatim (TASK-004 / ADR-029)", () => {
    const profileB = createProfile(db, "placement");
    const timestamps = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const inboxId = uuidv7();
    const workId = uuidv7();
    const sectionId = uuidv7();
    const [inboxRank, workRank] = rankSequence(2) as [string, string];
    const taskLists: TaskList[] = [
      {
        id: inboxId, profileId: "ignored", parentId: null, name: "Inbox", isInbox: true,
        defaultView: "list", viewConfig: null, rank: inboxRank, ...timestamps,
      },
      // Carrying what it remembers about its views (ADR-050): a restore that
      // dropped it would put the list back opening on the wrong shape.
      {
        id: workId, profileId: "ignored", parentId: inboxId, name: "Posao", isInbox: false,
        defaultView: "kanban",
        viewConfig: {
          kanban: { groupBy: "section" },
          cards: { sort: { field: "title", direction: "desc" } },
        },
        rank: workRank, ...timestamps,
      },
    ];
    const taskSections: TaskSection[] = [
      { id: sectionId, listId: workId, name: "U toku", rank: FIRST_RANK, ...timestamps },
    ];
    // Below FIRST_RANK on purpose — the rank analogue of the old negative
    // `position`: prepending walks below "i0", and a restore that normalized it
    // would silently re-order the user's list. `rankBetween(null, FIRST_RANK)`
    // is never null (FIRST_RANK is never the bottom of the integer space).
    const belowFirst = rankBetween(null, FIRST_RANK) as string;
    const task: ExportTask = {
      id: uuidv7(), profileId: "ignored", parentId: null, title: "U sekciji", description: null,
      status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
      completedAt: null, recurrence: null, reminderOffsets: [],
      listId: workId, sectionId, rank: belowFirst, ...timestamps,
    };

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "Placement", profilePicture: null, settings: emptySettings(), data: { ...emptyProfileData(), taskLists, tasks: [task], taskSections }, derived: new Map() },
      NOW,
    );

    const lists = new TaskListStore(db.raw, profileB);
    expect(lists.listActive()).toEqual(withProfile(taskLists, profileB));
    expect(lists.listSections(workId)).toEqual(taskSections);
    expect(new TaskStore(db.raw, profileB).listActive()).toEqual([{ ...task, profileId: profileB }]);
  });

  it("restores a cloze card's ordinal as the NUMBER the parser handed it (ADR-068)", () => {
    // The parser is the only place an archive's ordinal is interpreted: it
    // upgrades a pre-1.26.0 position and takes a 1.26.0 number verbatim. This
    // store must then write exactly what it was given — a 9 that named a
    // labelled deletion must not come back as a position.
    const profileB = createProfile(db, "cloze-numbers");
    const timestamps = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const subjectId = uuidv7();
    const deckId = uuidv7();
    const clozeText = "Glavni grad je {{c9::Beograd}}.";
    const sides = renderClozeCard(clozeText, 9);
    const card = {
      id: uuidv7(), profileId: "ignored", deckId, front: sides?.front ?? "", back: sides?.back ?? "",
      sourceNoteId: null, sourceBlockKey: null,
      kind: "cloze", clozeText, clozeOrdinal: 9, problemSteps: null,
      due: "2026-01-02T00:00:00.000Z", stability: 1, difficulty: 2, elapsedDays: 0,
      scheduledDays: 1, learningSteps: 0, reps: 0, lapses: 0, state: 0 as const, lastReview: null,
      ...timestamps,
    };

    new RestoreStore(db.raw, profileB).replaceProfileData(
      {
        profileName: "Cloze",
        profilePicture: null,
        settings: emptySettings(),
        data: {
          ...emptyProfileData(),
          subjects: [
            { id: subjectId, profileId: "ignored", name: "Predmet", color: "jade", semester: null, archived: false, ...timestamps },
          ],
          decks: [{ id: deckId, profileId: "ignored", subjectId, name: "Špil", ...timestamps }],
          cards: [card],
        },
        derived: new Map(),
      },
      NOW,
    );

    const restored = new CardStore(db.raw, profileB).listByDeck(deckId)[0];
    expect(restored).toMatchObject({ kind: "cloze", clozeText, clozeOrdinal: 9 });
    // And the row is a live card, not a stranded one: its own sides still
    // re-derive from its own template under that number.
    expect(renderClozeCard(restored?.clozeText ?? "", restored?.clozeOrdinal ?? -1)).toEqual({
      front: restored?.front,
      back: restored?.back,
    });
  });

  it("restores a task's tags and their links verbatim, ids and all (migration 023)", () => {
    const profileB = createProfile(db, "tags");
    const timestamps = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const listId = uuidv7();
    const taskLists: TaskList[] = [
      {
        id: listId, profileId: "ignored", parentId: null, name: "Inbox", isInbox: true,
        defaultView: "list", viewConfig: null, rank: FIRST_RANK, ...timestamps,
      },
    ];
    const taskTags: TaskTag[] = [
      { id: uuidv7(), profileId: "ignored", name: "posao", createdAt: timestamps.createdAt },
      { id: uuidv7(), profileId: "ignored", name: "kasnije", createdAt: timestamps.createdAt },
    ];
    const [firstRank, secondRank] = rankSequence(2) as [string, string];
    const task = (title: string, rank: string): ExportTask => ({
      id: uuidv7(), profileId: "ignored", parentId: null, title, description: null,
      status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
      completedAt: null, recurrence: null, reminderOffsets: [],
      listId, sectionId: null, rank, ...timestamps,
    });
    const first = task("Prvi", firstRank);
    const second = task("Drugi", secondRank);
    // One task under two tags and one tag over two tasks — the two shapes a
    // many-to-many has to survive, plus a tag attached to nothing at all.
    const taskTagLinks = [
      { taskId: first.id, tagId: taskTags[0]?.id ?? "" },
      { taskId: first.id, tagId: taskTags[1]?.id ?? "" },
      { taskId: second.id, tagId: taskTags[0]?.id ?? "" },
    ];

    new RestoreStore(db.raw, profileB).replaceProfileData(
      {
        profileName: "Tags", profilePicture: null,
        settings: emptySettings(),
        data: { ...emptyProfileData(), taskLists, tasks: [first, second], taskTags, taskTagLinks },
        derived: new Map(),
      },
      NOW,
    );

    const tags = new TaskTagStore(db.raw, profileB);
    expect(tags.listTags()).toEqual(
      withProfile(taskTags, profileB).sort((a, b) => a.name.localeCompare(b.name)),
    );
    expect(tags.listTagLinks()).toEqual(
      [...taskTagLinks].sort((a, b) =>
        a.taskId === b.taskId ? a.tagId.localeCompare(b.tagId) : a.taskId.localeCompare(b.taskId),
      ),
    );
  });

  it("wipes the target profile's own tags and links before writing the archive's", () => {
    const profileB = createProfile(db, "tag-wipe");
    const oldTag = new TaskTagStore(db.raw, profileB).createTag("staro", NOW);
    const oldTask = new TaskStore(db.raw, profileB).create({ title: "Stari zadatak" });
    new TaskTagStore(db.raw, profileB).attachTag(oldTask.id, oldTag.id);

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "Wiped", profilePicture: null, settings: emptySettings(), data: freshArchiveData(), derived: new Map() },
      NOW,
    );

    const tags = new TaskTagStore(db.raw, profileB);
    expect(tags.listTags()).toEqual([]);
    // The link went with it — a wipe that leaned on the task's CASCADE alone
    // would have left it behind, since the wipe deletes tasks by profile too.
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM task_tag_links").get() as { n: number }).n,
    ).toBe(0);
  });

  it("restores dependency edges verbatim, direction and all (migration 029 / ADR-037)", () => {
    const profileB = createProfile(db, "deps");
    const timestamps = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const listId = uuidv7();
    const taskLists: TaskList[] = [
      {
        id: listId, profileId: "ignored", parentId: null, name: "Inbox", isInbox: true,
        defaultView: "list", viewConfig: null, rank: FIRST_RANK, ...timestamps,
      },
    ];
    const [firstRank, secondRank, thirdRank] = rankSequence(3) as [string, string, string];
    const task = (title: string, rank: string): ExportTask => ({
      id: uuidv7(), profileId: "ignored", parentId: null, title, description: null,
      status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
      completedAt: null, recurrence: null, reminderOffsets: [],
      listId, sectionId: null, rank, ...timestamps,
    });
    const first = task("Prvi", firstRank);
    const second = task("Drugi", secondRank);
    const third = task("Treći", thirdRank);
    // A fan-out and a chain in one graph: the two shapes a dependency set has to
    // survive, and enough of a graph that a restore reversing an edge would show.
    const taskDependencies = [
      { blockerId: first.id, blockedId: second.id },
      { blockerId: first.id, blockedId: third.id },
      { blockerId: second.id, blockedId: third.id },
    ];

    new RestoreStore(db.raw, profileB).replaceProfileData(
      {
        profileName: "Deps", profilePicture: null,
        settings: emptySettings(),
        data: { ...emptyProfileData(), taskLists, tasks: [first, second, third], taskDependencies },
        derived: new Map(),
      },
      NOW,
    );

    expect(new TaskDependencyStore(db.raw, profileB).listLinks()).toEqual(
      [...taskDependencies].sort((a, b) =>
        a.blockerId === b.blockerId
          ? a.blockedId.localeCompare(b.blockedId)
          : a.blockerId.localeCompare(b.blockerId),
      ),
    );
  });

  it("wipes the target profile's own dependency edges before writing the archive's", () => {
    const profileB = createProfile(db, "dep-wipe");
    const tasks = new TaskStore(db.raw, profileB);
    const oldBlocker = tasks.create({ title: "Stari blokator" });
    const oldBlocked = tasks.create({ title: "Stari blokiran" });
    new TaskDependencyStore(db.raw, profileB).addDependency(oldBlocker.id, oldBlocked.id);

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "Wiped", profilePicture: null, settings: emptySettings(), data: freshArchiveData(), derived: new Map() },
      NOW,
    );

    expect(new TaskDependencyStore(db.raw, profileB).listLinks()).toEqual([]);
    // Explicitly, not through the tasks' CASCADE: the wipe deletes edges by
    // their own statement first, which is what a future table added without one
    // would fail to do.
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM task_dependencies").get() as { n: number }).n,
    ).toBe(0);
  });

  it("maps an older archive's list-less tasks into a freshly minted Inbox, ranked consecutively in the archive's own order", () => {
    const profileB = createProfile(db, "era-default");
    const timestamps = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    // What `parseImportArchive` hands back for a pre-1.3.0 archive: no lists at
    // all, and every task era-defaulted to listId/sectionId null and the first
    // rank (`ArchiveEra`) — the reader gave every such task the SAME starting
    // rank, since it had no scope to place them within.
    const legacyTask = (title: string): ExportTask => ({
      id: uuidv7(), profileId: "ignored", parentId: null, title, description: null,
      status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
      completedAt: null, recurrence: null, reminderOffsets: [],
      listId: null, sectionId: null, rank: FIRST_RANK, ...timestamps,
    });
    const tasks = [legacyTask("Prvi"), legacyTask("Drugi"), legacyTask("Treći")];

    const written = new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "Era", profilePicture: null, settings: emptySettings(), data: { ...emptyProfileData(), tasks }, derived: new Map() },
      NOW,
    );

    const lists = new TaskListStore(db.raw, profileB).listActive();
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ name: "Inbox", isInbox: true, createdAt: NOW, updatedAt: NOW });

    const restored = new TaskStore(db.raw, profileB).listActive();
    expect(restored.map((row) => row.title)).toEqual(["Prvi", "Drugi", "Treći"]);
    expect(restored.map((row) => row.listId)).toEqual([lists[0]?.id, lists[0]?.id, lists[0]?.id]);
    // The guarantee is the ORDER, not the spelling: the loop that files these
    // into the fallback Inbox re-ranks them one `rankAfter` at a time, so the
    // archive's own row order comes back as strictly ascending, distinct ranks
    // — never the identical `FIRST_RANK` every one of them carried in the file.
    const ranks = restored.map((row) => row.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    for (let index = 1; index < ranks.length; index += 1) {
      expect(ranks[index - 1]! < ranks[index]!).toBe(true);
    }
    // The minted Inbox is a row this restore wrote, so it is counted as one:
    // three tasks + that Inbox + the settings rows every restore writes (the
    // `ntf_settings` row, plus one disabled row per source `emptySettings`
    // leaves out).
    expect(written).toBe(3 + 1 + 1 + TOGGLEABLE_NOTIFICATION_SOURCES.length);
  });

  it("reuses the archive's OWN Inbox for list-less tasks rather than minting a second one", () => {
    const profileB = createProfile(db, "era-default-with-inbox");
    const timestamps = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const inboxId = uuidv7();
    const taskLists: TaskList[] = [
      {
        id: inboxId, profileId: "ignored", parentId: null, name: "Prijemno", isInbox: true,
        defaultView: "list", viewConfig: null, rank: FIRST_RANK, ...timestamps,
      },
    ];
    const task: ExportTask = {
      id: uuidv7(), profileId: "ignored", parentId: null, title: "Bez liste", description: null,
      status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
      completedAt: null, recurrence: null, reminderOffsets: [],
      listId: null, sectionId: null, rank: FIRST_RANK, ...timestamps,
    };

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "Era2", profilePicture: null, settings: emptySettings(), data: { ...emptyProfileData(), taskLists, tasks: [task] }, derived: new Map() },
      NOW,
    );

    const lists = new TaskListStore(db.raw, profileB).listActive();
    expect(lists.map((row) => row.id)).toEqual([inboxId]);
    expect(lists[0]?.name).toBe("Prijemno"); // the archive's row, not a fresh one
    // The sole task in a freshly-touched fallback scope: `rankAfter(null)` is
    // exactly `FIRST_RANK`, so the value is pinned rather than merely ordered.
    expect(new TaskStore(db.raw, profileB).listActive()[0]).toMatchObject({
      listId: inboxId,
      rank: FIRST_RANK,
    });
  });

  // Migration 062's whole reason for existing (see `@nexus/core`'s `rank.ts`):
  // a scope's ranks are distinct and the scope's own ordered read sorts by them
  // alone — never by the archive's array order. The archive below is built with
  // its rows in a SCRAMBLED array order relative to their ranks, so this proves
  // ordering comes from the `rank` column the restore wrote, not from a lucky
  // array order the archive happened to carry.
  it("restores five siblings with distinct ranks that the store's own ordered read returns strictly ascending", () => {
    const profileB = createProfile(db, "rank-invariant");
    const timestamps = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const listId = uuidv7();
    const taskLists: TaskList[] = [
      {
        id: listId, profileId: "ignored", parentId: null, name: "Inbox", isInbox: true,
        defaultView: "list", viewConfig: null, rank: FIRST_RANK, ...timestamps,
      },
    ];
    const names = ["Prvi", "Drugi", "Treći", "Četvrti", "Peti"];
    const ranks = rankSequence(names.length);
    const task = (index: number): ExportTask => ({
      id: uuidv7(), profileId: "ignored", parentId: null, title: names[index] as string,
      description: null, status: "todo", priority: "none", done: false, dueDate: null,
      startDate: null, completedAt: null, recurrence: null, reminderOffsets: [],
      listId, sectionId: null, rank: ranks[index] as string, ...timestamps,
    });
    // Array order 2, 4, 0, 3, 1 — nothing here matches rank order.
    const tasks = [task(2), task(4), task(0), task(3), task(1)];

    new RestoreStore(db.raw, profileB).replaceProfileData(
      {
        profileName: "Rank invariant", profilePicture: null, settings: emptySettings(),
        data: { ...emptyProfileData(), taskLists, tasks }, derived: new Map(),
      },
      NOW,
    );

    const restored = new TaskStore(db.raw, profileB).listActive();
    // Ascending rank order, exactly `names` — not the archive's array order.
    expect(restored.map((row) => row.title)).toEqual(names);
    const restoredRanks = restored.map((row) => row.rank);
    // No two live siblings in this (list, section) scope share a rank.
    expect(new Set(restoredRanks).size).toBe(restoredRanks.length);
    for (let index = 1; index < restoredRanks.length; index += 1) {
      expect(restoredRanks[index - 1]! < restoredRanks[index]!).toBe(true);
    }
  });

  it("throws RestoreValidationError when a note has a non-null snapshot but no matching entry in derived (R9)", () => {
    const profileB = createProfile(db, "R9");
    const note = makeNote({ id: uuidv7(), title: "Orphaned derived", snapshot: bytes(4) });
    const data: ProfileData = { ...emptyProfileData(), notes: [note] };

    expect(() =>
      new RestoreStore(db.raw, profileB).replaceProfileData(
        { profileName: "R9", profilePicture: null, settings: emptySettings(), data, derived: new Map() },
        NOW,
      ),
    ).toThrow(RestoreValidationError);

    // And nothing was left half-written: the note itself did not survive the rollback.
    expect(new NoteStore(db.raw, profileB).list()).toEqual([]);
  });
});

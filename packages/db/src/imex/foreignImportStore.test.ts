import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  documentDuplicateKey,
  eventDuplicateKey,
  finBudgetKey,
  FIRST_RANK,
  personDuplicateKey,
  planForeignImport,
} from "@nexus/core";
import type {
  ExportNote,
  ExportNoteFolder,
  ExportTask,
  ExportTaskList,
  ForeignImportTarget,
  ProfileData,
} from "@nexus/core";
import {
  CardStore,
  DashboardSetStore,
  DashboardSettingsStore,
  DashboardWidgetStore,
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
  ForeignImportStore,
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
  RestoreValidationError,
  StudySettingsStore,
  SubjectStore,
  TaskAttachmentStore,
  TaskDependencyStore,
  TaskListStore,
  TaskStore,
  TaskTagStore,
  TaskTemplateStore,
  openDatabase,
  uuidv7,
} from "../index.js";
import type { RestoredNoteDerived } from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-foreign-import-"));
  db = openDatabase({ path: join(dir, "import.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = "2026-03-01T00:00:00.000Z";

function createProfile(name: string): string {
  const id = uuidv7();
  const created = new Date().toISOString();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, created);
  // Every profile has an Inbox (TASK-004) — migration 022 backfills the ones
  // that predate ADR-029 and `main` seeds it for the ones it creates, so a
  // fixture without one would be a database state the app cannot reach, and a
  // foreign import's whole Inbox rule would have nothing to resolve onto.
  new TaskListStore(db.raw, id).ensureInbox(created);
  return id;
}

/** A deterministic non-empty binary blob — `ForeignImportStore` never decodes a note's snapshot bytes, so an opaque blob stands in for real Yjs state throughout. */
function bytes(length: number, offset = 0): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i + offset) % 256;
  return out;
}

/** A distinct, well-formed content hash per seed — the attachment stores hold their `sha256` to 64 lowercase hex characters, and two profiles' files must not accidentally share one. */
function fakeSha256(seed: number): string {
  return seed.toString(16).padStart(64, "0");
}

function emptyProfileData(): ProfileData {
  return {
    tasks: [],
    taskLists: [],
    taskSections: [],
    taskTags: [],
    taskTagLinks: [],
    taskAttachments: [],
    taskTemplates: [],
    taskDependencies: [],
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
    dashboardSettings: [],
    dashboardSets: [],
    dashboardWidgets: [],
    finAccounts: [],
    finCategories: [],
    finRecurring: [],
    finTransactions: [],
    finBudgets: [],
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
  };
}

/**
 * Seeds one profile with a real row in every module this store writes, entirely
 * through the actual store classes — the same trust boundary a real export
 * walks. Used for BOTH sides of the merge: the source an archive would have
 * carried, and the target that already has data of its own.
 *
 * Notes are deliberately left never-edited (no `compact`, no `captureVersion`):
 * `planForeignImport` rewrites the ids a note's Yjs document embeds by really
 * decoding it, and `@nexus/db` has no yjs dependency to build one with. The
 * note-state path is covered instead by the hand-built plans further down,
 * where opaque bytes are exactly what this store sees.
 */
function seedProfile(profileId: string, label: string): void {
  const t0 = "2026-01-01T00:00:00.000Z";
  const t1 = "2026-01-01T00:01:00.000Z";

  const tasks = new TaskStore(db.raw, profileId);
  const lists = new TaskListStore(db.raw, profileId);
  const taskTags = new TaskTagStore(db.raw, profileId);
  const taskAttachments = new TaskAttachmentStore(db.raw, profileId);
  const taskTemplates = new TaskTemplateStore(db.raw, profileId);
  const dependencies = new TaskDependencyStore(db.raw, profileId);
  const events = new EventStore(db.raw, profileId);
  const people = new PeopleStore(db.raw, profileId);
  const documents = new DocumentStore(db.raw, profileId);
  const subjects = new SubjectStore(db.raw, profileId);
  const exams = new ExamStore(db.raw, profileId);
  const decks = new DeckStore(db.raw, profileId);
  const cards = new CardStore(db.raw, profileId);
  const plans = new PlanStore(db.raw, profileId);
  const focus = new FocusStore(db.raw, profileId);
  const notes = new NoteStore(db.raw, profileId);
  const org = new NoteOrgStore(db.raw, profileId);
  const noteAttachments = new NoteAttachmentStore(db.raw, profileId);
  const noteTemplates = new NoteTemplateStore(db.raw, profileId);

  // A nested list, so the plan carries a self-referencing parent chain.
  const list = lists.createList({ name: `${label} list` }, t0);
  lists.createList({ name: `${label} sublist`, parentId: list.id }, t0);
  const section = lists.createSection(list.id, `${label} section`, t0);

  const parentTask = tasks.create({
    title: `${label} parent task`,
    dueDate: "2026-09-01",
    reminderOffsets: [1, 0],
    listId: list.id,
    sectionId: section.id,
  });
  const childTask = tasks.create({ title: `${label} child task`, parentId: parentTask.id });
  const tag = taskTags.createTag(`${label} task tag`, t0);
  taskTags.attachTag(parentTask.id, tag.id);
  dependencies.addDependency(childTask.id, parentTask.id);
  taskAttachments.add(
    parentTask.id,
    { fileName: "ugovor.pdf", mime: "application/pdf", sizeBytes: 30, sha256: fakeSha256(label.charCodeAt(0)) },
    t1,
  );
  taskTemplates.saveByName(
    `${label} task template`,
    {
      title: `${label} from template`,
      description: "Opis",
      priority: "high",
      dueOffsetDays: 7,
      reminderOffsets: [0, 1],
      recurrence: { freq: { kind: "weekly", interval: 1, days: [1] }, end: { kind: "never" } },
      tagNames: [`${label} task tag`],
      subtaskTitles: ["Prvi korak"],
    },
    t0,
  );

  events.create({ title: `${label} event`, startAt: "2026-03-01T10:00:00.000Z", reminderOffsets: [15, 1440] });
  people.create(
    { name: `${label} person`, kind: "birthday", month: 2, day: 29, year: 1992, note: "Beleška" },
    t0,
  );
  const document = documents.create({ docType: "pasos", label: `${label} document`, expiryDate: "2027-01-01" });
  documents.renew(document.id, "2028-01-01");

  const subject = subjects.create({ name: `${label} subject` });
  const exam = exams.create({ subjectId: subject.id, examType: "pismeni", examDate: "2030-01-01" });
  const deck = decks.create({ subjectId: subject.id, name: `${label} deck` });
  const card = cards.create({ deckId: deck.id, front: "Q", back: "A" }, t0);
  cards.review(card.id, 3, "2026-01-02T00:00:00.000Z");
  // A cloze card (ADR-042), so the plan carries the three `kind` columns and the
  // CHECKs that tie them together.
  cards.createCloze(deck.id, `${label}: glavni grad je {{Beograd}}.`, t0);
  // A deck-linked topic BEFORE the plan (ADR-063), so the generated blocks
  // carry topic/kind columns and the merge exercises the whole reference chain.
  new TopicStore(db.raw, profileId).create(
    { examId: exam.id, name: `${label} topic`, confidence: 35, deckId: deck.id },
    t0,
  );
  plans.createPlan(
    { examId: exam.id, dailyMinutes: 30, startDate: "2026-06-01", examWeekBoost: true },
    t0,
    "2026-01-01",
  );
  focus.create(
    { subjectId: subject.id, startedAt: "2026-01-01T09:00:00.000Z", endedAt: "2026-01-01T09:30:00.000Z" },
    "2026-01-01T09:31:00.000Z",
  );

  // A nested folder, for the same reason the list above is nested.
  const folder = org.createFolder({ parentId: null, name: `${label} folder`, color: "zlato" }, t0);
  org.createFolder({ parentId: folder.id, name: `${label} subfolder`, color: null }, t0);
  const noteTag = org.createTag(`${label} note tag`, t0);
  const note = notes.create(t0);
  notes.setFolder(note.id, folder.id);
  org.attachTag(note.id, noteTag.id);
  noteAttachments.add(
    note.id,
    { fileName: "a.png", mime: "image/png", sizeBytes: 10, sha256: fakeSha256(label.charCodeAt(0) + 1000) },
    t1,
  );
  const template = noteTemplates.save(`${label} template`, JSON.stringify({ type: "doc", content: [] }), t0);
  org.setDefaultTemplate(folder.id, template.id, t1);

  // A real ledger (migration 051). „Hrana" is spelled the SAME in both seeded
  // profiles on purpose: an expense category by that name is what the planner's
  // `(kind, name)` absorb rule has to fold, while „<label> plata" differs per
  // profile and must import as its own row. Two same-currency accounts so a
  // TRANSFER rides as the one row it is.
  const finAccounts = new FinAccountStore(db.raw, profileId);
  const finCategories = new FinCategoryStore(db.raw, profileId);
  const finTransactions = new FinTransactionStore(db.raw, profileId);
  const current = finAccounts.create(
    { name: `${label} tekući`, kind: "current", currency: "RSD", openingBalance: 1000_00 },
    t0,
  );
  const savings = finAccounts.create(
    { name: `${label} štednja`, kind: "savings", currency: "RSD" },
    t0,
  );
  const hrana = finCategories.create({ name: "Hrana", kind: "expense" }, t0);
  finCategories.create({ name: `${label} plata`, kind: "income" }, t0);
  finCategories.setBudget({ categoryId: hrana.id, currency: "RSD", amount: 300_00 }, t0);
  finTransactions.create(
    { accountId: current.id, categoryId: hrana.id, date: "2026-02-02", amount: -12_50, payee: "Maxi" },
    t0,
  );
  finTransactions.create(
    { accountId: current.id, counterAccountId: savings.id, date: "2026-02-04", amount: -300_00 },
    t0,
  );
  // FIN slice d (migration 053): a subscription and one charge it made. Its NAME
  // is the same in both seeded profiles on purpose — the planner must MINT it
  // anyway, because its account is minted and a schedule charging the target's
  // bank beside charges from the source's would be two rows disagreeing about
  // whose money this is.
  const finRecurring = new FinRecurringStore(db.raw, profileId);
  finRecurring.create(
    {
      accountId: current.id,
      categoryId: hrana.id,
      name: "Netflix",
      amount: -11_90,
      recurrence: { freq: { kind: "monthly-date", interval: 1, day: 5 }, end: { kind: "never" } },
      startDate: "2026-02-05",
      reminderDays: 2,
    },
    t0,
  );
  finRecurring.generateDue(t0, "2026-02-20");

  // HABIT (migration 055). Its NAME is the same in both seeded profiles on
  // purpose — the planner must MINT it anyway, because two people's „Trčanje"
  // are two habits under two schedules, and merging their days would compute one
  // streak over a history half of which was never kept under either.
  const habits = new HabitStore(db.raw, profileId);
  const habit = habits.create(
    { name: "Trčanje", schedule: { kind: "quota", perWeek: 3 } },
    t0,
  );
  habits.setEntry(habit.id, "2026-02-02", 1, t0);
  habits.setEntry(habit.id, "2026-02-04", 1, t0);
}

/** One profile's rows in interchange shape — the same read `main`'s `gatherProfileData` performs, minus the Electron-side plumbing. */
function gather(profileId: string): ProfileData {
  const lists = new TaskListStore(db.raw, profileId);
  const taskLists = lists.listActive();
  const tasks = new TaskStore(db.raw, profileId);
  const activeTasks = tasks.listActive();
  const taskAttachments = new TaskAttachmentStore(db.raw, profileId);
  const documents = new DocumentStore(db.raw, profileId);
  const activeDocuments = documents.listActive();
  const decks = new DeckStore(db.raw, profileId);
  const activeDecks = decks.listActive();
  const cards = new CardStore(db.raw, profileId);
  const plans = new PlanStore(db.raw, profileId);
  const activePlans = plans.listActive();
  const notes = new NoteStore(db.raw, profileId);
  const org = new NoteOrgStore(db.raw, profileId);
  const noteAttachments = new NoteAttachmentStore(db.raw, profileId);
  const taskTags = new TaskTagStore(db.raw, profileId);
  const finCategories = new FinCategoryStore(db.raw, profileId);
  const habits = new HabitStore(db.raw, profileId);

  return {
    ...emptyProfileData(),
    tasks: activeTasks,
    taskLists,
    taskSections: taskLists.flatMap((list) => lists.listSections(list.id)),
    taskTags: taskTags.listTags(),
    taskTagLinks: taskTags.listTagLinks(),
    taskAttachments: activeTasks.flatMap((task) => taskAttachments.list(task.id)),
    taskTemplates: new TaskTemplateStore(db.raw, profileId).list(),
    taskDependencies: new TaskDependencyStore(db.raw, profileId).listLinks(),
    events: new EventStore(db.raw, profileId).listActive(),
    eventTemplates: new EventTemplateStore(db.raw, profileId).list(),
    documents: activeDocuments,
    renewals: activeDocuments.flatMap((document) => documents.listRenewals(document.id)),
    people: new PeopleStore(db.raw, profileId).listActive(),
    subjects: new SubjectStore(db.raw, profileId).listActive(),
    exams: new ExamStore(db.raw, profileId).listActive(),
    decks: activeDecks,
    cards: activeDecks.flatMap((deck) => cards.listByDeck(deck.id)),
    reviewLog: cards.listReviewLog(),
    // The store speaks `rank`; the interchange spells the column (`sortOrder`).
    examTopics: new TopicStore(db.raw, profileId)
      .listAll()
      .map(({ rank, ...topic }) => ({ ...topic, sortOrder: rank })),
    plans: activePlans,
    blocks: activePlans.flatMap((plan) => plans.listBlocks(plan.id)),
    focusSessions: new FocusStore(db.raw, profileId).listActive(),
    studySettings: [{ profileId, ...new StudySettingsStore(db.raw, profileId).get() }],
    notifications: new NotificationStore(db.raw, profileId).listAll(),
    notes: notes.list().map((meta) => ({ ...meta, snapshot: null })),
    noteFolders: org.listFolders(),
    noteTags: org.listTags(),
    noteCategories: org.listCategories(),
    noteTagLinks: org.listTagLinks(),
    noteTemplates: new NoteTemplateStore(db.raw, profileId).list(),
    noteAttachments: notes.list().flatMap((meta) => noteAttachments.list(meta.id)),
    finAccounts: new FinAccountStore(db.raw, profileId).listActive(),
    finCategories: finCategories.list(),
    finRecurring: new FinRecurringStore(db.raw, profileId).listActive(),
    finTransactions: new FinTransactionStore(db.raw, profileId).listActive(),
    finBudgets: finCategories.listBudgets(),
    habits: habits.listActive(),
    habitEntries: habits.listAllEntries({ from: "1900-01-01", to: "9999-12-31" }),
  };
}

/** The target descriptor `planForeignImport` needs, read off the real stores exactly as `main` reads it. */
function targetFor(profileId: string): ForeignImportTarget {
  const org = new NoteOrgStore(db.raw, profileId);
  const finCategories = new FinCategoryStore(db.raw, profileId);
  const inbox = new TaskListStore(db.raw, profileId).listActive().find((list) => list.isInbox);
  if (inbox === undefined) throw new Error("Test setup: the target profile has no Inbox.");
  return {
    profileId,
    inboxListId: inbox.id,
    noteTags: org.listTags(),
    noteCategories: org.listCategories(),
    taskTags: new TaskTagStore(db.raw, profileId).listTags(),
    taskTemplateNames: new TaskTemplateStore(db.raw, profileId).list().map((row) => row.name),
    eventTemplateNames: new EventTemplateStore(db.raw, profileId).list().map((row) => row.name),
    noteTemplateNames: new Set(new NoteTemplateStore(db.raw, profileId).list().map((row) => row.name)),
    // ADR-051's four identity indexes, composed with core's own key functions
    // for the reason `main/restore.ts` composes them that way: one spelling of
    // each key, or the rule quietly stops matching. This fixture's target
    // profile is empty of all four, which is what these tests want — they are
    // about the STORE's insert, not about the planner's duplicate rule (which
    // `foreignImport.test.ts` owns) — but they are read off the real stores all
    // the same, so a target that gained rows would be answered honestly.
    attachmentHashes: new Set(
      new NoteStore(db.raw, profileId)
        .list()
        .flatMap((meta) => new NoteAttachmentStore(db.raw, profileId).list(meta.id))
        .map((row) => row.sha256),
    ),
    eventKeys: new Set(new EventStore(db.raw, profileId).listActive().map(eventDuplicateKey)),
    personKeys: new Set(new PeopleStore(db.raw, profileId).listActive().map(personDuplicateKey)),
    documentKeys: new Set(
      new DocumentStore(db.raw, profileId).listActive().map(documentDuplicateKey),
    ),
    claimsCaptureDefault: org.listFolders().some((folder) => folder.isCaptureDefault),
    // FIN (migration 051): the categories absorb by the `(kind, name)` PAIR, so
    // the target index carries the kind — and the budget slots are read off the
    // same store, so a target that already limits a (category, currency) is
    // answered honestly.
    finCategories: finCategories.list(),
    finBudgetKeys: new Set(finCategories.listBudgets().map(finBudgetKey)),
  };
}

function rowCount(table: string): number {
  const row = db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

function makeTask(overrides: Partial<ExportTask> & { id: string; listId: string }): ExportTask {
  return {
    profileId: "ignored",
    parentId: null,
    title: "Zadatak",
    description: null,
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
    sectionId: null,
    rank: FIRST_RANK,
    ...overrides,
  };
}

function makeList(overrides: Partial<ExportTaskList> & { id: string }): ExportTaskList {
  return {
    profileId: "ignored",
    parentId: null,
    name: "Lista",
    isInbox: false,
    defaultView: "list",
    rank: FIRST_RANK,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeFolder(overrides: Partial<ExportNoteFolder> & { id: string }): ExportNoteFolder {
  return {
    profileId: "ignored",
    parentId: null,
    name: "Fascikla",
    color: null,
    defaultTemplateId: null,
    isCaptureDefault: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeNote(overrides: Partial<ExportNote> & { id: string }): ExportNote {
  return {
    profileId: "ignored",
    title: "Beleška",
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

describe("ForeignImportStore", () => {
  describe("merging a planned archive into a profile that already has data", () => {
    it("inserts every planned row under the plan's own ids and leaves the target's rows untouched", () => {
      const source = createProfile("Izvor");
      seedProfile(source, "S");
      const target = createProfile("Odredište");
      seedProfile(target, "T");

      const before = gather(target);
      const plan = planForeignImport({ data: gather(source), dropped: [], profilePicture: null, privateNotes: { notes: 0, versions: 0 } }, targetFor(target), uuidv7);
      const written = new ForeignImportStore(db.raw, target).insertPlanned(plan.data, new Map(), NOW);
      expect(written).toBeGreaterThan(0);

      const after = gather(target);

      // Every row the target had is still there, byte for byte: an import is
      // additive, so nothing already in the profile may move or change.
      for (const row of before.tasks) {
        expect(after.tasks.find((candidate) => candidate.id === row.id)).toEqual(row);
      }
      for (const row of before.taskLists) {
        expect(after.taskLists.find((candidate) => candidate.id === row.id)).toEqual(row);
      }
      for (const row of before.noteFolders) {
        expect(after.noteFolders.find((candidate) => candidate.id === row.id)).toEqual(row);
      }
      for (const row of before.cards) {
        expect(after.cards.find((candidate) => candidate.id === row.id)).toEqual(row);
      }

      // And every row the PLAN carried arrived under the id the planner minted
      // for it — the identity contract the whole slice rests on.
      const afterTaskIds = new Set(after.tasks.map((row) => row.id));
      for (const task of plan.data.tasks) expect(afterTaskIds.has(task.id)).toBe(true);
      const afterCardIds = new Set(after.cards.map((row) => row.id));
      for (const card of plan.data.cards) expect(afterCardIds.has(card.id)).toBe(true);
      const afterFolderIds = new Set(after.noteFolders.map((row) => row.id));
      for (const folder of plan.data.noteFolders) expect(afterFolderIds.has(folder.id)).toBe(true);

      // Counts add up on every module: the target's own rows plus the plan's.
      expect(after.tasks).toHaveLength(before.tasks.length + plan.data.tasks.length);
      expect(after.taskLists).toHaveLength(before.taskLists.length + plan.data.taskLists.length);
      expect(after.events).toHaveLength(before.events.length + plan.data.events.length);
      expect(after.subjects).toHaveLength(before.subjects.length + plan.data.subjects.length);
      expect(after.cards).toHaveLength(before.cards.length + plan.data.cards.length);
      expect(after.reviewLog).toHaveLength(before.reviewLog.length + plan.data.reviewLog.length);
      expect(after.notes).toHaveLength(before.notes.length + plan.data.notes.length);
      expect(after.noteAttachments).toHaveLength(
        before.noteAttachments.length + plan.data.noteAttachments.length,
      );
      expect(after.taskDependencies).toHaveLength(
        before.taskDependencies.length + plan.data.taskDependencies.length,
      );
      expect(after.finAccounts).toHaveLength(
        before.finAccounts.length + plan.data.finAccounts.length,
      );
      expect(after.finTransactions).toHaveLength(
        before.finTransactions.length + plan.data.finTransactions.length,
      );
    });

    it("merges a ledger: accounts import whole, the shared category absorbs, its budget slot loses", () => {
      const source = createProfile("Izvor");
      seedProfile(source, "S");
      const target = createProfile("Odredište");
      seedProfile(target, "T");

      const before = gather(target);
      const plan = planForeignImport(
        { data: gather(source), dropped: [], profilePicture: null, privateNotes: { notes: 0, versions: 0 } },
        targetFor(target),
        uuidv7,
      );
      new ForeignImportStore(db.raw, target).insertPlanned(plan.data, new Map(), NOW);
      const after = gather(target);

      // BOTH accounts import as their own rows: two accounts called the same
      // thing in two profiles are two different accounts at two different banks,
      // and merging them would be the worst guess this planner could make.
      expect(after.finAccounts).toHaveLength(before.finAccounts.length + 2);

      // „Hrana" (expense) exists in both profiles, so it ABSORBS — one row
      // survives, and the source's transaction now points at the TARGET's.
      const hrana = after.finCategories.filter(
        (row) => row.name === "Hrana" && row.kind === "expense",
      );
      expect(hrana).toHaveLength(1);
      expect(hrana[0]?.id).toBe(
        before.finCategories.find((row) => row.name === "Hrana")?.id,
      );
      // „S plata" / „T plata" differ, so the income category imports as its own.
      expect(after.finCategories.filter((row) => row.kind === "income")).toHaveLength(2);

      // The target already limits (Hrana, RSD), so the source's allowance is
      // skipped and the target's own limit stands — a foreign import never
      // updates a pre-existing row.
      expect(after.finBudgets).toHaveLength(before.finBudgets.length);
      expect(after.finBudgets).toEqual(before.finBudgets);
      expect(
        plan.report.skips.find((reason) => reason.code === "budget-slot-taken"),
      ).toMatchObject({ module: "finance", type: "fin-budget", count: 1 });

      // The transfer arrived as ONE row naming two accounts of THIS profile.
      const transfers = after.finTransactions.filter((row) => row.counterAccountId !== null);
      expect(transfers).toHaveLength(2); // the target's own, plus the imported one
      const accountIds = new Set(after.finAccounts.map((row) => row.id));
      for (const transfer of transfers) {
        expect(accountIds.has(transfer.accountId)).toBe(true);
        expect(accountIds.has(transfer.counterAccountId ?? "")).toBe(true);
      }
    });

    it("brings a PAUSED subscription in still paused (ADR-074)", () => {
      const source = createProfile("Izvor");
      seedProfile(source, "S");
      const target = createProfile("Odredište");
      seedProfile(target, "T");

      const sourceSubscriptions = new FinRecurringStore(db.raw, source);
      const subscription = sourceSubscriptions.listActive()[0];
      expect(subscription).toBeDefined();
      sourceSubscriptions.pause(subscription!.id, "2026-03-01T09:00:00.000Z");

      const plan = planForeignImport(
        { data: gather(source), dropped: [], profilePicture: null, privateNotes: { notes: 0, versions: 0 } },
        targetFor(target),
        uuidv7,
      );
      new ForeignImportStore(db.raw, target).insertPlanned(plan.data, new Map(), NOW);

      // Whether a subscription charges is a fact about the ROW, not a reference
      // into the source profile, so the planner remaps around it and it arrives
      // untouched: the target's own is still charging, the imported one is still
      // paused. Crossing a profile boundary is no reason to start taking
      // somebody's money again.
      const after = new FinRecurringStore(db.raw, target).listActive();
      expect(after).toHaveLength(2);
      expect(after.map((row) => row.pausedAt).sort()).toEqual([
        "2026-03-01T09:00:00.000Z",
        null,
      ]);
    });

    it("merges habits: both same-named rows survive, each keeping its own days (migration 055)", () => {
      const source = createProfile("Izvor");
      seedProfile(source, "S");
      const target = createProfile("Odredište");
      seedProfile(target, "T");

      const before = gather(target);
      const plan = planForeignImport(
        { data: gather(source), dropped: [], profilePicture: null, privateNotes: { notes: 0, versions: 0 } },
        targetFor(target),
        uuidv7,
      );
      new ForeignImportStore(db.raw, target).insertPlanned(plan.data, new Map(), NOW);

      const habits = new HabitStore(db.raw, target);
      const after = habits.listActive();
      // „Trčanje" exists in both profiles and is MINTED anyway — a habit carries
      // a schedule a merge would have to overwrite, and two people's runs are
      // two histories, not one. So the target ends with two rows of that name.
      expect(after.filter((habit) => habit.name === "Trčanje")).toHaveLength(2);
      expect(after).toHaveLength(before.habits.length + 1);

      // Every imported day landed on the NEW row rather than on the target's own
      // — which is what keeps each streak reading exactly what it read before.
      const entries = habits.listAllEntries({ from: "1900-01-01", to: "9999-12-31" });
      expect(entries).toHaveLength(before.habitEntries.length + 2);
      const habitIds = new Set(after.map((habit) => habit.id));
      for (const entry of entries) expect(habitIds.has(entry.habitId)).toBe(true);
      const perHabit = new Map<string, number>();
      for (const entry of entries) perHabit.set(entry.habitId, (perHabit.get(entry.habitId) ?? 0) + 1);
      expect([...perHabit.values()]).toEqual([2, 2]);
    });

    it("carries a cloze card's deletion NUMBER through the merge untouched (ADR-068)", () => {
      // The planner re-mints ids and nothing else; this store writes what it is
      // handed. A labelled deletion's number is not a position, so anything
      // that "helpfully" renumbered here would point the imported card at a
      // blank its author never wrote.
      const source = createProfile("Izvor");
      const target = createProfile("Odredište");
      const subject = new SubjectStore(db.raw, source).create({ name: "Predmet" });
      const deck = new DeckStore(db.raw, source).create({ subjectId: subject.id, name: "Špil" });
      const clozeText = "Glavni grad je {{c9::Beograd}}, a reka je {{c4::Sava}}.";
      new CardStore(db.raw, source).createCloze(deck.id, clozeText, "2026-01-01T00:00:00.000Z");

      const plan = planForeignImport(
        { data: gather(source), dropped: [], profilePicture: null, privateNotes: { notes: 0, versions: 0 } },
        targetFor(target),
        uuidv7,
      );
      new ForeignImportStore(db.raw, target).insertPlanned(plan.data, new Map(), NOW);

      const importedDeck = new DeckStore(db.raw, target).listActive()[0];
      const imported = new CardStore(db.raw, target).listByDeck(importedDeck?.id ?? "");
      expect(imported.map((card) => card.clozeOrdinal)).toEqual([4, 9]);
      expect(imported.every((card) => card.clozeText === clozeText)).toBe(true);
    });

    it("files the source's Inbox tasks into the target's own Inbox and imports no second Inbox", () => {
      const source = createProfile("Izvor");
      const target = createProfile("Odredište");
      const sourceTasks = new TaskStore(db.raw, source);
      sourceTasks.create({ title: "Iz tuđeg Inboxa" });

      const targetInbox = targetFor(target).inboxListId;
      const plan = planForeignImport({ data: gather(source), dropped: [], profilePicture: null, privateNotes: { notes: 0, versions: 0 } }, targetFor(target), uuidv7);
      new ForeignImportStore(db.raw, target).insertPlanned(plan.data, new Map(), NOW);

      const lists = new TaskListStore(db.raw, target).listActive();
      expect(lists.filter((list) => list.isInbox)).toHaveLength(1);
      const imported = new TaskStore(db.raw, target).listActive();
      expect(imported).toHaveLength(1);
      expect(imported[0]?.listId).toBe(targetInbox);
    });

    it("attaches a merged tag's links to the target's existing tag row without inserting a second tag", () => {
      const source = createProfile("Izvor");
      const target = createProfile("Odredište");
      const targetTag = new TaskTagStore(db.raw, target).createTag("Posao", "2026-01-01T00:00:00.000Z");

      const sourceTags = new TaskTagStore(db.raw, source);
      const sourceTag = sourceTags.createTag("Posao", "2026-01-01T00:00:00.000Z");
      const sourceTask = new TaskStore(db.raw, source).create({ title: "Tuđi zadatak" });
      sourceTags.attachTag(sourceTask.id, sourceTag.id);

      const plan = planForeignImport({ data: gather(source), dropped: [], profilePicture: null, privateNotes: { notes: 0, versions: 0 } }, targetFor(target), uuidv7);
      new ForeignImportStore(db.raw, target).insertPlanned(plan.data, new Map(), NOW);

      const tags = new TaskTagStore(db.raw, target);
      expect(tags.listTags()).toHaveLength(1);
      expect(tags.listTagLinks()).toEqual([
        { taskId: plan.data.tasks[0]?.id, tagId: targetTag.id },
      ]);
    });

    it("re-binds its own profile id over whatever the rows carry", () => {
      const target = createProfile("Odredište");
      const inbox = targetFor(target).inboxListId;
      const listId = uuidv7();
      const taskId = uuidv7();
      const planned: ProfileData = {
        ...emptyProfileData(),
        // Stamped with a profile that is emphatically not this store's — R4: a
        // store scoped to one profile writes that profile's rows and no other.
        taskLists: [makeList({ id: listId, profileId: "some-other-profile" })],
        tasks: [makeTask({ id: taskId, listId, profileId: "some-other-profile" })],
      };

      new ForeignImportStore(db.raw, target).insertPlanned(planned, new Map(), NOW);

      expect(new TaskStore(db.raw, target).listActive().map((row) => row.id)).toEqual([taskId]);
      expect(new TaskListStore(db.raw, target).listActive().map((row) => row.id)).toContain(listId);
      expect(new TaskListStore(db.raw, target).listActive().map((row) => row.id)).toContain(inbox);
    });
  });

  describe("insertion order", () => {
    it("inserts a child before its parent in the plan's own array order without deferring foreign keys", () => {
      const target = createProfile("Odredište");
      const parentListId = uuidv7();
      const childListId = uuidv7();
      const parentTaskId = uuidv7();
      const childTaskId = uuidv7();
      const parentFolderId = uuidv7();
      const childFolderId = uuidv7();

      // Every self-referencing array lists the CHILD first — the order an
      // archive is perfectly entitled to have, since a data file is written in
      // whatever order the exporting store read its rows.
      const planned: ProfileData = {
        ...emptyProfileData(),
        taskLists: [
          makeList({ id: childListId, parentId: parentListId, name: "Dete" }),
          makeList({ id: parentListId, name: "Roditelj" }),
        ],
        tasks: [
          makeTask({ id: childTaskId, listId: childListId, parentId: parentTaskId }),
          makeTask({ id: parentTaskId, listId: parentListId }),
        ],
        noteFolders: [
          makeFolder({ id: childFolderId, parentId: parentFolderId, name: "Dete" }),
          makeFolder({ id: parentFolderId, name: "Roditelj" }),
        ],
      };

      expect(() =>
        new ForeignImportStore(db.raw, target).insertPlanned(planned, new Map(), NOW),
      ).not.toThrow();

      const lists = new TaskListStore(db.raw, target).listActive();
      expect(lists.find((row) => row.id === childListId)?.parentId).toBe(parentListId);
      const folders = new NoteOrgStore(db.raw, target).listFolders();
      expect(folders.find((row) => row.id === childFolderId)?.parentId).toBe(parentFolderId);
      expect(new TaskStore(db.raw, target).listActive().find((row) => row.id === childTaskId)?.parentId)
        .toBe(parentTaskId);
    });

    it("refuses a reference to a row that is in no array and not already in the profile", () => {
      const target = createProfile("Odredište");
      const planned: ProfileData = {
        ...emptyProfileData(),
        tasks: [makeTask({ id: uuidv7(), listId: uuidv7() })],
      };

      expect(() =>
        new ForeignImportStore(db.raw, target).insertPlanned(planned, new Map(), NOW),
      ).toThrow();
      expect(new TaskStore(db.raw, target).listActive()).toEqual([]);
    });
  });

  describe("notes", () => {
    // NOTE-002 / migration 049. Categories are inserted BEFORE the notes whose
    // `category_id` names them — foreign keys stay enforced in this store, so
    // the order is what makes the insert legal at all.
    it("inserts a planned category and lands its notes on it", () => {
      const target = createProfile("Odredište");
      const categoryId = uuidv7();
      const noteId = uuidv7();
      const at = "2026-01-01T00:00:00.000Z";
      const planned: ProfileData = {
        ...emptyProfileData(),
        noteCategories: [
          { id: categoryId, profileId: "ignored", name: "sastanak", color: "zlato", createdAt: at, updatedAt: at },
        ],
        notes: [makeNote({ id: noteId, categoryId })],
      };

      const written = new ForeignImportStore(db.raw, target).insertPlanned(planned, new Map(), NOW);

      expect(written).toBe(2);
      expect(new NoteOrgStore(db.raw, target).listCategories()).toEqual([
        { id: categoryId, profileId: target, name: "sastanak", color: "zlato", createdAt: at, updatedAt: at },
      ]);
      expect(new NoteStore(db.raw, target).list()[0]?.categoryId).toBe(categoryId);
    });

    // The planner absorbs a category whose name the target already holds, so
    // the plan carries NO row for it and the notes already name the target's
    // id — the additive-only store simply writes the note.
    it("leaves the target's own category untouched when the plan names it directly", () => {
      const target = createProfile("Odredište");
      const org = new NoteOrgStore(db.raw, target);
      const mine = org.createCategory({ name: "sastanak", color: "suma" }, NOW);
      const noteId = uuidv7();

      new ForeignImportStore(db.raw, target).insertPlanned(
        { ...emptyProfileData(), notes: [makeNote({ id: noteId, categoryId: mine.id })] },
        new Map(),
        NOW,
      );

      expect(org.listCategories()).toEqual([mine]);
      expect(new NoteStore(db.raw, target).list()[0]?.categoryId).toBe(mine.id);
    });

    it("writes each note's snapshot, its derived plaintext and the highest covered_seq of its versions", () => {
      const target = createProfile("Odredište");
      const noteId = uuidv7();
      const snapshot = bytes(8, 3);
      const planned: ProfileData = {
        ...emptyProfileData(),
        notes: [makeNote({ id: noteId, snapshot })],
        noteVersions: [
          { noteId, coveredSeq: 1, title: "v1", createdAt: "2026-01-01T00:01:00.000Z", snapshot: bytes(6) },
          { noteId, coveredSeq: 4, title: "v4", createdAt: "2026-01-01T00:02:00.000Z", snapshot: bytes(6, 1) },
        ],
      };
      const derived = new Map<string, RestoredNoteDerived>([
        [noteId, { plaintext: "Telo beleške", linkTargets: [] }],
      ]);

      new ForeignImportStore(db.raw, target).insertPlanned(planned, derived, NOW);

      const row = db.raw
        .prepare("SELECT plaintext, covered_seq AS coveredSeq FROM note_snapshots WHERE note_id = ?")
        .get(noteId) as { plaintext: string; coveredSeq: number };
      expect(row).toEqual({ plaintext: "Telo beleške", coveredSeq: 4 });
      expect(new NoteStore(db.raw, target).load(noteId).snapshot).toEqual(snapshot);
    });

    it("writes note_links only for targets the plan itself carries", () => {
      const target = createProfile("Odredište");
      const existing = new NoteStore(db.raw, target).create("2026-01-01T00:00:00.000Z");
      const sourceNoteId = uuidv7();
      const importedTargetId = uuidv7();
      const planned: ProfileData = {
        ...emptyProfileData(),
        notes: [
          makeNote({ id: sourceNoteId, snapshot: bytes(4) }),
          makeNote({ id: importedTargetId }),
        ],
      };
      const derived = new Map<string, RestoredNoteDerived>([
        [
          sourceNoteId,
          {
            plaintext: "Telo",
            // Three targets: one this plan carries, one that is a note of the
            // TARGET profile (a wiki-link the planner could not have remapped —
            // it never saw that id), and one that resolves to nothing at all.
            linkTargets: [importedTargetId, existing.id, uuidv7(), importedTargetId],
          },
        ],
        [importedTargetId, { plaintext: "", linkTargets: [] }],
      ]);

      new ForeignImportStore(db.raw, target).insertPlanned(planned, derived, NOW);

      const links = db.raw
        .prepare("SELECT source_note_id AS source, target_note_id AS target FROM note_links")
        .all() as { source: string; target: string }[];
      expect(links).toEqual([{ source: sourceNoteId, target: importedTargetId }]);
    });

    it("refuses a note that has state but no derived entry, writing nothing", () => {
      const target = createProfile("Odredište");
      const planned: ProfileData = {
        ...emptyProfileData(),
        noteTags: [
          { id: uuidv7(), profileId: "ignored", name: "Oznaka", createdAt: "2026-01-01T00:00:00.000Z" },
        ],
        notes: [makeNote({ id: uuidv7(), snapshot: bytes(4) })],
      };

      expect(() => new ForeignImportStore(db.raw, target).insertPlanned(planned, new Map(), NOW)).toThrow(
        RestoreValidationError,
      );
      expect(rowCount("notes")).toBe(0);
      expect(rowCount("note_tags")).toBe(0);
    });
  });

  describe("what it deliberately does not write", () => {
    it("skips notifications and dashboard settings even when a caller hands them over", () => {
      const target = createProfile("Odredište");
      const planned: ProfileData = {
        ...emptyProfileData(),
        notifications: [
          {
            id: uuidv7(),
            profileId: "ignored",
            source: "exam",
            entityId: uuidv7(),
            occurrenceKey: "occ",
            title: "Podsetnik",
            body: "Telo",
            status: "delivered",
            snoozedUntil: null,
            deliveredAt: "2026-01-01T08:00:00.000Z",
            createdAt: "2026-01-01T08:00:00.000Z",
            updatedAt: "2026-01-01T08:00:00.000Z",
          },
        ],
        dashboardSettings: [
          {
            profileId: "ignored",
            backgroundHash: "a".repeat(64),
            backgroundMime: "image/png",
            backgroundSizeBytes: 10,
            backgroundDim: 70,
          },
        ],
      };

      const written = new ForeignImportStore(db.raw, target).insertPlanned(planned, new Map(), NOW);

      expect(written).toBe(0);
      expect(rowCount("notifications")).toBe(0);
      expect(rowCount("dashboard_settings")).toBe(0);
      // The target's own dashboard row is what the app still reads: absent means
      // the defaults, which is exactly what it meant before the import.
      expect(new DashboardSettingsStore(db.raw, target).get().backgroundHash).toBeNull();
    });

    // The store executes whatever the plan carries — `planForeignImport` plans
    // this member EMPTY by design (founder, 2026-07-31), so no real import
    // reaches this statement today, but the executor stays total over
    // `ProfileData` and is pinned here on its own terms.
    it("writes a planned dashboard placement, additively and under this profile", () => {
      const target = createProfile("Odredište");
      const t = "2026-01-01T00:00:00.000Z";
      const planned: ProfileData = {
        ...emptyProfileData(),
        dashboardWidgets: [
          {
            instanceId: "dw-imported", profileId: "ignored", widgetId: "finance:budzet",
            size: "S", rank: FIRST_RANK, config: '{"a":1}', createdAt: t, updatedAt: t,
          },
        ],
      };

      const written = new ForeignImportStore(db.raw, target).insertPlanned(planned, new Map(), NOW);

      expect(written).toBe(1);
      expect(new DashboardWidgetStore(db.raw, target).listAll()).toEqual([
        {
          instanceId: "dw-imported", profileId: target, widgetId: "finance:budzet",
          size: "S", rank: FIRST_RANK, config: '{"a":1}', createdAt: t, updatedAt: t,
          setId: null,
        },
      ]);
    });

    // The same terms one table over (ADR-055): the planner plans sets EMPTY by
    // design, and the executor stays total over `ProfileData` regardless.
    it("writes a planned dashboard set, additively and under this profile", () => {
      const target = createProfile("Odredište");
      const t = "2026-01-01T00:00:00.000Z";
      const planned: ProfileData = {
        ...emptyProfileData(),
        dashboardSets: [
          { id: "dset-imported", profileId: "ignored", name: "Tabla", rank: FIRST_RANK, createdAt: t, updatedAt: t },
        ],
        dashboardWidgets: [
          {
            instanceId: "dw-in-set", profileId: "ignored", widgetId: "finance:budzet",
            size: "S", rank: FIRST_RANK, config: null, createdAt: t, updatedAt: t, setId: "dset-imported",
          },
        ],
      };

      const written = new ForeignImportStore(db.raw, target).insertPlanned(planned, new Map(), NOW);

      expect(written).toBe(2);
      expect(new DashboardSetStore(db.raw, target).list()).toEqual([
        { id: "dset-imported", profileId: target, name: "Tabla", rank: FIRST_RANK, createdAt: t, updatedAt: t },
      ]);
      expect(new DashboardWidgetStore(db.raw, target).listAll().map((row) => row.setId)).toEqual([
        "dset-imported",
      ]);
    });

    // STUDY-007's preferences never arrive here: the planner drops them by
    // design (the target's workload choices are their own), so the store has no
    // statement for them and the row must survive any import untouched.
    it("leaves the target's own study settings alone when the plan carries none", () => {
      const target = createProfile("Odredište");
      const settings = new StudySettingsStore(db.raw, target);
      settings.save({ targetRetention: 0.8, newPerDay: 3, maxReviewsPerDay: 25 }, NOW);

      new ForeignImportStore(db.raw, target).insertPlanned(emptyProfileData(), new Map(), NOW);

      expect(settings.get()).toEqual({
        targetRetention: 0.8,
        newPerDay: 3,
        maxReviewsPerDay: 25,
      });
    });

    it("refuses a task that names no list", () => {
      const target = createProfile("Odredište");
      const planned: ProfileData = {
        ...emptyProfileData(),
        tasks: [{ ...makeTask({ id: uuidv7(), listId: "unused" }), listId: null }],
      };

      expect(() => new ForeignImportStore(db.raw, target).insertPlanned(planned, new Map(), NOW)).toThrow(
        RestoreValidationError,
      );
      expect(rowCount("tasks")).toBe(0);
    });
  });

  describe("atomicity", () => {
    it("writes nothing at all when a row partway through the plan is refused", () => {
      const source = createProfile("Izvor");
      seedProfile(source, "S");
      const target = createProfile("Odredište");
      seedProfile(target, "T");

      const before = gather(target);
      const plan = planForeignImport({ data: gather(source), dropped: [], profilePicture: null, privateNotes: { notes: 0, versions: 0 } }, targetFor(target), uuidv7);
      const refusedEvent = plan.data.events[0];
      expect(refusedEvent).toBeDefined();

      // Events are inserted well after the tasks, lists, tags and attachments
      // above them, so a refusal here proves the whole prefix rolls back rather
      // than merely that the failing statement did nothing. A trigger body takes
      // no parameters, hence the interpolated id — a generated uuid in a test,
      // with the store's own "always bind" rule untouched.
      db.raw.exec(
        `CREATE TRIGGER refuse_event BEFORE INSERT ON events
         WHEN NEW.id = '${refusedEvent?.id ?? ""}'
         BEGIN SELECT RAISE(ABORT, 'refused'); END`,
      );
      try {
        expect(() =>
          new ForeignImportStore(db.raw, target).insertPlanned(plan.data, new Map(), NOW),
        ).toThrow();
      } finally {
        db.raw.exec("DROP TRIGGER refuse_event");
      }

      expect(gather(target)).toEqual(before);
    });
  });
});

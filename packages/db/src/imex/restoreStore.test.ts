import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  FocusStore,
  NexusDatabase,
  NoteAttachmentStore,
  NoteOrgStore,
  NoteStore,
  NoteTemplateStore,
  NotificationStore,
  PeopleStore,
  PlanStore,
  ProfileStore,
  RestoreStore,
  RestoreValidationError,
  RESTORE_WIPE_TABLES,
  SqliteFlagStore,
  StudySettingsStore,
  SubjectAttachmentStore,
  SubjectNoteLinkStore,
  SubjectStore,
  TASK_ORDER_GAP,
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

function emptyProfileData(): ProfileData {
  return {
    tasks: [],
    taskLists: [],
    taskSections: [],
    taskTags: [],
    taskTagLinks: [],
    taskAttachments: [],
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
    plans: [],
    blocks: [],
    focusSessions: [],
    studySettings: [],
    notifications: [],
    notes: [],
    noteFolders: [],
    noteTags: [],
    noteTagLinks: [],
    noteTemplates: [],
    noteAttachments: [],
    noteVersions: [],
    taskTemplates: [],
    dashboardSettings: [],
    dashboardSets: [],
    dashboardWidgets: [],
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

  const plan = planStore.createPlan(
    { examId: exam.id, dailyMinutes: 30, startDate: "2026-06-01", examWeekBoost: true },
    t0,
    "2026-01-01",
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

  const editedNote = noteStore.create(t0);
  noteStore.setFolder(editedNote.id, folder.id);
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
        defaultView: "list", viewConfig: null, position: 1024, ...timestamps,
      },
    ],
    tasks: [
      {
        id: uuidv7(), profileId: "ignored", parentId: null, title: "Fresh task", description: null,
        status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
        completedAt: null, recurrence: null, reminderOffsets: [],
        listId, sectionId: null, position: 1024, ...timestamps,
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
    ]);

    const wipeTables = new Set<string>(RESTORE_WIPE_TABLES);
    const unaccounted = tables.filter((table) => !wipeTables.has(table) && !allowlist.has(table));

    expect(unaccounted).toEqual([]);
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
      position: 0,
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
      position: 0,
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
      defaultView: "list", viewConfig: null, position: 1024, ...timestamps,
    };
    const task: ExportTask = {
      id: uuidv7(), profileId: "ignored", parentId: null, title: "Prvog u mesecu", description: null,
      status: "todo", priority: "none", done: false, dueDate: "2026-08-01", startDate: null,
      completedAt: null,
      recurrence: { freq: { kind: "monthly-date", interval: 1, day: 1 }, end: { kind: "count", total: 12 } },
      reminderOffsets: [7, 0], // deliberately unsorted, like the event's below
      listId, sectionId: null, position: 1024,
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

  it("restores a task's list, section and position verbatim (TASK-004 / ADR-029)", () => {
    const profileB = createProfile(db, "placement");
    const timestamps = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const inboxId = uuidv7();
    const workId = uuidv7();
    const sectionId = uuidv7();
    const taskLists: TaskList[] = [
      {
        id: inboxId, profileId: "ignored", parentId: null, name: "Inbox", isInbox: true,
        defaultView: "list", viewConfig: null, position: 1024, ...timestamps,
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
        position: 2048, ...timestamps,
      },
    ];
    const taskSections: TaskSection[] = [
      { id: sectionId, listId: workId, name: "U toku", position: 1024, ...timestamps },
    ];
    const task: ExportTask = {
      id: uuidv7(), profileId: "ignored", parentId: null, title: "U sekciji", description: null,
      status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
      completedAt: null, recurrence: null, reminderOffsets: [],
      // Negative on purpose: prepending walks below zero, and a restore that
      // normalized it would silently re-order the user's list.
      listId: workId, sectionId, position: -1024, ...timestamps,
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

  it("restores a task's tags and their links verbatim, ids and all (migration 023)", () => {
    const profileB = createProfile(db, "tags");
    const timestamps = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const listId = uuidv7();
    const taskLists: TaskList[] = [
      {
        id: listId, profileId: "ignored", parentId: null, name: "Inbox", isInbox: true,
        defaultView: "list", viewConfig: null, position: 1024, ...timestamps,
      },
    ];
    const taskTags: TaskTag[] = [
      { id: uuidv7(), profileId: "ignored", name: "posao", createdAt: timestamps.createdAt },
      { id: uuidv7(), profileId: "ignored", name: "kasnije", createdAt: timestamps.createdAt },
    ];
    const task = (title: string): ExportTask => ({
      id: uuidv7(), profileId: "ignored", parentId: null, title, description: null,
      status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
      completedAt: null, recurrence: null, reminderOffsets: [],
      listId, sectionId: null, position: 1024, ...timestamps,
    });
    const first = task("Prvi");
    const second = task("Drugi");
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
        defaultView: "list", viewConfig: null, position: 1024, ...timestamps,
      },
    ];
    const task = (title: string): ExportTask => ({
      id: uuidv7(), profileId: "ignored", parentId: null, title, description: null,
      status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
      completedAt: null, recurrence: null, reminderOffsets: [],
      listId, sectionId: null, position: 1024, ...timestamps,
    });
    const first = task("Prvi");
    const second = task("Drugi");
    const third = task("Treći");
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

  it("maps an older archive's list-less tasks into a freshly minted Inbox, gap-spaced in the archive's own order", () => {
    const profileB = createProfile(db, "era-default");
    const timestamps = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    // What `parseImportArchive` hands back for a pre-1.3.0 archive: no lists at
    // all, and every task defaulted to null/null/0 (`ArchiveEra`).
    const legacyTask = (title: string): ExportTask => ({
      id: uuidv7(), profileId: "ignored", parentId: null, title, description: null,
      status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
      completedAt: null, recurrence: null, reminderOffsets: [],
      listId: null, sectionId: null, position: 0, ...timestamps,
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
    expect(restored.map((row) => row.position)).toEqual([
      TASK_ORDER_GAP,
      2 * TASK_ORDER_GAP,
      3 * TASK_ORDER_GAP,
    ]);
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
        defaultView: "list", viewConfig: null, position: 1024, ...timestamps,
      },
    ];
    const task: ExportTask = {
      id: uuidv7(), profileId: "ignored", parentId: null, title: "Bez liste", description: null,
      status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
      completedAt: null, recurrence: null, reminderOffsets: [],
      listId: null, sectionId: null, position: 0, ...timestamps,
    };

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "Era2", profilePicture: null, settings: emptySettings(), data: { ...emptyProfileData(), taskLists, tasks: [task] }, derived: new Map() },
      NOW,
    );

    const lists = new TaskListStore(db.raw, profileB).listActive();
    expect(lists.map((row) => row.id)).toEqual([inboxId]);
    expect(lists[0]?.name).toBe("Prijemno"); // the archive's row, not a fresh one
    expect(new TaskStore(db.raw, profileB).listActive()[0]).toMatchObject({
      listId: inboxId,
      position: TASK_ORDER_GAP,
    });
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

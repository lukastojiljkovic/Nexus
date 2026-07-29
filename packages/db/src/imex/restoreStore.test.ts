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
  CardStore,
  DeckStore,
  DocumentStore,
  EventStore,
  ExamStore,
  FocusStore,
  NexusDatabase,
  NoteAttachmentStore,
  NoteOrgStore,
  NoteStore,
  NoteTemplateStore,
  NotificationStore,
  PlanStore,
  RestoreStore,
  RestoreValidationError,
  RESTORE_WIPE_TABLES,
  SqliteFlagStore,
  SubjectStore,
  TaskStore,
  openDatabase,
  uuidv7,
} from "../index.js";
import type {
  Card,
  Deck,
  Event,
  Exam,
  FocusSession,
  NoteFolder,
  NoteMeta,
  NoteTag,
  NoteTemplate,
  NotificationRecord,
  RestoredNoteDerived,
  RestoreProfileInput,
  StudyPlan,
  Subject,
  Task,
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
  handle.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, new Date().toISOString());
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
    events: [],
    documents: [],
    renewals: [],
    subjects: [],
    exams: [],
    decks: [],
    cards: [],
    reviewLog: [],
    plans: [],
    blocks: [],
    focusSessions: [],
    notifications: [],
    notes: [],
    noteFolders: [],
    noteTags: [],
    noteTagLinks: [],
    noteTemplates: [],
    noteAttachments: [],
    noteVersions: [],
  };
}

function emptySettings(): ExportSettings {
  return {
    flags: {},
    notifications: { quietFrom: null, quietTo: null, morningHour: "08:00", enabledSources: [] },
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
  event: Event;
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
  const eventStore = new EventStore(handle.raw, profileId);
  const documentStore = new DocumentStore(handle.raw, profileId);
  const subjectStore = new SubjectStore(handle.raw, profileId);
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

  // The merged Yjs state and derived body an export would carry for the edited
  // note — stand-ins for real Yjs bytes (see `bytes()`), but genuinely stored
  // by `compact` below and genuinely reproduced by a restore.
  const editedSnapshot = bytes(8, 99);
  const editedPlaintext = `${name} note plaintext`;

  const parentTask = taskStore.create({ title: `${name} parent task` });
  const childTask = taskStore.create({ title: `${name} child task`, parentId: parentTask.id });

  const event = eventStore.create({ title: `${name} event`, startAt: "2026-03-01T10:00:00.000Z" });

  const document = documentStore.create({
    docType: "pasos",
    label: `${name} document`,
    expiryDate: "2027-01-01",
  });
  documentStore.renew(document.id, "2028-01-01");

  const subject = subjectStore.create({ name: `${name} subject` });
  const exam = examStore.create({ subjectId: subject.id, examType: "pismeni", examDate: "2030-01-01" });
  const deck = deckStore.create({ subjectId: subject.id, name: `${name} deck` });
  const createdCard = cardStore.create({ deckId: deck.id, front: "Q", back: "A" }, t0);
  cardStore.review(createdCard.id, 3, "2026-01-02T00:00:00.000Z");

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

  const neverEditedNote = noteStore.create("2026-01-01T00:04:00.000Z");

  const template = templateStore.save(
    `${name} template`,
    JSON.stringify({ type: "doc", content: [] }),
    "2026-01-01T00:05:00.000Z",
  );

  const data: ProfileData = {
    tasks: taskStore.listActive(),
    events: eventStore.listActive(),
    documents: documentStore.listActive(),
    renewals: documentStore.listRenewals(document.id),
    subjects: subjectStore.listActive(),
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
      event,
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
  return {
    ...emptyProfileData(),
    tasks: [
      {
        id: uuidv7(), profileId: "ignored", parentId: null, title: "Fresh task", description: null,
        status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
        completedAt: null, recurrence: null, ...timestamps,
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
  expect(new EventStore(handle.raw, readProfileId).listActive()).toEqual(remap(fixture.data.events));
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
      },
    };

    const written = new RestoreStore(freshDb.raw, profileB).replaceProfileData(
      { profileName: "Restored profile", settings, data: fixtureA.data, derived: fixtureA.derived },
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
      { profileName: "A", settings: emptySettings(), data: fixtureA.data, derived: fixtureA.derived },
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

  it("T2: totality of replacement — old rows gone, new rows exact, every module the archive omits ends up empty", () => {
    const profileB = createProfile(db, "B");
    seedFixture(db, profileB, "Old"); // B starts with live rows in every module.
    const fresh = freshArchiveData(); // tasks, subjects and templates only

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "B replaced", settings: emptySettings(), data: fresh, derived: new Map() },
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

    // Every module the archive carried zero rows for is empty, though B had one in each.
    expect(new EventStore(db.raw, profileB).listActive()).toEqual([]);
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

    // Including the child tables no store lists on its own — the ones a wipe
    // that leaned on ON DELETE CASCADE would be most likely to miss.
    for (const table of ["document_renewals", "note_versions", "note_attachments", "note_tag_links"]) {
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
    const allowlist = new Set<string>([
      "meta",
      "profiles",
      "search_entries",
      "search_fts",
      "search_fts_data",
      "search_fts_idx",
      "search_fts_docsize",
      "search_fts_config",
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
    };
    const child: ExportTask = { id: childId, profileId: "ignored", parentId, title: "Child", ...base };
    const parent: ExportTask = { id: parentId, profileId: "ignored", parentId: null, title: "Parent", ...base };

    const data: ProfileData = { ...emptyProfileData(), tasks: [child, parent] }; // child BEFORE parent

    expect(() =>
      new RestoreStore(db.raw, profileB).replaceProfileData(
        { profileName: "T4", settings: emptySettings(), data, derived: new Map() },
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
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const parent: ExportNoteFolder = {
      id: parentId,
      profileId: "ignored",
      parentId: null,
      name: "Parent",
      color: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const data: ProfileData = { ...emptyProfileData(), noteFolders: [child, parent] }; // child BEFORE parent

    expect(() =>
      new RestoreStore(db.raw, profileB).replaceProfileData(
        { profileName: "T4", settings: emptySettings(), data, derived: new Map() },
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
        { profileName: "Should not stick", settings: emptySettings(), data, derived: new Map() },
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
    };

    const data: ProfileData = { ...emptyProfileData(), notes: [note], tasks: [task] };
    const derived = new Map<string, RestoredNoteDerived>([
      [note.id, { plaintext: "Ovo je stvarni tekst beleške za pretragu.", linkTargets: [] }],
    ]);

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "T6", settings: emptySettings(), data, derived },
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
      { profileName: "T7", settings: emptySettings(), data, derived },
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
      { profileName: "T8", settings: emptySettings(), data, derived },
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
      },
    };

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "After rename", settings, data: emptyProfileData(), derived: new Map() },
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
    });

    const profileRow = db.raw.prepare("SELECT name FROM profiles WHERE id = ?").get(profileB) as {
      name: string;
    };
    expect(profileRow.name).toBe("After rename");
  });

  it("T10: restoring into profile B never touches profile A's rows", () => {
    const profileA = createProfile(db, "A");
    const fixtureA = seedFixture(db, profileA, "A");
    const profileB = createProfile(db, "B");
    seedFixture(db, profileB, "B-old");

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "B restored", settings: emptySettings(), data: freshArchiveData(), derived: new Map() },
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
        { profileName: "B", settings: emptySettings(), data: fixtureA.data, derived: fixtureA.derived },
        NOW,
      ),
    ).toThrow(/UNIQUE constraint failed/);

    assertModulesMatch(db, profileA, fixtureA, profileA);
    assertModulesMatch(db, profileB, fixtureB, profileB);
  });

  it("restores a recurring task's rule and a series master's rule and exceptions verbatim (ADR-024)", () => {
    const profileB = createProfile(db, "recurrence");
    const timestamps = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const task: ExportTask = {
      id: uuidv7(), profileId: "ignored", parentId: null, title: "Prvog u mesecu", description: null,
      status: "todo", priority: "none", done: false, dueDate: "2026-08-01", startDate: null,
      completedAt: null,
      recurrence: { freq: { kind: "monthly-date", interval: 1, day: 1 }, end: { kind: "count", total: 12 } },
      ...timestamps,
    };
    const event: ExportEvent = {
      id: uuidv7(), profileId: "ignored", title: "Petkom", description: null,
      startAt: "2026-07-10T09:00:00.000Z", endAt: null, allDay: false, location: null, category: null,
      recurrence: { freq: { kind: "weekly", interval: 1, days: [4] }, end: { kind: "never" } },
      recurrenceExdates: ["2026-08-14", "2026-07-17"], // deliberately unsorted; order carries no meaning in an archive
      ...timestamps,
    };
    const data: ProfileData = { ...emptyProfileData(), tasks: [task], events: [event] };

    new RestoreStore(db.raw, profileB).replaceProfileData(
      { profileName: "Recurrence", settings: emptySettings(), data, derived: new Map() },
      NOW,
    );

    // Read back through the stores, so this also proves the restore wrote the
    // exact canonical text those stores accept — anything else reads as
    // corruption and throws rather than returning a row.
    expect(new TaskStore(db.raw, profileB).listActive()).toEqual([{ ...task, profileId: profileB }]);
    // The exceptions come back ascending: the column is canonical however the
    // archive happened to list them.
    expect(new EventStore(db.raw, profileB).listActive()).toEqual([
      { ...event, profileId: profileB, recurrenceExdates: ["2026-07-17", "2026-08-14"] },
    ]);
  });

  it("throws RestoreValidationError when a note has a non-null snapshot but no matching entry in derived (R9)", () => {
    const profileB = createProfile(db, "R9");
    const note = makeNote({ id: uuidv7(), title: "Orphaned derived", snapshot: bytes(4) });
    const data: ProfileData = { ...emptyProfileData(), notes: [note] };

    expect(() =>
      new RestoreStore(db.raw, profileB).replaceProfileData(
        { profileName: "R9", settings: emptySettings(), data, derived: new Map() },
        NOW,
      ),
    ).toThrow(RestoreValidationError);

    // And nothing was left half-written: the note itself did not survive the rollback.
    expect(new NoteStore(db.raw, profileB).list()).toEqual([]);
  });
});

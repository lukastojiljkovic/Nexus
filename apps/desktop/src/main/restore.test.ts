import { createHash } from "node:crypto";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZipFile } from "yazl";
import * as Y from "yjs";

import {
  buildExportArchive,
  countProfileModules,
  createArchiveWriter,
  mergeNoteState,
  type ArchiveKdfParams,
  type ExportArchive,
  type ExportArchiveInput,
  type ExportSettings,
  type ProfileData,
} from "@nexus/core";
import { deriveArchiveKey, generateSalt } from "@nexus/core/auth";
import {
  CardStore,
  DashboardSettingsStore,
  DashboardWidgetStore,
  DeckStore,
  DocumentStore,
  EventStore,
  EventTemplateStore,
  ExamStore,
  FocusStore,
  ForeignImportStore,
  NexusDatabase,
  NoteAttachmentStore,
  NoteOrgStore,
  NoteStore,
  NoteTemplateStore,
  NotificationStore,
  PeopleStore,
  PlanStore,
  RestoreStore,
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
  openDatabase,
  uuidv7,
} from "@nexus/db";
import type {
  Card,
  Deck,
  Event,
  Exam,
  NoteFolder,
  NoteMeta,
  NoteTag,
  NoteTemplate,
  NotificationRecord,
  Person,
  RestoredNoteDerived,
  Subject,
  Task,
  TaskList,
  TaskSection,
  TaskTag,
} from "@nexus/db";

import * as archiveReaderModule from "./archiveReader.js";
import { deriveRestoredNotes, gatherProfileData } from "./profileData.js";
import type { ProfileDataDeps } from "./profileData.js";
import {
  applyImport,
  applyRestore,
  cancelImport,
  cancelRestore,
  clearRestoreState,
  pickImportFile,
  pickRestoreFile,
  previewImport,
  previewRestore,
  restoreStatus,
  undoRestore,
  type ImportDeps,
} from "./restore.js";

/**
 * `restore.ts` holds two pieces of state at MODULE scope (`pending`/`undo`),
 * so every test in this file shares one instance across the whole run —
 * `clearRestoreState()` between tests is what keeps them from bleeding into
 * each other, exactly as the slice's own spec requires.
 */
afterEach(() => {
  clearRestoreState();
});

// --- Fixture plumbing --------------------------------------------------------

let dir: string;
let dbA: NexusDatabase;
let dbB: NexusDatabase;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-restore-"));
  dbA = openDatabase({ path: join(dir, "source.db") });
  dbB = openDatabase({ path: join(dir, "target.db") });
});

afterEach(async () => {
  vi.restoreAllMocks();
  dbA.close();
  dbB.close();
  await rm(dir, { recursive: true, force: true });
});

function fixturePath(name: string): string {
  return join(dir, name);
}

function hashUtf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function createProfile(handle: NexusDatabase, name: string): string {
  const id = uuidv7();
  const created = new Date().toISOString();
  handle.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, created);
  // The Inbox `main`'s own `seedFirstRunProfile` gives every profile it
  // creates (TASK-004): `TaskStore` refuses to place a task without one.
  new TaskListStore(handle.raw, id).ensureInbox(created);
  return id;
}

/** Every `ProfileDataDeps` getter, bound to one database — the same construction `main/index.ts` would do for a real profile, minus Electron. */
function profileDataDeps(handle: NexusDatabase): ProfileDataDeps {
  return {
    taskStore: (profileId) => new TaskStore(handle.raw, profileId),
    taskListStore: (profileId) => new TaskListStore(handle.raw, profileId),
    taskTagStore: (profileId) => new TaskTagStore(handle.raw, profileId),
    taskAttachmentStore: (profileId) => new TaskAttachmentStore(handle.raw, profileId),
    taskTemplateStore: (profileId) => new TaskTemplateStore(handle.raw, profileId),
    taskDependencyStore: (profileId) => new TaskDependencyStore(handle.raw, profileId),
    eventStore: (profileId) => new EventStore(handle.raw, profileId),
    eventTemplateStore: (profileId) => new EventTemplateStore(handle.raw, profileId),
    peopleStore: (profileId) => new PeopleStore(handle.raw, profileId),
    documentStore: (profileId) => new DocumentStore(handle.raw, profileId),
    subjectStore: (profileId) => new SubjectStore(handle.raw, profileId),
    subjectAttachmentStore: (profileId) => new SubjectAttachmentStore(handle.raw, profileId),
    subjectNoteLinkStore: (profileId) => new SubjectNoteLinkStore(handle.raw, profileId),
    examStore: (profileId) => new ExamStore(handle.raw, profileId),
    deckStore: (profileId) => new DeckStore(handle.raw, profileId),
    cardStore: (profileId) => new CardStore(handle.raw, profileId),
    planStore: (profileId) => new PlanStore(handle.raw, profileId),
    studySettingsStore: (profileId) => new StudySettingsStore(handle.raw, profileId),
    focusStore: (profileId) => new FocusStore(handle.raw, profileId),
    notificationStore: (profileId) => new NotificationStore(handle.raw, profileId),
    noteStore: (profileId) => new NoteStore(handle.raw, profileId),
    noteOrgStore: (profileId) => new NoteOrgStore(handle.raw, profileId),
    noteTemplateStore: (profileId) => new NoteTemplateStore(handle.raw, profileId),
    noteAttachmentStore: (profileId) => new NoteAttachmentStore(handle.raw, profileId),
    flagStore: (profileId) => new SqliteFlagStore(handle.raw, profileId),
    dashboardSettingsStore: (profileId) => new DashboardSettingsStore(handle.raw, profileId),
    dashboardWidgetStore: (profileId) => new DashboardWidgetStore(handle.raw, profileId),
  };
}

interface TestDepsHandle {
  /** The superset both flows run on: a restore reads only `RestoreDeps` from it, an import also the additive store (ADR-043). */
  deps: ImportDeps;
  /** Stands in for the on-disk encrypted blob store: `sha256 -> bytes`, exactly what `created`/deletion observability needs. */
  blobs: Map<string, Uint8Array>;
  cancelFocusCalls: string[];
  getReloadCount: () => number;
}

/**
 * Everything `RestoreDeps` needs, wired to real store classes over `handle`
 * (so every restore/undo actually goes through `RestoreStore`'s real
 * transaction) except the five genuinely-external things the module spec
 * calls out: the native dialog, the renderer reload, the focus-cancel call,
 * and the blob store — those are test doubles backed by a plain in-memory map
 * so `created`/orphan-deletion are directly observable.
 */
function makeTestDeps(handle: NexusDatabase, filePath: string | null): TestDepsHandle {
  const blobs = new Map<string, Uint8Array>();
  const cancelFocusCalls: string[] = [];
  let reloadCount = 0;

  const deps: ImportDeps = {
    ...profileDataDeps(handle),
    restoreStore: (profileId) => new RestoreStore(handle.raw, profileId),
    foreignImportStore: (profileId) => new ForeignImportStore(handle.raw, profileId),
    getProfile: (profileId) => {
      const row = handle.raw.prepare("SELECT id, name FROM profiles WHERE id = ?").get(profileId) as
        | { id: string; name: string }
        | undefined;
      if (!row) throw new Error(`Test setup: no profile "${profileId}".`);
      return row;
    },
    pickArchiveFile: async () => filePath,
    reloadRenderer: () => {
      reloadCount += 1;
    },
    cancelFocusSession: (profileId) => {
      cancelFocusCalls.push(profileId);
    },
    saveBlob: async (bytes) => {
      const sha256 = sha256OfBytes(bytes);
      const created = !blobs.has(sha256);
      if (created) blobs.set(sha256, bytes);
      return { sha256, created };
    },
    // The REAL union `main/index.ts` computes, spelled the same way over the
    // same stores — a double that counted only notes would let the GC test
    // below pass while the app still deleted a task's file or the background
    // the dashboard shows (ADR-041 section 3). Every member is
    // profile-agnostic, so the id is never read.
    blobRefCount: (profileId, sha256) =>
      new NoteAttachmentStore(handle.raw, profileId).refCount(sha256) +
      new TaskAttachmentStore(handle.raw, profileId).refCount(sha256) +
      new SubjectAttachmentStore(handle.raw, profileId).refCount(sha256) +
      new DashboardSettingsStore(handle.raw, profileId).refCount(sha256),
    deleteBlobIfOrphaned: async (sha256, refCount) => {
      if (refCount === 0) blobs.delete(sha256);
    },
  };

  return { deps, blobs, cancelFocusCalls, getReloadCount: () => reloadCount };
}

/** A tick past `setTimeout(…, 0)` — what `applyRestore`/`undoRestore` schedule their renderer reload on. */
function flushSetTimeout(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Encodes a `Y.Doc` whose "default" fragment holds one paragraph: a text run
 * plus a real `noteLink` node — the shape `extractNoteLinkTargets`/
 * `collectNoteLinkIds` (`@nexus/core`) walk for. Every level is attached to
 * the doc — root fragment, then `paragraph`, then its children — BEFORE
 * anything is pushed/inserted INTO it: `AbstractType#push` reads `this.length`
 * (and `XmlText#insert` similarly needs a resolved position), and either one
 * on a type whose `.doc` is still null logs Yjs's own "Invalid access"
 * warning. Integrating top-down first, content second, is what avoids it.
 */
function noteSnapshotWithLink(targetNoteId: string, text: string, linkLabel: string): Uint8Array {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  doc.getXmlFragment("default").push([paragraph]);

  const textNode = new Y.XmlText();
  const link = new Y.XmlElement("noteLink");
  paragraph.push([textNode, link]);

  textNode.insert(0, text);
  link.setAttribute("noteId", targetNoteId);
  link.setAttribute("label", linkLabel);

  const snapshot = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return snapshot;
}

interface SeededFixture {
  data: ProfileData;
  derived: Map<string, RestoredNoteDerived>;
  settings: ExportSettings;
  /** The plaintext bytes behind every attachment this fixture declares, keyed by their own sha256 — what feeds the zip's `blobs/<sha256>` entries. */
  blobBytes: Map<string, Uint8Array>;
  ids: {
    task: Task;
    list: TaskList;
    section: TaskSection;
    taskTag: TaskTag;
    event: Event;
    person: Person;
    subject: Subject;
    exam: Exam;
    deck: Deck;
    card: Card;
    notification: NotificationRecord;
    note: NoteMeta;
    linkedNote: NoteMeta;
    folder: NoteFolder;
    tag: NoteTag;
    template: NoteTemplate;
    attachmentSha: string;
    /** The blob referenced ONLY by the task attachment — the one whose survival proves the GC union (migration 024). */
    taskAttachmentSha: string;
    /** The blob referenced ONLY by the subject material — the same proof, for the union's fourth member (migration 035). */
    subjectAttachmentSha: string;
    /** The dashboard background's own hash (ADR-041) — a SECOND, independent member of the archive's `blobs/` union. */
    backgroundSha: string;
  };
}

/**
 * Seeds one profile with a real row in every one of the five archive modules
 * — tasks, calendar, study, notifications, notes (with a folder, a tag, a
 * real Yjs note carrying a genuine wiki-link, an attachment, a version and a
 * template) — entirely through the real store classes, mirroring
 * `restoreStore.test.ts`'s own `seedFixture`. Returns the `ProfileData`/
 * `derived`/`settings` an export would gather, ready to feed straight into
 * `buildExportArchive`.
 */
function seedProfile(handle: NexusDatabase, profileId: string, label: string): SeededFixture {
  const t0 = "2026-01-01T00:00:00.000Z";

  const taskStore = new TaskStore(handle.raw, profileId);
  const taskListStore = new TaskListStore(handle.raw, profileId);
  const taskTagStore = new TaskTagStore(handle.raw, profileId);
  const taskAttachmentStore = new TaskAttachmentStore(handle.raw, profileId);
  const taskDependencyStore = new TaskDependencyStore(handle.raw, profileId);
  const eventStore = new EventStore(handle.raw, profileId);
  const eventTemplateStore = new EventTemplateStore(handle.raw, profileId);
  const peopleStore = new PeopleStore(handle.raw, profileId);
  const subjectStore = new SubjectStore(handle.raw, profileId);
  const subjectAttachmentStore = new SubjectAttachmentStore(handle.raw, profileId);
  const subjectNoteLinkStore = new SubjectNoteLinkStore(handle.raw, profileId);
  const examStore = new ExamStore(handle.raw, profileId);
  const deckStore = new DeckStore(handle.raw, profileId);
  const cardStore = new CardStore(handle.raw, profileId);
  const notificationStore = new NotificationStore(handle.raw, profileId);
  const noteStore = new NoteStore(handle.raw, profileId);
  const orgStore = new NoteOrgStore(handle.raw, profileId);
  const attachmentStore = new NoteAttachmentStore(handle.raw, profileId);
  const templateStore = new NoteTemplateStore(handle.raw, profileId);
  const taskTemplateStore = new TaskTemplateStore(handle.raw, profileId);
  const dashboardStore = new DashboardSettingsStore(handle.raw, profileId);
  const dashboardWidgetStore = new DashboardWidgetStore(handle.raw, profileId);

  // A real list with a section, and the task filed inside it (TASK-004), so the
  // zip round trip carries a task's placement and not just the Inbox default.
  const list = taskListStore.createList({ name: `${label} list` }, t0);
  const section = taskListStore.createSection(list.id, `${label} section`, t0);

  // Dated and laddered (ADR-028), so the whole zip round trip below carries a
  // task's reminder ladder as well as its plain fields.
  const task = taskStore.create({
    title: `${label} task`,
    dueDate: "2026-03-05",
    reminderOffsets: [0, 3],
    listId: list.id,
    sectionId: section.id,
  });
  // A real tag on that task (migration 023), so the zip round trip carries a
  // task-tag row AND the join that needs both of its ends.
  const taskTag = taskTagStore.createTag(`${label} task tag`, t0);
  taskTagStore.attachTag(task.id, taskTag.id);
  // A second task purely so there is a real dependency edge to push through the
  // zip round trip (migration 029 / ADR-037) — an edge needs two live ends, and
  // its DIRECTION is the whole record.
  const blockerTask = taskStore.create({ title: `${label} blocker`, listId: list.id });
  taskDependencyStore.addDependency(blockerTask.id, task.id);

  // A real file on that task (migration 024), with bytes of its own so the zip
  // round trip carries a blob NO note attachment references.
  const taskAttachmentBytes = new TextEncoder().encode(`${label} task attachment content`);
  const taskAttachmentSha = sha256OfBytes(taskAttachmentBytes);
  taskAttachmentStore.add(
    task.id,
    {
      fileName: "ugovor.pdf",
      mime: "application/pdf",
      sizeBytes: taskAttachmentBytes.length,
      sha256: taskAttachmentSha,
    },
    "2026-01-01T00:02:00.000Z",
  );

  // A template with a fully-populated nested payload (ADR-035) — the one row in
  // this fixture whose value is JSON inside JSON, so the zip round trip has to
  // carry it through NDJSON and back without flattening or reordering it.
  taskTemplateStore.saveByName(
    `${label} task template`,
    {
      title: `${label} from template`,
      description: "Opis",
      priority: "high",
      dueOffsetDays: 3,
      reminderOffsets: [0, 1],
      recurrence: { freq: { kind: "weekly", interval: 1, days: [1] }, end: { kind: "never" } },
      tagNames: [`${label} task tag`],
      subtaskTitles: ["Prvi korak"],
    },
    t0,
  );

  const event = eventStore.create({ title: `${label} event`, startAt: "2026-03-01T10:00:00.000Z" });
  // CAL-009: captured FROM that event, so the fixture's second nested payload is
  // one a real store produced rather than one written by hand here.
  eventTemplateStore.captureFromEvent(event.id, `${label} event template`, t0);
  // A leap-day birthday (CAL-007): the pair migration 020's CHECKs cannot vet,
  // so it is the person shape worth pushing through a whole zip round trip.
  const person = peopleStore.create(
    { name: `${label} person`, kind: "birthday", month: 2, day: 29, year: 1992, note: "Beleška" },
    t0,
  );
  const subject = subjectStore.create({ name: `${label} subject` });
  // A real material on that subject (migration 035), with bytes of its own so
  // the zip round trip carries a THIRD blob no other table references — the
  // member of `blobRefCount`'s union this lane added.
  const subjectAttachmentBytes = new TextEncoder().encode(`${label} subject material content`);
  const subjectAttachmentSha = sha256OfBytes(subjectAttachmentBytes);
  subjectAttachmentStore.add(
    subject.id,
    {
      fileName: "skripta.pdf",
      mime: "application/pdf",
      sizeBytes: subjectAttachmentBytes.length,
      sha256: subjectAttachmentSha,
    },
    "2026-01-01T00:02:00.000Z",
  );
  const exam = examStore.create({ subjectId: subject.id, examType: "pismeni", examDate: "2030-01-01" });
  const deck = deckStore.create({ subjectId: subject.id, name: `${label} deck` });
  const card = cardStore.create({ deckId: deck.id, front: "Q", back: "A" }, t0);
  const notification = notificationStore.recordDelivered(
    { source: "exam", entityId: exam.id, occurrenceKey: `${label}-occ`, title: "Podsetnik", body: "Telo poruke" },
    t0,
  );

  const folder = orgStore.createFolder({ parentId: null, name: `${label} folder`, color: "zlato" }, t0);
  const tag = orgStore.createTag(`${label} tag`, t0);

  // A bare, never-edited note — purely so `note` below has a real id to link to.
  const linkedNote = noteStore.create(t0);

  const note = noteStore.create(t0);
  noteStore.setFolder(note.id, folder.id);
  const update = noteSnapshotWithLink(linkedNote.id, `${label} note body`, "Linked note");
  noteStore.appendUpdate(note.id, update, `${label} note`, "2026-01-01T00:01:00.000Z");
  orgStore.attachTag(note.id, tag.id);

  const attachmentBytes = new TextEncoder().encode(`${label} attachment content`);
  const attachmentSha = sha256OfBytes(attachmentBytes);
  attachmentStore.add(
    note.id,
    { fileName: "a.png", mime: "image/png", sizeBytes: attachmentBytes.length, sha256: attachmentSha },
    "2026-01-01T00:02:00.000Z",
  );

  noteStore.captureVersion(note.id, update, 1, "2026-01-01T00:03:00.000Z");

  // Compacted for real, so the profile genuinely holds the merged snapshot the
  // gathered `ProfileData` below claims it does (mirrors `restoreStore.test.ts`).
  const merged = mergeNoteState(null, [update]);
  noteStore.compact(note.id, merged.snapshot, merged.plaintext, 1, "2026-01-01T00:03:00.000Z");

  // That note filed under the subject (migration 035): a cross-MODULE edge whose
  // two ends live in two different NDJSON files.
  subjectNoteLinkStore.linkNote(subject.id, note.id, "2026-01-01T00:03:00.000Z");

  const template = templateStore.save(`${label} template`, JSON.stringify({ type: "doc", content: [] }), t0);

  // A dashboard background with its OWN blob (ADR-041): a second, independent
  // entry in the archive's `blobs/` union, so the round trip proves the
  // settings row and its bytes both travel — and that the union is a union.
  const backgroundBytes = new TextEncoder().encode(`${label} background content`);
  const backgroundSha = sha256OfBytes(backgroundBytes);
  dashboardStore.setBackground("a".repeat(64), "image/png", 1, t0); // replaced below; proves a re-pick keeps the dim
  dashboardStore.setDim(70, t0);
  dashboardStore.setBackground(backgroundSha, "image/png", backgroundBytes.length, t0);
  // ADR-045: a rearranged layout, so the fixture carries real widget rows —
  // adding one materializes the default five beside it.
  dashboardWidgetStore.add("study:ispiti", "L", t0);

  const taskLists = taskListStore.listActive();
  const data: ProfileData = {
    tasks: taskStore.listActive(),
    taskLists,
    taskSections: taskLists.flatMap((row) => taskListStore.listSections(row.id)),
    taskTags: taskTagStore.listTags(),
    taskTagLinks: taskTagStore.listTagLinks(),
    taskAttachments: taskAttachmentStore.list(task.id),
    taskTemplates: taskTemplateStore.list(),
    taskDependencies: taskDependencyStore.listLinks(),
    events: eventStore.listActive(),
    eventTemplates: eventTemplateStore.list(),
    documents: [],
    renewals: [],
    people: peopleStore.listActive(),
    subjects: subjectStore.listActive(),
    subjectAttachments: subjectAttachmentStore.list(subject.id),
    subjectNoteLinks: subjectNoteLinkStore.listLinks(),
    exams: examStore.listActive(),
    decks: deckStore.listActive(),
    cards: cardStore.listByDeck(deck.id),
    reviewLog: cardStore.listReviewLog(),
    plans: [],
    blocks: [],
    focusSessions: [],
    // STUDY-007: always exactly one row, since `get` resolves the defaults.
    studySettings: [{ profileId, ...new StudySettingsStore(handle.raw, profileId).get() }],
    notifications: notificationStore.listAll(),
    notes: noteStore.list().map((meta) => ({
      ...meta,
      snapshot: meta.id === note.id ? merged.snapshot : null,
    })),
    noteFolders: orgStore.listFolders(),
    noteTags: orgStore.listTags(),
    noteTagLinks: orgStore.listTagLinks(),
    noteTemplates: templateStore.list(),
    noteAttachments: attachmentStore.list(note.id),
    noteVersions: noteStore.listVersions(note.id).map((version) => ({
      noteId: note.id,
      coveredSeq: version.coveredSeq,
      title: version.title,
      createdAt: version.createdAt,
      snapshot: noteStore.loadVersion(note.id, version.coveredSeq),
    })),
    dashboardSettings: [{ profileId, ...dashboardStore.get() }],
    dashboardWidgets: dashboardWidgetStore.listAll(),
  };

  const derived = deriveRestoredNotes(data.notes);

  const settings: ExportSettings = {
    flags: { notes: true },
    notifications: { quietFrom: null, quietTo: null, morningHour: "08:00", enabledSources: ["exam"] },
  };

  const blobBytes = new Map<string, Uint8Array>([
    [attachmentSha, attachmentBytes],
    [taskAttachmentSha, taskAttachmentBytes],
    [subjectAttachmentSha, subjectAttachmentBytes],
    [backgroundSha, backgroundBytes],
  ]);

  return {
    data,
    derived,
    settings,
    blobBytes,
    ids: { task, list, section, taskTag, event, person, subject, exam, deck, card, notification, note, linkedNote, folder, tag, template, attachmentSha, taskAttachmentSha, subjectAttachmentSha, backgroundSha },
  };
}

function buildArchiveFor(
  fixture: Pick<SeededFixture, "data" | "settings">,
  profileId: string,
  profileName: string,
): ExportArchive {
  const input: ExportArchiveInput = {
    profile: { id: profileId, name: profileName },
    appVersion: "0.1.0-test",
    createdAt: "2026-02-01T00:00:00.000Z",
    settings: fixture.settings,
    data: fixture.data,
    hash: hashUtf8,
  };
  return buildExportArchive(input);
}

/**
 * Builds a real zip byte stream (`yazl`, the same writer `main/imex.ts`
 * uses) from a `buildExportArchive` result, resolving each `"attachment"`
 * binary entry against `blobBytes`. `omitBlobShas` lets a test simulate an
 * archive whose attachment ROW survived but whose `blobs/<sha256>` entry did
 * not — every entry here is small, so `addBuffer` for all of them is fine.
 */
async function buildArchiveZip(
  archive: Pick<ExportArchive, "files" | "binaries">,
  blobBytes: ReadonlyMap<string, Uint8Array>,
  omitBlobShas: ReadonlySet<string> = new Set(),
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zipfile = new ZipFile();
    for (const [path, content] of archive.files) {
      zipfile.addBuffer(Buffer.from(content, "utf8"), path);
    }
    for (const entry of archive.binaries) {
      if (entry.kind === "bytes") {
        zipfile.addBuffer(Buffer.from(entry.bytes), entry.path);
        continue;
      }
      if (omitBlobShas.has(entry.sha256)) continue; // simulate a missing blob file
      const bytes = blobBytes.get(entry.sha256);
      if (!bytes) {
        reject(new Error(`Test fixture is missing blob bytes for "${entry.sha256}".`));
        return;
      }
      zipfile.addBuffer(Buffer.from(bytes), entry.path);
    }
    const chunks: Buffer[] = [];
    zipfile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zipfile.outputStream.on("error", reject);
    zipfile.end();
  });
}

/** The minimum Argon2id cost `validateKdfParams` accepts — mirrors `archiveReader.test.ts`'s own `CHEAP_KDF`, kept fast on purpose. */
const CHEAP_KDF: ArchiveKdfParams = {
  algorithm: "argon2id",
  memoryKiB: 8192,
  iterations: 1,
  parallelism: 1,
};

/** Seals a zip byte stream into an `NXA1` container under `passphrase` — mirrors `archiveReader.test.ts`'s own `sealAsNxa1`. */
async function sealAsNxa1(zipBytes: Buffer, passphrase: string): Promise<Buffer> {
  const salt = generateSalt();
  const key = await deriveArchiveKey(passphrase, salt, CHEAP_KDF);
  const writer = await createArchiveWriter({ key, salt, kdf: CHEAP_KDF });
  const parts: Buffer[] = [Buffer.from(writer.headerBlock)];
  let offset = 0;
  while (zipBytes.length - offset >= writer.chunkBytes) {
    const frame = await writer.seal(zipBytes.subarray(offset, offset + writer.chunkBytes), false);
    parts.push(Buffer.from(frame));
    offset += writer.chunkBytes;
  }
  parts.push(Buffer.from(await writer.seal(zipBytes.subarray(offset), true)));
  return Buffer.concat(parts);
}

function unreachable(): never {
  throw new Error("Test setup: expected a different preview status.");
}

// --- Tests --------------------------------------------------------------------

describe("restore", () => {
  describe("full round trip", () => {
    it("restores every module's rows, a note's real Yjs state, and its note_links into a fresh database", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");
      const zipBytes = await buildArchiveZip(archive, fixtureA.blobBytes);
      const filePath = fixturePath("roundtrip.nexus.zip");
      await writeFile(filePath, zipBytes);

      const profileB = createProfile(dbB, "B-target");
      const { deps, blobs, cancelFocusCalls, getReloadCount } = makeTestDeps(dbB, filePath);

      const pick = await pickRestoreFile(deps);
      expect(pick).toEqual({ canceled: false, path: filePath, fileName: "roundtrip.nexus.zip", encrypted: false });

      const preview = await previewRestore(deps, profileB, null);
      if (preview.status !== "ready") unreachable();
      expect(preview.preview.sourceProfileName).toBe("A");
      expect(preview.preview.targetProfileName).toBe("B-target");
      expect(preview.preview.encrypted).toBe(false);

      const result = await applyRestore(deps, profileB, preview.preview.token);
      expect(result.rowsWritten).toBeGreaterThan(0);
      // Four: the note attachment's blob, the task attachment's, the subject
      // material's (migration 035) and the dashboard background's (ADR-041) —
      // every member of the one `blobs/` union had to be written before the
      // transaction.
      expect(result.blobsAdded).toBe(4);
      expect(blobs.has(fixtureA.ids.taskAttachmentSha)).toBe(true);
      expect(blobs.has(fixtureA.ids.subjectAttachmentSha)).toBe(true);
      expect(blobs.has(fixtureA.ids.backgroundSha)).toBe(true);
      expect(result.missingBlobs).toBe(0);
      expect(result.restored).toEqual(countProfileModules(fixtureA.data));

      // Every module's rows landed under profile B, ids preserved.
      expect(new TaskStore(dbB.raw, profileB).listActive()).toEqual(
        fixtureA.data.tasks.map((row) => ({ ...row, profileId: profileB })),
      );
      expect(new EventStore(dbB.raw, profileB).listActive()).toEqual(
        fixtureA.data.events.map((row) => ({ ...row, profileId: profileB })),
      );
      expect(new PeopleStore(dbB.raw, profileB).listActive()).toEqual(
        fixtureA.data.people.map((row) => ({ ...row, profileId: profileB })),
      );
      expect(new SubjectStore(dbB.raw, profileB).listActive()).toEqual(
        fixtureA.data.subjects.map((row) => ({ ...row, profileId: profileB })),
      );
      expect(new NotificationStore(dbB.raw, profileB).listAll()).toEqual(
        fixtureA.data.notifications.map((row) => ({ ...row, profileId: profileB })),
      );
      expect(new NoteOrgStore(dbB.raw, profileB).listFolders()).toEqual(
        fixtureA.data.noteFolders.map((row) => ({ ...row, profileId: profileB })),
      );
      // The lists and the section a task was filed in travelled with it.
      const listsB = new TaskListStore(dbB.raw, profileB);
      expect(listsB.listActive()).toEqual(
        fixtureA.data.taskLists.map((row) => ({ ...row, profileId: profileB })),
      );
      expect(listsB.listSections(fixtureA.ids.list.id)).toEqual(
        fixtureA.data.taskSections.filter((row) => row.listId === fixtureA.ids.list.id),
      );
      // The tag and the link that joins it to that task travelled too — the one
      // module whose rows are worthless without their counterpart.
      const tagsB = new TaskTagStore(dbB.raw, profileB);
      expect(tagsB.listTags()).toEqual(
        fixtureA.data.taskTags.map((row) => ({ ...row, profileId: profileB })),
      );
      expect(tagsB.listTagLinks()).toEqual([
        { taskId: fixtureA.ids.task.id, tagId: fixtureA.ids.taskTag.id },
      ]);
      // The file hanging off that task travelled too — row AND blob.
      expect(new TaskAttachmentStore(dbB.raw, profileB).list(fixtureA.ids.task.id)).toEqual(
        fixtureA.data.taskAttachments,
      );
      expect(blobs.has(fixtureA.ids.taskAttachmentSha)).toBe(true);

      // The note's real Yjs state and its search-visible plaintext came out right.
      const notesB = new NoteStore(dbB.raw, profileB);
      const restoredNote = fixtureA.data.notes.find((note) => note.id === fixtureA.ids.note.id);
      if (!restoredNote) throw new Error("Test setup: seeded note missing from its own fixture.");
      expect(notesB.load(fixtureA.ids.note.id).snapshot).toEqual(restoredNote.snapshot);
      expect(notesB.storedPlaintext(fixtureA.ids.note.id)).toBe(
        fixtureA.derived.get(fixtureA.ids.note.id)?.plaintext,
      );

      // The wiki-link embedded in the note's Yjs content re-derived into note_links.
      const links = dbB.raw
        .prepare("SELECT source_note_id AS sourceNoteId, target_note_id AS targetNoteId FROM note_links WHERE source_note_id = ?")
        .all(fixtureA.ids.note.id) as { sourceNoteId: string; targetNoteId: string }[];
      expect(links).toEqual([{ sourceNoteId: fixtureA.ids.note.id, targetNoteId: fixtureA.ids.linkedNote.id }]);

      expect(new NoteAttachmentStore(dbB.raw, profileB).list(fixtureA.ids.note.id)).toEqual(
        fixtureA.data.noteAttachments,
      );
      expect(blobs.has(fixtureA.ids.attachmentSha)).toBe(true);

      expect(cancelFocusCalls).toEqual([profileB]);
      expect(getReloadCount()).toBe(0); // scheduled, not yet fired
      await flushSetTimeout();
      expect(getReloadCount()).toBe(1);
    });
  });

  describe("preview counts", () => {
    it("current/incoming are the real counts of the target profile and of the archive", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");
      const zipBytes = await buildArchiveZip(archive, fixtureA.blobBytes);
      const filePath = fixturePath("counts.nexus.zip");
      await writeFile(filePath, zipBytes);

      const profileB = createProfile(dbB, "B");
      const fixtureBOld = seedProfile(dbB, profileB, "B-old");

      const { deps } = makeTestDeps(dbB, filePath);
      await pickRestoreFile(deps);
      const preview = await previewRestore(deps, profileB, null);
      if (preview.status !== "ready") unreachable();

      expect(preview.preview.current).toEqual(countProfileModules(fixtureBOld.data));
      expect(preview.preview.incoming).toEqual(countProfileModules(fixtureA.data));
    });
  });

  describe("a tampered archive", () => {
    it("previews as invalid (checksum mismatch) and writes nothing", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");

      // Edit one NDJSON entry's content directly — the manifest's checksum for
      // it still names the ORIGINAL bytes, so this alone must fail verification.
      const tamperedFiles = new Map(archive.files);
      const originalTasks = tamperedFiles.get("data/tasks.ndjson") ?? "";
      tamperedFiles.set("data/tasks.ndjson", originalTasks.replace(fixtureA.ids.task.title, "Tampered title"));
      const zipBytes = await buildArchiveZip({ files: tamperedFiles, binaries: archive.binaries }, fixtureA.blobBytes);
      const filePath = fixturePath("tampered.nexus.zip");
      await writeFile(filePath, zipBytes);

      const profileB = createProfile(dbB, "B");
      const before = new TaskStore(dbB.raw, profileB).listActive();

      const { deps } = makeTestDeps(dbB, filePath);
      await pickRestoreFile(deps);
      const preview = await previewRestore(deps, profileB, null);
      expect(preview.status).toBe("invalid");
      if (preview.status !== "invalid") unreachable();
      expect(preview.problems).toContainEqual(
        expect.objectContaining({ severity: "error", code: "checksum-mismatch", path: "data/tasks.ndjson" }),
      );

      expect(new TaskStore(dbB.raw, profileB).listActive()).toEqual(before);
    });
  });

  describe("an NXA1 archive", () => {
    it("requires and validates its passphrase before previewing", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");
      const zipBytes = await buildArchiveZip(archive, fixtureA.blobBytes);
      const sealed = await sealAsNxa1(zipBytes, "correct horse battery staple");
      const filePath = fixturePath("encrypted.nexus");
      await writeFile(filePath, sealed);

      const profileB = createProfile(dbB, "B");
      const { deps } = makeTestDeps(dbB, filePath);

      const pick = await pickRestoreFile(deps);
      expect(pick).toEqual({ canceled: false, path: filePath, fileName: "encrypted.nexus", encrypted: true });

      await expect(previewRestore(deps, profileB, null)).resolves.toEqual({
        status: "unreadable",
        code: "passphrase-required",
      });
      await expect(previewRestore(deps, profileB, "wrong passphrase")).resolves.toEqual({
        status: "unreadable",
        code: "passphrase-wrong",
      });

      const ready = await previewRestore(deps, profileB, "correct horse battery staple");
      expect(ready.status).toBe("ready");
    });
  });

  describe("a wrong token", () => {
    it("applyRestore throws and writes nothing", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");
      const zipBytes = await buildArchiveZip(archive, fixtureA.blobBytes);
      const filePath = fixturePath("wrong-token.nexus.zip");
      await writeFile(filePath, zipBytes);

      const profileB = createProfile(dbB, "B");
      const before = new TaskStore(dbB.raw, profileB).listActive();

      const { deps } = makeTestDeps(dbB, filePath);
      await pickRestoreFile(deps);
      const preview = await previewRestore(deps, profileB, null);
      if (preview.status !== "ready") unreachable();

      await expect(applyRestore(deps, profileB, "not-the-real-token")).rejects.toThrow();

      expect(new TaskStore(dbB.raw, profileB).listActive()).toEqual(before);
    });
  });

  describe("undo", () => {
    it("restores the pre-restore state exactly and removes only the blobs the restore added that nothing else references", async () => {
      const profileSource = createProfile(dbA, "Source");
      const fixtureSource = seedProfile(dbA, profileSource, "Source");

      // A second, PRIVATE attachment on the same source note, so the archive
      // carries two distinct blobs: one shared with a bystander profile below,
      // one referenced by nothing else.
      const sourceAttachmentStore = new NoteAttachmentStore(dbA.raw, profileSource);
      const privateBytes = new TextEncoder().encode("Source private attachment");
      const privateSha = sha256OfBytes(privateBytes);
      sourceAttachmentStore.add(
        fixtureSource.ids.note.id,
        { fileName: "b.png", mime: "image/png", sizeBytes: privateBytes.length, sha256: privateSha },
        "2026-01-01T00:04:00.000Z",
      );
      const dataWithSecondAttachment: ProfileData = {
        ...fixtureSource.data,
        noteAttachments: sourceAttachmentStore.list(fixtureSource.ids.note.id),
      };
      const blobBytesForArchive = new Map(fixtureSource.blobBytes);
      blobBytesForArchive.set(privateSha, privateBytes);

      const archive = buildArchiveFor(
        { data: dataWithSecondAttachment, settings: fixtureSource.settings },
        profileSource,
        "Source",
      );
      const zipBytes = await buildArchiveZip(archive, blobBytesForArchive);
      const filePath = fixturePath("undo.nexus.zip");
      await writeFile(filePath, zipBytes);

      // A bystander profile, in the SAME database as the restore target, whose
      // own attachment references the SHARED hash — its refCount must survive.
      const profileBystander = createProfile(dbB, "Bystander");
      const bystanderNote = new NoteStore(dbB.raw, profileBystander).create("2026-01-01T00:00:00.000Z");
      new NoteAttachmentStore(dbB.raw, profileBystander).add(
        bystanderNote.id,
        {
          fileName: "shared.png",
          mime: "image/png",
          sizeBytes: fixtureSource.blobBytes.get(fixtureSource.ids.attachmentSha)?.length ?? 0,
          sha256: fixtureSource.ids.attachmentSha,
        },
        "2026-01-01T00:05:00.000Z",
      );
      // And a bystander TASK whose attachment is the ONLY thing left naming the
      // archive's task blob once the undo has run. Nothing in `note_attachments`
      // references it at any point, so a reference count that consulted only
      // that table would read 0 and delete a file the user still has attached —
      // which is precisely what the union in `blobRefCount` exists to prevent.
      const bystanderTask = new TaskStore(dbB.raw, profileBystander).create({ title: "Bystander task" });
      new TaskAttachmentStore(dbB.raw, profileBystander).add(
        bystanderTask.id,
        {
          fileName: "shared.pdf",
          mime: "application/pdf",
          sizeBytes: fixtureSource.blobBytes.get(fixtureSource.ids.taskAttachmentSha)?.length ?? 0,
          sha256: fixtureSource.ids.taskAttachmentSha,
        },
        "2026-01-01T00:05:00.000Z",
      );
      // And a bystander SUBJECT whose material is the only thing left naming the
      // archive's subject blob once the undo has run — the fourth member of the
      // union (migration 035), on exactly the terms the task one above states:
      // neither attachment table nor the dashboard row references this hash at
      // any point, so a count blind to `subject_attachments` would read 0 and
      // delete a course file the user still has.
      const bystanderSubject = new SubjectStore(dbB.raw, profileBystander).create({
        name: "Bystander subject",
      });
      new SubjectAttachmentStore(dbB.raw, profileBystander).add(
        bystanderSubject.id,
        {
          fileName: "shared-skripta.pdf",
          mime: "application/pdf",
          sizeBytes: fixtureSource.blobBytes.get(fixtureSource.ids.subjectAttachmentSha)?.length ?? 0,
          sha256: fixtureSource.ids.subjectAttachmentSha,
        },
        "2026-01-01T00:05:00.000Z",
      );

      // The restore target: one pre-existing row the restore will wipe.
      const profileTarget = createProfile(dbB, "Target");
      const preexistingTask = new TaskStore(dbB.raw, profileTarget).create({ title: "Will be wiped by restore" });

      const { deps, blobs } = makeTestDeps(dbB, filePath);
      await pickRestoreFile(deps);
      const preview = await previewRestore(deps, profileTarget, null);
      if (preview.status !== "ready") unreachable();

      // Five distinct blobs: the shared note one, the private note one, the
      // task one (which no note attachment anywhere references), the subject
      // material (which nothing else references either), and the dashboard
      // background (ADR-041) — one union, five distinct hashes.
      const applyResult = await applyRestore(deps, profileTarget, preview.preview.token);
      expect(applyResult.blobsAdded).toBe(5);
      expect(blobs.has(fixtureSource.ids.attachmentSha)).toBe(true);
      expect(blobs.has(privateSha)).toBe(true);
      expect(blobs.has(fixtureSource.ids.taskAttachmentSha)).toBe(true);
      expect(blobs.has(fixtureSource.ids.subjectAttachmentSha)).toBe(true);
      expect(blobs.has(fixtureSource.ids.backgroundSha)).toBe(true);

      const afterApply = new TaskStore(dbB.raw, profileTarget).listActive();
      expect(afterApply.map((row) => row.id)).not.toContain(preexistingTask.id);
      expect(afterApply.map((row) => row.id)).toContain(fixtureSource.ids.task.id);

      const undoResult = await undoRestore(deps, profileTarget);

      // The row the restore had removed is back; the row the restore added is gone.
      const afterUndo = new TaskStore(dbB.raw, profileTarget).listActive();
      expect(afterUndo).toEqual([preexistingTask]);
      expect(afterUndo.map((row) => row.id)).not.toContain(fixtureSource.ids.task.id);

      // The shared blob survives (the bystander profile still references it);
      // the private one, referenced by nothing after undo, is gone. So is the
      // dashboard background — and THAT is the union doing its job (ADR-041
      // section 3): its only referrer was a `dashboard_settings` row, which the
      // undo replaced, and nothing but `blobRefCount`'s second member could
      // have noticed that the last reference to those bytes had gone.
      expect(blobs.has(fixtureSource.ids.attachmentSha)).toBe(true);
      expect(blobs.has(privateSha)).toBe(false);
      // And the blob only a TASK attachment names survives too — the union.
      expect(blobs.has(fixtureSource.ids.taskAttachmentSha)).toBe(true);
      // As does the one only a SUBJECT MATERIAL names (migration 035): the
      // union's newest member, proved by exactly the same undo.
      expect(blobs.has(fixtureSource.ids.subjectAttachmentSha)).toBe(true);
      expect(blobs.has(fixtureSource.ids.backgroundSha)).toBe(false);
      expect(undoResult.blobsRemoved).toBe(2);
    });
  });

  describe("a missing blob", () => {
    it("previews with a warning, restores the row anyway, and reports missingBlobs: 1", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");
      // BOTH members of the fixture's blob union are withheld — the attachment
      // this case is about, and the dashboard background beside it — so
      // "nothing was written" below stays the assertion it was written to be.
      const zipBytes = await buildArchiveZip(
        archive,
        fixtureA.blobBytes,
        new Set([fixtureA.ids.attachmentSha, fixtureA.ids.backgroundSha]),
      );
      const filePath = fixturePath("missing-blob.nexus.zip");
      await writeFile(filePath, zipBytes);

      const profileB = createProfile(dbB, "B");
      const { deps, blobs } = makeTestDeps(dbB, filePath);
      await pickRestoreFile(deps);
      const preview = await previewRestore(deps, profileB, null);
      if (preview.status !== "ready") unreachable();
      expect(preview.preview.warnings).toContainEqual(
        expect.objectContaining({ severity: "warning", code: "missing-blob" }),
      );

      const result = await applyRestore(deps, profileB, preview.preview.token);
      // Exactly the one blob the zip lacks is reported; the task's own file and
      // the subject's material were present and restored, so a lost file costs
      // that file and nothing else.
      expect(result.missingBlobs).toBe(1);
      expect(result.blobsAdded).toBe(2);
      expect(blobs.has(fixtureA.ids.attachmentSha)).toBe(false);
      expect(blobs.has(fixtureA.ids.taskAttachmentSha)).toBe(true);

      expect(
        new NoteAttachmentStore(dbB.raw, profileB).list(fixtureA.ids.note.id).map((row) => row.sha256),
      ).toContain(fixtureA.ids.attachmentSha);
    });
  });

  describe("side effects", () => {
    it("applyRestore cancels the focus session immediately and reloads after a tick; undoRestore reloads too", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");
      const zipBytes = await buildArchiveZip(archive, fixtureA.blobBytes);
      const filePath = fixturePath("side-effects.nexus.zip");
      await writeFile(filePath, zipBytes);

      const profileB = createProfile(dbB, "B");
      const { deps, cancelFocusCalls, getReloadCount } = makeTestDeps(dbB, filePath);
      await pickRestoreFile(deps);
      const preview = await previewRestore(deps, profileB, null);
      if (preview.status !== "ready") unreachable();

      await applyRestore(deps, profileB, preview.preview.token);
      expect(cancelFocusCalls).toEqual([profileB]);
      expect(getReloadCount()).toBe(0);
      await flushSetTimeout();
      expect(getReloadCount()).toBe(1);

      await undoRestore(deps, profileB);
      expect(cancelFocusCalls).toEqual([profileB, profileB]);
      expect(getReloadCount()).toBe(1);
      await flushSetTimeout();
      expect(getReloadCount()).toBe(2);
    });
  });

  describe("clearRestoreState", () => {
    it("closes a not-yet-applied preview's open archive, freeing its file", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");
      const zipBytes = await buildArchiveZip(archive, fixtureA.blobBytes);
      const filePath = fixturePath("clear-pending.nexus.zip");
      await writeFile(filePath, zipBytes);

      const profileB = createProfile(dbB, "B");
      const { deps } = makeTestDeps(dbB, filePath);
      await pickRestoreFile(deps);
      const preview = await previewRestore(deps, profileB, null);
      expect(preview.status).toBe("ready");

      clearRestoreState();

      await expect(unlink(filePath)).resolves.toBeUndefined();
    });

    it("drops the undo entry from a completed restore", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");
      const zipBytes = await buildArchiveZip(archive, fixtureA.blobBytes);
      const filePath = fixturePath("clear-undo.nexus.zip");
      await writeFile(filePath, zipBytes);

      const profileB = createProfile(dbB, "B");
      const { deps } = makeTestDeps(dbB, filePath);
      await pickRestoreFile(deps);
      const preview = await previewRestore(deps, profileB, null);
      if (preview.status !== "ready") unreachable();
      await applyRestore(deps, profileB, preview.preview.token);
      expect(restoreStatus(profileB).undo).not.toBeNull();

      clearRestoreState();

      expect(restoreStatus(profileB).undo).toBeNull();
      await expect(undoRestore(deps, profileB)).rejects.toThrow();
    });
  });

  describe("cancelRestore", () => {
    it("drops a picked file without previewing it, freeing its handle", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");
      const zipBytes = await buildArchiveZip(archive, fixtureA.blobBytes);
      const filePath = fixturePath("cancel.nexus.zip");
      await writeFile(filePath, zipBytes);

      const profileB = createProfile(dbB, "B");
      const { deps } = makeTestDeps(dbB, filePath);
      await pickRestoreFile(deps);
      const preview = await previewRestore(deps, profileB, null);
      expect(preview.status).toBe("ready");

      await cancelRestore();

      await expect(unlink(filePath)).resolves.toBeUndefined();
      await expect(previewRestore(deps, profileB, null)).resolves.toEqual({ status: "no-file" });
    });
  });

  describe("a pick landing while a preview is in flight", () => {
    it("abandons the stale preview and closes the archive it had opened", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");
      const zipBytes = await buildArchiveZip(archive, fixtureA.blobBytes);
      // An NXA1 container on purpose: its open pays a real (if cheap) Argon2id
      // pass plus a dozen sequential I/O rounds, while the pick below needs
      // only four — so the pick always lands inside the preview's open window,
      // which is exactly the interleaving under test.
      const sealed = await sealAsNxa1(zipBytes, "race passphrase");
      const filePath = fixturePath("race.nexus");
      await writeFile(filePath, sealed);

      const profileB = createProfile(dbB, "B");
      const { deps } = makeTestDeps(dbB, filePath);
      await pickRestoreFile(deps);

      const openArchiveSpy = vi.spyOn(archiveReaderModule, "openArchive");

      const stalePreview = previewRestore(deps, profileB, "race passphrase");
      await pickRestoreFile(deps); // replaces `pending` while the preview's openArchive is still in flight

      await expect(stalePreview).resolves.toEqual({ status: "no-file" });

      // The archive the stale preview had opened must have been closed on its
      // way out — nothing else holds a reference that ever could.
      const firstCall = openArchiveSpy.mock.results[0];
      if (!firstCall || firstCall.type !== "return") {
        throw new Error("Test setup: expected the stale preview's openArchive call to have returned a promise.");
      }
      const staleArchive = await firstCall.value;
      await expect(staleArchive.readBlob(fixtureA.ids.attachmentSha)).rejects.toThrow(/closed/);
    });
  });

  describe("previewing twice against the same picked file", () => {
    it("closes the previously-opened archive before opening the next one", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");
      const zipBytes = await buildArchiveZip(archive, fixtureA.blobBytes);
      const sealed = await sealAsNxa1(zipBytes, "right passphrase");
      const filePath = fixturePath("no-leak.nexus");
      await writeFile(filePath, sealed);

      const profileB = createProfile(dbB, "B");
      const { deps } = makeTestDeps(dbB, filePath);
      await pickRestoreFile(deps);

      // Wraps the real `openArchive` (vi.spyOn calls through by default) so
      // each call's actual `OpenedArchive` can be inspected afterward.
      const openArchiveSpy = vi.spyOn(archiveReaderModule, "openArchive");

      const wrong = await previewRestore(deps, profileB, "wrong passphrase");
      expect(wrong).toEqual({ status: "unreadable", code: "passphrase-wrong" });

      const right = await previewRestore(deps, profileB, "right passphrase");
      expect(right.status).toBe("ready");

      const secondCall = openArchiveSpy.mock.results[1];
      if (!secondCall || secondCall.type !== "return") {
        throw new Error("Test setup: expected the second openArchive call to have returned a promise.");
      }
      const secondArchive = await secondCall.value;

      // A third preview supersedes the second archive, which must now close.
      const rightAgain = await previewRestore(deps, profileB, "right passphrase");
      expect(rightAgain.status).toBe("ready");

      await expect(secondArchive.readBlob(fixtureA.ids.attachmentSha)).rejects.toThrow();
    });
  });
});

// --- Foreign import (ADR-043) ------------------------------------------------

/**
 * Rewrites one NDJSON line of an already-built archive and repairs the
 * manifest's checksum for that file, so what reaches the parser is an archive
 * with ONE structurally bad ROW rather than a corrupt container. The
 * distinction is the whole point: a container problem is a hard error in both
 * modes, while a bad row is what import mode salvages past and restore mode
 * refuses.
 */
function withDamagedRecord(
  files: ReadonlyMap<string, string>,
  path: string,
  damage: (line: string) => string,
): Map<string, string> {
  const original = files.get(path);
  if (original === undefined) throw new Error(`Test setup: the archive has no "${path}".`);
  const lines = original.split("\n");
  const index = lines.findIndex((line) => line.trim().length > 0);
  if (index < 0) throw new Error(`Test setup: "${path}" carries no records to damage.`);
  lines[index] = damage(lines[index] ?? "");

  const next = new Map(files);
  next.set(path, lines.join("\n"));

  const manifest = JSON.parse(files.get("manifest.json") ?? "{}") as {
    checksums: Record<string, string>;
  };
  manifest.checksums[path] = hashUtf8(next.get(path) ?? "");
  next.set("manifest.json", JSON.stringify(manifest, null, 2));
  return next;
}

/** Every note-link edge in one database, as plain id pairs. */
function noteLinks(handle: NexusDatabase): { source: string; target: string }[] {
  return handle.raw
    .prepare("SELECT source_note_id AS source, target_note_id AS target FROM note_links")
    .all() as { source: string; target: string }[];
}

describe("foreign import", () => {
  /**
   * Profile A's archive on disk, profile B seeded with data of its own in a
   * SEPARATE database — the shape a foreign import actually has, and the only
   * one where "nothing already there is touched" means anything.
   */
  async function twoProfiles(
    fileName: string,
    damage?: (files: ReadonlyMap<string, string>) => Map<string, string>,
  ): Promise<{
    profileB: string;
    fixtureA: SeededFixture;
    handle: TestDepsHandle;
  }> {
    const profileA = createProfile(dbA, "A");
    const fixtureA = seedProfile(dbA, profileA, "A");
    const archive = buildArchiveFor(fixtureA, profileA, "A");
    const files = damage ? damage(archive.files) : archive.files;
    const zipBytes = await buildArchiveZip({ files, binaries: archive.binaries }, fixtureA.blobBytes);
    const filePath = fixturePath(fileName);
    await writeFile(filePath, zipBytes);

    const profileB = createProfile(dbB, "B-target");
    seedProfile(dbB, profileB, "B");
    return { profileB, fixtureA, handle: makeTestDeps(dbB, filePath) };
  }

  describe("preview", () => {
    it("plans a real merge whose arithmetic balances, without writing anything", async () => {
      const { profileB, handle } = await twoProfiles("import.nexus.zip");
      const { deps } = handle;

      const before = gatherProfileData(deps, profileB);

      const pick = await pickImportFile(deps);
      expect(pick).toEqual({
        canceled: false,
        path: fixturePath("import.nexus.zip"),
        fileName: "import.nexus.zip",
        encrypted: false,
      });

      const preview = await previewImport(deps, profileB, null);
      if (preview.status !== "ready") unreachable();
      expect(preview.preview.sourceProfileName).toBe("A");
      expect(preview.preview.targetProfileName).toBe("B-target");

      // `parsed` = `imported + merged + skipped`, per module. A report that did
      // not balance would be worse than no report at all.
      for (const counts of Object.values(preview.preview.report.modules)) {
        expect(counts.parsed).toBe(counts.imported + counts.merged + counts.skipped);
      }
      // The two the planner never imports are named rather than silently absent.
      const codes = preview.preview.report.skips.map((skip) => skip.code);
      expect(codes).toContain("notifications-not-imported");
      expect(codes).toContain("settings-not-imported");
      expect(codes).toContain("source-inbox-collapsed");

      // A dry run: the profile is byte for byte what it was.
      expect(gatherProfileData(deps, profileB)).toEqual(before);
    });

    it("salvages one bad row instead of refusing the archive, and names it in the report", async () => {
      // Restore mode would call this `invalid-record` at ERROR severity and
      // refuse the whole file; import mode drops the row and carries on. That
      // difference IS `mode: "import"` being wired through — nothing else in
      // this file can tell the two apart.
      const { profileB, handle } = await twoProfiles("salvage.nexus.zip", (files) =>
        withDamagedRecord(files, "data/calendar.ndjson", (line) =>
          JSON.stringify({ ...(JSON.parse(line) as Record<string, unknown>), startAt: "ne-datum" }),
        ),
      );
      const { deps } = handle;

      await pickImportFile(deps);
      const preview = await previewImport(deps, profileB, null);
      if (preview.status !== "ready") unreachable();

      expect(preview.preview.report.skips).toContainEqual(
        expect.objectContaining({ code: "invalid-record", module: "calendar" }),
      );
      expect(preview.preview.warnings.some((problem) => problem.code === "invalid-record")).toBe(true);
      expect(preview.preview.report.modules.calendar.skipped).toBeGreaterThan(0);
    });

    it("reports a wrong passphrase rather than rejecting", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");
      const zipBytes = await buildArchiveZip(archive, fixtureA.blobBytes);
      const filePath = fixturePath("sealed-import.nexus");
      await writeFile(filePath, await sealAsNxa1(zipBytes, "correct horse battery staple"));

      const profileB = createProfile(dbB, "B-target");
      const { deps } = makeTestDeps(dbB, filePath);

      const pick = await pickImportFile(deps);
      expect(pick).toEqual({
        canceled: false,
        path: filePath,
        fileName: "sealed-import.nexus",
        encrypted: true,
      });
      await expect(previewImport(deps, profileB, "wrong passphrase")).resolves.toEqual({
        status: "unreadable",
        code: "passphrase-wrong",
      });
      const ready = await previewImport(deps, profileB, "correct horse battery staple");
      expect(ready.status).toBe("ready");
    });
  });

  describe("apply and undo", () => {
    it("merges the archive in additively, then undoes it away completely", async () => {
      const { profileB, fixtureA, handle } = await twoProfiles("apply.nexus.zip");
      const { deps, blobs, cancelFocusCalls, getReloadCount } = handle;

      const before = gatherProfileData(deps, profileB);
      const beforeLinks = noteLinks(dbB);

      await pickImportFile(deps);
      const preview = await previewImport(deps, profileB, null);
      if (preview.status !== "ready") unreachable();

      const result = await applyImport(deps, profileB, preview.preview.token);
      expect(result.rowsWritten).toBeGreaterThan(0);
      // The note attachment's blob, the task attachment's and the subject
      // material's. NOT the dashboard background: an import never carries the
      // archive's decoration.
      expect(result.blobsAdded).toBe(3);
      expect(blobs.has(fixtureA.ids.attachmentSha)).toBe(true);
      expect(blobs.has(fixtureA.ids.taskAttachmentSha)).toBe(true);
      expect(blobs.has(fixtureA.ids.subjectAttachmentSha)).toBe(true);
      expect(blobs.has(fixtureA.ids.backgroundSha)).toBe(false);
      expect(result.missingBlobs).toBe(0);

      const after = gatherProfileData(deps, profileB);

      // Every row profile B already had is exactly where it was.
      for (const row of before.tasks) {
        expect(after.tasks.find((candidate) => candidate.id === row.id)).toEqual(row);
      }
      for (const row of before.notes) {
        expect(after.notes.find((candidate) => candidate.id === row.id)).toEqual(row);
      }
      expect(after.tasks.length).toBeGreaterThan(before.tasks.length);
      expect(after.notes.length).toBeGreaterThan(before.notes.length);

      // And not one imported id collides with an id B already had — the whole
      // point of minting rather than preserving.
      const beforeTaskIds = new Set(before.tasks.map((row) => row.id));
      expect(after.tasks.filter((row) => beforeTaskIds.has(row.id))).toHaveLength(before.tasks.length);

      // The archive's wiki-link travelled: a SECOND edge now exists, and both of
      // its ends are imported notes, never B's own.
      const afterLinks = noteLinks(dbB);
      expect(afterLinks).toHaveLength(beforeLinks.length + 1);
      const beforeNoteIds = new Set(before.notes.map((row) => row.id));
      const importedLink = afterLinks.find(
        (link) => !beforeLinks.some((existing) => existing.source === link.source),
      );
      expect(importedLink).toBeDefined();
      expect(beforeNoteIds.has(importedLink?.source ?? "")).toBe(false);
      expect(beforeNoteIds.has(importedLink?.target ?? "")).toBe(false);

      // The undo banner is the shared one, and it says which operation it means.
      expect(restoreStatus(profileB)).toEqual({
        undo: { kind: "import", appliedAt: expect.any(String), summary: result },
      });

      // An import destroys nothing, so it discards nothing: the running focus
      // timer survives it. (The undo below genuinely does wipe, and cancels.)
      expect(cancelFocusCalls).toEqual([]);
      await flushSetTimeout();
      expect(getReloadCount()).toBe(1);

      const undoResult = await undoRestore(deps, profileB);
      expect(undoResult.blobsRemoved).toBe(3);
      expect(blobs.size).toBe(0);
      expect(gatherProfileData(deps, profileB)).toEqual(before);
      // Every imported note is gone, so no edge can name one anymore. Asserted
      // as "no imported end survives" rather than as `toEqual(beforeLinks)`:
      // undo replays through the same `replaceProfileData` a restore does, which
      // REBUILDS `note_links` from each note's own Yjs state — so B's own
      // wiki-links come back as index rows whether or not they were there
      // before, which is the mechanism working, not the import leaking.
      for (const link of noteLinks(dbB)) {
        expect(beforeNoteIds.has(link.source)).toBe(true);
        expect(beforeNoteIds.has(link.target)).toBe(true);
      }
      expect(restoreStatus(profileB).undo).toBeNull();
      expect(cancelFocusCalls).toEqual([profileB]);
    });

    it("refuses a stale token, a foreign profile, and a second apply of the same plan", async () => {
      const { profileB, handle } = await twoProfiles("token.nexus.zip");
      const { deps } = handle;
      const otherProfile = createProfile(dbB, "B-other");

      await pickImportFile(deps);
      const preview = await previewImport(deps, profileB, null);
      if (preview.status !== "ready") unreachable();

      await expect(applyImport(deps, profileB, "not-the-real-token")).rejects.toThrow();
      await expect(applyImport(deps, otherProfile, preview.preview.token)).rejects.toThrow();

      await applyImport(deps, profileB, preview.preview.token);
      await expect(applyImport(deps, profileB, preview.preview.token)).rejects.toThrow();
    });
  });

  describe("the two surfaces never reach each other", () => {
    it("keeps the picks apart and refuses a token across them", async () => {
      const { profileB, handle } = await twoProfiles("apart.nexus.zip");
      const { deps } = handle;

      // A pick made for an import is invisible to the restore flow: the
      // destructive surface has nothing to preview until it picks for itself.
      await pickImportFile(deps);
      await expect(previewRestore(deps, profileB, null)).resolves.toEqual({ status: "no-file" });

      const preview = await previewImport(deps, profileB, null);
      if (preview.status !== "ready") unreachable();
      // An import's token is not a restore's: confirming it on the destructive
      // surface must fail rather than replace the profile.
      await expect(applyRestore(deps, profileB, preview.preview.token)).rejects.toThrow();

      // And the two picks COEXIST rather than clobbering each other — a user who
      // opens the restore screen has not silently thrown away the import they
      // were half-way through, and neither pick can be applied by the other.
      await pickRestoreFile(deps);
      const restorePreview = await previewRestore(deps, profileB, null);
      if (restorePreview.status !== "ready") unreachable();
      const stillReady = await previewImport(deps, profileB, null);
      if (stillReady.status !== "ready") unreachable();
      await expect(applyImport(deps, profileB, restorePreview.preview.token)).rejects.toThrow();
    });

    it("drops the import pick on cancel and on lock", async () => {
      const { profileB, handle } = await twoProfiles("drop.nexus.zip");
      const { deps } = handle;

      await pickImportFile(deps);
      expect((await previewImport(deps, profileB, null)).status).toBe("ready");
      await cancelImport();
      await expect(previewImport(deps, profileB, null)).resolves.toEqual({ status: "no-file" });

      await pickImportFile(deps);
      expect((await previewImport(deps, profileB, null)).status).toBe("ready");
      clearRestoreState();
      await expect(previewImport(deps, profileB, null)).resolves.toEqual({ status: "no-file" });
    });
  });
});

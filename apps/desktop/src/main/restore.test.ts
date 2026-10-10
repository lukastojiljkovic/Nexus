import { createHash } from "node:crypto";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BetterSqlite3 from "better-sqlite3-multiple-ciphers";
import { ZipFile } from "yazl";
import * as Y from "yjs";

import {
  buildExportArchive,
  countProfileModules,
  createArchiveWriter,
  mergeNoteState,
  type ArchiveKdfParams,
  type ArchiveProfilePicture,
  type ExportArchive,
  type ExportArchiveInput,
  type ExportModuleData,
  type ExportPrivateNotes,
  type ExportSettings,
  type ProfileData,
} from "@nexus/core";
import { deriveArchiveKey, generateSalt } from "@nexus/core/auth";
import {
  CalendarSettingsStore,
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
  FitBodyProfileStore,
  FitExerciseStore,
  FitFoodStore,
  FitMealStore,
  FitMeasurementStore,
  FitRoutineStore,
  CanvasStore,
  ElectronicsStore,
  FitTargetStore,
  FitWorkoutStore,
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

import * as apkgReaderModule from "./apkgReader.js";
import * as archiveReaderModule from "./archiveReader.js";
import * as csvReaderModule from "./csvReader.js";
import * as icsReaderModule from "./icsReader.js";
import { ModuleImportError } from "./moduleIpc.js";
import { deriveRestoredNotes, gatherProfileData, gatherProfileSettings } from "./profileData.js";
import type { ProfileDataDeps } from "./profileData.js";
import {
  applyApkgImport,
  applyCsvImport,
  applyFinCsvImport,
  applyIcsImport,
  applyImport,
  applyLlmImport,
  applyRestore,
  cancelApkgImport,
  cancelCsvImport,
  cancelFinCsvImport,
  cancelIcsImport,
  cancelImport,
  cancelLlmImport,
  cancelRestore,
  clearRestoreState,
  mapCsvImport,
  mapFinCsvImport,
  pickApkgFile,
  pickCsvFile,
  pickFinCsvFile,
  pickIcsFile,
  pickImportFile,
  pickRestoreFile,
  previewApkgImport,
  previewCsvImport,
  previewFinCsvImport,
  previewIcsImport,
  previewImport,
  previewLlmImport,
  previewRestore,
  privateUndoPending,
  replanImport,
  replanLlmImport,
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

/**
 * The module kit's section as this suite sees it (ADR-090): what a full read
 * hands over, which module ids this build adopted, and every import it was
 * asked to apply.
 *
 * `main/index.ts` gets the same three things from `moduleHost`, which has its
 * own tests (`moduleIpc.test.ts`) against the real host. Here they are a seam,
 * because what THESE tests are responsible for is the ordering and the refusal
 * the restore orchestration owes: a section that rides the archive, is refused
 * at the preview when this build does not know an id or a payload its module
 * will not take, and is applied after the replace has rewritten the profile.
 */
interface TestModuleSeam {
  /** One profile's section, as the host's `collectExports` produces it. Written by `restoreModuleData`, so a re-read after a restore reports what the archive carried. */
  exportsByProfile: Map<string, readonly ExportModuleData[]>;
  /** The ids this build adopted; an archive naming anything else is refused. */
  knownIds: ReadonlySet<string>;
  /**
   * How this build's own modules read a payload, by module id. A module absent
   * here takes whatever it is given; a test that needs the other answer puts a
   * throwing parser in - which is the second half of the refusal the preview owes.
   */
  parsers: Map<string, (value: unknown) => unknown>;
  /** Every `restoreModuleData` call, in order. */
  applied: { profileId: string; modules: readonly ExportModuleData[] }[];
}

/** A seam with nothing exported and `timers` adopted — what a suite that does not care about the section gets. */
function moduleSeam(knownIds: readonly string[] = ["timers"]): TestModuleSeam {
  return { exportsByProfile: new Map(), knownIds: new Set(knownIds), parsers: new Map(), applied: [] };
}

/** Every `ProfileDataDeps` getter, bound to one database — the same construction `main/index.ts` would do for a real profile, minus Electron. */
function profileDataDeps(handle: NexusDatabase, modules = moduleSeam()): ProfileDataDeps {
  return {
    taskStore: (profileId) => new TaskStore(handle.raw, profileId),
    taskListStore: (profileId) => new TaskListStore(handle.raw, profileId),
    taskTagStore: (profileId) => new TaskTagStore(handle.raw, profileId),
    taskAttachmentStore: (profileId) => new TaskAttachmentStore(handle.raw, profileId),
    taskTemplateStore: (profileId) => new TaskTemplateStore(handle.raw, profileId),
    taskDependencyStore: (profileId) => new TaskDependencyStore(handle.raw, profileId),
    eventStore: (profileId) => new EventStore(handle.raw, profileId),
    eventTemplateStore: (profileId) => new EventTemplateStore(handle.raw, profileId),
    calendarSettingsStore: (profileId) => new CalendarSettingsStore(handle.raw, profileId),
    peopleStore: (profileId) => new PeopleStore(handle.raw, profileId),
    documentStore: (profileId) => new DocumentStore(handle.raw, profileId),
    subjectStore: (profileId) => new SubjectStore(handle.raw, profileId),
    subjectAttachmentStore: (profileId) => new SubjectAttachmentStore(handle.raw, profileId),
    subjectNoteLinkStore: (profileId) => new SubjectNoteLinkStore(handle.raw, profileId),
    examStore: (profileId) => new ExamStore(handle.raw, profileId),
    deckStore: (profileId) => new DeckStore(handle.raw, profileId),
    cardStore: (profileId) => new CardStore(handle.raw, profileId),
    topicStore: (profileId) => new TopicStore(handle.raw, profileId),
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
    dashboardSetStore: (profileId) => new DashboardSetStore(handle.raw, profileId),
    finAccountStore: (profileId) => new FinAccountStore(handle.raw, profileId),
    finCategoryStore: (profileId) => new FinCategoryStore(handle.raw, profileId),
    finRecurringStore: (profileId) => new FinRecurringStore(handle.raw, profileId),
    finTransactionStore: (profileId) => new FinTransactionStore(handle.raw, profileId),
    habitStore: (profileId) => new HabitStore(handle.raw, profileId),
    fitFoodStore: (profileId) => new FitFoodStore(handle.raw, profileId),
    fitMealStore: (profileId) => new FitMealStore(handle.raw, profileId),
    fitTargetStore: (profileId) => new FitTargetStore(handle.raw, profileId),
    fitExerciseStore: (profileId) => new FitExerciseStore(handle.raw, profileId),
    fitRoutineStore: (profileId) => new FitRoutineStore(handle.raw, profileId),
    fitWorkoutStore: (profileId) => new FitWorkoutStore(handle.raw, profileId),
    fitMeasurementStore: (profileId) => new FitMeasurementStore(handle.raw, profileId),
    fitBodyProfileStore: (profileId) => new FitBodyProfileStore(handle.raw, profileId),
    canvasStore: (profileId) => new CanvasStore(handle.raw, profileId),
    electronicsStore: (profileId) => new ElectronicsStore(handle.raw, profileId),
    // The kit's section (ADR-090), over the seam above. The refusal's WORDING is
    // duplicated from `main/moduleIpc.ts`'s `assertImportable`, exactly as
    // `TestPrivSeam` duplicates `privResealForRestore`'s contract: this file is
    // about the orchestration around it, and the real message is asserted where
    // the real host is.
    moduleExports: (profileId) => modules.exportsByProfile.get(profileId) ?? [],
  };
}

interface TestDepsHandle {
  /** The superset both flows run on: a restore reads only `RestoreDeps` from it, an import also the additive store (ADR-043). */
  deps: ImportDeps;
  /** Stands in for the on-disk encrypted blob store: `sha256 -> bytes`, exactly what `created`/deletion observability needs. */
  blobs: Map<string, Uint8Array>;
  cancelFocusCalls: string[];
  getReloadCount: () => number;
  /** The private-section seam's double (ADR-057 §6) — flip `unlocked` per test; `blobFiles` stands in for the sealed private-blob directory. */
  priv: TestPrivSeam;
  /** The module kit's section (ADR-090) — flip `knownIds` per test; `applied` records every import. */
  modules: TestModuleSeam;
}

/**
 * The fake private section `makeTestDeps` wires (ADR-057 §6). The DOUBLE
 * mimics `privResealForRestore`'s contract — null while locked, fresh
 * deterministic ids per archive attachment, blob files written before the
 * caller's transaction, `missingBlobs` counted — while producing marked
 * "sealed" bytes a test can recognise; the real crypto has its own tests in
 * `priv.test.ts`, and THESE tests are about the orchestration around it.
 */
interface TestPrivSeam {
  unlocked: boolean;
  blobFiles: Map<string, Uint8Array>;
  resealCalls: number;
  /**
   * What the orphan-blob sweep saw each time it was called (ADR-057): the
   * sealed rows in the tables at that moment, and whether the undo slot could
   * still put a different set back. Both are the ordering this feature turns
   * on — a sweep that ran a step earlier would delete files an undo needs.
   */
  sweepCalls: { profileId: string; sealedIds: string[]; undoPending: boolean }[];
}

/**
 * Everything `RestoreDeps` needs, wired to real store classes over `handle`
 * (so every restore/undo actually goes through `RestoreStore`'s real
 * transaction) except the five genuinely-external things the module spec
 * calls out: the native dialog, the renderer reload, the focus-cancel call,
 * and the blob store — those are test doubles backed by a plain in-memory map
 * so `created`/orphan-deletion are directly observable.
 */
function makeTestDeps(
  handle: NexusDatabase,
  filePath: string | null,
  apkgPath: string | null = null,
  csvPath: string | null = null,
  icsPath: string | null = null,
  /** FIN slice e's own picker, injected separately for the reason every other one is: nothing on the task surface may open the ledger's dialog. */
  finCsvPath: string | null = null,
  /** The kit's section (ADR-090), shared with whatever builds the archive under test so a section can be handed over, applied and read back. */
  modules: TestModuleSeam = moduleSeam(),
): TestDepsHandle {
  const blobs = new Map<string, Uint8Array>();
  const cancelFocusCalls: string[] = [];
  let reloadCount = 0;
  const priv: TestPrivSeam = {
    unlocked: false,
    blobFiles: new Map(),
    resealCalls: 0,
    sweepCalls: [],
  };

  const deps: ImportDeps = {
    ...profileDataDeps(handle, modules),
    restoreStore: (profileId) => new RestoreStore(handle.raw, profileId),
    foreignImportStore: (profileId) => new ForeignImportStore(handle.raw, profileId),
    // The kit's section (ADR-090), over the seam above. The refusal's WORDING and
    // its CODE are duplicated from `main/moduleIpc.ts`'s `assertImportable`,
    // exactly as `TestPrivSeam` duplicates `privResealForRestore`'s contract:
    // this file is about the orchestration around it, and the real message is
    // asserted where the real host is. `ModuleImportError` is the real class
    // though — the code is what `restore.ts` maps onto the wire, so the mapping
    // is only under test if the error is.
    assertImportable: (section) => {
      for (const { moduleId } of section) {
        if (!modules.knownIds.has(moduleId)) {
          throw new ModuleImportError(
            "unknown-module",
            `This archive carries data for module "${moduleId}", which this build does not know.`,
          );
        }
      }
      for (const { moduleId, payload } of section) {
        const parse = modules.parsers.get(moduleId);
        if (parse === undefined) continue;
        try {
          parse(payload);
        } catch (error) {
          throw new ModuleImportError(
            "invalid-module-data",
            `This archive carries data for module "${moduleId}" that this build cannot read: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    },
    restoreModuleData: (profileId, section) => {
      modules.applied.push({ profileId, modules: section });
      modules.exportsByProfile.set(profileId, section);
    },
    // The REAL read `main/index.ts` performs, through the same store — the
    // picture rides with the name because a restore replaces both, and an undo
    // that snapshotted only the name would leave the target wearing the
    // archive's face (SET-001).
    getProfile: (profileId) => {
      const row = new ProfileStore(handle.raw).get(profileId);
      if (!row) throw new Error(`Test setup: no profile "${profileId}".`);
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        picture:
          row.pictureHash === null || row.pictureMime === null || row.pictureSizeBytes === null
            ? null
            : { hash: row.pictureHash, mime: row.pictureMime, sizeBytes: row.pictureSizeBytes },
      };
    },
    pickArchiveFile: async () => filePath,
    // ADR-052's own picker, injected separately for the reason main injects it
    // separately: nothing on the archive surface may ever open this dialog.
    pickApkgFile: async () => apkgPath,
    // ADR-062's picker, on the same terms again.
    pickCsvFile: async () => csvPath,
    // FIN slice e's, on the same terms once more.
    pickFinCsvFile: async () => finCsvPath,
    // ADR-061's picker, on the same terms.
    pickIcsFile: async () => icsPath,
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
      new DashboardSettingsStore(handle.raw, profileId).refCount(sha256) +
      // The fifth member (SET-001, migration 040): the `profiles` table itself.
      // Its store takes no profile id — that table IS the profile list — and its
      // count is profile-agnostic like every other one here.
      new ProfileStore(handle.raw).refCount(sha256),
    deleteBlobIfOrphaned: async (sha256, refCount) => {
      if (refCount === 0) blobs.delete(sha256);
    },
    // The REAL sealed store over the same database — undo's byte-fidelity is
    // asserted against actual `private_notes` rows, never against a double.
    privateNoteStore: (profileId) => new PrivateNoteStore(handle.raw, profileId),
    privUnlocked: () => priv.unlocked,
    // `privResealForRestore`'s contract, mimicked (see `TestPrivSeam`): null
    // while locked; otherwise every archive attachment id re-minted onto a
    // deterministic fresh id with its bytes "sealed" into `priv.blobFiles`
    // before the caller's transaction, misses counted, and every envelope
    // turned into marked bytes carrying the sequence the real reseal would
    // have bound (live at max(version seq) + 1, versions at their own).
    resealPrivateNotes: async (_profileId, data, readArchiveBlob) => {
      if (!priv.unlocked) return null;
      priv.resealCalls += 1;
      const addedBlobIds: string[] = [];
      let missingBlobs = 0;
      const seen = new Set<string>();
      for (const row of [...data.notes, ...data.versions]) {
        for (const ref of row.attachments) {
          if (seen.has(ref.id)) continue;
          seen.add(ref.id);
          const bytes = await readArchiveBlob(ref.id);
          if (bytes === null) {
            missingBlobs += 1;
            continue;
          }
          const freshId = `fresh-${ref.id}`;
          priv.blobFiles.set(freshId, bytes);
          addedBlobIds.push(freshId);
        }
      }
      const maxSeq = new Map<string, number>();
      for (const version of data.versions) {
        maxSeq.set(version.noteId, Math.max(maxSeq.get(version.noteId) ?? 0, version.seq));
      }
      return {
        rows: {
          notes: data.notes.map((note) => ({
            id: note.id,
            sealed: new TextEncoder().encode(
              `resealed:${note.id}:${(maxSeq.get(note.id) ?? 0) + 1}`,
            ),
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
          })),
          versions: data.versions.map((version) => ({
            noteId: version.noteId,
            seq: version.seq,
            sealed: new TextEncoder().encode(`resealed:${version.noteId}:v${version.seq}`),
            createdAt: version.createdAt,
          })),
        },
        addedBlobIds,
        missingBlobs,
      };
    },
    removePrivateBlob: async (id) => {
      priv.blobFiles.delete(id);
    },
    // The real sweep's ordering gate, recorded rather than performed: what it
    // could have seen is the whole assertion (`privSweepOrphanBlobs` itself is
    // tested against real sealed containers in `priv.test.ts`).
    sweepPrivateBlobs: async (profileId) => {
      priv.sweepCalls.push({
        profileId,
        sealedIds: new PrivateNoteStore(handle.raw, profileId).list().map((meta) => meta.id),
        undoPending: privateUndoPending(profileId),
      });
    },
  };

  return { deps, blobs, cancelFocusCalls, getReloadCount: () => reloadCount, priv, modules };
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
  /** The profile's own picture (SET-001) — a MANIFEST fact rather than a row, so it rides beside `data` here exactly as it does in `ExportArchiveInput`. */
  picture: ArchiveProfilePicture;
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
    /** The profile picture's own hash (SET-001) — the union's fifth member, and the only one named by the MANIFEST rather than by a row. */
    pictureSha: string;
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
  const dashboardSetStore = new DashboardSetStore(handle.raw, profileId);
  const finAccountStore = new FinAccountStore(handle.raw, profileId);
  const finCategoryStore = new FinCategoryStore(handle.raw, profileId);
  const finTransactionStore = new FinTransactionStore(handle.raw, profileId);
  const finRecurringStore = new FinRecurringStore(handle.raw, profileId);
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

  // ELEC (migration 067): a circuit with two parts and a wire between them.
  // Three tables whose references only work if the restore writes them in
  // order, so a round trip that ended in a foreign-key failure says so here
  // rather than the first time somebody restores a real backup. `R1` carries a
  // value and the board carries none — the one nullable column, both ways.
  const circuit = electronicsStore.createCircuit({ name: "Trepćuća dioda", notes: "5 V" }, t0);
  const boardPart = electronicsStore.addPart(
    circuit.id,
    { componentId: "arduino-uno", label: "", x: 0, y: 0, rotation: 0 },
    t0,
  );
  const resistorPart = electronicsStore.addPart(
    circuit.id,
    { componentId: "resistor", label: "R1", x: 180, y: 40, rotation: 90, value: 220 },
    t0,
  );
  electronicsStore.addWire(
    circuit.id,
    {
      from: { partId: boardPart.id, pinId: "D9" },
      to: { partId: resistorPart.id, pinId: "1" },
      colour: "yellow",
    },
    t0,
  );

  // HABIT (migration 055): one habit of each schedule kind and real days ticked
  // on both, so the zip round trip carries a streak's whole substance rather
  // than an empty module.
  const binaryHabit = habitStore.create(
    { name: `${label} teretana`, color: "maslina", schedule: { kind: "days", weekdays: [1, 3, 5] } },
    t0,
  );
  const countedHabit = habitStore.create(
    { name: `${label} voda`, schedule: { kind: "quota", perWeek: 5 }, target: 8, unit: "čaša" },
    t0,
  );
  habitStore.setEntry(binaryHabit.id, "2026-06-01", 1, t0);
  habitStore.setEntry(countedHabit.id, "2026-06-02", 8, t0);

  // FIT (migration 058): one user food and two logged items — one naming that
  // food, one naming the app's CATALOGUE, which never rides in an archive at
  // all. The second is the round trip's real subject: it survives the zip
  // because it carries its own label and snapshot.
  const fitFood = fitFoodStore.create(
    {
      name: `${label} ajvar`,
      category: "povrce",
      per100g: { kcal: 120, protein: 1.5, carbs: 9, fat: 8.5, fiber: 2.5, sugar: 5, sodiumMg: 480 },
      servings: [{ label: "1 kašika", grams: 15 }],
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
    t0,
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
    t0,
  );
  fitTargetStore.save({ kcal: 2200, proteinG: null, carbsG: null, fatG: null }, t0);

  // FIT training & body (migration 060): a user exercise, a routine naming it
  // alongside a catalogue reference, a FINISHED workout with a set of each kind
  // of reference, a full body-weight reading, and the body facts row — the same
  // catalogue-vs-user pairing the food diary above proves, one slice deeper.
  const fitExercise = fitExerciseStore.create(
    {
      name: `${label} zgib`, nameEn: "Pull-up variation",
      primaryMuscles: ["latovi", "biceps"], equipment: "sopstvena-tezina",
      pattern: "vertikalno-privlacenje", metric: "reps",
    },
    t0,
  );
  const fitRoutine = fitRoutineStore.create(
    {
      name: `${label} povuci dan`,
      items: [
        { exerciseRef: "catalogue:zgibovi", label: "Zgibovi", targetSets: 4, targetRepsMin: 6, targetRepsMax: 10 },
        { exerciseRef: `user:${fitExercise.id}`, label: fitExercise.name },
      ],
    },
    t0,
  );
  const fitWorkout = fitWorkoutStore.start(
    { day: "2026-01-01", routineRef: fitRoutine.id, routineLabel: fitRoutine.name },
    t0,
  );
  fitWorkoutStore.logSet(
    fitWorkout.id,
    { exerciseRef: "catalogue:zgibovi", label: "Zgibovi", metric: "reps", primaryMuscles: ["latovi", "biceps"], kind: "working", reps: 10 },
    t0,
  );
  fitWorkoutStore.logSet(
    fitWorkout.id,
    {
      exerciseRef: `user:${fitExercise.id}`, label: fitExercise.name, metric: "weighted_reps",
      primaryMuscles: ["latovi", "biceps"], kind: "drop", weightKg: 10, reps: 6,
    },
    t0,
  );
  fitWorkoutStore.finish(fitWorkout.id, t0);
  fitMeasurementStore.save(
    {
      day: "2026-01-01", weightKg: 82.4, bodyFatPercent: 18.5,
      muscle: { unit: "percent", value: 44.2 }, waterPercent: 55,
      circumferences: { neck: 40, chest: 105, upperArm: 36, waist: 88, hip: 100, thigh: 58 },
    },
    t0,
  );
  fitBodyProfileStore.save(
    { sex: "male", birthDate: "1996-03-14", heightCm: 181, activity: "moderate" },
    t0,
  );

  // CANV (migration 059): a board with shapes AND an embedded image, so the
  // zip round trip carries a whole drawing rather than an empty module — the
  // image is the part with no natural size and it rides INSIDE the row.
  canvasStore.create(
    {
      name: `${label} šema`,
      scene: JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "nexus",
        elements: [{ id: "el-rect", type: "rectangle", x: 10, y: 20, width: 100, height: 60 }],
        appState: { gridSize: 20 },
        files: { "file-1": { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" } },
      }),
    },
    t0,
  );

  // A real ledger (migration 051): two same-currency accounts so a TRANSFER
  // rides through the whole zip round trip as the one row it is, a budgeted
  // expense category, and a categorized expense.
  const finCurrent = finAccountStore.create(
    { name: `${label} tekući`, kind: "current", currency: "RSD", openingBalance: 1000_00 },
    t0,
  );
  const finSavings = finAccountStore.create(
    { name: `${label} štednja`, kind: "savings", currency: "RSD" },
    t0,
  );
  const finCategory = finCategoryStore.create({ name: `${label} hrana`, kind: "expense" }, t0);
  finCategoryStore.setBudget({ categoryId: finCategory.id, currency: "RSD", amount: 300_00 }, t0);
  finTransactionStore.create(
    {
      accountId: finCurrent.id,
      categoryId: finCategory.id,
      date: "2026-02-02",
      amount: -12_50,
      payee: "Maxi",
    },
    t0,
  );
  finTransactionStore.create(
    {
      accountId: finCurrent.id,
      counterAccountId: finSavings.id,
      date: "2026-02-04",
      amount: -300_00,
    },
    t0,
  );
  // FIN slice d (migration 053): a subscription and one charge it generated, so
  // the zip round trip carries the rule, the cursor and the provenance link.
  finRecurringStore.create(
    {
      accountId: finCurrent.id,
      categoryId: finCategory.id,
      name: `${label} Netflix`,
      amount: -11_90,
      recurrence: { freq: { kind: "monthly-date", interval: 1, day: 5 }, end: { kind: "never" } },
      startDate: "2026-02-05",
      reminderDays: 2,
    },
    t0,
  );
  finRecurringStore.generateDue(t0, "2026-02-20");

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
  // NOTE-002: a NON-default shape, so the round trip below would fail if
  // `defaultView` were dropped anywhere along the way — the field is optional in
  // the interchange, and "absent" restores as the "list" every other folder has.
  orgStore.setFolderView(folder.id, "cards", t0);
  const tag = orgStore.createTag(`${label} tag`, t0);
  // NOTE-002's third axis, with a swatch, so the round trip below would fail if
  // either the category row or the note's `categoryId` were dropped on the way.
  const category = orgStore.createCategory({ name: `${label} kategorija`, color: "bordo" }, t0);

  // A bare, never-edited note — purely so `note` below has a real id to link to.
  const linkedNote = noteStore.create(t0);

  const note = noteStore.create(t0);
  noteStore.setFolder(note.id, folder.id);
  noteStore.setCategory(note.id, category.id);
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
  // adding one materializes the default five beside it. Plus a NAMED board
  // (ADR-055), active, so the round trip carries a set row and the pointer.
  dashboardWidgetStore.add(null, "study:ispiti", "L", t0);
  const dashboardSet = dashboardSetStore.create(`${label} tabla`, t0);
  dashboardSetStore.setActive(dashboardSet.id, t0);
  // ADR-054: a SET term, so the round trip would fail if the calendar-settings
  // row were dropped rather than passing on the both-null default.
  new CalendarSettingsStore(handle.raw, profileId).save({
    semesterStart: "2026-10-01",
    semesterEnd: "2027-01-31",
  });

  // The profile's own picture with its OWN blob (SET-001): a fifth, independent
  // entry in the archive's `blobs/` union, and the only one named by the
  // manifest rather than by a row — so the round trip proves that a blob with no
  // referring row still travels, restores, and is counted by the GC union.
  const pictureBytes = new TextEncoder().encode(`${label} picture content`);
  const pictureSha = sha256OfBytes(pictureBytes);
  new ProfileStore(handle.raw).setPicture(profileId, pictureSha, "image/png", pictureBytes.length);

  const taskLists = taskListStore.listActive();
  const electronics = electronicsStore.listAllForExport();
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
    // ADR-054: always exactly one row, since `get` resolves the both-null default.
    calendarSettings: [{ profileId, ...new CalendarSettingsStore(handle.raw, profileId).get() }],
    subjects: subjectStore.listActive(),
    subjectAttachments: subjectAttachmentStore.list(subject.id),
    subjectNoteLinks: subjectNoteLinkStore.listLinks(),
    exams: examStore.listActive(),
    decks: deckStore.listActive(),
    cards: cardStore.listByDeck(deck.id),
    reviewLog: cardStore.listReviewLog(),
    examTopics: [],
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
    noteCategories: orgStore.listCategories(),
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
    dashboardSets: dashboardSetStore.list(),
    dashboardWidgets: dashboardWidgetStore.listAll(),
    // FIN (migration 051): read off the live stores, exactly as
    // `gatherProfileData` reads them.
    finAccounts: finAccountStore.listActive(),
    finCategories: finCategoryStore.list(),
    finRecurring: finRecurringStore.listActive(),
    finTransactions: finTransactionStore.listActive(),
    finBudgets: finCategoryStore.listBudgets(),
    // HABIT (migration 055), read the same way `gatherHabits` reads it.
    habits: habitStore.listActive(),
    habitEntries: habitStore.listAllEntries({ from: "1900-01-01", to: "9999-12-31" }),
    // FIT (migration 058), read the same way `gatherFitness` reads it.
    fitFoods: fitFoodStore.list(),
    fitMealItems: fitMealStore.listAll(),
    fitTargets: [{ profileId, kcal: 2200, proteinG: null, carbsG: null, fatG: null, updatedAt: t0 }],
    // FIT training & body (migration 060), read the same way `gatherFitness`
    // reads it: a routine/workout's nested items/sets split into their own
    // collections, `profileId` added onto the two child rows whose own store
    // shape carries none.
    fitExercises: fitExerciseStore.list(),
    fitRoutines: fitRoutineStore.list().map(({ items: _items, ...routine }) => routine),
    fitRoutineItems: fitRoutineStore.list().flatMap((routine) => routine.items),
    fitWorkouts: fitWorkoutStore
      .listRange("1900-01-01", "9999-12-31")
      .map(({ sets: _sets, ...workout }) => workout),
    fitWorkoutSets: fitWorkoutStore
      .listRange("1900-01-01", "9999-12-31")
      .flatMap((workout) => workout.sets.map((set) => ({ ...set, profileId }))),
    fitMeasurements: fitMeasurementStore
      .listRange("1900-01-01", "9999-12-31")
      .map((measurement) => ({ ...measurement, profileId })),
    fitBodyProfile: (() => {
      const profile = fitBodyProfileStore.get();
      return profile === null ? [] : [{ profileId, ...profile }];
    })(),
    // CANV (migration 059), read the same way `gatherCanvas` reads it: the
    // store answers canonical TEXT, the archive carries the nested document.
    canvasBoards: canvasStore.listActiveWithScenes().map((board) => ({
      id: board.id,
      profileId: board.profileId,
      name: board.name,
      scene: JSON.parse(board.scene) as ProfileData["canvasBoards"][number]["scene"],
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
    })),
    // ELEC (migration 067), read the way `gatherElectronics` reads it: three
    // reads for the whole profile, never one per circuit.
    circuits: electronics.circuits,
    circuitChassis: electronics.chassis,
    circuitParts: electronics.parts,
    circuitWires: electronics.wires,
    // The module kit's section (ADR-090), carried by every archive this fixture
    // builds so the whole suite exercises its travel. One discovered module with
    // ONE opaque payload: core validates the row and never looks inside it, so
    // what the row HOLDS is deliberately something only the module that wrote it
    // could describe.
    modules: [
      {
        moduleId: "timers",
        payload: { presets: [{ name: "Kafa", durationSeconds: 240 }] },
      },
    ],
  };

  const derived = deriveRestoredNotes(data.notes);

  const settings: ExportSettings = {
    flags: { notes: true },
    notifications: {
      quietFrom: null,
      quietTo: null,
      morningHour: "08:00",
      enabledSources: ["exam"],
      snoozeDefault: "10m",
    },
  };

  const blobBytes = new Map<string, Uint8Array>([
    [attachmentSha, attachmentBytes],
    [taskAttachmentSha, taskAttachmentBytes],
    [subjectAttachmentSha, subjectAttachmentBytes],
    [backgroundSha, backgroundBytes],
    [pictureSha, pictureBytes],
  ]);

  return {
    data,
    derived,
    settings,
    picture: { hash: pictureSha, mime: "image/png", sizeBytes: pictureBytes.length },
    blobBytes,
    ids: { task, list, section, taskTag, event, person, subject, exam, deck, card, notification, note, linkedNote, folder, tag, template, attachmentSha, taskAttachmentSha, subjectAttachmentSha, backgroundSha, pictureSha },
  };
}

function buildArchiveFor(
  fixture: Pick<SeededFixture, "data" | "settings" | "picture">,
  profileId: string,
  profileName: string,
  profileKind: "personal" | "business" = "personal",
  privateNotes?: ExportPrivateNotes,
): ExportArchive {
  const input: ExportArchiveInput = {
    profile: { id: profileId, name: profileName, kind: profileKind, picture: fixture.picture },
    appVersion: "0.1.0-test",
    createdAt: "2026-02-01T00:00:00.000Z",
    settings: fixture.settings,
    data: fixture.data,
    hash: hashUtf8,
  };
  // The parallel input, exactly as `main` supplies it (ADR-057 §6) — absent
  // whenever a test's archive carries no private section.
  if (privateNotes !== undefined) input.privateNotes = privateNotes;
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
      // A private attachment's decrypted bytes (ADR-057 §6) resolve from the
      // same fixture map, keyed by the envelope id its entry path carries.
      const key = entry.kind === "private-blob" ? entry.id : entry.sha256;
      if (omitBlobShas.has(key)) continue; // simulate a missing blob file
      const bytes = blobBytes.get(key);
      if (!bytes) {
        reject(new Error(`Test fixture is missing blob bytes for "${key}".`));
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
      // Five: the note attachment's blob, the task attachment's, the subject
      // material's (migration 035), the dashboard background's (ADR-041) and the
      // profile picture's (SET-001) — every member of the one `blobs/` union had
      // to be written before the transaction, including the one no ROW names.
      expect(result.blobsAdded).toBe(5);
      expect(blobs.has(fixtureA.ids.taskAttachmentSha)).toBe(true);
      expect(blobs.has(fixtureA.ids.subjectAttachmentSha)).toBe(true);
      expect(blobs.has(fixtureA.ids.backgroundSha)).toBe(true);
      expect(blobs.has(fixtureA.ids.pictureSha)).toBe(true);
      expect(result.missingBlobs).toBe(0);
      expect(result.restored).toEqual(countProfileModules(fixtureA.data));

      // SET-001: the picture came back onto the TARGET profile row, beside the
      // name the restore also rewrote — the manifest's two profile facts,
      // written together.
      expect(new ProfileStore(dbB.raw).get(profileB)).toMatchObject({
        name: "A",
        pictureHash: fixtureA.ids.pictureSha,
        pictureMime: "image/png",
      });

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
      // NOTE-002 / 1.27.0: the categories, and the note's own `categoryId`
      // beside them — the row is worth nothing if the notes forgot it.
      expect(new NoteOrgStore(dbB.raw, profileB).listCategories()).toEqual(
        fixtureA.data.noteCategories.map((row) => ({ ...row, profileId: profileB })),
      );
      expect(
        new NoteStore(dbB.raw, profileB).list().find((note) => note.id === fixtureA.ids.note.id)
          ?.categoryId,
      ).toBe(fixtureA.data.noteCategories[0]?.id);
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

      // FIN (migration 051): the whole ledger came through the real zip, and
      // the TRANSFER came through as the ONE row it left as — naming two
      // accounts that both exist in the restored profile.
      const finAccountsB = new FinAccountStore(dbB.raw, profileB);
      expect(finAccountsB.listActive()).toEqual(
        fixtureA.data.finAccounts.map((row) => ({ ...row, profileId: profileB })),
      );
      const finCategoriesB = new FinCategoryStore(dbB.raw, profileB);
      expect(finCategoriesB.list()).toEqual(
        fixtureA.data.finCategories.map((row) => ({ ...row, profileId: profileB })),
      );
      expect(finCategoriesB.listBudgets()).toEqual(
        fixtureA.data.finBudgets.map((row) => ({ ...row, profileId: profileB })),
      );
      const finTransactionsB = new FinTransactionStore(dbB.raw, profileB).listActive();
      expect(finTransactionsB).toEqual(
        fixtureA.data.finTransactions.map((row) => ({ ...row, profileId: profileB })),
      );
      expect(finTransactionsB.filter((row) => row.counterAccountId !== null)).toHaveLength(1);
      // The subscription (migration 053) came back with its rule and its CURSOR
      // where the archive left them, and the charge it made still points at it.
      const finRecurringB = new FinRecurringStore(dbB.raw, profileB).listActive();
      expect(finRecurringB).toEqual(
        fixtureA.data.finRecurring.map((row) => ({ ...row, profileId: profileB })),
      );
      expect(finRecurringB[0]?.nextRun).toBe("2026-03-05");
      expect(finTransactionsB.filter((row) => row.recurringId !== null)).toHaveLength(1);
      // And the DERIVED balances agree with the restored rows — nothing about
      // the money was lost, rounded, or double-counted across the transfer.
      // 1000,00 − 12,50 − 11,90 (the generated charge) − 300,00 (out)
      // + 300,00 (in) = 975,60, in minor units.
      expect(finAccountsB.totalsByCurrency()).toEqual([
        { currency: "RSD", minorUnits: 975_60 },
      ]);

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

    it("counts the FIN module on both sides of the comparison table (migration 051)", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");
      const zipBytes = await buildArchiveZip(archive, fixtureA.blobBytes);
      const filePath = fixturePath("finance-counts.nexus.zip");
      await writeFile(filePath, zipBytes);

      const profileB = createProfile(dbB, "B");
      seedProfile(dbB, profileB, "B-old");

      const { deps } = makeTestDeps(dbB, filePath);
      await pickRestoreFile(deps);
      const preview = await previewRestore(deps, profileB, null);
      if (preview.status !== "ready") unreachable();

      // 2 accounts + 1 category + 1 budget + 1 subscription (migration 053) + 3
      // transactions: the two typed ones — the transfer among them counted ONCE,
      // because it is one row — plus the charge that subscription generated.
      expect(preview.preview.incoming.finance).toBe(8);
      expect(preview.preview.current.finance).toBe(8);
      // And the module really rides as its own manifest entry and its own file.
      expect(archive.files.has("data/finance.ndjson")).toBe(true);
      const manifest = JSON.parse(archive.files.get("manifest.json") ?? "") as {
        modules: { id: string; records: number }[];
        checksums: Record<string, string>;
      };
      expect(manifest.modules).toContainEqual({ id: "finance", records: 8 });
      expect(manifest.checksums["data/finance.ndjson"]).toBeDefined();
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

  describe("a kind-mismatched archive (ADR-058)", () => {
    /** A business-kind target with the Inbox every profile carries — `createProfile`'s shape, one column different. */
    function createBusinessProfile(handle: NexusDatabase, name: string): string {
      const id = uuidv7();
      const created = new Date().toISOString();
      handle.raw
        .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
        .run(id, "business", name, created);
      new TaskListStore(handle.raw, id).ensureInbox(created);
      return id;
    }

    it("refuses a personal archive into a business profile as a NAMED problem, both ways", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const personalArchive = buildArchiveFor(fixtureA, profileA, "A");
      const personalPath = fixturePath("personal.nexus.zip");
      await writeFile(personalPath, await buildArchiveZip(personalArchive, fixtureA.blobBytes));

      const businessTarget = createBusinessProfile(dbB, "Firma");
      const { deps } = makeTestDeps(dbB, personalPath);
      await pickRestoreFile(deps);
      const preview = await previewRestore(deps, businessTarget, null);
      expect(preview).toEqual({
        status: "invalid",
        problems: [
          {
            severity: "error",
            code: "profile-kind-mismatch",
            path: "manifest.json",
            detail: "personal -> business",
          },
        ],
      });

      // And the reverse pair refuses the same way.
      const businessArchive = buildArchiveFor(fixtureA, profileA, "A", "business");
      const businessPath = fixturePath("business.nexus.zip");
      await writeFile(businessPath, await buildArchiveZip(businessArchive, fixtureA.blobBytes));
      const personalTarget = createProfile(dbB, "B");
      const { deps: reverseDeps } = makeTestDeps(dbB, businessPath);
      await pickRestoreFile(reverseDeps);
      const reversePreview = await previewRestore(reverseDeps, personalTarget, null);
      if (reversePreview.status !== "invalid") unreachable();
      expect(reversePreview.problems[0]).toMatchObject({
        code: "profile-kind-mismatch",
        detail: "business -> personal",
      });
    });

    it("previews ready when the kinds match — a business archive into a business profile", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "Firma A", "business");
      const filePath = fixturePath("business-match.nexus.zip");
      await writeFile(filePath, await buildArchiveZip(archive, fixtureA.blobBytes));

      const businessTarget = createBusinessProfile(dbB, "Firma B");
      const { deps } = makeTestDeps(dbB, filePath);
      await pickRestoreFile(deps);
      const preview = await previewRestore(deps, businessTarget, null);
      if (preview.status !== "ready") unreachable();
      expect(preview.preview.sourceProfileName).toBe("Firma A");
      expect(preview.preview.targetProfileName).toBe("Firma B");
    });
  });

  describe("a kit module payload this build cannot read (ADR-090)", () => {
    it("refuses it as a NAMED problem at the preview, before anything is confirmed", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(
        {
          ...fixtureA,
          // The fixture's own section, with a payload this build's Timers module
          // will not take: the parser below is the module's own refusal, held in
          // the seam because this file is about the orchestration around it.
          data: {
            ...fixtureA.data,
            modules: [
              {
                moduleId: "timers",
                payload: { version: 99, presets: [], settings: { soundOnEnd: true } },
              },
            ],
          },
        },
        profileA,
        "A",
      );
      const filePath = fixturePath("invalid-module.nexus.zip");
      await writeFile(filePath, await buildArchiveZip(archive, fixtureA.blobBytes));

      const profileB = createProfile(dbB, "B");
      const modules = moduleSeam();
      modules.parsers.set("timers", () => {
        throw new Error("Timers data was written by another version of this module.");
      });
      const { deps } = makeTestDeps(dbB, filePath, null, null, null, null, modules);
      await pickRestoreFile(deps);

      const preview = await previewRestore(deps, profileB, null);

      expect(preview).toEqual({
        status: "invalid",
        problems: [
          {
            severity: "error",
            code: "invalid-module-data",
            path: "data/modules.ndjson",
            detail: expect.stringContaining("another version"),
          },
        ],
      });
      // Refused at the preview means nothing was confirmed: no module was
      // applied, and the profile the restore would have replaced is untouched.
      expect(modules.applied).toEqual([]);
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
        {
          data: dataWithSecondAttachment,
          settings: fixtureSource.settings,
          picture: fixtureSource.picture,
        },
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

      // And the bystander PROFILE wearing the archive's picture as its own
      // (SET-001) — the union's fifth member, on exactly the terms the three
      // above state. After the undo, the bystander's `profiles` row is the only
      // thing left naming those bytes: no attachment table and no dashboard row
      // references this hash at any point, so a count blind to `profiles` would
      // read 0 and delete the face another profile is still wearing.
      new ProfileStore(dbB.raw).setPicture(
        profileBystander,
        fixtureSource.ids.pictureSha,
        "image/png",
        fixtureSource.blobBytes.get(fixtureSource.ids.pictureSha)?.length ?? 1,
      );

      // The restore target: one pre-existing row the restore will wipe.
      const profileTarget = createProfile(dbB, "Target");
      const preexistingTask = new TaskStore(dbB.raw, profileTarget).create({ title: "Will be wiped by restore" });

      const { deps, blobs } = makeTestDeps(dbB, filePath);
      await pickRestoreFile(deps);
      const preview = await previewRestore(deps, profileTarget, null);
      if (preview.status !== "ready") unreachable();

      // Six distinct blobs: the shared note one, the private note one, the
      // task one (which no note attachment anywhere references), the subject
      // material (which nothing else references either), the dashboard
      // background (ADR-041) and the profile picture (SET-001) — one union, six
      // distinct hashes, and the last of them named by no row at all.
      const applyResult = await applyRestore(deps, profileTarget, preview.preview.token);
      expect(applyResult.blobsAdded).toBe(6);
      expect(blobs.has(fixtureSource.ids.attachmentSha)).toBe(true);
      expect(blobs.has(privateSha)).toBe(true);
      expect(blobs.has(fixtureSource.ids.taskAttachmentSha)).toBe(true);
      expect(blobs.has(fixtureSource.ids.subjectAttachmentSha)).toBe(true);
      expect(blobs.has(fixtureSource.ids.backgroundSha)).toBe(true);
      expect(blobs.has(fixtureSource.ids.pictureSha)).toBe(true);

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
      // As does the one only a SUBJECT MATERIAL names (migration 035).
      expect(blobs.has(fixtureSource.ids.subjectAttachmentSha)).toBe(true);
      // And the one only another PROFILE'S PICTURE names (SET-001, migration
      // 040): the union's newest member, proved by exactly the same undo — the
      // target gave the hash up, the bystander did not, and nothing but
      // `blobRefCount`'s fifth member could have known that.
      expect(blobs.has(fixtureSource.ids.pictureSha)).toBe(true);
      expect(blobs.has(fixtureSource.ids.backgroundSha)).toBe(false);
      expect(undoResult.blobsRemoved).toBe(2);

      // And the target's own picture came back to what it was before the
      // restore: none at all. An undo that put the rows back but left the
      // archive's face on would be an undo the user could see was incomplete.
      expect(new ProfileStore(dbB.raw).get(profileTarget)).toMatchObject({
        name: "Target",
        pictureHash: null,
      });
    });
  });

  describe("a missing blob", () => {
    it("previews with a warning, restores the row anyway, and reports missingBlobs: 1", async () => {
      const profileA = createProfile(dbA, "A");
      const fixtureA = seedProfile(dbA, profileA, "A");
      const archive = buildArchiveFor(fixtureA, profileA, "A");
      // Every DECORATION blob is withheld alongside the attachment this case is
      // about — the dashboard background and the profile picture — so "nothing
      // was written" below stays the assertion it was written to be. Neither
      // costs the restore anything beyond itself: each is a warning, and the
      // profile still comes back, plainer.
      const zipBytes = await buildArchiveZip(
        archive,
        fixtureA.blobBytes,
        new Set([
          fixtureA.ids.attachmentSha,
          fixtureA.ids.backgroundSha,
          fixtureA.ids.pictureSha,
        ]),
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
      expect(blobs.has(fixtureA.ids.pictureSha)).toBe(false);

      expect(
        new NoteAttachmentStore(dbB.raw, profileB).list(fixtureA.ids.note.id).map((row) => row.sha256),
      ).toContain(fixtureA.ids.attachmentSha);

      // The picture ROW is written even though its bytes were not — exactly the
      // attachment rule one line above, and the reason a lost image is a warning
      // rather than a refusal: the hash is still the honest record of what this
      // profile's picture IS, and the bytes may yet turn up in another archive.
      expect(new ProfileStore(dbB.raw).get(profileB)?.pictureHash).toBe(fixtureA.ids.pictureSha);
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

// --- Private notes through a restore (PRIV v1, ADR-057 §6) -------------------

/** A lowercase UUID, so the archive reader's `private-blobs/` allowlist recognises the entry. */
const ARCHIVE_PRIVATE_ATT = "0a1b2c3d-1111-4222-8333-abcdefabcdef";
const ARCHIVE_PRIVATE_ATT_MISSING = "ffffffff-2222-4333-8444-000000000001";
const ARCHIVE_PRIVATE_ATT_BYTES = new Uint8Array([11, 22, 33]);

/** One private note with a version and two attachment references — one whose `private-blobs/` entry the zip carries, one it does not. States are REAL Yjs updates, because the parser refuses anything less. */
function archivePrivateNotes(): ExportPrivateNotes {
  const state = Buffer.from(noteSnapshotWithLink("elsewhere", "Privatni sadržaj", "veza")).toString("base64");
  return {
    notes: [
      {
        id: "arch-priv-1",
        title: "Privatna iz arhive",
        yjsState: state,
        plaintext: "Privatni sadržaj",
        attachments: [
          { id: ARCHIVE_PRIVATE_ATT, fileName: "slika.png", mime: "image/png", sizeBytes: 3 },
          { id: ARCHIVE_PRIVATE_ATT_MISSING, fileName: "nema.pdf", mime: "application/pdf", sizeBytes: 5 },
        ],
        createdAt: "2026-01-05T00:00:00.000Z",
        updatedAt: "2026-01-06T00:00:00.000Z",
      },
    ],
    versions: [
      {
        noteId: "arch-priv-1",
        seq: 2,
        title: "Privatna (staro)",
        yjsState: state,
        plaintext: "staro",
        attachments: [],
        createdAt: "2026-01-05T00:00:00.000Z",
      },
    ],
  };
}

/** Writes profile A's archive CARRYING the private section to disk and answers its path. The missing attachment's entry is deliberately left out of the zip. */
async function writePrivateArchive(name: string): Promise<{ filePath: string; profileA: string }> {
  const profileA = createProfile(dbA, "A");
  const fixtureA = seedProfile(dbA, profileA, "A");
  const archive = buildArchiveFor(fixtureA, profileA, "A", "personal", archivePrivateNotes());
  const blobBytes = new Map(fixtureA.blobBytes);
  blobBytes.set(ARCHIVE_PRIVATE_ATT, ARCHIVE_PRIVATE_ATT_BYTES);
  const zipBytes = await buildArchiveZip(archive, blobBytes, new Set([ARCHIVE_PRIVATE_ATT_MISSING]));
  const filePath = fixturePath(name);
  await writeFile(filePath, zipBytes);
  return { filePath, profileA };
}

/** Seeds one sealed note + one sealed version on the TARGET through the real store — the rows a locked restore must preserve and an undo must put back byte-for-byte. */
function seedTargetSealedRows(profileId: string): { note: Uint8Array; version: Uint8Array } {
  const store = new PrivateNoteStore(dbB.raw, profileId);
  const note = new TextEncoder().encode("target-sealed-live");
  const version = new TextEncoder().encode("target-sealed-v1");
  const now = "2026-01-01T00:00:00.000Z";
  store.writeSealed("target-priv", note, now);
  store.writeVersion("target-priv", 1, version, now);
  return { note, version };
}

describe("private notes through a restore (ADR-057 §6)", () => {
  it("preview states the count either way; a LOCKED apply leaves the target's sealed rows untouched", async () => {
    const { filePath } = await writePrivateArchive("locked.nexus.zip");
    const profileB = createProfile(dbB, "B-target");
    const seeded = seedTargetSealedRows(profileB);
    const { deps, priv } = makeTestDeps(dbB, filePath);
    priv.unlocked = false;

    await pickRestoreFile(deps);
    const preview = await previewRestore(deps, profileB, null);
    if (preview.status !== "ready") unreachable();
    expect(preview.preview.privateNotes).toEqual({ count: 1, willRestore: false });
    // The missing private attachment was already named at preview time.
    expect(preview.preview.warnings).toContainEqual(
      expect.objectContaining({ code: "missing-blob", path: `private-blobs/${ARCHIVE_PRIVATE_ATT_MISSING}` }),
    );

    await applyRestore(deps, profileB, preview.preview.token);

    // The archive's private rows did NOT restore; the target's sealed rows
    // stand, byte for byte — a locked section costs nothing.
    const store = new PrivateNoteStore(dbB.raw, profileB);
    expect(store.list().map((meta) => meta.id)).toEqual(["target-priv"]);
    expect(new Uint8Array(store.readSealed("target-priv"))).toEqual(seeded.note);
    expect(priv.resealCalls).toBe(0);
    expect(priv.blobFiles.size).toBe(0);
  });

  it("preview reports null for an archive carrying no private notes", async () => {
    const profileA = createProfile(dbA, "A");
    const fixtureA = seedProfile(dbA, profileA, "A");
    const zipBytes = await buildArchiveZip(buildArchiveFor(fixtureA, profileA, "A"), fixtureA.blobBytes);
    const filePath = fixturePath("no-private.nexus.zip");
    await writeFile(filePath, zipBytes);
    const profileB = createProfile(dbB, "B-target");
    const { deps, priv } = makeTestDeps(dbB, filePath);
    priv.unlocked = true;

    await pickRestoreFile(deps);
    const preview = await previewRestore(deps, profileB, null);
    if (preview.status !== "ready") unreachable();
    expect(preview.preview.privateNotes).toBeNull();
  });

  it("an UNLOCKED apply re-seals and replaces; undo puts the original sealed rows back byte-for-byte and removes the fresh blob", async () => {
    const { filePath } = await writePrivateArchive("unlocked.nexus.zip");
    const profileB = createProfile(dbB, "B-target");
    const seeded = seedTargetSealedRows(profileB);
    const { deps, priv } = makeTestDeps(dbB, filePath);
    priv.unlocked = true;

    await pickRestoreFile(deps);
    const preview = await previewRestore(deps, profileB, null);
    if (preview.status !== "ready") unreachable();
    expect(preview.preview.privateNotes).toEqual({ count: 1, willRestore: true });

    const result = await applyRestore(deps, profileB, preview.preview.token);
    expect(priv.resealCalls).toBe(1);
    // The archive supplied one of the two private attachments; the other is
    // counted beside the content-addressed misses (here: none).
    expect(result.missingBlobs).toBe(1);
    // The supplied one's bytes were "sealed" under a fresh id BEFORE the
    // transaction — the double records exactly what the real reseal writes.
    expect([...priv.blobFiles.keys()]).toEqual([`fresh-${ARCHIVE_PRIVATE_ATT}`]);
    expect(priv.blobFiles.get(`fresh-${ARCHIVE_PRIVATE_ATT}`)).toEqual(ARCHIVE_PRIVATE_ATT_BYTES);

    // The private tables were REPLACED: the archive's note at live seq
    // max(2) + 1 = 3, its version at seq 2, the target's old row gone.
    const store = new PrivateNoteStore(dbB.raw, profileB);
    expect(store.list().map((meta) => meta.id)).toEqual(["arch-priv-1"]);
    expect(new TextDecoder().decode(store.readSealed("arch-priv-1"))).toBe("resealed:arch-priv-1:3");
    expect(store.listVersions("arch-priv-1")).toEqual([
      { seq: 2, createdAt: "2026-01-05T00:00:00.000Z" },
    ]);
    expect(new TextDecoder().decode(store.readVersion("arch-priv-1", 2))).toBe("resealed:arch-priv-1:v2");

    // UNDO: the pre-restore sealed rows come back byte-for-byte — no DEK
    // involved anywhere — and the re-seal's fresh blob file is removed.
    await undoRestore(deps, profileB);
    expect(store.list().map((meta) => meta.id)).toEqual(["target-priv"]);
    expect(new Uint8Array(store.readSealed("target-priv"))).toEqual(seeded.note);
    expect(new Uint8Array(store.readVersion("target-priv", 1))).toEqual(seeded.version);
    expect(priv.blobFiles.size).toBe(0);
  });

  it("the orphan-blob sweep runs only once the undo slot can no longer put sealed rows back", async () => {
    const { filePath } = await writePrivateArchive("sweep-order.nexus.zip");
    const profileB = createProfile(dbB, "B-target");
    seedTargetSealedRows(profileB);
    const { deps, priv } = makeTestDeps(dbB, filePath);
    priv.unlocked = true;

    await pickRestoreFile(deps);
    const preview = await previewRestore(deps, profileB, null);
    if (preview.status !== "ready") unreachable();
    await applyRestore(deps, profileB, preview.preview.token);

    // While the slot HOLDS the pre-restore sealed rows, nothing sweeps: those
    // rows' envelopes still own their blob files even though no live row does.
    expect(priv.sweepCalls).toEqual([]);
    expect(privateUndoPending(profileB)).toBe(true);

    await undoRestore(deps, profileB);

    // Exactly one sweep, and it saw the world it needs to see: the slot gone,
    // and the rows it was holding already back in the tables.
    expect(priv.sweepCalls).toEqual([
      { profileId: profileB, sealedIds: ["target-priv"], undoPending: false },
    ]);
  });

  it("an import preview names the private section as never imported, counted per record type", async () => {
    const { filePath } = await writePrivateArchive("import-private.nexus.zip");
    const profileB = createProfile(dbB, "B-target");
    const { deps } = makeTestDeps(dbB, filePath);

    await pickImportFile(deps);
    const preview = await previewImport(deps, profileB, null);
    if (preview.status !== "ready") unreachable();
    expect(preview.preview.report.skips).toContainEqual({
      code: "private-notes-not-imported", module: null, type: "private-note", count: 1,
    });
    expect(preview.preview.report.skips).toContainEqual({
      code: "private-notes-not-imported", module: null, type: "private-note-version", count: 1,
    });

    // And the apply writes NOTHING into the target's private tables.
    const applied = await applyImport(deps, profileB, preview.preview.token);
    expect(applied.rowsWritten).toBeGreaterThan(0);
    expect(new PrivateNoteStore(dbB.raw, profileB).list()).toEqual([]);
  });
});

describe("the search history never travels (SRCH-009 / migration 050)", () => {
  /**
   * The guard that would catch it silently starting to travel. `ProfileData`
   * is what an archive carries AND what a restore's undo captures — one shape,
   * one gather (`profileData.ts`'s own module header) — so a `searchHistory`
   * field added to either would put a person's queries into every archive they
   * ever hand to somebody else. It is not enough that nobody wrote that field
   * today: this asserts the FULL gathered payload carries no trace of a
   * recorded query, so adding one fails here rather than in a support ticket.
   */
  const SECRET_QUERY = "#zdravlje nalaz krvne slike";

  it("gathers nothing of it — not in the rows, not in the settings", async () => {
    const profile = createProfile(dbB, "B");
    seedProfile(dbB, profile, "B");
    new SearchHistoryStore(dbB.raw, profile).record(SECRET_QUERY, "2026-01-15T09:00:00.000Z");
    const deps = profileDataDeps(dbB);

    // Seeded, readable, and genuinely in the file the gather reads from — so a
    // pass below means "the gather does not carry it", never "there was
    // nothing to carry".
    expect(new SearchHistoryStore(dbB.raw, profile).list()).toEqual([
      { query: SECRET_QUERY, usedAt: "2026-01-15T09:00:00.000Z" },
    ]);

    expect(JSON.stringify(gatherProfileData(deps, profile))).not.toContain("zdravlje");
    expect(JSON.stringify(await gatherProfileSettings(deps, profile))).not.toContain("zdravlje");
  });

  it("survives a restore of the profile it belongs to — a replace is not an erasure", async () => {
    const profileA = createProfile(dbA, "A");
    const fixtureA = seedProfile(dbA, profileA, "A");
    const zipBytes = await buildArchiveZip(
      buildArchiveFor(fixtureA, profileA, "A"),
      fixtureA.blobBytes,
    );
    const filePath = fixturePath("history.nexus.zip");
    await writeFile(filePath, zipBytes);

    const profileB = createProfile(dbB, "B-target");
    const history = new SearchHistoryStore(dbB.raw, profileB);
    history.record(SECRET_QUERY, "2026-01-15T09:00:00.000Z");
    const { deps } = makeTestDeps(dbB, filePath);

    await pickRestoreFile(deps);
    const preview = await previewRestore(deps, profileB, null);
    if (preview.status !== "ready") unreachable();
    await applyRestore(deps, profileB, preview.preview.token);

    // The archive carried no queries to write, and the wipe list does not name
    // the table — so what this device's user typed is exactly what it was.
    expect(history.list()).toEqual([
      { query: SECRET_QUERY, usedAt: "2026-01-15T09:00:00.000Z" },
    ]);
  });
});

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
      // The ones the planner never imports are named rather than silently
      // absent — including the archive's profile picture (SET-001), which
      // reaches the planner from the MANIFEST rather than from a row and would
      // otherwise vanish with nothing on screen to say so.
      const codes = preview.preview.report.skips.map((skip) => skip.code);
      expect(codes).toContain("notifications-not-imported");
      expect(codes).toContain("settings-not-imported");
      expect(codes).toContain("source-inbox-collapsed");
      expect(codes).toContain("profile-picture-not-imported");

      // A dry run: the profile is byte for byte what it was.
      expect(gatherProfileData(deps, profileB)).toEqual(before);
    });

    it("salvages one bad row instead of refusing the archive, and names it in the report", async () => {
      // Restore mode would call this `invalid-record` at ERROR severity and
      // refuse the whole file; import mode drops the row and carries on. That
      // difference IS `mode: "import"` being wired through — nothing else in
      // this file can tell the two apart. The damage lands on `profileId`
      // rather than a type-specific field, so it stays a bad row no matter
      // which record type happens to lead the file (ADR-054 put the
      // calendar-settings row first).
      const { profileB, handle } = await twoProfiles("salvage.nexus.zip", (files) =>
        withDamagedRecord(files, "data/calendar.ndjson", (line) =>
          JSON.stringify({ ...(JSON.parse(line) as Record<string, unknown>), profileId: 5 }),
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
      // material's. NOT the dashboard background, and NOT the profile picture
      // (SET-001): an import never carries the archive's decoration, and a face
      // is the sharpest case of that rule — the target keeps its own.
      expect(result.blobsAdded).toBe(3);
      expect(blobs.has(fixtureA.ids.attachmentSha)).toBe(true);
      expect(blobs.has(fixtureA.ids.taskAttachmentSha)).toBe(true);
      expect(blobs.has(fixtureA.ids.subjectAttachmentSha)).toBe(true);
      expect(blobs.has(fixtureA.ids.backgroundSha)).toBe(false);
      expect(blobs.has(fixtureA.ids.pictureSha)).toBe(false);
      // The target is still wearing its OWN face, not the archive author's.
      expect(new ProfileStore(dbB.raw).get(profileB)?.pictureHash).not.toBe(
        fixtureA.ids.pictureSha,
      );
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

// --- Duplicate detection and re-planning (ADR-051 / IMEX-008) ----------------

describe("foreign import — what the target already has", () => {
  const T = "2026-01-01T00:00:00.000Z";

  /**
   * Profile A's archive on disk and profile B seeded beside it, with `shape`
   * given a chance to rewrite what the ARCHIVE carries (the archive is built
   * from the gathered `ProfileData`, so a row nobody stored can still travel in
   * it) and `overlap` a chance to put rows into B.
   *
   * `twoProfiles` above is the plain version; this one exists because every
   * test here is about the relationship BETWEEN the two profiles, which is
   * exactly what that helper cannot express.
   */
  async function twoProfilesWith(
    fileName: string,
    options: {
      shape?: (data: ProfileData, profileA: string) => ProfileData;
      overlap?: (profileB: string, fixtureA: SeededFixture) => void;
      seal?: string;
    } = {},
  ): Promise<{ profileB: string; fixtureA: SeededFixture; handle: TestDepsHandle }> {
    const profileA = createProfile(dbA, "A");
    const fixtureA = seedProfile(dbA, profileA, "A");
    const data = options.shape ? options.shape(fixtureA.data, profileA) : fixtureA.data;
    const archive = buildArchiveFor({ ...fixtureA, data }, profileA, "A");
    const zipBytes = await buildArchiveZip(archive, fixtureA.blobBytes);
    const filePath = fixturePath(fileName);
    await writeFile(
      filePath,
      options.seal === undefined ? zipBytes : await sealAsNxa1(zipBytes, options.seal),
    );

    const profileB = createProfile(dbB, "B-target");
    seedProfile(dbB, profileB, "B");
    options.overlap?.(profileB, fixtureA);
    return { profileB, fixtureA, handle: makeTestDeps(dbB, filePath) };
  }

  describe("the two latent crashes", () => {
    // Migration 028's `default_template_id` is deliberately NOT a foreign key:
    // it holds a `note_templates` id OR a `builtin:` code constant. The planner
    // used to remap it strictly, so any archive whose folder carried a built-in
    // default failed its whole PREVIEW — nothing about it could be seen, let
    // alone imported.
    it("previews and applies an archive whose folder default is a built-in template", async () => {
      const { profileB, handle } = await twoProfilesWith("builtin.nexus.zip", {
        shape: (data) => ({
          ...data,
          noteFolders: data.noteFolders.map((folder) => ({
            ...folder,
            defaultTemplateId: "builtin:sastanak",
          })),
        }),
      });
      const { deps } = handle;

      await pickImportFile(deps);
      const preview = await previewImport(deps, profileB, null);
      if (preview.status !== "ready") unreachable();

      await applyImport(deps, profileB, preview.preview.token);

      const folders = new NoteOrgStore(dbB.raw, profileB).listFolders();
      // The constant crossed unchanged: it names the same template in every
      // profile, so there was never anything to remap.
      expect(folders.some((folder) => folder.defaultTemplateId === "builtin:sastanak")).toBe(true);
    });

    // Migration 015 puts `UNIQUE (profile_id, name)` on note templates, and the
    // planner used to plan every source template unconditionally — so an archive
    // carrying a name the target already held took the ENTIRE import down with a
    // constraint failure at apply time, reported as a generic error.
    it("skips a note template whose name the target holds, and applies cleanly", async () => {
      const { profileB, handle } = await twoProfilesWith("template-clash.nexus.zip", {
        overlap: (targetProfile) => {
          new NoteTemplateStore(dbB.raw, targetProfile).save(
            "A template",
            JSON.stringify({ type: "doc", content: [] }),
            T,
          );
        },
      });
      const { deps } = handle;

      await pickImportFile(deps);
      const preview = await previewImport(deps, profileB, null);
      if (preview.status !== "ready") unreachable();

      expect(preview.preview.report.skips).toContainEqual({
        code: "template-name-taken",
        module: "notes",
        type: "note-template",
        count: 1,
      });

      // The apply is the actual regression: this is the call that used to throw
      // `UNIQUE constraint failed: note_templates.profile_id, note_templates.name`,
      // rolling the whole import back into a generic failure.
      await applyImport(deps, profileB, preview.preview.token);

      const templates = new NoteTemplateStore(dbB.raw, profileB).list();
      expect(templates.filter((row) => row.name === "A template")).toHaveLength(1);
    });
  });

  describe("detection against the live target", () => {
    /** Puts A's event, person, document and note attachment into B, so all four indexes have something to match. */
    function overlapAllFour(targetProfile: string, fixtureA: SeededFixture): void {
      new EventStore(dbB.raw, targetProfile).create({
        title: "A event",
        startAt: "2026-03-01T10:00:00.000Z",
      });
      // The same name and the same day, a DIFFERENT year — which must still
      // match, because a birthday's year is trivia the user often leaves blank.
      new PeopleStore(dbB.raw, targetProfile).create(
        { name: "A person", kind: "birthday", month: 2, day: 29, year: null, note: null },
        T,
      );
      new DocumentStore(dbB.raw, targetProfile).create({
        docType: "pasos",
        label: "Pasoš",
        expiryDate: "2031-05-05",
      });
      const note = new NoteStore(dbB.raw, targetProfile).list()[0];
      if (note === undefined) throw new Error("Test setup: profile B has no note to attach to.");
      new NoteAttachmentStore(dbB.raw, targetProfile).add(
        note.id,
        {
          fileName: "vec-je-tu.png",
          mime: "image/png",
          sizeBytes: 1,
          sha256: fixtureA.ids.attachmentSha,
        },
        T,
      );
    }

    /** A document and its renewal, added to what the ARCHIVE carries — `seedProfile` stores neither. */
    function withDocument(data: ProfileData, profileA: string): ProfileData {
      const documentId = uuidv7();
      return {
        ...data,
        documents: [
          {
            id: documentId,
            profileId: profileA,
            docType: "pasos",
            label: "Pasoš",
            expiryDate: "2030-01-01",
            reminderOffsets: [90, 30, 7],
            notes: null,
            createdAt: T,
            updatedAt: T,
          },
        ],
        renewals: [
          { id: uuidv7(), documentId, previousExpiry: "2020-01-01", renewedAt: T },
        ],
      };
    }

    it("names all four groups, skips them by default, and leaves the target's own rows alone", async () => {
      const { profileB, fixtureA, handle } = await twoProfilesWith("duplicates.nexus.zip", {
        shape: withDocument,
        overlap: overlapAllFour,
      });
      const { deps, blobs } = handle;

      await pickImportFile(deps);
      const preview = await previewImport(deps, profileB, null);
      if (preview.status !== "ready") unreachable();

      expect(preview.preview.report.duplicates).toEqual([
        { type: "event", count: 1 },
        { type: "person", count: 1 },
        { type: "document", count: 1 },
        { type: "attachment", count: 1 },
      ]);
      const duplicateSkips = preview.preview.report.skips.filter(
        (skip) => skip.code === "duplicate-of-existing",
      );
      expect(duplicateSkips).toContainEqual({
        code: "duplicate-of-existing", module: "calendar", type: "event", count: 1,
      });
      expect(duplicateSkips).toContainEqual({
        code: "duplicate-of-existing", module: "calendar", type: "person", count: 1,
      });
      expect(duplicateSkips).toContainEqual({
        code: "duplicate-of-existing", module: "calendar", type: "document", count: 1,
      });
      // The renewal goes with its document: it has no identity of its own.
      expect(duplicateSkips).toContainEqual({
        code: "duplicate-of-existing", module: "calendar", type: "renewal", count: 1,
      });
      expect(duplicateSkips).toContainEqual({
        code: "duplicate-of-existing", module: "notes", type: "note-attachment", count: 1,
      });

      for (const counts of Object.values(preview.preview.report.modules)) {
        expect(counts.parsed).toBe(counts.imported + counts.merged + counts.skipped);
      }

      await applyImport(deps, profileB, preview.preview.token);

      // Nothing arrived twice, and what B already had is untouched.
      expect(
        new EventStore(dbB.raw, profileB).listActive().filter((row) => row.title === "A event"),
      ).toHaveLength(1);
      expect(
        new PeopleStore(dbB.raw, profileB).listActive().filter((row) => row.name === "A person"),
      ).toHaveLength(1);
      expect(
        new DocumentStore(dbB.raw, profileB).listActive().filter((row) => row.label === "Pasoš"),
      ).toHaveLength(1);
      // The note that carried the skipped attachment still arrived — a file the
      // user already has is no reason to lose the note that referenced it.
      expect(new NoteStore(dbB.raw, profileB).list().length).toBeGreaterThan(2);
      // Its blob was never fetched: no surviving row names it, so `blobNames`
      // never held it and the apply had nothing to copy. The two attachments
      // that were NOT duplicates did travel, which is what makes this a real
      // assertion rather than an empty store.
      expect(blobs.has(fixtureA.ids.attachmentSha)).toBe(false);
      expect(blobs.has(fixtureA.ids.taskAttachmentSha)).toBe(true);
      expect(blobs.has(fixtureA.ids.subjectAttachmentSha)).toBe(true);
    });

    it("re-plans on a changed answer, minting a fresh token and importing the very same row", async () => {
      const { profileB, handle } = await twoProfilesWith("replan.nexus.zip", {
        shape: withDocument,
        overlap: overlapAllFour,
      });
      const { deps } = handle;

      await pickImportFile(deps);
      const first = await previewImport(deps, profileB, null);
      if (first.status !== "ready") unreachable();

      const replanned = replanImport(deps, profileB, first.preview.token, { event: "import" });
      if (replanned.status !== "ready") unreachable();

      // A FRESH token: the plan the old one named no longer exists.
      expect(replanned.preview.token).not.toBe(first.preview.token);
      // The group is still reported — the user has to be able to change back.
      expect(replanned.preview.report.duplicates).toContainEqual({ type: "event", count: 1 });
      // …and it is no longer among the skips.
      expect(
        replanned.preview.report.skips.filter(
          (skip) => skip.code === "duplicate-of-existing" && skip.type === "event",
        ),
      ).toEqual([]);
      // Everything else about the archive is described identically.
      expect(replanned.preview.sourceProfileName).toBe(first.preview.sourceProfileName);
      expect(replanned.preview.fileName).toBe(first.preview.fileName);
      expect(replanned.preview.createdAt).toBe(first.preview.createdAt);
      expect(replanned.preview.warnings).toEqual(first.preview.warnings);

      // The stale token cannot apply anymore; the fresh one can.
      await expect(applyImport(deps, profileB, first.preview.token)).rejects.toThrow();
      await applyImport(deps, profileB, replanned.preview.token);

      expect(
        new EventStore(dbB.raw, profileB).listActive().filter((row) => row.title === "A event"),
      ).toHaveLength(2);
      // The three groups nobody answered are still skipped — a re-plan carries
      // the WHOLE answer, and an unanswered group stays on the safe default.
      expect(
        new PeopleStore(dbB.raw, profileB).listActive().filter((row) => row.name === "A person"),
      ).toHaveLength(1);
    });

    it("re-plans a SEALED archive without re-opening the file or asking for the passphrase again", async () => {
      const { profileB, handle } = await twoProfilesWith("replan-sealed.nexus", {
        shape: withDocument,
        overlap: overlapAllFour,
        seal: "correct horse battery staple",
      });
      const { deps } = handle;

      await pickImportFile(deps);
      const first = await previewImport(deps, profileB, "correct horse battery staple");
      if (first.status !== "ready") unreachable();

      // From here on, ANY second open would be a second Argon2id pass and a
      // second passphrase prompt. The spy is installed after the preview, so a
      // single call would be one too many.
      const openArchiveSpy = vi.spyOn(archiveReaderModule, "openArchive");

      const replanned = replanImport(deps, profileB, first.preview.token, { attachment: "import" });
      if (replanned.status !== "ready") unreachable();

      expect(openArchiveSpy).not.toHaveBeenCalled();
      // And the re-plan really did re-plan: the attachment group is no longer
      // skipped, so its blob is back in the plan and the apply writes it.
      expect(
        replanned.preview.report.skips.filter(
          (skip) => skip.code === "duplicate-of-existing" && skip.type === "note-attachment",
        ),
      ).toEqual([]);

      const result = await applyImport(deps, profileB, replanned.preview.token);
      expect(result.missingBlobs).toBe(0);
    });

    it("refuses a re-plan with a stale token, a foreign profile, or no preview at all", async () => {
      const { profileB, handle } = await twoProfilesWith("replan-guards.nexus.zip", {
        overlap: overlapAllFour,
      });
      const { deps } = handle;
      const otherProfile = createProfile(dbB, "B-other");

      expect(() => replanImport(deps, profileB, "no-preview-yet", {})).toThrow();

      await pickImportFile(deps);
      const preview = await previewImport(deps, profileB, null);
      if (preview.status !== "ready") unreachable();

      expect(() => replanImport(deps, profileB, "not-the-real-token", {})).toThrow();
      expect(() => replanImport(deps, otherProfile, preview.preview.token, {})).toThrow();
      // The refusals left the plan exactly where it was.
      await applyImport(deps, profileB, preview.preview.token);
    });

    it("re-reads the target, so a row added between preview and re-plan is seen", async () => {
      const { profileB, handle } = await twoProfilesWith("replan-fresh-target.nexus.zip");
      const { deps } = handle;

      await pickImportFile(deps);
      const first = await previewImport(deps, profileB, null);
      if (first.status !== "ready") unreachable();
      expect(first.preview.report.duplicates).toEqual([]);

      // The user adds the very appointment the archive carries, in another
      // window, before answering anything.
      new EventStore(dbB.raw, profileB).create({
        title: "A event",
        startAt: "2026-03-01T10:00:00.000Z",
      });

      const replanned = replanImport(deps, profileB, first.preview.token, {});
      if (replanned.status !== "ready") unreachable();
      expect(replanned.preview.report.duplicates).toEqual([{ type: "event", count: 1 }]);
    });
  });
});

// --- Anki .apkg import (ADR-052 / STUDY-011) --------------------------------

/**
 * A real `.apkg` on disk, built the way `apkgReader.test.ts` builds its
 * fixtures: a genuine zip carrying a genuine schema-11 SQLite image. The
 * ORCHESTRATION is what these tests are about — the pick, the subject choice,
 * the seeded-id seam, the token and the shared undo — so the collection itself
 * is kept to the smallest thing that exercises both card kinds.
 */
async function writeApkgFixture(fileName: string): Promise<string> {
  const US = String.fromCharCode(0x1f);
  const db = new BetterSqlite3(":memory:");
  db.exec(`
    CREATE TABLE col (
      id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL,
      scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL,
      usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL,
      models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL
    );
    CREATE TABLE notes (
      id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL,
      usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL,
      csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL
    );
    CREATE TABLE cards (
      id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL,
      mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL,
      due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL,
      lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL,
      flags integer NOT NULL, data text NOT NULL
    );
  `);
  db.prepare("INSERT INTO col VALUES (1, 1700000000, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')").run(
    JSON.stringify({
      "10": { id: 10, name: "Basic", type: 0, tmpls: [{ ord: 0 }] },
      "20": { id: 20, name: "Cloze", type: 1, tmpls: [{ ord: 0 }] },
    }),
    JSON.stringify({ "1": { id: 1, name: "Fakultet::Biologija" } }),
  );
  const insertNote = db.prepare("INSERT INTO notes VALUES (?, ?, ?, 0, 0, ?, ?, '', 0, 0, '')");
  insertNote.run(100, "g100", 10, " ispit ", ["<b>Šta je ćelija?</b>", "Osnovna jedinica"].join(US));
  insertNote.run(200, "g200", 20, "", ["Reka je {{c1::Sava}}, grad je {{c2::Beograd}}.", ""].join(US));
  const insertCard = db.prepare(
    "INSERT INTO cards VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, 0, 0, 0, 0, 0, '')",
  );
  insertCard.run(1000, 100, 1, 0, 9);
  insertCard.run(1001, 200, 1, 0, 0);
  insertCard.run(1002, 200, 1, 1, 0);
  const collection = db.serialize();
  db.close();

  const zipBytes = await new Promise<Buffer>((resolve, reject) => {
    const zipfile = new ZipFile();
    zipfile.addBuffer(collection, "collection.anki2");
    zipfile.addBuffer(Buffer.from('{"0":"cell.jpg"}', "utf8"), "media");
    zipfile.addBuffer(Buffer.alloc(32, 3), "0");
    const chunks: Buffer[] = [];
    zipfile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zipfile.outputStream.on("error", reject);
    zipfile.end();
  });

  const filePath = fixturePath(fileName);
  await writeFile(filePath, zipBytes);
  return filePath;
}

describe("Anki .apkg import", () => {
  it("imports one deck and three cards under a NEW subject, and undoes them away completely", async () => {
    const filePath = await writeApkgFixture("deck.apkg");
    const profileB = createProfile(dbB, "B");
    const { deps, getReloadCount } = makeTestDeps(dbB, null, filePath);

    const picked = await pickApkgFile(deps);
    expect(picked).toEqual({ canceled: false, path: filePath, fileName: "deck.apkg" });

    const previewed = await previewApkgImport(deps, profileB, {
      existingSubjectId: null,
      newSubjectName: "Anki uvoz",
    });
    if (previewed.status !== "ready") unreachable();
    const preview = previewed.preview;
    expect(preview).toMatchObject({
      fileName: "deck.apkg",
      subjectName: "Anki uvoz",
      subjectIsNew: true,
      sourceDecks: 1,
      sourceNotes: 2,
      sourceCards: 3,
      plannedDecks: 1,
      plannedNotes: 2,
      plannedCards: 3,
    });
    // The plan's own arithmetic, straight off `planForeignImport` — a subject,
    // a deck and three cards, all inserted, none merged, none skipped.
    expect(preview.modules.study).toEqual({ parsed: 5, imported: 5, merged: 0, skipped: 0 });
    // Nothing has been written yet: a preview is a dry run.
    expect(new SubjectStore(dbB.raw, profileB).listActive()).toHaveLength(0);

    // Every named loss, counted: the media file, the note that had review
    // history, and the Anki tags on it.
    const skips = Object.fromEntries(preview.skips.map((skip) => [skip.code, skip.count]));
    expect(skips["media-stripped"]).toBe(1);
    expect(skips["history-dropped"]).toBe(1);
    expect(skips["tags-dropped"]).toBe(1);

    const applied = await applyApkgImport(deps, profileB, preview.token);
    expect(applied.rowsWritten).toBe(5);
    expect(applied.blobsAdded).toBe(0);
    expect(applied.missingBlobs).toBe(0);

    const subjects = new SubjectStore(dbB.raw, profileB).listActive();
    expect(subjects.map((subject) => subject.name)).toEqual(["Anki uvoz"]);
    const decks = new DeckStore(dbB.raw, profileB).listActive();
    expect(decks.map((deck) => deck.name)).toEqual(["Fakultet / Biologija"]);
    expect(decks[0]?.subjectId).toBe(subjects[0]?.id);

    const cards = new CardStore(dbB.raw, profileB).listByDeck(decks[0]?.id ?? "");
    expect(cards).toHaveLength(3);
    const basic = cards.find((card) => card.kind === "basic");
    expect(basic).toMatchObject({ front: "Šta je ćelija?", back: "Osnovna jedinica" });
    const clozes = cards
      .filter((card) => card.kind === "cloze")
      .sort((a, b) => (a.clozeOrdinal ?? 0) - (b.clozeOrdinal ?? 0));
    // Anki's own `cN` numbers cross over untouched (ADR-068), so the template
    // arrives spelled exactly as its author wrote it.
    expect(clozes.map((card) => card.clozeText)).toEqual([
      "Reka je {{c1::Sava}}, grad je {{c2::Beograd}}.",
      "Reka je {{c1::Sava}}, grad je {{c2::Beograd}}.",
    ]);
    expect(clozes[0]).toMatchObject({ front: "Reka je […], grad je Beograd.", clozeOrdinal: 1 });
    expect(clozes[1]).toMatchObject({ front: "Reka je Sava, grad je […].", clozeOrdinal: 2 });
    // Fresh FSRS, whatever the collection's own scheduling said.
    expect(
      cards.every((card) => card.reps === 0 && card.state === 0 && card.lastReview === null),
    ).toBe(true);

    // The shared banner, naming this operation as its own kind.
    expect(restoreStatus(profileB).undo?.kind).toBe("apkg");
    await flushSetTimeout();
    expect(getReloadCount()).toBe(1);

    await undoRestore(deps, profileB);
    expect(new SubjectStore(dbB.raw, profileB).listActive()).toHaveLength(0);
    expect(new DeckStore(dbB.raw, profileB).listActive()).toHaveLength(0);
    expect(restoreStatus(profileB).undo).toBeNull();
  });

  it("hangs the decks off an EXISTING subject without creating one (the seeded-id seam)", async () => {
    const filePath = await writeApkgFixture("existing.apkg");
    const profileB = createProfile(dbB, "B");
    const subjects = new SubjectStore(dbB.raw, profileB);
    const existing = subjects.create({ name: "Biologija" });
    const { deps } = makeTestDeps(dbB, null, filePath);

    await pickApkgFile(deps);
    const previewed = await previewApkgImport(deps, profileB, {
      existingSubjectId: existing.id,
      newSubjectName: null,
    });
    if (previewed.status !== "ready") unreachable();
    expect(previewed.preview.subjectName).toBe("Biologija");
    expect(previewed.preview.subjectIsNew).toBe(false);
    // One row fewer than the new-subject plan: no subject is created.
    expect(previewed.preview.modules.study.imported).toBe(4);

    await applyApkgImport(deps, profileB, previewed.preview.token);

    expect(subjects.listActive().map((subject) => subject.id)).toEqual([existing.id]);
    const decks = new DeckStore(dbB.raw, profileB).listActive();
    expect(decks).toHaveLength(1);
    expect(decks[0]?.subjectId).toBe(existing.id);
  });

  it("re-previews under a different subject without reading the file again", async () => {
    const filePath = await writeApkgFixture("replan.apkg");
    const profileB = createProfile(dbB, "B");
    const existing = new SubjectStore(dbB.raw, profileB).create({ name: "Biologija" });
    const { deps } = makeTestDeps(dbB, null, filePath);

    await pickApkgFile(deps);
    const readSpy = vi.spyOn(apkgReaderModule, "readApkg");

    const first = await previewApkgImport(deps, profileB, {
      existingSubjectId: null,
      newSubjectName: "Prvi pokušaj",
    });
    if (first.status !== "ready") unreachable();
    expect(readSpy).toHaveBeenCalledTimes(1);

    const second = await previewApkgImport(deps, profileB, {
      existingSubjectId: existing.id,
      newSubjectName: null,
    });
    if (second.status !== "ready") unreachable();
    // The collection was read ONCE: changing the subject costs a re-translate
    // and a re-plan, never a second walk over the file.
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(second.preview.subjectName).toBe("Biologija");
    // A fresh token, and the old plan gone with it.
    expect(second.preview.token).not.toBe(first.preview.token);
    await expect(applyApkgImport(deps, profileB, first.preview.token)).rejects.toThrow(/stale/);
  });

  it("refuses a stale token, a foreign profile and a second apply of the same plan", async () => {
    const filePath = await writeApkgFixture("guards.apkg");
    const profileB = createProfile(dbB, "B");
    const otherProfile = createProfile(dbB, "Drugi");
    const { deps } = makeTestDeps(dbB, null, filePath);

    await pickApkgFile(deps);
    const previewed = await previewApkgImport(deps, profileB, {
      existingSubjectId: null,
      newSubjectName: "S",
    });
    if (previewed.status !== "ready") unreachable();
    const token = previewed.preview.token;

    await expect(applyApkgImport(deps, profileB, "not-the-token")).rejects.toThrow(/stale/);
    await expect(applyApkgImport(deps, otherProfile, token)).rejects.toThrow(/different profile/);

    await applyApkgImport(deps, profileB, token);
    await expect(applyApkgImport(deps, profileB, token)).rejects.toThrow(/No \.apkg preview/);
  });

  it("refuses a subject this profile does not have", async () => {
    const filePath = await writeApkgFixture("subject.apkg");
    const profileB = createProfile(dbB, "B");
    const otherProfile = createProfile(dbB, "Drugi");
    const foreignSubject = new SubjectStore(dbB.raw, otherProfile).create({ name: "Tuđa" });
    const { deps } = makeTestDeps(dbB, null, filePath);

    await pickApkgFile(deps);
    await expect(
      previewApkgImport(deps, profileB, {
        existingSubjectId: foreignSubject.id,
        newSubjectName: null,
      }),
    ).rejects.toThrow(/No active subject/);
  });

  it("reports an unreadable file by code rather than rejecting", async () => {
    const filePath = fixturePath("nope.apkg");
    await writeFile(filePath, Buffer.from("ovo nije zip", "utf8"));
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null, filePath);

    await pickApkgFile(deps);
    await expect(
      previewApkgImport(deps, profileB, { existingSubjectId: null, newSubjectName: "S" }),
    ).resolves.toEqual({ status: "unreadable", code: "not-an-apkg" });
  });

  it("keeps its pick apart from the two archive picks and refuses a token across them", async () => {
    const filePath = await writeApkgFixture("apart.apkg");
    const profileA = createProfile(dbA, "A");
    const fixtureA = seedProfile(dbA, profileA, "A");
    const archive = buildArchiveFor(fixtureA, profileA, "A");
    const archivePath = fixturePath("apart.nexus.zip");
    await writeFile(archivePath, await buildArchiveZip(archive, fixtureA.blobBytes));

    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, archivePath, filePath);

    await pickImportFile(deps);
    await pickApkgFile(deps);
    // Picking an `.apkg` did not disturb the archive pick, and vice versa.
    const archivePreview = await previewImport(deps, profileB, null);
    if (archivePreview.status !== "ready") unreachable();
    const apkgPreview = await previewApkgImport(deps, profileB, {
      existingSubjectId: null,
      newSubjectName: "S",
    });
    if (apkgPreview.status !== "ready") unreachable();

    // Neither surface will honour the other's token.
    await expect(applyImport(deps, profileB, apkgPreview.preview.token)).rejects.toThrow(/stale/);
    await expect(applyApkgImport(deps, profileB, archivePreview.preview.token)).rejects.toThrow(
      /stale/,
    );
  });

  it("drops the pick on cancel and on lock", async () => {
    const filePath = await writeApkgFixture("drop.apkg");
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null, filePath);

    await pickApkgFile(deps);
    cancelApkgImport();
    await expect(
      previewApkgImport(deps, profileB, { existingSubjectId: null, newSubjectName: "S" }),
    ).resolves.toEqual({ status: "no-file" });

    await pickApkgFile(deps);
    clearRestoreState();
    await expect(
      previewApkgImport(deps, profileB, { existingSubjectId: null, newSubjectName: "S" }),
    ).resolves.toEqual({ status: "no-file" });
  });
});

// --- Calendar .ics import (ADR-061) ------------------------------------------

/**
 * A small real calendar on disk. The ORCHESTRATION is what these tests are
 * about — the pick, the parse held in the session, the duplicate answer on the
 * preview request, the token and the shared undo — so the file is kept to the
 * smallest thing that exercises an imported event, a counted component and a
 * counted trim; the format itself is `icsImport.test.ts`'s job.
 */
async function writeIcsFixture(fileName: string): Promise<string> {
  const text = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VTODO",
    "SUMMARY:Obaveza",
    "END:VTODO",
    "BEGIN:VEVENT",
    "UID:a",
    "DTSTAMP:20260731T000000Z",
    "SUMMARY:Sastanak",
    "DTSTART:20260812T100000",
    "DTEND:20260812T113000",
    "LOCATION:Sala 3",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:b",
    "DTSTAMP:20260731T000000Z",
    "SUMMARY:Koncert",
    "DTSTART:20260812T200000",
    "RRULE:FREQ=HOURLY",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const filePath = fixturePath(fileName);
  await writeFile(filePath, text, "utf8");
  return filePath;
}

describe("Calendar .ics import", () => {
  it("imports the file's events, names every loss, and undoes them away completely", async () => {
    const filePath = await writeIcsFixture("kalendar.ics");
    const profileB = createProfile(dbB, "B");
    const { deps, getReloadCount } = makeTestDeps(dbB, null, null, null, filePath);

    const picked = await pickIcsFile(deps);
    expect(picked).toEqual({ canceled: false, path: filePath, fileName: "kalendar.ics" });

    const previewed = await previewIcsImport(deps, profileB, false);
    if (previewed.status !== "ready") unreachable();
    const preview = previewed.preview;
    expect(preview).toMatchObject({
      fileName: "kalendar.ics",
      sourceEvents: 2,
      plannedEvents: 2,
      duplicates: 0,
      components: [{ name: "VTODO", count: 1 }],
      skips: [{ code: "recurrence-unmappable", count: 1 }],
    });
    // The plan's own arithmetic, straight off `planForeignImport`.
    expect(preview.modules.calendar).toEqual({ parsed: 2, imported: 2, merged: 0, skipped: 0 });
    // Nothing has been written yet: a preview is a dry run.
    expect(new EventStore(dbB.raw, profileB).listActive()).toHaveLength(0);

    const applied = await applyIcsImport(deps, profileB, preview.token);
    expect(applied.rowsWritten).toBe(2);
    expect(applied.blobsAdded).toBe(0);
    expect(applied.missingBlobs).toBe(0);

    const events = new EventStore(dbB.raw, profileB).listActive();
    expect(events.map((event) => event.title)).toEqual(["Sastanak", "Koncert"]);
    expect(events[0]).toMatchObject({
      startAt: "2026-08-12T10:00",
      endAt: "2026-08-12T11:30",
      allDay: false,
      location: "Sala 3",
      reminderOffsets: [],
    });
    // The HOURLY master arrived as the one-off the preview promised.
    expect(events[1]).toMatchObject({ startAt: "2026-08-12T20:00", recurrence: null });

    // The shared banner, naming this operation as its own kind.
    expect(restoreStatus(profileB).undo?.kind).toBe("ics");
    await flushSetTimeout();
    expect(getReloadCount()).toBe(1);

    await undoRestore(deps, profileB);
    expect(new EventStore(dbB.raw, profileB).listActive()).toHaveLength(0);
    expect(restoreStatus(profileB).undo).toBeNull();
  });

  it("skips an event this profile already has by default, and re-previews the other answer without reading the file again (ADR-051)", async () => {
    const filePath = await writeIcsFixture("dupli.ics");
    const profileB = createProfile(dbB, "B");
    new EventStore(dbB.raw, profileB).create({
      title: "Sastanak",
      startAt: "2026-08-12T10:00",
      allDay: false,
    });
    const { deps } = makeTestDeps(dbB, null, null, null, filePath);

    await pickIcsFile(deps);
    const readSpy = vi.spyOn(icsReaderModule, "readIcsText");

    const first = await previewIcsImport(deps, profileB, false);
    if (first.status !== "ready") unreachable();
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(first.preview).toMatchObject({ sourceEvents: 2, plannedEvents: 1, duplicates: 1 });
    expect(first.preview.modules.calendar).toEqual({
      parsed: 2,
      imported: 1,
      merged: 0,
      skipped: 1,
    });

    const second = await previewIcsImport(deps, profileB, true);
    if (second.status !== "ready") unreachable();
    // The file was read ONCE: changing the answer costs a re-plan against the
    // parsed events main already holds, never a second read.
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(second.preview).toMatchObject({ plannedEvents: 2, duplicates: 1 });
    // A fresh token, and the old plan gone with it.
    expect(second.preview.token).not.toBe(first.preview.token);
    await expect(applyIcsImport(deps, profileB, first.preview.token)).rejects.toThrow(/stale/);

    await applyIcsImport(deps, profileB, second.preview.token);
    // „Uvezi svejedno“ plans a second, independent row (ADR-051).
    const titles = new EventStore(dbB.raw, profileB).listActive().map((event) => event.title);
    expect(titles.filter((title) => title === "Sastanak")).toHaveLength(2);
  });

  it("refuses a stale token, a foreign profile and a second apply of the same plan", async () => {
    const filePath = await writeIcsFixture("guards.ics");
    const profileB = createProfile(dbB, "B");
    const otherProfile = createProfile(dbB, "Drugi");
    const { deps } = makeTestDeps(dbB, null, null, null, filePath);

    await pickIcsFile(deps);
    const previewed = await previewIcsImport(deps, profileB, false);
    if (previewed.status !== "ready") unreachable();
    const token = previewed.preview.token;

    await expect(applyIcsImport(deps, profileB, "not-the-token")).rejects.toThrow(/stale/);
    await expect(applyIcsImport(deps, otherProfile, token)).rejects.toThrow(/different profile/);

    await applyIcsImport(deps, profileB, token);
    await expect(applyIcsImport(deps, profileB, token)).rejects.toThrow(/No \.ics preview/);
  });

  it("reports an unreadable file by code rather than rejecting", async () => {
    const filePath = fixturePath("nope.ics");
    await writeFile(filePath, "ovo nije kalendar", "utf8");
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null, null, null, filePath);

    await pickIcsFile(deps);
    await expect(previewIcsImport(deps, profileB, false)).resolves.toEqual({
      status: "unreadable",
      code: "not-a-calendar",
    });
  });

  it("keeps its pick apart from the Anki pick and refuses a token across the surfaces", async () => {
    const icsPath = await writeIcsFixture("apart.ics");
    const apkgPath = await writeApkgFixture("apart-uz-ics.apkg");
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null, apkgPath, null, icsPath);

    await pickApkgFile(deps);
    await pickIcsFile(deps);
    // Picking an `.ics` did not disturb the `.apkg` pick, and vice versa.
    const apkgPreview = await previewApkgImport(deps, profileB, {
      existingSubjectId: null,
      newSubjectName: "S",
    });
    if (apkgPreview.status !== "ready") unreachable();
    const icsPreview = await previewIcsImport(deps, profileB, false);
    if (icsPreview.status !== "ready") unreachable();

    // Neither surface will honour the other's token.
    await expect(applyIcsImport(deps, profileB, apkgPreview.preview.token)).rejects.toThrow(/stale/);
    await expect(applyApkgImport(deps, profileB, icsPreview.preview.token)).rejects.toThrow(/stale/);
  });

  it("drops the pick on cancel and on lock", async () => {
    const filePath = await writeIcsFixture("drop.ics");
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null, null, null, filePath);

    await pickIcsFile(deps);
    cancelIcsImport();
    await expect(previewIcsImport(deps, profileB, false)).resolves.toEqual({ status: "no-file" });

    await pickIcsFile(deps);
    clearRestoreState();
    await expect(previewIcsImport(deps, profileB, false)).resolves.toEqual({ status: "no-file" });
  });
});

// --- LLM-assisted import (IMEX-005) ------------------------------------------

/** One pasted answer, wrapped the way an assistant actually wraps one: a fence and a sentence on either side. */
function llmAnswer(kind: "tasks" | "events" | "cards", records: unknown[]): string {
  const envelope = JSON.stringify({ "nexus-llm": "1", kind, records }, null, 2);
  return `Naravno, evo:\n\n\`\`\`json\n${envelope}\n\`\`\`\n\nJavi ako treba još nešto.`;
}

describe("LLM-assisted import", () => {
  it("imports pasted tasks into this profile's own default list, and undoes them away completely", async () => {
    const profileB = createProfile(dbB, "B");
    const { deps, getReloadCount } = makeTestDeps(dbB, null);

    const previewed = previewLlmImport(
      deps,
      profileB,
      "tasks",
      llmAnswer("tasks", [
        { title: "Prijaviti ispit", dueDate: "2026-09-01", priority: "high" },
        { title: "Kupiti svesku" },
        // Skipped by index, and the two above still arrive.
        { title: "Loš prioritet", priority: "urgent" },
      ]),
      null,
    );
    if (previewed.status !== "ready") unreachable();
    expect(previewed.preview).toMatchObject({
      kind: "tasks",
      records: 3,
      accepted: 2,
      planned: 2,
      duplicates: 0,
      droppedFields: 0,
      skipped: [{ index: 2, reason: "invalid-field", field: "priority" }],
    });

    // Nothing has been written yet: a preview is a dry run.
    expect(new TaskStore(dbB.raw, profileB).listActive()).toHaveLength(0);

    const applied = await applyLlmImport(deps, profileB, previewed.preview.token);
    expect(applied.rowsWritten).toBe(2);
    expect(applied.blobsAdded).toBe(0);

    const tasks = new TaskStore(dbB.raw, profileB).listActive();
    const inbox = new TaskListStore(dbB.raw, profileB)
      .listActive()
      .find((list) => list.isInbox);
    expect(tasks.map((task) => task.title).sort()).toEqual(["Kupiti svesku", "Prijaviti ispit"]);
    // `listId: null` in the plan means "this profile's own default list".
    expect(tasks.every((task) => task.listId === inbox?.id)).toBe(true);
    const exam = tasks.find((task) => task.title === "Prijaviti ispit");
    expect(exam).toMatchObject({ dueDate: "2026-09-01", priority: "high", done: false });

    // The shared banner, naming this operation as its own kind.
    expect(restoreStatus(profileB).undo?.kind).toBe("llm");
    await flushSetTimeout();
    expect(getReloadCount()).toBe(1);

    await undoRestore(deps, profileB);
    expect(new TaskStore(dbB.raw, profileB).listActive()).toHaveLength(0);
    expect(restoreStatus(profileB).undo).toBeNull();
  });

  it("skips an event this profile already has, and says how many (ADR-051)", async () => {
    const profileB = createProfile(dbB, "B");
    const events = new EventStore(dbB.raw, profileB);
    events.create({ title: "Sastanak", startAt: "2026-08-12T10:00", allDay: false });
    const { deps } = makeTestDeps(dbB, null);

    const previewed = previewLlmImport(
      deps,
      profileB,
      "events",
      llmAnswer("events", [
        { title: "Sastanak", startAt: "2026-08-12T10:00" },
        { title: "Koncert", startAt: "2026-08-12T20:00", location: "Dom omladine" },
      ]),
      null,
    );
    if (previewed.status !== "ready") unreachable();
    expect(previewed.preview).toMatchObject({ records: 2, accepted: 2, planned: 1, duplicates: 1 });

    await applyLlmImport(deps, profileB, previewed.preview.token);
    const titles = events.listActive().map((event) => event.title).sort();
    expect(titles).toEqual(["Koncert", "Sastanak"]);
    expect(events.listActive().find((event) => event.title === "Koncert")?.location).toBe(
      "Dom omladine",
    );
  });

  it("hangs cards off the chosen deck without creating one, expanding a cloze per blank", async () => {
    const profileB = createProfile(dbB, "B");
    const subject = new SubjectStore(dbB.raw, profileB).create({ name: "Biologija" });
    const decks = new DeckStore(dbB.raw, profileB);
    const deck = decks.create({ subjectId: subject.id, name: "Ćelija" });
    const { deps } = makeTestDeps(dbB, null);

    const previewed = previewLlmImport(
      deps,
      profileB,
      "cards",
      llmAnswer("cards", [
        { front: "Šta je ćelija?", back: "Osnovna jedinica" },
        { clozeText: "Reka je {{Sava}}, grad je {{Beograd}}." },
      ]),
      { existingDeckId: deck.id },
    );
    if (previewed.status !== "ready") unreachable();
    // Two records, three rows: the cloze template has two blanks.
    expect(previewed.preview).toMatchObject({ records: 2, accepted: 2, planned: 3 });

    await applyLlmImport(deps, profileB, previewed.preview.token);

    // No deck and no subject were created — the id map resolved onto the picked one.
    expect(decks.listActive().map((row) => row.id)).toEqual([deck.id]);
    expect(new SubjectStore(dbB.raw, profileB).listActive()).toHaveLength(1);

    const cards = new CardStore(dbB.raw, profileB).listByDeck(deck.id);
    expect(cards).toHaveLength(3);
    const clozes = cards
      .filter((card) => card.kind === "cloze")
      .sort((a, b) => (a.clozeOrdinal ?? 0) - (b.clozeOrdinal ?? 0));
    expect(clozes[0]).toMatchObject({ front: "Reka je […], grad je Beograd.", clozeOrdinal: 1 });
    expect(clozes[1]).toMatchObject({ front: "Reka je Sava, grad je […].", clozeOrdinal: 2 });
    // Fresh FSRS, exactly as every other importer creates a card.
    expect(cards.every((card) => card.reps === 0 && card.lastReview === null)).toBe(true);
  });

  it("refuses an answer whose kind is not the one the screen asked for", () => {
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null);

    expect(
      previewLlmImport(deps, profileB, "tasks", llmAnswer("events", []), null),
    ).toEqual({ status: "kind-mismatch", answered: "events" });
  });

  it("reports an unreadable paste by code rather than rejecting", () => {
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null);

    expect(previewLlmImport(deps, profileB, "tasks", "   ", null)).toEqual({
      status: "unreadable",
      code: "empty",
    });
    expect(
      previewLlmImport(deps, profileB, "tasks", "Izvini, ne mogu to da uradim.", null),
    ).toEqual({ status: "unreadable", code: "no-json" });
    // A trailing comma is refused, never repaired.
    expect(
      previewLlmImport(
        deps,
        profileB,
        "tasks",
        '{"nexus-llm":"1","kind":"tasks","records":[{"title":"A"},]}',
        null,
      ),
    ).toEqual({ status: "unreadable", code: "not-json" });
  });

  it("refuses a deck that is not a live deck of this profile", () => {
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null);
    const answer = llmAnswer("cards", [{ front: "a", back: "b" }]);

    expect(() => previewLlmImport(deps, profileB, "cards", answer, null)).toThrow(/deck/i);
    expect(() =>
      previewLlmImport(deps, profileB, "cards", answer, { existingDeckId: "not-a-deck" }),
    ).toThrow(/No active deck/);
  });

  it("creates a NEW deck under the chosen subject, and the cards inside it", async () => {
    const profileB = createProfile(dbB, "B");
    const subject = new SubjectStore(dbB.raw, profileB).create({ name: "Biologija" });
    const { deps } = makeTestDeps(dbB, null);

    const previewed = previewLlmImport(
      deps,
      profileB,
      "cards",
      llmAnswer("cards", [{ front: "Šta je ćelija?", back: "Osnovna jedinica" }]),
      { newDeckName: "Ćelija", subjectId: subject.id },
    );
    if (previewed.status !== "ready") unreachable();
    // The deck row itself is planned, so „Uvozi se" counts it beside the card.
    expect(previewed.preview).toMatchObject({ records: 1, accepted: 1, planned: 2 });

    await applyLlmImport(deps, profileB, previewed.preview.token);

    const decks = new DeckStore(dbB.raw, profileB).listActive();
    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({ name: "Ćelija", subjectId: subject.id });
    // No subject was created — the seam resolved onto the chosen one.
    expect(new SubjectStore(dbB.raw, profileB).listActive()).toHaveLength(1);
    expect(new CardStore(dbB.raw, profileB).listByDeck(decks[0]?.id ?? "")).toHaveLength(1);
  });

  it("resolves a new-deck name that a live deck of that subject already carries onto it", async () => {
    const profileB = createProfile(dbB, "B");
    const subject = new SubjectStore(dbB.raw, profileB).create({ name: "Biologija" });
    const decks = new DeckStore(dbB.raw, profileB);
    const existing = decks.create({ subjectId: subject.id, name: "Ćelija" });
    const { deps } = makeTestDeps(dbB, null);

    const previewed = previewLlmImport(
      deps,
      profileB,
      "cards",
      llmAnswer("cards", [{ front: "a", back: "b" }]),
      // Whitespace included, because the store itself trims before comparing.
      { newDeckName: "  Ćelija ", subjectId: subject.id },
    );
    if (previewed.status !== "ready") unreachable();
    // Get-or-create: the exact-name match IS the deck the user named, so no
    // second „Ćelija" is planned and the count is the card alone.
    expect(previewed.preview).toMatchObject({ records: 1, accepted: 1, planned: 1 });

    await applyLlmImport(deps, profileB, previewed.preview.token);
    expect(decks.listActive().map((row) => row.id)).toEqual([existing.id]);
    expect(new CardStore(dbB.raw, profileB).listByDeck(existing.id)).toHaveLength(1);
  });

  it("refuses a new deck under a subject that is not a live subject of this profile", () => {
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null);
    const answer = llmAnswer("cards", [{ front: "a", back: "b" }]);

    expect(() =>
      previewLlmImport(deps, profileB, "cards", answer, {
        newDeckName: "Ćelija",
        subjectId: "not-a-subject",
      }),
    ).toThrow(/No active subject/);
  });

  it("re-plans duplicate events onto „uvezi svejedno“ and back, rotating the token (ADR-051)", async () => {
    const profileB = createProfile(dbB, "B");
    const events = new EventStore(dbB.raw, profileB);
    events.create({ title: "Sastanak", startAt: "2026-08-12T10:00", allDay: false });
    const { deps } = makeTestDeps(dbB, null);

    const previewed = previewLlmImport(
      deps,
      profileB,
      "events",
      llmAnswer("events", [
        { title: "Sastanak", startAt: "2026-08-12T10:00" },
        { title: "Koncert", startAt: "2026-08-12T20:00" },
      ]),
      null,
    );
    if (previewed.status !== "ready") unreachable();
    expect(previewed.preview).toMatchObject({ planned: 1, duplicates: 1 });

    const replanned = replanLlmImport(deps, profileB, previewed.preview.token, true);
    if (replanned.status !== "ready") unreachable();
    // The group is still REPORTED — that is what lets the screen offer the way
    // back — but the plan now carries both events.
    expect(replanned.preview).toMatchObject({ planned: 2, duplicates: 1 });
    expect(replanned.preview.token).not.toBe(previewed.preview.token);
    // The replaced token no longer applies anything.
    await expect(applyLlmImport(deps, profileB, previewed.preview.token)).rejects.toThrow(/stale/);

    const back = replanLlmImport(deps, profileB, replanned.preview.token, false);
    if (back.status !== "ready") unreachable();
    expect(back.preview).toMatchObject({ planned: 1, duplicates: 1 });

    const again = replanLlmImport(deps, profileB, back.preview.token, true);
    if (again.status !== "ready") unreachable();
    await applyLlmImport(deps, profileB, again.preview.token);
    // The duplicate arrived as a second, independent row — nothing was merged.
    expect(events.listActive().map((event) => event.title).sort()).toEqual([
      "Koncert",
      "Sastanak",
      "Sastanak",
    ]);
  });

  it("refuses a re-plan with no pending preview, a stale token, or another profile", () => {
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null);

    expect(() => replanLlmImport(deps, profileB, "whatever", true)).toThrow(/No LLM/);

    const previewed = previewLlmImport(
      deps,
      profileB,
      "tasks",
      llmAnswer("tasks", [{ title: "A" }]),
      null,
    );
    if (previewed.status !== "ready") unreachable();
    expect(() => replanLlmImport(deps, profileB, "stale-token", true)).toThrow(/stale/);
    expect(() => replanLlmImport(deps, "other-profile", previewed.preview.token, true)).toThrow(
      /different profile/,
    );
  });

  it("keeps its plan apart from the other surfaces and refuses a token across them", async () => {
    const profileA = createProfile(dbA, "A");
    const fixtureA = seedProfile(dbA, profileA, "A");
    const archive = buildArchiveFor(fixtureA, profileA, "A");
    const archivePath = fixturePath("llm-apart.nexus.zip");
    await writeFile(archivePath, await buildArchiveZip(archive, fixtureA.blobBytes));

    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, archivePath);

    await pickImportFile(deps);
    const archivePreview = await previewImport(deps, profileB, null);
    if (archivePreview.status !== "ready") unreachable();
    const llmPreview = previewLlmImport(
      deps,
      profileB,
      "tasks",
      llmAnswer("tasks", [{ title: "A" }]),
      null,
    );
    if (llmPreview.status !== "ready") unreachable();

    await expect(applyImport(deps, profileB, llmPreview.preview.token)).rejects.toThrow(/stale/);
    await expect(applyLlmImport(deps, profileB, archivePreview.preview.token)).rejects.toThrow(
      /stale/,
    );
  });

  it("drops the plan on cancel and on lock", async () => {
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null);
    const answer = llmAnswer("tasks", [{ title: "A" }]);

    const first = previewLlmImport(deps, profileB, "tasks", answer, null);
    if (first.status !== "ready") unreachable();
    cancelLlmImport();
    await expect(applyLlmImport(deps, profileB, first.preview.token)).rejects.toThrow(/No LLM/);

    const second = previewLlmImport(deps, profileB, "tasks", answer, null);
    if (second.status !== "ready") unreachable();
    clearRestoreState();
    await expect(applyLlmImport(deps, profileB, second.preview.token)).rejects.toThrow(/No LLM/);
  });
});

// --- CSV task import (ADR-062) -----------------------------------------------

/** One hand-kept table, comma-separated with a header — a quoted tags cell, a done row with a Serbian date, an empty-title row and an unreadable date. */
const CSV_FIXTURE = [
  "naziv,rok,prioritet,status,oznake,sekcija",
  'Prijaviti ispit,2026-09-01,visok,,"faks, hitno",Avgust',
  "Kupiti sveske,31.8.2026.,,done,faks,",
  ",2026-09-02,,,,",
  "Bez roka,kad stignem,srednji,,,Avgust",
  "",
].join("\r\n");

async function writeCsvFixture(fileName: string, content: string): Promise<string> {
  const filePath = fixturePath(fileName);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

describe("CSV task import", () => {
  it("imports a mapped table into a NEW list, merges a known tag, and undoes it all away", async () => {
    const filePath = await writeCsvFixture("zadaci.csv", CSV_FIXTURE);
    const profileB = createProfile(dbB, "B");
    // The target already has one of the file's two tags: the planner must
    // MERGE it by name rather than create a twin.
    const existingTag = new TaskTagStore(dbB.raw, profileB).createTag(
      "faks",
      new Date().toISOString(),
    );
    const { deps, getReloadCount } = makeTestDeps(dbB, null, null, filePath);

    const picked = await pickCsvFile(deps);
    expect(picked).toEqual({ canceled: false, path: filePath, fileName: "zadaci.csv" });

    const previewed = await previewCsvImport(deps, null, null);
    if (previewed.status !== "ready") unreachable();
    expect(previewed.preview).toMatchObject({
      fileName: "zadaci.csv",
      delimiter: ",",
      hasHeader: true,
      rows: 4,
    });
    // Columns with their headers, first samples and the SUGGESTED mapping —
    // the quoted tags cell already unquoted.
    expect(previewed.preview.columns.map((column) => column.header)).toEqual([
      "naziv",
      "rok",
      "prioritet",
      "status",
      "oznake",
      "sekcija",
    ]);
    expect(previewed.preview.columns.map((column) => column.suggestedRole)).toEqual([
      "title",
      "dueDate",
      "priority",
      "status",
      "tags",
      "section",
    ]);
    expect(previewed.preview.columns[4]?.samples).toEqual(["faks, hitno", "faks", ""]);

    const mapped = mapCsvImport(
      deps,
      profileB,
      ["title", "dueDate", "priority", "status", "tags", "section"],
      { existingListId: null, newListName: "Uvoz" },
    );
    if (mapped.status !== "ready") unreachable();
    const plan = mapped.preview;
    expect(plan).toMatchObject({ listName: "Uvoz", listIsNew: true, rows: 4, tasks: 3, blankRows: 0 });
    // Every named loss, with the row number the user's spreadsheet shows.
    expect(plan.drops).toEqual([
      { row: 3, code: "empty-title" },
      { row: 4, code: "bad-due-date" },
    ]);
    // The planner's own arithmetic: the one shared tag merged, nothing skipped.
    expect(plan.modules.tasks.merged).toBe(1);
    expect(plan.modules.tasks.skipped).toBe(0);
    expect(plan.modules.tasks.imported).toBe(plan.modules.tasks.parsed - 1);
    // Nothing has been written yet: a preview is a dry run.
    expect(new TaskStore(dbB.raw, profileB).listActive()).toHaveLength(0);

    const applied = await applyCsvImport(deps, profileB, plan.token);
    expect(applied.blobsAdded).toBe(0);
    expect(applied.missingBlobs).toBe(0);

    const lists = new TaskListStore(dbB.raw, profileB).listActive();
    const uvoz = lists.find((list) => list.name === "Uvoz");
    expect(uvoz).toBeDefined();
    const tasks = new TaskStore(dbB.raw, profileB).listActive();
    expect(tasks.map((task) => task.title).sort()).toEqual([
      "Bez roka",
      "Kupiti sveske",
      "Prijaviti ispit",
    ]);
    expect(tasks.every((task) => task.listId === uvoz?.id)).toBe(true);
    expect(tasks.find((task) => task.title === "Prijaviti ispit")).toMatchObject({
      dueDate: "2026-09-01",
      priority: "high",
      done: false,
    });
    // The Serbian date normalized; the done row completed, per migration 002's CHECK.
    expect(tasks.find((task) => task.title === "Kupiti sveske")).toMatchObject({
      dueDate: "2026-08-31",
      done: true,
    });
    // The unreadable date cost the DATE, never the task.
    expect(tasks.find((task) => task.title === "Bez roka")).toMatchObject({
      dueDate: null,
      priority: "medium",
    });

    // One section inside the new list, holding the two rows that named it.
    const sections = new TaskListStore(dbB.raw, profileB).listSections(uvoz?.id ?? "");
    expect(sections.map((section) => section.name)).toEqual(["Avgust"]);
    const inSection = tasks.filter((task) => task.sectionId === sections[0]?.id);
    expect(inSection.map((task) => task.title).sort()).toEqual(["Bez roka", "Prijaviti ispit"]);

    // „faks" merged onto the pre-existing tag; only „hitno" is new.
    const tags = new TaskTagStore(dbB.raw, profileB).listTags();
    expect(tags.map((tag) => tag.name).sort()).toEqual(["faks", "hitno"]);
    expect(tags.find((tag) => tag.name === "faks")?.id).toBe(existingTag.id);

    // The shared banner, naming this operation as its own kind.
    expect(restoreStatus(profileB).undo?.kind).toBe("csv");
    await flushSetTimeout();
    expect(getReloadCount()).toBe(1);

    await undoRestore(deps, profileB);
    expect(new TaskStore(dbB.raw, profileB).listActive()).toHaveLength(0);
    expect(
      new TaskListStore(dbB.raw, profileB).listActive().find((list) => list.name === "Uvoz"),
    ).toBeUndefined();
    // The pre-existing tag survives the undo; the imported one is gone.
    expect(new TaskTagStore(dbB.raw, profileB).listTags().map((tag) => tag.name)).toEqual(["faks"]);
    expect(restoreStatus(profileB).undo).toBeNull();
  });

  it("files the tasks into an EXISTING list without creating one (the seeded-id seam)", async () => {
    const filePath = await writeCsvFixture("postojeca.csv", CSV_FIXTURE);
    const profileB = createProfile(dbB, "B");
    const inbox = new TaskListStore(dbB.raw, profileB).listActive().find((list) => list.isInbox);
    if (inbox === undefined) unreachable();
    const { deps } = makeTestDeps(dbB, null, null, filePath);

    await pickCsvFile(deps);
    await previewCsvImport(deps, null, null);
    const mapped = mapCsvImport(
      deps,
      profileB,
      ["title", "dueDate", "priority", "status", "tags", "section"],
      { existingListId: inbox.id, newListName: null },
    );
    if (mapped.status !== "ready") unreachable();
    expect(mapped.preview.listName).toBe(inbox.name);
    expect(mapped.preview.listIsNew).toBe(false);

    await applyCsvImport(deps, profileB, mapped.preview.token);
    const lists = new TaskListStore(dbB.raw, profileB).listActive();
    // No list row was created: the Inbox is still the only list.
    expect(lists).toHaveLength(1);
    expect(new TaskStore(dbB.raw, profileB).listActive().every((task) => task.listId === inbox.id)).toBe(
      true,
    );
  });

  it("reads a new-list name an active list already carries as THAT list (get-or-create)", async () => {
    const filePath = await writeCsvFixture("imenjak.csv", "naziv\r\nZadatak\r\n");
    const profileB = createProfile(dbB, "B");
    const listStore = new TaskListStore(dbB.raw, profileB);
    const posao = listStore.createList({ name: "Posao" }, new Date().toISOString());
    const { deps } = makeTestDeps(dbB, null, null, filePath);

    await pickCsvFile(deps);
    await previewCsvImport(deps, null, null);
    const mapped = mapCsvImport(deps, profileB, ["title"], {
      existingListId: null,
      newListName: "Posao",
    });
    if (mapped.status !== "ready") unreachable();
    expect(mapped.preview.listIsNew).toBe(false);

    await applyCsvImport(deps, profileB, mapped.preview.token);
    expect(listStore.listActive().filter((list) => list.name === "Posao")).toHaveLength(1);
    expect(new TaskStore(dbB.raw, profileB).listActive()[0]?.listId).toBe(posao.id);
  });

  it("re-previews under a delimiter/header override without reading the file again", async () => {
    const filePath = await writeCsvFixture(
      "tacka-zapeta.csv",
      "naziv;rok\r\nZadatak;2026-09-01\r\n",
    );
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null, null, filePath);

    await pickCsvFile(deps);
    const readSpy = vi.spyOn(csvReaderModule, "readCsvText");

    const first = await previewCsvImport(deps, null, null);
    if (first.status !== "ready") unreachable();
    expect(first.preview.delimiter).toBe(";");
    expect(first.preview.columns).toHaveLength(2);
    expect(readSpy).toHaveBeenCalledTimes(1);

    // Forcing the comma re-parses the TEXT: one column now, and no second read.
    const second = await previewCsvImport(deps, ",", false);
    if (second.status !== "ready") unreachable();
    expect(second.preview.delimiter).toBe(",");
    expect(second.preview.hasHeader).toBe(false);
    expect(second.preview.columns).toHaveLength(1);
    expect(second.preview.rows).toBe(2);
    expect(readSpy).toHaveBeenCalledTimes(1);
    void profileB;
  });

  it("invalidates a confirmed plan when a re-preview re-parses the table", async () => {
    const filePath = await writeCsvFixture("ponisti.csv", "naziv\r\nZadatak\r\n");
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null, null, filePath);

    await pickCsvFile(deps);
    await previewCsvImport(deps, null, null);
    const mapped = mapCsvImport(deps, profileB, ["title"], {
      existingListId: null,
      newListName: "Uvoz",
    });
    if (mapped.status !== "ready") unreachable();

    await previewCsvImport(deps, null, false);
    await expect(applyCsvImport(deps, profileB, mapped.preview.token)).rejects.toThrow(
      /No CSV mapping/,
    );
  });

  it("re-maps the same rows under a fresh token, and refuses the stale one", async () => {
    const filePath = await writeCsvFixture("remap.csv", CSV_FIXTURE);
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null, null, filePath);

    await pickCsvFile(deps);
    await previewCsvImport(deps, null, null);
    const roles: Parameters<typeof mapCsvImport>[2] = [
      "title",
      "dueDate",
      "priority",
      "status",
      "tags",
      "section",
    ];
    const first = mapCsvImport(deps, profileB, roles, { existingListId: null, newListName: "A" });
    if (first.status !== "ready") unreachable();
    const second = mapCsvImport(deps, profileB, roles, { existingListId: null, newListName: "B" });
    if (second.status !== "ready") unreachable();
    expect(second.preview.token).not.toBe(first.preview.token);
    await expect(applyCsvImport(deps, profileB, first.preview.token)).rejects.toThrow(/stale/);
  });

  it("counts a mapped list column's cells as dropped — every task still lands in the one chosen list", async () => {
    const filePath = await writeCsvFixture(
      "kolona-lista.csv",
      "naziv,lista\r\nPrvi,Posao\r\nDrugi,\r\nTreći,Kuća\r\n",
    );
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null, null, filePath);

    await pickCsvFile(deps);
    const previewed = await previewCsvImport(deps, null, null);
    if (previewed.status !== "ready") unreachable();
    expect(previewed.preview.columns.map((column) => column.suggestedRole)).toEqual([
      "title",
      "list",
    ]);

    const mapped = mapCsvImport(deps, profileB, ["title", "list"], {
      existingListId: null,
      newListName: "Uvoz",
    });
    if (mapped.status !== "ready") unreachable();
    expect(mapped.preview.tasks).toBe(3);
    expect(mapped.preview.listCellsDropped).toBe(2);

    await applyCsvImport(deps, profileB, mapped.preview.token);
    const lists = new TaskListStore(dbB.raw, profileB).listActive();
    expect(lists.map((list) => list.name).sort()).toEqual([
      lists.find((list) => list.isInbox)?.name ?? "",
      "Uvoz",
    ].sort());
  });

  it("refuses a stale token, a foreign profile, a second apply and a foreign list", async () => {
    const filePath = await writeCsvFixture("cuvari.csv", "naziv\r\nZadatak\r\n");
    const profileB = createProfile(dbB, "B");
    const otherProfile = createProfile(dbB, "Drugi");
    const foreignList = new TaskListStore(dbB.raw, otherProfile).createList(
      { name: "Tuđa" },
      new Date().toISOString(),
    );
    const { deps } = makeTestDeps(dbB, null, null, filePath);

    await pickCsvFile(deps);
    await previewCsvImport(deps, null, null);
    expect(() =>
      mapCsvImport(deps, profileB, ["title"], { existingListId: foreignList.id, newListName: null }),
    ).toThrow(/No active list/);

    const mapped = mapCsvImport(deps, profileB, ["title"], {
      existingListId: null,
      newListName: "Uvoz",
    });
    if (mapped.status !== "ready") unreachable();
    const token = mapped.preview.token;

    await expect(applyCsvImport(deps, profileB, "not-the-token")).rejects.toThrow(/stale/);
    await expect(applyCsvImport(deps, otherProfile, token)).rejects.toThrow(/different profile/);

    await applyCsvImport(deps, profileB, token);
    await expect(applyCsvImport(deps, profileB, token)).rejects.toThrow(/No CSV mapping/);
  });

  it("refuses a mapping whose length is not the parsed table's column count", async () => {
    const filePath = await writeCsvFixture("duzina.csv", "naziv,rok\r\nZadatak,2026-09-01\r\n");
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null, null, filePath);

    await pickCsvFile(deps);
    await previewCsvImport(deps, null, null);
    expect(() =>
      mapCsvImport(deps, profileB, ["title"], { existingListId: null, newListName: "Uvoz" }),
    ).toThrow(/columns/);
  });

  it("reports an empty file — and a header-only file — by code rather than rejecting", async () => {
    const emptyPath = await writeCsvFixture("prazan.csv", "");
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null, null, emptyPath);

    await pickCsvFile(deps);
    await expect(previewCsvImport(deps, null, null)).resolves.toEqual({
      status: "unreadable",
      code: "empty",
    });

    const headerOnly = await writeCsvFixture("samo-zaglavlje.csv", "naziv,rok\r\n");
    const { deps: deps2 } = makeTestDeps(dbB, null, null, headerOnly);
    await pickCsvFile(deps2);
    await expect(previewCsvImport(deps2, null, null)).resolves.toEqual({
      status: "unreadable",
      code: "empty",
    });
    void profileB;
  });

  it("keeps its pick apart from the other surfaces and refuses a token across them", async () => {
    const csvPath = await writeCsvFixture("odvojen.csv", "naziv\r\nZadatak\r\n");
    const apkgPath = await writeApkgFixture("odvojen.apkg");
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null, apkgPath, csvPath);

    await pickApkgFile(deps);
    await pickCsvFile(deps);
    // Picking a CSV did not disturb the .apkg pick, and vice versa.
    const apkgPreview = await previewApkgImport(deps, profileB, {
      existingSubjectId: null,
      newSubjectName: "S",
    });
    if (apkgPreview.status !== "ready") unreachable();
    await previewCsvImport(deps, null, null);
    const mapped = mapCsvImport(deps, profileB, ["title"], {
      existingListId: null,
      newListName: "Uvoz",
    });
    if (mapped.status !== "ready") unreachable();

    // Neither surface will honour the other's token.
    await expect(applyApkgImport(deps, profileB, mapped.preview.token)).rejects.toThrow(/stale/);
    await expect(applyCsvImport(deps, profileB, apkgPreview.preview.token)).rejects.toThrow(/stale/);
  });

  it("drops the pick on cancel and on lock", async () => {
    const filePath = await writeCsvFixture("otkaz.csv", "naziv\r\nZadatak\r\n");
    const profileB = createProfile(dbB, "B");
    const { deps } = makeTestDeps(dbB, null, null, filePath);

    await pickCsvFile(deps);
    cancelCsvImport();
    await expect(previewCsvImport(deps, null, null)).resolves.toEqual({ status: "no-file" });

    await pickCsvFile(deps);
    clearRestoreState();
    await expect(previewCsvImport(deps, null, null)).resolves.toEqual({ status: "no-file" });
    void profileB;
  });
});

// --- Bank statement CSV → FIN (FIN slice e) ----------------------------------

/**
 * One Serbian bank statement: semicolon-separated (what Serbian-locale Excel
 * writes, because the decimal comma has taken the comma), grouped decimals, the
 * `dd.mm.yyyy.` norm, and a separate „Isplata"/„Uplata" pair. Two identical
 * coffees on the last day, deliberately: that is the case a naive fingerprint
 * silently loses.
 */
const FIN_CSV_FIXTURE = [
  "Datum;Opis transakcije;Isplata;Uplata;Valuta",
  "31.08.2026.;KUPOVINA MAXI BEOGRAD;1.234,56;0,00;RSD",
  "01.09.2026.;PLATA AVGUST;;85.000,00;RSD",
  "02.09.2026.;KAFA;350,00;0,00;RSD",
  "02.09.2026.;KAFA;350,00;0,00;RSD",
  "",
].join("\r\n");

/** The roles that fixture maps to, in column order. */
const FIN_CSV_ROLES = ["date", "note", "outflow", "inflow", "currency"] as const;

/** An RSD account to import into — the one thing a statement cannot supply. */
function createFinAccount(db: NexusDatabase, profileId: string, currency = "RSD"): string {
  return new FinAccountStore(db.raw, profileId).create(
    { name: "Tekući", kind: "current", currency, openingBalance: 0 },
    new Date().toISOString(),
  ).id;
}

describe("bank statement CSV import (FIN slice e)", () => {
  it("reads a Serbian statement into the chosen account, saying how it read it", async () => {
    const filePath = await writeCsvFixture("izvod.csv", FIN_CSV_FIXTURE);
    const profileB = createProfile(dbB, "B");
    const accountId = createFinAccount(dbB, profileB);
    const { deps, getReloadCount } = makeTestDeps(dbB, null, null, null, null, filePath);

    const picked = await pickFinCsvFile(deps);
    expect(picked).toEqual({ canceled: false, path: filePath, fileName: "izvod.csv" });

    const previewed = await previewFinCsvImport(deps, null, null);
    if (previewed.status !== "ready") unreachable();
    // The semicolon is sniffed, the header is recognised, and the bilingual
    // table suggests every one of the five columns.
    expect(previewed.preview).toMatchObject({ delimiter: ";", hasHeader: true, rows: 4 });
    expect(previewed.preview.columns.map((column) => column.suggestedRole)).toEqual([
      "date",
      "note",
      "outflow",
      "inflow",
      "currency",
    ]);

    const mapped = mapFinCsvImport(
      deps,
      profileB,
      [...FIN_CSV_ROLES],
      accountId,
      "negative-is-expense",
    );
    if (mapped.status !== "ready") unreachable();
    const plan = mapped.preview;
    expect(plan).toMatchObject({
      accountName: "Tekući",
      currency: "RSD",
      rows: 4,
      transactions: 4,
      blankRows: 0,
      // The two conventions, settled over whole columns and SAID rather than
      // trusted.
      amountFormat: "decimal-comma",
      dateFormat: "dmy-dot",
    });
    expect(plan.drops).toEqual([]);
    expect(plan.skips).toEqual([]);
    expect(plan.modules.finance.imported).toBe(4);
    // Nothing has been written yet: a preview is a dry run.
    expect(new FinTransactionStore(dbB.raw, profileB).listActive()).toHaveLength(0);

    const applied = await applyFinCsvImport(deps, profileB, plan.token);
    expect(applied.blobsAdded).toBe(0);

    const rows = new FinTransactionStore(dbB.raw, profileB).listActive();
    expect(rows).toHaveLength(4);
    // Money is exact minor units, the grouping read as grouping, the outflow
    // negative and the inflow positive — and every row on the chosen account,
    // uncategorized and never a transfer.
    expect(rows.map((row) => row.amount).sort((a, b) => a - b)).toEqual([
      -123456, -35000, -35000, 8500000,
    ]);
    for (const row of rows) {
      expect(row.accountId).toBe(accountId);
      expect(row.counterAccountId).toBeNull();
      expect(row.categoryId).toBeNull();
      expect(row.importKey).not.toBeNull();
    }
    // The two identical coffees are TWO rows with TWO different fingerprints.
    const coffees = rows.filter((row) => row.note === "KAFA");
    expect(coffees).toHaveLength(2);
    expect(new Set(coffees.map((row) => row.importKey)).size).toBe(2);
    expect(getReloadCount()).toBe(0);
  });

  it("adds nothing the second time the SAME statement is imported, naming every skip", async () => {
    const filePath = await writeCsvFixture("izvod-opet.csv", FIN_CSV_FIXTURE);
    const profileB = createProfile(dbB, "B");
    const accountId = createFinAccount(dbB, profileB);
    const { deps } = makeTestDeps(dbB, null, null, null, null, filePath);

    await pickFinCsvFile(deps);
    await previewFinCsvImport(deps, null, null);
    const first = mapFinCsvImport(deps, profileB, [...FIN_CSV_ROLES], accountId, "negative-is-expense");
    if (first.status !== "ready") unreachable();
    await applyFinCsvImport(deps, profileB, first.preview.token);

    // The same file again, picked afresh — which is exactly what a user who
    // re-downloads their statement does.
    await pickFinCsvFile(deps);
    await previewFinCsvImport(deps, null, null);
    const second = mapFinCsvImport(deps, profileB, [...FIN_CSV_ROLES], accountId, "negative-is-expense");
    if (second.status !== "ready") unreachable();
    expect(second.preview.transactions).toBe(0);
    expect(second.preview.skips).toEqual([
      { row: 1, code: "already-imported" },
      { row: 2, code: "already-imported" },
      { row: 3, code: "already-imported" },
      { row: 4, code: "already-imported" },
    ]);
    expect(new FinTransactionStore(dbB.raw, profileB).listActive()).toHaveLength(4);
  });

  it("brings only the NEW rows of an overlapping statement — a third coffee is a third coffee", async () => {
    const filePath = await writeCsvFixture("izvod-preklop.csv", FIN_CSV_FIXTURE);
    const profileB = createProfile(dbB, "B");
    const accountId = createFinAccount(dbB, profileB);
    const { deps } = makeTestDeps(dbB, null, null, null, null, filePath);

    await pickFinCsvFile(deps);
    await previewFinCsvImport(deps, null, null);
    const first = mapFinCsvImport(deps, profileB, [...FIN_CSV_ROLES], accountId, "negative-is-expense");
    if (first.status !== "ready") unreachable();
    await applyFinCsvImport(deps, profileB, first.preview.token);

    const overlapping = await writeCsvFixture(
      "izvod-sledeci.csv",
      [
        "Datum;Opis transakcije;Isplata;Uplata;Valuta",
        "02.09.2026.;KAFA;350,00;0,00;RSD",
        "02.09.2026.;KAFA;350,00;0,00;RSD",
        "02.09.2026.;KAFA;350,00;0,00;RSD",
        "03.09.2026.;RACUN ZA STRUJU;4.512,00;0,00;RSD",
        "",
      ].join("\r\n"),
    );
    const { deps: deps2 } = makeTestDeps(dbB, null, null, null, null, overlapping);
    await pickFinCsvFile(deps2);
    await previewFinCsvImport(deps2, null, null);
    const second = mapFinCsvImport(deps2, profileB, [...FIN_CSV_ROLES], accountId, "negative-is-expense");
    if (second.status !== "ready") unreachable();
    // Ordinals 1 and 2 are recognised; the third is new, and so is the bill.
    expect(second.preview.transactions).toBe(2);
    expect(second.preview.skips).toEqual([
      { row: 1, code: "already-imported" },
      { row: 2, code: "already-imported" },
    ]);
    await applyFinCsvImport(deps2, profileB, second.preview.token);
    expect(new FinTransactionStore(dbB.raw, profileB).listActive()).toHaveLength(6);
  });

  it("leaves a deleted row deleted, and says which skip that was", async () => {
    const filePath = await writeCsvFixture("izvod-obrisan.csv", FIN_CSV_FIXTURE);
    const profileB = createProfile(dbB, "B");
    const accountId = createFinAccount(dbB, profileB);
    const { deps } = makeTestDeps(dbB, null, null, null, null, filePath);

    await pickFinCsvFile(deps);
    await previewFinCsvImport(deps, null, null);
    const first = mapFinCsvImport(deps, profileB, [...FIN_CSV_ROLES], accountId, "negative-is-expense");
    if (first.status !== "ready") unreachable();
    await applyFinCsvImport(deps, profileB, first.preview.token);

    const store = new FinTransactionStore(dbB.raw, profileB);
    const salary = store.listActive().find((row) => row.note === "PLATA AVGUST");
    if (salary === undefined) unreachable();
    store.softDelete(salary.id, new Date().toISOString());

    await pickFinCsvFile(deps);
    await previewFinCsvImport(deps, null, null);
    const second = mapFinCsvImport(deps, profileB, [...FIN_CSV_ROLES], accountId, "negative-is-expense");
    if (second.status !== "ready") unreachable();
    expect(second.preview.transactions).toBe(0);
    expect(second.preview.skips).toContainEqual({ row: 2, code: "already-imported-deleted" });
    expect(store.listActive()).toHaveLength(3);
  });

  it("refuses a statement in another currency by name, writing nothing", async () => {
    const filePath = await writeCsvFixture("izvod-eur.csv", FIN_CSV_FIXTURE);
    const profileB = createProfile(dbB, "B");
    const accountId = createFinAccount(dbB, profileB, "EUR");
    const { deps } = makeTestDeps(dbB, null, null, null, null, filePath);

    await pickFinCsvFile(deps);
    await previewFinCsvImport(deps, null, null);
    const mapped = mapFinCsvImport(deps, profileB, [...FIN_CSV_ROLES], accountId, "negative-is-expense");
    expect(mapped).toEqual({
      status: "refused",
      refusal: { code: "foreign-currency", column: 4, sample: "RSD" },
    });
    expect(new FinTransactionStore(dbB.raw, profileB).listActive()).toHaveLength(0);
  });

  it("refuses a slashed date column both readings fit and disagree about", async () => {
    const filePath = await writeCsvFixture(
      "izvod-dvosmislen.csv",
      ["Datum;Opis;Iznos", "01/02/2026;A;-100,00", "03/04/2026;B;-200,00", ""].join("\r\n"),
    );
    const profileB = createProfile(dbB, "B");
    const accountId = createFinAccount(dbB, profileB);
    const { deps } = makeTestDeps(dbB, null, null, null, null, filePath);

    await pickFinCsvFile(deps);
    await previewFinCsvImport(deps, null, null);
    const mapped = mapFinCsvImport(
      deps,
      profileB,
      ["date", "note", "amount"],
      accountId,
      "negative-is-expense",
    );
    expect(mapped).toEqual({
      status: "refused",
      refusal: { code: "ambiguous-date-format", column: 0, sample: "01/02/2026" },
    });
  });

  it("flips every sign when the user says a POSITIVE amount is the expense", async () => {
    const filePath = await writeCsvFixture(
      "izvod-predznak.csv",
      ["Datum;Opis;Iznos", "31.08.2026.;KUPOVINA;1.234,56", ""].join("\r\n"),
    );
    const profileB = createProfile(dbB, "B");
    const accountId = createFinAccount(dbB, profileB);
    const { deps } = makeTestDeps(dbB, null, null, null, null, filePath);

    await pickFinCsvFile(deps);
    await previewFinCsvImport(deps, null, null);
    const mapped = mapFinCsvImport(
      deps,
      profileB,
      ["date", "note", "amount"],
      accountId,
      "positive-is-expense",
    );
    if (mapped.status !== "ready") unreachable();
    await applyFinCsvImport(deps, profileB, mapped.preview.token);
    expect(new FinTransactionStore(dbB.raw, profileB).listActive()[0]?.amount).toBe(-123456);
  });

  it("undoes a statement import whole, fingerprints included", async () => {
    const filePath = await writeCsvFixture("izvod-ponisti.csv", FIN_CSV_FIXTURE);
    const profileB = createProfile(dbB, "B");
    const accountId = createFinAccount(dbB, profileB);
    const { deps } = makeTestDeps(dbB, null, null, null, null, filePath);

    await pickFinCsvFile(deps);
    await previewFinCsvImport(deps, null, null);
    const mapped = mapFinCsvImport(deps, profileB, [...FIN_CSV_ROLES], accountId, "negative-is-expense");
    if (mapped.status !== "ready") unreachable();
    await applyFinCsvImport(deps, profileB, mapped.preview.token);
    expect(restoreStatus(profileB).undo?.kind).toBe("fin-csv");

    await undoRestore(deps, profileB);
    const store = new FinTransactionStore(dbB.raw, profileB);
    expect(store.listActive()).toHaveLength(0);
    // And the fingerprints went with them, so the very same statement imports
    // again in full — an undo that left the keys behind would make the import
    // unrepeatable.
    expect(store.importedKeys(accountId).size).toBe(0);
  });

  it("refuses an account of another profile, and a stale token", async () => {
    const filePath = await writeCsvFixture("izvod-tudji.csv", FIN_CSV_FIXTURE);
    const profileB = createProfile(dbB, "B");
    const profileC = createProfile(dbB, "C");
    const foreignAccount = createFinAccount(dbB, profileC);
    const ownAccount = createFinAccount(dbB, profileB);
    const { deps } = makeTestDeps(dbB, null, null, null, null, filePath);

    await pickFinCsvFile(deps);
    await previewFinCsvImport(deps, null, null);
    expect(() =>
      mapFinCsvImport(deps, profileB, [...FIN_CSV_ROLES], foreignAccount, "negative-is-expense"),
    ).toThrow(/No active account/);

    const mapped = mapFinCsvImport(deps, profileB, [...FIN_CSV_ROLES], ownAccount, "negative-is-expense");
    if (mapped.status !== "ready") unreachable();
    await expect(applyFinCsvImport(deps, profileB, "deadbeef")).rejects.toThrow(/stale/);
    await expect(applyFinCsvImport(deps, profileC, mapped.preview.token)).rejects.toThrow(
      /different profile/,
    );
  });

  it("holds its pick apart from the task CSV's — one surface can never reach the other's file", async () => {
    const taskPath = await writeCsvFixture("zadaci-odvojen.csv", "naziv\r\nZadatak\r\n");
    const statementPath = await writeCsvFixture("izvod-odvojen.csv", FIN_CSV_FIXTURE);
    const { deps } = makeTestDeps(dbB, null, null, taskPath, null, statementPath);

    await pickCsvFile(deps);
    await pickFinCsvFile(deps);
    // Picking a statement did not disturb the task pick, and each preview reads
    // its OWN file.
    const statement = await previewFinCsvImport(deps, null, null);
    if (statement.status !== "ready") unreachable();
    expect(statement.preview.fileName).toBe("izvod-odvojen.csv");
    const tasks = await previewCsvImport(deps, null, null);
    if (tasks.status !== "ready") unreachable();
    expect(tasks.preview.fileName).toBe("zadaci-odvojen.csv");
  });

  it("drops the pick on cancel, releasing somebody's whole ledger from main's memory", async () => {
    const filePath = await writeCsvFixture("izvod-odustani.csv", FIN_CSV_FIXTURE);
    const { deps } = makeTestDeps(dbB, null, null, null, null, filePath);

    await pickFinCsvFile(deps);
    cancelFinCsvImport();
    expect(await previewFinCsvImport(deps, null, null)).toEqual({ status: "no-file" });
  });
});

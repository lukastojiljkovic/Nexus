import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import type { BrowserWindow } from "electron";
import { app, dialog } from "electron";
import { ZipFile } from "yazl";
import { buildExportArchive, mergeNoteState } from "@nexus/core";
import type {
  ExportBinaryEntry,
  ExportNote,
  ExportNoteAttachment,
  ExportNoteFolder,
  ExportNoteTag,
  ExportNoteTagLink,
  ExportNoteTemplate,
  ExportNoteVersion,
} from "@nexus/core";
import type {
  CardStore,
  DeckStore,
  DocumentStore,
  EventStore,
  ExamStore,
  FocusStore,
  NoteAttachmentStore,
  NoteOrgStore,
  NoteStore,
  NoteTemplateStore,
  NotificationStore,
  PlanStore,
  SqliteFlagStore,
  SubjectStore,
  TaskStore,
} from "@nexus/db";
import { localToday } from "./clock.js";
import type { ExportResult } from "../shared/ipc.js";

/**
 * Everything `handleExport` reads through, as plain functions rather than a
 * direct `requireDb()` dependency — mirrors `NotificationSchedulerDeps`
 * (`main/notifications.ts`): keeps this module decoupled from
 * `main/index.ts`'s module-level state, with every store swap explicit at the
 * call site.
 */
export interface ImexExportDeps {
  taskStore(profileId: string): TaskStore;
  eventStore(profileId: string): EventStore;
  documentStore(profileId: string): DocumentStore;
  subjectStore(profileId: string): SubjectStore;
  examStore(profileId: string): ExamStore;
  deckStore(profileId: string): DeckStore;
  cardStore(profileId: string): CardStore;
  planStore(profileId: string): PlanStore;
  focusStore(profileId: string): FocusStore;
  notificationStore(profileId: string): NotificationStore;
  noteStore(profileId: string): NoteStore;
  noteOrgStore(profileId: string): NoteOrgStore;
  noteTemplateStore(profileId: string): NoteTemplateStore;
  noteAttachmentStore(profileId: string): NoteAttachmentStore;
  /** Decrypted attachment bytes by content hash, or null when the blob is missing from the store. Injected rather than reached for, so this module never touches blob paths or key material itself (mirrors the store getters above). */
  readBlob(sha256: string): Promise<Uint8Array | null>;
  flagStore(profileId: string): SqliteFlagStore;
  getMainWindow(): BrowserWindow | null;
}

/** Every NOTE-module row `buildExportArchive`'s `data` requires (ADR-022 section 3) — `gatherNotes`'s return shape. */
interface GatheredNoteData {
  notes: ExportNote[];
  noteFolders: ExportNoteFolder[];
  noteTags: ExportNoteTag[];
  noteTagLinks: ExportNoteTagLink[];
  noteTemplates: ExportNoteTemplate[];
  noteAttachments: ExportNoteAttachment[];
  noteVersions: ExportNoteVersion[];
}

/**
 * Gathers every NOTE-module row for one profile (ADR-022 section 3) — kept out
 * of `handleExport` itself since the per-note version/attachment fan-out makes
 * it long enough on its own.
 *
 * `noteStore.list()` already excludes soft-deleted notes — its `selectActive`
 * statement filters `deleted_at IS NULL`, the same gate `requireActive` uses
 * everywhere else in `NoteStore` — so nothing extra is needed here for
 * ADR-022's "live rows only" rule.
 *
 * A note's merged Yjs state is computed only when there is something to
 * merge: a never-edited note (`snapshot === null` AND `updates.length === 0`)
 * exports `snapshot: null` rather than the encoding of an empty document —
 * that null is what tells `buildExportArchive` to skip the `.ydoc` file and
 * emit an empty Markdown mirror instead.
 */
function gatherNotes(
  deps: Pick<ImexExportDeps, "noteStore" | "noteOrgStore" | "noteTemplateStore" | "noteAttachmentStore">,
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
    noteTagLinks: orgStore.listTagLinks(),
    noteTemplates: deps.noteTemplateStore(profileId).list(),
    noteAttachments,
    noteVersions,
  };
}

/**
 * Full-export handler (IMEX slice a1, PRD 14 IMEX-001 / ADR-009, extended to
 * NOTE by ADR-022): gathers one profile's tasks, calendar, study, notification
 * and NOTE data (notes, folders, tags, templates, attachments, version
 * history) through the stores main already owns, hands the plain arrays to
 * the pure `buildExportArchive` (`@nexus/core`), and streams the result into a
 * `.nexus.zip` at a path the user picks via a native save dialog. Every note
 * ships twice over — a lossless `.ydoc` snapshot and a readable Markdown
 * mirror — and every attachment blob is decrypted back to its original bytes.
 *
 * SEC-EL: the renderer never supplies a filesystem path — the dialog is the
 * only source of `filePath`, owned entirely by this main-process function.
 *
 * The archive still ships in plaintext. That is now a one-slice gap rather
 * than a missing capability: AUTH shipped, and the founder has settled how an
 * archive is keyed (a passphrase typed at export time, ADR-022 section 4) —
 * but encrypting a possibly enormous archive means framed streaming, designed
 * against this writer. See `docs/deviations.md` (IMEX-001 / SEC-DAR-02), which
 * stays open until then.
 */
export async function handleExport(
  deps: ImexExportDeps,
  profile: { id: string; name: string },
): Promise<ExportResult> {
  const win = deps.getMainWindow();
  const dialogOptions = {
    defaultPath: `nexus-export-${localToday()}.nexus.zip`,
    filters: [{ name: "Nexus arhiva", extensions: ["zip"] }],
  };
  const { canceled, filePath } = win
    ? await dialog.showSaveDialog(win, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);
  if (canceled || !filePath) return { canceled: true };

  const documentsStore = deps.documentStore(profile.id);
  const documents = documentsStore.listActive();

  const decksStore = deps.deckStore(profile.id);
  const decks = decksStore.listActive();

  const cardsStore = deps.cardStore(profile.id);
  const cards = decks.flatMap((deck) => cardsStore.listByDeck(deck.id));

  const plansStore = deps.planStore(profile.id);
  const plans = plansStore.listActive();
  const blocks = plans.flatMap((plan) => plansStore.listBlocks(plan.id));

  const notificationStore = deps.notificationStore(profile.id);
  const notificationSettings = notificationStore.getSettings();

  const noteData = gatherNotes(deps, profile.id);

  const archive = buildExportArchive({
    profile,
    appVersion: app.getVersion(),
    createdAt: new Date().toISOString(),
    settings: {
      flags: await deps.flagStore(profile.id).get(),
      notifications: {
        quietFrom: notificationSettings.quietFrom,
        quietTo: notificationSettings.quietTo,
        morningHour: notificationSettings.morningHour,
        enabledSources: notificationSettings.enabledSources,
      },
    },
    data: {
      tasks: deps.taskStore(profile.id).listActive(),
      events: deps.eventStore(profile.id).listActive(),
      documents,
      renewals: documents.flatMap((document) => documentsStore.listRenewals(document.id)),
      subjects: deps.subjectStore(profile.id).listActive(),
      exams: deps.examStore(profile.id).listActive(),
      decks,
      cards,
      reviewLog: cardsStore.listReviewLog(),
      plans,
      blocks,
      focusSessions: deps.focusStore(profile.id).listActive(),
      notifications: notificationStore.listAll(),
      ...noteData,
    },
    hash: (content) => createHash("sha256").update(content, "utf8").digest("hex"),
  });

  const missingAttachments = await writeZip(archive.files, archive.binaries, filePath, deps.readBlob);

  return { canceled: false, path: filePath, totalRecords: archive.totalRecords, missingAttachments };
}

/** How much of a blob is handed to the zip at a time: enough that deflate works incrementally, few enough events that a 50 MB attachment is not a million of them. */
const BLOB_CHUNK_BYTES = 1_048_576;

/** Successive VIEWS into `bytes` (`Buffer.from(buffer, offset, length)` does not copy), so an attachment is never duplicated on its way into the zip. */
function* blobChunks(bytes: Uint8Array): Generator<Buffer> {
  for (let offset = 0; offset < bytes.length; offset += BLOB_CHUNK_BYTES) {
    const slice = bytes.subarray(offset, offset + BLOB_CHUNK_BYTES);
    yield Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength);
  }
}

/**
 * Adds one attachment and resolves only once yazl has consumed it — the
 * back-pressure that makes the loop below bounded.
 *
 * `addBuffer` would NOT do: yazl deflates a buffer the moment it is handed
 * over and holds both copies in its entry queue until that entry's turn comes
 * (see `yazl`'s own `addBuffer`), so adding attachments back-to-back piles
 * every blob in memory no matter how carefully the caller reads them one at a
 * time. A read stream is pumped only when the entry's turn actually arrives,
 * and its `end` tells us the bytes are gone.
 *
 * A zero-byte attachment gets no read stream: an empty stream would end before
 * yazl ever pumped it, and the wait would never resolve.
 */
function addBlobEntry(zipfile: ZipFile, path: string, bytes: Uint8Array): Promise<void> {
  if (bytes.length === 0) {
    zipfile.addBuffer(Buffer.alloc(0), path);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const stream = Readable.from(blobChunks(bytes));
    stream.on("end", resolve);
    stream.on("error", reject);
    zipfile.addReadStream(stream, path, { size: bytes.length });
  });
}

/**
 * Streams every archive file into a `.nexus.zip` at `path`. Text `files` are
 * added up front and the write stream is piped immediately after, so the zip's
 * compressed output starts draining to disk before any attachment is read;
 * then each of `binaries` is resolved and added ONE AT A TIME, in order, each
 * awaited until yazl has consumed it. An attachment is capped at 50 MB and an
 * archive may hold many, so this is what keeps the export's memory flat in the
 * number of attachments rather than linear in their total size — the reason
 * `ExportBinaryEntry` declares blobs by hash instead of carrying their bytes.
 *
 * A `{ kind: "attachment" }` entry whose `readBlob` resolves `null` is a
 * missing/corrupt blob: it is skipped and counted rather than failing the
 * whole export (a user pulling their data out should not lose everything over
 * one lost image), and the count is returned once the archive is complete.
 *
 * `zipfile.end()` is called only after every entry — text and binary — has
 * been added, and the write stream is destroyed on any failure so a broken
 * export leaves no open handle behind. The file at `path` is left where it is:
 * without the central directory `end()` writes, it is not a valid zip and no
 * tool will open it, which is louder than deleting the user's chosen path
 * behind their back.
 */
async function writeZip(
  files: ReadonlyMap<string, string>,
  binaries: readonly ExportBinaryEntry[],
  path: string,
  readBlob: (sha256: string) => Promise<Uint8Array | null>,
): Promise<number> {
  const zipfile = new ZipFile();
  for (const [entryPath, content] of files) {
    zipfile.addBuffer(Buffer.from(content, "utf8"), entryPath);
  }

  const output = createWriteStream(path);
  // Two views of the same failure: `closed` is the write's own outcome, while
  // `failed` exists purely to break the awaits below — a stream error mid-
  // archive would otherwise hang the loop forever on an entry yazl is never
  // going to pump.
  let reportFailure: (error: unknown) => void = () => {};
  const failed = new Promise<never>((_resolve, rejectFailure) => {
    reportFailure = rejectFailure;
  });
  failed.catch(() => {}); // reported through `closed`; this copy must not surface as an unhandled rejection
  const closed = new Promise<void>((resolve, reject) => {
    const fail = (error: unknown): void => {
      reportFailure(error);
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    output.on("close", () => resolve());
    output.on("error", fail);
    zipfile.outputStream.on("error", fail);
  });
  zipfile.outputStream.pipe(output);

  let missingAttachments = 0;
  try {
    for (const entry of binaries) {
      if (entry.kind === "bytes") {
        zipfile.addBuffer(Buffer.from(entry.bytes), entry.path);
        continue;
      }
      const bytes = await Promise.race([readBlob(entry.sha256), failed]);
      if (bytes === null) {
        missingAttachments += 1;
        continue;
      }
      await Promise.race([addBlobEntry(zipfile, entry.path, bytes), failed]);
    }
    zipfile.end();
  } catch (error) {
    output.destroy();
    throw error;
  }

  await closed;
  return missingAttachments;
}

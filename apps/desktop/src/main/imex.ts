import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import type { BrowserWindow } from "electron";
import { app, dialog } from "electron";
import { ZipFile } from "yazl";
import { buildExportArchive, buildIcsCalendar, createArchiveWriter } from "@nexus/core";
import type {
  ArchiveModuleId,
  ArchiveWriter,
  ExportArchiveInput,
  ExportBinaryEntry,
  ExportPrivateNotes,
} from "@nexus/core";
// Main-process-only subpath (pulls in Argon2id's WASM) — see that module's own
// header comment on why the renderer must never import it.
import { ARCHIVE_KDF_PARAMS, deriveArchiveKey, generateSalt } from "@nexus/core/auth";
import { localToday } from "./clock.js";
import { gatherProfileData, gatherProfileSettings, type ProfileDataDeps } from "./profileData.js";
import type { ExportResult, IcsExportResult, PrivateNotesExportSkip } from "../shared/ipc.js";

/**
 * Everything `writeProfileArchive` needs: one profile's whole state
 * (`ProfileDataDeps`, shared verbatim with restore's undo snapshot — see
 * `profileData.ts`), plus the one thing only an archive write uses. No window
 * and no dialog: this is the surface the scheduled backup (`main/backup.ts`,
 * ADR-056) shares with the manual flow, and a scheduled run has no UI at all.
 */
export interface ImexArchiveDeps extends ProfileDataDeps {
  /** Decrypted attachment bytes by content hash, or null when the blob is missing from the store. Injected rather than reached for, so this module never touches blob paths or key material itself (mirrors the store getters above). */
  readBlob(sha256: string): Promise<Uint8Array | null>;
  /**
   * One private attachment's DECRYPTED bytes by its envelope id, or null when
   * the sealed file is missing or no longer opens — including when the section
   * locked mid-write, which downgrades that file to "missing" rather than
   * failing the export (ADR-057 §6; the same lost-image tolerance `readBlob`
   * has). Only ever called for the `private-blobs/<id>` entries a supplied
   * `privateNotes` input declares, so a caller that never supplies one (the
   * scheduled backup) never sees this invoked.
   */
  readPrivateBlob(id: string): Promise<Uint8Array | null>;
}

/**
 * What the manual export flow learns about the private section BEFORE writing
 * (ADR-057 §6): the decrypted content when it rides, or the reason it does not
 * — `"plaintext"` for an export the user chose to write in the clear (dominant
 * even over a locked section: unlocking would change nothing), `"locked"` for
 * a sealed section, and both null when there is simply nothing to carry (no
 * setup, or zero private notes).
 */
export interface PrivateNotesForExport {
  data: ExportPrivateNotes | null;
  skipped: PrivateNotesExportSkip | null;
}

/** `writeProfileArchive`'s deps plus what only the MANUAL flow uses: the window its save dialog belongs to, and the private-section collect (the scheduled backup never carries private notes — ADR-057 §6 and the PRIV card's own promise). */
export interface ImexExportDeps extends ImexArchiveDeps {
  getMainWindow(): BrowserWindow | null;
  /** Resolves the private section's export payload — called AFTER the dialog, so decrypted envelopes never sit in memory while the user considers a save box. */
  collectPrivateNotes(profileId: string, encrypted: boolean): Promise<PrivateNotesForExport>;
}

/** What landed on disk: the archive's record count and how many attachment blobs — content-addressed and private alike — were missing from their stores (skipped, never fatal). */
export interface ArchiveWriteOutcome {
  totalRecords: number;
  missingAttachments: number;
}

/**
 * Writes one profile's full archive at `filePath` — the reusable half of
 * `handleExport`, extracted (ADR-056) so the scheduled backup runs the exact
 * code path the manual export does rather than a copy of it: same gather, same
 * `buildExportArchive`, same `writeZip` streaming discipline, same `NXA1`
 * sealing. The caller owns WHERE the file goes (`handleExport`'s save dialog;
 * the backup runner's configured folder + `.partial` rename), this function
 * owns everything about WHAT is written.
 *
 * `passphrase === null` remains the explicitly-confirmed plaintext export the
 * manual flow alone can reach (SEC-DAR-02) — the scheduled caller always
 * passes a string, and its IPC surface has no plaintext field at all.
 *
 * Argon2id at `ARCHIVE_KDF_PARAMS`' cost blocks this process for roughly a
 * second — the deliberate trade-off `unlockWithPasscode` (`auth.ts`) already
 * makes. The passphrase is never logged and never part of any error thrown
 * here — only `deriveArchiveKey` ever sees it.
 */
export async function writeProfileArchive(
  deps: ImexArchiveDeps,
  profile: ExportArchiveInput["profile"],
  passphrase: string | null,
  filePath: string,
  modules?: ReadonlySet<ArchiveModuleId>,
  privateNotes?: ExportPrivateNotes,
): Promise<ArchiveWriteOutcome> {
  let writer: ArchiveWriter | null = null;
  if (passphrase !== null) {
    const salt = generateSalt();
    const key = await deriveArchiveKey(passphrase, salt, ARCHIVE_KDF_PARAMS);
    writer = await createArchiveWriter({ key, salt, kdf: ARCHIVE_KDF_PARAMS });
  }

  const archiveInput: ExportArchiveInput = {
    profile,
    appVersion: app.getVersion(),
    createdAt: new Date().toISOString(),
    settings: await gatherProfileSettings(deps, profile.id),
    data: gatherProfileData(deps, profile.id),
    hash: (content) => createHash("sha256").update(content, "utf8").digest("hex"),
  };
  // Only name a subset when there is one (exactOptionalPropertyTypes): an
  // ABSENT key is what "every module" means to the builder, and an explicit
  // `undefined` is not the same thing.
  if (modules !== undefined) archiveInput.modules = modules;
  // Same arrangement for the private section (ADR-057 §6): a parallel input
  // beside the gathered `ProfileData`, exactly as the profile picture rides in
  // `profile` — never a `ProfileData` member. ABSENT is "they do not ride",
  // which is every scheduled backup and every gated-out manual export.
  if (privateNotes !== undefined) archiveInput.privateNotes = privateNotes;
  const archive = buildExportArchive(archiveInput);

  const missingAttachments = await writeZip(
    archive.files,
    archive.binaries,
    filePath,
    deps.readBlob,
    deps.readPrivateBlob,
    writer,
  );
  return { totalRecords: archive.totalRecords, missingAttachments };
}

/**
 * Full-export handler (IMEX slice a1, PRD 14 IMEX-001 / ADR-009, extended to
 * NOTE by ADR-022): gathers one profile's TASK data (tasks, lists, sections,
 * tags, attachments), calendar, study, notification and NOTE data (notes,
 * folders, tags, templates, attachments, version history) through the stores
 * main already owns, hands the plain arrays to the pure `buildExportArchive`
 * (`@nexus/core`), and streams the result at a path the user picks via a native
 * save dialog — either a plain `.nexus.zip` or, when `passphrase` is given, an
 * `.nexus` `NXA1` container sealed around that same zip byte stream (see
 * `writeZip`/`ArchiveFramer`). Every note ships twice over — a lossless `.ydoc`
 * snapshot and a readable Markdown mirror — and every attachment blob, note's
 * and task's alike, is decrypted back to its original bytes exactly once: the
 * `blobs/` entries `buildExportArchive` declares are the UNION of both tables,
 * deduplicated by hash, so a file attached in two places travels in one.
 *
 * SEC-EL: the renderer never supplies a filesystem path — the dialog is the
 * only source of `filePath`, owned entirely by this main-process function.
 *
 * The archive is sealed under a passphrase-derived key (ADR-022) whenever
 * `passphrase` is non-null: it flows into `deriveArchiveKey`, and the
 * resulting key seals every byte of the zip stream into an `NXA1` container.
 * `passphrase === null` is not a fallback or a missing capability — it is the
 * explicitly-confirmed plaintext export the settings UI only reaches after a
 * separate, deliberately-ticked confirmation, since shipping a database's
 * worth of data in the clear must always be a choice the user makes on
 * purpose, never one they fall into.
 *
 * `modules` (IMEX-003) narrows the archive to the modules the user ticked;
 * `undefined` is the whole profile, which is what this function did before the
 * choice existed and what it still does when nobody makes one.
 *
 * The narrowing happens inside `buildExportArchive`, not here: the gather
 * stays whole. That reads (and merges the Yjs state of) modules a subset export
 * then discards — the same work every export has always done — and it is the
 * right trade for now, because `gatherProfileData` is ALSO how a restore's undo
 * snapshot is captured (`profileData.ts`), so teaching it about modules would
 * put a second copy of the module↔collection mapping in the one place a
 * disagreement with `countProfileModules` would silently corrupt an archive's
 * own counts.
 *
 * Everything after the dialog is `writeProfileArchive` (ADR-056): the dialog —
 * resolved FIRST, so a canceled export never pays for the Argon2id derivation
 * inside — is all that remains of the manual flow's own body, which is exactly
 * what keeps it and the scheduled backup provably the same export.
 */
export async function handleExport(
  deps: ImexExportDeps,
  profile: ExportArchiveInput["profile"],
  passphrase: string | null,
  modules?: ReadonlySet<ArchiveModuleId>,
): Promise<ExportResult> {
  const win = deps.getMainWindow();
  const dialogOptions =
    passphrase !== null
      ? {
          defaultPath: `nexus-export-${localToday()}.nexus`,
          filters: [{ name: "Nexus šifrovana arhiva", extensions: ["nexus"] }],
        }
      : {
          defaultPath: `nexus-export-${localToday()}.nexus.zip`,
          filters: [{ name: "Nexus arhiva", extensions: ["zip"] }],
        };
  const { canceled, filePath } = win
    ? await dialog.showSaveDialog(win, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);
  if (canceled || !filePath) return { canceled: true };

  // The private section's gate, resolved only now (ADR-057 §6): unlocked AND
  // encrypted ⇒ the decrypted section rides; otherwise `skipped` names why, and
  // the result says so — a silent exclusion of exactly the notes the user
  // guards hardest would be the least forgivable quiet omission in this file.
  const priv = await deps.collectPrivateNotes(profile.id, passphrase !== null);
  const outcome = await writeProfileArchive(
    deps,
    profile,
    passphrase,
    filePath,
    modules,
    priv.data ?? undefined,
  );

  return {
    canceled: false,
    path: filePath,
    ...outcome,
    encrypted: passphrase !== null,
    privateNotes: priv.data?.notes.length ?? 0,
    privateNotesSkipped: priv.skipped,
  };
}

/** Everything the ICS export needs, which is one store and the window the dialog belongs to — a calendar file names no attachment, no note and no setting. */
export interface ImexIcsExportDeps extends Pick<ProfileDataDeps, "eventStore"> {
  getMainWindow(): BrowserWindow | null;
}

/**
 * Calendar-only export (CAL-008, closing IMEX-001's "ICS for calendar" clause):
 * reads this profile's live events through the store main already owns, hands
 * them to the pure `buildIcsCalendar` (`@nexus/core`) with a `now` stamped here,
 * and writes the resulting RFC 5545 text at a path the user picks in a native
 * save dialog.
 *
 * SEC-EL, exactly as `handleExport`: the renderer never supplies a filesystem
 * path — the dialog is the only source of `filePath`, owned entirely by this
 * main-process function.
 *
 * No passphrase branch, and deliberately so. An `.ics` is an interchange file
 * for the user's OTHER calendar; there is no format in which a sealed one would
 * be readable by anything on the other end, so the choice `handleExport` offers
 * would be a choice between "works" and "does not". The whole-profile archive
 * remains the encrypted path, and the settings copy says which is which.
 *
 * The file is written whole (`writeFile`) rather than streamed: a calendar is
 * text proportional to the number of events, with none of the 50 MB attachment
 * blobs that make the archive's streaming discipline necessary.
 */
export async function handleIcsExport(
  deps: ImexIcsExportDeps,
  profile: { id: string },
): Promise<IcsExportResult> {
  const win = deps.getMainWindow();
  const dialogOptions = {
    defaultPath: `nexus-kalendar-${localToday()}.ics`,
    filters: [{ name: "Kalendar (iCalendar)", extensions: ["ics"] }],
  };
  const { canceled, filePath } = win
    ? await dialog.showSaveDialog(win, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);
  if (canceled || !filePath) return { canceled: true };

  const events = deps.eventStore(profile.id).listActive();
  const calendar = buildIcsCalendar(events, { now: new Date().toISOString() });
  await writeFile(filePath, calendar.text, "utf8");

  return {
    canceled: false,
    path: filePath,
    events: events.length - calendar.skipped.length,
    skipped: calendar.skipped.length,
  };
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
 * Turns the zip's own plaintext byte stream into a sequence of sealed `NXA1`
 * frames (`packages/core/src/imex/archiveContainer.ts`), by handing
 * `writer.chunkBytes` plaintext bytes to `writer.seal` at a time. A single
 * incoming chunk may be worth several frames (sealed one `chunkBytes` slice at
 * a time, in a loop) or far less than one (simply appended to `pending`, which
 * is a zero-copy `Buffer.subarray` view once there is nothing left to merge).
 *
 * `_transform` is declared `async`: its `callback` is invoked only once every
 * `seal` started inside it has resolved and been `push`ed. That await IS the
 * back-pressure — Node will not deliver the next chunk from the zip's output
 * stream until this call returns, so at most one frame's worth of plaintext is
 * ever held in memory regardless of the archive's total size, which is the
 * entire point of framing. Frames are sealed strictly one at a time, in order;
 * nothing here ever seals concurrently or queues sealed frames before pushing.
 *
 * `_flush` seals whatever is left in `pending` as the one final frame — even
 * an empty remainder, because `seal(..., true)` is called exactly once per
 * archive (see the container's own header comment on why the final frame is
 * unconditional). Neither method ever throws synchronously: both are `async`
 * and funnel a rejected `seal` through `callback(error)` instead.
 */
class ArchiveFramer extends Transform {
  private pending: Buffer = Buffer.alloc(0);

  constructor(private readonly writer: ArchiveWriter) {
    super();
  }

  override async _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): Promise<void> {
    try {
      this.pending = this.pending.length > 0 ? Buffer.concat([this.pending, chunk]) : chunk;
      while (this.pending.length >= this.writer.chunkBytes) {
        const plaintext = this.pending.subarray(0, this.writer.chunkBytes);
        this.pending = this.pending.subarray(this.writer.chunkBytes);
        this.push(await this.writer.seal(plaintext, false));
      }
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override async _flush(callback: (error?: Error | null) => void): Promise<void> {
    try {
      this.push(await this.writer.seal(this.pending, true));
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

/**
 * Streams every archive file into a `.nexus.zip` (or, when `writer` is given,
 * an encrypted `.nexus` `NXA1` container, ADR-022) at `path`. Text `files` are
 * added up front and the write stream is piped immediately after, so the zip's
 * compressed output starts draining to disk before any attachment is read;
 * then each of `binaries` is resolved and added ONE AT A TIME, in order, each
 * awaited until yazl has consumed it. An attachment is capped at 50 MB and an
 * archive may hold many, so this is what keeps the export's memory flat in the
 * number of attachments rather than linear in their total size — the reason
 * `ExportBinaryEntry` declares blobs by hash instead of carrying their bytes.
 *
 * `writer === null` is exactly today's plaintext behaviour, unchanged: the
 * zip's output pipes straight to `output`. When `writer` is given, its
 * `headerBlock` is written to `output` FIRST — before any frame — and the
 * zip's bytes are piped through an `ArchiveFramer` (see that class) instead,
 * so what lands on disk is the header followed by sealed frames rather than
 * the zip's raw bytes. `zipfile.outputStream` itself is never aware of the
 * difference.
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
  readPrivateBlob: (id: string) => Promise<Uint8Array | null>,
  writer: ArchiveWriter | null,
): Promise<number> {
  const zipfile = new ZipFile();
  for (const [entryPath, content] of files) {
    zipfile.addBuffer(Buffer.from(content, "utf8"), entryPath);
  }

  const output = createWriteStream(path);
  // Grouped together (rather than two separately-nullable variables) so
  // narrowing `encryption` below also narrows access to `writer.headerBlock` —
  // the two are only ever both present or both absent.
  const encryption = writer === null ? null : { writer, framer: new ArchiveFramer(writer) };
  // Two views of the same failure: `closed` is the write's own outcome, while
  // `failed` exists purely to break the awaits below — a stream error mid-
  // archive would otherwise hang the loop forever on an entry yazl is never
  // going to pump. When encrypting, the framer is one more place that failure
  // can originate (a rejected `seal`), so it feeds the same `fail`.
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
    encryption?.framer.on("error", fail);
  });
  if (encryption === null) {
    zipfile.outputStream.pipe(output);
  } else {
    output.write(encryption.writer.headerBlock);
    zipfile.outputStream.pipe(encryption.framer).pipe(output);
  }

  let missingAttachments = 0;
  try {
    for (const entry of binaries) {
      if (entry.kind === "bytes") {
        zipfile.addBuffer(Buffer.from(entry.bytes), entry.path);
        continue;
      }
      // A private attachment (ADR-057 §6) resolves through its own reader —
      // sealed on disk by random id, decrypted here for the archive — but is
      // otherwise an attachment like any other: streamed one at a time, and a
      // missing/unopenable one is skipped and counted, never fatal.
      const bytes =
        entry.kind === "private-blob"
          ? await Promise.race([readPrivateBlob(entry.id), failed])
          : await Promise.race([readBlob(entry.sha256), failed]);
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

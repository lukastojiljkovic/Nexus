import type Database from "better-sqlite3-multiple-ciphers";
import {
  RECORDING_KINDS,
  RECORDING_MIME_TYPES,
  isRecordingMime,
  recordingKindForMime,
  recordingStorageSummary,
} from "@nexus/core";
import type { RecordingKind, RecordingMime } from "@nexus/core";
import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_DURATION_MS,
  MAX_RECORDING_NOTES_LENGTH,
  MAX_RECORDING_TAG_LENGTH,
  MAX_RECORDING_TAGS,
  MAX_RECORDING_TITLE_LENGTH,
  RecorderStore,
  type RecorderExport,
} from "@nexus/db";
import type { ModuleCall, ModuleHostSurface } from "../../../main/moduleIpc.js";
import {
  contract,
  type RecorderEntryView,
  type RecorderStorageView,
  type RecorderView,
} from "../shared/ipc.js";
import { EMPTY_RECORDER_EXPORT, buildRecorderExport, parseRecorderArchive } from "./imex.js";
import { MEDIA_ARM_WINDOW_MS, armMediaAccess, disarmMediaAccess } from "./mediaAccess.js";

/**
 * RECORDER in the main process (ADR-090): its handlers, its media permission and
 * its archive section.
 *
 * **Why the bytes are written here and not in the store.** A recording's media
 * lives in the app's one content-addressed blob store (`main/attachments.ts`,
 * ADR-019), which belongs to main: it needs the account's key material and the
 * account's blob roots, and neither is reachable from `packages/db` by design.
 * So `save` hands the captured bytes to `call.saveBlob`, gets back the plaintext
 * `sha256` that names them, and only then writes a row — `note_attachments`'
 * arrangement, one module over, where the index row follows the bytes rather
 * than the other way round.
 *
 * **Every refusal happens BEFORE the bytes are written.** The whole payload is
 * validated — the closed mime list, the kind agreeing with it, the size cap, the
 * duration — and only a payload that could be stored reaches the blob store. A
 * refusal after the write would leave a blob on disk that no row names, which
 * nothing would ever collect: the garbage collector runs when a ROW stops naming
 * a hash, and a blob nothing named never had a row to lose.
 *
 * **The media permission is a session fact.** `beginCapture` arms the window
 * `mediaAccess.ts` describes and `onSessionEnd` closes it, so a locked or
 * switched-away profile cannot leave a microphone grant standing.
 */

/** Something that can open this module's store for a profile: a handler's `ModuleCall` and a session alike, so the code below is one implementation rather than two that drift. */
interface StoreBearer {
  profileDb<T>(profileId: string, open: (db: Database.Database, profileId: string) => T): T;
}

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  function recorderStore(bearer: StoreBearer, profileId: string): RecorderStore {
    return bearer.profileDb(profileId, (db, id) => new RecorderStore(db, id));
  }

  /**
   * The rows as the wire declares them, plus what the page reads OFF them: what
   * the library costs, which tags are in use, the store's size cap and field
   * caps, and this profile's one preference.
   *
   * The totals come from `@nexus/core`'s `recordingStorageSummary` rather than
   * from arithmetic here: it is the one definition of „what the library costs in
   * bytes and time", it is what stage 1 tested, and a second sum in this file is
   * how the page's figure and the store's would come to disagree.
   */
  function viewOf(bearer: StoreBearer, profileId: string): RecorderView {
    const recorder = recorderStore(bearer, profileId);
    const entries: RecorderEntryView[] = recorder.listActive().map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      createdAt: row.createdAt,
      durationMs: row.durationMs,
      mime: row.mime,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      tags: row.tags,
      notes: row.notes,
      isDiary: row.isDiary,
      diaryDate: row.diaryDate,
      updatedAt: row.updatedAt,
    }));
    const totals = recordingStorageSummary(entries);
    const storage: RecorderStorageView = {
      audio: totals.audio,
      video: totals.video,
      all: totals.all,
    };
    // Every tag any recording carries, de-duplicated, in the order the rows were
    // read (newest first). Sorting belongs to the PAGE, where the collator
    // follows the language being read (`renderer/intl.ts`), rather than to a
    // list captured here in whatever locale main happened to be writing in.
    const tags: string[] = [];
    for (const entry of entries) {
      for (const tag of entry.tags) if (!tags.includes(tag)) tags.push(tag);
    }
    return {
      entries,
      storage,
      tags,
      limitBytes: MAX_RECORDING_BYTES,
      // The store's own caps, sent rather than restated in the page: they are
      // its columns' CHECKs, and a form with a second copy of „200 characters"
      // would refuse text the store would have taken.
      caps: {
        titleChars: MAX_RECORDING_TITLE_LENGTH,
        notesChars: MAX_RECORDING_NOTES_LENGTH,
        tagChars: MAX_RECORDING_TAG_LENGTH,
        tagCount: MAX_RECORDING_TAGS,
      },
      // The module's one preference, read from this profile's own row and
      // answered with the store's default when it has none.
      settings: recorder.settings(),
    };
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId);
  });

  /**
   * The recorder page is about to ask for a microphone or a camera, and this is
   * what makes the session's permission handler say yes (`mediaAccess.ts`).
   *
   * The profile id is validated like every other payload's, so a message that
   * named no profile cannot open the window — the arming is a fact about this
   * app's session, and the kit's one-shape rule means the payload carries one
   * anyway. The window closes on its own, and `onSessionEnd` closes it early.
   */
  ctx.handle("beginCapture", (payload, call) => {
    call.as.asId(payload.profileId, "profileId");
    armMediaAccess(call.now());
    return { armedForMs: MEDIA_ARM_WINDOW_MS };
  });

  /**
   * Stores a finished capture: the bytes into the blob store, then one row
   * naming them. Everything is validated first (see this file's header), and the
   * mime is the one `MediaRecorder` ACTUALLY produced — `@nexus/core`'s own rule
   * for the capture side — never a string the page hoped for.
   */
  ctx.handle("save", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const kind = recordingKind(call, payload.kind);
    const mime = recordingMime(call, payload.mime);
    if (recordingKindForMime(mime) !== kind) {
      throw new Error(
        `Invalid IPC payload: "mime" ${mime} is not a ${kind} container.`,
      );
    }
    const bytes = recordingBytes(payload.bytes);
    const durationMs = call.as.asBoundedInteger(
      payload.durationMs,
      "durationMs",
      1,
      MAX_RECORDING_DURATION_MS,
    );
    const title = call.as.asCappedChars(
      call.as.asString(payload.title, "title"),
      "title",
      MAX_RECORDING_TITLE_LENGTH,
    );
    const tags = recordingTags(call, payload.tags);
    const notes = call.as.asCappedChars(
      call.as.asString(payload.notes, "notes"),
      "notes",
      MAX_RECORDING_NOTES_LENGTH,
    );
    const isDiary = call.as.asBoolean(payload.isDiary, "isDiary");
    const diaryDate = diaryDateOf(call, isDiary, payload.diaryDate);

    const saveBlob = call.saveBlob;
    if (saveBlob === undefined) {
      throw new Error("The recorder cannot store media: this build has no blob store open.");
    }
    const { sha256 } = await saveBlob(bytes);
    recorderStore(call, profileId).create(
      {
        kind,
        title,
        mime,
        durationMs,
        sizeBytes: bytes.byteLength,
        sha256,
        tags,
        notes,
        isDiary,
        diaryDate,
      },
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("update", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const isDiary = call.as.asBoolean(payload.isDiary, "isDiary");
    recorderStore(call, profileId).update(
      call.as.asId(payload.id, "id"),
      {
        title: call.as.asCappedChars(
          call.as.asString(payload.title, "title"),
          "title",
          MAX_RECORDING_TITLE_LENGTH,
        ),
        tags: recordingTags(call, payload.tags),
        notes: call.as.asCappedChars(
          call.as.asString(payload.notes, "notes"),
          "notes",
          MAX_RECORDING_NOTES_LENGTH,
        ),
        isDiary,
        // Both halves of the diary pair travel together, always: the store
        // refuses „the flag without the date", and a form that could reach that
        // refusal by accident is a form this file refuses to build.
        diaryDate: diaryDateOf(call, isDiary, payload.diaryDate),
      },
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("remove", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    recorderStore(call, profileId).softDelete(call.as.asId(payload.id, "id"), instant(call.now()));
    return viewOf(call, profileId);
  });

  ctx.handle("restore", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    recorderStore(call, profileId).restore(call.as.asId(payload.id, "id"), instant(call.now()));
    return viewOf(call, profileId);
  });

  ctx.handle("setCountdown", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    recorderStore(call, profileId).setCountdown(
      call.as.asBoolean(payload.countdown, "countdown"),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  // --- The session ----------------------------------------------------------

  ctx.onSessionEnd(() => {
    // A lock, a profile switch or a quit: the media window is a grant for the
    // session that asked for it, and no session may inherit one.
    disarmMediaAccess();
  });

  // --- The archive (ADR-090 §imex) -----------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    return buildRecorderExport(recorderStore(session, profileId));
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the WHOLE payload — the version first — and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parseRecorderArchive,
    // The writing half. `undefined` is an archive that says nothing about the
    // recorder, which for a restore that replaces a profile whole means EMPTY:
    // the module resets its own tables, which is the kit's rule for a module
    // whose tables are deliberately not on `RESTORE_WIPE_TABLES` (ADR-090 §6).
    apply: (payload, session) => {
      for (const profileId of session.profileIds) {
        recorderStore(session, profileId).importData(payload ?? EMPTY_RECORDER_EXPORT);
      }
    },
  });

  // The blob hook (ADR-108): a recording's media is the file this module keeps
  // in the shared store, and these four answers are what main builds its blob
  // union, its mime lookup and the archive's `blobs/` list from. Before this
  // registration `index.ts` named RECORDER's table by hand in two functions, and
  // the archive carried the index row without the media (see `./imex.ts`).
  ctx.blobs({
    refCount: (session, profileId, sha256) => recorderStore(session, profileId).refCount(sha256),
    mimeForHash: (session, profileId, sha256) =>
      recorderStore(session, profileId).mimeForHash(sha256),
    exportBlobs: (session) => {
      const profileId = soleProfile(session.profileIds);
      return profileId === null ? [] : mediaBlobs(recorderStore(session, profileId).exportData());
    },
    importBlobs: (payload) =>
      mediaBlobs((payload as RecorderExport | undefined) ?? EMPTY_RECORDER_EXPORT),
  });
}

/**
 * Every media file one RECORDER section names, with the size its row states —
 * read off the EXPORT value rather than the raw table, so the list is exactly
 * the recordings the archive carries (only live ones, `exportData`'s own rule).
 */
function mediaBlobs(section: RecorderExport): { sha256: string; sizeBytes: number }[] {
  return section.recordings.map((recording) => ({
    sha256: recording.sha256,
    sizeBytes: recording.sizeBytes,
  }));
}

/**
 * The one profile a session is about, or `null` when it names none or several.
 *
 * An archive is written ONE profile at a time (`main/imex.ts`'s `handleExport`
 * gathers one profile's `ProfileData`), so „several" is not a shape the exporter
 * meets; answering `null` rather than guessing is what keeps that true.
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** `audio` or `video`, off the wire — the closed list `@nexus/core` declares and migration 077 CHECKs. */
function recordingKind(
  call: { readonly as: ModuleCall["as"] },
  value: unknown,
): RecordingKind {
  const kind = call.as.asNonEmptyString(value, "kind");
  if (!(RECORDING_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Invalid IPC payload: "kind" must be one of: ${RECORDING_KINDS.join(", ")}.`);
  }
  return kind as RecordingKind;
}

/**
 * The mime the capture side reported — one of the four strings
 * `RECORDING_MIME_TYPES` lists, refused by name rather than by pattern (see
 * `@nexus/core`'s `recording.ts` for why the list is closed).
 */
function recordingMime(call: { readonly as: ModuleCall["as"] }, value: unknown): RecordingMime {
  const mime = call.as.asNonEmptyString(value, "mime");
  if (!isRecordingMime(mime)) {
    throw new Error(`Invalid IPC payload: "mime" must be one of: ${RECORDING_MIME_TYPES.join(", ")}.`);
  }
  return mime;
}

/**
 * The captured bytes, bounded BEFORE anything is written.
 *
 * `Uint8Array` and no other container: Electron structured-clones the renderer's
 * chunks into this process as one typed array, so anything else on the wire is a
 * payload this module did not produce. The size cap is the store's own
 * (`MAX_RECORDING_BYTES`), applied here rather than after the write — the blob
 * store holds a blob whole, and this is the only place that can refuse one
 * before it costs the memory.
 */
function recordingBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error('Invalid IPC payload: "bytes" must be a Uint8Array.');
  }
  if (value.byteLength === 0 || value.byteLength > MAX_RECORDING_BYTES) {
    throw new Error(
      `Invalid IPC payload: "bytes" must be 1..${MAX_RECORDING_BYTES} bytes.`,
    );
  }
  return value;
}

/** Tag NAMES, structurally checked here; the store trims, de-duplicates and refuses an empty one. */
function recordingTags(call: { readonly as: ModuleCall["as"] }, value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid IPC payload: "tags" must be an array.');
  }
  if (value.length > MAX_RECORDING_TAGS) {
    throw new Error(
      `Invalid IPC payload: "tags" must hold at most ${MAX_RECORDING_TAGS} names.`,
    );
  }
  return value.map((tag, index) =>
    call.as.asCappedChars(call.as.asString(tag, `tags[${index}]`), `tags[${index}]`, MAX_RECORDING_TAG_LENGTH),
  );
}

/**
 * The diary pair, as one answer: a diary entry carries the day it was FILED
 * under, and a memo carries none. A value that is not a bare day is refused by
 * the store (`isBareDate`'s rule, which knows what a calendar day is) — what
 * this function decides is only that half a pair never travels.
 */
function diaryDateOf(
  call: { readonly as: ModuleCall["as"] },
  isDiary: boolean,
  value: unknown,
): string | null {
  if (!isDiary) return null;
  return call.as.asNonEmptyString(value, "diaryDate");
}

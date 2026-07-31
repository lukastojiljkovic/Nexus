import { mergeNoteState, remapNoteState } from "@nexus/core";
import { MAX_NOTE_UPDATE_BYTES } from "@nexus/db";
import type { CardStore, NoteAttachmentStore, NoteStore } from "@nexus/db";
import { compactNow } from "./notes.js";
import {
  privAddAttachment,
  privDelete,
  privOpenAttachment,
  privRead,
  privWrite,
  type PrivDeps,
} from "./priv.js";
import {
  PRIV_ATTACHMENTS_MAX_COUNT,
  PRIV_PLAINTEXT_MAX_BYTES,
  PRIV_STATE_MAX_BYTES,
} from "../shared/ipc.js";
import type { NoteMeta, PrivMoveInResult, PrivMoveOutResult } from "../shared/ipc.js";

/**
 * The two whole-note move flows between the public store and the private
 * section (ADR-057 §5), deps-injected in `backup.ts`/`priv.ts`'s style so the
 * whole surface runs under plain Node/Vitest and `main/index.ts` owns the
 * wiring.
 *
 * Neither direction can be one database transaction: attachment bytes live
 * OUTSIDE SQLite (the public content-addressed store, the private sealed
 * files), so cross-store atomicity is impossible. Both flows therefore order
 * their steps so that a crash at ANY point leaves BOTH copies standing rather
 * than neither — the destination is fully written and durable before the
 * first destructive step runs against the source. The residue a crash can
 * leave is always recoverable garbage, never lost content:
 *
 *  - move-in, crash before `privWrite` lands: orphaned sealed files in the
 *    private store (encrypted, unreachable, disk space only) — the public
 *    note is untouched.
 *  - move-in, crash between `privWrite` and the teardown: the note exists in
 *    BOTH places; the user deletes whichever copy they do not want.
 *  - move-in, crash between the teardown and the blob GC / index rebuild:
 *    unreferenced public blobs (reclaimed by any later refcount-gated GC of
 *    the same hash, or never) and FTS token residue (scrubbed by the next
 *    rebuild) — content is already safely sealed.
 *  - move-out mirrors the same shape with the roles swapped.
 */

/** Everything the move flows need. Getters resolve per call, like `PrivDeps`' own. */
export interface PrivMoveDeps {
  priv: PrivDeps;
  notes(profileId: string): NoteStore;
  noteAttachments(profileId: string): NoteAttachmentStore;
  cards(profileId: string): CardStore;
  /** The PUBLIC content-addressed blob store's read half (`main/attachments.ts`' `readBlob` over both roots). */
  readBlob(sha256: string): Promise<Uint8Array | null>;
  saveBlob(bytes: Uint8Array): Promise<{ sha256: string }>;
  /** Refcount-gated GC of one public hash — `deleteBlobIfOrphaned` under `blobRefCount`'s whole-table union. */
  releaseBlob(profileId: string, sha256: string): Promise<void>;
  /** `@nexus/core`'s byte sniffer (SEC-FILE-02): a recreated public row's mime is derived from the bytes, never carried as a claim. */
  sniffMime(bytes: Uint8Array): string;
  runInTransaction<T>(write: () => T): T;
  /** `rebuildSearchIndex` over the whole database — move-in's FTS token-residue scrub. */
  rebuildSearchIndex(): void;
  now(): Date;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

/**
 * PUBLIC note → PRIVATE (ADR-057 §5). Requires the section unlocked — the
 * very first sealing call refuses otherwise, before anything is read or
 * written. The public note is destroyed only once the sealed copy is durable:
 *
 * 1. Merge the note's whole persisted state (`mergeNoteState`, the same read
 *    compaction and healing use) and refuse — touching nothing — anything the
 *    envelope's own wire caps could not carry.
 * 2. Seal every attachment's bytes as a NEW private blob (fresh random ids,
 *    no content addressing) and remap the document's `attachmentImage` nodes
 *    onto those ids, so the private editor resolves them.
 * 3. `privWrite` the whole envelope — from here on the content is safe.
 * 4. Tear the public note down in ONE transaction: detach its note-sourced
 *    cards (the „keep" rule — both source fields cleared, FSRS history
 *    intact; the deck unmap is moot, the row is going away) and hard-delete
 *    the row, which cascades updates/snapshot/versions/links/tag links/
 *    attachment rows/subject links and fires the search AD triggers.
 *    Checklist-forked tasks carry no note reference at all and simply remain,
 *    exactly as the dialog copy says.
 * 5. Release the public blobs (refcount-gated — a hash another record still
 *    names stays) and rebuild the search index once, scrubbing token residue.
 */
export async function moveNoteToPrivate(
  deps: PrivMoveDeps,
  profileId: string,
  noteId: string,
): Promise<PrivMoveInResult> {
  const notes = deps.notes(profileId);
  const attachments = deps.noteAttachments(profileId);

  // The gate AND the read: `readForCompaction` refuses anything that is not an
  // active note of this profile. The meta lookup mirrors `noteDuplicate.ts`.
  const read = notes.readForCompaction(noteId);
  const meta = notes.list().find((note) => note.id === noteId);
  if (meta === undefined) {
    throw new Error(`Invariant violated: note "${noteId}" read for compaction but absent from list().`);
  }
  const merged = mergeNoteState(
    read.snapshot,
    read.updates.map((update) => update.bytes),
  );
  const rows = attachments.list(noteId);
  if (rows.length > PRIV_ATTACHMENTS_MAX_COUNT) {
    return { ok: false, reason: "too-many-attachments" };
  }
  // Refuse the caps BEFORE the first write. The state check is repeated after
  // the attachment remap below (ids are same-length UUIDs, but honesty beats
  // arithmetic about base64 growth).
  if (
    toBase64(merged.snapshot).length > PRIV_STATE_MAX_BYTES ||
    Buffer.byteLength(merged.plaintext, "utf8") > PRIV_PLAINTEXT_MAX_BYTES
  ) {
    return { ok: false, reason: "too-large" };
  }

  // 2. Attachment bytes into the private store. Collected for cleanup: a
  // failure here (an unreadable blob) must not leave sealed strays behind.
  const idMap = new Map<string, string>();
  const refs = [];
  try {
    for (const row of rows) {
      const bytes = await deps.readBlob(row.sha256);
      if (bytes === null) {
        throw new Error(`Attachment blob ${row.sha256} is missing from the public store.`);
      }
      const ref = await privAddAttachment(deps.priv, profileId, {
        fileName: row.fileName,
        mime: row.mime,
        bytes,
      });
      idMap.set(row.id, ref.id);
      refs.push(ref);
    }
  } catch (error) {
    for (const ref of refs) await deps.priv.privBlobs.remove(ref.id);
    throw error;
  }

  const state = idMap.size === 0 ? merged.snapshot : remapNoteState(merged.snapshot, idMap);
  const yjsState = toBase64(state);
  if (yjsState.length > PRIV_STATE_MAX_BYTES) {
    for (const ref of refs) await deps.priv.privBlobs.remove(ref.id);
    return { ok: false, reason: "too-large" };
  }

  // 3. The sealed copy — durable from here on.
  const { id } = await privWrite(deps.priv, profileId, null, {
    title: meta.title,
    yjsState,
    plaintext: merged.plaintext,
    attachments: refs,
  });

  // 4. The public teardown, atomically.
  deps.runInTransaction(() => {
    deps.cards(profileId).detachCardsFromNote(noteId);
    notes.hardDelete(noteId);
  });

  // 5. Blob GC (deduped — two rows can name one hash) and the FTS scrub.
  for (const sha256 of new Set(rows.map((row) => row.sha256))) {
    await deps.releaseBlob(profileId, sha256);
  }
  deps.rebuildSearchIndex();
  return { ok: true, id };
}

/**
 * PRIVATE note → PUBLIC — the inverse, through the NORMAL creation path
 * (`create` + `appendUpdate` + `compactNow`, exactly `noteDuplicate.ts`'s
 * recipe), so the result is an ordinary note from the moment it lands: the
 * triggers index it, the compaction writes its searchable body and first
 * checkpoint. Every private byte is read and re-hosted BEFORE the first
 * public write, and the sealed rows are destroyed only at the very end — a
 * crash anywhere leaves both copies, never neither. The per-update cap is
 * inherited honestly from the creation path (`notes:duplicate`'s own limit).
 */
export async function movePrivateNoteOut(
  deps: PrivMoveDeps,
  profileId: string,
  id: string,
): Promise<PrivMoveOutResult> {
  const envelope = await privRead(deps.priv, profileId, id);
  const state = fromBase64(envelope.yjsState);
  if (state.byteLength === 0 || state.byteLength > MAX_NOTE_UPDATE_BYTES) {
    return { ok: false, reason: "too-large" };
  }
  // Every attachment decrypted up front: an unreadable one aborts the whole
  // move with the private note untouched, rather than surfacing as a note
  // that quietly lost a file.
  const files = [];
  for (const ref of envelope.attachments) {
    files.push({ ref, bytes: await privOpenAttachment(deps.priv, profileId, ref.id) });
  }

  const notes = deps.notes(profileId);
  const attachments = deps.noteAttachments(profileId);
  const nowIso = deps.now().toISOString();
  const created = notes.create(nowIso);

  // Rows before the document (the `noteDuplicate.ts` order): the rewrite
  // needs the ids these inserts mint.
  const idMap = new Map<string, string>();
  for (const { ref, bytes } of files) {
    const { sha256 } = await deps.saveBlob(bytes);
    const row = attachments.add(
      created.id,
      // Re-sniffed, never the envelope's claim (SEC-FILE-02) — the envelope is
      // renderer-authored content, and this row's mime is what `nx-blob:` serves.
      { fileName: ref.fileName, mime: deps.sniffMime(bytes), sizeBytes: bytes.byteLength, sha256 },
      nowIso,
    );
    idMap.set(ref.id, row.id);
  }

  const remapped = idMap.size === 0 ? state : remapNoteState(state, idMap);
  if (remapped.byteLength > MAX_NOTE_UPDATE_BYTES) {
    // Remap can only ever grow the state by id-length deltas, but the cap is
    // the cap. Leave the fresh rows to the hard delete below — nothing was
    // destroyed yet, so aborting must undo the public half it started.
    deps.runInTransaction(() => notes.hardDelete(created.id));
    return { ok: false, reason: "too-large" };
  }
  const title = envelope.title.trim().slice(0, 200);
  notes.appendUpdate(created.id, remapped, title, nowIso);
  compactNow(notes, created.id);

  // Both copies exist; only now does the sealed side go (row + blobs).
  await privDelete(deps.priv, profileId, id);

  const listed = notes.list().find((note) => note.id === created.id);
  return { ok: true, note: listed ?? ({ ...created, title } as NoteMeta) };
}

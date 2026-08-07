import { randomUUID } from "node:crypto";
import { duplicateNoteState, mergeNoteState, remapNoteState } from "@nexus/core";
import type { NoteAttachmentStore, NoteMeta, NoteOrgStore, NoteStore } from "@nexus/db";
import { compactNow } from "./notes.js";
import { NOTE_COPY_SUFFIX as SHELL_NOTE_COPY_SUFFIX } from "./shellStrings.js";
import { NOTE_UPDATE_MAX_BYTES } from "../shared/ipc.js";
import type { NoteDuplicateResult } from "../shared/ipc.js";

/**
 * „Dupliraj belešku" (NOTE-010), whole: the document rewrite from
 * `@nexus/core`'s pure `duplicateNoteState` plus every row that has to travel
 * with it, in ONE transaction so a crash can never leave half a copy behind.
 *
 * WHICH CREATION PATH — the one templates and the markdown importer use, and
 * deliberately not a bulk insert: `NoteStore.create` mints the row,
 * `appendUpdate` writes the document AND the denormalised title (the only
 * method that sets a title at all), and `compactNow` folds that update into the
 * snapshot, which is what writes `note_snapshots.plaintext` — the note's
 * searchable body (ADR-021 / SRCH-002) — and takes the copy's first
 * version-history checkpoint (ADR-015). A duplicate is therefore an ordinary
 * note from the moment it lands: search finds it, history has it, the editor
 * opens it.
 *
 * WHAT TRAVELS, and what deliberately does not:
 *
 * - **The document**, with every `cardKey` re-minted and a self-link repointed
 *   (`duplicateNoteState`'s own doc comment).
 * - **Attachment rows**, one per source row: a NEW row id, the SAME `sha256`.
 *   The blob is content-addressed, so the copy references the very same
 *   encrypted file — and `refCount` is what makes that safe, because removing
 *   the copy's attachment leaves the hash still referenced by the original and
 *   the file therefore untouched. The copy's rows have new ids, so the
 *   document's `attachmentImage` nodes are remapped onto them here (the
 *   `noteAttachmentImage.tsx` node resolves its bytes through the LIVE per-note
 *   attachment list, so a copy still naming the original's row ids would render
 *   a page of "Prilog je uklonjen." placeholders).
 * - **Tag links.** A tag is what the note is ABOUT; a copy is about the same
 *   thing.
 * - **The folder.** Same reason: a copy belongs where its original does.
 * - **The category** (NOTE-002). Same reason again, and the plainest of the
 *   three: a category is what KIND of thing the note is, and a copy of a
 *   sastanak is a sastanak.
 * - **NOT the pin.** A pin is a curation decision about one row — "keep THIS at
 *   the top" — not a property of the content, and a duplicate that arrived
 *   pinned would push the original down the list it was pinned to lead.
 * - **NOT the version history.** A fresh note starts fresh: `note_versions`
 *   records what happened to the ORIGINAL, and re-dating that history onto a
 *   note that did not live it would be a lie about the copy's past. The copy
 *   takes its own first checkpoint at `compactNow`, like every other new note.
 * - **NOT the deck mapping** (`card_deck_id` stays NULL — `create`'s own
 *   default, never copied). The copy's card blocks carry FRESH keys, so
 *   `syncFromNote` on a still-mapped copy would silently mint a second set of
 *   historyless cards for every card the original already has. Leaving the copy
 *   unmapped is the same call `notes:delete`'s `keep` branch makes when it
 *   unmaps a note whose cards were detached: a note stops generating cards
 *   until its author deliberately points it at a deck again.
 */

/**
 * The mark a copy carries, in the document and in its title. Text lives in
 * `shellStrings.ts` (the main process's shell/persisted-default copy table) —
 * re-exported under this name so every existing call site and test import is
 * untouched.
 */
export const NOTE_COPY_SUFFIX = SHELL_NOTE_COPY_SUFFIX;

/** Everything this module needs: three stores and a transaction runner. */
export interface NoteDuplicateDeps {
  notes: NoteStore;
  org: NoteOrgStore;
  attachments: NoteAttachmentStore;
  /** Runs `write` in one database transaction — the whole copy lands or none of it does. */
  runInTransaction<T>(write: () => T): T;
}

/**
 * The one refusal this operation has, raised inside the transaction so the
 * rollback undoes the note row and its attachment rows together. Module-private:
 * outside, it is the `too-large` result, never an exception shape a caller has
 * to know.
 */
class OversizeCopyError extends Error {}

/**
 * Duplicates `noteId` into a new note of the same profile. Throws
 * `NoteNotFoundError` when the note is unknown, soft-deleted, or another
 * profile's — the same gate every other note operation goes through.
 */
export function duplicateNote(
  deps: NoteDuplicateDeps,
  noteId: string,
  now: string,
): NoteDuplicateResult {
  try {
    return { ok: true, note: deps.runInTransaction(() => copyNote(deps, noteId, now)) };
  } catch (error) {
    // A document too large for one `appendUpdate` is the creation path's own
    // limit, inherited honestly (`markdownImport.ts` inherits the same one and
    // names it the same way) rather than worked around with a second write path
    // the editor does not use.
    if (error instanceof OversizeCopyError) return { ok: false, reason: "too-large" };
    throw error;
  }
}

function copyNote(deps: NoteDuplicateDeps, noteId: string, now: string): NoteMeta {
  // The gate AND the read: `readForCompaction` refuses anything that is not an
  // active note of this profile, so nothing below has to re-check it.
  const read = deps.notes.readForCompaction(noteId);
  const merged = mergeNoteState(
    read.snapshot,
    read.updates.map((update) => update.bytes),
  );
  const source = deps.notes.list().find((note) => note.id === noteId);
  if (source === undefined) {
    throw new Error(`Invariant violated: note "${noteId}" read for compaction but absent from list().`);
  }

  const copy = deps.notes.create(now);

  // Before the document, because the rewrite below needs the ids these inserts
  // mint. `sha256` rides across verbatim — it is content addressing, not
  // identity, exactly as it is on a foreign import.
  const attachmentIds = new Map<string, string>();
  for (const attachment of deps.attachments.list(noteId)) {
    const added = deps.attachments.add(
      copy.id,
      {
        fileName: attachment.fileName,
        mime: attachment.mime,
        sizeBytes: attachment.sizeBytes,
        sha256: attachment.sha256,
      },
      now,
    );
    attachmentIds.set(attachment.id, added.id);
  }

  const duplicated = duplicateNoteState(merged.snapshot, {
    sourceNoteId: noteId,
    newNoteId: copy.id,
    // The same mint the editor's own re-keying plugin uses (`noteFlashcard.ts`),
    // so a copy's keys are indistinguishable from typed ones.
    mintCardKey: () => randomUUID(),
    titleSuffix: NOTE_COPY_SUFFIX,
  });
  // `remapNoteState` rather than a second traversal inside `duplicateNoteState`:
  // id remapping already lives in exactly one place, and this map does not
  // exist until the inserts above have run.
  const state =
    attachmentIds.size === 0 ? duplicated.state : remapNoteState(duplicated.state, attachmentIds);
  if (state.byteLength > NOTE_UPDATE_MAX_BYTES) throw new OversizeCopyError();

  deps.notes.appendUpdate(copy.id, state, duplicated.title, now);
  if (source.folderId !== null) deps.notes.setFolder(copy.id, source.folderId);
  if (source.categoryId !== null) deps.notes.setCategory(copy.id, source.categoryId);
  for (const link of deps.org.listTagLinks()) {
    if (link.noteId === noteId) deps.org.attachTag(copy.id, link.tagId);
  }
  // Not `compactIfNeeded`: one update never reaches the threshold, and a copy
  // that is not in the search index until somebody edits it is a copy nobody
  // can find.
  compactNow(deps.notes, copy.id);

  // `create` stamped both timestamps with this same `now`, and `appendUpdate`
  // re-stamped `updated_at` with it — so the row now reads exactly this, with
  // no second `list()` scan to prove it.
  return {
    ...copy,
    title: duplicated.title.trim(),
    folderId: source.folderId,
    categoryId: source.categoryId,
  };
}

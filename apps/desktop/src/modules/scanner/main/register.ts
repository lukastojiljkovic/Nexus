import { buildNoteUpdate, parseMarkdownNote } from "@nexus/core";
import { NoteStore } from "@nexus/db";
import { NOTE_UPDATE_MAX_BYTES } from "../../../shared/ipc.js";
import type { ModuleHostSurface } from "../../../main/moduleIpc.js";
import { compactNow } from "../../../main/notes.js";
import { contract, SCAN_TEXT_MAX_CHARS, SCAN_TITLE_MAX_CHARS } from "../shared/ipc.js";

/**
 * SCANNER in the main process (ADR-090): the one handler its contract declares.
 *
 * **Why main writes the note and the renderer does not.** The database lives
 * only in main (SEC-EL), and there is exactly one way a note is created in this
 * app: `NoteStore.create` mints the row, `appendUpdate` writes the document AND
 * the denormalised title, and `compactNow` folds that update into the snapshot,
 * which is what writes `note_snapshots.plaintext` - the note's searchable body
 * (ADR-021 / SRCH-002) - and takes the first version-history checkpoint
 * (ADR-015). This handler walks that path and nothing else, so a scanned note is
 * indistinguishable from a typed one the moment it lands: search finds it,
 * version history has it, the editor opens it. `main/markdownImport.ts` is the
 * precedent, and this file mirrors it deliberately.
 *
 * **The image is not here, and that is a decision.** A scan's picture is an
 * ordinary note attachment; main already has one validated channel for that
 * (`note-attachments:add`), which sniffs the bytes, writes the encrypted blob,
 * counts its references and indexes its text. A module that grew its own blob
 * writer would be a second implementation of ADR-019, and the page can reach
 * the existing one because it is the shell's own bridge. So the module's job is
 * the TEXT - the part that needs the notes store's create path - and the page
 * attaches the picture afterwards with the note id this handler answers.
 *
 * **Why the wire cap is a character count.** See `SCAN_TEXT_MAX_CHARS`: the
 * store measures characters, and a byte cap would refuse legal Serbian input
 * that happens to be two bytes a letter. The update-size check below is the
 * second gate and the one the store itself enforces; it is unreachable from the
 * page (64 000 characters cannot build a 256 KB document), so a refusal here
 * means something else is wrong and is not dressed up as a user-facing state.
 */
export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  ctx.handle("saveAsNote", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const text = scanText(call, payload.text);
    const title = call.as.asCappedChars(
      call.as.asString(payload.title, "title"),
      "title",
      SCAN_TITLE_MAX_CHARS,
    );

    // The parse settles the title the way core settles it for every other note
    // (a leading H1 wins; otherwise the caller's title is materialised as one,
    // and an empty one falls back to the document's own first block).
    const parsed = parseMarkdownNote(text, title.trim());
    const update = buildNoteUpdate(parsed.blocks);
    if (update.byteLength > NOTE_UPDATE_MAX_BYTES) {
      throw new Error(
        `Scanned text would need a ${update.byteLength}-byte note update, over the ${NOTE_UPDATE_MAX_BYTES}-byte wire limit.`,
      );
    }

    return call.profileDb(profileId, (db, id) => {
      const notes = new NoteStore(db, id);
      const now = instant(call.now());
      let noteId = "";
      // One transaction, the same shape `markdownImport` uses: the row, its
      // document and its snapshot land whole or not at all.
      db.transaction((): void => {
        const note = notes.create(now);
        notes.appendUpdate(note.id, update, parsed.title, now);
        compactNow(notes, note.id);
        noteId = note.id;
      })();
      return { noteId, title: parsed.title };
    });
  });
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

/**
 * The recognised text off the wire: capped first, then trimmed, then required
 * to carry something. The order matters - a cap applied after the trim would
 * let a 200 KB payload allocate its way through `asNonEmptyString` first, which
 * is the ordering `main/index.ts` states for every text field it validates.
 */
function scanText(
  call: { readonly as: { asCappedChars(value: unknown, field: string, max: number): string } },
  value: unknown,
): string {
  const capped = call.as.asCappedChars(value, "text", SCAN_TEXT_MAX_CHARS);
  const text = capped.trim();
  if (text.length === 0) {
    throw new Error('Invalid IPC payload: "text" must be a non-empty string.');
  }
  return text;
}

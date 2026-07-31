import type { AttachmentTextCandidate } from "@nexus/db";
import { DOC_TEXT_PREVIEW_MAX_BYTES } from "../shared/ipc.js";
import { decodePreviewText, isTextPreviewAttachment } from "./docPreview.js";

/**
 * The extraction half of attachment-content search (SRCH-008, migration 048):
 * turning an attachment's encrypted bytes into the text its owner's search
 * entry matches on.
 *
 * It lives in main and nowhere else, because nowhere else can do it: the bytes
 * sit encrypted in the blob store outside the database, so no SQL trigger can
 * reach them and the renderer never sees them at all. Main already holds the
 * blob key at exactly the two moments this runs — when a file is attached, and
 * after unlock for everything attached before this feature existed.
 *
 * **Nothing here is a second decoder.** Eligibility is ADR-064's own
 * `isTextPreviewAttachment` and decoding is its `decodePreviewText`, reused as
 * they stand: what the app will show you as text is exactly what it indexes as
 * text, and neither predicate moves because the other gained a caller.
 *
 * **PDF and DOCX/XLSX/PPTX are deliberately out.** Reading their text needs a
 * parser, and this repo adds no dependency for it. Scraping recognisable byte
 * runs out of a compressed container instead would put fragments of the wrong
 * words into an index the user is entitled to trust — an honest absence is the
 * better answer, and the UI never claims otherwise. The same goes for a text
 * file past the preview cap: it simply has no indexed content.
 *
 * **Private notes are out by construction** and must stay that way: their
 * sealed tables get no projection views at all (migration 045), and the private
 * section keeps its own separate in-memory index. Nothing in this module
 * touches it.
 */

/**
 * Whether an attachment row's CONTENT may be indexed: the file preview's own
 * eligibility rule, plus the preview's own size cap. Two reused pieces, no new
 * threshold — the cap is `DOC_TEXT_PREVIEW_MAX_BYTES`, the 1 MiB above which
 * the app already declines to read a "text file" into memory for display.
 */
export function isTextIndexableAttachment(
  mime: string,
  fileName: string,
  sizeBytes: number,
): boolean {
  return sizeBytes <= DOC_TEXT_PREVIEW_MAX_BYTES && isTextPreviewAttachment(mime, fileName);
}

/** The fields extraction reads off an attachment, whichever module's row it came from. */
export interface AttachmentTextSource {
  mime: string;
  fileName: string;
  sizeBytes: number;
}

/**
 * The text an attachment contributes to the index — the EMPTY STRING whenever
 * there is nothing to contribute, never a throw and never a guess. Empty covers
 * all four honest absences: a format this build cannot read, a file past the
 * cap, a blob that is gone, and bytes that turned out bigger than the row
 * claimed. Callers store that empty string, which is what marks the row as
 * attempted (migration 048's NULL/non-NULL bookkeeping).
 *
 * The byte length is re-checked against the cap even though the row's
 * `sizeBytes` already was: an index row is metadata, the bytes are the truth —
 * the same double check `doc:read-text` makes before serving a preview.
 */
export function extractAttachmentText(
  attachment: AttachmentTextSource,
  bytes: Uint8Array | null,
): string {
  if (!isTextIndexableAttachment(attachment.mime, attachment.fileName, attachment.sizeBytes)) {
    return "";
  }
  if (bytes === null || bytes.byteLength > DOC_TEXT_PREVIEW_MAX_BYTES) return "";
  return decodePreviewText(bytes);
}

/**
 * One attachment table of one profile, as the backfill needs it — satisfied by
 * both `NoteAttachmentStore` and `TaskAttachmentStore`. Structural rather than
 * a union of the two classes, so a test can drive the pass without a database
 * and so a third table (should one ever be projected) needs no change here.
 */
export interface AttachmentTextTarget {
  listTextIndexCandidates(limit: number, maxSizeBytes: number): AttachmentTextCandidate[];
  setExtractedText(id: string, text: string): void;
}

export interface AttachmentTextBackfillDeps {
  /** Every profile's every projected attachment table, in whatever order. */
  readonly targets: Iterable<AttachmentTextTarget>;
  /** The blob store read; `null` for a hash nothing holds anymore. */
  readBytes(sha256: string): Promise<Uint8Array | null>;
  /** False once the database this pass started against has been locked or superseded — checked before every row. */
  stillThisSession(): boolean;
}

/**
 * Rows one pass may claim, across every target together. Bounded because this
 * is housekeeping: an unlock must never wait on it, and a library that has
 * never been indexed must not turn one unlock into a full-library decrypt. What
 * a pass does not reach stays pending — the candidate query is defined by the
 * column being NULL — so the next pass simply picks it up, and a library larger
 * than one budget finishes over the following unlocks with a correct, if
 * progressively more complete, index the whole way.
 */
export const ATTACHMENT_TEXT_BACKFILL_LIMIT = 200;

/**
 * One bounded pass over everything still pending. Returns how many rows it
 * CLAIMED — every one of which now carries a non-NULL value and will never be
 * offered again.
 *
 * Three properties it is built for, all of them load-bearing:
 *
 *  - **Never blocking.** It yields to the event loop between rows and is always
 *    started unawaited, so a pass across hundreds of encrypted files cannot
 *    stall the main process. `healNotes` is the same shape for the same reason.
 *  - **Safe to interrupt.** `stillThisSession` is checked before every single
 *    row, so a lock (or a newer unlock superseding this session) stops the pass
 *    instead of letting it read and write against a closed connection. A row
 *    whose failure arrived together with that lock is deliberately NOT marked
 *    attempted — the failure was the lock, not the row, and writing it off
 *    would be the one way a resumable pass can lose data.
 *  - **Idempotent, and progressing.** Every row the pass looks at is claimed,
 *    including one the eligibility rule refuses (the SQL narrowing is a coarse
 *    superset, so binaries do reach here) — otherwise a handful of unreadable
 *    files would consume the budget on every unlock forever.
 *
 * A per-row failure is logged and skipped; a whole target that throws on its
 * own read is logged and skipped too, without abandoning the targets after it.
 * Nothing is ever thrown at the caller: this is background repair, and there is
 * no user action to fail.
 */
export async function backfillAttachmentText(
  deps: AttachmentTextBackfillDeps,
): Promise<number> {
  let claimed = 0;
  let budget = ATTACHMENT_TEXT_BACKFILL_LIMIT;

  for (const target of deps.targets) {
    if (budget <= 0 || !deps.stillThisSession()) return claimed;

    let candidates: AttachmentTextCandidate[];
    try {
      candidates = target.listTextIndexCandidates(budget, DOC_TEXT_PREVIEW_MAX_BYTES);
    } catch (error) {
      console.error("Reading attachment-text candidates failed (skipping this table):", error);
      continue;
    }

    for (const row of candidates) {
      if (!deps.stillThisSession()) return claimed;
      try {
        // Ineligible rows never reach the blob store at all: the rule is
        // decided from the index row, and only then are bytes read.
        const bytes = isTextIndexableAttachment(row.mime, row.fileName, row.sizeBytes)
          ? await deps.readBytes(row.sha256)
          : null;
        if (!deps.stillThisSession()) return claimed;
        target.setExtractedText(row.id, extractAttachmentText(row, bytes));
      } catch (error) {
        console.error(`Extracting text from attachment "${row.id}" failed:`, error);
        // A failure that arrived WITH the lock is not this row's fault.
        if (!deps.stillThisSession()) return claimed;
        try {
          target.setExtractedText(row.id, "");
        } catch (markError) {
          console.error(`Marking attachment "${row.id}" as attempted failed:`, markError);
          budget -= 1;
          continue;
        }
      }
      claimed += 1;
      budget -= 1;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return claimed;
}

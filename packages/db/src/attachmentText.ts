/**
 * The vocabulary shared by the two attachment tables whose FILE CONTENTS the
 * global search index carries (SRCH-008 / migration 048): `note_attachments`
 * and `task_attachments`. Each store spells its own SQL — the tables hang off
 * different owners and scope through different joins — but the row shape the
 * extractor reads back, the coarse mime narrowing the candidate query uses and
 * the length the column is cut to are one thing each, declared once here.
 *
 * The extraction itself deliberately does NOT live in `@nexus/db` and cannot:
 * an attachment's bytes sit encrypted on disk OUTSIDE the database, so only the
 * main process — the one holder of the blob keys — can turn them into text. No
 * SQL trigger can reach them, which is exactly why this is a stored column fed
 * by main rather than a projection SQL computes for itself.
 *
 * `subject_attachments` is deliberately absent: its file names are not
 * projected into the index either (migration 035 says so in as many words), and
 * indexing the contents of files whose names are not searchable would be a
 * wider feature wearing this one's clothes.
 */

/**
 * One attachment row the text-extraction pass may still have to look at:
 * everything main needs to decide eligibility (`mime`/`fileName`/`sizeBytes`)
 * and to fetch the bytes (`sha256`), plus the `id` it writes the result back
 * against. Never the bytes themselves — those never enter the database.
 */
export interface AttachmentTextCandidate {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * The mimes a candidate query narrows to — deliberately a COARSE SUPERSET of
 * what actually qualifies, never a second spelling of the eligibility rule.
 * The rule itself is `isTextPreviewAttachment` in main (ADR-064's own
 * predicate, reused rather than restated), and these two are simply the only
 * stored mimes it can ever answer "yes" to: a sniffed `text/plain`, and the
 * `application/octet-stream` rows whose NAME says `.txt`/`.md` and which
 * predate the text sniff. Narrowing here rather than in TypeScript is what
 * keeps a library full of images out of the pass entirely instead of having it
 * claim and discard every one of them.
 */
export const ATTACHMENT_TEXT_CANDIDATE_MIMES = [
  "text/plain",
  "application/octet-stream",
] as const;

/**
 * Longest extracted text a row stores. This is migration 017's per-entry body
 * cap, not a new number: the projection caps every kind's body at 8000
 * characters, so a column holding more would be storing text the index can
 * never reach — dead weight inside an encrypted file, paid for on every backup.
 * Applied by the stores themselves, so the column cannot exceed it whatever the
 * caller passes.
 */
export const ATTACHMENT_TEXT_MAX_CHARS = 8000;

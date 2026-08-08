import type { Migration } from "./migrations.js";

/**
 * Migration 35 — STUDY-001's other half: a subject's **materials** (the files
 * that belong to a course — a scanned skripta, a slide deck, last year's paper)
 * and its **linked notes**. Two tables, each mirroring one that already exists,
 * because both are features this codebase has already answered once.
 *
 * `subject_attachments` is migration 024's `task_attachments` with a subject on
 * the other end, column for column and index for index — which is itself
 * migration 013's `note_attachments` with a task on the other end. A file
 * hanging off a subject is the same thing as a file hanging off a task or a
 * note: one content-addressed blob plus one index row. Deliberately NO
 * `profile_id`, exactly as neither of the other two has one: a subject already
 * carries its profile, so scoping rides the join (`SubjectAttachmentStore`
 * reaches every row through an already-scoped `subjects` subquery), and a column
 * here would be a second, independently-writable answer to a question the
 * subject already answers.
 *
 * The bytes never live in SQLite: they sit content-addressed in the encrypted
 * blob store (`<userData>/blobs`, ADR-019), owned by
 * `apps/desktop/src/main/attachments.ts` — the SAME store notes, tasks and the
 * dashboard background use, not a fourth one. That is why this table must be
 * read together with the others wherever a blob's reference count is computed
 * (`main/index.ts`'s `blobRefCount`): a blob is orphaned only when NO table
 * names it anymore, and a GC that consulted three of four would delete a file
 * the fourth still points at.
 *
 * `subject_attachments_subject` covers the hot path — "this subject's
 * materials", in insertion order via `id` (a UUIDv7, so it sorts
 * chronologically without a separate column). `subject_attachments_sha` covers
 * the reverse lookup the blob store's GC and the `nx-blob:` protocol both need,
 * and is deliberately NOT scoped by profile for the reason
 * `task_attachments_sha` is not: the store is content-addressed across the whole
 * database, so a reference count must see every row.
 *
 * A material's file NAME is deliberately NOT projected into the search index
 * (migration 017). Task attachments started exactly here too — migration 024
 * shipped the table, and migration 025 added the search projection a slice later
 * — and the same order is right again: the index's `search_source_*` views are
 * one coherent surface, and widening them is its own decision with its own
 * rebuild, not a rider on the table that makes it possible.
 *
 * `subject_note_links` is the pair-keyed join `task_dependencies` (migration 029)
 * is, with one column added: `created_at`. The difference is honest — a
 * dependency is a bare fact of ordering with nothing to date, while "when did I
 * file this note under this subject" is the order the section lists them in, and
 * a UUIDv7 tiebreak is not available on a table whose rows have no id of their
 * own. As there, no `profile_id`: both ends carry one, so scoping rides the
 * join, and `PRIMARY KEY (subject_id, note_id)` makes one pair unrepeatable —
 * which is what lets `SubjectNoteLinkStore.linkNote` be an idempotent
 * `ON CONFLICT DO NOTHING` rather than a read-then-write.
 *
 * Both cascades are HARD-delete only, and a soft delete of EITHER end leaves the
 * edge standing (ADR-037's edge philosophy, the arrangement `task_tag_links` and
 * `task_dependencies` already have): a note sent to the trash and brought back
 * finds its subject links intact, and so does a restored subject. Only the
 * store's reads filter them, through a live-BOTH-ends join.
 */
export const migration035: Migration = {
  version: 35,
  up(db) {
    db.exec(`
      CREATE TABLE subject_attachments (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX subject_attachments_subject ON subject_attachments (subject_id);
      CREATE INDEX subject_attachments_sha ON subject_attachments (sha256);

      CREATE TABLE subject_note_links (
        subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (subject_id, note_id)
      );
      -- "Which subjects is this note filed under" — the reverse of the direction
      -- the primary key's own index already covers. NO SURFACE READS IT YET:
      -- SubjectNoteLinkStore.listSubjectsOfNote is its only caller and nothing
      -- in the renderer calls that, so the note side of this relation is
      -- currently write-only. The index and the store method are both kept
      -- deliberately — the note editor is meant to show the subjects a note is
      -- filed under, and that surface is being built — but until it exists this
      -- comment must not claim a reader that does not.
      CREATE INDEX subject_note_links_note ON subject_note_links (note_id);
    `);
  },
};

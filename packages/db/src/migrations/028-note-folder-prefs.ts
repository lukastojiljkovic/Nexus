import type { Migration } from "./migrations.js";

/**
 * Migration 28 — per-folder note preferences (ADR-036 / NOTE prefs): the
 * template a folder opens its new notes with, and the one folder a context-free
 * "Nova beleška" files into.
 *
 * `default_template_id` is DELIBERATELY NOT a foreign key. A template is one of
 * two things: a `note_templates` row, or a built-in that exists only as a code
 * constant (`BUILTIN_NOTE_TEMPLATE_IDS`, `@nexus/core`) and has no row anywhere
 * to point at. A foreign key could therefore only express half the domain, and
 * choosing the half that happens to be in SQLite would make the built-ins —
 * which is what most folders will name — unstorable. `NoteOrgStore.setDefaultTemplate`
 * validates a candidate against the union of both sources at SET time instead,
 * and at APPLY time a dangling id (its template deleted since) quietly means
 * "no template": a folder must never refuse to create a note.
 *
 * `is_capture_default` is a per-profile singleton, and
 * `note_folders_capture_default` — UNIQUE on `profile_id`, partial on the flag —
 * is what makes it one. The store clears the mark before setting it, in one
 * transaction, so the index never sees two claimants; what the index buys is
 * everything that does NOT go through the store, above all a restore, where an
 * archive claiming the mark twice is refused instead of written. A partial index
 * is the only shape that works here: a plain UNIQUE(profile_id) would allow one
 * folder per profile, full stop.
 */
export const migration028: Migration = {
  version: 28,
  up(db) {
    db.exec(`
      ALTER TABLE note_folders ADD COLUMN default_template_id TEXT;
      ALTER TABLE note_folders ADD COLUMN is_capture_default INTEGER NOT NULL DEFAULT 0
        CHECK (is_capture_default IN (0, 1));

      CREATE UNIQUE INDEX note_folders_capture_default
        ON note_folders (profile_id) WHERE is_capture_default = 1;
    `);
  },
};

import type { Migration } from "./migrations.js";

/**
 * Migration 15 — the NOTE module's user-defined templates (ADR-016; NOTE
 * slice 009-a). A template is a different kind of object from a note
 * entirely: content to insert, with no identity in the note graph, no
 * concurrent editing, and no history worth preserving. Everything about this
 * table follows from refusing to model a template as a note.
 *
 * `content` is a **ProseMirror document, JSON-encoded** — deliberately NOT a
 * Yjs snapshot like `note_snapshots`/`note_versions`. A template is never
 * concurrently edited, so the CRDT update log, seq ordering, and merge
 * machinery those tables need would buy nothing here, and would cost a
 * conversion at both ends: apply would need Yjs -> PM (a throwaway `Y.Doc`
 * plus a headless editor to read JSON back out of it) and capture would need
 * PM -> Yjs, just to model concurrency a template never has. With PM JSON,
 * both operations collapse to one TipTap call each — `insertContent(json)`
 * to apply, `editor.getJSON()` to capture (ADR-016).
 *
 * The UNIQUE `(profile_id, name)` index makes the name the user-facing
 * identity of a template: it is what "saving under an existing name replaces
 * it" relies on (`NoteTemplateStore.save` is an upsert on this pair), and it
 * is the collision `rename` must detect — excluding the row's own id, the
 * `note_tags_profile_name` / `renameTag` precedent, so renaming a template to
 * its own current name is a no-op rather than a collision.
 *
 * There is deliberately **no soft delete**, unlike every other NOTE child
 * table (`note_attachments`, `note_versions`, ...) whose rows a note points
 * at and whose loss would be destructive. A template carries no history and
 * nothing references it, so `NoteTemplateStore.remove` is a hard `DELETE` —
 * the same action a user can immediately undo by saving the current note as
 * a template again under the same name.
 *
 * Built-in templates (Sastanak, Dnevnik, Recept, Predmet, Projekat) are code
 * constants in the renderer (`noteTemplates.ts`, slice 009-b), addressed by a
 * `builtin:` id prefix that also makes them non-renameable and
 * non-deletable — never rows in this table. Seeding them as rows would need
 * per-profile migration logic for a set that ships and evolves with the app
 * and costs nothing to recompute; this table holds only what the user
 * actually typed.
 */
export const migration015: Migration = {
  version: 15,
  up(db) {
    db.exec(`
      CREATE TABLE note_templates (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        content     TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE UNIQUE INDEX note_templates_profile_name ON note_templates (profile_id, name);
    `);
  },
};

import type { Migration } from "./migrations.js";

/**
 * Migration 12 — the NOTE module's wiki-link index (ADR-013 / NOTE-004; NOTE
 * slice 004-a). Wiki-links are authored inside a note's Yjs document as link
 * nodes carrying only the target note's id (migration 010's substrate does
 * not change); this migration adds the queryable index the editor and the
 * backlinks panel read from.
 *
 * `note_links` is a plain edge list, keyed `(source_note_id, target_note_id)`
 * so a note links to another at most once; both sides cascade on their note's
 * delete, mirroring `note_tag_links` (migration 011). Unlike a tag link, a
 * link's target deliberately survives its note being *soft*-deleted — only a
 * hard delete at the SQL level removes the row — so undo/restore heals a link
 * the same way it heals everything else about a note; `NoteStore.setOutboundLinks`
 * therefore checks existence-in-profile only, never `deleted_at`.
 *
 * `note_links_target` covers the reverse lookup — "which notes link to this
 * one" (backlinks) — the direction the primary key does not already serve;
 * the forward direction ("this note's outbound links") is served by the
 * primary key's leading column.
 */
export const migration012: Migration = {
  version: 12,
  up(db) {
    db.exec(`
      CREATE TABLE note_links (
        source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        target_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        PRIMARY KEY (source_note_id, target_note_id)
      );
      CREATE INDEX note_links_target ON note_links (target_note_id);
    `);
  },
};

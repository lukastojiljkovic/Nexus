import type { Migration } from "./migrations.js";

/**
 * Migration 4 — the CAL module's document-expiry data layer (PRD 04: CAL-004,
 * the founder's signature feature). Tracked documents carry an expiry date and a
 * per-document reminder ladder; a derived status ('ok' / 'uskoro' / 'istekao')
 * and a renewal history sit on top.
 *
 * Two tables, mirroring `events`: UUIDv7 text ids, ISO-8601 text dates, and
 * ON DELETE CASCADE to `profiles` (ADR-001). `tracked_documents` is
 * profile-scoped and soft-deletable; `doc_type` is a closed enum (CHECK) and
 * `reminder_offsets` is a JSON array of day-counts owned by the store — SQLite
 * never interprets it. `document_renewals` is an append-only log: one row per
 * renewal, holding the expiry_date that was replaced, and cascades from its
 * document. Status is NOT stored — it is derived at read time from the expiry
 * date and the ladder, so no column drifts as the clock moves. The actual
 * reminder *notifications* belong to NTF; this slice only stores the ladder and
 * derives status — no scheduler, no notification columns here.
 */
export const migration004: Migration = {
  version: 4,
  up(db) {
    db.exec(`
      CREATE TABLE tracked_documents (
        id               TEXT PRIMARY KEY,
        profile_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        doc_type         TEXT NOT NULL CHECK (doc_type IN
                           ('licna_karta', 'pasos', 'vozacka', 'registracija',
                            'kartica', 'polisa', 'custom')),
        label            TEXT NOT NULL,
        expiry_date      TEXT NOT NULL,
        reminder_offsets TEXT NOT NULL,
        notes            TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        deleted_at       TEXT
      );

      -- The hot path is "active documents for one profile, by soonest expiry"
      -- (the expiry dashboard). This partial index covers that query and keeps
      -- soft-deleted rows out of it.
      CREATE INDEX documents_profile_active
        ON tracked_documents (profile_id, expiry_date, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE document_renewals (
        id              TEXT PRIMARY KEY,
        document_id     TEXT NOT NULL REFERENCES tracked_documents(id) ON DELETE CASCADE,
        previous_expiry TEXT NOT NULL,
        renewed_at      TEXT NOT NULL
      );

      -- Renewal history for one document, oldest first.
      CREATE INDEX document_renewals_document
        ON document_renewals (document_id, renewed_at);
    `);
  },
};

import type { Migration } from "./migrations.js";

/**
 * Migration 30 — the dashboard's custom background and its dim (SET-006 /
 * ADR-041). One row per profile, created on first write; `DashboardSettingsStore.get`
 * answers with defaults while the row is absent, exactly as `ntf_settings`
 * (migration 009) does for notification preferences — a profile that never
 * touched the setting costs no row.
 *
 * The image itself is NOT stored here. It is an ordinary entry in the existing
 * content-addressed, encrypted blob store (ADR-014/019), so a personal photo
 * gets SEC-DAR's at-rest guarantees for free and a background that happens to
 * be byte-identical to an attachment is one file on disk. What this table holds
 * is the *choice*: which hash, served as which mime, dimmed by how much.
 *
 * `background_mime` is the main-process `sniffMime` result captured at pick
 * time (SEC-FILE-02) — never inferred from a file name — and the store refuses
 * anything outside `isInlineImageMime`. `background_size_bytes` rides along for
 * the same reason `note_attachments.size_bytes` does: an archive's binary
 * inventory declares every blob by hash AND size, and a hash with no size would
 * make that inventory only partly true.
 *
 * Three CHECKs, each mirroring a rule the store also enforces (a CHECK is what
 * holds when a row arrives through a restore rather than through the store):
 * the three background columns are all null or all set — a hash without a mime
 * is a blob nothing can decide how to serve — and the dim stays inside 0..90,
 * the same closed range `MAX_BACKGROUND_DIM` names. 90 rather than 100 on
 * purpose: a scrim at full opacity is not a dimmed photo, it is no photo.
 *
 * `dashboard_settings_background` covers the reverse lookup main's blob
 * reference count and mime resolver both run — "does any profile still name
 * this hash" — the same shape `note_attachments`' own sha256 lookups have.
 */
export const migration030: Migration = {
  version: 30,
  up(db) {
    db.exec(`
      CREATE TABLE dashboard_settings (
        profile_id            TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        background_hash       TEXT,
        background_mime       TEXT,
        background_size_bytes INTEGER,
        background_dim        INTEGER NOT NULL DEFAULT 40,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        CHECK ((background_hash IS NULL) = (background_mime IS NULL)),
        CHECK ((background_hash IS NULL) = (background_size_bytes IS NULL)),
        CHECK (background_size_bytes IS NULL OR background_size_bytes > 0),
        CHECK (background_dim BETWEEN 0 AND 90)
      );
      CREATE INDEX dashboard_settings_background
        ON dashboard_settings (background_hash);
    `);
  },
};

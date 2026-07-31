import type { Migration } from "./migrations.js";

/**
 * Migration 44 — the scheduled-backup settings (SET-011 / ADR-056). One row
 * per profile, created on first write; `BackupSettingsStore.get` answers with
 * defaults while the row is absent, exactly as `dashboard_settings`
 * (migration 030) does — a profile that never touched the setting costs no row.
 *
 * **Deliberately device-local.** Every column here describes THIS machine's
 * backup routine, not the profile's data: `folder_path` is an absolute path
 * meaningless anywhere else, and `passphrase_wrapped` is the archive
 * passphrase sealed under a key derived from this account's data key
 * (`@nexus/core/auth`'s `wrapBackupPassphrase` — AES-256-GCM under an
 * HKDF purpose key, info `nexus/backup-passphrase/v1`), so it opens only on
 * this account. That is why the table is excluded from the export archive AND
 * from `RESTORE_WIPE_TABLES` — see the exemption comment in
 * `restoreStore.test.ts` — and why no interchange change accompanies it.
 *
 * The CHECKs mirror rules `BackupSettingsStore` also enforces (a CHECK is what
 * holds when a row arrives outside the store): the cadence and status domains
 * are closed, `keep_last` stays inside 2..50, an ENABLED schedule must be
 * fully configured (a folder to write into, a passphrase to seal under —
 * enabled-but-unrunnable is a state nothing may hold), and `last_error` exists
 * only beside a failed status, since a named reason for a run that succeeded
 * is a contradiction.
 */
export const migration044: Migration = {
  version: 44,
  up(db) {
    db.exec(`
      CREATE TABLE backup_settings (
        profile_id         TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        enabled            INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        cadence            TEXT NOT NULL DEFAULT 'daily' CHECK (cadence IN ('daily', 'weekly')),
        folder_path        TEXT,
        passphrase_wrapped TEXT,
        keep_last          INTEGER NOT NULL DEFAULT 5 CHECK (keep_last BETWEEN 2 AND 50),
        last_run_at        TEXT,
        last_status        TEXT CHECK (last_status IN ('ok', 'failed')),
        last_error         TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        CHECK (enabled = 0 OR (folder_path IS NOT NULL AND passphrase_wrapped IS NOT NULL)),
        CHECK (last_error IS NULL OR last_status = 'failed')
      );
    `);
  },
};

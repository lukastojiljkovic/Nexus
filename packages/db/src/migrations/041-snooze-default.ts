import type { Migration } from "./migrations.js";

/**
 * Migration 41 — the profile's default snooze preset (NTF-009 / PRD 05 §5).
 *
 * One column on the existing `ntf_settings` row: which of the four snooze
 * presets („10 min“, „1 h“, „Večeras“, „Sutra ujutru“) the notification
 * center's plain „Odloži“ button means. The four presets themselves stay
 * offered explicitly — this records which one is reached for by default, so the
 * common case is one click instead of a choice made over and over.
 *
 * It rides `ntf_settings` for migration 026's reason, one step further along:
 * this IS a notification preference, and the row it lands on already carries
 * the "one row per profile, absent = defaults" idiom (migration 009) — so an
 * absent row means „10 min“, which is exactly what a profile that has never
 * touched a notification setting should get.
 *
 * `NOT NULL DEFAULT '10m'` keeps that reading consistent for a row that DOES
 * exist but predates this migration, and `10m` rather than any other preset
 * because it is the shortest: a default that comes back soonest is the one that
 * loses nothing if it is wrong, and it is what the button did before there was
 * a preference to read. The CHECK is the closed preset domain
 * (`SNOOZE_PRESETS` in `notificationStore.ts`, which main validates the wire
 * against) — the same belt-and-braces `ntf_source_settings.source` has, and for
 * the same reason: a row can reach this table through a restore, where no store
 * validator stands between the archive and the column.
 *
 * `ADD COLUMN` is enough — nothing about an existing CHECK is being altered, so
 * none of migration 019/021's table-rebuild machinery is needed.
 *
 * **It DOES travel in an archive**, unlike migration 026's `appetite_asked`:
 * a preference the user chose is theirs to get back, and a restore that dropped
 * it would quietly reset a setting rather than restore one. `ExportSettings`
 * carries it optionally-with-a-default, so every archive written before it
 * restores as „10 min“ — which is what those profiles' snooze button did.
 */
export const migration041: Migration = {
  version: 41,
  up(db) {
    db.exec(`
      ALTER TABLE ntf_settings
        ADD COLUMN snooze_default TEXT NOT NULL DEFAULT '10m'
          CHECK (snooze_default IN ('10m', '1h', 'tonight', 'tomorrow-morning'));
    `);
  },
};

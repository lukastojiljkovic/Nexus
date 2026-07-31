import type { Migration } from "./migrations.js";

/**
 * Migration 42 — the calendar's fixed semester dates (CAL-010 / ADR-054). One
 * row per profile, created on first write; `CalendarSettingsStore.get` answers
 * both-null ("no term set") while the row is absent — the `dashboard_settings`
 * singleton arrangement (migration 030), which is itself the `ntf_settings`
 * one: a profile that never touched the setting costs no row, and the default
 * lives in one place.
 *
 * The table is `calendar_settings`, not `semester_settings`, deliberately: the
 * semester pair is the first PROFILE fact the calendar stores, not the last,
 * and a future calendar preference gets a column here rather than a new
 * pattern.
 *
 * Both columns are bare `YYYY-MM-DD` day keys — a term has edges, not
 * instants — shaped by a GLOB CHECK and ordered by a pair CHECK
 * (`semester_start <= semester_end`, which on this shape IS date order). The
 * halves may sit alone at the TABLE on purpose: one upsert statement stages
 * either column, and both-or-neither is the store's own rule (a term with one
 * edge means nothing, so `CalendarSettingsStore` refuses it before anything is
 * written). Whether a shaped string is a real calendar day is also the
 * store's: no GLOB can know February's length.
 */
export const migration042: Migration = {
  version: 42,
  up(db) {
    db.exec(`
      CREATE TABLE calendar_settings (
        profile_id     TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        semester_start TEXT NULL CHECK (semester_start IS NULL OR semester_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        semester_end   TEXT NULL CHECK (semester_end   IS NULL OR semester_end   GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        CHECK (semester_start IS NULL OR semester_end IS NULL OR semester_start <= semester_end)
      );
    `);
  },
};

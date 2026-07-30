import type { Migration } from "./migrations.js";

/**
 * Migration 26 — the one-time "how much should Nexus remind you" ask
 * (NTF-008 / ADR-033).
 *
 * One column on the existing `ntf_settings` row: `appetite_asked` records that
 * the question was **put**, not what was answered. Choosing a preset and
 * keeping the defaults close it identically, because a question asked once,
 * ever, is exactly what makes it bearable to ask at all.
 *
 * It rides `ntf_settings` rather than a table of its own because the answer IS
 * a notification preference, and the row it lands on already carries the "one
 * row per profile, absent = defaults" idiom (migration 009): an **absent row
 * therefore means unasked**, which is the correct reading for a profile that
 * has never touched a notification setting — precisely the profile the ask
 * exists for. `NOT NULL DEFAULT 0` keeps that reading consistent for a row that
 * DOES exist but predates this migration (someone who set quiet hours before
 * NTF-008 shipped is still unasked), and the `IN (0, 1)` CHECK is the same
 * boolean encoding every other flag column in this schema uses. `ADD COLUMN`
 * is enough here — nothing about an existing CHECK is being altered, so none of
 * migration 019/021's table-rebuild machinery is needed.
 *
 * **The flag deliberately does not travel in an archive** (ADR-033 section 6 —
 * no interchange change, no version bump). `RestoreStore` writes `ntf_settings`
 * by naming its columns, so a restore leaves this at its default and the
 * restored profile is asked again at its next visible reminder. That is the
 * harmless direction: a second ask costs one dialog, whereas carrying a `1`
 * into a fresh install would silently swallow the only chance the user gets to
 * be asked.
 */
export const migration026: Migration = {
  version: 26,
  up(db) {
    db.exec(`
      ALTER TABLE ntf_settings
        ADD COLUMN appetite_asked INTEGER NOT NULL DEFAULT 0
          CHECK (appetite_asked IN (0, 1));
    `);
  },
};

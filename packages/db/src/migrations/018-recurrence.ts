import type { Migration } from "./migrations.js";

/**
 * Migration 18 — recurrence for tasks and events (ADR-024). One rule language
 * (`@nexus/core`'s `RecurrenceRule`) serialized as canonical JSON, stored on
 * the two tables that recur — but with deliberately different meanings, which
 * is why the columns are not identical:
 *
 *  - `tasks.recurrence` describes a task that advances **in place**: completing
 *    it moves its `due_date` to the next occurrence instead of finishing it, so
 *    there is only ever one row and nothing to except. A rule therefore only
 *    makes sense beside a `due_date` — the date it phases from — which
 *    `TaskStore` enforces in both directions.
 *  - `events.recurrence` describes a **series master** the calendar expands
 *    virtually: one row standing for many occurrences. That is what makes
 *    `recurrence_exdates` an event-only column — a JSON array of bare
 *    `YYYY-MM-DD` dates the user deleted or detached from the series, kept
 *    sorted ascending by `EventStore`. It is NOT NULL with a `'[]'` default so
 *    every event row always carries at least an empty list, and reading it can
 *    never have to decide what a NULL exception list would mean.
 *
 * Both recurrence columns are nullable and default to NULL: a plain task or a
 * one-off event carries no rule, which is what every existing row becomes.
 *
 * **No SQL CHECK can validate any of this** — SQLite cannot parse JSON in a
 * constraint, and the rule language is a tagged union with per-`kind` field
 * sets far beyond what a CHECK could express. The stores are the gate:
 * `TaskStore`/`EventStore` run every write through `validateRecurrenceRule`
 * and store only its canonical serialization, and treat a stored value that
 * fails to validate on read as corruption (a thrown validation error naming
 * the row), never as user input to be coerced. `parseImportArchive` applies
 * the same validator to an archive, so nothing reaches these columns unchecked.
 */
export const migration018: Migration = {
  version: 18,
  up(db) {
    db.exec(`
      ALTER TABLE tasks ADD COLUMN recurrence TEXT;

      ALTER TABLE events ADD COLUMN recurrence TEXT;
      ALTER TABLE events ADD COLUMN recurrence_exdates TEXT NOT NULL DEFAULT '[]';
    `);
  },
};

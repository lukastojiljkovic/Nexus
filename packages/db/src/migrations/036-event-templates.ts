import type { Migration } from "./migrations.js";

/**
 * Migration 36 — event templates (CAL-009): a saved SHAPE of one event, a task
 * template (migration 027 / ADR-035) applied to the calendar. The table is that
 * one field for field, because the idea is the same idea: a template is content
 * to instantiate, with no identity among the events, no place in any series, and
 * no history worth keeping.
 *
 * `payload` is the whole event-shaped body as **JSON text** — title, the all-day
 * flag, a time of day, a duration, location, description, category, the reminder
 * ladder and the recurrence rule. JSON rather than a column apiece for migration
 * 027's reason: none of it is ever queried, filtered or joined on — the row is
 * read whole, validated whole and handed to `EventStore.create` whole — so nine
 * columns would buy nothing a JSON blob does not already give.
 * `EventTemplateStore` validates every field on the way IN and on the way OUT,
 * which is where the shape is actually enforced; no `CHECK` here could express
 * any of it.
 *
 * What makes the payload survive time is the same discipline as a task
 * template's, said in the calendar's own units: **there is no date anywhere in
 * it.** A template saying "9 May, 14:00" rots the day after it is saved; one
 * saying "14:00, for ninety minutes" is still true next year, because a template
 * is applied ONTO a day the user is standing on. The recurrence rule is stored
 * unanchored for exactly that reason — it phases from the applied day, so a
 * weekly rule captured on a Tuesday becomes a Thursday series when applied to a
 * Thursday, which is what the user means by applying it there.
 *
 * The UNIQUE `(profile_id, name)` index makes the name the user-facing identity
 * of a template, exactly as it does for task and note templates: it is what
 * "saving under an existing name replaces it" relies on
 * (`EventTemplateStore.saveByName` is an upsert on this pair). There is no
 * rename and therefore no self-excluding collision statement: an event template
 * is captured FROM an event rather than edited in place, so renaming one is
 * saving it again under the new name — the same act by a different word.
 *
 * There is deliberately **no soft delete**, again following migrations 015 and
 * 027: nothing references a template (an event created from one keeps no link
 * back — it is an event like any other from the moment it exists), so deleting
 * one cannot orphan anything, and the undo is to save it again.
 */
export const migration036: Migration = {
  version: 36,
  up(db) {
    db.exec(`
      CREATE TABLE event_templates (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        payload     TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE UNIQUE INDEX event_templates_profile_name ON event_templates (profile_id, name);
    `);
  },
};

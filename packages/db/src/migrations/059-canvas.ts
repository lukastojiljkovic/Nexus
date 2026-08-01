import type { Migration } from "./migrations.js";

/**
 * Migration 59 — the CANV module's storage (CANV slice a). ONE table, and the
 * decisions that make it one are written here rather than left to the store.
 *
 * **A board is a name and a scene, and the scene lives in the same row.** The
 * obvious alternative — `canvas_boards` beside a `canvas_scenes` child — buys
 * nothing this module needs: a board has exactly one scene, always, so the
 * second table would be a one-to-one join whose only effect is that a board
 * could exist without a drawing. The reason a scene is usually split off is that
 * listing boards should not read every drawing, and that is answered by the
 * COLUMN LIST of the read instead: `CanvasStore.listActive` names the metadata
 * columns and never `scene`, so the blobs stay on disk until somebody opens one.
 *
 * **`scene` holds `serializeCanvasScene` output — canonical JSON — and nothing
 * else**, exactly as `habits.schedule` holds `serializeHabitSchedule` output and
 * `fin_recurring.recurrence` holds ADR-024's. No SQL CHECK can validate it
 * (migration 018's own note), so the store is the gate: it re-validates on the
 * way OUT as well as in, and a document that fails to parse there is corruption
 * — a hand-edited file, a bad restore — rather than input to coerce.
 *
 * The only CHECK the column carries is `length(scene) > 0`, which is not a
 * schema opinion about JSON but the one thing SQL genuinely can say: an empty
 * string is not a drawing, and a board with no scene at all is unrepresentable
 * rather than something every read has to defend against. The SIZE ceiling
 * (`MAX_CANVAS_SCENE_LENGTH`) is the store's, deliberately: it exists so an
 * embedded image can be REFUSED WITH A SENTENCE the page can show, and a raw
 * CHECK failure inside a transaction is exactly the illegible refusal that
 * ceiling was added to avoid.
 *
 * **`deleted_at` is the only lifecycle column, and there is no `archived_at`.**
 * Migration 055 gave habits two independent timestamps because a habit you have
 * finished with must keep answering the stats while leaving today's list — a
 * board has no such second question. Nothing is derived from a board over time;
 * it is either here or thrown away, and inventing an archived state would be a
 * distinction with no reader.
 *
 * **Plain `CREATE TABLE`, and the ADR-042 question is worth stating rather than
 * assumed.** At version 58 there is no `canvas_boards` table and nothing points
 * at one — its suite asserts exactly that before this migration runs — so there
 * is no rebuild to consider and no referenced parent to endanger. This table
 * becomes a referenced CHILD of `profiles` here and never a referenced parent,
 * so ADR-042's rule (a later column on a referenced parent lands by `ALTER TABLE
 * … ADD COLUMN`, never by a table rebuild, because `DROP TABLE`'s implicit
 * DELETE fires every `ON DELETE` action pointing at it while `PRAGMA
 * foreign_keys` is a no-op inside `runMigrations`' transaction) binds nothing
 * here — but it will bind the first migration that adds a column to
 * `canvas_boards` if anything ever comes to reference it.
 *
 * **One index, earned.** `canvas_boards_profile_active` covers the only board
 * read there is — „this profile's live boards, by name" — the shape
 * `habits_profile_active` and `fin_accounts_profile_active` already have. It
 * deliberately does NOT include `scene`: a covering index over the drawing would
 * duplicate every byte of it, which is the opposite of why the list read names
 * its columns.
 *
 * No UNIQUE on `(profile_id, name)`: two boards may share a name, exactly as two
 * notes or two tasks may. A board is identified by its id and opened from a
 * list, so a name collision is a thing the user can see and fix rather than a
 * write that fails under them.
 */
export const migration059: Migration = {
  version: 59,
  up(db) {
    db.exec(`
      CREATE TABLE canvas_boards (
        id         TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name       TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 60),
        -- Canonical serializeCanvasScene output. SQL can say only that there
        -- IS one; the store says what it must be (see the file doc).
        scene      TEXT NOT NULL CHECK (length(scene) > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      -- The only board read there is: "this profile's live boards, by name".
      -- No scene column here on purpose — see the file doc.
      CREATE INDEX canvas_boards_profile_active
        ON canvas_boards (profile_id, name, id)
        WHERE deleted_at IS NULL;
    `);
  },
};

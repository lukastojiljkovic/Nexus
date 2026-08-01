import type { Migration } from "./migrations.js";

/**
 * `focus_sessions` grows from STUDY's study-timer log into the ONE focus timer
 * this product has (UTIL slice a). The founder's rule: „nećemo da imamo više
 * tajmera, mislim da je to loše" — so a Pomodoro phase and a study session are
 * not two features with two tables, they are one table with a `kind`.
 *
 * **The unified concept: a focus session is a period of deliberate attention,
 * optionally planned, optionally attached to a subject or a task.** STUDY's
 * existing row is that sentence with `kind = 'work'`, no plan and a subject —
 * open-ended, exactly as it has always been, which is why every pre-existing row
 * copies across untouched and lands on the defaults declared here. A Pomodoro
 * phase is the same sentence with a plan, usually no subject, and a `kind` that
 * may say it is a break.
 *
 * **One row is one PHASE, not one cycle.** The honest unit for „koliko sam danas
 * fokusiran bio" is a stretch with a real start and a real end; a whole cycle
 * would have to model its own interruptions internally and its sum would stop
 * being checkable. `packages/core/src/focus/focusSession.ts` carries the argument
 * in full.
 *
 * **Migration 008's central decision STANDS: a RUNNING session is never a row.**
 * It lives as main-process runtime state, so a crash loses the in-progress timer
 * honestly instead of persisting a duration nobody observed. Everything that
 * decision makes unnecessary is deliberately absent here — no `paused_at`
 * column, no partial unique index over running rows, no stale-row reconciliation,
 * and no „abandoned" outcome, because there is no such thing as a stored phase
 * whose end nobody witnessed. `ended_at > started_at` is kept for exactly that
 * reason, and it is what makes every row a real, observed, positive duration —
 * so the history can be summed with no rule about which outcomes are allowed to
 * count.
 *
 * `paused_seconds` is a column all the same: pause time accumulates in memory
 * while the phase runs and is written ONCE, with the finished row, so the
 * recorded span excludes it. `started_at`/`ended_at` bound the phase in wall
 * time; `paused_seconds` is how much of that span was not attention.
 *
 * **`subject_id` loses `NOT NULL`, which is the whole reason this is a REBUILD.**
 * SQLite cannot drop a NOT NULL (or alter a CHECK), and a Pomodoro phase usually
 * belongs to no subject at all. Its `ON DELETE CASCADE` is kept exactly as it
 * was: that chain (profiles -> subjects -> focus_sessions) is migration 008's
 * documented arrangement and re-litigating it is not this migration's business.
 *
 * **`task_id` carries NO foreign key, deliberately, and `label` is a snapshot.**
 * Two reasons, both worth stating. A focus session is a historical fact about
 * time somebody actually spent, and it must survive the deletion of whatever it
 * pointed at — the half hour happened whether or not the task still exists, and a
 * cascade would quietly shrink a day the user remembers working. And a child row
 * on `tasks` would re-arm the hazard migration 038 documents at length: rebuilding
 * a referenced parent fires its children's `ON DELETE` actions inside a
 * transaction where `PRAGMA foreign_keys` is a no-op. `label` is what the session
 * was called at the time, so the history stays readable once the task is gone.
 * (`subject_id` keeps its key because it already had one and STUDY's stats read
 * through it; the asymmetry is deliberate, not an oversight.)
 *
 * **The simple create/copy/drop/rename is safe HERE specifically**, on migrations
 * 019/021/037/046's terms rather than 038's. `focus_sessions` is a pure CHILD:
 * verified at version 56, nothing in the schema declares `REFERENCES
 * focus_sessions`, and no view or trigger reads it. So the implicit `DELETE` that
 * `DROP TABLE` performs fires no foreign-key action and records no deferred
 * violation — which is exactly the condition 038's hold-table dance exists to
 * handle and this table does not need.
 *
 * `deleted_at` is copied across with everything else: a session the user deleted
 * and can still undo must stay deleted, and a rebuild that silently resurrected
 * it would be the quietest possible data bug.
 *
 * `focus_sessions_profile_started` is hand-recreated below — `DROP TABLE` takes a
 * table's indexes with it, and it is still the hot path („this profile's active
 * sessions in a date range"). No second index for the `kind` filter: every read
 * is already a profile+range scan, and the kind is a residual test over a handful
 * of rows a day.
 *
 * Values are INTEGERS, and the CHECKs say `typeof(x) = 'integer'` rather than
 * trusting INTEGER affinity — the FIN lesson (migration 051): SQLite converts a
 * REAL to an INTEGER only when the conversion is lossless, so `12.5` would sit
 * happily in an `INTEGER NOT NULL` column and every sum over it would be a float
 * from then on.
 */
export const migration057: Migration = {
  version: 57,
  up(db) {
    db.exec(`
      CREATE TABLE focus_sessions_new (
        id              TEXT PRIMARY KEY,
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        -- Nullable now: a Pomodoro phase usually belongs to no subject. The
        -- cascade is migration 008's, kept verbatim.
        subject_id      TEXT REFERENCES subjects(id) ON DELETE CASCADE,
        started_at      TEXT NOT NULL,
        ended_at        TEXT NOT NULL,
        kind            TEXT NOT NULL DEFAULT 'work'
                          CHECK (kind IN ('work', 'short_break', 'long_break')),
        -- NULL is an OPEN-ENDED session (STUDY's timer): it ran until it was
        -- stopped, so there is no plan for it to have met or missed.
        planned_minutes INTEGER
                          CHECK (planned_minutes IS NULL
                                 OR (typeof(planned_minutes) = 'integer' AND planned_minutes > 0)),
        paused_seconds  INTEGER NOT NULL DEFAULT 0
                          CHECK (typeof(paused_seconds) = 'integer' AND paused_seconds >= 0),
        -- No 'abandoned': a running phase is never a row, so no stored phase has
        -- an end nobody saw (see the file doc).
        outcome         TEXT CHECK (outcome IS NULL OR outcome IN ('completed', 'stopped')),
        cycle_index     INTEGER NOT NULL DEFAULT 0
                          CHECK (typeof(cycle_index) = 'integer' AND cycle_index >= 0),
        -- No REFERENCES, deliberately: the time was spent whether or not the task
        -- still exists, and a child row on \`tasks\` would re-arm 038's rebuild
        -- hazard. \`label\` is the snapshot that keeps the row readable afterwards.
        task_id         TEXT,
        label           TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        deleted_at      TEXT,
        CHECK (ended_at > started_at)
      );

      -- Every existing row is a completed, open-ended, subject-scoped work
      -- session; the new columns land on their defaults, which say exactly that.
      -- \`deleted_at\` rides along: an undoable delete stays deleted.
      INSERT INTO focus_sessions_new
        (id, profile_id, subject_id, started_at, ended_at, created_at, updated_at, deleted_at)
        SELECT id, profile_id, subject_id, started_at, ended_at, created_at, updated_at, deleted_at
          FROM focus_sessions ORDER BY rowid;

      DROP TABLE focus_sessions;
      ALTER TABLE focus_sessions_new RENAME TO focus_sessions;

      -- Recreated from 008: the drop took it with the table. Still the hot path.
      CREATE INDEX focus_sessions_profile_started
        ON focus_sessions (profile_id, started_at)
        WHERE deleted_at IS NULL;
    `);
  },
};

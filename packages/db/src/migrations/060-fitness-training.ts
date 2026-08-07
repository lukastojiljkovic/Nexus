import type { Migration } from "./migrations.js";

/**
 * The FIT module's training and body storage (ADR-081 slice b). Seven tables,
 * and — as with 055 and 058 — the decisions the module turns on are written
 * into the schema rather than left to a store to remember.
 *
 * **The exercise catalogue is again NOT a table.** Migration 058 said why for
 * foods and every word of it holds here: several hundred written entries ship
 * inside `@nexus/core` as JSON, so seeding them would put app data where user
 * data lives — an identical copy in every profile, in every export archive, and
 * faithfully reproduced by a restore as though somebody had typed it.
 * `fit_exercises` below is ONLY what the user added themselves.
 *
 * **Every reference OUT of this schema is text with no foreign key, carrying a
 * label beside it.** `exercise_ref` is `catalogue:<id>` or `user:<uuid>`, and
 * `routine_ref` is a routine id. The first names a row that is not a row at all;
 * the second may be soft-deleted, or renamed, while a logged session stays true.
 * A workout that happened is a fact about a day, exactly as a meal eaten is, so
 * the log must remain readable with nothing left to resolve against — which is
 * what `label` NOT NULL beside each ref is for.
 *
 * **`fit_workout_sets` snapshots `metric` and the muscles worked**, and this is
 * the same decision one layer deeper than 058's per-100 g snapshot. `metric`
 * decides what the four nullable numbers on a set MEAN (ADR-081 §3), and the
 * muscles decide which weekly total the set lands in. Both come from an entry
 * that ships with the app and can change on an update, or from a user's own
 * exercise they may edit tonight. A set re-interpreted by a later edit would not
 * be a corrected record; it would be arithmetic performed on a different lift.
 *
 * **`kind` is closed here, in the schema, because volume depends on it.** Only
 * `working` and the tail of a drop set count (ADR-081 §4), which is precisely
 * the defect ADR-077 hit when break phases became rows and every study
 * statistic silently inflated until all four reads were scoped. A `kind` outside
 * this list would be a row every volume read has to decide about, so it cannot
 * be written at all. `metric` is closed for the same reason, one step further:
 * an unknown metric makes a set's own numbers unreadable.
 *
 * `rir` is 0–5 and nullable — reps in reserve rather than RPE, because it is the
 * question a person can actually answer, and a field answered wrongly is worse
 * than one left empty.
 *
 * **What is NOT closed by a CHECK, deliberately:** `equipment`, `pattern` and
 * the muscle-group arrays. The first two are labels nothing computes on, and the
 * arrays are JSON, which SQLite cannot constrain. `@nexus/core`'s
 * `validateExerciseEntry` owns those vocabularies and the store runs it, so the
 * boundary is guarded — but a CHECK that pretended to guard them would have to
 * be edited in lockstep with a TypeScript union, which is a promise this file
 * cannot keep.
 *
 * **`fit_measurements` is one row per (profile, day) and says so with its
 * primary key.** ADR-081 §8a: a smart scale reports weight, fat, muscle and
 * water in a single step, so they are one reading rather than four. Only
 * `weight_kg` is NOT NULL — it is what makes the row an observation; the rest
 * are independently null because a bathroom scale gives one and a caliper gives
 * another, and NULL is „not measured", never zero. The percentage bounds are
 * arithmetic rather than judgement: a body cannot be 0 % or 100 % fat.
 *
 * `muscle_unit` and `muscle_value` travel together — a scale prints either
 * kilograms or a percentage, and normalising one into the other at entry would
 * store a number the app computed while making it look like one the device
 * measured. The CHECK makes „a unit with no value" unrepresentable rather than
 * merely unwritten.
 *
 * **`fit_body_profile` stores the BIRTH DATE, not the age.** Age is derived on a
 * reference day; storing „30" once means being wrong from the next birthday
 * onward, and it would be wrong silently, inside a BMR nobody would re-check.
 *
 * **ADR-042 hazard, and it is new here.** Unlike 058, this migration DOES create
 * referenced parents: `fit_routines` ← `fit_routine_items` and `fit_workouts` ←
 * `fit_workout_sets`, both `ON DELETE CASCADE`. A later migration that rebuilds
 * either parent by `DROP TABLE` would fire that cascade against the child —
 * `PRAGMA foreign_keys` being a no-op inside the migration transaction — and
 * delete every routine item or logged set in the database. Any future change to
 * those two tables lands by `ALTER TABLE … ADD COLUMN`, or drops the CHILD
 * first, deliberately, with the rows saved.
 *
 * **Indexes, all earned.** Actives-by-name on the three soft-deleting tables,
 * the shape `habits_profile_active` and `fit_foods_profile_active` already have.
 * Sessions by day, which is the only workout read. Sets by workout, which is how
 * a session is drawn. And sets by exercise, which is the read ADR-081 §6 calls
 * the whole reason anybody opens the app mid-set: „what did I do last time".
 * That last one is answered by JOINing to `fit_workouts` for the date rather
 * than by denormalising `workout_date` onto every set — a copied date drifts the
 * first time a session is re-dated, and a drifted date here is a lifting history
 * that quietly reorders itself.
 */
export const migration060: Migration = {
  version: 60,
  up(db) {
    db.exec(`
      CREATE TABLE fit_exercises (
        id                     TEXT PRIMARY KEY,
        profile_id             TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name                   TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 80),
        -- Empty is ordinary: „the lifting world writes RDL and hip thrust" is
        -- true of the catalogue, not of somebody's own accessory movement.
        name_en                TEXT NOT NULL,
        -- ["grudi","tricepsi"] — validated by @nexus/core, not by a CHECK that
        -- would have to be edited in lockstep with a TypeScript union.
        primary_muscles_json   TEXT NOT NULL,
        secondary_muscles_json TEXT NOT NULL,
        equipment              TEXT NOT NULL CHECK (length(equipment) > 0),
        pattern                TEXT NOT NULL CHECK (length(pattern) > 0),
        unilateral             INTEGER NOT NULL CHECK (unilateral IN (0, 1)),
        -- Closed: this decides what a set's four numbers mean.
        metric                 TEXT NOT NULL CHECK (metric IN (
                                 'weight_reps', 'reps', 'weighted_reps', 'assisted_reps',
                                 'time', 'weight_time', 'distance_time')),
        notes                  TEXT NOT NULL,
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL,
        deleted_at             TEXT
      );

      CREATE INDEX fit_exercises_profile_active
        ON fit_exercises (profile_id, name, id)
        WHERE deleted_at IS NULL;

      -- A routine is a SHAPE of a session and holds nothing about when
      -- (ADR-081 §6) — the same rule ADR-035's task templates run on.
      CREATE TABLE fit_routines (
        id         TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name       TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 80),
        notes      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX fit_routines_profile_active
        ON fit_routines (profile_id, name, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE fit_routine_items (
        id              TEXT PRIMARY KEY,
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        routine_id      TEXT NOT NULL REFERENCES fit_routines(id) ON DELETE CASCADE,
        position        INTEGER NOT NULL
                          CHECK (typeof(position) = 'integer' AND position >= 0),
        exercise_ref    TEXT NOT NULL CHECK (length(exercise_ref) > 0),
        label           TEXT NOT NULL CHECK (length(label) > 0),
        -- All three nullable: a routine may say „bench, as many sets as it
        -- takes" and mean it. NULL is „no target", never a target of zero.
        target_sets     INTEGER
                          CHECK (target_sets IS NULL
                                 OR (typeof(target_sets) = 'integer' AND target_sets > 0)),
        target_reps_min INTEGER
                          CHECK (target_reps_min IS NULL
                                 OR (typeof(target_reps_min) = 'integer' AND target_reps_min > 0)),
        target_reps_max INTEGER
                          CHECK (target_reps_max IS NULL
                                 OR (typeof(target_reps_max) = 'integer' AND target_reps_max > 0)),
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        -- A range that runs backwards is not a range. A single target is
        -- min = max, which this admits. Table-level, because it reads two
        -- columns — and every table constraint must follow the last column.
        CHECK (target_reps_min IS NULL OR target_reps_max IS NULL
               OR target_reps_min <= target_reps_max)
      );

      CREATE INDEX fit_routine_items_routine
        ON fit_routine_items (routine_id, position, id);

      CREATE TABLE fit_workouts (
        id            TEXT PRIMARY KEY,
        profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        workout_date  TEXT NOT NULL,
        started_at    TEXT NOT NULL,
        -- NULL while the session is open. A session is finished by a deliberate
        -- act, and „still going" is a state the surface has to be able to show.
        ended_at      TEXT,
        -- The routine it was started from, by id and with no foreign key, plus
        -- the name it had at the time. Empty label = an ad-hoc session.
        routine_ref   TEXT,
        routine_label TEXT NOT NULL,
        notes         TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        deleted_at    TEXT
      );

      CREATE INDEX fit_workouts_profile_day
        ON fit_workouts (profile_id, workout_date, started_at, id)
        WHERE deleted_at IS NULL;

      -- A session is the one you are IN. Two open at once is not a state the
      -- product has: every set is logged into „the current workout", so a
      -- second open session would make that phrase ambiguous and the surface
      -- would have to ask which one — a question with no good answer. Stated as
      -- a UNIQUE partial index rather than checked by a store, so the class is
      -- unrepresentable instead of merely unwritten. Back-dating still works:
      -- an old session is opened, filled and finished, one at a time.
      CREATE UNIQUE INDEX fit_workouts_profile_open
        ON fit_workouts (profile_id)
        WHERE ended_at IS NULL AND deleted_at IS NULL;

      CREATE TABLE fit_workout_sets (
        id                   TEXT PRIMARY KEY,
        profile_id           TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        workout_id           TEXT NOT NULL REFERENCES fit_workouts(id) ON DELETE CASCADE,
        position             INTEGER NOT NULL
                               CHECK (typeof(position) = 'integer' AND position >= 0),
        exercise_ref         TEXT NOT NULL CHECK (length(exercise_ref) > 0),
        label                TEXT NOT NULL CHECK (length(label) > 0),
        -- Snapshotted with the set: both decide how this row is READ later.
        metric               TEXT NOT NULL CHECK (metric IN (
                               'weight_reps', 'reps', 'weighted_reps', 'assisted_reps',
                               'time', 'weight_time', 'distance_time')),
        primary_muscles_json TEXT NOT NULL,
        -- Closed, because volume is scoped by it from the first commit.
        kind                 TEXT NOT NULL
                               CHECK (kind IN ('warmup', 'working', 'drop', 'failure')),
        -- Four nullable numbers; the metric column says which of them mean
        -- anything, and it is snapshotted just above for exactly that reason. For
        -- 'assisted_reps' the weight is the assistance SUBTRACTED, which is a
        -- magnitude and so still non-negative.
        weight_kg            REAL CHECK (weight_kg IS NULL OR weight_kg >= 0),
        reps                 INTEGER
                               CHECK (reps IS NULL
                                      OR (typeof(reps) = 'integer' AND reps >= 0)),
        seconds              REAL CHECK (seconds IS NULL OR seconds >= 0),
        distance_m           REAL CHECK (distance_m IS NULL OR distance_m >= 0),
        rir                  INTEGER
                               CHECK (rir IS NULL
                                      OR (typeof(rir) = 'integer' AND rir >= 0 AND rir <= 5)),
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL
      );

      -- How a session is drawn.
      CREATE INDEX fit_workout_sets_workout
        ON fit_workout_sets (workout_id, position, id);

      -- „What did I do last time?" — the read the module exists for. The DATE
      -- comes from the join to fit_workouts, never from a copy kept here.
      CREATE INDEX fit_workout_sets_profile_exercise
        ON fit_workout_sets (profile_id, exercise_ref, workout_id);

      CREATE TABLE fit_measurements (
        profile_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        day              TEXT NOT NULL,
        -- The only required number: it is what makes the row an observation.
        weight_kg        REAL NOT NULL
                           CHECK (weight_kg > 0 AND weight_kg <= 500),
        body_fat_percent REAL
                           CHECK (body_fat_percent IS NULL
                                  OR (body_fat_percent > 0 AND body_fat_percent < 100)),
        -- The unit a scale PRINTED, kept verbatim beside its value. Both null or
        -- both set; a unit with no reading is not a state this table has.
        muscle_unit      TEXT CHECK (muscle_unit IS NULL OR muscle_unit IN ('percent', 'kg')),
        muscle_value     REAL CHECK (muscle_value IS NULL OR muscle_value > 0),
        water_percent    REAL
                           CHECK (water_percent IS NULL
                                  OR (water_percent > 0 AND water_percent < 100)),
        -- The six tape sites @nexus/core names, in its own head-to-foot order.
        neck_cm          REAL CHECK (neck_cm IS NULL OR (neck_cm > 0 AND neck_cm <= 300)),
        chest_cm         REAL CHECK (chest_cm IS NULL OR (chest_cm > 0 AND chest_cm <= 300)),
        upper_arm_cm     REAL CHECK (upper_arm_cm IS NULL OR (upper_arm_cm > 0 AND upper_arm_cm <= 300)),
        waist_cm         REAL CHECK (waist_cm IS NULL OR (waist_cm > 0 AND waist_cm <= 300)),
        hip_cm           REAL CHECK (hip_cm IS NULL OR (hip_cm > 0 AND hip_cm <= 300)),
        thigh_cm         REAL CHECK (thigh_cm IS NULL OR (thigh_cm > 0 AND thigh_cm <= 300)),
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        -- Both null or both set: a unit with no reading is not a state this
        -- table has. Table-level, so it must follow the last column.
        CHECK ((muscle_unit IS NULL) = (muscle_value IS NULL)),
        -- One reading per day, stated by the key rather than enforced by a store.
        PRIMARY KEY (profile_id, day)
      );

      CREATE TABLE fit_body_profile (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        -- NULL is „not given", never „unknown, assume male": its absence closes
        -- the Mifflin–St Jeor tier and the surface reports that rather than
        -- guessing a sex term.
        sex        TEXT CHECK (sex IS NULL OR sex IN ('male', 'female')),
        birth_date TEXT NOT NULL,
        height_cm  REAL NOT NULL CHECK (height_cm >= 50 AND height_cm <= 260),
        activity   TEXT NOT NULL CHECK (activity IN (
                     'sedentary', 'light', 'moderate', 'active', 'very-active')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
};

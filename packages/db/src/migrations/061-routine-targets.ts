import type { Migration } from "./migrations.js";

/**
 * Migration 61 — a routine can finally prescribe what a set can record.
 *
 * THE DEFECT THIS CLOSES. Migration 060 gave `fit_workout_sets` four nullable
 * numbers — `weight_kg`, `reps`, `seconds`, `distance_m` — and made `metric`
 * decide which of them a given exercise means (ADR-081 §3). The logging surface
 * honours that: it reads one table, `SET_FIELDS`, and draws the fields the
 * metric asks for.
 *
 * `fit_routine_items` was given only `target_sets`, `target_reps_min` and
 * `target_reps_max`. So a routine could prescribe reps and nothing else — and
 * three of the seven metrics (`time`, `weight_time`, `distance_time`) have no
 * reps at all. A plank in a routine could be told „3 sets of 12 reps" and could
 * not be told how many SECONDS to hold, which is the only number it has. The
 * plan could not express the session the app was perfectly able to record.
 *
 * The four columns below restore the symmetry: a routine item's targets are now
 * exactly the shape of the set it prescribes, and the same `SET_FIELDS` table
 * decides which ones a form offers. One table, two readers — rather than a
 * second, quieter answer to „what does this exercise record" living in a form.
 *
 * WHY THESE ARE SINGLE VALUES WHERE REPS IS A RANGE. Reps are programmed as a
 * range because the last rep is a judgement („8–12, stop when form goes"). A
 * hold, a load and a distance are programmed as a number: „60 seconds", „80 kg",
 * „400 m". Adding min/max to all three would be symmetry for its own sake, and
 * every extra field is one more thing to leave blank.
 *
 * `rest_seconds` is per ITEM, not per session. The training surface has been
 * running one rest timer for the whole workout, which is wrong for any routine
 * that mixes a heavy compound with an accessory — the pattern the whole
 * `pattern` column exists to describe. NULL means „use the session default",
 * so nothing changes for a routine that does not care.
 *
 * All four are nullable with no default. A routine that says nothing about a
 * number still says nothing about it — an absent target is not a target of
 * zero, and the CHECKs below are written `IS NULL OR …` so that stays true and
 * so the existing rows satisfy them at the moment they are added.
 */
export const migration061: Migration = {
  version: 61,
  up(db) {
    db.exec(`
      -- Mirrors fit_workout_sets.seconds (REAL): a hold is not an integer
      -- number of seconds any more than a lift is an integer number of kilos.
      ALTER TABLE fit_routine_items ADD COLUMN target_seconds REAL
        CHECK (target_seconds IS NULL OR target_seconds > 0);

      -- Mirrors fit_workout_sets.weight_kg, including its >= 0 floor: an
      -- assisted exercise stores the ASSISTANCE here as a positive number and
      -- the surface writes the minus, so a negative value would be a second
      -- encoding of the same fact.
      ALTER TABLE fit_routine_items ADD COLUMN target_weight_kg REAL
        CHECK (target_weight_kg IS NULL OR target_weight_kg >= 0);

      ALTER TABLE fit_routine_items ADD COLUMN target_distance_m REAL
        CHECK (target_distance_m IS NULL OR target_distance_m > 0);

      -- Zero is meaningful and distinct from NULL: „no rest, straight into the
      -- next set" is a real prescription (a superset), while NULL is „this
      -- routine has no opinion, use the session default".
      --
      -- The 600 ceiling is NOT arbitrary — it is MAX_FIT_REST_SECONDS, the
      -- range the rest timer itself accepts. A routine that could store 900
      -- would be a routine able to prescribe a rest the app then refuses to
      -- run, and the refusal would surface a full session later, on the set
      -- where it mattered. Zero is the one value below the timer's own floor
      -- that is allowed, because it does not start a timer at all.
      ALTER TABLE fit_routine_items ADD COLUMN rest_seconds INTEGER
        CHECK (rest_seconds IS NULL
               OR (typeof(rest_seconds) = 'integer' AND rest_seconds >= 0 AND rest_seconds <= 600));
    `);
  },
};

import type Database from "better-sqlite3-multiple-ciphers";
import { EXERCISE_METRICS, MAX_EXERCISE_REF_LENGTH, MUSCLE_GROUPS, SET_KINDS, parseExerciseRef } from "@nexus/core";
import type { ExerciseMetric, MuscleGroup, SetKind } from "@nexus/core";
import { FitSetNotFoundError, FitWorkoutNotFoundError, FitWorkoutValidationError, isUniqueConstraintViolation } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { parseMuscleList } from "./muscleJson.js";
import { isBareDate, isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

const MAX_ROUTINE_REF_LENGTH = 200;
const MAX_ROUTINE_LABEL_LENGTH = 80;
/** What a session's own note may hold. Exported because `shared/ipc.ts` mirrors it, and a mirror of a private number is a number that drifts. */
export const MAX_FIT_WORKOUT_NOTES_LENGTH = 500;
const MAX_SET_LABEL_LENGTH = 80;

/** How many refs `lastPerformed` will resolve in one call — a picker warming up a session, not a bulk export. */
export const MAX_FIT_LAST_PERFORMED_REFS = 200;

export interface FitWorkoutSet {
  id: string;
  workoutId: string;
  position: number;
  exerciseRef: string;
  label: string;
  metric: ExerciseMetric;
  primaryMuscles: MuscleGroup[];
  kind: SetKind;
  weightKg: number | null;
  reps: number | null;
  seconds: number | null;
  distanceM: number | null;
  rir: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FitWorkout {
  id: string;
  profileId: string;
  day: string;
  startedAt: string;
  endedAt: string | null;
  routineRef: string | null;
  routineLabel: string;
  notes: string;
  /** In stored position order. */
  sets: FitWorkoutSet[];
  createdAt: string;
  updatedAt: string;
}

export interface StartFitWorkoutInput {
  day: string;
  routineRef?: string | null;
  routineLabel?: string;
  notes?: string;
}

export interface LogFitSetInput {
  exerciseRef: string;
  label: string;
  metric: ExerciseMetric;
  primaryMuscles: readonly MuscleGroup[];
  kind: SetKind;
  weightKg?: number | null;
  reps?: number | null;
  seconds?: number | null;
  distanceM?: number | null;
  rir?: number | null;
}

/** A partial patch to a logged set. Never the exercise, label, metric or muscles — those are the snapshot, and changing them would be logging a different set while keeping this one's identity (`FitMealStore.UpdateMealItemFields`'s rule). */
export interface UpdateFitSetFields {
  kind?: SetKind;
  weightKg?: number | null;
  reps?: number | null;
  seconds?: number | null;
  distanceM?: number | null;
  rir?: number | null;
}

export interface UpdateFitWorkoutFields {
  day?: string;
  notes?: string;
}

/** The last session in which this exercise was performed, and what was done in it. */
export interface FitLastPerformed {
  exerciseRef: string;
  day: string;
  workoutId: string;
  /** Every set of this exercise logged in that session, in position order. */
  sets: FitWorkoutSet[];
}

interface WorkoutRow {
  id: string;
  profile_id: string;
  workout_date: string;
  started_at: string;
  ended_at: string | null;
  routine_ref: string | null;
  routine_label: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface WorkoutSetRow {
  id: string;
  workout_id: string;
  position: number;
  exercise_ref: string;
  label: string;
  metric: string;
  primary_muscles_json: string;
  kind: string;
  weight_kg: number | null;
  reps: number | null;
  seconds: number | null;
  distance_m: number | null;
  rir: number | null;
  created_at: string;
  updated_at: string;
}

interface LastPerformedRow extends WorkoutSetRow {
  day: string;
}

const WORKOUT_COLUMNS =
  "id, profile_id, workout_date, started_at, ended_at, routine_ref, routine_label, notes, created_at, updated_at";
const SET_COLUMNS =
  "id, workout_id, position, exercise_ref, label, metric, primary_muscles_json, kind, " +
  "weight_kg, reps, seconds, distance_m, rir, created_at, updated_at";

/**
 * A profile's logged training sessions (FIT training, migration 060), over
 * prepared, parameterized statements (SEC-API-03). Construct one per profile
 * and reuse it; every statement — a workout, its sets, and every lookup
 * between them — is scoped by `profile_id`.
 *
 * **One open session per profile is enforced by the SCHEMA**, not by this
 * store: `fit_workouts_profile_open` is a UNIQUE partial index on
 * `(profile_id) WHERE ended_at IS NULL AND deleted_at IS NULL`. `start` and
 * `reopen` still catch the resulting `SQLITE_CONSTRAINT_UNIQUE` and translate
 * it into `FitWorkoutValidationError` — `PlanStore.restore`'s arrangement for
 * its own partial-unique index — so a caller sees a sentence rather than a
 * raw driver error; the index remains the thing that makes a second open
 * session actually impossible, this store is only the message. `restore` gets
 * the same translation, because resurrecting a soft-deleted OPEN workout can
 * collide with a session opened in the meantime exactly as `reopen` can.
 *
 * **`lastPerformed` is ONE query for every ref it is given.** ADR-081 §6 names
 * this the read the module exists for, so it cannot cost one round trip per
 * exercise on a screen showing several. A ref that is currently open (no
 * finished workout named it, or every one that did is not strictly before the
 * open session) is simply absent from the answer — there is no „never
 * performed" value in `FitLastPerformed` to hand back.
 *
 * **`removeSet` is a HARD delete, unlike everything else in this module.**
 * `FitMeasurementStore`'s reasoning restated for a set: an unlogged rep range
 * is a typo, not history, and the survivors are renumbered contiguously in the
 * same transaction so `position` keeps meaning „this session's order" rather
 * than growing a hole.
 */
export class FitWorkoutStore {
  private readonly insertWorkout: Database.Statement;
  private readonly selectWorkoutById: Database.Statement;
  private readonly selectOpenWorkout: Database.Statement;
  private readonly updateFinish: Database.Statement;
  private readonly updateReopen: Database.Statement;
  private readonly updateWorkoutFields: Database.Statement;
  private readonly markWorkoutDeleted: Database.Statement;
  private readonly markWorkoutRestored: Database.Statement;
  private readonly selectByDay: Database.Statement;
  private readonly selectByRange: Database.Statement;
  private readonly selectSetsByWorkout: Database.Statement;
  private readonly insertSet: Database.Statement;
  private readonly countSetsForWorkout: Database.Statement;
  private readonly selectSetById: Database.Statement;
  private readonly updateSetFields: Database.Statement;
  private readonly deleteSet: Database.Statement;
  private readonly updateSetPosition: Database.Statement;
  private readonly lastPerformedStatements = new Map<string, Database.Statement>();

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertWorkout = db.prepare(
      `INSERT INTO fit_workouts
         (id, profile_id, workout_date, started_at, ended_at, routine_ref, routine_label, notes,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectWorkoutById = db.prepare(
      `SELECT ${WORKOUT_COLUMNS} FROM fit_workouts
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectOpenWorkout = db.prepare(
      `SELECT ${WORKOUT_COLUMNS} FROM fit_workouts
       WHERE profile_id = ? AND ended_at IS NULL AND deleted_at IS NULL`,
    );
    this.updateFinish = db.prepare(
      `UPDATE fit_workouts SET ended_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND ended_at IS NULL AND deleted_at IS NULL`,
    );
    this.updateReopen = db.prepare(
      `UPDATE fit_workouts SET ended_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND ended_at IS NOT NULL AND deleted_at IS NULL`,
    );
    this.updateWorkoutFields = db.prepare(
      `UPDATE fit_workouts SET workout_date = ?, notes = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markWorkoutDeleted = db.prepare(
      `UPDATE fit_workouts SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markWorkoutRestored = db.prepare(
      `UPDATE fit_workouts SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.selectByDay = db.prepare(
      `SELECT ${WORKOUT_COLUMNS} FROM fit_workouts
        WHERE profile_id = ? AND workout_date = ? AND deleted_at IS NULL
        ORDER BY started_at, id`,
    );
    this.selectByRange = db.prepare(
      `SELECT ${WORKOUT_COLUMNS} FROM fit_workouts
        WHERE profile_id = ? AND workout_date >= ? AND workout_date <= ? AND deleted_at IS NULL
        ORDER BY workout_date, started_at, id`,
    );
    this.selectSetsByWorkout = db.prepare(
      `SELECT ${SET_COLUMNS} FROM fit_workout_sets
        WHERE workout_id = ? AND profile_id = ?
        ORDER BY position, id`,
    );
    this.insertSet = db.prepare(
      `INSERT INTO fit_workout_sets
         (id, profile_id, workout_id, position, exercise_ref, label, metric, primary_muscles_json,
          kind, weight_kg, reps, seconds, distance_m, rir, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.countSetsForWorkout = db.prepare(
      `SELECT COUNT(*) AS n FROM fit_workout_sets WHERE workout_id = ? AND profile_id = ?`,
    );
    this.selectSetById = db.prepare(
      `SELECT ${SET_COLUMNS} FROM fit_workout_sets WHERE id = ? AND profile_id = ?`,
    );
    this.updateSetFields = db.prepare(
      `UPDATE fit_workout_sets
         SET kind = ?, weight_kg = ?, reps = ?, seconds = ?, distance_m = ?, rir = ?, updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    );
    this.deleteSet = db.prepare(`DELETE FROM fit_workout_sets WHERE id = ? AND profile_id = ?`);
    this.updateSetPosition = db.prepare(
      `UPDATE fit_workout_sets SET position = ? WHERE id = ? AND profile_id = ?`,
    );
  }

  /** Opens a new session. Refuses when one is already open in this profile — the schema's own `fit_workouts_profile_open` index, translated into a readable error. */
  start(input: StartFitWorkoutInput, now: string): FitWorkout {
    const validNow = validateNow(now);
    const day = validateDay(input.day, "day");
    const routineRef = validateRoutineRef(input.routineRef ?? null);
    const routineLabel = validateRoutineLabel(input.routineLabel ?? "");
    const notes = validateNotes(input.notes ?? "");
    const id = uuidv7();

    try {
      this.insertWorkout.run(
        id, this.profileId, day, validNow, routineRef, routineLabel, notes, validNow, validNow,
      );
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new FitWorkoutValidationError(
          "A session is already open in this profile; finish it before starting another.",
        );
      }
      throw error;
    }

    return {
      id, profileId: this.profileId, day, startedAt: validNow, endedAt: null,
      routineRef, routineLabel, notes, sets: [], createdAt: validNow, updatedAt: validNow,
    };
  }

  /** The one unfinished session in this profile, or `null`. */
  open(): FitWorkout | null {
    const row = this.selectOpenWorkout.get(this.profileId) as WorkoutRow | undefined;
    return row === undefined ? null : this.toWorkout(row);
  }

  /** One live workout in this profile, with its sets in position order, or throws. */
  get(id: string): FitWorkout {
    return this.requireWorkout(id);
  }

  /** Closes a session. Refuses a session that is already finished. */
  finish(id: string, now: string): FitWorkout {
    const validNow = validateNow(now);
    const current = this.requireWorkout(id);
    if (current.endedAt !== null) {
      throw new FitWorkoutValidationError(`Workout "${id}" is already finished.`);
    }
    this.updateFinish.run(validNow, validNow, id, this.profileId);
    return this.requireWorkout(id);
  }

  /** Reopens a finished session — back-dating one at a time. Refuses a session that is already open, and refuses when another session is open, the same schema index `start` leans on. */
  reopen(id: string, now: string): FitWorkout {
    const validNow = validateNow(now);
    const current = this.requireWorkout(id);
    if (current.endedAt === null) {
      throw new FitWorkoutValidationError(`Workout "${id}" is already open.`);
    }
    try {
      this.updateReopen.run(validNow, id, this.profileId);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new FitWorkoutValidationError(
          `Cannot reopen workout "${id}": another session is already open in this profile.`,
        );
      }
      throw error;
    }
    return this.requireWorkout(id);
  }

  /** Corrects the session's own day or notes — never its sets, which go through `logSet`/`updateSet`/`removeSet`. */
  updateWorkout(id: string, fields: UpdateFitWorkoutFields, now: string): FitWorkout {
    const validNow = validateNow(now);
    const current = this.requireWorkout(id);
    const day = fields.day === undefined ? current.day : validateDay(fields.day, "day");
    const notes = fields.notes === undefined ? current.notes : validateNotes(fields.notes);

    this.updateWorkoutFields.run(day, notes, validNow, id, this.profileId);
    return { ...current, day, notes, updatedAt: validNow };
  }

  /** Soft-deletes a live workout (reversible via `restore`); its sets stay attached and reappear with it. */
  remove(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markWorkoutDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new FitWorkoutNotFoundError(`No live workout "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted workout. Refuses when it was open at the moment it was deleted AND another session has since been opened — the same collision `reopen` refuses, for the same schema index. */
  restore(id: string, now: string): void {
    const validNow = validateNow(now);
    try {
      const { changes } = this.markWorkoutRestored.run(validNow, id, this.profileId);
      if (changes === 0) {
        throw new FitWorkoutNotFoundError(`No deleted workout "${id}" to restore in this profile.`);
      }
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new FitWorkoutValidationError(
          `Cannot restore workout "${id}": it would resurrect a second open session in this profile.`,
        );
      }
      throw error;
    }
  }

  /** Every live workout of one day, ordered by when it was started. */
  listByDay(day: string): FitWorkout[] {
    const validDay = validateDay(day, "day");
    const rows = this.selectByDay.all(this.profileId, validDay) as WorkoutRow[];
    return rows.map((row) => this.toWorkout(row));
  }

  /** Every live workout in an inclusive day span, ascending. */
  listRange(fromDay: string, toDay: string): FitWorkout[] {
    const from = validateDay(fromDay, "fromDay");
    const to = validateDay(toDay, "toDay");
    if (from > to) {
      throw new FitWorkoutValidationError(`"fromDay" must not be after "toDay".`);
    }
    const rows = this.selectByRange.all(this.profileId, from, to) as WorkoutRow[];
    return rows.map((row) => this.toWorkout(row));
  }

  /** Appends a set at the end of a workout's own order. */
  logSet(workoutId: string, input: LogFitSetInput, now: string): FitWorkoutSet {
    const validNow = validateNow(now);
    this.requireWorkout(workoutId);

    const exerciseRef = validateExerciseRef(input.exerciseRef);
    const label = validateSetLabel(input.label);
    const metric = validateMetric(input.metric);
    const primaryMuscles = validateMuscleList(input.primaryMuscles);
    const kind = validateKind(input.kind);
    const weightKg = validateNonNegativeOrNull(input.weightKg, "weightKg");
    const reps = validateNonNegativeIntOrNull(input.reps, "reps");
    const seconds = validateNonNegativeOrNull(input.seconds, "seconds");
    const distanceM = validateNonNegativeOrNull(input.distanceM, "distanceM");
    const rir = validateRir(input.rir);

    const { n } = this.countSetsForWorkout.get(workoutId, this.profileId) as { n: number };
    const id = uuidv7();

    this.insertSet.run(
      id, this.profileId, workoutId, n, exerciseRef, label, metric,
      JSON.stringify(primaryMuscles), kind, weightKg, reps, seconds, distanceM, rir,
      validNow, validNow,
    );

    return {
      id, workoutId, position: n, exerciseRef, label, metric, primaryMuscles, kind,
      weightKg, reps, seconds, distanceM, rir, createdAt: validNow, updatedAt: validNow,
    };
  }

  /** Corrects a logged set's numbers, kind or RIR — never the exercise, label, metric or muscles it was logged with. */
  updateSet(setId: string, fields: UpdateFitSetFields, now: string): FitWorkoutSet {
    const validNow = validateNow(now);
    const current = this.requireSet(setId);
    const kind = fields.kind === undefined ? current.kind : validateKind(fields.kind);
    const weightKg =
      fields.weightKg === undefined ? current.weightKg : validateNonNegativeOrNull(fields.weightKg, "weightKg");
    const reps =
      fields.reps === undefined ? current.reps : validateNonNegativeIntOrNull(fields.reps, "reps");
    const seconds =
      fields.seconds === undefined ? current.seconds : validateNonNegativeOrNull(fields.seconds, "seconds");
    const distanceM =
      fields.distanceM === undefined
        ? current.distanceM
        : validateNonNegativeOrNull(fields.distanceM, "distanceM");
    const rir = fields.rir === undefined ? current.rir : validateRir(fields.rir);

    this.updateSetFields.run(kind, weightKg, reps, seconds, distanceM, rir, validNow, setId, this.profileId);
    return { ...current, kind, weightKg, reps, seconds, distanceM, rir, updatedAt: validNow };
  }

  /** Hard-deletes a set — an unlogged set is a typo, not history — then closes the position gap in the same transaction. */
  removeSet(setId: string): void {
    const current = this.requireSet(setId);
    this.db.transaction((): void => {
      this.deleteSet.run(setId, this.profileId);
      const survivors = this.selectSetsByWorkout.all(current.workoutId, this.profileId) as WorkoutSetRow[];
      survivors.forEach((row, index) => {
        if (row.position === index) return;
        this.updateSetPosition.run(index, row.id, this.profileId);
      });
    })();
  }

  /**
   * The last FINISHED session that logged each ref, and every set of it —
   * ONE query for the whole list, not one per ref (ADR-081 §6). Duplicate refs
   * are answered once; a ref nothing was ever logged under is simply absent.
   * `[]` for `[]`, with no query run.
   */
  lastPerformed(exerciseRefs: readonly string[]): FitLastPerformed[] {
    if (!Array.isArray(exerciseRefs)) {
      throw new FitWorkoutValidationError(`"exerciseRefs" must be an array.`);
    }
    if (exerciseRefs.length > MAX_FIT_LAST_PERFORMED_REFS) {
      throw new FitWorkoutValidationError(
        `"exerciseRefs" must name at most ${MAX_FIT_LAST_PERFORMED_REFS} entries (got ${exerciseRefs.length}).`,
      );
    }
    const refs = [...new Set(exerciseRefs)];
    if (refs.length === 0) return [];

    const open = this.selectOpenWorkout.get(this.profileId) as WorkoutRow | undefined;
    const statement = this.lastPerformedStatementFor(refs.length, open !== undefined);
    const params: unknown[] = [this.profileId];
    if (open !== undefined) {
      params.push(open.workout_date, open.started_at, open.id);
    }
    params.push(...refs);

    const rows = statement.all(...params) as LastPerformedRow[];

    const byRef = new Map<string, FitLastPerformed>();
    for (const row of rows) {
      const set = toSet(row);
      const entry = byRef.get(row.exercise_ref);
      if (entry === undefined) {
        byRef.set(row.exercise_ref, {
          exerciseRef: row.exercise_ref, day: row.day, workoutId: row.workout_id, sets: [set],
        });
      } else {
        entry.sets.push(set);
      }
    }
    return refs.map((ref) => byRef.get(ref)).filter((entry): entry is FitLastPerformed => entry !== undefined);
  }

  /**
   * One SQL statement for a given ref-count / open-session shape, cached —
   * `CanvasStore.refStatementFor`'s exact reason: the COUNT is interpolated
   * (bounded by `MAX_FIT_LAST_PERFORMED_REFS` above, never caller text) and
   * indexes a bounded cache rather than re-preparing the statement text on
   * every call. Finds, per exercise ref, the FINISHED, non-deleted workout with
   * the latest `(workout_date, started_at, id)` among those strictly before the
   * currently open session (when there is one), then returns every one of that
   * winning workout's sets for that ref.
   */
  private lastPerformedStatementFor(count: number, hasOpenBoundary: boolean): Database.Statement {
    const key = `${count}:${hasOpenBoundary}`;
    const cached = this.lastPerformedStatements.get(key);
    if (cached) return cached;

    const boundaryClause = hasOpenBoundary
      ? "AND (fw.workout_date, fw.started_at, fw.id) < (?, ?, ?)"
      : "";
    const placeholders = Array(count).fill("?").join(", ");

    const statement = this.db.prepare(`
      WITH candidates AS (
        SELECT s.id, s.workout_id, s.position, s.exercise_ref, s.label, s.metric,
               s.primary_muscles_json, s.kind, s.weight_kg, s.reps, s.seconds, s.distance_m, s.rir,
               s.created_at, s.updated_at, fw.workout_date AS day, fw.started_at AS w_started_at
          FROM fit_workout_sets s
          JOIN fit_workouts fw ON fw.id = s.workout_id
         WHERE s.profile_id = ?
           AND fw.deleted_at IS NULL
           AND fw.ended_at IS NOT NULL
           ${boundaryClause}
           AND s.exercise_ref IN (${placeholders})
      ),
      winners AS (
        SELECT exercise_ref, workout_id,
               ROW_NUMBER() OVER (
                 PARTITION BY exercise_ref
                 ORDER BY day DESC, w_started_at DESC, workout_id DESC
               ) AS rn
          FROM (SELECT DISTINCT exercise_ref, workout_id, day, w_started_at FROM candidates)
      )
      SELECT c.id, c.workout_id, c.position, c.exercise_ref, c.label, c.metric,
             c.primary_muscles_json, c.kind, c.weight_kg, c.reps, c.seconds, c.distance_m, c.rir,
             c.created_at, c.updated_at, c.day
        FROM candidates c
        JOIN winners w ON w.exercise_ref = c.exercise_ref AND w.workout_id = c.workout_id AND w.rn = 1
       ORDER BY c.exercise_ref, c.position
    `);
    this.lastPerformedStatements.set(key, statement);
    return statement;
  }

  private toWorkout(row: WorkoutRow): FitWorkout {
    const rows = this.selectSetsByWorkout.all(row.id, this.profileId) as WorkoutSetRow[];
    return {
      id: row.id,
      profileId: row.profile_id,
      day: row.workout_date,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      routineRef: row.routine_ref,
      routineLabel: row.routine_label,
      notes: row.notes,
      sets: rows.map((setRow) => toSet(setRow)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private requireWorkout(id: string): FitWorkout {
    const row = this.selectWorkoutById.get(id, this.profileId) as WorkoutRow | undefined;
    if (!row) {
      throw new FitWorkoutNotFoundError(`No live workout "${id}" in this profile.`);
    }
    return this.toWorkout(row);
  }

  /** The gate every set reference goes through: live, AND its owning workout is live in this profile — a set of a soft-deleted workout is invisible until the workout is restored. */
  private requireSet(id: string): FitWorkoutSet {
    const row = this.selectSetById.get(id, this.profileId) as WorkoutSetRow | undefined;
    if (!row) {
      throw new FitSetNotFoundError(`No set "${id}" in this profile.`);
    }
    const workout = this.selectWorkoutById.get(row.workout_id, this.profileId) as WorkoutRow | undefined;
    if (!workout) {
      throw new FitSetNotFoundError(`No set "${id}" in this profile.`);
    }
    return toSet(row);
  }
}

function toSet(row: WorkoutSetRow): FitWorkoutSet {
  return {
    id: row.id,
    workoutId: row.workout_id,
    position: row.position,
    exerciseRef: row.exercise_ref,
    label: row.label,
    metric: row.metric as ExerciseMetric,
    primaryMuscles: parseStoredMuscles(row.primary_muscles_json, row.id),
    kind: row.kind as SetKind,
    weightKg: row.weight_kg,
    reps: row.reps,
    seconds: row.seconds,
    distanceM: row.distance_m,
    rir: row.rir,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Reads a stored set's muscle-list column back; a value that fails to parse to an array of known muscle groups is corruption, `FitExerciseStore.parseStoredMuscles`'s posture applied to a logged set's own snapshot. */
function parseStoredMuscles(text: string, setId: string): MuscleGroup[] {
  const parsed = parseMuscleList(text);
  if (parsed === null) {
    throw new FitWorkoutValidationError(
      `Set "${setId}" carries primary muscles that are not a list of known muscle groups.`,
    );
  }
  return parsed;
}

function validateDay(value: string, field: string): string {
  if (!isBareDate(value)) {
    throw new FitWorkoutValidationError(`"${field}" must be a real bare date (YYYY-MM-DD).`);
  }
  return value;
}

function validateRoutineRef(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ROUTINE_REF_LENGTH) {
    throw new FitWorkoutValidationError(
      `"routineRef" must be null or a non-empty string of at most ${MAX_ROUTINE_REF_LENGTH} characters.`,
    );
  }
  return value;
}

function validateRoutineLabel(value: string): string {
  if (typeof value !== "string" || value.length > MAX_ROUTINE_LABEL_LENGTH) {
    throw new FitWorkoutValidationError(
      `"routineLabel" must be a string of at most ${MAX_ROUTINE_LABEL_LENGTH} characters.`,
    );
  }
  return value;
}

function validateNotes(value: string): string {
  if (typeof value !== "string" || value.length > MAX_FIT_WORKOUT_NOTES_LENGTH) {
    throw new FitWorkoutValidationError(
      `"notes" must be a string of at most ${MAX_FIT_WORKOUT_NOTES_LENGTH} characters.`,
    );
  }
  return value;
}

/** `@nexus/core`'s grammar, never a second one — see `FitRoutineStore`'s own `validateExerciseRef` for why that matters. */
function validateExerciseRef(value: string): string {
  if (typeof value !== "string" || parseExerciseRef(value) === null) {
    throw new FitWorkoutValidationError(
      `"exerciseRef" must be "catalogue:<slug>" or "user:<id>", at most ${MAX_EXERCISE_REF_LENGTH} characters.`,
    );
  }
  return value;
}

function validateSetLabel(value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_SET_LABEL_LENGTH) {
    throw new FitWorkoutValidationError(`"label" must be 1-${MAX_SET_LABEL_LENGTH} characters after trimming.`);
  }
  return trimmed;
}

function validateMetric(value: ExerciseMetric): ExerciseMetric {
  if (!(EXERCISE_METRICS as readonly string[]).includes(value)) {
    throw new FitWorkoutValidationError(`"metric" must be one of the closed metric vocabulary.`);
  }
  return value;
}

function validateKind(value: SetKind): SetKind {
  if (!(SET_KINDS as readonly string[]).includes(value)) {
    throw new FitWorkoutValidationError(`"kind" must be one of the closed set-kind vocabulary.`);
  }
  return value;
}

/** De-duplicated, every entry checked against `MUSCLE_GROUPS`; never empty — a set that trains nothing is not a set. */
function validateMuscleList(value: readonly MuscleGroup[]): MuscleGroup[] {
  if (!Array.isArray(value)) {
    throw new FitWorkoutValidationError(`"primaryMuscles" must be an array.`);
  }
  const seen = new Set<string>();
  const deduped: MuscleGroup[] = [];
  for (const muscle of value) {
    if (!(MUSCLE_GROUPS as readonly string[]).includes(muscle)) {
      throw new FitWorkoutValidationError(`"primaryMuscles" contains an unknown muscle group "${String(muscle)}".`);
    }
    if (seen.has(muscle)) continue;
    seen.add(muscle);
    deduped.push(muscle);
  }
  if (deduped.length === 0) {
    throw new FitWorkoutValidationError(`"primaryMuscles" must not be empty.`);
  }
  return deduped;
}

function validateNonNegativeOrNull(value: number | null | undefined, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new FitWorkoutValidationError(`"${field}" must be null or a finite number that is not negative.`);
  }
  return value;
}

function validateNonNegativeIntOrNull(value: number | null | undefined, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new FitWorkoutValidationError(`"${field}" must be null or a non-negative whole number.`);
  }
  return value;
}

function validateRir(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 5) {
    throw new FitWorkoutValidationError(`"rir" must be null or a whole number between 0 and 5.`);
  }
  return value;
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new FitWorkoutValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}

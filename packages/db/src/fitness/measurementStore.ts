import type Database from "better-sqlite3-multiple-ciphers";
import { validateBodyMeasurement } from "@nexus/core";
import type { BodyCircumferences, BodyMeasurement, BodyProblem, MuscleReading } from "@nexus/core";
import { FitMeasurementValidationError } from "../errors.js";
import { isBareDate, isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

export interface FitMeasurement {
  day: string;
  weightKg: number;
  bodyFatPercent: number | null;
  muscle: MuscleReading | null;
  waterPercent: number | null;
  circumferences: BodyCircumferences;
  createdAt: string;
  updatedAt: string;
}

interface MeasurementRow {
  day: string;
  weight_kg: number;
  body_fat_percent: number | null;
  muscle_unit: string | null;
  muscle_value: number | null;
  water_percent: number | null;
  neck_cm: number | null;
  chest_cm: number | null;
  upper_arm_cm: number | null;
  waist_cm: number | null;
  hip_cm: number | null;
  thigh_cm: number | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "day, weight_kg, body_fat_percent, muscle_unit, muscle_value, water_percent, " +
  "neck_cm, chest_cm, upper_arm_cm, waist_cm, hip_cm, thigh_cm, created_at, updated_at";

/**
 * One reading per day, straight off a scale or a tape (FIT body, migration
 * 060). `@nexus/core`'s `BodyMeasurement` is the shape of a reading; this store
 * is where one lives, keyed by `(profile_id, day)` exactly as the schema's own
 * primary key says — `save` is therefore an upsert, never an accumulation of
 * same-day rows.
 *
 * **Deletion here is HARD, unlike every soft-deleting store beside it.** A
 * mis-typed weigh-in is corrected in place (`save` again) or removed outright;
 * a soft-deleted reading would sit in the table looking recoverable while
 * `get` and `listRange` silently skip past it, which is a stranger state
 * than simply not existing — migration 060's own doc draws the same line
 * between the two child tables (`fit_routine_items` soft-deletes with its
 * parent, `fit_workout_sets` hard-deletes on `removeSet`) for the identical
 * reason: an unlogged number is a typo, not history.
 *
 * `@nexus/core`'s `validateBodyMeasurement` is the one gate — this file adds no
 * rule of its own — turned into a single named error rather than the bare
 * `BodyProblem[]` a caller would otherwise have to interpret twice (here and at
 * the IPC boundary). `today` for its future-date check comes from `now`'s own
 * date, never a clock read in this file.
 *
 * **There are exactly two reads — `get` and `listRange` — and „the newest
 * reading" is not one of them.**
 * A `latest()` (`ORDER BY day DESC LIMIT 1`) shipped here and was never called
 * outside its own tests: the only measurement read on the IPC allowlist is
 * `fit:measurements`, which is `listRange`, and every FIT surface wants the whole
 * window anyway — the newest reading is its last element, not a second query.
 */
export class FitMeasurementStore {
  private readonly selectByDay: Database.Statement;
  private readonly selectRange: Database.Statement;
  private readonly upsertMeasurement: Database.Statement;
  private readonly deleteByDay: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectByDay = db.prepare(
      `SELECT ${COLUMNS} FROM fit_measurements WHERE profile_id = ? AND day = ?`,
    );
    this.selectRange = db.prepare(
      `SELECT ${COLUMNS} FROM fit_measurements
        WHERE profile_id = ? AND day >= ? AND day <= ?
        ORDER BY day`,
    );
    this.upsertMeasurement = db.prepare(
      `INSERT INTO fit_measurements
         (profile_id, day, weight_kg, body_fat_percent, muscle_unit, muscle_value, water_percent,
          neck_cm, chest_cm, upper_arm_cm, waist_cm, hip_cm, thigh_cm, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id, day) DO UPDATE SET
         weight_kg = excluded.weight_kg,
         body_fat_percent = excluded.body_fat_percent,
         muscle_unit = excluded.muscle_unit,
         muscle_value = excluded.muscle_value,
         water_percent = excluded.water_percent,
         neck_cm = excluded.neck_cm,
         chest_cm = excluded.chest_cm,
         upper_arm_cm = excluded.upper_arm_cm,
         waist_cm = excluded.waist_cm,
         hip_cm = excluded.hip_cm,
         thigh_cm = excluded.thigh_cm,
         updated_at = excluded.updated_at`,
    );
    this.deleteByDay = db.prepare(`DELETE FROM fit_measurements WHERE profile_id = ? AND day = ?`);
  }

  /** Writes one day's reading in a single upsert on `(profile_id, day)` and answers with what is now stored. */
  save(measurement: BodyMeasurement, now: string): FitMeasurement {
    const validNow = validateNow(now);
    const problems = validateBodyMeasurement(measurement, validNow.slice(0, 10));
    if (problems.length > 0) {
      throw new FitMeasurementValidationError(describeProblems(problems));
    }
    const existing = this.selectByDay.get(this.profileId, measurement.day) as
      | MeasurementRow
      | undefined;
    const createdAt = existing?.created_at ?? validNow;

    this.upsertMeasurement.run(
      this.profileId,
      measurement.day,
      measurement.weightKg,
      measurement.bodyFatPercent,
      measurement.muscle?.unit ?? null,
      measurement.muscle?.value ?? null,
      measurement.waterPercent,
      measurement.circumferences.neck,
      measurement.circumferences.chest,
      measurement.circumferences.upperArm,
      measurement.circumferences.waist,
      measurement.circumferences.hip,
      measurement.circumferences.thigh,
      createdAt,
      validNow,
    );

    return {
      day: measurement.day,
      weightKg: measurement.weightKg,
      bodyFatPercent: measurement.bodyFatPercent,
      muscle: measurement.muscle,
      waterPercent: measurement.waterPercent,
      circumferences: measurement.circumferences,
      createdAt,
      updatedAt: validNow,
    };
  }

  /** One day's reading, or `null` when nothing was recorded that day. */
  get(day: string): FitMeasurement | null {
    const validDay = validateDay(day, "day");
    const row = this.selectByDay.get(this.profileId, validDay) as MeasurementRow | undefined;
    return row === undefined ? null : toMeasurement(row);
  }

  /** Every reading in an inclusive day span, ascending. */
  listRange(fromDay: string, toDay: string): FitMeasurement[] {
    const from = validateDay(fromDay, "fromDay");
    const to = validateDay(toDay, "toDay");
    if (from > to) {
      throw new FitMeasurementValidationError(`"fromDay" must not be after "toDay".`);
    }
    const rows = this.selectRange.all(this.profileId, from, to) as MeasurementRow[];
    return rows.map((row) => toMeasurement(row));
  }

  /** Hard-deletes one day's reading. A silent no-op for a day with nothing recorded — the same posture `RestoreStore`'s wipe passes carry, and there is nothing here for a caller to have gotten wrong. */
  remove(day: string): void {
    const validDay = validateDay(day, "day");
    this.deleteByDay.run(this.profileId, validDay);
  }
}

function toMeasurement(row: MeasurementRow): FitMeasurement {
  return {
    day: row.day,
    weightKg: row.weight_kg,
    bodyFatPercent: row.body_fat_percent,
    muscle: toMuscle(row.muscle_unit, row.muscle_value),
    waterPercent: row.water_percent,
    circumferences: {
      neck: row.neck_cm,
      chest: row.chest_cm,
      upperArm: row.upper_arm_cm,
      waist: row.waist_cm,
      hip: row.hip_cm,
      thigh: row.thigh_cm,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Both null or both set — migration 060's own table CHECK on the pair, restated here for the read side. */
function toMuscle(unit: string | null, value: number | null): MuscleReading | null {
  if (unit === null || value === null) return null;
  return unit === "kg" ? { unit: "kg", value } : { unit: "percent", value };
}

function describeProblems(problems: readonly BodyProblem[]): string {
  const detail = problems.map((problem) => `"${problem.field}" (${problem.code})`).join(", ");
  return `Body measurement is invalid: ${detail}.`;
}

function validateDay(value: string, field: string): string {
  if (!isBareDate(value)) {
    throw new FitMeasurementValidationError(`"${field}" must be a real bare date (YYYY-MM-DD).`);
  }
  return value;
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new FitMeasurementValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}

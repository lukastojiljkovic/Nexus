import type Database from "better-sqlite3-multiple-ciphers";
import { FitTargetValidationError } from "../errors.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

/**
 * The ceiling on a goal. Not a medical opinion — 10 000 kcal a day is a real
 * training figure and this holds it — but an untrusted number that a progress
 * bar divides by, and a bound is cheaper than discovering the absence of one.
 */
export const MAX_FIT_TARGET = 100_000;

/**
 * The profile's daily nutrition goals (FIT slice a, migration 058).
 *
 * **Every goal is independently nullable, and NULL means „no goal" — never
 * zero.** They are different claims: „I have not set a calorie goal" and „my
 * calorie goal is zero" would draw different screens and mean different things,
 * and a type that collapsed them would force every reader to guess which one a
 * `0` was. A user who sets only a calorie target has three nulls beside it, and
 * that is the ordinary case rather than an edge one.
 *
 * `updatedAt` is null EXACTLY WHEN no row exists — which is how a caller tells
 * „never set anything" from „set goals and then cleared them all". Both leave
 * four nulls, but only the first has never been decided, and the export needs
 * the difference: a profile that never opened the goals screen carries no row to
 * export.
 */
export interface FitTargets {
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  updatedAt: string | null;
}

/** What `save` takes: the four goals, all of them, every time. */
export type FitTargetGoals = Omit<FitTargets, "updatedAt">;

interface TargetRow {
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  updated_at: string;
}

/** The four nulls a profile with no row reads as. One shared value; nothing here mutates it. */
const NO_TARGETS: FitTargets = Object.freeze({
  kcal: null,
  proteinG: null,
  carbsG: null,
  fatG: null,
  updatedAt: null,
});

/**
 * The profile's nutrition goals (migration 058) over prepared, parameterized
 * statements (SEC-API-03; every value is bound, never interpolated). One per
 * profile, reused, like every other store here.
 *
 * `get` is a get-or-default read that never writes — the `calendar_settings`
 * arrangement (migration 042 / `CalendarSettingsStore.get`): a profile that has
 * never set a goal costs no row, and four nulls IS „nothing set", whether the row
 * is absent or was cleared in place.
 *
 * `save` takes ALL FOUR goals in one upsert rather than patching one at a time.
 * A patch API would need a way to say „leave this alone" that is distinct from
 * „clear this", and with `null` already spoken for as „no goal" that third value
 * would have to be `undefined` — a distinction that reads identically in JSON on
 * the way across the IPC boundary and would eventually clear somebody's goal by
 * accident. Whole-object writes have no such ambiguity, and the screen that
 * edits them holds all four anyway.
 */
export class FitTargetStore {
  private readonly selectTargets: Database.Statement;
  private readonly upsertTargets: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectTargets = db.prepare(
      `SELECT kcal, protein_g, carbs_g, fat_g, updated_at FROM fit_targets WHERE profile_id = ?`,
    );
    this.upsertTargets = db.prepare(
      `INSERT INTO fit_targets (profile_id, kcal, protein_g, carbs_g, fat_g, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         kcal = excluded.kcal,
         protein_g = excluded.protein_g,
         carbs_g = excluded.carbs_g,
         fat_g = excluded.fat_g,
         updated_at = excluded.updated_at`,
    );
  }

  /** This profile's goals — four nulls and a null `updatedAt` while no row exists. Never writes. */
  get(): FitTargets {
    const row = this.selectTargets.get(this.profileId) as TargetRow | undefined;
    if (row === undefined) return NO_TARGETS;
    return {
      kcal: row.kcal,
      proteinG: row.protein_g,
      carbsG: row.carbs_g,
      fatG: row.fat_g,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Writes all four goals in one upsert and answers with what is now stored.
   * Clearing is a save of four nulls — the same one write, which is why there is
   * no separate `clear`. That still leaves a ROW behind, carrying its
   * `updatedAt`, and that is correct: the user decided to have no goals, which is
   * a different fact from never having looked.
   */
  save(goals: FitTargetGoals, now: string): FitTargets {
    const validNow = validateNow(now);
    const validated: FitTargetGoals = {
      kcal: validateGoal(goals.kcal, "kcal"),
      proteinG: validateGoal(goals.proteinG, "proteinG"),
      carbsG: validateGoal(goals.carbsG, "carbsG"),
      fatG: validateGoal(goals.fatG, "fatG"),
    };
    this.upsertTargets.run(
      this.profileId, validated.kcal, validated.proteinG, validated.carbsG, validated.fatG,
      validNow,
    );
    return { ...validated, updatedAt: validNow };
  }
}

/** Null passes through untouched — it is the ONLY way to say „no goal", so it is never coerced to zero, and zero is never coerced to it. */
function validateGoal(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_FIT_TARGET) {
    throw new FitTargetValidationError(
      `"${field}" must be null or a finite number between 0 and ${MAX_FIT_TARGET}.`,
    );
  }
  return value;
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new FitTargetValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}

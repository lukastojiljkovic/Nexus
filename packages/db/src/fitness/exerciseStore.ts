import type Database from "better-sqlite3-multiple-ciphers";
import { EXERCISE_EQUIPMENT, EXERCISE_METRICS, MOVEMENT_PATTERNS, MUSCLE_GROUPS } from "@nexus/core";
import type { ExerciseEquipment, ExerciseMetric, MovementPattern, MuscleGroup } from "@nexus/core";
import { FitExerciseNotFoundError, FitExerciseValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { parseMuscleList } from "./muscleJson.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

export const MAX_FIT_EXERCISE_NAME_LENGTH = 80;
export const MAX_FIT_EXERCISE_NAME_EN_LENGTH = 80;
export const MAX_FIT_EXERCISE_NOTES_LENGTH = 500;

/** Serbian Latin ordering for the exercise list — the same collator spelling every alphabetical FIT list uses (`FitFoodStore`'s reason: plain `"sr"` mis-tailors š/č/ć/ž). */
const FIT_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/**
 * One exercise the USER added. NOT a catalogue entry: the several-hundred-entry
 * catalogue ships inside the app as JSON (`@nexus/core`'s `fitness/exercise.ts`)
 * and is deliberately not a table — see migration 060's own doc. This row
 * exists for what the catalogue does not have: a home-built machine, a
 * variation with no name anywhere else.
 */
export interface FitExercise {
  id: string;
  profileId: string;
  name: string;
  nameEn: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: ExerciseEquipment;
  pattern: MovementPattern;
  unilateral: boolean;
  metric: ExerciseMetric;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFitExerciseInput {
  name: string;
  nameEn?: string;
  primaryMuscles: readonly MuscleGroup[];
  secondaryMuscles?: readonly MuscleGroup[];
  equipment: ExerciseEquipment;
  pattern: MovementPattern;
  unilateral?: boolean;
  metric: ExerciseMetric;
  notes?: string;
}

/** A partial patch. An omitted key is left untouched; every given key replaces the current value wholesale. */
export interface UpdateFitExerciseFields {
  name?: string;
  nameEn?: string;
  primaryMuscles?: readonly MuscleGroup[];
  secondaryMuscles?: readonly MuscleGroup[];
  equipment?: ExerciseEquipment;
  pattern?: MovementPattern;
  unilateral?: boolean;
  metric?: ExerciseMetric;
  notes?: string;
}

interface ExerciseRow {
  id: string;
  profile_id: string;
  name: string;
  name_en: string;
  primary_muscles_json: string;
  secondary_muscles_json: string;
  equipment: string;
  pattern: string;
  unilateral: number;
  metric: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, profile_id, name, name_en, primary_muscles_json, secondary_muscles_json, " +
  "equipment, pattern, unilateral, metric, notes, created_at, updated_at";

/**
 * The profile's OWN exercises (FIT training, migration 060), over prepared,
 * parameterized statements (SEC-API-03). Construct one per profile and reuse
 * it; every statement is scoped by `profile_id`. `FitFoodStore`'s arrangement
 * applied to exercises, down to the reason: this store knows nothing about the
 * catalogue, and a caller wanting „every exercise I can log" merges this list
 * with `EXERCISE_CATALOGUE` itself at the call site.
 *
 * **The catalogue's own gate (`validateExerciseEntry`) is deliberately NOT
 * enforced here** — `FitFoodStore`'s reasoning restated for exercises: that
 * validator refuses a slug shape no user-created row has, and a cross-field
 * rule (bodyweight is never `weight_reps`) written for a curated, professionally
 * transcribed dataset. What IS enforced is what cannot be anything but wrong: an
 * empty name, an unknown muscle, a metric outside the closed list.
 *
 * **The muscle arrays are re-validated on every read, not just on write.** They
 * are JSON, which SQLite cannot constrain, so a row whose column no longer
 * parses to an array of known `MuscleGroup`s is corruption — a hand-edited
 * file, a bad restore — and is reported as such rather than silently coerced to
 * `[]`, `TaskTemplateStore.parseStoredPayload`'s posture applied to this
 * column.
 */
export class FitExerciseStore {
  private readonly insert: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly updateFields: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO fit_exercises
         (id, profile_id, name, name_en, primary_muscles_json, secondary_muscles_json,
          equipment, pattern, unilateral, metric, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM fit_exercises WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM fit_exercises
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateFields = db.prepare(
      `UPDATE fit_exercises
         SET name = ?, name_en = ?, primary_muscles_json = ?, secondary_muscles_json = ?,
             equipment = ?, pattern = ?, unilateral = ?, metric = ?, notes = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE fit_exercises SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE fit_exercises SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
  }

  /** This profile's live exercises, sr-Latn alphabetical. */
  list(): FitExercise[] {
    const rows = this.selectActive.all(this.profileId) as ExerciseRow[];
    return rows.map((row) => toExercise(row)).sort(byName);
  }

  /** One live exercise in this profile, or throws — including for another profile's id. */
  get(id: string): FitExercise {
    return this.requireExercise(id);
  }

  /** Inserts an exercise and returns the stored row. */
  create(input: CreateFitExerciseInput, now: string): FitExercise {
    const validNow = validateNow(now);
    const resolved = resolve({
      name: input.name,
      nameEn: input.nameEn ?? "",
      primaryMuscles: [...input.primaryMuscles],
      secondaryMuscles: [...(input.secondaryMuscles ?? [])],
      equipment: input.equipment,
      pattern: input.pattern,
      unilateral: input.unilateral ?? false,
      metric: input.metric,
      notes: input.notes ?? "",
    });
    const id = uuidv7();

    this.insert.run(
      id, this.profileId, resolved.name, resolved.nameEn,
      JSON.stringify(resolved.primaryMuscles), JSON.stringify(resolved.secondaryMuscles),
      resolved.equipment, resolved.pattern, resolved.unilateral ? 1 : 0, resolved.metric,
      resolved.notes, validNow, validNow,
    );

    return { id, profileId: this.profileId, ...resolved, createdAt: validNow, updatedAt: validNow };
  }

  /** Applies a partial patch to a live exercise. Every logged set already snapshots its own muscles/metric (migration 060), so editing an exercise never rewrites history — the same guarantee `FitFoodStore.update` gives a logged meal. */
  update(id: string, fields: UpdateFitExerciseFields, now: string): FitExercise {
    const validNow = validateNow(now);
    const current = this.requireExercise(id);

    const resolved = resolve({
      name: fields.name ?? current.name,
      nameEn: fields.nameEn ?? current.nameEn,
      primaryMuscles: fields.primaryMuscles ? [...fields.primaryMuscles] : current.primaryMuscles,
      secondaryMuscles: fields.secondaryMuscles
        ? [...fields.secondaryMuscles]
        : current.secondaryMuscles,
      equipment: fields.equipment ?? current.equipment,
      pattern: fields.pattern ?? current.pattern,
      unilateral: fields.unilateral ?? current.unilateral,
      metric: fields.metric ?? current.metric,
      notes: fields.notes ?? current.notes,
    });

    this.updateFields.run(
      resolved.name, resolved.nameEn,
      JSON.stringify(resolved.primaryMuscles), JSON.stringify(resolved.secondaryMuscles),
      resolved.equipment, resolved.pattern, resolved.unilateral ? 1 : 0, resolved.metric,
      resolved.notes, validNow, id, this.profileId,
    );
    return { ...current, ...resolved, updatedAt: validNow };
  }

  /** Soft-deletes a live exercise (reversible via `restore`). A logged set that named it is untouched: `exercise_ref` is text with no foreign key, and the set's own `label`/snapshot keep it readable. */
  remove(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new FitExerciseNotFoundError(`No live exercise "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted exercise. Its id is unchanged, so every routine item and logged set that named it resolves again. */
  restore(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new FitExerciseNotFoundError(`No deleted exercise "${id}" to restore in this profile.`);
    }
  }

  private requireExercise(id: string): FitExercise {
    const row = this.selectActiveById.get(id, this.profileId) as ExerciseRow | undefined;
    if (!row) {
      throw new FitExerciseNotFoundError(`No live exercise "${id}" in this profile.`);
    }
    return toExercise(row);
  }
}

/** The exercise's own fields, minus the ones the row rather than the caller decides. */
type ResolvedExercise = Omit<FitExercise, "id" | "profileId" | "createdAt" | "updatedAt">;

function byName(a: FitExercise, b: FitExercise): number {
  return FIT_COLLATOR.compare(a.name, b.name) || a.id.localeCompare(b.id);
}

function toExercise(row: ExerciseRow): FitExercise {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    nameEn: row.name_en,
    primaryMuscles: parseStoredMuscles(row.primary_muscles_json, row.id, "primaryMuscles"),
    secondaryMuscles: parseStoredMuscles(row.secondary_muscles_json, row.id, "secondaryMuscles"),
    equipment: row.equipment as ExerciseEquipment,
    pattern: row.pattern as MovementPattern,
    unilateral: row.unilateral !== 0,
    metric: row.metric as ExerciseMetric,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Validates and resolves a whole exercise's fields — the ONE place every refusal lives, so `create` and `update` cannot drift on what an exercise is allowed to be. */
function resolve(fields: ResolvedExercise): ResolvedExercise {
  return {
    name: validateName(fields.name),
    nameEn: validateNameEn(fields.nameEn),
    primaryMuscles: validateMuscleList(fields.primaryMuscles, "primaryMuscles", true),
    secondaryMuscles: validateMuscleList(fields.secondaryMuscles, "secondaryMuscles", false),
    equipment: validateEquipment(fields.equipment),
    pattern: validatePattern(fields.pattern),
    unilateral: validateUnilateral(fields.unilateral),
    metric: validateMetric(fields.metric),
    notes: validateNotes(fields.notes),
  };
}

function validateName(value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_FIT_EXERCISE_NAME_LENGTH) {
    throw new FitExerciseValidationError(
      `"name" must be 1-${MAX_FIT_EXERCISE_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/** Empty is ordinary (`exercise.ts`'s own remark) — a user's own accessory movement need not carry an English name. */
function validateNameEn(value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length > MAX_FIT_EXERCISE_NAME_EN_LENGTH) {
    throw new FitExerciseValidationError(
      `"nameEn" must be at most ${MAX_FIT_EXERCISE_NAME_EN_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/** De-duplicated, order preserved, every entry checked against `MUSCLE_GROUPS`; `required` refuses an empty list (a primary target an exercise must name). */
function validateMuscleList(
  value: readonly MuscleGroup[],
  field: string,
  required: boolean,
): MuscleGroup[] {
  if (!Array.isArray(value)) {
    throw new FitExerciseValidationError(`"${field}" must be an array.`);
  }
  const seen = new Set<string>();
  const deduped: MuscleGroup[] = [];
  for (const muscle of value) {
    if (!(MUSCLE_GROUPS as readonly string[]).includes(muscle)) {
      throw new FitExerciseValidationError(`"${field}" contains an unknown muscle group "${String(muscle)}".`);
    }
    if (seen.has(muscle)) continue;
    seen.add(muscle);
    deduped.push(muscle);
  }
  if (required && deduped.length === 0) {
    throw new FitExerciseValidationError(`"${field}" must not be empty.`);
  }
  return deduped;
}

function validateEquipment(value: ExerciseEquipment): ExerciseEquipment {
  if (!(EXERCISE_EQUIPMENT as readonly string[]).includes(value)) {
    throw new FitExerciseValidationError(`"equipment" must be one of the closed equipment vocabulary.`);
  }
  return value;
}

function validatePattern(value: MovementPattern): MovementPattern {
  if (!(MOVEMENT_PATTERNS as readonly string[]).includes(value)) {
    throw new FitExerciseValidationError(`"pattern" must be one of the closed movement-pattern vocabulary.`);
  }
  return value;
}

function validateMetric(value: ExerciseMetric): ExerciseMetric {
  if (!(EXERCISE_METRICS as readonly string[]).includes(value)) {
    throw new FitExerciseValidationError(`"metric" must be one of the closed metric vocabulary.`);
  }
  return value;
}

function validateUnilateral(value: boolean): boolean {
  if (typeof value !== "boolean") {
    throw new FitExerciseValidationError(`"unilateral" must be a boolean.`);
  }
  return value;
}

function validateNotes(value: string): string {
  if (typeof value !== "string" || value.length > MAX_FIT_EXERCISE_NOTES_LENGTH) {
    throw new FitExerciseValidationError(
      `"notes" must be a string of at most ${MAX_FIT_EXERCISE_NOTES_LENGTH} characters.`,
    );
  }
  return value;
}

/**
 * Reads a stored muscle-list column back. This store writes only
 * `validateMuscleList`'s output, so anything that fails to parse — or parses to
 * something that is not an array of known muscle groups — is corruption rather
 * than input to coerce; reading it as `[]` would silently drop what an exercise
 * trains (`FitFoodStore.parseStoredServings`'s posture).
 */
function parseStoredMuscles(text: string, id: string, field: string): MuscleGroup[] {
  const parsed = parseMuscleList(text);
  if (parsed === null) {
    throw new FitExerciseValidationError(
      `Exercise "${id}" carries a "${field}" that is not a list of known muscle groups.`,
    );
  }
  return parsed;
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new FitExerciseValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}

import type Database from "better-sqlite3-multiple-ciphers";
import { MAX_EXERCISE_REF_LENGTH, parseExerciseRef } from "@nexus/core";
import { FitRoutineNotFoundError, FitRoutineValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

export const MAX_FIT_ROUTINE_NAME_LENGTH = 80;
export const MAX_FIT_ROUTINE_NOTES_LENGTH = 500;
export const MAX_FIT_ROUTINE_ITEM_LABEL_LENGTH = 80;
/** Past this many exercises a routine stops being a shape somebody warms up and reads off, and starts being a spreadsheet. */
export const MAX_FIT_ROUTINE_ITEMS = 60;


const FIT_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/**
 * One line of a routine: an exercise reference, its label at save time, and the
 * targets a program sets for it — every one nullable, because „bench, as many
 * sets as it takes" is a real prescription.
 *
 * Carries `profileId`/`routineId`/`position`/`createdAt`/`updatedAt` — every
 * column the table has, `FitExercise`'s own arrangement — rather than the
 * trimmed shape a CRUD screen strictly needs, because the interchange's
 * `fit-routine-item` record (`@nexus/core`) round-trips the row whole and reads
 * it straight off this type. `position` is redundant with the array's own
 * stored order (`FitRoutine.items`, always contiguous from zero) but is spelled
 * out anyway rather than left for a caller to re-derive from the index.
 */
export interface FitRoutineItem {
  id: string;
  profileId: string;
  routineId: string;
  position: number;
  exerciseRef: string;
  label: string;
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  /**
   * The targets a rep range cannot express (migration 061). Which of these an
   * item may carry is decided by the exercise's METRIC, exactly as it is for a
   * logged set — three of the seven metrics have no reps at all, and before
   * these existed a routine could not tell a plank how long to hold.
   *
   * All nullable, and an absent target is not a target of zero.
   */
  targetSeconds: number | null;
  targetWeightKg: number | null;
  targetDistanceM: number | null;
  /**
   * Rest after each set of THIS item. `0` is a real prescription — straight
   * into the next set — while `null` means the routine has no opinion and the
   * session's own default stands.
   */
  restSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A routine is the SHAPE of a session and holds nothing about when it runs —
 * migration 060's own doc, the same rule ADR-035's task templates run on. It is
 * started FROM (see `FitWorkoutStore.start`'s `routineRef`) rather than
 * scheduled.
 */
export interface FitRoutine {
  id: string;
  profileId: string;
  name: string;
  notes: string;
  /** In stored position order. */
  items: FitRoutineItem[];
  createdAt: string;
  updatedAt: string;
}

export interface FitRoutineItemInput {
  exerciseRef: string;
  label: string;
  targetSets?: number | null;
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
  targetSeconds?: number | null;
  targetWeightKg?: number | null;
  targetDistanceM?: number | null;
  restSeconds?: number | null;
}

export interface CreateFitRoutineInput {
  name: string;
  notes?: string;
  items: readonly FitRoutineItemInput[];
}

/** A partial patch. An omitted key is left untouched; a given `items` REPLACES the whole list — see the class doc for why there is no per-item patch. */
export interface UpdateFitRoutineFields {
  name?: string;
  notes?: string;
  items?: readonly FitRoutineItemInput[];
}

interface RoutineRow {
  id: string;
  profile_id: string;
  name: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface RoutineItemRow {
  id: string;
  routine_id: string;
  position: number;
  exercise_ref: string;
  label: string;
  target_sets: number | null;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_seconds: number | null;
  target_weight_kg: number | null;
  target_distance_m: number | null;
  rest_seconds: number | null;
  created_at: string;
  updated_at: string;
}

interface ValidatedItem {
  exerciseRef: string;
  label: string;
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetSeconds: number | null;
  targetWeightKg: number | null;
  targetDistanceM: number | null;
  restSeconds: number | null;
}

const ROUTINE_COLUMNS = "id, profile_id, name, notes, created_at, updated_at";
const ITEM_COLUMNS =
  "id, routine_id, position, exercise_ref, label, target_sets, target_reps_min, target_reps_max, " +
  "target_seconds, target_weight_kg, target_distance_m, rest_seconds, created_at, updated_at";

/**
 * The profile's OWN routines (FIT training, migration 060), over prepared,
 * parameterized statements (SEC-API-03). Construct one per profile and reuse
 * it; every statement — the routine row AND its items — is scoped by
 * `profile_id`.
 *
 * **Items are replaced WHOLESALE, never patched individually, and `position`
 * is derived from the array's own order — never sent by the caller.**
 * `FitTargetStore.save`'s own doc gives the reason and it holds here without
 * change: a patch API would need a third value meaning „leave this alone",
 * distinct from `null` meaning „clear this", and that third value would have to
 * be `undefined` — a distinction JSON does not preserve crossing the IPC
 * boundary, and one that would eventually clear a target rep range by
 * accident. A whole-list write has no such ambiguity, and the screen that
 * edits a routine already holds every item.
 *
 * **A create or an update that writes items is ONE transaction.** A routine
 * left with half its items after a crash mid-write is not a saved routine —
 * `TaskTemplateStore.saveByName`'s `db.transaction(...)` arrangement, applied
 * here to a delete-then-reinsert rather than a select-then-write.
 *
 * A rep range that runs backwards is refused HERE, with a message naming the
 * item — migration 060's own table CHECK on the pair is the backstop, not this
 * store's substitute for one.
 */
export class FitRoutineStore {
  private readonly insertRoutine: Database.Statement;
  private readonly selectActiveRoutines: Database.Statement;
  private readonly selectActiveRoutineById: Database.Statement;
  private readonly updateRoutineFields: Database.Statement;
  private readonly markRoutineDeleted: Database.Statement;
  private readonly markRoutineRestored: Database.Statement;
  private readonly selectItemsByRoutine: Database.Statement;
  private readonly insertItem: Database.Statement;
  private readonly deleteItemsByRoutine: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertRoutine = db.prepare(
      `INSERT INTO fit_routines (id, profile_id, name, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActiveRoutines = db.prepare(
      `SELECT ${ROUTINE_COLUMNS} FROM fit_routines WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectActiveRoutineById = db.prepare(
      `SELECT ${ROUTINE_COLUMNS} FROM fit_routines
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateRoutineFields = db.prepare(
      `UPDATE fit_routines SET name = ?, notes = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRoutineDeleted = db.prepare(
      `UPDATE fit_routines SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRoutineRestored = db.prepare(
      `UPDATE fit_routines SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.selectItemsByRoutine = db.prepare(
      `SELECT ${ITEM_COLUMNS} FROM fit_routine_items
        WHERE routine_id = ? AND profile_id = ?
        ORDER BY position, id`,
    );
    this.insertItem = db.prepare(
      `INSERT INTO fit_routine_items
         (id, profile_id, routine_id, position, exercise_ref, label,
          target_sets, target_reps_min, target_reps_max,
          target_seconds, target_weight_kg, target_distance_m, rest_seconds,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.deleteItemsByRoutine = db.prepare(
      `DELETE FROM fit_routine_items WHERE routine_id = ? AND profile_id = ?`,
    );
  }

  /** This profile's live routines, sr-Latn alphabetical, each with its items in position order. */
  list(): FitRoutine[] {
    const rows = this.selectActiveRoutines.all(this.profileId) as RoutineRow[];
    return rows.map((row) => this.toRoutine(row)).sort(byName);
  }

  /** One live routine in this profile, with its items, or throws. */
  get(id: string): FitRoutine {
    return this.requireRoutine(id);
  }

  /** Inserts a routine and its items in one transaction. */
  create(input: CreateFitRoutineInput, now: string): FitRoutine {
    const validNow = validateNow(now);
    const name = validateName(input.name);
    const notes = validateNotes(input.notes ?? "");
    const items = validateItems(input.items);
    const id = uuidv7();

    return this.db.transaction((): FitRoutine => {
      this.insertRoutine.run(id, this.profileId, name, notes, validNow, validNow);
      this.writeItems(id, items, validNow);
      return {
        id, profileId: this.profileId, name, notes,
        items: this.readItems(id), createdAt: validNow, updatedAt: validNow,
      };
    })();
  }

  /** Applies a partial patch. When `items` is given, the whole list is replaced (delete then reinsert) inside the same transaction as the routine's own field update. */
  update(id: string, fields: UpdateFitRoutineFields, now: string): FitRoutine {
    const validNow = validateNow(now);
    const current = this.requireRoutine(id);
    const name = fields.name === undefined ? current.name : validateName(fields.name);
    const notes = fields.notes === undefined ? current.notes : validateNotes(fields.notes);
    const items = fields.items === undefined ? null : validateItems(fields.items);

    return this.db.transaction((): FitRoutine => {
      this.updateRoutineFields.run(name, notes, validNow, id, this.profileId);
      if (items !== null) {
        this.deleteItemsByRoutine.run(id, this.profileId);
        this.writeItems(id, items, validNow);
      }
      return {
        ...current, name, notes,
        items: this.readItems(id), updatedAt: validNow,
      };
    })();
  }

  /** Soft-deletes a live routine (reversible via `restore`). Its items stay in the table — cascading only on a hard delete of the routine row, which this is not — and a session started from it keeps its own `routineRef`/`routineLabel` snapshot regardless. */
  remove(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markRoutineDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new FitRoutineNotFoundError(`No live routine "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted routine, items included. */
  restore(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markRoutineRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new FitRoutineNotFoundError(`No deleted routine "${id}" to restore in this profile.`);
    }
  }

  private writeItems(routineId: string, items: readonly ValidatedItem[], now: string): void {
    items.forEach((item, index) => {
      this.insertItem.run(
        uuidv7(), this.profileId, routineId, index,
        item.exerciseRef, item.label, item.targetSets, item.targetRepsMin, item.targetRepsMax,
        item.targetSeconds, item.targetWeightKg, item.targetDistanceM, item.restSeconds,
        now, now,
      );
    });
  }

  private readItems(routineId: string): FitRoutineItem[] {
    const rows = this.selectItemsByRoutine.all(routineId, this.profileId) as RoutineItemRow[];
    return rows.map((row) => toItem(row, this.profileId));
  }

  private toRoutine(row: RoutineRow): FitRoutine {
    return {
      id: row.id,
      profileId: row.profile_id,
      name: row.name,
      notes: row.notes,
      items: this.readItems(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private requireRoutine(id: string): FitRoutine {
    const row = this.selectActiveRoutineById.get(id, this.profileId) as RoutineRow | undefined;
    if (!row) {
      throw new FitRoutineNotFoundError(`No live routine "${id}" in this profile.`);
    }
    return this.toRoutine(row);
  }
}

function byName(a: FitRoutine, b: FitRoutine): number {
  return FIT_COLLATOR.compare(a.name, b.name) || a.id.localeCompare(b.id);
}

function toItem(row: RoutineItemRow, profileId: string): FitRoutineItem {
  return {
    id: row.id,
    profileId,
    routineId: row.routine_id,
    position: row.position,
    exerciseRef: row.exercise_ref,
    label: row.label,
    targetSets: row.target_sets,
    targetRepsMin: row.target_reps_min,
    targetRepsMax: row.target_reps_max,
    targetSeconds: row.target_seconds,
    targetWeightKg: row.target_weight_kg,
    targetDistanceM: row.target_distance_m,
    restSeconds: row.rest_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateItems(items: readonly FitRoutineItemInput[]): ValidatedItem[] {
  if (!Array.isArray(items)) {
    throw new FitRoutineValidationError(`"items" must be an array.`);
  }
  if (items.length > MAX_FIT_ROUTINE_ITEMS) {
    throw new FitRoutineValidationError(
      `A routine may hold at most ${MAX_FIT_ROUTINE_ITEMS} items (got ${items.length}).`,
    );
  }
  return items.map((item, index) => validateItem(item, index));
}

function validateItem(item: FitRoutineItemInput, index: number): ValidatedItem {
  const exerciseRef = validateExerciseRef(item?.exerciseRef, index);
  const label = validateLabel(item?.label, index);
  const targetSets = validatePositiveIntOrNull(item?.targetSets, `items[${index}].targetSets`);
  const targetRepsMin = validatePositiveIntOrNull(
    item?.targetRepsMin,
    `items[${index}].targetRepsMin`,
  );
  const targetRepsMax = validatePositiveIntOrNull(
    item?.targetRepsMax,
    `items[${index}].targetRepsMax`,
  );
  if (targetRepsMin !== null && targetRepsMax !== null && targetRepsMin > targetRepsMax) {
    throw new FitRoutineValidationError(
      `"items[${index}]" has a rep range that runs backwards (targetRepsMin > targetRepsMax).`,
    );
  }
  // Migration 061's targets. Bounds mirror the CHECKs on the columns AND the
  // ones `fit_workout_sets` already imposes on the same quantities, so a
  // routine cannot prescribe a set the log would refuse to record.
  const targetSeconds = validatePositiveFiniteOrNull(
    item?.targetSeconds,
    `items[${index}].targetSeconds`,
  );
  const targetWeightKg = validateNonNegativeFiniteOrNull(
    item?.targetWeightKg,
    `items[${index}].targetWeightKg`,
  );
  const targetDistanceM = validatePositiveFiniteOrNull(
    item?.targetDistanceM,
    `items[${index}].targetDistanceM`,
  );
  const restSeconds = validateRestSecondsOrNull(item?.restSeconds, `items[${index}].restSeconds`);
  return {
    exerciseRef,
    label,
    targetSets,
    targetRepsMin,
    targetRepsMax,
    targetSeconds,
    targetWeightKg,
    targetDistanceM,
    restSeconds,
  };
}

/**
 * `@nexus/core`'s grammar, never a second one. The store that WRITES a
 * reference, the IPC boundary that RECEIVES one from an untrusted renderer and
 * the interchange reader that RE-VALIDATES one on import have to agree on what
 * a legal reference is; three regexes is three chances to disagree, and the
 * disagreement shows up as a routine that silently points at nothing.
 */
function validateExerciseRef(value: string, index: number): string {
  if (typeof value !== "string" || parseExerciseRef(value) === null) {
    throw new FitRoutineValidationError(
      `"items[${index}].exerciseRef" must be "catalogue:<slug>" or "user:<id>", at most ${MAX_EXERCISE_REF_LENGTH} characters.`,
    );
  }
  return value;
}

function validateLabel(value: string, index: number): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_FIT_ROUTINE_ITEM_LABEL_LENGTH) {
    throw new FitRoutineValidationError(
      `"items[${index}].label" must be 1-${MAX_FIT_ROUTINE_ITEM_LABEL_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/** `null`/`undefined` both mean „no target"; anything else must be a positive whole number — a target of zero is not a state this field has. */
function validatePositiveIntOrNull(value: number | null | undefined, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new FitRoutineValidationError(`"${field}" must be null or a positive whole number.`);
  }
  return value;
}

/**
 * A measured quantity, not a count — seconds and metres are REAL in both
 * `fit_routine_items` and `fit_workout_sets`, because a 45.5-second hold is a
 * real prescription. `Number.isFinite` rather than a bare `typeof`: NaN and
 * Infinity are numbers, and SQLite would take either of them without
 * complaint.
 */
function validatePositiveFiniteOrNull(
  value: number | null | undefined,
  field: string,
): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new FitRoutineValidationError(`"${field}" must be null or a positive number.`);
  }
  return value;
}

/** Same, but zero is legal — a bodyweight target is 0 kg of added load. */
function validateNonNegativeFiniteOrNull(
  value: number | null | undefined,
  field: string,
): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new FitRoutineValidationError(`"${field}" must be null or a number of at least zero.`);
  }
  return value;
}

/**
 * Rest is whole seconds, and ZERO IS MEANINGFUL — „straight into the next set"
 * is a superset, and it is a different statement from `null`, which means the
 * routine has no opinion and the session default stands.
 *
 * The ceiling is the REST TIMER's own maximum, restating migration 061's CHECK.
 * A routine allowed to store more than the timer accepts could prescribe a rest
 * the app then refuses to run — and the refusal would land a full session
 * later, on the set where it mattered.
 */
const MAX_ROUTINE_REST_SECONDS = 600;

function validateRestSecondsOrNull(
  value: number | null | undefined,
  field: string,
): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_ROUTINE_REST_SECONDS
  ) {
    throw new FitRoutineValidationError(
      `"${field}" must be null or a whole number of seconds from 0 to ${MAX_ROUTINE_REST_SECONDS}.`,
    );
  }
  return value;
}

function validateName(value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_FIT_ROUTINE_NAME_LENGTH) {
    throw new FitRoutineValidationError(
      `"name" must be 1-${MAX_FIT_ROUTINE_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateNotes(value: string): string {
  if (typeof value !== "string" || value.length > MAX_FIT_ROUTINE_NOTES_LENGTH) {
    throw new FitRoutineValidationError(
      `"notes" must be a string of at most ${MAX_FIT_ROUTINE_NOTES_LENGTH} characters.`,
    );
  }
  return value;
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new FitRoutineValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}

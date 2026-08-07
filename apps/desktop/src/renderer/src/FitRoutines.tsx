import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button, Chip, EmptyState, ListRow, TextField } from "@nexus/ui";
import {
  EXERCISE_EQUIPMENT,
  EXERCISE_METRICS,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
} from "@nexus/core";
import {
  MAX_FIT_EXERCISE_NAME_LENGTH,
  MAX_FIT_EXERCISE_NOTES_LENGTH,
  MAX_FIT_ROUTINE_ITEMS,
  MAX_FIT_ROUTINE_NAME_LENGTH,
  MAX_FIT_ROUTINE_NOTES_LENGTH,
} from "../../shared/ipc.js";
import type {
  ExerciseEquipment,
  ExerciseMetric,
  FitExercise,
  FitRoutine,
  FitRoutineItemInput,
  MovementPattern,
  MuscleGroup,
} from "../../shared/ipc.js";
import { parseAmountInput } from "./fitDay.js";
import { FitExercisePicker } from "./FitExercisePicker.js";
import { movedByOne } from "./fitWorkout.js";
import { fitTrainingError, targetText } from "./fitWorkoutCopy.js";
import { strings } from "./strings.js";

/**
 * „Rutine" and „Moje vežbe" — the two things that outlive a session.
 *
 * They share a file because they share a shape: both are a list with one form
 * that serves creating and editing alike, both offer one pending undo, and both
 * are read by the section above them in the SAME round as everything else, so a
 * routine saved here is startable in the panel above without a remount.
 *
 * **A routine is a SHAPE, not a schedule** (ADR-081 §6). It holds an ordered
 * list of exercises and what each one is aiming at, and nothing about when — the
 * caption says so, because every other fitness app calls this a „plan" and means
 * a calendar. Starting one is an act somebody performs on a day; the routine
 * itself never knows a date.
 *
 * **Items are sent WHOLE, every time.** There is no patch API across this wire
 * and there deliberately cannot be one: `undefined` and „absent" are the same
 * byte in JSON, so a partial write would one day silently empty a routine
 * (`FitRoutineSaveRequest`). What crosses is a reference and its targets — main
 * resolves the reference and writes the label, so a routine cannot name one
 * exercise and point at another.
 *
 * **The catalogue is not a table.** „Moje vežbe" holds only what the user added;
 * there is nothing on this surface that could edit a catalogue entry, because
 * there is no row behind one — „Ishrana" says the same about foods, for the same
 * reason.
 */

/** Which form is open, if any — the FIN rail's shape: a create and an edit are one form. */
type Editing = null | { mode: "new" } | { mode: "edit"; id: string };

/** The one pending undo, and which list it belongs to. */
type PendingUndo = null | { kind: "routine"; id: string } | { kind: "exercise"; id: string };

/** One routine line while it is being edited — the targets are text until they parse. */
interface ItemDraft {
  exerciseRef: string;
  label: string;
  /** `null` for a reference that no longer resolves; the line stays, and cannot be logged against. */
  metric: ExerciseMetric | null;
  sets: string;
  repsMin: string;
  repsMax: string;
}

export interface FitRoutinesProps {
  profileId: string;
  routines: FitRoutine[];
  exercises: FitExercise[];
  onChanged: () => Promise<void>;
}

export function FitRoutines({ profileId, routines, exercises, onChanged }: FitRoutinesProps) {
  const s = strings.fitness.training;

  const [pendingUndo, setPendingUndo] = useState<PendingUndo>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // „Rutine"
  const [editing, setEditing] = useState<Editing>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // „Moje vežbe"
  const [exerciseEditing, setExerciseEditing] = useState<Editing>(null);
  const [exerciseForm, setExerciseForm] = useState<ExerciseForm>(EMPTY_EXERCISE_FORM);
  const [exerciseError, setExerciseError] = useState<string | null>(null);

  /** Runs one mutation and re-reads through the section above — the routines list is its state, not this component's. */
  async function run(action: () => Promise<void>): Promise<void> {
    setActionError(null);
    try {
      await action();
      await onChanged();
    } catch (error) {
      setActionError(fitTrainingError(error));
      console.error("Nexus: a training action failed:", error);
    }
  }

  function closeRoutineForm(): void {
    setEditing(null);
    setNameDraft("");
    setNotesDraft("");
    setItems([]);
    setPickerOpen(false);
    setFormError(null);
  }

  function beginNewRoutine(): void {
    setActionError(null);
    setNameDraft("");
    setNotesDraft("");
    setItems([]);
    setFormError(null);
    setEditing({ mode: "new" });
  }

  function beginEditRoutine(routine: FitRoutine): void {
    setActionError(null);
    setNameDraft(routine.name);
    setNotesDraft(routine.notes);
    setItems(
      routine.items.map((item) => ({
        exerciseRef: item.exerciseRef,
        label: item.label,
        metric: item.metric,
        sets: item.targetSets === null ? "" : String(item.targetSets),
        repsMin: item.targetRepsMin === null ? "" : String(item.targetRepsMin),
        repsMax: item.targetRepsMax === null ? "" : String(item.targetRepsMax),
      })),
    );
    setFormError(null);
    setEditing({ mode: "edit", id: routine.id });
  }

  /** A target: a whole number, or `null` for „no target" — which is different from a target of zero. */
  function readTarget(text: string): number | null | "invalid" {
    const raw = text.trim();
    if (raw === "") return null;
    const value = parseAmountInput(raw);
    if (value === null || !Number.isInteger(value) || value <= 0) return "invalid";
    return value;
  }

  async function submitRoutine(event: FormEvent): Promise<void> {
    event.preventDefault();
    const current = editing;
    if (current === null) return;

    const name = nameDraft.trim();
    if (name === "") {
      setFormError(s.routines.invalidName);
      return;
    }
    if (items.length === 0) {
      setFormError(s.routines.needsItems);
      return;
    }

    const payload: FitRoutineItemInput[] = [];
    for (const item of items) {
      const sets = readTarget(item.sets);
      const repsMin = readTarget(item.repsMin);
      const repsMax = readTarget(item.repsMax);
      if (sets === "invalid" || repsMin === "invalid" || repsMax === "invalid") {
        setFormError(s.set.invalidWhole);
        return;
      }
      payload.push({
        exerciseRef: item.exerciseRef,
        targetSets: sets,
        targetRepsMin: repsMin,
        targetRepsMax: repsMax,
      });
    }

    setFormError(null);
    try {
      await window.nexus.fitSaveRoutine(profileId, {
        ...(current.mode === "edit" ? { id: current.id } : {}),
        name,
        notes: notesDraft.trim(),
        items: payload,
      });
      closeRoutineForm();
      await onChanged();
    } catch (error) {
      setFormError(fitTrainingError(error));
      console.error("Nexus: failed to save the routine:", error);
    }
  }

  async function deleteRoutine(routine: FitRoutine): Promise<void> {
    if (editing?.mode === "edit" && editing.id === routine.id) closeRoutineForm();
    await run(async () => {
      await window.nexus.fitDeleteRoutine(profileId, routine.id);
      setPendingUndo({ kind: "routine", id: routine.id });
    });
  }

  async function undoPending(): Promise<void> {
    const pending = pendingUndo;
    if (pending === null) return;
    await run(async () => {
      if (pending.kind === "routine") await window.nexus.fitRestoreRoutine(profileId, pending.id);
      else await window.nexus.fitRestoreExercise(profileId, pending.id);
      setPendingUndo(null);
    });
  }

  // --- „Moje vežbe" ----------------------------------------------------------

  function closeExerciseForm(): void {
    setExerciseEditing(null);
    setExerciseForm(EMPTY_EXERCISE_FORM);
    setExerciseError(null);
  }

  function beginNewExercise(): void {
    setActionError(null);
    setExerciseForm(EMPTY_EXERCISE_FORM);
    setExerciseError(null);
    setExerciseEditing({ mode: "new" });
  }

  function beginEditExercise(exercise: FitExercise): void {
    setActionError(null);
    setExerciseForm({
      name: exercise.name,
      nameEn: exercise.nameEn,
      primaryMuscles: exercise.primaryMuscles,
      secondaryMuscles: exercise.secondaryMuscles,
      equipment: exercise.equipment,
      pattern: exercise.pattern,
      metric: exercise.metric,
      unilateral: exercise.unilateral,
      notes: exercise.notes,
    });
    setExerciseError(null);
    setExerciseEditing({ mode: "edit", id: exercise.id });
  }

  async function submitExercise(event: FormEvent): Promise<void> {
    event.preventDefault();
    const current = exerciseEditing;
    if (current === null) return;

    const name = exerciseForm.name.trim();
    if (name === "") {
      setExerciseError(s.exercises.invalidName);
      return;
    }
    if (exerciseForm.primaryMuscles.length === 0) {
      setExerciseError(s.exercises.needsPrimary);
      return;
    }

    const fields = {
      name,
      nameEn: exerciseForm.nameEn.trim(),
      primaryMuscles: exerciseForm.primaryMuscles,
      secondaryMuscles: exerciseForm.secondaryMuscles,
      equipment: exerciseForm.equipment,
      pattern: exerciseForm.pattern,
      unilateral: exerciseForm.unilateral,
      metric: exerciseForm.metric,
      notes: exerciseForm.notes.trim(),
    };
    setExerciseError(null);
    try {
      if (current.mode === "new") await window.nexus.fitCreateExercise(profileId, fields);
      else await window.nexus.fitUpdateExercise(profileId, current.id, fields);
      closeExerciseForm();
      await onChanged();
    } catch (error) {
      setExerciseError(fitTrainingError(error));
      console.error("Nexus: failed to save the exercise:", error);
    }
  }

  async function deleteExercise(exercise: FitExercise): Promise<void> {
    if (exerciseEditing?.mode === "edit" && exerciseEditing.id === exercise.id) closeExerciseForm();
    await run(async () => {
      await window.nexus.fitDeleteExercise(profileId, exercise.id);
      setPendingUndo({ kind: "exercise", id: exercise.id });
    });
  }

  // --- What this render draws ------------------------------------------------

  /** One muscle group's toggle. `aria-pressed` is the state, and the styling is keyed off it — one truth, not two. */
  function muscleToggle(
    muscle: MuscleGroup,
    chosen: readonly MuscleGroup[],
    onToggle: (next: MuscleGroup[]) => void,
  ): ReactNode {
    const on = chosen.includes(muscle);
    return (
      <Button
        key={muscle}
        type="button"
        size="sm"
        className="nx-segmented__option fit__muscle"
        aria-pressed={on}
        onClick={() =>
          onToggle(on ? chosen.filter((entry) => entry !== muscle) : [...chosen, muscle])
        }
      >
        {s.muscle[muscle]}
      </Button>
    );
  }

  function renderRoutineForm(current: Exclude<Editing, null>): ReactNode {
    return (
      <form className="fit__form" onSubmit={(event) => void submitRoutine(event)}>
        <div className="fit__form-title">
          {current.mode === "new" ? s.routines.newTitle : s.routines.editTitle}
        </div>

        <TextField
          label={s.routines.nameLabel}
          value={nameDraft}
          placeholder={s.routines.namePlaceholder}
          maxLength={MAX_FIT_ROUTINE_NAME_LENGTH}
          onChange={(event) => setNameDraft(event.target.value)}
        />
        <TextField
          label={s.routines.notesLabel}
          value={notesDraft}
          placeholder={s.routines.notesPlaceholder}
          maxLength={MAX_FIT_ROUTINE_NOTES_LENGTH}
          onChange={(event) => setNotesDraft(event.target.value)}
        />

        <span className="fit__field-label">{s.routines.itemsLabel}</span>
        {items.map((item, index) => (
          <div key={`${item.exerciseRef}-${String(index)}`} className="fit__item-row">
            <span className="fit__item-name">
              {item.label}
              {item.metric === null && (
                <span className="fit__item-missing"> · {s.routines.missingExercise}</span>
              )}
            </span>
            <TextField
              value={item.sets}
              inputMode="numeric"
              aria-label={s.routines.targetSetsLabel}
              placeholder={s.routines.targetSetsLabel}
              className="fit__target-field"
              onChange={(event) => setItems(patchItem(items, index, { sets: event.target.value }))}
            />
            <TextField
              value={item.repsMin}
              inputMode="numeric"
              aria-label={s.routines.repsMinLabel}
              placeholder={s.routines.repsMinLabel}
              className="fit__target-field"
              onChange={(event) =>
                setItems(patchItem(items, index, { repsMin: event.target.value }))
              }
            />
            <TextField
              value={item.repsMax}
              inputMode="numeric"
              aria-label={s.routines.repsMaxLabel}
              placeholder={s.routines.repsMaxLabel}
              className="fit__target-field"
              onChange={(event) =>
                setItems(patchItem(items, index, { repsMax: event.target.value }))
              }
            />
            <Button
              type="button"
              size="sm"
              className="fit__row-action"
              disabled={index === 0}
              aria-label={`${s.routines.moveUp}: ${item.label}`}
              title={s.routines.moveUp}
              onClick={() => setItems(movedByOne(items, index, -1))}
            >
              ↑
            </Button>
            <Button
              type="button"
              size="sm"
              className="fit__row-action"
              disabled={index === items.length - 1}
              aria-label={`${s.routines.moveDown}: ${item.label}`}
              title={s.routines.moveDown}
              onClick={() => setItems(movedByOne(items, index, 1))}
            >
              ↓
            </Button>
            <Button
              type="button"
              size="sm"
              className="fit__row-action fit__row-delete"
              aria-label={`${s.routines.removeItem}: ${item.label}`}
              title={s.routines.removeItem}
              onClick={() => setItems(items.filter((_, at) => at !== index))}
            >
              ×
            </Button>
          </div>
        ))}
        <span className="fit__field-hint">{s.routines.targetHint}</span>

        {pickerOpen ? (
          <FitExercisePicker
            profileId={profileId}
            title={s.routines.addItem}
            onChoose={(option) => {
              setItems([
                ...items,
                {
                  exerciseRef: option.ref,
                  label: option.name,
                  metric: option.metric,
                  sets: "",
                  repsMin: "",
                  repsMax: "",
                },
              ]);
              setPickerOpen(false);
            }}
            onCancel={() => setPickerOpen(false)}
          />
        ) : (
          items.length < MAX_FIT_ROUTINE_ITEMS && (
            <Button type="button" size="sm" onClick={() => setPickerOpen(true)}>
              {s.routines.addItem}
            </Button>
          )
        )}

        {formError !== null && (
          <p className="fit__error" role="alert">
            {formError}
          </p>
        )}

        <div className="fit__form-actions">
          <Button type="submit" size="sm" variant="primary">
            {s.routines.save}
          </Button>
          <Button type="button" size="sm" className="fit__quiet" onClick={closeRoutineForm}>
            {s.routines.cancel}
          </Button>
        </div>
      </form>
    );
  }

  function renderExerciseForm(current: Exclude<Editing, null>): ReactNode {
    const f = s.exercises;
    return (
      <form className="fit__form" onSubmit={(event) => void submitExercise(event)}>
        <div className="fit__form-title">{current.mode === "new" ? f.newTitle : f.editTitle}</div>

        <TextField
          label={f.nameLabel}
          value={exerciseForm.name}
          placeholder={f.namePlaceholder}
          maxLength={MAX_FIT_EXERCISE_NAME_LENGTH}
          onChange={(event) => setExerciseForm({ ...exerciseForm, name: event.target.value })}
        />
        <TextField
          label={f.nameEnLabel}
          value={exerciseForm.nameEn}
          placeholder={f.nameEnPlaceholder}
          maxLength={MAX_FIT_EXERCISE_NAME_LENGTH}
          onChange={(event) => setExerciseForm({ ...exerciseForm, nameEn: event.target.value })}
        />
        <span className="fit__field-hint">{f.nameEnHint}</span>

        <span className="fit__field-label">{f.primaryLabel}</span>
        <div className="fit__muscles" role="group" aria-label={f.primaryLabel}>
          {MUSCLE_GROUPS.map((muscle) =>
            muscleToggle(muscle, exerciseForm.primaryMuscles, (next) =>
              setExerciseForm({ ...exerciseForm, primaryMuscles: next }),
            ),
          )}
        </div>

        <span className="fit__field-label">{f.secondaryLabel}</span>
        <div className="fit__muscles" role="group" aria-label={f.secondaryLabel}>
          {MUSCLE_GROUPS.map((muscle) =>
            muscleToggle(muscle, exerciseForm.secondaryMuscles, (next) =>
              setExerciseForm({ ...exerciseForm, secondaryMuscles: next }),
            ),
          )}
        </div>

        <label className="fit__field">
          <span className="fit__field-label">{f.equipmentLabel}</span>
          <select
            className="fit__select"
            value={exerciseForm.equipment}
            onChange={(event) =>
              setExerciseForm({
                ...exerciseForm,
                equipment: event.target.value as ExerciseEquipment,
              })
            }
          >
            {EXERCISE_EQUIPMENT.map((equipment) => (
              <option key={equipment} value={equipment}>
                {s.equipment[equipment]}
              </option>
            ))}
          </select>
        </label>

        <label className="fit__field">
          <span className="fit__field-label">{f.patternLabel}</span>
          <select
            className="fit__select"
            value={exerciseForm.pattern}
            onChange={(event) =>
              setExerciseForm({ ...exerciseForm, pattern: event.target.value as MovementPattern })
            }
          >
            {MOVEMENT_PATTERNS.map((pattern) => (
              <option key={pattern} value={pattern}>
                {s.pattern[pattern]}
              </option>
            ))}
          </select>
        </label>

        <label className="fit__field">
          <span className="fit__field-label">{f.metricLabel}</span>
          <select
            className="fit__select"
            value={exerciseForm.metric}
            onChange={(event) =>
              setExerciseForm({ ...exerciseForm, metric: event.target.value as ExerciseMetric })
            }
          >
            {EXERCISE_METRICS.map((metric) => (
              <option key={metric} value={metric}>
                {s.metric[metric]}
              </option>
            ))}
          </select>
        </label>
        <span className="fit__field-hint">{f.metricHint}</span>

        <label className="fit__checkline">
          <input
            type="checkbox"
            checked={exerciseForm.unilateral}
            onChange={(event) =>
              setExerciseForm({ ...exerciseForm, unilateral: event.target.checked })
            }
          />
          <span>{f.unilateralLabel}</span>
        </label>
        <span className="fit__field-hint">{f.unilateralHint}</span>

        <TextField
          label={f.notesLabel}
          value={exerciseForm.notes}
          placeholder={f.notesPlaceholder}
          maxLength={MAX_FIT_EXERCISE_NOTES_LENGTH}
          onChange={(event) => setExerciseForm({ ...exerciseForm, notes: event.target.value })}
        />

        {exerciseError !== null && (
          <p className="fit__error" role="alert">
            {exerciseError}
          </p>
        )}

        <div className="fit__form-actions">
          <Button type="submit" size="sm" variant="primary">
            {f.save}
          </Button>
          <Button type="button" size="sm" className="fit__quiet" onClick={closeExerciseForm}>
            {f.cancel}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <>
      {pendingUndo !== null && (
        <div className="fit__undo" role="status">
          <span className="fit__undo-text">
            {pendingUndo.kind === "routine" ? s.routines.deletedNotice : s.exercises.deletedNotice}
          </span>
          <Button size="sm" className="fit__undo-action" onClick={() => void undoPending()}>
            {strings.fitness.undo}
          </Button>
          <Button
            size="sm"
            className="fit__quiet"
            aria-label={strings.fitness.dismiss}
            onClick={() => setPendingUndo(null)}
          >
            ×
          </Button>
        </div>
      )}

      <section className="fit__section" aria-label={s.routines.heading}>
        <div className="fit__heading">{s.routines.heading}</div>
        <p className="fit__note">{s.routines.caption}</p>

        {editing !== null ? (
          renderRoutineForm(editing)
        ) : (
          <Button variant="primary" onClick={beginNewRoutine}>
            {s.routines.newRoutine}
          </Button>
        )}

        {routines.length === 0
          ? editing === null && (
              <EmptyState
                title={s.routines.emptyTitle}
                description={s.routines.emptyDescription}
              />
            )
          : (
              <div className="fit__list">
                {routines.map((routine) => (
                  <ListRow
                    key={routine.id}
                    trailing={
                      <span className="fit__row-actions">
                        <Button
                          size="sm"
                          className="fit__row-action"
                          aria-label={`${s.routines.edit}: ${routine.name}`}
                          title={s.routines.edit}
                          onClick={() => beginEditRoutine(routine)}
                        >
                          ✎
                        </Button>
                        <Button
                          size="sm"
                          className="fit__row-action fit__row-delete"
                          aria-label={`${s.routines.delete}: ${routine.name}`}
                          title={s.routines.delete}
                          onClick={() => void deleteRoutine(routine)}
                        >
                          ×
                        </Button>
                      </span>
                    }
                  >
                    <span className="fit__row-body">
                      <span className="fit__row-title">{routine.name}</span>
                      <span className="fit__row-meta">
                        {routine.items
                          .map((item) => {
                            const target = targetText({
                              sets: item.targetSets,
                              repsMin: item.targetRepsMin,
                              repsMax: item.targetRepsMax,
                            });
                            return target === "" ? item.label : `${item.label} ${target}`;
                          })
                          .join(" · ")}
                      </span>
                    </span>
                  </ListRow>
                ))}
              </div>
            )}
      </section>

      <section className="fit__section" aria-label={s.exercises.heading}>
        <div className="fit__heading">{s.exercises.heading}</div>
        <p className="fit__note">{s.exercises.caption}</p>

        {exerciseEditing !== null ? (
          renderExerciseForm(exerciseEditing)
        ) : (
          <Button variant="primary" onClick={beginNewExercise}>
            {s.exercises.newExercise}
          </Button>
        )}

        {exercises.length === 0 ? (
          exerciseEditing === null && (
            <EmptyState
              title={s.exercises.emptyTitle}
              description={s.exercises.emptyDescription}
            />
          )
        ) : (
          <>
            <div className="fit__list">
              {exercises.map((exercise) => (
                <ListRow
                  key={exercise.id}
                  trailing={
                    <span className="fit__row-actions">
                      <Button
                        size="sm"
                        className="fit__row-action"
                        aria-label={`${s.exercises.edit}: ${exercise.name}`}
                        title={s.exercises.edit}
                        onClick={() => beginEditExercise(exercise)}
                      >
                        ✎
                      </Button>
                      <Button
                        size="sm"
                        className="fit__row-action fit__row-delete"
                        aria-label={`${s.exercises.delete}: ${exercise.name}`}
                        title={s.exercises.delete}
                        onClick={() => void deleteExercise(exercise)}
                      >
                        ×
                      </Button>
                    </span>
                  }
                >
                  <span className="fit__row-body">
                    <span className="fit__row-title">{exercise.name}</span>
                    <span className="fit__chips">
                      <Chip>{s.equipment[exercise.equipment]}</Chip>
                      <Chip variant="data">{s.metric[exercise.metric]}</Chip>
                      {exercise.primaryMuscles.map((muscle) => (
                        <Chip key={muscle}>{s.muscle[muscle]}</Chip>
                      ))}
                    </span>
                  </span>
                </ListRow>
              ))}
            </div>
            {/* Said where deleting is possible, and nowhere else: what goes is
                the exercise, never what was lifted with it. */}
            <p className="fit__note">{s.exercises.deleteNote}</p>
          </>
        )}
      </section>

      {actionError !== null && (
        <p className="fit__error" role="status">
          {actionError}
        </p>
      )}
    </>
  );
}

/** Every field of „Nova vežba", as a form actually holds it. */
interface ExerciseForm {
  name: string;
  nameEn: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: ExerciseEquipment;
  pattern: MovementPattern;
  metric: ExerciseMetric;
  unilateral: boolean;
  notes: string;
}

/**
 * What a blank exercise form starts as. The two defaults that are not empty are
 * the two closed vocabularies with no „unset" value — a select must show
 * something, and „šipka" plus „horizontalni potisak" is the most common pair
 * somebody adding their own accessory movement will change anyway. `metric`
 * defaults to the overwhelmingly common one for the same reason and is the one
 * field with an explanation under it.
 */
const EMPTY_EXERCISE_FORM: ExerciseForm = {
  name: "",
  nameEn: "",
  primaryMuscles: [],
  secondaryMuscles: [],
  equipment: "sipka",
  pattern: "horizontalni-potisak",
  metric: "weight_reps",
  unilateral: false,
  notes: "",
};

/** One line changed, the rest untouched. */
function patchItem(items: ItemDraft[], index: number, patch: Partial<ItemDraft>): ItemDraft[] {
  return items.map((item, at) => (at === index ? { ...item, ...patch } : item));
}


import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button, Chip, EmptyState, ListRow, LoadingState, Select, TextField } from "@nexus/ui";
import { SET_KINDS } from "@nexus/core";
import { clockText } from "../../shared/duration.js";
import { MAX_FIT_WORKOUT_NOTES_LENGTH } from "../../shared/ipc.js";
import type {
  FitExercise,
  FitExerciseOption,
  FitLastPerformed,
  FitRestTimer,
  FitRoutine,
  FitWorkout,
  FitWorkoutSet,
  SetKind,
} from "../../shared/ipc.js";
import { localTodayKey } from "./examDates.js";
import { parseAmountInput, gramsInputValue } from "./fitDay.js";
import { FitExercisePicker } from "./FitExercisePicker.js";
import { FitProgress } from "./FitProgress.js";
import { FitRoutines } from "./FitRoutines.js";
import {
  elapsedMinutes,
  isWholeField,
  prefillSet,
  restRemainingSeconds,
  SET_FIELD_COLUMN,
  SET_FIELDS,
  sessionExercises,
  workoutTonnage,
  type SessionExercise,
  type SetField,
} from "./fitWorkout.js";
import {
  fitTrainingError,
  REST_PRESETS,
  setCountText,
  setText,
  targetText,
  tonnageText,
} from "./fitWorkoutCopy.js";
import { strings } from "./strings.js";

/**
 * „Trening" (FIT slice c) — the FIT page's other half.
 *
 * Everything here is downstream of one of ADR-081 §1's five points, and the two
 * that shape the screen itself are these:
 *
 * - **„What did I do last time?" costs nothing.** It is on the exercise, beside
 *   the field you are about to type into, before you lift — not behind a tap,
 *   not on another screen. It is asked for the whole session in ONE call
 *   (`fit:last-performed`), never one call per exercise.
 * - **The metric decides the form.** A plank offers seconds, a pull-up offers
 *   reps, an assisted dip offers assistance in kilograms with a minus in front
 *   of it. There is one table saying so (`SET_FIELDS`) and this file reads it
 *   rather than deciding again.
 *
 * And two things this surface refuses to do, both of them visible rather than
 * merely absent:
 *
 * - **No coaching.** No suggested next weight, no verdict on a session, no
 *   „trebalo bi". The numbers are what was lifted.
 * - **No total that quietly covered less than it claims.** A session's tonnage
 *   says how many of its sets it could count, because a tonnage that silently
 *   dropped the pull-ups and the plank is the exact failure `setTonnage`'s
 *   refusal exists to prevent.
 *
 * The rest countdown (§7) writes nothing and appears nowhere in „Fokus"; the bar
 * says so where it runs, so nobody is left wondering why their focus statistics
 * did not move.
 */

/** How far back the session history is read. A day is a range of one, so these are the same read. */
const HISTORY_RANGES = [30, 90, 365] as const;

type HistoryRange = (typeof HISTORY_RANGES)[number];

/** The one pending undo, and which list it belongs to — the FIN/TASK/HABIT single slot. */
type PendingUndo = null | { kind: "workout"; id: string };

/** Everything one render of this section stands on, read in one round. */
interface TrainingSnapshot {
  open: FitWorkout | null;
  routines: FitRoutine[];
  exercises: FitExercise[];
  /** Finished sessions in the chosen window, ascending as the store answers them. */
  history: FitWorkout[];
}

/**
 * The section's one read. All four halves come back together for the reason
 * „Ishrana" reads its day, its goals and its foods at once: a render holding a
 * session but not the routine it was started from — or a routine list that no
 * longer matches what the start panel would offer — is never shown.
 */
async function loadTraining(profileId: string, from: string, to: string): Promise<TrainingSnapshot> {
  const [open, routines, exercises, history] = await Promise.all([
    window.nexus.fitOpenWorkout(profileId),
    window.nexus.fitRoutines(profileId),
    window.nexus.fitExercises(profileId),
    window.nexus.fitWorkouts(profileId, from, to),
  ]);
  return { open, routines, exercises, history };
}

/** The first day of a window of `days` ending today, inclusive of both ends. */
function windowStart(today: string, days: number): string {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString().slice(0, 10);
}

export interface FitTrainingProps {
  profileId: string;
}

export function FitTraining({ profileId }: FitTrainingProps) {
  const s = strings.fitness.training;
  const today = localTodayKey();

  const [range, setRange] = useState<HistoryRange>(30);
  const [snapshot, setSnapshot] = useState<TrainingSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingUndo, setPendingUndo] = useState<PendingUndo>(null);
  const [startDay, setStartDay] = useState(today);
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);

  const from = windowStart(today, range);

  const reload = useCallback(async (): Promise<void> => {
    setSnapshot(await loadTraining(profileId, from, today));
  }, [profileId, from, today]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await loadTraining(profileId, from, today);
        if (!active) return;
        setSnapshot(next);
        // Cleared on success: this effect runs again on every range change, and
        // a failure that outlived the window it happened in would leave the
        // whole section reading as broken for the rest of the session.
        setFailed(false);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load the training log:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, from, today]);

  /** Runs one mutation: clears the previous refusal, performs it, re-reads. A failure leaves what was typed where it is. */
  const run = useCallback(
    async (action: () => Promise<void>): Promise<void> => {
      setActionError(null);
      try {
        await action();
        await reload();
      } catch (error) {
        setActionError(fitTrainingError(error));
        console.error("Nexus: a training action failed:", error);
      }
    },
    [reload],
  );

  async function startWorkout(routine: FitRoutine | null): Promise<void> {
    await run(async () => {
      await window.nexus.fitStartWorkout(profileId, startDay, routine?.id ?? null);
    });
  }

  async function deleteWorkout(workout: FitWorkout): Promise<void> {
    if (openHistoryId === workout.id) setOpenHistoryId(null);
    await run(async () => {
      await window.nexus.fitDeleteWorkout(profileId, workout.id);
      setPendingUndo({ kind: "workout", id: workout.id });
    });
  }

  async function undoPending(): Promise<void> {
    const pending = pendingUndo;
    if (pending === null) return;
    await run(async () => {
      await window.nexus.fitRestoreWorkout(profileId, pending.id);
      setPendingUndo(null);
    });
  }

  if (failed) {
    return <EmptyState title={s.loadErrorTitle} description={s.loadError} />;
  }
  if (snapshot === null) {
    return <LoadingState label={strings.app.loading} rows={6} />;
  }

  // Newest first, and without the open one — it has the whole panel above.
  const history = [...snapshot.history]
    .filter((workout) => workout.endedAt !== null)
    .reverse();
  // Bound to a local const so the narrowing survives into the callbacks below —
  // a property of a state object loses it, and the alternative is a cast.
  const open = snapshot.open;
  const openRoutine =
    open === null || open.routineRef === null
      ? null
      : (snapshot.routines.find((routine) => routine.id === open.routineRef) ?? null);

  return (
    <>
      {pendingUndo !== null && (
        <div className="fit__undo" role="status">
          <span className="fit__undo-text">{s.history.deletedNotice}</span>
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

      {open === null ? (
        <section className="fit__section" aria-label={s.start.heading}>
          <div className="fit__heading">{s.start.heading}</div>
          <p className="fit__note">{s.start.caption}</p>
          <div className="fit__start">
            <TextField
              label={s.start.dayLabel}
              type="date"
              value={startDay}
              max={today}
              className="fit__day-field"
              onChange={(event) => setStartDay(event.target.value)}
            />
            <Button variant="primary" onClick={() => void startWorkout(null)}>
              {s.start.adHoc}
            </Button>
          </div>
          {snapshot.routines.length > 0 && (
            <div className="fit__list">
              {snapshot.routines.map((routine) => (
                <ListRow
                  key={routine.id}
                  trailing={
                    <Button size="sm" onClick={() => void startWorkout(routine)}>
                      {s.start.fromRoutine}
                    </Button>
                  }
                >
                  <span className="fit__row-body">
                    <span className="fit__row-title">{routine.name}</span>
                    <span className="fit__row-meta">
                      {routine.items.map((item) => item.label).join(" · ")}
                    </span>
                  </span>
                </ListRow>
              ))}
            </div>
          )}
        </section>
      ) : (
        <SessionPanel
          key={open.id}
          profileId={profileId}
          workout={open}
          routine={openRoutine}
          onChanged={reload}
          onDiscard={() => void deleteWorkout(open)}
        />
      )}

      <section className="fit__section" aria-label={s.history.heading}>
        <div className="fit__heading">{s.history.heading}</div>
        <div className="fit__ranges" role="group" aria-label={s.history.rangeLabel}>
          {HISTORY_RANGES.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              className="nx-segmented__option fit__range"
              aria-pressed={range === option}
              onClick={() => setRange(option)}
            >
              {option === 30 ? s.history.range30 : option === 90 ? s.history.range90 : s.history.range365}
            </Button>
          ))}
        </div>
        {history.length === 0 ? (
          <EmptyState title={s.history.emptyTitle} description={s.history.emptyDescription} />
        ) : (
          <div className="fit__list">
            {history.map((workout) => (
              <HistoryRow
                key={workout.id}
                workout={workout}
                expanded={openHistoryId === workout.id}
                canReopen={open === null}
                onToggle={() => setOpenHistoryId(openHistoryId === workout.id ? null : workout.id)}
                onReopen={() =>
                  void run(async () => {
                    await window.nexus.fitReopenWorkout(profileId, workout.id);
                  })
                }
                onDelete={() => void deleteWorkout(workout)}
              />
            ))}
          </div>
        )}
      </section>

      <FitProgress profileId={profileId} />

      <FitRoutines
        profileId={profileId}
        routines={snapshot.routines}
        exercises={snapshot.exercises}
        onChanged={reload}
      />

      {actionError !== null && (
        <p className="fit__error" role="status">
          {actionError}
        </p>
      )}
    </>
  );
}

// --- The open session --------------------------------------------------------

/** One exercise's log form while it is being typed — every field is text until it parses. */
interface SetDraft {
  kind: SetKind;
  values: Partial<Record<SetField, string>>;
  rir: string;
}

interface SessionPanelProps {
  profileId: string;
  workout: FitWorkout;
  /** The routine the session was started from, when it is still there. Its order is the page's order. */
  routine: FitRoutine | null;
  onChanged: () => Promise<void>;
  /** Throws the session away — the way out of one started by mistake, offered back through the undo bar. */
  onDiscard: () => void;
}

function SessionPanel({ profileId, workout, routine, onChanged, onDiscard }: SessionPanelProps) {
  const s = strings.fitness.training;

  // What was picked from the picker but not logged yet, and therefore has not
  // happened — it joins the list last (`sessionExercises`).
  const [added, setAdded] = useState<FitExerciseOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lastTime, setLastTime] = useState<Map<string, FitLastPerformed>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, SetDraft>>({});
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<SetDraft | null>(null);
  const [notesDraft, setNotesDraft] = useState(workout.notes);
  const [error, setError] = useState<string | null>(null);

  const [rest, setRest] = useState<FitRestTimer | null>(null);
  const [restSeconds, setRestSeconds] = useState<number>(REST_PRESETS[1]);
  const [now, setNow] = useState(() => Date.now());

  const exercises = sessionExercises(workout.sets, routine, added);

  /**
   * „Prošli put" for every exercise on screen, in ONE call (ADR-081 §6). Re-asked
   * whenever the list of exercises changes — adding one mid-session must not
   * leave it as the only line with no history beside it.
   */
  // Joined into ONE primitive so the effect depends on the CONTENT of the list
  // rather than on a new array every render, which would re-ask on every single
  // keystroke in the form. A comma is safe as the separator: a reference is
  // "catalogue:<kebab-slug>" or "user:<uuid>" and can never contain one.
  const refs = exercises.map((exercise) => exercise.ref).join(",");
  useEffect(() => {
    const list = refs === "" ? [] : refs.split(",");
    if (list.length === 0) {
      setLastTime(new Map());
      return;
    }
    let active = true;
    void (async () => {
      try {
        const found = await window.nexus.fitLastPerformed(profileId, list);
        if (active) setLastTime(new Map(found.map((entry) => [entry.exerciseRef, entry])));
      } catch (loadError) {
        console.error("Nexus: failed to read what was done last time:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, refs]);

  /** The running rest, if one survived leaving the page — it lives in main, not here. */
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const running = await window.nexus.fitRestStatus(profileId);
        if (active) setRest(running);
      } catch (loadError) {
        console.error("Nexus: failed to read the rest countdown:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  const restRemaining = rest === null ? 0 : restRemainingSeconds(rest.endsAt, now);
  // A countdown that has REACHED zero is not counting any more. The entry stays
  // in main so the bar can still say „Odmor je gotov", but there is nothing left
  // to re-draw every second.
  const counting = rest !== null && restRemaining > 0;

  /**
   * The clock this panel draws from. One second while a rest is actually
   * counting down, half a minute otherwise — the only other thing on the clock
   * is the session's elapsed MINUTES, which a one-second tick would re-render
   * sixty times for nothing.
   */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), counting ? 1000 : 30_000);
    return () => window.clearInterval(timer);
  }, [counting]);

  async function startRest(seconds: number): Promise<void> {
    try {
      setRest(await window.nexus.fitStartRest(profileId, seconds));
      setNow(Date.now());
    } catch (restError) {
      setError(s.rest.error);
      console.error("Nexus: the rest countdown could not be started:", restError);
    }
  }

  async function stopRest(): Promise<void> {
    try {
      await window.nexus.fitStopRest(profileId);
      setRest(null);
    } catch (restError) {
      console.error("Nexus: the rest countdown could not be stopped:", restError);
    }
  }

  /** The draft for one exercise: what was typed, or — until anything is — what `prefillSet` says to repeat. */
  function draftFor(exercise: SessionExercise): SetDraft {
    const existing = drafts[exercise.ref];
    if (existing !== undefined) return existing;
    const previous = prefillSet(exercise, lastTime.get(exercise.ref));
    const values: Partial<Record<SetField, string>> = {};
    if (previous !== null && exercise.metric !== null) {
      for (const field of SET_FIELDS[exercise.metric]) {
        const value = previous[SET_FIELD_COLUMN[field]];
        if (value !== null) values[field] = gramsInputValue(value);
      }
    }
    // Always `working`, never the previous set's kind: a warm-up that prefilled
    // the next set as a warm-up would keep a whole session out of every volume
    // total, which is a trap rather than a convenience (`prefillSet`).
    return { kind: "working", values, rir: "" };
  }

  function setDraft(ref: string, next: SetDraft): void {
    setDrafts((all) => ({ ...all, [ref]: next }));
  }

  /**
   * Logs one set. The wire carries the REFERENCE and the numbers; main resolves
   * the exercise and stamps the label, the metric and the muscles.
   *
   * The numbers are placed by `SET_FIELD_COLUMN` from the metric's own field
   * list, so a field the metric does not declare has no path to a value at all —
   * a plank cannot be sent kilograms from this form.
   */
  async function logSet(exercise: SessionExercise): Promise<void> {
    if (exercise.metric === null) return;
    const draft = draftFor(exercise);
    const numbers = readDraft(exercise.metric, draft);
    if (numbers === null) {
      setError(s.set.invalidNumber);
      return;
    }
    setError(null);
    try {
      await window.nexus.fitLogSet(profileId, workout.id, {
        exerciseRef: exercise.ref,
        kind: draft.kind,
        ...numbers,
      });
      // The draft is DROPPED rather than cleared, so the form re-derives from the
      // set that was just logged — which is what a second straight set is.
      setDrafts((all) => {
        const { [exercise.ref]: _logged, ...others } = all;
        return others;
      });
      setAdded((list) => list.filter((option) => option.ref !== exercise.ref));
      // ADR-081 §7: the rest starts when a set is logged. A warm-up does not
      // start one — the ramp up to a working weight is not what a rest timer is
      // for, and it would ring in the middle of the next warm-up set.
      if (draft.kind !== "warmup") await startRest(restSeconds);
      await onChanged();
    } catch (logError) {
      setError(fitTrainingError(logError));
      console.error("Nexus: failed to log the set:", logError);
    }
  }

  async function saveSetEdit(set: FitWorkoutSet): Promise<void> {
    if (editDraft === null) return;
    const numbers = readDraft(set.metric, editDraft);
    if (numbers === null) {
      setError(s.set.invalidNumber);
      return;
    }
    setError(null);
    try {
      await window.nexus.fitUpdateSet(profileId, set.id, { kind: editDraft.kind, ...numbers });
      setEditingSetId(null);
      setEditDraft(null);
      await onChanged();
    } catch (updateError) {
      setError(fitTrainingError(updateError));
      console.error("Nexus: failed to correct the set:", updateError);
    }
  }

  async function removeSet(set: FitWorkoutSet): Promise<void> {
    if (editingSetId === set.id) {
      setEditingSetId(null);
      setEditDraft(null);
    }
    try {
      await window.nexus.fitRemoveSet(profileId, set.id);
      await onChanged();
    } catch (removeError) {
      setError(fitTrainingError(removeError));
      console.error("Nexus: failed to remove the set:", removeError);
    }
  }

  async function finish(): Promise<void> {
    try {
      await window.nexus.fitFinishWorkout(profileId, workout.id);
      // The session is over, so the rest after its last set is too.
      await stopRest();
      await onChanged();
    } catch (finishError) {
      setError(s.session.finishError);
      console.error("Nexus: failed to finish the session:", finishError);
    }
  }

  async function saveNotes(): Promise<void> {
    try {
      const trimmed = notesDraft.trim();
      await window.nexus.fitUpdateWorkout(profileId, workout.id, { notes: trimmed });
      // Mirrored back so the save button leaves: what is stored is the TRIMMED
      // text, and a draft still holding its trailing spaces would keep claiming
      // there is something left to save.
      setNotesDraft(trimmed);
      await onChanged();
    } catch (notesError) {
      setError(fitTrainingError(notesError));
      console.error("Nexus: failed to save the session note:", notesError);
    }
  }

  const minutes = elapsedMinutes(workout.startedAt, now);
  const tonnage = workoutTonnage(workout.sets);
  const workingCount = tonnage.counted + tonnage.uncounted;

  return (
    <section className="fit__section fit__session" aria-label={s.session.heading}>
      <div className="fit__session-head">
        <span className="fit__session-title">
          {workout.routineLabel === "" ? s.session.adHoc : workout.routineLabel}
        </span>
        {minutes !== null && (
          <Chip variant="data">{`${s.session.elapsedLabel} ${String(minutes)} ${s.session.elapsedUnit}`}</Chip>
        )}
        <Button size="sm" variant="primary" onClick={() => void finish()}>
          {s.session.finish}
        </Button>
        {/* The rest goes with the session. Discarding one and leaving its
            countdown running would ring for a set nobody is between. */}
        <Button
          size="sm"
          className="fit__quiet fit__row-delete"
          onClick={() => {
            void stopRest();
            onDiscard();
          }}
        >
          {s.session.discard}
        </Button>
      </div>

      <div className="fit__figures">
        <span className="fit__fact">
          <span className="fit__fact-label">{s.session.setsLabel}</span>
          <span className="fit__fact-value">{String(workingCount)}</span>
        </span>
        <span className="fit__fact">
          <span className="fit__fact-label">{s.session.tonnageLabel}</span>
          <span className="fit__fact-value">
            {tonnage.counted === 0
              ? s.session.tonnageNone
              : `${tonnageText(tonnage.kg)} ${s.session.tonnageUnit}`}
          </span>
        </span>
      </div>
      {/* Said only when the total really did leave something out — a figure that
          covered every set needs no caveat, and one that did not must not imply
          it did. */}
      {tonnage.counted > 0 && tonnage.uncounted > 0 && (
        <p className="fit__note">
          {`${s.session.tonnageCoverage} ${String(tonnage.counted)} ${s.session.tonnageCoverageOf} ${setCountText(workingCount)}`}
        </p>
      )}
      {tonnage.warmup > 0 && <p className="fit__note">{s.session.warmupNote}</p>}

      <RestBar
        running={rest !== null}
        remaining={restRemaining}
        seconds={restSeconds}
        onPick={(value) => {
          setRestSeconds(value);
          void startRest(value);
        }}
        onStop={() => void stopRest()}
      />

      {exercises.length === 0 ? (
        <p className="fit__note">{s.session.empty}</p>
      ) : (
        <div className="fit__exercises">
          {/* Removing a set is permanent, and until now the app did not say so
              anywhere. The sentence was written for exactly this spot — its own
              comment in `strings.ts` reads „Said where removing is possible" —
              and then no component rendered it, which left the one irreversible
              action in this panel as the only unlabelled one. It is a note and
              not a confirmation on purpose: the position ADR-081 takes is that
              a removed set was a TYPO and not history, so the affordance stays
              cheap and merely stops being silent about what it costs.
              Deleting a whole session, one level up, is undoable and says so
              through the „Vrati" bar instead. */}
          <p className="fit__note">{s.set.removeNote}</p>
          {exercises.map((exercise) => (
            <ExerciseCard
              key={exercise.ref}
              exercise={exercise}
              lastTime={lastTime.get(exercise.ref)}
              draft={draftFor(exercise)}
              editingSetId={editingSetId}
              editDraft={editDraft}
              onDraft={(next) => setDraft(exercise.ref, next)}
              onLog={() => void logSet(exercise)}
              onEditSet={(set) => {
                setEditingSetId(set.id);
                setEditDraft(draftOfSet(set));
              }}
              onEditDraft={setEditDraft}
              onSaveSet={(set) => void saveSetEdit(set)}
              onCancelEdit={() => {
                setEditingSetId(null);
                setEditDraft(null);
              }}
              onRemoveSet={(set) => void removeSet(set)}
            />
          ))}
        </div>
      )}

      {pickerOpen ? (
        <FitExercisePicker
          profileId={profileId}
          title={s.session.addExercise}
          onChoose={(option) => {
            setAdded((list) => [...list, option]);
            setPickerOpen(false);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      ) : (
        <Button size="sm" onClick={() => setPickerOpen(true)}>
          {s.session.addExercise}
        </Button>
      )}

      <div className="fit__notes-row">
        <TextField
          label={s.session.notesLabel}
          value={notesDraft}
          placeholder={s.session.notesPlaceholder}
          maxLength={MAX_FIT_WORKOUT_NOTES_LENGTH}
          onChange={(event) => setNotesDraft(event.target.value)}
        />
        {notesDraft !== workout.notes && (
          <Button size="sm" onClick={() => void saveNotes()}>
            {s.session.notesSave}
          </Button>
        )}
      </div>

      {error !== null && (
        <p className="fit__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

// --- One exercise inside the session -----------------------------------------

interface ExerciseCardProps {
  exercise: SessionExercise;
  lastTime: FitLastPerformed | undefined;
  draft: SetDraft;
  editingSetId: string | null;
  editDraft: SetDraft | null;
  onDraft: (next: SetDraft) => void;
  onLog: () => void;
  onEditSet: (set: FitWorkoutSet) => void;
  onEditDraft: (next: SetDraft) => void;
  onSaveSet: (set: FitWorkoutSet) => void;
  onCancelEdit: () => void;
  onRemoveSet: (set: FitWorkoutSet) => void;
}

function ExerciseCard({
  exercise,
  lastTime,
  draft,
  editingSetId,
  editDraft,
  onDraft,
  onLog,
  onEditSet,
  onEditDraft,
  onSaveSet,
  onCancelEdit,
  onRemoveSet,
}: ExerciseCardProps) {
  const s = strings.fitness.training;
  const target = targetText(exercise.target);

  return (
    <div className="fit__exercise">
      <div className="fit__exercise-head">
        <span className="fit__row-title">{exercise.label}</span>
        {target !== "" && <Chip>{`${s.target.label}: ${target}`}</Chip>}
        {exercise.metric !== null && <Chip variant="data">{s.metric[exercise.metric]}</Chip>}
      </div>

      {/* The single most used number in the module, beside the field it is about
          to be typed into (ADR-081 §1.1). „Prvi put" is said out loud rather
          than left as a blank somebody has to interpret. */}
      <p className="fit__lasttime">
        <span className="fit__lasttime-label">{s.lastTime.label}</span>
        {lastTime === undefined ? (
          <span className="fit__lasttime-none">{s.lastTime.none}</span>
        ) : (
          <>
            <span className="fit__lasttime-day">{lastTime.day}</span>
            <span className="fit__lasttime-sets">
              {lastTime.sets.map((set) => setText(set)).join(" · ")}
            </span>
          </>
        )}
      </p>

      {exercise.sets.length > 0 && (
        <div className="fit__sets">
          {exercise.sets.map((set, index) =>
            editingSetId === set.id && editDraft !== null ? (
              // Enter saves the correction, Escape abandons it — the same two
              // keys the meal row and TASK's inline row answer. On the wrapper
              // rather than on a field, because a set has up to three of them
              // and every one should answer the same way.
              <div
                key={set.id}
                className="fit__set fit__set--editing"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onSaveSet(set);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onCancelEdit();
                  }
                }}
              >
                <span className="fit__set-index">{String(index + 1)}</span>
                <SetFields
                  metric={set.metric}
                  draft={editDraft}
                  idPrefix={`edit-${set.id}`}
                  onChange={onEditDraft}
                />
                <Button size="sm" variant="primary" onClick={() => onSaveSet(set)}>
                  {s.set.save}
                </Button>
                <Button size="sm" className="fit__quiet" onClick={onCancelEdit}>
                  {s.set.cancel}
                </Button>
              </div>
            ) : (
              <div key={set.id} className="fit__set">
                <span className="fit__set-index">{String(index + 1)}</span>
                <span className="fit__set-text">{setText(set)}</span>
                {set.kind !== "working" && <Chip>{s.set.kind[set.kind]}</Chip>}
                {set.rir !== null && <Chip variant="data">{`${s.set.rirLabel} ${String(set.rir)}`}</Chip>}
                <Button
                  size="sm"
                  className="fit__row-action"
                  aria-label={`${s.set.edit}: ${exercise.label}`}
                  title={s.set.edit}
                  onClick={() => onEditSet(set)}
                >
                  ✎
                </Button>
                <Button
                  size="sm"
                  className="fit__row-action fit__row-delete"
                  aria-label={`${s.set.remove}: ${exercise.label}`}
                  title={s.set.remove}
                  onClick={() => onRemoveSet(set)}
                >
                  ×
                </Button>
              </div>
            ),
          )}
        </div>
      )}

      {exercise.metric === null ? (
        // A routine line whose exercise no longer resolves. Named rather than
        // hidden, and with nothing to log against — there is no metric, so there
        // is no set this form could describe.
        <p className="fit__note">{s.routines.missingExercise}</p>
      ) : (
        <div className="fit__logform">
          <Select
            label={s.set.kindLabel}
            className="fit__select"
            value={draft.kind}
            onChange={(event) => onDraft({ ...draft, kind: event.target.value as SetKind })}
          >
            {SET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {s.set.kind[kind]}
              </option>
            ))}
          </Select>
          <SetFields
            metric={exercise.metric}
            draft={draft}
            idPrefix={`log-${exercise.ref}`}
            onChange={onDraft}
          />
          <Button size="sm" variant="primary" onClick={onLog}>
            {s.set.log}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The inputs one set of a given metric needs, and only those. Reads `SET_FIELDS`
 * rather than switching on the metric, so the form and the reading of a set can
 * never describe different quantities.
 */
function SetFields({
  metric,
  draft,
  idPrefix,
  onChange,
}: {
  metric: SessionExercise["metric"];
  draft: SetDraft;
  idPrefix: string;
  onChange: (next: SetDraft) => void;
}): ReactNode {
  const s = strings.fitness.training.set;
  if (metric === null) return null;
  return (
    <>
      {SET_FIELDS[metric].map((field) => (
        <TextField
          key={field}
          id={`${idPrefix}-${field}`}
          label={s.field[field]}
          value={draft.values[field] ?? ""}
          inputMode={isWholeField(field) ? "numeric" : "decimal"}
          className="fit__set-field"
          onChange={(event) =>
            onChange({ ...draft, values: { ...draft.values, [field]: event.target.value } })
          }
        />
      ))}
      {/* RIR is REPS in reserve, so it is offered only where a set has reps at
          all. „Koliko si još mogao" on a plank is a question about seconds
          wearing a rep count's name, and a field whose meaning changes with the
          exercise is one people answer wrongly. */}
      {SET_FIELDS[metric].includes("reps") && (
        <TextField
          id={`${idPrefix}-rir`}
          label={s.rirLabel}
          value={draft.rir}
          inputMode="numeric"
          className="fit__set-field fit__set-field--rir"
          title={s.rirHint}
          onChange={(event) => onChange({ ...draft, rir: event.target.value })}
        />
      )}
    </>
  );
}

// --- The rest countdown ------------------------------------------------------

function RestBar({
  running,
  remaining,
  seconds,
  onPick,
  onStop,
}: {
  running: boolean;
  /** Whole seconds left, already floored at zero by . */
  remaining: number;
  seconds: number;
  onPick: (seconds: number) => void;
  onStop: () => void;
}): ReactNode {
  const s = strings.fitness.training.rest;

  return (
    <div className="fit__rest">
      <span className="fit__rest-label">{s.heading}</span>
      {!running ? (
        <span className="fit__rest-presets" role="group" aria-label={s.lengthLabel}>
          {REST_PRESETS.map((preset) => (
            <Button
              key={preset}
              type="button"
              size="sm"
              className="nx-segmented__option fit__rest-preset"
              aria-pressed={seconds === preset}
              onClick={() => onPick(preset)}
            >
              {clockText(preset)}
            </Button>
          ))}
        </span>
      ) : remaining === 0 ? (
        // The END is announced, once — `role="status"` is a polite live region,
        // and this element only exists when the countdown is over.
        <>
          <span className="fit__rest-clock fit__rest-clock--done" role="status">
            {s.done}
          </span>
          <Button size="sm" className="fit__quiet" onClick={onStop}>
            {s.stop}
          </Button>
        </>
      ) : (
        <>
          {/* Explicitly NOT a live region: a countdown that announced itself
              every second would make a screen reader unusable for the whole
              rest. The number is there to be read, not read out. */}
          <span className="fit__rest-clock" role="timer" aria-live="off">
            {clockText(remaining)}
          </span>
          <Button size="sm" className="fit__quiet" onClick={onStop}>
            {s.stop}
          </Button>
        </>
      )}
      {/* The founder's one-timer rule is about what the product RECORDS. This
          records nothing, and the sentence is here so nobody has to wonder why
          their „Fokus" statistics did not move. */}
      <span className="fit__rest-note">{s.note}</span>
    </div>
  );
}

// --- One finished session in the history -------------------------------------

function HistoryRow({
  workout,
  expanded,
  canReopen,
  onToggle,
  onReopen,
  onDelete,
}: {
  workout: FitWorkout;
  expanded: boolean;
  canReopen: boolean;
  onToggle: () => void;
  onReopen: () => void;
  onDelete: () => void;
}): ReactNode {
  const s = strings.fitness.training;
  const tonnage = workoutTonnage(workout.sets);
  const workingCount = tonnage.counted + tonnage.uncounted;

  return (
    <div className="fit__history">
      <ListRow
        trailing={
          <span className="fit__row-actions">
            <Chip variant="data">{setCountText(workingCount)}</Chip>
            <Button
              size="sm"
              className="fit__row-action"
              aria-expanded={expanded}
              aria-label={`${expanded ? s.history.close : s.history.open}: ${workout.day}`}
              title={expanded ? s.history.close : s.history.open}
              onClick={onToggle}
            >
              {expanded ? "▾" : "▸"}
            </Button>
          </span>
        }
      >
        <span className="fit__row-body">
          <span className="fit__row-title">
            {workout.routineLabel === "" ? s.history.adHoc : workout.routineLabel}
          </span>
          <span className="fit__row-meta">{workout.day}</span>
        </span>
      </ListRow>
      {expanded && (
        <div className="fit__history-detail">
          {sessionExercises(workout.sets, null, []).map((exercise) => (
            <div key={exercise.ref} className="fit__history-exercise">
              <span className="fit__row-title">{exercise.label}</span>
              <span className="fit__row-meta">
                {exercise.sets.map((set) => setText(set)).join(" · ")}
              </span>
            </div>
          ))}
          {tonnage.counted > 0 && (
            <p className="fit__note">
              {`${s.session.tonnageLabel}: ${tonnageText(tonnage.kg)} ${s.session.tonnageUnit}`}
            </p>
          )}
          {workout.notes.trim() !== "" && <p className="fit__note">{workout.notes}</p>}
          <div className="fit__form-actions">
            <Button size="sm" disabled={!canReopen} title={canReopen ? undefined : s.history.reopenBlocked} onClick={onReopen}>
              {s.history.reopen}
            </Button>
            <Button size="sm" className="fit__row-delete" onClick={onDelete}>
              {s.history.delete}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Reading a draft ---------------------------------------------------------

/** One logged set as a draft, for correcting it in place. The kind rides along here — it is what the set WAS, not a default. */
function draftOfSet(set: FitWorkoutSet): SetDraft {
  const values: Partial<Record<SetField, string>> = {};
  for (const field of SET_FIELDS[set.metric]) {
    const value = set[SET_FIELD_COLUMN[field]];
    if (value !== null) values[field] = gramsInputValue(value);
  }
  return { kind: set.kind, values, rir: set.rir === null ? "" : String(set.rir) };
}

/** The four numbers a set of this metric carries, or `null` when something typed is not one. */
type SetNumbers = {
  weightKg: number | null;
  reps: number | null;
  seconds: number | null;
  distanceM: number | null;
  rir: number | null;
};

/**
 * Reads a draft into the four columns plus RIR.
 *
 * **A field the metric does not declare is never even looked at**, which is what
 * makes „a plank logged as `weight_reps`" unrepresentable from this form rather
 * than merely unlikely: the loop is over `SET_FIELDS[metric]`, and everything
 * else stays `null`.
 *
 * An empty field reads as `null` — „not recorded" — because a zero is a claim: a
 * `weighted_reps` set legitimately carries `weightKg: 0`, so zero cannot double
 * as absent. Anything typed that is not a number, or a fraction where the
 * quantity is counted, refuses the whole set rather than being rounded into
 * something the user did not write.
 */
function readDraft(metric: NonNullable<SessionExercise["metric"]>, draft: SetDraft): SetNumbers | null {
  const numbers: SetNumbers = {
    weightKg: null,
    reps: null,
    seconds: null,
    distanceM: null,
    rir: null,
  };
  for (const field of SET_FIELDS[metric]) {
    const raw = (draft.values[field] ?? "").trim();
    if (raw === "") continue;
    const value = parseAmountInput(raw);
    if (value === null) return null;
    if (isWholeField(field) && !Number.isInteger(value)) return null;
    numbers[SET_FIELD_COLUMN[field]] = value;
  }
  const rirRaw = draft.rir.trim();
  if (rirRaw !== "") {
    const rir = parseAmountInput(rirRaw);
    if (rir === null || !Number.isInteger(rir) || rir < 0 || rir > 5) return null;
    numbers.rir = rir;
  }
  return numbers;
}

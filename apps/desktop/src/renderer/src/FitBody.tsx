import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button, Chip, EmptyState, Icon, LoadingState } from "@nexus/ui";
import { countsTowardVolume, EXERCISE_CATALOGUE, exercisesForMuscle, MUSCLE_GROUPS } from "@nexus/core";
import type { MuscleGroup, ProgressSet } from "@nexus/core";
import type { FitExercise, FitWorkout } from "../../shared/ipc.js";
import { localTodayKey } from "./examDates.js";
import { FitBodyFigure, sideOf, type MuscleShade } from "./FitBodyFigure.js";
import { formatFitDay } from "./fitDay.js";
import { progressSets } from "./fitWorkout.js";
import { strings } from "./strings.js";

/**
 * „Mapa tela" — FIT's centrepiece (founder, 2026-08-08).
 *
 * The map used to be one graphic buried inside „Napredak", answering one
 * question: which muscle groups went untrained this week. That question is
 * still here and is still what the shading says. What the section adds is the
 * other direction, which the catalogue could always answer and nothing ever
 * asked it: **pick a muscle and see what trains it; pick an exercise and see
 * what it actually hits, drawn on the body.**
 *
 * Three states, one rail:
 *
 *  - **nothing chosen** — the week. How many groups got a hard set, which ones
 *    got none.
 *  - **a muscle chosen** — its week, then every exercise that trains it, with
 *    „is the point of" and „also works" kept apart (`exercisesForMuscle`).
 *  - **an exercise chosen** — what it is (implement, pattern, what a set of it
 *    records) and what it trains, WITH THE FIGURE REPAINTED to show it: primary
 *    muscles at full strength, secondary at a third. That repaint is the answer
 *    to „šta sve ta vežba pogađa" — a sentence would have said the same thing
 *    and nobody would have read it.
 *
 * **The shading means two different things in two different states, and the
 * caption says which.** In the week states it is a COUNT OF SETS; in the
 * exercise state it is a CLAIM ABOUT THE MOVEMENT. Leaving one caption for both
 * would be the module quietly changing what a shade means under the reader.
 *
 * **The pool is the catalogue plus the profile's own exercises.** A user who
 * added their own accessory movement must find it here, or the list is lying
 * about what trains a muscle. The two are told apart by a chip, never merged
 * into an anonymous list.
 */

/** How far back the week states look. Seven days: the span a training week is actually balanced over. */
const WINDOW_DAYS = 7;

/** The set counts each shade stands for. Stated in the caption, because a shade nobody explained is a shade somebody guesses at. */
const BAND_LOW = 5;
const BAND_HIGH = 10;

/** One muscle's week: how many counting sets, and the last day it saw one. */
export interface MuscleWeek {
  sets: number;
  lastDay: string | null;
}

/**
 * The window's counts, per muscle.
 *
 * Exported for the test that pins the two rules it would be easiest to get
 * wrong later — warm-ups are not counted (`countsTowardVolume`, the same line
 * „Nedeljni obim" draws), and a set bills only its PRIMARY muscles, which is
 * `weeklyVolume`'s own rule: one bench press counted as chest and triceps and
 * shoulders would make every body look evenly trained.
 */
export function muscleWeek(
  sets: readonly ProgressSet[],
  from: string,
  to: string,
): Map<MuscleGroup, MuscleWeek> {
  const found = new Map<MuscleGroup, MuscleWeek>();
  for (const set of sets) {
    if (!countsTowardVolume(set.kind)) continue;
    if (set.day < from || set.day > to) continue;
    for (const muscle of set.primaryMuscles) {
      const current = found.get(muscle);
      if (current === undefined) {
        found.set(muscle, { sets: 1, lastDay: set.day });
      } else {
        current.sets += 1;
        if (current.lastDay === null || set.day > current.lastDay) current.lastDay = set.day;
      }
    }
  }
  return found;
}

/** Which shade a count wears. Four steps, because nobody reads step six from step seven. */
export function bandOf(count: number): MuscleShade {
  if (count <= 0) return 0;
  if (count < BAND_LOW) return 1;
  if (count < BAND_HIGH) return 2;
  return 3;
}

/** The first day of a window of `days` ending on `to`, both ends inclusive. */
function windowFrom(to: string, days: number): string {
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString().slice(0, 10);
}

/**
 * One row of the pool the rail lists from. The catalogue's entries and the
 * profile's own rows in one shape, told apart by `mine` — never merged into an
 * anonymous list, because „is this something I wrote down" changes how much a
 * reader trusts the muscles beside it.
 */
interface PoolExercise {
  readonly key: string;
  readonly name: string;
  readonly primaryMuscles: readonly MuscleGroup[];
  readonly secondaryMuscles: readonly MuscleGroup[];
  readonly equipment: string;
  readonly pattern: string;
  readonly metric: string;
  readonly unilateral: boolean;
  readonly mine: boolean;
}

export interface FitBodyProps {
  profileId: string;
}

export function FitBody({ profileId }: FitBodyProps) {
  const s = strings.fitness.training.progress.bodyMap;
  const names = strings.fitness.training.muscle;
  const today = localTodayKey();
  const from = windowFrom(today, WINDOW_DAYS);

  const [workouts, setWorkouts] = useState<FitWorkout[] | null>(null);
  const [mine, setMine] = useState<readonly FitExercise[]>([]);
  const [failed, setFailed] = useState(false);
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [exercise, setExercise] = useState<PoolExercise | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Both reads in one pass: the rail needs the profile's own exercises
        // before it can answer „what trains this", and a second spinner for a
        // list of a dozen rows would be more chrome than content.
        const [found, own] = await Promise.all([
          window.nexus.fitWorkouts(profileId, from, today),
          window.nexus.fitExercises(profileId),
        ]);
        if (!active) return;
        setWorkouts(found);
        setMine(own);
        setFailed(false);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to read the body map:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, from, today]);

  const pool = useMemo<readonly PoolExercise[]>(() => {
    const v = strings.fitness.training;
    const fromCatalogue = EXERCISE_CATALOGUE.map((entry) => ({
      key: `catalogue:${entry.id}`,
      name: entry.name,
      primaryMuscles: entry.primaryMuscles,
      secondaryMuscles: entry.secondaryMuscles,
      equipment: v.equipment[entry.equipment],
      pattern: v.pattern[entry.pattern],
      metric: v.metric[entry.metric],
      unilateral: entry.unilateral,
      mine: false,
    }));
    const fromProfile = mine.map((entry) => ({
      key: `user:${entry.id}`,
      name: entry.name,
      primaryMuscles: entry.primaryMuscles,
      secondaryMuscles: entry.secondaryMuscles,
      equipment: v.equipment[entry.equipment],
      pattern: v.pattern[entry.pattern],
      metric: v.metric[entry.metric],
      unilateral: entry.unilateral,
      mine: true,
    }));
    return [...fromCatalogue, ...fromProfile];
  }, [mine]);

  if (failed) {
    return (
      <section className="fit__section" aria-label={s.heading}>
        <div className="fit__heading">{s.heading}</div>
        <EmptyState
          title={strings.fitness.training.loadErrorTitle}
          description={strings.fitness.training.loadError}
        />
      </section>
    );
  }
  if (workouts === null) {
    return (
      <section className="fit__section" aria-label={s.heading}>
        <div className="fit__heading">{s.heading}</div>
        <LoadingState label={strings.app.loading} rows={5} />
      </section>
    );
  }

  const sets = progressSets(workouts);
  const week = muscleWeek(sets, from, today);
  const untouched = MUSCLE_GROUPS.filter((group) => (week.get(group)?.sets ?? 0) === 0);
  const trained = MUSCLE_GROUPS.length - untouched.length;

  // The two shading rules, and the caption that goes with whichever is in
  // force. Nothing else in the component decides what a shade means.
  const shades = new Map<MuscleGroup, MuscleShade>();
  if (exercise === null) {
    for (const group of MUSCLE_GROUPS) shades.set(group, bandOf(week.get(group)?.sets ?? 0));
  } else {
    for (const group of exercise.secondaryMuscles) shades.set(group, 1);
    // Primary last: an exercise that somehow listed a muscle on both sides
    // ends up painted as what it is FOR, which is the honest of the two.
    for (const group of exercise.primaryMuscles) shades.set(group, 3);
  }

  const span = `${String(WINDOW_DAYS)} ${s.captionDayUnit}`;
  const caption =
    exercise === null
      ? `${s.captionLead} ${span} — ${s.captionBands} 1–${String(BAND_LOW - 1)}, ` +
        `${String(BAND_LOW)}–${String(BAND_HIGH - 1)}, ${String(BAND_HIGH)} ${s.captionAndUp}. ${s.captionTail}`
      : `${s.exerciseCaption} ${exercise.name}.`;

  /** One muscle's label, read on hover — the count, and when it last happened. */
  const plateTitle = (group: MuscleGroup): string => {
    if (exercise !== null) {
      const role = exercise.primaryMuscles.includes(group)
        ? s.rolePrimary
        : exercise.secondaryMuscles.includes(group)
          ? s.roleSecondary
          : s.roleNone;
      return `${names[group]}: ${role}`;
    }
    const entry = week.get(group);
    if (entry === undefined || entry.sets === 0) return `${names[group]}: ${s.neverTrained}`;
    const when = entry.lastDay === null ? "" : ` · ${s.lastPrefix} ${formatFitDay(entry.lastDay)}`;
    return `${names[group]}: ${String(entry.sets)} ${s.setsSuffix}${when}`;
  };

  const chooseMuscle = (group: MuscleGroup): void => {
    setExercise(null);
    setMuscle((current) => (current === group ? null : group));
  };

  return (
    <section className="fit__section" aria-label={s.heading}>
      <div className="fit__heading">{s.heading}</div>
      <p className="fit__note">{s.sectionNote}</p>

      <div className="fit__body">
        <div className="fit__body-figure">
          <FitBodyFigure
            shades={shades}
            selected={muscle}
            title={plateTitle}
            onSelect={chooseMuscle}
            frontLabel={s.front}
            backLabel={s.back}
          />
          <p className="nx-chart__caption">{caption}</p>
          {/* The control the plates are only a shortcut for (see
              `FitBodyFigure`'s header): every group, as a real button, in the
              vocabulary's own order so the list and the figure can never
              disagree about which groups exist. */}
          <div className="fit__muscle-list" role="group" aria-label={s.pickerLabel}>
            {MUSCLE_GROUPS.map((group) => {
              const count = week.get(group)?.sets ?? 0;
              return (
                <Button
                  key={group}
                  type="button"
                  size="sm"
                  className="nx-segmented__option fit__muscle-option"
                  aria-pressed={muscle === group}
                  onClick={() => chooseMuscle(group)}
                >
                  <span
                    className={`fit__muscle-dot nx-cell nx-cell--l${String(bandOf(count))}`}
                    aria-hidden="true"
                  />
                  {names[group]}
                  <span className="fit__muscle-count nx-num">{String(count)}</span>
                </Button>
              );
            })}
          </div>
        </div>

        <div className="fit__body-rail">
          {exercise !== null ? (
            <ExerciseDetail
              exercise={exercise}
              onBack={() => setExercise(null)}
              backLabel={muscle === null ? s.backToWeek : names[muscle]}
            />
          ) : muscle !== null ? (
            <MuscleDetail
              muscle={muscle}
              week={week.get(muscle) ?? null}
              pool={pool}
              onPick={setExercise}
              onClear={() => setMuscle(null)}
            />
          ) : (
            <WeekDetail trained={trained} untouched={untouched} span={span} />
          )}
        </div>
      </div>
    </section>
  );
}

/** Nothing chosen: what the week actually came to. */
function WeekDetail({
  trained,
  untouched,
  span,
}: {
  trained: number;
  untouched: readonly MuscleGroup[];
  span: string;
}): ReactNode {
  const s = strings.fitness.training.progress.bodyMap;
  const names = strings.fitness.training.muscle;
  return (
    <>
      <h3 className="fit__rail-title">{`${s.weekHeading} ${span}`}</h3>
      <p className="fit__rail-lead">
        {`${String(trained)} ${s.descriptionOf} ${String(MUSCLE_GROUPS.length)} ${s.descriptionTrained}.`}
      </p>
      <div className="nx-eyebrow fit__rail-section">{`${s.untouchedHeading} ${span}`}</div>
      {untouched.length === 0 ? (
        <p className="fit__note">{s.untouchedNone}</p>
      ) : (
        <div className="fit__chips">
          {untouched.map((group) => (
            <Chip key={group}>{names[group]}</Chip>
          ))}
        </div>
      )}
      <p className="fit__note">{s.pickHint}</p>
    </>
  );
}

/** A muscle chosen: its week, then everything that trains it. */
function MuscleDetail({
  muscle,
  week,
  pool,
  onPick,
  onClear,
}: {
  muscle: MuscleGroup;
  week: MuscleWeek | null;
  pool: readonly PoolExercise[];
  onPick: (exercise: PoolExercise) => void;
  onClear: () => void;
}): ReactNode {
  const s = strings.fitness.training.progress.bodyMap;
  const names = strings.fitness.training.muscle;
  const { primary, secondary } = exercisesForMuscle(pool, muscle);

  return (
    <>
      <div className="fit__rail-head">
        <h3 className="fit__rail-title">{names[muscle]}</h3>
        <Button size="sm" variant="quiet" onClick={onClear}>
          {s.clear}
        </Button>
      </div>
      <p className="fit__rail-lead">
        {week === null || week.sets === 0
          ? s.neverTrained
          : `${String(week.sets)} ${s.setsSuffix}${week.lastDay === null ? "" : ` · ${s.lastPrefix} ${formatFitDay(week.lastDay)}`}`}
      </p>
      <p className="fit__note">
        {sideOf(muscle) === "front" ? s.drawnFront : s.drawnBack}
      </p>

      <div className="nx-eyebrow fit__rail-section">{s.primaryHeading}</div>
      <ExerciseList entries={primary} empty={s.primaryNone} onPick={onPick} />
      <div className="nx-eyebrow fit__rail-section">{s.secondaryHeading}</div>
      <ExerciseList entries={secondary} empty={s.secondaryNone} onPick={onPick} />
    </>
  );
}

function ExerciseList({
  entries,
  empty,
  onPick,
}: {
  entries: readonly PoolExercise[];
  empty: string;
  onPick: (exercise: PoolExercise) => void;
}): ReactNode {
  const s = strings.fitness.training.progress.bodyMap;
  if (entries.length === 0) return <p className="fit__note">{empty}</p>;
  return (
    <div className="fit__exercise-list">
      {entries.map((entry) => (
        <button
          key={entry.key}
          type="button"
          className="nx-list-row fit__exercise-row"
          onClick={() => onPick(entry)}
        >
          <span className="fit__exercise-name">{entry.name}</span>
          {entry.mine && <Chip>{s.mine}</Chip>}
          <span className="fit__exercise-equipment">{entry.equipment}</span>
          <Icon name="chevronRight" size={14} className="fit__exercise-caret" />
        </button>
      ))}
    </div>
  );
}

/** An exercise chosen: what it is, and what it trains — which the figure beside it is already showing. */
function ExerciseDetail({
  exercise,
  onBack,
  backLabel,
}: {
  exercise: PoolExercise;
  onBack: () => void;
  backLabel: string;
}): ReactNode {
  const s = strings.fitness.training.progress.bodyMap;
  const names = strings.fitness.training.muscle;
  const facts: { label: string; value: string }[] = [
    { label: s.factEquipment, value: exercise.equipment },
    { label: s.factPattern, value: exercise.pattern },
    { label: s.factMetric, value: exercise.metric },
    { label: s.factSide, value: exercise.unilateral ? s.factUnilateral : s.factBilateral },
  ];

  return (
    <>
      <div className="fit__rail-head">
        <h3 className="fit__rail-title">{exercise.name}</h3>
        <Button size="sm" variant="quiet" onClick={onBack}>
          <Icon name="chevronLeft" size={14} />
          {backLabel}
        </Button>
      </div>
      {exercise.mine && <Chip>{s.mine}</Chip>}

      <div className="fit__facts">
        {facts.map((fact) => (
          <div key={fact.label} className="fit__fact">
            <span className="fit__fact-label">{fact.label}</span>
            <span className="fit__fact-value">{fact.value}</span>
          </div>
        ))}
      </div>

      <div className="nx-eyebrow fit__rail-section">{s.hitsPrimary}</div>
      <div className="fit__chips">
        {exercise.primaryMuscles.map((group) => (
          <Chip key={group} variant="data">
            {names[group]}
          </Chip>
        ))}
      </div>
      {exercise.secondaryMuscles.length > 0 && (
        <>
          <div className="nx-eyebrow fit__rail-section">{s.hitsSecondary}</div>
          <div className="fit__chips">
            {exercise.secondaryMuscles.map((group) => (
              <Chip key={group}>{names[group]}</Chip>
            ))}
          </div>
        </>
      )}
      {/* The one thing the catalogue deliberately does not carry, said out loud
          rather than left as a gap: how to perform a movement is prose, and
          prose is what gets copied out of somebody else's product. */}
      <p className="fit__note">{s.noHowTo}</p>
    </>
  );
}

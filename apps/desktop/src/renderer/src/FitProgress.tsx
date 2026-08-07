import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { BarChart, Button, Chip, EmptyState, LoadingState } from "@nexus/ui";
import { exerciseRecords, weeklyVolume } from "@nexus/core";
import type { ExerciseRecords, MuscleGroup, WeekVolume } from "@nexus/core";
import type { FitWorkout } from "../../shared/ipc.js";
import { localTodayKey } from "./examDates.js";
import { progressSets } from "./fitWorkout.js";
import { setCountText, tonnageText } from "./fitWorkoutCopy.js";
import { strings } from "./strings.js";

/**
 * „Napredak" (FIT slice d, ADR-081 §5) — what the training log adds up to.
 *
 * **Everything here is derived on read, from the sets themselves.** There is no
 * personal-record table and there will not be one: a PR row and a set table can
 * disagree, and only one of them is the truth. The cost is an aggregate over a
 * year of sessions on every mount, which is a few thousand rows of arithmetic in
 * a language that does millions.
 *
 * **The two volume figures are never conflated.** Hard sets per muscle group is
 * what a week is actually balanced against and what a person can act on;
 * tonnage means something for the strength lifts and nothing for a plank or a
 * run. Both are labelled, because an app that shows one number called „obim" is
 * hiding which of the two it picked.
 *
 * **A record only exists where its question does** (`exerciseRecords`), and the
 * one this surface will not print is „the heaviest assisted pull-up" — there a
 * bigger number is LESS work, and the record that applies is the least help you
 * needed.
 */

/** How far back progression is read. Both are long enough that a week is a point rather than the whole picture. */
const PROGRESS_RANGES = [90, 365] as const;

type ProgressRange = (typeof PROGRESS_RANGES)[number];

/** How many weeks the volume list and its chart show at once — a quarter, which is a training block and a half. */
const WEEKS_SHOWN = 12;

/** The first day of a window of `days` ending today, inclusive of both ends. */
function windowStart(today: string, days: number): string {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString().slice(0, 10);
}

export interface FitProgressProps {
  profileId: string;
}

export function FitProgress({ profileId }: FitProgressProps) {
  const s = strings.fitness.training.progress;
  const today = localTodayKey();

  const [range, setRange] = useState<ProgressRange>(90);
  const [workouts, setWorkouts] = useState<FitWorkout[] | null>(null);
  const [failed, setFailed] = useState(false);

  const from = windowStart(today, range);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const found = await window.nexus.fitWorkouts(profileId, from, today);
        if (!active) return;
        setWorkouts(found);
        setFailed(false);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to read the training history:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, from, today]);

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
        <LoadingState label={strings.app.loading} rows={4} />
      </section>
    );
  }

  const sets = progressSets(workouts);
  const weeks = weeklyVolume(sets);
  const records = exerciseRecords(sets);
  // Newest first for the list, oldest first for the chart — a chart reading
  // right-to-left would be the one place in the app where time runs backwards.
  const recentWeeks = weeks.slice(-WEEKS_SHOWN);
  const latestWeek = recentWeeks.at(-1);

  return (
    <section className="fit__section" aria-label={s.heading}>
      <div className="fit__heading">{s.heading}</div>
      <p className="fit__note">{s.caption}</p>

      <div className="fit__ranges" role="group" aria-label={s.rangeLabel}>
        {PROGRESS_RANGES.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            className="nx-segmented__option fit__range"
            aria-pressed={range === option}
            onClick={() => setRange(option)}
          >
            {option === 90 ? s.range90 : s.range365}
          </Button>
        ))}
      </div>

      {sets.length === 0 ? (
        <EmptyState title={s.emptyTitle} description={s.emptyDescription} />
      ) : (
        <>
          <div className="fit__figures-heading">{s.volumeHeading}</div>
          <BarChart
            data={recentWeeks.map((week) => ({ label: weekLabel(week), value: week.sets }))}
          />
          <div className="fit__weeks">
            {[...recentWeeks].reverse().map((week) => (
              <div key={week.weekStart} className="fit__week">
                <span className="fit__week-day">{week.weekStart}</span>
                <span className="fit__week-figure">{setCountText(week.sets)}</span>
                {week.tonnageSets > 0 && (
                  <span className="fit__week-figure">
                    {`${s.tonnageLabel}: ${tonnageText(week.tonnageKg)} ${strings.fitness.training.session.tonnageUnit}`}
                  </span>
                )}
                <span className="fit__week-figure">{`${s.daysLabel}: ${String(week.days)}`}</span>
              </div>
            ))}
          </div>

          {latestWeek !== undefined && (
            <>
              <div className="fit__figures-heading">{s.muscleHeading}</div>
              <div className="fit__chips">
                {muscleRows(latestWeek).map(([muscle, count]) => (
                  <Chip key={muscle} variant="data">
                    {`${strings.fitness.training.muscle[muscle]}: ${String(count)}`}
                  </Chip>
                ))}
              </div>
              <p className="fit__note">{s.muscleNote}</p>
            </>
          )}

          <div className="fit__figures-heading">{s.recordsHeading}</div>
          <div className="fit__records">
            {records.map((record) => (
              <RecordCard key={record.exerciseRef} record={record} />
            ))}
          </div>
          <p className="fit__note">{s.oneRmNote}</p>
          {/* Said out loud rather than left as a suspicious gap: FIT refuses a
              calorie-burn figure for the same reason FIN refuses an exchange
              rate it cannot verify. */}
          <p className="fit__note">{s.noBurnNote}</p>
        </>
      )}
    </section>
  );
}

/** „3.8." — the week's Monday, short, because twelve of them share one axis. */
function weekLabel(week: WeekVolume): string {
  const [, month, day] = week.weekStart.split("-");
  return `${String(Number(day))}.${String(Number(month))}.`;
}

/** One week's per-muscle counts, busiest first — the order somebody reads „what did I actually train". */
function muscleRows(week: WeekVolume): [MuscleGroup, number][] {
  return (Object.entries(week.hardSets) as [MuscleGroup, number][]).sort(
    (left, right) => right[1] - left[1],
  );
}

/**
 * One exercise's records. Only the lines that HAVE an answer are drawn — a card
 * with three em dashes on it would be four questions the exercise does not
 * raise, printed as four failures to answer them.
 */
function RecordCard({ record }: { record: ExerciseRecords }): ReactNode {
  const s = strings.fitness.training;
  const r = s.progress.record;
  const rows: { label: string; value: string; day: string }[] = [];

  if (record.heaviest !== null) {
    const { weightKg, reps } = record.heaviest.value;
    rows.push({
      label: r.heaviest,
      value:
        reps === null
          ? `${tonnageText(weightKg)} ${s.set.unitKg}`
          : `${tonnageText(weightKg)} ${s.set.unitKg} ${s.set.times} ${String(reps)} ${s.set.unitReps}`,
      day: record.heaviest.day,
    });
  }
  if (record.bestOneRm !== null) {
    rows.push({
      label: r.bestOneRm,
      value: `${tonnageText(record.bestOneRm.value.kg)} ${s.set.unitKg}`,
      day: record.bestOneRm.day,
    });
  }
  if (record.mostReps !== null) {
    const { reps, weightKg } = record.mostReps.value;
    rows.push({
      label: r.mostReps,
      value:
        weightKg === null
          ? `${String(reps)} ${s.set.unitReps}`
          : `${String(reps)} ${s.set.unitReps} ${s.set.times} ${tonnageText(weightKg)} ${s.set.unitKg}`,
      day: record.mostReps.day,
    });
  }
  if (record.longestHold !== null) {
    rows.push({
      label: r.longestHold,
      value: `${String(record.longestHold.value)} ${s.set.unitSeconds}`,
      day: record.longestHold.day,
    });
  }
  if (record.leastAssistance !== null) {
    const { weightKg, reps } = record.leastAssistance.value;
    rows.push({
      label: r.leastAssistance,
      value: `${s.set.assistPrefix}${tonnageText(weightKg)} ${s.set.unitKg} ${s.set.times} ${String(reps)} ${s.set.unitReps}`,
      day: record.leastAssistance.day,
    });
  }

  if (rows.length === 0) return null;
  return (
    <div className="fit__record">
      <div className="fit__exercise-head">
        <span className="fit__row-title">{record.label}</span>
        <Chip>{setCountText(record.sets)}</Chip>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="fit__record-row">
          <span className="fit__record-label">{row.label}</span>
          <span className="fit__record-value">{row.value}</span>
          <span className="fit__record-day">{row.day}</span>
        </div>
      ))}
    </div>
  );
}

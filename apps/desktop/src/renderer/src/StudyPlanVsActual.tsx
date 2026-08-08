import { useEffect, useState } from "react";
import { ChartLegend, ColumnPlot, EmptyState, LoadingState } from "@nexus/ui";
import type { FocusSession, StudyBlockWithExam } from "../../shared/ipc.js";
import { localTodayKey, shiftDayKey } from "./examDates.js";
import { focusSessionMinutes } from "./focusFormat.js";
import { dayUnit, strings } from "./strings.js";

/**
 * „Plan i stvarnost" — STUDY's signature graphic: the last two weeks, one
 * slot per day, two GROUPED columns — what the plan asked for beside what
 * the focus timer actually measured.
 *
 * **GROUPED, never stacked.** The two series are two measurements of the
 * same day, not two parts of a total: `planirano` is `StudyBlock.minutes`,
 * a number a plan wrote down in advance; `izmereno` is `focusSessionMinutes`
 * summed over the day's finished phases, the one place measured attention
 * exists in this app. Stacking them would draw a column whose height is a
 * quantity that does not exist. Neither is an "adherence percentage" either:
 * a block never stores an actual duration, so blending the two into one
 * blended figure would be an invented number standing where two real ones
 * belong — two bars side by side is the whole honest comparison.
 *
 * Both series own their zero: a day with no block planned is a real 0
 * minutes planned, and a day with no finished phase is a real 0 minutes
 * measured — neither is a gap to leave blank.
 *
 * This component owns its own read (mirrors `FitProgress`'s self-fetching
 * signature graphic): the fourteen-day window it needs is wider than
 * anything `StudyPage` already keeps loaded, so it asks
 * `blocks:list-in-range` and `focus:list-range` directly rather than
 * growing the page's own mount-time fan-out for one panel.
 */

/** The window this graphic covers — two weeks, oldest day left. */
const WINDOW_DAYS = 14;

export interface StudyPlanVsActualProps {
  profileId: string;
}

/** "8.8." — a slot's day, short, because fourteen of them share one axis (`FitProgress`'s `weekLabel`, one module over). */
function dayLabel(day: string): string {
  const [, month, date] = day.split("-");
  return `${String(Number(date))}.${String(Number(month))}.`;
}

export function StudyPlanVsActual({ profileId }: StudyPlanVsActualProps) {
  const s = strings.study.chart;
  const today = localTodayKey();
  const from = shiftDayKey(today, -(WINDOW_DAYS - 1));

  const [blocks, setBlocks] = useState<StudyBlockWithExam[] | null>(null);
  const [sessions, setSessions] = useState<FocusSession[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    void (async () => {
      try {
        const [nextBlocks, nextSessions] = await Promise.all([
          window.nexus.listBlocksInRange(profileId, from, today),
          window.nexus.listFocusRange(profileId, from, today),
        ]);
        if (!active) return;
        setBlocks(nextBlocks);
        setSessions(nextSessions);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load the plan-vs-actual chart:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, from, today]);

  if (failed) {
    return <EmptyState sigil="study" title={s.heading} description={strings.study.actionError} />;
  }
  if (blocks === null || sessions === null) {
    return <LoadingState label={strings.app.loading} rows={3} />;
  }

  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => shiftDayKey(from, i));

  const plannedByDay = new Map<string, number>();
  for (const block of blocks) {
    plannedByDay.set(block.blockDate, (plannedByDay.get(block.blockDate) ?? 0) + block.minutes);
  }
  // Bucketed by the LOCAL day of `startedAt` — `localTodayKey` reads the
  // wall-clock y/m/d off whatever `Date` it is given, which is exactly what a
  // session's own local day is, not its UTC one.
  const actualByDay = new Map<string, number>();
  for (const session of sessions) {
    const day = localTodayKey(new Date(session.startedAt));
    actualByDay.set(day, (actualByDay.get(day) ?? 0) + focusSessionMinutes(session));
  }

  const plannedValues = days.map((day) => plannedByDay.get(day) ?? 0);
  const actualValues = days.map((day) => actualByDay.get(day) ?? 0);
  const totalPlanned = plannedValues.reduce((sum, value) => sum + value, 0);
  const totalActual = actualValues.reduce((sum, value) => sum + value, 0);
  const empty = totalPlanned === 0 && totalActual === 0;

  const windowPhrase = `${String(WINDOW_DAYS)} ${dayUnit(
    WINDOW_DAYS,
    strings.study.countdown.unitOne,
    strings.study.countdown.unitMany,
  )}`;
  const description = empty
    ? s.emptyReason
    : `${s.descriptionLead}, ${windowPhrase}: ${s.descriptionPlanned} ${String(totalPlanned)} ` +
      `${s.minuteUnit}, ${s.descriptionActual} ${String(totalActual)} ${s.minuteUnit}.`;

  return (
    <div className="nx-chart-group">
      <ColumnPlot
        title={s.heading}
        description={description}
        caption={s.caption}
        empty={empty ? { reason: s.emptyReason } : null}
        layout="grouped"
        slots={days.map((day) => ({ key: day, label: dayLabel(day) }))}
        series={[
          { key: "planirano", tone: "neutral", values: plannedValues },
          { key: "izmereno", tone: "accent", values: actualValues },
        ]}
        width={720}
        /* `ColumnPlot`'s default is 160px, which is a strip — and this chart is
           STUDY's identity, drawn at the top of the hub rather than tucked under
           the statistics at the bottom. Twenty-eight bars over fourteen days
           need vertical room before a difference between two of them is a thing
           the eye can measure rather than infer. */
        height={240}
      />
      {!empty && (
        <ChartLegend
          inline
          items={[
            { label: s.plannedLabel, tone: "neutral", shape: "swatch" },
            { label: s.actualLabel, tone: "accent", shape: "swatch" },
          ]}
        />
      )}
    </div>
  );
}

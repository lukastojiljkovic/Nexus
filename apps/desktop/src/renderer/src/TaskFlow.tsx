import { ChartLegend, ColumnPlot } from "@nexus/ui";
import type { WeekStart } from "@nexus/core";
import type { Task } from "../../shared/ipc.js";
import { shiftDay, weekStartKey } from "./habitDone.js";
import { countUnit, strings } from "./strings.js";

/**
 * „Priliv i odliv" — TASK's signature graphic: how many tasks came into
 * existence each week, set against how many were closed, over the last
 * `FLOW_WEEKS` weeks.
 *
 * GROUPED, NEVER STACKED. Stacking „nastalo" on „zatvoreno" would draw a
 * column whose height is a number that does not exist — a week with ten
 * tasks made and ten tasks closed would tower over a week where nothing
 * happened at all, and nothing on screen would say the total was
 * meaningless. Standing the two series side by side keeps every bar's
 * height a number that is actually true of something (`ColumnPlot`'s own
 * `layout` doc states this rule once; this file only applies it).
 *
 * „ZATVORENO" IS A FLOOR, NOT A COUNT, and the caption already tells the
 * user so. Stated here for the next programmer, because none of the three
 * reasons is reachable from the two arrays this component builds:
 *  - a DELETED task leaves the list entirely, taking its `createdAt` out of
 *    history with it — the week it was made in loses a bar right along
 *    with the week it would have closed in;
 *  - REOPENING a task nulls `completedAt` (ADR-024's completion path), so a
 *    task counted here today can silently uncount itself tomorrow;
 *  - a RECURRING task stamps no `completedAt` at all until its rule is
 *    exhausted — a series that runs for years contributes to „nastalo"
 *    exactly once and to „zatvoreno" never, however many occurrences it has
 *    actually satisfied.
 * The drawing cannot know any of this; it can only ever undercount.
 */

/** How many ISO weeks the flow reaches back — a quarter, oldest week left. */
const FLOW_WEEKS = 12;
const DAYS_PER_WEEK = 7;

/** „3.8." — a week's opening day, short, because twelve of them share one axis. */
function weekLabel(day: string): string {
  const [, month, date] = day.split("-");
  return `${String(Number(date))}.${String(Number(month))}.`;
}

export interface TaskFlowProps {
  tasks: readonly Task[];
  today: string;
  weekStart: WeekStart;
}

export function TaskFlow({ tasks, today, weekStart }: TaskFlowProps) {
  const s = strings.tasks.chart;

  // Twelve real weeks, oldest first, each identified by the bare day it
  // opens on — the same key `weekStartKey` hands back for any day inside it.
  const firstOpen = shiftDay(weekStartKey(today, weekStart), -(FLOW_WEEKS - 1) * DAYS_PER_WEEK);
  const weeks = Array.from({ length: FLOW_WEEKS }, (_, i) => shiftDay(firstOpen, i * DAYS_PER_WEEK));
  const slotByWeek = new Map(weeks.map((opens, index) => [opens, index]));

  const created = new Array<number>(FLOW_WEEKS).fill(0);
  const completed = new Array<number>(FLOW_WEEKS).fill(0);
  for (const task of tasks) {
    const createdSlot = slotByWeek.get(weekStartKey(task.createdAt.slice(0, 10), weekStart));
    if (createdSlot !== undefined) created[createdSlot] = (created[createdSlot] ?? 0) + 1;
    if (task.completedAt !== null) {
      const completedSlot = slotByWeek.get(weekStartKey(task.completedAt.slice(0, 10), weekStart));
      if (completedSlot !== undefined) completed[completedSlot] = (completed[completedSlot] ?? 0) + 1;
    }
  }

  const totalCreated = created.reduce((sum, count) => sum + count, 0);
  const totalCompleted = completed.reduce((sum, count) => sum + count, 0);
  /**
   * Nothing to draw means NEITHER series has anything in it.
   *
   * Gating on the created total alone looks equivalent and is not: a fortnight
   * spent clearing an old backlog creates nothing and closes plenty, and that
   * is the single most encouraging picture this chart can show. Hiding it
   * behind „nema još ničega" would blank the screen on the best week somebody
   * had.
   */
  const nothingHappened = totalCreated === 0 && totalCompleted === 0;

  // Composed from the very arrays the bars are drawn from, so the sentence
  // can never name a total the columns do not show.
  const description =
    `${s.descriptionLead} kroz ${String(FLOW_WEEKS)} ` +
    `${countUnit(FLOW_WEEKS, s.weekUnitOne, s.weekUnitFew, s.weekUnitMany)}: ` +
    `${s.createdLabel.toLowerCase()} ${String(totalCreated)}, ` +
    `${s.completedLabel.toLowerCase()} ${String(totalCompleted)}.`;

  return (
    <div className="nx-chart-group">
      <ColumnPlot
        title={s.heading}
        description={description}
        caption={s.caption}
        empty={nothingHappened ? { reason: s.emptyReason } : null}
        slots={weeks.map((opens) => ({ key: opens, label: weekLabel(opens) }))}
        series={[
          { key: "created", tone: "accent", values: created },
          { key: "completed", tone: "data", values: completed },
        ]}
        layout="grouped"
        width={720}
      />
      {!nothingHappened && (
        <ChartLegend
          inline
          items={[
            { label: s.createdLabel, tone: "accent", shape: "swatch" },
            { label: s.completedLabel, tone: "data", shape: "swatch" },
          ]}
        />
      )}
    </div>
  );
}

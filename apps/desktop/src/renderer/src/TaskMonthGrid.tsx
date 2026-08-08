import { useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { Button, Icon } from "@nexus/ui";
import { layoutMonthBars, monthGridDays, monthKeyOf, shiftMonthKey } from "@nexus/core";
import type { MonthGridDay, SpanItem } from "@nexus/core";
import { localTodayKey } from "./examDates.js";
import { strings } from "./strings.js";
import { readStoredWeekStart, toWeekStart } from "./weekStart.js";

/** Lanes a week row draws before the rest collapse into a muted "+N" (see `TaskMonthGrid`). */
const VISIBLE_LANES = 3;

/** One task as this grid needs it: a bar between two days, or — with no `endKey` — nothing to place at all. */
export interface TaskMonthItem {
  id: string;
  title: string;
  /** First day the bar covers; equal to `endKey` for a task with only a rok. */
  startKey: string;
  endKey: string;
  done: boolean;
}

export interface TaskMonthGridProps {
  /** The tasks that have a rok, already reduced to bars by the page. */
  items: readonly TaskMonthItem[];
  /** The tasks that have none — drawn in the strip below, where they can still be dragged onto a day. */
  undated: readonly { id: string; title: string; done: boolean }[];
  /** A bar (or an undated chip) was clicked — the page loads that task into its edit form. */
  onOpen: (taskId: string) => void;
  /** A task was dropped on `dayKey` — the page writes it as that task's rok. */
  onMoveToDay: (taskId: string, dayKey: string) => void;
}

const weekdayFormatter = new Intl.DateTimeFormat("sr-Latn", { weekday: "short", timeZone: "UTC" });
const dayAriaFormatter = new Intl.DateTimeFormat("sr-Latn", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const monthLabelFormatter = new Intl.DateTimeFormat("sr-Latn", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Bare-day/month formatting in UTC; degrades to the raw key on bad input (CalendarPage's own rule). */
function formatUtcKey(key: string, formatter: Intl.DateTimeFormat): string {
  const date = new Date(key);
  return Number.isNaN(date.getTime()) ? key : formatter.format(date);
}

function chunkWeeks(days: readonly MonthGridDay[]): MonthGridDay[][] {
  const weeks: MonthGridDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/**
 * The TASK module's month grid (ADR-050) — one bar per task, on the days its
 * „Počinje“ and „Rok“ name.
 *
 * A THIN component over `@nexus/core`'s `monthGridDays`/`layoutMonthBars`, and
 * deliberately not a second caller of `CalendarMonth`: that grid is the CAL
 * module's, it speaks in `CalendarItem`s drawn from five sources, and it carries
 * a week-expansion, a day-view jump and a timed-chip lane that mean nothing over
 * a list of tasks. What the two DO share is their look, which is why this one
 * renders into the same `cal__month-*` classes rather than a parallel set: two
 * month grids in one app that differ visually would read as an accident.
 *
 * It owns its own month, and that is the whole reason it needs no data plumbing:
 * the page already holds every task of the selected list, so navigating months
 * is a re-layout rather than a fetch. „Danas“ returns to the month the user is
 * actually in.
 *
 * Overflow collapses into a muted „+N još“ with NO drill-in — unlike CAL's, this
 * grid has no week-expansion and no day view to open, so the label states a fact
 * rather than offering a door that goes nowhere. The rok is still reachable: the
 * bar is in the list, the cards and the board too.
 */
export function TaskMonthGrid({ items, undated, onOpen, onMoveToDay }: TaskMonthGridProps) {
  const [weekStart] = useState(() => toWeekStart(readStoredWeekStart()));
  const todayKey = localTodayKey();
  const [monthKey, setMonthKey] = useState(() => monthKeyOf(todayKey));
  const [dropDayKey, setDropDayKey] = useState<string | null>(null);
  // Bars sit above the day cells, so while a drag is in flight they must stop
  // taking pointer events — otherwise dropping ONTO an existing bar silently
  // does nothing, which is exactly where a user aims (CalendarMonth's rule).
  const [dragging, setDragging] = useState(false);
  const draggedId = useRef<string | null>(null);

  const weeks = chunkWeeks(monthGridDays(monthKey, weekStart));
  const itemById = new Map(items.map((item) => [item.id, item] as const));
  const barItems: SpanItem[] = items.map((item) => ({
    id: item.id,
    startKey: item.startKey,
    endKey: item.endKey,
  }));

  function startDrag(event: DragEvent, taskId: string): void {
    draggedId.current = taskId;
    setDragging(true);
    event.dataTransfer.effectAllowed = "move";
    // Firefox needs a payload for the drag to start; identity travels via ref.
    event.dataTransfer.setData("text/plain", taskId);
  }

  function endDrag(): void {
    draggedId.current = null;
    setDragging(false);
    setDropDayKey(null);
  }

  function dayDragOver(event: DragEvent, dayKey: string): void {
    if (draggedId.current === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropDayKey !== dayKey) setDropDayKey(dayKey);
  }

  function dayDragLeave(event: DragEvent<HTMLDivElement>, dayKey: string): void {
    if (dropDayKey === dayKey && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDropDayKey(null);
    }
  }

  function dayDrop(event: DragEvent, dayKey: string): void {
    const taskId = draggedId.current;
    if (taskId === null) return;
    event.preventDefault();
    onMoveToDay(taskId, dayKey);
    endDrag();
  }

  function openBar(event: MouseEvent, taskId: string): void {
    // Stops the click from also reaching the day cell beneath it.
    event.stopPropagation();
    onOpen(taskId);
  }

  const s = strings.tasks.calendar;

  return (
    <div className="cal__month">
      <div className="cal__month-nav">
        <span className="cal__month-label">{formatUtcKey(`${monthKey}-01`, monthLabelFormatter)}</span>
        <span className="cal__month-nav-actions">
          <Button
            size="sm"
            aria-label={s.prevMonth}
            onClick={() => setMonthKey((key) => shiftMonthKey(key, -1))}
          >
            <Icon name="chevronLeft" size={14} />
          </Button>
          <Button size="sm" onClick={() => setMonthKey(monthKeyOf(localTodayKey()))}>
            {s.today}
          </Button>
          <Button
            size="sm"
            aria-label={s.nextMonth}
            onClick={() => setMonthKey((key) => shiftMonthKey(key, 1))}
          >
            <Icon name="chevronRight" size={14} />
          </Button>
        </span>
      </div>

      {/* Deliberately NOT role="grid": the bar overlay is a row-level sibling of
          the cells, which a real grid role forbids — CalendarMonth's reasoning,
          and every cell carries its full date as an aria-label either way. */}
      <div
        className={dragging ? "cal__month-grid cal__month-grid--dragging" : "cal__month-grid"}
        role="group"
        aria-label={s.regionLabel}
      >
        {/* Decorative: each cell's own aria-label already names its weekday. */}
        <div className="cal__month-weekdays" aria-hidden="true">
          {(weeks[0] ?? []).map((day) => (
            <span key={day.key} className="nx-eyebrow cal__month-weekday">
              {formatUtcKey(day.key, weekdayFormatter)}
            </span>
          ))}
        </div>

        {weeks.map((week) => {
          const weekKeys = week.map((day) => day.key);
          const bars = layoutMonthBars(barItems, weekKeys);
          const maxLane = bars.reduce((max, bar) => Math.max(max, bar.lane), -1);
          const laneCount = Math.min(maxLane + 1, VISIBLE_LANES);
          const visibleBars = bars.filter((bar) => bar.lane < laneCount);
          const hiddenBars = bars.filter((bar) => bar.lane >= laneCount);

          return (
            <div key={weekKeys.join("/")} className="cal__month-week">
              <div className="cal__month-cells">
                {week.map((day, dayIndex) => {
                  const hiddenCount = hiddenBars.filter(
                    (bar) => dayIndex >= bar.dayIndex && dayIndex < bar.dayIndex + bar.span,
                  ).length;
                  const classes = ["cal__month-day"];
                  if (!day.inMonth) classes.push("cal__month-day--out");
                  if (dropDayKey === day.key) classes.push("cal__month-day--drop");
                  return (
                    <div
                      key={day.key}
                      className={classes.join(" ")}
                      aria-label={formatUtcKey(day.key, dayAriaFormatter)}
                      onDragOver={(event) => dayDragOver(event, day.key)}
                      onDragLeave={(event) => dayDragLeave(event, day.key)}
                      onDrop={(event) => dayDrop(event, day.key)}
                    >
                      {/* A span, not a button: this grid has no day view to jump
                          to, and a control that cannot act is one this app does
                          not draw. */}
                      <span
                        className={
                          day.key === todayKey
                            ? "cal__month-day-number cal__month-day-number--today"
                            : "cal__month-day-number"
                        }
                      >
                        {Number(day.key.slice(8, 10))}
                      </span>
                      <div
                        className="cal__month-spacer"
                        style={{ height: `calc(var(--cal-bar-h) * ${laneCount})` }}
                      />
                      {hiddenCount > 0 && (
                        <span className="tasks__cal-more">
                          +{hiddenCount} {s.moreSuffix}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="cal__month-bars">
                {visibleBars.map((bar) => {
                  const item = itemById.get(bar.id);
                  if (!item) return null;
                  const classes = ["cal__month-bar", "tasks__cal-bar"];
                  if (bar.continuesBefore) classes.push("cal__month-bar--continues-before");
                  if (bar.continuesAfter) classes.push("cal__month-bar--continues-after");
                  // Finished work stays visible and goes quiet — the exact
                  // treatment CAL gives a done task, never a colour change.
                  if (item.done) classes.push("cal__month-bar--muted");
                  return (
                    <button
                      key={bar.id}
                      type="button"
                      className={classes.join(" ")}
                      style={{
                        left: `calc(${bar.dayIndex} / 7 * 100%)`,
                        width: `calc(${bar.span} / 7 * 100%)`,
                        top: `calc(${bar.lane} * var(--cal-bar-h))`,
                      }}
                      draggable
                      onClick={(event) => openBar(event, item.id)}
                      onDragStart={(event) => startDrag(event, item.id)}
                      onDragEnd={endDrag}
                    >
                      <span className="cal__month-bar-label">{item.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* A calendar can only show what has a date, and a task without a rok is
          not a task without a place: it sits below the grid, where dragging it
          onto a day is what gives it one. */}
      {undated.length > 0 && (
        <div className="tasks__cal-undated" role="group" aria-label={s.undatedLabel}>
          <span className="tasks__cal-undated-label">{s.undatedLabel}</span>
          <div className="tasks__cal-undated-items">
            {undated.map((task) => (
              <button
                key={task.id}
                type="button"
                className={
                  task.done
                    ? "tasks__cal-chip tasks__cal-chip--done"
                    : "tasks__cal-chip"
                }
                draggable
                onClick={() => onOpen(task.id)}
                onDragStart={(event) => startDrag(event, task.id)}
                onDragEnd={endDrag}
              >
                {task.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

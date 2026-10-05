import { useEffect, useRef, useState } from "react";
import type { DragEvent, MouseEvent, ReactNode } from "react";
import { isoWeekNumber, layoutMonthBars, monthGridDays } from "@nexus/core";
import type { MonthGridDay, SpanItem, WeekStart } from "@nexus/core";
import { Icon } from "@nexus/ui";
import type { Event } from "../../shared/ipc.js";
import { isMutedItem, isSpanItem, isTimedEventItem, isTimedForeignItem } from "./calendarItems.js";
import type {
  CalendarItem,
  EventOccurrence,
  TimedEventItem,
  TimedForeignItem,
} from "./calendarItems.js";
import { formatClockLabel } from "./calendarPrefs.js";
import type { ClockPreference } from "./calendarPrefs.js";
import { collator, dateTimeFormat } from "./intl.js";
import { RecurrenceMark } from "./RecurrencePicker.js";
import { strings } from "./strings.js";

/** Lanes shown before a week row collapses its overflow into "+N još". */
const VISIBLE_LANES = 3;
/** Total stacked rows (bar lanes + timed chips) a cell budgets for before collapsing. */
const TOTAL_ROWS = 4;

export interface CalendarMonthProps {
  monthKey: string;
  todayKey: string;
  /**
   * Which weekday the grid rows open on (PRD 04 §5). Comes from the page, not
   * from a constant here: the weekday header row is read off the first week the
   * layout engine returns, so the header and the rows can never disagree.
   */
  weekStart: WeekStart;
  /** Which clock a timed chip's time is drawn in (CAL §5) — the page reads the preference; the grid only obeys it. */
  clock: ClockPreference;
  items: readonly CalendarItem[];
  /** Click on a day cell's empty area — the page prefills the form's date. */
  onSelectDay: (dayKey: string) => void;
  /** Click on a day cell's number — the page switches to that day's Dan view. */
  onOpenDay: (dayKey: string) => void;
  /**
   * Click on an event bar/chip — the page loads it into the form. `occurrence`
   * is non-null when the clicked bar is one occurrence of a series (ADR-024),
   * so the page knows which day the edit is anchored on.
   */
  onEditEvent: (event: Event, occurrence: EventOccurrence | null) => void;
  /** Click on a birthday bar — the page switches to its Ljudi panel (ADR-026); a birthday is edited there, never from the grid. */
  onOpenPeople: () => void;
  /**
   * Click on a FOREIGN bar/chip (CAL-005): the page opens the origin popover
   * anchored on the clicked element's rect. Never an editor — foreign items
   * are unopenable guests, and they never join a drag either.
   */
  onOpenForeign: (anchor: DOMRect) => void;
  /** A drag finished on `dayKey`; only events and tasks are draggable. */
  onMoveItem: (item: CalendarItem, dayKey: string) => void;
}

/** Bare-day formatting; degrades to the raw key on bad input (mirrors CalendarPage's formatDay). */
function formatUtcKey(key: string, formatter: Intl.DateTimeFormat): string {
  const date = new Date(key);
  return Number.isNaN(date.getTime()) ? key : formatter.format(date);
}

function chunkWeeks(days: readonly MonthGridDay[]): MonthGridDay[][] {
  const weeks: MonthGridDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** Display text shared by bars and chips — the subject-bearing kinds reuse the agenda's own phrasing. Exported for the week/day grid, which draws the same bars. */
export function itemLabel(item: CalendarItem): string {
  switch (item.kind) {
    case "event":
      return item.event.title;
    case "task":
      return item.task.title;
    case "exam":
    case "block":
      return `${item.subject.name} — ${strings.study.examType[item.exam.examType]}`;
    // Typographic, never an emoji: the name, plus the years this occurrence
    // marks when the year is known ("Ana (30)"). A parenthesized number reads
    // as an age for a birthday and as the anniversary's count for the other
    // kind, so one composition serves both.
    case "birthday":
      return item.age === null ? item.person.name : `${item.person.name} (${item.age})`;
    case "foreign":
      return item.foreign.title;
    // The subscription's own name and nothing else: the amount rides its own
    // chip in the agenda, and a month cell has room for a word, not a figure.
    case "subscription":
      return item.renewal.name;
  }
}

/**
 * The origin marker every cross-profile item carries (CAL-005 / ADR-058 §5) —
 * the drawn `swap` icon, never a new hue: it reads as "from the other side",
 * and the popover behind the item says which profile in words. Exported for
 * the week/day grid and the agenda, which mark the same guests.
 */
export function ForeignMark() {
  return (
    <span className="cal__foreign-mark" role="img" aria-label={strings.calendar.overlay.markerLabel}>
      <Icon name="swap" size={14} />
    </span>
  );
}

/** A subject-swatch dot (exam/block), a series marker (a recurring event's occurrence) or the swap origin marker (a foreign item), followed by the ellipsized label. Exported for the week/day grid's all-day band, which reuses these very classes. */
export function renderBarContent(item: CalendarItem): ReactNode {
  // Computed once: every branch below both shows this text AND needs it again
  // verbatim as `title` — CSS ellipsises `.cal__month-bar-label` with no way
  // back to the clipped part, and `title` is that way back.
  const label = itemLabel(item);
  switch (item.kind) {
    case "exam":
    case "block":
      return (
        <>
          <span className={`study__dot study__dot--${item.subject.color}`} aria-hidden="true" />
          <span className="cal__month-bar-label" title={label}>
            {label}
          </span>
        </>
      );
    case "event":
      return (
        <>
          {item.occurrence !== null && <RecurrenceMark />}
          <span className="cal__month-bar-label" title={label}>
            {label}
          </span>
        </>
      );
    case "foreign":
      return (
        <>
          <ForeignMark />
          <span className="cal__month-bar-label" title={label}>
            {label}
          </span>
        </>
      );
    default:
      return (
        <span className="cal__month-bar-label" title={label}>
          {label}
        </span>
      );
  }
}

/**
 * Month grid (ADR-020). A pure function of `items`: geometry comes entirely
 * from `@nexus/core`'s calendarGrid module (percent-based bar placement, no
 * DOM measurement). Day-granular and multi-day items (all-day events, tasks,
 * exams, study blocks) become bars in a row-spanning overlay; a single-day
 * timed event becomes an "HH:MM — title" chip inside its own cell instead.
 */
export function CalendarMonth({
  monthKey,
  todayKey,
  weekStart,
  clock,
  items,
  onSelectDay,
  onOpenDay,
  onEditEvent,
  onOpenPeople,
  onOpenForeign,
  onMoveItem,
}: CalendarMonthProps) {
  const [expandedWeeks, setExpandedWeeks] = useState<ReadonlySet<number>>(new Set());
  const [dropDayKey, setDropDayKey] = useState<string | null>(null);
  // Bars and chips sit above the day cells, so while a drag is in flight they
  // must stop taking pointer events — otherwise dropping *onto* an existing
  // item silently does nothing, which is exactly where a user aims when moving
  // something next to something else.
  const [dragging, setDragging] = useState(false);
  const dragged = useRef<CalendarItem | null>(null);

  // A new month starts collapsed — an expanded row index carried across
  // navigation would point at an unrelated week.
  useEffect(() => setExpandedWeeks(new Set()), [monthKey]);

  const weeks = chunkWeeks(monthGridDays(monthKey, weekStart));
  const itemById = new Map(items.map((item) => [item.id, item] as const));
  const barItems: SpanItem[] = items
    .filter(isSpanItem)
    .map((item) => ({ id: item.id, startKey: item.startKey, endKey: item.endKey }));
  // Timed foreign occurrences share the chip lane with the profile's own timed
  // events (CAL-005) — same geometry, entirely different affordances: a
  // foreign chip opens the origin popover and never drags.
  const chipItems: (TimedEventItem | TimedForeignItem)[] = [
    ...items.filter(isTimedEventItem),
    ...items.filter(isTimedForeignItem),
  ];

  function toggleWeek(weekIndex: number): void {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekIndex)) next.delete(weekIndex);
      else next.add(weekIndex);
      return next;
    });
  }

  function activateEvent(event: MouseEvent, item: CalendarItem & { kind: "event" }): void {
    // Stops the click from also reaching the day cell's onSelectDay beneath.
    event.stopPropagation();
    onEditEvent(item.event, item.occurrence);
  }

  function startDrag(event: DragEvent, item: CalendarItem): void {
    dragged.current = item;
    setDragging(true);
    event.dataTransfer.effectAllowed = "move";
    // Firefox needs a payload for the drag to start; identity travels via ref.
    event.dataTransfer.setData("text/plain", item.id);
  }

  function endDrag(): void {
    dragged.current = null;
    setDragging(false);
    setDropDayKey(null);
  }

  function dayDragOver(event: DragEvent, dayKey: string): void {
    if (!dragged.current) return;
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
    const item = dragged.current;
    if (!item) return;
    event.preventDefault();
    onMoveItem(item, dayKey);
    endDrag();
  }

  return (
    // Deliberately NOT role="grid": the bar overlay is a row-level sibling of
    // the cells, which a real grid role forbids, and every cell already carries
    // its full date as an aria-label. A half-honoured grid role reads worse to
    // a screen reader than none at all.
    <div
      className={
        "cal__month-grid cal__month-grid--weeknum" +
        (dragging ? " cal__month-grid--dragging" : "")
      }
      role="group"
      tabIndex={0}
      aria-label={strings.calendar.viewMesec}
    >
      {/* Decorative: each cell's own aria-label already names its weekday. The
          leading cell heads the week-number gutter below it. */}
      <div className="cal__month-weekdays" aria-hidden="true">
        <span className="cal__month-weeknum-head" title={strings.calendar.weekNumber.title}>
          {strings.calendar.weekNumber.abbrev}
        </span>
        {(weeks[0] ?? []).map((day) => (
          <span key={day.key} className="nx-eyebrow cal__month-weekday">
            {formatUtcKey(day.key, dateTimeFormat({ weekday: "short", timeZone: "UTC" }))}
          </span>
        ))}
      </div>

      {weeks.map((week, weekIndex) => {
        const weekKeys = week.map((day) => day.key);
        const expanded = expandedWeeks.has(weekIndex);
        const bars = layoutMonthBars(barItems, weekKeys);
        const maxLane = bars.reduce((max, bar) => Math.max(max, bar.lane), -1);
        const laneCount = expanded ? maxLane + 1 : Math.min(maxLane + 1, VISIBLE_LANES);
        const visibleBars = bars.filter((bar) => bar.lane < laneCount);
        const hiddenBars = bars.filter((bar) => bar.lane >= laneCount);
        const timedBudget = expanded ? Number.POSITIVE_INFINITY : Math.max(TOTAL_ROWS - laneCount, 1);

        // The ISO week this row is numbered by, read off its FOURTH day — the
        // Thursday when rows open on Monday, and the day that keeps a
        // Sunday-first row on the ISO week six of its seven days belong to
        // rather than the one its leading Sunday closes. ISO weeks are
        // Monday-based by definition, so the number a user sees never depends
        // on which weekday they chose to open their rows on (see isoWeekNumber).
        const weekNumberKey = weekKeys[3];

        return (
          <div key={weekKeys.join("/")} className="cal__month-week">
            {/* aria-hidden for the reason the weekday header is: a bare number
                read out before seven fully-named dates is noise, and this one
                is a scanning aid rather than content. */}
            <span
              className="cal__month-weeknum"
              aria-hidden="true"
              title={strings.calendar.weekNumber.title}
            >
              {weekNumberKey !== undefined && isoWeekNumber(weekNumberKey)}
            </span>
            <div className="cal__month-cells">
              {week.map((day, dayIndex) => {
                const dayChips = chipItems
                  .filter((item) => item.startKey === day.key)
                  .sort((a, b) => {
                    const diff = a.startMinutes - b.startMinutes;
                    return diff !== 0 ? diff : collator().compare(itemLabel(a), itemLabel(b));
                  });
                const hiddenBarCount = hiddenBars.filter(
                  (bar) => dayIndex >= bar.dayIndex && dayIndex < bar.dayIndex + bar.span,
                ).length;
                const overflow = hiddenBarCount > 0 || dayChips.length > timedBudget;
                const showMoreSlot = !expanded && overflow;
                const visibleChipCount = showMoreSlot
                  ? Math.max(timedBudget - 1, 0)
                  : Math.min(dayChips.length, Number.isFinite(timedBudget) ? timedBudget : dayChips.length);
                const visibleChips = dayChips.slice(0, visibleChipCount);
                const hiddenCount = hiddenBarCount + (dayChips.length - visibleChips.length);
                const isToday = day.key === todayKey;

                const dayClasses = ["cal__month-day"];
                if (!day.inMonth) dayClasses.push("cal__month-day--out");
                if (dropDayKey === day.key) dayClasses.push("cal__month-day--drop");

                return (
                  <div
                    key={day.key}
                    className={dayClasses.join(" ")}
                    aria-label={formatUtcKey(
                      day.key,
                      dateTimeFormat({
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        timeZone: "UTC",
                      }),
                    )}
                    onClick={() => onSelectDay(day.key)}
                    onDragOver={(e) => dayDragOver(e, day.key)}
                    onDragLeave={(e) => dayDragLeave(e, day.key)}
                    onDrop={(e) => dayDrop(e, day.key)}
                  >
                    <button
                      type="button"
                      className={
                        "cal__month-day-number" + (isToday ? " cal__month-day-number--today" : "")
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenDay(day.key);
                      }}
                    >
                      {Number(day.key.slice(8, 10))}
                    </button>
                    <div
                      className="cal__month-spacer"
                      style={{ height: `calc(var(--cal-bar-h) * ${laneCount})` }}
                    />
                    {visibleChips.length > 0 && (
                      <div className="cal__month-chips">
                        {visibleChips.map((item) =>
                          item.kind === "foreign" ? (
                            // A guest chip (CAL-005): unopenable and never
                            // draggable — its one interaction is the origin
                            // popover the page anchors on this very element.
                            <button
                              key={item.id}
                              type="button"
                              className="cal__month-chip cal__month-chip--foreign"
                              title={`${formatClockLabel(item.startMinutes, clock)} — ${item.foreign.title}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenForeign(e.currentTarget.getBoundingClientRect());
                              }}
                            >
                              <ForeignMark />
                              {formatClockLabel(item.startMinutes, clock)} — {item.foreign.title}
                            </button>
                          ) : (
                            <button
                              key={item.id}
                              type="button"
                              className="cal__month-chip"
                              title={`${formatClockLabel(item.startMinutes, clock)} — ${item.event.title}`}
                              draggable
                              onClick={(e) => activateEvent(e, item)}
                              onDragStart={(e) => startDrag(e, item)}
                              onDragEnd={endDrag}
                            >
                              {item.occurrence !== null && <RecurrenceMark />}
                              {formatClockLabel(item.startMinutes, clock)} — {item.event.title}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        className="cal__month-more"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWeek(weekIndex);
                        }}
                      >
                        +{hiddenCount} {strings.calendar.showMore}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="cal__month-bars">
              {visibleBars.map((bar) => {
                const item = itemById.get(bar.id);
                if (!item) return null;

                const style = {
                  left: `calc(${bar.dayIndex} / 7 * 100%)`,
                  width: `calc(${bar.span} / 7 * 100%)`,
                  top: `calc(${bar.lane} * var(--cal-bar-h))`,
                };
                const classes = ["cal__month-bar", `cal__month-bar--${item.kind}`];
                if (bar.continuesBefore) classes.push("cal__month-bar--continues-before");
                if (bar.continuesAfter) classes.push("cal__month-bar--continues-after");
                if (isMutedItem(item)) classes.push("cal__month-bar--muted");

                if (item.kind === "event") {
                  return (
                    <button
                      key={bar.id}
                      type="button"
                      className={classes.join(" ")}
                      style={style}
                      draggable
                      onClick={(e) => activateEvent(e, item)}
                      onDragStart={(e) => startDrag(e, item)}
                      onDragEnd={endDrag}
                    >
                      {renderBarContent(item)}
                    </button>
                  );
                }
                if (item.kind === "birthday") {
                  return (
                    <button
                      key={bar.id}
                      type="button"
                      className={classes.join(" ")}
                      style={style}
                      onClick={(e) => {
                        // Stops the click from also reaching the day cell's
                        // onSelectDay beneath, exactly as an event bar does.
                        e.stopPropagation();
                        onOpenPeople();
                      }}
                    >
                      {renderBarContent(item)}
                    </button>
                  );
                }
                if (item.kind === "foreign") {
                  return (
                    // A guest bar (CAL-005): clickable but unopenable — the
                    // click opens the origin popover, never an editor — and
                    // deliberately not draggable, so it can never join
                    // onMoveItem.
                    <button
                      key={bar.id}
                      type="button"
                      className={classes.join(" ")}
                      style={style}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenForeign(e.currentTarget.getBoundingClientRect());
                      }}
                    >
                      {renderBarContent(item)}
                    </button>
                  );
                }
                const draggableItem = item.kind === "task";
                return (
                  <div
                    key={bar.id}
                    className={classes.join(" ")}
                    style={style}
                    draggable={draggableItem}
                    onDragStart={draggableItem ? (e) => startDrag(e, item) : undefined}
                    onDragEnd={draggableItem ? endDrag : undefined}
                  >
                    {renderBarContent(item)}
                  </div>
                );
              })}
            </div>

            {/* The "+N još" buttons are gone once the row is open, so the way
                back has to be its own control — a row that cannot be collapsed
                again is a one-way door. */}
            {expanded && (
              <button
                type="button"
                className="cal__month-collapse"
                onClick={() => toggleWeek(weekIndex)}
              >
                {strings.calendar.showLess}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

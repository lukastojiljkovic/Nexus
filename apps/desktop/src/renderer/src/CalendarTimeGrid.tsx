import { useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { layoutMonthBars, layoutTimedColumns, MINUTES_PER_DAY } from "@nexus/core";
import type { Event } from "../../shared/ipc.js";
// The bar recipe (label + swatch + classes) lives with the month grid that
// defines those classes; importing it is what keeps the two views from
// drifting apart the way two copies eventually would.
import { renderBarContent } from "./CalendarMonth.js";
import { formatClock, isMutedItem, isSpanItem, isTimedEventItem } from "./calendarItems.js";
import type { CalendarItem, EventOccurrence } from "./calendarItems.js";
import { RecurrenceMark } from "./RecurrencePicker.js";
import { strings } from "./strings.js";

/** Click-to-create snaps to the half hour, same granularity FSRS-style apps default to. */
const SLOT_MINUTES = 30;
/** The "now" line is a clock, not an animation — a minute-resolution refresh is enough. */
const NOW_REFRESH_MS = 60_000;
/** Initial scroll target when today isn't in view: the conventional start of a working day. */
const DEFAULT_SCROLL_HOUR = 7;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export interface CalendarTimeGridProps {
  /** 7 keys for the week view, 1 for the day view. Ascending, consecutive. */
  dayKeys: readonly string[];
  todayKey: string;
  items: readonly CalendarItem[];
  /** Click on empty grid space — the page prefills the form's date and time. */
  onSelectSlot: (dayKey: string, minutes: number) => void;
  /** Click on a day's column header — the page switches to the day view. */
  onOpenDay: (dayKey: string) => void;
  /** Click on a timed event — the page loads it into the form; `occurrence` is non-null for one occurrence of a series (ADR-024). */
  onEditEvent: (event: Event, occurrence: EventOccurrence | null) => void;
  /** Click on a birthday bar in the all-day band — the page switches to its Ljudi panel (ADR-026). */
  onOpenPeople: () => void;
}

const weekdayFormatter = new Intl.DateTimeFormat("sr-Latn", { weekday: "short", timeZone: "UTC" });

/** "pon 3." — weekday + day number; degrades to the raw key on bad input (mirrors CalendarMonth's formatUtcKey). */
function formatColumnHeader(key: string): string {
  const date = new Date(key);
  if (Number.isNaN(date.getTime())) return key;
  return `${weekdayFormatter.format(date)} ${Number(key.slice(8, 10))}.`;
}

/** Local wall-clock minutes since midnight — the "now" line, like every other calendar value here, never touches a timezone. */
function currentMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Week and day grid (ADR-020), one component parameterized by day count: 7
 * keys draw the week, 1 key draws the day. A pure function of `items` plus a
 * local "now" tick, exactly like the month grid's pure-function-of-`items`
 * discipline — geometry comes from `@nexus/core`'s calendarGrid module, never
 * from DOM measurement (the one exception is the click-to-create handler,
 * which reads the clicked column's own live rect to turn a pixel position
 * back into a time).
 */
export function CalendarTimeGrid({
  dayKeys,
  todayKey,
  items,
  onSelectSlot,
  onOpenDay,
  onEditEvent,
  onOpenPeople,
}: CalendarTimeGridProps) {
  const [nowMinutes, setNowMinutes] = useState(currentMinutes);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowMinutes(currentMinutes()), NOW_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  // Scrolls once per distinct day range, not on every render — the page hands
  // this component a freshly-built dayKeys array on every render (it derives
  // the array from the anchor day inline), so the dependency has to be the
  // range's *content*, not that array's identity, or the user's own scroll
  // position would be fought on every keystroke elsewhere in the page.
  const dayKeysSignature = dayKeys.join(",");
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || body.scrollHeight <= 0) return;
    const hourPx = body.scrollHeight / 24;
    if (dayKeys.includes(todayKey)) {
      body.scrollTop = Math.max(0, (currentMinutes() / 60) * hourPx - body.clientHeight / 2);
    } else {
      body.scrollTop = DEFAULT_SCROLL_HOUR * hourPx;
    }
    // dayKeysSignature stands in for dayKeys (see above); todayKey is read directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKeysSignature, todayKey]);

  const itemById = new Map(items.map((item) => [item.id, item] as const));
  const bandItems = items.filter(isSpanItem);
  const timedItems = items.filter(isTimedEventItem);

  const isWeek = dayKeys.length === 7;
  const singleDayKey = dayKeys.length === 1 ? dayKeys[0] : undefined;

  const weekBars = isWeek
    ? layoutMonthBars(
        bandItems.map((item) => ({ id: item.id, startKey: item.startKey, endKey: item.endKey })),
        dayKeys,
      )
    : [];
  // Day view: layoutMonthBars demands exactly 7 consecutive keys, so a single
  // day's band items are stacked directly instead — one lane each, full width.
  const dayBars =
    !isWeek && singleDayKey !== undefined
      ? bandItems
          .filter((item) => item.startKey <= singleDayKey && item.endKey >= singleDayKey)
          .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.id.localeCompare(b.id))
      : [];
  const laneCount = isWeek
    ? weekBars.reduce((max, bar) => Math.max(max, bar.lane), -1) + 1
    : dayBars.length;

  /** One all-day band bar — reuses CalendarMonth's own bar classes so the two views cannot drift visually. */
  function renderBandBar(
    item: CalendarItem,
    geometry: { left: string; width: string; top: string },
    edges?: { continuesBefore: boolean; continuesAfter: boolean },
  ): ReactNode {
    const classes = ["cal__month-bar", `cal__month-bar--${item.kind}`];
    if (edges?.continuesBefore) classes.push("cal__month-bar--continues-before");
    if (edges?.continuesAfter) classes.push("cal__month-bar--continues-after");
    if (isMutedItem(item)) classes.push("cal__month-bar--muted");

    if (item.kind === "event") {
      return (
        <button
          key={item.id}
          type="button"
          className={classes.join(" ")}
          style={geometry}
          onClick={() => onEditEvent(item.event, item.occurrence)}
        >
          {renderBarContent(item)}
        </button>
      );
    }
    if (item.kind === "birthday") {
      return (
        <button
          key={item.id}
          type="button"
          className={classes.join(" ")}
          style={geometry}
          onClick={onOpenPeople}
        >
          {renderBarContent(item)}
        </button>
      );
    }
    return (
      <div key={item.id} className={classes.join(" ")} style={geometry}>
        {renderBarContent(item)}
      </div>
    );
  }

  /** Empty-space click in an hour column → a slot; a click on an item stops here first (see the event button below). */
  function handleColumnClick(event: MouseEvent<HTMLDivElement>, dayKey: string): void {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height <= 0) return;
    const ratio = (event.clientY - rect.top) / rect.height;
    const snapped = Math.floor((ratio * MINUTES_PER_DAY) / SLOT_MINUTES) * SLOT_MINUTES;
    const minutes = Math.min(Math.max(snapped, 0), MINUTES_PER_DAY - SLOT_MINUTES);
    onSelectSlot(dayKey, minutes);
  }

  const ariaLabel = isWeek ? strings.calendar.viewNedelja : strings.calendar.viewDan;

  return (
    // Deliberately NOT role="grid", for the same reason CalendarMonth avoids it:
    // the absolutely-positioned band/event overlays are not valid grid children.
    <div className="cal__grid" role="group" tabIndex={0} aria-label={ariaLabel}>
      <div className="cal__grid-header-row">
        <div className="cal__grid-gutter-spacer" aria-hidden="true" />
        <div className="cal__grid-headers">
          {dayKeys.map((dayKey) => {
            const isToday = dayKey === todayKey;
            return (
              <button
                key={dayKey}
                type="button"
                className={isToday ? "cal__grid-header cal__grid-header--today" : "cal__grid-header"}
                onClick={() => onOpenDay(dayKey)}
              >
                {formatColumnHeader(dayKey)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="cal__grid-band-row">
        <div className="cal__grid-gutter-spacer" aria-hidden="true" />
        <div className="cal__grid-band" style={{ height: `calc(var(--cal-bar-h) * ${laneCount})` }}>
          {isWeek
            ? weekBars.map((bar) => {
                const item = itemById.get(bar.id);
                return item
                  ? renderBandBar(
                      item,
                      {
                        left: `calc(${bar.dayIndex} / 7 * 100%)`,
                        width: `calc(${bar.span} / 7 * 100%)`,
                        top: `calc(${bar.lane} * var(--cal-bar-h))`,
                      },
                      bar,
                    )
                  : null;
              })
            : dayBars.map((item, index) =>
                renderBandBar(item, { left: "0%", width: "100%", top: `calc(${index} * var(--cal-bar-h))` }),
              )}
        </div>
      </div>

      <div className="cal__grid-body" ref={bodyRef}>
        <div className="cal__grid-gutter">
          {HOURS.map((hour) => (
            <div key={hour} className="cal__grid-hour-label">
              {formatClock(hour * 60)}
            </div>
          ))}
        </div>
        <div className="cal__grid-columns">
          {dayKeys.map((dayKey) => {
            const dayTimed = timedItems.filter((item) => item.startKey === dayKey);
            const columns = layoutTimedColumns(
              dayTimed.map((item) => ({
                id: item.id,
                startMinutes: item.startMinutes,
                endMinutes: item.endMinutes ?? item.startMinutes,
              })),
            );
            const timedById = new Map(dayTimed.map((item) => [item.id, item] as const));
            const isToday = dayKey === todayKey;

            return (
              <div
                key={dayKey}
                className="cal__grid-column"
                onClick={(event) => handleColumnClick(event, dayKey)}
              >
                {HOURS.map((hour) => (
                  <div key={hour} className="cal__grid-hour-cell" />
                ))}
                {columns.map((col) => {
                  const item = timedById.get(col.id);
                  if (!item) return null;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      className="cal__grid-event"
                      style={{
                        top: `calc(${col.startMinutes} / 60 * var(--cal-hour-h))`,
                        height: `calc((${col.endMinutes} - ${col.startMinutes}) / 60 * var(--cal-hour-h))`,
                        left: `calc(${col.column} / ${col.columns} * 100%)`,
                        width: `calc(1 / ${col.columns} * 100%)`,
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onEditEvent(item.event, item.occurrence);
                      }}
                    >
                      <span className="cal__grid-event-time">{formatClock(item.startMinutes)}</span>
                      <span className="cal__grid-event-title">
                        {item.occurrence !== null && <RecurrenceMark />}
                        {item.event.title}
                      </span>
                    </button>
                  );
                })}
                {isToday && (
                  <div
                    className="cal__grid-now"
                    style={{ top: `calc(${nowMinutes} / 60 * var(--cal-hour-h))` }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  exceedsTimeGridDragThreshold,
  isoWeekNumber,
  layoutMonthBars,
  layoutTimedColumns,
  MIN_TIMED_MINUTES,
  MINUTES_PER_DAY,
  resolveTimeGridColumn,
  resolveTimeGridMove,
  resolveTimeGridResize,
  timeGridPixelsToMinutes,
} from "@nexus/core";
import type { TimedColumn } from "@nexus/core";
import type { Event } from "../../shared/ipc.js";
// The bar recipe (label + swatch + classes) lives with the month grid that
// defines those classes; importing it is what keeps the two views from
// drifting apart the way two copies eventually would.
import { ForeignMark, renderBarContent } from "./CalendarMonth.js";
import { isMutedItem, isSpanItem, isTimedEventItem, isTimedForeignItem } from "./calendarItems.js";
import type {
  CalendarItem,
  EventOccurrence,
  TimedEventItem,
  TimedForeignItem,
} from "./calendarItems.js";
import { formatClockLabel } from "./calendarPrefs.js";
import type { ClockPreference } from "./calendarPrefs.js";
import { RecurrenceMark } from "./RecurrencePicker.js";
import { strings } from "./strings.js";

/** Click-to-create snaps to the half hour, same granularity FSRS-style apps default to. */
const SLOT_MINUTES = 30;
/** The "now" line is a clock, not an animation — a minute-resolution refresh is enough. */
const NOW_REFRESH_MS = 60_000;
/** Initial scroll target when today isn't in view: the conventional start of a working day. */
const DEFAULT_SCROLL_HOUR = 7;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
/** Bottom strip of an event block that grabs its end instead of the whole block (ADR-034). */
const RESIZE_EDGE_PX = 6;

/** Where a pointer drag currently proposes to put a timed event, and where a commit would land it. */
export interface TimedEventDragTarget {
  readonly dayKey: string;
  readonly startMinutes: number;
  /** null only when an event with no end was moved — a resize always produces one. */
  readonly endMinutes: number | null;
}

export interface CalendarTimeGridProps {
  /** 7 keys for the week view, 1 for the day view. Ascending, consecutive. */
  dayKeys: readonly string[];
  todayKey: string;
  /** Which clock the hour gutter and every block's time are drawn in (CAL §5) — the page reads the preference; the grid only obeys it. */
  clock: ClockPreference;
  items: readonly CalendarItem[];
  /** Click on empty grid space — the page prefills the form's date and time. */
  onSelectSlot: (dayKey: string, minutes: number) => void;
  /** Click on a day's column header — the page switches to the day view. */
  onOpenDay: (dayKey: string) => void;
  /** Click on a timed event — the page loads it into the form; `occurrence` is non-null for one occurrence of a series (ADR-024). */
  onEditEvent: (event: Event, occurrence: EventOccurrence | null) => void;
  /** Click on a birthday bar in the all-day band — the page switches to its Ljudi panel (ADR-026). */
  onOpenPeople: () => void;
  /** Click on a FOREIGN block/bar (CAL-005): the page opens the origin popover on the clicked element's rect — never an editor, and foreign items never join the drag below. */
  onOpenForeign: (anchor: DOMRect) => void;
  /**
   * A pointer drag of a timed event finished somewhere it did not start
   * (ADR-034). The page owns the write — including asking the scope dialog
   * first when the dragged block was one occurrence of a series — so nothing
   * here moves until the store says it did.
   */
  onMoveTimedEvent: (item: TimedEventItem, target: TimedEventDragTarget) => void;
}

/** Which edge of a timed event the gesture grabbed. */
type DragMode = "move" | "resize";

/** The live proposal of a drag: recomputed on every pointer move, committed on pointer up. */
interface DragCandidate {
  readonly dayKey: string;
  /** Columns away from the event's own day — the ghost is *translated* by this; the overlap layout is never recomputed mid-drag. */
  readonly dayOffset: number;
  readonly startMinutes: number;
  readonly endMinutes: number | null;
}

interface DragState {
  readonly pointerId: number;
  readonly mode: DragMode;
  readonly item: TimedEventItem;
  readonly homeDayKey: string;
  readonly homeIndex: number;
  readonly originX: number;
  readonly originY: number;
  /** Pointer distance (px) from the grabbed edge: the block's top for a move, its bottom for a resize. */
  readonly grabOffsetPx: number;
  /** px per hour, read off the grabbed block's own laid-out height — exact whatever the CSS says a row is worth. */
  readonly hourHeightPx: number;
  /** Rendered start minus stored start: `layoutTimedColumns` pulls a near-midnight block upwards, and the ghost has to follow it. */
  readonly renderOffset: number;
  /** True once the pointer went past the threshold. Only then is this a drag — and only then is the trailing click suppressed. */
  readonly activated: boolean;
  /** Escape was pressed: the ghost is gone, the gesture commits nothing, and it cannot re-arm. */
  readonly cancelled: boolean;
  readonly candidate: DragCandidate | null;
}

/** Top/bottom in the same rendered minutes the column already positions blocks in, plus the columns to translate by. */
interface BlockGeometry {
  readonly top: number;
  readonly bottom: number;
  readonly dayOffset: number;
}

/**
 * Where one block is drawn: its laid-out slot, or — while it is the one being
 * dragged — the candidate, expressed in that same rendered domain. A resize
 * ghost honours `MIN_TIMED_MINUTES` exactly as `layoutTimedColumns` will after
 * the commit, so the block never jumps once the write lands.
 */
function blockGeometry(col: TimedColumn, drag: DragState | null): BlockGeometry {
  const candidate = drag?.candidate ?? null;
  if (drag === null || candidate === null) {
    return { top: col.startMinutes, bottom: col.endMinutes, dayOffset: 0 };
  }
  if (drag.mode === "resize") {
    const proposed = candidate.endMinutes ?? col.endMinutes;
    return {
      top: col.startMinutes,
      bottom: Math.max(proposed, col.startMinutes + MIN_TIMED_MINUTES),
      dayOffset: 0,
    };
  }
  const top = candidate.startMinutes + drag.renderOffset;
  return { top, bottom: top + (col.endMinutes - col.startMinutes), dayOffset: candidate.dayOffset };
}

function sameCandidate(previous: DragCandidate | null, next: DragCandidate): boolean {
  return (
    previous !== null &&
    previous.dayKey === next.dayKey &&
    previous.startMinutes === next.startMinutes &&
    previous.endMinutes === next.endMinutes
  );
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
 * from DOM measurement. The two exceptions both turn a pixel position back
 * into a time and nothing else: the click-to-create handler, which reads the
 * clicked column's own live rect, and the pointer drag (ADR-034), which reads
 * the columns strip's — the arithmetic on those pixels is `@nexus/core`'s
 * timeGridDrag module, so what lives here is the gesture, not the maths.
 */
export function CalendarTimeGrid({
  dayKeys,
  todayKey,
  clock,
  items,
  onSelectSlot,
  onOpenDay,
  onEditEvent,
  onOpenPeople,
  onOpenForeign,
  onMoveTimedEvent,
}: CalendarTimeGridProps) {
  const [nowMinutes, setNowMinutes] = useState(currentMinutes);
  const bodyRef = useRef<HTMLDivElement>(null);
  // The columns strip is the drag's frame of reference: its top is minute 0 of
  // every column, and its width divides into the day columns. Read live on
  // each pointer move, because the body scrolls underneath the pointer.
  const columnsRef = useRef<HTMLDivElement>(null);
  // The gesture lives in a ref and is *mirrored* into state for rendering. A
  // pointer move is a continuous event, so React is free to re-render it at a
  // lower priority — reading the gesture out of state would let a move that
  // arrives before that render re-derive it from a stale copy and, in the worst
  // ordering, resurrect a drag Escape had just cancelled.
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // A drag ends in a `click` too (the capture retargets it onto the dragged
  // block). One flag, consumed by whichever click handler sees it first, is
  // what keeps that click from also opening the editor — or, if it somehow
  // reaches the column beneath, from creating an event.
  const suppressClickRef = useRef(false);

  /** The one writer of the gesture: ref first (handlers read it), then state (the ghost renders from it). */
  function writeDrag(next: DragState | null): void {
    dragRef.current = next;
    setDrag(next);
  }

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

  // Escape abandons a drag (ADR-034). The pointer capture is deliberately NOT
  // released here: the browser still owes this block a pointerup and the click
  // it generates, and letting those land wherever the hand happens to be would
  // turn a cancelled drag into a new event. They arrive, find the gesture
  // cancelled, and do nothing.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      const current = dragRef.current;
      if (current === null) return;
      suppressClickRef.current = true;
      writeDrag({ ...current, cancelled: true, candidate: null });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // writeDrag is a stable closure over two refs and one setter, and the rule
    // agrees — the dependency array is complete as written.
  }, [dragging]);

  /** True exactly once per drag: the click that a finished gesture still fires must do nothing. */
  function consumeSuppressedClick(): boolean {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }

  /**
   * Pointer down on an event block arms a gesture — nothing more. It becomes a
   * drag only past `exceedsTimeGridDragThreshold`, so a plain click still
   * reaches `onEditEvent` untouched. Grabbing the bottom `RESIZE_EDGE_PX`
   * arms a resize instead of a move.
   *
   * The capture goes on the block itself (never on an ancestor): the block's
   * own DOM node then stays the target of every later pointer event *and* of
   * the trailing click, which is what lets the ghost be translated into
   * another column without the drag losing its grip.
   */
  function beginDrag(
    pointerEvent: ReactPointerEvent<HTMLButtonElement>,
    item: TimedEventItem,
    col: TimedColumn,
    dayIndex: number,
  ): void {
    if (!pointerEvent.isPrimary || pointerEvent.button !== 0) return;
    // One gesture at a time: a second pointer pressed mid-drag would otherwise
    // take the state (and a second capture) away from the one in flight.
    if (dragRef.current !== null) return;
    const dayKey = dayKeys[dayIndex];
    if (dayKey === undefined) return;

    const block = pointerEvent.currentTarget;
    const rect = block.getBoundingClientRect();
    // px per hour straight off this block: its height is exactly the minutes
    // `layoutTimedColumns` gave it, whatever --cal-hour-h happens to be.
    const renderedMinutes = col.endMinutes - col.startMinutes;
    if (renderedMinutes <= 0 || rect.height <= 0) return;
    const hourHeightPx = (rect.height / renderedMinutes) * 60;

    const mode: DragMode =
      rect.bottom - pointerEvent.clientY <= RESIZE_EDGE_PX ? "resize" : "move";
    block.setPointerCapture(pointerEvent.pointerId);
    suppressClickRef.current = false;
    writeDrag({
      pointerId: pointerEvent.pointerId,
      mode,
      item,
      homeDayKey: dayKey,
      homeIndex: dayIndex,
      originX: pointerEvent.clientX,
      originY: pointerEvent.clientY,
      grabOffsetPx:
        mode === "resize"
          ? pointerEvent.clientY - rect.bottom
          : pointerEvent.clientY - rect.top,
      hourHeightPx,
      renderOffset: col.startMinutes - item.startMinutes,
      activated: false,
      cancelled: false,
      candidate: null,
    });
  }

  function updateDrag(pointerEvent: ReactPointerEvent<HTMLButtonElement>): void {
    const strip = columnsRef.current;
    const drag = dragRef.current;
    if (drag === null || strip === null) return;
    if (pointerEvent.pointerId !== drag.pointerId || drag.cancelled) return;
    if (
      !drag.activated &&
      !exceedsTimeGridDragThreshold(
        pointerEvent.clientX - drag.originX,
        pointerEvent.clientY - drag.originY,
      )
    ) {
      return;
    }

    // Live rect: the strip's top is minute 0 of every column and moves with the
    // body's scroll, so a rect snapshotted at pointer-down would drift by
    // exactly the distance scrolled.
    const stripRect = strip.getBoundingClientRect();
    const grabbedEdgeMinutes = timeGridPixelsToMinutes(
      pointerEvent.clientY - drag.grabOffsetPx - stripRect.top,
      drag.hourHeightPx,
    );

    let candidate: DragCandidate;
    if (drag.mode === "resize") {
      // A resize reads the *rendered* bottom edge — what the user is dragging
      // is what they are setting — and never leaves the event's own day.
      candidate = {
        dayKey: drag.homeDayKey,
        dayOffset: 0,
        startMinutes: drag.item.startMinutes,
        endMinutes: resolveTimeGridResize(drag.item.startMinutes, grabbedEdgeMinutes),
      };
    } else {
      const span = resolveTimeGridMove(
        { startMinutes: drag.item.startMinutes, endMinutes: drag.item.endMinutes },
        grabbedEdgeMinutes - drag.renderOffset,
      );
      const index = resolveTimeGridColumn(
        pointerEvent.clientX,
        stripRect.left,
        stripRect.width,
        dayKeys.length,
      );
      candidate = {
        dayKey: dayKeys[index] ?? drag.homeDayKey,
        dayOffset: index - drag.homeIndex,
        startMinutes: span.startMinutes,
        endMinutes: span.endMinutes,
      };
    }

    if (drag.activated && sameCandidate(drag.candidate, candidate)) return;
    writeDrag({ ...drag, activated: true, candidate });
  }

  /** Pointer up: commit the candidate, if the gesture ever became a drag and still has one. */
  function finishDrag(pointerEvent: ReactPointerEvent<HTMLButtonElement>): void {
    const finished = dragRef.current;
    if (finished === null || pointerEvent.pointerId !== finished.pointerId) return;
    writeDrag(null);
    // Below the threshold this was a click, and a click is exactly what should
    // now happen — the editor opens, as it always has.
    if (!finished.activated) return;
    suppressClickRef.current = true;
    const candidate = finished.candidate;
    if (candidate === null) return; // cancelled with Escape
    if (
      candidate.dayKey === finished.homeDayKey &&
      candidate.startMinutes === finished.item.startMinutes &&
      candidate.endMinutes === finished.item.endMinutes
    ) {
      return; // dropped exactly where it was picked up
    }
    onMoveTimedEvent(finished.item, {
      dayKey: candidate.dayKey,
      startMinutes: candidate.startMinutes,
      endMinutes: candidate.endMinutes,
    });
  }

  /** The gesture was taken away (pointercancel, or the capture lost to the OS): restore, commit nothing. */
  function abandonDrag(): void {
    const abandoned = dragRef.current;
    if (abandoned === null) return; // the ordinary case: pointerup already finished it
    if (abandoned.activated) suppressClickRef.current = true;
    writeDrag(null);
  }

  const itemById = new Map(items.map((item) => [item.id, item] as const));
  const bandItems = items.filter(isSpanItem);
  // Foreign timed occurrences share the overlap layout with the profile's own
  // blocks (CAL-005) — a foreign 10:00 meeting visibly displaces yours into a
  // half-width column — but never the gestures: only `TimedEventItem`s get
  // pointer handlers below.
  const timedItems: (TimedEventItem | TimedForeignItem)[] = [
    ...items.filter(isTimedEventItem),
    ...items.filter(isTimedForeignItem),
  ];

  const isWeek = dayKeys.length === 7;
  const singleDayKey = dayKeys.length === 1 ? dayKeys[0] : undefined;
  /** The day the week's ISO number is read off — see the header corner below. */
  const weekNumberKey = dayKeys[3];

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
    if (item.kind === "foreign") {
      // A guest bar (CAL-005): the click opens the origin popover, never an editor.
      return (
        <button
          key={item.id}
          type="button"
          className={classes.join(" ")}
          style={geometry}
          onClick={(e) => onOpenForeign(e.currentTarget.getBoundingClientRect())}
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
    // Belt and braces: a drag's trailing click is retargeted onto the block it
    // was captured by, so it should never arrive here — but a drag must never
    // be able to create an event either way.
    if (consumeSuppressedClick()) return;
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
    // `data-clock` carries CAL §5 to the stylesheet, and to nothing else: a
    // „2:00 PM“ hour label is wider than „14:00“, so the gutter it lives in
    // widens with it rather than clipping. One declaration, not a measurement.
    <div className="cal__grid" data-clock={clock} role="group" tabIndex={0} aria-label={ariaLabel}>
      <div className="cal__grid-header-row">
        {/* The week's ISO number, in the one corner this grid has spare
            (CAL-010). Read off the row's fourth day, so a Sunday-first week
            takes the number six of its seven days belong to — the month
            grid's own rule. Written out with „ned.“ rather than left as a
            bare number: alone above the hour gutter it would read as a time.
            The day view has no week to name, so it shows nothing here. */}
        <div className="cal__grid-gutter-spacer">
          {isWeek && weekNumberKey !== undefined && (
            <span className="cal__grid-weeknum" title={strings.calendar.weekNumber.title}>
              {strings.calendar.weekNumber.abbrev} {isoWeekNumber(weekNumberKey)}
            </span>
          )}
        </div>
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
              {formatClockLabel(hour * 60, clock)}
            </div>
          ))}
        </div>
        <div className="cal__grid-columns" ref={columnsRef}>
          {dayKeys.map((dayKey, dayIndex) => {
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
                  // Only the block being dragged reads the drag; every other
                  // block keeps the slot `layoutTimedColumns` gave it, which is
                  // exactly why the layout is never recomputed mid-gesture.
                  const dragged = drag !== null && drag.item.id === col.id ? drag : null;
                  const geometry = blockGeometry(col, dragged);
                  const style: CSSProperties = {
                    top: `calc(${geometry.top} / 60 * var(--cal-hour-h))`,
                    height: `calc((${geometry.bottom} - ${geometry.top}) / 60 * var(--cal-hour-h))`,
                    left: `calc(${col.column} / ${col.columns} * 100%)`,
                    width: `calc(1 / ${col.columns} * 100%)`,
                  };
                  // A block is exactly 1/columns of its day column wide, so one
                  // whole column is `columns * 100%` of the block itself — the
                  // ghost crosses days without the block ever leaving the DOM
                  // node that holds the pointer capture.
                  if (geometry.dayOffset !== 0) {
                    style.transform = `translateX(${geometry.dayOffset * col.columns * 100}%)`;
                  }
                  if (item.kind === "foreign") {
                    // A guest block (CAL-005): laid out like any other, but
                    // with NO pointer handlers — it can never arm a drag or a
                    // resize, and its click opens the origin popover instead
                    // of the editor. No resize handle either: there is no end
                    // to grab on something that cannot be changed here.
                    return (
                      <button
                        key={col.id}
                        type="button"
                        className="cal__grid-event cal__grid-event--foreign"
                        style={style}
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenForeign(event.currentTarget.getBoundingClientRect());
                        }}
                      >
                        <span className="cal__grid-event-time">
                          {formatClockLabel(item.startMinutes, clock)}
                        </span>
                        <span className="cal__grid-event-title">
                          <ForeignMark />
                          {item.foreign.title}
                        </span>
                      </button>
                    );
                  }
                  const isGhost = dragged?.candidate != null;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      className={
                        isGhost ? "cal__grid-event cal__grid-event--dragging" : "cal__grid-event"
                      }
                      style={style}
                      onPointerDown={(event) => beginDrag(event, item, col, dayIndex)}
                      onPointerMove={updateDrag}
                      onPointerUp={finishDrag}
                      onPointerCancel={abandonDrag}
                      onLostPointerCapture={abandonDrag}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (consumeSuppressedClick()) return;
                        onEditEvent(item.event, item.occurrence);
                      }}
                    >
                      <span className="cal__grid-event-time">
                        {formatClockLabel(
                          dragged?.candidate?.startMinutes ?? item.startMinutes,
                          clock,
                        )}
                      </span>
                      <span className="cal__grid-event-title">
                        {item.occurrence !== null && <RecurrenceMark />}
                        {item.event.title}
                      </span>
                      {/* Cursor affordance only (ADR-034): the mode is decided
                          from the pointer's distance to the block's bottom
                          edge, so this span never needs to be the event's
                          target — and there is nothing here for a screen
                          reader, since a drag is pointer-only. */}
                      <span className="cal__grid-event-handle" aria-hidden="true" />
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

import { useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";
import { ChartFrame, ChartLegend } from "@nexus/ui";
import type { ChartLevel } from "@nexus/ui";
import type { WeekStart } from "@nexus/core";
import type { Habit } from "../../shared/ipc.js";
import {
  habitDayStates,
  shiftDay,
  valueOn,
  weekStartKey,
  type HabitDayState,
  type HabitEntryIndex,
} from "./habitDone.js";
import { countUnit, strings } from "./strings.js";

/**
 * „Zid navika" — HABIT's signature graphic: every habit a row, every day a
 * square, the whole regimen's texture in one look.
 *
 * WHY IT IS NOT THE GRID THAT ALREADY EXISTS. `HabitsPage`'s per-habit calendar
 * answers „how is THIS habit going" and is a CONTROL — its cells are buttons and
 * a click corrects a day. The wall answers a different question — „is my regimen
 * alive" — and answers it by shape rather than by number: a pon/sre/pet habit
 * draws a striped row, a daily one a solid band, a weekly quota a scatter of
 * three marks per week. You cannot see that in any one habit's grid, and you
 * cannot see it in a column of streak chips either, because reading twelve chips
 * in sequence is not the same act as seeing twelve rows at once.
 *
 * IT IS DELIBERATELY NOT INTERACTIVE. A square this size is texture, not a
 * target, and two surfaces that write the same day is how they start
 * disagreeing about it. The wall is looked at; the day is corrected below, in
 * the habit's own calendar, whose cells ARE targets and are sized like ones.
 *
 * EVERYTHING IS ONE SVG, labels included. The names sit in the drawing's own
 * coordinate system rather than in a column of HTML beside it, which is what
 * makes the rows line up with their labels at every width — an SVG scaled down
 * by its container carries its text down with it, while a flex column beside it
 * would not.
 *
 * IT IS RE-DERIVED AT THE WIDTH IT IS GIVEN, and that is the one thing about
 * this component that is not obvious.
 *
 * An `<svg>` with a fixed `viewBox` and `preserveAspectRatio="meet"` — which is
 * `ChartFrame`'s deliberate default — can only ever SHRINK: past its natural
 * width the scale pins at 1 and every further pixel becomes empty margin, with
 * the drawing centred in the middle of it. The wall's natural width was 695,
 * so in a 1360px pane it sat as a small figure with 330px of nothing on either
 * side, its own title stranded at the far left. That is not a styling
 * complaint: the wall is the one graphic on the page whose whole subject is
 * BREADTH — eight weeks across — and a lattice given a third of the room reads
 * as a thumbnail of itself.
 *
 * So the host element is measured and the square size is computed from it, per
 * `ChartFrame`'s own instruction: „a chart that wants to fill its width does it
 * by being re-derived at the new width, not by being distorted to fit." The
 * scale therefore stays at 1 at every pane width, which is also what keeps the
 * 11px labels at 11px instead of shrinking with the drawing.
 *
 * The square is clamped at both ends. Below `MIN_CELL` a day stops being a
 * legible mark and the wall would smear; above `MAX_CELL` eight weeks of a
 * three-habit regimen would read as a chessboard rather than as texture. Inside
 * the clamp the wall fills its pane exactly; outside it, `meet` takes over
 * again and does the honest thing.
 *
 * THE HOUSE PANEL WIDTHS (320 / 720) DO NOT APPLY HERE, and this is the one
 * graphic where they cannot: those are widths a chart is DRAWN AT, and this one
 * has no width of its own — it has 56 columns, and its width is whatever they
 * come to at a readable square. Every other graphic in the app still takes one
 * of the two.
 *
 * WHAT IS NOT DRAWN IS AS DELIBERATE AS WHAT IS. A day the schedule never asked
 * for has no square at all — not a pale one. That is the whole reason the row of
 * a Mon/Wed/Fri habit reads as stripes, and it is also why the wall never
 * accuses: a quota habit asks for no particular day, so its blank days are blank
 * because nothing was owed, and painting them would be the graphic inventing a
 * debt.
 */

/** How far back the wall reaches. Eight weeks: two months, which is long enough for a regimen to have a shape and short enough to still be about now. */
export const WALL_WEEKS = 8;

const DAYS_PER_WEEK = 7;

/** The gap between two days of one week, and the wider one between two weeks. */
const DAY_GAP = 3;

/**
 * Weeks are separated by a wider gap rather than by a drawn line. The rhythm
 * does the work a hairline would have done, and adds no ink to a graphic whose
 * whole job is texture.
 */
const WEEK_GAP = 9;

/** The square's floor and ceiling — see the header on why it is clamped at both ends. */
const MIN_CELL = 7;
const MAX_CELL = 16;

/** The air above and below a square inside its habit's band. */
const CELL_INSET = 3;

/**
 * What the wall is laid out at before the host has been measured — one frame,
 * on mount only. The house panel width, so a wall that somehow never gets a
 * measurement still draws at a size the rest of the app uses.
 */
const FALLBACK_WIDTH = 720;

/**
 * The names column, in the drawing's own user space.
 *
 * Truncation is by character count and is therefore an ESTIMATE — a name of
 * sixteen wide capitals is wider than sixteen narrow lowercase ones, and no
 * amount of arithmetic here knows which the user typed. So the gutter is also
 * clipped: the estimate keeps names from looking cut off, and the clip keeps a
 * name that beats the estimate from spilling out of the graphic entirely.
 */
const GUTTER = 116;
const NAME_X = GUTTER - 10;
const NAME_MAX = 16;

/** The row of week-opening dates above the wall. */
const HEADER = 14;
const HEADER_BASELINE = 9;

/**
 * The square size a given host width affords, and the width the wall then
 * actually draws at. One derivation, used for both, so the geometry and the
 * `viewBox` can never be computed from two different cell sizes.
 */
function wallCell(hostWidth: number): number {
  const gaps = WALL_WEEKS * (DAYS_PER_WEEK - 1) * DAY_GAP + (WALL_WEEKS - 1) * WEEK_GAP;
  const perCell = (hostWidth - GUTTER - gaps) / (WALL_WEEKS * DAYS_PER_WEEK);
  return Math.min(MAX_CELL, Math.max(MIN_CELL, Math.floor(perCell)));
}

function wallWidth(cell: number): number {
  return (
    GUTTER +
    WALL_WEEKS * (DAYS_PER_WEEK * cell + (DAYS_PER_WEEK - 1) * DAY_GAP) +
    (WALL_WEEKS - 1) * WEEK_GAP
  );
}

/**
 * The width of the element the wall is drawn into, or `null` until it has been
 * measured. `ResizeObserver` rather than a window `resize` listener because the
 * pane changes width without the window doing so — the sidebar collapses, a
 * drawer opens — and a wall that only re-derived on a window resize would be
 * stale for exactly those moves.
 */
function useHostWidth(): [RefObject<HTMLDivElement | null>, number | null] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const host = ref.current;
    if (host === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    // The first delivery is the initial observation, so nothing has to measure
    // by hand before the observer starts.
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * One cell's intensity, or `null` for NOT DRAWN.
 *
 * `null` and `0` are different statements, exactly as in `CellMatrix`: `0` is a
 * day the schedule asked for and nothing was recorded, `null` is a day nothing
 * was asked. The four states come from `habitDayStates`, which is the module's
 * one definition of „urađeno"; the only thing added here is the middle of a
 * MEASURED habit — six glasses of eight is neither done nor nothing, and a wall
 * that flattened it to „propušteno" would be calling most of a day a failure.
 */
function wallLevel(
  habit: Habit,
  index: HabitEntryIndex,
  day: string,
  state: HabitDayState,
): ChartLevel | null {
  const target = habit.target;
  const value = valueOn(index, habit.id, day);
  // A binary habit has no middle: any entry already counts, so `partial` is
  // null for it by construction rather than by a special case.
  const partial: ChartLevel | null =
    target !== null && value > 0 && value < target ? (value * 2 >= target ? 2 : 1) : null;
  if (state === "satisfied") return 3;
  if (state === "missed") return partial ?? 0;
  // „unexpected" (a day off the schedule) and „unjudged" (before the habit
  // existed, today, or the future) draw nothing UNLESS something was actually
  // started on them — a Sunday's half-finished measure is a fact, and it is the
  // one thing about those days worth showing.
  return partial;
}

/** A habit's name, cut to what the gutter holds. The full name is one row down, in the list the wall summarises. */
function shortName(name: string): string {
  return name.length <= NAME_MAX ? name : `${name.slice(0, NAME_MAX - 1)}…`;
}

/** „21.7." — the day a week opens on, short, because eight of them share one line. */
function weekLabel(day: string): string {
  const [, month, date] = day.split("-");
  return `${String(Number(date))}.${String(Number(month))}.`;
}

export interface HabitWallProps {
  /** Live habits only — an archived one is no longer part of the regimen the wall is about. */
  habits: readonly Habit[];
  index: HabitEntryIndex;
  today: string;
  weekStart: WeekStart;
}

export function HabitWall({ habits, index, today, weekStart }: HabitWallProps) {
  const s = strings.habits.wall;
  // One clip per instance. `useId` rather than a constant because an id that
  // collides makes the FIRST definition win for every element referencing it —
  // the same trap that made the retired BarChart's gradient theme-blind.
  const clipId = `hab-wall-${useId().replace(/:/g, "")}`;
  // The pane the wall is drawn into, and the square that fills it. Everything
  // below is derived from this one number, so no two parts of the drawing can
  // disagree about how big a day is.
  const [hostRef, hostWidth] = useHostWidth();
  const cell = wallCell(hostWidth ?? FALLBACK_WIDTH);
  const dayStride = cell + DAY_GAP;
  const weekStride = DAYS_PER_WEEK * dayStride - DAY_GAP + WEEK_GAP;
  const rowStep = cell + 2 * CELL_INSET;

  // The window opens on a WEEK boundary, so every block of seven squares is a
  // real week and the labels above them are real dates. The last block is the
  // running week and is short by however many days are still to come — which is
  // the honest right edge, not a defect.
  const firstDay = shiftDay(weekStartKey(today, weekStart), -(WALL_WEEKS - 1) * DAYS_PER_WEEK);
  const days = Array.from({ length: WALL_WEEKS * DAYS_PER_WEEK }, (_, i) => shiftDay(firstDay, i));

  const rows = habits.map((habit) => {
    const states = habitDayStates(habit, index, days, today);
    return {
      habit,
      levels: days.map((day, i) => wallLevel(habit, index, day, states[i] ?? "unjudged")),
    };
  });

  let done = 0;
  let partial = 0;
  let missed = 0;
  for (const row of rows) {
    for (const level of row.levels) {
      if (level === 3) done += 1;
      else if (level === 2 || level === 1) partial += 1;
      else if (level === 0) missed += 1;
    }
  }

  const width = wallWidth(cell);
  const height = HEADER + rows.length * rowStep;

  // „poslednjih 8 nedelja" — the number comes from the constant that actually
  // governs the span, so the sentence cannot outlive the window it names.
  const detail = strings.habits.detail;
  const spanPhrase = `${s.captionPrefix.toLowerCase()} ${String(WALL_WEEKS)} ${countUnit(
    WALL_WEEKS,
    detail.weekUnitOne,
    detail.weekUnitFew,
    detail.weekUnitMany,
  )}`;
  // The sentence is derived from the very counts that produced the squares, so
  // there is no way for it to describe a different wall than the one drawn.
  const description =
    `${s.descriptionLead}, ${spanPhrase}: ${s.descriptionDone} ${String(done)}, ` +
    `${s.descriptionPartial} ${String(partial)}, ${s.descriptionMissed} ${String(missed)}.`;

  return (
    <div className="nx-chart-group hab__wall" ref={hostRef}>
      <ChartFrame
        title={s.heading}
        description={description}
        caption={s.caption}
        empty={rows.length === 0 ? { reason: s.emptyReason } : null}
        viewBox={[width, height]}
        height={height}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={NAME_X} height={height} />
          </clipPath>
        </defs>
        {Array.from({ length: WALL_WEEKS }, (_, week) => {
          const opens = days[week * DAYS_PER_WEEK];
          if (opens === undefined) return null;
          return (
            <text
              key={opens}
              className="hab__wall-week"
              x={GUTTER + week * weekStride}
              y={HEADER_BASELINE}
            >
              {weekLabel(opens)}
            </text>
          );
        })}
        {rows.map((row, y) => (
          <g key={row.habit.id}>
            <text
              className="hab__wall-name"
              x={NAME_X}
              y={HEADER + y * rowStep + rowStep / 2}
              textAnchor="end"
              dominantBaseline="middle"
              clipPath={`url(#${clipId})`}
            >
              {shortName(row.habit.name)}
            </text>
            {row.levels.map((level, x) =>
              level === null ? null : (
                <rect
                  key={days[x]}
                  className={`nx-cell nx-cell--l${String(level)}`}
                  x={
                    GUTTER +
                    Math.floor(x / DAYS_PER_WEEK) * weekStride +
                    (x % DAYS_PER_WEEK) * dayStride
                  }
                  y={HEADER + y * rowStep + CELL_INSET}
                  width={cell}
                  height={cell}
                  // The corner follows the square rather than staying at 2px:
                  // a fixed radius on a square that doubles reads as two
                  // different shapes at the two ends of the range.
                  rx={Math.max(2, Math.round(cell / 5))}
                />
              ),
            )}
          </g>
        ))}
      </ChartFrame>
      {rows.length > 0 && (
        <>
          <ChartLegend
            inline
            items={[
              { label: s.legendDone, tone: "accent", level: 3, shape: "swatch" },
              { label: s.legendPartial, tone: "accent", level: 2, shape: "swatch" },
              { label: s.legendMissed, tone: "accent", level: 0, shape: "swatch" },
            ]}
          />
          <p className="hab__note">{s.note}</p>
        </>
      )}
    </div>
  );
}

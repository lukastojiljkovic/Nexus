import { monthGridDays } from "@nexus/core";
import type { WeekStart } from "@nexus/core";
import { densityLevel } from "./semesterGrid.js";
import type { DayDensity } from "./semesterGrid.js";
import { countUnit, strings } from "./strings.js";

/**
 * One month of the Semestar overview (CAL-010): weekday initials, day numbers,
 * and per day nothing but a density dot and — for an exam — a ring.
 *
 * Deliberately NOT `CalendarMonth`. That grid draws bars over lanes, expands
 * rows, takes drops and opens an editor; every one of those is wrong at this
 * size, and none of them would survive being squeezed into a cell 30px wide.
 * What this component draws instead is the ONE thing a term is scanned for:
 * where the weight sits, and where the exams are.
 *
 * Leading and trailing days are drawn as blanks rather than as the neighbouring
 * month's numbers. Four consecutive months are on screen at once, so a shown
 * out-of-month day would appear twice — with its dot counted twice — which is
 * exactly the wrong impression for a view whose whole job is weight.
 */

export interface CalendarMiniMonthProps {
  monthKey: string;
  todayKey: string;
  /** Which weekday the rows open on (PRD 04 §5) — the same preference the full grids read. */
  weekStart: WeekStart;
  /** Density per day key, built once by the page over the whole four-month span. */
  density: ReadonlyMap<string, DayDensity>;
  /** Click on a day — the page switches to that day's Dan view. */
  onOpenDay: (dayKey: string) => void;
}

const monthTitleFormatter = new Intl.DateTimeFormat("sr-Latn", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
/** Single-letter weekday initials — all the room seven columns of a mini month have. */
const weekdayInitialFormatter = new Intl.DateTimeFormat("sr-Latn", {
  weekday: "narrow",
  timeZone: "UTC",
});
const dayAriaFormatter = new Intl.DateTimeFormat("sr-Latn", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** Bare-day/month formatting in UTC; degrades to the raw key on bad input (CalendarMonth's own rule). */
function formatUtcKey(key: string, formatter: Intl.DateTimeFormat): string {
  const date = new Date(key);
  return Number.isNaN(date.getTime()) ? key : formatter.format(date);
}

/**
 * A day's accessible name: its full date, then what it holds — because the dot
 * and the ring are the only content of the cell, and neither is readable.
 */
function dayLabel(dayKey: string, density: DayDensity | undefined): string {
  const date = formatUtcKey(dayKey, dayAriaFormatter);
  if (density === undefined) return date;
  const s = strings.calendar.semester;
  const items = `${density.count} ${countUnit(density.count, s.itemsOne, s.itemsFew, s.itemsMany)}`;
  return density.hasExam ? `${date}, ${items}, ${s.examMark}` : `${date}, ${items}`;
}

export function CalendarMiniMonth({
  monthKey,
  todayKey,
  weekStart,
  density,
  onOpenDay,
}: CalendarMiniMonthProps) {
  const days = monthGridDays(monthKey, weekStart);
  const title = formatUtcKey(`${monthKey}-01`, monthTitleFormatter);

  // The heading names the month; no aria-label beside it, which would only turn
  // each of the four into a landmark of its own.
  return (
    <section className="cal__mini">
      <h3 className="cal__mini-title">{title}</h3>
      {/* Decorative: every day cell's own label already names its weekday. */}
      <div className="cal__mini-weekdays" aria-hidden="true">
        {days.slice(0, 7).map((day) => (
          <span key={day.key} className="cal__mini-weekday">
            {formatUtcKey(day.key, weekdayInitialFormatter)}
          </span>
        ))}
      </div>
      <div className="cal__mini-days">
        {days.map((day) => {
          if (!day.inMonth) {
            return <span key={day.key} className="cal__mini-blank" aria-hidden="true" />;
          }
          const dayDensity = density.get(day.key);
          const level = densityLevel(dayDensity?.count ?? 0);
          const classes = ["cal__mini-day"];
          if (day.key === todayKey) classes.push("cal__mini-day--today");
          if (dayDensity?.hasExam === true) classes.push("cal__mini-day--exam");

          return (
            <button
              key={day.key}
              type="button"
              className={classes.join(" ")}
              aria-label={dayLabel(day.key, dayDensity)}
              onClick={() => onOpenDay(day.key)}
            >
              <span className="cal__mini-num">{Number(day.key.slice(8, 10))}</span>
              {level > 0 && <span className={`cal__mini-dot cal__mini-dot--${level}`} />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

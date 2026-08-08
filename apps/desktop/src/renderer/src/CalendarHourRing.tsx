import { RadialCycle } from "@nexus/ui";
import type { RadialSpoke } from "@nexus/ui";
import type { CalendarItem } from "./calendarItems.js";
import { strings } from "./strings.js";

/**
 * „Sat dana" — CAL's signature graphic, and the one thing the month grid
 * cannot say: a month cell tells you which DAYS are busy, never that every
 * evening after seven is gone. Folding the visible period onto a single
 * 24-hour dial — one spoke per hour, its length how many items START there
 * — shows the shape of a life instead of the shape of a month.
 *
 * ALL-DAY EVENTS ARE EXCLUDED, NEVER PARKED AT MIDNIGHT. `startMinutes` is
 * `null` for exactly two reasons — the item is all-day, or its kind is
 * day-granular by construction (a task's rok, an exam, a study block, a
 * birthday, a subscription renewal all hard-code it in `calendarItems.ts`)
 * — and both mean the same thing here: there is no hour to plot. A spike at
 * 00 standing in for „ceo dan" would be a fabricated hour, not a measured
 * one, so the single `startMinutes === null` check both finds the items
 * with a real clock time and drops every all-day one in the same pass.
 *
 * THE LOCAL HOUR, NOT THE UTC ONE. `sortKey` already carries a timed item's
 * exact wall-clock start (`calendarItems.ts` sets it to the row's own
 * `startAt`, which every form on this page writes as a naive
 * "YYYY-MM-DDTHH:MM" — no offset, so `Date` parses it in the device's own
 * zone). `getHours()`, never `getUTCHours()`: „when is my evening" is a
 * question about the clock on the wall in front of the user, not the one in
 * Greenwich.
 *
 * WHERE IT IS DRAWN, AND WHY IN ONE VIEW ONLY. `CalendarPage` renders this
 * inside the AGENDA's own scroller and nowhere else. It used to sit between
 * the event form and whichever view was showing — that is, as a 320px `<svg>`
 * plus its title and caption, roughly 360px, dropped into a flex column that
 * has the page's height and no scrollbar of its own. An `<svg>` with a height
 * attribute cannot shrink below it, so the ring took its 360px out of a 589px
 * page, collapsed the grid under it to nothing, and still hung off the bottom
 * of `.cal`.
 *
 * Moving it is not merely where it fits — it is where it says something. The
 * Nedelja and Dan grids ALREADY draw the hour axis at full resolution, so a
 * dial restating it there costs a third of the grid to repeat what the grid
 * shows; Mesec and Semestar are height-hungry grids where 360px above them
 * puts the calendar itself below the fold. The agenda is a plain scrolling
 * list with no fixed-height contract and no hour axis at all — which is
 * exactly the view that cannot otherwise answer „which hours is my life in",
 * and it is the house arrangement already: a signature graphic above the rows
 * it summarises, the way „Rokovi" sits above the documents list.
 */

const HOURS_PER_DAY = 24;

export interface CalendarHourRingProps {
  /**
   * Already expanded, already source-filtered, and already narrowed to the
   * period on screen. `buildCalendarItems` on its own is WIDER than that —
   * a one-off event or task flows through it untouched however far outside
   * the query range it falls (only recurring occurrences and birthdays are
   * actually bounded) — so the caller is the one place that knows what „on
   * screen" currently means and must filter to it before handing items over;
   * this component draws whatever it is given.
   */
  items: readonly CalendarItem[];
}

export function CalendarHourRing({ items }: CalendarHourRingProps) {
  const s = strings.calendar.chart;

  const hourCounts = new Array<number>(HOURS_PER_DAY).fill(0);
  let total = 0;
  for (const item of items) {
    if (item.startMinutes === null) continue;
    const startedAt = new Date(item.sortKey);
    if (Number.isNaN(startedAt.getTime())) continue;
    const hour = startedAt.getHours();
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
    total += 1;
  }

  // Ties keep the EARLIEST hour: `>` rather than `>=` never lets a later hour
  // of equal count displace the one already holding the title, so the
  // sentence names the same hour on every render of the same data.
  let busiestHour = 0;
  let busiestCount = -1;
  for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
    const count = hourCounts[hour] ?? 0;
    if (count > busiestCount) {
      busiestCount = count;
      busiestHour = hour;
    }
  }
  const peak = Math.max(0, ...hourCounts);

  const spokes: RadialSpoke[] = [];
  for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
    const count = hourCounts[hour] ?? 0;
    // A silent hour draws no spoke at all — the same "not drawn, not a
    // zero" discipline `HabitWall` states for a day the schedule never
    // asked for. There is no such thing as an hour "out of scope" for this
    // ring, so unlike a habit's wall this is a length-zero omission, not an
    // `absent` one: the dial tick is there for every hour regardless.
    if (count > 0) spokes.push({ at: hour, value: count / peak, tone: "accent" });
  }

  // Composed from the very counts the spokes are drawn from, so the sentence
  // can never name a total or a busiest hour the ring does not show.
  const description =
    total === 0
      ? s.emptyReason
      : `${s.descriptionLead}: ${String(total)}, ${s.descriptionBusiest} ${String(busiestHour)}${s.hourSuffix}.`;

  // `nx-chart-group` is the house wrapper for a graphic and the things that
  // explain it; `cal__chart` is what pins this one to a real block — 320px
  // wide, the ring's own `size`, and `flex: none` so a height-constrained
  // column can never squeeze it into its own caption. See calendar.css.
  return (
    <div className="nx-chart-group cal__chart">
      <RadialCycle
        title={s.heading}
        description={description}
        caption={s.caption}
        empty={total === 0 ? { reason: s.emptyReason } : null}
        period={{ kind: "day" }}
        spokes={spokes}
        size={320}
      />
    </div>
  );
}

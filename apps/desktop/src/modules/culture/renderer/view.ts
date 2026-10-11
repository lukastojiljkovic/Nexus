import { foldSearchText, type VisitKind } from "@nexus/core";
import type { CultureArtWorkView, CulturePlanView, CultureVisitView } from "../shared/ipc.js";

/**
 * CULTURE's page arithmetic, as pure functions (ADR-090).
 *
 * **Why the maths is here rather than in the component.** Everything the page
 * decides - which visits a filter leaves, which plans are past, what a day cell
 * holds, which track comes next - is a decision with a right and a wrong answer,
 * and a decision written inline in a component is a decision nothing can test.
 * This file is the half of the page that runs without a DOM.
 *
 * **Nothing here reads the clock or the locale.** A `today` and a collator are
 * parameters, so a test pins them and the page supplies the real ones: a helper
 * that called `new Date()` itself could not be tested on a Tuesday in March.
 */

/** The visits view's filter, as the toolbar holds it: a kind, a place, and a folded search. */
export interface VisitFilter {
  readonly kind: VisitKind | null;
  readonly venueId: string | null;
  readonly query: string;
}

export const EMPTY_VISIT_FILTER: VisitFilter = { kind: null, venueId: null, query: "" };

/** The text a filter searches: title, venue, city, companions and the notes. */
function visitHaystack(visit: CultureVisitView): string {
  return [visit.title, visit.venue, visit.city ?? "", visit.companions ?? "", visit.notes].join(" ");
}

/**
 * The visits a filter leaves, NEWEST first (the order a log is read in), with
 * an id tiebreak so two rows of one day never swap places between reads.
 */
export function filterVisits(
  visits: readonly CultureVisitView[],
  filter: VisitFilter,
): CultureVisitView[] {
  const needle = foldSearchText(filter.query.trim());
  return visits
    .filter((visit) => {
      if (filter.kind !== null && visit.kind !== filter.kind) return false;
      if (filter.venueId !== null && visit.venueId !== filter.venueId) return false;
      if (needle.length === 0) return true;
      return foldSearchText(visitHaystack(visit)).includes(needle);
    })
    .sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0) || right.id.localeCompare(left.id));
}

/** How many visits each remembered place gathered, by venue id. A visit with no link counts nowhere. */
export function visitsPerVenue(visits: readonly CultureVisitView[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const visit of visits) {
    if (visit.venueId === null) continue;
    counts.set(visit.venueId, (counts.get(visit.venueId) ?? 0) + 1);
  }
  return counts;
}

/** How many visits fall on each bare day, for the calendar's day cells. */
export function visitsPerDay(visits: readonly CultureVisitView[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const visit of visits) {
    counts.set(visit.date, (counts.get(visit.date) ?? 0) + 1);
  }
  return counts;
}

/** The four-digit year a bare day belongs to, or null for anything that is not a bare day. */
export function yearOf(day: string): number | null {
  const year = Number(day.slice(0, 4));
  return day.length === 10 && Number.isInteger(year) && year > 0 ? year : null;
}

/**
 * Today, as the bare local day the store writes.
 *
 * LOCAL, not UTC: a visit on the first of the month is that day where the user
 * is standing, and `toISOString()` would move every evening after 22:00 in
 * Belgrade into tomorrow. The `Date` is a parameter so a test can pin it.
 */
export function bareDayOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${month}-${day}`;
}

/**
 * One month's grid, Monday-first, as day-of-month numbers with `null` for the
 * cells before the first and after the last.
 *
 * The week starts on Monday because that is what a Serbian calendar does and
 * what this app's own calendar defaults to: the module draws a YEAR here, so
 * every month has to agree about where the week begins.
 *
 * The arithmetic is `Date.UTC` on purpose - a local `Date` would make the grid
 * depend on the machine's time zone, and a calendar that shifts by one day in
 * another zone is a calendar nobody can test.
 */
export function monthGrid(year: number, month: number): (number | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // `getUTCDay` is 0 for Sunday; Monday-first means Sunday sits at index 6.
  const offset = (first.getUTCDay() + 6) % 7;
  const lastDay = new Date(Date.UTC(year, month, 1) - 1).getUTCDate();
  const cells: (number | null)[] = [];
  for (let index = 0; index < offset; index += 1) cells.push(null);
  for (let day = 1; day <= lastDay; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** The bare day a cell of `monthGrid` stands for, or null for a blank cell. */
export function cellDay(year: number, month: number, day: number | null): string | null {
  if (day === null) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The plans still ahead of `today`, soonest first - what the programme leads with, and what the dashboard card draws. */
export function upcomingPlans(
  plans: readonly CulturePlanView[],
  today: string,
): CulturePlanView[] {
  return plans
    .filter((plan) => plan.date >= today)
    .sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0) || left.id.localeCompare(right.id));
}

/** The plans whose day has passed, most recent first. */
export function pastPlans(plans: readonly CulturePlanView[], today: string): CulturePlanView[] {
  return plans
    .filter((plan) => plan.date < today)
    .sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0) || right.id.localeCompare(left.id));
}

/**
 * The past plans the programme still has to ask about: their day has gone and
 * they have not become a visit. This is the list the "went there" prompt draws,
 * so a plan that already answered is not in it.
 */
export function plansAwaitingAnswer(
  plans: readonly CulturePlanView[],
  today: string,
): CulturePlanView[] {
  return pastPlans(plans, today).filter((plan) => plan.visitId === null);
}

/** The track ids a queue plays through: the whole library, or one playlist in its own rank order. */
export function queueOrder(
  libraryOrder: readonly string[],
  playlistOrder: readonly string[] | null,
): readonly string[] {
  return playlistOrder ?? libraryOrder;
}

/**
 * The next track in a queue, or null at the end of one.
 *
 * `step` is `1` for forward and `-1` for back; `repeat` wraps instead of
 * stopping, which is the difference between a queue and a loop and therefore a
 * decision the caller makes. A `current` that is not in the queue starts at the
 * first (or last, going back), which is what a queue does when the track that
 * was playing has just been deleted.
 */
export function stepQueue(
  order: readonly string[],
  current: string | null,
  step: 1 | -1,
  repeat: boolean,
): string | null {
  if (order.length === 0) return null;
  const index = current === null ? -1 : order.indexOf(current);
  const next = index < 0 ? (step === 1 ? 0 : order.length - 1) : index + step;
  if (next >= 0 && next < order.length) return order[next] ?? null;
  return repeat ? (step === 1 ? order[0] : order[order.length - 1]) ?? null : null;
}

/**
 * The century an artwork's date string falls in, or null when it does not
 * contain a four-digit year.
 *
 * The floor is deliberately not `date / 100`: the year 1900 is the 19th
 * century, and 2001 is the 21st - so the bucket is `floor((year - 1) / 100) + 1`
 * for a positive year, which is the rule a reader of dates actually expects.
 * A catalogue entry that says "c. 1650" or "1650-1660" contains its year, one
 * that says "17th century" does not, and the second kind lands in the "no year"
 * bucket rather than in a century nothing computed.
 */
export function artCenturyOf(date: string): number | null {
  const match = /\d{3,4}/.exec(date);
  if (match === null) return null;
  const year = Number(match[0]);
  if (!Number.isInteger(year) || year <= 0) return null;
  return Math.floor((year - 1) / 100) + 1;
}

/** The arts guide's filter: a folded search, an artist, a museum, and a century (`null` for "any"). */
export interface ArtFilter {
  readonly query: string;
  readonly artist: string | null;
  readonly museum: string | null;
  /** `undefined` means "any century, dated or not"; `null` means "the works with no year at all". */
  readonly century: number | null | undefined;
}

export const EMPTY_ART_FILTER: ArtFilter = {
  query: "",
  artist: null,
  museum: null,
  century: undefined,
};

export function filterArtWorks(
  works: readonly CultureArtWorkView[],
  filter: ArtFilter,
): CultureArtWorkView[] {
  const needle = foldSearchText(filter.query.trim());
  return works.filter((work) => {
    if (filter.artist !== null && work.artist !== filter.artist) return false;
    if (filter.museum !== null && work.museum !== filter.museum) return false;
    if (filter.century !== undefined && artCenturyOf(work.date) !== filter.century) return false;
    if (needle.length === 0) return true;
    return foldSearchText(`${work.title} ${work.artist} ${work.museum} ${work.date}`).includes(
      needle,
    );
  });
}

/** The distinct values of one field, collated the way a Serbian reader reads them (`Intl.Collator(["sr-Latn", "sr"])` at the call site). */
export function distinctValues(
  works: readonly CultureArtWorkView[],
  pick: (work: CultureArtWorkView) => string,
  collator: Intl.Collator,
): string[] {
  const seen = new Set<string>();
  for (const work of works) seen.add(pick(work));
  return [...seen].sort((left, right) => collator.compare(left, right));
}

/** A rating field's text as a whole 1..10, or null when the field is empty or not a rating. */
export function parseRating(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= 10 ? value : null;
}

/**
 * A price as the two fields of the visit form hold it, or null when the pair is
 * not a price.
 *
 * The amount is typed in MAJOR units (what a ticket costs) and stored in minor
 * ones, so `12,50` is 1250 - and a comma is accepted as the decimal mark
 * because that is how the Serbian interface writes numbers. An amount with no
 * currency, or a currency with no amount, is refused by answering null: the
 * store's own CHECK makes half a price unrepresentable, and the form has to say
 * which half is missing rather than silently storing nothing.
 */
export function parsePrice(
  minorUnitsText: string,
  currencyText: string,
): { minorUnits: number; currency: string } | null {
  const amount = minorUnitsText.trim().replace(",", ".");
  const currency = currencyText.trim().toUpperCase();
  if (amount.length === 0 && currency.length === 0) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) return null;
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const major = Number(amount);
  if (!Number.isFinite(major)) return null;
  return { minorUnits: Math.round(major * 100), currency };
}

/**
 * Reading the USNO fixtures. Every test file that uses them needs the same
 * three translations, and they are the ones worth getting wrong only once:
 *
 *  - a response body is JSON, parsed here into the shape USNO documents;
 *  - a USNO time is a wall clock reading on a UT day with no zone attached
 *    ("hh:mm" in the one-day answers, "hhmm" in the year tables) and becomes a
 *    `Date` at that instant — the engine's own input type;
 *  - a place name picks the coordinates out of {@link USNO_PLACES}.
 */
import type { SkyPlace } from "../horizontal.js";
import { USNO_ONE_DAY_2026, USNO_PLACES, type UsnoOneDayResponse } from "./usnoOneDay.js";

/** USNO's answer for one body on one day, only the fields these tests read. */
export interface UsnoPhenomenon {
  readonly phen: string;
  readonly time: string | null;
}

/** The one-day GeoJSON, as much of it as the tests look at. */
export interface UsnoOneDay {
  readonly closestphase: {
    readonly day: number;
    readonly month: number;
    readonly year: number;
    readonly phase: string;
    readonly time: string;
  };
  readonly curphase: string;
  readonly day: number;
  readonly day_of_week: string;
  readonly fracillum: string;
  readonly month: number;
  readonly year: number;
  readonly moondata: readonly UsnoPhenomenon[];
  readonly sundata: readonly UsnoPhenomenon[];
}

/** The body is JSON text; the assertion is that it still parses as the shape above. */
export function oneDayBody(entry: UsnoOneDayResponse): UsnoOneDay {
  const parsed = JSON.parse(entry.body) as { properties: { data: UsnoOneDay } };
  return parsed.properties.data;
}

/** The place the engine is asked about, for a fixture that named it. */
export function placeFor(name: string): SkyPlace {
  const place = USNO_PLACES.find((candidate) => candidate.name === name);
  if (place === undefined) throw new Error(`no such USNO place: ${name}`);
  return { latitude: place.latitude, longitude: place.longitude };
}

/** A UT instant from a day key and a USNO "hh:mm" (the one-day API's form). */
export function utcInstant(dayKey: string, time: string | null): Date | null {
  if (time === null) return null;
  const [hour = "00", minute = "00"] = time.split(":");
  return new Date(`${dayKey}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00.000Z`);
}

/** A UT instant from a day key and a USNO "hhmm" (the year tables' form). */
export function utcInstantCompact(dayKey: string, time: string | null): Date | null {
  if (time === null) return null;
  return new Date(`${dayKey}T${time.slice(0, 2)}:${time.slice(2)}:00.000Z`);
}

/** One phenomenon of a body's list, by its own name — `null` when USNO listed none. */
export function phenomenon(
  body: UsnoOneDay,
  list: "moondata" | "sundata",
  name: string,
): UsnoPhenomenon | null {
  return body[list].find((entry) => entry.phen === name) ?? null;
}

/**
 * How far apart two events are, in seconds — walking the shorter way round the
 * clock, because a published minute at 00:00 belongs to the same event as an
 * engine answer at 23:59 and the two are twenty-four hours apart by subtraction.
 */
export function secondsApart(actual: Date | null, expected: Date | null): number | null {
  if (actual === null || expected === null) return null;
  const raw = Math.abs(actual.getTime() - expected.getTime()) / 1000;
  return Math.min(raw, Math.abs(raw - 86_400));
}

/** The largest value in a list, or `null` for an empty one. */
export function largest(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.max(...present);
}

/** Every fixture entry, paired with the body parsed out of it. */
export function oneDayEntries(): readonly {
  readonly place: string;
  readonly date: string;
  readonly body: UsnoOneDay;
}[] {
  return USNO_ONE_DAY_2026.map((entry) => ({
    place: entry.place,
    date: entry.date,
    body: oneDayBody(entry),
  }));
}

/** The English USNO `phen` strings the tests switch on, in one place. */
export const USNO_PHENOMENON = {
  rise: "Rise",
  set: "Set",
  upperTransit: "Upper Transit",
  beginCivilTwilight: "Begin Civil Twilight",
  endCivilTwilight: "End Civil Twilight",
  alwaysAboveHorizon: "Object continuously above the Horizon",
  alwaysBelowHorizon: "Object continuously below the Horizon",
  alwaysAboveTwilight: "Object continuously above the Twilight Limit",
} as const;

/** USNO's own name for each of the four principal phases, and the fixture's vocabulary. */
export const USNO_PHASE_NAMES = {
  "New Moon": "new",
  "First Quarter": "first-quarter",
  "Full Moon": "full",
  "Last Quarter": "last-quarter",
} as const;

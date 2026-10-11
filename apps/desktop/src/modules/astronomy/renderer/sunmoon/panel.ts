/**
 * Everything the Sun-and-Moon panel computes, in one place and without React:
 * the day's readings, the numbers that get printed, and the two pieces of
 * geometry the panel draws (the Moon's disk and the compass).
 *
 * **What the engine answers and what this file answers.** The engine
 * (`packages/core/src/sky`) knows what the Sun and the Moon do at a place and an
 * instant; it does NOT know how a panel wants them arranged, and it must not
 * learn: `sun.ts`, `moon.ts` and `horizon.ts` are shared with the star map and
 * the 3D view. So this file is the panel's own arrangement of that answer (the
 * four Sun rows, the three twilight bands in the order a reader meets them, the
 * disk's shape from its illuminated fraction), and every part of it is a pure
 * function of the engine's output, which is what its test asserts.
 *
 * **The day is the engine's day, and it is a UTC day.** `sunDay`, `sunTwilight`
 * and `moonDay` all answer for the UTC calendar day containing the instant they
 * are given (`julian.ts` says why the engine has no zone in it), and they answer
 * `null` for an event the day does not contain rather than inventing one. This
 * panel does not re-scope them to the reader's local midnight: doing so would
 * mean a second definition of "a day" beside the engine's, and the two would
 * disagree the moment either changed. What it does instead is PRINT honestly:
 * every time goes through `Intl` in the computer's own zone, and an event that
 * falls on the reader's next or previous local date carries that date beside it
 * ({@link localDateKey} is the comparison), so a 00:12 sunset reads as 00:12 on
 * the 11th and never as a wrong time.
 *
 * **Polar day and polar night are words, never times.** The engine's day state
 * says which side of the horizon the Sun stayed on, and the panel prints that
 * state where a time would otherwise go; there is no instant, so there is
 * nothing that could be wrong.
 */
import {
  moonDay,
  moonPhase,
  nextMoonPhases,
  sunDay,
  sunPosition,
  sunTwilight,
  type LatLon,
  type MoonDay,
  type MoonPhaseReading,
  type NextMoonPhases,
  type SkyDayState,
  type SkyInstant,
  type SkyPlace,
  type SkyTwilight,
  type SunDay,
} from "@nexus/core";
import { TWILIGHT_LIMITS } from "../earth/blend.js";

/** The contract's place, in the engine's own frame: the two are the same two numbers under two names. */
export function skyPlace(point: LatLon): SkyPlace {
  return { latitude: point.latDeg, longitude: point.lonDeg };
}

/** One day at one place, as the panel reads it. */
export interface SunMoonReadings {
  readonly sun: SunDay;
  readonly twilight: SkyTwilight;
  readonly moon: MoonDay;
  readonly phase: MoonPhaseReading;
  readonly phases: NextMoonPhases;
  /** Where the Sun is at the instant asked about, which is what the compass starts from. */
  readonly sunAzimuth: number;
  /** The same instant's altitude: below the horizon, the compass has nothing to measure. */
  readonly sunAltitude: number;
}

/** Every reading the panel needs, computed together so its sections cannot disagree about the instant. */
export function sunMoonReadings(place: SkyPlace, at: SkyInstant): SunMoonReadings {
  const position = sunPosition(place, at);
  return {
    sun: sunDay(place, at),
    twilight: sunTwilight(place, at),
    moon: moonDay(place, at),
    phase: moonPhase(at),
    phases: nextMoonPhases(at),
    sunAzimuth: position.azimuth,
    sunAltitude: position.altitude,
  };
}

/** A span of the day, split into the two units the panel prints. */
export interface DayLength {
  readonly hours: number;
  readonly minutes: number;
}

/**
 * Whole hours and whole minutes of a span, the minutes rounded UP so that a day
 * of 86 399 seconds reads as 24 h 00 min rather than as 23 h 59 min: the engine's
 * day length is a measurement of a whole day, and rounding it down would print a
 * short day every time.
 */
export function dayLength(seconds: number): DayLength {
  const totalMinutes = Math.ceil(Math.max(0, seconds) / 60);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/** The three twilight bands, in the order a reader meets them after sunset. */
export const TWILIGHT_BANDS = [
  { band: "civil", limit: TWILIGHT_LIMITS.civil },
  { band: "nautical", limit: TWILIGHT_LIMITS.nautical },
  { band: "astronomical", limit: TWILIGHT_LIMITS.astronomical },
] as const;

/** Which of the three twilight bands a row is. */
export type TwilightBandId = (typeof TWILIGHT_BANDS)[number]["band"];

/** One end of a twilight window: the instant, or the day state that says why there is none. */
export interface EdgeReading {
  readonly at: Date | null;
  readonly state: SkyDayState;
}

/** One twilight band, both ends. */
export interface TwilightRow {
  readonly band: TwilightBandId;
  /** Degrees below the horizon, negative, as the engine solves it. */
  readonly limit: number;
  readonly dawn: EdgeReading;
  readonly dusk: EdgeReading;
}

/**
 * The three bands as rows, in display order, each carrying its limit so the
 * panel can name the line it is describing. The limits come from the map's own
 * `blend.ts` rather than being written again here: the picture's bands and the
 * panel's times are the same three lines, and there is one place that states
 * them.
 */
export function twilightRows(twilight: SkyTwilight): readonly TwilightRow[] {
  return TWILIGHT_BANDS.map(({ band, limit }) => {
    const window = twilight[band];
    return {
      band,
      limit,
      dawn: { at: window.dawn, state: window.state },
      dusk: { at: window.dusk, state: window.state },
    };
  });
}

/**
 * The Moon's disk as the panel draws it: the lit part is cut off by an ellipse
 * whose semi-minor axis is the terminator's own ratio of the radius, bulging
 * towards the lit limb when the Moon is more than half lit and away from it when
 * it is less.
 *
 * `terminator` is the standard `2f - 1`: -1 at new, 0 at the quarters, +1 at
 * full. `litOnRight` is whether the lit limb is the right-hand one, which is the
 * waxing half of the cycle as seen from the northern hemisphere: the view this
 * app draws, and the only view in which an unlabelled disk means anything.
 */
export interface MoonDisk {
  readonly litOnRight: boolean;
  readonly terminator: number;
  readonly illuminatedFraction: number;
}

export function moonDisk(phase: MoonPhaseReading): MoonDisk {
  return {
    litOnRight: phase.elongation < 180,
    terminator: 2 * phase.illuminatedFraction - 1,
    illuminatedFraction: phase.illuminatedFraction,
  };
}

/**
 * Where north is, given where the Sun is and which way the reader is facing.
 *
 * `sunOffsetDegrees` is the sighting a reader can actually make: 0 when the Sun
 * is straight ahead, positive when it is off the right shoulder. The answer is
 * the clockwise angle from straight ahead to north, which is what the compass
 * needle is rotated by. This is the engine's own `northFromSun` (see
 * `orientation.ts`) restated as this panel's own function, so the panel's test
 * pins the readings it prints rather than the engine's arithmetic.
 */
export function compassNorth(sunAzimuth: number, sunOffsetDegrees: number): number {
  return (((sunOffsetDegrees - sunAzimuth) % 360) + 360) % 360;
}

/**
 * The day a date falls on, in the zone the formatter is set to.
 *
 * The panel compares every event's key against the day's own key, so an event
 * that lands on the reader's next local date is printed with that date beside
 * it. The key is `Intl`'s own output and not an arithmetic on epoch
 * milliseconds, because the only correct answer is the one the zone's own rules
 * give: a daylight-saving transition in between makes a subtraction wrong
 * exactly when the reader is most likely to notice.
 */
export function localDateKey(at: Date, format: Intl.DateTimeFormat): string {
  return format.format(at);
}

/** One of the next four phases, with the name the panel prints beside its instant. */
export interface PhaseEntry {
  readonly name: "newMoon" | "firstQuarter" | "fullMoon" | "lastQuarter";
  readonly at: Date;
}

/**
 * The next four phases in the order they HAPPEN, which is not the order they are
 * named in: the engine answers each one independently ("the next new moon at or
 * after the instant"), so on the third of January the full moon is two days away
 * and the new moon is a fortnight, and a list printed as new-first-quarter-full-
 * last would read as a sequence that runs backwards.
 */
export function phaseSequence(phases: NextMoonPhases): readonly PhaseEntry[] {
  const entries: PhaseEntry[] = [
    { name: "newMoon", at: phases.newMoon },
    { name: "firstQuarter", at: phases.firstQuarter },
    { name: "fullMoon", at: phases.fullMoon },
    { name: "lastQuarter", at: phases.lastQuarter },
  ];
  return entries.sort((left, right) => left.at.getTime() - right.at.getTime());
}

/** The words a coordinate is written with: the degree sign and the four hemispheres. */
export interface CoordinateWords {
  readonly degrees: string;
  readonly north: string;
  readonly south: string;
  readonly east: string;
  readonly west: string;
}

/**
 * A latitude or a longitude as a reader says it: the number, the degree sign and
 * the hemisphere, with the sign spent on the letter.
 *
 * The number is formatted by the caller, because `Intl` is the only thing that
 * knows whether the reader's decimal mark is a comma or a point, and the words
 * come from the caller's own copy table, because they are copy. Zero is written
 * with the northern letter, and a zero longitude with the eastern one: both
 * lines through the origin are on the boundary, and a hemisphere is a letter
 * rather than a sign, so one of the two has to be chosen.
 */
export function coordinateText(
  value: number,
  positive: string,
  negative: string,
  words: CoordinateWords,
  format: (magnitude: number) => string,
): string {
  return `${format(Math.abs(value))}${words.degrees} ${value >= 0 ? positive : negative}`;
}

/** A latitude, written with the words' own northern and southern letters. */
export function latitudeText(
  latDeg: number,
  words: CoordinateWords,
  format: (magnitude: number) => string,
): string {
  return coordinateText(latDeg, words.north, words.south, words, format);
}

/** A longitude, written with the words' own eastern and western letters. */
export function longitudeText(
  lonDeg: number,
  words: CoordinateWords,
  format: (magnitude: number) => string,
): string {
  return coordinateText(lonDeg, words.east, words.west, words, format);
}

/**
 * A typed coordinate, or `null` when the text is not one.
 *
 * The `separators` are the decimal marks every locale this build can serve
 * writes (`decimalSeparators()` is what supplies them), because the reader types
 * `44,82` under Serbian and `44.82` under English and both mean the same number.
 * `limit` is the field's own: 90 for a latitude, 180 for a longitude, so
 * `91` is refused as a latitude and accepted as a longitude — which is the
 * check that stops a pair of swapped numbers from becoming a place.
 *
 * A number with a GROUP separator (`1.234,5`) is refused rather than guessed at:
 * no coordinate has four digits before the mark, so the text is not a
 * coordinate that somebody rounded.
 */
export function parseCoordinate(
  text: string,
  limit: number,
  separators: readonly string[],
): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  let normalised = trimmed;
  for (const separator of separators) normalised = normalised.split(separator).join(".");
  const value = Number(normalised);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return null;
  return value;
}

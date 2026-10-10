/**
 * The world clock and its meeting finder (mini-apps, stage 1).
 *
 * The source of every fact here is the time zone database the runtime ships:
 * `Intl.DateTimeFormat` with an IANA zone id, through the arithmetic
 * `devtools/datetime.ts` already owns (`zoneOffsetMinutes`, `zonedFields`,
 * `instantFromWall`). Nothing in this file is a table of offsets — a table goes
 * stale the moment a government changes its mind, and one shipped inside an
 * offline app goes stale silently. A zone id nobody has is refused rather than
 * guessed at.
 *
 * **"Is daylight saving in effect" is answered by comparison, not by a rule.**
 * ECMA-402 exposes the offset in force at an instant and nothing about which
 * offset a zone calls standard, so the standard offset is taken to be the
 * smaller of the two offsets the zone reports on 15 January and 15 July of the
 * instant's own local year, and `dst` is true when the offset in force is not
 * it. That is right for every zone this page offers and for both hemispheres
 * (Sydney's smaller offset is its July +10:00, its winter). It is a heuristic,
 * and it reads a zone that shifts for a reason other than summer time — Morocco
 * is the usual example, on standard time all year except Ramadan — as being on
 * daylight saving while it is on its larger offset.
 *
 * **The meeting finder answers in UTC milliseconds.** Working hours are local
 * wall times on the date asked about, one window per zone, and the windows are
 * intersected in absolute time. A window whose start or end does not exist in
 * its zone on that date (Belgrade has no 02:30 on the morning of the spring
 * change) is refused, and so is one that crosses midnight: this shape carries
 * one window per zone, so a night shift would need two of them.
 */

import {
  daysFromCivil,
  daysInMonth,
  formatOffset,
  instantFromWall,
  makeInstant,
  zoneOffsetMinutes,
  zonedFields,
  type Instant,
  type ZonedFields,
} from "../devtools/datetime.js";

const MS_PER_DAY = 86_400_000;

export interface ZoneReading {
  readonly zone: string;
  /** The zone's wall clock, "YYYY-MM-DDTHH:MM:SS" — no offset attached. */
  readonly localIso: string;
  /** The zone's local date, "YYYY-MM-DD". */
  readonly dayKey: string;
  /** Local time of day, in minutes from local midnight. */
  readonly minutesFromMidnight: number;
  /** Offset from UTC in whole minutes, east positive. */
  readonly utcOffsetMinutes: number;
  /** The offset as "±HH:MM"; the page prefixes whatever it calls UTC. */
  readonly utcOffsetText: string;
  /** True when the zone is on its summer offset at this instant. */
  readonly dst: boolean;
  /** Whole days the local date is ahead of (positive) or behind the home zone's. */
  readonly dayDifference: number;
}

function requireInstant(epochMs: number): Instant {
  const instant = makeInstant(epochMs);
  if (instant === null) throw new RangeError("that instant is outside the readable range");
  return instant;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** Epoch milliseconds at UTC midnight of a date, without going through `Date.UTC`. */
function epochMsOfDay(year: number, month: number, day: number): number {
  return daysFromCivil(year, month, day) * MS_PER_DAY;
}

/**
 * Whether the zone is on its summer offset at this instant: the smaller of the
 * offsets it reports in mid-January and mid-July is taken to be its standard one.
 */
function daylightSaving(zone: string, instant: Instant, localYear: number): boolean {
  const january = zoneOffsetMinutes(requireInstant(epochMsOfDay(localYear, 1, 15)), zone);
  const july = zoneOffsetMinutes(requireInstant(epochMsOfDay(localYear, 7, 15)), zone);
  const offset = zoneOffsetMinutes(instant, zone);
  if (january === null || july === null || offset === null) {
    throw new RangeError(`unknown time zone: ${zone}`);
  }
  return offset !== Math.min(january, july);
}

/** The day count of a bare date key, for the day-difference comparison. */
function dayNumberOf(key: string): number {
  return daysFromCivil(
    Number(key.slice(0, 4)),
    Number(key.slice(5, 7)),
    Number(key.slice(8, 10)),
  );
}

/** One zone's reading at an instant, and how its date sits against the home zone's. */
export function readZone(zone: string, instantMs: number, homeZone: string): ZoneReading {
  const instant = requireInstant(instantMs);
  const home = requireHome(homeZone, instant);
  const fields = zonedFields(instant, zone);
  if (fields === null) throw new RangeError(`unknown time zone: ${zone}`);

  const localIso = isoLocal(fields);
  return {
    zone,
    localIso,
    dayKey: localIso.slice(0, 10),
    minutesFromMidnight: fields.hour * 60 + fields.minute,
    utcOffsetMinutes: fields.offsetMinutes,
    utcOffsetText: formatOffset(fields.offsetMinutes),
    dst: daylightSaving(zone, instant, fields.year),
    dayDifference: dayNumberOf(localIso.slice(0, 10)) - dayNumberOf(isoLocal(home).slice(0, 10)),
  };
}

function requireHome(homeZone: string, instant: Instant): ZonedFields {
  const home = zonedFields(instant, homeZone);
  if (home === null) throw new RangeError(`unknown time zone: ${homeZone}`);
  return home;
}

function isoLocal(fields: ZonedFields): string {
  return (
    `${pad(fields.year, 4)}-${pad(fields.month, 2)}-${pad(fields.day, 2)}` +
    `T${pad(fields.hour, 2)}:${pad(fields.minute, 2)}:${pad(fields.second, 2)}`
  );
}

/** A reading per zone, in the order asked for; the home zone may be one of them. */
export function worldClock(
  instantMs: number,
  homeZone: string,
  zones: readonly string[],
): ZoneReading[] {
  return zones.map((zone) => readZone(zone, instantMs, homeZone));
}

/** One zone's working hours on the date asked about, in local minutes from midnight. */
export interface ZoneWorkHours {
  readonly zone: string;
  /** Local minute the window opens, inclusive: 09:00 is 540. */
  readonly startMinute: number;
  /** Local minute the window closes, exclusive: 17:00 is 1020. */
  readonly endMinute: number;
}

export interface MeetingWindowRequest {
  /** The date being looked at, read in each zone's own calendar. */
  readonly day: string;
  readonly zones: readonly ZoneWorkHours[];
}

export interface MeetingWindow {
  readonly startMs: number;
  readonly endMs: number;
}

function assertWorkHours(hours: ZoneWorkHours): void {
  const { startMinute, endMinute } = hours;
  if (!Number.isInteger(startMinute) || startMinute < 0) {
    throw new RangeError(`${hours.zone}: the window starts at a whole minute of the day`);
  }
  if (!Number.isInteger(endMinute) || endMinute > 24 * 60) {
    throw new RangeError(`${hours.zone}: the window ends at a whole minute of the day`);
  }
  if (endMinute <= startMinute) {
    throw new RangeError(`${hours.zone}: a window opens and closes within one day`);
  }
}

/** The UTC interval a zone's local window on `day` occupies, or a refusal. */
function windowInUtc(hours: ZoneWorkHours, day: string, date: CivilDay): MeetingWindow {
  const { year, month, dayOfMonth } = date;
  // A zone the runtime does not know answers `null` from every conversion, and
  // saying "those hours do not exist" about a typo would send the reader looking
  // for a clock change that is not there.
  if (zonedFields(requireInstant(epochMsOfDay(year, month, dayOfMonth)), hours.zone) === null) {
    throw new RangeError(`unreadable time zone: ${hours.zone}`);
  }
  const from = instantFromWall(
    {
      year,
      month,
      day: dayOfMonth,
      hour: Math.floor(hours.startMinute / 60),
      minute: hours.startMinute % 60,
    },
    hours.zone,
  );
  const to = instantFromWall(
    {
      year,
      month,
      day: dayOfMonth,
      hour: Math.floor(hours.endMinute / 60),
      minute: hours.endMinute % 60,
    },
    hours.zone,
  );
  if (from === null || to === null) {
    throw new RangeError(
      `${hours.zone}: those working hours do not exist on ${day} (a clock change can skip them)`,
    );
  }
  return { startMs: from, endMs: to };
}

interface CivilDay {
  readonly year: number;
  readonly month: number;
  readonly dayOfMonth: number;
}

/** The date a request names, refused when it is not on the calendar. */
function readDay(day: string): CivilDay {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (parsed === null) throw new RangeError(`not a YYYY-MM-DD date: ${day}`);
  const year = Number(parsed[1]);
  const month = Number(parsed[2]);
  const dayOfMonth = Number(parsed[3]);
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > daysInMonth(year, month)) {
    throw new RangeError(`not a date on the calendar: ${day}`);
  }
  return { year, month, dayOfMonth };
}

/**
 * The UTC intervals of `day` in which every zone is inside its working hours.
 *
 * One window per zone, so the answer is at most one interval — an empty list
 * when the working days do not overlap at all, which is the honest answer for a
 * team that spans Belgrade and Sydney and the one a page should say out loud
 * rather than stretch a day to fill.
 */
export function meetingWindows(request: MeetingWindowRequest): MeetingWindow[] {
  const { day, zones } = request;
  if (zones.length === 0) throw new RangeError("a meeting needs at least one zone");
  const date = readDay(day);

  let overlap: MeetingWindow | null = null;
  for (const hours of zones) {
    assertWorkHours(hours);
    const window = windowInUtc(hours, day, date);
    overlap =
      overlap === null
        ? window
        : {
            startMs: Math.max(overlap.startMs, window.startMs),
            endMs: Math.min(overlap.endMs, window.endMs),
          };
    if (overlap.endMs <= overlap.startMs) return [];
  }
  return overlap === null ? [] : [overlap];
}

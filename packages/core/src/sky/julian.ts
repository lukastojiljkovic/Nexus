/**
 * Time for the sky engine: Julian days (Meeus ch. 7, "Julian Day") and the
 * difference between dynamical and Universal Time (ch. 10, "Dynamical Time and
 * Universal Time", instantiated as Espenak & Meeus' polynomial expressions).
 *
 * **The engine is UT throughout; a time zone never enters it.** Every function
 * takes an instant — a `Date` or epoch milliseconds — and none of them consults
 * a local zone or a daylight-saving rule. A day-scoped call (`sunDay` and its
 * neighbours) means the UTC calendar day containing that instant, and turning a
 * result into the reader's own clock is stage 2's job.
 *
 * **The two time arguments are different things and this file is the only place
 * that knows it.** Meeus's series are functions of *dynamical* time (TT, which
 * runs ahead of UT by ΔT because the Earth's rotation is not a clock), so every
 * position in this module is evaluated at a Julian EPHEMERIS Day, and every
 * instant handed back is a UT instant. ΔT is what bridges them, and it is used
 * in exactly one direction each way: forward when a UT instant is turned into an
 * argument, backward when an argument is turned into the instant of an event.
 *
 * ΔT's own accuracy is not the engine's: the published expression for 2005-2050
 * is an extrapolation, so its 2026 answer (75.36 s, see {@link deltaTSeconds}) is
 * several seconds away from the true value that the IERS measures rather than
 * predicts. In a rise time that is worth a couple of seconds, and in the Moon's
 * longitude a hundredth of a degree; the USNO comparisons in this module's tests
 * are the measurement of it.
 */

/** An instant: a `Date`, or epoch milliseconds. UTC throughout — no zone ever enters this engine. */
export type SkyInstant = Date | number;

export const MS_PER_DAY = 86_400_000;

export const SECONDS_PER_DAY = 86_400;

/** JD of 1970-01-01T00:00:00Z (ch. 7: 1970 January 1.0 is JD 2440587.5, a day being 86 400 s of UT). */
const JULIAN_DAY_AT_UNIX_EPOCH = 2_440_587.5;

/** Epoch milliseconds of an instant, from either form. */
export function instantMilliseconds(at: SkyInstant): number {
  return at instanceof Date ? at.getTime() : at;
}

/** Julian Day of an instant, treating the instant as UT (ch. 7). */
export function julianDay(at: SkyInstant): number {
  return JULIAN_DAY_AT_UNIX_EPOCH + instantMilliseconds(at) / MS_PER_DAY;
}

/**
 * ΔT = TT - UT in seconds, for the decimal year the source defines as
 * `year + (month - 0.5) / 12` (ch. 10; the expressions are Espenak & Meeus' for
 * the Five Millennium Canon, published at
 * https://eclipse.gsfc.nasa.gov/SEcat5/deltatpoly.html, retrieved 2026-10-09).
 *
 * All of their branches are here rather than the two that cover a lifetime,
 * because a truncated range would answer confidently wrong for an old date
 * instead of declining. The 2026 answer, 75.36 s, is the polynomial's — not the
 * IERS' — and that is stated in the file header rather than hidden.
 */
export function deltaTSeconds(at: SkyInstant): number {
  const instant = new Date(instantMilliseconds(at));
  // `getUTCMonth()` is 0-based, so January contributes 0.5/12 and December
  // 11.5/12 — the month's own middle, as the source page defines it.
  const year = instant.getUTCFullYear() + (instant.getUTCMonth() + 0.5) / 12;

  if (year < -500) return -20 + 32 * square((year - 1820) / 100);
  if (year < 500) {
    const u = year / 100;
    return (
      10583.6 - 1014.41 * u + 33.78311 * square(u) - 5.952053 * cube(u) - 0.1798452 * fourth(u) +
      0.022174192 * fifth(u) + 0.0090316521 * Math.pow(u, 6)
    );
  }
  if (year < 1600) {
    const u = (year - 1000) / 100;
    return (
      1574.2 - 556.01 * u + 71.23472 * square(u) + 0.319781 * cube(u) - 0.8503463 * fourth(u) -
      0.005050998 * fifth(u) + 0.0083572073 * Math.pow(u, 6)
    );
  }
  if (year < 1700) {
    const t = year - 1600;
    return 120 - 0.9808 * t - 0.01532 * square(t) + cube(t) / 7129;
  }
  if (year < 1800) {
    const t = year - 1700;
    return 8.83 + 0.1603 * t - 0.0059285 * square(t) + 0.00013336 * cube(t) - fourth(t) / 1174000;
  }
  if (year < 1860) {
    const t = year - 1800;
    return (
      13.72 - 0.332447 * t + 0.0068612 * square(t) + 0.0041116 * cube(t) - 0.00037436 * fourth(t) +
      0.0000121272 * fifth(t) - 0.0000001699 * Math.pow(t, 6) + 0.000000000875 * Math.pow(t, 7)
    );
  }
  if (year < 1900) {
    const t = year - 1860;
    return (
      7.62 + 0.5737 * t - 0.251754 * square(t) + 0.01680668 * cube(t) - 0.0004473624 * fourth(t) +
      fifth(t) / 233174
    );
  }
  if (year < 1920) {
    const t = year - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * square(t) + 0.0061966 * cube(t) - 0.000197 * fourth(t);
  }
  if (year < 1941) {
    const t = year - 1920;
    return 21.2 + 0.84493 * t - 0.0761 * square(t) + 0.0020936 * cube(t);
  }
  if (year < 1961) {
    const t = year - 1950;
    return 29.07 + 0.407 * t - square(t) / 233 + cube(t) / 2547;
  }
  if (year < 1986) {
    const t = year - 1975;
    return 45.45 + 1.067 * t - square(t) / 260 - cube(t) / 718;
  }
  if (year < 2005) {
    const t = year - 2000;
    return (
      63.86 + 0.3345 * t - 0.060374 * square(t) + 0.0017275 * cube(t) + 0.000651814 * fourth(t) +
      0.00002373599 * fifth(t)
    );
  }
  if (year < 2050) {
    const t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * square(t);
  }
  if (year < 2150) {
    return -20 + 32 * square((year - 1820) / 100) - 0.5628 * (2150 - year);
  }
  return -20 + 32 * square((year - 1820) / 100);
}

function square(value: number): number {
  return value * value;
}

function cube(value: number): number {
  return value * value * value;
}

function fourth(value: number): number {
  return square(square(value));
}

function fifth(value: number): number {
  return fourth(value) * value;
}

/**
 * The Julian Ephemeris Day of a UT instant — the argument every series in this
 * module takes (ch. 7 and 10 together).
 */
export function julianEphemerisDay(at: SkyInstant): number {
  return julianDay(at) + deltaTSeconds(at) / SECONDS_PER_DAY;
}

/**
 * The UT instant of a Julian Ephemeris Day: {@link julianEphemerisDay}'s
 * inverse, and how every phase instant leaves this module.
 *
 * It iterates, because ΔT is a function of the very instant being solved for.
 * Two passes settle it to well under a millisecond — ΔT moves by a second every
 * year or so, so a pass that is wrong by a day changes the next one by 0.003 s.
 */
export function instantFromJulianEphemerisDay(jde: number): Date {
  // The first guess treats the argument as if ΔT were zero; the second re-reads
  // ΔT at the instant that guess landed on. A pass that is a whole day wide
  // moves ΔT by a couple of milliseconds, so there is no third.
  const base = (jde - JULIAN_DAY_AT_UNIX_EPOCH) * MS_PER_DAY;
  return new Date(base - deltaTSeconds(base - deltaTSeconds(base) * 1000) * 1000);
}

/** The start of the UTC calendar day containing an instant. */
export function utcDayStart(at: SkyInstant): number {
  return Math.floor(instantMilliseconds(at) / MS_PER_DAY) * MS_PER_DAY;
}

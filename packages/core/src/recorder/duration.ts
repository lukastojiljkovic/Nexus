/**
 * How long a recording runs, on a clock face: `m:ss` under an hour, `h:mm:ss`
 * from an hour up.
 *
 * **Truncated, never rounded.** A duration is measured in whole milliseconds, so
 * 59 999 ms is fifty-nine seconds and not a minute; rounding would let a player
 * read a minute that has not elapsed. This is `phaseProgress`'s own rule one
 * module over, and it is the only rounding decision in the formatter.
 *
 * The minutes field is padded only once there is an hour above it: `3:07` and
 * `10:07` are both readable, while `1:03:07` needs its minutes padded or the
 * clock reads as `1:3:7`. Hours are not capped and are not padded, so a
 * twenty-seven-hour capture says `27:46:40` rather than wrapping.
 *
 * Anything that is not a finite number — `NaN`, an infinity, a negative
 * duration — reads as no time at all rather than poisoning the arithmetic, the
 * posture `phaseProgress` takes towards an instant that will not parse.
 */

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;

export function formatRecordingDuration(durationMs: number): string {
  const elapsedSeconds = Number.isFinite(durationMs)
    ? Math.max(0, Math.floor(durationMs / MS_PER_SECOND))
    : 0;

  const hours = Math.floor(elapsedSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((elapsedSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = elapsedSeconds % SECONDS_PER_MINUTE;
  const paddedSeconds = String(seconds).padStart(2, "0");

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
}

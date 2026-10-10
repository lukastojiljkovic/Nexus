/**
 * The two durations stage 2 draws, as pure functions: how long one track is,
 * and how long a playlist is. Both live here rather than in the page because
 * the same numbers appear in more than one place (the library list, the player,
 * the playlist header), and two implementations of "3:34" would eventually
 * disagree about the rounding.
 *
 * **Seconds are FLOORED, never rounded.** A player's clock says how much of the
 * track has been heard: 3:34.9 is 3:34, and rounding it up would show a second
 * that has not arrived yet.
 *
 * **A total is added up exactly and floored once, at the end.** A playlist's
 * length is the sum of real millisecond durations, and the floor happens only
 * when `formatCultureDuration` reads that sum: two tracks of 3:34.6 each read as
 * 7:09, not as the 7:08 that adding up two already-floored 3:34s would give.
 */

/**
 * A whole number of milliseconds that could have come out of the store: a
 * non-negative safe integer. Anything else is a caller bug, and refusing it is
 * what keeps a negative duration from formatting as `-1:-1`.
 */
function wholeMilliseconds(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a non-negative whole number of milliseconds.`);
  }
  return value;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * A duration in milliseconds as `m:ss`, or as `h:mm:ss` once it reaches an
 * hour. Minutes are not padded below an hour (`3:07`, not `03:07`), which is
 * what a track listing looks like everywhere; seconds always are, because a
 * column of `3:7` and `3:07` reads as two different things.
 *
 * Throws `RangeError` for anything that is not a non-negative whole number of
 * milliseconds: a duration this app never stores, and one that would otherwise
 * be rendered as a negative clock.
 */
export function formatCultureDuration(ms: number): string {
  const seconds = Math.floor(wholeMilliseconds(ms, "A duration") / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  return hours === 0 ? `${minutes}:${pad(rest)}` : `${hours}:${pad(minutes)}:${pad(rest)}`;
}

/** What both a track row and a playlist item can be counted by: the one field this module reads to add up time. */
export interface CultureDurationSource {
  readonly durationMs: number;
}

/**
 * How long a playlist is, in milliseconds: the exact sum, added up before
 * anything is floored, so the total is the sum of the tracks rather than a sum
 * of numbers that were already cut down.
 *
 * **A track in the playlist twice is counted twice**, because that is what the
 * playlist says: the list is the thing being measured, not its set of tracks.
 * An empty playlist is zero, not null: "no tracks" and "no length" are the same
 * fact here.
 */
export function culturePlaylistTotalMs(items: readonly CultureDurationSource[]): number {
  let total = 0;
  for (const item of items) {
    total += wholeMilliseconds(item.durationMs, "A playlist item's duration");
    if (!Number.isSafeInteger(total)) {
      throw new RangeError("A playlist's total duration must stay a safe integer of milliseconds.");
    }
  }
  return total;
}

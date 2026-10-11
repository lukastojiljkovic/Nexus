import { describe, expect, it } from "vitest";

import {
  datetimeLocalValue,
  fixedClock,
  isFollowing,
  nowClock,
  parseDatetimeLocal,
  tickClock,
} from "./clock.js";

/**
 * The shared clock.
 *
 * What is pinned here is the property the whole corner rests on: the four views
 * are given ONE instant, a machine-following clock advances it and a pinned one
 * does not, and the field the user pins it with round-trips through the machine's
 * own zone. The oracle for the round trip is JavaScript's own local-time
 * constructor rather than a number typed here — the point is that the field and
 * the clock mean the same thing, not that this machine sits in one zone.
 */

describe("the shared clock", () => {
  it("ticks a machine-following clock and leaves a pinned one exactly where it is", () => {
    expect(tickClock(nowClock(1_000), 2_000)).toEqual({ mode: "now", instantMs: 2_000 });
    const pinned = fixedClock(1_000);
    // The SAME object, not merely an equal one: the page sets state with this
    // answer every second, and React bails out only on an identical reference.
    expect(tickClock(pinned, 2_000)).toBe(pinned);
  });

  it("knows which of the two states it is in", () => {
    expect(isFollowing(nowClock(0))).toBe(true);
    expect(isFollowing(fixedClock(0))).toBe(false);
  });

  it("reads and writes a datetime-local value as the machine's own local time", () => {
    // 2026-10-10 20:30 local. `new Date(year, month, day, hour, minute)` is the
    // same local interpretation the field's value carries, which is exactly the
    // claim being made.
    const at = new Date(2026, 9, 10, 20, 30).getTime();
    expect(datetimeLocalValue(at)).toBe("2026-10-10T20:30");
    expect(parseDatetimeLocal("2026-10-10T20:30")).toBe(at);
  });

  it("drops seconds on the way out, because the field has no seconds", () => {
    const at = new Date(2026, 9, 10, 20, 30, 45).getTime();
    expect(datetimeLocalValue(at)).toBe("2026-10-10T20:30");
    expect(parseDatetimeLocal(datetimeLocalValue(at))).toBe(new Date(2026, 9, 10, 20, 30).getTime());
  });

  it("refuses the shapes a datetime-local field does not mean", () => {
    for (const refused of [
      // A field mid-edit: `new Date("")` is the day before the epoch, so
      // handing this on would jump the corner to 1969 on every backspace.
      "",
      "   ",
      // A date with no time: `Date` reads this form as UTC and the full form as
      // local time, which would be two meanings for one field.
      "2026-10-10",
      "10.10.2026",
      "2026-10-10T20",
      "2026-10-10 20:30",
      "abc",
      // A day that does not exist rolls over, so the round trip is what refuses it.
      "2026-02-30T10:00",
      "2026-13-01T10:00",
    ]) {
      expect(parseDatetimeLocal(refused), refused).toBeNull();
    }
  });
});

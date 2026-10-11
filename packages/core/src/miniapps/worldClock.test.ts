import { describe, expect, it } from "vitest";
import {
  meetingWindows,
  readZone,
  worldClock,
  type ZoneWorkHours,
} from "./worldClock.js";

const at = (iso: string): number => Date.parse(iso);
const workday = (zone: string, startMinute = 9 * 60, endMinute = 17 * 60): ZoneWorkHours => ({
  zone,
  startMinute,
  endMinute,
});

/**
 * The instants below are the 2026 daylight-saving changes in each zone, taken
 * from the IANA time zone database Node ships (tzdata 2026b, ICU 78.3, Node
 * 24.19.0) and cross-checked against the rules the three places legislate:
 * Europe switches at 01:00 UTC on the last Sunday of March and October (EU
 * directive 2000/84/EC), the United States at 02:00 local on the second Sunday
 * of March and the first Sunday of November (15 U.S.C. 260a), and New South
 * Wales at 02:00/03:00 local on the first Sunday of April and October.
 */
describe("readZone around the 2026 changes", () => {
  it("reads Belgrade the minute before and the minute of the spring change", () => {
    const before = readZone("Europe/Belgrade", at("2026-03-29T00:59:00Z"), "Europe/Belgrade");
    expect(before.localIso).toBe("2026-03-29T01:59:00");
    expect(before.utcOffsetMinutes).toBe(60);
    expect(before.utcOffsetText).toBe("+01:00");
    expect(before.dst).toBe(false);
    expect(before.dayDifference).toBe(0);

    const after = readZone("Europe/Belgrade", at("2026-03-29T01:00:00Z"), "Europe/Belgrade");
    expect(after.localIso).toBe("2026-03-29T03:00:00");
    expect(after.utcOffsetMinutes).toBe(120);
    expect(after.dst).toBe(true);
    expect(after.minutesFromMidnight).toBe(180);
  });

  it("reads Belgrade the minute before and the minute of the autumn change", () => {
    const before = readZone("Europe/Belgrade", at("2026-10-25T00:59:00Z"), "Europe/Belgrade");
    expect(before.localIso).toBe("2026-10-25T02:59:00");
    expect(before.dst).toBe(true);

    // The repeated hour: the earlier occurrence is the one an instant names.
    const after = readZone("Europe/Belgrade", at("2026-10-25T01:00:00Z"), "Europe/Belgrade");
    expect(after.localIso).toBe("2026-10-25T02:00:00");
    expect(after.utcOffsetMinutes).toBe(60);
    expect(after.dst).toBe(false);
  });

  it("reads New York across both of its 2026 changes", () => {
    const marchBefore = readZone("America/New_York", at("2026-03-08T06:59:00Z"), "Europe/Belgrade");
    expect(marchBefore.localIso).toBe("2026-03-08T01:59:00");
    expect(marchBefore.utcOffsetMinutes).toBe(-300);
    expect(marchBefore.dst).toBe(false);
    expect(marchBefore.dayDifference).toBe(0); // 01:59 on the 8th is 07:59 in Belgrade

    const marchAfter = readZone("America/New_York", at("2026-03-08T07:00:00Z"), "Europe/Belgrade");
    expect(marchAfter.localIso).toBe("2026-03-08T03:00:00");
    expect(marchAfter.utcOffsetMinutes).toBe(-240);
    expect(marchAfter.dst).toBe(true);

    const novemberBefore = readZone(
      "America/New_York",
      at("2026-11-01T05:59:00Z"),
      "Europe/Belgrade",
    );
    expect(novemberBefore.localIso).toBe("2026-11-01T01:59:00");
    expect(novemberBefore.utcOffsetMinutes).toBe(-240);
    expect(novemberBefore.dst).toBe(true);

    const novemberAfter = readZone(
      "America/New_York",
      at("2026-11-01T06:00:00Z"),
      "Europe/Belgrade",
    );
    expect(novemberAfter.localIso).toBe("2026-11-01T01:00:00");
    expect(novemberAfter.utcOffsetMinutes).toBe(-300);
    expect(novemberAfter.dst).toBe(false);
  });

  it("reads Sydney across both of its 2026 changes", () => {
    // Sydney leaves summer time on the first Sunday of April, 03:00 -> 02:00.
    const aprilBefore = readZone("Australia/Sydney", at("2026-04-04T15:59:00Z"), "Europe/Belgrade");
    expect(aprilBefore.localIso).toBe("2026-04-05T02:59:00");
    expect(aprilBefore.utcOffsetMinutes).toBe(660);
    expect(aprilBefore.dst).toBe(true);

    const aprilAfter = readZone("Australia/Sydney", at("2026-04-04T16:00:00Z"), "Europe/Belgrade");
    expect(aprilAfter.localIso).toBe("2026-04-05T02:00:00");
    expect(aprilAfter.utcOffsetMinutes).toBe(600);
    expect(aprilAfter.dst).toBe(false);

    const octoberBefore = readZone(
      "Australia/Sydney",
      at("2026-10-03T15:59:00Z"),
      "Europe/Belgrade",
    );
    expect(octoberBefore.localIso).toBe("2026-10-04T01:59:00");
    expect(octoberBefore.utcOffsetMinutes).toBe(600);
    expect(octoberBefore.dst).toBe(false);

    const octoberAfter = readZone(
      "Australia/Sydney",
      at("2026-10-03T16:00:00Z"),
      "Europe/Belgrade",
    );
    expect(octoberAfter.localIso).toBe("2026-10-04T03:00:00");
    expect(octoberAfter.utcOffsetMinutes).toBe(660);
    expect(octoberAfter.dst).toBe(true);
  });

  it("counts the day difference against the home zone, in both directions", () => {
    // 23:30 UTC on 30 March is half past one in the morning of the 31st in
    // Belgrade, half past ten the same morning in Sydney, and half past seven in
    // the evening of the 30th in New York.
    const instant = at("2026-03-30T23:30:00Z");
    const sydney = readZone("Australia/Sydney", instant, "Europe/Belgrade");
    expect(sydney.dayKey).toBe("2026-03-31");
    expect(sydney.dayDifference).toBe(0);
    const newYork = readZone("America/New_York", instant, "Europe/Belgrade");
    expect(newYork.dayKey).toBe("2026-03-30");
    expect(newYork.dayDifference).toBe(-1);

    const home = readZone("Australia/Sydney", instant, "Australia/Sydney");
    expect(home.dayDifference).toBe(0);
    expect(readZone("America/New_York", instant, "Australia/Sydney").dayDifference).toBe(-1);
  });

  it("answers in the order it was asked, for the zones it was asked about", () => {
    const instant = at("2026-06-15T12:00:00Z");
    const readings = worldClock(instant, "Europe/Belgrade", [
      "America/New_York",
      "Europe/Belgrade",
      "Australia/Sydney",
    ]);
    expect(readings.map((reading) => reading.zone)).toEqual([
      "America/New_York",
      "Europe/Belgrade",
      "Australia/Sydney",
    ]);
    expect(readings.map((reading) => reading.localIso)).toEqual([
      "2026-06-15T08:00:00",
      "2026-06-15T14:00:00",
      "2026-06-15T22:00:00", // Sydney is on +10:00 in June, its winter
    ]);
  });

  it("refuses a zone id nobody has, home zone included", () => {
    expect(() => readZone("Mars/Olympus", at("2026-06-15T12:00:00Z"), "Europe/Belgrade")).toThrow(
      RangeError,
    );
    expect(() => readZone("Europe/Belgrade", at("2026-06-15T12:00:00Z"), "Mars/Olympus")).toThrow(
      RangeError,
    );
  });
});

describe("meetingWindows", () => {
  it("intersects the working hours of three zones", () => {
    // 15 June: Belgrade is CEST (+2) so its 09:00-17:00 is 07:00-15:00 UTC, New
    // York is EDT (-4) so 07:00-15:00 there is 11:00-19:00 UTC, and UTC's own
    // 10:00-18:00 needs no conversion. All three are at work from 11:00 to
    // 15:00 UTC.
    const windows = meetingWindows({
      day: "2026-06-15",
      zones: [
        workday("Europe/Belgrade"),
        workday("America/New_York", 7 * 60, 15 * 60),
        workday("UTC", 10 * 60, 18 * 60),
      ],
    });
    expect(windows).toEqual([
      { startMs: at("2026-06-15T11:00:00Z"), endMs: at("2026-06-15T15:00:00Z") },
    ]);
  });

  it("has nothing to offer when the windows only touch", () => {
    // Sydney's 09:00-17:00 on 15 June is 23:00 the previous UTC day to 07:00,
    // and Belgrade's is 07:00 to 15:00: the two meet at 07:00 and never overlap.
    expect(
      meetingWindows({
        day: "2026-06-15",
        zones: [workday("Europe/Belgrade"), workday("Australia/Sydney")],
      }),
    ).toEqual([]);
  });

  it("follows the offsets across a change of daylight saving", () => {
    // 29 March 2026 is the European spring change and, in the United States, the
    // change three weeks earlier: Belgrade is at +2 for this whole working day
    // (09:00 is 07:00 UTC), and New York at -4 (09:00 is 13:00 UTC).
    expect(
      meetingWindows({
        day: "2026-03-29",
        zones: [workday("Europe/Belgrade"), workday("America/New_York")],
      }),
    ).toEqual([{ startMs: at("2026-03-29T13:00:00Z"), endMs: at("2026-03-29T15:00:00Z") }]);

    // 25 October 2026 is the day Europe goes back: Belgrade's 09:00 is 08:00 UTC
    // again, so the same two windows overlap for one hour longer.
    expect(
      meetingWindows({
        day: "2026-10-25",
        zones: [workday("Europe/Belgrade"), workday("America/New_York")],
      }),
    ).toEqual([{ startMs: at("2026-10-25T13:00:00Z"), endMs: at("2026-10-25T16:00:00Z") }]);
  });

  it("refuses working hours a zone cannot read, or that cross midnight", () => {
    // 02:30 on 29 March 2026 does not exist in Belgrade: the clock jumped from
    // 02:00 to 03:00 that morning.
    expect(() =>
      meetingWindows({ day: "2026-03-29", zones: [workday("Europe/Belgrade", 150, 600)] }),
    ).toThrow(RangeError);
    // A window that runs past midnight is two windows and this shape has one.
    expect(() =>
      meetingWindows({ day: "2026-06-15", zones: [workday("Europe/Belgrade", 22 * 60, 6 * 60)] }),
    ).toThrow(RangeError);
    expect(() =>
      meetingWindows({ day: "2026-06-15", zones: [workday("Europe/Belgrade", 600, 600)] }),
    ).toThrow(RangeError);
    expect(() =>
      meetingWindows({ day: "2026-06-15", zones: [workday("Europe/Belgrade", -1, 1441)] }),
    ).toThrow(RangeError);
    expect(() =>
      meetingWindows({ day: "2026-06-15", zones: [workday("Mars/Olympus")] }),
    ).toThrow(RangeError);
    expect(() =>
      meetingWindows({ day: "2026-02-30", zones: [workday("Europe/Belgrade")] }),
    ).toThrow(RangeError);
    expect(() =>
      meetingWindows({ day: "15/06/2026", zones: [workday("Europe/Belgrade")] }),
    ).toThrow(RangeError);
    expect(() => meetingWindows({ day: "2026-06-15", zones: [] })).toThrow(RangeError);
  });
});

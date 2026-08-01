import { describe, expect, it } from "vitest";
import { habitReminderInputs, type HabitReminderSource } from "./habitReminder.js";

/** 2026-07-29 is a WEDNESDAY (ISO 3); the week it falls in opens Monday 2026-07-27. */
const WEDNESDAY = "2026-07-29";
/** Monday-first, the app's own default and the value main passes (see `habitReminderInputs`). */
const MONDAY_FIRST = 1;

function habit(overrides: Partial<HabitReminderSource> = {}): HabitReminderSource {
  return {
    id: "h1",
    reminderTime: "20:00",
    schedule: { kind: "days", weekdays: [1, 2, 3, 4, 5, 6, 7] },
    target: null,
    archivedAt: null,
    entries: new Map<string, number>(),
    ...overrides,
  };
}

describe("habitReminderInputs", () => {
  it("carries a habit expected today, with the wall-clock time it reminds at", () => {
    expect(habitReminderInputs([habit()], WEDNESDAY, MONDAY_FIRST)).toEqual([
      { id: "h1", reminderTime: "20:00" },
    ]);
  });

  it("drops a habit with no reminder time — the shipped state of every habit", () => {
    expect(habitReminderInputs([habit({ reminderTime: null })], WEDNESDAY, MONDAY_FIRST)).toEqual(
      [],
    );
  });

  it("drops an archived habit: it is no longer expected, so there is nothing to nudge about", () => {
    expect(
      habitReminderInputs([habit({ archivedAt: "2026-07-01T00:00:00.000Z" })], WEDNESDAY, MONDAY_FIRST),
    ).toEqual([]);
  });

  describe("the schedule must EXPECT today", () => {
    it("keeps a `days` habit on one of its own weekdays", () => {
      const rows = habitReminderInputs(
        [habit({ schedule: { kind: "days", weekdays: [1, 3, 5] } })],
        WEDNESDAY,
        MONDAY_FIRST,
      );
      expect(rows).toEqual([{ id: "h1", reminderTime: "20:00" }]);
    });

    it("drops a `days` habit on a weekday it never asked for", () => {
      const rows = habitReminderInputs(
        [habit({ schedule: { kind: "days", weekdays: [1, 2, 4] } })],
        WEDNESDAY,
        MONDAY_FIRST,
      );
      expect(rows).toEqual([]);
    });

    it("keeps a `quota` habit on ANY day while its week is unmet — any day counts towards the quota", () => {
      const rows = habitReminderInputs(
        [habit({ schedule: { kind: "quota", perWeek: 3 } })],
        WEDNESDAY,
        MONDAY_FIRST,
      );
      expect(rows).toEqual([{ id: "h1", reminderTime: "20:00" }]);
    });

    it("drops a `quota` habit whose week is already met — the week is done, so a nudge would nag about an achievement", () => {
      const rows = habitReminderInputs(
        [
          habit({
            schedule: { kind: "quota", perWeek: 2 },
            entries: new Map([
              ["2026-07-27", 1],
              ["2026-07-28", 1],
            ]),
          }),
        ],
        WEDNESDAY,
        MONDAY_FIRST,
      );
      expect(rows).toEqual([]);
    });

    it("counts a quota week under the caller's OWN week start, never a guessed one", () => {
      // Sunday 2026-07-26 is LAST week under a Monday-first week and THIS week
      // under a Sunday-first one, so the same two ticks meet a quota of 2 in one
      // reading and not in the other.
      const entries = new Map([
        ["2026-07-26", 1],
        ["2026-07-27", 1],
      ]);
      const rows = habitReminderInputs(
        [habit({ schedule: { kind: "quota", perWeek: 2 }, entries })],
        WEDNESDAY,
        MONDAY_FIRST,
      );
      expect(rows).toEqual([{ id: "h1", reminderTime: "20:00" }]);
      expect(
        habitReminderInputs(
          [habit({ schedule: { kind: "quota", perWeek: 2 }, entries })],
          WEDNESDAY,
          0,
        ),
      ).toEqual([]);
    });

    it("counts only the days that COUNT towards a measured habit's quota", () => {
      // Two ticks, one of them short of the target: one counted day, quota unmet.
      const rows = habitReminderInputs(
        [
          habit({
            schedule: { kind: "quota", perWeek: 2 },
            target: 8,
            entries: new Map([
              ["2026-07-27", 8],
              ["2026-07-28", 3],
            ]),
          }),
        ],
        WEDNESDAY,
        MONDAY_FIRST,
      );
      expect(rows).toEqual([{ id: "h1", reminderTime: "20:00" }]);
    });
  });

  describe("a habit already done today never reminds", () => {
    it("drops a binary habit ticked today", () => {
      const rows = habitReminderInputs(
        [habit({ entries: new Map([[WEDNESDAY, 1]]) })],
        WEDNESDAY,
        MONDAY_FIRST,
      );
      expect(rows).toEqual([]);
    });

    it("keeps a measured habit that is started but short of its target", () => {
      const rows = habitReminderInputs(
        [habit({ target: 8, entries: new Map([[WEDNESDAY, 5]]) })],
        WEDNESDAY,
        MONDAY_FIRST,
      );
      expect(rows).toEqual([{ id: "h1", reminderTime: "20:00" }]);
    });

    it("drops a measured habit that has reached its target today", () => {
      const rows = habitReminderInputs(
        [habit({ target: 8, entries: new Map([[WEDNESDAY, 8]]) })],
        WEDNESDAY,
        MONDAY_FIRST,
      );
      expect(rows).toEqual([]);
    });

    it("drops a quota habit satisfied today even while its week is unmet", () => {
      // Today's own tick is the one that has to silence it: the week is still
      // short, but the thing this reminder would ask for is already done.
      const rows = habitReminderInputs(
        [
          habit({
            schedule: { kind: "quota", perWeek: 5 },
            entries: new Map([[WEDNESDAY, 1]]),
          }),
        ],
        WEDNESDAY,
        MONDAY_FIRST,
      );
      expect(rows).toEqual([]);
    });
  });

  it("preserves the caller's order and carries every habit that qualifies", () => {
    const rows = habitReminderInputs(
      [
        habit({ id: "a", reminderTime: "07:00" }),
        habit({ id: "b", reminderTime: null }),
        habit({ id: "c", reminderTime: "21:30" }),
      ],
      WEDNESDAY,
      MONDAY_FIRST,
    );
    expect(rows).toEqual([
      { id: "a", reminderTime: "07:00" },
      { id: "c", reminderTime: "21:30" },
    ]);
  });
});

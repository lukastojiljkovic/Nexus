import { describe, expect, it } from "vitest";

import {
  serializeHabitSchedule,
  validateHabitSchedule,
  type HabitSchedule,
} from "./habitSchedule.js";

describe("validateHabitSchedule", () => {
  it("accepts a days schedule and returns it canonical", () => {
    expect(validateHabitSchedule({ kind: "days", weekdays: [5, 1, 3] })).toEqual({
      kind: "days",
      weekdays: [1, 3, 5],
    });
  });

  it("deduplicates weekdays", () => {
    expect(validateHabitSchedule({ kind: "days", weekdays: [2, 2, 2] })).toEqual({
      kind: "days",
      weekdays: [2],
    });
  });

  it("accepts all seven days — daily is the seven-day case, not a third kind", () => {
    expect(validateHabitSchedule({ kind: "days", weekdays: [7, 6, 5, 4, 3, 2, 1] })).toEqual({
      kind: "days",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    });
  });

  it("never returns the caller's own array", () => {
    const weekdays = [1, 2];
    const validated = validateHabitSchedule({ kind: "days", weekdays });
    expect(validated).not.toBeNull();
    if (validated?.kind !== "days") throw new Error("expected a days schedule");
    expect(validated.weekdays).not.toBe(weekdays);
  });

  it.each([
    ["an empty weekday list", { kind: "days", weekdays: [] }],
    ["weekday 0 (the recurrence engine's numbering, not this one)", { kind: "days", weekdays: [0] }],
    ["weekday 8", { kind: "days", weekdays: [8] }],
    ["a fractional weekday", { kind: "days", weekdays: [1.5] }],
    ["a stringly weekday", { kind: "days", weekdays: ["1"] }],
    ["weekdays that are not an array", { kind: "days", weekdays: 1 }],
    ["a days schedule with an extra key", { kind: "days", weekdays: [1], perWeek: 3 }],
    ["a days schedule missing its weekdays", { kind: "days" }],
  ])("refuses %s", (_label, value) => {
    expect(validateHabitSchedule(value)).toBeNull();
  });

  it.each([1, 3, 7])("accepts a quota of %i per week", (perWeek) => {
    expect(validateHabitSchedule({ kind: "quota", perWeek })).toEqual({ kind: "quota", perWeek });
  });

  it.each([
    ["a quota of zero", { kind: "quota", perWeek: 0 }],
    ["a quota of eight — there is no eighth day", { kind: "quota", perWeek: 8 }],
    ["a fractional quota", { kind: "quota", perWeek: 2.5 }],
    ["a quota with an extra key", { kind: "quota", perWeek: 3, weekdays: [1] }],
  ])("refuses %s", (_label, value) => {
    expect(validateHabitSchedule(value)).toBeNull();
  });

  it.each([
    ["a recurrence rule — there is no second schedule language here", { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } }],
    ["an unknown kind", { kind: "monthly", weekdays: [1] }],
    ["null", null],
    ["an array", [{ kind: "quota", perWeek: 1 }]],
    ["a string", "days"],
  ])("refuses %s", (_label, value) => {
    expect(validateHabitSchedule(value)).toBeNull();
  });
});

describe("serializeHabitSchedule", () => {
  it("writes a days schedule in canonical member order", () => {
    expect(serializeHabitSchedule({ kind: "days", weekdays: [5, 1] })).toBe(
      '{"kind":"days","weekdays":[1,5]}',
    );
  });

  it("writes a quota schedule in canonical member order", () => {
    expect(serializeHabitSchedule({ kind: "quota", perWeek: 4 })).toBe(
      '{"kind":"quota","perWeek":4}',
    );
  });

  it("round-trips through the validator byte for byte", () => {
    const schedules: HabitSchedule[] = [
      { kind: "days", weekdays: [3, 1, 3, 7] },
      { kind: "quota", perWeek: 2 },
    ];
    for (const schedule of schedules) {
      const text = serializeHabitSchedule(schedule);
      const parsed = validateHabitSchedule(JSON.parse(text));
      expect(parsed).not.toBeNull();
      expect(serializeHabitSchedule(parsed!)).toBe(text);
    }
  });
});

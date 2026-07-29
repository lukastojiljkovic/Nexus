import { describe, it, expect } from "vitest";
import { ageAtOccurrence, birthdayOccurrencesInRange, type BirthdayPerson } from "./birthdays.js";

function person(overrides: Partial<BirthdayPerson> = {}): BirthdayPerson {
  return { id: "p1", kind: "birthday", month: 3, day: 14, year: 1990, ...overrides };
}

describe("birthdayOccurrencesInRange", () => {
  it("yields one date per year of a multi-year range, ascending", () => {
    expect(
      birthdayOccurrencesInRange(person(), { from: "2025-01-01", to: "2027-12-31" }),
    ).toEqual(["2025-03-14", "2026-03-14", "2027-03-14"]);
  });

  it("skips the years whose occurrence falls outside the range's own ends", () => {
    // The 2026 birthday is behind `from`; the 2027 one is inside.
    expect(
      birthdayOccurrencesInRange(person(), { from: "2026-06-01", to: "2027-06-01" }),
    ).toEqual(["2027-03-14"]);
  });

  it("treats both range ends as inclusive", () => {
    expect(
      birthdayOccurrencesInRange(person(), { from: "2026-03-14", to: "2027-03-14" }),
    ).toEqual(["2026-03-14", "2027-03-14"]);
    expect(
      birthdayOccurrencesInRange(person(), { from: "2026-03-15", to: "2027-03-13" }),
    ).toEqual([]);
  });

  it("hits and misses a single-day range", () => {
    expect(
      birthdayOccurrencesInRange(person(), { from: "2026-03-14", to: "2026-03-14" }),
    ).toEqual(["2026-03-14"]);
    expect(
      birthdayOccurrencesInRange(person(), { from: "2026-03-13", to: "2026-03-13" }),
    ).toEqual([]);
  });

  it("returns nothing for an inverted range", () => {
    expect(
      birthdayOccurrencesInRange(person(), { from: "2027-01-01", to: "2026-01-01" }),
    ).toEqual([]);
  });

  it("celebrates a Feb-29 person every year: the 29th in leap years, the 28th otherwise", () => {
    const leapling = person({ month: 2, day: 29, year: 2000 });
    expect(
      birthdayOccurrencesInRange(leapling, { from: "2027-01-01", to: "2029-12-31" }),
    ).toEqual(["2027-02-28", "2028-02-29", "2029-02-28"]);
  });

  it("finds a Feb-29 person's clamped date in a single-day non-leap range", () => {
    const leapling = person({ month: 2, day: 29, year: 2000 });
    expect(
      birthdayOccurrencesInRange(leapling, { from: "2027-02-28", to: "2027-02-28" }),
    ).toEqual(["2027-02-28"]);
    // ...and does NOT also claim the 29th, which does not exist that year.
    expect(
      birthdayOccurrencesInRange(leapling, { from: "2027-03-01", to: "2027-12-31" }),
    ).toEqual([]);
  });

  it("clamps only Feb 29 — a leap year keeps the 29th to itself", () => {
    const leapling = person({ month: 2, day: 29, year: 2000 });
    expect(
      birthdayOccurrencesInRange(leapling, { from: "2028-02-28", to: "2028-02-28" }),
    ).toEqual([]);
  });

  it("expands an anniversary exactly like a birthday — the recurrence is kind-agnostic", () => {
    const wedding = person({ kind: "anniversary", month: 9, day: 1, year: 2015 });
    expect(
      birthdayOccurrencesInRange(wedding, { from: "2026-01-01", to: "2027-12-31" }),
    ).toEqual(["2026-09-01", "2027-09-01"]);
  });

  it("throws TypeError on a malformed range key", () => {
    expect(() => birthdayOccurrencesInRange(person(), { from: "2026-13-01", to: "2026-12-31" })).toThrow(
      TypeError,
    );
    expect(() => birthdayOccurrencesInRange(person(), { from: "2026-01-01", to: "2026-02-30" })).toThrow(
      TypeError,
    );
    expect(() => birthdayOccurrencesInRange(person(), { from: "26-01-01", to: "2026-12-31" })).toThrow(
      TypeError,
    );
  });
});

describe("ageAtOccurrence", () => {
  it("is the difference between the occurrence's year and the birth year", () => {
    expect(ageAtOccurrence(person({ year: 1990 }), "2026-03-14")).toBe(36);
  });

  it("is 0 in the birth year itself", () => {
    expect(ageAtOccurrence(person({ year: 2026 }), "2026-03-14")).toBe(0);
  });

  it("keeps incrementing for a Feb-29 person, clamped date and all", () => {
    const leapling = person({ month: 2, day: 29, year: 2000 });
    expect(ageAtOccurrence(leapling, "2027-02-28")).toBe(27);
    expect(ageAtOccurrence(leapling, "2028-02-29")).toBe(28);
    expect(ageAtOccurrence(leapling, "2029-02-28")).toBe(29);
  });

  it("is null when the birth year is unknown", () => {
    expect(ageAtOccurrence(person({ year: null }), "2026-03-14")).toBeNull();
  });

  it("is null rather than negative for an occurrence before the birth year", () => {
    expect(ageAtOccurrence(person({ year: 2030 }), "2026-03-14")).toBeNull();
  });

  it("throws TypeError on a malformed occurrence date", () => {
    expect(() => ageAtOccurrence(person(), "2026-02-30")).toThrow(TypeError);
    expect(() => ageAtOccurrence(person(), "not-a-day")).toThrow(TypeError);
  });
});

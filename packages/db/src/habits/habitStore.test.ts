import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HabitSchedule } from "@nexus/core";
import {
  HabitNotFoundError,
  HabitStore,
  HabitValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:00:00.000Z";

const MON_WED_FRI: HabitSchedule = { kind: "days", weekdays: [1, 3, 5] };
const THREE_PER_WEEK: HabitSchedule = { kind: "quota", perWeek: 3 };

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-habits-"));
  db = openDatabase({ path: join(dir, "habits.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

function store(): HabitStore {
  return new HabitStore(db.raw, createProfile());
}

describe("HabitStore.create", () => {
  it("stores a binary habit and returns the row", () => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);

    expect(habit).toMatchObject({
      name: "Teretana",
      color: null,
      schedule: MON_WED_FRI,
      target: null,
      unit: null,
      reminderTime: null,
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(habits.listActive()).toEqual([habit]);
  });

  it("stores a counted habit — one nullable target is the whole difference", () => {
    const habits = store();
    const habit = habits.create(
      { name: "Voda", schedule: THREE_PER_WEEK, target: 8, unit: "čaša", color: "zad" },
      NOW,
    );

    expect(habit).toMatchObject({ target: 8, unit: "čaša", color: "zad" });
    expect(habits.listActive()[0]).toEqual(habit);
  });

  it("stores the schedule in its CANONICAL form", () => {
    const habits = store();
    const habit = habits.create(
      { name: "Teretana", schedule: { kind: "days", weekdays: [5, 1, 1, 3] } },
      NOW,
    );

    expect(habit.schedule).toEqual(MON_WED_FRI);
    expect(habits.listActive()[0]?.schedule).toEqual(MON_WED_FRI);
  });

  it("trims the name", () => {
    const habits = store();
    expect(habits.create({ name: "  Teretana  ", schedule: MON_WED_FRI }, NOW).name).toBe(
      "Teretana",
    );
  });

  it.each([
    ["an empty name", { name: "   ", schedule: MON_WED_FRI }],
    ["an over-long name", { name: "x".repeat(61), schedule: MON_WED_FRI }],
    ["a colour outside the folder palette", { name: "T", schedule: MON_WED_FRI, color: "neon" }],
    ["a fractional target", { name: "T", schedule: MON_WED_FRI, target: 8.5 }],
    ["a zero target", { name: "T", schedule: MON_WED_FRI, target: 0 }],
    ["a unit with no target to count", { name: "T", schedule: MON_WED_FRI, unit: "čaša" }],
    ["an over-long unit", { name: "T", schedule: MON_WED_FRI, target: 8, unit: "x".repeat(17) }],
    ["a reminder time that is not HH:MM", { name: "T", schedule: MON_WED_FRI, reminderTime: "7am" }],
    ["a reminder time out of the clock", { name: "T", schedule: MON_WED_FRI, reminderTime: "24:00" }],
    ["an empty weekday list", { name: "T", schedule: { kind: "days", weekdays: [] } }],
    ["a quota of eight", { name: "T", schedule: { kind: "quota", perWeek: 8 } }],
    [
      "an ADR-024 recurrence rule — HABIT speaks no such language",
      { name: "T", schedule: { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } } },
    ],
  ])("refuses %s", (_label, input) => {
    const habits = store();
    // The cast is the point of the test: these are the shapes an untrusted
    // caller can send, and the store is what refuses them.
    expect(() => habits.create(input as never, NOW)).toThrow(HabitValidationError);
  });

  it("refuses a malformed `now` — main stamps the clock, the renderer never does", () => {
    const habits = store();
    expect(() => habits.create({ name: "T", schedule: MON_WED_FRI }, "juče")).toThrow(
      HabitValidationError,
    );
  });
});

describe("HabitStore.listActive", () => {
  it("sorts sr-Latn alphabetically", () => {
    const habits = store();
    for (const name of ["Voda", "Trčanje", "Šetnja", "Čitanje", "Cveće"]) {
      habits.create({ name, schedule: MON_WED_FRI }, NOW);
    }
    expect(habits.listActive().map((habit) => habit.name)).toEqual([
      "Cveće",
      "Čitanje",
      "Šetnja",
      "Trčanje",
      "Voda",
    ]);
  });

  it("includes an ARCHIVED habit, carrying the moment it was archived", () => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    habits.archive(habit.id, LATER);

    expect(habits.listActive()).toEqual([{ ...habit, archivedAt: LATER, updatedAt: LATER }]);
  });

  it("excludes a soft-deleted habit", () => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    habits.softDelete(habit.id, LATER);
    expect(habits.listActive()).toEqual([]);
  });

  it("shows one profile nothing of another's", () => {
    const mine = store();
    const theirs = store();
    mine.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    expect(theirs.listActive()).toEqual([]);
  });
});

describe("HabitStore.update", () => {
  it("applies a partial patch and leaves the rest alone", () => {
    const habits = store();
    const habit = habits.create(
      { name: "Voda", schedule: THREE_PER_WEEK, target: 8, unit: "čaša" },
      NOW,
    );

    expect(habits.update(habit.id, { name: "Voda dnevno" }, LATER)).toEqual({
      ...habit,
      name: "Voda dnevno",
      updatedAt: LATER,
    });
  });

  it("clears a nullable field on an explicit null", () => {
    const habits = store();
    const habit = habits.create(
      { name: "Voda", schedule: THREE_PER_WEEK, target: 8, unit: "čaša", color: "zad" },
      NOW,
    );

    expect(habits.update(habit.id, { color: null }, LATER).color).toBeNull();
  });

  it("swaps the schedule for the other KIND, canonically", () => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    expect(habits.update(habit.id, { schedule: THREE_PER_WEEK }, LATER).schedule).toEqual(
      THREE_PER_WEEK,
    );
  });

  it("refuses to leave a unit behind when the target is cleared", () => {
    const habits = store();
    const habit = habits.create(
      { name: "Voda", schedule: THREE_PER_WEEK, target: 8, unit: "čaša" },
      NOW,
    );
    expect(() => habits.update(habit.id, { target: null }, LATER)).toThrow(HabitValidationError);
    expect(() => habits.update(habit.id, { target: null, unit: null }, LATER)).not.toThrow();
  });

  it("still edits an ARCHIVED habit — archiving says nothing about being here", () => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    habits.archive(habit.id, LATER);
    expect(habits.update(habit.id, { name: "Teretana ujutru" }, LATER).name).toBe(
      "Teretana ujutru",
    );
  });

  it("refuses an unknown, deleted or foreign habit", () => {
    const habits = store();
    const theirs = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);

    expect(() => habits.update("nema", { name: "X" }, LATER)).toThrow(HabitNotFoundError);
    expect(() => theirs.update(habit.id, { name: "X" }, LATER)).toThrow(HabitNotFoundError);
    habits.softDelete(habit.id, LATER);
    expect(() => habits.update(habit.id, { name: "X" }, LATER)).toThrow(HabitNotFoundError);
  });
});

describe("HabitStore soft delete, restore and archive", () => {
  it("round-trips a soft delete", () => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    habits.softDelete(habit.id, LATER);
    habits.restore(habit.id, LATER);
    expect(habits.listActive().map((row) => row.id)).toEqual([habit.id]);
  });

  it("keeps a habit's HISTORY through a delete, so undo brings it back with the habit", () => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    habits.setEntry(habit.id, "2026-06-01", 1, NOW);
    habits.setEntry(habit.id, "2026-06-03", 1, NOW);

    habits.softDelete(habit.id, LATER);
    expect(
      db.raw.prepare("SELECT COUNT(*) AS n FROM habit_entries WHERE habit_id = ?").get(habit.id),
    ).toEqual({ n: 2 });

    habits.restore(habit.id, LATER);
    expect(
      habits.listAllEntries({ from: "2026-06-01", to: "2026-06-07" }).map((e) => e.date),
    ).toEqual(["2026-06-01", "2026-06-03"]);
  });

  it("keeps archiving and deleting independent in both directions", () => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    habits.archive(habit.id, LATER);
    habits.softDelete(habit.id, LATER);
    habits.restore(habit.id, LATER);

    expect(habits.listActive()[0]?.archivedAt).toBe(LATER);
    habits.unarchive(habit.id, LATER);
    expect(habits.listActive()[0]?.archivedAt).toBeNull();
  });

  it.each([
    ["softDelete", (habits: HabitStore, id: string) => habits.softDelete(id, LATER)],
    ["restore", (habits: HabitStore, id: string) => habits.restore(id, LATER)],
    ["archive", (habits: HabitStore, id: string) => habits.archive(id, LATER)],
    ["unarchive", (habits: HabitStore, id: string) => habits.unarchive(id, LATER)],
  ])("%s refuses a habit it cannot see", (_label, act) => {
    const habits = store();
    expect(() => act(habits, "nema")).toThrow(HabitNotFoundError);
  });

  it("refuses to delete twice or restore what is not deleted", () => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    expect(() => habits.restore(habit.id, LATER)).toThrow(HabitNotFoundError);
    habits.softDelete(habit.id, LATER);
    expect(() => habits.softDelete(habit.id, LATER)).toThrow(HabitNotFoundError);
  });

  it("refuses to archive twice or unarchive what is not archived", () => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    expect(() => habits.unarchive(habit.id, LATER)).toThrow(HabitNotFoundError);
    habits.archive(habit.id, LATER);
    expect(() => habits.archive(habit.id, LATER)).toThrow(HabitNotFoundError);
  });
});

describe("HabitStore entries", () => {
  it("writes a tick and reads it back", () => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    const entry = habits.setEntry(habit.id, "2026-06-01", 1, NOW);

    expect(entry).toMatchObject({
      habitId: habit.id,
      date: "2026-06-01",
      value: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(habits.listAllEntries({ from: "2026-06-01", to: "2026-06-07" })).toEqual([entry]);
  });

  it("updates the SAME row on a second tick of the same day", () => {
    const habits = store();
    const habit = habits.create({ name: "Voda", schedule: THREE_PER_WEEK, target: 8, unit: "č" }, NOW);
    const first = habits.setEntry(habit.id, "2026-06-01", 3, NOW);
    const second = habits.setEntry(habit.id, "2026-06-01", 5, LATER);

    expect(second).toEqual({ ...first, value: 5, updatedAt: LATER });
    expect(habits.listAllEntries({ from: "2026-06-01", to: "2026-06-01" })).toEqual([second]);
  });

  it("clears a tick, and clearing an unticked day changes nothing", () => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    habits.setEntry(habit.id, "2026-06-01", 1, NOW);

    habits.clearEntry(habit.id, "2026-06-01");
    expect(habits.listAllEntries({ from: "2026-06-01", to: "2026-06-07" })).toEqual([]);
    expect(() => habits.clearEntry(habit.id, "2026-06-01")).not.toThrow();
  });

  it.each([
    ["a zero value", 0],
    ["a negative value", -1],
    ["a fractional value", 2.5],
  ])("refuses %s", (_label, value) => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    expect(() => habits.setEntry(habit.id, "2026-06-01", value, NOW)).toThrow(HabitValidationError);
  });

  it("refuses a day that is not a real calendar date", () => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    expect(() => habits.setEntry(habit.id, "2026-02-30", 1, NOW)).toThrow(HabitValidationError);
  });

  it("refuses an entry naming ANOTHER profile's habit, on every entry statement", () => {
    const mine = store();
    const theirs = store();
    const habit = mine.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    mine.setEntry(habit.id, "2026-06-01", 1, NOW);

    expect(() => theirs.setEntry(habit.id, "2026-06-02", 1, NOW)).toThrow(HabitNotFoundError);
    expect(() => theirs.clearEntry(habit.id, "2026-06-01")).toThrow(HabitNotFoundError);
    // The read names no habit, so it does not refuse — it simply sees nothing,
    // which is the same scope answered a different way.
    expect(theirs.listAllEntries({ from: "2026-06-01", to: "2026-06-07" })).toEqual([]);
    // And the writes that were refused left the original alone.
    expect(mine.listAllEntries({ from: "2026-06-01", to: "2026-06-07" })).toHaveLength(1);
  });

  it("reads every habit's entries over a range in ONE query", () => {
    const habits = store();
    const gym = habits.create({ name: "Aerobik", schedule: MON_WED_FRI }, NOW);
    const water = habits.create({ name: "Voda", schedule: THREE_PER_WEEK, target: 8, unit: "č" }, NOW);
    habits.setEntry(gym.id, "2026-06-01", 1, NOW);
    habits.setEntry(gym.id, "2026-06-03", 1, NOW);
    habits.setEntry(water.id, "2026-06-02", 8, NOW);
    // Outside the window, and therefore out of the answer.
    habits.setEntry(gym.id, "2026-05-30", 1, NOW);

    // Grouped by habit and oldest first within each — the read's own contract,
    // and the shape a history grid draws straight from. Which habit leads is the
    // id order, so the expectation is built the same way rather than assuming
    // insertion order.
    const expected = [
      [gym.id, "2026-06-01"],
      [gym.id, "2026-06-03"],
      [water.id, "2026-06-02"],
    ].sort((a, b) => a[0]!.localeCompare(b[0]!) || a[1]!.localeCompare(b[1]!));

    expect(
      habits
        .listAllEntries({ from: "2026-06-01", to: "2026-06-07" })
        .map((entry) => [entry.habitId, entry.date]),
    ).toEqual(expected);
  });

  it("keeps a soft-deleted habit's entries out of the profile-wide read", () => {
    const habits = store();
    const habit = habits.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    habits.setEntry(habit.id, "2026-06-01", 1, NOW);
    habits.softDelete(habit.id, LATER);

    expect(habits.listAllEntries({ from: "2026-06-01", to: "2026-06-07" })).toEqual([]);
  });

  it("shows one profile nothing of another's entries", () => {
    const mine = store();
    const theirs = store();
    const habit = mine.create({ name: "Teretana", schedule: MON_WED_FRI }, NOW);
    mine.setEntry(habit.id, "2026-06-01", 1, NOW);

    expect(theirs.listAllEntries({ from: "2026-06-01", to: "2026-06-07" })).toEqual([]);
  });

  it("refuses a range whose end is before its start", () => {
    const habits = store();
    expect(() => habits.listAllEntries({ from: "2026-06-07", to: "2026-06-01" })).toThrow(
      HabitValidationError,
    );
  });
});

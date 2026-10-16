import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HabitStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import type { Habit } from "@nexus/db";
import type { ConfirmRequest, Tool, ToolContext } from "@nexus/core";
import { habitTools } from "./habits.js";

/**
 * The HABIT tools over a real database.
 *
 * „Done" comes from `@nexus/core`'s `countsAsDone` and „expected today" from a
 * rule restated in `habits.ts` (main cannot reach the renderer's copy), so both
 * halves are pinned here against a fixed day: 10 October 2026 is a Saturday,
 * ISO weekday 6.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();
const TODAY = "2026-10-10";
const SATURDAY = 6;

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-habits-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function store(): HabitStore {
  return new HabitStore(db.raw, profileId);
}

function tools(): readonly Tool[] {
  return habitTools({ profileDb: (id, open) => open(db.raw, id), now: () => NOW_MS });
}

function toolOf(name: string): Tool {
  const found = tools().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

function contextFor(locale: "sr" | "en", allow: boolean): {
  readonly context: ToolContext;
  readonly confirms: ConfirmRequest[];
} {
  const confirms: ConfirmRequest[] = [];
  return {
    confirms,
    context: {
      profileId,
      locale,
      signal: new AbortController().signal,
      confirm: (request) => {
        confirms.push(request);
        return Promise.resolve(allow);
      },
    },
  };
}

/** Every active habit in the store's own order, which is the order the tool prints them in. */
function active(): readonly Habit[] {
  return store().listActive();
}

describe("habits.today", () => {
  it("reads today's state: done, not done, and not scheduled", async () => {
    const gym = store().create(
      { name: "Teretana", schedule: { kind: "days", weekdays: [SATURDAY] } },
      NOW_ISO,
    );
    const water = store().create(
      { name: "Voda", schedule: { kind: "quota", perWeek: 3 }, target: 3, unit: "čaša" },
      NOW_ISO,
    );
    const reading = store().create(
      { name: "Čitanje", schedule: { kind: "days", weekdays: [1] } },
      NOW_ISO,
    );
    store().setEntry(gym.id, TODAY, 1, NOW_ISO);
    store().setEntry(water.id, TODAY, 2, NOW_ISO);

    const result = await toolOf("habits.today").run({}, contextFor("sr", true).context);

    // Built in the store's own order (its sr-Latn collation), so the assertion
    // is the whole answer rather than a lookup that hides an extra row.
    const ordered = active().map((habit) => {
      if (habit.id === gym.id) return `- [x] ${habit.id} ${habit.name}`;
      if (habit.id === water.id) return `- [ ] ${habit.id} ${habit.name} (2/3 čaša)`;
      if (habit.id === reading.id) return `- [ ] ${habit.id} ${habit.name} (nije danas na rasporedu)`;
      throw new Error("Test setup: an unexpected habit appeared.");
    });
    expect(ordered).toHaveLength(3);
    expect(result.content).toBe(
      ["Navike za danas: 1 od 3 završeno.", ...ordered].join("\n"),
    );
  });

  it("says so when the profile has no active habit", async () => {
    const result = await toolOf("habits.today").run({}, contextFor("en", true).context);
    expect(result).toEqual({
      ok: true,
      content: "This profile has no active habits.",
    });
  });
});

describe("habits.checkin", () => {
  it("asks, then records the tick the summary named", async () => {
    const gym = store().create(
      { name: "Teretana", schedule: { kind: "days", weekdays: [SATURDAY] } },
      NOW_ISO,
    );
    const recorder = contextFor("sr", true);
    const result = await toolOf("habits.checkin").run({ habit: gym.id }, recorder.context);

    expect(recorder.confirms).toEqual([
      {
        tool: "habits.checkin",
        summary: "Zabeleži naviku „Teretana“ za 10. oktobar 2026.",
        effect: "write",
      },
    ]);
    expect(result).toEqual({
      ok: true,
      content: "Zabeležena navika „Teretana“ za 10. oktobar 2026.",
    });
    expect(store().listAllEntries({ from: TODAY, to: TODAY })).toMatchObject([
      { habitId: gym.id, date: TODAY, value: 1 },
    ]);
  });

  it("records a counted value against a target", async () => {
    const water = store().create(
      { name: "Voda", schedule: { kind: "quota", perWeek: 3 }, target: 3, unit: "čaša" },
      NOW_ISO,
    );
    const result = await toolOf("habits.checkin").run(
      { habit: water.id, value: 3 },
      contextFor("en", true).context,
    );
    expect(result.content).toBe("Recorded “Voda” for 10 October 2026 3/3 čaša.");
    expect(store().listAllEntries({ from: TODAY, to: TODAY })[0]?.value).toBe(3);
  });

  it("refuses a day in the future and a day before the habit existed", async () => {
    const gym = store().create(
      { name: "Teretana", schedule: { kind: "days", weekdays: [SATURDAY] } },
      NOW_ISO,
    );
    const future = await toolOf("habits.checkin").run(
      { habit: gym.id, day: "2026-10-11" },
      contextFor("en", true).context,
    );
    expect(future.ok).toBe(false);
    expect(future.content).toBe(
      "Failed: 2026-10-11 is in the future — a habit cannot be recorded ahead of time.",
    );

    const before = await toolOf("habits.checkin").run(
      { habit: gym.id, day: "2026-10-01" },
      contextFor("en", true).context,
    );
    expect(before.ok).toBe(false);
    expect(before.content).toBe("Failed: 2026-10-01 is before the habit was created.");
    expect(store().listAllEntries({ from: "2026-10-01", to: TODAY })).toEqual([]);
  });

  it("writes nothing when the user declines", async () => {
    const gym = store().create(
      { name: "Teretana", schedule: { kind: "days", weekdays: [SATURDAY] } },
      NOW_ISO,
    );
    const result = await toolOf("habits.checkin").run(
      { habit: gym.id },
      contextFor("en", false).context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(store().listAllEntries({ from: TODAY, to: TODAY })).toEqual([]);
  });

  it("refuses an id this profile does not have", async () => {
    const result = await toolOf("habits.checkin").run(
      { habit: uuidv7() },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("No habit named");
  });
});

const EARLIER_ISO = new Date(2026, 8, 1, 9, 0, 0).toISOString();

describe("habits.today, with archived habits", () => {
  it("leaves an archived habit off today's list, and keeps it in the count of what exists", async () => {
    const gym = store().create({ name: "Teretana", schedule: { kind: "quota", perWeek: 3 } }, NOW_ISO);
    const old = store().create({ name: "Stari cilj", schedule: { kind: "quota", perWeek: 2 } }, NOW_ISO);
    store().archive(old.id, NOW_ISO);

    const result = await toolOf("habits.today").run({}, contextFor("en", true).context);
    expect(result.content).toBe(
      ["Habits for today: 0 of 1 done.", `- [ ] ${gym.id} Teretana`].join("\n"),
    );
  });
});

describe("habit names", () => {
  it("finds a habit by its name, ignoring case and diacritics", async () => {
    const reading = store().create({ name: "Čitanje", schedule: { kind: "days", weekdays: [SATURDAY] } }, NOW_ISO);
    const result = await toolOf("habits.checkin").run({ habit: "citanje" }, contextFor("en", true).context);
    expect(result.content).toBe("Recorded “Čitanje” for 10 October 2026.");
    expect(store().listAllEntries({ from: TODAY, to: TODAY })).toMatchObject([{ habitId: reading.id }]);
  });

  it("refuses an ambiguous name with its candidates, and a missing one by name", async () => {
    const first = store().create({ name: "Voda", schedule: { kind: "quota", perWeek: 7 } }, NOW_ISO);
    const second = store().create({ name: "voda", schedule: { kind: "quota", perWeek: 7 } }, NOW_ISO);

    const ambiguous = await toolOf("habits.checkin").run({ habit: "VODA" }, contextFor("en", true).context);
    expect(ambiguous.content).toBe(
      `Failed: More than one habit is called “VODA”: voda (${second.id}), Voda (${first.id}). Name it by its id.`,
    );

    const missing = await toolOf("habits.checkin").run({ habit: "Trčanje" }, contextFor("en", true).context);
    expect(missing.content).toBe("Failed: No habit named “Trčanje”. This profile's habits: voda, Voda.");
  });
});

describe("habits.create", () => {
  it("creates a habit on set weekdays, mapping ISO numbers (1 is Monday, 6 is Saturday)", async () => {
    const recorder = contextFor("en", true);
    const result = await toolOf("habits.create").run(
      { name: "Čitanje", schedule: "days", days: [6, 1] },
      recorder.context,
    );

    expect(recorder.confirms).toEqual([
      { tool: "habits.create", summary: "Add the habit “Čitanje”, on Mon, Sat", effect: "write" },
    ]);
    const [created] = active();
    expect(created?.schedule).toEqual({ kind: "days", weekdays: [1, 6] });
    expect(result.content).toBe(`Created the habit “Čitanje” (${created?.id}).`);
    expect(result.navigateTo).toEqual({ module: "habits" });
  });

  it("creates a counted quota habit with its target and unit", async () => {
    await toolOf("habits.create").run(
      { name: "Voda", schedule: "quota", perWeek: 7, target: 8, unit: "čaša", reminderTime: "09:30" },
      contextFor("sr", true).context,
    );
    const [created] = active();
    expect(created).toMatchObject({
      name: "Voda",
      schedule: { kind: "quota", perWeek: 7 },
      target: 8,
      unit: "čaša",
      reminderTime: "09:30",
    });
  });

  it("refuses a quota without perWeek, days without days, both kinds at once, and a weekday out of range", async () => {
    const context = contextFor("en", true).context;
    const quota = await toolOf("habits.create").run({ name: "Voda", schedule: "quota" }, context);
    expect(quota.content).toBe('Failed: "perWeek" is required for a quota habit.');

    const days = await toolOf("habits.create").run({ name: "Teretana", schedule: "days" }, context);
    expect(days.content).toBe('Failed: "days" is required for a habit on set days.');

    const both = await toolOf("habits.create").run(
      { name: "Teretana", schedule: "days", days: [1], perWeek: 2 },
      context,
    );
    expect(both.content).toBe('Failed: Give "days" or "perWeek", not both.');

    const sunday = await toolOf("habits.create").run(
      { name: "Teretana", schedule: "days", days: [0] },
      context,
    );
    expect(sunday.content).toBe('Failed: "days" must be a whole number between 1 and 7.');
    expect(active()).toEqual([]);
  });

  it("creates nothing when the user declines", async () => {
    const result = await toolOf("habits.create").run(
      { name: "Teretana", schedule: "days", days: [1] },
      contextFor("en", false).context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(active()).toEqual([]);
  });
});

describe("habits.update", () => {
  it("changes only the fields the model sent", async () => {
    const gym = store().create(
      { name: "Teretana", schedule: { kind: "days", weekdays: [SATURDAY] }, reminderTime: "07:00" },
      NOW_ISO,
    );
    const recorder = contextFor("en", true);
    const result = await toolOf("habits.update").run(
      { habit: "teretana", schedule: "days", days: [2], reminderTime: "18:15" },
      recorder.context,
    );

    expect(recorder.confirms).toEqual([
      { tool: "habits.update", summary: "Change the habit “Teretana”: schedule, reminder", effect: "write" },
    ]);
    expect(result.content).toBe("Updated the habit “Teretana”.");
    expect(store().listActive().find((habit) => habit.id === gym.id)).toMatchObject({
      name: "Teretana",
      schedule: { kind: "days", weekdays: [2] },
      reminderTime: "18:15",
      target: null,
    });
  });

  it("refuses an update that names nothing to change", async () => {
    store().create({ name: "Teretana", schedule: { kind: "days", weekdays: [SATURDAY] } }, NOW_ISO);
    const result = await toolOf("habits.update").run({ habit: "Teretana" }, contextFor("en", true).context);
    expect(result).toEqual({ ok: false, content: "Failed: Nothing to change: name a field to update." });
  });
});

describe("habits.archive and habits.delete", () => {
  it("archives a habit: it leaves today's list and its history stays", async () => {
    const gym = store().create({ name: "Teretana", schedule: { kind: "quota", perWeek: 3 } }, EARLIER_ISO);
    store().setEntry(gym.id, "2026-10-05", 1, NOW_ISO);

    const result = await toolOf("habits.archive").run({ habit: "Teretana" }, contextFor("sr", true).context);
    expect(result.content).toBe("Arhivirana navika „Teretana“.");
    expect(store().listAllEntries({ from: "2026-10-05", to: "2026-10-05" })).toHaveLength(1);
    const today = await toolOf("habits.today").run({}, contextFor("en", true).context);
    expect(today.content).toBe("This profile has no active habits.");
  });

  it("deletes a habit when the user says so, and keeps nothing it can name", async () => {
    store().create({ name: "Teretana", schedule: { kind: "quota", perWeek: 3 } }, NOW_ISO);
    const declined = await toolOf("habits.delete").run({ habit: "Teretana" }, contextFor("en", false).context);
    expect(declined).toEqual({ ok: false, content: "The user declined." });
    expect(active()).toHaveLength(1);

    const deleted = await toolOf("habits.delete").run({ habit: "Teretana" }, contextFor("en", true).context);
    expect(deleted.content).toBe("Deleted the habit “Teretana”.");
    expect(active()).toEqual([]);
  });
});

describe("habits.history", () => {
  it("counts the scheduled days done in a window, and lists each recorded day for one habit", async () => {
    const gym = store().create({ name: "Teretana", schedule: { kind: "days", weekdays: [SATURDAY] } }, EARLIER_ISO);
    store().setEntry(gym.id, "2026-10-03", 1, NOW_ISO);
    store().setEntry(gym.id, "2026-10-09", 1, NOW_ISO);
    store().setEntry(gym.id, TODAY, 1, NOW_ISO);

    const result = await toolOf("habits.history").run(
      { habit: "Teretana", from: "2026-10-01", to: TODAY },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toBe(
      [
        "Habits from 1 October 2026 to 10 October 2026:",
        "- Teretana: 2 of 2 scheduled days",
        "  3 October 2026: done",
        "  9 October 2026: done",
        "  10 October 2026: done",
        "Streaks are on the habits page, which knows which day your week starts on.",
      ].join("\n"),
    );
  });

  it("counts a quota habit by the days it was done, and never counts a day after today", async () => {
    const water = store().create(
      { name: "Voda", schedule: { kind: "quota", perWeek: 3 }, target: 3, unit: "čaša" },
      EARLIER_ISO,
    );
    store().setEntry(water.id, "2026-10-05", 3, NOW_ISO);
    store().setEntry(water.id, "2026-10-06", 1, NOW_ISO);

    const result = await toolOf("habits.history").run(
      { from: "2026-10-04", to: "2026-10-31" },
      contextFor("en", true).context,
    );
    expect(result.content).toContain("- Voda: days done: 1");
  });

  it("refuses a window that ends before the habit existed, one longer than a year, and a backwards one", async () => {
    store().create({ name: "Teretana", schedule: { kind: "quota", perWeek: 3 } }, NOW_ISO);
    const context = contextFor("en", true).context;

    const before = await toolOf("habits.history").run({ habit: "Teretana", from: "2026-10-01", to: "2026-10-05" }, context);
    expect(before.content).toBe("Failed: “Teretana” was created on 10 October 2026, after this window.");

    const long = await toolOf("habits.history").run({ from: "2025-01-01", to: TODAY }, context);
    expect(long.content).toBe("Failed: A history window may cover at most 366 days.");

    const backwards = await toolOf("habits.history").run({ from: TODAY, to: "2026-10-01" }, context);
    expect(backwards.content).toBe('Failed: "from" must be on or before "to".');
  });
});

describe("habits.history across every habit", () => {
  it("lists each habit's count, and leaves out one created after the window", async () => {
    store().create({ name: "Teretana", schedule: { kind: "days", weekdays: [SATURDAY] } }, EARLIER_ISO);
    store().create({ name: "Novo", schedule: { kind: "quota", perWeek: 2 } }, NOW_ISO);

    const result = await toolOf("habits.history").run(
      { from: "2026-10-01", to: "2026-10-09" },
      contextFor("en", true).context,
    );
    expect(result.content).toBe(
      [
        "Habits from 1 October 2026 to 9 October 2026:",
        "- Teretana: 0 of 1 scheduled days",
        "Streaks are on the habits page, which knows which day your week starts on.",
      ].join("\n"),
    );
  });
});

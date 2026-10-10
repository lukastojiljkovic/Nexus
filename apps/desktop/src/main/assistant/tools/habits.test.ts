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
    const result = await toolOf("habits.checkin").run({ id: gym.id }, recorder.context);

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
      { id: water.id, value: 3 },
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
      { id: gym.id, day: "2026-10-11" },
      contextFor("en", true).context,
    );
    expect(future.ok).toBe(false);
    expect(future.content).toBe(
      "Failed: 2026-10-11 is in the future — a habit cannot be recorded ahead of time.",
    );

    const before = await toolOf("habits.checkin").run(
      { id: gym.id, day: "2026-10-01" },
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
      { id: gym.id },
      contextFor("en", false).context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(store().listAllEntries({ from: TODAY, to: TODAY })).toEqual([]);
  });

  it("refuses an id this profile does not have", async () => {
    const result = await toolOf("habits.checkin").run(
      { id: uuidv7() },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("No habit with the id");
  });
});

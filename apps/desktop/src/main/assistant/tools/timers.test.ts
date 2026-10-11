import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NexusDatabase, TimersStore, openDatabase, uuidv7 } from "@nexus/db";
import type { ConfirmRequest, Tool, ToolContext } from "@nexus/core";
import { timerTools, type TimerHost } from "./timers.js";

/**
 * The TIMER tools over a real database, with a HOST that is the module's own two
 * entry points (writing through `TimersStore` exactly as its handler does).
 *
 * The host is the seam this suite is really about: starting a countdown must go
 * through it rather than through the store, because the module arms main's clock
 * in the same breath — so the assertion is that the write happened once, with
 * the duration the model asked for.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;
let started: { profileId: string; label: string; durationSeconds: number }[];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-timers-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  started = [];
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function host(): TimerHost {
  return {
    startCountdown: (id, input) => {
      started.push({
        profileId: id,
        label: input.label,
        durationSeconds: input.durationSeconds,
      });
      return new TimersStore(db.raw, id).createCountdown(
        { label: input.label, durationSeconds: input.durationSeconds },
        NOW_ISO,
      );
    },
    listCountdowns: (id) => new TimersStore(db.raw, id).listCountdowns(),
  };
}

function tools(): readonly Tool[] {
  return timerTools({ timers: host() });
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

function countdowns() {
  return new TimersStore(db.raw, profileId).listCountdowns();
}

describe("timers.start", () => {
  it("asks in the user's language, then starts the countdown through the module's host", async () => {
    const recorder = contextFor("sr", true);
    const result = await toolOf("timers.start").run(
      { label: "Čaj", seconds: 600 },
      recorder.context,
    );

    expect(recorder.confirms).toEqual([
      {
        tool: "timers.start",
        summary: "Pokreni odbrojavanje „Čaj“ na 10 min",
        effect: "write",
      },
    ]);
    expect(started).toEqual([{ profileId, label: "Čaj", durationSeconds: 600 }]);
    const rows = countdowns();
    expect(rows).toHaveLength(1);
    const countdown = rows[0];
    if (countdown === undefined) throw new Error("no countdown was written");
    // 09:00 local plus ten minutes, stored as an instant.
    expect(countdown.endsAt).toBe(new Date(NOW_MS + 600_000).toISOString());
    expect(result).toEqual({
      ok: true,
      content: `Pokrenuto odbrojavanje „Čaj“ (${countdown.id}), 10 min.`,
      navigateTo: { module: "timers" },
    });
  });

  it("starts nothing when the user declines", async () => {
    const result = await toolOf("timers.start").run(
      { label: "Čaj", seconds: 600 },
      contextFor("en", false).context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(started).toEqual([]);
    expect(countdowns()).toEqual([]);
  });

  it("refuses a duration no countdown may carry", async () => {
    const result = await toolOf("timers.start").run(
      { label: "Čaj", seconds: 86_401 },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toBe(
      'Failed: "seconds" must be a whole number between 1 and 86400.',
    );
    expect(started).toEqual([]);
  });
});

describe("timers.list", () => {
  it("reads a running countdown as the clock it ends at", async () => {
    const store = new TimersStore(db.raw, profileId);
    const countdown = store.createCountdown({ label: "Čaj", durationSeconds: 600 }, NOW_ISO);

    const result = await toolOf("timers.list").run({}, contextFor("sr", true).context);
    expect(result).toEqual({
      ok: true,
      content: ["Odbrojavanja (1):", `- ${countdown.id} Čaj (ističe u 09:10)`].join("\n"),
    });
  });

  it("reads a paused countdown as what it still owes", async () => {
    const store = new TimersStore(db.raw, profileId);
    const countdown = store.createCountdown({ label: "Čaj", durationSeconds: 600 }, NOW_ISO);
    store.pauseCountdown(countdown.id, NOW_ISO);

    const result = await toolOf("timers.list").run({}, contextFor("en", true).context);
    expect(result.content).toBe(
      ["Countdowns (1):", `- ${countdown.id} Čaj (paused, 10 min left)`].join("\n"),
    );
  });

  it("says so when nothing is counting down", async () => {
    const result = await toolOf("timers.list").run({}, contextFor("en", true).context);
    expect(result).toEqual({
      ok: true,
      content: "No countdown is running right now.",
    });
  });
});

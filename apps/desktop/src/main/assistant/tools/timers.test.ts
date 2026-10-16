import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NexusDatabase, TimersStore, openDatabase, uuidv7 } from "@nexus/db";
import type { TimersCountdown } from "@nexus/db";
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
    pauseCountdown: (id, countdownId) => new TimersStore(db.raw, id).pauseCountdown(countdownId, NOW_ISO),
    resumeCountdown: (id, countdownId) => new TimersStore(db.raw, id).resumeCountdown(countdownId, NOW_ISO),
    cancelCountdown: (id, countdownId) => new TimersStore(db.raw, id).cancelCountdown(countdownId),
  };
}

function tools(): readonly Tool[] {
  return timerTools({
    timers: host(),
    profileDb: (id, open) => open(db.raw, id),
    now: () => NOW_MS,
  });
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
      navigateTo: { module: "timers", item: countdown.id },
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

describe("timers.pause, timers.resume and timers.cancel", () => {
  function running(label = "Čaj"): TimersCountdown {
    return new TimersStore(db.raw, profileId).createCountdown({ label, durationSeconds: 600 }, NOW_ISO);
  }

  it("pauses a countdown named by its label, and says what it has left", async () => {
    const countdown = running();
    const recorder = contextFor("en", true);
    const result = await toolOf("timers.pause").run({ countdown: "čaj" }, recorder.context);

    expect(recorder.confirms).toEqual([
      { tool: "timers.pause", summary: "Pause the countdown “Čaj”", effect: "write" },
    ]);
    expect(result).toEqual({
      ok: true,
      content: `Paused countdown “Čaj” (${countdown.id}), 10 min left.`,
      navigateTo: { module: "timers", item: countdown.id },
    });
    expect(countdowns()[0]?.endsAt).toBeNull();
  });

  it("resumes a paused countdown by its id, from the time it still owed", async () => {
    const countdown = running();
    new TimersStore(db.raw, profileId).pauseCountdown(countdown.id, NOW_ISO);

    const result = await toolOf("timers.resume").run(
      { countdown: countdown.id },
      contextFor("en", true).context,
    );

    expect(result.content).toBe(`Resumed countdown “Čaj” (${countdown.id}), ends at 09:10.`);
    expect(countdowns()[0]?.endsAt).toBe(new Date(NOW_MS + 600_000).toISOString());
  });

  it("cancels a countdown and removes it", async () => {
    const countdown = running();
    const result = await toolOf("timers.cancel").run({ countdown: "Čaj" }, contextFor("sr", true).context);

    expect(result.content).toBe(`Otkazano odbrojavanje „Čaj“ (${countdown.id}).`);
    expect(countdowns()).toEqual([]);
  });

  it("writes nothing when the user declines", async () => {
    const countdown = running();
    const result = await toolOf("timers.cancel").run({ countdown: "Čaj" }, contextFor("en", false).context);

    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(countdowns().map((row) => row.id)).toEqual([countdown.id]);
  });

  it("refuses an ambiguous label with its candidates, and a missing one by name", async () => {
    const first = running();
    const second = running();

    const ambiguous = await toolOf("timers.cancel").run({ countdown: "Čaj" }, contextFor("en", true).context);
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.content).toBe(
      `Failed: More than one countdown is called “Čaj”: Čaj (${first.id}), Čaj (${second.id}). Name it by its id.`,
    );

    const missing = await toolOf("timers.pause").run({ countdown: "Kafa" }, contextFor("en", true).context);
    expect(missing.content).toBe("Failed: No countdown named “Kafa”. This profile's countdowns: Čaj, Čaj.");
    expect(countdowns()).toHaveLength(2);
  });
});

describe("timers.presets and timers.preset", () => {
  function save(name: string, durationSeconds: number): void {
    new TimersStore(db.raw, profileId).createPreset({ name, durationSeconds }, NOW_ISO);
  }

  it("lists the saved presets with their durations", async () => {
    save("Kafa", 240);
    const result = await toolOf("timers.presets").run({}, contextFor("en", true).context);
    expect(result.content).toMatch(/^Saved presets \(1\):\n- [0-9a-f-]+ Kafa \(4 min\)$/);
  });

  it("says so when nothing is saved", async () => {
    const result = await toolOf("timers.presets").run({}, contextFor("sr", true).context);
    expect(result).toEqual({ ok: true, content: "Nema sačuvanih tajmera." });
  });

  it("saves a preset, and saving under an existing name replaces it", async () => {
    const saved = await toolOf("timers.preset").run(
      { action: "save", name: "Kafa", seconds: 240 },
      contextFor("sr", true).context,
    );
    expect(saved.ok).toBe(true);
    expect(saved.navigateTo?.item).toEqual(expect.any(String));

    const recorder = contextFor("en", true);
    const replaced = await toolOf("timers.preset").run(
      { action: "save", name: "kafa", seconds: 300 },
      recorder.context,
    );
    expect(recorder.confirms[0]?.summary).toBe("Save the preset “kafa” as 5 min (replacing the saved one)");
    expect(replaced.content).toMatch(/^Saved preset “kafa” \([0-9a-f-]+\), 5 min\.$/);
    const rows = new TimersStore(db.raw, profileId).listPresets();
    expect(rows.map((row) => [row.name, row.durationSeconds])).toEqual([["kafa", 300]]);
  });

  it("renames a preset by its name and keeps its id", async () => {
    save("Kafa", 240);
    const before = new TimersStore(db.raw, profileId).listPresets()[0];
    const result = await toolOf("timers.preset").run(
      { action: "rename", name: "kafa", newName: "Kava" },
      contextFor("en", true).context,
    );
    expect(result.content).toBe(`Renamed the preset to “Kava” (${before?.id}).`);
    expect(new TimersStore(db.raw, profileId).listPresets().map((row) => row.name)).toEqual(["Kava"]);
  });

  it("deletes a preset, and writes nothing when the user declines", async () => {
    save("Kafa", 240);
    const declined = await toolOf("timers.preset").run(
      { action: "delete", name: "Kafa" },
      contextFor("en", false).context,
    );
    expect(declined).toEqual({ ok: false, content: "The user declined." });
    expect(new TimersStore(db.raw, profileId).listPresets()).toHaveLength(1);

    const deleted = await toolOf("timers.preset").run(
      { action: "delete", name: "Kafa" },
      contextFor("en", true).context,
    );
    expect(deleted.content).toBe("Deleted the saved preset “Kafa”.");
    expect(new TimersStore(db.raw, profileId).listPresets()).toEqual([]);
  });

  it("starts a countdown from a preset through the host, with the preset's length", async () => {
    save("Kafa", 240);
    const result = await toolOf("timers.preset").run(
      { action: "start", name: "Kafa" },
      contextFor("en", true).context,
    );
    expect(started).toEqual([{ profileId, label: "Kafa", durationSeconds: 240 }]);
    expect(result.content).toMatch(/^Started countdown “Kafa” \([0-9a-f-]+\), 4 min\.$/);
  });

  it("refuses an action it does not know, and a preset that does not exist", async () => {
    const unknown = await toolOf("timers.preset").run(
      { action: "share", name: "Kafa" },
      contextFor("en", true).context,
    );
    expect(unknown.content).toBe('Failed: "action" must be one of: save, rename, delete, start.');

    const missing = await toolOf("timers.preset").run(
      { action: "start", name: "Kafa" },
      contextFor("en", true).context,
    );
    expect(missing.content).toBe("Failed: No saved preset named “Kafa”. Saved presets: -.");
    expect(started).toEqual([]);
  });
});

describe("timers.stopwatch", () => {
  it("sends the page its command, without asking and without reading any time", async () => {
    const recorder = contextFor("sr", true);
    const result = await toolOf("timers.stopwatch").run({ action: "lap" }, recorder.context);

    expect(recorder.confirms).toEqual([]);
    expect(toolOf("timers.stopwatch").effect).toBe("navigate");
    expect(result).toEqual({
      ok: true,
      content: "Poslato štoperici: krug.",
      navigateTo: { module: "timers", action: { name: "stopwatch", payload: { action: "lap" } } },
    });
  });

  it("refuses a command the stopwatch does not have", async () => {
    const result = await toolOf("timers.stopwatch").run({ action: "pause" }, contextFor("en", true).context);
    expect(result.ok).toBe(false);
    expect(result.content).toBe('Failed: "action" must be one of: start, stop, lap, reset.');
  });
});

describe("timers.settings", () => {
  it("asks, then turns the sound at the end of a countdown off", async () => {
    const recorder = contextFor("en", true);
    const result = await toolOf("timers.settings").run({ soundOnEnd: false }, recorder.context);

    expect(recorder.confirms).toEqual([
      { tool: "timers.settings", summary: "Turn the sound off when a countdown ends", effect: "write" },
    ]);
    expect(result).toEqual({
      ok: true,
      content: "The sound when a countdown ends is off.",
      navigateTo: { module: "timers" },
    });
    expect(new TimersStore(db.raw, profileId).settings().soundOnEnd).toBe(false);
  });

  it("writes nothing when the user declines, and refuses a value that is not a boolean", async () => {
    const declined = await toolOf("timers.settings").run({ soundOnEnd: false }, contextFor("en", false).context);
    expect(declined).toEqual({ ok: false, content: "The user declined." });
    expect(new TimersStore(db.raw, profileId).settings().soundOnEnd).toBe(true);

    const invalid = await toolOf("timers.settings").run({ soundOnEnd: "no" }, contextFor("en", true).context);
    expect(invalid.content).toBe('Failed: "soundOnEnd" must be a boolean.');
  });
});

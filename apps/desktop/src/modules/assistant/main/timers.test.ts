import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TimersStore, openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { createAssistantTimerHost, type TimerArming } from "./timers.js";

/**
 * The assistant's timer host over a real database, with the kit's arming replaced
 * by a list the test drives by hand: an alarm is a number the test moves the clock
 * past, and a cancelled alarm is one that must not fire.
 *
 * The properties under test are the ones the page cannot give: a paused or
 * cancelled countdown's alarm is disarmed, and an alarm set for an end the row no
 * longer has is silent.
 */

const START_MS = Date.parse("2026-06-01T08:00:00.000Z");

interface Alarm {
  readonly atMs: number;
  readonly run: () => void;
  cancelled: boolean;
}

interface Notice {
  readonly body: string;
  readonly silent: boolean;
}

let dir: string;
let db: NexusDatabase;
let profileId: string;
let clock: number;
let alarms: Alarm[];
let notices: Notice[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-assistant-timers-"));
  db = openDatabase({ path: join(dir, "profile.db") });
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", new Date(START_MS).toISOString());
  clock = START_MS;
  alarms = [];
  notices = [];
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const arming: TimerArming = {
  armUntil: (atMs, run) => {
    const alarm: Alarm = { atMs, run, cancelled: false };
    alarms.push(alarm);
    return () => {
      alarm.cancelled = true;
    };
  },
  notify: (copy, silent) => {
    notices.push({ body: copy.body.en, silent: silent === true });
  },
};

function host() {
  return createAssistantTimerHost({
    store: new TimersStore(db.raw, profileId),
    arming,
    now: () => clock,
  });
}

/** Moves the clock to an alarm's instant and runs it, unless it was cancelled. */
function fire(alarm: Alarm): void {
  clock = alarm.atMs;
  if (!alarm.cancelled) alarm.run();
}

function store(): TimersStore {
  return new TimersStore(db.raw, profileId);
}

describe("createAssistantTimerHost", () => {
  it("arms an alarm at the end of a countdown it starts, and announces it when that comes", () => {
    const countdown = host().startCountdown(profileId, { label: "Čaj", durationSeconds: 600 });

    expect(alarms).toHaveLength(1);
    expect(alarms[0]?.atMs).toBe(START_MS + 600_000);
    fire(alarms[0] as Alarm);

    expect(notices).toEqual([{ body: '"Čaj" — time is up.', silent: false }]);
    expect(store().countdown(countdown.id)).toBeNull();
  });

  it("announces silently when the module's sound is off, read when the alarm fires", () => {
    host().startCountdown(profileId, { label: "Čaj", durationSeconds: 60 });
    store().setSoundOnEnd(false, new Date(START_MS).toISOString());

    fire(alarms[0] as Alarm);
    expect(notices).toEqual([{ body: '"Čaj" — time is up.', silent: true }]);
  });

  it("disarms the alarm when the countdown is paused, and arms none while it is paused", () => {
    const timers = host();
    const countdown = timers.startCountdown(profileId, { label: "Čaj", durationSeconds: 600 });
    clock += 120_000;
    timers.pauseCountdown(profileId, countdown.id);

    expect(alarms[0]?.cancelled).toBe(true);
    expect(alarms).toHaveLength(1);
    expect(store().countdown(countdown.id)?.remainingSeconds).toBe(480);
  });

  it("arms a new alarm for the new end when the countdown is resumed, and the old one stays silent", () => {
    const timers = host();
    const countdown = timers.startCountdown(profileId, { label: "Čaj", durationSeconds: 600 });
    const original = alarms[0] as Alarm;
    clock += 120_000;
    timers.pauseCountdown(profileId, countdown.id);
    clock += 60_000;
    timers.resumeCountdown(profileId, countdown.id);

    expect(alarms).toHaveLength(2);
    const resumed = alarms[1] as Alarm;
    expect(resumed.atMs).toBe(START_MS + 180_000 + 480_000);
    // The original alarm was disarmed at the pause; even if it were run, the row
    // it names no longer ends at its instant, so it announces nothing.
    original.run();
    expect(notices).toEqual([]);
    expect(store().countdown(countdown.id)).not.toBeNull();
  });

  it("disarms the alarm and removes the row when the countdown is cancelled", () => {
    const timers = host();
    const countdown = timers.startCountdown(profileId, { label: "Čaj", durationSeconds: 600 });
    timers.cancelCountdown(profileId, countdown.id);

    expect(alarms[0]?.cancelled).toBe(true);
    expect(store().countdown(countdown.id)).toBeNull();
    fire(alarms[0] as Alarm);
    expect(notices).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NexusDatabase,
  openDatabase,
  TimersNotFoundError,
  TimersStore,
  TimersValidationError,
  uuidv7,
} from "../index.js";

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-01T09:00:00.000Z";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-timers-"));
  db = openDatabase({ path: join(dir, "timers.db") });
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

function store(profileId = createProfile()): TimersStore {
  return new TimersStore(db.raw, profileId);
}

describe("TimersStore presets", () => {
  it("stores a named preset and lists it", () => {
    const timers = store();
    const preset = timers.createPreset({ name: "  Kafa  ", durationSeconds: 240 }, NOW);

    expect(preset).toMatchObject({
      name: "Kafa",
      durationSeconds: 240,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(timers.listPresets()).toEqual([preset]);
  });

  it("refuses a second preset with the same name, and says which name", () => {
    const timers = store();
    timers.createPreset({ name: "Kafa", durationSeconds: 240 }, NOW);

    expect(() => timers.createPreset({ name: "Kafa", durationSeconds: 300 }, NOW)).toThrow(
      TimersValidationError,
    );
  });

  it("refuses a blank name and a duration outside the bounds", () => {
    const timers = store();
    expect(() => timers.createPreset({ name: "   ", durationSeconds: 60 }, NOW)).toThrow(
      TimersValidationError,
    );
    expect(() => timers.createPreset({ name: "X", durationSeconds: 0 }, NOW)).toThrow(
      TimersValidationError,
    );
    expect(() => timers.createPreset({ name: "X", durationSeconds: 7 * 24 * 3600 }, NOW)).toThrow(
      TimersValidationError,
    );
  });

  it("renames a preset and stores the change", () => {
    const timers = store();
    const preset = timers.createPreset({ name: "Kafa", durationSeconds: 240 }, NOW);

    const renamed = timers.renamePreset(preset.id, { name: "Čaj" }, LATER);
    expect(renamed.name).toBe("Čaj");
    expect(renamed.updatedAt).toBe(LATER);
    expect(timers.listPresets()[0]?.name).toBe("Čaj");
  });

  it("removes a preset, and refuses one that is not there", () => {
    const timers = store();
    const preset = timers.createPreset({ name: "Kafa", durationSeconds: 240 }, NOW);

    timers.removePreset(preset.id);
    expect(timers.listPresets()).toEqual([]);
    expect(() => timers.removePreset(preset.id)).toThrow(TimersNotFoundError);
  });

  it("orders presets the way a person reads them, not by insertion", () => {
    const timers = store();
    timers.createPreset({ name: "Šetnja", durationSeconds: 600 }, NOW);
    timers.createPreset({ name: "Čaj", durationSeconds: 180 }, NOW);
    timers.createPreset({ name: "Kafa", durationSeconds: 240 }, NOW);

    expect(timers.listPresets().map((preset) => preset.name)).toEqual(["Čaj", "Kafa", "Šetnja"]);
  });
});

describe("TimersStore countdowns", () => {
  it("stores a countdown by its END, never by a remaining time", () => {
    const timers = store();
    const countdown = timers.createCountdown(
      { label: "Pasta", durationSeconds: 540 },
      NOW,
    );

    expect(countdown).toMatchObject({
      label: "Pasta",
      durationSeconds: 540,
      endsAt: "2026-06-01T08:09:00.000Z",
      remainingSeconds: null,
    });
  });

  it("pauses into remaining whole seconds and resumes from them", () => {
    const timers = store();
    const countdown = timers.createCountdown({ label: "Pasta", durationSeconds: 540 }, NOW);

    // 90.5 seconds in: the pause keeps a WHOLE second that is still owed, so a
    // resume can never hand back less time than the timer had left.
    const paused = timers.pauseCountdown(countdown.id, "2026-06-01T08:01:30.500Z");
    expect(paused.endsAt).toBeNull();
    expect(paused.remainingSeconds).toBe(450);

    const resumed = timers.resumeCountdown(countdown.id, LATER);
    expect(resumed.remainingSeconds).toBeNull();
    expect(resumed.endsAt).toBe("2026-06-01T09:07:30.000Z");
  });

  it("extends a RUNNING countdown by moving its end, and a PAUSED one by its remainder", () => {
    const timers = store();
    const running = timers.createCountdown({ label: "A", durationSeconds: 60 }, NOW);
    expect(timers.extendCountdown(running.id, 60, NOW).endsAt).toBe("2026-06-01T08:02:00.000Z");

    // Pausing at the very instant it started: two minutes are owed, because the
    // extension moved the END rather than storing a bigger number.
    const paused = timers.pauseCountdown(running.id, NOW);
    expect(paused.remainingSeconds).toBe(120);
    expect(timers.extendCountdown(running.id, 60, NOW).remainingSeconds).toBe(180);
  });

  it("cancels a countdown by removing it, and refuses an unknown one", () => {
    const timers = store();
    const countdown = timers.createCountdown({ label: "A", durationSeconds: 60 }, NOW);

    timers.cancelCountdown(countdown.id);
    expect(timers.listCountdowns()).toEqual([]);
    expect(() => timers.cancelCountdown(countdown.id)).toThrow(TimersNotFoundError);
    expect(() => timers.pauseCountdown(countdown.id, NOW)).toThrow(TimersNotFoundError);
  });

  it("lists running countdowns in the order they will end", () => {
    const timers = store();
    timers.createCountdown({ label: "long", durationSeconds: 600 }, NOW);
    timers.createCountdown({ label: "short", durationSeconds: 60 }, NOW);

    expect(timers.listCountdowns().map((countdown) => countdown.label)).toEqual([
      "short",
      "long",
    ]);
  });

  it("refuses a label that is blank, over-long, or a duration off the clock", () => {
    const timers = store();
    expect(() => timers.createCountdown({ label: "  ", durationSeconds: 60 }, NOW)).toThrow(
      TimersValidationError,
    );
    expect(() =>
      timers.createCountdown({ label: "x".repeat(61), durationSeconds: 60 }, NOW),
    ).toThrow(TimersValidationError);
    expect(() => timers.createCountdown({ label: "A", durationSeconds: 86_401 }, NOW)).toThrow(
      TimersValidationError,
    );
    expect(() => timers.createCountdown({ label: "A", durationSeconds: 60 }, "not a date")).toThrow(
      TimersValidationError,
    );
  });
});

describe("TimersStore replaceFromArchive (ADR-090 §imex)", () => {
  it("replaces what the profile held with exactly what the archive carried", () => {
    const timers = store();
    timers.createPreset({ name: "Kafa", durationSeconds: 240 }, NOW);
    timers.setSoundOnEnd(false, NOW);

    timers.replaceFromArchive(
      { presets: [{ name: "Čaj", durationSeconds: 180 }], soundOnEnd: true },
      LATER,
    );

    expect(timers.listPresets().map((preset) => preset.name)).toEqual(["Čaj"]);
    expect(timers.settings()).toEqual({ soundOnEnd: true });
  });

  it("empties the preset list when the archive carries none", () => {
    const timers = store();
    timers.createPreset({ name: "Kafa", durationSeconds: 240 }, NOW);

    timers.replaceFromArchive({ presets: [], soundOnEnd: true }, LATER);

    // An archive that names no preset is an archive whose profile had none, which
    // is a different statement from "say nothing about them" — that is the empty
    // section, and it arrives here as `soundOnEnd: null`, below.
    expect(timers.listPresets()).toEqual([]);
  });

  it("leaves no settings row when the archive carried no preference", () => {
    const profileId = createProfile();
    const timers = store(profileId);
    timers.setSoundOnEnd(false, NOW);
    // Read the default off a profile that has never held a Timers row rather than
    // restating it here: the value is the store's, and a test that hard-coded it
    // would keep passing the day the store's answer changed.
    const rowlessProfile = store().settings();

    timers.replaceFromArchive({ presets: [], soundOnEnd: null }, LATER);

    expect(timers.settings()).toEqual(rowlessProfile);
    expect(
      db.raw
        .prepare("SELECT count(*) AS n FROM timers_settings WHERE profile_id = ?")
        .get(profileId),
    ).toEqual({ n: 0 });
  });

  it("writes nothing at all when one row is refused", () => {
    const timers = store();
    timers.createPreset({ name: "Kafa", durationSeconds: 240 }, NOW);

    expect(() =>
      timers.replaceFromArchive(
        {
          presets: [
            { name: "Čaj", durationSeconds: 180 },
            { name: "X", durationSeconds: 0 },
          ],
          soundOnEnd: false,
        },
        LATER,
      ),
    ).toThrow(TimersValidationError);

    // The whole replace is one transaction, so the first row is not written
    // either — and the profile still holds what it held.
    expect(timers.listPresets().map((preset) => preset.name)).toEqual(["Kafa"]);
  });

  it("never touches the countdowns a profile is still running", () => {
    const timers = store();
    const countdown = timers.createCountdown({ label: "Pasta", durationSeconds: 540 }, NOW);

    timers.replaceFromArchive({ presets: [], soundOnEnd: true }, LATER);

    expect(timers.countdown(countdown.id)).not.toBeNull();
  });
});

describe("TimersStore settings", () => {
  it("ships with the sound on, without a row", () => {
    expect(store().settings()).toEqual({ soundOnEnd: true });
  });

  it("stores a change, and reads it back", () => {
    const timers = store();
    expect(timers.setSoundOnEnd(false, LATER)).toEqual({ soundOnEnd: false });
    expect(timers.settings()).toEqual({ soundOnEnd: false });
    expect(timers.setSoundOnEnd(true, LATER)).toEqual({ soundOnEnd: true });
  });
});

describe("TimersStore is scoped to its profile", () => {
  it("never answers for another profile's row", () => {
    const first = store();
    const second = store();
    const preset = first.createPreset({ name: "Kafa", durationSeconds: 240 }, NOW);
    const countdown = first.createCountdown({ label: "A", durationSeconds: 60 }, NOW);

    expect(second.listPresets()).toEqual([]);
    expect(second.listCountdowns()).toEqual([]);
    expect(() => second.renamePreset(preset.id, { name: "B" }, NOW)).toThrow(TimersNotFoundError);
    expect(() => second.cancelCountdown(countdown.id)).toThrow(TimersNotFoundError);
    expect(second.settings()).toEqual({ soundOnEnd: true });
  });

  it("lets two profiles hold a preset of the same name", () => {
    const first = store();
    const second = store();
    first.createPreset({ name: "Kafa", durationSeconds: 240 }, NOW);
    expect(() => second.createPreset({ name: "Kafa", durationSeconds: 240 }, NOW)).not.toThrow();
  });
});

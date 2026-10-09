import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { register } from "./register.js";

/**
 * The TIMERS module through the kit (ADR-090): its ops, the timers main arms,
 * the announcement a finished countdown produces, and its archive section.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals, the sender check and the channel allowlist are all the host's. Going
 * through `dispatch` therefore tests what actually runs in the app — a typo in an
 * op name or a payload the validators refuse is a rejected promise here, not a
 * surprise on the first click.
 *
 * The clock is the harness's, so "a countdown ends" is a number this test moves
 * rather than thirty seconds it waits for, and the scheduler is a list of armed
 * timers it drives by hand. Everything else is real: a real encrypted database,
 * the real migrations, the real store.
 */

const TRUSTED = { trusted: true };

let dir: string;
let db: NexusDatabase;
let clock = Date.parse("2026-06-01T08:00:00.000Z");

interface Harness {
  readonly host: ModuleHost;
  readonly toasts: { title: string; body: string; silent: boolean }[];
  readonly timers: { atMs: number; run: () => void; cancelled: boolean }[];
  /** Moves the clock forward by `seconds` and runs every armed timer whose instant has passed — the one thing a wall clock would do. */
  advance(seconds: number): void;
  at(iso: string): void;
}

function harness(): Harness {
  const toasts: Harness["toasts"] = [];
  const timers: Harness["timers"] = [];
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    notify: (copy) => toasts.push(copy),
    schedule: (atMs, run) => {
      const entry = { atMs, run, cancelled: false };
      timers.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    now: () => clock,
  };
  const host = new ModuleHost(platform);
  register(host);

  const harnessed: Harness = {
    host,
    toasts,
    timers,
    advance(seconds) {
      clock += seconds * 1000;
      drain();
    },
    at(iso) {
      clock = Date.parse(iso);
    },
  };

  /**
   * Runs every armed timer whose instant has arrived, in order, and keeps going
   * until nothing is left to run — which is what `armUntil`'s bounded hops
   * produce for an instant more than half a minute away.
   */
  function drain(): void {
    for (let step = 0; step < 1_000; step += 1) {
      const due = timers.find((timer) => !timer.cancelled && timer.atMs <= clock);
      if (due === undefined) return;
      due.cancelled = true;
      due.run();
    }
  }

  return harnessed;
}

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date(clock).toISOString());
  return id;
}

async function call<T>(
  host: ModuleHost,
  channel: string,
  payload: unknown,
): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-timers-module-"));
  db = openDatabase({ path: join(dir, "timers.db") });
  clock = Date.parse("2026-06-01T08:00:00.000Z");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the timers handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = harness();
    expect(host.channels()).toEqual([
      "timers:list",
      "timers:createPreset",
      "timers:renamePreset",
      "timers:removePreset",
      "timers:createCountdown",
      "timers:pauseCountdown",
      "timers:resumeCountdown",
      "timers:extendCountdown",
      "timers:cancelCountdown",
      "timers:setSoundOnEnd",
    ]);
  });

  it("answers a read with the rows and the module's preference", async () => {
    const { host } = harness();
    const profileId = createProfile();

    await call(host, "timers:createPreset", { profileId, name: "Kafa", durationSeconds: 240 });
    const view = await call<{
      presets: { name: string; durationSeconds: number }[];
      countdowns: unknown[];
      settings: { soundOnEnd: boolean };
    }>(host, "timers:list", { profileId });

    expect(view.presets).toEqual([
      expect.objectContaining({ name: "Kafa", durationSeconds: 240 }),
    ]);
    expect(view.countdowns).toEqual([]);
    expect(view.settings).toEqual({ soundOnEnd: true });
  });

  it("refuses a payload the wire should never carry, before the store sees it", async () => {
    const { host } = harness();
    const profileId = createProfile();

    await expect(
      call(host, "timers:createCountdown", { profileId, name: "", durationSeconds: 60 }),
    ).rejects.toThrow(/must be a non-empty string/);
    await expect(
      call(host, "timers:createCountdown", { profileId, name: "A", durationSeconds: 90_000 }),
    ).rejects.toThrow(/between 1 and 86400/);
    await expect(
      call(host, "timers:createCountdown", { profileId, name: "A", durationSeconds: 1.5 }),
    ).rejects.toThrow(/must be an integer/);
    // And a field that is not an id at all is refused as an id, not passed on.
    await expect(
      call(host, "timers:cancelCountdown", { profileId, id: "  padded  " }),
    ).rejects.toThrow(/not a well-formed id/);
  });
});

describe("the countdown main owns", () => {
  it("announces a finished countdown and removes the row, with the page never open", async () => {
    const kit = harness();
    const profileId = createProfile();
    const view = await call<{ countdowns: { id: string }[] }>(kit.host, "timers:createCountdown", {
      profileId,
      name: "Kafa",
      durationSeconds: 90,
    });
    const countdownId = view.countdowns[0]?.id ?? "";
    expect(countdownId).not.toBe("");
    // The clock is main's: nothing on the page has to be open for it to be
    // armed. The armed instant is a BOUNDED HOP rather than the countdown's own
    // end (the host re-arms in half-minute steps so a machine that slept through
    // the moment still fires), which is the property asserted here.
    expect(kit.timers.some((timer) => !timer.cancelled && timer.atMs <= clock + 30_000)).toBe(true);

    kit.advance(90);

    expect(kit.toasts).toEqual([
      { title: "Odbrojavanje je završeno", body: "Kafa", silent: false },
    ]);
    const after = await call<{ countdowns: unknown[] }>(kit.host, "timers:list", { profileId });
    expect(after.countdowns).toEqual([]);
  });

  it("stops counting a paused countdown, and picks it up again on resume", async () => {
    const kit = harness();
    const profileId = createProfile();
    const created = await call<{ countdowns: { id: string }[] }>(kit.host, "timers:createCountdown", {
      profileId,
      name: "Pasta",
      durationSeconds: 540,
    });
    const id = created.countdowns[0]?.id ?? "";

    await call(kit.host, "timers:pauseCountdown", { profileId, id });
    kit.advance(600);
    expect(kit.toasts).toEqual([]);

    await call(kit.host, "timers:resumeCountdown", { profileId, id });
    kit.advance(540);
    expect(kit.toasts).toEqual([
      { title: "Odbrojavanje je završeno", body: "Pasta", silent: false },
    ]);
  });

  it("moves a running countdown's end rather than storing a longer number (+1 min)", async () => {
    const kit = harness();
    const profileId = createProfile();
    const created = await call<{ countdowns: { id: string; endsAt: string }[] }>(
      kit.host,
      "timers:createCountdown",
      { profileId, name: "Čaj", durationSeconds: 60 },
    );
    const id = created.countdowns[0]?.id ?? "";

    const extended = await call<{ countdowns: { endsAt: string }[] }>(
      kit.host,
      "timers:extendCountdown",
      { profileId, id, seconds: 60 },
    );
    expect(extended.countdowns[0]?.endsAt).toBe("2026-06-01T08:02:00.000Z");

    kit.advance(120);
    expect(kit.toasts).toHaveLength(1);
  });

  it("never announces a countdown the user cancelled", async () => {
    const kit = harness();
    const profileId = createProfile();
    const created = await call<{ countdowns: { id: string }[] }>(kit.host, "timers:createCountdown", {
      profileId,
      name: "Kafa",
      durationSeconds: 30,
    });
    await call(kit.host, "timers:cancelCountdown", {
      profileId,
      id: created.countdowns[0]?.id ?? "",
    });

    kit.advance(30);

    expect(kit.toasts).toEqual([]);
  });

  it("uses the module's own sound preference for the toast, read at the moment it fires", async () => {
    const kit = harness();
    const profileId = createProfile();
    await call(kit.host, "timers:setSoundOnEnd", { profileId, soundOnEnd: false });
    await call(kit.host, "timers:createCountdown", { profileId, name: "Kafa", durationSeconds: 10 });

    kit.advance(10);

    expect(kit.toasts).toEqual([
      { title: "Odbrojavanje je završeno", body: "Kafa", silent: true },
    ]);
  });

  it("arms and announces a countdown that ran out while the app was closed, at the next unlock", async () => {
    const kit = harness();
    const profileId = createProfile();
    await call(kit.host, "timers:createCountdown", { profileId, name: "Kafa", durationSeconds: 60 });
    // The app goes away: the session ends (main cancels its own timers), time
    // passes, and the next unlock opens a fresh session — which is exactly the
    // moment a countdown that ended in the meantime has to be accounted for.
    kit.host.sessionEnd();
    kit.at("2026-06-01T09:00:00.000Z");

    kit.host.sessionStart([profileId]);

    expect(kit.toasts).toEqual([
      { title: "Odbrojavanje je završeno", body: "Kafa", silent: false },
    ]);
    const after = await call<{ countdowns: unknown[] }>(kit.host, "timers:list", { profileId });
    expect(after.countdowns).toEqual([]);
  });
});

describe("the timers archive section", () => {
  it("round-trips the presets and the preference between two profiles", async () => {
    const kit = harness();
    const source = createProfile();
    const target = createProfile();
    await call(kit.host, "timers:createPreset", { profileId: source, name: "Kafa", durationSeconds: 240 });
    await call(kit.host, "timers:createPreset", { profileId: source, name: "Čaj", durationSeconds: 180 });
    await call(kit.host, "timers:setSoundOnEnd", { profileId: source, soundOnEnd: false });

    const [section] = kit.host.collectExports([source]);
    expect(section?.moduleId).toBe("timers");
    kit.host.applyImports([section!], [target]);

    const restored = await call<{
      presets: { name: string; durationSeconds: number }[];
      settings: { soundOnEnd: boolean };
    }>(kit.host, "timers:list", { profileId: target });
    expect(restored.presets.map((preset) => preset.name).sort()).toEqual(["Kafa", "Čaj"]);
    expect(restored.presets.map((preset) => preset.durationSeconds).sort((a, b) => a - b)).toEqual([
      180, 240,
    ]);
    expect(restored.settings).toEqual({ soundOnEnd: false });
  });

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {
    const kit = harness();
    const profileId = createProfile();
    await call(kit.host, "timers:createPreset", { profileId, name: "Kafa", durationSeconds: 240 });

    // Three shapes a later build (or a hand-edited archive) could produce: a
    // version this module does not know, a row that is not a preset, and a
    // duration the store's own CHECK would refuse.
    for (const payload of [
      { version: 99, presets: [], settings: { soundOnEnd: true } },
      { version: 1, presets: [{ name: "X" }], settings: { soundOnEnd: true } },
      {
        version: 1,
        presets: [
          { name: "Čaj", durationSeconds: 180 },
          { name: "X", durationSeconds: 0 },
        ],
        settings: { soundOnEnd: true },
      },
    ]) {
      expect(() => kit.host.applyImports([{ moduleId: "timers", payload }], [profileId])).toThrow();
      const after = await call<{ presets: { name: string }[] }>(kit.host, "timers:list", {
        profileId,
      });
      expect(after.presets.map((preset) => preset.name)).toEqual(["Kafa"]);
    }
  });

  it("says nothing about countdowns, which are clocks rather than content", async () => {
    const kit = harness();
    const source = createProfile();
    const target = createProfile();
    await call(kit.host, "timers:createCountdown", { profileId: source, name: "Kafa", durationSeconds: 300 });

    const [section] = kit.host.collectExports([source]);
    kit.host.applyImports([section!], [target]);

    const restored = await call<{ countdowns: unknown[] }>(kit.host, "timers:list", {
      profileId: target,
    });
    expect(restored.countdowns).toEqual([]);
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const kit = harness();
    expect(kit.host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});

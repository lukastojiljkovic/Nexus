import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { clearDeviceLocation } from "./location.js";
import { register } from "./register.js";
import { installTextSaver, type SaveTextRequest } from "./saveFile.js";

/**
 * THE LAB through the kit (ADR-090): its ops, the readings it writes, the
 * device-wide location, and its archive section.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals, the sender check and the channel allowlist are all the host's. Going
 * through `dispatch` therefore tests what runs in the app — a typo in an op name
 * or a payload the validators refuse is a rejected promise here, not a surprise
 * on the first click.
 *
 * **Why `lab:battery` is registered but never invoked here.** That handler runs
 * `powercfg`, which on this machine takes between ten and twenty-four seconds —
 * measured while this module was written, and on a four-core CI runner three to
 * four times that. A suite that spent half a minute spawning a Windows tool
 * would be measuring the machine rather than the module, so what is asserted is
 * that the channel EXISTS, and the report's own parsing is pinned by
 * `packages/core/src/lab/batteryReport.test.ts` against a fixture.
 *
 * **Why the saver is a stub here.** The real one is a dialog
 * (`modules/lab/main/electron.ts`, installed at startup); the injected seam is
 * what lets the two file ops be driven end to end — and the stub is also the
 * oracle for the CSV, because it receives exactly the bytes main would write.
 */

const TRUSTED = { trusted: true };
let clock = Date.parse("2026-10-10T08:00:00.000Z");

let dir: string;
let db: NexusDatabase;
let kit: Harness;

interface Harness {
  readonly host: ModuleHost;
  /** Every file the module's two save ops asked to write. */
  readonly saved: SaveTextRequest[];
}

function harness(): Harness {
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    notify: () => undefined,
    schedule: () => () => undefined,
    now: () => clock,
  };
  const host = new ModuleHost(platform);
  register(host);

  const saved: SaveTextRequest[] = [];
  installTextSaver(async (request) => {
    saved.push(request);
    return { canceled: false, path: `C:\\Temp\\${request.defaultFileName}` };
  });
  return { host, saved };
}

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date(clock).toISOString());
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

/** The sketch the task names, as the page's CSV mode would hand it over. */
const COLUMNS = ["temp", "humidity", "pressure"];

/**
 * ONE database and ONE host for the file, not one per test.
 *
 * Opening this schema runs eighty-odd migrations on an encrypted file, and doing
 * it fourteen times would double the suite's cost for isolation the tests do not
 * need: every test makes its OWN profile (and every store statement is scoped by
 * `profile_id`), the saver's recorded calls are cleared per test, and the clock
 * is reset per test. What is shared is the scaffolding, not the state.
 */
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-lab-module-"));
  db = openDatabase({ path: join(dir, "lab.db") });
  kit = harness();
});

beforeEach(() => {
  clock = Date.parse("2026-10-10T08:00:00.000Z");
  kit.saved.length = 0;
  // The location is DEVICE state shared by the whole process, so a test that set
  // one must not be able to hand it to the next one.
  clearDeviceLocation();
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the lab handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = kit;
    expect(host.channels()).toEqual([
      "lab:list",
      "lab:logSamples",
      "lab:createLog",
      "lab:appendSamples",
      "lab:removeLog",
      "lab:exportLogCsv",
      "lab:saveTerminalLog",
      "lab:setOffGrid",
      "lab:battery",
      "lab:setLocation",
      "lab:clearLocation",
    ]);
  });

  it("answers a read with the logs, the budget and the location", async () => {
    const { host } = kit;
    const profileId = createProfile();

    const empty = await call<{
      logs: unknown[];
      offGrid: unknown;
      location: unknown;
    }>(host, "lab:list", { profileId });
    expect(empty).toEqual({ logs: [], offGrid: null, location: null });

    await call(host, "lab:createLog", { profileId, name: "Radionica", columns: COLUMNS });
    const view = await call<{ logs: { name: string; columns: string[]; sampleCount: number }[] }>(
      host,
      "lab:list",
      { profileId },
    );
    expect(view.logs).toEqual([
      expect.objectContaining({ name: "Radionica", columns: COLUMNS, sampleCount: 0 }),
    ]);
  });

  it("refuses a payload the wire should never carry, before the store sees it", async () => {
    const { host } = kit;
    const profileId = createProfile();

    await expect(call(host, "lab:createLog", { profileId, name: "", columns: COLUMNS })).rejects.toThrow(
      /non-empty string/,
    );
    await expect(
      call(host, "lab:createLog", { profileId, name: "X", columns: [] }),
    ).rejects.toThrow(/1\.\.12 columns/);
    // A column NAME is not a value: `23.5` is what a reading holds, never what a
    // column is called.
    await expect(
      call(host, "lab:createLog", { profileId, name: "X", columns: ["23.5"] }),
    ).rejects.toThrow(/not a column name/);
    await expect(
      call(host, "lab:createLog", { profileId, name: "X", columns: ["a", "a"] }),
    ).rejects.toThrow(/twice/);
    // And a field that is not an id at all is refused as an id, not passed on.
    await expect(call(host, "lab:removeLog", { profileId, logId: "  padded  " })).rejects.toThrow(
      /well-formed id/,
    );
    await expect(
      call(host, "lab:appendSamples", { profileId, logId: "nope", lines: ["1,2,3"] }),
    ).rejects.toThrow(/no log/);
  });
});

describe("the readings this module writes", () => {
  it("parses the device's own lines and stores the numbers", async () => {
    const { host } = kit;
    const profileId = createProfile();
    await call(host, "lab:createLog", { profileId, name: "Radionica", columns: COLUMNS });
    const view = await call<{ logs: { id: string }[] }>(host, "lab:list", { profileId });
    const logId = view.logs[0]?.id ?? "";

    const after = await call<{ logs: { sampleCount: number; lastAt: string | null }[] }>(
      host,
      "lab:appendSamples",
      { profileId, logId, lines: ["23.5,41,1009", "23.6,41.1,1008.5"] },
    );
    expect(after.logs[0]?.sampleCount).toBe(2);
    expect(after.logs[0]?.lastAt).toBe("2026-10-10T08:00:00.000Z");

    const read = await call<{ columns: string[]; samples: { values: number[] }[] }>(
      host,
      "lab:logSamples",
      { profileId, logId },
    );
    expect(read.columns).toEqual(COLUMNS);
    expect(read.samples.map((sample) => sample.values)).toEqual([
      [23.5, 41, 1009],
      [23.6, 41.1, 1008.5],
    ]);
  });

  it("refuses a line that is not the log's column count rather than storing it", async () => {
    const { host } = kit;
    const profileId = createProfile();
    await call(host, "lab:createLog", { profileId, name: "Radionica", columns: COLUMNS });
    const view = await call<{ logs: { id: string }[] }>(host, "lab:list", { profileId });
    const logId = view.logs[0]?.id ?? "";

    await expect(
      call(host, "lab:appendSamples", { profileId, logId, lines: ["23.5,41"] }),
    ).rejects.toThrow(/not 3 comma-separated numbers/);
    await expect(
      call(host, "lab:appendSamples", { profileId, logId, lines: ["temp,humidity,pressure"] }),
    ).rejects.toThrow(/not 3 comma-separated numbers/);
    const after = await call<{ logs: { sampleCount: number }[] }>(host, "lab:list", { profileId });
    expect(after.logs[0]?.sampleCount).toBe(0);
  });

  it("exports one log's whole content as a CSV, through the saver", async () => {

    const profileId = createProfile();
    await call(kit.host, "lab:createLog", { profileId, name: "Radionica", columns: COLUMNS });
    const view = await call<{ logs: { id: string }[] }>(kit.host, "lab:list", { profileId });
    const logId = view.logs[0]?.id ?? "";
    await call(kit.host, "lab:appendSamples", {
      profileId,
      logId,
      lines: ["23.5,41,1009", "23.6,41.1,1008.5"],
    });

    const saved = await call<{ canceled: boolean; path: string | null }>(
      kit.host,
      "lab:exportLogCsv",
      { profileId, logId },
    );
    expect(saved.canceled).toBe(false);
    expect(saved.path).toBe("C:\\Temp\\Radionica.csv");
    expect(kit.saved).toHaveLength(1);
    // The bytes are the tested one: the core formatter's own output, with the
    // timestamp column and a machine-readable decimal point.
    expect(kit.saved[0]?.text).toBe(
      "at,temp,humidity,pressure\r\n" +
        "2026-10-10T08:00:00.000Z,23.5000,41.0000,1009.0000\r\n" +
        "2026-10-10T08:00:00.000Z,23.6000,41.1000,1008.5000\r\n",
    );
  });

  it("saves the terminal's text as it stands, and bounds it", async () => {

    const saved = await call<{ canceled: boolean; path: string | null }>(
      kit.host,
      "lab:saveTerminalLog",
      { text: "$GPGGA,123519\r\n" },
    );
    expect(saved.path).toBe("C:\\Temp\\terminal.log");
    expect(kit.saved[0]?.text).toBe("$GPGGA,123519\r\n");

    await expect(
      call(kit.host, "lab:saveTerminalLog", { text: "x".repeat(2_000_001) }),
    ).rejects.toThrow(/must not exceed/);
  });
});

describe("the off-grid budget and the location", () => {
  it("stores the whole budget and answers it back in the view", async () => {
    const { host } = kit;
    const profileId = createProfile();
    const devices = [
      { name: "Laptop", watts: 45, hoursPerDay: 8 },
      { name: "Lampa", watts: 10.5, hoursPerDay: 2.5 },
    ];

    const view = await call<{ offGrid: unknown }>(host, "lab:setOffGrid", {
      profileId,
      devices,
      batteryWh: 1_200,
      depthOfDischarge: 0.5,
      sunHours: 4,
    });
    expect(view.offGrid).toEqual({
      devices,
      batteryWh: 1_200,
      depthOfDischarge: 0.5,
      sunHours: 4,
    });
  });

  it("refuses a budget whose numbers are outside the range the fields allow", async () => {
    const { host } = kit;
    const profileId = createProfile();
    const base = {
      profileId,
      devices: [{ name: "Laptop", watts: 45, hoursPerDay: 8 }],
      batteryWh: 1_200,
      depthOfDischarge: 0.5,
      sunHours: 4,
    };
    await expect(call(host, "lab:setOffGrid", { ...base, depthOfDischarge: 0 })).rejects.toThrow(
      /depthOfDischarge/,
    );
    await expect(call(host, "lab:setOffGrid", { ...base, sunHours: 25 })).rejects.toThrow(/sunHours/);
    await expect(call(host, "lab:setOffGrid", { ...base, batteryWh: "800" })).rejects.toThrow(
      /finite number/,
    );
    await expect(
      call(host, "lab:setOffGrid", { ...base, devices: [{ name: "", watts: 1, hoursPerDay: 1 }] }),
    ).rejects.toThrow(/devices\[\]\.name/);
  });

  it("remembers a fix app-wide and forgets it when the session ends", async () => {
    const { host } = kit;
    const profileId = createProfile();

    const set = await call<{ location: { latitude: number; longitude: number } | null }>(
      host,
      "lab:setLocation",
      { profileId, latitude: 48.1173, longitude: 11.5166 },
    );
    expect(set.location?.latitude).toBeCloseTo(48.1173, 10);
    expect(set.location?.longitude).toBeCloseTo(11.5166, 10);

    // A latitude that is not a place is refused rather than clamped: clamping
    // would put the app's idea of its position on the equator.
    await expect(
      call(host, "lab:setLocation", { profileId, latitude: 91, longitude: 0 }),
    ).rejects.toThrow(/latitude/);

    const cleared = await call<{ location: unknown }>(host, "lab:clearLocation", { profileId });
    expect(cleared.location).toBeNull();

    await call(host, "lab:setLocation", { profileId, latitude: 44.8, longitude: 20.5 });
    host.sessionEnd();
    const after = await call<{ location: unknown }>(host, "lab:list", { profileId });
    expect(after.location).toBeNull();
  });
});

describe("the lab archive section", () => {
  it("round-trips the logs, their readings and the budget between two profiles", async () => {

    const source = createProfile();
    const target = createProfile();
    await call(kit.host, "lab:createLog", { profileId: source, name: "Radionica", columns: COLUMNS });
    const view = await call<{ logs: { id: string }[] }>(kit.host, "lab:list", { profileId: source });
    const logId = view.logs[0]?.id ?? "";
    await call(kit.host, "lab:appendSamples", {
      profileId: source,
      logId,
      lines: ["23.5,41,1009", "23.6,41.1,1008.5"],
    });
    await call(kit.host, "lab:setOffGrid", {
      profileId: source,
      devices: [{ name: "Laptop", watts: 45, hoursPerDay: 8 }],
      batteryWh: 1_200,
      depthOfDischarge: 0.5,
      sunHours: 4,
    });

    const [section] = kit.host.collectExports([source]);
    expect(section?.moduleId).toBe("lab");
    kit.host.applyImports([section!], [target]);

    const restored = await call<{
      logs: { id: string; name: string; columns: string[]; sampleCount: number }[];
      offGrid: { batteryWh: number; sunHours: number } | null;
    }>(kit.host, "lab:list", { profileId: target });
    expect(restored.logs).toHaveLength(1);
    expect(restored.logs[0]).toMatchObject({
      name: "Radionica",
      columns: COLUMNS,
      sampleCount: 2,
    });
    expect(restored.offGrid).toEqual({
      devices: [{ name: "Laptop", watts: 45, hoursPerDay: 8 }],
      batteryWh: 1_200,
      depthOfDischarge: 0.5,
      sunHours: 4,
    });
    const samples = await call<{ samples: { values: number[] }[] }>(kit.host, "lab:logSamples", {
      profileId: target,
      logId: restored.logs[0]?.id ?? "",
    });
    expect(samples.samples.map((sample) => sample.values)).toEqual([
      [23.5, 41, 1009],
      [23.6, 41.1, 1008.5],
    ]);
  });

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {

    const profileId = createProfile();
    await call(kit.host, "lab:createLog", { profileId, name: "Radionica", columns: COLUMNS });

    const refused = [
      // A version this module does not know.
      { version: 99, logs: [], offGrid: null },
      // A log row that is not a log.
      { version: 1, logs: [{ name: "X" }], offGrid: null },
      // Two logs with one name.
      {
        version: 1,
        logs: [
          { name: "X", columns: ["a"], samples: [] },
          { name: "X", columns: ["a"], samples: [] },
        ],
        offGrid: null,
      },
      // A reading whose value count is not its log's.
      {
        version: 1,
        logs: [{ name: "X", columns: ["a"], samples: [{ at: "2026-10-10T08:00:00.000Z", values: [1, 2] }] }],
        offGrid: null,
      },
      // A column name that is a value.
      { version: 1, logs: [{ name: "X", columns: ["23.5"], samples: [] }], offGrid: null },
      // A budget outside its bounds.
      {
        version: 1,
        logs: [],
        offGrid: {
          devices: [{ name: "L", watts: 45, hoursPerDay: 8 }],
          batteryWh: 1_200,
          depthOfDischarge: 0,
          sunHours: 4,
        },
      },
    ];
    for (const payload of refused) {
      expect(() => kit.host.applyImports([{ moduleId: "lab", payload }], [profileId])).toThrow();
      const after = await call<{ logs: { name: string }[] }>(kit.host, "lab:list", { profileId });
      expect(after.logs.map((log) => log.name)).toEqual(["Radionica"]);
    }
  });

  it("empties the archived state when the section names no Lab entry", async () => {

    const profileId = createProfile();
    await call(kit.host, "lab:createLog", { profileId, name: "Radionica", columns: COLUMNS });
    await call(kit.host, "lab:setOffGrid", {
      profileId,
      devices: [],
      batteryWh: 100,
      depthOfDischarge: 1,
      sunHours: 1,
    });

    // An archive with no Lab section is what a restore of an archive written
    // before this module hands over, and a restore replaces the profile whole.
    kit.host.applyImports([], [profileId]);

    const after = await call<{ logs: unknown[]; offGrid: unknown }>(kit.host, "lab:list", {
      profileId,
    });
    expect(after.logs).toEqual([]);
    // No rows is „never filled one in", not „a budget of zeroes".
    expect(after.offGrid).toBeNull();
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {

    expect(kit.host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});

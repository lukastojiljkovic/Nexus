import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LabNotFoundError,
  LabStore,
  LabValidationError,
  MAX_LAB_SAMPLES,
  MAX_LAB_SAMPLES_READ,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-10-10T08:00:00.000Z";
const LATER = "2026-10-10T09:00:00.000Z";

let dir: string;
let db: NexusDatabase;

/**
 * ONE database for the file, not one per test.
 *
 * Opening this schema means running eighty-odd migrations on an encrypted file,
 * and doing it fourteen times would be fourteen times the suite's cost for
 * isolation the tests do not need: every test makes its OWN profile, and every
 * statement in this store is scoped by `profile_id`, so the isolation each test
 * relies on is the profile's rather than the file's.
 */
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-lab-"));
  db = openDatabase({ path: join(dir, "lab.db") });
});

afterAll(() => {
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

function store(profileId = createProfile()): LabStore {
  return new LabStore(db.raw, profileId);
}

/** The sketch the task names: a header and three readings. */
const COLUMNS = ["temp", "humidity", "pressure"] as const;

describe("LabStore logs", () => {
  it("stores a named log with its columns and lists it", () => {
    const lab = store();
    const log = lab.createLog({ name: "  Radionica  ", columns: [...COLUMNS] }, NOW);

    expect(log).toMatchObject({
      name: "Radionica",
      columns: ["temp", "humidity", "pressure"],
      sampleCount: 0,
      lastAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(lab.listLogs()).toEqual([log]);
  });

  it("orders the list by the Serbian collator, not by SQLite's binary one", () => {
    const lab = store();
    lab.createLog({ name: "Škola", columns: ["a"] }, NOW);
    lab.createLog({ name: "Radionica", columns: ["a"] }, NOW);
    lab.createLog({ name: "Čaj", columns: ["a"] }, NOW);
    // `Intl.Collator(["sr-Latn", "sr"])` puts Č between R and Š; a BINARY sort
    // would put both diacritics after every ASCII name.
    expect(lab.listLogs().map((log) => log.name)).toEqual(["Čaj", "Radionica", "Škola"]);
  });

  it("refuses a second log with the same name, a blank name, bad columns and too many logs", () => {
    const lab = store();
    lab.createLog({ name: "Radionica", columns: ["temp"] }, NOW);
    expect(() => lab.createLog({ name: "Radionica", columns: ["temp"] }, NOW)).toThrow(
      LabValidationError,
    );
    expect(() => lab.createLog({ name: "   ", columns: ["temp"] }, NOW)).toThrow(LabValidationError);
    // A column name is a name, by the same rule the header line is read by:
    // `23.5` is the value of a reading, never the name of one.
    expect(() => lab.createLog({ name: "X", columns: ["23.5"] }, NOW)).toThrow(LabValidationError);
    expect(() => lab.createLog({ name: "X", columns: ["temp", "temp"] }, NOW)).toThrow(
      LabValidationError,
    );
    expect(() => lab.createLog({ name: "X", columns: [] }, NOW)).toThrow(LabValidationError);
    expect(() =>
      lab.createLog({ name: "X", columns: Array.from({ length: 13 }, (_, i) => `c${i}`) }, NOW),
    ).toThrow(LabValidationError);
  });

  it("removes a log with its readings, and refuses one that is not there", () => {
    const lab = store();
    const log = lab.createLog({ name: "Radionica", columns: [...COLUMNS] }, NOW);
    lab.appendSamples({ logId: log.id, rows: [{ at: NOW, values: [23.5, 41, 1009] }] }, NOW);

    lab.removeLog(log.id);
    expect(lab.listLogs()).toEqual([]);
    const left = db.raw.prepare("SELECT count(*) AS n FROM lab_samples").get() as { n: number };
    expect(left.n).toBe(0);
    expect(() => lab.removeLog(log.id)).toThrow(LabNotFoundError);
  });
});

describe("LabStore readings", () => {
  it("appends readings and reads them back in time order", () => {
    const lab = store();
    const log = lab.createLog({ name: "Radionica", columns: [...COLUMNS] }, NOW);
    const written = lab.appendSamples(
      {
        logId: log.id,
        rows: [
          { at: "2026-10-10T08:00:01.000Z", values: [23.5, 41, 1009] },
          { at: "2026-10-10T08:00:02.000Z", values: [23.6, 41.1, 1008.5] },
        ],
      },
      NOW,
    );
    expect(written).toBe(2);
    expect(lab.readSamples(log.id).map((sample) => sample.values)).toEqual([
      [23.5, 41, 1009],
      [23.6, 41.1, 1008.5],
    ]);
    // The count and the newest instant are facts the list carries without
    // reading a single sample.
    expect(lab.listLogs()[0]).toMatchObject({
      sampleCount: 2,
      lastAt: "2026-10-10T08:00:02.000Z",
      updatedAt: NOW,
    });
  });

  it("refuses a reading whose value count is not the log's, and one that is not a number", () => {
    const lab = store();
    const log = lab.createLog({ name: "Radionica", columns: [...COLUMNS] }, NOW);
    expect(() =>
      lab.appendSamples({ logId: log.id, rows: [{ at: NOW, values: [23.5, 41] }] }, NOW),
    ).toThrow(LabValidationError);
    expect(() =>
      lab.appendSamples(
        { logId: log.id, rows: [{ at: NOW, values: [23.5, 41, 1009, 1] }] },
        NOW,
      ),
    ).toThrow(LabValidationError);
    expect(() =>
      lab.appendSamples(
        { logId: log.id, rows: [{ at: NOW, values: [23.5, 41, Number.NaN] }] },
        NOW,
      ),
    ).toThrow(LabValidationError);
    expect(() =>
      lab.appendSamples({ logId: log.id, rows: [{ at: "not-an-instant", values: [1, 2, 3] }] }, NOW),
    ).toThrow(LabValidationError);
    // Nothing was written by any of the refusals.
    expect(lab.listLogs()[0]?.sampleCount).toBe(0);
  });

  it("refuses a batch larger than the wire bound, and reading a log that is not this profile's", () => {
    const lab = store();
    const other = store();
    const log = lab.createLog({ name: "Radionica", columns: [...COLUMNS] }, NOW);
    const many = Array.from({ length: 601 }, () => ({ at: NOW, values: [1, 2, 3] }));
    expect(() => lab.appendSamples({ logId: log.id, rows: many }, NOW)).toThrow(LabValidationError);
    expect(() => other.readSamples(log.id)).toThrow(LabNotFoundError);
    expect(() => other.appendSamples({ logId: log.id, rows: [] }, NOW)).toThrow(LabNotFoundError);
  });

  it("keeps the newest readings and drops the oldest beyond the window", () => {
    const lab = store();
    const log = lab.createLog({ name: "Radionica", columns: ["v"] }, NOW);
    // Fill the window exactly, in the batches the wire allows: eight of 600 and
    // one of 200, carrying the values 0…4999.
    const rows = (from: number, count: number): { at: string; values: readonly number[] }[] =>
      Array.from({ length: count }, (_, index) => ({
        at: new Date(Date.parse(NOW) + (from + index) * 1000).toISOString(),
        values: [from + index],
      }));
    for (let from = 0; from < MAX_LAB_SAMPLES; from += 600) {
      lab.appendSamples(
        { logId: log.id, rows: rows(from, Math.min(600, MAX_LAB_SAMPLES - from)) },
        LATER,
      );
    }
    expect(lab.listLogs()[0]?.sampleCount).toBe(MAX_LAB_SAMPLES);

    // Ten more readings: the window slides, and the ten oldest are gone.
    lab.appendSamples({ logId: log.id, rows: rows(MAX_LAB_SAMPLES, 10) }, LATER);
    expect(lab.listLogs()[0]?.sampleCount).toBe(MAX_LAB_SAMPLES);
    // A read answers with the newest `MAX_LAB_SAMPLES_READ` of them, which after
    // the slide are the values 4410…5009: the newest 600 of the 5000 kept.
    const tail = lab.readSamples(log.id);
    expect(tail).toHaveLength(MAX_LAB_SAMPLES_READ);
    expect(tail[0]?.values).toEqual([MAX_LAB_SAMPLES + 9 - (MAX_LAB_SAMPLES_READ - 1)]);
    expect(tail[tail.length - 1]?.values).toEqual([MAX_LAB_SAMPLES + 9]);
  });

  it("reads the newest readings when asked for fewer than the log holds", () => {
    const lab = store();
    const log = lab.createLog({ name: "Radionica", columns: ["v"] }, NOW);
    lab.appendSamples(
      {
        logId: log.id,
        rows: Array.from({ length: 5 }, (_, index) => ({
          at: new Date(Date.parse(NOW) + index * 1000).toISOString(),
          values: [index],
        })),
      },
      NOW,
    );
    expect(lab.readSamples(log.id, 2).map((sample) => sample.values)).toEqual([[3], [4]]);
    // A caller cannot ask for more than a message may carry.
    expect(lab.readSamples(log.id, 10_000)).toHaveLength(5);
  });
});

describe("LabStore off-grid budget", () => {
  const budget = {
    devices: [
      { name: "Laptop", watts: 45, hoursPerDay: 8 },
      { name: "Lampa", watts: 10.5, hoursPerDay: 2.5 },
    ],
    batteryWh: 1_200,
    depthOfDischarge: 0.5,
    sunHours: 4,
  };

  it("answers null until a budget is written, then reads it back whole", () => {
    const lab = store();
    expect(lab.offGrid()).toBeNull();
    expect(lab.setOffGrid(budget, NOW)).toEqual(budget);
    expect(lab.offGrid()).toEqual(budget);
    // A second write replaces the first, because a budget is computed from the
    // list as a whole.
    const replaced = lab.setOffGrid({ ...budget, sunHours: 5 }, LATER);
    expect(replaced.sunHours).toBe(5);
    expect(lab.offGrid()?.sunHours).toBe(5);
  });

  it("refuses a value outside the schema's own bounds", () => {
    const lab = store();
    expect(() => lab.setOffGrid(budget, "yesterday")).toThrow(LabValidationError);
    expect(() => lab.setOffGrid({ ...budget, depthOfDischarge: 0 }, NOW)).toThrow(LabValidationError);
    expect(() => lab.setOffGrid({ ...budget, depthOfDischarge: 1.5 }, NOW)).toThrow(
      LabValidationError,
    );
    expect(() => lab.setOffGrid({ ...budget, sunHours: 0 }, NOW)).toThrow(LabValidationError);
    expect(() => lab.setOffGrid({ ...budget, sunHours: 25 }, NOW)).toThrow(LabValidationError);
    expect(() => lab.setOffGrid({ ...budget, batteryWh: -1 }, NOW)).toThrow(LabValidationError);
    expect(() => lab.setOffGrid({ ...budget, devices: [{ name: "", watts: 1, hoursPerDay: 1 }] }, NOW)).toThrow(
      LabValidationError,
    );
  });
});

describe("LabStore archive round trip", () => {
  it("replaces a profile's logs, readings and budget with one payload", () => {
    const source = store();
    const log = source.createLog({ name: "Radionica", columns: [...COLUMNS] }, NOW);
    source.appendSamples(
      {
        logId: log.id,
        rows: [
          { at: "2026-10-10T08:00:01.000Z", values: [23.5, 41, 1009] },
          { at: "2026-10-10T08:00:02.000Z", values: [23.6, 41.1, 1008.5] },
        ],
      },
      NOW,
    );
    source.setOffGrid(
      { devices: [{ name: "Laptop", watts: 45, hoursPerDay: 8 }], batteryWh: 1_200, depthOfDischarge: 0.5, sunHours: 4 },
      NOW,
    );

    // What an exporter does: the rows, read from the store.
    const logs = source.listLogs();
    const samples = source.readAllSamples();
    const offGrid = source.offGrid();

    const target = store();
    target.replaceFromArchive(
      {
        logs: logs.map((each) => ({
          name: each.name,
          columns: each.columns,
          samples: samples
            .filter((sample) => sample.logId === each.id)
            .map((sample) => ({ at: sample.at, values: sample.values })),
        })),
        offGrid,
      },
      LATER,
    );

    const restored = target.listLogs();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.name).toBe("Radionica");
    expect(restored[0]?.columns).toEqual(["temp", "humidity", "pressure"]);
    expect(restored[0]?.sampleCount).toBe(2);
    expect(restored[0]?.lastAt).toBe("2026-10-10T08:00:02.000Z");
    expect(target.readSamples((restored[0]?.id ?? "") as string).map((sample) => sample.values)).toEqual([
      [23.5, 41, 1009],
      [23.6, 41.1, 1008.5],
    ]);
    expect(target.offGrid()).toEqual(offGrid);
  });

  it("empties both halves when the archive says nothing about them", () => {
    const target = store();
    const log = target.createLog({ name: "Radionica", columns: ["v"] }, NOW);
    target.appendSamples({ logId: log.id, rows: [{ at: NOW, values: [1] }] }, NOW);
    target.setOffGrid(
      { devices: [], batteryWh: 100, depthOfDischarge: 1, sunHours: 1 },
      NOW,
    );

    target.replaceFromArchive({ logs: [], offGrid: null }, LATER);
    expect(target.listLogs()).toEqual([]);
    // Zero rows is „no budget", not „a budget of zeroes" — the store deletes the
    // row rather than writing a value nobody entered.
    expect(target.offGrid()).toBeNull();
  });

  it("refuses a payload it will not take before it deletes anything", () => {
    const target = store();
    const log = target.createLog({ name: "Radionica", columns: ["v"] }, NOW);

    expect(() =>
      target.replaceFromArchive(
        {
          logs: [
            { name: "a", columns: ["v"], samples: [{ at: NOW, values: [1] }] },
            { name: "a", columns: ["v"], samples: [] },
          ],
          offGrid: null,
        },
        LATER,
      ),
    ).toThrow(LabValidationError);
    expect(() =>
      target.replaceFromArchive(
        { logs: [{ name: "b", columns: ["v"], samples: [{ at: NOW, values: [1, 2] }] }], offGrid: null },
        LATER,
      ),
    ).toThrow(LabValidationError);
    // The refused archive left the profile exactly as it was.
    expect(target.listLogs().map((each) => each.id)).toEqual([log.id]);
  });
});

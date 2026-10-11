import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LabStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import type { Tool, ToolContext } from "@nexus/core";
import { labTools } from "./lab.js";

/**
 * The LAB tools over a real database.
 *
 * What this suite pins is the answer: a log's line names its own columns and how
 * many readings it holds, a reading is printed under its column's name, and the
 * off-grid figures come from the store's own inputs through `@nexus/core`'s
 * arithmetic. The budget below is a hand calculation: 60 W × 8 h + 10 W × 4 h =
 * 520 Wh a day, and 1 000 Wh × 0,5 = 500 Wh of usable capacity, which is 0,96 of
 * a day — the „1 dan" the answer rounds to.
 */

const NOW_MS = Date.UTC(2026, 9, 10, 7, 0, 0);
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-lab-"));
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

function store(): LabStore {
  return new LabStore(db.raw, profileId);
}

function context(locale: "sr" | "en"): ToolContext {
  return {
    profileId,
    locale,
    signal: new AbortController().signal,
    confirm: () => Promise.resolve(true),
  };
}

function tool(name: string): Tool {
  const found = labTools({ profileDb: (id, open) => open(db.raw, id) }).find(
    (entry) => entry.name === name,
  );
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

/** A log with two readings, and the budget the file header computes. */
function seed(): void {
  const log = store().createLog({ name: "Senzori", columns: ["temp", "vlaga"] }, NOW_ISO);
  store().appendSamples(
    {
      logId: log.id,
      rows: [
        { at: "2026-10-10T09:00:00", values: [21.5, 44] },
        { at: "2026-10-10T09:05:00", values: [22, 45] },
      ],
    },
    NOW_ISO,
  );
  store().setOffGrid(
    {
      devices: [
        { name: "Laptop", watts: 60, hoursPerDay: 8 },
        { name: "Lampa", watts: 10, hoursPerDay: 4 },
      ],
      batteryWh: 1_000,
      depthOfDischarge: 0.5,
      sunHours: 4,
    },
    NOW_ISO,
  );
}

describe("lab.logs", () => {
  it("reads a log and the off-grid budget", async () => {
    seed();
    const result = await tool("lab.logs").run({}, context("sr"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Dnevnici senzora (1):",
        "- Senzori (kolone: temp, vlaga, očitavanja: 2, poslednje: 10. oktobar 2026, 09:05)",
        "Van mreže — dnevni bilans:",
        "- uređaja: 2",
        "- potrošnja dnevno: 520 Wh",
        "- baterija: 1.000 Wh, dubina pražnjenja 50,0%",
        "- traje: 1 dan",
      ].join("\n"),
    });
  });

  it("says what is missing when the profile has neither", async () => {
    const result = await tool("lab.logs").run({}, context("en"));
    expect(result).toEqual({
      ok: true,
      content: [
        "No sensor log is kept yet.",
        "Off grid — the daily budget:",
        "No off-grid daily budget is kept.",
      ].join("\n"),
    });
  });

  it("says the zero consumption has no answer rather than printing a figure", async () => {
    store().setOffGrid(
      { devices: [], batteryWh: 1_000, depthOfDischarge: 0.5, sunHours: 4 },
      NOW_ISO,
    );
    const result = await tool("lab.logs").run({}, context("en"));
    expect(result.content).toContain("- the consumption is zero, so how long it lasts is not computed");
    expect(result.content).toContain("- devices: 0");
  });
});

describe("lab.readings", () => {
  it("reads the newest readings under their column names", async () => {
    seed();
    const result = await tool("lab.readings").run({}, context("sr"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Senzori — poslednja očitavanja (2):",
        "- 10. oktobar 2026, 09:00: temp 21,5, vlaga 44",
        "- 10. oktobar 2026, 09:05: temp 22, vlaga 45",
      ].join("\n"),
    });
  });

  it("answers with the newest rows the cap allows, and says older ones are left out", async () => {
    seed();
    const result = await tool("lab.readings").run({ limit: 1 }, context("en"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Senzori — the newest readings (1):",
        "- 10 October 2026, 09:05: temp 22, vlaga 45",
        "…and 1 more before these.",
      ].join("\n"),
    });
  });

  it("refuses a log name nothing matches, and names the logs that exist", async () => {
    seed();
    const result = await tool("lab.readings").run({ log: "Senzor" }, context("sr"));
    expect(result).toEqual({
      ok: false,
      content: "Neuspešno: Nema dnevnika „Senzor“. Dnevnici: Senzori.",
    });
  });

  it("asks which log when more than one exists, and says so when none does", async () => {
    seed();
    store().createLog({ name: "Baterija", columns: ["v"] }, NOW_ISO);
    const ambiguous = await tool("lab.readings").run({}, context("en"));
    expect(ambiguous).toEqual({
      ok: false,
      content: "Failed: More than one log exists, so name one. The logs: Baterija, Senzori.",
    });

    const empty = await tool("lab.readings").run(
      {},
      { ...context("sr"), profileId: uuidv7() },
    );
    expect(empty.ok).toBe(false);
    expect(empty.content).toBe(
      "Neuspešno: Nijedan dnevnik ne postoji; prvo se napravi dnevnik u Laboratoriji.",
    );
  });

  it("says a log holds no readings rather than answering with a heading", async () => {
    store().createLog({ name: "Prazan", columns: ["v"] }, NOW_ISO);
    const result = await tool("lab.readings").run({}, context("sr"));
    expect(result).toEqual({
      ok: true,
      content: "Dnevnik „Prazan“ još nema očitavanja.",
    });
  });
});

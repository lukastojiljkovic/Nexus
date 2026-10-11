import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CarStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import type { ConfirmRequest, Tool, ToolContext } from "@nexus/core";
import { carTools } from "./car.js";

/**
 * The CAR tools over a real database.
 *
 * The countdown is `@nexus/core`'s `whatIsDue` over the profile's own rows, so
 * these tests seed a service book and pin the sentence a person reads: which
 * interval is overdue, by how many days, and that a fill is stored as partial
 * unless the user said the tank was full.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-car-"));
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

function store(): CarStore {
  return new CarStore(db.raw, profileId);
}

function tools(): readonly Tool[] {
  return carTools({ profileDb: (id, open) => open(db.raw, id), now: () => NOW_MS });
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

function vehicle(): string {
  return store().createVehicle(
    {
      name: "Pasat",
      make: "Volkswagen",
      model: "Passat",
      year: 2015,
      fuelType: "diesel",
      distanceUnit: "km",
    },
    NOW_ISO,
  ).id;
}

describe("car.due", () => {
  it("counts an interval from the last service of its kind", async () => {
    const id = vehicle();
    // Twelve months from 1 October 2025 is 1 October 2026, nine days before the
    // fixed clock's own day (2026-10-10) — overdue by nine whole days.
    store().setInterval(id, "oil", { everyKm: null, everyMonths: 12 }, NOW_ISO);
    store().createService(
      id,
      { date: "2025-10-01", odometer: 180_000, category: "oil", description: "Zamena ulja" },
      NOW_ISO,
    );
    // Two years from 1 August 2025 is 1 August 2027, so it is not due.
    store().setInterval(id, "inspection", { everyKm: null, everyMonths: 24 }, NOW_ISO);
    store().createService(
      id,
      { date: "2025-08-01", category: "inspection", description: "Tehnički pregled" },
      NOW_ISO,
    );

    const result = await toolOf("car.due").run({}, contextFor("sr", true).context);
    expect(result).toEqual({
      ok: true,
      content: ["Pasat:", "- Ulje: Dospelo, 9 dana je prošlo, 1. oktobar 2026"].join("\n"),
    });
  });

  it("says a car with no interval cannot come due, and names the vehicles when asked about one it does not have", async () => {
    vehicle();
    const none = await toolOf("car.due").run({}, contextFor("en", true).context);
    expect(none).toEqual({
      ok: true,
      content: [
        "Pasat:",
        "No interval is set, so nothing can come due.",
      ].join("\n"),
    });

    const unknown = await toolOf("car.due").run(
      { vehicle: "Golf" },
      contextFor("en", true).context,
    );
    expect(unknown).toEqual({
      ok: false,
      content: 'Failed: No vehicle “Golf” in the garage. The vehicles: Pasat.',
    });
  });

  it("says there is no vehicle at all rather than an empty list", async () => {
    const result = await toolOf("car.due").run({}, contextFor("sr", true).context);
    expect(result).toEqual({ ok: true, content: "Još nema vozila u garaži." });
  });
});

describe("car.fill", () => {
  it("asks with the vehicle's own unit, then stores a partial fill", async () => {
    vehicle();
    const recorder = contextFor("sr", true);
    const result = await toolOf("car.fill").run({ quantity: 38.5 }, recorder.context);

    expect(recorder.confirms).toEqual([
      { tool: "car.fill", summary: "Zabeleži 38,5 l za vozilo „Pasat“", effect: "write" },
    ]);
    const vehicleId = store().listVehicles()[0]?.id;
    if (vehicleId === undefined) throw new Error("no vehicle was found");
    const fills = store().listFuelEntries(vehicleId);
    expect(fills).toHaveLength(1);
    const fill = fills[0];
    if (fill === undefined) throw new Error("no fill was written");
    expect(fill).toMatchObject({
      date: "2026-10-10",
      quantity: 38.5,
      fullTank: false,
      totalMinor: null,
      currency: null,
    });
    expect(result).toEqual({
      ok: true,
      content: `Zabeleženo gorivo za „Pasat“: 38,5 l, 10. oktobar 2026 (${fill.id}).`,
      navigateTo: { module: "car" },
    });
  });

  it("stores the day, the odometer, the price and a full tank the user did state", async () => {
    const id = vehicle();
    const result = await toolOf("car.fill").run(
      {
        vehicle: "Pasat",
        quantity: 45,
        date: "2026-10-09",
        odometer: 185_400,
        totalMinor: 850_000,
        currency: "rsd",
        fullTank: true,
      },
      contextFor("en", true).context,
    );
    expect(result).toEqual({
      ok: true,
      content: `Fuel logged for “Pasat”: 45 l, 9 October 2026 (${store().listFuelEntries(id)[0]?.id}).`,
      navigateTo: { module: "car" },
    });
    expect(store().listFuelEntries(id)[0]).toMatchObject({
      date: "2026-10-09",
      odometer: 185_400,
      fullTank: true,
      totalMinor: 850_000,
      currency: "RSD",
    });
  });

  it("writes nothing when the user declines, and refuses a price with no currency", async () => {
    const id = vehicle();
    const declined = await toolOf("car.fill").run(
      { quantity: 20 },
      contextFor("en", false).context,
    );
    expect(declined).toEqual({ ok: false, content: "The user declined." });
    expect(store().listFuelEntries(id)).toEqual([]);

    const noCurrency = await toolOf("car.fill").run(
      { quantity: 20, totalMinor: 5_000 },
      contextFor("en", true).context,
    );
    expect(noCurrency).toEqual({
      ok: false,
      content: 'Failed: "totalMinor" needs the "currency" it is in.',
    });
    expect(store().listFuelEntries(id)).toEqual([]);
  });
});

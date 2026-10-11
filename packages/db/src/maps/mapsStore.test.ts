import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_PIN_NOTE_LENGTH,
  MAX_PIN_TITLE_LENGTH,
  MapsPinNotFoundError,
  MapsStore,
  MapsValidationError,
  PIN_COLORS,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-01T09:00:00.000Z";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-maps-"));
  db = openDatabase({ path: join(dir, "maps.db") });
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

function store(profileId = createProfile()): MapsStore {
  return new MapsStore(db.raw, profileId);
}

/** Beograd, node 60571493: the coordinates the map's own fixtures use. */
const BEOGRAD = { lat: 44.8178131, lon: 20.4568974 };

describe("MapsStore pins", () => {
  it("stores a pin and lists it", () => {
    const maps = store();
    const pin = maps.createPin(
      { title: "  Vinarija  ", note: "  Otvoreno do 18h  ", ...BEOGRAD, color: "suma" },
      NOW,
    );

    expect(pin).toMatchObject({
      title: "Vinarija",
      note: "Otvoreno do 18h",
      lat: BEOGRAD.lat,
      lon: BEOGRAD.lon,
      color: "suma",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(maps.listPins()).toEqual([pin]);
    expect(maps.countPins()).toBe(1);
  });

  it("stores an empty note as no note at all", () => {
    const maps = store();
    const pin = maps.createPin({ title: "Park", note: "   ", ...BEOGRAD, color: "zad" }, NOW);

    expect(pin.note).toBeNull();
    const row = db.raw
      .prepare("SELECT note FROM maps_pins WHERE id = ?")
      .get(pin.id) as { note: string | null };
    expect(row.note).toBeNull();
  });

  it("accepts every colour the palette publishes, and refuses a ninth", () => {
    const maps = store();
    for (const color of PIN_COLORS) {
      expect(
        maps.createPin({ title: color, note: "", ...BEOGRAD, color }, NOW).color,
      ).toBe(color);
    }
    expect(PIN_COLORS).toHaveLength(8);
    expect(() =>
      maps.createPin({ title: "X", note: "", ...BEOGRAD, color: "tirkiz" as "zad" }, NOW),
    ).toThrow(MapsValidationError);
  });

  it("orders the list by title in the Serbian collator, not by code point", () => {
    const maps = store();
    for (const title of ["Njegoševo", "Nova Crnja", "Šabac", "Sombor"]) {
      maps.createPin({ title, note: "", ...BEOGRAD, color: "zlato" }, NOW);
    }
    // „Nova Crnja" before „Njegoševo" is the pair a code-point sort reverses:
    // the sr-Latn collator keeps „Nj" a letter of its own, after „N", where
    // comparing UTF-16 units puts `j` (0x6A) before `o` (0x6F). „Sombor" before
    // „Šabac" closes the list, since Š is a letter after S in the same alphabet.
    expect(maps.listPins().map((pin) => pin.title)).toEqual([
      "Nova Crnja",
      "Njegoševo",
      "Sombor",
      "Šabac",
    ]);
  });

  it("refuses a title that is blank or too long, and a note that is too long", () => {
    const maps = store();
    const create = (over: Partial<{ title: string; note: string }>): void => {
      maps.createPin({ title: "Park", note: "", ...BEOGRAD, color: "suma", ...over }, NOW);
    };
    expect(() => create({ title: "   " })).toThrow(/1\.\.120 characters/);
    expect(() => create({ title: "x".repeat(MAX_PIN_TITLE_LENGTH + 1) })).toThrow(MapsValidationError);
    expect(() => create({ note: "x".repeat(MAX_PIN_NOTE_LENGTH + 1) })).toThrow(/2000 characters/);
    expect(() => create({ title: "x".repeat(MAX_PIN_TITLE_LENGTH) })).not.toThrow();
  });

  it("refuses a coordinate outside the world, and a latitude that is not a number", () => {
    const maps = store();
    expect(() => maps.createPin({ title: "X", note: "", lat: 91, lon: 20, color: "suma" }, NOW)).toThrow(
      MapsValidationError,
    );
    expect(() => maps.createPin({ title: "X", note: "", lat: -91, lon: 20, color: "suma" }, NOW)).toThrow(
      /between -90 and 90/,
    );
    expect(() =>
      maps.createPin({ title: "X", note: "", lat: 44, lon: 181, color: "suma" }, NOW),
    ).toThrow(/between -180 and 180/);
    expect(() =>
      maps.createPin({ title: "X", note: "", lat: Number.NaN, lon: 20, color: "suma" }, NOW),
    ).toThrow(/between -90 and 90/);
    // The poles and the antimeridian are inside the world and must be storable.
    expect(() =>
      maps.createPin({ title: "X", note: "", lat: 90, lon: -180, color: "suma" }, NOW),
    ).not.toThrow();
  });

  it("refuses an instant that is not one", () => {
    const maps = store();
    expect(() =>
      maps.createPin({ title: "X", note: "", ...BEOGRAD, color: "suma" }, "juce"),
    ).toThrow(MapsValidationError);
  });

  it("edits what a pin says, and never where it is", () => {
    const maps = store();
    const pin = maps.createPin({ title: "Park", note: "klupa", ...BEOGRAD, color: "zad" }, NOW);

    const edited = maps.updatePin(
      pin.id,
      { title: "Park kod reke", note: "", color: "bordo" },
      LATER,
    );
    expect(edited).toMatchObject({
      id: pin.id,
      title: "Park kod reke",
      note: null,
      color: "bordo",
      lat: BEOGRAD.lat,
      lon: BEOGRAD.lon,
      createdAt: NOW,
      updatedAt: LATER,
    });
  });

  it("removes a pin, and refuses to edit or remove one this profile does not hold", () => {
    const maps = store();
    const other = store();
    const mine = maps.createPin({ title: "Park", note: "", ...BEOGRAD, color: "zad" }, NOW);
    const theirs = other.createPin({ title: "Park", note: "", ...BEOGRAD, color: "zad" }, NOW);

    // The store scopes every statement to its own profile (SEC-EL-02's data
    // half): another profile's pin is not merely hidden, it is not found.
    expect(maps.pin(theirs.id)).toBeNull();
    expect(() => maps.removePin(theirs.id)).toThrow(MapsPinNotFoundError);
    expect(() =>
      maps.updatePin(theirs.id, { title: "X", note: "", color: "zad" }, NOW),
    ).toThrow(MapsPinNotFoundError);

    maps.removePin(mine.id);
    expect(maps.listPins()).toEqual([]);
    expect(() => maps.removePin(mine.id)).toThrow(MapsPinNotFoundError);
  });

  it("replaces the whole list from an archive, in one transaction", () => {
    const maps = store();
    maps.createPin({ title: "Staro", note: "", ...BEOGRAD, color: "zad" }, NOW);

    maps.replaceFromArchive(
      [
        { title: "Vinarija", note: "18h", lat: 44.8, lon: 20.4, color: "suma" },
        { title: "Park", note: "", lat: 45.2, lon: 19.8, color: "zlato" },
      ],
      LATER,
    );

    const pins = maps.listPins();
    expect(pins.map((pin) => pin.title)).toEqual(["Park", "Vinarija"]);
    expect(pins.every((pin) => pin.createdAt === LATER && pin.updatedAt === LATER)).toBe(true);
    expect(pins.find((pin) => pin.title === "Vinarija")?.note).toBe("18h");
  });

  it("writes nothing at all when one row of the archive is refused", () => {
    const maps = store();
    const kept = maps.createPin({ title: "Kept", note: "", ...BEOGRAD, color: "zad" }, NOW);

    expect(() =>
      maps.replaceFromArchive(
        [
          { title: "Fine", note: "", lat: 44, lon: 20, color: "suma" },
          { title: "Broken", note: "", lat: 91, lon: 20, color: "suma" },
        ],
        LATER,
      ),
    ).toThrow(MapsValidationError);

    // The delete is inside the same transaction as the inserts, so a refusal
    // leaves the profile exactly as the archive's reader found it.
    expect(maps.listPins().map((pin) => pin.id)).toEqual([kept.id]);
  });

  it("empties the list when the archive carries no pins, which is what 'no section' means", () => {
    const maps = store();
    maps.createPin({ title: "Staro", note: "", ...BEOGRAD, color: "zad" }, NOW);

    maps.replaceFromArchive([], LATER);

    expect(maps.listPins()).toEqual([]);
  });
});

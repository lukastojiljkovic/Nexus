import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalogueComponent, circuitProblems } from "@nexus/core";
import { ElectronicsStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";

import { createDemoContext } from "./context.js";
import { seedDemoElectronics } from "./electronics.js";
// The store answers FLAT rows and `circuitProblems` reads the nested document.
// The conversion is main's, and this is the same one the `elec:open` handler
// runs — restating it here would make the test agree with itself rather than
// with the app.
import { toCircuitDocument } from "../elecDocument.js";

/**
 * The seeder writes component ids and pin ids as plain strings, and nothing in
 * the type system can check them: a part carries a `componentId` the store
 * deliberately never resolves, because the catalogue is not in this database.
 * A mistyped id therefore seeds successfully and shows up as a dashed
 * placeholder — in the demo profile, and in every screenshot taken of it.
 *
 * `circuitProblems` is the instrument that CAN see it, and it is the same one
 * the page's own margin runs. Asking it for an empty list is the whole test.
 */

const NOW = Date.UTC(2026, 7, 21, 9, 0, 0);

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-demo-elec-"));
  db = openDatabase({ path: join(dir, "demo.db") });
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Demo", new Date(NOW).toISOString());
  seedDemoElectronics(db.raw, createDemoContext(profileId, NOW));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("seedDemoElectronics", () => {
  it("seeds two circuits, each with parts and wires on it", () => {
    const circuits = new ElectronicsStore(db.raw, profileId).listActive();
    expect(circuits.map((circuit) => circuit.name).sort()).toEqual([
      "Merenje razdaljine",
      "Stanica za vlažnost",
    ]);
  });

  /**
   * The one that matters. Every code `circuitProblems` can report is a way the
   * seeder can be wrong without failing: `component` for an id this build does
   * not ship, `pin` for a pin the component does not have, `part` for a wire
   * reaching outside its circuit, `value` for a value on a part that takes none.
   */
  it("seeds circuits the app itself has nothing to say about", () => {
    const store = new ElectronicsStore(db.raw, profileId);
    for (const listed of store.listActive()) {
      const circuit = toCircuitDocument(store.read(listed.id));
      expect(circuitProblems(circuit, catalogueComponent)).toEqual([]);
    }
  });

  it("wires the indicator through its resistor rather than straight off the pin", () => {
    const store = new ElectronicsStore(db.raw, profileId);
    const listed = store.listActive().find((circuit) => circuit.name === "Stanica za vlažnost");
    expect(listed).toBeDefined();
    const circuit = store.read(listed?.id ?? "");
    const led = circuit.parts.find((part) => part.componentId === "led");
    const resistor = circuit.parts.find((part) => part.componentId === "resistor");
    const board = circuit.parts.find((part) => part.componentId === "arduino-uno");
    expect(led && resistor && board).toBeTruthy();

    const touching = (partId: string): readonly string[] =>
      circuit.wires
        .filter((wire) => wire.fromPartId === partId || wire.toPartId === partId)
        .map((wire) => (wire.fromPartId === partId ? wire.toPartId : wire.fromPartId));

    // The anode side reaches the resistor, never the board — which is the fault
    // the catalogue entry for a LED warns about in as many words.
    expect(touching(led?.id ?? "")).toContain(resistor?.id);
    expect(circuit.wires.filter((wire) => wire.toPartId === led?.id && wire.toPinId === "A")).toHaveLength(1);
    expect(
      circuit.wires.some(
        (wire) =>
          (wire.fromPartId === board?.id && wire.toPartId === led?.id && wire.toPinId === "A") ||
          (wire.toPartId === board?.id && wire.fromPartId === led?.id && wire.fromPinId === "A"),
      ),
    ).toBe(false);
  });

  it("gives the resistor the value a resistor is chosen by", () => {
    const store = new ElectronicsStore(db.raw, profileId);
    const listed = store.listActive().find((circuit) => circuit.name === "Stanica za vlažnost");
    const circuit = store.read(listed?.id ?? "");
    const resistor = circuit.parts.find((part) => part.componentId === "resistor");
    expect(resistor?.value).toBe(220);
    expect(resistor?.label).toBe("R1");
  });

  /** Every jumper the seeder runs must be one of the nine the model admits. */
  it("uses ground-black and supply-red, the two colours the trade reserves", () => {
    const store = new ElectronicsStore(db.raw, profileId);
    for (const listed of store.listActive()) {
      const circuit = store.read(listed.id);
      const supply = circuit.wires.find(
        (wire) => wire.fromPinId === "5V" || wire.toPinId === "5V",
      );
      const ground = circuit.wires.find(
        (wire) => wire.fromPinId.startsWith("GND") || wire.toPinId.startsWith("GND"),
      );
      expect(supply?.colour).toBe("red");
      expect(ground?.colour).toBe("black");
    }
  });
});

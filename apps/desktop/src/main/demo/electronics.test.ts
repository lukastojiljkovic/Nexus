import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalogueComponent, circuitProblems, circuitRules } from "@nexus/core";
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

  /**
   * The other half, and the harder one: E3's electrical rules, run against the
   * REAL catalogue rather than a fixture.
   *
   * Both demo circuits are described by their own file as „circuits somebody
   * would actually build", so an empty list here is the strongest available
   * check that the rules engine does not cry wolf. Every false positive it can
   * have is a false positive on ordinary correct work — a board powered over
   * USB whose VIN pin is unconnected, a sensor on a rail it is rated for, a
   * plain digital pin carrying a signal that commits to no bus role — and each
   * of those is present in these two circuits. A rules engine that cannot stay
   * silent about a correct circuit is one the user learns to dismiss, and then
   * the one finding that would have saved a part goes unread with the rest.
   */
  it("has nothing ELECTRICAL to say about either circuit either", () => {
    const store = new ElectronicsStore(db.raw, profileId);
    for (const listed of store.listActive()) {
      const circuit = toCircuitDocument(store.read(listed.id));
      expect(circuitRules(circuit, catalogueComponent)).toEqual([]);
    }
  });

  /**
   * And the mutation, because „the list was empty" is also what a rules engine
   * that resolves nothing returns.
   *
   * The test above can pass for two opposite reasons — the circuit is sound, or
   * `catalogueComponent` handed back `undefined` for every part and every rule
   * skipped it. This one moves the LED's anode off the resistor and onto the
   * board pin, which is the exact fault the seeder's own comment says it is
   * avoiding, and requires the engine to SEE it: through the real `led` entry,
   * its `needsSeriesResistor`, and a net list built from real pin ids.
   *
   * It is also the check that found the rule's first version wrong — see
   * DC-87. Asking „is a resistor on the anode's net" passed on the correct
   * circuit and passed here too, because moving the anode's wire leaves the
   * resistor's other leg on that net while it carries nothing.
   */
  it("reports the LED the moment the resistor is taken out of its path", () => {
    const store = new ElectronicsStore(db.raw, profileId);
    const listed = store.listActive().find((circuit) => circuit.name === "Stanica za vlažnost");
    const circuit = toCircuitDocument(store.read(listed?.id ?? ""));
    const led = circuit.parts.find((part) => part.componentId === "led");
    const board = circuit.parts.find((part) => part.componentId === "arduino-uno");
    expect(led && board).toBeTruthy();

    const straightToPin = {
      ...circuit,
      wires: circuit.wires.map((wire) =>
        wire.to.partId === led?.id && wire.to.pinId === "A"
          ? { ...wire, from: { partId: board?.id ?? "", pinId: "D9" } }
          : wire,
      ),
    };
    expect(circuitRules(straightToPin, catalogueComponent).map((f) => f.code)).toContain(
      "led-unprotected",
    );
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

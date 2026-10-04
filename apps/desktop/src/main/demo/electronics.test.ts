import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalogueComponent, circuitProblems, circuitRules, generateCode } from "@nexus/core";
import type { GeneratedCode, RobotDescription } from "@nexus/core";
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
  /**
   * The bench draws parts and wires in the store's order, `created_at` then
   * `id`, and the seeder writes a circuit under one timestamp — so the ID is the
   * order. Until `uuidv7` counted within a millisecond it was a shuffle: three
   * screenshot sweeps tapped „the first part" and photographed three different
   * ones, and the SVG stacking of overlapping rows moved with it. Pinned here
   * as well as in `ids.test.ts` because this is where the order is SEEN.
   */
  it("lists the rover's parts and its first wire in the order the seeder placed them", () => {
    const store = new ElectronicsStore(db.raw, profileId);
    const rover = store.listActive().find((circuit) => circuit.name === "Malina: rover");
    expect(rover).toBeDefined();
    const { parts, wires } = store.read(rover?.id ?? "");
    expect(parts.map((part) => part.componentId)).toEqual([
      "raspberry-pi-4b",
      "ttp223",
      "buzzer-passive",
      "bmp280",
      "vl53l0x",
    ]);
    // The first wire the spec runs: the board's 3V3 to the touch sensor's VCC.
    expect(wires[0]).toMatchObject({
      fromPartId: parts[0]?.id,
      fromPinId: "3V3",
      toPartId: parts[1]?.id,
      toPinId: "VCC",
    });
  });

  it("seeds three circuits, each with parts and wires on it", () => {
    const circuits = new ElectronicsStore(db.raw, profileId).listActive();
    expect(circuits.map((circuit) => circuit.name).sort()).toEqual([
      "Malina: rover",
      "Merenje razdaljine",
      "Stanica za vlažnost",
    ]);
  });

  /**
   * The bench opens the first circuit in the list, and the list is sorted by
   * name, so the English names have to sort the way the Serbian ones do: the
   * screenshot harness and the „Mašina" form both expect the rover open.
   */
  it("lists the English circuits in the Serbian order, the rover first", () => {
    const englishId = uuidv7();
    db.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(englishId, "personal", "Demo", new Date(NOW).toISOString());
    seedDemoElectronics(db.raw, createDemoContext(englishId, NOW, "en"));
    const names = (id: string): string[] =>
      new ElectronicsStore(db.raw, id).listActive().map((circuit) => circuit.name);
    expect(names(profileId)).toEqual([
      "Malina: rover",
      "Merenje razdaljine",
      "Stanica za vlažnost",
    ]);
    expect(names(englishId)).toEqual([
      "Raspberry Pi: rover",
      "Ultrasonic rangefinder",
      "Weather station",
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
   * All three demo circuits are described by their own file as „circuits somebody
   * would actually build", so an empty list here is the strongest available
   * check that the rules engine does not cry wolf. Every false positive it can
   * have is a false positive on ordinary correct work — a board powered over
   * USB whose VIN pin is unconnected, a sensor on a rail it is rated for, a
   * plain digital pin carrying a signal that commits to no bus role — and each
   * of those is present in these three circuits. A rules engine that cannot stay
   * silent about a correct circuit is one the user learns to dismiss, and then
   * the one finding that would have saved a part goes unread with the rest.
   */
  it("has nothing ELECTRICAL to say about any of them either", () => {
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

  /**
   * Ground is black and a supply rail is red, on every jumper of every circuit.
   *
   * By the pin's FUNCTION rather than by its name, and over every wire rather
   * than over the first one found. The first version asked for a pin spelled
   * `"5V"` and for one wire per circuit, which held exactly as long as every
   * board in the demo was an Arduino: a Raspberry Pi supplies its peripherals
   * from `3V3`, so the name matched nothing, `find` answered `undefined`, and a
   * convention nobody had broken was reported as broken. A name is not a fact
   * about a pin — `power-out` is.
   */
  it("uses ground-black and supply-red, the two colours the trade reserves", () => {
    const store = new ElectronicsStore(db.raw, profileId);
    const functionsOf = (componentId: string, pinId: string): readonly string[] =>
      catalogueComponent(componentId)?.pins.find((pin) => pin.id === pinId)?.functions ?? [];

    for (const listed of store.listActive()) {
      const circuit = toCircuitDocument(store.read(listed.id));
      const byId = new Map(circuit.parts.map((part) => [part.id, part.componentId]));
      const seen = { supply: 0, ground: 0 };

      for (const wire of circuit.wires) {
        const roles = [wire.from, wire.to].flatMap((end) =>
          functionsOf(byId.get(end.partId) ?? "", end.pinId),
        );
        if (roles.includes("gnd")) {
          seen.ground += 1;
          expect(wire.colour).toBe("black");
        } else if (roles.includes("power-out")) {
          seen.supply += 1;
          expect(wire.colour).toBe("red");
        }
      }
      // And that there was something to check, so a circuit whose parts stopped
      // resolving cannot pass this by having no opinion about any wire.
      expect(seen.supply).toBeGreaterThan(0);
      expect(seen.ground).toBeGreaterThan(0);
    }
  });

  /**
   * The rover, end to end (ADR-085 E4c).
   *
   * The demo profile is what the sweep photographs, so „the dialog has a model
   * to show" is a property of the SEEDER rather than of the generator, and
   * nothing else asserts it: `generateUrdf` has its own tests over fixtures, and
   * a seeder that quietly stopped writing the chassis would leave those green
   * while every screenshot of „Model mašine" said there was no machine.
   *
   * Both halves are checked, because both are on screen: the ranger IS in the
   * model, and the three peripherals that have no equivalent in physics are
   * listed as left out rather than silently missing.
   */
  it("gives the rover a machine, with the ranger on the front of it", () => {
    const store = new ElectronicsStore(db.raw, profileId);
    const listed = store.listActive().find((circuit) => circuit.name === "Malina: rover");
    expect(listed).toBeDefined();
    const circuit = toCircuitDocument(store.read(listed!.id));

    expect(circuit.chassis?.shape).toBe("diff-rover");
    // Centre-to-centre against the wheel's own width: the one cross-field rule,
    // asserted on the numbers that actually shipped rather than on a fixture.
    expect(circuit.chassis!.wheelTrack).toBeGreaterThan(circuit.chassis!.wheelWidth);

    const code = generateCode(circuit, catalogueComponent);
    expect(code.kind).toBe("package");
    const robot = (code as Extract<GeneratedCode, { kind: "package" }>).robot;
    expect(robot.kind).toBe("urdf");
    const model = robot as Extract<RobotDescription, { kind: "urdf" }>;
    expect(model.sensors.map((sensor) => sensor.mount)).toEqual(["front"]);
    expect(model.sensors[0]?.message).toBe("sensor_msgs/msg/Range");
    // Two, not three: the buzzer is an ACTUATOR, and the generator walks
    // sensors only — which is why the table it feeds is headed „Senzori koji
    // nisu u modelu" rather than „šta nije u modelu".
    expect(model.skipped.map((row) => row.reason)).toEqual(["no-equivalent", "no-equivalent"]);
  });

  /**
   * The other half of the same story, and the branch the rover above cannot
   * reach: a MEASURED circuit whose board gets a sketch.
   *
   * „Kod" prints the model's absence there rather than a model — the URDF is a
   * file of the ROS 2 package, and an Arduino gets no package — and that
   * paragraph is drawn only when the circuit has a machine. The demo profile is
   * the only place a screenshot of it can come from, so the seeder is what has
   * to keep the branch reachable.
   */
  it("measures the Arduino rover too, so the sketch has an absence to explain", () => {
    const store = new ElectronicsStore(db.raw, profileId);
    const listed = store.listActive().find((circuit) => circuit.name === "Merenje razdaljine");
    expect(listed).toBeDefined();
    const circuit = toCircuitDocument(store.read(listed!.id));

    expect(circuit.chassis).toBeDefined();
    expect(circuit.parts.find((part) => part.componentId === "hc-sr04")?.mount).toBe("front");
    // A sketch, which carries no model however well measured the machine is.
    expect(generateCode(circuit, catalogueComponent).kind).toBe("sketch");
  });
});

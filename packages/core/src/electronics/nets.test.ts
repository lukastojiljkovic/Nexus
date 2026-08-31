// One property per test, over fixtures written out by hand rather than pulled
// from the catalogue — the same rule `circuit.test.ts` states and for the same
// reason: a net assembled by asking `catalogueComponent` for its own pin ids
// would follow the catalogue wherever it moved and never disagree with it.

import { describe, expect, it } from "vitest";

import type { ComponentDef } from "./component.js";
import type { Circuit, CircuitPart, CircuitWire } from "./circuit.js";
import { buildNets } from "./nets.js";

const uno: ComponentDef = {
  id: "arduino-uno",
  kind: "board",
  name: "Arduino UNO R3",
  summary: "Osnovna ploča.",
  supply: { min: 7, max: 12 },
  current: { typical: 45, peak: 200 },
  logicVolts: 5,
  buses: [],
  pins: [
    { id: "5V", label: "5V", functions: ["power-out"], volts: 5 },
    { id: "3V3", label: "3.3V", functions: ["power-out"], volts: 3.3 },
    { id: "GND1", label: "GND", functions: ["gnd"] },
    { id: "D9", label: "9", functions: ["digital-in", "digital-out", "pwm"], volts: 5 },
  ],
};

const sensor: ComponentDef = {
  id: "dht22",
  kind: "sensor",
  name: "DHT22",
  summary: "Temperatura i vlažnost.",
  supply: { min: 3.3, max: 6 },
  current: { typical: 1.5, peak: 2.5 },
  buses: [],
  pins: [
    { id: "VCC", label: "VCC", functions: ["power-in"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
    { id: "DATA", label: "DATA", functions: ["digital-in", "digital-out"] },
  ],
};

/** Pin ids chosen so a naive `partId + pinId` key would collapse two nodes. */
const twoPins: ComponentDef = {
  id: "two-pins",
  kind: "passive",
  name: "Dva pina",
  summary: "Fikstura.",
  buses: [],
  pins: [
    { id: "c", label: "c", functions: ["passive"] },
    { id: "bc", label: "bc", functions: ["passive"] },
  ],
};

const shipped = new Map([uno, sensor, twoPins].map((component) => [component.id, component]));
const resolve = (id: string): ComponentDef | undefined => shipped.get(id);

const part = (id: string, componentId: string): CircuitPart => ({
  id,
  circuitId: "c1",
  componentId,
  label: "",
  x: 0,
  y: 0,
  rotation: 0,
});

const wire = (id: string, from: [string, string], to: [string, string]): CircuitWire => ({
  id,
  circuitId: "c1",
  from: { partId: from[0], pinId: from[1] },
  to: { partId: to[0], pinId: to[1] },
  colour: "red",
});

const circuit = (parts: CircuitPart[], wires: CircuitWire[]): Circuit => ({
  id: "c1",
  name: "Kolo",
  notes: "",
  parts,
  wires,
});

/** The pins of the net a given pin sits on, as `part.pin`, sorted. */
function netAt(built: ReturnType<typeof buildNets>, partId: string, pinId: string): string[] {
  const net = built.at(partId, pinId);
  return net === undefined ? [] : net.pins.map((ref) => `${ref.partId}.${ref.pinId}`);
}

describe("buildNets", () => {
  it("gives every pin of a placed part its own net when nothing is wired", () => {
    const built = buildNets(circuit([part("p1", "dht22")], []), resolve);
    expect(built.nets).toHaveLength(3);
    // Each one is a singleton: an unwired pin is on a net of its own rather than
    // absent, which is what lets a rule ask „is this VCC on a rail?" and get
    // „no" instead of `undefined` — the difference between a missing supply and
    // a pin nothing knows about.
    expect(built.nets.every((net) => net.pins.length === 1)).toBe(true);
  });

  it("joins the two ends of a wire into one net", () => {
    const built = buildNets(
      circuit([part("p1", "arduino-uno"), part("p2", "dht22")], [wire("w1", ["p1", "5V"], ["p2", "VCC"])]),
      resolve,
    );
    expect(netAt(built, "p1", "5V")).toEqual(["p1.5V", "p2.VCC"]);
    expect(built.at("p1", "5V")).toBe(built.at("p2", "VCC"));
  });

  it("is transitive: a chain of wires is ONE net, not two", () => {
    // The property the whole file exists for. Without it, „the sensor is on the
    // 5 V rail" is only visible when the sensor is wired to the board directly,
    // and every circuit that goes through a breadboard rail or a second part
    // silently loses its supply check.
    const built = buildNets(
      circuit(
        [part("p1", "arduino-uno"), part("p2", "dht22"), part("p3", "dht22")],
        [wire("w1", ["p1", "5V"], ["p2", "VCC"]), wire("w2", ["p2", "VCC"], ["p3", "VCC"])],
      ),
      resolve,
    );
    expect(netAt(built, "p3", "VCC")).toEqual(["p1.5V", "p2.VCC", "p3.VCC"]);
  });

  it("reports the volts a net is driven at, and reports BOTH when two rails meet", () => {
    const one = buildNets(
      circuit([part("p1", "arduino-uno"), part("p2", "dht22")], [wire("w1", ["p1", "5V"], ["p2", "VCC"])]),
      resolve,
    );
    expect(one.at("p2", "VCC")?.rails).toEqual([5]);

    // Two supplies shorted together. `buildNets` states the fact and judges
    // nothing — `rail-conflict` in `rules.ts` is what turns two rails on one net
    // into a finding, and it can only do that if this stays a list.
    const both = buildNets(
      circuit([part("p1", "arduino-uno")], [wire("w1", ["p1", "5V"], ["p1", "3V3"])]),
      resolve,
    );
    expect(both.at("p1", "5V")?.rails).toEqual([3.3, 5]);
  });

  it("marks a net as ground when any pin on it is one", () => {
    const built = buildNets(
      circuit([part("p1", "arduino-uno"), part("p2", "dht22")], [wire("w1", ["p1", "GND1"], ["p2", "GND"])]),
      resolve,
    );
    expect(built.at("p2", "GND")?.ground).toBe(true);
    expect(built.at("p1", "D9")?.ground).toBe(false);
  });

  it("contributes no nodes for a part whose component this build does not ship", () => {
    // Not an error here. `circuitProblems` already reports the unknown component
    // once; what this file must not do is invent pins for a part whose pin list
    // nobody has.
    const built = buildNets(circuit([part("p1", "nema-ovoga")], []), resolve);
    expect(built.nets).toEqual([]);
    expect(built.at("p1", "VCC")).toBeUndefined();
  });

  it("ignores a wire end that names a pin the component does not have", () => {
    const built = buildNets(
      circuit([part("p1", "arduino-uno"), part("p2", "dht22")], [wire("w1", ["p1", "D42"], ["p2", "VCC"])]),
      resolve,
    );
    // p2.VCC stays alone rather than being joined to a pin that does not exist.
    expect(netAt(built, "p2", "VCC")).toEqual(["p2.VCC"]);
  });

  it("keeps the first of two parts sharing an id, and never merges through the duplicate", () => {
    // `circuitProblems` reports the duplicate. Here the only requirement is that
    // the answer is deterministic rather than whichever row was walked last.
    const built = buildNets(
      circuit([part("p1", "arduino-uno"), part("p1", "dht22")], []),
      resolve,
    );
    expect(built.nets).toHaveLength(uno.pins.length);
    expect(built.at("p1", "5V")).toBeDefined();
    expect(built.at("p1", "DATA")).toBeUndefined();
  });

  it("cannot confuse two pins whose ids concatenate to the same string", () => {
    // Part „ab" pin „c" and part „a" pin „bc" both read as „abc" under any key
    // built by gluing the two together, and two pins silently becoming one node
    // is two pins silently becoming one wire. The key is length-prefixed, so
    // this is unrepresentable rather than merely unlikely — the answer does not
    // depend on what a uuidv7 or a catalogue slug happens to contain.
    const built = buildNets(
      circuit([part("ab", "two-pins"), part("a", "two-pins")], []),
      resolve,
    );
    expect(built.nets).toHaveLength(4);
    expect(built.at("ab", "c")).not.toBe(built.at("a", "bc"));
  });

  it("numbers nets deterministically, so two runs over one circuit agree", () => {
    const wires = [wire("w1", ["p1", "5V"], ["p2", "VCC"]), wire("w2", ["p1", "GND1"], ["p2", "GND"])];
    const parts = [part("p1", "arduino-uno"), part("p2", "dht22")];
    const first = buildNets(circuit(parts, wires), resolve);
    const second = buildNets(circuit([...parts].reverse(), [...wires].reverse()), resolve);
    const shape = (built: ReturnType<typeof buildNets>): string[][] =>
      built.nets.map((net) => net.pins.map((ref) => `${ref.partId}.${ref.pinId}`));
    expect(shape(second)).toEqual(shape(first));
    expect(first.nets.map((net) => net.id)).toEqual([0, 1, 2, 3, 4]);
  });
});

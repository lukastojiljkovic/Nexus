// One mutation per rule. The fixtures are written out rather than built from
// the catalogue, so a test can fail: a circuit assembled by asking
// `catalogueComponent` for its own pin ids would follow the catalogue wherever
// it moved and never disagree with it.

import { describe, expect, it } from "vitest";

import type { ComponentDef } from "./component.js";
import type { Circuit, CircuitPart, CircuitWire } from "./circuit.js";
import {
  circuitProblems,
  MAX_ELEC_ID_LENGTH,
  MAX_PART_COORDINATE,
  MAX_PART_LABEL_LENGTH,
  validateCircuitHeader,
  validatePart,
  validateWire,
} from "./circuit.js";

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
    { id: "GND1", label: "GND", functions: ["gnd"] },
    { id: "D9", label: "9", functions: ["digital-out", "pwm"], volts: 5 },
  ],
};

const resistor: ComponentDef = {
  id: "resistor",
  kind: "passive",
  name: "Otpornik",
  summary: "Ograničava struju.",
  valueUnit: "ohm",
  buses: [],
  pins: [
    { id: "1", label: "1", functions: ["passive"] },
    { id: "2", label: "2", functions: ["passive"] },
  ],
};

const shipped = new Map([uno, resistor].map((component) => [component.id, component]));
const resolve = (id: string): ComponentDef | undefined => shipped.get(id);

const part = (over: Partial<CircuitPart> = {}): CircuitPart => ({
  id: "p1",
  circuitId: "c1",
  componentId: "arduino-uno",
  label: "",
  x: 100,
  y: 80,
  rotation: 0,
  ...over,
});

const wire = (over: Partial<CircuitWire> = {}): CircuitWire => ({
  id: "w1",
  circuitId: "c1",
  from: { partId: "p1", pinId: "D9" },
  to: { partId: "p2", pinId: "1" },
  colour: "yellow",
  ...over,
});

/** A board, a resistor and one wire between them — the smallest real circuit. */
const circuit = (over: Partial<Circuit> = {}): Circuit => ({
  id: "c1",
  name: "Trepćuća dioda",
  notes: "",
  parts: [part(), part({ id: "p2", componentId: "resistor", value: 220 })],
  wires: [wire()],
  ...over,
});

const codes = (problems: readonly { code: string }[]): string[] => problems.map((p) => p.code);

describe("the circuit's own row", () => {
  it("accepts one", () => {
    expect(validateCircuitHeader({ id: "c1", name: "Trepćuća dioda", notes: "" })).toEqual([]);
  });

  it("demands an id and a name, and lets the notes be empty", () => {
    expect(codes(validateCircuitHeader({ id: " ", name: "X", notes: "" }))).toContain("id");
    expect(codes(validateCircuitHeader({ id: "c1", name: "  ", notes: "" }))).toContain("shape");
    expect(validateCircuitHeader({ id: "c1", name: "X", notes: "" })).toEqual([]);
  });

  it("refuses a name long enough to be a document", () => {
    const long = { id: "c1", name: "x".repeat(201), notes: "" };
    expect(codes(validateCircuitHeader(long))).toContain("length");
  });

  it("refuses anything that is not an object", () => {
    expect(codes(validateCircuitHeader("c1"))).toEqual(["shape"]);
    expect(codes(validateCircuitHeader([]))).toEqual(["shape"]);
  });
});

describe("a placed part", () => {
  it("accepts one", () => {
    expect(validatePart(part())).toEqual([]);
  });

  it("lets the label be empty, because the canvas falls back to the part's name", () => {
    expect(validatePart(part({ label: "" }))).toEqual([]);
    expect(validatePart(part({ label: "levi motor" }))).toEqual([]);
    expect(codes(validatePart(part({ label: "x".repeat(MAX_PART_LABEL_LENGTH + 1) })))).toContain(
      "length",
    );
  });

  it("demands all three ids", () => {
    expect(codes(validatePart(part({ id: "" })))).toContain("id");
    expect(codes(validatePart(part({ circuitId: "" })))).toContain("id");
    expect(codes(validatePart(part({ componentId: "" })))).toContain("id");
  });

  it("refuses an id long enough to be a document rather than an identifier", () => {
    // `idProblems` used to ask only „is this a non-blank string", so a
    // ten-megabyte `pinId` was a legal wire and a ten-megabyte `componentId` a
    // legal part — all the way into a column whose only CHECK is that the
    // string is not empty. Every id here is minted by us or is a catalogue
    // slug, so the ceiling is one nothing legitimate approaches.
    const long = "x".repeat(MAX_ELEC_ID_LENGTH + 1);
    expect(codes(validatePart(part({ componentId: long })))).toContain("length");
    expect(codes(validatePart(part({ circuitId: long })))).toContain("length");
    expect(codes(validateWire(wire({ to: { partId: "p2", pinId: long } })))).toContain("length");
    // The bound itself is inside it, and „length" rather than „id" is the
    // answer, because the field DOES identify something — just not something an
    // id here is allowed to be that long to name.
    expect(validatePart(part({ componentId: "x".repeat(MAX_ELEC_ID_LENGTH) }))).toEqual([]);
  });

  it("refuses a coordinate that is not a finite number", () => {
    expect(codes(validatePart({ ...part(), x: Number.NaN }))).toContain("shape");
    expect(codes(validatePart({ ...part(), y: Number.POSITIVE_INFINITY }))).toContain("shape");
  });

  it("refuses a coordinate outside the working area, in either direction", () => {
    expect(codes(validatePart(part({ x: MAX_PART_COORDINATE + 1 })))).toContain("range");
    expect(codes(validatePart(part({ y: -MAX_PART_COORDINATE - 1 })))).toContain("range");
    // The bound itself is inside it.
    expect(validatePart(part({ x: MAX_PART_COORDINATE, y: -MAX_PART_COORDINATE }))).toEqual([]);
  });

  it("accepts only quarter turns", () => {
    for (const rotation of [0, 90, 180, 270]) {
      expect(validatePart({ ...part(), rotation }), String(rotation)).toEqual([]);
    }
    expect(codes(validatePart({ ...part(), rotation: 37 }))).toContain("range");
    expect(codes(validatePart({ ...part(), rotation: 360 }))).toContain("range");
  });

  it("refuses a value at or below zero, which no component has", () => {
    expect(codes(validatePart(part({ value: 0 })))).toContain("range");
    expect(codes(validatePart(part({ value: -220 })))).toContain("range");
    expect(validatePart(part({ value: 0.1 }))).toEqual([]);
  });

  it("does not ask whether a value BELONGS here, because that needs the catalogue", () => {
    // A board with a resistance is nonsense, and this validator is right not to
    // say so: it is the storage gate, and a row it refuses is a row the user
    // cannot save. `circuitProblems` is where that question is asked.
    expect(validatePart(part({ value: 220 }))).toEqual([]);
  });
});

describe("a wire", () => {
  it("accepts one", () => {
    expect(validateWire(wire())).toEqual([]);
  });

  it("demands both ends in full", () => {
    expect(codes(validateWire({ ...wire(), from: "p1" }))).toContain("shape");
    expect(codes(validateWire({ ...wire(), to: { partId: "p2" } }))).toContain("id");
    expect(codes(validateWire({ ...wire(), from: { partId: "", pinId: "D9" } }))).toContain("id");
  });

  it("refuses a wire from a pin to itself", () => {
    const loop = wire({ to: { partId: "p1", pinId: "D9" } });
    expect(codes(validateWire(loop))).toContain("self");
  });

  it("allows a wire between two pins of the SAME part, which is an ordinary jumper", () => {
    expect(validateWire(wire({ to: { partId: "p1", pinId: "GND1" } }))).toEqual([]);
  });

  it("allows two DIFFERENT parts to be joined at pins that share a name", () => {
    // Pin ids are unique within a component and nowhere else, so two resistors
    // both have a „1". Wiring both of them to the ground rail is the commonest
    // thing on any breadboard, and a self-loop check that compared only the pin
    // ids would refuse it — which is what this test exists to catch. It was
    // added because a mutation dropping the `partId` half of that comparison
    // survived: the same-part case above passes either way.
    expect(validateWire(wire({ from: { partId: "p2", pinId: "1" }, to: { partId: "p3", pinId: "1" } }))).toEqual([]);
  });

  it("accepts only the trade's colours, and never a CSS colour", () => {
    // „magenta" is a perfectly valid CSS colour and not a wire anybody owns.
    // The column names one of nine jumpers, which is what lets the canvas render
    // it through a `--nx-elec-wire-*` token instead of painting a raw value.
    expect(validateWire(wire({ colour: "black" }))).toEqual([]);
    expect(codes(validateWire({ ...wire(), colour: "magenta" }))).toContain("shape");
    expect(codes(validateWire({ ...wire(), colour: "" }))).toContain("shape");
  });
});

describe("the assembled circuit, against the components this build ships", () => {
  it("accepts a circuit whose every part and pin it knows", () => {
    expect(circuitProblems(circuit(), resolve)).toEqual([]);
  });

  it("names a component this build does not ship, and does not refuse the circuit", () => {
    const unknown = circuit({
      parts: [part({ componentId: "arduino-uno-r5" }), part({ id: "p2", componentId: "resistor", value: 220 })],
    });
    const problems = circuitProblems(unknown, resolve);
    expect(problems).toEqual([{ field: "parts[p1].componentId", code: "component" }]);
  });

  it("reports an unknown component ONCE, not once per wire touching it", () => {
    // Otherwise a board nobody ships buries its own finding under twenty pins.
    const unknown = circuit({
      parts: [part({ componentId: "gone" }), part({ id: "p2", componentId: "resistor", value: 220 })],
      wires: [
        wire(),
        wire({ id: "w2", from: { partId: "p1", pinId: "5V" }, to: { partId: "p2", pinId: "2" } }),
      ],
    });
    expect(codes(circuitProblems(unknown, resolve))).toEqual(["component"]);
  });

  it("catches a wire reaching a pin the component does not have", () => {
    const bad = circuit({ wires: [wire({ to: { partId: "p2", pinId: "3" } })] });
    expect(circuitProblems(bad, resolve)).toEqual([
      { field: "wires[w1].to.pinId", code: "pin" },
    ]);
  });

  it("catches a wire reaching a part the circuit does not contain", () => {
    const bad = circuit({ wires: [wire({ from: { partId: "p9", pinId: "D9" } })] });
    expect(circuitProblems(bad, resolve)).toEqual([
      { field: "wires[w1].from.partId", code: "part" },
    ]);
  });

  it("catches both ends of one wire independently", () => {
    const bad = circuit({
      wires: [wire({ from: { partId: "p1", pinId: "D99" }, to: { partId: "p2", pinId: "9" } })],
    });
    expect(codes(circuitProblems(bad, resolve))).toEqual(["pin", "pin"]);
  });

  it("catches a value on a part that takes none, and none on a part that takes one", () => {
    const boardWithValue = circuit({ parts: [part({ value: 220 })], wires: [] });
    expect(circuitProblems(boardWithValue, resolve)).toEqual([
      { field: "parts[p1].value", code: "value" },
    ]);

    const bareResistor = circuit({
      parts: [part({ id: "p2", componentId: "resistor" })],
      wires: [],
    });
    expect(circuitProblems(bareResistor, resolve)).toEqual([
      { field: "parts[p2].value", code: "value" },
    ]);
  });

  it("names a wire that merged into a loop back to its own pin", () => {
    // No store writes this — `validateWire` refuses it. It can only arrive from
    // the other device: two people moved opposite ends of one wire and
    // field-level LWW took each end from a different writer. Migration 067 has
    // no CHECK against it on purpose, so this is the only place it surfaces.
    const looped = circuit({ wires: [wire({ to: { partId: "p1", pinId: "D9" } })] });
    expect(circuitProblems(looped, resolve)).toEqual([{ field: "wires[w1].to", code: "self" }]);
  });

  it("catches two rows claiming one id, on parts and on wires alike", () => {
    const twoParts = circuit({ parts: [part(), part()], wires: [] });
    expect(circuitProblems(twoParts, resolve)).toEqual([
      { field: "parts[p1].id", code: "duplicate" },
    ]);

    const twoWires = circuit({ wires: [wire(), wire()] });
    expect(circuitProblems(twoWires, resolve)).toEqual([
      { field: "wires[w1].id", code: "duplicate" },
    ]);
  });

  it("resolves a user-defined component through the same call as a shipped one", () => {
    // The whole reason `resolve` is a parameter: a part the user defined is not
    // second-class, and nothing here can tell the difference.
    const mine: ComponentDef = { ...resistor, id: "moj-otpornik", name: "Moj otpornik" };
    const withMine = circuit({
      parts: [part({ id: "p2", componentId: "moj-otpornik", value: 470 })],
      wires: [],
    });
    const withUser = (id: string): ComponentDef | undefined =>
      id === mine.id ? mine : shipped.get(id);
    expect(circuitProblems(withMine, withUser)).toEqual([]);
  });
});

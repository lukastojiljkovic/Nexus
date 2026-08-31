// One rule per test, over a small bench written out by hand — same reason
// `circuit.test.ts` gives: fixtures pulled from the catalogue follow it wherever
// it moves and can never disagree with it.
//
// Where a fixture deliberately trips a second rule as well (a 3.3 V part on a
// 5 V rail is both out of range AND in the wrong logic domain), the assertion
// names the code it is about rather than the whole list. Where the circuit is
// clean apart from the one fault, the whole list is asserted — that is what
// catches a rule that fires on something it was never meant to see.

import { describe, expect, it } from "vitest";

import type { ComponentDef } from "./component.js";
import type { Circuit, CircuitPart, CircuitWire } from "./circuit.js";
import { circuitRules } from "./rules.js";

const uno: ComponentDef = {
  id: "arduino-uno",
  kind: "board",
  name: "Arduino UNO R3",
  summary: "Osnovna ploča.",
  supply: { min: 7, max: 12 },
  current: { typical: 45, peak: 200 },
  logicVolts: 5,
  buses: [{ kind: "i2c", addresses: [] }, { kind: "spi" }],
  pins: [
    // Present on purpose. The real UNO has it, it is a `power-in` pin, and it is
    // unconnected in every circuit powered over USB — which is nearly all of
    // them. A supply rule that did not exempt boards would report „no supply" on
    // the commonest correct circuit there is, so the fixture carries the pin that
    // proves the exemption rather than the trimmed board that hides the need.
    { id: "VIN", label: "VIN", functions: ["power-in"] },
    { id: "5V", label: "5V", functions: ["power-out"], volts: 5 },
    { id: "3V3", label: "3.3V", functions: ["power-out"], volts: 3.3 },
    { id: "GND1", label: "GND", functions: ["gnd"] },
    { id: "GND2", label: "GND", functions: ["gnd"] },
    { id: "A0", label: "A0", functions: ["analog-in"], volts: 5 },
    { id: "A4", label: "A4", functions: ["analog-in", "i2c-sda"], volts: 5 },
    { id: "A5", label: "A5", functions: ["analog-in", "i2c-scl"], volts: 5 },
    { id: "D2", label: "2", functions: ["digital-in", "digital-out", "interrupt"], volts: 5 },
    { id: "D7", label: "7", functions: ["digital-in", "digital-out"], volts: 5 },
    { id: "D9", label: "9", functions: ["digital-in", "digital-out", "pwm"], volts: 5 },
    // Present for the same reason `VIN` is. The real UNO's D11 is the SPI
    // header's MOSI AND an ordinary digital pin, and that second name is what
    // made the bus rule report a crossed bus on a legitimate bit-banged line —
    // a board's role is a capability, a peripheral's is an intent. The fixture
    // carries the pin that proves the distinction rather than the trimmed board
    // that hides the need for it.
    { id: "D11", label: "11", functions: ["digital-in", "digital-out", "pwm", "spi-mosi"], volts: 5 },
  ],
};

/** 3–6 V, so it is legal on both of the UNO's rails. */
const dht22: ComponentDef = {
  id: "dht22",
  kind: "sensor",
  name: "DHT22",
  summary: "Temperatura.",
  supply: { min: 3.3, max: 6 },
  current: { typical: 1.5, peak: 2.5 },
  buses: [],
  pins: [
    { id: "VCC", label: "VCC", functions: ["power-in"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
    { id: "DATA", label: "DATA", functions: ["digital-in", "digital-out"] },
  ],
};

/** Strictly 3.3 V. On the UNO's 5 V rail this is the founder's headline finding. */
const bmp280: ComponentDef = {
  id: "bmp280",
  kind: "sensor",
  name: "BMP280",
  summary: "Pritisak.",
  supply: { min: 1.7, max: 3.6 },
  current: { typical: 0.6, peak: 1.1 },
  buses: [{ kind: "i2c", addresses: [0x76, 0x77] }],
  pins: [
    { id: "VCC", label: "VCC", functions: ["power-in"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
    { id: "SDA", label: "SDA", functions: ["i2c-sda"] },
    { id: "SCL", label: "SCL", functions: ["i2c-scl"] },
  ],
};

/** One fixed address, so two of them on one bus cannot be strapped apart. */
const fixedI2c: ComponentDef = {
  ...bmp280,
  id: "fixed-i2c",
  name: "Modul sa fiksnom adresom",
  buses: [{ kind: "i2c", addresses: [0x3c] }],
};

const lm35: ComponentDef = {
  id: "lm35",
  kind: "sensor",
  name: "LM35",
  summary: "Analogni termometar.",
  supply: { min: 4, max: 30 },
  current: { typical: 0.06, peak: 0.1 },
  buses: [],
  pins: [
    { id: "VCC", label: "VCC", functions: ["power-in"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
    { id: "OUT", label: "OUT", functions: ["analog-out"] },
  ],
};

const servo: ComponentDef = {
  id: "servo-sg90",
  kind: "actuator",
  name: "SG90",
  summary: "Servo.",
  supply: { min: 4, max: 6 },
  current: { typical: 100, peak: 700 },
  buses: [],
  pins: [
    { id: "VCC", label: "VCC", functions: ["power-in"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
    { id: "SIG", label: "SIG", functions: ["digital-in", "pwm"] },
  ],
};

const led: ComponentDef = {
  id: "led",
  kind: "passive",
  name: "LED dioda",
  summary: "Nikad bez otpornika.",
  needsSeriesResistor: true,
  buses: [],
  pins: [
    { id: "A", label: "+", functions: ["anode"] },
    { id: "K", label: "−", functions: ["cathode"] },
  ],
};

/** Same two pins, same helper, and correct with no resistor anywhere near it. */
const diode: ComponentDef = { ...led, id: "diode-1n4007", name: "Dioda 1N4007" };
delete (diode as { needsSeriesResistor?: true }).needsSeriesResistor;

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

/** The RGB LED's shape without the colours: two anodes sharing one cathode. */
const ledDual: ComponentDef = {
  ...led,
  id: "led-dual",
  name: "Dvobojna LED",
  pins: [
    { id: "A1", label: "+1", functions: ["anode"] },
    { id: "A2", label: "+2", functions: ["anode"] },
    { id: "K", label: "−", functions: ["cathode"] },
  ],
};

const shipped = new Map(
  [uno, dht22, bmp280, fixedI2c, lm35, servo, led, ledDual, diode, resistor].map((c) => [c.id, c]),
);
const resolve = (id: string): ComponentDef | undefined => shipped.get(id);

const part = (id: string, componentId: string, value?: number): CircuitPart => ({
  id,
  circuitId: "c1",
  componentId,
  label: "",
  x: 0,
  y: 0,
  rotation: 0,
  ...(value === undefined ? {} : { value }),
});

let wireCount = 0;
const w = (from: [string, string], to: [string, string]): CircuitWire => ({
  id: `w${(wireCount += 1)}`,
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

const codes = (c: Circuit): string[] => circuitRules(c, resolve).map((finding) => finding.code);

/** A DHT22 correctly wired to the UNO: powered, grounded, one signal line. */
const wiredDht = (rail = "5V"): Circuit =>
  circuit(
    [part("p1", "arduino-uno"), part("p2", "dht22")],
    [w(["p1", rail], ["p2", "VCC"]), w(["p1", "GND1"], ["p2", "GND"]), w(["p1", "D7"], ["p2", "DATA"])],
  );

describe("circuitRules", () => {
  it("says nothing about a circuit that is correctly wired", () => {
    // The most important test in the file. A rules engine that cannot stay
    // silent is one the user learns to ignore, and every rule below is written
    // against a fixture that differs from this one by a single wire.
    expect(circuitRules(wiredDht(), resolve)).toEqual([]);
  });

  it("says nothing at all about an empty circuit", () => {
    expect(circuitRules(circuit([], []), resolve)).toEqual([]);
  });

  it("reports a part that takes power and reaches no rail", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "dht22")],
      [w(["p1", "GND1"], ["p2", "GND"]), w(["p1", "D7"], ["p2", "DATA"])],
    );
    expect(codes(c)).toContain("supply-unreached");
  });

  it("reports a powered part whose ground reaches nothing but itself", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "dht22")],
      [w(["p1", "5V"], ["p2", "VCC"]), w(["p1", "D7"], ["p2", "DATA"])],
    );
    expect(codes(c)).toContain("ground-unreached");
  });

  it("reports a 3.3 V part on a 5 V rail — and says which volts, for the sentence", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "bmp280")],
      [
        w(["p1", "5V"], ["p2", "VCC"]),
        w(["p1", "GND1"], ["p2", "GND"]),
        w(["p1", "A4"], ["p2", "SDA"]),
        w(["p1", "A5"], ["p2", "SCL"]),
      ],
    );
    const finding = circuitRules(c, resolve).find((f) => f.code === "supply-range");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.parts).toEqual(["p2"]);
    // The panel prints these; a finding that carried only a code would force the
    // copy to say „a part is out of range" and make the user go and measure.
    expect(finding?.values).toEqual([
      { kind: "volts", amount: 5 },
      { kind: "range", min: 1.7, max: 3.6 },
    ]);
  });

  it("accepts the same part on the rail it is actually rated for", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "bmp280")],
      [
        w(["p1", "3V3"], ["p2", "VCC"]),
        w(["p1", "GND1"], ["p2", "GND"]),
        w(["p1", "A4"], ["p2", "SDA"]),
        w(["p1", "A5"], ["p2", "SCL"]),
      ],
    );
    // Still reports the logic mismatch — a 3.3 V module on a 5 V board's I²C
    // lines genuinely wants a level shifter — but nothing about the supply.
    expect(codes(c)).not.toContain("supply-range");
  });

  it("reports two rails shorted together", () => {
    const c = circuit([part("p1", "arduino-uno")], [w(["p1", "5V"], ["p1", "3V3"])]);
    expect(codes(c)).toContain("rail-conflict");
  });

  it("reports a rail wired to ground", () => {
    const c = circuit([part("p1", "arduino-uno")], [w(["p1", "5V"], ["p1", "GND1"])]);
    expect(codes(c)).toContain("rail-short");
  });

  it("reports a 5 V signal into a part running at 3.3 V", () => {
    // The BMP280 is on the 3V3 rail, so its logic domain is 3.3 V; the UNO
    // drives at 5. This is the finding that needs the net list — the sensor's
    // logic level is nowhere in its own catalogue entry and is derived from
    // which rail it turned out to be on.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "bmp280")],
      [
        w(["p1", "3V3"], ["p2", "VCC"]),
        w(["p1", "GND1"], ["p2", "GND"]),
        w(["p1", "A4"], ["p2", "SDA"]),
      ],
    );
    const finding = circuitRules(c, resolve).find((f) => f.code === "logic-level");
    expect(finding?.values).toEqual([
      { kind: "volts", amount: 5 },
      { kind: "volts", amount: 3.3 },
    ]);
  });

  it("says nothing about logic when both parts run at the same voltage", () => {
    expect(codes(wiredDht())).not.toContain("logic-level");
  });

  it("reports two outputs that can only be outputs on one net", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "lm35"), part("p3", "lm35")],
      [
        w(["p1", "5V"], ["p2", "VCC"]),
        w(["p1", "GND1"], ["p2", "GND"]),
        w(["p1", "5V"], ["p3", "VCC"]),
        w(["p1", "GND1"], ["p3", "GND"]),
        w(["p2", "OUT"], ["p3", "OUT"]),
      ],
    );
    expect(codes(c)).toContain("output-conflict");
  });

  it("reports SDA wired to SCL, and stays quiet when a plain pin bit-bangs a bus", () => {
    const crossed = circuit(
      [part("p1", "arduino-uno"), part("p2", "bmp280")],
      [
        w(["p1", "3V3"], ["p2", "VCC"]),
        w(["p1", "GND1"], ["p2", "GND"]),
        w(["p1", "A5"], ["p2", "SDA"]),
      ],
    );
    expect(codes(crossed)).toContain("bus-role");

    // D7 commits to no bus role at all. Refusing this would be the engine
    // inventing a rule the hardware does not have — an ESP32 remaps I²C onto
    // almost any GPIO, and software I²C is ordinary practice everywhere else.
    const bitBanged = circuit(
      [part("p1", "arduino-uno"), part("p2", "bmp280")],
      [
        w(["p1", "3V3"], ["p2", "VCC"]),
        w(["p1", "GND1"], ["p2", "GND"]),
        w(["p1", "D7"], ["p2", "SDA"]),
      ],
    );
    expect(codes(bitBanged)).not.toContain("bus-role");

    // And the same, on a board pin that DOES carry a role — a different bus's.
    // D11 is MOSI and is also an ordinary digital pin; software I²C over it is
    // the same ordinary practice as over D7, and the rule used to report it as
    // a crossed bus because the two ends' roles did not pair. Two pins are only
    // crossed if they are on the same bus.
    const bitBangedOverSpiPin = circuit(
      [part("p1", "arduino-uno"), part("p2", "bmp280")],
      [
        w(["p1", "3V3"], ["p2", "VCC"]),
        w(["p1", "GND1"], ["p2", "GND"]),
        w(["p1", "D11"], ["p2", "SDA"]),
      ],
    );
    expect(codes(bitBangedOverSpiPin)).not.toContain("bus-role");

    // The exemption is by BUS, not a blanket one: SDA on the board's own SCL is
    // still the same bus wired backwards, and still an error.
    const crossedOnItsOwnBus = circuit(
      [part("p1", "arduino-uno"), part("p2", "bmp280")],
      [
        w(["p1", "3V3"], ["p2", "VCC"]),
        w(["p1", "GND1"], ["p2", "GND"]),
        w(["p1", "A4"], ["p2", "SCL"]),
      ],
    );
    expect(codes(crossedOnItsOwnBus)).toContain("bus-role");
  });

  it("reports two I²C parts that cannot be strapped apart, and only warns when they can", () => {
    const wireI2c = (partId: string): CircuitWire[] => [
      w(["p1", "3V3"], [partId, "VCC"]),
      w(["p1", "GND1"], [partId, "GND"]),
      w(["p1", "A4"], [partId, "SDA"]),
      w(["p1", "A5"], [partId, "SCL"]),
    ];
    const forced = circuit(
      [part("p1", "arduino-uno"), part("p2", "fixed-i2c"), part("p3", "fixed-i2c")],
      [...wireI2c("p2"), ...wireI2c("p3")],
    );
    const hard = circuitRules(forced, resolve).find((f) => f.code === "i2c-address");
    expect(hard?.severity).toBe("error");
    expect(hard?.values).toEqual([{ kind: "address", value: 0x3c }]);

    // Two BMP280s both offer 0x76 and 0x77, so one of them can be moved. That
    // is a note, not a fault — and calling it a fault would flag the commonest
    // legitimate way anyone puts two of one sensor on a bus.
    const strappable = circuit(
      [part("p1", "arduino-uno"), part("p2", "bmp280"), part("p3", "bmp280")],
      [...wireI2c("p2"), ...wireI2c("p3")],
    );
    expect(circuitRules(strappable, resolve).find((f) => f.code === "i2c-address")?.severity).toBe(
      "warning",
    );
  });

  it("adds up what the board is asked to supply and reports going over", () => {
    // Two SG90s at 100 mA each, plus the UNO's own 45, is 245 against a peak of
    // 200. This is the MQ-sensor finding `sensors.ts` describes: over budget
    // before anything moves.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "servo-sg90"), part("p3", "servo-sg90")],
      [
        w(["p1", "5V"], ["p2", "VCC"]),
        w(["p1", "GND1"], ["p2", "GND"]),
        w(["p1", "D9"], ["p2", "SIG"]),
        w(["p1", "5V"], ["p3", "VCC"]),
        w(["p1", "GND1"], ["p3", "GND"]),
        w(["p1", "D9"], ["p3", "SIG"]),
      ],
    );
    const finding = circuitRules(c, resolve).find((f) => f.code === "current-budget");
    expect(finding?.values).toEqual([
      { kind: "milliamps", amount: 245 },
      { kind: "milliamps", amount: 200 },
    ]);
  });

  it("reports a pin that wants PWM on a board pin that has none, and not on one that does", () => {
    const wrong = circuit(
      [part("p1", "arduino-uno"), part("p2", "servo-sg90")],
      [w(["p1", "5V"], ["p2", "VCC"]), w(["p1", "GND1"], ["p2", "GND"]), w(["p1", "D7"], ["p2", "SIG"])],
    );
    const finding = circuitRules(wrong, resolve).find((f) => f.code === "pin-capability");
    // A warning, not an error: the Servo library drives any AVR pin in software.
    expect(finding?.severity).toBe("warning");

    const right = circuit(
      [part("p1", "arduino-uno"), part("p2", "servo-sg90")],
      [w(["p1", "5V"], ["p2", "VCC"]), w(["p1", "GND1"], ["p2", "GND"]), w(["p1", "D9"], ["p2", "SIG"])],
    );
    expect(codes(right)).not.toContain("pin-capability");
  });

  it("reports an analogue output read on a pin that cannot read one", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "lm35")],
      [w(["p1", "5V"], ["p2", "VCC"]), w(["p1", "GND1"], ["p2", "GND"]), w(["p1", "D7"], ["p2", "OUT"])],
    );
    expect(codes(c)).toContain("analog-signal");

    const onA0 = circuit(
      [part("p1", "arduino-uno"), part("p2", "lm35")],
      [w(["p1", "5V"], ["p2", "VCC"]), w(["p1", "GND1"], ["p2", "GND"]), w(["p1", "A0"], ["p2", "OUT"])],
    );
    expect(codes(onA0)).not.toContain("analog-signal");
  });

  it("reports an LED straight from a pin to ground", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "led")],
      [w(["p1", "D9"], ["p2", "A"]), w(["p1", "GND1"], ["p2", "K"])],
    );
    expect(codes(c)).toEqual(["led-unprotected"]);
  });

  it("accepts the same LED with a resistor in series", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "led"), part("p3", "resistor", 220)],
      [w(["p1", "D9"], ["p3", "1"]), w(["p3", "2"], ["p2", "A"]), w(["p1", "GND1"], ["p2", "K"])],
    );
    expect(circuitRules(c, resolve)).toEqual([]);
  });

  it("accepts a resistor on the CATHODE side, which limits the same current", () => {
    // The first version of this rule asked „is a part with `valueUnit: ohm` on
    // the anode's net" and would have reported this correct circuit, because
    // the resistance is on the other leg. The rule is topological instead: with
    // the resistor below it, the LED's cathode net is not ground, so there is
    // no unbroken path from the pin through the junction to ground.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "led"), part("p3", "resistor", 220)],
      [w(["p1", "D9"], ["p2", "A"]), w(["p2", "K"], ["p3", "1"]), w(["p3", "2"], ["p1", "GND1"])],
    );
    expect(circuitRules(c, resolve)).toEqual([]);
  });

  it("reports a LED wired straight across a rail, not only one off a pin", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "led")],
      [w(["p1", "5V"], ["p2", "A"]), w(["p1", "GND1"], ["p2", "K"])],
    );
    expect(codes(c)).toContain("led-unprotected");
  });

  it("does NOT report a rectifier diode, which has the same two pins and needs no resistor", () => {
    // The test the whole `needsSeriesResistor` field exists for. „Has an anode
    // and a cathode" would have failed this, and a flyback diode across a coil
    // is supposed to be a bare diode.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "diode-1n4007")],
      [w(["p1", "D9"], ["p2", "A"]), w(["p1", "GND1"], ["p2", "K"])],
    );
    expect(codes(c)).toEqual([]);
  });

  it("says a finding once when two anodes of one LED reach it", () => {
    // Both legs of a bicolour LED driven and the shared cathode on ground is one
    // fault about one component, not two. Every rule walks nets, so any of them
    // can be reached twice by a part with two pins on two nets — the engine
    // collapses identical findings rather than each rule guarding itself.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "led-dual")],
      [w(["p1", "D7"], ["p2", "A1"]), w(["p1", "D9"], ["p2", "A2"]), w(["p1", "GND1"], ["p2", "K"])],
    );
    expect(codes(c)).toEqual(["led-unprotected"]);
  });

  it("says a finding once when two wires between the same parts both trip it", () => {
    // A 3.3 V BMP280 on the UNO's 3.3 V rail is legal for its supply and still
    // wrong for its logic: the board's I²C pins are 5 V. Both bus lines cross
    // the same domain boundary between the same two parts, and the panel must
    // print that sentence once.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "bmp280")],
      [
        w(["p1", "3V3"], ["p2", "VCC"]),
        w(["p1", "GND1"], ["p2", "GND"]),
        w(["p1", "A4"], ["p2", "SDA"]),
        w(["p1", "A5"], ["p2", "SCL"]),
      ],
    );
    expect(codes(c)).toEqual(["logic-level"]);
  });

  it("says nothing about a part whose component this build does not ship", () => {
    // `circuitProblems` reports the unknown component once. Inventing an
    // electrical opinion about a part whose pins nobody has would be worse than
    // silence, and reporting it twice would bury the one finding that matters.
    const c = circuit([part("p1", "nema-ovoga")], []);
    expect(circuitRules(c, resolve)).toEqual([]);
  });

  it("orders errors before warnings, so the panel reads worst-first", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "servo-sg90")],
      [w(["p1", "D7"], ["p2", "SIG"])],
    );
    const found = circuitRules(c, resolve);
    const firstWarning = found.findIndex((f) => f.severity === "warning");
    const lastError = found.map((f) => f.severity).lastIndexOf("error");
    expect(found.length).toBeGreaterThan(1);
    expect(firstWarning).toBeGreaterThan(lastError);
  });
});

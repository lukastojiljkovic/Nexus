// Fixtures written out by hand rather than pulled from the catalogue — the
// rule `circuit.test.ts` states and `rules.test.ts` follows. A generator tested
// against the catalogue's own entries follows the catalogue wherever it moves
// and can never disagree with it.
//
// The assertions are about the SHAPE of the output — that a constant exists,
// that a `pinMode` says INPUT — rather than about the exact text of the whole
// file. A snapshot of 40 lines would fail on a comma in a comment and would
// teach nobody which rule broke.

import { describe, expect, it } from "vitest";

import type { ComponentDef } from "./component.js";
import type { Circuit, CircuitPart, CircuitWire } from "./circuit.js";
import { generateSketch } from "./sketch.js";

const uno: ComponentDef = {
  id: "arduino-uno",
  kind: "board",
  name: "Arduino UNO R3",
  summary: "Osnovna ploča.",
  supply: { min: 7, max: 12 },
  current: { typical: 45, peak: 200 },
  logicVolts: 5,
  programming: "arduino",
  buses: [{ kind: "i2c", addresses: [] }, { kind: "uart", baud: 115200 }],
  pins: [
    { id: "VIN", label: "VIN", functions: ["power-in"] },
    { id: "5V", label: "5V", functions: ["power-out"], volts: 5 },
    { id: "GND1", label: "GND", functions: ["gnd"] },
    { id: "A0", label: "A0", functions: ["analog-in"], volts: 5 },
    { id: "A4", label: "A4", functions: ["analog-in", "i2c-sda"], volts: 5 },
    { id: "A5", label: "A5", functions: ["analog-in", "i2c-scl"], volts: 5 },
    { id: "D0", label: "0", functions: ["digital-in", "digital-out", "uart-rx"], volts: 5 },
    { id: "D7", label: "7", functions: ["digital-in", "digital-out"], volts: 5 },
    { id: "D9", label: "9", functions: ["digital-in", "digital-out", "pwm"], volts: 5 },
    // The real UNO's D11 — MOSI AND an ordinary digital pin, which is the whole
    // ambiguity this file has to resolve from the WIRING rather than the pin.
    { id: "D11", label: "11", functions: ["digital-in", "digital-out", "pwm", "spi-mosi"], volts: 5 },
  ],
};

/** An SBC: same pins, different toolchain. The reason `programming` exists. */
const pi: ComponentDef = {
  id: "raspberry-pi-4b",
  kind: "board",
  name: "Raspberry Pi 4 Model B",
  summary: "Računar sa Linuxom.",
  supply: { min: 5, max: 5.1 },
  current: { typical: 600, peak: 3000 },
  logicVolts: 3.3,
  programming: "linux",
  buses: [],
  pins: [
    { id: "5V2", label: "5V", functions: ["power-out"], volts: 5 },
    { id: "GND1", label: "GND", functions: ["gnd"] },
    { id: "GPIO23", label: "GPIO23", functions: ["digital-in", "digital-out"], volts: 3.3 },
  ],
};

/**
 * Drives a line; the board listens. `sensor` rather than `passive`, on the real
 * catalogue's own terms: its TTP223 touch button is a sensor for exactly this
 * reason — a part with a driven output pin is a sensor, and a `passive` is the
 * two-leg kind with no direction at all.
 */
const button: ComponentDef = {
  id: "button",
  kind: "sensor",
  name: "Taster",
  summary: "Prekidač.",
  buses: [],
  pins: [
    { id: "OUT", label: "OUT", functions: ["digital-out"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

/** Listens; the board drives. */
const relay: ComponentDef = {
  id: "relay",
  kind: "actuator",
  name: "Relej",
  summary: "Prekidač na struju.",
  supply: { min: 4.5, max: 5.5 },
  current: { typical: 70, peak: 90 },
  buses: [],
  pins: [
    { id: "VCC", label: "VCC", functions: ["power-in"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
    { id: "IN", label: "IN", functions: ["digital-in"] },
  ],
};

/**
 * An enable pin that wants a PWM waveform — the L298N's `ENA`, the L293D's
 * `EN1`, the IRF520 module's `SIG`, the passive buzzer's `IO`. None of the four
 * declares a library, so all four reach this generator.
 *
 * `pwm` says what a wire CARRIES, never which way it goes: on a board's header
 * it marks a hole with a timer behind it, and on a peripheral it marks a pin
 * that wants a waveform. Read as a direction it makes the board an INPUT on a
 * motor-enable line it has to drive, and prints a floating pin as a reading.
 */
const motorDriver: ComponentDef = {
  id: "l298n",
  kind: "driver",
  name: "L298N",
  summary: "Drajver za dva motora.",
  buses: [],
  pins: [
    { id: "ENA", label: "ENA", functions: ["digital-in", "pwm"] },
    { id: "IN1", label: "IN1", functions: ["digital-in"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

/**
 * A pin whose ONLY function is `pwm`, which is what a user-defined component
 * may well declare. There is no direction to derive, and inventing one is how
 * the defect above happened; the wire is still named, because the connection
 * table's job is to describe the bench either way.
 */
const undirected: ComponentDef = {
  id: "modulator",
  kind: "driver",
  name: "Modulator",
  summary: "Ulaz bez smera.",
  buses: [],
  pins: [
    { id: "SIG", label: "SIG", functions: ["pwm"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

const lm35: ComponentDef = {
  id: "lm35",
  kind: "sensor",
  name: "Analogni termometar",
  summary: "Napon srazmeran temperaturi.",
  supply: { min: 4, max: 30 },
  current: { typical: 0.06, peak: 0.1 },
  buses: [],
  pins: [
    { id: "VCC", label: "VCC", functions: ["power-in"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
    { id: "OUT", label: "OUT", functions: ["analog-out"] },
  ],
};

/** Its DATA line is a timed protocol, not a direction. Hence the library. */
const dht22: ComponentDef = {
  id: "dht22",
  kind: "sensor",
  name: "DHT22",
  summary: "Temperatura i vlažnost.",
  supply: { min: 3.3, max: 6 },
  current: { typical: 1.5, peak: 2.5 },
  library: "DHT sensor library",
  buses: [],
  pins: [
    { id: "VCC", label: "VCC", functions: ["power-in"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
    { id: "DATA", label: "DATA", functions: ["digital-in", "digital-out"] },
  ],
};

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

/** Speaks over the hardware UART — the one port the serial monitor is already on. */
const bluetooth: ComponentDef = {
  id: "hc-05",
  kind: "comms",
  name: "HC-05",
  summary: "Bluetooth serijski most.",
  supply: { min: 3.6, max: 6 },
  current: { typical: 30, peak: 40 },
  buses: [{ kind: "uart", baud: 9600 }],
  pins: [
    { id: "VCC", label: "VCC", functions: ["power-in"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
    { id: "TXD", label: "TXD", functions: ["uart-tx"] },
  ],
};

/**
 * Every piece of text on this part folds away to nothing.
 *
 * It exists for one line — the fallback in `serialLabel` — and the fallback is
 * the CONSTANT rather than the board pin's own label, which is catalogue text a
 * user may have written and a single quote in it would end the C string literal
 * it lands in.
 */
const unnameable: ComponentDef = {
  id: "bezimeni",
  kind: "sensor",
  name: "«»",
  summary: "Ime koje se sklapa u ništa.",
  buses: [],
  pins: [
    { id: "OUT", label: "—", functions: ["digital-out"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

const shipped = new Map(
  [
    uno,
    pi,
    button,
    relay,
    motorDriver,
    undirected,
    lm35,
    dht22,
    bmp280,
    bluetooth,
    unnameable,
  ].map((component) => [
    component.id,
    component,
  ]),
);
const resolve = (id: string): ComponentDef | undefined => shipped.get(id);

const part = (id: string, componentId: string, label = ""): CircuitPart => ({
  id,
  circuitId: "c1",
  componentId,
  label,
  x: 0,
  y: 0,
  rotation: 0,
});

let wireCount = 0;
const w = (from: [string, string], to: [string, string]): CircuitWire => ({
  id: `w${(wireCount += 1)}`,
  circuitId: "c1",
  from: { partId: from[0], pinId: from[1] },
  to: { partId: to[0], pinId: to[1] },
  colour: "red",
});

const circuit = (parts: CircuitPart[], wires: CircuitWire[], name = "Merenje razdaljine"): Circuit => ({
  id: "c1",
  name,
  notes: "",
  parts,
  wires,
});

/** The source, or a failing expectation naming the refusal instead. */
function sourceOf(c: Circuit): string {
  const sketch = generateSketch(c, resolve);
  expect(sketch.kind).toBe("sketch");
  return sketch.kind === "sketch" ? sketch.source : "";
}

describe("generateSketch — when there is no sketch to give", () => {
  it("refuses a circuit with no board", () => {
    const c = circuit([part("p2", "button")], []);
    expect(generateSketch(c, resolve)).toEqual({ kind: "refused", reason: "no-board" });
  });

  it("refuses two boards, because a sketch is one program for one of them", () => {
    const c = circuit([part("p1", "arduino-uno"), part("p3", "arduino-uno")], []);
    expect(generateSketch(c, resolve)).toEqual({ kind: "refused", reason: "many-boards" });
  });

  it("refuses a board that runs an operating system", () => {
    // Not „a worse answer than Python" — an answer to a question nobody asked.
    // This is the whole reason `programming` is a required catalogue field.
    const c = circuit([part("p1", "raspberry-pi-4b"), part("p2", "button")], []);
    expect(generateSketch(c, resolve)).toEqual({ kind: "refused", reason: "not-programmable" });
  });

  it("says nothing about a part whose component this build does not ship", () => {
    const c = circuit([part("p1", "arduino-uno"), part("p9", "nema-ovoga")], []);
    const sketch = generateSketch(c, resolve);
    expect(sketch.kind).toBe("sketch");
  });
});

describe("generateSketch — the pins it names", () => {
  it("names a board pin after the part on the other end, and gives it the right literal", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "button")],
      [w(["p1", "D9"], ["p2", "OUT"]), w(["p1", "GND1"], ["p2", "GND"])],
    );
    const source = sourceOf(c);
    // `D9` is Arduino pin 9 — the prefix is the catalogue's spelling, not the core's.
    expect(source).toContain("constexpr uint8_t PIN_TASTER_OUT = 9;");
  });

  it("keeps an analogue pin's NAME, because its number differs per board", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "lm35")],
      [w(["p1", "5V"], ["p2", "VCC"]), w(["p1", "GND1"], ["p2", "GND"]), w(["p1", "A0"], ["p2", "OUT"])],
    );
    expect(sourceOf(c)).toContain("= A0;");
  });

  it("folds a Serbian label into a C identifier", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "button", "Prekidač svetla")],
      [w(["p1", "D9"], ["p2", "OUT"])],
    );
    expect(sourceOf(c)).toContain("PIN_PREKIDAC_SVETLA_OUT");
  });

  it("never mints one name twice, so two unlabelled parts still compile", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "button"), part("p3", "button")],
      [w(["p1", "D7"], ["p2", "OUT"]), w(["p1", "D9"], ["p3", "OUT"])],
    );
    const source = sourceOf(c);
    expect(source).toContain("constexpr uint8_t PIN_TASTER_OUT = 7;");
    expect(source).toContain("constexpr uint8_t PIN_TASTER_OUT_2 = 9;");
  });

  it("names no power or ground pin", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "relay")],
      [w(["p1", "5V"], ["p2", "VCC"]), w(["p1", "GND1"], ["p2", "GND"]), w(["p1", "D9"], ["p2", "IN"])],
    );
    const source = sourceOf(c);
    expect(source).toContain("PIN_RELEJ_IN");
    expect(source).not.toContain("PIN_RELEJ_VCC");
    expect(source).not.toContain("PIN_RELEJ_GND");
  });
});

describe("generateSketch — direction and reads", () => {
  it("makes the board an INPUT where the part drives, and reads it back", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "button")],
      [w(["p1", "D9"], ["p2", "OUT"])],
    );
    const source = sourceOf(c);
    expect(source).toContain("pinMode(PIN_TASTER_OUT, INPUT);");
    expect(source).toContain("Serial.println(digitalRead(PIN_TASTER_OUT));");
  });

  it("makes the board an OUTPUT where the part listens, and never drives it", () => {
    // The one thing a generated sketch must not do. A relay closed by a program
    // nobody wrote is a machine acting for no reason.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "relay")],
      [w(["p1", "5V"], ["p2", "VCC"]), w(["p1", "GND1"], ["p2", "GND"]), w(["p1", "D9"], ["p2", "IN"])],
    );
    const source = sourceOf(c);
    expect(source).toContain("pinMode(PIN_RELEJ_IN, OUTPUT);");
    expect(source).not.toContain("digitalWrite");
    expect(source).toContain("Nijedan pin");
  });

  it("drives an enable pin that wants a waveform, and never reads it back", () => {
    // `pwm` is a capability word, not a direction word. Read as a direction it
    // made the board an INPUT on the L298N's ENA — the line that turns a motor
    // on — and printed that floating pin to the serial monitor as a reading.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "l298n")],
      [w(["p1", "GND1"], ["p2", "GND"]), w(["p1", "D9"], ["p2", "ENA"])],
    );
    const source = sourceOf(c);
    expect(source).toContain("pinMode(PIN_L298N_ENA, OUTPUT);");
    expect(source).not.toContain("digitalRead");
  });

  it("gives no direction at all to a pin whose only function is `pwm`", () => {
    // Nothing about the wire says which way it goes, so the sketch says nothing
    // — but it still names the pin, because the connection table is what a
    // person reads at the bench and the wire is really there.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "modulator")],
      [w(["p1", "GND1"], ["p2", "GND"]), w(["p1", "D9"], ["p2", "SIG"])],
    );
    const source = sourceOf(c);
    expect(source).toContain("constexpr uint8_t PIN_MODULATOR_SIG = 9;");
    expect(source).not.toContain("pinMode");
    expect(source).not.toContain("Read(PIN_");
  });

  it("reads an analogue output with analogRead, on a pin that can take one", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "lm35")],
      [w(["p1", "5V"], ["p2", "VCC"]), w(["p1", "GND1"], ["p2", "GND"]), w(["p1", "A0"], ["p2", "OUT"])],
    );
    expect(sourceOf(c)).toContain("Serial.println(analogRead(");
  });

  it("does NOT read an analogue signal through a pin that only sees high and low", () => {
    // The rules engine reports this as `analog-signal`; the generator's job is
    // not to repeat the finding, it is to not produce a number that looks like
    // a temperature and is a 0 or a 1.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "lm35")],
      [w(["p1", "5V"], ["p2", "VCC"]), w(["p1", "GND1"], ["p2", "GND"]), w(["p1", "D7"], ["p2", "OUT"])],
    );
    expect(sourceOf(c)).not.toContain("Read(PIN_");
  });

  it("leaves a pin its part's LIBRARY owns completely alone", () => {
    // A DHT22's DATA is neither an input nor an output; it is both, in a timed
    // sequence. A `pinMode` would be wrong half the time and a `digitalRead`
    // would return noise wearing the shape of a reading.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "dht22")],
      [w(["p1", "5V"], ["p2", "VCC"]), w(["p1", "GND1"], ["p2", "GND"]), w(["p1", "D7"], ["p2", "DATA"])],
    );
    const source = sourceOf(c);
    expect(source).not.toContain("pinMode");
    expect(source).not.toContain("digitalRead");
    // But it still says which library to install, and still lists the wire.
    expect(source).toContain("DHT sensor library");
    expect(source).toContain("DHT22 · DATA");
  });
});

describe("generateSketch — buses and libraries", () => {
  it("brings up Wire when the board's OWN I²C pins carry the bus", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "bmp280")],
      [
        w(["p1", "5V"], ["p2", "VCC"]),
        w(["p1", "GND1"], ["p2", "GND"]),
        w(["p1", "A4"], ["p2", "SDA"]),
        w(["p1", "A5"], ["p2", "SCL"]),
      ],
    );
    const source = sourceOf(c);
    expect(source).toContain("#include <Wire.h>");
    expect(source).toContain("Wire.begin();");
    // A bus line gets no `#define`: it belongs to `Wire`, not to one constant.
    expect(source).not.toContain("PIN_BMP280_SDA");
  });

  it("does NOT bring up Wire for a bus bit-banged onto a plain pin", () => {
    // The rules engine deliberately allows this — software I²C is ordinary
    // practice. `Wire.begin()` would describe hardware that is not in use.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "bmp280")],
      [
        w(["p1", "5V"], ["p2", "VCC"]),
        w(["p1", "GND1"], ["p2", "GND"]),
        w(["p1", "D7"], ["p2", "SDA"]),
        w(["p1", "D9"], ["p2", "SCL"]),
      ],
    );
    expect(sourceOf(c)).not.toContain("Wire.begin();");
  });

  it("lists each library once, by the name the Library Manager knows", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "dht22"), part("p3", "dht22")],
      [w(["p1", "D7"], ["p2", "DATA"]), w(["p1", "D9"], ["p3", "DATA"])],
    );
    const sketch = generateSketch(c, resolve);
    expect(sketch.kind === "sketch" ? sketch.libraries : []).toEqual(["DHT sensor library"]);
  });

  it("writes no #include it would be guessing at", () => {
    // „DHT sensor library" ships `DHT.h`, and no rule takes you from the first
    // string to the second. The libraries are NAMED in the header instead.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "dht22")],
      [w(["p1", "D7"], ["p2", "DATA"])],
    );
    const source = sourceOf(c);
    expect(source).not.toContain("#include <DHT");
    expect(source).not.toContain("#include <DHT sensor library");
  });

  it("does not read a board pin's SPARE role as the wiring's intent", () => {
    // The defect a screenshot caught. D11 on a UNO is MOSI and is also where a
    // person wires an ultrasonic sensor's ECHO; asking the BOARD whether this
    // could be SPI made the sketch `#include <SPI.h>` for a circuit with no SPI
    // device on it — and then name neither pin, because both looked like bus
    // lines a library owned. The catalogue had already written the rule down,
    // beside the UNO's A4/A5: it is a question about the wiring, not the pin.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "button")],
      [w(["p1", "D11"], ["p2", "OUT"])],
    );
    const source = sourceOf(c);
    expect(source).not.toContain("#include <SPI.h>");
    expect(source).not.toContain("SPI.begin();");
    expect(source).toContain("constexpr uint8_t PIN_TASTER_OUT = 11;");
  });

  it("says out loud when a device is on the port the serial monitor uses", () => {
    // A one-UART board cannot print readings and talk to an HC-05 on the same
    // pins. Said rather than worked around: which port the device moves to is
    // the user's decision, and an unexplained collision is the puzzling kind.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "hc-05")],
      [w(["p1", "D0"], ["p2", "TXD"])],
    );
    const source = sourceOf(c);
    expect(source).toContain("HC-05 deli hardverski UART");
    // And it is still not a pin the sketch names or reads.
    expect(source).not.toContain("PIN_HC_05");
  });

  it("takes the serial speed from the board's own UART", () => {
    const c = circuit([part("p1", "arduino-uno"), part("p2", "button")], [w(["p1", "D9"], ["p2", "OUT"])]);
    expect(sourceOf(c)).toContain("Serial.begin(115200);");
  });
});

describe("generateSketch — the file as a whole", () => {
  it("slugs the filename from the circuit's name", () => {
    const c = circuit([part("p1", "arduino-uno")], [], "Merenje razdaljine");
    const sketch = generateSketch(c, resolve);
    expect(sketch.kind === "sketch" ? sketch.filename : "").toBe("merenje-razdaljine.ino");
  });

  it("falls back to a name rather than producing `.ino` with nothing in front", () => {
    const c = circuit([part("p1", "arduino-uno")], [], "🙂");
    const sketch = generateSketch(c, resolve);
    expect(sketch.kind === "sketch" ? sketch.filename : "").toBe("kolo.ino");
  });

  it("still gives a setup and a loop for a board with nothing wired to it", () => {
    const source = sourceOf(circuit([part("p1", "arduino-uno")], []));
    expect(source).toContain("void setup() {");
    expect(source).toContain("void loop() {");
    expect(source).toContain("delay(1000);");
  });

  it("reports every wire in the connection table, including the ones it did not name", () => {
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "bmp280"), part("p3", "button")],
      [
        w(["p1", "5V"], ["p2", "VCC"]),
        w(["p1", "A4"], ["p2", "SDA"]),
        w(["p1", "D9"], ["p3", "OUT"]),
      ],
    );
    const sketch = generateSketch(c, resolve);
    const connections = sketch.kind === "sketch" ? sketch.connections : [];
    // The 5 V line is not a signal and is not a row; the other two are, and the
    // bus one is there without a constant.
    expect(connections).toEqual([
      { boardPin: "A4", part: "BMP280", partPin: "SDA", constant: undefined },
      { boardPin: "D9", part: "Taster", partPin: "OUT", constant: "PIN_TASTER_OUT" },
    ]);
  });

  it("prints every reading under a label that is safe inside a C string", () => {
    // Both halves of the usual label fold away — the part's name and the pin's
    // — and what is left is the constant, which `slugify` built out of
    // [A-Za-z0-9_]. Falling back to the BOARD pin's label instead, as this did
    // at first, would put catalogue text inside a string literal, where one
    // quote ends it early and the rest of the line is code.
    const source = sourceOf(
      circuit(
        [part("p1", "arduino-uno"), part("p2", "bezimeni")],
        [w(["p1", "D9"], ["p2", "OUT"])],
      ),
    );
    expect(source).toContain('Serial.print("PIN_PIN_PIN: ");');
    expect(source).toContain("Serial.println(digitalRead(PIN_PIN_PIN));");
  });

  it("cannot be made to close its own header comment", () => {
    // A part label is any string up to 120 characters and a circuit name any
    // string up to 200 — `textProblems` bounds the length and nothing else. A
    // label carrying `*/` would end the header early and turn the rest of the
    // connection table into code; a label carrying a newline would push it out
    // of the comment a line at a time. Not an attack — the user's own machine
    // and their own label — but a file that does not compile, from a generator
    // whose whole value is that its output does.
    const c = circuit(
      [part("p1", "arduino-uno"), part("p2", "button", "kraj */ int x = 1; /*")],
      [w(["p1", "D9"], ["p2", "OUT"])],
      "prvi red\ndrugi red",
    );
    const source = sourceOf(c);
    // The FIRST `*/` in the file is the header's own terminator, on its own
    // line, with every line before it inside the comment.
    const header = source.slice(0, source.indexOf("*/") + 2).split("\n");
    expect(header[header.length - 1]).toBe(" */");
    expect(header.every((line) => line === "/*" || line.startsWith(" *"))).toBe(true);
    // The characters survive; only their power to end the comment does not.
    expect(source).toContain("kraj * / int x = 1; / *");
    expect(source).toContain("prvi red drugi red");
  });

  it("ends with a newline, as a source file does", () => {
    const source = sourceOf(circuit([part("p1", "arduino-uno")], []));
    expect(source.endsWith("\n")).toBe(true);
  });
});

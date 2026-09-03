// Fixtures written out by hand rather than pulled from the catalogue — the rule
// `circuit.test.ts` states and `ros.test.ts` follows. A derivation tested
// against the catalogue's own entries follows the catalogue wherever it moves
// and can never disagree with it.
//
// Every number below is re-derived in the assertion's own comment where it is
// not obvious. A waveform test that asserted whatever the implementation
// returned would pass for as long as the arithmetic stayed wrong.

import { describe, expect, it } from "vitest";

import type { ComponentDef } from "./component.js";
import type { Circuit, CircuitPart, CircuitWire } from "./circuit.js";
import { generateRosPackage } from "./ros.js";
import {
  buildSimBench,
  channelValueAt,
  simulateFrame,
  waveAt,
  DEFAULT_SIGNAL_VOLTS,
  MAX_TICK_MS,
  MIN_TICK_MS,
  type SimModel,
  type SimWave,
} from "./simulate.js";

const pi: ComponentDef = {
  id: "raspberry-pi-4b",
  kind: "board",
  name: "Raspberry Pi 4 Model B",
  summary: "Računar sa Linuxom.",
  supply: { min: 5, max: 5.1 },
  current: { typical: 600, peak: 3000 },
  logicVolts: 3.3,
  programming: "linux",
  buses: [{ kind: "i2c", addresses: [] }],
  pins: [
    { id: "5V", label: "5V", functions: ["power-out"], volts: 5 },
    { id: "GND1", label: "GND", functions: ["gnd"] },
    { id: "GPIO2", label: "GPIO2", functions: ["digital-in", "digital-out", "i2c-sda"] },
    { id: "GPIO3", label: "GPIO3", functions: ["digital-in", "digital-out", "i2c-scl"] },
    { id: "GPIO17", label: "GPIO17", functions: ["digital-in", "digital-out"], volts: 3.3 },
    { id: "GPIO18", label: "GPIO18", functions: ["digital-in", "digital-out", "pwm"], volts: 3.3 },
    { id: "GPIO23", label: "GPIO23", functions: ["digital-in", "digital-out"], volts: 3.3 },
    // The Pi has no ADC; this stands in for a board that does, so one fixture
    // can carry both „linux" and „an analogue pin ROS refuses and the bench
    // does not". The catalogue is not consulted, so nothing here is a claim
    // about real hardware — see the file header.
    { id: "A0", label: "A0", functions: ["analog-in"], volts: 3.3 },
  ],
};

const uno: ComponentDef = {
  id: "arduino-uno",
  kind: "board",
  name: "Arduino UNO R3",
  summary: "Osnovna ploča.",
  supply: { min: 7, max: 12 },
  current: { typical: 45, peak: 200 },
  logicVolts: 5,
  programming: "arduino",
  buses: [{ kind: "i2c", addresses: [] }],
  pins: [
    { id: "5V", label: "5V", functions: ["power-out"], volts: 5 },
    { id: "GND1", label: "GND", functions: ["gnd"] },
    { id: "A4", label: "A4", functions: ["analog-in", "i2c-sda"], volts: 5 },
    { id: "A5", label: "A5", functions: ["analog-in", "i2c-scl"], volts: 5 },
    { id: "A0", label: "A0", functions: ["analog-in"], volts: 5 },
    { id: "D7", label: "7", functions: ["digital-in", "digital-out"], volts: 5 },
    { id: "D9", label: "9", functions: ["digital-in", "digital-out", "pwm"], volts: 5 },
  ],
};

/** A second board, so `many-boards` has something to refuse. */
const nano: ComponentDef = { ...uno, id: "arduino-nano", name: "Arduino Nano" };

/** Drives a line; the board listens. */
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
  buses: [],
  pins: [
    { id: "IN", label: "IN", functions: ["digital-in"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

/** An enable pin that wants a waveform — a duty cycle, not a level. */
const motorDriver: ComponentDef = {
  id: "l298n",
  kind: "driver",
  name: "L298N",
  summary: "Drajver za dva motora.",
  buses: [],
  pins: [
    { id: "ENA", label: "ENA", functions: ["digital-in", "pwm"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

/** States no pin voltage, like every peripheral the catalogue ships. */
const lm35: ComponentDef = {
  id: "lm35",
  kind: "sensor",
  name: "Analogni termometar",
  summary: "Napon srazmeran temperaturi.",
  buses: [],
  pins: [
    { id: "OUT", label: "OUT", functions: ["analog-out"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

/** The same part, but committing to a level — the one shape `Pin.volts` is for. */
const lm35At3V3: ComponentDef = {
  ...lm35,
  id: "lm35-3v3",
  pins: [
    { id: "OUT", label: "OUT", functions: ["analog-out"], volts: 3.3 },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

/** Its DATA line is a timed protocol, and a library owns the timing. */
const dht22: ComponentDef = {
  id: "dht22",
  kind: "sensor",
  name: "DHT22",
  summary: "Temperatura i vlažnost.",
  library: "DHT sensor library",
  buses: [],
  pins: [
    { id: "DATA", label: "DATA", functions: ["digital-in", "digital-out"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

const bmp280: ComponentDef = {
  id: "bmp280",
  kind: "sensor",
  name: "BMP280",
  summary: "Pritisak.",
  buses: [{ kind: "i2c", addresses: [0x76] }],
  pins: [
    { id: "SDA", label: "SDA", functions: ["i2c-sda"] },
    { id: "SCL", label: "SCL", functions: ["i2c-scl"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

/**
 * A board that states no logic level.
 *
 * `validateComponent` refuses one, so this cannot come out of the catalogue —
 * but `resolve` is a function and `logicVolts` is optional on the type, so it is
 * a shape the model can be handed and therefore one it has to answer for.
 */
const unlevelled: ComponentDef = {
  id: "board-no-level",
  kind: "board",
  name: "Ploča bez nivoa",
  summary: "Ne deklariše logički nivo.",
  supply: { min: 5, max: 5.1 },
  current: { typical: 100, peak: 500 },
  programming: "arduino",
  buses: [],
  pins: [
    { id: "5V", label: "5V", functions: ["power-out"], volts: 5 },
    { id: "GND1", label: "GND", functions: ["gnd"] },
    { id: "A0", label: "A0", functions: ["analog-in"] },
  ],
};

/** Neither drives nor listens: `pwm` alone says only what the wire carries. */
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

const shipped = new Map(
  [
    pi,
    uno,
    nano,
    unlevelled,
    button,
    relay,
    motorDriver,
    lm35,
    lm35At3V3,
    dht22,
    bmp280,
    undirected,
  ].map((component) => [component.id, component]),
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

const circuit = (parts: readonly CircuitPart[], wires: readonly CircuitWire[]): Circuit => ({
  id: "c1",
  name: "Klupa",
  notes: "",
  parts,
  wires,
});

/** The model, or a failure that names the refusal that came back instead. */
function modelOf(c: Circuit): SimModel {
  const bench = buildSimBench(c, resolve);
  if (bench.kind !== "model") throw new Error(`refused: ${bench.reason}`);
  return bench;
}

/** One channel by board pin, or a failure that names the pin. */
function channelOf(c: Circuit, boardPin: string): SimModel["channels"][number] {
  const found = modelOf(c).channels.find((channel) => channel.id === boardPin);
  if (found === undefined) throw new Error(`no channel on ${boardPin}`);
  return found;
}

const constant = (value: number): SimWave => ({ kind: "constant", value });

describe("buildSimBench — refusals", () => {
  it("refuses a circuit with no board", () => {
    const c = circuit([part("p1", "button")], []);
    expect(buildSimBench(c, resolve)).toEqual({ kind: "refused", reason: "no-board" });
  });

  it("refuses a circuit with two boards", () => {
    const c = circuit([part("b1", "arduino-uno"), part("b2", "arduino-nano")], []);
    expect(buildSimBench(c, resolve)).toEqual({ kind: "refused", reason: "many-boards" });
  });

  it("builds an empty model for a board with nothing wired to it", () => {
    const model = modelOf(circuit([part("b1", "arduino-uno")], []));
    expect(model.board).toBe("Arduino UNO R3");
    expect(model.logicVolts).toBe(5);
    expect(model.channels).toEqual([]);
    expect(model.skipped).toEqual([]);
  });
});

describe("buildSimBench — channels", () => {
  it("makes a part that drives into a sensor channel on a level line", () => {
    const c = circuit(
      [part("b1", "arduino-uno"), part("p1", "button")],
      [w(["p1", "OUT"], ["b1", "D7"])],
    );
    expect(channelOf(c, "D7")).toEqual({
      id: "D7",
      part: "Taster",
      partPin: "OUT",
      flow: "sensor",
      unit: "level",
      range: { min: 0, max: 1 },
      topic: undefined,
    });
  });

  it("makes a part that listens into an actuator channel", () => {
    const c = circuit(
      [part("b1", "arduino-uno"), part("p1", "relay", "Pumpa")],
      [w(["p1", "IN"], ["b1", "D7"])],
    );
    const channel = channelOf(c, "D7");
    expect(channel.flow).toBe("actuator");
    expect(channel.unit).toBe("level");
    // The user's own label wins over the catalogue's name — `placedParts`' rule.
    expect(channel.part).toBe("Pumpa");
  });

  it("gives a driven pwm pin a duty cycle rather than a level", () => {
    const c = circuit(
      [part("b1", "arduino-uno"), part("p1", "l298n")],
      [w(["p1", "ENA"], ["b1", "D9"])],
    );
    const channel = channelOf(c, "D9");
    expect(channel.flow).toBe("actuator");
    expect(channel.unit).toBe("percent");
    expect(channel.range).toEqual({ min: 0, max: 100 });
  });

  it("keeps a level on a pwm-capable board pin the board only reads", () => {
    // D9 can do PWM; the BUTTON cannot, and `unitOf` asks the peripheral. A rule
    // that read the board pin would make every sensor on D9 a duty cycle.
    const c = circuit(
      [part("b1", "arduino-uno"), part("p1", "button")],
      [w(["p1", "OUT"], ["b1", "D9"])],
    );
    expect(channelOf(c, "D9").unit).toBe("level");
  });

  it("reads an analogue sensor in volts, up to the widest rail on the canvas", () => {
    // The LM35 states no pin voltage, like every peripheral the catalogue ships,
    // so the ceiling is DEFAULT_SIGNAL_VOLTS and NOT the board's 5 V by accident
    // — the next test is the one that tells those two apart.
    const c = circuit(
      [part("b1", "arduino-uno"), part("p1", "lm35")],
      [w(["p1", "OUT"], ["b1", "A0"])],
    );
    const channel = channelOf(c, "A0");
    expect(channel.flow).toBe("sensor");
    expect(channel.unit).toBe("volts");
    expect(channel.range).toEqual({ min: 0, max: DEFAULT_SIGNAL_VOLTS });
  });

  it("does not clamp a sensor to the board's logic level", () => {
    // A 3V3 board: were the ceiling taken from the board, this would be 3.3 and
    // `overLogic` could never fire on any circuit anybody can build.
    const c = circuit(
      [part("b1", "raspberry-pi-4b"), part("p1", "lm35")],
      [w(["p1", "OUT"], ["b1", "A0"])],
    );
    expect(channelOf(c, "A0").range).toEqual({ min: 0, max: DEFAULT_SIGNAL_VOLTS });
  });

  it("uses the peripheral's own level where it commits to one", () => {
    const c = circuit(
      [part("b1", "arduino-uno"), part("p1", "lm35-3v3")],
      [w(["p1", "OUT"], ["b1", "A0"])],
    );
    expect(channelOf(c, "A0").range).toEqual({ min: 0, max: 3.3 });
  });

  it("orders channels down the board's own header", () => {
    const c = circuit(
      [part("b1", "arduino-uno"), part("p1", "button"), part("p2", "relay")],
      [w(["p2", "IN"], ["b1", "D9"]), w(["p1", "OUT"], ["b1", "A0"])],
    );
    // A0 precedes D7/D9 in the fixture's pin list, and the wires were added the
    // other way round on purpose: the order is the board's, not the circuit's.
    expect(modelOf(c).channels.map((channel) => channel.id)).toEqual(["A0", "D9"]);
  });
});

describe("buildSimBench — what it will not put on the bench", () => {
  it("skips a bus line, and says which", () => {
    const c = circuit(
      [part("b1", "arduino-uno"), part("p1", "bmp280")],
      [w(["p1", "SDA"], ["b1", "A4"]), w(["p1", "SCL"], ["b1", "A5"])],
    );
    const model = modelOf(c);
    expect(model.channels).toEqual([]);
    expect(model.skipped.map((skip) => [skip.boardPin, skip.reason])).toEqual([
      ["A4", "bus"],
      ["A5", "bus"],
    ]);
  });

  it("skips a pin a driver library owns", () => {
    const c = circuit(
      [part("b1", "arduino-uno"), part("p1", "dht22")],
      [w(["p1", "DATA"], ["b1", "D7"])],
    );
    expect(modelOf(c).skipped).toEqual([
      { boardPin: "D7", part: "DHT22", partPin: "DATA", reason: "library" },
    ]);
  });

  it("skips a pin two peripherals share", () => {
    const c = circuit(
      [part("b1", "arduino-uno"), part("p1", "button"), part("p2", "relay")],
      [w(["p1", "OUT"], ["b1", "D7"]), w(["p2", "IN"], ["b1", "D7"])],
    );
    const model = modelOf(c);
    expect(model.channels).toEqual([]);
    expect(model.skipped.map((skip) => skip.reason)).toEqual(["shared", "shared"]);
  });

  it("skips a pin nothing gives a direction to", () => {
    const c = circuit(
      [part("b1", "arduino-uno"), part("p1", "modulator")],
      [w(["p1", "SIG"], ["b1", "D9"])],
    );
    expect(modelOf(c).skipped).toEqual([
      { boardPin: "D9", part: "Modulator", partPin: "SIG", reason: "no-direction" },
    ]);
  });

  it("carries an analogue line the ROS generator refuses", () => {
    // The one place the two derivations differ, and it is deliberate: gpiozero
    // reads high and low, so `ros.ts` skips analogue as `analog`; a bench can
    // carry a voltage honestly and does. The channel therefore exists WITHOUT a
    // topic, which is not the same as a topic being wrong.
    const c = circuit(
      [part("b1", "raspberry-pi-4b"), part("p1", "lm35")],
      [w(["p1", "OUT"], ["b1", "A0"])],
    );
    const channel = channelOf(c, "A0");
    expect(channel.unit).toBe("volts");
    expect(channel.topic).toBeUndefined();
    expect(modelOf(c).skipped).toEqual([]);
  });
});

describe("buildSimBench — topics", () => {
  it("names the topic the generated package actually publishes on", () => {
    const c = circuit(
      [part("b1", "raspberry-pi-4b"), part("p1", "button", "Prednji taster")],
      [w(["p1", "OUT"], ["b1", "GPIO23"])],
    );
    const topic = channelOf(c, "GPIO23").topic;
    expect(topic).toBe("prednji_taster_out");

    // The point of `rosPins` being exported: this is one derivation, not two.
    // A second naming pass would agree today and drift the first time the
    // uniqueness rule or the length bound moved.
    const generated = generateRosPackage(c, resolve);
    if (generated.kind !== "package") throw new Error(`refused: ${generated.reason}`);
    const node = generated.files.find((file) => file.path.endsWith("/wiring.py"));
    expect(node?.contents).toContain(`~/${topic ?? ""}`);
  });

  it("gives a microcontroller's channels no topic at all", () => {
    // Not „a topic we could not name" — an UNO has variables, and a topic
    // printed beside a sketch would be describing a program that does not exist.
    const c = circuit(
      [part("b1", "arduino-uno"), part("p1", "button")],
      [w(["p1", "OUT"], ["b1", "D7"])],
    );
    expect(channelOf(c, "D7").topic).toBeUndefined();
  });

  it("keeps two identically named parts on distinct topics", () => {
    const c = circuit(
      [part("b1", "raspberry-pi-4b"), part("p1", "button"), part("p2", "button")],
      [w(["p1", "OUT"], ["b1", "GPIO17"]), w(["p2", "OUT"], ["b1", "GPIO23"])],
    );
    const topics = modelOf(c).channels.map((channel) => channel.topic);
    expect(topics).toEqual(["taster_out", "taster_out_2"]);
  });
});

describe("waveAt", () => {
  it("holds a constant whatever the clock says", () => {
    expect(waveAt(constant(2.5), 0)).toBe(2.5);
    expect(waveAt(constant(2.5), 999_999)).toBe(2.5);
  });

  it("spends exactly the duty at the high value", () => {
    const wave: SimWave = { kind: "square", low: 0, high: 1, periodMs: 100, dutyPercent: 25 };
    // High for [0, 25), low for [25, 100), and the period starts over at 100.
    expect(waveAt(wave, 0)).toBe(1);
    expect(waveAt(wave, 24)).toBe(1);
    expect(waveAt(wave, 25)).toBe(0);
    expect(waveAt(wave, 99)).toBe(0);
    expect(waveAt(wave, 100)).toBe(1);
  });

  it("reads a duty of 0 and of 100 as the two flat cases", () => {
    const off: SimWave = { kind: "square", low: 0, high: 1, periodMs: 10, dutyPercent: 0 };
    const on: SimWave = { kind: "square", low: 0, high: 1, periodMs: 10, dutyPercent: 100 };
    expect([0, 5, 9].map((ms) => waveAt(off, ms))).toEqual([0, 0, 0]);
    expect([0, 5, 9].map((ms) => waveAt(on, ms))).toEqual([1, 1, 1]);
  });

  it("rises across the period and starts again — a sawtooth, not a triangle", () => {
    const wave: SimWave = { kind: "ramp", from: 0, to: 10, periodMs: 100 };
    expect(waveAt(wave, 0)).toBe(0);
    expect(waveAt(wave, 50)).toBe(5); // half the period is half the span
    expect(waveAt(wave, 90)).toBe(9);
    expect(waveAt(wave, 100)).toBe(0); // and back to the bottom, not down to it
  });

  it("ramps downward when `to` is below `from`", () => {
    const wave: SimWave = { kind: "ramp", from: 10, to: 0, periodMs: 100 };
    expect(waveAt(wave, 25)).toBe(7.5); // 10 + (0 - 10) * 0.25
  });

  it("holds each step for its own dwell and then wraps", () => {
    const wave: SimWave = { kind: "steps", values: [1, 2, 3], holdMs: 10 };
    expect([0, 9, 10, 19, 20, 29, 30].map((ms) => waveAt(wave, ms))).toEqual([1, 1, 2, 2, 3, 3, 1]);
  });

  it("treats a period or a dwell of zero as holding one value, never as a divide", () => {
    expect(waveAt({ kind: "square", low: 0, high: 1, periodMs: 0, dutyPercent: 50 }, 7)).toBe(1);
    expect(waveAt({ kind: "ramp", from: 2, to: 9, periodMs: 0 }, 7)).toBe(2);
    expect(waveAt({ kind: "steps", values: [4, 5], holdMs: 0 }, 7)).toBe(4);
  });

  it("answers 0 for a steps wave with nothing in it", () => {
    expect(waveAt({ kind: "steps", values: [], holdMs: 10 }, 40)).toBe(0);
  });

  it("reads a negative or unreal clock as the start of the run", () => {
    const wave: SimWave = { kind: "steps", values: [1, 2], holdMs: 10 };
    expect(waveAt(wave, -50)).toBe(1);
    expect(waveAt(wave, Number.NaN)).toBe(1);
    expect(waveAt(wave, Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("channelValueAt", () => {
  const bench = circuit(
    [part("b1", "arduino-uno"), part("p1", "relay"), part("p2", "l298n")],
    [w(["p1", "IN"], ["b1", "D7"]), w(["p2", "ENA"], ["b1", "D9"])],
  );

  it("gives a digital channel the two states it has, not the slope it was handed", () => {
    // A ramp 0 → 1 over 100 ms on D7, which is `level`: below the halfway point
    // the pin is low and above it the pin is high, because that is what a pin
    // the board reads as a bit can be. The strip and the readout both come
    // through here, so neither can draw a value the other cannot.
    const relay = channelOf(bench, "D7");
    const ramp: SimWave = { kind: "ramp", from: 0, to: 1, periodMs: 100 };
    expect(channelValueAt(relay, ramp, 0)).toBe(0);
    expect(channelValueAt(relay, ramp, 49)).toBe(0);
    expect(channelValueAt(relay, ramp, 50)).toBe(1);
    expect(channelValueAt(relay, ramp, 99)).toBe(1);
  });

  it("keeps the fraction where the channel has one, to a hundredth", () => {
    // D9 is a `pwm` output, so 0–100 %: a third of the way up a 100 ms ramp is
    // 33,333… and the bench prints 33,33 rather than the binary dust.
    const enable = channelOf(bench, "D9");
    expect(channelValueAt(enable, { kind: "ramp", from: 0, to: 100, periodMs: 100 }, 33)).toBe(33);
    expect(
      channelValueAt(enable, { kind: "ramp", from: 0, to: 100, periodMs: 300 }, 100),
    ).toBeCloseTo(33.33, 5);
  });

  it("clamps a declared value the channel cannot carry", () => {
    const enable = channelOf(bench, "D9");
    expect(channelValueAt(enable, constant(500), 0)).toBe(100);
    expect(channelValueAt(enable, constant(-20), 0)).toBe(0);
    expect(channelValueAt(enable, constant(Number.NaN), 0)).toBe(0);
  });
});

describe("simulateFrame", () => {
  const bench = circuit(
    [part("b1", "arduino-uno"), part("p1", "relay"), part("p2", "l298n")],
    [w(["p1", "IN"], ["b1", "D7"]), w(["p2", "ENA"], ["b1", "D9"])],
  );

  it("rests an unconfigured channel at the bottom of its range", () => {
    const frame = simulateFrame(modelOf(bench), new Map(), 3, 10);
    // D7 precedes D9 on the fixture's header, and the frame follows the model.
    expect(frame).toEqual({
      tick: 3,
      ms: 30,
      values: [
        { channel: "D7", value: 0, overLogic: false },
        { channel: "D9", value: 0, overLogic: false },
      ],
    });
  });

  it("rounds a digital line to one of the two states it has", () => {
    const model = modelOf(bench);
    const at = (value: number): number =>
      simulateFrame(model, new Map([["D7", constant(value)]]), 0, 10).values.find(
        (entry) => entry.channel === "D7",
      )?.value ?? -1;
    expect(at(0.4)).toBe(0);
    expect(at(0.6)).toBe(1);
    expect(at(9)).toBe(1); // clamped into the range before it is rounded
    expect(at(-9)).toBe(0);
  });

  it("keeps a duty cycle's fraction, to a hundredth", () => {
    const model = modelOf(bench);
    // A ramp 0→100 over 3 ms, read at 1 ms: 100/3 = 33.333…, printed as 33.33.
    const waves = new Map<string, SimWave>([
      ["D9", { kind: "ramp", from: 0, to: 100, periodMs: 3 }],
    ]);
    const value = simulateFrame(model, waves, 1, MIN_TICK_MS).values.find(
      (entry) => entry.channel === "D9",
    );
    expect(value?.value).toBe(33.33);
  });

  it("clamps the tick to something a clock could be", () => {
    const model = modelOf(bench);
    expect(simulateFrame(model, new Map(), 0, 0).ms).toBe(0);
    // tickMs 0 becomes MIN_TICK_MS, so tick 4 is 4 ms rather than 0.
    expect(simulateFrame(model, new Map(), 4, 0).ms).toBe(4 * MIN_TICK_MS);
    expect(simulateFrame(model, new Map(), 4, Number.NaN).ms).toBe(4 * MIN_TICK_MS);
    expect(simulateFrame(model, new Map(), 1, 99_999).ms).toBe(MAX_TICK_MS);
    expect(simulateFrame(model, new Map(), -7, 10)).toMatchObject({ tick: 0, ms: 0 });
    expect(simulateFrame(model, new Map(), 2.9, 10)).toMatchObject({ tick: 2, ms: 20 });
  });
});

describe("simulateFrame — overLogic", () => {
  const analogue = (board: string): Circuit =>
    circuit([part("b1", board), part("p1", "lm35")], [w(["p1", "OUT"], ["b1", "A0"])]);

  it("names a reading above the board's rating, at the tick it happens", () => {
    const model = modelOf(analogue("raspberry-pi-4b")); // 3V3
    const at = (volts: number): boolean =>
      simulateFrame(model, new Map([["A0", constant(volts)]]), 0, 10).values[0]?.overLogic === true;
    expect(at(3.2)).toBe(false);
    expect(at(3.3)).toBe(false); // AT the rating is not above it
    expect(at(3.4)).toBe(true);
  });

  it("stays quiet where the reading cannot exceed the rating", () => {
    // A 5 V board and a 5 V ceiling: the same wave that trips the Pi cannot
    // trip this, which is the whole point of the flag being per-tick.
    const model = modelOf(analogue("arduino-uno"));
    const waves = new Map([["A0", constant(5)]]);
    expect(simulateFrame(model, waves, 0, 10).values[0]).toEqual({
      channel: "A0",
      value: 5,
      overLogic: false,
    });
  });

  it("never sets it on a line that carries no voltage", () => {
    const c = circuit(
      [part("b1", "raspberry-pi-4b"), part("p1", "button")],
      [w(["p1", "OUT"], ["b1", "GPIO23"])],
    );
    const waves = new Map([["GPIO23", constant(1)]]);
    expect(simulateFrame(modelOf(c), waves, 0, 10).values[0]?.overLogic).toBe(false);
  });

  it("reports no threshold for a board that states no logic level", () => {
    // No threshold, so no verdict — inventing one would be a warning about a
    // number nobody published, which is the same rule the generators follow.
    const model = modelOf(analogue("board-no-level"));
    expect(model.logicVolts).toBeUndefined();
    const waves = new Map([["A0", constant(5)]]);
    expect(simulateFrame(model, waves, 0, 10).values[0]).toEqual({
      channel: "A0",
      value: 5,
      overLogic: false,
    });
  });
});


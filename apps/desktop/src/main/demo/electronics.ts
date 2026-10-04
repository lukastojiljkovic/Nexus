import type { Chassis, Mount, WireColour } from "@nexus/core";
import { ElectronicsStore } from "@nexus/db";
import type { DatabaseHandle, DemoContext } from "./context.js";

/**
 * ELEC's demo slice: three circuits that between them show what „Elektronika"
 * is for — a sensor read and an indicator on one board, a second board doing one
 * job with four wires, and a Raspberry Pi, which is the board whose „Kod" is a
 * ROS 2 package rather than a sketch.
 *
 * **All three are circuits somebody would actually build.** A DHT22 wants 5 V, a
 * ground and one data pin; a LED wants a resistor in series and never the pin
 * directly; an HC-SR04 wants TRIG on one digital pin and ECHO on another; a Pi
 * runs its peripherals at 3,3 V because it has no other logic level. The
 * demo profile exists so a person opening Nexus sees the app FULL rather than
 * empty, and a bench of parts wired at random would be worse than an empty one:
 * it would teach the wrong thing about the only module that has a right answer.
 *
 * **Every component id and pin id below is the catalogue's.** They are not
 * checked at compile time — a part carries a `componentId` string and the store
 * deliberately never resolves it (the catalogue is not in this database) — so a
 * mistyped id would seed a placeholder box and a notice in the margin rather
 * than fail. `electronics.test.ts` beside this file reads the rows back through
 * `circuitProblems` for exactly that reason — and the nine colours below are
 * typed rather than free strings, so a jumper this build does not paint is a
 * compile error rather than a throw at seed time.
 *
 * **No random anything.** Unlike most seeders this one draws from no stream at
 * all: there is nothing here to vary. A circuit is right or it is not, and the
 * positions are laid out so the two columns of a board's pins have room for the
 * labels the bench draws beside them.
 */

/** One placement, in the circuit units the bench draws in. Every coordinate is on the 10-unit grid. */
interface Placement {
  readonly componentId: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly value?: number;
  /** Which face of the machine it is bolted to (ADR-085 E4c). Only the rover's ranger has one. */
  readonly mount?: Mount;
}

/** One jumper, by the KEY of each part in the placement map rather than by id — the ids do not exist yet. */
interface Jumper {
  readonly from: readonly [part: string, pin: string];
  readonly to: readonly [part: string, pin: string];
  readonly colour: WireColour;
}

interface DemoCircuit {
  readonly name: string;
  readonly notes: string;
  readonly parts: Readonly<Record<string, Placement>>;
  readonly wires: readonly Jumper[];
  /**
   * The machine the circuit is the electronics of (ADR-085 E4c). Absent from
   * two of the three, which is the ordinary case and the state the „Kod" dialog
   * has to be photographed in as well: a breadboard is not a robot, and its
   * ROS 2 package says so rather than shipping a model of a guess.
   */
  readonly chassis?: Chassis;
}

const CIRCUITS: readonly DemoCircuit[] = [
  {
    name: "Stanica za vlažnost",
    notes:
      "DHT22 na D2, signalna dioda na D9 preko otpornika od 220 Ω. " +
      "Dioda svetli dok je vlažnost iznad praga.",
    parts: {
      board: { componentId: "arduino-uno", label: "", x: 120, y: 80 },
      sensor: { componentId: "dht22", label: "", x: 400, y: 100 },
      // The one part in either circuit that carries a value: a resistor's
      // resistance is chosen by the circuit, never by a catalogue number.
      resistor: { componentId: "resistor", label: "R1", x: 400, y: 280, value: 220 },
      led: { componentId: "led", label: "", x: 560, y: 280 },
    },
    wires: [
      // Supply and ground first, in the colours the trade reserves for them.
      { from: ["board", "5V"], to: ["sensor", "VCC"], colour: "red" },
      { from: ["board", "GND1"], to: ["sensor", "GND"], colour: "black" },
      { from: ["board", "D2"], to: ["sensor", "DATA"], colour: "yellow" },
      // The indicator: pin → resistor → LED → ground. Never the pin straight to
      // the anode, which is the fault the catalogue entry itself warns about.
      { from: ["board", "D9"], to: ["resistor", "1"], colour: "green" },
      { from: ["resistor", "2"], to: ["led", "A"], colour: "green" },
      { from: ["led", "K"], to: ["board", "GND2"], colour: "black" },
    ],
  },
  {
    // The plainest circuit here, and — since E4c — the one that carries the
    // other half of the machine story: it HAS a chassis and its board is an
    // Arduino, so „Kod" prints the model's absence rather than a model. That
    // branch exists in no other demo circuit, and the sweep photographs what is
    // on screen: without a measured Arduino there is nothing to photograph it
    // over. The HC-SR04 looks forward because that is where a rangefinder on a
    // rover looks; the mount is stored and is what the URDF would read if this
    // board ever became a Raspberry Pi.
    name: "Merenje razdaljine",
    notes:
      "HC-SR04: TRIG na D10, ECHO na D11. Senzor traži punih 5 V. " +
      "Senzor gleda napred sa malog rovera.",
    chassis: {
      shape: "diff-rover",
      bodyLength: 18,
      bodyWidth: 12,
      bodyHeight: 5,
      wheelRadius: 3,
      wheelWidth: 2.4,
      wheelTrack: 14,
      wheelBase: 10,
      bodyMass: 640,
      wheelMass: 32,
    },
    parts: {
      board: { componentId: "arduino-uno", label: "", x: 120, y: 80 },
      range: { componentId: "hc-sr04", label: "", x: 400, y: 140, mount: "front" },
    },
    wires: [
      { from: ["board", "5V"], to: ["range", "VCC"], colour: "red" },
      { from: ["board", "GND1"], to: ["range", "GND"], colour: "black" },
      { from: ["board", "D10"], to: ["range", "TRIG"], colour: "yellow" },
      { from: ["board", "D11"], to: ["range", "ECHO"], colour: "blue" },
    ],
  },
  {
    // The third board kind, and the reason this circuit exists: „Kod" over a
    // Raspberry Pi generates a ROS 2 package rather than a sketch (E4b), and
    // without a Pi in the demo profile there is no circuit the sweep can
    // photograph that dialog over. It is also the only frame the Pi's own
    // 40-pin header ever appears in.
    //
    // Its first three peripherals are each one of the three things the node
    // generator can do with a wire, on purpose: a touch pad the node PUBLISHES,
    // a buzzer it SUBSCRIBES to as a duty cycle, and a barometer on I²C it
    // leaves entirely alone. Everything runs on 3,3 V, which is not a
    // simplification — a Pi has no 5 V logic, and every part here is rated for
    // 3,3.
    //
    // The fourth is the URDF's half (E4c). A laser ranger bolted to the front
    // of a measured chassis is the one part in the demo profile with an honest
    // equivalent in physics, so this is the circuit where the „Model mašine"
    // section has both of its tables to show: the ranger in the model, and the
    // other three listed as parts a simulator has nothing to put in the world
    // for. An HC-SR04 would have been the obvious ranger and is the wrong one —
    // it needs 5 V, which this board does not have.
    name: "Malina: rover",
    notes:
      "TTP223 na GPIO27, pasivna zujalica na GPIO18, BMP280 i VL53L0X preko I²C. " +
      "Sve na 3,3 V — Malina nema 5 V logiku. Daljinomer gleda napred.",
    chassis: {
      shape: "diff-rover",
      bodyLength: 22,
      bodyWidth: 15,
      bodyHeight: 7,
      wheelRadius: 3.3,
      wheelWidth: 2.6,
      wheelTrack: 17,
      wheelBase: 13,
      bodyMass: 1100,
      wheelMass: 45,
    },
    parts: {
      board: { componentId: "raspberry-pi-4b", label: "", x: 120, y: 80 },
      touch: { componentId: "ttp223", label: "", x: 460, y: 80 },
      buzzer: { componentId: "buzzer-passive", label: "", x: 460, y: 250 },
      air: { componentId: "bmp280", label: "", x: 460, y: 420 },
      range: { componentId: "vl53l0x", label: "", x: 460, y: 580, mount: "front" },
    },
    wires: [
      { from: ["board", "3V3"], to: ["touch", "VCC"], colour: "red" },
      { from: ["board", "GND1"], to: ["touch", "GND"], colour: "black" },
      { from: ["board", "GPIO27"], to: ["touch", "SIG"], colour: "yellow" },
      { from: ["board", "3V3"], to: ["buzzer", "VCC"], colour: "red" },
      { from: ["board", "GND2"], to: ["buzzer", "GND"], colour: "black" },
      // GPIO18 rather than any free pin: it is one of the four the Pi has a
      // hardware timer behind, and a buzzer wants a waveform.
      { from: ["board", "GPIO18"], to: ["buzzer", "IO"], colour: "green" },
      { from: ["board", "3V3"], to: ["air", "VCC"], colour: "red" },
      { from: ["board", "GND3"], to: ["air", "GND"], colour: "black" },
      { from: ["board", "GPIO2"], to: ["air", "SDA"], colour: "white" },
      { from: ["board", "GPIO3"], to: ["air", "SCL"], colour: "grey" },
      // The ranger hangs off the SAME two I²C lines as the barometer, which is
      // what a bus is for — 0x29 against 0x76, so the two never answer at once.
      // Its own ground is GND4, the board's last, rather than a second wire
      // onto a pin that already has one.
      { from: ["board", "3V3"], to: ["range", "VCC"], colour: "red" },
      { from: ["board", "GND4"], to: ["range", "GND"], colour: "black" },
      { from: ["board", "GPIO2"], to: ["range", "SDA"], colour: "white" },
      { from: ["board", "GPIO3"], to: ["range", "SCL"], colour: "grey" },
    ],
  },
];

/**
 * English circuit names, notes and part labels, keyed by the Serbian text the
 * Serbian scene uses, so `ctx.locale === "sr"` writes exactly what it always
 * did. Part labels are catalogue identifiers ("R1") or empty, and both pass
 * through unchanged.
 *
 * The circuit list is sorted by name and the bench opens the first, so the
 * English names sort in the Serbian order: both scenes open on the rover,
 * which the screenshot harness and the „Mašina" form depend on.
 */
const EN: Readonly<Record<string, string>> = {
  "Stanica za vlažnost": "Weather station",
  ["DHT22 na D2, signalna dioda na D9 preko otpornika od 220 Ω. " +
  "Dioda svetli dok je vlažnost iznad praga."]:
    "DHT22 on D2, indicator LED on D9 through a 220 Ω resistor. " +
    "The LED lights while the humidity is above the threshold.",
  "Merenje razdaljine": "Ultrasonic rangefinder",
  ["HC-SR04: TRIG na D10, ECHO na D11. Senzor traži punih 5 V. " +
  "Senzor gleda napred sa malog rovera."]:
    "HC-SR04: TRIG on D10, ECHO on D11. The sensor wants a full 5 V. " +
    "The sensor looks forward from a small rover.",
  "Malina: rover": "Raspberry Pi: rover",
  ["TTP223 na GPIO27, pasivna zujalica na GPIO18, BMP280 i VL53L0X preko I²C. " +
  "Sve na 3,3 V — Malina nema 5 V logiku. Daljinomer gleda napred."]:
    "TTP223 on GPIO27, passive buzzer on GPIO18, BMP280 and VL53L0X over I²C. " +
    "Everything at 3.3 V — the Pi has no 5 V logic. The ranger looks forward.",
};

/** The seeded text for the active locale. */
function text(ctx: DemoContext, sr: string): string {
  return ctx.locale === "en" ? (EN[sr] ?? sr) : sr;
}

export function seedDemoElectronics(db: DatabaseHandle, ctx: DemoContext): void {
  const nowIso = new Date(ctx.now).toISOString();
  const circuits = new ElectronicsStore(db, ctx.profileId);

  for (const spec of CIRCUITS) {
    const circuit = circuits.createCircuit(
      { name: text(ctx, spec.name), notes: text(ctx, spec.notes) },
      nowIso,
    );
    // The ids are minted by the store, so the wires below can only be run once
    // the parts exist — which is also the order the foreign keys require, and
    // the order the archive carries them in.
    const placed = new Map<string, string>();
    for (const [key, part] of Object.entries(spec.parts)) {
      const row = circuits.addPart(
        circuit.id,
        {
          componentId: part.componentId,
          label: text(ctx, part.label),
          x: part.x,
          y: part.y,
          rotation: 0,
          ...(part.value === undefined ? {} : { value: part.value }),
          ...(part.mount === undefined ? {} : { mount: part.mount }),
        },
        nowIso,
      );
      placed.set(key, row.id);
    }
    // After the parts and before the wires only because it reads in the order
    // the screen does; the chassis has no foreign key to either.
    if (spec.chassis !== undefined) circuits.setChassis(circuit.id, spec.chassis, nowIso);
    for (const wire of spec.wires) {
      const fromId = placed.get(wire.from[0]);
      const toId = placed.get(wire.to[0]);
      if (fromId === undefined || toId === undefined) {
        throw new Error(`Demo circuit "${spec.name}" names a part it does not place.`);
      }
      circuits.addWire(
        circuit.id,
        {
          from: { partId: fromId, pinId: wire.from[1] },
          to: { partId: toId, pinId: wire.to[1] },
          colour: wire.colour,
        },
        nowIso,
      );
    }
  }
}

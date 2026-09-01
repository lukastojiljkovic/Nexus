/**
 * What a component IS, electrically — the fact the whole module is built on.
 *
 * Everything downstream reads this and nothing re-derives it: the canvas draws
 * pins from here, the rules engine compares voltages and buses from here, the
 * sketch generator writes `#include` and pin constants from here, and the ROS
 * package names its topics after what the part actually produces. A second
 * opinion about what a DHT22 is would eventually disagree with the first, and
 * the user would get a warning on screen contradicted by the code beside it.
 *
 * **A catalogue entry is a constant, not a row** (ADR-085 §3). It is a fact
 * about a part number — the BMP280's two possible addresses, which of the UNO's
 * pins can do PWM — and it is versioned with the application because that is
 * what it is. Written into SQLite instead, every corrected datasheet becomes a
 * migration, every profile carries a drifting copy, and two synced devices can
 * disagree about what a resistor is. What the database holds is the user's own
 * work: the circuit, its parts, its wires, and any component they defined
 * themselves.
 *
 * **The validator is the gate, and `components.test.ts` is where it runs.** The
 * shipped JSON is asserted rather than parsed at startup, for the reason
 * `fitness/catalogue.ts` gives: parsing at runtime either throws inside a bundled
 * app — bricking it over a data typo — or silently drops entries, which is a
 * catalogue quietly missing parts. A red test before the build is the right place
 * for that news.
 */

/** What a part is, for grouping in the picker and for the rules that follow. */
export const COMPONENT_KINDS = [
  /** An MCU or SBC: the thing everything else hangs off. */
  "board",
  "sensor",
  "actuator",
  /** Motor drivers, MOSFET modules, level shifters — a part that stands between. */
  "driver",
  "display",
  /** Radio, Bluetooth, LoRa, RFID. */
  "comms",
  /** Regulators, buck converters, battery holders. */
  "power",
  /** Resistor, LED, button, potentiometer — no supply of its own to speak of. */
  "passive",
] as const;

export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/**
 * Everything one pin can do.
 *
 * A board pin carries several — the UNO's A4 is an analogue input AND the I²C
 * data line, and which one it is depends on what the user wires to it. That is
 * exactly the ambiguity the rules engine exists to resolve, so the pin states
 * both rather than picking one here.
 */
export const PIN_FUNCTIONS = [
  "gnd",
  /** Takes power in: VCC, VDD, VIN. */
  "power-in",
  /** Supplies power out: a board's 5V and 3V3 rails, a regulator's output. */
  "power-out",
  "digital-in",
  "digital-out",
  "analog-in",
  "analog-out",
  /**
   * AREF: sets the ADC's reference voltage. NOT an analogue channel — nothing
   * is read from it, and a sensor output wired here silently rescales every
   * other analogue reading on the board. It had `analog-in` until the catalogue
   * gate's UNO spot-check counted seven analogue inputs where the board has six.
   */
  "vref",
  "pwm",
  "i2c-sda",
  "i2c-scl",
  "spi-mosi",
  "spi-miso",
  "spi-sck",
  "spi-cs",
  "uart-tx",
  "uart-rx",
  "interrupt",
  "onewire",
  "reset",
  /** One leg of an unpolarised part: a resistor, a button, a ceramic capacitor. */
  "passive",
  /** The legs of a polarised one, where fitting it backwards is the classic fault. */
  "anode",
  "cathode",
  /** Physically present, electrically nothing. Kept so a header's geometry is honest. */
  "nc",
] as const;

export type PinFunction = (typeof PIN_FUNCTIONS)[number];

/** One connection point on a part. */
export interface Pin {
  /** Stable within the component: "D9", "A4", "VCC", "SDA". Never renumbered. */
  readonly id: string;
  /** What is printed beside it on the silkscreen, which is what the user reads. */
  readonly label: string;
  /** At least one. A pin that can do nothing is a data error, not a spare. */
  readonly functions: readonly PinFunction[];
  /**
   * Volts. On a `power-out` pin this is what it SUPPLIES and is required; on a
   * signal pin it is the logic level it presents, and is optional because plenty
   * of breakout boards do not commit to one.
   */
  readonly volts?: number;
}

/**
 * A PROTOCOL the part speaks. Not „a kind of pin".
 *
 * Declared separately from the pins on purpose: the pins say which wires exist,
 * the bus says what protocol they are carrying, and a part can have the wires
 * without the protocol (a bare resistor with two legs) or the protocol without
 * an obvious wire (an I²C device whose address is the only thing that matters
 * for a collision check). The validator makes the two agree — see `bus-pin` and
 * `pin-bus` below, which are the rules that catch an entry nothing downstream
 * could have reasoned about.
 *
 * **There is deliberately no `digital`, `analog` or `pwm` member.** There was,
 * and the catalogue gate is what removed them: eight correct I²C sensors were
 * refused for carrying an INT or EN pin without also declaring a „digital bus".
 * Eight entries of one shape, all right about the hardware, is a finding about
 * the model rather than the data — and the model was already inconsistent,
 * because `BUS_REQUIREMENTS` below listed no pins for those three, i.e. half of
 * this file had decided they were not protocols while the other half policed
 * them as if they were. Followed through, every board and nearly every
 * peripheral would have carried the same three constant lines; a declaration
 * that is true of almost everything is not a check, it is transcription, and
 * transcription is where errors come from. What those members claimed is
 * derivable from the pins and always current there: „gives an analogue reading"
 * is `pins.some(p => p.functions.includes("analog-out"))`. So a part that speaks
 * no protocol — an LM35, an HC-SR04, a keypad — states `buses: []`, and that is
 * the true answer rather than an empty one.
 */
export type Bus =
  | {
      readonly kind: "i2c";
      /**
       * Every address the part can be strapped to. A peripheral must list at
       * least one, because that list is what an address-collision check reads;
       * a board legitimately lists none, since it is the master.
       */
      readonly addresses: readonly number[];
    }
  | { readonly kind: "spi" }
  | { readonly kind: "uart"; readonly baud?: number }
  | { readonly kind: "onewire" };

export const BUS_KINDS = ["i2c", "spi", "uart", "onewire"] as const;

export type BusKind = (typeof BUS_KINDS)[number];

/** One entry in the shipped catalogue, or one component the user defined. */
export interface ComponentDef {
  /** Kebab-case, unique across the catalogue. */
  readonly id: string;
  readonly kind: ComponentKind;
  /** As printed on the part, or as it is sold: „BMP280", „HC-SR04". */
  readonly name: string;
  /** One Serbian line for the picker. */
  readonly summary: string;
  /**
   * Operating supply in volts, as the datasheet gives it.
   *
   * Present exactly when the part has something to be supplied — a board, or a
   * peripheral with a `power-in` pin. A resistor has no supply and a 4×4 keypad
   * has none either; giving them one would be a number the current budget adds
   * up and nothing draws. See `power` in `ComponentProblemCode`.
   */
  readonly supply?: { readonly min: number; readonly max: number };
  /** Milliamps: what it draws in ordinary use, and its worst case. Same rule. */
  readonly current?: { readonly typical: number; readonly peak: number };
  /**
   * What a value on this part MEASURES, for the parts that have one.
   *
   * The catalogue ships one „resistor", not one per resistance — the chosen
   * 220 Ω belongs to the circuit's part row, because it is the user's decision
   * and not a fact about the part number. This field is what tells the canvas
   * to ask for it and in which unit.
   */
  readonly valueUnit?: ValueUnit;
  readonly buses: readonly Bus[];
  readonly pins: readonly Pin[];
  /** The Arduino library the generated sketch will include, when one is needed. */
  readonly library?: string;
  /** A board's own logic level. Boards only — nothing else has one to state. */
  readonly logicVolts?: number;
  /**
   * How code gets onto this board. **Required on a board, forbidden on anything
   * else** — see the `board` rule in {@link validateComponent}.
   *
   * `"arduino"` is a microcontroller you compile a sketch for and upload;
   * `"linux"` is a single-board computer you copy a program onto and run. The
   * distinction is not a preference between toolchains, it is what makes a
   * generated artefact right or absurd: a `.ino` for a Raspberry Pi 4 is not a
   * worse answer than a Python file, it is an answer to a question nobody asked.
   * ADR-085's E4 refuses rather than emits one, and it can only refuse if the
   * catalogue says which kind of board this is.
   *
   * Required rather than optional because the alternative is a board added six
   * months from now that silently defaults to one of the two. This is the field
   * that decides whether the code generator will speak to it at all, and a
   * default would be a guess wearing a value's clothes.
   */
  readonly programming?: "arduino" | "linux";
  /**
   * A part that destroys itself without a resistor in series with it.
   *
   * A fact about the physics, not a preference: a light-emitting junction has an
   * exponential I–V curve and no internal limiting, so across a fixed voltage it
   * takes whatever current the supply can deliver until something gives. The
   * `led` entry has said exactly this in its Serbian summary since the catalogue
   * shipped — „Nikad bez otpornika u nizu" — and prose is not something a rule
   * can read.
   *
   * It exists because the obvious test is WRONG. „Has an `anode` and a
   * `cathode`" would be true of `diode-1n4007` and `diode-1n4148`, which are
   * built from the same `polarised()` helper as the LED and are correct with no
   * resistor anywhere near them — a flyback diode across a motor coil is
   * supposed to be a bare diode. A rules engine that hardcoded the two LED ids
   * instead would be a rules engine with catalogue data inside it, which is the
   * one thing ADR-085 §3 says this module does not do.
   *
   * Set on the parts whose emitting junction faces the user's wiring: `led`,
   * `led-rgb`, and the input side of `optocoupler-pc817`. Deliberately NOT on
   * the Zener, whose textbook use is itself a current-limited shunt and whose
   * „needs a resistor" depends on the topology rather than on the part.
   */
  readonly needsSeriesResistor?: true;
}

export type ComponentProblemCode =
  /** Not the right sort of thing at all: a missing field, a wrong type. */
  | "shape"
  | "id"
  | "kind"
  /** A number outside what this catalogue can honestly describe. */
  | "range"
  /** Two numbers in the wrong order: max below min, peak below typical. */
  | "order"
  | "pins"
  | "duplicate"
  /** A bus is declared and the pin that carries it is missing. */
  | "bus-pin"
  /** A pin carries a bus the component never declared. */
  | "pin-bus"
  | "address"
  /** A rule about what only a board may be, or must be. */
  | "board"
  /** Takes power and offers no return path. */
  | "ground";

export interface ComponentProblem {
  /** Dotted path into the entry, so a failure names the field and not the file. */
  readonly field: string;
  readonly code: ComponentProblemCode;
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The ceiling on `supply.max`, in volts.
 *
 * Sixty is not an electrical limit, it is a statement of what this catalogue
 * covers: low-voltage DC that a person can safely have on a desk. A mains part
 * that slipped in would carry a safety claim the module has no standing to make,
 * and the wiring canvas would draw it as though it were a jumper wire.
 */
const MAX_SUPPLY_VOLTS = 60;

/** The usable 7-bit I²C range: below 0x08 and above 0x77 are reserved. */
const I2C_MIN_ADDRESS = 0x08;
const I2C_MAX_ADDRESS = 0x77;

/**
 * Which protocol each pin function implies, for the `pin-bus` rule.
 *
 * Only the four protocols appear. `pwm`, `analog-*` and `digital-*` are what a
 * single pin does on its own — nothing else has to agree with them, so there is
 * nothing for this map to check. See `Bus` for why they stopped being buses.
 */
const FUNCTION_BUS: Partial<Record<PinFunction, BusKind>> = {
  "i2c-sda": "i2c",
  "i2c-scl": "i2c",
  "spi-mosi": "spi",
  "spi-miso": "spi",
  "spi-sck": "spi",
  "spi-cs": "spi",
  "uart-tx": "uart",
  "uart-rx": "uart",
  onewire: "onewire",
};

/**
 * What each bus needs on the pins to be reachable at all.
 *
 * Read as: every group must be satisfied, and a group is satisfied by ANY of its
 * functions. So I²C needs data and clock separately, while UART needs only one
 * direction — a GPS module is wired TX-only in most sketches, and refusing that
 * would be the validator inventing a rule the hardware does not have.
 */
const BUS_REQUIREMENTS: Record<BusKind, readonly (readonly PinFunction[])[]> = {
  i2c: [["i2c-sda"], ["i2c-scl"]],
  spi: [["spi-sck"], ["spi-mosi", "spi-miso"]],
  uart: [["uart-tx", "uart-rx"]],
  onewire: [["onewire"]],
};

/**
 * Every pin function that names a role on a bus, as opposed to a direction or a
 * rail.
 *
 * Exported because `rules.ts` keys its pairing table on it: which role mates
 * with which is that file's business, but WHICH FUNCTIONS ARE ROLES is this
 * one's, and two files enumerating the same nine strings is two files that can
 * disagree. Typed as this list rather than as `PinFunction`, so a tenth role
 * added here is a compile error in the pairing table rather than a rule that
 * quietly stops judging it.
 */
export const BUS_ROLE_FUNCTIONS = [
  "i2c-sda",
  "i2c-scl",
  "spi-mosi",
  "spi-miso",
  "spi-sck",
  "spi-cs",
  "uart-tx",
  "uart-rx",
  "onewire",
] as const satisfies readonly PinFunction[];

export type BusRoleFunction = (typeof BUS_ROLE_FUNCTIONS)[number];

/**
 * Which bus each of those roles is speaking.
 *
 * Written out rather than derived from `BUS_REQUIREMENTS` above, because the two
 * answer different questions. That table says which pins a part must HAVE to
 * claim a bus: an SPI part needs a clock and a data line, and it does not need a
 * chip select, which is very often an ordinary GPIO the library toggles. This
 * one says which bus a pin is TALKING when it carries a role, and `spi-cs` most
 * certainly is. The asymmetry is the hardware's, not an oversight.
 */
const BUS_OF_FUNCTION: Partial<Record<PinFunction, BusKind>> &
  Record<BusRoleFunction, BusKind> = {
  "i2c-sda": "i2c",
  "i2c-scl": "i2c",
  "spi-mosi": "spi",
  "spi-miso": "spi",
  "spi-sck": "spi",
  "spi-cs": "spi",
  "uart-tx": "uart",
  "uart-rx": "uart",
  onewire: "onewire",
};

/**
 * What one pin function says about which way the signal on that wire goes.
 *
 * Three answers, and the third is the one that keeps being forgotten. A pin
 * function can name a DIRECTION (`digital-out` sources, `anode` sinks) or it
 * can name what the wire CARRIES (`pwm`, and every bus role), and the second
 * kind says nothing whatever about direction. Read as if it did, `pwm` makes a
 * board an INPUT on the L298N's motor-enable line and prints that floating pin
 * to the serial monitor as though it were a measurement — which is what the
 * sketch generator shipped, and what a hand-written list of „driving functions"
 * in `rules.ts` still says.
 *
 * It is a total `Record` rather than three lists for the reason
 * `BUS_ROLE_FUNCTIONS` is typed the way it is: a twenty-fifth pin function is
 * then a compile error here — somebody must decide what it means — instead of a
 * string that silently belongs to no list and is quietly treated as `neither`
 * by one reader and as a direction by the next.
 */
export type PinFlow = "drives" | "listens" | "neither";

export const PIN_FLOW: Record<PinFunction, PinFlow> = {
  gnd: "listens",
  "power-in": "listens",
  "power-out": "drives",
  "digital-in": "listens",
  "digital-out": "drives",
  "analog-in": "listens",
  "analog-out": "drives",
  vref: "listens",
  // Carried, not directed — see the note above. A board's D9 has a timer behind
  // it; a servo's SIG wants a waveform on it. One word, two opposite ends.
  pwm: "neither",
  "i2c-sda": "neither",
  "i2c-scl": "neither",
  "spi-mosi": "neither",
  "spi-miso": "neither",
  "spi-sck": "neither",
  "spi-cs": "neither",
  "uart-tx": "neither",
  "uart-rx": "neither",
  interrupt: "listens",
  onewire: "neither",
  reset: "listens",
  // Two legs of a part with no direction of its own: a resistor conducts both
  // ways, and which end is the source is a fact about the circuit, not the pin.
  passive: "listens",
  anode: "listens",
  cathode: "listens",
  // Electrically nothing. `listens` rather than `neither`, because the one
  // question asked of that answer is „can this pin do anything but drive", and
  // a pin connected to no silicon at all certainly can not drive.
  nc: "listens",
};

/**
 * Every bus one pin declares a role on. Empty for an ordinary GPIO.
 *
 * **One end of a wire is never enough to say a bus is in use**, and this
 * function exists so that both readers of it agree on that. Every hardware bus
 * pin on every board in the catalogue is also an ordinary GPIO carrying a second
 * name — the UNO's A4/A5 are the I²C pair *and* two analogue inputs, its D10–D13
 * are the SPI header *and* four digital pins — so a board's role is a
 * CAPABILITY and only a peripheral's is an INTENT. The rules engine and the
 * sketch generator both had this wrong in their own way and in their own file:
 * one reported „bus pins crossed" for a legitimate bit-banged I²C line on D11,
 * the other emitted `#include <SPI.h>` for a circuit whose only SPI was that
 * same spare name on the same pin. Both now intersect the two ends through
 * here.
 */
export function pinBuses(pin: Pin): ReadonlySet<BusKind> {
  const buses = new Set<BusKind>();
  for (const fn of pin.functions) {
    const bus = BUS_OF_FUNCTION[fn];
    if (bus !== undefined) buses.add(bus);
  }
  return buses;
}

/**
 * Every problem with one entry, or an empty list.
 *
 * Returns all of them rather than the first, because the caller is a test over a
 * whole catalogue file and „the fourteenth entry is wrong somehow" is a worse
 * report than a list. The one exception is a root that is not an object: nothing
 * below it can be read, so one honest problem beats a dozen derived from it.
 */
export function validateComponent(value: unknown): readonly ComponentProblem[] {
  if (!isRecord(value)) return [{ field: "<root>", code: "shape" }];

  const problems: ComponentProblem[] = [];
  const kind = value["kind"];

  if (typeof value["id"] !== "string" || !ID_RE.test(value["id"])) {
    problems.push({ field: "id", code: "id" });
  }
  if (!(COMPONENT_KINDS as readonly unknown[]).includes(kind)) {
    problems.push({ field: "kind", code: "kind" });
  }
  for (const field of ["name", "summary"] as const) {
    const text = value[field];
    if (typeof text !== "string" || text.trim().length === 0) {
      problems.push({ field, code: "shape" });
    }
  }
  const library = value["library"];
  if (library !== undefined && (typeof library !== "string" || library.trim().length === 0)) {
    problems.push({ field: "library", code: "shape" });
  }

  // `true` or absent, never `false`. „This part does not need a resistor" is the
  // default and says nothing, so a stored `false` would be a field carrying no
  // information that a reader would nonetheless have to interpret — and the two
  // spellings of „no" would eventually disagree in a comparison somewhere.
  const needsSeriesResistor = value["needsSeriesResistor"];
  if (needsSeriesResistor !== undefined && needsSeriesResistor !== true) {
    problems.push({ field: "needsSeriesResistor", code: "shape" });
  }

  const valueUnit = value["valueUnit"];
  if (valueUnit !== undefined && !(VALUE_UNITS as readonly unknown[]).includes(valueUnit)) {
    problems.push({ field: "valueUnit", code: "shape" });
  }

  // Required on a board and forbidden elsewhere, rather than optional. A
  // sensor has no toolchain, and a board that failed to state one would reach
  // the code generator as „not an Arduino", which is the same answer a
  // Raspberry Pi gives — so the next board somebody adds would be silently
  // unprogrammable instead of loudly incomplete.
  const programming = value["programming"];
  if (kind === "board") {
    if (programming !== "arduino" && programming !== "linux") {
      problems.push({ field: "programming", code: "board" });
    }
  } else if (programming !== undefined) {
    problems.push({ field: "programming", code: "board" });
  }

  // Pins first: whether a supply is even meaningful is read off them.
  const pins = readPins(value["pins"], problems);
  const buses = readBuses(value["buses"], kind === "board", problems);

  if (value["supply"] !== undefined) problems.push(...supplyProblems(value["supply"]));
  if (value["current"] !== undefined) problems.push(...currentProblems(value["current"]));
  problems.push(...coherenceProblems(pins, buses));
  problems.push(...boardProblems(value, kind, pins));

  return problems;
}

/**
 * The units a part's value can be given in.
 *
 * Exported as a TYPE because the interface above used to restate these five
 * names inline, 135 lines from this list and tied to it by nothing: adding a
 * unit to one of the two would have left the other silently disagreeing, and
 * the disagreement is invisible — a validator that admits five units and an
 * interface that admits six are both perfectly well-typed. The screen that
 * labels the value field keys its copy off this type for the same reason.
 */
const VALUE_UNITS = ["ohm", "farad", "henry", "volt", "ampere"] as const;

export type ValueUnit = (typeof VALUE_UNITS)[number];

/**
 * `supply` and `current` are checked when stated, and never required here.
 *
 * There was a presence rule — „both, exactly when the part has a `power-in`
 * pin" — and the catalogue killed it within the hour by producing three honest
 * shapes it refused. An 18650 cell has no input at all and its `current.peak` is
 * what it can DELIVER; a DC motor has two bare terminals and a real 3–6 V
 * operating range; a 4×4 keypad is a switch matrix with neither. Any rule tight
 * enough to catch a resistor claiming a supply also refused those three.
 *
 * The deeper reason it does not belong here: this validator runs on components
 * the USER defines, and „I do not know my motor's stall current" is a true
 * answer. Refusing it would be the validator inventing a rule the world does not
 * have. What is genuinely required is a claim about the SHIPPED catalogue — that
 * a part we sell as taking power says how much — and `catalogue.test.ts` is
 * where that lives, because only there is completeness checkable against data.
 */
function supplyProblems(value: unknown): ComponentProblem[] {
  if (!isRecord(value)) return [{ field: "supply", code: "shape" }];

  const problems: ComponentProblem[] = [];
  const read: Record<string, number> = {};
  for (const field of ["min", "max"] as const) {
    const raw = value[field];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      problems.push({ field: `supply.${field}`, code: "shape" });
      continue;
    }
    if (raw <= 0 || raw > MAX_SUPPLY_VOLTS) {
      problems.push({ field: `supply.${field}`, code: "range" });
      continue;
    }
    read[field] = raw;
  }
  const min = read["min"];
  const max = read["max"];
  if (min !== undefined && max !== undefined && min > max) {
    problems.push({ field: "supply", code: "order" });
  }
  return problems;
}

/** Milliamps: never negative, and a peak that is not below the typical draw. */
function currentProblems(value: unknown): ComponentProblem[] {
  if (!isRecord(value)) return [{ field: "current", code: "shape" }];

  const problems: ComponentProblem[] = [];
  const read: Record<string, number> = {};
  for (const field of ["typical", "peak"] as const) {
    const raw = value[field];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      problems.push({ field: `current.${field}`, code: "shape" });
      continue;
    }
    if (raw < 0) {
      problems.push({ field: `current.${field}`, code: "range" });
      continue;
    }
    read[field] = raw;
  }
  const typical = read["typical"];
  const peak = read["peak"];
  if (typical !== undefined && peak !== undefined && typical > peak) {
    problems.push({ field: "current", code: "order" });
  }
  return problems;
}

/**
 * The pins that are well-formed enough for the later rules to read.
 *
 * A malformed pin is reported and then DROPPED rather than carried, so the bus
 * rules below do not produce a second complaint derived from the first.
 */
function readPins(value: unknown, problems: ComponentProblem[]): Pin[] {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push({ field: "pins", code: "pins" });
    return [];
  }

  const pins: Pin[] = [];
  const seen = new Set<string>();
  value.forEach((raw, index) => {
    const at = `pins[${index}]`;
    if (!isRecord(raw)) {
      problems.push({ field: at, code: "shape" });
      return;
    }
    const id = raw["id"];
    const label = raw["label"];
    const functions = raw["functions"];
    if (typeof id !== "string" || id.trim().length === 0 || typeof label !== "string") {
      problems.push({ field: at, code: "shape" });
      return;
    }
    if (seen.has(id)) {
      problems.push({ field: `${at}.id`, code: "duplicate" });
      return;
    }
    seen.add(id);

    if (
      !Array.isArray(functions) ||
      functions.length === 0 ||
      functions.some((fn) => !(PIN_FUNCTIONS as readonly unknown[]).includes(fn))
    ) {
      problems.push({ field: `${at}.functions`, code: "pins" });
      return;
    }
    const volts = raw["volts"];
    if (volts !== undefined && (typeof volts !== "number" || !Number.isFinite(volts) || volts <= 0)) {
      problems.push({ field: `${at}.volts`, code: "range" });
      return;
    }
    // A pin that supplies power must say how much; „power-out, unspecified" is
    // a rail the current budget cannot add up and the rules engine cannot check
    // a peripheral against.
    if ((functions as PinFunction[]).includes("power-out") && typeof volts !== "number") {
      problems.push({ field: `${at}.volts`, code: "range" });
      return;
    }
    pins.push({
      id,
      label,
      functions: functions as PinFunction[],
      ...(typeof volts === "number" ? { volts } : {}),
    });
  });
  return pins;
}

/** The buses that are well-formed, with the same drop-on-malformed rule. */
function readBuses(value: unknown, isBoard: boolean, problems: ComponentProblem[]): Bus[] {
  if (!Array.isArray(value)) {
    problems.push({ field: "buses", code: "shape" });
    return [];
  }

  const buses: Bus[] = [];
  value.forEach((raw, index) => {
    const at = `buses[${index}]`;
    if (!isRecord(raw) || !(BUS_KINDS as readonly unknown[]).includes(raw["kind"])) {
      problems.push({ field: at, code: "shape" });
      return;
    }
    const kind = raw["kind"] as BusKind;
    if (kind !== "i2c") {
      buses.push(kind === "uart" && typeof raw["baud"] === "number" ? { kind, baud: raw["baud"] } : ({ kind } as Bus));
      return;
    }

    const addresses = raw["addresses"];
    if (!Array.isArray(addresses)) {
      problems.push({ field: `${at}.addresses`, code: "shape" });
      return;
    }
    // A master lists none; a peripheral that lists none cannot be checked for a
    // collision, which is the single most common wiring fault this bus has.
    if (addresses.length === 0 && !isBoard) {
      problems.push({ field: `${at}.addresses`, code: "address" });
      return;
    }
    const seen = new Set<number>();
    let sound = true;
    for (const address of addresses) {
      if (
        typeof address !== "number" ||
        !Number.isInteger(address) ||
        address < I2C_MIN_ADDRESS ||
        address > I2C_MAX_ADDRESS
      ) {
        problems.push({ field: `${at}.addresses`, code: "address" });
        sound = false;
        break;
      }
      if (seen.has(address)) {
        problems.push({ field: `${at}.addresses`, code: "duplicate" });
        sound = false;
        break;
      }
      seen.add(address);
    }
    if (sound) buses.push({ kind: "i2c", addresses: addresses as number[] });
  });
  return buses;
}

/**
 * The two halves of „declared and wired agree", plus the return path.
 *
 * Neither direction is visible by reading an entry, because each half looks
 * correct on its own: an I²C bus with no SDA pin is a promise the part cannot
 * keep, and an SDA pin with no I²C bus is a wire whose meaning nothing knows.
 */
function coherenceProblems(pins: readonly Pin[], buses: readonly Bus[]): ComponentProblem[] {
  const problems: ComponentProblem[] = [];
  const present = new Set(pins.flatMap((pin) => pin.functions));
  const declared = new Set(buses.map((bus) => bus.kind));

  for (const bus of declared) {
    for (const group of BUS_REQUIREMENTS[bus]) {
      if (!group.some((fn) => present.has(fn))) {
        problems.push({ field: `buses.${bus}`, code: "bus-pin" });
      }
    }
  }
  for (const fn of present) {
    const needed = FUNCTION_BUS[fn];
    if (needed !== undefined && !declared.has(needed)) {
      problems.push({ field: `pins.${fn}`, code: "pin-bus" });
    }
  }
  if (present.has("power-in") && !present.has("gnd")) {
    problems.push({ field: "pins", code: "ground" });
  }
  return problems;
}

/** What only a board may be, and what a board must be. */
function boardProblems(
  value: Record<string, unknown>,
  kind: unknown,
  pins: readonly Pin[],
): ComponentProblem[] {
  const problems: ComponentProblem[] = [];
  const isBoard = kind === "board";
  const supplies = pins.some((pin) => pin.functions.includes("power-out"));
  const logicVolts = value["logicVolts"];

  if (isBoard) {
    if (typeof logicVolts !== "number" || !Number.isFinite(logicVolts) || logicVolts <= 0) {
      problems.push({ field: "logicVolts", code: "board" });
    }
    // Everything on the canvas is powered from the board unless a separate
    // supply is placed, so a board with no rail is a circuit that cannot start.
    if (!supplies) problems.push({ field: "pins", code: "board" });
    return problems;
  }

  if (logicVolts !== undefined) {
    problems.push({ field: "logicVolts", code: "board" });
  }
  // A sensor that claims to feed the rail would make the current budget
  // nonsense — it would appear to supply the very thing it draws from.
  if (supplies && kind !== "power") {
    problems.push({ field: "pins", code: "board" });
  }
  return problems;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

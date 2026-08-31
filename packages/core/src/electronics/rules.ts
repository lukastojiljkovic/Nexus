/**
 * What is wrong with a circuit ELECTRICALLY — slice E3 of ADR-085.
 *
 * `circuitProblems` in `circuit.ts` asks whether the document is well formed:
 * is this a row, does that wire reach a pin that exists, does this build ship
 * that part. This file asks the different question, the one somebody opens the
 * workbench to have answered — *will it work, and will it survive being turned
 * on*. A 3.3 V sensor on a 5 V rail is a perfectly well-formed document.
 *
 * **Every finding here is a notice, never a refusal**, exactly as the structural
 * ones are. Nothing in this file can stop a circuit being saved, opened or
 * synced. It is a draughtsman's opinion about a drawing, and the user is
 * entitled to ignore it — they may know something the catalogue does not.
 *
 * **It reads {@link buildNets} and never walks the wires itself.** Connectivity
 * is transitive and half of these rules are wrong without that: „is this sensor
 * on the 5 V rail" cannot be answered by looking at the wires that touch the
 * sensor. That the net list is a separate module is ADR-085 §2's rule that E3
 * comes before E4 and E5 — the sketch generator and the simulator consume the
 * same derived fact, and a generator that re-derived it would eventually
 * contradict the warning on the user's own screen.
 *
 * **Severity is two values and no more.** `error` is „this will not work, or
 * will destroy something"; `warning` is „this is probably not what you meant".
 * A third level would be a level nobody could define the boundary of, and the
 * panel sorts on this, so a scale nobody agrees on becomes an order nobody
 * trusts.
 *
 * **Where a rule cannot be sure, it says nothing.** Several deliberate silences
 * are marked below; each one is a case where the honest answer needs a fact the
 * catalogue does not carry, and inventing an opinion would train the user to
 * dismiss the panel. The most important is the whole class: a pin that commits
 * to no bus role is never judged for bit-banging one, because an ESP32 remaps
 * I²C onto almost any GPIO and software I²C is ordinary practice.
 */

import type { Circuit, CircuitPart } from "./circuit.js";
import type { BusRoleFunction, ComponentDef, Pin, PinFunction } from "./component.js";
import { BUS_ROLE_FUNCTIONS, pinBuses } from "./component.js";
import type { Net, PinRef } from "./nets.js";
import { buildNets } from "./nets.js";

export type RuleSeverity = "error" | "warning";

export type RuleCode =
  /** A part that takes power, wired to nothing that supplies any. */
  | "supply-unreached"
  /** A powered part whose ground reaches nothing but itself. */
  | "ground-unreached"
  /** The rail it is on is outside the range the part is rated for. */
  | "supply-range"
  /** Two different supply voltages shorted together. */
  | "rail-conflict"
  /** A supply wired straight to ground. */
  | "rail-short"
  /** A signal crossing between two logic voltages with nothing to translate. */
  | "logic-level"
  /** Two pins that can only ever drive, driving one net. */
  | "output-conflict"
  /** Two pins that both commit to a bus role, and the roles do not pair. */
  | "bus-role"
  /** Two devices on one I²C bus answering to the same address. */
  | "i2c-address"
  /** More current asked of a board than it is rated to hand out. */
  | "current-budget"
  /** A pin that wants PWM or an interrupt, on a board pin that has neither. */
  | "pin-capability"
  /** An analogue reading taken on a pin that can only see high and low. */
  | "analog-signal"
  /** A light-emitting part with nothing in series to limit its current. */
  | "led-unprotected";

/**
 * A figure the panel prints after the sentence.
 *
 * The Serbian copy is a STATIC sentence per code, as every other strings table
 * in this repository is, and the numbers arrive here instead. A sentence built
 * by interpolation is a sentence `check:address` cannot read, and it is how a
 * table of copy quietly becomes a template language.
 */
export type RuleValue =
  | { readonly kind: "volts"; readonly amount: number }
  | { readonly kind: "milliamps"; readonly amount: number }
  | { readonly kind: "range"; readonly min: number; readonly max: number }
  | { readonly kind: "address"; readonly value: number };

export interface RuleFinding {
  readonly code: RuleCode;
  readonly severity: RuleSeverity;
  /** Part ids, sorted. The panel resolves them to labels; the canvas points at them. */
  readonly parts: readonly string[];
  /** Empty where the sentence needs no numbers. */
  readonly values: readonly RuleValue[];
}

/**
 * Which pin functions pair with which, for {@link busRoleFindings}.
 *
 * Total over `BusRoleFunction` rather than partial over `PinFunction`, so a
 * tenth bus role added to the catalogue's model is a compile error here. The
 * two tables have to agree about WHICH functions are roles — `busRoleFindings`
 * uses this one to decide whether a pin is committed and `pinBuses` to decide
 * which bus it is committed to — and a role present in one and missing from the
 * other would silently stop being judged rather than fail.
 */
const BUS_PAIRS: Record<BusRoleFunction, readonly PinFunction[]> = {
  // Straight through: a peripheral's SDA is wired to the master's SDA. The same
  // holds for SPI, where a slave's „MOSI" pin is its input and carries the name
  // of the master's output — which is why MOSI pairs with MOSI, not with MISO.
  "i2c-sda": ["i2c-sda"],
  "i2c-scl": ["i2c-scl"],
  "spi-mosi": ["spi-mosi"],
  "spi-miso": ["spi-miso"],
  "spi-sck": ["spi-sck"],
  "spi-cs": ["spi-cs"],
  onewire: ["onewire"],
  // Crossed, and the one asymmetry in the table: a transmitter talks to a
  // receiver. TX to TX is the classic serial mistake and this is what catches it.
  "uart-tx": ["uart-rx"],
  "uart-rx": ["uart-tx"],
};

/**
 * The same nine, widened once here so `LISTENING` can splice them in and the
 * membership test in {@link busRoleFindings} reads as a test rather than a cast.
 */
const BUS_ROLES: readonly PinFunction[] = BUS_ROLE_FUNCTIONS;

/** The functions that make a pin a source rather than a sink. */
const DRIVING: readonly PinFunction[] = ["digital-out", "analog-out", "pwm", "power-out"];

/** The functions that make a pin able to listen. A pin with any is not output-only. */
const LISTENING: readonly PinFunction[] = [
  "digital-in",
  "analog-in",
  "power-in",
  "gnd",
  "passive",
  "anode",
  "cathode",
  "vref",
  "reset",
  "interrupt",
  "nc",
  ...BUS_ROLES,
];

/**
 * Everything wrong with a circuit, worst first.
 *
 * `resolve` is passed in for the reason `circuitProblems` states: a component
 * the user defined themselves must be read through the same call as a shipped
 * one.
 */
export function circuitRules(
  circuit: Circuit,
  resolve: (componentId: string) => ComponentDef | undefined,
): readonly RuleFinding[] {
  const bench = describeBench(circuit, resolve);
  if (bench === null) return [];

  const findings: RuleFinding[] = [
    ...railFindings(bench),
    ...supplyFindings(bench),
    ...signalFindings(bench),
    ...busRoleFindings(bench),
    ...i2cFindings(bench),
    ...budgetFindings(bench),
    ...ledFindings(bench),
  ];

  // **The same finding can be reached more than once, and the panel must print
  // it once.** Every rule above walks NETS, and one pair of parts can be joined
  // by several: a 5 V board and a 3.3 V module wired by two signal lines yield
  // two `logic-level` findings identical in every field, and an RGB LED with
  // three driven anodes yields three copies of one sentence about one part.
  // Deduplicating the whole finding is the fix that belongs here rather than
  // seven guards inside seven rules — the eighth rule would not have one.
  // Keying on a JSON round-trip is safe because every value in this file is
  // built from an object literal, so its key order is the literal's.
  const unique = new Map<string, RuleFinding>();
  for (const finding of findings) {
    unique.set(JSON.stringify(finding), finding);
  }

  // Errors first, then by code, then by the parts named — a stable order, so a
  // panel does not reshuffle itself when an unrelated wire is drawn. Sorting on
  // severity is what makes „will destroy something" sit above „probably not
  // what you meant" without a third field to say so.
  return [...unique.values()].sort(
    (a, b) =>
      Number(a.severity === "warning") - Number(b.severity === "warning") ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
      (a.parts.join() < b.parts.join() ? -1 : a.parts.join() > b.parts.join() ? 1 : 0),
  );
}

/** One placed part, with everything the rules need about it already resolved. */
interface Placed {
  readonly part: CircuitPart;
  readonly component: ComponentDef;
  /**
   * The volts this part's logic runs at, or `undefined` when nothing determines
   * it.
   *
   * A board states it outright. **A peripheral does not, and must not** — the
   * catalogue deliberately leaves `volts` off a breakout's signal pins, because
   * a module sold as „3–5 V" presents whichever level it is powered at. So a
   * peripheral's domain is read off the rail its `power-in` pin turned out to be
   * on, which is a fact about the WIRING and is exactly why this needs the net
   * list. An unpowered or ambiguously powered part has no domain, and every rule
   * that would have used one stays quiet.
   */
  readonly logicVolts: number | undefined;
  /** The single rail its `power-in` pins sit on, when there is exactly one. */
  readonly rail: number | undefined;
  readonly takesPower: boolean;
}

interface Bench {
  readonly nets: ReturnType<typeof buildNets>;
  readonly placed: readonly Placed[];
  readonly byId: ReadonlyMap<string, Placed>;
  /** The pins on a net, resolved back to their component definitions. */
  readonly pinsOf: (net: Net) => readonly { readonly ref: PinRef; readonly pin: Pin; readonly of: Placed }[];
}

function describeBench(
  circuit: Circuit,
  resolve: (componentId: string) => ComponentDef | undefined,
): Bench | null {
  const nets = buildNets(circuit, resolve);
  if (nets.nets.length === 0) return null;

  const byId = new Map<string, Placed>();
  for (const part of circuit.parts) {
    if (byId.has(part.id)) continue;
    const component = resolve(part.componentId);
    // Silence, not a finding: `circuitProblems` already names the unknown
    // component once, and an electrical opinion about a part whose pins nobody
    // has would be an opinion about nothing.
    if (component === undefined) continue;
    const powerPins = component.pins.filter((pin) => pin.functions.includes("power-in"));
    const rails = new Set<number>();
    for (const pin of powerPins) {
      for (const volts of nets.at(part.id, pin.id)?.rails ?? []) rails.add(volts);
    }
    const rail = rails.size === 1 ? [...rails][0] : undefined;
    byId.set(part.id, {
      part,
      component,
      logicVolts: component.logicVolts ?? rail,
      rail,
      takesPower: powerPins.length > 0,
    });
  }

  // Nested, rather than one map keyed on `partId + separator + pinId`. Any
  // composite key needs an argument about what its two halves cannot contain,
  // and a nested map needs none. `nets.ts` cannot do this — a union-find node
  // has to BE one value — which is why it length-prefixes instead.
  const pinsByPart = new Map<string, ReadonlyMap<string, Pin>>();
  for (const placed of byId.values()) {
    pinsByPart.set(placed.part.id, new Map(placed.component.pins.map((pin) => [pin.id, pin])));
  }

  return {
    nets,
    placed: [...byId.values()],
    byId,
    pinsOf: (net) =>
      net.pins.flatMap((ref) => {
        const pin = pinsByPart.get(ref.partId)?.get(ref.pinId);
        const of = byId.get(ref.partId);
        return pin === undefined || of === undefined ? [] : [{ ref, pin, of }];
      }),
  };
}

/** Two supplies tied together, and a supply tied to ground. */
function railFindings(bench: Bench): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const net of bench.nets.nets) {
    if (net.rails.length === 0) continue;
    const parts = partsOn(bench, net);
    if (net.rails.length > 1) {
      findings.push({
        code: "rail-conflict",
        severity: "error",
        parts,
        values: net.rails.map((amount) => ({ kind: "volts", amount }) as const),
      });
    }
    if (net.ground) {
      findings.push({
        code: "rail-short",
        severity: "error",
        parts,
        values: net.rails.map((amount) => ({ kind: "volts", amount }) as const),
      });
    }
  }
  return findings;
}

/** Is it powered, is it grounded, and is the rail one it can survive. */
function supplyFindings(bench: Bench): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const placed of bench.placed) {
    if (!placed.takesPower) continue;

    // **Boards are exempt from the presence rules, and this is the single most
    // important exemption in the file.** An UNO has a VIN pin and is powered
    // over USB in nearly every circuit anyone draws, so a rule that demanded a
    // rail on it would fire on the commonest CORRECT circuit there is — and a
    // panel that is wrong about the normal case is a panel nobody reads. The
    // RANGE check below still applies to a board, because a 9 V battery wired to
    // VIN is a claim worth checking; it simply only runs when a rail is there.
    const isBoard = placed.component.kind === "board";
    const powerPins = placed.component.pins.filter((pin) => pin.functions.includes("power-in"));
    const anyRail = powerPins.some((pin) => (bench.nets.at(placed.part.id, pin.id)?.rails ?? []).length > 0);

    if (!isBoard && !anyRail) {
      findings.push({ code: "supply-unreached", severity: "error", parts: [placed.part.id], values: [] });
    }

    if (!isBoard && anyRail) {
      const groundPins = placed.component.pins.filter((pin) => pin.functions.includes("gnd"));
      // „Grounded" means the return path leaves this part. A GND pin alone on
      // its net is a part floating at whatever its supply happens to sit at,
      // which is a circuit that does nothing and reads on the canvas as one that
      // should work.
      const grounded = groundPins.some((pin) =>
        (bench.nets.at(placed.part.id, pin.id)?.pins ?? []).some((ref) => ref.partId !== placed.part.id),
      );
      if (groundPins.length > 0 && !grounded) {
        findings.push({ code: "ground-unreached", severity: "error", parts: [placed.part.id], values: [] });
      }
    }

    const supply = placed.component.supply;
    if (supply === undefined) continue;
    for (const volts of railsUnder(bench, placed, powerPins)) {
      if (volts >= supply.min && volts <= supply.max) continue;
      findings.push({
        code: "supply-range",
        severity: "error",
        parts: [placed.part.id],
        values: [
          { kind: "volts", amount: volts },
          { kind: "range", min: supply.min, max: supply.max },
        ],
      });
    }
  }
  return findings;
}

function railsUnder(bench: Bench, placed: Placed, powerPins: readonly Pin[]): number[] {
  const rails = new Set<number>();
  for (const pin of powerPins) {
    for (const volts of bench.nets.at(placed.part.id, pin.id)?.rails ?? []) rails.add(volts);
  }
  return [...rails].sort((a, b) => a - b);
}

/** Everything about a net that carries a signal rather than power. */
function signalFindings(bench: Bench): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const net of bench.nets.nets) {
    // A rail or a ground is not a signal. Comparing „logic levels" across the
    // 5 V rail would report every correctly powered mixed-voltage circuit.
    if (net.rails.length > 0 || net.ground || net.pins.length < 2) continue;
    const members = bench.pinsOf(net);

    // ── Logic domains ────────────────────────────────────────────────────
    // A pin's own `volts` wins where the catalogue states it — `digital()`
    // stamps every board pin „so a mismatch is checkable per wire" — and the
    // part's derived domain is the fallback for a breakout that states none.
    const levels = new Map<string, number>();
    for (const member of members) {
      const volts = member.pin.volts ?? member.of.logicVolts;
      if (volts !== undefined) levels.set(member.of.part.id, volts);
    }
    const distinct = [...new Set(levels.values())].sort((a, b) => b - a);
    const high = distinct[0];
    const low = distinct[distinct.length - 1];
    if (distinct.length > 1 && high !== undefined && low !== undefined) {
      findings.push({
        code: "logic-level",
        severity: "error",
        parts: [...levels.keys()].sort(),
        values: [
          { kind: "volts", amount: high },
          { kind: "volts", amount: low },
        ],
      });
    }

    // ── Two things driving one wire ──────────────────────────────────────
    // Only pins that can do NOTHING but drive. A board's digital pin is both an
    // input and an output and which it becomes is the sketch's decision, which
    // the catalogue says outright — so two of them on one net is ordinary and
    // is not judged here.
    const drivers = members.filter(
      (member) =>
        member.pin.functions.some((fn) => DRIVING.includes(fn)) &&
        !member.pin.functions.some((fn) => LISTENING.includes(fn)),
    );
    if (drivers.length > 1) {
      findings.push({
        code: "output-conflict",
        severity: "error",
        parts: [...new Set(drivers.map((member) => member.of.part.id))].sort(),
        values: [],
      });
    }

    // ── An analogue reading on a pin that cannot take one ────────────────
    const analogSources = members.filter((member) => member.pin.functions.includes("analog-out"));
    const canRead = members.some((member) =>
      member.pin.functions.some((fn) => fn === "analog-in" || fn === "vref"),
    );
    if (analogSources.length > 0 && !canRead && members.length > analogSources.length) {
      findings.push({
        code: "analog-signal",
        severity: "warning",
        parts: [...new Set(members.map((member) => member.of.part.id))].sort(),
        values: [],
      });
    }

    // ── A pin that wants a capability the other end does not have ────────
    for (const want of ["pwm", "interrupt"] as const) {
      const wanting = members.filter(
        (member) => member.pin.functions.includes(want) && member.of.component.kind !== "board",
      );
      if (wanting.length === 0) continue;
      const boards = members.filter((member) => member.of.component.kind === "board");
      if (boards.length === 0 || boards.some((member) => member.pin.functions.includes(want))) continue;
      findings.push({
        // A warning and never an error: the Servo library drives PWM in software
        // on any AVR pin, and a pin-change interrupt exists on pins the
        // catalogue does not mark. „This is probably not the pin you wanted" is
        // the true strength of the claim.
        code: "pin-capability",
        severity: "warning",
        parts: [...new Set([...wanting, ...boards].map((member) => member.of.part.id))].sort(),
        values: [],
      });
    }
  }
  return findings;
}

/** SDA on SCL, MOSI on MISO, TX on TX. */
function busRoleFindings(bench: Bench): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const net of bench.nets.nets) {
    const committed = bench
      .pinsOf(net)
      .map((member) => ({
        member,
        roles: member.pin.functions.filter((fn): fn is BusRoleFunction => BUS_ROLES.includes(fn)),
        buses: pinBuses(member.pin),
      }))
      // A pin that commits to no bus role is never judged. Bit-banging I²C on a
      // plain GPIO is ordinary, and an ESP32 remaps the hardware bus onto almost
      // any pin — refusing that would be the engine inventing a rule the
      // hardware does not have.
      .filter((entry) => entry.roles.length > 0);

    for (let i = 0; i < committed.length; i += 1) {
      for (let j = i + 1; j < committed.length; j += 1) {
        const a = committed[i];
        const b = committed[j];
        if (a === undefined || b === undefined) continue;
        // **Two pins are only crossed if they are on the same bus.** The
        // exemption above was written for a pin that declares no role at all,
        // and that turned out to be a much smaller set than it reads as: every
        // hardware bus pin on every board is ALSO an ordinary GPIO with a second
        // name, so bit-banging I²C onto a UNO's D11 met `spi-mosi` and was
        // reported as an error — the exact practice the comment above says is
        // ordinary, refused because the *board* had a spare name for the pin.
        // A board's role is a capability; only a peripheral's is an intent.
        // Different buses at the two ends means one of them is bit-banging,
        // which is not this rule's business; the SAME bus, badly paired, is.
        if (![...a.buses].some((bus) => b.buses.has(bus))) continue;
        const mates = new Set<PinFunction>(b.roles);
        if (a.roles.some((role) => BUS_PAIRS[role].some((mate) => mates.has(mate)))) continue;
        findings.push({
          code: "bus-role",
          severity: "error",
          parts: [...new Set([a.member.of.part.id, b.member.of.part.id])].sort(),
          values: [],
        });
      }
    }
  }
  return findings;
}

/** Two devices on one bus answering to one address. */
function i2cFindings(bench: Bench): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const net of bench.nets.nets) {
    // The SDA net IS the bus. Using SCL as well would report every collision
    // twice, and using either alone is enough: a device wired to one and not the
    // other is a `bus-role` or an unconnected pin, which are other findings.
    const onBus = bench
      .pinsOf(net)
      .filter((member) => member.pin.functions.includes("i2c-sda"))
      .map((member) => ({
        id: member.of.part.id,
        addresses: member.of.component.buses.flatMap((bus) =>
          bus.kind === "i2c" ? [...bus.addresses] : [],
        ),
      }))
      // A master lists none — `validateComponent` allows exactly that for a
      // board — and a device with no addresses cannot be checked for a clash.
      .filter((entry) => entry.addresses.length > 0);

    for (let i = 0; i < onBus.length; i += 1) {
      for (let j = i + 1; j < onBus.length; j += 1) {
        const a = onBus[i];
        const b = onBus[j];
        if (a === undefined || b === undefined) continue;
        const shared = a.addresses.filter((address) => b.addresses.includes(address));
        if (shared.length === 0) continue;
        // Forced only when NEITHER can be moved. Two BMP280s both offer 0x76 and
        // 0x77, so one gets strapped to the other — the commonest legitimate way
        // anyone puts two of one sensor on a bus, and calling it a fault would
        // be the panel being wrong about correct work.
        const forced = a.addresses.length === 1 && b.addresses.length === 1;
        findings.push({
          code: "i2c-address",
          severity: forced ? "error" : "warning",
          parts: [a.id, b.id].sort(),
          values: forced && shared[0] !== undefined ? [{ kind: "address", value: shared[0] }] : [],
        });
      }
    }
  }
  return findings;
}

/** What the board is asked to hand out, against what it is rated to. */
function budgetFindings(bench: Bench): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const board of bench.placed) {
    if (board.component.kind !== "board") continue;
    const budget = board.component.current;
    if (budget === undefined) continue;

    // Every net this board drives, and every part drawing from one of them.
    // `boards.ts` states what the ceiling means: „`peak` is the board plus what
    // its rails are rated to hand out, which is the number a current budget has
    // to work against." The field was written for this rule.
    const railNets = new Set<number>();
    for (const pin of board.component.pins) {
      if (!pin.functions.includes("power-out")) continue;
      const net = bench.nets.at(board.part.id, pin.id);
      if (net !== undefined) railNets.add(net.id);
    }

    const drawing = new Set<string>();
    for (const placed of bench.placed) {
      if (placed.part.id === board.part.id) continue;
      const draws = placed.component.pins.some((pin) => {
        if (!pin.functions.includes("power-in")) return false;
        const net = bench.nets.at(placed.part.id, pin.id);
        return net !== undefined && railNets.has(net.id);
      });
      if (draws) drawing.add(placed.part.id);
    }

    // `typical`, not `peak`: this is the continuous draw, which is what a rail
    // has to sustain. `sensors.ts` makes the case with the MQ heaters — four of
    // them at 150 mA is over budget „before anything moves". A budget built from
    // peaks would report every circuit with a servo in it, because a servo's
    // stall current is a number it reaches for milliseconds.
    let asked = budget.typical;
    for (const id of drawing) asked += bench.byId.get(id)?.component.current?.typical ?? 0;

    if (asked > budget.peak) {
      findings.push({
        code: "current-budget",
        severity: "error",
        parts: [board.part.id, ...[...drawing].sort()],
        // Rounded to a tenth: the sum of a dozen datasheet figures carries the
        // usual binary dust, and „245,00000000000003 mA" is a number that makes
        // a correct finding look like a bug.
        values: [
          { kind: "milliamps", amount: Math.round(asked * 10) / 10 },
          { kind: "milliamps", amount: budget.peak },
        ],
      });
    }
  }
  return findings;
}

/**
 * A light-emitting part with nothing in series to limit it.
 *
 * **The test is topological and deliberately knows nothing about resistors.**
 * The first version asked „is there a part with `valueUnit: 'ohm'` on the
 * anode's net", which sounds like the same question and is not: a resistor with
 * one leg on that net and the other leg in the air is ON the net while carrying
 * no current at all, and the LED beside it is as unprotected as if the resistor
 * were in a drawer. `demo/electronics.test.ts` found exactly that by moving the
 * demo's LED anode onto the board pin and leaving the resistor's first leg
 * where it was.
 *
 * What is actually being asked is whether current can get from a source to
 * ground THROUGH the junction and nothing else — so: a driving pin directly on
 * the anode's net, and ground directly on the cathode's. Anything in series,
 * resistor or otherwise, puts itself between and breaks one of those two
 * conditions by construction. That also makes the rule right about a resistor
 * on the CATHODE side, which is equally valid protection and which the
 * `valueUnit` version would have reported as a fault.
 */
function ledFindings(bench: Bench): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const placed of bench.placed) {
    if (placed.component.needsSeriesResistor !== true) continue;

    const cathodeGrounded = placed.component.pins
      .filter((pin) => pin.functions.includes("cathode"))
      .some((pin) => bench.nets.at(placed.part.id, pin.id)?.ground === true);
    if (!cathodeGrounded) continue;

    for (const pin of placed.component.pins) {
      if (!pin.functions.includes("anode")) continue;
      const net = bench.nets.at(placed.part.id, pin.id);
      if (net === undefined) continue;

      const driven =
        net.rails.length > 0 ||
        bench
          .pinsOf(net)
          .some(
            (member) =>
              member.of.part.id !== placed.part.id &&
              member.pin.functions.some((fn) => DRIVING.includes(fn)),
          );
      if (!driven) continue;
      // One row per part, not per anode: an RGB LED has three, and three
      // identical sentences about one component say nothing the first did not.
      // `circuitRules` collapses them — see the deduplication there.
      findings.push({
        code: "led-unprotected",
        severity: "error",
        parts: [placed.part.id],
        values: [],
      });
    }
  }
  return findings;
}

function partsOn(bench: Bench, net: Net): string[] {
  return [...new Set(bench.pinsOf(net).map((member) => member.of.part.id))].sort();
}

/**
 * The circuit as a running thing — slice E5 of ADR-085.
 *
 * **What it simulates, and the line it does not cross.** `sketch.ts` and
 * `ros.ts` emit the WIRING and never the behaviour, because the control loop is
 * the one thing only the user has decided. This file inherits that rule exactly:
 * it runs a clock, and at every tick each channel carries the value the USER
 * declared for it. It does not decide that a robot should stop when the ranger
 * reads 20 cm — that sentence is their program, and a simulator that wrote it
 * would be handing back a guess with the authority of a running machine.
 *
 * What it supplies instead is the CHAIN, moving in time: a sensor's quantity
 * reaches a board pin, that pin is a topic in the package this circuit
 * generates, and an actuator's pin carries what the program would write to it.
 * ADR-085 §2 states E5's contents as exactly „the deterministic tick, sensor →
 * pin → topic → actuator“, and each of those four is a fact this module has
 * rather than one it invents.
 *
 * **Deterministic, and that word is load-bearing.** Every value is a closed form
 * of `(wave, ms)`: no random source, no accumulated state, no dependence on how
 * often the renderer calls it. So a run can be scrubbed, replayed and compared,
 * a screenshot of tick 40 is the same picture on every machine, and a test can
 * assert a number rather than a range. A simulator with an internal integrator
 * would be none of those things, and the physics that would justify one is
 * physics this module has refused to invent.
 *
 * **Nothing is re-derived.** The channels come from `boardWiring`, the topics
 * from `rosPins`, and the board from `soleBoard` — the same three calls the
 * generators make. ADR-085 §2's reason for putting E3 before E4 and E5 is that a
 * consumer which re-derived any of this would eventually contradict the warning
 * on the user's own screen, and a bench readout naming a topic the user's node
 * does not have is that contradiction in its most confusing form.
 *
 * **It stores nothing.** A run is an instrument you use at the bench, like the
 * generated code, and the circuit is what the profile keeps.
 */

import type { Circuit } from "./circuit.js";
import type { ComponentDef } from "./component.js";
import { rosPins } from "./ros.js";
import { boardWiring, soleBoard, type BoardWire } from "./wiring.js";

/** Why a circuit cannot be put on the bench. Never a failure — see {@link buildSimBench}. */
export type SimRefusal = "no-board" | "many-boards";

/**
 * Why a wire is not a channel.
 *
 * The first three are `BoardWire.owner` verbatim, exactly as the ROS
 * generator's are. **`analog` is deliberately not among them:** that skip exists
 * in `ros.ts` because gpiozero reads high and low and would publish a coin toss,
 * and this bench has no such limitation — a voltage is a value it can carry
 * honestly, so refusing it here would be borrowing another target's constraint.
 */
export type SimSkip = "bus" | "library" | "shared" | "no-direction";

export interface SimSkipped {
  readonly boardPin: string;
  readonly part: string;
  readonly partPin: string;
  readonly reason: SimSkip;
}

/** Which end of the wire the user stands in for. */
export type SimFlow =
  /** The board READS this pin, so the user supplies what the world is doing. */
  | "sensor"
  /** The board DRIVES it, so the user supplies what their program writes. */
  | "actuator";

/** What a number on a channel means. */
export type SimUnit =
  /** 0 or 1 — the two things a digital line is ever at. */
  | "level"
  /** 0–100: a duty cycle, which is what a PWM pin carries. */
  | "percent"
  /** Volts on the pin. */
  | "volts";

export interface SimRange {
  readonly min: number;
  readonly max: number;
}

export interface SimChannel {
  /**
   * The board pin's id, which is also the channel's identity.
   *
   * Unique by construction: a board pin carrying more than one peripheral is
   * `shared` and never becomes a channel, so there is exactly one channel per
   * pin and the id needs nothing appended to it.
   */
  readonly id: string;
  /** What the user calls the part on the canvas. */
  readonly part: string;
  /** The peripheral pin's label, which is what is printed beside it. */
  readonly partPin: string;
  readonly flow: SimFlow;
  readonly unit: SimUnit;
  /** The inclusive span a declared value is clamped into. */
  readonly range: SimRange;
  /**
   * The topic the generated ROS 2 package uses for this pin, where there is one.
   * Absent on a microcontroller — which has variables, not topics — and on a pin
   * the package itself declined to drive, most often an analogue one, which this
   * bench carries and gpiozero does not.
   */
  readonly topic: string | undefined;
}

export interface SimModel {
  readonly kind: "model";
  /** What the user calls the board. */
  readonly board: string;
  /**
   * The board's own logic level — the threshold {@link SimValue.overLogic} is
   * measured against. `validateComponent` requires it of every board, so absent
   * means a component that never went through the validator rather than a board
   * that declined to say; the bench then reports no threshold at all, because
   * substituting one would be a warning about a number nobody published.
   */
  readonly logicVolts: number | undefined;
  /** In board-pin order, which is the order the header is printed in. */
  readonly channels: readonly SimChannel[];
  /** Every wire that is not a channel, and why. */
  readonly skipped: readonly SimSkipped[];
}

export type SimBench = SimModel | { readonly kind: "refused"; readonly reason: SimRefusal };

/**
 * A value over time, as a closed form.
 *
 * Four shapes, and no fifth without a reason: between them they cover „drži ga
 * tu“, „pali ga i gasi“, „prevuci ga kroz opseg“ and „prođi kroz ova očitavanja“,
 * which is every question a bench answers about a single line. Each is a pure
 * function of the elapsed milliseconds — see the module header on why that
 * matters more here than expressiveness would.
 */
export type SimWave =
  | { readonly kind: "constant"; readonly value: number }
  | {
      readonly kind: "square";
      readonly low: number;
      readonly high: number;
      readonly periodMs: number;
      /** How much of each period is spent at `high`. */
      readonly dutyPercent: number;
    }
  | {
      /**
       * A SAWTOOTH: it rises from `from` to `to` across the period and starts
       * again. Not a triangle, because the discontinuity is the honest shape — a
       * sweep that walked back down would be two ramps drawn as one, and a user
       * reading „5 → 30 cm“ would be watching it spend half its time going the
       * other way.
       */
      readonly kind: "ramp";
      readonly from: number;
      readonly to: number;
      readonly periodMs: number;
    }
  | {
      readonly kind: "steps";
      readonly values: readonly number[];
      /** How long each value is held before the next. */
      readonly holdMs: number;
    };

export interface SimValue {
  readonly channel: string;
  /** In the channel's unit, clamped into its range. */
  readonly value: number;
  /**
   * The value is above what the board's logic is rated for, right now.
   *
   * The one consequence this bench reports that a static rule cannot.
   * `rules.ts` answers „are these two parts on incompatible rails“ once for the
   * circuit; this answers „is the line over the line at THIS tick“, which is a
   * different question the moment a value moves — a 5 V sensor the user never
   * drives past 2 V trips the static rule and never trips this one. Only ever
   * set on a `volts` channel of a board that states a logic level: where it
   * states none there is no threshold, and inventing one would be a warning
   * about a number nobody published.
   */
  readonly overLogic: boolean;
}

export interface SimFrame {
  /** Zero-based. `ms` is `tick * tickMs`, so a frame is addressable either way. */
  readonly tick: number;
  readonly ms: number;
  /** One per channel, in the model's order. */
  readonly values: readonly SimValue[];
}

/**
 * The ceiling of a `volts` channel whose driving end states no level.
 *
 * A control has to have an end — a slider without a maximum is a text field, and
 * a text field for a voltage is a number the user can type that means nothing.
 * Five is the highest rail any board in this catalogue supplies, so it is the
 * widest a signal on this canvas can honestly be, rather than a guess about this
 * particular part. See {@link rangeOf} for why it is not narrowed to the board's
 * logic level.
 */
export const DEFAULT_SIGNAL_VOLTS = 5;

/** A duty cycle is a percentage, and this is the whole of it. */
const FULL_DUTY = 100;

/**
 * The narrowest and widest a tick may be.
 *
 * Bounds rather than preferences: the step is a number a user types into a form
 * field, so both ends of it are reachable. A step of zero would stop simulated
 * time while the clock kept running, and one of a hundred million would put
 * every waveform's whole period inside a single frame — neither is a reading,
 * and neither should be an error message either.
 */
export const MIN_TICK_MS = 1;
export const MAX_TICK_MS = 10_000;

/**
 * The bench for a circuit, or the reason there is not one.
 *
 * Refusing is a first-class answer for `soleBoard`'s reason: „this circuit has
 * two boards“ is a sentence a panel can show, where an exception would leave it
 * choosing between showing nothing and showing a stack.
 */
export function buildSimBench(
  circuit: Circuit,
  resolve: (componentId: string) => ComponentDef | undefined,
): SimBench {
  const chosen = soleBoard(circuit, resolve);
  if (chosen.kind === "refused") return { kind: "refused", reason: chosen.reason };

  const { board, placed } = chosen;
  const wired = boardWiring(circuit, resolve, placed, board);
  const logicVolts = board.component.logicVolts;

  // Topics come from the ROS classifier rather than from a second naming pass —
  // see `rosPins`. A microcontroller has no topics at all, so it is not asked.
  const topics = new Map<string, string>();
  if (board.component.programming === "linux") {
    for (const pin of rosPins(wired).pins) topics.set(pin.boardPin, pin.topic);
  }

  const channels: SimChannel[] = [];
  const skipped: SimSkipped[] = [];

  for (const wire of wired) {
    const where = {
      boardPin: wire.boardPin.id,
      part: wire.partName,
      partPin: wire.partPin.label,
    };
    const reason = skipReason(wire);
    if (reason !== undefined) {
      skipped.push({ ...where, reason });
      continue;
    }
    const flow: SimFlow = wire.direction === "in" ? "sensor" : "actuator";
    const unit = unitOf(wire);
    channels.push({
      id: where.boardPin,
      part: where.part,
      partPin: where.partPin,
      flow,
      unit,
      range: rangeOf(unit, flow, wire, logicVolts),
      topic: topics.get(where.boardPin),
    });
  }

  return { kind: "model", board: board.name, logicVolts, channels, skipped };
}

/**
 * What a channel's value is at `ms`.
 *
 * Total: every guard below returns a number the user could have meant rather
 * than throwing, because this runs once per channel per frame behind a field the
 * user is still typing in. A period of zero is „nisu još dokucali“, not an error
 * to interrupt them with, and it holds one value — which is what a period
 * approaching zero looks like anyway.
 */
export function waveAt(wave: SimWave, ms: number): number {
  const at = Number.isFinite(ms) && ms > 0 ? ms : 0;
  switch (wave.kind) {
    case "constant":
      return wave.value;
    case "square": {
      if (!(wave.periodMs > 0)) return wave.high;
      const duty = clamp(wave.dutyPercent, 0, FULL_DUTY);
      return at % wave.periodMs < (wave.periodMs * duty) / FULL_DUTY ? wave.high : wave.low;
    }
    case "ramp": {
      if (!(wave.periodMs > 0)) return wave.from;
      return wave.from + ((wave.to - wave.from) * (at % wave.periodMs)) / wave.periodMs;
    }
    case "steps": {
      const first = wave.values[0];
      if (first === undefined) return 0;
      if (!(wave.holdMs > 0)) return first;
      return wave.values[Math.floor(at / wave.holdMs) % wave.values.length] ?? first;
    }
  }
}

/**
 * What ONE channel carries at `ms` — the whole of the bench, for one line.
 *
 * `simulateFrame` is this, mapped over the channels, and a preview strip is this
 * sampled across a window. **Both go through here rather than through
 * {@link waveAt}**, because the wave is a declaration and the channel is what
 * can carry it: a ramp on a digital pin is two states and not a slope, and a
 * strip that drew the slope would be showing a quantity the hardware does not
 * have while the readout beside it printed the one it does. That was the shape
 * of it for one afternoon, and the disagreement was on screen, in one row.
 */
export function channelValueAt(channel: SimChannel, wave: SimWave, ms: number): number {
  return quantize(channel, waveAt(wave, ms));
}

/** One frame, at `tick`. The unit of the whole module — a run is this, repeated. */
export function simulateFrame(
  model: SimModel,
  waves: ReadonlyMap<string, SimWave>,
  tick: number,
  tickMs: number,
): SimFrame {
  const step = clamp(Math.round(tickMs), MIN_TICK_MS, MAX_TICK_MS);
  const index = Number.isFinite(tick) && tick > 0 ? Math.floor(tick) : 0;
  const ms = index * step;
  const values = model.channels.map((channel): SimValue => {
    const wave = waves.get(channel.id);
    // A channel nobody has set is at rest, and rest is the bottom of its range:
    // an LED that is off, a ranger reading nothing, a duty cycle of zero. The
    // alternative — leaving it out of the frame — would put „nije podešen“ and
    // „nije povezan“ on the same row of the same screen.
    const value =
      wave === undefined ? quantize(channel, channel.range.min) : channelValueAt(channel, wave, ms);
    return {
      channel: channel.id,
      value,
      overLogic:
        channel.unit === "volts" && model.logicVolts !== undefined && value > model.logicVolts,
    };
  });
  return { tick: index, ms, values };
}

// ---------------------------------------------------------------------------
// From wires to channels
// ---------------------------------------------------------------------------

/**
 * Why this wire is not a channel, or `undefined` where it is one.
 *
 * The order is `ros.ts`'s, for its reason: most structural first, so a bus line
 * is a bus line whatever else is true of it, and „nema smera“ is only worth
 * saying about a pin nothing else has already claimed.
 */
function skipReason(wire: BoardWire): SimSkip | undefined {
  if (wire.owner !== undefined) return wire.owner;
  if (wire.direction === undefined) return "no-direction";
  return undefined;
}

/**
 * What the value on this wire means.
 *
 * `percent` earns its place only where the BOARD drives, which is `roleOf`'s
 * rule in `ros.ts` and holds for the same reason: `pwm` on a pin the board reads
 * would be asking the board to measure a waveform, and the word alone never
 * names an end (see `PIN_FLOW`). An analogue pin at either end is volts;
 * anything else is the two states a digital line has.
 */
function unitOf(wire: BoardWire): SimUnit {
  if (wire.direction === "out" && wire.partPin.functions.includes("pwm")) return "percent";
  const analog =
    wire.partPin.functions.includes("analog-out") || wire.partPin.functions.includes("analog-in");
  return analog ? "volts" : "level";
}

/**
 * The span a declared value is clamped into.
 *
 * Volts is the only one with a question in it, and the answer is that whoever
 * DRIVES the line decides how high it can go: on a sensor channel that is the
 * peripheral, on an actuator channel it is the board.
 *
 * **The board's logic level is the THRESHOLD, never the sensor's ceiling**, and
 * the distinction is the whole of {@link SimValue.overLogic}. No peripheral in
 * the catalogue states a pin voltage — `Pin.volts` is optional precisely because
 * breakout boards do not commit to one — so taking the ceiling from the board
 * would clamp every analogue reading to the very number it is compared against,
 * and the warning could not fire on any circuit that can be built. Left at the
 * widest rail instead, a 3V3 Pi with an unstated analogue sensor on it says what
 * it should when the user drags that reading to 4 V, which is the mistake this
 * whole line exists to catch.
 */
function rangeOf(
  unit: SimUnit,
  flow: SimFlow,
  wire: BoardWire,
  logicVolts: number | undefined,
): SimRange {
  if (unit === "level") return { min: 0, max: 1 };
  if (unit === "percent") return { min: 0, max: FULL_DUTY };
  const driven = flow === "sensor" ? wire.partPin.volts : (logicVolts ?? wire.partPin.volts);
  return { min: 0, max: driven ?? DEFAULT_SIGNAL_VOLTS };
}

/**
 * A raw wave value as this channel can carry it.
 *
 * A digital line is rounded to one of its two states rather than clamped to a
 * fraction of them: 0.4 on a pin the board reads as a bit is not „0,4“, it is a
 * low, and a bench that printed the fraction would be showing a quantity the
 * hardware does not have. Volts and percent keep their fraction, to a hundredth,
 * so a ramp's arithmetic does not print binary dust.
 */
function quantize(channel: SimChannel, raw: number): number {
  const value = clamp(raw, channel.range.min, channel.range.max);
  return channel.unit === "level" ? Math.round(value) : Math.round(value * 100) / 100;
}

/** `min` for anything that is not a number, so one bad field cannot spread NaN. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

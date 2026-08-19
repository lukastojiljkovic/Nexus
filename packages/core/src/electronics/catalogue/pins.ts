/**
 * The small helpers the catalogue is written with.
 *
 * **Why the catalogue is TypeScript and not a JSON file**, when `fitness`'s two
 * catalogues are JSON and this module otherwise follows them: a food entry is a
 * flat record of seven numbers with no structure to exploit, so JSON costs
 * nothing. A board is not. An Arduino Mega has fifty-four digital pins that
 * differ only in number and in which of them can do PWM; written out, that is
 * four hundred lines in which the one interesting fact — *which* ones — is
 * invisible. Written as `digital(0, 53, { pwm: [2..13, 44..46], … })` it is one
 * line and the interesting fact is the only thing on it.
 *
 * The cost of JSON here is not size, it is that a mistake becomes unreadable.
 * The cost of TypeScript is that the entries are type-checked at build time,
 * which is a gain rather than a cost — but a type still cannot know that an I²C
 * bus needs an SDA pin, so `validateComponent` runs over every shipped entry in
 * `catalogue.test.ts` exactly as it would over a parsed file.
 */

import type { Pin, PinFunction } from "../component.js";

/** A ground pin. Boards have several; everything that takes power has one. */
export const gnd = (id = "GND", label = "GND"): Pin => ({ id, label, functions: ["gnd"] });

/** A pin that takes power in — VCC, VDD, VIN on a peripheral. */
export const powerIn = (id = "VCC", label = id): Pin => ({ id, label, functions: ["power-in"] });

/** A rail a board or a regulator supplies. `volts` is required by the validator. */
export const powerOut = (id: string, volts: number, label = id): Pin => ({
  id,
  label,
  functions: ["power-out"],
  volts,
});

/** One signal pin with whatever it can do, at the board's logic level. */
export const pin = (id: string, functions: readonly PinFunction[], volts?: number, label = id): Pin => ({
  id,
  label,
  functions,
  ...(volts === undefined ? {} : { volts }),
});

/** What varies from one digital header to the next. */
export interface DigitalHeader {
  /** Pin numbers that can do PWM — the fact worth reading in a board's entry. */
  readonly pwm?: readonly number[];
  /** Pin numbers that can raise an external interrupt. */
  readonly interrupt?: readonly number[];
  /** Extra functions on named pins: SPI, UART, anything the datasheet multiplexes. */
  readonly also?: Readonly<Record<number, readonly PinFunction[]>>;
  /** Logic level, stamped on every pin so a mismatch is checkable per wire. */
  readonly volts: number;
  /** Prefix on the pin id: „D" for Arduino, „GP" for a Pico. */
  readonly prefix?: string;
  /** What is printed on the silkscreen, when it is not the bare number. */
  readonly label?: (number: number) => string;
}

/**
 * A run of digital pins, `from` through `to` inclusive.
 *
 * Every pin gets `digital-in` and `digital-out`, because every one of them can
 * be either and which it becomes is decided by the sketch — that ambiguity is
 * the thing the rules engine resolves from the wiring, so the catalogue must not
 * resolve it here.
 */
export function digital(from: number, to: number, header: DigitalHeader): Pin[] {
  const pins: Pin[] = [];
  for (let number = from; number <= to; number += 1) {
    const functions: PinFunction[] = ["digital-in", "digital-out"];
    if (header.pwm?.includes(number) === true) functions.push("pwm");
    if (header.interrupt?.includes(number) === true) functions.push("interrupt");
    for (const extra of header.also?.[number] ?? []) functions.push(extra);
    pins.push({
      id: `${header.prefix ?? "D"}${number}`,
      label: header.label?.(number) ?? String(number),
      functions,
      volts: header.volts,
    });
  }
  return pins;
}

/** A run of analogue inputs, `A0`…`A<count-1>`, with extras on named indices. */
export function analog(
  count: number,
  volts: number,
  also: Readonly<Record<number, readonly PinFunction[]>> = {},
): Pin[] {
  const pins: Pin[] = [];
  for (let index = 0; index < count; index += 1) {
    pins.push({
      id: `A${index}`,
      label: `A${index}`,
      functions: ["analog-in", ...(also[index] ?? [])],
      volts,
    });
  }
  return pins;
}

/** Inclusive number range, so a PWM list reads as the datasheet states it. */
export function through(from: number, to: number): number[] {
  const numbers: number[] = [];
  for (let n = from; n <= to; n += 1) numbers.push(n);
  return numbers;
}

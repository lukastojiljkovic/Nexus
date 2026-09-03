/**
 * The bench's form, apart from the bench (ADR-085 E5).
 *
 * `simulate.ts` in `@nexus/core` takes `SimWave` values and knows nothing about
 * text. A form holds text — a half-typed number, an empty field, a comma where
 * a full stop would be — so something has to turn one into the other, and it is
 * here rather than inside the dialog for the reason every other `…View.ts` in
 * this folder exists: the interesting part is arithmetic and parsing, and a
 * component is the one place in this codebase arithmetic cannot be tested.
 *
 * **Every reader here is total.** A field the user is in the middle of clearing
 * is not an error state — the wave falls back to the value the channel opened
 * with, the readout keeps moving, and nothing needs a red border to explain a
 * keystroke. The core's own guards are the second line of that; this is the
 * first, and it is the one that keeps a legible number in the input.
 */

import { channelValueAt } from "@nexus/core";
import type { SimChannel, SimWave } from "@nexus/core";

import { formatToolNumber } from "./toolFormat.js";

export const SIM_WAVE_KINDS = ["constant", "square", "ramp", "steps"] as const;
export type SimWaveKind = (typeof SIM_WAVE_KINDS)[number];

/**
 * One channel's waveform as the form holds it: strings, all of them, always.
 *
 * Every field is kept even while the selected kind ignores it, so switching
 * from a square wave to a ramp and back finds the duty cycle where it was left.
 * A draft that dropped the fields it was not using would make the kind selector
 * destructive, which is not what a selector is for.
 */
export interface SimWaveDraft {
  readonly kind: SimWaveKind;
  /** `constant` only. */
  readonly value: string;
  /** The bottom of a `square`, the start of a `ramp`. */
  readonly from: string;
  /** The top of a `square`, the end of a `ramp`. */
  readonly to: string;
  /** The period of a `square` or a `ramp`; the dwell of one `steps` value. */
  readonly periodMs: string;
  /** `square` only. */
  readonly dutyPercent: string;
  /**
   * `steps` only — the readings to walk through, **separated by semicolons**.
   *
   * Not commas, and this is the one place the choice matters: the app writes
   * decimals the Serbian way, so „1,5" is one number and a comma-separated list
   * could not say whether „1,5" was one value or two. The semicolon is the same
   * answer a Serbian spreadsheet gives, for the same reason.
   */
  readonly values: string;
}

/**
 * How long a preview covers.
 *
 * Exported because the dialog draws the clock's own position INSIDE that window
 * and has to wrap at the same number. A private copy there would be two
 * constants that must agree and nothing making them — and the failure is silent:
 * a marker that runs off the end of a strip still renders.
 */
export const SIM_PREVIEW_MS = 2_000;

/** How finely the window is sampled. */
const PREVIEW_SAMPLES = 96;

/** The preview's own box, in the units the `<svg viewBox>` is declared in. */
export const SIM_PREVIEW_WIDTH = 100;
export const SIM_PREVIEW_HEIGHT = 24;

/**
 * How far inside that box the signal band sits.
 *
 * A stroke centred on the boundary is half outside it, and an `<svg>` clips
 * what is outside — so a value at the floor of its range drew as a hairline
 * lying on the container's own border, and read as part of the border. The
 * resting state of every channel is exactly that value, so the first thing the
 * user saw of every preview was an empty box with a thick edge.
 *
 * The VALUE axis only. Time genuinely runs edge to edge, because the window
 * wraps rather than ending, and insetting it would draw a gap that is not there.
 */
export const SIM_PREVIEW_PAD = 2;

/** A point of the preview line, in `viewBox` units with `y` already pointing down. */
export interface SimPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * What a channel opens holding: a constant at the bottom of its range.
 *
 * At rest, in other words — an LED that is off, a duty cycle of zero, a sensor
 * reading nothing. It matches what `simulateFrame` does for a channel nobody
 * has configured, so the bench's first frame says the same thing whether the
 * user has touched it or not, and every unused field is pre-filled from the
 * same range so no kind ever opens on an empty form.
 */
export function restingDraft(channel: SimChannel): SimWaveDraft {
  const min = decimal(channel.range.min);
  const max = decimal(channel.range.max);
  return {
    kind: "constant",
    value: min,
    from: min,
    to: max,
    periodMs: "1000",
    dutyPercent: "50",
    values: `${min}; ${max}`,
  };
}

/**
 * The wave a draft describes.
 *
 * Falls back per FIELD rather than per form: a user typing a period has not
 * asked for their duty cycle to be forgotten, and a wave that reverted whole
 * would flicker back to rest between two keystrokes. The channel supplies each
 * fallback, so a cleared field reads as the resting value of that channel and
 * never as a zero that happens to mean something else on this line.
 */
export function waveFrom(draft: SimWaveDraft, channel: SimChannel): SimWave {
  const { min, max } = channel.range;
  switch (draft.kind) {
    case "constant":
      return { kind: "constant", value: simNumber(draft.value, min) };
    case "square":
      return {
        kind: "square",
        low: simNumber(draft.from, min),
        high: simNumber(draft.to, max),
        periodMs: simNumber(draft.periodMs, 1000),
        dutyPercent: simNumber(draft.dutyPercent, 50),
      };
    case "ramp":
      return {
        kind: "ramp",
        from: simNumber(draft.from, min),
        to: simNumber(draft.to, max),
        periodMs: simNumber(draft.periodMs, 1000),
      };
    case "steps":
      return {
        kind: "steps",
        values: numbers(draft.values),
        holdMs: simNumber(draft.periodMs, 1000),
      };
  }
}

/**
 * The line a channel CARRIES over the next two seconds.
 *
 * Through `channelValueAt` and not `waveAt`: the strip sits beside the readout,
 * and the two must be the same number. A ramp declared on a digital pin is two
 * states, so it draws as a staircase — which is a true and useful thing to
 * learn about your own circuit the moment you pick it, and is why the sampler
 * is worth more here than a prettier line would be.
 *
 * Sampled rather than solved: a square wave's own corner points would draw a
 * truer edge, but one sampler serves all four kinds and at this size the slope
 * it leaves on an edge is a single unit of a hundred. A preview that needed a
 * branch per wave kind would be a second implementation of the same closed
 * form — the one thing this module exists not to have.
 */
export function wavePreview(wave: SimWave, channel: SimChannel): SimPoint[] {
  const { min, max } = channel.range;
  const span = max - min || 1;
  const band = SIM_PREVIEW_HEIGHT - SIM_PREVIEW_PAD * 2;
  const points: SimPoint[] = [];
  for (let index = 0; index <= PREVIEW_SAMPLES; index += 1) {
    const share = index / PREVIEW_SAMPLES;
    // Already inside the channel's range: `channelValueAt` clamps as well as
    // quantizes, which is the whole reason the strip can trust it.
    const value = channelValueAt(channel, wave, share * SIM_PREVIEW_MS);
    points.push({
      x: round(share * SIM_PREVIEW_WIDTH),
      // Flipped, because an SVG's origin is its top-left and a signal's is not.
      y: round(SIM_PREVIEW_PAD + band * (1 - (value - min) / span)),
    });
  }
  return points;
}

/** The `points` attribute of a `<polyline>`, from what {@link wavePreview} returned. */
export function previewPath(points: readonly SimPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

/**
 * A value with the unit it is in — „1", „33,33 %", „3,3 V".
 *
 * `formatToolNumber` rather than a second formatter: it is already the app's
 * one Serbian number, comma and all, and a bench that printed „33.33" beside a
 * form the user types „33,33" into would be two conventions on one row.
 */
export function formatSimValue(unit: SimChannel["unit"], value: number): string {
  const number = formatToolNumber(value);
  if (unit === "percent") return `${number} %`;
  if (unit === "volts") return `${number} V`;
  return number;
}

/** A number as this form writes one: Serbian comma, no thousands grouping to re-parse. */
function decimal(value: number): string {
  return String(value).replace(".", ",");
}

/**
 * One typed field as a number, or the fallback. A comma is a decimal point —
 * see {@link SimWaveDraft}.
 *
 * Exported because the bench's own step field is the same problem one level up:
 * a form holding a number the user is halfway through typing. Two readers would
 * be two answers to „what does an empty box mean", and this one already has it.
 */
export function simNumber(text: string, fallback: number): number {
  const parsed = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The `steps` list, keeping only the entries that are numbers.
 *
 * A trailing separator is what a half-typed list looks like, so it produces no
 * entry rather than a zero — a zero would be a reading the user never typed,
 * and on a level channel it is the one that looks most like a real answer.
 */
function numbers(text: string): number[] {
  return text
    .split(";")
    .map((entry) => entry.trim())
    // `Number("")` is 0, not NaN, so the empty entries have to go BEFORE the
    // parse rather than be caught by the finite check after it.
    .filter((entry) => entry !== "")
    .map((entry) => Number(entry.replace(",", ".")))
    .filter((value) => Number.isFinite(value));
}

/** Two decimals is finer than a 24-unit-tall preview can show, and keeps the attribute short. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

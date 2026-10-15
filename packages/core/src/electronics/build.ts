/**
 * A circuit described in one piece: a board, the parts on it and the wires
 * between their pins. This is how the assistant builds a board — one call, not
 * a dozen — so the description is checked here, against the catalogue, before
 * anything is written.
 *
 * **Pins are named as the catalogue names them.** A wire end is `ref.pin`, where
 * `ref` is a part's ref (or the board's id or name) and `pin` is the pin's id or
 * its printed label, folded. A name nothing answers to is refused with the valid
 * ones listed, because a model that is told „D13 is not on this board; the pins
 * are D0 … D13" corrects itself, and one that is told „no" guesses again.
 *
 * Pure. It returns a plan of rows and indexes, never an id: the store assigns
 * ids when the plan is written, and the caller maps each planned part to the id
 * it was given.
 */

import { foldSearchText } from "../search/searchText.js";
import type { WireColour } from "./circuit.js";
import type { ComponentDef, Pin, ValueUnit } from "./component.js";

export interface BuildPartInput {
  /** The name the wires use for this part, e.g. „R1". */
  readonly ref: string;
  /** A catalogue id or a catalogue name. */
  readonly component: string;
  /** A value with its unit, e.g. „220", „4,7k", „10 mA". Absent when the part has none. */
  readonly value?: string;
}

export interface BuildWireInput {
  /** `ref.pin`, e.g. „R1.1" or „arduino-uno.D13". */
  readonly from: string;
  readonly to: string;
}

export interface BuildInput {
  /** The board's catalogue id or name. */
  readonly board: string;
  readonly parts: readonly BuildPartInput[];
  readonly wires: readonly BuildWireInput[];
}

/** One part to write. `label` is what the bench shows: the part's ref, or the board's own name. */
export interface PlannedPart {
  readonly label: string;
  readonly componentId: string;
  readonly value?: number;
  readonly x: number;
  readonly y: number;
}

/** A wire end: an index into the plan's parts, and the pin on that part. */
export interface PlannedEnd {
  readonly part: number;
  readonly pinId: string;
}

export interface PlannedWire {
  readonly from: PlannedEnd;
  readonly to: PlannedEnd;
  readonly colour: WireColour;
}

/** The board is always `parts[0]`; the rest follow in the order they were described. */
export interface BuildPlan {
  readonly parts: readonly PlannedPart[];
  readonly wires: readonly PlannedWire[];
}

/**
 * Why a description cannot be built. Each is a fact about the input, and the
 * caller says it in the user's language — this file holds no copy.
 */
export type BuildProblem =
  | { readonly code: "unknown-component"; readonly name: string }
  | { readonly code: "not-a-board"; readonly name: string }
  | { readonly code: "board-as-part"; readonly ref: string }
  | { readonly code: "duplicate-ref"; readonly ref: string }
  | { readonly code: "bad-end"; readonly end: string }
  | { readonly code: "unknown-part"; readonly name: string; readonly known: readonly string[] }
  | {
      readonly code: "unknown-pin";
      readonly part: string;
      readonly pin: string;
      readonly valid: readonly string[];
    }
  | { readonly code: "no-value"; readonly ref: string }
  | { readonly code: "bad-value"; readonly ref: string; readonly value: string };

export type BuildResult =
  | { readonly kind: "plan"; readonly plan: BuildPlan }
  | { readonly kind: "refused"; readonly problem: BuildProblem };

/**
 * The grid parts are placed on, in description order, the board first.
 *
 * A policy choice rather than a measurement: a fixed step that keeps one part
 * from landing on the next, and the user moves anything in one drag. The step
 * is not derived from the drawn bodies, so it is not a claim about their size.
 */
const GRID_COLUMNS = 4;
const GRID_STEP_X = 240;
const GRID_STEP_Y = 200;

/** SI prefixes a value may carry. `µ` is accepted beside `u`, as a keyboard lacks the Greek letter. */
const PREFIXES: ReadonlyMap<string, number> = new Map([
  ["p", 1e-12],
  ["n", 1e-9],
  ["u", 1e-6],
  ["µ", 1e-6],
  ["m", 1e-3],
  ["k", 1e3],
  ["K", 1e3],
  ["M", 1e6],
]);

/** The unit symbols each value unit is written with. A bare number carries none. */
const SYMBOLS: Readonly<Record<ValueUnit, readonly string[]>> = {
  ohm: ["Ω", "ohm", "R"],
  farad: ["F"],
  henry: ["H"],
  volt: ["V"],
  ampere: ["A"],
};

const VALUE = /^(\d+(?:[.,]\d+)?)\s*([pnuµmkKM]?)\s*([A-Za-zΩ]*)$/;

/** Folds a name the way every lookup here compares names: case- and diacritic-blind. */
function fold(text: string): string {
  return foldSearchText(text.trim());
}

/**
 * One catalogue entry by id, or by its name in either language.
 *
 * An id wins over a name, and a name is compared folded, so „Arduino Nano" and
 * „arduino nano" name the same board. `undefined` is an answer, not a failure:
 * the caller refuses by name and lists nothing it cannot prove.
 */
export function findComponent(
  query: string,
  catalogue: readonly ComponentDef[],
): ComponentDef | undefined {
  const folded = fold(query);
  return (
    catalogue.find((component) => component.id === query) ??
    catalogue.find(
      (component) =>
        fold(component.id) === folded ||
        fold(component.name) === folded ||
        (component.nameEn !== undefined && fold(component.nameEn) === folded),
    )
  );
}

/** One pin of a component, by its id or its printed label, folded. */
export function findPin(component: ComponentDef, name: string): Pin | undefined {
  const folded = fold(name);
  return (
    component.pins.find((pin) => fold(pin.id) === folded) ??
    component.pins.find((pin) => fold(pin.label) === folded)
  );
}

/** `"R1.1"` into `{ part: "R1", pin: "1" }`. The pin is what follows the LAST dot, so a ref may hold one. */
export function splitEnd(end: string): { readonly part: string; readonly pin: string } | undefined {
  const dot = end.lastIndexOf(".");
  if (dot <= 0 || dot === end.length - 1) return undefined;
  return { part: end.slice(0, dot).trim(), pin: end.slice(dot + 1).trim() };
}

/**
 * A value as the user typed it, in the unit the part measures — „220" ohms,
 * „4,7k" ohms, „10 mA" amperes — or `undefined` when it does not read.
 *
 * A symbol that is not the part's own unit is refused rather than ignored: „10 V"
 * on a resistor is a mistake to show, not a number to store.
 */
export function parseComponentValue(text: string, unit: ValueUnit): number | undefined {
  const match = VALUE.exec(text.trim());
  if (match === null) return undefined;
  const [, digits = "", prefix = "", symbol = ""] = match;
  if (symbol !== "" && !SYMBOLS[unit].includes(symbol)) return undefined;
  const scale = prefix === "" ? 1 : PREFIXES.get(prefix);
  if (scale === undefined) return undefined;
  return Number(digits.replace(",", ".")) * scale;
}

/**
 * The colour a new wire takes when nobody chose one: black to ground, red to a
 * supply, yellow for anything else. The convention the trade already uses, so a
 * wire drawn by the assistant reads like one drawn by hand.
 */
export function wireColourFor(a: Pin, b: Pin): WireColour {
  const ends = [a, b];
  if (ends.some((pin) => pin.functions.includes("gnd"))) return "black";
  if (ends.some((pin) => pin.functions.includes("power-in") || pin.functions.includes("power-out"))) {
    return "red";
  }
  return "yellow";
}

/** The grid cell for the `index`-th part: the board at the origin, the rest row by row. */
export function gridCell(index: number): { x: number; y: number } {
  return {
    x: (index % GRID_COLUMNS) * GRID_STEP_X,
    y: Math.floor(index / GRID_COLUMNS) * GRID_STEP_Y,
  };
}

/**
 * The plan for a described circuit, or the first thing wrong with it.
 *
 * Refuses at the first problem rather than collecting them: each refusal is one
 * sentence the model can act on, and a list of six would be a list the model
 * half-reads. The order is the description's own — the board, the parts, then
 * the wires — so the reason named is the earliest mistake in what was written.
 */
export function planBuild(input: BuildInput, catalogue: readonly ComponentDef[]): BuildResult {
  const refused = (problem: BuildProblem): BuildResult => ({ kind: "refused", problem });

  const board = findComponent(input.board, catalogue);
  if (board === undefined) return refused({ code: "unknown-component", name: input.board });
  if (board.kind !== "board") return refused({ code: "not-a-board", name: input.board });

  const parts: PlannedPart[] = [{ label: board.name, componentId: board.id, ...gridCell(0) }];
  // The board is reachable by its id and by its name, so a wire may say either.
  const indexOf = new Map<string, number>([
    [fold(board.id), 0],
    [fold(board.name), 0],
  ]);
  const components: ComponentDef[] = [board];

  for (const entry of input.parts) {
    const component = findComponent(entry.component, catalogue);
    if (component === undefined) {
      return refused({ code: "unknown-component", name: entry.component });
    }
    if (component.kind === "board") return refused({ code: "board-as-part", ref: entry.ref });
    const key = fold(entry.ref);
    if (indexOf.has(key)) return refused({ code: "duplicate-ref", ref: entry.ref });

    let value: number | undefined;
    if (entry.value !== undefined) {
      if (component.valueUnit === undefined) return refused({ code: "no-value", ref: entry.ref });
      value = parseComponentValue(entry.value, component.valueUnit);
      if (value === undefined) {
        return refused({ code: "bad-value", ref: entry.ref, value: entry.value });
      }
    }

    indexOf.set(key, parts.length);
    components.push(component);
    parts.push({
      label: entry.ref,
      componentId: component.id,
      ...(value === undefined ? {} : { value }),
      ...gridCell(parts.length),
    });
  }

  const resolveEnd = (
    end: string,
  ):
    | { readonly kind: "end"; readonly planned: PlannedEnd; readonly pin: Pin }
    | { readonly kind: "refused"; readonly problem: BuildProblem } => {
    const parsed = splitEnd(end);
    if (parsed === undefined) return { kind: "refused", problem: { code: "bad-end", end } };
    const index = indexOf.get(fold(parsed.part));
    if (index === undefined) {
      const known = parts.map((part) => part.label);
      return { kind: "refused", problem: { code: "unknown-part", name: parsed.part, known } };
    }
    const component = components[index];
    const pin = component === undefined ? undefined : findPin(component, parsed.pin);
    if (component === undefined || pin === undefined) {
      const valid = component?.pins.map((candidate) => candidate.id) ?? [];
      return {
        kind: "refused",
        problem: { code: "unknown-pin", part: parsed.part, pin: parsed.pin, valid },
      };
    }
    return { kind: "end", planned: { part: index, pinId: pin.id }, pin };
  };

  const wires: PlannedWire[] = [];
  for (const wire of input.wires) {
    const from = resolveEnd(wire.from);
    if (from.kind === "refused") return { kind: "refused", problem: from.problem };
    const to = resolveEnd(wire.to);
    if (to.kind === "refused") return { kind: "refused", problem: to.problem };
    wires.push({
      from: from.planned,
      to: to.planned,
      colour: wireColourFor(from.pin, to.pin),
    });
  }

  return { kind: "plan", plan: { parts, wires } };
}

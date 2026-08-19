/**
 * The user's own work: a circuit, the parts placed on it, and the wires between
 * them.
 *
 * **Normalised into three tables, not stored as one document** (ADR-085 §4), and
 * CANV is the argument. A canvas board keeps Excalidraw's JSON verbatim because
 * Excalidraw owns that format and a schema of ours would have to track seventy
 * fields defined by somebody else's renderer. Nothing owns this format but us,
 * and the moment a circuit is a blob, three things stop working: a wire cannot
 * be a sync row, so two people editing different corners of one circuit collide
 * over the whole thing; „every circuit using a BMP280" is a scan rather than an
 * index; and a part with one bad coordinate takes the circuit down with it
 * instead of being one refused row.
 *
 * **The catalogue is checked SEPARATELY from the shape, and that split is the
 * important line in this file.** `validatePart` and friends are the storage
 * gate — they ask whether a row is a row. `circuitProblems` asks whether the
 * circuit makes sense against the components this build ships, and it is allowed
 * to say „I do not know that part". A circuit drawn under a build with an entry
 * this one dropped is still the user's work, and refusing to OPEN it would be
 * the worst possible reading of a catalogue that already documents `undefined`
 * as its honest answer. So an unknown component is a problem the canvas draws as
 * a placeholder and names in the margin; it is never a reason a file will not
 * load.
 */

import type { ComponentDef } from "./component.js";

/**
 * The colours of the jumper wires on the desk.
 *
 * This is the one list in the product that is allowed to name blue and orange —
 * both are banned system hues, and the exemption is DEV-006. It is not a
 * decorative choice: red is the positive rail and black is ground by a
 * convention older than the hobby, and a canvas that recoloured them to fit a
 * palette would be teaching the wrong thing. They live behind `--nx-elec-wire-*`
 * tokens and appear nowhere outside this canvas.
 */
export const WIRE_COLOURS = [
  "red",
  "black",
  "yellow",
  "green",
  "blue",
  "white",
  "orange",
  "brown",
  "grey",
] as const;

export type WireColour = (typeof WIRE_COLOURS)[number];

/** Quarter turns. A part on a breadboard sits at one of four angles, not at 37°. */
export const PART_ROTATIONS = [0, 90, 180, 270] as const;

export type PartRotation = (typeof PART_ROTATIONS)[number];

/** How long a name the canvas can render without the label becoming the drawing. */
export const MAX_CIRCUIT_NAME_LENGTH = 200;
export const MAX_PART_LABEL_LENGTH = 120;
export const MAX_CIRCUIT_NOTES_LENGTH = 8000;

/**
 * The bound on the canvas, in the circuit's own units.
 *
 * Not a limit on how big a circuit may be — ±100 000 is a working area some
 * thousands of parts wide. It is a bound on what a COORDINATE can be, so that a
 * corrupted or hand-edited row cannot place a part where the canvas has to
 * decide what to do about infinity.
 */
export const MAX_CANVAS_COORDINATE = 100_000;

/** One component placed on the canvas. */
export interface CircuitPart {
  readonly id: string;
  readonly circuitId: string;
  /** Into the catalogue, or into the user's own components. May not resolve. */
  readonly componentId: string;
  /** The user's name for THIS one — „levi motor". Empty falls back to the part's. */
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: PartRotation;
  /** The value the user chose, for a component that has a `valueUnit`. */
  readonly value?: number;
}

/** One end of a wire: which part, and which of its pins. */
export interface WireEnd {
  readonly partId: string;
  readonly pinId: string;
}

/** One wire. */
export interface CircuitWire {
  readonly id: string;
  readonly circuitId: string;
  readonly from: WireEnd;
  readonly to: WireEnd;
  readonly colour: WireColour;
}

/** The circuit itself — everything that is not a part or a wire. */
export interface CircuitHeader {
  readonly id: string;
  readonly name: string;
  readonly notes: string;
}

/** A circuit assembled from its three tables, which is what a canvas opens. */
export interface Circuit extends CircuitHeader {
  readonly parts: readonly CircuitPart[];
  readonly wires: readonly CircuitWire[];
}

export type CircuitProblemCode =
  /** Not the right sort of thing at all: a missing field, a wrong type. */
  | "shape"
  /** A string that must identify something and does not. */
  | "id"
  /** Too long to be a label rather than a document. */
  | "length"
  /** A coordinate, rotation or value outside what the canvas can draw. */
  | "range"
  /** Two rows claiming the same id. */
  | "duplicate"
  /** A wire end naming a part this circuit does not contain. */
  | "part"
  /** A pin the part's component does not have. */
  | "pin"
  /** A wire whose two ends are the same pin. */
  | "self"
  /** This build ships no component with that id. NOT a reason to refuse a load. */
  | "component"
  /** A value where the component takes none, or none where it takes one. */
  | "value";

export interface CircuitProblem {
  /** Dotted path, prefixed with the row's id so a failure names the row. */
  readonly field: string;
  readonly code: CircuitProblemCode;
}

/** Every problem with a circuit's own row. */
export function validateCircuitHeader(value: unknown): readonly CircuitProblem[] {
  if (!isRecord(value)) return [{ field: "<root>", code: "shape" }];

  const problems: CircuitProblem[] = [];
  problems.push(...idProblems(value["id"], "id"));
  problems.push(...textProblems(value["name"], "name", MAX_CIRCUIT_NAME_LENGTH, true));
  problems.push(...textProblems(value["notes"], "notes", MAX_CIRCUIT_NOTES_LENGTH, false));
  return problems;
}

/** Every problem with one placed part, WITHOUT consulting the catalogue. */
export function validatePart(value: unknown): readonly CircuitProblem[] {
  if (!isRecord(value)) return [{ field: "<root>", code: "shape" }];

  const problems: CircuitProblem[] = [];
  problems.push(...idProblems(value["id"], "id"));
  problems.push(...idProblems(value["circuitId"], "circuitId"));
  problems.push(...idProblems(value["componentId"], "componentId"));
  // A label may be empty — the canvas falls back to the component's own name,
  // which is what a user who never renamed anything expects to see.
  problems.push(...textProblems(value["label"], "label", MAX_PART_LABEL_LENGTH, false));

  for (const axis of ["x", "y"] as const) {
    const coordinate = value[axis];
    if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) {
      problems.push({ field: axis, code: "shape" });
    } else if (Math.abs(coordinate) > MAX_CANVAS_COORDINATE) {
      problems.push({ field: axis, code: "range" });
    }
  }
  if (!(PART_ROTATIONS as readonly unknown[]).includes(value["rotation"])) {
    problems.push({ field: "rotation", code: "range" });
  }
  // Whether a value is WANTED here is a catalogue question, so it is asked in
  // `circuitProblems`. What is asked of the row alone is that a stated one is a
  // number a canvas can render and an ohm reading can be computed from: zero and
  // negative resistances are not values a user chose.
  const chosen = value["value"];
  if (chosen !== undefined && (typeof chosen !== "number" || !Number.isFinite(chosen) || chosen <= 0)) {
    problems.push({ field: "value", code: "range" });
  }
  return problems;
}

/** Every problem with one wire, WITHOUT consulting the circuit or catalogue. */
export function validateWire(value: unknown): readonly CircuitProblem[] {
  if (!isRecord(value)) return [{ field: "<root>", code: "shape" }];

  const problems: CircuitProblem[] = [];
  problems.push(...idProblems(value["id"], "id"));
  problems.push(...idProblems(value["circuitId"], "circuitId"));

  const ends: WireEnd[] = [];
  for (const side of ["from", "to"] as const) {
    const end = value[side];
    if (!isRecord(end)) {
      problems.push({ field: side, code: "shape" });
      continue;
    }
    const before = problems.length;
    problems.push(...idProblems(end["partId"], `${side}.partId`));
    problems.push(...idProblems(end["pinId"], `${side}.pinId`));
    if (problems.length === before) {
      ends.push({ partId: end["partId"] as string, pinId: end["pinId"] as string });
    }
  }
  // A wire from a pin to itself is not a short, it is a row that means nothing —
  // and it would make the connectivity walk visit a node through an edge back to
  // where it started. Two pins on the SAME part is a different thing entirely
  // and perfectly legal: a jumper across a switch is exactly that.
  const [from, to] = ends;
  if (from !== undefined && to !== undefined && from.partId === to.partId && from.pinId === to.pinId) {
    problems.push({ field: "to", code: "self" });
  }

  if (!(WIRE_COLOURS as readonly unknown[]).includes(value["colour"])) {
    problems.push({ field: "colour", code: "shape" });
  }
  return problems;
}

/**
 * What is wrong with an ASSEMBLED circuit, given the components this build has.
 *
 * Separate from the three validators above because these are the questions no
 * single row can answer, and because the answers are of a different KIND: a
 * `component` problem means „this build does not ship that part", which the
 * canvas draws as a placeholder and names in the margin. It is not a refusal,
 * and nothing here should ever become one — the circuit is the user's work, and
 * a catalogue that shrank between two versions is our problem, not theirs.
 *
 * `resolve` is passed in rather than reaching for `catalogueComponent` directly,
 * so a user-defined component resolves through the same call as a shipped one.
 */
export function circuitProblems(
  circuit: Circuit,
  resolve: (componentId: string) => ComponentDef | undefined,
): readonly CircuitProblem[] {
  const problems: CircuitProblem[] = [];
  const parts = new Map<string, CircuitPart>();

  for (const part of circuit.parts) {
    if (parts.has(part.id)) {
      problems.push({ field: `parts[${part.id}].id`, code: "duplicate" });
      continue;
    }
    parts.set(part.id, part);

    const component = resolve(part.componentId);
    if (component === undefined) {
      problems.push({ field: `parts[${part.id}].componentId`, code: "component" });
      continue;
    }
    // A resistor with no value is 0 Ω to every rule that reads it, and a value
    // on a part that has none is a number the canvas asked for and nothing will
    // ever use. Both look like ordinary rows.
    if ((component.valueUnit !== undefined) !== (part.value !== undefined)) {
      problems.push({ field: `parts[${part.id}].value`, code: "value" });
    }
  }

  const seenWires = new Set<string>();
  for (const wire of circuit.wires) {
    if (seenWires.has(wire.id)) {
      problems.push({ field: `wires[${wire.id}].id`, code: "duplicate" });
      continue;
    }
    seenWires.add(wire.id);

    // `validateWire` already refuses to write one, so this can only be a row
    // that arrived by merge: two devices moved opposite ends of one wire, and
    // field-level LWW took each end from a different writer. Migration 067
    // deliberately has no CHECK against it — see the table's comment — so this
    // is where the user hears about it.
    if (wire.from.partId === wire.to.partId && wire.from.pinId === wire.to.pinId) {
      problems.push({ field: `wires[${wire.id}].to`, code: "self" });
    }

    for (const side of ["from", "to"] as const) {
      const end = wire[side];
      const part = parts.get(end.partId);
      if (part === undefined) {
        problems.push({ field: `wires[${wire.id}].${side}.partId`, code: "part" });
        continue;
      }
      const component = resolve(part.componentId);
      // Silence here is deliberate: the missing component was already reported
      // once, against the part. Reporting it again per wire would bury the one
      // finding under however many wires happen to touch it.
      if (component === undefined) continue;
      if (!component.pins.some((pin) => pin.id === end.pinId)) {
        problems.push({ field: `wires[${wire.id}].${side}.pinId`, code: "pin" });
      }
    }
  }
  return problems;
}

/** A non-empty identifying string. */
function idProblems(value: unknown, field: string): CircuitProblem[] {
  return typeof value === "string" && value.trim().length > 0 ? [] : [{ field, code: "id" }];
}

/** A string, optionally required to be non-blank, and bounded. */
function textProblems(
  value: unknown,
  field: string,
  max: number,
  required: boolean,
): CircuitProblem[] {
  if (typeof value !== "string") return [{ field, code: "shape" }];
  if (required && value.trim().length === 0) return [{ field, code: "shape" }];
  return value.length > max ? [{ field, code: "length" }] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

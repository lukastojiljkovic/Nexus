/**
 * The Arduino sketch a wired circuit implies — slice E4 of ADR-085.
 *
 * **What this generates, stated plainly, because the honest boundary is the
 * whole design.** It emits the WIRING: a named constant for every board pin a
 * peripheral is actually wired to, the `pinMode` each of those pins needs, the
 * bus initialisation the circuit calls for, and a `loop` that reads back every
 * input so the user can see on the serial monitor whether the bench is really
 * connected the way the canvas says. It does NOT emit the program. „Read the
 * distance and stop the motor under 20 cm" is a decision nobody but the user
 * has made, and a generator that invented one would be handing back a guess
 * with the authority of generated code.
 *
 * That boundary is not modesty, it is the only line that can be drawn without
 * fabricating. Everything above it is DERIVED — from the catalogue's pin
 * functions and from `boardWiring`, which stands on the same `buildNets` the
 * rules engine reads (ADR-085 §2: E4 must not re-derive connectivity, or the
 * day the two disagree the user gets code contradicting the warning on their
 * screen). Everything below it would have to be invented.
 *
 * **The libraries are named, not included.** The catalogue's `library` field
 * holds a LIBRARY MANAGER name — „DHT sensor library", „Adafruit ST7735 and
 * ST7789 Library" — and a header filename is not derivable from one:
 * `DHT sensor library` ships `DHT.h`, and no rule takes you from the first
 * string to the second. So the sketch lists what to install, in the form the
 * user types into the IDE, and does not write an `#include` it would be
 * guessing at. `Wire.h` and `SPI.h` ARE included, because those two are the
 * Arduino core's own and their names are facts rather than inferences.
 *
 * **A pin whose part declares a library is left entirely alone** — no
 * `pinMode`, no read. That pin is spoken to by a protocol the library owns
 * (a DHT22's DATA line is neither an input nor an output; it is both, in a
 * timed sequence), and a `digitalRead` on it would produce a number that looks
 * like a reading and is noise.
 */

import type { Circuit } from "./circuit.js";
import type { ComponentDef } from "./component.js";
import { slugify } from "../devtools/text.js";
import {
  boardWiring,
  identifier,
  soleBoard,
  uniqueName,
  type BoardWire,
  type Placed,
} from "./wiring.js";

/** Why a circuit produced no sketch. Never a failure — see {@link generateSketch}. */
export type SketchRefusal =
  /** Nothing in the circuit is a board, so there is nothing to program. */
  | "no-board"
  /** More than one board, and a sketch is one program for one of them. */
  | "many-boards"
  /** The board runs an operating system; a `.ino` is the wrong artefact for it. */
  | "not-programmable";

/** One wire's worth of the connection table, in the order the header prints it. */
export interface SketchConnection {
  /** The board pin's id, as the catalogue spells it: `D9`, `A0`, `GPIO23`. */
  readonly boardPin: string;
  /** The part the other end belongs to, by its label or its catalogue name. */
  readonly part: string;
  readonly partPin: string;
  /** The `constexpr` this pin got, or `undefined` where the part's library owns it. */
  readonly constant: string | undefined;
}

export type Sketch =
  | {
      readonly kind: "sketch";
      /** `merenje-razdaljine.ino` — slugged from the circuit's name. */
      readonly filename: string;
      readonly source: string;
      /** What the header table says, exposed so a panel can show it without re-parsing. */
      readonly connections: readonly SketchConnection[];
      /** Library Manager names to install, sorted, deduplicated. */
      readonly libraries: readonly string[];
    }
  | { readonly kind: "refused"; readonly reason: SketchRefusal };

/**
 * The sketch for a circuit, or the reason there is not one.
 *
 * Refusing is a first-class answer rather than an error: „this circuit has two
 * boards" is a true and useful thing to say on screen, and a thrown exception
 * would make the panel choose between showing nothing and showing a stack.
 *
 * `resolve` is passed in for the reason every other function in this module
 * takes it: a component the user defined themselves is read through the same
 * call as a shipped one.
 */
export function generateSketch(
  circuit: Circuit,
  resolve: (componentId: string) => ComponentDef | undefined,
): Sketch {
  const chosen = soleBoard(circuit, resolve);
  if (chosen.kind === "refused") return { kind: "refused", reason: chosen.reason };

  const { board, placed } = chosen;
  if (board.component.programming !== "arduino") {
    return { kind: "refused", reason: "not-programmable" };
  }

  const wired = signalPins(circuit, resolve, placed, board);
  const libraries = [
    ...new Set(
      placed
        .map((entry) => entry.component.library)
        .filter((library): library is string => library !== undefined),
    ),
  ].sort();

  return {
    kind: "sketch",
    filename: `${slugify(circuit.name, { maxLength: 60 }) || "kolo"}.ino`,
    source: render(circuit, board, wired, libraries),
    connections: wired.map((entry) => ({
      boardPin: entry.boardPin.id,
      part: entry.partName,
      partPin: entry.partPin.label,
      constant: entry.constant,
    })),
    libraries,
  };
}

// ---------------------------------------------------------------------------
// The model the renderer below walks
// ---------------------------------------------------------------------------

/**
 * A {@link BoardWire} in Arduino's dialect.
 *
 * The four added fields are the whole of what this generator knows that
 * `wiring.ts` deliberately does not: how a pin id is spelled in C, what a name
 * for it would be, and the two `setup`/`loop` verbs. Everything else on the row
 * — which pins are joined, which way each faces, who owns the line — arrives
 * already derived, from the same table the ROS 2 generator reads.
 */
interface WiredPin extends BoardWire {
  /** `PIN_HC_SR04_TRIG`, or `undefined` for a bus, a library's pin, or a shared line. */
  readonly constant: string | undefined;
  /** The Arduino literal: `9` for `D9`, `A0` for `A0`, `23` for `GPIO23`. */
  readonly literal: string;
  /** What `setup` should do, or `undefined` to leave the pin alone. */
  readonly mode: "INPUT" | "OUTPUT" | undefined;
  /** How `loop` should read it back, or `undefined` where it must not. */
  readonly read: "digitalRead" | "analogRead" | undefined;
}

/** A {@link WiredPin} the sketch gave a name to, so the renderer needs no `??`. */
interface NamedPin extends WiredPin {
  readonly constant: string;
}

function isNamed(entry: WiredPin): entry is NamedPin {
  return entry.constant !== undefined;
}

/** A {@link NamedPin} `loop` reads back. Same reason: a `??` here would emit `(PIN_X)`. */
interface ReadPin extends NamedPin {
  readonly read: "digitalRead" | "analogRead";
}

function isRead(entry: NamedPin): entry is ReadPin {
  return entry.read !== undefined;
}

function signalPins(
  circuit: Circuit,
  resolve: (componentId: string) => ComponentDef | undefined,
  placed: readonly Placed[],
  board: Placed,
): WiredPin[] {
  const taken = new Set<string>();
  return boardWiring(circuit, resolve, placed, board).map((wire) => {
    // A wire someone else owns gets no constant, no `pinMode` and no read: a
    // name would claim this generator speaks the protocol on that line, and the
    // three ways that happens are exactly `BoardWire.owner`.
    const constant = wire.owner === undefined ? constantFor(wire, taken) : undefined;
    return {
      ...wire,
      constant,
      literal: pinLiteral(wire.boardPin.id),
      mode: constant === undefined ? undefined : ARDUINO_MODE[wire.direction ?? "none"],
      read: constant === undefined ? undefined : boardRead(wire),
    };
  });
}

/** `wiring.ts` speaks of a pin's direction; `setup` speaks of its mode. */
const ARDUINO_MODE = {
  in: "INPUT",
  out: "OUTPUT",
  none: undefined,
} as const;

/**
 * `PIN_SENZOR_TRIG`, and never the same name twice.
 *
 * C's dialect of {@link identifier}: the same folding, then uppercased, which
 * also lifts the empty-name fallback to `PIN` and the digit guard to `P`.
 */
function constantFor(wire: BoardWire, taken: Set<string>): string {
  const part = identifier(wire.partName, "pin").toUpperCase();
  const pin = identifier(wire.partPin.label || wire.partPin.id, "pin").toUpperCase();
  return uniqueName(`PIN_${part}_${pin}`, taken);
}

/**
 * `D9` → `9`, `A0` → `A0`, `GPIO23` → `23`, `GP15` → `15`.
 *
 * One rule and no per-board table. Everything but an analogue pin is a plain
 * number on every Arduino core there is; `A0`…`A7` are core-defined constants
 * whose numeric values differ per board, so the NAME is the portable spelling
 * and the number would be a board-specific guess. A pin id that is not
 * letters-then-digits is passed through — a hand-written component may spell
 * its pins however it likes, and a wrong literal the user can see and fix beats
 * a silently dropped line.
 */
function pinLiteral(pinId: string): string {
  const match = /^([A-Za-z]+)([0-9]+)$/.exec(pinId);
  if (match === null) return pinId;
  return match[1] === "A" ? pinId : (match[2] ?? pinId);
}

/**
 * How `loop` reads a pin back, or `undefined` where it must not read at all.
 *
 * Only pins the board LISTENS to are read; an output is not read back, and
 * driving one on the user's behalf is the one thing a generated sketch must
 * never do — a servo swept or a relay closed by a program nobody wrote is a
 * machine moving for no reason.
 */
function boardRead(wire: BoardWire): "digitalRead" | "analogRead" | undefined {
  if (wire.direction !== "in") return undefined;
  if (wire.partPin.functions.includes("analog-out")) {
    return wire.boardPin.functions.includes("analog-in") ? "analogRead" : undefined;
  }
  return "digitalRead";
}

/**
 * Which of the board's own hardware buses the wiring actually brings up.
 *
 * A fold over what `boardWiring` already worked out per wire, which is where
 * both ends of it were in hand. `Wire.begin()` starts the hardware I²C
 * controller, and that controller exists only where the board's SDA/SCL meet a
 * peripheral that says it speaks I²C: a BMP280 bit-banged onto D7 is a
 * legitimate circuit the rules engine deliberately allows, and an HC-SR04 on
 * D10/D11 is not SPI merely because those two holes can also be SPI.
 */
function busesUsed(wired: readonly WiredPin[]): { i2c: boolean; spi: boolean; uart: boolean } {
  const shared = new Set(wired.flatMap((entry) => entry.buses));
  return { i2c: shared.has("i2c"), spi: shared.has("spi"), uart: shared.has("uart") };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * A user-supplied name, made safe for the comment it is about to land in.
 *
 * **Every name in this file comes from outside it.** A part's label is any
 * string up to 120 characters (`textProblems` bounds the length and nothing
 * else), a circuit's name is any string up to 200, and a component may be one
 * the user defined rather than one the catalogue ships. Interpolated raw, a
 * label carrying a star-slash closes the header comment early and turns the
 * rest of the connection table into code, and a label carrying a newline pushes
 * whatever follows out of a line comment. Neither is an attack — it is the
 * user's own machine and their own label — but both produce a file that does
 * not compile, from a generator whose entire value is that its output does.
 *
 * The identifiers and the serial labels need none of this: both are built by
 * `slugify`, whose output is `[A-Za-z0-9]` and separators by construction. This
 * is the escape for the places where the text is printed as written.
 *
 * One pass, and a space between every adjacent star and slash in EITHER order.
 * Slash-star is caught too: it does not end a comment, but it does make the
 * compiler warn about one nested inside another. Every replacement ends in the
 * space it inserted, so no pass can create the pair the next pass would have to
 * catch — which is what makes one pass enough rather than merely usually
 * enough.
 *
 * The pair is spelled out in words here rather than quoted, for the reason this
 * function exists: written literally, it would have ended THIS comment. It did,
 * on the first draft.
 */
function commentSafe(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\*(?=\/)|\/(?=\*)/g, "$& ");
}

/** The default when a board declares a UART with no baud of its own. */
const FALLBACK_BAUD = 9600;

/** Between reads, in milliseconds. Slow enough to read on a serial monitor. */
const LOOP_DELAY_MS = 1000;

function render(
  circuit: Circuit,
  board: Placed,
  wired: readonly WiredPin[],
  libraries: readonly string[],
): string {
  const buses = busesUsed(wired);
  const baud =
    board.component.buses.flatMap((bus) => (bus.kind === "uart" ? [bus.baud] : []))[0] ??
    FALLBACK_BAUD;
  const lines: string[] = [];

  // --- Header ------------------------------------------------------------
  lines.push("/*");
  lines.push(` * ${commentSafe(circuit.name)} — ${commentSafe(board.component.name)}`);
  lines.push(" *");
  lines.push(" * Ovaj fajl opisuje VEZE, ne program. Pinovi, njihovi smerovi i");
  lines.push(" * magistrale izvedeni su iz šeme; šta uređaj radi je na tebi.");
  lines.push(" * Petlja ispod samo očitava ulaze, da se na serijskom monitoru vidi");
  lines.push(" * da li je sve zaista povezano onako kako šema kaže.");
  if (libraries.length > 0) {
    lines.push(" *");
    lines.push(" * Biblioteke (Arduino IDE → Sketch → Include Library → Manage Libraries):");
    for (const library of libraries) lines.push(` *   ${commentSafe(library)}`);
  }
  if (wired.length > 0) {
    lines.push(" *");
    lines.push(" * Veze:");
    for (const entry of wired) {
      const target = `${commentSafe(entry.partName)} · ${commentSafe(entry.partPin.label)}`;
      lines.push(` *   ${commentSafe(entry.boardPin.label)} → ${target}`);
    }
  }
  lines.push(" */");
  lines.push("");

  // --- Includes ----------------------------------------------------------
  // Only the core's own two. A peripheral library's HEADER is not derivable
  // from its Library Manager name, so it is named in the comment above and
  // never guessed at here.
  if (buses.i2c) lines.push("#include <Wire.h>");
  if (buses.spi) lines.push("#include <SPI.h>");
  if (buses.i2c || buses.spi) lines.push("");

  // --- Pin constants -----------------------------------------------------
  const named = wired.filter(isNamed);
  if (named.length > 0) {
    for (const entry of named) {
      lines.push(`constexpr uint8_t ${entry.constant} = ${entry.literal};`);
    }
    lines.push("");
  }

  // --- setup -------------------------------------------------------------
  lines.push("void setup() {");
  // The hardware UART is the port the serial monitor is on. A peripheral wired
  // to it shares that port with the readings printed below, which is a real
  // collision on a one-UART board and looks, on screen, like a sensor sending
  // gibberish. Said rather than worked around: which port a device should move
  // to is the user's decision, and the sketch's job is to make the conflict
  // visible before it is puzzling.
  if (buses.uart) {
    const sharing = [
      ...new Set(
        wired
          .filter((entry) => entry.buses.includes("uart"))
          .map((entry) => commentSafe(entry.partName)),
      ),
    ];
    lines.push(`  // Pažnja: ${sharing.join(", ")} deli hardverski UART sa serijskim monitorom.`);
  }
  lines.push(`  Serial.begin(${baud});`);
  if (buses.i2c) lines.push("  Wire.begin();");
  if (buses.spi) lines.push("  SPI.begin();");
  for (const entry of named) {
    if (entry.mode === undefined) continue;
    lines.push(`  pinMode(${entry.constant}, ${entry.mode});`);
  }
  lines.push("}");
  lines.push("");

  // --- loop --------------------------------------------------------------
  const readable = named.filter(isRead);
  lines.push("void loop() {");
  if (readable.length === 0) {
    lines.push("  // Nijedan pin se ovde ne očitava: ili su izlazi, ili ih vodi biblioteka.");
  }
  for (const entry of readable) {
    lines.push(`  Serial.print("${serialLabel(entry)}: ");`);
    lines.push(`  Serial.println(${entry.read}(${entry.constant}));`);
  }
  lines.push(`  delay(${LOOP_DELAY_MS});`);
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

/**
 * The label a reading is printed under.
 *
 * Folded to ASCII, because it goes inside a C string literal that the serial
 * monitor prints: „vlažnost" through a default 8-bit terminal is „vla?nost",
 * and a legible `vlaznost` is worth more than a diacritic nobody will see.
 *
 * **Both branches are `slugify` output**, which is why this needs no escape the
 * way {@link commentSafe} does. A label of nothing but punctuation slugs to the
 * empty string, and the fallback is the constant rather than the pin's own
 * label — a pin label is catalogue text, a quote or a backslash in it would end
 * this string literal early, and the constant is `[A-Z0-9_]` by construction.
 * The hole is closed by having nothing else to fall back to.
 */
function serialLabel(entry: NamedPin): string {
  const name = slugify(`${entry.partName} ${entry.partPin.label}`, {
    separator: " ",
    lowercase: false,
    maxLength: 40,
  });
  return name === "" ? entry.constant : name;
}

/**
 * What a board is wired to — the derived table every code generator reads.
 *
 * ADR-085 §2 says E4 must not re-derive connectivity, and this module is the
 * second half of that rule. `buildNets` already answers „which pins are joined";
 * this answers the question a GENERATOR asks, which is different: for one board
 * in one circuit, which of its pins carry signal, what is on the other end of
 * each, which way does that pin face, and — the part that decides whether any
 * code may be emitted for it at all — does the board speak to that pin itself.
 *
 * It exists as its own module because there are two generators and there will
 * be a third. The Arduino sketch and the ROS 2 package differ in everything
 * they PRINT and in nothing they KNOW, and the day the two derive the same fact
 * separately is the day one of them is wrong about a circuit the other renders
 * correctly. So the knowing is here, once, and the printing is theirs.
 *
 * Nothing in this file is platform-specific: no `pinMode`, no `constexpr`, no
 * BCM numbering. {@link BoardWire.direction} says „in" and „out" rather than
 * „INPUT" and „OUTPUT" for exactly that reason — the moment this file spells a
 * word from one platform's dialect, the other platform's generator has to
 * translate back out of it.
 */

import type { Circuit, CircuitPart } from "./circuit.js";
import type { BusKind, ComponentDef, Pin } from "./component.js";
import { PIN_FLOW, pinBuses } from "./component.js";
import { slugify } from "../devtools/text.js";
import { buildNets } from "./nets.js";

/** A part of the circuit whose component the catalogue could resolve. */
export interface Placed {
  readonly part: CircuitPart;
  readonly component: ComponentDef;
  /** What the user calls it: their own label, or the catalogue's name. */
  readonly name: string;
}

/**
 * The circuit's parts, resolved and named, in the order they were placed.
 *
 * A part whose component no longer resolves is dropped rather than reported: a
 * user-defined component can be deleted while a circuit still references it,
 * and the canvas already draws that part as unknown. A generator's job is to
 * describe what it can read, not to re-report what the screen has said.
 */
export function placedParts(
  circuit: Circuit,
  resolve: (componentId: string) => ComponentDef | undefined,
): Placed[] {
  const placed: Placed[] = [];
  const seen = new Set<string>();
  for (const part of circuit.parts) {
    if (seen.has(part.id)) continue;
    seen.add(part.id);
    const component = resolve(part.componentId);
    if (component === undefined) continue;
    const label = part.label.trim();
    placed.push({ part, component, name: label === "" ? component.name : label });
  }
  return placed;
}

/**
 * The one board a generated artefact belongs to, or why there is not one.
 *
 * Both refusals are true statements about the circuit rather than errors, which
 * is why they are values: „this circuit has two boards" is a sentence a panel
 * can show, and a thrown exception would leave it choosing between showing
 * nothing and showing a stack. Each generator adds its own third refusal on top
 * — a `.ino` is wrong for a board that runs Linux, and a ROS 2 package is wrong
 * for one that does not — because that refusal names an ARTEFACT, and this
 * module knows about circuits.
 */
export type BoardChoice =
  | { readonly kind: "board"; readonly board: Placed; readonly placed: readonly Placed[] }
  | { readonly kind: "refused"; readonly reason: "no-board" | "many-boards" };

export function soleBoard(
  circuit: Circuit,
  resolve: (componentId: string) => ComponentDef | undefined,
): BoardChoice {
  const placed = placedParts(circuit, resolve);
  const boards = placed.filter((entry) => entry.component.kind === "board");
  const board = boards[0];
  if (boards.length === 0 || board === undefined) return { kind: "refused", reason: "no-board" };
  if (boards.length > 1) return { kind: "refused", reason: "many-boards" };
  return { kind: "board", board, placed };
}

/**
 * Why a generator must leave a pin alone, or `undefined` where it may act.
 *
 * Each of the three is a different way of saying „the code you would write here
 * is code for a protocol you do not implement", and all three are worth telling
 * apart: they are the sentence a panel or a README prints next to the pin, and
 * „ovim pinom upravlja biblioteka" and „pin deli liniju sa još jednim delom"
 * send the user to different places.
 */
export type WireOwner =
  /** A bus line — it belongs to the controller, not to one pin's worth of code. */
  | "bus"
  /** The part declares a driver library, which owns the timing on this wire. */
  | "library"
  /** More than one peripheral sits on this board pin; no single part owns it. */
  | "shared";

/**
 * One board pin joined to one peripheral pin — a row of the connection table.
 *
 * Every wire that reaches the board becomes one of these, INCLUDING the ones no
 * generator will emit code for. The table is what a person reads at the bench,
 * and a table that quietly omitted the I²C pair would be describing a different
 * circuit from the one on the canvas. What varies is {@link owner}.
 */
export interface BoardWire {
  readonly boardPin: Pin;
  readonly partName: string;
  readonly partPin: Pin;
  /** The peripheral's Library Manager name, where it declares one. */
  readonly library: string | undefined;
  /**
   * The buses **both ends** declare — see `pinBuses` for why one end is never
   * enough. Empty for an ordinary wire, which is most of them. This is the
   * hardware controller: a BMP280 bit-banged onto D7 is software I²C, so its
   * {@link owner} is `"bus"` and this list is still empty.
   */
  readonly buses: readonly BusKind[];
  /** Set where the board must not speak to this pin itself. */
  readonly owner: WireOwner | undefined;
  /** The direction of the BOARD's pin, which is the opposite of the part's. */
  readonly direction: "in" | "out" | undefined;
}

/**
 * Power and ground carry no signal: no generator names the 5 V rail, and
 * pretending otherwise would fill every artefact with lines that do nothing.
 */
const NOT_A_SIGNAL = new Set(["power-in", "power-out", "gnd"]);

/**
 * Every signal wire that reaches the board, in board-pin order.
 *
 * The ordering is the catalogue's own pin order rather than anything derived,
 * so a header table reads down the board the way the board is printed.
 */
export function boardWiring(
  circuit: Circuit,
  resolve: (componentId: string) => ComponentDef | undefined,
  placed: readonly Placed[],
  board: Placed,
): BoardWire[] {
  const nets = buildNets(circuit, resolve);
  const byId = new Map(placed.map((entry) => [entry.part.id, entry]));
  const wired: BoardWire[] = [];

  for (const boardPin of board.component.pins) {
    if (boardPin.functions.some((fn) => NOT_A_SIGNAL.has(fn))) continue;
    const net = nets.at(board.part.id, boardPin.id);
    if (net === undefined) continue;

    // Every peripheral pin on this net, the board's own excluded. Several means
    // a shared line — an I²C bus, or two parts on one output — and each of them
    // is still a row of the table.
    const others = net.pins.flatMap((ref) => {
      if (ref.partId === board.part.id) return [];
      const owner = byId.get(ref.partId);
      const partPin = owner?.component.pins.find((pin) => pin.id === ref.pinId);
      return owner === undefined || partPin === undefined ? [] : [{ owner, partPin }];
    });

    const boardRoles = pinBuses(boardPin);
    for (const { owner, partPin } of others) {
      // Only the PERIPHERAL is asked whether this is a bus line — see
      // `pinBuses`. A part's pin says what the wire carries; a board's pin says
      // only what that hole on the header is capable of, and on every board in
      // the catalogue every bus pin is capable of being an ordinary GPIO too.
      const partRoles = pinBuses(partPin);
      wired.push({
        boardPin,
        partName: owner.name,
        partPin,
        library: owner.component.library,
        // The hardware controller is in play only where both ends agree. A
        // BMP280's SDA on D7 is software I²C — ordinary practice, which the
        // rules engine deliberately allows — and `Wire.begin()` there would
        // describe a peripheral that is not being used.
        buses: [...partRoles].filter((role) => boardRoles.has(role)),
        owner:
          partRoles.size > 0
            ? "bus"
            : owner.component.library !== undefined
              ? "library"
              : others.length > 1
                ? "shared"
                : undefined,
        direction: boardDirection(partPin),
      });
    }
  }
  return wired;
}

/**
 * The direction of the BOARD's pin, which is the opposite of the peripheral's.
 *
 * A part whose pin can only drive (a comparator's `digital-out`) makes the
 * board an input; a part that can only listen (an LED's anode, a relay's IN)
 * makes it an output. A pin that does both is the DHT22 shape — a protocol, not
 * a direction — and gets none, because either answer would be wrong half the
 * time. So does a pin that says only what it carries: `pwm` alone is a waveform
 * with no end named, and `PIN_FLOW` is where that is decided once for every
 * reader rather than in a hand-written list here.
 */
function boardDirection(partPin: Pin): "in" | "out" | undefined {
  const drives = partPin.functions.some((fn) => PIN_FLOW[fn] === "drives");
  const listens = partPin.functions.some((fn) => PIN_FLOW[fn] === "listens");
  if (drives && listens) return undefined;
  if (drives) return "in";
  if (listens) return "out";
  return undefined;
}

/**
 * Serbian text as an identifier: „Senzor vlažnosti" becomes `senzor_vlaznosti`.
 *
 * `slugify` does the folding — the same one the search index uses, rather than
 * a second table of `š→s` that would drift from it. What is added here is the
 * part a programming language cares about and a URL does not: an identifier may
 * not start with a digit, and it may not be empty. Lowercase, because that is
 * what both targets want at the bottom — Python and ROS 2 require it, and the
 * sketch's `SCREAMING_CASE` is one `.toUpperCase()` away.
 */
export function identifier(text: string, fallback: string, maxLength = 24): string {
  const slug = slugify(text, { separator: "_", lowercase: true, maxLength });
  if (slug === "") return fallback;
  return /^[0-9]/.test(slug) ? `p${slug}` : slug;
}

/**
 * A name nothing else has taken, remembering what it handed out.
 *
 * Two parts of one kind with no labels are the ordinary case — „LED dioda" and
 * „LED dioda" — and two constants of one name is a file that does not compile,
 * exactly as two ROS topics of one name is a node that publishes one of them
 * twice. The suffix counts from 2 so the first of a pair keeps the clean name.
 */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    return candidate;
  }
}

/**
 * The number in a pin's id — `D9` → 9, `GPIO23` → 23 — or `undefined`.
 *
 * For the targets that need an INTEGER rather than a token: gpiozero's
 * `DigitalInputDevice(23)` takes a BCM number, and there is no spelling of a
 * non-numeric pin id it would accept. A hand-written component may name its
 * pins anything at all, so „this pin has no number" is a real answer and the
 * caller is made to handle it rather than being handed a `NaN` to print.
 */
export function pinNumber(pinId: string): number | undefined {
  const match = /^[A-Za-z]*([0-9]+)$/.exec(pinId);
  if (match?.[1] === undefined) return undefined;
  return Number.parseInt(match[1], 10);
}

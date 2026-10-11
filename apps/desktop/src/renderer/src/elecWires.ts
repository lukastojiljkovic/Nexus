/**
 * Everything the bench and the page know about a jumper that is not geometry:
 * the colour one gets when nothing has been chosen, the order the keyboard
 * walks the wires in, what a wire is called, and which key does what.
 *
 * **A module of its own because this is the half a test can reach.** Vitest runs
 * in a Node environment with no DOM in this repository
 * (`apps/desktop/vitest.config.ts`), so a rule that had to read real elements —
 * which wire the arrow keys move to, what a screen reader hears, what Delete
 * does — could not be pinned anywhere. What lives here is pure: the bench hands
 * in facts it has already resolved and turns the answers back into DOM calls.
 *
 * **The order is the whole design, so it is decided here and once.** A bench of
 * two hundred jumpers is two hundred small targets on one canvas, and neither
 * the tab order nor the reading order can be left to the DOM: the wires are
 * sorted (see `wireFocusOrder`), the group takes ONE tab stop
 * (`wireTabStop`), and the arrows walk the sorted list.
 */

import type { WireColour } from "@nexus/core";

import type { ElecPoint } from "./elecGeometry.js";
import { firstFocusableIndex, lastFocusableIndex, nextFocusableIndex } from "./focusOrder.js";
import type { FocusCandidate } from "./focusOrder.js";
import { fill, strings } from "./strings.js";

/**
 * The colour a jumper gets when nothing has been chosen — ground is the wire
 * everybody runs first, and it is also the colour a wire is not named by (see
 * `wireName`). The bench's own swatch row reads it, and so does every wire the
 * page creates.
 */
export const DEFAULT_WIRE_COLOUR: WireColour = "black";

/**
 * A wire as the focus order reads it: the position of its first end, in circuit
 * units. The order hands the caller's own objects back, so both callers carry
 * whatever else they need beside it: the bench its wire and its two resolved
 * ends, a test its ids.
 */
export interface WireFocusEntry {
  readonly anchor: ElecPoint;
}

/**
 * The order the keyboard walks the wires in.
 *
 * **By the position of each wire's FIRST end, top to bottom and then left to
 * right** — the order a person reads a schematic in, and therefore the only one
 * in which "the next wire" means something to the person pressing the key. The
 * first end rather than the nearer of the two, and rather than the middle: a
 * wire has two ends and no centre anybody can point at, `from` is the end the
 * document itself names first, and an end picked per wire (the nearer one, say)
 * would move that wire in the order every time a part moved.
 *
 * **Stable when nothing moves.** Two wires whose first ends coincide keep the
 * order they arrive in (`Array.prototype.sort` is stable, and the array handed
 * in is the circuit's own `(created_at, id)` order), which matters more than it
 * sounds: a focus order that reshuffled two equal wires between renders would
 * move focus out from under the user's hands, and nothing on screen would say
 * why. The entries come back rather than their ids so the caller gets the very
 * objects it handed in.
 *
 * The caller passes only the wires it can DRAW: a wire with an end that no
 * longer resolves is not on the bench, is named in the margin instead, and is
 * not a thing to put a keyboard on.
 */
export function wireFocusOrder<T extends WireFocusEntry>(entries: readonly T[]): readonly T[] {
  return [...entries].sort((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x);
}

/**
 * Which wire carries the group's single tab stop: the one focus was last on, or
 * the first when focus has never been in the group or was on a wire that has
 * since gone. `null` for a circuit with no drawable wire, where there is no tab
 * stop to give and the group costs the keyboard nothing.
 */
export function wireTabStop(ids: readonly string[], focusedId: string | null): string | null {
  if (focusedId !== null && ids.includes(focusedId)) return focusedId;
  return ids[0] ?? null;
}

/**
 * What a key does to the wire focus is on.
 *
 * **Enter and Space SELECT, which is what a pointer click does** — the same
 * selection state, the same panel on the right, so the two ways of choosing a
 * wire cannot drift apart. Neither is an "activate": a wire has no second
 * action for Enter to mean.
 *
 * **The four arrows move one wire at a time, all in the same list.** This is a
 * flat order and not a grid, so ArrowUp and ArrowLeft both mean "the one
 * before": pretending the bench's two dimensions were navigable would need a
 * row model this canvas does not have, and the drawn order is the one a reader
 * follows.
 *
 * **Escape is `leave`, not a dismissal of its own.** It hands focus back to the
 * bench, and the page's own Escape — which unwinds an armed pin and then a
 * selection — runs as it always has. Tab is deliberately not here: the group
 * must never swallow the key that gets out of it.
 */
export type WireKeyIntent =
  | "select"
  | "remove"
  | "leave"
  | "previous"
  | "next"
  | "first"
  | "last";

export function wireKeyIntent(key: string): WireKeyIntent | null {
  switch (key) {
    case "Enter":
    case " ":
      return "select";
    case "Delete":
    case "Backspace":
      return "remove";
    case "Escape":
      return "leave";
    case "ArrowUp":
    case "ArrowLeft":
      return "previous";
    case "ArrowDown":
    case "ArrowRight":
      return "next";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}

/** Every wire in the group is reachable: nothing here is disabled, hidden, or out of the tab order. */
const REACHABLE: FocusCandidate = { tabIndex: 0, disabled: false, hidden: false };

/**
 * The wire focus moves to, or `null` for the intents that move nothing
 * (`select`, `remove`, `leave`).
 *
 * The index arithmetic is `focusOrder.ts`'s — the same one the modal trap's Tab
 * and the popover menu's arrows move on, rather than a second modulo that would
 * have to be told about wrapping separately. So the arrows wrap at both ends,
 * which is what a composite widget does, and a `currentId` that is no longer in
 * the list (the wire was deleted a moment ago) is "nothing focused" to that
 * arithmetic: forward lands on the first, backward on the last.
 */
export function wireFocusTarget(
  ids: readonly string[],
  currentId: string,
  intent: WireKeyIntent,
): string | null {
  const candidates: readonly FocusCandidate[] = ids.map(() => REACHABLE);
  const current = ids.indexOf(currentId);
  let target: number | null;
  switch (intent) {
    case "previous":
      target = nextFocusableIndex(candidates, current, -1);
      break;
    case "next":
      target = nextFocusableIndex(candidates, current, 1);
      break;
    case "first":
      target = firstFocusableIndex(candidates);
      break;
    case "last":
      target = lastFocusableIndex(candidates);
      break;
    default:
      return null;
  }
  return target === null ? null : (ids[target] ?? null);
}

/**
 * Where focus goes when the wire it is on is removed: the wire AFTER it, and
 * when there is none the one before — the pair every list in this app uses.
 *
 * Not `next`, which wraps: deleting the last jumper would otherwise throw the
 * user back to the first, across the whole bench, for a key pressed to do the
 * opposite of moving. `null` is a circuit whose last wire just went.
 */
export function wireFocusAfterRemoval(ids: readonly string[], removedId: string): string | null {
  const index = ids.indexOf(removedId);
  if (index < 0) return wireTabStop(ids, null);
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

/** One end of a wire as a reader hears it: the part's own name, and the label printed beside its pin. */
export interface WireEndNames {
  readonly part: string;
  readonly pin: string;
}

/**
 * What a screen reader hears for a wire: its two ends and, when it is not the
 * default colour, that colour.
 *
 * **Named the way everything else on this bench is named.** A part's own
 * `aria-label` is its reference designator (`partDisplayName`) and a pin's is
 * that name plus `pinLabel`, so a wire's name is built from the same two
 * ingredients rather than from a third vocabulary invented here.
 *
 * **The colour is in the name because on this surface the colour IS data**
 * (DEV-006): black is ground and red is supply, and a reader who cannot see the
 * bench has no other way to know which jumper they are on. It is left out when
 * the wire is the default colour, because then it carries no information and a
 * name that recites it would only make every wire longer to hear.
 *
 * The sentences are the table's and are assembled with `fill`; nothing is built
 * by concatenating fragments here, which is what `check:address` and the two
 * copy tables can actually read.
 */
export function wireName(from: WireEndNames, to: WireEndNames, colour: WireColour): string {
  const s = strings.electronics.bench;
  const name = fill(s.wireName, {
    fromPart: from.part,
    fromPin: from.pin,
    toPart: to.part,
    toPin: to.pin,
  });
  return colour === DEFAULT_WIRE_COLOUR
    ? name
    : `${name}${fill(s.wireColourSuffix, { colour: s.colours[colour] })}`;
}

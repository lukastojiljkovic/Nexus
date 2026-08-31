/**
 * What is electrically connected to what — the derived fact E3, E4 and E5 all
 * read, and none of them re-derives.
 *
 * A wire joins two pins; connectivity is TRANSITIVE, and that is the whole
 * reason this file exists rather than each rule walking `circuit.wires` for
 * itself. „Is this sensor on the 5 V rail?" is not a question about a wire. The
 * sensor's VCC may reach the board's 5V pin through a breadboard rail, through
 * a second module's VCC, through four wires the user drew in a different order
 * — and a rule that only looked at wires touching the sensor would answer „no
 * supply" for a circuit that is correctly built. So the wires are collapsed
 * once, here, into NETS: sets of pins that are one electrical node.
 *
 * **This file states facts and judges nothing.** A net carrying both 5 V and
 * 3.3 V is reported as a net with two rails, not as an error; `rules.ts` is
 * where a fact becomes a finding. The split is deliberate and it is what
 * ADR-085 §2 means by „E3 comes before E4 and E5": the sketch generator needs
 * to know which pin carries what, and if it re-derived that for itself, the day
 * the two implementations disagreed the user would get generated code that
 * contradicts the warning on their own screen.
 *
 * **Every pin of every placed part is a node, wired or not.** An unwired pin is
 * a net of one. That costs a little memory and buys the distinction the rules
 * actually need: `at()` returning a lone net means „this pin is connected to
 * nothing", while `at()` returning `undefined` means „no placed part has that
 * pin at all". A missing supply and a pin nobody has ever heard of are different
 * findings, and a model that could not tell them apart would report one of them
 * as the other.
 */

import type { Circuit, CircuitPart } from "./circuit.js";
import type { ComponentDef, Pin } from "./component.js";

/** One pin of one placed part. The node the net list is built out of. */
export interface PinRef {
  readonly partId: string;
  readonly pinId: string;
}

/** One electrical node: every pin that is connected to every other pin here. */
export interface Net {
  /**
   * Index into {@link CircuitNets.nets}. Stable for one call over one circuit,
   * and deliberately NOT stable across edits — it is a handle for a finding to
   * carry within one pass, never something to store.
   */
  readonly id: number;
  /** Sorted by part then pin, so the same circuit always yields the same list. */
  readonly pins: readonly PinRef[];
  /**
   * The distinct volts DRIVEN onto this net, ascending — one entry per
   * `power-out` pin voltage present.
   *
   * Empty for an ordinary signal net. Two entries means two supplies are shorted
   * together, which is a fact this file records and `rules.ts` judges.
   */
  readonly rails: readonly number[];
  /** True when any pin on the net is a `gnd`. */
  readonly ground: boolean;
}

/** The net list of one circuit, with a lookup from a pin to the net it is on. */
export interface CircuitNets {
  readonly nets: readonly Net[];
  /**
   * The net this pin sits on, or `undefined` when no placed part in this circuit
   * has that pin — see the header on why those two answers must differ.
   */
  readonly at: (partId: string, pinId: string) => Net | undefined;
}

/**
 * Collapse a circuit's wires into nets.
 *
 * `resolve` is passed in rather than reaching for the catalogue, exactly as
 * `circuitProblems` does, so a component the user defined themselves is read
 * through the same call as a shipped one.
 *
 * Rows that are already wrong are SKIPPED rather than reported: a part whose
 * component this build does not ship contributes no pins (nobody has its pin
 * list, and inventing one would be worse than omitting it), a second part
 * claiming a taken id is ignored, and a wire end naming a pin that does not
 * exist joins nothing. Every one of those is a problem `circuitProblems`
 * already names once; naming it again here would bury one finding under
 * however many nets happen to touch it.
 */
export function buildNets(
  circuit: Circuit,
  resolve: (componentId: string) => ComponentDef | undefined,
): CircuitNets {
  const pins = collectPins(circuit.parts, resolve);
  const parent = new Map<string, string>();
  for (const key of pins.keys()) parent.set(key, key);

  for (const wire of circuit.wires) {
    const from = nodeKey(wire.from.partId, wire.from.pinId);
    const to = nodeKey(wire.to.partId, wire.to.pinId);
    if (!parent.has(from) || !parent.has(to)) continue;
    union(parent, from, to);
  }

  return assemble(pins, parent);
}

/**
 * The key of one node, length-prefixed so the encoding is injective for ANY
 * two ids. A plain separator is not: with `.`, `part "a.b" pin "c"` and
 * `part "a" pin "b.c"` collide into one node, which is two pins silently
 * becoming one wire. Reaching instead for a character no id can contain works
 * only for as long as that stays true, and the obvious such character is NUL,
 * which cannot be written into this file at all: it renders as nothing, and
 * `check:invisibles` rejects it. Counting the characters needs no assumption
 * about the alphabet — the reader knows where `partId` ends before it starts.
 */
function nodeKey(partId: string, pinId: string): string {
  return `${partId.length}:${partId}${pinId}`;
}

/** Every pin of every part that resolves, keyed by node, first part id winning. */
function collectPins(
  parts: readonly CircuitPart[],
  resolve: (componentId: string) => ComponentDef | undefined,
): Map<string, Pin & PinRef> {
  const pins = new Map<string, Pin & PinRef>();
  const seenParts = new Set<string>();

  for (const part of parts) {
    if (seenParts.has(part.id)) continue;
    seenParts.add(part.id);
    const component = resolve(part.componentId);
    if (component === undefined) continue;
    for (const pin of component.pins) {
      pins.set(nodeKey(part.id, pin.id), { ...pin, partId: part.id, pinId: pin.id });
    }
  }
  return pins;
}

/** Union-find root, with full path compression on the way back up. */
function find(parent: Map<string, string>, key: string): string {
  let root = key;
  for (;;) {
    const next = parent.get(root);
    // Cannot happen — every key was seeded — but a `while (next !== root)` on a
    // missing entry would spin, and a lookup that silently returns the input is
    // how a node quietly becomes its own net.
    if (next === undefined || next === root) break;
    root = next;
  }
  let walk = key;
  while (walk !== root) {
    const next = parent.get(walk) ?? root;
    parent.set(walk, root);
    walk = next;
  }
  return root;
}

function union(parent: Map<string, string>, a: string, b: string): void {
  const rootA = find(parent, a);
  const rootB = find(parent, b);
  if (rootA === rootB) return;
  // Union by key order rather than by rank. Rank would be faster and would make
  // the shape depend on the order the wires happen to be walked in; these sets
  // are tens of pins, and a deterministic net list is worth more here than an
  // inverse-Ackermann bound nobody can measure.
  const [low, high] = rootA < rootB ? [rootA, rootB] : [rootB, rootA];
  parent.set(high, low);
}

/** Group the nodes by root and read each net's rails and ground off its pins. */
function assemble(pins: Map<string, Pin & PinRef>, parent: Map<string, string>): CircuitNets {
  const groups = new Map<string, (Pin & PinRef)[]>();
  for (const [key, pin] of pins) {
    const root = find(parent, key);
    const group = groups.get(root);
    if (group === undefined) groups.set(root, [pin]);
    else group.push(pin);
  }

  // Sorted by the node key. Note what that orders by: the key is
  // length-prefixed, so this is „shorter part id first, then part, then pin"
  // rather than „part then pin". Net ids are handles within one pass and
  // nothing reads meaning into their order, so all this has to be is the same
  // answer twice — and plain `<` rather than an `Intl.Collator` is what makes
  // it so. These are ASCII ids, not Serbian text; a locale-aware collation
  // would make the result depend on the platform's ICU tables. The pins INSIDE
  // each net are ordered part-then-pin, by `compareNodes`, and that is the
  // order anything user-facing reads.
  const roots = [...groups.keys()].sort();
  const nets: Net[] = [];
  const netOf = new Map<string, Net>();

  roots.forEach((root, id) => {
    const members = (groups.get(root) ?? []).slice().sort(compareNodes);
    const rails = [
      ...new Set(
        members
          .filter((pin) => pin.functions.includes("power-out"))
          // `volts` is required on a `power-out` pin — `validateComponent`
          // refuses an entry without one — so this filter is a type narrowing
          // rather than a tolerance for a rail of unknown voltage.
          .map((pin) => pin.volts)
          .filter((volts): volts is number => typeof volts === "number"),
      ),
    ].sort((a, b) => a - b);

    const net: Net = {
      id,
      pins: members.map((pin) => ({ partId: pin.partId, pinId: pin.pinId })),
      rails,
      ground: members.some((pin) => pin.functions.includes("gnd")),
    };
    nets.push(net);
    for (const member of members) netOf.set(nodeKey(member.partId, member.pinId), net);
  });

  return { nets, at: (partId, pinId) => netOf.get(nodeKey(partId, pinId)) };
}

function compareNodes(a: PinRef, b: PinRef): number {
  if (a.partId !== b.partId) return a.partId < b.partId ? -1 : 1;
  if (a.pinId === b.pinId) return 0;
  return a.pinId < b.pinId ? -1 : 1;
}

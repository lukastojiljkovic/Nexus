import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_WIRE_COLOUR,
  wireFocusAfterRemoval,
  wireFocusOrder,
  wireFocusTarget,
  wireKeyIntent,
  wireName,
  wireTabStop,
} from "./elecWires.js";
import { applyLocale, DEFAULT_LOCALE } from "./strings.js";

/**
 * What the wires group answers, one rule per question.
 *
 * Vitest runs in a Node environment with no DOM in this repository
 * (`apps/desktop/vitest.config.ts`), so this file IS the testable half of the
 * keyboard: the DOM half (`ElecBench.tsx`) is the thin part that turns these
 * answers into `tabIndex` and `.focus()` calls. The list it exists for: Tab
 * reaches the group once, the arrows and Home/End walk the stated order, every
 * wire is named by its two ends, Enter selects, Delete removes, Escape leaves.
 *
 * The names are read through the live copy table, so this suite switches locale
 * itself and switches back, exactly as `elecLocale.test.ts` does.
 */
afterEach(() => {
  applyLocale(DEFAULT_LOCALE);
});

/** One wire as the focus order sees it: an id, and where its first end sits. */
function entry(id: string, x: number, y: number): { id: string; anchor: { x: number; y: number } } {
  return { id, anchor: { x, y } };
}

/** The ids of an order, which is what every assertion below is about. */
function ids(entries: readonly { readonly id: string }[]): string[] {
  return entries.map((ordered) => ordered.id);
}

describe("wireFocusOrder", () => {
  it("walks the wires by their first ends, top to bottom and then left to right", () => {
    const order = wireFocusOrder([
      entry("dole-desno", 10, 20),
      entry("gore-desno", 20, 0),
      entry("dole-levo", 0, 10),
      entry("gore-levo", 0, 0),
    ]);
    expect(ids(order)).toEqual(["gore-levo", "gore-desno", "dole-levo", "dole-desno"]);
  });

  it("leaves two wires whose first ends coincide in the order they arrived", () => {
    // The whole point of the stability: this is the circuit's own (created_at,
    // id) order, so two jumpers on the same pin row keep their places rather
    // than swapping on some later render and moving focus under the user.
    const order = wireFocusOrder([entry("prva", 5, 5), entry("druga", 5, 5), entry("treca", 0, 0)]);
    expect(ids(order)).toEqual(["treca", "prva", "druga"]);
    // ...and asking twice gives the same answer.
    expect(ids(wireFocusOrder([entry("prva", 5, 5), entry("druga", 5, 5), entry("treca", 0, 0)]))).toEqual(
      ["treca", "prva", "druga"],
    );
  });

  it("hands back the caller's own entries and leaves the array it was given alone", () => {
    const first = entry("prva", 0, 10);
    const second = entry("druga", 0, 0);
    const list = [first, second];
    const order = wireFocusOrder(list);
    expect(order[0]).toBe(second);
    expect(order[1]).toBe(first);
    expect(list).toEqual([first, second]);
  });

  it("has nothing to order on a circuit with no drawable wire", () => {
    expect(wireFocusOrder([])).toEqual([]);
  });
});

describe("wireTabStop", () => {
  const order = ["a", "b", "c"];

  it("puts exactly one wire in the tab order, and the arrows reach the rest", () => {
    const stop = wireTabStop(order, null);
    expect(order.filter((id) => id === stop)).toEqual(["a"]);
  });

  it("keeps the stop on the wire focus is on", () => {
    expect(wireTabStop(order, "b")).toBe("b");
  });

  it("gives the stop back to the first wire when the one it was on has gone", () => {
    expect(wireTabStop(order, "izbrisana")).toBe("a");
  });

  it("has no stop to give when there are no wires at all", () => {
    expect(wireTabStop([], null)).toBeNull();
    expect(wireTabStop([], "a")).toBeNull();
  });
});

describe("wireKeyIntent", () => {
  it("selects on Enter and on Space", () => {
    expect(wireKeyIntent("Enter")).toBe("select");
    expect(wireKeyIntent(" ")).toBe("select");
  });

  it("removes on Delete and on Backspace", () => {
    expect(wireKeyIntent("Delete")).toBe("remove");
    expect(wireKeyIntent("Backspace")).toBe("remove");
  });

  it("leaves the group on Escape", () => {
    expect(wireKeyIntent("Escape")).toBe("leave");
  });

  it("moves one wire at a time on all four arrows", () => {
    expect(wireKeyIntent("ArrowUp")).toBe("previous");
    expect(wireKeyIntent("ArrowLeft")).toBe("previous");
    expect(wireKeyIntent("ArrowDown")).toBe("next");
    expect(wireKeyIntent("ArrowRight")).toBe("next");
  });

  it("jumps to the ends on Home and End", () => {
    expect(wireKeyIntent("Home")).toBe("first");
    expect(wireKeyIntent("End")).toBe("last");
  });

  it("swallows nothing else, Tab least of all", () => {
    expect(wireKeyIntent("Tab")).toBeNull();
    expect(wireKeyIntent("Shift")).toBeNull();
    expect(wireKeyIntent("a")).toBeNull();
    expect(wireKeyIntent("F5")).toBeNull();
  });
});

describe("wireFocusTarget", () => {
  const order = ["a", "b", "c"];

  it("walks the order in both directions", () => {
    expect(wireFocusTarget(order, "a", "next")).toBe("b");
    expect(wireFocusTarget(order, "b", "previous")).toBe("a");
  });

  it("wraps at both ends, the way a composite widget does", () => {
    expect(wireFocusTarget(order, "c", "next")).toBe("a");
    expect(wireFocusTarget(order, "a", "previous")).toBe("c");
  });

  it("jumps to the first and last wire on Home and End", () => {
    expect(wireFocusTarget(order, "c", "first")).toBe("a");
    expect(wireFocusTarget(order, "a", "last")).toBe("c");
  });

  it("moves nothing for the keys that do something else", () => {
    expect(wireFocusTarget(order, "b", "select")).toBeNull();
    expect(wireFocusTarget(order, "b", "remove")).toBeNull();
    expect(wireFocusTarget(order, "b", "leave")).toBeNull();
  });

  it("treats a wire that has gone as nothing focused: forward to the first, back to the last", () => {
    expect(wireFocusTarget(order, "izbrisana", "next")).toBe("a");
    expect(wireFocusTarget(order, "izbrisana", "previous")).toBe("c");
  });

  it("stays on the only wire there is", () => {
    expect(wireFocusTarget(["a"], "a", "next")).toBe("a");
    expect(wireFocusTarget(["a"], "a", "previous")).toBe("a");
  });

  it("has nowhere to move on a circuit with no wires", () => {
    expect(wireFocusTarget([], "a", "next")).toBeNull();
    expect(wireFocusTarget([], "a", "first")).toBeNull();
  });
});

describe("wireFocusAfterRemoval", () => {
  it("lands on the wire after the one that went", () => {
    expect(wireFocusAfterRemoval(["a", "b", "c"], "b")).toBe("c");
  });

  it("lands on the one before it when it was the last, rather than wrapping to the first", () => {
    expect(wireFocusAfterRemoval(["a", "b", "c"], "c")).toBe("b");
  });

  it("has nowhere to land when it was the only wire", () => {
    expect(wireFocusAfterRemoval(["a"], "a")).toBeNull();
  });

  it("falls back to the tab stop for an id that is not in the list at all", () => {
    expect(wireFocusAfterRemoval(["a", "b"], "izbrisana")).toBe("a");
    expect(wireFocusAfterRemoval([], "izbrisana")).toBeNull();
  });
});

describe("wireName", () => {
  const from = { part: "R1", pin: "2" };
  const to = { part: "U1", pin: "7" };

  it("names a wire by its two ends, in Serbian", () => {
    expect(wireName(from, to, DEFAULT_WIRE_COLOUR)).toBe("Žica od R1 pin 2 do U1 pin 7");
  });

  it("adds the colour when the jumper is not the default one", () => {
    expect(wireName(from, to, "green")).toBe("Žica od R1 pin 2 do U1 pin 7, zelena");
    // Black is the default, so it is not said: the name carries information,
    // not a recital of every field.
    expect(DEFAULT_WIRE_COLOUR).toBe("black");
    expect(wireName(from, to, "black")).toBe("Žica od R1 pin 2 do U1 pin 7");
  });

  it("says the same thing in English", () => {
    applyLocale("en");
    expect(wireName(from, to, "black")).toBe("Wire from R1 pin 2 to U1 pin 7");
    expect(wireName(from, to, "red")).toBe("Wire from R1 pin 2 to U1 pin 7, red");
  });

  it("takes the ends as they are named elsewhere on the bench", () => {
    // A part whose component this build does not ship is still named on the
    // bench, and the wire that reaches it is named the same way.
    expect(wireName({ part: "Nepoznata komponenta", pin: "1" }, to, "blue")).toBe(
      "Žica od Nepoznata komponenta pin 1 do U1 pin 7, plava",
    );
  });
});

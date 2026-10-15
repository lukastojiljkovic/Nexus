import { describe, expect, it } from "vitest";

import { holdItemIntent, intentForPage } from "./itemIntent.js";

/**
 * The shell's half of ADR-114: what one `nexus:open-location` request holds, and
 * which page it is owed to.
 *
 * `App.tsx` is not rendered here - this package has no DOM library, and the point
 * of `itemIntent.ts` is that the two decisions worth pinning are pure. What is
 * asserted is (a) what a request becomes, which is the `location.item` the shell
 * can hand a kit page and nothing more, (b) that only the module the request
 * named is handed it, and (c) the two properties the shell's hold must have: the
 * value outlives the press (so a page that mounts later still sees it) and a
 * second press is a new value (so the same citation reveals twice).
 */

describe("what a location holds for a kit page", () => {
  it("turns the item a location named into that module's reveal intent", () => {
    expect(holdItemIntent("wiki", "wikipedia-sr-mini/A/Nikola_Tesla")).toEqual({
      module: "wiki",
      intent: { kind: "reveal", item: "wikipedia-sr-mini/A/Nikola_Tesla" },
    });
  });

  it("holds nothing for a request that names no item", () => {
    // The detail of a window event is a payload nobody type-checks on the way
    // in, so the three shapes that are not an item are named rather than
    // trusted: an absent one, an empty one, and a non-string.
    expect(holdItemIntent("wiki", undefined)).toBeNull();
    expect(holdItemIntent("wiki", "")).toBeNull();
    expect(holdItemIntent("wiki", 42)).toBeNull();
  });
});

describe("which page is owed the held item", () => {
  const held = holdItemIntent("wiki", "wikipedia-sr-mini/A/Nikola_Tesla");

  it("hands it to the module that was named, and to no other", () => {
    expect(intentForPage(held, "wiki")).toEqual({
      kind: "reveal",
      item: "wikipedia-sr-mini/A/Nikola_Tesla",
    });
    // This is also what a module that ignores the prop is handed: nothing. The
    // shell invents no intent for a page the location did not name.
    expect(intentForPage(held, "notes")).toBeNull();
    expect(intentForPage(null, "wiki")).toBeNull();
  });

  it("answers the same value until the page reports it consumed", () => {
    // The page may mount long after the press - it arrives in its own chunk -
    // and what it is handed is read from the value the shell is still holding,
    // so asking twice answers the same intent rather than one that expired.
    expect(intentForPage(held, "wiki")).toBe(intentForPage(held, "wiki"));
    // And the same reference is what keeps an unrelated re-render of the shell
    // from re-firing a page's intent effect: only a new request is a new value.
    expect(
      intentForPage(holdItemIntent("wiki", "wikipedia-sr-mini/A/Nikola_Tesla"), "wiki"),
    ).not.toBe(intentForPage(held, "wiki"));
  });
});

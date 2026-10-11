import { describe, expect, it } from "vitest";

import { lookupString, moveNeighbours } from "./dashboardLayout.js";
import { resolveLabel } from "./moduleKit/labels.js";
import { strings } from "./strings.js";
import { createModuleRegistry } from "../../shared/modules.js";

/**
 * The layout arithmetic behind the dashboard's edit mode (ADR-045 slice b).
 * What is pinned here is the PAIR each gesture sends to
 * `dashboard:widgets-move`: the store owns placement, so a wrong pair is a
 * silent mis-move rather than an error, and the three gestures (menu up, menu
 * down, drop) all reduce to this one function.
 */

/** Applies a pair the way the store does, so a test can assert on the resulting order. */
function applied(order: readonly string[], moved: string, pair: { beforeId: string | null; afterId: string | null }): string[] {
  const rest = order.filter((id) => id !== moved);
  const index = pair.afterId === null ? rest.length : rest.indexOf(pair.afterId);
  return [...rest.slice(0, index), moved, ...rest.slice(index)];
}

describe("moveNeighbours", () => {
  const order = ["a", "b", "c", "d"];

  it("steps one place up, landing between the pair that straddles the new slot", () => {
    expect(moveNeighbours(order, 2, 1)).toEqual({ beforeId: "a", afterId: "b" });
    expect(applied(order, "c", { beforeId: "a", afterId: "b" })).toEqual(["a", "c", "b", "d"]);
  });

  it("steps one place down", () => {
    expect(moveNeighbours(order, 1, 2)).toEqual({ beforeId: "c", afterId: "d" });
    expect(applied(order, "b", { beforeId: "c", afterId: "d" })).toEqual(["a", "c", "b", "d"]);
  });

  it("names a null neighbour at each end of the layout", () => {
    expect(moveNeighbours(order, 2, 0)).toEqual({ beforeId: null, afterId: "a" });
    expect(moveNeighbours(order, 1, 3)).toEqual({ beforeId: "d", afterId: null });
  });

  it("lands a card dropped downward AFTER the card it was dropped on", () => {
    // Dragging "a" onto "c" (index 2) — the gesture reads as "put it there".
    const pair = moveNeighbours(order, 0, 2);
    expect(pair).toEqual({ beforeId: "c", afterId: "d" });
    expect(pair && applied(order, "a", pair)).toEqual(["b", "c", "a", "d"]);
  });

  it("lands a card dropped upward BEFORE the card it was dropped on", () => {
    const pair = moveNeighbours(order, 3, 1);
    expect(pair).toEqual({ beforeId: "a", afterId: "b" });
    expect(pair && applied(order, "d", pair)).toEqual(["a", "d", "b", "c"]);
  });

  it("refuses a move that is not one — off either end, or onto itself", () => {
    expect(moveNeighbours(order, 0, -1)).toBeNull();
    expect(moveNeighbours(order, 3, 4)).toBeNull();
    expect(moveNeighbours(order, 2, 2)).toBeNull();
    expect(moveNeighbours(order, -1, 0)).toBeNull();
    expect(moveNeighbours(order, 9, 0)).toBeNull();
    expect(moveNeighbours([], 0, 0)).toBeNull();
  });

  it("has nowhere to go in a layout of one", () => {
    expect(moveNeighbours(["a"], 0, -1)).toBeNull();
    expect(moveNeighbours(["a"], 0, 1)).toBeNull();
  });

  it("keeps every other entry in place, whichever way the move goes", () => {
    for (let from = 0; from < order.length; from += 1) {
      for (let to = 0; to < order.length; to += 1) {
        const pair = moveNeighbours(order, from, to);
        if (pair === null) continue;
        const moved = order[from] as string;
        const result = applied(order, moved, pair);
        expect(result).toHaveLength(order.length);
        expect(result[to]).toBe(moved);
        expect(result.filter((id) => id !== moved)).toEqual(order.filter((id) => id !== moved));
      }
    }
  });
});

describe("lookupString", () => {
  it("resolves a dotted path to its text", () => {
    expect(lookupString({ a: { b: "text" } }, "a.b")).toBe("text");
  });

  it("answers null for a path that names nothing, or names a non-string", () => {
    expect(lookupString({ a: { b: "text" } }, "a.c")).toBeNull();
    expect(lookupString({ a: { b: "text" } }, "a")).toBeNull();
    expect(lookupString({ a: { b: "text" } }, "")).toBeNull();
    expect(lookupString({ a: { b: "text" } }, "a.b.c")).toBeNull();
    expect(lookupString(null, "a")).toBeNull();
  });

  it("resolves the title of every widget the v0 modules publish", () => {
    // The pairing slice b depends on: a title that did not resolve would be
    // drawn as the raw key path on the card the user is looking at.
    const registry = createModuleRegistry();
    for (const manifest of registry.all()) {
      for (const widget of registry.widgetsOf(manifest.id)) {
        // `resolveLabel` rather than `lookupString`: a discovered module declares
        // a `{ sr, en }` pair instead of a `strings` path (ADR-090), and this is
        // the function the card itself draws the title through.
        expect(resolveLabel(widget.title), JSON.stringify(widget.title)).toBeTypeOf("string");
      }
    }
    expect(lookupString(strings, "dashboard.today.title")).toBe("Danas");
  });
});

import { describe, expect, it } from "vitest";

import {
  NO_ITEM_INTENTS,
  dropIntent,
  enqueueIntent,
  intentForPage,
  type ItemIntents,
} from "./itemIntent.js";

/**
 * The shell's half of ADR-114 and ADR-117: what one `nexus:open-location`
 * request queues for a module's page, and which request that page is owed next.
 *
 * `App.tsx` is not rendered here - this package has no DOM library, and the point
 * of `itemIntent.ts` is that the decisions worth pinning are pure. What is
 * asserted is (a) what a request becomes, which is the item or the action the
 * shell can hand a kit page and nothing more, (b) that only the module the
 * request named is handed it, and (c) the three properties the shell's hold must
 * have: the value outlives the press (so a page that mounts later still sees it),
 * a second request queues behind the first rather than overwriting it, and a
 * request for one module leaves every other module's queue alone.
 */

/** The queue after one request for `moduleId`. */
function holding(moduleId: string, request: { item?: unknown; action?: unknown }): ItemIntents {
  return enqueueIntent(NO_ITEM_INTENTS, moduleId, {
    item: request.item,
    action: request.action,
  });
}

describe("what a request queues for a page", () => {
  it("turns the item a location named into that module's reveal intent", () => {
    expect(
      intentForPage(holding("wiki", { item: "wikipedia-sr-mini/A/Nikola_Tesla" }), "wiki"),
    ).toEqual({
      kind: "reveal",
      item: "wikipedia-sr-mini/A/Nikola_Tesla",
    });
  });

  it("turns the action a location named into that module's action intent, with its payload", () => {
    expect(
      intentForPage(
        holding("canvas", { action: { name: "sketch", payload: { title: "Plan" } } }),
        "canvas",
      ),
    ).toEqual({ kind: "action", action: "sketch", payload: { title: "Plan" } });
  });

  it("carries the item a request named beside its action", () => {
    // A location that names both a row and a verb: the verb applies to that row,
    // and dropping the item would leave the page applying it to nothing.
    expect(
      intentForPage(holding("canvas", { item: "board-1", action: { name: "sketch" } }), "canvas"),
    ).toEqual({ kind: "action", action: "sketch", payload: undefined, item: "board-1" });
  });

  it("queues nothing for a request that names neither", () => {
    // The detail of a window event is a payload nobody type-checks on the way
    // in, so the shapes that are neither an item nor an action are named rather
    // than trusted: an absent one, an empty one, a non-string, and an action
    // whose `name` is not a verb.
    expect(holding("wiki", {})).toBe(NO_ITEM_INTENTS);
    expect(holding("wiki", { item: "" })).toBe(NO_ITEM_INTENTS);
    expect(holding("wiki", { item: 42 })).toBe(NO_ITEM_INTENTS);
    expect(holding("wiki", { action: { name: "" } })).toBe(NO_ITEM_INTENTS);
    expect(holding("wiki", { action: "sketch" })).toBe(NO_ITEM_INTENTS);
    expect(holding("wiki", { action: null })).toBe(NO_ITEM_INTENTS);
    // An action this file cannot read leaves the item it arrived with alone: a
    // request that still names a row is still a reveal.
    expect(intentForPage(holding("wiki", { item: "A/B", action: { name: 7 } }), "wiki")).toEqual({
      kind: "reveal",
      item: "A/B",
    });
  });
});

describe("which page is owed what", () => {
  it("hands it to the module that was named, and to no other", () => {
    const queue = holding("wiki", { item: "wikipedia-sr-mini/A/Nikola_Tesla" });
    // This is also what a module that ignores the prop is handed: nothing. The
    // shell invents no intent for a page the location did not name.
    expect(intentForPage(queue, "notes")).toBeNull();
    expect(intentForPage(NO_ITEM_INTENTS, "wiki")).toBeNull();
  });

  it("answers the same value until the page reports it consumed", () => {
    // The page may mount long after the press - it arrives in its own chunk -
    // and what it is handed is read from the queue the shell is still holding,
    // so asking twice answers the same intent rather than one that expired.
    const queue = holding("wiki", { item: "A/B" });
    expect(intentForPage(queue, "wiki")).toBe(intentForPage(queue, "wiki"));
    // And the same reference is what keeps an unrelated re-render of the shell
    // from re-firing a page's intent effect: only a new request is a new value.
    expect(intentForPage(holding("wiki", { item: "A/B" }), "wiki")).not.toBe(
      intentForPage(queue, "wiki"),
    );
  });
});

describe("the queue's order", () => {
  it("hands two requests for one module back in the order they arrived", () => {
    // Two calls in one model step name two sketches: the page opens the first,
    // reports it handled, and is then owed the second - instead of the second
    // landing and the first being dropped on the floor.
    const queue = enqueueIntent(
      enqueueIntent(NO_ITEM_INTENTS, "canvas", {
        item: undefined,
        action: { name: "sketch", payload: 1 },
      }),
      "canvas",
      { item: undefined, action: { name: "sketch", payload: 2 } },
    );

    expect(intentForPage(queue, "canvas")).toEqual({
      kind: "action",
      action: "sketch",
      payload: 1,
    });
    const afterFirst = dropIntent(queue, "canvas");
    expect(intentForPage(afterFirst, "canvas")).toEqual({
      kind: "action",
      action: "sketch",
      payload: 2,
    });
    expect(intentForPage(dropIntent(afterFirst, "canvas"), "canvas")).toBeNull();
  });

  it("keeps one module's queue through a request for another", () => {
    const queue = enqueueIntent(
      enqueueIntent(NO_ITEM_INTENTS, "canvas", { item: undefined, action: { name: "sketch" } }),
      "tasks",
      { item: "task-1", action: undefined },
    );

    expect(intentForPage(queue, "tasks")).toEqual({ kind: "reveal", item: "task-1" });
    // The action Canvas was owed survives a bare `app.open` of Tasks, which is
    // the whole reason the queue is keyed by module: a single held intent let
    // the second request overwrite the first.
    expect(intentForPage(queue, "canvas")).toEqual({
      kind: "action",
      action: "sketch",
      payload: undefined,
    });
  });

  it("drops the head and nothing else when a page reports it handled", () => {
    const queue = enqueueIntent(
      enqueueIntent(NO_ITEM_INTENTS, "wiki", { item: "A/B", action: undefined }),
      "wiki",
      { item: "C/D", action: undefined },
    );
    // A page that reports handled after every ordinary visit must not cost a
    // module its queue, and a module with nothing queued must not grow a key.
    expect(dropIntent(NO_ITEM_INTENTS, "wiki")).toBe(NO_ITEM_INTENTS);
    const emptied = dropIntent(dropIntent(queue, "wiki"), "wiki");
    expect(emptied.has("wiki")).toBe(false);
    expect(intentForPage(emptied, "wiki")).toBeNull();
  });
});

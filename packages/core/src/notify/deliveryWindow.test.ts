import { describe, expect, it } from "vitest";
import type { NotificationSource } from "./notificationEngine.js";
import {
  COALESCE_WINDOW_MS,
  DIGEST_COUNT_THRESHOLD,
  coalesceDeliveries,
  emptyDeliveryWindow,
} from "./deliveryWindow.js";

interface Item {
  source: NotificationSource;
  id: string;
}

const T0 = 1_700_000_000_000;

function item(source: NotificationSource, id: string): Item {
  return { source, id };
}

function ids(items: readonly Item[] | null): string[] {
  return (items ?? []).map((entry) => entry.id);
}

describe("the coalescing constants", () => {
  it("keeps the window longer than one scheduler pass (60 s), so back-to-back passes fold", () => {
    expect(COALESCE_WINDOW_MS).toBe(90_000);
    expect(COALESCE_WINDOW_MS).toBeGreaterThan(60_000);
  });

  it("keeps the count threshold at the storm guard's three", () => {
    expect(DIGEST_COUNT_THRESHOLD).toBe(3);
  });
});

describe("coalesceDeliveries with a clear window", () => {
  it("shows nothing and leaves the window untouched for an empty batch", () => {
    const window = emptyDeliveryWindow<Item>();
    const result = coalesceDeliveries({ arrivals: [], now: T0, window });

    expect(result.individual).toEqual([]);
    expect(result.digest).toBeNull();
    expect(result.reason).toBeNull();
    expect(result.window).toEqual(window);
  });

  it("shows a small batch individually and opens the window at that instant", () => {
    const arrivals = [item("task", "a"), item("event", "b")];
    const result = coalesceDeliveries({ arrivals, now: T0, window: emptyDeliveryWindow<Item>() });

    expect(ids(result.individual)).toEqual(["a", "b"]);
    expect(result.digest).toBeNull();
    expect(result.window).toEqual({ lastToastAt: T0, delivered: arrivals });
  });

  it("still shows individually at exactly the count threshold", () => {
    const arrivals = [item("task", "a"), item("task", "b"), item("exam", "c")];
    const result = coalesceDeliveries({ arrivals, now: T0, window: emptyDeliveryWindow<Item>() });

    expect(ids(result.individual)).toEqual(["a", "b", "c"]);
    expect(result.digest).toBeNull();
    expect(result.reason).toBeNull();
  });

  it("collapses one past the count threshold, reporting the count as the reason", () => {
    const arrivals = [
      item("task", "a"),
      item("task", "b"),
      item("exam", "c"),
      item("document", "d"),
    ];
    const result = coalesceDeliveries({ arrivals, now: T0, window: emptyDeliveryWindow<Item>() });

    expect(result.individual).toEqual([]);
    expect(ids(result.digest)).toEqual(["a", "b", "c", "d"]);
    expect(result.reason).toBe("count");
    expect(result.window.lastToastAt).toBe(T0);
  });
});

describe("coalesceDeliveries at the rolling window's boundaries", () => {
  const window = { lastToastAt: T0, delivered: [item("task", "old")] };

  it("folds a single arrival one millisecond inside the window", () => {
    const result = coalesceDeliveries({
      arrivals: [item("event", "new")],
      now: T0 + COALESCE_WINDOW_MS - 1,
      window,
    });

    expect(result.individual).toEqual([]);
    expect(ids(result.digest)).toEqual(["old", "new"]);
    expect(result.reason).toBe("window");
  });

  it("shows individually exactly at the window's end — the bound is exclusive", () => {
    const result = coalesceDeliveries({
      arrivals: [item("event", "new")],
      now: T0 + COALESCE_WINDOW_MS,
      window,
    });

    expect(ids(result.individual)).toEqual(["new"]);
    expect(result.digest).toBeNull();
    expect(result.reason).toBeNull();
  });

  it("forgets a lapsed window's deliveries rather than counting them into a later digest", () => {
    const lapsed = coalesceDeliveries({
      arrivals: [item("event", "new")],
      now: T0 + COALESCE_WINDOW_MS,
      window,
    });

    expect(lapsed.window.delivered.map((entry) => entry.id)).toEqual(["new"]);
  });

  it("honours an explicit windowMs over the default", () => {
    const result = coalesceDeliveries({
      arrivals: [item("event", "new")],
      now: T0 + 5_000,
      window,
      windowMs: 1_000,
    });

    expect(ids(result.individual)).toEqual(["new"]);
    expect(result.digest).toBeNull();
  });
});

describe("coalesceDeliveries across a storm", () => {
  it("keeps one running digest rather than a toast per pass", () => {
    const first = coalesceDeliveries({
      arrivals: [item("task", "a"), item("task", "b")],
      now: T0,
      window: emptyDeliveryWindow<Item>(),
    });
    const second = coalesceDeliveries({
      arrivals: [item("event", "c")],
      now: T0 + 60_000,
      window: first.window,
    });
    const third = coalesceDeliveries({
      arrivals: [item("exam", "d")],
      now: T0 + 120_000,
      window: second.window,
    });

    expect(ids(first.individual)).toEqual(["a", "b"]);
    expect(ids(second.digest)).toEqual(["a", "b", "c"]);
    expect(ids(third.digest)).toEqual(["a", "b", "c", "d"]);
    expect(third.reason).toBe("window");
  });

  it("reports the window as the reason even when the batch alone would trip the count", () => {
    const first = coalesceDeliveries({
      arrivals: [item("task", "a")],
      now: T0,
      window: emptyDeliveryWindow<Item>(),
    });
    const second = coalesceDeliveries({
      arrivals: [
        item("task", "b"),
        item("task", "c"),
        item("task", "d"),
        item("task", "e"),
      ],
      now: T0 + 1_000,
      window: first.window,
    });

    expect(second.reason).toBe("window");
    expect(ids(second.digest)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("coalesceDeliveries and the always-on exemption (NTF-007)", () => {
  it("never folds a security notice, whatever the batch size", () => {
    const arrivals = [
      item("security", "s"),
      item("task", "a"),
      item("task", "b"),
      item("exam", "c"),
      item("document", "d"),
    ];
    const result = coalesceDeliveries({ arrivals, now: T0, window: emptyDeliveryWindow<Item>() });

    expect(ids(result.individual)).toEqual(["s"]);
    expect(ids(result.digest)).toEqual(["a", "b", "c", "d"]);
  });

  it("never folds a security notice inside a live window either", () => {
    const window = { lastToastAt: T0, delivered: [item("task", "old")] };
    const result = coalesceDeliveries({
      arrivals: [item("security", "s"), item("event", "new")],
      now: T0 + 1_000,
      window,
    });

    expect(ids(result.individual)).toEqual(["s"]);
    expect(ids(result.digest)).toEqual(["old", "new"]);
  });

  it("leaves the window untouched when the batch is security only — a security toast opens nothing", () => {
    const window = emptyDeliveryWindow<Item>();
    const result = coalesceDeliveries({
      arrivals: [item("security", "s1"), item("security", "s2")],
      now: T0,
      window,
    });

    expect(ids(result.individual)).toEqual(["s1", "s2"]);
    expect(result.digest).toBeNull();
    expect(result.window).toEqual(window);
  });

  it("does not count security notices towards the count threshold", () => {
    const arrivals = [
      item("security", "s1"),
      item("security", "s2"),
      item("task", "a"),
      item("task", "b"),
      item("task", "c"),
    ];
    const result = coalesceDeliveries({ arrivals, now: T0, window: emptyDeliveryWindow<Item>() });

    expect(ids(result.individual)).toEqual(["s1", "s2", "a", "b", "c"]);
    expect(result.digest).toBeNull();
  });
});

describe("coalesceDeliveries purity", () => {
  it("never mutates the window it was handed", () => {
    const window = { lastToastAt: T0, delivered: [item("task", "old")] };
    coalesceDeliveries({ arrivals: [item("event", "new")], now: T0 + 1_000, window });

    expect(window).toEqual({ lastToastAt: T0, delivered: [{ source: "task", id: "old" }] });
  });

  it("never mutates the arrivals it was handed", () => {
    const arrivals = [item("task", "a"), item("task", "b")];
    coalesceDeliveries({ arrivals, now: T0, window: emptyDeliveryWindow<Item>() });

    expect(arrivals.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

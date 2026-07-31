import { describe, expect, it } from "vitest";
import type { WidgetContract } from "./widgets.js";
import {
  parseWidgetConfig,
  serializeWidgetConfig,
  validateWidgetConfig,
  WIDGET_CONFIG_MAX_TASK_LISTS,
  widgetChoice,
  widgetCount,
  widgetTaskLists,
} from "./widgetConfig.js";

/** A widget declaring one field of each kind — the whole vocabulary at once. */
const CONTRACT: WidgetContract = {
  id: "proba",
  title: "dashboard.upcoming.title",
  sizes: ["S", "M"],
  deepLink: "tasks",
  configFields: [
    { kind: "count", key: "count", min: 3, max: 10, default: 5 },
    {
      kind: "choice",
      key: "period",
      options: [
        { id: "svi", labelKey: "dashboard.config.period.svi" },
        { id: "danas", labelKey: "tasks.smart.names.danas" },
      ],
      default: "svi",
    },
    { kind: "taskLists", key: "lists" },
  ],
};

/** The uncapped shape `calendar:danas` ships as: a default OUTSIDE `min..max`, meaning "no cap". */
const UNCAPPED: WidgetContract = {
  id: "bez-plafona",
  title: "dashboard.today.title",
  sizes: ["S"],
  deepLink: "calendar",
  configFields: [
    { kind: "count", key: "count", min: 3, max: 10, default: Number.POSITIVE_INFINITY },
  ],
};

/** A widget declaring nothing — `study:ucenje`'s posture. */
const PLAIN: WidgetContract = {
  id: "nista",
  title: "study.dashboardStudyTitle",
  sizes: ["S"],
  deepLink: "study",
};

describe("parseWidgetConfig", () => {
  it("answers every declared field at its default for a NULL config — absent config IS today's behaviour", () => {
    expect(parseWidgetConfig(CONTRACT, null)).toEqual({ count: 5, period: "svi", lists: [] });
  });

  it("answers defaults for unparseable JSON and for JSON that is not an object", () => {
    expect(parseWidgetConfig(CONTRACT, "{nije json")).toEqual({
      count: 5,
      period: "svi",
      lists: [],
    });
    expect(parseWidgetConfig(CONTRACT, '"tekst"')).toEqual({ count: 5, period: "svi", lists: [] });
    expect(parseWidgetConfig(CONTRACT, "[3]")).toEqual({ count: 5, period: "svi", lists: [] });
  });

  it("keeps a valid value of every kind", () => {
    const parsed = parseWidgetConfig(
      CONTRACT,
      JSON.stringify({ count: 7, period: "danas", lists: ["a", "b"] }),
    );
    expect(parsed).toEqual({ count: 7, period: "danas", lists: ["a", "b"] });
  });

  it("keeps the range's own bounds", () => {
    expect(parseWidgetConfig(CONTRACT, JSON.stringify({ count: 3 }))["count"]).toBe(3);
    expect(parseWidgetConfig(CONTRACT, JSON.stringify({ count: 10 }))["count"]).toBe(10);
  });

  it("drops unknown keys — the result holds exactly the declared fields", () => {
    const parsed = parseWidgetConfig(CONTRACT, JSON.stringify({ count: 7, uljez: true }));
    expect(Object.keys(parsed).sort()).toEqual(["count", "lists", "period"]);
    expect(parsed["count"]).toBe(7);
  });

  it("falls back PER FIELD: one unreadable value costs only its own field", () => {
    const parsed = parseWidgetConfig(
      CONTRACT,
      JSON.stringify({ count: 99, period: "danas", lists: "sve" }),
    );
    expect(parsed).toEqual({ count: 5, period: "danas", lists: [] });
  });

  it("falls a count back to the default on a non-integer, a string, or an out-of-range value", () => {
    for (const bad of [4.5, "7", true, null, -3, 11]) {
      expect(parseWidgetConfig(CONTRACT, JSON.stringify({ count: bad }))["count"]).toBe(5);
    }
  });

  it("falls a choice back to the default on an id outside the options", () => {
    expect(parseWidgetConfig(CONTRACT, JSON.stringify({ period: "juce" }))["period"]).toBe("svi");
    expect(parseWidgetConfig(CONTRACT, JSON.stringify({ period: 3 }))["period"]).toBe("svi");
  });

  it("keeps only string entries of a task-list selection, deduplicated", () => {
    const parsed = parseWidgetConfig(
      CONTRACT,
      JSON.stringify({ lists: ["a", 3, "b", "a", null] }),
    );
    expect(parsed["lists"]).toEqual(["a", "b"]);
  });

  it("drops a selected list that no longer exists — never an error", () => {
    const raw = JSON.stringify({ lists: ["ziva", "mrtva"] });
    expect(
      parseWidgetConfig(CONTRACT, raw, { liveTaskListIds: new Set(["ziva"]) })["lists"],
    ).toEqual(["ziva"]);
    // Every named list gone ⇒ the selection empties back into "all lists".
    expect(parseWidgetConfig(CONTRACT, raw, { liveTaskListIds: new Set() })["lists"]).toEqual([]);
    // No live set handed in ⇒ nothing to drop against, the selection is kept.
    expect(parseWidgetConfig(CONTRACT, raw)["lists"]).toEqual(["ziva", "mrtva"]);
  });

  it("lets an uncapped default (outside min..max) through untouched when the field is absent", () => {
    expect(parseWidgetConfig(UNCAPPED, null)["count"]).toBe(Number.POSITIVE_INFINITY);
    expect(parseWidgetConfig(UNCAPPED, JSON.stringify({ count: 4 }))["count"]).toBe(4);
  });

  it("answers an empty config for a widget that declares nothing", () => {
    expect(parseWidgetConfig(PLAIN, null)).toEqual({});
    expect(parseWidgetConfig(PLAIN, JSON.stringify({ count: 5 }))).toEqual({});
  });
});

describe("validateWidgetConfig", () => {
  it("reads absent as 'clear everything' and garbage as 'not a config' — different answers", () => {
    expect(validateWidgetConfig(CONTRACT, undefined)).toEqual({});
    expect(validateWidgetConfig(CONTRACT, null)).toEqual({});
    expect(validateWidgetConfig(CONTRACT, "tekst")).toBeNull();
    expect(validateWidgetConfig(CONTRACT, [3])).toBeNull();
  });

  it("accepts a value of every kind and hands back a canonical copy", () => {
    const config = validateWidgetConfig(CONTRACT, {
      count: 7,
      period: "danas",
      lists: ["a", "b"],
    });
    expect(config).toEqual({ count: 7, period: "danas", lists: ["a", "b"] });
  });

  it("refuses an unknown key outright", () => {
    expect(validateWidgetConfig(CONTRACT, { count: 7, uljez: 1 })).toBeNull();
  });

  it("refuses a count outside its closed domain", () => {
    expect(validateWidgetConfig(CONTRACT, { count: 2 })).toBeNull();
    expect(validateWidgetConfig(CONTRACT, { count: 11 })).toBeNull();
    expect(validateWidgetConfig(CONTRACT, { count: 4.5 })).toBeNull();
    expect(validateWidgetConfig(CONTRACT, { count: "7" })).toBeNull();
    expect(validateWidgetConfig(CONTRACT, { count: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("refuses a choice outside the options", () => {
    expect(validateWidgetConfig(CONTRACT, { period: "juce" })).toBeNull();
    expect(validateWidgetConfig(CONTRACT, { period: 1 })).toBeNull();
  });

  it("refuses a malformed task-list selection: non-array, non-string entry, duplicate, over the cap", () => {
    expect(validateWidgetConfig(CONTRACT, { lists: "a" })).toBeNull();
    expect(validateWidgetConfig(CONTRACT, { lists: ["a", 3] })).toBeNull();
    expect(validateWidgetConfig(CONTRACT, { lists: ["a", "a"] })).toBeNull();
    expect(validateWidgetConfig(CONTRACT, { lists: [""] })).toBeNull();
    const over = Array.from({ length: WIDGET_CONFIG_MAX_TASK_LISTS + 1 }, (_, i) => `l${i}`);
    expect(validateWidgetConfig(CONTRACT, { lists: over })).toBeNull();
  });

  it("drops a field equal to its default — stored config carries only what differs", () => {
    expect(validateWidgetConfig(CONTRACT, { count: 5, period: "danas" })).toEqual({
      period: "danas",
    });
    expect(validateWidgetConfig(CONTRACT, { count: 5, period: "svi", lists: [] })).toEqual({});
  });

  it("treats an explicit null field as absent — a cleared knob and a never-set one mean the same", () => {
    expect(validateWidgetConfig(CONTRACT, { count: null, period: "danas" })).toEqual({
      period: "danas",
    });
  });

  it("refuses any keyed config for a widget that declares nothing, and accepts only the clear", () => {
    expect(validateWidgetConfig(PLAIN, {})).toEqual({});
    expect(validateWidgetConfig(PLAIN, { count: 5 })).toBeNull();
  });

  it("never returns part of its input — the selection array is a fresh copy", () => {
    const lists = ["a", "b"];
    const config = validateWidgetConfig(CONTRACT, { lists });
    expect(config?.["lists"]).toEqual(lists);
    expect(config?.["lists"]).not.toBe(lists);
  });
});

describe("serializeWidgetConfig", () => {
  it("stores NULL for a config that asks for nothing", () => {
    expect(serializeWidgetConfig({})).toBeNull();
  });

  it("round-trips through the lenient reader", () => {
    const config = validateWidgetConfig(CONTRACT, { count: 8, lists: ["a"] });
    expect(config).not.toBeNull();
    const text = serializeWidgetConfig(config ?? {});
    expect(text).not.toBeNull();
    expect(parseWidgetConfig(CONTRACT, text)).toEqual({ count: 8, period: "svi", lists: ["a"] });
  });
});

describe("the typed readers over a parsed config", () => {
  const parsed = parseWidgetConfig(CONTRACT, JSON.stringify({ count: 7, lists: ["a"] }));

  it("narrow each kind to its own type", () => {
    expect(widgetCount(parsed, "count")).toBe(7);
    expect(widgetChoice(parsed, "period")).toBe("svi");
    expect(widgetTaskLists(parsed, "lists")).toEqual(["a"]);
  });

  it("throw on a key that names another kind — a programmer error, not a fallback", () => {
    expect(() => widgetCount(parsed, "period")).toThrow();
    expect(() => widgetChoice(parsed, "lists")).toThrow();
    expect(() => widgetTaskLists(parsed, "count")).toThrow();
  });
});

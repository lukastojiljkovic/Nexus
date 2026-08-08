import { describe, it, expect } from "vitest";
import type { CollectionSchema } from "./fields.js";
import type {
  CalendarViewConfig,
  CardsViewConfig,
  KanbanViewConfig,
} from "./viewConfig.js";
import {
  applyFilters,
  applySort,
  arrangeKanbanColumns,
  groupForKanban,
  moveBetweenGroups,
  orderKanbanColumnKeys,
  ViewConfigError,
} from "./engine.js";
import type { KanbanGroup } from "./engine.js";

// No `titleKey` anywhere: the engine reads `key` and `type` and nothing else,
// and the fixture used to carry five label keys that named no real `strings`
// path — see `FieldDef.titleKey` for why the property is now optional.
const schema: CollectionSchema = {
  fields: [
    { key: "naslov", type: "text" },
    { key: "rok", type: "date" },
    { key: "status", type: "select", options: ["Za učenje", "U toku", "Naučeno"] },
    { key: "tezina", type: "number" },
    { key: "gotovo", type: "boolean" },
  ],
};

const kanban: KanbanViewConfig = { type: "kanban", groupBy: "status" };

const naslovi = (items: readonly Record<string, unknown>[]) =>
  items.map((i) => i["naslov"]);

describe("applyFilters", () => {
  const items = [
    { naslov: "Grupe", status: "U toku", tezina: 3 },
    { naslov: "Prsteni", status: "U toku", tezina: 5 },
    { naslov: "Polja", status: "Naučeno", tezina: 3 },
  ];

  it("keeps only matches, ANDing multiple filters", () => {
    expect(
      naslovi(applyFilters(items, [{ field: "status", equals: "U toku" }])),
    ).toEqual(["Grupe", "Prsteni"]);
    expect(
      naslovi(
        applyFilters(items, [
          { field: "status", equals: "U toku" },
          { field: "tezina", equals: 3 },
        ]),
      ),
    ).toEqual(["Grupe"]);
  });

  it("compares strictly, without type coercion", () => {
    expect(applyFilters(items, [{ field: "tezina", equals: "3" }])).toEqual([]);
  });

  it("returns the input as-is when there are no filters", () => {
    expect(applyFilters(items)).toBe(items);
    expect(applyFilters(items, [])).toBe(items);
  });
});

describe("applySort", () => {
  it("collates text with the Serbian locale (c < č < ć < d)", () => {
    const items = [
      { naslov: "Diskretna matematika" },
      { naslov: "Ćelije i tkiva" },
      { naslov: "Čvorovi i grafovi" },
      { naslov: "Cikličke grupe" },
    ];
    expect(
      naslovi(applySort(items, { field: "naslov", direction: "asc" }, schema)),
    ).toEqual([
      "Cikličke grupe",
      "Čvorovi i grafovi",
      "Ćelije i tkiva",
      "Diskretna matematika",
    ]);
  });

  it("collates š between s and t, not after z as ASCII would", () => {
    const items = [
      { naslov: "Teorija brojeva" },
      { naslov: "Šeme urni" },
      { naslov: "Skupovi i relacije" },
    ];
    expect(
      naslovi(applySort(items, { field: "naslov", direction: "asc" }, schema)),
    ).toEqual(["Skupovi i relacije", "Šeme urni", "Teorija brojeva"]);
  });

  it("compares dates as ISO strings and numbers numerically", () => {
    const dated = [
      { naslov: "B", rok: "2026-07-15" },
      { naslov: "A", rok: "2026-07-09" },
      { naslov: "C", rok: "2026-07-12" },
    ];
    expect(
      naslovi(applySort(dated, { field: "rok", direction: "asc" }, schema)),
    ).toEqual(["A", "C", "B"]);

    const weighted = [
      { naslov: "x", tezina: 10 },
      { naslov: "y", tezina: 2 },
      { naslov: "z", tezina: 5 },
    ];
    expect(
      naslovi(applySort(weighted, { field: "tezina", direction: "asc" }, schema)),
    ).toEqual(["y", "z", "x"]);
  });

  it("sorts booleans false-first ascending", () => {
    const items = [
      { naslov: "gotov", gotovo: true },
      { naslov: "otvoren", gotovo: false },
    ];
    expect(
      naslovi(applySort(items, { field: "gotovo", direction: "asc" }, schema)),
    ).toEqual(["otvoren", "gotov"]);
    expect(
      naslovi(applySort(items, { field: "gotovo", direction: "desc" }, schema)),
    ).toEqual(["gotov", "otvoren"]);
  });

  it("puts items missing the field last in both directions", () => {
    const items = [
      { naslov: "Bez roka" },
      { naslov: "Null rok", rok: null },
      { naslov: "Kasni", rok: "2026-07-20" },
      { naslov: "Rani", rok: "2026-07-01" },
    ];
    expect(
      naslovi(applySort(items, { field: "rok", direction: "asc" }, schema)),
    ).toEqual(["Rani", "Kasni", "Bez roka", "Null rok"]);
    expect(
      naslovi(applySort(items, { field: "rok", direction: "desc" }, schema)),
    ).toEqual(["Kasni", "Rani", "Bez roka", "Null rok"]);
  });

  it("is stable: equal values keep input order", () => {
    const items = [
      { naslov: "Prvi", rok: "2026-07-10" },
      { naslov: "Drugi", rok: "2026-07-10" },
      { naslov: "Treći", rok: "2026-07-05" },
    ];
    expect(
      naslovi(applySort(items, { field: "rok", direction: "asc" }, schema)),
    ).toEqual(["Treći", "Prvi", "Drugi"]);
  });

  it("returns the input as-is without a sort", () => {
    const items = [{ naslov: "Jedini" }];
    expect(applySort(items, undefined, schema)).toBe(items);
  });

  it("throws ViewConfigError for a field not in the schema", () => {
    expect(() =>
      applySort([], { field: "nepostojeće", direction: "asc" }, schema),
    ).toThrow(ViewConfigError);
  });

  it("composes with applyFilters", () => {
    const items = [
      { naslov: "Grafovi", status: "Za učenje", rok: "2026-07-18" },
      { naslov: "Analiza", status: "U toku", rok: "2026-07-08" },
      { naslov: "Grupe", status: "Za učenje", rok: "2026-07-09" },
    ];
    const shown = applySort(
      applyFilters(items, [{ field: "status", equals: "Za učenje" }]),
      { field: "rok", direction: "asc" },
      schema,
    );
    expect(naslovi(shown)).toEqual(["Grupe", "Grafovi"]);
  });
});

describe("groupForKanban", () => {
  it("buckets in options order, keeping empty option groups and a trailing ungrouped bucket", () => {
    const items = [
      { naslov: "Grafovi", status: "Za učenje" },
      { naslov: "Indukcija", status: "U toku" },
      { naslov: "Permutacije", status: "Za učenje" },
    ];
    const groups = groupForKanban(items, kanban, schema);
    expect(
      groups.map((g) => ({ value: g.value, naslovi: naslovi(g.items) })),
    ).toEqual([
      { value: "Za učenje", naslovi: ["Grafovi", "Permutacije"] },
      { value: "U toku", naslovi: ["Indukcija"] },
      { value: "Naučeno", naslovi: [] },
      { value: null, naslovi: [] },
    ]);
  });

  it("routes missing and unknown values to the ungrouped bucket", () => {
    const items = [
      { naslov: "Bez statusa" },
      { naslov: "Null status", status: null },
      { naslov: "Arhivirano", status: "Arhiva" },
    ];
    const groups = groupForKanban(items, kanban, schema);
    expect(groups.map((g) => naslovi(g.items))).toEqual([
      [],
      [],
      [],
      ["Bez statusa", "Null status", "Arhivirano"],
    ]);
  });

  it("emits the ungrouped bucket whatever ungroupedAlwaysShown says — the flag is a rendering rule", () => {
    const items = [{ naslov: "Grafovi", status: "Za učenje" }];
    for (const ungroupedAlwaysShown of [undefined, false, true]) {
      const config: KanbanViewConfig =
        ungroupedAlwaysShown === undefined
          ? { type: "kanban", groupBy: "status" }
          : { type: "kanban", groupBy: "status", ungroupedAlwaysShown };
      const groups = groupForKanban(items, config, schema);
      expect(groups.map((g) => g.value)).toEqual([
        "Za učenje",
        "U toku",
        "Naučeno",
        null,
      ]);
      expect(groups[3]?.items).toEqual([]);
    }
  });

  it("throws ViewConfigError when groupBy is not a select field", () => {
    expect(() =>
      groupForKanban([], { type: "kanban", groupBy: "naslov" }, schema),
    ).toThrow(ViewConfigError);
    expect(() =>
      groupForKanban([], { type: "kanban", groupBy: "kolona" }, schema),
    ).toThrow(ViewConfigError);
  });
});

describe("orderKanbanColumnKeys", () => {
  it("puts listed keys first in their listed order, appends the rest naturally, drops unknown keys", () => {
    expect(orderKanbanColumnKeys(["a", "b", "c"], ["c", "x", "a"])).toEqual(["c", "a", "b"]);
  });

  it("returns the natural order untouched without an order, and ignores a duplicate entry", () => {
    expect(orderKanbanColumnKeys(["a", "b"], undefined)).toEqual(["a", "b"]);
    expect(orderKanbanColumnKeys(["a", "b"], [])).toEqual(["a", "b"]);
    expect(orderKanbanColumnKeys(["a", "b"], ["b", "b"])).toEqual(["b", "a"]);
  });
});

describe("arrangeKanbanColumns", () => {
  // The board as KanbanView draws it before arranging: keyed columns in natural
  // order, the ungrouped bucket trailing.
  const board = (): KanbanGroup<Record<string, unknown>>[] => [
    { value: "Za učenje", items: [{ naslov: "a" }] },
    { value: "U toku", items: [] },
    { value: "Naučeno", items: [{ naslov: "b" }] },
    { value: null, items: [{ naslov: "c" }] },
  ];
  const values = (groups: readonly KanbanGroup<Record<string, unknown>>[]) =>
    groups.map((g) => g.value);

  it("returns the drawn columns unchanged when nothing is configured", () => {
    expect(values(arrangeKanbanColumns(board(), kanban))).toEqual([
      "Za učenje",
      "U toku",
      "Naučeno",
      null,
    ]);
  });

  it("draws ordered keys first, appends the unlisted in natural order, keeps the bucket trailing", () => {
    expect(
      values(arrangeKanbanColumns(board(), { ...kanban, columnOrder: ["Naučeno"] })),
    ).toEqual(["Naučeno", "Za učenje", "U toku", null]);
  });

  it("drops order keys the board does not have — a stale id must not conjure a column", () => {
    expect(
      values(arrangeKanbanColumns(board(), { ...kanban, columnOrder: ["Nema", "U toku"] })),
    ).toEqual(["U toku", "Za učenje", "Naučeno", null]);
  });

  it("does not draw hidden columns, and can never hide the ungrouped bucket", () => {
    expect(
      values(arrangeKanbanColumns(board(), { ...kanban, hiddenColumns: ["U toku"] })),
    ).toEqual(["Za učenje", "Naučeno", null]);
  });

  it("ignores a hidden set that would leave the board without a single column", () => {
    const everything = ["Za učenje", "U toku", "Naučeno"];
    const noBucket = board().filter((g) => g.value !== null);
    expect(
      values(arrangeKanbanColumns(noBucket, { ...kanban, hiddenColumns: everything })),
    ).toEqual(everything);
    // With the bucket drawn the board keeps a column, so the hiding stands.
    expect(
      values(arrangeKanbanColumns(board(), { ...kanban, hiddenColumns: everything })),
    ).toEqual([null]);
  });
});

describe("the cards and calendar configs", () => {
  const items = [
    { naslov: "Grafovi", status: "Za učenje", rok: "2026-07-18" },
    { naslov: "Analiza", status: "U toku", rok: "2026-07-08" },
    { naslov: "Grupe", status: "Za učenje", rok: "2026-07-09" },
  ];

  it("drives the same filter+sort pipeline the list config does", () => {
    const cards: CardsViewConfig = {
      type: "cards",
      sort: { field: "rok", direction: "asc" },
      filters: [{ field: "status", equals: "Za učenje" }],
    };
    expect(
      naslovi(applySort(applyFilters(items, cards.filters), cards.sort, schema)),
    ).toEqual(["Grupe", "Grafovi"]);
  });

  it("filters for the calendar, whose order is the calendar's own — there is no sort to apply", () => {
    const calendar: CalendarViewConfig = {
      type: "calendar",
      filters: [{ field: "status", equals: "U toku" }],
    };
    expect(naslovi(applyFilters(items, calendar.filters))).toEqual(["Analiza"]);
  });
});

describe("moveBetweenGroups", () => {
  const item = { naslov: "Grafovi", status: "Za učenje" };

  it("returns the patch that sets the grouped field to the target column", () => {
    expect(moveBetweenGroups(item, "U toku", kanban)).toEqual({
      status: "U toku",
    });
  });

  it("returns a clearing patch for the ungrouped bucket", () => {
    expect(moveBetweenGroups(item, null, kanban)).toEqual({ status: null });
  });

  it("keys the patch off the config's groupBy field", () => {
    const byPriority: KanbanViewConfig = { type: "kanban", groupBy: "prioritet" };
    expect(moveBetweenGroups(item, "visok", byPriority)).toEqual({
      prioritet: "visok",
    });
  });
});

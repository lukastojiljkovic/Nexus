import { describe, it, expect } from "vitest";
import type { CollectionSchema } from "./fields.js";
import type { KanbanViewConfig } from "./viewConfig.js";
import {
  applyFilters,
  applySort,
  groupForKanban,
  moveBetweenGroups,
  ViewConfigError,
} from "./engine.js";

const schema: CollectionSchema = {
  fields: [
    { key: "naslov", type: "text", titleKey: "task.title" },
    { key: "rok", type: "date", titleKey: "task.due" },
    {
      key: "status",
      type: "select",
      titleKey: "task.status",
      options: ["Za učenje", "U toku", "Naučeno"],
    },
    { key: "tezina", type: "number", titleKey: "task.effort" },
    { key: "gotovo", type: "boolean", titleKey: "task.done" },
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

  it("throws ViewConfigError when groupBy is not a select field", () => {
    expect(() =>
      groupForKanban([], { type: "kanban", groupBy: "naslov" }, schema),
    ).toThrow(ViewConfigError);
    expect(() =>
      groupForKanban([], { type: "kanban", groupBy: "kolona" }, schema),
    ).toThrow(ViewConfigError);
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

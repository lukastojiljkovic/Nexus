import { describe, expect, it } from "vitest";
import { COMPONENT_CATALOGUE, COMPONENT_KINDS, catalogueComponent } from "@nexus/core";
import type { ComponentDef } from "@nexus/core";

import {
  filterComponents,
  groupComponentsByKind,
  matchesComponentQuery,
  PALETTE_KINDS,
  partDisplayName,
} from "./elecCatalogue.js";

const component = (over: Partial<ComponentDef> = {}): ComponentDef => ({
  id: "fixture",
  kind: "sensor",
  name: "Fixture",
  summary: "Merenje",
  buses: [],
  pins: [{ id: "P", label: "P", functions: ["passive"] }],
  ...over,
});

describe("matchesComponentQuery", () => {
  it("matches everything on a blank query — an empty field is not a filter", () => {
    expect(matchesComponentQuery(component(), "")).toBe(true);
    expect(matchesComponentQuery(component(), "   ")).toBe(true);
  });

  it("folds diacritics and case, so a query typed without them still lands", () => {
    const part = component({ name: "Senzor vlažnosti", summary: "Meri vlagu i temperaturu" });
    expect(matchesComponentQuery(part, "vlaznosti")).toBe(true);
    expect(matchesComponentQuery(part, "VLAGU")).toBe(true);
  });

  it("requires EVERY term to land, so a second word narrows rather than widens", () => {
    const part = component({ name: "DHT22", summary: "Temperatura i vlažnost" });
    expect(matchesComponentQuery(part, "dht vlaznost")).toBe(true);
    expect(matchesComponentQuery(part, "dht ultrazvuk")).toBe(false);
  });

  it("finds a part by the protocol it speaks", () => {
    const i2c = component({
      buses: [{ kind: "i2c", addresses: [0x76] }],
      pins: [
        { id: "SDA", label: "SDA", functions: ["i2c-sda"] },
        { id: "SCL", label: "SCL", functions: ["i2c-scl"] },
      ],
    });
    expect(matchesComponentQuery(i2c, "i2c")).toBe(true);
    expect(matchesComponentQuery(component(), "i2c")).toBe(false);
  });

  it("finds a part by its slug and by the library the sketch will include", () => {
    const part = component({ id: "hc-sr04", library: "NewPing" });
    expect(matchesComponentQuery(part, "sr04")).toBe(true);
    expect(matchesComponentQuery(part, "newping")).toBe(true);
  });

  /**
   * The rule that keeps the search worth having. Nearly every part in the
   * catalogue has a GND and a VCC, so folding the pin labels into the
   * searchable text would make those two queries answer with the whole
   * catalogue — a search that matches everything is the same as no search.
   */
  it("does not match on pin labels, which nearly every part shares", () => {
    const part = component({
      pins: [
        { id: "VCC", label: "VCC", functions: ["power-in"] },
        { id: "GND", label: "GND", functions: ["gnd"] },
      ],
    });
    expect(matchesComponentQuery(part, "gnd")).toBe(false);
  });
});

describe("filterComponents", () => {
  it("keeps catalogue order rather than ranking, so a row does not move while typing", () => {
    const list = [
      component({ id: "a", name: "Zeta", summary: "senzor" }),
      component({ id: "b", name: "Alfa", summary: "senzor" }),
    ];
    expect(filterComponents(list, "senzor").map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("narrows the real catalogue to a handful, and to nothing for a query nothing answers", () => {
    const matches = filterComponents(COMPONENT_CATALOGUE, "dht22");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((entry) => matchesComponentQuery(entry, "dht22"))).toBe(true);
    expect(filterComponents(COMPONENT_CATALOGUE, "zzzz-nema-ovoga")).toEqual([]);
  });
});

describe("groupComponentsByKind", () => {
  it("is the model's own kind order, never a second list of the same names", () => {
    expect(PALETTE_KINDS).toEqual(COMPONENT_KINDS);
  });

  it("groups in that order and leaves out what nothing matched", () => {
    const groups = groupComponentsByKind([
      component({ id: "r", kind: "passive" }),
      component({ id: "u", kind: "board" }),
      component({ id: "s", kind: "sensor" }),
    ]);
    expect(groups.map((group) => group.kind)).toEqual(["board", "sensor", "passive"]);
    expect(groups.map((group) => group.components.map((entry) => entry.id))).toEqual([
      ["u"],
      ["s"],
      ["r"],
    ]);
  });

  it("covers the whole shipped catalogue without dropping a part", () => {
    const groups = groupComponentsByKind(COMPONENT_CATALOGUE);
    const grouped = groups.flatMap((group) => group.components);
    expect(grouped).toHaveLength(COMPONENT_CATALOGUE.length);
    expect(new Set(grouped.map((entry) => entry.id)).size).toBe(COMPONENT_CATALOGUE.length);
  });

  it("has nothing to draw for an empty list", () => {
    expect(groupComponentsByKind([])).toEqual([]);
  });
});

describe("partDisplayName", () => {
  const uno = catalogueComponent("arduino-uno");

  it("prefers the user's own label", () => {
    expect(partDisplayName("levi motor", uno, "Nepoznata")).toBe("levi motor");
  });

  it("falls back to the component's name when the label is blank", () => {
    expect(uno).toBeDefined();
    expect(partDisplayName("", uno, "Nepoznata")).toBe(uno?.name);
    expect(partDisplayName("   ", uno, "Nepoznata")).toBe(uno?.name);
  });

  it("says the caller's placeholder for a component this build does not ship", () => {
    expect(partDisplayName("", undefined, "Nepoznata komponenta")).toBe("Nepoznata komponenta");
  });

  /**
   * A part whose component is gone but which the user NAMED keeps its name.
   * The label is their work; the missing catalogue entry is ours.
   */
  it("keeps a named part's name even when its component is gone", () => {
    expect(partDisplayName("levi motor", undefined, "Nepoznata")).toBe("levi motor");
  });
});

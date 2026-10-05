import { afterEach, describe, expect, it } from "vitest";
import { catalogueComponent } from "@nexus/core";
import type { ComponentDef } from "@nexus/core";

import { componentName, componentSummary, pinLabel } from "./elecLocale.js";
import { applyLocale, DEFAULT_LOCALE } from "./strings.js";

/**
 * The catalogue's English copy, read through the renderer's edge.
 *
 * The package runs in Serbian (the process default), which is why this file
 * switches to English itself and switches back. Every module above was imported
 * before any `applyLocale` ran, so a reader that captured the locale at import
 * time would fail these tests.
 */

afterEach(() => {
  applyLocale(DEFAULT_LOCALE);
});

function shipped(id: string): ComponentDef {
  const found = catalogueComponent(id);
  if (found === undefined) throw new Error(`the catalogue does not ship ${id}`);
  return found;
}

/** A component the user typed into the drawer, which has no English to give. */
const ownPart: ComponentDef = {
  id: "moj-senzor",
  kind: "sensor",
  name: "Moj senzor",
  summary: "Meri nešto",
  buses: [],
  pins: [{ id: "P", label: "P", functions: ["passive"] }],
};

describe("the electronics catalogue in English", () => {
  it("answers the shipped English name and summary after a switch", () => {
    const resistor = shipped("resistor");
    expect(componentName(resistor)).toBe("Otpornik");
    expect(componentSummary(resistor)).toMatch(/Ograničava struju/);

    applyLocale("en");
    expect(componentName(resistor)).toBe("Resistor");
    expect(componentSummary(resistor)).toBe(
      "It limits current. The value is chosen for the circuit, not from a catalogue number.",
    );

    applyLocale("sr");
    expect(componentName(resistor)).toBe("Otpornik");
  });

  it("keeps Serbian for a component the user defined, which has no English", () => {
    applyLocale("en");
    expect(componentName(ownPart)).toBe("Moj senzor");
    expect(componentSummary(ownPart)).toBe("Meri nešto");
  });

  it("translates the pins whose label is a Serbian word, and leaves the rest alone", () => {
    const wiper = shipped("potentiometer").pins.find((pin) => pin.id === "W");
    const ground = shipped("potentiometer").pins.find((pin) => pin.id === "1");
    expect(wiper).toBeDefined();
    expect(ground).toBeDefined();
    if (wiper === undefined || ground === undefined) return;

    expect(pinLabel(wiper)).toBe("klizač");
    applyLocale("en");
    expect(pinLabel(wiper)).toBe("wiper");
    // A pin whose label is already the silkscreen's own letters is unchanged.
    expect(pinLabel(ground)).toBe("1");
  });
});

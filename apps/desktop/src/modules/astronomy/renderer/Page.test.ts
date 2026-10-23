import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BodyId, BodyState, SolarSystemSnapshot } from "@nexus/core";
import { BodyCardPanel } from "./BodyCardPanel.js";
import { copy } from "./copy.js";
import { AstronomyToolbar, SolarSection } from "./Page.js";

type TabId = "solar" | "earth" | "stars" | "sunmoon";

/**
 * The toolbar as the page draws it. The root of the markup IS the toolbar's
 * group, so every switch the markup contains is a switch inside it.
 */
function toolbarFor(tab: TabId): string {
  return renderToStaticMarkup(
    createElement(AstronomyToolbar, {
      tab,
      onTab: () => {},
      scale: "readable",
      onScale: () => {},
      nightMode: false,
      onNightMode: () => {},
    }),
  );
}

const TOOLBAR_OPEN = /^<div class="nx-toolbar" role="group" aria-label="[^"]+">/;

function switchOpen(label: string): string {
  return `<div class="astronomy__scales" role="group" aria-label="${label}">`;
}

describe("AstronomyToolbar", () => {
  it("draws the scale switch inside the toolbar group in the solar tab", () => {
    const html = toolbarFor("solar");
    expect(html).toMatch(TOOLBAR_OPEN);
    expect(html).toContain(switchOpen(copy.solar.scaleLabel));
    expect(html).not.toContain(copy.stars.nightLabel);
  });

  it("draws the night switch inside the toolbar group in the stars tab", () => {
    const html = toolbarFor("stars");
    expect(html).toMatch(TOOLBAR_OPEN);
    expect(html).toContain(switchOpen(copy.stars.nightLabel));
    expect(html).not.toContain(copy.solar.scaleLabel);
  });

  it("draws no view switch in the earth and sun-moon tabs", () => {
    for (const tab of ["earth", "sunmoon"] as const) {
      const html = toolbarFor(tab);
      expect(html).toMatch(TOOLBAR_OPEN);
      expect(html).not.toContain("astronomy__scales");
    }
  });
});

const IDS: readonly BodyId[] = [
  "sun",
  "mercury",
  "venus",
  "earth",
  "moon",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
];

const snapshot: SolarSystemSnapshot = {
  instantMs: 0,
  bodies: IDS.map(
    (id, index): BodyState => ({
      id,
      position: [index * 0.1, 0, 0],
      radiusKm: 1000,
      rotationDeg: 0,
      northPole: [0, 0, 1],
      distanceFromEarthAu: 0,
    }),
  ),
};

describe("BodyCard", () => {
  it("draws the body's name, the close button and the facts heading for the Earth", () => {
    const html = renderToStaticMarkup(
      createElement(BodyCardPanel, { snapshot, id: "earth", onClose: () => {} }),
    );
    expect(html).toContain(`aria-label="Zemlja"`);
    expect(html).toContain(`aria-label="${copy.card.close}"`);
    expect(html).toContain(copy.card.facts);
  });
});

describe("SolarSection", () => {
  const section = (selected: BodyId | null) =>
    renderToStaticMarkup(
      createElement(SolarSection, {
        snapshot,
        orbits: [],
        textures: null,
        packsRead: false,
        scale: "readable",
        selected,
        onSelect: () => {},
      }),
    );

  it("draws no body card while nothing is selected", () => {
    expect(section(null)).not.toContain("astronomy__bodycard");
  });

  it("draws the body card while a body is selected", () => {
    expect(section("earth")).toContain("astronomy__bodycard");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { copy } from "./copy.js";
import { AstronomyToolbar } from "./Page.js";

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

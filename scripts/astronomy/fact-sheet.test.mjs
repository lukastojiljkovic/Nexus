import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parsePlanetFactSheet, parseSunFactSheet } from "./fact-sheet.mjs";

/**
 * The parser runs on the two NASA pages saved in `fixtures/`, so the tests never
 * touch the network and pin what the published text says, not what a later page
 * says. Every expected value below is copied from the fixture's own cell.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures", name), "utf8");

const planets = parsePlanetFactSheet(fixture("planetfact.html"));
const sun = parseSunFactSheet(fixture("sunfact.html"));

describe("parsePlanetFactSheet", () => {
  it("keys one row set per body column, Moon included", () => {
    expect(Object.keys(planets).sort()).toEqual(
      ["earth", "jupiter", "mars", "mercury", "moon", "neptune", "pluto", "saturn", "uranus", "venus"],
    );
  });

  it("keeps every row of the table, with its unit split from its label", () => {
    expect(planets.earth.mass).toMatchObject({ label: "Mass", unit: "10^24 kg" });
    expect(planets.earth.orbitalEccentricity).toMatchObject({ unit: null });
    expect(Object.keys(planets.earth)).toHaveLength(20);
  });

  it("pins Earth's mass to the published text and its number", () => {
    expect(planets.earth.mass.value).toEqual({ text: "5.97", number: 5.97 });
  });

  it("pins the number of moons of Jupiter", () => {
    expect(planets.jupiter.numberOfMoons.value).toEqual({ text: "95", number: 95 });
  });

  it("pins the Moon's surface gravity", () => {
    expect(planets.moon.gravity.value).toEqual({ text: "1.6", number: 1.6 });
  });

  it("keeps a footnote mark in the text and strips it from the number", () => {
    expect(planets.moon.distanceFromSun.value).toEqual({ text: "0.384*", number: 0.384 });
  });

  it("keeps negative values for retrograde rotation", () => {
    expect(planets.venus.rotationPeriod.value).toEqual({ text: "-5832.5", number: -5832.5 });
  });

  it("keeps Yes/No rows as booleans and Unknown as null", () => {
    expect(planets.saturn.ringSystem.value).toEqual({ text: "Yes", flag: true });
    expect(planets.earth.ringSystem.value).toEqual({ text: "No", flag: false });
    expect(planets.pluto.globalMagneticField.value).toEqual({ text: "Unknown", flag: null });
  });
});

describe("parseSunFactSheet", () => {
  it("keeps only the rows with a planet counterpart, plus the sidereal rotation period", () => {
    expect(Object.keys(sun.sun).sort()).toEqual(
      [
        "escapeVelocity",
        "mass",
        "meanDensity",
        "siderealRotationPeriod",
        "surfaceGravity",
        "volume",
        "volumetricMeanRadius",
      ].sort(),
    );
  });

  it("pins the Sun's mean radius to the published text and its number", () => {
    expect(sun.sun.volumetricMeanRadius.value).toEqual({ text: "695,700.", number: 695700 });
  });

  it("strips the footnote mark from the sidereal rotation period label", () => {
    expect(sun.sun.siderealRotationPeriod).toMatchObject({ label: "Sidereal rotation period", unit: "hrs" });
    expect(sun.sun.siderealRotationPeriod.value).toEqual({ text: "609.12", number: 609.12 });
  });
});

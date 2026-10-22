import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BodyId, BodyState, SolarSystemSnapshot } from "@nexus/core";

import { applyLocale } from "../../../renderer/src/strings.js";
import { BODY_FACTS } from "../shared/facts.js";
import { bodyCardModel, formatDistance, formatLightTime } from "./bodyCard.js";
import { KM_PER_AU } from "./solar/scale.js";

/**
 * The card's arithmetic, over a hand-made snapshot. The positions are chosen so
 * the distances are easy to check by hand; they are not real ephemerides. The
 * Moon sits 384 400 km from the Earth, which is the one number here that is a
 * fact, and it is written as the fact it is.
 */

afterEach(() => {
  applyLocale("sr");
});

const MOON_AU = 384_400 / KM_PER_AU;

/** A published number from the fact table, read the way the card reads it. */
function published(id: BodyId, row: string): number {
  const value = BODY_FACTS[id][row]?.value;
  if (value === undefined || !("number" in value) || value.number === null) {
    throw new Error(`${id}.${row} has no published number`);
  }
  return value.number;
}
const SPEED_OF_LIGHT_M_S = 299_792_458;

function body(id: BodyId, position: readonly [number, number, number]): BodyState {
  return {
    id,
    position,
    radiusKm: 1000,
    rotationDeg: 0,
    northPole: [0, 0, 1],
    distanceFromEarthAu: 0,
  };
}

const snapshot: SolarSystemSnapshot = {
  instantMs: 0,
  bodies: [
    body("sun", [0, 0, 0]),
    body("earth", [1, 0, 0]),
    body("moon", [1 + MOON_AU, 0, 0]),
    body("mercury", [-0.4, 0, 0]),
    body("venus", [0, 0.7, 0]),
    body("mars", [0, 0, 1.5]),
  ],
};

describe("bodyCardModel", () => {
  it("classifies the Sun as a star, Pluto as a dwarf planet, the Moon as a moon and the rest as planets", () => {
    expect(bodyCardModel(snapshot, "sun").kind).toBe("star");
    expect(bodyCardModel(snapshot, "moon").kind).toBe("moon");
    expect(bodyCardModel(snapshot, "mars").kind).toBe("planet");
    expect(
      bodyCardModel(
        { instantMs: 0, bodies: [...snapshot.bodies, body("pluto", [0, 0, 39])] },
        "pluto",
      ).kind,
    ).toBe("dwarf");
  });

  it("measures distances from the Sun and from the Earth as the length of the position difference", () => {
    const venus = bodyCardModel(snapshot, "venus");
    expect(venus.fromSunAu).toBeCloseTo(0.7, 12);
    expect(venus.fromEarthAu).toBeCloseTo(Math.sqrt(1 + 0.49), 12);
  });

  it("has no distance from the Sun for the Sun, and none from the Earth for the Earth", () => {
    expect(bodyCardModel(snapshot, "sun").fromSunAu).toBeNull();
    expect(bodyCardModel(snapshot, "earth").fromEarthAu).toBeNull();
    expect(bodyCardModel(snapshot, "earth").fromSunAu).toBeCloseTo(1, 12);
  });

  it("gives the light time from the Earth as the distance over the speed of light, and none for the Earth", () => {
    expect(bodyCardModel(snapshot, "moon").lightSeconds).toBeCloseTo(
      384_400_000 / SPEED_OF_LIGHT_M_S,
      6,
    );
    expect(bodyCardModel(snapshot, "earth").lightSeconds).toBeNull();
  });

  it("names the nearest other body, the Sun included, and lists every other body nearest first", () => {
    const moon = bodyCardModel(snapshot, "moon");
    expect(moon.nearest).toEqual({ id: "earth", au: expect.closeTo(MOON_AU, 12) });

    const earth = bodyCardModel(snapshot, "earth");
    expect(earth.nearest?.id).toBe("moon");
    expect(earth.others.map((other) => other.id)).toEqual(["moon", "sun", "venus", "mercury", "mars"]);
    expect(earth.others).toHaveLength(snapshot.bodies.length - 1);
  });

  it("reads the Sun's diameter as twice its volumetric mean radius", () => {
    const facts = bodyCardModel(snapshot, "sun").facts;
    const diameter = facts.find((fact) => fact.key === "diameter");
    expect(diameter?.value).toBe(2 * published("sun", "volumetricMeanRadius"));
  });

  it("lists the Sun's facts in order, with the rotation period and no orbit", () => {
    const keys = bodyCardModel(snapshot, "sun").facts.map((fact) => fact.key);
    expect(keys).toEqual(["diameter", "mass", "gravity", "rotation"]);
  });

  it("reads the Earth's own rows from the published table and leaves out the rows it does not have", () => {
    const facts = bodyCardModel(snapshot, "earth").facts;
    expect(facts.map((fact) => fact.key)).toEqual([
      "diameter",
      "mass",
      "gravity",
      "day",
      "orbit",
      "temperature",
      "moons",
      "rings",
    ]);
    expect(facts.find((fact) => fact.key === "orbit")?.value).toBe(published("earth", "orbitalPeriod"));
    expect(facts.find((fact) => fact.key === "rings")?.value).toBe(false);
  });

  it("gives the Moon its orbit around the Earth under its own key", () => {
    const keys = bodyCardModel(snapshot, "moon").facts.map((fact) => fact.key);
    expect(keys).toContain("orbitMoon");
    expect(keys).not.toContain("orbit");
    expect(bodyCardModel(snapshot, "moon").facts.find((fact) => fact.key === "orbitMoon")?.value).toBe(
      published("moon", "orbitalPeriod"),
    );
  });
});

describe("formatDistance", () => {
  beforeEach(() => applyLocale("en"));

  it("writes a distance under 0.01 au in whole kilometres", () => {
    expect(formatDistance(0.005, "en")).toBe("747,989 km");
    expect(formatDistance(MOON_AU, "en")).toBe("384,400 km");
  });

  it("writes a distance from 0.01 au in au and in million kilometres", () => {
    expect(formatDistance(0.01, "en")).toBe("0.010 au · 1.5 million km");
    expect(formatDistance(1, "en")).toBe("1.000 au · 149.6 million km");
  });

  it("follows the interface language", () => {
    applyLocale("sr");
    expect(formatDistance(1, "sr")).toBe("1,000 au · 149,6 mil. km");
    expect(formatDistance(0.005, "sr")).toBe("747.989 km");
  });
});

describe("formatLightTime", () => {
  beforeEach(() => applyLocale("en"));

  it("writes less than 120 seconds in seconds, to one decimal", () => {
    expect(formatLightTime(119.94, "en")).toBe("119.9 s");
    expect(formatLightTime(1.282, "en")).toBe("1.3 s");
  });

  it("writes from 120 seconds to under 120 minutes in minutes, to one decimal", () => {
    expect(formatLightTime(120, "en")).toBe("2.0 min");
    expect(formatLightTime(499.0047838, "en")).toBe("8.3 min");
    expect(formatLightTime(7140, "en")).toBe("119.0 min");
  });

  it("writes from 120 minutes in hours, to one decimal", () => {
    expect(formatLightTime(7200, "en")).toBe("2.0 h");
  });

  it("follows the interface language", () => {
    applyLocale("sr");
    expect(formatLightTime(499.0047838, "sr")).toBe("8,3 min");
    expect(formatLightTime(7200, "sr")).toBe("2,0 h");
  });
});

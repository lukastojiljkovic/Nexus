import { describe, expect, it } from "vitest";
import type { BodyId } from "@nexus/core";

import { BODY_LABELS, BODY_ORDER, bodyLabel } from "./bodies.js";

/**
 * The eleven bodies and their two names.
 *
 * The list is the contract's own union, written out once here so that a body
 * added to `BodyId` and forgotten in `BODY_ORDER` is a failing test rather than
 * a planet with no name. The Cyrillic check is the second half: this interface is
 * in Latin-script Serbian, and no copy in it may arrive in the other script.
 */

const CONTRACT_BODIES: readonly BodyId[] = [
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

const CYRILLIC = /[\u0400-\u04FF]/;

describe("BODY_ORDER", () => {
  it("is exactly the contract's bodies, once each", () => {
    expect([...BODY_ORDER].sort()).toEqual([...CONTRACT_BODIES].sort());
    expect(new Set(BODY_ORDER).size).toBe(BODY_ORDER.length);
  });

  it("runs from the Sun outwards, with the Moon beside its planet", () => {
    expect(BODY_ORDER[0]).toBe("sun");
    expect(BODY_ORDER.indexOf("moon")).toBe(BODY_ORDER.indexOf("earth") + 1);
    expect(BODY_ORDER.indexOf("pluto")).toBe(BODY_ORDER.length - 1);
  });
});

describe("BODY_LABELS", () => {
  it("names every body in both languages, and names it briefly", () => {
    for (const id of CONTRACT_BODIES) {
      const label = BODY_LABELS[id];
      expect(label.sr.length).toBeGreaterThan(0);
      expect(label.en.length).toBeGreaterThan(0);
      // A label is drawn beside a sphere a few pixels across; a sentence would
      // cover the screen it is labelling.
      expect(label.sr.length).toBeLessThanOrEqual(12);
      expect(label.en.length).toBeLessThanOrEqual(12);
    }
  });

  it("writes Serbian in Latin script", () => {
    for (const id of CONTRACT_BODIES) {
      expect(BODY_LABELS[id].sr).not.toMatch(CYRILLIC);
      expect(BODY_LABELS[id].en).not.toMatch(CYRILLIC);
    }
  });

  it("reads a name out of the table for a named language", () => {
    expect(bodyLabel("earth", "sr")).toBe("Zemlja");
    expect(bodyLabel("earth", "en")).toBe("Earth");
    expect(bodyLabel("moon", "sr")).toBe("Mesec");
    expect(bodyLabel("moon", "en")).toBe("Moon");
  });
});

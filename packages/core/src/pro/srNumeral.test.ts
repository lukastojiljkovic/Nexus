import { describe, expect, it } from "vitest";

import { agreementOf, groupWords, unitWord } from "./srNumeral.js";

describe("agreementOf", () => {
  it("takes the singular for 1 and every 1 but 11", () => {
    expect([1, 21, 101].map(agreementOf)).toEqual(["singular", "singular", "singular"]);
    expect(agreementOf(11)).toBe("plural");
  });

  it("takes the paucal for 2–4 except 12–14", () => {
    expect([2, 3, 4, 22, 102].map(agreementOf)).toEqual(["paucal", "paucal", "paucal", "paucal", "paucal"]);
    expect([12, 13, 14, 112].map(agreementOf)).toEqual(["plural", "plural", "plural", "plural"]);
  });

  it("takes the plural for 0, 5–10 and 15–20", () => {
    expect([0, 5, 10, 15, 20].map(agreementOf)).toEqual(["plural", "plural", "plural", "plural", "plural"]);
  });
});

describe("unitWord", () => {
  it("inflects 1 and 2 for gender only", () => {
    expect(unitWord(1, "masculine")).toBe("jedan");
    expect(unitWord(1, "feminine")).toBe("jedna");
    expect(unitWord(1, "neuter")).toBe("jedno");
    expect(unitWord(2, "masculine")).toBe("dva");
    expect(unitWord(2, "feminine")).toBe("dve");
    expect(unitWord(2, "neuter")).toBe("dva");
  });

  it("never inflects the teens", () => {
    expect(unitWord(12, "feminine")).toBe("dvanaest");
    expect(unitWord(11, "neuter")).toBe("jedanaest");
  });
});

describe("groupWords", () => {
  it("spells a group of 0–999 one word per element", () => {
    expect(groupWords(0, "masculine")).toEqual([]);
    expect(groupWords(100, "masculine")).toEqual(["sto"]);
    expect(groupWords(21, "feminine")).toEqual(["dvadeset", "jedna"]);
    expect(groupWords(112, "masculine")).toEqual(["sto", "dvanaest"]);
    expect(groupWords(321, "feminine")).toEqual(["trista", "dvadeset", "jedna"]);
    expect(groupWords(302, "feminine")).toEqual(["trista", "dve"]);
    expect(groupWords(999, "masculine")).toEqual(["devetsto", "devedeset", "devet"]);
  });
});

import { describe, expect, it } from "vitest";

import { disputedAreas, disputesWithin } from "../../shared/world/disputed.js";
import { cardDisputes, disputePartyNames } from "./disputes.js";

function area(id: string) {
  const found = disputedAreas.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no disputed area ${id}`);
  return found;
}

function container(id: string): string {
  const found = area(id).within[0];
  if (found === undefined) throw new Error(`no container territory for ${id}`);
  return found;
}

describe("cardDisputes", () => {
  it("puts Kosovo's dispute on Serbia's card, with Kosovo and Serbia in both languages", () => {
    expect(cardDisputes("SRB", "en")[0]).toMatchObject({
      id: "kosovo",
      name: "Kosovo",
      status: "Disputed territory",
      parties: "Parties: Kosovo, Serbia",
    });
    expect(cardDisputes("SRB", "sr")[0]).toMatchObject({
      id: "kosovo",
      name: "Kosovo",
      status: "Sporna teritorija",
      parties: "Strane u sporu: Kosovo, Srbija",
    });
  });

  it("puts a territory's own dispute before other areas that overlap it", () => {
    expect(cardDisputes("SAH", "en")[0]?.id).toBe("western-sahara");
  });

  it("lists Crimea on the territory that contains it, in both languages", () => {
    const territory = container("crimea");
    const english = cardDisputes(territory, "en").find((entry) => entry.id === "crimea");
    const serbian = cardDisputes(territory, "sr").find((entry) => entry.id === "crimea");

    expect(english?.parties).toBe("Parties: Russia, Ukraine");
    expect(serbian?.parties).toBe("Strane u sporu: Rusija, Ukrajina");
  });

  it("reads Bir Tawil as unclaimed on the territory that contains it, in both languages", () => {
    const territory = container("bir-tawil");
    const english = cardDisputes(territory, "en").find((entry) => entry.id === "bir-tawil");
    const serbian = cardDisputes(territory, "sr").find((entry) => entry.id === "bir-tawil");

    expect(english?.parties).toBe("Claimed by no state");
    expect(serbian?.parties).toBe("Nijedna država ne polaže pravo na nju");
  });

  it("draws no dispute block for a territory with no disputed area in it", () => {
    expect(disputesWithin("SWE")).toEqual([]);
    expect(cardDisputes("SWE", "en")).toEqual([]);
    expect(cardDisputes("SWE", "sr")).toEqual([]);
  });

  it("orders party names with the reader's collation, not the stored id order", () => {
    const parties = ["TWN", "CHN", "PHL", "MYS", "BRN", "VNM"];

    expect(disputePartyNames(parties, "Spratly Islands", "en")).toEqual([
      "Brunei",
      "China",
      "Malaysia",
      "Philippines",
      "Taiwan",
      "Vietnam",
    ]);
    expect(disputePartyNames(parties, "Spratly Islands", "sr")).toEqual([
      "Brunej",
      "Filipini",
      "Kina",
      "Malezija",
      "Tajvan",
      "Vijetnam",
    ]);
  });

  it("uses the disputed area's own name for a self-administering party", () => {
    expect(disputePartyNames(["self", "CHN"], "Taiwan", "en")).toEqual(["China", "Taiwan"]);
  });
});

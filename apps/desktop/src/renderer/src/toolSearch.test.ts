import { describe, expect, it } from "vitest";

import { filterTools, matchesToolQuery, type SearchableTool } from "./toolSearch.js";

const TOOLS: SearchableTool[] = [
  { id: "duzina", name: "Dužina", category: "conversion", keywords: ["metar", "milja", "inc"] },
  { id: "povrsina", name: "Površina", category: "conversion", keywords: ["hektar", "aker"] },
  { id: "podaci", name: "Podaci", category: "conversion", keywords: ["bajt", "kilobajt"] },
  { id: "pdv", name: "PDV", category: "calculation", keywords: ["porez", "osnovica"] },
  { id: "kredit", name: "Kredit", category: "calculation", keywords: ["rata", "anuitet"] },
];

describe("matchesToolQuery", () => {
  it("matches a plain prefix of the name", () => {
    expect(matchesToolQuery(TOOLS[0]!, "duz")).toBe(true);
    expect(matchesToolQuery(TOOLS[0]!, "kre")).toBe(false);
  });

  /**
   * The reason folding is used rather than a bare `toLowerCase`: a user typing
   * a query is not also typing diacritics, and „povrsina" must find „Površina"
   * — otherwise the tool with the awkward name is the one nobody can reach.
   */
  it("matches across diacritics, in both directions", () => {
    expect(matchesToolQuery(TOOLS[1]!, "povrsina")).toBe(true);
    expect(matchesToolQuery(TOOLS[1]!, "površ")).toBe(true);
    expect(matchesToolQuery(TOOLS[0]!, "duzina")).toBe(true);
  });

  it("ignores case", () => {
    expect(matchesToolQuery(TOOLS[3]!, "pdv")).toBe(true);
    expect(matchesToolQuery(TOOLS[3]!, "PDV")).toBe(true);
  });

  it("matches a declared keyword, which is what makes a drawer findable by what a tool DOES", () => {
    // Nobody looks for the loan calculator by typing „kredit" only.
    expect(matchesToolQuery(TOOLS[4]!, "anuitet")).toBe(true);
    expect(matchesToolQuery(TOOLS[4]!, "rata")).toBe(true);
    // „porez" finds PDV even though the word is not in its name.
    expect(matchesToolQuery(TOOLS[3]!, "porez")).toBe(true);
  });

  it("matches a substring inside a keyword, so a half-typed word still narrows", () => {
    expect(matchesToolQuery(TOOLS[2]!, "bajt")).toBe(true);
    expect(matchesToolQuery(TOOLS[2]!, "kilo")).toBe(true);
  });

  it("treats a blank query as no filter at all — an empty field is not a search", () => {
    for (const tool of TOOLS) {
      expect(matchesToolQuery(tool, ""), tool.id).toBe(true);
      expect(matchesToolQuery(tool, "   "), tool.id).toBe(true);
    }
  });

  it("matches nothing for a query no tool answers", () => {
    for (const tool of TOOLS) expect(matchesToolQuery(tool, "zzzz"), tool.id).toBe(false);
  });

  it("survives a tool that declares no keywords", () => {
    const bare: SearchableTool = { id: "x", name: "Nešto", category: "calculation" };
    expect(matchesToolQuery(bare, "nesto")).toBe(true);
    expect(matchesToolQuery(bare, "porez")).toBe(false);
  });

  /**
   * The whole reason the query is split. Tested whole, a two-word query could
   * only match a keyword that literally contained the space — so a tool was
   * findable by a phrase exactly when an author had guessed that phrase and
   * written it down. Every keyword below is a single word, and all three
   * queries still land.
   */
  it("matches a multi-word query against words that are separate keywords", () => {
    const stairs: SearchableTool = {
      id: "stair-geometry",
      name: "Geometrija stepeništa",
      category: "geometry",
      keywords: ["spratna", "visina", "stepenika", "broja", "uspon"],
    };
    expect(matchesToolQuery(stairs, "spratna visina")).toBe(true);
    expect(matchesToolQuery(stairs, "visina spratna")).toBe(true);
    // One term across the NAME and one across a keyword, which is the common case.
    expect(matchesToolQuery(stairs, "geometrija uspon")).toBe(true);
  });

  it("requires EVERY term, so a second word narrows instead of widening", () => {
    // „metar" alone finds Dužina; „metar porez" must find nothing, because a
    // disjunctive matcher would have returned both tools and read as broken.
    expect(matchesToolQuery(TOOLS[0]!, "metar")).toBe(true);
    expect(matchesToolQuery(TOOLS[0]!, "metar porez")).toBe(false);
    expect(matchesToolQuery(TOOLS[3]!, "metar porez")).toBe(false);
    expect(filterTools(TOOLS, "metar porez")).toEqual([]);
  });

  it("still matches a phrase that IS a single keyword, so the 40 hand-written ones keep working", () => {
    const qr: SearchableTool = {
      id: "qr",
      name: "QR kod",
      category: "system",
      keywords: ["qr code", "qr kod"],
    };
    expect(matchesToolQuery(qr, "qr kod")).toBe(true);
    expect(matchesToolQuery(qr, "qr code")).toBe(true);
  });

  it("ignores the spacing of the query itself", () => {
    expect(matchesToolQuery(TOOLS[4]!, "  rata   anuitet  ")).toBe(true);
  });
});

describe("filterTools", () => {
  it("keeps DECLARATION order rather than reordering by relevance", () => {
    // A list that reordered under the cursor would move „PDV" away from where
    // the user just learned it sits.
    expect(filterTools(TOOLS, "a").map((tool) => tool.id)).toEqual(
      TOOLS.filter((tool) => matchesToolQuery(tool, "a")).map((tool) => tool.id),
    );
  });

  it("returns everything for a blank query and nothing for an unmatched one", () => {
    expect(filterTools(TOOLS, "").length).toBe(TOOLS.length);
    expect(filterTools(TOOLS, "zzzz")).toEqual([]);
  });

  it("narrows to one tool for a specific enough query", () => {
    expect(filterTools(TOOLS, "anuitet").map((tool) => tool.id)).toEqual(["kredit"]);
  });
});

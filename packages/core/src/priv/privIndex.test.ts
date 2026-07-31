import { describe, expect, it } from "vitest";
import { buildPrivIndex, searchPrivIndex } from "./privIndex.js";

const NOTES = [
  { id: "n1", title: "Dnevnik putovanja", plaintext: "Beleške sa puta po Grčkoj" },
  { id: "n2", title: "Recepti", plaintext: "Punjene paprike i dnevnik ishrane" },
  { id: "n3", title: "Ђорђе — rođendan", plaintext: "Ideje za poklon" },
  { id: "n4", title: "Šifre uređaja", plaintext: "Ruter u dnevnoj sobi" },
] as const;

describe("buildPrivIndex / searchPrivIndex", () => {
  it("ranks title matches before body matches, input order stable within each tier", () => {
    const index = buildPrivIndex([...NOTES]);
    // "dnevnik" is in n1's TITLE and n2's BODY — title tier first.
    expect(searchPrivIndex(index, "dnevnik")).toEqual(["n1", "n2"]);
  });

  it("matches through the one shared fold: Latin, diacritic-free, and Cyrillic spellings all land", () => {
    const index = buildPrivIndex([...NOTES]);
    expect(searchPrivIndex(index, "djordje")).toEqual(["n3"]);
    expect(searchPrivIndex(index, "Đorđe")).toEqual(["n3"]);
    expect(searchPrivIndex(index, "Ђорђе")).toEqual(["n3"]);
    expect(searchPrivIndex(index, "sifre")).toEqual(["n4"]);
    expect(searchPrivIndex(index, "grckoj")).toEqual(["n1"]);
  });

  it("is case-insensitive and substring-based", () => {
    const index = buildPrivIndex([...NOTES]);
    expect(searchPrivIndex(index, "RECEPT")).toEqual(["n2"]);
    expect(searchPrivIndex(index, "aprik")).toEqual(["n2"]); // mid-word substring
  });

  it("requires every term to match (AND), each in title or body", () => {
    const index = buildPrivIndex([...NOTES]);
    expect(searchPrivIndex(index, "dnevnik grckoj")).toEqual(["n1"]);
    expect(searchPrivIndex(index, "dnevnik nepostojeci")).toEqual([]);
  });

  it("a note whose terms straddle title and body ranks in the body tier, not the title tier", () => {
    const index = buildPrivIndex([...NOTES]);
    // "recepti" is in n2's title, "paprike" only in its body — not a pure title match.
    const withPureTitle = buildPrivIndex([
      { id: "t", title: "Recepti za paprike", plaintext: "" },
      ...NOTES,
    ]);
    expect(searchPrivIndex(withPureTitle, "recepti paprike")).toEqual(["t", "n2"]);
    expect(searchPrivIndex(index, "recepti paprike")).toEqual(["n2"]);
  });

  it("returns [] for an empty or whitespace-only query and for no match", () => {
    const index = buildPrivIndex([...NOTES]);
    expect(searchPrivIndex(index, "")).toEqual([]);
    expect(searchPrivIndex(index, "   ")).toEqual([]);
    expect(searchPrivIndex(index, "xyzzy")).toEqual([]);
  });

  it("an empty index matches nothing", () => {
    expect(searchPrivIndex(buildPrivIndex([]), "dnevnik")).toEqual([]);
  });
});

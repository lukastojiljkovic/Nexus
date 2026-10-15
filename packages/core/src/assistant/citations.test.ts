import { describe, expect, it } from "vitest";
import { MIN_SHARED_WORDS, filterAnswer } from "./citations.js";
import type { Citation, KnowledgeHit } from "./contract.js";

/**
 * The answer's sources: the passages it cites, the passages it shares words
 * with when it cites nothing, and the markers rewritten to the list that comes
 * out of that.
 */

const hit = (id: string, text: string, title = `Naslov ${id}`): KnowledgeHit => ({
  citation: { kind: "wiki", id, title },
  text,
  score: 0.9,
});

const toolCitation: Citation = { kind: "note", id: "n9", title: "Moja beleška" };

describe("filterAnswer", () => {
  it("keeps the passages the answer cites, and rewrites a marker to its new number", () => {
    const passages = [hit("a", "Prvi pasus."), hit("b", "Drugi pasus."), hit("c", "Treći pasus.")];
    const result = filterAnswer("Odgovor je u trećem pasusu [3].", { passages, tools: [] });
    expect(result.citations.map((citation) => citation.id)).toEqual(["c"]);
    expect(result.text).toBe("Odgovor je u trećem pasusu [1].");
  });

  it("reads a marker with several numbers, and one marker after another", () => {
    const passages = [hit("a", "Prvi."), hit("b", "Drugi."), hit("c", "Treći.")];
    const result = filterAnswer("Prvo [1, 3], pa onda [2][3].", { passages, tools: [] });
    expect(result.citations.map((citation) => citation.id)).toEqual(["a", "c", "b"]);
    expect(result.text).toBe("Prvo [1, 2], pa onda [3][2].");
  });

  it("removes a marker that points at no passage, and tidies what it leaves", () => {
    const passages = [hit("a", "Prvi pasus.")];
    const result = filterAnswer("Nema izvora [7], ni ovde [1]", { passages, tools: [] });
    expect(result.citations.map((citation) => citation.id)).toEqual(["a"]);
    // The marker goes, and the space it left in front of the comma goes with it.
    expect(result.text).toBe("Nema izvora, ni ovde [1]");
  });

  it("keeps the passages the answer shares words with when it cites nothing", () => {
    const passages = [
      hit("tesla", "Nikola Tesla je rođen u Smiljanu i umro u Njujorku."),
      hit("danas", "Danas su u Srbiji izbori za Skupštinu i opštine."),
    ];
    const result = filterAnswer("Nikola Tesla je rođen u Smiljanu.", { passages, tools: [] });
    expect(result.citations.map((citation) => citation.id)).toEqual(["tesla"]);
    expect(result.text).toBe("Nikola Tesla je rođen u Smiljanu.");
  });

  it("counts ONE shared word as too little, and names the number that is enough", () => {
    const passages = [hit("one", "Tesla je bio pronalazač.")];
    // `Tesla` is the one word this answer shares with the passage, and one word
    // is a coincidence any passage can share with any answer.
    expect(filterAnswer("Tesla.", { passages, tools: [] }).citations).toEqual([]);
    expect(filterAnswer("Tesla je bio pronalazač.", { passages, tools: [] }).citations).toHaveLength(1);
    expect(MIN_SHARED_WORDS).toBe(2);
  });

  it("matches a shareable word through the fold, across the two scripts", () => {
    const passages = [
      hit("tesla", "Никола Тесла је рођен у Смиљану и умро у Њујорку."),
      hit("danas", "Данас су у Србији избори за Скупштину."),
    ];
    const result = filterAnswer("Nikola Tesla je rođen u Smiljanu.", { passages, tools: [] });
    expect(result.citations.map((citation) => citation.id)).toEqual(["tesla"]);
  });

  it("keeps every tool citation after the passages, and never repeats one", () => {
    const passages = [hit("a", "Prvi pasus o Tesli.")];
    const result = filterAnswer("Tesla [1].", {
      passages,
      tools: [toolCitation, toolCitation],
    });
    expect(result.citations.map((citation) => citation.id)).toEqual(["a", "n9"]);
  });

  it("adds no uncited passage back when the answer cites by number, however many words it shares", () => {
    const passages = [
      hit("tesla", "Nikola Tesla je bio srpski pronalazač."),
      hit("serija", "Nikola Tesla je televizijska serija o pronalazaču."),
    ];
    const result = filterAnswer("Nikola Tesla je bio srpski pronalazač [1].", { passages, tools: [] });
    expect(result.citations.map((citation) => citation.id)).toEqual(["tesla"]);
  });

  it("keeps a safety passage the answer did not cite, so the safety notice is still drawn", () => {
    const safety: KnowledgeHit = {
      citation: { kind: "pack", id: "s", title: "Prva pomoć", safety: true },
      text: "Pozovi 112.",
      score: 0.9,
    };
    const result = filterAnswer("Ostani miran [1].", { passages: [hit("a", "Ostani miran."), safety], tools: [] });
    expect(result.citations.map((citation) => citation.id)).toEqual(["a", "s"]);
  });

  it("lists nothing when nothing was cited and nothing overlaps", () => {
    const passages = [hit("a", "Prvi pasus.")];
    const result = filterAnswer("Nemam pojma.", { passages, tools: [] });
    expect(result.citations).toEqual([]);
    expect(result.text).toBe("Nemam pojma.");
  });
});

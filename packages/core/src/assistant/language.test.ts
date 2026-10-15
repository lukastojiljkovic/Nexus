import { describe, expect, it } from "vitest";
import { contentWords, replyLanguage, transliterateToLatin } from "./language.js";

/**
 * The reply's language and script, and the two things the loop does with the
 * decision: it transliterates a Latin answer, and it compares an answer's words
 * with a passage's through the same fold.
 */

describe("replyLanguage", () => {
  it("reads Cyrillic as Serbian, and Cyrillic script", () => {
    expect(replyLanguage("Шта имам од задатака за данас?", "en")).toEqual({
      language: "sr",
      script: "cyrillic",
    });
    // One Latin name inside a Cyrillic answer does not move the majority.
    expect(replyLanguage("Никола Тесла (Nikola Tesla) је рођен у Смиљану.", "en").script).toBe(
      "cyrillic",
    );
  });

  it("reads a Serbian letter as Serbian, in Latin script", () => {
    expect(replyLanguage("Šta imam od zadataka za danas?", "en")).toEqual({
      language: "sr",
      script: "latin",
    });
  });

  it("reads Serbian with no diacritics from the words alone", () => {
    expect(replyLanguage("Sta imam od zadataka za danas", "en")).toEqual({
      language: "sr",
      script: "latin",
    });
    expect(replyLanguage("Koliko je sati u Beogradu", "en").language).toBe("sr");
  });

  it("reads English as English, even when it asks about Serbia", () => {
    expect(replyLanguage("Who was Nikola Tesla?", "sr")).toEqual({ language: "en", script: "latin" });
    expect(replyLanguage("What is the capital of France?", "sr").language).toBe("en");
  });

  it("reads a mixed message by the stronger evidence, not by the first word", () => {
    // An English question quoting one Serbian word is still an English question.
    expect(replyLanguage("What does zadatak mean in English?", "sr").language).toBe("en");
    // A Serbian question quoting an English one is still a Serbian question.
    expect(replyLanguage("Šta je 'task' na srpskom, koji je prevod?", "en").language).toBe("sr");
  });

  it("falls back to the app's language when there is nothing to read", () => {
    expect(replyLanguage("", "sr")).toEqual({ language: "sr", script: "latin" });
    expect(replyLanguage("", "en")).toEqual({ language: "en", script: "latin" });
    expect(replyLanguage("2026-10-15 12:30 :: -- ", "sr")).toEqual({
      language: "sr",
      script: "latin",
    });
  });

  it("is not decided by two words that could be either language", () => {
    // One marker of each: a tie is not evidence, so the app's own language wins.
    expect(replyLanguage("je in", "en")).toEqual({ language: "en", script: "latin" });
    expect(replyLanguage("je in", "sr")).toEqual({ language: "sr", script: "latin" });
  });
});

describe("transliterateToLatin", () => {
  it("rewrites the Serbian Cyrillic alphabet into the Latin one", () => {
    expect(transliterateToLatin("Шта имам од задатака за данас?")).toBe(
      "Šta imam od zadataka za danas?",
    );
    expect(transliterateToLatin("Никола Тесла, рођен у Смиљану.")).toBe(
      "Nikola Tesla, rođen u Smiljanu.",
    );
    expect(transliterateToLatin("Љубав, његов, џеп, ћошак")).toBe("Ljubav, njegov, džep, ćošak");
  });

  it("leaves Latin text, and a letter outside the table, exactly as it was", () => {
    expect(transliterateToLatin("Nikola Tesla")).toBe("Nikola Tesla");
    expect(transliterateToLatin("5 + 5 = 10")).toBe("5 + 5 = 10");
    expect(transliterateToLatin("café")).toBe("café");
  });

  it("is per character, so transliterating each chunk is transliterating the whole text", () => {
    // The property the loop's stream depends on: a page drawing `token` events
    // and a store holding the final `message` must show the same text.
    const text = "Шта имам од задатака за данас? Провери, и онда одговори на српском.";
    const chunks = [
      "Шта",
      " имам",
      " од ",
      "задатака",
      " за данас?",
      " Провери, и онда ",
      "одговори",
      " на српском.",
    ];
    expect(chunks.join("")).toBe(text);
    expect(chunks.map(transliterateToLatin).join("")).toBe(transliterateToLatin(text));
  });

  it("leaves a capital digraph's Latin spelling alone in the chunk that carries it", () => {
    // `Њ` is `Nj` and not `NJ` here, on purpose: the letter after a capital
    // digraph is what `pro/tekst.ts`'s tool reads to decide that, and a chunk
    // does not have one yet (see the module's comment).
    expect(transliterateToLatin("ЊУЈОРК")).toBe("NjUJORK");
  });
});

describe("contentWords", () => {
  it("folds diacritics and Cyrillic, so a passage and an answer meet in one script", () => {
    expect(contentWords("Šta imam od zadataka za danas?")).toEqual(["imam", "zadataka", "danas"]);
    expect(contentWords("Шта имам од задатака за данас?")).toEqual(["imam", "zadataka", "danas"]);
    expect(contentWords("Nikola Tesla je rođen u Smiljanu.")).toEqual([
      "nikola",
      "tesla",
      "rodjen",
      "smiljanu",
    ]);
  });

  it("drops the words too short to be evidence", () => {
    expect(contentWords("na je od sa nije")).toEqual(["nije"]);
    expect(contentWords("Šta je to")).toEqual([]);
  });
});

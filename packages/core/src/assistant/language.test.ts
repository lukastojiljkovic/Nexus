import { describe, expect, it } from "vitest";
import {
  contentWords,
  detectAnswerLanguage,
  detectAnswerScript,
  replyLanguage,
  transliterateToCyrillic,
  transliterateToLatin,
} from "./language.js";

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

describe("transliterateToCyrillic", () => {
  it("rewrites a whole word that carries a Serbian letter, and leaves the rest", () => {
    expect(transliterateToCyrillic("Nikola Tesla je rođen u Smiljanu.")).toBe(
      "Nikola Tesla je рођен u Smiljanu.",
    );
  });

  it("rewrites the word a capital Serbian letter starts, with the capital", () => {
    expect(transliterateToCyrillic("Čajnik je u kuhinji.")).toBe("Чајник je u kuhinji.");
  });

  it("never touches a code span, even one holding Serbian letters", () => {
    expect(transliterateToCyrillic("Koristi `čuvaj` za šifru.")).toBe("Koristi `čuvaj` za шифру.");
  });

  it("never touches a URL, which a reader follows literally", () => {
    expect(transliterateToCyrillic("Vidi https://sajt.rs/č za više.")).toBe(
      "Vidi https://sajt.rs/č za више.",
    );
  });

  it("never touches a dotted identifier such as a tool name", () => {
    expect(transliterateToCyrillic("Pozovi tasks.create šta god.")).toBe(
      "Pozovi tasks.create шта god.",
    );
  });

  it("never touches a citation marker", () => {
    expect(transliterateToCyrillic("Rođen je u Smiljanu [1].")).toBe("Рођен je u Smiljanu [1].");
  });

  it("leaves a Latin-only word such as a product name alone, beside a rewritten one", () => {
    expect(transliterateToCyrillic("Otvori Wikipedia u šoli.")).toBe("Otvori Wikipedia u шоли.");
  });

  it("leaves a text with no Serbian letter exactly as it was", () => {
    expect(transliterateToCyrillic("Nikola Tesla, 1856.")).toBe("Nikola Tesla, 1856.");
  });
});

describe("detectAnswerLanguage", () => {
  it("reads a Serbian answer from its letters or its words, Latin or Cyrillic", () => {
    expect(detectAnswerLanguage("Nikola Tesla je rođen u Smiljanu.")).toBe("sr");
    expect(detectAnswerLanguage("Nikola Tesla nije rodjen u Smiljanu.")).toBe("sr");
    expect(detectAnswerLanguage("Никола Тесла је рођен у Смиљану.")).toBe("sr");
  });

  it("reads an English answer that quotes one Serbian title as English", () => {
    expect(
      detectAnswerLanguage('The pack is called "Preživljavanje" and it is here for you.'),
    ).toBe("en");
  });

  it("does not judge a text with no evidence either way", () => {
    expect(detectAnswerLanguage("112")).toBe("undetermined");
    expect(detectAnswerLanguage("...")).toBe("undetermined");
    expect(detectAnswerLanguage("Okay.")).toBe("undetermined");
  });
});

describe("detectAnswerScript", () => {
  it("reads the script from the share of letters that are Cyrillic", () => {
    expect(detectAnswerScript("Nikola Tesla je rođen u Smiljanu.")).toBe("latin");
    expect(detectAnswerScript("Никола Тесла је рођен у Смиљану.")).toBe("cyrillic");
  });

  it("reads one quoted Cyrillic title among Latin sentences as Latin", () => {
    expect(detectAnswerScript("The article “Никола Тесла” says he was born in Smiljan.")).toBe(
      "latin",
    );
  });

  it("reads a text with no letters as Latin", () => {
    expect(detectAnswerScript("112")).toBe("latin");
  });
});

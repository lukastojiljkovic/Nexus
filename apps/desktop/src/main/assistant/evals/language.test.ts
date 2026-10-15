import { describe, expect, it } from "vitest";

import { claimsCompletion, detectDoesNotKnow, detectLanguage, detectScript } from "./language.js";

describe("detectLanguage", () => {
  it("reads a Serbian sentence by its letters alone", () => {
    expect(detectLanguage("Otvori Podešavanja i proveri šifru.")).toBe("sr");
  });

  it("reads a Serbian sentence that carries no diacritic by its words", () => {
    // Not one of the five letters, so the letters rule is silent and the word
    // list has to carry it.
    expect(detectLanguage("Otvori podesavanja i proveri sifru za korisnika.")).toBe("sr");
  });

  it("reads an English sentence by its words", () => {
    expect(detectLanguage("Open Settings and check the passcode for this user.")).toBe("en");
  });

  it("calls a reply with no evidence at all undetermined rather than guessing", () => {
    expect(detectLanguage("112")).toBe("undetermined");
    // A bare citation marker is not a sentence in either language.
    expect(detectLanguage("...")).toBe("undetermined");
  });

  it("reads an English sentence that quotes one Serbian word as English", () => {
    // Four English markers against one Serbian letter: the letters are
    // evidence, not a verdict, and the reply is in the user's language.
    expect(detectLanguage("The pack is called \"Preživljavanje\" and it is here for you.")).toBe("en");
  });

  it("reads a Serbian sentence with an English loan word as Serbian", () => {
    expect(detectLanguage("Za bezbednost koristi mapu, a ne eksterni link.")).toBe("sr");
  });

  it("the safety notice is Serbian in sr and English in en", () => {
    // The two fixed sentences the answer must carry, pinned here as the
    // detector's own fixture: the notice is the one string every answer about a
    // safety pack repeats.
    expect(detectLanguage("Samo za informisanje. Nije zamena za stručnu pomoć. U hitnom slučaju pozovi 112.")).toBe("sr");
    expect(detectLanguage("For reference only. Not a substitute for professional help. In an emergency, call 112.")).toBe("en");
  });
});

describe("detectDoesNotKnow", () => {
  it("sees an admission in either language", () => {
    expect(detectDoesNotKnow("Ne znam odgovor na to pitanje.")).toBe(true);
    expect(detectDoesNotKnow("I don't know about that.")).toBe(true);
    expect(detectDoesNotKnow("Nemam informacije o tome u svojim izvorima.")).toBe(true);
    expect(detectDoesNotKnow("That is not covered by the knowledge base.")).toBe(true);
  });

  it("is silent on an answer that does know", () => {
    expect(detectDoesNotKnow("Otvori Podešavanja, pa Bezbednost.")).toBe(false);
    expect(detectDoesNotKnow("Open Settings, then Security.")).toBe(false);
    // `nema` alone is a Serbian word ("there is no") and not an admission; the
    // detector asks for the phrase it is part of.
    expect(detectDoesNotKnow("U paketu nema te teme, ali evo sta pise o vodi.")).toBe(false);
  });
});

describe("detectScript", () => {
  it("reads a Latin sentence, and a Serbian Latin one, as Latin", () => {
    expect(detectScript("Beograd je glavni grad Srbije i najveći grad.")).toBe("latin");
    expect(detectScript("The capital of France is Paris.")).toBe("latin");
  });

  it("reads a Cyrillic sentence as Cyrillic", () => {
    expect(detectScript("Београд је главни град Србије.")).toBe("cyrillic");
  });

  it("keeps a Latin answer that quotes a Cyrillic title Latin", () => {
    // The share is a policy number, and half is where it sits: a quotation
    // inside a Latin sentence is not the answer's script.
    expect(
      detectScript("The article „Никола Тесла“ says he was born in Smiljan, in 1856."),
    ).toBe("latin");
  });

  it("calls an answer with no letters at all Latin rather than Cyrillic", () => {
    expect(detectScript("112")).toBe("latin");
  });
});

describe("claimsCompletion", () => {
  it("sees a claim in either language, and through case and diacritics", () => {
    expect(claimsCompletion("Dodao sam zadatak.")).toBe(true);
    expect(claimsCompletion("I have added the task to your list.")).toBe(true);
    expect(claimsCompletion("Zakazao sam termin za petak.")).toBe(true);
    expect(claimsCompletion("Zabeležio sam to u beleške.")).toBe(true);
  });

  it("is silent on a refusal, which is the sentence it exists beside", () => {
    expect(claimsCompletion("Nisam dodao zadatak, jer si predlog odbio.")).toBe(false);
    expect(claimsCompletion("I did not add the task: the store is locked.")).toBe(false);
    expect(claimsCompletion("Nije dodat nijedan zadatak.")).toBe(false);
  });
});

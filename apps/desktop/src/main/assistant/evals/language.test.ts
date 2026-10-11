import { describe, expect, it } from "vitest";

import { detectDoesNotKnow, detectLanguage } from "./language.js";

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

import { describe, expect, it } from "vitest";

import {
  bakersRoleFromWord,
  foldFromWord,
  plateUnitFromWord,
  recipeUnitFromWord,
} from "./kuhinja.js";
import { strings } from "../strings.js";

/**
 * Four free-text vocabularies this pack reads out of a table cell.
 *
 * All four were module-level maps holding a SECOND copy of words the hint above
 * the field already promises, keyed on the diacritic spelling and matched with
 * `toLowerCase()`. Two authors for one vocabulary: change the hint and the tool
 * silently stops recognising the word it now asks for. „Silently" is exact in
 * three of the four — the unmatched word does not raise an error, it lands on a
 * fallback and changes the numbers.
 *
 * What is pinned here is that each parser accepts exactly the words `strings`
 * publishes, folded — and, for the one where an unknown word must be refused
 * rather than assumed, that it IS refused.
 */
describe("bakersRoleFromWord", () => {
  const s = strings.pro.kuhinja["bakers-percentage"];

  it("accepts exactly the words the hint tells the user to type", () => {
    expect(bakersRoleFromWord(s.roleFlour, s)).toBe("flour");
    expect(bakersRoleFromWord(s.roleWater, s)).toBe("water");
    expect(bakersRoleFromWord(s.rolePreferment, s)).toBe("preferment");
    expect(bakersRoleFromWord(s.roleOther, s)).toBe("other");
  });

  it("accepts the same words written without diacritics", () => {
    expect(bakersRoleFromWord("brasno", s)).toBe("flour");
    expect(bakersRoleFromWord("BRAŠNO", s)).toBe("flour");
    expect(bakersRoleFromWord("  Voda  ", s)).toBe("water");
    expect(bakersRoleFromWord("Predferment", s)).toBe("preferment");
  });

  it("falls through to `other` for anything it does not know", () => {
    // The fall-through is deliberate — „so" or „šećer" is an ingredient, not a
    // flour and not a water — but it is also why an unmatched SPELLING of flour
    // is dangerous, which is what the case above exists to prevent.
    expect(bakersRoleFromWord("šećer", s)).toBe("other");
    expect(bakersRoleFromWord("", s)).toBe("other");
  });
});

describe("foldFromWord", () => {
  const s = strings.pro.kuhinja["lamination-layers"];

  it("accepts exactly the three words the refusal message names", () => {
    expect(foldFromWord(s.foldLetter, s)).toBe("letter");
    expect(foldFromWord(s.foldBook, s)).toBe("book");
    expect(foldFromWord(s.foldHalf, s)).toBe("half");
  });

  it("accepts them in any case, with surrounding space", () => {
    expect(foldFromWord("  Knjiga ", s)).toBe("book");
    expect(foldFromWord("NAPOLA", s)).toBe("half");
  });

  it("refuses a word it does not know rather than guessing a fold", () => {
    // The only one of the four that can refuse, because the tool refuses with
    // it: an unrecognised fold empties `folds` and `laminationLayers` says so.
    // A guessed fold would double or triple the layer count in silence.
    expect(foldFromWord("trostruko", s)).toBeUndefined();
    expect(foldFromWord("", s)).toBeUndefined();
  });
});

describe("plateUnitFromWord", () => {
  const s = strings.pro.kuhinja["plate-cost"];

  it("accepts exactly the three units the hint names", () => {
    expect(plateUnitFromWord(s.unitG, s)).toBe("g");
    expect(plateUnitFromWord(s.unitMl, s)).toBe("ml");
    expect(plateUnitFromWord(s.unitPiece, s)).toBe("piece");
  });

  it("accepts them in any case, with surrounding space", () => {
    expect(plateUnitFromWord(" ML ", s)).toBe("ml");
    expect(plateUnitFromWord("Kom", s)).toBe("piece");
  });

  it("refuses an unknown unit instead of costing the row as grams", () => {
    // This is the defect the `undefined` exists for. „dl" used to become „g",
    // so 200 dl was priced per kilogram and printed „200 g" — a plausible
    // number, the wrong one, with nothing on the screen to say so.
    expect(plateUnitFromWord("dl", s)).toBeUndefined();
    expect(plateUnitFromWord("kg", s)).toBeUndefined();
    expect(plateUnitFromWord("", s)).toBeUndefined();
  });
});

describe("recipeUnitFromWord", () => {
  const s = strings.pro.kuhinja["recipe-scale"];

  it("accepts exactly the units the hint names", () => {
    expect(recipeUnitFromWord(s.unitG, s)).toBe("g");
    expect(recipeUnitFromWord(s.unitKg, s)).toBe("kg");
    expect(recipeUnitFromWord(s.unitMl, s)).toBe("ml");
    expect(recipeUnitFromWord(s.unitL, s)).toBe("l");
    expect(recipeUnitFromWord(s.unitPiece, s)).toBe("piece");
    expect(recipeUnitFromWord(s.unitOther, s)).toBe("other");
  });

  it("sends anything else to `other`, which is a real member here", () => {
    // Unlike plate-cost: „other" means „a unit I do not convert, just scale the
    // number", so a spoon or a „dl" belongs there — and `displayUnitLabel`
    // echoes back the word as typed, so nothing the user wrote is lost.
    expect(recipeUnitFromWord("kašika", s)).toBe("other");
    expect(recipeUnitFromWord("dl", s)).toBe("other");
    expect(recipeUnitFromWord("", s)).toBe("other");
  });

  it("agrees with the word its own hint asks for", () => {
    // The map used to key „other" on „ostalo" while the label read „drugo".
    // Both spellings are now the same string, and this is what says so.
    expect(s.linesHint).toContain(s.unitOther);
  });
});

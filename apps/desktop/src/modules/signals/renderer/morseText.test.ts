import { PARIS_DIT_MS } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { morseCodeToText, planMorseMessage, textToMorseCode } from "./morseText.js";

/**
 * The Morse tab's conversions.
 *
 * Every expected string below is the code `ITU-R M.1677-1` Annex 1 prints for
 * that character, and every expected duration is the arithmetic that
 * Recommendation's §2 fixes: the unit is `PARIS_DIT_MS / WPM` milliseconds
 * (1200/WPM), a dash is three units, the gap inside a character one, between
 * characters three and between words seven. The test states the arithmetic
 * rather than the engine's answer, so a change in the engine has to be argued
 * against the standard rather than against a snapshot.
 */

describe("textToMorseCode", () => {
  it("sends the ITU codes for the letters and figures", () => {
    expect(textToMorseCode("E").code).toBe(".");
    expect(textToMorseCode("T").code).toBe("-");
    expect(textToMorseCode("SOS").code).toBe("... --- ...");
    expect(textToMorseCode("1").code).toBe(".----");
    expect(textToMorseCode("9").code).toBe("----.");
  });

  it("separates words with three spaces and characters with one", () => {
    expect(textToMorseCode("hello world").code).toBe(
      ".... . .-.. .-.. ---   .-- --- .-. .-.. -..",
    );
  });

  it("transliterates a Serbian diacritic and says which ones it changed", () => {
    // đ is sent as dj — two letters, because it is one Serbian letter whose
    // Latin fallback is two characters. The engine reports the transliteration;
    // a screen that hid it would be sending a different message than the one
    // that was typed.
    const result = textToMorseCode("Đak");
    expect(result.code).toBe("-.. .--- .- -.-");
    expect(result.transliterated).toEqual(["đ"]);
  });
});

describe("morseCodeToText", () => {
  it("reads a message printed with three spaces", () => {
    expect(morseCodeToText(".... . .-.. .-.. ---   .-- --- .-. .-.. -..")).toEqual({
      text: "HELLO WORLD",
      unknown: [],
    });
  });

  it("reads the same message printed with a slash", () => {
    expect(morseCodeToText(".... . .-.. .-.. --- / .-- --- .-. .-.. -..").text).toBe("HELLO WORLD");
  });

  it("reports a token that is not a character instead of dropping it", () => {
    // `.-...` is Annex 1's „wait" — a procedural signal, which is sent as a run
    // of marks and is not a character of any text (the engine's own table gives
    // it no `char`). `..-..` is no code at all. The honest reading of both is a
    // question mark plus the token itself, never a silent drop.
    expect(morseCodeToText(".-... ..-..")).toEqual({ text: "??", unknown: [".-...", "..-.."] });
    // And a table lookup that must still work: five dots is the figure 5.
    expect(morseCodeToText(".....")).toEqual({ text: "5", unknown: [] });
  });

  it("answers nothing at all for nothing", () => {
    expect(morseCodeToText("   ")).toEqual({ text: "", unknown: [] });
  });
});

describe("planMorseMessage", () => {
  it("keys a dit, a dash and both gaps at PARIS timing", () => {
    // 20 WPM: the unit is 1200/20 = 60 ms, so a dash is 180, the gap between
    // characters 180 and the gap between words 420.
    const e = planMorseMessage("E", 20, 20);
    expect(e?.intervals).toEqual([{ on: true, ms: 60 }]);
    expect(e?.totalMs).toBe(60);

    const t = planMorseMessage("T", 20, 20);
    expect(t?.intervals).toEqual([{ on: true, ms: 180 }]);

    const ee = planMorseMessage("EE", 20, 20);
    expect(ee?.intervals).toEqual([
      { on: true, ms: 60 },
      { on: false, ms: 180 },
      { on: true, ms: 60 },
    ]);
    expect(ee?.totalMs).toBe(300);

    const twoWords = planMorseMessage("E E", 20, 20);
    expect(twoWords?.intervals).toEqual([
      { on: true, ms: 60 },
      { on: false, ms: 420 },
      { on: true, ms: 60 },
    ]);
    expect(twoWords?.totalMs).toBe(540);
    expect(PARIS_DIT_MS).toBe(1200);
  });

  it("stretches only the gaps under Farnsworth spacing", () => {
    // The engine derives the character gap from the same scale ITU-R M.1677-1
    // §2 fixes, as `g = (150·c/w − 93)/19` units. At 20 WPM characters and
    // 10 WPM message that is (150·2 − 93)/19 = 207/19 units, and a unit is 60
    // ms, so the gap is 653.68 ms — while the marks stay 60 ms each.
    const plan = planMorseMessage("EE", 20, 10);
    expect(plan?.intervals[0]).toEqual({ on: true, ms: 60 });
    expect(plan?.intervals[1]?.on).toBe(false);
    expect(plan?.intervals[1]?.ms).toBeCloseTo(((150 * 2 - 93) / 19) * 60, 9);
    expect(plan?.intervals[2]).toEqual({ on: true, ms: 60 });
  });

  it("answers null when there is nothing to play, or a speed the timing is not defined over", () => {
    expect(planMorseMessage("", 20, 20)).toBeNull();
    expect(planMorseMessage("€", 20, 20)).toBeNull();
    expect(planMorseMessage("E", 0, 20)).toBeNull();
    expect(planMorseMessage("E", 200, 20)).toBeNull();
    expect(planMorseMessage("E", 20, 0)).toBeNull();
  });
});

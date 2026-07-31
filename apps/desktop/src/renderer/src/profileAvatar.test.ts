import { describe, expect, it } from "vitest";
import { profileInitials } from "./profileAvatar.js";

describe("profileInitials", () => {
  it("takes the first letter of a single-word name", () => {
    expect(profileInitials("Luka")).toBe("L");
  });

  it("takes the first letters of the first two words", () => {
    expect(profileInitials("Luka Stojiljković")).toBe("LS");
  });

  it("stops at two, however many words the name has", () => {
    expect(profileInitials("Luka Dragan Stojiljković")).toBe("LD");
  });

  it("uppercases in sr-Latn — plain toUpperCase mis-tailors nothing here, but the rule is the rule", () => {
    expect(profileInitials("đorđe ćirić")).toBe("ĐĆ");
    expect(profileInitials("šumska živina")).toBe("ŠŽ");
  });

  it("ignores surrounding and repeated whitespace", () => {
    expect(profileInitials("   Ana    Marija   ")).toBe("AM");
  });

  it("is empty for a name that is empty or only whitespace — main seeds the first-run profile with a blank name on purpose", () => {
    expect(profileInitials("")).toBe("");
    expect(profileInitials("   ")).toBe("");
  });

  it("takes whole code points, so a name starting with an astral character is not split in half", () => {
    expect(profileInitials("😀 Radna")).toBe("😀R");
  });
});

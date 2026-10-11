import { describe, expect, it } from "vitest";
import { validateSuggestedCollection } from "./suggested.js";

/** A valid minimal list, written by hand. The store's own fixture is the three-item one — this is only about the validator's shape rules. */
function valid(): Record<string, unknown> {
  return {
    id: "sr-classics-1",
    title: { sr: "Srpski klasici", en: "Serbian classics" },
    source: "Wikidata",
    licence: "CC0 1.0",
    items: [
      {
        wikidataId: "Q1138351",
        kind: "book",
        title: { sr: "Na Drini ćuprija", en: "The Bridge on the Drina" },
        year: 1945,
        creators: ["Ivo Andrić"],
      },
      {
        wikidataId: "Q1",
        kind: "film",
        title: { sr: "Ko to tamo peva", en: "Who's Singin' Over There?" },
      },
    ],
  };
}

describe("validateSuggestedCollection", () => {
  it("accepts a well-formed list and canonicalises its creators", () => {
    const value = validateSuggestedCollection(valid());
    expect(value?.id).toBe("sr-classics-1");
    expect(value?.title).toEqual({ sr: "Srpski klasici", en: "Serbian classics" });
    expect(value?.items).toHaveLength(2);
    expect(value?.items[0]).toEqual({
      wikidataId: "Q1138351",
      kind: "book",
      title: { sr: "Na Drini ćuprija", en: "The Bridge on the Drina" },
      year: 1945,
      creators: ["Ivo Andrić"],
    });
    // The two optional fields stay ABSENT rather than becoming null or
    // undefined keys: this value is also what gets serialised.
    expect(Object.keys(value?.items[1] ?? {})).toEqual(["wikidataId", "kind", "title"]);
  });

  it("refuses an unknown KEY anywhere, because the format is versioned", () => {
    const list = valid();
    list["notes"] = "an extra key";
    expect(validateSuggestedCollection(list)).toBeNull();

    const item = valid();
    (item["items"] as Record<string, unknown>[])[0]!["rating"] = 9;
    expect(validateSuggestedCollection(item)).toBeNull();
  });

  it("refuses a list with no items and a list past the entry cap", () => {
    const empty = valid();
    empty["items"] = [];
    expect(validateSuggestedCollection(empty)).toBeNull();

    const huge = valid();
    const entry = (valid()["items"] as unknown[])[0];
    huge["items"] = Array.from({ length: 5_001 }, () => entry);
    expect(validateSuggestedCollection(huge)).toBeNull();
  });

  it("refuses a title that is missing a language", () => {
    const missingEnglish = valid();
    missingEnglish["title"] = { sr: "Samo srpski" };
    expect(validateSuggestedCollection(missingEnglish)).toBeNull();

    const blankSerbian = valid();
    blankSerbian["title"] = { sr: "   ", en: "English" };
    expect(validateSuggestedCollection(blankSerbian)).toBeNull();
  });

  it("refuses a wikidataId that is not a Q-id, because the column it lands in is", () => {
    const slug = valid();
    (slug["items"] as Record<string, unknown>[])[0]!["wikidataId"] = "the-bridge";
    expect(validateSuggestedCollection(slug)).toBeNull();

    const leadingZero = valid();
    (leadingZero["items"] as Record<string, unknown>[])[0]!["wikidataId"] = "Q042";
    expect(validateSuggestedCollection(leadingZero)).toBeNull();
  });

  it("accepts an entry that carries no Wikidata id, leaving the key out entirely", () => {
    // The format serves curated lists whose source does not name every work
    // (the task's pack layout marks `wikidata` optional), and the store's own
    // matching order answers such an entry with type + title + year. The key
    // must stay ABSENT rather than becoming null, because this value is what
    // gets serialised back into a pack.
    const list = valid();
    const items = list["items"] as Record<string, unknown>[];
    delete items[0]!["wikidataId"];

    const value = validateSuggestedCollection(list);
    expect(value?.items[0]).toEqual({
      kind: "book",
      title: { sr: "Na Drini ćuprija", en: "The Bridge on the Drina" },
      year: 1945,
      creators: ["Ivo Andrić"],
    });
    expect(Object.hasOwn(value?.items[0] ?? {}, "wikidataId")).toBe(false);

    // An explicit null is NOT the same as an absent key: the format has no null.
    const nulled = valid();
    (nulled["items"] as Record<string, unknown>[])[0]!["wikidataId"] = null;
    expect(validateSuggestedCollection(nulled)).toBeNull();
  });

  it("refuses an unknown kind, a bad year and a bad creator list", () => {
    const kind = valid();
    (kind["items"] as Record<string, unknown>[])[0]!["kind"] = "game";
    expect(validateSuggestedCollection(kind)).toBeNull();

    const year = valid();
    (year["items"] as Record<string, unknown>[])[0]!["year"] = 1945.5;
    expect(validateSuggestedCollection(year)).toBeNull();

    const creators = valid();
    (creators["items"] as Record<string, unknown>[])[0]!["creators"] = ["Ivo Andrić", 7];
    expect(validateSuggestedCollection(creators)).toBeNull();
  });

  it("refuses a value that is not an object at all", () => {
    expect(validateSuggestedCollection(null)).toBeNull();
    expect(validateSuggestedCollection([])).toBeNull();
    expect(validateSuggestedCollection("sr-classics-1")).toBeNull();
  });
});

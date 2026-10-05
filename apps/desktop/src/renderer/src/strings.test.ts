import { afterEach, describe, expect, it } from "vitest";
import { SEARCH_KINDS } from "@nexus/core";

import {
  DEFAULT_LOCALE,
  LOCALES,
  activeLocale,
  applyLocale,
  countUnit,
  dayUnit,
  lookup,
  overwrite,
  strings,
} from "./strings.js";
import { sr } from "./strings.sr.js";

afterEach(() => {
  // Any test that switched to English puts the process back where the rest of
  // the suite expects it.
  applyLocale(DEFAULT_LOCALE);
});

/**
 * The locale layer's contract. Two things here are load-bearing and neither is
 * visible to the type checker:
 *
 *  - `strings` must keep its OBJECT IDENTITY across a language switch, because
 *    that identity is the entire mechanism — every module-scope subtree alias
 *    in the app points at it;
 *  - the plural helpers must agree with the hand-written Serbian rules they
 *    replaced, because getting agreement wrong is a defect no reviewer would
 *    catch by reading and no existing test would notice.
 */

describe("the search kind labels", () => {
  /**
   * `kindSingular` and `kindPlural` name every `SearchKind`, and NOTHING typed
   * them that way until this test.
   *
   * The table is `as const` and `Strings` is widened from it, so the compiler
   * sees ten keys in one file and a `SearchKind` union in another and never
   * asks whether they are the same set. The chips, the group headings and the
   * per-row kind tag all index into them with a kind the search core produced,
   * so a missing label is not a type error — it is the literal text
   * „undefined" rendered into a chip, which is what a tenth kind would have
   * done here if only `SEARCH_KINDS` had grown.
   */
  it("names every SEARCH_KINDS member, in both numbers", () => {
    for (const kind of SEARCH_KINDS) {
      expect(strings.search.kindSingular[kind], `${kind} has no singular label`).toBeTruthy();
      expect(strings.search.kindPlural[kind], `${kind} has no plural label`).toBeTruthy();
    }
  });

  it("names nothing the search core does not have, so no label is dead copy", () => {
    // The other direction, and the one `check:copy` cannot see: a leaf read
    // through a computed index is a leaf that gate prints as NOT JUDGED.
    expect(Object.keys(strings.search.kindSingular).sort()).toEqual([...SEARCH_KINDS].sort());
    expect(Object.keys(strings.search.kindPlural).sort()).toEqual([...SEARCH_KINDS].sort());
  });
});

describe("the table", () => {
  it("serves Serbian by default", () => {
    expect(activeLocale()).toBe(DEFAULT_LOCALE);
    expect(DEFAULT_LOCALE).toBe("sr");
  });

  it("carries the same text as the Serbian source it was cloned from", () => {
    expect(strings.app.brand).toBe(sr.app.brand);
    expect(strings.tasks.emptyTitle).toBe(sr.tasks.emptyTitle);
  });

  it("is a copy, not the source — so a locale switch can never corrupt sr", () => {
    // `applyLocale` writes into `strings`; if `strings` WERE `sr`, switching
    // away from Serbian and back would read from a table it had overwritten.
    expect(strings).not.toBe(sr);
  });

  it("keeps its identity, and its subtrees' identities, across a switch", () => {
    const table = strings;
    const subtree = strings.tasks;
    const nested = strings.settings.appearance;
    applyLocale("sr");
    expect(strings).toBe(table);
    expect(strings.tasks).toBe(subtree);
    expect(strings.settings.appearance).toBe(nested);
  });

  it("registers exactly the locales the app can actually serve", () => {
    // English is in the record because it IS translated: a locale in this
    // record is one the settings toggle offers, and offering „English" that
    // renders Serbian is worse than offering nothing. Completeness is the
    // compiler's job — `LOCALES` is a `Record<Locale, Strings>` — so this pins
    // only the list and its order.
    expect(Object.keys(LOCALES)).toEqual(["sr", "en"]);
  });
});

describe("the English table", () => {
  it("is a whole translation, not a copy of Serbian", () => {
    applyLocale("en");
    expect(activeLocale()).toBe("en");
    expect(strings.app.navLabel).toBe("Main navigation");
    expect(strings.tasks.emptyTitle).not.toBe(sr.tasks.emptyTitle);
    // The product name is the one leaf that is deliberately identical.
    expect(strings.app.brand).toBe(sr.app.brand);
  });

  it("names every module in English", () => {
    applyLocale("en");
    expect(strings.modules.dashboard).toBe("Dashboard");
    expect(strings.modules.canvas).toBe("Board");
    expect(strings.modules.pro).toBe("Professional tools");
  });

  it("names both languages in the language the table itself serves", () => {
    applyLocale("en");
    expect(lookup(strings.settings.appearance.languageNames, "sr")).toBe("Serbian");
    expect(lookup(strings.settings.appearance.languageNames, "en")).toBe("English");
    applyLocale("sr");
    expect(lookup(strings.settings.appearance.languageNames, "sr")).toBe("Srpski");
    expect(lookup(strings.settings.appearance.languageNames, "en")).toBe("English");
  });

  it("switches back and forth without leaking either language", () => {
    const serbianNav = strings.app.navLabel;
    applyLocale("en");
    expect(strings.app.navLabel).toBe("Main navigation");
    applyLocale("sr");
    expect(strings.app.navLabel).toBe(serbianNav);
  });

  it("agrees with English numeral rules: one against everything else", () => {
    applyLocale("en");
    expect(dayUnit(1, "day", "days")).toBe("day");
    expect(dayUnit(0, "day", "days")).toBe("days");
    expect(dayUnit(2, "day", "days")).toBe("days");
    // English has no paucal, so `countUnit`'s `few` slot must never be chosen.
    expect(countUnit(1, "gap", "gaps", "gaps")).toBe("gap");
    expect(countUnit(3, "gap", "gaps", "gaps")).toBe("gaps");
    expect(countUnit(11, "gap", "gaps", "gaps")).toBe("gaps");
  });
});

describe("lookup", () => {
  it("reads a value under a key only known at runtime", () => {
    expect(lookup(strings.modules, "tasks")).toBe(strings.modules.tasks);
  });

  it("returns undefined for a key the table does not have", () => {
    // The reason this helper exists rather than an `as Record<string, string>`
    // cast on the table: the cast made `strings.modules.anythingAtAll`
    // type-check, and exempted the subtree from the completeness check a
    // second locale depends on.
    expect(lookup(strings.modules, "nema-ovakvog-modula")).toBeUndefined();
  });
});

describe("Serbian numeral agreement", () => {
  // The rules `Intl.PluralRules` replaced, kept here as the oracle. If CLDR
  // ever disagreed with them for Serbian, this is where we would find out —
  // rather than in a sentence a user reads.
  const handWrittenDay = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "one" : "many");
  const handWrittenCount = (n: number) => {
    const lastTwo = n % 100;
    if (lastTwo >= 11 && lastTwo <= 14) return "many";
    const last = n % 10;
    if (last === 1) return "one";
    if (last >= 2 && last <= 4) return "few";
    return "many";
  };

  it("agrees with the hand-written two-form rule at every count to 1000", () => {
    for (let n = 0; n <= 1000; n += 1) {
      expect(dayUnit(n, "one", "many"), `n=${n}`).toBe(handWrittenDay(n));
    }
  });

  it("agrees with the hand-written three-form rule at every count to 1000", () => {
    for (let n = 0; n <= 1000; n += 1) {
      expect(countUnit(n, "one", "few", "many"), `n=${n}`).toBe(handWrittenCount(n));
    }
  });

  it("gets the cases a reader would check by hand", () => {
    expect(dayUnit(1, "dan", "dana")).toBe("dan");
    expect(dayUnit(21, "dan", "dana")).toBe("dan");
    // The exception that makes this worth a table: 11 is not „11 dan".
    expect(dayUnit(11, "dan", "dana")).toBe("dana");
    expect(dayUnit(111, "dan", "dana")).toBe("dana");

    expect(countUnit(1, "praznina", "praznine", "praznina")).toBe("praznina");
    expect(countUnit(3, "praznina", "praznine", "praznina")).toBe("praznine");
    expect(countUnit(5, "praznina", "praznine", "praznina")).toBe("praznina");
    // 12–14 take `many` even though 2–4 take `few`.
    expect(countUnit(12, "praznina", "praznine", "praznina")).toBe("praznina");
    expect(countUnit(22, "praznina", "praznine", "praznina")).toBe("praznine");
  });
});

/**
 * `overwrite` is the one place a locale table is folded onto the live one, and
 * it recurses through whatever `target[key]` already holds. `JSON.parse` makes
 * a `__proto__` member an OWN property of the source, so the recursion from
 * that key lands on `Object.prototype` -- the difference between a bad string
 * and a polluted global. The three refused names are pinned here because the
 * guard has no other way to be seen: every table this module ships is a
 * literal, so nothing in a normal run ever carries one.
 */
describe("overwrite refuses the prototype names", () => {
  it("does not follow __proto__ into Object.prototype", () => {
    const target: Record<string, unknown> = {};
    overwrite(target, JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
  });

  it("does not follow a constructor.prototype chain either", () => {
    const target: Record<string, unknown> = {};
    overwrite(
      target,
      JSON.parse('{"constructor":{"prototype":{"polluted":true}}}') as Record<string, unknown>,
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("still copies an ordinary leaf", () => {
    const target: Record<string, unknown> = {};
    overwrite(target, { hello: "zdravo" });
    expect(target.hello).toBe("zdravo");
  });
});

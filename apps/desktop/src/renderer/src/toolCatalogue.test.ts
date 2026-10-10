import { TOOL_TASK_GROUPS, toolDrawer, type ToolTaskGroup } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "../../shared/modules.js";
import {
  buildToolCatalogue,
  rankToolMatch,
  searchToolCatalogue,
  type ToolCatalogueEntry,
} from "./toolCatalogue.js";
import { LOCALES, type Locale } from "./strings.js";

/**
 * The catalogue and the finder (C10a), against the REAL registry and the REAL
 * copy tables.
 *
 * The query table below is the acceptance criterion, and it is written as
 * EXPECTED FIRST RESULTS rather than as „these tools are in the results": the
 * search's whole job is to order three hundred entries, so an assertion the
 * order cannot fail would prove nothing at all. Each row says why that row is
 * first — the rung it lands on, or the tie-break that decides it — and the
 * ranking tests beside it state the ladder those rows rest on.
 */

const registry = createModuleRegistry();
const declared = registry.all().flatMap((manifest) => manifest.tools ?? []);
const declarationOf = new Map(declared.map((tool) => [tool.id, tool]));
const catalogue = buildToolCatalogue(registry);
const entry = (id: string): ToolCatalogueEntry => {
  const found = catalogue.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`Nexus: no catalogue entry for ${id}`);
  return found;
};
const results = (
  query: string,
  locale: Locale = "sr",
  groups: readonly ToolTaskGroup[] = [],
): readonly string[] =>
  searchToolCatalogue(catalogue, query, groups, locale).map((candidate) => candidate.id);
const first = (query: string, locale: Locale = "sr"): string | undefined =>
  results(query, locale)[0];

/** A dotted `titleKey` path read out of one locale table, the way the catalogue reads it. */
function readKey(table: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[key]
          : undefined,
      table,
    );
}

describe("the catalogue of every tool (C10a)", () => {
  /**
   * The acceptance criterion, stated as the property rather than as a count: the
   * catalogue is what the registry publishes, so a tool added to
   * `shared/modules.ts` that the catalogue does not list fails HERE — and so
   * does a second hand-kept list that somebody starts adding entries to.
   */
  it("lists every tool the registry publishes, exactly once, in declaration order", () => {
    const ids = catalogue.map((candidate) => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(declared.map((tool) => tool.id));
  });

  it("stamps every entry with the module and the drawer its own declaration puts it in", () => {
    for (const candidate of catalogue) {
      const tool = declarationOf.get(candidate.id)!;
      expect(registry.get(candidate.moduleId)?.tools, candidate.id).toContain(
        tool,
      );
      expect(candidate.drawer, candidate.id).toBe(toolDrawer(tool));
      expect(candidate.packs, candidate.id).toEqual(tool.packs ?? []);
    }
  });

  /**
   * The half a Serbian-only test cannot see. `strings` serves one locale and the
   * renderer's own tests read it in Serbian by default, so a `titleKey` with no
   * English translation lints, typechecks and renders — and the finder, which
   * searches both tables at once, would simply never match that tool in English.
   */
  it("resolves a name in BOTH locale tables for every tool, and a description wherever one is declared", () => {
    for (const tool of declared) {
      for (const locale of ["sr", "en"] as const) {
        expect(typeof readKey(LOCALES[locale], tool.titleKey), `${tool.id}:${locale}`).toBe(
          "string",
        );
        if (tool.blurbKey !== undefined) {
          expect(typeof readKey(LOCALES[locale], tool.blurbKey), `${tool.id}:${locale}`).toBe(
            "string",
          );
        }
      }
    }
  });

  it("carries a description for exactly the tools that declare a blurb, in both locales", () => {
    const withBlurb = declared.filter((tool) => tool.blurbKey !== undefined).map((tool) => tool.id);
    expect(catalogue.filter((candidate) => candidate.description !== undefined).map((c) => c.id)).toEqual(
      withBlurb,
    );
    for (const candidate of catalogue) {
      if (candidate.description === undefined) continue;
      expect(candidate.description.sr.length, candidate.id).toBeGreaterThan(0);
      expect(candidate.description.en.length, candidate.id).toBeGreaterThan(0);
    }
  });

  /**
   * `taskGroups` is required by the contract, so TypeScript already refuses a
   * tool that declares none. What it cannot see is the OTHER half: a group that
   * every tool is filed under is a heading, and a group that no tool is filed
   * under is a filter that opens onto nothing — which is the failure mode a
   * finder has and a test can catch.
   */
  it("gives every tool one or two task groups from the closed set, and leaves no group empty", () => {
    for (const candidate of catalogue) {
      expect(candidate.taskGroups.length, candidate.id).toBeGreaterThan(0);
      expect(candidate.taskGroups.length, candidate.id).toBeLessThanOrEqual(2);
      expect(new Set(candidate.taskGroups).size, candidate.id).toBe(candidate.taskGroups.length);
      for (const group of candidate.taskGroups) {
        expect(TOOL_TASK_GROUPS, `${candidate.id}:${group}`).toContain(group);
      }
    }
    for (const group of TOOL_TASK_GROUPS) {
      expect(
        catalogue.filter((candidate) => candidate.taskGroups.includes(group)).length,
        group,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * The profession line a row DRAWS is the toolkit's name, and the text a query
   * is MATCHED against is that name plus the audience line behind it — the two
   * are deliberately different (see `professionLabel`), and the second is what
   * lets somebody type their own trade.
   */
  it("labels every tool with its toolkits, and matches the audience words behind them", () => {
    expect(entry("duzina").profession.sr).toBe(LOCALES.sr.tools.title);
    expect(entry("duzina").profession.en).toBe(LOCALES.en.tools.title);
    // One toolkit, and three: the line lists the packs that list the tool, in
    // the contract's order.
    expect(entry("bee-syrup-mix").profession.sr).toBe(LOCALES.sr.pro.packs.agro.name);
    expect(entry("rebar-weight").profession.sr).toBe(
      `${LOCALES.sr.pro.packs.gradnja.name} · ${LOCALES.sr.pro.packs.inzenjering.name} · ${LOCALES.sr.pro.packs.zanat.name}`,
    );
    // „stolari" is a `who` word of the `zanat` pack, and every hit carries the
    // pack that answers for it.
    const joiners = results("stolar");
    expect(joiners.length).toBeGreaterThan(0);
    for (const id of joiners) expect(entry(id).packs, id).toContain("zanat");
  });
});

describe("how the finder ranks what it finds (C10a)", () => {
  it("names the rung of a hit: a name prefix, a name word, a keyword, a description", () => {
    expect(rankToolMatch(entry("pdv"), "pdv", "sr")?.rank).toBe("name-prefix");
    // „Masa armature" — the term starts a WORD of the name, not the name.
    expect(rankToolMatch(entry("rebar-weight"), "masa", "sr")?.rank).toBe("name-prefix");
    expect(rankToolMatch(entry("metric-thread-strength"), "navoj", "sr")?.rank).toBe("name-word");
    // „Masa armature" — the term starts the name's SECOND word.
    expect(rankToolMatch(entry("rebar-weight"), "armature", "sr")?.rank).toBe("name-word");
    // „porez" names no tool at all, and is one of the VAT tool's keywords.
    expect(rankToolMatch(entry("pdv"), "porez", "sr")?.rank).toBe("keyword");
    // „bajtovi" is in the Unicode inspector's one-line description and in none
    // of its names, keywords or profession.
    expect(rankToolMatch(entry("unicode-inspector"), "bajtovi", "sr")?.rank).toBe("description");
  });

  /**
   * A NAME match is a match at a word's start. Tested with a plain substring,
   * „Procenat" contains „ocena" from its third letter on and outranked every
   * tool actually about grades — the same rung, for a word that is not in it.
   */
  it("refuses a mid-word hit inside a name, so the keyword rung is all it earns", () => {
    // As a NAME match it would have tied with every tool about grades; as a
    // substring of a declared keyword it keeps its place behind them.
    expect(rankToolMatch(entry("procenat"), "ocena", "sr")?.rank).toBe("keyword");
    expect(first("ocena")).toBe("grade-statistics");
    expect(rankToolMatch(entry("procenat"), "procenat", "sr")?.rank).toBe("name-prefix");
  });

  it("puts the stronger rung first, whatever order the tools were declared in", () => {
    // The VAT tool NAMES the query; the tour quote only mentions it.
    expect(results("pdv").indexOf("pdv")).toBeLessThan(results("pdv").indexOf("trip-cost-quote"));
    // …and a keyword hit beats the description that mentions the same word: the
    // integer inspector's keyword list carries „bajtovi", the Unicode
    // inspector's blurb merely says it.
    expect(first("bajtovi")).toBe("integer-inspector");
    expect(results("bajtovi")).toContain("unicode-inspector");
  });

  /**
   * Thirty queries and the answer each must OPEN ON — the acceptance criterion.
   * Each row's comment names the rung (or the tie-break) that decides it, so a
   * future change to the ladder shows up as a named failure rather than as an
   * unexplained reordering.
   */
  const FIRST_RESULTS: { query: string; locale: Locale; expected: string }[] = [
    // Name prefix, the strongest evidence there is.
    { query: "pdv", locale: "sr", expected: "pdv" },
    { query: "kredit", locale: "sr", expected: "kredit" },
    { query: "brzina", locale: "sr", expected: "brzina" },
    { query: "iban", locale: "sr", expected: "iban-check" },
    { query: "jmbg", locale: "sr", expected: "jmbg-provera" },
    { query: "awg", locale: "sr", expected: "awg-to-mm2" },
    { query: "povrsina", locale: "sr", expected: "povrsina" },
    { query: "rok", locale: "sr", expected: "rok-poslednji-dan" },
    // Keywords: the words somebody types INSTEAD of the tool's name.
    { query: "porez", locale: "sr", expected: "pdv" },
    { query: "faktura", locale: "sr", expected: "pdv" },
    { query: "kurs", locale: "sr", expected: "fx-difference" },
    { query: "armature", locale: "sr", expected: "rebar-weight" },
    { query: "plocica", locale: "sr", expected: "tile-count" },
    // A word of the name, where the query is not the name's opening.
    { query: "anuitet", locale: "sr", expected: "anuitet-otplatni-plan" },
    { query: "pib", locale: "sr", expected: "tax-id-check" },
    { query: "ocena", locale: "sr", expected: "grade-statistics" },
    { query: "prosek", locale: "sr", expected: "average-to-target" },
    { query: "navoj", locale: "sr", expected: "metric-thread-strength" },
    { query: "ekspozicija", locale: "sr", expected: "exposure-equivalent" },
    { query: "slovima", locale: "sr", expected: "number-to-serbian-words" },
    // Two tools begin with „Račun"; the tie goes to the earlier declaration.
    { query: "racun", locale: "sr", expected: "racun-iban-provera" },
    // The ENGLISH table, found by the same search — a Serbian term answers an
    // English reader and an English one answers a Serbian reader.
    { query: "length", locale: "en", expected: "duzina" },
    { query: "area", locale: "en", expected: "povrsina" },
    { query: "loan", locale: "en", expected: "kredit" },
    { query: "deadline", locale: "en", expected: "rok-poslednji-dan" },
    { query: "exposure", locale: "en", expected: "exposure-equivalent" },
    { query: "cable", locale: "en", expected: "cable-cross-section" },
    { query: "thread", locale: "en", expected: "tap-drill-size" },
    // …and the trade a tool is FOR, which is in no name at all.
    { query: "programer", locale: "sr", expected: "number-base" },
    { query: "prevodilac", locale: "sr", expected: "translation-volume" },
  ];

  it.each(FIRST_RESULTS)(
    "opens $expected first for „$query“ ($locale)",
    ({ query, locale, expected }) => {
      expect(first(query, locale)).toBe(expected);
    },
  );

  /**
   * Folding happens on BOTH sides, which is what makes the two directions one
   * behaviour: a query typed without diacritics finds the tool, and the same
   * query typed with them lands on the same row rather than on a different one.
   */
  it("is diacritic-insensitive in both directions", () => {
    for (const [plain, accented, expected] of [
      ["racun", "račun", "racun-iban-provera"],
      ["povrsina", "površina", "povrsina"],
      ["duzina", "dužina", "duzina"],
    ] as const) {
      expect(first(plain), plain).toBe(expected);
      expect(first(accented), accented).toBe(expected);
      expect(results(plain), plain).toEqual(results(accented));
    }
    // „Č" in the QUERY, against a name that has one: the teacher's „čas" is not
    // the only reading. Both spellings narrow to the same list, and „Fond
    // časova" is in it — the row that opens first is an English name that
    // happens to begin with the same three letters, which is the documented
    // cost of searching both tables at once.
    expect(results("cas")).toEqual(results("čas"));
    expect(results("cas")).toContain("lesson-count-period");
    // „đ" is the one Serbian letter with no canonical decomposition, and the
    // folding table carries it explicitly.
    expect(results("đak")).toEqual(results("djak"));
  });

  it("requires every term, and ranks by the strongest one", () => {
    // „metar porez" is not a tool: a second word narrows instead of widening.
    expect(results("metar porez")).toEqual([]);
    // „pdv" NAMES the VAT tool and „racun" is one of its keywords, so the row
    // that matches both is the VAT tool — not the tools that match only „racun".
    expect(first("racun pdv")).toBe("pdv");
  });

  it("treats a blank query as no filter at all, in catalogue order", () => {
    expect(results("")).toEqual(catalogue.map((candidate) => candidate.id));
    expect(results("   ")).toEqual(results(""));
  });

  it("filters by task group, and a group filter never admits a tool outside it", () => {
    const money = results("", "sr", ["money"]);
    expect(money.length).toBeGreaterThan(0);
    expect(money.length).toBeLessThan(catalogue.length);
    for (const id of money) expect(entry(id).taskGroups, id).toContain("money");
    // Two groups at once is a widening, not a narrowing: the union of them, and
    // a tool filed under both („Rok plaćanja" is money AND dates) still appears
    // once.
    const dates = results("", "sr", ["dates"]);
    const both = results("", "sr", ["money", "dates"]);
    expect([...both].sort()).toEqual([...new Set([...money, ...dates])].sort());
  });
});

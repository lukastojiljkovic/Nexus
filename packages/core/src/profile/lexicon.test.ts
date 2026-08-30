import { describe, expect, it } from "vitest";

import { TOOL_PACKS } from "../contracts/tools.js";
import { TRADE_ACTIVITIES, TRADE_STEMS, recognizeTrades } from "./lexicon.js";

/** The packs a sentence resolves to, flattened — what the caller ultimately cares about. */
function packsFor(text: string): string[] {
  const found: string[] = [];
  for (const match of recognizeTrades(text)) {
    for (const pack of match.packs) if (!found.includes(pack)) found.push(pack);
  }
  return found;
}

describe("recognizeTrades", () => {
  it("reads a plain trade name", () => {
    expect(packsFor("stolar")).toEqual(["zanat", "gradnja"]);
  });

  /**
   * THE REASON MATCHING IS BY PREFIX AND NOT BY EQUALITY.
   *
   * Serbian inflects on the suffix, so a table of whole words would need one
   * row per case per trade — and the row somebody forgot is a person the app
   * fails to recognise. One stem, every ending.
   */
  it("reads the same trade in the cases somebody would actually type it in", () => {
    for (const text of ["stolar", "stolara", "stolaru", "stolari", "stolarski poslovi"]) {
      expect(packsFor(text), text).toEqual(["zanat", "gradnja"]);
    }
  });

  it("reads a trade written with diacritics, and written without them", () => {
    expect(packsFor("knjigovođa")).toEqual(["racunovodstvo"]);
    expect(packsFor("knjigovodja")).toEqual(["racunovodstvo"]);
  });

  it("reads a whole sentence and keeps what it recognised in the order it was said", () => {
    expect(packsFor("pravim nameštaj po meri i vodim knjige")).toEqual([
      "zanat",
      "gradnja",
      "racunovodstvo",
    ]);
  });

  it("quotes the word back as the person wrote it", () => {
    expect(recognizeTrades("radim kao ADVOKAT već 10 godina")).toEqual([
      { term: "ADVOKAT", packs: ["pravo"] },
    ]);
  });

  it("says the same thing once however many times it was said", () => {
    expect(recognizeTrades("advokat, advokatska kancelarija")).toHaveLength(1);
  });

  /**
   * THE NEGATIVE LIST IS THE HALF THAT KEEPS THE TABLE HONEST.
   *
   * A prefix match is cheap to widen and expensive to be wrong about: one stem
   * three characters too short turns an ordinary verb into a toolkit somebody
   * never asked for, and they have no way to know why it appeared. Each of
   * these is a phrase that MUST resolve to nothing, and each corresponds to a
   * stem that was tempting: „pravim" against `prav-` for law, „stanje" against
   * `stan-` for property, „firmware" against `firm-` for business.
   */
  it("recognises nothing in ordinary sentences that merely start like a trade", () => {
    for (const text of [
      "pravim planove za sledeću nedelju",
      "trenutno stanje na računu",
      "pišem firmware za mikrokontroler",
      "menjam stolicu u kancelariji",
      "prijatno mi je",
      "",
      "   ",
    ]) {
      expect(packsFor(text), text).toEqual([]);
    }
  });

  it("is not fooled by a stem appearing in the middle of a longer word", () => {
    // `farm-` would have matched „farmaceut", which is why agriculture is
    // spelled out by `poljoprivred-`, `ratar-` and the rest instead.
    expect(packsFor("farmaceut")).toEqual([]);
  });
});

describe("the lexicon table itself", () => {
  it("has no stem short enough to collide with an ordinary word", () => {
    expect(TRADE_STEMS.filter((entry) => entry.stem.length < 4)).toEqual([]);
  });

  /**
   * No stem may be a prefix of another. Two stems where one contains the other
   * make the result depend on which was tried first, and a table whose meaning
   * depends on its own row order is a table nobody can edit safely.
   */
  it("has no stem that is a prefix of another stem", () => {
    const overlapping: string[] = [];
    for (const a of TRADE_STEMS) {
      for (const b of TRADE_STEMS) {
        if (a.stem === b.stem || !b.stem.startsWith(a.stem)) continue;
        overlapping.push(`${a.stem} ⊂ ${b.stem}`);
      }
    }
    expect(overlapping).toEqual([]);
  });

  /**
   * Folded lower-case a–z, words separated by exactly one space. A stem
   * carrying a `š` matches nothing at all — the input is folded before it is
   * compared, so the row is dead and nothing says so. The space rule is the
   * same defence one level up: „vodim  knjige" with two spaces tokenises as
   * three words and silently never fires.
   */
  it("is written in the folded alphabet it matches against", () => {
    expect(TRADE_STEMS.filter((entry) => !/^[a-z]+( [a-z]+)*$/.test(entry.stem))).toEqual([]);
  });

  it("names only packs that exist", () => {
    const unknown = TRADE_STEMS.flatMap((entry) =>
      entry.packs.filter((pack) => !TOOL_PACKS.includes(pack)),
    );
    expect(unknown).toEqual([]);
  });

  it("gives every stem at least one pack", () => {
    expect(TRADE_STEMS.filter((entry) => entry.packs.length === 0)).toEqual([]);
  });

  /**
   * THE MEDICAL BAN, AS A TEST RATHER THAN AS A NOTE SOMEBODY READS.
   *
   * The `zdravstvo` pack was removed from the catalogue on purpose: intended
   * purpose is what makes software a medical device, and a toolkit addressed to
   * clinicians states an intended purpose. A lexicon entry would state the same
   * thing one level down — „you are a nurse, here are your tools" — so the ban
   * has to reach here too, and a helpful future addition has to fail rather
   * than merely be regretted.
   */
  it("recognises no clinical profession", () => {
    for (const text of [
      "lekar",
      "doktor medicine",
      "medicinska sestra",
      "stomatolog",
      "zubar",
      "farmaceut",
      "fizijatar",
      "psihijatar",
      "veterinar",
    ]) {
      expect(packsFor(text), text).toEqual([]);
    }
  });
});

describe("TRADE_ACTIVITIES", () => {
  /**
   * The safety net has to be a net. Somebody who types nothing the lexicon
   * knows still has to be able to reach every toolkit the product has, or the
   * screen quietly hides eighteen packs behind one text field.
   */
  it("can reach every pack the product has", () => {
    const reachable = new Set(TRADE_ACTIVITIES.flatMap((activity) => activity.packs));
    expect(TOOL_PACKS.filter((pack) => !reachable.has(pack))).toEqual([]);
  });

  it("names only packs that exist, and never an empty one", () => {
    for (const activity of TRADE_ACTIVITIES) {
      expect(activity.packs.length, activity.id).toBeGreaterThan(0);
      for (const pack of activity.packs) expect(TOOL_PACKS, activity.id).toContain(pack);
    }
  });

  it("gives every activity a distinct id", () => {
    const ids = TRADE_ACTIVITIES.map((activity) => activity.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

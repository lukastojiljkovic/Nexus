import { describe, expect, it } from "vitest";

import { englishFindings, scanFiles, scanRepo, serbianFindings } from "./check-english.mjs";

/**
 * `check:english` makes the second locale a property of the tree rather than of
 * whoever last read a screen.
 *
 * English landed on 2026-10-02 and the leftovers were found by reading screens:
 * a demo body, a component catalogue, the drawer's cron refusals, five note
 * templates and the Markdown mirror's own generated names were still Serbian
 * under an English interface, and every one of them typechecked, linted and
 * photographed as a correct screen. So this suite's first job is to show the
 * gate goes RED on each shape that was actually in the tree, and its second is
 * to show it stays quiet on the shapes that are correct — because a gate that
 * fires on `pre-ferment` or on a `"rok-poslednji-dan"` id is one somebody
 * switches off.
 */

const EN = "apps/desktop/src/renderer/src/strings/x.en.ts";
const COMPONENT = "apps/desktop/src/renderer/src/x.tsx";

describe("rule 1 — English copy holds no Serbian", () => {
  it("refuses a Serbian letter in an English table", () => {
    const findings = englishFindings(EN, 'export const en = { a: "Sačuvaj" };');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: "english-letter", line: 1, detail: "č" });
  });

  /** The defect that started this: a Serbian phrase with no diacritic in it at all. */
  it("refuses a stoplist word as a whole word", () => {
    const findings = englishFindings(EN, 'export const en = { a: "Bez naslova" };');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("english-word");
    expect(findings[0]?.detail).toBe("bez");
  });

  /** The English side of bilingual data is English copy, wherever it sits. */
  it("refuses Serbian in a `…En` property beside a Serbian field", () => {
    const source = 'export const C = [{ name: "Otpor", summaryEn: "Ograničava struju." }];';
    const findings = englishFindings("packages/core/src/x.ts", source);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toBe("č");
  });

  it("refuses Serbian in an `EN` table's VALUE but never in its Serbian key", () => {
    const source = 'export const EN: Record<string, string> = { "Bez naslova": "Untitled" };';
    expect(englishFindings("apps/desktop/src/main/demo/x.ts", source)).toEqual([]);
    const broken = 'export const EN: Record<string, string> = { "Bez naslova": "Sacuvaj" };';
    expect(englishFindings("apps/desktop/src/main/demo/x.ts", broken)).toHaveLength(1);
  });

  /**
   * The exclusions are load-bearing: every one of these words is Serbian AND
   * English, so a stoplist that carried them would have needed an exemption per
   * site — which is how an exemption list gets long enough to be ignored.
   */
  it("stays quiet on words that are Serbian and English at once", () => {
    const source =
      'export const en = { a: "A pre-ferment is neither flour nor water", b: "Status: 404", ' +
      '"c": "Shoot video", d: "Datum from the label", e: "The red tip of the tool" };';
    expect(englishFindings(EN, source)).toEqual([]);
  });

  /** Ids in this app are Serbian slugs (`SMART_LIST_IDS`), and an id is not a sentence. */
  it("stays quiet on identifiers and slugs, and still reads a bare word", () => {
    expect(englishFindings(EN, 'export const en = { "rok-poslednji-dan": "Deadline" };')).toEqual([]);
    expect(englishFindings(EN, 'export const en = { a: "[a-zA-Z_][a-zA-Z0-9_]*" };')).toEqual([]);
    // One bare lowercase word is a leaf somebody forgot, not an id.
    expect(englishFindings(EN, 'export const en = { a: "sacuvaj" };')).toHaveLength(1);
  });

  it("refuses an all-caps word, which is why NEMA is allowlisted one entry at a time", () => {
    const findings = englishFindings(EN, 'export const en = { a: "NEMA 17 (stepper)" };');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toBe("nema");
  });

  it("accepts the allowlisted literals, and only where the reason is", () => {
    expect(
      englishFindings("apps/desktop/src/main/demo/notes.en.ts", 'export const X = "Karađorđeva schnitzel";'),
    ).toEqual([]);
    // The same word in another file is not covered by that entry.
    expect(englishFindings(EN, 'export const en = { a: "Karađorđeva schnitzel" };')).toHaveLength(1);
  });

  /**
   * Main's notification copy composes a sentence per event instead of holding a
   * table, so its English half lives in branches. Missing them would have made
   * the loudest surface in the app — an OS toast — the one this gate ignored.
   */
  it("reads the English half of a guarded branch", () => {
    const ifBranch =
      'function f() { if (isEnglish()) { return { title: "Sačuvaj" }; } return { title: "Sačuvaj" }; }';
    const findings = englishFindings("apps/desktop/src/main/x.ts", ifBranch);
    // The English branch only: the Serbian one is another language, not a defect here.
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(1);

    const ternary = 'const t = mainLocale() === "en" ? "Bez naslova" : "Bez naslova";';
    expect(englishFindings("apps/desktop/src/main/x.ts", ternary)).toHaveLength(1);
    // An English branch that IS English stays quiet.
    expect(
      englishFindings("apps/desktop/src/main/x.ts", 'const t = isEnglish() ? "Untitled" : "Bez naslova";'),
    ).toEqual([]);
  });

  /** The two language-keyed records in the tree spell their halves `sr:` and `en:`. */
  it("reads a record's `en:` half", () => {
    const source = 'const COPY = { sr: { a: "Sačuvaj" }, en: { a: "Bez naslova" } };';
    const findings = englishFindings("packages/core/src/imex/x.ts", source);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toBe("bez");
  });

  /**
   * The generated ROS package and sketch are the one place where the English
   * line is an argument rather than a table entry — and the two files are
   * allowlisted for their Serbian, so an argument-only rule is all that reads
   * their English at all.
   */
  it("reads the `en` argument of the generated artefacts' `pick`", () => {
    const file = "packages/core/src/electronics/ros.ts";
    expect(englishFindings(file, 'const a = pick(language, "Masa", "Mass");')).toEqual([]);
    const findings = englishFindings(file, 'const a = pick(language, "Mass", "Bez naslova");');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toBe("bez");
    // A two-argument `pick` is somebody else's helper (`canvasPalette.ts`).
    expect(englishFindings(file, 'const a = pick("Bez naslova", CANVAS_INK);')).toEqual([]);
  });

});

describe("rule 2 — Serbian copy lives in Serbian tables", () => {
  /** Rule 2 is about Serbian LETTERS: a Serbian slug without one is an id, not copy. */
  it("refuses a Serbian literal in a component — including JSX text", () => {
    const findings = serbianFindings(COMPONENT, "export const A = () => <p>Sačuvaj izmene</p>;");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: "stray-serbian", line: 1 });
    expect(serbianFindings(COMPONENT, 'export const A = () => <p>{"Sačuvaj"}</p>;')).toHaveLength(1);
  });

  it("stays quiet inside a Serbian table, a Serbian source and a test", () => {
    const source = 'export const sr = { save: "Sačuvaj izmene" };';
    expect(serbianFindings("apps/desktop/src/renderer/src/strings.sr.ts", source)).toEqual([]);
    expect(serbianFindings("apps/desktop/src/main/demo/tasks.ts", source)).toEqual([]);
    expect(serbianFindings("apps/desktop/src/renderer/src/x.test.ts", source)).toEqual([]);
    expect(serbianFindings("packages/core/src/electronics/catalogue/sensors.ts", source)).toEqual([]);
  });

  /** An English table's Serbian is rule 1's finding; reporting it twice is one defect, two lines. */
  it("leaves an English table to rule 1", () => {
    const source = 'export const en = { a: "Sačuvaj" };';
    expect(serbianFindings(EN, source)).toEqual([]);
    expect(englishFindings(EN, source)).toHaveLength(1);
  });

  it("accepts an allowlisted literal in a file that is otherwise judged", () => {
    const source = 'const SMOKE_TITLE = "Rešenje za Đorđa";';
    expect(serbianFindings("apps/desktop/src/main/index.ts", source)).toEqual([]);
    expect(serbianFindings("apps/desktop/src/main/index.ts", 'const T = "Rešenje za Đorđa i još";')).toEqual(
      [],
    );
    // A different Serbian string in the same file is still a finding.
    expect(serbianFindings("apps/desktop/src/main/index.ts", 'const T = "Podešavanja";')).toHaveLength(1);
  });
});

describe("the walk", () => {
  it("covers the desktop app and every package, and nothing on hold", () => {
    const files = scanFiles();
    expect(files).toContain("apps/desktop/src/renderer/src/strings.sr.ts");
    expect(files).toContain("packages/core/src/index.ts");
    expect(files.some((file) => file.startsWith("apps/web/"))).toBe(false);
    expect(files.some((file) => file.startsWith("apps/gallery/"))).toBe(false);
    // Tests are walked and skipped by the rules, so the census counts them.
    expect(files).toContain("apps/desktop/src/renderer/src/strings.test.ts");
  });
});

describe("the repository", () => {
  it("has no Serbian in English copy and none outside a Serbian table", () => {
    const { findings, census } = scanRepo();
    expect(findings).toEqual([]);
    // Guards the guard: a walk that found nothing would pass the line above.
    expect(census.englishTables).toBeGreaterThan(20);
    expect(census.serbianSources).toBeGreaterThan(10);
    // The walk parses about 1,100 files: around 4 s on a quiet machine, past
    // Vitest's 5 s default on a busy one.
  }, 30_000);
});

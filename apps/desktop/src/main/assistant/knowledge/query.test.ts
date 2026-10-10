import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "@nexus/core";
import { orMatchExpression } from "./query.js";

describe("orMatchExpression", () => {
  it("joins the terms with OR, each quoted", () => {
    expect(orMatchExpression(["kako", "modul"])).toBe('"kako" OR "modul"');
  });

  it("answers null when there is nothing to search for", () => {
    expect(orMatchExpression([])).toBeNull();
    // A term that is only quotes would produce an expression FTS5 reads as an
    // empty phrase, which matches nothing and costs a query.
    expect(orMatchExpression(['"'])).toBeNull();
  });

  it("strips a quote a term could never contain from the parser, because this is exported", () => {
    expect(orMatchExpression(['a"b'])).toBe('"ab"');
  });

  it("reads a real question through the app's own tokenizer", () => {
    // `parseSearchQuery` folds each term (so a query typed without diacritics
    // meets a passage written with them) and drops punctuation, which is why the
    // expression below has three terms and not five words.
    const parsed = parseSearchQuery("Kako iskljuciti modul?");
    expect(orMatchExpression(parsed.terms)).toBe('"kako" OR "iskljuciti" OR "modul"');
  });

  it("folds a diacritic question to the same terms as the plain spelling", () => {
    expect(orMatchExpression(parseSearchQuery("podešavanja").terms)).toBe(
      orMatchExpression(parseSearchQuery("podesavanja").terms),
    );
  });
});

import { describe, expect, it } from "vitest";

import { filterValue, jsonHeaders, parseFailure, parseRows, postgrestPath, queryString } from "./http.js";

/**
 * The twenty-one object-id shapes measured against a running PostgREST.
 *
 * Every one of them, percent-encoded and unquoted, matched exactly one row on a
 * `PATCH`; every one of them, double-quoted, matched none. The list is here in
 * full rather than as three representative cases because it is the evidence, and
 * because the shapes that look harmless (`plain`, `2026-08-09.x`) are the ones
 * that make a reader think the rule is about exotic input.
 */
const ID_SHAPES = [
  "plain2",
  "",
  "a,b",
  "2026-08-09.x",
  'he said "hi"',
  "back\\slash",
  "note-id42",
  "f(x)",
  "a*b",
  "a:b",
  "a b",
  "Ćevapčići",
  "a+b",
  "100%done",
  "a&b",
  "a#b",
  "a/b",
  "null",
  "true",
  "..",
  "is.null",
] as const;

describe("filterValue", () => {
  it("never emits a character that would end the value or start another parameter", () => {
    for (const id of ID_SHAPES) {
      const encoded = filterValue(id);
      // `&` and `#` would end the parameter, `?` and `=` would restructure the
      // query, and a space or a U+001F (the last entry) is not legal in a URL.
      for (const breaker of ["&", "#", "?", "=", " ", '"', ""]) {
        expect(encoded.includes(breaker), `${JSON.stringify(id)} → ${encoded}`).toBe(false);
      }
    }
  });

  it("does not quote — quoting is what made every PATCH match nothing", () => {
    // The failure this asserts against is silent: a PATCH whose filter matches
    // no row is HTTP 200 with `[]`, so a quoted value produces a successful sync
    // of an edit that was never written.
    for (const id of ID_SHAPES) {
      expect(filterValue(id).startsWith("%22")).toBe(false);
    }
  });

  it("leaves the empty object id as the empty string, which is what matched", () => {
    // The six per-profile singletons. `object_id=eq.` with nothing after it is
    // the form the server accepted; `eq.%22%22` returned no rows.
    expect(filterValue("")).toBe("");
  });

  it("round-trips through the decoder the server applies", () => {
    for (const id of ID_SHAPES) {
      expect(decodeURIComponent(filterValue(id))).toBe(id);
    }
  });
});

describe("queryString", () => {
  it("is empty when there is nothing to say", () => {
    expect(queryString([])).toBe("");
  });

  it("encodes structural values as well as filters", () => {
    // Safe because PostgREST percent-decodes before parsing — measured, see the
    // function's comment. One rule for every value is what keeps a second,
    // unencoded path from existing.
    expect(queryString([["select", "collection,seq"]])).toBe("?select=collection%2Cseq");
    expect(queryString([["order", "seq.asc"]])).toBe("?order=seq.asc");
  });

  it("joins with & and keeps the given order", () => {
    expect(
      queryString([
        ["user_id", "eq.u"],
        ["seq", "gt.4"],
      ]),
    ).toBe("?user_id=eq.u&seq=gt.4");
  });
});

describe("postgrestPath", () => {
  it("names the table under the root and never a host", () => {
    const path = postgrestPath("sync_objects", [["limit", "1"]]);
    expect(path).toBe("/sync_objects?limit=1");
    expect(path.includes("://")).toBe(false);
  });
});

describe("jsonHeaders", () => {
  it("omits Prefer entirely when there is none, rather than sending an empty one", () => {
    expect(jsonHeaders()).toEqual({ "Content-Type": "application/json" });
  });

  it("carries Prefer when there is one", () => {
    expect(jsonHeaders("return=representation")["Prefer"]).toBe("return=representation");
  });
});

describe("parseFailure", () => {
  it("reads the four fields PostgREST sends", () => {
    // Verbatim from a live NX001, the error a losing race produces.
    const body =
      '{"code":"NX001","details":"object x: 2 -> 9","hint":"Re-read the row, merge, and write ' +
      'observed_version + 1.","message":"sync_objects.version must be exactly one more than the stored version"}';
    expect(parseFailure(body)).toEqual({
      code: "NX001",
      details: "object x: 2 -> 9",
      hint: "Re-read the row, merge, and write observed_version + 1.",
      message: "sync_objects.version must be exactly one more than the stored version",
    });
  });

  it("returns nulls for a body that is not a failure, and never throws", () => {
    // What a proxy's HTML error page, a truncated response and a gateway timeout
    // all look like. A throw here would put a hostile server in charge of which
    // of this client's code paths run.
    const empty = { code: null, message: null, details: null, hint: null };
    for (const body of ["<html>502</html>", "", "[]", "null", '"a string"', '{"code":7}']) {
      expect(parseFailure(body)).toEqual(empty);
    }
  });
});

describe("parseRows", () => {
  it("accepts an array and nothing else", () => {
    expect(parseRows("[]")).toEqual([]);
    expect(parseRows('[{"seq":1}]')).toEqual([{ seq: 1 }]);
    expect(parseRows('{"seq":1}')).toBeNull();
    expect(parseRows("not json")).toBeNull();
  });
});

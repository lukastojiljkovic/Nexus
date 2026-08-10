import { describe, expect, it } from "vitest";

import {
  CONVERSION_LIMIT_CODES,
  DATA_FORMATS,
  STRUCTURED_ERROR_CODES,
  type StructuredValue,
  convertFormat,
  conversionLimits,
  decimalSurvivesDouble,
  formatJson,
  minifyJson,
  parseCsvRows,
  parseCsvValue,
  parseJson,
  parseToml,
  positionAt,
  queryJsonPath,
  sortJsonKeys,
  stringifyCsv,
  stringifyJson,
  stringifyToml,
  validateJson,
} from "./structured.js";

/** The value this text holds, or a thrown assertion. */
function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(`expected a value, got ${result.error.code}`);
  return result.value;
}

/** The refusal this result carries, reduced to what a test asserts. */
function refusal(result: { ok: boolean; error?: unknown }): {
  code: string;
  line: number;
  column: number;
  offset: number;
} {
  if (result.ok) throw new Error("expected a refusal");
  const error = result.error as { code: string; line: number; column: number; offset: number };
  return { code: error.code, line: error.line, column: error.column, offset: error.offset };
}

describe("positionAt", () => {
  it("counts from 1 and reports the offset it was given", () => {
    expect(positionAt("abc", 0)).toEqual({ line: 1, column: 1, offset: 0 });
    expect(positionAt("abc", 2)).toEqual({ line: 1, column: 3, offset: 2 });
  });

  it("counts all three line terminators as one break each", () => {
    // "a\nb" — the b is at offset 2, line 2, column 1.
    expect(positionAt("a\nb", 2)).toEqual({ line: 2, column: 1, offset: 2 });
    // "a\r\nb" — the b is at offset 3, still line 2 column 1: CRLF is ONE break.
    expect(positionAt("a\r\nb", 3)).toEqual({ line: 2, column: 1, offset: 3 });
    // A lone CR is a break too, which is what an old Mac file uses.
    expect(positionAt("a\rb", 2)).toEqual({ line: 2, column: 1, offset: 2 });
  });

  it("clamps an offset past the end rather than reporting nonsense", () => {
    expect(positionAt("ab", 99)).toEqual({ line: 1, column: 3, offset: 2 });
  });
});

describe("decimalSurvivesDouble", () => {
  it("accepts the decimals a double gives back unchanged", () => {
    // 0,1 has no exact binary form, yet String(0.1) is „0.1" — the DECIMAL
    // survives, which is the question this asks.
    expect(decimalSurvivesDouble("0.1")).toBe(true);
    expect(decimalSurvivesDouble("1.0")).toBe(true);
    expect(decimalSurvivesDouble("1e3")).toBe(true);
    expect(decimalSurvivesDouble("-42")).toBe(true);
    expect(decimalSurvivesDouble("0.30000000000000004")).toBe(true);
  });

  it("refuses the decimals a double rounds", () => {
    // 2^53 + 1 = 9007199254740993 is the smallest integer a double cannot hold.
    expect(decimalSurvivesDouble("9007199254740993")).toBe(false);
    expect(decimalSurvivesDouble("12345678901234567890")).toBe(false);
    expect(decimalSurvivesDouble("1.0000000000000000001")).toBe(false);
    // 1e400 overflows to Infinity, which is not a decimal at all.
    expect(decimalSurvivesDouble("1e400")).toBe(false);
  });

  it("treats the sign of zero as no difference, because no target format has one", () => {
    expect(decimalSurvivesDouble("-0")).toBe(true);
    expect(decimalSurvivesDouble("-0.0")).toBe(true);
  });
});

describe("JSON — validation with a position", () => {
  it("accepts every value the grammar admits", () => {
    for (const text of ['{"a":1}', "[]", "{}", '"x"', "1", "-1.5e+3", "true", "false", "null"]) {
      expect(validateJson(text), text).toBeNull();
    }
  });

  it("points at the character that was not a key", () => {
    // '{"a": 1,}' — the } sits at offset 8, so column 9.
    expect(refusal(parseJson('{"a": 1,}'))).toEqual({
      code: "json.unexpected-char",
      line: 1,
      column: 9,
      offset: 8,
    });
  });

  it("points at the missing colon", () => {
    // '{"a" 1}' — the 1 is at offset 5.
    expect(refusal(parseJson('{"a" 1}'))).toEqual({
      code: "json.unexpected-char",
      line: 1,
      column: 6,
      offset: 5,
    });
  });

  it("points past the end when the document simply stops", () => {
    // '[1, 2\n' is six characters; the whitespace is consumed and the caret
    // lands one past the last one, on line 2.
    expect(refusal(parseJson("[1, 2\n"))).toEqual({
      code: "json.unexpected-end",
      line: 2,
      column: 1,
      offset: 6,
    });
  });

  it("points at the digit that follows a leading zero", () => {
    // '{"a": 01}' — the 0 is at offset 6 and the offending 1 at 7.
    expect(refusal(parseJson('{"a": 01}'))).toEqual({
      code: "json.leading-zero",
      line: 1,
      column: 8,
      offset: 7,
    });
  });

  it("points at a raw control character inside a string", () => {
    expect(refusal(parseJson('"a\nb"'))).toEqual({
      code: "json.control-char",
      line: 1,
      column: 3,
      offset: 2,
    });
  });

  it("points at the trailing junk after a complete value", () => {
    expect(refusal(parseJson("[1] extra"))).toEqual({
      code: "json.trailing-content",
      line: 1,
      column: 5,
      offset: 4,
    });
  });

  it("counts lines, so a fault on line 2 is reported on line 2", () => {
    // '{\n  "a": tru\n}' — line 2 starts at offset 2 and the t is at offset 9.
    expect(refusal(parseJson('{\n  "a": tru\n}'))).toEqual({
      code: "json.unexpected-char",
      line: 2,
      column: 8,
      offset: 9,
    });
  });

  it("names the fraction and exponent that never arrived", () => {
    expect(refusal(parseJson('{"a": 1.}')).code).toBe("json.missing-fraction");
    expect(refusal(parseJson('{"a": 1e}')).code).toBe("json.missing-exponent");
  });

  it("never throws for user input, whatever the shape", () => {
    for (const text of ["", "{", "[", '"', "\\", "{}}", "[,]", '{"a"', "nul", "-", "0x1"]) {
      expect(() => parseJson(text), JSON.stringify(text)).not.toThrow();
    }
  });
});

describe("JSON — formatting preserves lexemes", () => {
  it("lays a document out at the indent asked for", () => {
    expect(value(formatJson('{"b":1,"a":[1,2]}'))).toBe(
      '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}',
    );
    expect(value(formatJson('{"a":1}', { indent: 4 }))).toBe('{\n    "a": 1\n}');
    expect(value(formatJson('{"a":1}', { indent: "tab" }))).toBe('{\n\t"a": 1\n}');
  });

  it("keeps empty containers on one line", () => {
    expect(value(formatJson('{"a":{},"b":[]}'))).toBe('{\n  "a": {},\n  "b": []\n}');
  });

  it("re-emits a number as the digits the user wrote, never as a re-rendered double", () => {
    const text = '{"n": 1.50, "big": 12345678901234567890, "e": 1E+2}';
    const formatted = value(formatJson(text));
    expect(formatted).toContain("1.50");
    expect(formatted).toContain("12345678901234567890");
    expect(formatted).toContain("1E+2");
  });

  it("re-emits a string as the escape sequence the user wrote", () => {
    expect(value(minifyJson('{"a": "\\u0041"}'))).toBe('{"a":"\\u0041"}');
  });

  it("keeps duplicate keys on the TEXT path, where nothing has to choose between them", () => {
    expect(value(minifyJson('{"a":1,"a":2}'))).toBe('{"a":1,"a":2}');
  });

  it("minifies to no whitespace at all", () => {
    expect(value(minifyJson('{\n  "a": [ 1, 2 ]\n}'))).toBe('{"a":[1,2]}');
  });

  it("round-trips: formatting a minified document and minifying a formatted one both settle", () => {
    const samples = ['{"a":[1,{"b":null}],"c":"x"}', "[]", "{}", "[[1],[2]]", '{"a":1.5e-7}'];
    for (const text of samples) {
      const formatted = value(formatJson(text));
      expect(value(minifyJson(formatted)), text).toBe(value(minifyJson(text)));
      expect(value(formatJson(value(minifyJson(text)))), text).toBe(formatted);
    }
  });

  it("sorts keys at every depth, in Serbian Latin order", () => {
    // Š sorts between S and Z in sr-Latn; by code point it would land after Z.
    expect(value(sortJsonKeys('{"Zadatak":1,"Šifra":{"b":1,"a":2},"Sat":3}'))).toBe(
      '{\n  "Sat": 3,\n  "Šifra": {\n    "a": 2,\n    "b": 1\n  },\n  "Zadatak": 1\n}',
    );
  });
});

describe("JSON — the value path", () => {
  it("refuses a duplicate key at the second one, rather than letting the last win", () => {
    // '{"a":1,"a":2}' — the second key opens at offset 7.
    expect(refusal(parseJson('{"a":1,"a":2}'))).toEqual({
      code: "json.duplicate-key",
      line: 1,
      column: 8,
      offset: 7,
    });
  });

  it("reads a number as a double while inspecting, and refuses one that would round on the way out", () => {
    // Written through `Number` rather than as a literal: the literal itself
    // would lose precision in this file, which is the very thing under test.
    expect(value(parseJson('{"n":12345678901234567890}'))).toEqual({
      n: Number("12345678901234567890"),
    });
    expect(refusal(parseJson('{"n":12345678901234567890}', { exactNumbers: true }))).toEqual({
      code: "json.number-not-exact",
      line: 1,
      column: 6,
      offset: 5,
    });
  });

  it("writes a value back out, refusing the two numbers JSON cannot spell", () => {
    expect(value(stringifyJson({ a: 1, b: [true, null] }))).toBe(
      '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}',
    );
    expect(refusal(stringifyJson({ a: Number.NaN })).code).toBe("json.no-nan");
    expect(refusal(stringifyJson({ a: Number.POSITIVE_INFINITY })).code).toBe("json.no-nan");
  });

  it("writes ONE line at indent 0, not a newline per member with no indentation", () => {
    // `JSON.stringify(v, null, 0)` is compact, and so is this. The half-way
    // reading — newlines kept, indentation zero — is what the JSONPath results
    // table was showing, where the breaks were hidden by `nowrap` until the
    // moment somebody copied a cell.
    expect(value(stringifyJson({ a: 1, b: [true, null] }, { indent: 0 }))).toBe(
      '{"a":1,"b":[true,null]}',
    );
  });
});

describe("the JSONPath subset", () => {
  const document = value(
    parseJson(
      '{"store":{"book":[{"title":"a","price":1},{"title":"b","price":2}],' +
        '"bicycle":{"colour":"crvena"}}}',
    ),
  );

  const query = (path: string): unknown => value(queryJsonPath(document, path));

  it("walks keys, indices and both bracket spellings", () => {
    expect(query("$")).toEqual([document]);
    expect(query("$.store.book[0].title")).toEqual(["a"]);
    expect(query("$['store']['bicycle']")).toEqual([{ colour: "crvena" }]);
    expect(query('$["store"]["bicycle"]["colour"]')).toEqual(["crvena"]);
  });

  it("walks a wildcard over an array's items and an object's values alike", () => {
    expect(query("$.store.book[*].price")).toEqual([1, 2]);
    expect(query("$.store[*]")).toEqual([
      [
        { title: "a", price: 1 },
        { title: "b", price: 2 },
      ],
      { colour: "crvena" },
    ]);
  });

  it("descends recursively, in document order, self before children", () => {
    expect(query("$..title")).toEqual(["a", "b"]);
    expect(query("$..price")).toEqual([1, 2]);
  });

  it("answers an empty set for a path that matched nothing — which is not a failure", () => {
    expect(query("$.store.book[5]")).toEqual([]);
    expect(query("$.nema")).toEqual([]);
  });

  it("refuses a path with no root, at the first character", () => {
    expect(refusal(queryJsonPath(document, "store.book"))).toEqual({
      code: "path.expected-root",
      line: 1,
      column: 1,
      offset: 0,
    });
  });

  it("names every JSONPath construct it does not implement, rather than matching nothing", () => {
    const cases = [
      { path: "$.a[?(@.x)]", found: "filter", offset: 4 },
      { path: "$.a[-1]", found: "negative-index", offset: 4 },
      { path: "$.a[1:2]", found: "slice", offset: 5 },
      { path: "$.a[1,2]", found: "union", offset: 5 },
      { path: "$.*", found: ".*", offset: 2 },
      { path: "$..*", found: "recursive-wildcard", offset: 3 },
    ];
    for (const { path, found, offset } of cases) {
      const result = queryJsonPath(document, path);
      expect(result.ok, path).toBe(false);
      if (result.ok) continue;
      expect(result.error.code, path).toBe("path.unsupported");
      expect(result.error.found, path).toBe(found);
      expect(result.error.offset, path).toBe(offset);
    }
  });
});

describe("CSV — RFC 4180", () => {
  it("reads CRLF rows and plain LF rows alike", () => {
    expect(value(parseCsvRows("a,b\r\n1,2\r\n"))).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(value(parseCsvRows("a,b\n1,2"))).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("reads a quoted field holding the delimiter, a line break and a doubled quote", () => {
    expect(value(parseCsvRows('"a,b",c\r\n'))).toEqual([["a,b", "c"]]);
    expect(value(parseCsvRows('"line\nbreak",x\r\n'))).toEqual([["line\nbreak", "x"]]);
    expect(value(parseCsvRows('"say ""hi""",x\r\n'))).toEqual([['say "hi"', "x"]]);
  });

  it("reads an empty field as an empty field and an empty file as no rows", () => {
    expect(value(parseCsvRows("a,,c"))).toEqual([["a", "", "c"]]);
    expect(value(parseCsvRows(""))).toEqual([]);
  });

  it("takes another delimiter when the file uses one", () => {
    expect(value(parseCsvRows("a;b\r\n1;2\r\n", { delimiter: ";" }))).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("points at the quote that was never closed", () => {
    // '"a,b\n' — the opening quote is at offset 0.
    expect(refusal(parseCsvRows('"a,b\n'))).toEqual({
      code: "csv.unterminated-quote",
      line: 1,
      column: 1,
      offset: 0,
    });
  });

  it("points at the character sitting after a closing quote", () => {
    // '"a"b,c' — the b is at offset 3.
    expect(refusal(parseCsvRows('"a"b,c'))).toEqual({
      code: "csv.text-after-quote",
      line: 1,
      column: 4,
      offset: 3,
    });
  });

  it("points at the start of a row with too many fields", () => {
    // 'a,b\n1,2,3\n' — the second row starts at offset 4.
    expect(refusal(parseCsvRows("a,b\n1,2,3\n"))).toEqual({
      code: "csv.ragged-row",
      line: 2,
      column: 1,
      offset: 4,
    });
  });

  it("points at the end of a row with too few, where the missing field would have been", () => {
    // 'a,b,c\n1,2\n' — the second row ends at its terminator, offset 9.
    expect(refusal(parseCsvRows("a,b,c\n1,2\n"))).toEqual({
      code: "csv.ragged-row",
      line: 2,
      column: 4,
      offset: 9,
    });
  });

  it("drops blank lines at the end of the file and keeps one in the middle", () => {
    expect(value(parseCsvRows("a,b\r\n1,2\r\n\r\n\r\n"))).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(refusal(parseCsvRows("a,b\n\n1,2\n")).code).toBe("csv.ragged-row");
  });

  it("builds objects from the header row, every cell a string", () => {
    expect(value(parseCsvValue("ime,broj\r\nLuka,007\r\n"))).toEqual([{ ime: "Luka", broj: "007" }]);
  });

  it("refuses a repeated header name at the second one", () => {
    expect(refusal(parseCsvValue("a,a\n1,2\n"))).toEqual({
      code: "csv.duplicate-header",
      line: 1,
      column: 3,
      offset: 2,
    });
  });

  it("writes what it reads: every row terminated, quoting only what RFC 4180 requires", () => {
    const rows = [
      ["ime", "opis"],
      ["Luka", 'a,b "c"'],
    ];
    const text = stringifyCsv(rows);
    expect(text).toBe('ime,opis\r\nLuka,"a,b ""c"""\r\n');
    expect(value(parseCsvRows(text))).toEqual(rows);
  });

  it("never throws for user input, whatever the shape", () => {
    for (const text of ['"', '""', ",", "\n", '"a""', 'a"b', "\r"]) {
      expect(() => parseCsvRows(text), JSON.stringify(text)).not.toThrow();
    }
  });
});

describe("TOML", () => {
  it("reads tables, arrays of tables and dotted keys", () => {
    const text = [
      'title = "Nexus"',
      "servers.alpha.port = 8080",
      "",
      "[owner]",
      'name = "Luka"',
      "",
      "[[bin]]",
      'name = "a"',
      "",
      "[[bin]]",
      'name = "b"',
      "",
    ].join("\n");
    expect(value(parseToml(text))).toEqual({
      title: "Nexus",
      servers: { alpha: { port: 8080 } },
      owner: { name: "Luka" },
      bin: [{ name: "a" }, { name: "b" }],
    });
  });

  /**
   * The trap that made the test above wrong the first time it was written: a
   * dotted key belongs to whichever table header last opened, NOT to the root.
   * `a.b = 1` under `[t]` is `t.a.b`, and a reader that put it at the root would
   * quietly move data between tables.
   */
  it("files a dotted key under the table header that is open, not under the root", () => {
    expect(value(parseToml('[t]\na.b = 1\n'))).toEqual({ t: { a: { b: 1 } } });
    expect(value(parseToml('[[rows]]\na.b = 1\n'))).toEqual({ rows: [{ a: { b: 1 } }] });
  });

  it("reads the four scalar types, including every integer spelling", () => {
    const text = [
      "a = 1_000",
      "b = 0x1f",
      "c = 0o17",
      "d = 0b101",
      "e = 1.5e2",
      "f = true",
      'g = "x"',
      "h = 'C:\\path'",
      "",
    ].join("\n");
    // 0x1f is 31, 0o17 is 15, 0b101 is 5, 1.5e2 is 150 — all by hand.
    expect(value(parseToml(text))).toEqual({
      a: 1000,
      b: 31,
      c: 15,
      d: 5,
      e: 150,
      f: true,
      g: "x",
      h: "C:\\path",
    });
  });

  it("reads the special floats and an array", () => {
    const parsed = value(parseToml("a = inf\nb = -inf\nc = nan\nd = [1, 2, 3]\ne = []\n")) as Record<
      string,
      StructuredValue
    >;
    expect(parsed.a).toBe(Number.POSITIVE_INFINITY);
    expect(parsed.b).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(parsed.c as number)).toBe(true);
    expect(parsed.d).toEqual([1, 2, 3]);
    expect(parsed.e).toEqual([]);
  });

  it("reads a multi-line basic string, dropping the break that follows the opener", () => {
    expect(value(parseToml('a = """\nline1\nline2"""\n'))).toEqual({ a: "line1\nline2" });
  });

  it("drops comments", () => {
    expect(value(parseToml("# note\na = 1 # trailing\n"))).toEqual({ a: 1 });
  });

  it("refuses an inline table by name, at the brace", () => {
    expect(refusal(parseToml("a = {x = 1}\n"))).toEqual({
      code: "toml.inline-table-unsupported",
      line: 1,
      column: 5,
      offset: 4,
    });
  });

  it("refuses a date, because a wall clock with no zone cannot become a JavaScript Date", () => {
    expect(refusal(parseToml("d = 1979-05-27\n"))).toEqual({
      code: "toml.datetime-unsupported",
      line: 1,
      column: 5,
      offset: 4,
    });
  });

  it("refuses a duplicate key at the second statement", () => {
    // 'a = 1\n' is six characters, so the second statement opens at offset 6.
    expect(refusal(parseToml("a = 1\na = 2\n"))).toEqual({
      code: "toml.duplicate-key",
      line: 2,
      column: 1,
      offset: 6,
    });
  });

  it("refuses a table declared twice", () => {
    expect(refusal(parseToml("[t]\n[t]\n"))).toEqual({
      code: "toml.redefined-table",
      line: 2,
      column: 1,
      offset: 4,
    });
  });

  it("refuses a value that is not one, and a number a double would round", () => {
    expect(refusal(parseToml("a = \n")).code).toBe("toml.bad-value");
    expect(refusal(parseToml("n = 12345678901234567890\n"))).toEqual({
      code: "toml.number-not-exact",
      line: 1,
      column: 5,
      offset: 4,
    });
  });

  it("never throws for user input, whatever the shape", () => {
    for (const text of ["", "[", "[]", "a", "a =", '"', "'", "[[a]", "a.b", "= 1", "[a\n"]) {
      expect(() => parseToml(text), JSON.stringify(text)).not.toThrow();
    }
  });

  it("writes tables after the keys they sit beside, which is what the format requires", () => {
    expect(value(stringifyToml({ title: "Nexus", owner: { name: "Luka" } }))).toBe(
      'title = "Nexus"\n\n[owner]\nname = "Luka"\n',
    );
  });

  it("writes an array of objects as repeated table headers", () => {
    expect(value(stringifyToml({ bin: [{ name: "a" }, { name: "b" }] }))).toBe(
      '[[bin]]\nname = "a"\n\n[[bin]]\nname = "b"\n',
    );
  });

  it("refuses a root that is not a table, and a null, which TOML has no spelling for", () => {
    expect(refusal(stringifyToml([1, 2])).code).toBe("convert.toml-root-not-table");
    expect(refusal(stringifyToml({ a: null })).code).toBe("convert.toml-null");
  });

  it("round-trips every value it can hold", () => {
    const samples: readonly StructuredValue[] = [
      {},
      { a: 1, b: "x", c: true },
      { a: { b: { c: 1 } } },
      { list: [1, 2, 3] },
      { rows: [{ a: 1 }, { a: 2 }] },
      { "key with spaces": 1 },
    ];
    for (const sample of samples) {
      const text = value(stringifyToml(sample));
      expect(value(parseToml(text)), text).toEqual(sample);
    }
  });
});

describe("converting between the four formats", () => {
  it("carries a document from JSON to YAML and back", () => {
    const json = '{"ime":"Luka","brojevi":[1,2],"ugniježđeno":{"a":true}}';
    const yaml = value(convertFormat(json, "json", "yaml"));
    expect(yaml).toBe("ime: Luka\nbrojevi:\n  - 1\n  - 2\nugniježđeno:\n  a: true\n");
    expect(value(convertFormat(yaml, "yaml", "json", { indent: 0 }))).toBe(
      value(convertFormat(json, "json", "json", { indent: 0 })),
    );
  });

  it("carries a document from JSON to TOML and back", () => {
    const json = '{"title":"Nexus","owner":{"name":"Luka"}}';
    const toml = value(convertFormat(json, "json", "toml"));
    expect(toml).toBe('title = "Nexus"\n\n[owner]\nname = "Luka"\n');
    expect(value(convertFormat(toml, "toml", "json", { indent: 0 }))).toBe(json);
  });

  it("carries a table from JSON to CSV and back, every cell still text", () => {
    const json = '[{"ime":"Luka","broj":"007"},{"ime":"Ana","broj":"008"}]';
    const csv = value(convertFormat(json, "json", "csv"));
    expect(csv).toBe("ime,broj\r\nLuka,007\r\nAna,008\r\n");
    expect(value(convertFormat(csv, "csv", "json", { indent: 0 }))).toBe(json);
  });

  it("refuses to flatten nesting into CSV", () => {
    expect(refusal(convertFormat('[{"a":{"b":1}}]', "json", "csv")).code).toBe("convert.csv-nesting");
    expect(refusal(convertFormat('{"a":1}', "json", "csv")).code).toBe("convert.csv-needs-rows");
  });

  it("refuses to write a null into CSV, where it would come back an empty string", () => {
    expect(refusal(convertFormat('[{"a":null}]', "json", "csv")).code).toBe("convert.csv-null");
    // The loss is available, but only when it is asked for by name.
    expect(value(convertFormat('[{"a":null}]', "json", "csv", { csv: { nullAs: "empty" } }))).toBe(
      "a\r\n\r\n",
    );
  });

  it("refuses a header row whose columns do not line up across the objects", () => {
    expect(refusal(convertFormat('[{"a":1},{"b":2}]', "json", "csv")).code).toBe(
      "convert.csv-ragged-object",
    );
  });

  it("refuses a top-level array on the way to TOML, which has no spelling for one", () => {
    expect(refusal(convertFormat("[1,2]", "json", "toml")).code).toBe("convert.toml-root-not-table");
  });

  it("refuses a not-a-number on the way to JSON, which has no spelling for one", () => {
    expect(refusal(convertFormat("a: .nan\n", "yaml", "json")).code).toBe("json.no-nan");
  });

  it("refuses a number that would be rounded by the conversion", () => {
    expect(refusal(convertFormat('{"n":12345678901234567890}', "json", "yaml")).code).toBe(
      "json.number-not-exact",
    );
  });

  /**
   * The same guard from every source, which is the whole point of it: the double
   * nearest 12345678901234567890 is 12345678901234567168, so writing it back
   * gives „12345678901234567000" — different digits from the ones in the file.
   * A YAML source used to be the one way past the guard.
   */
  it("refuses that number from a YAML and a TOML source too, not only from a JSON one", () => {
    expect(refusal(convertFormat("n: 12345678901234567890\n", "yaml", "json")).code).toBe(
      "yaml.number-not-exact",
    );
    expect(refusal(convertFormat("n = 12345678901234567890\n", "toml", "json")).code).toBe(
      "toml.number-not-exact",
    );
    // A number that DOES survive still crosses, from either source.
    expect(value(convertFormat("n: 1.5\n", "yaml", "json", { indent: 0 }))).toBe('{"n":1.5}');
  });

  it("carries a leading-zero YAML scalar across as the text it is", () => {
    // The postal code arrives whole. Resolved as a number it would have crossed
    // as 7, and nothing downstream could tell that the file said 007.
    expect(value(convertFormat("zip: 007\n", "yaml", "json", { indent: 0 }))).toBe('{"zip":"007"}');
  });

  it("refuses to call a multi-document YAML stream one document", () => {
    expect(refusal(convertFormat("a: 1\n---\nb: 2\n", "yaml", "json")).code).toBe(
      "convert.yaml-multiple-documents",
    );
  });

  it("converts a format to itself as a normaliser rather than refusing", () => {
    expect(value(convertFormat('{"b":1,"a":2}', "json", "json", { sortKeys: true }))).toBe(
      '{\n  "a": 2,\n  "b": 1\n}',
    );
  });

  it("states what a conversion cannot carry, before it is asked to carry it", () => {
    expect(conversionLimits("json", "csv")).toEqual(["limit.csv-flat-only", "limit.csv-no-null"]);
    expect(conversionLimits("yaml", "json")).toEqual([
      "limit.comments-lost",
      "limit.yaml-no-anchors",
      "limit.json-no-nan",
    ]);
    expect(conversionLimits("csv", "toml")).toEqual([
      "limit.csv-text-only",
      "limit.toml-root-table",
      "limit.toml-no-null",
    ]);
    for (const from of DATA_FORMATS) {
      for (const to of DATA_FORMATS) {
        for (const limit of conversionLimits(from, to)) {
          expect(CONVERSION_LIMIT_CODES, `${from}->${to}`).toContain(limit);
        }
      }
    }
  });
});

describe("the error-code table", () => {
  it("lists every code once", () => {
    expect(new Set(STRUCTURED_ERROR_CODES).size).toBe(STRUCTURED_ERROR_CODES.length);
  });

  it("prefixes every code with the format or stage it belongs to", () => {
    const prefixes = new Set(["json", "path", "toml", "csv", "convert"]);
    for (const code of STRUCTURED_ERROR_CODES) {
      expect(prefixes.has(code.split(".")[0] ?? ""), code).toBe(true);
    }
  });

  it("lists every conversion-limit code once", () => {
    expect(new Set(CONVERSION_LIMIT_CODES).size).toBe(CONVERSION_LIMIT_CODES.length);
  });
});

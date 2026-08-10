import { describe, expect, it } from "vitest";

import {
  YAML_ERROR_CODES,
  parseYaml,
  parseYamlValue,
  serializeYaml,
  serializeYamlDocuments,
  validateYaml,
} from "./structuredYaml.js";

/** The single document this text holds, or a thrown assertion — every value test wants exactly this. */
function one(text: string): unknown {
  const result = parseYamlValue(text);
  if (!result.ok) throw new Error(`expected a document, got ${result.error.code}`);
  return result.value;
}

/** The refusal this text produces, or a thrown assertion. */
function refusal(text: string): { code: string; line: number; column: number; offset: number } {
  const result = parseYaml(text);
  if (result.ok) throw new Error("expected a refusal");
  const { code, line, column, offset } = result.error;
  return { code, line, column, offset };
}

describe("block mappings and sequences", () => {
  it("reads a flat mapping", () => {
    expect(one("name: Luka\nage: 30\n")).toEqual({ name: "Luka", age: 30 });
  });

  it("reads a nested mapping by indentation", () => {
    expect(one("a:\n  b:\n    c: 1\n")).toEqual({ a: { b: { c: 1 } } });
  });

  it("reads a sequence indented under its key", () => {
    expect(one("tasks:\n  - a\n  - b\n")).toEqual({ tasks: ["a", "b"] });
  });

  it("reads a sequence at the SAME indent as its key, which is what hand-written YAML uses", () => {
    expect(one("tasks:\n- a\n- b\nnext: 1\n")).toEqual({ tasks: ["a", "b"], next: 1 });
  });

  it("reads the compact form where a mapping starts on the dash line", () => {
    expect(one("- name: a\n  age: 1\n- name: b\n  age: 2\n")).toEqual([
      { name: "a", age: 1 },
      { name: "b", age: 2 },
    ]);
  });

  it("reads a sequence of sequences written with an empty dash line", () => {
    expect(one("-\n  - 1\n  - 2\n-\n  - 3\n")).toEqual([[1, 2], [3]]);
  });

  it("gives a dash with nothing after it the value null", () => {
    expect(one("- 1\n-\n- 3\n")).toEqual([1, null, 3]);
  });

  it("gives a key with nothing after it the value null", () => {
    expect(one("a:\nb: 1\n")).toEqual({ a: null, b: 1 });
  });

  it("reads a bare scalar document, and an empty file as one null document", () => {
    expect(one("hello\n")).toBe("hello");
    expect(one("")).toBeNull();
  });
});

describe("YAML 1.2 core type resolution", () => {
  it("resolves the null, boolean, integer and float spellings the core schema lists", () => {
    expect(one("a: null\nb: ~\nc: Null\nd: NULL\n")).toEqual({
      a: null,
      b: null,
      c: null,
      d: null,
    });
    expect(one("a: true\nb: True\nc: TRUE\nd: false\ne: False\n")).toEqual({
      a: true,
      b: true,
      c: true,
      d: false,
      e: false,
    });
    // 0x1f is 31 and 0o17 is 15 — worked out by hand, not read off the parser.
    expect(one("a: 42\nb: -7\nc: +3\nd: 0x1f\ne: 0o17\n")).toEqual({
      a: 42,
      b: -7,
      c: 3,
      d: 31,
      e: 15,
    });
    expect(one("a: 1.5\nb: -0.25\nc: 1e3\nd: .5\n")).toEqual({ a: 1.5, b: -0.25, c: 1000, d: 0.5 });
  });

  it("resolves the infinities and the not-a-number, which JavaScript spells differently", () => {
    const value = one("a: .inf\nb: -.inf\nc: .nan\n") as Record<string, number>;
    expect(value.a).toBe(Number.POSITIVE_INFINITY);
    expect(value.b).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(value.c ?? 0)).toBe(true);
  });

  /**
   * The Norway problem, asserted as ABSENT. YAML 1.1 resolved `no`/`off`/`yes`
   * to booleans and the country code NO became `false`; the 1.2 core schema this
   * parser implements does not, and that has to be a test rather than a comment.
   */
  it("leaves yes, no, on and off as the strings they are in YAML 1.2 core", () => {
    expect(one("country: NO\na: yes\nb: off\nc: on\n")).toEqual({
      country: "NO",
      a: "yes",
      b: "off",
      c: "on",
    });
  });

  it("never resolves a quoted scalar — a quoted 1 is the string 1", () => {
    expect(one('a: "1"\nb: \'true\'\nc: "null"\n')).toEqual({ a: "1", b: "true", c: "null" });
  });

  /**
   * The leading zero, which the core schema's own int pattern would swallow: a
   * postal code `007` resolved to the integer 7 cannot be written back, because
   * the zeros are no longer anywhere in the value. This is the trap the CSV
   * reader in `structured.ts` refuses to walk into, asserted here for YAML.
   */
  it("keeps a leading zero as text, since a postal code is not the integer seven", () => {
    // The forms that are still numbers are asserted beside it: a single zero,
    // a fraction that opens with one, and a signed zero all stay numeric.
    expect(one("zip: 007\nphone: 0755123\nzero: 0\nhalf: 0.5\ncount: 42\nsigned: -0\n")).toEqual({
      zip: "007",
      phone: "0755123",
      zero: 0,
      half: 0.5,
      count: 42,
      signed: -0,
    });
    // And it survives the round trip QUOTED, because every other YAML 1.2
    // reader does resolve an unquoted 007 to an integer.
    expect(serializeYaml({ zip: "007" })).toBe('zip: "007"\n');
    expect(one(serializeYaml({ zip: "007" }))).toEqual({ zip: "007" });
  });
});

describe("quoted scalars", () => {
  it("reads the double-quoted escapes", () => {
    expect(one('a: "line\\nbreak"\n')).toEqual({ a: "line\nbreak" });
    expect(one('a: "tab\\there"\n')).toEqual({ a: "tab\there" });
    expect(one('a: "quote\\"inside"\n')).toEqual({ a: 'quote"inside' });
    // \u0041 is LATIN CAPITAL LETTER A (Unicode).
    expect(one('a: "\\u0041"\n')).toEqual({ a: "A" });
    expect(one('a: "\\x41"\n')).toEqual({ a: "A" });
  });

  it("reads a single-quoted scalar, where the only escape is a doubled apostrophe", () => {
    expect(one("a: 'it''s'\n")).toEqual({ a: "it's" });
    expect(one("a: 'back\\slash'\n")).toEqual({ a: "back\\slash" });
  });

  it("takes a quoted key as a key", () => {
    expect(one('"a b": 1\n')).toEqual({ "a b": 1 });
  });
});

describe("comments", () => {
  it("drops a comment at the start of a line and after a value", () => {
    expect(one("# leading\na: 1 # trailing\nb: 2\n")).toEqual({ a: 1, b: 2 });
  });

  it("keeps a hash that is not preceded by whitespace, because it is part of the scalar", () => {
    expect(one("a: red#tamno\n")).toEqual({ a: "red#tamno" });
  });

  it("keeps a hash inside quotes", () => {
    expect(one('a: "x # y"\n')).toEqual({ a: "x # y" });
  });
});

describe("block scalars", () => {
  it("keeps every break in a literal block and clips to one trailing newline", () => {
    expect(one("t: |\n  line1\n  line2\n")).toEqual({ t: "line1\nline2\n" });
  });

  it("strips the trailing newline with |- and keeps every one with |+", () => {
    expect(one("t: |-\n  line1\n  line2\n")).toEqual({ t: "line1\nline2" });
    expect(one("t: |+\n  line1\n\n")).toEqual({ t: "line1\n\n" });
  });

  it("honours an explicit indentation indicator, so leading spaces survive", () => {
    expect(one("t: |2\n    indented\n")).toEqual({ t: "  indented\n" });
  });

  /**
   * The folded example is the specification's own (YAML 1.2 §8.1.3): a single
   * break between ordinary lines folds to a space, a blank line becomes one
   * newline.
   */
  it("folds ordinary breaks to spaces and blank lines to newlines", () => {
    expect(one("t: >\n  folded\n  line\n\n  next\n")).toEqual({ t: "folded line\nnext\n" });
  });

  it("keeps the breaks around a MORE-indented line, which is how a folded block holds a sample", () => {
    expect(one("t: >\n  a\n   b\n  c\n")).toEqual({ t: "a\n b\nc\n" });
  });

  it("takes a block scalar as a sequence item, clipped like any other", () => {
    expect(one("- |\n  x\n  y\n")).toEqual(["x\ny\n"]);
    expect(one("- |-\n  x\n  y\n")).toEqual(["x\ny"]);
  });

  /**
   * The under-indented continuation. Slicing every line by the block's
   * indentation without asking whether it HAS that much whitespace ate the first
   * character of the line — „ world" came back „orld" — which is a silent edit of
   * the user's text and exactly the failure mode this parser refuses elsewhere.
   */
  it("refuses a continuation line that does not carry the block's indentation", () => {
    // "a: |\n" is 5 characters and "  hello\n" is 8, so " world" starts at 13
    // and its „w" — where the caret belongs — is at 14, line 3, column 2.
    expect(refusal("a: |\n  hello\n world\nb: 2\n")).toEqual({
      code: "yaml.bad-indent",
      line: 3,
      column: 2,
      offset: 14,
    });
  });

  it("keeps a hash inside a block scalar, where it is content rather than a comment", () => {
    expect(one("t: |\n  # not a comment\n")).toEqual({ t: "# not a comment\n" });
  });
});

describe("flow, to exactly one level", () => {
  it("reads a flow sequence and a flow mapping", () => {
    expect(one("a: [1, 2, three]\n")).toEqual({ a: [1, 2, "three"] });
    expect(one("a: {x: 1, y: two}\n")).toEqual({ a: { x: 1, y: "two" } });
  });

  it("reads the empty flow collections", () => {
    expect(one("a: []\nb: {}\n")).toEqual({ a: [], b: {} });
  });

  it("does not end a flow VALUE at a colon, so a URL survives", () => {
    expect(one("a: [https://example.com/x]\n")).toEqual({ a: ["https://example.com/x"] });
  });

  /**
   * A key is the text that was written, in either style. Resolving a flow key
   * and stringifying the result turned `True` into „true" and `007` into „7",
   * so the same file said two different things depending on which style the
   * author happened to use — and could report a duplicate that is not one.
   */
  it("gives a flow key and a block key with the same text the same key", () => {
    expect(one("a: {True: 1, 007: 2, 1: 3}\n")).toEqual({ a: { True: 1, "007": 2, "1": 3 } });
    expect(one("True: 1\n007: 2\n1: 3\n")).toEqual({ True: 1, "007": 2, "1": 3 });
    // Two keys that differ in the file are two keys: resolving them first made
    // `true` and `True` collide as one, and the file was refused for it.
    expect(one("a: {true: 1, True: 2}\n")).toEqual({ a: { true: 1, True: 2 } });
    // A quoted flow key still decodes, exactly as a quoted block key does.
    expect(one('a: {"x y": 1}\n')).toEqual({ a: { "x y": 1 } });
  });

  it("refuses an anchor, an alias and a tag in a flow key, as it does in a block key", () => {
    expect(refusal("a: {&x: 1}\n").code).toBe("yaml.anchor");
    expect(refusal("a: {*x: 1}\n").code).toBe("yaml.alias");
    expect(refusal("a: {!!str x: 1}\n").code).toBe("yaml.tag");
  });
});

describe("documents", () => {
  it("splits a stream on ---", () => {
    const result = parseYaml("---\na: 1\n---\nb: 2\n");
    expect(result.ok && result.value).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("treats a stream with no marker as one document", () => {
    const result = parseYaml("a: 1\nb: 2\n");
    expect(result.ok && result.value.length).toBe(1);
  });

  it("reads a scalar written on the --- line itself", () => {
    const result = parseYaml("--- hello\n---\na: 1\n");
    expect(result.ok && result.value).toEqual(["hello", { a: 1 }]);
  });

  it("refuses to call a two-document stream one value", () => {
    const single = parseYamlValue("a: 1\n---\nb: 2\n");
    expect(single.ok).toBe(false);
    expect(!single.ok && single.error.code).toBe("convert.yaml-multiple-documents");
  });
});

describe("what this subset refuses, by name and by position", () => {
  it("refuses an anchor at the & that opens it", () => {
    // "a: &anchor 1" — a=0, :=1, space=2, &=3, so column 4.
    expect(refusal("a: &anchor 1\n")).toEqual({
      code: "yaml.anchor",
      line: 1,
      column: 4,
      offset: 3,
    });
  });

  it("refuses an alias at the * that opens it", () => {
    expect(refusal("a: *anchor\n")).toEqual({ code: "yaml.alias", line: 1, column: 4, offset: 3 });
  });

  it("refuses an explicit tag at the !", () => {
    expect(refusal("a: !!str 1\n")).toEqual({ code: "yaml.tag", line: 1, column: 4, offset: 3 });
  });

  it("refuses a complex key at the ?", () => {
    expect(refusal("? a\n: b\n")).toEqual({
      code: "yaml.complex-key",
      line: 1,
      column: 1,
      offset: 0,
    });
  });

  it("refuses flow nested inside flow, at the INNER bracket", () => {
    // "a: [[1]]" — the outer [ is at 3 and the inner one at 4, so column 5.
    expect(refusal("a: [[1]]\n")).toEqual({
      code: "yaml.nested-flow",
      line: 1,
      column: 5,
      offset: 4,
    });
  });

  it("refuses a tab in indentation, where the file looks right and nests wrong", () => {
    // "a:\n\tb: 1" — a=0, :=1, \n=2, tab=3 → line 2, column 1.
    expect(refusal("a:\n\tb: 1\n")).toEqual({
      code: "yaml.tab-indent",
      line: 2,
      column: 1,
      offset: 3,
    });
  });

  it("refuses a duplicate key at the second one", () => {
    // Two five-character lines precede it, so the third key sits at offset 10.
    expect(refusal("a: 1\nb: 2\na: 3\n")).toEqual({
      code: "yaml.duplicate-key",
      line: 3,
      column: 1,
      offset: 10,
    });
  });

  it("refuses a multi-line plain scalar rather than folding a mis-indented block into a string", () => {
    // "a: hello\n" is nine characters; "  world" then starts at 9 and its
    // content at 11 → line 2, column 3.
    expect(refusal("a: hello\n  world\n")).toEqual({
      code: "yaml.multiline-plain-scalar",
      line: 2,
      column: 3,
      offset: 11,
    });
  });

  it("refuses a directive", () => {
    expect(refusal("%YAML 1.2\n---\na: 1\n").code).toBe("yaml.directive");
  });

  it("refuses an unterminated quote and an unknown escape", () => {
    expect(refusal('a: "open\n').code).toBe("yaml.unterminated-quote");
    expect(refusal('a: "\\q"\n').code).toBe("yaml.bad-escape");
  });

  it("refuses an unterminated flow collection", () => {
    expect(refusal("a: [1, 2\n").code).toBe("yaml.unterminated-flow");
  });

  it("refuses a line indented into no structure at all", () => {
    expect(refusal("a: 1\n  b: 2\n").code).toBe("yaml.multiline-plain-scalar");
  });

  it("never throws for user input, whatever the shape", () => {
    const nasty = [
      "",
      ":",
      "-",
      "---",
      "a:\n  - \n",
      '"',
      "'",
      "|",
      ">",
      "{",
      "[",
      "a: {",
      "\t",
      "a: |9\n x\n",
      "a: |q\n x\n",
      "? ",
      "%",
      "a: 'x",
      "a:\n\t- 1\n",
      "- - - 1\n",
    ];
    for (const text of nasty) {
      expect(() => parseYaml(text), JSON.stringify(text)).not.toThrow();
    }
  });
});

describe("serializing", () => {
  it("writes a mapping and a sequence in the indented form", () => {
    expect(serializeYaml({ a: 1, b: ["x", "y"] })).toBe("a: 1\nb:\n  - x\n  - y\n");
  });

  it("writes a sequence of mappings in the compact form", () => {
    expect(serializeYaml([{ a: 1 }, { a: 2 }])).toBe("- a: 1\n- a: 2\n");
  });

  it("writes empty collections inline, since a bare key would read as null", () => {
    expect(serializeYaml({ a: [], b: {} })).toBe("a: []\nb: {}\n");
  });

  it("quotes any string that would otherwise read back as something else", () => {
    expect(serializeYaml({ a: "true", b: "1", c: "null", d: "", e: "~" })).toBe(
      'a: "true"\nb: "1"\nc: "null"\nd: ""\ne: "~"\n',
    );
  });

  it("writes the infinities and the not-a-number in YAML's spelling, not JavaScript's", () => {
    expect(serializeYaml([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN])).toBe(
      "- .inf\n- -.inf\n- .nan\n",
    );
  });

  it("sorts keys on request, in Serbian Latin order", () => {
    // Š sorts after S and BEFORE T in sr-Latn; by code point it would land
    // after Z, which is the ordering bug this collator exists to avoid.
    expect(serializeYaml({ Zadatak: 1, Šifra: 2, Sat: 3 }, { sortKeys: true })).toBe(
      "Sat: 3\nŠifra: 2\nZadatak: 1\n",
    );
  });

  it("writes a stream, each document opened by its own marker", () => {
    expect(serializeYamlDocuments([{ a: 1 }, { b: 2 }])).toBe("---\na: 1\n---\nb: 2\n");
  });
});

describe("the round trip", () => {
  const samples: readonly unknown[] = [
    null,
    true,
    42,
    -0.25,
    "plain",
    "true",
    "",
    "with: colon",
    "trailing ",
    [],
    {},
    [1, "two", null, false],
    { a: 1, b: { c: [1, 2, { d: "x" }] } },
    [{ name: "a", tags: ["x", "y"] }, { name: "b", tags: [] }],
  ];

  it("parses back exactly what it wrote, for every sample", () => {
    for (const sample of samples) {
      const text = serializeYaml(sample as never);
      expect(one(text), text).toEqual(sample);
    }
  });

  it("writes the same text again from what it parsed", () => {
    for (const sample of samples) {
      const first = serializeYaml(sample as never);
      const second = serializeYaml(one(first) as never);
      expect(second).toBe(first);
    }
  });
});

describe("the error-code table", () => {
  it("lists every code once, each prefixed with the format it belongs to", () => {
    expect(new Set(YAML_ERROR_CODES).size).toBe(YAML_ERROR_CODES.length);
    for (const code of YAML_ERROR_CODES) expect(code.startsWith("yaml."), code).toBe(true);
  });

  it("answers null from validateYaml when nothing is wrong", () => {
    expect(validateYaml("a: 1\n")).toBeNull();
    expect(validateYaml("a: &x 1\n")?.code).toBe("yaml.anchor");
  });
});

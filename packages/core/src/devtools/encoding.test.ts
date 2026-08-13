import { describe, expect, it } from "vitest";

import {
  base64ToBytes,
  base64ToText,
  binaryBytesToBytes,
  binaryBytesToText,
  bytesToBase64,
  codePointLabel,
  decimalCodePointsToText,
  generalCategory,
  hexBytesToBytes,
  hexBytesToText,
  hexdump,
  HTML_ENTITY_REFERENCE,
  htmlEscape,
  htmlUnescape,
  inspectCodePoints,
  inspectText,
  normalisations,
  parseHexdump,
  parseUrl,
  punycodeToUnicode,
  textToBase64,
  textViews,
  urlDecode,
  urlEncode,
  utf8ToText,
  type Base64Alphabet,
  type EncodingErrorCode,
  type EncodingResult,
} from "./encoding.js";

/**
 * A decimal numeric character reference, BUILT rather than written out.
 *
 * `check:colours` walks TypeScript string and template literals looking for CSS
 * hex colours, and `&#160;` contains the four-digit run `#160` that a `#rgba`
 * literal has. The gate is right to look there and this fixture is not a
 * colour, so the fixture moves rather than the gate — a suppression on a test
 * file is how a gate stops being believed. The static pieces of this template
 * are `&#` and `;`, neither of which can match.
 */
const decimalEntity = (codePoint: number): string => `&#${codePoint};`;

/** Unwraps a success, failing the test with the refusal code if there is one. */
function expectOk<T>(result: EncodingResult<T>): T {
  expect(result.ok ? null : result.code).toBeNull();
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

/** Asserts a refusal and returns it, so a test can also check the position. */
function expectFail<T>(result: EncodingResult<T>, code: EncodingErrorCode): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.code).toBe(code);
}

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe("base64", () => {
  // RFC 4648 §10 — the published test vectors, transcribed. Nothing in this
  // block was produced by running the encoder.
  const RFC4648_VECTORS: readonly (readonly [string, string])[] = [
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
    ["fooba", "Zm9vYmE="],
    ["foobar", "Zm9vYmFy"],
  ];

  it("encodes RFC 4648 §10's vectors with the standard alphabet and padding", () => {
    for (const [plain, encoded] of RFC4648_VECTORS) {
      expect(textToBase64(plain)).toBe(encoded);
    }
  });

  it("decodes RFC 4648 §10's vectors, with and without their padding", () => {
    for (const [plain, encoded] of RFC4648_VECTORS) {
      expect(expectOk(base64ToText(encoded))).toBe(plain);
      expect(expectOk(base64ToText(encoded.replace(/=+$/, "")))).toBe(plain);
    }
  });

  // 0xFB 0xFF is 1111 1011 1111 1111. In six-bit groups, left-aligned and
  // zero-filled: 111110 (62), 111111 (63), 1111 + 00 = 111100 (60). Digit 62 is
  // `+` in the standard alphabet and `-` in the URL-safe one, 63 is `/` and `_`,
  // and 60 is `8` in both — so this is the shortest input that tells them apart.
  const ALPHABET_PROBE = bytes(0xfb, 0xff);

  it("writes digits 62 and 63 differently in the two alphabets", () => {
    expect(bytesToBase64(ALPHABET_PROBE, { alphabet: "standard" })).toBe("+/8=");
    expect(bytesToBase64(ALPHABET_PROBE, { alphabet: "url" })).toBe("-_8");
    expect(bytesToBase64(ALPHABET_PROBE, { alphabet: "standard", padded: false })).toBe("+/8");
    expect(bytesToBase64(ALPHABET_PROBE, { alphabet: "url", padded: true })).toBe("-_8=");
  });

  it("accepts either alphabet by default and refuses a string that mixes them", () => {
    expect(expectOk(base64ToBytes("+/8="))).toEqual(ALPHABET_PROBE);
    expect(expectOk(base64ToBytes("-_8"))).toEqual(ALPHABET_PROBE);
    expectFail(base64ToBytes("-/8"), "base64-mixed-alphabet");
  });

  it("holds the input to one alphabet when the caller names one", () => {
    expectFail(base64ToBytes("+/8=", { alphabet: "url" }), "not-base64");
    expectFail(base64ToBytes("-_8", { alphabet: "standard" }), "not-base64");
    expect(expectOk(base64ToBytes("-_8", { alphabet: "url" }))).toEqual(ALPHABET_PROBE);
  });

  it("refuses a non-canonical final group", () => {
    // `Z` is 25 (011001) and `h` is 33 (100001), so `Zh==` carries the byte
    // 01100110 (0x66) plus four leftover bits 0001. `Zg==` is the same byte with
    // the leftover bits zero, and is the only canonical spelling of it.
    expect(expectOk(base64ToBytes("Zg=="))).toEqual(bytes(0x66));
    expectFail(base64ToBytes("Zh=="), "base64-non-canonical");
    expectFail(base64ToBytes("Zh"), "base64-non-canonical");
  });

  it("refuses padding that does not match the length", () => {
    expectFail(base64ToBytes("Zm9v=="), "base64-padding");
    expectFail(base64ToBytes("Zg="), "base64-padding");
    expectFail(base64ToBytes("Zm=8="), "base64-padding");
    expectFail(base64ToBytes("===="), "base64-padding");
  });

  it("refuses a length no byte string can produce", () => {
    // Four digits carry three bytes; a remainder of one digit carries eight
    // bits of nothing, so 4n+1 is never an encoding of anything.
    expectFail(base64ToBytes("Zm9vY"), "not-base64");
  });

  it("refuses whitespace unless the caller says the input is MIME-wrapped", () => {
    expect(base64ToBytes("Zm9v\nYmFy")).toEqual({ ok: false, code: "not-base64", at: 4 });
    expect(expectOk(base64ToText("Zm9v\nYmFy", { allowWhitespace: true }))).toBe("foobar");
    expect(expectOk(base64ToText("Zm9v YmFy", { allowWhitespace: true }))).toBe("foobar");
  });

  it("refuses a character outside both alphabets, at its position", () => {
    expect(base64ToBytes("Zm9*")).toEqual({ ok: false, code: "not-base64", at: 3 });
  });

  it("round-trips every byte length through all four variants", () => {
    const variants: readonly { alphabet: Base64Alphabet; padded: boolean }[] = [
      { alphabet: "standard", padded: true },
      { alphabet: "standard", padded: false },
      { alphabet: "url", padded: true },
      { alphabet: "url", padded: false },
    ];
    for (let length = 0; length <= 16; length++) {
      // Deterministic, and it walks the whole byte range fast enough to reach
      // the 62/63 digits at every alignment.
      const sample = Uint8Array.from({ length }, (_unused, i) => (i * 37 + 11) & 0xff);
      for (const variant of variants) {
        const encoded = bytesToBase64(sample, variant);
        expect(expectOk(base64ToBytes(encoded, { alphabet: variant.alphabet }))).toEqual(sample);
      }
    }
  });

  it("refuses bytes that are not UTF-8 when text was asked for", () => {
    // 0xFF is not a legal UTF-8 lead byte in any position.
    expectFail(base64ToText("/w=="), "not-utf8");
    expect(expectOk(base64ToBytes("/w=="))).toEqual(bytes(0xff));
  });
});

describe("url-encode", () => {
  // One string containing exactly the characters the three escapings disagree
  // about: a space, and then `+ / ? = & #`.
  const MIXED = "a b+c/d?e=f&g#h";

  it("escapes a component, a whole URI and a form field differently", () => {
    expect(expectOk(urlEncode(MIXED, "component"))).toBe("a%20b%2Bc%2Fd%3Fe%3Df%26g%23h");
    expect(expectOk(urlEncode(MIXED, "uri"))).toBe("a%20b+c/d?e=f&g#h");
    expect(expectOk(urlEncode(MIXED, "form"))).toBe("a+b%2Bc%2Fd%3Fe%3Df%26g%23h");
  });

  it("keeps encodeURIComponent's RFC 2396 sub-delimiters while the form serializer does not", () => {
    // ECMA-262 leaves `!'()*` alone; the WHATWG urlencoded serializer's safe set
    // is alphanumerics plus `*-._`, so only the asterisk survives there.
    expect(expectOk(urlEncode("!'()*", "component"))).toBe("!'()*");
    expect(expectOk(urlEncode("!'()*", "form"))).toBe("%21%27%28%29*");
  });

  it("encodes non-ASCII as its UTF-8 bytes", () => {
    // U+010D is 0000 1_0000 1101; the two-byte form carries 11 bits as
    // 110xxxxx 10xxxxxx, giving 0xC4 0x8D.
    expect(expectOk(urlEncode("č", "component"))).toBe("%C4%8D");
    expect(expectOk(urlEncode("č", "form"))).toBe("%C4%8D");
    expect(expectOk(urlDecode("%C4%8D", "component"))).toBe("č");
  });

  it("decodes a form field's plus as a space and its %2B as a plus", () => {
    expect(expectOk(urlDecode("a+b%2Bc", "form"))).toBe("a b+c");
  });

  it("leaves decodeURI's reserved escapes alone, as decodeURI does", () => {
    expect(expectOk(urlDecode("a%2Fb", "uri"))).toBe("a%2Fb");
    expect(expectOk(urlDecode("a%2fb", "uri"))).toBe("a%2fb");
    expect(expectOk(urlDecode("a%2Fb", "component"))).toBe("a/b");
  });

  it("refuses a malformed percent escape instead of throwing URIError", () => {
    expect(urlDecode("%E4%", "component")).toEqual({ ok: false, code: "percent-escape", at: 3 });
    expect(urlDecode("%zz", "component")).toEqual({ ok: false, code: "percent-escape", at: 0 });
  });

  it("tells a malformed escape apart from escapes that are not UTF-8", () => {
    expectFail(urlDecode("%FF", "component"), "not-utf8");
    expectFail(urlDecode("%C4", "component"), "not-utf8");
  });

  it("refuses an unpaired surrogate rather than emitting U+FFFD or throwing", () => {
    expect(urlEncode("a\ud800b", "component")).toEqual({
      ok: false,
      code: "lone-surrogate",
      at: 1,
    });
    expectFail(urlEncode("a\ud800b", "form"), "lone-surrogate");
  });

  it("round-trips through all three escapings", () => {
    const sample = "Zdravo, svete! Šta ima? čćžšđ 100% + 1/2 = 0,5 @ime";
    for (const escaping of ["component", "uri", "form"] as const) {
      const encoded = expectOk(urlEncode(sample, escaping));
      expect(expectOk(urlDecode(encoded, escaping))).toBe(sample);
    }
  });

  it("agrees with decodeURI on well-formed input", () => {
    const sample = "https://primer.rs/put?a=1&b=2#x";
    expect(expectOk(urlDecode(encodeURI(sample), "uri"))).toBe(decodeURI(encodeURI(sample)));
  });
});

describe("url-parse", () => {
  it("splits every part out", () => {
    const parsed = parseUrl("https://ana:tajna@sub.example.com:8443/put/do/fajla?q=a&q=b&r=c#odeljak");
    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    expect(parsed.scheme).toBe("https");
    expect(parsed.username).toBe("ana");
    expect(parsed.password).toBe("tajna");
    expect(parsed.host).toBe("sub.example.com");
    expect(parsed.port).toBe("8443");
    expect(parsed.path).toBe("/put/do/fajla");
    expect(parsed.fragment).toBe("odeljak");
    expect(parsed.isIdn).toBe(false);
  });

  it("keeps a repeated query key instead of collapsing it", () => {
    const parsed = parseUrl("https://example.com/?tag=a&tag=b&x=1");
    expect(parsed?.query).toEqual([
      { key: "tag", value: "a" },
      { key: "tag", value: "b" },
      { key: "x", value: "1" },
    ]);
  });

  it("reports a default port as absent", () => {
    expect(parseUrl("https://example.com:443/")?.port).toBe("");
    expect(parseUrl("https://example.com:8443/")?.port).toBe("8443");
  });

  it("gives an internationalised host in both spellings", () => {
    const parsed = parseUrl("https://bücher.example/knjige");
    expect(parsed?.isIdn).toBe(true);
    expect(parsed?.host).toBe("xn--bcher-kva.example");
    expect(parsed?.hostUnicode).toBe("bücher.example");
  });

  it("refuses a string that is not a URL", () => {
    expect(parseUrl("example.com/a")).toBeNull();
    expect(parseUrl("")).toBeNull();
    expect(parseUrl("   ")).toBeNull();
  });

  // Both expansions were worked through by hand from RFC 3492 §6.2 before this
  // decoder existed. `xn--bcher-kva`: the extended part `kva` decodes to a delta
  // of 745 (10·1 + 21·35, then `a` < t so the digit loop stops), adapt(745, 6,
  // first) gives bias 0, n becomes 128 + ⌊745/6⌋ = 252 = U+00FC, inserted at
  // 745 mod 6 = 1 → b·ü·cher. `xn--maana-pta`: delta 680 (15·1 + 19·35),
  // n = 128 + ⌊680/6⌋ = 241 = U+00F1, at 680 mod 6 = 2 → ma·ñ·ana.
  it("decodes punycode labels", () => {
    expect(punycodeToUnicode("xn--bcher-kva")).toBe("bücher");
    expect(punycodeToUnicode("xn--maana-pta")).toBe("mañana");
  });

  it("returns a label that is already Unicode unchanged", () => {
    expect(punycodeToUnicode("example")).toBe("example");
    expect(punycodeToUnicode("bücher")).toBe("bücher");
  });

  it("refuses an ACE label that is not valid punycode", () => {
    expect(punycodeToUnicode("xn--!!!")).toBeNull();
    expect(punycodeToUnicode("xn--bcher-kv$")).toBeNull();
  });
});

describe("ascii / binary / hex views", () => {
  it("groups bytes by character rather than by a flat run", () => {
    const views = textViews("A😀");
    expect(views.perCharacter).toHaveLength(2);
    expect(views.perCharacter[0]).toEqual({
      character: "A",
      codePoint: 65,
      bytes: [0x41],
      hex: "41",
      binary: "01000001",
    });
    // U+1F600 needs 21 bits: 000 011111 011000 000000, laid into
    // 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx.
    expect(views.perCharacter[1]).toEqual({
      character: "😀",
      codePoint: 128512,
      bytes: [0xf0, 0x9f, 0x98, 0x80],
      hex: "F0 9F 98 80",
      binary: "11110000 10011111 10011000 10000000",
    });
  });

  it("gives the four flat views of a two-byte character", () => {
    expect(textViews("č")).toMatchObject({
      decimal: "269",
      hex: "C4 8D",
      binary: "11000100 10001101",
      characters: "č",
    });
  });

  it("reports an unpaired surrogate as a character with no UTF-8 encoding", () => {
    const views = textViews("\ud800");
    expect(views.perCharacter).toHaveLength(1);
    expect(views.perCharacter[0]?.bytes).toEqual([]);
    expect(views.hex).toBe("");
  });

  it("reads hex back, in either spacing", () => {
    expect(expectOk(hexBytesToText("C4 8D"))).toBe("č");
    expect(expectOk(hexBytesToText("c48d"))).toBe("č");
    expect(expectOk(hexBytesToBytes("48,65,6c"))).toEqual(bytes(0x48, 0x65, 0x6c));
  });

  it("refuses a hex token that lost a nibble instead of regluing the pieces", () => {
    expectFail(hexBytesToBytes("C 48 D"), "not-a-hex-byte-list");
    expectFail(hexBytesToBytes("C4 8"), "not-a-hex-byte-list");
    expectFail(hexBytesToBytes("C4 8Z"), "not-a-hex-byte-list");
  });

  it("refuses hex whose bytes are not UTF-8", () => {
    expectFail(hexBytesToText("FF"), "not-utf8");
  });

  it("reads binary back and refuses a partial byte", () => {
    expect(expectOk(binaryBytesToText("11000100 10001101"))).toBe("č");
    expect(expectOk(binaryBytesToBytes("0100000101000010"))).toEqual(bytes(0x41, 0x42));
    expectFail(binaryBytesToBytes("1100010"), "not-a-binary-byte-list");
    expectFail(binaryBytesToBytes("11000102"), "not-a-binary-byte-list");
  });

  it("reads decimal code points back and refuses ones that are not characters", () => {
    expect(expectOk(decimalCodePointsToText("269 65 128512"))).toBe("čA😀");
    // 0xD800 = 55296 is a surrogate; 0x110000 = 1114112 is past the last plane.
    expectFail(decimalCodePointsToText("55296"), "code-point-out-of-range");
    expectFail(decimalCodePointsToText("1114112"), "code-point-out-of-range");
    expectFail(decimalCodePointsToText("6f"), "not-a-code-point-list");
  });

  it("round-trips text through each view", () => {
    const sample = "Ćao, svete! 😀 čćžšđ";
    const views = textViews(sample);
    expect(expectOk(hexBytesToText(views.hex))).toBe(sample);
    expect(expectOk(binaryBytesToText(views.binary))).toBe(sample);
    expect(expectOk(decimalCodePointsToText(views.decimal))).toBe(sample);
  });
});

describe("unicode inspector", () => {
  it("labels a code point with at least four hex digits", () => {
    expect(codePointLabel(0x41)).toBe("U+0041");
    expect(codePointLabel(0x10d)).toBe("U+010D");
    expect(codePointLabel(0x1f600)).toBe("U+1F600");
  });

  it("iterates by code point, so a surrogate pair is one entry", () => {
    const inspected = inspectCodePoints("😀");
    expect(inspected).toHaveLength(1);
    // U+1F600 − 0x10000 = 0xF600; high = 0xD800 + (0xF600 >> 10) = 0xD83D,
    // low = 0xDC00 + (0xF600 & 0x3FF) = 0xDC00 + 0x200 = 0xDE00.
    expect(inspected[0]).toEqual({
      codePoint: 128512,
      label: "U+1F600",
      character: "😀",
      utf8: [0xf0, 0x9f, 0x98, 0x80],
      utf16: [0xd83d, 0xde00],
      isSurrogatePair: true,
      category: "So",
    });
  });

  it("reads the general category off the engine's Unicode table", () => {
    expect(generalCategory(0x41)).toBe("Lu");
    expect(generalCategory(0x61)).toBe("Ll");
    expect(generalCategory(0x35)).toBe("Nd");
    expect(generalCategory(0x20)).toBe("Zs");
    expect(generalCategory(0x0a)).toBe("Cc");
    expect(generalCategory(0x2d)).toBe("Pd");
    expect(generalCategory(0x2e)).toBe("Po");
    expect(generalCategory(0x2b)).toBe("Sm");
    expect(generalCategory(0x24)).toBe("Sc");
    expect(generalCategory(0x10d)).toBe("Ll");
    expect(generalCategory(0xd800)).toBe("Cs");
  });

  it("reports an unpaired surrogate honestly", () => {
    const inspected = inspectCodePoints("\ud800");
    expect(inspected[0]?.codePoint).toBe(0xd800);
    expect(inspected[0]?.utf8).toEqual([]);
    expect(inspected[0]?.isSurrogatePair).toBe(false);
    expect(inspected[0]?.category).toBe("Cs");
  });

  it("says which normalisations change the string", () => {
    // "c" + U+030C COMBINING CARON is the NFD spelling of U+010D.
    const decomposed = normalisations("č");
    expect(decomposed).toEqual([
      { form: "NFC", value: "č", changed: true, codePoints: 1 },
      { form: "NFD", value: "č", changed: false, codePoints: 2 },
      { form: "NFKC", value: "č", changed: true, codePoints: 1 },
      { form: "NFKD", value: "č", changed: false, codePoints: 2 },
    ]);
  });

  it("separates canonical from compatibility normalisation", () => {
    // U+FB01 LATIN SMALL LIGATURE FI has no canonical decomposition and a
    // compatibility one, so only the K forms move.
    const ligature = normalisations("ﬁ");
    expect(ligature.map((report) => report.changed)).toEqual([false, false, true, true]);
    expect(ligature[2]?.value).toBe("fi");
  });

  it("counts the four different lengths of one string", () => {
    // "c" is one byte; U+030C is 0x30C = 0b011_0000_1100, so its two-byte form
    // is 0xCC 0x8C. One grapheme, two code points, two UTF-16 units, three bytes.
    expect(inspectText("č")).toMatchObject({
      codePointCount: 2,
      utf16Length: 2,
      utf8ByteCount: 3,
      graphemeCount: 1,
    });
    expect(inspectText("😀")).toMatchObject({
      codePointCount: 1,
      utf16Length: 2,
      utf8ByteCount: 4,
      graphemeCount: 1,
    });
  });
});

describe("html entities", () => {
  it("escapes the five that change how markup parses, and nothing else", () => {
    expect(htmlEscape(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#x27;s&lt;/a&gt;",
    );
    expect(htmlEscape("čćžšđ 😀")).toBe("čćžšđ 😀");
  });

  it("escapes every non-ASCII code point in aggressive mode, one per character", () => {
    expect(htmlEscape("čć😀", "aggressive")).toBe("&#x10D;&#x107;&#x1F600;");
  });

  it("unescapes named, decimal and hex references", () => {
    expect(expectOk(htmlUnescape("&amp;lt;"))).toBe("&lt;");
    expect(expectOk(htmlUnescape("&Alpha;&omega;"))).toBe("Αω");
    expect(expectOk(htmlUnescape("&euro;"))).toBe("€");
    expect(expectOk(htmlUnescape(decimalEntity(269)))).toBe("č");
    expect(expectOk(htmlUnescape("&#x10D;"))).toBe("č");
    expect(expectOk(htmlUnescape("&#x1F600;"))).toBe("😀");
  });

  it("pins both ends and the middle of the Latin-1 run", () => {
    // The HTML 4.01 Latin-1 set names U+00A0…U+00FF in order, 96 entries with
    // no gaps; an off-by-one in that list would shift all 96, so the ends are
    // what the test holds down.
    expect(expectOk(htmlUnescape("&nbsp;"))).toBe("\u00a0");
    expect(expectOk(htmlUnescape("&frac12;"))).toBe("½");
    expect(expectOk(htmlUnescape("&times;"))).toBe("×");
    expect(expectOk(htmlUnescape("&divide;"))).toBe("÷");
    expect(expectOk(htmlUnescape("&yuml;"))).toBe("ÿ");
  });

  it("uses HTML5's angle brackets for lang and rang, not HTML 4's CJK pair", () => {
    expect(expectOk(htmlUnescape("&lang;&rang;"))).toBe("⟨⟩");
  });

  it("ships a reference table large enough to be useful, sorted for display", () => {
    expect(HTML_ENTITY_REFERENCE.length).toBeGreaterThanOrEqual(250);
    expect(HTML_ENTITY_REFERENCE.find((entry) => entry.name === "nbsp")?.codePoint).toBe(0x00a0);
    const names = HTML_ENTITY_REFERENCE.map((entry) => entry.name);
    expect([...names].sort((a, b) => new Intl.Collator(["sr-Latn", "sr"]).compare(a, b))).toEqual(
      names,
    );
  });

  it("refuses a bare ampersand at its position instead of passing it through", () => {
    expect(htmlUnescape("a & b")).toEqual({ ok: false, code: "entity-unterminated", at: 2 });
    expect(htmlUnescape("&;")).toEqual({ ok: false, code: "entity-unterminated", at: 0 });
  });

  it("refuses an unknown name rather than guessing at a prefix of it", () => {
    // `&not` IS an HTML5 legacy reference without its semicolon; this module
    // ships no unterminated forms, so `&notreal;` is one unknown name and never
    // `¬` followed by the text `real;`.
    expect(htmlUnescape("&notreal;")).toEqual({ ok: false, code: "entity-unknown", at: 0 });
  });

  it("refuses a numeric reference that is not a Unicode scalar", () => {
    expectFail(htmlUnescape("&#xD800;"), "entity-out-of-range");
    expectFail(htmlUnescape("&#x110000;"), "entity-out-of-range");
    expectFail(htmlUnescape(decimalEntity(1114112)), "entity-out-of-range");
  });

  it("reports what the document says rather than what a browser would render", () => {
    // The HTML5 tokeniser maps &#128; to U+20AC through a windows-1252 legacy
    // rule. This module does not: the two code points stay distinguishable.
    expect(expectOk(htmlUnescape(decimalEntity(128)))).toBe("");
    expect(expectOk(htmlUnescape(decimalEntity(8364)))).toBe("€");
  });

  it("round-trips through both escape modes", () => {
    const sample = `<p class="a">Ana & Đorđe — 5 < 6 😀</p>`;
    for (const mode of ["minimal", "aggressive"] as const) {
      expect(expectOk(htmlUnescape(htmlEscape(sample, mode)))).toBe(sample);
    }
  });
});

describe("hexdump", () => {
  // "Hello, world!\n" — 14 bytes: 48 65 6c 6c 6f 2c 20 77 6f 72 6c 64 21 0a.
  const HELLO = bytes(0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x2c, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x21, 0x0a);

  // Laid out by hand: 8 offset digits + ": " is 10 columns; each group of eight
  // bytes is 8·3 − 1 = 23 columns, the two groups are separated by two spaces
  // and the gutter by two more. The second group holds six bytes (17 columns)
  // and is padded to 23, so six pad spaces plus the two separators put eight
  // spaces between `0a` and the pipe. 10 + 23 + 2 + 23 + 2 + 16 = 76.
  const HELLO_DUMP =
    "00000000: 48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21 0a        |Hello, world!.|";

  it("lays a line out in the canonical geometry", () => {
    expect(hexdump(HELLO)).toBe(HELLO_DUMP);
    expect(HELLO_DUMP).toHaveLength(76);
  });

  it("pads the hex field so the gutter opens in the same column on every line", () => {
    const seventeen = Uint8Array.from({ length: 17 }, (_unused, i) => i);
    const lines = hexdump(seventeen).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      "00000000: 00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f  |................|",
    );
    expect(lines[1]?.slice(0, 12)).toBe("00000010: 10");
    // The pipe sits at 10 + 23 + 2 + 23 + 2 = 60 whatever the line holds. The
    // GUTTER is not padded — it is exactly the bytes present, which is what
    // `xxd` and `hexdump -C` both do, so the last line is simply shorter.
    expect(lines[0]?.indexOf("|")).toBe(60);
    expect(lines[1]?.indexOf("|")).toBe(60);
    expect(lines[1]?.slice(60)).toBe("|.|");
    expect(lines[1]).toHaveLength(63);
  });

  it("dumps nothing for no bytes", () => {
    expect(hexdump(new Uint8Array(0))).toBe("");
    expect(expectOk(parseHexdump(""))).toEqual(new Uint8Array(0));
  });

  it("honours a configured width", () => {
    expect(hexdump(bytes(0x48, 0x65, 0x6c, 0x6c, 0x6f), { bytesPerLine: 4, bytesPerGroup: 4 })).toBe(
      ["00000000: 48 65 6c 6c  |Hell|", "00000004: 6f           |o|"].join("\n"),
    );
  });

  it("throws on a layout option only a caller could get wrong", () => {
    expect(() => hexdump(HELLO, { bytesPerLine: 0 })).toThrow(RangeError);
    expect(() => hexdump(HELLO, { bytesPerGroup: 1.5 })).toThrow(RangeError);
  });

  it("round-trips its own output, at any width", () => {
    const sample = Uint8Array.from({ length: 70 }, (_unused, i) => (i * 53 + 7) & 0xff);
    for (const width of [1, 4, 16, 32]) {
      expect(expectOk(parseHexdump(hexdump(sample, { bytesPerLine: width })))).toEqual(sample);
    }
  });

  it("reads xxd's two-byte grouping and hexdump -C's bare offsets", () => {
    expect(expectOk(parseHexdump("00000000: 4865 6c6c 6f2c 2077 6f72 6c64 210a"))).toEqual(HELLO);
    expect(
      expectOk(parseHexdump("00000000  48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21 0a")),
    ).toEqual(HELLO);
  });

  it("reads a continuous hex run with no offsets", () => {
    expect(expectOk(parseHexdump("48656c6c6f"))).toEqual(bytes(0x48, 0x65, 0x6c, 0x6c, 0x6f));
  });

  it("catches an offset that does not match the bytes read so far", () => {
    // Reading this line by line and guessing per line would silently accept it.
    expectFail(
      parseHexdump(["00000000: 48 65", "00000010: 6c 6c"].join("\n")),
      "hexdump-offset-mismatch",
    );
  });

  it("refuses hexdump -C's elision line rather than dropping the repeated run", () => {
    const elided = [
      "00000000: 00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |................|",
      "*",
      "00000020: 01",
    ].join("\n");
    expectFail(parseHexdump(elided), "not-a-hexdump");
  });

  it("refuses an undelimited ASCII gutter because it cannot be told from data", () => {
    expectFail(
      parseHexdump("00000000: 48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21 0a       Hello, world!."),
      "hexdump-ambiguous-gutter",
    );
  });

  it("refuses a corrupt hex token", () => {
    expectFail(parseHexdump("00000000: 48 6z"), "not-a-hexdump");
  });

  it("keeps a gutter that spells hex out of the data", () => {
    // `beef` in the gutter is four plausible nibbles; the pipes are what make
    // this decidable, which is why this module always writes them.
    const dump = hexdump(bytes(0x62, 0x65, 0x65, 0x66));
    expect(dump.endsWith("|beef|")).toBe(true);
    expect(expectOk(parseHexdump(dump))).toEqual(bytes(0x62, 0x65, 0x65, 0x66));
  });
});

describe("the shared UTF-8 seam", () => {
  it("refuses invalid UTF-8 instead of substituting U+FFFD", () => {
    expectFail(utf8ToText(bytes(0xff)), "not-utf8");
    // 0xC4 opens a two-byte sequence that never arrives.
    expectFail(utf8ToText(bytes(0xc4)), "not-utf8");
    // 0xED 0xA0 0x80 is the UTF-8 spelling of U+D800, which is not a scalar.
    expectFail(utf8ToText(bytes(0xed, 0xa0, 0x80)), "not-utf8");
    expect(expectOk(utf8ToText(bytes(0xc4, 0x8d)))).toBe("č");
  });
});

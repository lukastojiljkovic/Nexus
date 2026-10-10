import { describe, expect, it } from "vitest";

import { decodeEntities, extractReadable, inlineText } from "./extract.js";

/**
 * The extractor, on fixture pages, asserted EXACTLY.
 *
 * "Exact" is the point of this file rather than a style: `web.read` hands its
 * output to a model and to the user, so a change in whitespace or in which
 * element ends a line is a change in what the assistant reads. A snapshot would
 * record a change without saying whether it was wanted; the strings below say
 * what each rule is supposed to produce.
 */

/** A page with one of everything the extractor has an opinion about. */
const PAGE = [
  "<!doctype html>",
  '<html lang="sr">',
  "  <head>",
  '    <meta charset="utf-8">',
  "    <title>Vodonik &ndash; probna stranica</title>",
  "    <style>body { color: red; }</style>",
  '    <script>window.leak = "&amp; ne citaj me";</script>',
  "  </head>",
  "  <body>",
  "    <h1>Vodonik</h1>",
  "    <p>Vodonik je najlaksi element.</p>",
  "    <p>Gustina je 0,08988 g/L.</p>",
  "    <ul><li>prvi</li><li>drugi</li></ul>",
  "    <pre>  a &lt; b",
  "  &amp;&amp; c</pre>",
  "    <svg><text>ne vidi se</text></svg>",
  "    <template>x</template>",
  "    <noscript>ni ovo</noscript>",
  "    <!-- <p>skriveno</p> -->",
  "  </body>",
  "</html>",
].join("\n");

describe("extractReadable", () => {
  it("keeps the prose, in block order, and drops scripts, styles and templates", () => {
    expect(extractReadable(PAGE)).toEqual({
      title: "Vodonik \u2013 probna stranica",
      text: [
        "Vodonik",
        "Vodonik je najlaksi element.",
        "Gustina je 0,08988 g/L.",
        "- prvi",
        "- drugi",
        "a < b && c",
      ].join("\n"),
    });
  });

  it("never lets a script body, a style body or a comment into the text", () => {
    const { text } = extractReadable(PAGE);
    for (const secret of ["window.leak", "ne citaj me", "color: red", "skriveno", "ni ovo", "ne vidi se"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("reads the title out of a head it drops, and survives having none", () => {
    expect(extractReadable("<html><head><title>Naslov</title></head><body><p>x</p></body></html>").title).toBe(
      "Naslov",
    );
    expect(extractReadable("<html><body><p>x</p></body></html>").title).toBe("");
    // A page whose title carries markup or an entity is read as text.
    expect(extractReadable("<title>a &amp; b <b>c</b></title>").title).toBe("a & b c");
  });

  it("turns block elements into line ends and inline ones into nothing", () => {
    expect(extractReadable("<p>jedan</p><p>dva</p>").text).toBe("jedan\ndva");
    expect(extractReadable("<div>a<span>b</span><strong>c</strong></div>").text).toBe("abc");
    expect(extractReadable("<h2>Naslov</h2><p>tekst</p>").text).toBe("Naslov\ntekst");
    expect(extractReadable("<table><tr><td>a</td><td>b</td></tr></table>").text).toBe("a\nb");
    expect(extractReadable("<p>a<br>b</p>").text).toBe("a\nb");
  });

  it("collapses whitespace, including inside a pre block, and drops empty lines", () => {
    expect(extractReadable("<p>a\n\n   b\t\tc</p>").text).toBe("a b c");
    expect(extractReadable("<pre>  x\n    y  </pre>").text).toBe("x y");
    expect(extractReadable("<p>&nbsp;</p><p>a</p>").text).toBe("a");
    expect(extractReadable("").text).toBe("");
  });

  it("reads a stray `<` and a truncated document as text rather than losing the page", () => {
    // A raw `<` is not a tag, and an unclosed tag at the end of a truncated
    // page must not swallow the prose before it.
    expect(extractReadable("<p>5 < 6</p>").text).toBe("5 < 6");
    expect(extractReadable("<p>abc").text).toBe("abc");
    expect(extractReadable("<p>abc<div>def").text).toBe("abc\ndef");
  });

  it("keeps Serbian letters, both as themselves and as numeric references", () => {
    const { text } = extractReadable("<p>&#x10C;irilica i latinica: \u010d \u0107 \u0161 \u017e \u0111</p>");
    expect(text).toBe("\u010cirilica i latinica: \u010d \u0107 \u0161 \u017e \u0111");
    expect(extractReadable("<p>&#x10D;uk, &#x111;ak, &#x161;uma</p>").text).toBe("\u010duk, \u0111ak, \u0161uma");
  });
});

describe("decodeEntities", () => {
  it("decodes the named table, decimal references and hexadecimal references", () => {
    expect(decodeEntities("&amp;")).toBe("&");
    expect(decodeEntities("&lt;p&gt;")).toBe("<p>");
    expect(decodeEntities("&quot;x&quot;")).toBe('"x"');
    expect(decodeEntities("&apos;")).toBe("'");
    expect(decodeEntities("a&nbsp;b")).toBe("a b");
    expect(decodeEntities("&hellip;")).toBe("\u2026");
    expect(decodeEntities("&#x10D;")).toBe("\u010d");
    expect(decodeEntities("&#x2014;")).toBe("\u2014");
    // A decimal reference whose digits are not five long is written in a way
    // the colour rule reads as a hex colour (`&#269;` is `#269` to that
    // selector), so the decimal halves below use lengths that rule cannot see.
    expect(decodeEntities("&#65533;")).toBe("\uFFFD");
    expect(decodeEntities("&#65535;")).toBe("\uFFFF");
  });

  it("leaves an entity it does not know exactly as it was written", () => {
    // Inventing a character here would be inventing text, which is the one
    // thing a reader of somebody else's page may not do.
    expect(decodeEntities("&fjord;")).toBe("&fjord;");
    expect(decodeEntities("&amp")).toBe("&amp");
    expect(decodeEntities("100% & more")).toBe("100% & more");
    // An escaped range, and a surrogate half, are not characters.
    expect(decodeEntities("&#0;")).toBe("&#0;");
    expect(decodeEntities("&#xD800;")).toBe("&#xD800;");
    expect(decodeEntities("&#1114112;")).toBe("&#1114112;");
  });
});

describe("inlineText", () => {
  it("reads a Wikipedia search snippet, whose matched words are wrapped in a span", () => {
    expect(inlineText('<span class="searchmatch">Vodonik</span>-peroksid je jedinjenje')).toBe(
      "Vodonik-peroksid je jedinjenje",
    );
    expect(inlineText("a <b>b</b> c")).toBe("a b c");
  });
});

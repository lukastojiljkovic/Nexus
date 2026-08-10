import { describe, expect, it } from "vitest";

import {
  XML_ERROR_CODES,
  XML_VOID_ELEMENTS,
  type XmlDocument,
  type XmlElement,
  decodeXmlText,
  formatXml,
  minifyXml,
  parseXml,
  queryXPath,
  queryXmlText,
  validateXml,
  xmlTextContent,
} from "./structuredXml.js";

function document(text: string): XmlDocument {
  const result = parseXml(text);
  if (!result.ok) throw new Error(`expected a document, got ${result.error.code}`);
  return result.value;
}

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

/** The first top-level element of a document, or a thrown assertion. */
function root(text: string): XmlElement {
  const first = document(text).children.find((child) => child.kind === "element");
  if (first === undefined || first.kind !== "element") throw new Error("no root element");
  return first;
}

describe("parsing the tree", () => {
  it("reads an element, its attributes and its text", () => {
    const element = root('<root a="1" b=\'2\'>text</root>');
    expect(element.name).toBe("root");
    expect(element.attributes.map((attribute) => [attribute.name, attribute.value])).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
    expect(element.children).toEqual([{ kind: "text", raw: "text", value: "text" }]);
  });

  it("keeps a self-closing tag self-closing rather than rewriting it", () => {
    expect(root("<a/>").selfClosing).toBe(true);
    expect(root("<a></a>").selfClosing).toBe(false);
  });

  it("reads comments, CDATA, processing instructions and a doctype", () => {
    const nodes = document(
      "<?xml version='1.0'?><!DOCTYPE html><!-- c --><r><![CDATA[<not markup>]]></r>",
    ).children;
    expect(nodes.map((node) => node.kind)).toEqual([
      "instruction",
      "doctype",
      "comment",
      "element",
    ]);
    expect(root("<r><![CDATA[<not markup>]]></r>").children[0]).toEqual({
      kind: "cdata",
      text: "<not markup>",
    });
  });

  it("closes a void element without a closing tag, and still demands one for anything else", () => {
    const element = root("<p>a<br>b</p>");
    expect(element.children.map((child) => child.kind)).toEqual(["text", "element", "text"]);
    expect(refusal(parseXml("<p><span>a</p>")).code).toBe("xml.mismatched-close");
  });

  it("takes the body of a raw-text element as text, so a less-than inside script is not a tag", () => {
    const element = root("<script>if (a < b) { x(); }</script>");
    expect(element.children).toEqual([
      { kind: "text", raw: "if (a < b) { x(); }", value: "if (a < b) { x(); }" },
    ]);
  });

  /**
   * WHATWG's raw-text end state ends the element only when the tag name is
   * followed by whitespace, `/` or `>`. A bare substring search for `</script`
   * takes the prefix of a longer word as the close, and then refuses a document
   * that is perfectly well-formed.
   */
  it("ends a raw-text element at a real close tag, not at a longer word that starts like one", () => {
    const source = '<script>var s = "</scripted>"; done();</script>';
    const element = root(source);
    expect(element.children).toEqual([
      {
        kind: "text",
        raw: 'var s = "</scripted>"; done();',
        value: 'var s = "</scripted>"; done();',
      },
    ]);
    expect(minifyXml(source)).toEqual({ ok: true, value: source });
    // A space between the name and the `>` still closes it.
    expect(root("<style>a{}</style >").children).toEqual([
      { kind: "text", raw: "a{}", value: "a{}" },
    ]);
    // And at the end of the input there is no following character, so there is
    // no close either: the element is unclosed, reported at the tag that opened it.
    expect(refusal(parseXml("<script>x</script")).code).toBe("xml.unclosed-tag");
  });

  it("reads bare and unquoted attributes, which is the HTML this tool is pasted", () => {
    const element = root("<input disabled value=7>");
    expect(element.attributes).toEqual([
      { name: "disabled", value: "", raw: "", quote: "", hasValue: false },
      { name: "value", value: "7", raw: "7", quote: "", hasValue: true },
    ]);
  });

  it("accepts a fragment with several top-level elements, since that is what people paste", () => {
    expect(document("<a/><b/>").children.length).toBe(2);
  });
});

describe("entities", () => {
  it("decodes the five predefined entities and the numeric forms", () => {
    // &#65; and &#x41; are both LATIN CAPITAL LETTER A.
    expect(decodeXmlText("&lt;a&gt; &amp; &quot;q&quot; &apos;s&apos; &#65; &#x41;")).toBe(
      "<a> & \"q\" 's' A A",
    );
  });

  it("leaves an entity it does not know exactly as written", () => {
    expect(decodeXmlText("a&nbsp;b")).toBe("a&nbsp;b");
  });

  it("keeps the written form on the node so printing cannot corrupt it", () => {
    const element = root("<a>x&nbsp;y &lt;z&gt;</a>");
    const [text] = element.children;
    expect(text?.kind === "text" && text.raw).toBe("x&nbsp;y &lt;z&gt;");
    expect(text?.kind === "text" && text.value).toBe("x&nbsp;y <z>");
    // The round trip is the point: an unknown entity survives untouched.
    expect(minifyXml("<a>x&nbsp;y</a>")).toEqual({ ok: true, value: "<a>x&nbsp;y</a>" });
  });

  it("decodes an attribute value while keeping its raw text", () => {
    const [attribute] = root('<a t="&lt;x&gt;"/>').attributes;
    expect(attribute?.value).toBe("<x>");
    expect(attribute?.raw).toBe("&lt;x&gt;");
  });

  /**
   * Attribute-value normalization, XML 1.0 §3.3.3: a literal tab or break typed
   * inside the quotes is a single space in the value the application compares
   * against; a character REFERENCE is exempt and stays the character it names.
   */
  it("normalizes literal whitespace inside a quoted attribute value, but not a reference", () => {
    const [broken] = root('<a b="x\ny"/>').attributes;
    expect(broken?.value).toBe("x y");
    // The lexeme is untouched, so the document still prints byte for byte.
    expect(broken?.raw).toBe("x\ny");
    expect(minifyXml('<a b="x\ny"/>')).toEqual({ ok: true, value: '<a b="x\ny"/>' });

    const [tabbed] = root('<a b="x\ty"/>').attributes;
    expect(tabbed?.value).toBe("x y");
    // A CRLF is ONE line break (§2.11) and therefore one space, not two.
    const [crlf] = root('<a b="x\r\ny"/>').attributes;
    expect(crlf?.value).toBe("x y");
    // `&#10;` is the only way to put a real break in a value, so it survives.
    const [referenced] = root('<a b="x&#10;y"/>').attributes;
    expect(referenced?.value).toBe("x\ny");

    // Which matters because the decoded value is what a predicate compares.
    const query = queryXmlText('<r><a b="x\ny"/></r>', "//a[@b='x y']");
    expect(query.ok && query.value.length).toBe(1);
  });
});

describe("well-formedness, with a position", () => {
  it("points at the closing tag that names the wrong element", () => {
    // '<a><b></a>' — the </a> opens at offset 6.
    expect(refusal(parseXml("<a><b></a>"))).toEqual({
      code: "xml.mismatched-close",
      line: 1,
      column: 7,
      offset: 6,
    });
  });

  it("points at the tag that was opened and never closed", () => {
    expect(refusal(parseXml("<a><b></b>"))).toEqual({
      code: "xml.unclosed-tag",
      line: 1,
      column: 1,
      offset: 0,
    });
  });

  it("points at a closing tag that closes nothing", () => {
    expect(refusal(parseXml("</a>"))).toEqual({
      code: "xml.stray-close",
      line: 1,
      column: 1,
      offset: 0,
    });
  });

  it("points at the second of two attributes with the same name", () => {
    // '<a x="1" x="2"/>' — the second x sits at offset 9.
    expect(refusal(parseXml('<a x="1" x="2"/>'))).toEqual({
      code: "xml.duplicate-attribute",
      line: 1,
      column: 10,
      offset: 9,
    });
  });

  it("treats a differently-cased attribute as a different attribute, as XML defines it", () => {
    expect(validateXml('<a x="1" X="2"/>')).toBeNull();
  });

  it("points at a bare less-than in text rather than inventing a tag for it", () => {
    // '<a>x < y</a>' — the loose < is at offset 5.
    expect(refusal(parseXml("<a>x < y</a>"))).toEqual({
      code: "xml.unexpected-char",
      line: 1,
      column: 6,
      offset: 5,
    });
  });

  it("points at the start of an unterminated comment, CDATA or instruction", () => {
    expect(refusal(parseXml("<!-- x"))).toEqual({
      code: "xml.unterminated-comment",
      line: 1,
      column: 1,
      offset: 0,
    });
    expect(refusal(parseXml("<![CDATA[x")).code).toBe("xml.unterminated-cdata");
    expect(refusal(parseXml("<?pi x")).code).toBe("xml.unterminated-instruction");
  });

  it("points at the quote of an attribute value that never closes", () => {
    // '<a x="1/>' — the opening quote is at offset 5.
    expect(refusal(parseXml('<a x="1/>'))).toEqual({
      code: "xml.unterminated-attribute",
      line: 1,
      column: 6,
      offset: 5,
    });
  });

  it("counts lines, so a fault on line 3 is reported on line 3", () => {
    // Each of the first two lines is three characters plus its break, so the
    // mismatched close on line 3 starts at offset 8.
    expect(refusal(parseXml("<a>\n<b>\n</a>\n"))).toEqual({
      code: "xml.mismatched-close",
      line: 3,
      column: 1,
      offset: 8,
    });
  });

  it("never throws for user input, whatever the shape", () => {
    for (const text of ["", "<", "</", "<a", "<a ", "<a=", "<>", "<!", "<?", "<a></b>", "&", "<1>"]) {
      expect(() => parseXml(text), JSON.stringify(text)).not.toThrow();
    }
  });
});

describe("printing", () => {
  it("indents element structure and keeps a text-only element on one line", () => {
    expect(formatXml("<root><a>1</a><b><c/></b></root>")).toEqual({
      ok: true,
      value: "<root>\n  <a>1</a>\n  <b>\n    <c/>\n  </b>\n</root>",
    });
  });

  it("takes the indent it is given", () => {
    expect(formatXml("<a><b/></a>", { indent: 4 })).toEqual({
      ok: true,
      value: "<a>\n    <b/>\n</a>",
    });
    expect(formatXml("<a><b/></a>", { indent: "tab" })).toEqual({
      ok: true,
      value: "<a>\n\t<b/>\n</a>",
    });
  });

  it("leaves mixed content on one line, because re-indenting it would move words apart", () => {
    expect(formatXml("<p>a <b>x</b> c</p>")).toEqual({ ok: true, value: "<p>a <b>x</b> c</p>" });
  });

  it("copies a whitespace-significant element byte for byte", () => {
    expect(formatXml("<div><pre>  keep\n  me</pre></div>")).toEqual({
      ok: true,
      value: "<div>\n  <pre>  keep\n  me</pre>\n</div>",
    });
  });

  it("removes only the whitespace between tags when minifying", () => {
    expect(minifyXml("<root>\n  <a>1</a>\n  <b/>\n</root>")).toEqual({
      ok: true,
      value: "<root><a>1</a><b/></root>",
    });
  });

  it("keeps comments and text when minifying — a minifier that deletes content is a different tool", () => {
    expect(minifyXml("<a>\n  <!-- note -->\n  <b> spaced </b>\n</a>")).toEqual({
      ok: true,
      value: "<a><!-- note --><b> spaced </b></a>",
    });
  });

  it("round-trips: minifying a formatted document gives the same text as minifying the source", () => {
    const samples = [
      "<root><a>1</a><b><c/></b></root>",
      "<?xml version='1.0'?><!DOCTYPE html><r><![CDATA[x]]></r>",
      "<p>a <b>x</b> c</p>",
      "<ul><li>a</li><li>b</li></ul>",
      "<a/><b/>",
      '<input disabled value=7>',
    ];
    for (const text of samples) {
      const formatted = formatXml(text);
      expect(formatted.ok, text).toBe(true);
      if (!formatted.ok) continue;
      expect(minifyXml(formatted.value), text).toEqual(minifyXml(text));
    }
  });

  it("reports the parse failure rather than printing half a document", () => {
    expect(refusal(formatXml("<a>")).code).toBe("xml.unclosed-tag");
    expect(refusal(minifyXml("<a>")).code).toBe("xml.unclosed-tag");
  });
});

describe("the XPath subset", () => {
  const source =
    '<root><item id="a">1</item><item id="b" flag>2</item>' +
    '<group><item id="c">3</item></group></root>';
  const tree = document(source);
  const ids = (path: string): readonly string[] => {
    const result = queryXPath(tree, path);
    if (!result.ok) throw new Error(`expected matches, got ${result.error.code}`);
    return result.value.map(
      (element) => element.attributes.find((attribute) => attribute.name === "id")?.value ?? "",
    );
  };

  it("walks an absolute path of element names", () => {
    expect(ids("/root/item")).toEqual(["a", "b"]);
    expect(ids("/root/group/item")).toEqual(["c"]);
  });

  it("finds a name at any depth with //", () => {
    expect(ids("//item")).toEqual(["a", "b", "c"]);
  });

  it("matches any element with *", () => {
    expect(ids("/root/*")).toEqual(["a", "b", ""]);
  });

  it("filters on an attribute's presence and on its value", () => {
    expect(ids("//item[@flag]")).toEqual(["b"]);
    expect(ids("//item[@id='b']")).toEqual(["b"]);
    expect(ids('//item[@id="c"]')).toEqual(["c"]);
    expect(ids("//item[@id='nema']")).toEqual([]);
  });

  it("indexes from 1, and PER PARENT rather than across the whole result", () => {
    expect(ids("/root/item[2]")).toEqual(["b"]);
    // Two parents hold an `item`, so `//item[1]` selects the first of each.
    expect(ids("//item[1]")).toEqual(["a", "c"]);
  });

  it("applies predicates left to right", () => {
    expect(ids("//item[@id='b'][1]")).toEqual(["b"]);
    expect(ids("//item[@id='b'][2]")).toEqual([]);
  });

  it("returns matches in document order even when the steps found them out of order", () => {
    const result = queryXPath(tree, "//item");
    expect(result.ok && result.value.map((element) => xmlTextContent(element))).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("refuses a relative path, at the first character", () => {
    expect(refusal(queryXPath(tree, "root/item"))).toEqual({
      code: "xpath.expected-absolute",
      line: 1,
      column: 1,
      offset: 0,
    });
  });

  it("names every construct outside the subset rather than matching nothing", () => {
    const cases: readonly { path: string; code: string; offset: number }[] = [
      { path: "/root/item[position()>1]", code: "xpath.unsupported", offset: 11 },
      { path: "/root/@id", code: "xpath.unsupported", offset: 6 },
      { path: "/root/../a", code: "xpath.unsupported", offset: 6 },
      { path: "/root/item[0]", code: "xpath.unsupported", offset: 11 },
      { path: "//", code: "xpath.expected-name", offset: 2 },
    ];
    for (const { path, code, offset } of cases) {
      const result = queryXPath(tree, path);
      expect(result.ok, path).toBe(false);
      if (result.ok) continue;
      expect(result.error.code, path).toBe(code);
      expect(result.error.offset, path).toBe(offset);
    }
  });

  it("runs against text in one step for a surface that only holds the source", () => {
    const result = queryXmlText(source, "//item[@id='a']");
    expect(result.ok && result.value.length).toBe(1);
    expect(refusal(queryXmlText("<a>", "//a")).code).toBe("xml.unclosed-tag");
  });
});

describe("text content", () => {
  it("joins the decoded text of a subtree and skips the markup", () => {
    expect(xmlTextContent(root("<a>x <b>y</b><!-- no --> z</a>"))).toBe("x y z");
    expect(xmlTextContent(root("<a><![CDATA[raw]]></a>"))).toBe("raw");
    expect(xmlTextContent(root("<a>&lt;e&gt;</a>"))).toBe("<e>");
  });
});

describe("the tables this module publishes", () => {
  it("lists every error code once, each prefixed with xml. or xpath.", () => {
    expect(new Set(XML_ERROR_CODES).size).toBe(XML_ERROR_CODES.length);
    for (const code of XML_ERROR_CODES) {
      expect(code.startsWith("xml.") || code.startsWith("xpath."), code).toBe(true);
    }
  });

  it("names the void elements HTML defines, and only those", () => {
    expect(XML_VOID_ELEMENTS.size).toBe(14);
    for (const name of ["br", "img", "input", "meta", "hr", "wbr"]) {
      expect(XML_VOID_ELEMENTS.has(name), name).toBe(true);
    }
    expect(XML_VOID_ELEMENTS.has("div")).toBe(false);
  });
});

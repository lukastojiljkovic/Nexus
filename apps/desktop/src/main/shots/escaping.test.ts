import { describe, expect, it } from "vitest";

import { jsLiteral, markdownCell } from "./index.js";

/**
 * The sweep's two escapes, both of them one line and both of them the kind that
 * looks correct while being wrong.
 *
 * `jsLiteral` carries a value into a script the renderer evaluates, where
 * `JSON.stringify` alone is a legal literal right up to the point where the
 * text is `</script>` or a U+2028 line separator. `markdownCell` carries a
 * value the renderer displayed into `report.md`'s table, where a pipe ends the
 * column and a backslash is what the escape for a pipe is written with.
 */
describe("jsLiteral", () => {
  it("removes every character that ends a script early", () => {
    const value = "</script><img src=x onerror=alert(1)>\u2028\u2029";
    const literal = jsLiteral(value);
    expect(literal).not.toMatch(/[<>\u2028\u2029]/);
    // JSON accepts `\u003c` and `\/`, so the escaped text still reads back as
    // exactly the string that went in.
    expect(JSON.parse(literal)).toBe(value);
  });

  it("escapes the slash, so a wrapping parser sees no terminator", () => {
    expect(jsLiteral("a/b")).toBe('"a\\/b"');
  });

  it("leaves the backslash and the quote exactly as JSON wrote them", () => {
    const value = 'C:\\Users\\a"quoted"\n';
    expect(JSON.parse(jsLiteral(value))).toBe(value);
  });

  it("changes nothing about a value that carries no hazard", () => {
    expect(jsLiteral("nexus.theme")).toBe('"nexus.theme"');
    expect(jsLiteral(7)).toBe("7");
  });
});

describe("markdownCell", () => {
  it("escapes the pipe that would end the column", () => {
    expect(markdownCell("a | b")).toBe("a \\| b");
  });

  it("escapes the backslash FIRST, so the escape itself cannot be escaped", () => {
    // Without the first replace this came out as `C:\\temp`, whose `\\` is a
    // literal backslash and whose pipe then ended the row early.
    expect(markdownCell("C:\\temp | x")).toBe("C:\\\\temp \\| x");
  });

  it("leaves a text with neither character exactly as it was", () => {
    expect(markdownCell("overlaps \"Dodaj\"")).toBe("overlaps \"Dodaj\"");
  });
});

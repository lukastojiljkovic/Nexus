import { describe, expect, it } from "vitest";
import { toCsv } from "./csv.js";

describe("toCsv", () => {
  it("renders a header row followed by one CRLF-terminated row per record", () => {
    const csv = toCsv(["id", "title"], [["t1", "Prvi zadatak"]]);
    expect(csv).toBe("id,title\r\nt1,Prvi zadatak\r\n");
  });

  it("renders only the header, CRLF-terminated, when there are no rows", () => {
    expect(toCsv(["id", "title"], [])).toBe("id,title\r\n");
  });

  it("quotes a field containing a comma", () => {
    expect(toCsv(["a"], [["one,two"]])).toBe('a\r\n"one,two"\r\n');
  });

  it("quotes a field containing a double quote and doubles the embedded quote", () => {
    expect(toCsv(["a"], [['say "hi"']])).toBe('a\r\n"say ""hi"""\r\n');
  });

  it("quotes a field containing an embedded newline", () => {
    expect(toCsv(["a"], [["line1\nline2"]])).toBe('a\r\n"line1\nline2"\r\n');
  });

  it("quotes a field containing an embedded carriage return", () => {
    expect(toCsv(["a"], [["line1\rline2"]])).toBe('a\r\n"line1\rline2"\r\n');
  });

  it("leaves a plain field unquoted", () => {
    expect(toCsv(["a"], [["plain"]])).toBe("a\r\nplain\r\n");
  });

  it("renders null and undefined as an empty field", () => {
    expect(toCsv(["a", "b"], [[null, undefined]])).toBe("a,b\r\n,\r\n");
  });

  it("renders numbers verbatim and booleans as true/false", () => {
    expect(toCsv(["n", "b1", "b2"], [[42, true, false]])).toBe("n,b1,b2\r\n42,true,false\r\n");
  });

  it("quotes a header field that itself needs quoting", () => {
    expect(toCsv(["a,b"], [["x"]])).toBe('"a,b"\r\nx\r\n');
  });

  it("renders multiple rows in the given order", () => {
    expect(
      toCsv(
        ["id"],
        [["1"], ["2"], ["3"]],
      ),
    ).toBe("id\r\n1\r\n2\r\n3\r\n");
  });
});

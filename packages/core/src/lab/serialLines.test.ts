import { describe, expect, it } from "vitest";

import { splitSerialChunk, toHexView } from "./serialLines.js";

/**
 * The carry is the whole point of this module, so every case below is about what
 * happens ACROSS a chunk boundary rather than inside one chunk: a read of a
 * serial port is whatever the driver had ready, and a `\r\n` split between two
 * reads is the normal case.
 */
describe("splitSerialChunk", () => {
  it("splits CRLF lines and carries nothing when the chunk ended them", () => {
    const chunk = "temp,humidity,pressure\r\n23.5,41,1009\r\n";
    expect(splitSerialChunk("", chunk, "crlf")).toEqual({
      lines: ["temp,humidity,pressure", "23.5,41,1009"],
      carry: "",
    });
  });

  it("holds a partial line in the carry", () => {
    expect(splitSerialChunk("", "23.5,4", "crlf")).toEqual({ lines: [], carry: "23.5,4" });
    expect(splitSerialChunk("23.5,4", "1,1009\r\n", "crlf")).toEqual({
      lines: ["23.5,41,1009"],
      carry: "",
    });
  });

  it("holds a lone trailing CR, because the LF of the same ending may be the next read", () => {
    expect(splitSerialChunk("", "line one\r", "crlf")).toEqual({ lines: [], carry: "line one\r" });
    expect(splitSerialChunk("line one\r", "\nline two\r\n", "crlf")).toEqual({
      lines: ["line one", "line two"],
      carry: "",
    });
  });

  it("splits a bare LF and a bare CR as well, whichever ending was chosen", () => {
    expect(splitSerialChunk("", "a\nb\n", "crlf")).toEqual({ lines: ["a", "b"], carry: "" });
    expect(splitSerialChunk("", "a\rb\r", "lf")).toEqual({ lines: ["a", "b"], carry: "" });
  });

  it("keeps everything in the carry when the device sends no line ending at all", () => {
    expect(splitSerialChunk("", "23.5,41,1009", "none")).toEqual({
      lines: [],
      carry: "23.5,41,1009",
    });
    expect(splitSerialChunk("23.5", ",41", "none")).toEqual({
      lines: [],
      carry: "23.5,41",
    });
  });

  it("keeps an empty line that a device really sent", () => {
    // `"a\r\n\r\nb\r\n"` is three lines, the middle one empty — a blank line in
    // a terminal is a fact about the stream, not a parser artefact.
    expect(splitSerialChunk("", "a\r\n\r\nb\r\n", "crlf")).toEqual({
      lines: ["a", "", "b"],
      carry: "",
    });
  });
});

describe("toHexView", () => {
  it("draws one row of sixteen bytes with an offset and a printable column", () => {
    // `48 69 21 0a` is "Hi!\n"; the hex column is padded to 47 characters (16
    // bytes of three characters less the last space), which is the 36 below.
    expect(toHexView("Hi!\n")).toEqual([`000000  48 69 21 0a${" ".repeat(36)}  Hi!·`]);
  });

  it("shows a byte it cannot print as a dot beside its real value", () => {
    expect(toHexView("\u0001\u0002")).toEqual([`000000  01 02${" ".repeat(42)}  ··`]);
  });

  it("shows a Serbian letter as the two UTF-8 bytes it really is", () => {
    // `č` is U+010D and encodes to c4 8d: two bytes, neither printable in ASCII.
    // This is the case a hex view exists for — a device sending UTF-8 under a
    // different code page shows up here rather than as a mystery in the text.
    expect(toHexView("č")).toEqual([`000000  c4 8d${" ".repeat(42)}  ··`]);
  });

  it("keeps a long log to its tail, and says so by the offset it starts at", () => {
    const sixteen = Array.from({ length: 16 }, () => "78").join(" ");
    expect(toHexView("x".repeat(32), 16)).toEqual([`000010  ${sixteen}  ${"x".repeat(16)}`]);
  });
});

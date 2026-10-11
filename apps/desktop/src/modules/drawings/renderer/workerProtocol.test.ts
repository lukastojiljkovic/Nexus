import { describe, expect, it } from "vitest";
import {
  bytesMessage,
  DRAWING_URL,
  FONT_URL,
  readBytesMessage,
} from "./workerProtocol.js";

/**
 * The page-to-worker envelope, on the one property that keeps it apart from the
 * library's own protocol.
 *
 * `dxf-viewer`'s worker client posts `{signature, seq, type, data}` and its
 * worker logs anything else it is handed; ours are posted to the same worker, so
 * "our messages never reach the library's parser, and its messages are never
 * mistaken for ours" is a rule with a test rather than a hope.
 */

describe("bytesMessage", () => {
  it("carries the URL and the bytes under one property the library never writes", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(bytesMessage(DRAWING_URL, bytes)).toEqual({ nxDrawing: { url: DRAWING_URL, bytes } });
    // Two private URLs, not one: the drawing and the font are answered from the
    // same store, and a single name would have them overwrite each other.
    expect(DRAWING_URL).not.toBe(FONT_URL);
  });
});

describe("readBytesMessage", () => {
  it("round-trips what bytesMessage wrote", () => {
    const bytes = new Uint8Array([0x30, 0x0a, 0xff]);
    expect(readBytesMessage(bytesMessage(FONT_URL, bytes))).toEqual({ url: FONT_URL, bytes });
  });

  it("refuses the library's own envelopes, whatever they carry", () => {
    const library = {
      signature: "DxfWorkerMsg",
      seq: 1,
      type: "LOAD",
      data: { url: "what://ever", fonts: null, options: {} },
    };
    expect(readBytesMessage(library)).toBeNull();
    expect(readBytesMessage({ signature: "DxfWorkerMsg", seq: 2, type: "PROGRESS" })).toBeNull();
  });

  it("refuses a malformed envelope rather than trusting half of it", () => {
    expect(readBytesMessage(null)).toBeNull();
    expect(readBytesMessage("nxDrawing")).toBeNull();
    expect(readBytesMessage([])).toBeNull();
    // The URL must be a non-empty string, and the payload a real typed array.
    expect(readBytesMessage({ nxDrawing: { url: "", bytes: new Uint8Array(1) } })).toBeNull();
    expect(readBytesMessage({ nxDrawing: { bytes: new Uint8Array(1) } })).toBeNull();
    expect(readBytesMessage({ nxDrawing: { url: DRAWING_URL } })).toBeNull();
    expect(readBytesMessage({ nxDrawing: { url: DRAWING_URL, bytes: [1, 2] } })).toBeNull();
  });
});

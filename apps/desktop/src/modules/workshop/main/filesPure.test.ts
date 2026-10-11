import { describe, expect, it } from "vitest";
import {
  WORKSHOP_MAX_BATCH_BYTES,
  WORKSHOP_MAX_BATCH_FILES,
  WORKSHOP_MAX_FILE_BYTES,
  WORKSHOP_MAX_OUTPUT_BYTES,
} from "../shared/workshopFiles.js";
import {
  asBatchFiles,
  asBytes,
  asFileKind,
  asSuggestedName,
  numberedFileName,
  WORKSHOP_BATCH_LIMITS,
  WORKSHOP_NAME_MAX_LENGTH,
  type BatchLimits,
} from "./filesPure.js";

/**
 * The file handlers' pure half, against the exact rules `files.ts` relies on.
 *
 * The caps are driven SMALL (`LIMITS` below) so the batch total is reachable
 * without allocating 200 MB, and the real numbers are pinned separately: a test
 * that exercised the shipped caps would either be a memory test or prove
 * nothing about the boundary.
 */

const LIMITS: BatchLimits = { maxFiles: 3, maxFileBytes: 4, maxBytes: 8 };

/** `n` bytes, with distinguishable content so a validator cannot pass by length alone. */
function bytes(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_, index) => index & 0xff);
}

/** A validator pair shaped like the kit's `call.as`, so `asSuggestedName` is driven the way the handler drives it. */
const validators = {
  asString(value: unknown, field: string): string {
    if (typeof value !== "string") throw new Error(`"${field}" must be a string`);
    return value;
  },
  asCappedChars(value: unknown, field: string, maxChars: number): string {
    const text = validators.asString(value, field);
    if (text.length > maxChars) throw new Error(`"${field}" must not exceed ${maxChars} characters`);
    return text;
  },
};

describe("the caps the handlers enforce", () => {
  it("are the numbers the UI states", () => {
    expect(WORKSHOP_MAX_FILE_BYTES).toBe(52_428_800);
    expect(WORKSHOP_MAX_BATCH_FILES).toBe(20);
    expect(WORKSHOP_MAX_BATCH_BYTES).toBe(209_715_200);
    expect(WORKSHOP_MAX_OUTPUT_BYTES).toBe(209_715_200);
    expect(WORKSHOP_NAME_MAX_LENGTH).toBe(200);
    expect(WORKSHOP_BATCH_LIMITS).toEqual({
      maxFiles: 20,
      maxFileBytes: 52_428_800,
      maxBytes: 209_715_200,
    });
  });
});

describe("asFileKind", () => {
  it("admits the two kinds and nothing else", () => {
    expect(asFileKind("pdf")).toBe("pdf");
    expect(asFileKind("image")).toBe("image");
    expect(asFileKind("PDF")).toBeNull();
    expect(asFileKind("")).toBeNull();
    expect(asFileKind(1)).toBeNull();
    expect(asFileKind(null)).toBeNull();
  });
});

describe("asBytes", () => {
  it("answers the array itself when it is one", () => {
    const payload = bytes(4);
    expect(asBytes(payload, "bytes", 4)).toBe(payload);
  });

  it("refuses an empty array, an over-cap array and anything that is not one", () => {
    expect(() => asBytes(new Uint8Array(0), "bytes", 4)).toThrow(/non-empty Uint8Array/);
    expect(() => asBytes(bytes(5), "bytes", 4)).toThrow(/must not exceed 4 bytes/);
    expect(() => asBytes({ byteLength: 4 }, "bytes", 4)).toThrow(/non-empty Uint8Array/);
    expect(() => asBytes(new ArrayBuffer(4), "bytes", 4)).toThrow(/non-empty Uint8Array/);
    expect(() => asBytes("bytes", "bytes", 4)).toThrow(/non-empty Uint8Array/);
  });
});

describe("asSuggestedName", () => {
  it("passes a name through and refuses one longer than the cap", () => {
    expect(asSuggestedName(validators, "ugovor.pdf")).toBe("ugovor.pdf");
    expect(() => asSuggestedName(validators, "x".repeat(WORKSHOP_NAME_MAX_LENGTH + 1))).toThrow(
      /must not exceed 200 characters/,
    );
    expect(() => asSuggestedName(validators, 7)).toThrow(/must be a string/);
  });
});

describe("numberedFileName", () => {
  it("leaves the first attempt alone and numbers the rest before the extension", () => {
    expect(numberedFileName("report.pdf", 1)).toBe("report.pdf");
    expect(numberedFileName("report.pdf", 2)).toBe("report (2).pdf");
    expect(numberedFileName("report.pdf", 10)).toBe("report (10).pdf");
  });

  it("numbers a name with no extension at its end", () => {
    expect(numberedFileName("notes", 2)).toBe("notes (2)");
    expect(numberedFileName("archive.tar.gz", 2)).toBe("archive.tar (2).gz");
  });

  it("truncates a long base so the number and the extension survive", () => {
    const long = `${"n".repeat(300)}.pdf`;
    const numbered = numberedFileName(long, 2);
    // 200 characters, ending in ` (2).pdf`: the two parts that decide whether the
    // name is a usable file name at all.
    expect(numbered).toHaveLength(WORKSHOP_NAME_MAX_LENGTH);
    expect(numbered.endsWith(" (2).pdf")).toBe(true);
  });

  it("refuses an attempt number that is not one or more", () => {
    expect(() => numberedFileName("a.pdf", 0)).toThrow(RangeError);
    expect(() => numberedFileName("a.pdf", 1.5)).toThrow(RangeError);
  });
});

describe("asBatchFiles", () => {
  it("answers the files of a batch that fits", () => {
    const files = [
      { name: "a.pdf", bytes: bytes(4) },
      { name: "b.pdf", bytes: bytes(4) },
    ];
    expect(asBatchFiles(files, LIMITS)).toEqual(files);
  });

  it("refuses a payload that is not a non-empty array", () => {
    expect(() => asBatchFiles({}, LIMITS)).toThrow(/must be an array/);
    expect(() => asBatchFiles([], LIMITS)).toThrow(/must not be empty/);
  });

  it("refuses more files than the batch may hold", () => {
    const four = Array.from({ length: 4 }, (_, index) => ({
      name: `f${index}.pdf`,
      bytes: bytes(1),
    }));
    expect(() => asBatchFiles(four, LIMITS)).toThrow(/more than 3 files/);
  });

  it("refuses an entry that is not a named file", () => {
    expect(() => asBatchFiles(["a.pdf"], LIMITS)).toThrow(/files\[0\]" must be an object/);
    expect(() => asBatchFiles([{ bytes: bytes(1) }], LIMITS)).toThrow(/files\[0\]\.name/);
    expect(() => asBatchFiles([{ name: "", bytes: bytes(1) }], LIMITS)).toThrow(/files\[0\]\.name/);
    expect(() => asBatchFiles([{ name: "a.pdf" }], LIMITS)).toThrow(/files\[0\]\.bytes/);
  });

  it("refuses a batch whose total is over the cap, even with every file within it", () => {
    const three = [
      { name: "a.pdf", bytes: bytes(4) },
      { name: "b.pdf", bytes: bytes(4) },
      { name: "c.pdf", bytes: bytes(1) },
    ];
    expect(() => asBatchFiles(three, LIMITS)).toThrow(/more than 8 bytes/);
  });
});

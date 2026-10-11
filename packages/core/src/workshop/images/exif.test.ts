import { describe, expect, it } from "vitest";
import { NO_EXIF_SUMMARY, readExifSummary } from "./exif.js";
import {
  EXIF_FIXTURE,
  EXIF_FIXTURE_BIG_ENDIAN,
  EXIF_FIXTURE_MODEL_ONLY,
  EXIF_FIXTURE_NO_GPS,
  EXIF_FIXTURE_VALUES,
  FIXTURE_WITHOUT_EXIF,
} from "./exifFixture.js";

/**
 * The EXIF reader against the fixture `exifFixture.ts` assembles.
 *
 * The oracle is `EXIF_FIXTURE_VALUES` — the tag values the fixture's own bytes
 * carry, written by the builder rather than by a camera — and the segment
 * layout is documented there with the spec sections each field comes from. A
 * test asserting "the camera is a string" would pass on a reader that returned
 * the first ASCII run it found; every expectation below is the value.
 */

const VALUES = EXIF_FIXTURE_VALUES;

describe("readExifSummary", () => {
  it("reads GPS, camera and the original date out of the fixture", () => {
    expect(readExifSummary(EXIF_FIXTURE)).toEqual({
      hasExif: true,
      hasGps: true,
      camera: `${VALUES.make} ${VALUES.model}`,
      dateTime: VALUES.dateTimeOriginal,
    });
  });

  it("prefers Exif's DateTimeOriginal over IFD0's DateTime", () => {
    // Both are in the fixture; the file's own date is `VALUES.dateTime`, and
    // the answer above is the one the camera wrote.
    expect(VALUES.dateTime).not.toBe(VALUES.dateTimeOriginal);
    expect(readExifSummary(EXIF_FIXTURE).dateTime).toBe(VALUES.dateTimeOriginal);
  });

  it("reports no GPS when the block has no GPSInfo pointer", () => {
    expect(readExifSummary(EXIF_FIXTURE_NO_GPS)).toEqual({
      hasExif: true,
      hasGps: false,
      camera: `${VALUES.make} ${VALUES.model}`,
      dateTime: VALUES.dateTimeOriginal,
    });
  });

  it("reads a big-endian (`MM`) block the same way", () => {
    expect(readExifSummary(EXIF_FIXTURE_BIG_ENDIAN)).toEqual(readExifSummary(EXIF_FIXTURE));
  });

  it("answers with the model alone when the block has no Make", () => {
    expect(readExifSummary(EXIF_FIXTURE_MODEL_ONLY).camera).toBe(VALUES.model);
  });

  it("finds nothing in a JPEG with no APP1 segment", () => {
    expect(readExifSummary(FIXTURE_WITHOUT_EXIF)).toEqual(NO_EXIF_SUMMARY);
  });

  it("finds nothing in bytes that are not a JPEG at all", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(readExifSummary(png)).toEqual(NO_EXIF_SUMMARY);
    expect(readExifSummary(new Uint8Array(0))).toEqual(NO_EXIF_SUMMARY);
    expect(readExifSummary(Uint8Array.from([0xff, 0xd8]))).toEqual(NO_EXIF_SUMMARY);
    expect(readExifSummary(Uint8Array.from("Exif\0\0".split("").map((c) => c.charCodeAt(0))))).toEqual(
      NO_EXIF_SUMMARY,
    );
  });

  it("finds nothing in a JPEG truncated inside its APP1 segment", () => {
    // Cut the fixture in the middle of the EXIF block: the segment's own length
    // says it is longer than the file, which is a block this reader refuses
    // rather than one it reads past the end of.
    const truncated = EXIF_FIXTURE.subarray(0, 20);
    expect(readExifSummary(truncated)).toEqual(NO_EXIF_SUMMARY);
  });

  it("finds nothing when the APP1 body is not a TIFF header", () => {
    const broken = Uint8Array.from(EXIF_FIXTURE);
    // TIFF magic 42 sits two bytes past the TIFF header, which starts at 12:
    // SOI (2) + marker and length (4) + `Exif\0\0` (6).
    broken[14] = 0;
    broken[15] = 41;
    expect(readExifSummary(broken)).toEqual(NO_EXIF_SUMMARY);
  });

  it("reports no GPS when the GPSInfo pointer is past the end of the block", () => {
    const broken = Uint8Array.from(EXIF_FIXTURE);
    // The TIFF block starts 12 bytes into the JPEG: SOI (2) + marker and
    // length (4) + `Exif\0\0` (6). Inside it, IFD0 begins at 8, its fifth entry
    // is the GPS pointer at 8 + 2 + 4 * 12 = 58, and that entry's four-byte
    // value field starts eight bytes into it — 12 + 58 + 8 = 78.
    broken[78] = 0xff;
    broken[79] = 0xff;
    broken[80] = 0xff;
    broken[81] = 0x7f;
    const summary = readExifSummary(broken);
    expect(summary.hasExif).toBe(true);
    expect(summary.hasGps).toBe(false);
    expect(summary.camera).toBe(`${VALUES.make} ${VALUES.model}`);
  });

  it("keeps the fixture a real JPEG: SOI first, EOI last", () => {
    // The image data is sharp's, spliced the way T.81 §B.2.4.6 allows: the
    // structural check is what says the fixture has not decayed into a
    // hand-rolled byte sequence that only this reader can read.
    expect([EXIF_FIXTURE[0], EXIF_FIXTURE[1]]).toEqual([0xff, 0xd8]);
    expect([
      EXIF_FIXTURE[EXIF_FIXTURE.length - 2],
      EXIF_FIXTURE[EXIF_FIXTURE.length - 1],
    ]).toEqual([0xff, 0xd9]);
  });
});

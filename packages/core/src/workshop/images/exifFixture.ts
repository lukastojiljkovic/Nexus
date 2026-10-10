import { base64ToBytes } from "../../bytes.js";

/**
 * The JPEG fixture `exif.test.ts` reads, assembled byte-for-byte in one place.
 *
 * **What produced it.** The image data is a 2×2 baseline JPEG written by
 * **sharp 0.35.5** (`sharp({ create: { width: 2, height: 2, … } }).jpeg({
 * quality: 60 })`; 268 bytes, and sharp's own `metadata()` reads it back as
 * `{ format: "jpeg", width: 2, height: 2 }`). Everything around it — the EXIF
 * APP1 segment, the TIFF header, both directories and their values — is written
 * here by hand, because a fixture whose metadata is produced by the same kind
 * of tool as the reader under test proves almost nothing: the tag values below
 * are the oracle, and they have to be typed somewhere a reader can check.
 *
 * **Why not commit a .jpg.** A binary fixture in the tree cannot be reviewed.
 * The builder states the segment layout in source, so "the GPS pointer is tag
 * 0x8825 pointing at an IFD that holds GPSVersionID 2.3.0.0" is a sentence
 * somebody can check against TIFF 6.0 §2 and EXIF 2.32, and the fixture is a
 * JPEG with real entropy-coded data rather than a hand-rolled byte soup.
 *
 * The splice is the standard one: a JPEG may carry any number of APP1 segments
 * between SOI and the frame header (ITU-T T.81 §B.2.4.6), so the EXIF segment
 * goes immediately after the SOI the base file opens with.
 */

/** The base image's bytes, produced by sharp 0.35.5 as described above. */
const BASELINE_JPEG_BASE64 =
  "/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxO" +
  "UlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09P" +
  "T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAACAAIDASIAAhEBAxEB/8QAFQAB" +
  "AQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAA" +
  "AAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAATb//2Q==";

/** The values every fixture below carries, so a test names the oracle once. */
export const EXIF_FIXTURE_VALUES = {
  make: "Nexus",
  model: "Test Camera 1",
  /** The date in IFD0's `DateTime` (0x0132). */
  dateTime: "2020:01:02 03:04:05",
  /** The date in the Exif sub-IFD's `DateTimeOriginal` (0x9003), which the reader prefers. */
  dateTimeOriginal: "2024:05:17 13:45:00",
} as const;

/** How one fixture's EXIF block is built. */
export interface ExifFixtureOptions {
  /** TIFF byte order: `II` (little-endian) or `MM` (big-endian). */
  readonly byteOrder?: "little" | "big";
  /** Whether the block carries a GPSInfo pointer and an IFD for it. */
  readonly gps?: boolean;
  /** Omit `Make` from IFD0, so the reader has to answer with `Model` alone. */
  readonly dropMake?: boolean;
}

const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_DATE_TIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_GPS_VERSION = 0x0000;

const TYPE_BYTE = 1;
const TYPE_ASCII = 2;
const TYPE_LONG = 4;

/** One value the block holds: ASCII text (NUL-terminated by the writer) or a LONG pointer resolved later. */
interface FixtureValue {
  readonly text: string;
}

/** The base JPEG's bytes, decoded once. */
export function baselineJpeg(): Uint8Array {
  return base64ToBytes(BASELINE_JPEG_BASE64);
}

/**
 * Assembles the TIFF block: header, IFD0, the Exif sub-IFD, an optional GPS
 * sub-IFD, and the strings every directory entry points at.
 *
 * The offsets are computed in the order the block is written, which is what
 * makes the layout checkable by hand: header (8) → IFD0 → Exif IFD → GPS IFD →
 * the string pool.
 */
function buildTiffBlock(options: ExifFixtureOptions): Uint8Array {
  const littleEndian = options.byteOrder !== "big";
  const values = EXIF_FIXTURE_VALUES;
  const make = `${values.make}\u0000`;
  const model = `${values.model}\u0000`;
  const dateTime = `${values.dateTime}\u0000`;
  const dateTimeOriginal = `${values.dateTimeOriginal}\u0000`;

  const ifd0Tags: readonly { tag: number; type: number; count: number; value: FixtureValue | null }[] =
    [
      ...(options.dropMake === true ? [] : [{ tag: TAG_MAKE, type: TYPE_ASCII, count: make.length, value: { text: make } }]),
      { tag: TAG_MODEL, type: TYPE_ASCII, count: model.length, value: { text: model } },
      { tag: TAG_DATE_TIME, type: TYPE_ASCII, count: dateTime.length, value: { text: dateTime } },
      // The two pointers: LONG(1) with the offset filled in below.
      { tag: TAG_EXIF_IFD, type: TYPE_LONG, count: 1, value: null },
      ...(options.gps === false ? [] : [{ tag: TAG_GPS_IFD, type: TYPE_LONG, count: 1, value: null }]),
    ];

  const ifd0Offset = 8;
  const ifd0Size = 2 + ifd0Tags.length * 12 + 4;
  const exifIfdOffset = ifd0Offset + ifd0Size;
  const exifIfdSize = 2 + 12 + 4;
  const gpsIfdOffset = exifIfdOffset + exifIfdSize;
  const gpsIfdSize = 2 + 12 + 4;
  const hasGpsIfd = options.gps !== false;
  let pool = hasGpsIfd ? gpsIfdOffset + gpsIfdSize : exifIfdOffset + exifIfdSize;

  const offsets = new Map<FixtureValue, number>();
  for (const entry of ifd0Tags) {
    if (entry.value !== null) {
      offsets.set(entry.value, pool);
      pool += entry.value.text.length;
    }
  }
  const originalValue: FixtureValue = { text: dateTimeOriginal };
  const originalOffset = pool;
  pool += originalValue.text.length;

  const total = pool;
  const block = new Uint8Array(total);
  const put16 = (at: number, value: number): void => {
    if (littleEndian) {
      block[at] = value & 0xff;
      block[at + 1] = (value >> 8) & 0xff;
    } else {
      block[at] = (value >> 8) & 0xff;
      block[at + 1] = value & 0xff;
    }
  };
  const put32 = (at: number, value: number): void => {
    if (littleEndian) {
      block[at] = value & 0xff;
      block[at + 1] = (value >> 8) & 0xff;
      block[at + 2] = (value >> 16) & 0xff;
      block[at + 3] = (value >> 24) & 0xff;
    } else {
      block[at] = (value >> 24) & 0xff;
      block[at + 1] = (value >> 16) & 0xff;
      block[at + 2] = (value >> 8) & 0xff;
      block[at + 3] = value & 0xff;
    }
  };
  const putText = (at: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      block[at + index] = text.charCodeAt(index) & 0xff;
    }
  };

  // TIFF header: byte order, magic 42, IFD0's offset.
  putText(0, littleEndian ? "II" : "MM");
  put16(2, 42);
  put32(4, ifd0Offset);

  // IFD0.
  put16(ifd0Offset, ifd0Tags.length);
  ifd0Tags.forEach((entry, index) => {
    const at = ifd0Offset + 2 + index * 12;
    put16(at, entry.tag);
    put16(at + 2, entry.type);
    put32(at + 4, entry.count);
    if (entry.value === null) {
      put32(at + 8, entry.tag === TAG_EXIF_IFD ? exifIfdOffset : gpsIfdOffset);
      return;
    }
    const offset = offsets.get(entry.value) ?? 0;
    // ASCII values longer than four bytes live in the pool; the four-byte
    // inline field is only for short ones, and every value here is longer.
    put32(at + 8, offset);
  });
  put32(ifd0Offset + 2 + ifd0Tags.length * 12, 0);

  // The Exif sub-IFD: one entry, DateTimeOriginal.
  put16(exifIfdOffset, 1);
  put16(exifIfdOffset + 2, TAG_DATE_TIME_ORIGINAL);
  put16(exifIfdOffset + 4, TYPE_ASCII);
  put32(exifIfdOffset + 6, originalValue.text.length);
  put32(exifIfdOffset + 10, originalOffset);
  put32(exifIfdOffset + 14, 0);

  // The GPS sub-IFD: GPSVersionID = 2.3.0.0, inline because it is four bytes.
  if (hasGpsIfd) {
    put16(gpsIfdOffset, 1);
    put16(gpsIfdOffset + 2, TAG_GPS_VERSION);
    put16(gpsIfdOffset + 4, TYPE_BYTE);
    put32(gpsIfdOffset + 6, 4);
    block[gpsIfdOffset + 10] = 2;
    block[gpsIfdOffset + 11] = 3;
    block[gpsIfdOffset + 12] = 0;
    block[gpsIfdOffset + 13] = 0;
    put32(gpsIfdOffset + 14, 0);
  }

  // The string pool, in the order the offsets were handed out above.
  for (const [value, offset] of offsets) putText(offset, value.text);
  putText(originalOffset, originalValue.text);
  return block;
}

/** One APP1 segment, `Exif\0\0` included, with its own two-byte length. */
function app1Segment(tiff: Uint8Array): Uint8Array {
  const bodyLength = 6 + tiff.length;
  const segment = new Uint8Array(4 + bodyLength);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = ((bodyLength + 2) >> 8) & 0xff;
  segment[3] = (bodyLength + 2) & 0xff;
  segment.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);
  segment.set(tiff, 10);
  return segment;
}

/**
 * A JPEG that is the sharp-written base image plus one EXIF segment spliced in
 * after its SOI marker.
 */
export function buildExifJpeg(options: ExifFixtureOptions = {}): Uint8Array {
  const base = baselineJpeg();
  const segment = app1Segment(buildTiffBlock(options));
  const jpeg = new Uint8Array(base.length + segment.length);
  jpeg.set(base.subarray(0, 2), 0);
  jpeg.set(segment, 2);
  jpeg.set(base.subarray(2), 2 + segment.length);
  return jpeg;
}

/** Little-endian, GPS and camera and both dates: the fixture the reader's test reads in full. */
export const EXIF_FIXTURE: Uint8Array = buildExifJpeg();

/** The same block with no GPSInfo pointer: the camera is there, the coordinates are not. */
export const EXIF_FIXTURE_NO_GPS: Uint8Array = buildExifJpeg({ gps: false });

/** Big-endian (`MM`), to prove the reader's byte order is the file's and not the host's. */
export const EXIF_FIXTURE_BIG_ENDIAN: Uint8Array = buildExifJpeg({ byteOrder: "big" });

/** No `Make`: the camera line is the model alone. */
export const EXIF_FIXTURE_MODEL_ONLY: Uint8Array = buildExifJpeg({ dropMake: true });

/** The base image with no EXIF at all. */
export const FIXTURE_WITHOUT_EXIF: Uint8Array = baselineJpeg();

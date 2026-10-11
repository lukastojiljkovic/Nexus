/**
 * The EXIF reader the image tools use to tell the user what a file is about to
 * lose.
 *
 * **Why this exists at all.** Re-encoding a picture through a canvas is how the
 * tools resize and convert, and the canvas API has no metadata channel: what it
 * draws is pixels, so every EXIF block — including GPS — is gone from the file
 * that comes out. That is the RIGHT behaviour for a tool whose promise is "this
 * is your picture and nothing else", but it is a promise the user has to be
 * told about BEFORE it happens, and the only way to say "this file had GPS
 * coordinates in it" is to read the block we are about to drop.
 *
 * **Exactly three answers, and deliberately no more.** GPS present yes/no, the
 * camera, and the date. Anything richer would be a metadata editor's subject,
 * and the whole point here is a sentence of two lines above a button. So this
 * reads IFD0 and two pointers from it and stops: `Make`, `Model`, `DateTime`,
 * the Exif sub-IFD for `DateTimeOriginal` (which is the date a camera actually
 * wrote, where IFD0's `DateTime` is the file's), and the GPS sub-IFD's mere
 * presence.
 *
 * **Total by construction, in both directions.** Not a JPEG, no APP1 segment,
 * a truncated segment, a byte order this does not know, an offset past the end
 * of the block: every one of those answers "nothing readable" rather than
 * throwing, because this runs on a file the user picked and a picture that
 * cannot be read is a picture with no metadata to warn about — never an error
 * the resizer has to handle before it can start. `hasExif` is therefore "an
 * EXIF block this reader could walk", which is the honest claim: a corrupt
 * block is not something the screen may describe.
 *
 * **The spec, and where the numbers come from.** JPEG markers: ITU-T T.81
 * §B.1.1.4 (APP1 = 0xFFE1, SOS = 0xFFDA, EOI = 0xFFD9) and §B.1.1.2 for the
 * two-byte big-endian segment length that includes itself. The TIFF header
 * ("II"/"MM", magic 42, the offset of IFD0), the 12-byte directory entry
 * (tag, type, count, a 4-byte value-or-offset field) and the ASCII type are
 * TIFF 6.0 §2. The tags are the EXIF 2.32 tag list: 0x010F Make, 0x0110 Model,
 * 0x0132 DateTime, 0x8769 ExifIFD pointer, 0x8825 GPSInfo pointer, 0x9003
 * DateTimeOriginal.
 */

/** What an image's EXIF block says, in the three things the tools warn about. */
export interface ImageExifSummary {
  /** Whether an EXIF block was found AND walked — see the header's last paragraph. */
  readonly hasExif: boolean;
  /** Whether the block carries a readable GPS pointer. */
  readonly hasGps: boolean;
  /** `Make Model`, or whichever of the two the block has; `null` when it has neither. */
  readonly camera: string | null;
  /** The raw EXIF date string (`YYYY:MM:DD HH:MM:SS`), preferring `DateTimeOriginal`. */
  readonly dateTime: string | null;
}

/** The answer for a file with no readable EXIF block, shared so callers can compare identity-free. */
export const NO_EXIF_SUMMARY: ImageExifSummary = {
  hasExif: false,
  hasGps: false,
  camera: null,
  dateTime: null,
};

/** The IFD0 tags this reader looks at, plus the two pointers it follows. */
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_DATE_TIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATE_TIME_ORIGINAL = 0x9003;

/** TIFF's field types this reader can read a value for: BYTE, ASCII, LONG. */
const TYPE_BYTE = 1;
const TYPE_ASCII = 2;
const TYPE_LONG = 4;

/** How many bytes one value of each type occupies — the third column of the entry table. */
function typeSize(type: number): number {
  switch (type) {
    case TYPE_BYTE:
    case TYPE_ASCII:
      return 1;
    case TYPE_LONG:
      return 4;
    default:
      return 0;
  }
}

/** One 12-byte directory entry, already resolved: where its VALUE lives inside the TIFF block. */
interface TiffEntry {
  readonly type: number;
  readonly count: number;
  /** Offset of the value within the TIFF block, whether it sat inline in the entry or at an offset. */
  readonly valueOffset: number;
}

/** A byte-order-aware view of one TIFF block, or nothing when it is not one. */
interface Tiff {
  readonly bytes: Uint8Array;
  u16(offset: number): number | null;
  u32(offset: number): number | null;
  ifd(offset: number): Map<number, TiffEntry> | null;
}

/**
 * Reads the TIFF block, or answers `null` for anything that is not a TIFF header
 * this reader knows: a short block, an unknown byte order, a magic number that
 * is not 42, an IFD0 offset outside the block.
 */
function openTiff(bytes: Uint8Array): Tiff | null {
  if (bytes.length < 8) return null;
  const first = bytes[0];
  const second = bytes[1];
  const littleEndian =
    first === 0x49 && second === 0x49 ? true : first === 0x4d && second === 0x4d ? false : null;
  if (littleEndian === null) return null;

  const u16 = (offset: number): number | null => {
    if (offset < 0 || offset + 1 >= bytes.length) return null;
    const a = bytes[offset] as number;
    const b = bytes[offset + 1] as number;
    return littleEndian ? a | (b << 8) : (a << 8) | b;
  };
  const u32 = (offset: number): number | null => {
    if (offset < 0 || offset + 3 >= bytes.length) return null;
    const a = bytes[offset] as number;
    const b = bytes[offset + 1] as number;
    const c = bytes[offset + 2] as number;
    const d = bytes[offset + 3] as number;
    return littleEndian
      ? (a | (b << 8) | (c << 16) | (d << 24)) >>> 0
      : ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  };

  const tiff: Tiff = {
    bytes,
    u16,
    u32,
    ifd: (offset) => {
      const count = u16(offset);
      if (count === null) return null;
      // The directory has to fit whole: a truncated one is a block this reader
      // cannot walk, and walking a partial one would invent entries from
      // whatever bytes follow.
      if (offset + 2 + count * 12 > bytes.length) return null;
      const entries = new Map<number, TiffEntry>();
      for (let index = 0; index < count; index += 1) {
        const at = offset + 2 + index * 12;
        const tag = u16(at);
        const type = u16(at + 2);
        const valueCount = u32(at + 4);
        if (tag === null || type === null || valueCount === null) return null;
        const size = typeSize(type);
        if (size === 0) continue;
        // TIFF 6.0 §2: a value that fits in four bytes sits IN the entry's
        // value field; anything longer is at the offset the field names.
        const valueOffset = size * valueCount <= 4 ? at + 8 : (u32(at + 8) ?? -1);
        if (valueOffset < 0 || valueOffset >= bytes.length) continue;
        entries.set(tag, { type, count: valueCount, valueOffset });
      }
      return entries;
    },
  };

  if (u16(2) !== 42) return null;
  const ifd0 = u32(4);
  if (ifd0 === null || ifd0 >= bytes.length) return null;
  return tiff;
}

/** The ASCII text of an entry, without its terminating NUL and surrounding spaces; `null` for an entry that is not non-empty ASCII. */
function asciiValue(tiff: Tiff, entry: TiffEntry | undefined): string | null {
  if (entry === undefined || entry.type !== TYPE_ASCII || entry.count === 0) return null;
  const end = entry.valueOffset + entry.count;
  if (end > tiff.bytes.length) return null;
  let text = "";
  for (let at = entry.valueOffset; at < end; at += 1) {
    const byte = tiff.bytes[at] as number;
    if (byte === 0) break;
    text += String.fromCharCode(byte);
  }
  const trimmed = text.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** The offset an entry points at, when it is a LONG pointer to a directory that actually fits in the block. */
function pointerTo(tiff: Tiff, entry: TiffEntry | undefined): number | null {
  if (entry === undefined || entry.type !== TYPE_LONG || entry.count !== 1) return null;
  const offset = tiff.u32(entry.valueOffset);
  if (offset === null || offset + 2 > tiff.bytes.length) return null;
  return offset;
}

/**
 * The EXIF APP1 segment's body (past the six-byte `Exif\0\0` identifier), or
 * `null` when the file has none this reader can reach.
 *
 * Walks the JPEG marker chain from the start instead of searching for the
 * `Exif\0\0` bytes anywhere in the file, and that is a correctness decision
 * rather than a fastidious one: those six bytes can appear inside compressed
 * image data, and a search would happily return a slice of somebody's pixels as
 * a metadata block. The walk also stops at SOS, which is where a JPEG's
 * entropy-coded data begins and where no further segment can legally appear.
 */
function findExifSegment(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1] as number;
    let cursor = offset + 2;
    // A marker may be preceded by any number of 0xFF fill bytes (T.81 B.1.1.2).
    while (marker === 0xff) {
      if (cursor >= bytes.length) return null;
      marker = bytes[cursor] as number;
      cursor += 1;
    }
    // Standalone markers carry no length: SOI, TEM, and the restart markers.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset = cursor;
      continue;
    }
    // SOS: the scan's data follows and no metadata segment can come after it.
    if (marker === 0xda || marker === 0xd9) return null;
    if (cursor + 1 >= bytes.length) return null;
    const length = ((bytes[cursor] as number) << 8) | (bytes[cursor + 1] as number);
    if (length < 2) return null;
    const bodyStart = cursor + 2;
    const bodyEnd = cursor + length;
    if (bodyEnd > bytes.length) return null;
    if (marker === 0xe1 && isExifBody(bytes, bodyStart, bodyEnd)) {
      return bytes.subarray(bodyStart + 6, bodyEnd);
    }
    offset = bodyEnd;
  }
  return null;
}

/** Whether an APP1 body opens with EXIF's own six-byte identifier, `Exif\0\0`. */
function isExifBody(bytes: Uint8Array, start: number, end: number): boolean {
  if (end - start < 6) return false;
  const identifier = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  return identifier.every((byte, index) => bytes[start + index] === byte);
}

/**
 * The three answers, for any bytes at all.
 *
 * This is the function the tools call, and it never throws: a PNG, a text file,
 * a truncated JPEG and a JPEG with a mangled EXIF block all answer
 * `NO_EXIF_SUMMARY`.
 */
export function readExifSummary(bytes: Uint8Array): ImageExifSummary {
  const block = findExifSegment(bytes);
  if (block === null) return NO_EXIF_SUMMARY;
  const tiff = openTiff(block);
  if (tiff === null) return NO_EXIF_SUMMARY;
  const ifd0Offset = tiff.u32(4);
  const ifd0 = ifd0Offset === null ? null : tiff.ifd(ifd0Offset);
  if (ifd0 === null) return NO_EXIF_SUMMARY;

  const make = asciiValue(tiff, ifd0.get(TAG_MAKE));
  const model = asciiValue(tiff, ifd0.get(TAG_MODEL));
  const camera = [make, model].filter((part): part is string => part !== null).join(" ") || null;

  let dateTime = asciiValue(tiff, ifd0.get(TAG_DATE_TIME));
  const exifIfdOffset = pointerTo(tiff, ifd0.get(TAG_EXIF_IFD));
  if (exifIfdOffset !== null) {
    const exifIfd = tiff.ifd(exifIfdOffset);
    const original = exifIfd === null ? null : asciiValue(tiff, exifIfd.get(TAG_DATE_TIME_ORIGINAL));
    // The date a camera wrote wins over the date the file carries: this
    // sentence is about the picture, not about when somebody copied it.
    if (original !== null) dateTime = original;
  }

  const gpsIfdOffset = pointerTo(tiff, ifd0.get(TAG_GPS_IFD));
  const hasGps = gpsIfdOffset !== null && tiff.ifd(gpsIfdOffset) !== null;

  return { hasExif: true, hasGps, camera, dateTime };
}

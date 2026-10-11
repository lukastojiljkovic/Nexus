// The zip reader the two tool-pack builders share.
//
// WHY THIS EXISTS AT ALL. A pack builder may use "no dependency beyond Node
// itself, what the repository already has, and the two root dev dependencies
// installed for pack builders (`pdfjs-dist` and `sharp`)" — and neither of those
// two reads a zip, while `yauzl` (the app's own zip dependency) is not a root
// dependency a script may reach. So the choice is one small reader here, or a
// builder that cannot open the archives the publishers ship. ADR-091 refused a
// tar reader for the app's install path on the ground that it is a second parser
// on hostile input; this one is a different case and says so: it never sees a
// file an attacker chose, because the archive's SHA-256 is checked against the
// publisher's own digest BEFORE a byte of it is parsed (see each builder's
// `verifyDigest`). What it reads is a file the publisher signed off on.
//
// WHAT IT SUPPORTS, and what it refuses rather than guesses: the central
// directory, stored entries and deflated entries, and nothing else. Zip64 is
// refused by signature (a release this large would be a different reader's
// problem, not a silently truncated extraction here), encrypted entries are
// refused by flag, and an entry whose inflate does not produce the declared size
// is refused. Entry names are read as UTF-8 and compared exactly.

import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;

/** The most a single entry may inflate to unless a caller says otherwise. */
export const DEFAULT_ENTRY_LIMIT = 1024 * 1024 * 1024;

/** One entry's central-directory record. Offsets are absolute in the buffer. */
export function readZipEntries(buffer) {
  const eocd = findEocd(buffer);
  if (eocd === -1) throw new Error("zip: no end-of-central-directory record; this is not a zip.");
  if (buffer.readUInt32LE(eocd - 20) === ZIP64_EOCD_SIGNATURE) {
    throw new Error("zip: this reader does not read zip64 archives.");
  }
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);

  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error("zip: the central directory is not the shape its own header describes.");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if ((flags & 0x0001) !== 0) throw new Error(`zip: "${name}" is encrypted.`);
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEocd(buffer) {
  // The comment field is at most 65535 bytes, and the record itself is 22.
  const lowest = Math.max(0, buffer.length - (65535 + 22));
  for (let offset = buffer.length - 22; offset >= lowest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/** One entry's bytes, inflated. `limit` bounds what a single entry may become. */
export function readZipEntry(buffer, entry, limit = DEFAULT_ENTRY_LIMIT) {
  if (entry.uncompressedSize > limit) {
    throw new Error(
      `zip: "${entry.name}" is ${String(entry.uncompressedSize)} bytes, over the ${String(limit)}-byte entry limit.`,
    );
  }
  const header = entry.localHeaderOffset;
  if (buffer.readUInt32LE(header) !== LOCAL_SIGNATURE) {
    throw new Error(`zip: "${entry.name}" has no local header where the directory says it does.`);
  }
  const nameLength = buffer.readUInt16LE(header + 26);
  const extraLength = buffer.readUInt16LE(header + 28);
  const start = header + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) {
    if (compressed.length !== entry.uncompressedSize) {
      throw new Error(`zip: "${entry.name}" is stored but its sizes disagree.`);
    }
    return Buffer.from(compressed);
  }
  if (entry.method === 8) {
    const inflated = inflateRawSync(compressed, { maxOutputLength: limit });
    if (inflated.byteLength !== entry.uncompressedSize) {
      throw new Error(
        `zip: "${entry.name}" inflated to ${String(inflated.byteLength)} bytes; the directory says ${String(entry.uncompressedSize)}.`,
      );
    }
    return inflated;
  }
  throw new Error(`zip: "${entry.name}" uses compression method ${String(entry.method)}, which this reader does not read.`);
}

/** Every entry whose name starts with `prefix`, in central-directory order. */
export function zipEntriesUnder(entries, prefix) {
  return entries.filter((entry) => entry.name.startsWith(prefix));
}

/** The bytes of the one entry named exactly `name`. A missing name is an error, not an empty buffer. */
export function zipEntryNamed(buffer, entries, name, limit = DEFAULT_ENTRY_LIMIT) {
  const entry = entries.find((candidate) => candidate.name === name);
  if (entry === undefined) throw new Error(`zip: the archive holds no "${name}".`);
  return readZipEntry(buffer, entry, limit);
}

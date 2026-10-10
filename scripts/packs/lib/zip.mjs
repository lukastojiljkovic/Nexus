// No shebang; imported by the foods builder and its test.
//
// WHY THIS EXISTS RATHER THAN A DEPENDENCY. USDA publishes FoodData Central
// only as ZIP archives, and the brief's rule for these builders is „no
// dependency beyond Node itself and what the repository already has". The
// repository does contain `yauzl`, but it is hoisted into `apps/desktop`'s own
// `node_modules` and is not resolvable from `scripts/`, so importing it here
// would work on one machine and fail on the next. Node has `zlib.inflateRaw`,
// which is the whole of what a ZIP reader needs to do, so the reader is below
// and is 40 lines long.
//
// WHAT IT REFUSES TO SUPPORT, and why that is honest rather than incomplete:
// ZIP64 (every one of these archives is under 10 MB), encryption, data
// descriptors, and multi-disk archives. A file that uses any of them throws
// instead of returning a truncated buffer, because a converter silently handed
// half a CSV would produce a pack that is missing rows and looks fine.

import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_BYTES = 22;

/** A directory entry, as its name ends in `/` and carries no bytes. */
const isDirectory = (name) => name.endsWith("/");

/**
 * Every file in the archive as `name -> Buffer`, or a throw.
 *
 * The end-of-central-directory record is found by scanning BACKWARDS from the
 * end, which is the only way to find it, because the comment it carries is
 * variable-length and may itself contain the signature.
 */
export function readZip(buffer) {
  let eocd = -1;
  for (let at = buffer.length - EOCD_MIN_BYTES; at >= 0; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: no end-of-central-directory record");

  const entries = new Map();
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`zip: central directory entry ${String(index)} is not a header`);
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`zip: local header for "${name}" is missing`);
    }
    // The local header repeats the name and extra fields, and its lengths are
    // the ones that say where the data starts: they are allowed to differ from
    // the central directory's, so both are read.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);

    if (!isDirectory(name)) {
      if (method === 0) entries.set(name, Buffer.from(raw));
      else if (method === 8) entries.set(name, inflateRawSync(raw));
      else throw new Error(`zip: "${name}" uses compression method ${String(method)}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * The single member whose BASENAME is `basename`, e.g. `food.csv`.
 *
 * USDA wraps every archive in a version-stamped folder, so a caller that had to
 * name the whole path would break the day USDA changes its naming. The match is
 * on the whole last segment rather than a suffix, because the Foundation ZIP is
 * full of tables whose names end in `food.csv` — `sample_food.csv`,
 * `sub_sample_food.csv`, `foundation_food.csv` — and a suffix match would take
 * the first of those and convert laboratory samples as if they were foods.
 * Exactly one match is required: two is an archive shape this reader does not
 * understand.
 */
export function entryNamed(entries, basename) {
  const matches = [...entries.keys()].filter((name) => name.split("/").at(-1) === basename);
  if (matches.length !== 1) {
    throw new Error(`zip: expected exactly one file named "${basename}", found ${String(matches.length)}`);
  }
  return entries.get(matches[0]);
}

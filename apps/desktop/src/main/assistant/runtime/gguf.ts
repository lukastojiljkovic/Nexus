/**
 * THE GGUF HEADER, READ WITH A BOUND, AND WHAT IT SAYS ABOUT A FILE.
 *
 * A user may import any `.gguf` from disk, so this module reads a file it has
 * never seen and must not believe it. Two properties make the reading safe:
 *
 *   1. **A bound on every read.** At most `GGUF_LIMITS.headerBytes` are read,
 *      every field is bounds-checked before it is used, and a header that does
 *      not fit inside the buffer stops the parse with what was read so far
 *      rather than allocating what a count claims. An array is materialised
 *      only up to `GGUF_LIMITS.arrayElements`; above that it is SKIPPED by
 *      walking its elements' lengths, which is what lets a 260 000-entry
 *      tokenizer array (present in every real file, and megabytes of it) be
 *      stepped over without holding it.
 *   2. **Only the facts this app acts on.** Architecture, context length, the
 *      chat template, whether the file IS a projector and whether the model
 *      expects one — no tensors, no tokenizer tables. The byte reader here is
 *      deliberately not node-llama-cpp's: the import path runs in main, which
 *      never loads the native addon (see ADR-096), and the library's reader
 *      lives behind the addon.
 *
 * A GgufError is a REFUSAL, not a warning: the magic, the version and the
 * sizes are the three things a file has to get right to be a GGUF at all, and a
 * file that fails one of them is not a model this app can half-use.
 */

import { open } from "node:fs/promises";

/** What a read may cost. Every one of these is a bound on work, not a guess at a real size. */
export const GGUF_LIMITS = {
  /** How many bytes of a file are read at most: the largest metadata section measured here is 15 MB. */
  headerBytes: 32 * 1024 * 1024,
  /** Longest string value kept — a chat template. Measured: the largest in the catalogue is 18.6 KB. */
  stringBytes: 1024 * 1024,
  /** Arrays kept whole. `general.tags` is the one this reader wants. */
  arrayElements: 64,
  /** Arrays stepped over, to reach the keys that follow them. Measured: 262 144 tokenizer entries. */
  skipArrayElements: 2_000_000,
  /** Metadata pairs read before the header is declared implausible. */
  values: 4096,
} as const;

/** `GGUF`, little-endian, as the spec writes it. */
export const GGUF_MAGIC = 0x46554747;

/** The two versions this reader understands. Version 1 has a different header layout. */
const GGUF_VERSIONS: readonly number[] = [2, 3];

/**
 * The GGUF value types, in the spec's own order. The array is the decoder's
 * whole vocabulary: an index outside it is a file this reader refuses.
 */
const VALUE_FIXED_SIZE: readonly number[] = [
  1, // 0 UINT8
  1, // 1 INT8
  2, // 2 UINT16
  2, // 3 INT16
  4, // 4 UINT32
  4, // 5 INT32
  4, // 6 FLOAT32
  1, // 7 BOOL
  0, // 8 STRING — length-prefixed, so its size is read from the buffer
  0, // 9 ARRAY — a type and a count, then elements
  8, // 10 UINT64
  8, // 11 INT64
  8, // 12 FLOAT64
];

const TYPE_ARRAY = 9;
const TYPE_STRING = 8;

export type GgufScalar = string | number | boolean;
export type GgufValue = GgufScalar | readonly GgufScalar[];

export interface GgufHeader {
  readonly version: number;
  readonly tensorCount: number;
  readonly metadataCount: number;
  readonly values: ReadonlyMap<string, GgufValue>;
  /** `false` when the buffer ended inside the metadata. The keys read so far are still true. */
  readonly complete: boolean;
}

export type GgufProblem = "magic" | "version" | "layout" | "size";

/** Why a file is not a GGUF this build reads. Machine codes; the caller writes the sentence. */
export class GgufError extends Error {
  readonly problem: GgufProblem;

  constructor(problem: GgufProblem, message: string) {
    super(message);
    this.name = "GgufError";
    this.problem = problem;
  }
}

/**
 * The metadata of a GGUF file held in `bytes`.
 *
 * A file whose header is longer than the buffer is answered with what was read,
 * `complete: false` — the difference between "this file says nothing about its
 * context length" and "this reader did not get far enough to see it" is one the
 * import path has to be able to tell, because the first is a fact about the
 * model and the second is a fact about this call.
 */
export function readGgufHeader(bytes: Uint8Array, limitBytes = GGUF_LIMITS.headerBytes): GgufHeader {
  const limit = Math.min(bytes.byteLength, limitBytes);
  if (limit < 24) throw new GgufError("size", "The file is shorter than a GGUF header.");
  if (readUint32(bytes, 0) !== GGUF_MAGIC) throw new GgufError("magic", "The file does not begin with GGUF.");
  const version = readUint32(bytes, 4);
  if (version === null || !GGUF_VERSIONS.includes(version)) {
    throw new GgufError("version", `GGUF version ${String(version)} is not a version this build reads.`);
  }
  const tensorCount = readUint64(bytes, 8) ?? unreadable();
  const metadataCount = readUint64(bytes, 16) ?? unreadable();

  const values = new Map<string, GgufValue>();
  let offset = 24;
  let read = 0;
  for (; read < metadataCount; read += 1) {
    if (read >= GGUF_LIMITS.values) break;
    const key = readString(bytes, offset, limit);
    if (key === null) break;
    offset = key.next;
    const type = readUint32(bytes, offset);
    if (type === null || type >= VALUE_FIXED_SIZE.length) {
      throw new GgufError("layout", `"${key.value}" has a value type this build does not know.`);
    }
    offset += 4;
    const value = readValue(bytes, offset, limit, type);
    if (value === null) break;
    offset = value.next;
    values.set(key.value, value.value);
  }

  return {
    version,
    tensorCount,
    metadataCount,
    values,
    complete: read === metadataCount && offset <= limit,
  };
}

/** A `uint64` past the end of the buffer is a header this reader cannot use. */
function unreadable(): never {
  throw new GgufError("layout", "The header's counts are not readable.");
}

/**
 * The first `GGUF_LIMITS.headerBytes` of a file, parsed. The bound is on the
 * READ as well as on the parse, so a 16 GB model costs the same as a 500 MB one.
 */
export async function readGgufHeaderFromFile(
  path: string,
  limitBytes = GGUF_LIMITS.headerBytes,
): Promise<GgufHeader> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(limitBytes);
    const { bytesRead } = await handle.read(buffer, 0, limitBytes, 0);
    return readGgufHeader(buffer.subarray(0, bytesRead), limitBytes);
  } finally {
    await handle.close();
  }
}

interface Read<T> {
  readonly value: T;
  readonly next: number;
}

function readUint32(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.byteLength) return null;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

/** A `uint64` that is not a safe integer is `null`: no GGUF field this reader wants is one. */
function readUint64(bytes: Uint8Array, offset: number): number | null {
  if (offset + 8 > bytes.byteLength) return null;
  const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true);
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : null;
}

function readString(bytes: Uint8Array, offset: number, limit: number): Read<string> | null {
  const length = readUint64(bytes, offset);
  if (length === null || length > GGUF_LIMITS.stringBytes) return null;
  const start = offset + 8;
  if (start + length > limit) return null;
  return { value: new TextDecoder().decode(bytes.subarray(start, start + length)), next: start + length };
}

function readValue(bytes: Uint8Array, offset: number, limit: number, type: number): Read<GgufValue> | null {
  if (type === TYPE_STRING) return readString(bytes, offset, limit);
  if (type !== TYPE_ARRAY) {
    const size = VALUE_FIXED_SIZE[type] ?? 0;
    if (size === 0 || offset + size > limit) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, size);
    switch (type) {
      case 0:
        return { value: view.getUint8(0), next: offset + 1 };
      case 1:
        return { value: view.getInt8(0), next: offset + 1 };
      case 2:
        return { value: view.getUint16(0, true), next: offset + 2 };
      case 3:
        return { value: view.getInt16(0, true), next: offset + 2 };
      case 4:
        return { value: view.getUint32(0, true), next: offset + 4 };
      case 5:
        return { value: view.getInt32(0, true), next: offset + 4 };
      case 6:
        return { value: view.getFloat32(0, true), next: offset + 4 };
      case 7:
        return { value: view.getUint8(0) !== 0, next: offset + 1 };
      case 10: {
        const value = readUint64(bytes, offset);
        return value === null ? null : { value, next: offset + 8 };
      }
      case 11: {
        if (offset + 8 > limit) return null;
        const value = view.getBigInt64(0, true);
        return { value: Number(value), next: offset + 8 };
      }
      default: {
        if (offset + 8 > limit) return null;
        return { value: view.getFloat64(0, true), next: offset + 8 };
      }
    }
  }

  const elementType = readUint32(bytes, offset);
  if (elementType === null || elementType >= VALUE_FIXED_SIZE.length) return null;
  const count = readUint64(bytes, offset + 4);
  if (count === null || count > GGUF_LIMITS.skipArrayElements) return null;
  let cursor = offset + 12;

  if (count > GGUF_LIMITS.arrayElements) {
    // Stepped over rather than kept: only the LENGTHS are read, and only so the
    // keys after this one can be reached.
    for (let index = 0; index < count; index += 1) {
      if (elementType === TYPE_STRING) {
        const element = readString(bytes, cursor, limit);
        if (element === null) return null;
        cursor = element.next;
        continue;
      }
      const size = VALUE_FIXED_SIZE[elementType] ?? 0;
      if (size === 0 || cursor + size > limit) return null;
      cursor += size;
    }
    return { value: [], next: cursor };
  }

  const elements: GgufScalar[] = [];
  for (let index = 0; index < count; index += 1) {
    const element = readValue(bytes, cursor, limit, elementType);
    if (element === null || isElementArray(element.value)) return null;
    elements.push(element.value);
    cursor = element.next;
  }
  return { value: elements, next: cursor };
}

/**
 * A value that is itself an array cannot be an ELEMENT of an array — GGUF does
 * not nest them — so a nested one is a header this reader refuses rather than
 * one it guesses at.
 */
function isElementArray(value: GgufValue): value is readonly GgufScalar[] {
  return Array.isArray(value);
}

/**
 * What the assistant needs to know about a file it may import.
 *
 * Every field is read from the header, and nothing is inferred from a file name
 * or a family: `model` and `projector` are separate questions, because the file
 * a user picks can be EITHER the model (`general.type: "model"`) or the vision
 * projector that goes beside one (`general.type: "mmproj"`, which is a `clip`
 * architecture), and the answer decides whether the app offers the file as a
 * chat model at all.
 */
export interface GgufFacts {
  /** `general.architecture`, e.g. `qwen35`. `null` when the file declares none. */
  readonly architecture: string | null;
  /** `<arch>.context_length`, the length llama.cpp will enforce. `null` when it is not in the header. */
  readonly contextTokens: number | null;
  /** `tokenizer.chat_template`, when the file carries one. */
  readonly chatTemplate: string | null;
  /** The file itself is a vision projector. */
  readonly projector: boolean;
  /** The model declares image input, so it needs a projector this runtime cannot use (ADR-096). */
  readonly vision: boolean;
  /** The file is an embedding model, not a chat model. */
  readonly embedding: boolean;
  /** Which keys produced `projector`, `vision` and `embedding` — the evidence, for the record. */
  readonly signals: readonly string[];
}

/** The tags a quantiser writes into `general.tags` for a model that takes images. */
const VISION_TAGS: readonly string[] = ["image-text-to-text", "any-to-any", "image-to-text"];

/** The tags that mark an embedding model. */
const EMBEDDING_TAGS: readonly string[] = ["sentence-similarity", "feature-extraction", "text-embeddings-inference"];

export function ggufFacts(header: GgufHeader): GgufFacts {
  const values = header.values;
  const architecture = stringValue(values, "general.architecture");
  const signals: string[] = [];

  const type = stringValue(values, "general.type");
  const clipKeys = [...values.keys()].filter((key) => key.startsWith("clip."));
  const projector = type === "mmproj" || architecture === "clip" || clipKeys.length > 0;
  if (type === "mmproj") signals.push("general.type=mmproj");
  if (architecture === "clip") signals.push("general.architecture=clip");
  if (clipKeys.length > 0) signals.push(`clip.* keys (${String(clipKeys.length)})`);

  const tags = arrayValue(values, "general.tags").filter((tag): tag is string => typeof tag === "string");
  const visionTag = tags.find((tag) => VISION_TAGS.includes(tag));
  const vision = visionTag !== undefined && !projector;
  if (visionTag !== undefined) signals.push(`general.tags=${visionTag}`);

  const pooling = [...values.keys()].filter((key) => key.endsWith(".pooling_type"));
  const embeddingTag = tags.find((tag) => EMBEDDING_TAGS.includes(tag));
  const embedding = pooling.length > 0 || embeddingTag !== undefined;
  if (pooling.length > 0) signals.push(`pooling (${pooling.join(", ")})`);
  if (embeddingTag !== undefined) signals.push(`general.tags=${embeddingTag}`);

  return {
    architecture,
    contextTokens: contextTokensOf(values, architecture),
    chatTemplate: stringValue(values, "tokenizer.chat_template"),
    projector,
    vision,
    embedding,
    signals,
  };
}

/**
 * The licence the FILE itself declares, if any.
 *
 * Almost every GGUF written by a known quantiser carries `general.license` and
 * often `general.license.link` (all nine catalogue models do), which makes an
 * imported file's licence a fact about the file rather than something the app
 * has to ask about. A file that declares none answers `null` twice, and the
 * caller records that honestly instead of guessing from a model name.
 */
export function ggufLicence(header: GgufHeader): { readonly name: string | null; readonly url: string | null } {
  return {
    name: stringValue(header.values, "general.license"),
    url: stringValue(header.values, "general.license.link") ?? stringValue(header.values, "general.license.url"),
  };
}

function contextTokensOf(values: ReadonlyMap<string, GgufValue>, architecture: string | null): number | null {
  if (architecture !== null) {
    const own = numberValue(values, `${architecture}.context_length`);
    if (own !== null) return own;
  }
  // A file that names an architecture this build has not seen still states its
  // context length under that architecture's own prefix, which is the fallback.
  for (const [key, value] of values) {
    if (!key.endsWith(".context_length") || typeof value !== "number") continue;
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  return null;
}

function stringValue(values: ReadonlyMap<string, GgufValue>, key: string): string | null {
  const value = values.get(key);
  return typeof value === "string" ? value : null;
}

function numberValue(values: ReadonlyMap<string, GgufValue>, key: string): number | null {
  const value = values.get(key);
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function arrayValue(values: ReadonlyMap<string, GgufValue>, key: string): readonly GgufScalar[] {
  const value = values.get(key);
  return Array.isArray(value) ? value : [];
}

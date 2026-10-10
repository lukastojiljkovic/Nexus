/**
 * TEST-ONLY helper — imported by the `*.test.ts` files beside it and by nothing
 * in the app, `packs/fixtures.ts`'s arrangement and its reason.
 *
 * The GGUF reader, the import path and the catalogue refresher all need the same
 * thing: a header that is a REAL GGUF header — the magic, the version, a metadata
 * section with the keys llama.cpp actually writes — without a model file beside
 * it. A committed `.gguf` would be megabytes of binary that a reviewer cannot
 * read; a hand-written byte array inside each test would be three copies of the
 * same encoder. So the encoder is here, as a builder that takes the metadata
 * apart enough for the refusals to be reachable: the wrong magic, a version this
 * build does not read, a truncated buffer, an array larger than the reader keeps.
 *
 * It is deliberately NOT a general GGUF writer: numbers are `uint32`, booleans
 * are the one-byte kind, strings are length-prefixed, and arrays hold strings or
 * numbers. That is the whole of what a header this app reads contains.
 */

export type FixtureValue = string | number | boolean | readonly (string | number)[];

export interface FixtureEntry {
  readonly key: string;
  readonly value: FixtureValue;
}

/** The value kinds this encoder can write, as GGUF numbers them. */
const TYPE_UINT32 = 4;
const TYPE_BOOL = 7;
const TYPE_STRING = 8;
const TYPE_ARRAY = 9;

/** `GGUF` little-endian. */
const MAGIC = 0x46554747;

/**
 * A GGUF header as bytes: magic, version 3 by default, a tensor count of 0 and
 * this metadata. `truncate` cuts the result short, which is how the reader's
 * "the buffer ended inside the metadata" path is reached without a broken file.
 */
export function buildGgufHeader(
  entries: readonly FixtureEntry[],
  options: { readonly version?: number; readonly magic?: number; readonly truncate?: number } = {},
): Uint8Array {
  const parts: Buffer[] = [];
  const header = Buffer.alloc(24);
  header.writeUInt32LE(options.magic ?? MAGIC, 0);
  header.writeUInt32LE(options.version ?? 3, 4);
  header.writeBigUInt64LE(0n, 8);
  header.writeBigUInt64LE(BigInt(entries.length), 16);
  parts.push(header);
  for (const entry of entries) {
    parts.push(lengthPrefixed(entry.key));
    parts.push(encodeValue(entry.value));
  }
  const whole = Buffer.concat(parts);
  return options.truncate === undefined ? whole : whole.subarray(0, options.truncate);
}

function lengthPrefixed(text: string): Buffer {
  const bytes = Buffer.from(text, "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(bytes.byteLength), 0);
  return Buffer.concat([length, bytes]);
}

function encodeValue(value: FixtureValue): Buffer {
  if (typeof value === "string") {
    const type = Buffer.alloc(4);
    type.writeUInt32LE(TYPE_STRING, 0);
    return Buffer.concat([type, lengthPrefixed(value)]);
  }
  if (typeof value === "boolean") {
    const bytes = Buffer.alloc(5);
    bytes.writeUInt32LE(TYPE_BOOL, 0);
    bytes.writeUInt8(value ? 1 : 0, 4);
    return bytes;
  }
  if (typeof value === "number") {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE(TYPE_UINT32, 0);
    bytes.writeUInt32LE(value, 4);
    return bytes;
  }
  const strings = value.every((element) => typeof element === "string");
  const head = Buffer.alloc(16);
  head.writeUInt32LE(TYPE_ARRAY, 0);
  head.writeUInt32LE(strings ? TYPE_STRING : TYPE_UINT32, 4);
  head.writeBigUInt64LE(BigInt(value.length), 8);
  const body = strings
    ? Buffer.concat(value.map((element) => lengthPrefixed(String(element))))
    : Buffer.concat(
        value.map((element) => {
          const bytes = Buffer.alloc(4);
          bytes.writeUInt32LE(Number(element), 0);
          return bytes;
        }),
      );
  return Buffer.concat([head, body]);
}

/** A small chat model's header, with the keys a real quantiser writes. */
export function modelHeader(overrides?: {
  readonly architecture?: string;
  readonly contextLength?: number;
  readonly tags?: readonly string[];
  readonly chatTemplate?: string;
}): Uint8Array {
  const architecture = overrides?.architecture ?? "qwen3";
  return buildGgufHeader([
    { key: "general.architecture", value: architecture },
    { key: "general.name", value: "Fixture 4B" },
    { key: "general.license", value: "apache-2.0" },
    { key: "general.license.link", value: "https://example.org/licence" },
    { key: "general.tags", value: overrides?.tags ?? ["text-generation"] },
    { key: `${architecture}.block_count`, value: 32 },
    { key: `${architecture}.context_length`, value: overrides?.contextLength ?? 32768 },
    { key: `${architecture}.embedding_length`, value: 2560 },
    { key: `${architecture}.attention.head_count_kv`, value: 4 },
    {
      key: "tokenizer.chat_template",
      value: overrides?.chatTemplate ?? "{%- if tools %}\n{{- '<|im_start|>' }}\n{%- endif %}",
    },
  ]);
}

/** A vision projector's header, as `clip` writes it (measured on Qwen3-VL's `mmproj`). */
export function projectorHeader(): Uint8Array {
  return buildGgufHeader([
    { key: "general.architecture", value: "clip" },
    { key: "general.type", value: "mmproj" },
    { key: "general.name", value: "Fixture projector" },
    { key: "clip.has_vision_encoder", value: true },
    { key: "clip.projector_type", value: "qwen3vl_merger" },
    { key: "clip.vision.image_size", value: 768 },
  ]);
}

/** An embedding model's header: the pooling key is what marks it as one. */
export function embeddingHeader(): Uint8Array {
  return buildGgufHeader([
    { key: "general.architecture", value: "qwen3" },
    { key: "general.name", value: "Fixture embedding" },
    { key: "general.tags", value: ["sentence-similarity", "feature-extraction"] },
    { key: "qwen3.context_length", value: 32768 },
    { key: "qwen3.embedding_length", value: 1024 },
    { key: "qwen3.pooling_type", value: 3 },
  ]);
}

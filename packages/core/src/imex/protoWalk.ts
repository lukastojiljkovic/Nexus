/**
 * A minimal walker over protobuf's WIRE format (ADR-052 / STUDY-011): tag
 * varint → field number and wire type, then a payload the wire type sizes.
 * That is the whole grammar — deliberately. It is NOT a protobuf library: no
 * schema, no message types, no decoding of anything but the two shapes the
 * Anki import actually reads (a varint's value, a length-delimited payload's
 * bytes). Everything else is yielded as "a field was here" and skipped by
 * size, which is exactly what the wire format is designed to allow.
 *
 * Two consumers, both Anki's: the `media` manifest a modern `.apkg` carries
 * (`MediaEntries`, proto/anki/import_export.proto) and a schema-18 notetype's
 * `config` blob (`Notetype.Config`, proto/anki/notetypes.proto). Both are
 * read in `main`, but the walker lives HERE because it is pure and its every
 * refusal is provable against hand-built bytes — the same reasoning that put
 * `canonicalizeCloze` in this package.
 *
 * A GENERATOR rather than an array on purpose: a hostile message is bounded
 * only by the caller's byte caps, and a caller counting entries against a
 * limit must be able to stop at the limit rather than materialize millions of
 * fields first.
 */

/** A malformed wire — truncated varint, length past the end, a wire type nobody defined. The caller decides what refusal that is; this module only knows the bytes lie. */
export class ProtoWalkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtoWalkError";
  }
}

/** One field occurrence, exactly as the wire states it. Repeated occurrences are yielded in order — proto3's last-one-wins is the caller's rule to apply, not this walker's. */
export interface ProtoField {
  fieldNumber: number;
  /** 0 = varint, 1 = fixed 64-bit, 2 = length-delimited, 5 = fixed 32-bit. 3/4 (proto2's removed groups) and 6/7 (never defined) are refused, not yielded. */
  wireType: 0 | 1 | 2 | 5;
  /** The varint's value for wire type 0; 0 for every other. `2 ** shift` arithmetic rather than `<<`, because JavaScript's bitwise operators are 32-bit and protobuf's varints are 64. */
  value: number;
  /** The payload for wire type 2; empty for every other. A subarray of the input, never a copy. */
  bytes: Uint8Array;
}

const NO_BYTES = new Uint8Array(0);

/** One varint at `offset`: its value and the offset just past it. Ten bytes is the wire format's own ceiling for 64 bits — an eleventh continuation is malformed, not long. */
function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < bytes.length) {
    const byte = bytes[cursor] ?? 0;
    cursor += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: cursor };
    shift += 7;
    if (shift > 63) break;
  }
  throw new ProtoWalkError("The message holds a truncated or over-long varint.");
}

/** `next`, or a refusal — a payload that runs past the buffer is the classic malformed-protobuf read. */
function bounded(bytes: Uint8Array, next: number): number {
  if (next > bytes.length) {
    throw new ProtoWalkError("The message declares a payload past its own end.");
  }
  return next;
}

/** Walks one message's fields, in wire order, refusing every malformed shape by throwing rather than guessing past it. */
export function* walkProtoFields(bytes: Uint8Array): Generator<ProtoField, void, undefined> {
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    // Field 0 is reserved in every protobuf edition; a zero tag byte is the
    // signature of zeroed or misaligned data, not of a message.
    if (fieldNumber === 0) throw new ProtoWalkError("The message names field 0, which is reserved.");
    switch (wireType) {
      case 0: {
        const varint = readVarint(bytes, tag.next);
        yield { fieldNumber, wireType: 0, value: varint.value, bytes: NO_BYTES };
        offset = varint.next;
        break;
      }
      case 1:
      case 5: {
        offset = bounded(bytes, tag.next + (wireType === 1 ? 8 : 4));
        yield { fieldNumber, wireType: wireType === 1 ? 1 : 5, value: 0, bytes: NO_BYTES };
        break;
      }
      case 2: {
        const length = readVarint(bytes, tag.next);
        const end = bounded(bytes, length.next + length.value);
        yield { fieldNumber, wireType: 2, value: 0, bytes: bytes.subarray(length.next, end) };
        offset = end;
        break;
      }
      default:
        throw new ProtoWalkError(
          `The message uses wire type ${wireType}, which this walker does not accept.`,
        );
    }
  }
}

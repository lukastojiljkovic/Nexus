import { describe, expect, it } from "vitest";

import { ProtoWalkError, walkProtoFields } from "./protoWalk.js";

/**
 * Every buffer below is HAND-BUILT from protobuf's wire format (tag varint =
 * fieldNumber << 3 | wireType, then a payload the wire type sizes), so each
 * assertion states exactly which bytes mean what — no protobuf library is
 * involved on either side of the test.
 */

describe("walkProtoFields", () => {
  it("reads a varint field's number and value", () => {
    // Tag 0x08 = field 1, wire type 0; payload varint 42.
    expect([...walkProtoFields(Uint8Array.from([0x08, 0x2a]))]).toEqual([
      { fieldNumber: 1, wireType: 0, value: 42, bytes: Uint8Array.from([]) },
    ]);
  });

  it("reads a multi-byte varint little-endian, seven bits at a time", () => {
    // 300 = 0b100101100 → 0xac 0x02.
    const fields = [...walkProtoFields(Uint8Array.from([0x08, 0xac, 0x02]))];
    expect(fields[0]?.value).toBe(300);
  });

  it("reads a length-delimited field's payload", () => {
    // Tag 0x12 = field 2, wire type 2; length 3, then the three payload bytes.
    const fields = [...walkProtoFields(Uint8Array.from([0x12, 0x03, 0x61, 0x62, 0x63]))];
    expect(fields).toHaveLength(1);
    expect(fields[0]?.fieldNumber).toBe(2);
    expect(fields[0]?.wireType).toBe(2);
    expect(fields[0]?.bytes).toEqual(Uint8Array.from([0x61, 0x62, 0x63]));
  });

  it("walks past fixed64 and fixed32 payloads by size, without reading them", () => {
    const bytes = Uint8Array.from([
      0x19, 1, 2, 3, 4, 5, 6, 7, 8, // field 3, wire type 1: eight payload bytes
      0x25, 1, 2, 3, 4, //             field 4, wire type 5: four payload bytes
      0x08, 0x01, //                   field 1, varint 1 — proves the walk landed right
    ]);
    expect([...walkProtoFields(bytes)]).toEqual([
      { fieldNumber: 3, wireType: 1, value: 0, bytes: Uint8Array.from([]) },
      { fieldNumber: 4, wireType: 5, value: 0, bytes: Uint8Array.from([]) },
      { fieldNumber: 1, wireType: 0, value: 1, bytes: Uint8Array.from([]) },
    ]);
  });

  it("reads a field number past 15, whose tag needs two bytes", () => {
    // Field 16, wire type 0: tag 128 → varint 0x80 0x01.
    const fields = [...walkProtoFields(Uint8Array.from([0x80, 0x01, 0x07]))];
    expect(fields).toEqual([
      { fieldNumber: 16, wireType: 0, value: 7, bytes: Uint8Array.from([]) },
    ]);
  });

  it("yields every occurrence of a repeated field, in order, and decides nothing", () => {
    // Two field-1 varints: proto3's last-one-wins is the CALLER's rule to apply.
    const fields = [...walkProtoFields(Uint8Array.from([0x08, 0x01, 0x08, 0x00]))];
    expect(fields.map((field) => field.value)).toEqual([1, 0]);
  });

  it("reads an empty message as no fields", () => {
    expect([...walkProtoFields(new Uint8Array(0))]).toEqual([]);
  });

  it("refuses field number zero, which no message defines", () => {
    expect(() => [...walkProtoFields(Uint8Array.from([0x00]))]).toThrow(ProtoWalkError);
  });

  it("refuses a truncated varint", () => {
    // 0x80 sets the continuation bit and then the buffer ends.
    expect(() => [...walkProtoFields(Uint8Array.from([0x80]))]).toThrow(ProtoWalkError);
    // A tag that parsed, then a value that did not.
    expect(() => [...walkProtoFields(Uint8Array.from([0x08, 0x80]))]).toThrow(ProtoWalkError);
  });

  it("never loops on a varint that never terminates", () => {
    const forever = new Uint8Array(64).fill(0x80);
    expect(() => [...walkProtoFields(forever)]).toThrow(ProtoWalkError);
  });

  it("refuses a length that runs past the end", () => {
    expect(() => [...walkProtoFields(Uint8Array.from([0x0a, 200, 1, 2]))]).toThrow(ProtoWalkError);
  });

  it("refuses a fixed64 or fixed32 payload the buffer cannot hold", () => {
    expect(() => [...walkProtoFields(Uint8Array.from([0x19, 1, 2]))]).toThrow(ProtoWalkError);
    expect(() => [...walkProtoFields(Uint8Array.from([0x25, 1]))]).toThrow(ProtoWalkError);
  });

  it("refuses the removed group wire types and the undefined ones", () => {
    // Wire types 3 and 4 are proto2's removed groups; 6 and 7 were never defined.
    for (const tag of [0x0b, 0x0c, 0x0e, 0x0f]) {
      expect(() => [...walkProtoFields(Uint8Array.from([tag, 0x01]))]).toThrow(ProtoWalkError);
    }
  });
});

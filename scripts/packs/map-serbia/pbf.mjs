// The OSM PBF reader the map pack's builder needs, and nothing more of one.
//
// WHY IT IS WRITTEN RATHER THAN INSTALLED. A pack builder may use Node itself,
// what the repository already has, and the two root dev dependencies; none of
// them reads an `.osm.pbf`, and the maintained readers are either native
// modules or a Java tool. What the map needs from a 240 MB regional extract is
// one thing: the NODES that carry a `place` tag, with their coordinates and
// their tags. That is a few hundred lines of the protobuf wire format and
// nothing else, and it is testable against real files — the fixtures beside
// this file are three `.pbf` files written by Osmosis and osmium-tool, with the
// XML they were converted from sitting in the same upstream repository, which is
// what "an oracle" means here.
//
// WHAT IT DELIBERATELY DOES NOT DO. No ways, no relations, no changesets, no
// history, no lzma/bzip2/zstd blobs (the two formats osmium and Osmosis write by
// default are handled: raw and zlib, and anything else is refused by name rather
// than half-read). No streaming: the file is read whole, which is what the
// builder's 240 MB input costs in a build step that then spends minutes on
// tiles. And no id-based filtering: the caller decides what a node is for.

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/** One OSM node, as this builder uses it: an identity, a position, and its tags. */
export function node(id, lat, lon, tags) {
  return { id, lat, lon, tags };
}

/** The protobuf wire types this reader meets. */
const WIRE_VARINT = 0;
const WIRE_64 = 1;
const WIRE_BYTES = 2;
const WIRE_32 = 5;

/**
 * A cursor over one protobuf message.
 *
 * Protobuf's fields are (number, wire type) pairs, in ascending order in a
 * well-formed message and possibly missing entirely: a field that is absent has
 * its default value, which is why every reader below must supply one. Unknown
 * fields are SKIPPED by wire type rather than refused — that is the format's own
 * rule, and it is what lets a newer osmium add a field without breaking this.
 */
class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }

  get done() {
    return this.pos >= this.bytes.byteLength;
  }

  varint() {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.bytes[this.pos];
      if (byte === undefined) throw new Error("pbf: a varint ran past the end of its message.");
      this.pos += 1;
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
      if (shift > 63) throw new Error("pbf: a varint is longer than 64 bits.");
    }
  }

  /** A zigzag varint, which is how the format stores a signed number. */
  svarint() {
    const value = this.varint();
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  }

  /** An unsigned 32-bit little-endian word, for the fixed-width wire types. */
  fixed32() {
    const bytes = this.bytes;
    const at = this.pos;
    this.pos += 4;
    return (
      (bytes[at] ?? 0) + (bytes[at + 1] ?? 0) * 2 ** 8 + (bytes[at + 2] ?? 0) * 2 ** 16 + (bytes[at + 3] ?? 0) * 2 ** 24
    );
  }

  /**
   * The 4-byte BIG-endian word that frames a blob.
   *
   * Big-endian here and little-endian everywhere else in this file, which is not
   * a slip: the framing (the blob header's length and the blob's own datasize)
   * is written big-endian by the format's spec, while the protobuf fields inside
   * it are protobuf, and protobuf's fixed-width integers are little-endian.
   */
  fixed32be() {
    const bytes = this.bytes;
    const at = this.pos;
    this.pos += 4;
    return (
      (bytes[at] ?? 0) * 2 ** 24 + (bytes[at + 1] ?? 0) * 2 ** 16 + (bytes[at + 2] ?? 0) * 2 ** 8 + (bytes[at + 3] ?? 0)
    );
  }

  /** A length-delimited field's payload, as bytes. */
  bytesField() {
    const length = this.varint();
    const end = this.pos + length;
    if (end > this.bytes.byteLength) throw new Error("pbf: a field ran past the end of its message.");
    const slice = this.bytes.subarray(this.pos, end);
    this.pos = end;
    return slice;
  }

  /** A length-delimited field's payload, as text — the string table and UTF-8 tags. */
  textField() {
    return new TextDecoder("utf-8", { fatal: false }).decode(this.bytesField());
  }

  /** Field number and wire type of the next field. */
  tag() {
    const key = this.varint();
    return { field: key >> 3, wire: key & 0x7 };
  }

  skip(wire) {
    if (wire === WIRE_VARINT) this.varint();
    else if (wire === WIRE_64) this.pos += 8;
    else if (wire === WIRE_BYTES) this.bytesField();
    else if (wire === WIRE_32) this.pos += 4;
    else throw new Error(`pbf: unknown wire type ${String(wire)}.`);
  }
}

/** The numeric values of one packed field, in order (a repeated scalar may also arrive unpacked, one per tag). */
function packedNumbers(reader, wire, readOne) {
  if (wire === WIRE_BYTES) {
    const packed = new Reader(reader.bytesField());
    const values = [];
    while (!packed.done) values.push(readOne(packed));
    return values;
  }
  return [readOne(reader)];
}

/** The StringTable of one PrimitiveBlock: tag keys and values, by index. */
function readStringTable(bytes) {
  const reader = new Reader(bytes);
  const table = [];
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1 && wire === WIRE_BYTES) table.push(reader.textField());
    else reader.skip(wire);
  }
  return table;
}

/** One plain (non-dense) Node message. */
function readNode(bytes, visible) {
  const reader = new Reader(bytes);
  let id = 0;
  let lat = 0;
  let lon = 0;
  const keys = [];
  const vals = [];
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1) id = reader.svarint();
    else if (field === 2) keys.push(...packedNumbers(reader, wire, (r) => r.varint()));
    else if (field === 3) vals.push(...packedNumbers(reader, wire, (r) => r.varint()));
    else if (field === 8) lat = reader.svarint();
    else if (field === 9) lon = reader.svarint();
    else reader.skip(wire);
  }
  return { id, lat, lon, keys, vals, visible };
}

/**
 * One DenseNodes message: four parallel delta-encoded arrays, plus the tag list.
 *
 * `keys_vals` is one flat array for ALL the nodes in the group — a node's tags
 * run until a 0, which is why it is read as a list of (key, value) pairs and
 * then split. `denseinfo.visible` is a packed list of booleans, present only in
 * a history file; a node with `visible = false` was DELETED, and this reader
 * refuses to hand one to a caller as if it were a place.
 */
function readDenseNodes(bytes) {
  const reader = new Reader(bytes);
  const ids = [];
  const lats = [];
  const lons = [];
  const keysVals = [];
  let visible = null;
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1) ids.push(...packedNumbers(reader, wire, (r) => r.svarint()));
    else if (field === 8) lats.push(...packedNumbers(reader, wire, (r) => r.svarint()));
    else if (field === 9) lons.push(...packedNumbers(reader, wire, (r) => r.svarint()));
    else if (field === 10) keysVals.push(...packedNumbers(reader, wire, (r) => r.varint()));
    else if (field === 5 && wire === WIRE_BYTES) visible = readDenseInfoVisible(reader.bytesField());
    else reader.skip(wire);
  }
  const nodes = [];
  let id = 0;
  let lat = 0;
  let lon = 0;
  let at = 0;
  for (let index = 0; index < ids.length; index += 1) {
    id += ids[index] ?? 0;
    lat += lats[index] ?? 0;
    lon += lons[index] ?? 0;
    const keys = [];
    const vals = [];
    while (at < keysVals.length && keysVals[at] !== 0) {
      keys.push(keysVals[at] ?? 0);
      vals.push(keysVals[at + 1] ?? 0);
      at += 2;
    }
    at += 1; // the 0 that ends this node's tags
    nodes.push({
      id,
      lat,
      lon,
      keys,
      vals,
      visible: visible === null ? true : (visible[index] ?? true),
    });
  }
  return nodes;
}

/** The `visible` array inside a DenseInfo message. */
function readDenseInfoVisible(bytes) {
  const reader = new Reader(bytes);
  let visible = null;
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 6) visible = packedNumbers(reader, wire, (r) => r.varint() !== 0);
    else reader.skip(wire);
  }
  return visible;
}

/**
 * Every node of one PrimitiveBlock, as `{ id, lat, lon, tags }`.
 *
 * The block's own granularity and offsets are applied here, which is the one
 * piece of arithmetic the format leaves to the reader: a stored coordinate is an
 * integer count of `granularity` nanodegrees from `lat_offset`.
 */
function nodesOfBlock(bytes, onNode) {
  const reader = new Reader(bytes);
  let strings = [];
  let granularity = 100;
  let latOffset = 0;
  let lonOffset = 0;
  const groups = [];
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1 && wire === WIRE_BYTES) strings = readStringTable(reader.bytesField());
    else if (field === 2 && wire === WIRE_BYTES) groups.push(reader.bytesField());
    else if (field === 17) granularity = reader.varint();
    else if (field === 19) latOffset = reader.varint();
    else if (field === 20) lonOffset = reader.varint();
    else reader.skip(wire);
  }
  const at = (value, offset) => 1e-9 * (offset + granularity * value);
  const tags = (keys, vals) => {
    const out = {};
    for (let index = 0; index < keys.length; index += 1) {
      const key = strings[keys[index] ?? -1];
      const value = strings[vals[index] ?? -1];
      if (key !== undefined && value !== undefined) out[key] = value;
    }
    return out;
  };
  for (const group of groups) {
    const groupReader = new Reader(group);
    while (!groupReader.done) {
      const { field, wire } = groupReader.tag();
      if (field === 1 && wire === WIRE_BYTES) {
        const raw = readNode(groupReader.bytesField(), true);
        onNode(node(raw.id, at(raw.lat, latOffset), at(raw.lon, lonOffset), tags(raw.keys, raw.vals)));
      } else if (field === 2 && wire === WIRE_BYTES) {
        for (const raw of readDenseNodes(groupReader.bytesField())) {
          if (!raw.visible) continue;
          onNode(node(raw.id, at(raw.lat, latOffset), at(raw.lon, lonOffset), tags(raw.keys, raw.vals)));
        }
      } else groupReader.skip(wire);
    }
  }
}

/** One blob's payload, decompressed: raw or zlib, and anything else refused by name. */
function blobPayload(bytes) {
  const reader = new Reader(bytes);
  let raw = null;
  let zlib = null;
  let other = null;
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1 && wire === WIRE_BYTES) raw = reader.bytesField();
    else if (field === 3 && wire === WIRE_BYTES) zlib = reader.bytesField();
    else if (wire === WIRE_BYTES) {
      // Fields 4..6 are lzma, bzip2 and lz4; 7 is zstd. None of them is what
      // osmium or Osmosis writes by default, and refusing one by name is better
      // than inflating its bytes as if they were zlib.
      other = other ?? field;
      reader.skip(wire);
    } else reader.skip(wire);
  }
  if (raw !== null) return raw;
  if (zlib !== null) return new Uint8Array(inflateSync(zlib));
  if (other !== null) throw new Error(`pbf: blob compression ${String(other)} is not supported.`);
  throw new Error("pbf: a blob carries no payload.");
}

/**
 * Every node in one `.osm.pbf`, handed to `onNode` in file order.
 *
 * `onNode` is a callback rather than an array because a regional extract holds
 * millions of nodes and the caller keeps the handful with a `place` tag; the
 * array would be the whole file again, in objects.
 */
export function readOsmNodes(filePath, onNode) {
  const bytes = readFileSync(filePath);
  const file = new Reader(bytes);
  let blocks = 0;
  let nodes = 0;
  while (!file.done) {
    // The blob header's length is a big-endian 32-bit word; `datasize` inside
    // the header is a protobuf int32 and therefore little-endian.
    const headerLength = file.fixed32be();
    if (headerLength <= 0) break;
    const header = new Reader(file.bytes.subarray(file.pos, file.pos + headerLength));
    file.pos += headerLength;
    let type = "";
    let dataSize = 0;
    while (!header.done) {
      const { field, wire } = header.tag();
      if (field === 1 && wire === WIRE_BYTES) type = header.textField();
      else if (field === 3) dataSize = header.varint();
      else header.skip(wire);
    }
    const blob = file.bytes.subarray(file.pos, file.pos + dataSize);
    file.pos += dataSize;
    if (type !== "OSMData") continue;
    blocks += 1;
    nodesOfBlock(blobPayload(blob), (entry) => {
      nodes += 1;
      onNode(entry);
    });
  }
  return { blocks, nodes };
}

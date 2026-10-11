import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readOsmNodes } from "./pbf.mjs";

/**
 * The OSM PBF reader, against three REAL files.
 *
 * The fixtures are the ones `osmcode/libosmium` keeps for its own PBF tests —
 * 119, 136 and 189 bytes, written by Osmosis and osmium-tool — and each has its
 * oracle beside it in that repository: `data_pbf_version-1.osm` is the XML the
 * first was converted from
 * (`https://raw.githubusercontent.com/osmcode/libosmium/master/test/t/io/data_pbf_version-1.osm`,
 * read 2026-10-10, holding exactly `<node id="2" lat="50" lon="10.01"/>`), the
 * `-densenodes` file is the same node written in the dense encoding, and
 * `deleted_nodes.osh` is the XML with a deleted and a live node. libosmium is
 * licensed under the Boost Software License 1.0
 * (`https://raw.githubusercontent.com/osmcode/libosmium/master/LICENSE`, read
 * 2026-10-10: "Boost Software License - Version 1.0"), which permits this use;
 * `sources.json` records the three URLs and their digests.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function nodesOf(name) {
  const nodes = [];
  const counts = readOsmNodes(join(FIXTURES, name), (entry) => nodes.push(entry));
  return { nodes, counts };
}

describe("the OSM PBF reader", () => {
  it("reads the one node of a plain-node file, at the coordinates the XML states", () => {
    const { nodes, counts } = nodesOf("data_pbf_version-1.osm.pbf");
    expect(counts.nodes).toBe(1);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe(2);
    expect(nodes[0]?.lat).toBeCloseTo(50, 9);
    expect(nodes[0]?.lon).toBeCloseTo(10.01, 9);
    expect(nodes[0]?.tags).toEqual({});
  });

  it("reads the same node out of the dense encoding", () => {
    const { nodes } = nodesOf("data_pbf_version-1-densenodes.osm.pbf");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe(2);
    expect(nodes[0]?.lat).toBeCloseTo(50, 9);
    expect(nodes[0]?.lon).toBeCloseTo(10.01, 9);
  });

  it("skips a deleted node and reads the live one beside it", () => {
    // The oracle XML (`deleted_nodes.osh`) holds node 1 with visible="false" and
    // no coordinates, and node 2 with visible="true" lat="1" lon="1".
    const { nodes } = nodesOf("deleted_nodes.osh.pbf");
    expect(nodes.map((entry) => entry.id)).toEqual([2]);
    expect(nodes[0]?.lat).toBeCloseTo(1, 9);
    expect(nodes[0]?.lon).toBeCloseTo(1, 9);
  });

  it("hands every node to its caller and counts what it read", () => {
    const seen = [];
    const counts = readOsmNodes(join(FIXTURES, "data_pbf_version-1.osm.pbf"), (entry) => {
      seen.push(entry.id);
    });
    expect(seen).toEqual([2]);
    expect(counts).toEqual({ blocks: 1, nodes: 1 });
  });
});

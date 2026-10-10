import { describe, expect, it } from "vitest";

import { StlParseError, parseStl, stlIsClosed, STL_MAX_TRIANGLES } from "./stl.js";

/**
 * The STL reader, against the one fixture that can be checked by hand: a cube.
 *
 * A 10 mm cube has twelve triangles, a volume of 1000 mm cubed and a surface
 * area of 600 mm squared, and every one of those numbers is a school exercise
 * rather than an output somebody recorded. The cube is built here, in the test,
 * with its triangles wound so that each one's right-hand normal points out of
 * the solid - which is the case the volume sum is exact for.
 */

/** One face of a cube, as four vertices in anticlockwise order seen from outside. */
type Quad = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

/** The six faces of a cube from the origin, each wound outwards. */
function cubeQuads(size: number): readonly Quad[] {
  return [
    // -Z
    [
      [0, 0, 0],
      [0, size, 0],
      [size, size, 0],
      [size, 0, 0],
    ],
    // +Z
    [
      [0, 0, size],
      [size, 0, size],
      [size, size, size],
      [0, size, size],
    ],
    // -Y
    [
      [0, 0, 0],
      [size, 0, 0],
      [size, 0, size],
      [0, 0, size],
    ],
    // +Y
    [
      [0, size, 0],
      [0, size, size],
      [size, size, size],
      [size, size, 0],
    ],
    // -X
    [
      [0, 0, 0],
      [0, 0, size],
      [0, size, size],
      [0, size, 0],
    ],
    // +X
    [
      [size, 0, 0],
      [size, size, 0],
      [size, size, size],
      [size, 0, size],
    ],
  ];
}

/** The cube as the triangle list both flavours carry: two triangles per face. */
function cubeTriangles(size: number): number[][] {
  const triangles: number[][] = [];
  for (const [p0, p1, p2, p3] of cubeQuads(size)) {
    for (const [a, b, c] of [
      [p0, p1, p2],
      [p0, p2, p3],
    ] as const) {
      triangles.push([...a, ...b, ...c]);
    }
  }
  return triangles;
}

/** The same triangles as a binary STL: an 80-byte header, a count, then 50 bytes each. */
function binaryStl(triangles: readonly number[][], header = "nexus test cube"): Uint8Array {
  const bytes = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < header.length && index < 80; index += 1) {
    bytes[index] = header.charCodeAt(index);
  }
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, index) => {
    let offset = 84 + index * 50;
    view.setFloat32(offset, 0, true);
    view.setFloat32(offset + 4, 0, true);
    view.setFloat32(offset + 8, 0, true);
    offset += 12;
    for (const coordinate of triangle) {
      view.setFloat32(offset, coordinate, true);
      offset += 4;
    }
  });
  return bytes;
}

/** The same triangles as an ASCII STL, normals written as zero - the reader discards them on purpose. */
function asciiStl(triangles: readonly number[][], name = "cube"): string {
  const lines = [`solid ${name}`];
  for (const triangle of triangles) {
    lines.push("  facet normal 0 0 0", "    outer loop");
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const [x, y, z] = triangle.slice(vertex * 3, vertex * 3 + 3) as [number, number, number];
      lines.push(`      vertex ${x} ${y} ${z}`);
    }
    lines.push("    endloop", "  endfacet");
  }
  lines.push(`endsolid ${name}`);
  return `${lines.join("\n")}\n`;
}

const CUBE = cubeTriangles(10);

describe("parseStl", () => {
  it("reads a binary 10 mm cube: 12 triangles, 1000 cubic mm, 600 square mm, 10 mm bounds", () => {
    const mesh = parseStl(binaryStl(CUBE));

    expect(mesh.format).toBe("binary");
    expect(mesh.name).toBe("nexus test cube");
    expect(mesh.triangleCount).toBe(12);
    // A 10 x 10 x 10 cube: 10 cubed = 1000, and six faces of 100 = 600.
    expect(mesh.volume).toBe(1000);
    expect(mesh.area).toBe(600);
    expect(mesh.bounds.min).toEqual([0, 0, 0]);
    expect(mesh.bounds.max).toEqual([10, 10, 10]);
    expect(mesh.bounds.size).toEqual([10, 10, 10]);
    // Twelve triangles, nine floats each, and the first one is the -Z face's
    // first triangle as the fixture wrote it.
    expect(mesh.positions.length).toBe(108);
    expect(Array.from(mesh.positions.slice(0, 9))).toEqual([0, 0, 0, 0, 10, 0, 10, 10, 0]);
  });

  it("reads the same cube written as ASCII, with the same three numbers", () => {
    const mesh = parseStl(new TextEncoder().encode(asciiStl(CUBE, "kocka")));

    expect(mesh.format).toBe("ascii");
    expect(mesh.name).toBe("kocka");
    expect(mesh.triangleCount).toBe(12);
    expect(mesh.volume).toBe(1000);
    expect(mesh.area).toBe(600);
    expect(mesh.bounds.size).toEqual([10, 10, 10]);
  });

  it("tells the two flavours apart by the exact binary length, not by the `solid` header", () => {
    // The binary header of this fixture starts with "solid" - a real and common
    // exporter habit - and the file must still be read as binary.
    const mesh = parseStl(binaryStl(CUBE, "solid from an exporter"));
    expect(mesh.format).toBe("binary");
    expect(mesh.triangleCount).toBe(12);
  });

  it("reports the mesh as closed, and an open one as not", () => {
    expect(stlIsClosed(parseStl(binaryStl(CUBE)))).toBe(true);
    // The same cube with one triangle removed is still parseable - and its
    // volume is not a volume any more, which is what the page says.
    expect(stlIsClosed(parseStl(binaryStl(CUBE.slice(1))))).toBe(false);
  });

  it("scales the two figures with the cube's own size rather than with a constant", () => {
    // A 25 mm cube: 25 cubed = 15 625, six faces of 625 = 3750.
    const mesh = parseStl(binaryStl(cubeTriangles(25)));
    expect(mesh.volume).toBe(15_625);
    expect(mesh.area).toBe(3750);
  });

  it("refuses the files it cannot read, each with its own problem code", () => {
    const refusals: readonly [Uint8Array | string, string][] = [
      [new Uint8Array(0), "empty"],
      ["this is a picture of a cube, promise", "not-stl"],
      ["solid empty\nendsolid empty\n", "not-stl"],
      ["solid broken\nfacet normal 0 0 0\nouter loop\nvertex 0 0 0\nendloop\nendfacet\nendsolid broken\n", "not-stl"],
      ["solid half\nfacet normal 0 0 0\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 2 0 0\nvertex 0 0 1\nendloop\nendfacet\nendsolid half\n", "not-stl"],
      ["solid nan\nfacet normal 0 0 0\nouter loop\nvertex 0 0 nan\nvertex 1 0 0\nvertex 2 0 0\nendloop\nendfacet\nendsolid nan\n", "not-finite"],
    ];
    for (const [input, problem] of refusals) {
      const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
      try {
        parseStl(bytes);
        throw new Error(`Expected a ${problem} refusal.`);
      } catch (error) {
        expect(error, problem).toBeInstanceOf(StlParseError);
        expect((error as StlParseError).problem, problem).toBe(problem);
      }
    }
  });

  it("refuses a binary file whose count does not match its length", () => {
    const bytes = binaryStl(CUBE).slice(0, 84 + 11 * 50);
    // Truncated, so the count no longer fits: the ASCII fallback then finds no
    // `solid` header either, and the refusal is the honest one.
    expect(() => parseStl(bytes)).toThrow(StlParseError);
    // A header that claims a number too large to be real is the same answer: the
    // exact-length rule is what decides, so a count with no bytes behind it is
    // not a binary file at all.
    const bloated = binaryStl(CUBE);
    new DataView(bloated.buffer).setUint32(80, STL_MAX_TRIANGLES + 1, true);
    expect(() => parseStl(bloated)).toThrow(/no triangles|No `solid` header/);
  });

  it("refuses a coordinate that is not a finite number in binary as well", () => {
    const bytes = binaryStl(CUBE);
    new DataView(bytes.buffer).setFloat32(84 + 12, Number.POSITIVE_INFINITY, true);
    try {
      parseStl(bytes);
      throw new Error("Expected a refusal.");
    } catch (error) {
      expect((error as StlParseError).problem).toBe("not-finite");
    }
  });
});

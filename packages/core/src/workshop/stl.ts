/**
 * STL, both flavours, read from untrusted bytes (ADR-090's viewer module).
 *
 * **Why this is in `@nexus/core` and not in the page.** The file arrives from
 * somewhere the product did not write it, so the parse is the security boundary
 * and the arithmetic that decides what the user is told. Putting it here means
 * one implementation is reachable from the Web Worker that runs it, from the
 * tests that pin its numbers, and from nothing else - and it keeps the renderer
 * free of a second, drifting copy.
 *
 * **Two flavours, one shape.** A binary STL is a count and 50 bytes a triangle;
 * an ASCII one is the same triangles as text. Which one a file is CANNOT be
 * decided by its first five bytes: `solid` opens both, because the binary
 * format's 80-byte header is free text and half the exporters in the world
 * write a sentence there. So the binary layout is tested first, exactly
 * (`84 + 50 x count === length`, the only rule that cannot be satisfied by
 * accident), and the ASCII grammar is the fallback.
 *
 * **The three numbers the page shows, and how exact each one is.**
 *
 *  - the BOUNDING BOX is exact: the extremes of the vertices it read;
 *  - the SURFACE AREA is exact for any mesh: the sum of the triangles' areas,
 *    whether or not the mesh is closed;
 *  - the VOLUME is the divergence-theorem sum over the triangles, and it is
 *    exact for a CLOSED mesh whose triangles are wound consistently (outward).
 *    For anything else it is still a number - but not a volume: an open mesh, a
 *    self-intersecting one, or one whose windings disagree can answer anything
 *    at all, so the page says which case it is rather than implying the figure
 *    is always right (`stlIsClosed` is the test the page uses).
 *
 * **Units.** STL carries no unit. Every number here is in the file's own units,
 * and the module's page reads them as millimetres, which is what the format's
 * own specification (and every slicer's import) assumes.
 *
 * **What is refused, and what it costs.** A file over `STL_MAX_BYTES` is
 * refused before a triangle is read, a header claiming more than
 * `STL_MAX_TRIANGLES` is refused before the array is allocated, and any
 * coordinate that is not a finite number is refused rather than rendered as
 * `NaN` geometry. The asymmetry is deliberate: `Infinity` in a coordinate is
 * never a model, and a viewer that silently dropped the triangle would be
 * showing a shape the file does not describe.
 */

/** Largest STL this module reads, in bytes (32 MiB: about 670 000 binary triangles). */
export const STL_MAX_BYTES = 32 * 1024 * 1024;

/** Largest triangle count this module accepts, whatever the file's own header claims. */
export const STL_MAX_TRIANGLES = 2_000_000;

/** Longest ASCII STL this module reads, in lines - the ASCII half's own bound on parsing work. */
export const STL_MAX_ASCII_LINES = 4_000_000;

/** Why an STL was refused. A code, so the page words it in the reader's language. */
export type StlProblem = "too-large" | "empty" | "not-stl" | "too-many-triangles" | "not-finite";

/** The refusal itself, carrying the code the UI maps onto its own copy. */
export class StlParseError extends Error {
  readonly problem: StlProblem;

  constructor(problem: StlProblem, message: string) {
    super(message);
    this.name = "StlParseError";
    this.problem = problem;
  }
}

/** The three axes' extremes, in the file's units. */
export interface StlBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly size: readonly [number, number, number];
}

/** One parsed model: the triangles as the renderer needs them, plus what the page reports. */
export interface StlMesh {
  readonly format: "binary" | "ascii";
  /** The binary header's sentence or the ASCII `solid` name, trimmed - often empty, never guessed at. */
  readonly name: string;
  readonly triangleCount: number;
  /** Nine floats a triangle (three vertices, xyz), the layout `THREE.BufferGeometry` takes. */
  readonly positions: Float32Array;
  readonly bounds: StlBounds;
  /** Cubic units of the file, exact for a closed, consistently wound mesh - see the header. */
  readonly volume: number;
  /** Square units of the file, exact for any mesh. */
  readonly area: number;
}

/**
 * Reads one STL, or throws `StlParseError`.
 *
 * The order of the checks is the order of their cost: size, then shape, then
 * arithmetic - so a malformed file is refused before anything is allocated for
 * it, and a valid one is read once.
 */
export function parseStl(bytes: Uint8Array): StlMesh {
  if (bytes.byteLength === 0) throw new StlParseError("empty", "The file is empty.");
  if (bytes.byteLength > STL_MAX_BYTES) {
    throw new StlParseError(
      "too-large",
      `The file is larger than ${STL_MAX_BYTES} bytes.`,
    );
  }

  const binary = binaryLayout(bytes);
  const triangles = binary === null ? readAsciiStl(bytes) : readBinaryStl(bytes, binary.count);
  if (triangles.length === 0) {
    throw new StlParseError("not-stl", "The file holds no triangles.");
  }
  assertFinite(triangles);

  const positions = new Float32Array(triangles.length * 9);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let volumeTimesSix = 0;
  let area = 0;

  for (let triangle = 0; triangle < triangles.length; triangle += 1) {
    const tri = triangles[triangle] as readonly number[];
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tri as [
      number, number, number, number, number, number, number, number, number,
    ];
    positions.set(tri, triangle * 9);

    minX = Math.min(minX, ax, bx, cx);
    minY = Math.min(minY, ay, by, cy);
    minZ = Math.min(minZ, az, bz, cz);
    maxX = Math.max(maxX, ax, bx, cx);
    maxY = Math.max(maxY, ay, by, cy);
    maxZ = Math.max(maxZ, az, bz, cz);

    // The two divergence-theorem sums, in one pass: the signed tetrahedron
    // volume against the ORIGIN (so it is translation-invariant only because the
    // closed sum of the boundary is) and the cross-product area.
    volumeTimesSix += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }

  return {
    format: binary === null ? "ascii" : "binary",
    name: binary === null ? asciiName(bytes) : binaryName(bytes),
    triangleCount: triangles.length,
    positions,
    bounds: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
    },
    volume: volumeTimesSix / 6,
    area,
  };
}

/**
 * Whether the mesh is closed, as far as a viewer can honestly tell.
 *
 * **This is a test of the winding, not of the geometry.** Every edge of a
 * consistently wound closed surface is travelled once in each direction, so an
 * edge whose two directions do not cancel belongs to an open or an
 * inconsistently wound mesh - which is exactly the case in which the volume
 * above stops being a volume. The check is O(triangles) and allocates one entry
 * per directed edge, so the page calls it once, on load, and prints the caveat
 * rather than the figure when it answers `false`.
 *
 * Coordinates are keyed at a micrometre (`EDGE_KEY_DECIMALS`), because two
 * vertices that a file wrote as the same point in a different float spelling
 * are the same vertex.
 */
export function stlIsClosed(mesh: StlMesh): boolean {
  const pending = new Set<string>();
  const positions = mesh.positions;
  for (let triangle = 0; triangle < mesh.triangleCount; triangle += 1) {
    const base = triangle * 9;
    const keys: string[] = [];
    for (let vertex = 0; vertex < 3; vertex += 1) {
      keys.push(
        `${quantise(positions[base + vertex * 3] as number)}|${quantise(
          positions[base + vertex * 3 + 1] as number,
        )}|${quantise(positions[base + vertex * 3 + 2] as number)}`,
      );
    }
    const a = keys[0] as string;
    const b = keys[1] as string;
    const c = keys[2] as string;
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as readonly [string, string][]) {
      if (from === to) continue;
      const opposite = `${to}>${from}`;
      if (pending.has(opposite)) pending.delete(opposite);
      else pending.add(`${from}>${to}`);
    }
  }
  return pending.size === 0;
}

/** The digits one coordinate is stored at for the edge test - one micrometre, the resolution every slicer prints at. */
function quantise(value: number): string {
  return value.toFixed(3);
}

/**
 * The binary layout, or `null` when the bytes are not one.
 *
 * **The exact-length rule IS the detection, and it is also the bound.** A text
 * file's 81st byte spells some arbitrary number - this fixture's own ASCII half
 * reads as 808 million triangles - so a count alone decides nothing. What
 * decides it is that the file is exactly `84 + 50 x count` bytes long: only a
 * real binary file satisfies that, and a file that satisfies it cannot claim
 * more triangles than it has room for. `STL_MAX_BYTES` therefore bounds the
 * binary count structurally, and `STL_MAX_TRIANGLES` is what bounds the ASCII
 * half, where a count is not what a file states but what a parser accumulates.
 */
function binaryLayout(bytes: Uint8Array): { count: number } | null {
  if (bytes.byteLength < 84) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (count === 0) return null;
  return 84 + count * 50 === bytes.byteLength ? { count } : null;
}

/** The 80-byte header's sentence, as text: printable ASCII only, because that is all the field promises. */
function binaryName(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < 80; index += 1) {
    const byte = bytes[index] as number;
    if (byte === 0) break;
    text += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : " ";
  }
  return text.trim();
}

function readBinaryStl(bytes: Uint8Array, count: number): number[][] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles: number[][] = new Array(count);
  for (let index = 0; index < count; index += 1) {
    // The normal at +0 is read and DISCARDED on purpose: exporters get it wrong
    // often enough that the winding, not the stored normal, is what a viewer
    // should believe, and there is exactly one winding in the file.
    const base = 84 + index * 50 + 12;
    const tri: number[] = new Array(9);
    for (let component = 0; component < 9; component += 1) {
      tri[component] = view.getFloat32(base + component * 4, true);
    }
    triangles[index] = tri;
  }
  return triangles;
}

/** The `solid` line's name, without the keyword. */
function asciiName(bytes: Uint8Array): string {
  const firstLine = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.byteLength, 256)))
    .split(/\r?\n/, 1)[0] ?? "";
  return firstLine.replace(/^\s*solid\s*/i, "").trim();
}

/**
 * The ASCII grammar, read for its `vertex` lines.
 *
 * A grammar this loose would accept too much on its own - a prose file with
 * three numbers in it would become a triangle - so the structural keywords are
 * checked too: `solid` first, an `endsolid` somewhere, and exactly three
 * `vertex` lines per `facet`. That is the whole of the format's necessary shape,
 * and it refuses a file that only looks like numbers.
 */
function readAsciiStl(bytes: Uint8Array): number[][] {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const lines = text.split(/\r?\n/);
  if (lines.length > STL_MAX_ASCII_LINES) {
    throw new StlParseError(
      "too-large",
      `The file has more than ${STL_MAX_ASCII_LINES} lines.`,
    );
  }

  const head = (lines[0] ?? "").trim();
  if (!/^solid\b/i.test(head)) throw new StlParseError("not-stl", "No `solid` header.");
  if (!/\bendsolid\b/i.test(text)) throw new StlParseError("not-stl", "No `endsolid`.");

  const triangles: number[][] = [];
  let vertices: number[] = [];
  let facets = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^facet\b/i.test(trimmed)) {
      facets += 1;
      vertices = [];
      continue;
    }
    if (!/^vertex\b/i.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) throw new StlParseError("not-stl", "A `vertex` line is short.");
    const point = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    if (point.some((value) => !Number.isFinite(value))) {
      throw new StlParseError("not-finite", `A vertex is not a finite number: ${trimmed}`);
    }
    vertices.push(...point);
    if (vertices.length === 9) {
      triangles.push(vertices);
      vertices = [];
      if (triangles.length > STL_MAX_TRIANGLES) {
        throw new StlParseError(
          "too-many-triangles",
          `The file holds more than ${STL_MAX_TRIANGLES} triangles.`,
        );
      }
    }
  }
  if (vertices.length !== 0) {
    throw new StlParseError("not-stl", "A facet does not hold exactly three vertices.");
  }
  if (facets !== triangles.length) {
    throw new StlParseError(
      "not-stl",
      `${facets} facets hold ${triangles.length} triangles' worth of vertices.`,
    );
  }
  return triangles;
}

/** Every coordinate a finite number, checked once for the whole file. */
function assertFinite(triangles: readonly number[][]): void {
  for (const triangle of triangles) {
    for (const value of triangle) {
      if (!Number.isFinite(value)) {
        throw new StlParseError("not-finite", "The file holds a coordinate that is not a number.");
      }
    }
  }
}

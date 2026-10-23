// No shebang — this module is both a CLI and an import target for its own test.
//
// Builds the world outline the map picker draws: every territory in Natural
// Earth's 1:50m admin-0 countries, reduced to the fields the picker reads and to
// a size an app can ship.
//
//   node scripts/maps/world-outline.mjs
//
// It downloads the source once into `%TEMP%\nexus-pack-cache\world-outline\`
// (a present file is reused, and its SHA-256 is printed every run) and writes
// `apps/desktop/src/modules/maps/shared/world/outline.json`. The README beside
// that file records the source, its licence and this command.
//
// The same polygons decide which map tiles a region's download contains, so the
// outline keeps what the source says exactly: the simplification only drops a
// vertex that lies within the tolerance of the line through its neighbours, and
// the endpoints of every ring always survive. Simplification is plain
// Douglas–Peucker, written here so the build needs no dependency.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { writeCacheFile } from "../packs/lib/cacheWrite.mjs";
import { readIfPresent } from "../packs/lib/readIfPresent.mjs";

export const SOURCE_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson";

const CACHE_DIR = join(tmpdir(), "nexus-pack-cache", "world-outline");
const SOURCE_FILE = join(CACHE_DIR, "ne_50m_admin_0_countries.geojson");
const OUTPUT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../apps/desktop/src/modules/maps/shared/world/outline.json",
);

/**
 * Douglas–Peucker tolerance, in degrees (about 1.1 km at the equator). The
 * finest value swept that stays under the size ceiling, measured on the 1:50m
 * source: 0.01 gives 1 245 894 bytes and 72 310 positions, from 99 613 in the
 * source; 0.005 gave 1 523 106 bytes, over the ceiling. The sweep is in the README.
 */
export const SIMPLIFY_TOLERANCE = 0.01;
/**
 * Decimal places kept on every coordinate. Three is about 110 m at the equator,
 * and the sweep gave 1 245 894 bytes at three against 1 391 558 at four.
 */
export const COORDINATE_DECIMALS = 3;
/** The shipped file's ceiling, in bytes. The build refuses to write a larger one. */
export const MAX_OUTLINE_BYTES = 1_500_000;

const round = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const roundRing = (ring, decimals) => ring.map(([x, y]) => [round(x, decimals), round(y, decimals)]);

const sameAs = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Distance from a point to a segment; a degenerate segment is its single point. */
function distanceToSegment([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - ax, y - ay);
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/**
 * Douglas–Peucker over a closed ring. The ring's first and last positions are
 * the same point, so the first split is the vertex farthest from it, and the
 * recursion then works on proper segments. Iterative, so a long coastline cannot
 * exhaust the call stack.
 */
export function simplifyRing(ring, tolerance) {
  const keep = new Array(ring.length).fill(false);
  keep[0] = true;
  keep[ring.length - 1] = true;
  const pending = [[0, ring.length - 1]];
  while (pending.length > 0) {
    const [start, end] = pending.pop();
    let farthest = -1;
    let farthestDistance = 0;
    for (let i = start + 1; i < end; i++) {
      const distance = distanceToSegment(ring[i], ring[start], ring[end]);
      if (distance > farthestDistance) {
        farthest = i;
        farthestDistance = distance;
      }
    }
    if (farthest !== -1 && farthestDistance > tolerance) {
      keep[farthest] = true;
      pending.push([start, farthest], [farthest, end]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

/**
 * A closed ring with no repeated neighbour and at least three distinct corners,
 * or `null` when it has fewer than four positions once closed. Rounding can make
 * two neighbours equal, and a collapsed ring is not a shape.
 */
function tidy(ring) {
  const distinct = [];
  for (const point of ring.slice(0, -1)) {
    if (distinct.length === 0 || !sameAs(point, distinct[distinct.length - 1])) distinct.push(point);
  }
  while (distinct.length > 1 && sameAs(distinct[distinct.length - 1], distinct[0])) distinct.pop();
  return distinct.length < 3 ? null : [...distinct, distinct[0]];
}

/** The shoelace area of a closed ring, used only to pick a feature's largest ring. */
function area(ring) {
  let twice = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    twice += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(twice) / 2;
}

/**
 * Simplifies one geometry. A ring that collapses is dropped, and a polygon whose
 * exterior collapses goes with its holes. A feature never loses every ring: if
 * all its exteriors collapse, its largest exterior is kept unsimplified, so a
 * small territory stays on the map.
 */
function outlineGeometry(geometry, tolerance, decimals) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const kept = polygons
    .map((rings) => rings.map((ring) => tidy(roundRing(simplifyRing(ring, tolerance), decimals))))
    .filter((rings) => rings[0] !== null)
    .map((rings) => rings.filter((ring) => ring !== null));

  const polygonsOut =
    kept.length > 0
      ? kept
      : [[tidy(roundRing(largestExterior(polygons), decimals))]];
  if (polygonsOut[0][0] === null) throw new Error("world-outline: a feature has no ring left after rounding.");

  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: polygonsOut[0] }
    : { type: "MultiPolygon", coordinates: polygonsOut };
}

function largestExterior(polygons) {
  let best = polygons[0][0];
  for (const rings of polygons) {
    if (area(rings[0]) > area(best)) best = rings[0];
  }
  return best;
}

/** The Natural Earth placeholder for a missing code, as the picker expects it. */
const codeOrNull = (value) => (value === "-99" ? null : value);

/**
 * The outline of a Natural Earth FeatureCollection: one feature per record, the
 * record's ADM0_A3 as its id, and exactly the five properties the picker reads.
 */
export function buildOutline(collection, { tolerance = SIMPLIFY_TOLERANCE, decimals = COORDINATE_DECIMALS } = {}) {
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => {
      const properties = feature.properties;
      return {
        type: "Feature",
        id: properties.ADM0_A3,
        properties: {
          iso2: codeOrNull(properties.ISO_A2_EH),
          iso3: codeOrNull(properties.ISO_A3_EH),
          name: properties.NAME_EN,
          continent: properties.CONTINENT,
          label: [round(properties.LABEL_X, decimals), round(properties.LABEL_Y, decimals)],
        },
        geometry: outlineGeometry(feature.geometry, tolerance, decimals),
      };
    }),
  };
}

function countVertices(outline) {
  return outline.features.reduce((total, feature) => {
    const polygons =
      feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    return total + polygons.reduce((sum, rings) => sum + rings.reduce((s, ring) => s + ring.length, 0), 0);
  }, 0);
}

async function readSource() {
  const cached = readIfPresent(SOURCE_FILE);
  if (cached !== null) return cached;
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`world-outline: ${SOURCE_URL} answered ${String(response.status)}.`);
  const source = Buffer.from(await response.arrayBuffer());
  mkdirSync(CACHE_DIR, { recursive: true });
  writeCacheFile(SOURCE_FILE, source);
  return source;
}

async function main() {
  const source = await readSource();
  const sha256 = createHash("sha256").update(source).digest("hex");
  const outline = buildOutline(JSON.parse(source.toString("utf8")));
  const text = `${JSON.stringify(outline)}\n`;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_OUTLINE_BYTES) {
    throw new Error(`world-outline: ${String(bytes)} bytes is over the ${String(MAX_OUTLINE_BYTES)} byte ceiling.`);
  }
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, text);
  // Counts, sizes and a hash, never a coordinate.
  console.log(`world-outline: source ${SOURCE_FILE} (${String(source.byteLength)} bytes, sha256 ${sha256})`);
  console.log(
    `world-outline: ${OUTPUT_FILE} written (${String(outline.features.length)} features, ${String(countVertices(outline))} positions, ${String(bytes)} bytes)`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

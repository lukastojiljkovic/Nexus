// No shebang, for the reason every gate in `scripts/` has none: this module is
// both a CLI and an import target for its own test, and Vite does not strip a
// shebang from an `.mjs` it transforms.
//
// `planet-textures` — a `dataset` pack of equirectangular maps for the bodies of
// `@nexus/core`'s solar-system contract, one per body that has a source with
// licence evidence, plus Earth's night lights and Saturn's ring strip.
//
//   node scripts/packs/planet-textures/build.mjs            # build the pack
//   node scripts/packs/planet-textures/build.mjs --fixtures # re-cut the test fixtures
//
// WHAT IT DOES. Downloads every source named by `sources.json` into
// `%TEMP%\nexus-pack-cache\planet-textures\`, verifies each download against the
// SHA-256 that file records, re-encodes it as WebP at the pack's cap, and writes
// the pack folder to `%TEMP%\nexus-packs\planet-textures\` — the images plus
// `textures.json`, the layout the view reads — with the metadata `pack-sign.mjs`
// takes written BESIDE the folder, never inside it (a metadata file inside would
// be hashed into the manifest as content). Re-running reuses the cache; a cached
// file whose digest no longer matches the evidence is discarded and downloaded
// again rather than trusted.
//
// THE HASH IS THE POINT. A texture pack is somebody else's bytes. `sources.json`
// records, per source, the URL, the date it was read, the size it had then, its
// SHA-256, its licence and the exact sentence that licence was read from. A run
// that finds different bytes refuses rather than quietly shipping them: the
// maintainer updates the evidence on purpose, or the pack does not get built.
//
// THE CAPS. Every equirectangular map is at most 2048 × 1024 WebP, which is half
// the 4096 × 2048 the brief allows and roughly a megabyte for the whole pack
// rather than four; the ring strip keeps its own 2048 × 125 because it is not a
// map. Nothing is ever enlarged: a source that is already smaller is left at its
// own size (`withoutEnlargement`), so the pack cannot claim detail the source
// never had.
//
// WHAT THE PACK IS LICENSED AS, since it mixes two. Ten of the twelve images are
// Solar System Scope's, CC BY 4.0, used with the attribution their licence
// requires — and the brief allows exactly this "where NASA has none": the NASA
// and USGS global mosaics of the other bodies are public domain but ship as
// multi-hundred-megabyte to multi-gigabyte simple-cylindrical GeoTIFFs, which a
// reproducible builder that runs in minutes cannot reasonably fetch. Two images
// are NASA's own, small and directly downloadable: the Blue Marble day map and
// the Black Marble night map. The manifest therefore declares CC BY 4.0 — the
// stricter of the two — and `textures.json` carries each body's own credit.
//
// The source list is closed on purpose. A body the pack does not name (Pluto) is
// drawn by the view as a neutral sphere with its name, which the brief says must
// be what happens when there is no texture; leaving it out of the pack is the
// honest form of that, not a hole in the manifest.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
export const PACK_ID = "planet-textures";
const SOURCES_FILE = join(HERE, "sources.json");
const FIXTURES_DIR = join(HERE, "fixtures");

/** The only `sources.json` layout this builder reads. */
export const SOURCES_LAYOUT = 1;

/** The view's own body order, repeated here because a Node script cannot import the module's `.ts`. */
export const BODY_ORDER = [
  "sun",
  "mercury",
  "venus",
  "earth",
  "moon",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
];

/** An equirectangular map is 2:1, so one cap pair covers both in either layout. */
export const MAP_MAX_WIDTH = 2048;
export const MAP_MAX_HEIGHT = 1024;
/** Saturn's ring strip: 2048 × 125 in the source, and nothing about it is enlarged. */
export const RING_MAX_WIDTH = 2048;
export const RING_MAX_HEIGHT = 128;
export const WEBP_QUALITY = 88;
/** Transparent ring pixels stay transparent: alpha is not a photograph's noise. */
export const WEBP_ALPHA_QUALITY = 100;

/**
 * Which source becomes which image of which body. `slot` is the layout's own
 * field name (`day`, `night`, `rings`), and the file names are the layout's
 * paths under `images/`.
 *
 * Pluto is absent: no NASA, USGS or Solar System Scope equirectangular map of it
 * was found with a stable URL and a stated licence inside this run's budget, and
 * a body this pack does not name is drawn as a neutral sphere rather than
 * guessed at.
 */
export const PLAN = [
  { body: "sun", slot: "day", file: "sun-day.webp", source: "sun" },
  { body: "mercury", slot: "day", file: "mercury-day.webp", source: "mercury" },
  { body: "venus", slot: "day", file: "venus-day.webp", source: "venus" },
  { body: "earth", slot: "day", file: "earth-day.webp", source: "earth-day" },
  { body: "earth", slot: "night", file: "earth-night.webp", source: "earth-night" },
  { body: "moon", slot: "day", file: "moon-day.webp", source: "moon" },
  { body: "mars", slot: "day", file: "mars-day.webp", source: "mars" },
  { body: "jupiter", slot: "day", file: "jupiter-day.webp", source: "jupiter" },
  { body: "saturn", slot: "day", file: "saturn-day.webp", source: "saturn" },
  { body: "saturn", slot: "rings", file: "saturn-rings.webp", source: "saturn-rings" },
  { body: "uranus", slot: "day", file: "uranus-day.webp", source: "uranus" },
  { body: "neptune", slot: "day", file: "neptune-day.webp", source: "neptune" },
];

/**
 * The three fixtures the converter's test is written against; see `--fixtures`.
 *
 * Each box is a real region of a real source, and each was chosen for what it
 * proves: two plain JPEGs (a planetary surface and the night-lights map), and one
 * piece of the ring strip that STRADDLES the edge of the B ring and the Cassini
 * division, so it carries both fully opaque and fully transparent pixels and the
 * test can tell whether alpha survived the conversion.
 */
const FIXTURES = [
  { source: "mars", file: "mars-crop.jpg", left: 0, top: 0, width: 128, height: 64 },
  { source: "earth-night", file: "black-marble-crop.jpg", left: 0, top: 0, width: 128, height: 64 },
  { source: "saturn-rings", file: "saturn-rings-crop.png", left: 1280, top: 30, width: 128, height: 64 },
];

/** The SHA-256 of a buffer, as lowercase hex. */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * `sources.json`, checked. Throws with the offending field named, because a
 * refusal a maintainer cannot act on is a refusal they will work around.
 */
export function assertSources(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("planet-textures: sources.json must be an object.");
  }
  if (parsed.layout !== SOURCES_LAYOUT) {
    throw new Error(
      `planet-textures: sources.json layout must be ${String(SOURCES_LAYOUT)}, not ${String(parsed.layout)}.`,
    );
  }
  if (typeof parsed.fetched !== "string" || parsed.fetched.length === 0) {
    throw new Error("planet-textures: sources.json needs the date its sources were read.");
  }
  if (!Array.isArray(parsed.sources) || parsed.sources.length === 0) {
    throw new Error("planet-textures: sources.json holds no sources.");
  }
  const byId = new Map();
  for (const source of parsed.sources) {
    for (const field of ["id", "url", "sha256", "licence", "credit"]) {
      if (typeof source?.[field] !== "string" || source[field].length === 0) {
        throw new Error(`planet-textures: a source is missing "${field}".`);
      }
    }
    if (!/^[0-9a-f]{64}$/.test(source.sha256)) {
      throw new Error(`planet-textures: "${source.id}" has no SHA-256.`);
    }
    if (!Number.isInteger(source.bytes) || source.bytes <= 0) {
      throw new Error(`planet-textures: "${source.id}" has no byte count.`);
    }
    if (byId.has(source.id)) {
      throw new Error(`planet-textures: "${source.id}" is listed twice.`);
    }
    // The licence EVIDENCE, which is the rule the pack brief is strictest about:
    // a source whose licence cannot be read somewhere quotable is not used.
    const evidence = source.evidence;
    if (typeof evidence?.url !== "string" || typeof evidence?.quote !== "string") {
      throw new Error(`planet-textures: "${source.id}" has no licence evidence.`);
    }
    if (!evidence.url.startsWith("https://") || evidence.quote.trim().length === 0) {
      throw new Error(`planet-textures: "${source.id}" has empty licence evidence.`);
    }
    byId.set(source.id, source);
  }
  for (const target of PLAN) {
    if (!byId.has(target.source)) {
      throw new Error(`planet-textures: the plan wants the source "${target.source}", which is not listed.`);
    }
  }
  // A source nobody's plan names is a download nobody would ever see, and the
  // evidence written for it would be evidence for nothing.
  for (const source of byId.values()) {
    if (!PLAN.some((target) => target.source === source.id)) {
      throw new Error(`planet-textures: "${source.id}" is listed but no image is built from it.`);
    }
  }
  return { fetched: parsed.fetched, byId };
}

/** Where a source's bytes live in the cache. The extension is kept so sharp knows what it reads. */
export function cacheFile(cacheDir, source) {
  return join(cacheDir, `${source.id}${source.url.slice(source.url.lastIndexOf("."))}`);
}

/**
 * One source's bytes, from the cache or the network, verified either way.
 *
 * The cache is not trusted: a cached file whose digest disagrees with
 * `sources.json` is treated as absent. A download that disagrees is a refusal,
 * and the message carries the digest that was found, because the two legitimate
 * answers — the source really changed, or a proxy is serving something else —
 * are told apart by exactly that number.
 */
export async function fetchSource(source, options) {
  const file = cacheFile(options.cacheDir, source);
  let bytes = existsSync(file) ? readFileSync(file) : null;
  if (bytes !== null && (sha256(bytes) !== source.sha256 || bytes.byteLength !== source.bytes)) {
    bytes = null;
  }
  let fetched = false;
  if (bytes === null) {
    const response = await options.fetchImpl(source.url, {
      headers: { "user-agent": "nexus-pack-builder" },
    });
    if (response.ok !== true) {
      throw new Error(`planet-textures: ${source.url} answered ${String(response.status)}.`);
    }
    bytes = Buffer.from(await response.arrayBuffer());
    fetched = true;
  }
  const digest = sha256(bytes);
  if (digest !== source.sha256 || bytes.byteLength !== source.bytes) {
    throw new Error(
      `planet-textures: "${source.id}" is ${String(bytes.byteLength)} bytes / ${digest}, and sources.json records ` +
        `${String(source.bytes)} bytes / ${source.sha256}. Update the evidence deliberately, or do not build this pack.`,
    );
  }
  if (fetched) {
    mkdirSync(options.cacheDir, { recursive: true });
    writeFileSync(file, bytes);
  }
  return { bytes, fetched };
}

/**
 * One image, re-encoded. `fit: "inside"` keeps the aspect ratio and
 * `withoutEnlargement` keeps a small source small; the returned width and height
 * are the encoder's own answer, never the numbers asked for.
 */
export async function convertToWebp(bytes, limits) {
  const { data, info } = await sharp(bytes)
    .resize({
      width: limits.maxWidth,
      height: limits.maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY, alphaQuality: WEBP_ALPHA_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, format: info.format, hasAlpha: info.channels === 4 };
}

/** The limits a target's slot is encoded with. */
export function limitsFor(slot) {
  return slot === "rings"
    ? { maxWidth: RING_MAX_WIDTH, maxHeight: RING_MAX_HEIGHT }
    : { maxWidth: MAP_MAX_WIDTH, maxHeight: MAP_MAX_HEIGHT };
}

/**
 * `textures.json`: the pack's own layout, in the view's body order, with only
 * the bodies that have an image and only the fields those images fill.
 */
export function buildTexturesJson(images, sources) {
  const bodies = {};
  for (const id of BODY_ORDER) {
    const forBody = images.filter((image) => image.body === id);
    if (forBody.length === 0) continue;
    const entry = {};
    for (const image of forBody) entry[image.slot] = `images/${image.file}`;
    // One credit per body: the images of a body all come from the same source in
    // this pack, and the layout carries one credit line per body.
    const first = forBody[0];
    const source = sources.get(first.source);
    if (source === undefined) throw new Error(`planet-textures: no source named "${first.source}".`);
    entry.credit = source.credit;
    bodies[id] = entry;
  }
  return { layout: 1, bodies };
}

/**
 * The metadata `pack-sign.mjs` takes. `files` is deliberately absent: the signing
 * tool computes it from the folder, and a metadata file that carried its own file
 * list is exactly the manifest that lies.
 *
 * `minAppVersion` is read off `apps/desktop/package.json` rather than typed: it
 * is the build this pack's reader ships in, and a number copied by hand into a
 * build script is a number that stops being true.
 */
export function buildMetadata(appVersion) {
  return {
    format: 1,
    id: PACK_ID,
    version: "2026.10.0",
    kind: "dataset",
    title: { sr: "Teksture planeta", en: "Planet textures" },
    description: {
      sr: "Ekvisferne mape Sunca, Meseca i planeta, za 3D prikaz Sunčevog sistema.",
      en: "Equirectangular maps of the Sun, the Moon and the planets, for the 3D solar-system view.",
    },
    licence: {
      spdx: "CC-BY-4.0",
      attribution:
        "Planet maps by Solar System Scope (INOVE), CC BY 4.0. Earth day map: NASA Earth Observatory " +
        "\u201eBlue Marble\u201c; Earth night map: NASA Earth Observatory \u201eBlack Marble\u201c (Suomi NPP VIIRS) \u2014 " +
        "NASA content is generally not subject to copyright in the United States. Per-body credits are in textures.json.",
      url: "https://creativecommons.org/licenses/by/4.0/",
    },
    source: { name: "NASA Earth Observatory; Solar System Scope", url: "https://www.solarsystemscope.com/textures/" },
    minAppVersion: appVersion,
  };
}

/** `apps/desktop`'s version, which is the floor a pack has to be installable in. */
export function appVersion() {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "apps", "desktop", "package.json"), "utf8"));
  if (typeof manifest.version !== "string") throw new Error("planet-textures: no app version to floor on.");
  return manifest.version;
}

/** Where the pack and its metadata are written, both under `%TEMP%`. */
export function outputPaths() {
  return {
    cacheDir: join(tmpdir(), "nexus-pack-cache", PACK_ID),
    packDir: join(tmpdir(), "nexus-packs", PACK_ID),
    metaPath: join(tmpdir(), "nexus-packs", `${PACK_ID}.meta.json`),
  };
}

function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

/** The whole build: fetch, verify, convert, write. */
export async function build(options) {
  mkdirSync(join(options.packDir, "images"), { recursive: true });
  const images = [];
  for (const target of PLAN) {
    const source = options.sources.get(target.source);
    if (source === undefined) throw new Error(`planet-textures: no source named "${target.source}".`);
    const { bytes, fetched } = await fetchSource(source, options);
    const converted = await convertToWebp(bytes, limitsFor(target.slot));
    writeFileSync(join(options.packDir, "images", target.file), converted.data);
    images.push({ ...target, converted });
    options.log(
      `  ${target.file.padEnd(20)} ${String(converted.width)}x${String(converted.height)}  ` +
        `${kib(converted.data.byteLength).padStart(9)}  from ${source.url}` +
        (fetched ? "" : " (cache)"),
    );
  }
  writeFileSync(
    join(options.packDir, "textures.json"),
    `${JSON.stringify(buildTexturesJson(images, options.sources), null, 2)}\n`,
  );
  const metadata = buildMetadata(appVersion());
  writeFileSync(options.metaPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return { images, metadata };
}

/**
 * Re-cuts the test fixtures from the cached sources.
 *
 * A fixture is the top-left corner of a real source, uncropped by any metadata,
 * in that source's own format — so the converter's test reads the same JPEG and
 * the same alpha PNG the build reads, at a few kilobytes instead of megabytes.
 * The licence of every one of them is in `fixtures/README.md`, and each is small
 * enough to be a quotation rather than a copy.
 */
async function cutFixtures(options) {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  for (const fixture of FIXTURES) {
    const source = options.sources.get(fixture.source);
    if (source === undefined) throw new Error(`planet-textures: no source named "${fixture.source}".`);
    const { bytes } = await fetchSource(source, options);
    const cut = await sharp(bytes)
      .extract({
        left: fixture.left,
        top: fixture.top,
        width: fixture.width,
        height: fixture.height,
      })
      .toBuffer();
    writeFileSync(join(FIXTURES_DIR, fixture.file), cut);
    options.log(
      `  ${fixture.file.padEnd(24)} ${String(fixture.width)}x${String(fixture.height)} at ` +
        `${String(fixture.left)},${String(fixture.top)} of ${source.url}`,
    );
  }
}

async function main() {
  const started = Date.now();
  const paths = outputPaths();
  const sources = assertSources(JSON.parse(readFileSync(SOURCES_FILE, "utf8")));
  const options = {
    ...paths,
    sources: sources.byId,
    fetchImpl: fetch,
    log: (line) => {
      console.log(line);
    },
  };
  console.log(`planet-textures: ${String(PLAN.length)} images from ${String(sources.byId.size)} sources`);

  if (process.argv.includes("--fixtures")) {
    await cutFixtures(options);
    console.log(`planet-textures: fixtures written to ${FIXTURES_DIR} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return;
  }

  const { images } = await build(options);
  const total = images.reduce((sum, image) => sum + image.converted.data.byteLength, 0) +
    readFileSync(join(paths.packDir, "textures.json")).byteLength;
  console.log(`pack: ${kib(total)} in ${String(images.length + 1)} files -> ${paths.packDir}`);
  console.log(`metadata: ${paths.metaPath} (kind dataset, minAppVersion ${appVersion()})`);
  console.log(
    `sign with: node scripts/pack-sign.mjs --dir ${paths.packDir} --meta ${paths.metaPath} --key <release-key.pem>`,
  );
  console.log(`fetched ${String(images.length)} images in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

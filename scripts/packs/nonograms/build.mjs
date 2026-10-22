// No shebang, for the reason every builder in `scripts/packs` has none: this module
// is both a CLI and the import target of its own test.
//
// THE NONOGRAM PICTURES BUILDER. `nonograms-pictures` is a `dataset` pack: a set of
// real pictures — a cat, a castle, a ship — rasterised to 10, 15 and 20 cell grids,
// for the nonogram game to draw its hidden picture from instead of noise.
//
//   node scripts/packs/nonograms/build.mjs [--update-sources]
//
// WHERE THE PICTURES COME FROM. game-icons.net, the repository
// `game-icons/icons`, CC BY 3.0. Its `license.txt` names every contributor and says
// which folders are CC0 instead; the builder reads that file, refuses to build if
// the licence sentence in `sources.json` is no longer in it, and leaves out every
// folder that is CC0 or that has no named author (`badges`, `various-artists`,
// `lucasms`, whose folder name is not its author's). A picture is only ever shipped
// under the licence its author gave it.
//
// HOW A PICTURE BECOMES A PUZZLE. An icon is a silhouette: the repository draws a
// full-square background path and the icon on top of it, in white. The background
// path is removed by its geometry, because it covers the whole square and would
// make every cell filled; the rest is rendered with its alpha channel. Each grid cell
// is 16 × 16 rendered pixels, and it is filled when the icon covers at least half of
// them. The grid is then judged twice: its fill must be in bounds, and the solver
// `solveNonogramLines` from `@nexus/core` must solve it completely from the clues of
// its rows and columns. That is the proof the puzzle has one solution, and the
// builder uses the game's own solver for it rather than a copy.
//
// THE OUTPUT ROOTS AND THE METADATA follow the other builders: the cache and the
// pack folder come from `../lib/roots.mjs`, the metadata beside the folder, and
// `checkMeta` from `pack-sign.mjs` is the gate it has to pass.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import sharp from "sharp";

import "../../lib/ts-import.mjs";
import * as roots from "../lib/roots.mjs";
import { createSource, printFetchLog, sha256 } from "../lib/source.mjs";
import { readZip } from "../lib/zip.mjs";
import { checkMeta } from "../../pack-sign.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SOURCES_FILE = join(HERE, "sources.json");
const TITLES_FILE = join(HERE, "titles.json");

const { cluesOf, solveNonogramLines } = await import(
  new URL("../../../packages/core/src/games/nonogram/nonogram.ts", import.meta.url).href
);

/** The pack's id, its version and the app floor it needs. */
export const PACK_ID = "nonograms-pictures";
export const PACK_VERSION = "2026.10.0";
export const MIN_APP_VERSION = "2.5.0";

/** The grid sides the pack carries; `NONOGRAM_MAX` in core is 20. */
export const SIZES = [10, 15, 20];

/** How many pictures one grid size carries. A cap, not a target: fewer is shipped when fewer pass. */
export const PER_SIZE_CAP = 120;

/**
 * The fill bounds, as the share of cells the icon covers. Below 20 % a grid is a
 * scatter of cells that does not read as a picture; above 50 % the grid is mostly
 * filled and its empty cells, which are what the player must find, are the
 * minority. Both are judgement calls, and the run's measured distribution is in the
 * pack's report rather than behind these numbers.
 */
export const FILL_MIN = 0.2;
export const FILL_MAX = 0.5;

/** Rendered pixels per grid cell along each side. */
export const SUPERSAMPLE = 16;

/** The archive's top folder, and the licence file inside it. */
const ARCHIVE_ROOT = "icons-master";
const LICENCE_FILE = `${ARCHIVE_ROOT}/license.txt`;
const LEGAL_CODE_URL = "https://creativecommons.org/licenses/by/3.0/legalcode.txt";
const CACHE_NAME = "nonograms";

const SELF_CLOSING_PATH = /<path\b[^>]*\/>/g;
const PATH_DATA = /\sd="([^"]*)"/;
const VIEW_BOX = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/;

/**
 * The SVG with its background removed, and how many paths were removed. The
 * background is the rectangle that covers the whole viewBox (`M0 0h512v512H0z` in a
 * 512 viewBox), matched against the viewBox's own size, so an icon's smaller square
 * is kept. A count of zero is a legitimate answer for an icon that draws none.
 */
export function stripBackground(svg) {
  const viewBox = VIEW_BOX.exec(svg);
  if (viewBox === null) return { svg, removed: 0 };
  const background = `M0 0h${viewBox[1]}v${viewBox[2]}H0z`;
  let removed = 0;
  const text = svg.replace(SELF_CLOSING_PATH, (tag) => {
    if (PATH_DATA.exec(tag)?.[1].trim() !== background) return tag;
    removed += 1;
    return "";
  });
  return { svg: text, removed };
}

/** The icon's RGBA pixels at `side` × `side`, transparent wherever the icon is not. */
async function rasterise(svg, side) {
  const { data } = await sharp(Buffer.from(svg))
    .resize(side, side, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

/**
 * The grid of an icon, row-major: a cell is filled when the icon covers at least
 * half of its `SUPERSAMPLE` × `SUPERSAMPLE` pixels, a pixel being covered at half
 * opacity or more.
 */
export async function gridOf(svg, size) {
  const side = size * SUPERSAMPLE;
  const pixels = await rasterise(svg, side);
  const half = (SUPERSAMPLE * SUPERSAMPLE) / 2;
  const cells = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let covered = 0;
      for (let y = 0; y < SUPERSAMPLE; y += 1) {
        for (let x = 0; x < SUPERSAMPLE; x += 1) {
          const pixel = (row * SUPERSAMPLE + y) * side + column * SUPERSAMPLE + x;
          if (pixels[pixel * 4 + 3] >= 128) covered += 1;
        }
      }
      cells.push(covered >= half);
    }
  }
  return cells;
}

/** Each row of a grid as a string of `0` and `1`, the form `nonograms.json` stores. */
export function rowsOf(cells, size) {
  const rows = [];
  for (let row = 0; row < size; row += 1) {
    rows.push(cells.slice(row * size, (row + 1) * size).map((filled) => (filled ? "1" : "0")).join(""));
  }
  return rows;
}

/**
 * One icon judged at one size: its grid, its fill, and whether the game's solver
 * solves the grid from the clues of its rows and columns alone.
 */
export async function evaluate(svg, size) {
  const cells = await gridOf(svg, size);
  const rowClues = [];
  const columnClues = [];
  for (let index = 0; index < size; index += 1) {
    rowClues.push(cluesOf(cells.slice(index * size, (index + 1) * size)));
    columnClues.push(cluesOf(cells.filter((_, at) => at % size === index)));
  }
  const { solved } = solveNonogramLines(rowClues, columnClues, size, size);
  return { size, cells, fill: cells.filter(Boolean).length / cells.length, solved };
}

/** Whether a judged grid is a puzzle the pack ships: solvable outright, and filled within bounds. */
export function keepable(evaluation) {
  return evaluation.solved && evaluation.fill >= FILL_MIN && evaluation.fill <= FILL_MAX;
}

/** A name as a comparison key: lower case, letters and digits only. `Caro Asercion` and `caro-asercion` are one key. */
const keyOf = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The contributors the licence file names, keyed by `keyOf`. A line that ends in
 * `- CC0` is a contributor who is not under CC BY, and is kept so that its folder
 * is excluded rather than mistaken for one with no author at all.
 */
export function parseAuthors(licence) {
  const authors = new Map();
  for (const line of licence.split("\n")) {
    const match = /^- (.+)$/.exec(line.trim());
    if (match === null) continue;
    const cc0 = /\s-\sCC0$/.test(match[1]);
    const name = match[1].split(",")[0].replace(/\s-\sCC0$/, "").trim();
    authors.set(keyOf(name), { name, cc0 });
  }
  return authors;
}

/**
 * Every icon of a CC BY author in the archive, sorted by id. An icon whose folder
 * names no author, or names a CC0 one, is not an icon this pack may ship.
 */
export function iconsOf(entries, authors) {
  const icons = [];
  for (const path of entries.keys()) {
    const match = new RegExp(`^${ARCHIVE_ROOT}/([^/]+)/([^/]+)\\.svg$`).exec(path);
    if (match === null) continue;
    const [, folder, name] = match;
    const author = authors.get(keyOf(folder));
    if (author === undefined || author.cc0) continue;
    icons.push({ id: `${folder}/${name}`, folder, name, author: author.name, path });
  }
  return icons.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The stem an icon's name starts with: `castle` for `castle-tower`. Stems are how near-duplicates are recognised. */
const stemOf = (name) => name.split("-")[0];

/**
 * The pack's puzzles. Per size, at most `cap` pictures: authors take turns in folder
 * order, so one prolific folder cannot fill a size, and within a folder the names are
 * taken in order. A picture whose stem is already used at any size is skipped, so
 * `castle` and `castle-tower` never both ship.
 *
 * `candidates` are `{ icon, title, evaluations }`, one per icon with a title,
 * where `evaluations` maps a size to its `evaluate` result.
 */
export function selectPuzzles(candidates, cap = PER_SIZE_CAP) {
  const used = new Set();
  const puzzles = [];
  for (const size of SIZES) {
    const byFolder = new Map();
    for (const candidate of candidates) {
      const evaluation = candidate.evaluations.get(size);
      if (evaluation === undefined || !keepable(evaluation)) continue;
      const list = byFolder.get(candidate.icon.folder) ?? [];
      list.push(candidate);
      byFolder.set(candidate.icon.folder, list);
    }
    const queues = [...byFolder.keys()].sort().map((folder) =>
      byFolder.get(folder).sort((a, b) => (a.icon.name < b.icon.name ? -1 : a.icon.name > b.icon.name ? 1 : 0)),
    );
    const take = (queue) => {
      while (queue.length > 0) {
        const candidate = queue.shift();
        if (!used.has(stemOf(candidate.icon.name))) return candidate;
      }
      return undefined;
    };
    let picked = 0;
    let progressed = true;
    while (picked < cap && progressed) {
      progressed = false;
      for (const queue of queues) {
        if (picked >= cap) break;
        const candidate = take(queue);
        if (candidate === undefined) continue;
        progressed = true;
        picked += 1;
        used.add(stemOf(candidate.icon.name));
        puzzles.push(puzzleOf(candidate, size));
      }
    }
  }
  return puzzles;
}

/** One `nonograms.json` entry. */
function puzzleOf({ icon, title, evaluations }, size) {
  return {
    id: `${String(size)}-${icon.folder}-${icon.name}`,
    size,
    rows: rowsOf(evaluations.get(size).cells, size),
    title,
    author: icon.author,
    source: icon.path,
  };
}

/** `ATTRIBUTION.txt`: what CC BY 3.0 requires to be shown, and the change made. */
export function attributionText(authors) {
  return [
    "Nonogram pictures: silhouettes from game-icons.net (https://game-icons.net), repository",
    "https://github.com/game-icons/icons, licensed under Creative Commons Attribution 3.0 Unported",
    "(CC BY 3.0): https://creativecommons.org/licenses/by/3.0/. The legal code is in LICENSE-CC-BY-3.0.txt.",
    "",
    "Change made: each icon was rasterised to a grid of 10, 15 or 20 cells a side; a cell is filled",
    "where the icon covers at least half of it. The silhouettes themselves are not included.",
    "",
    "Icons made by:",
    ...authors.map((name) => `- ${name}`),
    "",
  ].join("\n");
}

/** The metadata `pack-sign.mjs` takes. `files` is absent: the signing tool computes it from the folder. */
export function buildMetadata(authors) {
  return {
    format: 1,
    id: PACK_ID,
    version: PACK_VERSION,
    kind: "dataset",
    title: { sr: "Nonogrami sa slikama", en: "Nonogram pictures" },
    description: {
      sr: "Prave slike, od siluete do mreže, za nonograme: zagonetka otkriva sliku koja stoji iza nje.",
      en: "Real pictures, rasterised to grids, for the nonogram puzzles: the puzzle reveals the picture behind it.",
    },
    licence: {
      spdx: "CC-BY-3.0",
      attribution:
        `Pictures from game-icons.net, CC BY 3.0, rasterised to grids. Icons made by ${authors.join(", ")}. ` +
        "The list and the licence text are in ATTRIBUTION.txt and LICENSE-CC-BY-3.0.txt.",
      url: "https://creativecommons.org/licenses/by/3.0/",
    },
    source: { name: "game-icons.net", url: "https://game-icons.net" },
    minAppVersion: MIN_APP_VERSION,
  };
}

/** `sources.json`, checked for the shapes the builder relies on. */
export function loadSources(file = SOURCES_FILE) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (parsed.format !== 1) throw new Error(`build: sources.json: format ${String(parsed.format)} is not 1.`);
  if (typeof parsed.archive?.url !== "string" || !parsed.archive.url.startsWith("https://")) {
    throw new Error('build: sources.json: "archive.url" must be an https URL.');
  }
  if (typeof parsed.licence?.sentence !== "string" || parsed.licence.sentence === "") {
    throw new Error('build: sources.json: "licence.sentence" must quote the licence statement.');
  }
  return parsed;
}

/** The archive's fetch record, rewritten by `--update-sources` and checked on every other run. */
function recordArchive(sources, bytes, digest) {
  return {
    ...sources,
    archive: {
      url: sources.archive.url,
      bytes: bytes.byteLength,
      sha256: digest,
      fetchedAt: new Date().toISOString().slice(0, 10),
    },
  };
}

async function main() {
  const started = Date.now();
  const updateSources = process.argv.includes("--update-sources");
  const sources = loadSources();
  const cache = createSource(CACHE_NAME);
  const archive = await cache.bytes(sources.archive.url, "master.zip");
  const digest = sha256(archive);
  if (sources.archive.sha256 !== null && sources.archive.sha256 !== digest && !updateSources) {
    throw new Error(
      `nonograms: the archive is ${digest}, and sources.json records ${String(sources.archive.sha256)}. ` +
        "Re-run with --update-sources if the repository changed on purpose.",
    );
  }

  const entries = readZip(archive);
  const licence = entries.get(LICENCE_FILE)?.toString("utf8");
  if (licence === undefined) throw new Error(`nonograms: the archive has no ${LICENCE_FILE}.`);
  if (!licence.includes(sources.licence.sentence)) {
    throw new Error("nonograms: the licence sentence in sources.json is not in the archive's license.txt.");
  }

  const titles = JSON.parse(readFileSync(TITLES_FILE, "utf8"));
  const icons = iconsOf(entries, parseAuthors(licence));
  const byId = new Map(icons.map((icon) => [icon.id, icon]));
  for (const id of Object.keys(titles)) {
    if (!byId.has(id)) throw new Error(`nonograms: titles.json names "${id}", which is no icon of a CC BY author.`);
  }

  const candidates = [];
  let stripped = 0;
  for (const icon of icons) {
    const title = titles[icon.id];
    if (title === undefined) continue;
    const background = stripBackground(entries.get(icon.path).toString("utf8"));
    stripped += background.removed;
    const evaluations = new Map();
    for (const size of SIZES) evaluations.set(size, await evaluate(background.svg, size));
    candidates.push({ icon, title, evaluations });
  }
  const puzzles = selectPuzzles(candidates);
  const authors = [...new Set(puzzles.map((puzzle) => puzzle.author))].sort();

  const packDir = roots.packDirFor(PACK_ID);
  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });
  writeFileSync(join(packDir, "nonograms.json"), `${JSON.stringify({ format: 1, puzzles }, null, 2)}\n`);
  writeFileSync(join(packDir, "ATTRIBUTION.txt"), attributionText(authors));
  writeFileSync(join(packDir, "LICENSE-CC-BY-3.0.txt"), await cache.bytes(LEGAL_CODE_URL, "LICENSE-CC-BY-3.0.txt"));
  const metaPath = roots.packMetaPathFor(PACK_ID);
  const metadata = buildMetadata(authors);
  checkMeta(metadata);
  writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);
  if (updateSources) {
    writeFileSync(SOURCES_FILE, `${JSON.stringify(recordArchive(sources, archive, digest), null, 2)}\n`);
  }

  const counts = SIZES.map((size) => `${String(size)}x${String(size)}: ${String(puzzles.filter((p) => p.size === size).length)}`);
  console.log(`nonograms: ${String(candidates.length)} titled icons judged, ${String(puzzles.length)} puzzles (${counts.join(", ")})`);
  console.log(`nonograms: ${String(stripped)} background rectangles removed`);
  console.log(`pack: ${packDir}`);
  console.log(`metadata: ${metaPath} (kind dataset, minAppVersion ${MIN_APP_VERSION})`);
  const packBytes = ["nonograms.json", "ATTRIBUTION.txt", "LICENSE-CC-BY-3.0.txt"].reduce(
    (sum, file) => sum + statSync(join(packDir, file)).size,
    0,
  );
  printFetchLog(cache.log, packBytes);
  console.log(`nonograms: done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

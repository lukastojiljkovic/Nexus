// The Stockfish pack (ADR-094): the official Windows x64 release, unmodified,
// with the licence text, the notices and the Corresponding Source beside it.
//
//   node scripts/packs/stockfish/build.mjs
//
// WHY A PACK AND NOT A DEPENDENCY. Stockfish is GPL-3.0-or-later — its own
// source header says "either version 3 of the License, or (at your option) any
// later version", and `sources.json` quotes it — and Nexus is Apache-2.0. The two
// may not be combined into one program, but they may sit side by side as an
// aggregate, and they do that here: the engine is a separate program that the app
// starts and talks to over UCI (`research/chess/report.md` §2.8, GPLv3 §5). So
// the pack carries the engine and the app keeps its own licence.
//
// THE RELEASE, MEASURED. Stockfish 19 (`sf_19`, published 2026-09-05) ships one
// universal Windows x86-64 archive that detects the CPU's features at start-up;
// the per-CPU variants (SSE2/AVX2/BMI2/AVX-512) that older releases published do
// not exist in this one, which is why this builder downloads exactly one binary —
// `research/chess/report.md` §2.2 records the same finding from the release's own
// asset list. What "the variants for older CPUs" asked for is answered by the
// universal build rather than by four archives.
//
// THE WHOLE ARCHIVE STAYS. The release archive is both the distribution and the
// source offer: it holds `stockfish/Copying.txt` (the GPL-3.0 text), `AUTHORS`,
// `README.md` and the complete `src/` tree, so shipping it byte for byte means
// the licence, the notices and the Corresponding Source all travel with the
// binary and nothing has to be mirrored by hand. That is also why the pack keeps
// a copy of the archive itself rather than an extracted `src/`: an extracted tree
// is a second thing that can be wrong, and the archive is a file with a digest.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  cacheDirFor,
  ensureCached,
  formatReport,
  metaFileFor,
  packOutDirFor,
  readSources,
  writeMetaFile,
  writePackFiles,
} from "../build-lib.mjs";
import { readZipEntries, zipEntryNamed } from "../zip.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The pack's identity, and the release it pins. */
export const ID = "stockfish";
export const VERSION = "19.0.0";
/** The upstream tag, which is also the asset directory on the release page. */
export const RELEASE_TAG = "sf_19";
/** The archive every other path in this pack is taken from. */
export const SOURCE_ARCHIVE = "stockfish-windows-x86-64-universal.zip";

/** Where the release keeps its files inside that archive. */
const ARCHIVE_ROOT = "stockfish/";
const ARCHIVE_ENGINE = `${ARCHIVE_ROOT}stockfish-windows-x86-64-universal.exe`;
const ARCHIVE_COPYING = `${ARCHIVE_ROOT}Copying.txt`;
const ARCHIVE_AUTHORS = `${ARCHIVE_ROOT}AUTHORS`;
const ARCHIVE_README = `${ARCHIVE_ROOT}README.md`;

/** What the finished pack holds, and what the manifest's `tool.entry` names. */
export const PACK_PATHS = {
  engine: "engine/stockfish-windows-x86-64-universal.exe",
  copying: "COPYING",
  authors: "AUTHORS",
  readme: "README.md",
  source: `source/${SOURCE_ARCHIVE}`,
  notice: "SOURCE.txt",
};

/**
 * The pack's files, taken out of the verified archive.
 *
 * `archive` is the whole archive buffer, because one of the pack's files IS the
 * archive: the pack ships the release verbatim as well as the executable, so the
 * Corresponding Source (`src/`) travels with the binary rather than being
 * fetched from a URL that may some day move.
 */
export function packFilesFromArchive(archive) {
  const entries = readZipEntries(archive);
  return [
    { path: PACK_PATHS.engine, bytes: zipEntryNamed(archive, entries, ARCHIVE_ENGINE) },
    { path: PACK_PATHS.copying, bytes: zipEntryNamed(archive, entries, ARCHIVE_COPYING) },
    { path: PACK_PATHS.authors, bytes: zipEntryNamed(archive, entries, ARCHIVE_AUTHORS) },
    { path: PACK_PATHS.readme, bytes: zipEntryNamed(archive, entries, ARCHIVE_README) },
    { path: PACK_PATHS.source, bytes: archive },
  ];
}

/**
 * The note the pack carries about itself.
 *
 * GPLv3 §6 asks the distributor to offer the Corresponding Source from the same
 * place as the binary, and this is that offer in the pack's own words: what the
 * program is, which release it is, where the archive came from, its digest, and
 * which file in this folder is the source. The numbers in it are the ones the
 * builder verified, never typed twice.
 */
export function sourceNotice(input) {
  return [
    `Stockfish ${VERSION} — GPL-3.0-or-later`,
    "",
    "This pack carries the official, unmodified Stockfish release for Windows x86-64,",
    "published under the GNU General Public License version 3, or (at your option) any",
    "later version. Nexus ships it as a separate program and speaks UCI to it; nothing",
    "of it is linked into Nexus, which stays Apache-2.0.",
    "",
    `Release:        https://github.com/official-stockfish/Stockfish/releases/tag/${RELEASE_TAG}`,
    `Archive:        ${input.url}`,
    `SHA-256:        ${input.sha256}`,
    `Archive bytes:  ${String(input.bytes)}`,
    "",
    "Licence text:   COPYING (the release archive's own Copying.txt)",
    "Copyright:      AUTHORS (the release archive's own authors file)",
    "Corresponding Source: source/ — the whole release archive, which contains the",
    "                complete src/ tree the shipped binary was built from, plus the",
    "                build's own Makefile. The engine's neural network is embedded in",
    "                the binary and is CC0 (official-stockfish/networks).",
    "",
    "Stockfish's own no-warranty wording applies as the licence states it: the program",
    "is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;",
    "without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR",
    "PURPOSE.",
    "",
  ].join("\n");
}

/** The metadata `pack-sign.mjs` takes, as the maintainer would type it. */
export function metadata() {
  return {
    format: 1,
    id: ID,
    version: VERSION,
    kind: "tool",
    title: { sr: "Stockfish 19", en: "Stockfish 19" },
    description: {
      sr: "Šahovski motor otvorenog koda, pokreće se kao zaseban program pored Nexusa.",
      en: "An open-source chess engine, started as a separate program beside Nexus.",
    },
    licence: {
      spdx: "GPL-3.0-or-later",
      attribution: "The Stockfish developers (see AUTHORS in the pack)",
      url: "https://www.gnu.org/licenses/gpl-3.0.html",
    },
    source: {
      name: "Stockfish",
      url: `https://github.com/official-stockfish/Stockfish/releases/tag/${RELEASE_TAG}`,
    },
    // The first release expected to carry ADR-094's `tool` kind. The maintainer
    // confirms this number when the release is cut; a pack that installed into a
    // build without the kind would be refused there by `kind-unknown` anyway.
    minAppVersion: "1.6.0",
    tool: { entry: PACK_PATHS.engine, protocol: "uci" },
  };
}

/**
 * The whole build: the cached archive, the pack folder, the metadata file.
 *
 * `sources` is the parsed `sources.json` and `fetchImpl` is only ever the real
 * `fetch` in `main()`, which is what keeps the tests off the network.
 */
export async function buildPack(input) {
  const started = Date.now();
  const log = input.log ?? (() => undefined);
  const asset = input.sources.sources[SOURCE_ARCHIVE];
  if (asset === undefined) {
    throw new Error(`pack-build: sources.json describes no "${SOURCE_ARCHIVE}".`);
  }

  const cached = await ensureCached({
    url: asset.url,
    file: SOURCE_ARCHIVE,
    sha256: asset.sha256,
    cacheDir: input.cacheDir ?? cacheDirFor(ID),
    fetchImpl: input.fetchImpl,
    log,
  });
  const archive = await readFile(cached.path);
  // Read back after the digest check, so a file that changed in between is not
  // hashed once and unpacked as something else.
  if (archive.byteLength !== cached.bytes) {
    throw new Error(`pack-build: ${SOURCE_ARCHIVE} changed between its digest and its read.`);
  }

  const files = packFilesFromArchive(archive);
  files.push({
    path: PACK_PATHS.notice,
    bytes: Buffer.from(
      sourceNotice({ url: asset.url, sha256: cached.sha256, bytes: cached.bytes }),
      "utf8",
    ),
  });

  const dir = input.outDir ?? packOutDirFor(ID);
  const written = await writePackFiles({ dir, files, log });
  const totalBytes = written.reduce((sum, file) => sum + file.size, 0);
  await writeMetaFile(input.metaFile ?? metaFileFor(ID), metadata());
  log(formatReport({ id: ID, dir, fileCount: written.length, totalBytes, elapsedMs: Date.now() - started }));
  return { dir, files: written, totalBytes, metaFile: input.metaFile ?? metaFileFor(ID) };
}

async function main() {
  const sources = await readSources(join(HERE, "sources.json"));
  const result = await buildPack({ sources, fetchImpl: fetch, log: (line) => console.log(line) });
  console.log(`pack-build: sign it with: node scripts/pack-sign.mjs --dir "${result.dir}" --meta "${result.metaFile}" --key <private key>`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

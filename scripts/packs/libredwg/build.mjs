// The GNU LibreDWG pack (ADR-094): the project's own Windows x64 build, its
// runtime DLLs, the licence text, and the source archive of the same release.
//
//   node scripts/packs/libredwg/build.mjs
//
// WHY A PACK. LibreDWG is GPL-3.0-or-later — the project's own header says
// "either version 3 of the License, or (at your option) any later version", and
// `sources.json` quotes it — and DWG is Autodesk's proprietary format, so the
// only free way to read one is a GPL implementation (`research/dwg/report.md`
// §2.1–2.2). A GPL library cannot be linked into an Apache-2.0 application, and
// a GPL DLL loaded in-process is linked; an executable started as a child process
// is not. So the pack ships `dwg2dxf.exe` and the app runs it, which is what
// `apps/desktop/src/main/tools/dwg.ts` does.
//
// WHICH VERSION, AND WHY NOT THE TAG. The newest *tagged* release is 0.14, and
// the project's NEWS records that the heap overflows and a use-after-free found in
// DWG import were fixed after it, in 0.14.1 (2026-07-25). The nightlies are built
// from the branch that carries those fixes, so this pins the newest published
// Windows build — 0.14.8601, 2026-10-03 — and ships the source archive of that
// same version. A converter whose input format is somebody else's file is exactly
// the place not to ship a build with known memory-safety bugs in its parser.
//
// WHAT THE PUBLISHER DOES NOT SHIP. The Windows archive carries no COPYING file
// at all — `sources.json` records the same finding, and the pack's `README.txt`
// states the licence in prose only — so the pack adds the project's own licence
// text, fetched from the source tree at the shipped version and recorded with its
// digest. This is the one artefact the pack has to supply itself.

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
  sha256Bytes,
  writeMetaFile,
  writePackFiles,
} from "../build-lib.mjs";
import { readZipEntries, zipEntryNamed } from "../zip.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The pack's identity, and the release it pins. */
export const ID = "libredwg";
export const VERSION = "0.14.8601";
export const RELEASE_TAG = "0.14.8601";

/** The two archives the pack is built from, and the licence text it has to add. */
export const BINARY_ARCHIVE = `libredwg-${VERSION}-win64.zip`;
export const SOURCE_ARCHIVE = `libredwg-${VERSION}.tar.xz`;
export const LICENCE_FILE = "COPYING";

/** The programs and libraries the converter needs, taken out of the archive unmodified. */
const BINARIES = [
  "dwg2dxf.exe",
  "dwgread.exe",
  "libredwg-0.dll",
  "libiconv-2.dll",
  "libpcre2-8-0.dll",
  "libpcre2-16-0.dll",
];

/** What the finished pack holds, and what the manifest's `tool.entry` names. */
export const PACK_PATHS = {
  entry: `bin/${BINARIES[0]}`,
  readme: "README.txt",
  copying: "COPYING",
  source: `source/${SOURCE_ARCHIVE}`,
  notice: "SOURCE.txt",
};

/**
 * The pack's files, out of the two verified archives.
 *
 * `binaryArchive` is the publisher's Windows build and `sourceArchive` the
 * matching source tarball; both are buffers this module has already had checked
 * against the digests in `sources.json` by the caller.
 */
export function packFilesFromArchive(input) {
  const entries = readZipEntries(input.binaryArchive);
  const files = BINARIES.map((name) => ({
    path: name === BINARIES[0] ? PACK_PATHS.entry : `bin/${name}`,
    bytes: zipEntryNamed(input.binaryArchive, entries, name),
  }));
  files.push({ path: PACK_PATHS.readme, bytes: zipEntryNamed(input.binaryArchive, entries, "README.txt") });
  files.push({ path: PACK_PATHS.copying, bytes: input.copying });
  files.push({ path: PACK_PATHS.source, bytes: input.sourceArchive });
  return files;
}

/** The note the pack carries about itself: what it is, where it came from, which file is the source. */
export function sourceNotice(input) {
  return [
    `GNU LibreDWG ${VERSION} — GPL-3.0-or-later`,
    "",
    "This pack carries the GNU LibreDWG project's own Windows x86-64 build, unmodified,",
    "published under the GNU General Public License version 3, or (at your option) any",
    "later version. Nexus runs dwg2dxf.exe as a separate program; nothing of it is",
    "linked into Nexus, which stays Apache-2.0.",
    "",
    `Release:        https://github.com/LibreDWG/libredwg/releases/tag/${RELEASE_TAG}`,
    `Binary archive: ${input.binary.url}`,
    `SHA-256:        ${input.binary.sha256}`,
    `Archive bytes:  ${String(input.binary.bytes)}`,
    `Source archive: ${input.source.url}`,
    `SHA-256:        ${input.source.sha256}`,
    "",
    "Licence text:   COPYING — the project's own licence file from the source tree at",
    "                this version. The Windows archive carries no COPYING file, so",
    "                this pack supplies one; the source archive beside it is the offer",
    "                GPLv3 §6 asks for, made from the same place as the binary.",
    "Corresponding Source: source/ — the complete LibreDWG source archive of this",
    "                exact version, including the programs/ and src/ trees dwg2dxf.exe",
    "                was built from.",
    "",
    "GNU LibreDWG's own no-warranty wording applies as the licence states it: the",
    "program is distributed in the hope that it will be useful, but WITHOUT ANY",
    "WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A",
    "PARTICULAR PURPOSE.",
    "",
    "A DWG file is somebody else's input, and this decoder is C: the version pinned",
    "here carries the fixes the project's NEWS lists for CVE-2026-63474 and the",
    "advisories beside it. Nexus runs it in a temporary directory, with a time limit,",
    "an output cap and no inherited environment — see apps/desktop/src/main/tools/.",
    "",
  ].join("\n");
}

/** The metadata `pack-sign.mjs` takes. */
export function metadata() {
  return {
    format: 1,
    id: ID,
    version: VERSION,
    kind: "tool",
    title: { sr: "GNU LibreDWG", en: "GNU LibreDWG" },
    description: {
      sr: "Pretvara DWG crteže u DXF, kao zaseban program pored Nexusa.",
      en: "Converts DWG drawings to DXF, as a separate program beside Nexus.",
    },
    licence: {
      spdx: "GPL-3.0-or-later",
      attribution: "The GNU LibreDWG authors (Free Software Foundation, Inc.)",
      url: "https://www.gnu.org/licenses/gpl-3.0.html",
    },
    source: {
      name: "GNU LibreDWG",
      url: `https://github.com/LibreDWG/libredwg/releases/tag/${RELEASE_TAG}`,
    },
    // The first release expected to carry ADR-094's `tool` kind; the maintainer
    // confirms the number when the release is cut.
    minAppVersion: "1.6.0",
    tool: { entry: PACK_PATHS.entry, protocol: "stdio" },
  };
}

/** The whole build: two cached archives, the licence text, the pack folder, the metadata file. */
export async function buildPack(input) {
  const started = Date.now();
  const log = input.log ?? (() => undefined);
  const cacheDir = input.cacheDir ?? cacheDirFor(ID);
  const fetchImpl = input.fetchImpl;
  const spec = (file) => {
    const source = input.sources.sources[file];
    if (source === undefined) throw new Error(`pack-build: sources.json describes no "${file}".`);
    return source;
  };

  const binary = await ensureCached({
    url: spec(BINARY_ARCHIVE).url,
    file: BINARY_ARCHIVE,
    sha256: spec(BINARY_ARCHIVE).sha256,
    cacheDir,
    fetchImpl,
    log,
  });
  const source = await ensureCached({
    url: spec(SOURCE_ARCHIVE).url,
    file: SOURCE_ARCHIVE,
    sha256: spec(SOURCE_ARCHIVE).sha256,
    cacheDir,
    fetchImpl,
    log,
  });
  const copying = await ensureCached({
    url: spec(LICENCE_FILE).url,
    file: LICENCE_FILE,
    sha256: spec(LICENCE_FILE).sha256,
    cacheDir,
    fetchImpl,
    log,
  });

  const binaryArchive = await readFile(binary.path);
  const sourceArchive = await readFile(source.path);
  const licenceBytes = await readFile(copying.path);
  if (
    binaryArchive.byteLength !== binary.bytes ||
    sourceArchive.byteLength !== source.bytes ||
    sha256Bytes(licenceBytes) !== copying.sha256
  ) {
    throw new Error("pack-build: a cached archive changed between its digest and its read.");
  }

  const files = packFilesFromArchive({ binaryArchive, sourceArchive, copying: licenceBytes });
  files.push({
    path: PACK_PATHS.notice,
    bytes: Buffer.from(sourceNotice({ binary, source }), "utf8"),
  });

  const dir = input.outDir ?? packOutDirFor(ID);
  const written = await writePackFiles({ dir, files, log });
  const totalBytes = written.reduce((sum, file) => sum + file.size, 0);
  const metaFile = input.metaFile ?? metaFileFor(ID);
  await writeMetaFile(metaFile, metadata());
  log(formatReport({ id: ID, dir, fileCount: written.length, totalBytes, elapsedMs: Date.now() - started }));
  return { dir, files: written, totalBytes, metaFile };
}

async function main() {
  const sources = await readSources(join(HERE, "sources.json"));
  const result = await buildPack({ sources, fetchImpl: fetch, log: (line) => console.log(line) });
  console.log(
    `pack-build: sign it with: node scripts/pack-sign.mjs --dir "${result.dir}" --meta "${result.metaFile}" --key <private key>`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

// Poppler, fetched into the pack cache and used from there.
//
// WHY IT IS FETCHED AND NEVER SHIPPED. The figure images in this pack come out
// of the sources' PDFs with Poppler's tools. Poppler is GPL, and a GPL program
// never ships inside the app (the pack rules), so the builder downloads an
// unmodified upstream Windows build into `%TEMP%\nexus-pack-cache\survival\`
// and runs it from there; nothing Poppler produces is linked into Nexus, and
// its output is images of pages that are themselves public domain. The URL, the
// size and the digest are pinned here so a build uses the same build of the
// tool every time, and `docs/packs/survival.md` names the version and licence.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** The pinned upstream build: `oschwartz10612/poppler-windows`, Release 26.09.0-0. */
export const POPPLER = {
  version: "26.09.0-0",
  url: "https://github.com/oschwartz10612/poppler-windows/releases/download/v26.09.0-0/Release-26.09.0-0.zip",
  bytes: 43_709_956,
  sha256: "7a6f256a0ddf7536182246a5733331bf4677cbcc34f4663774947ad34556c8d0",
  licence: "GPL-2.0-or-later (build tool only; never shipped, never linked)",
};

/** The tools this builder runs. `pdfimages` extracts, `pdftoppm` renders. */
export const TOOLS = ["pdfimages", "pdftoppm"];

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The unpacked tool directory, or null when it is not in the cache yet.
 *
 * The release unpacks as `poppler-<version>-<build>/poppler-<version>/Library/
 * bin/*.exe`, and the inner directory's name is the upstream version without
 * the release's build suffix (`poppler-26.09.0`, not `poppler-26.09.0-0`). The
 * inner directory is therefore found by looking for the one that holds
 * `Library/bin`, rather than by deriving a second name from the first.
 */
export function findTools(cacheDir) {
  const root = join(cacheDir, `poppler-${POPPLER.version}`);
  if (!existsSync(root)) return null;
  const bin = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("poppler-"))
    .map((entry) => join(root, entry.name, "Library", "bin"))
    .find((candidate) => existsSync(candidate));
  if (bin === undefined) return null;
  const found = {};
  for (const tool of TOOLS) {
    const exe = join(bin, `${tool}.exe`);
    if (!existsSync(exe)) return null;
    found[tool] = exe;
  }
  return found;
}

/** Unpacks the release with the tar Windows ships, which reads zip. */
function unzip(zipPath, destination) {
  const tar = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe");
  mkdirSync(destination, { recursive: true });
  const result = spawnSync(tar, ["-xf", zipPath, "-C", destination], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`poppler: unpacking ${zipPath} failed: ${result.stderr ?? String(result.status)}`);
  }
}

/**
 * The tools, from the cache or from the network, verified either way.
 *
 * A cached zip whose digest disagrees with the pin is treated as absent and
 * re-fetched; a download that disagrees is a refusal, because the alternative
 * is running a binary nobody vouched for.
 */
export async function ensurePoppler(options) {
  const existing = findTools(options.cacheDir);
  if (existing !== null) return existing;
  const zipPath = join(options.cacheDir, `poppler-${POPPLER.version}.zip`);
  let bytes = existsSync(zipPath) ? readFileSync(zipPath) : null;
  if (bytes !== null && (bytes.byteLength !== POPPLER.bytes || sha256(bytes) !== POPPLER.sha256)) bytes = null;
  if (bytes === null) {
    options.log(`  poppler ${POPPLER.version}: fetching ${POPPLER.url}`);
    const response = await options.fetchImpl(POPPLER.url, { headers: { "user-agent": "nexus-pack-builder" } });
    if (response.ok !== true) throw new Error(`poppler: ${POPPLER.url} answered ${String(response.status)}.`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== POPPLER.bytes || sha256(bytes) !== POPPLER.sha256) {
      throw new Error(
        `poppler: the download is ${String(bytes.byteLength)} bytes / ${sha256(bytes)}, and the pin is ` +
          `${String(POPPLER.bytes)} / ${POPPLER.sha256}. Update the pin deliberately, or do not build.`,
      );
    }
    mkdirSync(options.cacheDir, { recursive: true });
    writeFileSync(zipPath, bytes);
  }
  const root = join(options.cacheDir, `poppler-${POPPLER.version}`);
  // A half-unpacked tree from an interrupted build is removed before the retry,
  // so the retry unpacks rather than finding a tool directory that is one exe
  // short.
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  unzip(zipPath, root);
  const tools = findTools(options.cacheDir);
  if (tools === null) {
    throw new Error(`poppler: ${zipPath} unpacked without ${TOOLS.join(", ")}.`);
  }
  options.log(`  poppler ${POPPLER.version}: unpacked to ${root}`);
  return tools;
}

/** One tool run, with its stdout, or a refusal that names the tool. */
export function runTool(exe, args, options = {}) {
  const result = spawnSync(exe, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    throw new Error(
      `${exe.split(/[\\/]/).pop()} exited ${String(result.status)}: ${(result.stderr ?? "").trim().slice(0, 400)}`,
    );
  }
  return result.stdout;
}

/**
 * `pdfimages -list` for one page range, one record per embedded image, in the
 * order Poppler walks them.
 *
 * The output is columns separated by runs of spaces; this builder reads the
 * page, the image's own pixel size, and Poppler's own running number, which is
 * the number `-p` puts in the file name — the two are the same index, and that
 * is what pairs a file with the image the page's content stream draws.
 */
export function listImages(pdfimages, pdfPath, firstPage, lastPage) {
  const lines = runTool(pdfimages, ["-list", "-f", String(firstPage), "-l", String(lastPage), pdfPath])
    .split("\n")
    .slice(2)
    .filter((line) => line.trim() !== "");
  return lines.map((line) => {
    const columns = line.trim().split(/\s+/);
    return { page: Number(columns[0]), order: Number(columns[1]), width: Number(columns[3]), height: Number(columns[4]) };
  });
}

/**
 * Renders one page as a PNG, returning the file.
 *
 * WHY THE FIGURES COME OUT OF A RENDER AND NOT OUT OF `pdfimages -extract`.
 * Extracting was tried first and refused, deliberately: measured on
 * ATP 4-02.11, `pdfimages -list` reports 179 images where the page's content
 * stream draws 127, because an image with a soft mask is listed (and written)
 * as two images of identical pixel size — and the two cannot be told apart by
 * size, orientation or type, so the pairing would sometimes ship a figure's
 * ALPHA CHANNEL as the figure. A page render composites the mask, needs no
 * pairing at all (the placement comes from the text extraction's own content
 * stream), and is the page as the source prints it. `-list` is still what says
 * a page really embeds images at the size a figure would be.
 */
export function renderPage(pdftoppm, pdfPath, page, outBase, dpi) {
  const result = runTool(pdftoppm, [
    "-png",
    "-singlefile",
    "-r",
    String(dpi),
    "-f",
    String(page),
    "-l",
    String(page),
    pdfPath,
    outBase,
  ]);
  if (result.trim() !== "") throw new Error(`poppler: pdftoppm said ${JSON.stringify(result.trim().slice(0, 200))}`);
  const file = `${outBase}.png`;
  if (!existsSync(file)) throw new Error(`poppler: pdftoppm wrote no page for page ${String(page)}.`);
  return file;
}

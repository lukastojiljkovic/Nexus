// No shebang, for `pack-sign.mjs`'s reason: this module is both a CLI and an
// import target for its own test.
//
// ADR-103's missing half: writing the CATALOGUE the app fetches, and staging
// the files it names.
//
// WHAT IT DOES.
//
//   node scripts/packs/catalogue.mjs --packs <dir> --out <dir> --base <url template>
//
// `--packs` is the folder the builders write (`build-lib.mjs`'s
// `PACKS_OUT_ROOT`): one folder per pack, already signed by `pack-sign.mjs`,
// with `<id>.meta.json` beside it. `--out` receives `catalogue.json` — the
// document the app verifies against the release key — plus `assets.json` and an
// `assets/` tree, which are what the maintainer uploads to the release.
//
// `--base` is a TEMPLATE, and one release per pack is why. `{id}` and
// `{version}` are replaced with the pack's own, so a file's URL reads
// `…/releases/download/<id>-<version>/<asset>`. The reason is a ceiling GitHub
// enforces, found the expensive way on 2026-10-11: A RELEASE HOLDS AT MOST
// 1 000 ASSETS, and the 22 packs built that day are 2 716 files, so publishing
// them into one release failed at file 1 001 with `422 Validation Failed:
// file_count limited to 1000 assets per release` — after the first thousand had
// uploaded. One release per pack sidesteps the ceiling by construction (the
// largest pack is 963 files) and gives each pack its own tag, page and note.
// Nothing in the app changes: the catalogue carries each file's whole URL, and
// the download rule cares only that the HOST is on the compiled-in list.
//
// A base with no placeholder is still accepted, which is what one small pack or
// a test wants.
//
// WHY THERE IS A STAGING TREE AT ALL. Every file of every pack is a separate
// release asset, because the app pins each one with its own URL, size and
// SHA-256; a zip would be a format the install refuses. GitHub asset names
// cannot contain `/`, and two packs both hold `content.json`, so the flat name
// has to encode the pack and the path inside it. `assetName` is that rule, in
// one place, because the URL in the catalogue and the file on the disk have to
// be the same name spelled twice.
//
// WHAT IT DOES NOT DO. It never signs: `pack-sign.mjs --catalogue --file …`
// writes `catalogue.json.sig` with the maintainer's key, exactly as it does for
// a manifest, and no key is read, written or known here. It also never
// uploads — `gh release upload` is the maintainer's step, and this tool's job
// ends at a directory that is ready to be pointed at.

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** The document's own format, `catalogue.ts`'s `PACK_CATALOGUE_FORMAT`. */
const FORMAT = 1;

/** The two files a pack carries besides its content. Both are listed, and the install refuses a folder without them. */
export const PACK_MANIFEST_FILE = "pack.json";
export const PACK_SIGNATURE_FILE = "pack.json.sig";

/** How long a flat asset name may be before it is trimmed and disambiguated by its hash. */
const MAX_ASSET_NAME = 180;

/**
 * The flat release-asset name one file of one pack gets.
 *
 * `<pack id>__<path, with `/` written `__`>`, and every character GitHub does
 * not accept in an asset name replaced by `_` — `#`, `?`, `%`, `:`, spaces.
 * Two packs never collide because the id leads, and two files inside a pack
 * never do because the path is complete. A name that is still too long is cut
 * at `MAX_ASSET_NAME` and disambiguated with the first sixteen hex digits of
 * its own SHA-256, which is a fact about the bytes rather than about where they
 * happened to sit in a directory listing.
 */
export function assetName(packId, path, sha256) {
  const flat = `${packId}__${path.split("/").join("__")}`.replace(/[^A-Za-z0-9._-]/g, "_");
  if (flat.length <= MAX_ASSET_NAME) return flat;
  return `${flat.slice(0, MAX_ASSET_NAME)}-${sha256.slice(0, 16)}`;
}

/**
 * The base URL one pack's files are published under.
 *
 * `{id}` and `{version}` are the only placeholders, and a base that still holds
 * one after filling is refused rather than used: a URL naming the wrong tag
 * produces a catalogue whose every file 404s, which is the exact failure this
 * feature spent 2026-10-11 recovering from.
 */
export function packBaseUrl(baseTemplate, id, version) {
  const filled = baseTemplate.split("{id}").join(id).split("{version}").join(version);
  if (filled.includes("{") || filled.includes("}")) {
    throw new Error(`catalogue: --base still holds a placeholder after filling: "${filled}".`);
  }
  return filled;
}

/** A file's own SHA-256, streamed for `build-lib.mjs`'s reason: models are hundreds of megabytes. */
async function sha256File(path) {
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** One entry of `assets.json`: where a staged file is, and what the catalogue calls it. */
function assetRow(packId, path, asset, file) {
  return { pack: packId, path, asset, file };
}

/**
 * Builds the catalogue and stages every file it lists.
 *
 * The content list comes from the pack's own `pack.json` — the file
 * `pack-sign.mjs` wrote after reading the folder — so the sizes and hashes here
 * are the ones already inside the signature. They are re-checked against the
 * disk anyway: a manifest that no longer matches its folder is a pack nobody
 * can install, and the place to find that out is here rather than in a
 * download failure a week later.
 */
export async function buildCatalogue({ packIds, packsDir, outDir, baseUrl }) {
  const assetsDir = join(outDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const entries = [];
  const assets = [];
  for (const id of packIds) {
    const dir = join(packsDir, id);
    const manifestPath = join(dir, PACK_MANIFEST_FILE);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.id !== id) {
      throw new Error(`catalogue: ${manifestPath} names the pack "${manifest.id}", not "${id}".`);
    }
    const base = packBaseUrl(baseUrl, manifest.id, manifest.version);
    if (!base.endsWith("/")) {
      throw new Error(`catalogue: the base for "${id}" must end with a slash: "${base}".`);
    }

    const files = [];
    // The manifest and its signature travel as content, because the catalogue
    // is outside the manifest and can pin the pair the manifest itself cannot.
    for (const name of [PACK_MANIFEST_FILE, PACK_SIGNATURE_FILE]) {
      const absolute = join(dir, name);
      const size = statSync(absolute).size;
      const sha256 = await sha256File(absolute);
      const asset = assetName(id, name, sha256);
      copyFileSync(absolute, join(assetsDir, asset));
      assets.push(assetRow(id, name, asset, join(assetsDir, asset)));
      files.push({ path: name, url: `${base}${asset}`, size, sha256 });
    }
    for (const file of manifest.files) {
      const absolute = join(dir, ...file.path.split("/"));
      const size = statSync(absolute).size;
      if (size !== file.size) {
        throw new Error(
          `catalogue: "${id}" lists ${file.path} as ${String(file.size)} bytes; it is ${String(size)}.`,
        );
      }
      const asset = assetName(id, file.path, file.sha256);
      copyFileSync(absolute, join(assetsDir, asset));
      assets.push(assetRow(id, file.path, asset, join(assetsDir, asset)));
      files.push({ path: file.path, url: `${base}${asset}`, size, sha256: file.sha256 });
    }

    const entry = {
      id: manifest.id,
      version: manifest.version,
      kind: manifest.kind,
      title: manifest.title,
      description: manifest.description,
      size: files.reduce((sum, file) => sum + file.size, 0),
      licence: manifest.licence,
      source: manifest.source,
      files,
    };
    if (manifest.notice !== undefined) entry.notice = manifest.notice;
    entries.push(entry);
  }

  entries.sort((a, b) => (a.id < b.id ? -1 : 1));
  writeFileSync(
    join(outDir, "catalogue.json"),
    `${JSON.stringify({ format: FORMAT, packs: entries }, null, 2)}\n`,
  );
  writeFileSync(join(outDir, "assets.json"), `${JSON.stringify(assets, null, 2)}\n`);
  return { entries, assets };
}

/** `--name value` pairs from argv, refusing anything unexpected — `pack-sign.mjs`'s own arg reader, one file over. */
function readArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`catalogue: unexpected argument "${String(key)}".`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

/**
 * Every pack the folder holds, by id: a folder with a `<id>.meta.json` beside
 * it. `only` narrows it to the ids given, which is what publishing in waves
 * needs — a maintainer whose upload hit a rate limit publishes the packs that
 * are wholly up, and adds the rest when the limit resets, without a second copy
 * of the pack folders to tell the tool which ones those are.
 */
export function packIdsIn(packsDir, only) {
  const found = readdirSync(packsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => statSync(join(packsDir, `${name}.meta.json`), { throwIfNoEntry: false }) != null)
    .sort();
  if (only === undefined) return found;
  for (const id of only) {
    if (!found.includes(id)) throw new Error(`catalogue: --only names "${id}", which has no pack.`);
  }
  return found.filter((id) => only.includes(id));
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  for (const needed of ["packs", "out", "base"]) {
    if (args[needed] === undefined) {
      process.stderr.write(
        "usage: node scripts/packs/catalogue.mjs --packs <dir> --out <dir> --base <release url>\n",
      );
      process.exit(2);
    }
  }
  const only = args.only === undefined ? undefined : args.only.split(",").map((id) => id.trim());
  const { entries, assets } = await buildCatalogue({
    packIds: packIdsIn(args.packs, only),
    packsDir: args.packs,
    outDir: args.out,
    baseUrl: args.base,
  });
  const bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  process.stdout.write(
    `catalogue: ${String(entries.length)} pack(s), ${String(assets.length)} file(s), ` +
      `${String(bytes)} bytes → ${join(args.out, "catalogue.json")}\n`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

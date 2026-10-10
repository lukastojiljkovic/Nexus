// No shebang — for the reason the other gates in this directory have none: this
// module is both a CLI and an import target for its own test.
//
// ADR-091's signing tool: builds `pack.json` for a folder and writes its
// signature with the maintainer's release key.
//
//   node scripts/pack-sign.mjs --dir <pack folder> --meta <metadata.json> --key <private-key.pem>
//   node scripts/pack-sign.mjs --catalogue --file <catalogue.json> --key <private-key.pem>
//
// WHAT IT DOES AND DOES NOT DO. `--meta` is the manifest's metadata WITHOUT
// `files`: the maintainer writes what the pack IS (id, version, kind, two
// languages of copy, licence, source, `minAppVersion`) and this tool computes
// what the pack CONTAINS — each file's path, size and SHA-256, read off the
// folder, which is the half nobody can do by hand and keep correct. `--meta`
// carrying a `files` key is refused rather than ignored: a manifest whose file
// list was typed once and then hashed over is exactly the manifest that lies.
//
// The private key is READ, USED, and never printed, echoed, copied or logged.
// The only things this tool writes are `pack.json` and `pack.json.sig` in the
// folder it was pointed at, and the only things it prints are that folder, the
// file count and the pack's total size. The tests that exercise it generate a
// throwaway key per test; no real key is ever read by a test.
//
// It deliberately does NOT re-implement the app's validation. The app refuses
// what it must (`apps/desktop/src/main/packs/`), and a tool that carried its own
// copy of those rules would be a second answer to the same question — the one
// that drifts. What this tool does enforce is the one thing the app cannot: that
// the metadata it signs is complete, so `--meta` with a misspelled key is an
// error here rather than a manifest the app refuses after the key was used.

import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The manifest's file name, and its signature's. Both live at the pack's root. */
const MANIFEST_FILE = "pack.json";
/**
 * The context a pack signature covers before the manifest, so the release key's
 * signature on a pack can never pass for its signature on `SHA256SUMS.txt`.
 * `PACK_SIGNATURE_CONTEXT` in `apps/desktop/src/main/packs/verify.ts` is the
 * verifying side; the test holds the two strings together.
 */
export const PACK_SIGNATURE_CONTEXT = "nexus-pack-manifest-v1\n";
const SIGNATURE_FILE = "pack.json.sig";

/**
 * The context a CATALOGUE signature covers (ADR-103) — a THIRD context, so a
 * pack's signature can never be presented as the catalogue's nor the other way
 * round. `PACK_CATALOGUE_SIGNATURE_CONTEXT` in
 * `apps/desktop/src/main/packs/verify.ts` is the verifying side; the test holds
 * the two strings together, exactly as it does for the manifest's.
 */
export const PACK_CATALOGUE_SIGNATURE_CONTEXT = "nexus-pack-catalogue-v1\n";

/** The only format this tool writes. A future format is a deliberate edit here. */
const FORMAT = 1;

/** Every key the metadata must carry, in the order `pack.json` lists them. */
const META_KEYS = [
  "format",
  "id",
  "version",
  "kind",
  "title",
  "description",
  "licence",
  "source",
  "minAppVersion",
];

/**
 * Keys the format defines but does not require. `notice` is the first (ADR-103):
 * the safety flag, absent for every pack but the safety ones, and its value is
 * a closed set for the app's reason (`packs/manifest.ts`).
 */
const OPTIONAL_META_KEYS = ["notice"];
const NOTICES = ["safety"];

/** The two names inside a pack that are not content, and therefore not listed. */
const RESERVED_FILES = new Set([MANIFEST_FILE, SIGNATURE_FILE]);

/**
 * Every content file under `dir`, with `/`-separated paths, sizes and SHA-256
 * digests, in a stable order (directories walked in name order, so two runs
 * over an unchanged folder write byte-identical manifests).
 */
export function collectFiles(dir) {
  const files = [];
  const visit = (absolute, prefix) => {
    // Classified from the directory entries themselves, not a `stat` of the
    // path, so nothing is checked on one lookup and used on another.
    const entries = readdirSync(absolute, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const path = join(absolute, entry.name);
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (RESERVED_FILES.has(relative)) continue;
      // The app refuses a link anywhere in a pack, so signing one would only
      // produce a pack nobody can install.
      if (entry.isSymbolicLink()) {
        throw new Error(`pack-sign: "${relative}" is a link; a pack holds plain files and folders.`);
      }
      if (entry.isDirectory()) {
        visit(path, relative);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`pack-sign: "${relative}" is neither a file nor a folder.`);
      }
      const bytes = readFileSync(path);
      files.push({
        path: relative,
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  };
  visit(dir, "");
  return files;
}

/**
 * The manifest object: the metadata as written, plus the file list computed
 * from the folder.
 *
 * The key order is fixed here rather than left to the metadata's own order, so
 * that the bytes this tool signs are the same bytes regardless of how somebody
 * happened to arrange a JSON file.
 */
export function buildManifest(meta, files) {
  const manifest = {};
  for (const key of META_KEYS) {
    manifest[key] = key === "format" ? FORMAT : meta[key];
  }
  // Only when present, and after the required keys: a metadata file written
  // before `notice` existed produces exactly the bytes it always did.
  for (const key of OPTIONAL_META_KEYS) {
    if (Object.hasOwn(meta, key)) manifest[key] = meta[key];
  }
  manifest.files = files;
  return manifest;
}

/**
 * The metadata, checked for completeness and nothing else.
 *
 * A missing key and an unknown key are both refused, because both produce a
 * manifest whose meaning is not what the person who wrote it meant: the first
 * leaves a field the app's parser will refuse after the key was used, and the
 * second is a typo the app's parser refuses for a reason that names the wrong
 * field.
 */
export function checkMeta(meta) {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    throw new Error("pack-sign: --meta must be a JSON object.");
  }
  if (Object.hasOwn(meta, "files")) {
    throw new Error("pack-sign: --meta must not carry \"files\" — they are computed from the folder.");
  }
  for (const key of META_KEYS) {
    if (!Object.hasOwn(meta, key)) throw new Error(`pack-sign: --meta is missing "${key}".`);
  }
  for (const key of Object.keys(meta)) {
    if (!META_KEYS.includes(key) && !OPTIONAL_META_KEYS.includes(key)) {
      throw new Error(`pack-sign: --meta has an unknown field "${key}".`);
    }
  }
  if (meta.format !== FORMAT) {
    throw new Error(`pack-sign: "format" must be ${String(FORMAT)}.`);
  }
  if (Object.hasOwn(meta, "notice") && !NOTICES.includes(meta.notice)) {
    throw new Error(`pack-sign: "notice" must be one of ${NOTICES.join(", ")}.`);
  }
  return meta;
}

/**
 * `--name value` pairs from argv, plus the one bare flag `--catalogue`,
 * refusing anything unexpected.
 *
 * The pack form answers `{ dir, meta, key }` and the catalogue form
 * `{ catalogue: true, file, key }`: two shapes of job, and a caller that handed
 * in both at once is refused rather than guessed at.
 */
export function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; ) {
    const flag = argv[index];
    if (flag === undefined || !flag.startsWith("--")) {
      throw new Error(
        "pack-sign: usage: node scripts/pack-sign.mjs --dir <folder> --meta <metadata.json> --key <private-key.pem>" +
          " | --catalogue --file <catalogue.json> --key <private-key.pem>",
      );
    }
    const name = flag.slice(2);
    // `--catalogue` is the one flag that carries no value; every other flag is
    // a `--name value` pair.
    if (name === "catalogue") {
      values["catalogue"] = true;
      index += 1;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`pack-sign: --${name} needs a value.`);
    }
    values[name] = next;
    index += 2;
  }

  if (values["catalogue"] === true) {
    if (values["dir"] !== undefined || values["meta"] !== undefined) {
      throw new Error(
        "pack-sign: --catalogue signs a catalogue document; --dir and --meta belong to a pack.",
      );
    }
    for (const required of ["file", "key"]) {
      if (values[required] === undefined) throw new Error(`pack-sign: --${required} is required.`);
    }
    return { catalogue: true, file: values["file"], key: values["key"] };
  }
  if (values["file"] !== undefined) {
    throw new Error("pack-sign: --file belongs to --catalogue; a pack is signed with --dir and --meta.");
  }
  for (const required of ["dir", "meta", "key"]) {
    if (values[required] === undefined) {
      throw new Error(`pack-sign: --${required} is required.`);
    }
  }
  return { dir: values.dir, meta: values.meta, key: values.key };
}

/**
 * Writes `pack.json` and `pack.json.sig` for `dir`.
 *
 * The signature covers the EXACT bytes written, taken from the same buffer, so
 * there is no second serialisation that could differ in a byte.
 */
export function signPack({ dir, meta, key }) {
  const folder = resolve(dir);
  if (!statSync(folder).isDirectory()) {
    throw new Error(`pack-sign: "${folder}" is not a folder.`);
  }
  const files = collectFiles(folder);
  if (files.length === 0) {
    throw new Error("pack-sign: the folder holds no content files.");
  }
  const manifest = buildManifest(checkMeta(meta), files);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const privateKey = createPrivateKey(readFileSync(key));
  const signature = sign(
    null,
    Buffer.concat([Buffer.from(PACK_SIGNATURE_CONTEXT, "utf8"), manifestBytes]),
    privateKey,
  );

  writeFileSync(join(folder, MANIFEST_FILE), manifestBytes);
  writeFileSync(join(folder, SIGNATURE_FILE), signature);
  return {
    folder,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  };
}

/**
 * Writes `<file>.sig`: the release key's signature over the catalogue's exact
 * bytes, under the catalogue's context.
 *
 * Deliberately NOT a second implementation of the catalogue's own validation.
 * The app is the authority (`apps/desktop/src/main/packs/catalogue.ts` refuses
 * what it must), and a tool carrying its own copy of those rules is the one
 * that drifts — `pack.json`'s arrangement above, kept for the same reason. What
 * this does enforce is that the file is a JSON object, because signing a
 * document the app will refuse to parse only spends the key.
 */
export function signCatalogue({ file, key }) {
  const path = resolve(file);
  const bytes = readFileSync(path);
  const parsed = JSON.parse(bytes.toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("pack-sign: the catalogue must be a JSON object.");
  }
  const privateKey = createPrivateKey(readFileSync(key));
  const signature = sign(
    null,
    Buffer.concat([Buffer.from(PACK_CATALOGUE_SIGNATURE_CONTEXT, "utf8"), bytes]),
    privateKey,
  );
  const signaturePath = `${path}.sig`;
  writeFileSync(signaturePath, signature);
  return { file: path, signaturePath, bytes: bytes.byteLength };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.catalogue === true) {
    const result = signCatalogue({ file: args.file, key: args.key });
    console.log(`pack-sign: ${result.signaturePath} written over ${String(result.bytes)} bytes`);
    return;
  }
  const meta = JSON.parse(readFileSync(args.meta, "utf8"));
  const result = signPack({ dir: args.dir, meta, key: args.key });
  // Counts and a folder, and never a byte of the key or of the content.
  console.log(
    `pack-sign: ${MANIFEST_FILE} + ${SIGNATURE_FILE} written to ${result.folder} (${String(result.fileCount)} files, ${String(result.totalBytes)} bytes)`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

/**
 * The pack catalogue (ADR-103): the document that says which packs exist,
 * where their bytes are, and who made them.
 *
 * It is the third thing the release key signs (see `verify.ts`), and this
 * module is the half that says the bytes describe a catalogue this build is
 * willing to show and download from. It is untrusted input like a manifest:
 * it arrives over the network, so every field is checked here, and an unknown
 * field is refused rather than ignored for `manifest.ts`'s exact reason — a
 * field nothing reads is a field nothing enforces.
 *
 * TWO THINGS THIS MODULE OWNS THAT A MANIFEST DOES NOT:
 *
 *   - **The address rule.** Each file carries an `https` URL, and its host must
 *     be on the compiled-in download list (`net/offline.ts`). The list is
 *     passed in rather than imported so this module stays a pure function of
 *     the document and the rule the binary decided on. An entry with any other
 *     host is refused with `"catalogue-host"`, and that refusal happens HERE,
 *     before anything is downloaded, because the alternative is a catalogue
 *     that is allowed to point a download at any server it likes.
 *   - **The two metadata files.** `pack.json` and `pack.json.sig` are listed
 *     like any other file, with a URL, a size and a hash, so the download that
 *     follows pins every byte it fetches. The manifest cannot carry its own
 *     hash, which is why the manifest's own `files` list omits the pair; the
 *     catalogue is outside the manifest and can.
 *
 * The entry's metadata is validated with the manifest's own validators rather
 * than a second copy of the rules: a catalogue entry that describes copy,
 * licence or ids a manifest would refuse is a catalogue that would produce a
 * pack nobody can install, and the second copy of those rules is the one that
 * drifts.
 */

import { PackError } from "./errors.js";
import { PACK_CATALOGUE_LIMITS, PACK_LIMITS } from "./limits.js";
import {
  asCappedCopy,
  asKind,
  asLicence,
  asNotice,
  asObject,
  asPackId,
  asSource,
  asVersion,
  type PackKind,
  type PackLicence,
  type PackNotice,
  type PackSource,
  type PackText,
} from "./manifest.js";
import { packPathProblem } from "./paths.js";

/** The only catalogue `format` this build reads. A different one is a deliberate edit here. */
export const PACK_CATALOGUE_FORMAT = 1;

/**
 * The catalogue's own address. Compiled in, never fetched from anywhere: this
 * one URL is the entry point of the whole feature, and a document that could
 * name where the next document comes from would be a redirection chain this
 * process could not vouch for. Its host is `github.com`, which is on
 * `DOWNLOAD_HOSTS` already (`release-assets.githubusercontent.com` is where a
 * release asset 302-redirects to, and the download rule checks every hop).
 */
export const PACK_CATALOGUE_URL =
  "https://github.com/lukastojiljkovic/nexus-packs/releases/download/catalogue/catalogue.json";

/** The detached signature over the catalogue's exact bytes. */
export const PACK_CATALOGUE_SIGNATURE_URL = `${PACK_CATALOGUE_URL}.sig`;

/** One file of a pack, as the catalogue pins it: where it is, how big, and which bytes. */
export interface PackCatalogueFile {
  /** The path inside the pack, `/`-separated, `pack.json` and `pack.json.sig` included. */
  readonly path: string;
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
}

/**
 * One pack the catalogue offers.
 *
 * `size` is what the DOWNLOAD weighs — every listed file, the manifest and its
 * signature included — because it is the number a free-space check and a
 * progress bar need. The manifest's own `size` is the content alone, and the
 * two are different questions.
 */
export interface PackCatalogueEntry {
  readonly id: string;
  readonly version: string;
  readonly kind: PackKind;
  readonly title: PackText;
  readonly description: PackText;
  readonly size: number;
  readonly licence: PackLicence;
  readonly source: PackSource;
  readonly notice: PackNotice | null;
  readonly files: readonly PackCatalogueFile[];
}

export interface PackCatalogue {
  readonly format: number;
  readonly packs: readonly PackCatalogueEntry[];
}

/** The keys of the document, of one entry, and of one file, in one place each. */
const CATALOGUE_KEYS: readonly string[] = ["format", "packs"];
const ENTRY_KEYS: readonly string[] = [
  "id",
  "version",
  "kind",
  "title",
  "description",
  "size",
  "licence",
  "source",
  "notice",
  "files",
];
const OPTIONAL_ENTRY_KEYS: readonly string[] = ["notice"];
const FILE_KEYS: readonly string[] = ["path", "url", "size", "sha256"];

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The refusal for a key the catalogue does not define.
 *
 * The document has its own code rather than the manifest's: a catalogue is a
 * different file with a different vocabulary, and "the pack's pack.json carries
 * an unknown field" is the wrong sentence to show a user who is looking at a
 * catalogue that did not load. The rule itself is `manifest.ts`'s, restated
 * because the code is what differs.
 */
function requireKnownFields(record: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new PackError("catalogue-unreadable", `${where} carries an unknown field "${key}".`);
    }
  }
}

/** The two names a pack's root always holds, and the catalogue must always pin. */
const PACK_MANIFEST_FILE = "pack.json";
const PACK_SIGNATURE_FILE = "pack.json.sig";

function catalogueRefusal(where: string, detail: string): PackError {
  return new PackError("catalogue-entry", `${where} ${detail}`);
}

/**
 * An `https` address on an allowlisted host, or a refusal.
 *
 * The rule is `isHttpsHostAllowed`'s, applied here to the document rather than
 * to a request: https only, and the host matched exactly. A `http://` URL, a
 * URL with credentials, an odd port and an unparseable string all answer the
 * same way, because the download may not reach any of them.
 */
function asPinnedUrl(value: unknown, hosts: readonly string[], where: string): string {
  if (typeof value !== "string") {
    throw new PackError("catalogue-host", `${where} must be a string address.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PackError("catalogue-host", `${where} is not a readable address.`);
  }
  if (parsed.protocol !== "https:" || !hosts.includes(parsed.host)) {
    throw new PackError(
      "catalogue-host",
      `${where} is not an https address on a host this app may download from.`,
    );
  }
  return value;
}

function asFile(value: unknown, hosts: readonly string[], where: string): PackCatalogueFile {
  const record = asObject(value, where);
  requireKnownFields(record, FILE_KEYS, where);

  const problem = packPathProblem(record["path"]);
  if (problem !== null) {
    throw catalogueRefusal(where, `names a path a pack may not use (${problem}).`);
  }
  const path = record["path"] as string;

  const size = record["size"];
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw catalogueRefusal(where, "must state a non-negative whole number of bytes.");
  }
  if (size > PACK_LIMITS.fileBytes) {
    throw catalogueRefusal(where, `is over the ${String(PACK_LIMITS.fileBytes)}-byte per-file cap.`);
  }

  const sha256 = record["sha256"];
  if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256.toLowerCase())) {
    throw catalogueRefusal(where, "must carry a 64-character SHA-256.");
  }

  return { path, url: asPinnedUrl(record["url"], hosts, `${where}.url`), size, sha256: sha256.toLowerCase() };
}

function asFiles(value: unknown, hosts: readonly string[]): readonly PackCatalogueFile[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw catalogueRefusal('"files"', "must be a non-empty array.");
  }
  if (value.length > PACK_LIMITS.files) {
    throw catalogueRefusal('"files"', `lists more than the ${String(PACK_LIMITS.files)}-file cap.`);
  }

  const files = value.map((entry, index) => asFile(entry, hosts, `"files[${String(index)}]"`));
  const seen = new Set<string>();
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (seen.has(key)) {
      throw catalogueRefusal(`"files"`, `names "${file.path}" twice.`);
    }
    seen.add(key);
  }
  // Both metadata files are pinned like content, and neither may be missing: a
  // download without them produces a folder the install refuses, and a
  // catalogue that could omit them would be a catalogue whose packs carry a
  // manifest nobody downloaded.
  if (!seen.has(PACK_MANIFEST_FILE) || !seen.has(PACK_SIGNATURE_FILE)) {
    throw catalogueRefusal(
      '"files"',
      `must list both "${PACK_MANIFEST_FILE}" and "${PACK_SIGNATURE_FILE}".`,
    );
  }
  return files;
}

function asEntrySize(value: unknown, files: readonly PackCatalogueFile[]): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw catalogueRefusal('"size"', "must be a non-negative whole number of bytes.");
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  // Stated and computed both: a size that is not the sum is a progress bar and
  // a free-space check that disagree with the download they describe.
  if (value !== total) {
    throw catalogueRefusal(
      '"size"',
      `is ${String(value)} bytes; the listed files add up to ${String(total)}.`,
    );
  }
  if (value > PACK_LIMITS.packBytes + PACK_LIMITS.manifestBytes + PACK_LIMITS.signatureBytes) {
    throw catalogueRefusal('"size"', "is over the pack cap.");
  }
  return value;
}

function asEntry(value: unknown, hosts: readonly string[], index: number): PackCatalogueEntry {
  const where = `"packs[${String(index)}]"`;
  const record = asObject(value, where);
  requireKnownFields(record, [...ENTRY_KEYS, ...OPTIONAL_ENTRY_KEYS], where);

  const files = asFiles(record["files"], hosts);
  return {
    id: asPackId(record["id"]),
    version: asVersion(record["version"], "catalogue-entry", `${where}.version`),
    kind: asKind(record["kind"]),
    title: asCappedCopy(record["title"], "catalogue-entry", `${where}.title`, PACK_LIMITS.titleChars),
    description: asCappedCopy(
      record["description"],
      "catalogue-entry",
      `${where}.description`,
      PACK_LIMITS.descriptionChars,
    ),
    size: asEntrySize(record["size"], files),
    licence: asLicence(record["licence"]),
    source: asSource(record["source"]),
    notice: asNotice(record["notice"]),
    files,
  };
}

/**
 * The catalogue, validated field by field, or a `PackError` naming the rule
 * broken. Never a partial catalogue.
 *
 * `hosts` is the compiled-in download list: this module decides nothing about
 * which hosts are reachable, it applies the list it is handed to every address
 * in the document.
 */
export function parsePackCatalogue(value: unknown, hosts: readonly string[]): PackCatalogue {
  const record = asObject(value, "catalogue.json");
  requireKnownFields(record, CATALOGUE_KEYS, "catalogue.json");

  if (record["format"] !== PACK_CATALOGUE_FORMAT) {
    throw new PackError(
      "format-unknown",
      `catalogue.json: this build reads format ${String(PACK_CATALOGUE_FORMAT)} only.`,
    );
  }
  const packs = record["packs"];
  if (!Array.isArray(packs) || packs.length === 0) {
    throw new PackError("catalogue-unreadable", 'catalogue.json: "packs" must be a non-empty array.');
  }
  if (packs.length > PACK_CATALOGUE_LIMITS.packs) {
    throw new PackError(
      "limit",
      `catalogue.json lists more than the ${String(PACK_CATALOGUE_LIMITS.packs)}-pack cap.`,
    );
  }

  const entries = packs.map((entry, index) => asEntry(entry, hosts, index));
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new PackError("catalogue-entry", `catalogue.json names the pack "${entry.id}" twice.`);
    }
    seen.add(entry.id);
  }
  return { format: PACK_CATALOGUE_FORMAT, packs: entries };
}

/** The catalogue's total download size: every file of every entry, added up. */
export function catalogueBytes(catalogue: PackCatalogue): number {
  return catalogue.packs.reduce((sum, entry) => sum + entry.size, 0);
}

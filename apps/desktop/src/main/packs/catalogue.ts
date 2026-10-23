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
 * **Format 2 pins a pack's manifest, not its files** (ADR-103, amended for
 * 2.5). Format 1 listed every file of every pack with its URL, size and digest:
 * 22 packs and 2,716 files made a 966,906-byte document against a 1 MiB cap, so
 * the next few packs would have made every 2.1 install refuse the whole list.
 * An entry now pins two files, `pack.json` and `pack.json.sig`, by size and
 * SHA-256, and names the base address the pack's release assets live under. The
 * download fetches those two, checks the release key's signature on the
 * manifest, and only then fetches the files the SIGNED manifest lists, each
 * pinned by the manifest's own size and digest (`download.ts`). Every byte is
 * still pinned before it is fetched; the pin for the content moved from this
 * document into the one the key signed for that pack. Format 1 stays published,
 * frozen, for the builds that read it.
 *
 * WHAT THIS MODULE OWNS THAT A MANIFEST DOES NOT:
 *
 *   - **The address rule.** The assets base is an `https` URL whose host must
 *     be on the compiled-in download list (`net/offline.ts`). The list is passed
 *     in rather than imported so this module stays a pure function of the
 *     document and the rule the binary decided on. Any other host is refused
 *     with `"catalogue-host"` here, before anything is downloaded.
 *   - **The agreement between an entry and its manifest.** `catalogueContentFiles`
 *     is the check that the manifest a download fetched is the pack the entry
 *     described — same id, same version, the stated file count and size — so a
 *     catalogue cannot advertise one pack and deliver another.
 *
 * The entry's metadata is validated with the manifest's own validators rather
 * than a second copy of the rules: a catalogue entry that describes copy,
 * licence or ids a manifest would refuse is a catalogue that would produce a
 * pack nobody can install, and the second copy of those rules is the one that
 * drifts.
 */

import { packAssetUrl } from "./assets.js";
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
  packContentBytes,
  type PackKind,
  type PackLicence,
  type PackManifest,
  type PackNotice,
  type PackSource,
  type PackText,
} from "./manifest.js";
import { PACK_MANIFEST_FILE, PACK_SIGNATURE_FILE } from "./source.js";

/** The only catalogue `format` this build reads. A different one is a deliberate edit here. */
export const PACK_CATALOGUE_FORMAT = 2;

/**
 * The catalogue's own address. Compiled in, never fetched from anywhere: this
 * one URL is the entry point of the whole feature, and a document that could
 * name where the next document comes from would be a redirection chain this
 * process could not vouch for. Its host is `github.com`, which is on
 * `DOWNLOAD_HOSTS` already (`release-assets.githubusercontent.com` is where a
 * release asset 302-redirects to, and the download rule checks every hop).
 * Format 2 lives under its own release, `catalogue-2`, because the format-1
 * document at `catalogue` is what every 2.1 install reads and must not change
 * shape under them.
 */
export const PACK_CATALOGUE_URL =
  "https://github.com/lukastojiljkovic/nexus-packs/releases/download/catalogue-2/catalogue.json";

/** The detached signature over the catalogue's exact bytes. */
export const PACK_CATALOGUE_SIGNATURE_URL = `${PACK_CATALOGUE_URL}.sig`;

/** A file an entry pins by its bytes; its address is the entry's `assets` base and `assets.ts`'s name. */
export interface PackPinnedFile {
  readonly size: number;
  readonly sha256: string;
}

/** One file of a download, as the downloader fetches it: where it is, how big, and which bytes. */
export interface PackCatalogueFile {
  /** The path inside the pack, `/`-separated. */
  readonly path: string;
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
}

/**
 * One pack the catalogue offers.
 *
 * `size` is what the DOWNLOAD weighs — every file, the manifest and its
 * signature included — because it is the number a free-space check and a
 * progress bar need; `fileCount` counts the same files. Neither can be checked
 * against a file list here, because the list is the manifest's: both are
 * checked against it the moment the download has the signed manifest in hand.
 */
export interface PackCatalogueEntry {
  readonly id: string;
  readonly version: string;
  readonly kind: PackKind;
  readonly title: PackText;
  readonly description: PackText;
  readonly size: number;
  readonly fileCount: number;
  readonly licence: PackLicence;
  readonly source: PackSource;
  readonly notice: PackNotice | null;
  /** The oldest app that can use the pack; a build older than this does not show the entry. */
  readonly minAppVersion: string;
  /** The https base every file's release asset lives under, ending in `/`. */
  readonly assets: string;
  readonly manifest: PackPinnedFile;
  readonly signature: PackPinnedFile;
}

export interface PackCatalogue {
  readonly format: number;
  readonly packs: readonly PackCatalogueEntry[];
}

/** The keys of the document, of one entry, and of one pinned file, in one place each. */
const CATALOGUE_KEYS: readonly string[] = ["format", "packs"];
const ENTRY_KEYS: readonly string[] = [
  "id",
  "version",
  "kind",
  "title",
  "description",
  "size",
  "fileCount",
  "licence",
  "source",
  "minAppVersion",
  "assets",
  "manifest",
  "signature",
];
const OPTIONAL_ENTRY_KEYS: readonly string[] = ["notice"];
const PINNED_KEYS: readonly string[] = ["size", "sha256"];

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

/** A whole number of bytes, at most `cap`. */
function asByteCount(value: unknown, cap: number, where: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw catalogueRefusal(where, "must state a non-negative whole number of bytes.");
  }
  if (value > cap) {
    throw catalogueRefusal(where, `is over the ${String(cap)}-byte cap.`);
  }
  return value;
}

function asPinnedFile(value: unknown, cap: number, where: string): PackPinnedFile {
  const record = asObject(value, where);
  requireKnownFields(record, PINNED_KEYS, where);
  const sha256 = record["sha256"];
  if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256.toLowerCase())) {
    throw catalogueRefusal(where, "must carry a 64-character SHA-256.");
  }
  return { size: asByteCount(record["size"], cap, `${where}.size`), sha256: sha256.toLowerCase() };
}

/**
 * The base every asset address is built on: an allowlisted https URL that ends
 * in `/` and carries no query or fragment, so that appending an asset name can
 * only ever produce an address under that one path on that one host.
 */
function asAssetsBase(value: unknown, hosts: readonly string[], where: string): string {
  const base = asPinnedUrl(value, hosts, where);
  const parsed = new URL(base);
  if (!base.endsWith("/") || parsed.search !== "" || parsed.hash !== "" || base !== parsed.toString()) {
    throw catalogueRefusal(where, "must be a plain address ending in a slash.");
  }
  return base;
}

function asFileCount(value: unknown): number {
  // The manifest's cap on its own list, plus the manifest and its signature.
  const cap = PACK_LIMITS.files + 2;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 2 || value > cap) {
    throw catalogueRefusal('"fileCount"', `must be a whole number from 2 to ${String(cap)}.`);
  }
  return value;
}

function asEntry(value: unknown, hosts: readonly string[], index: number): PackCatalogueEntry {
  const where = `"packs[${String(index)}]"`;
  const record = asObject(value, where);
  requireKnownFields(record, [...ENTRY_KEYS, ...OPTIONAL_ENTRY_KEYS], where);

  const manifest = asPinnedFile(record["manifest"], PACK_LIMITS.manifestBytes, `${where}.manifest`);
  const signature = asPinnedFile(record["signature"], PACK_LIMITS.signatureBytes, `${where}.signature`);
  const size = asByteCount(
    record["size"],
    PACK_LIMITS.packBytes + PACK_LIMITS.manifestBytes + PACK_LIMITS.signatureBytes,
    `${where}.size`,
  );
  // The two pinned files are part of the download, so the total cannot be smaller.
  if (size < manifest.size + signature.size) {
    throw catalogueRefusal(`${where}.size`, "is smaller than the manifest and its signature together.");
  }
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
    size,
    fileCount: asFileCount(record["fileCount"]),
    licence: asLicence(record["licence"]),
    source: asSource(record["source"]),
    notice: asNotice(record["notice"]),
    minAppVersion: asVersion(record["minAppVersion"], "catalogue-entry", `${where}.minAppVersion`),
    assets: asAssetsBase(record["assets"], hosts, `${where}.assets`),
    manifest,
    signature,
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

/** The two files a download fetches first, at the addresses the entry's base and the asset rule give them. */
export function catalogueMetadataFiles(entry: PackCatalogueEntry): readonly PackCatalogueFile[] {
  return [
    { path: PACK_MANIFEST_FILE, ...entry.manifest },
    { path: PACK_SIGNATURE_FILE, ...entry.signature },
  ].map((file) => ({ ...file, url: packAssetUrl(entry.assets, entry.id, file.path, file.sha256) }));
}

/**
 * The content files a download fetches once it holds the signed manifest, or a
 * refusal when that manifest is not the pack the entry described.
 *
 * Called only after the manifest's signature has been checked, so `manifest` is
 * the release key's statement of what the pack contains; what this adds is that
 * the CATALOGUE told the truth about it. A manifest of another id or version, or
 * one whose files do not add up to the entry's count and size, is refused with
 * `"catalogue-entry"` before a single content byte is asked for.
 */
export function catalogueContentFiles(entry: PackCatalogueEntry, manifest: PackManifest): readonly PackCatalogueFile[] {
  if (manifest.id !== entry.id || manifest.version !== entry.version) {
    throw catalogueRefusal(
      `"${entry.id}" ${entry.version}`,
      `downloaded the manifest of "${manifest.id}" ${manifest.version}.`,
    );
  }
  const total = entry.manifest.size + entry.signature.size + packContentBytes(manifest);
  if (manifest.files.length + 2 !== entry.fileCount || total !== entry.size) {
    throw catalogueRefusal(
      `"${entry.id}"`,
      `states ${String(entry.fileCount)} files and ${String(entry.size)} bytes; its manifest gives ${String(
        manifest.files.length + 2,
      )} and ${String(total)}.`,
    );
  }
  return manifest.files.map((file) => ({
    path: file.path,
    url: packAssetUrl(entry.assets, entry.id, file.path, file.sha256),
    size: file.size,
    sha256: file.sha256,
  }));
}

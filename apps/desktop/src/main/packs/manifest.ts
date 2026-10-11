/**
 * `pack.json`, parsed and refused rather than trusted.
 *
 * The manifest is the pack's whole claim about itself: what it is, who made it,
 * under which licence, and which bytes each file is supposed to contain. It
 * arrives inside the pack, so it is untrusted input like the files it
 * describes — and the signature over its exact bytes (see `verify.ts`) is what
 * makes it a claim rather than a suggestion. This module is the other half:
 * the signature says the maintainer wrote these bytes, and this module says the
 * bytes describe a pack this build is willing to install.
 *
 * The format is fixed at 1. An unknown `format` is refused rather than
 * best-effort parsed, because a format change is exactly the case where
 * guessing produces a pack installed with the meaning of a field changed under
 * it.
 *
 * **Unknown fields are refused, everywhere.** A field the format does not
 * define is either a typo (`minAppVerison`) or a newer format's field, and both
 * are worse read past than refused: the first installs a pack whose minimum
 * version was never checked, and the second installs a format-2 pack under
 * format-1 rules. The rule is per OBJECT — the top level and each nested record
 * — so a typo inside `licence` is refused as loudly as one at the top.
 */

import { parseVersion } from "../update/version.js";
import { PackError } from "./errors.js";
import { PACK_LIMITS } from "./limits.js";
import { isSafePackIdSegment, isSafePackPath, packPathProblem } from "./paths.js";

/** The only `format` this build knows. */
export const PACK_FORMAT = 1;

/**
 * The six kinds of content a pack may carry.
 *
 * `tool` is ADR-094's kind and the one that is not content: it carries a
 * program the app runs as a separate process, and it is the one kind that must
 * state which of its files that program is (`tool.entry`) and how to speak to
 * it (`tool.protocol`). ADR-091 said a pack carries no code and is never
 * executed; ADR-094 amends that for this kind and for this kind only.
 */
export const PACK_KINDS = ["zim", "map", "dataset", "model", "content", "tool"] as const;
export type PackKind = (typeof PACK_KINDS)[number];

/**
 * The notices a pack may declare about itself (ADR-103).
 *
 * One value, `"safety"`, and it means one thing: this pack is survival, first
 * aid, food-preservation or car-emergency reference material, and the app must
 * show the disclaimer wherever it is read. It is a closed set rather than free
 * text because it is a decision the UI acts on — a `notice` nothing recognises
 * is a pack the reader would open with no disclaimer at all, which is the one
 * outcome the field exists to prevent.
 */
export const PACK_NOTICES = ["safety"] as const;
export type PackNotice = (typeof PACK_NOTICES)[number];

/** How a tool pack's entry is driven. UCI engines speak a line protocol; everything else is a plain stdin/stdout filter. */
export const TOOL_PROTOCOLS = ["uci", "stdio"] as const;
export type ToolProtocol = (typeof TOOL_PROTOCOLS)[number];

/** One string per language, both required: the copy is Serbian and English, always. */
export interface PackText {
  readonly sr: string;
  readonly en: string;
}

export interface PackFileEntry {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface PackLicence {
  readonly spdx: string;
  readonly attribution: string;
  readonly url: string;
}

export interface PackSource {
  readonly name: string;
  readonly url: string;
}

/**
 * A tool pack's program, as the signed manifest states it.
 *
 * `entry` is one of the pack's own `files` — the same path, exactly — and it is
 * the only thing the app ever starts from a pack. `args` are the program's fixed
 * argument list, written by whoever built the pack and covered by the release
 * key's signature; a caller may append its own arguments, and nothing a
 * renderer sends ever reaches argv.
 */
export interface ToolSpec {
  /** The pack-relative path of the executable, which must be one of `files`. */
  readonly entry: string;
  readonly protocol: ToolProtocol;
  readonly args?: readonly string[];
}

export interface PackManifest {
  readonly format: number;
  readonly id: string;
  readonly version: string;
  readonly kind: PackKind;
  readonly title: PackText;
  readonly description: PackText;
  readonly files: readonly PackFileEntry[];
  readonly licence: PackLicence;
  readonly source: PackSource;
  readonly minAppVersion: string;
  /**
   * What the app must say about this pack wherever it is read, or `null`.
   * Optional in format 1 (ADR-103): no pack had shipped when it was added, so
   * the format was amended rather than bumped, and an absent field means "no
   * notice", never "unknown".
   */
  readonly notice: PackNotice | null;
  /** Present on a `tool` pack, refused on every other kind. */
  readonly tool?: ToolSpec;
}

const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const HTTP_URL = /^https?:\/\//i;

/** The keys of the top level, and of every nested record, in one place each. */
const MANIFEST_KEYS: readonly string[] = [
  "format",
  "id",
  "version",
  "kind",
  "notice",
  "title",
  "description",
  "files",
  "licence",
  "source",
  "minAppVersion",
  "tool",
];
const TEXT_KEYS: readonly string[] = ["sr", "en"];
const FILE_KEYS: readonly string[] = ["path", "size", "sha256"];
const LICENCE_KEYS: readonly string[] = ["spdx", "attribution", "url"];
const SOURCE_KEYS: readonly string[] = ["name", "url"];
const TOOL_KEYS: readonly string[] = ["entry", "protocol", "args"];

export function asObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PackError("manifest-unreadable", `${where} must be an object.`);
  }
  return value as Record<string, unknown>;
}

/**
 * The refusal for a key the format does not define. A record's own keys are the
 * whole of what its shape is, so an unknown one is a refusal and not a warning:
 * a field nothing reads is a field nothing enforces.
 */
export function requireKnownKeys(record: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new PackError("manifest-unreadable", `${where} carries an unknown field "${key}".`);
    }
  }
}

export function asRequiredString(record: Record<string, unknown>, key: string, code: PackError["code"], where: string): string {
  const value = record[key];
  // eslint-disable-next-line no-control-regex -- a control character in copy is exactly what this refuses.
  if (typeof value !== "string" || value.trim() === "" || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PackError(code, `${where} must be a non-empty string.`);
  }
  return value;
}

export function asCappedCopy(
  value: unknown,
  code: PackError["code"],
  where: string,
  maxChars: number,
): PackText {
  const record = asObject(value, where);
  requireKnownKeys(record, TEXT_KEYS, where);
  const sr = asRequiredString(record, "sr", code, `${where}.sr`);
  const en = asRequiredString(record, "en", code, `${where}.en`);
  if (sr.length > maxChars || en.length > maxChars) {
    throw new PackError(code, `${where} must be at most ${String(maxChars)} characters per language.`);
  }
  return { sr, en };
}

export function asUrl(record: Record<string, unknown>, key: string, code: PackError["code"], where: string): string {
  const value = asRequiredString(record, key, code, `${where}.${key}`);
  if (!HTTP_URL.test(value)) {
    throw new PackError(code, `${where}.${key} must be an http or https address.`);
  }
  return value;
}

/**
 * A pack version: `MAJOR.MINOR.PATCH`, no leading `v`, no surrounding
 * whitespace.
 *
 * The comparison itself reuses `update/version.ts`'s parser rather than
 * re-writing the grammar, and that module's parser is the strict one — no
 * leading zeros, safe integers, no pre-release. The `v` prefix it tolerates is
 * refused here because a version is also a directory name on disk: `1.0.0` and
 * `v1.0.0` must not be two folders for one version.
 */
export function asVersion(value: unknown, code: PackError["code"], where: string): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.startsWith("v") ||
    parseVersion(value) === null
  ) {
    throw new PackError(code, `${where} must be MAJOR.MINOR.PATCH with no leading v.`);
  }
  return value;
}

export function asPackId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > PACK_LIMITS.idLength ||
    !KEBAB_ID.test(value) ||
    !isSafePackIdSegment(value)
  ) {
    throw new PackError(
      "id-invalid",
      `"id" must be kebab-case (a-z, 0-9 and single hyphens), at most ${String(PACK_LIMITS.idLength)} characters, and a usable folder name.`,
    );
  }
  return value;
}

export function asKind(value: unknown): PackKind {
  if (!(PACK_KINDS as readonly unknown[]).includes(value)) {
    throw new PackError("kind-unknown", `"kind" must be one of ${PACK_KINDS.join(", ")}.`);
  }
  return value as PackKind;
}

export function asFileEntry(value: unknown, index: number): PackFileEntry {
  const where = `"files[${String(index)}]"`;
  const record = asObject(value, where);
  requireKnownKeys(record, FILE_KEYS, where);

  const problem = packPathProblem(record["path"]);
  if (problem !== null) {
    throw new PackError("path-invalid", `${where}.path is not a usable pack path (${problem}).`);
  }
  const path = record["path"] as string;

  const size = record["size"];
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw new PackError("size-invalid", `${where}.size must be a non-negative whole number of bytes.`);
  }
  if (size > PACK_LIMITS.fileBytes) {
    throw new PackError("limit", `${where}.size is over the ${String(PACK_LIMITS.fileBytes)}-byte per-file cap.`);
  }

  const hash = record["sha256"];
  if (typeof hash !== "string" || !SHA256_HEX.test(hash.toLowerCase())) {
    throw new PackError("hash-invalid", `${where}.sha256 must be 64 hexadecimal characters.`);
  }
  return { path, size, sha256: hash.toLowerCase() };
}

/**
 * The manifest's `notice`, or `null` when it carries none.
 *
 * An absent field is `null`; anything present that is not one of
 * {@link PACK_NOTICES} is refused, because a `notice` this build does not
 * understand is a disclaimer it would not draw.
 */
export function asNotice(value: unknown): PackNotice | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !(PACK_NOTICES as readonly string[]).includes(value)) {
    throw new PackError("notice-invalid", `"notice" must be one of ${PACK_NOTICES.join(", ")}.`);
  }
  return value as PackNotice;
}

export function asLicence(value: unknown): PackLicence {
  const record = asObject(value, '"licence"');
  requireKnownKeys(record, LICENCE_KEYS, '"licence"');
  const spdx = asRequiredString(record, "spdx", "licence-invalid", '"licence"');
  if (spdx.length > 64) {
    throw new PackError("licence-invalid", '"licence".spdx must be at most 64 characters.');
  }
  const attribution = asRequiredString(record, "attribution", "licence-invalid", '"licence".attribution');
  return {
    spdx,
    attribution,
    url: asUrl(record, "url", "licence-invalid", '"licence"'),
  };
}

export function asSource(value: unknown): PackSource {
  const record = asObject(value, '"source"');
  requireKnownKeys(record, SOURCE_KEYS, '"source"');
  const name = asRequiredString(record, "name", "source-invalid", '"source".name');
  if (name.length > PACK_LIMITS.titleChars) {
    throw new PackError("source-invalid", '"source".name is too long.');
  }
  return { name, url: asUrl(record, "url", "source-invalid", '"source"') };
}

function asFiles(value: unknown): readonly PackFileEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PackError("files-invalid", '"files" must be a non-empty array.');
  }
  if (value.length > PACK_LIMITS.files) {
    throw new PackError("limit", `"files" lists more than the ${String(PACK_LIMITS.files)}-file cap.`);
  }

  const files = value.map((entry, index) => asFileEntry(entry, index));
  // Exact duplicates and case-only duplicates are both one file on the
  // filesystem this app installs onto, so both are refused here rather than
  // discovered as "extra file" while copying.
  const seen = new Map<string, string>();
  for (const file of files) {
    const key = file.path.toLowerCase();
    const first = seen.get(key);
    if (first === file.path) {
      throw new PackError("path-duplicate", `"files" lists "${file.path}" twice.`);
    }
    if (first !== undefined) {
      throw new PackError(
        "path-duplicate-case",
        `"files" lists "${first}" and "${file.path}", which are one file on Windows.`,
      );
    }
    seen.set(key, file.path);
  }

  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > PACK_LIMITS.packBytes) {
    throw new PackError("limit", `"files" add up to more than the ${String(PACK_LIMITS.packBytes)}-byte pack cap.`);
  }
  return files;
}

/**
 * A tool pack's `tool`, or the refusal that names the rule it broke.
 *
 * The field is refused on every kind but `tool` rather than ignored: a
 * `content` pack carrying one is a pack whose author expected it to be run, and
 * reading past the field would install a pack that does nothing the author
 * meant. `entry` must be one of `files` exactly, because it is the path
 * `tools/run.ts` joins under the installed folder and then hashes: an `entry`
 * that is not a listed file is a path whose bytes nothing ever promised.
 */
function asTool(
  value: unknown,
  kind: PackKind,
  files: readonly PackFileEntry[],
): ToolSpec | undefined {
  if (kind !== "tool") {
    if (value !== undefined) {
      throw new PackError("tool-invalid", `"tool" is only defined for a pack of kind "tool" (this one is "${kind}").`);
    }
    return undefined;
  }
  if (value === undefined) {
    throw new PackError("tool-invalid", 'a pack of kind "tool" must carry "tool".');
  }

  const record = asObject(value, '"tool"');
  requireKnownKeys(record, TOOL_KEYS, '"tool"');

  const entry = asRequiredString(record, "entry", "tool-invalid", '"tool".entry');
  if (!files.some((file) => file.path === entry)) {
    throw new PackError("tool-invalid", `"tool".entry "${entry}" is not one of the manifest's files.`);
  }

  const protocol = record["protocol"];
  if (!(TOOL_PROTOCOLS as readonly unknown[]).includes(protocol)) {
    throw new PackError("tool-invalid", `"tool".protocol must be one of ${TOOL_PROTOCOLS.join(", ")}.`);
  }

  const rawArgs = record["args"];
  if (rawArgs === undefined) {
    return { entry, protocol: protocol as ToolProtocol };
  }
  if (!Array.isArray(rawArgs) || rawArgs.length > PACK_LIMITS.toolArgs) {
    throw new PackError("tool-invalid", `"tool".args must be an array of at most ${String(PACK_LIMITS.toolArgs)} strings.`);
  }
  const argumentProblem = `every entry of "tool".args must be a non-empty string of at most ${String(PACK_LIMITS.toolArgChars)} characters, with no control characters.`;
  for (const argument of rawArgs) {
    if (typeof argument !== "string" || argument === "" || argument.length > PACK_LIMITS.toolArgChars) {
      throw new PackError("tool-invalid", argumentProblem);
    }
    // eslint-disable-next-line no-control-regex -- a C0 character inside an argument is exactly what this refuses.
    if (/[\u0000-\u001f\u007f]/.test(argument)) throw new PackError("tool-invalid", argumentProblem);
  }
  return { entry, protocol: protocol as ToolProtocol, args: rawArgs as readonly string[] };
}

/**
 * The manifest, validated field by field, or a `PackError` naming the rule that
 * was broken. Never a partial manifest: a caller that gets one back has a shape
 * it can use without re-checking anything.
 */
export function parsePackManifest(value: unknown): PackManifest {
  const record = asObject(value, "pack.json");
  requireKnownKeys(record, MANIFEST_KEYS, "pack.json");

  if (record["format"] !== PACK_FORMAT) {
    throw new PackError("format-unknown", `pack.json: this build reads format ${String(PACK_FORMAT)} only.`);
  }

  const kind = asKind(record["kind"]);
  const files = asFiles(record["files"]);
  const tool = asTool(record["tool"], kind, files);

  return {
    format: PACK_FORMAT,
    id: asPackId(record["id"]),
    version: asVersion(record["version"], "version-invalid", '"version"'),
    kind,
    title: asCappedCopy(record["title"], "title-invalid", '"title"', PACK_LIMITS.titleChars),
    description: asCappedCopy(
      record["description"],
      "description-invalid",
      '"description"',
      PACK_LIMITS.descriptionChars,
    ),
    files,
    licence: asLicence(record["licence"]),
    source: asSource(record["source"]),
    minAppVersion: asVersion(record["minAppVersion"], "min-app-version-invalid", '"minAppVersion"'),
    notice: asNotice(record["notice"]),
    // Spread rather than `tool: undefined`, which `exactOptionalPropertyTypes`
    // forbids and which would also put an absent key back into a manifest that
    // a later `JSON.stringify` would then serialise.
    ...(tool === undefined ? {} : { tool }),
  };
}

/** The pack's own bytes: every listed file's size, added up. */
export function packContentBytes(manifest: PackManifest): number {
  return manifest.files.reduce((sum, file) => sum + file.size, 0);
}

/** Whether this manifest names only paths a pack may name. Kept for tests and for the reader's own guard. */
export function manifestPathsAreSafe(manifest: PackManifest): boolean {
  return manifest.files.every((file) => isSafePackPath(file.path));
}

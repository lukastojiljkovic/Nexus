/**
 * THE CURATED LIST, PARSED AND REFUSED RATHER THAN TRUSTED, plus the small
 * on-disk registry of what is installed.
 *
 * `catalogue.json` ships INSIDE the app: it is written by
 * `scripts/assistant-catalogue.mjs` at release time and covered by the app's own
 * release signature and the asar integrity fuse (ADR-096, and the reason the
 * file carries no signature of its own). It is still parsed like any other
 * input, because "signed" is a claim about the RELEASE and this file's reader
 * has to be the thing that refuses a field it does not understand — the same
 * rule `packs/manifest.ts` follows for a signed pack.
 *
 * Three shapes live in here, and they are deliberately parsed by one set of
 * functions:
 *
 *   - a **catalogue entry**: the contract's `ModelEntry`, plus the `fit` block
 *     `--fit` measured and, for an imported file, the `path` it was imported
 *     from. The contract's `ModelEntry` is the shape everything else sees;
 *     `fit` and `path` are this module's own extension of it, which the
 *     contract explicitly allows ("a part that needs more than a type says so
 *     by extending its own interface").
 *   - the **installed registry**, `models/installed.json`, which holds those
 *     same entries as they were installed. It is derived and rebuilt-tolerant
 *     exactly like `packs/installed.json`: a missing or unreadable registry is
 *     an empty list, never a thrown error, because a bookkeeping file must not
 *     be able to stop the app from loading a model that is sitting right there.
 *   - a **Hugging Face search result**, which has no `fit` because nobody has
 *     measured it — `fitOf` answers `null` and the chooser skips it.
 *
 * `contextTokens: 0` MEANS "NOT KNOWN YET". A repository listing does not say
 * how long a context the model was trained for; only the file's own header does.
 * A search result therefore carries 0, and `llama.ts` reads it as "use the
 * runtime's default context" rather than as "load a zero-token context".
 */

import type { ModelCapability, ModelEntry, ModelLicence, ModelOrigin } from "@nexus/core";
import catalogueJson from "./catalogue.json";
import { parseQuantization } from "./quantization.js";

/** The fit figures `--fit` measured, in bytes, at `contextTokens`. */
export interface CatalogueFit {
  /** The context both figures were measured at — `CHAT_CONTEXT_TOKENS`. */
  readonly contextTokens: number;
  /** Weights on the card plus the context. What a full offload must fit in. */
  readonly vramBytes: number;
  /** The host side of that same full offload. */
  readonly hostRamBytes: number;
  /** Everything in RAM: the weights and the context, CPU-only. */
  readonly cpuRamBytes: number;
}

/** A catalogue entry at runtime: the contract's model, plus what this part knows. */
export interface CatalogueEntry extends ModelEntry {
  readonly fit?: CatalogueFit;
  /** Where an `origin: "file"` model lives. Never set for a download. */
  readonly path?: string;
}

/** Why an entry, a registry or a catalogue was refused. Machine codes; the caller writes the sentence. */
export type CatalogueProblem = "shape" | "id" | "hash" | "size" | "capability" | "origin" | "licence";

/** A refusal from this module, naming the field it refused. */
export class CatalogueError extends Error {
  readonly problem: CatalogueProblem;

  constructor(problem: CatalogueProblem, message: string) {
    super(message);
    this.name = "CatalogueError";
    this.problem = problem;
  }
}

/** The format this build writes and understands. A future format is a future parser. */
export const CATALOGUE_FORMAT = 1;

/** The registry's own format, kept apart from the catalogue's. */
export const MODELS_REGISTRY_VERSION = 1;

/** An id is a directory name this app makes and a key in a JSON file. Bounded, lower-case, dashed. */
const ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const CAPABILITIES: readonly ModelCapability[] = ["chat", "tools", "vision", "embedding"];

const ORIGINS: readonly ModelOrigin[] = ["catalogue", "huggingface", "file"];

const ENTRY_KEYS: readonly string[] = [
  "id",
  "origin",
  "title",
  "family",
  "repo",
  "file",
  // Stored by the registry (it writes the contract's own entry back) and IGNORED
  // when read: `parseEntry` derives the quantization from the file name, which is
  // the one place that reads one, so a stored copy could never be believed over it.
  "quantization",
  "sha256",
  "sizeBytes",
  "contextTokens",
  "capabilities",
  "languages",
  "licence",
  // `projectorFile` is the refresher's input — the name of the file it must
  // measure — and `projector` is what it measured. Both live in the file because
  // a later refresh needs to know which file to measure again; the runtime reads
  // `projector`, and this field is read by nothing here.
  "projectorFile",
  "projector",
  "fit",
  "path",
];

const LICENCE_KEYS: readonly string[] = ["name", "url"];
const PROJECTOR_KEYS: readonly string[] = ["file", "sha256", "sizeBytes"];
const FIT_KEYS: readonly string[] = ["contextTokens", "vramBytes", "hostRamBytes", "cpuRamBytes"];

/**
 * The fit of an entry, or `null` when this build has not measured one.
 *
 * Exported and used by `recommend.ts`, so the shape of the extra field is known
 * in exactly one place: an entry that comes from a search, an import, or a
 * hand-written test fixture simply has no fit, and the chooser skips it instead
 * of guessing that it fits.
 */
export function fitOf(entry: ModelEntry): CatalogueFit | null {
  const value = (entry as CatalogueEntry).fit;
  if (value === undefined) return null;
  if (
    !Number.isSafeInteger(value.contextTokens) ||
    value.contextTokens <= 0 ||
    !Number.isSafeInteger(value.vramBytes) ||
    value.vramBytes <= 0 ||
    !Number.isSafeInteger(value.hostRamBytes) ||
    value.hostRamBytes < 0 ||
    !Number.isSafeInteger(value.cpuRamBytes) ||
    value.cpuRamBytes <= 0
  ) {
    return null;
  }
  return value;
}

/**
 * The bundled catalogue, parsed on first use and remembered.
 *
 * A parse failure answers an EMPTY list rather than throwing, and that is the
 * contract's own requirement for `catalogue()`: "empty when it cannot be
 * verified". A build whose catalogue does not parse has no picks to offer, and a
 * user staring at an assistant that will not start because a JSON file has a
 * typo is worse than a user told there are no recommended models yet.
 */
let bundled: readonly CatalogueEntry[] | null = null;

export function bundledCatalogue(): readonly CatalogueEntry[] {
  if (bundled !== null) return bundled;
  try {
    bundled = parseCatalogue(catalogueJson);
  } catch {
    bundled = [];
  }
  return bundled;
}

/** The entries of a catalogue document, or a `CatalogueError` naming what is wrong with it. */
export function parseCatalogue(value: unknown): readonly CatalogueEntry[] {
  const document = asRecord(value, "the catalogue");
  if (document["format"] !== CATALOGUE_FORMAT) {
    throw new CatalogueError("shape", "The catalogue's format is not one this build reads.");
  }
  const models = document["models"];
  if (!Array.isArray(models)) throw new CatalogueError("shape", "The catalogue has no models list.");
  const entries = models.map((model) => parseEntry(model, "catalogue"));
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) throw new CatalogueError("id", "The catalogue names one id twice.");
  for (const entry of entries) {
    if (entry.licence.name === "" || entry.licence.url === "") {
      // The catalogue is written by a tool that refuses an entry without them;
      // this is the reader's half of that promise.
      throw new CatalogueError("licence", `"${entry.id}" states no licence a user could read.`);
    }
    // The catalogue is ours, so a file whose NAME states no quantization is a
    // mistake in the list rather than a fact about a model: a user choosing
    // between `Q4_K_M` and `Q8_0` is the whole point of the field.
    if (entry.quantization === "") {
      throw new CatalogueError("shape", `"${entry.file}" in the catalogue states no quantization.`);
    }
  }
  return entries;
}

/**
 * One entry, refused unless every field is the shape the app acts on.
 *
 * Unknown keys are refused (`packs/manifest.ts`'s rule and its reason: a typo
 * and a newer format's field are both worse read past than refused), and an
 * entry with no licence or a licence with no readable URL is refused outright —
 * the licence is the one thing a user has to see before spending a gigabyte.
 */
export function parseEntry(value: unknown, where: string): CatalogueEntry {
  const record = asRecord(value, `an entry of ${where}`);
  requireKnownKeys(record, ENTRY_KEYS, `an entry of ${where}`);

  const id = asId(record["id"]);
  const origin = record["origin"];
  if (typeof origin !== "string" || !ORIGINS.includes(origin as ModelOrigin)) {
    throw new CatalogueError("origin", `"${id}" has an origin this build does not know.`);
  }
  const sha256 = asString(record["sha256"], "hash", "sha256");
  if (!SHA256_PATTERN.test(sha256)) throw new CatalogueError("hash", `"${id}" has no SHA-256.`);
  const sizeBytes = asPositiveInteger(record["sizeBytes"], "size", "sizeBytes");

  const capabilities = asArray(record["capabilities"], "capability").map((capability) => {
    if (typeof capability !== "string" || !CAPABILITIES.includes(capability as ModelCapability)) {
      throw new CatalogueError("capability", `"${id}" claims a capability this build does not know.`);
    }
    return capability as ModelCapability;
  });
  const languages = asArray(record["languages"], "shape").map((language) => asString(language, "shape", "languages"));
  const licence = parseLicence(record["licence"], id);
  const contextTokens = Number.isSafeInteger(record["contextTokens"]) ? Number(record["contextTokens"]) : -1;
  if (contextTokens < 0) throw new CatalogueError("shape", `"${id}" has no usable context length.`);
  const file = asString(record["file"], "shape", "file");

  const parsed: CatalogueEntry = {
    id,
    origin: origin as ModelOrigin,
    title: asString(record["title"], "shape", "title"),
    family: asString(record["family"], "shape", "family"),
    repo: typeof record["repo"] === "string" ? record["repo"] : "",
    file,
    sha256,
    sizeBytes,
    // Derived from the file name rather than read from a field, so the two can
    // never disagree: `parseQuantization` is the one place that reads one.
    quantization: parseQuantization(file) ?? "",
    contextTokens,
    capabilities,
    languages,
    licence,
  };

  const projector = record["projector"];
  let decodedProjector: CatalogueEntry["projector"];
  if (projector !== undefined) {
    const file = asRecord(projector, "projector");
    requireKnownKeys(file, PROJECTOR_KEYS, `the projector of "${id}"`);
    decodedProjector = {
      file: asString(file["file"], "shape", "projector.file"),
      sha256: asString(file["sha256"], "hash", "projector.sha256"),
      sizeBytes: asPositiveInteger(file["sizeBytes"], "size", "projector.sizeBytes"),
    };
    if (!SHA256_PATTERN.test(decodedProjector.sha256)) {
      throw new CatalogueError("hash", `The projector of "${id}" has no SHA-256.`);
    }
  }

  const fit = record["fit"];
  let decodedFit: CatalogueFit | undefined;
  if (fit !== undefined) {
    const block = asRecord(fit, "fit");
    requireKnownKeys(block, FIT_KEYS, `the fit of "${id}"`);
    decodedFit = {
      contextTokens: asPositiveInteger(block["contextTokens"], "shape", "fit.contextTokens"),
      vramBytes: asPositiveInteger(block["vramBytes"], "shape", "fit.vramBytes"),
      hostRamBytes: asNonNegativeInteger(block["hostRamBytes"], "shape", "fit.hostRamBytes"),
      cpuRamBytes: asPositiveInteger(block["cpuRamBytes"], "shape", "fit.cpuRamBytes"),
    };
  }

  const path = record["path"];
  return {
    ...parsed,
    ...(decodedProjector === undefined ? {} : { projector: decodedProjector }),
    ...(decodedFit === undefined ? {} : { fit: decodedFit }),
    ...(path === undefined ? {} : { path: asString(path, "shape", "path") }),
  };
}

/**
 * A licence, or a refusal.
 *
 * The name is what a screen shows; the URL is where a user reads the terms. For
 * the catalogue both are required — the file is ours and is written by a tool
 * that refuses to write an entry without them — while an imported file answers
 * with whatever its own header said, which may be nothing.
 */
function parseLicence(value: unknown, id: string): ModelLicence {
  const record = asRecord(value, `the licence of "${id}"`);
  requireKnownKeys(record, LICENCE_KEYS, `the licence of "${id}"`);
  // Both halves may be empty here, because an IMPORTED file answers with what its
  // own header said and a header may say nothing. `parseCatalogue` is where the
  // catalogue's stricter rule lives — the file that ships in the app must name a
  // licence, an import must merely be honest about not knowing one.
  const name = typeof record["name"] === "string" ? record["name"] : "";
  const url = typeof record["url"] === "string" ? record["url"] : "";
  return { name, url };
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CatalogueError("shape", `${where} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireKnownKeys(record: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new CatalogueError("shape", `${where} carries an unknown field "${key}".`);
    }
  }
}

function asString(value: unknown, problem: CatalogueProblem, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CatalogueError(problem, `${field} must be a non-empty string.`);
  }
  return value;
}

/**
 * An entry's id, BOUNDED (`check:ids`'s rule at every boundary: validated for
 * existence is not validated at all).
 *
 * An id here does double duty — a key in a JSON file this app writes, and for a
 * downloaded model the NAME OF A DIRECTORY under `userData/models` — so the shape
 * is fixed rather than merely non-empty: lower-case, dashes and dots, no leading
 * dot, at most 64 characters. That is what makes `join(modelsRoot, id)` a path
 * that cannot leave the directory it is joined to, and it is why the registry's
 * own reader refuses anything else.
 */
function asId(value: unknown): string {
  // The check is written out rather than routed through `asString`: `check:ids`
  // reads the call sites of the unbounded helpers, and a bounded helper that
  // calls one with an id-shaped field name is indistinguishable from the mistake
  // the gate exists to find.
  if (typeof value !== "string" || value.trim() === "" || !ID_PATTERN.test(value)) {
    throw new CatalogueError("id", `"${String(value)}" is not an id this app writes.`);
  }
  return value;
}

function asArray(value: unknown, problem: CatalogueProblem): readonly unknown[] {
  if (!Array.isArray(value)) throw new CatalogueError(problem, "A list field is not a list.");
  return value;
}

function asPositiveInteger(value: unknown, problem: CatalogueProblem, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new CatalogueError(problem, `${field} must be a positive whole number.`);
  }
  return value as number;
}

function asNonNegativeInteger(value: unknown, problem: CatalogueProblem, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new CatalogueError(problem, `${field} must be a whole number and not negative.`);
  }
  return value as number;
}

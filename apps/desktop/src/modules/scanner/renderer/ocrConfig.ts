/**
 * The scanner's OCR configuration: the three paths tesseract.js loads its
 * runtime from, as a pure function - and the rule that decides whether one of
 * them is local.
 *
 * **What the three paths are, and why every one of them must be set.** With no
 * options at all tesseract.js resolves all three against jsDelivr: its worker
 * script, its WebAssembly core, and - when `langPath` is unset - the language
 * data, which it downloads per language into the app's cache. That is fine for
 * a website and wrong for this product twice over: the app's egress boundary
 * cancels the request, and the feature is supposed to work with the network off
 * by construction. Setting all three is therefore not an optimisation, it is
 * the difference between an offline scanner and a scanner that fails in the
 * mode it was built for - which is what `ocrConfig.test.ts` pins.
 *
 * **Worker and core come from the app bundle; the language data comes from a
 * pack.** The two code files are versioned with `tesseract.js` and shipped in
 * the renderer (`electron.vite.config.ts`'s `ocrAssets` plugin emits them, in
 * one directory, under the names tesseract.js looks for). The models are not:
 * they are content, several megabytes each, published under their own licence
 * and replaced independently of the app (ADR-091). They are read from the
 * installed pack through `nx-pack:`, the privileged scheme the packs run
 * registers - so `langPath` is a pack URL and nothing else.
 *
 * **`cacheMethod: "none"`, deliberately.** tesseract.js's own performance guide
 * says not to disable language caching; that advice is about a browser
 * deployment whose fallback is a NETWORK download. Here the fallback cannot
 * happen - `langPath` is a local file - and the cache would be a second
 * multi-megabyte copy of data the pack already stores, written next to a pack
 * directory that may be read-only. So the deviation is the recommended one for
 * a local `langPath`, and it is stated here rather than discovered later.
 *
 * **`workerBlobURL: false`, and this one is not a preference either.** The
 * default wraps the worker script in a `blob:` URL to dodge cross-origin
 * restrictions. This renderer's CSP is `default-src 'self'` with no
 * `worker-src`, and the app's own script URLs already satisfy it; a blob worker
 * would be the one construct that needs the policy widened, in exchange for
 * nothing (`excalidrawAssets.ts` records the same reasoning for fonts, and the
 * refusal to widen the policy for them).
 */

/** The tessdata models this build knows: the two Serbian scripts and English. */
export const OCR_LANGUAGES = ["srp", "srp_latn", "eng"] as const;

export type OcrLanguage = (typeof OCR_LANGUAGES)[number];

/** The pack the language models come from, and the folder inside it. */
export const TESSDATA_PACK_ID = "tessdata-fast";
export const TESSDATA_FOLDER = "tessdata";

/** Where the two code files are, as URLs the page resolved from its own location. */
export interface OcrAssetPaths {
  /** The worker script tesseract.js spawns. */
  readonly worker: string;
  /** The directory holding the core builds - a directory, because the core loader appends the file name it picks. */
  readonly core: string;
}

/** The options handed to `createWorker`. A subset of tesseract.js's `WorkerOptions`, spelled out so the test can read every one of them. */
export interface ScanOcrOptions {
  readonly workerPath: string;
  readonly corePath: string;
  readonly langPath: string;
  readonly gzip: boolean;
  readonly cacheMethod: string;
  readonly workerBlobURL: boolean;
}

/**
 * Everything one recognition session is configured with: the `langs` argument
 * `createWorker` takes first, and the options it takes third. One object rather
 * than two values passed separately, so the page cannot hand the worker a
 * language list and a path set that were built from different decisions.
 */
export interface ScanOcrConfig extends ScanOcrOptions {
  /** The `langs` argument: `srp_latn+eng`, and the only place it is spelled. */
  readonly languages: string;
}

/** The schemes that are this machine and nowhere else. */
const LOCAL_SCHEMES = new Set(["file:", "nx-pack:"]);

/**
 * The loopback hosts, allowed for ONE reason: `pnpm dev` serves the renderer
 * over http on loopback, so in development the app's own assets are http URLs.
 * It is the same hole `net/offline.ts`'s `devServerOrigin` documents - absent
 * from every packaged build, because the page is loaded from `file:` there and
 * the asset URLs it resolves are `file:` URLs. A host name is matched exactly;
 * `localhost.example.com` is not loopback.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether a path may be handed to tesseract.js, and the answer is deliberately
 * strict in both directions.
 *
 * **A remote URL is refused** - any scheme that is not `file:` or `nx-pack:`
 * (and, for the dev server only, loopback http). That is the property the whole
 * config exists for.
 *
 * **A relative URL is refused too**, and that is the half a plausible-looking
 * config gets wrong. tesseract.js's browser worker does
 * `importScripts(workerPath)`, and inside a worker a relative path resolves
 * against the wrong base - the failure the project's own FAQ documents as
 * "Cannot find module". The page always resolves these against `location.href`
 * (`ocrAssets.ts`), which is absolute in both the packaged app and dev.
 */
export function isLocalOcrSource(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (LOCAL_SCHEMES.has(parsed.protocol)) return true;
  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    LOOPBACK_HOSTS.has(parsed.hostname)
  );
}

/** The `nx-pack://` URL whose folder holds the models, as `<lang>.traineddata.gz`. */
export function packLanguagePath(packId: string = TESSDATA_PACK_ID): string {
  return `nx-pack://${packId}/${TESSDATA_FOLDER}`;
}

/**
 * The `langs` argument: the chosen models joined with `+`, in the order the
 * caller chose them, with a repeat dropped.
 *
 * Not sorted: the order is the user's, and tesseract's own multi-language
 * behaviour is documented in terms of the list it is given. A repeat is not a
 * refusal but a deduplication, because the page's three checkboxes can only
 * produce distinct codes and a message that says `srp_latn+srp_latn` would be
 * the app repeating itself.
 */
export function languageArgument(languages: readonly OcrLanguage[]): string {
  const seen = new Set<string>();
  for (const language of languages) {
    if (!OCR_LANGUAGES.includes(language)) {
      throw new Error(`Unknown tessdata language "${String(language)}".`);
    }
    seen.add(language);
  }
  if (seen.size === 0) throw new Error("At least one language must be selected.");
  return [...seen].join("+");
}

/**
 * The whole configuration, and a refusal rather than a warning for a path that
 * is not local: a config that quietly accepted a CDN URL is a scanner that
 * quietly reaches the network, which is exactly the failure this function is
 * the boundary against.
 */
export function buildOcrOptions(
  assets: OcrAssetPaths,
  languages: readonly OcrLanguage[],
): ScanOcrConfig {
  for (const [name, url] of [
    ["workerPath", assets.worker],
    ["corePath", assets.core],
  ] as const) {
    if (!isLocalOcrSource(url)) {
      throw new Error(
        `Refusing a non-local ${name}: "${url}" is not a file:, nx-pack: or dev-server URL.`,
      );
    }
  }
  return {
    languages: languageArgument(languages),
    workerPath: assets.worker,
    corePath: assets.core,
    langPath: packLanguagePath(),
    gzip: true,
    cacheMethod: "none",
    workerBlobURL: false,
  };
}

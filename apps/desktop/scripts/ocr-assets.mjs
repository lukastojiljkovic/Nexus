// The OCR runtime files, put beside the renderer's page under the exact names
// tesseract.js loads them by.
//
// WHY A PLUGIN RATHER THAN `public/`, for `excalidrawFonts`'s reason exactly
// (`electron.vite.config.ts`): Vite copies `public/` verbatim, so the files
// would be committed to the repository - eleven megabytes of WebAssembly and
// vendor JavaScript that already exist in `node_modules`, re-committed every
// time `tesseract.js` is upgraded. Emitting at build time keeps one copy of
// them, in the dependency they belong to.
//
// WHY THEY CANNOT BE IMPORTED. Vite hashes and relocates every imported asset,
// and these two are loaded BY NAME at runtime: tesseract.js's worker does
// `importScripts(workerPath)`, and its core loader appends the name of the
// build this machine's SIMD support selects. So the three core variants and the
// worker script are emitted unchanged, in one directory, and the dev server
// answers the same paths while developing (which is what makes
// `renderer/src/modules/scanner/renderer/ocrAssets.ts` a single base URL in
// both modes).
//
// The LSTM-only variants are the three that matter: the scanner asks for
// `OEM.LSTM_ONLY`, which is also the default, so the non-LSTM builds
// (`tesseract-core*.wasm.js`, 4.7 MB each) are never fetched and are
// deliberately not shipped.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { posix } from "node:path";

/** The directory the files land in, relative to the built page. */
export const OCR_ASSET_DIR = "ocr";

/** `node_modules` resolution, starting from the packages that own the files. */
const require = createRequire(import.meta.url);
const tesseractRequire = createRequire(require.resolve("tesseract.js/package.json"));

/**
 * Every file, with the absolute path it is read from. Resolved once at load:
 * the packages are installed (a devDependency-adjacent guarantee of
 * `apps/desktop/package.json`), and a missing one must fail the BUILD rather
 * than produce a bundle whose worker 404s at runtime.
 */
const FILES = [
  ["worker.min.js", require.resolve("tesseract.js/dist/worker.min.js")],
  ...[
    "tesseract-core-lstm.wasm.js",
    "tesseract-core-simd-lstm.wasm.js",
    "tesseract-core-relaxedsimd-lstm.wasm.js",
  ].map((name) => [name, tesseractRequire.resolve(`tesseract.js-core/${name}`)]),
];

/**
 * The renderer plugin: serve these paths in dev, emit them in a build.
 *
 * Its name is `nexus-`-prefixed like the other two in the config, and it is the
 * LAST plugin in the renderer list on purpose - it adds no transform to the
 * module graph, only files.
 */
export function ocrAssets() {
  return {
    name: "nexus-ocr-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? "";
        if (!url.startsWith(`/${OCR_ASSET_DIR}/`)) return next();
        const name = (url.slice(OCR_ASSET_DIR.length + 2).split("?")[0] ?? "").replace(/\/+$/, "");
        const file = FILES.find(([fileName]) => fileName === name);
        // The tail is matched against the files that exist rather than joined
        // into a path, so there is nothing here for a `..` to escape.
        if (file === undefined) return next();
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.end(readFileSync(file[1]));
      });
    },
    generateBundle() {
      for (const [name, path] of FILES) {
        this.emitFile({
          type: "asset",
          // Rollup asset names are posix paths regardless of platform.
          fileName: posix.join(OCR_ASSET_DIR, name),
          source: readFileSync(path),
        });
      }
    },
  };
}

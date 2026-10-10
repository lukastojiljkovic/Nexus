import type { OcrAssetPaths } from "./ocrConfig.js";

/**
 * Where the app's own OCR code lives, resolved against the page the way
 * `excalidrawAssets.ts` resolves Excalidraw's fonts: `new URL("./ocr/...", ...)`
 * against the page's own address, which is a `file:` URL in the packaged app
 * and the dev server's http URL under `pnpm dev`.
 *
 * **Why the two files are beside the page rather than inside the bundle.** Vite
 * hashes and relocates every imported asset, and tesseract.js loads these two by
 * NAME: its worker does `importScripts(workerPath)`, and its core loader appends
 * one of `tesseract-core-<variant>-lstm.wasm.js` to the directory it is given
 * (choosing by the SIMD features this machine reports). So the files have to sit
 * in one directory under the names the library knows, which is exactly what
 * `electron.vite.config.ts`'s `ocrAssets` plugin emits - and what its dev-server
 * half serves, since a middleware answers the same paths while developing.
 *
 * A module-scope read of `location.href` on purpose: this file is imported by
 * the page, so it runs when the page's chunk loads, and the answer is the built
 * page's own directory in both modes.
 */
export const OCR_ASSETS: OcrAssetPaths = {
  worker: new URL("./ocr/worker.min.js", location.href).href,
  core: new URL("./ocr/", location.href).href,
};

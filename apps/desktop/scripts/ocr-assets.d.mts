import type { Plugin } from "vite";

/** The directory the OCR runtime files are emitted into, relative to the built page. */
export declare const OCR_ASSET_DIR: string;

/**
 * The renderer plugin that puts tesseract.js's worker script and the three
 * LSTM-only core builds beside the built page (and serves them in dev).
 */
export declare function ocrAssets(): Plugin;

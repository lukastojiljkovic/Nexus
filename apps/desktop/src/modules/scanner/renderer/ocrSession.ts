import { OEM, createWorker, type Worker as TesseractWorker } from "tesseract.js";
import { canvasFromPixels } from "./canvasImage.js";
import { OCR_ASSETS } from "./ocrAssets.js";
import { buildOcrOptions, languageArgument, type OcrLanguage } from "./ocrConfig.js";
import { pageLines, scanOutcome, type ScanOutcome } from "./ocrResult.js";
import type { RgbaImage } from "./imageOps.js";

/**
 * The scanner's one session with the OCR engine: a worker the page owns, kept
 * alive between scans and torn down when the page goes away.
 *
 * **Why the engine is not re-created per scan.** Creating a tesseract.js worker
 * loads its WebAssembly core (the LSTM-only builds this module ships are about
 * 11.7 MB) and then the language models, both inside the worker, before the
 * first line of text is recognised. Doing that per scan would make the second
 * scan of a page as slow as the first for no gain. The session therefore keeps
 * one worker and re-creates it only when the LANGUAGE set changes - the one
 * option the library cannot change in place.
 *
 * **Where the work happens.** Recognition runs inside tesseract.js's own Web
 * Worker; the page only forwards pixels and receives progress, so the UI thread
 * never spends the seconds a page takes. The engine's progress callback feeds
 * the page's own bar, and `ocrResult.ts` maps its status strings onto a phase
 * the copy can name.
 *
 * **Nothing here is decided by hand.** The three paths, the gzip flag, the
 * cache policy and the `workerBlobURL` choice all come from `buildOcrOptions`,
 * which is pure and tested. This file is the glue that hands them to the
 * library, and it is the one file in the module that cannot be tested here:
 * there is no DOM and no WebAssembly in this repository's test environment.
 */

/** One progress report, in the engine's own terms. */
export interface ScanProgress {
  /** A tesseract status string - never drawn; `scanPhase` maps it to copy. */
  readonly status: string;
  /** 0..1, as the engine reports it. */
  readonly progress: number;
}

export interface ScanSession {
  /**
   * Recognises one prepared bitmap. Its pixels are drawn onto a canvas because
   * that is the shape the engine takes; everything that decided what those
   * pixels are happened before this call, in `imageOps.ts`.
   */
  recognize(
    image: RgbaImage,
    languages: readonly OcrLanguage[],
    onProgress: (progress: ScanProgress) => void,
  ): Promise<ScanOutcome>;
  /** Terminates the worker. Idempotent, and safe to call while a scan is running. */
  dispose(): Promise<void>;
}

/** A session over the app's own bundled assets and the installed pack's models. */
export function createScanSession(): ScanSession {
  let worker: TesseractWorker | null = null;
  /** The language argument the live worker was created with, so a change re-creates it. */
  let workerLanguages = "";
  /** Where the live worker's progress reports go; replaced per scan. */
  let report: (progress: ScanProgress) => void = () => undefined;

  async function dispose(): Promise<void> {
    const current = worker;
    worker = null;
    workerLanguages = "";
    report = () => undefined;
    if (current !== null) await current.terminate();
  }

  async function ensureWorker(languages: readonly OcrLanguage[]): Promise<TesseractWorker> {
    const wanted = languageArgument(languages);
    if (worker !== null && workerLanguages === wanted) return worker;
    await dispose();
    const config = buildOcrOptions(OCR_ASSETS, languages);
    const created = await createWorker(config.languages, OEM.LSTM_ONLY, {
      workerPath: config.workerPath,
      corePath: config.corePath,
      langPath: config.langPath,
      gzip: config.gzip,
      cacheMethod: config.cacheMethod,
      workerBlobURL: config.workerBlobURL,
      // The logger is bound when the worker is created and reads `report` at
      // CALL time, which is what lets one long-lived worker serve many scans
      // with a different progress handler in each.
      logger: (message) => report({ status: message.status, progress: message.progress }),
    });
    worker = created;
    workerLanguages = wanted;
    return created;
  }

  return {
    async recognize(image, languages, onProgress) {
      report = onProgress;
      try {
        const active = await ensureWorker(languages);
        const result = await active.recognize(canvasFromPixels(image));
        return scanOutcome(pageLines(result.data));
      } finally {
        report = () => undefined;
      }
    },
    dispose,
  };
}

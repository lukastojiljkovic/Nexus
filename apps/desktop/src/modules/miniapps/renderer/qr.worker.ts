/**
 * The QR reader's Web Worker: the decode runs here, off the thread that draws
 * the window.
 *
 * **Why a worker at all.** Binarising and decoding a photograph is tens of
 * milliseconds of straight CPU; on the renderer's own thread that is a frozen
 * window, and the page's own brief says heavy computation belongs here. The
 * message protocol is deliberately the smallest thing that can work: an
 * `ImageData`-shaped object in (its buffer TRANSFERRED, so no copy is made), a
 * string or `null` back. Nothing about zxing crosses the boundary - the worker
 * is `qrDecode.ts` plus three lines, which is also why the decode itself can be
 * tested without a worker.
 *
 * Vite bundles this file as its own chunk because the page reaches it through
 * `new Worker(new URL("./qr.worker.ts", import.meta.url), { type: "module" })`.
 */
import { decodeRgba } from "./qrDecode.js";

export interface QrRequest {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

/** A decode answer: the text, or `null` for an image without a readable code. */
export type QrResponse = string | null;

/**
 * The two members of the worker global this file uses.
 *
 * Declared here rather than typed as `DedicatedWorkerGlobalScope`, which lives
 * in TypeScript's `webworker` lib: this file is typechecked by the renderer's
 * project, whose `lib` is the DOM one (there is no `window` here at runtime, but
 * there is a `self`, and `postMessage` on the DOM's `Window` signature takes a
 * target origin this side never has).
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<QrRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<QrRequest>): void => {
  const { width, height, rgba } = event.data;
  let text: QrResponse = null;
  try {
    text = decodeRgba({ width, height, rgba });
  } catch (error) {
    // A refused buffer is the page's bug, not the user's; answer "no code" so
    // the worker stays alive for the next attempt rather than dying on the
    // first malformed message.
    console.error("Nexus: the QR worker could not read that image:", error);
  }
  scope.postMessage(text);
};

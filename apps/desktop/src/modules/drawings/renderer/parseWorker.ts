import { DxfViewer } from "dxf-viewer";
import { readBytesMessage } from "./workerProtocol.js";

/**
 * DRAWINGS' parse worker: `dxf-viewer`'s worker side, plus the one thing the
 * library cannot do offline - reading a drawing and a font from bytes the page
 * already holds.
 *
 * **What the library asks of this script.** Its documentation says a worker
 * handed to `Load()` through `workerFactory` must call `DxfViewer.SetupWorker()`
 * at its top level, and the library is right that nothing else is needed to
 * READ A FILE FROM A URL. This app cannot hand it a URL: the packaged renderer
 * is a `file:` page with `connect-src 'self'`, so a worker `fetch` of the
 * drawing has nothing to talk to. The three steps below are therefore the
 * smallest thing that closes that gap, and none of them touch a file of the
 * library's:
 *
 *   1. our own envelopes are stored, keyed by the private URL they name;
 *   2. `fetch` answers those URLs from that store, and delegates everything
 *      else to the real `fetch` unchanged;
 *   3. our handler is wrapped AROUND the library's, so an envelope of ours never
 *      reaches a parser that would log it as a bad signature.
 *
 * **Termination is the page's, not this file's.** A file that takes too long to
 * parse is stopped by the page calling `worker.terminate()`, which is the only
 * way to interrupt synchronous parsing at all: an abandoned worker cannot
 * respond, and the page stops waiting for it.
 */

const pending = new Map<string, Uint8Array>();

/** The URL a fetch is about, whichever of the three shapes it was given in. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const realFetch: typeof fetch = self.fetch.bind(self);

self.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const bytes = pending.get(urlOf(input));
  if (bytes === undefined) return realFetch(input, init);
  // Consumed rather than kept: the library fetches each URL once, and a 32 MiB
  // drawing has no business staying in this worker's heap after it is parsed.
  pending.delete(urlOf(input));
  // The bytes are reshaped for `Response` rather than copied: `postMessage`
  // hands over an unsliced buffer, so this is the same memory seen through the
  // declared type `BodyInit` wants.
  return Promise.resolve(new Response(bytes as Uint8Array<ArrayBuffer>));
};

DxfViewer.SetupWorker();

/**
 * The library's own handler, wrapped rather than replaced: everything that is
 * not ours goes to it exactly as before, including the message that starts the
 * load. `self.onmessage` is the property the library sets (its worker wrapper
 * assigns it in its constructor), which is why an `addEventListener` here would
 * leave both handlers running on the same event.
 */
const libraryHandler = self.onmessage;

self.onmessage = (event: MessageEvent): void => {
  const envelope = readBytesMessage(event.data);
  if (envelope !== null) {
    pending.set(envelope.url, envelope.bytes);
    return;
  }
  if (libraryHandler !== null) libraryHandler.call(self, event);
};

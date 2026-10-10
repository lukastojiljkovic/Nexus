/**
 * The little protocol between DRAWINGS' page and its parse worker.
 *
 * **Why bytes are POSTED rather than fetched.** `dxf-viewer` loads a drawing -
 * and its fonts - by URL, and the worker does the `fetch` itself. This app runs
 * from `file:` in a packaged build with a `connect-src 'self'` policy, where a
 * worker's `fetch` of an asset URL is not a thing that can be relied on, and
 * where a `blob:` or `data:` URL would need the policy widened to admit it. So
 * the page hands the worker the bytes it already has - `structuredClone` moves
 * a typed array without decoding it - and the worker answers two PRIVATE URLs
 * from memory. Nothing leaves the process, and offline is a property of the
 * design rather than of a URL that happened to resolve.
 *
 * **Why the envelope has its own shape.** The library's worker client posts
 * `{signature, seq, type, data}` and the library's worker ignores anything else
 * with a `console.log`. Its messages must not be mistaken for ours, and ours
 * must not be mistaken for its, so both directions are keyed on one property
 * name the library never writes (`nxDrawing`) and the reader below refuses
 * everything else.
 */

/** The URL the drawing's own bytes are answered from. Never fetched over the network. */
export const DRAWING_URL = "nx-drawing://opened";

/** The URL the bundled font's bytes are answered from. */
export const FONT_URL = "nx-drawing://font";

/** One message the page posts to the worker: a URL, and the bytes it should answer with. */
export interface BytesMessage {
  readonly nxDrawing: {
    readonly url: string;
    readonly bytes: Uint8Array;
  };
}

/** The message for one URL and its bytes. */
export function bytesMessage(url: string, bytes: Uint8Array): BytesMessage {
  return { nxDrawing: { url, bytes } };
}

/**
 * One of our messages, or `null` for anything else - including every message the
 * library's own client posts, which is what keeps the two apart.
 */
export function readBytesMessage(value: unknown): BytesMessage["nxDrawing"] | null {
  if (typeof value !== "object" || value === null) return null;
  const envelope = (value as { nxDrawing?: unknown }).nxDrawing;
  if (typeof envelope !== "object" || envelope === null) return null;
  const { url, bytes } = envelope as { url?: unknown; bytes?: unknown };
  if (typeof url !== "string" || url === "") return null;
  if (!(bytes instanceof Uint8Array)) return null;
  return { url, bytes };
}

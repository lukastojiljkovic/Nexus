/**
 * The resource caps every update fetch runs under, and the two helpers that
 * enforce them.
 *
 * A pure module with no Electron import, for `service.ts`'s reason: the fetch
 * wiring in `electron.ts` needs a browser process, while the numbers and the
 * reading rule need to be testable without one. Nothing here decides WHAT is
 * fetched — that is `service.ts` — only how much a hostile or broken server can
 * make this process hold, and for how long it can make it wait.
 */

export const UPDATE_LIMITS = {
  jsonBytes: 1024 * 1024, // the releases/latest reply
  smallFileBytes: 64 * 1024, // SHA256SUMS.txt and its .sig
  installerBytes: 512 * 1024 * 1024,
  requestMs: 30_000, // json and bytes: whole request
  downloadIdleMs: 60_000, // installer: no chunk for this long aborts
} as const;

export class UpdateLimitError extends Error {}

/**
 * Refuses up front when a declared Content-Length is over `limit`.
 *
 * The declaration is not trusted for the count — it is a number a server can
 * simply get wrong, and `readWithin` below enforces the real cap chunk by
 * chunk. It is trusted as a HINT: a declared length over the cap means there is
 * no reason to open the body at all. A malformed or negative declaration says
 * nothing, so it is left to the read to enforce.
 */
export function assertDeclaredLength(contentLength: string | null, limit: number): void {
  if (contentLength === null) return;
  const declared = Number(contentLength);
  if (!Number.isFinite(declared) || declared < 0) return;
  if (declared > limit) {
    throw new UpdateLimitError(
      `Nexus update: the reply declared ${contentLength} bytes, over the ${String(limit)}-byte limit`,
    );
  }
}

/**
 * Reads `body` to the end, calling `onChunk` for each chunk. Throws
 * UpdateLimitError (after cancelling the reader) as soon as the running total
 * passes `limit`.
 *
 * The reader is cancelled BEFORE the throw rather than left locked for the
 * caller to clean up: by the time this returns an error, no more bytes are on
 * their way, which is the point of having a cap at all.
 */
export async function readWithin(
  body: ReadableStream<Uint8Array>,
  limit: number,
  onChunk: (chunk: Uint8Array) => void | Promise<void>,
): Promise<number> {
  const reader = body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > limit) {
        try {
          await reader.cancel();
        } catch {
          // The cap is the finding; a stream that also refuses to cancel must
          // not replace it with an unrelated error.
        }
        throw new UpdateLimitError(
          `Nexus update: the reply passed the ${String(limit)}-byte limit`,
        );
      }
      await onChunk(value);
    }
  } finally {
    reader.releaseLock();
  }
  return total;
}

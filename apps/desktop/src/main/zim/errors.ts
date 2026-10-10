/**
 * The refusals this reader answers with.
 *
 * A ZIM arrives from outside this machine — a Kiwix download, a USB stick, a
 * file somebody else made — so every number in it is untrusted input and every
 * one of them is used as an OFFSET INTO A FILE. The codes below are what the
 * reader answers instead of trusting one: a `problem` rather than a thrown
 * `RangeError` from `Buffer.readUInt32LE`, because the caller is a protocol
 * handler that has to say something to a page, and "the file is broken in this
 * way" is a sentence a page can show while a stack trace is not.
 *
 * One code per WAY of being wrong, deliberately. `corrupt` and `out-of-range`
 * look alike and are not: the first is a structure that contradicts itself (a
 * pointer list that is not sorted, a blob offset table that runs backwards), the
 * second is a structure that points outside the file. The reader's tests assert
 * the difference, because a hostile file is usually one and a truncated download
 * is usually the other.
 */
export type ZimProblem =
  /** The file could not be read, or is smaller than the 80-byte header. */
  | "io"
  /** The first four bytes are not the ZIM magic number, or the header is not 80 bytes of it. */
  | "not-zim"
  /** A major version this reader does not implement. */
  | "version"
  /** A structure that contradicts itself. */
  | "corrupt"
  /** An offset or length that points outside the file. */
  | "out-of-range"
  /** A cluster whose compression this reader does not implement (LZMA/XZ, i.e. pre-6 files). */
  | "compression"
  /** A cluster that could not be decoded into blobs. */
  | "cluster"
  /** No entry with that path or title. */
  | "not-found"
  /** A redirect chain longer than this reader will follow. */
  | "redirect"
  /**
   * A value larger than this reader is willing to hold. The bound is a
   * MEMORY bound, not a format one: a single `.zim` is 100+ GB and is never read
   * whole, so a blob, a cluster or a pointer list that asks for more than the
   * caps in `reader.ts` is refused rather than allocated.
   */
  | "too-large";

/**
 * A ZIM refusal. Thrown by everything under `main/zim/`, and turned into either
 * a rendered error or a 4xx answer by the caller — never into a rejected promise
 * the renderer sees as an unexplained exception.
 */
export class ZimError extends Error {
  readonly problem: ZimProblem;

  constructor(problem: ZimProblem, message: string) {
    super(message);
    this.name = "ZimError";
    this.problem = problem;
  }
}

/** The problem code of a thrown value when it is a ZIM refusal, and `null` when it is a bug. */
export function zimProblemOf(error: unknown): ZimProblem | null {
  return error instanceof ZimError ? error.problem : null;
}

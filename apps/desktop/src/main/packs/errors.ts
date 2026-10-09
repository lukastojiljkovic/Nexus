import type { PackRefusalCode } from "../../shared/ipc.js";

/**
 * The refusals the pack layer answers with.
 *
 * The vocabulary itself lives in `shared/ipc.ts`, beside the view shapes it
 * crosses to, because the renderer is the half that turns a code into a
 * sentence and a union declared twice is a union that drifts. Everything about
 * which code means what is documented there; this module is the exception that
 * carries one, and the helpers below.
 *
 * A refusal travels as data at the IPC boundary and as a throw below it, which
 * is the split `packsIpc.ts` makes: only an unexpected failure should reach the
 * renderer as a rejected promise.
 */
export type { PackRefusalCode };

/**
 * A refusal with a code. Thrown by every layer below the IPC one and turned
 * into an answer by `packsIpc.ts`, so a refusal travels as data and only an
 * unexpected failure travels as an exception.
 */
export class PackError extends Error {
  readonly code: PackRefusalCode;

  constructor(code: PackRefusalCode, message: string) {
    super(message);
    this.name = "PackError";
    this.code = code;
  }
}

/** The code of a thrown value when it is a refusal, and `null` when it is a bug. */
export function packRefusalCode(error: unknown): PackRefusalCode | null {
  return error instanceof PackError ? error.code : null;
}

/** A thrown value's message, for the pair of places that can only re-wrap it. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

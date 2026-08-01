import { parseCanvasRef } from "@nexus/core";
import type { CanvasRef } from "@nexus/core";
import { MAX_CANVAS_REF_BATCH } from "../shared/ipc.js";

/**
 * `canvas:resolve-refs`' payload validator (SEC-EL-02): structural checks here,
 * semantics in the store.
 *
 * **It lives in its own module rather than beside its sibling validators in
 * `index.ts` so it can be tested** — `searchGate.ts`'s arrangement, and the same
 * reason: `index.ts` imports `electron` at module scope, so nothing in it is
 * reachable from Vitest, and this is the one CANV validator whose refusals are
 * worth pinning by test rather than by review.
 *
 * **It does not reach for `asStringArray`**, deliberately. That helper caps each
 * element at a length the caller supplies, and here the grammar's own bound is
 * strictly tighter than any length could be: `parseCanvasRef` refuses everything
 * `MAX_CANVAS_REF_LENGTH` would have refused and a great deal more besides. A
 * second, looser opinion about the same string in front of it would be a bound
 * nobody reads and a shape somebody could mistake for the real gate.
 *
 * The batch cap comes from the wire contract's mirror rather than from
 * `@nexus/db` directly — the two are the same number, and taking it from here
 * keeps a validator that touches no database out of the native module's way.
 * `CanvasStore.resolveRefs` re-checks it regardless; this is the wire's copy.
 */
export function asCanvasRefs(value: unknown, field: string): CanvasRef[] {
  if (!Array.isArray(value) || value.length > MAX_CANVAS_REF_BATCH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be an array of at most ${MAX_CANVAS_REF_BATCH} references.`,
    );
  }
  return value.map((entry: unknown, index): CanvasRef => {
    const ref = typeof entry === "string" ? parseCanvasRef(entry) : null;
    if (ref === null) {
      // Named by position rather than echoed back: the string that failed is
      // untrusted renderer text, and a refusal is not a place to quote it.
      throw new Error(`Invalid IPC payload: "${field}[${index}]" is not a Nexus object reference.`);
    }
    return ref;
  });
}

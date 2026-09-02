import type { CircuitWire } from "@nexus/core";
import type { StoredCircuitDetail, StoredCircuitWire } from "@nexus/db";

import type { ElecCircuitDocument } from "../shared/ipc.js";

/**
 * The store's flat wire ROW as the domain's nested wire DOCUMENT.
 *
 * The column layout and the document are different shapes on purpose — a row
 * has `from_part_id`, a document has `from: { partId }` — and this is the one
 * place the two meet. It is main-side rather than in the store because the
 * store's job is rows and the archive wants exactly the flat one; it is here
 * rather than in the renderer because a conversion at every call site is a
 * conversion somebody eventually forgets, and `circuitProblems` reads the
 * nested form.
 *
 * It is its own module rather than a private function inside `index.ts` for a
 * plainer reason: `index.ts` is the Electron entry point, so nothing that is
 * not the app can import from it — and the demo seeder's test needs exactly
 * this conversion in order to ask `circuitProblems` whether the circuits it
 * writes are sound. A helper that cannot be reached is a helper that gets
 * copied.
 */
export function toWireDocument(row: StoredCircuitWire): CircuitWire {
  return {
    id: row.id,
    circuitId: row.circuitId,
    from: { partId: row.fromPartId, pinId: row.fromPinId },
    to: { partId: row.toPartId, pinId: row.toPinId },
    colour: row.colour,
  };
}

/** One circuit and everything on it, in the shape the canvas draws and `circuitProblems` reads. */
export function toCircuitDocument(detail: StoredCircuitDetail): ElecCircuitDocument {
  return {
    id: detail.id,
    profileId: detail.profileId,
    name: detail.name,
    notes: detail.notes,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    parts: detail.parts,
    wires: detail.wires.map(toWireDocument),
    // Spread rather than `chassis: detail.chassis`: under
    // `exactOptionalPropertyTypes` those two are different documents — the
    // second declares the key and gives it `undefined`, which survives the
    // structured clone as a key the renderer's `"chassis" in doc` would find.
    ...(detail.chassis === undefined ? {} : { chassis: detail.chassis }),
  };
}

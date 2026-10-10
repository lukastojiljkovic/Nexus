import type { GcodeModel, StlMesh } from "@nexus/core";

/**
 * What the parse worker is asked and what it answers.
 *
 * **Why the parsing is in a worker at all.** A G-code file is a million lines
 * and an STL is a million triangles: reading either one on the UI thread is a
 * frozen window for as long as it takes, which is exactly what a viewer must not
 * do. The readers themselves are pure and live in `@nexus/core`; this file is
 * only the message shape around them.
 *
 * **Why the bytes are transferred rather than copied.** The renderer has no use
 * for a file's bytes once the worker has read them, so the buffer is handed over
 * (`ArrayBuffer` in the transfer list) rather than structured-cloned - which for
 * a 32 MiB file is the difference between one copy and three.
 *
 * **Why a refusal is a code and not a sentence.** The worker has no copy table -
 * it is a module of its own with no locale - so it answers which reader refused
 * and the page words it in the reader's language.
 */

/** One request: read this buffer as this kind of file. */
export interface ParseRequest {
  readonly id: number;
  readonly kind: "model" | "toolpath";
  readonly name: string;
  readonly bytes: ArrayBuffer;
}

/** Why a parse was refused: the reader that said no, or something that is not this module's fault. */
export type ParseProblem = "not-stl" | "not-gcode" | "failed";

/** What one request answers, either way. */
export type ParseResponse =
  | { readonly id: number; readonly ok: true; readonly result: ParseResult }
  | { readonly id: number; readonly ok: false; readonly problem: ParseProblem };

/** The two results: a model with everything the page reports, or a toolpath. */
export type ParseResult =
  | { readonly kind: "model"; readonly mesh: StlMesh; readonly closed: boolean }
  | { readonly kind: "toolpath"; readonly model: GcodeModel };

/**
 * The buffers a result carries, for the transfer list.
 *
 * Listed here rather than built ad hoc at the `postMessage` call, because a
 * buffer left out of this list is silently COPIED - which for a toolpath of two
 * million segments is half a gigabyte of copying that nothing would report.
 */
export function transferablesOf(result: ParseResult): Transferable[] {
  if (result.kind === "model") return [result.mesh.positions.buffer];
  const buffers: Transferable[] = [];
  for (const layer of result.model.layers) {
    buffers.push(layer.extrusion.buffer, layer.travel.buffer);
  }
  return buffers;
}

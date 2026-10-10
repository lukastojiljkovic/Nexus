import { GcodeParseError, StlParseError, parseGcode, parseStl, stlIsClosed } from "@nexus/core";
import { transferablesOf, type ParseRequest, type ParseResponse } from "./parseProtocol.js";

/**
 * The workshop's parse worker: one message in, one answer out.
 *
 * Vite builds this file as its own chunk, reached only through the `?worker`
 * import in `workerClient.ts`, so opening a viewer is what loads the readers -
 * including `@nexus/core`'s STL and G-code halves, which nothing else in the
 * renderer needs.
 *
 * **One request at a time, and no shared state.** The page may have several
 * files in flight (a board is converted in main, a model and a toolpath may both
 * be open), and each request carries its own id, so an answer that arrives out
 * of order goes to the caller that asked for it and nowhere else.
 *
 * **Every failure is caught.** A worker that throws leaves its caller waiting
 * forever, and a malformed file is the ordinary case here rather than an
 * exceptional one - so the readers' own refusals, and anything else, become an
 * answer with a code.
 */
self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, kind, bytes } = event.data;
  try {
    if (kind === "model") {
      const mesh = parseStl(new Uint8Array(bytes));
      const result = { kind: "model", mesh, closed: stlIsClosed(mesh) } as const;
      answer({ id, ok: true, result });
      return;
    }
    const model = parseGcode(new Uint8Array(bytes));
    answer({ id, ok: true, result: { kind: "toolpath", model } });
  } catch (error) {
    const problem =
      error instanceof StlParseError
        ? "not-stl"
        : error instanceof GcodeParseError
          ? "not-gcode"
          : "failed";
    answer({ id, ok: false, problem });
  }
};

/** Posts one answer, handing over the buffers it carries instead of copying them. */
function answer(response: ParseResponse): void {
  if (!response.ok) {
    self.postMessage(response);
    return;
  }
  self.postMessage(response, { transfer: transferablesOf(response.result) });
}

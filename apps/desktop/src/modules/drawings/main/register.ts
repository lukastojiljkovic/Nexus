import type { ModuleHostSurface } from "../../../main/moduleIpc.js";
import { contract, type DrawingsOpenResult, type DrawingsPrintResult } from "../shared/ipc.js";
import { openDrawing } from "./open.js";
import { drawingsPlatform } from "./platform.js";

/**
 * DRAWINGS in the main process (ADR-090): its two handlers, and nothing else.
 *
 * **What main owns, and why.** The picker, the size cap and the PDF all need
 * something only main has - a native dialog and the window that will be printed
 * - and all three are the security-relevant half of this module: a renderer that
 * could name a path could make the app read any file on the disk, and a renderer
 * that could name a URL could make it fetch one. So the payloads are empty (see
 * `shared/ipc.ts`), the bytes are bounded by `readFileBounded` before they are
 * read, and the renderer receives what main decided to hand it.
 *
 * **The arithmetic is not here.** `openDrawing` (`./open.ts`) is the seam that
 * decides whether bytes are renderable or need the LibreDWG pack, and it is a
 * pure function with its own test. This file validates the wire, calls the
 * platform, and maps three outcomes onto the two the wire declares.
 *
 * **A refusal is an answer, not a throw.** A file over the cap, a `.txt` and a
 * DWG all come back as results the page can word in the language it is reading.
 * The only thing that throws is a payload the wire should never carry, which is
 * the validators' job and SEC-EL-02's rule.
 */
export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  ctx.handle("open", async (payload, call) => {
    // The payload is empty, so the structural check IS the whole validation -
    // and it is still run, because "this channel takes nothing" and "this
    // channel accepts anything" must not look the same to a handler.
    call.as.asRecord(payload);

    const read = await drawingsPlatform().pickAndRead();
    if (read.status === "cancelled") return { outcome: "cancelled" } satisfies DrawingsOpenResult;
    if (read.status === "refused") {
      return { outcome: "refused", code: read.code } satisfies DrawingsOpenResult;
    }

    const opened = openDrawing(read.bytes, read.kind);
    if (opened.outcome === "needs-pack") {
      return {
        outcome: "needs-pack",
        pack: opened.pack,
        catalogue: opened.catalogue,
      } satisfies DrawingsOpenResult;
    }
    return {
      outcome: "drawing",
      name: read.name,
      bytes: opened.bytes,
    } satisfies DrawingsOpenResult;
  });

  ctx.handle("print", async (payload, call) => {
    call.as.asRecord(payload);

    const printed = await drawingsPlatform().printView();
    if (printed.status === "saved") {
      return { outcome: "saved", path: printed.path } satisfies DrawingsPrintResult;
    }
    if (printed.status === "refused") {
      return { outcome: "refused", code: printed.code } satisfies DrawingsPrintResult;
    }
    return { outcome: "cancelled" } satisfies DrawingsPrintResult;
  });
}

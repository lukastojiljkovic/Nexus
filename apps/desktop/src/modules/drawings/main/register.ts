import { readFileBounded } from "../../../main/boundedRead.js";
import type { ModuleCall, ModuleHostSurface } from "../../../main/moduleIpc.js";
import { DwgError, convertDwgToDxf } from "../../../main/tools/dwg.js";
import { ModuleToolError } from "../../../main/moduleTools.js";
import { contract, type DrawingsOpenResult, type DrawingsPrintResult } from "../shared/ipc.js";
import {
  DWG_PACK_ID,
  DwgFailureError,
  MAX_DRAWING_BYTES,
  dwgFailureOf,
  openDwg,
  type DwgTool,
} from "./open.js";
import { drawingsPlatform } from "./platform.js";

/**
 * DRAWINGS in the main process (ADR-090): its two handlers, and the whole of the
 * DWG path.
 *
 * **What main owns, and why.** The picker, the size cap, the pack's process and
 * the PDF all need something only main has — a native dialog, a file system, the
 * window that will be printed — and all of them are the security-relevant half of
 * this module: a renderer that could name a path could make the app read any file
 * on the disk, and a renderer that could name a URL could make it fetch one. So
 * the payloads are empty (see `shared/ipc.ts`), every read is bounded before the
 * bytes exist, and the renderer receives what main decided to hand it.
 *
 * **The three readings of a chosen file, in one place.**
 *
 * 1. `.dxf` — read here, bounded by `MAX_DRAWING_BYTES` (`readFileBounded`), and
 *    handed on untouched.
 * 2. `.dwg` with the pack installed — the path goes to the converter
 *    (`main/tools/dwg.ts`, ADR-094 §4), which stages it under a name this app
 *    chose and answers the DXF; nothing about the file reaches a renderer.
 * 3. `.dwg` with no pack — a refusal carrying the pack's id and the Settings card
 *    that installs it, which is an answer rather than an error.
 *
 * **The arithmetic is not here.** `openDrawing`'s successor in `./open.ts` is the
 * pure seam that decides what a chosen file needs and what a conversion failure
 * means, and `converterFor` below is the one place this module touches the kit's
 * tool capability. Both are tested: the seam with a fake converter, and this file
 * through the kit with a fake platform and a real installed pack.
 *
 * **A refusal is an answer, not a throw.** A file over the cap, a `.txt` and a
 * DWG are all results the page can word in the language it is reading. The two
 * things that throw are a payload the wire should never carry — the validators'
 * job, SEC-EL-02 — and a build with no tool access at all, which is a wiring
 * mistake only `index.ts` can fix.
 */
export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  ctx.handle("open", async (payload, call) => {
    // The payload is empty, so the structural check IS the whole validation - and
    // it is still run, because "this channel takes nothing" and "this channel
    // accepts anything" must not look the same to a handler.
    call.as.asRecord(payload);

    const picked = await drawingsPlatform().pickFile();
    if (picked.status === "cancelled") return { outcome: "cancelled" } satisfies DrawingsOpenResult;
    if (picked.status === "refused") {
      return { outcome: "refused", code: picked.code } satisfies DrawingsOpenResult;
    }

    if (picked.kind === "dwg") {
      const opened = await openDwg({
        path: picked.path,
        tool: converterFor(call),
        maxBytes: MAX_DRAWING_BYTES,
      });
      if (opened.outcome === "needs-pack") {
        return {
          outcome: "needs-pack",
          pack: opened.pack,
          catalogue: opened.catalogue,
        } satisfies DrawingsOpenResult;
      }
      if (opened.outcome === "conversion-failed") {
        return {
          outcome: "conversion-failed",
          name: picked.name,
          failure: opened.failure,
        } satisfies DrawingsOpenResult;
      }
      return {
        outcome: "drawing",
        name: picked.name,
        bytes: opened.bytes,
        tool: opened.tool,
      } satisfies DrawingsOpenResult;
    }

    const read = await readFileBounded(picked.path, MAX_DRAWING_BYTES);
    if (read.status === "too-large") {
      return { outcome: "refused", code: "too-large" } satisfies DrawingsOpenResult;
    }
    if (read.status === "not-a-file") {
      return { outcome: "refused", code: "not-a-file" } satisfies DrawingsOpenResult;
    }
    if (read.status === "unreadable") {
      return { outcome: "refused", code: "unreadable" } satisfies DrawingsOpenResult;
    }
    if (read.size === 0) return { outcome: "refused", code: "empty" } satisfies DrawingsOpenResult;
    // `Buffer` IS a `Uint8Array`, so the bytes cross the wire as the same view of
    // the same memory rather than through a copy or a base64 round trip, and no
    // pack is credited: this module read the file itself.
    return { outcome: "drawing", name: picked.name, bytes: read.bytes, tool: null };
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

/**
 * The installed LibreDWG pack as a converter, or `null` when nothing is
 * installed under that id.
 *
 * **One session per conversion.** A conversion is a whole file in and a whole
 * file out, so there is nothing to keep between two of them: the session's own
 * working directory is what makes the input anonymous, and the runner deletes it
 * on `close`. That is also why this opens a session per call rather than holding
 * one — a held one would be a working directory kept for a file that has been
 * converted.
 *
 * **The pack's own words are read here and nowhere else.** The credit comes from
 * the signed manifest, so the page shows the licence and the source the pack's
 * publisher wrote rather than an attribution this application invented.
 */
function converterFor(call: ModuleCall): DwgTool | null {
  const tools = call.tools();
  const pack = tools.pack(DWG_PACK_ID);
  if (pack === null) return null;

  const credit: DwgTool["credit"] = {
    id: pack.id,
    version: pack.version,
    title: pack.title,
    licence: pack.licence,
    source: pack.source,
  };

  return {
    credit,
    async convert(path: string, maxBytes: number): Promise<Uint8Array> {
      let session;
      try {
        session = await tools.session(DWG_PACK_ID, "stdio");
      } catch (error) {
        // A pack that cannot be started — its entry was replaced, it speaks the
        // other protocol, its file is gone — is a conversion that failed, and the
        // page says which: never a thrown error across the bridge. A
        // `ModuleToolError` is the capability's own refusal and carries no
        // converter words; anything else is this app's sentence about itself, and
        // it is the only thing there is to quote.
        throw new DwgFailureError(
          {
            code: "not-a-tool",
            exitCode: null,
            reason: error instanceof ModuleToolError ? null : messageOf(error),
          },
          messageOf(error),
        );
      }
      try {
        const conversion = await convertDwgToDxf({
          session,
          path,
          // The module's own cap, applied to the staged copy: a DWG bigger than
          // this module reads is refused before a byte is copied.
          maxInputBytes: maxBytes,
        });
        return conversion.dxf;
      } catch (error) {
        // The client's refusal becomes the flow's, in `./open.ts`'s one table:
        // this file never decides what a `DwgError` means to a page.
        if (error instanceof DwgError) {
          throw new DwgFailureError(dwgFailureOf(error), error.message);
        }
        throw error;
      } finally {
        // The session's directory is the only thing left holding the user's
        // drawing, and `close` is what removes it.
        await session.close();
      }
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

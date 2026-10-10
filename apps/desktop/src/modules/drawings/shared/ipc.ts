import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * DRAWINGS' contract (ADR-090): the two calls the page makes, and nothing else.
 *
 * **Why the file crosses the wire rather than being read by the page.** A
 * drawing is untrusted input - a DXF is a text file written by a CAD program,
 * and a DWG is a binary produced by a decoder that has shipped memory-safety
 * bugs - so the size cap, the native picker and the DWG pack's separate process
 * all belong in main, where the platform's own file rules live. The renderer
 * therefore never names a path: it asks main to open a file, and main answers
 * with bytes it has already bounded.
 *
 * **Why the bytes are a `Uint8Array` and not a string.** A DXF written before
 * R2004 is not UTF-8 (its code page is a header variable), and the library
 * decodes it itself; turning the file into a JS string here would decode it
 * wrongly before the parser ever sees it. `Uint8Array` is structured-cloneable,
 * which is what `ipcRenderer.invoke` uses.
 */

/** Why a file was refused. A code rather than a sentence: the page's own copy says it in the language being read. */
export type DrawingRefusalCode =
  /** Over the module's size cap. */
  | "too-large"
  /** Could not be read at all (missing, locked, a device). */
  | "unreadable"
  /** Not a regular file. */
  | "not-a-file"
  /** Neither `.dxf` nor `.dwg`. */
  | "unknown-format"
  /** Zero bytes. */
  | "empty";

/**
 * What `open` answers.
 *
 * `needs-pack` carries the pack's id and the catalogue pointer as DATA rather
 * than as a sentence, so the same refusal can be shown by the page today and by
 * a future pack-install surface without either of them owning the words.
 */
export type DrawingsOpenResult =
  | {
      readonly outcome: "drawing";
      /** The file's own name (never a path - the renderer has no business knowing one). */
      readonly name: string;
      /** The DXF text, exactly as it is on disk. */
      readonly bytes: Uint8Array;
    }
  | { readonly outcome: "cancelled" }
  | { readonly outcome: "needs-pack"; readonly pack: string; readonly catalogue: string }
  | { readonly outcome: "refused"; readonly code: DrawingRefusalCode };

/** What `print` answers. `saved` names the file the user chose, for the confirmation line under the button. */
export type DrawingsPrintResult =
  | { readonly outcome: "saved"; readonly path: string }
  | { readonly outcome: "cancelled" }
  | { readonly outcome: "refused"; readonly code: "no-window" | "print-failed" };

/**
 * Both ops take NOTHING, and that is the security shape rather than a
 * convenience: there is no field a renderer could use to name a path, a URL, a
 * size or a page range. The absence is enforced by the type - `Record<string,
 * never>` has no assignable members - and the handlers still run the wire's own
 * object check, so a payload that is not an object at all is refused before
 * anything happens.
 */
type NoPayload = Record<string, never>;

type DrawingsOps = {
  open: { request: NoPayload; response: DrawingsOpenResult };
  print: { request: NoPayload; response: DrawingsPrintResult };
};

/** This module's renderer API: `nexus.modules.drawings.open({})` and `.print({})`. */
export type DrawingsApi = ModuleApiOf<DrawingsOps>;

/** The contract main answers on and the preload builds the bridge from. */
export const contract = defineModuleContract<"drawings", DrawingsOps>("drawings", [
  "open",
  "print",
]);

declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    drawings: DrawingsApi;
  }
}

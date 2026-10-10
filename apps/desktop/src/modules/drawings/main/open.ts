/**
 * THE DWG SEAM (ADR-092's pack machinery, and the research in
 * `.wt/research/dwg/report.md`).
 *
 * **Why DWG cannot be read here.** DWG is Autodesk's proprietary, undocumented
 * format; the only open implementation, GNU LibreDWG, is GPL-3.0-or-later, and
 * linking or embedding it would make this Apache-2.0 app a GPL work. It arrives
 * instead as a separate, separately-installed tool pack whose `dwg2dxf` runs as
 * a CHILD PROCESS, which is what keeps the two programs an aggregate rather than
 * one combined work.
 *
 * **The seam.** `openDrawing` is the one function through which a chosen drawing
 * reaches the renderer, and its DWG arm is where that client plugs in. Today it
 * answers with a pack refusal carrying the pack's id and the catalogue pointer;
 * when the client lands (`apps/desktop/src/modules/drawings/main/tools/dwg.ts`,
 * built beside this module by the run that ships the pack), its DWG arm becomes
 * `dwgToDxf(bytes)` and returns the same `"dxf"` outcome with the converted
 * text. Nothing else in this module has to move: the page renders whatever this
 * function says the bytes are.
 *
 * **Why the refusal is data.** The pack's catalogue is the app's own Packs card
 * (a signed pack is a folder the user installs, ADR-091), so the pack's id and
 * a pointer at that card are what a caller needs to say where it comes from.
 * The sentence the user reads lives in the page's copy table, in both languages,
 * rather than in a string built here - main writes in the language main is
 * serving, and this file stays free of user-facing prose.
 */

/** Which reader a chosen file needs. Decided by the file's extension, never by a caller. */
export type DrawingKind = "dxf" | "dwg";

/**
 * The most this module will read into memory, in bytes.
 *
 * 32 MiB is far past any drawing a person opens to LOOK at - the largest real
 * DXF files are tens of megabytes of geometry - and it is deliberately far below
 * what would make the parse (which buffers the whole text before parsing, a
 * limitation the library states plainly) unpleasant. The cap is enforced while
 * reading, before the bytes are in memory, by `readFileBounded`.
 */
export const MAX_DRAWING_BYTES = 32 * 1024 * 1024;

/** The pack that reads DWG: an id the pack registry knows, not a path and not a host. */
export const DWG_PACK_ID = "libredwg";

/**
 * Where a user gets a tool pack: the app's own Packs card, under Settings.
 *
 * A POINTER, not a URL: a signed pack is a folder the user installs through that
 * card (ADR-091), so `settings:packs` names the surface that can act on this
 * refusal. A kit page has no navigation of its own (ADR-090 hands a page a
 * profile id and nothing else), which is why the page's copy names that card in
 * words and why the pointer rides the wire as data for the surface that can use
 * it.
 */
export const PACK_CATALOGUE_ENTRY = "settings:packs";

/**
 * A file's reader, from its name - or `null` for a format this module does not
 * open.
 *
 * The extension is taken case-insensitively, because Windows writes `.DXF` as
 * readily as `.dxf`. Nothing else is guessed from the name: a `.dwg` that is
 * really a DXF is still a DWG to the pack that has to convert it, and a file
 * with no extension is refused by name rather than tried.
 */
export function drawingKindOf(fileName: string): DrawingKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".dxf")) return "dxf";
  if (lower.endsWith(".dwg")) return "dwg";
  return null;
}

/** What a chosen file became: DXF text to render, or the pack that would read it. */
export type OpenOutcome =
  | { readonly outcome: "dxf"; readonly bytes: Uint8Array }
  | { readonly outcome: "needs-pack"; readonly pack: string; readonly catalogue: string };

/**
 * One chosen drawing, in the reader its kind names.
 *
 * Total, and never throws: the bytes are already in hand by the time this runs,
 * and the only two answers are "these are DXF text" and "these need a pack".
 * A caller that wanted to refuse an empty file does so before calling, where the
 * size was measured.
 */
export function openDrawing(bytes: Uint8Array, kind: DrawingKind): OpenOutcome {
  if (kind === "dwg") {
    return { outcome: "needs-pack", pack: DWG_PACK_ID, catalogue: PACK_CATALOGUE_ENTRY };
  }
  // The bytes are handed on untouched rather than copied: the caller read them
  // for this one purpose, and a second copy of 32 MiB is not a safety measure.
  return { outcome: "dxf", bytes };
}

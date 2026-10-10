/**
 * WHICH READER A CHOSEN FILE NEEDS, and what the DWG one does (ADR-094).
 *
 * **Why DWG cannot be read here.** DWG is Autodesk's proprietary, undocumented
 * format; the only open implementation, GNU LibreDWG, is GPL-3.0-or-later, and
 * linking or embedding it would make this Apache-2.0 app a GPL work. It arrives
 * instead as a separate, separately-installed tool pack whose `dwg2dxf` runs as a
 * CHILD PROCESS, which is what keeps the two programs an aggregate rather than
 * one combined work — and the flow below is the whole of this module's half of
 * that: convert, and show what came back.
 *
 * **Why the tool arrives as an interface rather than as a process.** `openDwg`
 * takes a `DwgTool` and nothing else, so this file has no session, no `spawn` and
 * no pack folder in it. `register.ts` builds the real one out of the kit's tool
 * capability; a test hands it a fake that answers bytes, a refusal, or a failure
 * with an exit code, which is how the four endings of this flow are asserted
 * without LibreDWG anywhere near the suite.
 *
 * **A failure is data, and it is the CONVERTER's own data.** A DWG decoder is
 * memory-unsafe C reading somebody else's file, so what a person needs when it
 * fails is the program's exit code and the first line the program wrote — never a
 * stack trace, and never this module's sentence about one. Those two values ride
 * the wire (`DwgFailure`) and the sentence around them lives in the page's copy,
 * in both languages.
 */

import { DwgError } from "../../../main/tools/dwg.js";

/** Which reader a chosen file needs. Decided by the file's extension, never by a caller. */
export type DrawingKind = "dxf" | "dwg";

/**
 * The most this module will read into memory, in bytes.
 *
 * 32 MiB is far past any drawing a person opens to LOOK at — the largest real
 * DXF files are tens of megabytes of geometry — and it is deliberately far below
 * what would make the parse (which buffers the whole text before parsing, a
 * limitation the library states plainly) unpleasant. It bounds all three reads
 * this module makes: a DXF it opens directly, a DWG it hands to the pack, and the
 * DXF the pack answers with.
 */
export const MAX_DRAWING_BYTES = 32 * 1024 * 1024;

/** The pack that reads DWG: an id the pack registry knows, not a path and not a host. */
export const DWG_PACK_ID = "libredwg";

/**
 * Where a user gets the tool pack: the app's own Packs card, under Settings.
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
 * A file's reader, from its name — or `null` for a format this module does not
 * open.
 *
 * The extension is taken case-insensitively, because Windows writes `.DXF` as
 * readily as `.dxf`. Nothing else is guessed from the name: a `.dwg` that is
 * really a DXF is still a DWG to the pack that has to convert it, and a file with
 * no extension is refused by name rather than tried.
 */
export function drawingKindOf(fileName: string): DrawingKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".dxf")) return "dxf";
  if (lower.endsWith(".dwg")) return "dwg";
  return null;
}

/** The licence and the source of the pack that did the conversion, as ADR-094 §5 requires them shown. */
export interface ToolCredit {
  readonly id: string;
  readonly version: string;
  readonly title: { readonly sr: string; readonly en: string };
  readonly licence: { readonly spdx: string; readonly attribution: string; readonly url: string };
  readonly source: { readonly name: string; readonly url: string };
}

/**
 * The converter, as this flow uses it: one call, one file, bytes or a failure.
 *
 * Everything the conversion really needs — the session, the staged copy under a
 * name this app chose, the argv, the caps — belongs to the client that owns it
 * (`main/tools/dwg.ts`, ADR-094 §4), and this interface is where that client
 * meets the flow.
 */
export interface DwgTool {
  /** What to credit if the conversion works, read from the pack's own signed manifest. */
  readonly credit: ToolCredit;
  /**
   * Converts the file at `path` to DXF bytes, or throws `DwgFailure`.
   *
   * `maxBytes` is the largest answer the caller will accept: a converter that
   * produces a drawing bigger than this module reads is refused rather than
   * buffered, and the cap belongs to the caller because it is the same cap the
   * DXF path uses.
   */
  convert(path: string, maxBytes: number): Promise<Uint8Array>;
}

/** Why a conversion did not produce a drawing this module can open. */
export type DwgFailureCode =
  /** The converter ran and ended with a non-zero code, or wrote no drawing. */
  | "conversion-failed"
  /** The runner's deadline or a cancel killed the converter. */
  | "conversion-stopped"
  /** The staged input, or the drawing that came back, is over the module's own cap. */
  | "too-large"
  /** The pack's entry speaks the other protocol, or no longer matches its manifest. */
  | "not-a-tool"
  /** A file could not be read or written. */
  | "io";

/** A conversion failure as the page needs it: the converter's own exit and words. */
export interface DwgFailure {
  readonly code: DwgFailureCode;
  readonly exitCode: number | null;
  readonly reason: string | null;
}

export class DwgFailureError extends Error {
  readonly failure: DwgFailure;

  constructor(failure: DwgFailure, message: string) {
    super(message);
    this.name = "DwgFailureError";
    this.failure = failure;
  }
}

/**
 * The conversion client's own refusal, as the failure the wire carries.
 *
 * One table, written as a `Record` over the client's closed code union: a code
 * added there is a compile error here until it is mapped, which is the property a
 * `switch` with a `default` would silently lose. The exit code and the first line
 * of the converter's diagnostics ride through unchanged — they are the two values
 * the page shows, and re-deriving them from the message would be parsing a
 * sentence to find a number.
 */
export function dwgFailureOf(error: DwgError): DwgFailure {
  const codes: Record<DwgError["code"], DwgFailureCode> = {
    "not-a-tool": "not-a-tool",
    "input-too-large": "too-large",
    "output-too-large": "too-large",
    "conversion-failed": "conversion-failed",
    "conversion-stopped": "conversion-stopped",
    io: "io",
  };
  return { code: codes[error.code], exitCode: error.exitCode, reason: error.reason };
}

/** What a chosen file became: DXF text to render (with the pack credited), or why it did not. */
export type OpenOutcome =
  | { readonly outcome: "dxf"; readonly bytes: Uint8Array; readonly tool: ToolCredit | null }
  | { readonly outcome: "needs-pack"; readonly pack: string; readonly catalogue: string }
  | {
      readonly outcome: "conversion-failed";
      readonly failure: DwgFailure;
    };

/**
 * One chosen drawing, in the reader its kind names.
 *
 * The DXF arm is total and never throws: the bytes are already in hand by the
 * time this runs. The DWG arm asks the pack, and answers with the converter's own
 * exit and first line when that fails — `null` for the tool is „no pack is
 * installed“, which is a different answer from „the pack tried and could not“,
 * because only one of them is something the user can fix by installing something.
 */
export async function openDwg(input: {
  /** The chosen file, as main's dialog reported it. Read by the pack's own client, never staged here. */
  readonly path: string;
  /** The installed converter, or `null` when no pack is installed. */
  readonly tool: DwgTool | null;
  /** The largest input and the largest answer this module accepts. */
  readonly maxBytes: number;
}): Promise<OpenOutcome> {
  if (input.tool === null) {
    return { outcome: "needs-pack", pack: DWG_PACK_ID, catalogue: PACK_CATALOGUE_ENTRY };
  }
  try {
    const bytes = await input.tool.convert(input.path, input.maxBytes);
    if (bytes.byteLength > input.maxBytes) {
      // The cap's ONE home for the answer: a converter that produced a drawing
      // bigger than this module reads is refused here, before the bytes reach the
      // parser, which is the thing that would hold them for the rest of the
      // session rather than for one read.
      return {
        outcome: "conversion-failed",
        failure: { code: "too-large", exitCode: 0, reason: null },
      };
    }
    return { outcome: "dxf", bytes, tool: input.tool.credit };
  } catch (error) {
    if (error instanceof DwgFailureError) {
      return { outcome: "conversion-failed", failure: error.failure };
    }
    // Anything else is this application's own defect — a bug in the wiring, not a
    // program that failed — and it travels rather than being told to the user as
    // a conversion error.
    throw error;
  }
}

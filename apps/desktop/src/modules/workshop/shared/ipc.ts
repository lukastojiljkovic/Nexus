import type { GerberRole } from "@nexus/core";
import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * WORKSHOP's contract: the two channels it answers on, the payload each takes,
 * and the API its page calls - declared once, in its own folder (ADR-090).
 *
 * **Two ops, because there is exactly one thing this module asks main for.**
 * Every file a viewer draws arrives through the native dialog, which only main
 * may open, and the bytes only main may read: `open` is that request. `reopen`
 * is the same request for a path the user already picked once in this run of the
 * app, so the recently-opened list on the page is worth keeping rather than
 * being a list of files the page can name but not show.
 *
 * **Why `reopen` takes a path at all, when the renderer is untrusted.** It is
 * refused unless main itself handed that exact path out through a dialog in THIS
 * session (`main/register.ts` keeps that set and clears it when the session
 * ends). So the renderer never gets to name a file to read: it may only ask
 * again for one the person already chose, and a path that arrived from anywhere
 * else - a hand-edited `localStorage`, a script - is refused by name.
 *
 * **Why a board's SVG crosses this wire and not a path.** Gerber is converted
 * through `gerber-to-svg` in main, which is the only process in this app where
 * the library's Node stream dependencies exist (the reasoning, with the measured
 * evidence, is in `main/gerber.ts`). What the page receives is therefore the
 * finished SVG - which it shows as an `<img>` over a `Blob` URL, never inlined
 * into the document - plus the size the library measured, so the page never
 * re-derives a millimetre from the markup.
 */

/** What a dialog may be opened FOR: one of the three viewers. */
export type WorkshopTarget = "model" | "toolpath" | "board";

/** The targets, in the order the page's switcher draws them. */
export const WORKSHOP_TARGETS: readonly WorkshopTarget[] = ["model", "toolpath", "board"];

/** Why one picked file could not be shown. Codes, so the page words them in the reader's language. */
export type WorkshopFileProblem =
  /** The path could not be opened at all (gone, unreadable, a device that will not read). */
  | "unreadable"
  /** The path is not a regular file - a directory, most often. */
  | "not-a-file"
  /** Larger than the cap for its kind (32 MiB for STL and G-code, 8 MiB for a board layer). */
  | "too-large"
  /** Gerber or Excellon that the converter would not read. */
  | "not-gerber"
  /** A `reopen` for a path main did not hand out in this session. */
  | "not-in-this-session"
  /**
   * More files than the pick may hold, which is a sentence about the whole
   * selection rather than about any one member of it: it arrives as `problem`,
   * never as a file's own refusal.
   */
  | "too-many-files";

/** A file that was picked and refused, and why - shown beside the viewer's empty state. */
export interface WorkshopRefusedFile {
  readonly name: string;
  readonly problem: WorkshopFileProblem;
}

/** A model or a toolpath, as the page hands it to the parse worker. */
export interface WorkshopFileBytes {
  readonly kind: "model" | "toolpath";
  readonly name: string;
  readonly path: string;
  /** The file whole, never truncated: a partially drawn model would be a lie about the file. */
  readonly bytes: Uint8Array;
}

/** One layer of an opened board, already converted to SVG. */
export interface WorkshopBoardLayer {
  readonly kind: "board";
  readonly name: string;
  readonly path: string;
  /** What the file is on the board, from its own X2 attribute or, failing that, its name. */
  readonly role: GerberRole;
  /** The layer as SVG, ready for a `Blob` URL. */
  readonly svg: string;
  /** The width the converter measured for this layer, in millimetres. */
  readonly widthMm: number;
  /** The height the converter measured for this layer, in millimetres. */
  readonly heightMm: number;
  /** The layer's origin within the file's own coordinate space, in millimetres. */
  readonly originXmm: number;
  readonly originYmm: number;
}

export type WorkshopOpenedFile = WorkshopFileBytes | WorkshopBoardLayer;

/** What both ops answer with: what the user chose, and what could not be read. */
export interface WorkshopResult {
  /** The window was closed, or cancel was pressed: nothing was read and nothing failed. */
  readonly canceled: boolean;
  readonly files: readonly WorkshopOpenedFile[];
  readonly refused: readonly WorkshopRefusedFile[];
  /**
   * A refusal about the PICK rather than about one file - today only "more files
   * than a board may have", which is a sentence about the whole selection and
   * not about any one member of it.
   */
  readonly problem?: WorkshopFileProblem;
}

/** Opening the dialog for one target. */
interface OpenPayload {
  target: WorkshopTarget;
}

/** Re-reading a path this session already handed out. */
interface ReopenPayload {
  target: WorkshopTarget;
  path: string;
}

/**
 * The declared ops, as a payload-to-result map. Two names, both of them the verb
 * the page performs; the target is a payload field rather than a channel,
 * because three channels would be the same handler declared three times.
 */
type WorkshopOps = {
  open: { request: OpenPayload; response: WorkshopResult };
  reopen: { request: ReopenPayload; response: WorkshopResult };
};

/** This module's renderer API: one method per op, named after the op. */
export type WorkshopApi = ModuleApiOf<WorkshopOps>;

/** The contract the preload builds the bridge from and main refuses foreign ops against. */
export const contract = defineModuleContract<"workshop", WorkshopOps>("workshop", [
  "open",
  "reopen",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here, so
 * `window.nexus.modules.workshop.open(...)` is typed in this module's own page
 * and nowhere else.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    workshop: WorkshopApi;
  }
}

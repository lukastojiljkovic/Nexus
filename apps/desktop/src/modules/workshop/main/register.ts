import { basename } from "node:path";
import {
  GERBER_MAX_BYTES,
  GERBER_MAX_FILES,
  GCODE_MAX_BYTES,
  STL_MAX_BYTES,
  gerberRoleOf,
  type GerberRole,
} from "@nexus/core";
import { readFileBounded } from "../../../main/boundedRead.js";
import type { ModuleHostSurface } from "../../../main/moduleIpc.js";
import {
  contract,
  type WorkshopOpenedFile,
  type WorkshopRefusedFile,
  type WorkshopResult,
  type WorkshopTarget,
} from "../shared/ipc.js";
import { convertLayer } from "./gerber.js";

/**
 * WORKSHOP in the main process (ADR-090): the two handlers, the one capability
 * they guard, and nothing else.
 *
 * **Main is where a file becomes bytes, and that is the whole security shape of
 * this module.** The renderer never gets a path it can read: `open` puts a native
 * dialog in front of the person, and what they pick is read HERE, through
 * `readFileBounded` - one handle, a stat against the file's own size, a cap for
 * the kind, and the bytes. What crosses the wire is the contents, which is what
 * a viewer needs and all it needs.
 *
 * **`reopen` is the one place a path arrives from the renderer, and it is not a
 * capability to read files.** Every path this module hands out is recorded for
 * the length of the session (`handedOut`), and `reopen` refuses anything else by
 * name. The renderer can therefore ask again for a file the user already chose
 * in this run - which is what makes the page's recently-opened list useful - and
 * cannot name a file of its own choosing. The set is cleared when the session
 * ends, so the capability does not survive a lock.
 *
 * **Two sizes, because the two kinds cost different amounts to draw.** An STL or
 * a G-code file may be tens of megabytes and is parsed in the worker, off the UI
 * thread; a board layer is kilobytes and is converted in main, so its cap is
 * eight megabytes. Both numbers come from `@nexus/core`, which is where the
 * readers' own caps live, so the wire and the parser cannot disagree about how
 * big a file may be.
 *
 * **A file that cannot be read is a sentence beside the viewer, not a failure of
 * the pick.** One bad layer among seven good ones must not cost the seven: every
 * refusal is per file, with a code the page words in the reader's language.
 */

/** Opens the native dialog and answers the paths the user chose, or `null` for a cancelled one. */
export type WorkshopPicker = (target: WorkshopTarget) => Promise<readonly string[] | null>;

/**
 * The real picker, imported the moment a dialog is actually opened.
 *
 * Dynamic on purpose: `picker.ts` imports `electron`, which does not exist under
 * Vitest, and the tests here drive this file with their own picker to exercise
 * the reading and the conversion for real. A static import would make the whole
 * module untestable to buy nothing.
 */
async function electronPicker(target: WorkshopTarget): Promise<readonly string[] | null> {
  const { pickWorkshopFiles } = await import("./picker.js");
  return await pickWorkshopFiles(target);
}

const TARGETS: readonly WorkshopTarget[] = ["model", "toolpath", "board"];

/** The byte cap for one kind of file, from the reader's own constant. */
function capFor(target: WorkshopTarget): number {
  return target === "board" ? GERBER_MAX_BYTES : target === "model" ? STL_MAX_BYTES : GCODE_MAX_BYTES;
}

/**
 * `register`, with the picker injectable.
 *
 * The second parameter is what makes this module testable end to end: the
 * discovery glue calls `register(host)` and gets the real dialog, and a test
 * calls `register(host, its own picker)` and gets the same reading, capping and
 * conversion with paths it wrote itself.
 */
export function register(host: ModuleHostSurface, picker: WorkshopPicker = electronPicker): void {
  const ctx = host.adopt(contract);

  /**
   * Every path this session handed to the renderer, so `reopen` can tell "the
   * file the user picked a minute ago" from "a path somebody typed".
   */
  const handedOut = new Set<string>();

  ctx.onSessionEnd(() => {
    // The capability is the SESSION's: after a lock, nothing may re-read a file
    // on the strength of a dialog the previous session opened.
    handedOut.clear();
  });

  /** Reads one picked file into what the page draws, or the reason it could not. */
  async function readOne(
    target: WorkshopTarget,
    path: string,
    index: number,
  ): Promise<{ file: WorkshopOpenedFile } | { failure: WorkshopRefusedFile }> {
    const name = basename(path);
    const read = await readFileBounded(path, capFor(target));
    if (read.status !== "ok") {
      return { failure: { name, problem: read.status } };
    }
    if (target === "board") {
      // Decoded with replacement, as the readers in `@nexus/core` decode their
      // own input: a Gerber file is ASCII text, and a stray byte in a comment is
      // not a reason to refuse a board.
      const source = new TextDecoder("utf-8", { fatal: false }).decode(read.bytes);
      const converted = await convertLayer(source, `ws${index}`);
      if (converted === null) return { failure: { name, problem: "not-gerber" } };
      // The role comes from the file's own X2 attribute when it has one, and
      // from its name otherwise - `@nexus/core`'s rule, applied to the first few
      // kilobytes, which is where the format puts its attributes.
      const role: GerberRole = gerberRoleOf(name, source.slice(0, 4096));
      return {
        file: {
          kind: "board",
          name,
          path,
          role,
          svg: converted.svg,
          widthMm: converted.widthMm,
          heightMm: converted.heightMm,
          originXmm: converted.originXmm,
          originYmm: converted.originYmm,
        },
      };
    }
    return {
      file: { kind: target, name, path, bytes: read.bytes },
    };
  }

  /** What happens after a pick, however the pick was made: read each path, record it, answer. */
  async function openPaths(
    target: WorkshopTarget,
    paths: readonly string[] | null,
  ): Promise<WorkshopResult> {
    if (paths === null) return { canceled: true, files: [], refused: [] };
    if (target === "board" && paths.length > GERBER_MAX_FILES) {
      // A refusal about the SELECTION rather than about a file: seventeen layers
      // is not one bad file among good ones, it is a pick this viewer will not
      // draw, and saying so once beats seventeen rows of the same sentence.
      return { canceled: false, files: [], refused: [], problem: "too-many-files" };
    }
    const files: WorkshopOpenedFile[] = [];
    const refused: WorkshopRefusedFile[] = [];
    for (const [index, path] of paths.entries()) {
      const read = await readOne(target, path, index);
      if ("file" in read) {
        files.push(read.file);
        handedOut.add(path);
      } else {
        refused.push(read.failure);
      }
    }
    return { canceled: false, files, refused };
  }

  ctx.handle("open", async (payload, call) => {
    const target = targetOf(call.as.asNonEmptyString(payload.target, "target"));
    return await openPaths(target, await picker(target));
  });

  ctx.handle("reopen", async (payload, call) => {
    const target = targetOf(call.as.asNonEmptyString(payload.target, "target"));
    const path = call.as.asCappedChars(
      call.as.asNonEmptyString(payload.path, "path"),
      "path",
      MAX_PATH_LENGTH,
    );
    if (!handedOut.has(path)) {
      // Refused rather than silently ignored: a page that asks for a file main
      // never gave it has either a stale list or a bug, and the answer that says
      // so is the one that keeps the boundary visible.
      return {
        canceled: false,
        files: [],
        refused: [{ name: basename(path), problem: "not-in-this-session" }],
      } satisfies WorkshopResult;
    }
    return await openPaths(target, [path]);
  });
}

/**
 * Longest path this module will accept from the renderer.
 *
 * A bound on untrusted input rather than a limit anybody meets: Windows' own
 * maximum path is 32 767 characters, and a `localStorage` entry could hold
 * megabytes. The value is what keeps a hostile string from being copied around
 * a process for the length of a session.
 */
const MAX_PATH_LENGTH = 4096;

/** One of the three targets, or a refusal naming the one that was sent. */
function targetOf(value: string): WorkshopTarget {
  for (const target of TARGETS) {
    if (target === value) return target;
  }
  throw new Error(`The workshop viewers have no target "${value}".`);
}

/**
 * DWG → DXF, through the LibreDWG pack (ADR-094).
 *
 * Nexus renders DXF, not DWG: DWG is Autodesk's proprietary format and the one
 * published specification for it grants no right to implement it
 * (`research/dwg/report.md` §2.1). LibreDWG is the free reader, it is GPL-3.0-or-
 * later, and it therefore never goes inside this Apache-2.0 application — it
 * ships as a `tool` pack and runs as a process, which is what makes this module
 * nine lines of copy and a cap rather than a format reader.
 *
 * **The input is hostile twice over.** A DWG is a file from outside the machine,
 * and the decoder that reads it is memory-unsafe C whose own NEWS is a list of
 * heap overflows fixed in the version this pack pins. So the file is SIZE-capped
 * before it is copied and it is copied into the session's own directory under a
 * name this app chose (`run.ts`'s `stageInput`): the converter is never handed a
 * path on the user's disk, and everything it writes during the conversion is
 * inside the directory `close()` deletes.
 *
 * **Two caps, and they are different caps.** The process has a minute
 * (`DWG_LIMITS.timeoutMs`, the number ADR-094 names) and its console has
 * `run.ts`'s output cap; the DXF it produces has `DWG_LIMITS.outputBytes`, which
 * is a bound on a DRAWING rather than on a process, and is large because a real
 * drawing is.
 *
 * **What a failure says.** A conversion that fails for a reason the tool
 * reported carries the tool's own last words in the message, because "the
 * converter failed" is not something a person can act on and the version banner
 * or the `READ ERROR 0x…` from `dwg2dxf` is.
 */

import { readFile, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { ToolError, stageInput, type ToolSession } from "./run.js";

/** The conversion's own caps. The process deadline is ADR-094's; the output cap is about a drawing. */
export const DWG_LIMITS = {
  /** How long one conversion may take before the process is killed. */
  timeoutMs: 60_000,
  /** Largest DXF this reader will accept back. */
  outputBytes: 256 * 1024 * 1024,
} as const;

export type DwgRefusal =
  /** The session's manifest is not a stdin/stdout converter. */
  | "not-a-tool"
  /** The chosen file is larger than this reader will copy. */
  | "input-too-large"
  /** `dwg2dxf` ran and did not produce a drawing. */
  | "conversion-failed"
  /** The conversion was killed before it finished, by the deadline or by a cancel. */
  | "conversion-stopped"
  /** A DXF came back larger than this reader will hold. */
  | "output-too-large"
  /** A file could not be read or written. */
  | "io";

export class DwgError extends Error {
  readonly code: DwgRefusal;
  /**
   * The converter's own exit code, or `null` when it never exited on its own
   * (a deadline, a cancel, a program this module had to kill).
   */
  readonly exitCode: number | null;
  /**
   * The FIRST line the converter wrote to its error output — its own words, kept
   * as data so a caller can put them in front of a user without a stack trace and
   * without parsing the sentence this error carries.
   */
  readonly reason: string | null;

  constructor(
    code: DwgRefusal,
    message: string,
    detail: { readonly exitCode?: number | null; readonly reason?: string | null } = {},
  ) {
    super(message);
    this.name = "DwgError";
    this.code = code;
    this.exitCode = detail.exitCode ?? null;
    this.reason = detail.reason ?? null;
  }
}

/**
 * The converter's first line of diagnostics: stderr's if it wrote any, stdout's
 * otherwise.
 *
 * One line, because a decoder's failure is announced on its first line and the
 * rest is a transcript; stderr first, because that is where a program says what
 * went wrong while stdout carries its progress. `dwg2dxf` writes its version
 * banner and its "Reading…" line to stdout and its `READ ERROR 0x…` to stderr,
 * and the second is the one a person can act on.
 */
function firstLine(text: string): string | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed;
  }
  return null;
}

export interface DwgConversion {
  /** The converted drawing. */
  readonly dxf: Buffer;
  /** What the converter said, for the diagnostics a caller may want to keep. */
  readonly log: string;
}

export interface DwgConversionInput {
  readonly session: ToolSession;
  /** The DWG the user chose. Read once, copied into the session's directory, never named to the converter. */
  readonly path: string;
  /** Overrides `DWG_LIMITS.timeoutMs`. */
  readonly timeoutMs?: number;
  /**
   * Overrides the size an input may be before it is refused.
   *
   * The default is the runner's half-gigabyte; a caller that knows its own
   * drawings are smaller says so here, and a test reaches the refusal without
   * writing half a gigabyte to a disk to do it.
   */
  readonly maxInputBytes?: number;
  /** Cancels the conversion; a cancelled conversion is reported as `conversion-stopped`. */
  readonly signal?: AbortSignal;
}

/**
 * Converts one DWG to DXF bytes, or throws a `DwgError` that says which rule the
 * attempt broke.
 *
 * The argv is `-y -o <name>.dxf <name>.dwg`, with `<name>` chosen here: `-y`
 * because the output name is ours and a file we made a moment ago must be
 * overwritable, and `-o` because the tool's default output name is derived from
 * the input's name, which is the shape this module exists to avoid depending on.
 * Both names are relative, so the tool's working directory is the session's
 * directory and the paths in its output are paths it cannot use to reach
 * anywhere else.
 */
export async function convertDwgToDxf(input: DwgConversionInput): Promise<DwgConversion> {
  if (input.session.tool.protocol !== "stdio") {
    throw new DwgError(
      "not-a-tool",
      `Pack entry "${input.session.tool.entry}" is not a stdin/stdout converter.`,
    );
  }

  let staged: string;
  try {
    staged = await stageInput(input.session, input.path, {
      suffix: ".dwg",
      ...(input.maxInputBytes === undefined ? {} : { maxBytes: input.maxInputBytes }),
    });
  } catch (error) {
    if (error instanceof ToolError && error.code === "input-too-large") {
      throw new DwgError("input-too-large", error.message);
    }
    throw new DwgError("io", error instanceof Error ? error.message : String(error));
  }

  const stagedName = basename(staged);
  const outputName = `${stagedName.slice(0, -".dwg".length)}.dxf`;
  const outputPath = join(input.session.workDir, outputName);

  const result = await input.session.run({
    args: ["-y", "-o", outputName, stagedName],
    // A converter reads a file and writes one; closing stdin keeps a program
    // that consults its input from waiting on a console nobody will type into.
    stdin: "",
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  // The copy has no use after the run — the drawing is read back from the
  // output name — and the session's `close()` removes what is left of it.
  await rm(staged, { force: true }).catch(() => undefined);

  const log = `${result.stdout.toString("utf8")}${result.stderr.toString("utf8")}`.trim();
  // Kept beside the sentence rather than inside it: the first line of the
  // converter's own diagnostics is what a caller shows a user, and the message
  // above is what a log shows a maintainer.
  const reason =
    firstLine(result.stderr.toString("utf8")) ?? firstLine(result.stdout.toString("utf8"));
  if (result.stopped !== null || result.spawnError !== null) {
    throw new DwgError(
      "conversion-stopped",
      `The converter ${result.stopped === null ? "could not be started" : `was stopped (${result.stopped})`}${
        log === "" ? "" : `: ${log}`
      }`,
      { exitCode: result.code, reason },
    );
  }
  if (result.code !== 0) {
    throw new DwgError(
      "conversion-failed",
      `dwg2dxf exited with code ${String(result.code)}${log === "" ? "" : `: ${log}`}`,
      { exitCode: result.code, reason },
    );
  }

  let size: number;
  try {
    size = (await stat(outputPath)).size;
  } catch {
    // Exit zero with no drawing is the one failure mode a converter can have
    // that looks like success; the message says what the tool said about it.
    throw new DwgError(
      "conversion-failed",
      `The converter produced no DXF${log === "" ? "" : `: ${log}`}`,
      { exitCode: result.code, reason },
    );
  }
  if (size > DWG_LIMITS.outputBytes) {
    throw new DwgError(
      "output-too-large",
      `The converted drawing is ${String(size)} bytes; this reader accepts at most ${String(DWG_LIMITS.outputBytes)}.`,
      { exitCode: result.code, reason },
    );
  }

  let dxf: Buffer;
  try {
    dxf = await readFile(outputPath);
  } catch (error) {
    throw new DwgError("io", `The converted drawing could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { dxf, log };
}

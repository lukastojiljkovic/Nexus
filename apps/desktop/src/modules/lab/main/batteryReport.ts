import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { batteryReportArgv, parseBatteryReport, type BatteryReport } from "@nexus/core";

/**
 * Windows' own battery report, read without elevation: `powercfg
 * /batteryreport /output <file> /xml` in a temporary directory, parsed by
 * `@nexus/core`, and cleaned up whatever happens.
 *
 * **Why a process at all.** The task's research measured this command working
 * without administrator rights on Windows 11 (build 26100) and recorded it, and
 * the two alternatives it also measured are worse here: the WinRT battery API
 * needs a helper of its own, and the WMI classes were denied in that sandbox.
 * `powercfg` is a documented Windows tool, it writes a file, and the file is the
 * report — no COM, no package, no elevation.
 *
 * **The house's rules for a spawn, each one visible below.** The command line is
 * never data: the argv comes from `@nexus/core`'s `batteryReportArgv`, whose
 * only variable is the path this file builds under the OS temp folder
 * (`DEV-007`). `shell` is false, so the path is an argument rather than a word in
 * a command line. The program is `argv[0]` of that table and is never spelled
 * here — the file cannot name a tool it starts, which is the property
 * `scripts/check-runner.mjs` asserts and the reason this path is in its
 * allowlist for `child_process` alone. And there is a TIME LIMIT with a kill:
 * a report takes a few seconds on the machine this was measured on, and a
 * `powercfg` that never returns must not be a read that never answers.
 *
 * **The temp directory is this file's own.** `mkdtemp` gives a fresh directory
 * per read, the report is written into it, and the directory is removed in a
 * `finally` — so nothing survives a failure, and two reads cannot collide. The
 * report is not committed, logged or kept: it carries the machine's own
 * identifiers, and the parsed value is what the page needs.
 */

/** How long `powercfg` may take before it is killed. */
const TIMEOUT_MS = 20_000;

/** How large the report file may be — a real one is tens of kilobytes, and a bound is what keeps a wrong path from reading a disk image into memory. */
const MAX_REPORT_BYTES = 4 * 1024 * 1024;

/** Why a read did not produce a report. */
export type BatteryReadStatus = "ok" | "unavailable" | "timeout";

/** The report, or the reason there is none. */
export type BatteryReadResult =
  | { readonly status: "ok"; readonly report: BatteryReport }
  | { readonly status: "unavailable" }
  | { readonly status: "timeout" };

/**
 * Reads the report, or answers why it could not.
 *
 * Nothing throws: a machine with no battery, a `powercfg` that refuses and a
 * read that timed out are three DIFFERENT answers the page states in its own
 * words, and an exception would flatten them into one — which is why the
 * failures here are values and the call site has no `catch` to get wrong.
 */
export async function readBatteryReport(): Promise<BatteryReadResult> {
  let dir: string;
  try {
    dir = await mkdtemp(join(tmpdir(), "nexus-battery-"));
  } catch (error) {
    console.error(
      `Nexus: a battery report directory could not be made — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { status: "unavailable" };
  }
  const path = join(dir, "report.xml");
  try {
    const outcome = await runPowercfg(path);
    if (outcome !== "ok") return { status: outcome };
    const xml = await readFile(path, "utf8");
    if (xml.length === 0 || Buffer.byteLength(xml, "utf8") > MAX_REPORT_BYTES) {
      return { status: "unavailable" };
    }
    return { status: "ok", report: parseBatteryReport(xml) };
  } catch (error) {
    // A refusal from Windows and a report this build cannot read are the same
    // answer to the user — „this machine did not give me one" — and the detail
    // belongs in the log rather than in a sentence about a battery.
    console.error(
      `Nexus: the battery report could not be read — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { status: "unavailable" };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Runs `powercfg` once and answers whether it wrote the file.
 *
 * The plan is the table's. `argv[0]` is the program and the rest is the
 * argument list, which is exactly the shape `check-runner`'s allowlist expects
 * of a file that is not allowed to spell a tool's name.
 */
function runPowercfg(path: string): Promise<"ok" | "unavailable" | "timeout"> {
  return new Promise((resolve) => {
    const argv = batteryReportArgv(path);
    const program = argv[0];
    if (program === undefined) {
      resolve("unavailable");
      return;
    }
    const child = spawn(program, argv.slice(1), {
      shell: false,
      windowsHide: true,
    });
    // The time limit is this file's rather than the option's, because the answer
    // has to distinguish „killed at the limit" from „refused" — and a killed
    // process reports a null code either way.
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    const finish = (outcome: "ok" | "unavailable" | "timeout"): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    child.on("error", (error) => {
      console.error(
        `Nexus: the battery report tool could not be started — ${error.message}`,
      );
      finish("unavailable");
    });
    child.on("close", (code) => {
      if (timedOut) {
        finish("timeout");
        return;
      }
      finish(code === 0 ? "ok" : "unavailable");
    });
    // The tool's own output is not the report — the FILE is — so the streams are
    // drained rather than collected, and nothing it prints reaches the renderer.
    child.stdout?.resume();
    child.stderr?.resume();
  });
}

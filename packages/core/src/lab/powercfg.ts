/**
 * The one command line the LAB runs, written down here and nowhere else.
 *
 * **Why a program name sits in a `@nexus/core` file.** `DEV-007`'s first
 * mitigation is that the command line is never data: a program is chosen from a
 * table in source and the caller contributes values, never words. The table for
 * the apparatus runner is `electronics/runner.ts`; this is the second one, and
 * it exists for the same reason — a spawn site that can name its own program is
 * a spawn site where the line was assembled rather than selected.
 *
 * **The argument list is fixed, and the one value is a path.** `powercfg
 * /batteryreport /output <file> /xml` is what the research measured working
 * without elevation on Windows 11 (build 26100). The only thing a caller
 * chooses is where the report lands, so the path is validated HERE rather than
 * at the spawn: it must be absolute, and it may not contain a character that
 * cannot be part of one. The caller (main) builds it under the OS temp folder,
 * which is what makes "absolute" a check rather than a hope.
 *
 * **Not `netsh`, and never a shell.** `powercfg` is the documented tool for this
 * report and needs no elevation; the caller passes this argv to a spawn with
 * `shell: false`, so the path is an argument and not a word in a command line.
 */

/** The program, named once. The spawn site reads `argv[0]` and never spells this. */
export const POWERCFG_PROGRAM = "powercfg.exe";

/** The fixed part of the report command: no user value and no order in which one could hide. */
export const BATTERY_REPORT_FLAGS = ["/batteryreport", "/output"] as const;

/** The format flag, last so that the path sits in the position `/output` expects. */
export const BATTERY_REPORT_FORMAT = "/xml";

/**
 * The argv for one battery report: the program, the two flags, the caller's
 * path, and the format.
 *
 * Throws for a path that is not absolute — a relative path would be resolved
 * against whatever directory the app happens to be running in, which is a file
 * nobody could find — and for a path carrying a NUL or a newline, which cannot
 * appear in a real one and are the two characters that make a value look like a
 * program to anything reading the list as text.
 */
export function batteryReportArgv(outputPath: string): readonly string[] {
  if (!isAbsoluteWindowsPath(outputPath)) {
    throw new Error("A battery report path must be absolute.");
  }
  if (/[\0\r\n]/.test(outputPath)) {
    throw new Error("A battery report path may not contain a NUL or a line break.");
  }
  return [POWERCFG_PROGRAM, ...BATTERY_REPORT_FLAGS, outputPath, BATTERY_REPORT_FORMAT];
}

/** `C:\…` or `\\server\share\…` — the two shapes an absolute path has on this platform. */
function isAbsoluteWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/**
 * ADR-102: the portable build, and the one path decision it needs.
 *
 * A stick is copied to whatever computer is at hand, `Nexus.exe` is
 * double-clicked, and every profile, setting, pack and model stays in a folder
 * beside the executable. Windows has no notion of such a build, so the switch is
 * a MARKER FILE a person can see: `portable.txt`, beside the executable. Its
 * PRESENCE decides — never its bytes, which exist for whoever finds the file and
 * wonders what it is doing there. The shipped sentence is `build/portable.txt`,
 * copied verbatim into the package by `scripts/dist-portable.mjs`; somebody who
 * translates or reformats it changes nothing, and somebody who deletes it turns
 * the stick back into an ordinary build.
 *
 * The decision is taken at module scope in `index.ts`, BEFORE `app.whenReady`,
 * and it has to be: `userData` and `sessionData` do not follow a redirect applied
 * after the session exists — the harness sandbox in that file paid for that
 * lesson (its own comment has the measurement).
 *
 * NO ELECTRON HERE, and that is what makes the whole thing testable: the
 * executable's directory and `app.setPath` arrive as arguments, `decidePortable`
 * is a pure function of a directory and one marker probe, and the two filesystem
 * touches — looking for the marker, proving the folder writable — answer with a
 * value instead of throwing. Nothing in a normal build's launch changes: with no
 * marker this module returns `{ portable: false, reason: "absent" }` and the
 * caller redirects nothing at all.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The marker's name, beside the executable. The whole of what selects portable mode. */
export const PORTABLE_MARKER_FILE = "portable.txt";

/** The one folder a portable build writes to, beside the executable. */
export const PORTABLE_DATA_DIR = "NexusData";

/** The four directories a portable launch redirects, and the names `app.setPath` gives them. */
export type PortablePathName = "userData" | "sessionData" | "logs" | "temp";

/**
 * What a launch keeps, and where it keeps it. Every member is inside
 * `<exe dir>\NexusData\`, which is the promise the marker makes.
 */
export interface PortablePaths {
  /**
   * The app's own data root — `userData` itself: accounts, key chains, the
   * databases, blobs, packs and downloaded updates. It IS `NexusData` rather
   * than a folder inside it, so the four things below sit side by side and
   * there is exactly one folder to copy to another stick.
   */
  readonly userData: string;
  /**
   * Chromium's profile — `sessionData`: `localStorage`, the HTTP cache,
   * cookies. Kept apart from the app's own files so a person looking at the
   * stick sees which files are Nexus' and which are the browser's, and so
   * deleting the cache cannot touch a database.
   */
  readonly sessionData: string;
  /** Where this process and Electron write logs (`app.getPath("logs")`). */
  readonly logs: string;
  /** Scratch space for what is written and thrown away (`app.getPath("temp")`). */
  readonly temp: string;
}

/**
 * What was found beside the executable.
 *
 * `"unreadable"` is deliberately its own case rather than being folded into
 * `"absent"`: a directory that refuses to answer is not a directory that said
 * no, and the caller says so on stderr instead of deciding for the user.
 */
export type MarkerProbe =
  | { readonly kind: "present" }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly detail: string };

/**
 * The decision, and the reason for it.
 *
 * `"unwritable"` is the read-only stick: the marker is there — so portable mode
 * is what was asked for — and the folder beside the executable will not take a
 * byte. There is no way to honour the marker and no honest way to write the
 * user's life onto the host, so the caller explains and stops.
 */
export type PortableDecision =
  | { readonly portable: true; readonly root: string; readonly paths: PortablePaths }
  | {
      readonly portable: false;
      readonly reason: "absent" | "unreadable" | "unwritable";
      /** The OS's own words for what went wrong, or `null` when nothing did. */
      readonly detail: string | null;
    };

/**
 * Where a portable build keeps everything: `<exeDir>\NexusData` and its three
 * subfolders.
 *
 * `join` and nothing else, which is what makes a changing drive letter a
 * non-issue: the paths are derived from where the executable actually is on
 * THIS launch, so `E:\Nexus` on one computer and `F:\Nexus` on the next produce
 * `E:\Nexus\NexusData` and `F:\Nexus\NexusData` with no stored path to go stale.
 * Spaces and non-ASCII letters need nothing special either; they are ordinary
 * characters in a Windows path and are never re-encoded here.
 */
export function portablePaths(exeDir: string): PortablePaths {
  const root = portableRoot(exeDir);
  return {
    userData: root,
    sessionData: join(root, "session"),
    logs: join(root, "logs"),
    temp: join(root, "temp"),
  };
}

/** The folder itself, without the three that live inside it. A portable launch's `userData`. */
export function portableRoot(exeDir: string): string {
  return join(exeDir, PORTABLE_DATA_DIR);
}

/**
 * The pure half of ADR-102: a directory and one probe in, a decision out. No
 * filesystem, no Electron, no module state — the five cases the acceptance
 * names (marker present, absent, unreadable, a drive root, spaces and non-ASCII
 * letters) are five arguments to this function.
 */
export function decidePortable(exeDir: string, probe: MarkerProbe): PortableDecision {
  // Absent is the ordinary case, and it is the one that must change NOTHING:
  // an installed build keeps using `%APPDATA%\Nexus` and the caller sets no
  // path at all.
  if (probe.kind === "absent") return { portable: false, reason: "absent", detail: null };
  if (probe.kind === "unreadable") {
    return { portable: false, reason: "unreadable", detail: probe.detail };
  }
  return { portable: true, root: portableRoot(exeDir), paths: portablePaths(exeDir) };
}

/**
 * Looks for the marker beside the executable.
 *
 * `statSync` rather than `readFileSync`, because presence is the decision: a
 * marker whose bytes cannot be read — an ACL, a file held open by an antivirus
 * scan — is still a marker. A `portable.txt` that is a DIRECTORY answers
 * `"unreadable"`, since it cannot be the marker and cannot be ignored either;
 * `EACCES`, `EPERM` and anything else this process cannot explain land there
 * too. `ENOENT` is "nothing there", and so is `ENOTDIR` — a path that cannot
 * hold a file cannot hold this one.
 */
export function probePortableMarker(exeDir: string): MarkerProbe {
  const markerPath = join(exeDir, PORTABLE_MARKER_FILE);
  try {
    // Read for its presence and its KIND, never for its bytes.
    if (!statSync(markerPath).isFile()) {
      return { kind: "unreadable", detail: `${markerPath} is not a file` };
    }
    return { kind: "present" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "absent" };
    return { kind: "unreadable", detail: describeError(error) };
  }
}

/**
 * Makes every directory the redirect needs real, and proves this process may
 * write in the root.
 *
 * Both halves are needed. `app.setPath` THROWS when the directory does not
 * exist, so creating the four is a requirement of the call rather than
 * tidiness. And `mkdirSync` is not enough on its own, because the case it
 * misses is exactly the one worth catching: it is silent when the folder is
 * already there, read-only stick included. So the question "may Nexus keep its
 * data here" is answered by a WRITE — a file that is removed again at once,
 * with a random name so two launches on the same stick cannot collide — rather
 * than by a permission call whose answer differs between file systems.
 *
 * A half-created tree is left behind on failure, deliberately: empty folders
 * are harmless, and deleting a folder this function did not create (the one
 * already on the stick, holding a previous session's database) would be the
 * worse outcome.
 */
export function ensurePortableRoot(
  paths: PortablePaths,
): { readonly ok: true } | { readonly ok: false; readonly detail: string } {
  try {
    mkdirSync(paths.userData, { recursive: true });
    mkdirSync(paths.sessionData, { recursive: true });
    mkdirSync(paths.logs, { recursive: true });
    mkdirSync(paths.temp, { recursive: true });
    const probe = join(paths.userData, `.write-probe-${randomBytes(6).toString("hex")}`);
    writeFileSync(probe, "");
    rmSync(probe, { force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: describeError(error) };
  }
}

/** The two things this module needs from a launch, so it can stay Electron-free. */
export interface PortableLaunch {
  /** The directory the executable sits in: `dirname(app.getPath("exe"))`. */
  readonly exeDir: string;
  /** Electron's own `app.setPath`, injected. */
  readonly setPath: (name: PortablePathName, directory: string) => void;
}

/**
 * The whole of what `index.ts` calls, once, at module scope and before `ready`:
 * probe, decide, and — only in portable mode, and only once the folder has
 * proved it will take a write — point the four paths at the stick.
 *
 * The filesystem is proved BEFORE anything is redirected, so a refusal leaves
 * the process with the ordinary paths still in place. That matters for the one
 * caller that does not stop: `reason: "unreadable"` is reported and the launch
 * continues as an installed build, beside a marker somebody can then go and fix.
 */
export function applyPortableMode(launch: PortableLaunch): PortableDecision {
  const decision = decidePortable(launch.exeDir, probePortableMarker(launch.exeDir));
  if (!decision.portable) return decision;

  const writable = ensurePortableRoot(decision.paths);
  if (!writable.ok) {
    return { portable: false, reason: "unwritable", detail: writable.detail };
  }

  launch.setPath("userData", decision.paths.userData);
  launch.setPath("sessionData", decision.paths.sessionData);
  launch.setPath("logs", decision.paths.logs);
  launch.setPath("temp", decision.paths.temp);
  return decision;
}

/** The OS's own words, never a guess about them. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

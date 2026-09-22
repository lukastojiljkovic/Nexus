/**
 * The directory Nexus generates for one circuit's run — slice E6 of ADR-085.
 *
 * **A run never touches a directory the user picked.** `elec:export-code`
 * writes a package wherever a native dialog points, and that is right for an
 * export: the user is taking the code somewhere. The runner is the other thing,
 * and DEV-007's first re-opening trigger is „pointing the runner at a directory
 * the user types or picks, instead of one Nexus generated". So the workspace is
 * DERIVED — under this account's own directory, named by a hash of the
 * circuit's id — and everything a run writes happens inside it.
 *
 * **The hash is not decoration.** Ids in this app are bounded
 * (`MAX_ID_LENGTH = 200`) and deliberately NOT pattern-checked, because a slug
 * and a composite are both legitimate ids, which means `..` is a valid id and
 * so is every other thing a filesystem would read as structure. A derived
 * directory name is the only shape that is safe to build a path from.
 *
 * **The workspace is wiped and rewritten on every run.** That is a deliberate
 * choice over an incremental one: `colcon build` finds every package under
 * `src/`, so a workspace that kept a previous circuit's package would build
 * both, and the user would be reading a log about code they are no longer
 * looking at. A clean workspace costs seconds and cannot report on the wrong
 * thing. It also bounds what the runner can leave behind to one directory.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";

/** The directory under an account's own folder. Named for what it holds, not for the tool inside it. */
export const RUNNER_DIR = "elec-run";

/**
 * 128 bits of the circuit's id, as hex.
 *
 * Short enough to read in a path that a user may see in a build log, long
 * enough that two circuits cannot collide in practice.
 */
export function runnerWorkspaceName(circuitId: string): string {
  return createHash("sha256").update(circuitId, "utf8").digest("hex").slice(0, 32);
}

/** Where a circuit's workspace lives, under an account directory. Derived, never chosen. */
export function runnerWorkspacePath(accountDir: string, circuitId: string): string {
  return join(accountDir, RUNNER_DIR, runnerWorkspaceName(circuitId));
}

/**
 * That a generated file's path really is inside the package directory.
 *
 * Nothing a user sends reaches here — `generateRosPackage` builds every one of
 * these paths, from a package name that is `[a-z0-9_]` by construction — so
 * this can only fire if that generator changes. Which is the point: it makes „a
 * future edit introduces a `..`" a thrown error rather than eight files written
 * somewhere nobody chose.
 *
 * It lives HERE rather than in `index.ts` because there are now two writers:
 * the export to a user-chosen directory, and the run's own workspace. A check
 * that guards two doors belongs beside neither.
 */
export function assertInsidePackage(path: string): void {
  const outside =
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
  if (outside) throw new Error(`Generated package path escapes its directory: ${path}`);
}

/** One file of a generated package, its path relative to the package root. Mirrors `@nexus/core`'s `RosFile`. */
export interface WorkspaceFile {
  readonly path: string;
  readonly contents: string;
}

/**
 * Wipes the workspace, writes the package into `<workspace>/src/<name>/`, and
 * answers with the workspace as the filesystem really spells it.
 *
 * **The path is derived inside this function and cannot be passed in.** The
 * erase below is the most destructive thing this module does, and the way to
 * make „a caller passed the wrong directory" impossible is for no caller to
 * pass one: `circuitId` selects the directory and `accountDir` anchors it, and
 * there is no argument that could name a user's folder.
 *
 * The returned path is `realpath`'d — T3 in the threat model — so the path the
 * spawn is given is the one that was on disk at the moment the check ran rather
 * than the one that was intended. That narrows the window; it does not close
 * it, and the threat model accepts the residual: closing it needs `O_NOFOLLOW`
 * semantics the platform does not offer for a directory argument.
 */
export function writeWorkspace(
  accountDir: string,
  circuitId: string,
  packageName: string,
  files: readonly WorkspaceFile[],
): string {
  const workspace = runnerWorkspacePath(accountDir, circuitId);
  rmSync(workspace, { recursive: true, force: true });

  const root = join(workspace, "src", packageName);
  mkdirSync(root, { recursive: true });
  for (const file of files) {
    assertInsidePackage(file.path);
    const target = join(root, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.contents, "utf8");
  }
  return realpathSync(workspace);
}

/**
 * That a path handed to the runner is still inside the account directory it was
 * derived from, with the symlinks resolved.
 *
 * Called immediately before a spawn rather than only after the write, because
 * the two are separate moments and the interval between them is the one an
 * attacker who can write to the account directory would use.
 */
export function isInsideAccount(accountDir: string, workspace: string): boolean {
  try {
    const root = realpathSync(accountDir);
    const real = realpathSync(workspace);
    return real === root || real.startsWith(root + sep);
  } catch {
    // A workspace that cannot be resolved is a workspace that cannot be run in.
    // The caller's refusal names its own reason; this one does not need to.
    return false;
  }
}

/** Where `colcon` puts what it built. Its own layout, and not a choice this app makes. */
const BUILD_OUTPUT_DIR = "install";

/**
 * Did the build actually PRODUCE the package, or only report that it had?
 *
 * **`colcon build` exits 0 over a workspace with nothing in it.** That is the
 * whole reason this exists: an exit status is a claim about the tool, and the
 * user asked a question about their machine. A build that found no package, or
 * that skipped the one it found, or that succeeded in a directory other than the
 * one this app mounted, would report success — and the panel would tell the user
 * their circuit had been built when no file on disk says so.
 *
 * So the answer is a fact about the filesystem: `install/<package>` is the
 * prefix a successful `colcon build` creates for the package, and it cannot
 * survive from a previous run because {@link writeWorkspace} wipes the workspace
 * before every one. (That is what makes this sound rather than merely plausible
 * — the check reads the CURRENT run's output only because the directory it reads
 * was empty when the run started.)
 *
 * **The containment test is `isInsideAccount`'s, reused rather than re-derived.**
 * A package name is not a path, but it is joined into one, so the same rule that
 * decides „is this workspace inside the account" decides „does this marker stay
 * inside the workspace" — one definition of *inside* in the module, and a name
 * carrying `..` fails it by falling outside rather than by being pattern-matched
 * against a list of bad characters. A name that cannot be inside cannot be
 * built, and the answer is the same `false` as a build that produced nothing:
 * the two are one fact to the user, and neither is a throw in the middle of a
 * run's conclusion.
 */
export function packageBuilt(workspace: string, packageName: string): boolean {
  const marker = join(workspace, BUILD_OUTPUT_DIR, packageName);
  return isInsideAccount(workspace, marker) && existsSync(marker);
}

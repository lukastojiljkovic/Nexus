import { foldSearchText } from "@nexus/core";
import { dayUnit, strings } from "./strings.js";

/**
 * The search palette's command registry (021-d): a fixed, locally-matched
 * list of shell actions — navigate to a module, flip the theme, lock the
 * app, or repair the search index (PRD 08 §7's "index corruption ->
 * transparent rebuild", the only user-facing trigger for one). Matching
 * (`matchCommands`) is synchronous and never touches IPC; only the rebuild
 * command's own `run` does.
 */

export interface SearchCommand {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly keywords: readonly string[];
  readonly run: () => void;
}

/**
 * Stable id for the rebuild command. `SearchPalette` checks activated
 * commands against it: every other command closes the palette right away,
 * but this one reports a count first (see `SearchCommandsContext.
 * onRebuildComplete`) and the palette stays open until that arrives.
 */
export const REBUILD_COMMAND_ID = "rebuild-search-index";

export interface SearchCommandsContext {
  /** Needed only by the rebuild command's own `rebuildSearchIndex` call. */
  profileId: string;
  /** Enabled module ids, already in the registry's own order (`resolveEnabled`'s contract) — one "Idi na: …" command is built per id, in that order. */
  enabledModuleIds: readonly string[];
  /** The shell's own id -> Serbian display name lookup (`App.tsx`'s `moduleName`), reused rather than re-spelled here. */
  moduleName: (id: string) => string;
  onNavigate: (moduleId: string) => void;
  onToggleTheme: () => void;
  onLock: () => void;
  /** Reports the rebuild's outcome as an already-Serbian-formatted string, for the palette's footer (see that component for why it owns the delayed close). */
  onRebuildComplete: (message: string) => void;
}

function formatRebuildDone(count: number): string {
  const c = strings.search.commands;
  return `${c.rebuildDonePrefix} ${count} ${dayUnit(count, c.rebuildRecordsUnitOne, c.rebuildRecordsUnitMany)}`;
}

/**
 * Builds the fixed command list, in display order: one "Idi na: <modul>" per
 * enabled module, then theme toggle, lock, and index rebuild. Every `run` is
 * a plain callback into the shell except the rebuild's, which is the one
 * command with no dedicated shell action to call — it talks to
 * `window.nexus.rebuildSearchIndex` directly.
 */
export function buildSearchCommands(context: SearchCommandsContext): SearchCommand[] {
  const c = strings.search.commands;
  const commands: SearchCommand[] = context.enabledModuleIds.map((moduleId) => ({
    id: `goto-${moduleId}`,
    label: `${c.goToPrefix}${context.moduleName(moduleId)}`,
    keywords: [],
    run: () => context.onNavigate(moduleId),
  }));

  commands.push(
    {
      id: "toggle-theme",
      // Reuses the topbar's own toggle label (identical text) rather than a second copy of it.
      label: strings.app.themeToggle,
      keywords: [strings.app.themeDan, strings.app.themeNoc],
      run: () => context.onToggleTheme(),
    },
    {
      id: "lock",
      label: c.lock,
      keywords: ["izlaz", "odjava"],
      run: () => context.onLock(),
    },
    {
      id: REBUILD_COMMAND_ID,
      label: c.rebuildIndex,
      keywords: ["popravka", "obnova"],
      run: () => {
        void (async () => {
          try {
            const count = await window.nexus.rebuildSearchIndex(context.profileId);
            context.onRebuildComplete(formatRebuildDone(count));
          } catch (error) {
            console.error("Nexus: failed to rebuild the search index:", error);
            context.onRebuildComplete(c.rebuildError);
          }
        })();
      },
    },
  );

  return commands;
}

/**
 * Keeps a command when every already-folded typed term is a prefix of some
 * folded word in its label + keywords. `terms` arrive pre-folded from
 * `parseSearchQuery` (the palette's own job) — only the command's text is
 * folded here, the same one-side-per-call split `@nexus/core`'s own search
 * matching uses. An empty `terms` array (nothing typed yet, or a bare `>`)
 * trivially matches every command, since `Array.every` on an empty array is
 * vacuously true — that is what lets the palette show the full command list
 * on a bare `>`.
 */
export function matchCommands(
  commands: readonly SearchCommand[],
  terms: readonly string[],
): SearchCommand[] {
  return commands.filter((command) => {
    const words = foldSearchText(`${command.label} ${command.keywords.join(" ")}`).split(/\s+/);
    return terms.every((term) => words.some((word) => word.startsWith(term)));
  });
}

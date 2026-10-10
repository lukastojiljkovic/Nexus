/**
 * The assistant's tools over the app: `createToolRegistry(deps)`.
 *
 * **What a tool is here.** One `Tool` from the assistant contract: a name
 * (`area.verb`), a description in both languages that says WHEN to reach for it,
 * a JSON schema as tight as the data it accepts, its `effect`, and a `run` that
 * validates its arguments AGAIN (a schema is advice to a model, not a gate),
 * calls the same main-side store or function the app's own IPC handler calls,
 * and answers with a short text the model can read — plus citations and a
 * `navigateTo` where they apply.
 *
 * **Why every write asks first.** `write` and `network` tools go through
 * `ToolContext.confirm` before touching anything, with a one-line summary in the
 * user's language naming exactly what will change. A refusal is an ordinary
 * result (`ok: false`, and the sentence the contract fixes for it), never an
 * error: saying no is an answer, and a tool that carried on regardless would be
 * the whole feature failing.
 *
 * **The dependencies are the app's own seams.** This folder owns no list of
 * stores, no second database handle and no copy of the search pipeline: it is
 * handed a way to open a profile's database (the same shape `main/index.ts` and
 * the module kit use), main's clock, the app's global search, the packs service,
 * the TIMERS module's arming path, the module registry and — when the user has
 * turned web search on — the web service. That is what makes the whole registry
 * testable against a real database with fakes only for the two things that are
 * not one (`timers.ts` and `packs.ts` say why each of those is a dependency).
 *
 * **Where the tools come from, area by area.** `app.ts` (navigation and the
 * global search), `tasks.ts`, `calendar.ts`, `notes.ts`, `habits.ts`,
 * `timers.ts`, `packs.ts`, `emergency.ts`. A module built on the kit in a later
 * wave adds its own file here and one line to `appTools`'s neighbours below —
 * the registry is a flat list of areas, and a name that collides with another's
 * is refused rather than shadowed.
 *
 * **The wave-1 kit modules joined in wave 2**, one file each: `library.ts`,
 * `culture.ts`, `car.ts`, `pantry.ts`, `cookbook.ts`, `recorder.ts`,
 * `calculator.ts`, `reader.ts`, `wiki.ts`, `maps.ts`, `lab.ts` and
 * `miniapps.ts`. A module with nothing of the user's own to read or write has no
 * file here on purpose, and the merge report lists which and why: the games are
 * reachable through `app.open` and a tool that answered with a score would be
 * the page's own table restated worse; `signals.ts`, `workshop.ts` and
 * `drawings.ts` own no table at all (a meter, a file on disk, a drawing on
 * disk); the scanner's one write path is `NoteStore`, which `notes.ts` already
 * covers; and the translator's dictionary is a signed content pack read through
 * its own module's main half, which this registry is not handed a seam to.
 */

import type { Tool, ToolRegistry, WebService } from "@nexus/core";
import type { SearchResult } from "../../../shared/ipc.js";
import { appTools, type ModuleLookup } from "./app.js";
import { calculatorTools } from "./calculator.js";
import { calendarTools } from "./calendar.js";
import { carTools } from "./car.js";
import { cookbookTools } from "./cookbook.js";
import { cultureTools } from "./culture.js";
import { emergencyTools } from "./emergency.js";
import { habitTools } from "./habits.js";
import { labTools } from "./lab.js";
import { libraryTools } from "./library.js";
import { mapsTools } from "./maps.js";
import { miniappsTools } from "./miniapps.js";
import { noteTools } from "./notes.js";
import { packTools, type PacksLookup } from "./packs.js";
import { pantryTools } from "./pantry.js";
import { readerTools } from "./reader.js";
import { recorderTools } from "./recorder.js";
import { taskTools } from "./tasks.js";
import { timerTools, type TimerHost } from "./timers.js";
import { wikiTools } from "./wiki.js";
import type { ProfileDb } from "./support.js";

export type { ModuleLookup } from "./app.js";
export type { PacksLookup } from "./packs.js";
export type { TimerHost } from "./timers.js";
export type { AssistantPhrase, ProfileDb } from "./support.js";

/**
 * Everything the registry needs from the app. Each member is a seam the app
 * already has — see the file header — so the wiring that builds this object owns
 * no logic and this folder owns no state.
 */
export interface ToolDeps {
  /** Opens a profile's database exactly as `main/index.ts` does for every store. */
  readonly profileDb: ProfileDb;
  /** Main's wall clock, injected so a test can move it (and so no tool reads `Date.now()` itself). */
  readonly now: () => number;
  /** The app's own global search — `runSearchQuery`'s pipeline, not a second one. */
  readonly search: (
    profileId: string,
    query: string,
    limit: number,
  ) => Promise<readonly SearchResult[]>;
  /** The Packs service (`createPacksIpc`), for the installed list. */
  readonly packs: PacksLookup;
  /** The TIMERS module's start/list, which also arms main's clock. */
  readonly timers: TimerHost;
  /** The app's module registry (`createModuleRegistry`), for navigation. */
  readonly modules: ModuleLookup;
  /** The web service, or `null` in a build without one. Its tools appear only when the user turned web search on. */
  readonly web: WebService | null;
}

/** A tool name is `area.verb`, both lower-case: `tasks.create`, `app.open`. */
const TOOL_NAME = /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/;

export function createToolRegistry(deps: ToolDeps): ToolRegistry {
  /**
   * The app's own tools, built once — they are declarations over the deps above,
   * and rebuilding them on every `tools()` call would hand the agent loop a
   * fresh function identity per turn for no reason.
   */
  const appLevel: readonly Tool[] = [
    ...appTools({ modules: deps.modules, search: deps.search }),
    ...taskTools({ profileDb: deps.profileDb, now: deps.now }),
    ...calendarTools({ profileDb: deps.profileDb }),
    ...noteTools({ profileDb: deps.profileDb, now: deps.now, search: deps.search }),
    ...habitTools({ profileDb: deps.profileDb, now: deps.now }),
    ...timerTools({ timers: deps.timers }),
    ...packTools({ packs: deps.packs }),
    ...emergencyTools({ profileDb: deps.profileDb }),
    // The wave-1 kit modules, in the order their manifests sort: library,
    // culture, car, pantry, cookbook, recorder, calculator, reader, wiki, maps,
    // lab, miniapps.
    ...libraryTools({ profileDb: deps.profileDb, now: deps.now }),
    ...cultureTools({ profileDb: deps.profileDb, now: deps.now }),
    ...carTools({ profileDb: deps.profileDb, now: deps.now }),
    ...pantryTools({ profileDb: deps.profileDb, now: deps.now }),
    ...cookbookTools({ profileDb: deps.profileDb }),
    ...recorderTools({ profileDb: deps.profileDb }),
    ...calculatorTools({ profileDb: deps.profileDb }),
    ...readerTools({ profileDb: deps.profileDb, packs: deps.packs }),
    ...wikiTools({ profileDb: deps.profileDb }),
    ...mapsTools({ profileDb: deps.profileDb }),
    ...labTools({ profileDb: deps.profileDb }),
    ...miniappsTools({ profileDb: deps.profileDb, now: deps.now }),
  ];

  return {
    /**
     * The tools one turn may use.
     *
     * `web` comes from the caller — the agent loop passes what the user's own
     * setting says — and the web tools are added only when it is true AND this
     * build has a web service. A registry asked for web tools it does not have
     * answers with the app's tools rather than throwing: an assistant that
     * cannot search the web is still an assistant, and `checkTools` below would
     * turn that into a turn that never starts.
     */
    tools: ({ web }) => {
      const tools =
        web && deps.web !== null ? [...appLevel, ...deps.web.tools()] : [...appLevel];
      checkTools(tools);
      return tools;
    },
  };
}

/**
 * The one invariant of a set of tools: a model addresses them BY NAME, so two
 * tools with one name are one tool that half the time does not exist.
 *
 * Checked on every `tools()` because the web tools arrive from another part at
 * runtime and could collide with an app tool; it is a handful of string
 * comparisons per turn, which is nothing beside a model call. The name shape is
 * checked here for the same reason a manifest's `id` is: a name is what the
 * model must spell exactly, and `tasks.create` and `tasks.Create` are two tools
 * that only exist by accident.
 */
function checkTools(tools: readonly Tool[]): void {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (!TOOL_NAME.test(tool.name)) {
      throw new Error(
        `Assistant tool "${tool.name}" is not named area.verb in lower case.`,
      );
    }
    if (seen.has(tool.name)) {
      throw new Error(`Assistant tool "${tool.name}" is declared twice.`);
    }
    seen.add(tool.name);
  }
}

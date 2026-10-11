/**
 * What the assistant can do to the APP itself: open a place, list what exists,
 * run the global search.
 *
 * `app.open` is the one tool in this folder whose effect is `navigate` rather
 * than `read`: it changes no data and shows no dialog, it moves the page the
 * user is looking at. The result therefore carries `navigateTo` — the contract's
 * `AppLocation` — and the page (built in the next wave) is what acts on it. The
 * tool itself touches nothing but the registry below.
 *
 * **Where the module ids come from.** The app's own registry
 * (`shared/modules.ts`'s `createModuleRegistry`), handed in as a dependency so
 * this file holds no second list: a module added as a folder is openable the day
 * it exists, and an id nobody registered is refused with the ids that ARE
 * registered in the message rather than silently returning "opened".
 *
 * **Why a compiled-in module has no description here.** The shell's sixteen
 * modules keep their names and their one-line descriptions in the renderer's
 * `strings` table (`moduleName.ts`), which main cannot read — a fact, not an
 * omission. A module built on the kit carries its own copy in its manifest
 * (`ModuleManifest.copy`), so it is named and described in the active locale
 * below; for the rest this tool answers with the id, the navigation group and
 * the fact that the manual has the prose. The assistant's own manual
 * (`assistant/manual/`) is exactly that second surface, and it is the reason
 * this split is honest rather than a gap.
 */

import type { AssistantLocale, ModuleManifest, Tool } from "@nexus/core";
import { MAX_ID_LENGTH } from "@nexus/core";
import type { SearchResult } from "../../../shared/ipc.js";
import { asArgs, asIdentifier, asOptionalCount, asOptionalText, asText } from "./args.js";
import { assertLive, guard, okResult, phrase, text, type AssistantPhrase } from "./support.js";

/** What navigation needs of the app's registry — `ModuleRegistry` satisfies this, and a test can hand in a two-module stand-in. */
export interface ModuleLookup {
  all(): readonly ModuleManifest[];
  get(id: string): ModuleManifest | undefined;
}

/** The tools in this area need three things the app owns: its registry, its global search, and its clock. */
export interface AppToolDeps {
  readonly modules: ModuleLookup;
  readonly search: (
    profileId: string,
    query: string,
    limit: number,
  ) => Promise<readonly SearchResult[]>;
}

/** How many results `app.search` answers with when the model names no cap. */
const DEFAULT_SEARCH_LIMIT = 8;

/** The most results one search may ask for — `MAX_SEARCH_LIMIT`'s order of magnitude, and far below the palette's own 200: a tool result is read by a model, not scrolled by a person. */
const MAX_SEARCH_LIMIT = 20;

/** A settings card key: a shell section id (`profile`, `notifications`) or a module's own id, both kebab-case. */
const SETTINGS_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A module id is a kebab slug — the shape `ModuleManifest.id` states and `asIdentifier` bounds. */
const MODULE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SEARCH_RESULTS: AssistantPhrase<[count: number, query: string]> = {
  sr: (count, query) => `Rezultati (${count}) za „${query}“:`,
  en: (count, query) => `Results (${count}) for “${query}”:`,
};

const SEARCH_EMPTY: AssistantPhrase<[query: string]> = {
  sr: (query) => `Nema rezultata za „${query}“.`,
  en: (query) => `No results for “${query}”.`,
};

const MODULES_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Moduli (${count}):`,
  en: (count) => `Modules (${count}):`,
};

/** Says out loud where the prose for a compiled-in module is, so a model that needs to explain „Učenje" does not invent one. */
const MODULES_MANUAL_HINT = {
  sr: "Moduli bez opisa su ugrađeni moduli; njihove opise i namenu čitaj iz priručnika aplikacije.",
  en: "Modules without a description are built-in ones; read what they are for from the app manual.",
} as const;

const OPEN_FAILED_UNKNOWN: AssistantPhrase<[id: string, known: string]> = {
  sr: (id, known) => `Nepoznat modul „${id}“. Poznati moduli: ${known}.`,
  en: (id, known) => `Unknown module “${id}”. Known modules: ${known}.`,
};

const OPENED: AssistantPhrase<[id: string]> = {
  sr: (id) => `Otvoren modul „${id}“.`,
  en: (id) => `Opened module “${id}”.`,
};

export function appTools(deps: AppToolDeps): readonly Tool[] {
  const open: Tool = {
    name: "app.open",
    description: {
      sr: "Otvara stranicu u aplikaciji: modul, a po potrebi i jednu stavku u njemu (belešku, zadatak, događaj) ili karticu u Podešavanjima. Koristi ga kada korisnik traži da ga odvedeš negde („otvori zadatke“, „pokaži mi taj događaj“, „podešavanja obaveštenja“).",
      en: "Opens a page in the app: a module, and optionally one item inside it (a note, a task, an event) or one Settings card. Use it when the user asks to be taken somewhere (“open my tasks”, “show me that event”, “notification settings”).",
    },
    parameters: {
      type: "object",
      properties: {
        module: {
          type: "string",
          pattern: MODULE_ID.source,
          description: "A module id from app.modules, e.g. \"tasks\", \"calendar\", \"notes\", \"timers\", \"settings\".",
        },
        item: {
          type: "string",
          maxLength: MAX_ID_LENGTH,
          description: "The id of one item inside that module, when the user means a specific row.",
        },
        settings: {
          type: "string",
          pattern: SETTINGS_KEY.source,
          description: "For module \"settings\": the card to open, e.g. \"notifications\", \"security\", \"profile\".",
        },
      },
      required: ["module"],
      additionalProperties: false,
    },
    effect: "navigate",
    run: (rawArgs, context) =>
      guard(context, () => {
        const args = asArgs(rawArgs);
        const moduleId = asIdentifier(args.module, "module");
        const manifest = deps.modules.get(moduleId);
        if (manifest === undefined) {
          throw new Error(
            phrase(
              context.locale,
              OPEN_FAILED_UNKNOWN,
              moduleId,
              deps.modules
                .all()
                .map((entry) => entry.id)
                .join(", "),
            ),
          );
        }
        const item =
          args.item === undefined ? undefined : asIdentifier(args.item, "item");
        const settings = optionalSettingsKey(args.settings);
        return okResult(phrase(context.locale, OPENED, moduleId), {
          navigateTo: locationOf(moduleId, item, settings),
        });
      }),
  };

  const modules: Tool = {
    name: "app.modules",
    description: {
      sr: "Izlistava module koje Nexus ima i čemu svaki služi. Koristi ga pre nego što predložiš gde se nešto nalazi u aplikaciji, i pre app.open kada nisi siguran koji je id modula.",
      en: "Lists the modules Nexus has and what each one is for. Use it before telling the user where something lives in the app, and before app.open when you are unsure of a module id.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const all = deps.modules.all();
        const lines = all.map((manifest) => describeModule(context.locale, manifest));
        return okResult(
          [`${phrase(context.locale, MODULES_HEADING, all.length)}`, ...lines, text(context.locale, MODULES_MANUAL_HINT)].join(
            "\n",
          ),
        );
      }),
  };

  const search: Tool = {
    name: "app.search",
    description: {
      sr: "Pokreće globalnu pretragu aplikacije preko zadataka, događaja, beleški, predmeta, špilova i dokumenata. Koristi je kao prvi korak kada korisnik pita gde se nešto nalazi ili traži nešto što je već zapisano.",
      en: "Runs the app's global search across tasks, events, notes, subjects, decks and documents. Use it as the first step when the user asks where something is or looks for something already recorded.",
    },
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200, description: "What to search for." },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_SEARCH_LIMIT,
          description: "How many results to answer with. Defaults to 8.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asText(args.query, "query", 200);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_SEARCH_LIMIT) ?? DEFAULT_SEARCH_LIMIT;
        const hits = await deps.search(context.profileId, query, limit);
        if (hits.length === 0) {
          return okResult(phrase(context.locale, SEARCH_EMPTY, query));
        }
        return okResult(
          [
            phrase(context.locale, SEARCH_RESULTS, hits.length, query),
            ...hits.map((hit) => searchLine(hit)),
          ].join("\n"),
        );
      }),
  };

  return [open, modules, search];
}

/**
 * One module's row. A kit module carries its own words in its manifest, in both
 * languages, and they are printed in the active one; a compiled-in module has
 * none in this process (see the file header) and prints its id and its group.
 */
function describeModule(locale: AssistantLocale, manifest: ModuleManifest): string {
  const copy = manifest.copy;
  if (copy === undefined) {
    return `- ${manifest.id} (${manifest.group})`;
  }
  return `- ${manifest.id} (${manifest.group}): ${copy.name[locale]} — ${copy.description[locale]}`;
}

/** One search hit as a line the model can quote: what it is, its title, and the snippet the index matched in. */
function searchLine(hit: SearchResult): string {
  const snippet = hit.snippet.trim().replace(/\s+/g, " ");
  const id = hit.entityId;
  return snippet.length === 0
    ? `- ${hit.kind} ${id}: ${hit.title}`
    : `- ${hit.kind} ${id}: ${hit.title} — ${snippet}`;
}

/** A settings card key, bounded to the two shapes the page's own section ids take. */
function optionalSettingsKey(value: unknown): string | undefined {
  const key = asOptionalText(value, "settings", 64);
  if (key === undefined) return undefined;
  if (!SETTINGS_KEY.test(key)) {
    throw new Error('"settings" must be a settings card key, e.g. "notifications".');
  }
  return key;
}

/** The location, with only the parts the model named — `exactOptionalPropertyTypes` is what makes the conditional shape the honest one here. */
function locationOf(
  moduleId: string,
  item: string | undefined,
  settings: string | undefined,
): { module: string; item?: string; settings?: string } {
  const location: { module: string; item?: string; settings?: string } = { module: moduleId };
  if (item !== undefined) location.item = item;
  if (settings !== undefined) location.settings = settings;
  return location;
}


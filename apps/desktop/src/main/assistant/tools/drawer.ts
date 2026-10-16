/**
 * The Tools drawer: the calculators, converters and developer tools the app ships,
 * found by name, opened on their page, and — for the ones that have a runner — run
 * from the chat.
 *
 * **Where the list comes from.** `manifest.tools` across the app's module registry,
 * the same declarations the drawer's rail is derived from, read through the same
 * visibility rule (`isModuleVisible`). Nothing here keeps a second list of tools.
 *
 * **Why names are not in the results.** A tool's name is renderer copy
 * (`titleKey` resolves in `strings`), and main cannot read the renderer's strings.
 * The answers therefore name a tool by its id, which is an ASCII slug such as
 * `pdv` or `jedinicna-cena`, and by the keywords the registration declares, which
 * are what `drawer.find` matches. The page shows the name.
 *
 * **Why a runner exists for some tools only.** `runner/` holds the figures for the
 * tools whose arithmetic is a pure core call with flat inputs; the rest stay
 * `drawer.open`. A tool whose class forbids a verdict (`toolForbidsVerdict`) is
 * refused by `drawer.run` with a pointer to its page, whether or not it had a
 * runner, because the figure there is not the answer a chat should give alone.
 */

import {
  foldSearchText,
  toolDrawer,
  toolForbidsVerdict,
  validateToolArguments,
  type AppLocation,
  type ToolDrawer,
  type ToolRegistration,
  type Tool,
} from "@nexus/core";
import { isModuleVisible, type ShellVisibility } from "../../../shared/moduleVisibility.js";
import { TOOL_RISK_LINES } from "../../../shared/toolRiskCopy.js";
import type { ModuleLookup } from "./app.js";
import { asArgs, asOptionalCount, asOptionalEnum, asText } from "./args.js";
import { TOOL_RUNNERS } from "./runner/index.js";
import {
  assertLive,
  failResult,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
} from "./support.js";

export interface DrawerToolDeps {
  /** The app's module registry: where every tool a module declares is listed. */
  readonly modules: ModuleLookup;
  /** The device's module visibility (ADR-101): a tool of a switched-off module is not offered. */
  readonly visibility: () => ShellVisibility;
}

/**
 * The page each drawer is drawn on: „Alatke" is the `tools` module and „Stručne
 * alatke" the `pro` one. The same mapping `DRAWER_MODULES` holds in
 * `renderer/src/toolCatalogue.ts`, which main cannot import.
 */
const DRAWER_PAGE = { utilities: "tools", professional: "pro" } as const satisfies Record<
  ToolDrawer,
  string
>;

const DRAWERS = ["utilities", "professional"] as const satisfies readonly ToolDrawer[];

/** The longest search or tool id the model may send, and how many results a search answers with. */
const MAX_QUERY_CHARS = 120;
const MAX_TOOL_ID_CHARS = 64;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

/** The notice's own instruction: the figure is never shown without the line that qualifies it. */
const REPEAT_NOTICE: AssistantPhrase<[]> = {
  sr: () => "Ponovi ovu napomenu uz rezultat.",
  en: () => "Repeat this notice with the result.",
};

const NONE: AssistantPhrase<[query: string]> = {
  sr: (query) => `Nijedan alat ne odgovara pretrazi „${query}“.`,
  en: (query) => `No tool matches “${query}”.`,
};

const MORE: AssistantPhrase<[count: number]> = {
  sr: (count) => `…i još ${count}.`,
  en: (count) => `…and ${count} more.`,
};

const FOUND: AssistantPhrase<[count: number]> = {
  sr: (count) => `Alati (${count}):`,
  en: (count) => `Tools (${count}):`,
};

const RUNNABLE: { readonly sr: string; readonly en: string } = {
  sr: "računa u razgovoru",
  en: "runs in the chat",
};

const PAGE_ONLY: { readonly sr: string; readonly en: string } = {
  sr: "samo otvara stranicu",
  en: "opens its page only",
};

const NOT_FOUND: AssistantPhrase<[id: string]> = {
  sr: (id) => `Nema alata „${id}“. Nađi ga sa drawer.find.`,
  en: (id) => `There is no tool “${id}”. Find it with drawer.find.`,
};

const NO_INPUTS: AssistantPhrase<[id: string]> = {
  sr: (id) => `Alat „${id}“ nema ulaze koje asistent može da popuni. Otvori ga sa drawer.open bez vrednosti.`,
  en: (id) => `The tool “${id}” has no inputs the assistant can fill. Open it with drawer.open and no values.`,
};

const FORBIDDEN: AssistantPhrase<[id: string]> = {
  sr: (id) =>
    `Alat „${id}“ daje rezultat koji mora da oceni ovlašćeno lice, pa ga asistent ne računa. Otvori ga sa drawer.open da vidiš brojeve na stranici.`,
  en: (id) =>
    `The tool “${id}” gives a result a licensed person must judge, so the assistant does not compute it. Open it with drawer.open to see its figures on the page.`,
};

const NO_FIGURE: AssistantPhrase<[id: string]> = {
  sr: (id) => `Alat „${id}“ nema rezultat za te vrednosti.`,
  en: (id) => `The tool “${id}” has no figure for those values.`,
};

const RESULT_OF: AssistantPhrase<[id: string]> = {
  sr: (id) => `Rezultat alata „${id}“:`,
  en: (id) => `Result of “${id}”:`,
};

const OPENED: AssistantPhrase<[id: string, page: string]> = {
  sr: (id, page) => `Otvaram alat „${id}“ na stranici „${page}“.`,
  en: (id, page) => `Opening the tool “${id}” on the “${page}” page.`,
};

/** Every tool whose module is on, with the drawer it is drawn in. */
interface ListedTool {
  readonly tool: ToolRegistration;
  readonly drawer: ToolDrawer;
}

function listTools(deps: DrawerToolDeps): readonly ListedTool[] {
  const visibility = deps.visibility();
  return deps.modules
    .all()
    .filter((manifest) => isModuleVisible(manifest, visibility))
    .flatMap((manifest) => manifest.tools ?? [])
    .map((tool) => ({ tool, drawer: toolDrawer(tool) }));
}

function findListed(deps: DrawerToolDeps, id: string): ListedTool | undefined {
  return listTools(deps).find((entry) => entry.tool.id === id);
}

/** Whether `drawer.run` can answer this tool's figures in a chat: it has a runner and its class allows a figure. */
function runsInChat(tool: ToolRegistration): boolean {
  return TOOL_RUNNERS.has(tool.id) && !toolForbidsVerdict(tool.riskClass);
}

/** What a search matches: the id, the keywords, the category, the task groups and the toolkits. Folded, so the query is too. */
function searchable(tool: ToolRegistration): string {
  return foldSearchText(
    [tool.id, ...(tool.keywords ?? []), tool.category, ...tool.taskGroups, ...(tool.packs ?? [])].join(" "),
  );
}

export function drawerTools(deps: DrawerToolDeps): readonly Tool[] {
  const find: Tool = {
    name: "drawer.find",
    description: {
      sr: "Traži alat u Alatkama po nazivu ili oblasti, npr. „PDV“, „kredit“. Koristi ga kada korisnik traži alat ili računicu.",
      en: "Finds a tool in the Tools drawers by name or field, for example “VAT” or “loan”. Use it when the user looks for a tool or a calculation.",
    },
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: MAX_QUERY_CHARS,
          description: "A word from the tool's name or field.",
        },
        drawer: {
          type: "string",
          enum: [...DRAWERS],
          description: "utilities: everyday tools. professional: professional and developer tools.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many tools to list. Defaults to ${String(DEFAULT_LIMIT)}.`,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asText(args.query, "query", MAX_QUERY_CHARS);
        const drawer = asOptionalEnum(args.drawer, "drawer", DRAWERS);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;

        const terms = foldSearchText(query).split(/\s+/).filter((term) => term.length > 0);
        const matching = listTools(deps).filter(
          ({ tool, drawer: listedDrawer }) =>
            (drawer === undefined || listedDrawer === drawer) &&
            terms.every((term) => searchable(tool).includes(term)),
        );
        if (matching.length === 0) return okResult(phrase(context.locale, NONE, query));

        const shown = matching.slice(0, limit);
        const lines = [
          phrase(context.locale, FOUND, matching.length),
          ...shown.map(({ tool }) => {
            const how = runsInChat(tool) ? RUNNABLE : PAGE_ONLY;
            const kinds = [tool.category, ...(tool.packs ?? [])].join(", ");
            return `- ${tool.id} (${kinds}); ${text(context.locale, how)}`;
          }),
        ];
        if (matching.length > shown.length) {
          lines.push(phrase(context.locale, MORE, matching.length - shown.length));
        }
        return okResult(lines.join("\n"));
      }),
  };

  const open: Tool = {
    name: "drawer.open",
    description: {
      sr: "Otvara alat iz Alatki na njegovoj stranici, po id-u iz drawer.find, i može da unapred popuni polja. Koristi ga kada korisnik želi sam da koristi alat.",
      en: "Opens a tool on its page, by the id from drawer.find, and may fill its fields in advance. Use it when the user wants to use the tool themselves.",
    },
    parameters: {
      type: "object",
      properties: {
        tool: { type: "string", minLength: 1, maxLength: MAX_TOOL_ID_CHARS, description: "The tool's id." },
        values: {
          type: "object",
          description: "Fields to fill in, by the names drawer.run takes.",
        },
      },
      required: ["tool"],
      additionalProperties: false,
    },
    effect: "navigate",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const id = asText(args.tool, "tool", MAX_TOOL_ID_CHARS);
        const listed = findListed(deps, id);
        if (listed === undefined) return failResult(context.locale, phrase(context.locale, NOT_FOUND, id));

        const page = DRAWER_PAGE[listed.drawer];
        if (args.values === undefined) {
          return okResult(phrase(context.locale, OPENED, id, page), {
            navigateTo: { module: page, item: id } satisfies AppLocation,
          });
        }
        const runner = TOOL_RUNNERS.get(id);
        if (runner?.prefills !== true) {
          return failResult(context.locale, phrase(context.locale, NO_INPUTS, id));
        }
        const check = validateToolArguments(runner.params, args.values);
        if (!check.ok) return failResult(context.locale, check.errors.join("; "));
        return okResult(phrase(context.locale, OPENED, id, page), {
          navigateTo: {
            module: page,
            item: id,
            action: { name: "prefill", payload: { values: check.value } },
          } satisfies AppLocation,
        });
      }),
  };

  const run: Tool = {
    name: "drawer.run",
    description: {
      sr: "Računa brojeve alata iz Alatki za vrednosti koje korisnik navede, po id-u iz drawer.find. Za brojeve, nikad za ocenu.",
      en: "Computes a tool's figures from the values the user gives, by the id from drawer.find. For numbers only, never a judgement.",
    },
    parameters: {
      type: "object",
      properties: {
        tool: { type: "string", minLength: 1, maxLength: MAX_TOOL_ID_CHARS, description: "The tool's id." },
        values: { type: "object", description: "The inputs, by the names the tool takes." },
      },
      required: ["tool", "values"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const id = asText(args.tool, "tool", MAX_TOOL_ID_CHARS);
        const listed = findListed(deps, id);
        if (listed === undefined) return failResult(context.locale, phrase(context.locale, NOT_FOUND, id));
        const { tool } = listed;

        // A class that forbids a verdict is never computed in a chat: the page
        // draws its figures under the notice, and that is the only place it is shown.
        if (toolForbidsVerdict(tool.riskClass)) {
          return failResult(context.locale, phrase(context.locale, FORBIDDEN, id));
        }
        const runner = TOOL_RUNNERS.get(id);
        if (runner === undefined) return failResult(context.locale, phrase(context.locale, NO_INPUTS, id));

        const check = validateToolArguments(runner.params, args.values);
        if (!check.ok) return failResult(context.locale, check.errors.join("; "));
        const lines = runner.run(check.value as Record<string, unknown>, context.locale);
        if (lines === null) return failResult(context.locale, phrase(context.locale, NO_FIGURE, id));

        // The notice travels with the figure, so the model that repeats the number
        // repeats what qualifies it. `none` has no notice to carry.
        const notice =
          tool.riskClass === "none"
            ? []
            : [text(context.locale, TOOL_RISK_LINES[tool.riskClass]), phrase(context.locale, REPEAT_NOTICE)];
        return okResult([phrase(context.locale, RESULT_OF, id), ...lines, ...notice].join("\n"));
      }),
  };

  return [find, open, run];
}

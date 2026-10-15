/**
 * What the assistant can do to the APP itself: open a place, list what exists,
 * run the global search, read and forget the search history, rebuild the index.
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
 * **Where the names come from.** A kit module carries its name and one-line
 * description in its manifest (`ModuleManifest.copy`). The shell's compiled-in
 * modules keep theirs in the renderer's `strings`, which main cannot read, so
 * `BUILTIN_COPY` below holds the same words for them, in both locales. The
 * copy is the gallery's own, and a module in neither place is printed by its id
 * and its group alone.
 *
 * **Search results carry places.** A hit whose kind a page can reveal answers
 * with a citation whose `location` opens it (`citationFor`). The kinds that
 * cannot be opened by an id alone (documents, the study kinds, circuits) answer
 * with no citation: their reveal intents need more than an id.
 */

import type {
  AppLocation,
  AssistantLocale,
  AssistantText,
  Citation,
  ModuleManifest,
  Tool,
} from "@nexus/core";
import { foldSearchText, MAX_ID_LENGTH } from "@nexus/core";
import { rebuildSearchIndex, SearchHistoryStore } from "@nexus/db";
import type { SearchResult } from "../../../shared/ipc.js";
import { isModuleVisible, type ShellVisibility } from "../../../shared/moduleVisibility.js";
import { asArgs, asIdentifier, asOptionalCount, asOptionalText, asText } from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

/** What navigation needs of the app's registry — `ModuleRegistry` satisfies this, and a test can hand in a two-module stand-in. */
export interface ModuleLookup {
  all(): readonly ModuleManifest[];
  get(id: string): ModuleManifest | undefined;
}

/** The tools in this area need what the app owns: its registry, its global search, its databases, and the device's module visibility. */
export interface AppToolDeps {
  readonly modules: ModuleLookup;
  readonly search: (
    profileId: string,
    query: string,
    limit: number,
  ) => Promise<readonly SearchResult[]>;
  readonly profileDb: ProfileDb;
  /** The device's module visibility (ADR-101), read per call so a switch in Settings is seen by the next question. */
  readonly visibility: () => ShellVisibility;
}

type ModuleCopy = NonNullable<ModuleManifest["copy"]>;

/** How many results `app.search` answers with when the model names no cap. */
const DEFAULT_SEARCH_LIMIT = 8;

/** The most results one search may ask for — `MAX_SEARCH_LIMIT`'s order of magnitude, and far below the palette's own 200: a tool result is read by a model, not scrolled by a person. */
const MAX_SEARCH_LIMIT = 20;

/** A search query's longest accepted length, in characters — the palette's own input bound, which `app.search` and the history tools share. */
const MAX_QUERY_CHARS = 200;

/** A settings card key: a shell section id (`profile`, `notifications`) or a module's own id, both kebab-case. */
const SETTINGS_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A module id is a kebab slug — the shape `ModuleManifest.id` states and `asIdentifier` bounds. */
const MODULE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The compiled-in modules' name and one-line description, in both locales: the
 * same words as `strings.modules` and `strings.settings.moduleDescriptions` in the
 * renderer (`strings.sr.ts`, `strings.en.ts`). Main cannot read those strings, so
 * these are a copy, and `app.test.ts` fails the moment the two disagree.
 */
export const BUILTIN_COPY: Partial<Record<string, ModuleCopy>> = {
  dashboard: {
    name: { sr: "Kontrolna tabla", en: "Dashboard" },
    description: {
      sr: "Pregled dana na jednom mestu — obaveze, zadaci i dokumenta koja ističu.",
      en: "Your day at a glance — commitments, tasks and expiring documents.",
    },
  },
  tasks: {
    name: { sr: "Zadaci", en: "Tasks" },
    description: {
      sr: "Zadaci sa listom i tablom, prioritetima i rokovima.",
      en: "Tasks with list and board views, priorities and deadlines.",
    },
  },
  calendar: {
    name: { sr: "Kalendar", en: "Calendar" },
    description: {
      sr: "Događaji, agenda i praćenje isteka dokumenata.",
      en: "Events, an agenda and document expiry tracking.",
    },
  },
  settings: {
    name: { sr: "Podešavanja", en: "Settings" },
    description: {
      sr: "Profil, izgled, moduli i obaveštenja.",
      en: "Profile, appearance, modules and notifications.",
    },
  },
  notes: {
    name: { sr: "Beleške", en: "Notes" },
    description: {
      sr: "Beleške sa blok-editorom — markdown prečice i „/“ meni za formatiranje.",
      en: "Notes with a block editor — Markdown shortcuts and a “/” menu for formatting.",
    },
  },
  study: {
    name: { sr: "Učenje", en: "Study" },
    description: {
      sr: "Predmeti, ispiti, kartice za učenje i planovi pripreme za ispite.",
      en: "Subjects, exams, study cards and exam preparation plans.",
    },
  },
  priv: {
    name: { sr: "Privatno", en: "Private" },
    description: {
      sr: "Šifrovane privatne beleške — otključavaju se posebno i ne pojavljuju se u pretrazi.",
      en: "Encrypted private notes — unlocked separately and never shown in search.",
    },
  },
  files: {
    name: { sr: "Datoteke", en: "Files" },
    description: {
      sr: "Sve datoteke priložene uz beleške, zadatke i predmete, na jednom mestu.",
      en: "Every file attached to notes, tasks and subjects, in one place.",
    },
  },
  finance: {
    name: { sr: "Finansije", en: "Finance" },
    description: {
      sr: "Računi, transakcije i prenosi — stanje se računa iz onoga što upišeš.",
      en: "Accounts, transactions and transfers — the balance is worked out from what you enter.",
    },
  },
  habits: {
    name: { sr: "Navike", en: "Habits" },
    description: {
      sr: "Dnevne i nedeljne navike — niz, istorija i ono što se danas očekuje.",
      en: "Daily and weekly habits — streak, history and what is expected today.",
    },
  },
  focus: {
    name: { sr: "Fokus", en: "Focus" },
    description: {
      sr: "Pomodoro tajmer i istorija fokusa — isti tajmer koji „Učenje“ koristi.",
      en: "A Pomodoro timer and focus history — the same timer “Study” uses.",
    },
  },
  fitness: {
    name: { sr: "Fitnes", en: "Fitness" },
    description: {
      sr: "Ishrana i trening — obroci i dnevni ciljevi, dnevnik treninga sa rutinama i katalogom vežbi.",
      en: "Nutrition and training — meals and daily targets, a training log with routines and an exercise catalogue.",
    },
  },
  tools: {
    name: { sr: "Alatke", en: "Tools" },
    description: {
      sr: "Pretvarači jedinica i svakodnevni računi — procenat, PDV, kredit i cena po jedinici.",
      en: "Unit converters and everyday sums — percentage, VAT, loans and unit price.",
    },
  },
  canvas: {
    name: { sr: "Tabla", en: "Board" },
    description: {
      sr: "Beskonačna tabla za crtanje, dijagrame i skice — sa karticama koje vode na druge module.",
      en: "An endless board for drawing, diagrams and sketches — with cards that lead to other modules.",
    },
  },
  electronics: {
    name: { sr: "Elektronika", en: "Electronics" },
    description: {
      sr: "Radna površina za Arduino i Raspberry — postavi ploče i senzore iz kataloga i poveži ih žicama.",
      en: "A workbench for Arduino and Raspberry — place boards and sensors from the catalogue and wire them up.",
    },
  },
  pro: {
    name: { sr: "Stručne alatke", en: "Professional tools" },
    description: {
      sr: "Alatke po strukama — uključuješ pakete koji ti trebaju, a fioka pokazuje samo njih.",
      en: "Tools by trade — turn on the packs you need, and the drawer shows only those.",
    },
  },
};

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

/** The tag a module the device hides carries in `app.modules`, and the sentence `app.open` adds when it opens one. */
const HIDDEN_TAG: AssistantText = {
  sr: "skriven na ovom uređaju",
  en: "hidden on this device",
};

const HIDDEN_OPENED: AssistantText = {
  sr: "Na ovom uređaju modul je sakriven u meniju modula.",
  en: "On this device this module is hidden from the module menu.",
};

const OPEN_FAILED_UNKNOWN: AssistantPhrase<[id: string, known: string]> = {
  sr: (id, known) => `Nepoznat modul „${id}“. Poznati moduli: ${known}.`,
  en: (id, known) => `Unknown module “${id}”. Known modules: ${known}.`,
};

const OPENED: AssistantPhrase<[id: string]> = {
  sr: (id) => `Otvoren modul „${id}“.`,
  en: (id) => `Opened module “${id}”.`,
};

const HISTORY_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Zapamćene pretrage (${count}), najnovija prva:`,
  en: (count) => `Remembered searches (${count}), newest first:`,
};

const HISTORY_EMPTY: AssistantText = {
  sr: "Nema zapamćenih pretraga.",
  en: "No remembered searches.",
};

const FORGET_SUMMARY: AssistantPhrase<[query: string]> = {
  sr: (query) => `Zaboraviću pretragu „${query}“.`,
  en: (query) => `I will forget the search “${query}”.`,
};

const FORGOTTEN: AssistantPhrase<[query: string]> = {
  sr: (query) => `Pretraga „${query}“ je zaboravljena.`,
  en: (query) => `The search “${query}” was forgotten.`,
};

const FORGET_UNKNOWN: AssistantPhrase<[query: string]> = {
  sr: (query) => `Pretraga „${query}“ nije u istoriji.`,
  en: (query) => `The search “${query}” is not in the history.`,
};

const FORGET_AMBIGUOUS: AssistantPhrase<[query: string, matches: string]> = {
  sr: (query, matches) => `Više pretraga liči na „${query}“: ${matches}. Navedi tačnu.`,
  en: (query, matches) => `More than one search matches “${query}”: ${matches}. Name the exact one.`,
};

const REBUILD_SUMMARY: AssistantText = {
  sr: "Obnoviću indeks pretrage za celu aplikaciju.",
  en: "I will rebuild the search index for the whole app.",
};

const REBUILT: AssistantText = {
  sr: "Indeks pretrage je obnovljen.",
  en: "The search index was rebuilt.",
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
        const opened = phrase(context.locale, OPENED, moduleId);
        const hidden = !isModuleVisible(manifest, deps.visibility());
        return okResult(hidden ? `${opened} ${text(context.locale, HIDDEN_OPENED)}` : opened, {
          navigateTo: locationOf(moduleId, item, settings),
        });
      }),
  };

  const modules: Tool = {
    name: "app.modules",
    description: {
      sr: "Izlistava module koje Nexus ima, čemu svaki služi i koji su sakriveni na ovom uređaju. Koristi ga pre nego što predložiš gde se nešto nalazi u aplikaciji, i pre app.open kada nisi siguran koji je id modula.",
      en: "Lists the modules Nexus has, what each one is for, and which are hidden on this device. Use it before telling the user where something lives in the app, and before app.open when you are unsure of a module id.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const all = deps.modules.all();
        const visibility = deps.visibility();
        const lines = all.map((manifest) =>
          describeModule(context.locale, manifest, isModuleVisible(manifest, visibility)),
        );
        return okResult(
          [phrase(context.locale, MODULES_HEADING, all.length), ...lines].join("\n"),
        );
      }),
  };

  const search: Tool = {
    name: "app.search",
    description: {
      sr: "Pokreće globalnu pretragu aplikacije preko zadataka, događaja, beleški, predmeta, špilova i dokumenata. Podržava filtere kao #oznaka i rok:danas. Koristi je kao prvi korak kada korisnik pita gde se nešto nalazi ili traži nešto što je već zapisano.",
      en: "Runs the app's global search across tasks, events, notes, subjects, decks and documents. It takes the same filters as the search box, such as #tag or due:today. Use it as the first step when the user asks where something is or looks for something already recorded.",
    },
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: MAX_QUERY_CHARS, description: "What to search for." },
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
        const query = asText(args.query, "query", MAX_QUERY_CHARS);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_SEARCH_LIMIT) ?? DEFAULT_SEARCH_LIMIT;
        const hits = await deps.search(context.profileId, query, limit);
        if (hits.length === 0) {
          return okResult(phrase(context.locale, SEARCH_EMPTY, query));
        }
        const citations = hits.flatMap((hit) => {
          const citation = citationFor(hit);
          return citation === null ? [] : [citation];
        });
        return okResult(
          [
            phrase(context.locale, SEARCH_RESULTS, hits.length, query),
            ...hits.map((hit) => searchLine(hit)),
          ].join("\n"),
          { citations },
        );
      }),
  };

  const history: Tool = {
    name: "search.history",
    description: {
      sr: "Izlistava pretrage koje je korisnik nedavno pokretao u pretrazi aplikacije. Koristi ga kada korisnik pita šta je tražio ili traži da ponovi pretragu.",
      en: "Lists the searches the user ran recently in the app's search. Use it when the user asks what they searched for, or wants to run a search again.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const entries = searchHistory(deps.profileDb, context.profileId);
        if (entries.length === 0) return okResult(text(context.locale, HISTORY_EMPTY));
        return okResult(
          [
            phrase(context.locale, HISTORY_HEADING, entries.length),
            ...entries.map((entry) => `- ${entry.query}`),
          ].join("\n"),
        );
      }),
  };

  const forget: Tool = {
    name: "search.forget",
    description: {
      sr: "Briše jednu pretragu iz istorije pretrage. Koristi ga kada korisnik traži da se neka pretraga zaboravi. Ne briše celu istoriju.",
      en: "Removes one search from the search history. Use it when the user asks to forget a particular search. It never clears the whole history.",
    },
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: MAX_QUERY_CHARS,
          description: "The remembered search, as search.history lists it.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const query = asText(asArgs(rawArgs).query, "query", MAX_QUERY_CHARS);
        const folded = foldSearchText(query);
        const [only, ...others] = searchHistory(deps.profileDb, context.profileId).filter(
          (entry) => foldSearchText(entry.query) === folded,
        );
        if (only === undefined) throw new Error(phrase(context.locale, FORGET_UNKNOWN, query));
        if (others.length > 0) {
          const names = [only, ...others].map((entry) => `„${entry.query}“`).join(", ");
          throw new Error(phrase(context.locale, FORGET_AMBIGUOUS, query, names));
        }

        const declined = await confirmOrDecline(
          context,
          "search.forget",
          "write",
          phrase(context.locale, FORGET_SUMMARY, only.query),
        );
        if (declined !== null) return declined;

        deps.profileDb(context.profileId, (db, profileId) =>
          new SearchHistoryStore(db, profileId).remove(only.query),
        );
        return okResult(phrase(context.locale, FORGOTTEN, only.query));
      }),
  };

  const rebuild: Tool = {
    name: "search.rebuild",
    description: {
      sr: "Ponovo gradi indeks pretrage za celu aplikaciju. Koristi ga samo kada korisnik kaže da pretraga ne nalazi ono što postoji ili da je pretraga pokvarena.",
      en: "Rebuilds the search index for the whole app. Use it only when the user says search misses things that exist, or that search is broken.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "write",
    run: (_rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const declined = await confirmOrDecline(
          context,
          "search.rebuild",
          "write",
          text(context.locale, REBUILD_SUMMARY),
        );
        if (declined !== null) return declined;

        deps.profileDb(context.profileId, (db) => rebuildSearchIndex(db));
        return okResult(text(context.locale, REBUILT));
      }),
  };

  return [open, modules, search, history, forget, rebuild];
}

/** A profile's remembered queries, newest first, read through the profile's own handle. */
function searchHistory(profileDb: ProfileDb, profileId: string) {
  return profileDb(profileId, (db, id) => new SearchHistoryStore(db, id).list());
}

/**
 * One module's row. Every module has a name and a description in the active
 * locale (its manifest's `copy`, or `BUILTIN_COPY` for a compiled-in one); a
 * module the device hides says so in its tag, so the model does not offer it as
 * a place in the sidebar.
 */
function describeModule(locale: AssistantLocale, manifest: ModuleManifest, visible: boolean): string {
  const copy: ModuleCopy | undefined = manifest.copy ?? BUILTIN_COPY[manifest.id];
  const tags = [manifest.group, ...(visible ? [] : [text(locale, HIDDEN_TAG)])].join(", ");
  const head = `- ${manifest.id} (${tags})`;
  if (copy === undefined) return head;
  return `${head}: ${copy.name[locale]} — ${copy.description[locale]}`;
}

/** One search hit as a line the model can quote: what it is, its title, and the snippet the index matched in. */
function searchLine(hit: SearchResult): string {
  const snippet = hit.snippet.trim().replace(/\s+/g, " ");
  const id = hit.entityId;
  return snippet.length === 0
    ? `- ${hit.kind} ${id}: ${hit.title}`
    : `- ${hit.kind} ${id}: ${hit.title} — ${snippet}`;
}

/**
 * The citation a hit answers with, when the app has a place that reveals it.
 * The places are the ones the palette opens (`App.tsx`'s search dispatch) and
 * that the shell's `compiledInReveal` or a kit page can act on by id alone: a
 * task, an event, a note, and an attachment through its note.
 */
function citationFor(hit: SearchResult): Citation | null {
  const at = (kind: Citation["kind"], location: AppLocation | null): Citation | null =>
    location === null ? null : { kind, id: hit.entityId, title: hit.title, location };
  switch (hit.kind) {
    case "task":
      return at("task", { module: "tasks", item: hit.entityId });
    case "event":
      return at("event", { module: "calendar", item: hit.entityId });
    case "note":
      return at("note", { module: "notes", item: hit.entityId });
    case "attachment":
      return at("file", hit.parentId === null ? null : { module: "notes", item: hit.parentId });
    default:
      return null;
  }
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

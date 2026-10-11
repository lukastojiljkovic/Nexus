/**
 * One catalogue of every tool the build ships, and how you find one in it.
 *
 * **DERIVED, never a second list.** Every entry here is a `ToolRegistration`
 * read out of `manifest.tools` across the registry, with its copy resolved from
 * the two locale tables — so a tool added to `shared/modules.ts` is in the
 * finder the moment it exists, and `toolCatalogue.test.ts` fails if the two ever
 * stop agreeing. A hand-kept catalogue of three hundred entries is a list that
 * is wrong the first time somebody adds a tool and does not know this file is
 * there.
 *
 * **Both locales at once, and that is the point rather than a nicety.** `strings`
 * serves ONE language at a time and rewrites its leaves in place on a switch;
 * a search built on it would only ever match the language currently on screen.
 * This reads `LOCALES` — the static pair of whole tables — so a Serbian user
 * typing „invoice“ and an English user typing „faktura“ both find the VAT tool,
 * which is the honest behaviour for an app that ships both languages to the same
 * person on the same machine.
 *
 * **What the search matches.** Name, description, profession and the declared
 * keywords, folded through `foldSearchText` — the folding the rest of the app
 * already shares, which is what makes „racun“ find „račun“ and „čas“ find „cas“,
 * in either direction, because both sides are folded before they meet. A tool the
 * build gives no description (the eleven everyday ones) simply has no description
 * bucket; its name, its keywords and its drawer are what it is findable by.
 */

import {
  foldSearchText,
  toolDrawer,
  type ModuleRegistry,
  type ToolCategory,
  type ToolDrawer,
  type ToolPack,
  type ToolRegistration,
  type ToolRiskClass,
  type ToolTaskGroup,
} from "@nexus/core";

import { LOCALES, type Locale, type Strings } from "./strings.js";

/**
 * Which module's page hosts each drawer.
 *
 * The drawer decides the PAGE rather than the declaring module, because that is
 * what `ToolsPage` is: one host that collects `manifest.tools` across the whole
 * registry and draws the tools whose `toolDrawer` matches the side it was
 * mounted with. The finder needs the same answer — a result in the other drawer
 * has to open there — so it is stated once, here, and `ToolsPage` reads it rather
 * than keeping its own copy.
 */
export const DRAWER_MODULES = {
  utilities: "tools",
  professional: "pro",
} as const satisfies Record<ToolDrawer, string>;

/** One string per shipped locale — a name, a description or a profession line. */
export type LocaleText = Readonly<Record<Locale, string>>;

/** The three fields a query is matched against, pre-folded once at build time rather than on every keystroke. */
interface FoldedTiers {
  readonly name: string;
  readonly description: string;
  readonly profession: string;
  readonly keywords: readonly string[];
}

export interface ToolCatalogueEntry {
  /** The `ToolRegistration.id` — the key both surfaces and the stored lists use. */
  readonly id: string;
  /**
   * The module whose manifest declares it.
   *
   * Carried because a tool from a switched-OFF module is not offered anywhere —
   * the drawer is a host, not an exemption — so the finder has to be able to ask
   * the same question the rail asks before it can answer it.
   */
  readonly moduleId: string;
  /** Which drawer draws it, and therefore which page opens it (`DRAWER_MODULES`). */
  readonly drawer: ToolDrawer;
  /** The toolkits that list it; empty for an everyday tool. */
  readonly packs: readonly ToolPack[];
  /** What the tool DOES — the rail's heading. */
  readonly category: ToolCategory;
  /** What you NEED — the finder's filters (`TOOL_TASK_GROUPS`). */
  readonly taskGroups: readonly ToolTaskGroup[];
  /** What could go wrong with the answer — the host draws the notice, never the surface. */
  readonly riskClass: ToolRiskClass;
  /** Where a `published`-tier constant came from, as the strings KEY the page resolves — absent for the ordinary case. */
  readonly sourceKey?: string;
  /** Extra words the search matches, already folded by the registration. */
  readonly keywords: readonly string[];
  readonly name: LocaleText;
  /** Absent when the registration declares no `blurbKey` — the everyday tools. */
  readonly description?: LocaleText;
  /**
   * Who the tool is for, short enough to draw on a row: the toolkits' names, or
   * the everyday drawer's own name for a tool that belongs to no toolkit.
   */
  readonly profession: LocaleText;
  /** The folded form of the three tiers above, per locale. */
  readonly folded: Readonly<Record<Locale, FoldedTiers>>;
}

/**
 * The locales, in the order the tiers are tried.
 *
 * Derived from `LOCALES` rather than written out, so a third language becomes
 * searchable by being added to that record and nowhere else.
 */
const LOCALE_LIST: readonly Locale[] = Object.keys(LOCALES) as Locale[];

/** A dotted `titleKey` path resolved against one locale table — the lookup `ToolsPage` already does against the live table. */
function readKey(table: unknown, path: string): string | undefined {
  const resolved = path.split(".").reduce<unknown>(
    (node, part) =>
      typeof node === "object" && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined,
    table,
  );
  return typeof resolved === "string" ? resolved : undefined;
}

/**
 * The words that name a tool's trade, in the two sizes the catalogue needs: the
 * label a row DRAWS, and the wider text a query is matched against.
 *
 * A pack's Serbian name is the subject („Gradnja i projektovanje“) and its
 * `who` line is the vocabulary a person recognises themselves by
 * („krojači, stolari, bravari, tapetari, obućari“). Putting both into the search
 * is what makes „stolar“ answer with the joinery tools before anybody knows
 * which pack owns them — the trade is a way IN, exactly as the name of the
 * thing is.
 *
 * The label is the names alone, because the `who` line is a sentence about a
 * trade and a row is not: „arhitekte, građevinski inženjeri, geodeti, izvođači“
 * would wrap three times under one tool.
 *
 * An everyday tool has no toolkit, so both are the drawer's own name — „Alatke“
 * — which is true, and is what somebody typing „alatke“ should get.
 */
function professionLabel(table: Strings, packs: readonly ToolPack[]): string {
  if (packs.length === 0) return table.tools.title;
  return packs.map((pack) => table.pro.packs[pack].name).join(" · ");
}

function professionSearchText(table: Strings, packs: readonly ToolPack[]): string {
  if (packs.length === 0) return table.tools.title;
  return packs
    .map((pack) => `${table.pro.packs[pack].name} ${table.pro.packs[pack].who}`)
    .join(" · ");
}

/** The same string in both tables, keyed by locale. */
function perLocale(resolve: (table: Strings, locale: Locale) => string): LocaleText {
  return perLocaleRecord((locale) => resolve(LOCALES[locale], locale));
}

/**
 * A `Record<Locale, T>` filled from the live locale list.
 *
 * `Object.fromEntries` would be the shorter spelling and produces
 * `{ [k: string]: T }`, which cannot be narrowed back to the record a known
 * locale set needs without a cast at every call site. The cast lives here, once,
 * on an EMPTY object, and the loop is what makes the record complete.
 */
function perLocaleRecord<T>(build: (locale: Locale) => T): Record<Locale, T> {
  const record = {} as Record<Locale, T>;
  for (const locale of LOCALE_LIST) record[locale] = build(locale);
  return record;
}

/** The words of a folded string, which is what „starts a word“ is measured against. */
function tokensOf(folded: string): string[] {
  return folded.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 0);
}

/** One catalogue entry, built from one registration and the module that declared it. */
function catalogueEntry(moduleId: string, tool: ToolRegistration): ToolCatalogueEntry {
  const packs = tool.packs ?? [];
  const name = perLocale((table) => readKey(table, tool.titleKey) ?? tool.id);
  const profession = perLocale((table) => professionLabel(table, packs));
  const professionWords = perLocale((table) => professionSearchText(table, packs));
  const description =
    tool.blurbKey === undefined
      ? undefined
      : perLocale((table) => readKey(table, tool.blurbKey ?? "") ?? "");

  const folded = perLocaleRecord<FoldedTiers>((locale) => ({
    name: foldSearchText(name[locale]),
    description: foldSearchText(description?.[locale] ?? ""),
    profession: foldSearchText(professionWords[locale]),
    keywords: (tool.keywords ?? []).map((keyword) => foldSearchText(keyword)),
  }));

  return {
    id: tool.id,
    moduleId,
    drawer: toolDrawer(tool),
    packs,
    category: tool.category,
    taskGroups: tool.taskGroups,
    riskClass: tool.riskClass,
    ...(tool.sourceKey === undefined ? {} : { sourceKey: tool.sourceKey }),
    keywords: tool.keywords ?? [],
    name,
    ...(description === undefined ? {} : { description }),
    profession,
    folded,
  };
}

/**
 * Every tool the registry publishes, in declaration order.
 *
 * `ToolsPage` is built the same way, one level down, so the finder and the rail
 * can never disagree about which tools exist — and the completeness test walks
 * the registry itself rather than trusting this function's own output.
 */
export function buildToolCatalogue(registry: ModuleRegistry): readonly ToolCatalogueEntry[] {
  return registry
    .all()
    .flatMap((manifest) => (manifest.tools ?? []).map((tool) => catalogueEntry(manifest.id, tool)));
}

/**
 * How well a query fits a tool, strongest first.
 *
 * **The ladder is the whole ranking, and it has four rungs.** A name PREFIX is
 * the strongest evidence a typed word can be: somebody typing „kv“ at a list of
 * three hundred tools is spelling the name of the thing they want. A word of the
 * name is next — „masa armature“ against „Masa armature“ is a phrase, not a
 * prefix. A keyword, or the tool's profession, is the third: these are the words
 * that answer „what is this called“, and a profession word is one of them, which
 * is why it rides THIS rung rather than earning a fifth (a trade name is exactly
 * as strong evidence as a keyword, and the ladder the brief fixes has four
 * rungs). The description is last, because a sentence about a tool mentions
 * everything the tool is near and nothing it is.
 */
export const TOOL_MATCH_RANKS = ["name-prefix", "name-word", "keyword", "description"] as const;

export type ToolMatchRank = (typeof TOOL_MATCH_RANKS)[number];

/**
 * How well a query fits a tool: which rung it landed on, and WHOSE words did the
 * landing.
 *
 * `localeRank` is 0 when the hit came from the language on screen and 1 when it
 * came from the other one, and it exists because both tables are always
 * searched. Without it a Serbian user typing „čas“ for their timetable met
 * „Cascading discounts“ first — an English word that begins with the same three
 * letters — because a name-prefix in the language they are NOT reading beat a
 * whole-word match in the one they are. The other locale's words still match,
 * and still rank by their own rung; they merely lose a tie to the reader's own
 * language, which is the only sensible way to break one.
 */
export interface ToolMatchScore {
  readonly rank: ToolMatchRank;
  /** 0 for the locale on screen, 1 for the other. See the interface's comment. */
  readonly localeRank: number;
}

function betterScore(current: ToolMatchScore | null, candidate: ToolMatchScore): ToolMatchScore {
  if (current === null) return candidate;
  const currentRank = TOOL_MATCH_RANKS.indexOf(current.rank);
  const candidateRank = TOOL_MATCH_RANKS.indexOf(candidate.rank);
  if (candidateRank !== currentRank) return candidateRank < currentRank ? candidate : current;
  return candidate.localeRank < current.localeRank ? candidate : current;
}

/**
 * The strongest rung one folded term lands on for this tool, or null for no
 * match at all.
 *
 * **A NAME match is a match at a word's start, never one anywhere inside it**,
 * and that line is the difference between a search and a rummage. Tested with a
 * plain `includes`, the name „Procenat“ contains „ocena“ from its third letter
 * on — so a teacher typing „ocena“ (a grade) was answered by a percentage
 * calculator, and ranked exactly as strongly as the four tools actually about
 * grades. Substring matching stays where it belongs: inside a KEYWORD (the
 * keyword list is full of inflected forms, and „armature“ must answer
 * „armatur“), inside a profession line, and inside a description.
 *
 * Every tier is tried in EVERY locale before the answer is taken, which is what
 * makes the search language-agnostic: a Serbian user typing „loan“ reaches the
 * tool named „Kredit“ because the English table carries the word, and an English
 * user typing „faktura“ reaches the same tool through the Serbian one.
 */
function rankTerm(entry: ToolCatalogueEntry, term: string, locale: Locale): ToolMatchScore | null {
  let best: ToolMatchScore | null = null;
  for (const candidate of LOCALE_LIST) {
    const tiers = entry.folded[candidate];
    const localeRank = candidate === locale ? 0 : 1;
    if (tiers.name.startsWith(term)) {
      best = betterScore(best, { rank: "name-prefix", localeRank });
    } else if (tokensOf(tiers.name).some((token) => token.startsWith(term))) {
      best = betterScore(best, { rank: "name-word", localeRank });
    }
    if (
      tiers.profession.includes(term) ||
      tiers.keywords.some((keyword) => keyword.includes(term))
    ) {
      best = betterScore(best, { rank: "keyword", localeRank });
    }
    if (tiers.description.includes(term)) {
      best = betterScore(best, { rank: "description", localeRank });
    }
  }
  return best;
}

/**
 * The rung a whole query lands on: EVERY term must match, and the entry is
 * ranked by its STRONGEST term.
 *
 * Conjunctive terms is `matchesToolQuery`'s rule one drawer over — a second word
 * narrows instead of widening, so „metar porez“ finds nothing rather than
 * everything either word touched. Ranking by the strongest term rather than the
 * weakest is what keeps the ladder readable: „racun pdv“ puts the tool NAMED PDV
 * above a tool that merely mentions a račun somewhere, which is the guess the
 * user was making.
 */
export function rankToolMatch(
  entry: ToolCatalogueEntry,
  query: string,
  locale: Locale,
): ToolMatchScore | null {
  const terms = foldSearchText(query.trim())
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return null;
  let best: ToolMatchScore | null = null;
  for (const term of terms) {
    const score = rankTerm(entry, term, locale);
    if (score === null) return null;
    best = betterScore(best, score);
  }
  return best;
}

/** Whether a tool is in any of the chosen task groups. No groups chosen means no filter. */
export function matchesTaskFilter(
  entry: ToolCatalogueEntry,
  groups: readonly ToolTaskGroup[],
): boolean {
  return groups.length === 0 || entry.taskGroups.some((group) => groups.includes(group));
}

/**
 * Every tool that answers a query, best first.
 *
 * Ties keep DECLARATION order, and the sort has to be stable for that to hold —
 * `Array.prototype.sort` is, since ES2019, on every engine this app runs on. The
 * rule is the rail's: a list that reordered itself on every keystroke would move
 * the row the user was reaching for.
 */
export function searchToolCatalogue(
  entries: readonly ToolCatalogueEntry[],
  query: string,
  groups: readonly ToolTaskGroup[],
  locale: Locale,
): readonly ToolCatalogueEntry[] {
  // A blank query is not a filter (`matchesToolQuery`'s rule): everything the
  // group filter admits comes back, in declaration order.
  const filtering = foldSearchText(query.trim()).length > 0;
  const UNRANKED = TOOL_MATCH_RANKS.length;
  const ranked: { entry: ToolCatalogueEntry; rank: number; localeRank: number }[] = [];
  for (const entry of entries) {
    if (!matchesTaskFilter(entry, groups)) continue;
    const score = rankToolMatch(entry, query, locale);
    if (score === null && filtering) continue;
    ranked.push({
      entry,
      rank: score === null ? UNRANKED : TOOL_MATCH_RANKS.indexOf(score.rank),
      localeRank: score?.localeRank ?? 0,
    });
  }
  return ranked
    .sort((left, right) => left.rank - right.rank || left.localeRank - right.localeRank)
    .map((row) => row.entry);
}

/**
 * The CALCULATOR module: what was already worked out.
 *
 * **The store is the app's own.** `CalculatorStore.listHistory()` (migration
 * 079) answers this profile's history newest first, with each row carrying the
 * expression as it was typed, the result as the engine displayed it, and the
 * flag that protects a row from the cap. All three are printed here; nothing is
 * re-evaluated.
 *
 * **Why nothing is computed.** The engine is the module's, it runs in a Web
 * Worker, and it is the only place in this application an expression is
 * evaluated. A tool that evaluated one itself would be a second answer to the
 * same question — and the first place two answers like that disagree is a
 * rounding difference nobody notices until it matters.
 */

import { CalculatorStore, type CalcHistoryEntry } from "@nexus/db";
import { foldSearchText, type AssistantLocale, type Tool } from "@nexus/core";
import { asArgs, asOptionalCount, asOptionalText } from "./args.js";
import {
  assertLive,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface CalculatorToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
}

/** How many rows one read answers with when the model names no cap, and the ceiling it may ask for. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
/** The longest search a person types into the history's own filter. */
const MAX_QUERY_CHARS = 120;

/** The heading the module's own dashboard card and history section carry. */
const HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Poslednji rezultati (${count}):`,
  en: (count) => `Recent results (${count}):`,
};

const EMPTY: { readonly sr: string; readonly en: string } = {
  sr: "Istorija kalkulatora je prazna.",
  en: "The calculator's history is empty.",
};

const NONE: AssistantPhrase<[query: string]> = {
  sr: (query) => `Nijedan zapis ne odgovara pretrazi „${query}“.`,
  en: (query) => `No entry matches the search “${query}”.`,
};

const MORE: AssistantPhrase<[count: number]> = {
  sr: (count) => `…i još ${count}.`,
  en: (count) => `…and ${count} more.`,
};

const PINNED: { readonly sr: string; readonly en: string } = {
  sr: "sačuvano",
  en: "pinned",
};

export function calculatorTools(deps: CalculatorToolDeps): readonly Tool[] {
  const history: Tool = {
    name: "calculator.history",
    description: {
      sr: "Čita istoriju kalkulatora: izraze koje je korisnik uneo i rezultate koje je kalkulator vratio. Koristi ga kada korisnik pita šta je izračunao ili traži prethodni rezultat.",
      en: "Reads the calculator's history: the expressions the user typed and the results the calculator gave back. Use it when the user asks what they calculated or looks for an earlier result.",
    },
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: MAX_QUERY_CHARS,
          description: "A word or number from the expression. Accents do not matter.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many entries to list, newest first. Defaults to ${String(DEFAULT_LIMIT)}.`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asOptionalText(args.query, "query", MAX_QUERY_CHARS);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;

        const entries = deps.profileDb(context.profileId, (db, id) =>
          new CalculatorStore(db, id).listHistory(),
        );
        const matching = entries.filter((entry) => query === undefined || matches(entry, query));
        if (matching.length === 0) {
          return okResult(
            query === undefined ? text(context.locale, EMPTY) : phrase(context.locale, NONE, query),
          );
        }
        const shown = matching.slice(0, limit);
        const lines = [
          phrase(context.locale, HEADING, matching.length),
          ...shown.map((entry) => entryLine(context.locale, entry)),
        ];
        if (matching.length > shown.length) {
          lines.push(phrase(context.locale, MORE, matching.length - shown.length));
        }
        return okResult(lines.join("\n"));
      }),
  };

  return [history];
}

/** One entry: the expression as typed, the result as the engine printed it, and whether it is protected. */
function entryLine(locale: AssistantLocale, entry: CalcHistoryEntry): string {
  const pinned = entry.pinned ? `, ${text(locale, PINNED)}` : "";
  return `- ${entry.expression} = ${entry.result}${pinned}`;
}

/** The folded match the module's own filter uses, over both halves of a row. */
function matches(entry: CalcHistoryEntry, query: string): boolean {
  const needle = foldSearchText(query.trim());
  if (needle.length === 0) return false;
  return (
    foldSearchText(entry.expression).includes(needle) ||
    foldSearchText(entry.result).includes(needle)
  );
}

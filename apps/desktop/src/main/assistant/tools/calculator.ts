/**
 * The CALCULATOR module: what it works out, and what it keeps.
 *
 * **The engine is the module's own, and the assistant calls it.** `calculate`
 * runs an expression through `@nexus/core`'s engine with the parser, the
 * functions, the precision and the angle mode the page uses, and the variables
 * the user has defined. The page, the history and the assistant therefore read
 * one answer, and a rounding difference cannot appear in one of them only.
 * Small models get arithmetic wrong, so the tool is offered for any sum, not
 * only when the user opens the calculator.
 *
 * **The store is the app's own.** `CalculatorStore.listHistory()` (migration
 * 079) answers this profile's history newest first, with each row carrying the
 * expression as it was typed, the result as the engine displayed it, and the
 * flag that protects a row from the cap. `remember` writes a row through the
 * same `addEntry` the page's Enter key calls, after the user says yes.
 */

import { CalculatorStore, type CalcHistoryEntry } from "@nexus/db";
import {
  createCalculatorEngine,
  emptyCalculatorSession,
  foldSearchText,
  MAX_EXPRESSION_LENGTH,
  type AssistantLocale,
  type AssistantText,
  type CalculatorCode,
  type CalculatorFailure,
  type CalculatorOutcome,
  type Tool,
} from "@nexus/core";
import { asArgs, asOptionalCount, asOptionalText, asText } from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  failResult,
  guard,
  okResult,
  phrase,
  quote,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface CalculatorToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
  /** See `ToolDeps.now`. */
  readonly now: () => number;
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

const EMPTY: AssistantText = {
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

const PINNED: AssistantText = {
  sr: "sačuvano",
  en: "pinned",
};

const EXACT: AssistantPhrase<[value: string]> = {
  sr: (value) => `Tačna vrednost: ${value}`,
  en: (value) => `Exact value: ${value}`,
};

const SAVE_SUMMARY: AssistantPhrase<[expression: string, display: string]> = {
  sr: (expression, display) => `Sačuvati ${expression} = ${display} u istoriju kalkulatora?`,
  en: (expression, display) => `Save ${expression} = ${display} to the calculator's history?`,
};

const SAVED: AssistantPhrase<[expression: string, display: string]> = {
  sr: (expression, display) => `Sačuvano u istoriji kalkulatora: ${expression} = ${display}`,
  en: (expression, display) => `Saved to the calculator's history: ${expression} = ${display}`,
};

/** The refusals that name nothing: the engine's own sentences, as the page words them. */
const REFUSALS: Record<CalculatorCode, AssistantText> = {
  syntax: {
    sr: "Izraz nije ispravno napisan.",
    en: "The expression is not written correctly.",
  },
  "unknown-symbol": {
    sr: "Nepoznato ime u izrazu.",
    en: "An unknown name in the expression.",
  },
  "wrong-arguments": {
    sr: "Funkcija ne prima takve argumente, ili se izraz ne završava.",
    en: "A function is not given arguments it takes, or the expression does not finish.",
  },
  "division-by-zero": {
    sr: "Deljenje nulom nije dozvoljeno.",
    en: "Division by zero is not allowed.",
  },
  "unit-mismatch": {
    sr: "Jedinice se ne slažu.",
    en: "The units do not match.",
  },
  "too-large": {
    sr: "Izraz je prevelik za računanje.",
    en: "The expression is too large to compute.",
  },
  disabled: {
    sr: "Ta funkcija nije dozvoljena u kalkulatoru.",
    en: "That function is not allowed in the calculator.",
  },
};

/** The two refusals that can say which name they are about, when the engine knows it. */
const NAMED_REFUSALS: Record<"disabled" | "unknown-symbol", AssistantPhrase<[name: string]>> = {
  disabled: {
    sr: (name) => `Funkcija ${name} nije dozvoljena u kalkulatoru.`,
    en: (name) => `The function ${name} is not allowed in the calculator.`,
  },
  "unknown-symbol": {
    sr: (name) => `Nepoznato ime u izrazu: ${name}.`,
    en: (name) => `Unknown name in the expression: ${name}.`,
  },
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

  const calculate: Tool = {
    name: "calculator.calculate",
    description: {
      sr: "Računa izraz kalkulatorom modula. Koristi ga za SVAKU računicu, ne samo kada korisnik otvori kalkulator: zbir, razlomak, procenat, stepen, trigonometriju, jedinice.",
      en: "Evaluates an expression with the calculator's own engine. Use it for ANY arithmetic, not only when the user opens the calculator: sums, fractions, percentages, powers, trigonometry, units.",
    },
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          minLength: 1,
          maxLength: MAX_EXPRESSION_LENGTH,
          description: "The expression, with a decimal point, e.g. 2+2*2 or sin(30).",
        },
      },
      required: ["expression"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const expression = asText(asArgs(rawArgs).expression, "expression", MAX_EXPRESSION_LENGTH);
        const outcome = evaluate(deps, context.profileId, context.locale, expression);
        if (!outcome.ok) return failResult(context.locale, refusalOf(context.locale, outcome));

        const lines = [`${expression} = ${outcome.display}`];
        if (outcome.value !== outcome.display) {
          lines.push(phrase(context.locale, EXACT, outcome.value));
        }
        return okResult(lines.join("\n"));
      }),
  };

  const remember: Tool = {
    name: "calculator.remember",
    description: {
      sr: "Čuva izraz i rezultat u istoriju kalkulatora. Koristi ga kada korisnik traži da se računica sačuva ili zapamti.",
      en: "Saves an expression and its result to the calculator's history. Use it when the user asks to keep or remember a calculation.",
    },
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          minLength: 1,
          maxLength: MAX_EXPRESSION_LENGTH,
          description: "The expression to save, with a decimal point, e.g. 2+2*2.",
        },
      },
      required: ["expression"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const expression = asText(asArgs(rawArgs).expression, "expression", MAX_EXPRESSION_LENGTH);
        const outcome = evaluate(deps, context.profileId, context.locale, expression);
        if (!outcome.ok) return failResult(context.locale, refusalOf(context.locale, outcome));

        const declined = await confirmOrDecline(
          context,
          "calculator.remember",
          "write",
          phrase(context.locale, SAVE_SUMMARY, quote(context.locale, expression), outcome.display),
        );
        if (declined !== null) return declined;

        const now = new Date(deps.now()).toISOString();
        deps.profileDb(context.profileId, (db, id) =>
          new CalculatorStore(db, id).addEntry(
            { expression, result: outcome.display, value: outcome.value },
            now,
          ),
        );
        return okResult(phrase(context.locale, SAVED, expression, outcome.display), {
          navigateTo: { module: "calculator" },
        });
      }),
  };

  return [history, calculate, remember];
}

/**
 * One evaluation, with the profile's own settings and variables. A saved session
 * that cannot be read is treated as empty, which is the engine's own recovery:
 * one corrupt row must not refuse every sum the assistant is asked for.
 */
function evaluate(
  deps: CalculatorToolDeps,
  profileId: string,
  locale: AssistantLocale,
  expression: string,
): CalculatorOutcome {
  return deps.profileDb(profileId, (db, id) => {
    const store = new CalculatorStore(db, id);
    const settings = store.settings();
    const session = (() => {
      try {
        return store.getSession();
      } catch {
        return emptyCalculatorSession();
      }
    })();
    return createCalculatorEngine(settings.precision).evaluate(expression, {
      session,
      angleMode: settings.angleMode,
      format: { locale },
    });
  });
}

/** The sentence for a refusal: named when the engine says which name it is about. */
function refusalOf(locale: AssistantLocale, failure: CalculatorFailure): string {
  const name = failure.symbol;
  if (name !== undefined && (failure.code === "disabled" || failure.code === "unknown-symbol")) {
    return phrase(locale, NAMED_REFUSALS[failure.code], quote(locale, name));
  }
  return text(locale, REFUSALS[failure.code]);
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

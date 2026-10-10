/**
 * The CULTURE module: what is on the programme, and putting a plan on it.
 *
 * **A plan is what has not happened yet.** The module's own page says it: a plan
 * is a thing still ahead, and once its date passes it either becomes a visit or
 * is dropped. That is why the read here answers with the two lists the page's
 * Programme tab draws — what is ahead, in the order it happens, and the past
 * plans the user has not answered yet, most recent first — and never with the
 * visits, which are a different tab and different data.
 *
 * **The store is the app's own.** `CultureStore` (migration 073) is what the
 * page calls, and `createPlan` is the call its own „Novi plan" makes, so a plan
 * the assistant writes is a plan the page draws with no second writer of
 * `culture_plans` anywhere behind this file.
 *
 * **The kind is the module's own closed list.** `VISIT_KINDS` from
 * `@nexus/core` is what the schema's enum offers and what the reader accepts, so
 * a model cannot invent a kind the page has no word for.
 */

import {
  CultureStore,
  MAX_CULTURE_CITY_LENGTH,
  MAX_CULTURE_NOTES_LENGTH,
  MAX_CULTURE_TITLE_LENGTH,
  MAX_CULTURE_VENUE_LENGTH,
  type CulturePlan,
} from "@nexus/db";
import {
  VISIT_KINDS,
  type AssistantLocale,
  type Tool,
  type VisitKind,
} from "@nexus/core";
import {
  asArgs,
  asDay,
  asEnum,
  asOptionalCount,
  asOptionalEnum,
  asOptionalText,
  asText,
} from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  formatDayInSentence,
  guard,
  localDay,
  okResult,
  phrase,
  quote,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface CultureToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
  /** Main's wall clock: what "ahead" and "past" are measured against, and the stamp a plan carries. */
  readonly now: () => number;
}

/** How many plans one read answers with when the model names no cap, and the ceiling it may ask for. */
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 40;
/** The longest link the store keeps, and the only two schemes it accepts. */
const MAX_LINK_CHARS = 2_000;
const HTTP_LINK = /^https?:\/\/\S+$/;

/** The ten kinds of outing as the page names them. */
const KIND_WORDS: Readonly<Record<VisitKind, { readonly sr: string; readonly en: string }>> = {
  museum: { sr: "Muzej", en: "Museum" },
  gallery: { sr: "Galerija", en: "Gallery" },
  exhibition: { sr: "Izložba", en: "Exhibition" },
  theatre: { sr: "Pozorište", en: "Theatre" },
  opera: { sr: "Opera", en: "Opera" },
  ballet: { sr: "Balet", en: "Ballet" },
  concert: { sr: "Koncert", en: "Concert" },
  cinema: { sr: "Bioskop", en: "Cinema" },
  festival: { sr: "Festival", en: "Festival" },
  other: { sr: "Ostalo", en: "Other" },
};

const AHEAD_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Predstoji (${count}):`,
  en: (count) => `Ahead (${count}):`,
};

const PAST_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Prošli planovi bez odgovora (${count}):`,
  en: (count) => `Past plans with no answer (${count}):`,
};

const AHEAD_EMPTY: { readonly sr: string; readonly en: string } = {
  sr: "Nema planova pred tobom.",
  en: "Nothing is on the programme ahead.",
};

const PAST_EMPTY: { readonly sr: string; readonly en: string } = {
  sr: "Nema prošlih planova bez odgovora.",
  en: "No past plan is waiting for an answer.",
};

const PLANS_MORE: AssistantPhrase<[count: number]> = {
  sr: (count) => `…i još ${count}.`,
  en: (count) => `…and ${count} more.`,
};

const ADD_SUMMARY: AssistantPhrase<[title: string, kind: string, day: string]> = {
  sr: (title, kind, day) => `Zapiši plan „${title}“ (${kind}) za ${day}`,
  en: (title, kind, day) => `Write the plan “${title}” (${kind}) for ${day}`,
};

const ADDED: AssistantPhrase<[title: string, id: string]> = {
  sr: (title, id) => `Plan je zapisan: „${title}“ (${id}).`,
  en: (title, id) => `The plan is written: “${title}” (${id}).`,
};

const BAD_LINK: { readonly sr: string; readonly en: string } = {
  sr: "Link mora da počinje sa http:// ili https://.",
  en: "A link must start with http:// or https://.",
};

export function cultureTools(deps: CultureToolDeps): readonly Tool[] {
  const programme: Tool = {
    name: "culture.programme",
    description: {
      sr: "Čita program kulture: šta je pred tobom — predstave, koncerti, izložbe i bioskop sa datumom i mestom — i koji prošli planovi još čekaju odgovor. Koristi ga kada korisnik pita šta ima da se gleda ili šta je planirao.",
      en: "Reads the culture programme: what is ahead — theatre, concerts, exhibitions and cinema with their date and place — and which past plans are still waiting for an answer. Use it when the user asks what there is to see or what they planned.",
    },
    parameters: {
      type: "object",
      properties: {
        when: {
          type: "string",
          enum: ["ahead", "past"],
          description: '"ahead" for what is still to come (the default), "past" for plans whose date has passed.',
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many plans to list. Defaults to ${String(DEFAULT_LIMIT)}.`,
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
        const when = asOptionalEnum(args.when, "when", ["ahead", "past"] as const) ?? "ahead";
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
        const today = localDay(deps.now());

        const plans = deps.profileDb(context.profileId, (db, id) =>
          new CultureStore(db, id).listPlans(),
        );
        const selected =
          when === "past"
            ? plans
                .filter((plan) => plan.date < today && plan.visitId === null)
                .sort((left, right) => comparePlans(right, left))
            : plans
                .filter((plan) => plan.date >= today)
                .sort((left, right) => comparePlans(left, right));

        if (selected.length === 0) {
          return okResult(text(context.locale, when === "past" ? PAST_EMPTY : AHEAD_EMPTY));
        }
        const shown = selected.slice(0, limit);
        const lines = [
          phrase(
            context.locale,
            when === "past" ? PAST_HEADING : AHEAD_HEADING,
            selected.length,
          ),
          ...shown.map((plan) => planLine(context.locale, plan)),
        ];
        if (selected.length > shown.length) {
          lines.push(phrase(context.locale, PLANS_MORE, selected.length - shown.length));
        }
        return okResult(lines.join("\n"));
      }),
  };

  const addPlan: Tool = {
    name: "culture.plan",
    description: {
      sr: "Zapisuje plan u program kulture: šta, gde i kada — predstava, koncert, izložba ili bioskop. Koristi ga kada korisnik kaže da ide negde ili da je kupio kartu.",
      en: "Writes a plan into the culture programme: what, where and when — theatre, a concert, an exhibition or cinema. Use it when the user says they are going somewhere or have bought a ticket.",
    },
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: MAX_CULTURE_TITLE_LENGTH, description: "What it is called, as the user said it." },
        kind: { type: "string", enum: [...VISIT_KINDS], description: `One of: ${VISIT_KINDS.join(", ")}.` },
        venue: { type: "string", minLength: 1, maxLength: MAX_CULTURE_VENUE_LENGTH, description: "The place it happens at." },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "The day, YYYY-MM-DD." },
        startTime: { type: "string", pattern: "^\\d{2}:\\d{2}$", description: 'The wall-clock start, "20:00".' },
        city: { type: "string", maxLength: MAX_CULTURE_CITY_LENGTH, description: "The city, when the user named one." },
        link: { type: "string", maxLength: MAX_LINK_CHARS, description: "A page with the details, http:// or https://." },
        notes: { type: "string", maxLength: MAX_CULTURE_NOTES_LENGTH, description: "Notes in the user's own words." },
      },
      required: ["title", "kind", "venue", "date"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const title = asText(args.title, "title", MAX_CULTURE_TITLE_LENGTH);
        const kind = asEnum(args.kind, "kind", VISIT_KINDS);
        const venue = asText(args.venue, "venue", MAX_CULTURE_VENUE_LENGTH);
        const date = asDay(args.date, "date");
        const startTime = asOptionalText(args.startTime, "startTime", 5);
        if (startTime !== undefined && !/^\d{2}:\d{2}$/.test(startTime)) {
          throw new Error('"startTime" must be a wall-clock time, e.g. "20:00".');
        }
        const city = asOptionalText(args.city, "city", MAX_CULTURE_CITY_LENGTH);
        const link = asOptionalText(args.link, "link", MAX_LINK_CHARS);
        if (link !== undefined && !HTTP_LINK.test(link)) {
          throw new Error(text(context.locale, BAD_LINK));
        }
        const notes = asOptionalText(args.notes, "notes", MAX_CULTURE_NOTES_LENGTH);

        const declined = await confirmOrDecline(
          context,
          "culture.plan",
          "write",
          phrase(
            context.locale,
            ADD_SUMMARY,
            title,
            text(context.locale, KIND_WORDS[kind]),
            formatDayInSentence(context.locale, date),
          ),
        );
        if (declined !== null) return declined;

        const created = deps.profileDb(context.profileId, (db, id) =>
          new CultureStore(db, id).createPlan(
            {
              kind,
              title,
              venue,
              date,
              ...(startTime === undefined ? {} : { startTime }),
              ...(city === undefined ? {} : { city }),
              ...(link === undefined ? {} : { link }),
              ...(notes === undefined ? {} : { notes }),
            },
            new Date(deps.now()).toISOString(),
          ),
        );
        return okResult(phrase(context.locale, ADDED, created.title, created.id), {
          navigateTo: { module: "culture" },
        });
      }),
  };

  return [programme, addPlan];
}

/** One plan as a line: when, what, where — the date first, because that is what the list is ordered by. */
function planLine(locale: AssistantLocale, plan: CulturePlan): string {
  const when =
    plan.startTime === null
      ? formatDayInSentence(locale, plan.date)
      : `${formatDayInSentence(locale, plan.date)}, ${plan.startTime}`;
  const where =
    plan.city === null
      ? plan.venue
      : `${plan.venue}, ${plan.city}`;
  return `- ${when}: ${text(locale, KIND_WORDS[plan.kind])} ${quote(locale, plan.title)}, ${where}`;
}

/** Date, then start time, then the id: a stable order for two plans on one day. */
function comparePlans(left: CulturePlan, right: CulturePlan): number {
  const byDate = left.date.localeCompare(right.date);
  if (byDate !== 0) return byDate;
  const byTime = (left.startTime ?? "").localeCompare(right.startTime ?? "");
  if (byTime !== 0) return byTime;
  return left.id.localeCompare(right.id);
}

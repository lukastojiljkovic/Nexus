import { rankSequence } from "../order/rank.js";
import { clozeNumbers, findClozeRuns, renderClozeCard } from "../study/clozeText.js";
import { freshCardScheduling } from "./ankiTranslate.js";
import type { ExportCard, ExportDeck, ExportEvent, ExportTask, ProfileData } from "./exportArchive.js";

/**
 * The LLM-assisted import (IMEX-005): the one import in this package whose
 * "reader" is a person and a chat window.
 *
 * The user has a pile of free-form text somewhere else — a syllabus, an email,
 * a lecture handout — and an LLM they already talk to. Nexus does not call that
 * LLM and never will: there is no key, no network and no cloud in this build
 * (CLAUDE.md's current focus), and shipping one would put the user's private
 * content on somebody's server as a side effect of an import button. So the
 * app does the two things it CAN do honestly:
 *
 *   1. `buildLlmPrompt` — hand the user a complete instruction they paste into
 *      their own chat, with the answer format spelled out inside it.
 *   2. `parseLlmAnswer` — accept the answer they paste back, tolerantly about
 *      the WRAPPING an assistant puts around JSON and strictly about the JSON
 *      itself.
 *
 * Three properties shape everything below.
 *
 * **The envelope's field names ARE the interchange's.** A task's `title`,
 * `dueDate`, `priority` and `description`; an event's `title`, `startAt`,
 * `endAt`, `allDay`, `location` and `description`; a card's `front`, `back` and
 * `clozeText` are the very keys `ExportTask`, `ExportEvent` and `ExportCard`
 * declare (`exportArchive.ts`). Nothing in this file re-maps a name, because
 * there is no name to re-map: the envelope is a strict SUBSET of the rows the
 * app already round-trips through an archive, and a subset that renamed its
 * fields would be a second vocabulary for one thing — the kind of drift the
 * interchange contract exists to prevent.
 *
 * **Tolerant outside, strict inside.** An assistant wraps JSON in fences and
 * apologies; refusing that would make the feature useless. So the wrapper is
 * peeled — fences, leading prose, trailing prose — and then `JSON.parse` is the
 * parser, with no repairs whatsoever. A trailing comma is REFUSED rather than
 * fixed, and so is a comment: "repairing" somebody's JSON means guessing what
 * they meant, and every guess here would be a guess about the user's own
 * content. What that costs is one re-ask in the chat; what guessing would cost
 * is a wrong row nobody notices.
 *
 * **A bad record never takes the batch down.** Every entry of `records` is
 * validated on its own, and a bad one is skipped BY INDEX with a named reason
 * the screen can print — so forty good tasks still arrive when the assistant
 * invented a fifth priority for one of them. The report balances:
 * `total === accepted + skipped.length`, always.
 *
 * Pure, like every other module in `@nexus/core`: no clock (`now` is injected),
 * no id generator (the ids below are deterministic source-side names
 * `planForeignImport` mints over), no IO. `translateLlmRecords` is the third
 * function, and the same seam `ankiTranslate.ts` uses: parsed records in, a
 * minimal `ProfileData` out, ready for the foreign-import planner.
 */

// --- The contract ------------------------------------------------------------

/** What one prompt (and one answer) is about. Three kinds, because these are the three the app can build a row from with no further decision. */
export type LlmImportKind = "tasks" | "events" | "cards";

/** Every kind, in the order the picker offers them. */
export const LLM_IMPORT_KINDS: readonly LlmImportKind[] = ["tasks", "events", "cards"];

/** Which language the PROMPT is written in. Not the content's language — the prompt tells the assistant to keep that. */
export type LlmPromptLanguage = "sr" | "en";

/** Both languages, in the order the toggle offers them. */
export const LLM_PROMPT_LANGUAGES: readonly LlmPromptLanguage[] = ["sr", "en"];

/**
 * The envelope's marker key. A key rather than a bare `version` field, so an
 * arbitrary JSON object a user pastes by accident is recognisably NOT one of
 * these — `{"kind":"tasks","records":[]}` from some other tool is refused by
 * name instead of being read as ours.
 */
export const LLM_ENVELOPE_KEY = "nexus-llm";

/**
 * The envelope's version. Its own number, deliberately not
 * `INTERCHANGE_SCHEMA_VERSION`: an archive's schema moves whenever any row
 * shape does, while this envelope is a tiny hand-typed subset that should
 * change only when THIS contract does — pinning it to the archive's would
 * invalidate every prompt a user has saved for a field they never send.
 */
export const LLM_ENVELOPE_VERSION = "1";

/**
 * Most records one answer may carry. Mirrors `NOTE_CARDS_MAX_COUNT` — the
 * app's own "how many of these can one gesture produce" number — because this
 * is the same question asked of a chat answer instead of a note.
 */
export const LLM_MAX_RECORDS = 500;

/**
 * Longest any one text field may be. Mirrors `MAX_TEXT_LENGTH` in `@nexus/db`'s
 * `study/cardStore.ts` (`CARD_TEXT_MAX_LENGTH` on the wire), the one text cap
 * this app states out loud. A task title, an event location and a card side are
 * held to it alike: past ten thousand characters a value is not a title, a
 * place or a question, and a store that has no cap of its own is no reason to
 * write one.
 */
export const LLM_MAX_TEXT_LENGTH = 10_000;

/**
 * Longest answer the parser will look at, in characters. Mirrors
 * `MARKDOWN_IMPORT_MAX_BYTES` — the size this app already calls "one document's
 * worth of text" — and it is what stops a pasted megabyte of prose from being
 * scanned for braces at all.
 */
export const LLM_MAX_ANSWER_LENGTH = 1_048_576;

/** The four priorities `ExportTask.priority` carries — `importArchive.ts`'s own `TASK_PRIORITIES`, spelled here because the prompt has to print them. */
const TASK_PRIORITIES = ["none", "low", "medium", "high"] as const;

type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * Imported tasks land in the target's own default list beside whatever is
 * already there, and their ranks sort in among it by ordinary string
 * comparison — a freshly minted rank is simply one more row in the same
 * scope, with no arithmetic of its own to reconcile against what the target
 * profile already has. That is the foreign import's established behaviour for
 * every ranked row (see `planForeignImport`'s note on dashboard placements),
 * not a special case.
 */

// --- The records --------------------------------------------------------------

/** One task, exactly the subset of `ExportTask` a person can dictate: everything else is a decision the import makes (see `translateLlmRecords`). */
export interface LlmTaskRecord {
  title: string;
  /** Bare `YYYY-MM-DD`, or null. Never an instant: a task's deadline is a day (ADR-028). */
  dueDate: string | null;
  priority: TaskPriority;
  description: string | null;
}

/**
 * One event, the subset of `ExportEvent` a person can dictate. `startAt`/`endAt`
 * are WALL-CLOCK — `YYYY-MM-DDTHH:MM`, no zone — because that is what the app
 * itself writes (`CalendarPage`'s `newEventFields`), and an all-day row carries
 * a bare `YYYY-MM-DD` in both, for the same reason.
 */
export interface LlmEventRecord {
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
}

/**
 * One card: either a two-sided pair or a cloze template. The union is the
 * record's own shape rather than a `kind` the answer has to spell, because the
 * two are told apart by which fields are there — one fewer thing an assistant
 * can get wrong, and one fewer enum to keep in step.
 */
export type LlmCardRecord =
  | { kind: "basic"; front: string; back: string }
  | { kind: "cloze"; clozeText: string };

/** Every accepted record of one answer, discriminated by the envelope's own `kind`. */
export type LlmRecords =
  | { kind: "tasks"; records: readonly LlmTaskRecord[] }
  | { kind: "events"; records: readonly LlmEventRecord[] }
  | { kind: "cards"; records: readonly LlmCardRecord[] };

/**
 * Why one entry of `records` is not among them. Closed, and each one a sentence
 * a screen can print beside the entry's index — an answer that lost three rows
 * without saying which or why would be worse than one that arrived whole.
 */
export type LlmSkipReason =
  /** The entry is not a JSON object at all (a bare string, a number, an array). */
  | "not-an-object"
  /** A field the record cannot do without is absent, null or empty. */
  | "missing-field"
  /** A field is present but wrong: the wrong type, outside a closed enum, or a date that is not one. */
  | "invalid-field"
  /** A field is longer than `LLM_MAX_TEXT_LENGTH`. Its own code, because "too long" is a different thing to tell somebody than "not valid". */
  | "text-too-long"
  /** A card record is neither a `front`+`back` pair nor a `clozeText` template, or is somehow both. */
  | "unknown-card-shape"
  /** A `clozeText` carrying no `{{…}}` deletion — a cloze card that asks nothing. */
  | "no-cloze-deletion"
  /** Everything past `LLM_MAX_RECORDS`. Named rather than silently truncated, so a long answer says how much of it was read. */
  | "over-record-cap";

/** One skipped entry: where it was, why, and (when the reason names one) which field. */
export interface LlmSkippedRecord {
  /** 0-based index in the answer's own `records` array — what the screen prints, so the user can find it in the chat. */
  index: number;
  reason: LlmSkipReason;
  field: string | null;
}

/**
 * One answer's arithmetic. `total === accepted + skipped.length` always holds:
 * every entry either became a record or is named below, and a report that did
 * not balance would be worse than no report at all.
 */
export interface LlmAnswerReport {
  /** Entries the `records` array carried, before any rule here ran. */
  total: number;
  /** Entries that became records. */
  accepted: number;
  skipped: readonly LlmSkippedRecord[];
  /** Keys this build does not know, dropped from records that were otherwise fine. Counted, never guessed at. */
  droppedFields: number;
}

/**
 * Why an answer could not be read AT ALL — a fact about the whole paste rather
 * than about one record, which is why it is a separate domain from
 * `LlmSkipReason`.
 */
export type LlmAnswerProblem =
  /** Nothing was pasted. */
  | "empty"
  /** Past `LLM_MAX_ANSWER_LENGTH`. */
  | "too-long"
  /** No JSON object anywhere in the text — usually the assistant answered in prose. */
  | "no-json"
  /** Something object-shaped was found and `JSON.parse` refused it. A trailing comma lands here, deliberately unrepaired. */
  | "not-json"
  /** Valid JSON, but not this envelope: no marker key, or a `records` that is not an array. */
  | "not-an-envelope"
  | "unsupported-version"
  | "unknown-kind";

export type LlmAnswer =
  | { status: "ok"; parsed: LlmRecords; report: LlmAnswerReport }
  | { status: "failed"; code: LlmAnswerProblem };

// --- The prompt ---------------------------------------------------------------

/**
 * One field of one kind's record shape. `key` and `type` are LANGUAGE-NEUTRAL
 * and written once — which is what makes it impossible for the Serbian and the
 * English prompt to describe different formats. Only the gloss differs, and the
 * gloss is prose about a shape both prompts print identically.
 */
interface ContractField {
  key: string;
  /** The value spec, exactly as both prompts print it. */
  type: string;
  sr: string;
  en: string;
}

const CONTRACT: Record<LlmImportKind, readonly ContractField[]> = {
  tasks: [
    {
      key: "title",
      type: "string",
      sr: "obavezno — kratak naziv obaveze",
      en: "required — a short name for the thing to do",
    },
    {
      key: "dueDate",
      type: '"YYYY-MM-DD" | null',
      sr: "opciono — rok, samo datum; null ako rok nije naveden",
      en: "optional — the deadline, a calendar day only; null when none is stated",
    },
    {
      key: "priority",
      type: '"none" | "low" | "medium" | "high"',
      sr: 'opciono — podrazumevano "none"',
      en: 'optional — defaults to "none"',
    },
    {
      key: "description",
      type: "string | null",
      sr: "opciono — detalji koji ne staju u naziv",
      en: "optional — detail that does not belong in the name",
    },
  ],
  events: [
    {
      key: "title",
      type: "string",
      sr: "obavezno — kratak naziv događaja",
      en: "required — a short name for the event",
    },
    {
      key: "startAt",
      type: '"YYYY-MM-DDTHH:MM" | "YYYY-MM-DD"',
      sr: "obavezno — početak; samo datum kada događaj traje ceo dan",
      en: "required — the start; a date only when the event lasts all day",
    },
    {
      key: "endAt",
      type: '"YYYY-MM-DDTHH:MM" | "YYYY-MM-DD" | null',
      sr: "opciono — kraj, u istom obliku kao početak; null kada nije poznat",
      en: "optional — the end, in the same shape as the start; null when unknown",
    },
    {
      key: "allDay",
      type: "boolean",
      sr: "opciono — podrazumevano false",
      en: "optional — defaults to false",
    },
    {
      key: "location",
      type: "string | null",
      sr: "opciono — mesto",
      en: "optional — where it happens",
    },
    {
      key: "description",
      type: "string | null",
      sr: "opciono — detalji",
      en: "optional — detail",
    },
  ],
  cards: [
    {
      key: "front",
      type: "string",
      sr: 'obavezno uz "back" — pitanje',
      en: 'required together with "back" — the question',
    },
    {
      key: "back",
      type: "string",
      sr: 'obavezno uz "front" — odgovor',
      en: 'required together with "front" — the answer',
    },
    {
      key: "clozeText",
      type: "string",
      sr: 'umesto para "front"/"back" — rečenica sa prazninama u {{dvostrukim vitičastim zagradama}}',
      en: 'instead of the "front"/"back" pair — a sentence whose blanks are wrapped in {{double curly braces}}',
    },
  ],
};

/** The prose that surrounds the shared contract, per kind and per language. */
interface PromptCopy {
  /** What the assistant is being asked to produce. */
  intro: string;
  /** The rules, in the order they are printed. */
  rules: readonly string[];
}

/** One few-shot pair: the free-form input, and the records the answer must carry for it. */
interface PromptExample {
  input: string;
  records: readonly Record<string, unknown>[];
}

const HEADINGS: Record<LlmPromptLanguage, { format: string; fields: string; rules: string; examples: string; input: string; output: string; content: string }> = {
  sr: {
    format: "FORMAT ODGOVORA",
    fields: "POLJA JEDNOG ZAPISA",
    rules: "PRAVILA",
    examples: "PRIMERI",
    input: "Ulaz:",
    output: "Odgovor:",
    content: "SADRŽAJ (ispod ove linije)",
  },
  en: {
    format: "ANSWER FORMAT",
    fields: "FIELDS OF ONE RECORD",
    rules: "RULES",
    examples: "EXAMPLES",
    input: "Input:",
    output: "Answer:",
    content: "CONTENT (below this line)",
  },
};

/** The last line of every prompt — the one instruction the whole feature depends on. */
const ANSWER_ONLY: Record<LlmPromptLanguage, string> = {
  sr: "Odgovori ISKLJUČIVO JSON-om — bez uvoda, bez objašnjenja i bez teksta posle njega.",
  en: "Reply with ONLY the JSON — no preamble, no explanation, and no text after it.",
};

/** The two rules every kind shares, so they cannot drift between the three prompts. */
const SHARED_RULES: Record<LlmPromptLanguage, readonly string[]> = {
  sr: [
    "Nikakva druga polja. Sve što nije na spisku iznad biće odbačeno pri uvozu.",
    `Najviše ${LLM_MAX_RECORDS} zapisa u jednom odgovoru.`,
    "Mora biti ispravan JSON: bez zareza posle poslednjeg elementa, bez komentara i bez navodnika koji nisu \".",
    "Ne izmišljaj podatke kojih u sadržaju nema, i ne izostavljaj ništa što jeste tamo.",
    "Tekst piši na jeziku na kom je i sam sadržaj.",
  ],
  en: [
    "No other fields. Anything not listed above is discarded on import.",
    `At most ${LLM_MAX_RECORDS} records in one answer.`,
    'Valid JSON only: no trailing comma, no comments, and no quote character other than ".',
    "Do not invent anything the content does not say, and do not leave out anything it does.",
    "Write the text in the same language as the content itself.",
  ],
};

const COPY: Record<LlmImportKind, Record<LlmPromptLanguage, PromptCopy>> = {
  tasks: {
    sr: {
      intro:
        "Ti si pomoćnik koji pretvara slobodan tekst u strukturisane podatke za aplikaciju Nexus.\nIz sadržaja koji ti šaljem ispod izvuci sve obaveze i vrati ih kao spisak zadataka.",
      rules: [
        'Datum je uvek u obliku "YYYY-MM-DD", na primer "2026-09-01". Zadatak bez jasnog roka dobija null.',
        'Prioritet mora biti tačno jedna od četiri vrednosti, malim slovima: "none", "low", "medium", "high".',
        "Naziv zadatka počinje glagolom kad god je to prirodno („Prijaviti ispit“, ne „Ispit“).",
      ],
    },
    en: {
      intro:
        "You are an assistant that turns free-form text into structured data for the Nexus app.\nRead the content I paste below and return every actionable item as a task.",
      rules: [
        'A date is always "YYYY-MM-DD", for example "2026-09-01". A task with no clear deadline gets null.',
        'The priority must be exactly one of four lowercase values: "none", "low", "medium", "high".',
        'Start a task name with a verb whenever that reads naturally ("Register for the exam", not "Exam").',
      ],
    },
  },
  events: {
    sr: {
      intro:
        "Ti si pomoćnik koji pretvara slobodan tekst u strukturisane podatke za aplikaciju Nexus.\nIz sadržaja koji ti šaljem ispod izvuci sve termine i vrati ih kao spisak događaja.",
      rules: [
        'Vreme je LOKALNO vreme, u obliku "YYYY-MM-DDTHH:MM" (na primer "2026-08-12T10:00"). Sekunde su dozvoljene, oznaka vremenske zone nije: ni "Z", ni "+02:00" — zona bi pomerila događaj u kalendaru.',
        'Događaj koji traje ceo dan dobija "allDay": true, a "startAt" i "endAt" tada nose samo datum ("YYYY-MM-DD").',
        'Kraj ne sme biti pre početka. Ako trajanje nije poznato, "endAt" je null.',
      ],
    },
    en: {
      intro:
        "You are an assistant that turns free-form text into structured data for the Nexus app.\nRead the content I paste below and return every scheduled thing as an event.",
      rules: [
        'Times are LOCAL wall-clock times, written "YYYY-MM-DDTHH:MM" (for example "2026-08-12T10:00"). Seconds are allowed; a timezone suffix is not — neither "Z" nor "+02:00" — because a zone would move the event in the calendar.',
        'An event that lasts all day gets "allDay": true, and then "startAt" and "endAt" carry a date only ("YYYY-MM-DD").',
        'The end must not precede the start. When the length is unknown, "endAt" is null.',
      ],
    },
  },
  cards: {
    sr: {
      intro:
        "Ti si pomoćnik koji pretvara slobodan tekst u strukturisane podatke za aplikaciju Nexus.\nIz sadržaja koji ti šaljem ispod napravi kartice za učenje.",
      rules: [
        'Jedan zapis je ILI par "front"/"back", ILI samo "clozeText". Nikada oboje i nikada nijedno.',
        'U "clozeText" svaka praznina ide u dvostruke vitičaste zagrade: „Glavni grad Srbije je {{Beograd}}.“ Jedna rečenica sme imati više praznina; svaka postaje zasebna kartica.',
        "Jedna kartica proverava jednu stvar. Radije napravi dve kratke nego jednu koja nabraja.",
      ],
    },
    en: {
      intro:
        "You are an assistant that turns free-form text into structured data for the Nexus app.\nTurn the content I paste below into flashcards.",
      rules: [
        'One record is EITHER a "front"/"back" pair OR a "clozeText" on its own. Never both, never neither.',
        'In "clozeText" every blank goes inside double curly braces: "The capital of Serbia is {{Belgrade}}." One sentence may hold several blanks; each becomes its own card.',
        "One card asks one thing. Prefer two short cards over one that lists.",
      ],
    },
  },
};

const EXAMPLES: Record<LlmImportKind, Record<LlmPromptLanguage, readonly PromptExample[]>> = {
  tasks: {
    sr: [
      {
        input:
          "Do 1. septembra 2026. moram da prijavim ispit iz Analize — hitno. Treba i da kupim novu svesku, kad stignem.",
        records: [
          {
            title: "Prijaviti ispit iz Analize",
            dueDate: "2026-09-01",
            priority: "high",
            description: null,
          },
          { title: "Kupiti novu svesku", dueDate: null, priority: "none", description: null },
        ],
      },
      {
        input:
          "Podsetnik sa sastanka: Marko šalje ponudu do petka 14.08.2026, ja pišem zapisnik i prosleđujem ga timu.",
        records: [
          {
            title: "Poslati ponudu",
            dueDate: "2026-08-14",
            priority: "medium",
            description: "Sa sastanka: zadužen Marko.",
          },
          {
            title: "Napisati zapisnik sa sastanka",
            dueDate: null,
            priority: "low",
            description: "Proslediti timu kada bude gotov.",
          },
        ],
      },
    ],
    en: [
      {
        input:
          "By 1 September 2026 I must register for the Analysis exam — urgent. I also need to buy a new notebook whenever I get a chance.",
        records: [
          {
            title: "Register for the Analysis exam",
            dueDate: "2026-09-01",
            priority: "high",
            description: null,
          },
          { title: "Buy a new notebook", dueDate: null, priority: "none", description: null },
        ],
      },
      {
        input:
          "Notes from the meeting: Marko sends the quote by Friday 14 Aug 2026, I write the minutes and forward them to the team.",
        records: [
          {
            title: "Send the quote",
            dueDate: "2026-08-14",
            priority: "medium",
            description: "From the meeting: Marko owns this.",
          },
          {
            title: "Write the meeting minutes",
            dueDate: null,
            priority: "low",
            description: "Forward to the team once done.",
          },
        ],
      },
    ],
  },
  events: {
    sr: [
      {
        input:
          "12. avgusta 2026. u 10h imam sastanak sa timom u kancelariji, traje sat i po. Istog dana uveče u 20:00 je koncert.",
        records: [
          {
            title: "Sastanak sa timom",
            startAt: "2026-08-12T10:00",
            endAt: "2026-08-12T11:30",
            allDay: false,
            location: "Kancelarija",
            description: null,
          },
          {
            title: "Koncert",
            startAt: "2026-08-12T20:00",
            endAt: null,
            allDay: false,
            location: null,
            description: null,
          },
        ],
      },
      {
        input: "Od 3. do 5. septembra 2026. je konferencija u Novom Sadu, ceo dan.",
        records: [
          {
            title: "Konferencija",
            startAt: "2026-09-03",
            endAt: "2026-09-05",
            allDay: true,
            location: "Novi Sad",
            description: null,
          },
        ],
      },
    ],
    en: [
      {
        input:
          "On 12 August 2026 at 10am I have a team meeting at the office, an hour and a half. The same evening at 8pm there is a concert.",
        records: [
          {
            title: "Team meeting",
            startAt: "2026-08-12T10:00",
            endAt: "2026-08-12T11:30",
            allDay: false,
            location: "The office",
            description: null,
          },
          {
            title: "Concert",
            startAt: "2026-08-12T20:00",
            endAt: null,
            allDay: false,
            location: null,
            description: null,
          },
        ],
      },
      {
        input: "The conference in Novi Sad runs from 3 to 5 September 2026, all day.",
        records: [
          {
            title: "Conference",
            startAt: "2026-09-03",
            endAt: "2026-09-05",
            allDay: true,
            location: "Novi Sad",
            description: null,
          },
        ],
      },
    ],
  },
  cards: {
    sr: [
      {
        input:
          "Mitohondrije su organele u kojima se odvija ćelijsko disanje. Imaju dve membrane, a spoljašnja je propustljiva.",
        records: [
          { front: "Šta se odvija u mitohondrijama?", back: "Ćelijsko disanje." },
          { front: "Koliko membrana ima mitohondrija?", back: "Dve — spoljašnju i unutrašnju." },
        ],
      },
      {
        input: "Glavni grad Srbije je Beograd, a leži na ušću Save u Dunav.",
        records: [
          { clozeText: "Glavni grad Srbije je {{Beograd}}." },
          { clozeText: "Beograd leži na ušću {{Save}} u {{Dunav}}." },
        ],
      },
    ],
    en: [
      {
        input:
          "Mitochondria are the organelles where cellular respiration happens. They have two membranes, and the outer one is permeable.",
        records: [
          { front: "Where does cellular respiration happen?", back: "In the mitochondria." },
          { front: "How many membranes does a mitochondrion have?", back: "Two — an outer and an inner one." },
        ],
      },
      {
        input: "The capital of Serbia is Belgrade, which sits where the Sava meets the Danube.",
        records: [
          { clozeText: "The capital of Serbia is {{Belgrade}}." },
          { clozeText: "Belgrade sits where the {{Sava}} meets the {{Danube}}." },
        ],
      },
    ],
  },
};

/** One envelope, printed exactly as the parser reads it. The ONE serializer both languages' examples go through, so no example can describe a different envelope. */
function serializeEnvelope(kind: LlmImportKind, records: readonly unknown[]): string {
  return JSON.stringify(
    { [LLM_ENVELOPE_KEY]: LLM_ENVELOPE_VERSION, kind, records },
    null,
    2,
  );
}

/**
 * The complete instruction a user pastes into their own chat, above their own
 * content. Deterministic: the same two arguments always produce the identical
 * string, because a prompt somebody saved has to keep working.
 *
 * Every structural part — the envelope's keys, each record's field names and
 * their type specs, and the examples' JSON — is produced from ONE source shared
 * by both languages, so the Serbian and English prompts cannot describe
 * different formats. What differs is prose: the intro, the glosses, the rules
 * and the examples' own content, which is written in the prompt's language
 * because a few-shot example in the wrong language teaches the wrong thing.
 */
export function buildLlmPrompt(kind: LlmImportKind, language: LlmPromptLanguage): string {
  const headings = HEADINGS[language];
  const copy = COPY[kind][language];
  const fields = CONTRACT[kind]
    .map((field) => `  "${field.key}": ${field.type}\n      ${field[language]}`)
    .join("\n");
  const rules = [...copy.rules, ...SHARED_RULES[language]]
    .map((rule, index) => `  ${index + 1}. ${rule}`)
    .join("\n");
  const examples = EXAMPLES[kind][language]
    .map(
      (example) =>
        `${headings.input}\n${example.input}\n\n${headings.output}\n\`\`\`json\n${serializeEnvelope(kind, example.records)}\n\`\`\``,
    )
    .join("\n\n");

  return [
    copy.intro,
    "",
    headings.format,
    serializeEnvelope(kind, []),
    "",
    headings.fields,
    fields,
    "",
    headings.rules,
    rules,
    "",
    headings.examples,
    examples,
    "",
    ANSWER_ONLY[language],
    "",
    `--- ${headings.content} ---`,
    "",
  ].join("\n");
}

// --- The answer ---------------------------------------------------------------

/** One record's refusal, thrown by the field readers and caught per record — the same shape `importArchive.ts`'s `InvalidFieldError` has, with a reason the screen can print. */
class RecordSkip extends Error {
  constructor(
    readonly reason: LlmSkipReason,
    readonly field: string | null,
  ) {
    super(`${reason}${field === null ? "" : `: ${field}`}`);
    this.name = "RecordSkip";
  }
}

/**
 * The one JSON value inside a paste, or why there is none.
 *
 * Candidates are tried in order — every fenced block first, then the whole text
 * — and within a candidate the object is the FIRST `{` through its matching
 * `}`, found by a scanner that knows what a JSON string is. String-awareness is
 * the whole point of writing this by hand: a card whose front is „šta radi
 * `{ }`?" carries braces that are content, and a depth counter that could not
 * tell them apart would cut the object in half.
 *
 * Prose before and after falls away for free, since the scan starts at a brace
 * and stops at its match.
 */
function findEnvelope(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: "no-json" | "not-json" } {
  let sawObject = false;
  for (const candidate of [...fencedBlocks(text), text]) {
    const open = candidate.indexOf("{");
    if (open === -1) continue;
    const close = matchingBrace(candidate, open);
    if (close === -1) continue;
    sawObject = true;
    try {
      const value: unknown = JSON.parse(candidate.slice(open, close + 1));
      if (isRecord(value)) return { ok: true, value };
    } catch {
      // Deliberately no repair pass: see the module header. The next candidate
      // (if any) gets its own chance; otherwise this becomes `not-json`.
    }
  }
  return { ok: false, code: sawObject ? "not-json" : "no-json" };
}

/** Every ``` fenced block's body, in order, whatever language tag it carries. */
function fencedBlocks(text: string): string[] {
  return [...text.matchAll(/```[a-zA-Z]*\r?\n([\s\S]*?)```/g)].map((match) => match[1] ?? "");
}

/** The index of the `}` closing the `{` at `open`, or -1 when the text runs out first. Braces inside JSON strings are content, not structure. */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  for (let index = open; index < text.length; index += 1) {
    const ch = text.charAt(index);
    if (inString) {
      if (ch === "\\") index += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads one pasted chat answer.
 *
 * Tolerant about the wrapping (fences, prose on either side), strict about
 * everything inside it: `JSON.parse` is the parser and nothing repairs its
 * input, the envelope's marker/version/kind are checked before a single record
 * is looked at, and each record is then validated on its own so a bad one costs
 * its own place and nothing else.
 *
 * A duplicated key inside a record resolves the way `JSON.parse` resolves it —
 * last one wins. That is not a decision this module makes; it is the parser's,
 * and re-deciding it would mean writing a second JSON reader.
 */
export function parseLlmAnswer(text: string): LlmAnswer {
  if (text.length > LLM_MAX_ANSWER_LENGTH) return { status: "failed", code: "too-long" };
  if (text.trim().length === 0) return { status: "failed", code: "empty" };

  const found = findEnvelope(text);
  if (!found.ok) return { status: "failed", code: found.code };

  const envelope = found.value;
  const marker = envelope[LLM_ENVELOPE_KEY];
  if (typeof marker !== "string") return { status: "failed", code: "not-an-envelope" };
  if (marker !== LLM_ENVELOPE_VERSION) return { status: "failed", code: "unsupported-version" };

  const kind = LLM_IMPORT_KINDS.find((candidate) => candidate === envelope.kind);
  if (kind === undefined) return { status: "failed", code: "unknown-kind" };

  const rawRecords: unknown = envelope.records;
  if (!Array.isArray(rawRecords)) return { status: "failed", code: "not-an-envelope" };
  const entries: readonly unknown[] = rawRecords;

  const skipped: LlmSkippedRecord[] = [];
  let droppedFields = 0;
  const tasks: LlmTaskRecord[] = [];
  const events: LlmEventRecord[] = [];
  const cards: LlmCardRecord[] = [];
  let accepted = 0;

  entries.forEach((entry, index) => {
    if (accepted >= LLM_MAX_RECORDS) {
      skipped.push({ index, reason: "over-record-cap", field: null });
      return;
    }
    if (!isRecord(entry)) {
      skipped.push({ index, reason: "not-an-object", field: null });
      return;
    }
    try {
      switch (kind) {
        case "tasks":
          tasks.push(parseTaskRecord(entry));
          break;
        case "events":
          events.push(parseEventRecord(entry));
          break;
        case "cards":
          cards.push(parseCardRecord(entry));
          break;
      }
    } catch (error) {
      if (!(error instanceof RecordSkip)) throw error;
      skipped.push({ index, reason: error.reason, field: error.field });
      return;
    }
    accepted += 1;
    droppedFields += countUnknownFields(entry, kind);
  });

  const report: LlmAnswerReport = { total: entries.length, accepted, skipped, droppedFields };
  switch (kind) {
    case "tasks":
      return { status: "ok", parsed: { kind, records: tasks }, report };
    case "events":
      return { status: "ok", parsed: { kind, records: events }, report };
    case "cards":
      return { status: "ok", parsed: { kind, records: cards }, report };
  }
}

/** Keys this build has no field for. Dropped rather than refused: an assistant that adds `"id"` or `"tags"` has still answered the question. */
function countUnknownFields(entry: Record<string, unknown>, kind: LlmImportKind): number {
  const known = new Set(CONTRACT[kind].map((field) => field.key));
  let dropped = 0;
  for (const key of Object.keys(entry)) {
    if (!known.has(key)) dropped += 1;
  }
  return dropped;
}

// --- Field readers ------------------------------------------------------------

/** A required text field, trimmed exactly as the stores trim before writing. Absent, null or blank is a MISSING field, not an invalid one — two different things to tell somebody. */
function requiredText(entry: Record<string, unknown>, key: string): string {
  const value = entry[key];
  if (value === undefined || value === null) throw new RecordSkip("missing-field", key);
  if (typeof value !== "string") throw new RecordSkip("invalid-field", key);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new RecordSkip("missing-field", key);
  if (trimmed.length > LLM_MAX_TEXT_LENGTH) throw new RecordSkip("text-too-long", key);
  return trimmed;
}

/** An optional text field. Absent, null and blank all mean the same thing here — "not said" — because an assistant spells that three ways and all three mean null. */
function optionalText(entry: Record<string, unknown>, key: string): string | null {
  const value = entry[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new RecordSkip("invalid-field", key);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > LLM_MAX_TEXT_LENGTH) throw new RecordSkip("text-too-long", key);
  return trimmed;
}

function optionalBoolean(entry: Record<string, unknown>, key: string): boolean {
  const value = entry[key];
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") throw new RecordSkip("invalid-field", key);
  return value;
}

function optionalEnum<T extends string>(
  entry: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = entry[key];
  if (value === undefined || value === null) return fallback;
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new RecordSkip("invalid-field", key);
  return match;
}

const BARE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** `YYYY-MM-DDTHH:MM`, optionally with seconds. Deliberately no zone and no milliseconds — see `parseInstant`. */
const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** A real calendar day, not merely a parseable one: `Date.parse` rolls `2026-02-30` into March, which is exactly the plausible-but-wrong value an assistant produces. */
function isRealDay(value: string): boolean {
  const match = BARE_DATE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
}

function optionalBareDate(entry: Record<string, unknown>, key: string): string | null {
  const value = optionalText(entry, key);
  if (value === null) return null;
  if (!isRealDay(value)) throw new RecordSkip("invalid-field", key);
  return value;
}

/** One instant of an event, and which SHAPE it came in — the shape is what decides `allDay`, so the caller needs both. */
interface EventInstant {
  value: string;
  allDay: boolean;
}

/**
 * A bare `YYYY-MM-DD` or a wall-clock `YYYY-MM-DDTHH:MM[:SS]`, and nothing
 * else. A zoned instant is REFUSED rather than converted: this module has no
 * timezone (it has no clock at all), so `10:00Z` could only be written into the
 * calendar as 10:00 — which for a reader two hours east is the wrong hour, and
 * a silently wrong hour is worse than a named refusal. The prompt pins the
 * format three times over for exactly this reason.
 */
function parseInstant(raw: string, key: string): EventInstant {
  if (isRealDay(raw)) return { value: raw, allDay: true };
  const match = WALL_CLOCK.exec(raw);
  if (match === null) throw new RecordSkip("invalid-field", key);
  const day = match[1] ?? "";
  if (!isRealDay(day)) throw new RecordSkip("invalid-field", key);
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = match[4] === undefined ? 0 : Number(match[4]);
  if (hours > 23 || minutes > 59 || seconds > 59) throw new RecordSkip("invalid-field", key);
  return { value: raw, allDay: false };
}

// --- Per-kind record parsers --------------------------------------------------

function parseTaskRecord(entry: Record<string, unknown>): LlmTaskRecord {
  return {
    title: requiredText(entry, "title"),
    dueDate: optionalBareDate(entry, "dueDate"),
    priority: optionalEnum(entry, "priority", TASK_PRIORITIES, "none"),
    description: optionalText(entry, "description"),
  };
}

/**
 * One event, with the one normalization this file performs: `allDay` is true
 * when the answer says so OR when `startAt` came as a bare date, and an all-day
 * event's instants are then truncated to their days.
 *
 * That is a single rule, not a pair of them, and it is what the app itself
 * stores — `CalendarPage` writes a bare date for an all-day row and a
 * wall-clock instant for a timed one. So an assistant that says „ceo dan" and
 * still writes midnight, and one that writes a date and forgets the flag, both
 * produce exactly the row the user would have made by hand.
 */
function parseEventRecord(entry: Record<string, unknown>): LlmEventRecord {
  const title = requiredText(entry, "title");
  const start = parseInstant(requiredText(entry, "startAt"), "startAt");
  const endRaw = optionalText(entry, "endAt");
  const end = endRaw === null ? null : parseInstant(endRaw, "endAt");
  const allDay = optionalBoolean(entry, "allDay") || start.allDay;

  const startAt = allDay ? start.value.slice(0, 10) : start.value;
  const endAt = end === null ? null : allDay ? end.value.slice(0, 10) : end.value;

  if (endAt !== null) {
    // Both instants must now be the same shape — an all-day pair of days, or a
    // timed pair of wall-clock strings — which is what makes the comparison
    // below a real one: two same-shaped ISO strings sort chronologically.
    if (!allDay && end !== null && end.allDay) throw new RecordSkip("invalid-field", "endAt");
    if (endAt < startAt) throw new RecordSkip("invalid-field", "endAt");
  }

  return {
    title,
    startAt,
    endAt,
    allDay,
    location: optionalText(entry, "location"),
    description: optionalText(entry, "description"),
  };
}

/**
 * One card, told apart by WHICH fields are there rather than by a `kind` the
 * answer has to spell. A record that is both shapes at once — or neither, which
 * is what a lone `front` is — is refused whole: guessing which half was meant
 * would put a card with no answer into somebody's study queue.
 */
function parseCardRecord(entry: Record<string, unknown>): LlmCardRecord {
  const hasBasic = present(entry, "front") && present(entry, "back");
  const hasCloze = present(entry, "clozeText");
  if (hasBasic === hasCloze) throw new RecordSkip("unknown-card-shape", null);

  if (hasBasic) {
    return { kind: "basic", front: requiredText(entry, "front"), back: requiredText(entry, "back") };
  }
  const clozeText = requiredText(entry, "clozeText");
  // Core's own reader of the `{{…}}` grammar, not a second one: a template with
  // no deletion renders no card at all, so it is named here rather than
  // becoming an empty row nobody asked for.
  if (findClozeRuns(clozeText).length === 0) throw new RecordSkip("no-cloze-deletion", "clozeText");
  return { kind: "cloze", clozeText };
}

function present(entry: Record<string, unknown>, key: string): boolean {
  return entry[key] !== undefined && entry[key] !== null;
}

// --- Translation into a plan --------------------------------------------------

/**
 * The source-side id every planned card's deck points at (ADR-052's seam,
 * reused). Deterministic rather than minted, because this module is pure: for
 * an EXISTING deck the planner pre-populates its id map with this one entry, so
 * every card lands in the deck the user picked and no deck row is created at
 * all — and for a NEW one this is simply the planned deck row's own name, which
 * the planner mints over like any other row's.
 */
export const LLM_DECK_SOURCE_ID = "llm:deck";

/**
 * The source-side id a NEW deck's subject points at — `APKG_SUBJECT_SOURCE_ID`'s
 * twin, one module over. Only ever seeded, never planned: a new deck lives
 * under a subject the profile already has (the screen offers no way to invent
 * one here), so the planner resolves this name onto that subject and no subject
 * row is created.
 */
export const LLM_SUBJECT_SOURCE_ID = "llm:subject";

/**
 * Where imported cards land (IMEX-005): a deck the profile already has, or one
 * this import names into being under an existing subject. `ApkgSubjectChoice`'s
 * shape, one level down — a deck cannot exist outside a subject, so the new arm
 * has to say which one.
 */
export type LlmDeckChoice =
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string; subjectId: string };

export interface LlmTranslateTarget {
  /** The profile every row is stamped with. */
  profileId: string;
  /** ISO-8601, injected: this module reads no clock. Every row's `createdAt`/`updatedAt`, and every fresh card's `due`. */
  now: string;
  /** The deck cards land in. Required for `"cards"` and ignored otherwise — an LLM answer names no deck, so this is a decision only the user can make. */
  deck: LlmDeckChoice | null;
}

export interface LlmTranslation {
  /** Ready for `planForeignImport`, whose id map re-mints every id below. */
  data: ProfileData;
  /** `ForeignImportTarget.seededIds` — one entry for a card import (the deck the user picked, or the new deck's subject), empty otherwise. */
  seededIds: ReadonlyMap<string, string>;
  /** How many ROWS the plan creates. Not the record count: one cloze template becomes one card per deletion, and a new deck is a row of its own. */
  planned: number;
}

/**
 * Turns accepted records into the profile data an import inserts.
 *
 * The shape of the answer is deliberately narrow, exactly as `translateApkg`'s
 * is: one kind touches one table, and every other member of `ProfileData` is
 * planned empty. Written as one object literal typed `ProfileData` for the
 * reason `planForeignImport`'s pass 2 is — a member added to that interface
 * later fails to compile here rather than silently arriving absent.
 *
 * Tasks are planned with `listId: null`, which the planner reads as "the target
 * profile's own default list" (`mappedList`) — the same reading a restore of a
 * pre-ADR-029 archive gets, and the only honest one: an answer typed into a
 * chat window names no list.
 */
export function translateLlmRecords(
  parsed: LlmRecords,
  target: LlmTranslateTarget,
): LlmTranslation {
  const tasks: ExportTask[] = [];
  const events: ExportEvent[] = [];
  const cards: ExportCard[] = [];
  const decks: ExportDeck[] = [];
  let seededIds: ReadonlyMap<string, string> = new Map();

  switch (parsed.kind) {
    case "tasks": {
      // The whole batch is laid out in one pass — every accepted record
      // becomes exactly one task, no row is skipped after this point — so a
      // precomputed `rankSequence` is the right tool, one rank per index,
      // rather than a running `rankAfter` threaded through the loop.
      const ranks = rankSequence(parsed.records.length);
      parsed.records.forEach((record, index) => {
        tasks.push({
          id: `llm:task:${index}`,
          profileId: target.profileId,
          parentId: null,
          title: record.title,
          description: record.description,
          status: "todo",
          priority: record.priority,
          done: false,
          dueDate: record.dueDate,
          startDate: null,
          createdAt: target.now,
          updatedAt: target.now,
          completedAt: null,
          // An imported task is a one-off with no ladder: a recurrence rule and
          // a reminder schedule are decisions the user makes in the app, and
          // inventing either from a sentence would be this import scheduling
          // notifications nobody asked for.
          recurrence: null,
          reminderOffsets: [],
          listId: null,
          sectionId: null,
          rank: ranks[index] as string,
        });
      });
      break;
    }
    case "events":
      parsed.records.forEach((record, index) => {
        events.push({
          id: `llm:event:${index}`,
          profileId: target.profileId,
          title: record.title,
          description: record.description,
          startAt: record.startAt,
          endAt: record.endAt,
          allDay: record.allDay,
          location: record.location,
          // The calendar's category is a colour the user assigns, not a fact in
          // the text — so it is left unset rather than guessed at.
          category: null,
          createdAt: target.now,
          updatedAt: target.now,
          recurrence: null,
          recurrenceExdates: [],
          reminderOffsets: [],
        });
      });
      break;
    case "cards": {
      const deck = target.deck;
      if (deck === null) {
        throw new Error("An LLM card import needs a deck for the cards to land in.");
      }
      if (deck.kind === "existing") {
        // ADR-052's seam: the planner resolves `llm:deck` onto the picked row
        // and no deck row is created at all.
        seededIds = new Map([[LLM_DECK_SOURCE_ID, deck.id]]);
      } else {
        // A NEW deck is a planned ROW, not a seam: the planner mints its id
        // exactly as it mints every card's, and only the SUBJECT is seeded —
        // a deck cannot exist outside one, and the screen offers no way to
        // invent a subject here.
        seededIds = new Map([[LLM_SUBJECT_SOURCE_ID, deck.subjectId]]);
        decks.push({
          id: LLM_DECK_SOURCE_ID,
          profileId: target.profileId,
          subjectId: LLM_SUBJECT_SOURCE_ID,
          name: deck.name,
          createdAt: target.now,
          updatedAt: target.now,
        });
      }
      const scheduling = freshCardScheduling(target.now);
      parsed.records.forEach((record, index) => {
        if (record.kind === "basic") {
          cards.push({
            id: `llm:card:${index}`,
            profileId: target.profileId,
            deckId: LLM_DECK_SOURCE_ID,
            front: record.front,
            back: record.back,
            sourceNoteId: null,
            sourceBlockKey: null,
            kind: "basic",
            clozeText: null,
            clozeOrdinal: null,
            problemSteps: null,
            ...scheduling,
          });
          return;
        }
        // One card per deletion NUMBER, rendered by core's own
        // `renderClozeCard` — the same function `CardStore` re-derives a cloze
        // row's sides with, so an imported cloze card and a hand-written one
        // are the same row the moment they land.
        for (const ordinal of clozeNumbers(findClozeRuns(record.clozeText))) {
          const rendered = renderClozeCard(record.clozeText, ordinal);
          // Unreachable: the number came from `findClozeRuns` over this very
          // text. Kept because `renderClozeCard`'s null IS the contract, and a
          // `?? ""` here would write a blank card rather than skip one.
          if (rendered === null) continue;
          cards.push({
            id: `llm:card:${index}:${ordinal}`,
            profileId: target.profileId,
            deckId: LLM_DECK_SOURCE_ID,
            front: rendered.front,
            back: rendered.back,
            sourceNoteId: null,
            sourceBlockKey: null,
            kind: "cloze",
            clozeText: record.clozeText,
            clozeOrdinal: ordinal,
            problemSteps: null,
            ...scheduling,
          });
        }
      });
      break;
    }
  }

  const data: ProfileData = {
    tasks,
    taskLists: [],
    taskSections: [],
    taskTags: [],
    taskTagLinks: [],
    taskAttachments: [],
    taskTemplates: [],
    taskDependencies: [],
    events,
    eventTemplates: [],
    documents: [],
    renewals: [],
    people: [],
    calendarSettings: [],
    subjects: [],
    subjectAttachments: [],
    subjectNoteLinks: [],
    exams: [],
    decks,
    cards,
    // No history crosses: an imported card is a new card (see `freshCardScheduling`).
    reviewLog: [],
    // An LLM paste carries content rows, never an exam's curriculum (ADR-063).
    examTopics: [],
    plans: [],
    blocks: [],
    focusSessions: [],
    studySettings: [],
    notifications: [],
    notes: [],
    noteFolders: [],
    noteTags: [],
    noteCategories: [],
    noteTagLinks: [],
    noteTemplates: [],
    noteAttachments: [],
    noteVersions: [],
    dashboardSettings: [],
    dashboardSets: [],
    dashboardWidgets: [],
    // The LLM extraction produces tasks, events and notes; a ledger row is not
    // something a model may invent about somebody's money (migration 051).
    finAccounts: [],
    finCategories: [],
    finRecurring: [],
    finTransactions: [],
    finBudgets: [],
    // Nor a habit (migration 055): a streak is a record of what somebody
    // actually did, and inventing days they never ticked is the one thing this
    // extraction must never do.
    habits: [],
    habitEntries: [],
    // Nor a food log (migration 058), for the habit reason exactly: a diary is a
    // record of what somebody actually ate, and inventing meals is the one thing
    // this extraction must never do.
    fitFoods: [],
    fitMealItems: [],
    fitTargets: [],
    // Nor a training log (migration 060), for the same reason: a workout is a
    // record of what somebody actually lifted, and inventing sessions is the
    // one thing this extraction must never do.
    fitExercises: [],
    fitRoutines: [],
    fitRoutineItems: [],
    fitWorkouts: [],
    fitWorkoutSets: [],
    fitMeasurements: [],
    fitBodyProfile: [],
    canvasBoards: [],
    circuits: [],
    circuitChassis: [],
    circuitParts: [],
    circuitWires: [],
    // No kit-module data: a translator produces rows for the collections it
    // understands, and a module's own payload is written by that module
    // (ADR-090). Empty here, on every other field's terms.
    modules: [],
  };

  return { data, seededIds, planned: tasks.length + events.length + cards.length + decks.length };
}

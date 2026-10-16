/**
 * The STUDY module: subjects, their exams and exam topics, decks and cards, the
 * review queue, the study plan and the three study settings.
 *
 * **Grading is not a tool.** Whether a card was remembered is the user's own
 * judgement, so `study.due` lists what is waiting and the review happens on the
 * page; the tool answers with a `navigateTo` to the study page.
 *
 * **Deleting a subject does what the page's delete does.** `subjects:delete`
 * marks the subject row alone, and so does the tool: its exams and decks stay as
 * they are, and a restore brings the subject back to them.
 *
 * **Names are accepted where a row has one.** Subjects, decks, topics and cards
 * resolve by id or by name, ignoring case and diacritics. An exam has no name of
 * its own, so it resolves by id, or by its subject's name when that subject has
 * exactly one exam. An ambiguous reference is refused with the ids it could be.
 */

import type Database from "better-sqlite3-multiple-ciphers";
import {
  CardStore,
  DeckStore,
  EXAM_TYPES,
  ExamStore,
  MAX_NEW_PER_DAY,
  MAX_REVIEWS_PER_DAY,
  MAX_TARGET_RETENTION,
  MIN_TARGET_RETENTION,
  NoteStore,
  PlanStore,
  SUBJECT_COLORS,
  StatsStore,
  StudySettingsStore,
  SubjectNoteLinkStore,
  SubjectStore,
  TopicStore,
} from "@nexus/db";
import type {
  Card,
  CreateExamInput,
  CreateSubjectInput,
  EffectiveExamTopic,
  Exam,
  ExamType,
  StudyPlan,
  StudySettings,
  Subject,
  UpdateCardFields,
  UpdateExamFields,
  UpdateSubjectFields,
} from "@nexus/db";
import { foldSearchText, MAX_ID_LENGTH } from "@nexus/core";
import type { AssistantLocale, Tool } from "@nexus/core";
import {
  asArgs,
  asCount,
  asDay,
  asEnum,
  asIdentifier,
  asOptionalCount,
  asOptionalDay,
  asOptionalEnum,
  asOptionalNumber,
  asOptionalText,
  asText,
} from "./args.js";
import {
  assertLive,
  clampText,
  confirmOrDecline,
  formatDayInSentence,
  formatPercent,
  guard,
  localDay,
  okResult,
  phrase,
  quote,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface StudyToolDeps {
  readonly profileDb: ProfileDb;
  readonly now: () => number;
}

interface Bilingual {
  readonly sr: string;
  readonly en: string;
}

/**
 * The longest name a subject, deck or topic may carry. The deck and topic stores
 * cap a name at 200 characters; the tool applies that ceiling to all three so a
 * model's argument is refused before a store sees it. A policy choice, not a
 * measurement.
 */
const MAX_NAME_CHARS = 200;

/** The longest text a card side, a cloze template or an exam scope may carry. The card store caps a side at 10000 characters; an exam scope at 1000 is a policy choice. */
const MAX_CARD_CHARS = 10000;
const MAX_SCOPE_CHARS = 1000;

/** How many cards a listing prints before it says that more exist. A policy choice, so a long deck does not flood the model's context. */
const CARD_LIST_LIMIT = 20;

/** How many due cards the review queue prints by name; its total is always stated. A policy choice. */
const QUEUE_PREVIEW = 10;

/** The window the plan's adherence is read over, in days ending today. A policy choice, not a measurement. */
const ADHERENCE_WINDOW_DAYS = 30;

/** How much of a card's text a confirmation quotes before it cuts it short. A policy choice. */
const PREVIEW_CHARS = 80;

const DAY_MS = 86_400_000;

/** One kind of thing a reference can name, with the words each sentence needs for it. */
interface Noun {
  readonly sr: { readonly gen: string; readonly many: string };
  readonly en: { readonly one: string; readonly many: string };
}

const NOUN = {
  subject: { sr: { gen: "predmeta", many: "predmeta" }, en: { one: "subject", many: "subjects" } },
  exam: { sr: { gen: "ispita", many: "ispita" }, en: { one: "exam", many: "exams" } },
  deck: { sr: { gen: "špila", many: "špilova" }, en: { one: "deck", many: "decks" } },
  card: { sr: { gen: "kartice", many: "kartica" }, en: { one: "card", many: "cards" } },
  topic: { sr: { gen: "teme", many: "tema" }, en: { one: "topic", many: "topics" } },
  note: { sr: { gen: "beleške", many: "beleški" }, en: { one: "note", many: "notes" } },
} satisfies Record<string, Noun>;

const NAME_NOT_FOUND: AssistantPhrase<[noun: Noun, wanted: string, known: string]> = {
  sr: (noun, wanted, known) =>
    known === ""
      ? `Nema ${noun.sr.gen} „${wanted}“.`
      : `Nema ${noun.sr.gen} „${wanted}“. Postoje: ${known}.`,
  en: (noun, wanted, known) =>
    known === ""
      ? `No ${noun.en.one} named “${wanted}”.`
      : `No ${noun.en.one} named “${wanted}”. Known: ${known}.`,
};

const NAME_AMBIGUOUS: AssistantPhrase<[noun: Noun, wanted: string, ids: string]> = {
  sr: (noun, wanted, ids) => `Ima više ${noun.sr.many} „${wanted}“ (${ids}). Navedi id.`,
  en: (noun, wanted, ids) => `More than one ${noun.en.one} is called “${wanted}” (${ids}). Use its id.`,
};

const EXAM_NOT_ONE: AssistantPhrase<[subject: string, count: number]> = {
  sr: (subject, count) =>
    count === 0
      ? `Predmet „${subject}“ nema nijedan aktivan ispit.`
      : `Predmet „${subject}“ ima ${count} ispita. Navedi id ispita.`,
  en: (subject, count) =>
    count === 0
      ? `The subject “${subject}” has no active exam.`
      : `The subject “${subject}” has ${count} exams. Name the exam by its id.`,
};

const NOTHING_TO_CHANGE: Bilingual = {
  sr: "Nije navedeno šta treba promeniti.",
  en: "Nothing was given to change.",
};

const NEEDS_FIELD: AssistantPhrase<[action: string, field: string]> = {
  sr: (action, field) => `Radnja „${action}“ traži polje „${field}“.`,
  en: (action, field) => `The “${action}” action needs the “${field}” field.`,
};

/** The label a result line starts with: what happened, said as a bare noun so it reads for either gender. */
const LABEL: Record<"created" | "changed" | "deleted" | "restored" | "linked" | "unlinked" | "added" | "moved", Bilingual> = {
  created: { sr: "Napravljeno", en: "Created" },
  changed: { sr: "Izmenjeno", en: "Changed" },
  deleted: { sr: "Obrisano", en: "Deleted" },
  restored: { sr: "Vraćeno", en: "Restored" },
  linked: { sr: "Povezano", en: "Linked" },
  unlinked: { sr: "Odvojeno", en: "Unlinked" },
  added: { sr: "Dodato", en: "Added" },
  moved: { sr: "Premešteno", en: "Moved" },
};

/** Every line a result prints after a change: its label, what changed, and the id a follow-up call needs. */
function labeled(locale: AssistantLocale, label: Bilingual, what: string): string {
  return `${label[locale]}: ${what}.`;
}

const NO_SUBJECTS: Bilingual = { sr: "Nema nijednog predmeta.", en: "There are no subjects." };
const NO_EXAMS: Bilingual = { sr: "Nema nijednog ispita.", en: "There are no exams." };
const NO_DECKS: Bilingual = { sr: "Nema nijednog špila.", en: "There are no decks." };
const NO_TOPICS: Bilingual = { sr: "Ovaj ispit nema nijednu temu.", en: "This exam has no topics." };
const NO_CARDS: Bilingual = { sr: "Ovaj špil nema nijednu karticu.", en: "This deck has no cards." };
const NO_PLANS: Bilingual = { sr: "Nema aktivnih planova učenja.", en: "There are no active study plans." };
const NOTHING_DUE: Bilingual = { sr: "Nema kartica na redu za pregled.", en: "No cards are due for review." };
const CAP_REACHED: Bilingual = {
  sr: "Dnevna granica pregleda je dostignuta; ostatak čeka sutra.",
  en: "The daily review cap is reached; the rest waits for tomorrow.",
};

const SETTINGS_CHANGE: AssistantPhrase<[changes: string]> = {
  sr: (changes) => `Promeni podešavanja učenja: ${changes}`,
  en: (changes) => `Change the study settings: ${changes}`,
};

const EXAM_TYPE: Record<ExamType, Bilingual> = {
  pismeni: { sr: "pismeni ispit", en: "written exam" },
  usmeni: { sr: "usmeni ispit", en: "oral exam" },
  kolokvijum: { sr: "kolokvijum", en: "midterm" },
};

const CARD_KIND: Record<"basic" | "cloze" | "problem", Bilingual> = {
  basic: { sr: "osnovna", en: "basic" },
  cloze: { sr: "rupe", en: "cloze" },
  problem: { sr: "zadatak", en: "problem" },
};

const FIELD: Record<"name" | "color" | "semester" | "retention" | "subject" | "type" | "date" | "scope", Bilingual> = {
  name: { sr: "ime", en: "name" },
  color: { sr: "boja", en: "colour" },
  semester: { sr: "semestar", en: "semester" },
  retention: { sr: "zadržavanje", en: "retention" },
  subject: { sr: "predmet", en: "subject" },
  type: { sr: "vrsta", en: "type" },
  date: { sr: "datum", en: "date" },
  scope: { sr: "obim", en: "scope" },
};

const SETTING: Record<"targetRetention" | "newPerDay" | "maxReviewsPerDay", Bilingual> = {
  targetRetention: { sr: "zadržavanje", en: "retention" },
  newPerDay: { sr: "nove kartice dnevno", en: "new cards a day" },
  maxReviewsPerDay: { sr: "pregledi dnevno", en: "reviews a day" },
};

const SUBJECT_ACTIONS = ["create", "update", "delete", "restore", "link-note", "unlink-note"] as const;
const EXAM_ACTIONS = ["create", "update", "delete", "restore"] as const;
const TOPIC_ACTIONS = ["add", "rank", "confidence", "deck", "delete"] as const;
const DECK_ACTIONS = ["create", "rename", "move", "delete", "restore"] as const;
const CARD_ACTIONS = ["create", "create-cloze", "create-problem", "update", "delete", "restore"] as const;

const SUBJECT_LABEL: Record<"exams" | "decks" | "next", Bilingual> = {
  exams: { sr: "ispita", en: "exams" },
  decks: { sr: "špilova", en: "decks" },
  next: { sr: "sledeći ispit", en: "next exam" },
};

const SUBJECT_CREATE: AssistantPhrase<[name: string]> = {
  sr: (name) => `Napravi predmet ${name}.`,
  en: (name) => `Create the subject ${name}.`,
};

const SUBJECT_RESTORE: AssistantPhrase<[id: string]> = {
  sr: (id) => `Vrati predmet ${id}.`,
  en: (id) => `Restore the subject ${id}.`,
};

const SUBJECT_UPDATE: AssistantPhrase<[name: string, fields: string]> = {
  sr: (name, fields) => `Izmeni predmet ${name}: ${fields}.`,
  en: (name, fields) => `Change the subject ${name}: ${fields}.`,
};

const SUBJECT_DELETE: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obriši predmet ${name}.`,
  en: (name) => `Delete the subject ${name}.`,
};

const NOTE_LINK: AssistantPhrase<[note: string, subject: string]> = {
  sr: (note, subject) => `Poveži belešku ${note} sa predmetom ${subject}.`,
  en: (note, subject) => `Link the note ${note} to the subject ${subject}.`,
};

const NOTE_UNLINK: AssistantPhrase<[note: string, subject: string]> = {
  sr: (note, subject) => `Odvoji belešku ${note} od predmeta ${subject}.`,
  en: (note, subject) => `Unlink the note ${note} from the subject ${subject}.`,
};

const EXAM_PASSED: Bilingual = { sr: "prošao", en: "passed" };
const EXAM_LEFT: Bilingual = { sr: "preostalo dana:", en: "days left:" };

const EXAM_RESTORE: AssistantPhrase<[id: string]> = {
  sr: (id) => `Vrati ispit ${id}.`,
  en: (id) => `Restore the exam ${id}.`,
};

const EXAM_CREATE: AssistantPhrase<[type: string, subject: string, day: string]> = {
  sr: (type, subject, day) => `Dodaj ispit: ${type} za predmet ${subject}, ${day}.`,
  en: (type, subject, day) => `Add the exam: ${type} for ${subject}, ${day}.`,
};

const EXAM_DELETE: AssistantPhrase<[exam: string]> = {
  sr: (exam) => `Obriši ispit ${exam}.`,
  en: (exam) => `Delete the exam ${exam}.`,
};

const EXAM_UPDATE: AssistantPhrase<[before: string, after: string]> = {
  sr: (before, after) => `Izmeni ispit ${before} → ${after}.`,
  en: (before, after) => `Change the exam ${before} → ${after}.`,
};

const TOPIC_ADD: AssistantPhrase<[name: string, exam: string]> = {
  sr: (name, exam) => `Dodaj temu ${name} na ispit ${exam}.`,
  en: (name, exam) => `Add the topic ${name} to the exam ${exam}.`,
};

const TOPIC_DELETE: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obriši temu ${name}.`,
  en: (name) => `Delete the topic ${name}.`,
};

const TOPIC_RANK: AssistantPhrase<[name: string, position: string]> = {
  sr: (name, position) => `Premesti temu ${name} na mesto ${position} po važnosti.`,
  en: (name, position) => `Move the topic ${name} to place ${position} in importance.`,
};

const TOPIC_CONFIDENCE: AssistantPhrase<[name: string, value: string]> = {
  sr: (name, value) => `Postavi pouzdanost za temu ${name} na ${value}.`,
  en: (name, value) => `Set the confidence for the topic ${name} to ${value}.`,
};

const TOPIC_DECK: AssistantPhrase<[name: string, deck: string]> = {
  sr: (name, deck) => `Poveži temu ${name} sa špilom ${deck}.`,
  en: (name, deck) => `Link the topic ${name} to the deck ${deck}.`,
};

const CONFIDENCE_UNKNOWN: Bilingual = { sr: "nepoznata", en: "unknown" };
const NO_DECK_LINK: Bilingual = { sr: "bez špila", en: "no deck" };
const DECK_GONE: Bilingual = { sr: "špil je obrisan", en: "the deck was deleted" };
const CONFIDENCE_LABEL: Bilingual = { sr: "pouzdanost", en: "confidence" };

/** A topic's confidence as a list line: the user's own figure, the deck's derived one, or that it is unknown or its deck is gone. */
function confidenceText(locale: AssistantLocale, topic: EffectiveExamTopic): string {
  if (topic.deckMissing) return text(locale, DECK_GONE);
  if (topic.effectiveConfidence === null) return `${CONFIDENCE_LABEL[locale]} ${text(locale, CONFIDENCE_UNKNOWN)}`;
  return `${CONFIDENCE_LABEL[locale]} ${topic.effectiveConfidence}`;
}

/** An exam's scope on create: a text, or nothing. */
function asScope(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : asText(value, "scope", MAX_SCOPE_CHARS);
}

/** An exam's scope on update: a text, an explicit null that clears it, or nothing to change. */
function asScopeChange(value: unknown): string | null | undefined {
  if (value === null) return null;
  return asOptionalText(value, "scope", MAX_SCOPE_CHARS);
}

const DECK_CREATE: AssistantPhrase<[name: string, subject: string]> = {
  sr: (name, subject) => `Napravi špil ${name} u predmetu ${subject}.`,
  en: (name, subject) => `Create the deck ${name} in the subject ${subject}.`,
};

const DECK_RENAME: AssistantPhrase<[from: string, to: string]> = {
  sr: (from, to) => `Preimenuj špil ${from} u ${to}.`,
  en: (from, to) => `Rename the deck ${from} to ${to}.`,
};

const DECK_MOVE: AssistantPhrase<[name: string, subject: string]> = {
  sr: (name, subject) => `Premesti špil ${name} u predmet ${subject}.`,
  en: (name, subject) => `Move the deck ${name} to the subject ${subject}.`,
};

const DECK_RESTORE: AssistantPhrase<[id: string]> = {
  sr: (id) => `Vrati špil ${id}.`,
  en: (id) => `Restore the deck ${id}.`,
};

const DECK_DELETE: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obriši špil ${name}.`,
  en: (name) => `Delete the deck ${name}.`,
};

const CARD_CREATE: AssistantPhrase<[deck: string, front: string]> = {
  sr: (deck, front) => `Dodaj karticu u špil ${deck}: ${front}.`,
  en: (deck, front) => `Add a card to the deck ${deck}: ${front}.`,
};

const CLOZE_CREATE: AssistantPhrase<[deck: string, template: string]> = {
  sr: (deck, template) => `Dodaj kartice sa rupama u špil ${deck}: ${template}.`,
  en: (deck, template) => `Add cloze cards to the deck ${deck}: ${template}.`,
};

const CLOZE_ADDED: AssistantPhrase<[count: number, deck: string]> = {
  sr: (count, deck) => `Dodato kartica u špil ${deck}: ${count}.`,
  en: (count, deck) => `Cards added to the deck ${deck}: ${count}.`,
};

const CARD_UPDATE: AssistantPhrase<[front: string]> = {
  sr: (front) => `Izmeni karticu ${front}.`,
  en: (front) => `Change the card ${front}.`,
};

const CARD_DELETE: AssistantPhrase<[front: string]> = {
  sr: (front) => `Obriši karticu ${front}.`,
  en: (front) => `Delete the card ${front}.`,
};

const CARD_RESTORE: AssistantPhrase<[id: string]> = {
  sr: (id) => `Vrati karticu ${id}.`,
  en: (id) => `Restore the card ${id}.`,
};

const DUE_HEADER: AssistantPhrase<[count: number]> = {
  sr: (count) => `Na redu za pregled: ${count}.`,
  en: (count) => `Due for review: ${count}.`,
};

const MORE_CARDS: AssistantPhrase<[count: number]> = {
  sr: (count) => `Još ${count} nije prikazano.`,
  en: (count) => `${count} more not shown.`,
};

const PLAN_WIDE: AssistantPhrase<[window: number, ratio: string, done: number, missed: number]> = {
  sr: (window, ratio, done, missed) =>
    `Plan i stvarnost, poslednjih ${window} dana: ${ratio} (završeno ${done}, propušteno ${missed}).`,
  en: (window, ratio, done, missed) =>
    `Plan against actual, last ${window} days: ${ratio} (done ${done}, missed ${missed}).`,
};

const PLAN_NO_RATIO: Bilingual = { sr: "još nema blokova za merenje", en: "no blocks to measure yet" };
const PLAN_PER_DAY: Bilingual = { sr: "min dnevno", en: "min a day" };
const PLAN_FROM: Bilingual = { sr: "od", en: "from" };

const SYNC_CONFIRM: Bilingual = {
  sr: "Uskladi planove učenja sa rasporedom ispita.",
  en: "Sync the study plans with the exam schedule.",
};

const NO_LIMIT: Bilingual = { sr: "bez ograničenja", en: "no limit" };

const SYNCED: AssistantPhrase<[exam: string, overflow: number, backlog: number]> = {
  sr: (exam, overflow, backlog) => `${exam}: preliv ${overflow} min, propušteno posle ispita ${backlog} min.`,
  en: (exam, overflow, backlog) => `${exam}: overflow ${overflow} min, missed after the exam ${backlog} min.`,
};

const SETTINGS_NOW: AssistantPhrase<[retention: string, newPerDay: string, reviews: string]> = {
  sr: (retention, newPerDay, reviews) =>
    `zadržavanje ${retention}; nove kartice dnevno ${newPerDay}; pregledi dnevno ${reviews}`,
  en: (retention, newPerDay, reviews) =>
    `retention ${retention}; new cards a day ${newPerDay}; reviews a day ${reviews}`,
};

/** A setting's value as the settings line and the confirmation print it. */
function settingsValues(locale: AssistantLocale, settings: StudySettings): Record<keyof typeof SETTING, string> {
  return {
    targetRetention: formatPercent(locale, settings.targetRetention),
    newPerDay: String(settings.newPerDay),
    maxReviewsPerDay: settings.maxReviewsPerDay === null ? text(locale, NO_LIMIT) : String(settings.maxReviewsPerDay),
  };
}

/** A row a reference can name: its id and the name the reference is matched against. */
interface Named {
  readonly id: string;
  readonly name: string;
}

/**
 * The one row a reference names: its id first, then its name ignoring case and
 * diacritics. A missing name is refused with the names that exist, and an
 * ambiguous one with the ids it could be, so the model can correct itself.
 */
function pickOne<T extends Named>(items: readonly T[], wanted: string, noun: Noun, locale: AssistantLocale): T {
  const byId = items.filter((item) => item.id === wanted);
  const needle = foldSearchText(wanted.trim());
  const matches = byId.length > 0 ? byId : items.filter((item) => foldSearchText(item.name.trim()) === needle);
  const [first] = matches;
  if (first === undefined) {
    const known = items.map((item) => item.name).join(", ");
    throw new Error(phrase(locale, NAME_NOT_FOUND, noun, wanted, known));
  }
  if (matches.length > 1) {
    throw new Error(phrase(locale, NAME_AMBIGUOUS, noun, wanted, matches.map((item) => item.id).join(", ")));
  }
  return first;
}

/**
 * An exam by id, or by its subject's name when that subject has exactly one
 * active exam. Anything else is refused, naming the count so the model asks for
 * the id instead.
 */
function pickExam(exams: readonly Exam[], subjects: readonly Subject[], wanted: string, locale: AssistantLocale): Exam {
  const byId = exams.find((exam) => exam.id === wanted);
  if (byId !== undefined) return byId;
  const subject = pickOne(subjects, wanted, NOUN.subject, locale);
  const own = exams.filter((exam) => exam.subjectId === subject.id);
  const [only] = own;
  if (own.length === 1 && only !== undefined) return only;
  throw new Error(phrase(locale, EXAM_NOT_ONE, subject.name, own.length));
}

/** A day as a count from the epoch, so two bare days subtract without a timezone in the way. */
function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / DAY_MS;
}

/** A day `count` days after `day`, as a bare day. */
function shiftDay(day: string, count: number): string {
  return new Date(dayNumber(day) * DAY_MS + count * DAY_MS).toISOString().slice(0, 10);
}

/** An exam as a person names it: „Analiza 1, pismeni ispit, 3. novembar 2026." — the sentence's own full stop is left to the caller. */
function examDescription(locale: AssistantLocale, exam: Exam, subjectName: string): string {
  return `${quote(locale, subjectName)}, ${EXAM_TYPE[exam.examType][locale]}, ${formatDayInSentence(locale, exam.examDate)}`;
}

/** A card's front as a confirmation quotes it: cut to a short preview, with a mark when it was cut. */
function preview(value: string): string {
  const cut = clampText(value, PREVIEW_CHARS);
  return cut.truncated ? `${cut.text}…` : cut.text;
}

/**
 * The keys a patch actually names. Under `exactOptionalPropertyTypes` an omitted
 * field must be absent rather than `undefined`, which is how the stores read a
 * partial update: an absent key is left as it is.
 */
function definedOnly<F>(value: { [K in keyof F]: F[K] | undefined }): F {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as F;
}

/** A number the model may clear: `null` means the value is unknown (or, for reviews a day, no limit). */
function asNullableCount(value: unknown, field: string, min: number, max: number): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return asOptionalCount(value, field, min, max) ?? null;
}

/** A subject's semester: a short label, or null to clear it. */
function asSemester(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return asText(value, "semester", MAX_NAME_CHARS);
}

/** The retention a subject or deck may carry: a fraction in the setting's window, or null for the profile's own. */
function asRetention(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return asOptionalNumber(value, "targetRetention", MIN_TARGET_RETENTION, MAX_TARGET_RETENTION) ?? null;
}

/** A deck's reference in a schema: its id or its name. */
const DECK_REF = {
  type: "string",
  minLength: 1,
  maxLength: MAX_ID_LENGTH,
  description: "The deck: its id as study.decks reports it, or its name.",
};

const DECK_COUNTS: Record<"new" | "due", Bilingual> = {
  new: { sr: "novih", en: "new" },
  due: { sr: "za pregled", en: "due" },
};

/** An exam's reference in a schema: its id, or its subject's name when that subject has one exam. */
const EXAM_REF = {
  type: "string",
  minLength: 1,
  maxLength: MAX_ID_LENGTH,
  description: "The exam: its id as study.exams reports it, or its subject's name when that subject has exactly one exam.",
};

export function studyTools(deps: StudyToolDeps): readonly Tool[] {
  const open = <T>(profileId: string, body: (db: Database.Database, id: string) => T): T =>
    deps.profileDb(profileId, body);

  /** The exam a reference names, with the sentence a confirmation calls it by. */
  function resolveExam(profileId: string, wanted: string, locale: AssistantLocale): { id: string; label: string } {
    return open(profileId, (db, id) => {
      const subjects = new SubjectStore(db, id).listActive();
      const exam = pickExam(new ExamStore(db, id).listActive(), subjects, wanted, locale);
      const subjectName = subjects.find((row) => row.id === exam.subjectId)?.name ?? exam.subjectId;
      return { id: exam.id, label: examDescription(locale, exam, subjectName) };
    });
  }

  const subjectsTool: Tool = {
    name: "study.subjects",
    description: {
      sr: "Prikazuje predmete sa brojem ispita i špilova i datumom sledećeg ispita. Koristi ga kada korisnik pita koje predmete ima ili pre nego što nešto izmeni na predmetu.",
      en: "Lists the subjects with their exam and deck counts and the next exam date. Use it when the user asks which subjects they have, or before changing one.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const { locale } = context;
        const today = localDay(deps.now());
        const rows = open(context.profileId, (db, id) => {
          const exams = new ExamStore(db, id).listActive();
          const decks = new DeckStore(db, id).listActive();
          return new SubjectStore(db, id).listActive().map((subject) => ({
            subject,
            exams: exams.filter((exam) => exam.subjectId === subject.id),
            decks: decks.filter((deck) => deck.subjectId === subject.id).length,
          }));
        });
        if (rows.length === 0) return okResult(text(locale, NO_SUBJECTS));
        const lines = rows.map(({ subject, exams, decks }) => {
          const next = exams.find((exam) => exam.examDate >= today);
          const parts = [
            `${SUBJECT_LABEL.exams[locale]} ${exams.length}`,
            `${SUBJECT_LABEL.decks[locale]} ${decks}`,
            next === undefined ? null : `${SUBJECT_LABEL.next[locale]} ${formatDayInSentence(locale, next.examDate)}`,
          ].filter((part): part is string => part !== null);
          return `- ${subject.id} ${subject.name}: ${parts.join(", ")}`;
        });
        return okResult(lines.join("\n"), { navigateTo: { module: "study" } });
      }),
  };

  const subjectTool: Tool = {
    name: "study.subject",
    description: {
      sr: "Pravi, menja, briše, vraća predmet ili povezuje belešku sa predmetom. Brisanje predmeta briše i njegove ispite i špilove. Koristi ga kada korisnik kaže „napravi predmet“, „preimenuj predmet“, „obriši predmet“ ili „poveži belešku sa predmetom“.",
      en: "Creates, changes, deletes or restores a subject, or links a note to one. Deleting a subject also deletes its exams and decks. Use it when the user says \"add a subject\", \"rename the subject\", \"delete the subject\" or \"link this note to the subject\".",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...SUBJECT_ACTIONS], description: "What to do with the subject." },
        subject: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The subject: its id as study.subjects reports it, or its name. For restore, the id a delete reported.",
        },
        name: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The name for create, or the new name for update." },
        color: { type: "string", enum: [...SUBJECT_COLORS], description: "The subject's colour." },
        semester: { type: ["string", "null"], maxLength: MAX_NAME_CHARS, description: "The semester label, or null to clear it." },
        targetRetention: {
          type: ["number", "null"],
          minimum: MIN_TARGET_RETENTION,
          maximum: MAX_TARGET_RETENTION,
          description: "This subject's own retention, 0.7 to 0.97, or null to use the profile's.",
        },
        note: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "For link-note and unlink-note: the note's id or its exact title.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const { locale } = context;
        const action = asEnum(args.action, "action", SUBJECT_ACTIONS);
        const nowIso = new Date(deps.now()).toISOString();

        if (action === "create") {
          const name = asText(args.name, "name", MAX_NAME_CHARS);
          const color = asOptionalEnum(args.color, "color", SUBJECT_COLORS);
          const semester = asSemester(args.semester);
          const targetRetention = asRetention(args.targetRetention);
          const declined = await confirmOrDecline(context, "study.subject", "write", phrase(locale, SUBJECT_CREATE, quote(locale, name)));
          if (declined !== null) return declined;
          const created = open(context.profileId, (db, id) =>
            new SubjectStore(db, id).create(definedOnly<CreateSubjectInput>({ name, color, semester, targetRetention })),
          );
          return okResult(labeled(locale, LABEL.created, `${quote(locale, created.name)} (id ${created.id})`), {
            navigateTo: { module: "study" },
          });
        }

        if (action === "restore") {
          const id = asIdentifier(args.subject, "subject");
          const declined = await confirmOrDecline(context, "study.subject", "write", phrase(locale, SUBJECT_RESTORE, id));
          if (declined !== null) return declined;
          open(context.profileId, (db, profileId) => new SubjectStore(db, profileId).restore(id));
          return okResult(labeled(locale, LABEL.restored, `id ${id}`), { navigateTo: { module: "study" } });
        }

        const subject = open(context.profileId, (db, id) =>
          pickOne(new SubjectStore(db, id).listActive(), asIdentifier(args.subject, "subject"), NOUN.subject, locale),
        );

        if (action === "update") {
          const changes = {
            name: asOptionalText(args.name, "name", MAX_NAME_CHARS),
            color: asOptionalEnum(args.color, "color", SUBJECT_COLORS),
            semester: asSemester(args.semester),
            targetRetention: asRetention(args.targetRetention),
          };
          const changed = (Object.keys(changes) as (keyof typeof changes)[]).filter((key) => changes[key] !== undefined);
          if (changed.length === 0) throw new Error(text(locale, NOTHING_TO_CHANGE));
          const fields = changed.map((key) => FIELD[key === "targetRetention" ? "retention" : key][locale]).join(", ");
          const declined = await confirmOrDecline(context, "study.subject", "write", phrase(locale, SUBJECT_UPDATE, quote(locale, subject.name), fields));
          if (declined !== null) return declined;
          const updated = open(context.profileId, (db, id) =>
            new SubjectStore(db, id).update(subject.id, definedOnly<UpdateSubjectFields>(changes)),
          );
          return okResult(labeled(locale, LABEL.changed, `${quote(locale, updated.name)} (id ${updated.id})`), {
            navigateTo: { module: "study" },
          });
        }

        if (action === "delete") {
          const declined = await confirmOrDecline(context, "study.subject", "write", phrase(locale, SUBJECT_DELETE, quote(locale, subject.name)));
          if (declined !== null) return declined;
          open(context.profileId, (db, id) => new SubjectStore(db, id).softDelete(subject.id));
          return okResult(labeled(locale, LABEL.deleted, `${quote(locale, subject.name)} (id ${subject.id})`), {
            navigateTo: { module: "study" },
          });
        }

        // link-note and unlink-note: the note is an active one, named by id or title.
        const noteRef = asIdentifier(args.note, "note");
        const notes = open(context.profileId, (db, id) => new NoteStore(db, id).list());
        const note = pickOne(
          notes.map((row) => ({ id: row.id, name: row.title })),
          noteRef,
          NOUN.note,
          locale,
        );
        const linking = action === "link-note";
        const declined = await confirmOrDecline(
          context,
          "study.subject",
          "write",
          phrase(locale, linking ? NOTE_LINK : NOTE_UNLINK, quote(locale, note.name), quote(locale, subject.name)),
        );
        if (declined !== null) return declined;
        open(context.profileId, (db, id) => {
          const links = new SubjectNoteLinkStore(db, id);
          if (linking) links.linkNote(subject.id, note.id, nowIso);
          else links.unlinkNote(subject.id, note.id);
        });
        return okResult(labeled(locale, linking ? LABEL.linked : LABEL.unlinked, `${quote(locale, note.name)} – ${quote(locale, subject.name)}`), {
          navigateTo: { module: "study" },
        });
      }),
  };

  const examsTool: Tool = {
    name: "study.exams",
    description: {
      sr: "Prikazuje ispite svih predmeta, po datumu, sa preostalim danima. Koristi ga kada korisnik pita kada su ispiti ili koliko još ima do njih.",
      en: "Lists every exam by date with the days left. Use it when the user asks when their exams are or how long until one.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const { locale } = context;
        const today = localDay(deps.now());
        const { exams, subjects } = open(context.profileId, (db, id) => ({
          exams: new ExamStore(db, id).listActive(),
          subjects: new SubjectStore(db, id).listActive(),
        }));
        if (exams.length === 0) return okResult(text(locale, NO_EXAMS));
        const lines = exams.map((exam) => {
          const subject = subjects.find((row) => row.id === exam.subjectId);
          const name = subject?.name ?? exam.subjectId;
          const left = dayNumber(exam.examDate) - dayNumber(today);
          const when = left < 0 ? EXAM_PASSED[locale] : `${EXAM_LEFT[locale]} ${left}`;
          return `- ${exam.id} ${examDescription(locale, exam, name)} (${when})`;
        });
        return okResult(lines.join("\n"), { navigateTo: { module: "study" } });
      }),
  };

  const examTool: Tool = {
    name: "study.exam",
    description: {
      sr: "Pravi, menja, briše ili vraća ispit: predmet, vrstu, datum i obim gradiva. Koristi ga kada korisnik kaže „napravi ispit“, „ispit je pomeren“ ili „obriši ispit“.",
      en: "Adds, changes, deletes or restores an exam: its subject, type, date and scope. Use it when the user says \"add an exam\", \"the exam moved\" or \"delete the exam\".",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...EXAM_ACTIONS], description: "What to do with the exam." },
        exam: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "For update and delete: the exam's id, or its subject's name when that subject has one exam. For restore, the id a delete reported.",
        },
        subject: { type: "string", minLength: 1, maxLength: MAX_ID_LENGTH, description: "For create, and for update to move it: the subject's id or name." },
        type: { type: "string", enum: [...EXAM_TYPES], description: "pismeni (written), usmeni (oral) or kolokvijum (midterm)." },
        date: { type: "string", format: "date", description: "The exam day, YYYY-MM-DD." },
        scope: { type: ["string", "null"], maxLength: MAX_SCOPE_CHARS, description: "What the exam covers, or null to clear it." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const { locale } = context;
        const action = asEnum(args.action, "action", EXAM_ACTIONS);

        if (action === "restore") {
          const id = asIdentifier(args.exam, "exam");
          const declined = await confirmOrDecline(context, "study.exam", "write", phrase(locale, EXAM_RESTORE, id));
          if (declined !== null) return declined;
          open(context.profileId, (db, profileId) => new ExamStore(db, profileId).restore(id));
          return okResult(labeled(locale, LABEL.restored, `id ${id}`), { navigateTo: { module: "study" } });
        }

        if (action === "create") {
          const subjectRef = asIdentifier(args.subject, "subject");
          const type = asEnum(args.type, "type", EXAM_TYPES);
          const date = asDay(args.date, "date");
          const scope = asScope(args.scope);
          const { subject } = open(context.profileId, (db, id) => ({
            subject: pickOne(new SubjectStore(db, id).listActive(), subjectRef, NOUN.subject, locale),
          }));
          const declined = await confirmOrDecline(
            context,
            "study.exam",
            "write",
            phrase(locale, EXAM_CREATE, EXAM_TYPE[type][locale], quote(locale, subject.name), formatDayInSentence(locale, date)),
          );
          if (declined !== null) return declined;
          const created = open(context.profileId, (db, id) =>
            new ExamStore(db, id).create(definedOnly<CreateExamInput>({ subjectId: subject.id, examType: type, examDate: date, scope })),
          );
          return okResult(labeled(locale, LABEL.created, `${examDescription(locale, created, subject.name)} (id ${created.id})`), {
            navigateTo: { module: "study" },
          });
        }

        const { exam, subjects } = open(context.profileId, (db, id) => {
          const exams = new ExamStore(db, id).listActive();
          const subjectRows = new SubjectStore(db, id).listActive();
          return { exam: pickExam(exams, subjectRows, asIdentifier(args.exam, "exam"), locale), subjects: subjectRows };
        });
        const currentSubject = subjects.find((row) => row.id === exam.subjectId)?.name ?? exam.subjectId;

        if (action === "delete") {
          const declined = await confirmOrDecline(context, "study.exam", "write", phrase(locale, EXAM_DELETE, examDescription(locale, exam, currentSubject)));
          if (declined !== null) return declined;
          open(context.profileId, (db, id) => new ExamStore(db, id).softDelete(exam.id));
          return okResult(labeled(locale, LABEL.deleted, `${examDescription(locale, exam, currentSubject)} (id ${exam.id})`), {
            navigateTo: { module: "study" },
          });
        }

        // update: a partial patch; the subject can move the exam to another subject.
        const subjectRef = asOptionalText(args.subject, "subject", MAX_ID_LENGTH);
        const subjectId = subjectRef === undefined ? undefined : pickOne(subjects, subjectRef, NOUN.subject, locale).id;
        const type = asOptionalEnum(args.type, "type", EXAM_TYPES);
        const date = asOptionalDay(args.date, "date");
        const scope = asScopeChange(args.scope);
        if (subjectId === undefined && type === undefined && date === undefined && scope === undefined) {
          throw new Error(text(locale, NOTHING_TO_CHANGE));
        }
        const changes = { subjectId, examType: type, examDate: date, scope };
        const updatedExam = { ...exam, subjectId: subjectId ?? exam.subjectId, examType: type ?? exam.examType, examDate: date ?? exam.examDate };
        const declined = await confirmOrDecline(
          context,
          "study.exam",
          "write",
          phrase(locale, EXAM_UPDATE, examDescription(locale, exam, currentSubject), examDescription(locale, updatedExam, subjects.find((row) => row.id === updatedExam.subjectId)?.name ?? updatedExam.subjectId)),
        );
        if (declined !== null) return declined;
        const updated = open(context.profileId, (db, id) =>
          new ExamStore(db, id).update(exam.id, definedOnly<UpdateExamFields>(changes)),
        );
        return okResult(labeled(locale, LABEL.changed, `${examDescription(locale, updated, subjects.find((row) => row.id === updated.subjectId)?.name ?? updated.subjectId)} (id ${updated.id})`), {
          navigateTo: { module: "study" },
        });
      }),
  };

  const topicsTool: Tool = {
    name: "study.topics",
    description: {
      sr: "Prikazuje teme jednog ispita po važnosti, sa pouzdanošću i špilom. Koristi ga kada korisnik pita šta treba da uči za ispit ili koje su mu teme slabe.",
      en: "Lists one exam's topics in order of importance, with their confidence and deck. Use it when the user asks what to study for an exam or which topics are weak.",
    },
    parameters: { type: "object", properties: { exam: EXAM_REF }, required: ["exam"], additionalProperties: false },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const { locale } = context;
        const args = asArgs(rawArgs);
        const today = localDay(deps.now());
        const topics = open(context.profileId, (db, id) => {
          const exam = pickExam(new ExamStore(db, id).listActive(), new SubjectStore(db, id).listActive(), asIdentifier(args.exam, "exam"), locale);
          return new TopicStore(db, id).listEffectiveByExam(exam.id, today);
        });
        if (topics.length === 0) return okResult(text(locale, NO_TOPICS));
        const lines = topics.map((topic) => `- ${topic.rank + 1}. ${topic.id} ${topic.name} (${confidenceText(locale, topic)})`);
        return okResult(lines.join("\n"), { navigateTo: { module: "study" } });
      }),
  };

  const topicTool: Tool = {
    name: "study.topic",
    description: {
      sr: "Pravi temu ispitu, menja joj mesto po važnosti, pouzdanost ili špil, ili briše temu. Koristi ga kada korisnik kaže „nova tema“, „to je važnije“ ili „umem to, stavi 80“.",
      en: "Adds a topic to an exam, moves it in the order of importance, sets its confidence or deck, or deletes it. Use it when the user says \"add a topic\", \"this matters more\" or \"I know this, put it at 80\".",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...TOPIC_ACTIONS], description: "What to do with the topic." },
        exam: EXAM_REF,
        topic: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The topic: its id or its name. Not needed for add.",
        },
        name: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The name of a new topic." },
        position: {
          type: "integer",
          minimum: 1,
          maximum: 1000,
          description: "For rank: the new place in the exam's list, 1 being the most important.",
        },
        confidence: {
          type: ["integer", "null"],
          minimum: 0,
          maximum: 100,
          description: "For confidence: the user's own 0 to 100, or null to go back to the deck's figure.",
        },
        deck: { type: ["string", "null"], minLength: 1, maxLength: MAX_ID_LENGTH, description: "For deck: the deck's id or name, or null to unlink it." },
      },
      required: ["action", "exam"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const { locale } = context;
        const action = asEnum(args.action, "action", TOPIC_ACTIONS);
        const nowIso = new Date(deps.now()).toISOString();

        if (action === "add") {
          const name = asText(args.name, "name", MAX_NAME_CHARS);
          const exam = resolveExam(context.profileId, asIdentifier(args.exam, "exam"), locale);
          const declined = await confirmOrDecline(context, "study.topic", "write", phrase(locale, TOPIC_ADD, quote(locale, name), exam.label));
          if (declined !== null) return declined;
          const created = open(context.profileId, (db, id) => new TopicStore(db, id).create({ examId: exam.id, name }, nowIso));
          return okResult(labeled(locale, LABEL.added, `${quote(locale, created.name)} (id ${created.id})`), { navigateTo: { module: "study" } });
        }

        const exam = resolveExam(context.profileId, asIdentifier(args.exam, "exam"), locale);
        const { topic, count } = open(context.profileId, (db, id) => {
          const topics = new TopicStore(db, id).listByExam(exam.id);
          return { topic: pickOne(topics, asIdentifier(args.topic, "topic"), NOUN.topic, locale), count: topics.length };
        });

        if (action === "delete") {
          const declined = await confirmOrDecline(context, "study.topic", "write", phrase(locale, TOPIC_DELETE, quote(locale, topic.name)));
          if (declined !== null) return declined;
          open(context.profileId, (db, id) => new TopicStore(db, id).softDelete(topic.id, nowIso));
          return okResult(labeled(locale, LABEL.deleted, `${quote(locale, topic.name)} (id ${topic.id})`), { navigateTo: { module: "study" } });
        }

        if (action === "rank") {
          const position = asCount(args.position, "position", 1, Math.max(count, 1));
          const declined = await confirmOrDecline(context, "study.topic", "write", phrase(locale, TOPIC_RANK, quote(locale, topic.name), String(position)));
          if (declined !== null) return declined;
          open(context.profileId, (db, id) => new TopicStore(db, id).moveTopic(topic.id, position - 1, nowIso));
          return okResult(labeled(locale, LABEL.moved, `${quote(locale, topic.name)} → ${position}`), { navigateTo: { module: "study" } });
        }

        if (action === "confidence") {
          if (args.confidence === undefined) throw new Error(phrase(locale, NEEDS_FIELD, action, "confidence"));
          const confidence = args.confidence === null ? null : asCount(args.confidence, "confidence", 0, 100);
          const value = confidence === null ? text(locale, CONFIDENCE_UNKNOWN) : String(confidence);
          const declined = await confirmOrDecline(context, "study.topic", "write", phrase(locale, TOPIC_CONFIDENCE, quote(locale, topic.name), value));
          if (declined !== null) return declined;
          open(context.profileId, (db, id) => new TopicStore(db, id).setConfidence(topic.id, confidence, nowIso));
          return okResult(labeled(locale, LABEL.changed, `${quote(locale, topic.name)}: ${value}`), { navigateTo: { module: "study" } });
        }

        // deck: a deck's id or name, or null to unlink the topic.
        if (args.deck === undefined) throw new Error(phrase(locale, NEEDS_FIELD, action, "deck"));
        const deck = args.deck === null
          ? null
          : open(context.profileId, (db, id) => pickOne(new DeckStore(db, id).listActive(), asIdentifier(args.deck, "deck"), NOUN.deck, locale));
        const deckName = deck === null ? text(locale, NO_DECK_LINK) : quote(locale, deck.name);
        const declined = await confirmOrDecline(context, "study.topic", "write", phrase(locale, TOPIC_DECK, quote(locale, topic.name), deckName));
        if (declined !== null) return declined;
        open(context.profileId, (db, id) => new TopicStore(db, id).setDeck(topic.id, deck?.id ?? null, nowIso));
        return okResult(labeled(locale, LABEL.changed, `${quote(locale, topic.name)}: ${deckName}`), { navigateTo: { module: "study" } });
      }),
  };

  const decksTool: Tool = {
    name: "study.decks",
    description: {
      sr: "Prikazuje špilove sa predmetom i brojem novih i kartica za pregled. Koristi ga kada korisnik pita koji špilovi postoje ili šta je za pregled.",
      en: "Lists the decks with their subject and their new and due card counts. Use it when the user asks which decks exist or what is due.",
    },
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", minLength: 1, maxLength: MAX_ID_LENGTH, description: "Only the decks of this subject: its id or name." },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const { locale } = context;
        const nowIso = new Date(deps.now()).toISOString();
        const { decks, subjects, counts } = open(context.profileId, (db, id) => {
          const subjectRows = new SubjectStore(db, id).listActive();
          const deckRows = new DeckStore(db, id).listActive();
          const only = args.subject === undefined ? undefined : pickOne(subjectRows, asIdentifier(args.subject, "subject"), NOUN.subject, locale);
          return {
            decks: only === undefined ? deckRows : deckRows.filter((deck) => deck.subjectId === only.id),
            subjects: subjectRows,
            counts: new CardStore(db, id).countsByDeck(nowIso),
          };
        });
        if (decks.length === 0) return okResult(text(locale, NO_DECKS));
        const lines = decks.map((deck) => {
          const subjectName = subjects.find((row) => row.id === deck.subjectId)?.name ?? deck.subjectId;
          const count = counts.find((row) => row.deckId === deck.id);
          return `- ${deck.id} ${deck.name} (${subjectName}): ${DECK_COUNTS.new[locale]} ${count?.newCount ?? 0}, ${DECK_COUNTS.due[locale]} ${count?.dueCount ?? 0}`;
        });
        return okResult(lines.join("\n"), { navigateTo: { module: "study" } });
      }),
  };

  const deckTool: Tool = {
    name: "study.deck",
    description: {
      sr: "Pravi špil u predmetu, preimenuje ga, premešta u drugi predmet, briše ili vraća. Koristi ga kada korisnik kaže „napravi špil“, „preimenuj špil“ ili „obriši špil“.",
      en: "Creates a deck in a subject, renames it, moves it to another subject, deletes it or restores it. Use it when the user says \"make a deck\", \"rename the deck\" or \"delete the deck\".",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...DECK_ACTIONS], description: "What to do with the deck." },
        deck: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The deck: its id or its name. For restore, the id a delete reported.",
        },
        subject: { type: "string", minLength: 1, maxLength: MAX_ID_LENGTH, description: "For create, and for move: the subject's id or name." },
        name: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "For create, the deck's name; for rename, the new name." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const { locale } = context;
        const action = asEnum(args.action, "action", DECK_ACTIONS);

        if (action === "restore") {
          const id = asIdentifier(args.deck, "deck");
          const declined = await confirmOrDecline(context, "study.deck", "write", phrase(locale, DECK_RESTORE, id));
          if (declined !== null) return declined;
          open(context.profileId, (db, profileId) => new DeckStore(db, profileId).restore(id));
          return okResult(labeled(locale, LABEL.restored, `id ${id}`), { navigateTo: { module: "study" } });
        }

        if (action === "create") {
          const name = asText(args.name, "name", MAX_NAME_CHARS);
          const { subject } = open(context.profileId, (db, id) => ({
            subject: pickOne(new SubjectStore(db, id).listActive(), asIdentifier(args.subject, "subject"), NOUN.subject, locale),
          }));
          const declined = await confirmOrDecline(context, "study.deck", "write", phrase(locale, DECK_CREATE, quote(locale, name), quote(locale, subject.name)));
          if (declined !== null) return declined;
          const created = open(context.profileId, (db, id) => new DeckStore(db, id).create({ subjectId: subject.id, name }));
          return okResult(labeled(locale, LABEL.created, `${quote(locale, created.name)} (id ${created.id})`), { navigateTo: { module: "study" } });
        }

        const deck = open(context.profileId, (db, id) =>
          pickOne(new DeckStore(db, id).listActive(), asIdentifier(args.deck, "deck"), NOUN.deck, locale),
        );

        if (action === "rename") {
          const name = asText(args.name, "name", MAX_NAME_CHARS);
          const declined = await confirmOrDecline(context, "study.deck", "write", phrase(locale, DECK_RENAME, quote(locale, deck.name), quote(locale, name)));
          if (declined !== null) return declined;
          open(context.profileId, (db, id) => new DeckStore(db, id).update(deck.id, { name }));
          return okResult(labeled(locale, LABEL.changed, `${quote(locale, name)} (id ${deck.id})`), { navigateTo: { module: "study" } });
        }

        if (action === "move") {
          const { subject } = open(context.profileId, (db, id) => ({
            subject: pickOne(new SubjectStore(db, id).listActive(), asIdentifier(args.subject, "subject"), NOUN.subject, locale),
          }));
          const declined = await confirmOrDecline(context, "study.deck", "write", phrase(locale, DECK_MOVE, quote(locale, deck.name), quote(locale, subject.name)));
          if (declined !== null) return declined;
          open(context.profileId, (db, id) => new DeckStore(db, id).update(deck.id, { subjectId: subject.id }));
          return okResult(labeled(locale, LABEL.moved, `${quote(locale, deck.name)} → ${quote(locale, subject.name)}`), { navigateTo: { module: "study" } });
        }

        const declined = await confirmOrDecline(context, "study.deck", "write", phrase(locale, DECK_DELETE, quote(locale, deck.name)));
        if (declined !== null) return declined;
        open(context.profileId, (db, id) => new DeckStore(db, id).softDelete(deck.id));
        return okResult(labeled(locale, LABEL.deleted, `${quote(locale, deck.name)} (id ${deck.id})`), { navigateTo: { module: "study" } });
      }),
  };

  const cardsTool: Tool = {
    name: "study.cards",
    description: {
      sr: "Prikazuje kartice jednog špila sa vrstom i datumom sledećeg pregleda. Koristi ga kada korisnik pita šta je u špilu ili traži neku karticu.",
      en: "Lists one deck's cards with their kind and next review day. Use it when the user asks what a deck holds or looks for a card.",
    },
    parameters: {
      type: "object",
      properties: { deck: DECK_REF },
      required: ["deck"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const { locale } = context;
        const { cards } = open(context.profileId, (db, id) => {
          const deck = pickOne(new DeckStore(db, id).listActive(), asIdentifier(args.deck, "deck"), NOUN.deck, locale);
          return { cards: new CardStore(db, id).listByDeck(deck.id) };
        });
        if (cards.length === 0) return okResult(text(locale, NO_CARDS));
        const shown = cards.slice(0, CARD_LIST_LIMIT).map((card) => cardLine(locale, card));
        const rest = cards.length - shown.length;
        if (rest > 0) shown.push(phrase(locale, MORE_CARDS, rest));
        return okResult(shown.join("\n"), { navigateTo: { module: "study" } });
      }),
  };

  const cardTool: Tool = {
    name: "study.card",
    description: {
      sr: "Pravi karticu, karticu sa rupama ili problem u špilu, menja ili briše karticu, ili vraća obrisanu. Koristi ga kada korisnik kaže „napravi karticu“, „napravi kartice iz ovoga“ ili „obriši tu karticu“.",
      en: "Adds a card, a cloze card (with {{blanks}}) or a problem card to a deck, changes or deletes a card, or restores a deleted one. Use it when the user says \"add a card\", \"make cards from this\" or \"delete that card\".",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...CARD_ACTIONS], description: "What to do with the card." },
        deck: { ...DECK_REF, description: "The deck: its id or its name. Needed for every action but restore." },
        card: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "For update and delete: the card's id, or its exact front text in that deck. For restore, the id a delete reported.",
        },
        front: { type: "string", minLength: 1, maxLength: MAX_CARD_CHARS, description: "The front (question) of a card." },
        back: { type: "string", minLength: 1, maxLength: MAX_CARD_CHARS, description: "The back (answer) of a card." },
        text: {
          type: "string",
          minLength: 1,
          maxLength: MAX_CARD_CHARS,
          description: "For create-cloze: the sentence with each blank as {{word}}. One card is made per blank number.",
        },
        steps: {
          type: "string",
          minLength: 1,
          maxLength: MAX_CARD_CHARS,
          description: "For create-problem: the worked solution, one step per line.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const { locale } = context;
        const action = asEnum(args.action, "action", CARD_ACTIONS);
        const nowIso = new Date(deps.now()).toISOString();

        if (action === "restore") {
          const id = asIdentifier(args.card, "card");
          const declined = await confirmOrDecline(context, "study.card", "write", phrase(locale, CARD_RESTORE, id));
          if (declined !== null) return declined;
          open(context.profileId, (db, profileId) => new CardStore(db, profileId).restore(id));
          return okResult(labeled(locale, LABEL.restored, `id ${id}`), { navigateTo: { module: "study" } });
        }

        const deck = open(context.profileId, (db, id) =>
          pickOne(new DeckStore(db, id).listActive(), asIdentifier(args.deck, "deck"), NOUN.deck, locale),
        );

        if (action === "create") {
          const front = asText(args.front, "front", MAX_CARD_CHARS);
          const back = asText(args.back, "back", MAX_CARD_CHARS);
          const declined = await confirmOrDecline(context, "study.card", "write", phrase(locale, CARD_CREATE, quote(locale, deck.name), quote(locale, preview(front))));
          if (declined !== null) return declined;
          const created = open(context.profileId, (db, id) => new CardStore(db, id).create({ deckId: deck.id, front, back }, nowIso));
          return okResult(labeled(locale, LABEL.added, `${quote(locale, preview(created.front))} (id ${created.id})`), { navigateTo: { module: "study" } });
        }

        if (action === "create-cloze") {
          const template = asText(args.text, "text", MAX_CARD_CHARS);
          const declined = await confirmOrDecline(context, "study.card", "write", phrase(locale, CLOZE_CREATE, quote(locale, deck.name), quote(locale, preview(template))));
          if (declined !== null) return declined;
          const made = open(context.profileId, (db, id) => new CardStore(db, id).createCloze(deck.id, template, nowIso));
          return okResult(phrase(locale, CLOZE_ADDED, made.length, quote(locale, deck.name)), { navigateTo: { module: "study" } });
        }

        if (action === "create-problem") {
          const front = asText(args.front, "front", MAX_CARD_CHARS);
          const steps = asText(args.steps, "steps", MAX_CARD_CHARS);
          const declined = await confirmOrDecline(context, "study.card", "write", phrase(locale, CARD_CREATE, quote(locale, deck.name), quote(locale, preview(front))));
          if (declined !== null) return declined;
          const created = open(context.profileId, (db, id) => new CardStore(db, id).createProblem(deck.id, front, steps, nowIso));
          return okResult(labeled(locale, LABEL.added, `${quote(locale, preview(created.front))} (id ${created.id})`), { navigateTo: { module: "study" } });
        }

        // update and delete name a card of this deck by its id or its front.
        const card = open(context.profileId, (db, id) => {
          const cards = new CardStore(db, id).listByDeck(deck.id);
          return pickOne(
            cards.map((row) => ({ id: row.id, name: row.front })),
            asIdentifier(args.card, "card"),
            NOUN.card,
            locale,
          );
        });

        if (action === "delete") {
          const declined = await confirmOrDecline(context, "study.card", "write", phrase(locale, CARD_DELETE, quote(locale, preview(card.name))));
          if (declined !== null) return declined;
          open(context.profileId, (db, id) => new CardStore(db, id).softDelete(card.id));
          return okResult(labeled(locale, LABEL.deleted, `${quote(locale, preview(card.name))} (id ${card.id})`), { navigateTo: { module: "study" } });
        }

        const front = asOptionalText(args.front, "front", MAX_CARD_CHARS);
        const back = asOptionalText(args.back, "back", MAX_CARD_CHARS);
        if (front === undefined && back === undefined) throw new Error(text(locale, NOTHING_TO_CHANGE));
        const declined = await confirmOrDecline(context, "study.card", "write", phrase(locale, CARD_UPDATE, quote(locale, preview(card.name))));
        if (declined !== null) return declined;
        open(context.profileId, (db, id) => new CardStore(db, id).update(card.id, definedOnly<UpdateCardFields>({ front, back })));
        return okResult(labeled(locale, LABEL.changed, `${quote(locale, preview(front ?? card.name))} (id ${card.id})`), { navigateTo: { module: "study" } });
      }),
  };

  const dueTool: Tool = {
    name: "study.due",
    description: {
      sr: "Prikazuje kartice koje su danas na redu za pregled, poštujući dnevnu granicu. Ne ocenjuje karticu: za pregled šalje na stranicu učenja. Koristi ga kada korisnik pita šta treba danas da ponovi.",
      en: "Lists the cards due for review today, honouring the daily cap. It does not grade a card: it sends the user to the study page to review. Use it when the user asks what to review today.",
    },
    parameters: {
      type: "object",
      properties: { deck: { ...DECK_REF, description: "Only this deck: its id or name. Omit for every deck." } },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const { locale } = context;
        const nowIso = new Date(deps.now()).toISOString();
        const queue = open(context.profileId, (db, id) => {
          const deckId = args.deck === undefined
            ? undefined
            : pickOne(new DeckStore(db, id).listActive(), asIdentifier(args.deck, "deck"), NOUN.deck, locale).id;
          return new CardStore(db, id).dueQueue(deckId === undefined ? {} : { deckId }, nowIso);
        });
        if (queue.cards.length === 0) return okResult(text(locale, NOTHING_DUE), { navigateTo: { module: "study" } });
        const lines = [phrase(locale, DUE_HEADER, queue.cards.length)];
        if (queue.capReached) lines.push(text(locale, CAP_REACHED));
        const shown = queue.cards.slice(0, QUEUE_PREVIEW);
        for (const card of shown) lines.push(cardLine(locale, card));
        const rest = queue.cards.length - shown.length;
        if (rest > 0) lines.push(phrase(locale, MORE_CARDS, rest));
        return okResult(lines.join("\n"), { navigateTo: { module: "study" } });
      }),
  };

  const planTool: Tool = {
    name: "study.plan",
    description: {
      sr: "Prikazuje planove učenja po ispitu i koliko je plana ispunjeno u poslednjih 30 dana. Koristi ga kada korisnik pita da li stiže da uči ili kako ide plan.",
      en: "Lists the study plans by exam and how much of the plan was kept over the last 30 days. Use it when the user asks whether they are keeping up with their plan.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const { locale } = context;
        const today = localDay(deps.now());
        const from = shiftDay(today, -(ADHERENCE_WINDOW_DAYS - 1));
        const { plans, exams, subjects, adherence } = open(context.profileId, (db, id) => ({
          plans: new PlanStore(db, id).listActive(),
          exams: new ExamStore(db, id).listActive(),
          subjects: new SubjectStore(db, id).listActive(),
          adherence: new StatsStore(db, id).planAdherence(from, today),
        }));
        if (plans.length === 0) return okResult(text(locale, NO_PLANS), { navigateTo: { module: "study" } });
        const ratio = adherence.ratio === null ? text(locale, PLAN_NO_RATIO) : formatPercent(locale, adherence.ratio);
        const lines = [phrase(locale, PLAN_WIDE, ADHERENCE_WINDOW_DAYS, ratio, adherence.done, adherence.missed)];
        for (const plan of plans) {
          lines.push(planLine(locale, plan, exams, subjects));
        }
        return okResult(lines.join("\n"), { navigateTo: { module: "study" } });
      }),
  };

  const syncTool: Tool = {
    name: "study.sync",
    description: {
      sr: "Usklađuje sve planove učenja sa rasporedom ispita i pregledima, pa kaže koliko je minuta ostalo bez mesta. Koristi ga kada korisnik kaže da je pomerio ispit ili da plan ne odgovara.",
      en: "Syncs every study plan with the exam schedule and reports the minutes that did not fit. Use it when the user says an exam moved or the plan no longer fits.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "write",
    run: (_rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const { locale } = context;
        const nowIso = new Date(deps.now()).toISOString();
        const today = localDay(deps.now());
        const { plans, exams, subjects } = open(context.profileId, (db, id) => ({
          plans: new PlanStore(db, id).listActive(),
          exams: new ExamStore(db, id).listActive(),
          subjects: new SubjectStore(db, id).listActive(),
        }));
        if (plans.length === 0) return okResult(text(locale, NO_PLANS), { navigateTo: { module: "study" } });
        const declined = await confirmOrDecline(context, "study.sync", "write", text(locale, SYNC_CONFIRM));
        if (declined !== null) return declined;
        const healths = open(context.profileId, (db, id) => new PlanStore(db, id).syncAll(nowIso, today));
        const lines = healths.map((health) => {
          const plan = plans.find((row) => row.id === health.planId);
          const exam = exams.find((row) => row.id === plan?.examId);
          const subjectName = subjects.find((row) => row.id === exam?.subjectId)?.name ?? "";
          const label = exam === undefined ? health.planId : examDescription(locale, exam, subjectName);
          return phrase(locale, SYNCED, label, health.overflowMinutes, health.examPassedBacklogMinutes);
        });
        return okResult(lines.join("\n"), { navigateTo: { module: "study" } });
      }),
  };

  const settingsTool: Tool = {
    name: "study.settings",
    description: {
      sr: "Čita ili menja podešavanja učenja: zadržavanje, nove kartice dnevno i pregledi dnevno. Bez ijednog polja samo prikazuje trenutna podešavanja. Koristi ga kada korisnik kaže „više nove kartice“ ili „smanji dnevni broj pregleda“.",
      en: "Reads or changes the study settings: retention, new cards a day and reviews a day. Without any field it only shows the current settings. Use it when the user says \"more new cards\" or \"fewer reviews a day\".",
    },
    parameters: {
      type: "object",
      properties: {
        targetRetention: {
          type: "number",
          minimum: MIN_TARGET_RETENTION,
          maximum: MAX_TARGET_RETENTION,
          description: "The recall the scheduler aims for, 0.7 to 0.97 (0.9 is 90 %).",
        },
        newPerDay: { type: "integer", minimum: 0, maximum: MAX_NEW_PER_DAY, description: "How many new cards a day's queue may offer." },
        maxReviewsPerDay: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: MAX_REVIEWS_PER_DAY,
          description: "How many reviews one day may hold, or null for no limit.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const { locale } = context;
        const retention = asOptionalNumber(args.targetRetention, "targetRetention", MIN_TARGET_RETENTION, MAX_TARGET_RETENTION);
        const newPerDay = asOptionalCount(args.newPerDay, "newPerDay", 0, MAX_NEW_PER_DAY);
        const reviews = args.maxReviewsPerDay === undefined ? undefined : asNullableCount(args.maxReviewsPerDay, "maxReviewsPerDay", 1, MAX_REVIEWS_PER_DAY);
        const current = open(context.profileId, (db, id) => new StudySettingsStore(db, id).get());
        if (retention === undefined && newPerDay === undefined && reviews === undefined) {
          return okResult(settingsLine(locale, current), { navigateTo: { module: "study" } });
        }

        const next: StudySettings = {
          targetRetention: retention ?? current.targetRetention,
          newPerDay: newPerDay ?? current.newPerDay,
          maxReviewsPerDay: reviews === undefined ? current.maxReviewsPerDay : reviews,
        };
        const before = settingsValues(locale, current);
        const after = settingsValues(locale, next);
        const changes = (Object.keys(before) as (keyof typeof SETTING)[])
          .filter((key) => before[key] !== after[key])
          .map((key) => `${SETTING[key][locale]} ${before[key]} → ${after[key]}`);
        if (changes.length === 0) return okResult(settingsLine(locale, current), { navigateTo: { module: "study" } });

        const declined = await confirmOrDecline(context, "study.settings", "write", phrase(locale, SETTINGS_CHANGE, changes.join("; ")));
        if (declined !== null) return declined;
        const saved = open(context.profileId, (db, id) => new StudySettingsStore(db, id).save(next, new Date(deps.now()).toISOString()));
        return okResult(labeled(locale, LABEL.changed, settingsLine(locale, saved)), { navigateTo: { module: "study" } });
      }),
  };

  return [
    subjectsTool,
    subjectTool,
    examsTool,
    examTool,
    topicsTool,
    topicTool,
    decksTool,
    deckTool,
    cardsTool,
    cardTool,
    dueTool,
    planTool,
    syncTool,
    settingsTool,
  ];
}

/** The settings line: the three values as the page names them. */
function settingsLine(locale: AssistantLocale, settings: StudySettings): string {
  const values = settingsValues(locale, settings);
  return phrase(locale, SETTINGS_NOW, values.targetRetention, values.newPerDay, values.maxReviewsPerDay);
}

/** A card as a listing line: its id, its front cut short, its kind and the day it is next due. */
function cardLine(locale: AssistantLocale, card: Card): string {
  const kind = card.problemSteps !== null ? CARD_KIND.problem : CARD_KIND[card.kind === "cloze" ? "cloze" : "basic"];
  return `- ${card.id} ${preview(card.front)} (${kind[locale]}, ${DECK_COUNTS.due[locale]} ${formatDayInSentence(locale, card.due.slice(0, 10))})`;
}

/** A plan as a line: its exam, its daily minutes and the day it starts. */
function planLine(locale: AssistantLocale, plan: StudyPlan, exams: readonly Exam[], subjects: readonly Subject[]): string {
  const exam = exams.find((row) => row.id === plan.examId);
  const subjectName = subjects.find((row) => row.id === exam?.subjectId)?.name ?? "";
  const label = exam === undefined ? plan.examId : examDescription(locale, exam, subjectName);
  return `- ${plan.id} ${label}: ${plan.dailyMinutes} ${PLAN_PER_DAY[locale]}, ${PLAN_FROM[locale]} ${formatDayInSentence(locale, plan.startDate)}`;
}

/**
 * The RECORDER module: the diary of recordings, read.
 *
 * **The store is the app's own.** `RecorderStore.listActive()` (migration 077)
 * answers the live recordings newest first, which is the order the module's own
 * page draws, and this file keeps it.
 *
 * **A day means the day the instant's own date part names.** The page groups
 * recordings with `@nexus/core`'s `groupByCreationDay`, which reads the first
 * ten characters of the stored instant rather than converting it to a local
 * calendar day. A tool that shifted the instant into the machine's zone would
 * answer with a different day from the heading the user is looking at, so the
 * filter here is the same ten characters, on purpose.
 *
 * **A recording with no title is named the way the page names it.** The store
 * allows an empty title (the capture is what the user wanted, the name comes
 * later), and the page prints the moment instead — so this file prints the day
 * and the time, which is the same answer in a plainer dress.
 */

import { RecorderStore, type Recording } from "@nexus/db";
import { foldSearchText, type AssistantLocale, type Tool } from "@nexus/core";
import { asArgs, asOptionalCount, asOptionalDay, asOptionalText } from "./args.js";
import {
  assertLive,
  formatClock,
  formatDayInSentence,
  formatDuration,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface RecorderToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
}

/** How many recordings one read answers with when the model names no cap, and the ceiling it may ask for. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
/** The longest search a person types into the module's own box. */
const MAX_QUERY_CHARS = 120;

/** The two kinds as the page names them. */
const KIND_WORDS = {
  audio: { sr: "zvuk", en: "sound" },
  video: { sr: "video", en: "video" },
} as const;

const HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Snimci (${count}):`,
  en: (count) => `Recordings (${count}):`,
};

const EMPTY: { readonly sr: string; readonly en: string } = {
  sr: "Još nema snimaka.",
  en: "There are no recordings yet.",
};

const NONE: AssistantPhrase<[query: string]> = {
  sr: (query) => `Nijedan snimak ne odgovara pretrazi „${query}“.`,
  en: (query) => `No recording answers the search “${query}”.`,
};

const NONE_ON_DAY: AssistantPhrase<[day: string]> = {
  sr: (day) => `Tog dana (${day}) nema snimaka.`,
  en: (day) => `There is no recording from ${day}.`,
};

const MORE: AssistantPhrase<[count: number]> = {
  sr: (count) => `…i još ${count}.`,
  en: (count) => `…and ${count} more.`,
};

const TAGS_WORD: AssistantPhrase<[tags: string]> = {
  sr: (tags) => `oznake: ${tags}`,
  en: (tags) => `tags: ${tags}`,
};

const DIARY_WORD: AssistantPhrase<[day: string]> = {
  sr: (day) => `u dnevniku, ${day}`,
  en: (day) => `filed in the diary, ${day}`,
};

export function recorderTools(deps: RecorderToolDeps): readonly Tool[] {
  const list: Tool = {
    name: "recorder.list",
    description: {
      sr: "Izlistava snimke — glasovne beleške i video zapise — najnovije prvo, uz dan i vreme, trajanje i oznake. Koristi ga kada korisnik pita šta je snimio ili šta je snimljeno nekog dana.",
      en: "Lists the recordings — voice memos and video — newest first, with their day and time, length and tags. Use it when the user asks what they recorded, or what was recorded on a given day.",
    },
    parameters: {
      type: "object",
      properties: {
        day: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "One day, YYYY-MM-DD. Left out, every recording is read.",
        },
        query: {
          type: "string",
          minLength: 1,
          maxLength: MAX_QUERY_CHARS,
          description: "A word from the title, a tag or the note. Accents do not matter.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many recordings to list. Defaults to ${String(DEFAULT_LIMIT)}.`,
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
        const day = asOptionalDay(args.day, "day");
        const query = asOptionalText(args.query, "query", MAX_QUERY_CHARS);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;

        const recordings = deps.profileDb(context.profileId, (db, id) =>
          new RecorderStore(db, id).listActive(),
        );
        const matching = recordings.filter(
          (recording) =>
            (day === undefined || recording.createdAt.slice(0, 10) === day) &&
            (query === undefined || matches(recording, query)),
        );
        if (matching.length === 0) {
          if (day !== undefined) {
            return okResult(phrase(context.locale, NONE_ON_DAY, formatDayInSentence(context.locale, day)));
          }
          return okResult(
            query === undefined ? text(context.locale, EMPTY) : phrase(context.locale, NONE, query),
          );
        }
        const shown = matching.slice(0, limit);
        const lines = [
          phrase(context.locale, HEADING, matching.length),
          ...shown.map((recording) => recordingLine(context.locale, recording)),
        ];
        if (matching.length > shown.length) {
          lines.push(phrase(context.locale, MORE, matching.length - shown.length));
        }
        return okResult(lines.join("\n"));
      }),
  };

  return [list];
}

/** One recording: when, what it is called, how long it runs, and what the user filed it under. */
function recordingLine(locale: AssistantLocale, recording: Recording): string {
  const at = Date.parse(recording.createdAt);
  const when = Number.isNaN(at)
    ? recording.createdAt
    : `${formatDayInSentence(locale, recording.createdAt.slice(0, 10))}, ${formatClock(locale, at)}`;
  const title = recording.title.trim();
  const parts = [
    text(locale, KIND_WORDS[recording.kind]),
    formatDuration(locale, Math.round(recording.durationMs / 1000)),
  ];
  if (recording.tags.length > 0) {
    parts.push(phrase(locale, TAGS_WORD, recording.tags.join(", ")));
  }
  if (recording.isDiary && recording.diaryDate !== null) {
    parts.push(phrase(locale, DIARY_WORD, formatDayInSentence(locale, recording.diaryDate)));
  }
  return title.length === 0
    ? `- ${when} (${parts.join(", ")})`
    : `- ${title} — ${when} (${parts.join(", ")})`;
}

/** The folded match the module's own search box uses: a title, a tag, the note or the transcript. */
function matches(recording: Recording, query: string): boolean {
  const needle = foldSearchText(query.trim());
  if (needle.length === 0) return false;
  const haystacks = [recording.title, recording.notes, recording.transcript, ...recording.tags];
  return haystacks.some((entry) => foldSearchText(entry).includes(needle));
}

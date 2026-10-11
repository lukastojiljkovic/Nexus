/**
 * The MINI-APPS module: what the nine small tools have kept.
 *
 * **The store is the app's own, and it keeps ONE document.** `MiniappsStore`
 * (migration 083) holds the counters, the scoreboard, the typing records and the
 * world clock's cities as one validated value, which is what the module's tiles
 * read and write; `read()` is the page's own call, so nothing here is a second
 * reader of `miniapps_state`.
 *
 * **What this file answers, and what it deliberately does not.** Four of the six
 * kept things are a record a person asks about — the counters, the scoreboard's
 * standings, the cities on the clock and the best typing runs. The dice history
 * is the fifth and it is left out: it is a glance backwards at rolls nobody
 * re-reads, and the page keeps it for its own dice tile rather than for a
 * question. Which tile was open last is the sixth and is not the user's data at
 * all.
 *
 * **Where the words come from.** The names a user typed are printed as typed.
 * The tile names („Brojači", „Semafor", „Kucanje", „Svetski sat") and the four
 * labels beside the figures are the page's own words restated, on `library.ts`'s
 * precedent: the page's copy table is part of the renderer's bundle and main
 * cannot read it. A CITY is the exception — the stored value is an IANA zone id,
 * and the page labels it from a table in that same copy („Beograd"), which is
 * the page's own vocabulary rather than a name the data carries; this file
 * prints the zone and the local time it is for, which is the fact the tile
 * exists to show.
 *
 * **Nothing here writes.** The store writes the document WHOLE
 * (`saveCounters`, `saveScoreboard`, … all replace the value), so an assistant
 * adding one counter would have to read, change and rewrite the document behind
 * the tile's back — and the tile keeps the undo history this store does not.
 * Pressing the tile is the write.
 */

import { MiniappsStore, type MiniappsData, type MiniappsTypingRecord } from "@nexus/db";
import {
  scoreboardStandings,
  tallyTotal,
  TYPING_LAYOUTS,
  type AssistantLocale,
  type ScoreboardBoard,
  type ScoreboardStanding,
  type Tool,
  type TypingLayoutId,
} from "@nexus/core";
import { asArgs } from "./args.js";
import {
  assertLive,
  formatClockIn,
  formatDayInSentence,
  formatNumber,
  formatPercent,
  guard,
  localDay,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface MiniappsToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
  /** Main's wall clock: the world clock's cities are answered with the local time it is now. */
  readonly now: () => number;
}

/** The heading, and the sentence for a profile that has kept nothing yet. */
const HEADING: { readonly sr: string; readonly en: string } = {
  sr: "Mini aplikacije — šta pamte:",
  en: "Mini apps — what they keep:",
};

const NOTHING_KEPT: { readonly sr: string; readonly en: string } = {
  sr: "Mini aplikacije još ništa ne pamte.",
  en: "The mini apps keep nothing yet.",
};

/** The four tile names, as the page writes them. */
const TILE = {
  counters: { sr: "Brojači", en: "Counters" },
  scoreboard: { sr: "Semafor", en: "Scoreboard" },
  clock: { sr: "Svetski sat", en: "World clock" },
  typing: { sr: "Kucanje", en: "Typing" },
} as const;

/** One counter as `name value`, and the sum the tile shows under the column. */
const TOTAL_WORD: AssistantPhrase<[total: string]> = {
  sr: (total) => `ukupno ${total}`,
  en: (total) => `total ${total}`,
};

/** A player's total and place, the two columns of the tile's standings table. */
const PLAYER_TOTAL: AssistantPhrase<[total: string]> = {
  sr: (total) => `ukupno ${total}`,
  en: (total) => `total ${total}`,
};

const PLAYER_RANK: AssistantPhrase<[rank: string]> = {
  sr: (rank) => `mesto ${rank}`,
  en: (rank) => `rank ${rank}`,
};

const ROUNDS_WORD: AssistantPhrase<[count: number]> = {
  sr: (count) => `kola: ${count}`,
  en: (count) => `rounds: ${count}`,
};

const TIED_WORD: { readonly sr: string; readonly en: string } = {
  sr: "nerešeno",
  en: "tied",
};

/** The typing tile's own two column labels, with the figure beside them. */
const WPM_WORD: AssistantPhrase<[wpm: string]> = {
  sr: (wpm) => `reči u minuti: ${wpm}`,
  en: (wpm) => `words a minute: ${wpm}`,
};

const ACCURACY_WORD: AssistantPhrase<[accuracy: string]> = {
  sr: (accuracy) => `tačnost: ${accuracy}`,
  en: (accuracy) => `accuracy: ${accuracy}`,
};

/** The best run's own day, in brackets after its figures. */
const BEST_ON: AssistantPhrase<[day: string]> = {
  sr: (day) => `najbolje ${day}`,
  en: (day) => `best on ${day}`,
};

export function miniappsTools(deps: MiniappsToolDeps): readonly Tool[] {
  const kept: Tool = {
    name: "miniapps.kept",
    description: {
      sr: "Čita šta pamte Mini aplikacije: brojače, poredak na semaforu, gradove na svetskom satu sa lokalnim vremenom i najbolje rezultate kucanja. Koristi ga kada korisnik pita koliki mu je brojač, ko vodi na semaforu, koje gradove ima na satu ili kolika mu je brzina kucanja.",
      en: "Reads what the mini apps have kept: the counters, the scoreboard standings, the cities on the world clock with their local times, and the best typing runs. Use it when the user asks what a counter is at, who leads the scoreboard, which cities are on their clock, or how fast they type.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        asArgs(rawArgs);
        const data = deps.profileDb(context.profileId, (db, id) =>
          new MiniappsStore(db, id).read(),
        );

        const sections: string[] = [];
        const counters = countersLine(context.locale, data);
        if (counters !== null) sections.push(counters);
        const scoreboard = scoreboardLine(context.locale, data.scoreboard);
        if (scoreboard !== null) sections.push(scoreboard);
        const clock = clockLine(context.locale, data.cities, deps.now());
        if (clock !== null) sections.push(clock);
        const typing = typingLines(context.locale, data);
        sections.push(...typing);

        if (sections.length === 0) return okResult(text(context.locale, NOTHING_KEPT));
        return okResult([text(context.locale, HEADING), ...sections].join("\n"));
      }),
  };

  return [kept];
}

/** The counters, or `null` when the user has none. */
function countersLine(locale: AssistantLocale, data: MiniappsData): string | null {
  if (data.counters.length === 0) return null;
  const counters = data.counters
    .map((counter) => `${counter.name} ${formatNumber(locale, counter.value)}`)
    .join(", ");
  // The engine's own total, over a state whose undo history is empty: the store
  // never keeps one (`miniappsStore.ts`: "the stacks are not stored") and the sum
  // does not depend on it.
  const total = phrase(
    locale,
    TOTAL_WORD,
    formatNumber(locale, tallyTotal({ counters: data.counters, past: [], future: [] })),
  );
  return `- ${text(locale, TILE.counters)}: ${counters} (${total})`;
}

/**
 * The standings, or `null` when no player is on the board.
 *
 * The engine's own `scoreboardStandings` is handed a state whose undo history is
 * empty, because the store never keeps one (`miniappsStore.ts`: "the stacks are
 * not stored") and the totals do not depend on it.
 */
function scoreboardLine(locale: AssistantLocale, board: ScoreboardBoard): string | null {
  if (board.players.length === 0) return null;
  const rows = scoreboardStandings({ ...board, past: [], future: [] })
    .map((standing) => playerText(locale, standing))
    .join("; ");
  const parts = [rows];
  if (board.rounds.length > 0) parts.push(phrase(locale, ROUNDS_WORD, board.rounds.length));
  return `- ${text(locale, TILE.scoreboard)}: ${parts.join(" — ")}`;
}

/** One player's row: the name the user typed, the total and the place in the standings. */
function playerText(locale: AssistantLocale, standing: ScoreboardStanding): string {
  const parts = [
    phrase(locale, PLAYER_TOTAL, formatNumber(locale, standing.total)),
    phrase(locale, PLAYER_RANK, String(standing.rank)),
  ];
  if (standing.tied) parts.push(text(locale, TIED_WORD));
  return `${standing.player.name} (${parts.join(", ")})`;
}

/**
 * The clock's cities, or `null` when none is picked: each zone with the local
 * time it is now.
 *
 * A zone the runtime does not know is printed without a time rather than
 * dropped: the id came out of a user's own document, and a row that vanished
 * from the answer would be the tool hiding what the tile would refuse to draw.
 */
function clockLine(
  locale: AssistantLocale,
  cities: readonly string[],
  nowMs: number,
): string | null {
  if (cities.length === 0) return null;
  const rows = cities.map((zone) => {
    const clock = formatClockIn(locale, nowMs, zone);
    return clock === null ? zone : `${zone} ${clock}`;
  });
  return `- ${text(locale, TILE.clock)}: ${rows.join(", ")}`;
}

/**
 * One line per layout that has runs: the best run's figures, and the day it was
 * set.
 *
 * The record kept is the one with the highest net speed — the same number the
 * tile's own „Najbolje" row shows. The layout is named by its id, which is what
 * the store holds; the page's own name for a layout („Srpski (latinica)") is a
 * table in the renderer's copy, and this file does not carry a second copy of it
 * (see the file header).
 */
function typingLines(locale: AssistantLocale, data: MiniappsData): readonly string[] {
  const layouts = Object.keys(TYPING_LAYOUTS) as TypingLayoutId[];
  const lines: string[] = [];
  for (const layout of layouts) {
    const runs = data.typing.records.filter((record) => record.layout === layout);
    const best = bestRun(runs);
    if (best === null) continue;
    lines.push(
      `- ${text(locale, TILE.typing)}: ${layout} — ${phrase(
        locale,
        WPM_WORD,
        formatNumber(locale, best.netWpm),
      )}, ${phrase(locale, ACCURACY_WORD, formatPercent(locale, best.accuracy))} (${phrase(
        locale,
        BEST_ON,
        formatDayInSentence(locale, localDay(best.atMs)),
      )})`,
    );
  }
  return lines;
}

/** The run with the highest net speed, or `null` when the list is empty. */
function bestRun(runs: readonly MiniappsTypingRecord[]): MiniappsTypingRecord | null {
  let best: MiniappsTypingRecord | null = null;
  for (const run of runs) {
    if (best === null || run.netWpm > best.netWpm) best = run;
  }
  return best;
}

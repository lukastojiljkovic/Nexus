import type { ModuleManifest, WidgetContract } from "@nexus/core";

/**
 * The CHESS module's manifest — the whole of what the shell knows about this
 * module before its page loads (ADR-090).
 *
 * The words live here rather than in the page's copy table for the reason
 * `timers/shared/manifest.ts` states at length: the rail draws a module's name,
 * and the settings gallery its one-line description, before any chunk of the
 * module has arrived — so the shell's few strings are `{ sr, en }` pairs on the
 * manifest, and everything the page itself draws lives in
 * `renderer/copy.sr.ts`/`copy.en.ts`.
 *
 * **`prefix: "FUN"` is shared, and deliberately.** PRD 31 ("Entertainment &
 * Boosters", `docs/prd/31-entertainment.md`) is one entry whose games are built
 * as separate modules — chess here, a solitaire beside it — on `UTIL`'s rule:
 * a prefix is traceability to a PRD entry, and one entry may legitimately be
 * implemented more than once. `modules.test.ts` states the sharing as an
 * explicit prefix→ids map, so any OTHER duplicate still fails.
 */

/**
 * „Partija u toku" — the game the user left unfinished, on the dashboard.
 *
 * ONE card, and it is a resumption rather than a statistic: a half-played game
 * is the one fact here that a home screen can act on, because the profile
 * already holds the position and the board is one click away. The ladder record
 * is deliberately NOT a card — „12 games, 5 won" is a fact about the past, and a
 * dashboard that spends a row on it tells the user nothing they can do next.
 *
 * No `configFields`, on „Fokus"'s terms: a knob on a card narrows a LIST, and
 * there is exactly one game in progress by construction (`chess_resume` is keyed
 * by the profile).
 */
const CHESS_WIDGETS: WidgetContract[] = [
  {
    id: "partija-u-toku",
    title: { sr: "Partija u toku", en: "Game in progress" },
    sizes: ["S", "M"],
    deepLink: "chess",
  },
];

export const manifest: ModuleManifest = {
  id: "chess",
  prefix: "FUN",
  group: "play",
  defaultEnabled: true,
  // Where this module sorts among the DISCOVERED modules (ADR-090). A round
  // number with room on both sides: the shell's own sixteen keep the order they
  // were written in, and `timers` sorts below this one at 100.
  order: 350,
  copy: {
    name: { sr: "Šah", en: "Chess" },
    description: {
      sr: "Partija na tabli — protiv računara ili druge osobe, sa satom, sačuvanim partijama i PGN-om.",
      en: "A board game — against the engine or another person, with clocks, saved games and PGN.",
    },
  },
  widgets: CHESS_WIDGETS,
};

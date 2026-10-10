/**
 * ARCADE's own copy, in Serbian - the SHAPE every other locale of this module is
 * checked against (ADR-090).
 *
 * **Why this is not in `strings.ts`.** The shell's table is part of the startup
 * chunk and this module's page is not: copy here would be paid for on every
 * launch, by every profile, whether or not anybody ever opened a game. So the
 * module carries its own table, `copy.ts` registers it with the locale machinery
 * the moment this chunk loads, and from that moment switching language rewrites
 * these leaves in place exactly as it rewrites the shell's.
 *
 * English is `copy.en.ts`, typed `typeof sr` - one compile error per sentence
 * left untranslated and one per key invented.
 *
 * **The register.** A game's words are its own: "tabla", "potez", "niz" - never
 * a translation of a trademark, and nothing anywhere calls Blocks by a name it
 * does not own (`packages/core/src/games/blocks/pieces.ts` argues that at
 * length). Every figure is labelled, because a score with no word beside it is a
 * number a reader has to guess at.
 */
export const sr = {
  page: {
    // The page's own header is the module's name, which the shell draws from the
    // manifest (`declaredText`); this is the line under it.
    subtitle: "Pet brzih igara za predah — bez mreže i bez naloga.",
    loading: "Učitavanje…",
  },
  shelf: {
    title: "Igre",
  },
  games: {
    minesweeper: "Minolovac",
    blocks: "Kocke",
    snake: "Zmija",
    bricks: "Cigle",
    tile2048: "2048",
  },
  boards: {
    // The variant key of a game whose engine gives it exactly one board, spelled
    // for a reader. The key stays `standard` on the wire.
    standard: "Standardna tabla",
  },
  levels: {
    label: "Tabla",
    beginner: "Početni",
    intermediate: "Srednji",
    expert: "Napredni",
    custom: "Prilagođeno",
  },
  counts: {
    lines: "Najviše linija",
    food: "Najduža zmija",
    levels: "Najviše nivoa",
    moves: "Najviše poteza",
  },
  stats: {
    title: "Rezultati",
    played: "Odigrano",
    bestTime: "Najbolje vreme",
    bestScore: "Najbolji rezultat",
    currentStreak: "Niz",
    longestStreak: "Najduži niz",
    lastPlayed: "Poslednja partija",
    none: "nema",
    unplayed: "Nije odigrano",
    empty: "Izaberi igru i odigraj prvu partiju — ovde se vide najbolji rezultati.",
  },
  actions: {
    newGame: "Nova igra",
    undo: "Potez nazad",
    continueAfterWin: "Nastavi posle pobede",
    resume: "Nastavi",
  },
  custom: {
    title: "Prilagođena tabla",
    columns: "Kolone",
    rows: "Redovi",
    mines: "Mine",
    invalid: "Prvi klik uvek mora da bude bezbedan: polja minus mine mora da bude bar 9.",
  },
  status: {
    paused: "Pauzirano",
    pausedHint: "Klikni na tablu ili pritisni taster da nastaviš.",
    ready: "Prvi klik je uvek bezbedan.",
    remaining: "Preostalo mina",
    time: "Vreme",
    won: "Pobeda",
    lost: "Kraj",
    over: "Kraj igre",
    score: "Rezultat",
    lines: "Linije",
    level: "Nivo",
    next: "Sledeće",
    hold: "Rezerva",
    length: "Dužina",
    eaten: "Pojedeno",
    lives: "Životi",
    cleared: "Nivoi",
    moves: "Potezi",
    bestTile: "Najveć pločica",
  },
  keys: {
    minesweeper:
      "Strelice pomeraju kursor, Space otvara polje, F označava, C otvara susedna polja; desni klik označava, levi otvara.",
    blocks:
      "Levo i desno pomeraju deo, gore i Z okreću, dole ubrzava pad, Space spušta do dna, C čuva deo.",
    snake: "Strelice skreću zmiju; zmija ne sme u zid ni u sebe.",
    bricks: "Levo i desno pomeraju reket, Space lansira lopticu, mišem možeš da vodiš reket.",
    tile2048: "Strelice spajaju pločice, U vrać poslednji potez.",
  },
  errors: {
    load: "Rezultati nisu učitani.",
    record: "Rezultat nije sačuvan.",
  },
};

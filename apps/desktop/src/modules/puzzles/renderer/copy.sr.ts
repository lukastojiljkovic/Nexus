/**
 * SLAGALICE' own copy, in Serbian — the SHAPE every other locale of this module
 * is checked against (ADR-090).
 *
 * **Why this is not in `strings.ts`.** The shell's table is part of the startup
 * chunk and this module's page is not: a module that put its page copy there
 * would pay for it on every launch, whether or not anybody ever opened a puzzle.
 * So the module carries its own table, `copy.ts` registers it with the locale
 * machinery the moment this chunk loads, and from that moment switching language
 * rewrites these leaves in place exactly as it rewrites the shell's.
 *
 * `copy.en.ts` is typed `typeof sr`, which is how the two tables stay the same
 * shape without anything checking them by hand.
 *
 * **No sentence here addresses the reader** (`check:address`): Serbian has no
 * genderless past tense, so „what you entered" would have picked the reader's
 * gender. Every line is a statement about the game or a name for a control, and
 * the labels that could have gone either way are nouns — „Nova igra", „Obriši",
 * „Pomoć".
 */
export const sr = {
  page: {
    subtitle: "Sudoku, nonogrami, mahjong i Broj — svaka partija se čuva i nastavlja gde je prekinuta.",
    loading: "Učitavanje…",
    stages: {
      deal: "Priprema table…",
      search: "Traženje rešenja…",
    },
    loadError: "Slagalice nije moguće učitati.",
    saveError: "Partija nije sačuvana.",
  },
  tabs: {
    sudoku: "Sudoku",
    nonogram: "Nonogrami",
    mahjong: "Mahjong",
    broj: "Broj",
  },
  variants: {
    sudoku: {
      easy: "Lako",
      medium: "Srednje",
      hard: "Teško",
    },
    nonogram: {
      "5x5": "5 × 5",
      "10x10": "10 × 10",
      "15x15": "15 × 15",
      "20x20": "20 × 20",
    },
    mahjong: {
      turtle: "Kornjača",
    },
    broj: {
      six: "Šest brojeva",
    },
  },
  common: {
    newGame: "Nova igra",
    undo: "Nazad",
    redo: "Napred",
    hint: "Pomoć",
    played: "Partija",
    solved: "Rešeno",
    best: "Najbolje vreme",
    time: "Vreme",
  },
  stats: {
    title: "Rezultati",
    empty: "Još nema rezultata",
    emptyBody:
      "Odaberi slagalicu, odigraj partiju do kraja i rezultat se ovde pojavljuje sam.",
  },
  sudoku: {
    variantLabel: "Težina",
    boardLabel: "Tabla",
    cell: "Polje",
    padLabel: "Cifre",
    erase: "Obriši",
    notes: "Beleške",
    conflicts: "Prikaži greške",
    conflictNote: "Polja sa istom cifrom u redu, koloni ili kvadratu su označena.",
    hintLead: "Potez koji sledi:",
    hintFill: "upisati cifru {digit} u polje {cell}",
    hintEliminate: "ukloniti kandidate iz označenih polja",
    hintNarrow: "zadržati samo označene kandidate",
    hintNone: "Za ovu tablu nema više poteza iz lestvice tehnika.",
    filled: "Popunjeno",
    solved: "Rešeno — sva 81 polja su tačna.",
  },
  techniques: {
    "naked-single": "samo jedna cifra ostaje u polju",
    "hidden-single": "cifra ima samo jedno mesto u ovom redu, koloni ili kvadratu",
    "naked-pair": "dve cifre dele dva polja, pa im nema mesta drugde u jedinici",
    "hidden-pair": "dve cifre se javljaju samo u istim dvama poljima",
    pointing: "cifra je u kvadratu vezana za jedan red ili kolonu",
    "box-line": "cifra je u redu ili koloni vezana za jedan kvadrat",
    "x-wing": "cifra je u dva reda na istim dvema kolonama",
  },
  nonogram: {
    variantLabel: "Veličina",
    toolLabel: "Alat",
    fill: "Popuni",
    cross: "Precrtaj",
    zoomLabel: "Krupnoća",
    zoomIn: "Uvećaj",
    zoomOut: "Umanji",
    cell: "Polje",
    markUnknown: "prazno",
    markFilled: "popunjeno",
    markCrossed: "precrtano",
    filled: "Tačno popunjeno",
    solved: "Rešeno — slika je tačna.",
  },
  mahjong: {
    layout: "Raspored",
    left: "Preostalo pločica",
    shuffle: "Promešaj",
    shuffled: "Preostale pločice su ponovo podeljene.",
    stuck: "Nema više para koje se mogu uzeti. Promešaj pločice.",
    shuffleFailed: "Preostale pločice se ne mogu složiti tako da se tabla očisti.",
    hintLead: "Igraj ovaj par.",
    hintNone: "Nijedan par više ne vodi do kraja partije.",
    solved: "Sve pločice su uklonjene.",
    unknown: "Nepoznata pločica",
    suits: {
      circles: "Krugovi",
      bamboo: "Bambus",
      characters: "Znakovi",
    },
    winds: {
      east: "Istočni vetar",
      south: "Južni vetar",
      west: "Zapadni vetar",
      north: "Severni vetar",
    },
    dragons: {
      red: "Crveni zmaj",
      green: "Zeleni zmaj",
      white: "Beli zmaj",
    },
    flower: "Cvet",
    season: "Godišnje doba",
  },
  broj: {
    target: "Cilj",
    numbers: "Brojevi",
    expression: "Izraz",
    check: "Proveri",
    refusals: {
      syntax: "Izraz nije ispravan. Koristi cifre, +, −, ×, ÷ i zagrade.",
      "unknown-number": "Izraz koristi broj kojeg nema među šest ponuđenih.",
      "inexact-division": "Deljenje mora da bude tačno, bez ostatka.",
    },
    exact: "Tačno — vrednost je {value}.",
    near: "Vrednost je {value}, {distance} od cilja.",
    solutionLead: "Najbolji izraz od šest brojeva:",
    solutionDistance: "Razlika do cilja",
    giveUp: "Predaj se",
  },
  widget: {
    empty: "Nijedna partija nije započeta.",
    loading: "Učitavanje…",
    loadError: "Započete partije nije moguće učitati.",
  },
  settings: {
    caption: "Podešavanje važi za sudoku i čuva se uz profil.",
    hint: "Kad je isključeno, greške se prikazuju samo na zahtev, dugmetom iznad table.",
    saved: "Sačuvano.",
    loadError: "Podešavanje nije moguće učitati.",
    saveError: "Podešavanje nije sačuvano.",
  },
};

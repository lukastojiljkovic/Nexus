/**
 * BOARDS' own copy, in Serbian — the SHAPE every other locale of this module is
 * checked against (ADR-090).
 *
 * **Why this is not in `strings.ts`.** The shell's table is part of the startup
 * chunk and this module's page is not: a module that put its page copy there would
 * pay for it on every launch, whether or not anybody ever opened a board game. So
 * the module carries its own table, `copy.ts` registers it with the locale
 * machinery the moment this chunk loads, and from that moment switching language
 * rewrites these leaves in place exactly as it rewrites the shell's.
 *
 * English is `copy.en.ts`, typed `typeof sr` — one compile error per sentence left
 * untranslated and one per key invented.
 *
 * **The level names are deliberately NOT here.** „Lako"/„Srednje"/„Teško" are
 * declared once, in `shared/manifest.ts`, because the settings card is composed
 * from that declaration and the new-game panel draws the same three words: two
 * tables would be two chances for the level a card offers and the level a game
 * starts at to be called different things.
 *
 * **The per-game names are here**, and they are this module's own vocabulary
 * rather than the shell's: the rail draws the module's name from the manifest, and
 * only a page that has loaded needs to say „Tavla" or „Ne ljuti se, čoveče".
 * `games` is read by INDEX (`copy.games[game].name`), which is what lets one row
 * of copy serve six games without six branches at the call site.
 */
export const sr = {
  page: {
    subtitle: "Šest igara na tabli — protiv računara ili na istom računaru.",
    loading: "Učitavanje…",
  },
  games: {
    reversi: {
      name: "Reversi",
      about: "Preokreni protivničke pločice i drži uglove.",
    },
    draughts: {
      name: "Dama",
      about: "Dvanaest figura, obavezno uzimanje, dve vrste pravila.",
    },
    mlin: {
      name: "Mlin",
      about: "Tri figure u nizu — postavi, pomeraj i sklanjaj.",
    },
    backgammon: {
      name: "Tavla",
      about: "Dve kocke, petnaest figura i kocka za dupliranje.",
    },
    "four-in-a-row": {
      name: "Četiri u nizu",
      about: "Ubaci pločicu i sastavi četiri u liniji.",
    },
    ludo: {
      name: "Ne ljuti se, čoveče",
      about: "Dva do četiri igrača, šestica vodi figuru iz dvorišta.",
    },
  },
  lobby: {
    title: "Igre",
    play: "Nova partija",
    resume: "Nastavi",
    saved: "Sačuvana partija",
    moves: "Potezi: {count}",
    againstComputer: "Protiv računara, nivo {level}",
    againstHuman: "Dve osobe na istom računaru",
  },
  cell: {
    human: "osoba",
    computer: "računar",
    empty: "prazno",
    column: "kolona",
  },
  setup: {
    title: "Nova partija: {game}",
    opponent: "Protivnik",
    computer: "Računar",
    human: "Druga osoba",
    level: "Nivo računara",
    seats: "Broj igrača",
    seat: "Igrač {number}",
    rules: "Pravila",
    english: "Engleska dama",
    russian: "Ruska dama",
    cube: "Igraj sa kockom za dupliranje",
    cubeHint: "Kocka udvostručuje ulog, a protivnik je prihvata ili odbija.",
    start: "Počni",
    cancel: "Otkaži",
  },
  game: {
    turn: "Na potezu",
    you: "ti",
    computer: "računar",
    player: "igrač {number}",
    thinking: "Računar misli…",
    roll: "Baci kocku",
    pass: "Pusti red",
    noMoves: "Sa ovom kockom nema dozvoljenog poteza.",
    undo: "Nazad",
    undoHint: "Vraća tvoj potez i odgovor računara.",
    resign: "Predaj",
    record: "Zabeleži rezultat",
    leave: "Napusti partiju",
    newGame: "Nova partija",
    listTitle: "Potezi",
    listEmpty: "Još nema poteza.",
    cube: "Kocka: {value}",
    offer: "Dupliraj",
    accepts: "Prihvati",
    declines: "Odbij",
    pickFrom: "Izaberi figuru.",
    pickTo: "Izaberi polje.",
    pickRemoval: "Izaberi figuru koju uklanjaš.",
    pickColumn: "Izaberi kolonu.",
    keys: "Tastatura: Tab kroz polja, Enter za izbor, Escape odustaje.",
  },
  moves: {
    roll: "Kocka",
    pass: "Bez poteza",
    double: "Dupliranje",
  },
  result: {
    title: "Kraj partije",
    win: "Pobeda",
    loss: "Poraz",
    draw: "Nerešeno",
    seat: "Pobeda: igrač {number}",
    note: "Rezultat ulazi u tabelu rezultata kada ga zabeležiš.",
  },
  stats: {
    title: "Rezultati",
    caption: "Beleže se samo partije protiv računara, po nivou.",
    level: "Nivo",
    played: "partija",
    won: "pobeda",
    drawn: "nerešeno",
    lost: "poraza",
    none: "Još nema zabeleženih partija.",
    variant: { english: "Engleska", russian: "Ruska" },
  },
  settings: {
    caption: "Nivo na kom se otvara nova partija protiv računara.",
    hint: "Nivo se menja i u novoj partiji, pre početka.",
    saved: "Sačuvano.",
    loadError: "Nije moguće učitati podešavanje.",
    saveError: "Podešavanje nije sačuvano.",
  },
  widget: {
    empty: "Nijedna partija nije u toku.",
    loading: "Učitavanje…",
    loadError: "Nije moguće učitati partije.",
    moves: "Potezi: {count}",
  },
  errors: {
    load: "Nije moguće učitati partije.",
    mutate: "Izmena nije sačuvana.",
    think: "Računar nije mogao da odigra potez. Pokušaj ponovo, ili predaj partiju.",
    position: "Sačuvana partija nije ispravna, pa nije učitana.",
  },
};

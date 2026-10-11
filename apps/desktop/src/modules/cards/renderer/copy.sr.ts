/**
 * CARDS' own copy, in Serbian — the SHAPE every other locale of this module is
 * checked against (ADR-090).
 *
 * **Why this is not in `strings.ts`.** The shell's table is part of the startup
 * chunk and this module's page is not: a module that put its page copy there would
 * pay for it on every launch, whether or not anybody ever opened a game. So the
 * module carries its own table, `copy.ts` registers it with the locale machinery the
 * moment this chunk loads, and from that moment switching language rewrites these
 * leaves in place exactly as it rewrites the shell's.
 *
 * **Why the letters are written as `\u` escapes.** This file is the module's one
 * table of Serbian copy, and a patch tool that reads UTF-8 as cp1252 mangles every
 * `č`, `ć`, `š`, `ž`, `đ` and `„` it writes; a literal that compiles to the same
 * character cannot be mangled where an editor and a patch tool disagree about the
 * encoding. The compiler hands the user the same letters either way.
 *
 * **The suits and the ranks are the one place this table is a LOOKUP rather than a
 * sentence**, because a card's name has to exist for all four suits and all thirteen
 * ranks — `card.rank` and `card.suit` are read by index, which is what `check:copy`
 * sees as read. The register is Serbian: a face card is named the way a player says
 * it („\u017eandar", „kraljica", „kralj"), and the suits are the table's own words.
 *
 * English is `copy.en.ts`, typed `typeof sr` — one compile error per sentence left
 * untranslated and one per key invented.
 */
export const sr = {
  page: {
    subtitle: "Devet igara kartama \u2014 \u0161est pasijansa i tri protiv ra\u010dunara.",
    loading: "U\u010ditavanje\u2026",
  },
  games: {
    klondike: {
      name: "Klondajk",
      about: "Slo\u017ei boje od asa do kralja. Deljenje po jednu ili tri.",
    },
    freecell: {
      name: "Frisel",
      about: "\u010cetiri slobodna polja i osam kolona; partija je broj.",
    },
    spider: {
      name: "Pauk",
      about: "Deset kolona, jedna ili \u010detiri boje, skupljaj nizove.",
    },
    pyramid: {
      name: "Piramida",
      about: "Sparuj karte koje daju trinaest.",
    },
    tripeaks: {
      name: "Tri vrha",
      about: "Sla\u017ei na otvorenu kartu jedan iznad ili ispod.",
    },
    golf: {
      name: "Golf",
      about: "Sla\u017ei na osnovnu kartu jedan iznad ili ispod.",
    },
    hearts: {
      name: "Herc",
      about: "Izbegni herc i damu pik; igra se do sto poena.",
    },
    spades: {
      name: "Pik",
      about: "Licitacija i \u0161tihovi; igra se do petsto poena.",
    },
    tablic: {
      name: "Tabli\u0107",
      about: "Skupljaj karte sa stola; igra se do sto jedan poen.",
    },
  },
  variant: {
    draw1: "Po jednu",
    draw3: "Po tri",
    classic: "Klasi\u010dna",
    suits1: "Jedna boja",
    suits2: "Dve boje",
    suits4: "\u010cetiri boje",
    pass1: "Jedno okretanje",
    pass3: "Tri okretanja",
    standard: "Standardna",
    wrap: "Sa obrtanjem",
    duo: "Dvoje",
    pairs: "Dva para",
  },
  level: {
    easy: "Lako",
    medium: "Srednje",
    hard: "Te\u0161ko",
  },
  lobby: {
    title: "Igre",
    play: "Nova partija",
    resume: "Nastavi",
    saved: "Sa\u010duvana partija",
    moves: "Potezi: {count}",
    againstComputer: "Protiv ra\u010dunara, nivo {level}",
    played: "{count} partija",
  },
  setup: {
    title: "Nova partija: {game}",
    variant: "Pravila",
    level: "Nivo ra\u010dunara",
    seed: "Broj partije",
    seedHint: "Celi broj od 1 do 32 000, kao u klasi\u010dnoj igri.",
    start: "Po\u010dni",
    cancel: "Otka\u017ei",
  },
  play: {
    status: "Na potezu",
    you: "ti",
    computer: "ra\u010dunar",
    thinking: "Ra\u010dunar misli\u2026",
    undo: "Nazad",
    hint: "Pomo\u0107",
    safe: "Odigraj sigurno",
    giveUp: "Prekini",
    movesTitle: "Potezi",
    movesEmpty: "Jo\u0161 nema poteza.",
    score: "Poeni",
    dealNumber: "Partija broj {seed}",
    stock: "\u0160pil: {count}",
    keys: "Tastatura: Tab kroz karte, Enter za izbor, Escape poni\u0161tava.",
    solve: "Proveri partiju",
    verdict: {
      winnable: "Partija se mo\u017ee re\u0161iti.",
      unwinnable: "Partija se ne mo\u017ee re\u0161iti.",
      unknown: "Provera nije stigla do kraja.",
    },
    heartsBroken: "Herc je otvoren",
    spadesBroken: "Pik je otvoren",
    pickPass: "Izaberi tri karte za predaju, pa pritisni Predaj.",
    passThree: "Predaj",
    table: "Sto",
    trick: "\u0160tih",
    runs: "Slo\u017eeni nizovi",
    foundations: "Boje",
    freeCells: "Slobodna polja",
    columns: "Kolone",
    tableau: "Sto",
    waste: "Otpad",
    base: "Osnovna karta",
    peaks: "Vrhovi",
  },
  card: {
    rank: {
      "1": "As",
      "2": "Dvojka",
      "3": "Trojka",
      "4": "\u010cetvorka",
      "5": "Petica",
      "6": "\u0160estica",
      "7": "Sedmica",
      "8": "Osmica",
      "9": "Devetka",
      "10": "Desetka",
      "11": "\u017dandar",
      "12": "Kraljica",
      "13": "Kralj",
    },
    suit: {
      clubs: "tref",
      diamonds: "karo",
      hearts: "herc",
      spades: "pik",
    },
  },
  moves: {
    draw: "Podeli kartu",
    recycle: "Okreni otpad",
    move: "Prebaci",
    deal: "Podeli red",
    collect: "Skloni niz",
    match: "Sparuj",
    matchKing: "Skloni kralja",
    play: "Odigraj",
    turn: "Okreni kartu",
    pass: "Predaj tri karte",
    bid: "Licituj {value}",
    bidNil: "Licituj nulu",
  },
  stats: {
    title: "Rezultati",
    caption: "Bele\u017ei se svaka zavr\u0161ena partija, po igri i pravilima.",
    played: "partija",
    won: "pobeda",
    best: "najbolje",
    time: "najbr\u017ee",
    none: "Jo\u0161 nema zabele\u017eenih partija.",
    timeValue: "{minutes}:{seconds}",
  },
  result: {
    title: "Kraj partije",
    win: "Pobeda",
    loss: "Poraz",
    stopped: "Partija je prekinuta.",
    again: "Nova partija",
    note: "Rezultat ulazi u tabelu rezultata kada ga zabele\u017ei\u0161.",
  },
  widget: {
    empty: "Nijedna partija nije u toku.",
    loading: "U\u010ditavanje\u2026",
    loadError: "Nije mogu\u0107e u\u010ditati partije.",
    moves: "Potezi: {count}",
  },
  errors: {
    load: "Nije mogu\u0107e u\u010ditati partije.",
    mutate: "Izmena nije sa\u010duvana.",
    position: "Sa\u010duvana partija nije ispravna, pa nije u\u010ditana.",
    think: "Ra\u010dunar nije mogao da odigra potez. Poku\u0161aj ponovo, ili prekini partiju.",
    seed: "Broj partije mora biti izme\u0111u 1 i 32 000.",
  },
};

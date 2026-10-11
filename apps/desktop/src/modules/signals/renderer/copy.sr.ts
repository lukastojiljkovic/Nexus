/**
 * SIGNALS' own copy, in Serbian — the SHAPE every other locale of this module is
 * checked against (ADR-090).
 *
 * **Why this is not in `strings.ts`.** The shell's table is part of the startup
 * chunk and this module's page is not, so the words the page draws travel with
 * the page: `copy.ts` registers this table with the locale machinery when the
 * chunk loads, and from that moment switching language rewrites these leaves in
 * place exactly as it rewrites the shell's.
 *
 * English is `copy.en.ts`, typed `typeof sr` — one compile error per sentence
 * left untranslated and one per key invented, which is how the two tables stay
 * the same shape without anything checking them by hand.
 *
 * No `as const`: the literal type of a sentence is not something either locale
 * should be pinned to, and `typeof sr` widened to `string` is exactly the shape
 * `en` has to match.
 */
export const sr = {
  page: {
    subtitle:
      "Morse, ASCII tabela, štimer i merač nivoa zvuka: mikrofon se otvara samo kad se alat pokrene.",
  },
  tabs: {
    morse: "Morse",
    ascii: "ASCII",
    tuner: "Štimer",
    meter: "Merač zvuka",
  },
  common: {
    start: "Pokreni",
    stop: "Zaustavi",
    listening: "Sluša",
    micDenied: "Mikrofon nije dostupan. Proveri dozvolu za mikrofon u Windows podešavanjima.",
    micFailed: "Mikrofon se nije otvorio.",
    deviceNote: "Zvuk se obrađuje u pozadini; stranica ostaje odzivna.",
    mainThreadNote: "Obrada radi u glavnoj niti jer ovaj prozor ne dozvoljava radnu nit.",
  },
  morse: {
    title: "Tekst i kod",
    textLabel: "Tekst",
    codeLabel: "Morse kod",
    toCode: "U Morse",
    toText: "U tekst",
    // One leaf for both cases, because the engine reports them together: a
    // character sent as another one (č as c) and a character with no code at all
    // (€) both arrive in the same list, and a sentence that claimed only the
    // first would be wrong about the second.
    transliterated: "Nije poslato kako je napisano:",
    unknownTokens: "Nepoznat znak u kodu:",
    wordsHint: "Reči se razdvajaju sa tri razmaka ili kosom crtom, slova jednim razmakom.",
    playback: "Ton i brzina",
    speedLabel: "Brzina znakova (reči u minuti)",
    messageSpeedLabel: "Brzina poruke (Farnsworth)",
    messageSpeedHint: "Manja od brzine znakova razvlači samo razmake, ne i znakove.",
    pitchLabel: "Visina tona (Hz)",
    play: "Pusti ton",
    stop: "Zaustavi ton",
    durationLabel: "Trajanje",
    silence: "Nema šta da se pusti.",
    lamp: "Treptanje ekranom",
    lampWarningTitle: "Upozorenje pre treptanja",
    lampWarningBody:
      "Treptanje svetla može da izazove napad kod osoba sa fotosenzitivnom epilepsijom. Ako je to rizik za tebe ili za nekoga u prostoriji, ne pokreći ga. Ekran će naizmenično postajati beo i crn, tempom koji je podešen.",
    lampStart: "Pokreni treptanje",
    lampStop: "Zaustavi treptanje",
    lampKeyHint: "Escape zaustavlja treptanje.",
    lampStopped: "Treptanje je zaustavljeno.",
    decode: "Dekodiranje sa mikrofona",
    decodeHint:
      "Kucaj po ručnom ključu ili pusti snimku. Brzina se meri iz onoga što se čulo.",
    heard: "Čulo se",
    unit: "Jedinica",
    wpm: "Brzina",
    confidence: "Pouzdanost",
    confidenceHint: "Deo primljenih znakova čija je dužina tačno tačka ili crta.",
    guessed: "Reč je procena, ne merenje: ništa u ovome nije izmerilo jednu jedinicu.",
    nothingHeard: "Još ništa nije primljeno.",
    alphabetTitle: "Alfabet",
    alphabetHint: "ITU-R M.1677-1, Aneks 1.",
  },
  ascii: {
    searchLabel: "Pretraga",
    searchPlaceholder: "npr. 65, 4A, TAB, A",
    radixLabel: "Osnova",
    radixNames: {
      "2": "Binarno (2)",
      "8": "Oktalno (8)",
      "10": "Dekadno (10)",
      "16": "Heksadekadno (16)",
    },
    sortLabel: "Redosled",
    sortByCode: "Po kodu",
    sortByName: "Po imenu",
    columns: {
      decimal: "Dekadno",
      hex: "Heks",
      binary: "Binarno",
      char: "Znak",
      name: "Ime",
    },
    tableTitle: "Tabela ASCII kodova",
    tableHint: "Prikazano je {shown} od 128 kodova.",
    emptyRow: "Nijedan kod ne odgovara pretrazi.",
    textLabel: "Tekst",
    codesLabel: "Kodovi",
    toCodes: "U kodove",
    toText: "U tekst",
    refused: "Nije ASCII:",
    codesRefused: "Ne može da se pročita:",
    controlHint: "Kontrolni kodovi se prikazuju imenom, ne znakom.",
  },
  tuner: {
    presetLabel: "Instrument",
    strings: "Žice",
    start: "Pokreni štimer",
    stop: "Zaustavi štimer",
    noteLabel: "Nota",
    centsLabel: "Odstupanje u centima",
    frequencyLabel: "Frekvencija",
    targetLabel: "Cilj",
    inTune: "Ugađeno",
    waiting: "Čeka se ton",
    gated: "Previše tiho za merenje: približi instrument mikrofonu.",
    clarityLabel: "Periodičnost",
    a4Label: "Referentni A4 (Hz)",
    a4Hint: "415 do 466 Hz, opseg istorijskih i savremenih visina štima.",
    presetNames: {
      guitar: "Gitara (standard)",
      bass: "Bas",
      violin: "Violina",
      ukulele: "Ukulele (G4)",
      ukuleleLowG: "Ukulele (nisko G)",
      chromatic: "Hromatska skala (C2 do C6)",
    },
  },
  meter: {
    title: "Nivo zvuka",
    start: "Pokreni merenje",
    stop: "Zaustavi merenje",
    rmsLabel: "Nivo (RMS)",
    peakLabel: "Vrh",
    dbfs: "dBFS",
    db: "dB",
    crestLabel: "Odnos vrha prema nivou",
    crestHint: "Odnos je bez jedinice nivoa.",
    leqLabel: "Prosečna energija (Leq)",
    resetPeak: "Resetuj vrh",
    notCalibrated:
      "Ovo nije kalibrisan nivo u dB SPL. Mikrofon laptopa nema kalibraciju, pa su svi brojevi u dBFS, decibelima punog opsega, i ne mogu se čitati kao apsolutna jačina zvuka.",
    historyTitle: "Istorija nivoa",
    historyDescription:
      "Nivo u dBFS po sekundi od početka merenja, najviše {count} sekundi unazad.",
    historyEmpty: "Još nema izmerenih sekundi.",
    historyCaption: "Prozor od {count} sekundi; linija je nivo, tanka crta je držani vrh.",
    peakRule: "držani vrh",
  },
  settings: {
    speedCaption: "Ove vrednosti su za ovaj računar i ne idu u rezervnu kopiju profila.",
    speedHint: "Znakovi se šalju ovom brzinom; poruka može da ide sporije.",
    pitchHint: "Sinusni ton od 300 do 1200 Hz.",
    a4Hint: "415 do 466 Hz. Ista vrednost koju koristi i štimer na stranici.",
    invalid: "Vrednost je izvan dozvoljenog opsega.",
    reset: "Vrati na podrazumevano",
  },
};

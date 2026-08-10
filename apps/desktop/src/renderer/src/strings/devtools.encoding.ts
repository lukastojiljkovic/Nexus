/**
 * „Enkodiranje i dekodiranje" — the Serbian copy of this category's tool surfaces.
 *
 * One entry per tool id, keyed exactly as the registration in
 * `shared/modules.ts` spells it. The tool's NAME and its one-line blurb are not
 * here: those live in the `name` and `blurb` tables of `./devtools.ts`, because
 * the drawer's rail needs them before any surface is opened.
 */
export const DEVTOOLS_ENCODING_SR = {
  /**
   * Copy shared by more than one surface below: the phrase a refusal's
   * position is reported with, and the accessible name for every
   * encode/decode-shaped segmented switch (base64, URL kodiranje, HTML
   * entiteti, hexdump all have one).
   */
  common: {
    position: "na poziciji",
    direction: "Smer",
  },

  base64: {
    input: "Ulaz",
    output: "Rezultat",
    encode: "Kodiraj",
    decode: "Dekodiraj",
    alphabet: "Alfabet",
    alphabetStandard: "Standardni (+/)",
    alphabetUrl: "URL-bezbedan (-_)",
    alphabetAny: "Bilo koji",
    padded: "Dopuni znakom =",
    allowWhitespace: "Dozvoli prelome redova (MIME)",
    inputPlaceholder: "Nalepi tekst ili Base64 zapis",
    errNotBase64: "Nije Base64 — nedozvoljen znak ili dužina koju nijedan niz bajtova ne daje.",
    errPadding: "Broj znakova = ne odgovara dužini zapisa.",
    errNonCanonical: "Nekanonski zapis — poslednja grupa nosi bitove koji nisu nula.",
    errMixedAlphabet: "Zapis meša oba alfabeta (+/ i -_).",
    errNotUtf8: "Bajtovi nisu ispravan UTF-8.",
  },

  "url-encode": {
    input: "Ulaz",
    output: "Rezultat",
    encode: "Kodiraj",
    decode: "Dekodiraj",
    escaping: "Način",
    escapingComponent: "Deo URL-a",
    escapingUri: "Ceo URL",
    escapingForm: "Podatak forme",
    hintComponent: "Bezbedno kao jedna vrednost upita ili jedan segment putanje.",
    hintUri: "Čuva ; / ? : @ & = + $ , # — struktura URL-a ostaje netaknuta.",
    hintForm: "Razmak postaje +, a pravi plus postaje %2B.",
    inputPlaceholder: "Nalepi tekst ili kodirani zapis",
    errPercentEscape: "Neispravan escape — posle % moraju doći dve heks cifre.",
    errNotUtf8: "Escape sekvence su ispravne, ali bajtovi nisu UTF-8.",
    errLoneSurrogate: "Tekst sadrži polovinu surogat para, što nije znak.",
  },

  "url-parse": {
    input: "URL",
    inputPlaceholder: "https://primer.rs/putanja?a=1",
    href: "Normalizovan URL",
    scheme: "Šema",
    username: "Korisnik",
    password: "Lozinka",
    host: "Host",
    hostUnicode: "Host (Unicode)",
    isIdn: "IDN",
    port: "Port",
    defaultPort: "podrazumevani",
    path: "Putanja",
    query: "Parametri upita",
    queryKey: "Ključ",
    queryValue: "Vrednost",
    noQuery: "Nema parametara",
    fragment: "Fragment",
    empty: "—",
    errNotAUrl: "Ovo nije URL — šema nedostaje ili je zapis neispravan.",
  },

  "ascii-binary-hex": {
    input: "Tekst",
    inputPlaceholder: "Unesi tekst",
    decimal: "Decimalno (kodne tačke)",
    hex: "Heksadekadno (bajtovi)",
    binary: "Binarno (bajtovi)",
    characters: "Znakovi",
    perCharacter: "Po znaku",
    columnCharacter: "Znak",
    columnCodePoint: "Kodna tačka",
    columnHex: "Heks",
    columnBinary: "Binarno",
    reverseTitle: "Nazad u tekst",
    fromHex: "Iz heksadekadnog",
    fromBinary: "Iz binarnog",
    fromDecimal: "Iz decimalnog",
    noBytes: "nema UTF-8 zapis",
    hintUtf8: "UTF-8: jedan znak može biti više bajtova, zato su bajtovi grupisani po znaku.",
    errHex: "Nije lista heks bajtova — svaki token mora imati paran broj heks cifara.",
    errBinary: "Nije lista binarnih bajtova — svaki token mora imati broj bitova deljiv sa 8.",
    errCodePoints: "Nije lista kodnih tačaka — dozvoljeni su samo decimalni brojevi.",
    errOutOfRange: "Kodna tačka je van opsega ili je surogat, pa nije znak.",
    errNotUtf8: "Bajtovi nisu ispravan UTF-8.",
  },

  "unicode-inspector": {
    input: "Tekst",
    inputPlaceholder: "Nalepi tekst za pregled",
    codePoint: "Kodna tačka",
    character: "Znak",
    utf8: "UTF-8 bajtovi",
    utf16: "UTF-16 jedinice",
    surrogatePair: "Surogat par",
    yes: "Da",
    no: "Ne",
    category: "Kategorija",
    normalisation: "Normalizacija",
    changed: "menja tekst",
    unchanged: "ne menja tekst",
    codePointCount: "Kodnih tačaka",
    utf16Length: "UTF-16 jedinica",
    utf8ByteCount: "UTF-8 bajtova",
    graphemeCount: "Grafema",
    noUtf8: "nema UTF-8 zapis",
    hintLength: "Ono što JavaScript zove dužinom je broj UTF-16 jedinica, a ne broj znakova.",
    tooLong: "Predugačak unos — najviše {limit} znakova.",
  },

  "html-entities": {
    input: "Ulaz",
    output: "Rezultat",
    escape: "Kodiraj entitete",
    unescape: "Dekodiraj entitete",
    mode: "Obim",
    modeMinimal: "Minimalno — pet znakova markapa",
    modeAggressive: "Agresivno — sve što nije ASCII kao brojčani entitet",
    inputPlaceholder: "Nalepi HTML ili običan tekst",
    reference: "Tabela entiteta",
    referenceSearch: "Pretraži entitete",
    referenceName: "Naziv",
    referenceCharacter: "Znak",
    referenceCodePoint: "Kodna tačka",
    errUnterminated:
      "Znak & ne započinje entitet — nedostaje tačka-zarez ili je zapis nepotpun.",
    errUnknown: "Nepoznat naziv entiteta.",
    errOutOfRange: "Brojčani entitet nije Unicode znak — surogat ili van opsega.",
  },

  hexdump: {
    output: "Ispis",
    dump: "Napravi ispis",
    parse: "Pročitaj ispis",
    bytesPerLine: "Bajtova po redu",
    bytesPerGroup: "Bajtova po grupi",
    textLabel: "Tekst",
    textPlaceholder: "Unesi tekst za ispis",
    dumpLabel: "Hexdump",
    dumpPlaceholder: "Nalepi hexdump za čitanje",
    parsedBytes: "Pročitano bajtova",
    hintGutter:
      "ASCII kolona uvek ide između uspravnih crta — bez nje se njen sadržaj " +
      "ne razlikuje od podataka.",
    errLayout: "Ceo broj od 1 do {limit}.",
    errNotAHexdump: "Nije hexdump — token koji nije heks bajt.",
    errOffsetMismatch: "Ofset u redu ne odgovara broju do sada pročitanih bajtova.",
    errAmbiguousGutter:
      "ASCII kolona nije ograničena uspravnim crtama, pa se ne razlikuje od podataka. " +
      "Ukloni je ili koristi ispis sa crtama.",
  },
} as const;

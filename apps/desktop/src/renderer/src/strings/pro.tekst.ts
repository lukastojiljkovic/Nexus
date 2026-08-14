/**
 * „Tekst i prevod" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those live
 * in the `name` and `blurb` tables of `./pro.ts`, needed before any surface is
 * opened.
 *
 * None of this pack's tools carries `life-safety` or `food-safety` risk, so
 * nothing here is bound by „print the quantity, never a verdict" — but three
 * tools are `financial` (a wrong digit or a wrong word is money), and their
 * copy stays exactly as factual as everything else: a count, never a judgement
 * of the translation itself.
 */
export const PRO_TEKST_SR = {
  "bracket-balance": {
    text: "Tekst",
    textHint: "Nalepi tekst. Ništa se ne pamti između otvaranja alatke.",

    results: "Rezultat",
    maxDepth: "Najveća dubina ugnežđavanja",

    unclosedSection: "Nezatvoreni otvarači",
    unclosedNone: "Nema nezatvorenih otvarača.",
    unmatchedSection: "Višak zatvarača",
    unmatchedNone: "Nema viška zatvarača.",
    oddQuoteSection: "Pasusi sa neparnim brojem pravih navodnika",
    oddQuoteNone: "Svaki pasus ima paran broj pravih navodnika \" i '.",

    colChar: "Znak",
    colLine: "Red",
    colColumn: "Kolona",
    colOpenOnTop: "Otvarač na vrhu steka",
    stackEmpty: "stek prazan",
    colParagraph: "Pasus",
    colStartLine: "Početni red",
    colDoubleQuotes: "Broj znakova \"",
    colSingleQuotes: "Broj znakova '",

    inputs: "Uneseno",
    formula:
      "stek: otvarač → gurni; zatvarač → skini ako se poklapa sa vrhom, inače prijavi i ne diraj " +
      "stek     „ i ' se razrešavaju po vrhu steka; pravi navodnici \" i ' se broje po parnosti " +
      "unutar pasusa",

    errorText: "Tekst sme imati najviše 500000 kodnih tačaka.",
  },

  "glossary-check": {
    original: "Original",
    originalHint: "Izvorni tekst, nalepljen.",
    translation: "Prevod",
    translationHint: "Prevedeni tekst, nalepljen.",
    glossary: "Rečnik pojmova",
    glossaryHint:
      "Jedan par po redu, izvor i prevod razdvojeni tabulatorom ili znakom |. Ništa se ne pamti " +
      "između otvaranja.",
    caseSensitive: "Razlikuj velika i mala slova",
    wholeWord: "Traži celu reč",
    wholeWordHint: "Isključeno hvata i srpsku promenu po padežima preko osnove termina.",
    on: "Uključeno",
    off: "Isključeno",

    results: "Rezultat",
    rowsNone: "Rečnik nema nijedan ispravan red.",
    colSource: "Termin (original)",
    colTarget: "Zadati prevod",
    colInOriginal: "Pojavljivanja u originalu",
    colInTranslation: "Pojavljivanja u prevodu",
    colStatus: "Status",
    invalidRows: "Neispravni redovi rečnika",
    invalidRowsNone: "nema",

    statusMatch: "U REDU",
    statusDiffers: "RAZLIKA",
    statusMissing: "NEDOSTAJE",
    statusExtra: "VIŠAK",
    statusAbsent: "NEMA",

    inputs: "Uneseno",
    formula:
      "a = pojavljivanja izvornog termina u originalu, b = pojavljivanja zadatog prevoda u " +
      "prevodu     a=0,b=0 → NEMA; a>0,b=0 → NEDOSTAJE; a=0,b>0 → VIŠAK; a=b → U REDU; a≠b → " +
      "RAZLIKA",

    errorOriginal: "Original sme imati najviše 500000 kodnih tačaka.",
    errorTranslation: "Prevod sme imati najviše 500000 kodnih tačaka.",
    errorGlossary:
      "Rečnik mora imati između 1 i 2000 redova sa parom razdvojenim tabulatorom ili znakom |.",
  },

  "hidden-characters": {
    text: "Tekst",
    textHint: "Nalepi tekst. Ništa se ne pamti između otvaranja alatke.",
    removeInvisible: "Ukloni nevidljive",
    removeInvisibleHint:
      "Briše kontrolne, znakove širine nula i dvosmerne upravljače. Ne dira razmake ni crticu.",
    normalizeSpaces: "NBSP i slični razmaci → običan razmak",
    normalizeSpacesHint:
      "Menja svaki neobičan razmak jedan za jedan, nikad ga ne briše — brisanje bi spojilo reči.",
    removeSoftHyphen: "Ukloni meku (uslovnu) crticu",
    on: "Uključeno",
    off: "Isključeno",

    results: "Rezultat",
    codePointsBefore: "Kodnih tačaka pre",
    codePointsAfter: "Kodnih tačaka posle",
    findingsNone: "Nema nevidljivih ni kontrolnih znakova.",
    colKind: "Vrsta",
    colName: "Kodna tačka i naziv",
    colLine: "Red",
    colColumn: "Kolona",
    mixedNone: "Nema reči sa pomešanim pismima.",
    colWord: "Reč",
    colScripts: "Pisma",
    cleaned: "Očišćen tekst",
    cleanedEmpty: "Tekst je prazan.",

    kindControl: "kontrolni znak",
    kindSpace: "razmak koji nije običan",
    kindZeroWidth: "znak širine nula",
    kindSoftHyphen: "meka (uslovna) crtica",
    kindBidi: "dvosmerni upravljač",

    scriptLatin: "latinica",
    scriptCyrillic: "ćirilica",
    scriptGreek: "grčko pismo",
    scriptArabic: "arapsko pismo",
    scriptHebrew: "hebrejsko pismo",
    scriptHan: "kinesko pismo (Han)",
    scriptOther: "ostalo",

    inputs: "Uneseno",
    formula:
      "nalaz = kodna tačka sa spiska nevidljivih/kontrolnih; pomešano pismo = reč čiji skup " +
      "pisama ima ≥ 2 člana (Common i Inherited se ne broje)",

    errorText: "Tekst sme imati najviše 500000 kodnih tačaka.",
  },

  "isbn-issn-check": {
    number: "Broj",
    numberHint: "Cifre sa proizvoljnim crticama i razmacima, i X kao mogućom poslednjom cifrom.",
    kind: "Vrsta",
    kindAuto: "Prepoznaj sam",
    kindIsbn10: "ISBN-10",
    kindIsbn13: "ISBN-13",
    kindIssn: "ISSN",
    kindIssn13: "ISSN (13-cifreni zapis, prefiks 977)",
    kindIsmn: "ISMN",
    kindEan13: "EAN-13",

    results: "Rezultat",
    recognizedKind: "Prepoznata vrsta",
    digits: "Očišćene cifre",
    checkDigit: "Upisana kontrolna cifra",
    expectedCheckDigit: "Izračunata kontrolna cifra",
    matches: "Poklapanje",
    matchYes: "Poklapa se",
    matchNo: "Ne poklapa se",
    isbn13: "Pretvoreno u ISBN-13",
    isbn10: "Pretvoreno u ISBN-10",
    issn8: "Izdvojeni ISSN",

    inputs: "Uneseno",
    formula:
      "ISBN-10: Σ dᵢ×(11−i) ≡ 0 (mod 11)     ISBN-13 / ISMN / EAN-13: GS1, težine 1,3, mod 10    " +
      " ISSN: težine 8..2, mod 11 — crtice se ne postavljaju",

    errorNumber:
      "Broj mora imati 8, 10 ili 13 cifara (X dozvoljeno kao poslednja cifra kod ISBN-10 i ISSN).",
    errorKind: "Dužina broja ne odgovara izabranoj vrsti.",
  },

  "mojibake-repair": {
    text: "Tekst",
    textHint: "Nalepi pokvaren tekst, na primer „Å¡\" ili „Ä‡\".",
    writtenAs: "Pisano kao",
    writtenAsHint: "Kodiranje kojim su bajtovi ZAISTA napisani.",
    readAs: "Pročitano kao",
    readAsHint: "Kodiranje kojim su ti bajtovi POGREŠNO pročitani — to je kvar koji se poništava.",
    selectPlaceholder: "— izaberi —",

    results: "Rezultat",
    repaired: "Popravljen tekst",
    notPossible: "Popravka nije moguća sa ovim izborom kodiranja.",
    unmappableCount: "Znakova bez bajta u kodiranju „pročitano kao\"",
    invalidByteCount: "Bajtova koji ne čine ispravan niz u kodiranju „pisano kao\"",
    colIndex: "Indeks",
    colChar: "Znak",
    colByte: "Bajt (dekadno)",
    resolvedWrittenAs: "Kodiranje „pisano kao\" je razrešeno na",
    resolvedReadAs: "Kodiranje „pročitano kao\" je razrešeno na",
    collisions: "Bajtova sa istim znakom kao manji bajt",

    inputs: "Uneseno",
    formula:
      "1) znak → bajt po inverznoj mapi kodiranja „pročitano kao\"     " +
      "2) taj niz bajtova → tekst, dekodiran kodiranjem „pisano kao\"",

    errorText: "Tekst sme imati najviše 500000 kodnih tačaka.",
    errorReplacementCharacter: "Tekst već sadrži U+FFFD — ti bajtovi su nepovratno izgubljeni.",
    errorReadAs: "Ovo kodiranje platforma ne prepoznaje.",
    errorWrittenAs: "Ovo kodiranje platforma ne prepoznaje.",
  },

  "number-check": {
    original: "Original",
    originalHint: "Izvorni tekst, nalepljen.",
    translation: "Prevod",
    translationHint: "Prevedeni tekst, nalepljen.",

    results: "Rezultat",
    pairedCount: "Uparenih pojavljivanja",
    onlyInOriginalCount: "Samo u originalu",
    onlyInTranslationCount: "Samo u prevodu",

    pairedSection: "Uparen niz cifara",
    pairedNone: "Nema uparenih brojeva.",
    onlyOriginalSection: "Samo u originalu (nedostaje u prevodu)",
    onlyOriginalNone: "Nema brojeva koji nedostaju.",
    onlyTranslationSection: "Samo u prevodu (višak)",
    onlyTranslationNone: "Nema viška brojeva.",
    differentLengthSection: "Isti niz cifara, različita dužina zapisa",
    differentLengthNone: "Nema takvih parova.",

    colDigits: "Niz cifara",
    colFormsOriginal: "Zatečeni oblici (original)",
    colFormsTranslation: "Zatečeni oblici (prevod)",
    colCount: "Broj",

    inputs: "Uneseno",
    formula:
      "broj = /\\d+(?:[.,␠']\\d+)*/     poređenje po nizu cifara bez separatora     " +
      "isti niz + različita dužina zapisa = mogući ispušten decimalni zarez",

    errorOriginal: "Original sme imati najviše 500000 kodnih tačaka.",
    errorTranslation: "Prevod sme imati najviše 500000 kodnih tačaka.",
  },

  "number-to-serbian-words": {
    value: "Broj",
    valueHint:
      "Decimalni razdvajač je isključivo zapeta, na primer −1234,56. Do 18 cifara u celom delu, " +
      "do 6 decimala.",
    script: "Pismo",
    scriptLatinOpt: "Latinica",
    scriptCyrillicOpt: "Ćirilica",
    thousandForm: "Oblik za 1000",
    thousandFormHint: "Oba oblika su ispravna — bira ih onaj ko piše tekst, ne alatka.",
    thousandFormHiljadu: "hiljadu",
    thousandFormJednaHiljada: "jedna hiljada",
    decimals: "Decimale",
    decimalsFraction: "Kao razlomak (NN/10ᵈ)",
    decimalsWords: "Ispisano rečima",
    decimalsNone: "Bez decimala",
    selectPlaceholder: "— izaberi —",

    results: "Rezultat",
    resultText: "Broj rečima",
    truncatedNote: "Decimale su odsečene, ne zaokružene.",

    inputs: "Uneseno",
    formula:
      "hiljada/milion/milijarda/bilion po grupama od tri cifre, zdesna nalevo; slaganje: 11–14 → " +
      "množina druga, …1 (osim 11) → jednina, …2–4 (osim 12–14) → paukal, ostalo → množina druga",

    errorValue:
      "Broj mora biti ceo ili decimalni sa zapetom, do 18 cifara u celom delu i do 6 decimala.",
  },

  "reading-time": {
    text: "Tekst",
    textHint: "Nalepi tekst koji se čita naglas. Ništa se ne pamti između otvaranja alatke.",
    pace: "Tempo",
    paceHint: "Reči u minutu — izmereno kod ovog govornika, ne procena alatke.",
    pause: "Pauza između pasusa",
    pauseHint: "U sekundama. Prazno polje se čita kao 0.",
    pauseZero: "0 (prazno polje)",

    results: "Rezultat",
    totalClock: "Ukupno trajanje",
    words: "Ukupan broj reči",
    displayedSum: "Zbir prikazanih trajanja",
    sumNote:
      "Vreme ulaska se seče nadole, trajanje i ukupno se zaokružuju — zbir prikazanih trajanja " +
      "zato sme da se razlikuje od ukupnog za jednu sekundu.",
    colParagraph: "Pasus",
    colWords: "Reči",
    colDuration: "Trajanje",
    colEntry: "Vreme ulaska",

    inputs: "Uneseno",
    formula:
      "trajanjePasusa = reči / tempo × 60     vremeUlaska(i+1) = vremeUlaska(i) + " +
      "trajanjePasusa(i) + pauza",

    errorText: "Tekst sme imati najviše 500000 kodnih tačaka.",
    errorPace: "Tempo mora biti veći od nule, do 1000 reči u minutu.",
    errorPause: "Pauza je broj sekundi od 0 do 600.",
  },

  "sentence-length": {
    text: "Tekst",
    textHint: "Nalepi tekst. Ništa se ne pamti između otvaranja alatke.",
    threshold: "Prag",
    thresholdHint: "Broj reči — rečenica duža od ovoga se obeležava. Ceo broj od 1 do 200.",

    results: "Rezultat",
    count: "Broj rečenica",
    totalWords: "Ukupno reči",
    averageWords: "Prosek reči po rečenici",
    longest: "Najduža rečenica",
    words: "reči",
    yes: "da",
    no: "ne",
    colIndex: "#",
    colWords: "Reči",
    colText: "Rečenica",
    colOverThreshold: "Preko praga",

    inputs: "Uneseno",
    formula:
      "kraj rečenice: ./!/?/… praćeno razmakom ili krajem teksta, a sledeće slovo NIJE malo — " +
      "izuzeci za datum (12. 5. 2020.) i inicijal (J. Jovanović)",

    errorText: "Tekst sme imati najviše 500000 kodnih tačaka.",
    errorThreshold: "Prag je ceo broj reči od 1 do 200.",
  },

  "serbian-transliteration": {
    text: "Tekst",
    textHint: "Nalepi tekst. Ništa se ne pamti između otvaranja alatke.",
    direction: "Smer",
    directionCyrillicToLatin: "Ćirilica → latinica",
    directionLatinToCyrillic: "Latinica → ćirilica",
    selectPlaceholder: "— izaberi —",

    results: "Rezultat",
    resultText: "Preslovljen tekst",
    ambiguitiesNoneDirection: "Ovaj smer je jednoznačan — tabela je uvek prazna.",
    ambiguitiesNoneOther: "Nema dvosmislenih mesta u ovom tekstu.",
    colSequence: "Niz",
    colLine: "Red",
    colColumn: "Kolona",
    colWord: "Reč",
    colReason: "Razlog",
    reasonDigraph: "dvoslov lj/nj/dž",
    reasonDj: "„dj\" — nikad se ne pretvara u đ",

    inputs: "Uneseno",
    formula:
      "ćirilica → latinica: zamena po tabeli od 30 parova, veličina dvoslova po kontekstu     " +
      "latinica → ćirilica: lj/nj/dž pohlepno, svako poklapanje se prijavljuje; „dj\" se nikad " +
      "ne čita kao đ",

    errorText: "Tekst sme imati najviše 500000 kodnih tačaka.",
  },

  "subtitle-audit": {
    subtitle: "Titl (SRT ili WebVTT)",
    subtitleHint: "Nalepi ceo sadržaj fajla. Do 20000 blokova.",
    maxLineChars: "Najviše znakova u redu",
    maxLines: "Najviše redova u bloku",
    minDuration: "Najkraće trajanje (ms)",
    maxDuration: "Najduže trajanje (ms)",
    maxCps: "Najviše znakova u sekundi",
    minGap: "Najmanji razmak do sledećeg (ms)",
    limitHint: "Granicu propisuje naručilac ili emiter za ovaj posao. Nexus ne nudi vrednost.",
    countTags: "Broj oznake tipa <i> u znakove",
    countTagsHint: "Isključeno uklanja <i> i ASS naredbe pre brojanja znakova.",
    on: "Uključeno",
    off: "Isključeno",

    results: "Rezultat",
    colDuration: "Trajanje (ms)",
    colMaxDurationRatio: "Trajanje ÷ tvoja granica",
    colMinDurationRatio: "Tvoja granica ÷ trajanje",
    colChars: "Znakova",
    colCps: "Zn/s",
    colCpsRatio: "Zn/s ÷ tvoja granica",
    colLongestLine: "Najduži red",
    colLongestLineRatio: "Najduži red ÷ tvoja granica",
    colLines: "Redova",
    colLinesRatio: "Redova ÷ tvoja granica",
    colGap: "Razmak (ms)",
    colGapRatio: "Razmak ÷ tvoja granica",
    ratioNote:
      "Za najkraće trajanje odnos je obrnut (granica ÷ trajanje), da veći broj uvek znači „dalje " +
      "od granice\". Prazna kolona znači da ta granica nije upisana.",

    nonPositiveDuration: "Blokovi sa nultim ili negativnim trajanjem",
    outOfOrder: "Blokovi van redosleda",
    overlapping: "Blokovi koji se preklapaju (negativan razmak)",
    listNone: "nema",

    inputs: "Uneseno",
    formula:
      "trajanje = izlaz − ulaz     zn/s = znakova / (trajanje / 1000)     odnos = izmereno ÷ " +
      "tvoja granica",

    errorSubtitle: "Titl mora imati između 1 i 20000 validnih blokova.",
    errorMaxLineChars: "Najviše znakova u redu je ceo broj od 1 do 200.",
    errorMaxLines: "Najviše redova u bloku je ceo broj od 1 do 10.",
    errorMinDuration: "Najkraće trajanje je ceo broj milisekundi od 0 do 60000.",
    errorMaxDuration: "Najduže trajanje je ceo broj milisekundi od 0 do 600000.",
    errorMaxCps: "Najviše znakova u sekundi je broj od 0 do 100.",
    errorMinGap: "Najmanji razmak je ceo broj milisekundi od 0 do 10000.",
  },

  "subtitle-retime": {
    subtitle: "Titl (SRT ili WebVTT)",
    subtitleHint: "Nalepi ceo sadržaj fajla. Do 20000 blokova.",
    offset: "Pomeraj",
    offsetHint: "+HH:MM:SS,mmm ili broj milisekundi, predznak dozvoljen. Prazno polje znači 0.",
    offsetZero: "0 (prazno polje)",
    fromFps: "Polazni broj slika u sekundi",
    toFps: "Ciljni broj slika u sekundi",
    fpsHint: "Prazno na oba polja znači bez preračuna brzine — samo pomeraj.",
    fpsNone: "— bez preračuna —",
    renumber: "Prenumeriši blokove",
    on: "Uključeno",
    off: "Isključeno",

    results: "Rezultat",
    resultText: "Izmenjen titl",
    blocks: "Obrađenih blokova",
    clamped: "Odsečeno na 00:00:00,000",
    endBeforeStart: "Blokovi sa krajem pre početka",
    endBeforeStartNone: "nema",

    inputs: "Uneseno",
    formula:
      "preračun: novo = round(ms × ulazniBrojilac × ciljniImenilac / (ulazniImenilac × " +
      "ciljniBrojilac))     pomeraj: konačno = max(0, preračunato + pomerajMs)",

    errorSubtitle: "Titl mora imati između 1 i 20000 validnih blokova.",
    errorOffset: "Pomeraj je HH:MM:SS,mmm ili broj milisekundi, od −86400000 do +86400000.",
    errorFromFps: "Polazni broj slika u sekundi nije važeći.",
    errorToFps: "Ciljni broj slika u sekundi nije važeći.",
  },

  "translation-volume": {
    text: "Tekst",
    textHint: "Nalepi tekst čiji se obim meri. Ništa se ne pamti između otvaranja alatke.",
    charsPerPage: "Znakova po strani",
    charsPerPageHint:
      "Broj koji propisuje naručilac ili udruženje (često 1800 ili 1500). Menja se od posla do " +
      "posla.",
    price: "Cena po jedinici",
    priceHint:
      "Valuta se ne pretpostavlja i ne prikazuje. Prazno polje znači da se iznosi ne prikazuju.",
    priceEmpty: "prazno",
    unit: "Jedinica naplate",
    unitPage: "Strana",
    unitWord: "Reč",
    unitCharacter: "Znak sa razmacima",
    selectPlaceholder: "— izaberi —",

    results: "Rezultat",
    charactersWithSpaces: "Znakova sa razmacima",
    charactersWithLineBreaks: "Znakova sa razmacima i prelomima reda",
    lineBreakNote:
      "Znakova sa razmacima NE broji prelom reda — to je isti broj koji pokazuje MS Word i s " +
      "njim se upoređuje faktura. Druga vrednost broji i prelome, radi poređenja sa dužinom " +
      "samog pasta.",
    charactersWithoutSpaces: "Znakova bez razmaka",
    wordsBySpaces: "Reči (razdvojenih razmakom)",
    wordsByLetters: "Reči (nizovi slova)",
    pagesExact: "Strana (tačno)",
    pagesRoundedUp: "Strana (zaokruženo naviše)",
    amountExact: "Iznos po tačnom obimu",
    amountRoundedUp: "Iznos po zaokruženom obimu",
    noCurrencyNote: "Valuta nije prikazana — nije data kao unos.",

    inputs: "Uneseno",
    formula:
      "stranaTačno = znakovaSaRazmacima / znakovaPoStrani     stranaNaviše = ⌈stranaTačno⌉     " +
      "iznos = cena × (nezaokružena) količina",

    errorText: "Tekst sme imati najviše 500000 kodnih tačaka.",
    errorCharsPerPage: "Znakova po strani je ceo broj od 100 do 20000.",
    errorPrice: "Cena je broj od 0 do 100000000.",
  },

  "typography-cleanup": {
    text: "Tekst",
    textHint: "Nalepi tekst. Ništa se ne pamti između otvaranja alatke.",
    style: "Stil navodnika",
    styleCurly: "„…\"",
    styleGuillemets: "«…»",
    styleStraight: "\"…\" (ostavi prave)",
    selectPlaceholder: "— izaberi —",
    quotes: "Navodnici",
    ellipses: "Tri tačke → …",
    dashes: "Crte",
    spaces: "Razmaci",
    nbsp: "NBSP → običan razmak",
    nbspHint: "Menja U+00A0 razmakom, nezavisno od pravila „Navodnici\".",
    on: "Uključeno",
    off: "Isključeno",

    results: "Rezultat",
    resultText: "Očišćen tekst",
    total: "Ukupno izmena",
    codePointsBefore: "Kodnih tačaka pre",
    codePointsAfter: "Kodnih tačaka posle",

    inputs: "Uneseno",
    formula:
      "poredak: navodnici → tri tačke → crte → razmaci → NBSP     crta dužine 1 samo između " +
      "razmaka ili cifara, dužine 2 → –, dužine 3 → —",

    errorText: "Tekst sme imati najviše 500000 kodnih tačaka.",
  },

  "unwrap-paragraphs": {
    text: "Tekst",
    textHint:
      "Nalepi tekst prelomljen kopiranjem iz PDF-a. Ništa se ne pamti između otvaranja alatke.",
    joinHyphenated: "Sastavi reči rastavljene crticom",
    respectListItems: "Poštuj stavke spiska",
    respectListItemsHint:
      "Red koji počinje sa -, –, •, * ili brojem i tačkom/zagradom ostaje svoj red.",
    splitOnSentenceEnd: "Novi pasus posle završene rečenice",
    splitOnSentenceEndHint: "Za tekstove iz kojih su prazni redovi ispali.",
    on: "Uključeno",
    off: "Isključeno",

    results: "Rezultat",
    resultText: "Sređen tekst",
    joinedLines: "Spojenih redova",
    joinedWords: "Sastavljenih reči",
    paragraphs: "Pasusa u rezultatu",

    inputs: "Uneseno",
    formula:
      "redom: 1) crtica + malo slovo → sastavi reč     2) oznaka stavke spiska → ne spajaj     " +
      "3) kraj rečenice → novi pasus     4) inače → spoj sa jednim razmakom",

    errorText: "Tekst sme imati najviše 500000 kodnih tačaka.",
  },

  "word-frequency": {
    text: "Tekst",
    textHint: "Nalepi tekst. Ništa se ne pamti između otvaranja alatke.",
    n: "Dužina fraze (reči)",
    nHint: "Ceo broj od 1 do 10.",
    minCount: "Najmanji broj pojavljivanja",
    minCountHint: "Filtrira samo prikaz — imenilac udela ostaje pun. Ceo broj od 1 do 1000.",
    minWordLength: "Najmanja dužina reči",
    minWordLengthHint:
      "Primenjuje se samo kad je dužina fraze 1. Filtrira samo prikaz. Ceo broj od 1 do 50.",
    caseSensitive: "Razlikuj velika i mala slova",
    on: "Uključeno",
    off: "Isključeno",

    results: "Rezultat",
    totalWords: "Ukupno reči",
    totalNgrams: "Ukupno n-torki",
    distinctPhrases: "Različitih fraza",
    rowsNone: "Nijedna fraza ne prelazi zadate pragove.",
    colPhrase: "Fraza",
    colCount: "Pojavljivanja",
    colShare: "Udeo",

    inputs: "Uneseno",
    formula:
      "udeo = pojavljivanja / ukupnoNTorki × 100     oba praga filtriraju samo prikaz, ne i " +
      "imenilac",

    errorText: "Tekst sme imati najviše 500000 kodnih tačaka.",
    errorN: "Dužina fraze je ceo broj od 1 do 10.",
    errorMinCount: "Najmanji broj pojavljivanja je ceo broj od 1 do 1000.",
    errorMinWordLength: "Najmanja dužina reči je ceo broj od 1 do 50.",
  },
} as const;

/**
 * „Dizajn i priprema za štampu" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment spells it. The tool's
 * NAME and its one-line blurb are not here: those live in a table another
 * process owns.
 *
 * **Every tool in this pack is `riskClass: "none"`.** There is no regulatory
 * limit anywhere in it, so this file never writes a „tvoja granica" line —
 * that phrasing belongs to a pack that actually takes one.
 *
 * A unit is copy, not a constant: written out here rather than concatenated
 * in the surface.
 */
export const PRO_DIZAJN_SR = {
  "aspect-ratio-fit": {
    sourceWidth: "Širina izvora",
    sourceHint: "U pikselima ili milimetrima — ista jedinica za sve unose ovde.",
    sourceHeight: "Visina izvora",
    mode: "Način uklapanja",
    modeContain: "Uklopi (letterbox)",
    modeCover: "Popuni (isečeno)",
    modeExactWidth: "Tačna širina",
    modeExactHeight: "Tačna visina",
    modeStretch: "Razvuci",
    targetWidth: "Širina okvira",
    targetHint: "Potrebno za sve načine osim „tačna visina\".",
    targetHeight: "Visina okvira",
    roundTo: "Zaokruživanje",
    roundToNone: "Bez",
    roundToPixel: "Ceo piksel",

    results: "Rezultat",
    ratioInteger: "Skraćeni odnos",
    noIntegerRatio: "Nema celobrojnog odnosa (dimenzije izvora nisu oba cela broja)",
    ratioDecimal: "Decimalni odnos",
    scale: "Faktor uvećanja",
    scaleX: "Faktor uvećanja po širini",
    scaleY: "Faktor uvećanja po visini",
    distortion: "Distorzija (sx ÷ sy)",
    outputWidth: "Dobijena širina",
    outputHeight: "Dobijena visina",
    displayWidth: "Prikazana širina (posle zaokruživanja)",
    displayHeight: "Prikazana visina (posle zaokruživanja)",
    displayRatioLabel: "Odnos prikazane veličine",
    roundingRemainderWidth: "Pomeraj zaokruživanja po širini",
    roundingRemainderHeight: "Pomeraj zaokruživanja po visini",
    barWidth: "Traka po širini (sa svake strane)",
    barHeight: "Traka po visini (sa svake strane)",
    cropWidth: "Rez po širini (sa svake strane, u jedinicama okvira)",
    cropHeight: "Rez po visini (sa svake strane, u jedinicama okvira)",
    cropWidthSource: "Rez po širini (u jedinicama izvora)",
    cropHeightSource: "Rez po visini (u jedinicama izvora)",
    visibleSourceWidth: "Vidljiva širina izvora",
    visibleSourceHeight: "Vidljiva visina izvora",

    inputs: "Uneseno",
    formula:
      "uklopi: s = min(tw/w, th/h)   popuni: s = max(tw/w, th/h)   tačna širina: s = tw/w   " +
      "tačna visina: s = th/h   razvuci: sx = tw/w, sy = th/h",

    errorSourceWidth: "Širina izvora mora biti veća od nule.",
    errorSourceHeight: "Visina izvora mora biti veća od nule.",
    errorTargetWidth: "Širina okvira je potrebna za ovaj način uklapanja.",
    errorTargetHeight: "Visina okvira je potrebna za ovaj način uklapanja.",
    errorRoundTo: "Neispravan način zaokruživanja.",
    errorMode: "Neispravan način uklapanja.",
  },

  "baseline-rhythm": {
    fontSize: "Veličina slova",
    lineHeight: "Prored",
    lineHeightHint: "Čita se kao množilac ili kao pikseli, prema izboru pored.",
    lineHeightUnit: "Jedinica proreda",
    unitMultiplier: "Množilac",
    unitPx: "px",
    gridUnit: "Jedinica osnovne mreže",
    gridUnitHint: "Korak mreže u pikselima. Podrazumevano 8.",
    columnHeight: "Visina kolone",
    columnHeightHint: "Opciono — samo ako želiš i broj redova po koloni.",
    snapMode: "Nalepljivanje na mrežu",
    snapUp: "Naviše",
    snapNearest: "Na najbliže",
    snapDown: "Naniže",

    results: "Rezultat",
    lineHeightPx: "Prored u pikselima",
    multiplier: "Prored kao množilac",
    leading: "Razmak (prored − veličina slova)",
    halfLeading: "Polovina razmaka",
    gridRemainder: "Ostatak do mreže",
    onGrid: "Pada na mrežu",
    yes: "Da",
    no: "Ne",
    snapped: "Prored posle nalepljivanja",
    snappedMultiplier: "Nalepljen prored kao množilac",
    snappedLeading: "Razmak posle nalepljivanja",
    columnRaw: "Kolona — sirov prored",
    lines: "Broj redova",
    used: "Zauzeta visina",
    leftover: "Ostatak",
    columnSnapped: "Kolona — nalepljen prored",

    inputs: "Uneseno",
    formula:
      "lh = množilac×veličina ili px   ostatak = lh mod mreža (u milihiljaditim delovima px)   " +
      "nalepljeno = naviše/najbliže/naniže(lh/mreža)×mreža   redova = floor(visinaKolone/lh)",

    errorFontSize: "Veličina slova mora biti veća od nule.",
    errorLineHeight: "Prored mora biti veći od nule.",
    errorGridUnit: "Jedinica osnovne mreže mora biti veća od nule.",
    errorLineHeightUnit: "Neispravna jedinica proreda.",
    errorSnapMode: "Neispravan način nalepljivanja.",
    errorColumnHeight: "Visina kolone mora biti veća od nule.",
  },

  "book-spine": {
    pageCount: "Broj strana",
    paperCaliper: "Debljina lista (upisano ručno)",
    paperCaliperHint:
      "U milimetrima, izmereno mikrometrom na JEDNOM listu. Ima prednost nad ostala dva izvora.",
    grammage: "Gramatura",
    grammageHint: "Masa papira u g/m² — nije debljina.",
    bulk: "Volumen (cm³/g)",
    bulkHint:
      "Podatak proizvođača papira — NIJE debljina lista. Ako ovde upišeš debljinu (npr. 0,10 " +
      "umesto 1,25), hrbat izlazi i do 12,5 puta tanji: proveri red „Debljina lista (iz " +
      "gramature)\" ispod.",
    measuredStack: "Izmerena visina bloka",
    measuredStackHint:
      "U milimetrima, za ceo izmereni blok — treći izvor debljine lista, ako prva dva nisu " +
      "poznata.",
    coverCaliper: "Debljina jedne korice",
    extraAllowance: "Dodatak (lepak, forzec, kartoni)",
    extraAllowanceHint: "Sve što povez dodaje hrbatu mimo blok i korice.",
    coverWidth: "Širina jedne korice",
    coverHeight: "Visina korice",
    edgeWrap: "Napust korice (po ivici)",
    edgeWrapHint:
      "Za korice koje omotavaju preko ivice bloka — primenjuje se na sve spoljne ivice.",
    bindingStyle: "Vrsta poveza",
    bindingSoft: "Meki",
    bindingHard: "Tvrdi",
    hingeGroove: "Žleb (jedan, tvrd povez)",
    hingeGrooveHint:
      "Širina jednog žleba — primenjuje se samo kod tvrdog poveza, sa obe strane hrbata.",

    results: "Rezultat",
    leaves: "Broj listova",
    caliper: "Debljina lista (upotrebljena)",
    sourceTyped: "upisano ručno",
    sourceGrammage: "iz gramature i volumena",
    sourceMeasured: "iz izmerenog bloka",
    block: "Debljina bloka",
    spine: "Hrbat",
    flatCoverWidth: "Širina razvijene korice",
    flatCoverHeight: "Visina razvijene korice",

    inputs: "Uneseno",
    formula:
      "listovi = ceil(strane/2)   debljinaLista = upisano | gramatura×volumen/1000 | " +
      "izmerenoBlok/listovi   blok = listovi×debljinaLista   hrbat = blok + 2×korica + dodatak   " +
      "razvijenaŠirina = 2×širinaKorice + hrbat + 2×napust (+ 2×žleb za tvrd povez)   " +
      "razvijenaVisina = visinaKorice + 2×napust",

    errorPageCount: "Broj strana je ceo broj od 1 do 20000.",
    errorCoverCaliper: "Debljina korice ne sme biti negativna.",
    errorExtraAllowance: "Dodatak ne sme biti negativan.",
    errorEdgeWrap: "Napust korice ne sme biti negativan.",
    errorHingeGroove: "Žleb ne sme biti negativan.",
    errorBindingStyle: "Neispravna vrsta poveza.",
    errorPaperCaliper: "Debljina lista mora biti veća od nule.",
    errorGrammage: "Gramatura mora biti veća od nule.",
    errorBulk: "Volumen mora biti veći od nule.",
    errorMeasuredStack: "Izmerena visina bloka mora biti veća od nule.",
    errorCaliper:
      "Potreban je bar jedan izvor debljine lista: upisana debljina, gramatura i volumen, ili " +
      "izmereni blok.",
    errorCoverWidth: "Širina korice mora biti veća od nule.",
    errorCoverHeight: "Visina korice mora biti veća od nule.",
  },

  "column-grid": {
    containerWidth: "Širina sadržaoca",
    columns: "Broj kolona",
    gutter: "Razmak između kolona",
    outerMargin: "Spoljna margina (sa svake strane)",
    spanColumns: "Raspon k kolona",
    spanColumnsHint: "Opciono — širina raspona od k susednih kolona.",
    minColumnWidth: "Najmanja širina kolone",
    minColumnWidthHint: "Za obrnuto pitanje — koliko kolona te širine stane.",

    results: "Rezultat",
    contentWidth: "Širina sadržaja",
    columnWidth: "Širina kolone",
    noGrid: "Mreža ne postaje — razmaci sami premašuju sadržaj. Potrebna širina sadržaja",
    columnPercent: "Širina kolone (% sadržaja)",
    span: "Traženi raspon",
    colIndex: "k",
    colSpan: "Raspon(k)",
    colLeftEdge: "Leva ivica",
    maxColumns: "Najviše kolona te širine",

    inputs: "Uneseno",
    formula:
      "sadržaj = sadržalac − 2×margina   kolona = (sadržaj − (n−1)×razmak)/n   raspon(k) = " +
      "k×kolona + (k−1)×razmak   levaIvica(i) = margina + (i−1)×(kolona+razmak)   maxKolona = " +
      "floor((sadržaj+razmak)/(min+razmak))",

    errorContainerWidth: "Širina sadržaoca mora biti veća od nule.",
    errorColumns: "Broj kolona je ceo broj od 1 do 24.",
    errorGutter: "Razmak ne sme biti negativan.",
    errorOuterMargin: "Margine su prevelike — sadržajna širina mora ostati veća od nule.",
    errorSpanColumns: "Raspon mora biti ceo broj između 1 i broja kolona.",
    errorMinColumnWidth: "Najmanja širina kolone mora biti veća od nule.",
  },

  copyfitting: {
    characterCount: "Broj znakova",
    charactersPerLine: "Znakova u redu",
    charactersPerLineHint:
      "Upiši direktno, ili ostavi prazno i popuni širinu kolone i prosečnu širinu znaka ispod.",
    columnWidth: "Širina kolone",
    averageCharacterWidth: "Prosečna širina znaka",
    averageCharacterWidthHint: "Izmereno na stvarnom slogu, u milimetrima.",
    linesPerColumn: "Redova po koloni",
    linesPerColumnHint: "Upiši direktno, ili ostavi prazno i popuni visinu kolone i prored ispod.",
    columnHeight: "Visina kolone",
    lineHeight: "Prored",
    columnsPerPage: "Kolona po strani",
    targetPages: "Ciljani broj strana",
    targetPagesHint:
      "Opciono — obrnuto pitanje: koliko znakova u redu bi upakovalo tekst na tačno ovoliko " +
      "strana.",
    paragraphs: "Broj pasusa",
    paragraphsHint:
      "Opciono — svaki pasus posle prvog može ostaviti do jedan ceo red prazan na svom prelomu.",

    results: "Rezultat",
    totalLines: "Ukupno redova (donja granica)",
    totalLinesUpperBound: "Ukupno redova (gornja granica, sa pasusima)",
    linesPerPage: "Redova po strani",
    pages: "Broj strana",
    lastPageLines: "Redova na poslednjoj strani",
    lastPageFill: "Popunjenost poslednje strane (%)",
    requiredCharactersPerLine: "Potrebnih znakova u redu za ciljani broj strana",

    inputs: "Uneseno",
    formula:
      "cpl = upisano ili floor(širinaKolone/prosečnaŠirinaZnaka)   redovaPoKoloni = upisano ili " +
      "floor(visinaKolone/prored)   ukupnoRedova = ceil(znakova/cpl)   gornjaGranica = " +
      "ukupnoRedova + pasusa − 1   redovaPoStrani = redovaPoKoloni×kolonaPoStrani   strana = " +
      "ceil(ukupnoRedova/redovaPoStrani)   potrebnoCPL = " +
      "ceil(znakova/(ciljanihStrana×redovaPoStrani))",

    errorCharacterCount: "Broj znakova je ceo broj od 1 naviše.",
    errorColumnsPerPage: "Broj kolona po strani je ceo broj od 1 do 12.",
    errorCharactersPerLine:
      "Znakova u redu mora biti ceo broj od 1 do 1000, ili ga izvedi iz širine kolone i prosečne " +
      "širine znaka.",
    errorColumnWidth: "Širina kolone mora biti veća od nule.",
    errorAverageCharacterWidth: "Prosečna širina znaka mora biti veća od nule.",
    errorLinesPerColumn:
      "Redova po koloni mora biti ceo broj od 1 do 1000, ili ga izvedi iz visine kolone i " +
      "proreda.",
    errorColumnHeight: "Visina kolone mora biti veća od nule.",
    errorLineHeight: "Prored mora biti veći od nule.",
    errorTargetPages: "Ciljani broj strana je ceo broj od 1 do 100000.",
    errorParagraphs: "Broj pasusa je ceo broj od 1 do milion.",
  },

  "css-typographic-units": {
    value: "Vrednost",
    fromUnit: "Iz jedinice",
    rootFontSize: "Korenska veličina (rem)",
    parentFontSize: "Veličina roditelja (em)",
    deviceDpi: "Gustina uređaja",
    deviceDpiHint: "Opciono — stvarna gustina ekrana ili štampe u dpi, za red uređajnih piksela.",
    assetScale: "Izvoz resursa",
    scale1x: "1x",
    scale2x: "2x",
    scale3x: "3x",

    results: "Rezultat",
    rem: "rem",
    atRoot: "pri korenu od",
    em: "em",
    atParent: "pri roditelju od",
    devicePx: "Uređajni pikseli",
    atDensity: "pri gustini od",
    assetPx1x: "Izvoz @1x",
    assetPx2x: "Izvoz @2x",
    assetPx3x: "Izvoz @3x",

    inputs: "Uneseno",
    formula:
      "in = px/96 = pt/72 = pc×12/72 = mm/25,4 = Q/101,6   rem = px/koren   em = px/roditelj   " +
      "uređajniPx = px×gustina/96   izvoz = round(px×razmera)",

    errorValue: "Vrednost mora biti konačan broj.",
    errorRootFontSize: "Korenska veličina mora biti veća od nule.",
    errorParentFontSize: "Veličina roditelja mora biti veća od nule.",
    errorAssetScale: "Neispravan izvoz resursa.",
    errorDeviceDpi: "Gustina uređaja mora biti veća od nule.",
    errorFromUnit: "Neispravna izvorna jedinica.",
  },

  "delta-e": {
    l1: "L* — standard",
    a1: "a* — standard",
    b1: "b* — standard",
    colour1Hint: "Boja 1 je STANDARD/original — ΔE94 je nesimetrična i gradi se iz ove boje.",
    l2: "L* — uzorak",
    a2: "a* — uzorak",
    b2: "b* — uzorak",
    colour2Hint: "Boja 2 je UZORAK/otisak koji se poredi sa standardom.",
    de94Application: "Primena za ΔE94",
    applicationGraphicArts: "Grafika (K1 0,045, K2 0,015, kL 1)",
    applicationTextiles: "Tekstil (K1 0,048, K2 0,014, kL 2)",
    kL: "kL (parametarski, samo za ΔE00)",
    kLHint: "Utiče samo na ΔE00. ΔE94 koristi svoj sopstveni kL, zaključan izborom primene.",
    kC: "kC (parametarski)",
    kH: "kH (parametarski)",

    results: "Rezultat",
    kL94Used: "kL upotrebljen za ΔE94 (zaključan primenom)",
    colour1: "Boja 1 (standard)",
    colour2: "Boja 2 (uzorak)",

    inputs: "Uneseno",
    formula:
      "ΔE*ab = √(ΔL²+Δa²+Δb²)   ΔE94 = √((ΔL/kL94)² + (ΔC*/(kC·SC))² + (ΔH*/(kH·SH))²)   ΔE00 = " +
      "√((ΔL'/(kL·SL))² + (ΔC'/(kC·SC))² + (ΔH'/(kH·SH))² + RT·termC·termH)",

    errorColour1: "L* mora biti između 0 i 100, a* i b* moraju biti konačni brojevi.",
    errorColour2: "L* mora biti između 0 i 100, a* i b* moraju biti konačni brojevi.",
    errorKL: "kL mora biti veći od nule.",
    errorKC: "kC mora biti veći od nule.",
    errorKH: "kH mora biti veći od nule.",
    errorDe94Application: "Neispravna primena za ΔE94.",
  },

  "ean-barcode": {
    digits: "Cifre (bez kontrolne)",
    digitsHint: "Samo cifre: 12 za EAN-13, 7 za EAN-8, 11 za UPC-A. Vodeće nule se čuvaju.",
    symbology: "Simbologija",
    xDimension: "X-dimenzija",
    xDimensionHint: "Modul u milimetrima. Upiši ovo ILI uvećanje ispod, nikad oba.",
    magnificationPercent: "Uvećanje (%)",
    magnificationHint:
      "Procenat nominalne X-dimenzije od 0,33 mm. Upiši ovo ILI X-dimenziju iznad, nikad oba.",
    verifyDigits: "Kod za proveru (sa kontrolnom cifrom)",
    verifyDigitsHint: "Ceo odštampani kod — dužina mora odgovarati izabranoj simbologiji.",

    results: "Rezultat",
    checkDigit: "Kontrolna cifra",
    code: "Ceo kod",
    weightedSum: "Ponderisani zbir",
    xDimensionLabel: "X-dimenzija (upotrebljena)",
    magnification: "Uvećanje (%)",
    totalModules: "Ukupno modula",
    symbolWidth: "Širina simbola (sa mirnim zonama)",
    encodedWidth: "Širina kodiranih crta",
    leftQuietZone: "Leva mirna zona",
    rightQuietZone: "Desna mirna zona",
    barHeight: "Visina crta",
    totalHeight: "Ukupna visina simbola (sa ciframa)",
    verifyComputed: "Izračunata kontrolna cifra",
    verifyTyped: "Upisana kontrolna cifra",
    verifyMatches: "Podudaraju se",
    yes: "Da",
    no: "Ne",

    inputs: "Uneseno",
    formula:
      "kontrolnaCifra: težina 3 na krajnjoj cifri zdesna, naizmenično 1,3,…   zbir = Σ " +
      "cifra×težina   kontrolnaCifra = (10 − (zbir mod 10)) mod 10   simbol = " +
      "(kodiranihModula+levaTiha+desnaTiha)×X   visinaCrta = nominalnaVisina×uvećanje/100",

    errorDigits:
      "Broj cifara mora tačno odgovarati izabranoj simbologiji (12, 7 ili 11), samo cifre.",
    errorXDimension: "X-dimenzija mora biti veća od nule. Upiši nju ili uvećanje, ne oba.",
    errorMagnificationPercent:
      "Uvećanje mora biti veće od nule. Upiši njega ili X-dimenziju, ne oba.",
    errorVerifyDigits:
      "Kod za proveru mora sadržati samo cifre, u dužini koju izabrana simbologija zahteva (sa " +
      "kontrolnom cifrom).",
    errorSymbology: "Neispravna simbologija.",
  },

  "font-metrics-trim": {
    unitsPerEm: "Jedinica fonta (unitsPerEm)",
    ascender: "Ascender",
    descender: "Descender",
    descenderHint: "Obično upisan negativan u fontu — ovde se uzima apsolutna vrednost.",
    lineGap: "Razmak reda (lineGap)",
    lineGapHint:
      "Kod ove alatke se skraćuje iz oba odmaka — ne pomera margine, samo prikazani sadržajni " +
      "okvir.",
    capHeight: "Visina verzala (capHeight)",
    xHeight: "Visina malog x (xHeight)",
    fontSize: "Veličina slova",
    lineHeight: "Prored (CSS line-height)",
    metricSource: "Izvor metrika",
    metricSourceHint:
      "Koju tabelu fonta unosiš — hhea, OS/2 sTypo ili OS/2 usWin. Utiče na to ČIJI je ovaj " +
      "rezultat, ne na ono što će prikazivač uraditi.",
    sourceHhea: "hhea",
    sourceOs2Typo: "OS/2 sTypo",
    sourceOs2Win: "OS/2 usWin",

    results: "Rezultat",
    unitScale: "Piksela po jedinici fonta",
    ascenderPx: "Ascender u pikselima",
    descenderPx: "Descender u pikselima",
    lineGapPx: "Razmak reda u pikselima",
    capHeightPx: "Visina verzala u pikselima",
    xHeightPx: "Visina malog x u pikselima",
    contentArea: "Sadržajni okvir",
    halfLeading: "Polovina viška (half-leading)",
    trimTop: "Odmak od vrha",
    trimBottom: "Odmak od dna",
    marginTop: "Gornja margina za primenu",
    marginBottom: "Donja margina za primenu",
    metricSourceLabel: "Izvor metrika (ovog rezultata)",
    gapCancelsNote:
      "Razmak reda se skraćuje iz oba odmaka — dva suparnička shvatanja sadržajnog okvira daju " +
      "isti odmak; menja se samo prikazani sadržajni okvir.",

    inputs: "Uneseno",
    formula:
      "s = veličina/jedinicaFonta   sadržajniOkvir = (ascender+|descender|+razmakReda)×s   " +
      "poluVišak = (prored−sadržajniOkvir)/2   odmakVrh = poluVišak + razmakReda×s/2 + " +
      "(ascender−verzal)×s   odmakDno = poluVišak + razmakReda×s/2 + |descender|×s",

    errorUnitsPerEm: "Jedinica fonta je ceo broj od 1 do 16384.",
    errorAscender: "Ascender mora biti veći od nule.",
    errorDescender: "Descender mora biti konačan broj različit od nule.",
    errorLineGap: "Razmak reda ne sme biti negativan.",
    errorCapHeight: "Visina verzala mora biti veća od nule.",
    errorFontSize: "Veličina slova mora biti veća od nule.",
    errorLineHeight: "Prored mora biti veći od nule.",
    errorMetricSource: "Neispravan izvor metrika.",
    errorXHeight: "Visina malog x mora biti veća od nule.",
  },

  "iso-paper-sizes": {
    series: "Serija",
    index: "Indeks formata",
    targetSeries: "Ciljna serija",
    targetIndex: "Ciljni indeks",
    targetIndexHint: "Opciono — za broj formata u većem i procenat na kopir-aparatu.",
    measuredWidth: "Izmerena širina",
    measuredHint: "Opciono — za prepoznavanje lista koji imaš u ruci.",
    measuredHeight: "Izmerena visina",
    matchTolerance: "Tolerancija prepoznavanja",

    results: "Rezultat",
    shortEdge: "Kraća ivica",
    longEdge: "Duža ivica",
    areaM2: "Površina (m²)",
    areaCm2: "Površina (cm²)",
    diagonal: "Dijagonala",
    ratio: "Odnos stranica (stvaran)",
    nominalRatio: "√2 (nominalan odnos)",
    envelopeFlat: "Koverat koji prima ravno (C serija)",
    envelopeFoldedOnce: "Koverat koji prima presavijeno jednom (C serija)",
    target: "Ciljni format",
    nominalCount: "Nominalan broj ciljnih formata u ovom",
    copierScale: "Uvećanje na kopir-aparatu (zaokruženo / tačno)",
    match: "Prepoznat format",
    noMatch: "Nije prepoznat nijedan ISO format u okviru tolerancije.",

    inputs: "Uneseno",
    formula:
      "kratka(n) = floor(duga(n−1)/2), duga(n) = kratka(n−1), počev od sidra serije   površina = " +
      "kratka×duga/1e6   dijagonala = √(kratka²+duga²)   uvećanje = min(ciljKratka/kratka, " +
      "ciljDuga/duga)×100",

    errorSeries: "Neispravna serija.",
    errorIndex: "Indeks formata je ceo broj od 0 do 10.",
    errorMatchTolerance: "Tolerancija je broj od 0 do 10 mm.",
    errorTargetIndex: "Ciljni indeks je ceo broj od 0 do 10.",
    errorTargetSeries: "Neispravna ciljna serija.",
    errorMeasuredWidth: "Izmerena širina mora biti veća od nule.",
    errorMeasuredHeight: "Izmerena visina mora biti veća od nule.",
  },

  "modular-type-scale": {
    baseSize: "Osnovna veličina",
    baseUnit: "Jedinica osnovne veličine",
    ratio: "Odnos",
    ratioOctave: "Oktava",
    ratioPerfectFifth: "Čista kvinta",
    ratioPerfectFourth: "Čista kvarta",
    ratioMajorThird: "Velika terca",
    ratioMinorThird: "Mala terca",
    ratioCustomLabel: "Upisan odnos",
    ratioHint: "Decimalan broj veći od 1.",
    stepsUp: "Koraka naviše",
    stepsDown: "Koraka naniže",
    rootFontSize: "Korenska veličina (za rem)",
    rounding: "Zaokruživanje prikaza",
    roundingNone: "Bez",
    roundingHalf: "0,5 px",
    roundingPixel: "1 px",
    roundingFour: "Na 4 px",

    results: "Rezultat",
    basePx: "Osnovna veličina u pikselima",
    colStep: "Korak",
    colPxRaw: "px (sirovo)",
    colPxRounded: "px (zaokruženo)",
    colRem: "rem",
    colPt: "pt",

    inputs: "Uneseno",
    formula:
      "veličina(n) = osnovnaPx × odnos^n   rem = veličina/koren   pt = veličina×0,75   " +
      "zaokruživanje se primenjuje samo na prikazanu px kolonu, nikad na sledeći korak",

    errorBaseSize: "Osnovna veličina mora biti veća od nule.",
    errorRatio: "Odnos mora biti broj veći od 1.",
    errorStepsUp: "Koraka naviše je ceo broj od 0 do 12.",
    errorStepsDown: "Koraka naniže je ceo broj od 0 do 12.",
    errorRootFontSize: "Korenska veličina mora biti veća od nule.",
    errorBaseUnit: "Neispravna jedinica osnovne veličine.",
    errorRounding: "Neispravno zaokruživanje.",
  },

  "paper-weight": {
    grammage: "Gramatura",
    sheetWidth: "Širina tabaka",
    sheetHeight: "Visina tabaka",
    sheetCount: "Broj tabaka",
    measuredMass: "Izmerena masa svežnja",
    measuredMassHint: "Opciono — za obrnut smer, gramaturu iz izmerene mase.",
    rollWidth: "Širina rolne",
    rollMass: "Masa rolne (kg)",
    rollMassHint: "Opciono, zajedno sa širinom rolne — za dužinu rolne. Ne oduzima masu jezgra.",

    results: "Rezultat",
    areaM2: "Površina tabaka (m²)",
    sheetMass: "Masa jednog tabaka",
    totalMass: "Ukupna masa (g)",
    totalMassKg: "Ukupna masa (kg)",
    measuredGrammage: "Gramatura iz izmerene mase",
    rollLength: "Dužina rolne",

    inputs: "Uneseno",
    formula:
      "površina = širina×visina/1e6   masaTabaka = gramatura×površina   ukupnaMasa = " +
      "masaTabaka×broj   gramaturaIzMase = izmerenaMasa/(broj×površina)   dužinaRolne = " +
      "masaRolne[kg]×1e6/(gramatura×širinaRolne[mm])",

    errorGrammage: "Gramatura mora biti veća od nule.",
    errorSheetWidth: "Širina tabaka mora biti veća od nule.",
    errorSheetHeight: "Visina tabaka mora biti veća od nule.",
    errorSheetCount: "Broj tabaka je ceo broj od 1 naviše.",
    errorMeasuredMass: "Izmerena masa mora biti veća od nule.",
    errorRollWidth: "Širina rolne mora biti veća od nule.",
    errorRollMass: "Masa rolne mora biti veća od nule.",
  },

  "print-resolution": {
    direction: "Smer",
    directionPxToSize: "Pikseli → veličina",
    directionSizeToPx: "Veličina → pikseli",
    directionEffectivePpi: "Efektivna rezolucija",
    widthPx: "Širina (px)",
    heightPx: "Visina (px)",
    resolution: "Rezolucija (ppi)",
    resolutionHint: "Potrebno za oba smera osim „efektivna rezolucija\".",
    physicalWidth: "Fizička širina",
    physicalHeight: "Fizička visina",
    physicalUnit: "Jedinica fizičke veličine",
    bleed: "Napust (po ivici)",
    bleedHint: "U milimetrima, primenjuje se na obe ivice svake ose.",
    scaleDenominator: "Imenilac razmere (1:s)",
    scaleDenominatorHint: "1 znači stvarna veličina.",
    channels: "Broj kanala",
    channelsHint: "1 sivo, 3 RGB, 4 CMYK — ili slobodan broj za drugu kombinaciju.",
    bitsPerChannel: "Bita po kanalu",

    results: "Rezultat",
    widthMm: "Širina (mm)",
    heightMm: "Visina (mm)",
    widthIn: "Širina (in)",
    heightIn: "Visina (in)",
    ppiWidth: "Rezolucija po širini",
    ppiHeight: "Rezolucija po visini",
    axesDisagree: "Ose se ne slažu (nekvadratni pikseli)",
    yes: "Da",
    no: "Ne",
    artboardWidthMm: "Radna površina — širina (mm)",
    artboardHeightMm: "Radna površina — visina (mm)",
    artboardWidthPx: "Radna površina — širina (px)",
    artboardHeightPx: "Radna površina — visina (px)",
    finalWidthMm: "Konačna širina pri razmeri",
    finalHeightMm: "Konačna visina pri razmeri",
    finalPpiWidth: "Konačna rezolucija po širini",
    finalPpiHeight: "Konačna rezolucija po visini",
    megapixels: "Megapikseli",
    bytes: "Bajtova (sirovo)",
    mebibytes: "MiB (sirovo)",
    bytesNote:
      "Sirovi uzorci — bez alfa kanala, ICC profila, slojeva ili dopune reda. Sačuvan fajl će " +
      "uvek biti veći od ovog broja.",

    inputs: "Uneseno",
    formula:
      "mm = px×25,4/ppi   px = round(mm×ppi/25,4)   ppi = px×25,4/mm   radnaPovršina = otisak + " +
      "2×napust (px zaokruženo NAVIŠE)   konačnaVeličina = otisak×s   bajtovi = " +
      "širina×visina×kanali×bitovaPoKanalu/8",

    errorBleed: "Napust ne sme biti negativan.",
    errorScaleDenominator: "Imenilac razmere mora biti 1 ili veći.",
    errorChannels: "Broj kanala je ceo broj od 1 do 8.",
    errorBitsPerChannel: "Bita po kanalu je 1, 8, 16 ili 32.",
    errorPhysicalUnit: "Neispravna jedinica fizičke veličine.",
    errorWidthPx: "Širina u pikselima je ceo broj od 1 naviše.",
    errorHeightPx: "Visina u pikselima je ceo broj od 1 naviše.",
    errorResolution: "Rezolucija mora biti veća od nule.",
    errorPhysicalWidth: "Fizička širina mora biti veća od nule.",
    errorPhysicalHeight: "Fizička visina mora biti veća od nule.",
    errorDirection: "Neispravan smer.",
  },

  "roll-yield": {
    rollWidth: "Širina rolne",
    pieceWidth: "Širina komada",
    pieceHeight: "Visina komada",
    sideMargin: "Bočna margina (po ivici rolne)",
    gutter: "Razmak između komada",
    leadTrailMargin: "Margina na početku i kraju posla",
    quantity: "Tiraž",
    allowRotation: "Dozvoli okretanje za 90°",
    yes: "Da",
    no: "Ne",
    rollLength: "Dužina jedne rolne",
    rollLengthHint:
      "Opciono — za broj potrebnih rolni. Broj se gradi iz celih redova po rolni, nikad iz " +
      "proste podele dužine.",
    pricePerMetre: "Cena po dužnom metru",

    results: "Rezultat",
    usableWidth: "Iskoristiva širina",
    upright: "Uspravno",
    across: "Komada u širinu",
    leftoverWidth: "Neiskorišćena širina",
    rows: "Redova",
    lengthM: "Potrošena dužina (m)",
    produced: "Stvarno proizvedeno",
    rolls: "Potrebno rolni",
    cost: "Cena materijala",
    rotated: "Okrenuto",
    shorter: "Kraći raspored",
    equal: "Jednako",

    inputs: "Uneseno",
    formula:
      "preko = floor((iskoristivo+razmak)/(komad+razmak))   redova = ceil(tiraž/preko)   dužina " +
      "= redova×(visina+razmak) − razmak + 2×početnaKrajnjaMargina   redovaPoRolni = " +
      "floor((dužinaRolne+razmak)/(visina+razmak))   rolni = ceil(redova/redovaPoRolni)",

    errorRollWidth: "Širina rolne mora biti veća od nule.",
    errorPieceWidth: "Širina komada mora biti veća od nule.",
    errorPieceHeight: "Visina komada mora biti veća od nule.",
    errorSideMargin: "Bočna margina ne sme biti negativna.",
    errorGutter: "Razmak ne sme biti negativan.",
    errorLeadTrailMargin: "Margina na početku i kraju ne sme biti negativna.",
    errorQuantity: "Tiraž je ceo broj od 1 naviše.",
    errorRollLength: "Dužina rolne mora biti veća od nule.",
    errorPricePerMetre: "Cena po metru ne sme biti negativna.",
  },

  "saddle-stitch-imposition": {
    pageCount: "Broj strana",
    signatureSize: "Strana po tabačiću",
    signatureSizeHint: "4 znači klamovana knjižica bez sekcija — svaki tabak je deo iste knjižice.",
    startPage: "Broj prve strane u poslu",
    startPageHint: "Pomera svaki ispisan broj strane; parovi ostaju isti.",

    results: "Rezultat",
    paddedPages: "Strana posle dopune (umnožak tabačića)",
    blanks: "Praznih strana",
    firstBlankPage: "Prva prazna strana",
    sheets: "Tabaka",
    signatures: "Tabačića",
    sheet: "Tabak",
    signature: "Tabačić",
    colSheet: "Tabak",
    colSignature: "Tabačić",
    colFrontLeft: "Prednja — levo",
    colFrontRight: "Prednja — desno",
    colBackLeft: "Zadnja — levo",
    colBackRight: "Zadnja — desno",

    inputs: "Uneseno",
    formula:
      "P4 = ceil(strana/4)×4   PS = ceil(P4/tabačić)×tabačić   prazne = PS−strana   tabak k: " +
      "prednja = (PS−2k+2 | 2k−1), zadnja = (2k | PS−2k+1), pomereno za (početnaStrana−1)",

    errorPageCount: "Broj strana je ceo broj od 1 do 4000.",
    errorSignatureSize: "Strana po tabačiću je 4, 8, 16 ili 32.",
    errorStartPage: "Broj prve strane je ceo broj od 1 do milion.",
  },

  "sheet-imposition": {
    sheetWidth: "Širina tabaka",
    sheetHeight: "Visina tabaka",
    pieceWidth: "Širina komada",
    pieceHeight: "Visina komada",
    marginTop: "Gornja margina",
    marginHint: "Ivica hvataljki i slične margine — primenjuju se pre razmeštaja.",
    marginBottom: "Donja margina",
    marginLeft: "Leva margina",
    marginRight: "Desna margina",
    gutter: "Razmak između komada",
    gutterHint: "Napust plus širina reza.",
    allowRotation: "Dozvoli okretanje za 90°",
    yes: "Da",
    no: "Ne",
    requiredQuantity: "Traženi tiraž",

    results: "Rezultat",
    usableWidth: "Iskoristiva širina",
    usableHeight: "Iskoristiva visina",
    upright: "Uspravno",
    across: "Komada u širinu",
    down: "Komada u visinu",
    count: "Komada po tabaku",
    leftoverWidth: "Neiskorišćena širina",
    leftoverHeight: "Neiskorišćena visina",
    rotated: "Okrenuto",
    bestOrientation: "Bolji raspored",
    either: "Bilo koji (jednako)",
    best: "Komada po tabaku (bolji raspored)",
    usedPercent: "Iskorišćeno (% celog tabaka)",
    wastePercent: "Otpad (% celog tabaka)",
    usedPercentOfUsable: "Iskorišćeno (% iskoristive površine)",
    wastePercentOfUsable: "Otpad (% iskoristive površine)",
    sheets: "Potrebno tabaka",

    inputs: "Uneseno",
    formula:
      "iskoristivaŠirina = tabak − leva − desna   iskoristivaVisina = tabak − gornja − donja   " +
      "preko = floor((iskoristivaŠirina+razmak)/(širina+razmak))   dole = " +
      "floor((iskoristivaVisina+razmak)/(visina+razmak))   otpad% = (1 − " +
      "komada×površinaKomada/površinaTabaka)×100",

    errorSheetWidth: "Širina tabaka mora biti veća od nule.",
    errorSheetHeight: "Visina tabaka mora biti veća od nule.",
    errorPieceWidth: "Širina komada mora biti veća od nule.",
    errorPieceHeight: "Visina komada mora biti veća od nule.",
    errorMarginTop: "Gornja margina ne sme biti negativna.",
    errorMarginBottom: "Donja margina ne sme biti negativna.",
    errorMarginLeft: "Leva margina ne sme biti negativna.",
    errorMarginRight: "Desna margina ne sme biti negativna.",
    errorGutter: "Razmak ne sme biti negativan.",
    errorRequiredQuantity: "Traženi tiraž je ceo broj od 1 naviše.",
  },
} as const;

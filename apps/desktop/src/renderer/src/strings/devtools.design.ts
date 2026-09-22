/**
 * „Dizajn i boje" — the Serbian copy of this category's tool surfaces.
 *
 * One entry per tool id, keyed exactly as the registration in
 * `shared/modules.ts` spells it. The tool's NAME and its one-line blurb are not
 * here: those live in the `name` and `blurb` tables of `./devtools.ts`, because
 * the drawer's rail needs them before any surface is opened.
 *
 * **No CSS colour syntax appears anywhere in this file, on purpose.** The repo's
 * `check:colours` gate flags any `#hex` or `rgb(`/`hsl(`/`oklch(`/… substring in
 * application source, and an example placeholder that showed one (`„npr. #36c"`)
 * would trip it just as surely as a hard-coded style would. Every hint below
 * names the syntaxes by word instead of demonstrating one.
 */
export const DEVTOOLS_DESIGN_SR = {
  "color-convert": {
    input: "Boja",
    inputPlaceholder: "npr. hex, rgb, hsl, hwb, lab, lch, oklab, oklch",
    invalid: "Nije prepoznat zapis boje.",
    name: "Naziv",
    noName: "Nema CSS naziva",
    outOfGamut: "Van sRGB opsega — hex, rgb, hsl i hwb su približni.",
    formats: {
      hex: "Hex",
      rgb: "RGB",
      hsl: "HSL",
      hwb: "HWB",
      lab: "Lab",
      lch: "LCH",
      oklab: "Oklab",
      oklch: "Oklch",
    },
  },

  "color-palette": {
    base: "Osnovna boja",
    basePlaceholder: "Boja u bilo kom CSS zapisu",
    steps: "Broj koraka",
    invalidSteps: "Upiši ceo broj od 1 do 64.",
    invalid: "Nije prepoznat zapis boje.",
    tints: "Svetlije nijanse",
    shades: "Tamnije nijanse",
    harmony: "Harmonija",
    greyNote: "Siva nema ton koji bi se rotirao — harmonija je vraća nepromenjenu.",
    kind: {
      complementary: "Komplementarna",
      "split-complementary": "Podeljena komplementarna",
      analogous: "Analogna",
      triadic: "Trijadna",
      tetradic: "Tetradna",
      monochromatic: "Monohromatska",
    },
  },

  gradient: {
    kind: "Vrsta",
    kindLabel: {
      linear: "Linearni",
      radial: "Radijalni",
      conic: "Konusni",
    },
    stops: "Tačke preliva",
    addStop: "Dodaj tačku",
    removeStop: "Ukloni tačku",
    colour: "Boja",
    position: "Položaj (%)",
    space: "Prostor mešanja",
    spaceLabel: {
      srgb: "sRGB",
      oklab: "Oklab",
    },
    spaceHint:
      "U Oklab prostoru sredina preliva ne prolazi kroz sivilo kao u sRGB-u.",
    angle: "Ugao (°)",
    samples: "Broj uzoraka",
    css: "CSS",
    invalid: "Nije prepoznat zapis boje.",
    invalidStops:
      "Tačke moraju ići redom, od 0% do 100%, i mora ih biti bar dve.",
    invalidSamples: "Broj uzoraka mora biti ceo broj od 2 do 4096.",
  },

  "cubic-bezier": {
    preset: "Gotova kriva",
    custom: "Sopstvena",
    x1: "P1 x",
    y1: "P1 y",
    x2: "P2 x",
    y2: "P2 y",
    time: "Vreme",
    progress: "Napredak",
    samples: "Broj uzoraka",
    css: "CSS",
    illegal: "x koordinate kontrolnih tačaka moraju biti između 0 i 1.",
    invalidTime: "Vreme mora biti između 0 i 1.",
    invalidSamples: "Broj uzoraka mora biti ceo broj od 2 do 4096.",
    overshoot: "Napredak izlazi izvan 0–1 — to je odskok, ne greška.",
    referenceTitle: "Poređenje sa gotovim krivama",
  },

  contrast: {
    text: "Boja teksta",
    background: "Boja pozadine",
    swap: "Zameni mesta",
    preview: "Ovako izgleda tekst",
    ratio: "Odnos kontrasta",
    apca: "APCA Lc",
    pass: "Prolazi",
    fail: "Ne prolazi",
    invalid: "Nije prepoznat zapis boje.",
    level: {
      aaBody: "AA — običan tekst",
      aaLarge: "AA — krupan tekst",
      aaaBody: "AAA — običan tekst",
      aaaLarge: "AAA — krupan tekst",
      nonText: "AA — ikone i linije",
    },
    apcaHint:
      "Negativna vrednost znači svetao tekst na tamnoj pozadini. WCAG 2.1 " +
      "taj smer ne razlikuje i po pravilu ga preceni.",
    alphaHint: "WCAG ne poznaje providan tekst — prvo ga podloži pozadinom.",
  },

  "color-mixer": {
    colours: "Boje",
    addColour: "Dodaj boju",
    removeColour: "Ukloni boju",
    weight: "Udeo",
    spaceLabel: {
      srgb: "sRGB",
      "linear-rgb": "Linearni RGB",
      oklab: "Oklab",
    },
    result: "Rezultat",
    invalid: "Nije prepoznat zapis boje.",
    invalidWeight:
      "Udeo mora biti broj veći ili jednak nuli, a zbir veći od nule.",
    composite: "Preklapanje",
    source: "Gornja boja",
    backdrop: "Donja boja",
    compositeHint: "Preklapanje po alfi nije isto što i mešanje po udelu.",
  },
} as const;

/**
 * CALCULATOR's own copy, in Serbian - the SHAPE every other locale of this
 * module is checked against (ADR-090).
 *
 * **Why this is not in `strings.ts`.** The shell's table is part of the startup
 * chunk and this module's page is not: a module that put its page copy there
 * would pay for it on every launch, whether or not anybody ever opened a
 * calculator. So the module carries its own table, `copy.ts` registers it with
 * the locale machinery the moment this chunk loads, and from that moment
 * switching language rewrites these leaves in place exactly as it rewrites the
 * shell's.
 *
 * English is `copy.en.ts`, typed `typeof sr` - one compile error per sentence
 * left untranslated and one per key invented, which is how the two tables stay
 * the same shape without anything checking them by hand.
 *
 * No `as const`: the literal type of a sentence is not something either locale
 * should be pinned to, and `typeof sr` widened to `string` is exactly the shape
 * `en` has to match.
 *
 * Two keys are COMPUTED rather than named at the call site and are shaped for
 * it: `keys` is indexed by a keypad key's declared name (`KeypadName`, the
 * engine's own closed set in `expression.ts`) and `errors` by a refusal's code
 * (`CALCULATOR_FAILURE_CODES`, plus the two this page raises itself).
 */
export const sr = {
  page: {
    // The page's own header is the module's name, which the shell already draws
    // from the manifest; this is the line under it.
    subtitle: "Računanje jednom linijom: promenljive, jedinice, istorija i naučna tastatura.",
    loading: "Učitavanje…",
  },
  expression: {
    label: "Izraz",
    placeholder: "npr. 5 km to mi, 1/3, sin(30)",
    keysHint:
      "Enter pamti izraz u istoriju, strelice gore i dole vraćaju starije izraze, Esc prazni polje.",
    referenceHint:
      "ans je poslednji rezultat, a #1, #2 i dalje su rezultati iz istorije, od najnovijeg.",
    waiting: "Rezultat se računa dok kucaš.",
    working: "Računam…",
    commit: "Izračunaj",
    clear: "Obriši",
    caret: "Greška je na znaku",
  },
  keypad: {
    title: "Naučna tastatura",
  },
  keys: {
    open: "Otvorena zagrada",
    close: "Zatvorena zagrada",
    plus: "Sabiranje",
    minus: "Oduzimanje",
    multiply: "Množenje",
    divide: "Deljenje",
    power: "Stepen",
    equals: "Izračunaj",
    root: "Kvadratni koren",
    square: "Kvadrat",
    pi: "Broj pi",
    factorial: "Faktorijel",
    percent: "Procenat",
    decimal: "Decimalni zarez",
    clear: "Obriši polje",
  },
  history: {
    title: "Istorija",
    search: "Traži u istoriji",
    emptyTitle: "Istorija je prazna",
    emptyBody: "Izraz koji potvrdiš Enterom ostaje ovde, sa rezultatom.",
    noMatch: "Nijedan unos ne odgovara pretrazi.",
    reuse: "U izraz",
    pin: "Zakači",
    unpin: "Otkači",
    remove: "Obriši",
    clear: "Obriši istoriju",
    clearTitle: "Brisanje istorije",
    clearQuestion: "Obrisati sve izraze iz istorije?",
    clearNote: "Zakačeni unosi ostaju, kao i promenljive.",
  },
  variables: {
    title: "Promenljive",
    empty:
      "Još nema promenljivih. Dodeli vrednost, npr. x = 5, ili definiši funkciju, npr. f(x) = x^2 + 1.",
    namesLabel: "Promenljive",
    functionsLabel: "Funkcije",
    forget: "Zaboravi sve",
    forgetTitle: "Zaboravljanje promenljivih",
    forgetQuestion: "Obrisati sve promenljive, funkcije i poslednji rezultat?",
  },
  errors: {
    load: "Nije moguće učitati kalkulator.",
    syntax: "Izraz nije ispravno napisan.",
    "unknown-symbol": "Nepoznato ime u izrazu.",
    "wrong-arguments": "Funkcija ne prima takve argumente, ili se izraz ne završava.",
    "division-by-zero": "Deljenje nulom nije dozvoljeno.",
    "unit-mismatch": "Jedinice se ne poklapaju.",
    "too-large": "Izraz je prevelik za računanje.",
    disabled: "Ta funkcija nije dozvoljena u kalkulatoru.",
    timeout: "Računanje traje predugo i prekinuto je. Pokušaj sa prostijim izrazom.",
    stopped: "Računanje je prekinuto. Pokušaj ponovo.",
    noEntry: "Nema tog unosa u istoriji.",
    mutate: "Izmena nije sačuvana.",
    sessionUnreadable:
      "Sačuvane promenljive se ne mogu pročitati. Zaboravi ih da bi kalkulator ponovo radio.",
  },
  widget: {
    empty: "Još nema izračunatih rezultata.",
    loading: "Učitavanje…",
    loadError: "Nije moguće učitati rezultate.",
  },
  settings: {
    caption: "Ove dve postavke čuvaju se uz profil, a menjaju se i na samoj stranici.",
    hint: "Ugao određuje šta znači sin(30), a režim brojeva koliko cifara rezultat nosi.",
    saved: "Sačuvano.",
    loadError: "Nije moguće učitati podešavanja.",
    saveError: "Podešavanje nije sačuvano.",
  },
  confirm: {
    cancel: "Otkaži",
  },
};

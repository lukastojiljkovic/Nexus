/**
 * TIMERS' own copy, in Serbian — the SHAPE every other locale of this module is
 * checked against (ADR-090).
 *
 * **Why this is not in `strings.ts`.** The shell's table is part of the startup
 * chunk, and this module's page is not: a module that put its page copy there
 * would pay for it on every launch, whether or not anybody ever opened a timer.
 * So the module carries its own table, `copy.ts` registers it with the locale
 * machinery the moment this chunk loads, and from that moment switching language
 * rewrites these leaves in place exactly as it rewrites the shell's.
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
    // The page's own header is the module's name, which the shell already draws
    // from the manifest (`moduleName`); this is the line under it.
    subtitle: "Štoperica i odbrojavanja — rade i kad zatvoriš stranicu.",
    loading: "Učitavanje…",
  },
  stopwatch: {
    title: "Štoperica",
    start: "Pokreni",
    pause: "Pauza",
    resume: "Nastavi",
    reset: "Resetuj",
    lap: "Krug",
    lapsTitle: "Krugovi",
    lapTotal: "Ukupno",
    keysHint: "Dok je stranica u fokusu: Space pokreće i pauzira, L beleži krug, R resetuje.",
  },
  countdowns: {
    title: "Odbrojavanja",
    empty: "Nijedno odbrojavanje ne radi. Unesi naziv i trajanje, pa pokreni.",
    name: "Naziv",
    hours: "Sati",
    minutes: "Minuti",
    seconds: "Sekunde",
    start: "Pokreni",
    savePreset: "Sačuvaj kao preset",
    pause: "Pauza",
    resume: "Nastavi",
    addMinute: "+1 min",
    cancel: "Prekini",
    running: "Radi",
    paused: "Pauzirano",
  },
  presets: {
    title: "Preseti",
    start: "Pokreni",
    rename: "Preimenuj",
    remove: "Obriši",
    save: "Sačuvaj",
    cancel: "Otkaži",
    emptyTitle: "Još nema preseta",
    emptyBody:
      "Sačuvaj odbrojavanje pod imenom — npr. „Kafa“ — pa ga pokreni jednim klikom.",
  },
  errors: {
    load: "Nije moguće učitati tajmere.",
    mutate: "Izmena nije sačuvana.",
    name: "Naziv je obavezan i može imati najviše 60 znakova.",
    duration: "Trajanje mora biti između 1 sekunde i 24 sata.",
  },
  settings: {
    caption: "Tajmeri se oglašavaju i kada stranica nije otvorena.",
    hint: "Zvuk je sistemski zvuk obaveštenja — Nexus ne nosi svoje zvučne fajlove.",
    saved: "Sačuvano.",
    loadError: "Nije moguće učitati podešavanje.",
    saveError: "Podešavanje nije sačuvano.",
  },
  widget: {
    empty: "Nijedno odbrojavanje ne radi.",
    loading: "Učitavanje…",
    loadError: "Nije moguće učitati odbrojavanja.",
  },
};

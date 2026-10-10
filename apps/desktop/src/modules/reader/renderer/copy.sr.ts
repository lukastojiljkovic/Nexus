/**
 * READER's own copy, in Serbian - the SHAPE every other locale of this module is
 * checked against (ADR-090).
 *
 * **Why this is not in `strings.ts`.** The shell's table is part of the startup
 * chunk and this module's page is not: copy that lived there would be paid for on
 * every launch whether or not anybody ever opened a book. `copy.ts` registers this
 * table with the locale machinery the moment this chunk loads, and from that
 * moment switching language rewrites these leaves in place exactly as it rewrites
 * the shell's.
 *
 * No `as const`, so `copy.en.ts` can be typed `typeof sr` with the sentences
 * widened to `string`.
 */
export const sr = {
  page: {
    // The header's title is the module's name, which the shell draws from the
    // manifest; this is the line under it.
    // The module's one-line description lives in the manifest (the rail and the
    // launcher draw it before this chunk loads), so this is a sentence about what
    // the page IS rather than a second copy of that one.
    subtitle: "Polica sa svim instaliranim knjigama.",
    loading: "Učitavanje…",
  },
  library: {
    title: "Polica",
    emptyTitle: "Još nema knjiga",
    emptyBody:
      "Čitač čita pakete sadržaja, a instaliraju se u Podešavanjima, na kartici Paketi sadržaja.",
    open: "Otvori",
    resume: "Nastavi",
    safety: "Bezbednosna napomena",
    bookmarks: "Obeleživači",
    articles: "Članci",
    version: "Verzija",
  },
  toc: {
    title: "Sadržaj",
    chapter: "Poglavlje",
  },
  reading: {
    back: "Polica",
    previous: "Prethodni",
    next: "Sledeći",
    bookmark: "Obeleži članak",
    removeBookmark: "Ukloni obeleživač",
    note: "Beleška uz obeleživač",
    saveNote: "Sačuvaj belešku",
    source: "Izvor",
    textSize: "Veličina teksta",
    sizeSmall: "Malo",
    sizeMedium: "Srednje",
    sizeLarge: "Veliko",
  },
  search: {
    label: "Pretraga",
    inPack: "Samo ova knjiga",
    everywhere: "Sve knjige",
    empty: "Nema pogodaka.",
    hint: "Traži po naslovu i po tekstu članaka.",
    titles: "Naslovi",
    building: "Priprema indeks",
    truncated: "Prikazani su prvi pogoci; dopiši još jednu reč da suziš pretragu.",
  },
  print: {
    action: "Štampaj",
    article: "Ovaj članak",
    chapter: "Ovo poglavlje",
    pack: "Celu knjigu",
    paper: "Papir",
    cancelled: "Štampanje je otkazano.",
    refused: "Štampanje nije moguće: jedan od članaka sadrži oznake koje Čitač ne prikazuje.",
    failed: "Štampanje nije uspelo.",
  },
  notice: {
    title: "Pre nego što počneš",
    accept: "Razumem",
    close: "Zatvori",
  },
  index: {
    building: "Priprema knjigu",
    failed: "Indeks ove knjige nije napravljen, pa je pretraga ne vidi.",
  },
  errors: {
    load: "Biblioteku nije moguće učitati.",
    open: "Ovu knjigu nije moguće otvoriti. Proveri da li je paket još instaliran.",
    article: "Ovaj članak nije moguće prikazati.",
    mutate: "Izmena nije sačuvana.",
  },
  widget: {
    empty: "Nijedna knjiga nije otvorena.",
    loading: "Učitavanje…",
    loadError: "Knjige nije moguće učitati.",
  },
};

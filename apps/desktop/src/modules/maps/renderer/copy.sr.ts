/**
 * MAPS' own copy, in Serbian — the SHAPE every other locale of this module is
 * checked against (ADR-090).
 *
 * **Why this is not in `strings.ts`.** The shell's table is part of the startup
 * chunk, and this module's page is not: a module that put its page copy there
 * would pay for it on every launch, whether or not anybody ever opened a map.
 * So the module carries its own table, `copy.ts` registers it with the locale
 * machinery the moment this chunk loads, and from that moment switching language
 * rewrites these leaves in place exactly as it rewrites the shell's.
 *
 * English is `copy.en.ts`, typed `typeof sr` — one compile error per sentence
 * left untranslated and one per key invented.
 *
 * **No sentence here uses a gendered past tense.** Serbian has no genderless
 * one (`check:address` exists because of that), and this page addresses the
 * reader directly: „Spusti tačku", not „Spustio si tačku".
 */
export const sr = {
  page: {
    subtitle: "Karta Srbije koja radi bez interneta — pretraga mesta, tačke i merenje razdaljine.",
    loading: "Učitavanje mape…",
  },
  pack: {
    title: "Karta još nije instalirana",
    body: "Instaliraj paket „map-serbia“ na kartici „Paketi sadržaja“ u Podešavanjima, pa se vrati na ovu stranicu.",
    styleTitle: "Stil karte nije pročitan",
    styleBody: "Datoteka stila u paketu ne može da se pročita. Instaliraj paket ponovo iz fascikle.",
    networkBody: "Stil u paketu traži adresu sa interneta, pa mapa nije prikazana. Paket je izmenjen i ne treba mu verovati.",
    placesBody: "Indeks mesta iz paketa nije pročitan, pa pretraga i nazivi mesta ne rade.",
  },
  search: {
    label: "Pretraga mesta",
    placeholder: "npr. Čačak, Novi Sad…",
    empty: "Nema mesta koja odgovaraju.",
    results: "Rezultati pretrage",
    loading: "Priprema indeksa mesta…",
  },
  tools: {
    zoomIn: "Uvećaj",
    zoomOut: "Umanji",
    newPin: "Nova tačka",
    here: "Ovde sam",
    clearLocation: "Ukloni moju poziciju",
    measure: "Merenje",
    stopMeasure: "Prekini merenje",
    clearMeasure: "Obriši merenje",
    copy: "Kopiraj koordinate",
    copied: "Kopirano.",
    copyFailed: "Kopiranje nije uspelo.",
    pins: "Spisak tačaka",
    scale: "Razmernik",
  },
  pins: {
    title: "Tačke",
    emptyTitle: "Nema tačaka",
    emptyBody: "Tačka čuva naziv, belešku i boju i ostaje na mapi. Spusti prvu dugmetom „Nova tačka“.",
    edit: "Izmeni",
    remove: "Obriši",
    hide: "Sakrij spisak",
    noteEmpty: "Bez beleške",
    measureHint: "Klikni na mapu da dodaš tačku merenja.",
    distance: "Razdaljina",
  },
  dialog: {
    createTitle: "Nova tačka",
    editTitle: "Izmeni tačku",
    title: "Naziv",
    note: "Beleška",
    noteHint: "Nije obavezno, najviše 2000 znakova.",
    color: "Boja",
    coordinates: "Koordinate",
    dms: "Stepeni, minuti, sekunde",
    atCentre: "Tačka se postavlja na centar mape — prvo pomeri mapu na mesto koje želiš.",
    save: "Sačuvaj",
    cancel: "Otkaži",
    titleRequired: "Naziv je obavezan i može imati najviše 120 znakova.",
    noteTooLong: "Beleška može imati najviše 2000 znakova.",
  },
  colors: {
    zlato: "Zlatna",
    bronza: "Bronzana",
    maslina: "Maslinasta",
    suma: "Šumska",
    zad: "Žad",
    ruza: "Ružina",
    bordo: "Bordo",
    grafit: "Grafitna",
  },
  attribution: {
    credit: "© OpenStreetMap contributors",
    licence: "Podaci pod licencom ODbL — https://www.openstreetmap.org/copyright",
    label: "Izvor podataka",
  },
  errors: {
    load: "Tačke nisu učitane.",
    mutate: "Izmena nije sačuvana.",
  },
};

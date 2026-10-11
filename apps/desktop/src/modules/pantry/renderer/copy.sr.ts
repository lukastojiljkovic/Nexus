/**
 * PANTRY's own copy, in Serbian — the SHAPE every other locale of this module is
 * checked against (ADR-090).
 *
 * **Why this is not in `strings.ts`.** The shell's table is part of the startup
 * chunk, and this module's page is not: a module that put its page copy there
 * would pay for it on every launch, whether or not anybody ever opened the
 * pantry. So the module carries its own table, `copy.ts` registers it with the
 * locale machinery the moment this chunk loads, and from that moment switching
 * language rewrites these leaves in place exactly as it rewrites the shell's.
 *
 * English is `copy.en.ts`, typed `typeof sr` — one compile error per sentence
 * left untranslated and one per key invented, which is how the two tables stay
 * the same shape without anything checking them by hand.
 *
 * **`{…}` slots rather than `…Prefix`/`…Suffix` pairs.** A count and its noun
 * move differently in the two languages — «Isteklo pre 2 dana» against «Expired
 * 2 days ago» — so every counted sentence here is a template filled by
 * `strings.ts`'s `fill`, and the noun's form comes from `dayUnit`, which asks
 * `Intl.PluralRules` and therefore knows 1, 21 and 31 from 5 and 11.
 *
 * No `as const`: the literal type of a sentence is not something either locale
 * should be pinned to, and `typeof sr` widened to `string` is exactly the shape
 * `en` has to match.
 */
export const sr = {
  page: {
    // The page's own header is the module's name, which the shell already draws
    // from the manifest; this is the line under it.
    subtitle: "Šta je u kući, šta se troši i šta ističe.",
    loading: "Učitavanje…",
  },
  common: {
    // The two forms `dayUnit` chooses between for a counted day.
    day: "dan",
    days: "dana",
    save: "Sačuvaj",
    cancel: "Otkaži",
    remove: "Obriši",
    edit: "Izmeni",
  },
  units: {
    pcs: "kom",
    g: "g",
    kg: "kg",
    ml: "ml",
    l: "l",
    pack: "pakovanje",
  },
  categories: {
    food: "Hrana",
    medicine: "Lekovi",
    hygiene: "Higijena",
    emergency: "Za nepredviđeno",
    other: "Ostalo",
  },
  expiring: {
    title: "Ističe",
    caption: "U narednih {count} {unit}.",
    empty: "Ništa ne ističe uskoro.",
    today: "Ističe danas",
    soon: "Ističe za {count} {unit}",
    past: "Isteklo pre {count} {unit}",
    ok: "U roku",
    none: "Bez roka",
    // Shown BESIDE a date the packet does not carry: the day comes from the
    // opening date plus the "use within" the packet states.
    openedSource: "po otvaranju",
  },
  stock: {
    title: "Ostava",
    add: "Dodaj namirnicu",
    emptyTitle: "Ostava je prazna",
    emptyBody:
      "Zapiši šta imaš u kući — naziv, količinu i mesto gde stoji — pa Ostava prati šta se troši i šta ističe.",
    showArchived: "Prikaži i arhivirane",
    hideArchived: "Sakrij arhivirane",
    archived: "Arhivirano",
    archive: "Arhiviraj",
    unarchive: "Vrati među aktivne",
    // The header of the group holding items no shelf names.
    unassigned: "Bez mesta",
    // The two quick adjusts: "−1" and "+1" are the visible faces, and these are
    // the names a screen reader hears instead of a minus sign.
    decrease: "Smanji za jedan",
    increase: "Povećaj za jedan",
    // The state a minimum produces, on its own axis (never a mix of the two).
    low: "Fali {count} {unit}",
    // Throwing the rest away: the one move that records the `expired` reason.
    discard: "Bačeno",
  },
  form: {
    newTitle: "Nova namirnica",
    editTitle: "Izmena namirnice",
    name: "Naziv",
    category: "Vrsta",
    quantity: "Količina",
    unit: "Jedinica",
    location: "Mesto",
    locationNone: "Bez mesta",
    minQuantity: "Najmanja količina",
    minQuantityHint: "Kad količina padne ispod ove, namirnica ide na listu za kupovinu.",
    expiry: "Rok trajanja",
    opened: "Datum otvaranja",
    useWithin: "Iskoristi u roku od (dana od otvaranja)",
    notes: "Beleška",
    barcode: "Barkod",
    doseNote: "Kako se uzima",
    doseNoteHint: "Slobodan tekst sa kutije — Ostava ga čuva i ništa iz njega ne računa.",
  },
  locations: {
    title: "Mesta",
    name: "Naziv mesta",
    add: "Dodaj mesto",
    rename: "Preimenuj",
    up: "Pomeri gore",
    down: "Pomeri dole",
    empty: "Još nema mesta. Frižider, ostava, prva pomoć — ono gde stvari stoje.",
  },
  shopping: {
    title: "Lista za kupovinu",
    auto: "Same se nalaze na listi — količina im je ispod najmanje.",
    manual: "Ručno dodato",
    empty: "Lista je prazna — ništa ne nedostaje.",
    add: "Dodaj na listu",
    name: "Šta se kupuje",
    quantity: "Količina",
    unit: "Jedinica",
    link: "Poveži s namirnicom",
    linkNone: "Bez povezivanja",
    tick: "Kupljeno",
    tickHint: "Ako je linija povezana s namirnicom, količina se vraća u ostavu.",
    removeLine: "Ukloni s liste",
    unassigned: "Bez mesta",
    needed: "Fali {count} {unit}",
  },
  settings: {
    caption: "Rok za „ističe uskoro“ — i za prikaz i za podsetnik.",
    hint: "Podsetnik stiže najviše jednom dnevno, i to samo kad nešto stvarno ističe.",
    saved: "Sačuvano.",
    loadError: "Nije moguće učitati podešavanje.",
    saveError: "Podešavanje nije sačuvano.",
  },
  widget: {
    empty: "Ništa ne ističe uskoro.",
    loading: "Učitavanje…",
    loadError: "Nije moguće učitati ostavu.",
  },
  errors: {
    load: "Ostava nije učitana.",
    mutate: "Izmena nije sačuvana.",
    name: "Naziv je obavezan i može imati najviše 80 znakova.",
    quantity: "Količina mora biti broj veći od nule.",
    barcode: "Barkod je 8, 12, 13 ili 14 cifara, bez razmaka.",
    location: "Naziv mesta je obavezan i može imati najviše 60 znakova.",
    locationInUse: "Mesto još drži namirnice — premesti ih, pa ga obriši.",
    days: "Broj dana mora biti između 1 i 3650.",
  },
};

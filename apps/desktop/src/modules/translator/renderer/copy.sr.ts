/**
 * TRANSLATOR's own copy, in Serbian — the SHAPE every other locale of this
 * module is checked against (ADR-090).
 *
 * The module's page is not in the startup chunk, so its words are not in the
 * shell's `strings` table either: they live here, are registered with the locale
 * machinery when the chunk loads (`copy.ts`), and are rewritten in place by the
 * same `applyLocale` walk the shell's table goes through. English is
 * `copy.en.ts`, typed `typeof sr`, so a sentence left untranslated is one
 * compile error each.
 *
 * The register is the app's own: sentence case, no exclamation marks, and the
 * Serbian quotations and dashes the rest of the copy uses (`„` … `“`,
 * `–`, `—`). Placeholders are `{name}` slots filled with `fill`,
 * because a leaf cannot be a function — the live table is `structuredClone`d.
 */
export const sr = {
  page: {
    subtitle: "Rečnik srpskog i engleskog i fraze za put — rade bez mreže.",
    loading: "Učitavanje…",
  },
  search: {
    label: "Traži reč",
    placeholder: "kafa, coffee, ćevapčići…",
    hint: "Kucaj dok pišeš. Prvo idu tačni pogoci, pa reči koje počinju tako.",
    directionLabel: "Smer",
    directions: {
      auto: "Automatski",
      "en-sr": "Engleski → srpski",
      "sr-en": "Srpski → engleski",
    },
    autoResolved: "Automatski je izabran smer",
    hits: "{count} pogodaka",
    hitOne: "1 pogodak",
    noHits: "Nijedna reč ne odgovara upitu „{query}“.",
    noHitsHint: "Proveri kucanje ili promeni smer pretrage.",
    truncated: "Prikazani su prvi pogoci. Precizniji upit daje manje rezultata.",
    exactTitle: "Tačno poklapanje",
    prefixTitle: "Reči koje počinju tako",
  },
  entry: {
    translations: "Prevodi",
    meanings: "Značenja",
    source: "Izvor",
    copyWord: "Kopiraj reč",
    copyUrl: "Kopiraj adresu",
    copied: "Kopirano.",
    copyFailed: "Kopiranje nije uspelo.",
  },
  recent: {
    title: "Skorašnje",
    empty: "Još nema skorašnjih reči.",
    clear: "Obriši listu",
    again: "Traži ponovo",
  },
  phrases: {
    title: "Fraze za put",
    caption: "Iz Vikiputa — fraze po temama, na srpskom i engleskom.",
    loading: "Učitavanje fraza…",
    empty: "Ovaj paket ne nosi fraze.",
    topicHits: "{count} fraza",
  },
  sentences: {
    title: "Rečenice",
  },
  notInstalled: {
    title: "Rečnik još nije instaliran",
    body: "Ovaj modul čita paket rečnika sa ovog računara. Instaliraj ga u Podešavanjima, na kartici „Paketi sadržaja“, pa se vrati na ovu stranicu.",
  },
  errors: {
    load: "Stanje paketa nije moguće pročitati.",
    search: "Pretraga nije uspela.",
    phrases: "Fraze nije moguće pročitati.",
  },
  pack: {
    title: "Paket",
    words: "{count} reči u paketu",
    phrases: "{count} fraza",
    version: "verzija {version}",
  },
  settings: {
    caption: "Smer u kojem se rečnik otvara i koliko se skorašnjih reči pamti — na ovom računaru.",
    directionHint: "Automatski bira smer prema slovima upita i prema tome u kom indeksu ima pogodaka.",
    recentHint: "Koliko se poslednjih pretraga pamti na ovom računaru, od 0 do 20.",
    recentInvalid: "Unesi broj od 0 do 20.",
    saved: "Sačuvano.",
    reset: "Vrati na podrazumevano",
  },
};

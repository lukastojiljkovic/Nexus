/**
 * The wiki page's Serbian copy — the shape's source of truth.
 *
 * `copy.en.ts` is typed by this file, so a sentence left untranslated, a key
 * invented or a nested table that does not match is one compile error each. The
 * words follow the register of the surrounding app: an operating surface, short
 * sentences, and nothing that addresses the reader as a gender (`check:address`).
 */
export const sr = {
  page: {
    subtitle: "Vikipedija, rečnici i priručnici sa ovog računara, bez interneta.",
    loading: "Učitavanje biblioteka…",
  },
  errors: {
    load: "Biblioteke trenutno nije moguće pročitati. Pokušaj ponovo.",
    mutate: "Promena nije sačuvana. Pokušaj ponovo.",
    search: "Pretraga trenutno nije moguća.",
  },
  library: {
    title: "Biblioteke",
    emptyTitle: "Još nema nijedne biblioteke",
    emptyBody:
      "Dodaj ZIM datoteku koja je već na računaru ili preuzmi izdanje iz Kiwiks kataloga.",
    add: "Dodaj ZIM datoteku",
    open: "Otvori",
    remove: "Ukloni",
    checksum: "Provereno preuzimanje",
    unverified: "Neproverena datoteka",
    missing: "Datoteka nije na mestu",
    missingHint: "Datoteka je uklonjena ili premeštena. Ukloni biblioteku iz spiska.",
  },
  catalogue: {
    title: "Kiviks katalog",
    caption:
      "Preuzimanje počinje samo kada ga pokreneš, jedno po jedno. Preuzeto se proverava i ostaje na računaru.",
    load: "Učitaj katalog",
    loading: "Učitavanje kataloga…",
    download: "Preuzmi",
    cancel: "Otkaži",
    size: "Veličina",
    published: "Objavljeno",
    running: "Preuzimanje",
    paused: "Preuzimanje je pauzirano",
    done: "Preuzeto",
    failed: "Preuzimanje nije uspelo",
    empty: "Katalog ne nudi nijedno izdanje iz ove liste.",
    licence: "Licenca",
  },
  article: {
    title: "Stranica",
    bookmark: "Zapamti",
    bookmarked: "Zapamćeno",
    close: "Zatvori",
    unverifiedHint:
      "Ova datoteka nije preuzeta kroz Nexus, pa je prikazujemo kao neproverenu i samo je čitamo.",
    notHtml: "Ova adresa nije stranica koju Nexus prikazuje u okviru.",
  },
  search: {
    title: "Pretraga naslova",
    label: "Početak naslova",
    hint: "Pretraga ide po naslovima unutar izabrane biblioteke, dok kucaš.",
    noLibrary: "Izaberi biblioteku (dugme Otvori) da bi pretraga imala gde da traži.",
    empty: "Nema naslova koji počinju tim slovima.",
    fullText: "Puna pretraga po tekstu nije dostupna: indeks u paketu traži Xapian.",
  },
  history: {
    title: "Istorija čitanja",
    empty: "Još nema pročitanih stranica.",
    clear: "Očisti istoriju",
  },
  bookmarks: {
    title: "Zapamćene stranice",
    empty: "Još nema zapamćenih stranica.",
    remove: "Ukloni",
  },
  problem: {
    mode: "Preuzimanje radi samo u mrežnom režimu Preuzimanja. Promeni režim u Podešavanjima.",
    network: "Kiviks nije dostupan. Proveri vezu i pokušaj ponovo.",
    catalogue: "Ovog izdanja nema u katalogu.",
    "no-space": "Na disku nema dovoljno mesta za ovo izdanje.",
    download: "Preuzimanje nije uspelo. Pokušaj ponovo.",
    import: "Ova datoteka nije ZIM koju Nexus može da otvori.",
    busy: "Ovo izdanje se već preuzima.",
    "not-found": "Ova stranica nije nađena u biblioteci.",
    cancelled: "Preuzimanje je otkazano.",
  },
  widget: {
    empty: "Još nema pročitanih stranica.",
    loading: "Učitavanje…",
    loadError: "Istoriju trenutno nije moguće pročitati.",
  },
};

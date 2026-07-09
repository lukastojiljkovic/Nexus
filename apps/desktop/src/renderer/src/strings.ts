/**
 * Every user-facing string in the desktop renderer, in Serbian (launch language,
 * founder decision #2). Centralized so the later i18n extraction is a mechanical
 * move of this table into the i18n layer — no framework yet, by design.
 */
export const strings = {
  app: {
    brand: "Nexus",
    navLabel: "Glavna navigacija",
    themeToggle: "Promeni temu",
    themeDan: "Dan",
    themeNoc: "Noć",
    loading: "Učitavanje…",
    loadErrorTitle: "Pokretanje nije uspelo",
    loadErrorDescription:
      "Veza sa lokalnom bazom podataka nije uspostavljena. Zatvori aplikaciju i pokreni je ponovo.",
  },

  onboarding: {
    title: "Tvoj Nexus",
    description:
      "Nexus radi potpuno lokalno — svi podaci ostaju na ovom uređaju. Upiši ime profila i izaberi temu; sve ostalo podešavaš kasnije.",
    nameLabel: "Ime profila",
    namePlaceholder: "Upiši ime",
    themeLabel: "Tema",
    cta: "Kreni",
    saveError: "Čuvanje nije uspelo. Pokušaj ponovo.",
  },

  /** Display names for registered modules, keyed by module id. */
  modules: {
    dashboard: "Kontrolna tabla",
    tasks: "Zadaci",
    calendar: "Kalendar",
    settings: "Podešavanja",
    notes: "Beleške",
    study: "Učenje",
  } as Record<string, string>,

  dashboard: {
    /** Time-of-day salutations: jutro < 12h, dan 12–18h, veče ≥ 18h. */
    greeting: {
      jutro: "Dobro jutro",
      dan: "Dobar dan",
      vece: "Dobro veče",
    },
    /** Danas widget — today's events and tasks due today. */
    today: {
      title: "Danas",
      empty: "Nema obaveza danas 🎉",
      taskTag: "zadatak",
    },
    /** Predstojeći zadaci widget — the next active tasks. */
    upcoming: {
      title: "Predstojeći zadaci",
      empty: "Nema aktivnih zadataka",
    },
    /** Dokumenta koja ističu widget — documents past the reminder threshold. */
    expiring: {
      title: "Dokumenta koja ističu",
      empty: "Sva dokumenta su u redu ✅",
    },
    errorTitle: "Kontrolna tabla nije dostupna",
    errorDescription: "Podaci se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
  },

  modulePlaceholder: {
    description:
      "Ovaj modul stiže tokom v0 izgradnje. Navigacija je već spremna — sadržaj sledi.",
  },

  tasks: {
    quickAddPlaceholder: "Novi zadatak — upiši i pritisni Enter",
    quickAddSubmit: "Dodaj",
    quickAddLabel: "Novi zadatak",
    viewLabel: "Prikaz",
    viewList: "Lista",
    viewKanban: "Tabla",
    emptyTitle: "Nema zadataka",
    emptyDescription:
      "Zapiši prvi zadatak u polje iznad — dovoljno je ime i Enter.",
    loadError: "Zadaci se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
    deleteLabel: "Obriši zadatak",
    deletedNotice: "Zadatak obrisan",
    undo: "Vrati",
    dismiss: "Zatvori",
    /** Kanban column titles, keyed by task status value (labels are presentation). */
    status: {
      todo: "Za rad",
      doing: "U toku",
      done: "Završeno",
    },
    /** Priority chip labels; 'none' has no chip, so it is intentionally absent. */
    priority: {
      low: "Nizak",
      medium: "Srednji",
      high: "Visok",
    },
  },

  calendar: {
    viewLabel: "Prikaz",
    viewAgenda: "Agenda",
    viewDokumenta: "Dokumenta",
    titlePlaceholder: "Naziv događaja",
    titleLabel: "Naziv događaja",
    dateLabel: "Datum",
    timeLabel: "Vreme",
    locationPlaceholder: "Mesto (opciono)",
    locationLabel: "Mesto",
    allDay: "Ceo dan",
    add: "Dodaj",
    save: "Sačuvaj",
    cancel: "Otkaži",
    editLabel: "Izmeni događaj",
    deleteLabel: "Obriši događaj",
    emptyTitle: "Nema događaja",
    emptyDescription: "Dodaj prvi događaj u formi iznad — naziv i datum su dovoljni.",
    loadError: "Događaji se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
    deletedNotice: "Događaj obrisan",
    undo: "Vrati",
    dismiss: "Zatvori",
  },

  documents: {
    /** Type-label map, keyed by document type value (labels are presentation). */
    type: {
      licna_karta: "Lična karta",
      pasos: "Pasoš",
      vozacka: "Vozačka dozvola",
      registracija: "Registracija vozila",
      kartica: "Bankovna kartica",
      polisa: "Polisa osiguranja",
      custom: "Ostalo",
    },
    /** Status-chip labels, keyed by derived expiry status value. */
    status: {
      ok: "U redu",
      uskoro: "Uskoro ističe",
      istekao: "Isteklo",
    },
    typeLabel: "Vrsta dokumenta",
    labelPlaceholder: "Naziv dokumenta",
    labelLabel: "Naziv dokumenta",
    expiryLabel: "Ističe",
    notesPlaceholder: "Beleška (opciono)",
    notesLabel: "Beleška",
    add: "Dodaj",
    save: "Sačuvaj",
    cancel: "Otkaži",
    renew: "Obnovi",
    renewLabel: "Novi datum isteka",
    renewConfirm: "Potvrdi",
    renewCancel: "Otkaži obnovu",
    editLabel: "Izmeni dokument",
    deleteLabel: "Obriši dokument",
    emptyTitle: "Nema dokumenata",
    emptyDescription:
      "Dodaj prvi dokument u formi iznad — vrsta, naziv i datum isteka su dovoljni.",
    loadError: "Dokumenti se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
    deletedNotice: "Dokument obrisan",
    undo: "Vrati",
    dismiss: "Zatvori",
    /** Days-until phrasing; "za N dana" / "isteklo pre N dan(a)" build inline. */
    days: {
      tomorrow: "sutra",
      today: "danas ističe",
      future: "za",
      pastPrefix: "isteklo pre",
      unitOne: "dan",
      unitMany: "dana",
    },
  },

  diagnostics: {
    title: "Stanje sistema",
    version: "Verzija",
    electron: "Electron",
    chromium: "Chromium",
    node: "Node",
    database: "Baza podataka",
  },

  study: {
    title: "Predmeti",
    nameLabel: "Naziv predmeta",
    namePlaceholder: "Naziv predmeta",
    semesterLabel: "Semestar",
    semesterPlaceholder: "Semestar (opciono)",
    colorLabel: "Boja",
    /** Colour-dot names, keyed by subject colour value (labels are presentation). */
    color: {
      jade: "Žad",
      gold: "Zlatna",
      bronze: "Bronzana",
      burgundy: "Bordo",
      crimson: "Grimizna",
      graphite: "Grafit",
    },
    add: "Dodaj predmet",
    save: "Sačuvaj",
    cancel: "Otkaži",
    editLabel: "Izmeni predmet",
    archiveLabel: "Arhiviraj",
    unarchiveLabel: "Vrati iz arhive",
    deleteLabel: "Obriši predmet",
    deletedNotice: "Predmet obrisan",
    undo: "Vrati",
    dismiss: "Zatvori",
    emptyTitle: "Nema predmeta",
    emptyDescription: "Dodaj prvi predmet u formi iznad — naziv je dovoljan.",
    loadError: "Predmeti se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
    showArchived: "Prikaži arhivirano",
    hideArchived: "Sakrij arhivirano",
    noExams: "Nema zakazanih ispita za ovaj predmet.",
    addExam: "Dodaj ispit",
    saveExam: "Sačuvaj",
    cancelExam: "Otkaži",
    /** Exam-type labels, keyed by exam type value (labels are presentation). */
    examType: {
      pismeni: "Pismeni",
      usmeni: "Usmeni",
      kolokvijum: "Kolokvijum",
    },
    examTypeLabel: "Vrsta ispita",
    examDateLabel: "Datum ispita",
    examScopeLabel: "Gradivo",
    examScopePlaceholder: "Gradivo (opciono)",
    editExamLabel: "Izmeni ispit",
    deleteExamLabel: "Obriši ispit",
    deletedExamNotice: "Ispit obrisan",
    /** Countdown chip phrasing; "za N dan(a)" builds inline via `dayUnit`. */
    countdown: {
      today: "danas",
      tomorrow: "sutra",
      future: "za",
      unitOne: "dan",
      unitMany: "dana",
      past: "prošao",
    },
    calendarTag: "Ispit",
    dashboardTitle: "Ispiti",
    dashboardEmpty: "Nema zakazanih ispita.",

    // --- Decks (Špilovi), under each subject --------------------------------
    decksTitle: "Špilovi",
    noDecks: "Nema špilova za ovaj predmet.",
    addDeck: "Dodaj špil",
    saveDeck: "Sačuvaj",
    cancelDeck: "Otkaži",
    deckNameLabel: "Naziv špila",
    deckNamePlaceholder: "Naziv špila",
    editDeckLabel: "Izmeni špil",
    deleteDeckLabel: "Obriši špil",
    deletedDeckNotice: "Špil obrisan",
    newCount: "nove",
    dueCount: "za ponavljanje",
    openCards: "Kartice",
    studyDeck: "Uči",
    studyAll: "Uči sve",

    // --- Card management (deck drill-in) ------------------------------------
    cardsBack: "← Nazad",
    cardsEmptyTitle: "Nema kartica",
    cardsEmptyDescription:
      "Dodaj prvu karticu u formi iznad — prednja i zadnja strana su dovoljne.",
    loadCardsError: "Kartice se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
    addCard: "Dodaj karticu",
    saveCard: "Sačuvaj",
    cancelCard: "Otkaži",
    frontLabel: "Prednja strana",
    frontPlaceholder: "Prednja strana",
    backLabel: "Zadnja strana",
    backPlaceholder: "Zadnja strana",
    deckSelectLabel: "Špil",
    mathHint: "Koristi $…$ za matematičke izraze.",
    editCardLabel: "Izmeni karticu",
    deleteCardLabel: "Obriši karticu",
    deletedCardNotice: "Kartica obrisana",
    /** Card-state chip labels; Learning and Relearning share one label (both "in progress"). */
    cardState: {
      new: "Nova",
      learning: "Uči se",
      review: "Na ponavljanju",
    },
    cardDueLabel: "Sledeće ponavljanje",

    // --- Review session (keyboard-first) ------------------------------------
    reviewTitle: "Učenje",
    reviewExit: "Prekini",
    revealAnswer: "Prikaži odgovor",
    /** Grade-button labels, keyed by CardRating value (1–4, Again..Easy). */
    rating: {
      again: "Ponovo",
      hard: "Teško",
      good: "Dobro",
      easy: "Lako",
    },
    reviewUndo: "Opozovi",
    reviewHint: "Space — odgovor · 1–4 — ocena · U — opozovi · Esc — izlaz",
    reviewCompleteTitle: "Sve obnovljeno za sada.",
    reviewCompleteLabel: "Ocenjeno kartica",
    reviewBack: "Nazad",
  },
} as const;

/**
 * Serbian numeral agreement for day counts: numbers ending in 1 — except 11 —
 * take the singular ("za 21 dan"), everything else the genitive ("za 22 dana").
 * Lives beside the copy because it is a fact of the language, not of any module.
 */
export function dayUnit(count: number, one: string, many: string): string {
  return count % 10 === 1 && count % 100 !== 11 ? one : many;
}

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

  /** Local account lock screen (ADR-018 / AUTH-002..005): create → Kit za oporavak → unlock → recovery, plus the shared error map and the sidebar lock action. */
  auth: {
    validation: {
      tooWeak: "Pristupni kod mora imati bar 8 karaktera, uz najmanje jedno slovo i jednu cifru.",
      mismatch: "Kodovi se ne poklapaju.",
    },
    create: {
      title: "Zaštiti svoj Nexus",
      intro: "Postavi pristupni kod koji će štititi sve tvoje podatke na ovom računaru.",
      passcodeLabel: "Pristupni kod",
      passcodePlaceholder: "Najmanje 8 karaktera, slovo i cifra",
      confirmLabel: "Potvrdi pristupni kod",
      confirmPlaceholder: "Ponovi pristupni kod",
      note: "Svi podaci se šifruju ovim kodom. Ako ga zaboraviš, jedini put nazad je Kit za oporavak koji dobijaš u sledećem koraku — bez koda i bez Kita podaci ostaju trajno nedostupni.",
      submit: "Napravi nalog",
    },
    keystoreUnavailable: {
      title: "Sistemski trezor nije dostupan",
      description:
        "Nexus čuva deo ključa za šifrovanje u sistemskom trezoru Windows-a, a on trenutno nije dostupan na ovom Windows nalogu — bez njega se lokalni nalog ne može napraviti. Proveri da li je ovaj Windows nalog ispravno postavljen i pokušaj ponovo.",
    },
    recoveryKit: {
      title: "Kit za oporavak",
      description:
        "Ovaj kod se prikazuje samo jednom. Zapiši ga i sačuvaj odvojeno od računara — ako ikada zaboraviš pristupni kod, ovo je jedini način da ponovo uđeš u svoje podatke.",
      copy: "Kopiraj",
      copied: "Kopirano",
      // Gender-neutral by construction: Serbian past participles agree with the
      // speaker, and "Zapisao sam" would address only half the users.
      confirmCheckbox: "Kod je zapisan i sačuvan",
      continue: "Nastavi",
    },
    unlock: {
      title: "Nexus je zaključan",
      description: "Unesi pristupni kod da nastaviš.",
      passcodeLabel: "Pristupni kod",
      passcodePlaceholder: "Upiši pristupni kod",
      submit: "Otključaj",
      forgot: "Zaboravljen pristupni kod?",
      retryPrefix: "Previše pokušaja — probaj ponovo za",
    },
    recovery: {
      title: "Oporavak pristupa",
      descriptionForgot:
        "Unesi kod iz svog Kita za oporavak i postavi novi pristupni kod za ovaj uređaj.",
      descriptionOtherDevice:
        "Ovi podaci dolaze sa drugog računara ili Windows naloga, pa pristupni kod odavde ne važi. Otključaj ih Kitom za oporavak izdatim pri pravljenju naloga i postavi novi pristupni kod za ovaj uređaj.",
      codeLabel: "Kod za oporavak",
      codePlaceholder: "Upiši kod za oporavak",
      newPasscodeLabel: "Novi pristupni kod",
      newPasscodePlaceholder: "Najmanje 8 karaktera, slovo i cifra",
      confirmLabel: "Potvrdi novi pristupni kod",
      confirmPlaceholder: "Ponovi novi pristupni kod",
      submit: "Otključaj",
      back: "Nazad na otključavanje",
    },
    /** AuthErrorReason → Serbian, one sentence each; `generic` is the exhaustive-switch fallback. */
    error: {
      notInitialized: "Nalog na ovom uređaju još ne postoji.",
      alreadyInitialized: "Nalog na ovom uređaju već postoji.",
      wrongPasscode: "Pogrešan pristupni kod.",
      wrongRecoveryCode: "Kod za oporavak nije ispravan.",
      throttled: "Previše pokušaja — sačekaj da prođe vreme ispod.",
      weakPasscode: "Pristupni kod mora imati bar 8 karaktera, uz najmanje jedno slovo i jednu cifru.",
      keystoreUnavailable: "Sistemski trezor za ključeve nije dostupan na ovom Windows nalogu.",
      otherDevice: "Ovi podaci dolaze sa drugog računara ili Windows naloga — otključaj Kitom za oporavak.",
      corruptKeychain: "Fajl sa ključevima je oštećen i ne može se pročitati.",
      generic: "Radnja nije uspela. Pokušaj ponovo.",
    },
    lockAction: "Zaključaj",
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

  notes: {
    newNote: "Nova beleška",
    untitled: "Bez naslova",
    listEmptyTitle: "Nema beležaka",
    listEmptyDescription:
      "Kreiraj prvu belešku dugmetom iznad — piše se u editoru sa desne strane.",
    noSelectionTitle: "Nijedna beleška nije izabrana",
    noSelectionDescription: "Izaberi belešku sa leve strane ili kreiraj novu.",
    placeholder: "Počni da pišeš, ili otkucaj „/” za komande…",
    deleteLabel: "Obriši belešku",
    deletedNotice: "Beleška obrisana",
    undo: "Vrati",
    dismiss: "Zatvori",
    loadError: "Beleške se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
    editorLoadError: "Beleška se ne može učitati. Pokušaj ponovo.",
    saveError: "Čuvanje beleške nije uspelo — pokušaćemo ponovo pri sledećoj izmeni.",
    saveTooLarge:
      "Deo beleške je prevelik da bi se sačuvao odjednom. Podeli veliki umetnuti sadržaj na manje delove.",
    /** Organizer (slice a3b): the folder tree, filters, per-note pin/move. */
    allNotes: "Sve beleške",
    unfiled: "Bez fascikle",
    foldersLabel: "Fascikle",
    newFolder: "Nova fascikla",
    newSubfolder: "Nova podfascikla",
    renameFolder: "Preimenuj",
    recolorFolder: "Promeni boju",
    deleteFolder: "Obriši fasciklu",
    noColor: "Bez boje",
    folderNamePlaceholder: "Naziv fascikle",
    folderMenuLabel: "Radnje nad fasciklom",
    moveToFolder: "Premesti u fasciklu",
    noteMenuLabel: "Više opcija",
    pin: "Zakači",
    unpin: "Otkači",
    save: "Sačuvaj",
    cancel: "Otkaži",
    folderError: "Radnja nad fasciklom nije uspela. Pokušaj ponovo.",
    /** Tags (slice a3b-2): filter chips + tag CRUD + per-note tag editor. */
    tagsLabel: "Oznake",
    newTag: "Nova oznaka",
    tagNamePlaceholder: "Naziv oznake",
    renameTag: "Preimenuj",
    deleteTag: "Obriši oznaku",
    tagMenuLabel: "Radnje nad oznakom",
    tagFilterLabel: "Filter po oznakama",
    clearTagFilter: "Poništi",
    tagError: "Radnja nad oznakom nije uspela. Pokušaj ponovo.",
    tagFilterEmptyDescription: "Nijedna beleška ne odgovara izabranim oznakama.",
    /** Wiki-links (slice b): the `[[` link menu + the backlinks panel. */
    backlinksTitle: "Povratne veze",
    wikiLinkMissing: "Nedostupna beleška",
    /** Attachments (NOTE-003b): the Prilozi panel + in-document image blocks. */
    attachmentsTitle: "Prilozi",
    attach: "Priloži datoteku",
    attachmentOpen: "Otvori",
    attachmentSaveAs: "Sačuvaj kao…",
    attachmentRemove: "Ukloni prilog",
    attachmentMenuLabel: "Radnje nad prilogom",
    attachmentTooLarge: "Datoteka je veća od 50 MB i ne može se priložiti.",
    attachmentError: "Radnja nad prilogom nije uspela. Pokušaj ponovo.",
    attachmentMissing: "Prilog je uklonjen.",
    /** Version history (NOTE-008b): the in-pane browser + restore flow. */
    historyTitle: "Istorija verzija",
    historyOpen: "Istorija verzija",
    backToEditing: "Nazad na uređivanje",
    historyEmpty: "Još nema sačuvanih verzija — nastaju automatski tokom pisanja.",
    historyRestore: "Vrati ovu verziju",
    historyRestoreNote: "Trenutno stanje se automatski čuva kao verzija pre vraćanja.",
    historyError: "Radnja nad verzijama nije uspela. Pokušaj ponovo.",
    /** Templates (NOTE-009b): the in-pane picker, save-as-template, manage. */
    templatesTitle: "Šabloni",
    templatesOpen: "Šabloni",
    templatesBuiltinGroup: "Ugrađeni",
    templatesUserGroup: "Moji šabloni",
    templatesUserEmpty: "Još nemaš svoje šablone.",
    templateInsert: "Umetni šablon",
    templateInsertNote: "Šablon se dodaje na kraj beleške.",
    templateSaveAs: "Sačuvaj kao šablon",
    templateSaveNote: "Prilozi se ne čuvaju u šablonu.",
    templateNamePlaceholder: "Naziv šablona",
    templateOverwriteNote: "Šablon sa tim nazivom već postoji — biće zamenjen.",
    templateRename: "Preimenuj",
    templateDelete: "Obriši šablon",
    templateMenuLabel: "Radnje nad šablonom",
    templateBroken: "Ovaj šablon se ne može prikazati.",
    templateTooLarge: "Beleška je prevelika da bi se sačuvala kao šablon.",
    templateError: "Radnja nad šablonima nije uspela. Pokušaj ponovo.",
    /** Prefix for a template's slash-menu label (NOTE-009c), e.g. "Šablon: Sastanak". */
    slashTemplatePrefix: "Šablon: ",
    templateBuiltins: {
      sastanak: "Sastanak",
      dnevnik: "Dnevnik",
      recept: "Recept",
      predmet: "Predmet",
      projekat: "Projekat",
    },
    /** Slash-menu command labels (block conversions), in menu order. */
    slash: {
      paragraph: "Paragraf",
      heading1: "Naslov 1",
      heading2: "Naslov 2",
      heading3: "Naslov 3",
      bulletList: "Lista",
      orderedList: "Numerisana lista",
      taskList: "Lista zadataka",
      blockquote: "Citat",
      codeBlock: "Blok koda",
      divider: "Razdvajač",
      flashcard: "Kartica (pitanje :: odgovor)",
    },
    /** Inline flashcards (NOTE-006c / ADR-017): the `::` / `{{…}}` syntax + the deck-mapping bar. */
    cardsLabel: "Kartice",
    cardsUnmapped: "Ova beleška pravi kartice za učenje. Izaberi špil:",
    cardsDeckSelectLabel: "Špil za kartice",
    cardsDeckPlaceholder: "Izaberi špil",
    cardsNoDecks: "Napravi špil u modulu Učenje da bi kartice iz ove beleške imale gde da odu.",
    cardsDeckPrefix: "Špil: ",
    cardsChangeDeck: "Promeni špil",
    cardsCancelChange: "Otkaži",
    cardsError: "Kartice nisu sačuvane. Pokušaj ponovo.",
    cardScaffold: "Pitanje :: Odgovor",
  },

  calendar: {
    viewLabel: "Prikaz",
    viewMesec: "Mesec",
    viewNedelja: "Nedelja",
    viewDan: "Dan",
    viewAgenda: "Agenda",
    viewDokumenta: "Dokumenta",
    titlePlaceholder: "Naziv događaja",
    titleLabel: "Naziv događaja",
    dateLabel: "Datum",
    timeLabel: "Vreme",
    /** End-time field (week/day view, ADR-020) — next to the start-time field, timed events only. */
    endTimeLabel: "Do",
    /** Client-side guard mirroring EventStore's own "end must not be before start" check. */
    endBeforeStart: "Vreme završetka mora biti posle vremena početka.",
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
    /** Source-filter toggle chips (month grid + agenda share one set of toggles). */
    sourcesLabel: "Izvori",
    sourceEvents: "Događaji",
    sourceTasks: "Zadaci",
    sourceExams: "Ispiti",
    sourceBlocks: "Učenje",
    /** Tag chip on a read-only task row in the agenda (ADR-020). */
    taskTag: "Zadatak",
    /** Grid navigation (ADR-020): prev/today/next — one pair of labels shared by Mesec/Nedelja/Dan, since each shifts by its own period. */
    prevPeriod: "Prethodni period",
    nextPeriod: "Sledeći period",
    today: "Danas",
    showMore: "još",
    showLess: "Prikaži manje",
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
    /** Dashboard "Učenje" widget (streak + today's focus minutes). */
    dashboardStudyTitle: "Učenje",
    dashboardFocusTodayLabel: "Fokus danas",

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
    /** Source-link control for a note-generated card (ADR-017 / STUDY-008). */
    cardSourcePrefix: "Iz beleške: ",
    cardSourceLabel: "Otvori izvornu belešku",
    cardSourceMissing: "Iz beleške (nedostupna)",

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

    // --- Exam study plans (Planovi učenja, STUDY piece 3b) -------------------
    plansTitle: "Planovi učenja",
    todayTitle: "Danas za učenje",
    todayEmpty: "Danas nema planiranih blokova učenja.",
    newPlan: "Novi plan",
    addPlan: "Dodaj plan",
    savePlan: "Sačuvaj",
    cancelPlan: "Otkaži",
    planExamLabel: "Ispit",
    planStartLabel: "Početak učenja",
    planMinutesLabel: "Minuta dnevno",
    planBoostLabel: "Duplo vremena poslednjih 7 dana",
    planEdit: "Izmeni",
    planDelete: "Obriši",
    deletedPlanNotice: "Plan obrisan",
    plansEmpty: "Još nema planova učenja.",
    noPlannableExams: "Nema predstojećih ispita za novi plan.",
    /** Plan summary building blocks — "60 min/dan · duplo poslednjih 7 dana". */
    planPerDay: "min/dan",
    planBoostSummary: "duplo poslednjih 7 dana",
    /** Progress phrasing — "3 od 12 urađeno" builds inline. */
    planProgressOf: "od",
    planProgressDone: "urađeno",
    minutesUnit: "min",
    planShowBlocks: "Prikaži blokove",
    planHideBlocks: "Sakrij blokove",
    blockDoneLabel: "Označi blok kao urađen",
    /** Study-block status chip labels, keyed by status value (labels are presentation). */
    blockStatus: {
      planned: "planirano",
      done: "urađeno",
      missed: "propušteno",
    },
    /** Tag chip on read-only study-block rows in the calendar agenda. */
    planCalendarTag: "Učenje",
    /** PlanStore/IPC validation failures mapped to Serbian; `generic` is the fallback. */
    planError: {
      duplicate: "Ovaj ispit već ima aktivan plan.",
      examPast: "Ispit mora biti u budućnosti.",
      startAfterExam: "Početak učenja mora biti pre datuma ispita.",
      minutesRange: "Dnevni minuti moraju biti između 15 i 480.",
      generic: "Čuvanje plana nije uspelo. Pokušaj ponovo.",
    },
    /**
     * Plan-restore failure, mapped separately from `planError`: a stale undo
     * offer that can never succeed again (typically the exam gained a newer
     * active plan in the meantime) rather than a live form's validation.
     */
    planRestoreError: {
      duplicate: "Plan nije vraćen — ispit u međuvremenu ima nov aktivan plan.",
      generic: "Vraćanje plana nije uspelo.",
    },

    // --- Study stats + focus timer (Statistika i fokus, STUDY piece 4b) ------
    statsTitle: "Statistika i fokus",
    focusTitle: "Tajmer fokusa",
    focusSubjectLabel: "Predmet za fokus",
    focusStart: "Pokreni fokus",
    focusStop: "Zaustavi",
    focusDiscard: "Odbaci",
    focusNoSubjects: "Nema aktivnih predmeta — dodaj predmet da bi pokrenuo tajmer fokusa.",
    focusUnknownSubject: "Nepoznat predmet",
    /** Streak line — "Niz učenja: N dana" + "Najduži niz: M" building blocks. */
    streakLabel: "Niz učenja",
    streakUnitOne: "dan",
    streakUnitMany: "dana",
    streakZero: "Još nema niza učenja — počni danas.",
    streakBestLabel: "Najduži niz",
    statsRecentTitle: "Poslednjih 30 dana",
    statsMinutesTitle: "Minuti po predmetu",
    statsOtherSubject: "Ostalo",
    statsEmpty: "Još nema podataka o učenju u poslednjih 30 dana.",
    statsReviewsLabel: "Ponavljanja",
    /** Block summary — "Blokovi: 5 urađeno · 2 propušteno" builds inline. */
    statsBlocksLabel: "Blokovi",
    statsBlocksDone: "urađeno",
    statsBlocksMissed: "propušteno",
    focusSessionsTitle: "Nedavne sesije fokusa",
    focusSessionsEmpty: "Nema sesija fokusa u poslednjih 7 dana.",
    deleteFocusSessionLabel: "Obriši sesiju fokusa",
    deletedFocusSessionNotice: "Sesija fokusa obrisana",
  },

  notifications: {
    bellLabel: "Obaveštenja",
    empty: "Nema novih obaveštenja.",
    dismissLabel: "Ukloni obaveštenje",
    snoozedUntil: "odloženo do",
    /** Source tag chip on each center row, keyed by NotificationSource value. */
    sourceTag: {
      document: "Dokument",
      exam: "Ispit",
      "study-day": "Učenje",
    },
    /** Snooze preset button labels, keyed by SnoozePreset value. */
    snoozePreset: {
      "10m": "10 min",
      "1h": "1 h",
      tonight: "Večeras",
      "tomorrow-morning": "Sutra ujutru",
    },
    settings: {
      show: "Podešavanja obaveštenja",
      hide: "Sakrij podešavanja",
      quietFromLabel: "Tiho od",
      quietToLabel: "Tiho do",
      quietSave: "Sačuvaj",
      quietClear: "Očisti",
      quietHint: "Podsetnici sačekaju kraj tihih sati; poslednje upozorenje ipak stiže.",
      quietPairingError: "Oba vremena moraju biti popunjena, ili oba prazna.",
      morningHourLabel: "Jutarnji podsetnik u",
      /** Source toggle checkbox labels, keyed by NotificationSource value. */
      sourceToggle: {
        document: "Dokumenta",
        exam: "Ispiti",
        "study-day": "Učenje",
      },
      saveError: "Čuvanje podešavanja nije uspelo. Pokušaj ponovo.",
    },
  },

  settings: {
    // The page title reuses `strings.modules.settings` — no duplicate copy.
    /** Section-card titles, in the order they appear on the page. */
    sectionTitle: {
      profile: "Profil",
      security: "Sigurnost",
      appearance: "Izgled",
      modules: "Moduli",
      notifications: "Obaveštenja",
      backup: "Rezervna kopija",
      about: "O aplikaciji",
    },
    profile: {
      nameLabel: "Ime",
      save: "Sačuvaj",
      saveError: "Čuvanje nije uspelo — ime mora imati 1–80 karaktera.",
    },
    /** Sigurnost section (ADR-018 / AUTH): change passcode, regenerate the Recovery Kit, idle auto-lock. */
    security: {
      changeTitle: "Promeni pristupni kod",
      currentLabel: "Trenutni kod",
      newLabel: "Novi kod",
      confirmLabel: "Potvrdi novi kod",
      save: "Sačuvaj",
      changeSuccess: "Pristupni kod je promenjen.",
      recoveryTitle: "Novi kod za oporavak",
      recoveryWarning:
        "Pravljenje novog koda odmah poništava stari — ako je stari negde zapisan, prepiši preko njega novi.",
      regenerate: "Napravi novi kod za oporavak",
      autoLockTitle: "Automatsko zaključavanje",
      autoLockHint: "Nexus se sam zaključava posle ovoliko neaktivnosti.",
      /** AUTO_LOCK_MINUTES values as select option labels, keyed by the numeric value as a string. */
      autoLockOptions: {
        "5": "Posle 5 minuta",
        "15": "Posle 15 minuta",
        "30": "Posle 30 minuta",
        "60": "Posle 1 sata",
        "0": "Nikad",
      } as Record<string, string>,
    },
    /** Theme-preference option labels; Dan/Noć reuse `strings.app.themeDan/themeNoc`. */
    appearance: {
      system: "Sistemski",
      accentLabel: "Boja akcenta",
      /** Accent swatch names, keyed by AccentId (SET's 8-accent palette). */
      accentNames: {
        zlato: "Zlato",
        bronza: "Bronza",
        maslina: "Maslina",
        suma: "Šuma",
        zad: "Žad",
        ruza: "Ruža",
        bordo: "Bordo",
        grafit: "Grafit",
      } as Record<string, string>,
    },
    /** One-line module descriptions for the gallery, keyed by module id. */
    moduleDescriptions: {
      dashboard: "Pregled dana na jednom mestu — obaveze, zadaci i dokumenta koja ističu.",
      tasks: "Zadaci sa listom i tablom, prioritetima i rokovima.",
      calendar: "Događaji, agenda i praćenje isteka dokumenata.",
      settings: "Profil, izgled, moduli i obaveštenja.",
      notes: "Beleške sa blok-editorom — markdown prečice i „/” meni za formatiranje.",
      study: "Predmeti, ispiti, kartice za učenje i planovi pripreme za ispite.",
    } as Record<string, string>,
    /** Category-group headings above the module gallery, keyed by registry category. */
    moduleCategories: {
      "Core experience": "Osnovno iskustvo",
      "Content & knowledge": "Sadržaj i znanje",
      "Life hubs": "Životni centri",
      "Professional & utilities": "Profesionalno i alati",
      "Growth & platform": "Rast i platforma",
    } as Record<string, string>,
    modulesAlwaysOn: "Uvek uključeno",
    modulesToggleError: "Promena nije uspela. Pokušaj ponovo.",
    /** NTF-008 appetite presets — shortcuts over the per-source toggles below. */
    notificationPresets: {
      minimal: "Minimalno",
      normal: "Normalno",
      all: "Sve",
      caption: "Prečice za izvore ispod.",
    },
    /** Rezervna kopija (IMEX slice a1) — full-export button + confirmation/error lines. */
    backup: {
      description:
        "Izvezi sve svoje podatke u jednu .nexus.zip arhivu — otvoreni formati (JSON i CSV), čitljivi i upotrebljivi bez Nexusa.",
      plaintextNotice:
        "Baza podataka je šifrovana tvojim pristupnim kodom, ali ova arhiva nije — čuvaj je na sigurnom mestu.",
      exportButton: "Izvezi sve podatke…",
      savedPrefix: "Sačuvano:",
      /** "N zapis"/"N zapisa" — Serbian numeral agreement via `dayUnit`. */
      recordsUnitOne: "zapis",
      recordsUnitMany: "zapisa",
      error: "Izvoz nije uspeo. Pokušaj ponovo.",
    },
    about: {
      version: "Verzija",
      electron: "Electron",
      chromium: "Chromium",
      node: "Node",
      dataLocation: "Lokacija podataka",
    },
  },

  /** Global search palette (021-d / ADR-021): nav label + shortcut hint, the
   *  input placeholder, kind labels (singular for a result row's own kind
   *  tag; plural for both the filter chips and the per-kind group headings),
   *  the two non-kind group headings, the key-hint footer, the empty-result
   *  line, and the local command labels `searchCommands.ts` matches against. */
  search: {
    navLabel: "Pretraga",
    shortcutHint: "Ctrl+K",
    placeholder: "Pretraži zadatke, beleške, događaje…",
    kindFilterLabel: "Filter po vrsti",
    recentGroup: "Nedavno",
    commandsGroup: "Komande",
    emptyResults: "Nema rezultata.",
    hint: "↑↓ kretanje · Enter otvori · Esc zatvori",
    kindSingular: {
      task: "Zadatak",
      event: "Događaj",
      note: "Beleška",
      document: "Dokument",
      subject: "Predmet",
      exam: "Ispit",
      deck: "Špil",
      card: "Kartica",
      attachment: "Prilog",
    },
    kindPlural: {
      task: "Zadaci",
      event: "Događaji",
      note: "Beleške",
      document: "Dokumenti",
      subject: "Predmeti",
      exam: "Ispiti",
      deck: "Špilovi",
      card: "Kartice",
      attachment: "Prilozi",
    },
    /** `searchCommands.ts`'s fixed command list; "Promeni temu" itself reuses `strings.app.themeToggle` rather than duplicating it here. */
    commands: {
      goToPrefix: "Idi na: ",
      // PRD 08 SRCH-003: one quick-create command per creatable entity,
      // between the "Idi na" group and the theme toggle.
      newTask: "Novi zadatak",
      newEvent: "Novi događaj",
      newNote: "Nova beleška",
      lock: "Zaključaj aplikaciju",
      rebuildIndex: "Ponovo izgradi indeks pretrage",
      rebuildDonePrefix: "Indeks je ponovo izgrađen:",
      rebuildRecordsUnitOne: "zapis",
      rebuildRecordsUnitMany: "zapisa",
      rebuildError: "Ponovno izgrađivanje indeksa nije uspelo.",
    },
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

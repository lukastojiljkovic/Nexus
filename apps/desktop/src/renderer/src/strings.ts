/**
 * Every user-facing string in the desktop renderer, in Serbian (launch language,
 * founder decision #2). Centralized so the later i18n extraction is a mechanical
 * move of this table into the i18n layer — no framework yet, by design.
 */
import type {
  ArchiveReadErrorCode,
  RestoreModuleCounts,
  RestoreProblemCode,
} from "../../shared/ipc.js";
import type { WeekStartPreference } from "./weekStart.js";

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
    /** Danas widget — today's events, birthdays, and tasks due today. */
    today: {
      title: "Danas",
      empty: "Nema obaveza danas 🎉",
      taskTag: "zadatak",
      /** Leading tag on a birthday/anniversary row, in place of a time — same lower-case idiom as `taskTag`. */
      personTag: {
        birthday: "rođendan",
        anniversary: "godišnjica",
      },
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
    editLabel: "Izmeni zadatak",
    deleteLabel: "Obriši zadatak",
    deletedNotice: "Zadatak obrisan",
    undo: "Vrati",
    dismiss: "Zatvori",
    /**
     * A due date recognised in the quick-add line itself (TASK-007) — "Kupi
     * mleko sutra". The chip shows what will be saved before Enter is pressed,
     * so the reading is always correctable rather than surprising.
     */
    quickDate: {
      /** Names the live region that announces the recognised date. */
      regionLabel: "Prepoznat rok",
      /** Tooltip on the chip — says what happens on save. */
      chipTitle: "Rok prepoznat iz naslova — primeniće se pri čuvanju",
      dismissLabel: "Zanemari prepoznat rok",
    },
    /** Detail fields of the shared add/edit form (the quick-add line stays the fast path). */
    dueDateLabel: "Rok",
    priorityLabel: "Prioritet",
    save: "Sačuvaj",
    cancel: "Otkaži",
    /**
     * The "Podsetnik" chip row on the task form (ADR-028) — the same shape as
     * `calendar.reminders`, counted in DAYS rather than minutes, because a
     * task's deadline is a day. Every chip's label is built from these by one
     * formatter, so the fixed ladder and an offset loaded from a stored task
     * read the same way: "Na dan roka", "1 dan ranije", "3 dana ranije".
     */
    reminders: {
      label: "Podsetnik",
      /** Shown in place of the chips while the form has no (valid) rok to count back from — the store refuses that combination. */
      needsDate: "Postavi rok da bi podsetnik bio moguć.",
      /** The zero-day chip: the reminder fires on the due day itself, at the morning hour. */
      atDue: "Na dan roka",
      /** Trailing word of every non-zero lead time; the counted day noun takes `dayUnit`. */
      before: "ranije",
    },
    /** Per-row „+” and the inline line it opens (TASK-008). A subtask starts as a bare name; rok/prioritet/ponavljanje are set afterwards through the ✎ form, like on any task. */
    addSubtaskLabel: "Dodaj podzadatak",
    subtaskPlaceholder: "Novi podzadatak — upiši i pritisni Enter",
    /** Tooltip on the `2/5` roll-up chip; the number alone cannot say what it counts. */
    subtaskProgressTitle: "Završeni podzadaci",
    /**
     * The open-subtasks question (PRD 03 §4). Completing a parent reaches rows
     * the user did not tick, so it is asked rather than assumed — no default,
     * and Otkaži is the way out that changes nothing.
     */
    subtasks: {
      title: "Podzadaci",
      question: "Zadatak ima otvorene podzadatke.",
      completeAll: "Završi i podzadatke",
      completeOne: "Završi samo zadatak",
      cancel: "Otkaži",
    },
    /**
     * The list rail and the sections inside a list (TASK-004 / ADR-029).
     *
     * The Inbox is deliberately NOT named here: it is a stored, renamable row
     * like any other list, so the rail renders `list.name` and the delete
     * dialog's "move them there" choice names it from the same row — a
     * hard-coded „Inbox“ would go stale the moment the founder renames it to
     * „Prijemno“.
     */
    lists: {
      /** Heading above the rail; the rail's own accessible name is a touch longer, since „Liste“ alone says little out of context. */
      title: "Liste",
      railLabel: "Liste zadataka",
      newList: "Nova lista",
      newSubList: "Nova podlista",
      listNamePlaceholder: "Ime liste",
      renameListLabel: "Preimenuj listu",
      deleteListLabel: "Obriši listu",
      save: "Sačuvaj",
      cancel: "Otkaži",
      /** Shown under the rail when a list/section action failed — the inline editor stays open with what was typed still in it. */
      actionError: "Radnja nije uspela. Pokušaj ponovo.",
      deletedNotice: "Lista obrisana",
      /**
       * What to do with the tasks of a list being deleted. The two choices lose
       * different things, so there is no default and no primary button; Otkaži
       * is the way out that changes nothing.
       */
      dialog: {
        title: "Brisanje liste",
        question: "Šta sa zadacima iz ove liste?",
        /** Followed by the Inbox's own stored name in quotes — see the block comment above. */
        moveToInboxPrefix: "Premesti u",
        deleteTasks: "Obriši i zadatke",
        cancel: "Otkaži",
      },
      /** The add/edit form's heading select, shown only where the list has headings to pick. */
      sectionLabel: "Sekcija",
      noSection: "Bez sekcije",
      newSection: "Nova sekcija",
      sectionNamePlaceholder: "Ime sekcije",
      renameSectionLabel: "Preimenuj sekciju",
      deleteSectionLabel: "Obriši sekciju",
    },
    /**
     * Oznake (migration 023) — the NOTE module's tag wording one module over,
     * key for key with `strings.notes`' tag block (`tagsLabel` → `label`,
     * `tagNamePlaceholder` → `namePlaceholder`, `tagError` → `actionError`, …),
     * unprefixed because the block itself already says „tag“. Identical Serbian
     * where the sentence is identical: a label is a label whichever entity
     * carries it, so the two modules must not word it two ways.
     */
    tags: {
      label: "Oznake",
      newTag: "Nova oznaka",
      namePlaceholder: "Naziv oznake",
      rename: "Preimenuj",
      /** Accessible name of the rename field — the action in full, like `lists.renameSectionLabel`; the menu item itself stays the short „Preimenuj“. */
      renameLabel: "Preimenuj oznaku",
      delete: "Obriši oznaku",
      /** The rail chip's own „⋯“ menu (rename/delete one tag). */
      menuLabel: "Radnje nad oznakom",
      /** The per-task „⋯“ menu that attaches/detaches this task's tags. */
      taskMenuLabel: "Oznake zadatka",
      filterLabel: "Filter po oznakama",
      clearFilter: "Poništi",
      actionError: "Radnja nad oznakom nije uspela. Pokušaj ponovo.",
      /** Shown in place of the rows when the tag filter matches nothing in the selected list. */
      filterEmptyDescription: "Nijedan zadatak ne odgovara izabranim oznakama.",
    },
    /**
     * Prilozi (migration 024) — files hung off a task. The NOTE panel's wording
     * one module over, and deliberately the SAME Serbian wherever the sentence
     * is the same: „Prilozi“, „Priloži datoteku“, „Otvori“, „Sačuvaj kao…“ mean
     * exactly what they mean on a note, and two phrasings for one action would
     * only be two things to learn.
     *
     * Only the strings a task genuinely words differently live here: the
     * section is visible only while EDITING (a task that has not been created
     * has no id to hang a file off), the file picker is a native dialog rather
     * than a drop zone, and the per-row chip counts.
     */
    attachments: {
      title: "Prilozi",
      attach: "Priloži datoteku",
      open: "Otvori",
      saveAs: "Sačuvaj kao…",
      remove: "Ukloni prilog",
      /** The per-attachment „⋯“ menu, mirroring `tags.menuLabel`'s shape. */
      menuLabel: "Radnje nad prilogom",
      /** Shown when the picker refused one or more files for size. The 50 MB bound is the store's own (`MAX_TASK_ATTACHMENT_BYTES`), stated here as a plain fact rather than counted files — the count varies, the limit does not. */
      tooLarge: "Datoteke veće od 50 MB se ne mogu priložiti.",
      actionError: "Radnja nad prilogom nije uspela. Pokušaj ponovo.",
      /**
       * The muted row/card chip: „1 prilog“ / „3 priloga“ — Serbian numeral
       * agreement via `dayUnit`, the same two-form rule every other counted
       * noun in this file uses.
       */
      chipUnitOne: "prilog",
      chipUnitMany: "priloga",
      /** Tooltip on that chip; the number alone cannot say what it counts. */
      chipTitle: "Priloženih datoteka",
    },
    /** Kanban column titles, keyed by task status value (labels are presentation). */
    status: {
      todo: "Za rad",
      doing: "U toku",
      done: "Završeno",
    },
    /**
     * Priority labels. `none` is the form select's own "no priority" option and
     * never becomes a chip — the row rendering skips that value entirely.
     */
    priority: {
      none: "Bez prioriteta",
      low: "Nizak",
      medium: "Srednji",
      high: "Visok",
    },
  },

  /**
   * Recurrence (ADR-024) — shared by the task form and the event form, so it
   * belongs to neither. The custom controls are deliberately LABELLED FIELDS
   * ("Na svakih: 3") rather than a sentence ("na svaka 3 dana"): Serbian
   * numerals take three forms (1 / 2–4 / 5+) while `dayUnit` knows two, so a
   * counted noun beside a freely typed number would be wrong at some counts.
   * The one counted phrase that survives is "Posle N ponavljanja", where the
   * genitive "ponavljanja" is the correct form at every N.
   */
  recurrence: {
    fieldLabel: "Ponavljanje",
    /** Shown in place of the controls while the form has no (valid) date to phase a rule from. */
    needsDate: "Postavi datum da bi ponavljanje bilo moguće.",
    /** The preset select, in menu order; `custom` opens the fields below it. */
    preset: {
      none: "Ne ponavlja se",
      daily: "Svakog dana",
      weekdays: "Radnim danima",
      weekly: "Svake nedelje",
      monthly: "Svakog meseca",
      yearly: "Svake godine",
      custom: "Prilagođeno…",
    },
    freqLabel: "Učestalost",
    freq: {
      daily: "Dnevno",
      weekdays: "Radnim danima",
      weekly: "Nedeljno",
      monthly: "Mesečno",
      yearly: "Godišnje",
    },
    intervalLabel: "Na svakih",
    daysLabel: "Dani",
    /** Monday-first, matching `RecurrenceWeekday`'s own 0 = Monday indexing. */
    weekdayShort: ["Pon", "Uto", "Sre", "Čet", "Pet", "Sub", "Ned"],
    weekday: ["ponedeljak", "utorak", "sreda", "četvrtak", "petak", "subota", "nedelja"],
    monthlyModeLabel: "Način",
    monthlyModeDate: "Po datumu",
    monthlyModeOrdinal: "Po danu u nedelji",
    monthDayLabel: "Dan u mesecu",
    ordinalLabel: "Redosled",
    /**
     * Keyed by `RecurrenceOrdinal` as a string; `-1` is the month's last such
     * weekday. Rendered as its own select beside the weekday's, never joined
     * into a phrase — "prvi" agrees with utorak but not with sreda.
     */
    ordinal: {
      "1": "prvi",
      "2": "drugi",
      "3": "treći",
      "4": "četvrti",
      "-1": "poslednji",
    } as Record<string, string>,
    weekdayLabel: "Dan",
    endLabel: "Završetak",
    endNever: "Nikad",
    endUntil: "Do datuma",
    endCount: "Posle N ponavljanja",
    endUntilLabel: "Datum završetka",
    endCountLabel: "Broj ponavljanja",
    endCountUnit: "ponavljanja",
    /** Accessible name of the ↻ marker on a recurring row/chip. */
    marker: "Ponavlja se",
    /** After completing one occurrence of a recurring task; the next date follows. */
    nextOccurrence: "Sledeći put:",
    /**
     * The three-way scope dialog. PRD 04: editing or deleting one occurrence of
     * a series never picks a scope silently, so this is a real choice with no
     * default — Otkaži is the only way out that changes nothing.
     */
    scope: {
      title: "Ponavljajući događaj",
      questionEdit: "Na koje termine se izmena odnosi?",
      questionDelete: "Koje termine treba obrisati?",
      this: "Samo ovaj",
      future: "Ovaj i budući",
      all: "Svi",
      cancel: "Otkaži",
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
    viewLjudi: "Ljudi",
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
    sourceBirthdays: "Rođendani",
    /**
     * The "Podsetnici" chip row on the event form (CAL-006). Every chip's label
     * is built from these by one formatter, so the fixed ladder and an offset
     * loaded from a stored event read the same way: "U vreme početka",
     * "10 min ranije", "1 h ranije", "1 dan ranije", "3 dana ranije".
     */
    reminders: {
      label: "Podsetnici",
      atStart: "U vreme početka",
      minutesUnit: "min",
      hoursUnit: "h",
      /** Trailing word of every non-zero lead time; the day form takes `dayUnit`. */
      before: "ranije",
    },
    /** Tag chip on a read-only task row in the agenda (ADR-020). */
    taskTag: "Zadatak",
    /** Grid navigation (ADR-020): prev/today/next — one pair of labels shared by Mesec/Nedelja/Dan, since each shifts by its own period. */
    prevPeriod: "Prethodni period",
    nextPeriod: "Sledeći period",
    today: "Danas",
    showMore: "još",
    showLess: "Prikaži manje",
    /**
     * The Ljudi panel (CAL-007). Month names are NOT listed here: they are
     * derived from `Intl.DateTimeFormat("sr-Latn", { month: "long" })`, the
     * same source every other date label on this page already reads, so the
     * select and the rows cannot drift from the calendar's own wording.
     */
    people: {
      /** Kind labels, keyed by person-kind value (labels are presentation). */
      kind: {
        birthday: "Rođendan",
        anniversary: "Godišnjica",
      },
      nameLabel: "Ime",
      namePlaceholder: "Ime osobe",
      kindLabel: "Vrsta",
      dayLabel: "Dan",
      monthLabel: "Mesec",
      yearLabel: "Godina (opciono)",
      notePlaceholder: "Beleška (opciono)",
      noteLabel: "Beleška",
      add: "Dodaj",
      save: "Sačuvaj",
      cancel: "Otkaži",
      editLabel: "Izmeni osobu",
      deleteLabel: "Obriši osobu",
      emptyTitle: "Nema ljudi",
      emptyDescription: "Dodaj prvu osobu u formi iznad — ime, vrsta i datum su dovoljni.",
      loadError: "Ljudi se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
      /** Client-side guard mirroring PeopleStore's own (month, day) pair check. */
      invalidDate: "Taj datum ne postoji ni u jednom mesecu.",
      saveError: "Osoba nije sačuvana. Pokušaj ponovo.",
      deletedNotice: "Osoba obrisana",
      undo: "Vrati",
      dismiss: "Zatvori",
      /**
       * Age / anniversary count on a row: "1996 · 30 god." The abbreviated
       * "god." is deliberate — it is correct at every number, while the spelled
       * forms need three (1 godina / 2–4 godine / 5+ godina) and `dayUnit`
       * knows two.
       */
      yearsUnit: "god.",
    },
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
      event: "Događaj",
      task: "Zadatak",
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
        event: "Događaji",
        task: "Zadaci",
      },
      saveError: "Čuvanje podešavanja nije uspelo. Pokušaj ponovo.",
    },
  },

  settings: {
    // The page title reuses `strings.modules.settings` — no duplicate copy.
    /**
     * SET-014: the filter above the section cards. The "nothing matched" line
     * is deliberately NOT repeated here — it reuses the search palette's own
     * `strings.search.emptyResults`, which says exactly this and nothing else.
     */
    searchPlaceholder: "Pretraži podešavanja…",
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
      /** Names the theme segmented row now that a second one (the week start) stands beside it. */
      themeLabel: "Tema",
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
      /** PRD 04 §5: the weekday the calendar's month grid and week view open on. */
      weekStartLabel: "Prvi dan nedelje",
      weekStartOptions: {
        monday: "Ponedeljak",
        sunday: "Nedelja",
      } satisfies Record<WeekStartPreference, string>,
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
    /**
     * Rezervna kopija (IMEX slice a1, extended to NOTE and then to archive
     * encryption by ADR-022) — the full-export button plus its confirmation
     * and error lines. `encryptedNotice` and `plaintextNotice` are
     * ALTERNATIVES, one per branch of the encrypt checkbox: never both at
     * once, and the plaintext one is only ever reached through its own
     * separate confirmation.
     */
    backup: {
      description:
        "Izvezi sve svoje podatke u jednu arhivu — otvoreni formati (JSON i CSV), beleške kao Markdown fajlovi i prilozi u originalnom obliku, sve čitljivo i upotrebljivo bez Nexusa.",
      encryptLabel: "Zaštiti arhivu lozinkom",
      encryptedNotice:
        "Arhiva se šifruje tvojom lozinkom — Argon2id i AES-256-GCM. Lozinku ne čuvamo nigde.",
      passphraseLabel: "Lozinka",
      passphraseConfirmLabel: "Potvrdi lozinku",
      passphraseHint:
        "Najmanje 12 karaktera. Ako je izgubiš, arhiva se više ne može otvoriti — ni mi je ne možemo otvoriti umesto tebe.",
      passphraseTooShort: "Lozinka mora imati najmanje 12 karaktera.",
      passphraseTooLong: "Lozinka može imati najviše 256 karaktera.",
      passphraseMismatch: "Lozinke se ne poklapaju.",
      plaintextNotice:
        "Baza podataka je šifrovana tvojim pristupnim kodom, ali ova arhiva nije — čuvaj je na sigurnom mestu.",
      plaintextConfirmLabel:
        "Razumem da arhiva neće biti šifrovana i da je može otvoriti svako ko dođe do fajla.",
      exportButton: "Izvezi sve podatke…",
      savedPrefix: "Sačuvano:",
      savedEncryptedSuffix: "šifrovano",
      /** "N zapis"/"N zapisa" — Serbian numeral agreement via `dayUnit`. */
      recordsUnitOne: "zapis",
      recordsUnitMany: "zapisa",
      /**
       * Shown only when `missingAttachments > 0` (ADR-022): "Nedostaje N
       * prilog(a) — arhiva je ipak sačuvana." Numeral agreement via `dayUnit`,
       * mirroring `recordsUnitOne`/`recordsUnitMany`. The closing clause
       * deliberately carries no pronoun: "bez njih" would be wrong at a count
       * of one, and this line has to read correctly at every count.
       */
      missingAttachmentsPrefix: "Nedostaje",
      missingAttachmentsUnitOne: "prilog",
      missingAttachmentsUnitMany: "priloga",
      missingAttachmentsSuffix: "— arhiva je ipak sačuvana.",
      error: "Izvoz nije uspeo. Pokušaj ponovo.",
    },
    /**
     * Vraćanje iz arhive (IMEX slice 3d, ADR-023) — the restore flow that sits
     * below the export in the same "Rezervna kopija" card, plus the post-reload
     * undo banner the app shell renders (`App.tsx`).
     *
     * `description` says the two things the user must know before picking a
     * file, in plain words: a restore REPLACES this profile's contents, and the
     * one-step undo lasts only until the app is locked or closed.
     *
     * `unreadable` and `problems` are typed against the wire's own closed code
     * domains, so a code added in `shared/ipc.ts` is a compile error here rather
     * than a silently missing sentence at the moment a user needs it.
     */
    restore: {
      title: "Vraćanje iz arhive",
      description:
        "Vrati podatke iz arhive napravljene izvozom iznad. Sve što je sada u ovom profilu biće obrisano i zamenjeno sadržajem arhive — vraćanje možeš opozvati jednim klikom, ali samo dok ne zaključaš ili ne zatvoriš aplikaciju.",
      pickButton: "Izaberi arhivu…",
      pickedPrefix: "Izabrano:",
      passphraseLabel: "Lozinka arhive",
      previewButton: "Prikaži pregled",
      previewRunning: "Čitanje arhive…",
      /** Preview header: the archive's own manifest facts, beside its file name. */
      createdLabel: "Napravljena",
      versionLabel: "Verzija",
      sourceLabel: "Profil u arhivi",
      /**
       * The replace warning, composed around the target profile's name in JSX
       * (the `savedPrefix` idiom) rather than through a placeholder — there is
       * no interpolation layer here, and inventing one for a single sentence
       * would outlive its usefulness.
       */
      replaceWarningPrefix: "Sve što je sada u profilu",
      replaceWarningSuffix: "biće obrisano i zamenjeno sadržajem arhive.",
      /**
       * Row labels of the current-vs-incoming table, keyed by
       * `RestoreModuleCounts`'s own five keys — deliberately NOT
       * `strings.modules`, whose key set is the module registry's, not this one.
       */
      modules: {
        tasks: "Zadaci",
        calendar: "Kalendar",
        study: "Učenje",
        notifications: "Obaveštenja",
        notes: "Beleške",
      } satisfies Record<keyof RestoreModuleCounts, string>,
      columnCurrent: "Sada",
      columnIncoming: "Iz arhive",
      /**
       * Shown only when `corruptBlobs > 0`: "Arhiva sadrži N prilog(a) sa
       * oštećenim sadržajem — …". Numeral agreement via `dayUnit`, and the
       * qualifier deliberately sits OUTSIDE the counted phrase — "N oštećen
       * prilog" and "N oštećenih priloga" would need three forms, while a
       * bare "prilog"/"priloga" reads correctly at every count.
       */
      corruptBlobsPrefix: "Arhiva sadrži",
      corruptBlobsUnitOne: "prilog",
      corruptBlobsUnitMany: "priloga",
      corruptBlobsSuffix: "sa oštećenim sadržajem — te datoteke neće biti vraćene.",
      applyButton: "Vrati podatke",
      cancelButton: "Otkaži",
      applying: "Vraćanje u toku…",
      applied: "Podaci su vraćeni. Aplikacija se osvežava…",
      /** A rejected pick/preview call (not one of the typed statuses below). */
      readError: "Čitanje arhive nije uspelo. Pokušaj ponovo.",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "Vraćanje nije uspelo. Pokušaj ponovo.",
      /** `{ status: "no-file" }`: main no longer holds the pick this screen was showing. */
      noFileError: "Arhiva više nije izabrana. Izaberi je ponovo.",
      /** The post-reload banner (App.tsx), shown for as long as the undo is live. */
      undoBanner: "Podaci su vraćeni iz rezervne kopije.",
      undoButton: "Opozovi",
      undoDismiss: "Sakrij obaveštenje",
      undoError: "Opoziv nije uspeo. Pokušaj ponovo.",
      /** One sentence per `ArchiveReadErrorCode`: the archive could not be opened at all. */
      unreadable: {
        "not-an-archive": "Ovaj fajl nije Nexus arhiva.",
        "passphrase-required": "Arhiva je zaštićena lozinkom — upiši lozinku arhive.",
        "passphrase-wrong": "Pogrešna lozinka za ovu arhivu.",
        damaged: "Arhiva je oštećena i ne može se pročitati.",
        "too-large": "Arhiva prelazi bezbednosna ograničenja i zato je odbijena.",
      } satisfies Record<ArchiveReadErrorCode, string>,
      /**
       * One sentence per `RestoreProblemCode`: the archive opened, but its
       * contents did not check out. Honest about what is wrong without naming
       * internals — the machine-readable part (file, line, field) is rendered
       * beside each sentence, muted, straight from the problem itself.
       */
      problems: {
        "missing-manifest": "Arhivi nedostaje manifest — bez njega se ne zna šta sadrži.",
        "invalid-manifest": "Manifest arhive nije ispravan.",
        "unsupported-schema-version":
          "Arhiva je napravljena u novijoj verziji Nexusa i ova verzija ne može da je pročita.",
        "missing-data-file": "Arhivi nedostaje fajl sa podacima koji njen manifest navodi.",
        "checksum-mismatch":
          "Sadržaj fajla se ne poklapa sa njegovim kontrolnim zbirom — arhiva je oštećena ili je menjana.",
        "invalid-json": "Fajl sa podacima nije ispravan JSON.",
        "unknown-record-type": "Arhiva sadrži vrstu zapisa koju ova verzija ne poznaje.",
        "invalid-record": "Zapis u arhivi nije ispravan.",
        "duplicate-id": "Isti zapis se u arhivi pojavljuje više puta.",
        "unknown-reference": "Zapis upućuje na nešto čega u arhivi nema.",
        "reference-cycle": "Zapisi u arhivi upućuju jedni na druge u krug.",
        "invalid-ydoc": "Sadržaj beleške u arhivi nije ispravan.",
        "missing-ydoc": "Belešci u arhivi nedostaje sadržaj.",
        "missing-blob": "Prilogu nedostaje datoteka u arhivi — zapis se vraća bez nje.",
      } satisfies Record<RestoreProblemCode, string>,
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
    /**
     * The operator grammar, named quietly in the footer beside the key hints —
     * `#oznaka` filters by tag (zadaci i beleške), `rok:`/`due:` by date. The
     * values are the closed set `parseSearchQuery` accepts, written out rather
     * than abbreviated so the line teaches the whole grammar at a glance.
     */
    operatorHint: "#oznaka · rok:danas / sutra / nedelja / 2026-08-15",
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

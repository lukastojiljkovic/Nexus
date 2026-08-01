/**
 * Every user-facing string in the desktop renderer, in Serbian (launch language,
 * founder decision #2). Centralized so the later i18n extraction is a mechanical
 * move of this table into the i18n layer — no framework yet, by design.
 */
import type { SmartListId } from "@nexus/core";
import type {
  ApkgImportSkipCode,
  ApkgReadErrorCode,
  ArchiveReadErrorCode,
  CsvImportColumnRole,
  CsvImportReadErrorCode,
  CsvImportRowDropCode,
  DashboardPickErrorCode,
  IcsImportReadErrorCode,
  IcsImportSkipCode,
  ImportDuplicateType,
  ImportSkipCode,
  LlmImportAnswerProblem,
  LlmImportKind,
  LlmImportSkipReason,
  LlmPromptLanguage,
  MarkdownImportSkipCode,
  ProfilePicturePickErrorCode,
  RestoreModuleCounts,
  RestoreProblemCode,
} from "../../shared/ipc.js";
import type { OnboardingOccupation } from "../../shared/onboardingPresets.js";
import type { ClockPreference } from "./calendarPrefs.js";
import type { BlockedInToday } from "./taskPrefs.js";
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

  /**
   * ADR-065 — the four-screen questionnaire: ime + tema, uloga, oblasti,
   * podsetnici. Every screen is skippable, and the copy never pretends
   * otherwise: each answer says what it changes and that Podešavanja can undo
   * it later, because that is the only honest way to ask four questions before
   * anybody has seen the app.
   */
  onboarding: {
    /** Screen 1 — the original ONB-lite content, unchanged. */
    title: "Tvoj Nexus",
    description:
      "Nexus radi potpuno lokalno — svi podaci ostaju na ovom uređaju. Upiši ime profila i izaberi temu; sve ostalo podešavaš kasnije.",
    /**
     * The business first entry (ADR-058 §5): the same naming screen, minus the
     * theme group — the theme is device-wide and was chosen long before a
     * second profile existed — so the copy asks for exactly what the screen
     * still asks for: a name.
     */
    titleBusiness: "Poslovni profil",
    descriptionBusiness:
      "Poslovni profil drži posao odvojeno od ličnog — ima svoje zadatke, beleške i podešavanja, pod istim nalogom. Upiši mu ime; sve ostalo podešavaš kasnije.",
    nameLabel: "Ime profila",
    namePlaceholder: "Upiši ime",
    themeLabel: "Tema",
    /** Screen 2 — uloga. Its only effect is which boxes the next screen opens ticked, and the description says exactly that. */
    occupationTitle: "Šta te najbolje opisuje?",
    occupationDescription:
      "Na osnovu ovoga Nexus predlaže oblasti u sledećem koraku. To je predlog, ne pravilo — sve možeš da promeniš.",
    occupationOptions: {
      student: "Student",
      zaposleni: "Zaposleni",
      preduzetnik: "Preduzetnik",
      drugo: "Nešto drugo",
    } satisfies Record<OnboardingOccupation, string>,
    /** Screen 3 — oblasti. The module names and one-line descriptions are the gallery's own (`settings.moduleDescriptions`), never respelled. */
    modulesTitle: "Šta ti treba?",
    modulesDescription:
      "Izaberi oblasti koje želiš u Nexusu. Uključuješ ih i isključuješ kad god poželiš, u Podešavanjima → Moduli.",
    /** Screen 4 — podsetnici; the three choices reuse `settings.notificationPresets`, so a word means the same set everywhere. */
    remindersTitle: "Podsetnici",
    remindersDescription: "Koliko obaveštenja želiš od Nexusa?",
    /** Said out loud rather than left as a surprise: no pick here is a valid answer, and the one-time question (NTF-008) simply stays where it was. */
    remindersNoChoice: "Ako ne izabereš, Nexus će pitati kada prvi podsetnik bude spreman.",
    /** Screen chrome. „Korak 2 od 4“ is composed in JSX around the number, the `settings.backup.savedPrefix` idiom. */
    stepPrefix: "Korak",
    stepOf: "od",
    next: "Dalje",
    back: "Nazad",
    start: "Počni",
    /** First run only: stop asking and take what the flow already holds. */
    skip: "Preskoči",
    /** Rerun only: leave without writing anything — see `Onboarding.tsx` for why a rerun cannot „skip to Osnovno“. */
    cancel: "Otkaži",
    /** The same flow reopened from Podešavanja (SET). Screen 1 shows the current name, screen 3 the live modules. */
    rerunTitle: "Ponovo podesi Nexus",
    rerunDescription:
      "Ista pitanja kao pri prvom pokretanju. Kreće od onoga što sada imaš i menja samo ono što promeniš.",
    /**
     * The one genuine starter row (ADR-065 §4): a real, useful, deletable note
     * written through the ordinary note path. Markdown, because that is what
     * `parseMarkdownNote` reads and what the note editor renders back. Every
     * sentence is checkable in the app — no invented numbers, no promises the
     * build does not keep, and no printed keyboard chord (they are remappable,
     * ADR-040, so the note points at the screen that shows the live ones).
     */
    welcomeNote: {
      title: "Dobro došli u Nexus",
      body: `# Dobro došli u Nexus

Ovo je tvoja prva beleška — promeni je ili obriši, tvoja je.

- Svi podaci ostaju na ovom uređaju. Nexus ne šalje ništa na internet.
- Oblasti uključuješ i isključuješ u Podešavanjima → Moduli.
- Prečice na tastaturi vidiš i menjaš u Podešavanjima → Prečice.

Kada ti zatreba nešto novo — zadatak, događaj ili beleška — počni odavde.
`,
    },
    saveError: "Čuvanje nije uspelo. Pokušaj ponovo.",
  },

  /** Local account lock screen (ADR-018 / AUTH-002..005, extended by ADR-044 / AUTH-006): picker → create → Kit za oporavak → unlock → recovery, plus the shared error map and the sidebar lock/switch actions. */
  auth: {
    validation: {
      tooWeak: "Pristupni kod mora imati bar 8 karaktera, uz najmanje jedno slovo i jednu cifru.",
      mismatch: "Kodovi se ne poklapaju.",
      labelRequired: "Upiši ime naloga.",
    },
    create: {
      title: "Zaštiti svoj Nexus",
      intro: "Postavi pristupni kod koji će štititi sve tvoje podatke na ovom računaru.",
      additionalTitle: "Novi nalog",
      additionalIntro:
        "Novi nalog ima svoj pristupni kod i svoje podatke — ništa se ne deli sa nalozima koji već postoje.",
      labelLabel: "Ime naloga",
      labelPlaceholder: "npr. Lični",
      // The registry that holds this name is plaintext by design (ADR-044): it
      // is what the lock screen lists before anything is unlocked. Said plainly
      // where the name is typed, never buried in a settings page.
      labelNote: "Ovo ime je vidljivo na zaključanom ekranu.",
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
      otherAccount: "Drugi nalog",
    },
    /** The account picker (ADR-044 / AUTH-006) — shown ahead of the lock screen whenever this device holds more than one account. */
    picker: {
      title: "Izaberi nalog",
      description: "Na ovom računaru postoji više naloga. Svaki ima svoj pristupni kod i svoje podatke.",
      stateLocked: "Zaključan",
      stateRecovery: "Traži Kit za oporavak",
      stateKeystoreUnavailable: "Sistemski trezor nije dostupan",
      rename: "Preimenuj",
      renameFieldLabel: "Novo ime naloga",
      renameSave: "Sačuvaj",
      renameCancel: "Otkaži",
      renameError: "Preimenovanje nije uspelo. Pokušaj ponovo.",
      /**
       * Deleting an account (ADR-048 / AUTH-022). Immediate, with no undo and
       * no grace period, so every sentence here is written to be understood
       * BEFORE the field is reached: what goes, that it cannot be taken back,
       * and where an export would have to happen (advisory — never a
       * precondition). The warning is composed around the account's own name in
       * JSX, the `restore.replaceWarningPrefix` idiom.
       */
      delete: "Obriši",
      deleteTitle: "Brisanje naloga",
      deleteWarning: "Svi podaci naloga biće trajno obrisani. Ovo se ne može opozvati.",
      deleteExportNote:
        "Ako želiš izvoz podataka, otključaj nalog i uradi ga u Podešavanjima pre brisanja.",
      /** The typed confirmation IS the gate — there is no passcode here (an account from another device could not answer one). */
      deleteConfirmLabel: "Ime naloga za potvrdu",
      deleteConfirmPlaceholder: "Upiši tačno ime naloga",
      deleteSubmit: "Obriši nalog",
      deleteCancel: "Otkaži",
      deleteError: "Brisanje nije uspelo. Pokušaj ponovo.",
      add: "Dodaj nalog",
      back: "Nazad na izbor naloga",
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
    /** Sidebar, only when this device holds more than one account: locks the open one, which brings the picker back (ADR-044). */
    switchAction: "Promeni nalog",
  },

  /**
   * More than one profile per account (ADR-058): the sidebar switcher and the
   * passcode gate every switch passes (AUTH-024). „Profil“ and „nalog“ are
   * DIFFERENT axes — a nalog is a lock-screen identity with its own passcode
   * and database, a profil is a compartment inside the open one — and the copy
   * keeps the two words strictly apart: this block never says „nalog“ except
   * to name whose pristupni kod the gate asks for.
   */
  profiles: {
    /**
     * „Posao“ is three things at once, deliberately one spelling: the kind
     * marker beside a business profile's name, the display fallback for a
     * business profile still carrying the empty-name ONB-lite sentinel, and
     * therefore the text a delete of such a profile is confirmed by typing.
     */
    businessLabel: "Posao",
    /** The switcher row reads „Profil: <ime>“ — a statement of where you are that opens the list. */
    rowPrefix: "Profil:",
    switcherLabel: "Promena profila",
    createBusiness: "Novi poslovni profil",
    createError: "Pravljenje profila nije uspelo. Pokušaj ponovo.",
    /**
     * The passcode gate in front of EVERY switch (AUTH-024). The error map is
     * the lock screen's own (`authErrorMessage`), never respelled here — a
     * wrong passcode is the same sentence wherever it is typed.
     */
    switchTitle: "Prelazak na profil",
    switchQuestion: "Unesi pristupni kod naloga da pređeš na ovaj profil.",
    switchPasscodeLabel: "Pristupni kod",
    switchConfirm: "Potvrdi",
    switchCancel: "Otkaži",
  },

  /** Display names for registered modules, keyed by module id. */
  modules: {
    dashboard: "Kontrolna tabla",
    tasks: "Zadaci",
    calendar: "Kalendar",
    settings: "Podešavanja",
    notes: "Beleške",
    study: "Učenje",
    priv: "Privatno",
    finance: "Finansije",
  } as Record<string, string>,

  dashboard: {
    /** Time-of-day salutations: jutro < 12h, dan 12–18h, veče ≥ 18h. */
    greeting: {
      jutro: "Dobro jutro",
      dan: "Dobar dan",
      vece: "Dobro veče",
    },
    /**
     * The compact day strip (DASH-009) — the one muted line under the date
     * carrying the day's live essentials. A header element, not a widget: it
     * has no title and no empty state, because a strip with nothing to say is
     * simply not drawn.
     */
    strip: {
      /**
       * Stands in for the hour on an event that has none left to name — an
       * all-day event, or a multi-day one that began before today: „danas ·
       * Godišnjica". Lower-case, like the widget's own `taskTag`/`personTag`
       * leads, because it is a label and not the start of a sentence.
       */
      dayLong: "danas",
      /**
       * A focus timer is running right now. „Fokus u toku" alone under the
       * first minute; „Fokus u toku: 25 min" once there is a duration worth
       * naming (`formatDurationMinutes` appends it).
       */
      focusRunning: "Fokus u toku",
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
    /**
     * Hitno i kasni widget — TASK's „Kasni“ and „Hitno“ smart lists (ADR-049)
     * read as one card. The empty line has to answer for both halves at once,
     * which is why it names them both rather than saying „nema zadataka“.
     */
    urgent: {
      title: "Hitno i kasni",
      empty: "Ništa ne kasni i ništa nije hitno",
    },
    /** Nedavne beleške widget — the notes touched most recently (NOTE's first card). */
    recentNotes: {
      title: "Nedavne beleške",
      empty: "Još nema beležaka",
    },
    /**
     * A single widget's own boundary (ADR-045 section 4): each card loads and
     * fails alone, so this copy is per-card and deliberately says nothing about
     * the page — the four cards beside it are fine.
     */
    widget: {
      error: "Podaci se ne mogu učitati.",
      retry: "Pokušaj ponovo",
    },
    /** The layout itself could not be read — the one failure that is the page's own. */
    layoutError: "Raspored kartica se ne može učitati.",
    /** Edit mode (ADR-045 section 5) — the header actions and each card's „⋯“ menu. */
    edit: {
      enter: "Uredi",
      done: "Gotovo",
      add: "Dodaj vidžet",
      /** Names one card's „⋯“; the widget's own title is appended, since five of them share the page. */
      menuLabel: "Radnje nad karticom",
      moveUp: "Pomeri gore",
      moveDown: "Pomeri dole",
      sizeLabel: "Veličina",
      /** The three presets, named for how wide they draw — never by their stored letter. */
      size: {
        S: "Mala",
        M: "Srednja",
        L: "Velika",
      },
      remove: "Ukloni",
      /** Tooltip on the title strip, which is also the drag grip. */
      dragHint: "Prevuci da promeniš redosled",
      failed: "Promena rasporeda nije uspela. Pokušaj ponovo.",
      /**
       * Removing the last card leaves no rows, and no rows IS the default
       * arrangement — so the five come back. Said the moment it happens,
       * because nothing else on screen would explain them.
       */
      defaultRestored: "Uklonjena je poslednja kartica — vraćen je podrazumevani raspored.",
    },
    /** „Dodaj vidžet“ — the catalogue of what the enabled modules publish. */
    gallery: {
      title: "Dodaj vidžet",
      empty: "Nijedan uključen modul nema kartice.",
      add: "Dodaj",
      /** Beside a widget already on the layout; v1 places each of them once. */
      added: "već dodat",
      close: "Zatvori",
    },
    /**
     * Named dashboards (DASH-008 / ADR-055): the typographic switcher beside
     * the greeting, its popover, and the edit-mode manage actions. The default
     * board is named here in COPY ONLY — it is not a row, which is exactly why
     * it can be neither renamed nor deleted.
     */
    sets: {
      /** The default board's display name. */
      defaultName: "Početna",
      /** Accessible label on the switcher trigger; its visible content is the active board's name. */
      switcherLabel: "Izbor table",
      /** Accessible label on the „⋯“ manage menu beside the switcher (edit mode only). */
      manageLabel: "Radnje nad tablama",
      /** In the switcher list (edit mode only) AND in the manage menu: opens the name line. */
      create: "Nova tabla…",
      rename: "Preimenuj tablu",
      remove: "Obriši tablu",
      /** The inline name line the switcher row becomes — the tasks-rail idiom. */
      namePlaceholder: "Naziv table",
      createLabel: "Nova tabla",
      renameLabel: "Preimenuj tablu",
      save: "Sačuvaj",
      cancel: "Otkaži",
      /**
       * The house confirm (the recurrence-dialog recipe) for deleting a board:
       * what goes is the ARRANGEMENT — the content the cards read lives in its
       * modules and is untouched, and saying so is what makes the question
       * answerable.
       */
      deleteDialog: {
        title: "Obriši tablu",
        question:
          "Briše se samo raspored kartica na ovoj tabli. Sadržaj — zadaci, događaji, beleške — ostaje netaknut.",
        confirm: "Obriši",
        cancel: "Otkaži",
      },
      /** A set write that did not land — the layout's own `edit.failed`, for the boards. */
      failed: "Promena tabli nije uspela. Pokušaj ponovo.",
    },
    /**
     * Per-widget configuration (DASH-004 / ADR-059): the edit-mode „Podesi…"
     * entry and the form the card's ⋯ menu becomes. Field labels resolve BY
     * THE KEY a contract declares (`fields.<key>`), and a choice option by the
     * `labelKey` path it carries — both through `lookupString`, exactly as
     * widget titles do, so an option may just as well point at another
     * module's copy (the period windows reuse `tasks.smart.names`).
     */
    config: {
      open: "Podesi…",
      /** The form's way back to the card's actions, same menu, same open. */
      back: "Nazad",
      /** One label per declared key, shared across widgets on purpose. */
      fields: {
        count: "Broj redova",
        period: "Period",
        horizon: "Vremenski okvir",
        lists: "Liste zadataka",
      },
      /** The leading count option on a widget that ships uncapped: no cap at all. */
      countAll: "Sve",
      /** The empty selection over task lists — every list counts. */
      allLists: "Sve liste",
      /** The lists could not be read for the form; the card itself is untouched. */
      listsError: "Liste se ne mogu učitati.",
      period: {
        svi: "Svi zadaci",
      },
      horizon: {
        prag: "Prema podsetniku dokumenta",
        svi: "Svi predstojeći",
        "30": "30 dana",
        "60": "60 dana",
        "90": "90 dana",
      },
    },
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
    viewCards: "Kartice",
    viewCalendar: "Kalendar",
    /**
     * The per-view controls above the rows (ADR-050): what the shown scope is
     * ordered by, what a board's columns come from, and what is filtered out.
     * Each is remembered per LIST and per VIEW, so a board grouped by sekcija
     * and a list sorted by rok can both be true of the same list at once.
     */
    controls: {
      /** Names the row of selects for a screen reader — „Prikaz“ alone is the toggle beside it. */
      regionLabel: "Podešavanja prikaza",
      sortLabel: "Redosled",
      /**
       * The first option, and the one a list opens on: no sort at all, so the
       * rows stay in the order the user dragged them into. It is a real choice,
       * not an absence — which is why it is worded rather than left blank.
       */
      sortManual: "Ručni redosled",
      /**
       * The sortable fields. Deliberately NOT status/prioritet: the views
       * engine collates a select field by its stored VALUE, which would order
       * prioritet as high–low–medium–none — a sort that looks like a feature
       * and behaves like an accident. Grouping a board by them is what answers
       * that question honestly.
       */
      sortField: {
        title: "Naslov",
        dueDate: "Rok",
        startDate: "Počinje",
        completedAt: "Završen",
        done: "Urađeno",
      },
      groupLabel: "Grupisanje",
      group: {
        status: "Status",
        priority: "Prioritet",
        section: "Sekcija",
      },
      statusLabel: "Status",
      statusAll: "Svi statusi",
      priorityLabel: "Prioritet",
      priorityAll: "Svi prioriteti",
      /**
       * The board's null column when it is grouped by sekcija: the list itself,
       * where a task with no heading lives. Always drawn, empty or not — it is a
       * real place to drop something back into, not a leftovers pile.
       */
      bodyColumn: "Telo liste",
      /** The card's own „⋯“ menu — the keyboard way to do what the drag does. */
      cardMenuLabel: "Premesti karticu",
      moveLeft: "Pomeri levo",
      moveRight: "Pomeri desno",
      /**
       * The board's column configuration (ADR-060). The „Kolone“ popover lists
       * every column of the current grouping — hidden ones included, so hiding
       * is always reversible — and the chip states how many the board is not
       * drawing, because a column that quietly vanished would read as lost
       * work. The rows' ↑/↓ move within the popover's top-to-bottom list, which
       * IS the board's left-to-right order.
       */
      columns: "Kolone",
      columnsLabel: "Kolone table",
      /** The column head's own „⋯“ menu; rendered with the column's title after it. */
      columnMenuLabel: "Radnje nad kolonom",
      hideColumn: "Sakrij kolonu",
      columnUp: "Pomeri gore",
      columnDown: "Pomeri dole",
      /** The quiet chip beside the controls; rendered with the count after it: „Skrivene kolone: 2“. */
      hiddenColumns: "Skrivene kolone:",
      /**
       * Shown in place of the rows when the view's own filter matches nothing.
       * Its own sentence rather than the oznake one: the two hide rows for
       * different reasons, and an answer that named the wrong filter would send
       * the user to clear a control that is not the one holding the rows back.
       */
      filterEmptyDescription: "Nijedan zadatak ne odgovara izabranom filteru.",
    },
    /** The month grid over the selected list (ADR-050) — one bar per task, between „Počinje“ and „Rok“. */
    calendar: {
      regionLabel: "Kalendar zadataka",
      prevMonth: "Prethodni mesec",
      nextMonth: "Sledeći mesec",
      today: "Danas",
      /** Heading of the strip under the grid: a task with no rok has no day to sit on, and dragging it onto one is what gives it a rok. */
      undatedLabel: "Bez roka",
      /** Trailing word of the muted „+3 još“ a day shows when its bars outrun the lanes. */
      moreSuffix: "još",
    },
    emptyTitle: "Nema zadataka",
    emptyDescription:
      "Zapiši prvi zadatak u polje iznad — dovoljno je ime i Enter.",
    loadError: "Zadaci se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
    editLabel: "Izmeni zadatak",
    deleteLabel: "Obriši zadatak",
    /** The per-row „⋯“ menu: tags to attach plus „Sačuvaj kao šablon“, so its name is the row, not one of them. */
    rowMenuLabel: "Radnje nad zadatkom",
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
    /**
     * The day a task becomes actionable (TASK-001), beside „Rok“ on the same
     * form row. „Počinje“ rather than „Početak“: the field answers *when* it
     * starts, and the smart lists read it as exactly that — a task that starts
     * after today is not yet something to do today.
     */
    startDateLabel: "Počinje",
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
     * Pregledi (ADR-049) — the five VIRTUAL lists the rail draws ABOVE „Liste“.
     * They are queries, not places: nothing is filed into one, which is why the
     * section has no „Nova …“ action and why its rows carry neither the hover
     * cluster nor a drop target.
     *
     * The names are flat-keyed by the wire id, the way `status` and `priority`
     * below are — one label per value, resolved by lookup rather than by a
     * switch that could go stale when a sixth view is added.
     */
    smart: {
      /** Heading of the rail's first section, above „Liste“. */
      heading: "Pregledi",
      /** Names the group of view rows for a screen reader — „Pregledi“ alone says little out of context, exactly as with `lists.railLabel`. */
      regionLabel: "Pregledi zadataka",
      names: {
        danas: "Danas",
        sledecih7: "Sledećih 7 dana",
        hitno: "Hitno",
        kasni: "Kasni",
        zavrseno: "Završeno",
      } satisfies Record<SmartListId, string>,
      /**
       * Each view's own empty state. Calm statements of fact, never the list's
       * „zapiši prvi zadatak“ invitation: there is no typing into a view, so an
       * invitation here would point at a field that is not on screen.
       */
      empty: {
        danas: "Nema zadataka za danas.",
        sledecih7: "Nema zadataka u narednih sedam dana.",
        hitno: "Nema zadataka visokog prioriteta.",
        kasni: "Ništa ne kasni.",
        zavrseno: "Još nijedan zadatak nije završen.",
      } satisfies Record<SmartListId, string>,
      /** Tooltip on the muted count beside „Danas“ and „Kasni“ — a bare number cannot say what it counts. */
      countTitle: "Broj zadataka u pregledu",
      /**
       * „Završeno“ is bounded (ADR-039 §4): the first 100, then „Prikaži još“.
       * Worded as „Prikazano prvih 100 od 340“ — the counts are stated after
       * the words, where Serbian owes no numeral agreement.
       */
      shownPrefix: "Prikazano prvih",
      shownOf: "od",
      showMore: "Prikaži još",
      /** The collapsed disclosure beneath „Završeno“ holding everything past the archive boundary — drawn as „Arhiva (N)“, the count by the page. */
      archiveTitle: "Arhiva",
      /**
       * „Završeno“'s empty state once every finished task has aged into the
       * archive: „Sve završeno starije od 30 dana je u arhivi.“ The day count
       * (TASK_ARCHIVE_AFTER_DAYS) is stated between the halves at the call
       * site, and „dana“ after „od“ holds for any count the constant could
       * become — genitive, so 21, 30 and 60 all read the same.
       */
      allArchivedPrefix: "Sve završeno starije od",
      allArchivedSuffix: "dana je u arhivi.",
      /** Tooltip on the row chip that names a task's list — inside a view the rows come from every list at once. */
      listChipTitle: "Lista kojoj zadatak pripada",
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
      /** The rail row's own „⋯“ menu, which holds the two ordering actions below. */
      listMenuLabel: "Radnje nad listom",
      /** The section heading's „⋯“ menu — the same two actions, one scope in. */
      sectionMenuLabel: "Radnje nad sekcijom",
      /**
       * Shared by both menus, because it is one gesture in two scopes: a list
       * steps among its siblings, a section within its list. Always both, the
       * one at the end of its scope simply disabled — a menu whose items come
       * and go is one the user has to re-read every time.
       */
      moveUp: "Pomeri gore",
      moveDown: "Pomeri dole",
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
      /** „Pregledaj" (DOC / ADR-064) — the NOTE panel's word, offered only on rows the app can render itself. */
      preview: "Pregledaj",
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
    /**
     * Šabloni (ADR-035 / TASK-010) — a saved task shape, captured from a row's
     * „⋯“ menu and applied from the toolbar. Worded like `notes.template*`
     * where the sentence is the same, since it is the same idea one module
     * over: `templateSaveAs` → `saveAs`, `templateNamePlaceholder` →
     * `namePlaceholder`, `templateError` → `actionError`. The block already
     * says „šablon“, so nothing inside it repeats the word.
     */
    templates: {
      /** The toolbar button, and the heading inside both popovers. */
      title: "Šabloni",
      /** Accessible name of the toolbar button's menu. */
      menuLabel: "Šabloni zadataka",
      /** Shown in place of the list when the profile has no templates yet. */
      empty: "Još nemaš šablone zadataka.",
      /** The action in a task row's „⋯“ menu. */
      saveAs: "Sačuvaj kao šablon",
      namePlaceholder: "Naziv šablona",
      /** Accessible name of the name field — the action in full, like `lists.renameSectionLabel`. */
      nameLabel: "Sačuvaj zadatak kao šablon",
      /** Said BEFORE the fact, not after: saving under an existing name is how a template is edited. */
      overwriteNote: "Postojeći naziv se zamenjuje.",
      /** Tooltip on a template's name in the list — the click applies it. */
      applyTitle: "Napravi zadatak od ovog šablona",
      delete: "Obriši šablon",
      actionError: "Radnja nad šablonom nije uspela. Pokušaj ponovo.",
    },
    /**
     * Zavisnosti (migration 029 / ADR-037) — "this one first". The block lives
     * in the EDIT form only: a task that does not exist yet has no id for the
     * other end of an edge to name.
     *
     * „Blokiran“ is a statement about the task, not an instruction: completing a
     * blocked task is never refused, the chip only says the order it was put in
     * is not finished yet — which is why its tooltip explains rather than warns.
     */
    dependencies: {
      label: "Zavisnosti",
      /** The picker's trigger, and its accessible name — a named action, not a row's „⋯“ overflow. */
      add: "Dodaj zavisnost",
      /** Placeholder and accessible name of the picker's filter field. */
      searchPlaceholder: "Pretraži zadatke",
      /** Shown in the picker when the profile has no task that could be a condition (all done, or all downstream of this one). */
      pickerEmpty: "Nema zadatka koji može biti uslov.",
      /** Shown in the picker when what was typed matches nothing among the candidates. */
      pickerNoMatches: "Nema rezultata.",
      /** Stands in for the list while the edited task waits on nothing. */
      none: "Ovaj zadatak ne čeka ni na jedan drugi.",
      removeLabel: "Ukloni zavisnost",
      /** Beside a blocker that is already finished — the edge is real, it just no longer holds anything up. */
      doneHint: "završeno",
      /** The row/card chip on a task at least one of whose blockers is still open. */
      blockedChip: "Blokiran",
      blockedChipTitle: "Čeka zadatak koji još nije završen",
      actionError: "Radnja nad zavisnošću nije uspela. Pokušaj ponovo.",
    },
    /**
     * Izbor (ADR-038) — the batch mode over the list view: pick rows, then move,
     * re-prioritise, re-date or delete them in one go.
     *
     * „Izabrano: 5“ rather than a counted noun on purpose: Serbian numerals take
     * three forms (1 / 2–4 / 5+) while `dayUnit` knows two, and a picked-task
     * count is freely variable — so the number is stated after a colon, where no
     * agreement is owed. „Obrisano zadataka: 5“ works the same way: the genitive
     * plural is the invariant form after a stated count.
     */
    bulk: {
      /** The toolbar toggle that enters and leaves the mode; active state is typographic, like the view toggle beside it. */
      mode: "Izbor",
      /** Names the action bar that appears once at least one row is picked. */
      regionLabel: "Radnje nad izabranim zadacima",
      /** The per-row pick control that replaces the drag grip while the mode is on. */
      pickLabel: "Izaberi zadatak",
      /** Followed by the number of rows picked. */
      selected: "Izabrano:",
      move: "Premesti…",
      /** Header inside the move menu — it lists the rail's lists, indented as the rail draws them. */
      moveLabel: "Premesti u listu",
      priority: "Prioritet…",
      priorityLabel: "Postavi prioritet",
      due: "Rok…",
      dueLabel: "Postavi rok",
      clearDue: "Ukloni rok",
      delete: "Obriši",
      /**
       * Shown in the action bar when the store refused the batch. It names the
       * one refusal a user can actually run into — clearing a rok that a
       * repetition or a reminder counts from — because nothing was changed and
       * the way out is to adjust the selection.
       */
      actionError:
        "Radnja nije uspela — ništa nije promenjeno. Rok se ne može ukloniti zadatku koji se ponavlja ili ima podsetnik.",
      /** Followed by the number of tasks the batch delete removed; the offer itself is the same one-slot undo a single delete uses. */
      deletedNotice: "Obrisano zadataka:",
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
    /**
     * „Dupliraj" (NOTE-010). The copy's own „ (kopija)" mark is written into
     * the document by the main process and therefore lives there
     * (`main/noteDuplicate.ts`) — main cannot import this file, the same split
     * `notificationStrings.ts` documents.
     */
    duplicate: "Dupliraj",
    duplicateError: "Dupliranje beleške nije uspelo. Pokušaj ponovo.",
    duplicateTooLarge: "Beleška je prevelika da bi se duplirala odjednom.",
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
    /** Folder preferences (ADR-036): the default template submenu + the quick-capture toggle. */
    folderTemplate: "Podrazumevani šablon",
    folderTemplateNone: "Bez šablona",
    folderCaptureDefault: "Fascikla za brzi unos",
    folderCaptureDefaultOn: "Nova beleška bez konteksta ide ovde.",
    moveToFolder: "Premesti u fasciklu",
    noteMenuLabel: "Više opcija",
    pin: "Zakači",
    unpin: "Otkači",
    /**
     * The per-folder view toggle (NOTE-002). The same two words the TASK
     * toggle uses for the same two shapes — one vocabulary across the app —
     * keyed by the stored value, so the toggle names a shape by looking it up
     * rather than by a parallel list that could fall out of step with the set.
     */
    viewLabel: "Prikaz",
    viewNames: {
      list: "Lista",
      cards: "Kartice",
    },
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
    /**
     * Kategorije (NOTE-002, migration 049) — the third organizational axis:
     * a folder says WHERE a note lives, an oznaka says WHAT IT IS ABOUT, a
     * kategorija says WHAT KIND it is (sastanak, ideja, dnevnik, recept).
     *
     * The wording is deliberately the FOLDER block's, not the tag block's,
     * wherever the sentence is the same („Preimenuj“, „Promeni boju“): a
     * category is managed by the same row, with the same swatch, so two
     * phrasings for one action would only be two things to learn. Only
     * „Bez kategorije“ is its own, because it is the answer to a question no
     * folder or tag asks.
     */
    categoriesLabel: "Kategorije",
    newCategory: "Nova kategorija",
    categoryNamePlaceholder: "Naziv kategorije",
    renameCategory: "Preimenuj",
    recolorCategory: "Promeni boju",
    deleteCategory: "Obriši kategoriju",
    categoryMenuLabel: "Radnje nad kategorijom",
    categoryFilterLabel: "Filter po kategorijama",
    clearCategoryFilter: "Poništi",
    categoryError: "Radnja nad kategorijom nije uspela. Pokušaj ponovo.",
    categoryFilterEmptyDescription: "Nijedna beleška ne pripada izabranim kategorijama.",
    /** The per-note picker in the row menu — „Bez kategorije“ is a real choice there, not an empty state. */
    noteCategoryLabel: "Kategorija",
    noCategory: "Bez kategorije",
    /** Wiki-links (slice b): the `[[` link menu + the backlinks panel. */
    backlinksTitle: "Povratne veze",
    wikiLinkMissing: "Nedostupna beleška",
    /** Attachments (NOTE-003b): the Prilozi panel + in-document image blocks. */
    attachmentsTitle: "Prilozi",
    attach: "Priloži datoteku",
    /** „Pregledaj" (DOC / ADR-064) — offered only on rows the app can render itself; the dialog's own copy lives in `attachmentPreview` below. */
    attachmentPreview: "Pregledaj",
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
      calloutInfo: "Okvir: napomena",
      calloutTip: "Okvir: savet",
      calloutWarning: "Okvir: upozorenje",
      calloutDanger: "Okvir: opasnost",
      toggle: "Sklopivi odeljak",
      tableOfContents: "Sadržaj",
      flashcard: "Kartica (pitanje :: odgovor)",
      /** Wraps the selection in a new `{{cN::…}}` deletion, numbered for the author (ADR-068). */
      clozeBlank: "Praznina (cloze)",
    },
    /**
     * Callout variants (NOTE-011). These name the block for a screen reader —
     * the block itself carries no visible label, so colour is not the only
     * thing distinguishing a warning from a note.
     */
    callout: {
      info: "Napomena",
      tip: "Savet",
      warning: "Upozorenje",
      danger: "Opasnost",
    },
    /** The collapsible section's chevron (NOTE-011) — its label states what the click will do. */
    toggleExpand: "Rasklopi odeljak",
    toggleCollapse: "Sklopi odeljak",
    /** The live table of contents (NOTE-011). */
    tocTitle: "Sadržaj",
    tocEmpty: "Ova beleška nema naslova.",
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
    /**
     * What becomes of the flashcards a note generated when the note is deleted
     * (PRD 09 §7). The two choices lose different things — one keeps the review
     * history in the deck, the other takes those cards out of study — so there
     * is no default and no primary button; Otkaži is the way out that changes
     * nothing. A note that generated no cards is never asked.
     */
    cardsDialog: {
      title: "Brisanje beleške",
      /**
       * The counted phrase, e.g. „3 kartice nastale iz ove beleške“. Noun and
       * participle inflect together in Serbian (1 / 2–4 / 5+), so the whole
       * phrase goes through `countUnit` rather than the noun alone.
       */
      countOne: "kartica nastala iz ove beleške",
      countFew: "kartice nastale iz ove beleške",
      countMany: "kartica nastalih iz ove beleške",
      question: "Šta sa njima?",
      /** Says what „keep“ means, since the cards outlive the note that wrote them. */
      keepNote: "Zadržane kartice ostaju u svom špilu, sa istorijom učenja.",
      keep: "Zadrži kartice",
      deleteCards: "Obriši i kartice",
      cancel: "Otkaži",
    },
    /** The undo bar after „Obriši i kartice“ — it took more than the note, and says so. */
    deletedWithCardsNotice: "Beleška i kartice obrisane",
    /**
     * „Pretvori u zadatke“ (NOTE §6). The editor's checkboxes are a mark on the
     * page and nothing more; this is the one action that promotes them into real
     * TASK rows. Offered only when the note actually has rows to convert (the
     * `cards-count` probe's own rule), so `empty` is what a note WITHOUT them
     * hears instead of a dialog that could only report doing nothing.
     */
    checklistTasks: {
      /** The row „⋯“ entry. A verb: it says what pressing it does, not what the note contains. */
      action: "Pretvori u zadatke",
      title: "Pretvori u zadatke",
      /** The counted phrase, e.g. „3 stavke iz liste u ovoj belešci“ — noun and preposition inflect together, hence `countUnit`. */
      countOne: "stavka iz liste u ovoj belešci",
      countFew: "stavke iz liste u ovoj belešci",
      countMany: "stavki iz liste u ovoj belešci",
      question: "Izaberi listu zadataka u koju idu.",
      /** The non-destructive rule, said before the action rather than discovered after it. */
      keepNote: "Beleška ostaje nepromenjena — lista se prepisuje, ne seli.",
      listLabel: "Lista zadataka",
      convert: "Pretvori",
      cancel: "Otkaži",
      /** „Napravljeno 3 zadatka“ — the `markdownImport` result recipe: an invariant participle + `countUnit`. */
      createdPrefix: "Napravljeno",
      createdUnitOne: "zadatak",
      createdUnitFew: "zadatka",
      createdUnitMany: "zadataka",
      /** Appended only when a ticked box carried across: „, od toga 2 već završena“. */
      completedPrefix: "od toga",
      completedUnitOne: "već završen",
      completedUnitFew: "već završena",
      completedUnitMany: "već završenih",
      /** Appended only when a row had no text to be a title: „Preskočeno 2 prazna reda.“ */
      skippedPrefix: "Preskočeno",
      skippedUnitOne: "prazan red",
      skippedUnitFew: "prazna reda",
      skippedUnitMany: "praznih redova",
      /** What a note with no checklist hears — a statement, not a failure. */
      empty: "Ova beleška nema listu sa kvačicama.",
      error: "Zadaci nisu napravljeni. Pokušaj ponovo.",
      /** The picker has nothing to offer only if the profile has no lists at all, which the Inbox makes impossible — said anyway rather than showing an empty select. */
      noLists: "Napravi listu u modulu Zadaci da bi stavke imale gde da odu.",
    },
    /**
     * „Pronađi u belešci“ (NOTE-005): the Ctrl+F bar docked above the open
     * note. Its own copy, deliberately not borrowed from the global search
     * palette — that one searches everything the profile holds, this one
     * searches the note on screen, and telling the two apart is the whole
     * point of naming the note in the placeholder.
     */
    find: {
      /** Names the bar for a screen reader, and doubles as the query field's placeholder. */
      regionLabel: "Pronađi u belešci",
      placeholder: "Pronađi u belešci",
      /** The counter slot's own name — it announces „3/17“, which says nothing on its own. */
      countLabel: "Rezultati u belešci",
      /** Stands in the counter slot when the query matches nothing. Quiet: a full stop, no exclamation, no icon. */
      noResults: "Nema rezultata.",
      previous: "Prethodno",
      next: "Sledeće",
      /** The case toggle reads „Aa“; what it does is in its title, since two letters cannot say it. */
      caseLabel: "Aa",
      caseTitle: "Razlikuj velika i mala slova",
      /**
       * Reveals the replace row. A NOUN („Zamena“) rather than the verb, so it
       * can never be mistaken for the „Zameni“ button it uncovers.
       */
      replaceToggle: "Zamena",
      replacePlaceholder: "Zameni sa",
      replace: "Zameni",
      replaceAll: "Zameni sve",
      close: "Zatvori",
    },
    /** „Premesti u Privatno“ (ADR-057 §5) — the row-menu action and its typed-confirm dialog. Offered only while the private section is unlocked. */
    moveToPriv: {
      action: "Premesti u Privatno",
      title: "Premeštanje u Privatno",
      warning:
        "Beleška se šifruje i nestaje iz Beleški, pretrage, izvoza i rezervnih kopija — istorija verzija i veze sa drugim beleškama se brišu.",
      /** The two things that deliberately SURVIVE the move, said before the field. */
      keepNote:
        "Kartice za učenje nastale iz beleške ostaju u svom špilu, bez veze sa njom; zadaci napravljeni iz njene liste ostaju u Zadacima.",
      confirmLabel: "Naslov beleške za potvrdu",
      confirmPlaceholder: "Upiši tačan naslov",
      submit: "Premesti",
      cancel: "Otkaži",
      tooLarge: "Beleška je prevelika za privatnu sekciju.",
      tooManyAttachments: "Beleška ima previše priloga — privatna beleška ih nosi najviše 50.",
      error: "Premeštanje nije uspelo. Ništa nije promenjeno — pokušaj ponovo.",
    },
  },

  /**
   * Private notes (PRIV v1 / ADR-057): the sealed section. Every sentence here
   * is HONEST about guarantees — what locking protects, what deletion means,
   * what opting out of the Recovery Kit costs — never marketing. Masculine
   * second person, the house register.
   */
  priv: {
    /** First open, nothing set up yet: the two-sentence honest explanation, the credential choice, the kit step. */
    setup: {
      title: "Privatne beleške",
      // ADR-057 §6 changed the export half of this promise: private notes CAN
      // ride in a manual, password-protected export while the section is
      // unlocked — automatic backups still never carry them.
      intro:
        "Privatne beleške se šifruju posebnim ključem i čitljive su samo dok je ova sekcija otključana — ne pojavljuju se u pretrazi, na kontrolnoj tabli ni u automatskim rezervnim kopijama. U ručni izvoz ulaze samo dok je sekcija otključana i samo uz lozinku arhive.",
      introSecond:
        "Ako izgubiš i lozinku i kod za oporavak, sadržaj je nepovratno izgubljen — ne postoji pomoćni ulaz, ni za tebe ni za aplikaciju.",
      credentialLabel: "Čime se sekcija otključava",
      useAccountPasscode: "Pristupnim kodom naloga",
      useAccountPasscodeNote: "Isti kod koji otključava aplikaciju otključava i ovu sekciju.",
      useSeparate: "Posebnom lozinkom",
      useSeparateNote: "Lozinka koju znaš samo ti — ko zna kod naloga, ne zna i nju.",
      accountPasscodeLabel: "Pristupni kod naloga",
      accountPasscodePlaceholder: "Upiši pristupni kod",
      passphraseLabel: "Lozinka za privatne beleške",
      passphrasePlaceholder: "Najmanje 8 karaktera, slovo i cifra",
      confirmLabel: "Potvrdi lozinku",
      confirmPlaceholder: "Ponovi lozinku",
      kitLabel: "Kod za oporavak",
      kitRegenerate: "Obnovi kod za oporavak",
      kitRegenerateNote:
        "Pravi se novi kod za oporavak koji otvara i nalog i privatne beleške. Stari kod odmah prestaje da važi — prepiši preko njega novi.",
      kitOptOut: "Bez koda za oporavak",
      kitOptOutNote:
        "Zaboravljena lozinka tada znači trajno izgubljene privatne beleške. Nema trećeg puta.",
      /** The informed opt-out's own gate — the dead end, restated as the thing being agreed to. */
      kitOptOutConfirm: "Razumem: bez lozinke i bez koda, privatne beleške su nepovratne.",
      submit: "Uključi privatne beleške",
      mismatch: "Lozinke se ne poklapaju.",
      weak: "Lozinka mora imati bar 8 karaktera, uz najmanje jedno slovo i jednu cifru.",
      alreadySetUp: "Sekcija je već podešena — otključaj je svojom lozinkom.",
    },
    /** Set up but locked: one field, the throttle countdown reuses the lock screen's own prefix. */
    lock: {
      title: "Privatne beleške su zaključane",
      description: "Unesi lozinku za privatne beleške. Dok su zaključane, sadržaj je šifrovan i nedostupan.",
      descriptionAccount: "Unesi pristupni kod naloga. Dok su zaključane, sadržaj je šifrovan i nedostupan.",
      fieldLabel: "Lozinka",
      fieldLabelAccount: "Pristupni kod",
      placeholder: "Upiši lozinku",
      placeholderAccount: "Upiši pristupni kod",
      submit: "Otključaj",
      wrongCredential: "Pogrešna lozinka.",
      wrongPasscode: "Pogrešan pristupni kod.",
      error: "Otključavanje nije uspelo. Pokušaj ponovo.",
    },
    /** The unlocked section: header, list, search, delete. */
    section: {
      lockNow: "Zaključaj",
      newNote: "Nova beleška",
      searchLabel: "Pretraga privatnih beležaka",
      searchPlaceholder: "Pretraži privatne beleške…",
      emptyTitle: "Nema privatnih beležaka",
      emptyDescription: "Napravi prvu dugmetom iznad — sve ovde ostaje šifrovano na disku.",
      searchEmpty: "Nijedna privatna beleška ne odgovara upitu.",
      /** A row whose sealed container no longer opens: named, dead, honest. */
      unreadable: "Nečitljiva beleška",
      loadError: "Privatne beleške se trenutno ne mogu učitati. Pokušaj ponovo.",
      noSelectionTitle: "Nijedna beleška nije izabrana",
      noSelectionDescription: "Izaberi belešku sa leve strane ili napravi novu.",
      deleteLabel: "Obriši",
      moveOut: "Premesti u Beleške",
      noteMenuLabel: "Više opcija",
    },
    /** The private editor's own surfaces — save channel, attachments, the honest v1 limits. */
    editor: {
      loadError: "Beleška se ne može otvoriti. Pokušaj ponovo.",
      saveError: "Čuvanje nije uspelo — pokušaćemo ponovo pri sledećoj izmeni.",
      saveTooLarge: "Beleška je prevelika da bi se sačuvala. Skrati je ili podeli na više beležaka.",
      attachmentsTitle: "Prilozi",
      attach: "Priloži datoteku",
      attachmentTooLarge: "Datoteka je veća od 100 MB i ne može se priložiti.",
      attachmentError: "Prilaganje nije uspelo. Pokušaj ponovo.",
      /** The recorded v1 limit, said where the files live: no external opening, no plaintext temp copies. */
      attachmentsNote:
        "Prilozi su šifrovani i otvaraju se samo ovde, dok je sekcija otključana — bez otvaranja u spoljnim programima.",
      /**
       * The sealed version history (ADR-057) — the private twin of „Istorija
       * verzija". Verzije su šifrovane kao i sama beleška, pa se otvara jedna
       * po jedna, i sve to postoji samo dok je sekcija otključana.
       */
      history: {
        open: "Istorija verzija",
        back: "Nazad na uređivanje",
        title: "Istorija verzija",
        empty:
          "Još nema sačuvanih verzija — nastaju automatski tokom pisanja i pri zatvaranju beleške.",
        restore: "Vrati ovu verziju",
        restoreNote: "Trenutno stanje se čuva kao verzija pre vraćanja, pa je i ovaj korak povratan.",
        error: "Radnja nad verzijama nije uspela. Pokušaj ponovo.",
        /** The preview column's label for the selected version's own title. */
        previewLabel: "Naslov u ovoj verziji",
      },
    },
    /**
     * The best-effort clipboard guard (PRIV-012): copying inside the section
     * offers a 30-second auto-clear. Honest about its own reach — clearing
     * needs the app focused at that moment, and another copy elsewhere
     * replaces the content anyway.
     */
    clipboard: {
      notice: "Kopirano — klipbord se briše za 30 s ako je Nexus tada u prvom planu.",
      cancel: "Zadrži u klipbordu",
    },
    /** Typed-confirm HARD delete — no trash, no undo, and the copy says so before the field. */
    deleteDialog: {
      title: "Brisanje privatne beleške",
      warning: "Beleška i njeni prilozi biće odmah i trajno obrisani. Nema korpe i nema opoziva.",
      confirmLabel: "Naslov beleške za potvrdu",
      confirmPlaceholder: "Upiši tačan naslov",
      submit: "Obriši trajno",
      cancel: "Otkaži",
      error: "Brisanje nije uspelo. Pokušaj ponovo.",
    },
    /** „Premesti u Beleške“ — the move OUT, with the consequence stated plainly: it becomes searchable. */
    moveOutDialog: {
      title: "Premeštanje u Beleške",
      warning:
        "Beleška se dešifruje i postaje obična beleška — vidljiva u Beleškama, u pretrazi, u izvozima i rezervnim kopijama.",
      confirmLabel: "Naslov beleške za potvrdu",
      confirmPlaceholder: "Upiši tačan naslov",
      submit: "Premesti",
      cancel: "Otkaži",
      tooLarge: "Beleška je prevelika da bi se premestila odjednom.",
      error: "Premeštanje nije uspelo. Ništa nije promenjeno — pokušaj ponovo.",
    },
  },

  calendar: {
    viewLabel: "Prikaz",
    viewMesec: "Mesec",
    viewNedelja: "Nedelja",
    viewDan: "Dan",
    viewSemestar: "Semestar",
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
     * The cross-profile overlay chip (CAL-005 / ADR-058 §5) — labelled by what
     * it SHOWS, so the pair is kind-dependent: „Poslovni kalendar“ while the
     * personal profile is active, „Privatni kalendar“ while the business one
     * is. The chip exists only when the account has another profile at all.
     */
    sourceOverlayBusiness: "Poslovni kalendar",
    sourceOverlayPrivate: "Privatni kalendar",
    /**
     * The foreign items that chip brings in: read-only guests. The ⇄ glyph
     * marks each one; clicking opens a small popover headed by the origin
     * profile's own name, and its one action routes through the same
     * passcode-gated switch every profile change passes (AUTH-024).
     */
    overlay: {
      /** Accessible name of the ⇄ origin glyph. */
      markerLabel: "Događaj iz drugog profila",
      /** Accessible name of the origin popover (and of the agenda row's „⋯“ that opens it); the visible heading is the profile's name. */
      popoverLabel: "Poreklo događaja",
      /** Why the event cannot be opened here — said in the popover, before the one action it offers. */
      originNote: "Događaj pripada ovom profilu i ovde se ne može menjati.",
      switchAction: "Prebaci profil",
      /** Quiet inline line when the overlay fetch fails; the profile's own calendar is unaffected. */
      loadError: "Kalendar drugog profila se trenutno ne može učitati.",
    },
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
    /**
     * Šabloni (CAL-009) — a saved event shape, captured from the form while an
     * event is open in it and applied from that same form's toolbar onto the day
     * the form names. Worded field for field like `tasks.templates`, since it is
     * the same idea one module over; only the two sentences that mention what is
     * created differ, because one makes a task and this one makes a „događaj“.
     * The block already says „šablon“, so nothing inside it repeats the word.
     */
    templates: {
      /** The toolbar button, and the heading inside both popovers. */
      title: "Šabloni",
      /** Accessible name of the toolbar button's menu. */
      menuLabel: "Šabloni događaja",
      /** Shown in place of the list when the profile has no templates yet. */
      empty: "Još nemaš šablone događaja.",
      /** The action in the „⋯“ menu beside the open event's form. */
      saveAs: "Sačuvaj kao šablon",
      /** Accessible name of that „⋯“ menu — the surface it belongs to, said in full. */
      saveMenuLabel: "Šablon ovog događaja",
      namePlaceholder: "Naziv šablona",
      /** Accessible name of the name field — the action in full, like `tasks.templates.nameLabel`. */
      nameLabel: "Sačuvaj događaj kao šablon",
      /** Said BEFORE the fact, not after: saving under an existing name is how a template is edited. */
      overwriteNote: "Postojeći naziv se zamenjuje.",
      /** Tooltip on a template's name in the list — the click applies it. */
      applyTitle: "Napravi događaj od ovog šablona",
      /** Caption above the list: a template carries no date, so the day it lands on is worth naming out loud. */
      applyDayLabel: "Primenjuje se na",
      delete: "Obriši šablon",
      actionError: "Radnja nad šablonom nije uspela. Pokušaj ponovo.",
    },
    /**
     * ISO week numbers (CAL-010) — the quiet gutter label down the left of the
     * month grid, and the week view's header corner.
     *
     * „ned.“ (nedelja) — the founder's choice (2026-07-31) over „sed.“
     * (sedmica). „Nedelja“ is also „Sunday“, and the label sits beside a row
     * of weekday shorts ending in „ned“; the lower-case styling with the
     * trailing dot is what keeps it reading as a different kind of label, and
     * the hover title says in full which reading is meant.
     */
    weekNumber: {
      /** Header above the gutter, and the prefix in the week view's corner. */
      abbrev: "ned.",
      /** Hover text — says out loud which of the several week numberings this is. */
      title: "Nedelja u godini (ISO 8601)",
    },
    /**
     * Semestar (CAL-010) — four months at once: the month the calendar is on
     * plus the next three, each day carrying only how much it holds. It is an
     * overview and nothing else — no drag, no creating, one click that opens
     * the day it names.
     */
    semester: {
      /** Accessible name of the four-month grid. */
      regionLabel: "Pregled semestra",
      /** Caption under the grid — what a dot and a ring mean, said once. */
      legend: "Tačka — dan sa obavezama · prsten — ispit",
      /** One quiet line while no term is set (ADR-054) — plain text, not a link; it names where the dates live. */
      unsetHint: "Podesi datume semestra u Podešavanjima.",
      /** Said when a set term runs past six months and the grid shows only its first six. */
      truncated: "Semestar je duži od šest meseci — prikazano je prvih šest.",
      /** Appended to a day's accessible name when it holds something: „3 stavke“. */
      itemsOne: "stavka",
      itemsFew: "stavke",
      itemsMany: "stavki",
      /** Appended to that name when the day holds an exam — what its ring says. */
      examMark: "ispit",
    },
    /**
     * The half-day markers of the 12-hour clock (CAL §5), used only when this
     * device is set to it. „AM“/„PM“ rather than a Serbian phrase on purpose:
     * they are exactly what `Intl.DateTimeFormat("sr-Latn", { hour12: true })`
     * itself produces for this locale, so a user who switches clocks sees the
     * form their OS shows them everywhere else.
     */
    clock: {
      am: "AM",
      pm: "PM",
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

    // --- Materials (Materijali), under each subject (STUDY-001) -------------
    /**
     * A subject's own files — the scanned skripta, the slides, last year's
     * paper. The wording follows the TASK page's „Prilozi" block field for
     * field; only the noun changes, because a file hanging off a course is
     * called a material and not an attachment.
     */
    materials: {
      title: "Materijali",
      add: "Dodaj materijal",
      empty: "Nema materijala za ovaj predmet.",
      /** „Pregledaj" (DOC / ADR-064) — the attachment panels' word, offered only on rows the app can render itself. */
      preview: "Pregledaj",
      open: "Otvori",
      saveAs: "Sačuvaj kao…",
      remove: "Ukloni materijal",
      /** The per-material „⋯“ menu, mirroring `tasks.attachments.menuLabel`. */
      menuLabel: "Radnje nad materijalom",
      /** Shown when the picker refused one or more files for size. The 50 MB bound is the store's own (`MAX_SUBJECT_ATTACHMENT_BYTES`). */
      tooLarge: "Datoteke veće od 50 MB se ne mogu priložiti.",
      actionError: "Radnja nad materijalom nije uspela. Pokušaj ponovo.",
    },

    // --- Linked notes (Povezane beleške), under each subject (STUDY-001) ----
    /**
     * The notes a user has filed under a course. „Povezane" rather than
     * „Priložene": nothing is copied here — the note stays in Beleške and this
     * section only points at it, which is exactly what opening one does.
     */
    linkedNotes: {
      title: "Povezane beleške",
      add: "Poveži belešku",
      empty: "Nema povezanih beleški za ovaj predmet.",
      /** Accessible label on a chip: the chip itself shows only the title. */
      openLabel: "Otvori belešku",
      unlink: "Ukloni vezu",
      /** The picker's own empty state — the profile has no note left to link. */
      pickerEmpty: "Nema beleški za povezivanje.",
      pickerLabel: "Izaberi belešku",
      actionError: "Povezivanje beleške nije uspelo. Pokušaj ponovo.",
    },

    // --- Study log (Dnevnik učenja), under each subject (STUDY-014) ---------
    /**
     * What actually happened on this course, day by day, newest first — built
     * from the ponavljanja, the fokus sessions, the plan blocks and the exams
     * the app already records. „Dnevnik" rather than „Istorija": it reads as a
     * record kept along the way, which is what it is; nothing here can be
     * edited.
     *
     * The section is collapsed until asked for (see StudyPage), so its toggle
     * names the thing it opens, exactly as the plan card's block toggle does.
     */
    log: {
      title: "Dnevnik učenja",
      show: "Prikaži dnevnik",
      hide: "Sakrij dnevnik",
      empty: "Još nema zabeleženog učenja.",
      loadError: "Dnevnik učenja se trenutno ne može učitati. Pokušaj ponovo kasnije.",
      /** Widens the window by another 60 days; hidden once nothing older exists. */
      showMore: "Prikaži još",
      /**
       * „5 ponavljanja" — the counted noun takes all three Serbian forms
       * (1 / 2–4 / 5+), so it goes through `countUnit`.
       */
      reviewOne: "ponavljanje",
      reviewFew: "ponavljanja",
      reviewMany: "ponavljanja",
      /** „45 min fokusa" — the duration itself comes from `formatDurationMinutes`. */
      focusSuffix: "fokusa",
      /** „plan 30 min" — what the plan asked of the day, whatever came of it. */
      planPrefix: "plan",
      /** Milestone chip on a day that carries an exam: „Ispit: Pismeni". */
      examTag: "Ispit",
    },

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

    // --- Cloze cards (STUDY-006 / ADR-042) ----------------------------------
    /**
     * The Osnovna/Cloze/Zadatak segmented toggle above the card form. Indexed
     * by the renderer's `CardForm`, NOT by `CardKind`: „Zadatak" is a third
     * FORM of a `basic` card, not a third kind (ADR-046).
     */
    cardKindLabel: "Vrsta kartice",
    cardForm: {
      basic: "Osnovna",
      cloze: "Cloze",
      problem: "Zadatak",
    },
    clozeLabel: "Tekst sa prazninama",
    clozePlaceholder: "Glavni grad Srbije je {{c1::Beograd}}.",
    clozeHint:
      "Stavi {{…}} oko svakog dela koji treba da bude skriven. Broj u {{c1::…}} kaže kojoj kartici praznina pripada — dve praznine sa istim brojem su jedna kartica.",
    /**
     * Wraps the selection in a new deletion and numbers it (ADR-068). A verb:
     * it says what pressing it does, and it is the reason the author never has
     * to count braces or renumber anything by hand.
     */
    clozeAddBlank: "Dodaj prazninu",
    /**
     * The live line under the cloze field: "3 praznine → 3 kartice". Both
     * counted nouns take three Serbian forms (1 / 2–4 / 5+), so they go
     * through `countUnit` rather than `dayUnit`.
     */
    clozeCount: {
      arrow: "→",
      blankOne: "praznina",
      blankFew: "praznine",
      blankMany: "praznina",
      cardOne: "kartica",
      cardFew: "kartice",
      cardMany: "kartica",
      /** Shown instead of the count line while the text has no deletion; creation stays disabled. */
      none: "Nema praznina — dodaj {{…}} da bi nastala kartica.",
    },
    /** Inline refusal when an edit drops the very deletion this card asks about — by NUMBER, not by position (ADR-068). */
    clozeOrdinalMissing: "Ova kartica pita prazninu koju novi tekst više ne sadrži.",

    // --- Problem cards (ADR-046) --------------------------------------------
    /** The statement — the same field a basic card calls its front, named for what it is here. */
    problemStatementLabel: "Tekst zadatka",
    problemStatementPlaceholder: "Nađi izvod funkcije $f(x)=x^2$ u tački $x=1$.",
    problemStepsLabel: "Rešenje po koracima",
    problemStepsPlaceholder: "Izvod je $2x$.\n--\nU tački $x=1$ to je $2$.",
    problemStepsHint: "Odvoji korake redom koji sadrži samo --",
    /**
     * The live line under the solution field: "3 koraka". The counted noun
     * takes all three Serbian forms (1 / 2–4 / 5+), so it goes through
     * `countUnit`, exactly like the cloze count above it.
     */
    problemStepCount: {
      stepOne: "korak",
      stepFew: "koraka",
      stepMany: "koraka",
      /** Shown instead of the count while the solution has no step; creation stays disabled. */
      none: "Nema koraka — upiši rešenje da bi nastala kartica.",
    },
    /** Reveal button on a problem card: each press uncovers the next step. */
    revealNextStep: "Sledeći korak",
    /** Inline fallback when saving a card fails for any other reason. */
    saveCardError: "Kartica nije sačuvana. Pokušaj ponovo.",
    /** Screen-reader label for the masked blank in the review surface. */
    clozeBlankLabel: "skriveni deo",
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

    /**
     * End-of-session summary (STUDY-009). Quiet on purpose: the session is
     * over, so this reports what it was — how the ratings fell, how long it
     * took — rather than congratulating anyone. The four rating labels are
     * `rating` above, reused: the same word must mean the same button.
     */
    summary: {
      durationLabel: "Trajanje",
      /** Shown only when the profile's daily review cap actually cut this queue short (STUDY-007). */
      capReached: "Dnevni limit ponavljanja je dostignut.",
    },

    /**
     * Interleaved practice (STUDY-010 / ADR-047): pick špilovi, get one mixed
     * session across them. „Vežbanje" against „Učenje" is the whole distinction
     * on screen — the ordinary reviewer works through what is due, practice
     * deliberately jumps between topics.
     */
    practice: {
      open: "Vežbaj",
      title: "Vežbanje",
      decksLabel: "Špilovi",
      problemsOnly: "Samo zadaci",
      start: "Počni",
      empty: "Nema kartica za vežbanje u ovom izboru.",
      close: "Otkaži",
      /** The chip naming a card's špil, shown only when a session spans more than one. */
      deckChipLabel: "Špil",
    },

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
      weekdayRange: "Minuti po danu moraju biti celi brojevi od 0 do 480, bar jedan veći od nule.",
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

    // --- Exam topics & the honest planner (ADR-063, slice b) -----------------
    /**
     * Block kind, keyed by the wire's closed `StudyBlockKind` domain. A
     * coverage block renders PLAIN — it is the ordinary case and a chip on
     * every row would be noise — so only revision/recall are ever drawn, but
     * all three are keyed here so the calendar can index by the raw value.
     */
    blockKind: {
      coverage: "obrada",
      revision: "obnavljanje",
      recall: "prisećanje",
    },
    /** Pin toggle on future block rows; the titles say exactly what a pin means. */
    blockPin: "Zakači",
    blockUnpin: "Otkači",
    blockPinTitle: "Zakačen blok preživljava svako ponovno planiranje.",
    blockUnpinTitle: "Otkači blok — sledeće planiranje može da ga pomeri.",
    /** Title on the „Vežbaj" deep link a recall block offers when its topic drills from a špil. */
    blockPracticeTitle: "Pokreni ponavljanje špila ove teme.",
    /** Title on rows inside the final-7-days window (the exam-week posture). */
    examWeekTitle: "Poslednjih 7 dana pred ispit",
    /**
     * Plan health (ADR-063 invariant 5) — building blocks joined inline around
     * the minutes count: „U preostale dane ne staje još 120 min učenja." and
     * „Ispit je prošao — 90 min učenja je ostalo propušteno." Honest reporting,
     * never a silently stretched day.
     */
    healthOverflowPrefix: "U preostale dane ne staje još",
    healthOverflowSuffix: "min učenja.",
    healthExamPassedPrefix: "Ispit je prošao —",
    healthExamPassedSuffix: "min učenja je ostalo propušteno.",
    /**
     * The plan card's scope line (STUDY-004): how many of the exam's topics the
     * user has accepted out of the plan. Three Serbian forms after the count —
     * „1 tema je van plana." / „2 teme su van plana." / „5 tema je van plana."
     */
    scopeCountUnitOne: "tema je van plana.",
    scopeCountUnitFew: "teme su van plana.",
    scopeCountUnitMany: "tema je van plana.",
    /**
     * The scope-cut conversation (STUDY-004): a computed proposal the user must
     * explicitly accept — nothing is ever cut by the machine.
     */
    scopeCut: {
      open: "Predlog skraćenja",
      title: "Predlog skraćenja",
      intro: "Da bi plan stao u preostalo vreme, ove teme bi izašle iz plana:",
      /** „75 min preostalo" beside each proposed topic. */
      minutesSuffix: "min preostalo",
      empty: "Nema tema čije bi isključivanje oslobodilo dovoljno vremena.",
      loadError: "Predlog se trenutno ne može učitati. Pokušaj ponovo.",
      accept: "Prihvati",
      decline: "Odustani",
    },
    /**
     * The exam's topic list inside the plan form (ADR-063). Rank order is both
     * curriculum order and scope-cut priority, which is what the hint says.
     */
    topics: {
      title: "Teme",
      hint: "Redosled je i prioritet — teme sa dna prve izlaze iz plana.",
      empty: "Bez tema plan ostaje jednostavan — jedan blok učenja dnevno.",
      nameLabel: "Naziv teme",
      addPlaceholder: "Nova tema",
      add: "Dodaj temu",
      moveUp: "Pomeri temu naviše",
      moveDown: "Pomeri temu naniže",
      remove: "Obriši temu",
      confidenceLabel: "Pouzdanje",
      confidenceUnknown: "Nepoznato",
      /** Muted „izvedeno: 72" beside an unknown manual confidence a LIVE linked špil resolved. */
      derivedPrefix: "izvedeno:",
      deckLabel: "Špil teme",
      deckNone: "Bez špila",
      /**
       * A stored link whose deck is no longer live (the store's `deckMissing`)
       * — one label for both the row's muted chip and the picker's stale
       * option, so the row says the same thing twice rather than lying „Bez
       * špila" once. The title also states the consequence: a dead špil stops
       * feeding the derived confidence, which is why the „izvedeno" hint beside
       * such a row is gone rather than stale.
       */
      deckMissing: "Nedostupan špil",
      deckMissingTitle:
        "Špil ove teme više ne postoji — pouzdanje se više ne izvodi iz njega. Izaberi drugi špil ili ukloni vezu.",
      /** Chip on a topic the user accepted out of the plan (STUDY-004). */
      cutChip: "van plana",
      /** The un-cut action — the only affordance anywhere that returns a cut topic to the plan. */
      uncut: "Vrati u plan",
      uncutTitle: "Vrati temu u plan — sledeće planiranje je ponovo obuhvata.",
      actionError: "Radnja nad temom nije uspela. Pokušaj ponovo.",
    },
    /** Per-weekday minutes Pon..Ned (the labels reuse `recurrence.weekdayShort`). */
    weekdayMinutesLabel: "Minuti po danu",
    weekdayMinutesHint: "Ostavi sve jednako i svaki dan nosi iste dnevne minute.",

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
    /**
     * Maturity summary (STUDY-013) — „Sazrele kartice: 4 (ukupno 37 zrelih)"
     * builds inline. The count is the range's; the total in brackets is a live
     * census of the whole collection.
     */
    statsMaturedLabel: "Sazrele kartice",
    statsMaturedTotalPrefix: "ukupno",
    statsMaturedTotalSuffix: "zrelih",
    /**
     * Plan adherence (STUDY-013) — „Praćenje plana: 82%", or the em dash when
     * no block was due in the period, since there is no percentage to give.
     */
    statsAdherenceLabel: "Praćenje plana",
    statsAdherenceNone: "—",
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
      security: "Bezbednost",
    },
    /** Snooze preset button labels, keyed by SnoozePreset value. */
    snoozePreset: {
      "10m": "10 min",
      "1h": "1 h",
      tonight: "Večeras",
      "tomorrow-morning": "Sutra ujutru",
    },
    /**
     * NTF-009: the one-click snooze, which uses the profile's default preset.
     * Deliberately unlabelled with a duration — main reads the default at the
     * moment of the click, so any duration printed here could be a lie the
     * instant the preference changes in another window. The four presets beside
     * it still say exactly what they do.
     */
    snoozeDefaultAction: "Odloži",
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
      /** NTF-009: which preset the center's plain „Odloži“ button reaches for. */
      snoozeDefaultLabel: "Podrazumevano odlaganje",
      snoozeDefaultHint: "Dugme „Odloži“ u obaveštenjima koristi ovaj izbor.",
      /** Source toggle checkbox labels, keyed by NotificationSource value. */
      sourceToggle: {
        document: "Dokumenta",
        exam: "Ispiti",
        "study-day": "Učenje",
        event: "Događaji",
        task: "Zadaci",
        security: "Bezbednost",
      },
      /** NTF-007: why the „Bezbednost“ toggle is on and greyed out. */
      alwaysOnCaption: "Bezbednosna obaveštenja se ne mogu isključiti.",
      saveError: "Čuvanje podešavanja nije uspelo. Pokušaj ponovo.",
    },
    /**
     * The one-time appetite question (NTF-008 / ADR-033), put at the first
     * moment Nexus is actually about to remind. Asked once, ever — so the copy
     * never promises a second chance, and the quiet "Zadrži podrazumevano" is a
     * real answer, not an escape. The three choices reuse
     * `settings.notificationPresets` labels: the same word must mean the same
     * set here and on the Settings page.
     */
    appetite: {
      title: "Koliko da te Nexus podseća?",
      question:
        "Prvi podsetnik je spreman. Izaberi koliko obaveštenja želiš — kasnije sve možeš promeniti u Podešavanjima.",
      keepDefault: "Zadrži podrazumevano",
      saveError: "Čuvanje izbora nije uspelo. Pokušaj ponovo.",
    },
  },

  /**
   * Finansije (FIN slice b). The copy states the module's two structural rules
   * out loud wherever the user could otherwise be surprised by them: totals are
   * per currency because Nexus holds no exchange rate, and a transfer is one
   * act between two of your own accounts rather than an expense with an odd
   * category.
   *
   * Every amount the user sees is produced by `money.ts` — there is no number
   * in this table.
   */
  finance: {
    loadErrorTitle: "Finansije nisu učitane",
    loadError: "Učitavanje finansija nije uspelo. Zatvori i ponovo otvori stranicu.",
    /** The one line every failed write falls back to when `financeErrorMessage` recognizes nothing more specific. */
    actionError: "Radnja nije uspela. Pokušaj ponovo.",
    undo: "Opozovi",
    dismiss: "Zatvori",
    /** The two halves of the page: the book you write into, and the month you read back. */
    pages: {
      label: "Prikaz",
      ledger: "Knjiga",
      report: "Izveštaj",
    },
    accounts: {
      heading: "Računi",
      /** The rail's "no account filter" row — a view over every account, not an account. */
      all: "Svi računi",
      archivedHeading: "Arhivirani",
      archivedChip: "Arhiviran",
      newAccount: "Novi račun",
      nameLabel: "Naziv računa",
      namePlaceholder: "Tekući račun",
      kindLabel: "Vrsta",
      currencyLabel: "Valuta",
      /** Three letters, ISO-4217 — the field says the shape rather than offering a list Nexus would have to invent. */
      currencyHint: "Troslovna oznaka, npr. RSD",
      openingLabel: "Početno stanje",
      openingHint: "Stanje na dan kada dodaješ račun. Kasnije se ne menja samo od sebe.",
      kinds: {
        cash: "Gotovina",
        current: "Tekući račun",
        card: "Kartica",
        savings: "Štednja",
      },
      save: "Sačuvaj",
      cancel: "Otkaži",
      edit: "Izmeni",
      archive: "Arhiviraj",
      unarchive: "Vrati iz arhive",
      delete: "Obriši",
      deletedNotice: "Račun je obrisan, zajedno sa svojim transakcijama.",
      /** The invitation a profile with no accounts sees — never a sample row. */
      emptyTitle: "Još nema računa",
      emptyDescription:
        "Dodaj prvi račun i Nexus će voditi njegovo stanje — sam ga izračunava iz početnog stanja i transakcija.",
      invalidCurrency: "Valuta mora biti troslovna oznaka, na primer RSD.",
      invalidOpening: "Početno stanje nije ispravan iznos.",
      invalidName: "Naziv računa ne može biti prazan.",
    },
    totals: {
      heading: "Ukupno",
      /**
       * Said out loud, because the absence of one number is the design and not
       * an omission: without kursa nijedan zbir preko valuta ne bi bio istinit.
       */
      caption: "Po valuti — Nexus nema kurs, pa se stanja u različitim valutama nikada ne sabiraju.",
      /** Shown while the profile has accounts but every one of them is archived. */
      none: "Nema aktivnih računa.",
    },
    categories: {
      heading: "Kategorije",
      newCategory: "Nova kategorija",
      namePlaceholder: "Hrana",
      kinds: {
        income: "Prihod",
        expense: "Rashod",
      },
      delete: "Obriši",
      /** Stated on the delete affordance itself: what survives matters more than what goes. */
      deleteHint: "Transakcije ostaju — samo gube kategoriju.",
      empty: "Još nema kategorija.",
      duplicate: "Kategorija sa tim imenom već postoji.",
      invalidName: "Ime kategorije ne može biti prazno.",
      /** The chip opens the editor, which does both things — hence „Uredi" rather than „Preimenuj". */
      edit: "Uredi",
      editHint: "Preimenuj kategoriju ili joj postavi budžet.",
    },
    /**
     * Budžeti (FIN slice c). Edited where categories are edited, because a
     * budget IS a category's monthly limit and has no life of its own.
     *
     * The copy states the two things the user would otherwise have to guess:
     * a limit is per currency (there is no kurs to fold two into one), and it
     * belongs only to a rashod category — a prihod category would want a
     * target, which compares the other way around.
     */
    budgets: {
      heading: "Budžet",
      /** On a category chip that carries one — a word, never an amount: one category can hold one limit per currency. */
      marker: "limit",
      hint: "Mesečni limit, po valuti — Nexus nema kurs, pa se limiti u različitim valutama nikada ne sabiraju.",
      incomeOnly: "Budžet ima samo rashodna kategorija: limit ograničava trošak.",
      currencyLabel: "Valuta",
      amountLabel: "Mesečni limit",
      set: "Postavi",
      /** On the × beside one currency's allowance. */
      clearHint: "Uklanja limit samo u ovoj valuti.",
      none: "Nema postavljen limit.",
      needsAccount: "Prvo dodaj račun — limit se postavlja u valuti nekog tvog računa.",
      invalidAmount: "Limit mora biti iznos veći od nule. Ako ga ne želiš, ukloni ga.",
    },
    /**
     * Izveštaj (FIN slice c) — what ONE month held, and nothing beyond it.
     *
     * The copy is bound by the honesty rule the whole module is built on: the
     * report states what happened. There is no prognoza, no procena, no „ovim
     * tempom ćeš…" anywhere in this table, because there is no such number
     * anywhere in the code that fills it.
     */
    report: {
      previousMonth: "Prethodni mesec",
      nextMonth: "Sledeći mesec",
      thisMonth: "Ovaj mesec",
      income: "Prihod",
      expense: "Rashod",
      /** Under a section's head, only when something in it actually has a limit — otherwise the mark has nothing to explain. */
      barsCaption: "Traka je potrošeno, crta je limit.",
      noBudget: "nema limita",
      over: "preko limita",
      /** A currency that only saw income this month — its own fact, not an empty page. */
      noSpending: "Nema rashoda u ovoj valuti ovog meseca.",
      /** Shown only when some line actually went negative: the minus is a fact, not a bug. */
      refundNote: "Minus znači da su povraćaji tog meseca bili veći od troška.",
      /** The caption the whole report stands on — said out loud so nobody waits for a prediction that will never come. */
      caption:
        "Samo ovaj mesec i samo po valuti. Nexus ne predviđa potrošnju i ne procenjuje limit umesto tebe.",
      emptyTitle: "Ovaj mesec je prazan",
      emptyDescription:
        "Nema ni prihoda ni rashoda u ovom mesecu. Prenos između tvojih računa se ovde ne računa — to nije ni prihod ni rashod.",
      loadErrorTitle: "Izveštaj nije učitan",
      loadError: "Učitavanje izveštaja nije uspelo. Izaberi mesec ponovo.",
    },
    ledger: {
      emptyTitle: "Još nema transakcija",
      emptyDescription: "Upiši prvu iznad — iznos, opis i datum su dovoljni.",
      /** When a filter matches nothing, which is a different fact from an empty ledger. */
      filterEmptyTitle: "Ništa ne odgovara filterima",
      filterEmptyDescription: "Promeni račun, kategoriju ili period da vidiš više.",
      uncategorized: "Bez kategorije",
      transfer: "Prenos",
      /** Between the two account names on a transfer row: „Tekući → Štednja". */
      transferArrow: "→",
      deletedNotice: "Transakcija je obrisana.",
      edit: "Izmeni",
      delete: "Obriši",
    },
    form: {
      /** The three acts the one form can perform; the choice decides the sign and what the row may carry. */
      kindExpense: "Rashod",
      kindIncome: "Prihod",
      kindTransfer: "Prenos",
      kindLabel: "Vrsta unosa",
      amountLabel: "Iznos",
      amountPlaceholder: "0,00",
      payeeLabel: "Opis",
      payeePlaceholder: "Prodavnica",
      dateLabel: "Datum",
      accountLabel: "Račun",
      fromAccountLabel: "Sa računa",
      toAccountLabel: "Na račun",
      categoryLabel: "Kategorija",
      categoryNone: "Bez kategorije",
      noteLabel: "Beleška",
      submitAdd: "Dodaj",
      submitSave: "Sačuvaj",
      cancel: "Otkaži",
      invalidAmount: "Iznos nije ispravan. Upiši ga kao 1234,56.",
      zeroAmount: "Iznos ne može biti nula.",
      missingCounter: "Izaberi i račun sa kojeg i račun na koji ide prenos.",
      needsAccount: "Prvo dodaj račun — transakcija mora negde da stane.",
    },
    filters: {
      categoryLabel: "Filter po kategoriji",
      categoryAll: "Sve kategorije",
      categoryNone: "Bez kategorije",
      fromLabel: "Od",
      toLabel: "Do",
      clear: "Poništi filtere",
      invalidPeriod: "„Od“ ne može biti posle „Do“.",
    },
    views: {
      list: "Lista",
      cards: "Kartice",
    },
    /**
     * The refusals the three stores name (FIN slice a). Each one is matched off
     * the store's own message text, exactly as `planErrorMessage` does for
     * STUDY — the store stays the authority on what is rejected, and this is
     * only how the page says it in Serbian.
     */
    error: {
      transferSameAccount: "Prenos ide između dva različita računa.",
      transferCurrency:
        "Prenos ne može da pređe iz jedne valute u drugu — Nexus nema kurs. Upiši dve obične transakcije.",
      transferCategory: "Prenos nema kategoriju: to nije ni prihod ni rashod.",
      /** The store's refusal to put a limit on an income category, said in Serbian. */
      budgetOnIncome: "Budžet ide samo na rashodnu kategoriju — prihod se ne ograničava.",
      budgetAmount: "Limit mora biti iznos veći od nule.",
      notFound: "Taj zapis više ne postoji. Osveži stranicu.",
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
      profiles: "Profili",
      security: "Sigurnost",
      appearance: "Izgled",
      tasks: "Zadaci",
      notes: "Beleške",
      priv: "Privatne beleške",
      shortcuts: "Prečice",
      dashboard: "Kontrolna tabla",
      study: "Učenje",
      calendar: "Kalendar",
      finance: "Finansije",
      modules: "Moduli",
      notifications: "Obaveštenja",
      backup: "Rezervna kopija",
      privacy: "Podaci i privatnost",
      about: "O aplikaciji",
    },
    /**
     * SET §5: the per-card „Vrati na podrazumevano“. One block of copy for
     * every card that has the link, because the act is the same act each time
     * — only the card's own name changes, and the dialog shows that rather
     * than repeating it in a sentence per section.
     *
     * The question states the two bounds the reset actually respects, since
     * both are things the user would otherwise have to trust: it reaches only
     * this card, and only this device.
     */
    reset: {
      /** The quiet link at the foot of a card. */
      action: "Vrati na podrazumevano",
      title: "Vrati na podrazumevano",
      question:
        "Podešavanja ovog odeljka vraćaju se na podrazumevana. Menja se samo ovaj uređaj — ništa u tvojim podacima se ne dira.",
      confirm: "Vrati podrazumevano",
      cancel: "Otkaži",
    },
    profile: {
      nameLabel: "Ime",
      save: "Sačuvaj",
      saveError: "Čuvanje nije uspelo — ime mora imati 1–80 karaktera.",
      /**
       * SET-001: the profile picture. „Slika profila“ names the block; the
       * caption states the automatic crop out loud rather than letting the user
       * discover it — an interactive crop is deliberately not built (the
       * renderer would have to handle the image bytes, which it never does),
       * and a promise the app cannot keep is worse than a plain sentence.
       */
      pictureLabel: "Slika profila",
      pictureCaption: "Slika se automatski opseca na kvadrat.",
      pickPicture: "Izaberi sliku",
      /** Also the picture's own alt text: it is decoration, so it says what it is rather than describing it. */
      pictureAlt: "Slika profila",
      removePicture: "Ukloni sliku",
      /** One sentence per `ProfilePicturePickErrorCode`: the file was refused, and why. */
      pictureRejected: {
        "too-large": "Slika je prevelika — najviše 10 MB.",
        "unsupported-format": "Ovaj format nije podržan. Koristi PNG, JPEG, GIF ili WebP.",
        unreadable: "Fajl nije moguće pročitati.",
        /** The format IS allowed but the decoder could not open it — a different sentence, because the user's next step is different. */
        undecodable: "Ovu sliku nije moguće obraditi. Pokušaj sa PNG ili JPEG fajlom.",
      } satisfies Record<ProfilePicturePickErrorCode, string>,
      /** A rejected IPC call (not one of the named reasons above). */
      pictureError: "Promena slike nije uspela. Pokušaj ponovo.",
    },
    /**
     * „Profili“ card (SET-003 / ADR-058): the account's profiles, the ONE
     * business profile v1 allows, and a delete that never touches the personal
     * anchor. The kind marker, the empty-name fallback and the switch-gate copy
     * live in the top-level `profiles` block — the sidebar switcher reads the
     * same words, and two spellings of „Posao“ would eventually disagree.
     */
    profiles: {
      caption:
        "Poslovni profil drži posao odvojeno od privatnog — svoje zadatke, beleške i podešavanja, pod istim nalogom i istim pristupnim kodom.",
      /** The active row's second line; the name itself carries the gold active state. */
      activeMarker: "Trenutno aktivan",
      /** Shown once a business profile is created here: what happened, and that naming comes at first entry (the ONB-lite sentinel, said out loud). */
      createdNotice: "Poslovni profil je napravljen. Ime mu daješ pri prvom ulasku.",
      /** The offer beside the notice — the same passcode gate every switch passes. */
      switchToNew: "Pređi na novi profil",
      delete: "Obriši",
      /**
       * Deleting a business profile (ADR-058, the ADR-048 typed-name idiom).
       * Immediate and irreversible, so the warning is read BEFORE the field:
       * what goes, and that it cannot be taken back. Confirmed by typing the
       * profile's display name — for an unnamed business profile that is
       * „Posao“, its fallback label everywhere else too.
       */
      deleteTitle: "Brisanje profila",
      deleteWarning: "Svi podaci profila biće trajno obrisani. Ovo se ne može opozvati.",
      deleteConfirmLabel: "Ime profila za potvrdu",
      deleteConfirmPlaceholder: "Upiši tačno ime profila",
      deleteSubmit: "Obriši profil",
      deleteCancel: "Otkaži",
      deleteError: "Brisanje nije uspelo. Pokušaj ponovo.",
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
      /**
       * CAL §5, beside the week start and for the same reason: both describe
       * how this machine reads a calendar. The duration is what the create
       * form seeds an end time with; the clock is how every calendar time is
       * DRAWN — the time fields themselves stay whatever form the system draws
       * them in, which the caption says out loud rather than leaving to be
       * discovered.
       */
      eventDurationLabel: "Podrazumevano trajanje događaja",
      eventDurationOptions: {
        "30": "30 minuta",
        "60": "1 sat",
        "90": "1 sat i 30 minuta",
        "120": "2 sata",
      } as Record<string, string>,
      clockLabel: "Prikaz vremena",
      clockOptions: {
        "24h": "24-časovni (14:00)",
        "12h": "12-časovni (2:00 PM)",
      } satisfies Record<ClockPreference, string>,
      clockHint: "Polja za unos vremena zadržavaju oblik koji crta sistem.",
    },
    /**
     * Zadaci section (ADR-049): a device preference over the „Danas“ and
     * „Sledećih 7 dana“ views, beside the Beleške card below and for the same
     * reason — it describes how this machine reads one module, not what the
     * profile holds, so it belongs to that module rather than to „Izgled“.
     */
    tasks: {
      blockedInTodayLabel: "Blokirani zadaci u pregledu Danas",
      blockedInTodayCaption:
        "Zadatak koji čeka na drugi zadatak. Važi i za pregled „Sledećih 7 dana”.",
      blockedInTodayOptions: {
        sakrij: "Sakrij",
        prikazi: "Prikaži",
      } satisfies Record<BlockedInToday, string>,
    },
    /** Beleške section (ADR-036): the note editor's reading measure and its markdown shortcuts. */
    notes: {
      widthLabel: "Širina editora",
      widthNames: {
        uska: "Uska",
        normalna: "Normalna",
        siroka: "Široka",
      } as Record<string, string>,
      markdownLabel: "Markdown prečice",
      markdownCaption:
        "Kucanje „# ”, „- ” ili „> ” odmah pretvara blok. „/” meni radi i kada je isključeno.",
    },
    /**
     * Privatne beleške card (PRIV v1 / ADR-057) — shown only while the
     * „Privatno" module is enabled. The kit status line states a fact the
     * user chose at setup, in the honest register the whole section keeps.
     */
    priv: {
      caption:
        "Privatne beleške su šifrovana sekcija koja se otključava odvojeno od ostatka aplikacije.",
      notSetUp: "Sekcija se podešava pri prvom otvaranju modula Privatno.",
      autoLockLabel: "Automatsko zaključavanje sekcije",
      autoLockHint: "Sekcija se sama zaključava posle ovoliko minuta bez rada u njoj.",
      /** „Posle N minuta“ — after „posle" the genitive holds for every count, so one form serves all sixty options. */
      autoLockOptionPrefix: "Posle",
      minuteUnit: "minuta",
      lockOnMinimizeLabel: "Zaključaj pri minimizovanju prozora",
      kitStatusSet: "Kod za oporavak je podešen — isti kod otvara i nalog i privatne beleške.",
      kitStatusMissing:
        "Bez koda za oporavak — ako zaboraviš lozinku, privatne beleške su nepovratno izgubljene.",
      saveError: "Čuvanje nije uspelo. Pokušaj ponovo.",
      loadError: "Podešavanja privatnih beležaka se trenutno ne mogu učitati.",
    },
    /**
     * Kontrolna tabla section (SET-006 / ADR-041): the dashboard's own
     * background image and how far it is dimmed behind the widgets.
     */
    dashboard: {
      caption: "Slika stoji iza kartica na kontrolnoj tabli.",
      /** Alt text for the current-background thumbnail — the image is decoration, so it says what it is rather than describing it. */
      thumbnailAlt: "Trenutna pozadina kontrolne table",
      pick: "Izaberi sliku…",
      clear: "Ukloni",
      dimLabel: "Zatamnjenje",
      /** Hidden while no background is set — a slider with nothing to dim is a control with no effect. */
      dimHint: "Veće zatamnjenje znači mirniju pozadinu i čitljiviji tekst.",
      /** One sentence per `DashboardPickErrorCode`: the file was refused, and why. Never a re-encode. */
      rejected: {
        "too-large": "Slika je prevelika — najviše 20 MB.",
        "unsupported-format": "Ovaj format nije podržan. Koristi PNG, JPEG, GIF ili WebP.",
        unreadable: "Fajl nije moguće pročitati.",
      } satisfies Record<DashboardPickErrorCode, string>,
      /** A rejected IPC call (not one of the named reasons above). */
      error: "Promena pozadine nije uspela. Pokušaj ponovo.",
    },
    /**
     * Učenje section (STUDY-007): how hard the scheduler aims, and how much of
     * it lands on one day. Three settings, one card — they are read together on
     * every session, and a user deciding "less per day" usually means all of it.
     */
    study: {
      caption: "Podešava kako se ponavljanja raspoređuju i koliko ih dnevno stiže.",
      retentionLabel: "Ciljana zapamćenost",
      /** Suffix on the preset the scheduler uses when nothing was ever chosen. */
      retentionDefault: "podrazumevano",
      retentionHint:
        "Veća vrednost znači kraće razmake i manje zaboravljanja, ali i više ponavljanja svakog dana.",
      newPerDayLabel: "Novih kartica dnevno",
      newPerDayHint: "Koliko novih kartica jedna sesija najviše nudi. Nula znači samo obnavljanje.",
      reviewCapLabel: "Dnevni limit ponavljanja",
      reviewCapHint: "Prazno polje znači bez limita. Nove kartice se ne računaju u ovaj limit.",
      /** Placeholder in the empty cap field — the field's own empty state, said out loud. */
      reviewCapPlaceholder: "bez limita",
      /** The one thing about this card a user could otherwise get wrong: nothing already scheduled moves. */
      retroNotice: "Promena važi od sledećeg ponavljanja — već zakazane kartice ostaju kako jesu.",
      error: "Čuvanje podešavanja učenja nije uspelo. Pokušaj ponovo.",
    },
    /**
     * Kalendar section (CAL-010 / ADR-054): the semester's fixed dates the
     * Semestar view anchors to. A PROFILE fact, unlike the week start and the
     * clock, which are device preferences and stay in „Izgled" — which is why
     * this is its own card rather than two more rows there.
     */
    calendar: {
      caption:
        "Datumi semestra drže pregled „Semestar“ na istim mesecima. Bez njih pregled klizi od tekućeg meseca.",
      /** Heading over the two date fields — also the SET-014 hit label. */
      datesLabel: "Datumi semestra",
      startLabel: "Početak semestra",
      endLabel: "Kraj semestra",
      save: "Sačuvaj",
      clear: "Ukloni datume",
      /** The pair rule, said before main and the store refuse it: both dates, in order. */
      invalidPair: "Unesi oba datuma — semestar ima i početak i kraj.",
      invalidOrder: "Kraj semestra ne može biti pre početka.",
      saved: "Datumi semestra su sačuvani.",
      cleared: "Datumi semestra su uklonjeni.",
      error: "Čuvanje datuma semestra nije uspelo. Pokušaj ponovo.",
    },
    /**
     * Finansije (FIN slice b). ONE control, and the card says exactly what it
     * does and does not reach: the currency of your money lives on each
     * account, and this only decides which code „Novi račun" opens on — which
     * is also why it is a DEVICE preference and why the card offers a reset.
     */
    finance: {
      caption:
        "Valuta se bira po računu. Ovo je samo kod na koji se otvara obrazac za novi račun — postojeći računi se ne diraju.",
      primaryCurrencyLabel: "Podrazumevana valuta",
      primaryCurrencyHint: "Troslovna oznaka po ISO 4217, na primer RSD ili EUR.",
      invalidCurrency: "Upiši troslovnu oznaku valute, na primer RSD.",
      saved: "Podrazumevana valuta je sačuvana.",
    },
    /** One-line module descriptions for the gallery, keyed by module id. */
    moduleDescriptions: {
      dashboard: "Pregled dana na jednom mestu — obaveze, zadaci i dokumenta koja ističu.",
      tasks: "Zadaci sa listom i tablom, prioritetima i rokovima.",
      calendar: "Događaji, agenda i praćenje isteka dokumenata.",
      settings: "Profil, izgled, moduli i obaveštenja.",
      notes: "Beleške sa blok-editorom — markdown prečice i „/” meni za formatiranje.",
      study: "Predmeti, ispiti, kartice za učenje i planovi pripreme za ispite.",
      priv: "Šifrovane privatne beleške — otključavaju se posebno i ne pojavljuju se u pretrazi.",
      finance: "Računi, transakcije i prenosi — stanje se računa iz onoga što upišeš.",
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
    /**
     * ADR-065 §5 — the one row that reopens the onboarding questionnaire. It
     * sits at the foot of this card because the questionnaire's third screen IS
     * this gallery, only asked as a question; the caption states the two things
     * a rerun could otherwise be feared to do, since it starts from what the
     * profile has and writes only what changes.
     */
    onboardingRerunTitle: "Podešavanje modula",
    onboardingRerunAction: "Ponovo pokreni upitnik",
    onboardingRerunCaption:
      "Ista pitanja kao pri prvom pokretanju — kreće od onoga što sada imaš i menja samo ono što promeniš.",
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
      /**
       * IMEX-003 — the module picker, closed by default because the default IS
       * everything and the description above already says so. The module names
       * themselves are read off `settings.restore.modules`, the one archive-module
       * vocabulary this screen has.
       */
      modulesToggle: "Šta se izvozi",
      /** The disclosure's own summary when nothing is unticked; a subset shows „4/6“ instead, which needs no words at all. */
      modulesAll: "sve",
      /** Shown under the picker when every box is unticked — the state the export button is disabled in. */
      modulesEmpty: "Izaberi bar jedan modul.",
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
      /**
       * Privatne beleške u izvozu (ADR-057 §6). The included line renders as
       * „… (N).“ with the count in parentheses — deliberately, so one form
       * reads correctly at every count (a declined „beleške/beležaka“ would
       * need three). Shown whenever `privateNotes > 0`: the user must never
       * learn from a zip listing that their most guarded notes left the app.
       * The two skip sentences map the result's `privateNotesSkipped` codes —
       * exactly one is ever shown, and only when there was something to skip.
       */
      privateNotesIncludedPrefix: "U arhivu su uključene i privatne beleške",
      privateNotesSkippedLocked: "Privatne beleške nisu izvezene — sekcija je zaključana.",
      privateNotesSkippedPlaintext: "Privatne beleške nisu izvezene jer se izvozi bez lozinke.",
      error: "Izvoz nije uspeo. Pokušaj ponovo.",
    },
    /**
     * Automatska rezervna kopija (SET-011 / ADR-056) — the scheduled half of
     * the same "Rezervna kopija" card. There is deliberately NO plaintext
     * wording anywhere in this block: a scheduled archive is always encrypted,
     * and the copy never has to explain a choice that does not exist. The
     * passphrase hint is borrowed from `backup.passphraseHint` in the JSX —
     * same rule, same sentence, spelled once.
     *
     * `runErrors` mirrors the wire's `BackupRunErrorCode`; `unknown` catches a
     * code a newer build recorded that this one cannot name.
     */
    autoBackup: {
      title: "Automatska rezervna kopija",
      description:
        "Nexus sam pravi šifrovanu arhivu celog profila u izabranoj fascikli — dnevno ili nedeljno, dok je aplikacija otključana. Propušten termin se nadoknađuje pri prvom sledećem otključavanju.",
      enableLabel: "Uključi automatsku rezervnu kopiju",
      /** Shown while the toggle is disabled — names the two prerequisites instead of leaving a dead checkbox unexplained. */
      enableHint: "Pre uključivanja izaberi fasciklu i postavi lozinku.",
      cadenceLabel: "Učestalost",
      cadenceOptions: {
        daily: "Dnevno",
        weekly: "Nedeljno",
      },
      folderLabel: "Fascikla",
      folderPick: "Izaberi fasciklu…",
      folderNone: "Fascikla nije izabrana.",
      keepLastLabel: "Koliko kopija se čuva",
      keepLastHint: "Posle svake uspešne kopije, starije od ovog broja se brišu.",
      /** Labels for `BACKUP_KEEP_LAST_CHOICES`, keyed by the numeric value as a string — Serbian numeral agreement spelled per choice. */
      keepLastOptions: {
        "2": "2 kopije",
        "3": "3 kopije",
        "5": "5 kopija",
        "10": "10 kopija",
        "20": "20 kopija",
        "50": "50 kopija",
      } as Record<string, string>,
      passphraseTitle: "Lozinka arhive",
      /** One label, two moments: the button SETS a first passphrase and CHANGES an existing one — `passphraseStatusSet` says which state the card is in. */
      passphraseSave: "Postavi lozinku",
      passphraseChange: "Promeni lozinku",
      passphraseStatusSet: "Lozinka je postavljena.",
      /** The one fact a change must say out loud: it reaches only future runs. */
      passphraseFutureNote:
        "Nova lozinka važi za buduće kopije — ranije napravljeni fajlovi ostaju pod starom.",
      runNow: "Napravi odmah",
      lastRunPrefix: "Poslednja:",
      lastRunOk: "uspešna",
      lastRunFailed: "nije uspela",
      lastRunNever: "Još nije napravljena nijedna kopija.",
      /** One clause per `BackupRunErrorCode`, composed into „nije uspela — <razlog>, <vreme>". */
      runErrors: {
        "folder-unreachable": "fascikla nije dostupna",
        "passphrase-unreadable": "sačuvanu lozinku nije moguće pročitati",
        "write-failed": "pisanje arhive nije uspelo",
        unknown: "nepoznata greška",
      } as Record<string, string>,
      error: "Radnja nije uspela. Pokušaj ponovo.",
    },
    /**
     * Izvoz kalendara (CAL-008) — the small `.ics` action beside the full
     * export in the same "Rezervna kopija" card. Its own block rather than more
     * keys on `backup`, because it is a different file in a different format
     * with its own result line; it borrows `backup.savedPrefix` for the path,
     * which is the same sentence saying the same thing.
     *
     * `description` names the one thing the user has to know before clicking:
     * this file is not protected, because no other calendar could open it if it
     * were.
     */
    calendarExport: {
      title: "Izvoz kalendara",
      description:
        "Izvezi samo kalendar kao .ics — standardni format koji Google kalendar, Apple kalendar i Outlook otvaraju. Fajl nije zaštićen lozinkom, jer ga tako nijedan drugi kalendar ne bi mogao otvoriti.",
      button: "Izvezi kalendar (.ics)",
      /** "N događaj"/"N događaja" — Serbian numeral agreement via `dayUnit`. */
      eventsUnitOne: "događaj",
      eventsUnitMany: "događaja",
      /**
       * Shown only when `skipped > 0`: "N događaj(a) nije izvezeno — datum
       * početka nije ispravan." Numeral agreement via `dayUnit`, and the reason
       * sits outside the counted phrase so it reads correctly at every count.
       */
      skippedPrefix: "Nije izvezeno:",
      skippedSuffix: "— datum početka nije ispravan.",
      error: "Izvoz kalendara nije uspeo. Pokušaj ponovo.",
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
       *
       * Also what the export's „Šta se izvozi“ picker labels its checkboxes with
       * (IMEX-003): the same seven archive modules, named once.
       *
       * „Finansije“ appears here from FIN slice a onward — before the module has
       * a page — and deliberately: the archive vocabulary is the interchange's,
       * not the registry's (see the note above), and a backup that silently
       * omitted a row it actually carries would be the far worse lie. Until the
       * ledger has a screen the row simply reads 0 on both sides, which is true.
       */
      modules: {
        tasks: "Zadaci",
        calendar: "Kalendar",
        study: "Učenje",
        notifications: "Obaveštenja",
        notes: "Beleške",
        dashboard: "Kontrolna tabla",
        finance: "Finansije",
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
      /**
       * Privatne beleške u pregledu (ADR-057 §6). The carries line renders as
       * „… (N).“ — the count in parentheses, one form for every count (the
       * export block's own arrangement) — and is shown WHENEVER the archive
       * carries private notes, restorable or not: someone confirming a
       * restore must see that this file holds somebody's private section.
       * The skip sentence joins it only while the target's section is locked
       * or not set up; in the preview's own tense (the corrupt-blob line's
       * precedent), because nothing has been skipped yet.
       */
      privateNotesIncomingPrefix: "Arhiva sadrži i privatne beleške",
      privateNotesSkippedNotice:
        "Privatne beleške iz arhive neće biti vraćene — otključaj privatnu sekciju pre vraćanja.",
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
        // ADR-058: arhiva se vraća samo u profil svoje vrste (lični ↔ poslovni).
        "profile-kind-mismatch":
          "Arhiva pripada drugoj vrsti profila (lični/poslovni) i ne može se vratiti u ovaj profil — izaberi profil iste vrste.",
      } satisfies Record<RestoreProblemCode, string>,
    },
    /**
     * Uvoz iz arhive (ADR-043 §5) — the ADDITIVE sibling of the restore block
     * above, in the same "Rezervna kopija" card and through the same
     * pick → passphrase → preview → confirm flow.
     *
     * Only what actually differs is spelled here. Everything the two flows
     * share — the passphrase field, the preview/running lines, the picked-file
     * prefix, the manifest labels, the `unreadable`/`problems` sentences, the
     * corrupt-blob line, the module row labels, „Otkaži“ — is read straight off
     * `strings.settings.restore` by the component, because the flows are
     * identical there by design and a second spelling would drift.
     *
     * `description` states the contract the whole card turns on and that the
     * restore description states in reverse: an import ADDS, a restore
     * REPLACES.
     *
     * `skips` is typed against the wire's own closed `ImportSkipCode` domain,
     * so a code added in `shared/ipc.ts` is a compile error here rather than a
     * silently missing sentence in the one screen that has to be honest about
     * what will not arrive.
     */
    import: {
      title: "Uvoz iz arhive",
      description:
        "Dodaj sadržaj tuđe arhive — ili svog drugog profila — u ovaj profil. Uvoz ništa ne briše: sve što već imaš ostaje na svom mestu, a sadržaj arhive dolazi pored toga, kao novi zapisi. Uvoz možeš opozvati jednim klikom, ali samo dok ne zaključaš ili ne zatvoriš aplikaciju.",
      /** Preview header, beside the archive's own manifest facts (which reuse restore's labels). */
      targetLabel: "Uvozi se u",
      encryptedBadge: "Šifrovana arhiva",
      /**
       * The per-module table's four columns — `ImportModuleCounts`' own
       * arithmetic, in its own order: `parsed = imported + merged + skipped`.
       */
      columnParsed: "U arhivi",
      columnImported: "Uvozi se",
      columnMerged: "Spojeno",
      columnSkipped: "Preskočeno",
      /** Says what the two middle columns mean before the user has to guess — merging is the part nobody expects. */
      tableCaption:
        "„Spojeno“ su zapisi koji su se poklopili sa nečim što već imaš — oznaka istog imena, veza koja već postoji. Sve „preskočeno“ je, razlog po razlog, izlistano ispod.",
      /** Heading above the skip list; rendered only when the plan actually skips something. */
      skipsTitle: "Šta se ne uvozi",
      /**
       * Heading above the parse warnings. A restore's preview needs none — it
       * shows one list — while an import shows the grouped skip report AND the
       * row-by-row detail behind it, and two unlabeled lists in a row would
       * read as one.
       */
      warningsTitle: "Upozorenja pri čitanju arhive",
      /**
       * One sentence per `ImportSkipCode`. The first seven are rows salvage
       * mode could not read — the „oštećen red“ family, worded so it is clear
       * the ARCHIVE is at fault and the rest of it still arrives. The rest
       * are skipped BY DESIGN, and each says whose choice wins and why.
       *
       * The default task list is deliberately never named („Inbox“): it is a
       * stored, renamable row, exactly as `strings.tasks.lists` explains.
       */
      skips: {
        "unknown-record-type":
          "Oštećen red — vrsta zapisa koju ova verzija Nexusa ne poznaje; ostatak arhive se uvozi normalno.",
        "invalid-record": "Oštećen red — zapis nije ispravan i zato se preskače.",
        "duplicate-id": "Oštećen red — isti zapis se u arhivi pojavljuje više puta; uzima se prvi.",
        "unknown-reference": "Oštećen red — zapis upućuje na nešto čega u arhivi nema.",
        "reference-cycle": "Oštećen red — zapisi u arhivi upućuju jedni na druge u krug.",
        "missing-ydoc": "Oštećen red — belešci u arhivi nedostaje sadržaj.",
        "invalid-ydoc": "Oštećen red — sadržaj beleške u arhivi nije ispravan.",
        "settings-not-imported":
          "Podešavanja iz arhive se ne uvoze — moduli i obaveštenja ostaju onako kako si ih ti podesio.",
        "notifications-not-imported":
          "Zabeležena obaveštenja se ne uvoze — taj spisak pripada profilu u kom je nastao.",
        "dashboard-settings-not-imported":
          "Pozadina kontrolne table se ne uvozi — izgled tvoje table ostaje tvoj.",
        "dashboard-sets-not-imported":
          "Imenovane table iz arhive se ne uvoze — tvoje table ostaju tvoje.",
        "dashboard-widgets-not-imported":
          "Raspored kontrolne table se ne uvozi — tvoja tabla ostaje kakva jeste.",
        "study-settings-not-imported":
          "Podešavanja učenja iz arhive se ne uvoze — tvoja ciljana zapamćenost i dnevni limiti ostaju tvoji.",
        "calendar-settings-not-imported":
          "Datumi semestra iz arhive se ne uvoze — tvoj kalendar ostaje na tvom rasporedu.",
        "profile-picture-not-imported":
          "Slika profila iz arhive se ne uvozi — tvoja slika ostaje tvoja.",
        // ADR-057 §6: privatne beleške se nikada ne uvoze — tuđe otključane
        // tajne se ne zapečaćuju pod tvojim ključem.
        "private-notes-not-imported":
          "Privatne beleške iz arhive se ne uvoze — privatna sekcija je lična i ne prenosi se u tuđ profil.",
        "template-name-taken": "Šablon istog imena već postoji kod tebe — tvoj se zadržava.",
        "source-inbox-collapsed":
          "Podrazumevana lista iz arhive se ne pravi ponovo — njeni zadaci ulaze u tvoju podrazumevanu listu.",
        "duplicate-of-existing": "Već postoji kod tebe — preskočeno po tvom izboru.",
        // Migration 051: sudar je oko MESTA (kategorija + valuta), ne oko
        // imena, pa mu treba sopstvena rečenica.
        "budget-slot-taken":
          "Za tu kategoriju već imaš budžet u toj valuti — tvoj iznos ostaje.",
      } satisfies Record<ImportSkipCode, string>,
      /**
       * „Već postoji kod tebe“ (ADR-051 / IMEX-008) — the choice rows above the
       * skip list. One row per duplicate group the plan detected, each naming
       * what the group is, how many rows it covers, and — the part that makes
       * the choice answerable — WHAT „isto“ means for it, in words.
       *
       * The heading is a statement of fact, not a warning: nothing is wrong, the
       * archive simply overlaps with what this profile already has, and the user
       * decides which way that goes.
       */
      duplicatesTitle: "Već postoji kod tebe",
      duplicatesCaption:
        "Ovo iz arhive poklapa se sa nečim što već imaš. Podrazumevano se preskače. Ako ti ipak treba, uvozi se kao zaseban, nov zapis — ono što već imaš se ni u jednom slučaju ne menja.",
      /**
       * What each group IS, in the module's own word („Ljudi“ is the panel
       * CAL-007 calls it, „Prilozi“ the one every attachment block calls it), and
       * what „isto“ means for it. Two closed maps over the wire's own
       * `ImportDuplicateType`, so a group added in `shared/ipc.ts` is a compile
       * error here rather than a row the screen cannot label — which for a row
       * that asks the user a question would be the worst possible gap.
       */
      duplicateLabels: {
        event: "Događaji",
        person: "Ljudi",
        document: "Dokumenti",
        attachment: "Prilozi",
      } satisfies Record<ImportDuplicateType, string>,
      duplicateIdentities: {
        event: "isti naslov i vreme",
        person: "isto ime i datum",
        document: "ista vrsta i naziv",
        // One group for all three attachment tables: the identity is the file.
        attachment: "ista datoteka",
      } satisfies Record<ImportDuplicateType, string>,
      /** The two-state control. „Uvezi svejedno“ says out loud that this is the deliberate choice, not the ordinary one. */
      duplicateSkipButton: "Preskoči",
      duplicateImportButton: "Uvezi svejedno",
      /** The group's accessible name, since the two buttons alone do not say what they are answering. */
      duplicateChoiceLabel: "Šta sa poklapanjima",
      /** A rejected re-plan; the preview on screen stays valid, so this invites a retry rather than starting over. */
      duplicateError: "Izbor nije mogao da se primeni. Pokušaj ponovo.",
      /**
       * The corrupt-blob line's closing clause only: the count, its numeral
       * agreement and the „Arhiva sadrži“ opening are the restore's, and only
       * the verb differs — those files are not RETURNED here, they are not
       * imported.
       */
      corruptBlobsSuffix: "sa oštećenim sadržajem — te datoteke neće biti uvezene.",
      applyButton: "Uvezi",
      applying: "Uvoz u toku…",
      applied: "Podaci su uvezeni. Aplikacija se osvežava…",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "Uvoz nije uspeo. Pokušaj ponovo.",
      /** The post-reload banner (App.tsx) when the undo slot holds an IMPORT — the button, the dismiss label and the error line are the restore's, since undoing is one mechanism. */
      undoBanner: "Podaci su uvezeni iz arhive.",
    },
    /**
     * Uvoz iz Anki (.apkg) — ADR-052 / STUDY-011, the block beside „Uvoz iz
     * arhive" and deliberately its sibling in shape: pick → choose → preview →
     * confirm, the same undo banner afterwards. What differs is what it is
     * reading and therefore what it has to be honest about.
     *
     * The copy's whole job is that honesty. An Anki deck carries things this
     * app does not model — media files, SM-2 review history, Anki tags, custom
     * card templates — and the description says so BEFORE the user picks a file
     * rather than leaving them to notice afterwards. `skips` then names, one
     * counted line at a time, exactly what did not make it out of THIS deck.
     *
     * Everything the flow shares with its two siblings — „Izabrano:", „Otkaži",
     * the preview-running line — is read straight off `strings.settings.restore`
     * by the component, exactly as the import block reads it, because a second
     * spelling of one sentence is a sentence that will drift.
     *
     * `unreadable` and `skips` are typed against the wire's own closed domains,
     * so a code added in `shared/ipc.ts` is a compile error here rather than a
     * silently missing sentence in the one screen that has to be honest.
     */
    apkgImport: {
      title: "Uvoz iz Anki (.apkg)",
      description:
        "Uvezi Anki špil kao Nexus kartice. Špilovi ulaze u oblast koju izabereš, a ništa što već imaš se ne menja. Kartice kreću kao nove: istorija učenja, slike, zvuk i Anki oznake se ne prenose — sve što ne stigne piše, komad po komad, u pregledu pre uvoza. Uvoz možeš opozvati jednim klikom, ali samo dok ne zaključaš ili ne zatvoriš aplikaciju.",
      pickButton: "Izaberi .apkg fajl…",
      /** The subject picker — the one decision only the user can make, since an .apkg has no subject of its own. */
      subjectLabel: "Oblast za uvezene špilove",
      /** The „make one" option, first in the list because a first Anki import usually has nowhere to land yet. */
      newSubjectOption: "Nova oblast…",
      newSubjectLabel: "Naziv nove oblasti",
      newSubjectPlaceholder: "npr. Anatomija",
      previewButton: "Prikaži pregled",
      previewRunning: "Čitanje špila…",
      /** Preview header: what the file holds, and where it is going. */
      subjectPrefix: "Oblast:",
      subjectNewSuffix: "— biće napravljena",
      columnSource: "U špilu",
      columnPlanned: "Uvozi se",
      rowDecks: "Špilovi",
      rowNotes: "Beleške",
      rowCards: "Kartice",
      skipsTitle: "Šta se ne uvozi",
      /**
       * One sentence per `ApkgImportSkipCode`, each saying what was lost and —
       * where it is not obvious — why this app cannot carry it. The wording
       * never blames the user's deck for a difference between two programs.
       */
      skips: {
        "unknown-notetype":
          "Beleška koristi tip kartice koji špil ne opisuje ili koji ova verzija ne ume da pročita — bez njega se ne zna šta je pitanje, a šta odgovor.",
        "unknown-deck": "Kartica pripada špilu kog u fajlu nema.",
        "empty-note": "Beleška nema teksta na prednjoj strani.",
        "empty-deck": "Prazan špil se ne pravi — u njemu nije ostala nijedna kartica.",
        "template-unsupported":
          "Anki šablon koji ova verzija ne ume da prikaže — uvoze se osnovna i obrnuta kartica.",
        "cloze-nested": "Praznina unutar praznine — takva beleška se ne može zapisati.",
        "cloze-no-deletions": "Beleška je „cloze“, a nema nijednu prazninu.",
        "cloze-unrepresentable":
          "Praznine u belešci se ne mogu tačno zapisati u Nexus obliku, pa se beleška preskače u celini — pogrešno postavljena praznina bila bi gora od nijedne.",
        "cloze-hint-dropped": "Nagoveštaj uz prazninu se ne prenosi — ostaje sama praznina.",
        "extra-fields-dropped":
          "Dodatna polja beleške se ne prenose — kartica ima prednju i zadnju stranu.",
        "media-stripped": "Slike i zvuk se ne prenose; kartice stižu kao čist tekst.",
        "tags-dropped": "Anki oznake se ne prenose.",
        "history-dropped":
          "Istorija učenja se ne prenosi — kartice kreću kao nove. Odložene i sakrivene kartice stižu na isti način.",
        "card-without-note": "Kartica upućuje na belešku koje u špilu nema.",
      } satisfies Record<ApkgImportSkipCode, string>,
      /** One sentence per `ApkgReadErrorCode`: the file could not be read at all. */
      unreadable: {
        "not-an-apkg": "Ovaj fajl nije Anki špil.",
        "no-collection": "U ovom fajlu nema Anki kolekcije — nije .apkg špil.",
        "unsupported-schema":
          "Špil je u verziji Anki baze koju ova verzija ne čita — verovatno je iz novijeg Ankija. Čitaju se i najnoviji format i izvoz sa opcijom „Support older Anki versions“, pa špil izvezi ponovo iz Ankija i pokušaj opet.",
        "zstd-unavailable": "Ovo izdanje ne može da otvori zstd sažimanje koje ovaj špil koristi.",
        damaged: "Špil je oštećen i ne može se pročitati.",
        "too-large": "Špil prelazi bezbednosna ograničenja i zato je odbijen.",
      } satisfies Record<ApkgReadErrorCode, string>,
      applyButton: "Uvezi",
      applying: "Uvoz u toku…",
      applied: "Kartice su uvezene. Aplikacija se osvežava…",
      /** A rejected pick/preview call (not one of the typed statuses above). */
      readError: "Čitanje špila nije uspelo. Pokušaj ponovo.",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "Uvoz nije uspeo. Pokušaj ponovo.",
      /** `{ status: "no-file" }`: main no longer holds the pick this screen was showing. */
      noFileError: "Špil više nije izabran. Izaberi ga ponovo.",
      /** Shown when the deck translates to nothing at all — the „Uvezi" button is hidden, because there is nothing to confirm. */
      nothingToImport: "Iz ovog špila nema šta da se uvede — razlozi su izlistani iznad.",
      /** The post-reload banner (App.tsx) when the undo slot holds an Anki import. */
      undoBanner: "Kartice su uvezene iz Anki špila.",
    },
    /**
     * Uvoz zadataka (.csv) — ADR-062, the block beside „Uvoz iz Anki" and its
     * sibling in shape, one step longer: pick → MAP → preview → confirm, the
     * same undo banner afterwards. The extra step is the one thing a CSV
     * cannot answer for itself — it has no fixed schema — so the mapping
     * dialog asks the user which column is which, with the header table's own
     * SUGGESTION pre-filled, never silently committed.
     *
     * The copy's whole job is the honesty the flow promises: every loss is
     * named per row („Red 12"), the destination is ONE list said out loud, and
     * a mapped „Lista" column's cells are counted as not-carried rather than
     * quietly flattened.
     *
     * Everything shared with the sibling flows — „Izabrano:", „Otkaži" — is
     * read off `strings.settings.restore` by the component, exactly as the
     * `.apkg` block reads it. `roles`, `unreadable` and `drops` are typed
     * against the wire's own closed domains, so a value added in
     * `shared/ipc.ts` is a compile error here rather than a silently missing
     * sentence.
     */
    csvImport: {
      title: "Uvoz zadataka (.csv)",
      description:
        "Uvezi zadatke iz CSV tabele — izvoza iz drugog alata ili ručno vođenog spiska. Ti kažeš koja kolona je šta, svi zadaci ulaze u jednu listu koju izabereš, a ništa što već imaš se ne menja. Sve što ne može da se pročita piše, red po red, u pregledu pre uvoza. Uvoz možeš opozvati jednim klikom, ali samo dok ne zaključaš ili ne zatvoriš aplikaciju.",
      pickButton: "Izaberi .csv fajl…",
      reading: "Čitanje tabele…",
      /** The mapping dialog (SET §, ADR-062): a row per detected column, the two parse toggles, and the destination list. */
      mapTitle: "Mapiranje kolona",
      mapQuestion: "Reci koja kolona je šta — predloženo je već upisano, potvrdi ili promeni.",
      /** How an unnamed column introduces itself when the file has no header row: „Kolona 3". */
      columnFallbackPrefix: "Kolona",
      /** The muted sample line under each header, prefixed so three values do not read as a sentence. */
      samplesLabel: "Primeri:",
      roleLabel: "Uloga kolone",
      /**
       * One option label per `CsvImportColumnRole`. „Lista (ne uvozi se)" says
       * the role's own truth in the select itself: the import cilja jednu
       * listu, so a list column is recognised but its cells are not carried.
       */
      roles: {
        title: "Naziv zadatka",
        description: "Opis",
        dueDate: "Rok",
        priority: "Prioritet",
        status: "Status",
        list: "Lista (ne uvozi se)",
        section: "Sekcija",
        tags: "Oznake",
        ignore: "Ne uvozi se",
      } satisfies Record<CsvImportColumnRole, string>,
      /** Under the column rows: why the confirm button is asleep until exactly one column is the title. */
      titleRequired: "Tačno jedna kolona mora biti Naziv zadatka.",
      delimiterLabel: "Razdvajanje kolona",
      delimiterComma: "Zapeta (,)",
      delimiterSemicolon: "Tačka-zapeta (;)",
      headerLabel: "Prvi red je zaglavlje",
      /** The destination — ONE list for the whole file (ADR-062), existing or named into being. */
      listLabel: "Lista za uvezene zadatke",
      newListOption: "Nova lista…",
      newListLabel: "Naziv nove liste",
      newListPlaceholder: "npr. Uvoz",
      confirmButton: "Prikaži pregled",
      /** A rejected map call; the dialog stays open, so this invites a retry. */
      mapError: "Mapiranje nije moglo da se primeni. Pokušaj ponovo.",
      /** The plan preview under the dialog: where it goes, what arrives, what does not. */
      listPrefix: "Lista:",
      listNewSuffix: "— biće napravljena",
      rowRows: "Redova u tabeli",
      rowTasks: "Uvozi se zadataka",
      /** Rendered only when non-zero: blank spreadsheet lines are not losses, but the arithmetic still says where they went. */
      blankRowsPrefix: "Praznih redova:",
      /** Back to the mapping dialog — the same rows, the same suggestions, a fresh plan on confirm. */
      remapButton: "Izmeni mapiranje",
      dropsTitle: "Šta se ne uvozi",
      /** How a dropped row names itself: „Red 12" — the data row's own number, header excluded, as the spreadsheet shows it. */
      dropRowPrefix: "Red",
      /**
       * One sentence per `CsvImportRowDropCode`. The due-date sentence says the
       * task still arrives — losing the date must never read as losing the row.
       */
      drops: {
        "empty-title": "Nema naziva zadatka — red se preskače.",
        "bad-due-date":
          "Rok nije mogao da se pročita (dvocifrena godina se odbija, ne pogađa se vek) — zadatak se uvozi bez roka.",
      } satisfies Record<CsvImportRowDropCode, string>,
      /** The mapped-„Lista" count line: prefix, then the number, then this suffix. */
      listCellsDroppedPrefix: "Vrednosti kolone „Lista“:",
      listCellsDroppedSuffix:
        "— ne prenose se; svi zadaci ulaze u listu koju si izabrao iznad.",
      /** One sentence per `CsvImportReadErrorCode`: the file could not be turned into columns at all. */
      unreadable: {
        "too-large": "Tabela prelazi bezbednosna ograničenja (5 MB) i zato je odbijena.",
        empty: "U ovom fajlu nema redova sa podacima.",
        "too-many-columns": "Tabela ima previše kolona za mapiranje.",
        unreadable: "Fajl nije mogao da se pročita. Pokušaj ponovo.",
      } satisfies Record<CsvImportReadErrorCode, string>,
      applyButton: "Uvezi",
      applying: "Uvoz u toku…",
      applied: "Zadaci su uvezeni. Aplikacija se osvežava…",
      /** A rejected pick/preview call (not one of the typed statuses above). */
      readError: "Čitanje tabele nije uspelo. Pokušaj ponovo.",
      /** A rejected apply call; the plan itself stays valid, so this invites a retry. */
      error: "Uvoz nije uspeo. Pokušaj ponovo.",
      /** `{ status: "no-file" }`: main no longer holds the pick this screen was showing. */
      noFileError: "Fajl više nije izabran. Izaberi ga ponovo.",
      /** Shown when the mapping translates to nothing at all — the „Uvezi" button is hidden, because there is nothing to confirm. */
      nothingToImport: "Iz ove tabele nema šta da se uveze — razlozi su izlistani iznad.",
      /** The post-reload banner (App.tsx) when the undo slot holds a CSV import. */
      undoBanner: "Zadaci su uvezeni iz CSV tabele.",
    },
    /**
     * Uvoz kalendara (.ics) — ADR-061, the block beside „Uvoz iz Anki" and
     * deliberately its sibling in shape: pick → preview → confirm, the same
     * undo banner afterwards. One step SHORTER than the Anki flow — an `.ics`
     * needs no subject choice, its events land straight in the calendar — so
     * the only question left on the screen is ADR-051's duplicate one, asked
     * with the import block's own „Preskoči / Uvezi svejedno" pair.
     *
     * The copy's whole job is honesty about what a calendar file cannot carry:
     * reminders (alarms are counted and left behind), a repeat rule Nexus does
     * not have (the first occurrence arrives, said per line), and any zone a
     * foreign calendar wrote (times land on THIS računar's clock). `skips` and
     * `unreadable` are typed against the wire's own closed domains, so a code
     * added in `shared/ipc.ts` is a compile error here rather than a silently
     * missing sentence.
     */
    icsImport: {
      title: "Uvoz kalendara (.ics)",
      description:
        "Uvezi događaje iz .ics fajla — iz Google kalendara, Outlooka ili bilo koje druge aplikacije koja ga izveze. Uvoz ništa ne briše: događaji dolaze pored onih koje već imaš. Podsetnici se ne prenose, a vreme zapisano u drugoj vremenskoj zoni preračunava se na sat ovog računara. Sve što ne stigne piše, komad po komad, u pregledu pre uvoza. Uvoz možeš opozvati jednim klikom, ali samo dok ne zaključaš ili ne zatvoriš aplikaciju.",
      pickButton: "Izaberi .ics fajl…",
      previewRunning: "Čitanje kalendara…",
      /** The preview's two columns: what the file holds, and how much of it arrives. */
      columnSource: "U fajlu",
      columnPlanned: "Uvozi se",
      rowEvents: "Događaji",
      skipsTitle: "Šta se ne uvozi",
      /**
       * One sentence per `IcsImportSkipCode`, each saying what was lost and —
       * where it is not obvious — why this app cannot carry it. The wording
       * never blames the user's calendar for a difference between two programs.
       */
      skips: {
        "invalid-start": "Događaj nema ispravan početak (DTSTART), pa se preskače.",
        "unknown-timezone":
          "Događaj navodi vremensku zonu koju ovaj računar ne poznaje, pa se preskače — pogađanje pomeraja pomerilo bi ga za više sati.",
        "empty-summary": "Događaj nema naslov, pa se preskače.",
        "invalid-end": "Kraj događaja nije ispravan — događaj se uvozi bez trajanja.",
        "invalid-exdate": "Izuzeti datum ponavljanja nije ispravan, pa se izostavlja.",
        "recurrence-unmappable":
          "Pravilo ponavljanja ne postoji u Nexusu — uvozi se samo prvi termin, kao jednokratan događaj.",
        "detached-override":
          "Pojedinačno pomeren termin tuđe serije uvozi se kao zaseban, jednokratan događaj.",
        "categories-dropped": "Događaj ima više kategorija — prenosi se prva.",
      } satisfies Record<IcsImportSkipCode, string>,
      /**
       * The lead-in of one component line: „Sadržaj vrste VTODO se ne uvozi —
       * 3“. The NAME between the two halves is the file's own (VTODO, VALARM,
       * X-…), which no closed map could label — and the honest sentence is the
       * same for all of them: Nexus reads events out of a calendar, nothing
       * else.
       */
      componentPrefix: "Sadržaj vrste",
      componentSuffix: "se ne uvozi — Nexus iz kalendara čita samo događaje.",
      /** One sentence per `IcsImportReadErrorCode`: the file could not be read at all. */
      unreadable: {
        "too-large": "Fajl prelazi bezbednosna ograničenja i zato je odbijen.",
        "not-a-calendar": "Ovaj fajl nije iCalendar (.ics) kalendar.",
      } satisfies Record<IcsImportReadErrorCode, string>,
      /**
       * Shown only when the planner recognised events this profile already has
       * (ADR-051). The sentence says which way the plan currently goes, and the
       * choice beside it — the import block's own „Preskoči / Uvezi svejedno"
       * pair, read from `settings.import` so the flows cannot drift — is how
       * the user says otherwise.
       */
      duplicatesPrefix: "Već imaš",
      duplicatesUnitOne: "događaj",
      duplicatesUnitFew: "događaja",
      duplicatesUnitMany: "događaja",
      duplicatesSuffix: "iz ovog fajla — oni se ne uvoze ponovo.",
      /** The same sentence's other ending, once a re-preview said „uvezi svejedno": nothing merges, the rows arrive as new. */
      duplicatesSuffixImported: "iz ovog fajla — ipak se uvoze, kao novi događaji.",
      applyButton: "Uvezi",
      applying: "Uvoz u toku…",
      applied: "Događaji su uvezeni. Aplikacija se osvežava…",
      /** A rejected pick/preview call (not one of the typed statuses above). */
      readError: "Čitanje kalendara nije uspelo. Pokušaj ponovo.",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "Uvoz nije uspeo. Pokušaj ponovo.",
      /** `{ status: "no-file" }`: main no longer holds the pick this screen was showing. */
      noFileError: "Fajl više nije izabran. Izaberi ga ponovo.",
      /** Shown when the file translates to nothing at all — the „Uvezi" button is hidden, because there is nothing to confirm. */
      nothingToImport: "Iz ovog fajla nema šta da se uvede — razlozi su izlistani iznad.",
      /** The post-reload banner (App.tsx) when the undo slot holds an .ics import. */
      undoBanner: "Događaji su uvezeni iz kalendara (.ics).",
    },
    /**
     * Uvoz preko AI asistenta (IMEX-005) — the one block in this card whose
     * „reader" is a person and a chat window.
     *
     * The copy's whole job is to be unambiguous about what Nexus does and does
     * not do: it WRITES an instruction and READS an answer, and it never talks
     * to a model. `description` says that in the first two sentences, because a
     * user who assumed otherwise would be assuming their content leaves the
     * device — the single most important thing this app promises it does not do.
     *
     * The flow is the import block's, one step shorter: choose what → copy the
     * instruction → paste the answer → preview → confirm, with the same shared
     * undo banner afterwards. Everything the three flows have in common — the
     * „Otkaži" button, the undo copy — is read straight off
     * `strings.settings.restore` by the component.
     *
     * `unreadable`, `skips` and `kinds` are typed against the wire's own closed
     * domains, so a code added in `shared/ipc.ts` is a compile error here rather
     * than a silently missing sentence.
     */
    llmImport: {
      title: "Uvoz preko AI asistenta",
      description:
        "Nexus ti napiše uputstvo, ti ga zajedno sa svojim tekstom nalepiš u razgovor sa svojim AI asistentom (ChatGPT, Claude, Gemini…), a odgovor koji dobiješ vratiš ovde. Nexus ni sa jednim modelom ne razgovara: ništa sa ovog uređaja ne odlazi nigde samo od sebe — ti biraš šta ćeš i gde nalepiti. Uvoz ništa ne briše i možeš ga opozvati jednim klikom, ali samo dok ne zaključaš ili ne zatvoriš aplikaciju.",
      /** Step 1 — what is being imported. The three kinds the app can build a row from with no further decision. */
      kindLabel: "Šta uvoziš",
      kinds: {
        tasks: "Zadatke",
        events: "Događaje",
        cards: "Kartice",
      } satisfies Record<LlmImportKind, string>,
      /** The same three, lowercase, for the middle of a sentence — `kinds` is written for a picker option, which is a different place in a different case. */
      kindsInline: {
        tasks: "zadatke",
        events: "događaje",
        cards: "kartice za učenje",
      } satisfies Record<LlmImportKind, string>,
      /** The prompt's own language — not the content's; the instruction tells the assistant to keep that. */
      languageLabel: "Jezik uputstva",
      languages: {
        sr: "Srpski",
        en: "Engleski",
      } satisfies Record<LlmPromptLanguage, string>,
      /** Step 2 — the clipboard button and the sentence that says what to do with what it copied. */
      copyButton: "Kopiraj uputstvo",
      copied: "Uputstvo je kopirano",
      copyError: "Kopiranje nije uspelo. Uputstvo možeš označiti i kopirati ručno iz polja ispod.",
      copyHint:
        "Nalepi uputstvo u razgovor sa asistentom, a ispod njega svoj tekst. Odgovor koji dobiješ vrati u polje ispod.",
      /** The prompt itself, shown so „Kopiraj" is never a black box — and so a failed clipboard write still leaves a way through. */
      promptLabel: "Uputstvo",
      promptShow: "Prikaži uputstvo",
      promptHide: "Sakrij uputstvo",
      /** Step 3 — the answer. */
      answerLabel: "Odgovor asistenta",
      answerPlaceholder: "Nalepi ovde ono što ti je asistent odgovorio…",
      /** The deck choice, shown only for cards: an odgovor iz ćaskanja names no deck, and a Nexus card lives in one. Two paths — a deck the profile already has, or one this import creates. */
      deckChoiceLabel: "Gde ulaze kartice",
      deckExistingOption: "Postojeći špil",
      deckNewOption: "Novi špil",
      deckLabel: "Špil za uvezene kartice",
      deckPlaceholder: "Izaberi špil",
      /** The new-deck form: a name, and the subject the deck lives under — a špil cannot exist outside an oblast. */
      newDeckLabel: "Naziv novog špila",
      newDeckPlaceholder: "npr. Ćelija",
      newDeckSubjectLabel: "Oblast za novi špil",
      newDeckSubjectPlaceholder: "Izaberi oblast",
      /** Shown under „Postojeći špil" when the profile has none — the way out is the other path, one click away. */
      noDecks: "Još nemaš nijedan špil — izaberi „Novi špil“ da ga napraviš ovde.",
      /** Shown instead of the whole deck choice when the profile has no subject at all — an honest dead end with the way out named, because a new deck needs an oblast to live in. */
      noSubjects:
        "Još nemaš nijednu oblast. Napravi je na stranici Učenje, pa se vrati ovde — svaki špil živi u jednoj oblasti.",
      previewButton: "Pregledaj",
      previewRunning: "Čitanje odgovora…",
      /** The preview's three numbers, which answer three different questions. */
      rowRecords: "Zapisa u odgovoru",
      rowAccepted: "Pročitano",
      rowPlanned: "Uvozi se",
      /** Said under the table, because „Uvozi se" being larger than „Pročitano" surprises anyone who has not met cloze cards. */
      cardsCaption:
        "Jedna rečenica sa više praznina postaje više kartica — po jedna za svaku prazninu.",
      /**
       * Shown only when the planner recognised events this profile already has
       * (ADR-051). The sentence says which way the plan currently goes, and the
       * choice beside it — the import block's own „Preskoči / Uvezi svejedno"
       * pair, read from `settings.import` so the two flows cannot drift — is
       * how the user says otherwise.
       */
      duplicatesPrefix: "Već imaš",
      duplicatesUnitOne: "događaj",
      duplicatesUnitFew: "događaja",
      duplicatesUnitMany: "događaja",
      duplicatesSuffix: "iz ovog odgovora — oni se ne uvoze ponovo.",
      /** The same sentence's other ending, once a re-plan said „uvezi svejedno": nothing merges, the rows arrive as new. */
      duplicatesSuffixImported: "iz ovog odgovora — ipak se uvoze, kao novi događaji.",
      /** Shown only when unknown keys were dropped, so „uvezeno je manje polja nego što sam video" is never a surprise. */
      droppedPrefix: "Odbačeno je",
      droppedUnitOne: "polje",
      droppedUnitFew: "polja",
      droppedUnitMany: "polja",
      droppedSuffix: "koje Nexus ne poznaje.",
      skipsTitle: "Šta se ne uvozi",
      /** How a skipped record names itself: „Zapis 3" — the answer's own position, so the user can find it in their chat. */
      skipRecordPrefix: "Zapis",
      /**
       * One sentence per `LlmImportSkipReason`. Each says what was wrong with
       * that one record and — where it helps — what to ask for instead. The
       * wording never blames the user for what a model wrote.
       */
      skips: {
        "not-an-object": "Nije zapis — na tom mestu u odgovoru stoji nešto drugo.",
        "missing-field": "Nedostaje obavezno polje.",
        "invalid-field": "Polje nije u traženom obliku (pogrešan datum, vreme ili vrednost van spiska).",
        "text-too-long": "Tekst polja je predugačak.",
        "unknown-card-shape":
          "Kartica nije ni par pitanje/odgovor ni rečenica sa prazninama — mora biti tačno jedno od to dvoje.",
        "no-cloze-deletion": "Rečenica nema nijednu prazninu u {{dvostrukim vitičastim zagradama}}.",
        "over-record-cap": "Preko granice od 500 zapisa po odgovoru.",
      } satisfies Record<LlmImportSkipReason, string>,
      /**
       * One sentence per `LlmImportAnswerProblem`: the paste could not be read
       * at all. Each ends with what to do next, because every one of these is
       * fixed in the chat window rather than here.
       */
      unreadable: {
        empty: "Nisi nalepio nikakav odgovor.",
        "too-long": "Odgovor je prevelik. Podeli tekst na manje delove i uvezi ih redom.",
        "no-json":
          "U odgovoru nema JSON-a. Asistent je verovatno odgovorio rečenicom — zamoli ga da odgovori isključivo JSON-om, tačno kao u uputstvu.",
        "not-json":
          "Ono što je asistent poslao nije ispravan JSON (najčešće zarez posle poslednjeg elementa). Zamoli ga da pošalje isti odgovor kao ispravan JSON.",
        "not-an-envelope":
          "Ovo nije odgovor u obliku koji uputstvo traži. Proveri da si nalepio ceo odgovor, sa „nexus-llm“ na početku.",
        "unsupported-version":
          "Odgovor je u obliku koji ova verzija Nexusa ne čita. Kopiraj uputstvo ponovo i pitaj iznova.",
        "unknown-kind": "Odgovor navodi vrstu zapisa koju Nexus ne poznaje.",
      } satisfies Record<LlmImportAnswerProblem, string>,
      /** The answer was readable, but for a different kind than the picker says — fixed by changing the picker, not the chat. */
      kindMismatchPrefix: "Ovaj odgovor sadrži",
      kindMismatchSuffix: "— a ti si izabrao drugu vrstu. Promeni izbor iznad ili pitaj ponovo.",
      applyButton: "Uvezi",
      applying: "Uvoz u toku…",
      applied: "Podaci su uvezeni. Aplikacija se osvežava…",
      /** Shown when nothing at all survived the read — the „Uvezi" button is hidden, because there is nothing to confirm. */
      nothingToImport: "Iz ovog odgovora nema šta da se uvede — razlozi su izlistani iznad.",
      /** A rejected preview call (not one of the typed statuses above). */
      readError: "Čitanje odgovora nije uspelo. Pokušaj ponovo.",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "Uvoz nije uspeo. Pokušaj ponovo.",
      /** The post-reload banner (App.tsx) when the undo slot holds an LLM import. */
      undoBanner: "Podaci su uvezeni preko AI asistenta.",
    },
    /**
     * Uvoz beležaka (.md) — IMEX-007's markdown slice, the quiet fourth block
     * of the „Rezervna kopija" card. Not an archive flow and worded so nobody
     * mistakes it for one: no preview, no undo banner, no passphrase — files
     * in, notes out, and the result line says exactly what landed.
     *
     * Two buttons rather than one because the native dialog cannot be both a
     * file picker and a folder picker on Windows (see `markdownImport.ts`), and
     * the copy names that plainly instead of hiding it behind one word.
     *
     * `skips` is typed against the wire's own closed `MarkdownImportSkipCode`
     * domain, so a code added in `shared/ipc.ts` is a compile error here rather
     * than a file that silently did not arrive.
     */
    markdownImport: {
      title: "Uvoz beležaka (.md)",
      description:
        "Uvezi Markdown fajlove kao beleške — svaki fajl postaje jedna beleška u izabranoj fascikli. Naslov je prvi „# “ iz fajla, a ako ga nema, ime samog fajla. Slike se ne prenose: ostaju kao tekst sa svojom putanjom.",
      folderLabel: "Fascikla za uvezene beleške",
      /** The unfiled root — the same place a note created from the notes page lands. */
      rootOption: "Bez fascikle",
      filesButton: "Izaberi .md fajlove…",
      folderButton: "Izaberi fasciklu…",
      /** Said beside the folder button, because a folder pick reaches into subfolders and that must not be a surprise. */
      folderHint: "Fascikla se čita zajedno sa podfasciklama; sve beleške ulaze u izabranu fasciklu.",
      running: "Uvoz u toku…",
      /** „Uvezeno 3 beleške" — full Serbian numeral agreement via `countUnit`. */
      createdPrefix: "Uvezeno",
      createdUnitOne: "beleška",
      createdUnitFew: "beleške",
      createdUnitMany: "beležaka",
      /** Shown when the pick produced nothing at all — no file in it could become a note. */
      createdNone: "Nijedna beleška nije uvezena.",
      /** Shown only when `imagesAsText > 0`: the slice imports no files, and the user hears it here rather than discovering it in a note. */
      imagesPrefix: "Slike nisu prenete:",
      imagesUnitOne: "slika je ostala",
      imagesUnitFew: "slike su ostale",
      imagesUnitMany: "slika je ostalo",
      imagesSuffix: "kao tekst sa putanjom.",
      skipsTitle: "Šta nije uvezeno",
      skips: {
        "too-large": "Fajl je veći od 1 MB.",
        "too-long": "Sadržaj fajla je preveliki za jednu belešku.",
        unreadable: "Fajl se ne može pročitati.",
        empty: "Fajl je prazan.",
        "too-many": "Uvozi se najviše 200 fajlova odjednom — ovaj i svi posle njega su preskočeni.",
        "not-markdown": "Nije Markdown fajl (.md ili .markdown).",
      } satisfies Record<MarkdownImportSkipCode, string>,
      error: "Uvoz beležaka nije uspeo. Pokušaj ponovo.",
    },
    /**
     * „Podaci i privatnost“ (SET-010, local half): five plain sentences, each
     * one a fact about how this build is put together rather than a promise.
     *
     * The five sentences have deliberately nothing to operate — no toggle, no
     * link, no „saznaj više“. A privacy panel with a switch on it is a panel
     * about a setting; those are about what is already true, and every
     * sentence is checkable in the source:
     *
     *  - `storage`   — `packages/db/src/database.ts` opens every profile
     *                  database through SQLCipher (`PRAGMA cipher`/`key`), and
     *                  `main/auth.ts` unwraps that key from the passcode
     *                  (Argon2id → AES-GCM, ADR-018).
     *  - `noTelemetry` — there is no telemetry or analytics dependency, and no
     *                  such code, anywhere in the tree.
     *  - `offline`   — `apps/desktop/src` contains no `fetch`, `XMLHttpRequest`,
     *                  `WebSocket` or remote URL at all, and the packaged
     *                  renderer's CSP is `default-src 'self'; connect-src
     *                  'self'`. The ONE exception is named out loud rather than
     *                  papered over: the packaged build asks its release feed
     *                  whether a newer Nexus exists (`checkForUpdates`,
     *                  SEC-EL-07), which carries none of the user's data.
     *  - `exports`   — `main/imex.ts` writes to a path chosen in the system
     *                  save dialog, sealed under a passphrase-derived key when
     *                  one is given (ADR-022).
     *  - `deletion`  — `main/accounts.ts`'s `deleteAccount` erases the
     *                  account's directory, key chain included; there is no
     *                  undo and no grace period.
     *
     * The ONE thing to operate is `searchHistory` (SRCH-009), and it belongs
     * here rather than anywhere else: it is the only place in the app where
     * something is stored *about how you used it* instead of *what you made*,
     * so the card that lists what is stored is where a user goes to erase it.
     * Search is a SHELL surface, not a module (no manifest, no gallery row, no
     * flag), so its control is hand-composed on this page — never routed
     * through the per-module settings contract, which is for modules and says
     * so in as many words.
     */
    privacy: {
      storage:
        "Svi tvoji podaci — beleške, zadaci, događaji, kartice i prilozi — stoje na ovom uređaju, u bazi koja je šifrovana. Ključ se otključava tvojim pristupnim kodom i nigde se ne šalje.",
      noTelemetry:
        "Nexus ne prikuplja telemetriju ni analitiku. Nema brojača, nema izveštaja o korišćenju, nema profilisanja.",
      offline:
        "Tvoj sadržaj se nikada ne šalje na mrežu i aplikacija radi bez interneta. Jedino što izlazi napolje jeste provera da li postoji novija verzija Nexusa — ona ne nosi ništa od tvojih podataka.",
      exports:
        "Izvoz je običan fajl: ti biraš gde se čuva, a arhivu možeš zaštititi lozinkom pri pravljenju.",
      deletion:
        "Brisanje naloga trajno uništava njegove podatke, zajedno sa ključem kojim su šifrovani. Nema opoziva i nema perioda čekanja.",
      /**
       * SRCH-009. The caption states the three facts a user would otherwise
       * have to trust: what is kept, where it stays, and that it never rides
       * in an izvoz — each one true of migration 050 by construction, not by
       * a filter somebody remembered to write.
       */
      searchHistory: {
        title: "Istorija pretrage",
        caption:
          "Nexus pamti poslednjih 20 pretraga ovog profila, da bi mogao brzo da ih ponoviš. Ostaju u šifrovanoj bazi na ovom uređaju, ne prelaze u drugi profil i ne ulaze u izvoz ni u rezervnu kopiju.",
        clear: "Obriši istoriju pretrage",
        /** Below the button: how many entries are there right now, or that there are none. */
        empty: "Nema sačuvanih pretraga.",
        countOne: "sačuvana pretraga",
        countFew: "sačuvane pretrage",
        countMany: "sačuvanih pretraga",
        error: "Brisanje istorije pretrage nije uspelo. Pokušaj ponovo.",
      },
    },
    about: {
      version: "Verzija",
      electron: "Electron",
      chromium: "Chromium",
      node: "Node",
      dataLocation: "Lokacija podataka",
    },
  },

  /** Global search palette (021-d / ADR-021): nav label, the input
   *  placeholder, kind labels (singular for a result row's own kind
   *  tag; plural for both the filter chips and the per-kind group headings),
   *  the two non-kind group headings, the key-hint footer, the empty-result
   *  line, and the local command labels `searchCommands.ts` matches against.
   *  The sidebar's shortcut badge is deliberately NOT copy: it renders the
   *  live palette binding through `formatChord` (ADR-040), so a remap is
   *  reflected there instead of a printed "Ctrl+K" going quietly stale. */
  search: {
    navLabel: "Pretraga",
    placeholder: "Pretraži zadatke, beleške, događaje…",
    kindFilterLabel: "Filter po vrsti",
    recentGroup: "Nedavno",
    commandsGroup: "Komande",
    emptyResults: "Nema rezultata.",
    hint: "↑↓ kretanje · Enter otvori · Esc zatvori",
    /**
     * SRCH-009: the profile's remembered QUERIES, which are a different list
     * from „Nedavno" above — that one shows what you opened, this one what you
     * looked for. The heading says „pretrage" precisely so the two groups can
     * never be read as one.
     */
    historyGroup: "Nedavne pretrage",
    /** The „×" on a history row — a label, since the glyph alone says nothing to a screen reader. */
    historyRemove: "Ukloni iz istorije",
    /**
     * Replaces the key hints while a history row is the active one: Enter
     * FILLS the box here instead of opening something (the query must be
     * visible before it runs — no surface may silently execute a search the
     * user cannot see), and Delete forgets the row.
     */
    historyHint: "↑↓ kretanje · Enter popuni · Delete ukloni · Esc zatvori",
    /**
     * The operator grammar, named quietly in the footer beside the key hints —
     * `#oznaka` filters by tag (zadaci i beleške), `rok:`/`due:` by date. The
     * values are the closed set `parseSearchQuery` accepts, written out rather
     * than abbreviated so the line teaches the whole grammar at a glance.
     */
    operatorHint: "#oznaka · rok:danas / sutra / nedelja / 2026-08-15",
    /** The palette's bottom row, which hands the current query to the full page (ADR-039 §5). */
    showAllResults: "Prikaži sve rezultate",
    /**
     * Marks a result whose match landed inside an attached file's CONTENTS
     * rather than in anything the row shows (SRCH-008). Without it the row
     * would appear to match nothing at all — the one thing a result must never
     * do. Deliberately says „u sadržaju priloga", not „u prilogu": the file's
     * NAME is already searchable and already highlights, so what this reports
     * is specifically the text inside it.
     */
    fromAttachment: "poklapanje u sadržaju priloga",
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
      newTransaction: "Nova transakcija",
      /**
       * ADR-049: one command per task view, between the quick-creates and the
       * shell actions. Prefixed with the module rather than „Idi na“, because
       * it lands on a VIEW inside Zadaci, not on the module's front door.
       */
      smartListPrefix: "Zadaci: ",
      lock: "Zaključaj aplikaciju",
      rebuildIndex: "Ponovo izgradi indeks pretrage",
      rebuildDonePrefix: "Indeks je ponovo izgrađen:",
      rebuildRecordsUnitOne: "zapis",
      rebuildRecordsUnitMany: "zapisa",
      rebuildError: "Ponovno izgrađivanje indeksa nije uspelo.",
    },
    /**
     * The full search page (ADR-039): its header and the two facet rows. The
     * page reuses the palette's `placeholder`, `kindSingular`/`kindPlural`
     * and `emptyResults` above rather than restating them — the two surfaces
     * mean the same things and must read the same way.
     */
    page: {
      title: "Pretraga",
      /** Follows the LIVE palette chord the page renders before it (ADR-040) — never a printed "Ctrl+K". */
      shortcutHint: "otvara brzu pretragu",
      /** Names the query grammar, the way the palette's footer does — including `rok:`, which the page inherits from ADR-030 unchanged. */
      grammarHint: "z: b: d: filtriraju po vrsti · #oznaka · rok:danas / sutra / nedelja / 2026-08-15",
      allKinds: "Sve",
      tagFilterLabel: "Filter po oznaci",
      browseHeading: "Nedavno",
      /** Tooltip on the date column when it falls back to the entry's last edit. */
      updatedLabel: "Poslednja izmena",
      resultsUnitOne: "rezultat",
      resultsUnitMany: "rezultata",
      /** Shown instead of an exact count once candidate sourcing hit its bound. */
      truncatedNote: "Prikazano je prvih 500 rezultata — suzite pretragu za precizniji spisak.",
      showMore: "Prikaži još",
      emptyTitle: "Nema rezultata",
      emptyDescription: "Probajte drugu reč ili uklonite neki filter.",
    },
  },

  /**
   * „Pregledaj" — the in-app attachment preview dialog (DOC / ADR-064), one
   * component shared by the three attachment surfaces: an image lightbox, an
   * escaped text pane, or a read-only markdown render. The menu item's word
   * lives with each surface's own strings; the PDF window needs no copy at all
   * (its title is the stored file name and its chrome is Chromium's own).
   */
  attachmentPreview: {
    close: "Zatvori",
    error: "Pregled priloga nije uspeo. Pokušaj ponovo.",
  },

  /**
   * Keyboard shortcuts (ADR-040 / SET-013): the Settings card that remaps the
   * core set, and the reference overlay that documents every key in the app.
   *
   * `actions` names the five remappable actions. „Zaključaj aplikaciju"
   * deliberately reads the same as the palette command above: they are the same
   * action reached two ways, and one of them saying something else would be a
   * lie about what the chord does.
   *
   * `reference` is documentation, so the rule is simple: a context that adds a
   * key adds a row here, or the reference is wrong. Descriptions name what the
   * key does, never where the key lives — the group heading already says that.
   */
  shortcuts: {
    cardCaption:
      "Prečice se pamte na ovom uređaju — ne putuju uz profil ni uz rezervnu kopiju.",
    showAll: "Prikaži sve prečice",
    change: "Promeni",
    reset: "Vrati",
    resetAll: "Vrati sve",
    capturePrompt: "Pritisni novu kombinaciju…",
    captureHint: "Esc otkazuje.",
    /** Refusal shown when the captured combination is something typing could produce. */
    refuseUnbindable: "Kombinacija mora da drži Ctrl ili Alt, ili da bude taster F1–F12.",
    /** Refusal for the GLOBAL row only: the OS binds a physical key, so punctuation and layout-specific characters cannot be registered. */
    refuseGlobal:
      "Globalna prečica mora da drži Ctrl ili Alt i da koristi slovo, cifru ili taster F1–F12.",
    /** Prefixes the name of whatever already holds the captured combination. */
    takenPrefix: "Zauzeto: ",
    /** Caption under the global row — what „globalna" actually means. */
    globalHint: "Radi i kada Nexus nije u prvom planu.",
    /** The one runtime failure a global registration has: another application already holds the combination. */
    globalTaken: "Prečica je zauzeta na nivou sistema.",
    actions: {
      palette: "Komandna paleta",
      quickCreate: "Novi unos u aktivnom modulu",
      globalCapture: "Brzi unos zadatka — globalna prečica",
      lock: "Zaključaj aplikaciju",
      privLock: "Zaključaj privatne beleške",
      settings: "Otvori Podešavanja",
      shortcutsHelp: "Prikaži prečice",
    },
    dialogTitle: "Prečice na tastaturi",
    dialogClose: "Zatvori",
    groups: {
      global: "Globalno",
      modules: "Moduli",
      palette: "Paleta",
      tasks: "Zadaci",
      calendar: "Kalendar",
      study: "Učenje",
      notes: "Beleške",
      notesFind: "Pretraga u belešci",
    },
    /** The reserved Ctrl+1…Ctrl+9 family: positional, so it is described rather than named. */
    moduleNavLabel: "Prelazak na modul po redosledu",
    moduleNavCaption: "Redosled je isti kao u bočnoj traci; važi za prvih devet modula.",
    captions: {
      calendar: "Dok je mreža kalendara u fokusu.",
      study: "Tokom učenja kartica.",
      notes: "Na početku reda u editoru beleški.",
      /** The find bar's keys work anywhere in the note, unlike the markdown shortcuts above them — hence a group of its own. */
      notesFind: "Dok je otvorena beleška; pretražuje samo nju.",
    },
    reference: {
      paletteMove: "Kretanje kroz rezultate",
      paletteOpen: "Otvori rezultat ili pokreni komandu",
      paletteClose: "Zatvori paletu",
      tasksSubtask: "Dodaj podzadatak iz reda za unos",
      tasksCancel: "Otkaži unos u redu ili zatvori pitanje",
      tasksExitSelection: "Izađi iz režima Izbor",
      calendarShift: "Prethodni ili sledeći period",
      calendarToday: "Vrati se na danas",
      studyReveal: "Prikaži odgovor",
      studyGrade: "Oceni karticu — Ponovo, Teško, Dobro, Lako",
      studyUndo: "Opozovi poslednju ocenu",
      studyExit: "Izađi iz učenja",
      notesHeading: "Naslov 1, 2 ili 3",
      notesBulletList: "Lista",
      notesOrderedList: "Numerisana lista",
      notesBlockquote: "Citat",
      notesCodeBlock: "Blok koda",
      notesSlash: "Meni komandi za blokove",
      notesLink: "Veza ka drugoj belešci",
      /** Mod-Shift-C in the note editor (ADR-068): the number is assigned, never typed. */
      notesCloze: "Napravi prazninu od izabranog teksta",
      notesHistory: "Opozovi i ponovi izmenu",
      notesFindOpen: "Otvori traku za pretragu u belešci",
      notesFindStep: "Sledeći ili prethodni rezultat",
      notesFindClose: "Zatvori traku i vrati kursor na rezultat",
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

/**
 * Full Serbian numeral agreement — the three forms `dayUnit` deliberately does
 * not model: 1 (and 21, 31, …) takes `one`, 2–4 (and 22–24, …) take `few`, and
 * everything else takes `many`; the teens 11–14 are the exception that takes
 * `many` at every one of them.
 *
 * `dayUnit` gets away with two forms because "dan"/"dana" happen to collapse
 * there. A counted noun that does not collapse — "3 praznine" beside "5
 * praznina" — needs this. Only ever applied to a count the app itself computed
 * (see the `recurrence` note above on why a freely typed number keeps its
 * labelled-field phrasing instead).
 */
export function countUnit(count: number, one: string, few: string, many: string): string {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  const last = count % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

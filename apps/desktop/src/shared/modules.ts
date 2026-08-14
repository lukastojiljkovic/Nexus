import {
  ModuleRegistry,
  type ModuleManifest,
  type SettingsPanel,
  type ToolRegistration,
  type WidgetConfigField,
  type WidgetContract,
} from "@nexus/core";

/**
 * The dashboard cards the app can draw, declared as the contracts their OWNING
 * modules publish (DASH-002 / ADR-045). Until that slice five of them were
 * hard-coded `<Card>`s in `DashboardPage.tsx`; the manifests are what turn them
 * into a catalogue the layout can be assembled from.
 *
 * The catalogue is bigger than the DEFAULT layout, and deliberately so: the
 * five in `DEFAULT_DASHBOARD_LAYOUT` are what a new profile opens onto, and
 * every other card here is one the user adds himself from „Dodaj vidžet“.
 *
 * `title` is the strings KEY path, not Serbian text (`WidgetContract.title`):
 * `"dashboard.today.title"` means `strings.dashboard.today.title`, so the copy
 * stays in the one file that holds all the copy and `@nexus/core` stays free of
 * user-facing prose.
 *
 * `id`s are ASCII, because a widget id is a key that ends up in the database
 * (`dashboard_widgets.widget_id`, qualified as `moduleId:widgetId`) — never a
 * label. `sizes` is what a widget uses to withhold a preset it cannot honour:
 * the five original cards accept all three, while the two strictly-capped
 * five-row lists (`hitno-kasni`, `nedavno`) stop at M — a row of theirs is a
 * title and one chip, and a full-width card would be mostly empty space.
 *
 * `deepLink` is the module id whose page the card opens (DASH-005) — every
 * widget deliberately points at its own module rather than at the dashboard it
 * is drawn on.
 */
/**
 * Per-widget configuration declarations (DASH-004 / ADR-059). The rule every
 * `default` below obeys: it IS the widget's shipped behaviour, pinned by
 * `modules.test.ts` — a placement with no stored config renders exactly as the
 * card always has. Which is also why two of the choices carry an option the
 * range alone would not suggest: „Predstojeći zadaci" ships with NO period
 * window and „Ispiti" with NO horizon, so each declares an explicit
 * everything-option (`svi`) as its default, and „Danas" ships UNCAPPED, so its
 * count defaults to `Infinity` — a value no write can store (the writer takes
 * integers in `min..max` only), meaning simply "unconfigured".
 *
 * Keys are shared across widgets on purpose (`count`, `horizon`): one key, one
 * Serbian label (`strings.dashboard.config.fields.<key>`), one meaning.
 */
const ROW_CAP: WidgetConfigField = { kind: "count", key: "count", min: 3, max: 10, default: 5 };

/** 30/60/90-day windows over „ističe za koliko dana“ — shared by the two horizon widgets, each with its own default option prepended. */
const HORIZON_DAY_OPTIONS = [
  { id: "30", labelKey: "dashboard.config.horizon.30" },
  { id: "60", labelKey: "dashboard.config.horizon.60" },
  { id: "90", labelKey: "dashboard.config.horizon.90" },
];

const CALENDAR_WIDGETS: WidgetContract[] = [
  // The agenda card: today's events, birthdays and tasks. Owned by CAL because
  // the day is a calendar concept, even though the tasks due today ride along.
  {
    id: "danas",
    title: "dashboard.today.title",
    sizes: ["S", "M", "L"],
    deepLink: "calendar",
    configFields: [
      // The one cap over the card's WHOLE row list (events, then birthdays,
      // then tasks) — uncapped as shipped, hence the infinity default.
      { kind: "count", key: "count", min: 3, max: 10, default: Number.POSITIVE_INFINITY },
    ],
  },
  // Tracked documents nearing their expiry (CAL-005).
  {
    id: "isticanja",
    title: "dashboard.expiring.title",
    sizes: ["S", "M", "L"],
    deepLink: "calendar",
    configFields: [
      {
        kind: "choice",
        key: "horizon",
        options: [
          // As shipped: each document's own reminder ladder decides (`uskoro`).
          { id: "prag", labelKey: "dashboard.config.horizon.prag" },
          ...HORIZON_DAY_OPTIONS,
        ],
        default: "prag",
      },
    ],
  },
];

const TASKS_WIDGETS: WidgetContract[] = [
  {
    id: "predstojece",
    title: "dashboard.upcoming.title",
    sizes: ["S", "M", "L"],
    deepLink: "tasks",
    configFields: [
      ROW_CAP,
      {
        kind: "choice",
        key: "period",
        options: [
          // As shipped: every active task, however far its rok. The two window
          // options are TASK's own smart lists (ADR-049), labels included, so
          // the card and the views can never disagree on what a window means.
          { id: "svi", labelKey: "dashboard.config.period.svi" },
          { id: "danas", labelKey: "tasks.smart.names.danas" },
          { id: "sledecih7", labelKey: "tasks.smart.names.sledecih7" },
        ],
        default: "svi",
      },
      { kind: "taskLists", key: "lists" },
    ],
  },
  // „Kasni“ and „Hitno“ (ADR-049) as one card — the two smart lists that answer
  // „šta je već trebalo da bude gotovo, i šta gori“.
  {
    id: "hitno-kasni",
    title: "dashboard.urgent.title",
    sizes: ["S", "M"],
    deepLink: "tasks",
    configFields: [ROW_CAP],
  },
];

/** NOTE's first dashboard card: the notes touched most recently (DASH-003). */
const NOTES_WIDGETS: WidgetContract[] = [
  {
    id: "nedavno",
    title: "dashboard.recentNotes.title",
    sizes: ["S", "M"],
    deepLink: "notes",
    configFields: [ROW_CAP],
  },
];

const STUDY_WIDGETS: WidgetContract[] = [
  {
    id: "ispiti",
    title: "study.dashboardTitle",
    sizes: ["S", "M", "L"],
    deepLink: "study",
    configFields: [
      // The card has always capped its rows at five — a literal in its render
      // that this contract never declared, so „Podesi…" could offer the horizon
      // and not the cap. `finance:naplate` pairs exactly these two knobs; the
      // exams card had one of them by accident rather than by decision.
      ROW_CAP,
      {
        kind: "choice",
        key: "horizon",
        options: [
          // As shipped: every upcoming exam, however distant.
          { id: "svi", labelKey: "dashboard.config.horizon.svi" },
          ...HORIZON_DAY_OPTIONS,
        ],
        default: "svi",
      },
    ],
  },
  // Deliberately NO `configFields`: a streak-and-minutes card has no knob worth
  // turning, and the „Podesi…" affordance appears only where a choice exists.
  {
    id: "ucenje",
    title: "study.dashboardStudyTitle",
    sizes: ["S", "M", "L"],
    deepLink: "study",
  },
];

/**
 * The settings card each module owns (`SettingsPanel`). Until this slice every
 * one of them was hand-written into `SettingsPage.tsx` — card, controls, and a
 * twin list of search entries in `settingsSearch.ts` that had to be kept in
 * step by hand. They are declarations now: the page composes the cards from the
 * registry in registry order, and the filter index derives its entries from the
 * SAME declaration, so the two can no longer drift.
 *
 * What is NOT here is the point as much as what is: the shell's own cards —
 * Izgled, Profil, Sigurnost, Prečice, Moduli, Obaveštenja, Rezervna kopija,
 * Podaci i privatnost, O aplikaciji — stay hand-composed in the page, because
 * they are the app's settings rather than any module's. See `SettingsPanel`'s
 * own comment for why that boundary is deliberate.
 *
 * Two calendar preferences are the honest exception: „Trajanje događaja" and
 * „Prikaz vremena" are CAL's, but they are drawn in the shell's „Izgled" card
 * (they say how this MACHINE reads a calendar) and are cleared by that card's
 * „Vrati na podrazumevano". Moving them here would move them on screen, which
 * is a change to what the user sees — so they stay where they are, declared
 * with the shell's other appearance entries.
 *
 * `labelKey`/`titleKey` are strings KEY paths, never Serbian text, exactly as
 * `WidgetContract.title` is; `keywords` are folded ASCII search keys that
 * nothing renders. Every `key` below, qualified as `moduleId:key`, is the id
 * the panel highlights its own label by (SET-014).
 */
const TASKS_SETTINGS: SettingsPanel = {
  titleKey: "settings.sectionTitle.tasks",
  controls: [
    // ADR-049. „blokirani" and „danas" already sit in the label, so the
    // keywords carry what someone would type instead — the concept
    // („zavisnost") and the view; the two answers ride the options.
    {
      kind: "choice",
      key: "blocked-today",
      labelKey: "settings.tasks.blockedInTodayLabel",
      storage: "device",
      options: [
        { id: "sakrij", labelKey: "settings.tasks.blockedInTodayOptions.sakrij" },
        { id: "prikazi", labelKey: "settings.tasks.blockedInTodayOptions.prikazi" },
      ],
      keywords: ["zadaci", "zavisnost", "pregled"],
    },
  ],
};

/** ADR-036: both of NOTE's editor preferences live on this machine, which is why „Beleške" offers a reset. */
const NOTES_SETTINGS: SettingsPanel = {
  titleKey: "settings.sectionTitle.notes",
  controls: [
    {
      kind: "choice",
      key: "width",
      labelKey: "settings.notes.widthLabel",
      storage: "device",
      options: [
        { id: "uska", labelKey: "settings.notes.widthNames.uska" },
        { id: "normalna", labelKey: "settings.notes.widthNames.normalna" },
        { id: "siroka", labelKey: "settings.notes.widthNames.siroka" },
      ],
      keywords: ["beleske", "editor", "sirina", "mera", "kolona"],
    },
    {
      kind: "toggle",
      key: "markdown",
      labelKey: "settings.notes.markdownLabel",
      storage: "device",
      keywords: ["beleske", "markdown", "precice", "formatiranje", "naslov", "lista", "slash"],
    },
  ],
};

/**
 * PRIV v1 (ADR-057). Every value is a PROFILE fact answered by `priv:status`,
 * so this card offers no reset — „vrati na podrazumevano" here would be a write
 * about the user's private section, not about this machine.
 *
 * The card renders only while the module is enabled, but its entries are
 * indexed either way: a hit can steer to a section that is not on the page —
 * the same honest gap a disabled module's own gallery row already has.
 */
const PRIV_SETTINGS: SettingsPanel = {
  titleKey: "settings.sectionTitle.priv",
  controls: [
    {
      kind: "value",
      key: "auto-lock",
      labelKey: "settings.priv.autoLockLabel",
      storage: "profile",
      keywords: ["privatno", "privatne", "beleske", "zakljucavanje", "neaktivnost", "minuti"],
    },
    {
      kind: "toggle",
      key: "lock-minimize",
      labelKey: "settings.priv.lockOnMinimizeLabel",
      storage: "profile",
      keywords: ["privatno", "privatne", "beleske", "minimizovanje", "prozor", "zakljucaj"],
    },
    // The Recovery Kit line states a fact and offers nothing to set.
    {
      kind: "fact",
      key: "kit-status",
      labelKey: "settings.priv.caption",
      keywords: ["privatno", "privatne", "beleske", "oporavak", "kod", "sifrovanje", "tajno"],
    },
  ],
};

/** SET-006 (ADR-041): the dashboard's background image and the dim behind the widgets — both profile rows. */
const DASHBOARD_SETTINGS: SettingsPanel = {
  titleKey: "settings.sectionTitle.dashboard",
  controls: [
    {
      kind: "value",
      key: "background",
      labelKey: "settings.dashboard.pick",
      storage: "profile",
      keywords: ["pozadina", "slika", "kontrolna", "tabla", "izgled"],
    },
    {
      kind: "value",
      key: "dim",
      labelKey: "settings.dashboard.dimLabel",
      storage: "profile",
      keywords: ["zatamnjenje", "pozadina", "kontrolna", "tabla"],
    },
  ],
};

/**
 * STUDY-007. „Ciljana zapamćenost" is a closed row on screen but a `value`
 * here: its options are probabilities formatted into percents, so there is no
 * strings key an option could name — declaring three would be inventing copy
 * that does not exist.
 */
const STUDY_SETTINGS: SettingsPanel = {
  titleKey: "settings.sectionTitle.study",
  controls: [
    {
      kind: "value",
      key: "retention",
      labelKey: "settings.study.retentionLabel",
      storage: "profile",
      keywords: ["ucenje", "kartice", "fsrs", "zapamcenost", "retencija", "raspored", "interval"],
    },
    {
      kind: "value",
      key: "new-per-day",
      labelKey: "settings.study.newPerDayLabel",
      storage: "profile",
      keywords: ["ucenje", "kartice", "nove", "dnevno", "limit", "ogranicenje"],
    },
    {
      kind: "value",
      key: "review-cap",
      labelKey: "settings.study.reviewCapLabel",
      storage: "profile",
      keywords: ["ucenje", "ponavljanje", "dnevno", "limit", "ogranicenje", "kapa"],
    },
  ],
};

/**
 * FIN's first dashboard card (slice d): the charges the SCHEDULES say are
 * coming. Two knobs, both `ROW_CAP`'s and `HORIZON_DAY_OPTIONS`' existing
 * vocabulary rather than a third one — one key, one Serbian label, one meaning
 * (DASH-004 / ADR-059).
 *
 * The horizon has NO „svi" option, unlike „Ispiti" and „Isticanja", and the
 * absence is the honest difference between the three: an exam and a document
 * each have one final date, so „every upcoming one" is a finite list, while a
 * subscription that never ends has infinitely many renewals ahead of it.
 * „Sve" there would mean "the next N, whenever they fall", which the row cap
 * already says — so the card ships on a 30-day window and offers 60 and 90.
 *
 * Capped at M for the reason „hitno-kasni" and „nedavno" are: a row here is a
 * name, a day and an amount, and a full-width card would be mostly empty space.
 */
const FINANCE_WIDGETS: WidgetContract[] = [
  {
    id: "naplate",
    title: "dashboard.renewals.title",
    sizes: ["S", "M"],
    deepLink: "finance",
    configFields: [
      ROW_CAP,
      { kind: "choice", key: "horizon", options: HORIZON_DAY_OPTIONS, default: "30" },
    ],
  },
];

/**
 * HABIT slice c's one card: „Navike danas" — what today expects, with the very
 * tick the page offers and the current niz beside it.
 *
 * **Deliberately NO `configFields`, and the reason is not „none fit".** The
 * obvious knob is `ROW_CAP`, and a cap is exactly the wrong thing here: every
 * other capped card („Predstojeći zadaci", „Nedavno", „Predstojeće naplate")
 * draws from a list that can run to hundreds, where the cap picks the front of a
 * queue. This card draws what today ASKS FOR — a handful of rows, all of which
 * are the point — so a cap would hide an expectation, which is the one thing the
 * card exists to state. „Učenje" makes the same call for the same reason: no
 * knob is worth turning, and the „Podesi…" affordance appears only where a
 * choice exists.
 *
 * `sizes` stops at M, honestly. A row here is a swatch, a name, a schedule chip
 * and a tick — the „nedavno"/„hitno-kasni" shape, not the „Danas" one — and a
 * full-width card would be mostly empty space.
 */
const HABITS_WIDGETS: WidgetContract[] = [
  {
    id: "danas",
    title: "dashboard.habitsToday.title",
    sizes: ["S", "M"],
    deepLink: "habits",
  },
];

/**
 * HABIT slice c. ONE control, and the restraint is the point in exactly FIN's
 * way: a reminder is a fact of each HABIT (`reminder_time`, migration 055), so
 * the only thing left for a settings card to decide is which hour the „Nova
 * navika" form fills in at the moment a reminder is switched on.
 *
 * It does not turn reminders on. A habit ships silent and keeps shipping silent
 * — the form's switch starts off whatever this says — so this is the hour you
 * land on once you decide to set one, and never a reminder you did not ask for.
 * That is the whole difference between a default and a policy.
 *
 * `device`, honestly: it changes no stored row, it is read by one form, and
 * forgetting it changes nothing that already exists — which is also what earns
 * this card the „Vrati na podrazumevano" link that every profile-stored card is
 * deliberately denied.
 *
 * `value` rather than `choice` because the domain is 1440 minutes: enumerating it
 * would mean inventing a curated list of „sensible" hours, which is the same
 * fabrication FIN refused for ISO-4217.
 */
const HABITS_SETTINGS: SettingsPanel = {
  titleKey: "settings.sectionTitle.habits",
  controls: [
    {
      kind: "value",
      key: "default-reminder",
      labelKey: "settings.habits.defaultReminderLabel",
      storage: "device",
      keywords: ["navike", "podsetnik", "vreme", "sat", "obavestenje", "nudge"],
    },
  ],
};

/**
 * FIN slice b. ONE control, and the restraint is the point: a currency is a
 * fact of each ACCOUNT (migration 051's no-FX design), so the only thing left
 * for a settings card to decide is which code the „Novi račun" form opens on.
 *
 * `device`, honestly: it changes no stored row, it is read by one form, and
 * forgetting it changes nothing that already exists — which is also what earns
 * this card the „Vrati na podrazumevano" link that every profile-stored card
 * above is deliberately denied.
 *
 * `value` rather than `choice` because the domain is ISO-4217 — a list Nexus
 * would have to invent a curated subset of, and an invented list is exactly the
 * kind of fabricated data this house does not ship.
 */
const FINANCE_SETTINGS: SettingsPanel = {
  titleKey: "settings.sectionTitle.finance",
  controls: [
    {
      kind: "value",
      key: "primary-currency",
      labelKey: "settings.finance.primaryCurrencyLabel",
      storage: "device",
      keywords: ["finansije", "valuta", "novac", "racun", "dinar", "evro", "iso"],
    },
  ],
};

/**
 * DOC („Datoteke"). ONE control, and — like FIN's — the restraint says
 * something: the page has no preferences to speak of, only a shape it opens in.
 *
 * `device`, honestly: it decides how THIS machine draws a list, it changes no
 * stored row, and forgetting it changes nothing that exists — which is what
 * earns the card its „Vrati na podrazumevano".
 *
 * A `choice` rather than FIN's `value`, because the domain here really is
 * closed and really is enumerable: a list or a grid, and there is no third
 * shape to invent.
 */
const FILES_SETTINGS: SettingsPanel = {
  titleKey: "settings.sectionTitle.files",
  controls: [
    {
      kind: "choice",
      key: "view",
      labelKey: "settings.files.viewLabel",
      storage: "device",
      options: [
        { id: "lista", labelKey: "settings.files.viewNames.lista" },
        { id: "mreza", labelKey: "settings.files.viewNames.mreza" },
      ],
      keywords: ["datoteke", "prilozi", "fajlovi", "prikaz", "lista", "mreza", "slike"],
    },
  ],
};

/** CAL-010 (ADR-054): the semester's fixed dates — one control for the card's one date pair. */
const CALENDAR_SETTINGS: SettingsPanel = {
  titleKey: "settings.sectionTitle.calendar",
  controls: [
    {
      kind: "value",
      key: "semester-dates",
      labelKey: "settings.calendar.datesLabel",
      storage: "profile",
      keywords: ["semestar", "kalendar", "datumi", "pocetak", "kraj", "pregled"],
    },
  ],
};

/**
 * UTIL slice b's one card: „Fokus" — the phase running right now, or, when
 * nothing runs, how much focus today has actually held.
 *
 * **Deliberately NO `configFields`**, on „Navike danas"'s and „Učenje"'s
 * reasoning rather than for want of a field. Every knob the other cards carry
 * narrows a LIST — a row cap picks the front of a queue, a horizon narrows a
 * window — and this card draws no list at all: it states one running phase, or
 * one figure. There is nothing here to cap and nothing to narrow, and the
 * „Podesi…" affordance appears only where a choice exists.
 *
 * `sizes` stops at M, honestly: the card is a label, a clock and at most one
 * line under it, so a full-width version would be mostly empty space.
 */
const FOCUS_WIDGETS: WidgetContract[] = [
  {
    id: "fokus",
    title: "dashboard.focus.title",
    sizes: ["S", "M"],
    deepLink: "focus",
  },
];

/**
 * UTIL slice b. FOUR controls, and the count is the point: a Pomodoro shape IS
 * four numbers, and collapsing them into presets („klasični", „dugi") would be
 * inventing a curated list exactly as FIN refused to for ISO-4217.
 *
 * `value` rather than `choice` on all four for the same reason: the domains are
 * ranges (1..180 minutes, 1..12 cycles), and enumerating a range means deciding
 * which of its members are „sensible" on the user's behalf.
 *
 * `device`, honestly, and `focusPrefs.ts` carries the argument in full: the four
 * numbers say how long the NEXT phase is planned for and nothing else — a
 * finished phase records its own `planned_minutes` — so they change no stored
 * row, are read by one page and one card, and forgetting them changes nothing
 * that already exists. Which is also what earns this card the „Vrati na
 * podrazumevano" link every profile-stored card is deliberately denied.
 */
const FOCUS_SETTINGS: SettingsPanel = {
  titleKey: "settings.sectionTitle.focus",
  controls: [
    {
      kind: "value",
      key: "work-minutes",
      labelKey: "settings.focus.workLabel",
      storage: "device",
      keywords: ["fokus", "pomodoro", "rad", "minuti", "trajanje", "tajmer"],
    },
    {
      kind: "value",
      key: "short-break-minutes",
      labelKey: "settings.focus.shortBreakLabel",
      storage: "device",
      keywords: ["fokus", "pomodoro", "pauza", "odmor", "minuti"],
    },
    {
      kind: "value",
      key: "long-break-minutes",
      labelKey: "settings.focus.longBreakLabel",
      storage: "device",
      keywords: ["fokus", "pomodoro", "duga", "pauza", "odmor", "minuti"],
    },
    {
      kind: "value",
      key: "cycles",
      labelKey: "settings.focus.cyclesLabel",
      storage: "device",
      keywords: ["fokus", "pomodoro", "ciklus", "krug", "broj", "faza"],
    },
  ],
};

/**
 * UTIL slice c's tools — the eleven „Alatke" ships with, declared through the
 * very contract a foreign module would use. The drawer has no privileged path
 * to its own tools: it collects `manifest.tools` across the registry and looks
 * each id up in `TOOL_SURFACES`, so these arrive exactly as somebody else's
 * would.
 *
 * **There is no currency converter, and there is no seam for one.** Nexus does
 * not convert money between currencies (founder decision): each currency is
 * tracked on its own terms, because a rate an offline app cannot verify is a
 * number that silently misstates money — which is why FIN holds no rate at all
 * and says „Nexus nema kurs" to the user. What these seven convert are physical
 * quantities, where a metre is a metre everywhere and on every day.
 *
 * `keywords` are spelled ALREADY FOLDED (plain ASCII), the `SettingsControl`
 * convention exactly: the title carries the orthography, these carry the
 * synonyms somebody would really type — „tezina" for mass, „popust" for
 * percentage, „anuitet" for the loan.
 */
const TOOLS_TOOLS: ToolRegistration[] = [
  {
    id: "duzina",
    titleKey: "tools.name.duzina",
    category: "conversion",
    riskClass: "none",
    keywords: ["duzina", "rastojanje", "metar", "kilometar", "milja", "inc", "stopa", "jard"],
  },
  {
    id: "masa",
    titleKey: "tools.name.masa",
    category: "conversion",
    riskClass: "none",
    keywords: ["masa", "tezina", "gram", "kilogram", "tona", "funta", "unca"],
  },
  {
    id: "zapremina",
    titleKey: "tools.name.zapremina",
    category: "conversion",
    riskClass: "none",
    keywords: ["zapremina", "litar", "mililitar", "galon", "kubni", "decilitar"],
  },
  {
    id: "temperatura",
    titleKey: "tools.name.temperatura",
    category: "conversion",
    riskClass: "none",
    keywords: ["temperatura", "celzijus", "farenhajt", "kelvin", "stepen"],
  },
  {
    id: "povrsina",
    titleKey: "tools.name.povrsina",
    category: "conversion",
    riskClass: "none",
    keywords: ["povrsina", "kvadratni", "hektar", "ar", "aker", "plac"],
  },
  {
    id: "brzina",
    titleKey: "tools.name.brzina",
    category: "conversion",
    riskClass: "none",
    keywords: ["brzina", "cvor", "milja na sat", "kilometar na sat"],
  },
  {
    id: "podaci",
    titleKey: "tools.name.podaci",
    category: "conversion",
    riskClass: "none",
    keywords: ["podaci", "bajt", "bit", "kilobajt", "megabajt", "gigabajt", "terabajt", "disk", "memorija"],
  },
  {
    id: "procenat",
    titleKey: "tools.name.procenat",
    category: "calculation",
    riskClass: "none",
    keywords: ["procenat", "posto", "popust", "povecanje", "smanjenje", "promena"],
  },
  {
    id: "pdv",
    titleKey: "tools.name.pdv",
    category: "calculation",
    // The rate is typed, never embedded — but the answer is a figure somebody
    // puts on an invoice, so the drawer says out loud that this is arithmetic
    // and not tax advice, and echoes the rate that produced it.
    riskClass: "financial",
    keywords: ["pdv", "porez", "osnovica", "racun", "faktura", "stopa"],
  },
  {
    id: "kredit",
    titleKey: "tools.name.kredit",
    category: "calculation",
    // An annuity from a nominal rate is not the bank's offer: the effective
    // rate, the fees and the insurance are not in it, and somebody comparing
    // two loans on this number alone is comparing the wrong thing.
    riskClass: "financial",
    keywords: ["kredit", "rata", "anuitet", "kamata", "zajam", "pozajmica", "nks"],
  },
  {
    id: "jedinicna-cena",
    titleKey: "tools.name.jedinicna-cena",
    category: "calculation",
    riskClass: "none",
    keywords: ["cena", "pakovanje", "jeftinije", "poredjenje", "kilogram", "litar"],
  },
];

/**
 * „Stručne alatke" (UTIL slice d) — the forty-eight tools of the `softver`
 * pack, published through the SAME `ToolRegistration` contract as the eleven
 * everyday tools above, and shelved in the professional drawer rather than in
 * one of their own.
 *
 * **What routes a tool to that drawer is `packs`, not its category, and the
 * distinction matters.** Category still says what a tool DOES — `numbers`,
 * `text`, `design`, and the rest — but never to whom, and „whom" is exactly the
 * question a drawer has to answer. Every entry below carries `packs: ["softver"]`
 * at minimum, which is the whole mechanism: a tool says who it is for, and
 * where it is shelved follows from that declaration rather than from who wrote
 * it. That is the same seam the contract has always offered — NOTE
 * contributing the Markdown table builder would publish a tool exactly this
 * way — so nothing here is a special case the host had to grow; `packs` merely
 * gives that seam a name.
 *
 * **Fifteen of the forty-eight name a second pack, and that is the point of
 * the field rather than an exception to it.** A colour converter is not a
 * programmer's tool that a designer happens to be allowed to borrow — it is a
 * tool both of them own outright, and giving it two entries would have been two
 * hits for one screen, the very duplication the `TOOL_DRAWERS` comment above
 * already refuses. Three of the overlaps are category-wide: all six `design`
 * tools also carry `dizajn`, because a gradient editor is graphic-design
 * equipment before it is developer equipment; four of the `numbers` tools also
 * carry `inzenjering` (`number-base`, `integer-inspector`, `bitwise`,
 * `float-convert`), because register widths and fixed-point formats are the
 * same arithmetic on either side of the hardware boundary; and four of the
 * `text` tools also carry `tekst` (`unicode-inspector`, `diff`, `slug`,
 * `line-tools`), because a translator transliterating a title and diffing two
 * drafts is doing exactly what these do. The QR generator overlaps differently
 * rather than not at all: it names TWO second packs, `biznis` and `event`,
 * because an invoice's payment QR and an invitation's check-in QR are the same
 * code with a different payload.
 *
 * Every entry carries a `blurbKey`, which the eleven utilities do not. At eleven
 * tools „Dužina" explains itself and a sentence under each would be noise; at
 * forty-eight, a name like „Oblik zapisa" or „Mikroskalirani blokovi" does not,
 * and the line under it is the difference between a list and a wall.
 *
 * The keywords are folded to plain ASCII, `SettingsControl.keywords`' rule
 * exactly — with `đ` written `dj`, because it is the one Serbian letter with no
 * canonical decomposition and stripping its stroke by algorithm yields `d`. A
 * drawer this size is unusable without search, so the folding is not a nicety:
 * it is what makes „sifrovanje" find the AES tool for somebody typing without
 * diacritics, which is how everybody types into a search field.
 */
const PRO_DEV_TOOLS: ToolRegistration[] = [
  // numbers
  {
    id: "number-base",
    titleKey: "devtools.name.number-base",
    blurbKey: "devtools.blurb.number-base",
    category: "numbers",
    riskClass: "none",
    packs: ["softver", "inzenjering"],
    keywords: [
      "base", "bigint", "bin", "binarno", "broj", "brojni sistemi", "cifre", "convert",
      "decimalno", "heksadecimalno", "hex", "konverzija", "number base", "okt", "oktalno",
      "osnova", "radix"
    ],
  },
  {
    id: "integer-inspector",
    titleKey: "devtools.name.integer-inspector",
    blurbKey: "devtools.blurb.integer-inspector",
    category: "numbers",
    riskClass: "none",
    packs: ["softver", "inzenjering"],
    keywords: [
      "bajt", "bajtovi", "big endian", "binarno", "celobrojno", "ceo broj", "dvojni komplement",
      "endian", "hex", "inspector", "int", "int16", "int32", "int64", "int8", "integer",
      "little endian", "opseg", "overflow", "prekoracenje", "sirina", "twos complement", "uint",
      "width"
    ],
  },
  {
    id: "bitwise",
    titleKey: "devtools.name.bitwise",
    blurbKey: "devtools.blurb.bitwise",
    category: "numbers",
    riskClass: "none",
    packs: ["softver", "inzenjering"],
    keywords: [
      "and", "bit", "bitovi", "bitske operacije", "bitwise", "clz", "ctz", "mask", "maska", "nand",
      "nor", "not", "nule", "or", "parity", "parnost", "pomeraj", "popcount", "rotacija", "rotate",
      "sar", "shift", "shl", "shr", "sirina", "xnor", "xor"
    ],
  },
  {
    id: "data-unit",
    titleKey: "devtools.name.data-unit",
    blurbKey: "devtools.blurb.data-unit",
    category: "numbers",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "bajt", "bajtovi", "bit", "bitovi", "bytes", "data", "disk", "gb", "gib", "gigabajt",
      "gigabit", "jedinice", "kb", "kib", "kilobajt", "mb", "megabajt", "megabit", "memorija",
      "mib", "pb", "petabajt", "pib", "size", "storage", "tb", "terabajt", "tib", "velicina"
    ],
  },
  {
    id: "float-convert",
    titleKey: "devtools.name.float-convert",
    blurbKey: "devtools.blurb.float-convert",
    category: "numbers",
    riskClass: "none",
    packs: ["softver", "inzenjering"],
    keywords: [
      "beskonacno", "bf16", "bfloat", "bitovi", "denormal", "double", "e4m3", "e5m2", "e8m0",
      "eksponent", "float", "floating point", "fnuz", "fp16", "fp32", "fp64", "fp8", "half", "hex",
      "infinity", "mantisa", "mxfp4", "mxfp6", "nan", "pokretni zarez", "preciznost", "rounding",
      "single", "subnormal", "tf32", "zaokruzivanje", "zarez"
    ],
  },
  {
    id: "mx-block",
    titleKey: "devtools.name.mx-block",
    blurbKey: "devtools.blurb.mx-block",
    category: "numbers",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "bita po vrednosti", "bits per value", "block", "blok", "deljeni eksponent", "e8m0",
      "kvantizacija", "microscaling", "mikroskaliranje", "mx", "mxfp", "mxfp4", "mxfp6", "mxfp8",
      "ocp", "quantization", "scale", "shared exponent", "skala"
    ],
  },
  // riscv
  {
    id: "riscv",
    titleKey: "devtools.name.riscv",
    blurbKey: "devtools.blurb.riscv",
    category: "riscv",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "abi", "addi", "asembler", "assembler", "branch", "compressed", "csr", "decode",
      "dekodiranje", "disasembler", "disassembler", "encode", "funct", "immediate", "instruction",
      "instrukcija", "instrukcije", "jal", "kodiranje", "kompresovano", "li", "lui", "opcode",
      "pseudo", "register", "registri", "risc-v", "riscv", "rv32", "rv32i", "rv64", "rv64i",
      "zicsr"
    ],
  },
  // encoding
  {
    id: "base64",
    titleKey: "devtools.name.base64",
    blurbKey: "devtools.blurb.base64",
    category: "encoding",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "b64", "bajtovi", "base64", "bytes", "decode", "dekodiranje", "dopuna", "encode",
      "kodiranje", "padding", "url-safe", "urlsafe"
    ],
  },
  {
    id: "url-encode",
    titleKey: "devtools.name.url-encode",
    blurbKey: "devtools.blurb.url-encode",
    category: "encoding",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "dekodiranje", "encodeuri", "encodeuricomponent", "escape", "form", "forma", "kodiranje",
      "percent", "procenat", "url", "urldecode", "urlencode"
    ],
  },
  {
    id: "url-parse",
    titleKey: "devtools.name.url-parse",
    blurbKey: "devtools.blurb.url-parse",
    category: "encoding",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "delovi", "domen", "fragment", "host", "idn", "parametri", "parse", "port", "punycode",
      "putanja", "query", "raspakuj", "upit", "url"
    ],
  },
  {
    id: "ascii-binary-hex",
    titleKey: "devtools.name.ascii-binary-hex",
    blurbKey: "devtools.blurb.ascii-binary-hex",
    category: "encoding",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "ascii", "bajtovi", "binarno", "binary", "bytes", "decimalno", "heks", "heksadekadno", "hex",
      "kodna", "tacka", "tekst", "text", "utf8"
    ],
  },
  {
    id: "unicode-inspector",
    titleKey: "devtools.name.unicode-inspector",
    blurbKey: "devtools.blurb.unicode-inspector",
    category: "encoding",
    riskClass: "none",
    packs: ["softver", "tekst"],
    keywords: [
      "codepoint", "emoji", "grafema", "inspector", "inspektor", "kategorija", "kodna", "nfc",
      "nfd", "nfkc", "nfkd", "normalizacija", "surogat", "tacka", "unicode", "utf16", "utf8"
    ],
  },
  {
    id: "html-entities",
    titleKey: "devtools.name.html-entities",
    blurbKey: "devtools.blurb.html-entities",
    category: "encoding",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "amp", "dekodiranje", "entiteti", "entities", "escape", "html", "kodiranje", "markap",
      "nbsp", "unescape", "znakovi"
    ],
  },
  {
    id: "hexdump",
    titleKey: "devtools.name.hexdump",
    blurbKey: "devtools.blurb.hexdump",
    category: "encoding",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "ascii", "bajtovi", "bytes", "dump", "heks", "hex", "hexdump", "ispis", "offset", "ofset",
      "xxd"
    ],
  },
  // data
  {
    id: "json-editor",
    titleKey: "devtools.name.json-editor",
    blurbKey: "devtools.blurb.json-editor",
    category: "data",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "beautify", "format", "formatiranje", "indent", "json", "jsonpath", "keys", "kljucevi",
      "minifikacija", "minify", "pretty", "provera", "proveri", "putanja", "query", "smanji",
      "sortiraj", "sortiranje", "upit", "uredi", "uvlacenje", "validacija"
    ],
  },
  {
    id: "yaml-editor",
    titleKey: "devtools.name.yaml-editor",
    blurbKey: "devtools.blurb.yaml-editor",
    category: "data",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "alias", "anchor", "block", "blok", "citaj", "documents", "dokument", "flow", "indent",
      "kljucevi", "komentar", "parse", "parsiranje", "pretvori", "provera", "serijalizacija",
      "sidro", "sortiraj", "uvlacenje", "validacija", "yaml", "yml"
    ],
  },
  {
    id: "xml-editor",
    titleKey: "devtools.name.xml-editor",
    blurbKey: "devtools.blurb.xml-editor",
    category: "data",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "atribut", "cdata", "entitet", "format", "formatiranje", "html", "indent", "ispravnost",
      "komentar", "markup", "minifikacija", "minify", "pretty", "provera", "putanja", "tag",
      "upit", "uvlacenje", "validacija", "xml", "xpath"
    ],
  },
  {
    id: "data-format",
    titleKey: "devtools.name.data-format",
    blurbKey: "devtools.blurb.data-format",
    category: "data",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "convert", "csv", "delimiter", "format", "header", "izvoz", "json", "konvertuj",
      "konverzija", "pretvori", "prevod", "razdvajac", "tabela", "toml", "uvoz", "yaml", "yml",
      "zaglavlje"
    ],
  },
  {
    id: "json-to-types",
    titleKey: "devtools.name.json-to-types",
    blurbKey: "devtools.blurb.json-to-types",
    category: "data",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "deklaracije", "dto", "generator", "interface", "json", "model", "schema", "sema", "tip",
      "tipovi", "ts", "type", "types", "typescript", "u tipove", "zod"
    ],
  },
  {
    id: "uuid",
    titleKey: "devtools.name.uuid",
    blurbKey: "devtools.blurb.uuid",
    category: "data",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "generator", "guid", "id", "identifikator", "kljuc", "nasumican", "random", "ulid", "uuid",
      "v4", "v7", "vremenski"
    ],
  },
  // text
  {
    id: "diff",
    titleKey: "devtools.name.diff",
    blurbKey: "devtools.blurb.diff",
    category: "text",
    riskClass: "none",
    packs: ["softver", "tekst"],
    keywords: [
      "compare", "diff", "myers", "patch", "poredjenje", "promene", "razlika", "razlike", "tekst",
      "unified", "uporedi"
    ],
  },
  {
    id: "markdown-table",
    titleKey: "devtools.name.markdown-table",
    blurbKey: "devtools.blurb.markdown-table",
    category: "text",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "align", "csv", "gfm", "grid", "kolone", "markdown", "md", "poravnanje", "redovi", "tabela",
      "table"
    ],
  },
  {
    id: "lorem",
    titleKey: "devtools.name.lorem",
    blurbKey: "devtools.blurb.lorem",
    category: "text",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "dummy", "filler", "generator", "ipsum", "lorem", "maketa", "pasusi", "placeholder",
      "popuna", "recenice", "tekst"
    ],
  },
  {
    id: "slug",
    titleKey: "devtools.name.slug",
    blurbKey: "devtools.blurb.slug",
    category: "text",
    riskClass: "none",
    packs: ["softver", "tekst"],
    keywords: [
      "cirilica", "djordje", "latinica", "link", "naslov", "permalink", "putanja", "seo", "slug",
      "transliteracija", "url"
    ],
  },
  {
    id: "case-convert",
    titleKey: "devtools.name.case-convert",
    blurbKey: "devtools.blurb.case-convert",
    category: "text",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "camelcase", "case", "identifikator", "kebab", "konverzija", "naziv", "oblik", "pascalcase",
      "screaming", "snakecase", "tokenizacija", "zapis"
    ],
  },
  {
    id: "line-tools",
    titleKey: "devtools.name.line-tools",
    blurbKey: "devtools.blurb.line-tools",
    category: "text",
    riskClass: "none",
    packs: ["softver", "tekst"],
    keywords: [
      "dedupe", "duplikati", "izmesaj", "lines", "linije", "numerisi", "prefiks", "prelom",
      "razdvoji", "redovi", "shuffle", "sort", "sortiraj", "spoji", "sufiks", "trim", "wrap"
    ],
  },
  {
    id: "regex",
    titleKey: "devtools.name.regex",
    blurbKey: "devtools.blurb.regex",
    category: "text",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "flags", "groups", "grupe", "match", "pattern", "poklapanja", "regex", "regularni izrazi",
      "replace", "sablon", "test", "zamena", "zastavice"
    ],
  },
  // design
  {
    id: "color-convert",
    titleKey: "devtools.name.color-convert",
    blurbKey: "devtools.blurb.color-convert",
    category: "design",
    riskClass: "none",
    packs: ["softver", "dizajn"],
    keywords: [
      "boja", "boje", "color", "colour", "convert", "css", "hex", "hsl", "hwb", "konverzija",
      "lab", "lch", "named", "naziv", "oklab", "oklch", "pretvarac", "pretvaranje", "rgb"
    ],
  },
  {
    id: "color-palette",
    titleKey: "devtools.name.color-palette",
    blurbKey: "devtools.blurb.color-palette",
    category: "design",
    riskClass: "none",
    packs: ["softver", "dizajn"],
    keywords: [
      "analogna", "boje", "harmonija", "harmony", "komplementarna", "monohromatska", "nijanse",
      "oklch", "paleta", "palette", "ramp", "shades", "tetrada", "tints", "tonovi", "trijada"
    ],
  },
  {
    id: "gradient",
    titleKey: "devtools.name.gradient",
    blurbKey: "devtools.blurb.gradient",
    category: "design",
    riskClass: "none",
    packs: ["softver", "dizajn"],
    keywords: [
      "conic", "css", "gradient", "gradijent", "interpolacija", "konusni", "linear", "linearni",
      "oklab", "preliv", "radial", "radijalni", "srgb", "stopovi", "stops", "tacke", "ugao",
      "uzorci"
    ],
  },
  {
    id: "cubic-bezier",
    titleKey: "devtools.name.cubic-bezier",
    blurbKey: "devtools.blurb.cubic-bezier",
    category: "design",
    riskClass: "none",
    packs: ["softver", "dizajn"],
    keywords: [
      "animacija", "animation", "bezier", "bezije", "bezijeova", "css", "cubic", "curve", "ease",
      "easing", "kriva", "odskok", "prelaz", "tajming", "transition", "ublazavanje"
    ],
  },
  {
    id: "contrast",
    titleKey: "devtools.name.contrast",
    blurbKey: "devtools.blurb.contrast",
    category: "design",
    riskClass: "none",
    packs: ["softver", "dizajn"],
    keywords: [
      "a11y", "aa", "aaa", "accessibility", "apca", "citljivost", "contrast", "kontrast", "lc",
      "odnos", "pozadina", "pristupacnost", "ratio", "tekst", "wcag"
    ],
  },
  {
    id: "color-mixer",
    titleKey: "devtools.name.color-mixer",
    blurbKey: "devtools.blurb.color-mixer",
    category: "design",
    riskClass: "none",
    packs: ["softver", "dizajn"],
    keywords: [
      "alfa", "alpha", "blend", "boje", "composite", "kompozit", "linear", "mesalica", "mesanje",
      "mix", "mixer", "oklab", "preklapanje", "providnost", "srgb", "tezina", "udeo"
    ],
  },
  // crypto
  {
    id: "token-gen",
    titleKey: "devtools.name.token-gen",
    blurbKey: "devtools.blurb.token-gen",
    category: "crypto",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "alfanumericki", "api", "base58", "base64", "base64url", "entropija", "entropy", "generator",
      "hex", "key", "kljuc", "nasumicno", "random", "secret", "slucajno", "token", "tokeni"
    ],
  },
  {
    id: "password-gen",
    titleKey: "devtools.name.password-gen",
    blurbKey: "devtools.blurb.password-gen",
    category: "crypto",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "cifre", "entropija", "entropy", "fraza", "generator", "jaka lozinka", "lozinka", "lozinke",
      "nasumicno", "passphrase", "password", "random", "recnik", "sifra", "simboli", "wordlist"
    ],
  },
  {
    id: "jwt",
    titleKey: "devtools.name.jwt",
    blurbKey: "devtools.blurb.jwt",
    category: "crypto",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "bearer", "claims", "es256", "exp", "hmac", "hs256", "iat", "json web token", "jwk", "jwt",
      "nbf", "pem", "potpis", "provera", "rs256", "signature", "token", "tvrdnje", "verify"
    ],
  },
  {
    id: "hashing",
    titleKey: "devtools.name.hashing",
    blurbKey: "devtools.blurb.hashing",
    category: "crypto",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "base64", "checksum", "digest", "hash", "hes", "hesiranje", "hex", "hmac", "md5", "otisak",
      "sha", "sha1", "sha256", "sha384", "sha512"
    ],
  },
  {
    id: "aes",
    titleKey: "devtools.name.aes",
    blurbKey: "devtools.blurb.aes",
    category: "crypto",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "aes", "cbc", "decrypt", "desifrovanje", "encrypt", "envelope", "gcm", "iv", "key", "kljuc",
      "koverta", "kriptovanje", "lozinka", "nonce", "pbkdf2", "sifrovanje", "simetricno"
    ],
  },
  {
    id: "rsa-keygen",
    titleKey: "devtools.name.rsa-keygen",
    blurbKey: "devtools.blurb.rsa-keygen",
    category: "crypto",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "2048", "4096", "generisanje", "javni", "key", "keygen", "keypair", "kljuc", "kljucevi",
      "oaep", "par", "pem", "pkcs8", "privatni", "pss", "rsa", "spki"
    ],
  },
  {
    id: "rsa-crypt",
    titleKey: "devtools.name.rsa-crypt",
    blurbKey: "devtools.blurb.rsa-crypt",
    category: "crypto",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "asimetricno", "decrypt", "desifrovanje", "encrypt", "javni kljuc", "kriptovanje", "oaep",
      "pem", "privatni kljuc", "rsa", "sifrovanje"
    ],
  },
  {
    id: "signature",
    titleKey: "devtools.name.signature",
    blurbKey: "devtools.blurb.signature",
    category: "crypto",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "ecdsa", "eliptic", "kljuc", "p256", "p384", "pem", "pkcs1", "potpis", "potpisivanje",
      "provera", "pss", "rsa", "sign", "signature", "verify"
    ],
  },
  // system
  {
    id: "http-status",
    titleKey: "devtools.name.http-status",
    blurbKey: "devtools.blurb.http-status",
    category: "system",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "404", "500", "cloudflare", "error", "greska", "http", "iana", "kod", "kodovi", "odgovor",
      "rfc", "status", "webdav"
    ],
  },
  {
    id: "path-convert",
    titleKey: "devtools.name.path-convert",
    blurbKey: "devtools.blurb.path-convert",
    category: "system",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "disk", "escape", "file url", "linux", "mnt", "navodnici", "path", "putanja", "putanje",
      "unc", "unix", "windows", "wsl"
    ],
  },
  {
    id: "cidr",
    titleKey: "devtools.name.cidr",
    blurbKey: "devtools.blurb.cidr",
    category: "system",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "broadcast", "cidr", "ip", "ipv4", "ipv6", "maska", "mreza", "netmask", "opseg", "podmreza",
      "prefiks", "subnet", "supernet", "wildcard"
    ],
  },
  {
    id: "semver",
    titleKey: "devtools.name.semver",
    blurbKey: "devtools.blurb.semver",
    category: "system",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "caret", "compare", "npm", "opseg", "prerelease", "range", "semver", "sortiraj", "tilde",
      "uporedi", "version", "verzija", "verzije"
    ],
  },
  {
    id: "qr",
    titleKey: "devtools.name.qr",
    blurbKey: "devtools.blurb.qr",
    category: "system",
    riskClass: "none",
    packs: ["softver", "biznis", "event"],
    keywords: [
      "barcode", "barkod", "email", "generator", "geo", "kod", "kontakt", "koordinate", "link",
      "lokacija", "lozinka", "mailto", "mejl", "mreza", "poruka", "poziv", "qr", "qr code",
      "qr kod", "slika", "sms", "svg", "tel", "telefon", "url", "vcard", "veza", "vizit karta",
      "wi-fi", "wifi"
    ],
  },
  // time
  {
    id: "datetime",
    titleKey: "devtools.name.datetime",
    blurbKey: "devtools.blurb.datetime",
    category: "time",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "convert", "dan u godini", "datum", "day of year", "dotnet", "dst", "duration", "epoch",
      "epoha", "filetime", "iana", "iso", "iso nedelja", "iso8601", "konverzija", "leap",
      "letnje racunanje vremena", "milisekunde", "nanosekunde", "offset", "pomeraj", "pre",
      "prestupna", "relativno", "rfc2822", "ticks", "tikovi", "timestamp", "timezone", "trajanje",
      "trenutak", "unix", "utc", "vreme", "vremenska oznaka", "vremenska zona", "week", "windows",
      "za", "zona"
    ],
  },
  {
    id: "cron",
    titleKey: "devtools.name.cron",
    blurbKey: "devtools.blurb.cron",
    category: "time",
    riskClass: "none",
    packs: ["softver"],
    keywords: [
      "cron", "crontab", "daily", "dan u mesecu", "dan u nedelji", "dst", "expression", "fields",
      "hourly", "izraz", "job", "kvarc", "macro", "makro", "minut", "next run", "polja", "posao",
      "quartz", "raspored", "rasporedjivanje", "reboot", "sat", "schedule", "scheduler", "sekunde",
      "sledece paljenje", "timezone", "vixie", "vremenska zona", "weekly", "yearly", "zakazivanje"
    ],
  },
];

/**
 * „Gradnja i projektovanje" — the first toolkit that is not a programmer's.
 *
 * ONE array per pack from here on, and the reason is the file layout rather
 * than taste: a toolkit is three files (`@nexus/core/pro/<pack>.ts` for the
 * arithmetic, `renderer/pro/<pack>.tsx` for the surfaces, `strings/pro.<pack>.ts`
 * for the copy) and this array is the fourth thing that must agree with them.
 * Keeping the registrations of one subject together is what lets that agreement
 * be read in one place instead of grepped for.
 *
 * A tool shared with a second pack is registered ONCE, in the array of the pack
 * that comes first in `TOOL_PACKS`, and names the other in `packs` — the same
 * rule the developer entries above already follow. `stair-geometry` is `zanat`'s
 * as much as it is `gradnja`'s: a carpenter building a flight measures the same
 * rise and divides it the same way.
 *
 * `life-safety`, and it is not a formality. A stair whose risers are not all the
 * same height is the single most common cause of a fall on one, which is why the
 * riser here is `H/n` carried to three decimals of a millimetre rather than
 * rounded to something buildable: the rounding is the carpenter's decision and
 * he must see what he is rounding. `toolForbidsVerdict` is therefore true for
 * it, and nothing in the surface says whether a flight passes — it puts the
 * computed riser beside the limit the user typed and prints the quotient.
 *
 * No `sourceKey`: the tool embeds no published table. Blondel's `2r + g` is
 * arithmetic from 1675 and the pitch is a right triangle, both `physical` tier;
 * the two maxima that WOULD need a citation are not embedded at all, because
 * which one applies depends on the building, its use and the rule in force —
 * so the user types them and the tool echoes them back.
 */
const PRO_GRADNJA_TOOLS: ToolRegistration[] = [
  {
    id: "angle-units",
    titleKey: "pro.name.angle-units",
    blurbKey: "pro.blurb.angle-units",
    category: "conversion",
    riskClass: "none",
    packs: ["gradnja", "inzenjering"],
    keywords: [
      "angle", "decimalnih", "direkcioni", "gona", "jedinica", "krug", "mila", "minuta",
      "minuti", "prevodi", "pun", "radijana", "sekunde", "sekundi", "stepeni", "svodi",
      "svodjenje", "ugao", "ugla", "uglovi", "ulazna", "units"
    ],
  },
  {
    id: "bar-spacing",
    titleKey: "pro.name.bar-spacing",
    blurbKey: "pro.blurb.bar-spacing",
    category: "geometry",
    riskClass: "life-safety",
    packs: ["gradnja", "inzenjering", "agro", "zanat", "event"],
    keywords: [
      "bar", "deli", "duzina", "duzinu", "jednake", "jednaki", "komada", "kraja", "maksimum",
      "max", "najveci", "odstojanje", "pocetka", "pozicije", "prelaze", "raspored", "razmaci",
      "razmak", "razmake", "spacing", "stvarni", "ukupna"
    ],
  },
  {
    id: "beam-check",
    titleKey: "pro.name.beam-check",
    blurbKey: "pro.blurb.beam-check",
    category: "structure",
    riskClass: "life-safety",
    packs: ["gradnja", "inzenjering", "zanat"],
    keywords: [
      "beam", "cetiri", "check", "elasticnosti", "granicni", "greda", "inercije", "konzola",
      "maksimalni", "modul", "moment", "napon", "odnos", "opterecenje", "osnovne", "otporni",
      "prepust", "raspon", "reakcije", "sema", "seme", "sila", "staticka", "staticke", "ugib",
      "unetih"
    ],
  },
  {
    id: "concrete-takeoff",
    titleKey: "pro.name.concrete-takeoff",
    blurbKey: "pro.blurb.concrete-takeoff",
    category: "materials",
    riskClass: "none",
    packs: ["gradnja", "zanat"],
    keywords: [
      "armature", "betona", "concrete", "dimenzije", "elementa", "gredu", "gustina", "kolicina",
      "komada", "kubatura", "mesalice", "odbitak", "oplata", "oplate", "otvora", "plocu",
      "povrsinu", "rastur", "stub", "takeoff", "temelj", "tip", "tipu", "tura", "zapremina",
      "zapreminu"
    ],
  },
  {
    id: "drawing-scale",
    titleKey: "pro.name.drawing-scale",
    blurbKey: "pro.blurb.drawing-scale",
    category: "conversion",
    riskClass: "none",
    sourceKey: "pro.sources.iso-216-iso-5455",
    packs: ["gradnja", "inzenjering", "dizajn", "nekretnine"],
    keywords: [
      "crteza", "drawing", "duzina", "duzinu", "format", "gabarit", "lista", "margina", "nazad",
      "niza", "papira", "papiru", "predmeta", "prevodi", "razmera", "scale", "sirina", "staje",
      "standardnog", "stvarna", "stvarnu", "visina"
    ],
  },
  {
    id: "earthwork-prismoidal",
    titleKey: "pro.name.earthwork-prismoidal",
    blurbKey: "pro.blurb.earthwork-prismoidal",
    category: "materials",
    riskClass: "none",
    packs: ["gradnja", "inzenjering"],
    keywords: [
      "earthwork", "formuli", "iskopa", "metodi", "nasipa", "poprecnih", "povrsina", "preseka",
      "prismoidal", "prizmoidnoj", "profila", "profili", "rastresitost", "sabira", "segmenta",
      "sleganje", "srednja", "srednjih", "zapremina", "zapreminu"
    ],
  },
  {
    id: "level-run",
    titleKey: "pro.name.level-run",
    blurbKey: "pro.blurb.level-run",
    category: "calculation",
    riskClass: "none",
    packs: ["gradnja", "inzenjering"],
    keywords: [
      "aritmeticku", "duzina", "kontrolu", "kota", "kote", "level", "nezatvaranje", "nivelira",
      "nivelman", "ocitanja", "polaznog", "repera", "run", "stanici", "tacaka", "viza", "vlaka",
      "zavrsnog"
    ],
  },
  {
    id: "rebar-weight",
    titleKey: "pro.name.rebar-weight",
    blurbKey: "pro.blurb.rebar-weight",
    category: "materials",
    riskClass: "none",
    sourceKey: "pro.sources.steel-nominal-density",
    packs: ["gradnja", "inzenjering", "zanat"],
    keywords: [
      "armature", "cele", "duzina", "duzinu", "jedne", "kilograme", "masa", "metre", "nazad",
      "precnik", "pretvara", "rebar", "sipke", "sipki", "smer", "weight"
    ],
  },
  {
    id: "roof-pitch",
    titleKey: "pro.name.roof-pitch",
    blurbKey: "pro.blurb.roof-pitch",
    category: "geometry",
    riskClass: "none",
    packs: ["gradnja", "zanat"],
    keywords: [
      "duzinu", "grbine", "grbinu", "horizontalne", "horizontalni", "krak", "krova", "krovne",
      "nagib", "nagiba", "osnova", "osnove", "pitch", "povrsina", "povrsinu", "prepust",
      "projekcije", "projekcioni", "ravni", "roga", "roof", "slemena", "strehe", "stvarnu",
      "visinu"
    ],
  },
  {
    id: "room-surfaces",
    titleKey: "pro.name.room-surfaces",
    blurbKey: "pro.blurb.room-surfaces",
    category: "geometry",
    riskClass: "none",
    packs: ["gradnja", "nekretnine", "zanat"],
    keywords: [
      "dubina", "duzina", "izdasnost", "kolicinu", "materijala", "mera", "neto", "odbijanje",
      "otvora", "otvori", "plafon", "potrebnu", "povrsine", "povrsinu", "premaza", "prostorije",
      "room", "sirina", "slojeva", "spaletne", "spiska", "surfaces", "svetla", "visina",
      "zidne", "zidnu"
    ],
  },
  {
    id: "slope-grade",
    titleKey: "pro.name.slope-grade",
    blurbKey: "pro.blurb.slope-grade",
    category: "geometry",
    riskClass: "none",
    packs: ["gradnja", "inzenjering", "transport", "agro", "zanat"],
    keywords: [
      "duzina", "duzine", "grade", "horizontalna", "kosa", "nagib", "nagiba", "odnosu", "pad",
      "podatka", "poznata", "procentu", "promilu", "razlika", "razlike", "slope", "stepenu",
      "visinska", "visinske"
    ],
  },
  {
    id: "square-check",
    titleKey: "pro.name.square-check",
    blurbKey: "pro.blurb.square-check",
    category: "geometry",
    riskClass: "none",
    packs: ["gradnja", "zanat", "event"],
    keywords: [
      "check", "dijagonala", "dijagonale", "izmerena", "izmerene", "milimetrima", "odstupanje",
      "pomeranje", "pravog", "pravouglosti", "square", "stranica", "stranice", "tacke", "ugla"
    ],
  },
  {
    id: "stair-geometry",
    titleKey: "pro.name.stair-geometry",
    blurbKey: "pro.blurb.stair-geometry",
    category: "geometry",
    riskClass: "life-safety",
    packs: ["gradnja", "zanat"],
    keywords: [
      "blondel", "broj stepenika", "gazenje", "gazista", "gaziste", "going", "hod", "krak",
      "nagib", "penjanje", "podest", "riser", "spratna visina", "stair", "stepenice",
      "stepenik", "stepeniste", "uspon", "visina stepenika"
    ],
  },
  {
    id: "survey-bearing-distance",
    titleKey: "pro.name.survey-bearing-distance",
    blurbKey: "pro.blurb.survey-bearing-distance",
    category: "geometry",
    riskClass: "none",
    packs: ["gradnja", "inzenjering"],
    keywords: [
      "bearing", "direkcioni", "distance", "duzina", "duzine", "duzinu", "geodetski",
      "jedinica", "koordinate", "nove", "smer", "survey", "tacka", "tacke", "ugao", "ugla",
      "zadatak"
    ],
  },
  {
    id: "tile-count",
    titleKey: "pro.name.tile-count",
    blurbKey: "pro.blurb.tile-count",
    category: "materials",
    riskClass: "none",
    packs: ["gradnja", "zanat"],
    keywords: [
      "count", "format", "formata", "komada", "kutija", "kutiji", "kvadratu", "plocica",
      "povrsina", "povrsine", "rastur", "rasturom", "sirina", "spojnice", "spojnicom", "tile"
    ],
  },
  {
    id: "trench-volume",
    titleKey: "pro.name.trench-volume",
    blurbKey: "pro.blurb.trench-volume",
    category: "materials",
    riskClass: "none",
    packs: ["gradnja", "inzenjering", "agro", "zanat"],
    keywords: [
      "cevi", "debljina", "dna", "dubina", "dubine", "duzina", "horizontalno", "iskop",
      "iskopa", "kosina", "kosine", "nagib", "nagiba", "odvoz", "posteljice", "precnik",
      "rastresitost", "rova", "sirina", "sirine", "spoljni", "trench", "vertikalno", "viska",
      "volume", "zapreminu", "zasipanja", "zemlje"
    ],
  },
  {
    id: "wall-u-value",
    titleKey: "pro.name.wall-u-value",
    blurbKey: "pro.blurb.wall-u-value",
    category: "calculation",
    riskClass: "none",
    packs: ["gradnja", "inzenjering"],
    keywords: [
      "dodiru", "krova", "nevetrenog", "otpor", "otpore", "prelaza", "rse", "rsi", "sabira",
      "sklopa", "sloja", "slojeva", "slojevi", "spolja", "spoljna", "svakom", "temperatura",
      "temperaturu", "toplote", "ukupan", "unutra", "unutrasnja", "vazdusnog", "wall", "zida"
    ],
  },
];

const PRO_INZENJERING_TOOLS: ToolRegistration[] = [
  {
    id: "awg-to-mm2",
    titleKey: "pro.name.awg-to-mm2",
    blurbKey: "pro.blurb.awg-to-mm2",
    category: "electrical",
    riskClass: "life-safety",
    sourceKey: "pro.sources.astm-b258-18-iec-60028-1925-iec-60889-1987",
    packs: ["inzenjering", "muzika"],
    keywords: [
      "awg", "kilometru", "materijal", "mm2", "nazad", "otpornost", "precnik", "presek",
      "prevodi", "smer"
    ],
  },
  {
    id: "battery-bank-runtime",
    titleKey: "pro.name.battery-bank-runtime",
    blurbKey: "pro.blurb.battery-bank-runtime",
    category: "electrical",
    riskClass: "life-safety",
    packs: ["inzenjering", "foto", "transport"],
    keywords: [
      "autonomija", "bank", "baterija", "battery", "dod", "energiju", "iskoristivi",
      "korekcijom", "napon", "opterecenje", "opterecenjem", "paketa", "pojkertovom", "rada",
      "runtime", "unese", "vreme", "zadatim"
    ],
  },
  {
    id: "belt-and-gear-drive",
    titleKey: "pro.name.belt-and-gear-drive",
    blurbKey: "pro.blurb.belt-and-gear-drive",
    category: "geometry",
    riskClass: "life-safety",
    packs: ["inzenjering", "agro", "zanat"],
    keywords: [
      "and", "belt", "brzinu", "drive", "duzinu", "gear", "izlazni", "kais", "kaisa", "obrtaja",
      "obuhvata", "odnos", "osno", "otvorenog", "para", "prenos", "prenosni", "rastojanje",
      "tacnu", "uglove", "zupcastog"
    ],
  },
  {
    id: "cable-cross-section",
    titleKey: "pro.name.cable-cross-section",
    blurbKey: "pro.blurb.cable-cross-section",
    category: "electrical",
    riskClass: "life-safety",
    sourceKey: "pro.sources.iec-60028-1925-iec-60889-1987",
    packs: ["gradnja", "inzenjering"],
    keywords: [
      "aluminijuma", "bakra", "cable", "cross", "dobija", "dop", "izabere", "izabrano",
      "materijal", "najmanje", "napona", "pad", "pada", "presek", "preseku", "section",
      "sistem", "stane", "zada"
    ],
  },
  {
    id: "induction-motor-rating",
    titleKey: "pro.name.induction-motor-rating",
    blurbKey: "pro.blurb.induction-motor-rating",
    category: "electrical",
    riskClass: "life-safety",
    packs: ["inzenjering"],
    keywords: [
      "asinhroni", "brzinu", "cos", "induction", "klizanje", "moment", "motor", "natpisne",
      "nazivnu", "obrtni", "plocice", "podataka", "polova", "rating", "sinhronu", "sistem",
      "snagu", "struju", "ulaznu"
    ],
  },
  {
    id: "junction-temperature",
    titleKey: "pro.name.junction-temperature",
    blurbKey: "pro.blurb.junction-temperature",
    category: "calculation",
    riskClass: "none",
    packs: ["inzenjering"],
    keywords: [
      "ambijenta", "dozvoljenu", "hladnjaka", "junction", "lanca", "max", "obrnuto", "otpor",
      "otpora", "rth", "smer", "snage", "snagu", "spoja", "temperature", "temperaturu",
      "termicki", "termickih"
    ],
  },
  {
    id: "metric-thread-strength",
    titleKey: "pro.name.metric-thread-strength",
    blurbKey: "pro.blurb.metric-thread-strength",
    category: "structure",
    riskClass: "life-safety",
    sourceKey: "pro.sources.iso-68-1-1998-iso-898-1-2013",
    packs: ["gradnja", "inzenjering", "zanat"],
    keywords: [
      "burgije", "cvrstoci", "jezgreni", "koraka", "metric", "metricki", "napona", "navoj",
      "nominalnog", "odgovara", "precnik", "precnika", "presek", "silu", "srednji", "strength",
      "thread", "unese", "unutrasnji"
    ],
  },
  {
    id: "ohms-law-power",
    titleKey: "pro.name.ohms-law-power",
    blurbKey: "pro.blurb.ohms-law-power",
    category: "electrical",
    riskClass: "life-safety",
    packs: ["inzenjering"],
    keywords: [
      "cetiri", "law", "ohms", "omov", "par", "power", "preostale", "snaga", "velicine", "zakon"
    ],
  },
  {
    id: "pipe-flow-velocity",
    titleKey: "pro.name.pipe-flow-velocity",
    blurbKey: "pro.blurb.pipe-flow-velocity",
    category: "calculation",
    riskClass: "none",
    packs: ["gradnja", "inzenjering", "agro"],
    keywords: [
      "brzinu", "cev", "cevi", "flow", "maseni", "pipe", "povezuje", "poznata", "precnik",
      "protok", "rejnoldsov", "svojstava", "unese", "unutrasnji", "velicina", "velocity"
    ],
  },
  {
    id: "power-factor-correction",
    titleKey: "pro.name.power-factor-correction",
    blurbKey: "pro.blurb.power-factor-correction",
    category: "electrical",
    riskClass: "life-safety",
    packs: ["inzenjering"],
    keywords: [
      "baterije", "ciljani", "correction", "cos", "factor", "faktor", "kapacitivnost",
      "kompenzacija", "podigne", "postojeceg", "potrebne", "power", "reaktivne", "reaktivnu",
      "sistem", "snage", "snagu", "sprega", "struju"
    ],
  },
  {
    id: "pressure-and-piston-force",
    titleKey: "pro.name.pressure-and-piston-force",
    blurbKey: "pro.blurb.pressure-and-piston-force",
    category: "conversion",
    riskClass: "life-safety",
    packs: ["inzenjering", "transport", "agro", "zanat"],
    keywords: [
      "and", "apsolutnog", "atm", "bar", "cilindra", "force", "jedinica", "kgf", "klipa",
      "klipnjace", "klipu", "metre", "mmhg", "nadpritisak", "piston", "precnik", "pressure",
      "prevodi", "pritisak", "psi", "razlikuje", "sila", "silu", "strani", "stuba", "vodenog",
      "vrsta"
    ],
  },
  {
    id: "resistor-colour-code",
    titleKey: "pro.name.resistor-colour-code",
    blurbKey: "pro.blurb.resistor-colour-code",
    category: "conversion",
    riskClass: "none",
    sourceKey: "pro.sources.iec-60062-2016-iec-60063-2015",
    packs: ["inzenjering"],
    keywords: [
      "boje", "cita", "code", "colour", "najblizom", "niz", "niza", "opsegom", "otpornika",
      "prstenova", "prstenove", "prstenovi", "resistor", "smer", "tolerancija", "tolerancijom",
      "vraca", "vrednoscu"
    ],
  },
  {
    id: "rlc-impedance",
    titleKey: "pro.name.rlc-impedance",
    blurbKey: "pro.blurb.rlc-impedance",
    category: "electrical",
    riskClass: "life-safety",
    packs: ["inzenjering", "muzika"],
    keywords: [
      "fazni", "frekvenciji", "frekvenciju", "granicnu", "impedance", "impedansa", "impedansu",
      "reaktanse", "rezonansa", "rezonantnu", "rlc", "ugao", "veza", "zadatoj"
    ],
  },
  {
    id: "section-modulus",
    titleKey: "pro.name.section-modulus",
    blurbKey: "pro.blurb.section-modulus",
    category: "structure",
    riskClass: "life-safety",
    packs: ["gradnja", "inzenjering", "zanat"],
    keywords: [
      "cev", "dop", "inercije", "karakteristike", "krug", "modulus", "momente", "oblik",
      "otporne", "polarne", "poluprecnike", "povrsinu", "pravougaonik", "pravougaonu",
      "preseka", "profil", "section", "velicine"
    ],
  },
  {
    id: "series-parallel-network",
    titleKey: "pro.name.series-parallel-network",
    blurbKey: "pro.blurb.series-parallel-network",
    category: "electrical",
    riskClass: "life-safety",
    packs: ["inzenjering", "muzika"],
    keywords: [
      "delilac", "elementa", "elementu", "kalemove", "kondenzatore", "naponski", "network",
      "otpornike", "paralela", "paralelnoj", "parallel", "rednoj", "sabira", "series", "serija",
      "snagom", "tip", "veza", "vezi"
    ],
  },
  {
    id: "three-phase-power",
    titleKey: "pro.name.three-phase-power",
    blurbKey: "pro.blurb.three-phase-power",
    category: "electrical",
    riskClass: "life-safety",
    packs: ["gradnja", "inzenjering"],
    keywords: [
      "aktivnu", "cos", "faktora", "jednofaznoj", "linijsku", "mrezi", "phase", "povezuje",
      "power", "poznata", "prividnu", "reaktivnu", "sistem", "snaga", "snage", "snagu",
      "sprega", "struju", "three", "trofazna", "trofaznoj", "velicina"
    ],
  },
  {
    id: "torque-speed-power",
    titleKey: "pro.name.torque-speed-power",
    blurbKey: "pro.blurb.torque-speed-power",
    category: "calculation",
    riskClass: "life-safety",
    packs: ["inzenjering", "transport", "agro", "zanat"],
    keywords: [
      "kgf", "lbf", "moment", "obrtaja", "obrtni", "par", "povezuje", "power", "snaga", "snagu",
      "speed", "torque"
    ],
  },
];

const PRO_DIZAJN_TOOLS: ToolRegistration[] = [
  {
    id: "aspect-ratio-fit",
    titleKey: "pro.name.aspect-ratio-fit",
    blurbKey: "pro.blurb.aspect-ratio-fit",
    category: "geometry",
    riskClass: "none",
    packs: ["softver", "dizajn", "foto", "event"],
    keywords: [
      "aspect", "celobrojni", "dimenzije", "fit", "mode", "odnos", "odnosno", "okvir", "okvira",
      "popunjavanju", "ratio", "reza", "roundto", "sirini", "skraceni", "sourceheight",
      "sourcewidth", "stranica", "targetheight", "targetwidth", "traka", "uklapanju",
      "velicinom", "zadatoj"
    ],
  },
  {
    id: "baseline-rhythm",
    titleKey: "pro.name.baseline-rhythm",
    blurbKey: "pro.blurb.baseline-rhythm",
    category: "design",
    riskClass: "none",
    packs: ["softver", "dizajn", "tekst"],
    keywords: [
      "baseline", "columnheight", "fontsize", "gridunit", "kolonu", "lineheight",
      "lineheightunit", "mrezu", "osnovnu", "pada", "pikselima", "prored", "redova", "rhythm",
      "ritam", "snapmode", "staje", "vertikalni", "visine"
    ],
  },
  {
    id: "book-spine",
    titleKey: "pro.name.book-spine",
    blurbKey: "pro.blurb.book-spine",
    category: "geometry",
    riskClass: "none",
    packs: ["dizajn", "tekst"],
    keywords: [
      "book", "brojem", "bulk", "covercaliper", "coverheight", "coverwidth", "debljina",
      "extraallowance", "gramaturom", "grammage", "hrbat", "hrbata", "knjige", "korica",
      "measuredstack", "milimetara", "pagecount", "papercaliper", "papira", "razvijena",
      "spine", "strana", "voluminoznoscu", "zadatim"
    ],
  },
  {
    id: "column-grid",
    titleKey: "pro.name.column-grid",
    blurbKey: "pro.blurb.column-grid",
    category: "design",
    riskClass: "none",
    packs: ["softver", "dizajn"],
    keywords: [
      "column", "columns", "containerwidth", "grid", "gutter", "jedne", "kolona", "kolone",
      "marginu", "mincolumnwidth", "mreza", "najmanju", "oluk", "outermargin", "raspona",
      "sirina", "sirinu", "spancolumns", "staje"
    ],
  },
  {
    id: "copyfitting",
    titleKey: "pro.name.copyfitting",
    blurbKey: "pro.blurb.copyfitting",
    category: "text",
    riskClass: "none",
    packs: ["dizajn", "prosveta", "tekst"],
    keywords: [
      "averagecharacterwidth", "charactercount", "charactersperline", "columnheight",
      "columnsperpage", "columnwidth", "copyfitting", "kolona", "kolone", "lineheight",
      "linespercolumn", "obima", "proracun", "red", "reda", "redova", "sirini", "staje",
      "strana", "tacan", "targetpages", "tekst", "teksta", "visini", "zadatoj", "zauzeti",
      "znakova"
    ],
  },
  {
    id: "css-typographic-units",
    titleKey: "pro.name.css-typographic-units",
    blurbKey: "pro.blurb.css-typographic-units",
    category: "conversion",
    riskClass: "none",
    sourceKey: "pro.sources.css-units-and-android-dp",
    packs: ["softver", "dizajn", "tekst"],
    keywords: [
      "assetscale", "css", "devicedpi", "drugu", "fromunit", "inc", "jedinice", "jednu",
      "parentfontsize", "piku", "pretvara", "rem", "resursa", "rootfontsize", "tipografske",
      "typographic", "units", "velicinu"
    ],
  },
  {
    id: "delta-e",
    titleKey: "pro.name.delta-e",
    blurbKey: "pro.blurb.delta-e",
    category: "design",
    riskClass: "none",
    sourceKey: "pro.sources.cie-colour-difference",
    packs: ["dizajn", "foto"],
    keywords: [
      "boja", "boje", "brojcano", "ciede2000", "colour1", "colour2", "de94application", "delta",
      "e94", "formulama", "granicu", "postavlja", "prihvatljivosti", "razlika", "razlikuju",
      "rgbilluminant", "tumaci"
    ],
  },
  {
    id: "ean-barcode",
    titleKey: "pro.name.ean-barcode",
    blurbKey: "pro.blurb.ean-barcode",
    category: "data",
    riskClass: "none",
    sourceKey: "pro.sources.iso-iec-15420-ean-upc",
    packs: ["dizajn", "biznis", "transport"],
    keywords: [
      "barcode", "barkod", "cifru", "digits", "dimenziji", "ean", "kontrolnu", "simbola",
      "sirinu", "symbology", "upc", "verifydigits", "visinu", "xdimension", "zadatoj"
    ],
  },
  {
    id: "font-metrics-trim",
    titleKey: "pro.name.font-metrics-trim",
    blurbKey: "pro.blurb.font-metrics-trim",
    category: "design",
    riskClass: "none",
    packs: ["softver", "dizajn"],
    keywords: [
      "ascender", "ascendera", "capheight", "descender", "descendera", "font", "fonta",
      "fontsize", "legne", "linegap", "lineheight", "metrics", "metrike", "negativne", "odmake",
      "okvir", "pikselima", "teksta", "trim", "unitsperem", "verzal", "verzala", "visinu",
      "xheight"
    ],
  },
  {
    id: "iso-paper-sizes",
    titleKey: "pro.name.iso-paper-sizes",
    blurbKey: "pro.blurb.iso-paper-sizes",
    category: "geometry",
    riskClass: "none",
    sourceKey: "pro.sources.iso-216-paper-series",
    packs: ["dizajn", "prosveta", "tekst"],
    keywords: [
      "aparatu", "dimenzije", "formata", "formati", "iso", "kopir", "koverat", "list", "manjih",
      "matchtolerance", "measuredheight", "measuredwidth", "milimetarske", "paper", "papira",
      "prima", "procenat", "series", "sizes", "staje", "targetindex", "targetseries",
      "uvecanja", "veci"
    ],
  },
  {
    id: "modular-type-scale",
    titleKey: "pro.name.modular-type-scale",
    blurbKey: "pro.blurb.modular-type-scale",
    category: "design",
    riskClass: "none",
    packs: ["softver", "dizajn", "tekst"],
    keywords: [
      "basesize", "baseunit", "dobijen", "izabranim", "jedinicama", "mnozenjem", "modular",
      "niz", "odnosom", "osnovne", "pikselima", "ratio", "rem", "rootfontsize", "rounding",
      "scale", "skala", "slova", "stepsdown", "stepsup", "tackama", "tipografska", "velicina",
      "velicine"
    ],
  },
  {
    id: "paper-weight",
    titleKey: "pro.name.paper-weight",
    blurbKey: "pro.blurb.paper-weight",
    category: "materials",
    riskClass: "none",
    packs: ["dizajn", "tekst", "transport"],
    keywords: [
      "ceo", "gramatura", "gramaturi", "grammage", "izmerenog", "masa", "measuredmass", "paper",
      "papira", "ris", "rollmass", "rollwidth", "sheetcount", "sheetheight", "sheetwidth",
      "sveznja", "tabak", "tezi", "tiraz", "weight", "zadatoj"
    ],
  },
  {
    id: "print-resolution",
    titleKey: "pro.name.print-resolution",
    blurbKey: "pro.blurb.print-resolution",
    category: "conversion",
    riskClass: "none",
    packs: ["dizajn", "foto", "tekst", "zanat", "event"],
    keywords: [
      "bitsperchannel", "bleed", "channels", "direction", "heightpx", "milimetara",
      "nekomprimovana", "physicalheight", "physicalwidth", "piksela", "print", "resolution",
      "rezolucija", "rezoluciji", "scaledenominator", "sirini", "slika", "stampu", "stvarna",
      "velicina", "widthpx", "zadatoj", "zeljenoj"
    ],
  },
  {
    id: "roll-yield",
    titleKey: "pro.name.roll-yield",
    blurbKey: "pro.blurb.roll-yield",
    category: "materials",
    riskClass: "none",
    packs: ["dizajn", "zanat", "event"],
    keywords: [
      "allowrotation", "duznih", "gutter", "iskoristivost", "isplati", "komad", "komada",
      "leadtrailmargin", "metara", "odlazi", "okrenuti", "pieceheight", "piecewidth",
      "pricepermetre", "quantity", "roll", "rolllength", "rollwidth", "rolne", "sidemargin",
      "sirinu", "staje", "tiraz", "yield"
    ],
  },
  {
    id: "saddle-stitch-imposition",
    titleKey: "pro.name.saddle-stitch-imposition",
    blurbKey: "pro.blurb.saddle-stitch-imposition",
    category: "geometry",
    riskClass: "none",
    packs: ["dizajn", "tekst", "event"],
    keywords: [
      "idu", "imposition", "klamovane", "knjizice", "kod", "ostaje", "pagecount", "praznih",
      "saddle", "signaturesize", "slog", "startpage", "stitch", "strana", "strane", "stranu",
      "tabaka"
    ],
  },
  {
    id: "sheet-imposition",
    titleKey: "pro.name.sheet-imposition",
    blurbKey: "pro.blurb.sheet-imposition",
    category: "geometry",
    riskClass: "none",
    packs: ["gradnja", "dizajn", "zanat", "event"],
    keywords: [
      "allowrotation", "gutter", "imposition", "komada", "marginama", "marginbottom",
      "marginleft", "marginright", "margintop", "otpad", "pieceheight", "piecewidth",
      "polozaja", "razmakom", "requiredquantity", "rez", "sheet", "sheetheight", "sheetwidth",
      "staje", "tabak", "uklapanje", "velicine"
    ],
  },
];

const PRO_FOTO_TOOLS: ToolRegistration[] = [
  {
    id: "angle-of-view",
    titleKey: "pro.name.angle-of-view",
    blurbKey: "pro.blurb.angle-of-view",
    category: "geometry",
    riskClass: "none",
    packs: ["inzenjering", "foto", "zanat"],
    keywords: [
      "angle", "daljinu", "dijagonali", "dimenzije", "distance", "focal", "height", "kadar",
      "length", "metara", "obuhvata", "polja", "rastojanju", "sensor", "senzora", "sirini",
      "snimanja", "subject", "ugao", "unete", "vidnog", "view", "visini", "width", "ziznu"
    ],
  },
  {
    id: "crop-factor",
    titleKey: "pro.name.crop-factor",
    blurbKey: "pro.blurb.crop-factor",
    category: "conversion",
    riskClass: "none",
    sourceKey: "pro.sources.iso-1007-135-format",
    packs: ["foto"],
    keywords: [
      "blendu", "crop", "daljinu", "dimenzija", "ekvivalent", "factor", "faktor", "focal",
      "format", "height", "kadar", "length", "number", "odnosu", "preracunava", "pun", "sensor",
      "senzora", "unetih", "width", "ziznu"
    ],
  },
  {
    id: "depth-of-field",
    titleKey: "pro.name.depth-of-field",
    blurbKey: "pro.blurb.depth-of-field",
    category: "geometry",
    riskClass: "none",
    packs: ["foto"],
    keywords: [
      "blendu", "blizu", "circle", "coc", "confusion", "daljinu", "dalju", "depth", "diagonal",
      "distance", "dubinska", "focal", "focus", "fokusa", "granicu", "hiperfokalnu", "krug",
      "length", "number", "ostrina", "ostrine", "rasipanja", "rastojanje", "sensor", "ziznu"
    ],
  },
  {
    id: "diffraction-limit",
    titleKey: "pro.name.diffraction-limit",
    blurbKey: "pro.blurb.diffraction-limit",
    category: "calculation",
    riskClass: "none",
    packs: ["foto"],
    keywords: [
      "blendu", "count", "diffraction", "difrakcija", "disk", "diska", "dostigne", "erijevog",
      "horizontal", "jednog", "lambda", "limit", "number", "piksela", "pixel", "precnik",
      "sensor", "senzora", "velicinu", "wavelength", "width"
    ],
  },
  {
    id: "exposure-equivalent",
    titleKey: "pro.name.exposure-equivalent",
    blurbKey: "pro.blurb.exposure-equivalent",
    category: "calculation",
    riskClass: "none",
    packs: ["foto"],
    keywords: [
      "blendama", "blende", "ekspozicija", "ekspoziciju", "ekvivalentna", "equivalent",
      "exposure", "iso", "istu", "jedne", "kombinacije", "nalazi", "number", "razliku",
      "reference", "sensitivity", "shutter", "target", "time", "trecu", "zatvaraca"
    ],
  },
  {
    id: "flash-guide-number",
    titleKey: "pro.name.flash-guide-number",
    blurbKey: "pro.blurb.flash-guide-number",
    category: "calculation",
    riskClass: "none",
    packs: ["foto"],
    keywords: [
      "blendu", "blica", "broja", "distance", "flash", "guide", "iso", "number", "osvetljenja",
      "preracunava", "promeni", "promenu", "rastojanja", "second", "sensitivity", "subject",
      "vodeceg", "vodeci"
    ],
  },
  {
    id: "frame-rate-conform",
    titleKey: "pro.name.frame-rate-conform",
    blurbKey: "pro.blurb.frame-rate-conform",
    category: "time",
    riskClass: "none",
    sourceKey: "pro.sources.ntsc-1000-1001-rates",
    packs: ["foto", "muzika"],
    keywords: [
      "brzine", "brzinu", "capture", "clip", "conform", "count", "duration", "factor", "frame",
      "jedne", "kadrova", "konform", "legne", "length", "motion", "novo", "odnosu", "original",
      "pomeraj", "rate", "reprodukcije", "slow", "snimak", "tajmlajn", "target", "timeline",
      "trajanje", "usporenje"
    ],
  },
  {
    id: "illuminance-to-aperture",
    titleKey: "pro.name.illuminance-to-aperture",
    blurbKey: "pro.blurb.illuminance-to-aperture",
    category: "conversion",
    riskClass: "none",
    sourceKey: "pro.sources.international-foot-1959",
    packs: ["gradnja", "inzenjering", "foto", "event"],
    keywords: [
      "aperture", "blendu", "calibration", "constant", "fut", "illuminance", "incident", "iso",
      "its", "kalibracije", "kandele", "konstantu", "luks", "meter", "pretvara", "sensitivity",
      "shutter", "svetlomera", "time", "tvog", "unit", "vreme", "with", "zatvaraca"
    ],
  },
  {
    id: "mired-shift",
    titleKey: "pro.name.mired-shift",
    blurbKey: "pro.blurb.mired-shift",
    category: "conversion",
    riskClass: "none",
    packs: ["foto", "event"],
    keywords: [
      "apply", "boje", "colour", "dobija", "korekcija", "korekcije", "mired", "miredima",
      "razliku", "shift", "source", "target", "temperature", "temperaturu"
    ],
  },
  {
    id: "motion-blur",
    titleKey: "pro.name.motion-blur",
    blurbKey: "pro.blurb.motion-blur",
    category: "calculation",
    riskClass: "none",
    packs: ["foto"],
    keywords: [
      "acceptable", "blur", "broja", "count", "distance", "ekspozicije", "focal", "horizontal",
      "length", "motion", "piksela", "pixel", "pokreta", "razmaze", "sensor", "shutter",
      "speed", "subject", "subjekat", "time", "tokom", "unutar", "width", "zadatog", "zadrzava",
      "zamucenje", "zatvarac"
    ],
  },
  {
    id: "nd-filter-exposure",
    titleKey: "pro.name.nd-filter-exposure",
    blurbKey: "pro.blurb.nd-filter-exposure",
    category: "calculation",
    riskClass: "none",
    packs: ["foto"],
    keywords: [
      "additional", "base", "blendi", "density", "ekspozicije", "exactly", "exposure", "factor",
      "faktora", "filter", "filtera", "filters", "given", "gustine", "jacinu", "one", "optical",
      "opticke", "pretvara", "shutter", "stacked", "stops", "strength", "time", "vreme"
    ],
  },
  {
    id: "pq-nits",
    titleKey: "pro.name.pq-nits",
    blurbKey: "pro.blurb.pq-nits",
    category: "conversion",
    riskClass: "none",
    sourceKey: "pro.sources.smpte-st-2084-pq",
    packs: ["softver", "foto"],
    keywords: [
      "bit", "bitni", "code", "depth", "kod", "krivoj", "luminance", "luminanciju", "nazad",
      "nitovi", "nitovima", "nits", "normalised", "opsegu", "pretvara", "punom", "range",
      "signal", "suzenom"
    ],
  },
  {
    id: "raster-image-size",
    titleKey: "pro.name.raster-image-size",
    blurbKey: "pro.blurb.raster-image-size",
    category: "media",
    riskClass: "none",
    packs: ["softver", "dizajn", "foto"],
    keywords: [
      "available", "average", "bit", "bita", "broja", "capacity", "channel", "channels",
      "count", "depth", "dimenzija", "dubine", "fajlova", "file", "frame", "height", "image",
      "kanala", "known", "layer", "nekompresovana", "per", "prostor", "raster", "rastera",
      "size", "slike", "staje", "takvih", "velicina", "width"
    ],
  },
  {
    id: "smpte-timecode",
    titleKey: "pro.name.smpte-timecode",
    blurbKey: "pro.blurb.smpte-timecode",
    category: "time",
    riskClass: "none",
    sourceKey: "pro.sources.smpte-st-12-1-timecode",
    packs: ["foto", "muzika", "tekst", "event"],
    keywords: [
      "count", "drop", "frame", "kadrove", "notaciju", "oduzima", "operation", "pretvara",
      "proteklo", "rate", "sabira", "smpte", "tajmkod", "timecode", "ukljucujuci", "vreme"
    ],
  },
  {
    id: "timelapse-planner",
    titleKey: "pro.name.timelapse-planner",
    blurbKey: "pro.blurb.timelapse-planner",
    category: "time",
    riskClass: "none",
    sourceKey: "pro.sources.smpte-broadcast-frame-rates",
    packs: ["gradnja", "foto", "event"],
    keywords: [
      "between", "clip", "count", "duration", "duzinu", "faktor", "fps", "frame", "frames",
      "gotovog", "interval", "kadrova", "klipa", "length", "per", "planner", "povezuje", "rate",
      "shooting", "shutter", "snimanja", "tajmlaps", "time", "timelapse", "timeline",
      "trajanje", "ubrzanja"
    ],
  },
  {
    id: "video-bitrate-storage",
    titleKey: "pro.name.video-bitrate-storage",
    blurbKey: "pro.blurb.video-bitrate-storage",
    category: "media",
    riskClass: "none",
    packs: ["softver", "foto", "muzika", "event"],
    keywords: [
      "audio", "bitrate", "bitrejt", "capacity", "card", "cards", "copies", "disk", "duration",
      "fajla", "file", "kapaciteta", "kartica", "karticu", "number", "size", "snimka", "staje",
      "storage", "trajanje", "velicinu", "veze", "video", "zadatog"
    ],
  },
];

const PRO_MUZIKA_TOOLS: ToolRegistration[] = [
  {
    id: "audio-level-reference",
    titleKey: "pro.name.audio-level-reference",
    blurbKey: "pro.blurb.audio-level-reference",
    category: "conversion",
    riskClass: "none",
    packs: ["inzenjering", "muzika", "zanat", "event"],
    keywords: [
      "audio", "dbm", "dbu", "dbv", "efektivnog", "for", "impedance", "level", "linijskog",
      "medjuvrsnog", "napona", "nivo", "peak", "prevodi", "reference", "rms", "signala",
      "voltage", "volti", "vrsnog"
    ],
  },
  {
    id: "bar-duration",
    titleKey: "pro.name.bar-duration",
    blurbKey: "pro.blurb.bar-duration",
    category: "time",
    riskClass: "none",
    packs: ["muzika"],
    keywords: [
      "bar", "bars", "denominator", "duration", "number", "numerator", "obrnuto", "signature",
      "stane", "taktova", "taktu", "tempo", "tempu", "time", "trajanje", "traje"
    ],
  },
  {
    id: "bpm-delay-times",
    titleKey: "pro.name.bpm-delay-times",
    blurbKey: "pro.blurb.bpm-delay-times",
    category: "time",
    riskClass: "none",
    packs: ["muzika"],
    keywords: [
      "bpm", "delay", "frekvenciju", "lfo", "milisekundama", "modifier", "note", "notnu",
      "pravu", "pripadajucu", "svaku", "tackom", "tempo", "tempu", "times", "triolsku", "vreme",
      "vremena"
    ],
  },
  {
    id: "cents-ratio",
    titleKey: "pro.name.cents-ratio",
    blurbKey: "pro.blurb.cents-ratio",
    category: "conversion",
    riskClass: "none",
    packs: ["muzika", "prosveta"],
    keywords: [
      "cente", "centi", "cents", "frekvencija", "frekvencije", "frekvenciju", "frequency",
      "interval", "odnos", "polutonove", "pretvara", "rastimavanja", "ratio", "razliku"
    ],
  },
  {
    id: "compressor-curve",
    titleKey: "pro.name.compressor-curve",
    blurbKey: "pro.blurb.compressor-curve",
    category: "media",
    riskClass: "none",
    packs: ["muzika"],
    keywords: [
      "compressor", "curve", "desava", "gain", "izlazni", "knee", "koleno", "kompresora",
      "kriva", "level", "makeup", "nivo", "nivoom", "odnos", "pojacanja", "pokazuje", "prag",
      "ratio", "redukciju", "threshold", "ulaznim", "width"
    ],
  },
  {
    id: "decibel-ratio",
    titleKey: "pro.name.decibel-ratio",
    blurbKey: "pro.blurb.decibel-ratio",
    category: "conversion",
    riskClass: "none",
    packs: ["gradnja", "inzenjering", "muzika"],
    keywords: [
      "amplitudu", "decibel", "decibele", "decibeli", "decibelima", "decibels", "levels",
      "linear", "linearni", "list", "natrag", "nivoa", "odnos", "odnosi", "posebno", "pretvara",
      "quantity", "ratio", "sabira", "snagu"
    ],
  },
  {
    id: "note-frequency",
    titleKey: "pro.name.note-frequency",
    blurbKey: "pro.blurb.note-frequency",
    category: "conversion",
    riskClass: "none",
    sourceKey: "pro.sources.iso-16-1975",
    packs: ["muzika", "prosveta"],
    keywords: [
      "centima", "for", "frekvencija", "frekvenciju", "frequency", "jednakoj", "midi",
      "najblizu", "name", "nota", "notation", "note", "notu", "number", "octave", "odstupanje",
      "oktavu", "pitch", "prevodi", "reference", "scientific", "temperaciji", "upisanu", "with"
    ],
  },
  {
    id: "pcm-file-size",
    titleKey: "pro.name.pcm-file-size",
    blurbKey: "pro.blurb.pcm-file-size",
    category: "media",
    riskClass: "none",
    sourceKey: "pro.sources.riff-wave-1991",
    packs: ["softver", "foto", "muzika"],
    keywords: [
      "bit", "broju", "byte", "channel", "count", "depth", "duration", "duzine", "estimate",
      "file", "for", "frekvenciji", "header", "include", "kanala", "nekompresovan", "pcm",
      "podataka", "protok", "rate", "rezoluciji", "sample", "session", "size", "snimak", "the",
      "track", "velicina", "wav", "zadatoj", "zapisa", "zauzima"
    ],
  },
  {
    id: "reverb-time",
    titleKey: "pro.name.reverb-time",
    blurbKey: "pro.blurb.reverb-time",
    category: "calculation",
    riskClass: "none",
    packs: ["gradnja", "inzenjering", "muzika", "event"],
    keywords: [
      "absorption", "air", "alpha", "apsorpcije", "area", "coefficient", "eyringovoj",
      "formuli", "koeficijentima", "povrsina", "prostorije", "reverb", "reverberacije", "room",
      "rows", "rt60", "sabineovoj", "surface", "temperature", "time", "upisanim", "volume",
      "vreme", "zapremine"
    ],
  },
  {
    id: "room-modes",
    titleKey: "pro.name.room-modes",
    blurbKey: "pro.blurb.room-modes",
    category: "calculation",
    riskClass: "none",
    packs: ["gradnja", "inzenjering", "dizajn", "muzika"],
    keywords: [
      "air", "aksijalne", "axis", "dimenzija", "frequency", "gomilaju", "height", "jednacini",
      "kose", "length", "limit", "maximum", "mode", "modes", "modove", "modovi", "order", "per",
      "pokazuje", "prostorije", "rejlijevoj", "room", "sopstvene", "tangencijalne",
      "temperature", "upper", "width"
    ],
  },
  {
    id: "sample-buffer-latency",
    titleKey: "pro.name.sample-buffer-latency",
    blurbKey: "pro.blurb.sample-buffer-latency",
    category: "media",
    riskClass: "none",
    packs: ["softver", "muzika"],
    keywords: [
      "bafera", "baferi", "buffer", "converter", "count", "driver", "duration", "extra",
      "frekvenciji", "jednom", "kasnjenje", "latencija", "latency", "milisekunde", "odabiranja",
      "odbirke", "pretvara", "rate", "sample", "size", "smera", "velicinu", "zadatoj"
    ],
  },
  {
    id: "scale-chord-speller",
    titleKey: "pro.name.scale-chord-speller",
    blurbKey: "pro.blurb.scale-chord-speller",
    category: "data",
    riskClass: "none",
    packs: ["muzika", "prosveta"],
    keywords: [
      "accidental", "akorda", "akordi", "brojem", "chord", "intervalima", "ispisuje", "note",
      "osnovni", "predznaka", "redosledu", "root", "scale", "skale", "slovnom", "speller",
      "stupnjevima", "ton", "tonove", "trozvucima", "with"
    ],
  },
  {
    id: "sound-wavelength",
    titleKey: "pro.name.sound-wavelength",
    blurbKey: "pro.blurb.sound-wavelength",
    category: "calculation",
    riskClass: "none",
    packs: ["gradnja", "inzenjering", "muzika"],
    keywords: [
      "air", "brzinu", "cetvrtinu", "distance", "duzina", "duzinu", "frekvenciju", "frequency",
      "kasnjenje", "njenu", "predjenom", "rastojanju", "sound", "talasna", "talasnu",
      "temperature", "temperaturu", "vazduha", "wavelength", "zvuka"
    ],
  },
  {
    id: "speaker-load",
    titleKey: "pro.name.speaker-load",
    blurbKey: "pro.blurb.speaker-load",
    category: "electrical",
    riskClass: "life-safety",
    packs: ["inzenjering", "muzika", "zanat", "event"],
    keywords: [
      "amplifier", "assignment", "cabinet", "delivered", "dobija", "each", "for", "group",
      "impedance", "impedansa", "impedansu", "into", "kutija", "load", "minimum", "paralelno",
      "parallel", "power", "rated", "redno", "resulting", "series", "snaga", "snage", "speaker",
      "the", "ukupnu", "vezane", "wiring", "zvucnika", "zvucnike"
    ],
  },
  {
    id: "spl-distance",
    titleKey: "pro.name.spl-distance",
    blurbKey: "pro.blurb.spl-distance",
    category: "calculation",
    riskClass: "life-safety",
    packs: ["gradnja", "inzenjering", "muzika", "event"],
    keywords: [
      "applied", "difference", "distance", "for", "gubi", "half", "kutije", "level", "limit",
      "nivo", "osetljivost", "power", "pritiska", "rastojanja", "reference", "second",
      "sensitivity", "snagu", "sound", "spl", "the", "udaljenosti", "udvostrucavanjem",
      "upisanu", "zadatoj", "zvucnog"
    ],
  },
  {
    id: "transposition",
    titleKey: "pro.name.transposition",
    blurbKey: "pro.blurb.transposition",
    category: "conversion",
    riskClass: "none",
    packs: ["muzika", "prosveta"],
    keywords: [
      "akordske", "chord", "direction", "instrumenata", "instrument", "interval", "key",
      "notes", "octave", "oznake", "pair", "realnog", "shift", "source", "stima", "symbols",
      "tonove", "transponuje", "transponujucih", "transposition", "transpozicija", "upisane",
      "zvuka"
    ],
  },
  {
    id: "varispeed-repitch",
    titleKey: "pro.name.varispeed-repitch",
    blurbKey: "pro.blurb.varispeed-repitch",
    category: "media",
    riskClass: "none",
    packs: ["muzika"],
    keywords: [
      "brzina", "brzine", "centima", "dobijeni", "dobijeno", "frekvenciji", "jednoj", "length",
      "odnos", "odsvira", "original", "pitch", "pomeraj", "promeni", "rastimovanje", "rate",
      "ratio", "repitch", "sample", "semitones", "semplu", "shift", "snimak", "source", "speed",
      "sviran", "target", "tempo", "trajanje", "varispeed", "visina"
    ],
  },
];

const PRO_PROSVETA_TOOLS: ToolRegistration[] = [
  {
    id: "average-to-target",
    titleKey: "pro.name.average-to-target",
    blurbKey: "pro.blurb.average-to-target",
    category: "calculation",
    riskClass: "none",
    packs: ["prosveta"],
    keywords: [
      "average", "cilj", "cilja", "ciljni", "dodatne", "dostigao", "izdrzi", "jos", "ocena",
      "ocene", "padne", "postojece", "prosek", "proseka", "slabijih", "target"
    ],
  },
  {
    id: "child-age",
    titleKey: "pro.name.child-age",
    blurbKey: "pro.blurb.child-age",
    category: "time",
    riskClass: "none",
    packs: ["prosveta", "trening", "pravo"],
    keywords: [
      "age", "child", "dan", "dana", "danima", "datum", "deteta", "godina", "godinama",
      "meseci", "mesecima", "navrsava", "navrsenih", "osoba", "rodjendana", "rodjenja", "trazi",
      "ukupan", "uzrast"
    ],
  },
  {
    id: "combinatorics",
    titleKey: "pro.name.combinatorics",
    blurbKey: "pro.blurb.combinatorics",
    category: "calculation",
    riskClass: "none",
    packs: ["softver", "prosveta"],
    keywords: [
      "aritmetici", "brojevi", "celobrojnoj", "combinatorics", "faktorijel", "kombinacije",
      "kombinatorika", "permutacije", "ponavljanja", "ponavljanjem", "varijacije",
      "zaokruzivanja"
    ],
  },
  {
    id: "fractions-decimals",
    titleKey: "pro.name.fractions-decimals",
    blurbKey: "pro.blurb.fractions-decimals",
    category: "calculation",
    riskClass: "none",
    packs: ["prosveta", "kuhinja", "zanat"],
    keywords: [
      "aritmetici", "celobrojnoj", "decimale", "decimalni", "decimals", "decimalu", "deli",
      "fractions", "mesovit", "mnozi", "nazad", "obelezenim", "oduzima", "operacija",
      "periodicnu", "periodom", "razlomak", "razlomci", "razlomke", "sabira", "skracuje",
      "vraca", "zapis"
    ],
  },
  {
    id: "grade-scale-points",
    titleKey: "pro.name.grade-scale-points",
    blurbKey: "pro.blurb.grade-scale-points",
    category: "calculation",
    riskClass: "none",
    packs: ["prosveta"],
    keywords: [
      "bodova", "bodovanja", "bodovi", "bodovna", "grade", "korak", "maksimalan", "maksimumom",
      "opseg", "osvojeni", "oznaku", "points", "pokazuje", "pragove", "pragovi", "pretvara",
      "procentualne", "scale", "skala", "testa", "testu", "upise", "zadatim"
    ],
  },
  {
    id: "grade-statistics",
    titleKey: "pro.name.grade-statistics",
    blurbKey: "pro.blurb.grade-statistics",
    category: "data",
    riskClass: "none",
    packs: ["prosveta", "trening", "biznis", "agro"],
    keywords: [
      "bodova", "devijaciju", "grade", "kvartile", "medijanu", "modu", "niz", "ocena", "prag",
      "praga", "prolaznosti", "prosek", "raspodelu", "standardnu", "statistics", "statistika",
      "udeo", "upise", "vrednostima"
    ],
  },
  {
    id: "guessing-correction",
    titleKey: "pro.name.guessing-correction",
    blurbKey: "pro.blurb.guessing-correction",
    category: "calculation",
    riskClass: "none",
    packs: ["prosveta"],
    keywords: [
      "bodova", "cist", "correction", "doneo", "doprinos", "guessing", "izborom", "korekcija",
      "neodgovorenih", "netacnih", "ocekivani", "odgovora", "pitanja", "pitanju", "pogadjanja",
      "pogadjanje", "pogodak", "pokazuje", "ponudjenih", "proseku", "tacnih", "test", "ukupan",
      "umanjen", "visestrukim"
    ],
  },
  {
    id: "item-analysis",
    titleKey: "pro.name.item-analysis",
    blurbKey: "pro.blurb.item-analysis",
    category: "data",
    riskClass: "none",
    packs: ["prosveta"],
    keywords: [
      "analiza", "analysis", "bolje", "boljoj", "diskriminacije", "grupe", "grupi", "indeks",
      "item", "lakoce", "odgovora", "razliku", "resili", "slabije", "slabijoj", "tacni",
      "tacnih", "tacno", "testa", "ucenika", "udeo", "ukupan", "uspesnosti", "velicina",
      "zadatak", "zadatka"
    ],
  },
  {
    id: "lesson-count-period",
    titleKey: "pro.name.lesson-count-period",
    blurbKey: "pro.blurb.lesson-count-period",
    category: "time",
    riskClass: "none",
    sourceKey: "pro.sources.iso-8601-2019-weekday",
    packs: ["prosveta", "trening", "biznis", "event"],
    keywords: [
      "brojem", "broji", "casa", "casova", "count", "dani", "danima", "datum", "datume",
      "datumi", "fond", "izabranim", "izuzeti", "jednog", "krajnji", "lesson", "minute",
      "nedelji", "neradne", "pada", "period", "pocetni", "predmeta", "pretvara", "rucno",
      "sate", "termina", "trajanje", "upisane"
    ],
  },
  {
    id: "lesson-timeline",
    titleKey: "pro.name.lesson-timeline",
    blurbKey: "pro.blurb.lesson-timeline",
    category: "time",
    riskClass: "none",
    packs: ["muzika", "prosveta", "trening", "event"],
    keywords: [
      "aktivnosti", "casa", "lesson", "minutu", "pocetka", "pojedinih", "pokazuje", "pravi",
      "prekoracuje", "preostaje", "raspored", "satu", "tempo", "timeline", "trajanja",
      "trajanje", "vreme", "vremena"
    ],
  },
  {
    id: "split-into-groups",
    titleKey: "pro.name.split-into-groups",
    blurbKey: "pro.blurb.split-into-groups",
    category: "calculation",
    riskClass: "none",
    packs: ["prosveta", "trening", "event"],
    keywords: [
      "brojem", "deli", "groups", "grupa", "grupe", "into", "moguce", "najravnomernije",
      "odeljenje", "podela", "poklopi", "split", "ucenika", "velicina", "velicine", "zbir"
    ],
  },
  {
    id: "standard-score",
    titleKey: "pro.name.standard-score",
    blurbKey: "pro.blurb.standard-score",
    category: "data",
    riskClass: "none",
    sourceKey: "pro.sources.mccall-t-score-1922",
    packs: ["prosveta", "trening"],
    keywords: [
      "aritmeticka", "bod", "ciljna", "devijacija", "devijaciji", "obrnuti", "pretvara",
      "racun", "score", "sirov", "sredina", "sredini", "standard", "standardna", "standardni",
      "standardnoj", "upise", "vraca"
    ],
  },
  {
    id: "test-printing",
    titleKey: "pro.name.test-printing",
    blurbKey: "pro.blurb.test-printing",
    category: "materials",
    riskClass: "financial",
    packs: ["dizajn", "prosveta", "biznis", "event"],
    keywords: [
      "cena", "ceni", "dvostrano", "iznos", "lista", "listova", "listu", "ostaje", "otvara",
      "pakovanja", "pakovanju", "papira", "poledjina", "prazno", "primeraka", "primerku",
      "printing", "stampanje", "strana", "test", "testa", "testova", "umnozavanje", "upise"
    ],
  },
  {
    id: "topic-hour-allocation",
    titleKey: "pro.name.topic-hour-allocation",
    blurbKey: "pro.blurb.topic-hour-allocation",
    category: "calculation",
    riskClass: "none",
    packs: ["prosveta", "racunovodstvo", "biznis", "event"],
    keywords: [
      "allocation", "brojevima", "casova", "celim", "fond", "hour", "nastavne", "raspodela",
      "raspodeljuje", "sabiraju", "temama", "teme", "topic", "udelima", "ukupan", "zadatim"
    ],
  },
  {
    id: "weighted-grade",
    titleKey: "pro.name.weighted-grade",
    blurbKey: "pro.blurb.weighted-grade",
    category: "calculation",
    riskClass: "none",
    packs: ["prosveta", "event"],
    keywords: [
      "bodova", "ciljni", "grade", "imaju", "komponenta", "komponente", "komponenti",
      "maksimum", "nedostaje", "ocena", "ocenjivanja", "ponderisana", "preostala", "preostaloj",
      "preslikava", "procenat", "razlicit", "razlicitu", "sabira", "tezinu", "ukupan",
      "weighted", "zeljeni"
    ],
  },
];

const PRO_TEKST_TOOLS: ToolRegistration[] = [
  {
    id: "bracket-balance",
    titleKey: "pro.name.bracket-balance",
    blurbKey: "pro.blurb.bracket-balance",
    category: "text",
    riskClass: "none",
    sourceKey: "pro.sources.unicode-16-code-charts",
    packs: ["softver", "tekst", "pravo"],
    keywords: [
      "balance", "bracket", "koloni", "kom", "navodnici", "navodnik", "pokazuje", "redu",
      "stoji", "tekst", "zagrada", "zagrade", "zatvoren"
    ],
  },
  {
    id: "glossary-check",
    titleKey: "pro.name.glossary-check",
    blurbKey: "pro.blurb.glossary-check",
    category: "text",
    riskClass: "none",
    packs: ["tekst", "pravo"],
    keywords: [
      "celu", "check", "glossary", "mala", "nalepis", "original", "originala", "pojavio",
      "pojmova", "prevod", "prevodu", "proverava", "puta", "razlikuj", "rec", "recnik", "slova",
      "termin", "terminologije", "trazi", "velika"
    ],
  },
  {
    id: "hidden-characters",
    titleKey: "pro.name.hidden-characters",
    blurbKey: "pro.blurb.hidden-characters",
    category: "text",
    riskClass: "none",
    sourceKey: "pro.sources.unicode-16-code-charts",
    packs: ["softver", "dizajn", "tekst", "racunovodstvo"],
    keywords: [
      "characters", "cirilica", "cisti", "hidden", "kojima", "kontrolne", "latinica",
      "nevidljive", "pomesane", "pronalazi", "reci", "skriveni", "tekst", "tekstu", "znakove",
      "znakovi"
    ],
  },
  {
    id: "isbn-issn-check",
    titleKey: "pro.name.isbn-issn-check",
    blurbKey: "pro.blurb.isbn-issn-check",
    category: "data",
    riskClass: "none",
    sourceKey: "pro.sources.isbn-issn-ismn-ean-check-digits",
    packs: ["muzika", "prosveta", "tekst", "biznis"],
    keywords: [
      "broja", "check", "cifru", "ean", "isbn", "ismn", "issn", "kontrolnu", "nazad",
      "pretvara", "proverava", "vrsta"
    ],
  },
  {
    id: "mojibake-repair",
    titleKey: "pro.name.mojibake-repair",
    blurbKey: "pro.blurb.mojibake-repair",
    category: "conversion",
    riskClass: "none",
    sourceKey: "pro.sources.whatwg-encoding-standard",
    packs: ["softver", "tekst", "racunovodstvo"],
    keywords: [
      "birajuci", "ispravna", "kodiranja", "kodiranjem", "mojibake", "pisan", "pisano",
      "pokvarene", "popravka", "procitan", "procitano", "repair", "slova", "tekst", "tipa",
      "vraca", "znakove"
    ],
  },
  {
    id: "number-check",
    titleKey: "pro.name.number-check",
    blurbKey: "pro.blurb.number-check",
    category: "text",
    riskClass: "financial",
    packs: ["tekst", "pravo", "racunovodstvo"],
    keywords: [
      "brojeva", "brojeve", "check", "javlja", "nedostaje", "number", "original", "originalu",
      "pogresno", "prepisan", "prevod", "prevodu", "uporedjuje"
    ],
  },
  {
    id: "number-to-serbian-words",
    titleKey: "pro.name.number-to-serbian-words",
    blurbKey: "pro.blurb.number-to-serbian-words",
    category: "conversion",
    riskClass: "financial",
    sourceKey: "pro.sources.serbian-numerals-orthography",
    packs: ["tekst", "pravo", "racunovodstvo", "biznis", "nekretnine"],
    keywords: [
      "decimale", "hiljadu", "ispisuje", "ispravnim", "milijardu", "milion", "number", "oblik",
      "oblikom", "pismo", "recima", "serbian", "slovima", "srpskom", "words"
    ],
  },
  {
    id: "reading-time",
    titleKey: "pro.name.reading-time",
    blurbKey: "pro.blurb.reading-time",
    category: "time",
    riskClass: "none",
    packs: ["prosveta", "tekst", "event"],
    keywords: [
      "citanja", "citanje", "naglas", "pasus", "pasusa", "pauza", "reading", "svakog", "tekst",
      "teksta", "tempo", "tempu", "time", "trajanje", "traje", "ulaska", "upises", "vremenom"
    ],
  },
  {
    id: "sentence-length",
    titleKey: "pro.name.sentence-length",
    blurbKey: "pro.blurb.sentence-length",
    category: "text",
    riskClass: "none",
    sourceKey: "pro.sources.unicode-16-code-charts",
    packs: ["prosveta", "tekst"],
    keywords: [
      "broja", "deli", "duze", "duzina", "length", "napisanom", "pokazuje", "prag", "pravilu",
      "recenica", "recenice", "reci", "sentence", "tekst", "zadatog"
    ],
  },
  {
    id: "serbian-transliteration",
    titleKey: "pro.name.serbian-transliteration",
    blurbKey: "pro.blurb.serbian-transliteration",
    category: "text",
    riskClass: "none",
    sourceKey: "pro.sources.iso-9-1995-serbian",
    packs: ["dizajn", "prosveta", "tekst", "pravo"],
    keywords: [
      "cirilice", "dvosmisleno", "kojima", "latinicu", "nazad", "prebacuje", "preslovljavanje",
      "serbian", "smer", "srpski", "tekst", "transliteration"
    ],
  },
  {
    id: "subtitle-audit",
    titleKey: "pro.name.subtitle-audit",
    blurbKey: "pro.blurb.subtitle-audit",
    category: "time",
    riskClass: "none",
    packs: ["foto", "tekst"],
    keywords: [
      "audit", "bloka", "bloku", "duzina", "granice", "izmerenu", "meri", "najduze", "najkrace",
      "najmanji", "najvise", "oznake", "pokazuje", "pored", "razmak", "reda", "redova", "redu",
      "sekundi", "sledeceg", "subtitle", "tipa", "titl", "titlova", "trajanje", "upisao",
      "znakova", "znakove"
    ],
  },
  {
    id: "subtitle-retime",
    titleKey: "pro.name.subtitle-retime",
    blurbKey: "pro.blurb.subtitle-retime",
    category: "time",
    riskClass: "none",
    sourceKey: "pro.sources.smpte-st-12-1-2014",
    packs: ["foto", "tekst", "event"],
    keywords: [
      "blokove", "ciljni", "oznake", "polazni", "pomera", "pomeraj", "pomeranje", "prenumerisi",
      "preracunava", "retime", "sekundi", "slika", "srt", "subtitle", "titl", "titlova",
      "titlu", "vremenske", "vtt"
    ],
  },
  {
    id: "translation-volume",
    titleKey: "pro.name.translation-volume",
    blurbKey: "pro.blurb.translation-volume",
    category: "text",
    riskClass: "financial",
    packs: ["tekst"],
    keywords: [
      "broji", "cena", "cenom", "jedinica", "jedinici", "mnozi", "nalepljenom", "naplate",
      "obim", "prevoda", "prevodilacke", "reci", "strane", "strani", "tekst", "tekstu",
      "translation", "upises", "volume", "znakova", "znakove"
    ],
  },
  {
    id: "typography-cleanup",
    titleKey: "pro.name.typography-cleanup",
    blurbKey: "pro.blurb.typography-cleanup",
    category: "text",
    riskClass: "none",
    sourceKey: "pro.sources.unicode-16-code-charts",
    packs: ["dizajn", "prosveta", "tekst"],
    keywords: [
      "ciscenje", "cleanup", "crte", "ispravlja", "izmenu", "nalepljenom", "navodnika",
      "navodnike", "pravila", "pravilu", "prebrojava", "razmake", "stil", "svaku", "tacke",
      "tekst", "tekstu", "tipografsko", "typography"
    ],
  },
  {
    id: "unwrap-paragraphs",
    titleKey: "pro.name.unwrap-paragraphs",
    blurbKey: "pro.blurb.unwrap-paragraphs",
    category: "text",
    riskClass: "none",
    sourceKey: "pro.sources.unicode-16-code-charts",
    packs: ["prosveta", "tekst", "pravo"],
    keywords: [
      "crticom", "kopiranjem", "kraju", "natrag", "novi", "paragraphs", "pasus", "pasuse",
      "pdf", "postuj", "preloma", "prelomljene", "rastavljene", "recenice", "reci", "reda",
      "redove", "sastavi", "sastavlja", "spaja", "spiska", "sredjivanje", "tekst", "unwrap",
      "zavrsene"
    ],
  },
  {
    id: "word-frequency",
    titleKey: "pro.name.word-frequency",
    blurbKey: "pro.blurb.word-frequency",
    category: "text",
    riskClass: "none",
    packs: ["prosveta", "tekst"],
    keywords: [
      "broji", "duzina", "fraza", "frequency", "mala", "najmanja", "najmanji", "pojavljivanja",
      "ponavlja", "puta", "razlikuj", "rec", "reci", "slova", "tekst", "tekstu", "ucestalost",
      "udeo", "velika", "word"
    ],
  },
];

const PRO_TRENING_TOOLS: ToolRegistration[] = [
  {
    id: "barbell-plate-loading",
    titleKey: "pro.name.barbell-plate-loading",
    blurbKey: "pro.blurb.barbell-plate-loading",
    category: "calculation",
    riskClass: "none",
    packs: ["trening"],
    keywords: [
      "barbell", "diskova", "diskove", "diskovi", "ispisuje", "jedne", "loading", "masa",
      "moguc", "najblize", "nalaganje", "opterecenje", "parova", "parovi", "plate", "promasuje",
      "raspolozivi", "sipke", "staviti", "stezaljke", "strani", "tacan", "ukupno", "zbir",
      "zeljeno"
    ],
  },
  {
    id: "body-fat-target-mass",
    titleKey: "pro.name.body-fat-target-mass",
    blurbKey: "pro.blurb.body-fat-target-mass",
    category: "body",
    riskClass: "wellness",
    packs: ["trening"],
    keywords: [
      "body", "ciljni", "cista", "cistu", "fat", "imalo", "ista", "izmerenog", "kilograma",
      "masa", "mase", "masnu", "mass", "masti", "masu", "ostane", "procenat", "procenta",
      "procentu", "sastav", "target", "tela", "telesna", "telesne", "telo", "zeljenom"
    ],
  },
  {
    id: "body-indices",
    titleKey: "pro.name.body-indices",
    blurbKey: "pro.blurb.body-indices",
    category: "body",
    riskClass: "wellness",
    packs: ["trening"],
    keywords: [
      "bmi", "body", "ijedne", "indeks", "indeksi", "indices", "kategorije", "kuk", "kukova",
      "masa", "mera", "obim", "odnose", "ponderalni", "struk", "struka", "tabele", "telesna",
      "telesni", "unetih", "visina"
    ],
  },
  {
    id: "cadence-stride-length",
    titleKey: "pro.name.cadence-stride-length",
    blurbKey: "pro.blurb.cadence-stride-length",
    category: "calculation",
    riskClass: "none",
    packs: ["trening"],
    keywords: [
      "brzina", "brzinu", "cadence", "duzina", "duzinu", "kadenca", "kadencu", "kilometar",
      "korak", "koraka", "length", "povezuje", "stride", "treci"
    ],
  },
  {
    id: "erg-split-watts",
    titleKey: "pro.name.erg-split-watts",
    blurbKey: "pro.blurb.erg-split-watts",
    category: "conversion",
    riskClass: "none",
    sourceKey: "pro.sources.concept2-pace-watts",
    packs: ["trening"],
    keywords: [
      "concept2", "distanca", "distancu", "erg", "metara", "nazad", "objavljenoj", "pretvara",
      "relaciji", "snaga", "split", "splitu", "tom", "vate", "vati", "vreme", "watts"
    ],
  },
  {
    id: "heart-rate-zones-karvonen",
    titleKey: "pro.name.heart-rate-zones-karvonen",
    blurbKey: "pro.blurb.heart-rate-zones-karvonen",
    category: "body",
    riskClass: "wellness",
    packs: ["trening"],
    keywords: [
      "ciljni", "heart", "izmereni", "izmerenog", "karvonen", "karvonenu", "maksimalni",
      "maksimalnog", "maksimuma", "mirovanju", "neki", "obrnuto", "procenat", "procenata",
      "procentu", "puls", "pulsa", "rate", "zone", "zones"
    ],
  },
  {
    id: "interval-session-timing",
    titleKey: "pro.name.interval-session-timing",
    blurbKey: "pro.blurb.interval-session-timing",
    category: "time",
    riskClass: "wellness",
    packs: ["trening"],
    keywords: [
      "broja", "interval", "intervalni", "odmor", "odmora", "odnos", "odnosa", "ponavljanja",
      "rad", "rada", "serija", "serije", "seriji", "session", "smirivanje", "stvarni", "timing",
      "trajanja", "trajanje", "trening", "treninga", "ukupno", "vreme", "zagrevanje"
    ],
  },
  {
    id: "jump-height-flight-time",
    titleKey: "pro.name.jump-height-flight-time",
    blurbKey: "pro.blurb.jump-height-flight-time",
    category: "calculation",
    riskClass: "none",
    packs: ["trening"],
    keywords: [
      "flight", "gravitacija", "height", "indeks", "jump", "kontakta", "leta", "nazad",
      "podlogom", "pretvara", "reaktivne", "skoka", "snage", "time", "visina", "visine",
      "visinu", "vreme", "vremena"
    ],
  },
  {
    id: "limb-symmetry-index",
    titleKey: "pro.name.limb-symmetry-index",
    blurbKey: "pro.blurb.limb-symmetry-index",
    category: "body",
    riskClass: "wellness",
    packs: ["trening"],
    keywords: [
      "ciljni", "dostigne", "ispitivanoj", "limb", "odnos", "posto", "procentima", "razlika",
      "referentnoj", "simetrija", "slabija", "strana", "strane", "strani", "symmetry", "tela",
      "zada"
    ],
  },
  {
    id: "one-rep-max-table",
    titleKey: "pro.name.one-rep-max-table",
    blurbKey: "pro.blurb.one-rep-max-table",
    category: "calculation",
    riskClass: "wellness",
    sourceKey: "pro.sources.one-rep-max-formulas",
    packs: ["trening"],
    keywords: [
      "1rm", "bzicki", "epli", "formula", "formuli", "jedne", "kilogrami", "korak", "max",
      "one", "opterecenja", "ponavljanja", "poznat", "procenjeni", "procenti", "procentima",
      "rep", "serije", "tabelu", "table", "tegova", "tezina", "zaokruzenu", "zaokruzivanja"
    ],
  },
  {
    id: "running-pace-splits",
    titleKey: "pro.name.running-pace-splits",
    blurbKey: "pro.blurb.running-pace-splits",
    category: "calculation",
    riskClass: "wellness",
    packs: ["trening"],
    keywords: [
      "distanca", "distance", "kilometru", "korak", "medjuvremena", "metara", "milji", "pace",
      "podatka", "ravnomernih", "running", "splits", "tabele", "tabelom", "tempa", "tempo",
      "tempom", "treci", "trke", "vreme", "vremena"
    ],
  },
  {
    id: "set-tempo-tut",
    titleKey: "pro.name.set-tempo-tut",
    blurbKey: "pro.blurb.set-tempo-tut",
    category: "time",
    riskClass: "wellness",
    packs: ["trening"],
    keywords: [
      "bloka", "broja", "cetiri", "dole", "ekscentricna", "faza", "gore", "koncentricna", "npr",
      "opterecenjem", "pauza", "pauzama", "ponavljanja", "serija", "serije", "seriji", "set",
      "tempa", "tempo", "trajanje", "tut", "ukupno", "vreme"
    ],
  },
  {
    id: "split-times-fatigue",
    titleKey: "pro.name.split-times-fatigue",
    blurbKey: "pro.blurb.split-times-fatigue",
    category: "calculation",
    riskClass: "none",
    packs: ["trening"],
    keywords: [
      "fatigue", "indeks", "izmerenih", "medijanu", "najbolje", "najslabije", "pada",
      "ponovljene", "procenat", "prosek", "redu", "spiska", "split", "sprintove", "times",
      "vremena", "zamor", "zamora", "zbir"
    ],
  },
  {
    id: "sweat-rate-hydration",
    titleKey: "pro.name.sweat-rate-hydration",
    blurbKey: "pro.blurb.sweat-rate-hydration",
    category: "body",
    riskClass: "wellness",
    packs: ["trening"],
    keywords: [
      "gubitak", "hydration", "izgubljene", "izmereni", "izmokreno", "masa", "mase",
      "nadoknade", "planira", "popijena", "popijene", "procenat", "rate", "satu", "stopa",
      "stopu", "sweat", "tecnost", "tecnosti", "telesne", "trajanja", "trajanje", "treninga",
      "znojem", "znojenja"
    ],
  },
  {
    id: "training-volume-load",
    titleKey: "pro.name.training-volume-load",
    blurbKey: "pro.blurb.training-volume-load",
    category: "calculation",
    riskClass: "wellness",
    packs: ["trening"],
    keywords: [
      "1rm", "intenzitet", "kilogrami", "load", "opterecenje", "ponavljanja", "ponavljanju",
      "procentima", "programa", "prosecan", "prosecno", "redova", "redovi", "sabira", "serije",
      "tonaza", "tonazu", "training", "unet", "volume"
    ],
  },
  {
    id: "weight-class-cut",
    titleKey: "pro.name.weight-class-cut",
    blurbKey: "pro.blurb.weight-class-cut",
    category: "body",
    riskClass: "wellness",
    packs: ["trening"],
    keywords: [
      "class", "cut", "dana", "danu", "deli", "granica", "granice", "kategorije", "kilograma",
      "masa", "mase", "nedelji", "procenata", "prosecno", "takmicara", "telesna", "telesne",
      "trenutna", "unete", "vaganja", "weight"
    ],
  },
];

const PRO_KUHINJA_TOOLS: ToolRegistration[] = [
  {
    id: "backwards-timeline",
    titleKey: "pro.name.backwards-timeline",
    blurbKey: "pro.blurb.backwards-timeline",
    category: "time",
    riskClass: "none",
    packs: ["gradnja", "kuhinja", "biznis", "transport", "event"],
    keywords: [
      "backwards", "ceo", "datum", "koraci", "korak", "osa", "pocinje", "pocne", "posao",
      "pripreme", "rezerva", "sata", "sati", "serviranja", "timeline", "unazad", "vreme",
      "vremenska"
    ],
  },
  {
    id: "bakers-percentage",
    titleKey: "pro.name.bakers-percentage",
    blurbKey: "pro.blurb.bakers-percentage",
    category: "materials",
    riskClass: "none",
    packs: ["kuhinja"],
    keywords: [
      "bakers", "bakerski", "brasna", "ciljanu", "ciljna", "gubitak", "komada", "masa", "masu",
      "nazad", "pecenjem", "pecenog", "percentage", "prevodi", "procenat", "procente", "recept",
      "recepta", "reda", "sastojaka", "testa", "tezine", "uloga"
    ],
  },
  {
    id: "brine-salt",
    titleKey: "pro.name.brine-salt",
    blurbKey: "pro.blurb.brine-salt",
    category: "materials",
    riskClass: "food-safety",
    packs: ["kuhinja", "agro"],
    keywords: [
      "brine", "ciljni", "masa", "mesa", "osnova", "osnove", "povrca", "procenat", "racunanja",
      "salamura", "salamuri", "salamuru", "salt", "secera", "soli", "soljenje", "suvo",
      "uobicajene", "vode"
    ],
  },
  {
    id: "coffee-extraction",
    titleKey: "pro.name.coffee-extraction",
    blurbKey: "pro.blurb.coffee-extraction",
    category: "calculation",
    riskClass: "none",
    packs: ["kuhinja"],
    keywords: [
      "ciljni", "coffee", "doza", "doze", "dozi", "ekstrakcija", "ekstrakcije", "extraction",
      "izmerenog", "kafe", "kuvanja", "kuvanje", "masa", "mase", "mlevene", "napitka",
      "obrnuto", "odnos", "odnose", "procenat", "solji", "tds", "voda", "vode"
    ],
  },
  {
    id: "dough-water-temp",
    titleKey: "pro.name.dough-water-temp",
    blurbKey: "pro.blurb.dough-water-temp",
    category: "calculation",
    riskClass: "none",
    packs: ["kuhinja"],
    keywords: [
      "bojleru", "brasna", "dough", "faktor", "imalo", "izmerena", "izmerene", "izvlaci",
      "mesalice", "mesenja", "najvisa", "obrnuto", "predfermenta", "prostorije", "sarze",
      "slavini", "temp", "temperatura", "temperaturu", "testa", "testo", "trenja", "vode",
      "water", "zeljena", "zeljenu"
    ],
  },
  {
    id: "ice-cream-overrun",
    titleKey: "pro.name.ice-cream-overrun",
    blurbKey: "pro.blurb.ice-cream-overrun",
    category: "calculation",
    riskClass: "none",
    packs: ["kuhinja"],
    keywords: [
      "ciljni", "cream", "gotovim", "gustina", "ice", "masa", "mase", "naduv", "napunjene",
      "overrun", "overruna", "pakovanja", "posude", "sladoleda", "sladoledom", "smese",
      "smesom", "tara", "tezinu", "zadatog", "zapremina", "zapreminu"
    ],
  },
  {
    id: "lamination-layers",
    titleKey: "pro.name.lamination-layers",
    blurbKey: "pro.blurb.lamination-layers",
    category: "geometry",
    riskClass: "none",
    packs: ["kuhinja", "zanat"],
    keywords: [
      "debljina", "debljini", "debljinu", "duzina", "jednog", "laminacije", "lamination",
      "layers", "masti", "niz", "niza", "pocetna", "pocetni", "presavijanja", "razvijenog",
      "sloja", "slojeva", "slojevi", "tacan", "testa", "zavrsna", "zavrsnoj"
    ],
  },
  {
    id: "levain-hydration",
    titleKey: "pro.name.levain-hydration",
    blurbKey: "pro.blurb.levain-hydration",
    category: "materials",
    riskClass: "none",
    packs: ["kuhinja"],
    keywords: [
      "brasna", "brasno", "celo", "ciljna", "dodati", "gotovom", "hidratacija", "hidrataciju",
      "hydration", "imalo", "jos", "levain", "masa", "njegova", "ono", "predfermenta",
      "predfermentu", "razdvaja", "starter", "startera", "starteru", "testo", "testu",
      "ukljucujuci", "ukupna", "ukupno", "vode", "vodu", "zametka", "zeljenu"
    ],
  },
  {
    id: "nutrition-per-portion",
    titleKey: "pro.name.nutrition-per-portion",
    blurbKey: "pro.blurb.nutrition-per-portion",
    category: "conversion",
    riskClass: "wellness",
    packs: ["trening", "kuhinja"],
    keywords: [
      "dnevni", "energija", "hranljive", "hranljivih", "kilodzule", "kilokalorije", "masa",
      "materije", "materiji", "nazad", "nutrition", "pakovanja", "pakovanju", "per", "porcija",
      "porcije", "porciji", "portion", "prevodi", "referentni", "smer", "tabelu", "tacno"
    ],
  },
  {
    id: "pan-area-volume",
    titleKey: "pro.name.pan-area-volume",
    blurbKey: "pro.blurb.pan-area-volume",
    category: "geometry",
    riskClass: "none",
    packs: ["kuhinja", "agro", "zanat"],
    keywords: [
      "area", "cetvrtastih", "ciljna", "dimenzije", "kalupa", "kalupi", "kalupu", "kolicine",
      "lonaca", "masa", "njegove", "oblik", "oblika", "okruglih", "pan", "posude", "povrsina",
      "pravougaonih", "preracun", "promeni", "punjenja", "smese", "vencastih", "visina",
      "volume", "zapremina", "zapreminu"
    ],
  },
  {
    id: "plate-cost",
    titleKey: "pro.name.plate-cost",
    blurbKey: "pro.blurb.plate-cost",
    category: "finance",
    riskClass: "financial",
    packs: ["kuhinja", "racunovodstvo", "biznis", "zanat"],
    keywords: [
      "cenu", "ciljni", "cost", "costa", "dodatni", "food", "jednog", "jela", "kalkulacija",
      "kalom", "kostanja", "plate", "porcija", "porcije", "porciji", "procenat", "prodajnu",
      "recept", "sabira", "sastojaka", "sastojku", "trosak", "uracunatim"
    ],
  },
  {
    id: "portions-from-pack",
    titleKey: "pro.name.portions-from-pack",
    blurbKey: "pro.blurb.portions-from-pack",
    category: "materials",
    riskClass: "financial",
    packs: ["kuhinja", "biznis", "agro", "zanat", "event"],
    keywords: [
      "cena", "cenom", "from", "gubitak", "jedinica", "kilogramu", "kolicina", "litru",
      "ostatkom", "pack", "pakovanja", "pakovanju", "porcija", "porcije", "portions", "velicina"
    ],
  },
  {
    id: "ratio-split",
    titleKey: "pro.name.ratio-split",
    blurbKey: "pro.blurb.ratio-split",
    category: "materials",
    riskClass: "none",
    packs: ["gradnja", "kuhinja", "agro", "zanat"],
    keywords: [
      "celini", "deli", "delova", "delove", "jedinica", "jednak", "kolicina", "kolicinu",
      "korak", "nazivi", "odnos", "odnosu", "ostane", "podela", "ratio", "split", "tacno",
      "ukupna", "ukupnu", "zaokruzivanja", "zaokruzuje", "zbir"
    ],
  },
  {
    id: "recipe-scale",
    titleKey: "pro.name.recipe-scale",
    blurbKey: "pro.blurb.recipe-scale",
    category: "materials",
    riskClass: "none",
    packs: ["kuhinja"],
    keywords: [
      "ceo", "ciljanu", "ciljna", "ciljni", "citanje", "faktor", "korak", "masa", "masu",
      "polazni", "porcija", "preracunava", "razlomaka", "recepta", "recipe", "sastojaka",
      "scale", "skaliranje", "ukupna", "ukupnu", "zaokruzivanja", "zaokruzivanje"
    ],
  },
  {
    id: "solution-concentration",
    titleKey: "pro.name.solution-concentration",
    blurbKey: "pro.blurb.solution-concentration",
    category: "calculation",
    riskClass: "life-safety",
    packs: ["inzenjering", "foto", "kuhinja", "agro", "zanat"],
    keywords: [
      "bilans", "cetiri", "ciljane", "ciljna", "cistog", "concentration", "dodavanje",
      "komponente", "koncentracija", "koncentracije", "masa", "mase", "masi", "mesanje",
      "pitanja", "procentima", "rastvora", "razblazivanje", "sastojka", "smese", "solution",
      "ukupna", "ukuvavanje"
    ],
  },
  {
    id: "us-customary-kitchen-units",
    titleKey: "pro.name.us-customary-kitchen-units",
    blurbKey: "pro.blurb.us-customary-kitchen-units",
    category: "conversion",
    riskClass: "none",
    sourceKey: "pro.sources.us-imperial-unit-definitions",
    packs: ["inzenjering", "kuhinja", "zanat"],
    keywords: [
      "americke", "celzijusa", "ciljna", "customary", "farenhajta", "funte", "grame", "gustine",
      "jedinica", "kasicice", "kasike", "kitchen", "masu", "mere", "mililitre", "odbija",
      "pinte", "polazna", "pretvara", "pretvori", "recepata", "soljice", "stepene", "stranih",
      "unce", "units", "zapremina", "zapreminu"
    ],
  },
  {
    id: "yield-trim-cook",
    titleKey: "pro.name.yield-trim-cook",
    blurbKey: "pro.blurb.yield-trim-cook",
    category: "materials",
    riskClass: "financial",
    packs: ["kuhinja", "agro"],
    keywords: [
      "bruto", "cena", "cenu", "ciscenja", "cook", "kalo", "kilogramu", "kupiti", "kuvano",
      "masa", "nabavke", "nabavna", "obrade", "obrnuto", "porcija", "porcije", "randman",
      "sirovine", "termicke", "trim", "yield"
    ],
  },
];

const PRO_PRAVO_TOOLS: ToolRegistration[] = [
  {
    id: "anuitet-otplatni-plan",
    titleKey: "pro.name.anuitet-otplatni-plan",
    blurbKey: "pro.blurb.anuitet-otplatni-plan",
    category: "finance",
    riskClass: "financial",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine", "transport"],
    keywords: [
      "anuitet", "brojrata", "deli", "dug", "glavnica", "glavnicu", "godisnjastopa",
      "isplacuje", "jednak", "jednakih", "kamatu", "konverzijastope", "obrok", "otplatni",
      "plan", "rata", "ratagodisnje"
    ],
  },
  {
    id: "iznos-slovima",
    titleKey: "pro.name.iznos-slovima",
    blurbKey: "pro.blurb.iznos-slovima",
    category: "conversion",
    riskClass: "financial",
    sourceKey: "pro.sources.serbian-numerals",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine", "transport"],
    keywords: [
      "imenice", "ispisuje", "iznos", "novcani", "obliciglavnejedinice", "oblicipodjedinice",
      "oblikom", "recima", "slovima", "srpskom", "stilzapisa", "tacnim", "valuta",
      "velikapocetnaslova"
    ],
  },
  {
    id: "jmbg-provera",
    titleKey: "pro.name.jmbg-provera",
    blurbKey: "pro.blurb.jmbg-provera",
    category: "data",
    riskClass: "none",
    sourceKey: "pro.sources.jmbg-check-digit",
    packs: ["prosveta", "pravo", "racunovodstvo", "biznis"],
    keywords: [
      "cifra", "datum", "dvanaest", "jmbg", "kontrolna", "oznaku", "provera", "registarski",
      "zapis"
    ],
  },
  {
    id: "katastarska-povrsina",
    titleKey: "pro.name.katastarska-povrsina",
    blurbKey: "pro.blurb.katastarska-povrsina",
    category: "conversion",
    riskClass: "none",
    packs: ["gradnja", "inzenjering", "pravo", "nekretnine", "agro"],
    keywords: [
      "ari", "hektara", "kakav", "katastarska", "kvadratnih", "kvadratnimetri", "listu",
      "m2ostatak", "metara", "nepokretnosti", "povrsina", "povrsine", "prevod", "smer", "smera",
      "stoji", "zapisu"
    ],
  },
  {
    id: "kazna-i-pritvor",
    titleKey: "pro.name.kazna-i-pritvor",
    blurbKey: "pro.blurb.kazna-i-pritvor",
    category: "time",
    riskClass: "legal-procedure",
    packs: ["pravo"],
    keywords: [
      "dani", "datuma", "datumpocetka", "deozaproveru", "istice", "kalendarski", "kazna",
      "kaznadana", "kaznagodina", "kaznameseci", "kazne", "lisenja", "odbiju",
      "odnosuracunavanja", "pada", "posto", "pritvor", "racun", "racunajprvidan", "razlomak",
      "slobode", "tog", "trajanja", "trajanje", "uracunatidani", "uracunavanje"
    ],
  },
  {
    id: "nominalna-efektivna-stopa",
    titleKey: "pro.name.nominalna-efektivna-stopa",
    blurbKey: "pro.blurb.nominalna-efektivna-stopa",
    category: "finance",
    riskClass: "financial",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine"],
    keywords: [
      "brojobracunagodisnje", "efektivna", "godisnja", "godisnje", "nominalna", "obracuna",
      "obrnuto", "smer", "stopa", "vredi"
    ],
  },
  {
    id: "obracun-kamate",
    titleKey: "pro.name.obracun-kamate",
    blurbKey: "pro.blurb.obracun-kamate",
    category: "finance",
    riskClass: "financial",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine", "agro"],
    keywords: [
      "dana", "datumdo", "datumod", "glavnica", "glavnicu", "kamata", "kamate",
      "kapitalizacija", "konformnom", "metoda", "metodom", "obracun", "osnovadana", "period",
      "periodistope", "proporcionalnom", "stopama", "ukljuciposlednjidan"
    ],
  },
  {
    id: "podela-iznosa",
    titleKey: "pro.name.podela-iznosa",
    blurbKey: "pro.blurb.podela-iznosa",
    category: "finance",
    riskClass: "financial",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine", "event"],
    keywords: [
      "celini", "deli", "delova", "izgubljene", "iznos", "iznosa", "jednak", "lica",
      "najmanjajedinica", "pare", "podela", "raspodelaostatka", "tacno", "udeli", "udelima",
      "ukupaniznos", "zadatim", "zbir"
    ],
  },
  {
    id: "racun-iban-provera",
    titleKey: "pro.name.racun-iban-provera",
    blurbKey: "pro.blurb.racun-iban-provera",
    category: "data",
    riskClass: "financial",
    sourceKey: "pro.sources.iso-7064-13616",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine", "transport"],
    keywords: [
      "brojzakontrolu", "cifara", "drzavazaiban", "iban", "kontrolni", "modulu", "niz",
      "njegov", "otkucanog", "provera", "racun"
    ],
  },
  {
    id: "radni-dani",
    titleKey: "pro.name.radni-dani",
    blurbKey: "pro.blurb.radni-dani",
    category: "time",
    riskClass: "legal-procedure",
    packs: ["gradnja", "prosveta", "pravo", "racunovodstvo", "biznis", "transport", "event"],
    keywords: [
      "dana", "dani", "datuma", "dodatuma", "kalendarskih", "neradnidani",
      "neradnidaniunedelji", "neradnih", "oddatuma", "radni", "radnih", "spisku",
      "ukljuciposlednjidan"
    ],
  },
  {
    id: "rok-poslednji-dan",
    titleKey: "pro.name.rok-poslednji-dan",
    blurbKey: "pro.blurb.rok-poslednji-dan",
    category: "time",
    riskClass: "legal-procedure",
    packs: ["gradnja", "pravo", "racunovodstvo", "biznis", "nekretnine"],
    keywords: [
      "dan", "dana", "datuma", "duzina", "duzine", "jedinica", "neradnidani",
      "neradnidaniunedelji", "neradnog", "pocetnidatum", "pocetnog", "pomeranja", "pomeranje",
      "poslednji", "pravilo", "racunajpocetnidan", "rok", "roka", "smer", "unete"
    ],
  },
  {
    id: "strane-teksta",
    titleKey: "pro.name.strane-teksta",
    blurbKey: "pro.blurb.strane-teksta",
    category: "text",
    riskClass: "financial",
    sourceKey: "pro.sources.unicode-white-space",
    packs: ["prosveta", "tekst", "pravo", "biznis"],
    keywords: [
      "broju", "cenapostrani", "ceni", "iznos", "karaktera", "karakterapostrani", "obracun",
      "obracunskih", "racunajrazmake", "strana", "strane", "strani", "tekst", "teksta",
      "unetoj", "unetom", "zaokruzivanje"
    ],
  },
  {
    id: "suvlasnicki-udeli",
    titleKey: "pro.name.suvlasnicki-udeli",
    blurbKey: "pro.blurb.suvlasnicki-udeli",
    category: "calculation",
    riskClass: "financial",
    packs: ["gradnja", "pravo", "nekretnine", "agro"],
    keywords: [
      "celinu", "ciljniimenilac", "delovi", "idealni", "imeniocu", "kvadrata", "suvlasnicki",
      "tacno", "udeli", "ukupnapovrsina", "zajednickom"
    ],
  },
  {
    id: "troskovi-srazmerno-uspehu",
    titleKey: "pro.name.troskovi-srazmerno-uspehu",
    blurbKey: "pro.blurb.troskovi-srazmerno-uspehu",
    category: "finance",
    riskClass: "financial",
    packs: ["pravo"],
    keywords: [
      "iznosa", "odnos", "odnosu", "srazmerni", "srazmerno", "strana", "svojih", "tom",
      "trazeniznos", "trazenog", "troskova", "troskovi", "troskovidrugestrane",
      "troskoviprvestrane", "uspehu", "usvojeniznos", "usvojenog"
    ],
  },
  {
    id: "ugovorna-kazna",
    titleKey: "pro.name.ugovorna-kazna",
    blurbKey: "pro.blurb.ugovorna-kazna",
    category: "finance",
    riskClass: "financial",
    packs: ["gradnja", "inzenjering", "pravo", "biznis", "transport", "event"],
    keywords: [
      "dana", "danadocnje", "dane", "dnevnastopa", "dnevnoj", "docnje", "dostize", "kazna",
      "ogranicenje", "osnovica", "penal", "stopi", "stvarnoispunjenje", "ugovorenirok",
      "ugovorna", "ukljucidanispunjenja", "unetoj"
    ],
  },
  {
    id: "zbir-perioda",
    titleKey: "pro.name.zbir-perioda",
    blurbKey: "pro.blurb.zbir-perioda",
    category: "time",
    riskClass: "legal-procedure",
    packs: ["prosveta", "pravo", "racunovodstvo", "biznis"],
    keywords: [
      "dana", "dane", "godine", "konvencijarazlaganja", "mesece", "niz", "perioda", "periodi",
      "preklapaju", "razlaze", "ukljuciposlednjidan", "ukupno", "zbir"
    ],
  },
];

const PRO_RACUNOVODSTVO_TOOLS: ToolRegistration[] = [
  {
    id: "allocation-remainder",
    titleKey: "pro.name.allocation-remainder",
    blurbKey: "pro.blurb.allocation-remainder",
    category: "finance",
    riskClass: "financial",
    packs: ["gradnja", "racunovodstvo", "biznis", "nekretnine", "transport", "event"],
    keywords: [
      "allocation", "celini", "decimala", "deli", "delova", "izgubi", "iznos", "jednak",
      "kljucu", "ostatka", "pare", "raspodela", "remainder", "tacno", "ukupan", "valute",
      "zaokruzivanju", "zbir"
    ],
  },
  {
    id: "amount-in-words",
    titleKey: "pro.name.amount-in-words",
    blurbKey: "pro.blurb.amount-in-words",
    category: "text",
    riskClass: "financial",
    sourceKey: "pro.sources.sr-numerals-pravopis-2010",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine", "transport", "zanat"],
    keywords: [
      "amount", "broju", "dinare", "ispisuje", "iznos", "novcani", "oblikom", "odgovara",
      "para", "pare", "reci", "slova", "slovima", "srpskom", "valute", "velicina", "words",
      "zapis"
    ],
  },
  {
    id: "bank-account-iban",
    titleKey: "pro.name.bank-account-iban",
    blurbKey: "pro.blurb.bank-account-iban",
    category: "data",
    riskClass: "financial",
    sourceKey: "pro.sources.iso-13616-iban",
    packs: ["softver", "pravo", "racunovodstvo", "biznis"],
    keywords: [
      "account", "aritmetici", "bank", "cifre", "domaceg", "iban", "istoj", "izracunava",
      "kontrolne", "mod", "nedostaju", "proverava", "racun", "tekuceg"
    ],
  },
  {
    id: "benford-first-digit",
    titleKey: "pro.name.benford-first-digit",
    blurbKey: "pro.blurb.benford-first-digit",
    category: "data",
    riskClass: "none",
    packs: ["pravo", "racunovodstvo", "biznis"],
    keywords: [
      "benford", "benfordov", "benfordovom", "cifara", "cifre", "cifri", "decimalni", "digit",
      "first", "iznosa", "koloni", "kvadrat", "mad", "nalepljenoj", "negativnim", "prve",
      "raspodelom", "raspodelu", "separator", "test", "ulaza", "vrednostima"
    ],
  },
  {
    id: "breakeven-cvp",
    titleKey: "pro.name.breakeven-cvp",
    blurbKey: "pro.blurb.breakeven-cvp",
    category: "finance",
    riskClass: "financial",
    packs: ["kuhinja", "racunovodstvo", "biznis", "zanat", "event"],
    keywords: [
      "breakeven", "cena", "ciljna", "ciljnu", "cvp", "dobit", "fiksne", "fiksni", "gubitka",
      "jedinici", "komada", "obim", "padne", "period", "planirani", "pokrivaju", "prelomna",
      "prodajna", "promet", "rentabiliteta", "tacka", "trosak", "troskove", "troskovi",
      "varijabilni"
    ],
  },
  {
    id: "check-digits-id",
    titleKey: "pro.name.check-digits-id",
    blurbKey: "pro.blurb.check-digits-id",
    category: "data",
    riskClass: "financial",
    sourceKey: "pro.sources.iso-7064-jmbg",
    packs: ["pravo", "racunovodstvo", "biznis"],
    keywords: [
      "broja", "check", "cifru", "digits", "dokument", "greska", "jmbg", "kontrolnu",
      "maticnog", "ode", "pib", "prekucavanju", "proverava", "vidi", "vrsta"
    ],
  },
  {
    id: "depreciation-schedule",
    titleKey: "pro.name.depreciation-schedule",
    blurbKey: "pro.blurb.depreciation-schedule",
    category: "finance",
    riskClass: "financial",
    packs: ["gradnja", "racunovodstvo", "biznis", "transport", "agro", "zanat"],
    keywords: [
      "aktiviranja", "amortizacija", "amortizacije", "datum", "degresije", "degresivnom",
      "depreciation", "funkcionalnom", "godina", "godinama", "godine", "godinu", "kapacitet",
      "koeficijent", "linearnom", "metod", "metodu", "nabavna", "osnovnih", "ostatak", "plan",
      "pravi", "prve", "rezidualna", "schedule", "srazmera", "srazmerom", "sredstava",
      "trajanja", "ucinak", "ukupan", "vek", "zbira"
    ],
  },
  {
    id: "financial-ratios",
    titleKey: "pro.name.financial-ratios",
    blurbKey: "pro.blurb.financial-ratios",
    category: "finance",
    riskClass: "financial",
    sourceKey: "pro.sources.isda-2006-daycount",
    packs: ["racunovodstvo", "biznis"],
    keywords: [
      "aktiva", "bilansa", "ciklus", "dani", "dobavljacima", "dobitak", "ebit", "ekvivalenti",
      "financial", "godini", "gotovina", "gotovine", "gotovinski", "imovina", "kamata",
      "kapital", "konverzije", "kratkorocne", "kupaca", "likvidnosti", "nabavna", "neto",
      "obaveze", "obrta", "obrtna", "pokazatelje", "pokazatelji", "poslovni", "potrazivanja",
      "pozicija", "prihod", "prinosa", "prodate", "prodatog", "rashodi", "ratios", "robe",
      "stanja", "troskovi", "ukljucujuci", "ukupna", "ukupne", "unetih", "uspeha",
      "zaduzenosti", "zalihe"
    ],
  },
  {
    id: "fx-difference",
    titleKey: "pro.name.fx-difference",
    blurbKey: "pro.blurb.fx-difference",
    category: "finance",
    riskClass: "financial",
    packs: ["racunovodstvo", "biznis", "nekretnine", "transport"],
    keywords: [
      "dan", "decimala", "devizni", "difference", "iznos", "iznosa", "izvodi", "kurs", "kursa",
      "kursne", "kursnu", "kursu", "nastanka", "obracuna", "odnosa", "placanja", "preracunava",
      "razlike", "razliku", "stranoj", "unakrsni", "valuti", "vrsta"
    ],
  },
  {
    id: "gross-up",
    titleKey: "pro.name.gross-up",
    blurbKey: "pro.blurb.gross-up",
    category: "finance",
    riskClass: "financial",
    packs: ["dizajn", "foto", "tekst", "pravo", "racunovodstvo", "biznis"],
    keywords: [
      "bruto", "doprinosa", "gross", "isplatioca", "iznos", "iznosa", "izvodi", "jednacinu",
      "kontrolu", "linearnu", "model", "neoporezivi", "neta", "neto", "normirani", "poreza",
      "primaoca", "resava", "stopa", "teret", "troskovi", "unazad", "vraca"
    ],
  },
  {
    id: "interest-periods",
    titleKey: "pro.name.interest-periods",
    blurbKey: "pro.blurb.interest-periods",
    category: "finance",
    riskClass: "financial",
    sourceKey: "pro.sources.isda-2006-daycount",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine"],
    keywords: [
      "brojanje", "dana", "dane", "decimala", "glavnica", "glavnicu", "interest", "izabranoj",
      "kamata", "kamate", "kamatu", "metod", "osnova", "osnovi", "perioda", "periodi",
      "periodima", "periods", "periodu", "prikaza", "prikazom", "razlicitim", "redova",
      "stopama", "svakom"
    ],
  },
  {
    id: "inventory-costing",
    titleKey: "pro.name.inventory-costing",
    blurbKey: "pro.blurb.inventory-costing",
    category: "finance",
    riskClass: "financial",
    packs: ["gradnja", "kuhinja", "racunovodstvo", "biznis", "agro", "zanat"],
    keywords: [
      "ceni", "costing", "decimala", "fifo", "inventory", "izlaza", "liste", "metod", "metodi",
      "nabavnu", "pocetno", "ponderisanoj", "prikaza", "prodate", "promene", "prosecnoj",
      "prosek", "proseka", "redovi", "robe", "stanje", "ulaza", "zaliha", "zalihe"
    ],
  },
  {
    id: "loan-schedule",
    titleKey: "pro.name.loan-schedule",
    blurbKey: "pro.blurb.loan-schedule",
    category: "finance",
    riskClass: "financial",
    packs: ["racunovodstvo", "biznis", "nekretnine"],
    keywords: [
      "anuitetski", "decimala", "glavnicom", "glavnicu", "godisnja", "godisnje", "iznos",
      "jednakom", "kamatu", "kredita", "loan", "nominalna", "obracun", "otplatni", "periodicne",
      "plan", "plana", "podelom", "pravi", "rata", "ratama", "rate", "schedule", "stopa",
      "stope", "svake", "tip"
    ],
  },
  {
    id: "rate-conversion",
    titleKey: "pro.name.rate-conversion",
    blurbKey: "pro.blurb.rate-conversion",
    category: "finance",
    riskClass: "financial",
    packs: ["racunovodstvo", "biznis", "nekretnine"],
    keywords: [
      "ciljni", "conversion", "efektivna", "efektivne", "godisnje", "kamatnu", "konformne",
      "nominalna", "nominalne", "obracuna", "obracunskih", "period", "perioda", "periodicne",
      "pokazuje", "prevodi", "proporcionalne", "rate", "razliku", "stopa", "stope", "stopu",
      "unete", "vrsta"
    ],
  },
  {
    id: "rebate-chain",
    titleKey: "pro.name.rebate-chain",
    blurbKey: "pro.blurb.rebate-chain",
    category: "finance",
    riskClass: "financial",
    packs: ["racunovodstvo", "biznis", "nekretnine"],
    keywords: [
      "cena", "ceni", "cenu", "chain", "efektivni", "lancani", "marza", "nabavke", "nabavna",
      "nabavnu", "neto", "niz", "par", "poznati", "prodajna", "prodajnu", "rabata", "rabati",
      "razlika", "rebate", "sklapa", "troskovi", "uzastopnih", "zavisni"
    ],
  },
  {
    id: "trial-balance-check",
    titleKey: "pro.name.trial-balance-check",
    blurbKey: "pro.blurb.trial-balance-check",
    category: "finance",
    riskClass: "financial",
    packs: ["racunovodstvo", "biznis"],
    keywords: [
      "aritmeticki", "balance", "check", "dale", "decimala", "dugovna", "dugovnu", "greske",
      "kontrola", "nabraja", "potrazna", "potraznu", "razlika", "razliku", "sabira", "strana",
      "stranu", "tacno", "trial", "valute", "zbira"
    ],
  },
  {
    id: "tvm-solver",
    titleKey: "pro.name.tvm-solver",
    blurbKey: "pro.blurb.tvm-solver",
    category: "finance",
    riskClass: "financial",
    packs: ["racunovodstvo", "biznis", "nekretnine"],
    keywords: [
      "buduca", "cetiri", "novca", "perioda", "periodicna", "petu", "placanja", "pmt",
      "poznate", "rata", "sadasnja", "solver", "stopa", "tip", "tvm", "velicina", "velicine",
      "vremenska"
    ],
  },
];

const PRO_BIZNIS_TOOLS: ToolRegistration[] = [
  {
    id: "billable-hours",
    titleKey: "pro.name.billable-hours",
    blurbKey: "pro.blurb.billable-hours",
    category: "time",
    riskClass: "financial",
    packs: ["dizajn", "foto", "tekst", "pravo", "biznis", "zanat"],
    keywords: [
      "billable", "hours", "interval", "liste", "mnozi", "obracun", "pravilo", "sabira", "sati",
      "satnica", "satnicom", "ugovoreni", "vremena", "zaokruzivanja", "zaokruzuje"
    ],
  },
  {
    id: "break-even",
    titleKey: "pro.name.break-even",
    blurbKey: "pro.blurb.break-even",
    category: "finance",
    riskClass: "financial",
    packs: ["kuhinja", "racunovodstvo", "biznis", "agro", "zanat", "event"],
    keywords: [
      "break", "cena", "dobit", "even", "fiksne", "fiksni", "komada", "komadu", "period",
      "planirana", "pokrica", "pokrivaju", "prihod", "prodaja", "prodajna", "tacka", "trosak",
      "troskove", "troskovi", "varijabilni", "zeljena", "zeljenu"
    ],
  },
  {
    id: "chained-discount",
    titleKey: "pro.name.chained-discount",
    blurbKey: "pro.blurb.chained-discount",
    category: "finance",
    riskClass: "financial",
    packs: ["gradnja", "racunovodstvo", "biznis", "zanat"],
    keywords: [
      "cena", "cenu", "chained", "dao", "discount", "doplata", "istu", "kaskadni", "niz",
      "osnovna", "popust", "popusta", "popusti"
    ],
  },
  {
    id: "deposit-instalments",
    titleKey: "pro.name.deposit-instalments",
    blurbKey: "pro.blurb.deposit-instalments",
    category: "finance",
    riskClass: "financial",
    packs: ["gradnja", "racunovodstvo", "biznis", "nekretnine", "event"],
    keywords: [
      "avans", "datum", "datumima", "deli", "deposit", "instalments", "jedinica", "jednake",
      "najmanja", "prve", "rata", "rate", "razlike", "razmak", "ugovorena", "ugovorenu",
      "zaokruzivanja", "zbiru"
    ],
  },
  {
    id: "hourly-rate-target",
    titleKey: "pro.name.hourly-rate-target",
    blurbKey: "pro.blurb.hourly-rate-target",
    category: "finance",
    riskClass: "financial",
    packs: ["dizajn", "foto", "tekst", "biznis", "zanat"],
    keywords: [
      "broja", "cena", "cenu", "dana", "danu", "godisnja", "godisnje", "godisnji", "hourly",
      "naplativih", "naplativost", "nedelja", "nedeljno", "poreza", "poslovni", "radnih",
      "radnom", "rate", "sata", "sati", "target", "troskova", "troskovi", "zarada", "zarade",
      "zeljena", "zeljene"
    ],
  },
  {
    id: "iban-check",
    titleKey: "pro.name.iban-check",
    blurbKey: "pro.blurb.iban-check",
    category: "data",
    riskClass: "financial",
    sourceKey: "pro.sources.iso-13616-1-2020",
    packs: ["racunovodstvo", "biznis", "nekretnine", "transport"],
    keywords: [
      "bban", "broja", "check", "cifre", "domaceg", "drzave", "iban", "kontrolne", "oznaka",
      "oznake", "proverava", "sastavlja"
    ],
  },
  {
    id: "margin-markup",
    titleKey: "pro.name.margin-markup",
    blurbKey: "pro.blurb.margin-markup",
    category: "finance",
    riskClass: "financial",
    packs: ["gradnja", "kuhinja", "racunovodstvo", "biznis", "agro", "zanat", "event"],
    keywords: [
      "cena", "cenu", "margin", "markup", "marza", "marze", "marzu", "min", "nabavna",
      "nabavnu", "najmanja", "najveci", "popust", "povezuje", "prodajna", "prodajnu"
    ],
  },
  {
    id: "payment-due-date",
    titleKey: "pro.name.payment-due-date",
    blurbKey: "pro.blurb.payment-due-date",
    category: "time",
    riskClass: "legal-procedure",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine", "transport"],
    keywords: [
      "dan", "dana", "dani", "date", "datum", "datuma", "dospeca", "due", "izdavanja",
      "nedelji", "neradni", "neradnog", "payment", "placanja", "pomeranje", "prijema",
      "racunanja", "razlike", "referentni", "referentnog", "rok", "roka", "unosis"
    ],
  },
  {
    id: "payment-reference-97",
    titleKey: "pro.name.payment-reference-97",
    blurbKey: "pro.blurb.payment-reference-97",
    category: "data",
    riskClass: "financial",
    sourceKey: "pro.sources.iso-iec-7064-2003",
    packs: ["prosveta", "pravo", "racunovodstvo", "biznis", "nekretnine", "zanat"],
    keywords: [
      "dvocifru", "kontrolnu", "mod", "payment", "poziv", "poziva", "referenca", "reference"
    ],
  },
  {
    id: "share-allocation",
    titleKey: "pro.name.share-allocation",
    blurbKey: "pro.blurb.share-allocation",
    category: "finance",
    riskClass: "financial",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine", "event"],
    keywords: [
      "allocation", "celini", "deli", "delova", "iznos", "jedinica", "jednak", "najmanja",
      "pare", "poslednje", "raspodela", "share", "tacno", "udeli", "udelima", "ukupan", "zbir"
    ],
  },
  {
    id: "simple-interest-days",
    titleKey: "pro.name.simple-interest-days",
    blurbKey: "pro.blurb.simple-interest-days",
    category: "finance",
    riskClass: "financial",
    sourceKey: "pro.sources.isda-2006-day-count",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine"],
    keywords: [
      "brojanja", "dana", "danima", "datum", "datuma", "days", "glavnica", "godisnja",
      "interest", "iznos", "kamata", "osnova", "osnovi", "prosta", "simple", "stopa", "stopi",
      "unosis"
    ],
  },
  {
    id: "tax-id-check",
    titleKey: "pro.name.tax-id-check",
    blurbKey: "pro.blurb.tax-id-check",
    category: "data",
    riskClass: "financial",
    sourceKey: "pro.sources.iso-iec-7064-2003",
    packs: ["pravo", "racunovodstvo", "biznis"],
    keywords: [
      "broja", "check", "cifara", "cifrom", "cifru", "kontrolnu", "maticni", "mod", "pib",
      "poslednjom", "tax", "ukupan"
    ],
  },
  {
    id: "tiered-commission",
    titleKey: "pro.name.tiered-commission",
    blurbKey: "pro.blurb.tiered-commission",
    category: "finance",
    riskClass: "financial",
    packs: ["racunovodstvo", "biznis", "nekretnine", "transport"],
    keywords: [
      "ceo", "commission", "iznos", "jednom", "marginalno", "najmanja", "najveca", "osnovica",
      "pragovi", "pragovima", "provizija", "proviziju", "skali", "stope", "stopom", "tiered",
      "transama", "unosis"
    ],
  },
];

const PRO_NEKRETNINE_TOOLS: ToolRegistration[] = [
  {
    id: "cashflow-npv-irr",
    titleKey: "pro.name.cashflow-npv-irr",
    blurbKey: "pro.blurb.cashflow-npv-irr",
    category: "finance",
    riskClass: "financial",
    packs: ["racunovodstvo", "biznis", "nekretnine", "transport", "agro"],
    keywords: [
      "cashflow", "diskontna", "internu", "irr", "neto", "niza", "novcani", "npv", "odliva",
      "oznaka", "perioda", "periodima", "periodu", "priliva", "prinosa", "sadasnju", "stopa",
      "stopu", "tok", "tokovi"
    ],
  },
  {
    id: "cost-allocation",
    titleKey: "pro.name.cost-allocation",
    blurbKey: "pro.blurb.cost-allocation",
    category: "finance",
    riskClass: "financial",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine", "event"],
    keywords: [
      "allocation", "celinu", "ciji", "cost", "deli", "delove", "delovi", "iznos", "kljuc",
      "korak", "naziv", "povrsini", "raspodela", "raspodele", "raspodelu", "redovi", "saberu",
      "tacno", "trosak", "troskova", "udelu", "ukupan", "zajednicki", "zaokruzivanja",
      "zaokruzivanjem"
    ],
  },
  {
    id: "late-payment-interest",
    titleKey: "pro.name.late-payment-interest",
    blurbKey: "pro.blurb.late-payment-interest",
    category: "finance",
    riskClass: "financial",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine", "transport"],
    keywords: [
      "datum", "docnju", "dospeca", "duga", "godine", "godisnja", "godisnjoj", "interest",
      "iznos", "kamata", "kamatna", "kamatu", "late", "metod", "metodu", "osnovica", "osnovici",
      "payment", "placanja", "placanje", "sami", "stopa", "stopi", "unesete", "zakasnelo"
    ],
  },
  {
    id: "lease-term-dates",
    titleKey: "pro.name.lease-term-dates",
    blurbKey: "pro.blurb.lease-term-dates",
    category: "time",
    riskClass: "legal-procedure",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine", "transport", "event"],
    keywords: [
      "dan", "dates", "datum", "datuma", "datume", "dospeca", "isteka", "lease", "mesecu",
      "otkaz", "otkazni", "pocetka", "poslednji", "rata", "rate", "rok", "rokovi", "roku",
      "term", "trajanja", "trajanje", "ugovora", "unesete"
    ],
  },
  {
    id: "loan-amortization",
    titleKey: "pro.name.loan-amortization",
    blurbKey: "pro.blurb.loan-amortization",
    category: "finance",
    riskClass: "financial",
    packs: ["racunovodstvo", "biznis", "nekretnine", "transport", "agro"],
    keywords: [
      "amortization", "anuitetnog", "duga", "efekat", "godisnja", "iznos", "kamatna", "kredita",
      "loan", "mesec", "mesecima", "mesecnih", "nks", "nominalna", "ostatak", "otplate", "plan",
      "prevremene", "rata", "stopa", "trazi", "uplate"
    ],
  },
  {
    id: "ownership-shares",
    titleKey: "pro.name.ownership-shares",
    blurbKey: "pro.blurb.ownership-shares",
    category: "calculation",
    riskClass: "legal-procedure",
    packs: ["pravo", "racunovodstvo", "nekretnine", "agro"],
    keywords: [
      "brojilac", "imenilac", "kvadrate", "nazad", "obrnuti", "ownership", "povrsina",
      "prevodi", "razlomak", "razlomke", "redovi", "sabira", "shares", "smer", "suvlasnicke",
      "suvlasnicki", "tacne", "udele", "udeli", "udeo", "ukupna"
    ],
  },
  {
    id: "parcel-polygon-area",
    titleKey: "pro.name.parcel-polygon-area",
    blurbKey: "pro.blurb.parcel-polygon-area",
    category: "geometry",
    riskClass: "none",
    packs: ["gradnja", "inzenjering", "nekretnine", "agro"],
    keywords: [
      "area", "drzavna", "formulom", "gausovom", "koordinata", "koordinate", "metarskom",
      "moraju", "niza", "npr", "obim", "parcel", "parcele", "polygon", "povrsina", "povrsinu",
      "pravouglom", "prelomnih", "projekcija", "redu", "sistemu", "surveyor", "tacaka", "tacke"
    ],
  },
  {
    id: "plot-density-index",
    titleKey: "pro.name.plot-density-index",
    blurbKey: "pro.blurb.plot-density-index",
    category: "calculation",
    riskClass: "legal-procedure",
    packs: ["gradnja", "inzenjering", "nekretnine"],
    keywords: [
      "brgp", "bruto", "density", "gradjevinska", "indeks", "indeksu", "izgradjenosti",
      "objektom", "parcele", "plana", "plot", "povrsina", "povrsine", "povrsinu", "razvijena",
      "unesete", "zauzetosti"
    ],
  },
  {
    id: "pro-rata-days",
    titleKey: "pro.name.pro-rata-days",
    blurbKey: "pro.blurb.pro-rata-days",
    category: "finance",
    riskClass: "financial",
    sourceKey: "pro.sources.isda-2006-30e-360",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine", "event"],
    keywords: [
      "brojanja", "broju", "celinu", "dan", "dana", "danima", "datum", "days", "deli", "iznos",
      "korisniku", "kraja", "osnovica", "period", "perioda", "pocetka", "primopredaje",
      "pripada", "pro", "rata", "saberu", "tacno", "ukljucivo", "ukupan"
    ],
  },
  {
    id: "rent-escalation",
    titleKey: "pro.name.rent-escalation",
    blurbKey: "pro.blurb.rent-escalation",
    category: "finance",
    riskClass: "financial",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine", "event"],
    keywords: [
      "diskontna", "escalation", "indeks", "indeksacija", "iznos", "period", "perioda",
      "periodu", "pocetna", "primenjuje", "rent", "sadasnju", "stopa", "unesete", "zakupa",
      "zakupnina", "zakupnine", "zakupninu", "zbir"
    ],
  },
  {
    id: "rent-gross-net",
    titleKey: "pro.name.rent-gross-net",
    blurbKey: "pro.blurb.rent-gross-net",
    category: "finance",
    riskClass: "financial",
    packs: ["pravo", "racunovodstvo", "biznis", "nekretnine"],
    keywords: [
      "bruto", "gross", "iznos", "nazad", "net", "neto", "normiranih", "ostaje", "preracunava",
      "priznatih", "procenat", "procentu", "rent", "sami", "stopa", "stopi", "troskova",
      "ugovoreni", "unosite", "zakupnina"
    ],
  },
  {
    id: "rental-yield",
    titleKey: "pro.name.rental-yield",
    blurbKey: "pro.blurb.rental-yield",
    category: "finance",
    riskClass: "financial",
    packs: ["racunovodstvo", "biznis", "nekretnine", "transport", "agro"],
    keywords: [
      "bruto", "cena", "cene", "godisnji", "kapitalizaciona", "mesecna", "mesecni",
      "nekretnine", "neto", "obrnuti", "period", "popunjenost", "povracaja", "prihod", "prinos",
      "rental", "smer", "stopa", "stope", "troskova", "troskovi", "unesete", "yield", "zakupa",
      "zakupnina", "zakupnine"
    ],
  },
  {
    id: "room-quad-area",
    titleKey: "pro.name.room-quad-area",
    blurbKey: "pro.blurb.room-quad-area",
    category: "geometry",
    riskClass: "none",
    packs: ["gradnja", "inzenjering", "dizajn", "nekretnine", "zanat"],
    keywords: [
      "area", "cetiri", "dijagonala", "dijagonale", "izmerene", "jedne", "povrsina", "povrsinu",
      "pravougaonik", "prostorije", "quad", "retko", "room", "soba", "stranica", "stranice",
      "ugao", "uglu"
    ],
  },
  {
    id: "wall-ceiling-area",
    titleKey: "pro.name.wall-ceiling-area",
    blurbKey: "pro.blurb.wall-ceiling-area",
    category: "materials",
    riskClass: "none",
    packs: ["gradnja", "dizajn", "nekretnine", "zanat"],
    keywords: [
      "area", "ceiling", "duzina", "izdasnost", "izdasnosti", "kolicinu", "komada",
      "materijala", "neto", "odbitak", "otvora", "otvori", "plafon", "plafona", "povrsinu",
      "prostorije", "sirina", "slojeva", "ukljuciti", "unesete", "visina", "wall", "zidova",
      "zidovi"
    ],
  },
  {
    id: "weighted-area",
    titleKey: "pro.name.weighted-area",
    blurbKey: "pro.blurb.weighted-area",
    category: "geometry",
    riskClass: "financial",
    packs: ["gradnja", "pravo", "nekretnine"],
    keywords: [
      "area", "cena", "cenu", "delova", "duzina", "koeficijent", "koeficijentima", "kvadraturu",
      "naziv", "obracunska", "obracunske", "obracunsku", "pomnozene", "povrsina", "povrsine",
      "redu", "sabira", "sirina", "stana", "umesto", "unesete", "weighted"
    ],
  },
];

const PRO_TRANSPORT_TOOLS: ToolRegistration[] = [
  {
    id: "axle-load-distribution",
    titleKey: "pro.name.axle-load-distribution",
    blurbKey: "pro.blurb.axle-load-distribution",
    category: "structure",
    riskClass: "life-safety",
    packs: ["transport"],
    keywords: [
      "axle", "ciljno", "distribution", "granica", "grupa", "grupe", "kraljicnog", "load",
      "mase", "medjuosovinsko", "medjuosovinskog", "opterecenje", "osovina", "osovine",
      "osovinske", "osovinsko", "pogonske", "polozaja", "poluprikolice", "prazna", "prazne",
      "prednja", "prednje", "rastojanja", "rastojanje", "sedla", "sredine", "tara", "tegljac",
      "tegljaca", "tereta", "teziste", "ukupne", "vage", "zadnja", "zadnje"
    ],
  },
  {
    id: "cargo-centre-of-gravity",
    titleKey: "pro.name.cargo-centre-of-gravity",
    blurbKey: "pro.blurb.cargo-centre-of-gravity",
    category: "structure",
    riskClass: "life-safety",
    packs: ["transport"],
    keywords: [
      "cargo", "centre", "dimenzije", "duzini", "gravity", "komada", "masa", "masom", "moment",
      "momente", "njegove", "nula", "poda", "polozajem", "prikolice", "prostora", "razmak",
      "referentna", "sirina", "sirini", "spiska", "tacka", "tereta", "tezista", "teziste",
      "tla", "tockova", "tovarnog", "trag", "umesto", "unutrasnja", "uzeti", "visina", "visini",
      "vozila"
    ],
  },
  {
    id: "chargeable-weight",
    titleKey: "pro.name.chargeable-weight",
    blurbKey: "pro.blurb.chargeable-weight",
    category: "calculation",
    riskClass: "financial",
    packs: ["transport"],
    keywords: [
      "celu", "cena", "chargeable", "delilac", "deliocu", "dimenzija", "fakturise", "kilogramu",
      "komadu", "korak", "masa", "mase", "masu", "mestu", "metar", "metru", "obracunska",
      "obracunsku", "paletnih", "paletnom", "posiljke", "posiljku", "prostora", "sirina",
      "stvarne", "tovarni", "tovarnog", "tovarnom", "umesto", "weight", "zadat",
      "zaokruzivanja", "zaokruzivati", "zapreminsku"
    ],
  },
  {
    id: "cost-per-km-transport",
    titleKey: "pro.name.cost-per-km-transport",
    blurbKey: "pro.blurb.cost-per-km-transport",
    category: "finance",
    riskClass: "financial",
    packs: ["transport"],
    keywords: [
      "adblue", "cena", "cenu", "ciljna", "cost", "dana", "dizela", "fiksni", "fiksnih",
      "godisnje", "godisnji", "godisnjih", "goriva", "guma", "hoda", "interval", "kilometra",
      "kilometri", "kilometru", "kompleta", "kostanja", "marza", "marze", "marziranje",
      "obracuna", "per", "popravke", "potrosnja", "praznog", "predjeni", "radnih", "redovnog",
      "rezerva", "servisa", "servisni", "teretom", "transport", "trosak", "troskova",
      "troskovi", "udeo", "vek"
    ],
  },
  {
    id: "driving-hours-planner",
    titleKey: "pro.name.driving-hours-planner",
    blurbKey: "pro.blurb.driving-hours-planner",
    category: "time",
    riskClass: "life-safety",
    packs: ["transport"],
    keywords: [
      "blokove", "brzina", "deljenje", "dnevna", "dnevne", "dnevnog", "driving", "granica",
      "hours", "istovar", "neprekidne", "odmora", "odmorima", "odvozena", "ostalo", "pauzama",
      "pauze", "planirana", "planiranu", "planner", "polaska", "poslednje", "prosecna", "radno",
      "rasporedjuje", "rastojanje", "satnicu", "trajanje", "unese", "utovar", "voznja",
      "voznje", "voznju", "vreme"
    ],
  },
  {
    id: "eta-with-breaks",
    titleKey: "pro.name.eta-with-breaks",
    blurbKey: "pro.blurb.eta-with-breaks",
    category: "time",
    riskClass: "none",
    packs: ["transport"],
    keywords: [
      "breaks", "brzina", "brzine", "brzinu", "cekanje", "ciljno", "ciljnog", "datum",
      "dolaska", "eta", "granici", "istovar", "pauze", "planirane", "planiranih", "polaska",
      "procena", "prosecna", "prosecne", "prosecnu", "rastojanja", "rastojanje", "rezerva",
      "trajektu", "utovar", "voznji", "vrata", "vreme", "with", "zastoja"
    ],
  },
  {
    id: "fuel-consumption-cost",
    titleKey: "pro.name.fuel-consumption-cost",
    blurbKey: "pro.blurb.fuel-consumption-cost",
    category: "calculation",
    riskClass: "none",
    packs: ["transport"],
    keywords: [
      "cena", "cenu", "consumption", "cost", "fuel", "goriva", "gorivo", "kilometraze",
      "kilometru", "kraju", "masa", "pocetku", "potrosnja", "potrosnju", "predjeni",
      "predjenog", "preostalo", "put", "puta", "rezervoaru", "stanje", "tereta", "tona",
      "utroseno", "utrosenog"
    ],
  },
  {
    id: "gear-ratio-road-speed",
    titleKey: "pro.name.gear-ratio-road-speed",
    blurbKey: "pro.blurb.gear-ratio-road-speed",
    category: "calculation",
    riskClass: "none",
    packs: ["transport"],
    keywords: [
      "brzina", "brzinom", "gear", "gume", "kojima", "kotrljajni", "menja", "menjaca", "mosta",
      "motora", "obim", "obrtaje", "obrtaji", "odnos", "povezuje", "prenosni", "ratio",
      "razdelnika", "reduktora", "road", "speed", "stepen", "stepena", "vozila", "zadnjeg",
      "zeljena"
    ],
  },
  {
    id: "gvw-payload",
    titleKey: "pro.name.gvw-payload",
    blurbKey: "pro.blurb.gvw-payload",
    category: "structure",
    riskClass: "life-safety",
    sourceKey: "pro.sources.fuel-fluid-densities",
    packs: ["transport"],
    keywords: [
      "adblue", "alat", "ambalaze", "goriva", "gorivo", "granica", "granicama", "gustina",
      "gvw", "licni", "masa", "mase", "masu", "nadogradnjom", "nosivost", "oprema", "opremu",
      "paleta", "payload", "poluprikolice", "posada", "posadu", "prikolice", "prtljag",
      "rezervoaru", "sabira", "skupa", "tara", "taru", "teret", "ukupna", "ukupne", "ukupnu",
      "unese", "vozac", "vozila"
    ],
  },
  {
    id: "load-lashing-force",
    titleKey: "pro.name.load-lashing-force",
    blurbKey: "pro.blurb.load-lashing-force",
    category: "structure",
    riskClass: "life-safety",
    packs: ["transport"],
    keywords: [
      "drugu", "etikete", "faktor", "force", "horizontalni", "koeficijenata", "koeficijent",
      "lashing", "load", "masa", "mase", "obezbedjenja", "postavci", "postavka", "prenosa",
      "sila", "silu", "smer", "stf", "stranu", "tereta", "trenja", "ubrzanja", "ugao", "unese",
      "vertikalni", "vezica", "vezicama", "vezice", "zatezanja"
    ],
  },
  {
    id: "loading-space-utilisation",
    titleKey: "pro.name.loading-space-utilisation",
    blurbKey: "pro.blurb.loading-space-utilisation",
    category: "geometry",
    riskClass: "none",
    packs: ["transport"],
    keywords: [
      "duzina", "iskoriscenje", "loading", "metar", "metre", "osnovici", "podnu", "posiljke",
      "povrsinu", "prostora", "prostorom", "raspolozivim", "sirina", "space", "svakoj",
      "tovarne", "tovarni", "tovarnog", "ugovorna", "unutrasnja", "utilisation", "visina",
      "zapreminu"
    ],
  },
  {
    id: "pallet-load-plan",
    titleKey: "pro.name.pallet-load-plan",
    blurbKey: "pro.blurb.pallet-load-plan",
    category: "geometry",
    riskClass: "none",
    sourceKey: "pro.sources.pallet-footprints",
    packs: ["transport"],
    keywords: [
      "date", "dozvoljeno", "duzina", "load", "mere", "najvise", "natovarene", "okretanje",
      "paleta", "palete", "pallet", "plan", "podu", "proizvoljna", "prostora", "raspored",
      "rasporedu", "sirina", "slaganje", "slaganjem", "slojeva", "staje", "svakom", "tip",
      "tovarnog", "unutrasnja", "unutrasnje", "visina", "visinu"
    ],
  },
  {
    id: "reefer-fuel-consumption",
    titleKey: "pro.name.reefer-fuel-consumption",
    blurbKey: "pro.blurb.reefer-fuel-consumption",
    category: "calculation",
    riskClass: "none",
    packs: ["transport"],
    keywords: [
      "agregata", "cena", "cenu", "consumption", "fuel", "goriva", "gorivo", "hladnjace",
      "neprekidnom", "paleta", "pokriva", "potrosnja", "potrosnje", "rada", "reefer",
      "rezervoaru", "rezimu", "sate", "sati", "spustanju", "start", "stop", "temperature",
      "trajanje", "ture", "utroseno", "vucu"
    ],
  },
  {
    id: "service-interval-km-hours",
    titleKey: "pro.name.service-interval-km-hours",
    blurbKey: "pro.blurb.service-interval-km-hours",
    category: "time",
    riskClass: "none",
    packs: ["transport"],
    keywords: [
      "danasnji", "datum", "datuma", "dnevno", "hours", "interval", "istice", "kilometara",
      "kilometraza", "kilometrima", "mesecima", "motocasova", "motocasovi", "motocasovima",
      "poslednjeg", "poslednjem", "prosecno", "service", "servisa", "servisni", "servisu",
      "trenutna", "trenutni"
    ],
  },
  {
    id: "speedometer-tyre-deviation",
    titleKey: "pro.name.speedometer-tyre-deviation",
    blurbKey: "pro.blurb.speedometer-tyre-deviation",
    category: "conversion",
    riskClass: "none",
    packs: ["transport"],
    keywords: [
      "brzina", "brzinomera", "brzinomeru", "brzinu", "deviation", "dimenzije", "faktor",
      "gresku", "guma", "gume", "izmereni", "kilometraze", "kotrljajni", "nova", "nove", "obim",
      "odstupanje", "opterecenjem", "postojeca", "postojece", "predjeno", "promeni", "promenu",
      "putnom", "racunaru", "speedometer", "stvarnu", "tyre", "ugiba", "visine", "vozila"
    ],
  },
  {
    id: "tank-volume-by-level",
    titleKey: "pro.name.tank-volume-by-level",
    blurbKey: "pro.blurb.tank-volume-by-level",
    category: "geometry",
    riskClass: "none",
    sourceKey: "pro.sources.fuel-fluid-densities",
    packs: ["transport"],
    keywords: [
      "cena", "ciljna", "dna", "dubina", "duzina", "gustina", "ispupcenog", "izmereni",
      "izmerenog", "level", "lezecem", "litru", "masu", "nivo", "nivoa", "oblik", "popunjenost",
      "precnik", "rezervoara", "rezervoaru", "sirina", "stojecem", "tank", "tecnosti", "visina",
      "volume", "zapremina", "zapreminu"
    ],
  },
  {
    id: "trip-cost-quote",
    titleKey: "pro.name.trip-cost-quote",
    blurbKey: "pro.blurb.trip-cost-quote",
    category: "finance",
    riskClass: "financial",
    packs: ["transport"],
    keywords: [
      "cekanja", "cekanje", "cena", "cenu", "cost", "dana", "dnevnica", "dnevnice", "istovaru",
      "kilometrazu", "kilometri", "kilometru", "kostanja", "marza", "marze", "marziranje",
      "masa", "naknade", "nocenja", "obracuna", "pdv", "prazni", "prevoza", "pristupni",
      "putarine", "putu", "quote", "sabira", "sata", "sati", "stopa", "tereta", "teretom",
      "trajekt", "trip", "trosak", "troskovi", "tunel", "ture", "utovaru", "vinjeta"
    ],
  },
];

const PRO_AGRO_TOOLS: ToolRegistration[] = [
  {
    id: "bale-count-storage",
    titleKey: "pro.name.bale-count-storage",
    blurbKey: "pro.blurb.bale-count-storage",
    category: "materials",
    riskClass: "none",
    packs: ["agro"],
    keywords: [
      "bala", "bale", "baliranju", "count", "dimenzije", "duzina", "geometriji", "gubitak",
      "gustina", "jedne", "korisna", "masa", "mase", "nadstresnicu", "oblik", "one",
      "orijentacija", "pokosena", "povrsina", "precnik", "prikolicu", "prinos", "role", "rolo",
      "sirina", "skladista", "skladiste", "slaganja", "slaganju", "staje", "storage", "visina",
      "zadavanja", "zapremine", "zauzimaju"
    ],
  },
  {
    id: "bee-syrup-mix",
    titleKey: "pro.name.bee-syrup-mix",
    blurbKey: "pro.blurb.bee-syrup-mix",
    category: "materials",
    riskClass: "none",
    packs: ["agro"],
    keywords: [
      "bee", "gustina", "izabranom", "kolicina", "kolicinu", "koncentracija", "kosnica",
      "kosnice", "kosnici", "masa", "mix", "odnos", "odnosa", "odnosu", "osnova", "pcele",
      "racunata", "secer", "secera", "sirup", "sirupa", "syrup", "voda", "vode", "vrece"
    ],
  },
  {
    id: "cadastral-area-units",
    titleKey: "pro.name.cadastral-area-units",
    blurbKey: "pro.blurb.cadastral-area-units",
    category: "conversion",
    riskClass: "none",
    sourceKey: "pro.sources.austrian-metrication-1871",
    packs: ["gradnja", "pravo", "nekretnine", "agro"],
    keywords: [
      "are", "area", "cadastral", "hektare", "hvate", "jedinica", "jutra", "katastarska",
      "katastarske", "kvadratne", "mere", "metre", "obrnuto", "polazna", "pretvara", "units"
    ],
  },
  {
    id: "fertiliser-nutrient-blend",
    titleKey: "pro.name.fertiliser-nutrient-blend",
    blurbKey: "pro.blurb.fertiliser-nutrient-blend",
    category: "materials",
    riskClass: "life-safety",
    packs: ["agro"],
    keywords: [
      "azota", "blend", "ciljana", "ciljanih", "djubriva", "djubrivo", "donosi", "dopunsko",
      "dopunskog", "fertiliser", "fosfora", "hektaru", "hraniva", "hranivo", "kalijuma",
      "kilograme", "kolicina", "masa", "npk", "nutrient", "osnovno", "osnovnog", "povrsina",
      "preracun", "procentima", "sastav", "sastava", "smer", "svakog", "ukupno", "unetih",
      "vodece", "vrece"
    ],
  },
  {
    id: "grain-moisture-shrink",
    titleKey: "pro.name.grain-moisture-shrink",
    blurbKey: "pro.blurb.grain-moisture-shrink",
    category: "materials",
    riskClass: "financial",
    packs: ["agro"],
    keywords: [
      "bruto", "cena", "ciljana", "grain", "izaslo", "izmerena", "izmerene", "kalo",
      "kilograma", "kilogramu", "korisna", "masa", "moisture", "odbitaka", "odbitka", "ostane",
      "padne", "primesa", "primese", "redosled", "shrink", "susare", "susenja", "toplota",
      "ugovora", "ugovorena", "vlaga", "vlage", "vlagu", "vode", "zrna", "zrno"
    ],
  },
  {
    id: "growing-degree-days",
    titleKey: "pro.name.growing-degree-days",
    blurbKey: "pro.blurb.growing-degree-days",
    category: "calculation",
    riskClass: "none",
    packs: ["agro"],
    keywords: [
      "bazna", "bazne", "ciljana", "days", "degree", "dnevne", "dostize", "gornja", "granica",
      "growing", "istom", "izabrao", "metod", "nakupljeno", "period", "pokazuje", "projekciji",
      "prosek", "sabira", "suma", "sume", "temperatura", "temperature", "temperaturne", "tempu"
    ],
  },
  {
    id: "honey-mass-moisture",
    titleKey: "pro.name.honey-mass-moisture",
    blurbKey: "pro.blurb.honey-mass-moisture",
    category: "materials",
    riskClass: "financial",
    packs: ["agro"],
    keywords: [
      "bruto", "cena", "ciljana", "deklarisana", "gustina", "gustine", "honey", "izmerene",
      "kilogramu", "kolicine", "masa", "mass", "masu", "materije", "med", "meda", "merenje",
      "moisture", "neto", "nizu", "odnos", "posude", "posudi", "prazne", "refraktometar",
      "susenja", "suve", "tara", "tegle", "uzorka", "vlaga", "vlage", "vlagu", "vode",
      "zadavanja", "zapremina"
    ],
  },
  {
    id: "irrigation-depth-volume",
    titleKey: "pro.name.irrigation-depth-volume",
    blurbKey: "pro.blurb.irrigation-depth-volume",
    category: "materials",
    riskClass: "none",
    packs: ["agro"],
    keywords: [
      "biljci", "depth", "dnevno", "efikasnost", "hektaru", "intenzitet", "irrigation",
      "jednog", "jednoj", "kapaljke", "kapaljki", "kise", "kubike", "milimetrima", "norma",
      "normu", "povrsina", "pretvara", "pripada", "protok", "protoku", "rada", "raspoloziv",
      "rasprskivaca", "razmak", "redova", "redu", "sati", "sistema", "volume", "vreme",
      "zalivanja", "zalivna", "zalivnu"
    ],
  },
  {
    id: "livestock-ration-dm",
    titleKey: "pro.name.livestock-ration-dm",
    blurbKey: "pro.blurb.livestock-ration-dm",
    category: "materials",
    riskClass: "none",
    packs: ["agro"],
    keywords: [
      "dana", "dnevnu", "grla", "grlu", "gubitak", "hraniva", "jaslama", "kilograme",
      "livestock", "masa", "materije", "materiji", "obrok", "potrebnu", "potrosnju", "pretvara",
      "prosecna", "rastur", "ration", "stada", "suve", "suvoj", "svakog", "sveze", "telesna",
      "ukupnu", "zadat", "zalihu"
    ],
  },
  {
    id: "machine-field-capacity",
    titleKey: "pro.name.machine-field-capacity",
    blurbKey: "pro.blurb.machine-field-capacity",
    category: "calculation",
    riskClass: "none",
    packs: ["agro"],
    keywords: [
      "brzina", "brzine", "capacity", "celu", "cena", "dnevno", "duzina", "goriva", "hektare",
      "hektaru", "iskoriscenja", "iskoriscenje", "jednog", "machine", "masine", "okretanja",
      "parcele", "parcelu", "potrosnja", "potrosnju", "povrsina", "pravcu", "preklop", "rada",
      "radna", "radni", "radnih", "radnog", "sat", "sati", "ucinak", "uvratini", "vreme",
      "vremena", "zahvat", "zahvata"
    ],
  },
  {
    id: "orchard-trellis-layout",
    titleKey: "pro.name.orchard-trellis-layout",
    blurbKey: "pro.blurb.orchard-trellis-layout",
    category: "materials",
    riskClass: "none",
    packs: ["agro"],
    keywords: [
      "dimenzija", "dodatak", "duzina", "duzinu", "kraju", "layout", "masu", "medje", "naslon",
      "odstojanje", "orchard", "parcele", "pravac", "precnik", "prvog", "razmak", "reda",
      "redova", "redovi", "redu", "sadnica", "sidara", "sirina", "stubova", "svakom", "trellis",
      "uvratina", "vezivanje", "zadatih", "zasad", "zatezanje", "zice", "zicu"
    ],
  },
  {
    id: "plant-spacing-density",
    titleKey: "pro.name.plant-spacing-density",
    blurbKey: "pro.blurb.plant-spacing-density",
    category: "geometry",
    riskClass: "none",
    packs: ["agro"],
    keywords: [
      "biljaka", "bocne", "density", "duzina", "hektaru", "kraju", "medje", "obrnuto",
      "odstojanje", "parcele", "parceli", "plant", "raspored", "razmak", "razmaka", "reda",
      "redova", "redu", "sadnica", "sadnje", "sirina", "sklop", "spacing", "stvaran",
      "uvratina", "uvratinama", "zeljeni"
    ],
  },
  {
    id: "polygon-area",
    titleKey: "pro.name.polygon-area",
    blurbKey: "pro.blurb.polygon-area",
    category: "geometry",
    riskClass: "none",
    packs: ["gradnja", "inzenjering", "nekretnine", "agro"],
    keywords: [
      "area", "jedinica", "kolona", "koordinata", "obilaska", "obim", "parcele", "poligona",
      "polygon", "povrsina", "povrsine", "povrsinu", "prikaza", "redosled", "smer", "spiska",
      "temena", "teziste"
    ],
  },
  {
    id: "seeding-rate",
    titleKey: "pro.name.seeding-rate",
    blurbKey: "pro.blurb.seeding-rate",
    category: "materials",
    riskClass: "none",
    packs: ["agro"],
    keywords: [
      "biljaka", "celu", "cistoca", "cistoci", "gubitak", "hektaru", "izmerenoj", "kilograma",
      "klijavost", "klijavosti", "masa", "masi", "norma", "parcelu", "poljski", "povrsina",
      "rate", "razmak", "redova", "seeding", "semena", "setvena", "setvu", "sklop", "tkw",
      "vrece", "zeljeni", "zrna"
    ],
  },
  {
    id: "sprayer-calibration",
    titleKey: "pro.name.sprayer-calibration",
    blurbKey: "pro.blurb.sprayer-calibration",
    category: "materials",
    riskClass: "life-safety",
    packs: ["agro"],
    keywords: [
      "brzina", "brzine", "calibration", "ciljana", "dizne", "dizni", "gredi", "hektaru",
      "hvatanja", "izmerenog", "jedne", "kalibracija", "kretanja", "litrima", "merenje",
      "norma", "normu", "obrnuto", "predjen", "protok", "protoka", "prskalice", "prskanja",
      "put", "razmak", "razmaka", "rezervoara", "sprayer", "trazi", "uneo", "vreme",
      "zahvacena", "zapremina"
    ],
  },
  {
    id: "tank-mix-dose",
    titleKey: "pro.name.tank-mix-dose",
    blurbKey: "pro.blurb.tank-mix-dose",
    category: "materials",
    riskClass: "life-safety",
    packs: ["agro"],
    keywords: [
      "dose", "doza", "doze", "dozu", "hektara", "jedinica", "kolicine", "male", "mix", "norma",
      "povrsina", "povrsinu", "preparata", "preracunava", "prikaza", "prskanja", "punjenje",
      "rezervoara", "rezervoaru", "tank", "tretiranje", "ukupne", "unosa", "vode", "zapremina"
    ],
  },
  {
    id: "yield-estimate-samples",
    titleKey: "pro.name.yield-estimate-samples",
    blurbKey: "pro.blurb.yield-estimate-samples",
    category: "materials",
    riskClass: "none",
    packs: ["agro"],
    keywords: [
      "biljaka", "biljci", "brojanja", "estimate", "hektaru", "klasova", "klasu", "klipova",
      "klipu", "kvadratu", "masa", "mase", "metod", "odmerenog", "parcele", "plodova",
      "povrsina", "poznjevenog", "preracun", "prinos", "prinosa", "procena", "procenjen",
      "rasipanje", "referentna", "samples", "tkw", "uzoraka", "uzorcima", "uzorka", "uzorku",
      "vlaga", "yield", "zrna"
    ],
  },
];

const PRO_ZANAT_TOOLS: ToolRegistration[] = [
  {
    id: "fabric-yardage-repeat",
    titleKey: "pro.name.fabric-yardage-repeat",
    blurbKey: "pro.blurb.fabric-yardage-repeat",
    category: "materials",
    riskClass: "none",
    packs: ["zanat"],
    keywords: [
      "dodatak", "duznih", "fabric", "horizontalni", "ivici", "komada", "komade", "metara",
      "obavezan", "raport", "raportu", "rastur", "repeat", "rolne", "sare", "sav", "savovima",
      "sirina", "sirini", "smer", "tkanina", "tkanine", "tkanja", "vertikalni", "yardage"
    ],
  },
  {
    id: "glass-pane-weight",
    titleKey: "pro.name.glass-pane-weight",
    blurbKey: "pro.blurb.glass-pane-weight",
    category: "materials",
    riskClass: "life-safety",
    packs: ["zanat"],
    keywords: [
      "debljina", "debljine", "dimenzija", "dimenzije", "folije", "glass", "gustina", "izo",
      "jednog", "komada", "komadu", "laminiranog", "masa", "monolitnog", "paketa", "paketu",
      "pane", "pvb", "sastav", "sastava", "sirina", "sloja", "slojeva", "stakala", "stakla",
      "ukupno", "visina", "weight"
    ],
  },
  {
    id: "iso-286-fits",
    titleKey: "pro.name.iso-286-fits",
    blurbKey: "pro.blurb.iso-286-fits",
    category: "geometry",
    riskClass: "none",
    sourceKey: "pro.sources.iso-286-1-2010",
    packs: ["zanat"],
    keywords: [
      "286", "fits", "granicne", "iso", "mera", "mere", "naleganja", "naleganje", "nominalna",
      "odstupanja", "osovine", "oznaka", "oznaku", "rupe", "slovo", "stepen", "tolerancije",
      "zazor", "zazorom"
    ],
  },
  {
    id: "linear-cutting-stock",
    titleKey: "pro.name.linear-cutting-stock",
    blurbKey: "pro.blurb.linear-cutting-stock",
    category: "materials",
    riskClass: "none",
    packs: ["zanat"],
    keywords: [
      "cutting", "cuva", "duzina", "duzine", "idu", "kerf", "komada", "komadi", "kraju",
      "krojenje", "linear", "magacina", "najmanji", "ostatak", "otpad", "pada", "pocetku",
      "potrebnih", "reza", "sipke", "sipki", "sipku", "sirina", "sirine", "spiska", "stock"
    ],
  },
  {
    id: "mitre-angles",
    titleKey: "pro.name.mitre-angles",
    blurbKey: "pro.blurb.mitre-angles",
    category: "geometry",
    riskClass: "none",
    packs: ["zanat"],
    keywords: [
      "angle", "angles", "duzina", "gerung", "komada", "lajsne", "lista", "mitre", "nagib",
      "nagnuta", "naslona", "podesavanja", "ram", "reza", "sirina", "slozeni", "spring",
      "stranica", "stranice", "svetla", "testere", "ugao", "unutrasnja", "vertikale"
    ],
  },
  {
    id: "mortar-mix-quantity",
    titleKey: "pro.name.mortar-mix-quantity",
    blurbKey: "pro.blurb.mortar-mix-quantity",
    category: "materials",
    riskClass: "none",
    packs: ["zanat"],
    keywords: [
      "agregat", "agregata", "brojem", "debljina", "debljine", "faktor", "gotove", "gustina",
      "kilogramu", "kolicina", "lepak", "malter", "maltera", "masa", "mesanje", "mix", "mortar",
      "nasipna", "odnos", "potrosnja", "povrsina", "povrsine", "quantity", "rastur", "rasturom",
      "sastojaka", "sloja", "smese", "svezeg", "veziva", "vezivo", "voda", "vodom",
      "vodovezivni", "vreca", "vrece", "zapremina", "zapremini", "zbijanja", "zbir"
    ],
  },
  {
    id: "panel-cutting-yield",
    titleKey: "pro.name.panel-cutting-yield",
    blurbKey: "pro.blurb.panel-cutting-yield",
    category: "materials",
    riskClass: "none",
    packs: ["zanat"],
    keywords: [
      "cutting", "format", "formata", "ivica", "ivice", "jedne", "kerf", "komada", "obavezan",
      "obrezivanje", "otpad", "panel", "ploca", "ploce", "raskroj", "reza", "sirina", "sirinu",
      "smer", "teksture", "yield", "zadatog"
    ],
  },
  {
    id: "sheet-metal-bend",
    titleKey: "pro.name.sheet-metal-bend",
    blurbKey: "pro.blurb.sheet-metal-bend",
    category: "geometry",
    riskClass: "none",
    packs: ["zanat"],
    keywords: [
      "bend", "debljina", "duzina", "faktor", "faktora", "izmerena", "izmerenog", "krakova",
      "krakovi", "lima", "linija", "mera", "metal", "obrnuti", "polozaji", "pravca", "racun",
      "radijus", "radijusa", "razvijena", "savijanja", "sheet", "skretanje", "spoljnih", "ugao",
      "unutrasnji", "uzorka", "zadavanja"
    ],
  },
  {
    id: "shelf-deflection",
    titleKey: "pro.name.shelf-deflection",
    blurbKey: "pro.blurb.shelf-deflection",
    category: "structure",
    riskClass: "life-safety",
    packs: ["zanat"],
    keywords: [
      "debljina", "deflection", "elasticnosti", "granica", "granicom", "koncentrisana", "modul",
      "modulu", "napon", "napona", "opterecenje", "opterecenju", "oslonaca", "oslonca",
      "police", "polici", "preseku", "raspon", "raspona", "ravnomerno", "shelf", "sila",
      "sirina", "sredini", "svetlo", "ugib", "ugiba", "unese", "unetom"
    ],
  },
  {
    id: "shelf-spacing",
    titleKey: "pro.name.shelf-spacing",
    blurbKey: "pro.blurb.shelf-spacing",
    category: "geometry",
    riskClass: "none",
    sourceKey: "pro.sources.cabinet-hole-raster-system-32",
    packs: ["zanat"],
    keywords: [
      "busenja", "debljina", "debljinom", "donje", "donjeg", "ivice", "jednaki", "korpusa",
      "najblizi", "otvor", "otvora", "otvori", "polica", "police", "polozaji", "raspored",
      "raster", "rasteru", "shelf", "snap", "spacing", "svetli", "unutrasnja", "uracunatom",
      "visina"
    ],
  },
  {
    id: "tap-drill-size",
    titleKey: "pro.name.tap-drill-size",
    blurbKey: "pro.blurb.tap-drill-size",
    category: "geometry",
    riskClass: "none",
    sourceKey: "pro.sources.iso-metric-thread-261-273-68",
    packs: ["zanat"],
    keywords: [
      "burgije", "burgiju", "busenje", "drill", "korak", "navoj", "navoja", "nominalni",
      "precnik", "procenat", "procentu", "prolazne", "rupe", "serija", "size", "tap",
      "urezivanje", "zahvata"
    ],
  },
  {
    id: "timber-volume",
    titleKey: "pro.name.timber-volume",
    blurbKey: "pro.blurb.timber-volume",
    category: "materials",
    riskClass: "none",
    packs: ["zanat"],
    keywords: [
      "datoj", "debljem", "debljina", "drveta", "duzina", "gradje", "gustina", "gustini",
      "huberu", "koeficijent", "komada", "komadu", "kore", "kraju", "kubikaza", "kubni", "masa",
      "metar", "obracuna", "precnici", "precnik", "preracun", "presek", "prm", "prostornog",
      "prostornosti", "rezane", "sirina", "smalianu", "srednji", "tanjem", "timber", "trupca",
      "ukupno", "unetoj", "vlaznosti", "volume", "zapremina"
    ],
  },
  {
    id: "wallpaper-rolls",
    titleKey: "pro.name.wallpaper-rolls",
    blurbKey: "pro.blurb.wallpaper-rolls",
    category: "materials",
    riskClass: "none",
    packs: ["zanat"],
    keywords: [
      "dole", "duzina", "duzinu", "gore", "jedne", "korak", "lepe", "lepljenja", "obim",
      "obima", "odbijaju", "otvora", "pune", "raport", "raporta", "rezerva", "rezervne",
      "rolls", "rolne", "rolni", "sare", "sirina", "sirine", "slaganja", "tapeta", "traci",
      "traka", "trake", "vertikalni", "visina", "visine", "vrata", "vrsta", "wallpaper",
      "zajedno", "zida", "zidova"
    ],
  },
  {
    id: "weld-consumable",
    titleKey: "pro.name.weld-consumable",
    blurbKey: "pro.blurb.weld-consumable",
    category: "materials",
    riskClass: "none",
    packs: ["zanat"],
    keywords: [
      "brojem", "consumable", "debljina", "dodatnog", "duzina", "duzine", "duzinom",
      "elektroda", "elektrode", "gustina", "iskoriscenje", "iskoristivi", "istih", "jedne",
      "katet", "korena", "korenskog", "lima", "masa", "materijala", "metala", "nadvisenje",
      "navara", "njen", "nosa", "otvor", "potrebnog", "potrosnja", "precnik", "preseka",
      "rastur", "sava", "savova", "ugao", "ugaonog", "visina", "vrsta", "weld", "zavarivanje",
      "zice", "zleba"
    ],
  },
  {
    id: "wood-moisture-movement",
    titleKey: "pro.name.wood-moisture-movement",
    blurbKey: "pro.blurb.wood-moisture-movement",
    category: "materials",
    riskClass: "none",
    sourceKey: "pro.sources.usda-wood-handbook-2021",
    packs: ["zanat"],
    keywords: [
      "alternativno", "apsolutno", "dimenzija", "drveta", "elementa", "koeficijent", "krajnja",
      "max", "min", "moisture", "movement", "ocekivani", "ostaje", "polazna", "promeni",
      "prostoriji", "rad", "raspon", "sirina", "sirovog", "skupljanja", "skupljanje", "suvog",
      "tacka", "tzv", "ugradnji", "ukupno", "vlage", "vlakana", "vlazi", "vlaznost",
      "vlaznosti", "wood", "zasicenja", "zazor"
    ],
  },
];

const PRO_EVENT_TOOLS: ToolRegistration[] = [
  {
    id: "beam-spot-diameter",
    titleKey: "pro.name.beam-spot-diameter",
    blurbKey: "pro.blurb.beam-spot-diameter",
    category: "geometry",
    riskClass: "none",
    packs: ["event"],
    keywords: [
      "beam", "centru", "diameter", "duzina", "horizontalno", "jacina", "jacine", "kosi",
      "kruga", "mete", "odstojanje", "osvetljenog", "osvetljenost", "pokriva", "polja",
      "precnik", "preklapanje", "rastojanja", "rastojanje", "razmak", "reflektora", "snop",
      "snopa", "snopova", "spot", "susednih", "svetlosti", "ugao", "ugla", "ukljucujuci",
      "upad", "vesanja", "visina"
    ],
  },
  {
    id: "budget-per-guest",
    titleKey: "pro.name.budget-per-guest",
    blurbKey: "pro.blurb.budget-per-guest",
    category: "finance",
    riskClass: "financial",
    packs: ["event"],
    keywords: [
      "budget", "budzet", "cena", "cenu", "fiksne", "gostiju", "gostu", "guest", "karte",
      "nuli", "osnovica", "per", "plativih", "poreska", "porez", "prihodi", "procentualne",
      "rezerva", "rezervu", "sabira", "stolova", "stolu", "stopa", "troskove", "troskovi"
    ],
  },
  {
    id: "catering-per-guest",
    titleKey: "pro.name.catering-per-guest",
    blurbKey: "pro.blurb.catering-per-guest",
    category: "materials",
    riskClass: "none",
    packs: ["event"],
    keywords: [
      "catering", "gostiju", "gostu", "guest", "hrana", "kolicine", "kolicinu", "pakovanja",
      "per", "pice", "porcije", "rezerve", "stavci", "stavku", "svakoj", "tocenje", "udela",
      "ukupnu", "uzimaju", "velicina", "visak", "zaokruzivanje"
    ],
  },
  {
    id: "generator-sizing",
    titleKey: "pro.name.generator-sizing",
    blurbKey: "pro.blurb.generator-sizing",
    category: "electrical",
    riskClass: "life-safety",
    packs: ["event"],
    keywords: [
      "agregata", "faktor", "faktorom", "generator", "goriva", "istovremenoscu", "motora",
      "nadmorska", "najveceg", "nazivni", "polaska", "polasku", "potrosace", "potrosaci",
      "potrosnja", "prividna", "prividnu", "rada", "radnu", "rezerva", "sabira", "sizing",
      "smanjenje", "snaga", "snage", "snagu", "specificna", "startna", "temperatura",
      "trajanje", "trenutku", "visina", "vrsnu"
    ],
  },
  {
    id: "ice-and-chilling",
    titleKey: "pro.name.ice-and-chilling",
    blurbKey: "pro.blurb.ice-and-chilling",
    category: "materials",
    riskClass: "food-safety",
    packs: ["event"],
    keywords: [
      "ambalaze", "and", "chilling", "ciljna", "ciljnu", "dotok", "drzanja", "ice", "istopi",
      "jednog", "kilograma", "led", "leda", "masa", "masi", "odvede", "okoline", "pakovanja",
      "pica", "pocetna", "pocetne", "rashladjivanje", "specificna", "temperatura",
      "temperaturu", "toplota", "toplote", "toplotu", "vreme", "zadatoj"
    ],
  },
  {
    id: "led-wall-pitch-viewing",
    titleKey: "pro.name.led-wall-pitch-viewing",
    blurbKey: "pro.blurb.led-wall-pitch-viewing",
    category: "media",
    riskClass: "life-safety",
    packs: ["event"],
    keywords: [
      "broja", "daljinu", "dimenziju", "faktor", "kapacitet", "korak", "koraka", "led",
      "maksimalna", "napajanja", "napon", "ostrine", "panela", "piksela", "pikseli", "pitch",
      "porta", "portova", "procesora", "prosecna", "razlikuju", "rezoluciju", "sirina",
      "sirinu", "snaga", "snage", "struju", "ugao", "ukupnu", "vidne", "viewing", "visina",
      "visinu", "wall", "zid", "zida"
    ],
  },
  {
    id: "parking-cloakroom",
    titleKey: "pro.name.parking-cloakroom",
    blurbKey: "pro.blurb.parking-cloakroom",
    category: "calculation",
    riskClass: "none",
    packs: ["event"],
    keywords: [
      "autobusom", "autobusu", "automobilom", "automobilu", "broja", "brzina", "cloakroom",
      "dolazi", "duzina", "duzinu", "garderoba", "garderobi", "garderobom", "gostiju", "gostu",
      "kolima", "komada", "manevarskim", "mestu", "osoba", "parking", "parkinga",
      "popunjenosti", "povrsina", "povrsinu", "prijema", "prosecno", "prostorom", "prozor",
      "radnika", "radniku", "raspoloziva", "razmak", "sipki", "udela", "udeo", "usluge",
      "vesalica", "vozila"
    ],
  },
  {
    id: "projector-throw-screen",
    titleKey: "pro.name.projector-throw-screen",
    blurbKey: "pro.blurb.projector-throw-screen",
    category: "media",
    riskClass: "none",
    packs: ["event"],
    keywords: [
      "ambijentalna", "ambijentalnom", "dijagonalu", "fluks", "gain", "gledalaca", "kontrast",
      "odnos", "odnosa", "osvetljenost", "platna", "platno", "platnu", "pojacanje", "poznata",
      "projector", "projekcija", "projekcioni", "projekcionog", "projektora", "rastojanja",
      "rastojanje", "reda", "screen", "sirinu", "slike", "stranica", "svetlosni", "svetlu",
      "throw", "unese", "velicina", "visinu"
    ],
  },
  {
    id: "rigging-sling-angle-force",
    titleKey: "pro.name.rigging-sling-angle-force",
    blurbKey: "pro.blurb.rigging-sling-angle-force",
    category: "structure",
    riskClass: "life-safety",
    packs: ["event"],
    keywords: [
      "alternativno", "angle", "dinamicki", "faktor", "force", "granica", "horizontalno",
      "horizontalnu", "komponentu", "krakova", "kraku", "masa", "masu", "nesimetrican",
      "odstojanje", "plocice", "razmak", "rigging", "sila", "silu", "sling", "tacaka", "tacke",
      "tereta", "tezista", "ugao", "ugla", "ukljucujuci", "vesanja", "visina", "wll",
      "zadavanja", "zahvat"
    ],
  },
  {
    id: "run-of-show",
    titleKey: "pro.name.run-of-show",
    blurbKey: "pro.blurb.run-of-show",
    category: "time",
    riskClass: "none",
    packs: ["event"],
    keywords: [
      "dogadjaja", "dogovoru", "kraj", "krajnji", "objektom", "pocetka", "pokazuje", "pravi",
      "praznine", "prekoracenje", "prelaz", "prelaza", "prikaz", "rok", "run", "sat", "satnica",
      "satnicu", "show", "tacaka", "tacan", "tacke", "trajanja", "unapred", "unazad", "vreme",
      "zakovanih"
    ],
  },
  {
    id: "seating-tables",
    titleKey: "pro.name.seating-tables",
    blurbKey: "pro.blurb.seating-tables",
    category: "geometry",
    riskClass: "none",
    packs: ["event"],
    keywords: [
      "broja", "celima", "duzina", "gostiju", "gostu", "koliku", "mere", "ploce", "povrsina",
      "povrsinu", "precnik", "prolazom", "prostor", "raspoloziva", "raspored", "seating",
      "sedenje", "sirina", "slobodan", "staje", "stola", "stolicama", "stolova", "stolove",
      "stolovi", "tables", "tip", "zauzimaju"
    ],
  },
  {
    id: "stage-deck-layout",
    titleKey: "pro.name.stage-deck-layout",
    blurbKey: "pro.blurb.stage-deck-layout",
    category: "structure",
    riskClass: "life-safety",
    packs: ["event"],
    keywords: [
      "bina", "bine", "bini", "deck", "dubina", "duzina", "granica", "gustina", "layout",
      "lica", "masa", "mera", "modula", "obim", "obimu", "opterecenja", "opterecenje",
      "orijentacije", "podesta", "podijum", "podijumu", "povrsinu", "proizvodjaca", "rampi",
      "ravnomerno", "ravnomernog", "sirina", "stage", "stepenika", "stepenisnih", "tabele",
      "ukupna", "visina", "zavesa", "zavesom"
    ],
  },
  {
    id: "tent-bay-layout",
    titleKey: "pro.name.tent-bay-layout",
    blurbKey: "pro.blurb.tent-bay-layout",
    category: "geometry",
    riskClass: "none",
    packs: ["event"],
    keywords: [
      "bay", "duzina", "duzinu", "gabarit", "krova", "layout", "modul", "modula", "nagib",
      "natkrivena", "natkrivene", "pojas", "polja", "potrebne", "povrsina", "povrsine",
      "povrsinu", "satora", "sidrenje", "sirina", "slobodan", "stranica", "stranice", "strehe",
      "tent", "umesto", "velicina", "visina", "zategama", "zatege"
    ],
  },
  {
    id: "three-phase-load-balance",
    titleKey: "pro.name.three-phase-load-balance",
    blurbKey: "pro.blurb.three-phase-load-balance",
    category: "electrical",
    riskClass: "life-safety",
    packs: ["event"],
    keywords: [
      "balance", "balans", "faza", "fazama", "faze", "fazi", "fazni", "linijski", "load",
      "napon", "nazivna", "nesimetriju", "nule", "osiguraca", "phase", "potrosaca", "potrosaci",
      "prividnu", "rasporedjenih", "snagu", "spiska", "struja", "struju", "svake", "three",
      "zbirnu"
    ],
  },
  {
    id: "truss-hoist-reactions",
    titleKey: "pro.name.truss-hoist-reactions",
    blurbKey: "pro.blurb.truss-hoist-reactions",
    category: "structure",
    riskClass: "life-safety",
    packs: ["event"],
    keywords: [
      "duzina", "hoist", "kraja", "moguce", "motora", "nosivost", "obesenu", "opterecenje",
      "podizanje", "pojedinacnih", "polozaj", "ravnomerno", "reactions", "silu", "sopstvene",
      "svakoj", "tacke", "tacki", "tereta", "tereti", "tezina", "tezine", "tezista", "trase",
      "trasu", "truss"
    ],
  },
  {
    id: "venue-occupancy-area",
    titleKey: "pro.name.venue-occupancy-area",
    blurbKey: "pro.blurb.venue-occupancy-area",
    category: "geometry",
    riskClass: "life-safety",
    packs: ["event"],
    keywords: [
      "area", "bruto", "dokumentacije", "gostiju", "gustinu", "kapacitet", "lica", "neto",
      "objekta", "occupancy", "oduzete", "oduzetih", "oduzeto", "osoba", "posebno", "povrsina",
      "povrsine", "povrsinu", "procenat", "prostora", "rasporedi", "rasporedu", "svakom",
      "unese", "venue", "zona", "zone"
    ],
  },
  {
    id: "voltage-drop",
    titleKey: "pro.name.voltage-drop",
    blurbKey: "pro.blurb.voltage-drop",
    category: "electrical",
    riskClass: "life-safety",
    sourceKey: "pro.sources.iec-60228-60287-conductor-constants",
    packs: ["gradnja", "inzenjering", "transport", "event"],
    keywords: [
      "drop", "duzina", "duzinu", "granica", "gubitak", "jednom", "materijal", "napon",
      "napona", "nazivni", "otpornost", "pad", "pada", "presek", "primenjuje", "procentima",
      "provodnika", "sistem", "smeru", "snage", "struja", "struju", "temperatura", "trase",
      "voda", "vodu", "voltage", "voltima"
    ],
  },
];

/**
 * The professional drawer's contents, one array per subject.
 *
 * A single concatenation rather than a per-pack module list, because `packs`
 * already carries everything the host needs to route a tool and a second
 * grouping would be a second answer to the same question — the kind that drifts
 * out of agreement with the first. The order here is the order the drawer draws
 * within a category, and it is deliberately the order toolkits shipped in.
 */
const PRO_TOOLS: ToolRegistration[] = [
  ...PRO_DEV_TOOLS,
  ...PRO_GRADNJA_TOOLS,
  ...PRO_INZENJERING_TOOLS,
  ...PRO_DIZAJN_TOOLS,
  ...PRO_FOTO_TOOLS,
  ...PRO_MUZIKA_TOOLS,
  ...PRO_PROSVETA_TOOLS,
  ...PRO_TEKST_TOOLS,
  ...PRO_TRENING_TOOLS,
  ...PRO_KUHINJA_TOOLS,
  ...PRO_PRAVO_TOOLS,
  ...PRO_RACUNOVODSTVO_TOOLS,
  ...PRO_BIZNIS_TOOLS,
  ...PRO_NEKRETNINE_TOOLS,
  ...PRO_TRANSPORT_TOOLS,
  ...PRO_AGRO_TOOLS,
  ...PRO_ZANAT_TOOLS,
  ...PRO_EVENT_TOOLS,
];

/**
 * UTIL slice c's card. ONE control, and the restraint is FIN's and DOC's
 * exactly: the drawer has no preferences to speak of — it stores nothing, reads
 * nothing and computes everything from what is typed into it — so the only
 * thing left for a settings card to decide is which rate „PDV" opens on.
 *
 * `choice` rather than FIN's `value`, and the difference is real: ISO-4217 is a
 * domain Nexus would have to invent a subset of, while the PDV rates are a
 * closed pair the law fixes. Enumerating a closed domain decides nothing on the
 * user's behalf.
 *
 * `device`, honestly: it changes no stored row, it is read by one field, and
 * forgetting it changes nothing that already exists — which is what earns this
 * card the „Vrati na podrazumevano" link every profile-stored card is denied.
 */
const TOOLS_SETTINGS: SettingsPanel = {
  titleKey: "settings.sectionTitle.tools",
  controls: [
    {
      kind: "choice",
      key: "default-vat-rate",
      labelKey: "settings.tools.defaultVatLabel",
      storage: "device",
      options: [
        { id: "20", labelKey: "tools.pdv.rateStandard" },
        { id: "10", labelKey: "tools.pdv.rateReduced" },
      ],
      keywords: ["alatke", "pdv", "porez", "stopa", "racun"],
    },
  ],
};

/**
 * FIT slice b's one card: „Ishrana danas" — the day's calories against the
 * calorie goal, or, with no goal set, the plain figure.
 *
 * **Deliberately NO `configFields`**, on „Fokus"'s reasoning rather than for
 * want of a field. Every knob the other cards carry narrows a LIST — a row cap
 * picks the front of a queue, a horizon narrows a window — and this card draws
 * no list at all: one figure, and one bar when there is a goal to draw it
 * against. There is nothing here to cap and nothing to narrow, and the
 * „Podesi…" affordance appears only where a choice exists.
 *
 * `sizes` stops at M, honestly: the card is a label, a figure and at most one
 * track under it, so a full-width version would be mostly empty space.
 */
const FITNESS_WIDGETS: WidgetContract[] = [
  {
    id: "danas",
    title: "dashboard.fitnessToday.title",
    sizes: ["S", "M"],
    deepLink: "fitness",
  },
  // FIT slice d's card: this week's sessions, and the routine that has gone
  // longest without being done (ADR-081 §9). NOT „the next scheduled routine" —
  // a routine is a shape and holds nothing about when (§6) — so the card reports
  // the FACT („poslednji put 24. jul") and lets the reader draw the conclusion.
  // Same `configFields`-free reasoning as the card above: there is no list here
  // to cap and no window to narrow.
  {
    id: "trening",
    title: "dashboard.fitnessTraining.title",
    sizes: ["S", "M"],
    deepLink: "fitness",
  },
];

/**
 * FIT slice b. FOUR controls, and the count is the point in the same way UTIL's
 * is: `fit_targets` holds four independently nullable goals (migration 058) and
 * collapsing them into presets („mršavljenje", „održavanje") would be inventing
 * a curated list exactly as FIN refused to for ISO-4217 — and, worse than there,
 * it would be the app deciding what somebody should eat.
 *
 * `value` rather than `choice` on all four for that reason and one more: the
 * domains are ranges, and enumerating a range means picking which of its members
 * are „sensible" on the user's behalf. Nexus does not have an opinion about
 * anybody's calorie goal; it holds the number they set.
 *
 * `profile`, unlike HABIT's and UTIL's cards — and that is why this one carries
 * NO „Vrati na podrazumevano". A goal is a fact of the profile, stored in
 * `fit_targets` and carried in every export; a reset here would be a WRITE about
 * somebody's own data rather than a forgetting on this machine. There is also no
 * default to go back to: absent is the shipped state, and clearing all four is
 * something the card already offers by emptying its fields.
 */
const FITNESS_SETTINGS: SettingsPanel = {
  titleKey: "settings.sectionTitle.fitness",
  controls: [
    {
      kind: "value",
      key: "kcal-goal",
      labelKey: "settings.fitness.kcalLabel",
      storage: "profile",
      keywords: ["ishrana", "kalorije", "cilj", "dnevni", "unos", "kcal"],
    },
    {
      kind: "value",
      key: "protein-goal",
      labelKey: "settings.fitness.proteinLabel",
      storage: "profile",
      keywords: ["ishrana", "proteini", "belancevine", "cilj", "grami"],
    },
    {
      kind: "value",
      key: "carbs-goal",
      labelKey: "settings.fitness.carbsLabel",
      storage: "profile",
      keywords: ["ishrana", "ugljeni", "hidrati", "uh", "cilj", "grami"],
    },
    {
      kind: "value",
      key: "fat-goal",
      labelKey: "settings.fitness.fatLabel",
      storage: "profile",
      keywords: ["ishrana", "masti", "cilj", "grami"],
    },
  ],
};

/**
 * The v0 module set (roadmap "v0 — Founder Build"), as ADR-008 manifests.
 *
 * Lives in `shared/` (moved from the renderer, ADR-058 §5) because BOTH
 * processes now resolve the same enabled set from it: the renderer for the
 * sidebar/routes/palette commands, main for the search-result module gate
 * (`searchGate.ts`) — two hand-copied manifest lists would be exactly the
 * drift `BUSINESS_DEFAULT_FLAGS`'s comment warns about. Imports nothing but
 * `@nexus/core`, so neither side links anything new.
 *
 * The manifests themselves:
 * identity plus the contract slots each module actually fills — `widgets` from
 * ADR-045 onward, the rest as each lands. Categories mirror the PRD 00 registry;
 * registration order follows the PRD numbering, and the sidebar groups them by
 * `MODULE_CATEGORIES` order with separators (DASH-008, decision #11).
 *
 * Only *built* modules are registered (founder decision 2026-07-12): an
 * unbuilt module must not appear anywhere — not in the sidebar, not in the
 * Settings module gallery — so nothing in the app leads to an empty page.
 * A module's manifest is added here in the same slice that ships its page.
 *
 * FIN is the live example of that rule being followed to the letter. Slice a
 * shipped the module's whole data layer (migration 051) and its archive travel
 * and deliberately did NOT register it, because a „Finansije“ row in the
 * sidebar would then have landed on `App.tsx`'s `ModulePage` placeholder. Slice
 * b builds the page, so slice b adds the manifest — which is also why the
 * asymmetry slice a documented is now gone: „Finansije“ was already visible in
 * Settings as a row of the export picker and the restore comparison table
 * (`ARCHIVE_MODULE_IDS`, the INTERCHANGE's vocabulary rather than this
 * registry's), and it is now visible everywhere else too, for the ordinary
 * reason that it exists.
 */
const V0_MODULES: ModuleManifest[] = [
  {
    id: "dashboard",
    prefix: "DASH",
    category: "Core experience",
    defaultEnabled: true,
    settings: DASHBOARD_SETTINGS,
  },
  {
    id: "tasks",
    prefix: "TASK",
    category: "Core experience",
    defaultEnabled: true,
    widgets: TASKS_WIDGETS,
    settings: TASKS_SETTINGS,
  },
  {
    id: "calendar",
    prefix: "CAL",
    category: "Core experience",
    defaultEnabled: true,
    widgets: CALENDAR_WIDGETS,
    settings: CALENDAR_SETTINGS,
  },
  // SET itself publishes no settings card: the page it renders IS the surface,
  // and a „Podešavanja" card inside Podešavanja would be a mirror facing a
  // mirror. The shell's cards are the ones it hand-composes.
  { id: "settings", prefix: "SET", category: "Core experience", defaultEnabled: true },
  {
    id: "notes",
    prefix: "NOTE",
    category: "Content & knowledge",
    defaultEnabled: true,
    widgets: NOTES_WIDGETS,
    settings: NOTES_SETTINGS,
  },
  // Private notes (ADR-057): OFF by default — first enabled from the Moduli
  // gallery, deliberately. It contributes NO widgets and NO searchIndexers:
  // while the section is locked nothing of it may render anywhere — no
  // dashboard card, no palette hit, no titles — and a contract slot filled
  // here would be exactly such a surface. `settings` IS filled, and is the one
  // exception the ADR already makes: `priv:status` answers FACTS and never
  // contents, so the lock preferences are configurable precisely when the
  // section is locked — which is when they matter most.
  {
    id: "priv",
    prefix: "PRIV",
    category: "Content & knowledge",
    defaultEnabled: false,
    settings: PRIV_SETTINGS,
  },
  // Datoteke (DOC). Filed beside Beleške and Privatno rather than under „Life
  // hubs": a file is content, and this module's whole subject is the content
  // the other modules already hold. ON by default, like every built module
  // except PRIV — there is nothing here to opt into, only somewhere to look.
  //
  // NO `searchIndexers`, and deliberately: an attachment's file name already
  // rides its owning row's indexed body (migrations 025/048), so an indexer
  // here would put every file into the palette a second time, under a second
  // entry, competing with the note that carries it. „Datoteke" is where you
  // BROWSE files; the palette is where you find the thing they belong to. Do
  // not add one.
  //
  // NO `widgets` in v1 either: „the N newest files" is a card that answers a
  // question nobody has — a file matters where it is attached, and the surfaces
  // that own them already say so.
  {
    id: "files",
    prefix: "DOC",
    category: "Content & knowledge",
    defaultEnabled: true,
    settings: FILES_SETTINGS,
  },
  {
    id: "study",
    prefix: "STUDY",
    category: "Life hubs",
    defaultEnabled: true,
    widgets: STUDY_WIDGETS,
    settings: STUDY_SETTINGS,
  },
  // Finansije (FIN slice b). ON by default, like every other built module and
  // unlike PRIV: PRIV is off because it is a sealed section with a credential
  // of its own, an opt-in by nature — nothing about a ledger asks to be opted
  // into, and a life-management app whose money module had to be switched on
  // first would be hiding one of the things it is for.
  //
  // Slice d fills the `widgets` slot the earlier comment deliberately left
  // empty, on exactly the terms it named: the surface exists now, so the
  // contract may. `searchIndexers` stays empty — an indexed payee is its own
  // decision, and a ledger is not something the palette should surface by
  // accident.
  {
    id: "finance",
    prefix: "FIN",
    category: "Life hubs",
    defaultEnabled: true,
    widgets: FINANCE_WIDGETS,
    settings: FINANCE_SETTINGS,
  },
  // Navike (HABIT slice b, migration 055). „Life hubs" beside Učenje and
  // Finansije: those three are areas of a life rather than tools for handling
  // content, and a habit tracker is the plainest example of the category.
  // ON by default, like every built module except PRIV — nothing about keeping
  // habits asks to be opted into, and the module writes nothing until the user
  // creates one.
  //
  // ONE contract slot stays empty, and not merely „not yet": there are NO
  // `searchIndexers`. A habit is a name and a schedule; there is no body to
  // match and nothing a query would find that the sidebar does not already
  // show. Indexing „Voda" would put a row in the palette that answers a
  // question nobody asked it.
  //
  // The other two arrived in slice c, each once it had something true to say: a
  // „Navike danas" card is worth drawing only because it is tickable, and a
  // settings card is worth offering only because `reminder_time` finally does
  // something (migration 056).
  {
    id: "habits",
    prefix: "HABIT",
    category: "Life hubs",
    defaultEnabled: true,
    widgets: HABITS_WIDGETS,
    settings: HABITS_SETTINGS,
  },
  // Ishrana (FIT slice b, migration 058). „Life hubs" beside Učenje, Finansije
  // and Navike, and the category is the honest one: what somebody eats is an
  // AREA of their life, in the plainest sense the group has — not a tool you
  // use on one („Profesionalno i alati", where Fokus sits) and not content to
  // handle („Sadržaj i znanje").
  //
  // ON by default, like every built module except PRIV: the module writes
  // nothing at all until the user logs a first meal, and a life-management app
  // whose food diary had to be switched on first would be hiding one of the
  // things it is for.
  //
  // ONE contract slot stays empty, and not merely „not yet": there are NO
  // `searchIndexers`. The catalogue is app-shipped data rather than the user's
  // (see migration 058), so indexing it would put four hundred rows nobody
  // wrote into the palette; and a user's own „mamin ajvar" is a name and seven
  // numbers, with no body to match and nothing a query would find that the page
  // does not already show.
  {
    id: "fitness",
    prefix: "FIT",
    category: "Life hubs",
    defaultEnabled: true,
    widgets: FITNESS_WIDGETS,
    settings: FITNESS_SETTINGS,
  },
  // Fokus (UTIL slice b, ADR-077). The first module in „Profesionalno i alati",
  // and the category is the honest one: this is a TOOL rather than an area of a
  // life. „Životni centri" holds Učenje, Finansije and Navike — three subjects
  // somebody has — while a Pomodoro timer is a thing you use on whichever of
  // them you happen to be at.
  //
  // (The brief for this slice named the category „Utility & tools". That string
  // is not in `MODULE_CATEGORIES`, whose five values mirror the PRD 00 registry;
  // the value that means it is „Professional & utilities", already labelled
  // „Profesionalno i alati" in Serbian. Registered there rather than widening a
  // canonical list to add a synonym.)
  //
  // ON by default, like every built module except PRIV: nothing about a timer
  // asks to be opted into, and the module writes nothing until a phase is
  // started.
  //
  // `searchIndexers` stays empty, and not merely „not yet": a phase is a span of
  // time with at most a borrowed label, and the thing worth finding — the task or
  // the subject it was attached to — is already indexed by the module that owns
  // it. Indexing „Pisanje izveštaja" here would put a second, weaker row in the
  // palette competing with the task itself.
  {
    id: "focus",
    prefix: "UTIL",
    category: "Professional & utilities",
    defaultEnabled: true,
    widgets: FOCUS_WIDGETS,
    settings: FOCUS_SETTINGS,
  },
  // Alatke (UTIL slice c) — the tool drawer, and the utilities HOST the
  // `ToolRegistration` contract was reserved for („resolved when the UTIL tool
  // host lands"). Second module in „Profesionalno i alati", beside „Fokus".
  //
  // **It SHARES the UTIL prefix with „Fokus", on purpose.** A prefix is
  // traceability to a PRD entry, and PRD 29 („Utility Belt") is one entry that
  // two app modules implement: a timer and a drawer are separate things to
  // reach for and separate things to switch off, so they are separate sidebar
  // entries with separate toggles. `ModuleRegistry` no longer forbids this —
  // its `byPrefix` map was write-only, guaranteeing nothing but itself — and
  // the invariant it did earn (a copy-pasted manifest whose prefix nobody
  // changed) now lives in `modules.test.ts` as an explicit prefix→ids map,
  // where THIS sharing is stated on purpose and any other duplicate still
  // fails.
  //
  // ON by default, like every built module except PRIV: a converter writes
  // nothing anywhere — the drawer has no storage at all beyond one device
  // preference — so there is nothing to opt into.
  //
  // TWO contract slots stay empty, and neither merely „not yet". No `widgets`:
  // a dashboard card draws a FACT about the profile, and this module holds no
  // facts — a card showing an empty converter would be a form on a surface
  // meant for answers. No `searchIndexers`: there is nothing here a query could
  // find, because the module stores nothing a user wrote.
  {
    id: "tools",
    prefix: "UTIL",
    category: "Professional & utilities",
    defaultEnabled: true,
    settings: TOOLS_SETTINGS,
    tools: TOOLS_TOOLS,
  },
  // Tabla (CANV slice a, migration 059) — the infinite canvas. Third module in
  // „Profesionalno i alati", beside „Fokus" and „Alatke", and the category is
  // the honest one on their exact terms: „Životni centri" holds subjects
  // somebody HAS, while a whiteboard is a TOOL you use on whichever of them you
  // are at. It gets its own prefix rather than joining UTIL, because CANV is its
  // own PRD entry — the sharing UTIL does is one PRD section implemented twice,
  // not a bin for anything tool-shaped.
  //
  // ON by default, like every built module except PRIV.
  //
  // THREE contract slots stay empty, and none of them merely „not yet". No
  // `widgets`: a dashboard card draws a FACT about the profile, and „you have 4
  // boards" is a count nobody acts on — a thumbnail would be the honest card,
  // and rendering one means rasterising a scene on the home screen. No
  // `searchIndexers`: what a board holds is shapes and hand-placed text at
  // arbitrary positions, so a hit would have to say „somewhere on this board",
  // which is a result a user cannot use — and a search INSIDE a board is the
  // surface that question actually belongs on. No `settings`: the module has
  // nothing to prefer yet, and a card with one checkbox for the sake of having a
  // card is exactly the padding SET-006 warns about.
  //
  // No `imex` either, and that is not a gap: the module DOES ride in every
  // archive (`canvas-board`, interchange `1.36.0`), but no module in this file
  // fills that slot — the interchange is assembled in `@nexus/core` from
  // `ProfileData`, not from manifests, so a declaration here would be the only
  // one of its kind and would guarantee nothing.
  {
    id: "canvas",
    prefix: "CANV",
    category: "Professional & utilities",
    defaultEnabled: true,
  },
  // „Stručne alatke" (UTIL slice d) — the professional drawer itself, host to
  // every toolkit as its pack ships rather than a drawer of its own kind. Its
  // contents are `PRO_TOOLS`, which is one array per subject concatenated: the
  // forty-eight a programmer asks (what these bits are as an fp8, what this
  // halfword decodes to on RV64, what this JWT actually says) and, from now on,
  // one array per profession beside them. The drawer is the professional one
  // full stop, not „the developer one" — whatever a geodeta's or a lekar's pack
  // adds next lands in this same module and needs nothing from it.
  //
  // FOURTH module in „Profesionalno i alati", and it takes its OWN prefix,
  // `PRO` (PRD 30, „Profession Toolkits"), rather than joining „Fokus" and
  // „Alatke" under `UTIL`. The sharing argument on „Alatke"'s comment — one PRD
  // section implemented twice — does not apply here: PRD 30 is its own entry,
  // not a second reading of PRD 29, so this module gets its own prefix rather
  // than borrowing one. `modules.test.ts`'s explicit prefix→ids map still
  // states the `UTIL` sharing that DOES remain (`focus`, `tools`) on purpose,
  // so any other duplicate — this one included, had it kept `UTIL` — still
  // fails.
  //
  // OFF by default, and the only built module besides PRIV that is — but the
  // reason is stronger now than „a non-programmer should not see a RISC-V
  // assembler". The drawer holds NOTHING until a pack is switched on, because
  // every tool inside it declares one; a profile that answered no questions on
  // the way in would open an empty page. The opening questionnaire is what
  // turns the module on, together with whichever packs it grants — the module
  // and its first contents arrive in the same write.
  //
  // FOUR contract slots stay empty, and none of them merely „not yet". No
  // `settings`: the drawer stores nothing and computes everything from what is
  // typed into it, so there is no preference to keep — „Alatke" has one only
  // because a VAT rate is a fact about the country you are in. Nor is the pack
  // picker itself hiding in this slot: a pack decides what the drawer CONTAINS
  // rather than how it behaves, so it belongs beside the tools it grants, not
  // among behavioural preferences. No `widgets`: a dashboard card draws a FACT
  // about the profile and this module holds none. No `searchIndexers`: there
  // is nothing here a query could find, because nothing a user writes is kept.
  // No `imex`: nothing to export.
  {
    id: "pro",
    prefix: "PRO",
    category: "Professional & utilities",
    defaultEnabled: false,
    tools: PRO_TOOLS,
  },
];

/**
 * The two modules nothing may switch off: the home surface and the settings
 * page itself — someone has to render the toggles (SET-007).
 *
 * Lives here, beside the manifests, because THREE surfaces read it now: the
 * Settings module gallery (which draws these as „Uvek uključeno“ chips), ADR-065's
 * „Oblasti“ onboarding screen (which draws the same chips), and that screen's
 * completion write (which must never store a `feature_flags` row for one). A
 * second hand-copied set is exactly the drift the module comment above warns
 * about.
 */
export const LOCKED_MODULE_IDS: ReadonlySet<string> = new Set(["dashboard", "settings"]);

/** Builds the app's registry — each process constructs its own (not a singleton) per ADR-008. */
export function createModuleRegistry(): ModuleRegistry {
  const registry = new ModuleRegistry();
  for (const manifest of V0_MODULES) {
    registry.register(manifest);
  }
  return registry;
}

/**
 * The modules a fresh BUSINESS profile turns OFF (ADR-058, founder-approved).
 * STUDY, and nothing else: a business profile is where exam planning is noise.
 */
export const BUSINESS_DISABLED_MODULE_IDS: ReadonlySet<string> = new Set(["study"]);

/**
 * The `feature_flags` rows a fresh business profile is seeded with — one per
 * unlocked module, `defaultEnabled` unless the set above says otherwise.
 *
 * **Derived rather than listed, and that is a repair.** This was a hand-written
 * list of five modules in `main/index.ts` whose comment claimed the preset was
 * „a stored fact of the profile rather than an accident of this build's
 * manifests" — while FIN, PRIV and DOC, every one of which shipped after it was
 * written, were never added to it and so fell through to exactly that accident.
 * A list every future module must remember to edit is a list that will be wrong
 * again; a derivation can only be wrong once.
 *
 * The stored-fact property survives, because this runs ONCE, at creation, and
 * the rows are written then: a later build that changes a `defaultEnabled` does
 * not reach back into a profile that already exists.
 *
 * Locked modules are skipped — they cannot be switched off anywhere, so a row
 * for one would be a fact nobody can act on. A PERSONAL profile still gets no
 * rows at all, since the defaults already say what it needs.
 */
export function businessProfileFlags(
  registry: ModuleRegistry,
): { moduleId: string; enabled: boolean }[] {
  return registry
    .all()
    .filter((manifest) => !LOCKED_MODULE_IDS.has(manifest.id))
    .map((manifest) => ({
      moduleId: manifest.id,
      enabled: !BUSINESS_DISABLED_MODULE_IDS.has(manifest.id) && manifest.defaultEnabled,
    }));
}

import {
  ModuleRegistry,
  type ModuleManifest,
  type SettingsPanel,
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

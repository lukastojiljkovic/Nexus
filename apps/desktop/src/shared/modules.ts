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
 * FIN is the live example, and its ABSENCE from this list is deliberate. Slice
 * a shipped the module's whole data layer (migration 051) and its archive
 * travel, but no page — so registering it here would put „Finansije“ in the
 * sidebar, in the Moduli gallery and on ADR-065's „Oblasti“ onboarding screen,
 * and clicking it would land on `App.tsx`'s `ModulePage` placeholder, which is
 * exactly the empty page the rule above forbids. No shell guard was added
 * either: the shell is not wrong here, the registration would be. Its manifest
 * lands in the same slice as its page.
 *
 * Note the deliberate asymmetry this creates, so nobody "fixes" it: „Finansije“
 * IS visible in Settings, as a row of the export picker and the restore
 * comparison table. That vocabulary is the INTERCHANGE's (`ARCHIVE_MODULE_IDS`,
 * `strings.settings.restore.modules`), not this registry's, and a backup that
 * silently omitted rows it actually carries would be the far worse lie.
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
  {
    id: "study",
    prefix: "STUDY",
    category: "Life hubs",
    defaultEnabled: true,
    widgets: STUDY_WIDGETS,
    settings: STUDY_SETTINGS,
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

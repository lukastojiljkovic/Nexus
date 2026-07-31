import { foldSearchText, type ModuleRegistry } from "@nexus/core";
import { strings } from "./strings.js";

/**
 * SET-014: the settings page's own filter index. A hand-composed page of
 * section cards has no store to query, so what is searchable is declared here
 * once — one entry per control the user could plausibly be looking for, each
 * naming the section it lives in.
 *
 * Matching is Serbian-folding-aware on BOTH sides (`foldSearchText`, the very
 * helper the search palette and the FTS index share), so "noc" finds "Noć" and
 * "dogadjaj" finds "Događaji" without either side storing a folded copy.
 *
 * Unlike `matchCommands`, which keeps a command only when every term is a
 * PREFIX of one of its words, an entry here matches on plain substring. The
 * corpus is a dozen fixed labels rather than a ranked result list, so there is
 * nothing for strictness to buy: a user who types "kod" is unambiguously after
 * "Pristupni kod", and a single "c" narrowing to the themes is a feature of a
 * filter, not a mis-hit.
 */

/** The section cards, in the order the page renders them — `strings.settings.sectionTitle`'s own key set. */
export type SettingsSectionId = keyof typeof strings.settings.sectionTitle;

export interface SettingsSearchEntry {
  /** Stable id; the page looks a rendered label up by it to decide on the hit highlight. */
  readonly id: string;
  readonly section: SettingsSectionId;
  /** The control's own label, in real Serbian orthography — the same text the page renders. */
  readonly label: string;
  /**
   * Extra words this control answers to. Spelled already folded (plain ASCII),
   * the way `searchCommands.ts` spells its keywords: the label carries the
   * orthography, these carry the synonyms. Kept modest and honest — a keyword
   * is here because someone would really type it.
   */
  readonly keywords: readonly string[];
}

const s = strings.settings;

/**
 * Every searchable control on the page, in render order. Entries whose label
 * is a heading, field label or caption the page actually draws get the hit
 * highlight; the rest (an export button, the notification presets) still steer
 * which section stays visible, which is the part a filter is for.
 */
const ENTRIES: readonly SettingsSearchEntry[] = [
  {
    id: "profile-name",
    section: "profile",
    label: s.profile.nameLabel,
    keywords: ["profil", "naziv", "preimenuj"],
  },
  // SET-001: „slika“ and „profil“ sit in the label already, so the keywords
  // carry what someone would type instead — the thing itself („avatar“), and
  // the two actions.
  {
    id: "profile-picture",
    section: "profile",
    label: s.profile.pictureLabel,
    keywords: ["avatar", "fotografija", "nalog", "izaberi", "ukloni"],
  },
  // SET-003 (ADR-058): the „Profili“ card. „profil“ sits in the section title
  // already; the keywords carry the business half's own words, „biznis“
  // included — the word someone types even though the app never prints it.
  {
    id: "profiles-business",
    section: "profiles",
    label: strings.profiles.createBusiness,
    keywords: ["profil", "poslovni", "biznis", "posao"],
  },
  {
    id: "security-passcode",
    section: "security",
    label: s.security.changeTitle,
    keywords: ["lozinka", "sifra", "pin"],
  },
  {
    id: "security-recovery",
    section: "security",
    label: s.security.recoveryTitle,
    keywords: ["oporavak", "kljuc", "rezervni"],
  },
  {
    id: "security-auto-lock",
    section: "security",
    label: s.security.autoLockTitle,
    keywords: ["zakljucavanje", "neaktivnost", "privatnost"],
  },
  {
    id: "appearance-theme",
    section: "appearance",
    // The three option labels are keywords in their own right: "Noć" is what a
    // user looking for the dark theme actually types.
    label: s.appearance.themeLabel,
    keywords: [s.appearance.system, strings.app.themeDan, strings.app.themeNoc, "tamno", "svetlo"],
  },
  {
    id: "appearance-accent",
    section: "appearance",
    label: s.appearance.accentLabel,
    keywords: ["boja", "paleta"],
  },
  {
    id: "appearance-week-start",
    section: "appearance",
    label: s.appearance.weekStartLabel,
    keywords: [
      s.appearance.weekStartOptions.monday,
      s.appearance.weekStartOptions.sunday,
      "kalendar",
      "sedmica",
    ],
  },
  // CAL §5's two preferences. They live in the „Izgled“ card beside the week
  // start, so they are filed under that section — but the words somebody types
  // hunting for them are the calendar's, which is what the keywords carry.
  {
    id: "calendar-event-duration",
    section: "appearance",
    label: s.appearance.eventDurationLabel,
    keywords: ["kalendar", "dogadjaj", "trajanje", "duzina", "sat", "minuta", "kraj"],
  },
  {
    id: "calendar-clock",
    section: "appearance",
    // The two option labels answer for themselves: somebody looking for this
    // types „12“ or „24“ long before they type „prikaz vremena“.
    label: s.appearance.clockLabel,
    keywords: [
      s.appearance.clockOptions["24h"],
      s.appearance.clockOptions["12h"],
      "kalendar",
      "vreme",
      "sat",
      "casovni",
      "am",
      "pm",
    ],
  },
  // ADR-049: the one TASK device preference. „blokirani“ and „danas“ already
  // sit in the label, so the keywords carry what someone would type instead —
  // the concept („zavisnost“) and the two answers.
  {
    id: "tasks-blocked-today",
    section: "tasks",
    label: s.tasks.blockedInTodayLabel,
    keywords: [
      s.tasks.blockedInTodayOptions.sakrij,
      s.tasks.blockedInTodayOptions.prikazi,
      "zadaci",
      "zavisnost",
      "pregled",
    ],
  },
  {
    id: "note-width",
    section: "notes",
    label: s.notes.widthLabel,
    keywords: ["beleske", "editor", "sirina", "mera", "uska", "normalna", "siroka", "kolona"],
  },
  {
    id: "note-markdown-shortcuts",
    section: "notes",
    label: s.notes.markdownLabel,
    keywords: ["beleske", "markdown", "precice", "formatiranje", "naslov", "lista", "slash"],
  },
  // PRIV v1 (ADR-057): the „Privatne beleške" card's three surfaces. The card
  // renders only while the module is enabled, so a hit can steer to a section
  // that is not on the page — the same honest gap a disabled module's own
  // gallery row already has.
  {
    id: "priv-auto-lock",
    section: "priv",
    label: s.priv.autoLockLabel,
    keywords: ["privatno", "privatne", "beleske", "zakljucavanje", "neaktivnost", "minuti"],
  },
  {
    id: "priv-lock-minimize",
    section: "priv",
    label: s.priv.lockOnMinimizeLabel,
    keywords: ["privatno", "privatne", "beleske", "minimizovanje", "prozor", "zakljucaj"],
  },
  {
    id: "priv-kit-status",
    section: "priv",
    label: s.priv.caption,
    keywords: ["privatno", "privatne", "beleske", "oporavak", "kod", "sifrovanje", "tajno"],
  },
  // One entry per remappable action (ADR-040) — a user hunting for "novi
  // unos" or "zakljucaj" should land on the exact row that rebinds it — plus
  // one for the reference dialog itself.
  ...(
    [
      ["palette", ["paleta", "pretraga", "ctrl", "k"]],
      ["quickCreate", ["novi", "unos", "kreiranje", "ctrl", "n"]],
      ["globalCapture", ["globalna", "brzi", "unos", "zadatak", "pozadina", "sistem", "hotkey"]],
      ["lock", ["zakljucaj", "zakljucavanje", "ctrl", "l"]],
      ["privLock", ["privatno", "privatne", "beleske", "zakljucaj", "panika", "ctrl", "shift", "l"]],
      ["settings", ["podesavanja", "ctrl"]],
      ["shortcutsHelp", ["pomoc", "referenca", "f1"]],
    ] as const
  ).map(([actionId, keywords]) => ({
    id: shortcutEntryId(actionId),
    section: "shortcuts" as const,
    label: strings.shortcuts.actions[actionId],
    keywords: ["precice", "tastatura", ...keywords],
  })),
  {
    id: "shortcuts-reference",
    section: "shortcuts",
    label: strings.shortcuts.showAll,
    keywords: ["precice", "tastatura", "spisak", "pomoc"],
  },
  // SET-006 (ADR-041): the background picker steers the section; the dim
  // label is a drawn control label, so it also earns the highlight.
  {
    id: "dashboard-background",
    section: "dashboard",
    label: strings.settings.dashboard.pick,
    keywords: ["pozadina", "slika", "kontrolna", "tabla", "izgled"],
  },
  {
    id: "dashboard-dim",
    section: "dashboard",
    label: strings.settings.dashboard.dimLabel,
    keywords: ["zatamnjenje", "pozadina", "kontrolna", "tabla"],
  },
  // STUDY-007: three controls, three entries — each is a drawn control label, so
  // each earns the hit highlight as well as steering the section.
  {
    id: "study-retention",
    section: "study",
    label: s.study.retentionLabel,
    keywords: ["ucenje", "kartice", "fsrs", "zapamcenost", "retencija", "raspored", "interval"],
  },
  {
    id: "study-new-per-day",
    section: "study",
    label: s.study.newPerDayLabel,
    keywords: ["ucenje", "kartice", "nove", "dnevno", "limit", "ogranicenje"],
  },
  {
    id: "study-review-cap",
    section: "study",
    label: s.study.reviewCapLabel,
    keywords: ["ucenje", "ponavljanje", "dnevno", "limit", "ogranicenje", "kapa"],
  },
  // CAL-010 (ADR-054): the semester's fixed dates — one entry for the card's
  // one control group; the label is drawn, so it earns the hit highlight.
  {
    id: "calendar-semester-dates",
    section: "calendar",
    label: s.calendar.datesLabel,
    keywords: ["semestar", "kalendar", "datumi", "pocetak", "kraj", "pregled"],
  },
  {
    id: "notifications-presets",
    section: "notifications",
    label: s.sectionTitle.notifications,
    keywords: ["podsetnik", "tiho", "izvori", "odlaganje"],
  },
  {
    id: "backup-export",
    section: "backup",
    label: s.backup.exportButton,
    // „moduli“ answers for the „Šta se izvozi“ picker (IMEX-003), which lives
    // inside this block rather than as an entry of its own: it is one choice
    // about the export above it, not a fifth thing the card can do.
    keywords: ["izvoz", "arhiva", "kopija", "moduli"],
  },
  {
    // SET-011 (ADR-056). „automatska“ and „rezervna“ sit in the label already;
    // the keywords carry the English word half the world types for this exact
    // thing, plus the schedule the block is about.
    id: "backup-auto",
    section: "backup",
    label: s.autoBackup.title,
    keywords: ["automatski", "backup", "rezervna", "raspored", "dnevno", "nedeljno", "fascikla"],
  },
  // The "Rezervna kopija" card holds five blocks — export, calendar, restore,
  // archive import, Anki import, markdown import — so each gets its own entry
  // inside that one section rather than a section of its own: they are one
  // subject, and splitting the card would hide the contrast the archive flows
  // are meant to be read against. „uvoz“ is shared by the three import entries,
  // which are then told apart by the words that name what each one reads; the
  // restore entry answers to the words that describe what IT does.
  {
    // „kalendar“ and „ics“ are the words someone actually types looking for
    // this; „izvoz“ is deliberately NOT repeated from `backup-export`, which
    // owns it — an entry that answers every query answers none of them.
    id: "backup-calendar",
    section: "backup",
    label: s.calendarExport.title,
    keywords: ["kalendar", "ics", "icalendar", "dogadjaji", "google"],
  },
  {
    id: "backup-restore",
    section: "backup",
    label: s.restore.title,
    keywords: ["vracanje", "vrati", "zameni", "arhiva"],
  },
  {
    id: "backup-import",
    section: "backup",
    label: s.import.title,
    keywords: ["uvoz", "uvezi", "spajanje", "dodaj", "arhiva"],
  },
  {
    // ADR-052. The words are the SOURCE's, not the flow's — somebody looking for
    // this types „anki“ or „apkg“, never „uvoz iz arhive“ — so „arhiva“ is
    // deliberately absent, exactly as it is from the markdown entry below.
    id: "backup-apkg",
    section: "backup",
    label: s.apkgImport.title,
    keywords: ["anki", "apkg", "kartice", "spil", "flashcards", "uvoz"],
  },
  {
    // ADR-062. The words are the FORMAT's and the tool's — somebody looking for
    // this types „csv“, „excel“ or „tabela“ — so „arhiva“ is deliberately
    // absent, exactly as it is from its neighbours.
    id: "backup-csv",
    section: "backup",
    label: s.csvImport.title,
    keywords: ["csv", "tabela", "excel", "zadaci", "kolone", "todoist", "uvoz"],
  },
  {
    // IMEX-005. The words are the TOOL's, not the flow's — somebody looking for
    // this types „chatgpt“ or „ai“, never „uvoz iz arhive“ — so „arhiva“ is
    // deliberately absent, exactly as it is from the two entries around it.
    id: "backup-llm",
    section: "backup",
    label: s.llmImport.title,
    keywords: ["ai", "chatgpt", "claude", "gemini", "asistent", "vestacka", "uputstvo", "uvoz"],
  },
  {
    // The words someone looking for THIS types are the format's, not the
    // flow's: „arhiva“ belongs to the two entries above, which is why it is
    // deliberately absent here.
    id: "backup-markdown",
    section: "backup",
    label: s.markdownImport.title,
    keywords: ["markdown", "md", "beleske", "fajlovi", "obsidian", "uvoz"],
  },
  {
    // SET-010: five sentences, one entry. There is nothing to operate in that
    // card, so it has nothing to highlight and only ever steers visibility —
    // and the words are the ones a worried user types, not the card's own.
    id: "privacy-practices",
    section: "privacy",
    label: s.sectionTitle.privacy,
    keywords: [
      "privatnost",
      "podaci",
      "sifrovanje",
      "telemetrija",
      "analitika",
      "mreza",
      "internet",
      "offline",
      "lokalno",
      "brisanje",
    ],
  },
  {
    // The panel is one read-only block of facts, so it is one entry: splitting
    // it per row would highlight "Verzija" for a user who typed "chromium".
    id: "about-facts",
    section: "about",
    label: s.sectionTitle.about,
    keywords: [
      s.about.version,
      s.about.electron,
      s.about.chromium,
      s.about.node,
      s.about.dataLocation,
      "fascikla",
      "putanja",
    ],
  },
];

/** Entry id for a module row in the Moduli gallery — the page uses the same id to highlight the row's name. */
export function moduleEntryId(moduleId: string): string {
  return `module-${moduleId}`;
}

/** Entry id for a remappable shortcut row (ADR-040) — `ShortcutsSection` highlights its label by the same id. */
export function shortcutEntryId(actionId: string): string {
  return `shortcut-${actionId}`;
}

/**
 * The full index: the fixed entries above plus one per registered module, so
 * "beleske" or "ucenje" lands on the gallery row that switches that module off
 * rather than only on the section card. A module's one-line description doubles
 * as its keywords — copy that already exists and already says what it is for.
 */
export function buildSettingsSearchEntries(registry: ModuleRegistry): SettingsSearchEntry[] {
  const modules: SettingsSearchEntry[] = [...registry.byCategory()].flatMap(([, members]) =>
    members.map((manifest) => ({
      id: moduleEntryId(manifest.id),
      section: "modules" as const,
      label: strings.modules[manifest.id] ?? manifest.id,
      keywords: [s.moduleDescriptions[manifest.id] ?? ""],
    })),
  );
  return [...ENTRIES, ...modules];
}

/** Splits a raw query into folded, non-empty terms. An all-whitespace query yields none, which every entry then matches. */
export function foldSettingsQuery(query: string): string[] {
  return foldSearchText(query)
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

function matchesEntry(entry: SettingsSearchEntry, terms: readonly string[]): boolean {
  const haystack = foldSearchText(`${entry.label} ${entry.keywords.join(" ")}`);
  return terms.every((term) => haystack.includes(term));
}

export interface SettingsSearchResult {
  /** Sections to render; every section when nothing is typed. */
  readonly sections: ReadonlySet<SettingsSectionId>;
  /** Ids of the entries that matched — empty while nothing is typed, so no label is ever highlighted at rest. */
  readonly hits: ReadonlySet<string>;
}

/**
 * Which sections survive the query and which entries earned a highlight. A
 * section survives when its own title matches or any of its entries does —
 * a user typing "sigurnost" wants the whole card, not an empty one.
 */
export function matchSettings(
  entries: readonly SettingsSearchEntry[],
  terms: readonly string[],
): SettingsSearchResult {
  const sectionIds = Object.keys(s.sectionTitle).filter(isSettingsSectionId);
  if (terms.length === 0) {
    return { sections: new Set(sectionIds), hits: new Set() };
  }

  const hits = new Set(entries.filter((entry) => matchesEntry(entry, terms)).map((entry) => entry.id));
  const sections = new Set(
    sectionIds.filter((sectionId) => {
      const title = foldSearchText(s.sectionTitle[sectionId]);
      if (terms.every((term) => title.includes(term))) return true;
      return entries.some((entry) => entry.section === sectionId && hits.has(entry.id));
    }),
  );
  return { sections, hits };
}

/** Narrowing helper over `Object.keys`, which types its result as plain `string[]`. */
function isSettingsSectionId(value: string): value is SettingsSectionId {
  return Object.prototype.hasOwnProperty.call(s.sectionTitle, value);
}

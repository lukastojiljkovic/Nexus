import { foldSearchText, type ModuleRegistry } from "@nexus/core";

import { lookupString } from "./dashboardLayout.js";
import { moduleSettingsDeclarations, settingsEntryId } from "./moduleSettings.js";
import { strings } from "./strings.js";

/**
 * SET-014: the settings page's own filter index. A hand-composed page of
 * section cards has no store to query, so what is searchable is declared here
 * once — one entry per control the user could plausibly be looking for, each
 * naming the section it lives in.
 *
 * "Hand-composed" now means the SHELL's cards only. Every card a module owns is
 * declared in its manifest (`SettingsPanel`, `shared/modules.ts`) and its
 * entries are DERIVED from that declaration below, so the page and the index
 * read one source instead of two lists somebody has to keep in step.
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

/** The SHELL's own cards — `strings.settings.sectionTitle`'s key set, and the only section ids written by hand. */
export type ShellSettingsSectionId = keyof typeof strings.settings.sectionTitle;

/**
 * A card on the page: one of the shell's ids above, or a MODULE's registry id
 * for the card that module publishes. Open by construction, because the set of
 * modules is: a section is only a real one if the index says so, which
 * `buildSettingsIndex` is what pins.
 */
export type SettingsSectionId = string;

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

/** A shell entry, whose section is checked against the hand-written card list — the module-derived ones cannot be. */
interface ShellSettingsSearchEntry extends SettingsSearchEntry {
  readonly section: ShellSettingsSectionId;
}

const s = strings.settings;

/**
 * SET-014 hit styling: a matched control label goes gold + semibold, exactly
 * like every other active state in the app. Never a background wash or a glow.
 *
 * It lives beside the index rather than in the page because every module panel
 * needs it too, and a panel may not import the page that renders it.
 */
export function labelClass(base: string, hit: boolean): string {
  return hit ? `${base} set__hit` : base;
}

/**
 * SET-014 section visibility: a filtered-out card hides with CSS instead of
 * unmounting, so in-progress state — a restore preview holding its archive
 * open, a half-typed passcode, unsaved quiet-hours edits — survives a
 * keystroke in the filter box.
 */
export function sectionClass(visible: boolean): string {
  return visible ? "set__section" : "set__section set__section--hidden";
}

/**
 * Every searchable control on the SHELL's cards, in render order. Entries whose
 * label is a heading, field label or caption the page actually draws get the
 * hit highlight; the rest (an export button, the notification presets) still
 * steer which section stays visible, which is the part a filter is for.
 *
 * A module's controls are deliberately absent: they arrive from the registry
 * (`moduleSettingsEntries`), which is what stops this list and the page from
 * drifting apart the way two hand-written lists do.
 */
const ENTRIES: readonly ShellSettingsSearchEntry[] = [
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
  // They stay hand-written here for the same reason they stay in that card:
  // they are drawn by the shell, and CAL's own declaration covers the card CAL
  // actually owns (see `shared/modules.ts`).
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
  {
    // ADR-065 §5: the row that reopens the questionnaire. Filed under „Moduli“
    // because that is the card it sits in and the screen it mostly decides; the
    // keywords carry the words somebody hunting for it would actually type.
    id: "modules-onboarding",
    section: "modules",
    label: s.onboardingRerunTitle,
    keywords: ["upitnik", "onboarding", "podesavanje", "ponovo", "pocetak", "moduli", "oblasti"],
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
  // The "Rezervna kopija" card's blocks — export, calendar export, restore,
  // archive import, calendar import, Anki import, AI import, markdown import —
  // each get their own entry inside that one section rather than a section of
  // their own: they are one subject, and splitting the card would hide the
  // contrast the archive flows are meant to be read against. „uvoz“ is shared
  // by the import entries, which are then told apart by the words that name
  // what each one reads; the restore entry answers to the words that describe
  // what IT does.
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
    // ADR-061. The words are the SOURCE's, exactly as the Anki entry's are:
    // somebody looking for this types „ics“ or „google“, never „uvoz iz
    // arhive“. „ics“ and „kalendar“ ARE shared with `backup-calendar` above on
    // purpose — a user typing either is as likely to want the import as the
    // export, and both blocks answering is the honest result.
    id: "backup-ics",
    section: "backup",
    label: s.icsImport.title,
    keywords: ["ics", "icalendar", "kalendar", "google", "outlook", "dogadjaji", "uvoz"],
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
    // FIN slice e. The words are the DOCUMENT's and the bank's — somebody
    // looking for this types „izvod“, „banka“ or „transakcije“, never „tabela“ —
    // which is exactly what keeps it apart from the task CSV entry above, whose
    // words nobody would use for their money.
    id: "backup-fin-csv",
    section: "backup",
    label: s.finCsvImport.title,
    keywords: ["izvod", "banka", "bankovni", "racun", "transakcije", "promet", "finansije", "uvoz"],
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
    // SRCH-009: the one operable control on the privacy card, so — unlike the
    // five sentences above it — this entry does get a highlight. Its own entry
    // rather than more keywords on `privacy-practices`, because somebody
    // hunting for it is after a BUTTON, not a paragraph. A hand-composed SHELL
    // entry on purpose: search is not a module, so nothing about it may come
    // through the per-module settings contract.
    id: "privacy-search-history",
    section: "privacy",
    label: s.privacy.searchHistory.clear,
    keywords: ["pretraga", "istorija", "upiti", "obrisi", "zaboravi", "privatnost"],
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
 * One entry per control a module DECLARES (`SettingsPanel`), filed under that
 * module's own card. The label is the declared strings key resolved, and a
 * closed choice contributes its option labels as keywords — which is how „Uska“
 * or „Sakrij“ keep finding their control without anyone writing them twice.
 *
 * Flags are deliberately not consulted: a switched-off module's controls stay
 * indexed, so a hit can steer to a card that is not on the page — the same
 * honest gap a disabled module's own gallery row already has.
 */
function moduleSettingsEntries(registry: ModuleRegistry): SettingsSearchEntry[] {
  return moduleSettingsDeclarations(registry).flatMap(({ moduleId, panel }) =>
    panel.controls.map((control) => ({
      id: settingsEntryId(moduleId, control.key),
      section: moduleId,
      label: lookupString(strings, control.labelKey) ?? control.labelKey,
      keywords: [
        ...(control.keywords ?? []),
        ...(control.kind === "choice"
          ? control.options.map((option) => lookupString(strings, option.labelKey) ?? option.id)
          : []),
      ],
    })),
  );
}

/**
 * One entry per registered module, so "beleske" or "ucenje" lands on the
 * gallery row that switches that module off rather than only on the section
 * card. A module's one-line description doubles as its keywords — copy that
 * already exists and already says what it is for.
 */
function moduleGalleryEntries(registry: ModuleRegistry): SettingsSearchEntry[] {
  return [...registry.byCategory()].flatMap(([, members]) =>
    members.map((manifest) => ({
      id: moduleEntryId(manifest.id),
      section: "modules",
      label: strings.modules[manifest.id] ?? manifest.id,
      keywords: [s.moduleDescriptions[manifest.id] ?? ""],
    })),
  );
}

/** A card the filter can keep or hide: its id, and the title a query is matched against. */
export interface SettingsSectionDescriptor {
  readonly id: SettingsSectionId;
  readonly title: string;
}

/** Everything the filter needs about one build of the app: which cards exist, and what is searchable inside them. */
export interface SettingsIndex {
  /** In render order: the shell's cards, then each module's, in registry order. */
  readonly sections: readonly SettingsSectionDescriptor[];
  readonly entries: readonly SettingsSearchEntry[];
}

const SHELL_SECTION_IDS = Object.keys(s.sectionTitle) as ShellSettingsSectionId[];

/**
 * The whole index for one registry: the shell's hand-written cards and entries,
 * plus everything the registered modules declare.
 *
 * A shell section id a module has CLAIMED is dropped from the shell half —
 * every module card's title still lives in `strings.settings.sectionTitle`, and
 * the module's declaration is what names it, so listing it twice would be one
 * card counted as two.
 */
export function buildSettingsIndex(registry: ModuleRegistry): SettingsIndex {
  const moduleSections = moduleSettingsDeclarations(registry).map(({ moduleId, panel }) => ({
    id: moduleId,
    title: lookupString(strings, panel.titleKey) ?? moduleId,
  }));
  const claimed = new Set(moduleSections.map((section) => section.id));
  const shellSections = SHELL_SECTION_IDS.filter((id) => !claimed.has(id)).map((id) => ({
    id,
    title: s.sectionTitle[id],
  }));
  return {
    sections: [...shellSections, ...moduleSections],
    entries: [...ENTRIES, ...moduleSettingsEntries(registry), ...moduleGalleryEntries(registry)],
  };
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
  index: SettingsIndex,
  terms: readonly string[],
): SettingsSearchResult {
  if (terms.length === 0) {
    return { sections: new Set(index.sections.map((section) => section.id)), hits: new Set() };
  }

  const hits = new Set(
    index.entries.filter((entry) => matchesEntry(entry, terms)).map((entry) => entry.id),
  );
  const sections = new Set(
    index.sections
      .filter((section) => {
        const title = foldSearchText(section.title);
        if (terms.every((term) => title.includes(term))) return true;
        return index.entries.some((entry) => entry.section === section.id && hits.has(entry.id));
      })
      .map((section) => section.id),
  );
  return { sections, hits };
}

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
  // One entry per remappable action (ADR-040) — a user hunting for "novi
  // unos" or "zakljucaj" should land on the exact row that rebinds it — plus
  // one for the reference dialog itself.
  ...(
    [
      ["palette", ["paleta", "pretraga", "ctrl", "k"]],
      ["quickCreate", ["novi", "unos", "kreiranje", "ctrl", "n"]],
      ["lock", ["zakljucaj", "zakljucavanje", "ctrl", "l"]],
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
    id: "notifications-presets",
    section: "notifications",
    label: s.sectionTitle.notifications,
    keywords: ["podsetnik", "tiho", "izvori"],
  },
  {
    id: "backup-export",
    section: "backup",
    label: s.backup.exportButton,
    keywords: ["izvoz", "arhiva", "kopija"],
  },
  {
    id: "backup-restore",
    section: "backup",
    label: s.restore.title,
    keywords: ["vracanje", "uvoz", "arhiva"],
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

import { foldSearchText, type ModuleRegistry } from "@nexus/core";

import { lookupString } from "./dashboardLayout.js";
import { moduleSettingsDeclarations, settingsEntryId } from "./moduleSettings.js";
import { lookup, strings } from "./strings.js";

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
 *
 * A function, not a module-scope const, so a language switch relabels every
 * entry the next time the settings index is built instead of freezing them
 * at import.
 */
function shellEntries(): readonly ShellSettingsSearchEntry[] {
  const s = strings.settings;
  return [
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
      id: "appearance-language",
      section: "appearance",
      // „jezik" is what a Serbian speaker types; „language" and „srpski" are
      // what somebody who has just switched away from Serbian would.
      label: s.appearance.languageLabel,
      keywords: ["jezik", "language", "srpski", "prevod", "locale"],
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
    {
      // ADR-086 §5: the card that explains why this profile's app looks the way
      // it does. „upitnik" is deliberately shared with the „Moduli" row below —
      // both are honest answers to somebody typing it, and a keyword that only
      // one of two right answers carries is a filter picking for the user.
      id: "setup-explain",
      section: "setup",
      label: s.sectionTitle.setup,
      keywords: [
        "upitnik",
        "onboarding",
        "prilagodjeno",
        "zasto",
        "objasnjenje",
        "odgovori",
        "pocetak",
      ],
    },
    {
      // ADR-065 §5, moved by ADR-086: the row that reopens the questionnaire.
      // It was filed under „Moduli“ while it sat in that card; it now sits in
      // „Kako je Nexus podešen za tebe", which is what the questionnaire
      // actually decides. The id is unchanged — it names a control, not a card,
      // and „moduli“ stays in the keywords because that is still one of the
      // words somebody hunting for it types.
      id: "modules-onboarding",
      section: "setup",
      label: s.onboardingRerunTitle,
      keywords: ["upitnik", "onboarding", "podesavanje", "ponovo", "pocetak", "moduli", "oblasti"],
    },
    {
      id: "setup-forget",
      section: "setup",
      label: s.setup.forget,
      keywords: ["zaboravi", "obrisi", "odgovori", "upitnik", "privatnost"],
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
      // The toolkit picker. Its keywords are deliberately TRADES rather than
      // features, because that is what somebody types here: a person looking for
      // the dosing calculator searches „lekar", not „paket". The pack names
      // themselves are already matched through the card, so this entry carries
      // the words the names do not — the job titles the subjects were chosen to
      // avoid putting on screen (`strings.pro.packs`' own note).
      id: "packs",
      section: "packs",
      label: s.sectionTitle.packs,
      keywords: [
        "alatke",
        "struka",
        "zanimanje",
        "posao",
        "paket",
        "programer",
        "arhitekta",
        "lekar",
        "advokat",
        "racunovoda",
        "fotograf",
        "trener",
        "nastavnik",
        "prevodilac",
        "muzicar",
        "vozac",
        "poljoprivrednik",
        "krojac",
        "ugostitelj",
        "agent",
      ],
    },
    {
      // The long-form notices. Searched for by the WORRY, not by the feature
      // name — somebody types „odgovornost" or „garancija", never „napomene".
      id: "risk",
      section: "risk",
      label: s.sectionTitle.risk,
      keywords: [
        "napomena",
        "odgovornost",
        "garancija",
        "upozorenje",
        "bezbednost",
        "propis",
        "zakon",
        "savet",
        "rok",
        "porez",
      ],
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
    // SET-015: the eight flows that used to share „Rezervna kopija“ are each
    // their own sub-page now, so each entry files under its own sub-page id
    // (`import-*` / `export-ics`) rather than under `backup`. The hit ids stay
    // what they always were, which is what keeps every highlight working under
    // its new heading. „uvoz“ is shared by the import entries, which are then
    // told apart by the words that name what each one reads; the restore entry
    // stays on `backup` and answers to the words that describe what IT does.
    {
      // „kalendar" and „ics" are the words someone actually types looking for
      // this; „izvoz" is deliberately NOT repeated from `backup-export`, which
      // owns it — an entry that answers every query answers none of them.
      id: "backup-calendar",
      section: "export-ics",
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
      section: "import-archive",
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
      section: "import-ics",
      label: s.icsImport.title,
      keywords: ["ics", "icalendar", "kalendar", "google", "outlook", "dogadjaji", "uvoz"],
    },
    {
      // ADR-052. The words are the SOURCE's, not the flow's — somebody looking for
      // this types „anki“ or „apkg“, never „uvoz iz arhive“ — so „arhiva“ is
      // deliberately absent, exactly as it is from the markdown entry below.
      id: "backup-apkg",
      section: "import-apkg",
      label: s.apkgImport.title,
      keywords: ["anki", "apkg", "kartice", "spil", "flashcards", "uvoz"],
    },
    {
      // ADR-062. The words are the FORMAT's and the tool's — somebody looking for
      // this types „csv“, „excel“ or „tabela“ — so „arhiva“ is deliberately
      // absent, exactly as it is from its neighbours.
      id: "backup-csv",
      section: "import-csv",
      label: s.csvImport.title,
      keywords: ["csv", "tabela", "excel", "zadaci", "kolone", "todoist", "uvoz"],
    },
    {
      // FIN slice e. The words are the DOCUMENT's and the bank's — somebody
      // looking for this types „izvod“, „banka“ or „transakcije“, never „tabela“ —
      // which is exactly what keeps it apart from the task CSV entry above, whose
      // words nobody would use for their money.
      id: "backup-fin-csv",
      section: "import-fin-csv",
      label: s.finCsvImport.title,
      keywords: ["izvod", "banka", "bankovni", "racun", "transakcije", "promet", "finansije", "uvoz"],
    },
    {
      // IMEX-005. The words are the TOOL's, not the flow's — somebody looking for
      // this types „chatgpt“ or „ai“, never „uvoz iz arhive“ — so „arhiva“ is
      // deliberately absent, exactly as it is from the two entries around it.
      id: "backup-llm",
      section: "import-llm",
      label: s.llmImport.title,
      keywords: ["ai", "chatgpt", "claude", "gemini", "asistent", "vestacka", "uputstvo", "uvoz"],
    },
    {
      // The words someone looking for THIS types are the format's, not the
      // flow's: „arhiva“ belongs to the two entries above, which is why it is
      // deliberately absent here.
      id: "backup-markdown",
      section: "import-markdown",
      label: s.markdownImport.title,
      keywords: ["markdown", "md", "beleske", "fajlovi", "obsidian", "uvoz"],
    },
    {
      // The cloud switch gets its own entry rather than keywords on the enable
      // form below, because it is the control somebody hunting for „internet"
      // or „mreza" actually wants — and it is the one control on this card that
      // exists even in a build with no project configured.
      id: "sync-cloud",
      section: "sync",
      label: s.sync.cloudLabel,
      keywords: ["mreza", "internet", "oblak", "cloud", "veza", "onlajn", "offline"],
    },
    {
      // The words are the account's, not the protocol's: nobody types „aal2" or
      // „master key". „dvofaktorska“ and „kod“ are here because the form asks
      // for a TOTP code and that is the field people get stuck on.
      id: "sync-enable",
      section: "sync",
      label: s.sync.enableTitle,
      keywords: [
        "sinhronizacija",
        "sinhronizuj",
        "nalog",
        "prijava",
        "lozinka",
        "imejl",
        "dvofaktorska",
        "kod",
        "uredjaj",
        "veb",
      ],
    },
    {
      // The second road onto an account, and it needs its own entry because it
      // is the one people arrive at knowing only a WORD: they have a recovery
      // code on paper and no idea it is called adoption. „oporavak", „kod" and
      // „drugi racunar" are what gets typed; „pridruzi" is what the card says.
      id: "sync-adopt",
      section: "sync",
      label: s.sync.adoptTitle,
      keywords: [
        "oporavak",
        "kod",
        "postojeci",
        "nalog",
        "pridruzi",
        "povezi",
        "drugi",
        "racunar",
        "uredjaj",
        "kljuc",
      ],
    },
    {
      // Only ever visible on a computer whose session has ended, and that is
      // exactly when somebody searches for it: the form appears by itself, so
      // the person who comes to this page has usually come looking for „poveži"
      // after seeing sync stop working.
      id: "sync-reconnect",
      section: "sync",
      label: s.sync.reconnectTitle,
      keywords: ["povezi", "ponovo", "prijava", "istekla", "sesija", "lozinka", "nalog"],
    },
    {
      // What the loop is doing, and the button that makes it do it now. The
      // words are the ones somebody types when they think sync is stuck —
      // „zaglavilo", „ne radi" — rather than the card's own vocabulary, because
      // a person who could name the state would not be searching for it.
      id: "sync-activity",
      section: "sync",
      label: s.sync.activity.title,
      keywords: [
        "stanje",
        "sinhronizuj",
        "sada",
        "odmah",
        "zaglavilo",
        "ceka",
        "greska",
        "poslednja",
      ],
    },
    {
      // Its own entry because it is a BUTTON with consequences, and because the
      // word somebody reaches for („odjavi") appears nowhere else on the page.
      id: "sync-disconnect",
      section: "sync",
      label: s.sync.disconnect,
      keywords: ["odjavi", "odjava", "iskljuci", "prekini", "uredjaj", "sinhronizacija"],
    },
    {
      // SET-010: six sentences, one entry. There is nothing to operate in that
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
    // ADR-089: the device-level network mode, first card of the privacy
    // category. „mreža" and „internet" are the words somebody actually types,
    // and „github", „verzija" and „update" are the ones they type for the
    // second half of the card's name. The entries are the controls the card
    // draws, so the hits land on the radio labels and the save button.
    {
      id: "network-offline",
      section: "network",
      label: strings.network.offlineTitle,
      keywords: ["mreza", "internet", "offline", "bez interneta", "privatnost", "iskljuceno"],
    },
    {
      id: "network-updates",
      section: "network",
      label: strings.network.updatesTitle,
      keywords: ["mreza", "internet", "azuriranja", "update", "github", "verzija", "provera"],
    },
    {
      id: "network-save",
      section: "network",
      label: strings.network.save,
      keywords: ["rezim", "promeni", "sacuvaj", "restart", "pokretanje"],
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
      // One entry for a card that is one long read-only list. Nothing in it is
      // operable beyond the disclosures, so it only ever steers visibility — and
      // the words are the ones somebody hunting for a notice types („licenca",
      // „otvoreni kod", or the name of a licence family), not the card's own.
      id: "licences-notices",
      section: "licences",
      label: s.sectionTitle.licences,
      keywords: [
        "licenca",
        "licence",
        "otvoreni",
        "izvorni",
        "biblioteke",
        "fontovi",
        "autorska",
        "prava",
        "mit",
        "apache",
        "bsd",
        "ofl",
        "obavestenja",
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
    {
      // ADR-089: „Proveri sada" lives on the About card, so it files under
      // „about" and answers to the words somebody hunting for an update types —
      // never to the card's own name, which is the whole reason the button
      // carries its own entry.
      id: "about-check-now",
      section: "about",
      label: strings.network.checkNow,
      keywords: ["azuriranje", "update", "verzija", "provera", "github", "mreza", "novo"],
    },
    {
      // ADR-091. One entry for the card (the list of what is installed) and one
      // for the button, because the two are different errands: somebody hunting
      // for „vikipedija" wants the card, and somebody hunting for „instaliraj"
      // wants the button. The words are what a person types for offline
      // content, and none of them is the card's own name.
      id: "content-packs-list",
      section: "content-packs",
      label: s.sectionTitle["content-packs"],
      keywords: [
        "paket",
        "paketi",
        "sadrzaj",
        "vikipedija",
        "mapa",
        "offline",
        "zim",
        "instalirano",
      ],
    },
    {
      id: "content-packs-install",
      section: "content-packs",
      label: s.contentPacks.install,
      keywords: ["instaliraj", "paket", "dodaj", "fascikla", "usb", "disk", "preuzmi"],
    },
    ];
}

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
  const s = strings.settings;
  return [...registry.byCategory()].flatMap(([, members]) =>
    members.map((manifest) => ({
      id: moduleEntryId(manifest.id),
      section: "modules",
      label: lookup(strings.modules, manifest.id) ?? manifest.id,
      keywords: [lookup(s.moduleDescriptions, manifest.id) ?? ""],
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
  const s = strings.settings;
  // Read here, not at module scope, so a language switch is reflected on the
  // next build instead of freezing the shell's section id list at import.
  const shellSectionIds = Object.keys(s.sectionTitle) as ShellSettingsSectionId[];
  const moduleSections = moduleSettingsDeclarations(registry).map(({ moduleId, panel }) => ({
    id: moduleId,
    title: lookupString(strings, panel.titleKey) ?? moduleId,
  }));
  const claimed = new Set(moduleSections.map((section) => section.id));
  const shellSections = shellSectionIds.filter((id) => !claimed.has(id)).map((id) => ({
    id,
    title: s.sectionTitle[id],
  }));
  return {
    sections: [...shellSections, ...moduleSections],
    entries: [
      ...shellEntries(),
      ...moduleSettingsEntries(registry),
      ...moduleGalleryEntries(registry),
    ],
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

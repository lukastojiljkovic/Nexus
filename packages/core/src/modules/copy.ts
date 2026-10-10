import type { SearchKind } from "../search/searchQuery.js";

/**
 * One user-facing string in BOTH shipped locales.
 *
 * **Why a module declares its copy here rather than as a key path.** Every
 * existing module names its copy by a dotted path into the renderer's `strings`
 * table (`"dashboard.today.title"`), which works because that table is one file
 * the whole shell can reach. A module built on the module kit is discovered from
 * its own folder, and the shell needs a few of its words BEFORE its page loads —
 * its name in the rail, its one-line description on the settings card, the
 * labels of the settings controls the search filter indexes. Copy that arrives
 * with the page cannot name the rail entry that opens the page.
 *
 * So a kit module states those few strings as a pair and carries them with its
 * manifest. The pair is a plain `{ sr, en }` record and not a lookup: the module
 * owns its own words, both locales are in the same file, and the compiler
 * refuses one that is missing.
 *
 * `sr` is Latin script with č ć š ž đ, the default locale, and `en` is the same
 * statement in English. They are not translations of each other's grammar; they
 * are the same sentence written twice, in the register the rest of the app uses.
 */
export interface ModuleText {
  readonly sr: string;
  readonly en: string;
}

/** A search kind's two labels — what the palette says under a hit and over its group. */
export interface ModuleKindCopy {
  readonly kind: SearchKind;
  readonly singular: ModuleText;
  readonly plural: ModuleText;
}

/**
 * The copy the shell needs before a kit module's page chunk loads.
 *
 * Deliberately four things and no more. Anything the module's own page draws
 * lives in `renderer/copy.sr.ts`/`copy.en.ts`, rewritten in place by the locale
 * switch, and never travels here: this structure is read at startup and on the
 * settings page, where there is no page to read copy from.
 */
export interface ModuleCopyDeclaration {
  /** The rail, the page title, the onboarding row. */
  readonly name: ModuleText;
  /** One line, used by the settings gallery and as the module's search keywords. */
  readonly description: ModuleText;
  /**
   * Labels for the search kinds this module owns, if it owns any. A kind is
   * global (`SEARCH_KINDS`) while its wording is the owning module's, so a kit
   * module that claims one names it here rather than editing the shell's table.
   */
  readonly kinds?: readonly ModuleKindCopy[];
}

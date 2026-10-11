import type { LabelText } from "./labels.js";

/**
 * The settings a MODULE owns, declared the way a module declares its dashboard
 * widgets (ADR-045 / `WidgetContract`) — so the settings page COMPOSES a
 * module's card from the registry instead of hand-writing it, and a new module
 * costs a declaration plus its own component rather than an edit to a page.
 *
 * **The boundary this contract deliberately does not cross.** There are two
 * kinds of settings on that page and they are not the same thing:
 *
 * - *Module settings* — owned by a module and meaningless without it: the task
 *   page's preferences, the notes editor's measure, the semester's dates, the
 *   scheduler's targets, the private section's locks. These are declared HERE.
 * - *Shell settings* — the app's own, and true whatever modules exist:
 *   appearance and accent, the account and its passcode, notifications, backup
 *   and import, keyboard shortcuts, the module gallery itself. Those stay
 *   hand-composed in the page, BY DESIGN.
 *
 * That boundary is the point, not a half-finished job. A contract that also
 * swallowed the passcode panel would be a worse abstraction rather than a
 * bigger one: it would have to describe a form nobody else will ever have, and
 * the closed vocabulary below would open into "render whatever you like" — at
 * which point the page is hand-written again, only indirectly. Do not "finish"
 * this refactor by dragging the shell's own settings through it.
 *
 * **What is declared and what is not.** Exactly as with widgets: the
 * declaration is identity, copy keys and the knobs; the RENDERING is a
 * component the renderer resolves by module id (`moduleSettingsPanels.tsx`, the
 * sibling of `dashboardWidgets.tsx`). So this file describes what the shell
 * must know without opening the component — what is searchable, and where the
 * values live — and nothing about how anything is drawn.
 */

/**
 * Where a module setting's value lives. Two answers, and they are honestly
 * different places:
 *
 * - `"device"` — `localStorage` on this machine, the `notePrefs.ts`/`accent.ts`
 *   idiom: how THIS machine renders the module.
 * - `"profile"` — a row in the profile's encrypted database, reached through
 *   main's IPC allowlist: what the profile CONTAINS.
 *
 * Neither is forced into the other's storage, because the contract stores
 * nothing itself — the panel's own component reads and writes, exactly as a
 * widget body does. What declaring it buys is the one decision the shell must
 * make without opening the component: „Vrati na podrazumevano" (SET §5) is
 * offered on a card whose every value is this machine's, and never on one where
 * it would be a write about the user's data.
 */
export type SettingsStorage = "device" | "profile";

/** One answer of a closed choice; `labelKey` resolves through the renderer's `strings` tree, exactly as `WidgetContract.title` does. */
export interface SettingsChoiceOption {
  id: string;
  labelKey: LabelText;
}

interface SettingsControlBase {
  /**
   * ASCII slug, unique within its panel. Qualified as `moduleId:key` it IS the
   * settings filter's entry id (SET-014) — the id the panel highlights its own
   * label by — so a key is a key and never a label.
   */
  key: string;
  /**
   * The control's own label as an i18n KEY path, never as text — the same
   * convention `WidgetContract.title` documents: `"settings.notes.widthLabel"`
   * means `strings.settings.notes.widthLabel`. Keeps the Serbian copy in the
   * one file that holds all the copy and `@nexus/core` free of user-facing
   * prose.
   */
  labelKey: LabelText;
  /**
   * Extra words this control answers to in the settings filter, spelled ALREADY
   * FOLDED (plain ASCII) exactly the way `searchCommands.ts` spells its
   * keywords: the label carries the orthography, these carry the synonyms.
   * They are search keys and are never rendered, which is why they may sit in a
   * declaration that holds no prose. Kept modest and honest — a keyword is here
   * because somebody would really type it.
   */
  keywords?: readonly string[];
}

/**
 * A closed set of answers — a segmented row or a small select. The options'
 * own labels are folded into the control's search keywords automatically, so
 * „Noć", „Uska" or „Sakrij" find their control without anyone repeating them.
 */
export interface SettingsChoiceControl extends SettingsControlBase {
  kind: "choice";
  storage: SettingsStorage;
  /** The closed domain, in the order the panel offers it. */
  options: SettingsChoiceOption[];
}

/** A boolean: one checkbox row. */
export interface SettingsToggleControl extends SettingsControlBase {
  kind: "toggle";
  storage: SettingsStorage;
}

/**
 * A value whose domain the shell cannot enumerate — a bounded number, a date,
 * a picked image, a preset row computed from numbers.
 *
 * This is the deliberate bottom of the vocabulary, and it is still CLOSED: it
 * declares a label, its keywords and where the value lives, and says nothing
 * whatsoever about rendering. The bounds and the widget stay in the panel's own
 * component, which already owns them — restating a range here would be a rule
 * nothing enforces, which is exactly what `JsonSchema` in this folder already
 * warns about.
 */
export interface SettingsValueControl extends SettingsControlBase {
  kind: "value";
  storage: SettingsStorage;
}

/**
 * A read-only statement of fact the card makes — the private section's Recovery
 * Kit line, say. Searchable, because somebody hunting for "oporavak" should
 * land on the card that says something about it, but there is nothing to set:
 * hence no `storage`, and hence it neither earns nor blocks a card's reset.
 */
export interface SettingsFactControl extends SettingsControlBase {
  kind: "fact";
}

/**
 * The closed vocabulary a module's settings are declared in — four kinds and no
 * fifth, on ADR-059's reasoning for `WidgetConfigField`: an open escape hatch
 * becomes "render arbitrary JSX" within two modules, and then the page is
 * hand-composed again with extra indirection. From the shell's point of view a
 * settings control can only be an enumerable choice, a boolean, a value it
 * cannot enumerate, or a statement of fact.
 */
export type SettingsControl =
  | SettingsChoiceControl
  | SettingsToggleControl
  | SettingsValueControl
  | SettingsFactControl;

/**
 * The one settings card a module publishes. One per module deliberately: a
 * module's settings are one subject, and a second card would be a second place
 * to look for the same module's preferences.
 *
 * The card's SECTION id is the module's own registry id — which is what lets a
 * search hit steer to a module's card without a second naming scheme — and its
 * title is `titleKey`, a `strings` path exactly like a widget's.
 */
export interface SettingsPanel {
  /** The card's title (`SettingsControlBase.labelKey`'s convention). */
  titleKey: LabelText;
  /** The controls the card draws, in the order it draws them. */
  controls: SettingsControl[];
}

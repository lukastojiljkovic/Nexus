/**
 * The DASHBOARD: what the board shows, how its cards are arranged, and its named
 * boards.
 *
 * **The layout is a store, so the tools write in main.** Every change is the
 * store call the IPC handler makes for the same gesture (`DashboardWidgetStore`,
 * `DashboardSetStore`, `DashboardSettingsStore`), so the page and the assistant
 * cannot disagree about what is saved. A write answers `navigateTo` the dashboard
 * without naming a card: the page reads its layout when it opens, and a
 * placement is not a row the page could reveal.
 *
 * **"The board" is the one on screen.** An omitted `board` is the active board, as
 * the page draws it. The default board („Početna“) is not a row, so it has no id
 * and is named by its copy.
 *
 * **Widgets and placements are named, not numbered.** A widget is named by its
 * title or its `moduleId:widgetId`; a placement by its widget when that widget
 * sits once on the board, and refused with the candidates otherwise.
 *
 * **The default arrangement is the store's rule.** Adding to a board with no rows
 * or removing its last card materializes or restores the five default cards in
 * the store; these tools say so in their results rather than repeat the rule.
 */

import {
  DASHBOARD_WIDGET_SIZES,
  DashboardSetStore,
  DashboardSettingsStore,
  DashboardWidgetStore,
  MAX_BACKGROUND_DIM,
  MAX_DASHBOARD_SET_NAME_LENGTH,
} from "@nexus/db";
import type { DashboardSet, DashboardWidgetInstance } from "@nexus/db";
import {
  foldSearchText,
  MAX_ID_LENGTH,
  serializeWidgetConfig,
  validateWidgetConfig,
} from "@nexus/core";
import {
  BUILTIN_WIDGET_TITLES,
  DASHBOARD_DEFAULT_BOARD_NAME,
} from "../../../shared/dashboardWidgetTitles.js";
import type {
  AppLocation,
  AssistantLocale,
  AssistantText,
  Tool,
  WidgetContract,
} from "@nexus/core";
import {
  asArgs,
  asCount,
  asEnum,
  asOptionalBoolean,
  asOptionalEnum,
  asOptionalText,
  asText,
} from "./args.js";
import type { ModuleLookup } from "./app.js";
import {
  assertLive,
  confirmOrDecline,
  guard,
  okResult,
  phrase,
  quote,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface DashboardToolDeps {
  readonly profileDb: ProfileDb;
  readonly now: () => number;
  /** The app's module registry: the widgets every module publishes. */
  readonly modules: ModuleLookup;
}

/** The default board is the absence of a row (ADR-055), so it is named by copy alone. */
const DEFAULT_BOARD = DASHBOARD_DEFAULT_BOARD_NAME;

const DASHBOARD: AppLocation = { module: "dashboard" };

const SIZES = DASHBOARD_WIDGET_SIZES;
const ARRANGE_ACTIONS = ["add", "remove", "size", "config", "move", "dim"] as const;
const BOARD_ACTIONS = ["create", "rename", "delete", "activate", "reorder"] as const;

/** A widget or board as a model may name it: an id, or a title or name in either language. */
const REFERENCE = (description: string) => ({
  type: "string",
  minLength: 1,
  maxLength: MAX_ID_LENGTH,
  description,
});

const NAME = {
  type: "string",
  minLength: 1,
  maxLength: MAX_DASHBOARD_SET_NAME_LENGTH,
  description: "A board's name, 1 to 100 characters.",
};

type Side = "before" | "after";

interface Catalogued {
  readonly id: string;
  readonly widget: WidgetContract;
}

/** The three stores one profile's dashboard reads and writes through, opened together for one call. */
interface Stores {
  readonly widgets: DashboardWidgetStore;
  readonly sets: DashboardSetStore;
  readonly settings: DashboardSettingsStore;
}

/** The board a call is about: `setId` null is the default board. */
interface Scope {
  readonly setId: string | null;
  readonly name: string;
}

/** A planned write: what the user is asked to confirm, and the store calls that make it (run only after a yes). */
interface Change {
  readonly summary: string;
  readonly apply: (stores: Stores) => string;
}

const REQUIRES: AssistantPhrase<[action: string, field: string]> = {
  sr: (action, field) => `Radnja „${action}“ traži polje „${field}“.`,
  en: (action, field) => `The “${action}” action needs the “${field}” field.`,
};

const WIDGET_NOT_FOUND: AssistantPhrase<[wanted: string]> = {
  sr: (wanted) => `Nema vidžeta „${wanted}“.`,
  en: (wanted) => `No widget named “${wanted}”.`,
};

const PLACEMENT_NOT_FOUND: AssistantPhrase<[board: string, wanted: string]> = {
  sr: (board, wanted) => `Na tabli „${board}“ nema vidžeta „${wanted}“.`,
  en: (board, wanted) => `No widget “${wanted}” on the “${board}” board.`,
};

const BOARD_NOT_FOUND: AssistantPhrase<[wanted: string]> = {
  sr: (wanted) => `Nema table „${wanted}“.`,
  en: (wanted) => `No board named “${wanted}”.`,
};

const AMBIGUOUS: AssistantPhrase<[wanted: string, ids: string]> = {
  sr: (wanted, ids) => `Ima više podudaranja za „${wanted}“ (${ids}). Navedi id.`,
  en: (wanted, ids) => `More than one match for “${wanted}” (${ids}). Use its id.`,
};

const DEFAULT_FIXED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Podrazumevana tabla „${name}“ ne može se menjati ni brisati.`,
  en: (name) => `The default board “${name}” cannot be changed or deleted.`,
};

const BOARD_TAKEN: AssistantPhrase<[name: string]> = {
  sr: (name) => `Tabla „${name}“ već postoji.`,
  en: (name) => `A board named “${name}” already exists.`,
};

const ONE_ANCHOR: { sr: string; en: string } = {
  sr: "Navedi tačno jedno od polja „before“ i „after“.",
  en: "Give exactly one of “before” and “after”.",
};

const SELF_ORDER: { sr: string; en: string } = {
  sr: "Vidžet ne može biti pored samog sebe.",
  en: "A widget cannot be placed against itself.",
};

const CONFIG_SHAPE: { sr: string; en: string } = {
  sr: "Polje „config“ mora biti objekat.",
  en: "The “config” field must be an object.",
};

const CONFIG_REFUSED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Vidžet „${name}“ ne prima ta podešavanja.`,
  en: (name) => `The “${name}” widget does not accept those settings.`,
};

const SIZE_UNSUPPORTED: AssistantPhrase<[name: string, size: string]> = {
  sr: (name, size) => `Vidžet „${name}“ nema veličinu ${size}.`,
  en: (name, size) => `The “${name}” widget has no size ${size}.`,
};

const LAST_WIDGET: { sr: string; en: string } = {
  sr: " — poslednji vidžet, pa se tabla vraća na podrazumevani raspored",
  en: " — the last widget, so the board goes back to the default arrangement",
};

const ACTIVE_SWITCH: AssistantPhrase<[home: string]> = {
  sr: (home) => `; prikaz se vraća na „${home}“`,
  en: (home) => `; the view goes back to “${home}”`,
};

const BOARD_SHOWN_HOME: AssistantPhrase<[home: string]> = {
  sr: (home) => `Prikazuje se „${home}“.`,
  en: (home) => `Now showing “${home}”.`,
};

const ON_BOARD: AssistantPhrase<[board: string]> = {
  sr: (board) => `Vidžeti na tabli „${board}“:`,
  en: (board) => `Widgets on the “${board}” board:`,
};

const CAN_ADD: { sr: string; en: string } = {
  sr: "Vidžeti koje korisnik može da doda:",
  en: "Widgets the user can add:",
};

const BOARDS_HEADING: { sr: string; en: string } = {
  sr: "Table kontrolne table:",
  en: "Dashboard boards:",
};

const ACTIVE_MARK: AssistantText = { sr: "otvorena", en: "open" };

const ADD: AssistantPhrase<[name: string, size: string, board: string]> = {
  sr: (name, size, board) => `Dodaj vidžet ${name} (${size}) na tablu ${board}`,
  en: (name, size, board) => `Add the ${name} widget (${size}) to the ${board} board`,
};

const ADDED: AssistantPhrase<[name: string, size: string]> = {
  sr: (name, size) => `Dodat vidžet ${name}, veličina ${size}.`,
  en: (name, size) => `Added the ${name} widget, size ${size}.`,
};

const REMOVE: AssistantPhrase<[name: string, board: string]> = {
  sr: (name, board) => `Ukloni vidžet ${name} s table ${board}`,
  en: (name, board) => `Remove the ${name} widget from the ${board} board`,
};

const REMOVED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Uklonjen vidžet ${name}.`,
  en: (name) => `Removed the ${name} widget.`,
};

const SIZE_SUMMARY: AssistantPhrase<[name: string, size: string]> = {
  sr: (name, size) => `Promeni veličinu vidžeta ${name} na ${size}`,
  en: (name, size) => `Set the ${name} widget to size ${size}`,
};

const SIZE_DONE: AssistantPhrase<[name: string, size: string]> = {
  sr: (name, size) => `Vidžet ${name} je sada veličine ${size}.`,
  en: (name, size) => `The ${name} widget is now size ${size}.`,
};

const CONFIG_SUMMARY: AssistantPhrase<[name: string, pairs: string]> = {
  sr: (name, pairs) => `Podesi vidžet ${name}: ${pairs}`,
  en: (name, pairs) => `Configure the ${name} widget: ${pairs}`,
};

const CONFIG_DONE: AssistantPhrase<[name: string]> = {
  sr: (name) => `Podešen vidžet ${name}.`,
  en: (name) => `Configured the ${name} widget.`,
};

const MOVE_BEFORE: AssistantPhrase<[name: string, anchor: string, board: string]> = {
  sr: (name, anchor, board) => `Premesti vidžet ${name} ispred ${anchor} na tabli ${board}`,
  en: (name, anchor, board) => `Move the ${name} widget before ${anchor} on the ${board} board`,
};

const MOVE_AFTER: AssistantPhrase<[name: string, anchor: string, board: string]> = {
  sr: (name, anchor, board) => `Premesti vidžet ${name} posle ${anchor} na tabli ${board}`,
  en: (name, anchor, board) => `Move the ${name} widget after ${anchor} on the ${board} board`,
};

const MOVED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Vidžet ${name} je premešten.`,
  en: (name) => `Moved the ${name} widget.`,
};

const DIM_SUMMARY: AssistantPhrase<[dim: number]> = {
  sr: (dim) => `Zatamni pozadinu kontrolne table na ${dim}`,
  en: (dim) => `Set the dashboard background dim to ${dim}`,
};

const DIM_DONE: AssistantPhrase<[dim: number]> = {
  sr: (dim) => `Zatamljenje pozadine kontrolne table: ${dim}.`,
  en: (dim) => `Dashboard background dim: ${dim}.`,
};

const BOARD_CREATE: AssistantPhrase<[name: string]> = {
  sr: (name) => `Napravi tablu ${name}`,
  en: (name) => `Create the board ${name}`,
};

const BOARD_CREATED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Napravljena tabla ${name}.`,
  en: (name) => `Created the board ${name}.`,
};

const BOARD_RENAME: AssistantPhrase<[from: string, to: string]> = {
  sr: (from, to) => `Preimenuj tablu ${from} u ${to}`,
  en: (from, to) => `Rename the board ${from} to ${to}`,
};

const BOARD_RENAMED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Tabla je preimenovana u ${name}.`,
  en: (name) => `The board is now called ${name}.`,
};

const BOARD_DELETE: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obriši tablu ${name} sa njenim vidžetima`,
  en: (name) => `Delete the board ${name} and its widgets`,
};

const BOARD_DELETED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obrisana tabla ${name}.`,
  en: (name) => `Deleted the board ${name}.`,
};

const BOARD_ACTIVATE: AssistantPhrase<[name: string]> = {
  sr: (name) => `Prikaži tablu ${name}`,
  en: (name) => `Show the board ${name}`,
};

const BOARD_ACTIVATED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Sada se prikazuje tabla ${name}.`,
  en: (name) => `Now showing the board ${name}.`,
};

const BOARD_REORDER_BEFORE: AssistantPhrase<[name: string, anchor: string]> = {
  sr: (name, anchor) => `Premesti tablu ${name} ispred ${anchor}`,
  en: (name, anchor) => `Move the board ${name} before ${anchor}`,
};

const BOARD_REORDER_AFTER: AssistantPhrase<[name: string, anchor: string]> = {
  sr: (name, anchor) => `Premesti tablu ${name} posle ${anchor}`,
  en: (name, anchor) => `Move the board ${name} after ${anchor}`,
};

const BOARD_REORDERED: { sr: string; en: string } = {
  sr: "Redosled tabli je promenjen.",
  en: "The board order has changed.",
};

/** Folds two names for comparison: case, diacritics and surrounding space do not count. */
function foldsTo(left: string, right: string): boolean {
  return foldSearchText(left.trim()) === foldSearchText(right.trim());
}

/** Whether a reference names this copy in either language, so a Serbian or an English word both find it. */
function namedAs(names: AssistantText, reference: string): boolean {
  return foldsTo(names.sr, reference) || foldsTo(names.en, reference);
}

function titleOf(widget: WidgetContract): AssistantText {
  if (typeof widget.title !== "string") return widget.title;
  return BUILTIN_WIDGET_TITLES[widget.title] ?? { sr: widget.title, en: widget.title };
}

function catalogueOf(modules: ModuleLookup): Catalogued[] {
  return modules
    .all()
    .flatMap((manifest) =>
      (manifest.widgets ?? []).map((widget) => ({ id: `${manifest.id}:${widget.id}`, widget })),
    );
}

function contractOf(catalogue: readonly Catalogued[], id: string): WidgetContract | undefined {
  return catalogue.find((entry) => entry.id === id)?.widget;
}

/** A placed widget's name; an id this build does not publish is named by the id itself. */
function nameOf(id: string, catalogue: readonly Catalogued[]): AssistantText {
  const widget = contractOf(catalogue, id);
  return widget === undefined ? { sr: id, en: id } : titleOf(widget);
}

/** The one item a reference names: a single match, or a refusal that lists the candidates' ids. */
function requireOne<T>(
  matches: readonly T[],
  locale: AssistantLocale,
  idOf: (item: T) => string,
  missing: string,
  wanted: string,
): T {
  const [first] = matches;
  if (first === undefined) throw new Error(missing);
  if (matches.length > 1) {
    throw new Error(phrase(locale, AMBIGUOUS, wanted, matches.map(idOf).join(", ")));
  }
  return first;
}

function need(
  args: Record<string, unknown>,
  field: string,
  action: string,
  locale: AssistantLocale,
): unknown {
  const value = args[field];
  if (value === undefined) throw new Error(phrase(locale, REQUIRES, action, field));
  return value;
}

function requireRef(
  args: Record<string, unknown>,
  field: string,
  action: string,
  locale: AssistantLocale,
): string {
  return asText(need(args, field, action, locale), field, MAX_ID_LENGTH);
}

function resolveWidget(
  catalogue: readonly Catalogued[],
  wanted: string,
  locale: AssistantLocale,
): Catalogued {
  const exact = catalogue.find((entry) => entry.id === wanted);
  if (exact !== undefined) return exact;
  return requireOne(
    catalogue.filter((entry) => namedAs(titleOf(entry.widget), wanted)),
    locale,
    (entry) => entry.id,
    phrase(locale, WIDGET_NOT_FOUND, wanted),
    wanted,
  );
}

function resolvePlacement(
  layout: readonly DashboardWidgetInstance[],
  catalogue: readonly Catalogued[],
  wanted: string,
  scope: Scope,
  locale: AssistantLocale,
): DashboardWidgetInstance {
  const exact = layout.find((placement) => placement.instanceId === wanted);
  if (exact !== undefined) return exact;
  return requireOne(
    layout.filter(
      (placement) =>
        placement.widgetId === wanted || namedAs(nameOf(placement.widgetId, catalogue), wanted),
    ),
    locale,
    (placement) => placement.instanceId,
    phrase(locale, PLACEMENT_NOT_FOUND, scope.name, wanted),
    wanted,
  );
}

function defaultScope(locale: AssistantLocale): Scope {
  return { setId: null, name: text(locale, DEFAULT_BOARD) };
}

/** The board the page is showing: the active one, or the default when it names nothing that exists. */
function activeScope(boards: readonly DashboardSet[], setId: string | null, locale: AssistantLocale): Scope {
  const board = setId === null ? undefined : boards.find((entry) => entry.id === setId);
  return board === undefined ? defaultScope(locale) : { setId: board.id, name: board.name };
}

function resolveBoard(
  boards: readonly DashboardSet[],
  wanted: string | undefined,
  active: string | null,
  locale: AssistantLocale,
): Scope {
  if (wanted === undefined) return activeScope(boards, active, locale);
  if (namedAs(DEFAULT_BOARD, wanted)) return defaultScope(locale);
  const board = requireOne(
    boards.filter((entry) => entry.id === wanted || foldsTo(entry.name, wanted)),
    locale,
    (entry) => entry.id,
    phrase(locale, BOARD_NOT_FOUND, wanted),
    wanted,
  );
  return { setId: board.id, name: board.name };
}

/** A board that can be renamed, deleted or reordered: every named board, never the default. */
function namedBoard(scope: Scope, locale: AssistantLocale): { id: string; name: string } {
  if (scope.setId === null) throw new Error(phrase(locale, DEFAULT_FIXED, scope.name));
  return { id: scope.setId, name: scope.name };
}

function refuseTakenName(boards: readonly DashboardSet[], name: string, locale: AssistantLocale, except?: string): void {
  const taken =
    namedAs(DEFAULT_BOARD, name) || boards.some((entry) => entry.id !== except && foldsTo(entry.name, name));
  if (taken) throw new Error(phrase(locale, BOARD_TAKEN, name));
}

/**
 * The two placements a moved entry lands between, to sit just before or just after
 * an anchor — the pair the stores take, and the one place that arithmetic lives here.
 * The moved entry is taken out of the order first, so the anchor is always another
 * entry and the pair is always two other entries (or null at an end).
 */
function slotAround(
  order: readonly string[],
  moved: string,
  side: Side,
  anchor: string,
): { beforeId: string | null; afterId: string | null } {
  const rest = order.filter((id) => id !== moved);
  const at = rest.indexOf(anchor);
  return side === "after"
    ? { beforeId: anchor, afterId: rest[at + 1] ?? null }
    : { beforeId: rest[at - 1] ?? null, afterId: anchor };
}

function sideOf(
  before: string | undefined,
  after: string | undefined,
  locale: AssistantLocale,
): { side: Side; anchor: string } {
  if (before !== undefined && after === undefined) return { side: "before", anchor: before };
  if (after !== undefined && before === undefined) return { side: "after", anchor: after };
  throw new Error(text(locale, ONE_ANCHOR));
}

function layoutText(
  locale: AssistantLocale,
  scope: Scope,
  layout: readonly DashboardWidgetInstance[],
  catalogue: readonly Catalogued[],
): string {
  const lines = layout.map((placement) => {
    const name = quote(locale, nameOf(placement.widgetId, catalogue)[locale]);
    const config = placement.config === null ? "" : ` · ${placement.config}`;
    return `- ${placement.instanceId} · ${placement.widgetId} · ${name} · ${placement.size}${config}`;
  });
  return [phrase(locale, ON_BOARD, scope.name), ...lines].join("\n");
}

function catalogueText(locale: AssistantLocale, catalogue: readonly Catalogued[]): string {
  const lines = catalogue.map(
    (entry) =>
      `- ${entry.id} · ${quote(locale, titleOf(entry.widget)[locale])} · ${entry.widget.sizes.join(", ")}`,
  );
  return [text(locale, CAN_ADD), ...lines].join("\n");
}

function boardsText(locale: AssistantLocale, boards: readonly DashboardSet[], active: string | null): string {
  const mark = (open: boolean): string => (open ? ` (${text(locale, ACTIVE_MARK)})` : "");
  const lines = [
    `- ${text(locale, DEFAULT_BOARD)} · default${mark(active === null)}`,
    ...boards.map((board) => `- ${board.name} · ${board.id}${mark(board.id === active)}`),
  ];
  return [text(locale, BOARDS_HEADING), ...lines].join("\n");
}

export function dashboardTools(deps: DashboardToolDeps): readonly Tool[] {
  const stamp = (): string => new Date(deps.now()).toISOString();

  function withStores<T>(profileId: string, open: (stores: Stores) => T): T {
    return deps.profileDb(profileId, (db, id) =>
      open({
        widgets: new DashboardWidgetStore(db, id),
        sets: new DashboardSetStore(db, id),
        settings: new DashboardSettingsStore(db, id),
      }),
    );
  }

  function planArrange(
    stores: Stores,
    action: (typeof ARRANGE_ACTIONS)[number],
    args: Record<string, unknown>,
    catalogue: readonly Catalogued[],
    locale: AssistantLocale,
  ): Change {
    if (action === "dim") {
      const dim = asCount(need(args, "dim", action, locale), "dim", 0, MAX_BACKGROUND_DIM);
      return {
        summary: phrase(locale, DIM_SUMMARY, dim),
        apply: (live) => {
          live.settings.setDim(dim, stamp());
          return phrase(locale, DIM_DONE, dim);
        },
      };
    }

    const scope = resolveBoard(
      stores.sets.list(),
      asOptionalText(args["board"], "board", MAX_ID_LENGTH),
      stores.sets.activeSetId(),
      locale,
    );
    const layout = stores.widgets.listLayout(scope.setId);
    const boardName = quote(locale, scope.name);
    const reprint = (sentence: string, after: readonly DashboardWidgetInstance[]): string =>
      `${sentence}\n${layoutText(locale, scope, after, catalogue)}`;

    switch (action) {
      case "add": {
        const widget = resolveWidget(catalogue, requireRef(args, "widget", action, locale), locale);
        const size = asOptionalEnum(args["size"], "size", SIZES) ?? "M";
        if (!widget.widget.sizes.includes(size)) {
          throw new Error(phrase(locale, SIZE_UNSUPPORTED, titleOf(widget.widget)[locale], size));
        }
        const name = quote(locale, titleOf(widget.widget)[locale]);
        return {
          summary: phrase(locale, ADD, name, size, boardName),
          apply: (live) =>
            reprint(phrase(locale, ADDED, name, size), live.widgets.add(scope.setId, widget.id, size, stamp())),
        };
      }

      case "remove": {
        const placement = resolvePlacement(layout, catalogue, requireRef(args, "instance", action, locale), scope, locale);
        const name = quote(locale, nameOf(placement.widgetId, catalogue)[locale]);
        const last = layout.length === 1;
        return {
          summary: phrase(locale, REMOVE, name, boardName) + (last ? text(locale, LAST_WIDGET) : ""),
          apply: (live) =>
            reprint(
              phrase(locale, REMOVED, name) + (last ? text(locale, LAST_WIDGET) : ""),
              live.widgets.remove(scope.setId, placement.instanceId, stamp()),
            ),
        };
      }

      case "size": {
        const placement = resolvePlacement(layout, catalogue, requireRef(args, "instance", action, locale), scope, locale);
        const size = asEnum(need(args, "size", action, locale), "size", SIZES);
        const title = nameOf(placement.widgetId, catalogue)[locale];
        const name = quote(locale, title);
        const sizes = contractOf(catalogue, placement.widgetId)?.sizes ?? SIZES;
        if (!sizes.includes(size)) throw new Error(phrase(locale, SIZE_UNSUPPORTED, title, size));
        return {
          summary: phrase(locale, SIZE_SUMMARY, name, size),
          apply: (live) =>
            reprint(
              phrase(locale, SIZE_DONE, name, size),
              live.widgets.setSize(scope.setId, placement.instanceId, size, stamp()),
            ),
        };
      }

      case "config": {
        const placement = resolvePlacement(layout, catalogue, requireRef(args, "instance", action, locale), scope, locale);
        const given = need(args, "config", action, locale);
        if (typeof given !== "object" || given === null || Array.isArray(given)) {
          throw new Error(text(locale, CONFIG_SHAPE));
        }
        const name = quote(locale, nameOf(placement.widgetId, catalogue)[locale]);
        const current = placement.config === null ? {} : (JSON.parse(placement.config) as Record<string, unknown>);
        // Merged into what the widget already holds, so one key can change without
        // restating the rest; the merge is what the contract validates.
        const config = validateWidgetConfig(contractOf(catalogue, placement.widgetId) ?? {}, {
          ...current,
          ...given,
        });
        if (config === null) throw new Error(phrase(locale, CONFIG_REFUSED, nameOf(placement.widgetId, catalogue)[locale]));
        const pairs = Object.entries(given as Record<string, unknown>)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join(", ");
        return {
          summary: phrase(locale, CONFIG_SUMMARY, name, pairs),
          apply: (live) =>
            reprint(
              phrase(locale, CONFIG_DONE, name),
              live.widgets.setConfig(scope.setId, placement.instanceId, serializeWidgetConfig(config), stamp()),
            ),
        };
      }

      case "move": {
        const placement = resolvePlacement(layout, catalogue, requireRef(args, "instance", action, locale), scope, locale);
        const { side, anchor: wanted } = sideOf(
          asOptionalText(args["before"], "before", MAX_ID_LENGTH),
          asOptionalText(args["after"], "after", MAX_ID_LENGTH),
          locale,
        );
        const anchor = resolvePlacement(layout, catalogue, wanted, scope, locale);
        if (anchor.instanceId === placement.instanceId) throw new Error(text(locale, SELF_ORDER));
        const name = quote(locale, nameOf(placement.widgetId, catalogue)[locale]);
        const anchorName = quote(locale, nameOf(anchor.widgetId, catalogue)[locale]);
        const pair = slotAround(
          layout.map((entry) => entry.instanceId),
          placement.instanceId,
          side,
          anchor.instanceId,
        );
        return {
          summary: phrase(locale, side === "before" ? MOVE_BEFORE : MOVE_AFTER, name, anchorName, boardName),
          apply: (live) =>
            reprint(
              phrase(locale, MOVED, name),
              live.widgets.move(scope.setId, placement.instanceId, pair.beforeId, pair.afterId, stamp()),
            ),
        };
      }
    }
  }

  function planBoard(
    stores: Stores,
    action: (typeof BOARD_ACTIONS)[number],
    args: Record<string, unknown>,
    locale: AssistantLocale,
  ): Change {
    const boards = stores.sets.list();
    const active = stores.sets.activeSetId();
    const boardsResult = (sentence: string, live: Stores): string =>
      `${sentence}\n${boardsText(locale, live.sets.list(), live.sets.activeSetId())}`;
    const target = (): { id: string; name: string } =>
      namedBoard(resolveBoard(boards, requireRef(args, "board", action, locale), active, locale), locale);

    switch (action) {
      case "create": {
        const name = asText(need(args, "name", action, locale), "name", MAX_DASHBOARD_SET_NAME_LENGTH);
        refuseTakenName(boards, name, locale);
        return {
          summary: phrase(locale, BOARD_CREATE, quote(locale, name)),
          apply: (live) => {
            const created = live.sets.create(name, stamp());
            return boardsResult(phrase(locale, BOARD_CREATED, created.name), live);
          },
        };
      }

      case "rename": {
        const board = target();
        const name = asText(need(args, "name", action, locale), "name", MAX_DASHBOARD_SET_NAME_LENGTH);
        refuseTakenName(boards, name, locale, board.id);
        return {
          summary: phrase(locale, BOARD_RENAME, quote(locale, board.name), quote(locale, name)),
          apply: (live) => {
            live.sets.rename(board.id, name, stamp());
            return boardsResult(phrase(locale, BOARD_RENAMED, name), live);
          },
        };
      }

      case "delete": {
        const board = target();
        const wasActive = active === board.id;
        return {
          summary:
            phrase(locale, BOARD_DELETE, quote(locale, board.name)) +
            (wasActive ? phrase(locale, ACTIVE_SWITCH, text(locale, DEFAULT_BOARD)) : ""),
          apply: (live) => {
            live.sets.delete(board.id, stamp());
            const done = phrase(locale, BOARD_DELETED, quote(locale, board.name));
            return boardsResult(
              wasActive ? `${done} ${phrase(locale, BOARD_SHOWN_HOME, text(locale, DEFAULT_BOARD))}` : done,
              live,
            );
          },
        };
      }

      case "activate": {
        const scope = resolveBoard(boards, requireRef(args, "board", action, locale), active, locale);
        return {
          summary: phrase(locale, BOARD_ACTIVATE, quote(locale, scope.name)),
          apply: (live) => {
            live.sets.setActive(scope.setId, stamp());
            return boardsResult(phrase(locale, BOARD_ACTIVATED, scope.name), live);
          },
        };
      }

      case "reorder": {
        const board = target();
        const { side, anchor: wanted } = sideOf(
          asOptionalText(args["before"], "before", MAX_ID_LENGTH),
          asOptionalText(args["after"], "after", MAX_ID_LENGTH),
          locale,
        );
        const anchor = namedBoard(resolveBoard(boards, wanted, active, locale), locale);
        if (anchor.id === board.id) throw new Error(text(locale, SELF_ORDER));
        const pair = slotAround(boards.map((entry) => entry.id), board.id, side, anchor.id);
        return {
          summary: phrase(
            locale,
            side === "before" ? BOARD_REORDER_BEFORE : BOARD_REORDER_AFTER,
            quote(locale, board.name),
            quote(locale, anchor.name),
          ),
          apply: (live) => {
            live.sets.reorder(board.id, pair.beforeId, pair.afterId, stamp());
            return boardsResult(text(locale, BOARD_REORDERED), live);
          },
        };
      }
    }
  }

  const widgetsTool: Tool = {
    name: "dashboard.widgets",
    description: {
      sr: "Prikazuje vidžete na kontrolnoj tabli, redom, sa veličinom i podešavanjima. Koristi ga kada korisnik pita šta ima na kontrolnoj tabli ili pre nego što menja raspored. Uz `catalogue: true` navodi i vidžete koje može da doda.",
      en: "Lists the widgets on a dashboard board, in order, with their size and settings. Use it when the user asks what is on their dashboard, or before rearranging it. With `catalogue: true` it also lists the widgets that can be added.",
    },
    parameters: {
      type: "object",
      properties: {
        board: REFERENCE("The board's name or id. Omitted means the board on screen."),
        catalogue: {
          type: "boolean",
          description: "Also list the widgets that can be added to a board.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const wantCatalogue = asOptionalBoolean(args["catalogue"], "catalogue") ?? false;
        const catalogue = catalogueOf(deps.modules);
        const content = withStores(context.profileId, (stores) => {
          const scope = resolveBoard(
            stores.sets.list(),
            asOptionalText(args["board"], "board", MAX_ID_LENGTH),
            stores.sets.activeSetId(),
            context.locale,
          );
          const layout = layoutText(context.locale, scope, stores.widgets.listLayout(scope.setId), catalogue);
          return wantCatalogue ? `${layout}\n\n${catalogueText(context.locale, catalogue)}` : layout;
        });
        return okResult(content);
      }),
  };

  const arrangeTool: Tool = {
    name: "dashboard.arrange",
    description: {
      sr: "Menja kontrolnu tablu: dodaje, uklanja i menja veličinu vidžeta, podešava ih, premešta ili menja zatamnjenost pozadine. Koristi ga kada korisnik kaže da želi nešto da doda, ukloni, poveća ili pomeri na kontrolnoj tabli.",
      en: "Changes the dashboard: adds, removes or resizes a widget, configures it, moves it, or sets the background dim. Use it when the user says they want something added, removed, bigger or moved on the dashboard.",
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...ARRANGE_ACTIONS],
          description: "add, remove, size, config, move or dim.",
        },
        board: REFERENCE("The board to change, by name or id. Omitted means the board on screen. Not used by dim."),
        widget: REFERENCE("add: the widget's title or its id, as dashboard.widgets lists it."),
        instance: REFERENCE("remove, size, config, move: the placed widget's id, or its title when only one such widget is on the board."),
        size: { type: "string", enum: [...SIZES], description: "S, M or L. Defaults to M when a widget is added." },
        config: {
          type: "object",
          description: "The widget's settings, as keys and values, e.g. {\"count\": 5}. Merged into its current settings.",
        },
        before: REFERENCE("move: the widget to land just before."),
        after: REFERENCE("move: the widget to land just after."),
        dim: {
          type: "integer",
          minimum: 0,
          maximum: MAX_BACKGROUND_DIM,
          description: "How far the background image is dimmed, 0 to 90.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const action = asEnum(args["action"], "action", ARRANGE_ACTIONS);
        const catalogue = catalogueOf(deps.modules);
        const change = withStores(context.profileId, (stores) =>
          planArrange(stores, action, args, catalogue, context.locale),
        );
        const declined = await confirmOrDecline(context, "dashboard.arrange", "write", change.summary);
        if (declined !== null) return declined;
        const content = withStores(context.profileId, (stores) => change.apply(stores));
        return okResult(content, { navigateTo: DASHBOARD });
      }),
  };

  const boardsTool: Tool = {
    name: "dashboard.boards",
    description: {
      sr: "Prikazuje table kontrolne table: koja je podrazumevana i koja je trenutno otvorena. Koristi ga kada korisnik pita koje table ima ili na kojoj tabli je.",
      en: "Lists the dashboard boards: which one is the default and which one is open. Use it when the user asks which boards they have or which one they are on.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const content = withStores(context.profileId, (stores) =>
          boardsText(context.locale, stores.sets.list(), stores.sets.activeSetId()),
        );
        return okResult(content);
      }),
  };

  const boardTool: Tool = {
    name: "dashboard.board",
    description: {
      sr: "Pravi, preimenuje, briše, prikazuje i premešta table kontrolne table. Koristi ga kada korisnik traži novu tablu, drugo ime ili da obriše, otvori ili premesti tablu. Podrazumevana tabla se ne menja.",
      en: "Creates, renames, deletes, shows or reorders dashboard boards. Use it when the user asks for a new board, another name, or to delete, open or move a board. The default board cannot be changed.",
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...BOARD_ACTIONS],
          description: "create, rename, delete, activate or reorder.",
        },
        board: REFERENCE("The board, by name or id. Required except for create; for activate the default board is allowed."),
        name: NAME,
        before: REFERENCE("reorder: the board to land just before."),
        after: REFERENCE("reorder: the board to land just after."),
      },
      required: ["action"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const action = asEnum(args["action"], "action", BOARD_ACTIONS);
        const change = withStores(context.profileId, (stores) => planBoard(stores, action, args, context.locale));
        const declined = await confirmOrDecline(context, "dashboard.board", "write", change.summary);
        if (declined !== null) return declined;
        const content = withStores(context.profileId, (stores) => change.apply(stores));
        return okResult(content, { navigateTo: DASHBOARD });
      }),
  };

  return [widgetsTool, arrangeTool, boardsTool, boardTool];
}

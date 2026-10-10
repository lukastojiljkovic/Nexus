import {
  MODULE_GROUPS,
  TOOL_CATEGORIES,
  TOOL_DRAWERS,
  TOOL_PACKS,
  TOOL_RISK_CLASSES,
  TOOL_TASK_GROUPS,
  UNIT_KINDS,
  foldSearchText,
  parseWidgetConfig,
  resolveEnabled,
  toolDrawer,
  toolForbidsVerdict,
  unitsOfKind,
} from "@nexus/core";
import type { LabelText } from "@nexus/core";
// The one place a renderer file names `@nexus/db`, and it is a TEST: the
// default dashboard layout is a db constant (`DashboardWidgetStore`) whose
// entries name widgets these manifests publish, and nothing else in the build
// can see both halves of that pairing. The renderer's own code still reaches
// the database only through main's IPC allowlist.
import { DEFAULT_DASHBOARD_LAYOUT } from "@nexus/db";
import { describe, expect, it } from "vitest";

import { dashboardWidgetIds } from "./dashboardWidgets.js";
import { FILE_VIEWS } from "./filePrefs.js";
import { MODULE_SETTINGS_PANELS, settingsPanelRenderer } from "./moduleSettingsPanels.js";
import { NOTE_WIDTHS } from "./notePrefs.js";
import { BLOCKED_IN_TODAY_OPTIONS } from "./taskPrefs.js";
import { PRO_TOOL_SURFACES } from "./proToolSurfaces.js";
import { TOOL_SURFACES } from "./toolSurfaces.js";
import {
  BUSINESS_DISABLED_MODULE_IDS,
  LOCKED_MODULE_IDS,
  businessProfileFlags,
  createModuleRegistry,
} from "../../shared/modules.js";
// Aliased: this file already has three local `lookup` helpers of its own
// that take a dotted path, and the table accessor is a different thing.
import { lookup as stringFor, strings } from "./strings.js";

/**
 * `modules.ts` is the renderer's one declaration of which modules exist
 * (ADR-008). The registry itself is `@nexus/core`'s and has its own tests, so
 * what is pinned here is the DECLARATION: the v0 set, its order, and the two
 * invariants a new manifest could silently break — a duplicate id/prefix
 * (which the registry throws on, so `createModuleRegistry()` would fail at
 * import-time in the app) and a category outside the canonical list.
 */

/**
 * Whether a declared label really carries words, whichever of the two forms the
 * declaration used (`LabelText`, ADR-090): a dotted `strings` path that
 * RESOLVES to a string, or a `{ sr, en }` pair with both sentences written.
 *
 * One helper rather than two assertions per call site, because the question the
 * two forms answer is the same one — "would this draw as something a person can
 * read" — and a test that asked it one way for compiled-in modules and another
 * way for discovered ones would let the two drift.
 */
function labelCarriesWords(label: LabelText): boolean {
  if (typeof label === "string") {
    const resolved = label
      .split(".")
      .reduce<unknown>(
        (node, key) =>
          typeof node === "object" && node !== null
            ? (node as Record<string, unknown>)[key]
            : undefined,
        strings,
      );
    return typeof resolved === "string";
  }
  return label.sr.trim().length > 0 && label.en.trim().length > 0;
}

describe("createModuleRegistry", () => {
  it("registers the v0 module set in PRD numbering order", () => {
    expect(createModuleRegistry().all().map((manifest) => manifest.id)).toEqual([
      "dashboard",
      "tasks",
      "calendar",
      "settings",
      "notes",
      "priv",
      "files",
      "study",
      "finance",
      "habits",
      "fitness",
      "focus",
      "tools",
      "canvas",
      "electronics",
      "pro",
      // The first DISCOVERED module (ADR-090): a kit module registers after
      // every compiled-in one, ordered by its manifest's `order`. It is written
      // here rather than derived because this test IS the declaration — what the
      // registry holds is what the app shows.
      "timers",
      // The second DISCOVERED module (ADR-100), after Timers on its own `order`.
      "reader",
      // The second DISCOVERED module: a kit module registers after every
      // compiled-in one, ordered by its manifest's `order` - Tajmeri declares
      // 100 and Biblioteka 110.
      "library",
      // The second DISCOVERED module: `order: 120` sorts it after `timers`
      // (100), and a tie would be broken by id.
      "culture",
      // The second discovered module (ADR-090), and the first in the life
      // group: a service book for a car somebody owns.
      "car",
      // The second DISCOVERED module, after TIMERS' `order: 100`.
      "pantry",
      // And the second one, after it: the discovered modules sort by their
      // manifests' own `order` (ADR-090).
      "cookbook",
      // The second: the voice and camera diary, ordered after the first by its
      // own `order` (170 against the timer's 100).
      "recorder",
      // The second discovered module, after „Tajmeri" because its manifest says
      // `order: 180` and „Tajmeri" says 100.
      "emergency",
      // The second discovered module (CALC, migration 079), after „Tajmeri" on
      // its own `order` of 190.
      "calculator",
      // And the second, on the same terms (order 200).
      "signals",
      // The second discovered module (ADR-090), after `timers` because its
      // manifest declares a higher `order` (210 against 100).
      "miniapps",
      // The second DISCOVERED module (ADR-090), ordered by its own manifest
      // after `timers`: 320 against 100. It is the first module in the „Igra"
      // group, which existed in `MODULE_GROUPS` from ADR-093 with no member
      // until now.
      "arcade",
      // The second DISCOVERED module, ordered after the first by its own
      // `order` (ADR-090): a board game is the `play` group's first member.
      "boards",
      // The second discovered module, at `order: 350` — so it sorts above the
      // timers at 100 and below anything a later run gives a higher number.
      "chess",
    ]);
  });

  it("gives every module a unique id", () => {
    const manifests = createModuleRegistry().all();
    // The id IS load-bearing — `get(id)` is how every consumer resolves a
    // manifest — and the registry still throws on a duplicate.
    expect(new Set(manifests.map((manifest) => manifest.id)).size).toBe(manifests.length);
    for (const manifest of manifests) {
      expect(manifest.prefix, manifest.id).toMatch(/^[A-Z]+$/);
    }
  });

  /**
   * **The prefix invariant, and why it lives here rather than in the registry.**
   *
   * `ModuleRegistry` used to throw on a duplicate prefix, enforced by a
   * `byPrefix` map that nothing ever read: there is no `getByPrefix` and no
   * consumer, so the rule guaranteed only itself. What it genuinely caught is
   * worth keeping — a copy-pasted manifest whose prefix somebody forgot to
   * change — but a runtime throw could only ever say „already registered",
   * which is exactly the wrong answer when the sharing is deliberate.
   *
   * So the mapping is stated instead. A prefix is traceability to a PRD entry,
   * and ONE PRD entry can legitimately be implemented by more than one app
   * module: UTIL („Utility Belt", PRD 29) is that case — „Fokus" and „Alatke"
   * are one PRD section but two sidebar entries and two toggles, because a
   * timer and a tool drawer are separate things to reach for and separate
   * things to switch off.
   *
   * Any prefix sharing NOT written down here still fails, and the failure names
   * the modules involved rather than merely forbidding the second one.
   */
  it("maps every PRD prefix to exactly the modules meant to implement it", () => {
    const byPrefix = new Map<string, string[]>();
    for (const manifest of createModuleRegistry().all()) {
      byPrefix.set(manifest.prefix, [...(byPrefix.get(manifest.prefix) ?? []), manifest.id]);
    }
    expect(Object.fromEntries(byPrefix)).toEqual({
      DASH: ["dashboard"],
      TASK: ["tasks"],
      CAL: ["calendar"],
      SET: ["settings"],
      NOTE: ["notes"],
      PRIV: ["priv"],
      DOC: ["files"],
      STUDY: ["study"],
      FIN: ["finance"],
      HABIT: ["habits"],
      FIT: ["fitness"],
      // The one deliberate sharing — see this test's own comment. „Stručne
      // alatke" does NOT join it: PRD 30 („Profession Toolkits") is its own
      // entry, not a second reading of PRD 29 („Utility Belt"), so it takes
      // its own prefix below rather than borrowing this one.
      UTIL: ["focus", "tools", "timers", "miniapps"],
      // PRD 26 (Read Later & Bookmarks) is the section the Reader implements: its
      // bookmark half, against the content packs installed on this machine rather
      // than against a web page. Written down here rather than shared with UTIL,
      // for the reason the comment above gives.
      READ: ["reader"],
      // „Ostava" takes its own, on „Tabla"'s terms exactly: PANT is its own PRD
      // entry, and the UTIL sharing above is one section implemented twice rather
      // than a bin for anything shelf-shaped.
      PANT: ["pantry"],
      // „Kuvarica" takes its own for „Elektronika"'s reason: the cookbook is a
      // section of the product rather than a second reading of PRD 29.
      COOK: ["cookbook"],
      // PRD 21 („Health") is its own entry too, and „Hitna karta" is the first
      // module to implement it: the card's medications, allergies and conditions
      // ARE that PRD's purpose line. It borrows no other module's prefix.
      HLTH: ["emergency"],
      CANV: ["canvas"],
      // „Elektronika" takes its own for „Tabla"'s reason exactly: ELEC is its
      // own PRD entry, and the UTIL sharing above is one section implemented
      // twice rather than a bin for anything tool-shaped.
      ELEC: ["electronics"],
      // PRD 31 (Entertainment & Boosters) is the arcade's own entry, and the
      // other game modules of this wave (cards, chess, boards, puzzles) take it
      // too: one PRD section implemented as separate surfaces with separate
      // toggles, exactly as UTIL is. Each one writes its own line here.
      FUN: ["arcade"],
      PRO: ["pro"],
      // PRD 27, and the module that finally puts a member in the `culture`
      // group: `LIB` is its own PRD entry, so it is shared with nobody.
      LIB: ["library"],
      // CULTURE's own PRD entry, so it takes its own prefix rather than joining
      // one of the groups above.
      CULT: ["culture"],
      // „Automobil" (ADR-093) takes its own prefix: PRD 22 is its own entry,
      // not a second reading of another module's subject.
      CAR: ["car"],
      // The recorder takes its own prefix rather than borrowing another
      // section's: a prefix is traceability to ONE PRD entry, and the brief
      // names none for a voice and camera diary (see the module's manifest).
      REC: ["recorder"],
      // CALC is its own PRD entry, like ELEC and PRO: the calculator is a
      // calculator rather than a second reading of „Utility Belt", so it does not
      // join the UTIL sharing above.
      CALC: ["calculator"],
      // „Signali" takes a prefix of its own rather than borrowing UTIL: the
      // sharing above is one PRD section implemented three times, and Morse,
      // the ASCII table, the tuner and the sound meter are one instrument panel
      // that is not any of those three.
      SIG: ["signals"],
      // The board games module: a board game is its own subject rather than a
      // second reading of anything above, so it takes a prefix of its own.
      BOARD: ["boards"],
      // PRD 31 („Entertainment & Boosters", `docs/prd/31-entertainment.md`) is
      // the second deliberate sharing, and the same shape as UTIL: one PRD entry
      // whose games are built as separate modules, so „Šah" names FUN and the
      // next game to arrive names it too.
      FUN: ["chess"],
    });
  });

  /**
   * The modules that ship OFF, by name. PRIV and PRO are the two the compiled-in
   * set brought (ADR-057, and the professional drawer that is empty until a pack
   * is granted); `arcade` is the first from this wave, and the rest of the game
   * modules will join it - PRD 31 ships the entertainment section hidden and
   * never suggests it during onboarding. A set rather than a chain of `!==` is
   * what lets each of them add one LINE here instead of rewriting one
   * expression, which is the same reason the prefix map below is a map.
   */
  const OFF_BY_DEFAULT: ReadonlySet<string> = new Set(["priv", "pro", "arcade"]);

  it("gives every registered module a canonical group, and leaves only the opt-in modules off by default", () => {
    for (const manifest of createModuleRegistry().all()) {
      expect(MODULE_GROUPS, manifest.id).toContain(manifest.group);
      // Founder decision 2026-07-12: only BUILT modules are registered, so an
      // entry that shipped disabled would be an entry that leads nowhere.
      // Two deliberate exceptions, both built AND registered and both OFF
      // until the user asks for them — an opt-in section is not an unbuilt
      // page. PRIV is opt-in because of what it holds (ADR-057); „Stručne
      // alatke" because every tool inside it names a pack, so a profile that
      // answered no questions on the way in would open it onto an empty page
      // — the opening questionnaire's pack picker is what turns it on.
      expect(manifest.defaultEnabled, manifest.id).toBe(
        !OFF_BY_DEFAULT.has(manifest.id),
      );
    }
  });

  /**
   * Where every module sits (ADR-093), asserted ID BY ID rather than by group
   * size. The interesting half of this rule is which group each module CHOSE:
   * Učenje is Knowledge and not Life, Privatno is Life and not Knowledge, and
   * Fokus is Plan rather than the tool drawer the old category put it in — three
   * modules moved, and a size check would have allowed any of them.
   */
  it("groups the modules by navigation group in canonical order, empty groups omitted", () => {
    const grouped = createModuleRegistry().byGroup();
    expect([...grouped.keys()]).toEqual(["plan", "knowledge", "life", "culture", "make", "shell"]);
    expect(grouped.get("plan")?.map((manifest) => manifest.id)).toEqual([
      "tasks",
      "calendar",
      "habits",
      "focus",
      // The first discovered module, in the group it declares (ADR-090).
      "timers",
    ]);
    expect(grouped.get("knowledge")?.map((manifest) => manifest.id)).toEqual([
      "notes",
      "files",
      "study",
      // The second discovered module, in the group it declares (ADR-100).
      "reader",
      // The recorder is Knowledge, on ADR-093's own reading of the group: it is
      // the handling of what somebody wrote down, not an area of a life.
      "recorder",
    ]);
    expect(grouped.get("life")?.map((manifest) => manifest.id)).toEqual([
      "priv",
      "finance",
      "fitness",
      // The discovered life module (ADR-090 / ADR-093): a car is a subject
      // somebody HAS, which is what the group means.
      "car",
      // The second discovered module, in the group it declares: a pantry is an
      // AREA of a life, which is what „Život" holds (ADR-093).
      "pantry",
      // A discovered module in the group it declares (ADR-090): the cookbook
      // belongs to Life beside the pantry and the fitness log.
      "cookbook",
      // ADR-093's own table lists „Emergency card" under „Život", and the card
      // joins it after the compiled-in three.
      "emergency",
    ]);
    // The culture group's first member, and the group ADR-093 named before
    // anything was in it.
    expect(grouped.get("culture")?.map((manifest) => manifest.id)).toEqual(["library"]);
    expect(grouped.get("make")?.map((manifest) => manifest.id)).toEqual([
      "tools",
      "canvas",
      "electronics",
      "pro",
      // And the discovered module that declares this group (CALC).
      "calculator",
      // The second discovered module: an instrument panel is something built,
      // which is what „make" is for (ADR-093).
      "signals",
      // The second discovered module (ADR-090), in the group it declares.
      "miniapps",
    ]);
    // â€žKultura" is its own group (ADR-093), and the first module to fill it.
    expect(grouped.get("culture")?.map((manifest) => manifest.id)).toEqual(["culture"]);
    // „Igra" is the group the games arrive in (ADR-093), and Šah is its first
    // member: a board is what somebody does for fun, which is what the group is
    // for rather than a second drawer of tools.
    expect(grouped.get("play")?.map((manifest) => manifest.id)).toEqual(["chess"]);
    // The shell group is the two rows nothing may switch off, and the sidebar is
    // the one caller that splits it: its first member heads the rail, the rest
    // close it (`navPrefs.sidebarGroups`).
    expect(grouped.get("shell")?.map((manifest) => manifest.id)).toEqual([...LOCKED_MODULE_IDS]);
    // Play has no module yet, so it draws nothing rather than an empty heading.
    // Culture used to be in the same place, and Biblioteka is what took it out.
    expect(grouped.has("play")).toBe(false);
  });
  it("is constructed per call, never a shared singleton (ADR-008)", () => {
    const first = createModuleRegistry();
    const second = createModuleRegistry();
    expect(first).not.toBe(second);
    expect(first.all()).not.toBe(second.all());
    expect(first.all().map((manifest) => manifest.id)).toEqual(
      second.all().map((manifest) => manifest.id),
    );
  });

  it("resolves to the default-on set with no flags, and honours explicit flags both ways", () => {
    const registry = createModuleRegistry();
    // PRIV and „Stručne alatke" are absent by DEFAULT — the two modules
    // somebody has to ask for (ADR-057; and the questionnaire's pack picker).
    expect(resolveEnabled(registry, {})).toEqual([
      "dashboard",
      "tasks",
      "calendar",
      "settings",
      "notes",
      "files",
      "study",
      "finance",
      "habits",
      "fitness",
      "focus",
      "tools",
      "canvas",
      "electronics",
      // ON by default, like every module but PRIV and PRO: a timer writes
      // nothing until somebody starts one, so there is nothing to opt into.
      "timers",
      // And the Reader on the same terms (ADR-100): a shelf with no packs on it
      // writes nothing, and it is where the person learns where packs come from.
      "reader",
      // ON by default like every module but PRIV and PRO: nothing about a
      // library asks to be opted into, and the module writes nothing until a
      // first title is added.
      "library",
      // And the same is true of the culture corner: it writes nothing until a
      // visit, a plan or a file is added.
      "culture",
      // The discovered life module, on for the same reason one group over: it
      // writes nothing until somebody adds a vehicle.
      "car",
      // The same for the pantry: nothing is written until a first item is
      // recorded.
      "pantry",
      // And the cookbook, on the same terms: nothing is written until a recipe
      // is saved.
      "cookbook",
      // Likewise: a recorder writes nothing until somebody records, so there is
      // nothing to opt into either.
      "recorder",
      // ON by default as well, and for a stronger version of the same reason: a
      // module whose whole purpose is to be readable in an emergency cannot be
      // something the user has to switch on first.
      "emergency",
      // The same for the calculator: a bench that writes nothing until an
      // expression is committed.
      "calculator",
      // And the signals module, whose four tools open the microphone only when
      // one of them is started.
      "signals",
      // The second discovered module (ADR-090), ON by default for the same
      // reason: nine small tools, and not one of them writes anything until it
      // is used.
      "miniapps",
      // And the second discovered module, ON by default for its own version of
      // that reason: a board game writes nothing until somebody plays one.
      "boards",
      // ...and the same for a board: no game exists until somebody starts one.
      "chess",
    ]);
    expect(resolveEnabled(registry, { study: false })).not.toContain("study");
    expect(resolveEnabled(registry, { priv: true })).toContain("priv");
    expect(resolveEnabled(registry, { pro: true })).toContain("pro");
  });

  it("keeps PRIV free of every render-while-locked surface: no widgets, no search indexers", () => {
    const registry = createModuleRegistry();
    // While the section is locked NOTHING of it may render anywhere (ADR-057):
    // a widget contract or a search indexer would be exactly such a surface.
    expect(registry.widgetsOf("priv")).toEqual([]);
    expect(registry.all().find((manifest) => manifest.id === "priv")?.searchIndexers).toBeUndefined();
  });

  it("keeps DOC out of the palette, and gives it the one card ADR-086 argued for", () => {
    const registry = createModuleRegistry();
    // An attachment's file name already rides its owning row's indexed body
    // (migrations 025/048). An indexer here would put every file into the
    // palette a second time, competing with the note that carries it — see the
    // manifest's own comment. „Datoteke" is where you browse files; the palette
    // is where you find the thing they belong to.
    expect(registry.all().find((manifest) => manifest.id === "files")?.searchIndexers).toBeUndefined();
    // The widget half of that pair was ALSO a decision, and ADR-086 reversed
    // it — so this asserts the new one rather than being deleted: exactly one
    // card, and it is the recent-files list the manifest now argues for.
    expect(registry.widgetsOf("files").map((widget) => widget.id)).toEqual(["nedavno"]);
  });

  /**
   * The other three reversals of the same rule („a dashboard card draws a FACT
   * about the profile"), asserted together because they are one decision. Each
   * module publishes exactly ONE card and it is the one its manifest names — a
   * second card appearing here means somebody added one without arguing it.
   */
  it("gives CANV, ELEC and PRO the one card each that ADR-086 argued for", () => {
    const registry = createModuleRegistry();
    expect(registry.widgetsOf("canvas").map((widget) => widget.id)).toEqual(["table"]);
    expect(registry.widgetsOf("electronics").map((widget) => widget.id)).toEqual(["kola"]);
    expect(registry.widgetsOf("pro").map((widget) => widget.id)).toEqual(["paketi"]);
  });

  /**
   * And the one that was NOT reversed, which is the half that keeps the rule a
   * rule. „Alatke" holds nothing a user wrote: its „Nedavno" is a fact about
   * this DEVICE, so a card of it would be the home screen reporting on the
   * machine rather than on the person — and it would be the drawer's own rail,
   * drawn twice on one screen.
   */
  it("still keeps UTIL's drawer off the dashboard", () => {
    expect(createModuleRegistry().widgetsOf("tools")).toEqual([]);
  });

  it("keeps HABIT's searchIndexer slot empty while slice c fills the other two", () => {
    const registry = createModuleRegistry();
    const habits = registry.all().find((manifest) => manifest.id === "habits");
    // No indexer, and not merely „not yet": a habit is a name and a schedule,
    // with no body to match and nothing a query would find that the sidebar does
    // not already show.
    expect(habits?.searchIndexers).toBeUndefined();
    // The other two arrived in slice c, each once it had something true to say:
    // the „Navike danas" card is worth drawing because it is TICKABLE, and the
    // settings card is worth offering because `reminder_time` finally does
    // something (migration 056).
    expect(registry.widgetsOf("habits").map((widget) => widget.id)).toEqual(["danas"]);
    expect(habits?.settings?.controls.map((control) => control.key)).toEqual([
      "default-reminder",
    ]);
  });

  it("gives the habits card no config, on the study streak card's reasoning rather than for want of a field", () => {
    const registry = createModuleRegistry();
    const [danas] = registry.widgetsOf("habits");
    // A row cap is the obvious knob and the wrong one: every other capped card
    // picks the front of a queue that can run to hundreds, while this card draws
    // what today ASKS FOR — so a cap would hide an expectation, which is the one
    // thing the card exists to state.
    expect(danas?.configFields).toBeUndefined();
    // Capped at M for „nedavno"'s reason: a row is a name, a tick and one chip.
    expect(danas?.sizes).toEqual(["S", "M"]);
    expect(danas?.deepLink).toBe("habits");
  });

  it("keeps UTIL's searchIndexer slot empty while slice b fills the other two", () => {
    const registry = createModuleRegistry();
    const focus = registry.all().find((manifest) => manifest.id === "focus");
    // No indexer, and not merely „not yet": a phase is a span of time with at
    // most a BORROWED label, and the thing worth finding — the task or the
    // subject it was attached to — is already indexed by the module that owns
    // it. A second, weaker row would only compete with it.
    expect(focus?.searchIndexers).toBeUndefined();
    expect(registry.widgetsOf("focus").map((widget) => widget.id)).toEqual(["fokus"]);
    // The Pomodoro shape IS four numbers; collapsing them into presets would be
    // inventing a curated list exactly as FIN refused to for ISO-4217.
    expect(focus?.settings?.controls.map((control) => control.key)).toEqual([
      "work-minutes",
      "short-break-minutes",
      "long-break-minutes",
      "cycles",
    ]);
  });

  it("gives the focus card no config either — there is no list here to cap or narrow", () => {
    const registry = createModuleRegistry();
    const [fokus] = registry.widgetsOf("focus");
    // Every knob the other cards carry narrows a LIST. This card draws no list:
    // one running phase, or one figure. There is nothing to cap.
    expect(fokus?.configFields).toBeUndefined();
    expect(fokus?.sizes).toEqual(["S", "M"]);
    expect(fokus?.deepLink).toBe("focus");
  });

  it("keeps FIT's searchIndexer slot empty while slice b fills the other two", () => {
    const registry = createModuleRegistry();
    const fitness = registry.all().find((manifest) => manifest.id === "fitness");
    // No indexer, and not merely „not yet": the catalogue is APP-shipped data
    // (migration 058), so indexing it would put four hundred rows nobody wrote
    // into the palette — and a user's own food is a name and seven numbers,
    // with no body to match and nothing a query would find that the page does
    // not already show.
    expect(fitness?.searchIndexers).toBeUndefined();
    // Two cards from slice d on: the day's calories, and the week's training.
    expect(registry.widgetsOf("fitness").map((widget) => widget.id)).toEqual(["danas", "trening"]);
    // Four goals, and no fifth: `fit_targets` holds exactly these (migration
    // 058), so a control for fibre would edit a column that does not exist.
    expect(fitness?.settings?.controls.map((control) => control.key)).toEqual([
      "kcal-goal",
      "protein-goal",
      "carbs-goal",
      "fat-goal",
    ]);
  });

  it("gives neither fitness card any config, and keeps both out of the default layout", () => {
    const registry = createModuleRegistry();
    for (const card of registry.widgetsOf("fitness")) {
      // „Fokus"'s reasoning exactly: every knob narrows a LIST, and neither of
      // these draws one — the first is a figure and a track, the second is two
      // facts about the week.
      expect(card.configFields, card.id).toBeUndefined();
      expect(card.sizes, card.id).toEqual(["S", "M"]);
      expect(card.deepLink, card.id).toBe("fitness");
      // Gallery-only, like every card added after the original five (DASH-003).
      expect(DEFAULT_DASHBOARD_LAYOUT.map((entry) => entry.widgetId)).not.toContain(
        `fitness:${card.id}`,
      );
    }
  });
});

describe("the settings each v0 module publishes (SettingsPanel)", () => {
  const registry = createModuleRegistry();
  const declared = registry.all().flatMap((manifest) =>
    manifest.settings ? [[manifest.id, manifest.settings] as const] : [],
  );
  const lookup = (path: string): unknown =>
    path
      .split(".")
      .reduce<unknown>(
        (node, key) =>
          typeof node === "object" && node !== null
            ? (node as Record<string, unknown>)[key]
            : undefined,
        strings,
      );

  it("declares a card for exactly the modules that have one, and none for SET itself", () => {
    // „Podešavanja" hand-composes the shell's cards; a settings card inside
    // Settings would be a mirror facing a mirror. CANV is absent for a
    // different reason and deliberately: „Tabla" has nothing to prefer yet, and
    // a card with one checkbox for the sake of having a card is padding.
    expect(declared.map(([moduleId]) => moduleId)).toEqual([
      "dashboard",
      "tasks",
      "calendar",
      "notes",
      "priv",
      "files",
      "study",
      "finance",
      "habits",
      "fitness",
      "focus",
      "tools",
      // The first DISCOVERED card (ADR-090): declared in the module's own
      // manifest and drawn by its own body, with no line in this file's map.
      "timers",
      "culture",
      // The discovered card: the two thresholds, declared in the module's own
      // manifest and drawn by its own body.
      "car",
      // The second, on the same terms.
      "pantry",
      "cookbook",
      // And the second discovered card, on the same terms: declared in the
      // recorder's own manifest, drawn by its own body.
      "recorder",
      // The second, on the same terms: `calc_settings` holds the two rows and the
      // module's own `renderer/Settings.tsx` draws them.
      "calculator",
      "signals",
      // The second, whose one preference is the level a new game opens at.
      "boards",
    ]);
  });

  it("pairs every declaration with a renderer, and every renderer with a declaration", () => {
    // The pairing the page rests on, exactly as `DASHBOARD_WIDGETS` does: a
    // declaration with no renderer is an empty card, a renderer with no
    // declaration is a card the page never asks for. Neither fails loudly in
    // the app, which is why it is pinned here.
    // THE KIT CHANGES THE HALF THIS ASKS ABOUT (ADR-090). A compiled-in module's
    // body is listed in `MODULE_SETTINGS_PANELS`; a DISCOVERED module's is
    // discovered beside it (`moduleKit/settings.ts`), because listing it is the
    // edit the kit exists to remove. So the pairing is asked through
    // `settingsPanelRenderer` — the function `SettingsPage` itself calls, so
    // this pins the real question rather than one half of it — and the reverse
    // direction is still asked against the compiled-in map, which must not hold
    // a body no declaration names.
    const declaredIds = declared.map(([moduleId]) => moduleId);
    for (const moduleId of declaredIds) {
      expect(settingsPanelRenderer(moduleId), moduleId).toBeDefined();
    }
    for (const moduleId of Object.keys(MODULE_SETTINGS_PANELS)) {
      expect(declaredIds, moduleId).toContain(moduleId);
    }
  });

  it("names a string that really exists for every card title and every control label", () => {
    for (const [moduleId, panel] of declared) {
      expect(labelCarriesWords(panel.titleKey), JSON.stringify(panel.titleKey)).toBe(true);
      // A compiled-in module's card IS its own section, so its title is the very
      // heading `strings.settings.sectionTitle` already carries for it. A
      // DISCOVERED module (ADR-090) carries its own `{ sr, en }` pair instead —
      // its page copy is not in the startup chunk, so the shell has no heading of
      // its own to compare against — and the equality is asked only where a
      // dotted path was declared.
      if (typeof panel.titleKey === "string") {
        expect(lookup(panel.titleKey), moduleId).toBe(
          strings.settings.sectionTitle[moduleId as keyof typeof strings.settings.sectionTitle],
        );
      }
      for (const control of panel.controls) {
        expect(labelCarriesWords(control.labelKey), JSON.stringify(control.labelKey)).toBe(true);
        if (control.kind === "choice") {
          for (const option of control.options) {
            expect(labelCarriesWords(option.labelKey), JSON.stringify(option.labelKey)).toBe(true);
          }
        }
      }
    }
  });

  it("keeps every control key an ASCII slug, unique within its panel", () => {
    for (const [moduleId, panel] of declared) {
      const keys = panel.controls.map((control) => control.key);
      expect(new Set(keys).size, moduleId).toBe(keys.length);
      for (const key of keys) {
        // A key is qualified into `moduleId:key` as a filter entry id, so it is
        // a key and never a label — no diacritics and no colon of its own.
        expect(key, moduleId).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      }
    }
  });

  it("gives every stored control a storage, and every fact none", () => {
    for (const [moduleId, panel] of declared) {
      for (const control of panel.controls) {
        if (control.kind === "fact") continue;
        expect(["device", "profile"], `${moduleId}:${control.key}`).toContain(control.storage);
      }
    }
  });

  it("declares choice options that are exactly the value sets their panels render", () => {
    // The one place a declaration could silently drift from the control it
    // describes: the option ids ARE the preference module's own value sets.
    const optionIds = (moduleId: string, key: string) => {
      const control = declared
        .find(([id]) => id === moduleId)?.[1]
        .controls.find((candidate) => candidate.key === key);
      return control?.kind === "choice" ? control.options.map((option) => option.id) : undefined;
    };
    expect(optionIds("tasks", "blocked-today")).toEqual([...BLOCKED_IN_TODAY_OPTIONS]);
    expect(optionIds("notes", "width")).toEqual([...NOTE_WIDTHS]);
    expect(optionIds("files", "view")).toEqual([...FILE_VIEWS]);
  });

  it("keeps every card's storage honest: the six device cards, and five the profile owns", () => {
    const storages = (moduleId: string) =>
      new Set(
        declared
          .find(([id]) => id === moduleId)?.[1]
          .controls.flatMap((control) => (control.kind === "fact" ? [] : [control.storage])),
      );
    expect(storages("tasks")).toEqual(new Set(["device"]));
    expect(storages("notes")).toEqual(new Set(["device"]));
    // FIN's one control decides which currency code the „Novi račun" form opens
    // on — a fact about this machine's form, never about the profile's money,
    // which lives on each account instead.
    expect(storages("finance")).toEqual(new Set(["device"]));
    // DOC's one control decides the shape „Datoteke" opens in on THIS machine.
    // It stores nothing about the profile — and the module writes nothing at
    // all, which is why this is the only preference it has.
    expect(storages("files")).toEqual(new Set(["device"]));
    // HABIT's one control decides which hour the form FILLS IN when a reminder
    // is switched on — a fact about this machine's form, never about the
    // profile's habits, whose reminders live on their own rows.
    expect(storages("habits")).toEqual(new Set(["device"]));
    // UTIL's four say how long the NEXT phase is planned for and nothing else —
    // a finished phase records its own `planned_minutes`, so changing them
    // restates nothing about yesterday, which is exactly what made
    // `study_settings` a profile row and makes these not.
    expect(storages("focus")).toEqual(new Set(["device"]));
    // „Alatke"'s one control says which rate the PDV field OPENS on — never
    // what any figure is computed at, since every result names the rate it
    // used. The module stores nothing else anywhere: a converter is arithmetic,
    // not data.
    expect(storages("tools")).toEqual(new Set(["device"]));
    expect(storages("dashboard")).toEqual(new Set(["profile"]));
    expect(storages("study")).toEqual(new Set(["profile"]));
    expect(storages("calendar")).toEqual(new Set(["profile"]));
    expect(storages("priv")).toEqual(new Set(["profile"]));
    // FIT's four are a PROFILE row (`fit_targets`, migration 058) and travel in
    // every export — unlike HABIT's and UTIL's, which describe this machine's
    // forms. Which is also why this is the one module card with no „Vrati na
    // podrazumevano": there is no default to go back to, and a reset would be a
    // write about somebody's own data.
    expect(storages("fitness")).toEqual(new Set(["profile"]));
    // OSTAVA's one control is the window „ističe uskoro" reaches, and MAIN reads
    // it while firing the module's own reminder with no page open at all — so it
    // is a row about the profile's shelves and travels in the profile's archive.
    expect(storages("pantry")).toEqual(new Set(["profile"]));
  });
});

describe("the widgets the v0 modules publish (ADR-045)", () => {
  it("publishes today's dashboard cards, each owned by the module it opens", () => {
    const registry = createModuleRegistry();
    expect(registry.widgetsOf("calendar").map((widget) => widget.id)).toEqual([
      "danas",
      "isticanja",
    ]);
    expect(registry.widgetsOf("tasks").map((widget) => widget.id)).toEqual([
      "predstojece",
      "hitno-kasni",
    ]);
    expect(registry.widgetsOf("study").map((widget) => widget.id)).toEqual(["ispiti", "ucenje"]);
    expect(registry.widgetsOf("notes").map((widget) => widget.id)).toEqual(["nedavno"]);
    // The catalogue is bigger than the default layout (DASH-003): the two
    // additions are gallery-only, and `DEFAULT_DASHBOARD_LAYOUT` still holds
    // exactly the original five.
    expect(DEFAULT_DASHBOARD_LAYOUT.map((entry) => entry.widgetId)).not.toContain(
      "tasks:hitno-kasni",
    );
    expect(DEFAULT_DASHBOARD_LAYOUT.map((entry) => entry.widgetId)).not.toContain("notes:nedavno");
  });

  it("pairs every registered widget with a renderer, and every renderer with a contract", () => {
    // The pairing ADR-045 section 3 rests on. A registered widget with no
    // renderer is one „Dodaj vidžet“ silently withholds; a renderer with no
    // contract is a card that can never be placed. Neither fails loudly in the
    // app, which is exactly why it is pinned here.
    const registry = createModuleRegistry();
    const qualified = registry
      .all()
      .flatMap((manifest) =>
        registry.widgetsOf(manifest.id).map((widget) => `${manifest.id}:${widget.id}`),
      );
    // Both halves come from the same discovery now (ADR-090): a compiled-in
    // widget is in `DASHBOARD_WIDGETS`, a discovered one in its module's own
    // `renderer/Widgets.tsx`, and `dashboardWidgetIds` is the union — which is
    // what the page itself draws from. A registered widget with no renderer is
    // still a card the gallery would offer and the page could not draw.
    expect([...qualified].sort()).toEqual([...dashboardWidgetIds()].sort());
  });

  it("resolves every widget of the DEFAULT layout — a new profile must not open onto blanks", () => {
    const registry = createModuleRegistry();
    for (const entry of DEFAULT_DASHBOARD_LAYOUT) {
      const widget = registry.findWidget(entry.widgetId);
      expect(widget, entry.widgetId).toBeDefined();
      // A default placement must also be a size its widget actually accepts.
      expect(widget?.sizes, entry.widgetId).toContain(entry.size);
    }
  });

  it("keeps every widget id an ASCII slug and every deep link a registered module", () => {
    const registry = createModuleRegistry();
    const moduleIds = new Set(registry.all().map((manifest) => manifest.id));
    for (const manifest of registry.all()) {
      for (const widget of registry.widgetsOf(manifest.id)) {
        // An id ends up in `dashboard_widgets.widget_id` as `moduleId:widgetId`;
        // it is a key, never a label, so no diacritics and no colon of its own.
        expect(widget.id, widget.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(moduleIds, widget.id).toContain(widget.deepLink);
        expect(widget.sizes.length, widget.id).toBeGreaterThan(0);
        // `title` is a strings KEY path, not Serbian copy (WidgetContract) — or,
        // for a discovered module, its own `{ sr, en }` pair (ADR-090), which is
        // the one form whose words live in the module's own folder.
        if (typeof widget.title === "string") {
          expect(widget.title, widget.id).toMatch(/^[a-zA-Z]+(?:\.[a-zA-Z]+)+$/);
        }
      }
    }
  });

  it("names a string that really exists for every widget title", () => {
    // The convention is only worth anything if the label carries words — a
    // dotted path that resolves, or a discovered module's own pair (ADR-090). A
    // title that carried neither would render as the raw path on the card.
    const registry = createModuleRegistry();
    for (const manifest of registry.all()) {
      for (const widget of registry.widgetsOf(manifest.id)) {
        expect(labelCarriesWords(widget.title), JSON.stringify(widget.title)).toBe(true);
      }
    }
  });
});

describe("the per-widget configuration declarations (DASH-004 / ADR-059)", () => {
  const registry = createModuleRegistry();
  const contractOf = (qualified: string) => {
    const contract = registry.findWidget(qualified);
    expect(contract, qualified).toBeDefined();
    return contract!;
  };
  const lookup = (path: string): unknown =>
    path
      .split(".")
      .reduce<unknown>(
        (node, key) =>
          typeof node === "object" && node !== null
            ? (node as Record<string, unknown>)[key]
            : undefined,
        strings,
      );

  it("declares exactly the decided v1 fields, widget by widget", () => {
    const shape = (qualified: string) =>
      (contractOf(qualified).configFields ?? []).map((field) => `${field.kind}:${field.key}`);
    expect(shape("tasks:predstojece")).toEqual(["count:count", "choice:period", "taskLists:lists"]);
    expect(shape("tasks:hitno-kasni")).toEqual(["count:count"]);
    expect(shape("calendar:danas")).toEqual(["count:count"]);
    expect(shape("calendar:isticanja")).toEqual(["choice:horizon"]);
    expect(shape("notes:nedavno")).toEqual(["count:count"]);
    // Both knobs, the way `finance:naplate` pairs them. The cap was a literal
    // `.slice(0, 5)` in the card's render that this contract never declared, so
    // „Podesi…" could offer the horizon and not the number of rows.
    expect(shape("study:ispiti")).toEqual(["count:count", "choice:horizon"]);
    // „Učenje" declares NOTHING — the affordance appears only where a choice exists.
    expect(contractOf("study:ucenje").configFields).toBeUndefined();
  });

  it("pins every default to TODAY'S behaviour — an absent config renders the widget exactly as it ships", () => {
    expect(parseWidgetConfig(contractOf("tasks:predstojece"), null)).toEqual({
      count: 5, // the card's shipped `.slice(0, 5)`
      period: "svi", // shipped with NO period window
      lists: [], // empty selection = every list
    });
    expect(parseWidgetConfig(contractOf("tasks:hitno-kasni"), null)).toEqual({ count: 5 });
    // „Danas" ships UNCAPPED, so its unconfigured cap is infinite — a value the
    // strict writer refuses, so it can never be anything but the default.
    expect(parseWidgetConfig(contractOf("calendar:danas"), null)).toEqual({
      count: Number.POSITIVE_INFINITY,
    });
    // „Isticanja" ships on each document's own reminder ladder, not a window.
    expect(parseWidgetConfig(contractOf("calendar:isticanja"), null)).toEqual({ horizon: "prag" });
    expect(parseWidgetConfig(contractOf("notes:nedavno"), null)).toEqual({ count: 5 });
    // „Ispiti" ships showing every upcoming exam, five rows of it — the default
    // is the literal the card used to carry, so an unconfigured card is
    // pixel-identical to what it rendered before the knob existed.
    expect(parseWidgetConfig(contractOf("study:ispiti"), null)).toEqual({
      count: 5,
      horizon: "svi",
    });
  });

  it("keeps every declaration well-formed: slug keys and ids, sane ranges, defaults inside their domains", () => {
    for (const manifest of registry.all()) {
      for (const widget of registry.widgetsOf(manifest.id)) {
        const fields = widget.configFields ?? [];
        const keys = fields.map((field) => field.key);
        expect(new Set(keys).size, widget.id).toBe(keys.length);
        for (const field of fields) {
          expect(field.key, widget.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
          if (field.kind === "count") {
            expect(Number.isInteger(field.min) && Number.isInteger(field.max), widget.id).toBe(true);
            expect(field.min, widget.id).toBeLessThanOrEqual(field.max);
            // A count default is an integer in range, or the documented
            // "uncapped" infinity — never anything else.
            expect(
              (Number.isInteger(field.default) &&
                field.default >= field.min &&
                field.default <= field.max) ||
                field.default === Number.POSITIVE_INFINITY,
              widget.id,
            ).toBe(true);
          }
          if (field.kind === "choice") {
            const ids = field.options.map((option) => option.id);
            expect(new Set(ids).size, widget.id).toBe(ids.length);
            expect(ids, widget.id).toContain(field.default);
            for (const id of ids) expect(id, widget.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
          }
        }
      }
    }
  });

  it("resolves every field label and every option label to a real string", () => {
    for (const manifest of registry.all()) {
      for (const widget of registry.widgetsOf(manifest.id)) {
        for (const field of widget.configFields ?? []) {
          expect(typeof lookup(`dashboard.config.fields.${field.key}`), field.key).toBe("string");
          if (field.kind === "choice") {
            for (const option of field.options) {
              expect(labelCarriesWords(option.labelKey), JSON.stringify(option.labelKey)).toBe(
                true,
              );
            }
          }
        }
      }
    }
  });
});

/**
 * UTIL slice c and PRO (UTIL slice d): the tools the registry publishes
 * (`ToolRegistration`), and the pairing both drawers rest on.
 *
 * Each drawer is a HOST — it collects `manifest.tools` across the registry and
 * renders whatever it finds — so neither has a list of tools of its own and no
 * `switch`. That is only safe if the two halves agree, which is what these
 * pin: a declaration with no surface is a row that opens onto nothing, a
 * surface with no declaration is a tool nobody can reach. Neither fails loudly
 * in the app.
 */
describe("the tools the registry publishes (PRD 29 UTIL, PRD 30 PRO)", () => {
  const registry = createModuleRegistry();
  const declared = registry.all().flatMap((manifest) => manifest.tools ?? []);
  const lookup = (path: string): unknown =>
    path
      .split(".")
      .reduce<unknown>(
        (node, key) =>
          typeof node === "object" && node !== null
            ? (node as Record<string, unknown>)[key]
            : undefined,
        strings,
      );

  it("publishes „Alatke“'s eleven tools, in the order the rail lists them", () => {
    expect(registry.get("tools")?.tools?.map((tool) => tool.id)).toEqual([
      "duzina",
      "masa",
      "zapremina",
      "temperatura",
      "povrsina",
      "brzina",
      "podaci",
      "procenat",
      "pdv",
      "kredit",
      "jedinicna-cena",
    ]);
  });

  /**
   * TWO modules publish tools, and no third does — which is a fact about today
   * rather than a rule. The drawer reads the whole registry, so the day NOTE
   * contributes a Markdown table builder it appears without either drawer being
   * edited; this pins that nothing has done so silently yet.
   *
   * What routes a tool to ITS drawer is `packs` — through `toolDrawer`, never
   * through which module declared it and never through `category` (`category`
   * only says what the rail groups it under, per `TOOL_CATEGORIES`'s own
   * comment). „Alatke" is the everyday case: no tool there may name a pack at
   * all. „Stručne alatke" is the inverse, and an EMPTY `packs` array is
   * deliberately as wrong as a missing one — it would declare a professional
   * tool no profession can ever switch on, a tool that ships and is
   * unreachable (`ToolRegistration.packs`'s own comment). `toBeGreaterThan(0)`
   * below is what makes that failure mode fail loudly here rather than in the
   * app.
   */
  it("has exactly the two tool-publishing modules, and every tool's packs put it in the right drawer", () => {
    expect(
      registry
        .all()
        .filter((manifest) => manifest.tools !== undefined)
        .map((manifest) => manifest.id),
    ).toEqual(["tools", "pro"]);
    for (const tool of registry.get("tools")?.tools ?? []) {
      expect(tool.packs, tool.id).toBeUndefined();
      expect(toolDrawer(tool), tool.id).toBe("utilities");
    }
    for (const tool of registry.get("pro")?.tools ?? []) {
      expect(Array.isArray(tool.packs), tool.id).toBe(true);
      // The empty-array case this comment argues against — a `packs: []` tool
      // must fail exactly this line.
      expect(tool.packs?.length ?? 0, tool.id).toBeGreaterThan(0);
      for (const pack of tool.packs ?? []) {
        expect(TOOL_PACKS, `${tool.id}:${pack}`).toContain(pack);
      }
      expect(toolDrawer(tool), tool.id).toBe("professional");
    }
  });

  /**
   * There is NO currency converter, and this pins its absence on purpose.
   *
   * Nexus does not convert money between currencies (founder decision): each
   * currency is tracked on its own terms, because a rate an offline app cannot
   * verify is a number that silently misstates money — which is why FIN holds
   * no rate at all and tells the user „Nexus nema kurs". This is a settled
   * product decision, not an unbuilt slice, so there is no placeholder, no
   * disabled entry and no seam awaiting one.
   */
  it("publishes no currency tool, and the conversions are all of physical quantities", () => {
    // `deviz`, not `devi`: the stem is „devizni/devize", and `devi` also matches
    // „deviation" — which refused `speedometer-tyre-deviation`, a tool about a
    // tyre's rolling circumference and nothing to do with money. A guard that
    // refuses the correct thing gets switched off by whoever it obstructs
    // (DC-15), so it is made precise here rather than loosened.
    const CURRENCY = /valut|kurs|currency|deviz/i;
    for (const tool of declared) {
      expect(tool.id, tool.id).not.toMatch(CURRENCY);
    }
    expect(declared.map((tool) => tool.id)).not.toContain("valuta");
    // Proved on what it must still refuse, and on what it must let through.
    for (const refused of ["valuta", "kurs-valuta", "devizni-kurs", "currency-convert"]) {
      expect(refused, refused).toMatch(CURRENCY);
    }
    for (const allowed of ["speedometer-tyre-deviation", "standard-score", "delta-e"]) {
      expect(allowed, allowed).not.toMatch(CURRENCY);
    }
  });

  it("splits the tools between the two surface maps exactly along `toolDrawer`, with no id in both", () => {
    // A declaration with no surface is a row that opens onto nothing; a
    // surface with no declaration is a tool nobody can reach — and the two
    // maps are separate files only so that the professional drawer's
    // forty-eight-plus surfaces do not live in one unreadable module.
    const utilities = declared
      .filter((tool) => toolDrawer(tool) === "utilities")
      .map((tool) => tool.id)
      .sort();
    const professional = declared
      .filter((tool) => toolDrawer(tool) === "professional")
      .map((tool) => tool.id)
      .sort();
    expect(Object.keys(TOOL_SURFACES).sort()).toEqual(utilities);
    expect(Object.keys(PRO_TOOL_SURFACES).sort()).toEqual(professional);
    // ...and the two maps do not overlap: a surface named in both would be
    // drawn by whichever drawer asked first, which is not a decision anybody
    // would have made on purpose.
    for (const id of Object.keys(PRO_TOOL_SURFACES)) {
      expect(TOOL_SURFACES, id).not.toHaveProperty(id);
    }
  });

  it("keeps every tool id an ASCII slug, unique across the registry", () => {
    const ids = declared.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  /**
   * ...and no two tools in a drawer wear one NAME.
   *
   * The test above is the one anybody writes, because identity in
   * `ToolRegistration` IS the `id`: two ids are two tools by construction, so
   * nothing ever asked what a tool is CALLED. „Stručne alatke" shipped four
   * tools twice under four shared names — the same specification implemented
   * once under `pravo` and once under `racunovodstvo`, each pair listed
   * together by at least three toolkits (DC-75). Nothing failed. The rail drew
   * both rows, the search returned both, and the only instrument that noticed
   * was the screenshot sweep — which names a frame after the row's label, and
   * so wrote two of its frames into one file.
   *
   * The rule is per DRAWER, which is stricter than what a single profile sees
   * and is meant to be: a profile may switch on every toolkit, so for anybody
   * who does, „unique within a pack" and „unique within the drawer" are the
   * same question — and the demo profile, the sweep and the pack editor all
   * reach that state. It does not reach ACROSS the two drawers: „Alatke" and
   * „Stručne alatke" are two surfaces and never one list.
   */
  it("gives no two tools in one drawer the same name", () => {
    for (const drawer of TOOL_DRAWERS) {
      const byName = new Map<string, string[]>();
      for (const tool of declared) {
        if (toolDrawer(tool) !== drawer) continue;
        // A `titleKey` resolving to nothing is the previous test's business.
        // Skipped here so that two unresolved keys are not reported as two
        // tools sharing a name — which would name the wrong defect.
        const name = lookup(tool.titleKey);
        if (typeof name !== "string") continue;
        byName.set(name, [...(byName.get(name) ?? []), tool.id]);
      }
      expect(
        [...byName].filter(([, ids]) => ids.length > 1).map(([n, ids]) => `${n}: ${ids.join(" + ")}`),
        drawer,
      ).toEqual([]);
    }
  });

  it("names a real string for every tool title and declared blurb, and a canonical, labelled category", () => {
    for (const tool of declared) {
      // `titleKey` is a strings KEY path, not Serbian copy (`ToolRegistration`).
      // Digits belong in a segment: half the professional drawer is named
      // after things that are spelled with them — „base64", „fp8-e4m3",
      // „sha256" — and a key is derived from the tool's id, which carries them.
      expect(tool.titleKey, tool.id).toMatch(/^[a-zA-Z]+(?:\.[a-zA-Z0-9-]+)+$/);
      expect(typeof lookup(tool.titleKey), tool.titleKey).toBe("string");
      // `blurbKey` is optional (only „Stručne alatke" carries one), but a
      // declared one must resolve exactly as a `titleKey` does.
      if (tool.blurbKey !== undefined) {
        expect(typeof lookup(tool.blurbKey), tool.blurbKey).toBe("string");
      }
      expect(TOOL_CATEGORIES, tool.id).toContain(tool.category);
      // A category with no Serbian label would render its raw id in the rail.
      expect(typeof strings.tools.category[tool.category], tool.id).toBe("string");
    }
  });

  /**
   * Every tool is filed where somebody can find it by NEED (C10a), which is a
   * third axis beside the pack and the category: `taskGroups` answers „what did
   * you come here to do", and a tool under none of them can only be reached by
   * somebody who already knew its toolkit.
   *
   * The requirement makes an empty list unrepresentable, and the compiler cannot
   * state the other half: that the ids are real, that two is the cap, and that a
   * tool filed under five of eight headings has told the reader nothing about
   * where to look.
   */
  it("files every tool under one or two of the eight task groups", () => {
    for (const tool of declared) {
      expect(tool.taskGroups.length, tool.id).toBeGreaterThan(0);
      expect(tool.taskGroups.length, tool.id).toBeLessThanOrEqual(2);
      for (const group of tool.taskGroups) {
        expect(TOOL_TASK_GROUPS, `${tool.id}:${group}`).toContain(group);
      }
    }
  });

  /**
   * A keyword must be its OWN folding — which is the property the drawer's
   * search actually rests on, and which this test used to approximate with the
   * character class `[a-z0-9 ]`.
   *
   * The approximation was wrong in one direction that matters: it excluded the
   * hyphen, and the developer drawer is full of names that carry one. Under the
   * old rule „risc-v" had to be written „risc v", which does not match the query
   * a person actually types — `foldSearchText` keeps hyphens, so the needle
   * „risc-v" would never be found in the keyword „risc v". Stating the invariant
   * instead of a spelling makes the rule true for every alphabet the folding
   * handles rather than for the Latin subset somebody happened to think of.
   */
  it("gives every tool keywords that are their own folding — they are search keys, never labels", () => {
    for (const tool of declared) {
      for (const keyword of tool.keywords ?? []) {
        expect(foldSearchText(keyword), `${tool.id}:${keyword}`).toBe(keyword);
        // No padding either: a keyword the field could never produce is dead.
        expect(keyword.trim(), tool.id).toBe(keyword);
        expect(keyword.length, tool.id).toBeGreaterThan(0);
      }
    }
  });

  it("names a unit string for every unit the converters can offer", () => {
    // A missing name would render the raw id in a dropdown — the one place the
    // drawer would look unfinished.
    for (const kind of UNIT_KINDS) {
      for (const unit of unitsOfKind(kind)) {
        expect(typeof stringFor(strings.tools.unit, unit.id), unit.id).toBe("string");
      }
    }
  });

  /**
   * The disclaimers, as invariants rather than as a habit.
   *
   * `riskClass` is a required field, so TypeScript already refuses a tool that
   * declares none. What it cannot see is the half that matters: that the class
   * a tool declares has Serbian copy behind it, and that a tool whose ANSWER can
   * hurt somebody did not quietly ship as `"none"` because its author was
   * thinking about the arithmetic rather than about the site.
   */
  it("gives every tool a known risk class, and every class the four pieces of copy it renders", () => {
    for (const tool of declared) {
      expect(TOOL_RISK_CLASSES, tool.id).toContain(tool.riskClass);
    }
    for (const riskClass of TOOL_RISK_CLASSES) {
      if (riskClass === "none") {
        // The one class with no copy, because it draws nothing. An entry here
        // would be a notice waiting for somebody to render it by mistake.
        expect(strings.pro.risk).not.toHaveProperty(riskClass);
        continue;
      }
      const copy = strings.pro.risk[riskClass];
      // `line` is the summary, `note` the long form behind it, `export` the
      // line that leaves with a copied result, `label` the Settings heading.
      for (const key of ["label", "line", "note", "export"] as const) {
        expect(typeof copy[key], `${riskClass}.${key}`).toBe("string");
        expect(copy[key].length, `${riskClass}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The rule that keeps „forgot the notice" from being expressible.
   *
   * A category is what a tool DOES, and three of them describe doing something
   * whose failure mode is not the user's own time: `structure` asks what an
   * assembly can carry, `electrical` asks what a conductor can pass, and both
   * end with a third party under the thing that failed. `body` is a person
   * acting on a number about themselves, and `finance` is a figure that goes on
   * somebody's invoice or return.
   *
   * So those four categories are not free to be `"none"`. This is deliberately
   * a rule about the CATEGORY rather than the pack: a rigger's sling load and an
   * electrician's cable drop are different trades and the same danger, and a
   * rule keyed on the trade would have caught one of them.
   */
  it("refuses a harmless risk class to the categories whose failures land on somebody else", () => {
    const REQUIRED = {
      structure: ["life-safety"],
      electrical: ["life-safety"],
      body: ["wellness", "life-safety"],
      finance: ["financial", "legal-procedure"],
    } as const;
    for (const tool of declared) {
      const allowed = REQUIRED[tool.category as keyof typeof REQUIRED];
      if (allowed === undefined) continue;
      expect(allowed as readonly string[], `${tool.id} (${tool.category})`).toContain(
        tool.riskClass,
      );
    }
  });

  /**
   * The verdict ban, at the only place a static check can see it: the tool's own
   * Serbian name and blurb.
   *
   * A `life-safety` or `food-safety` tool computes a quantity and never renders
   * a judgement — „provera da li nosač zadovoljava" is a different product from
   * „moment savijanja", and it is the product that needs an engineer's stamp.
   * The surface cannot be scanned for this (its copy lives in a strings tree
   * shared by fifty tools), but the NAME is where the promise is made, and a
   * tool that promises a verdict in its title will keep it in its body.
   */
  it("keeps a verdict out of the name of every tool that is not allowed to render one", () => {
    const VERDICT = /zadovoljav|bezbedn|ispravn|u skladu|dozvoljen|provera da li|da li je/i;
    for (const tool of declared) {
      if (!toolForbidsVerdict(tool.riskClass)) continue;
      const title = lookup(tool.titleKey);
      const blurb = tool.blurbKey === undefined ? "" : lookup(tool.blurbKey);
      expect(`${String(title)} ${String(blurb)}`, tool.id).not.toMatch(VERDICT);
    }
  });

  /**
   * A published constant has to say whose it is.
   *
   * `sourceKey` is a strings path exactly as `titleKey` is, and an unresolved
   * one renders nothing at all — which is indistinguishable on screen from a
   * tool that invented its numbers.
   */
  it("resolves the source line of every tool that quotes a published table", () => {
    for (const tool of declared) {
      if (tool.sourceKey === undefined) continue;
      expect(tool.sourceKey, tool.id).toMatch(/^[a-zA-Z]+(?:\.[a-zA-Z0-9-]+)+$/);
      const line = lookup(tool.sourceKey);
      expect(typeof line, `${tool.id}:${tool.sourceKey}`).toBe("string");
      // A source names an edition or a year; „ISO 216" alone is a standard
      // family, not a citation somebody can check.
      expect(String(line), tool.id).toMatch(/\d/);
    }
  });
});

/**
 * ADR-058's business preset. It used to be a hand-written list of five module
 * ids in `main/index.ts`, and FIN, PRIV and DOC — every module that shipped
 * after it was written — were never added to it, so they quietly fell back to
 * `defaultEnabled`, which is precisely what its own comment said the list
 * existed to prevent. It is derived now, and these are the tests that keep it
 * honest: the first fails the day a module is registered without one.
 */
describe("businessProfileFlags — the seeded preset covers every module there is", () => {
  const registry = createModuleRegistry();
  const flags = businessProfileFlags(registry);

  it("writes exactly one row per unlocked module, and none for a locked one", () => {
    const rowIds = flags.map((flag) => flag.moduleId);
    expect(new Set(rowIds).size).toBe(rowIds.length);
    expect([...rowIds].sort()).toEqual(
      registry
        .all()
        .map((manifest) => manifest.id)
        .filter((id) => !LOCKED_MODULE_IDS.has(id))
        .sort(),
    );
  });

  it("turns off exactly the disabled set and otherwise repeats the module's own default", () => {
    for (const { moduleId, enabled } of flags) {
      const manifest = registry.get(moduleId);
      expect(manifest, moduleId).toBeDefined();
      expect(enabled, moduleId).toBe(
        !BUSINESS_DISABLED_MODULE_IDS.has(moduleId) && manifest!.defaultEnabled,
      );
    }
  });

  it("keeps STUDY off — the one thing a business profile does not do", () => {
    expect(flags.find((flag) => flag.moduleId === "study")?.enabled).toBe(false);
  });
});

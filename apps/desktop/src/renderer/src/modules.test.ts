import {
  MODULE_CATEGORIES,
  TOOL_CATEGORIES,
  UNIT_KINDS,
  parseWidgetConfig,
  resolveEnabled,
  unitsOfKind,
} from "@nexus/core";
// The one place a renderer file names `@nexus/db`, and it is a TEST: the
// default dashboard layout is a db constant (`DashboardWidgetStore`) whose
// entries name widgets these manifests publish, and nothing else in the build
// can see both halves of that pairing. The renderer's own code still reaches
// the database only through main's IPC allowlist.
import { DEFAULT_DASHBOARD_LAYOUT } from "@nexus/db";
import { describe, expect, it } from "vitest";

import { DASHBOARD_WIDGETS } from "./dashboardWidgets.js";
import { FILE_VIEWS } from "./filePrefs.js";
import { MODULE_SETTINGS_PANELS } from "./moduleSettingsPanels.js";
import { NOTE_WIDTHS } from "./notePrefs.js";
import { BLOCKED_IN_TODAY_OPTIONS } from "./taskPrefs.js";
import { TOOL_SURFACES } from "./toolSurfaces.js";
import {
  BUSINESS_DISABLED_MODULE_IDS,
  LOCKED_MODULE_IDS,
  businessProfileFlags,
  createModuleRegistry,
} from "../../shared/modules.js";
import { strings } from "./strings.js";

/**
 * `modules.ts` is the renderer's one declaration of which modules exist
 * (ADR-008). The registry itself is `@nexus/core`'s and has its own tests, so
 * what is pinned here is the DECLARATION: the v0 set, its order, and the two
 * invariants a new manifest could silently break — a duplicate id/prefix
 * (which the registry throws on, so `createModuleRegistry()` would fail at
 * import-time in the app) and a category outside the canonical list.
 */

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
      // The one deliberate sharing — see this test's own comment.
      UTIL: ["focus", "tools"],
      CANV: ["canvas"],
    });
  });

  it("only uses canonical categories, and every registered module except PRIV is on by default", () => {
    for (const manifest of createModuleRegistry().all()) {
      expect(MODULE_CATEGORIES, manifest.id).toContain(manifest.category);
      // Founder decision 2026-07-12: only BUILT modules are registered, so an
      // entry that shipped disabled would be an entry that leads nowhere.
      // PRIV is the one deliberate exception (ADR-057): built AND registered,
      // but OFF until the user enables it in the Moduli gallery — an opt-in
      // section, not an unbuilt page.
      expect(manifest.defaultEnabled, manifest.id).toBe(manifest.id !== "priv");
    }
  });

  it("groups the sidebar by category in canonical order, empty categories omitted", () => {
    const grouped = createModuleRegistry().byCategory();
    expect([...grouped.keys()]).toEqual([
      "Core experience",
      "Content & knowledge",
      "Life hubs",
      "Professional & utilities",
    ]);
    expect(grouped.get("Core experience")?.map((manifest) => manifest.id)).toEqual([
      "dashboard",
      "tasks",
      "calendar",
      "settings",
    ]);
    expect(grouped.get("Content & knowledge")?.map((manifest) => manifest.id)).toEqual([
      "notes",
      "priv",
      "files",
    ]);
    // „Ishrana" joins the three subjects somebody HAS rather than the tools
    // they use on them: what you eat is an area of a life in the plainest sense
    // the group has.
    expect(grouped.get("Life hubs")?.map((manifest) => manifest.id)).toEqual([
      "study",
      "finance",
      "habits",
      "fitness",
    ]);
    // „Fokus" is the first module in „Profesionalno i alati", and the category
    // is the honest one: „Životni centri" holds three subjects somebody HAS,
    // while a Pomodoro timer is a TOOL you use on whichever of them you are at.
    // Three modules now: „Fokus" is a timer you run, „Alatke" a drawer you
    // open, „Tabla" a surface you draw on — separate entries because they are
    // separate errands. The first two share the UTIL prefix (one PRD section
    // implemented twice); CANV has its own, because it is its own PRD entry.
    expect(grouped.get("Professional & utilities")?.map((manifest) => manifest.id)).toEqual([
      "focus",
      "tools",
      "canvas",
    ]);
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
    // PRIV is absent by DEFAULT (ADR-057) — the one module the gallery turns on.
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
    ]);
    expect(resolveEnabled(registry, { study: false })).not.toContain("study");
    expect(resolveEnabled(registry, { priv: true })).toContain("priv");
  });

  it("keeps PRIV free of every render-while-locked surface: no widgets, no search indexers", () => {
    const registry = createModuleRegistry();
    // While the section is locked NOTHING of it may render anywhere (ADR-057):
    // a widget contract or a search indexer would be exactly such a surface.
    expect(registry.widgetsOf("priv")).toEqual([]);
    expect(registry.all().find((manifest) => manifest.id === "priv")?.searchIndexers).toBeUndefined();
  });

  it("keeps DOC a pure browse surface: no widgets, and no second index over file names", () => {
    const registry = createModuleRegistry();
    // An attachment's file name already rides its owning row's indexed body
    // (migrations 025/048). An indexer here would put every file into the
    // palette a second time, competing with the note that carries it — see the
    // manifest's own comment. „Datoteke" is where you browse files; the palette
    // is where you find the thing they belong to.
    expect(registry.all().find((manifest) => manifest.id === "files")?.searchIndexers).toBeUndefined();
    expect(registry.widgetsOf("files")).toEqual([]);
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
    ]);
  });

  it("pairs every declaration with a renderer, and every renderer with a declaration", () => {
    // The pairing the page rests on, exactly as `DASHBOARD_WIDGETS` does: a
    // declaration with no renderer is an empty card, a renderer with no
    // declaration is a card the page never asks for. Neither fails loudly in
    // the app, which is why it is pinned here.
    expect(declared.map(([moduleId]) => moduleId).sort()).toEqual(
      Object.keys(MODULE_SETTINGS_PANELS).sort(),
    );
  });

  it("names a string that really exists for every card title and every control label", () => {
    for (const [moduleId, panel] of declared) {
      expect(typeof lookup(panel.titleKey), panel.titleKey).toBe("string");
      // A module's card IS its own section, so its title is the very heading
      // `strings.settings.sectionTitle` already carries for it.
      expect(lookup(panel.titleKey), moduleId).toBe(
        strings.settings.sectionTitle[moduleId as keyof typeof strings.settings.sectionTitle],
      );
      for (const control of panel.controls) {
        expect(typeof lookup(control.labelKey), control.labelKey).toBe("string");
        if (control.kind === "choice") {
          for (const option of control.options) {
            expect(typeof lookup(option.labelKey), option.labelKey).toBe("string");
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
    expect([...qualified].sort()).toEqual(Object.keys(DASHBOARD_WIDGETS).sort());
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
        // `title` is a strings KEY path, not Serbian copy (WidgetContract).
        expect(widget.title, widget.id).toMatch(/^[a-zA-Z]+(?:\.[a-zA-Z]+)+$/);
      }
    }
  });

  it("names a string that really exists for every widget title", () => {
    // The convention is only worth anything if the key resolves: a title that
    // named nothing would render as the raw path the day slice b draws it.
    const registry = createModuleRegistry();
    for (const manifest of registry.all()) {
      for (const widget of registry.widgetsOf(manifest.id)) {
        const resolved = widget.title
          .split(".")
          .reduce<unknown>(
            (node, key) =>
              typeof node === "object" && node !== null
                ? (node as Record<string, unknown>)[key]
                : undefined,
            strings,
          );
        expect(typeof resolved, widget.title).toBe("string");
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
    expect(shape("study:ispiti")).toEqual(["choice:horizon"]);
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
    // „Ispiti" ships showing every upcoming exam.
    expect(parseWidgetConfig(contractOf("study:ispiti"), null)).toEqual({ horizon: "svi" });
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
              expect(typeof lookup(option.labelKey), option.labelKey).toBe("string");
            }
          }
        }
      }
    }
  });
});

/**
 * UTIL slice c: the tools the registry publishes (`ToolRegistration`), and the
 * pairing „Alatke" rests on.
 *
 * The drawer is a HOST — it collects `manifest.tools` across the registry and
 * renders whatever it finds — so it has no list of tools of its own and no
 * `switch`. That is only safe if the two halves agree, which is what these
 * pin: a declaration with no surface is a row that opens onto nothing, a
 * surface with no declaration is a tool nobody can reach. Neither fails loudly
 * in the app.
 */
describe("the tools the registry publishes (PRD 29 UTIL)", () => {
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

  it("publishes the drawer's eleven tools, and only „Alatke“ publishes any", () => {
    expect(declared.map((tool) => tool.id)).toEqual([
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
    // Nothing else contributes yet — but the drawer reads the whole registry,
    // so the day something does, it appears without the drawer being edited.
    for (const manifest of registry.all()) {
      if (manifest.id === "tools") continue;
      expect(manifest.tools, manifest.id).toBeUndefined();
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
    for (const tool of declared) {
      expect(tool.id, tool.id).not.toMatch(/valut|kurs|currency|devi/i);
    }
    expect(declared.map((tool) => tool.id)).not.toContain("valuta");
  });

  it("pairs every declared tool with a surface, and every surface with a declaration", () => {
    expect(declared.map((tool) => tool.id).sort()).toEqual(Object.keys(TOOL_SURFACES).sort());
  });

  it("keeps every tool id an ASCII slug, unique across the registry", () => {
    const ids = declared.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("names a string that really exists for every tool title, and a canonical category", () => {
    for (const tool of declared) {
      // `titleKey` is a strings KEY path, not Serbian copy (`ToolRegistration`).
      expect(tool.titleKey, tool.id).toMatch(/^[a-zA-Z]+(?:\.[a-zA-Z-]+)+$/);
      expect(typeof lookup(tool.titleKey), tool.titleKey).toBe("string");
      expect(TOOL_CATEGORIES, tool.id).toContain(tool.category);
    }
  });

  it("gives every tool folded, lowercase keywords — they are search keys, never labels", () => {
    for (const tool of declared) {
      for (const keyword of tool.keywords ?? []) {
        expect(keyword, `${tool.id}:${keyword}`).toMatch(/^[a-z0-9 ]+$/);
      }
    }
  });

  it("names a unit string for every unit the converters can offer", () => {
    // A missing name would render the raw id in a dropdown — the one place the
    // drawer would look unfinished.
    for (const kind of UNIT_KINDS) {
      for (const unit of unitsOfKind(kind)) {
        expect(typeof strings.tools.unit[unit.id], unit.id).toBe("string");
      }
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

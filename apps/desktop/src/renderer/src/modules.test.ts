import { MODULE_CATEGORIES, parseWidgetConfig, resolveEnabled } from "@nexus/core";
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
import { createModuleRegistry } from "../../shared/modules.js";
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
    ]);
  });

  it("gives every module a unique id and a unique PRD prefix", () => {
    const manifests = createModuleRegistry().all();
    expect(new Set(manifests.map((manifest) => manifest.id)).size).toBe(manifests.length);
    expect(new Set(manifests.map((manifest) => manifest.prefix)).size).toBe(manifests.length);
    for (const manifest of manifests) {
      expect(manifest.prefix, manifest.id).toMatch(/^[A-Z]+$/);
    }
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
    expect([...grouped.keys()]).toEqual(["Core experience", "Content & knowledge", "Life hubs"]);
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
    expect(grouped.get("Life hubs")?.map((manifest) => manifest.id)).toEqual(["study", "finance"]);
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
    // Settings would be a mirror facing a mirror.
    expect(declared.map(([moduleId]) => moduleId)).toEqual([
      "dashboard",
      "tasks",
      "calendar",
      "notes",
      "priv",
      "files",
      "study",
      "finance",
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

  it("keeps every card's storage honest: the four device cards, and four the profile owns", () => {
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
    expect(storages("dashboard")).toEqual(new Set(["profile"]));
    expect(storages("study")).toEqual(new Set(["profile"]));
    expect(storages("calendar")).toEqual(new Set(["profile"]));
    expect(storages("priv")).toEqual(new Set(["profile"]));
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

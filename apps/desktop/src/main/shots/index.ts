/**
 * `--shots`: drive the real app through every surface it has, photograph each
 * one in both themes at three window sizes, and ask the page's own geometry
 * what is wrong with it.
 *
 * This exists because reviewing a desktop app by eye does not scale. Fourteen
 * modules with their own sub-views, two themes, and a size range from the
 * 900 px minimum to a maximised window is well over two hundred frames — and
 * the defects that survive review are precisely the small ones: two pixels of
 * clipped text, a badge painting over a label, a row escaping its card at one
 * width and not another. So the app photographs itself, and reports its own
 * geometry alongside every frame (`audit.ts`).
 *
 * Three properties keep this honest:
 *
 *  - It drives the REAL renderer, through real clicks on real elements, in a
 *    real Electron window. Nothing is mocked and no component is rendered in
 *    isolation, so a defect that only appears once the shell, the theme and the
 *    data are all present is still visible here.
 *  - It runs against the demo profile (`../demo/`), so no surface is
 *    photographed empty unless empty is what it genuinely is.
 *  - It never touches the developer's real `%APPDATA%\\Nexus`. Like the smoke
 *    run, it redirects `userData` into a disposable subdirectory first.
 *
 * The sub-view sweep is deliberately NOT a hand-written list of tabs. Each
 * scene names a module and a fan-out selector; the harness lands on the page,
 * enumerates whatever switcher options are actually there, and shoots one frame
 * per option. A view added to a module later is photographed without anyone
 * remembering to add it here — the same reason the gallery's icon list had to
 * become `Object.keys(SHAPES)` rather than a list someone maintained by hand.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { AUDIT_SCRIPT, type AuditFinding } from "./audit.js";

/** The switcher every page builds its sub-views out of (`.nx-segmented`). */
const DEFAULT_FANOUT = ".nx-segmented__option";

export interface ShotScene {
  /** File-name stem, and the name the report refers to the surface by. */
  readonly id: string;
  /**
   * The module to land on — matched against the sidebar row's `data-module-id`
   * rather than its visible label, so the sweep is unaffected by the language
   * the shell happens to be in.
   */
  readonly module: string;
  /** Renderer JS to run after landing and before the first frame. */
  readonly prepare?: string;
  /**
   * Selector whose matches are each clicked and photographed in turn. `null`
   * suppresses the sweep for a surface that has no switcher, or whose switcher
   * must not be driven (an open editor, where clicking would lose the frame
   * that was the point).
   *
   * A surface with no switcher must say `null` rather than leave this undefined
   * and let the default match nothing. `fanoutLabels` reports an empty match as
   * a stale selector, which is the one warning here worth reading — and six
   * single-surface modules leaving it undeclared fired it thirty-six times a
   * run, which is how a warning stops being read (DC-15).
   */
  readonly fanout?: string | null;
  /** Renderer JS to run after the last frame — closes whatever `prepare` opened. */
  readonly cleanup?: string;
}

/**
 * Every surface the sweep visits.
 *
 * `dashboard` first and `settings` last is not cosmetic: the sweep runs in
 * order within one session, so a scene that changes state (opening a note,
 * starting a timer) is followed by scenes that do not depend on it.
 */
export const SHOT_SCENES: readonly ShotScene[] = [
  { id: "dashboard", module: "dashboard", fanout: null },
  { id: "tasks", module: "tasks" },
  {
    id: "tasks-detail",
    module: "tasks",
    // The detail pane only exists once a row is selected, and it is where most
    // of TASK's surface area actually lives.
    // TASK's detail is a PANE toggled from the toolbar, not a per-row drawer —
    // clicking a row selects it for a bulk action and opens nothing. The first
    // version of this scene clicked a row and photographed the unchanged list,
    // which is the quietest way for a scene to be wrong: the frame looks like a
    // module with no detail view rather than like a broken probe.
    // The view switcher is clicked back to its FIRST option first. Landing on
    // a module that is already open remounts nothing, so this scene inherited
    // whatever view the fan-out before it ended on — and „Detalji" only exists
    // on the list view. That is why the run kept printing „found nothing to
    // open": the probe was right and the page was somewhere else.
    prepare: CLICK_THEN(".nx-segmented__option", "text:Detalji"),
    fanout: null,
  },
  { id: "calendar", module: "calendar" },
  { id: "notes", module: "notes" },
  {
    id: "notes-open",
    module: "notes",
    prepare: OPEN_FIRST(".note__item-row, .notes__row, .nx-list-row"),
    fanout: null,
  },
  { id: "priv", module: "priv", fanout: null },
  { id: "files", module: "files" },
  { id: "study", module: "study", fanout: null },
  { id: "finance", module: "finance" },
  { id: "habits", module: "habits", fanout: null },
  {
    id: "fitness",
    module: "fitness",
    // NOT the default `.nx-segmented__option`: „Mapa tela" puts twenty muscle
    // buttons on the page wearing the same class as the four section tabs, so
    // the default fan-out would photograph twenty near-identical frames and
    // then walk off the page when one of them switched sections underneath it.
    // The tabs have a class of their own; the map's own states are scenes.
    fanout: ".fit__section-tab",
  },
  {
    id: "fitness-muscle",
    module: "fitness",
    // The map's second state: a muscle chosen, so the rail lists what trains
    // it. The figure is FIT's centrepiece and this is half of what it does.
    //
    // „Mapa tela" is clicked FIRST because the scene before this one fanned
    // out through the section tabs and left the page on the last of them —
    // navigating to a module that is already open remounts nothing, so the
    // section survives. Without this the frame was a photograph of „Merenja"
    // filed under the body map's name.
    prepare: CLICK_THEN(".fit__section-tab", ".fit__muscle-option"),
    fanout: null,
  },
  {
    id: "fitness-exercise",
    module: "fitness",
    // The third state, and the one the whole section exists for: an exercise
    // chosen, with the body repainted to show what it hits.
    // A DIFFERENT muscle than the scene before it picks. Choosing a group is a
    // toggle, the page is not remounted between two scenes on the same module,
    // and clicking the same button again therefore DESELECTED it — the frame
    // came back showing the week summary under the name of the exercise view.
    prepare: CLICK_THEN(
      ".fit__section-tab",
      ".fit__muscle-list > :nth-child(3)",
      ".fit__exercise-row",
    ),
    fanout: null,
  },
  { id: "focus", module: "focus", fanout: null },
  {
    id: "tools",
    module: "tools",
    // NOT the default `.nx-segmented__option`. „Alatke" switches surfaces from
    // a RAIL, not from a segmented control, so the default matched nothing and
    // the sweep photographed the empty state eight times over — the one frame
    // of that module in which no tool is open. Every converter and calculator
    // in the drawer went unphotographed for as long as the scene existed, and
    // the run said nothing, because „the selector found nothing" and „this page
    // has no sub-views" looked identical. The sweep now says so out loud (see
    // the fan-out below), which is the half of this fix that generalises.
    fanout: ".tool__item",
  },
  {
    // „Stručne alatke" is the same rail with every trade's toolkit on it, and
    // it is the newest surface in the app — which makes it the one most worth
    // photographing at every size. It is off by default AND its rows are
    // pack-gated, so it is here only because the demo profile turns on both the
    // module and every `pack:*` row (`enableEverything`); if the sweep reports
    // „found nothing to fan out", that is one of those two flags, not the page.
    id: "pro",
    module: "pro",
    fanout: ".tool__item",
  },
  { id: "canvas", module: "canvas" },
  {
    // The workbench with the demo profile's two circuits on it. `fanout: null`
    // because it genuinely has no segmented sub-views — the default selector
    // would find nothing and the sweep would rightly say so.
    id: "electronics",
    module: "electronics",
    fanout: null,
  },
  {
    // The panel on the right with a PART in it. Three of this module's four
    // surfaces are inside that panel and none of them is reachable without
    // selecting something, so without these two scenes the sweep would report
    // „2 000 frames, all fine" about a module whose inspector it never saw —
    // which is the shape DC-57 named.
    id: "electronics-part",
    module: "electronics",
    prepare: POINTER_TAP(".elec-part__body"),
    fanout: null,
  },
  {
    // And with a WIRE in it, which is also the only screen the nine jumper
    // colours appear on twice — once as the swatch row, once as the wire.
    id: "electronics-wire",
    module: "electronics",
    prepare: POINTER_TAP(".elec-wire__hit"),
    fanout: null,
  },
  { id: "search", module: "dashboard", prepare: OPEN_SEARCH_PAGE(), fanout: null },
  { id: "settings", module: "settings", fanout: null },
  {
    // „Podešavanja" is twenty-odd cards long and a frame only ever shows the
    // first one, so every card below the fold was unphotographed — which is why
    // this scene exists at all rather than only for the card that prompted it.
    // Named by DOM id, not by the Serbian title: `sectionDomId` builds these
    // from the section id, so this survives a translation the way the module
    // scenes survive one by matching `data-module-id`.
    id: "settings-sync",
    module: "settings",
    prepare: SCROLL_TO("#set-section-sync"),
    fanout: null,
  },

  // --- Overlays -------------------------------------------------------------
  // Surfaces with no sidebar row of their own. Each opens something, is
  // photographed, and closes itself again in `cleanup`, so the scene after it
  // starts from the same state every other scene does.
  {
    id: "palette",
    module: "dashboard",
    prepare: DISPATCH_KEY("k", { ctrlKey: true }),
    cleanup: DISPATCH_KEY("Escape"),
    fanout: null,
  },
  {
    id: "shortcuts",
    module: "dashboard",
    prepare: DISPATCH_KEY("?", { shiftKey: true }),
    cleanup: DISPATCH_KEY("Escape"),
    fanout: null,
  },
  {
    id: "notifications",
    module: "dashboard",
    prepare: CLICK(".ntf__bell"),
    cleanup: CLICK(".ntf__bell"),
    fanout: null,
  },
  {
    // The app menu behind the mark — everything the OS menu bar used to hold.
    // It is the first thing in the window and the last thing that had never
    // been photographed.
    id: "app-menu",
    module: "dashboard",
    prepare: CLICK(".app__menu-trigger"),
    cleanup: DISPATCH_KEY("Escape"),
    fanout: null,
  },

  // The lock screen is deliberately NOT a scene. Locking ends the session, and
  // the sweep re-enters this list once per theme and once per window size — so
  // a scene that locked would leave every frame after it a photograph of the
  // lock screen. It is worth reviewing, and it wants a harness that can unlock
  // again; that is not this loop.
];

/** Fires a keydown on `window` — where the shell's own global handler listens. */
function DISPATCH_KEY(key: string, modifiers: Record<string, boolean> = {}): string {
  const init = JSON.stringify({ key, bubbles: true, cancelable: true, ...modifiers });
  // Dispatched on the FOCUSED element, not on `window`.
  //
  // An event dispatched on `window` has no path through the DOM, so it reaches
  // only the listeners registered on `window` itself. That is enough to OPEN
  // the palette — the shell's chord handler is a window listener — and not
  // enough to close it, because the dialog's Escape lives on the dialog. The
  // sweep therefore opened the palette and never shut it, and every overlay
  // frame after it was a photograph of the palette wearing another scene's
  // name: „notifications" and „app-menu" both came back with the search
  // overlay across them.
  //
  // From the focused element the event bubbles up through the dialog, the
  // document and on to `window`, which is the path a real keystroke takes.
  return `(() => {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", ${init}));
    return true;
  })()`;
}

/**
 * Clicks the first element matching any of a comma-separated candidate list,
 * and reports which one it was.
 *
 * The candidates exist because a scene that opens a detail pane depends on a
 * class name a page owns, and the pages change. A single selector that stops
 * matching produces the quietest possible failure — the scene photographs the
 * list it was supposed to have opened, and the frame looks like a module with
 * no detail view. Returning the selector that matched (or `"none"`) turns that
 * into something the run can print.
 */
function OPEN_FIRST(selectors: string): string {
  return `(() => {
    for (const selector of ${JSON.stringify(selectors)}.split(",")) {
      const el = document.querySelector(selector.trim());
      if (el) { el.click(); return selector.trim(); }
    }
    return "none";
  })()`;
}

/**
 * Clicks each step in turn, waiting for React to commit between them.
 *
 * A step is a CSS SELECTOR, or `text:<label>` for a button matched by the words
 * on it. Both forms exist because both are true of different controls: a view
 * switcher is a class the page owns, while a disclosure is named in the app's
 * own vocabulary and keeps its name through a restructuring that renames every
 * class around it. `startsWith` rather than equality on the label, because a
 * disclosure trigger carries more than its word — „Detalji" sits beside a
 * marker saying the fold still holds a choice.
 *
 * The two rAFs between steps are the same wait the write probe needs and for
 * the same reason: `click()` only SCHEDULES a state update, so the next step's
 * target does not exist yet at the moment the previous handler returns.
 * Chaining the clicks without the wait finds nothing and photographs the
 * unchanged page — the quietest way for a scene to be wrong.
 */
function CLICK_THEN(...steps: readonly string[]): string {
  return `(async () => {
    for (const step of ${JSON.stringify(steps)}) {
      const target = step.startsWith("text:")
        ? Array.prototype.find.call(
            document.querySelectorAll("button"),
            (node) => (node.textContent || "").trim().startsWith(step.slice(5)),
          )
        : document.querySelector(step);
      if (target) target.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    return true;
  })()`;
}

/**
 * Brings one element to the top of whatever scrolls it, and reports whether it
 * was there to bring.
 *
 * `"none"` rather than a silent no-op for `OPEN_FIRST`'s reason: a selector
 * that stops matching would otherwise photograph the top of the page under the
 * name of a card halfway down it, which reads as „the card is fine" rather than
 * „the probe missed".
 *
 * `behavior: "instant"` is load-bearing — the harness photographs on the next
 * frame, and a smooth scroll would still be in flight.
 */
function SCROLL_TO(selector: string): string {
  return `(async () => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return "none";
    el.scrollIntoView({ behavior: "instant", block: "start" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return ${JSON.stringify(selector)};
  })()`;
}

/**
 * Presses and releases a pointer on the first match, and says whether there was
 * one.
 *
 * `CLICK` is not enough for a drawn surface: an SVG shape has no `click()`, and
 * a bench selects on `pointerdown` rather than on `click` because that is where
 * a drag has to begin. Both halves are sent, so a handler that opens a gesture
 * also gets the event that closes it — a scene that pressed and never released
 * would photograph the page mid-drag.
 */
function POINTER_TAP(selector: string): string {
  return `(async () => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return "none";
    const box = el.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    };
    el.dispatchEvent(new PointerEvent("pointerdown", init));
    el.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return ${JSON.stringify(selector)};
  })()`;
}

/** Clicks the first match, or does nothing if the surface is not on this build. */
function CLICK(selector: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el) el.click();
    return true;
  })()`;
}

/**
 * ADR-086's questionnaire, which nothing else in this sweep can reach.
 *
 * Every scene above is anchored to a sidebar row, and the questionnaire is not
 * a page — it replaces the shell. So eight screens that decide what a new
 * user's whole app looks like had no photograph at all, which is exactly the
 * shape DC-57 named: a harness whose fixture can never reach the state, and a
 * run that says „2 483 frames, no findings" about a surface it never saw.
 *
 * The way in is the RERUN (`Podešavanja → Kako je Nexus podešen za tebe`),
 * which mounts the same component in `mode: "rerun"`. That is not a weaker
 * subject than a first run: it is one component with one render site, told
 * apart by a prop, and the rerun is the reachable half.
 *
 * The pass ANSWERS the questions rather than clicking through them empty. An
 * unanswered flow photographs six screens in the one state none of them is
 * interesting in — no recognition chips, no chosen cards, an empty reveal — and
 * the states that carry the design are precisely the ones a person produces by
 * answering. It runs last, and it COMPLETES: „Priprema" and „Evo tvog Nexusa"
 * only exist on the far side of the write, and a rerun over the demo profile in
 * a disposable `userData` is free to make it.
 */
const ONB_SCREENS = ["ime", "nedelja", "posao", "ritam", "oko", "podsetnici"] as const;

/** The trade sentence the pass types. Two clean stems, so the „Prepoznato“ chips are in the frame. */
const ONB_TRADE = "stolar, advokat";

/** Which step the questionnaire is on („Korak N od 6“), or „none“ when it is not on screen. */
const ONB_STEP = `(() => {
  const el = document.querySelector(".onb__steps");
  if (!el) return "none";
  const found = (el.textContent || "").match(/[0-9]+/);
  return found ? found[0] : "none";
})()`;

/**
 * What the questionnaire is showing, for the three screens that have no step
 * counter. Ordered most-specific first: the manual override is a form inside
 * the same card as the reveal, so „has a stage list“ and „is the manual form“
 * are both asked before the reveal's own button.
 */
const ONB_PHASE = `(() => {
  if (!document.querySelector(".onb")) return "none";
  if (document.querySelector(".onb__stages")) return "prepare";
  if (document.querySelector(".onb__form--manual")) return "manual";
  if (document.querySelector(".onb__enter")) return "reveal";
  return "asking";
})()`;

/**
 * Types into the first visible text field of the screen, the way `WRITE_PROBE`
 * does — through the prototype's value setter, because React listens to the
 * `input` event and a plain assignment fires nothing.
 */
function ONB_TYPE(selector: string, text: string): string {
  return `(async () => {
    const field = document.querySelector(${JSON.stringify(selector)});
    if (!field) return "none";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    field.focus();
    setter.call(field, ${JSON.stringify(text)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return "typed";
  })()`;
}

/** Clicks the nth match of a selector, and says whether there was one. */
function ONB_PICK(selector: string, ...indexes: readonly number[]): string {
  return `(async () => {
    const all = document.querySelectorAll(${JSON.stringify(selector)});
    let hit = 0;
    for (const index of ${JSON.stringify(indexes)}) {
      const el = all[index];
      if (!el) continue;
      el.click();
      hit += 1;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    return hit === ${JSON.stringify(indexes.length)} ? "picked" : "none";
  })()`;
}

/**
 * What each screen is answered with before it is photographed.
 *
 * Keyed by screen so a screen added to the flow without an answer here is
 * visibly missing rather than silently unanswered — the same argument
 * `fanoutLabels` makes about a selector that has gone stale.
 */
const ONB_ANSWERS: Readonly<Record<string, string | null>> = {
  ime: null,
  nedelja: ONB_PICK(".pro-kit", 0, 5),
  posao: null,
  ritam: ONB_PICK(".pro-kit", 1),
  oko: ONB_PICK(".pro-kit", 0, 2),
  podsetnici: ONB_PICK(".onb__choice", 1),
};

/**
 * The modules whose create form the write pass exercises, and the marker it
 * types. The marker is deliberately obvious in a screenshot and obviously not
 * real data, so a frame containing it cannot be mistaken for the demo profile's
 * own content.
 */
const WRITE_MODULES = ["tasks", "notes", "habits", "study", "finance"] as const;
const WRITE_MARKER = "Provera unosa — snimak";

/**
 * Types into a module's first create field and submits it, the way a person
 * would.
 *
 * Deliberately generic — it finds the first visible text input that sits inside
 * a form and submits THAT form — rather than naming each page's own selectors.
 * Named selectors would be a second, hand-maintained description of five pages
 * that are being restructured this week, and it would rot within the day. This
 * asks the page what its create form is.
 *
 * `requestSubmit()` rather than `submit()`: the plain one skips validation and
 * skips the `submit` event, which is the event React is listening to — it would
 * post nothing and look like a silent failure of the app rather than of the
 * probe.
 */
function WRITE_PROBE(text: string): string {
  return `(async () => {
    // An input with NO type attribute is a text input, and [type=text]
    // does not match it — which is what TextField renders, so the probe was
    // looking for a field shape this app does not produce and reporting "no
    // create form" on five surfaces that all have one.
    const FIELDS = "form input:not([type]), form input[type=text], form input[type=search], form textarea";
    const visibleField = () => Array.prototype.find.call(
      document.querySelectorAll(FIELDS),
      (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 40 && rect.height > 10 && !el.disabled && !el.readOnly;
      },
    );

    let field = visibleField();
    if (!field) {
      // The create form is a DISCLOSURE on most surfaces now — a page that is
      // read a hundred times a day and written to a few does not keep its form
      // open — so the probe has to do what a person does and press the button
      // that reveals it. Matched on the visible Serbian verb rather than a
      // class, because the class is each page's own and the verb is the app's.
      const opener = Array.prototype.find.call(
        document.querySelectorAll("button"),
        (el) => /^(nova|novi|novo|dodaj|upiši|zapiši)\\b/i.test((el.textContent || "").trim()),
      );
      if (!opener) return "no-form";
      opener.click();
      // React has not re-rendered yet. The click only SCHEDULES the state
      // update; the field the disclosure reveals does not exist until the
      // commit, so
      // reading synchronously here found nothing every single time and the
      // probe reported „no create form" on five surfaces that all have one.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      field = visibleField();
    }
    if (!field) return "no-form";
    const proto = field instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    field.focus();
    setter.call(field, ${JSON.stringify(text)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    const form = field.closest("form");
    if (!form) return "no-form";
    form.requestSubmit();
    return "submitted";
  })()`;
}

/**
 * The search PAGE (not the palette) has no sidebar module row of its own — it
 * is a system surface reached from the row under the profile — so the scene
 * lands on the dashboard and clicks that row instead.
 */
function OPEN_SEARCH_PAGE(): string {
  return `(() => {
    const rows = Array.from(document.querySelectorAll(".app__sidebar-foot .nx-nav-item"));
    const row = rows[0];
    if (row) row.click();
    return true;
  })()`;
}

/** One window geometry the whole scene list is swept at. */
export interface ShotSize {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Three widths, each chosen because something is known to change at it.
 *
 * `min` is the enforced floor (`createWindow`'s `minWidth`/`minHeight`) — the
 * hardest case, and the one no one ever runs by choice. `default` is the size
 * the app actually opens at, so it is what a first-time user sees. `wide` is a
 * maximised window on a 1080p screen, where the failure mode inverts: content
 * stops being cramped and starts being marooned in whitespace.
 */
export const SHOT_SIZES: readonly ShotSize[] = [
  { id: "min", width: 900, height: 600 },
  { id: "default", width: 1120, height: 720 },
  { id: "wide", width: 1600, height: 1000 },
];

export const SHOT_THEMES = ["noc", "dan"] as const;
export type ShotTheme = (typeof SHOT_THEMES)[number];

/** One captured frame and what the page said about itself while it was on screen. */
export interface ShotFrame {
  readonly file: string;
  readonly scene: string;
  readonly theme: ShotTheme;
  readonly size: string;
  readonly findings: readonly AuditFinding[];
}

// --- Driver -----------------------------------------------------------------

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Races a promise against the clock, and clears the clock either way.
 *
 * The timer is cleared rather than left to fire, because this runs a few
 * thousand times a sweep and a run that ends with two thousand live timeouts is
 * a run that will not exit. The abandoned side is silenced for a sharper reason:
 * a promise the race walked away from can still REJECT later, and an unhandled
 * rejection ends the process at an arbitrary moment with a stack that names none
 * of this.
 */
function withCeiling<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  work.catch(() => undefined);
  const ceiling = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([work, ceiling]).finally(() => clearTimeout(timer));
}

/** What `evalIn` answers when the renderer does not. Nothing else in the sweep equals it. */
const EVAL_TIMED_OUT = Symbol("shots: the renderer did not answer");
const EVAL_CEILING_MS = 15_000;

let ceilingReported = false;

/**
 * Every call this sweep makes into the renderer, with a ceiling on it.
 *
 * `executeJavaScript` returns a promise that is not guaranteed to settle. If
 * the page is suspended — and Chromium suspends a window it considers not
 * visible — a script waiting on `requestAnimationFrame` never runs and the
 * promise never resolves and never rejects. That is what killed a run 1 215
 * frames in: no error, no output, four Electron processes at flat CPU.
 *
 * The ceiling is here rather than at each call site because everything else in
 * this file is built on `evalIn`, and two of the things built on it LOOK
 * bounded and are not: `waitFor` polls against a deadline, but its deadline is
 * only checked between calls, so one call that never returns is a deadline that
 * is never reached again. A bound at the bottom is a bound everywhere; a bound
 * at the top is one place it was remembered.
 *
 * The timeout answers a sentinel rather than throwing. Every caller already has
 * a „the page did not have it" branch — `waitFor` keeps polling, `openModule`
 * reports no sidebar row, `fanoutLabels` warns about a stale selector — and a
 * symbol equals none of the values they test for, so each falls into the branch
 * it already had.
 */
async function evalIn(win: BrowserWindow, code: string): Promise<unknown> {
  const answer = await withCeiling(
    win.webContents.executeJavaScript(code, true) as Promise<unknown>,
    EVAL_CEILING_MS,
    EVAL_TIMED_OUT,
  );
  if (answer === EVAL_TIMED_OUT && !ceilingReported) {
    // Once, not per call: a suspended renderer produces one of these for every
    // remaining step, and ten thousand identical lines hide the first one.
    ceilingReported = true;
    process.stderr.write(
      `shots: the renderer did not answer within ${EVAL_CEILING_MS} ms — the sweep is ` +
        `continuing, but frames from here on may be unsettled. A window Chromium ` +
        `considers occluded suspends animation frames; see backgroundThrottling in ` +
        `createWindow.\n`,
    );
  }
  return answer;
}

/**
 * Waits until a selector matches, then a little longer.
 *
 * The extra settle is not superstition: React commits, then the browser lays
 * out, then transitions run. Photographing on the commit catches elements
 * mid-transition, which produces frames that look like defects and are not —
 * the most expensive kind of false finding, because it costs a real
 * investigation to dismiss.
 */
async function waitFor(win: BrowserWindow, selector: string, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await evalIn(win, `document.querySelector(${JSON.stringify(selector)}) !== null`);
    if (found === true) return true;
    await pause(80);
  }
  return false;
}

/** Two animation frames plus a fixed tail — long enough for a CSS transition to finish. */
async function settle(win: BrowserWindow): Promise<void> {
  await evalIn(
    win,
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`,
  );
  await pause(220);
}

/**
 * How many times one frame is worth asking for. See `capture`.
 *
 * Four rather than two because the back-off grows with the attempt, so the
 * total wait is 0,25 s + 0,5 s + 0,75 s — a second and a half spent at most
 * once in a sweep, against a run that otherwise ends.
 */
const CAPTURE_ATTEMPTS = 4;

/**
 * One frame, asked for until the compositor actually has one.
 *
 * `capturePage()` is not a pure read of a surface that is already there: it
 * asks Chromium's compositor to produce a bitmap, and the compositor can answer
 * with nothing. Electron surfaces that as a rejected promise whose message is
 * `VizSentEmptyBitmap`, and it is transient — the next frame is fine. It
 * happens most readily just after a window resize, which is exactly what this
 * sweep does eight times.
 *
 * Taken once, it ended a run 2 200 frames deep, and every finding those frames
 * had already made went with it.
 *
 * An empty bitmap can also arrive as a SUCCESS rather than as a throw — a
 * zero-sized image is not an error — and `toPNG()` on one writes a file no
 * viewer opens. That is the worse half of the two, because it does not stop
 * anything: it leaves a frame on disk that reads as a page that rendered
 * nothing. Both shapes are retried here, and the difference between them is
 * only in the message the last attempt throws.
 */
export async function capture(win: BrowserWindow, file: string): Promise<void> {
  let failure: unknown;
  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt += 1) {
    try {
      const image = await win.webContents.capturePage();
      if (!image.isEmpty()) {
        writeFileSync(file, image.toPNG());
        return;
      }
      failure = new Error(`capturePage answered an empty image for ${file}`);
    } catch (error) {
      failure = error;
    }
    // Not after the last one: there is nothing left to wait for.
    if (attempt < CAPTURE_ATTEMPTS) await pause(250 * attempt);
  }
  throw failure instanceof Error ? failure : new Error(String(failure));
}

async function auditPage(win: BrowserWindow): Promise<AuditFinding[]> {
  const raw = await evalIn(win, AUDIT_SCRIPT);
  return Array.isArray(raw) ? (raw as AuditFinding[]) : [];
}

/**
 * Serves a theme by storing the preference and reloading, rather than by
 * clicking the topbar toggle.
 *
 * The toggle would work, but it is a control whose label and position are part
 * of what this sweep exists to change. A reload goes through `main.tsx`'s
 * `applyStoredThemePreference` — the same path a real launch takes — so the
 * frames show the app as it opens, not as it looks after being poked.
 */
async function serveTheme(win: BrowserWindow, theme: ShotTheme): Promise<void> {
  await evalIn(win, `(() => { localStorage.setItem("nexus.theme", ${JSON.stringify(theme)}); return true; })()`);
  win.webContents.reload();
  // Bounded for `evalIn`'s reason: a `once` listener for an event that has
  // already fired, or that a suspended page never reaches, waits for ever. The
  // `waitFor` below is the real check that the reload landed, so overshooting
  // this one costs a scene rather than the run.
  await withCeiling(
    new Promise<void>((resolve) => win.webContents.once("did-finish-load", () => resolve())),
    EVAL_CEILING_MS,
    undefined,
  );
  await waitFor(win, ".app__sidebar");
  await settle(win);
}

/** Lands on a module by its stable id, never by its (translated) label. */
async function openModule(win: BrowserWindow, moduleId: string): Promise<boolean> {
  const selector = JSON.stringify(`[data-module-id="${moduleId}"]`);
  const clicked = await evalIn(
    win,
    `(() => {
       const row = document.querySelector(${selector});
       if (!row) return false;
       row.click();
       return true;
     })()`,
  );
  if (clicked !== true) return false;
  await settle(win);
  return true;
}

/** The labels of every switcher option on the current page, in document order. */
async function fanoutLabels(win: BrowserWindow, selector: string): Promise<string[]> {
  const raw = await evalIn(
    win,
    `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map(
       (el) => (el.textContent || "").replace(/\\s+/g, " ").trim(),
     )`,
  );
  return Array.isArray(raw) ? (raw as string[]) : [];
}

async function clickFanout(win: BrowserWindow, selector: string, index: number): Promise<void> {
  await evalIn(
    win,
    `(() => {
       const options = document.querySelectorAll(${JSON.stringify(selector)});
       const option = options[${index}];
       if (option) option.click();
       return true;
     })()`,
  );
  await settle(win);
}

/** A file-system-safe stem: the sweep names frames after Serbian switcher labels. */
function slug(label: string): string {
  const folded = label
    .toLowerCase()
    .replace(/š/g, "s")
    .replace(/đ/g, "dj")
    .replace(/č|ć/g, "c")
    .replace(/ž/g, "z")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return folded.length > 0 ? folded.slice(0, 32) : "view";
}

// --- The sweep --------------------------------------------------------------

/**
 * The sweep, and its report written whether or not the sweep finishes.
 *
 * The report is the product here; the PNGs are its evidence. Writing it only on
 * the success path meant that a single transient capture failure discarded
 * every finding already made — and did something quieter and worse: the frames
 * are written one at a time as they are taken, so a run that dies late leaves
 * two thousand fresh PNGs sitting next to a `report.md` describing the PREVIOUS
 * run. Nothing in either file says so. A stale report next to fresh frames is
 * read as a report ABOUT them.
 *
 * So the writes are in a `finally`, and the failure still propagates: the run
 * exits non-zero and says what broke, and the reader gets the findings from the
 * part that ran.
 */
export async function runShots(win: BrowserWindow, outDir: string): Promise<ShotFrame[]> {
  const frames: ShotFrame[] = [];
  try {
    await sweep(win, outDir, frames);
  } finally {
    writeFileSync(join(outDir, "frames.json"), `${JSON.stringify(frames, null, 2)}\n`);
    writeFileSync(join(outDir, "report.md"), buildReport(frames));
  }
  return frames;
}

async function sweep(win: BrowserWindow, outDir: string, frames: ShotFrame[]): Promise<void> {
  // Every file this run has written. A stem is derived from a LABEL and is
  // therefore not unique by construction, so without this the second frame of
  // a colliding pair overwrites the first without a word — see `shoot`.
  //
  // It covers `shoot`, and `shoot` is the only path whose file name comes
  // from a LABEL. The write probe names its frames after module ids and the
  // maximised frame is a constant, so neither can collide by construction —
  // which is a fact about them, not an exemption. A third path that derives a
  // name from anything a person typed belongs behind this set too (DC-61: a
  // rule over a reachability set permits everything outside it).
  const taken = new Set<string>();
  for (const size of SHOT_SIZES) {
    // Outer dimensions, matching `createWindow` — the frames must show the
    // viewport a real window of this size actually has, chrome included.
    win.setSize(size.width, size.height);
    await pause(300);

    for (const theme of SHOT_THEMES) {
      await serveTheme(win, theme);
      const dir = join(outDir, size.id, theme);
      mkdirSync(dir, { recursive: true });

      for (const scene of SHOT_SCENES) {
        if (!(await openModule(win, scene.module))) {
          process.stderr.write(`shots: no sidebar row for module "${scene.module}"\n`);
          continue;
        }
        if (scene.prepare !== undefined) {
          const outcome = await evalIn(win, scene.prepare);
          // `OPEN_FIRST` answers "none" when no candidate matched. Said out
          // loud, because the frame it would otherwise produce looks like a
          // perfectly ordinary list rather than like a broken scene.
          if (outcome === "none") {
            process.stderr.write(`shots: scene "${scene.id}" found nothing to open\n`);
          }
          await settle(win);
        }

        const shoot = async (stem: string): Promise<void> => {
          // THE SIZE IS RE-ASSERTED AT EVERY FRAME, not once per pass.
          //
          // `setSize` at the top of the loop is a claim that has to hold for
          // four hundred captures, and on 2026-08-21 it stopped holding a
          // hundred and eighty frames into the „min" pass: the window came back
          // MAXIMISED and the sweep went on writing 1920×1032 images into
          // `min/` and auditing them as if they were 900×600. Every responsive
          // rule in the product was reported on at a width nobody had asked
          // about, and the run still said „SHOTS OK". A frame is LABELLED with a
          // size, so the size has to be true of the frame rather than of the
          // loop that opened it.
          if (win.isMaximized()) win.unmaximize();
          const actual = win.getSize();
          if (actual[0] !== size.width || actual[1] !== size.height) {
            // Said out loud. A correction that stays silent turns „the window
            // moved" into a fact only this file knows, and the cause — whatever
            // maximises a window mid-sweep — is worth finding.
            const was = `${String(actual[0])}×${String(actual[1])}`;
            const want = `${String(size.width)}×${String(size.height)}`;
            process.stderr.write(`shots: window was ${was} at "${stem}", not ${want} — corrected\n`);
            win.setSize(size.width, size.height);
            await pause(300);
            await settle(win);
          }
          // TWO FRAMES THAT WANT ONE FILE.
          //
          // A stem is not an identity. It comes from the rail row's LABEL,
          // diacritics folded and truncated to 32 characters by `slug` — so two
          // distinct names can produce one stem, and two identical names
          // certainly do. Until 2026-08-22 the second capture simply overwrote
          // the first: the sweep reported 2 423 frames over 2 399 files on disk
          // and still printed „SHOTS OK", and the twenty-four images that
          // vanished were the evidence for a real defect in the catalogue
          // (DC-75) — found only by subtracting one number from the other, by
          // hand, once.
          //
          // Renaming the four tools fixed the catalogue and fixes nothing here:
          // the mechanism is the instrument's, so the rule belongs to the
          // instrument. A sweep that loses a frame in silence is worse than one
          // that refuses to take it, so both frames are kept, the collision is
          // said out loud, and `buildReport` carries it into the report — which
          // is the artefact anybody actually reads.
          let named = stem;
          for (let n = 2; taken.has(join(dir, `${named}.png`)); n += 1) {
            named = `${stem}-${String(n)}`;
          }
          if (named !== stem) {
            process.stderr.write(
              `shots: two frames named "${stem}" in ${size.id}/${theme} — kept as ${named}.png\n`,
            );
          }
          const file = join(dir, `${named}.png`);
          taken.add(file);
          await capture(win, file);
          frames.push({
            file,
            scene: stem,
            theme,
            size: size.id,
            findings: await auditPage(win),
          });
        };

        await shoot(scene.id);

        // The sub-view sweep. `fanout: null` suppresses it; anything else
        // enumerates what is on the page right now rather than what someone
        // remembered to list here.
        const selector = scene.fanout === undefined ? DEFAULT_FANOUT : scene.fanout;
        if (selector !== null) {
          const labels = await fanoutLabels(win, selector);
          // A fan-out that matches NOTHING is the quietest way for this sweep
          // to be wrong: the scene still produces its one frame, the run still
          // says „OK", and a whole module's sub-views are simply missing from
          // the output. That is exactly how „Alatke" went unphotographed. A
          // scene that genuinely has no switcher says so with `fanout: null`
          // and never reaches this line, so an empty match here is always a
          // selector that has gone stale.
          if (labels.length === 0) {
            process.stderr.write(
              `shots: scene "${scene.id}" found nothing to fan out (${selector})
`,
            );
          }
          // The first option is already on screen — it is what `shoot` above
          // just captured — so the sweep starts at the second.
          for (let index = 1; index < labels.length; index += 1) {
            await clickFanout(win, selector, index);
            await shoot(`${scene.id}--${slug(labels[index] ?? String(index))}`);
          }
          // A SCENE LEAVES THE SWITCHER WHERE IT FOUND IT.
          //
          // The loop above ends on the LAST sub-view, and several of these
          // switchers are backed by a persisted preference — so the next pass
          // opened the module there instead of on its default view. The cost
          // was not one odd frame. „Kalendar" opens on „Mesec", the month grid
          // is its whole point, and because the first pass ended on „Ljudi" the
          // month grid appeared in exactly ONE of 2 423 frames: `min/noc`. It
          // was never photographed at the two larger sizes, never in „Dan", and
          // the two real findings it carries would have been reported at one
          // width and called a small-window problem.
          //
          // It also made the fan-out itself uneven. „Ljudi" has no source row
          // and no create form, so the same scene enumerated eighteen options
          // in the first pass and six in the next — the sweep photographing a
          // different set of surfaces at each size, with nothing saying so.
          //
          // One click back to the first option costs one navigation per scene
          // per pass and makes „the first option is already on screen", which
          // the loop above asserts, true in every pass rather than only the
          // first.
          if (labels.length > 1) await clickFanout(win, selector, 0);
        }

        if (scene.cleanup !== undefined) {
          await evalIn(win, scene.cleanup);
          await settle(win);
        }
      }
    }
  }

  // The write pass, once, at the end.
  //
  // Photographing a page proves it renders. Typing into it and submitting
  // proves the whole path — renderer to preload to IPC to SQLite and back —
  // works against a profile that already holds hundreds of rows, which is the
  // case no unit test has. It runs last because every probe leaves a row
  // behind, and it is outside the size/theme loop because running it eighteen
  // times would leave eighteen.
  {
    const dir = join(outDir, "write", "noc");
    mkdirSync(dir, { recursive: true });
    await serveTheme(win, "noc");
    for (const moduleId of WRITE_MODULES) {
      if (!(await openModule(win, moduleId))) continue;
      const outcome = await evalIn(win, WRITE_PROBE(`${WRITE_MARKER} · ${moduleId}`));
      if (outcome !== "submitted") {
        process.stderr.write(`shots: write probe on "${moduleId}" found no create form\n`);
        continue;
      }
      // Long enough for the IPC round trip and the list's re-render. A write
      // that has not landed yet photographs as a write that did not work.
      await pause(600);
      await settle(win);
      const file = join(dir, `${moduleId}.png`);
      await capture(win, file);
      frames.push({
        file,
        scene: `write-${moduleId}`,
        theme: "noc",
        size: "write",
        findings: await auditPage(win),
      });
    }
  }

  // Maximised, once, at the end.
  //
  // It is not one of the three sizes because it is not a size — it is a WINDOW
  // STATE, and with `frame: false` it is the state most likely to be wrong.
  // Windows keeps an invisible 8px resize border on a frameless window, and a
  // maximised one can push that border past the work area and take a slice of
  // the title strip with it; the drawn maximise glyph also has to have become a
  // restore glyph. Neither shows up at any window size that is merely large.
  {
    const dir = join(outDir, "maximized", "noc");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "dashboard.png");
    await serveTheme(win, "noc");
    win.maximize();
    await pause(400);
    if (!win.isMaximized()) {
      // One retry. `maximize()` is a REQUEST to the window manager, not a
      // setter, and on Windows it can be swallowed while the window is still
      // settling from the `setSize` of the pass before.
      win.maximize();
      await pause(800);
    }
    if (!win.isMaximized()) {
      // No frame rather than a false one. This is the only capture in the sweep
      // whose subject IS the window state, so a frame taken in some other state
      // is not a weaker piece of evidence — it is a wrong one, filed under a
      // name that says otherwise. DC-74, in the one place `shoot`'s per-frame
      // assertion does not reach.
      process.stderr.write(
        "shots: the window did not maximise — no „maximized“ frame was taken\n",
      );
      // And the previous run's frame goes with it. The sweep overwrites in
      // place rather than wiping its output, so a refusal that left the old
      // image on the disk would leave exactly the artefact the refusal exists
      // to avoid — a picture under a name that is no longer true of it.
      rmSync(file, { force: true });
    } else {
      await settle(win);
      await capture(win, file);
      frames.push({
        file,
        scene: "dashboard",
        theme: "noc",
        size: "maximized",
        findings: await auditPage(win),
      });
      win.unmaximize();
      await pause(300);
    }
  }

  // The questionnaire, last of all.
  //
  // It COMPLETES, which rewrites this profile's flags, board and sidebar — so
  // it runs after every other frame has been taken rather than before any of
  // them. It is its own loop over sizes and themes rather than a scene, for the
  // reason `ONB_SCREENS` gives: it is not a page, and `openModule` is how every
  // scene above begins.
  for (const size of SHOT_SIZES) {
    win.setSize(size.width, size.height);
    await pause(300);
    for (const theme of SHOT_THEMES) {
      await serveTheme(win, theme);
      const dir = join(outDir, size.id, theme);
      mkdirSync(dir, { recursive: true });

      // These stems are constants, so unlike `shoot`'s they cannot collide with
      // each other by construction — the write probe's argument, and the reason
      // this path is allowed to stand outside `taken`.
      const shootOnb = async (stem: string): Promise<void> => {
        if (win.isMaximized()) win.unmaximize();
        const actual = win.getSize();
        if (actual[0] !== size.width || actual[1] !== size.height) {
          const was = `${String(actual[0])}×${String(actual[1])}`;
          const want = `${String(size.width)}×${String(size.height)}`;
          process.stderr.write(`shots: window was ${was} at "${stem}", not ${want} — corrected\n`);
          win.setSize(size.width, size.height);
          await pause(300);
        }
        await settle(win);
        const file = join(dir, `${stem}.png`);
        await capture(win, file);
        frames.push({ file, scene: stem, theme, size: size.id, findings: await auditPage(win) });
      };

      if (!(await openModule(win, "settings"))) {
        process.stderr.write(`shots: no sidebar row for module "settings"\n`);
        continue;
      }
      await evalIn(win, CLICK("#set-section-setup .set__module-row--foot .nx-button"));
      await settle(win);
      if ((await evalIn(win, ONB_PHASE)) !== "asking") {
        // Said out loud and abandoned rather than photographed. Every frame
        // below would otherwise be the settings page under a questionnaire's
        // name, which reads as „the questionnaire looks like Podešavanja“.
        process.stderr.write("shots: the rerun row did not open the questionnaire\n");
        continue;
      }

      for (let index = 0; index < ONB_SCREENS.length; index += 1) {
        const screen = ONB_SCREENS[index] ?? "";
        const step = await evalIn(win, ONB_STEP);
        if (step !== String(index + 1)) {
          process.stderr.write(
            `shots: questionnaire was on step ${String(step)}, not ${String(index + 1)} ("${screen}")\n`,
          );
          break;
        }
        // Answered BEFORE the frame: an unanswered screen is the one state none
        // of these six is interesting in.
        if (screen === "posao") {
          if ((await evalIn(win, ONB_TYPE(".onb__form input", ONB_TRADE))) !== "typed") {
            process.stderr.write("shots: the trade field was not on the „posao“ screen\n");
          }
          await settle(win);
          await evalIn(win, ONB_PICK(".onb__act", 0, 4));
        }
        const answer = ONB_ANSWERS[screen];
        if (answer !== null && answer !== undefined && (await evalIn(win, answer)) !== "picked") {
          process.stderr.write(`shots: nothing to answer on the „${screen}“ screen\n`);
        }
        await settle(win);
        await shootOnb(`onb-${screen}`);
        await evalIn(win, CLICK(".onb__actions .nx-button[type=submit]"));
        await settle(win);
      }

      // „Priprema“, caught mid-flight. Each stage is held for `STAGE_MS` (520)
      // and there are five, so a frame at ~800 ms lands on the second or third
      // with the ones behind it already ticked — which is the state worth
      // having, rather than a list of five identical pending rows.
      await pause(800);
      if ((await evalIn(win, ONB_PHASE)) === "prepare") await shootOnb("onb-priprema");
      else process.stderr.write("shots: „Priprema“ was over before it could be photographed\n");

      // The far side. Generous, because the beats are a FLOOR under real work —
      // four flag loops, a board rebuild and a rename — not a fixed animation.
      await pause(4000);
      if ((await evalIn(win, ONB_PHASE)) !== "reveal") {
        process.stderr.write("shots: the reveal never arrived — no „Evo tvog Nexusa“ frame\n");
        continue;
      }
      await shootOnb("onb-evo");

      await evalIn(win, CLICK(".onb__quiet"));
      await settle(win);
      if ((await evalIn(win, ONB_PHASE)) === "manual") {
        await shootOnb("onb-rucno");
        // Back to the reveal rather than saving: „Podesi ručno“ writes its own
        // deltas and this pass has nothing to say about the modules — it is
        // here to be photographed, not to decide anything.
        await evalIn(win, CLICK_THEN(".onb__actions .nx-button"));
        await settle(win);
      } else {
        process.stderr.write("shots: „Podesi ručno“ did not open\n");
      }

      // And out through the front door, so the shell is back for the next pass.
      await evalIn(win, CLICK(".onb__enter"));
      await settle(win);
      if ((await evalIn(win, ONB_PHASE)) !== "none") {
        process.stderr.write("shots: the questionnaire did not close\n");
      }
    }
  }
}

/**
 * The frames that wanted one file, as `size/theme/stem`.
 *
 * DERIVED from the frame list rather than tracked beside it, and that is the
 * whole point: the frame list is what the report is written from, so a
 * collision recorded in a second place is a collision that can go missing from
 * the report while the sweep still knows about it. Here the two cannot drift —
 * if a duplicate is in the frames, it is in the report.
 *
 * A duplicate here is never a fault of the sweep. It says either that two rows
 * on one rail carry the same name (`modules.test.ts` refuses that now) or that
 * two different names fold to one stem — 32 characters, no diacritics. Both are
 * findings about the app, which is why this is reported rather than silently
 * renamed away.
 */
export function duplicateStems(frames: readonly ShotFrame[]): readonly string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const frame of frames) {
    const key = `${frame.size}/${frame.theme}/${frame.scene}`;
    if (seen.has(key)) twice.add(key);
    else seen.add(key);
  }
  return [...twice].sort();
}

/**
 * The findings, grouped so the reader sees CLASSES rather than instances.
 *
 * A defect in a shared component reports once per surface it appears on; a list
 * sorted by file would therefore bury a single root cause under forty rows. The
 * grouping is by kind and element, which is the shape a fix actually has.
 */
function buildReport(frames: readonly ShotFrame[]): string {
  const byKey = new Map<string, { finding: AuditFinding; scenes: Set<string> }>();
  for (const frame of frames) {
    for (const finding of frame.findings) {
      const key = `${finding.kind}|${finding.where}|${finding.other}`;
      const existing = byKey.get(key);
      const scene = `${frame.size}/${frame.theme}/${frame.scene}`;
      if (existing === undefined) byKey.set(key, { finding, scenes: new Set([scene]) });
      else existing.scenes.add(scene);
    }
  }

  const rows = [...byKey.values()].sort((a, b) => b.scenes.size - a.scenes.size);
  const lines = [
    "# Layout audit",
    "",
    `${frames.length} frames, ${rows.length} distinct findings.`,
    "",
  ];
  // A collision is not a layout finding and has no place in the table below —
  // but it IS a defect, and the reader must not have to subtract one number
  // from another to notice it, which is how it was noticed the first time.
  const duplicates = duplicateStems(frames);
  if (duplicates.length > 0) {
    lines.push(
      `**${String(duplicates.length)} frame(s) wanted a file another frame had taken.**`,
      "Either two rows on one rail carry the same name, or two different names",
      "fold to one 32-character stem. Both frames were kept; the second of each",
      "pair carries a `-2` suffix.",
      "",
      ...duplicates.map((key) => `- \`${key}\``),
      "",
    );
  }
  lines.push(
    "| kind | element | other | px | surfaces | text |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const row of rows) {
    const { finding, scenes } = row;
    lines.push(
      `| ${finding.kind} | \`${finding.where}\` | \`${finding.other}\` | ${finding.amount} | ` +
        `${scenes.size} | ${finding.text.replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("", "## Where each finding appears", "");
  for (const row of rows) {
    lines.push(
      `- **${row.finding.kind}** \`${row.finding.where}\` — ${[...row.scenes].slice(0, 12).join(", ")}` +
        `${row.scenes.size > 12 ? ` … +${row.scenes.size - 12}` : ""}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

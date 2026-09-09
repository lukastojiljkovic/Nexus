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

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
  {
    // „Podesi…" (DASH-004): the per-widget config form, which is the ⋯ menu
    // flipped into a second mode. Two clicks from a landing the sweep already
    // visits, and never photographed — so the count picker inside it was
    // reviewed by opening the app by hand, which is how it kept the operating
    // system's own arrow while the selects around it stopped having one.
    id: "dashboard-widget-config",
    module: "dashboard",
    prepare: OPEN_WIDGET_CONFIG(),
    fanout: null,
    cleanup: LEAVE_EDIT_MODE(),
  },
  { id: "tasks", module: "tasks" },
  {
    // „Priliv i odliv", which the landing no longer draws by itself.
    id: "tasks-overview",
    module: "tasks",
    prepare: OPEN_OVERVIEW(),
    fanout: null,
    cleanup: CLOSE_OVERVIEW(),
  },
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
  {
    // „Prilagođeno": the recurrence editor, which is the biggest surface in the
    // product the camera had never been to. It is three steps inside a form —
    // open the details pane, put a date in the rok, then choose the last option
    // of the repetition picker — and until this scene existed, six controls,
    // their labels and the panel around them were reviewed by opening the app
    // by hand or not at all. That is DC-57's shape, and it is the same argument
    // `check:controls` makes about a form three modal steps deep: a rule
    // enforced by photography holds only where the camera goes.
    id: "tasks-recurrence",
    module: "tasks",
    prepare: OPEN_RECURRENCE_EDITOR(),
    fanout: null,
    cleanup: CLOSE_RECURRENCE_EDITOR(),
  },
  {
    // The rail's own create forms. The rail is outside the view switch, so it
    // is on the page whatever view the scene above left open.
    id: "tasks-new-list",
    module: "tasks",
    prepare: OPEN_CREATE_FORM({ open: ".tasks__new-list" }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
  },
  {
    id: "tasks-new-tag",
    module: "tasks",
    prepare: OPEN_CREATE_FORM({ open: ".tasks__new-tag" }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
  },
  {
    // „Nova sekcija" is the one TASK create form with a precondition: it is
    // drawn only for a SELECTED list, and the scenes above leave the rail on a
    // smart view. So the path chooses a list first — and the form then renders
    // under that list's last group, which is what the scroll is for.
    //
    // The path is child-scoped, not just `.tasks__rail-list`. That class is
    // worn by BOTH kinds of rail row — the five Pregledi and the real lists —
    // because they are the same object to the eye and to the stylesheet, and
    // the Pregledi are drawn first. The short selector therefore chose „Danas",
    // which selects a smart view, which is precisely the state that removes the
    // button this scene came to press. Real lists are direct children of
    // `.tasks__rail`; the smart rows are inside `.tasks__rail-views`.
    //
    // LAST of the three, because it is the only one that leaves the module in a
    // different state than it found it.
    id: "tasks-new-section",
    module: "tasks",
    prepare: OPEN_CREATE_FORM({
      path: [".tasks__rail > .tasks__rail-row .tasks__rail-list"],
      open: ".tasks__new-section",
    }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
  },
  { id: "calendar", module: "calendar" },
  // CAL's two template panels, neither of which the sweep had ever seen. They
  // are the module's only surfaces behind a popover, and a popover closes the
  // moment anything else is clicked — so the fan-out that photographs every
  // view could not have caught them on the way past.
  //
  // Both name a `view` first, because the scene before this one leaves the
  // switcher wherever its last fan-out click landed, and neither panel exists
  // in „Dokumenta" or „Ljudi".
  {
    id: "calendar-templates",
    module: "calendar",
    prepare: OPEN_CREATE_FORM({
      path: ["text:Agenda"],
      open: ".cal__templates-trigger",
      expect: ".note__menu-panel",
    }),
    fanout: null,
    // The trigger is a toggle, so pressing it again is the way back out.
    cleanup: CLICK_THEN(".cal__templates-trigger"),
  },
  {
    // The naming line, which exists only for an event the form is HOLDING —
    // hence the edit click. „Sačuvaj kao šablon" is matched exactly rather than
    // by prefix: the panel's own submit says „Sačuvaj", and the form's does too.
    id: "calendar-save-template",
    module: "calendar",
    prepare: OPEN_CREATE_FORM({
      path: ["text:Agenda", ".cal__edit", ".cal__template-menu"],
      open: "text:Sačuvaj kao šablon",
      expect: ".cal__template-form",
    }),
    fanout: null,
    // One click, because `resetForm` unmounts the whole popover with the edit
    // state it belongs to — including the naming prompt, which it clears on
    // purpose rather than leaving armed for an event the form no longer holds.
    cleanup: CLICK_THEN(".cal__cancel"),
  },
  {
    // DOKUMENTI's renewal line, which replaces a row's trailing buttons with a
    // date field and two of its own. Same blind spot, third instance: it is
    // reached by pressing „Obnovi" on one row, so the panel's own frame shows
    // the list and never this.
    id: "calendar-documents-renew",
    module: "calendar",
    prepare: OPEN_CREATE_FORM({
      path: ["text:Dokumenta"],
      open: ".documents__renew-start",
      // The ROW, not the renewal line inside it. What is waited for is also
      // what is scrolled to the top of the frame, and scrolling to the line
      // cut its own row's title off above the fold — the frame then showed a
      // renewal for a document it did not name.
      expect: ".nx-list-row:has(.documents__renew)",
    }),
    fanout: null,
    cleanup: CLICK_THEN(".documents__renew-cancel"),
  },
  { id: "notes", module: "notes" },
  {
    // „Ritam pisanja" — the heatmap, its caption and its legend.
    id: "notes-overview",
    module: "notes",
    prepare: OPEN_OVERVIEW(),
    fanout: null,
    cleanup: CLOSE_OVERVIEW(),
  },
  {
    id: "notes-open",
    module: "notes",
    prepare: OPEN_FIRST(".note__item-row, .notes__row, .nx-list-row"),
    fanout: null,
  },
  // The organizer's three create forms. Each path clicks `.note__org-toggle`
  // and each cleanup clicks it again, which is the whole responsive story in
  // one line: under 1345px the organizer is a DRAWER and starts closed, so two
  // of the four window sizes would otherwise photograph a pane that is
  // `display: none`. At the wide sizes the toggle is `display: none` itself and
  // the pane is a grid column regardless of the state — a programmatic click
  // still runs the handler, and the state it flips changes nothing there. The
  // toggle is a TOGGLE, so the cleanup has to undo it: without that, the second
  // of these scenes would close the drawer the first one opened.
  {
    // By text, not by `.note__new-folder` — the „Nova kategorija" button below
    // wears that same class, so a selector would give both scenes the folder.
    id: "notes-new-folder",
    module: "notes",
    prepare: OPEN_CREATE_FORM({ path: [".note__org-toggle"], open: "text:Nova fascikla" }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži", ".note__org-toggle"),
  },
  {
    id: "notes-new-tag",
    module: "notes",
    prepare: OPEN_CREATE_FORM({ path: [".note__org-toggle"], open: ".note__new-tag" }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži", ".note__org-toggle"),
  },
  {
    id: "notes-new-category",
    module: "notes",
    prepare: OPEN_CREATE_FORM({ path: [".note__org-toggle"], open: "text:Nova kategorija" }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži", ".note__org-toggle"),
  },
  { id: "priv", module: "priv", fanout: null },
  { id: "files", module: "files" },
  { id: "study", module: "study", fanout: null },
  {
    // „Plan i stvarnost" — planned minutes against measured ones.
    id: "study-overview",
    module: "study",
    prepare: OPEN_OVERVIEW(),
    fanout: null,
    cleanup: CLOSE_OVERVIEW(),
  },
  // UČE's four hub forms. All by TEXT: „Dodaj ispit", „Dodaj špil" and „Dodaj
  // karticu" share the class `study__add-exam`, which is a copy-paste the
  // stylesheet does not mind and a selector cannot survive — one of the three
  // would have answered for all three, and every frame would have been filed
  // under a name it did not show.
  {
    id: "study-new-subject",
    module: "study",
    prepare: OPEN_CREATE_FORM({ open: "text:Dodaj predmet" }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
  },
  {
    id: "study-new-exam",
    module: "study",
    prepare: OPEN_CREATE_FORM({ open: "text:Dodaj ispit" }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
  },
  {
    id: "study-new-deck",
    module: "study",
    prepare: OPEN_CREATE_FORM({ open: "text:Dodaj špil" }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
  },
  {
    id: "study-new-plan",
    module: "study",
    prepare: OPEN_CREATE_FORM({ open: "text:Novi plan" }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
  },
  {
    // The deck DRILL-IN, which is a route rather than a form — and the reason
    // it is here is that the sweep has never photographed it either. „Kartice"
    // leaves the hub entirely, so every card row, every state chip and the
    // cloze and problem renderings live on a screen no frame has ever carried.
    //
    // LAST of the UČE scenes, and it walks itself back with `.study__back`: a
    // scene that leaves the module on a different route hands the next pass a
    // page it did not ask for.
    id: "study-cards",
    module: "study",
    prepare: CLICK_THEN("text:Kartice"),
    fanout: null,
    cleanup: CLICK_THEN(".study__back"),
  },
  {
    // „Dodaj karticu" is the one create form that is not on the hub at all: it
    // is three states deep — a subject, its deck, then the drill-in — which is
    // exactly the reach DC-57 describes and exactly why a native control could
    // sit in FIT's equivalent for as long as it did.
    //
    // It fans out, and this one is worth the three frames: the toggle at the
    // top swaps the form ENTIRELY — one textarea for a cloze template, two for
    // a basic card, three for a problem — so a single frame of „Osnovna" was
    // reporting on a third of the surface. The two it never showed are also
    // the two whose placeholders are worked examples rather than names.
    id: "study-new-card",
    module: "study",
    prepare: OPEN_CREATE_FORM({ path: ["text:Kartice"], open: "text:Dodaj karticu" }),
    fanout: ".study__segmented .nx-button",
    cleanup: CLICK_THEN("text:Otkaži", ".study__back"),
  },
  { id: "finance", module: "finance" },
  {
    // NOVAC's rail forms, and „Nova pretplata" on the third of the page's three
    // halves. The path re-states the half every time because the scene above
    // fans out through the switcher and stops on whichever option came last —
    // a module that is already open is not remounted, so the page it left is
    // the page these start from.
    id: "finance-new-account",
    module: "finance",
    prepare: OPEN_CREATE_FORM({
      path: [".fin__segmented .nx-segmented__option"],
      open: "text:Novi račun",
    }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
  },
  {
    id: "finance-new-category",
    module: "finance",
    prepare: OPEN_CREATE_FORM({
      path: [".fin__segmented .nx-segmented__option"],
      open: "text:Nova kategorija",
    }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
  },
  {
    id: "finance-new-subscription",
    module: "finance",
    prepare: OPEN_CREATE_FORM({
      path: [".fin__segmented .nx-segmented__option:nth-child(3)"],
      open: "text:Nova pretplata",
    }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži", ".fin__segmented .nx-segmented__option"),
  },
  { id: "habits", module: "habits", fanout: null },
  {
    // The wall: every live habit's month, the one picture of the regimen.
    id: "habits-overview",
    module: "habits",
    prepare: OPEN_OVERVIEW(),
    fanout: null,
    cleanup: CLOSE_OVERVIEW(),
  },
  {
    id: "habits-new",
    module: "habits",
    prepare: OPEN_CREATE_FORM({ open: "text:Nova navika" }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
  },
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
  {
    // „Nova vežba", the create form itself — the scene that started all of
    // these. A native checkbox sat in this form for as long as the form has
    // existed and nothing ever reported it: the sweep photographed the section
    // and never the form behind its primary button, so the one check that has
    // ever caught a bare `<input type="checkbox">` structurally could not see
    // this one. The class is now a gate (`check:controls`, DC-98); this is the
    // other half, and every create form in the list is here for its reason.
    //
    // The tab is named by INDEX because „Trening" is the third of four and the
    // scenes above leave the page on whichever tab their fan-out ended on — a
    // module that is already open is not remounted, so the section survives
    // into the next scene. Exact text is what keeps „Nova rutina", which sits
    // directly above it with a primary button of its own, out of this frame.
    id: "fitness-new-routine",
    module: "fitness",
    prepare: OPEN_CREATE_FORM({
      path: [".fit__section-tab:nth-child(3)"],
      open: "text:Nova rutina",
    }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
  },
  {
    id: "fitness-new-exercise",
    module: "fitness",
    prepare: OPEN_CREATE_FORM({
      path: [".fit__section-tab:nth-child(3)"],
      open: "text:Nova vežba",
    }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
  },
  {
    // „Ishrana" is the second tab, and its food form is the widest of the three
    // — seven numeric fields on one row.
    id: "fitness-new-food",
    module: "fitness",
    prepare: OPEN_CREATE_FORM({
      path: [".fit__section-tab:nth-child(2)"],
      open: "text:Nova namirnica",
    }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
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
    // The name line a new board opens with. It is one field and two buttons,
    // which is exactly the sort of surface that gets built once and never
    // looked at again — and it sits between the header and the board, so it is
    // also the one place on this page where a layout mistake moves everything
    // below it.
    id: "canvas-new-board",
    module: "canvas",
    prepare: OPEN_CREATE_FORM({ open: "text:Nova tabla" }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
  },
  {
    // The workbench with the demo profile's three circuits on it. `fanout: null`
    // because it genuinely has no segmented sub-views — the default selector
    // would find nothing and the sweep would rightly say so.
    id: "electronics",
    module: "electronics",
    fanout: null,
  },
  {
    // „Novo kolo" — ELEK's own name line, `canvas-new-board`'s twin, and first
    // among the ELEK scenes because it is the only one that needs nothing
    // selected. The three below it all put something in the inspector and
    // there is no click back to an empty bench that this list would not then
    // have to own.
    id: "electronics-new-circuit",
    module: "electronics",
    prepare: OPEN_CREATE_FORM({ open: "text:Novo kolo" }),
    fanout: null,
    cleanup: CLICK_THEN("text:Otkaži"),
  },
  {
    // „Mašina" (E4c) — the nine-field form, and a MODAL, so it is invisible to
    // every scene that does not open it exactly as „Kod" is. It sits HERE, and
    // not beside the code scenes, because the button that opens it lives in the
    // panel that appears when nothing is selected: after the two scenes below
    // there is a part or a wire in that panel and no way back to the circuit's
    // own without a click this list would then have to own.
    //
    // The frame is a FULL form rather than an empty one — the circuit the page
    // opens on is the demo rover, which is measured — and a filled field is the
    // one that can overflow. `.elec-inspector__machine-open` is an anchor with
    // no rule behind it, `.elec__code`'s arrangement: the sweep needs a name
    // for the control, and the control needs no style of its own.
    id: "electronics-chassis",
    module: "electronics",
    prepare: OPEN_CHASSIS_DIALOG(),
    fanout: null,
    cleanup: DISPATCH_KEY("Escape"),
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
  {
    // The mount picker (E4c), which the scene above cannot reach: it is drawn
    // only for a part the simulator has physics for, and `.elec-part__body`
    // takes whichever the DOM lists first — the rover's Raspberry Pi, which is
    // a board. By `aria-label`, because that is the part's own name on the
    // bench and the only stable way to ask for ONE of five identical rects.
    id: "electronics-mount",
    module: "electronics",
    prepare: POINTER_TAP('[aria-label="VL53L0X"] .elec-part__body'),
    fanout: null,
  },
  {
    // „Kod" — the generated code (E4), which is a MODAL and therefore invisible
    // to every scene above it: the sweep photographs what is on screen, and a
    // dialog nobody opened is not.
    //
    // Three scenes because ONE dialog has three shapes, and each carries a
    // section the other two do not. This first is the ROS 2 package, over the
    // circuit the page happens to open on — the switcher is sr-Latn
    // alphabetical, so „Malina: rover" is first and no preamble is needed to
    // reach it. **That holds because of where this scene SITS**, not because
    // the page returns to it: nothing above switches, and the two scenes below
    // do — so anything added after them names its circuit, as „Klupa" now does
    // after a sweep in which it did not. It is the widest of the three: a
    // five-column topics table, the „skipped" table the I²C pins produce, and —
    // because that circuit is the one with a measured chassis — the „Model
    // mašine" section with both of ITS tables, which no other frame carries.
    id: "electronics-code-ros",
    module: "electronics",
    prepare: OPEN_CODE_DIALOG(),
    fanout: null,
    // The dialog is a portal on `document.body`, and the scene after this one
    // stays on the same module — where nothing remounts. Escape is what closes
    // it, and this is the same recipe the shortcut sheet uses.
    cleanup: DISPATCH_KEY("Escape"),
  },
  {
    // The plain Arduino shape: an UNO and an HC-SR04 — two named pins, no
    // libraries, and a page of code that must scroll rather than push the
    // buttons off the bottom of the panel.
    id: "electronics-code-sketch",
    module: "electronics",
    prepare: OPEN_CODE_DIALOG(SWITCH_TO_CIRCUIT("Merenje")),
    fanout: null,
    cleanup: CLOSE_AND_RESTORE_CIRCUIT(),
  },
  {
    // And the loaded Arduino shape: a DHT22 brings a library list, and its DATA
    // pin is one the sketch deliberately does not name, so the wiring table
    // gets its „—" row and the sentence under it that explains one. Neither
    // section exists in the two frames above, and a section no frame carries is
    // a section nothing measures.
    id: "electronics-code-libraries",
    module: "electronics",
    prepare: OPEN_CODE_DIALOG(SWITCH_TO_CIRCUIT("Stanica")),
    fanout: null,
    cleanup: CLOSE_AND_RESTORE_CIRCUIT(),
  },
  {
    // „Klupa" — the circuit running (E5). A MODAL, so it is invisible to every
    // scene above it exactly as „Kod" is.
    //
    // THE ROVER IS ASKED FOR BY NAME, and that is the lesson of this pair.
    // „Kod"'s first scene reaches it with no preamble, and this one copied the
    // reasoning — but between the two sits a scene that switches to „Stanica",
    // and the switcher's choice persists across `openModule`. So the frame
    // photographed an UNO with a relay on it: one channel, no topic, one
    // skipped row, and every part of the dialog worth measuring absent, in an
    // image that looks like a perfectly ordinary bench. A scene that depends on
    // which record is open has to name it, because the scene above it is free
    // to change it and nothing downstream can tell that it did.
    //
    // The rover is the only circuit that fills this dialog. Its board runs
    // Linux, so the channels carry the topics the generated package publishes
    // on; its touch pad is a level the board READS and its buzzer a duty cycle
    // the board DRIVES, which are two of the three units and both directions;
    // and its two I²C parts produce the „šta klupa ne prati" table underneath.
    // On an Arduino circuit the topic column is „—" down its whole length and
    // that table has a single row.
    id: "electronics-sim",
    module: "electronics",
    prepare: OPEN_SIM_DIALOG(SWITCH_TO_CIRCUIT("Malina")),
    fanout: null,
    // A portal on `document.body`, and the scene after it stays on this module
    // where nothing remounts — the code scenes' cleanup, for their reason.
    cleanup: CLOSE_AND_RESTORE_CIRCUIT(),
  },
  {
    // The same dialog with the pickers moved, which is the only way the other
    // three waveform forms are ever on screen — see {@link SET_WAVE_KINDS}.
    //
    // TWO SCENES AND NOT ONE, because the rover has two channels and a frame
    // therefore holds two forms. Dealing all four across two pickers photographs
    // the first two and silently drops „Koraci" — the only shape with a list
    // field and the only one carrying a hint, which is to say the one most worth
    // photographing. „Stalna vrednost" is the fourth and needs no scene: it is
    // what every channel opens on, in the frame above.
    id: "electronics-sim-waves",
    module: "electronics",
    prepare: OPEN_SIM_DIALOG(SWITCH_TO_CIRCUIT("Malina"), SET_WAVE_KINDS(["square", "ramp"])),
    fanout: null,
    cleanup: CLOSE_AND_RESTORE_CIRCUIT(),
  },
  {
    // „Koraci" on every channel: a wider field holding a semicolon-separated
    // list, and the one line of copy that says the separator is a semicolon.
    id: "electronics-sim-steps",
    module: "electronics",
    prepare: OPEN_SIM_DIALOG(SWITCH_TO_CIRCUIT("Malina"), SET_WAVE_KINDS(["steps"])),
    fanout: null,
    cleanup: CLOSE_AND_RESTORE_CIRCUIT(),
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
  {
    // „Privatne beleške", by the same route as the card above it.
    //
    // Said plainly, because a frame that shows less than its name promises is
    // the thing this file keeps warning about: the demo profile has NO private
    // section, so what this photographs is the card's not-set-up state. The
    // auto-lock knob — the one `Select` on this page in a plain column rather
    // than a `.set__field` grid, and therefore the one whose width nothing else
    // answers — appears only once the section exists. The scene is still worth
    // having: the card was below the fold and unphotographed either way, and it
    // starts showing the knob the day the demo seed sets the section up.
    id: "settings-priv",
    module: "settings",
    prepare: SCROLL_TO("#set-section-priv"),
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
 *
 * Two rAFs are enough for a target that does not exist yet, and NOT enough for
 * one that exists on the outgoing state: a control can be present and enabled
 * and still belong to the entity the previous step just navigated away from.
 * A step that has to outlast an async load wants the OUTCOME rather than a
 * count of frames — see {@link OPEN_CODE_DIALOG}, which is what a scene that
 * needed one had to be written as.
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
 * Opens a module landing's „Pregled" fold, and waits for it to BE open.
 *
 * The fold is why these scenes exist. NOTE's heatmap, TASK's flow chart,
 * NAVIKE's wall and UČENJE's plan-against-actual used to be permanently drawn
 * on their landings, so the sweep photographed all four without being asked;
 * folding them (`overviewPrefs.ts`) took four graphics OUT of the sweep on the
 * same commit. A fix that quietly stops four surfaces being photographed has
 * traded one defect for a blind spot, so each fold gets a scene that opens it.
 *
 * Not `CLICK_THEN`, for the reason `OPEN_CODE_DIALOG` is not either: that
 * helper clicks and hopes. A click that misses here produces the LANDING again
 * — a perfectly ordinary frame under a name that says the fold is open — which
 * is the quietest way for a scene to be wrong. This asks `aria-expanded`
 * afterwards and says „none" when the answer is not what it asked for.
 *
 * The first `.nx-disclosure` is the fold on all four landings; TASK's second
 * one is its archive, further down and inside the list.
 */
function OPEN_OVERVIEW(): string {
  return `(async () => {
    const trigger = document.querySelector(".nx-disclosure");
    if (!trigger) return "none: no .nx-disclosure on this landing";
    if (trigger.getAttribute("aria-expanded") !== "true") {
      trigger.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    return trigger.getAttribute("aria-expanded") === "true" ? "open" : "none: it stayed closed";
  })()`;
}

/**
 * Puts it back, and this one is not optional.
 *
 * The fold is a DEVICE preference: opening it writes `nexus.<module>.overview`
 * in the sweep profile's storage, and a scene that left it open would hand the
 * next run a different app — every later frame of that module folded out, with
 * nothing in the report to say why. The click is the user's own path back, so
 * it exercises the persist in both directions.
 */
function CLOSE_OVERVIEW(): string {
  return `(() => {
    const trigger = document.querySelector(".nx-disclosure");
    if (trigger && trigger.getAttribute("aria-expanded") === "true") trigger.click();
    return true;
  })()`;
}

/**
 * Opens ELEC's „Kod" dialog, and waits for **the dialog**.
 *
 * Not assembled from {@link CLICK_THEN} because of the one thing that helper
 * cannot do: wait for a condition. Opening a circuit is an IPC round trip and
 * „Kod" is disabled until it lands, so a fixed number of frames is a bet.
 *
 * **Two failed drafts are why the wait is on the outcome.** Selecting a circuit
 * only schedules the page's effect, so for one turn the button is still enabled
 * on the OUTGOING document: draft one clicked there, the effect ran a moment
 * later and did exactly its job — dropping a dialog that belongs to the circuit
 * that just closed — and the frame was the ordinary page under a dialog's name.
 * Draft two therefore waited for the button to be seen DISABLED first, and
 * never saw it: `setDoc(null)` and the `setDoc(opened)` that follows a
 * sub-millisecond IPC read coalesce into one React render, so the loading state
 * is real and is never painted. A precondition you hope implies the outcome is
 * not a wait. The panel is in the DOM or it is not, so the loop clicks and
 * re-checks until it is, and says `"none"` if it never gets there.
 *
 * `preamble` is statements to run first, inside the same async function, for a
 * scene that has to get somewhere before there is anything to open.
 */
function OPEN_CODE_DIALOG(preamble = ""): string {
  return `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
${preamble}
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (document.querySelector(".elec-code__panel")) return true;
    const code = document.querySelector(".elec__code");
    if (code && !code.disabled) code.click();
    await frame();
  }
  return "none";
})()`;
}

/**
 * Opens ELEC's „Mašina" dialog, on {@link OPEN_CODE_DIALOG}'s recipe and for
 * its reasons.
 *
 * The same two hazards apply verbatim — the button is disabled until the
 * circuit's IPC read lands, and the loading state between `setDoc(null)` and
 * `setDoc(opened)` is never painted — so the wait is again on the OUTCOME:
 * the panel is in the DOM or it is not.
 *
 * One difference worth stating, because it is the reason this is not a
 * `preamble` on the other helper: the button lives in the panel that is drawn
 * only while NOTHING is selected, so this scene has to run before the two that
 * select something rather than after them.
 */
function OPEN_CHASSIS_DIALOG(): string {
  return `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (document.querySelector(".elec-chassis__panel")) return true;
    const open = document.querySelector(".elec-inspector__machine-open");
    if (open && !open.disabled) open.click();
    await frame();
  }
  return "none";
})()`;
}

/**
 * Opens ELEC's „Klupa" dialog (E5), on {@link OPEN_CODE_DIALOG}'s recipe and
 * for its two reasons verbatim: the button is disabled until the circuit's IPC
 * read lands, and the render between `setDoc(null)` and `setDoc(opened)` is
 * never painted, so the wait is on the OUTCOME rather than on a precondition.
 *
 * `after` is statements to run once the panel is up, which the code dialog
 * needed no equivalent of: „Kod" renders one shape per circuit and „Klupa"
 * renders a FORM whose fields depend on a picker. See {@link SET_WAVE_KINDS}.
 */
function OPEN_SIM_DIALOG(preamble = "", after = ""): string {
  return `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
${preamble}
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (document.querySelector(".elec-sim__panel")) {
${after}
      return true;
    }
    const open = document.querySelector(".elec__sim");
    if (open && !open.disabled) open.click();
    await frame();
  }
  return "none";
})()`;
}

/**
 * Deals the given waveform shapes across the bench's pickers, in order.
 *
 * **Without it the sweep photographs one of four forms.** Every channel opens on
 * „Stalna vrednost", which draws ONE field; a square wave draws four, a ramp
 * three and a list two, and each of those is a row that can overflow its card
 * in a way the one-field row cannot. That is DC-98's shape exactly — a control
 * the sweep can see hiding a form the sweep cannot.
 *
 * **It takes the list rather than owning it, because the coverage is bounded by
 * the CIRCUIT and not by the helper.** It used to deal all four, which reads as
 * complete and is not: the demo rover has exactly two channels, so one frame
 * holds two forms and the last two in the list were never drawn. Naming the
 * shapes at the call site puts that arithmetic where somebody can do it — two
 * scenes deal two each, and a circuit that grows a third channel still covers
 * all four rather than covering three and looking finished.
 *
 * The value is written through the prototype's own setter rather than assigned.
 * React tracks a controlled input's value on the DOM node and skips the change
 * event when what it reads back matches what it last wrote, so `node.value = x`
 * followed by a dispatched `change` is a no-op that leaves the picker showing
 * one thing and the form rendering another.
 *
 * A function rather than a constant so it can be read by the scene list above,
 * which every other helper here is: a `const` is not hoisted, and the one that
 * was declared below its only call site did not compile.
 */
function SET_WAVE_KINDS(kinds: readonly string[]): string {
  return `      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      ).set;
      const kinds = ${JSON.stringify(kinds)};
      const pickers = document.querySelectorAll(".elec-sim__kind");
      for (let index = 0; index < pickers.length; index += 1) {
        setter.call(pickers[index], kinds[index % kinds.length]);
        pickers[index].dispatchEvent(new Event("change", { bubbles: true }));
      }
      await frame();`;
}

/**
 * Opens the first widget config form the dashboard actually offers.
 *
 * THREE conditions, which is the whole reason this is a helper and not a
 * `CLICK_THEN`. The ⋯ exists only in EDIT mode, so the scene presses „Uredi"
 * first — the first draft did not, found no menus, and said so, which is the
 * behaviour every probe here owes the reader. „Podesi…" is then drawn only for
 * a widget whose contract declares `configFields` at all, and the control this
 * scene exists to show only for a `count` field, so it walks the cards instead
 * of taking the first. A scene that opened the first menu would photograph a
 * plain action list under a name promising a form — and would go on doing it
 * silently the day the dashboard's first card changes.
 *
 * Each miss closes what it opened before trying the next, and `LEAVE_EDIT_MODE`
 * presses „Gotovo" afterwards: edit mode is page state, and every later
 * dashboard frame would otherwise carry a grip and a ⋯ on every card.
 */
function OPEN_WIDGET_CONFIG(): string {
  return `(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const button = (text) =>
      Array.prototype.find.call(
        document.querySelectorAll("button"),
        (node) => (node.textContent || "").trim() === text,
      );
    const enter = button("Uredi");
    if (enter) {
      enter.click();
      await frame();
    }
    const triggers = document.querySelectorAll(".dash__widget-menu");
    if (triggers.length === 0) return "none: no widget menus even in edit mode";
    for (const trigger of triggers) {
      trigger.click();
      await frame();
      const configure = button("Podesi…");
      if (configure) {
        configure.click();
        await frame();
        if (document.querySelector(".dash__config-field")) return "open";
      }
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await frame();
    }
    return "none: no widget here offers a config form with a count field";
  })()`;
}

/** Closes the popover and presses „Gotovo", so the next scene gets a plain dashboard. */
function LEAVE_EDIT_MODE(): string {
  return `(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await frame();
    const done = Array.prototype.find.call(
      document.querySelectorAll("button"),
      (node) => (node.textContent || "").trim() === "Gotovo",
    );
    if (done) {
      done.click();
      await frame();
    }
    return true;
  })()`;
}

/**
 * Opens TASK's repetition editor, which needs a date before it will open at all.
 *
 * Three steps, each of which can miss, so each says so: the details pane has to
 * be open (it is a toggle, and „Sakrij detalje" is what the button says once it
 * is — so the click is skipped rather than repeated when the pane is already
 * there), the rok has to hold a real day before `RecurrencePicker` enables
 * itself, and only then does choosing „Prilagođeno" unfold the panel. The last
 * line asks for `.recur__custom` rather than trusting the click: without it a
 * missed step photographs an ordinary task form under a name that promises an
 * editor, which is the quietest way for a scene to be wrong.
 *
 * Values are written through the prototype's own setter for {@link
 * SET_WAVE_KINDS}'s reason: React tracks a controlled field's value on the DOM
 * node and skips the event when what it reads back matches what it last wrote,
 * so a plain assignment leaves the control showing one thing and the form
 * holding another.
 */
function OPEN_RECURRENCE_EDITOR(): string {
  return `(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const setValue = (node, value) => {
      const proto = node instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(node, value);
    };
    if (!document.querySelector(".tasks__fields")) {
      const toggle = Array.prototype.find.call(
        document.querySelectorAll("button"),
        (node) => (node.textContent || "").trim().startsWith("Detalji"),
      );
      if (!toggle) return "none: no Detalji toggle on this view";
      toggle.click();
      await frame();
    }
    const rok = document.querySelector(".tasks__fields input[type='date']");
    if (!rok) return "none: the details pane has no date field";
    setValue(rok, "2026-09-15");
    rok.dispatchEvent(new Event("input", { bubbles: true }));
    await frame();
    const picker = document.querySelector(".recur .nx-select__control");
    if (!picker) return "none: no repetition picker in the form";
    if (picker.disabled) return "none: the picker stayed disabled, so the date did not land";
    setValue(picker, "custom");
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    await frame();
    return document.querySelector(".recur__custom") ? "open" : "none: Prilagođeno did not unfold";
  })()`;
}

/**
 * Puts the create form back, and this one is not optional either.
 *
 * The form is the page's own draft state, and every TASK scene after this one
 * would otherwise be photographed with a date in the rok and a rule attached to
 * it. Clearing the rok is what does the work — `TasksPage` drops the rule and
 * the reminder ladder with it, since neither can be phased from a date that is
 * not there — but the preset is put back first so the path exercises the way
 * out as well as the way in.
 */
function CLOSE_RECURRENCE_EDITOR(): string {
  return `(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const setValue = (node, value) => {
      const proto = node instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(node, value);
    };
    const picker = document.querySelector(".recur .nx-select__control");
    if (picker && !picker.disabled) {
      setValue(picker, "none");
      picker.dispatchEvent(new Event("change", { bubbles: true }));
      await frame();
    }
    const rok = document.querySelector(".tasks__fields input[type='date']");
    if (rok) {
      setValue(rok, "");
      rok.dispatchEvent(new Event("input", { bubbles: true }));
      await frame();
    }
    return true;
  })()`;
}

/**
 * Opens a create form that lives behind a button, and brings it into the frame.
 *
 * **This is the sweep's largest blind spot, made reachable.** A scene
 * photographs a module and its sub-views; a create form is neither of those. It
 * replaces a primary button at the moment that button is pressed, so until this
 * helper existed not one of the twelve had ever been in a frame — which is how
 * a native checkbox survived inside FIT's exercise form for as long as the form
 * has existed (DC-98, now `check:controls`). Every geometric rule the audit
 * enforces was unenforced inside all of them, and the run said nothing about
 * it, because in a report that counts findings a surface with none and a
 * surface nobody visited read exactly alike.
 *
 * Four things it does that a {@link CLICK_THEN} chain cannot:
 *
 * **It waits for each outcome**, on {@link OPEN_CODE_DIALOG}'s recipe. A module
 * that loads its snapshot over IPC has no section to click one frame after its
 * tab is clicked, and the first draft of the FIT scene therefore reported
 * „found nothing to open" — the honest failure, but a failure.
 *
 * **It finds the form by what CHANGED, not by a class.** Every module names its
 * own (`fit__form`, `hab__form`, `note__folder-form`, `tasks__name-form`), and
 * a page can already hold one before anything is opened — TASK's quick-add form
 * is on screen throughout. So the set of `<form>`s is snapshotted before the
 * click and the one meant is whichever was not in it: „the form that appeared
 * because I pressed this button" is the same sentence in every module, and it
 * needs no list of class names to go stale.
 *
 * **It scrolls.** These forms usually render far down a long page —
 * `FitRoutines` sits at the bottom of the training section — so the draft that
 * clicked correctly and opened the form correctly photographed the top of the
 * page instead. A scene that reports „fine" about a surface it never showed is
 * worse than no scene at all.
 *
 * **And it says `"none"` at every step**, for {@link SCROLL_TO}'s reason: a
 * probe that misses must never look like a surface that is clean.
 *
 * `path` is the clicks that reach the section first — a section tab, a rail
 * row — each waited for before it is clicked. `open` is the button itself: a
 * CSS selector where it has a class of its own, `text:Naziv` where it does not.
 * That text match is EXACT rather than {@link CLICK_THEN}'s prefix, because the
 * pages this runs on put „Nova kategorija" beside „Nova lista" and „Nova
 * rutina" directly above „Nova vežba" — under a prefix the rail would answer
 * for the panel, and the frame would be filed under the other one's name.
 */
function OPEN_CREATE_FORM(spec: {
  readonly path?: readonly string[];
  readonly open: string;
  /**
   * What appeared, where „a `<form>` that was not there before" is not the
   * answer — given, it is waited for and scrolled to instead.
   *
   * CAL's two template panels are the case, and neither is an oversight. The
   * naming line sits INSIDE the event form, so it is a `<div>` on purpose: a
   * nested `<form>` is not a thing HTML has, and its own comment says so. The
   * apply list is a portalled popover and never contained a form at all. Both
   * were therefore unreachable by the discriminator above, and both had gone
   * unphotographed for as long as they have existed — which is the same blind
   * spot this helper was written to close, one layer further in.
   */
  readonly expect?: string;
}): string {
  return `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const waitFor = async (find) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const found = find();
      if (found) return found;
      await frame();
    }
    return null;
  };
  const locate = (step) =>
    step.startsWith("text:")
      ? Array.prototype.find.call(
          document.querySelectorAll("button"),
          (node) => (node.textContent || "").trim() === step.slice(5),
        )
      : document.querySelector(step);
  for (const step of ${JSON.stringify(spec.path ?? [])}) {
    const node = await waitFor(() => locate(step));
    if (!node) return "none: path step " + step;
    node.click();
    // A commit between the click and the next lookup, and this is load-bearing.
    // \`waitFor\` calls its finder BEFORE it waits, so without this the next
    // lookup runs against the DOM the click has not been applied to yet — and a
    // stale hit is worse than a miss, because the probe then clicks a node
    // React is about to unmount and reports the click as having done nothing.
    // That is exactly how „.tasks__new-section opened no new form" happened:
    // the path selected a different scope, the pre-commit DOM still held the
    // old scope's button, and the handler ran against a scope that was already
    // gone.
    await frame();
  }
  const open = await waitFor(() => locate(${JSON.stringify(spec.open)}));
  if (!open) return "none: no " + ${JSON.stringify(spec.open)};
  const expect = ${JSON.stringify(spec.expect ?? null)};
  const before = new Set(document.querySelectorAll("form"));
  open.click();
  const form = await waitFor(() =>
    expect === null
      ? Array.prototype.find.call(document.querySelectorAll("form"), (node) => !before.has(node))
      : document.querySelector(expect),
  );
  if (!form) {
    return "none: " + ${JSON.stringify(spec.open)} + " opened no " + (expect ?? "new form");
  }
  form.scrollIntoView({ behavior: "instant", block: "start" });
  await frame();
  return true;
})()`;
}

/**
 * Chooses one named circuit in the switcher, as {@link OPEN_CODE_DIALOG}'s
 * preamble.
 *
 * By NAME, and this used to be „the one that is not checked". That worked while
 * the demo profile had two circuits and stopped meaning anything the moment it
 * had three — `aria-checked === "false"` then matches two rows and picks
 * whichever the DOM lists first, so a scene named for the sketch could
 * photograph the package. „Other" is not a name; it is an arithmetic that holds
 * for exactly one profile shape.
 *
 * A PREFIX rather than the whole title, because the match runs on rendered
 * text: „Malina: rover" is unambiguous at „Malina", and a prefix keeps the
 * scene definitions ASCII where the titles are not. `"none"` if it matches
 * nothing, which is how a renamed demo circuit becomes a red sweep rather than
 * a frame of the wrong dialog.
 */
function SWITCH_TO_CIRCUIT(name: string): string {
  return `  const trigger = document.querySelector(".elec__switcher");
  if (!trigger) return "none";
  trigger.click();
  await frame();
  const wanted = Array.prototype.find.call(
    document.querySelectorAll(".note__menu-item"),
    (node) => {
      const label = node.querySelector(".elec__switcher-name");
      return !!label && (label.textContent || "").trim().startsWith(${JSON.stringify(name)});
    },
  );
  if (!wanted) return "none";
  wanted.click();`;
}

/**
 * Closes ELEC's open modal and puts the circuit switcher back on its first entry.
 *
 * **DC-77's rule, applied to the state this module persists.** Two of the code
 * scenes reach their shape by switching circuits and the switcher's choice
 * survives `openModule`, so until this existed every ELEC scene below them was
 * photographing whichever circuit the last one had wanted. „Klupa" is where it
 * showed: it asked for the rover's bench and got the UNO the scene above it had
 * selected — one channel, no topics — in a frame that looks exactly like a
 * bench, which is why nothing in the report said a word about it.
 *
 * The FIRST entry rather than a named one, on `CLICK_THEN`'s reasoning in FIN:
 * what has to be restored is the state the page OPENS in, and that is a
 * position in a sorted list, not a title that a demo profile could rename.
 *
 * `DISPATCH_KEY` is embedded rather than repeated — it is an IIFE, so it is
 * already an expression — because the reason it dispatches on the focused
 * element and not on `window` is written down once, over there.
 */
function CLOSE_AND_RESTORE_CIRCUIT(): string {
  return `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  ${DISPATCH_KEY("Escape")};
  await frame();
  const trigger = document.querySelector(".elec__switcher");
  if (!trigger) return "none: no circuit switcher to restore";
  trigger.click();
  await frame();
  const first = document.querySelector(".note__menu-item");
  if (!first) return "none: the switcher opened on an empty list";
  first.click();
  await frame();
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
    // A \`display: none\` element still answers querySelectorAll and still has a
    // textContent; what it does not have is a box. One rect test, used for the
    // field AND for the button that reveals it — see the opener below for the
    // surface that needed the second half.
    const onScreen = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 40 && rect.height > 10;
    };
    const visibleField = () => Array.prototype.find.call(
      document.querySelectorAll(FIELDS),
      (el) => onScreen(el) && !el.disabled && !el.readOnly,
    );

    let field = visibleField();
    if (!field) {
      // The create form is a DISCLOSURE on most surfaces now — a page that is
      // read a hundred times a day and written to a few does not keep its form
      // open — so the probe has to do what a person does and press the button
      // that reveals it. Matched on the visible Serbian verb rather than a
      // class, because the class is each page's own and the verb is the app's.
      //
      // \`onScreen\` is not decoration. NOTE's organizer stays MOUNTED when it
      // is a closed drawer under 1345px — the rule that puts it away is
      // \`display: none\`, not an unmount — and it sits before the list pane in
      // document order, so the first button matching this verb was „Nova
      // fascikla" inside a drawer nobody can see. The probe pressed it, the
      // form mounted with a zero-sized box, and the module was reported as
      // having no create form at all.
      const opener = Array.prototype.find.call(
        document.querySelectorAll("button"),
        (el) =>
          onScreen(el) &&
          /^(nova|novi|novo|dodaj|upiši|zapiši)\\b/i.test((el.textContent || "").trim()),
      );
      if (!opener) return "none: no visible field and no create button";
      const label = (opener.textContent || "").trim();
      opener.click();
      // React has not re-rendered yet. The click only SCHEDULES the state
      // update; the field the disclosure reveals does not exist until the
      // commit, so
      // reading synchronously here found nothing every single time and the
      // probe reported „no create form" on five surfaces that all have one.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      field = visibleField();
      if (!field) return "none: " + label + " revealed no field";
    }
    const proto = field instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    field.focus();
    setter.call(field, ${JSON.stringify(text)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    const form = field.closest("form");
    if (!form) return "none: the field is outside a form";
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
 * The slice of the sweep this run was asked for, and whether it is one.
 *
 * **A scene is a twenty-minute feedback loop, and that is why scenes were the
 * least-iterated part of this instrument.** `OPEN_CREATE_FORM`'s twenty scenes
 * needed three passes to write; at 2 700 frames a pass, the cost of finding out
 * whether a selector is right was an hour. `NEXUS_SHOTS_SCENES=tasks-new-section
 * NEXUS_SHOTS_SIZES=default NEXUS_SHOTS_THEMES=dan` makes that forty seconds.
 *
 * A name that matches nothing is reported rather than ignored: `SCENES=tasks_new`
 * silently taking no frames would look exactly like a scene that found nothing
 * to open, which is the one message this instrument must never counterfeit.
 */
function pickBy<T>(all: readonly T[], variable: string, idOf: (item: T) => string): readonly T[] {
  const raw = process.env[variable];
  if (raw === undefined || raw.trim() === "") return all;
  const wanted = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  for (const name of wanted) {
    if (!all.some((item) => idOf(item) === name)) {
      process.stderr.write(`shots: ${variable} names "${name}", which is not in the list\n`);
    }
  }
  return all.filter((item) => wanted.includes(idOf(item)));
}

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
  const plan = {
    scenes: pickBy(SHOT_SCENES, "NEXUS_SHOTS_SCENES", (scene) => scene.id),
    sizes: pickBy(SHOT_SIZES, "NEXUS_SHOTS_SIZES", (size) => size.id),
    themes: pickBy(SHOT_THEMES, "NEXUS_SHOTS_THEMES", (theme) => theme),
  };
  // A partial run is a DIFFERENT KIND OF RUN, and every consequence below is
  // about not letting it pretend otherwise. It does not prune (every frame it
  // did not take would go), it does not run the questionnaire (which completes,
  // and rewrites this profile's flags, board and sidebar), and it writes its
  // findings beside `report.md` rather than over it — a one-scene report sitting
  // where the full one was is a stale-report-next-to-fresh-frames again, with
  // the staleness moved into the other file.
  const partial =
    plan.scenes.length !== SHOT_SCENES.length ||
    plan.sizes.length !== SHOT_SIZES.length ||
    plan.themes.length !== SHOT_THEMES.length;
  if (partial) {
    const names = plan.scenes.map((scene) => scene.id).join(", ");
    process.stderr.write(
      `shots: PARTIAL RUN — ${String(plan.scenes.length)} scene(s) [${names}], ` +
        `${String(plan.sizes.length)} size(s), ${String(plan.themes.length)} theme(s). ` +
        "No pruning, no questionnaire, findings in report.partial.md.\n",
    );
  }

  const frames: ShotFrame[] = [];
  try {
    await sweep(win, outDir, frames, plan, partial);
    // Only on the success path — see {@link pruneStaleFrames}.
    if (!partial) pruneStaleFrames(outDir, frames);
  } finally {
    if (partial) {
      writeFileSync(join(outDir, "report.partial.md"), buildReport(frames));
    } else {
      writeFileSync(join(outDir, "frames.json"), `${JSON.stringify(frames, null, 2)}\n`);
      writeFileSync(join(outDir, "report.md"), buildReport(frames));
      // And take the partial report away with it. A four-scene report left
      // sitting beside a full run's frames is the same staleness this whole
      // block exists to prevent, one file over: it names real findings, from a
      // run that is no longer what is on disk.
      rmSync(join(outDir, "report.partial.md"), { force: true });
    }
  }
  return frames;
}

/**
 * Deletes every PNG under `outDir` this run did not write.
 *
 * The sweep overwrites in place rather than wiping its output first, which is
 * right — a run that dies late still leaves a usable set beside a report that
 * says how far it got. What it costs is that a **renamed** scene leaves its old
 * frame on disk forever: `electronics-sketch.png` outlived the scene that made
 * it by three renames, sitting in the directory looking exactly as current as
 * the frame beside it. `frames.json` never mentioned it, so the report could
 * not see it either; the only reader who could was a person opening the folder,
 * which is the reader this whole instrument exists for.
 *
 * **Not in the `finally`, and that is the whole design.** A crashed run has a
 * short `frames` list and a full directory, so pruning there would delete every
 * frame the run had not reached — turning one transient capture failure into
 * the loss of the previous run's evidence. It runs only where „this run took
 * every frame it meant to" is true.
 */
function pruneStaleFrames(outDir: string, frames: readonly ShotFrame[]): void {
  const written = new Set(frames.map((frame) => resolve(frame.file)));
  for (const size of SHOT_SIZES) {
    for (const theme of SHOT_THEMES) {
      const dir = join(outDir, size.id, theme);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".png")) continue;
        const file = join(dir, name);
        if (written.has(resolve(file))) continue;
        process.stderr.write(`shots: removed a frame no scene takes any more — ${file}\n`);
        rmSync(file, { force: true });
      }
    }
  }
}

interface ShotPlan {
  readonly scenes: readonly ShotScene[];
  readonly sizes: readonly ShotSize[];
  readonly themes: readonly ShotTheme[];
}

async function sweep(
  win: BrowserWindow,
  outDir: string,
  frames: ShotFrame[],
  plan: ShotPlan,
  partial: boolean,
): Promise<void> {
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
  for (const size of plan.sizes) {
    // Outer dimensions, matching `createWindow` — the frames must show the
    // viewport a real window of this size actually has, chrome included.
    win.setSize(size.width, size.height);
    await pause(300);

    for (const theme of plan.themes) {
      await serveTheme(win, theme);
      const dir = join(outDir, size.id, theme);
      mkdirSync(dir, { recursive: true });

      for (const scene of plan.scenes) {
        if (!(await openModule(win, scene.module))) {
          process.stderr.write(`shots: no sidebar row for module "${scene.module}"\n`);
          continue;
        }
        if (scene.prepare !== undefined) {
          const outcome = await evalIn(win, scene.prepare);
          // `OPEN_FIRST` answers "none" when no candidate matched. Said out
          // loud, because the frame it would otherwise produce looks like a
          // perfectly ordinary list rather than like a broken scene.
          //
          // Anything AFTER „none" is the probe saying which of its steps missed,
          // and it is printed. A multi-step helper that reports only „none"
          // makes the reader re-derive the path by hand — which is what the
          // first two failures of `OPEN_CREATE_FORM` cost, and the whole reason
          // both of them took a second full sweep to place.
          if (typeof outcome === "string" && outcome.startsWith("none")) {
            const why = outcome.slice("none".length).replace(/^:\s*/, "");
            const detail = why === "" ? "" : ` — ${why}`;
            process.stderr.write(`shots: scene "${scene.id}" found nothing to open${detail}\n`);
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
    // The pass declares its own geometry instead of inheriting whatever the
    // size loop above happened to leave behind. It used to inherit, and because
    // `wide` is last in `SHOT_SIZES` that was 1600px by accident — which held
    // until a partial run pinned `default` and NOTE reported no create form on
    // a surface every full run had photographed. NOTE's only `<form>` is the
    // organizer's name form, and under 1345px the organizer is a closed drawer.
    //
    // `wide` on purpose rather than `default`: this pass is about the DATA path
    // — renderer to preload to IPC to SQLite and back — and geometry is what the
    // eighteen scene passes above are for. Pinning it is what makes a partial
    // run and a full run agree, which is the one property it did not have.
    const geometry = SHOT_SIZES.find((size) => size.id === "wide");
    if (geometry !== undefined) {
      win.setSize(geometry.width, geometry.height);
      await settle(win);
    }
    const dir = join(outDir, "write", "noc");
    mkdirSync(dir, { recursive: true });
    await serveTheme(win, "noc");
    for (const moduleId of WRITE_MODULES) {
      if (!(await openModule(win, moduleId))) continue;
      const outcome = await evalIn(win, WRITE_PROBE(`${WRITE_MARKER} · ${moduleId}`));
      if (outcome !== "submitted") {
        // The reason, not the conclusion. „found no create form" was printed
        // for three different outcomes, one of which — a form found behind a
        // hidden button — was not that at all.
        const why =
          typeof outcome === "string" ? outcome.replace(/^none:\s*/, "") : String(outcome);
        process.stderr.write(`shots: write probe on "${moduleId}" did not submit — ${why}\n`);
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
  //
  // And it is the one part a PARTIAL run skips outright, for that same reason:
  // somebody iterating on one scene must not have the profile rewritten under
  // them between attempts.
  if (partial) return;
  for (const size of plan.sizes) {
    win.setSize(size.width, size.height);
    await pause(300);
    for (const theme of plan.themes) {
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

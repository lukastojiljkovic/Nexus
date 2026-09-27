import {
  TOOL_CATEGORIES,
  TOOL_PACKS,
  toolDrawer,
  toolVisibleToPacks,
  type FlagState,
  type ToolDrawer,
  type ToolPack,
  type ToolRegistration,
  type ToolRiskClass,
} from "@nexus/core";
import { Button, EmptyState, LoadingState, PageHeader, TextField } from "@nexus/ui";
import { Suspense, useDeferredValue, useMemo, useState, type ComponentType } from "react";

import { createModuleRegistry } from "../../shared/modules.js";
import { ProPackDialog } from "./ProPacks.js";
import { PRO_TOOL_SURFACES } from "./proToolSurfaces.js";
import { filterTools, type SearchableTool } from "./toolSearch.js";
import { TOOL_SURFACES } from "./toolSurfaces.js";
import { countUnit, fill, strings } from "./strings.js";
import { moduleName } from "./moduleName.js";
import { readRecentTools, rememberRecentTool } from "./toolPrefs.js";
import { ToolRiskNotice, ToolRiskProvider } from "./toolRisk.js";

/**
 * The tool drawer (UTIL slices c and d, PRO slice a) — „Alatke" and „Stručne
 * alatke", and the utilities HOST the `ToolRegistration` contract was reserved
 * for.
 *
 * **This page has no list of tools and no `switch`.** It collects
 * `manifest.tools` across the module registry and renders whatever it finds
 * through a surface map, so its own converters and calculators arrive by
 * exactly the path a future module's tool would. Adding a tool never touches
 * this file; that is the whole point of the contract.
 *
 * **Two drawers, one implementation, and the seam is `packs`.** A tool that
 * names no profession is an everyday tool and lives in „Alatke"; a tool that
 * names at least one is professional and lives here. Never which module
 * declared it — the shorter rule („a drawer shows its own module's tools")
 * would have made this file one filter simpler and would have retired the
 * contract's standing promise that any module may publish a tool.
 *
 * **Inside the professional drawer, packs FILTER and categories GROUP.** The
 * rail is the same subject-ordered rail the developer drawer always had; what
 * the profile's packs decide is which rows are in it. So a photographer and an
 * event planner find the daylight calculator under the same heading, and
 * neither is told it was also somebody else's.
 *
 * **A tool from a switched-off module is not offered.** The drawer is a host,
 * not an exemption: if a profile has a module off, the module's tools go with
 * it, the same way its page and its widgets do.
 *
 * ---
 *
 * **The page is ONE instrument, not three bands stacked on a background** —
 * the shape „Elektronika" and „Tabla" already use, and the thing this page most
 * conspicuously was not.
 *
 * It had been a header, then a search field floating in its own strip of
 * nothing, then a two-pane list that simply ran off the bottom of the window,
 * taking the header with it whenever anybody scrolled. Three objects with no
 * relationship, and at a few hundred tools the middle one was a rail ten
 * thousand pixels long. Now the layout is one bordered box that
 * fills the pane; the rail and the surface scroll inside it independently, and
 * the search sits at the head of the rail because the rail is what it filters.
 *
 * **The surface never rests on an empty state, and the two drawers reach that
 * differently because they are two different sizes of problem.** „Izaberi
 * alatku sa liste" over half an empty screen was the first thing anyone saw.
 *
 * „Stručne alatke" fills it with the drawer indexing itself — the toolkits this
 * profile chose, who each is for, and what it actually gave them, over the tools
 * this device opened last. That answers a question the rail cannot (which trade
 * is this tool from, rather than which subject) and it narrows with the same
 * search, so one act of typing has two useful readings.
 *
 * „Alatke" has eleven tools and a rail that shows all eleven at once, so the
 * same index beside it is the same eleven names twice on one screen. It opens on
 * a TOOL instead — the one this device used last, or the first in the rail.
 */

/** What each drawer is: the module that owns its page, its surfaces, and its copy. */
const DRAWERS = {
  utilities: { moduleId: "tools", surfaces: TOOL_SURFACES, chrome: () => strings.tools },
  professional: { moduleId: "pro", surfaces: PRO_TOOL_SURFACES, chrome: () => strings.pro },
} as const satisfies Record<
  ToolDrawer,
  {
    readonly moduleId: string;
    readonly surfaces: Readonly<Record<string, ComponentType>>;
    // A THUNK, not the object. `strings` rewrites its leaves in place on a
    // language switch, and a module-scope read of `strings.tools` would capture
    // this build's Serbian forever — the exact capture `check:strings` gates.
    readonly chrome: () => (typeof strings)["tools"] | (typeof strings)["pro"];
  }
>;

/**
 * A `titleKey` or `blurbKey` resolved against `strings` — the same dotted-path
 * lookup `modules.test.ts` pins for widget titles. A path is used rather than a
 * direct `strings.tools.name` read because the contract promises one: a tool
 * published by some other module names a string in that module's own group.
 */
function resolveKey(key: string): string | undefined {
  const resolved = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null ? (node as Record<string, unknown>)[part] : undefined,
      strings,
    );
  return typeof resolved === "string" ? resolved : undefined;
}

export interface ToolsPageProps {
  /** Which drawer this page is. */
  drawer: ToolDrawer;
  /**
   * The modules this profile has switched on. A tool whose owning module is off
   * is not drawn — see the header.
   */
  enabledModules: ReadonlySet<string>;
  /**
   * The profession packs this profile answered for (`enabledPacks`). Everyday
   * tools ignore it; a professional tool is drawn only if one of its packs is
   * in here.
   *
   * Passed in rather than read from the flags on this page, for the reason
   * `enabledModules` is: the shell already holds the resolved flag state, and a
   * second reader would be a second answer to „what does this profile have".
   */
  packs: ReadonlySet<string>;
  /**
   * How this drawer edits its own toolkits — present on the professional drawer
   * and absent on „Alatke", which has none to edit.
   *
   * Optional rather than a `drawer === "professional"` check inside, so „the
   * everyday drawer has no „Paketi…" button" is a fact about the props the shell
   * passes rather than a condition this file could get wrong. It carries what
   * the picker needs to WRITE, because a surface that writes flags and does not
   * report them back is a shell holding a stale answer.
   */
  packEditor?: {
    readonly profileId: string;
    readonly onFlagsChanged: (flags: FlagState) => void;
  };
}

interface DrawerTool extends SearchableTool {
  readonly blurb: string | undefined;
  /** What could go wrong with this tool's answer — the host draws the notice, never the surface. */
  readonly riskClass: ToolRiskClass;
  /** Where a `published`-tier constant in this tool came from, resolved — absent for the ordinary case. */
  readonly source: string | undefined;
  /**
   * The toolkits that list it — empty for an everyday tool.
   *
   * Carried on the row rather than looked up again because the directory groups
   * by it. A tool in two packs is listed under both, which is the truth about
   * it: the daylight calculator really is the photographer's and the event
   * planner's, and a rule that showed it only under the first would be inventing
   * a primary pack the contract deliberately does not have.
   */
  readonly packs: readonly ToolPack[];
}

/** One card of the directory: a toolkit, the trades it is for, and what is in it. */
interface DirectoryGroup {
  readonly key: string;
  readonly name: string;
  readonly who: string;
  readonly members: readonly DrawerTool[];
}

export function ToolsPage({ drawer, enabledModules, packs, packEditor }: ToolsPageProps) {
  const { moduleId, surfaces } = DRAWERS[drawer];
  // Read on every render, not at module scope, so a language switch relabels
  // the drawer instead of freezing it at import.
  const s = DRAWERS[drawer].chrome();

  const tools = useMemo<DrawerTool[]>(() => {
    const registry = createModuleRegistry();
    return registry
      .all()
      .filter((manifest) => enabledModules.has(manifest.id))
      .flatMap((manifest) => manifest.tools ?? [])
      .filter(
        (tool: ToolRegistration) =>
          toolDrawer(tool) === drawer &&
          toolVisibleToPacks(tool, packs) &&
          surfaces[tool.id] !== undefined,
      )
      .map((tool) => ({
        id: tool.id,
        // The id rather than a placeholder when a name does not resolve: an
        // unnamed tool is a bug, and printing its id makes the bug legible.
        name: resolveKey(tool.titleKey) ?? tool.id,
        category: tool.category,
        blurb: tool.blurbKey === undefined ? undefined : resolveKey(tool.blurbKey),
        riskClass: tool.riskClass,
        source: tool.sourceKey === undefined ? undefined : resolveKey(tool.sourceKey),
        packs: tool.packs ?? [],
        ...(tool.keywords === undefined ? {} : { keywords: tool.keywords }),
      }));
  }, [drawer, enabledModules, packs, surfaces]);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickingPacks, setPickingPacks] = useState(false);
  const [recent, setRecent] = useState<readonly string[]>(() => readRecentTools(drawer));
  /**
   * WHICH DRAWER THIS STATE BELONGS TO, and the one place a switch between them
   * is handled.
   *
   * `ToolsPage` is the same element type in both branches of the shell's route
   * chain, so React REUSES the instance when somebody goes from „Alatke" to
   * „Stručne alatke": every piece of state above survives a change of drawer
   * that ought to have ended it. „Nedavno" would be read once, for whichever
   * drawer was opened first, and shown for ever under the other one's name; the
   * search text would follow the user across; and the selection would name a
   * tool the new drawer does not have. Two of those were already true and drew
   * no attention because the third one hid them — a stale `selectedId` simply
   * fails to resolve and falls through to the empty pane.
   *
   * Setting state while rendering is React's own answer to exactly this (it
   * re-renders immediately, before anything is committed) and it is why there is
   * no effect here: an effect would paint the previous drawer's search and
   * history first and correct them a frame later.
   */
  const [shownDrawer, setShownDrawer] = useState(drawer);
  if (shownDrawer !== drawer) {
    setShownDrawer(drawer);
    setRecent(readRecentTools(drawer));
    setSelectedId(null);
    setQuery("");
  }

  const visible = filterTools(tools, query);
  /**
   * WHAT THE SURFACE OPENS ON — the one difference between the two drawers that
   * is not about how much of them there is.
   *
   * „Alatke" has eleven tools and its rail shows all eleven without scrolling,
   * so an index of them beside it is the same eleven names twice on one screen:
   * worse than the empty pane it was meant to replace, because it looks like
   * content. A drawer that small opens ON a tool instead — the one this device
   * used last, or the first in the rail. „Stručne alatke" has hundreds behind a
   * scroller, so its index is exactly what the rail cannot be, and opening one
   * of hundreds at random would be noise rather than a head start.
   *
   * DERIVED and never written. Choosing this is not an act by the user: it must
   * not enter „Nedavno", and it must not become a selection the drawer switch
   * above then has to undo.
   */
  const openId =
    selectedId !== null || drawer !== "utilities"
      ? selectedId
      : (recent.find((id) => tools.some((tool) => tool.id === id)) ??
        // The FIRST ROW OF THE RAIL, in the rail's own order — which is by
        // category, and is not `tools[0]`: the registry's order and the
        // contract's category order are two different lists that happen to
        // agree today, and „opens on the first one" has to stay true of the one
        // the user can see.
        TOOL_CATEGORIES.flatMap((category) => tools.filter((tool) => tool.category === category))[0]
          ?.id ??
        null);
  /**
   * The tool the surface DRAWS, which trails `openId` by as long as the tool's
   * file takes to arrive — `App`'s `shownId`, one level down, and for the same
   * reason: every professional toolkit is fetched the first time one of its
   * tools is opened (`proToolSurfaces.tsx`), and the tool being left stays on
   * screen until the next one is ready instead of the pane blanking. The rail's
   * active row reads `openId` and moves on the click; `aria-busy` on the surface
   * says so while the two differ, and the screenshot sweep waits on it.
   */
  const surfaceId = useDeferredValue(openId);
  const selected = tools.find((tool) => tool.id === surfaceId) ?? null;
  const Surface = selected === null ? undefined : surfaces[selected.id];

  /** Opens a tool and records that this device did — one path, for the rail and the directory alike. */
  function openTool(id: string): void {
    setSelectedId(id);
    setRecent(rememberRecentTool(drawer, id));
  }

  /**
   * The drawer is on and has nothing in it, because every tool here belongs to
   * a toolkit and this profile has none.
   *
   * Told apart from „nothing matched your search" on purpose: those two states
   * look identical on screen and have opposite answers, and only this one is
   * fixed by opening the picker.
   */
  const noPacks = packEditor !== undefined && packs.size === 0;
  /**
   * The module's own mark, on every empty state this page can draw.
   *
   * Derived once rather than written at each of the three call sites: they are
   * the same page in two drawers, and hard-coding `"tools"` put „Alatke"'s ruler
   * over „Stručne alatke"'s empty rail — the mark saying one module while the
   * header said the other.
   */
  const sigil = moduleId === "pro" ? "pro" : "tools";

  return (
    // The drawer modifier is not decoration: the two drawers differ in DENSITY,
    // not in kind. „Alatke" has one answer per tool and draws it as a display
    // figure; „Stručne alatke" answers with a dozen labelled fields at once,
    // where that same figure size would be a page of shouting. One modifier
    // retunes the shared rows rather than minting a second class family that
    // would then have to be kept in step with the first.
    <div className={`tool tool--${drawer}`}>
      <PageHeader
        title={moduleName(moduleId)}
        // How much is behind the rail, composed from the registry — see
        // `subtitle` in the copy for why it is never written down. Hidden while
        // the drawer is empty for want of a toolkit, where „0 alatki" would be
        // repeating the empty state's own first sentence back at it.
        {...(noPacks
          ? {}
          : {
              subtitle: fill(s.subtitle, {
                count: tools.length,
                unit: countUnit(tools.length, s.unitTool.one, s.unitTool.few, s.unitTool.many),
              }),
            })}
        sigil={sigil}
        {...(packEditor === undefined
          ? {}
          : {
              actions: (
                <Button size="sm" onClick={() => setPickingPacks(true)}>
                  {strings.pro.picker.open}
                </Button>
              ),
            })}
      />
      {/* The module is on and the drawer is empty, because every tool in it
          belongs to a toolkit and this profile has none. Reachable — somebody
          switches „Stručne alatke" on from the Moduli gallery without ever
          having answered the questionnaire — and it is not a failure, so it
          says what is missing and puts the switch under the sentence rather
          than leaving a search field over an empty rail. */}
      {noPacks && (
        // Read from `strings.pro` rather than from `s`: this state belongs to
        // the professional drawer alone — „Alatke" has no toolkits and can
        // never be in it — so the words are the drawer's, not the chrome's.
        <EmptyState
          sigil={sigil}
          title={strings.pro.noPacksTitle}
          description={strings.pro.noPacks}
          action={
            <Button variant="primary" onClick={() => setPickingPacks(true)}>
              {strings.pro.choosePacks}
            </Button>
          }
        />
      )}
      {!noPacks && (
        <div className="tool__layout">
          <nav className="tool__list" aria-label={s.title}>
            {/* At the head of the rail, inside the instrument, because the rail
                is what it filters. It had floated in a strip of its own above
                both panes, where it read as a search over the whole page — and
                the pane it actually narrows was the one it was not touching. */}
            <div className="tool__list-head">
              <TextField
                className="tool__search"
                type="search"
                value={query}
                aria-label={s.searchLabel}
                placeholder={s.searchPlaceholder}
                autoComplete="off"
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </div>
            {/* The scroller. The rail is hundreds of rows long
                and the page is not: this box scrolls, the instrument around it
                does not move, and the open tool beside it stays where it was. */}
            <div className="tool__list-scroll">
              {/* Every category, in contract order — a group with no visible member
                  draws nothing, which is how one rail serves both drawers and how a
                  professional drawer narrowed to two packs shows only the two or
                  three headings those packs actually fill. There is no per-drawer
                  category list any more: the drawers stopped being told apart by
                  category the moment `packs` started deciding. */}
              {TOOL_CATEGORIES.map((category) => {
                const members = visible.filter((tool) => tool.category === category);
                if (members.length === 0) return null;
                return (
                  <div key={category} className="tool__group">
                    {/* Sticky inside the scroller: at this length the heading
                        that says which subject you are looking at is otherwise
                        the first thing to leave the screen. */}
                    <h3 className="nx-eyebrow tool__group-title">{strings.tools.category[category]}</h3>
                    {/* The app's ONE nav-row grammar (`.nx-nav-item`): the hover
                        tint, the gold-and-weight selection and the trailing ✦ all
                        come from the shared rule, and `.tool__item` adds only what
                        a `<button>` needs in order to wear it. The drawer used to
                        carry a private copy that had drifted on all three — see the
                        rule in `tools.css` for what each drift was. */}
                    {members.map((tool) => {
                      const active = tool.id === openId;
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          className={`nx-nav-item tool__item${active ? " nx-nav-item--active" : ""}`}
                          // Only on the row that IS current. A rendered
                          // `aria-current="false"` on every other row is noise a
                          // screen reader reads out; the attribute's absence is how
                          // „not this one" is said.
                          {...(active ? { "aria-current": true } : {})}
                          onClick={() => {
                            openTool(tool.id);
                          }}
                        >
                          {/* The component's own inner span, not a bare text node:
                              it is what clips a long name to an ellipsis instead of
                              wrapping it onto a second line, and an anonymous flex
                              item cannot be given that rule. */}
                          <span className="nx-nav-item__label">{tool.name}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {/* „Says what to do, and does not scold" is what this line's own
                  comment in `strings.ts` promises. It belongs in the RAIL and
                  nowhere else, because the rail is the only thing the search
                  narrows: with a tool open the surface is still showing an
                  answer somebody is reading, and the pane that has gone empty is
                  this one. `clearSearch` was written for this control. */}
              {visible.length === 0 && (
                <div className="tool__empty">
                  {/* `inline`, and inside a 190–240px rail: the page shape's 48px
                      mark and its column of centred type would be wider than the
                      rail it is reporting on. The mark still rides the line, so
                      the absence is still the module's. */}
                  <EmptyState variant="inline" sigil={sigil} title={s.noMatches} />
                  {/* `quiet` is the primitive for exactly this — a control that
                      reads as a line of text and still keeps the pointer floor.
                      Its negative inline margin is what keeps the label flush
                      with the line above it. */}
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setQuery("");
                    }}
                  >
                    {s.clearSearch}
                  </Button>
                </div>
              )}
            </div>
          </nav>

          <section
            className="tool__surface"
            aria-busy={surfaceId !== openId ? true : undefined}
          >
            {/* One scroller for whatever the surface is showing — an open tool
                or the directory — so the answer to a long form and the index of
                a long drawer scroll the same way and neither moves the rail. */}
            <div className="tool__surface-scroll">
              {/* This pane's own boundary, so a toolkit's file arriving never
                  suspends the page around it. Never keyed, for `PageSlot`'s
                  reason: a boundary already showing a tool keeps it while the
                  next one loads. Its fallback is seen only when there was
                  nothing to keep — a drawer that opens straight onto a tool. */}
              <Suspense
                fallback={
                  <div aria-busy="true">
                    <LoadingState label={strings.app.loading} rows={4} />
                  </div>
                }
              >
                {selected !== null && Surface !== undefined ? (
                  <>
                    <header className="tool__surface-head">
                      <h3 className="tool__surface-title">{selected.name}</h3>
                      {/* Which subject the open tool came from. It is the rail's
                          own heading, restated where the reader is now looking:
                          with the rail scrolled to somewhere else, nothing on the
                          surface said what kind of thing this is. */}
                      <span className="nx-eyebrow tool__surface-kind">
                        {strings.tools.category[selected.category]}
                      </span>
                    </header>
                    {/* The blurb is the developer drawer's, and it earns its place
                        there rather than here: „Dužina" needs no sentence, while
                        „Mikroskalirani blokovi" is unreadable without one. Rendered
                        from the registration so a tool that declares none simply has
                        none, instead of an empty line reserving space for it. */}
                    {selected.blurb !== undefined && <p className="nx-hint nx-hint--prose">{selected.blurb}</p>}
                    {/* Above the body, in the same place on every affected tool,
                        and drawn from the REGISTRATION — so a tool cannot ship
                        without its notice and cannot ship with the wrong one.
                        Draws nothing at all for the tools that endanger nobody. */}
                    <ToolRiskNotice riskClass={selected.riskClass} />
                    {/* The measure belongs to the HOST, not to each tool. Every
                        surface used to open with its own `.tool__body` wrapper, which
                        is a structural rule fifty-three separate files were each
                        expected to remember — and the one that forgot would have got
                        a full-width form with no gap between its fields, looking
                        broken for a reason nobody would find. Written once here, it
                        cannot be forgotten. */}
                    {/* The surface, wrapped in its own risk class, which is what
                        makes the copy button's trailing line unforgettable —
                        `CopyButton` reads it through `useCopySuffix` from
                        wherever it sits inside whichever tool is open. */}
                    <ToolRiskProvider value={selected.riskClass}>
                      <div className="tool__body">
                        <Surface />
                      </div>
                    </ToolRiskProvider>
                    {/* Under the answer, where the professional checking it is
                        already looking: the exact source and edition of any
                        published table this tool embeds. Provenance, never a
                        compliance claim — „prema SRPS EN 10080" is protective,
                        „u skladu sa standardom" is a warranty. */}
                    {selected.source !== undefined && (
                      <p className="tool__surface-source">{selected.source}</p>
                    )}
                  </>
                ) : (
                  <ToolDirectory packs={packs} visible={visible} recentIds={recent} onOpen={openTool} />
                )}
              </Suspense>
            </div>
          </section>
        </div>
      )}
      {pickingPacks && packEditor !== undefined && (
        <ProPackDialog
          profileId={packEditor.profileId}
          packs={packs}
          onFlagsChanged={packEditor.onFlagsChanged}
          onClose={() => setPickingPacks(false)}
        />
      )}
    </div>
  );
}

/**
 * „Stručne alatke" indexed — what stands in the surface until a tool is opened.
 *
 * **Professional only, and that is the whole reason it exists.** „Alatke" has
 * eleven tools and a rail that shows all eleven, so it opens on one instead; see
 * `openId`. Hundreds behind a scroller is the case an index answers.
 *
 * **It groups by a different thing from the rail, on purpose.** The rail is
 * ordered by SUBJECT, which is the right order once you know what you are
 * looking for. This is ordered by TOOLKIT, which is the order the person
 * actually chose: they answered a questionnaire about their trade, eighteen
 * packs were on offer, and until now nothing anywhere showed them what any of it
 * came to.
 *
 * **It narrows with the same search.** One field, two readings: the rail says
 * which tools matched, the directory says which trades they came from. A tool in
 * two packs appears under both, which is what its registration says about it.
 *
 * The columns are CSS multi-column rather than a grid: the cards have wildly
 * different heights (a toolkit has anywhere from four tools to twenty-six) and
 * multi-column is the one layout that packs uneven blocks without measuring
 * them. `break-inside` keeps a card whole.
 *
 * It reads its own two headings out of `strings.pro` rather than taking them as
 * props: the page's `s` is a union over both drawers, so a prop here would have
 * forced „Alatke" to carry copy for an index it does not draw.
 */
function ToolDirectory({
  packs,
  visible,
  recentIds,
  onOpen,
}: {
  packs: ReadonlySet<string>;
  visible: readonly DrawerTool[];
  recentIds: readonly string[];
  onOpen: (id: string) => void;
}) {
  /**
   * „Nedavno", resolved against the tools this drawer actually has and kept in
   * the stored order.
   *
   * The filter is not defensive tidiness: the store deliberately keeps ids it
   * cannot check, so a tool whose module was switched off, whose toolkit was
   * dropped, or which this build no longer ships must fall out here rather than
   * become a row that opens nothing. It is also narrowed by the search, so the
   * whole surface answers one question at a time.
   */
  const recent = recentIds
    .map((id) => visible.find((tool) => tool.id === id))
    .filter((tool): tool is DrawerTool => tool !== undefined);

  /** In contract order, and only the toolkits this profile actually has. */
  const groups: readonly DirectoryGroup[] = TOOL_PACKS.filter((pack) => packs.has(pack))
    .map((pack) => ({
      key: pack,
      name: strings.pro.packs[pack].name,
      who: strings.pro.packs[pack].who,
      members: visible.filter((tool) => tool.packs.includes(pack)),
    }))
    .filter((group) => group.members.length > 0);

  // Nothing matched the search. The rail already says so, and says it where the
  // emptiness is; a second copy of the same sentence in the pane beside it is
  // one sentence too many. This is also what makes the component total in the
  // everyday drawer, where there are no toolkits to index and `openId` means the
  // surface never falls this far.
  if (recent.length === 0 && groups.length === 0) return null;

  return (
    <div className="tool-dir">
      {recent.length > 0 && (
        <section className="tool-dir__recent">
          <h3 className="nx-eyebrow tool-dir__heading">{strings.pro.recentTitle}</h3>
          {/* The kit's small button, not a chip of this page's own. A pill is a
              shape this app does not have — `--nx-radius-round` is for dots,
              swatches and slider tracks here — and „a compact button" already
              exists, with the 24px pointer floor stated in one place. */}
          <div className="tool-dir__chips">
            {recent.map((tool) => (
              <Button
                key={tool.id}
                size="sm"
                onClick={() => {
                  onOpen(tool.id);
                }}
              >
                {tool.name}
              </Button>
            ))}
          </div>
        </section>
      )}
      <section className="tool-dir__all">
        <h3 className="nx-eyebrow tool-dir__heading">{strings.pro.directoryTitle}</h3>
        <div className="tool-dir__columns">
          {groups.map((group) => (
            <article key={group.key} className="tool-dir__card">
              <h4 className="tool-dir__card-title">{group.name}</h4>
              {/* „arhitekte, građevinski inženjeri, geodeti, izvođači" — the
                  words a person recognises themselves by. The pack is named
                  after the WORK, which is what makes it survive a trade nobody
                  listed; this line is what makes it findable by one who is. */}
              <p className="tool-dir__card-who">{group.who}</p>
              <ul className="tool-dir__list">
                {group.members.map((tool) => (
                  <li key={tool.id}>
                    <button
                      type="button"
                      className="tool-dir__row"
                      onClick={() => {
                        onOpen(tool.id);
                      }}
                    >
                      {tool.name}
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

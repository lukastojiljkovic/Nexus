import {
  TOOL_CATEGORIES,
  toolDrawer,
  toolVisibleToPacks,
  type FlagState,
  type ToolDrawer,
  type ToolRegistration,
  type ToolRiskClass,
} from "@nexus/core";
import { Button, EmptyState, PageHeader, TextField } from "@nexus/ui";
import { useMemo, useState, type ComponentType } from "react";

import { createModuleRegistry } from "../../shared/modules.js";
import { ProPackDialog } from "./ProPacks.js";
import { PRO_TOOL_SURFACES } from "./proToolSurfaces.js";
import { filterTools, type SearchableTool } from "./toolSearch.js";
import { TOOL_SURFACES } from "./toolSurfaces.js";
import { strings } from "./strings.js";
import { moduleName } from "./moduleName.js";
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
 * The search field is here rather than in a corner because a drawer of a dozen
 * tools that cannot be searched is a drawer somebody opens twice and then stops
 * opening — and a profile with four packs can hold well over a hundred.
 * Filtering narrows the LIST only — the open tool stays open, so typing to find
 * the next one never clears the answer you are still reading.
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
        ...(tool.keywords === undefined ? {} : { keywords: tool.keywords }),
      }));
  }, [drawer, enabledModules, packs, surfaces]);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickingPacks, setPickingPacks] = useState(false);

  const visible = filterTools(tools, query);
  const selected = tools.find((tool) => tool.id === selectedId) ?? null;
  const Surface = selected === null ? undefined : surfaces[selected.id];
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
   * Derived once rather than written at each of the four call sites: they are
   * the same page in two drawers, and a hard-coded `"tools"` on three of them
   * put „Alatke"'s ruler over „Stručne alatke"'s empty rail — the mark saying
   * one module while the header said the other.
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
        <>
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

          <div className="tool__layout">
            <nav className="tool__list" aria-label={s.title}>
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
                    <h3 className="nx-eyebrow tool__group-title">{strings.tools.category[category]}</h3>
                    {/* The app's ONE nav-row grammar (`.nx-nav-item`): the hover
                        tint, the gold-and-weight selection and the trailing ✦ all
                        come from the shared rule, and `.tool__item` adds only what
                        a `<button>` needs in order to wear it. The drawer used to
                        carry a private copy that had drifted on all three — see the
                        rule in `tools.css` for what each drift was. */}
                    {members.map((tool) => {
                      const active = tool.id === selectedId;
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
                            setSelectedId(tool.id);
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
                  comment in `strings.ts` promises, and for as long as it has existed
                  there was nothing to do: the way back is to clear a search field
                  the empty list has just pushed out of sight. `clearSearch` was
                  written for this control and rendered nowhere. */}
              {visible.length === 0 && (
                <div className="tool__empty">
                  {/* `inline`, and inside a 180–240px rail: the page shape's 48px
                      mark and its column of centred type would be wider than the
                      rail it is reporting on. The mark still rides the line, so the
                      absence is still the module's. */}
                  <EmptyState variant="inline" sigil={sigil} title={s.noMatches} />
                  {/* `quiet` is the primitive for exactly this — a control that
                      reads as a line of text and still keeps the pointer floor. The
                      drawer had a hand-rolled `.tool__clear` doing the same three
                      declarations, which is the shape that variant was added to
                      retire. Its negative inline margin is what keeps the label
                      flush with the line above it. */}
                  <Button variant="quiet" onClick={() => setQuery("")}>
                    {s.clearSearch}
                  </Button>
                </div>
              )}
            </nav>

            <section className="tool__surface">
              {selected !== null && Surface !== undefined ? (
                <>
                  <h3 className="tool__surface-title">{selected.name}</h3>
                  {/* The blurb is the developer drawer's, and it earns its place
                      there rather than here: „Dužina" needs no sentence, while
                      „Mikroskalirani blokovi" is unreadable without one. Rendered
                      from the registration so a tool that declares none simply has
                      none, instead of an empty line reserving space for it. */}
                  {selected.blurb !== undefined && <p className="tool__surface-blurb">{selected.blurb}</p>}
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
                // The whole right pane is empty, which is the `page` shape — and it
                // takes the module's mark, so the drawer looks like a surface
                // waiting for a choice rather than a paragraph nobody finished.
                <EmptyState sigil={sigil} title={s.emptyTitle} description={s.empty} />
              )}
            </section>
          </div>
        </>
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

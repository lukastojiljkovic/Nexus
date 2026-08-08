import { TOOL_CATEGORIES, type ToolRegistration } from "@nexus/core";
import { Button, EmptyState, PageHeader, TextField } from "@nexus/ui";
import { useMemo, useState } from "react";

import { createModuleRegistry } from "../../shared/modules.js";
import { filterTools, type SearchableTool } from "./toolSearch.js";
import { TOOL_SURFACES } from "./toolSurfaces.js";
import { strings } from "./strings.js";
import { moduleName } from "./moduleName.js";

/**
 * „Alatke" (UTIL slice c) — the tool drawer, and the utilities HOST the
 * `ToolRegistration` contract was reserved for.
 *
 * **This page has no list of tools and no `switch`.** It collects
 * `manifest.tools` across the module registry and renders whatever it finds
 * through `TOOL_SURFACES`, so its own converters and calculators arrive by
 * exactly the path a future module's tool would. Adding a tool never touches
 * this file; that is the whole point of the contract.
 *
 * **A tool from a switched-off module is not offered.** The drawer is a host,
 * not an exemption: if a profile has a module off, the module's tools go with
 * it, the same way its page and its widgets do.
 *
 * The search field is here rather than in a corner because a drawer of a dozen
 * tools that cannot be searched is a drawer somebody opens twice and then stops
 * opening. Filtering narrows the LIST only — the open tool stays open, so
 * typing to find the next one never clears the answer you are still reading.
 */

/**
 * A `titleKey` resolved against `strings` — the same dotted-path lookup
 * `modules.test.ts` pins for widget titles. A path is used rather than a direct
 * `strings.tools.name` read because the contract promises one: a tool published
 * by some other module names a string in that module's own group.
 */
function resolveTitle(titleKey: string): string {
  const resolved = titleKey
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        typeof node === "object" && node !== null ? (node as Record<string, unknown>)[key] : undefined,
      strings,
    );
  return typeof resolved === "string" ? resolved : titleKey;
}

export interface ToolsPageProps {
  /**
   * The modules this profile has switched on. A tool whose owning module is off
   * is not drawn — see the header.
   */
  enabledModules: ReadonlySet<string>;
}

export function ToolsPage({ enabledModules }: ToolsPageProps) {
  // Read on every render, not at module scope, so a language switch relabels
  // the drawer instead of freezing it at import.
  const s = strings.tools;
  const tools = useMemo<SearchableTool[]>(() => {
    const registry = createModuleRegistry();
    return registry
      .all()
      .filter((manifest) => enabledModules.has(manifest.id))
      .flatMap((manifest) => manifest.tools ?? [])
      .filter((tool: ToolRegistration) => TOOL_SURFACES[tool.id] !== undefined)
      .map((tool) => ({
        id: tool.id,
        name: resolveTitle(tool.titleKey),
        category: tool.category,
        ...(tool.keywords === undefined ? {} : { keywords: tool.keywords }),
      }));
  }, [enabledModules]);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = filterTools(tools, query);
  const selected = tools.find((tool) => tool.id === selectedId) ?? null;
  const Surface = selected === null ? undefined : TOOL_SURFACES[selected.id];

  return (
    <div className="tool">
      <PageHeader title={moduleName("tools")} sigil="tools" />
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
          {TOOL_CATEGORIES.map((category) => {
            const members = visible.filter((tool) => tool.category === category);
            if (members.length === 0) return null;
            return (
              <div key={category} className="tool__group">
                <h3 className="nx-eyebrow tool__group-title">{s.category[category]}</h3>
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
              <EmptyState variant="inline" sigil="tools" title={s.noMatches} />
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
              <Surface />
            </>
          ) : (
            // The whole right pane is empty, which is the `page` shape — and it
            // takes the module's mark, so the drawer looks like a surface
            // waiting for a choice rather than a paragraph nobody finished.
            <EmptyState sigil="tools" title={s.emptyTitle} description={s.empty} />
          )}
        </section>
      </div>
    </div>
  );
}

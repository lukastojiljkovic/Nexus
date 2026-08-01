import { TOOL_CATEGORIES, type ToolRegistration } from "@nexus/core";
import { TextField } from "@nexus/ui";
import { useMemo, useState } from "react";

import { createModuleRegistry } from "../../shared/modules.js";
import { filterTools, type SearchableTool } from "./toolSearch.js";
import { TOOL_SURFACES } from "./toolSurfaces.js";
import { strings } from "./strings.js";

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

const s = strings.tools;

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
                <h3 className="tool__group-title">{s.category[category]}</h3>
                {members.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    className={
                      tool.id === selectedId ? "tool__item tool__item--active" : "tool__item"
                    }
                    aria-current={tool.id === selectedId}
                    onClick={() => {
                      setSelectedId(tool.id);
                    }}
                  >
                    {tool.name}
                  </button>
                ))}
              </div>
            );
          })}
          {visible.length === 0 && <p className="tool__note">{s.noMatches}</p>}
        </nav>

        <section className="tool__surface">
          {selected !== null && Surface !== undefined ? (
            <>
              <h3 className="tool__surface-title">{selected.name}</h3>
              <Surface />
            </>
          ) : (
            <p className="tool__note">{s.empty}</p>
          )}
        </section>
      </div>
    </div>
  );
}

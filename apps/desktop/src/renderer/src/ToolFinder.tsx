import { TOOL_TASK_GROUPS, type ToolTaskGroup } from "@nexus/core";
import { Button, Icon, TextField } from "@nexus/ui";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { searchToolCatalogue, type ToolCatalogueEntry } from "./toolCatalogue.js";
import { readFavouriteTools, toggleFavouriteTool } from "./toolPrefs.js";
import { activeLocale, strings } from "./strings.js";

/**
 * The finder — one search across EVERY tool, drawn at the head of both drawers.
 *
 * **Why it exists.** The rail is ordered by profession, which is the right order
 * once you know what you are looking for and the wrong one when you do not:
 * somebody who needs a VAT figure, or the number of days between two dates, has
 * to guess which of eighteen toolkits owns it. This answers the question they
 * actually have, and it is the SAME component on „Alatke" and „Stručne alatke"
 * because it is one catalogue — a tool from the other drawer comes back as a
 * result here and opens there.
 *
 * **It adds a way in and changes no other.** The rail, the categories, the pack
 * directory and the surfaces are exactly what they were; nothing here reorders
 * them, and a result opens a tool by the same path the rail's own row does (see
 * `ToolsPage`'s `openTool`, which is what `onOpen` is).
 *
 * **Favourites and „Nedavno" are the two halves of the same problem.** Three
 * hundred tools is an index, and the four or five somebody actually uses are
 * somewhere inside it every time. A star is the deliberate version of that and a
 * history is the incidental one; both are per PROFILE, both live in
 * `toolPrefs.ts`, and both are drawn over an empty box because that is the state
 * they are for.
 *
 * ---
 *
 * **The keyboard, and why this is NOT the palette's combobox pattern.**
 * `SearchPalette` keeps focus in the input and marks the active row with
 * `aria-activedescendant` over non-focusable `role="option"` rows, which is the
 * right shape for a list where a row does one thing. Here a row carries TWO
 * controls — the tool it opens, and the star that favourites it — and an
 * interactive control nested inside an option is a control no reader can reach.
 * So the rows are real buttons (the app's `.tool-dir__row` precedent), the arrow
 * keys move DOM focus between them, and Escape comes back to the field with the
 * query cleared. The visible highlight is still typographic — gold and weight,
 * no glow (the design rules' own selection grammar).
 */

export interface ToolFinderProps {
  /** Whose stars and whose history this is — per profile, like the sidebar's pinned rows. */
  readonly profileId: string;
  /** Every tool this profile can reach, both drawers, in catalogue order. */
  readonly catalogue: readonly ToolCatalogueEntry[];
  /** The tools this profile opened last, newest first (`readRecentTools`). */
  readonly recentIds: readonly string[];
  /**
   * Open a tool: the drawer the tool belongs to is the page's own business, and
   * `ToolsPage` takes it from here — a result in the other drawer switches pages
   * and opens it there, which is the only difference from clicking the rail.
   */
  readonly onOpen: (entry: ToolCatalogueEntry) => void;
}

/** One block of the panel: a heading (or none) over its rows. */
interface FinderSection {
  readonly key: string;
  readonly heading: string | null;
  readonly entries: readonly ToolCatalogueEntry[];
}

export function ToolFinder({ profileId, catalogue, recentIds, onOpen }: ToolFinderProps) {
  // Read on every render, not at module scope, so a language switch relabels the
  // field and every row instead of freezing them at import.
  const s = strings.toolFinder;
  const locale = activeLocale();

  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<readonly ToolTaskGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  /**
   * Seeded from the store once, and re-read only by REMOUNT — which is what
   * `ToolsPage` gives every profile switch (`key={activeProfile.id}` in `App`,
   * as every other page has). A second reader here would be a second answer to
   * whose stars these are.
   */
  const [favourites, setFavourites] = useState<readonly string[]>(() =>
    readFavouriteTools(profileId),
  );
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const byId = useMemo(
    () => new Map(catalogue.map((entry) => [entry.id, entry])),
    [catalogue],
  );
  const matches = useMemo(
    () => searchToolCatalogue(catalogue, query, groups, locale),
    [catalogue, query, groups, locale],
  );
  const starred = useMemo(() => new Set(favourites), [favourites]);

  const favouriteEntries = favourites
    .map((id) => byId.get(id))
    .filter((entry): entry is ToolCatalogueEntry => entry !== undefined);
  const recentEntries = recentIds
    .map((id) => byId.get(id))
    .filter((entry): entry is ToolCatalogueEntry => entry !== undefined);

  /**
   * Three sections over an empty box, one flat list once anything has been typed
   * or filtered. The headings say what each list IS, and a tool in more than one
   * of them is the truth about it rather than a duplicate to be hidden: a
   * favourite is a subset of the catalogue by definition, and the professional
   * drawer's own directory has drawn its „Nedavno" over its index since it
   * shipped.
   */
  const filtering = query.trim() !== "" || groups.length > 0;
  const sections: readonly FinderSection[] = filtering
    ? [{ key: "matches", heading: null, entries: matches }]
    : [
        ...(favouriteEntries.length === 0
          ? []
          : [{ key: "favourites", heading: s.favourites, entries: favouriteEntries }]),
        ...(recentEntries.length === 0
          ? []
          : [{ key: "recent", heading: s.recent, entries: recentEntries }]),
        { key: "all", heading: s.allTools, entries: matches },
      ];
  /**
   * The rows the arrow keys walk, and where each section starts in them.
   *
   * Computed before the render rather than counted inside it: the index is what
   * both the keyboard and the `ref` array are addressed by, and a running counter
   * mutated while JSX is being built is a number that depends on how many rows
   * have already been drawn.
   */
  const laidOut: { section: FinderSection; start: number }[] = [];
  let rowCount = 0;
  for (const section of sections) {
    laidOut.push({ section, start: rowCount });
    rowCount += section.entries.length;
  }
  const rows = sections.flatMap((section) => section.entries);

  /** Moves the real focus to a row, wrapping at both ends — the arrow keys' whole contract. */
  function focusRow(index: number): void {
    if (rows.length === 0) return;
    const next = ((index % rows.length) + rows.length) % rows.length;
    setActiveIndex(next);
    rowRefs.current[next]?.focus();
  }

  function clearQuery(): void {
    setQuery("");
    setActiveIndex(-1);
  }

  /**
   * Opens a result and puts the finder away. The panel is opaque and sits over
   * the instrument, and a click on a row keeps focus inside the finder, so the
   * blur that closes it otherwise never comes: left open, it would cover the
   * very tool it just opened.
   */
  function openEntry(entry: ToolCatalogueEntry): void {
    onOpen(entry);
    clearQuery();
    setOpen(false);
  }

  function handleFieldKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(activeIndex <= 0 ? rows.length - 1 : activeIndex - 1);
    } else if (event.key === "Enter") {
      // While typing, Enter takes the top match; on an empty field it opens
      // nothing, because the first row there is a favourite nobody pointed at.
      const entry = rows[activeIndex] ?? (filtering ? rows[0] : undefined);
      if (entry !== undefined) {
        event.preventDefault();
        openEntry(entry);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (query !== "") clearQuery();
      else setOpen(false);
    }
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(index - 1);
    } else if (event.key === "Escape") {
      // Back to the field, query cleared — Escape means „start again", and a
      // half-typed query left standing behind the reader is not that.
      event.preventDefault();
      clearQuery();
      fieldRef.current?.focus();
    }
  }

  /** The one line under a name: what the tool is, or failing that whose it is. */
  function rowMeta(entry: ToolCatalogueEntry): string {
    return entry.description?.[locale] ?? entry.profession[locale];
  }

  return (
    <div
      className="tool-finder"
      // Focus moving WITHIN the finder — to a row, or back to the field — must not
      // collapse the panel; only focus leaving it does.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="tool-finder__bar">
        <TextField
          ref={fieldRef}
          className="tool-finder__search"
          type="search"
          value={query}
          aria-label={s.searchLabel}
          placeholder={s.searchPlaceholder}
          autoComplete="off"
          onFocus={() => {
            setOpen(true);
          }}
          onKeyDown={handleFieldKeyDown}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
        />
        {/* The task groups, as `SearchPalette`'s kind chips: the same segmented
            control, the same `aria-pressed`, one press to narrow and one to
            widen. */}
        <div className="tool-finder__groups" role="group" aria-label={s.groupsLabel}>
          {TOOL_TASK_GROUPS.map((group) => {
            const on = groups.includes(group);
            return (
              <Button
                key={group}
                size="sm"
                className="nx-segmented__option"
                aria-pressed={on}
                onClick={() => {
                  setGroups((current) =>
                    current.includes(group)
                      ? current.filter((seen) => seen !== group)
                      : [...current, group],
                  );
                  setActiveIndex(-1);
                  setOpen(true);
                }}
              >
                {s.groups[group]}
              </Button>
            );
          })}
        </div>
      </div>
      {open && (
        <div className="tool-finder__panel">
          <div className="tool-finder__scroll">
            {laidOut.map(({ section, start }) => (
              <div key={section.key} className="tool-finder__section">
                {section.heading !== null && (
                  <h3 className="nx-eyebrow tool-finder__heading">{section.heading}</h3>
                )}
                {section.entries.map((entry, offsetInSection) => {
                  const index = start + offsetInSection;
                  const isStarred = starred.has(entry.id);
                  return (
                    <div
                      key={`${section.key}:${entry.id}`}
                      className={
                        index === activeIndex
                          ? "tool-finder__row tool-finder__row--active"
                          : "tool-finder__row"
                      }
                    >
                      <button
                        ref={(node) => {
                          rowRefs.current[index] = node;
                        }}
                        type="button"
                        className="tool-finder__open"
                        onFocus={() => {
                          setActiveIndex(index);
                        }}
                        onMouseEnter={() => {
                          setActiveIndex(index);
                        }}
                        onKeyDown={(event) => {
                          handleRowKeyDown(event, index);
                        }}
                        onClick={() => {
                          openEntry(entry);
                        }}
                      >
                        <span className="tool-finder__name">{entry.name[locale]}</span>
                        <span className="tool-finder__meta">{rowMeta(entry)}</span>
                      </button>
                      <Button
                        size="sm"
                        variant="quiet"
                        className="tool-finder__star"
                        aria-pressed={isStarred}
                        aria-label={isStarred ? s.starRemove : s.starAdd}
                        title={isStarred ? s.starRemove : s.starAdd}
                        onClick={() => {
                          setFavourites(toggleFavouriteTool(profileId, entry.id));
                        }}
                      >
                        <Icon name={isStarred ? "starFilled" : "star"} />
                      </Button>
                    </div>
                  );
                })}
              </div>
            ))}
            {rows.length === 0 && (
              <div className="tool-finder__empty">
                <p className="nx-hint nx-hint--prose">{s.noMatches}</p>
                <Button
                  variant="quiet"
                  onClick={() => {
                    clearQuery();
                    setGroups([]);
                  }}
                >
                  {s.clearSearch}
                </Button>
              </div>
            )}
          </div>
          <p className="tool-finder__hint">{s.hint}</p>
        </div>
      )}
    </div>
  );
}

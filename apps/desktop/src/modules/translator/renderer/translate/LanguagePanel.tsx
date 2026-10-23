import { useMemo, useState } from "react";
import { Button, TextField } from "@nexus/ui";

import { copy } from "../copy.js";
import { matchLanguages, type LanguageEntry } from "./languages.js";

export interface LanguagePanelProps {
  /** The picker's name, read by a screen reader as the group's label. */
  readonly label: string;
  readonly entries: readonly LanguageEntry[];
  /** The side's last languages, newest first. */
  readonly recent: readonly LanguageEntry[];
  /** The NLLB code on, or `null` when the side is on its automatic choice. */
  readonly selected: string | null;
  /** The source's "Detect language" choice, which is not a language and so is not in `entries`. */
  readonly auto?: { readonly label: string; readonly selected: boolean; readonly onChoose: () => void } | undefined;
  readonly onChoose: (code: string) => void;
  /** Closes the panel and returns focus to the picker that opened it. */
  readonly onClose: () => void;
  readonly noMatch: (query: string) => string;
}

/**
 * The panel a language picker opens inside the card: a search box that takes
 * focus, the side's recent languages, then every language as a grid of buttons.
 *
 * The search is over the names and codes `matchLanguages` reads, so it works in
 * either locale. Escape closes the panel, and so does choosing a language.
 */
export function LanguagePanel({
  label,
  entries,
  recent,
  selected,
  auto,
  onChoose,
  onClose,
  noMatch,
}: LanguagePanelProps) {
  const [query, setQuery] = useState("");
  const found = useMemo(() => matchLanguages(entries, query), [entries, query]);
  const foundRecent = useMemo(() => matchLanguages(recent, query), [recent, query]);

  return (
    <div
      className="translator__panel"
      role="group"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <TextField
        label={copy.translate.search}
        value={query}
        autoComplete="off"
        spellCheck={false}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />
      {auto !== undefined && (
        <div className="translator__languages">
          <Button
            size="sm"
            variant={auto.selected ? "primary" : "ghost"}
            aria-pressed={auto.selected}
            onClick={auto.onChoose}
          >
            {auto.label}
          </Button>
        </div>
      )}
      {foundRecent.length > 0 && (
        <section className="translator__group" aria-label={copy.translate.recent}>
          <h3 className="nx-eyebrow">{copy.translate.recent}</h3>
          <LanguageButtons entries={foundRecent} selected={selected} onChoose={onChoose} />
        </section>
      )}
      <section className="translator__group" aria-label={copy.translate.all}>
        <h3 className="nx-eyebrow">{copy.translate.all}</h3>
        {found.length === 0 ? (
          <p className="nx-hint">{noMatch(query.trim())}</p>
        ) : (
          <LanguageButtons entries={found} selected={selected} onChoose={onChoose} />
        )}
      </section>
    </div>
  );
}

function LanguageButtons({
  entries,
  selected,
  onChoose,
}: {
  entries: readonly LanguageEntry[];
  selected: string | null;
  onChoose: (code: string) => void;
}) {
  return (
    <div className="translator__languages">
      {entries.map((entry) => {
        const on = entry.row.code === selected;
        return (
          <Button
            key={entry.row.code}
            size="sm"
            variant={on ? "primary" : "ghost"}
            aria-pressed={on}
            onClick={() => onChoose(entry.row.code)}
          >
            {entry.name}
          </Button>
        );
      })}
    </div>
  );
}

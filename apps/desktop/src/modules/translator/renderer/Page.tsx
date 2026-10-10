import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  ListRow,
  LoadingState,
  PageHeader,
  TextField,
} from "@nexus/ui";

import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { declaredText, ExternalLink } from "../../../renderer/src/moduleKit/moduleSurface.js";
// `fill` is the shell's own `{name}` interpolator: a FUNCTION, imported rather
// than re-implemented, and not a table read — so nothing here freezes a language
// and `check:string-capture` has nothing to say about it.
import { fill } from "../../../renderer/src/strings.js";
import { manifest } from "../shared/manifest.js";
import {
  TRANSLATOR_DIRECTION_CHOICES,
  type TranslatorDirectionChoice,
  type TranslatorEntryView,
  type TranslatorPhrasesView,
  type TranslatorSearchView,
  type TranslatorStatusView,
  type TranslatorTopicView,
} from "../shared/ipc.js";
import { copy } from "./copy.js";
import { entryText, sourceLine } from "./format.js";
import { SentenceTranslator } from "./sentences/SentenceTranslator.js";
import {
  clearRecent,
  persistRecent,
  persistDirection,
  readRecent,
  readStoredDirection,
  readStoredRecentLimit,
  withLookup,
} from "./prefs.js";
import "./translator.css";

/**
 * PREVODILAC (ADR-090) — a Serbian–English dictionary over the
 * `dictionary-sr-en` content pack (ADR-091).
 *
 * **Two tabs, and the second one is a seam.** „Reči" is this module: the
 * search, the recent list and the phrasebook. „Rečenice" belongs to the run
 * that translates sentences: `sentences/SentenceTranslator.tsx` owns everything
 * under that folder — its own copy table, its own engine client, its own worker
 * — and this page renders it and hands it the installed packs.
 *
 * **Nothing here computes a lookup.** The search runs in MAIN
 * (`main/register.ts` → `main/pack.ts`), over an index held in memory and read
 * from disk with one `read` per hit; the page sends a query and renders the
 * answer. A page that searched the pack in the renderer would either hold
 * fifteen megabytes of dictionary on the UI thread or re-read them per keystroke,
 * and the worker rule (heavy computation off the UI thread) is satisfied by the
 * computation not being in this process at all.
 *
 * **Every clock, count and list on this page comes from main or from storage.**
 * The recent list is `localStorage` (`prefs.ts`), the direction is a device
 * preference, and the entries are what the pack says — no local guess is ever
 * shown on top of an answer.
 */

/** How many prefix neighbours the page asks for, and how long it waits after a keystroke before asking. */
const RESULT_LIMIT = 20;
const DEBOUNCE_MS = 150;

/** The page's two tabs: this module's word search, and the sentence translator's surface. */
type TranslatorTab = "words" | "sentences";

export default function TranslatorPage({ profileId }: ModulePageProps) {
  const [status, setStatus] = useState<TranslatorStatusView | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [tab, setTab] = useState<TranslatorTab>("words");

  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState<TranslatorDirectionChoice>(() => readStoredDirection());
  const [answered, setAnswered] = useState<{ query: string; view: TranslatorSearchView } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  // The cap is read on mount and used to trim the recent list; the settings card
  // is where it is CHANGED, so this page only ever reads it (and re-reads it the
  // next time it mounts, which is what coming back from Podešavanja is).
  const [limit] = useState(() => readStoredRecentLimit());
  const [recent, setRecent] = useState<string[]>(() => readRecent(profileId));

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await window.nexus.modules.translator.status({});
        if (active) setStatus(next);
      } catch (failure) {
        if (active) setStatusError(copy.errors.load);
        console.error("Nexus: the dictionary pack's state could not be read:", failure);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  /**
   * One search, with the answer adopted only when it is still the answer to what
   * is in the box: replies can land out of order, and a slow earlier one must not
   * overwrite a newer result. The guard is the query itself rather than a counter,
   * because the query is what the answer is about.
   */
  const run = useCallback(
    async (text: string) => {
      try {
        const view = await window.nexus.modules.translator.search({
          direction: choice,
          query: text,
          limit: RESULT_LIMIT,
        });
        setAnswered((current) => (current !== null && current.query !== text ? current : { query: text, view }));
        setSearchError(null);
      } catch (failure) {
        setSearchError(copy.errors.search);
        console.error("Nexus: the dictionary search failed:", failure);
      }
    },
    [choice],
  );

  useEffect(() => {
    const text = query.trim();
    if (text === "" || status?.installed !== true) return;
    const handle = window.setTimeout(() => void run(text), DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, run, status?.installed]);

  /**
   * A lookup is remembered when it FOUND the word — an exact hit, not a prefix
   * guess — which is what makes the recent list a list of words rather than of
   * keystrokes. Recording happens here rather than inside `run` so that the
   * search callback does not depend on the list it updates (which would make
   * every answer re-fire the search that produced it).
   */
  useEffect(() => {
    if (answered === null || answered.view.exact.length === 0) return;
    setRecent((current) => {
      const updated = withLookup(current, answered.query, limit);
      persistRecent(profileId, updated);
      return updated;
    });
  }, [answered, limit, profileId]);

  function choose(next: TranslatorDirectionChoice): void {
    setChoice(next);
    persistDirection(next);
  }

  const installed = status?.installed === true;

  return (
    <div className="translator">
      {/* The page's name is the word the module DECLARED, read in the language
          being spoken, rather than a second copy of it (ADR-090's copy split). */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="book"
      />

      {statusError !== null && (
        <p className="translator__error" role="alert">
          {statusError}
        </p>
      )}

      <div className="translator__tabs" role="tablist" aria-label={declaredText(manifest.copy?.name)}>
        {(["words", "sentences"] as const).map((each) => (
          <Button
            key={each}
            role="tab"
            aria-selected={tab === each}
            variant={tab === each ? "primary" : "ghost"}
            size="sm"
            onClick={() => setTab(each)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              setTab(each === "words" ? "sentences" : "words");
            }}
          >
            {each === "words" ? copy.search.label : copy.sentences.title}
          </Button>
        ))}
      </div>

      {tab === "words" ? (
        <div role="tabpanel" aria-label={copy.search.label}>
          {status === null ? (
            <LoadingState label={copy.page.loading} rows={4} />
          ) : !installed ? (
            <EmptyState
              title={copy.notInstalled.title}
              description={copy.notInstalled.body}
              sigil="book"
            />
          ) : (
            <>
              <SearchCard
                query={query}
                onQuery={setQuery}
                choice={choice}
                onChoose={choose}
                answered={answered?.view ?? null}
                error={searchError}
              />
              <RecentCard
                words={recent}
                onPick={(word) => setQuery(word)}
                onClear={() => {
                  clearRecent(profileId);
                  setRecent([]);
                }}
              />
              <PhrasesCard />
              <PackFooter status={status} />
            </>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label={copy.sentences.title}>
          {/* The sentence surface, with its pack list taken from THIS module's
              ops rather than from the shell's `packsList`: a kit module reaches
              the machine through its own contract, and the two are the same read
              (`packs` answers what the registry has installed). */}
          <SentenceTranslator
            loadPacks={() =>
              window.nexus.modules.translator.packs({}).then((view) => view.packs)
            }
          />
        </div>
      )}
    </div>
  );
}

// --- The search ---------------------------------------------------------------

function SearchCard({
  query,
  onQuery,
  choice,
  onChoose,
  answered,
  error,
}: {
  query: string;
  onQuery: (value: string) => void;
  choice: TranslatorDirectionChoice;
  onChoose: (value: TranslatorDirectionChoice) => void;
  answered: TranslatorSearchView | null;
  error: string | null;
}) {
  const hits = answered === null ? 0 : answered.exact.length + answered.prefix.length;
  return (
    <Card title={copy.search.label}>
      <TextField
        label={copy.search.label}
        placeholder={copy.search.placeholder}
        value={query}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onQuery(event.target.value)}
        // Escape empties the box, which is what a search field's Escape does
        // everywhere else in this app: it closes the thing the field opened.
        onKeyDown={(event) => {
          if (event.key === "Escape" && query !== "") {
            event.preventDefault();
            onQuery("");
          }
        }}
      />
      <p className="nx-hint">{copy.search.hint}</p>

      <div className="translator__direction" role="group" aria-label={copy.search.directionLabel}>
        {TRANSLATOR_DIRECTION_CHOICES.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={choice === option ? "primary" : "ghost"}
            aria-pressed={choice === option}
            onClick={() => onChoose(option)}
          >
            {copy.search.directions[option]}
          </Button>
        ))}
      </div>
      {choice === "auto" && answered !== null && (
        <p className="nx-hint">
          {copy.search.autoResolved}: {copy.search.directions[answered.direction]}
        </p>
      )}

      {error !== null && (
        <p className="translator__error" role="alert">
          {error}
        </p>
      )}

      {answered !== null && (
        // The count is announced rather than only drawn: a reader who cannot see
        // the list change under them while typing hears how much is there.
        <p className="nx-hint" role="status" aria-live="polite">
          {hits === 1 ? copy.search.hitOne : fill(copy.search.hits, { count: hits })}
        </p>
      )}

      {answered !== null && hits === 0 && (
        <EmptyState
          variant="inline"
          title={fill(copy.search.noHits, { query: query.trim() })}
          description={copy.search.noHitsHint}
        />
      )}

      {answered !== null && answered.exact.length > 0 && (
        <section className="translator__group" aria-label={copy.search.exactTitle}>
          <h3 className="nx-eyebrow">{copy.search.exactTitle}</h3>
          {answered.exact.map((entry) => (
            <EntryRow key={`${entry.word}:${entry.pos}:exact`} entry={entry} />
          ))}
        </section>
      )}

      {answered !== null && answered.prefix.length > 0 && (
        <section className="translator__group" aria-label={copy.search.prefixTitle}>
          <h3 className="nx-eyebrow">{copy.search.prefixTitle}</h3>
          {answered.prefix.map((entry) => (
            <EntryRow key={`${entry.word}:${entry.pos}:prefix`} entry={entry} />
          ))}
          {answered.truncated && <p className="nx-hint">{copy.search.truncated}</p>}
        </section>
      )}
    </Card>
  );
}

// --- One entry ----------------------------------------------------------------

function EntryRow({ entry }: { entry: TranslatorEntryView }) {
  const [copied, setCopied] = useState<"entry" | "url" | "failed" | null>(null);

  async function write(kind: "entry" | "url", text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch (failure) {
      setCopied("failed");
      console.error("Nexus: the dictionary entry could not be copied:", failure);
    }
  }

  return (
    <div className="translator__entry">
      <p className="translator__headword">
        <span className="translator__word">{entry.word}</span>
        {entry.latin !== null && <span className="translator__latin"> ({entry.latin})</span>}
        {entry.pos !== "" && <Chip>{entry.pos}</Chip>}
      </p>
      {entry.glosses.length > 0 && (
        <p className="translator__glosses">
          <span className="translator__label">{copy.entry.meanings}: </span>
          {entry.glosses.join("; ")}
        </p>
      )}
      {entry.translations.length > 0 && (
        <p className="translator__translations">
          <span className="translator__label">{copy.entry.translations}: </span>
          {entry.translations.join(", ")}
        </p>
      )}
      <p className="translator__source">
        <span className="translator__label">{copy.entry.source}: </span>
        {/* The entry's own page, opened in the user's browser through the kit's
            one door (ADR-107). The label is the host and the path rather than
            the whole address, and a refusal leaves the address as selectable
            text — `ExternalLink` does both. */}
        <ExternalLink href={entry.url}>{sourceLine(entry.url)}</ExternalLink>
        <Button size="sm" variant="quiet" onClick={() => void write("url", entry.url)}>
          {copy.entry.copyUrl}
        </Button>
      </p>
      <div className="translator__entry-actions">
        <Button
          size="sm"
          variant="quiet"
          onClick={() =>
            void write(
              "entry",
              entryText(entry, { translations: copy.entry.translations, meanings: copy.entry.meanings }),
            )
          }
        >
          {copy.entry.copyWord}
        </Button>
        {copied !== null && (
          <span className={copied === "failed" ? "translator__error" : "nx-hint"} role="status">
            {copied === "failed" ? copy.entry.copyFailed : copy.entry.copied}
          </span>
        )}
      </div>
    </div>
  );
}

// --- Recent lookups -----------------------------------------------------------

function RecentCard({
  words,
  onPick,
  onClear,
}: {
  words: readonly string[];
  onPick: (word: string) => void;
  onClear: () => void;
}) {
  return (
    <Card title={copy.recent.title}>
      {words.length === 0 ? (
        <p className="nx-hint">{copy.recent.empty}</p>
      ) : (
        <>
          <div className="translator__list">
            {words.map((word) => (
              <ListRow
                key={word}
                leading={<Icon name="clock" />}
                trailing={
                  <Button size="sm" variant="quiet" onClick={() => onPick(word)}>
                    {copy.recent.again}
                  </Button>
                }
              >
                <span className="translator__recent-word">{word}</span>
              </ListRow>
            ))}
          </div>
          <div className="translator__list-actions">
            <Button size="sm" variant="quiet" onClick={onClear}>
              {copy.recent.clear}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

// --- The phrasebook -----------------------------------------------------------

function PhrasesCard() {
  const [phrases, setPhrases] = useState<TranslatorPhrasesView | null>(null);
  const [failed, setFailed] = useState(false);
  const [topic, setTopic] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await window.nexus.modules.translator.phrases({});
        if (active) setPhrases(next);
      } catch (failure) {
        if (active) setFailed(true);
        console.error("Nexus: the phrasebook could not be read:", failure);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const topics = phrases?.topics ?? [];
  const shown = topics.find((each) => each.id === topic) ?? topics[0] ?? null;

  return (
    <Card title={copy.phrases.title}>
      <p className="nx-hint">{copy.phrases.caption}</p>
      {failed ? (
        <p className="translator__error" role="alert">
          {copy.errors.phrases}
        </p>
      ) : phrases === null ? (
        <p className="nx-hint">{copy.phrases.loading}</p>
      ) : topics.length === 0 ? (
        <p className="nx-hint">{copy.phrases.empty}</p>
      ) : (
        <>
          <div className="translator__topics" role="group" aria-label={copy.phrases.title}>
            {topics.map((each) => (
              <Button
                key={each.id}
                size="sm"
                variant={shown?.id === each.id ? "primary" : "ghost"}
                aria-pressed={shown?.id === each.id}
                onClick={() => setTopic(each.id)}
              >
                {each.title}
              </Button>
            ))}
          </div>
          {shown !== null && <PhraseList topic={shown} />}
        </>
      )}
    </Card>
  );
}

function PhraseList({ topic }: { topic: TranslatorTopicView }) {
  return (
    <section className="translator__group" aria-label={topic.title}>
      <h3 className="nx-eyebrow">{topic.title}</h3>
      <p className="nx-hint">
        {fill(copy.phrases.topicHits, { count: topic.phrases.length })}
      </p>
      <div className="translator__list">
        {topic.phrases.map((phrase, index) => (
          <ListRow key={`${topic.id}:${String(index)}`} leading={<Icon name="globe" />}>
            <span className="translator__phrase-en">{phrase.en}</span>
            <span className="translator__phrase-sr">{phrase.sr}</span>
          </ListRow>
        ))}
      </div>
    </section>
  );
}

// --- What the pack says about itself ------------------------------------------

/**
 * The licence notice, shown rather than hidden.
 *
 * ADR-091 requires a pack's attribution to be visible wherever it is listed, and
 * the CC BY-SA licence requires it to travel with the content: this is the one
 * place on this page where the reader can see that the words are Wiktionary's
 * and under what terms. It is selectable text rather than a disclosure, because
 * a notice behind a click is a notice somebody has to look for.
 */
function PackFooter({ status }: { status: TranslatorStatusView | null }) {
  if (status === null || !status.installed) return null;
  const counts = status.counts;
  return (
    <Card title={copy.pack.title}>
      {counts !== null && (
        <p className="nx-hint">
          {fill(copy.pack.words, { count: counts.enEntries + counts.srEntries })} ·{" "}
          {fill(copy.pack.phrases, { count: counts.phrases })}
        </p>
      )}
      {status.version !== null && <p className="nx-hint">{fill(copy.pack.version, { version: status.version })}</p>}
      <p className="translator__attribution">{status.attribution}</p>
      <p className="nx-hint">{status.licence}</p>
    </Card>
  );
}

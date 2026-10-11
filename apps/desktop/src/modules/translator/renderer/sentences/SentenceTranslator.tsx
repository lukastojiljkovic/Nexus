import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Chip, EmptyState, LoadingState, TextArea } from "@nexus/ui";
import { browserClock, workerTransport } from "./browser.js";
import { SentenceTranslatorClient } from "./client.js";
import { copy } from "./copy.js";
import {
  DIRECTIONS,
  missingPackId,
  packIdOf,
  resolveModelUrls,
  type Direction,
  type PackRef,
} from "./models.js";
import { splitParagraphs } from "./split.js";
import "./sentences.css";

/**
 * „Prevod rečenica" — the sentence translator: two text areas, a direction
 * switch, translation as the typing pauses, a machine-translation notice and a
 * copy button.
 *
 * **Why it is a component in its own folder and not the module's page.** The
 * translator module is built by two runs: the word lookup owns the page
 * (`renderer/Page.tsx`) and this surface owns everything under `sentences/`. The
 * maintainer wires it in with one line — `<SentenceTranslator />` — and it needs
 * nothing from the page beyond that: the installed packs come from the shell's
 * own `packsList`, which is the same list the „Paketi sadržaja" card draws.
 *
 * **Translation as you pause.** A 400 ms debounce after the last keystroke, and
 * the debounce is what keeps a fast typist from queueing a translation per
 * character: the client serializes requests, so without it a pasted paragraph
 * would be translated once per character arrival. Each new run takes a ticket,
 * and a result whose ticket is stale is dropped rather than written over a newer
 * one.
 *
 * **What the reader is told, and where.** The pack a direction needs is named
 * when it is missing; a long text reports how many sentences are done; and the
 * machine-translation notice sits with the result rather than in a footnote,
 * because a translated paragraph is exactly where somebody forgets it is a
 * machine's.
 */

/**
 * How long a pause ends the typing. 400 ms is below the pause between two words
 * and above the gap inside a word being typed, so a sentence is translated while
 * the reader is still deciding what to write next, and a word in progress is not
 * translated at all.
 */
const DEBOUNCE_MS = 400;

/** How long the copy button says „Kopirano" before it offers the action again. */
const COPIED_MS = 1500;

export interface SentenceTranslatorProps {
  /**
   * The installed packs. Defaults to the shell's own list; a caller passes one
   * only when it already holds it (`window.nexus.packsList` is the same read).
   */
  readonly loadPacks?: () => Promise<readonly PackRef[]>;
}

/** `{name}` placeholders in a copy sentence, filled by the component. */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (whole, key: string) => values[key] ?? whole);
}

type Phase = "idle" | "translating" | "failed";

export function SentenceTranslator({ loadPacks }: SentenceTranslatorProps = {}) {
  const [packs, setPacks] = useState<readonly PackRef[] | null>(null);
  const [direction, setDirection] = useState<Direction | null>(null);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{ readonly done: number; readonly total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /** Built on the first translation rather than on mount: a window that never opens this surface spawns no worker. */
  const client = useRef<SentenceTranslatorClient | null>(null);
  /** The ticket of the newest run; an answer that is not the newest one is dropped. */
  const ticket = useRef(0);
  const copiedTimer = useRef<number | null>(null);

  const readPacks = useCallback(
    (): Promise<readonly PackRef[]> => loadPacks?.() ?? window.nexus.packsList(),
    [loadPacks],
  );

  // The installed packs, and every change to them: a pack the user installs
  // while this surface is open makes its direction offerable without a reload.
  useEffect(() => {
    let live = true;
    const refresh = (): void => {
      readPacks()
        .then((list) => {
          if (live) setPacks(list);
        })
        .catch((error: unknown) => {
          if (!live) return;
          console.error("Nexus: the installed packs could not be listed:", error);
          setPacks([]);
          setNotice(copy.errorLoad);
        });
    };
    refresh();
    const off = window.nexus.onPacksChanged(() => refresh());
    return () => {
      live = false;
      off();
    };
  }, [readPacks]);

  // A direction is offered when its pack is installed, and the selection follows
  // the packs: uninstalling the current one moves the switch rather than leaving
  // the page pointing at a model that is gone.
  useEffect(() => {
    if (packs === null) return;
    const available = DIRECTIONS.filter((one) => missingPackId(one, packs) === null);
    setDirection((current) =>
      current !== null && available.includes(current) ? current : (available[0] ?? null),
    );
  }, [packs]);

  const run = useCallback(async (): Promise<void> => {
    if (direction === null || packs === null) return;
    const urls = resolveModelUrls(direction, packs);
    const mine = ++ticket.current;
    if (urls === null) {
      setPhase("failed");
      setProgress(null);
      setNotice(fill(copy.missingPack, { pack: packIdOf(direction) }));
      return;
    }
    const total = splitParagraphs(source).reduce((count, sentences) => count + sentences.length, 0);
    setPhase("translating");
    setNotice(null);
    setProgress({ done: 0, total });
    try {
      const active =
        client.current ??
        (client.current = new SentenceTranslatorClient({
          createTransport: workerTransport,
          clock: browserClock(),
        }));
      const result = await active.translate(source, direction, urls, (done, all) => {
        if (mine === ticket.current) setProgress({ done, total: all });
      });
      if (mine !== ticket.current) return;
      setTarget(result.text);
      setPhase("idle");
      setProgress(null);
    } catch (error) {
      if (mine !== ticket.current) return;
      console.error("Nexus: the sentence translation failed:", error);
      setPhase("failed");
      setProgress(null);
      setNotice(copy.errorTranslate);
    }
  }, [direction, packs, source]);

  // The debounce, and the one place the source is turned into a translation.
  useEffect(() => {
    if (direction === null || packs === null) return;
    if (source.trim() === "") {
      ticket.current += 1;
      setTarget("");
      setPhase("idle");
      setProgress(null);
      return;
    }
    const handle = window.setTimeout(() => void run(), DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [source, direction, packs, run]);

  useEffect(
    () => () => {
      ticket.current += 1;
      client.current?.dispose();
      client.current = null;
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const sentences = splitParagraphs(source).reduce((count, group) => count + group.length, 0);
  const available = packs === null ? [] : DIRECTIONS.filter((one) => missingPackId(one, packs) === null);

  return (
    <Card className="sentences">
      <div className="sentences__directions" role="group" aria-labelledby="sentences-direction">
        <span className="nx-hint" id="sentences-direction">
          {copy.directionLabel}
        </span>
        {DIRECTIONS.map((one) => {
          const missing = packs !== null && missingPackId(one, packs) !== null;
          return (
            <Button
              key={one}
              size="sm"
              className="nx-segmented__option"
              aria-pressed={direction === one}
              disabled={missing}
              title={missing ? fill(copy.missingPack, { pack: packIdOf(one) }) : undefined}
              onClick={() => setDirection(one)}
            >
              {copy.direction[one]}
            </Button>
          );
        })}
      </div>

      {packs === null ? (
        <LoadingState label={copy.heading} rows={3} />
      ) : available.length === 0 ? (
        <EmptyState title={copy.noPacksTitle} description={copy.noPacksBody} variant="inline" />
      ) : (
        <>
          <div className="sentences__fields">
            <TextArea
              className="sentences__text"
              label={copy.sourceLabel}
              value={source}
              rows={6}
              onChange={(event) => setSource(event.target.value)}
            />
            <p className="nx-hint">{copy.sourceHint}</p>
            <TextArea
              className="sentences__text"
              label={copy.targetLabel}
              value={target}
              rows={6}
              readOnly
              placeholder={copy.targetEmpty}
            />
          </div>

          <div className="sentences__actions">
            <Chip variant="accent">{copy.machineNotice}</Chip>
            {phase === "translating" && progress !== null && progress.total > 1 && (
              <span className="nx-hint">
                {fill(copy.progress, {
                  done: String(progress.done),
                  total: String(progress.total),
                })}
              </span>
            )}
            {phase !== "translating" && sentences > 1 && (
              <span className="nx-hint">{fill(copy.count, { count: String(sentences) })}</span>
            )}
            <Button
              variant="quiet"
              disabled={target === ""}
              onClick={() => {
                navigator.clipboard
                  .writeText(target)
                  .then(() => {
                    setCopied(true);
                    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
                    copiedTimer.current = window.setTimeout(() => {
                      copiedTimer.current = null;
                      setCopied(false);
                    }, COPIED_MS);
                  })
                  .catch(() => {
                    // A withheld clipboard permission is an answer, not an error
                    // to report: the label simply stays „Kopiraj".
                  });
              }}
            >
              {copied ? copy.copied : copy.copy}
            </Button>
          </div>

          <p className="nx-hint">{copy.machineHint}</p>
          {notice !== null && <p className="nx-hint">{notice}</p>}
        </>
      )}
    </Card>
  );
}

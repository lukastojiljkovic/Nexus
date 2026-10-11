import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  EmptyState,
  Icon,
  ListRow,
  LoadingState,
  PageHeader,
  Select,
  TextArea,
  TextField,
} from "@nexus/ui";
import {
  LIBRARY_MAX_SUMMARY_LENGTH,
  LIBRARY_MAX_THOUGHT_LENGTH,
  LIBRARY_MAX_TITLE_LENGTH,
  LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH,
  LIBRARY_MAX_COLLECTION_NAME_LENGTH,
  type LibraryKind,
  type LibrarySortKey,
  type LibraryStatus,
} from "@nexus/core";
import { activeLocale, declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { manifest } from "../shared/manifest.js";
import type {
  LibraryCollectionView,
  LibraryItemView,
  LibrarySuggestionView,
  LibraryThoughtView,
  LibraryView,
} from "../shared/ipc.js";
import { copy } from "./copy.js";
import {
  KIND_ICONS,
  KIND_OPTIONS,
  NO_FILTER,
  RATING_OPTIONS,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  blankToNull,
  formatDay,
  formatProgress,
  formatRating,
  latestPassDates,
  localDayKey,
  itemDraftOf,
  moveNeighbours,
  readCount,
  readItemDraft,
  suggestionItemMeta,
  suggestionTitle,
  suggestionCollectionTitle,
  visibleItems,
  type LibraryFilter,
  type LibraryItemDraft,
} from "./library.js";
import "./library.css";

/**
 * BIBLIOTEKA (ADR-090): the books, films and series a person reads and watches.
 *
 * **Three sections and the work's own panel.** „Brzi unos" is how a title
 * arrives (a name and a kind, which is all the brief asks before it exists),
 * „Na polici" is the shelf with its search, filters and order, and „Zbirke" is
 * the user's own lists beside the ones the installed packs suggest. One work's
 * turns open INSIDE the shelf section, under the row that opened them, because a
 * work's story - its passes, its thoughts, the collections it is in - is longer
 * than a row and shorter than a page.
 *
 * **Nothing heavy runs here.** The page filters and sorts the works it was
 * handed: a few hundred rows, one collator, no engine. There is therefore no
 * worker and no progress bar - a module that grew one to sort two hundred titles
 * would be paying for a thread to hide a millisecond.
 *
 * **Everything the page draws it was told by main.** The view is one value, every
 * mutation answers it again, and there is no local copy of a row anywhere: a
 * draft is a draft until Save, and Save renders what main says (Tajmeri's rule,
 * one module over). The one exception is the row's own two neighbours on a move,
 * which is page arithmetic over an order main just sent.
 *
 * **Dates, numbers and units are `Intl`'s**, through the renderer's own
 * factories (`intl.ts`), and the locale is read at render time rather than
 * captured - so a language switch rewrites this page with the rest of the app.
 */

type LibraryApi = typeof window.nexus.modules.library;
/** One write, then the fresh view main answered with. A rejected promise is the section's own error line. */
type Run = (action: (library: LibraryApi) => Promise<LibraryView>) => Promise<boolean>;

export default function LibraryPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<LibraryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER);
  const [sort, setSort] = useState<LibrarySortKey>("activity");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The soft delete that is still undoable: the store keeps the rows, and this is the page offering them back. */
  const [undo, setUndo] = useState<{ readonly kind: "item" | "collection"; readonly id: string } | null>(
    null,
  );
  const locale = activeLocale();

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.library.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      // No toast and no dialog: a page that cannot read says so in its own body
      // and keeps saying so until a read works.
      console.error("Nexus: the library could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback<Run>(async (action) => {
    try {
      setView(await action(window.nexus.modules.library));
      setProblem(null);
      return true;
    } catch (failure) {
      setProblem(copy.errors.mutate);
      console.error("Nexus: a library change failed:", failure);
      return false;
    }
  }, []);

  /**
   * Escape closes the work whose panel is open, and nothing else here opens: the
   * edit forms are drawn inside the panel, so the panel is what the key has to
   * close. A draft is lost with it, which is the same thing the panel's own
   * „Zatvori" does - and both are one click away from being redone.
   *
   * A `<select>`'s own Escape is the exception, and it is the difference between
   * closing a dropdown and destroying a half-typed form: the OS popup is drawn
   * by the platform, its dismissal belongs to the field, and a panel that shut
   * because somebody backed out of a choice would be the worst kind of surprise.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (event.target instanceof HTMLSelectElement) return;
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const items = view?.items ?? [];
  const shown = useMemo(() => visibleItems(items, filter, sort), [items, filter, sort]);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  const units = { pages: copy.units.pages, episodes: copy.units.episodes };
  /** The four orders, named from the copy table rather than composed from the key: a key is what the store sorts by, and a word is what a person reads. */
  const sortLabel = (key: LibrarySortKey): string =>
    key === "activity"
      ? copy.filters.sortActivity
      : key === "title"
        ? copy.filters.sortTitle
        : key === "year"
          ? copy.filters.sortYear
          : copy.filters.sortRating;

  return (
    <div className="lib nx-measure">
      {/* The page's own name is the word the module DECLARED, read in the
          language being spoken, rather than a second copy of it: the rail, the
          settings gallery and this header then cannot disagree about what the
          module is called (ADR-090's copy split). */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="book"
      />

      {undo !== null && (
        <div className="lib__undo" role="status">
          <span className="lib__undo-text">
            {undo.kind === "item" ? copy.undo.item : copy.undo.collection}
          </span>
          <Button
            size="sm"
            onClick={() => {
              const pending = undo;
              setUndo(null);
              void run((library) =>
                pending.kind === "item"
                  ? library.restoreItem({ profileId, id: pending.id })
                  : library.restoreCollection({ profileId, id: pending.id }),
              );
            }}
          >
            {copy.undo.action}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            aria-label={copy.undo.dismiss}
            onClick={() => setUndo(null)}
          >
            <Icon name="close" size={14} />
          </Button>
        </div>
      )}

      {error !== null && (
        <p className="lib__error" role="alert">
          {error}
        </p>
      )}

      {view === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={6} />
      ) : (
        <>
          <section className="lib__section" aria-label={copy.add.heading}>
            <div className="lib__heading">{copy.add.heading}</div>
            <QuickAdd profileId={profileId} run={run} />
            <div className="lib__filters">
              <TextField
                className="lib__search"
                label={copy.filters.searchLabel}
                placeholder={copy.filters.searchPlaceholder}
                value={filter.query}
                onChange={(event) => setFilter({ ...filter, query: event.target.value })}
              />
              <Select
                label={copy.filters.kindLabel}
                value={filter.kind}
                onChange={(event) =>
                  setFilter({ ...filter, kind: event.target.value as LibraryKind | "all" })
                }
              >
                <option value="all">{copy.filters.kindAny}</option>
                {KIND_OPTIONS.map((kind) => (
                  <option key={kind} value={kind}>
                    {copy.kinds[kind]}
                  </option>
                ))}
              </Select>
              <Select
                label={copy.filters.statusLabel}
                value={filter.status}
                onChange={(event) =>
                  setFilter({ ...filter, status: event.target.value as LibraryStatus | "all" })
                }
              >
                <option value="all">{copy.filters.statusAny}</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {copy.statuses[status]}
                  </option>
                ))}
              </Select>
              <Select
                label={copy.filters.sortLabel}
                value={sort}
                onChange={(event) => setSort(event.target.value as LibrarySortKey)}
              >
                {SORT_OPTIONS.map((key) => (
                  <option key={key} value={key}>
                    {sortLabel(key)}
                  </option>
                ))}
              </Select>
            </div>
            <p className="nx-hint">{copy.add.hint}</p>
          </section>

          <section className="lib__section" aria-label={copy.list.heading} data-nx-content>
            <div className="lib__heading">
              <span>{copy.list.heading}</span>
              <span className="lib__count">
                {shown.length} / {items.length} {copy.list.totalLabel}
              </span>
            </div>
            {items.length === 0 ? (
              // The page's invitation, with its first action already on screen
              // above it: the quick-add form IS the action, and a second
              // "Dodaj naslov" button here would be two primaries saying one
              // word (Ucenje's own arrangement, one module over). The
              // description is what the page is for.
              <EmptyState
                variant="inline"
                title={copy.list.emptyTitle}
                description={copy.list.emptyBody}
              />
            ) : shown.length === 0 ? (
              <EmptyState
                variant="inline"
                title={copy.list.noneTitle}
                description={copy.list.noneBody}
              />
            ) : (
              <div className="lib__list">
                {shown.map((item) => (
                  <ListRow
                    key={item.id}
                    leading={<Icon name={KIND_ICONS[item.kind]} />}
                    onClick={() => setSelectedId(item.id)}
                    className={item.id === selectedId ? "lib__row--open" : undefined}
                    trailing={
                      <span className="lib__row-trailing">
                        <Chip>{copy.statuses[item.status]}</Chip>
                        <Rating rating={item.rating} locale={locale} />
                      </span>
                    }
                  >
                    {/* A row is not a control, so the affordance is a real button
                        whose click bubbles to the row (`ListRow`'s own rule) -
                        and the key is what makes the panel keyboard-reachable. */}
                    <button
                      type="button"
                      className="lib__row-title"
                      aria-expanded={item.id === selectedId}
                      onClick={() => setSelectedId(item.id)}
                    >
                      {item.title}
                    </button>
                    <span className="lib__row-meta">{itemMeta(item, locale, units)}</span>
                  </ListRow>
                ))}
              </div>
            )}

            {selected !== null && (
              <ItemPanel
                key={selected.id}
                profileId={profileId}
                item={selected}
                collections={view.collections}
                locale={locale}
                run={run}
                onClose={() => setSelectedId(null)}
                onDeleted={() => {
                  setSelectedId(null);
                  setUndo({ kind: "item", id: selected.id });
                }}
              />
            )}
          </section>

          <CollectionsSection
            profileId={profileId}
            collections={view.collections}
            suggestions={view.suggestions}
            items={items}
            locale={locale}
            run={run}
            onDeleted={(id) => setUndo({ kind: "collection", id })}
          />
        </>
      )}

      {problem !== null && (
        <p className="lib__error" role="status">
          {problem}
        </p>
      )}
    </div>
  );
}

/** One work's one-line meta: its year, its creators, and the dates of the pass that is latest. */
function itemMeta(
  item: LibraryItemView,
  locale: ReturnType<typeof activeLocale>,
  units: { readonly pages: string; readonly episodes: string },
): string {
  const parts: string[] = [];
  if (item.year !== null) parts.push(String(item.year));
  if (item.creators.length > 0) parts.push(item.creators.join(", "));
  const progress = formatProgress(item, locale, units);
  if (progress !== null) parts.push(progress);
  const { startedOn, finishedOn } = latestPassDates(item);
  const finished = formatDay(finishedOn, locale);
  const started = formatDay(startedOn, locale);
  if (finished !== null) parts.push(`${copy.list.finishedOn} ${finished}`);
  else if (started !== null) parts.push(`${copy.list.startedOn} ${started}`);
  if (item.tags.length > 0) parts.push(item.tags.map((tag) => `#${tag}`).join(" "));
  return parts.join(" · ");
}

/** A rating, or nothing at all: a work nobody has rated draws no figure rather than a zero. */
function Rating({ rating, locale }: { rating: number | null; locale: ReturnType<typeof activeLocale> }) {
  const text = formatRating(rating, locale);
  return text === null ? null : (
    <span className="lib__rating">
      <Icon name="star" size={14} />
      {text}
    </span>
  );
}

// --- Brzi unos ---------------------------------------------------------------

/** The quick add: a name and a kind, which is the whole of what the brief asks before a work exists. */
function QuickAdd({ profileId, run }: { profileId: string; run: Run }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<LibraryKind>("book");
  const [problem, setProblem] = useState(false);

  return (
    <form
      className="lib__add"
      onSubmit={(event) => {
        event.preventDefault();
        const name = title.trim();
        if (name.length === 0) {
          setProblem(true);
          return;
        }
        setProblem(false);
        setTitle("");
        void run((library) => library.addItem({ profileId, kind, title: name }));
      }}
    >
      <TextField
        className="lib__add-title"
        label={copy.add.titleLabel}
        placeholder={copy.add.titlePlaceholder}
        maxLength={LIBRARY_MAX_TITLE_LENGTH}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Select
        label={copy.add.kindLabel}
        value={kind}
        onChange={(event) => setKind(event.target.value as LibraryKind)}
      >
        {KIND_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {copy.kinds[option]}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="primary">
        {copy.add.submit}
      </Button>
      {problem && <p className="lib__field-error">{copy.errors.title}</p>}
    </form>
  );
}

// --- Jedan naslov -------------------------------------------------------------

/**
 * One work's panel: the facts, the form that edits them, its passes, its
 * thoughts and the collections it is in.
 *
 * `key={item.id}` at the call site is what resets every draft when another row
 * is opened - a panel that kept the previous work's half-typed title would be
 * the worst kind of surprise.
 */
function ItemPanel({
  profileId,
  item,
  collections,
  locale,
  run,
  onClose,
  onDeleted,
}: {
  profileId: string;
  item: LibraryItemView;
  collections: readonly LibraryCollectionView[];
  locale: ReturnType<typeof activeLocale>;
  run: Run;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState<LibraryItemDraft>(() => itemDraftOf(item));
  const [problem, setProblem] = useState<string | null>(null);

  /** One draft field at a time, spelled out rather than indexed by a computed key: the compiler checks each assignment this way, and a `[key]: value` spread would not be. */
  const update = (patch: Partial<LibraryItemDraft>): void =>
    setDraft((current) => ({ ...current, ...patch }));

  return (
    <Card className="lib__panel" title={copy.detail.heading}>
      <div className="lib__panel-head">
        <span className="lib__panel-title">{item.title}</span>
        <span className="lib__row-trailing">
          <Chip>{copy.kinds[item.kind]}</Chip>
          <Chip>{copy.statuses[item.status]}</Chip>
          <Rating rating={item.rating} locale={locale} />
          <Button size="sm" variant="quiet" onClick={onClose}>
            {copy.detail.close}
          </Button>
        </span>
      </div>
      <span className="nx-hint">{itemMeta(item, locale, { pages: copy.units.pages, episodes: copy.units.episodes })}</span>

      <form
        className="lib__form"
        onSubmit={(event) => {
          event.preventDefault();
          const reading = readItemDraft(draft);
          if (!reading.ok) {
            setProblem(copy.errors.number);
            return;
          }
          setProblem(null);
          void run((library) =>
            library.updateItem({ profileId, id: item.id, ...reading.fields }),
          );
        }}
      >
        <div className="lib__form-title">{copy.detail.editHeading}</div>
        <TextField
          label={copy.detail.titleLabel}
          maxLength={LIBRARY_MAX_TITLE_LENGTH}
          value={draft.title}
          onChange={(event) => update({ title: event.target.value })}
        />
        <TextField
          label={copy.detail.originalTitleLabel}
          maxLength={LIBRARY_MAX_TITLE_LENGTH}
          value={draft.originalTitle}
          onChange={(event) => update({ originalTitle: event.target.value })}
        />
        <TextField
          label={copy.detail.creatorsLabel}
          value={draft.creators}
          onChange={(event) => update({ creators: event.target.value })}
        />
        <span className="nx-hint">{copy.detail.creatorsHint}</span>
        <div className="lib__form-row">
          <TextField
            label={copy.detail.yearLabel}
            inputMode="numeric"
            value={draft.year}
            onChange={(event) => update({ year: event.target.value })}
          />
          <Select
            label={copy.detail.statusLabel}
            value={draft.status}
            onChange={(event) => update({ status: event.target.value as LibraryStatus })}
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {copy.statuses[status]}
              </option>
            ))}
          </Select>
          <Select
            label={copy.detail.ratingLabel}
            value={draft.rating}
            onChange={(event) => update({ rating: event.target.value })}
          >
            <option value="">{copy.detail.ratingNone}</option>
            {RATING_OPTIONS.map((rating) => (
              <option key={rating} value={String(rating)}>
                {String(rating)}
              </option>
            ))}
          </Select>
        </div>

        {/* Only the fields this kind HAS: a film has no progress columns at all
            (`validateLibraryProgress`), and a form that offered them would be
            asking for a refusal it then had to explain. */}
        {item.kind === "book" && (
          <div className="lib__form-row">
            <TextField
              label={copy.detail.pagesReadLabel}
              inputMode="numeric"
              value={draft.pagesRead}
              onChange={(event) => update({ pagesRead: event.target.value })}
            />
            <TextField
              label={copy.detail.pagesTotalLabel}
              inputMode="numeric"
              value={draft.pagesTotal}
              onChange={(event) => update({ pagesTotal: event.target.value })}
            />
          </div>
        )}
        {item.kind === "series" && (
          <div className="lib__form-row">
            <TextField
              label={copy.detail.seasonLabel}
              inputMode="numeric"
              value={draft.season}
              onChange={(event) => update({ season: event.target.value })}
            />
            <TextField
              label={copy.detail.episodeLabel}
              inputMode="numeric"
              value={draft.episode}
              onChange={(event) => update({ episode: event.target.value })}
            />
            <TextField
              label={copy.detail.seasonsTotalLabel}
              inputMode="numeric"
              value={draft.seasonsTotal}
              onChange={(event) => update({ seasonsTotal: event.target.value })}
            />
            <TextField
              label={copy.detail.episodesTotalLabel}
              inputMode="numeric"
              value={draft.episodesTotal}
              onChange={(event) => update({ episodesTotal: event.target.value })}
            />
          </div>
        )}

        <TextField
          label={copy.detail.tagsLabel}
          value={draft.tags}
          onChange={(event) => update({ tags: event.target.value })}
        />
        <span className="nx-hint">{copy.detail.tagsHint}</span>
        <TextArea
          label={copy.detail.summaryLabel}
          value={draft.summary}
          maxLength={LIBRARY_MAX_SUMMARY_LENGTH}
          onChange={(event) => update({ summary: event.target.value })}
        />
        {problem !== null && (
          <p className="lib__field-error" role="alert">
            {problem}
          </p>
        )}
        <div className="lib__actions">
          <Button type="submit" size="sm" variant="primary">
            {copy.detail.save}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="quiet"
            onClick={() => {
              setDraft(itemDraftOf(item));
              setProblem(null);
            }}
          >
            {copy.detail.reset}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="quiet"
            onClick={() => {
              void run((library) => library.removeItem({ profileId, id: item.id })).then(
                (saved) => {
                  if (saved) onDeleted();
                },
              );
            }}
          >
            {copy.detail.delete}
          </Button>
        </div>
      </form>

      <PassesSection profileId={profileId} item={item} locale={locale} run={run} />
      <ThoughtsSection profileId={profileId} item={item} locale={locale} run={run} />

      <div className="lib__form-title">{copy.collections.heading}</div>
      <p className="nx-hint">{copy.collections.caption}</p>
      {collections.length === 0 ? (
        <p className="nx-hint">{copy.collections.empty}</p>
      ) : (
        <div className="lib__membership">
          {collections.map((collection) => (
            <Checkbox
              key={collection.id}
              checked={collection.itemIds.includes(item.id)}
              onChange={(event) =>
                void run((library) =>
                  event.target.checked
                    ? library.addToCollection({ profileId, collectionId: collection.id, itemId: item.id })
                    : library.removeFromCollection({
                        profileId,
                        collectionId: collection.id,
                        itemId: item.id,
                      }),
                )
              }
            >
              {collection.name}
            </Checkbox>
          ))}
        </div>
      )}
    </Card>
  );
}

// --- Čitanja i gledanja --------------------------------------------------------

/** One pass, and the form that records the next one. Recording a later reading is what this list is FOR: the latest pass decides the work's status. */
function PassesSection({
  profileId,
  item,
  locale,
  run,
}: {
  profileId: string;
  item: LibraryItemView;
  locale: ReturnType<typeof activeLocale>;
  run: Run;
}) {
  const [startedOn, setStartedOn] = useState("");
  const [finishedOn, setFinishedOn] = useState("");
  const [rating, setRating] = useState("");
  const [problem, setProblem] = useState(false);

  return (
    <div className="lib__subsection">
      <div className="lib__form-title">{copy.passes.heading}</div>
      <p className="nx-hint">{copy.passes.caption}</p>
      {item.passes.length === 0 ? (
        <p className="nx-hint">{copy.passes.empty}</p>
      ) : (
        <div className="lib__list">
          {[...item.passes].reverse().map((pass) => (
            <ListRow
              key={pass.id}
              leading={<span className="lib__pass-seq">{pass.seq}</span>}
              trailing={
                <span className="lib__row-trailing">
                  <Rating rating={pass.rating} locale={locale} />
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={copy.passes.remove}
                    onClick={() =>
                      void run((library) =>
                        library.removePass({ profileId, itemId: item.id, id: pass.id }),
                      )
                    }
                  >
                    <Icon name="trash" size={14} />
                  </Button>
                </span>
              }
            >
              <span className="lib__pass-dates">
                {[
                  pass.startedOn === null
                    ? null
                    : `${copy.passes.startedLabel} ${formatDay(pass.startedOn, locale) ?? pass.startedOn}`,
                  pass.finishedOn === null
                    ? null
                    : `${copy.passes.finishedLabel} ${formatDay(pass.finishedOn, locale) ?? pass.finishedOn}`,
                ]
                  .filter((part): part is string => part !== null)
                  .join(" · ") || copy.passes.empty}
              </span>
            </ListRow>
          ))}
        </div>
      )}

      <div className="lib__form-row">
        <TextField
          type="date"
          label={copy.passes.startedLabel}
          value={startedOn}
          onChange={(event) => setStartedOn(event.target.value)}
        />
        <TextField
          type="date"
          label={copy.passes.finishedLabel}
          value={finishedOn}
          onChange={(event) => setFinishedOn(event.target.value)}
        />
        <Select
          label={copy.passes.ratingLabel}
          value={rating}
          onChange={(event) => setRating(event.target.value)}
        >
          <option value="">{copy.detail.ratingNone}</option>
          {RATING_OPTIONS.map((option) => (
            <option key={option} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          onClick={() => {
            const readRating = readCount(rating, 1, 10);
            if (!readRating.ok) {
              setProblem(true);
              return;
            }
            setProblem(false);
            setStartedOn("");
            setFinishedOn("");
            setRating("");
            void run((library) =>
              library.addPass({
                profileId,
                itemId: item.id,
                startedOn: blankToNull(startedOn),
                finishedOn: blankToNull(finishedOn),
                rating: readRating.value,
              }),
            );
          }}
        >
          {copy.passes.add}
        </Button>
      </div>
      {problem && <p className="lib__field-error">{copy.errors.number}</p>}
    </div>
  );
}

// --- Utisci -------------------------------------------------------------------

/** The dated journal: thoughts kept with the work, in the order written. One row at a time is edited, because a second form per row would double the page. */
function ThoughtsSection({
  profileId,
  item,
  locale,
  run,
}: {
  profileId: string;
  item: LibraryItemView;
  locale: ReturnType<typeof activeLocale>;
  run: Run;
}) {
  const [date, setDate] = useState(() => localDayKey(new Date()));
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<LibraryThoughtView | null>(null);
  const [problem, setProblem] = useState(false);

  function save(): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setProblem(true);
      return;
    }
    setProblem(false);
    const writing = editing;
    setText("");
    setEditing(null);
    setDate(localDayKey(new Date()));
    void run((library) =>
      writing === null
        ? library.addThought({ profileId, itemId: item.id, date, text: trimmed })
        : library.updateThought({
            profileId,
            itemId: item.id,
            id: writing.id,
            date,
            text: trimmed,
          }),
    );
  }

  return (
    <div className="lib__subsection">
      <div className="lib__form-title">{copy.thoughts.heading}</div>
      <p className="nx-hint">{copy.thoughts.caption}</p>
      {item.thoughts.length === 0 ? (
        <p className="nx-hint">{copy.thoughts.empty}</p>
      ) : (
        <div className="lib__list">
          {[...item.thoughts].reverse().map((thought) => (
            <ListRow
              key={thought.id}
              leading={<span className="lib__thought-date">{formatDay(thought.entryDate, locale)}</span>}
              trailing={
                <span className="lib__row-trailing">
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={copy.thoughts.edit}
                    onClick={() => {
                      setEditing(thought);
                      setDate(thought.entryDate);
                      setText(thought.text);
                    }}
                  >
                    <Icon name="pencil" size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={copy.thoughts.remove}
                    onClick={() =>
                      void run((library) =>
                        library.removeThought({ profileId, itemId: item.id, id: thought.id }),
                      )
                    }
                  >
                    <Icon name="trash" size={14} />
                  </Button>
                </span>
              }
            >
              <span className="lib__thought-text">{thought.text}</span>
            </ListRow>
          ))}
        </div>
      )}

      <div className="lib__form-row">
        <TextField
          type="date"
          label={copy.thoughts.dateLabel}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </div>
      <TextArea
        label={copy.thoughts.textLabel}
        placeholder={copy.thoughts.textPlaceholder}
        value={text}
        maxLength={LIBRARY_MAX_THOUGHT_LENGTH}
        onChange={(event) => setText(event.target.value)}
      />
      {problem && <p className="lib__field-error">{copy.errors.thought}</p>}
      <div className="lib__actions">
        <Button size="sm" variant="primary" onClick={save}>
          {editing === null ? copy.thoughts.add : copy.thoughts.save}
        </Button>
        {editing !== null && (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              setEditing(null);
              setText("");
              setDate(localDayKey(new Date()));
              setProblem(false);
            }}
          >
            {copy.thoughts.cancel}
          </Button>
        )}
      </div>
    </div>
  );
}

// --- Zbirke -------------------------------------------------------------------

/**
 * The user's collections and the packs' suggestions.
 *
 * A collection's titles are shown one row at a time with two move buttons rather
 * than dragged: a drag is a pointer gesture this page cannot offer to a keyboard
 * without inventing a second mechanism for the same order, and `moveUp`/
 * `moveDown` are two buttons the store's own `moveCollectionItem` already takes
 * neighbours for.
 */
function CollectionsSection({
  profileId,
  collections,
  suggestions,
  items,
  locale,
  run,
  onDeleted,
}: {
  profileId: string;
  collections: readonly LibraryCollectionView[];
  suggestions: readonly LibrarySuggestionView[];
  items: readonly LibraryItemView[];
  locale: ReturnType<typeof activeLocale>;
  run: Run;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [openSuggestion, setOpenSuggestion] = useState<string | null>(null);
  const [suggestionProblem, setSuggestionProblem] = useState<string | null>(null);

  const titleOf = (id: string): string => items.find((item) => item.id === id)?.title ?? "";

  return (
    <section className="lib__section" aria-label={copy.collections.heading}>
      <div className="lib__heading">{copy.collections.heading}</div>
      <p className="nx-hint">{copy.collections.caption}</p>

      <form
        className="lib__form-row"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (trimmed.length === 0) {
            setProblem(true);
            return;
          }
          setProblem(false);
          setName("");
          setDescription("");
          void run((library) =>
            library.createCollection({
              profileId,
              name: trimmed,
              description: blankToNull(description),
            }),
          );
        }}
      >
        <TextField
          label={copy.collections.nameLabel}
          placeholder={copy.collections.namePlaceholder}
          maxLength={LIBRARY_MAX_COLLECTION_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label={copy.collections.descriptionLabel}
          maxLength={LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Button type="submit" variant="primary">
          {copy.collections.create}
        </Button>
      </form>
      {problem && <p className="lib__field-error">{copy.errors.collectionName}</p>}

      {collections.length === 0 ? (
        <p className="nx-hint">{copy.collections.empty}</p>
      ) : (
        <div className="lib__list">
          {collections.map((collection) => {
            const open = openId === collection.id;
            return (
              <div key={collection.id} className="lib__collection">
                <ListRow
                  leading={<Icon name="list" />}
                  trailing={
                    <span className="lib__row-trailing">
                      <span className="lib__count">
                        {collection.progress.done} / {collection.progress.total}
                      </span>
                      <Button size="sm" onClick={() => setOpenId(open ? null : collection.id)}>
                        {open ? copy.collections.close : copy.collections.open}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setRenaming(collection.id);
                          setDraftName(collection.name);
                          setDraftDescription(collection.description ?? "");
                        }}
                      >
                        {copy.collections.rename}
                      </Button>
                      <Button
                        size="sm"
                        variant="quiet"
                        aria-label={copy.collections.remove}
                        onClick={() => {
                          setOpenId(null);
                          void run((library) =>
                            library.removeCollection({ profileId, id: collection.id }),
                          ).then((saved) => {
                            if (saved) onDeleted(collection.id);
                          });
                        }}
                      >
                        <Icon name="trash" size={14} />
                      </Button>
                    </span>
                  }
                >
                  <span className="lib__row-title">{collection.name}</span>
                  {collection.description !== null && (
                    <span className="lib__row-meta">{collection.description}</span>
                  )}
                </ListRow>

                {renaming === collection.id && (
                  <div className="lib__form-row">
                    <TextField
                      label={copy.collections.nameLabel}
                      maxLength={LIBRARY_MAX_COLLECTION_NAME_LENGTH}
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                    />
                    <TextField
                      label={copy.collections.descriptionLabel}
                      maxLength={LIBRARY_MAX_COLLECTION_DESCRIPTION_LENGTH}
                      value={draftDescription}
                      onChange={(event) => setDraftDescription(event.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        const trimmed = draftName.trim();
                        if (trimmed.length === 0) {
                          setProblem(true);
                          return;
                        }
                        setProblem(false);
                        setRenaming(null);
                        void run((library) =>
                          library.updateCollection({
                            profileId,
                            id: collection.id,
                            name: trimmed,
                            description: blankToNull(draftDescription),
                          }),
                        );
                      }}
                    >
                      {copy.collections.save}
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => setRenaming(null)}>
                      {copy.collections.cancel}
                    </Button>
                  </div>
                )}

                {open && (
                  <div className="lib__list lib__collection-items">
                    {collection.itemIds.map((itemId, index) => (
                      <ListRow
                        key={itemId}
                        leading={<span className="lib__pass-seq">{index + 1}</span>}
                        trailing={
                          <span className="lib__row-trailing">
                            <Button
                              size="sm"
                              variant="quiet"
                              aria-label={copy.collections.moveUp}
                              disabled={index === 0}
                              onClick={() => {
                                const neighbours = moveNeighbours(collection.itemIds, itemId, -1);
                                if (neighbours === null) return;
                                void run((library) =>
                                  library.moveCollectionItem({
                                    profileId,
                                    collectionId: collection.id,
                                    itemId,
                                    ...neighbours,
                                  }),
                                );
                              }}
                            >
                              <Icon name="arrowUp" size={14} />
                            </Button>
                            <Button
                              size="sm"
                              variant="quiet"
                              aria-label={copy.collections.moveDown}
                              disabled={index === collection.itemIds.length - 1}
                              onClick={() => {
                                const neighbours = moveNeighbours(collection.itemIds, itemId, 1);
                                if (neighbours === null) return;
                                void run((library) =>
                                  library.moveCollectionItem({
                                    profileId,
                                    collectionId: collection.id,
                                    itemId,
                                    ...neighbours,
                                  }),
                                );
                              }}
                            >
                              <Icon name="arrowDown" size={14} />
                            </Button>
                            <Button
                              size="sm"
                              variant="quiet"
                              aria-label={copy.collections.removeItem}
                              onClick={() =>
                                void run((library) =>
                                  library.removeFromCollection({
                                    profileId,
                                    collectionId: collection.id,
                                    itemId,
                                  }),
                                )
                              }
                            >
                              <Icon name="close" size={14} />
                            </Button>
                          </span>
                        }
                      >
                        <span className="lib__row-title">{titleOf(itemId) || copy.collections.itemMissing}</span>
                      </ListRow>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="lib__form-title">{copy.suggestions.heading}</div>
      <p className="nx-hint">{copy.suggestions.caption}</p>
      {suggestions.length === 0 ? (
        <p className="nx-hint">{copy.suggestions.empty}</p>
      ) : (
        <div className="lib__list">
          {suggestions.map((suggestion) => {
            const key = `${suggestion.packId}:${suggestion.collectionId}`;
            const open = openSuggestion === key;
            return (
              <div key={key} className="lib__suggestion">
                <Card className="lib__suggestion-card">
                  <div className="lib__panel-head">
                    <span className="lib__row-title">
                      {suggestionCollectionTitle(suggestion.title, locale)}
                    </span>
                    <span className="lib__row-trailing">
                      {suggestion.small && <Chip>{copy.suggestions.small}</Chip>}
                      <Chip>
                        {suggestion.items.length} {copy.suggestions.itemsLabel}
                      </Chip>
                    </span>
                  </div>
                  <span className="nx-hint">
                    {copy.suggestions.sourceLabel}: {suggestion.source} · {copy.suggestions.licenceLabel}:{" "}
                    {suggestion.licence}
                  </span>
                  {suggestion.description !== null && (
                    <p className="nx-hint">
                      {suggestionCollectionTitle(suggestion.description, locale)}
                    </p>
                  )}
                  <div className="lib__actions">
                    <Button size="sm" onClick={() => setOpenSuggestion(open ? null : key)}>
                      {open ? copy.suggestions.hide : copy.suggestions.view}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={suggestion.adopted}
                      onClick={() => {
                        setSuggestionProblem(null);
                        void run((library) =>
                          library.adoptSuggestion({
                            profileId,
                            packId: suggestion.packId,
                            packVersion: suggestion.packVersion,
                            collectionId: suggestion.collectionId,
                          }),
                        ).then((saved) => {
                          if (!saved) setSuggestionProblem(copy.errors.suggestion);
                        });
                      }}
                    >
                      {suggestion.adopted ? copy.suggestions.adopted : copy.suggestions.adopt}
                    </Button>
                  </div>
                  {open && (
                    <div className="lib__list">
                      {suggestion.items.map((entry, index) => (
                        <ListRow key={index} leading={<Icon name={KIND_ICONS[entry.kind]} />}>
                          <span className="lib__row-title">{suggestionTitle(entry.title, locale)}</span>
                          <span className="lib__row-meta">
                            {suggestionItemMeta(entry, locale, copy.suggestions.yearUnknown)}
                          </span>
                        </ListRow>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            );
          })}
        </div>
      )}
      {suggestionProblem !== null && (
        <p className="lib__field-error" role="alert">
          {suggestionProblem}
        </p>
      )}
    </section>
  );
}

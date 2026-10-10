import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  MUSIC_LOG_KINDS,
  VISIT_KINDS,
  formatCultureDuration,
  type MusicLogKind,
  type VisitKind,
} from "@nexus/core";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { collator, dateTimeFormat } from "../../../renderer/src/intl.js";
import { manifest } from "../shared/manifest.js";
import type {
  CultureArtWorkView,
  CultureEntryView,
  CulturePlanView,
  CulturePlaylistView,
  CultureTrackView,
  CultureVenueView,
  CultureView,
  CultureVisitView,
} from "../shared/ipc.js";
import { copy } from "./copy.js";
import {
  EMPTY_ART_FILTER,
  EMPTY_VISIT_FILTER,
  artCenturyOf,
  bareDayOf,
  cellDay,
  distinctValues,
  filterArtWorks,
  filterVisits,
  monthGrid,
  parsePrice,
  parseRating,
  pastPlans,
  plansAwaitingAnswer,
  queueOrder,
  stepQueue,
  upcomingPlans,
  visitsPerDay,
  visitsPerVenue,
  yearOf,
  type ArtFilter,
  type VisitFilter,
} from "./view.js";
import "./culture.css";

/**
 * KULTURA (ADR-090) - the culture corner's page.
 *
 * **Five sections, one per thing the module is about**, because that is what
 * the module is: what you went to see (Posete), the places those visits gather
 * under (Mesta), what is still ahead (Program), the arts guide a dataset pack
 * brings (Vodic) and music (Muzika). The tabs are ordinary buttons in a group
 * with `aria-pressed`, which is the app's own segmented control - the announced
 * state and the painted one are the same attribute.
 *
 * **Every write answers with the whole view** (`shared/ipc.ts` says why), so
 * this page has exactly one way to learn anything: what main just said. Nothing
 * here applies a local guess on top of a write.
 *
 * **Heavy work is main's.** Tag reading, sniffing and blob handling all happen
 * in main; the only thing this page does with bytes is hand the picked file
 * over and, for playback, wrap what comes back in a `Blob`. There is no engine
 * here to move to a worker, and the two long lists (a library, a gallery) are
 * drawn in a window so the DOM stays small.
 */

/** How many rows of a long list are drawn at once; „Prikaži još" adds that many. */
const PAGE_SIZE = 60;

/** The arts guide's whole payload (`shared/ipc.ts` says why it names nothing). */
const EMPTY_REQUEST: Record<string, never> = {};

type CultureApi = typeof window.nexus.modules.culture;
type Run = (action: (culture: CultureApi) => Promise<CultureView>) => Promise<void>;

export default function CulturePage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<CultureView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"visits" | "venues" | "programme" | "art" | "music">("visits");

  const run = useCallback(
    async (action: (culture: CultureApi) => Promise<CultureView>) => {
      try {
        setView(await action(window.nexus.modules.culture));
        setError(null);
      } catch (failure) {
        setError(copy.errors.save);
        console.error("Nexus: a culture change failed:", failure);
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.culture.list({ profileId }));
      setError(null);
    } catch (failure) {
      // No toast, no dialog: a page that cannot read says so in its own body.
      setError(copy.errors.load);
      console.error("Nexus: the culture corner could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const today = bareDayOf(new Date());

  return (
    <div className="culture">
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="museum"
      />
      {error !== null && (
        <p className="culture__error" role="alert">
          {error}
        </p>
      )}
      {view === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={4} />
      ) : (
        <>
          <div className="culture__tabs" role="group" aria-label={copy.page.tabsLabel}>
            {(
              [
                ["visits", copy.tabs.visits],
                ["venues", copy.tabs.venues],
                ["programme", copy.tabs.programme],
                ["art", copy.tabs.art],
                ["music", copy.tabs.music],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                size="sm"
                variant={tab === id ? "primary" : "ghost"}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </Button>
            ))}
          </div>
          {tab === "visits" && (
            <VisitsSection profileId={profileId} view={view} run={run} today={today} />
          )}
          {tab === "venues" && (
            <VenuesSection
              profileId={profileId}
              venues={view.venues}
              visits={view.visits}
              run={run}
            />
          )}
          {tab === "programme" && (
            <ProgrammeSection
              profileId={profileId}
              view={view}
              run={run}
              today={today}
            />
          )}
          {tab === "art" && <ArtSection />}
          {tab === "music" && <MusicSection profileId={profileId} view={view} run={run} />}
        </>
      )}
    </div>
  );
}

// --- the day, as a person reads it ------------------------------------------

/** A bare day as the active locale writes it (`1. jun 2026.`), through the shell's one door to `Intl`. */
function formatDay(day: string): string {
  return dateTimeFormat({ day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${day}T00:00:00`),
  );
}

/** A rating as a chip's text: „8/10", or the page's own word for "not rated". */
function ratingText(rating: number | null): string {
  if (rating === null) return copy.visits.noRating;
  return `${String(rating)}/10`;
}

/**
 * Closes something on Escape, for as long as the component that owns it is
 * mounted.
 *
 * A listener on `document` rather than on the form's own element: an inline form
 * is opened by one button and the reader then moves between its fields, so the
 * key must work wherever the focus happens to be - which is exactly how the
 * shell's own dialogs do it. `active` is what keeps a viewer from swallowing
 * the key while it is closed.
 */
function useEscape(onClose: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active, onClose]);
}

// --- visits -----------------------------------------------------------------

function VisitsSection({
  profileId,
  view,
  run,
  today,
}: {
  profileId: string;
  view: CultureView;
  run: Run;
  today: string;
}) {
  const [filter, setFilter] = useState<VisitFilter>(EMPTY_VISIT_FILTER);
  const [shape, setShape] = useState<"list" | "calendar">("list");
  const [year, setYear] = useState(() => yearOf(today) ?? new Date().getFullYear());
  const [editing, setEditing] = useState<CultureVisitView | "new" | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const visits = useMemo(() => filterVisits(view.visits, filter), [view.visits, filter]);
  const perDay = useMemo(() => visitsPerDay(view.visits), [view.visits]);
  const kindNames = copy.kinds;

  return (
    <>
      <Card className="culture__card" title={copy.visits.title}>
        <div className="culture__toolbar">
          <Select
            label={copy.filters.kind}
            value={filter.kind ?? ""}
            onChange={(event) =>
              setFilter({ ...filter, kind: (event.target.value || null) as VisitKind | null })
            }
          >
            <option value="">{copy.filters.anyKind}</option>
            {VISIT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kindNames[kind]}
              </option>
            ))}
          </Select>
          <Select
            label={copy.filters.place}
            value={filter.venueId ?? ""}
            onChange={(event) => setFilter({ ...filter, venueId: event.target.value || null })}
          >
            <option value="">{copy.filters.anyPlace}</option>
            {view.venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.city === null ? venue.name : `${venue.name} - ${venue.city}`}
              </option>
            ))}
          </Select>
          <TextField
            label={copy.filters.query}
            value={filter.query}
            onChange={(event) => setFilter({ ...filter, query: event.target.value })}
          />
          <div className="culture__switch">
            <Button
              size="sm"
              variant={shape === "list" ? "primary" : "ghost"}
              aria-pressed={shape === "list"}
              onClick={() => setShape("list")}
            >
              {copy.visits.asList}
            </Button>
            <Button
              size="sm"
              variant={shape === "calendar" ? "primary" : "ghost"}
              aria-pressed={shape === "calendar"}
              onClick={() => setShape("calendar")}
            >
              {copy.visits.asCalendar}
            </Button>
          </div>
          <div className="culture__actions">
            <Button
              size="sm"
              variant="primary"
              onClick={() => setEditing(editing === "new" ? null : "new")}
            >
              {copy.visits.add}
            </Button>
            {filter !== EMPTY_VISIT_FILTER && (
              <Button size="sm" variant="quiet" onClick={() => setFilter(EMPTY_VISIT_FILTER)}>
                {copy.filters.clear}
              </Button>
            )}
          </div>
        </div>

        {editing !== null && (
          <VisitForm
            profileId={profileId}
            visit={editing === "new" ? null : editing}
            run={run}
            onClose={() => setEditing(null)}
          />
        )}

        {view.visits.length === 0 ? (
          <EmptyState
            variant="inline"
            sigil="museum"
            title={copy.visits.empty}
            description={copy.visits.emptyHint}
          />
        ) : shape === "list" ? (
          <>
            {visits.length === 0 ? (
              <p className="nx-hint">{copy.filters.noResults}</p>
            ) : (
              <div className="culture__list">
                {visits.slice(0, visible).map((visit) => (
                  <VisitRow
                    key={visit.id}
                    profileId={profileId}
                    visit={visit}
                    run={run}
                    onEdit={() => setEditing(visit)}
                  />
                ))}
              </div>
            )}
            {visits.length > visible && (
              <Button size="sm" variant="quiet" onClick={() => setVisible(visible + PAGE_SIZE)}>
                {copy.more}
              </Button>
            )}
          </>
        ) : (
          <YearCalendar
            year={year}
            perDay={perDay}
            months={copy.months}
            onYear={(next) => setYear(next)}
            onDay={(day) => {
              setFilter({ ...EMPTY_VISIT_FILTER, query: day });
              setShape("list");
            }}
          />
        )}
      </Card>
    </>
  );
}

function VisitRow({
  profileId,
  visit,
  run,
  onEdit,
}: {
  profileId: string;
  visit: CultureVisitView;
  run: Run;
  onEdit: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [photoProblem, setPhotoProblem] = useState(false);

  async function attach(files: FileList | null): Promise<void> {
    if (files === null) return;
    setPhotoProblem(false);
    for (const file of Array.from(files)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        await run((culture) =>
          culture.addVisitPhoto({ profileId, id: visit.id, fileName: file.name, bytes }),
        );
      } catch (failure) {
        setPhotoProblem(true);
        console.error("Nexus: the ticket could not be attached:", failure);
      }
    }
    if (fileRef.current !== null) fileRef.current.value = "";
  }

  return (
    <ListRow
      leading={<Icon name="museum" />}
      trailing={
        <span className="culture__row-actions">
          <Chip>{copy.kinds[visit.kind]}</Chip>
          <Chip variant={visit.rating !== null ? "data" : "neutral"}>{ratingText(visit.rating)}</Chip>
          <Button size="sm" onClick={onEdit}>
            {copy.visits.edit}
          </Button>
          {confirming ? (
            <>
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  void run((culture) => culture.removeVisit({ profileId, id: visit.id }))
                }
              >
                {copy.confirm}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>
                {copy.cancel}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="quiet" onClick={() => setConfirming(true)}>
              {copy.visits.remove}
            </Button>
          )}
        </span>
      }
    >
      <span className="culture__row-title">{visit.title}</span>
      <span className="culture__row-meta">
        {formatDay(visit.date)}
        {visit.startTime === null ? "" : ` \u00b7 ${visit.startTime}`}
        {` \u00b7 ${visit.venue}`}
        {visit.city === null ? "" : `, ${visit.city}`}
      </span>
      {visit.companions !== null && (
        <span className="culture__row-meta">{`${copy.visits.withWhom}: ${visit.companions}`}</span>
      )}
      {visit.notes !== "" && <span className="culture__row-notes">{visit.notes}</span>}
      <span className="culture__row-meta culture__photos">
        {visit.photos.length === 0 ? copy.visits.noPhotos : copy.visits.photos}
        {visit.photos.map((photo) => (
          <a
            key={photo.id}
            className="culture__photo-link"
            href={`nx-blob://${photo.sha256}`}
            target="_blank"
            rel="noreferrer"
          >
            {photo.fileName}
          </a>
        ))}
        <Button size="sm" variant="quiet" onClick={() => fileRef.current?.click()}>
          {copy.visits.attach}
        </Button>
        {/* `type="file"` is the one input a surface may draw itself: the OS owns
            the picker, and there is no text field here to get wrong. */}
        <input
          ref={fileRef}
          className="culture__file"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
          aria-label={copy.visits.attach}
          onChange={(event) => void attach(event.target.files)}
        />
      </span>
      {photoProblem && <span className="culture__field-error">{copy.errors.photoType}</span>}
    </ListRow>
  );
}

/** The visit form, in both of its lives: a new visit, and the same form editing one. */
function VisitForm({
  profileId,
  visit,
  run,
  onClose,
}: {
  profileId: string;
  visit: CultureVisitView | null;
  run: Run;
  onClose: () => void;
}) {
  const [fields, setFields] = useState(() => ({
    kind: visit?.kind ?? ("museum" as VisitKind),
    title: visit?.title ?? "",
    venue: visit?.venue ?? "",
    city: visit?.city ?? "",
    date: visit?.date ?? bareDayOf(new Date()),
    startTime: visit?.startTime ?? "",
    rating: visit?.rating === null || visit?.rating === undefined ? "" : String(visit.rating),
    notes: visit?.notes ?? "",
    companions: visit?.companions ?? "",
    price:
      visit?.price === null || visit?.price === undefined
        ? ""
        : String(visit.price.minorUnits / 100),
    currency: visit?.price?.currency ?? "RSD",
  }));
  const [problem, setProblem] = useState<"title" | "venue" | "rating" | "price" | null>(null);
  useEscape(onClose);

  const set = (key: keyof typeof fields, value: string): void =>
    setFields((current) => ({ ...current, [key]: value }));

  function payload() {
    const title = fields.title.trim();
    if (title.length === 0) {
      setProblem("title");
      return null;
    }
    const venue = fields.venue.trim();
    if (venue.length === 0) {
      setProblem("venue");
      return null;
    }
    const rating = parseRating(fields.rating);
    if (fields.rating.trim() !== "" && rating === null) {
      setProblem("rating");
      return null;
    }
    const price = parsePrice(fields.price, fields.currency);
    if ((fields.price.trim() === "") !== (fields.currency.trim() === "")) {
      setProblem("price");
      return null;
    }
    if (fields.price.trim() !== "" && price === null) {
      setProblem("price");
      return null;
    }
    setProblem(null);
    return {
      kind: fields.kind,
      title,
      venue,
      city: fields.city.trim() === "" ? null : fields.city.trim(),
      date: fields.date,
      startTime: fields.startTime.trim() === "" ? null : fields.startTime.trim(),
      rating,
      notes: fields.notes,
      price,
      companions: fields.companions.trim() === "" ? null : fields.companions.trim(),
    };
  }

  return (
    <div className="culture__form">
      <div className="culture__fields">
        <Select
          label={copy.visits.kind}
          value={fields.kind}
          onChange={(event) => set("kind", event.target.value)}
        >
          {VISIT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {copy.kinds[kind]}
            </option>
          ))}
        </Select>
        <TextField
          label={copy.visits.titleLabel}
          value={fields.title}
          maxLength={200}
          onChange={(event) => set("title", event.target.value)}
        />
        <TextField
          label={copy.visits.venueLabel}
          value={fields.venue}
          maxLength={120}
          onChange={(event) => set("venue", event.target.value)}
        />
        <TextField
          label={copy.visits.city}
          value={fields.city}
          maxLength={80}
          onChange={(event) => set("city", event.target.value)}
        />
        <TextField
          label={copy.visits.date}
          type="date"
          value={fields.date}
          onChange={(event) => set("date", event.target.value)}
        />
        <TextField
          label={copy.visits.startTime}
          type="time"
          value={fields.startTime}
          onChange={(event) => set("startTime", event.target.value)}
        />
        <TextField
          label={copy.visits.rating}
          inputMode="numeric"
          value={fields.rating}
          onChange={(event) => set("rating", event.target.value)}
        />
        <TextField
          label={copy.visits.withWhom}
          value={fields.companions}
          maxLength={200}
          onChange={(event) => set("companions", event.target.value)}
        />
        <TextField
          label={copy.visits.price}
          inputMode="decimal"
          value={fields.price}
          onChange={(event) => set("price", event.target.value)}
        />
        <TextField
          label={copy.visits.currency}
          value={fields.currency}
          maxLength={3}
          onChange={(event) => set("currency", event.target.value)}
        />
      </div>
      <TextArea
        label={copy.visits.notes}
        value={fields.notes}
        maxLength={2000}
        onChange={(event) => set("notes", event.target.value)}
      />
      {problem === "title" && <p className="culture__field-error">{copy.errors.title}</p>}
      {problem === "venue" && <p className="culture__field-error">{copy.errors.venue}</p>}
      {problem === "rating" && <p className="culture__field-error">{copy.errors.rating}</p>}
      {problem === "price" && <p className="culture__field-error">{copy.errors.price}</p>}
      <div className="culture__actions">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const value = payload();
            if (value === null) return;
            onClose();
            void run((culture) =>
              visit === null
                ? culture.createVisit({ profileId, ...value })
                : culture.updateVisit({ profileId, id: visit.id, fields: value }),
            );
          }}
        >
          {copy.save}
        </Button>
        <Button size="sm" variant="quiet" onClick={onClose}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  );
}

/** The year, one card per month, Monday-first, with a count on the days that have visits. */
function YearCalendar({
  year,
  perDay,
  months,
  onYear,
  onDay,
}: {
  year: number;
  perDay: ReadonlyMap<string, number>;
  months: readonly string[];
  onYear: (year: number) => void;
  onDay: (day: string) => void;
}) {
  return (
    <div className="culture__year">
      <div className="culture__actions">
        <Button size="sm" variant="quiet" onClick={() => onYear(year - 1)}>
          {copy.visits.previousYear}
        </Button>
        <span className="culture__year-label">{String(year)}</span>
        <Button size="sm" variant="quiet" onClick={() => onYear(year + 1)}>
          {copy.visits.nextYear}
        </Button>
      </div>
      <div className="culture__months">
        {months.map((name, index) => {
          const month = index + 1;
          return (
            <div key={name} className="culture__month">
              <p className="nx-eyebrow">{name}</p>
              <div className="culture__days">
                {monthGrid(year, month).map((cell, cellIndex) => {
                  const day = cellDay(year, month, cell);
                  const count = day === null ? 0 : (perDay.get(day) ?? 0);
                  return (
                    <span key={cellIndex} className="culture__day-slot">
                      {cell === null ? null : count === 0 ? (
                        <span className="culture__day">{String(cell)}</span>
                      ) : (
                        <button
                          type="button"
                          className="culture__day culture__day--visited"
                          onClick={() => day !== null && onDay(day)}
                          title={`${formatDay(day ?? "")} - ${String(count)}`}
                        >
                          {String(cell)}
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- venues -----------------------------------------------------------------

function VenuesSection({
  profileId,
  venues,
  visits,
  run,
}: {
  profileId: string;
  venues: readonly CultureVenueView[];
  visits: readonly CultureVisitView[];
  run: Run;
}) {
  const counts = useMemo(() => visitsPerVenue(visits), [visits]);
  const [editing, setEditing] = useState<CultureVenueView | "new" | null>(null);

  return (
    <Card className="culture__card" title={copy.venues.title}>
      <div className="culture__actions">
        <Button
          size="sm"
          variant="primary"
          onClick={() => setEditing(editing === "new" ? null : "new")}
        >
          {copy.venues.add}
        </Button>
      </div>
      {editing !== null && (
        <VenueForm
          profileId={profileId}
          venue={editing === "new" ? null : editing}
          run={run}
          onClose={() => setEditing(null)}
        />
      )}
      {venues.length === 0 ? (
        <EmptyState variant="inline" title={copy.venues.empty} description={copy.venues.emptyHint} />
      ) : (
        <div className="culture__list">
          {venues.map((venue) => (
            <ListRow
              key={venue.id}
              leading={<Icon name="pin" />}
              trailing={
                <span className="culture__row-actions">
                  <Chip>{copy.kinds[venue.kind]}</Chip>
                  <Chip variant="data">{(counts.get(venue.id) ?? 0).toString()}</Chip>
                  <Button size="sm" onClick={() => setEditing(venue)}>
                    {copy.venues.edit}
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() =>
                      void run((culture) => culture.removeVenue({ profileId, id: venue.id }))
                    }
                  >
                    {copy.venues.remove}
                  </Button>
                </span>
              }
            >
              <span className="culture__row-title">{venue.name}</span>
              <span className="culture__row-meta">
                {venue.city ?? copy.venues.noCity}
                {` \u00b7 ${copy.venues.visitsCount}: ${String(counts.get(venue.id) ?? 0)}`}
              </span>
              {venue.notes !== "" && <span className="culture__row-notes">{venue.notes}</span>}
            </ListRow>
          ))}
        </div>
      )}
    </Card>
  );
}

function VenueForm({
  profileId,
  venue,
  run,
  onClose,
}: {
  profileId: string;
  venue: CultureVenueView | null;
  run: Run;
  onClose: () => void;
}) {
  const [name, setName] = useState(venue?.name ?? "");
  const [city, setCity] = useState(venue?.city ?? "");
  const [kind, setKind] = useState<VisitKind>(venue?.kind ?? "museum");
  const [notes, setNotes] = useState(venue?.notes ?? "");
  const [problem, setProblem] = useState(false);
  useEscape(onClose);

  return (
    <div className="culture__form">
      <div className="culture__fields">
        <TextField label={copy.venues.name} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        <TextField label={copy.venues.city} value={city} maxLength={80} onChange={(event) => setCity(event.target.value)} />
        <Select label={copy.venues.kind} value={kind} onChange={(event) => setKind(event.target.value as VisitKind)}>
          {VISIT_KINDS.map((each) => (
            <option key={each} value={each}>
              {copy.kinds[each]}
            </option>
          ))}
        </Select>
      </div>
      <TextArea label={copy.venues.notes} value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
      {problem && <p className="culture__field-error">{copy.errors.venueName}</p>}
      <div className="culture__actions">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const trimmed = name.trim();
            if (trimmed.length === 0) {
              setProblem(true);
              return;
            }
            setProblem(false);
            onClose();
            const fields = {
              name: trimmed,
              city: city.trim() === "" ? null : city.trim(),
              kind,
              notes,
            };
            void run((culture) =>
              venue === null
                ? culture.createVenue({ profileId, ...fields })
                : culture.updateVenue({ profileId, id: venue.id, fields }),
            );
          }}
        >
          {copy.save}
        </Button>
        <Button size="sm" variant="quiet" onClick={onClose}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  );
}

// --- the programme ----------------------------------------------------------

function ProgrammeSection({
  profileId,
  view,
  run,
  today,
}: {
  profileId: string;
  view: CultureView;
  run: Run;
  today: string;
}) {
  const [adding, setAdding] = useState(false);
  const upcoming = useMemo(() => upcomingPlans(view.plans, today), [view.plans, today]);
  const past = useMemo(() => pastPlans(view.plans, today), [view.plans, today]);
  const awaiting = useMemo(() => plansAwaitingAnswer(view.plans, today), [view.plans, today]);
  const asked = view.settings.promptPastPlans ? awaiting : [];

  return (
    <Card className="culture__card" title={copy.programme.title}>
      <div className="culture__actions">
        <Button size="sm" variant="primary" onClick={() => setAdding(!adding)}>
          {copy.programme.add}
        </Button>
      </div>
      {adding && (
        <PlanForm profileId={profileId} run={run} onClose={() => setAdding(false)} today={today} />
      )}

      {view.plans.length === 0 && (
        <EmptyState
          variant="inline"
          title={copy.programme.empty}
          description={copy.programme.emptyHint}
        />
      )}

      {asked.length > 0 && (
        <div className="culture__ask">
          <p className="nx-hint">{copy.programme.askHint}</p>
          {asked.map((plan) => (
            <ListRow
              key={plan.id}
              leading={<Icon name="museum" />}
              trailing={
                <span className="culture__row-actions">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      void run((culture) => culture.completePlan({ profileId, id: plan.id, fields: {} }))
                    }
                  >
                    {copy.programme.went}
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() =>
                      void run((culture) => culture.removePlan({ profileId, id: plan.id }))
                    }
                  >
                    {copy.programme.didNotGo}
                  </Button>
                </span>
              }
            >
              <span className="culture__row-title">{plan.title}</span>
              <span className="culture__row-meta">
                {`${formatDay(plan.date)} \u00b7 ${plan.venue}`}
              </span>
            </ListRow>
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <>
          <p className="nx-eyebrow">{copy.programme.upcoming}</p>
          <div className="culture__list">
            {upcoming.map((plan) => (
              <PlanRow key={plan.id} profileId={profileId} plan={plan} run={run} future />
            ))}
          </div>
        </>
      )}
      {past.length > 0 && (
        <>
          <p className="nx-eyebrow">{copy.programme.past}</p>
          <div className="culture__list">
            {past.map((plan) => (
              <PlanRow key={plan.id} profileId={profileId} plan={plan} run={run} future={false} />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function PlanRow({
  profileId,
  plan,
  run,
  future,
}: {
  profileId: string;
  plan: CulturePlanView;
  run: Run;
  future: boolean;
}) {
  return (
    <ListRow
      leading={<Icon name="calendar" />}
      muted={!future}
      trailing={
        <span className="culture__row-actions">
          <Chip>{copy.kinds[plan.kind]}</Chip>
          {plan.visitId !== null && <Chip variant="data">{copy.programme.becameVisit}</Chip>}
          {plan.link !== null && (
            // `target="_blank"` opens in the OS browser: this app has no tab to
            // put a web page in, and an in-app frame would be a second browser
            // nobody asked for. The address was checked in main, so only
            // http(s) can be here.
            <a className="culture__link" href={plan.link} target="_blank" rel="noreferrer">
              {copy.programme.openLink}
            </a>
          )}
          <Button
            size="sm"
            variant="quiet"
            onClick={() => void run((culture) => culture.removePlan({ profileId, id: plan.id }))}
          >
            {copy.programme.remove}
          </Button>
        </span>
      }
    >
      <span className="culture__row-title">{plan.title}</span>
      <span className="culture__row-meta">
        {formatDay(plan.date)}
        {plan.startTime === null ? "" : ` \u00b7 ${plan.startTime}`}
        {` \u00b7 ${plan.venue}`}
        {plan.city === null ? "" : `, ${plan.city}`}
      </span>
    </ListRow>
  );
}

function PlanForm({
  profileId,
  run,
  onClose,
  today,
}: {
  profileId: string;
  run: Run;
  onClose: () => void;
  today: string;
}) {
  const [kind, setKind] = useState<VisitKind>("theatre");
  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [city, setCity] = useState("");
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("");
  const [link, setLink] = useState("");
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState<"title" | "venue" | "link" | null>(null);
  useEscape(onClose);

  return (
    <div className="culture__form">
      <div className="culture__fields">
        <Select label={copy.programme.kind} value={kind} onChange={(event) => setKind(event.target.value as VisitKind)}>
          {VISIT_KINDS.map((each) => (
            <option key={each} value={each}>
              {copy.kinds[each]}
            </option>
          ))}
        </Select>
        <TextField label={copy.programme.titleLabel} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        <TextField label={copy.programme.venueLabel} value={venue} maxLength={120} onChange={(event) => setVenue(event.target.value)} />
        <TextField label={copy.programme.city} value={city} maxLength={80} onChange={(event) => setCity(event.target.value)} />
        <TextField label={copy.programme.date} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <TextField label={copy.programme.startTime} type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
        <TextField label={copy.programme.link} value={link} maxLength={2000} onChange={(event) => setLink(event.target.value)} />
      </div>
      <TextArea label={copy.programme.notes} value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
      {problem === "title" && <p className="culture__field-error">{copy.errors.title}</p>}
      {problem === "venue" && <p className="culture__field-error">{copy.errors.venue}</p>}
      {problem === "link" && <p className="culture__field-error">{copy.errors.link}</p>}
      <div className="culture__actions">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const trimmedTitle = title.trim();
            const trimmedVenue = venue.trim();
            const trimmedLink = link.trim();
            if (trimmedTitle.length === 0) {
              setProblem("title");
              return;
            }
            if (trimmedVenue.length === 0) {
              setProblem("venue");
              return;
            }
            if (trimmedLink !== "" && !/^https?:\/\//.test(trimmedLink)) {
              setProblem("link");
              return;
            }
            setProblem(null);
            onClose();
            void run((culture) =>
              culture.createPlan({
                profileId,
                kind,
                title: trimmedTitle,
                venue: trimmedVenue,
                city: city.trim() === "" ? null : city.trim(),
                date,
                startTime: startTime.trim() === "" ? null : startTime.trim(),
                link: trimmedLink === "" ? null : trimmedLink,
                notes,
              }),
            );
          }}
        >
          {copy.save}
        </Button>
        <Button size="sm" variant="quiet" onClick={onClose}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  );
}

// --- the arts guide ---------------------------------------------------------

function ArtSection() {
  const [art, setArt] = useState<Awaited<
    ReturnType<typeof window.nexus.modules.culture.listArt>
  > | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<ArtFilter>(EMPTY_ART_FILTER);
  const [open, setOpen] = useState<CultureArtWorkView | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    try {
      setArt(await window.nexus.modules.culture.listArt(EMPTY_REQUEST));
      setFailed(false);
    } catch (failure) {
      setFailed(true);
      console.error("Nexus: the arts guide could not be read:", failure);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes the viewer, which is the one thing this section opens over
  // the page: a picture drawn at full size has to be dismissible without a
  // pointer. The close button is focused when it opens, so the viewer can also
  // be left with the keyboard alone.
  const close = useCallback(() => setOpen(null), []);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEscape(close, open !== null);
  useEffect(() => {
    if (open !== null) closeRef.current?.focus();
  }, [open]);

  const works = useMemo(
    () => (art === null ? [] : filterArtWorks(art.works, filter)),
    [art, filter],
  );
  const artists = useMemo(
    () => (art === null ? [] : distinctValues(art.works, (work) => work.artist, collator())),
    [art],
  );
  const museums = useMemo(
    () => (art === null ? [] : distinctValues(art.works, (work) => work.museum, collator())),
    [art],
  );
  const centuries = useMemo(() => {
    if (art === null) return [];
    const found = new Set<number | null>();
    for (const work of art.works) found.add(artCenturyOf(work.date));
    return [...found].sort((left, right) =>
      left === null ? 1 : right === null ? -1 : left - right,
    );
  }, [art]);

  if (failed) return <p className="culture__error">{copy.art.loadError}</p>;
  if (art === null) return <LoadingState label={copy.page.loading} rows={3} />;
  if (art.packs.length === 0) {
    return (
      <Card className="culture__card" title={copy.art.title}>
        <EmptyState
          variant="inline"
          title={copy.art.empty}
          description={copy.art.emptyHint}
        />
      </Card>
    );
  }

  return (
    <Card className="culture__card" title={copy.art.title}>
      <div className="culture__toolbar">
        <TextField
          label={copy.art.search}
          value={filter.query}
          onChange={(event) => setFilter({ ...filter, query: event.target.value })}
        />
        <Select
          label={copy.art.artist}
          value={filter.artist ?? ""}
          onChange={(event) => setFilter({ ...filter, artist: event.target.value || null })}
        >
          <option value="">{copy.art.anyArtist}</option>
          {artists.map((artist) => (
            <option key={artist} value={artist}>
              {artist}
            </option>
          ))}
        </Select>
        <Select
          label={copy.art.museum}
          value={filter.museum ?? ""}
          onChange={(event) => setFilter({ ...filter, museum: event.target.value || null })}
        >
          <option value="">{copy.art.anyMuseum}</option>
          {museums.map((museum) => (
            <option key={museum} value={museum}>
              {museum}
            </option>
          ))}
        </Select>
        <Select
          label={copy.art.period}
          value={filter.century === undefined ? "" : filter.century === null ? "none" : String(filter.century)}
          onChange={(event) =>
            setFilter({
              ...filter,
              century:
                event.target.value === ""
                  ? undefined
                  : event.target.value === "none"
                    ? null
                    : Number(event.target.value),
            })
          }
        >
          <option value="">{copy.art.anyPeriod}</option>
          {centuries.map((century) => (
            <option key={century === null ? "none" : String(century)} value={century === null ? "none" : String(century)}>
              {century === null
                ? copy.art.unknownPeriod
                : `${String(century)}. ${copy.art.century}`}
            </option>
          ))}
        </Select>
      </div>

      <p className="nx-hint">
        {art.packs
          .map((pack) => `${pack.title.sr} ${pack.version} - ${pack.licence.attribution}`)
          .join(" \u00b7 ")}
      </p>
      {art.skipped.length > 0 && (
        <p className="culture__error">{`${copy.art.skipped}: ${art.skipped.join(", ")}`}</p>
      )}

      {works.length === 0 ? (
        <p className="nx-hint">{copy.art.noResults}</p>
      ) : (
        <>
          <div className="culture__gallery">
            {works.slice(0, visible).map((work) => (
              <button
                key={`${work.packId}:${work.id}`}
                type="button"
                className="culture__work"
                onClick={() => setOpen(work)}
              >
                <img
                  className="culture__work-image"
                  src={`nx-pack://${work.packId}/${work.version}/${work.image}`}
                  alt={work.title}
                  width={work.width}
                  height={work.height}
                  loading="lazy"
                />
                <span className="culture__row-title">{work.title}</span>
                <span className="culture__row-meta">{`${work.artist} \u00b7 ${work.date}`}</span>
              </button>
            ))}
          </div>
          {works.length > visible && (
            <Button size="sm" variant="quiet" onClick={() => setVisible(visible + PAGE_SIZE)}>
              {copy.more}
            </Button>
          )}
        </>
      )}

      {open !== null && (
        <div
          className="culture__viewer"
          role="dialog"
          aria-modal="true"
          aria-label={open.title}
        >
          <div className="culture__viewer-backdrop" onClick={() => setOpen(null)} />
          <div className="culture__viewer-body">
            <img
              className="culture__viewer-image"
              src={`nx-pack://${open.packId}/${open.version}/${open.image}`}
              alt={open.title}
            />
            <p className="culture__row-title">{open.title}</p>
            <p className="culture__row-meta">
              {[open.artist, open.date, open.medium ?? ""]
                .filter((part) => part !== "")
                .join(" \u00b7 ")}
            </p>
            <p className="nx-hint">{open.museum}</p>
            {/* The credit line is required by the licence the pack declares, so
                it is drawn at full size beside the picture rather than hidden
                behind a disclosure. */}
            <p className="nx-hint">{`${copy.art.credit}: ${open.credit}`}</p>
            <p className="nx-hint">{`${copy.art.licence}: ${open.licence}`}</p>
            <Button size="sm" ref={closeRef} onClick={close}>
              {copy.close}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// --- music ------------------------------------------------------------------

/**
 * The player, as a hook.
 *
 * **No `file://` path exists anywhere in this app**, so playback reaches the
 * bytes the only way that is left: `readTrackBytes` hands this hook the
 * decrypted audio and the mime main sniffed, the hook wraps them in a `Blob`,
 * and the `<audio>` element plays an object URL. The URL is revoked when the
 * track changes and when the section unmounts, so exactly one track's bytes are
 * alive in the renderer at a time - not the library's, and not the last one's.
 *
 * **Recording a play is a write, not a counter.** `recordPlay` goes to the
 * store, which is where `play_count` lives and where listening time is derived
 * from it; this hook only asks for it once per track, at the moment playback
 * starts.
 */
function usePlayer({
  profileId,
  run,
  queueIds,
}: {
  profileId: string;
  run: Run;
  queueIds: readonly string[];
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [repeat, setRepeat] = useState(false);
  const [failed, setFailed] = useState(false);

  const releaseUrl = useCallback((): void => {
    if (urlRef.current !== null) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => releaseUrl, [releaseUrl]);

  const play = useCallback(
    async (trackId: string): Promise<void> => {
      setFailed(false);
      try {
        const audio = audioRef.current;
        if (audio === null) return;
        const { mime, bytes } = await window.nexus.modules.culture.readTrackBytes({
          profileId,
          id: trackId,
        });
        releaseUrl();
        // The bytes are copied into a plain `ArrayBuffer` before they become a
        // `Blob`: an object URL is read by the media stack, and a view that
        // happened to be backed by a shared buffer is not something it accepts.
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
        urlRef.current = url;
        audio.src = url;
        setCurrentId(trackId);
        setPositionMs(0);
        await audio.play();
        setPlaying(true);
        void run((culture) => culture.recordPlay({ profileId, id: trackId }));
      } catch (failure) {
        setFailed(true);
        setPlaying(false);
        console.error("Nexus: the track could not be played:", failure);
      }
    },
    [profileId, releaseUrl, run],
  );

  const step = useCallback(
    (direction: 1 | -1): void => {
      const next = stepQueue(queueIds, currentId, direction, repeat);
      if (next === null) {
        setPlaying(false);
        return;
      }
      void play(next);
    },
    [currentId, play, queueIds, repeat],
  );

  const toggle = useCallback((): void => {
    const audio = audioRef.current;
    if (audio === null || currentId === null) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void audio.play().then(() => setPlaying(true));
    }
  }, [currentId, playing]);

  return {
    audioRef,
    currentId,
    playing,
    positionMs,
    durationMs,
    repeat,
    failed,
    play,
    step,
    toggle,
    setRepeat,
    setDurationMs,
    setPositionMs,
    setPlaying,
  };
}

function MusicSection({
  profileId,
  view,
  run,
}: {
  profileId: string;
  view: CultureView;
  run: Run;
}) {
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProblem, setImportProblem] = useState<"format" | "generic" | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [addingEntry, setAddingEntry] = useState(false);

  const playlist = view.playlists.find((each) => each.id === playlistId) ?? null;
  const queueIds = useMemo(
    () =>
      queueOrder(
        view.tracks.map((track) => track.id),
        playlist === null ? null : playlist.items.map((item) => item.trackId),
      ),
    [playlist, view.tracks],
  );
  const player = usePlayer({ profileId, run, queueIds });
  const current = view.tracks.find((track) => track.id === player.currentId) ?? null;

  async function importFiles(files: FileList | null): Promise<void> {
    if (files === null) return;
    setImporting(true);
    setImportProblem(null);
    for (const file of Array.from(files)) {
      // A friendly refusal for the obvious case (a file whose name says it is
      // not audio) - main still sniffs the bytes and is the authority, and this
      // check only decides which sentence the user reads first.
      if (!/\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)$/i.test(file.name)) {
        setImportProblem("format");
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        await run((culture) =>
          culture.importTrack({ profileId, fileName: file.name, bytes }),
        );
      } catch (failure) {
        setImportProblem("generic");
        console.error("Nexus: the audio file could not be imported:", failure);
      }
    }
    setImporting(false);
    if (fileRef.current !== null) fileRef.current.value = "";
  }

  return (
    <>
      <audio
        ref={player.audioRef}
        onTimeUpdate={(event) => player.setPositionMs(event.currentTarget.currentTime * 1000)}
        onLoadedMetadata={(event) =>
          player.setDurationMs(
            Number.isFinite(event.currentTarget.duration)
              ? event.currentTarget.duration * 1000
              : 0,
          )
        }
        onEnded={() => player.step(1)}
      />

      <Card className="culture__card" title={copy.music.player}>
        {current === null ? (
          <p className="nx-hint">{copy.music.noTrack}</p>
        ) : (
          <>
            <p className="culture__now-playing">
              {current.artist === null ? current.title : `${current.artist} - ${current.title}`}
            </p>
            <input
              className="culture__seek"
              type="range"
              min={0}
              max={Math.max(1, player.durationMs)}
              value={Math.min(player.positionMs, Math.max(1, player.durationMs))}
              aria-label={copy.music.seek}
              onChange={(event) => {
                const audio = player.audioRef.current;
                const seconds = Number(event.target.value) / 1000;
                if (audio !== null) audio.currentTime = seconds;
                player.setPositionMs(seconds * 1000);
              }}
            />
            <p className="culture__row-meta">
              {`${formatCultureDuration(Math.round(player.positionMs))} / ${formatCultureDuration(
                Math.round(player.durationMs > 0 ? player.durationMs : current.durationMs),
              )}`}
            </p>
          </>
        )}
        <div className="culture__actions">
          <Button size="sm" onClick={() => player.step(-1)} disabled={queueIds.length === 0}>
            {copy.music.previous}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={player.toggle}
            disabled={current === null}
          >
            {player.playing ? copy.music.pause : copy.music.play}
          </Button>
          <Button size="sm" onClick={() => player.step(1)} disabled={queueIds.length === 0}>
            {copy.music.next}
          </Button>
          <Checkbox
            checked={player.repeat}
            onChange={(event) => player.setRepeat(event.target.checked)}
          >
            {copy.music.repeatQueue}
          </Checkbox>
        </div>
        {player.failed && <p className="culture__field-error">{copy.errors.playback}</p>}
      </Card>

      <Card className="culture__card" title={copy.music.library}>
        <div className="culture__actions">
          <Button
            size="sm"
            variant="primary"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            {importing ? copy.music.importing : copy.music.import}
          </Button>
          <input
            ref={fileRef}
            className="culture__file"
            type="file"
            multiple
            accept=".mp3,.m4a,.aac,.ogg,.oga,.opus,.flac,.wav,audio/*"
            aria-label={copy.music.import}
            onChange={(event) => void importFiles(event.target.files)}
          />
        </div>
        {importProblem !== null && (
          <p className="culture__field-error">
            {importProblem === "format" ? copy.errors.audioFormat : copy.errors.importFailed}
          </p>
        )}
        {view.tracks.length === 0 ? (
          <EmptyState
            variant="inline"
            title={copy.music.libraryEmpty}
            description={copy.music.libraryEmptyHint}
          />
        ) : (
          <>
            <div className="culture__list">
              {view.tracks.slice(0, visible).map((track) => (
                <TrackRow
                  key={track.id}
                  profileId={profileId}
                  track={track}
                  run={run}
                  playing={player.currentId === track.id && player.playing}
                  onPlay={() => void player.play(track.id)}
                />
              ))}
            </div>
            {view.tracks.length > visible && (
              <Button size="sm" variant="quiet" onClick={() => setVisible(visible + PAGE_SIZE)}>
                {copy.more}
              </Button>
            )}
          </>
        )}
      </Card>

      <Card className="culture__card" title={copy.music.playlists}>
        <PlaylistControls
          profileId={profileId}
          view={view}
          run={run}
          playlistId={playlistId}
          onSelect={setPlaylistId}
          onPlay={(trackId) => void player.play(trackId)}
        />
      </Card>

      <Card className="culture__card" title={copy.music.log}>
        <div className="culture__actions">
          <Button size="sm" variant="primary" onClick={() => setAddingEntry(!addingEntry)}>
            {copy.music.addEntry}
          </Button>
        </div>
        {addingEntry && (
          <EntryForm
            profileId={profileId}
            tracks={view.tracks}
            run={run}
            onClose={() => setAddingEntry(false)}
            today={bareDayOf(new Date())}
          />
        )}
        {view.entries.length === 0 ? (
          <EmptyState
            variant="inline"
            title={copy.music.logEmpty}
            description={copy.music.logEmptyHint}
          />
        ) : (
          <div className="culture__list">
            {view.entries.map((entry) => (
              <EntryRow key={entry.id} profileId={profileId} entry={entry} run={run} />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function TrackRow({
  profileId,
  track,
  run,
  playing,
  onPlay,
}: {
  profileId: string;
  track: CultureTrackView;
  run: Run;
  playing: boolean;
  onPlay: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <ListRow
      leading={<Icon name={playing ? "pause" : "play"} />}
      trailing={
        <span className="culture__row-actions">
          <span className="culture__row-clock">{formatCultureDuration(track.durationMs)}</span>
          <Button size="sm" onClick={onPlay}>
            {playing ? copy.music.pause : copy.music.play}
          </Button>
          {confirming ? (
            <>
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  void run((culture) => culture.removeTrack({ profileId, id: track.id }))
                }
              >
                {copy.confirm}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>
                {copy.cancel}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="quiet" onClick={() => setConfirming(true)}>
              {copy.music.removeTrack}
            </Button>
          )}
        </span>
      }
    >
      <span className="culture__row-title">{track.title}</span>
      <span className="culture__row-meta">
        {[track.artist ?? copy.music.untagged, track.album ?? "", `${copy.music.plays}: ${String(track.playCount)}`]
          .filter((part) => part !== "")
          .join(" \u00b7 ")}
      </span>
    </ListRow>
  );
}

function PlaylistControls({
  profileId,
  view,
  run,
  playlistId,
  onSelect,
  onPlay,
}: {
  profileId: string;
  view: CultureView;
  run: Run;
  playlistId: string | null;
  onSelect: (id: string | null) => void;
  onPlay: (trackId: string) => void;
}) {
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renamed, setRenamed] = useState("");
  const [trackToAdd, setTrackToAdd] = useState("");
  const playlist = view.playlists.find((each) => each.id === playlistId) ?? null;

  return (
    <>
      <div className="culture__toolbar">
        <Select
          label={copy.music.playlistLabel}
          value={playlistId ?? ""}
          onChange={(event) => {
            onSelect(event.target.value || null);
            setRenaming(false);
          }}
        >
          <option value="">{copy.music.allTracks}</option>
          {view.playlists.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name}
            </option>
          ))}
        </Select>
        <TextField
          label={copy.music.newPlaylist}
          value={draftName}
          maxLength={100}
          onChange={(event) => setDraftName(event.target.value)}
        />
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const name = draftName.trim();
            if (name.length === 0) return;
            setDraftName("");
            void run((culture) => culture.createPlaylist({ profileId, name }));
          }}
        >
          {copy.music.createPlaylist}
        </Button>
      </div>

      {view.playlists.length === 0 ? (
        <EmptyState
          variant="inline"
          title={copy.music.playlistsEmpty}
          description={copy.music.playlistsEmptyHint}
        />
      ) : playlist === null ? (
        <p className="nx-hint">{copy.music.pickPlaylist}</p>
      ) : (
        <>
          <div className="culture__toolbar">
            {renaming ? (
              <>
                <TextField
                  label={copy.music.rename}
                  value={renamed}
                  maxLength={100}
                  onChange={(event) => setRenamed(event.target.value)}
                />
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    const name = renamed.trim();
                    if (name.length === 0) return;
                    setRenaming(false);
                    void run((culture) =>
                      culture.renamePlaylist({ profileId, id: playlist.id, name }),
                    );
                  }}
                >
                  {copy.save}
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setRenaming(false)}>
                  {copy.cancel}
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    setRenamed(playlist.name);
                    setRenaming(true);
                  }}
                >
                  {copy.music.rename}
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    onSelect(null);
                    void run((culture) => culture.removePlaylist({ profileId, id: playlist.id }));
                  }}
                >
                  {copy.music.deletePlaylist}
                </Button>
              </>
            )}
            <Select
              label={copy.music.addTrack}
              value={trackToAdd}
              onChange={(event) => setTrackToAdd(event.target.value)}
            >
              <option value="">{copy.music.chooseTrack}</option>
              {view.tracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.artist === null ? track.title : `${track.artist} - ${track.title}`}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              onClick={() => {
                if (trackToAdd === "") return;
                const trackId = trackToAdd;
                setTrackToAdd("");
                void run((culture) =>
                  culture.addPlaylistTrack({ profileId, id: playlist.id, trackId }),
                );
              }}
            >
              {copy.music.add}
            </Button>
          </div>
          {playlist.items.length === 0 ? (
            <p className="nx-hint">{copy.music.playlistEmpty}</p>
          ) : (
            <div className="culture__list">
              {playlist.items.map((item, index) => {
                const track = view.tracks.find((each) => each.id === item.trackId);
                return (
                  <PlaylistItemRow
                    key={item.id}
                    profileId={profileId}
                    playlist={playlist}
                    itemId={item.id}
                    index={index}
                    title={track?.title ?? copy.music.missingTrack}
                    run={run}
                    onPlay={track === undefined ? null : () => onPlay(track.id)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

function PlaylistItemRow({
  profileId,
  playlist,
  itemId,
  index,
  title,
  run,
  onPlay,
}: {
  profileId: string;
  playlist: CulturePlaylistView;
  itemId: string;
  index: number;
  title: string;
  run: Run;
  onPlay: (() => void) | null;
}) {
  // Moving an item is stated as its two NEIGHBOURS, which is what the store's
  // fractional rank needs - and it is also what makes a move one write rather
  // than a renumbering of the list.
  const before = index === 0 ? null : (playlist.items[index - 1]?.id ?? null);
  const after = playlist.items[index + 1]?.id ?? null;
  const move = (nextBefore: string | null, nextAfter: string | null): void => {
    void run((culture) =>
      culture.movePlaylistItem({
        profileId,
        id: playlist.id,
        itemId,
        beforeId: nextBefore,
        afterId: nextAfter,
      }),
    );
  };
  return (
    <ListRow
      leading={<span className="culture__row-clock">{String(index + 1)}</span>}
      trailing={
        <span className="culture__row-actions">
          {onPlay !== null && (
            <Button size="sm" onClick={onPlay}>
              {copy.music.play}
            </Button>
          )}
          <Button
            size="sm"
            variant="quiet"
            disabled={index === 0}
            onClick={() => move(playlist.items[index - 2]?.id ?? null, before)}
          >
            {copy.music.moveUp}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={index === playlist.items.length - 1}
            onClick={() => move(after, playlist.items[index + 2]?.id ?? null)}
          >
            {copy.music.moveDown}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            onClick={() =>
              void run((culture) =>
                culture.removePlaylistItem({ profileId, id: playlist.id, itemId }),
              )
            }
          >
            {copy.music.removeItem}
          </Button>
        </span>
      }
    >
      <span className="culture__row-title">{title}</span>
    </ListRow>
  );
}

function EntryRow({
  profileId,
  entry,
  run,
}: {
  profileId: string;
  entry: CultureEntryView;
  run: Run;
}) {
  return (
    <ListRow
      leading={<Icon name="book" />}
      trailing={
        <span className="culture__row-actions">
          <Chip>{copy.music.kinds[entry.kind]}</Chip>
          <Chip variant={entry.rating !== null ? "data" : "neutral"}>{ratingText(entry.rating)}</Chip>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => void run((culture) => culture.removeEntry({ profileId, id: entry.id }))}
          >
            {copy.music.removeEntry}
          </Button>
        </span>
      }
    >
      <span className="culture__row-title">{`${entry.artist} - ${entry.title}`}</span>
      <span className="culture__row-meta">{formatDay(entry.date)}</span>
      {entry.notes !== "" && <span className="culture__row-notes">{entry.notes}</span>}
    </ListRow>
  );
}

function EntryForm({
  profileId,
  tracks,
  run,
  onClose,
  today,
}: {
  profileId: string;
  tracks: readonly CultureTrackView[];
  run: Run;
  onClose: () => void;
  today: string;
}) {
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<MusicLogKind>("album");
  const [date, setDate] = useState(today);
  const [rating, setRating] = useState("");
  const [notes, setNotes] = useState("");
  const [trackId, setTrackId] = useState("");
  const [problem, setProblem] = useState<"artist" | "title" | "rating" | null>(null);
  useEscape(onClose);

  return (
    <div className="culture__form">
      <div className="culture__fields">
        <TextField label={copy.music.artist} value={artist} maxLength={200} onChange={(event) => setArtist(event.target.value)} />
        <TextField label={copy.music.trackTitle} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        <Select label={copy.music.kind} value={kind} onChange={(event) => setKind(event.target.value as MusicLogKind)}>
          {MUSIC_LOG_KINDS.map((each) => (
            <option key={each} value={each}>
              {copy.music.kinds[each]}
            </option>
          ))}
        </Select>
        <TextField label={copy.music.date} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <TextField label={copy.music.rating} inputMode="numeric" value={rating} onChange={(event) => setRating(event.target.value)} />
        <Select label={copy.music.track} value={trackId} onChange={(event) => setTrackId(event.target.value)}>
          <option value="">{copy.music.noTrackLink}</option>
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.artist === null ? track.title : `${track.artist} - ${track.title}`}
            </option>
          ))}
        </Select>
      </div>
      <TextArea label={copy.music.notes} value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
      {problem === "artist" && <p className="culture__field-error">{copy.errors.entryArtist}</p>}
      {problem === "title" && <p className="culture__field-error">{copy.errors.entryTitle}</p>}
      {problem === "rating" && <p className="culture__field-error">{copy.errors.rating}</p>}
      <div className="culture__actions">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const trimmedArtist = artist.trim();
            const trimmedTitle = title.trim();
            if (trimmedArtist.length === 0) {
              setProblem("artist");
              return;
            }
            if (trimmedTitle.length === 0) {
              setProblem("title");
              return;
            }
            const parsedRating = parseRating(rating);
            if (rating.trim() !== "" && parsedRating === null) {
              setProblem("rating");
              return;
            }
            setProblem(null);
            onClose();
            void run((culture) =>
              culture.createEntry({
                profileId,
                artist: trimmedArtist,
                title: trimmedTitle,
                kind,
                date,
                rating: parsedRating,
                notes,
                trackId: trackId === "" ? null : trackId,
              }),
            );
          }}
        >
          {copy.save}
        </Button>
        <Button size="sm" variant="quiet" onClick={onClose}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  );
}

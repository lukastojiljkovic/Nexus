import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { formatRecordingDuration, groupByCreationDay } from "@nexus/core";
import {
  Button,
  Checkbox,
  Chip,
  EmptyState,
  Icon,
  ListRow,
  LoadingState,
  PageHeader,
  Select,
  StatBand,
  TextArea,
  TextField,
} from "@nexus/ui";
import type { Stat } from "@nexus/ui";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { activeLocale, declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { collator } from "../../../renderer/src/intl.js";
import type { Locale } from "../../../renderer/src/strings.js";
import { manifest } from "../shared/manifest.js";
import type { RecorderCapsView, RecorderEntryView, RecorderView } from "../shared/ipc.js";
import { CaptureSection } from "./CaptureSection.js";
import { copy } from "./copy.js";
import {
  entryTitle,
  formatBytes,
  formatDayKey,
  formatTimeOfDay,
  joinTags,
  localDayKey,
  matchesQuery,
  splitTags,
} from "./entries.js";
import "./recorder.css";

/**
 * SNIMAČ (ADR-090) — the module kit's second worked example, and the first with
 * a device on one end and a blob on the other.
 *
 * **Two sections, and the split is the module's own shape.** „Snimanje" is the
 * live capture (`CaptureSection.tsx`): it exists while the page is open and a
 * device is on. „Snimci" is the diary — rows grouped by the day they were made,
 * searched, played, edited and deleted in place. A capture in progress is
 * deliberately NOT a row: it has no hash, no size and no end.
 *
 * **Why the page never guesses.** Every mutation answers with the WHOLE view —
 * the rows, the library's totals, the tags in use and the store's own caps — so
 * there is exactly one way this page learns anything: what main just said. A
 * local patch on top of a write would be a second answer to a question that has
 * one, and the two would eventually differ in exactly the number nobody looked
 * at (a total, a tag list, a cap).
 *
 * **Why the day heading is a date and not „Danas".** A row's day is
 * `@nexus/core`'s `groupByCreationDay`, which reads the first ten characters of
 * the stored instant — the house's day-key rule for an instant, the same one the
 * calendar page reads. Calling that group „today" would be a claim about the
 * user's own calendar, which is a different frame: at 00:30 the two disagree,
 * and the heading would be the one lying. So the heading states the day.
 */

export default function RecorderPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<RecorderView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  /** The capture's own „Snimi" button, which the empty state's action presses — one primary for recording, drawn once. */
  const captureStartRef = useRef<HTMLButtonElement>(null);
  const locale = activeLocale();

  /** One read, into state — and it closes an editor or a player whose row is gone. */
  const adopt = useCallback((next: RecorderView) => {
    setView(next);
    setActionError(null);
    const present = new Set(next.entries.map((entry) => entry.id));
    setEditingId((current) => (current !== null && present.has(current) ? current : null));
    setPlayingId((current) => (current !== null && present.has(current) ? current : null));
  }, []);

  const refresh = useCallback(async () => {
    try {
      adopt(await window.nexus.modules.recorder.list({ profileId }));
      setLoadFailed(false);
    } catch (failure) {
      setLoadFailed(true);
      // No toast and no dialog: a page that cannot read says so in its own body
      // and keeps saying so until a read works.
      console.error("Nexus: the recordings could not be loaded:", failure);
    }
  }, [adopt, profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Runs one mutation: clears the previous refusal, performs it, adopts main's answer. */
  const run = useCallback(
    async (action: (recorder: typeof window.nexus.modules.recorder) => Promise<RecorderView>) => {
      setActionError(null);
      try {
        adopt(await action(window.nexus.modules.recorder));
      } catch (failure) {
        setActionError(copy.errors.mutate);
        console.error("Nexus: a recorder change failed:", failure);
      }
    },
    [adopt],
  );

  /**
   * The tags in use, in the order this language reads them: main sends them in
   * the order the rows carried them, and `collator()` — the app's one door to
   * `Intl` — sorts them with Serbian Latin's own tailoring, re-sorting itself
   * when the language changes.
   */
  const tagOptions = useMemo(() => {
    if (view === null) return [];
    return [...view.tags].sort(collator().compare);
  }, [view]);

  const groups = useMemo(() => {
    if (view === null) return [];
    const filtered = view.entries.filter(
      (entry) => matchesQuery(entry, query) && (tagFilter === "" || entry.tags.includes(tagFilter)),
    );
    return groupByCreationDay(filtered);
  }, [view, query, tagFilter]);

  async function remove(entry: RecorderEntryView): Promise<void> {
    if (editingId === entry.id) setEditingId(null);
    if (playingId === entry.id) setPlayingId(null);
    await run(async (recorder) => {
      const next = await recorder.remove({ profileId, id: entry.id });
      setPendingUndoId(entry.id);
      return next;
    });
  }

  async function undoRemove(): Promise<void> {
    const id = pendingUndoId;
    if (id === null) return;
    await run(async (recorder) => {
      const next = await recorder.restore({ profileId, id });
      setPendingUndoId(null);
      return next;
    });
  }

  if (loadFailed) {
    return <EmptyState sigil="mic" title={copy.errors.load} />;
  }
  if (view === null) {
    return <LoadingState label={copy.page.loading} rows={6} />;
  }

  const empty = view.entries.length === 0;

  return (
    <div className="rec nx-measure">
      {/* The page's own name is the word the module DECLARED, read in the
          language being spoken, rather than a second copy of it. */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="mic"
      />
      {actionError !== null && (
        <p className="rec__error" role="alert">
          {actionError}
        </p>
      )}

      <CaptureSection
        profileId={profileId}
        limitBytes={view.limitBytes}
        countdown={view.settings.countdown}
        startRef={captureStartRef}
        onSaved={adopt}
      />

      {!empty && (
        <StatBand
          stats={storageStats(view, locale)}
          // The store's own cap, said once: a user who meets it should know the
          // number before the capture stops rather than after.
          caption={`${copy.stats.limitLabel}: ${formatBytes(view.limitBytes, locale)}`}
        />
      )}

      <section className="rec__section" aria-label={copy.list.title} data-nx-content>
        <div className="rec__heading">{copy.list.title}</div>

        {pendingUndoId !== null && (
          <div className="rec__undo" role="status">
            <span className="rec__undo-text">{copy.list.deletedNotice}</span>
            <Button size="sm" onClick={() => void undoRemove()}>
              {copy.list.undo}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              aria-label={copy.list.dismiss}
              onClick={() => setPendingUndoId(null)}
            >
              <Icon name="close" size={14} />
            </Button>
          </div>
        )}

        {!empty && (
          <div className="rec__filters">
            <TextField
              label={copy.list.searchLabel}
              placeholder={copy.list.searchPlaceholder}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Select
              label={copy.list.tagLabel}
              value={tagFilter}
              disabled={tagOptions.length === 0}
              onChange={(event) => setTagFilter(event.target.value)}
            >
              <option value="">{copy.list.tagAll}</option>
              {tagOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </Select>
          </div>
        )}

        {empty ? (
          // The page's ONE invitation, and its one primary — which is the
          // capture's own „Snimi", because a recording cannot be made without it.
          <EmptyState
            sigil="mic"
            title={copy.list.emptyTitle}
            description={copy.list.emptyBody}
            action={
              <Button variant="primary" onClick={() => captureStartRef.current?.click()}>
                {copy.capture.start}
              </Button>
            }
          />
        ) : groups.length === 0 ? (
          <p className="nx-hint">{copy.list.noResults}</p>
        ) : (
          groups.map((group) => (
            <div key={group.day} className="rec__group">
              <div className="rec__group-day">{formatDayKey(group.day, locale)}</div>
              {group.recordings.map((entry) =>
                editingId === entry.id ? (
                  <EntryForm
                    key={entry.id}
                    entry={entry}
                    caps={view.caps}
                    onCancel={() => setEditingId(null)}
                    onSave={async (fields) => {
                      setEditingId(null);
                      await run((recorder) =>
                        recorder.update({ profileId, id: entry.id, ...fields }),
                      );
                    }}
                  />
                ) : (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    playing={playingId === entry.id}
                    onTogglePlay={() =>
                      setPlayingId((current) => (current === entry.id ? null : entry.id))
                    }
                    onEdit={() => setEditingId(entry.id)}
                    onRemove={() => void remove(entry)}
                  />
                ),
              )}
            </div>
          ))
        )}

      </section>
    </div>
  );
}

/**
 * The three figures this module has about the profile's library: how many
 * recordings there are, and what each kind costs in bytes and in running time.
 *
 * Every number comes from the view's `storage`, which main computed with
 * `@nexus/core`'s `recordingStorageSummary` — the one definition of „what the
 * library costs" — and the units come from `Intl` through `formatBytes` and
 * `formatRecordingDuration`. The band is absent for a profile with no
 * recordings: three zeroes are a fact about nothing.
 */
function storageStats(view: RecorderView, locale: Locale): Stat[] {
  const { storage } = view;
  return [
    {
      label: copy.stats.recordings,
      value: String(storage.all.count),
      note: formatRecordingDuration(storage.all.durationMs),
    },
    ...(
      [
        [copy.stats.audio, storage.audio],
        [copy.stats.video, storage.video],
      ] as const
    ).map(([label, totals]) => ({
      label,
      value: formatBytes(totals.sizeBytes, locale),
      note: formatRecordingDuration(totals.durationMs),
      size: "flow" as const,
    })),
  ];
}

/** One recording's row, and its player when it is open. */
function EntryRow({
  entry,
  playing,
  onTogglePlay,
  onEdit,
  onRemove,
}: {
  entry: RecorderEntryView;
  playing: boolean;
  onTogglePlay: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const locale = activeLocale();
  const title = entryTitle(entry.title, entry.createdAt, locale);
  // The bytes are played from the app's own read protocol (ADR-014): main serves
  // them by hash and announces the mime this module stored, so the element gets
  // a URL it can seek in and no bytes cross IPC twice.
  const blobUrl = `nx-blob://${entry.sha256}`;
  return (
    <div className="rec__item">
      <ListRow
        leading={<Icon name="mic" />}
        trailing={
          <span className="rec__row-actions">
            <Button size="sm" aria-expanded={playing} onClick={onTogglePlay}>
              {playing ? copy.list.hide : copy.list.play}
            </Button>
            <Button
              size="sm"
              aria-label={`${copy.list.edit}: ${title}`}
              title={copy.list.edit}
              onClick={onEdit}
            >
              <Icon name="pencil" size={14} />
            </Button>
            <Button
              size="sm"
              variant="quiet"
              aria-label={`${copy.list.remove}: ${title}`}
              title={copy.list.remove}
              onClick={onRemove}
            >
              <Icon name="trash" size={14} />
            </Button>
          </span>
        }
      >
        <span className="rec__row-title">{title}</span>
        <span className="rec__row-meta">
          <Chip>{entry.kind === "video" ? copy.capture.kindVideo : copy.capture.kindAudio}</Chip>
          <span>{formatTimeOfDay(entry.createdAt, locale)}</span>
          <span>{formatRecordingDuration(entry.durationMs)}</span>
          <span>{formatBytes(entry.sizeBytes, locale)}</span>
        </span>
        {entry.diaryDate !== null && (
          <span className="rec__row-diary">{formatDayKey(entry.diaryDate, locale)}</span>
        )}
        {entry.notes !== "" && <span className="rec__row-note">{entry.notes}</span>}
        {entry.tags.length > 0 && (
          <span className="rec__row-tags">
            {entry.tags.map((tag) => (
              <Chip key={tag}>{tag}</Chip>
            ))}
          </span>
        )}
      </ListRow>
      {playing &&
        (entry.kind === "video" ? (
          <video className="rec__player" controls src={blobUrl} aria-label={title} />
        ) : (
          <audio className="rec__player" controls src={blobUrl} aria-label={title} />
        ))}
    </div>
  );
}

/** What the form hands back: the fields a recording's patch carries. */
interface EntryFields {
  title: string;
  tags: string[];
  notes: string;
  isDiary: boolean;
  diaryDate: string | null;
}

/**
 * One recording's edit form, drawn in its row's place.
 *
 * **Why the diary pair is two controls and one fact.** „Upiši u dnevnik" is what
 * the user decides; the date is where the entry is FILED, and it defaults to
 * today — a diary entry recorded at 23:50 belongs to tomorrow, which is exactly
 * why the date is a field rather than something main stamps. Turning the switch
 * off clears the date, because the store refuses half a pair (migration 077's
 * CHECK) and a form that could reach that refusal by accident would be asking for
 * something it already knows cannot be granted.
 *
 * **Why the caps come from the view.** `maxLength` is the store's own column
 * CHECK, sent with every read, so this form cannot refuse text the store would
 * have taken and cannot invite text it would refuse.
 *
 * Escape cancels, on the house rule that Escape closes what it opened.
 */
function EntryForm({
  entry,
  caps,
  onSave,
  onCancel,
}: {
  entry: RecorderEntryView;
  caps: RecorderCapsView;
  onSave: (fields: EntryFields) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(entry.title);
  const [tagsText, setTagsText] = useState(joinTags(entry.tags));
  const [notes, setNotes] = useState(entry.notes);
  const [isDiary, setIsDiary] = useState(entry.isDiary);
  const [diaryDate, setDiaryDate] = useState(entry.diaryDate ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  function submit(): void {
    // One over the cap, so „too many" is a refusal rather than a silent cut.
    const tags = splitTags(tagsText, caps.tagCount + 1);
    if (tags.length > caps.tagCount || tags.some((tag) => tag.length > caps.tagChars)) {
      setProblem(copy.errors.tags);
      return;
    }
    if (isDiary && diaryDate === "") {
      setProblem(copy.errors.date);
      return;
    }
    setProblem(null);
    void onSave({
      title,
      tags,
      notes,
      isDiary,
      diaryDate: isDiary ? diaryDate : null,
    });
  }

  return (
    <form
      className="rec__form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="rec__form-title">{copy.form.editTitle}</div>
      <TextField
        label={copy.form.titleLabel}
        placeholder={copy.form.titlePlaceholder}
        maxLength={caps.titleChars}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <TextField
        label={copy.form.tagsLabel}
        placeholder={copy.form.tagsPlaceholder}
        value={tagsText}
        onChange={(event) => setTagsText(event.target.value)}
      />
      <span className="rec__field-hint">{copy.form.tagsHint}</span>
      <TextArea
        label={copy.form.notesLabel}
        placeholder={copy.form.notesPlaceholder}
        maxLength={caps.notesChars}
        rows={3}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <Checkbox
        checked={isDiary}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setIsDiary(event.target.checked);
          // Turning it ON fills the date with today on THIS machine's calendar:
          // the day a recording is being filed under is the user's own day, not
          // the UTC one the list groups by.
          if (event.target.checked && diaryDate === "") setDiaryDate(localDayKey(new Date()));
        }}
      >
        {copy.form.diaryLabel}
      </Checkbox>
      {isDiary && (
        <TextField
          label={copy.form.dateLabel}
          type="date"
          value={diaryDate}
          onChange={(event) => setDiaryDate(event.target.value)}
        />
      )}
      {problem !== null && (
        <p className="rec__error" role="alert">
          {problem}
        </p>
      )}
      <div className="rec__form-actions">
        <Button type="submit" size="sm" variant="primary">
          {copy.form.save}
        </Button>
        <Button type="button" size="sm" variant="quiet" onClick={onCancel}>
          {copy.form.cancel}
        </Button>
      </div>
    </form>
  );
}

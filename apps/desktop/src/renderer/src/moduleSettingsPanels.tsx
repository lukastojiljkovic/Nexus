import { useEffect, useRef, useState } from "react";
import type { ComponentType, FormEvent } from "react";
import { validateFocusConfig } from "@nexus/core";
import type { FocusConfig } from "@nexus/core";
import { Button, Checkbox, TextField } from "@nexus/ui";
import {
  DEFAULT_TARGET_RETENTION,
  MAX_BACKGROUND_DIM,
  MAX_NEW_PER_DAY,
  MAX_REVIEWS_PER_DAY,
  TARGET_RETENTION_PRESETS,
} from "../../shared/ipc.js";
import type {
  CalendarSettings,
  DashboardSettings,
  PrivStatus,
  StudySettings,
} from "../../shared/ipc.js";
import {
  FILE_VIEWS,
  clearStoredFilePreferences,
  persistFileView,
  readStoredFileView,
  type FileView,
} from "./filePrefs.js";
import {
  clearStoredFinancePreferences,
  normalizeCurrencyInput,
  persistPrimaryCurrency,
  readStoredPrimaryCurrency,
} from "./financePrefs.js";
import {
  clearStoredFocusPreferences,
  persistFocusConfig,
  readStoredFocusConfig,
} from "./focusPrefs.js";
import {
  clearStoredHabitPreferences,
  isReminderTime,
  persistDefaultReminder,
  readStoredDefaultReminder,
} from "./habitPrefs.js";
import { settingsEntryId } from "./moduleSettings.js";
import {
  clearStoredNotePreferences,
  NOTE_WIDTHS,
  persistNoteMarkdownShortcuts,
  persistNoteWidth,
  readStoredNoteMarkdownShortcuts,
  readStoredNoteWidth,
  type NoteWidth,
} from "./notePrefs.js";
import { labelClass } from "./settingsSearch.js";
import {
  BLOCKED_IN_TODAY_OPTIONS,
  clearStoredTaskPreferences,
  persistBlockedInToday,
  readStoredBlockedInToday,
  type BlockedInToday,
} from "./taskPrefs.js";
import { strings } from "./strings.js";

/**
 * The bodies of the settings cards MODULES own — one component per declared
 * `SettingsPanel`, plus the map `SettingsPage` looks a module up in.
 *
 * This is `dashboardWidgets.tsx` for the settings page, and deliberately the
 * same pairing: the catalogue is the module registry's (`manifest.settings`),
 * this is the renderer half, and `modules.test.ts` pins that the two agree. A
 * module whose declaration this map does not know draws NOTHING rather than
 * failing, which is what lets a module be dropped from a build without the
 * page noticing.
 *
 * Adding a module's settings from here on is a declaration in
 * `shared/modules.ts` and a component in this file. `SettingsPage.tsx` is not
 * edited: it composes whatever the registry publishes, in registry order.
 *
 * The page owns the card frame, the title, the SET-014 visibility class and the
 * „Vrati na podrazumevano" link. A body owns its own reads, writes and error
 * lines — every one of them exactly as it was when these lived inside the page.
 */

/** Everything a panel body is given: whose profile, and which labels the filter matched. */
export interface SettingsPanelProps {
  profileId: string;
  /** SET-014 hits; a body reads only its own entry ids out of it, through `settingsEntryId`. */
  hits: ReadonlySet<string>;
}

/** How the page draws one module's card: the body, and — for a device-only card — how its reset is performed. */
export interface SettingsPanelRenderer {
  Body: ComponentType<SettingsPanelProps>;
  /**
   * Clears this panel's DEVICE preferences (SET §5). Present on exactly the
   * panels whose declaration is all-`device`, which `modules.test.ts` pins, and
   * absent everywhere else — a profile-stored setting has no "default on this
   * machine" to go back to.
   *
   * It only forgets the keys; the page remounts the body afterwards, so the
   * controls show the defaults live rather than only after a reload.
   */
  resetDevice?: () => void;
}

// --- TASK ---------------------------------------------------------------------

/**
 * Zadaci (ADR-049). Its own card rather than a row under „Izgled“, on the
 * Beleške precedent below: a preference that describes how ONE module reads
 * belongs to that module. The page reads it on mount, so a change here shows
 * the next time Zadaci is opened.
 */
function TasksSettingsPanel({ hits }: SettingsPanelProps) {
  const s = strings.settings.tasks;
  const [blockedInToday, setBlockedInToday] = useState<BlockedInToday>(() =>
    readStoredBlockedInToday(),
  );

  return (
    <>
      <p
        className={labelClass(
          "set__section-caption",
          hits.has(settingsEntryId("tasks", "blocked-today")),
        )}
      >
        {s.blockedInTodayLabel}
      </p>
      <div className="set__segmented" role="group" aria-label={s.blockedInTodayLabel}>
        {BLOCKED_IN_TODAY_OPTIONS.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={blockedInToday === option ? "primary" : "ghost"}
            aria-pressed={blockedInToday === option}
            onClick={() => {
              persistBlockedInToday(option);
              setBlockedInToday(option);
            }}
          >
            {s.blockedInTodayOptions[option]}
          </Button>
        ))}
      </div>
      <p className="set__section-caption">{s.blockedInTodayCaption}</p>
    </>
  );
}

// --- NOTE ---------------------------------------------------------------------

/** Beleške (ADR-036): the editor's reading measure and its markdown input rules — both device preferences. */
function NotesSettingsPanel({ hits }: SettingsPanelProps) {
  const s = strings.settings.notes;
  const [noteWidth, setNoteWidth] = useState<NoteWidth>(() => readStoredNoteWidth());
  const [markdownShortcuts, setMarkdownShortcuts] = useState(() =>
    readStoredNoteMarkdownShortcuts(),
  );

  return (
    <>
      <p className={labelClass("set__section-caption", hits.has(settingsEntryId("notes", "width")))}>
        {s.widthLabel}
      </p>
      <div className="set__segmented" role="group" aria-label={s.widthLabel}>
        {NOTE_WIDTHS.map((width) => (
          <Button
            key={width}
            size="sm"
            variant={noteWidth === width ? "primary" : "ghost"}
            aria-pressed={noteWidth === width}
            onClick={() => {
              persistNoteWidth(width);
              setNoteWidth(width);
            }}
          >
            {s.widthNames[width] ?? width}
          </Button>
        ))}
      </div>
      <div className="set__module-row">
        <div className="set__module-info">
          <span
            className={labelClass(
              "set__module-name",
              hits.has(settingsEntryId("notes", "markdown")),
            )}
          >
            {s.markdownLabel}
          </span>
          <span className="set__module-desc">{s.markdownCaption}</span>
        </div>
        <Checkbox
          checked={markdownShortcuts}
          aria-label={s.markdownLabel}
          onChange={(event) => {
            persistNoteMarkdownShortcuts(event.target.checked);
            setMarkdownShortcuts(event.target.checked);
          }}
        />
      </div>
    </>
  );
}

// --- DASH ---------------------------------------------------------------------

/**
 * Kontrolna tabla (SET-006 / ADR-041): the dashboard's own background image and
 * the dim that holds it behind the widgets.
 *
 * The renderer validates nothing about the file and never sees one — every
 * button here is a request to main, which owns the picker, the size gate, the
 * MIME sniff and the blob store (SEC-EL). A refused pick comes back as a NAMED
 * reason and is shown as such; nothing is silently converted to fit.
 *
 * The slider is hidden while no background is set, because a dim with nothing
 * to dim is a control that does nothing. It commits on every change rather than
 * behind a save button: the value is one small integer, the effect is visual,
 * and a "Sačuvaj" between the two would only put a step between the user and
 * what they are looking at.
 */
function DashboardSettingsPanel({ profileId, hits }: SettingsPanelProps) {
  const s = strings.settings.dashboard;
  const [settings, setSettings] = useState<DashboardSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await window.nexus.dashboardSettings(profileId);
        if (active) setSettings(next);
      } catch (loadError) {
        if (active) setError(strings.settings.dashboard.error);
        console.error("Nexus: failed to load dashboard settings:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  async function pick(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await window.nexus.pickDashboardBackground(profileId);
      if (result.status === "ok") setSettings(result.settings);
      else if (result.status === "rejected") setError(s.rejected[result.code]);
    } catch (pickError) {
      setError(s.error);
      console.error("Nexus: failed to pick a dashboard background:", pickError);
    } finally {
      setBusy(false);
    }
  }

  async function clear(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setSettings(await window.nexus.clearDashboardBackground(profileId));
    } catch (clearError) {
      setError(s.error);
      console.error("Nexus: failed to clear the dashboard background:", clearError);
    } finally {
      setBusy(false);
    }
  }

  // Optimistic on purpose: the slider must track the pointer, so the local
  // value moves first and main confirms after. A drag fires one write per step,
  // and their replies can land out of order — `latestDim` is what stops a slow
  // earlier reply from snapping the slider back over a newer position. Only the
  // reply to the CURRENT value is ever adopted; the rest are dropped, which
  // costs nothing since each carries the same row.
  const latestDim = useRef<number | null>(null);

  async function changeDim(dim: number): Promise<void> {
    latestDim.current = dim;
    setSettings((current) => (current === null ? current : { ...current, backgroundDim: dim }));
    setError(null);
    try {
      const next = await window.nexus.setDashboardDim(profileId, dim);
      if (latestDim.current === dim) setSettings(next);
    } catch (dimError) {
      setError(s.error);
      console.error("Nexus: failed to set the dashboard dim:", dimError);
    }
  }

  if (settings === null) {
    return error != null ? <p className="set__error">{error}</p> : <p className="app__muted">{strings.app.loading}</p>;
  }

  const backgroundHash = settings.backgroundHash;

  return (
    <>
      <p className="set__section-caption">{s.caption}</p>

      <div className="set__dash-row">
        {backgroundHash !== null && (
          <img className="set__dash-thumb" src={`nx-blob://${backgroundHash}`} alt={s.thumbnailAlt} />
        )}
        <div className="set__dash-actions">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void pick()}>
            {s.pick}
          </Button>
          {backgroundHash !== null && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void clear()}>
              {s.clear}
            </Button>
          )}
        </div>
      </div>

      {backgroundHash !== null && (
        <div className="set__dash-dim">
          <label
            className={labelClass(
              "set__dash-dim-label",
              hits.has(settingsEntryId("dashboard", "dim")),
            )}
            htmlFor="set-dash-dim"
          >
            {s.dimLabel}
            <span className="set__dash-dim-value">{settings.backgroundDim}%</span>
          </label>
          <input
            id="set-dash-dim"
            className="set__dash-slider"
            type="range"
            min={0}
            max={MAX_BACKGROUND_DIM}
            step={5}
            value={settings.backgroundDim}
            onChange={(event) => void changeDim(Number(event.target.value))}
          />
          <p className="set__section-caption">{s.dimHint}</p>
        </div>
      )}

      {error != null && <p className="set__error">{error}</p>}
    </>
  );
}

// --- STUDY --------------------------------------------------------------------

/** A retention preset as a whole percent, with the scheduler's own default named as such. */
function retentionLabel(preset: number): string {
  const percent = `${Math.round(preset * 100)}%`;
  return preset === DEFAULT_TARGET_RETENTION
    ? `${percent} · ${strings.settings.study.retentionDefault}`
    : percent;
}

/**
 * Učenje (STUDY-007): the FSRS target retention and the two daily caps.
 *
 * „Ciljana zapamćenost" is a closed segmented row over `TARGET_RETENTION_PRESETS`,
 * not a numeric field — the value is a probability the scheduler aims for, and
 * nobody has an intuition about 0.9137. It follows the theme/week-start recipe
 * exactly, which is this app's spelling of a small closed select.
 *
 * The two caps are ordinary number inputs held as TEXT while being typed, and
 * committed only once the draft parses inside its own range — otherwise
 * backspacing "20" to "" would fire a write for a number the user is in the
 * middle of replacing. Blur snaps a half-typed draft back to what is stored, so
 * the field can never show something the profile does not have. The empty cap
 * field is a real value (`null`, "no limit"), so it commits on the spot.
 *
 * Every write is the WHOLE triple (one channel, one form), commits immediately
 * like the dashboard's dim, and carries a `latest`-wins guard for the same
 * reason: replies to a fast sequence of edits can land out of order.
 */
function StudySettingsPanel({ profileId, hits }: SettingsPanelProps) {
  const s = strings.settings.study;
  const [settings, setSettings] = useState<StudySettings | null>(null);
  const [newPerDayDraft, setNewPerDayDraft] = useState("");
  const [reviewCapDraft, setReviewCapDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<StudySettings | null>(null);

  function adopt(next: StudySettings): void {
    setSettings(next);
    setNewPerDayDraft(String(next.newPerDay));
    setReviewCapDraft(next.maxReviewsPerDay === null ? "" : String(next.maxReviewsPerDay));
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await window.nexus.studySettings(profileId);
        if (active) adopt(next);
      } catch (loadError) {
        if (active) setError(strings.settings.study.error);
        console.error("Nexus: failed to load study settings:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  async function save(next: StudySettings): Promise<void> {
    latest.current = next;
    setSettings(next);
    setError(null);
    try {
      const stored = await window.nexus.setStudySettings(profileId, next);
      if (latest.current === next) adopt(stored);
    } catch (saveError) {
      setError(s.error);
      console.error("Nexus: failed to save study settings:", saveError);
    }
  }

  if (settings === null) {
    return error != null ? (
      <p className="set__error">{error}</p>
    ) : (
      <p className="app__muted">{strings.app.loading}</p>
    );
  }

  const current = settings;

  const changeNewPerDay = (text: string): void => {
    setNewPerDayDraft(text);
    // The empty check leads: `Number("")` is 0, which is a legal value here, so
    // an unfinished edit would otherwise commit "no new cards today".
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isInteger(parsed) || parsed < 0 || parsed > MAX_NEW_PER_DAY) {
      return;
    }
    void save({ ...current, newPerDay: parsed });
  };

  const changeReviewCap = (text: string): void => {
    setReviewCapDraft(text);
    // Here an empty field is the VALUE "no limit", not an unfinished edit — so
    // it commits, unlike an empty „Novih kartica dnevno".
    if (text.trim() === "") {
      void save({ ...current, maxReviewsPerDay: null });
      return;
    }
    const parsed = Number(text);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_REVIEWS_PER_DAY) return;
    void save({ ...current, maxReviewsPerDay: parsed });
  };

  return (
    <>
      <p className="set__section-caption">{s.caption}</p>

      <p
        className={labelClass(
          "set__section-caption",
          hits.has(settingsEntryId("study", "retention")),
        )}
      >
        {s.retentionLabel}
      </p>
      <div className="set__segmented" role="group" aria-label={s.retentionLabel}>
        {TARGET_RETENTION_PRESETS.map((preset) => (
          <Button
            key={preset}
            size="sm"
            variant={current.targetRetention === preset ? "primary" : "ghost"}
            aria-pressed={current.targetRetention === preset}
            onClick={() => void save({ ...current, targetRetention: preset })}
          >
            {retentionLabel(preset)}
          </Button>
        ))}
      </div>
      <p className="set__section-caption">{s.retentionHint}</p>

      <div className="set__study-fields">
        <label className="set__study-field">
          <span
            className={labelClass(
              "set__study-label",
              hits.has(settingsEntryId("study", "new-per-day")),
            )}
          >
            {s.newPerDayLabel}
          </span>
          <input
            type="number"
            inputMode="numeric"
            className="nx-textfield__input set__study-number"
            min={0}
            max={MAX_NEW_PER_DAY}
            value={newPerDayDraft}
            onChange={(event) => changeNewPerDay(event.target.value)}
            onBlur={() => setNewPerDayDraft(String(current.newPerDay))}
          />
          <span className="set__section-caption">{s.newPerDayHint}</span>
        </label>

        <label className="set__study-field">
          <span
            className={labelClass(
              "set__study-label",
              hits.has(settingsEntryId("study", "review-cap")),
            )}
          >
            {s.reviewCapLabel}
          </span>
          <input
            type="number"
            inputMode="numeric"
            className="nx-textfield__input set__study-number"
            min={1}
            max={MAX_REVIEWS_PER_DAY}
            placeholder={s.reviewCapPlaceholder}
            value={reviewCapDraft}
            onChange={(event) => changeReviewCap(event.target.value)}
            onBlur={() =>
              setReviewCapDraft(
                current.maxReviewsPerDay === null ? "" : String(current.maxReviewsPerDay),
              )
            }
          />
          <span className="set__section-caption">{s.reviewCapHint}</span>
        </label>
      </div>

      <p className="set__section-caption">{s.retroNotice}</p>
      {error != null && <p className="set__error">{error}</p>}
    </>
  );
}

// --- CAL ----------------------------------------------------------------------

/**
 * Kalendar (CAL-010 / ADR-054): the semester's fixed dates the Semestar view
 * anchors to. A PROFILE fact stored through main, unlike the week start and
 * clock that stay in „Izgled" as device preferences — which is why this is its
 * own card rather than two more rows there.
 *
 * Save-on-SUBMIT, unlike the study card's commit-per-change, and deliberately:
 * the pair rule means a lone date is not a value anyone can store, so
 * committing per keystroke would either refuse loudly mid-edit or write a term
 * the user has not finished stating. „Ukloni datume" is the one-click clear —
 * a both-null save over the same channel.
 */
function CalendarSettingsPanel({ profileId, hits }: SettingsPanelProps) {
  const s = strings.settings.calendar;
  const [settings, setSettings] = useState<CalendarSettings | null>(null);
  const [startDraft, setStartDraft] = useState("");
  const [endDraft, setEndDraft] = useState("");
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  function adopt(next: CalendarSettings): void {
    setSettings(next);
    setStartDraft(next.semesterStart ?? "");
    setEndDraft(next.semesterEnd ?? "");
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await window.nexus.calendarSettings(profileId);
        if (active) adopt(next);
      } catch (loadError) {
        // Module-level strings, not the component's own `s` alias — the same
        // spelling `StudySettingsPanel`'s effect uses, so the dependency list
        // stays exactly `[profileId]`.
        if (active) setMessage({ text: strings.settings.calendar.error, failed: true });
        console.error("Nexus: failed to load calendar settings:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  async function write(next: CalendarSettings, confirmation: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      adopt(await window.nexus.setCalendarSettings(profileId, next));
      setMessage({ text: confirmation, failed: false });
    } catch (saveError) {
      setMessage({ text: s.error, failed: true });
      console.error("Nexus: failed to save calendar settings:", saveError);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    // The date inputs yield "" or a real day, so emptiness is the only
    // half-pair this form can produce; the order rule is the other thing worth
    // saying HERE, before main and the store refuse it less kindly.
    if (startDraft === "" || endDraft === "") {
      setMessage({ text: s.invalidPair, failed: true });
      return;
    }
    if (startDraft > endDraft) {
      setMessage({ text: s.invalidOrder, failed: true });
      return;
    }
    await write({ semesterStart: startDraft, semesterEnd: endDraft }, s.saved);
  }

  if (settings === null) {
    return message !== null ? (
      <p className="set__error">{message.text}</p>
    ) : (
      <p className="app__muted">{strings.app.loading}</p>
    );
  }

  const termStored = settings.semesterStart !== null && settings.semesterEnd !== null;

  return (
    <>
      <p className="set__section-caption">{s.caption}</p>
      <p
        className={labelClass(
          "set__section-caption",
          hits.has(settingsEntryId("calendar", "semester-dates")),
        )}
      >
        {s.datesLabel}
      </p>
      <form className="set__calendar-form" onSubmit={(event) => void submit(event)}>
        <TextField
          type="date"
          label={s.startLabel}
          value={startDraft}
          onChange={(event) => setStartDraft(event.target.value)}
        />
        <TextField
          type="date"
          label={s.endLabel}
          value={endDraft}
          onChange={(event) => setEndDraft(event.target.value)}
        />
        <div className="set__calendar-actions">
          <Button type="submit" size="sm" variant="primary" disabled={busy}>
            {s.save}
          </Button>
          {termStored && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void write({ semesterStart: null, semesterEnd: null }, s.cleared)}
            >
              {s.clear}
            </Button>
          )}
        </div>
      </form>
      {message !== null && (
        <p className={message.failed ? "set__error" : "set__section-caption"}>{message.text}</p>
      )}
    </>
  );
}

// --- PRIV ---------------------------------------------------------------------

/**
 * Privatne beleške (PRIV v1 / ADR-057): the two lock preferences and the
 * Recovery Kit status line. `priv:status` and `priv:set-lock-prefs` answer
 * FACTS, never contents, so this card is safe while the section is locked —
 * which is exactly when its auto-lock knob matters most. Before setup there is
 * nothing to configure and the card says so instead of drawing dead controls.
 */
function PrivSettingsPanel({ profileId, hits }: SettingsPanelProps) {
  const s = strings.settings.priv;
  const [status, setStatus] = useState<PrivStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await window.nexus.privStatus(profileId);
        if (active) setStatus(next);
      } catch (loadError) {
        if (active) setError(s.loadError);
        console.error("Nexus: failed to read the private section's status:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, s.loadError]);

  async function savePrefs(autoLockMinutes: number, lockOnMinimize: boolean): Promise<void> {
    setError(null);
    try {
      setStatus(await window.nexus.privSetLockPrefs(profileId, autoLockMinutes, lockOnMinimize));
    } catch (saveError) {
      setError(s.saveError);
      console.error("Nexus: failed to save private lock preferences:", saveError);
    }
  }

  if (status === null) {
    return error != null ? (
      <p className="set__error">{error}</p>
    ) : (
      <p className="app__muted">{strings.app.loading}</p>
    );
  }
  if (!status.setUp) {
    return (
      <>
        <p className="set__section-caption">{s.caption}</p>
        <p className="set__section-caption">{s.notSetUp}</p>
      </>
    );
  }

  return (
    <>
      <p
        className={labelClass(
          "set__section-caption",
          hits.has(settingsEntryId("priv", "kit-status")),
        )}
      >
        {s.caption}
      </p>
      <div className="set__security-block">
        <h3
          className={labelClass(
            "set__module-group-title",
            hits.has(settingsEntryId("priv", "auto-lock")),
          )}
        >
          {s.autoLockLabel}
        </h3>
        <p className="set__section-caption">{s.autoLockHint}</p>
        <select
          className="set__select"
          value={status.autoLockMinutes}
          aria-label={s.autoLockLabel}
          onChange={(event) => void savePrefs(Number(event.target.value), status.lockOnMinimize)}
        >
          {/* The store's whole 1..60 range (migration 045's CHECK) — the select IS the domain, not a curated subset of it. */}
          {Array.from({ length: 60 }, (_, index) => index + 1).map((minutes) => (
            <option key={minutes} value={minutes}>
              {`${s.autoLockOptionPrefix} ${minutes} ${s.minuteUnit}`}
            </option>
          ))}
        </select>
      </div>
      <div className="set__module-row">
        <div className="set__module-info">
          <span
            className={labelClass(
              "set__module-name",
              hits.has(settingsEntryId("priv", "lock-minimize")),
            )}
          >
            {s.lockOnMinimizeLabel}
          </span>
        </div>
        <Checkbox
          checked={status.lockOnMinimize}
          aria-label={s.lockOnMinimizeLabel}
          onChange={(event) => void savePrefs(status.autoLockMinutes, event.target.checked)}
        />
      </div>
      <p className="set__section-caption">
        {status.hasRecoveryKit ? s.kitStatusSet : s.kitStatusMissing}
      </p>
      {error != null && <p className="set__error">{error}</p>}
    </>
  );
}

// --- FIN ----------------------------------------------------------------------

/**
 * Finansije (FIN slice b): one control, the code the „Novi račun" form opens
 * on. A DEVICE preference on the Beleške/Zadaci recipe — `localStorage`, no
 * IPC — because the currency of the user's MONEY lives on each account and
 * never here; this only decides what a form is pre-filled with.
 *
 * The field commits on a valid code and says so when the text is not one,
 * rather than silently keeping the old value: the domain is ISO-4217, which
 * this app cannot enumerate into a select without inventing a curated list, so
 * the refusal is what a `choice` would otherwise have given for free.
 */
function FinanceSettingsPanel({ hits }: SettingsPanelProps) {
  const s = strings.settings.finance;
  const [draft, setDraft] = useState(() => readStoredPrimaryCurrency());
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  function commit(text: string): void {
    setDraft(text);
    const code = normalizeCurrencyInput(text);
    if (code === null) {
      setMessage({ text: s.invalidCurrency, failed: true });
      return;
    }
    persistPrimaryCurrency(code);
    setMessage({ text: s.saved, failed: false });
  }

  return (
    <>
      <p className="set__section-caption">{s.caption}</p>
      <div className="set__study-fields">
        <label className="set__study-field">
          <span
            className={labelClass(
              "set__study-label",
              hits.has(settingsEntryId("finance", "primary-currency")),
            )}
          >
            {s.primaryCurrencyLabel}
          </span>
          <input
            className="nx-textfield__input set__currency-input"
            value={draft}
            maxLength={3}
            spellCheck={false}
            autoComplete="off"
            aria-label={s.primaryCurrencyLabel}
            onChange={(event) => commit(event.target.value)}
            // A half-typed code is not a value; blur puts the stored one back
            // rather than leaving the field showing something nothing holds.
            onBlur={() => {
              setDraft(readStoredPrimaryCurrency());
              setMessage(null);
            }}
          />
          <span className="set__section-caption">{s.primaryCurrencyHint}</span>
        </label>
      </div>
      {message !== null && (
        <p className={message.failed ? "set__error" : "set__section-caption"}>{message.text}</p>
      )}
    </>
  );
}

// --- DOC ----------------------------------------------------------------------

/**
 * Datoteke (DOC): the shape the page opens in. `TasksSettingsPanel`'s recipe
 * verbatim — a closed segmented row over a device preference — because it is
 * the same kind of thing: how THIS machine draws one module, changing no stored
 * row.
 *
 * The page carries the same toggle for the current visit, which is why the
 * label here says „Podrazumevani": this card decides what it opens ON, not what
 * it must stay in.
 */
function FilesSettingsPanel({ hits }: SettingsPanelProps) {
  const s = strings.settings.files;
  const [view, setView] = useState<FileView>(() => readStoredFileView());

  return (
    <>
      <p className="set__section-caption">{s.caption}</p>
      <p className={labelClass("set__section-caption", hits.has(settingsEntryId("files", "view")))}>
        {s.viewLabel}
      </p>
      <div className="set__segmented" role="group" aria-label={s.viewLabel}>
        {FILE_VIEWS.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={view === option ? "primary" : "ghost"}
            aria-pressed={view === option}
            onClick={() => {
              persistFileView(option);
              setView(option);
            }}
          >
            {s.viewNames[option] ?? option}
          </Button>
        ))}
      </div>
      <p className="set__section-caption">{s.viewHint}</p>
    </>
  );
}

// --- HABIT --------------------------------------------------------------------

/**
 * Navike (HABIT slice c): the hour a reminder is filled in with when one is
 * switched on. `FilesSettingsPanel`'s recipe with a native time input instead of
 * a segmented row — the domain is 1440 minutes, which is neither enumerable into
 * a select nor invented into a curated list of „sensible" hours.
 *
 * It commits on every valid change, which a `type="time"` input makes total: the
 * control can only ever produce a real HH:MM or the empty string, and the empty
 * string is a half-typed value rather than a choice, so it is simply not stored.
 * That is what a `choice` gives for free elsewhere and what FIN's currency field
 * has to earn with a refusal message.
 */
function HabitsSettingsPanel({ hits }: SettingsPanelProps) {
  const s = strings.settings.habits;
  const [time, setTime] = useState(() => readStoredDefaultReminder());
  const [saved, setSaved] = useState(false);

  return (
    <>
      <p className="set__section-caption">{s.caption}</p>
      <div className="set__study-fields">
        <label className="set__study-field">
          <span
            className={labelClass(
              "set__study-label",
              hits.has(settingsEntryId("habits", "default-reminder")),
            )}
          >
            {s.defaultReminderLabel}
          </span>
          <input
            type="time"
            className="nx-textfield__input set__time-input"
            value={time}
            aria-label={s.defaultReminderLabel}
            onChange={(event) => {
              const next = event.target.value;
              setTime(next);
              // An empty field is the picker mid-edit, not a preference; the
              // stored value simply stays where it was until a real time lands.
              if (!isReminderTime(next)) return;
              persistDefaultReminder(next);
              setSaved(true);
            }}
          />
          <span className="set__section-caption">{s.defaultReminderHint}</span>
        </label>
      </div>
      {saved && <p className="set__section-caption">{s.saved}</p>}
    </>
  );
}

// --- UTIL ---------------------------------------------------------------------

/** The four fields, in the order the card draws them, each with the config key it edits and the strings key it is labelled by. */
const FOCUS_FIELDS: ReadonlyArray<{ key: keyof FocusConfig; entry: string; label: keyof typeof strings.settings.focus }> = [
  { key: "workMinutes", entry: "work-minutes", label: "workLabel" },
  { key: "shortBreakMinutes", entry: "short-break-minutes", label: "shortBreakLabel" },
  { key: "longBreakMinutes", entry: "long-break-minutes", label: "longBreakLabel" },
  { key: "cyclesBeforeLongBreak", entry: "cycles", label: "cyclesLabel" },
];

/**
 * Fokus (UTIL slice b): the Pomodoro shape — four numbers, on the FIN/HABIT
 * device-preference recipe (`localStorage`, no IPC). `focusPrefs.ts` carries the
 * argument for why these live on the machine rather than in the profile.
 *
 * **Validation is `validateFocusConfig`'s, and the reason it is worth routing
 * through the engine is the `field` it returns.** A boolean answer would leave
 * this card saying „nešto nije u redu" over four inputs; naming the offending
 * one lets the refusal appear under the input that caused it, which is the whole
 * difference between a form that teaches and a form that scolds. The bounds
 * themselves are never restated here — they belong to the module that owns them.
 *
 * The draft is TEXT rather than numbers, deliberately: a `<input type="number">`
 * bound to a number cannot represent „the user has cleared the field", and a
 * cleared field silently becoming 0 is exactly the state the engine then refuses
 * for reasons the user did not cause. So the whole quartet is validated on every
 * keystroke, saved when it is valid, and left alone — with the field named —
 * when it is not.
 */
function FocusSettingsPanel({ hits }: SettingsPanelProps) {
  const s = strings.settings.focus;
  const [draft, setDraft] = useState<Record<keyof FocusConfig, string>>(() => {
    const config = readStoredFocusConfig();
    return {
      workMinutes: String(config.workMinutes),
      shortBreakMinutes: String(config.shortBreakMinutes),
      longBreakMinutes: String(config.longBreakMinutes),
      cyclesBeforeLongBreak: String(config.cyclesBeforeLongBreak),
    };
  });
  /** Which field the engine refused, or null — `null` from a whole-shape refusal cannot point anywhere, so it points nowhere. */
  const [invalidField, setInvalidField] = useState<keyof FocusConfig | null>(null);
  const [saved, setSaved] = useState(false);

  function commit(key: keyof FocusConfig, text: string): void {
    const next = { ...draft, [key]: text };
    setDraft(next);
    setSaved(false);
    // `Number("")` is 0 and `Number("x")` is NaN; both are values the engine
    // refuses by name, so neither needs a guard of its own here.
    const result = validateFocusConfig({
      workMinutes: Number(next.workMinutes),
      shortBreakMinutes: Number(next.shortBreakMinutes),
      longBreakMinutes: Number(next.longBreakMinutes),
      cyclesBeforeLongBreak: Number(next.cyclesBeforeLongBreak),
    });
    if (!result.ok) {
      setInvalidField(result.field);
      return;
    }
    setInvalidField(null);
    persistFocusConfig(result.config);
    setSaved(true);
  }

  return (
    <>
      <p className="set__section-caption">{s.caption}</p>
      <div className="set__study-fields">
        {FOCUS_FIELDS.map((field) => (
          <label key={field.key} className="set__study-field">
            <span
              className={labelClass(
                "set__study-label",
                hits.has(settingsEntryId("focus", field.entry)),
              )}
            >
              {s[field.label]}
            </span>
            <input
              type="number"
              className="nx-textfield__input set__focus-input"
              value={draft[field.key]}
              inputMode="numeric"
              aria-label={s[field.label]}
              aria-invalid={invalidField === field.key}
              onChange={(event) => commit(field.key, event.target.value)}
              // A half-typed number is not a value; blur puts the STORED one
              // back rather than leaving the field showing something nothing
              // holds — `FinanceSettingsPanel`'s own rule, and the reason a
              // refusal here never survives leaving the field.
              onBlur={() => {
                const stored = readStoredFocusConfig();
                setDraft({
                  workMinutes: String(stored.workMinutes),
                  shortBreakMinutes: String(stored.shortBreakMinutes),
                  longBreakMinutes: String(stored.longBreakMinutes),
                  cyclesBeforeLongBreak: String(stored.cyclesBeforeLongBreak),
                });
                setInvalidField(null);
              }}
            />
            {invalidField === field.key && <span className="set__error">{s.invalid}</span>}
          </label>
        ))}
      </div>
      <p className="set__section-caption">{s.hint}</p>
      {saved && <p className="set__section-caption">{s.saved}</p>}
    </>
  );
}

// --- The registry-driven map --------------------------------------------------

/**
 * Module id → how to draw its settings card. The catalogue is the module
 * registry's (`manifest.settings`); this is the renderer half of the same
 * pairing, and `modules.test.ts` pins that the two agree — a declaration with
 * no renderer is an empty card, a renderer with no declaration is a card the
 * page never asks for.
 */
export const MODULE_SETTINGS_PANELS: Record<string, SettingsPanelRenderer> = {
  dashboard: { Body: DashboardSettingsPanel },
  tasks: { Body: TasksSettingsPanel, resetDevice: clearStoredTaskPreferences },
  calendar: { Body: CalendarSettingsPanel },
  notes: { Body: NotesSettingsPanel, resetDevice: clearStoredNotePreferences },
  priv: { Body: PrivSettingsPanel },
  files: { Body: FilesSettingsPanel, resetDevice: clearStoredFilePreferences },
  study: { Body: StudySettingsPanel },
  finance: { Body: FinanceSettingsPanel, resetDevice: clearStoredFinancePreferences },
  habits: { Body: HabitsSettingsPanel, resetDevice: clearStoredHabitPreferences },
  focus: { Body: FocusSettingsPanel, resetDevice: clearStoredFocusPreferences },
};

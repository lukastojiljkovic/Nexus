import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Disclosure,
  EmptyState,
  Icon,
  ListRow,
  NavItem,
  PageHeader,
  Select,
  TextArea,
  TextField,
  type IconName,
} from "@nexus/ui";
import {
  ARCHIVE_MODULE_IDS,
  buildLlmPrompt,
  buildProfilePlan,
  chordAccelerator,
  chordFromEvent,
  enabledPacks,
  findChordConflict,
  formatChord,
  isModifierKey,
  MODULE_NAV_CONFLICT,
  TOOL_RISK_CLASSES,
  validateArchivePassphrase,
  type ModuleRegistry,
  type ToolRiskClass,
} from "@nexus/core";
import { ACCENT_IDS, type AccentId } from "@nexus/tokens";
import {
  BACKUP_CADENCES,
  BACKUP_KEEP_LAST_CHOICES,
  CSV_IMPORT_COLUMN_ROLES,
  LLM_IMPORT_KINDS,
  LLM_IMPORT_MAX_ANSWER_LENGTH,
  LLM_PROMPT_LANGUAGES,
} from "../../shared/ipc.js";
import type {
  ApkgImportPreview,
  ApkgImportSkip,
  ApkgImportSubjectChoice,
  AppInfo,
  BackupSettingsView,
  CsvImportColumnRole,
  CsvImportDelimiter,
  CsvImportListChoice,
  CsvImportPlanPreview,
  CsvImportPreview,
  FlagState,
  IcsImportPreview,
  IcsImportSkip,
  IcsImportSkippedComponent,
  ImportDuplicateChoice,
  ImportDuplicateChoices,
  ImportDuplicateGroup,
  ImportDuplicateType,
  ImportPreview,
  ImportSkipReason,
  LlmImportDeckChoice,
  LlmImportKind,
  LlmImportPreview,
  LlmImportSkip,
  LlmPromptLanguage,
  MarkdownImportResult,
  MarkdownImportSource,
  NoteFolder,
  NotificationSource,
  PrivateNotesExportSkip,
  Profile,
  ProfileKind,
  RestoreModuleCounts,
  RestorePreview,
  RestoreProblem,
  Subject,
  TaskList,
} from "../../shared/ipc.js";
import { LOCKED_MODULE_IDS } from "../../shared/modules.js";
import { authErrorMessage, passcodeMeetsPolicy, RecoveryKitPanel } from "./AuthGate.js";
import { ALL_NOTIFICATION_SOURCES, NOTIFICATION_PRESETS } from "./notificationFormat.js";
import { NotificationSettingsControls } from "./NotificationSettingsControls.js";
import { DEFAULT_THEME_PREFERENCE, type ThemePreference } from "./theme.js";
import { AUTO_LOCK_MINUTES, type AutoLockMinutes } from "./autoLock.js";
import {
  isGlobalShortcutAction,
  resolveShortcuts,
  shortcutActionLabel,
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  type ShortcutOverrides,
} from "./shortcuts.js";
import { Kbd } from "./ShortcutsDialog.js";
import { clearStoredAccent, persistAccent, readStoredAccent } from "./accent.js";
import { ProfileAvatar } from "./profileAvatar.js";
import { ProPackList } from "./ProPacks.js";
import { resolveModuleSelection } from "../../shared/onboardingPresets.js";
import { heardTrades, planReasonLines } from "./profilePlanCopy.js";
import { clearStoredSignals, readStoredSignals } from "./signalPrefs.js";
import { profileDisplayName } from "./profilePrefs.js";
import {
  clearStoredWeekStart,
  persistWeekStart,
  readStoredWeekStart,
  type WeekStartPreference,
} from "./weekStart.js";
import {
  clearStoredCalendarPreferences,
  CLOCK_PREFERENCES,
  EVENT_DURATIONS,
  persistClock,
  persistEventDuration,
  readStoredClock,
  readStoredEventDuration,
  type ClockPreference,
  type EventDurationMinutes,
} from "./calendarPrefs.js";
import { SettingsResetDialog } from "./SettingsResetDialog.js";
import {
  buildSettingsIndex,
  foldSettingsQuery,
  labelClass,
  matchSettings,
  moduleEntryId,
  sectionClass,
  shortcutEntryId,
} from "./settingsSearch.js";
import { isDeviceOnlyPanel, moduleSettingsCards } from "./moduleSettings.js";
import { MODULE_SETTINGS_PANELS } from "./moduleSettingsPanels.js";
import { moduleIconName } from "./moduleIcon.js";
import {
  persistLlmImportKind,
  persistLlmPromptLanguage,
  readStoredLlmImportKind,
  readStoredLlmPromptLanguage,
} from "./llmImportPrefs.js";
import { FinCsvImportSection } from "./FinCsvImport.js";
import { collator } from "./intl.js";
// Type-only, and that is load-bearing: a value import would pull ~650 KB of
// notice text into the eager renderer chunk. `LicencesSection` reaches for the
// data with `import()` instead. A type import is erased, so this line costs
// nothing at runtime.
import type { LicenceEntry } from "./licences.js";
import { applyLocale, countUnit, dayUnit, fill, lookup, strings, type Locale } from "./strings.js";
import {
  availableLocales,
  clearStoredLocale,
  persistLocale,
  readStoredLocale,
  reportLocaleToMain,
} from "./localePrefs.js";
import { useFocusTrap } from "./useFocusTrap.js";
import { moduleName } from "./moduleName.js";
import { formatArchiveInstant } from "./timeFormat.js";
import { SyncSection } from "./SyncSettings.js";
import {
  SETTINGS_CATEGORIES,
  categoryOf,
  subPageListById,
  visibleSections,
  type CategoryId,
  type SettingsLocation,
} from "./settingsCategories.js";

const THEME_OPTIONS: ThemePreference[] = ["system", "dan", "noc"];

/** DOM id prefix for a section card, so the screenshot harness can reach one by section id alone. */
const SECTION_DOM_PREFIX = "set-section-";

function sectionDomId(sectionId: string): string {
  return `${SECTION_DOM_PREFIX}${sectionId}`;
}

/**
/**
 * SET-015: the width at which „Podešavanja" turns its category rail into a
 * second column.
 *
 * A CONTAINER width, not a viewport one — the app sidebar claims 220px of the
 * window before this page sees anything, so the viewport is the wrong measure
 * of „is there room for two columns here". The number is the same one the CSS
 * states in `styles/settings.css`; the layout itself is a container query, and
 * this copy exists only so the default LOCATION can be chosen in the wide
 * layout's terms (see the effect below).
 */
const WIDE_LAYOUT_MIN_PX = 760;

/**
 * Where „Podešavanja" was when the page was last left, for the session only.
 *
 * Module-level rather than stored: coming back inside one session should land
 * where the reader was, and nothing about that belongs on disk — a category is
 * a browsing position, not a preference, exactly like a module page's open
 * tab. Deliberately not per profile either: the position describes this
 * session's reading, and a profile switch is a different session.
 */
let lastSettingsLocation: SettingsLocation | null = null;

/**
 * The category the two-column layout opens on when nothing else was chosen.
 * „Profil i sigurnost" is first in the table's order and is the page's own
 * subject.
 */
const DEFAULT_CATEGORY: CategoryId = "profile";

/**
 * The nearest scroll container above `node`, or null when the page is not in
 * one.
 *
 * „Scroll the page's scroll container to the top" cannot name a class: the
 * scroller belongs to the SHELL (`.app__main`), and a page that spelled it
 * would break the day the shell renamed it. The walk asks the only question
 * that matters — which ancestor actually scrolls this page — and reads the
 * answer off the computed style, which stays true whatever the shell calls it.
 */
function scrollContainerOf(node: HTMLElement | null): HTMLElement | null {
  for (
    let element = node?.parentElement ?? null;
    element !== null;
    element = element.parentElement
  ) {
    const overflowY = getComputedStyle(element).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return element;
  }
  return null;
}

/** How many of the currently visible cards belong to one category — the rail's badge while a query is active. */
function categoryHitCount(category: CategoryId, cards: ReadonlySet<string>): number {
  let count = 0;
  for (const sectionId of cards) if (categoryOf(sectionId) === category) count += 1;
  return count;
}

/**
 * A rail item's badge: the bare count for the eye and the counted sentence for
 * a reader.
 *
 * The number is `aria-hidden` and the sentence is `.nx-sr-only`, because the
 * two say the same thing — a reader who heard „4, 4 rezultata" would be told
 * twice. `searchResultCountOne`/`Many` carry the Serbian numeral agreement and
 * `dayUnit` picks between them, exactly as the backup result line does.
 */
function railCountBadge(count: number): ReactNode {
  const s = strings.settings;
  return (
    <>
      <span aria-hidden="true">{count}</span>
      <span className="nx-sr-only">
        {fill(dayUnit(count, s.searchResultCountOne, s.searchResultCountMany), { n: count })}
      </span>
    </>
  );
}

/**
 * One row of a sub-page list — „Podešavanja modula" or „Uvoz i izvoz".
 *
 * A `ListRow` whose content is a real `<button>`: the row's own click handler
 * makes the whole width the target, the button is what Tab reaches and what
 * Enter and Space activate, and the button stops the click from bubbling so
 * the two paths fire the handler exactly once. `data-settings-sub` rides the
 * button, so the screenshot harness clicks the same control a user does.
 */
function SubPageListRow({
  id,
  icon,
  label,
  onOpen,
}: {
  id: string;
  /** The module's own mark; `undefined` when the icon table does not cover it, which is its documented answer. */
  icon: IconName | undefined;
  label: string;
  onOpen: () => void;
}) {
  return (
    <ListRow
      leading={icon !== undefined ? <Icon name={icon} size={16} /> : undefined}
      trailing={<Icon name="chevronRight" size={16} />}
      onClick={onOpen}
    >
      <button
        type="button"
        className="set__nav-row"
        data-settings-sub={id}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      >
        {label}
      </button>
    </ListRow>
  );
}

/**
 * One row of the narrow layout's root list: a category, the one line that says
 * what it holds, and the chevron that promises a page behind it.
 *
 * The same button-inside-a-row shape as {@link SubPageListRow}, with the
 * summary as a second line — the root list is the only place on this page with
 * room to say what a category contains before it is opened.
 */
function CategoryListRow({
  id,
  icon,
  title,
  summary,
  onOpen,
}: {
  id: string;
  icon: IconName;
  title: string;
  summary: string;
  onOpen: () => void;
}) {
  return (
    <ListRow
      leading={<Icon name={icon} size={16} />}
      trailing={<Icon name="chevronRight" size={16} />}
      onClick={onOpen}
    >
      <button
        type="button"
        className="set__nav-row set__nav-row--stacked"
        data-settings-category={id}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      >
        <span className="set__nav-row-title">{title}</span>
        <span className="nx-hint">{summary}</span>
      </button>
    </ListRow>
  );
}

function themeOptionLabel(option: ThemePreference): string {
  if (option === "system") return strings.settings.appearance.system;
  return option === "dan" ? strings.app.themeDan : strings.app.themeNoc;
}

/** PRD 04 §5, Ponedeljak first — the default, and the order a Serbian week is read in. */
const WEEK_START_OPTIONS: WeekStartPreference[] = ["monday", "sunday"];

/**
 * The card currently being reset (SET §5): its section id and its own title,
 * which is the only thing the confirmation dialog needs to name it.
 *
 * „Izgled“ is the shell's own resettable card; every other one is a MODULE's,
 * and which of those offer a reset is decided by their declaration rather than
 * by a list here — a panel whose values all live on this device offers it, and
 * one holding profile rows never does, because resetting those would be a write
 * about the user's DATA rather than about this machine (`isDeviceOnlyPanel`).
 */
interface ResetTarget {
  id: string;
  title: string;
}

/**
 * The quiet link at the foot of a resettable card. Typographic and muted,
 * exactly like `Disclosure` without the triangle — a reset is available, not
 * advertised — and a plain `<button>` for as long as `Button` had only
 * bordered variants, since a bordered control here would read heavier than
 * the settings it undoes. It has `quiet` now, so the class keeps only where
 * this one SITS: the primitive owns the look and the pointer floor.
 */
function ResetLink({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="quiet" className="set__reset" onClick={onClick}>
      {strings.settings.reset.action}
    </Button>
  );
}

function sameSourceSet(a: readonly NotificationSource[], b: readonly NotificationSource[]): boolean {
  return a.length === b.length && a.every((source) => b.includes(source));
}

const NAME_MAX = 80;

interface ProfileSectionProps {
  profileId: string;
  initialName: string;
  /** The profile's picture hash as the shell currently knows it (SET-001), or null. */
  initialPictureHash: string | null;
  onProfileRenamed: (name: string) => void;
  /** Reflects a picture change in the shell, so the sidebar's own avatar follows the Settings page. */
  onProfilePictureChanged: (pictureHash: string | null) => void;
  /** SET-014 search hits; the section reads only its own entry ids out of it. */
  hits: ReadonlySet<string>;
}

/**
 * Profil section: the profile's name (same 1–80-char rule as Onboarding) and
 * its picture (SET-001).
 *
 * The renderer validates nothing about the picture and never sees one — every
 * button here is a request to main, which owns the picker, the size gate, the
 * MIME sniff, the decode/crop/resize/re-encode and the blob store (SEC-EL). A
 * refused pick comes back as a NAMED reason and is shown as such.
 *
 * The caption states the automatic square crop plainly. There is no crop
 * handle to drag, and that is a decision rather than a gap: an interactive crop
 * needs the image bytes in the renderer, which is precisely the thing this
 * pipeline is built not to do (see `main/profilePicture.ts`). Saying so in one
 * short sentence is more honest than a control that pretends to more choice
 * than the app is willing to offer.
 */
function ProfileSection({
  profileId,
  initialName,
  initialPictureHash,
  onProfileRenamed,
  onProfilePictureChanged,
  hits,
}: ProfileSectionProps) {
  const s = strings.settings.profile;
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pictureHash, setPictureHash] = useState<string | null>(initialPictureHash);
  const [pictureBusy, setPictureBusy] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= NAME_MAX;

  async function save(): Promise<void> {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await window.nexus.renameProfile(profileId, trimmed);
      setName(trimmed);
      onProfileRenamed(trimmed);
    } catch (renameError) {
      setError(s.saveError);
      console.error("Nexus: failed to rename profile:", renameError);
    } finally {
      setSaving(false);
    }
  }

  /** Adopts a profile main just answered with — one place, so the local state and the shell's can never disagree. */
  function adopt(hash: string | null): void {
    setPictureHash(hash);
    onProfilePictureChanged(hash);
  }

  async function pickPicture(): Promise<void> {
    setPictureBusy(true);
    setPictureError(null);
    try {
      const result = await window.nexus.pickProfilePicture(profileId);
      if (result.status === "ok") adopt(result.profile.pictureHash);
      else if (result.status === "rejected") setPictureError(s.pictureRejected[result.code]);
    } catch (pickError) {
      setPictureError(s.pictureError);
      console.error("Nexus: failed to pick a profile picture:", pickError);
    } finally {
      setPictureBusy(false);
    }
  }

  async function removePicture(): Promise<void> {
    setPictureBusy(true);
    setPictureError(null);
    try {
      adopt((await window.nexus.clearProfilePicture(profileId)).pictureHash);
    } catch (clearError) {
      setPictureError(s.pictureError);
      console.error("Nexus: failed to clear the profile picture:", clearError);
    } finally {
      setPictureBusy(false);
    }
  }

  return (
    <>
      <div className="set__row">
        <TextField
          // The hit class lands on the field WRAPPER (that is where TextField
          // puts className), so the stylesheet reaches the label through it —
          // colouring the wrapper itself would bleed into the input's own text.
          className={hits.has("profile-name") ? "set__hit-field" : ""}
          label={strings.settings.profile.nameLabel}
          value={name}
          maxLength={NAME_MAX}
          onChange={(event) => setName(event.target.value)}
        />
        <Button size="sm" variant="primary" disabled={!valid || saving} onClick={() => void save()}>
          {strings.settings.profile.save}
        </Button>
      </div>
      {error != null && <p className="set__error">{error}</p>}

      <div className="set__avatar-row">
        {/* Live: the avatar shows the name being typed, so the initials
            fallback answers to the field above it rather than to whatever was
            last saved. */}
        <ProfileAvatar name={trimmed} pictureHash={pictureHash} size="md" />
        <div className="set__avatar-side">
          <span className={labelClass("set__avatar-label", hits.has("profile-picture"))}>
            {s.pictureLabel}
          </span>
          <div className="set__avatar-actions">
            <Button size="sm" disabled={pictureBusy} onClick={() => void pickPicture()}>
              {s.pickPicture}
            </Button>
            {pictureHash !== null && (
              // Quiet danger: the destructive action is named in the danger hue
              // without being a filled red button — removing a picture is
              // reversible in one click, so it must not shout.
              <Button
                size="sm"
                className="set__avatar-remove"
                disabled={pictureBusy}
                onClick={() => void removePicture()}
              >
                {s.removePicture}
              </Button>
            )}
          </div>
          <p className="nx-hint">{s.pictureCaption}</p>
          {pictureError != null && <p className="set__error">{pictureError}</p>}
        </div>
      </div>
    </>
  );
}

interface ProfileDeleteDialogProps {
  profile: Profile;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * „Obriši profil“ (ADR-058 §4) — the ADR-048 typed-name idiom on the house
 * dialog recipe: the warning is read before the field, intent is proved by
 * typing the profile's DISPLAY name (for an unnamed business profile that is
 * „Posao“, its fallback label everywhere else too), and the danger button
 * stays disabled until the text matches. Escape, the backdrop and „Otkaži“
 * all cancel. The typed name is a UX gate only: main re-refuses the personal
 * anchor and the last profile, whatever this dialog was talked into.
 */
function ProfileDeleteDialog({ profile, busy, error, onConfirm, onCancel }: ProfileDeleteDialogProps) {
  const s = strings.settings.profiles;
  const displayName = profileDisplayName(profile);
  const [confirmText, setConfirmText] = useState("");
  const titleId = useId();
  const questionId = useId();

  // Focus lands on the typed-name field — the trap's own default (the first
  // tabbable descendant), which `autoFocus` used to do less reliably (and
  // without cycling Tab inside the panel or returning focus on close).
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  const match = confirmText.trim() === displayName;

  // Ignored while the delete is in flight, so a cancel cannot close the dialog
  // out from under the call and hide the error line the failure would land in.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  return createPortal(
    <div className="recur-dialog__overlay">
      <div
        className="recur-dialog__backdrop"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div
        ref={panelRef}
        className="recur-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={questionId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.deleteTitle}
        </h2>
        <p className="recur-dialog__name">„{displayName}“</p>
        <p id={questionId} className="nx-hint">
          {s.deleteWarning}
        </p>
        <form
          className="app__profile-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (match && !busy) onConfirm();
          }}
        >
          <TextField
            label={s.deleteConfirmLabel}
            placeholder={s.deleteConfirmPlaceholder}
            value={confirmText}
            maxLength={NAME_MAX}
            required
            onChange={(event) => setConfirmText(event.target.value)}
          />
          {error != null && (
            <p className="set__error" role="alert">
              {error}
            </p>
          )}
          <div className="recur-dialog__actions app__profile-dialog-actions">
            <Button type="button" className="recur-dialog__cancel" disabled={busy} onClick={onCancel}>
              {s.deleteCancel}
            </Button>
            <Button type="submit" variant="danger" disabled={busy || !match}>
              {s.deleteSubmit}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

interface ProfilesSectionProps {
  profiles: Profile[];
  activeProfileId: string;
  /** App creates (and seeds the bordo accent for) the business profile; the row lands in the shell's own list. */
  onCreateBusiness: () => Promise<Profile>;
  /** Opens the shell's passcode gate (AUTH-024) aimed at this profile — the same dialog every switch passes. */
  onRequestSwitch: (profile: Profile) => void;
  /** App owns the delete: an ACTIVE profile is moved to personal first, then the wire is asked. Rejections land back here. */
  onDelete: (profile: Profile) => Promise<void>;
}

/**
 * „Profili“ card (SET-003 / ADR-058 §4): the account's profiles — name, kind
 * chip, active marker — plus the ONE business profile v1 allows and the delete
 * that never touches the personal anchor. The create hands over the EMPTY name
 * deliberately: that is the ONB-lite "not yet named" sentinel, and the notice
 * under the fresh row says so out loud. Everything destructive or
 * identity-changing goes through App: switching needs the passcode gate,
 * deleting may need to evict the active profile first.
 */
function ProfilesSection({
  profiles,
  activeProfileId,
  onCreateBusiness,
  onRequestSwitch,
  onDelete,
}: ProfilesSectionProps) {
  const s = strings.settings.profiles;
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Profile | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const hasBusiness = profiles.some((profile) => profile.kind === "business");

  async function create(): Promise<void> {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      setCreated(await onCreateBusiness());
    } catch (error) {
      setCreateError(strings.profiles.createError);
      console.error("Nexus: failed to create the business profile:", error);
    } finally {
      setCreating(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (deleting === null || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await onDelete(deleting);
      // The offer to switch into a profile that no longer exists dies with it.
      setCreated((current) => (current?.id === deleting.id ? null : current));
      setDeleting(null);
    } catch (error) {
      setDeleteError(s.deleteError);
      console.error("Nexus: failed to delete the profile:", error);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <>
      <p className="nx-hint">{s.caption}</p>
      <div className="set__module-list">
        {profiles.map((profile) => {
          const isActive = profile.id === activeProfileId;
          return (
            <div className="set__module-row" key={profile.id}>
              <div className="set__module-info">
                <span className="set__profile-name-row">
                  {/* Active = gold text + weight, the active-nav discipline — never a pill. */}
                  <span className={isActive ? "set__module-name set__profile-active" : "set__module-name"}>
                    {profileDisplayName(profile)}
                  </span>
                  {profile.kind === "business" && <Chip>{strings.profiles.businessLabel}</Chip>}
                </span>
                {isActive && <span className="nx-hint">{s.activeMarker}</span>}
              </div>
              {/* Business only, and never the last profile: the personal anchor
                  is undeletable by design, so the action simply is not offered
                  there — main re-refuses regardless. */}
              {profile.kind === "business" && profiles.length > 1 && (
                <Button
                  size="sm"
                  className="set__avatar-remove"
                  disabled={deleteBusy}
                  onClick={() => {
                    setDeleting(profile);
                    setDeleteError(null);
                  }}
                >
                  {s.delete}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {/* ONE business profile per account (the ADR's v1 limit): the offer exists exactly while none does. */}
      {!hasBusiness && (
        <div className="set__avatar-actions">
          <Button size="sm" disabled={creating} onClick={() => void create()}>
            {strings.profiles.createBusiness}
          </Button>
        </div>
      )}
      {created != null && (
        <div className="set__row">
          <p className="nx-hint">{s.createdNotice}</p>
          <Button size="sm" variant="primary" onClick={() => onRequestSwitch(created)}>
            {s.switchToNew}
          </Button>
        </div>
      )}
      {createError != null && <p className="set__error">{createError}</p>}

      {deleting !== null && (
        <ProfileDeleteDialog
          profile={deleting}
          busy={deleteBusy}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/**
 * The archive modules, in the order the export picker, the restore table and
 * the import report all show them.
 *
 * **`ARCHIVE_MODULE_IDS` itself, never a copy of it**, and it used to be a
 * copy: the same names typed out a second time, in the same order, drifting
 * silently the first time the interchange gained a module. It had already
 * drifted — ELEC made the vocabulary eleven and this list still held ten, so
 * „Šta se izvozi" offered ten boxes, every box ticked meant ten, and a full
 * export left every circuit out of the archive without saying so. There is
 * nothing to notice: a list that is merely SHORT is a perfectly valid list,
 * and the array that decides what is exported (`runExport`) is this one.
 *
 * The annotation keeps the two vocabularies the same set going the other way
 * — an interchange module this page cannot count would not compile — and
 * `archiveModules.test.ts` asks the question a type cannot: whether every one
 * of them has a Serbian name to render.
 */
const ARCHIVE_MODULES: readonly (keyof RestoreModuleCounts)[] = ARCHIVE_MODULE_IDS;

interface BackupSectionProps {
  profileId: string;
}

/**
 * Rezervna kopija section (IMEX slice a1, extended by ADR-022): a full-export
 * button over `window.nexus.exportData`, gated by an encrypt-by-default
 * choice. Checked (default): a passphrase pair, validated the same way main
 * will re-validate it. Unchecked: the plaintext path stays reachable only
 * through its own separate, unchecked-by-default confirmation — the export
 * button is disabled until that box is ticked, so shipping data in the clear
 * is always something the user opts into, never something they click past.
 *
 * „Šta se izvozi“ (IMEX-003) is the quiet third choice: a disclosure over one
 * checkbox per archive module, every box ticked, closed until the user wants
 * it — the default is the whole profile, and a picker that shouted would make
 * a decision out of something almost nobody needs to make. Unticking every box
 * disables the button rather than silently exporting everything; main refuses
 * the empty array too, since the disabled button is UX and never the gate.
 */
function BackupSection({ profileId }: BackupSectionProps) {
  const s = strings.settings.backup;

  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState<{
    path: string;
    totalRecords: number;
    missingAttachments: number;
    encrypted: boolean;
    /** How many private notes rode in the archive (ADR-057 §6) — zero whenever they did not. */
    privateNotes: number;
    /** Why the private section did NOT ride, or null — exactly one skip sentence is ever shown. */
    privateNotesSkipped: PrivateNotesExportSkip | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [encrypt, setEncrypt] = useState(true);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [plaintextConfirmed, setPlaintextConfirmed] = useState(false);

  const [modulesOpen, setModulesOpen] = useState(false);
  const [modules, setModules] = useState<ReadonlySet<keyof RestoreModuleCounts>>(
    () => new Set(ARCHIVE_MODULES),
  );

  function toggleModule(module: keyof RestoreModuleCounts): void {
    setModules((chosen) => {
      const next = new Set(chosen);
      if (!next.delete(module)) next.add(module);
      return next;
    });
  }

  async function runExport(): Promise<void> {
    if (running) return;
    setError(null);
    setSaved(null);

    if (encrypt) {
      const problem = validateArchivePassphrase(passphrase);
      if (problem === "tooShort") {
        setError(s.passphraseTooShort);
        return;
      }
      if (problem === "tooLong") {
        setError(s.passphraseTooLong);
        return;
      }
      if (passphrase !== confirmPassphrase) {
        setError(s.passphraseMismatch);
        return;
      }
    }

    setRunning(true);
    try {
      // The chosen modules in the canonical order, never the Set's insertion
      // order — a picker that unticked and re-ticked a box would otherwise send
      // a differently-ordered list for the same choice.
      const outcome = await window.nexus.exportData(
        profileId,
        encrypt ? passphrase : null,
        ARCHIVE_MODULES.filter((module) => modules.has(module)),
      );
      if (!outcome.canceled) {
        setSaved({
          path: outcome.path,
          totalRecords: outcome.totalRecords,
          missingAttachments: outcome.missingAttachments,
          encrypted: outcome.encrypted,
          privateNotes: outcome.privateNotes,
          privateNotesSkipped: outcome.privateNotesSkipped,
        });
      }
    } catch (exportError) {
      setError(s.error);
      console.error("Nexus: failed to export data:", exportError);
    } finally {
      setRunning(false);
      // A used passphrase has no business surviving in component state,
      // whether the export succeeded, was canceled, or failed.
      setPassphrase("");
      setConfirmPassphrase("");
      // The plaintext confirmation is consumed along with it. Left standing,
      // it would arm the NEXT export too: one click, another copy of every
      // note in the clear, with the deliberate act it was meant to require
      // already spent on a different file.
      setPlaintextConfirmed(false);
    }
  }

  const disabled = running || (!encrypt && !plaintextConfirmed) || modules.size === 0;

  return (
    <>
      <p className="nx-hint">{s.description}</p>
      <Disclosure
        label={s.modulesToggle}
        open={modulesOpen}
        onToggle={setModulesOpen}
        summary={
          modules.size === ARCHIVE_MODULES.length
            ? s.modulesAll
            : `${modules.size}/${ARCHIVE_MODULES.length}`
        }
      >
        <div className="set__module-picker">
          {ARCHIVE_MODULES.map((module) => (
            <Checkbox
              key={module}
              checked={modules.has(module)}
              onChange={() => toggleModule(module)}
            >
              {strings.settings.restore.modules[module]}
            </Checkbox>
          ))}
        </div>
      </Disclosure>
      {modules.size === 0 && <p className="nx-hint">{s.modulesEmpty}</p>}
      <Checkbox
        checked={encrypt}
        onChange={(event) => {
          setEncrypt(event.target.checked);
          // Turning encryption back on drops any plaintext confirmation with
          // it: otherwise it survives as hidden state and silently re-arms the
          // button the moment the box is unticked again.
          if (event.target.checked) setPlaintextConfirmed(false);
        }}
      >
        {s.encryptLabel}
      </Checkbox>
      {encrypt ? (
        <>
          <div className="set__security-form">
            <TextField
              type="password"
              label={s.passphraseLabel}
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
            <TextField
              type="password"
              label={s.passphraseConfirmLabel}
              value={confirmPassphrase}
              onChange={(event) => setConfirmPassphrase(event.target.value)}
            />
          </div>
          <p className="nx-hint">{s.passphraseHint}</p>
          <p className="nx-hint">{s.encryptedNotice}</p>
        </>
      ) : (
        <>
          <p className="nx-hint">{s.plaintextNotice}</p>
          <Checkbox
            checked={plaintextConfirmed}
            onChange={(event) => setPlaintextConfirmed(event.target.checked)}
          >
            {s.plaintextConfirmLabel}
          </Checkbox>
        </>
      )}
      <Button
        size="sm"
        variant="primary"
        className="set__export"
        disabled={disabled}
        onClick={() => void runExport()}
      >
        {s.exportButton}
      </Button>
      {saved != null && (
        <p className="nx-hint">
          {s.savedPrefix} <span className="app__path">{saved.path}</span> (
          {saved.totalRecords} {dayUnit(saved.totalRecords, s.recordsUnitOne, s.recordsUnitMany)}
          {saved.encrypted ? <> · {s.savedEncryptedSuffix}</> : null})
        </p>
      )}
      {saved != null && saved.missingAttachments > 0 && (
        <p className="set__error">
          {s.missingAttachmentsPrefix} {saved.missingAttachments}{" "}
          {dayUnit(saved.missingAttachments, s.missingAttachmentsUnitOne, s.missingAttachmentsUnitMany)}{" "}
          {s.missingAttachmentsSuffix}
        </p>
      )}
      {/* ADR-057 §6: the private section's fate, stated whenever there was one
          to decide about — included with its count, or excluded with the named
          reason. Never both: the result carries a count XOR a skip. */}
      {saved != null && saved.privateNotes > 0 && (
        <p className="nx-hint">
          {s.privateNotesIncludedPrefix} ({saved.privateNotes}).
        </p>
      )}
      {saved != null && saved.privateNotesSkipped != null && (
        <p className="set__error">
          {saved.privateNotesSkipped === "locked"
            ? s.privateNotesSkippedLocked
            : s.privateNotesSkippedPlaintext}
        </p>
      )}
      {error != null && <p className="set__error">{error}</p>}
    </>
  );
}

interface AutoBackupSectionProps {
  profileId: string;
  hits: ReadonlySet<string>;
}

/**
 * Automatska rezervna kopija (SET-011 / ADR-056): the scheduled half of the
 * same "Rezervna kopija" card — enable + cadence, the folder main's native
 * directory picker chose, how many archives retention keeps, the write-only
 * passphrase, a manual „Napravi odmah", and the last run's recorded outcome.
 *
 * Every mutation answers the whole `BackupSettingsView`, so this component
 * never guesses at state main owns — including after „Napravi odmah", whose
 * answer carries the run's own recorded status line.
 *
 * The passphrase is validated exactly as `BackupSection` validates the manual
 * export's (same `validateArchivePassphrase`, same sentences), sent once, and
 * cleared from component state success or failure — it is never pre-filled and
 * never comes back from main in any form (`passphraseSet` is all the card
 * knows). The enable toggle stays disabled until a folder AND a passphrase
 * exist; main and the store refuse the same transition, so the disabled state
 * is UX, never the gate (SEC-EL-02).
 */
function AutoBackupSection({ profileId, hits }: AutoBackupSectionProps) {
  const s = strings.settings.autoBackup;
  const b = strings.settings.backup;

  const [settings, setSettings] = useState<BackupSettingsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");

  useEffect(() => {
    let cancelled = false;
    window.nexus
      .backupSettings(profileId)
      .then((view) => {
        if (!cancelled) setSettings(view);
      })
      .catch((loadError: unknown) => {
        console.error("Nexus: failed to read backup settings:", loadError);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  async function mutate(action: () => Promise<BackupSettingsView>): Promise<void> {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      setSettings(await action());
    } catch (actionError) {
      setError(s.error);
      console.error("Nexus: backup settings action failed:", actionError);
    } finally {
      setBusy(false);
    }
  }

  async function savePassphrase(): Promise<void> {
    setError(null);
    const problem = validateArchivePassphrase(passphrase);
    if (problem === "tooShort") {
      setError(b.passphraseTooShort);
      return;
    }
    if (problem === "tooLong") {
      setError(b.passphraseTooLong);
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError(b.passphraseMismatch);
      return;
    }
    const value = passphrase;
    // Cleared BEFORE the call resolves, not after: a used passphrase has no
    // business surviving in component state (`BackupSection`'s hygiene rule),
    // and a failed save should re-ask rather than silently retry a held copy.
    setPassphrase("");
    setConfirmPassphrase("");
    await mutate(() => window.nexus.setBackupPassphrase(profileId, value));
  }

  if (settings === null) {
    return (
      <div className="set__restore-block">
        <h3 className={labelClass("nx-eyebrow set__module-group-title", hits.has("backup-auto"))}>{s.title}</h3>
        <p className="nx-hint">{strings.app.loading}</p>
      </div>
    );
  }

  const configured = settings.folderPath !== null && settings.passphraseSet;
  const schedule = { enabled: settings.enabled, cadence: settings.cadence, keepLast: settings.keepLast };

  return (
    <div className="set__restore-block">
      <h3 className={labelClass("nx-eyebrow set__module-group-title", hits.has("backup-auto"))}>{s.title}</h3>
      <p className="nx-hint">{s.description}</p>

      {/* A boolean preference is the module gallery's row, not a labelled
          checkbox floating in a card: name on the left, why-it-is-off under it,
          the box on the trailing edge with every other control on the page. */}
      <div className="set__module-row">
        <div className="set__module-info">
          <span className="set__module-name">{s.enableLabel}</span>
          {!configured && <span className="nx-hint">{s.enableHint}</span>}
        </div>
        <Checkbox
          checked={settings.enabled}
          aria-label={s.enableLabel}
          disabled={busy || (!settings.enabled && !configured)}
          onChange={(event) =>
            void mutate(() =>
              window.nexus.setBackupSettings(profileId, {
                ...schedule,
                enabled: event.target.checked,
              }),
            )
          }
        />
      </div>

      <div className="set__field">
        <p className="nx-hint">{s.cadenceLabel}</p>
        <div className="set__segmented" role="group" aria-label={s.cadenceLabel}>
          {BACKUP_CADENCES.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={settings.cadence === option ? "primary" : "ghost"}
              aria-pressed={settings.cadence === option}
              disabled={busy}
              onClick={() =>
                void mutate(() =>
                  window.nexus.setBackupSettings(profileId, { ...schedule, cadence: option }),
                )
              }
            >
              {s.cadenceOptions[option]}
            </Button>
          ))}
        </div>
      </div>

      <div className="set__field">
        <p className="nx-hint">{s.folderLabel}</p>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => void mutate(() => window.nexus.pickBackupFolder(profileId))}
        >
          {s.folderPick}
        </Button>
        {settings.folderPath !== null ? (
          <p className="nx-hint">
            <span className="app__path">{settings.folderPath}</span>
          </p>
        ) : (
          <p className="nx-hint">{s.folderNone}</p>
        )}
      </div>

      <div className="set__field">
        <Select
          label={s.keepLastLabel}
          layout="inline"
          className="set__select"
          value={settings.keepLast}
          disabled={busy}
          onChange={(event) =>
            void mutate(() =>
              window.nexus.setBackupSettings(profileId, {
                ...schedule,
                keepLast: Number(event.target.value),
              }),
            )
          }
        >
          {BACKUP_KEEP_LAST_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {lookup(s.keepLastOptions, String(choice)) ?? String(choice)}
            </option>
          ))}
        </Select>
        <p className="nx-hint">{s.keepLastHint}</p>
      </div>

      {/* The one declared exception to the row shape: what answers this label is
          a two-field form and a button, not a control, and a form pushed to the
          trailing edge would be nonsense. `--stacked` says so out loud. */}
      <div className="set__field set__field--stacked">
        <p className="nx-hint">{s.passphraseTitle}</p>
        <div className="set__security-form">
          <TextField
            type="password"
            label={b.passphraseLabel}
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <TextField
            type="password"
            label={b.passphraseConfirmLabel}
            value={confirmPassphrase}
            onChange={(event) => setConfirmPassphrase(event.target.value)}
          />
        </div>
        <p className="nx-hint">{b.passphraseHint}</p>
        <p className="nx-hint">{s.passphraseFutureNote}</p>
        <Button
          size="sm"
          disabled={busy || passphrase.length === 0}
          onClick={() => void savePassphrase()}
        >
          {settings.passphraseSet ? s.passphraseChange : s.passphraseSave}
        </Button>
        {settings.passphraseSet && <p className="nx-hint">{s.passphraseStatusSet}</p>}
      </div>

      <Button size="sm" disabled={busy || !configured} onClick={() => void mutate(() => window.nexus.runBackupNow(profileId))}>
        {s.runNow}
      </Button>
      {settings.lastRunAt === null ? (
        <p className="nx-hint">{s.lastRunNever}</p>
      ) : settings.lastStatus === "failed" ? (
        <p className="set__error">
          {s.lastRunPrefix} {s.lastRunFailed} —{" "}
          {lookup(s.runErrors, settings.lastError ?? "unknown") ?? s.runErrors.unknown},{" "}
          {formatArchiveInstant(settings.lastRunAt)}
        </p>
      ) : (
        <p className="nx-hint">
          {s.lastRunPrefix} {s.lastRunOk} — {formatArchiveInstant(settings.lastRunAt)}
        </p>
      )}
      {error != null && <p className="set__error">{error}</p>}
    </div>
  );
}

interface SearchHistorySectionProps {
  profileId: string;
  hits: ReadonlySet<string>;
}

/**
 * „Istorija pretrage" (SRCH-009), inside the „Podaci i privatnost" card —
 * beside the five sentences that say what is stored, because this is the one
 * stored thing a user can actually erase. It is a SHELL control, hand-composed
 * here and registered by hand in `settingsSearch.ts`: search is not a module
 * (no manifest, no gallery row, no feature flag), so routing it through the
 * per-module settings contract would be exactly the boundary violation that
 * contract's own doc comment warns against.
 *
 * The count is read once on mount and re-read after a clear, so the button
 * states a real number rather than an assumption — and disables itself at zero
 * instead of offering to erase nothing. No confirmation dialog: what is being
 * discarded is a list of things the user typed, which the app can rebuild the
 * next time they search, and a modal over it would overstate the stakes.
 */
function SearchHistorySection({ profileId, hits }: SearchHistorySectionProps) {
  const s = strings.settings.privacy.searchHistory;

  const [count, setCount] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.nexus
      .searchHistory(profileId)
      .then((entries) => {
        if (!cancelled) setCount(entries.length);
      })
      .catch((loadError: unknown) => {
        console.error("Nexus: loading the search history failed:", loadError);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  async function clearHistory(): Promise<void> {
    if (clearing) return;
    setError(null);
    setClearing(true);
    try {
      await window.nexus.clearSearchHistory(profileId);
      setCount(0);
    } catch (clearError) {
      setError(s.error);
      console.error("Nexus: clearing the search history failed:", clearError);
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="set__restore-block">
      <h3 className={labelClass("nx-eyebrow set__module-group-title", hits.has("privacy-search-history"))}>
        {s.title}
      </h3>
      <p className="nx-hint">{s.caption}</p>
      <Button
        size="sm"
        disabled={clearing || count === null || count === 0}
        onClick={() => void clearHistory()}
      >
        {s.clear}
      </Button>
      {count !== null && (
        <p className="nx-hint">
          {count === 0
            ? s.empty
            : `${count} ${countUnit(count, s.countOne, s.countFew, s.countMany)}`}
        </p>
      )}
      {error != null && <p className="set__error">{error}</p>}
    </div>
  );
}

interface CalendarExportSectionProps {
  profileId: string;
  hits: ReadonlySet<string>;
  /**
   * SET-015: Settings mounts this flow as the only content of a card whose
   * title IS this heading, so the heading would be drawn twice.
   */
  showTitle?: boolean;
}

/**
 * Izvoz kalendara (CAL-008): the quiet `.ics` action inside the same "Rezervna
 * kopija" card, below the full export. Deliberately one button and one result
 * line — there is no passphrase, no confirmation and no preview, because the
 * file is an open interchange copy of appointments the user already sees.
 */
function CalendarExportSection({
  profileId,
  hits,
  showTitle = true,
}: CalendarExportSectionProps) {
  const s = strings.settings.calendarExport;

  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState<{ path: string; events: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runExport(): Promise<void> {
    if (running) return;
    setError(null);
    setSaved(null);
    setRunning(true);
    try {
      const outcome = await window.nexus.exportCalendarIcs(profileId);
      if (!outcome.canceled) {
        setSaved({ path: outcome.path, events: outcome.events, skipped: outcome.skipped });
      }
    } catch (exportError) {
      setError(s.error);
      console.error("Nexus: failed to export the calendar:", exportError);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="set__restore-block">
      {showTitle && (
        <h3
          className={labelClass("nx-eyebrow set__module-group-title", hits.has("backup-calendar"))}
        >
          {s.title}
        </h3>
      )}
      <p className="nx-hint">{s.description}</p>
      <Button size="sm" disabled={running} onClick={() => void runExport()}>
        {s.button}
      </Button>
      {saved != null && (
        <p className="nx-hint">
          {strings.settings.backup.savedPrefix} <span className="app__path">{saved.path}</span> (
          {saved.events} {dayUnit(saved.events, s.eventsUnitOne, s.eventsUnitMany)})
        </p>
      )}
      {saved != null && saved.skipped > 0 && (
        <p className="set__error">
          {s.skippedPrefix} {saved.skipped} {dayUnit(saved.skipped, s.eventsUnitOne, s.eventsUnitMany)}{" "}
          {s.skippedSuffix}
        </p>
      )}
      {error != null && <p className="set__error">{error}</p>}
    </div>
  );
}

/** The picked archive as this section remembers it. Never a path: main holds the pick, and the renderer refers to it without naming it (SEC-EL). */
interface PickedArchive {
  fileName: string;
  /** Straight from the pick — an `NXA1` container needs a passphrase, a plain `.nexus.zip` does not, so one is asked for only when it is actually needed. */
  encrypted: boolean;
}

/**
 * The restore flow's entire state, as one discriminated union rather than a
 * handful of independent booleans: "picked but not previewed", "previewed and
 * refused" and "previewed and ready" are then mutually exclusive by
 * construction, and one phase's buttons can never render over another's data.
 */
type RestoreState =
  | { phase: "idle"; error: string | null }
  | {
      phase: "picked";
      pick: PickedArchive;
      needsPassphrase: boolean;
      busy: boolean;
      error: string | null;
    }
  | { phase: "invalid"; pick: PickedArchive; problems: RestoreProblem[] }
  | { phase: "ready"; pick: PickedArchive; preview: RestorePreview; error: string | null }
  | { phase: "applying"; pick: PickedArchive; preview: RestorePreview }
  | { phase: "applied" };

/** The machine-readable half of a problem — `data/tasks.ndjson:12 · <detail>` — or empty when it carries none. */
function problemFragment(problem: RestoreProblem): string {
  const parts: string[] = [];
  if (problem.path != null) {
    parts.push(problem.line != null ? `${problem.path}:${problem.line}` : problem.path);
  } else if (problem.line != null) {
    parts.push(String(problem.line));
  }
  if (problem.detail != null) parts.push(problem.detail);
  return parts.join(" · ");
}

/** One problem row: the code's Serbian sentence, plus its muted machine fragment when it has one. Shared by the refusal list and the preview's warnings, which differ only in tone. */
function RestoreProblemRow({ problem, tone }: { problem: RestoreProblem; tone: "error" | "muted" }) {
  const fragment = problemFragment(problem);
  return (
    <li className={tone === "error" ? "set__error" : "nx-hint"}>
      {strings.settings.restore.problems[problem.code]}
      {fragment !== "" && <span className="set__restore-fragment"> {fragment}</span>}
    </li>
  );
}

interface RestoreSectionProps {
  profileId: string;
  /** SET-014 search hits; the section reads only its own entry ids out of it. */
  hits: ReadonlySet<string>;
}

/**
 * Vraćanje iz arhive (IMEX slice 3d, ADR-023): pick an archive, dry-run it,
 * and — only from the preview the user actually saw — replace this profile's
 * entire contents with it.
 *
 * The preview IS the confirmation screen: a restore is destructive, so what
 * makes it safe is seeing the archive's own facts beside the target profile's
 * current counts, not another "are you sure" on top. A second dialog would add
 * a click and no information.
 *
 * After a successful apply main reloads this renderer (ADR-023) — which is why
 * nothing here navigates, clears, or otherwise depends on its own state
 * surviving. The undo banner the reloaded app shows is driven by
 * `restoreStatus` in App.tsx, never by this component.
 */
function RestoreSection({ profileId, hits }: RestoreSectionProps) {
  const s = strings.settings.restore;

  const [state, setState] = useState<RestoreState>({ phase: "idle", error: null });
  // Deliberately outside the state machine: a wrong passphrase comes back as a
  // status, not a rejection, and puts the section back in "picked" — where the
  // user corrects the value already typed rather than retyping it.
  const [passphrase, setPassphrase] = useState("");
  // Read by the unmount cleanup only. An apply in flight must never be
  // cancelled from here: main is copying blobs out of the very archive
  // `cancelRestore` would close under it.
  const applying = useRef(false);

  // Backing out of a restore by leaving the page still has to release the
  // picked file — an opened archive keeps it locked on Windows. Once an apply
  // has completed, main has already dropped the pick, so this is a no-op.
  useEffect(() => {
    return () => {
      if (applying.current) return;
      void window.nexus.cancelRestore().catch((error: unknown) => {
        console.error("Nexus: failed to release the picked archive:", error);
      });
    };
  }, []);

  async function runPreview(pick: PickedArchive, phrase: string | null): Promise<void> {
    setState({ phase: "picked", pick, needsPassphrase: phrase !== null, busy: true, error: null });
    try {
      const result = await window.nexus.previewRestore(profileId, phrase);
      switch (result.status) {
        case "ready":
          // The passphrase has done its job — main holds the opened archive
          // now, and nothing after this point ever needs it again
          // (`BackupSection`'s own hygiene rule).
          setPassphrase("");
          setState({ phase: "ready", pick, preview: result.preview, error: null });
          return;
        case "invalid":
          setState({ phase: "invalid", pick, problems: result.problems });
          return;
        case "unreadable":
          setState({
            phase: "picked",
            pick,
            // An archive that turns out to want a passphrase gets the field
            // even if the pick did not say so — otherwise the message asks for
            // something this screen offers no way to give.
            needsPassphrase: pick.encrypted || result.code === "passphrase-required",
            busy: false,
            error: s.unreadable[result.code],
          });
          return;
        case "no-file":
          setState({ phase: "idle", error: s.noFileError });
          return;
      }
    } catch (previewError) {
      setState({
        phase: "picked",
        pick,
        needsPassphrase: pick.encrypted,
        busy: false,
        error: s.readError,
      });
      console.error("Nexus: failed to preview a restore archive:", previewError);
    }
  }

  /** Picking from any phase starts over — main closes the superseded pick itself. */
  async function choose(): Promise<void> {
    setState({ phase: "idle", error: null });
    setPassphrase("");
    try {
      const picked = await window.nexus.pickRestoreArchive();
      if (picked.canceled) return;
      const pick: PickedArchive = { fileName: picked.fileName, encrypted: picked.encrypted };
      if (pick.encrypted) {
        setState({ phase: "picked", pick, needsPassphrase: true, busy: false, error: null });
        return;
      }
      // Nothing left to ask for: a plain archive previews itself on the spot.
      await runPreview(pick, null);
    } catch (pickError) {
      setState({ phase: "idle", error: s.readError });
      console.error("Nexus: failed to pick a restore archive:", pickError);
    }
  }

  async function apply(pick: PickedArchive, preview: RestorePreview): Promise<void> {
    applying.current = true;
    setState({ phase: "applying", pick, preview });
    try {
      await window.nexus.applyRestore(profileId, preview.token);
      // Main reloads this renderer moments after the reply lands, so the
      // success line simply stands until the whole screen is replaced.
      setState({ phase: "applied" });
    } catch (applyError) {
      // A failed apply leaves the preview — and the token main accepts —
      // untouched, so the screen goes back to it rather than to idle.
      setState({ phase: "ready", pick, preview, error: s.error });
      console.error("Nexus: failed to apply a restore:", applyError);
    } finally {
      applying.current = false;
    }
  }

  async function cancel(): Promise<void> {
    setState({ phase: "idle", error: null });
    setPassphrase("");
    try {
      await window.nexus.cancelRestore();
    } catch (cancelError) {
      console.error("Nexus: failed to release the picked archive:", cancelError);
    }
  }

  const previewing = state.phase === "ready" || state.phase === "applying";

  return (
    <div className="set__restore-block">
      <h3 className={labelClass("nx-eyebrow set__module-group-title", hits.has("backup-restore"))}>{s.title}</h3>
      <p className="nx-hint">{s.description}</p>

      {!previewing && state.phase !== "applied" && (
        <Button
          size="sm"
          variant="primary"
          disabled={state.phase === "picked" && state.busy}
          onClick={() => void choose()}
        >
          {s.pickButton}
        </Button>
      )}

      {state.phase === "idle" && state.error != null && <p className="set__error">{state.error}</p>}

      {state.phase === "picked" && (
        <>
          <p className="nx-hint">
            {s.pickedPrefix} <span className="app__path">{state.pick.fileName}</span>
          </p>
          {state.needsPassphrase && (
            <form
              className="set__security-form"
              onSubmit={(event) => {
                event.preventDefault();
                void runPreview(state.pick, passphrase);
              }}
            >
              <TextField
                type="password"
                label={s.passphraseLabel}
                value={passphrase}
                disabled={state.busy}
                onChange={(event) => setPassphrase(event.target.value)}
              />
              <Button type="submit" size="sm" variant="primary" disabled={state.busy || passphrase === ""}>
                {s.previewButton}
              </Button>
            </form>
          )}
          {state.busy && <p className="nx-hint">{s.previewRunning}</p>}
          {state.error != null && <p className="set__error">{state.error}</p>}
        </>
      )}

      {state.phase === "invalid" && (
        <>
          <p className="nx-hint">
            {s.pickedPrefix} <span className="app__path">{state.pick.fileName}</span>
          </p>
          <ul className="set__restore-problems">
            {state.problems.map((problem, index) => (
              <RestoreProblemRow key={`${problem.code}-${index}`} problem={problem} tone="error" />
            ))}
          </ul>
        </>
      )}

      {previewing && (
        <>
          <div className="set__restore-head">
            <span className="app__path">{state.preview.fileName}</span>
            <span className="set__restore-meta">
              {s.createdLabel}: {formatArchiveInstant(state.preview.createdAt)}
            </span>
            <span className="set__restore-meta">
              {s.versionLabel}: {state.preview.appVersion}
            </span>
            <span className="set__restore-meta">
              {s.sourceLabel}: {state.preview.sourceProfileName}
            </span>
          </div>

          <p className="set__restore-warning">
            {s.replaceWarningPrefix} <strong>{state.preview.targetProfileName}</strong>{" "}
            {s.replaceWarningSuffix}
          </p>

          <table className="set__restore-table">
            <thead>
              <tr>
                {/* The row-header column's own corner cell: a module name needs no heading. */}
                <td />
                <th scope="col">{s.columnCurrent}</th>
                <th scope="col">{s.columnIncoming}</th>
              </tr>
            </thead>
            <tbody>
              {ARCHIVE_MODULES.map((key) => (
                <tr key={key}>
                  <th scope="row">{s.modules[key]}</th>
                  <td>{state.preview.current[key]}</td>
                  <td>{state.preview.incoming[key]}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {state.preview.warnings.length > 0 && (
            <ul className="set__restore-problems">
              {state.preview.warnings.map((warning, index) => (
                <RestoreProblemRow key={`${warning.code}-${index}`} problem={warning} tone="muted" />
              ))}
            </ul>
          )}
          {state.preview.corruptBlobs > 0 && (
            <p className="nx-hint">
              {s.corruptBlobsPrefix} {state.preview.corruptBlobs}{" "}
              {dayUnit(state.preview.corruptBlobs, s.corruptBlobsUnitOne, s.corruptBlobsUnitMany)}{" "}
              {s.corruptBlobsSuffix}
            </p>
          )}
          {/* ADR-057 §6: the archive carrying private notes is stated whenever
              it does, and the skip sentence joins it only when this apply will
              NOT restore them (locked / never-set-up section). */}
          {state.preview.privateNotes != null && (
            <p className="nx-hint">
              {s.privateNotesIncomingPrefix} ({state.preview.privateNotes.count}).
            </p>
          )}
          {state.preview.privateNotes != null && !state.preview.privateNotes.willRestore && (
            <p className="set__error">{s.privateNotesSkippedNotice}</p>
          )}

          <div className="set__restore-actions">
            <Button
              size="sm"
              variant="primary"
              disabled={state.phase === "applying"}
              onClick={() => void apply(state.pick, state.preview)}
            >
              {s.applyButton}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={state.phase === "applying"}
              onClick={() => void cancel()}
            >
              {s.cancelButton}
            </Button>
          </div>

          {state.phase === "applying" && <p className="nx-hint">{s.applying}</p>}
          {state.phase === "ready" && state.error != null && <p className="set__error">{state.error}</p>}
        </>
      )}

      {state.phase === "applied" && <p className="nx-hint">{s.applied}</p>}
    </div>
  );
}

/**
 * The import flow's state, phase for phase the same machine `RestoreState` is:
 * the two flows differ in what they DO, never in how they are driven, and one
 * shape means one set of buttons-per-phase to reason about. Only the preview
 * type differs, because only the preview says anything different.
 */
type ImportState =
  | { phase: "idle"; error: string | null }
  | {
      phase: "picked";
      pick: PickedArchive;
      needsPassphrase: boolean;
      busy: boolean;
      error: string | null;
    }
  | { phase: "invalid"; pick: PickedArchive; problems: RestoreProblem[] }
  | {
      phase: "ready";
      pick: PickedArchive;
      preview: ImportPreview;
      /** True while a duplicate choice is being re-planned (ADR-051) — the plan on screen is still the valid one until the answer lands. */
      busy: boolean;
      error: string | null;
    }
  | { phase: "applying"; pick: PickedArchive; preview: ImportPreview }
  | { phase: "applied" };

/** One named group of rows the import will not write: its Serbian reason, then the module it belonged to and how many rows it covers. */
function ImportSkipRow({ reason }: { reason: ImportSkipReason }) {
  const s = strings.settings.import;
  const moduleLabel = reason.module === null ? null : strings.settings.restore.modules[reason.module];
  return (
    <li className="set__import-skip">
      {s.skips[reason.code]}{" "}
      <span className="set__import-skip-meta">
        {moduleLabel !== null && <>{moduleLabel} · </>}
        {reason.count}
      </span>
    </li>
  );
}

/** The two answers, in the order the row offers them: the default first. */
const DUPLICATE_CHOICES: readonly ImportDuplicateChoice[] = ["skip", "import"];

interface ImportDuplicateRowProps {
  group: ImportDuplicateGroup;
  /** What this group is currently planned as — `"skip"` until the user says otherwise. */
  choice: ImportDuplicateChoice;
  disabled: boolean;
  onChoose: (choice: ImportDuplicateChoice) => void;
}

/**
 * One detected duplicate group (ADR-051): what it is, how many rows it covers,
 * what „isto“ means for it — spelled out, because a choice nobody can evaluate
 * is not a choice — and the two-state answer.
 *
 * Two quiet buttons rather than a checkbox, deliberately: neither answer is the
 * „off“ of the other. „Preskoči“ and „Uvezi svejedno“ are both something the
 * user is doing on purpose, and a checkbox would frame one of them as the
 * absence of an action. The active one is typographic — accent text and weight,
 * no fill, no glow, no inset bar — the same recipe the search chips use.
 */
function ImportDuplicateRow({ group, choice, disabled, onChoose }: ImportDuplicateRowProps) {
  const s = strings.settings.import;
  return (
    <li className="set__import-duplicate">
      <span className="set__import-duplicate-name">{s.duplicateLabels[group.type]}</span>
      <span className="set__import-duplicate-meta">
        {group.count} · {s.duplicateIdentities[group.type]}
      </span>
      <span
        className="set__import-duplicate-choice"
        role="group"
        aria-label={`${s.duplicateLabels[group.type]}: ${s.duplicateChoiceLabel}`}
      >
        {DUPLICATE_CHOICES.map((option) => (
          <Button
            key={option}
            size="sm"
            className="nx-segmented__option set__import-choice"
            aria-pressed={option === choice}
            disabled={disabled}
            onClick={() => onChoose(option)}
          >
            {option === "skip" ? s.duplicateSkipButton : s.duplicateImportButton}
          </Button>
        ))}
      </span>
    </li>
  );
}

interface ImportSectionProps {
  profileId: string;
  /** SET-014 search hits; the section reads only its own entry ids out of it. */
  hits: ReadonlySet<string>;
  /**
   * SET-015: Settings mounts this flow as the only content of a card whose
   * title IS this heading, so the heading would be drawn twice. The archive
   * import's own siblings keep the default.
   */
  showTitle?: boolean;
}

/**
 * Uvoz iz arhive (ADR-043 §5): pick somebody else's archive — or your own other
 * profile's — dry-run it against THIS profile, and merge it in.
 *
 * Deliberately the restore section's twin: the same pick → passphrase →
 * preview → confirm machine, the same busy and error states, the same `set__`
 * recipes, so the two cards read as siblings and the user learns one flow. What
 * differs is the contract and therefore the preview. A restore REPLACES, so its
 * preview compares current with incoming; an import ADDS, so nothing is being
 * replaced and the only honest numbers are per-module arithmetic — what the
 * archive carried, what will be inserted, what merged onto something already
 * here, and what will not arrive at all, every last one of those NAMED before
 * anything is written.
 *
 * As with a restore, main reloads this renderer after a successful apply, so
 * nothing here depends on its own state surviving; the undo banner the reloaded
 * app shows is driven by `restoreStatus` in App.tsx, which serves both
 * operations from one slot.
 */
function ImportSection({ profileId, hits, showTitle = true }: ImportSectionProps) {
  const s = strings.settings.import;
  // The half of the flow that is identical to a restore's, read from where it
  // is already spelled rather than spelled a second time.
  const shared = strings.settings.restore;

  const [state, setState] = useState<ImportState>({ phase: "idle", error: null });
  // Outside the state machine for the reason `RestoreSection`'s is: a wrong
  // passphrase comes back as a status, not a rejection, and the user corrects
  // the value already typed rather than retyping it.
  const [passphrase, setPassphrase] = useState("");
  // The duplicate answers the PLAN on screen was computed with (ADR-051) —
  // committed only once main has actually re-planned on them, never
  // optimistically, so a failed re-plan leaves the buttons agreeing with the
  // plan the user is still looking at rather than with one that does not exist.
  // Outside the state machine for the same reason `passphrase` is: it survives
  // the phase changes around it, and resets exactly where a new pick starts.
  const [choices, setChoices] = useState<ImportDuplicateChoices>({});
  // Read by the unmount cleanup only. An apply in flight must never be
  // cancelled from here: main is copying blobs out of the very archive
  // `cancelImport` would close under it.
  const applying = useRef(false);

  // Leaving the page while an archive is picked still has to release it — an
  // opened archive keeps the user's file locked on Windows. After an apply main
  // has already dropped the pick, so this is a no-op.
  useEffect(() => {
    return () => {
      if (applying.current) return;
      void window.nexus.cancelImport().catch((error: unknown) => {
        console.error("Nexus: failed to release the picked import archive:", error);
      });
    };
  }, []);

  async function runPreview(pick: PickedArchive, phrase: string | null): Promise<void> {
    setState({ phase: "picked", pick, needsPassphrase: phrase !== null, busy: true, error: null });
    try {
      const result = await window.nexus.previewImport(profileId, phrase);
      switch (result.status) {
        case "ready":
          // Main holds the opened archive now; nothing after this point ever
          // needs the passphrase again (`BackupSection`'s own hygiene rule).
          setPassphrase("");
          // A fresh preview is always planned on the defaults (every duplicate
          // group skipped), so the rows start there too.
          setChoices({});
          setState({ phase: "ready", pick, preview: result.preview, busy: false, error: null });
          return;
        case "invalid":
          setState({ phase: "invalid", pick, problems: result.problems });
          return;
        case "unreadable":
          setState({
            phase: "picked",
            pick,
            // An archive that turns out to want a passphrase gets the field even
            // if the pick did not say so — otherwise the message asks for
            // something this screen offers no way to give.
            needsPassphrase: pick.encrypted || result.code === "passphrase-required",
            busy: false,
            error: shared.unreadable[result.code],
          });
          return;
        case "no-file":
          setState({ phase: "idle", error: shared.noFileError });
          return;
      }
    } catch (previewError) {
      setState({
        phase: "picked",
        pick,
        needsPassphrase: pick.encrypted,
        busy: false,
        error: shared.readError,
      });
      console.error("Nexus: failed to preview an import archive:", previewError);
    }
  }

  /**
   * Re-plans the open archive under one changed duplicate answer (ADR-051) and
   * swaps in the fresh preview — and, with it, the fresh token, since the plan
   * the old one named no longer exists.
   *
   * Nothing here re-picks or re-previews: main re-uses the archive it already
   * has open, so a changed answer never costs a second passphrase prompt. A
   * rejected re-plan leaves the preview and the token exactly as they were, and
   * the buttons with them.
   */
  async function chooseDuplicate(
    pick: PickedArchive,
    preview: ImportPreview,
    type: ImportDuplicateType,
    choice: ImportDuplicateChoice,
  ): Promise<void> {
    const next: ImportDuplicateChoices = { ...choices, [type]: choice };
    setState({ phase: "ready", pick, preview, busy: true, error: null });
    try {
      const result = await window.nexus.replanImport(profileId, preview.token, next);
      if (result.status === "ready") {
        setChoices(next);
        setState({ phase: "ready", pick, preview: result.preview, busy: false, error: null });
        return;
      }
      setState({ phase: "ready", pick, preview, busy: false, error: s.duplicateError });
    } catch (replanError) {
      setState({ phase: "ready", pick, preview, busy: false, error: s.duplicateError });
      console.error("Nexus: failed to re-plan an import:", replanError);
    }
  }

  /** Picking from any phase starts over — main closes the superseded pick itself. */
  async function choose(): Promise<void> {
    setState({ phase: "idle", error: null });
    setPassphrase("");
    setChoices({});
    try {
      const picked = await window.nexus.pickImportArchive();
      if (picked.canceled) return;
      const pick: PickedArchive = { fileName: picked.fileName, encrypted: picked.encrypted };
      if (pick.encrypted) {
        setState({ phase: "picked", pick, needsPassphrase: true, busy: false, error: null });
        return;
      }
      // Nothing left to ask for: a plain archive previews itself on the spot.
      await runPreview(pick, null);
    } catch (pickError) {
      setState({ phase: "idle", error: shared.readError });
      console.error("Nexus: failed to pick an import archive:", pickError);
    }
  }

  async function apply(pick: PickedArchive, preview: ImportPreview): Promise<void> {
    applying.current = true;
    setState({ phase: "applying", pick, preview });
    try {
      await window.nexus.applyImport(profileId, preview.token);
      // Main reloads this renderer moments after the reply lands, so the
      // success line simply stands until the whole screen is replaced.
      setState({ phase: "applied" });
    } catch (applyError) {
      // A failed apply leaves the plan — and the token main accepts —
      // untouched, so the screen goes back to it rather than to idle.
      setState({ phase: "ready", pick, preview, busy: false, error: s.error });
      console.error("Nexus: failed to apply an import:", applyError);
    } finally {
      applying.current = false;
    }
  }

  async function cancel(): Promise<void> {
    setState({ phase: "idle", error: null });
    setPassphrase("");
    setChoices({});
    try {
      await window.nexus.cancelImport();
    } catch (cancelError) {
      console.error("Nexus: failed to release the picked import archive:", cancelError);
    }
  }

  const previewing = state.phase === "ready" || state.phase === "applying";
  // A re-plan is replacing the token this screen holds (ADR-051), so nothing
  // that would spend it — least of all the apply — may fire meanwhile.
  const replanning = state.phase === "ready" && state.busy;

  return (
    <div className="set__import-block">
      {showTitle && (
        <h3
          className={labelClass("nx-eyebrow set__module-group-title", hits.has("backup-import"))}
        >
          {s.title}
        </h3>
      )}
      <p className="nx-hint">{s.description}</p>

      {!previewing && state.phase !== "applied" && (
        <Button
          size="sm"
          variant="primary"
          disabled={state.phase === "picked" && state.busy}
          onClick={() => void choose()}
        >
          {shared.pickButton}
        </Button>
      )}

      {state.phase === "idle" && state.error != null && <p className="set__error">{state.error}</p>}

      {state.phase === "picked" && (
        <>
          <p className="nx-hint">
            {shared.pickedPrefix} <span className="app__path">{state.pick.fileName}</span>
          </p>
          {state.needsPassphrase && (
            <form
              className="set__security-form"
              onSubmit={(event) => {
                event.preventDefault();
                void runPreview(state.pick, passphrase);
              }}
            >
              <TextField
                type="password"
                label={shared.passphraseLabel}
                value={passphrase}
                disabled={state.busy}
                onChange={(event) => setPassphrase(event.target.value)}
              />
              <Button type="submit" size="sm" variant="primary" disabled={state.busy || passphrase === ""}>
                {shared.previewButton}
              </Button>
            </form>
          )}
          {state.busy && <p className="nx-hint">{shared.previewRunning}</p>}
          {state.error != null && <p className="set__error">{state.error}</p>}
        </>
      )}

      {state.phase === "invalid" && (
        <>
          <p className="nx-hint">
            {shared.pickedPrefix} <span className="app__path">{state.pick.fileName}</span>
          </p>
          <ul className="set__restore-problems">
            {state.problems.map((problem, index) => (
              <RestoreProblemRow key={`${problem.code}-${index}`} problem={problem} tone="error" />
            ))}
          </ul>
        </>
      )}

      {previewing && (
        <>
          <div className="set__restore-head">
            <span className="app__path">{state.preview.fileName}</span>
            {state.preview.encrypted && <Chip>{s.encryptedBadge}</Chip>}
            <span className="set__restore-meta">
              {shared.createdLabel}: {formatArchiveInstant(state.preview.createdAt)}
            </span>
            <span className="set__restore-meta">
              {shared.versionLabel}: {state.preview.appVersion}
            </span>
            <span className="set__restore-meta">
              {shared.sourceLabel}: {state.preview.sourceProfileName}
            </span>
            <span className="set__restore-meta">
              {s.targetLabel}: {state.preview.targetProfileName}
            </span>
          </div>

          <table className="set__restore-table set__import-table">
            <thead>
              <tr>
                {/* The row-header column's own corner cell: a module name needs no heading. */}
                <td />
                <th scope="col">{s.columnParsed}</th>
                <th scope="col">{s.columnImported}</th>
                <th scope="col">{s.columnMerged}</th>
                <th scope="col">{s.columnSkipped}</th>
              </tr>
            </thead>
            <tbody>
              {ARCHIVE_MODULES.map((key) => {
                const counts = state.preview.report.modules[key];
                return (
                  <tr key={key}>
                    <th scope="row">{shared.modules[key]}</th>
                    <td>{counts.parsed}</td>
                    <td>{counts.imported}</td>
                    <td>{counts.merged}</td>
                    <td>{counts.skipped}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="nx-hint">{s.tableCaption}</p>

          {/* ADR-051: above the skip list, because these rows are the one part
              of the report the user can still CHANGE — everything below them
              states what will happen, while this states what they decided. */}
          {state.preview.report.duplicates.length > 0 && (
            <>
              <h4 className="nx-eyebrow set__module-group-title">{s.duplicatesTitle}</h4>
              <p className="nx-hint">{s.duplicatesCaption}</p>
              <ul className="set__import-duplicates">
                {state.preview.report.duplicates.map((group) => (
                  <ImportDuplicateRow
                    key={group.type}
                    group={group}
                    choice={choices[group.type] ?? "skip"}
                    disabled={state.phase === "applying" || replanning}
                    onChoose={(choice) =>
                      void chooseDuplicate(state.pick, state.preview, group.type, choice)
                    }
                  />
                ))}
              </ul>
            </>
          )}

          {state.preview.report.skips.length > 0 && (
            <>
              <h4 className="nx-eyebrow set__module-group-title">{s.skipsTitle}</h4>
              <ul className="set__restore-problems">
                {state.preview.report.skips.map((reason) => (
                  <ImportSkipRow
                    key={`${reason.code}-${reason.module ?? ""}-${reason.type ?? ""}`}
                    reason={reason}
                  />
                ))}
              </ul>
            </>
          )}

          {state.preview.warnings.length > 0 && (
            <>
              <h4 className="nx-eyebrow set__module-group-title">{s.warningsTitle}</h4>
              <ul className="set__restore-problems">
                {state.preview.warnings.map((warning, index) => (
                  <RestoreProblemRow key={`${warning.code}-${index}`} problem={warning} tone="muted" />
                ))}
              </ul>
            </>
          )}
          {state.preview.corruptBlobs > 0 && (
            <p className="nx-hint">
              {shared.corruptBlobsPrefix} {state.preview.corruptBlobs}{" "}
              {dayUnit(state.preview.corruptBlobs, shared.corruptBlobsUnitOne, shared.corruptBlobsUnitMany)}{" "}
              {s.corruptBlobsSuffix}
            </p>
          )}

          <div className="set__restore-actions">
            <Button
              size="sm"
              variant="primary"
              disabled={state.phase === "applying" || replanning}
              onClick={() => void apply(state.pick, state.preview)}
            >
              {s.applyButton}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={state.phase === "applying" || replanning}
              onClick={() => void cancel()}
            >
              {shared.cancelButton}
            </Button>
          </div>

          {state.phase === "applying" && <p className="nx-hint">{s.applying}</p>}
          {replanning && <p className="nx-hint">{shared.previewRunning}</p>}
          {state.phase === "ready" && state.error != null && <p className="set__error">{state.error}</p>}
        </>
      )}

      {state.phase === "applied" && <p className="nx-hint">{s.applied}</p>}
    </div>
  );
}

/**
 * The `.ics` flow's state (ADR-061). The same machine `ApkgState` is — no
 * passphrase (an `.ics` is plain text) and no `"invalid"` (it carries no
 * manifest to be wrong about) — and one step shorter than even that: there is
 * no choice to make before the preview, so a successful pick previews itself
 * on the spot.
 */
type IcsState =
  | { phase: "idle"; error: string | null }
  | { phase: "picked"; fileName: string; busy: boolean; error: string | null }
  | { phase: "ready"; fileName: string; preview: IcsImportPreview; busy: boolean; error: string | null }
  | { phase: "applying"; fileName: string; preview: IcsImportPreview }
  | { phase: "applied" };

/** One named group of things the calendar file carried and this import does not: its Serbian reason, then how many. */
function IcsSkipRow({ skip }: { skip: IcsImportSkip }) {
  const s = strings.settings.icsImport;
  return (
    <li className="set__import-skip">
      {s.skips[skip.code]} <span className="set__import-skip-meta">{skip.count}</span>
    </li>
  );
}

/** One kind of component the file carried that Nexus does not read — named by the FILE's own word for it (VTODO, VALARM…), which is why this is a sentence around a name rather than a closed copy map. */
function IcsComponentRow({ component }: { component: IcsImportSkippedComponent }) {
  const s = strings.settings.icsImport;
  return (
    <li className="set__import-skip">
      {s.componentPrefix} {component.name} {s.componentSuffix}{" "}
      <span className="set__import-skip-meta">{component.count}</span>
    </li>
  );
}

interface IcsImportSectionProps {
  profileId: string;
  /** SET-014 search hits; the section reads only its own entry id out of it. */
  hits: ReadonlySet<string>;
  /** SET-015: Settings now draws this flow's heading as the card's own title, so the heading is suppressed there. */
  showTitle?: boolean;
}

/**
 * Uvoz kalendara (.ics) — ADR-061.
 *
 * Deliberately the `.apkg` section's twin minus its one extra step: pick →
 * preview → confirm, the same busy and error states, the same `set__` recipes,
 * the same shared undo banner afterwards. An `.ics` needs no destination
 * choice — its events land in the calendar — so the only question left on the
 * screen is ADR-051's duplicate one, asked with the import block's own
 * „Preskoči / Uvezi svejedno" pair (the LLM block's recipe, since both flows
 * carry exactly the one event group). Answering it re-previews: main re-plans
 * the events it already parsed, never re-reading the file.
 *
 * Two tables, answering two different questions, exactly as the `.apkg`'s do:
 * what the file holds and how much of it arrives, then the plan's own
 * per-module arithmetic from the same planner the archive import uses —
 * narrowed to the modules that carry anything, which for an `.ics` is only
 * Kalendar. Below them, every named loss, counted: the components Nexus does
 * not read, then the per-event trims.
 */
function IcsImportSection({ profileId, hits, showTitle = true }: IcsImportSectionProps) {
  const s = strings.settings.icsImport;
  // The half of the flow that is identical to a restore's, read from where it
  // is already spelled rather than spelled a second time.
  const shared = strings.settings.restore;

  const [state, setState] = useState<IcsState>({ phase: "idle", error: null });
  // The duplicate answer the plan on screen was computed under (ADR-051) —
  // committed only once main has actually re-planned on it, never
  // optimistically, exactly as the import block's choices are.
  const [importDuplicates, setImportDuplicates] = useState(false);
  // Read by the unmount cleanup only. An apply in flight must never be
  // cancelled from here: main is writing the very plan `cancelIcsImport` would
  // drop.
  const applying = useRef(false);

  // Releasing the pick on unmount matters for the reason the `.apkg`'s does:
  // main is holding somebody's whole parsed calendar until it is told to let go.
  useEffect(() => {
    return () => {
      if (applying.current) return;
      void window.nexus.cancelIcsImport().catch((error: unknown) => {
        console.error("Nexus: failed to release the picked .ics:", error);
      });
    };
  }, []);

  async function runPreview(fileName: string, next: boolean): Promise<void> {
    try {
      const result = await window.nexus.previewIcsImport(profileId, next);
      switch (result.status) {
        case "ready":
          setImportDuplicates(next);
          setState({ phase: "ready", fileName, preview: result.preview, busy: false, error: null });
          return;
        case "unreadable":
          setState({ phase: "picked", fileName, busy: false, error: s.unreadable[result.code] });
          return;
        case "no-file":
          setState({ phase: "idle", error: s.noFileError });
          return;
      }
    } catch (previewError) {
      setState({ phase: "picked", fileName, busy: false, error: s.readError });
      console.error("Nexus: failed to preview an .ics:", previewError);
    }
  }

  /** Picking from any phase starts over — main drops the superseded pick itself. A fresh pick always previews on the safe default (duplicates skipped). */
  async function choose(): Promise<void> {
    setState({ phase: "idle", error: null });
    setImportDuplicates(false);
    try {
      const picked = await window.nexus.pickIcsFile();
      if (picked.canceled) return;
      setState({ phase: "picked", fileName: picked.fileName, busy: true, error: null });
      await runPreview(picked.fileName, false);
    } catch (pickError) {
      setState({ phase: "idle", error: s.readError });
      console.error("Nexus: failed to pick an .ics:", pickError);
    }
  }

  /**
   * Re-previews under the other duplicate answer (ADR-051) and swaps in the
   * fresh preview — and, with it, the fresh token, since the plan the old one
   * named no longer exists. Main re-uses the events it already parsed, so this
   * costs a re-plan, never a re-read; a rejected re-preview leaves the plan,
   * the token and the buttons exactly as they were.
   */
  async function chooseDuplicates(
    fileName: string,
    preview: IcsImportPreview,
    next: boolean,
  ): Promise<void> {
    setState({ phase: "ready", fileName, preview, busy: true, error: null });
    try {
      const result = await window.nexus.previewIcsImport(profileId, next);
      if (result.status === "ready") {
        setImportDuplicates(next);
        setState({ phase: "ready", fileName, preview: result.preview, busy: false, error: null });
        return;
      }
      setState({
        phase: "ready",
        fileName,
        preview,
        busy: false,
        error: strings.settings.import.duplicateError,
      });
    } catch (replanError) {
      setState({
        phase: "ready",
        fileName,
        preview,
        busy: false,
        error: strings.settings.import.duplicateError,
      });
      console.error("Nexus: failed to re-plan an .ics import:", replanError);
    }
  }

  async function apply(fileName: string, preview: IcsImportPreview): Promise<void> {
    applying.current = true;
    setState({ phase: "applying", fileName, preview });
    try {
      await window.nexus.applyIcsImport(profileId, preview.token);
      // Main reloads this renderer moments after the reply lands, so the success
      // line simply stands until the whole screen is replaced.
      setState({ phase: "applied" });
    } catch (applyError) {
      // A failed apply leaves the plan — and the token main accepts — untouched,
      // so the screen goes back to it rather than to idle.
      setState({ phase: "ready", fileName, preview, busy: false, error: s.error });
      console.error("Nexus: failed to apply an .ics import:", applyError);
    } finally {
      applying.current = false;
    }
  }

  async function cancel(): Promise<void> {
    setState({ phase: "idle", error: null });
    try {
      await window.nexus.cancelIcsImport();
    } catch (cancelError) {
      console.error("Nexus: failed to release the picked .ics:", cancelError);
    }
  }

  const previewing = state.phase === "ready" || state.phase === "applying";
  // A re-preview is replacing the token this screen holds (ADR-051), so nothing
  // that would spend it — least of all the apply — may fire meanwhile.
  const replanning = state.phase === "ready" && state.busy;

  return (
    <div className="set__import-block">
      {showTitle && (
        <h3 className={labelClass("nx-eyebrow set__module-group-title", hits.has("backup-ics"))}>
          {s.title}
        </h3>
      )}
      <p className="nx-hint">{s.description}</p>

      {!previewing && state.phase !== "applied" && (
        <Button
          size="sm"
          variant="primary"
          disabled={state.phase === "picked" && state.busy}
          onClick={() => void choose()}
        >
          {s.pickButton}
        </Button>
      )}

      {state.phase === "idle" && state.error != null && <p className="set__error">{state.error}</p>}

      {state.phase === "picked" && (
        <>
          <p className="nx-hint">
            {shared.pickedPrefix} <span className="app__path">{state.fileName}</span>
          </p>
          {state.busy && <p className="nx-hint">{s.previewRunning}</p>}
          {state.error != null && <p className="set__error">{state.error}</p>}
        </>
      )}

      {previewing && (
        <>
          <div className="set__restore-head">
            <span className="app__path">{state.preview.fileName}</span>
          </div>

          <table className="set__restore-table">
            <thead>
              <tr>
                {/* The row-header column's own corner cell: a row name needs no heading. */}
                <td />
                <th scope="col">{s.columnSource}</th>
                <th scope="col">{s.columnPlanned}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{s.rowEvents}</th>
                <td>{state.preview.sourceEvents}</td>
                <td>{state.preview.plannedEvents}</td>
              </tr>
            </tbody>
          </table>

          {/* The plan's OWN arithmetic, from the same planner the archive import
              uses, narrowed to the modules that carry anything — an `.ics`
              touches only Kalendar, and five rows of zeros would say nothing. */}
          <table className="set__restore-table set__import-table">
            <thead>
              <tr>
                <td />
                <th scope="col">{strings.settings.import.columnParsed}</th>
                <th scope="col">{strings.settings.import.columnImported}</th>
                <th scope="col">{strings.settings.import.columnMerged}</th>
                <th scope="col">{strings.settings.import.columnSkipped}</th>
              </tr>
            </thead>
            <tbody>
              {ARCHIVE_MODULES.filter((key) => state.preview.modules[key].parsed > 0).map((key) => {
                const counts = state.preview.modules[key];
                return (
                  <tr key={key}>
                    <th scope="row">{shared.modules[key]}</th>
                    <td>{counts.parsed}</td>
                    <td>{counts.imported}</td>
                    <td>{counts.merged}</td>
                    <td>{counts.skipped}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* ADR-051: the one part of the preview the user can still CHANGE.
              The sentence says which way the plan currently goes; the answer
              is the import block's own two-state pair, so the flows read as
              siblings. */}
          {state.preview.duplicates > 0 && (
            <div className="set__llm-duplicates">
              <p className="nx-hint">
                {s.duplicatesPrefix} {state.preview.duplicates}{" "}
                {countUnit(
                  state.preview.duplicates,
                  s.duplicatesUnitOne,
                  s.duplicatesUnitFew,
                  s.duplicatesUnitMany,
                )}{" "}
                {importDuplicates ? s.duplicatesSuffixImported : s.duplicatesSuffix}
              </p>
              <span
                className="set__llm-duplicate-choice"
                role="group"
                aria-label={strings.settings.import.duplicateChoiceLabel}
              >
                {DUPLICATE_CHOICES.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    className="nx-segmented__option set__import-choice"
                    aria-pressed={(option === "import") === importDuplicates}
                    disabled={state.phase === "applying" || replanning}
                    onClick={() =>
                      void chooseDuplicates(state.fileName, state.preview, option === "import")
                    }
                  >
                    {option === "skip"
                      ? strings.settings.import.duplicateSkipButton
                      : strings.settings.import.duplicateImportButton}
                  </Button>
                ))}
              </span>
            </div>
          )}

          {(state.preview.components.length > 0 || state.preview.skips.length > 0) && (
            <>
              <h4 className="nx-eyebrow set__module-group-title">{s.skipsTitle}</h4>
              <ul className="set__restore-problems">
                {state.preview.components.map((component) => (
                  <IcsComponentRow key={component.name} component={component} />
                ))}
                {state.preview.skips.map((skip) => (
                  <IcsSkipRow key={skip.code} skip={skip} />
                ))}
              </ul>
            </>
          )}

          {state.preview.plannedEvents === 0 && (
            <p className="nx-hint">{s.nothingToImport}</p>
          )}

          <div className="set__restore-actions">
            {state.preview.plannedEvents > 0 && (
              <Button
                size="sm"
                variant="primary"
                disabled={state.phase === "applying" || replanning}
                onClick={() => void apply(state.fileName, state.preview)}
              >
                {s.applyButton}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={state.phase === "applying" || replanning}
              onClick={() => void cancel()}
            >
              {shared.cancelButton}
            </Button>
          </div>

          {state.phase === "applying" && <p className="nx-hint">{s.applying}</p>}
          {replanning && <p className="nx-hint">{s.previewRunning}</p>}
          {state.phase === "ready" && state.error != null && <p className="set__error">{state.error}</p>}
        </>
      )}

      {state.phase === "applied" && <p className="nx-hint">{s.applied}</p>}
    </div>
  );
}

/** The unfiled root, as a `<select>` value — an empty option value, so no sentinel id can ever collide with a real folder's. */
const UNFILED_VALUE = "";

/** „Nova oblast…" as a `<select>` value — an empty option value, exactly as `UNFILED_VALUE` is, so no sentinel can collide with a real subject id. */
const NEW_SUBJECT_VALUE = "";

/**
 * The `.apkg` flow's state. The same machine `RestoreState` and `ImportState`
 * are, minus the two phases this flow cannot reach: there is no passphrase
 * (an `.apkg` is a plain zip) and no `"invalid"` (an `.apkg` carries no manifest
 * to be wrong about — every way it can fail is a way it could not be READ, which
 * is `"picked"` with an error on it).
 */
type ApkgState =
  | { phase: "idle"; error: string | null }
  | { phase: "picked"; fileName: string; busy: boolean; error: string | null }
  | { phase: "ready"; fileName: string; preview: ApkgImportPreview; busy: boolean; error: string | null }
  | { phase: "applying"; fileName: string; preview: ApkgImportPreview }
  | { phase: "applied" };

/** One named group of things the Anki deck carried and this import does not: its Serbian reason, then how many. */
function ApkgSkipRow({ skip }: { skip: ApkgImportSkip }) {
  const s = strings.settings.apkgImport;
  return (
    <li className="set__import-skip">
      {s.skips[skip.code]} <span className="set__import-skip-meta">{skip.count}</span>
    </li>
  );
}

interface ApkgImportSectionProps {
  profileId: string;
  /** SET-014 search hits; the section reads only its own entry id out of it. */
  hits: ReadonlySet<string>;
  /** SET-015: Settings now draws this flow's heading as the card's own title, so the heading is suppressed there. */
  showTitle?: boolean;
}

/**
 * Uvoz iz Anki (.apkg) — ADR-052 / STUDY-011.
 *
 * Deliberately the import section's twin, one step longer: pick → CHOOSE A
 * SUBJECT → preview → confirm, the same busy and error states, the same `set__`
 * recipes, the same shared undo banner afterwards. The extra step is the one
 * thing an `.apkg` cannot answer for itself — a Nexus deck lives inside a
 * subject and an Anki collection has no such concept — so the user names it,
 * and the preview cannot be computed until they have.
 *
 * The subject sits ABOVE the file button rather than inside the preview,
 * because it is a precondition rather than a refinement: nothing can be
 * previewed without it. Changing it afterwards re-previews, which main answers
 * by re-translating and re-planning the collection it already read — never by
 * reading the file again (ADR-051's re-plan precedent, in the form this flow
 * can take).
 *
 * Two tables, answering two different questions. The first is the Anki side:
 * what the file holds, and how much of it arrives. The second is the plan's own
 * per-module arithmetic — the same table the archive import shows, from the same
 * planner — narrowed to the modules that actually carry something, which for an
 * `.apkg` is only Učenje. Below them, every named loss, counted.
 */
function ApkgImportSection({ profileId, hits, showTitle = true }: ApkgImportSectionProps) {
  const s = strings.settings.apkgImport;
  // The half of the flow that is identical to a restore's, read from where it is
  // already spelled rather than spelled a second time.
  const shared = strings.settings.restore;

  const [state, setState] = useState<ApkgState>({ phase: "idle", error: null });
  const [subjects, setSubjects] = useState<Subject[]>([]);
  // Outside the state machine for the reason `RestoreSection`'s passphrase is:
  // the choice survives the phase changes around it, and resets exactly where a
  // new pick starts.
  const [subjectId, setSubjectId] = useState<string>(NEW_SUBJECT_VALUE);
  const [newSubjectName, setNewSubjectName] = useState("");
  // Read by the unmount cleanup only. An apply in flight must never be cancelled
  // from here: main is writing the very plan `cancelApkgImport` would drop.
  const applying = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await window.nexus.listSubjects(profileId);
        if (active) setSubjects(list);
      } catch (loadError) {
        // The list is a convenience: „Nova oblast" still works without it, so
        // this must not take the whole block down.
        console.error("Nexus: failed to load subjects:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  // Releasing the pick on unmount matters for the reason the two archive
  // sections' does — and for one more here: main is holding somebody's whole
  // collection in memory until it is told to let go.
  useEffect(() => {
    return () => {
      if (applying.current) return;
      void window.nexus.cancelApkgImport().catch((error: unknown) => {
        console.error("Nexus: failed to release the picked .apkg:", error);
      });
    };
  }, []);

  const trimmedName = newSubjectName.trim();
  const choosingNew = subjectId === NEW_SUBJECT_VALUE;
  /** The preview cannot be planned without a subject, so nothing that would ask for one is offered until there is one. */
  const subjectReady = choosingNew ? trimmedName.length > 0 : true;

  function subjectChoice(): ApkgImportSubjectChoice {
    return choosingNew
      ? { existingSubjectId: null, newSubjectName: trimmedName }
      : { existingSubjectId: subjectId, newSubjectName: null };
  }

  async function runPreview(fileName: string, choice: ApkgImportSubjectChoice): Promise<void> {
    setState({ phase: "picked", fileName, busy: true, error: null });
    try {
      const result = await window.nexus.previewApkgImport(profileId, choice);
      switch (result.status) {
        case "ready":
          setState({ phase: "ready", fileName, preview: result.preview, busy: false, error: null });
          return;
        case "unreadable":
          setState({ phase: "picked", fileName, busy: false, error: s.unreadable[result.code] });
          return;
        case "no-file":
          setState({ phase: "idle", error: s.noFileError });
          return;
      }
    } catch (previewError) {
      setState({ phase: "picked", fileName, busy: false, error: s.readError });
      console.error("Nexus: failed to preview an .apkg:", previewError);
    }
  }

  /** Picking from any phase starts over — main drops the superseded pick itself. */
  async function choose(): Promise<void> {
    setState({ phase: "idle", error: null });
    try {
      const picked = await window.nexus.pickApkgFile();
      if (picked.canceled) return;
      await runPreview(picked.fileName, subjectChoice());
    } catch (pickError) {
      setState({ phase: "idle", error: s.readError });
      console.error("Nexus: failed to pick an .apkg:", pickError);
    }
  }

  /**
   * Re-previews under a changed subject. Main re-uses the collection it already
   * read, so this costs a re-translate and a re-plan rather than a second walk
   * over the file — which is what lets the user try the choice both ways.
   */
  function reprovision(nextChoice: ApkgImportSubjectChoice): void {
    if (state.phase !== "ready" && state.phase !== "picked") return;
    if (state.busy) return;
    void runPreview(state.fileName, nextChoice);
  }

  /**
   * Switching TO „Nova oblast…" while a preview is on screen: the plan showing
   * is the previous subject's, and a „Uvezi" pressed against it would write
   * somewhere the picker no longer says. So the preview is dropped back to the
   * picked state until a name exists to re-plan on — the file itself is
   * untouched, so that costs nothing.
   */
  function invalidatePreview(): void {
    if (state.phase !== "ready") return;
    setState({ phase: "picked", fileName: state.fileName, busy: false, error: null });
  }

  async function apply(fileName: string, preview: ApkgImportPreview): Promise<void> {
    applying.current = true;
    setState({ phase: "applying", fileName, preview });
    try {
      await window.nexus.applyApkgImport(profileId, preview.token);
      // Main reloads this renderer moments after the reply lands, so the success
      // line simply stands until the whole screen is replaced.
      setState({ phase: "applied" });
    } catch (applyError) {
      // A failed apply leaves the plan — and the token main accepts — untouched,
      // so the screen goes back to it rather than to idle.
      setState({ phase: "ready", fileName, preview, busy: false, error: s.error });
      console.error("Nexus: failed to apply an .apkg import:", applyError);
    } finally {
      applying.current = false;
    }
  }

  async function cancel(): Promise<void> {
    setState({ phase: "idle", error: null });
    try {
      await window.nexus.cancelApkgImport();
    } catch (cancelError) {
      console.error("Nexus: failed to release the picked .apkg:", cancelError);
    }
  }

  const previewing = state.phase === "ready" || state.phase === "applying";
  const busy = (state.phase === "picked" || state.phase === "ready") && state.busy;

  return (
    <div className="set__import-block">
      {showTitle && (
        <h3 className={labelClass("nx-eyebrow set__module-group-title", hits.has("backup-apkg"))}>
          {s.title}
        </h3>
      )}
      <p className="nx-hint">{s.description}</p>

      {state.phase !== "applied" && (
        <div className="set__apkg-subject">
          <Select
            label={s.subjectLabel}
            className="set__select"
            value={subjectId}
            disabled={busy || state.phase === "applying"}
            onChange={(event) => {
              const next = event.target.value;
              setSubjectId(next);
              if (next === NEW_SUBJECT_VALUE) {
                invalidatePreview();
                return;
              }
              reprovision({ existingSubjectId: next, newSubjectName: null });
            }}
          >
            <option value={NEW_SUBJECT_VALUE}>{s.newSubjectOption}</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
          {choosingNew && (
            <TextField
              label={s.newSubjectLabel}
              placeholder={s.newSubjectPlaceholder}
              value={newSubjectName}
              disabled={busy || state.phase === "applying"}
              onChange={(event) => {
                setNewSubjectName(event.target.value);
                // The plan on screen was made for the previous name; it stops
                // describing what „Uvezi" would do the moment this changes.
                invalidatePreview();
              }}
              // Committed on blur and on Enter, never on every keystroke: a
              // re-plan is cheap but it is not free, and re-running it per
              // letter would make the preview flicker while somebody types.
              onBlur={() => {
                if (trimmedName.length > 0) {
                  reprovision({ existingSubjectId: null, newSubjectName: trimmedName });
                }
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || trimmedName.length === 0) return;
                event.preventDefault();
                reprovision({ existingSubjectId: null, newSubjectName: trimmedName });
              }}
            />
          )}
        </div>
      )}

      {!previewing && state.phase !== "applied" && (
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !subjectReady}
          onClick={() => void choose()}
        >
          {s.pickButton}
        </Button>
      )}

      {state.phase === "idle" && state.error != null && <p className="set__error">{state.error}</p>}

      {state.phase === "picked" && (
        <>
          <p className="nx-hint">
            {shared.pickedPrefix} <span className="app__path">{state.fileName}</span>
          </p>
          {state.busy && <p className="nx-hint">{s.previewRunning}</p>}
          {state.error != null && <p className="set__error">{state.error}</p>}
        </>
      )}

      {previewing && (
        <>
          <div className="set__restore-head">
            <span className="app__path">{state.preview.fileName}</span>
            <span className="set__restore-meta">
              {s.subjectPrefix} {state.preview.subjectName}
              {state.preview.subjectIsNew ? ` ${s.subjectNewSuffix}` : ""}
            </span>
          </div>

          <table className="set__restore-table">
            <thead>
              <tr>
                {/* The row-header column's own corner cell: a row name needs no heading. */}
                <td />
                <th scope="col">{s.columnSource}</th>
                <th scope="col">{s.columnPlanned}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{s.rowDecks}</th>
                <td>{state.preview.sourceDecks}</td>
                <td>{state.preview.plannedDecks}</td>
              </tr>
              <tr>
                <th scope="row">{s.rowNotes}</th>
                <td>{state.preview.sourceNotes}</td>
                <td>{state.preview.plannedNotes}</td>
              </tr>
              <tr>
                <th scope="row">{s.rowCards}</th>
                <td>{state.preview.sourceCards}</td>
                <td>{state.preview.plannedCards}</td>
              </tr>
            </tbody>
          </table>

          {/* The plan's OWN arithmetic, from the same planner the archive import
              uses, narrowed to the modules that carry anything — an `.apkg`
              touches only Učenje, and five rows of zeros would say nothing. */}
          <table className="set__restore-table set__import-table">
            <thead>
              <tr>
                <td />
                <th scope="col">{strings.settings.import.columnParsed}</th>
                <th scope="col">{strings.settings.import.columnImported}</th>
                <th scope="col">{strings.settings.import.columnMerged}</th>
                <th scope="col">{strings.settings.import.columnSkipped}</th>
              </tr>
            </thead>
            <tbody>
              {ARCHIVE_MODULES.filter((key) => state.preview.modules[key].parsed > 0).map((key) => {
                const counts = state.preview.modules[key];
                return (
                  <tr key={key}>
                    <th scope="row">{shared.modules[key]}</th>
                    <td>{counts.parsed}</td>
                    <td>{counts.imported}</td>
                    <td>{counts.merged}</td>
                    <td>{counts.skipped}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {state.preview.skips.length > 0 && (
            <>
              <h4 className="nx-eyebrow set__module-group-title">{s.skipsTitle}</h4>
              <ul className="set__restore-problems">
                {state.preview.skips.map((skip) => (
                  <ApkgSkipRow key={skip.code} skip={skip} />
                ))}
              </ul>
            </>
          )}

          {state.preview.plannedCards === 0 && (
            <p className="nx-hint">{s.nothingToImport}</p>
          )}

          <div className="set__restore-actions">
            {state.preview.plannedCards > 0 && (
              <Button
                size="sm"
                variant="primary"
                disabled={state.phase === "applying"}
                onClick={() => void apply(state.fileName, state.preview)}
              >
                {s.applyButton}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={state.phase === "applying"}
              onClick={() => void cancel()}
            >
              {shared.cancelButton}
            </Button>
          </div>

          {state.phase === "applying" && <p className="nx-hint">{s.applying}</p>}
          {state.phase === "ready" && state.busy && <p className="nx-hint">{s.previewRunning}</p>}
          {state.phase === "ready" && state.error != null && <p className="set__error">{state.error}</p>}
        </>
      )}

      {state.phase === "applied" && <p className="nx-hint">{s.applied}</p>}
    </div>
  );
}

/** „Nova lista…" as a `<select>` value — an empty option value, exactly as `NEW_SUBJECT_VALUE` is, so no sentinel can collide with a real list id. */
const NEW_LIST_VALUE = "";

/**
 * The CSV flow's state (ADR-062). The `.apkg` machine plus the one phase a
 * schemaless file needs: `mapping`, where the house dialog is open and the
 * user says which column is which. `planned` keeps the confirmed roles so
 * „Izmeni mapiranje" reopens the dialog exactly as it was left.
 */
type CsvState =
  | { phase: "idle"; error: string | null }
  | { phase: "picked"; fileName: string; busy: boolean; error: string | null }
  | {
      phase: "mapping";
      preview: CsvImportPreview;
      roles: CsvImportColumnRole[];
      busy: boolean;
      error: string | null;
    }
  | {
      phase: "planned";
      preview: CsvImportPreview;
      roles: CsvImportColumnRole[];
      plan: CsvImportPlanPreview;
      error: string | null;
    }
  | { phase: "applying"; plan: CsvImportPlanPreview }
  | { phase: "applied" };

interface CsvMappingDialogProps {
  preview: CsvImportPreview;
  roles: CsvImportColumnRole[];
  /** The destination-list choice, lifted to the section so it survives a re-parse (the roles do not — they belong to the parse). */
  lists: TaskList[];
  listId: string;
  newListName: string;
  busy: boolean;
  error: string | null;
  onRoleChange: (column: number, role: CsvImportColumnRole) => void;
  /** A toggle re-parses in MAIN under the override; the fresh columns (and fresh suggestions) replace these. */
  onDelimiterChange: (delimiter: CsvImportDelimiter) => void;
  onHeaderChange: (hasHeader: boolean) => void;
  onListIdChange: (listId: string) => void;
  onNewListNameChange: (name: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The mapping step (ADR-062), on the house dialog recipe — the recur-dialog
 * classes outright, widened for a column list and scrolling in its body, the
 * shortcuts reference's own treatment. One row per detected column: what the
 * file calls it, its first values, and a role select pre-filled with the
 * header table's SUGGESTION — confirmed here, never silently committed.
 *
 * The delimiter and header toggles re-parse in main and REPLACE the columns
 * (and their suggestions): a role chosen against one parse must not survive
 * into a parse whose columns may no longer line up.
 *
 * Escape and the backdrop cancel the whole flow, dropping main's pick — the
 * dialog IS the flow's middle, so backing out of it is backing out of the
 * import.
 */
function CsvMappingDialog({
  preview,
  roles,
  lists,
  listId,
  newListName,
  busy,
  error,
  onRoleChange,
  onDelimiterChange,
  onHeaderChange,
  onListIdChange,
  onNewListNameChange,
  onConfirm,
  onCancel,
}: CsvMappingDialogProps) {
  const s = strings.settings.csvImport;
  const shared = strings.settings.restore;
  const titleId = useId();
  const questionId = useId();
  // One prefix for the column headings, suffixed by index: each role picker is
  // named by its own column's heading rather than by a rendered label.
  const columnNameId = useId();

  // Focus lands on the first role select: the dialog exists to be answered,
  // and the first answer is the first column's — the trap's own default (the
  // first tabbable descendant), since the toggles/selects come before
  // „Otkaži". It also cycles Tab within the panel and hands focus back on close.
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const choosingNew = listId === NEW_LIST_VALUE;
  const titleMapped = roles.filter((role) => role === "title").length === 1;
  const listReady = choosingNew ? newListName.trim().length > 0 : true;

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onCancel} />
      <div
        ref={panelRef}
        className="csv-map__panel recur-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={questionId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.mapTitle}
        </h2>
        <p className="recur-dialog__name app__path">{preview.fileName}</p>
        <p id={questionId} className="nx-hint">
          {s.mapQuestion}
        </p>

        <div className="csv-map__body">
          <div className="csv-map__toggles">
            {/* Labelled ONCE. This block used to wrap the select in a `<label>`,
                put the name in a caption span inside it, AND repeat the same
                string as an `aria-label` — three declarations of one name, two
                of which could drift from the third. */}
            <Select
              label={s.delimiterLabel}
              className="set__select"
              value={preview.delimiter}
              disabled={busy}
              onChange={(event) => onDelimiterChange(event.target.value === ";" ? ";" : ",")}
            >
              <option value=",">{s.delimiterComma}</option>
              <option value=";">{s.delimiterSemicolon}</option>
            </Select>
            <Checkbox
              checked={preview.hasHeader}
              disabled={busy}
              onChange={(event) => onHeaderChange(event.target.checked)}
            >
              {s.headerLabel}
            </Checkbox>
          </div>

          {preview.columns.map((column, index) => {
            const name =
              column.header !== null && column.header.trim().length > 0
                ? column.header
                : `${s.columnFallbackPrefix} ${index + 1}`;
            const samples = column.samples.filter((sample) => sample.trim().length > 0);
            return (
              <div className="csv-map__column" key={index}>
                <div className="csv-map__column-facts">
                  <span className="csv-map__column-name" id={`${columnNameId}-${index}`}>
                    {name}
                  </span>
                  <span className="csv-map__samples">
                    {s.samplesLabel} {samples.length > 0 ? samples.join(" · ") : "—"}
                  </span>
                </div>
                {/* Named by the COLUMN, whose heading is on screen two lines
                    up: a rendered `label` would print „Uloga“ once per column
                    in a table whose whole point is the column names. This is
                    the case `Select`'s doc had always described and had no way
                    to express, which is why it was the last hand-written select
                    on this page. */}
                <Select
                  className="set__select"
                  value={roles[index] ?? "ignore"}
                  aria-labelledby={`${columnNameId}-${index}`}
                  disabled={busy}
                  onChange={(event) => {
                    const role = CSV_IMPORT_COLUMN_ROLES.find(
                      (candidate) => candidate === event.target.value,
                    );
                    onRoleChange(index, role ?? "ignore");
                  }}
                >
                  {CSV_IMPORT_COLUMN_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {s.roles[role]}
                    </option>
                  ))}
                </Select>
              </div>
            );
          })}
          {!titleMapped && <p className="nx-hint">{s.titleRequired}</p>}

          <div className="csv-map__list">
            <Select
              label={s.listLabel}
              className="set__select"
              value={listId}
              disabled={busy}
              onChange={(event) => onListIdChange(event.target.value)}
            >
              <option value={NEW_LIST_VALUE}>{s.newListOption}</option>
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </Select>
            {choosingNew && (
              <TextField
                label={s.newListLabel}
                placeholder={s.newListPlaceholder}
                value={newListName}
                disabled={busy}
                onChange={(event) => onNewListNameChange(event.target.value)}
              />
            )}
          </div>

          {error != null && <p className="set__error">{error}</p>}
        </div>

        <div className="recur-dialog__actions csv-map__actions">
          <Button size="sm" variant="primary" disabled={busy || !titleMapped || !listReady} onClick={onConfirm}>
            {s.confirmButton}
          </Button>
          <Button className="recur-dialog__cancel" onClick={onCancel}>
            {shared.cancelButton}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface CsvImportSectionProps {
  profileId: string;
  /** SET-014 search hits; the section reads only its own entry id out of it. */
  hits: ReadonlySet<string>;
  /** SET-015: Settings now draws this flow's heading as the card's own title, so the heading is suppressed there. */
  showTitle?: boolean;
}

/**
 * Uvoz zadataka (.csv) — ADR-062.
 *
 * Deliberately the `.apkg` section's twin, one step longer: pick → MAP →
 * preview → confirm, the same busy and error states, the same `set__` recipes,
 * the same shared undo banner afterwards. The extra step is the one thing a
 * CSV cannot answer for itself — it has no fixed schema — so the mapping
 * dialog asks, with the header table's suggestion pre-filled.
 *
 * The destination-list choice lives in the SECTION's state rather than the
 * dialog's, exactly as the `.apkg` subject does: it survives the re-parses a
 * delimiter toggle causes, and resets where a new pick starts. The ROLES live
 * with the parse they were suggested against — a re-parse replaces both.
 *
 * The plan preview shows the planner's own per-module arithmetic (the same
 * table every import shows, narrowed to the modules that carry anything — for
 * a CSV only Zadaci) above the translator's row-by-row drops, each named with
 * the row number the user's spreadsheet shows.
 */
function CsvImportSection({ profileId, hits, showTitle = true }: CsvImportSectionProps) {
  const s = strings.settings.csvImport;
  // The half of the flow that is identical to its siblings', read from where
  // it is already spelled rather than spelled a second time.
  const shared = strings.settings.restore;

  const [state, setState] = useState<CsvState>({ phase: "idle", error: null });
  const [lists, setLists] = useState<TaskList[]>([]);
  // Outside the state machine for the reason the `.apkg` subject is: the
  // choice survives the phase changes around it, and resets where a new pick
  // starts.
  const [listId, setListId] = useState<string>(NEW_LIST_VALUE);
  const [newListName, setNewListName] = useState("");
  // Read by the unmount cleanup only. An apply in flight must never be
  // cancelled from here: main is writing the very plan `cancelCsvImport`
  // would drop.
  const applying = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const snapshot = await window.nexus.listTaskLists(profileId);
        if (active) setLists(snapshot.lists);
      } catch (loadError) {
        // The list is a convenience: „Nova lista" still works without it, so
        // this must not take the whole block down.
        console.error("Nexus: failed to load task lists:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  // Releasing the pick on unmount matters for the `.apkg` section's reason:
  // main is holding the file's text and parsed cells until it is told to let go.
  useEffect(() => {
    return () => {
      if (applying.current) return;
      void window.nexus.cancelCsvImport().catch((error: unknown) => {
        console.error("Nexus: failed to release the picked CSV:", error);
      });
    };
  }, []);

  function listChoice(): CsvImportListChoice {
    return listId === NEW_LIST_VALUE
      ? { existingListId: null, newListName: newListName.trim() }
      : { existingListId: listId, newListName: null };
  }

  /**
   * Parses (or re-parses) in main and opens the mapping dialog on the result.
   * The roles are RESET to the fresh parse's suggestions on purpose: a role
   * chosen against one parse must not survive into a parse whose columns may
   * no longer line up.
   */
  async function runPreview(
    fileName: string,
    delimiter: CsvImportDelimiter | null,
    hasHeader: boolean | null,
  ): Promise<void> {
    setState((previous) =>
      previous.phase === "mapping"
        ? { ...previous, busy: true, error: null }
        : { phase: "picked", fileName, busy: true, error: null },
    );
    try {
      const result = await window.nexus.previewCsvImport(profileId, delimiter, hasHeader);
      switch (result.status) {
        case "ready":
          setState({
            phase: "mapping",
            preview: result.preview,
            roles: result.preview.columns.map((column) => column.suggestedRole),
            busy: false,
            error: null,
          });
          return;
        case "unreadable":
          setState({ phase: "picked", fileName, busy: false, error: s.unreadable[result.code] });
          return;
        case "no-file":
          setState({ phase: "idle", error: s.noFileError });
          return;
      }
    } catch (previewError) {
      setState({ phase: "picked", fileName, busy: false, error: s.readError });
      console.error("Nexus: failed to preview a CSV:", previewError);
    }
  }

  /** Picking from any phase starts over — main drops the superseded pick itself. */
  async function choose(): Promise<void> {
    setState({ phase: "idle", error: null });
    try {
      const picked = await window.nexus.pickCsvFile();
      if (picked.canceled) return;
      await runPreview(picked.fileName, null, null);
    } catch (pickError) {
      setState({ phase: "idle", error: s.readError });
      console.error("Nexus: failed to pick a CSV:", pickError);
    }
  }

  /** Confirms the mapping: main translates and plans the rows it already holds, and the dialog gives way to the plan. */
  async function confirmMapping(): Promise<void> {
    if (state.phase !== "mapping" || state.busy) return;
    const { preview, roles } = state;
    setState({ ...state, busy: true, error: null });
    try {
      const result = await window.nexus.mapCsvImport(profileId, roles, listChoice());
      if (result.status === "no-file") {
        setState({ phase: "idle", error: s.noFileError });
        return;
      }
      setState({ phase: "planned", preview, roles, plan: result.preview, error: null });
    } catch (mapError) {
      setState({ ...state, busy: false, error: s.mapError });
      console.error("Nexus: failed to map a CSV import:", mapError);
    }
  }

  async function apply(plan: CsvImportPlanPreview): Promise<void> {
    if (state.phase !== "planned") return;
    const { preview, roles } = state;
    applying.current = true;
    setState({ phase: "applying", plan });
    try {
      await window.nexus.applyCsvImport(profileId, plan.token);
      // Main reloads this renderer moments after the reply lands, so the
      // success line simply stands until the whole screen is replaced.
      setState({ phase: "applied" });
    } catch (applyError) {
      // A failed apply leaves the plan — and the token main accepts —
      // untouched, so the screen goes back to it rather than to idle.
      setState({ phase: "planned", preview, roles, plan, error: s.error });
      console.error("Nexus: failed to apply a CSV import:", applyError);
    } finally {
      applying.current = false;
    }
  }

  async function cancel(): Promise<void> {
    setState({ phase: "idle", error: null });
    try {
      await window.nexus.cancelCsvImport();
    } catch (cancelError) {
      console.error("Nexus: failed to release the picked CSV:", cancelError);
    }
  }

  const planned = state.phase === "planned" || state.phase === "applying";

  return (
    <div className="set__import-block">
      {showTitle && (
        <h3 className={labelClass("nx-eyebrow set__module-group-title", hits.has("backup-csv"))}>
          {s.title}
        </h3>
      )}
      <p className="nx-hint">{s.description}</p>

      {!planned && state.phase !== "applied" && (
        <Button
          size="sm"
          variant="primary"
          disabled={state.phase === "picked" && state.busy}
          onClick={() => void choose()}
        >
          {s.pickButton}
        </Button>
      )}

      {state.phase === "idle" && state.error != null && <p className="set__error">{state.error}</p>}

      {state.phase === "picked" && (
        <>
          <p className="nx-hint">
            {shared.pickedPrefix} <span className="app__path">{state.fileName}</span>
          </p>
          {state.busy && <p className="nx-hint">{s.reading}</p>}
          {state.error != null && <p className="set__error">{state.error}</p>}
        </>
      )}

      {state.phase === "mapping" && (
        <CsvMappingDialog
          preview={state.preview}
          roles={state.roles}
          lists={lists}
          listId={listId}
          newListName={newListName}
          busy={state.busy}
          error={state.error}
          onRoleChange={(column, role) => {
            setState((previous) => {
              if (previous.phase !== "mapping") return previous;
              const roles = [...previous.roles];
              // A role means ONE column (the wire refuses a repeat), so
              // claiming it takes it away from whichever column held it.
              if (role !== "ignore") {
                for (let index = 0; index < roles.length; index += 1) {
                  if (index !== column && roles[index] === role) roles[index] = "ignore";
                }
              }
              roles[column] = role;
              return { ...previous, roles };
            });
          }}
          onDelimiterChange={(delimiter) =>
            void runPreview(state.preview.fileName, delimiter, state.preview.hasHeader)
          }
          onHeaderChange={(hasHeader) =>
            void runPreview(state.preview.fileName, state.preview.delimiter, hasHeader)
          }
          onListIdChange={setListId}
          onNewListNameChange={setNewListName}
          onConfirm={() => void confirmMapping()}
          onCancel={() => void cancel()}
        />
      )}

      {planned && (
        <>
          <div className="set__restore-head">
            <span className="app__path">{state.plan.fileName}</span>
            <span className="set__restore-meta">
              {s.listPrefix} {state.plan.listName}
              {state.plan.listIsNew ? ` ${s.listNewSuffix}` : ""}
            </span>
          </div>

          <table className="set__restore-table">
            <tbody>
              <tr>
                <th scope="row">{s.rowRows}</th>
                <td>{state.plan.rows}</td>
              </tr>
              <tr>
                <th scope="row">{s.rowTasks}</th>
                <td>{state.plan.tasks}</td>
              </tr>
            </tbody>
          </table>
          {state.plan.blankRows > 0 && (
            <p className="nx-hint">
              {s.blankRowsPrefix} {state.plan.blankRows}
            </p>
          )}

          {/* The plan's OWN arithmetic, from the same planner every import
              uses, narrowed to the modules that carry anything — a CSV
              touches only Zadaci, and five rows of zeros would say nothing. */}
          <table className="set__restore-table set__import-table">
            <thead>
              <tr>
                <td />
                <th scope="col">{strings.settings.import.columnParsed}</th>
                <th scope="col">{strings.settings.import.columnImported}</th>
                <th scope="col">{strings.settings.import.columnMerged}</th>
                <th scope="col">{strings.settings.import.columnSkipped}</th>
              </tr>
            </thead>
            <tbody>
              {ARCHIVE_MODULES.filter((key) => state.plan.modules[key].parsed > 0).map((key) => {
                const counts = state.plan.modules[key];
                return (
                  <tr key={key}>
                    <th scope="row">{shared.modules[key]}</th>
                    <td>{counts.parsed}</td>
                    <td>{counts.imported}</td>
                    <td>{counts.merged}</td>
                    <td>{counts.skipped}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {(state.plan.drops.length > 0 || state.plan.listCellsDropped > 0) && (
            <>
              <h4 className="nx-eyebrow set__module-group-title">{s.dropsTitle}</h4>
              <ul className="set__restore-problems">
                {state.plan.drops.map((drop, index) => (
                  <li className="set__import-skip" key={`${drop.row}-${drop.code}-${index}`}>
                    <span className="set__import-skip-meta">
                      {s.dropRowPrefix} {drop.row}
                    </span>{" "}
                    {s.drops[drop.code]}
                  </li>
                ))}
                {state.plan.listCellsDropped > 0 && (
                  <li className="set__import-skip">
                    {s.listCellsDroppedPrefix}{" "}
                    <span className="set__import-skip-meta">{state.plan.listCellsDropped}</span>{" "}
                    {s.listCellsDroppedSuffix}
                  </li>
                )}
              </ul>
            </>
          )}

          {state.plan.tasks === 0 && <p className="nx-hint">{s.nothingToImport}</p>}

          <div className="set__restore-actions">
            {state.plan.tasks > 0 && (
              <Button
                size="sm"
                variant="primary"
                disabled={state.phase === "applying"}
                onClick={() => state.phase === "planned" && void apply(state.plan)}
              >
                {s.applyButton}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={state.phase === "applying"}
              onClick={() => {
                // Back to the dialog with everything as it was left: the rows
                // are still in main, so confirming again is a re-plan.
                if (state.phase !== "planned") return;
                setState({
                  phase: "mapping",
                  preview: state.preview,
                  roles: state.roles,
                  busy: false,
                  error: null,
                });
              }}
            >
              {s.remapButton}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={state.phase === "applying"}
              onClick={() => void cancel()}
            >
              {shared.cancelButton}
            </Button>
          </div>

          {state.phase === "applying" && <p className="nx-hint">{s.applying}</p>}
          {state.phase === "planned" && state.error != null && (
            <p className="set__error">{state.error}</p>
          )}
        </>
      )}

      {state.phase === "applied" && <p className="nx-hint">{s.applied}</p>}
    </div>
  );
}

/**
 * The note folders as flat, full-path options („Fakultet / Beleške"), so two
 * folders that share a name under different parents are told apart without
 * drawing a tree inside a `<select>`. Cycle-safe by construction: the walk up
 * stops the moment it revisits an id.
 */
function folderOptions(folders: readonly NoteFolder[]): { id: string; label: string }[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const pathOf = (folder: NoteFolder): string => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let current: NoteFolder | undefined = folder;
    while (current !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      parts.unshift(current.name);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return parts.join(" / ");
  };
  return folders
    .map((folder) => ({ id: folder.id, label: pathOf(folder) }))
    .sort((a, b) => collator().compare(a.label, b.label));
}

/** The half of a finished import worth rendering — the canceled arm carries nothing to show. */
type MarkdownImportReport = Extract<MarkdownImportResult, { canceled: false }>;

/**
 * The LLM import's state. The import block's machine minus the two phases this
 * flow cannot reach: there is no pick (the source is a textarea) and no
 * passphrase, so „idle" and „picked" collapse into one editing state.
 */
type LlmState =
  | { phase: "editing"; busy: boolean; error: string | null }
  | { phase: "ready"; preview: LlmImportPreview; busy: boolean; error: string | null }
  | { phase: "applying"; preview: LlmImportPreview }
  | { phase: "applied" };

/** One skipped entry of the answer: which position it was at, then why. */
function LlmSkipRow({ skip }: { skip: LlmImportSkip }) {
  const s = strings.settings.llmImport;
  return (
    <li className="set__import-skip">
      <span className="set__import-skip-meta">
        {s.skipRecordPrefix} {skip.index + 1}
      </span>{" "}
      {s.skips[skip.reason]}
    </li>
  );
}

interface LlmImportSectionProps {
  profileId: string;
  /** SET-014 search hits; the section reads only its own entry id out of it. */
  hits: ReadonlySet<string>;
  /** SET-015: Settings now draws this flow's heading as the card's own title, so the heading is suppressed there. */
  showTitle?: boolean;
}

/**
 * Uvoz preko AI asistenta — IMEX-005.
 *
 * The only block in this card whose source is neither a file nor a dialog: the
 * user takes a generated instruction to their OWN assistant and brings the
 * answer back. Nexus calls no model — `buildLlmPrompt` is a pure function of
 * `@nexus/core`, so the prompt is composed right here and main never sees it —
 * and that is stated in the block's own description rather than left to be
 * inferred.
 *
 * Read top to bottom it is the four steps in order: what → the instruction →
 * the answer → the preview. The deck choice appears only for kartice, because
 * it is the one decision an answer cannot make for itself, and it is a
 * PRECONDITION rather than a refinement — nothing can be planned without it,
 * exactly as the `.apkg` block's subject cannot. Two paths, „Postojeći špil /
 * Novi špil": a new deck lives under an existing subject, so a profile with no
 * subject at all is the one honest dead end left.
 *
 * The kind and the prompt language are DEVICE preferences (`llmImportPrefs`),
 * read once on mount and persisted on every change, so the block reopens on
 * what this machine last imported rather than on its defaults.
 *
 * The prompt is shown as well as copied. A clipboard write can fail, and a
 * „Kopiraj" that silently did nothing would leave the user with no way through
 * at all; the disclosure is also the only honest way to let somebody read what
 * they are about to paste into a chat.
 */
function LlmImportSection({ profileId, hits, showTitle = true }: LlmImportSectionProps) {
  const s = strings.settings.llmImport;
  const shared = strings.settings.restore;

  const [kind, setKind] = useState<LlmImportKind>(readStoredLlmImportKind);
  const [language, setLanguage] = useState<LlmPromptLanguage>(readStoredLlmPromptLanguage);
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [answer, setAnswer] = useState("");
  const [decks, setDecks] = useState<{ id: string; label: string }[]>([]);
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [deckMode, setDeckMode] = useState<"existing" | "new">("existing");
  const [deckId, setDeckId] = useState<string>("");
  const [newDeckName, setNewDeckName] = useState("");
  const [newDeckSubjectId, setNewDeckSubjectId] = useState<string>("");
  // The duplicate answer the plan on screen was computed with (ADR-051) —
  // committed only once main has actually re-planned on it, never
  // optimistically, exactly as the import block's `choices` is.
  const [importDuplicates, setImportDuplicates] = useState(false);
  const [state, setState] = useState<LlmState>({ phase: "editing", busy: false, error: null });
  // Read by the unmount cleanup only. An apply in flight must never be cancelled
  // from here: main is writing the very plan `cancelLlmImport` would drop.
  const applying = useRef(false);

  const prompt = useMemo(() => buildLlmPrompt(kind, language), [kind, language]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [deckList, subjectList] = await Promise.all([
          window.nexus.listDecks(profileId),
          window.nexus.listSubjects(profileId),
        ]);
        if (!active) return;
        // „Oblast / Špil", because two subjects may each hold a „Kolokvijum"
        // and the deck name alone would not tell them apart.
        const subjectNames = new Map(subjectList.map((subject) => [subject.id, subject.name]));
        setDecks(
          deckList.map((deck) => ({
            id: deck.id,
            label: `${subjectNames.get(deck.subjectId) ?? ""} / ${deck.name}`,
          })),
        );
        setSubjects(subjectList.map((subject) => ({ id: subject.id, name: subject.name })));
        // With no deck to pick, „Postojeći špil" opens on a dead end — so a
        // profile that has none opens on the path that can actually proceed.
        if (deckList.length === 0) setDeckMode("new");
      } catch (loadError) {
        // Only the cards branch needs this, and it says so out loud when the
        // list is empty — so a failure here must not take the whole block down.
        console.error("Nexus: failed to load decks:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  // Releasing the plan on unmount matters for the reason the three file blocks'
  // does, and for one more: the plan main is holding was built out of the user's
  // own pasted content.
  useEffect(() => {
    return () => {
      if (applying.current) return;
      void window.nexus.cancelLlmImport().catch((error: unknown) => {
        console.error("Nexus: failed to release the parsed LLM answer:", error);
      });
    };
  }, []);

  /** The plan on screen was made for the previous choice; it stops describing what „Uvezi" would do the moment any input changes. */
  function invalidatePreview(): void {
    setState((current) =>
      current.phase === "ready" ? { phase: "editing", busy: false, error: null } : current,
    );
  }

  async function copy(): Promise<void> {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch (error) {
      setCopyError(true);
      // The prompt is revealed rather than left inaccessible: the user can
      // still select it by hand, which is the whole reason it is on screen.
      setShowPrompt(true);
      console.error("Nexus: failed to copy the LLM prompt:", error);
    }
  }

  const needsDeck = kind === "cards";
  const trimmedDeckName = newDeckName.trim();
  const deckReady =
    !needsDeck ||
    (subjects.length > 0 &&
      (deckMode === "existing"
        ? deckId.length > 0
        : trimmedDeckName.length > 0 && newDeckSubjectId.length > 0));

  /** The deck the preview is planned against, in the wire's own closed shape — null for the two kinds that need none. */
  function deckChoice(): LlmImportDeckChoice | null {
    if (!needsDeck) return null;
    return deckMode === "existing"
      ? { existingDeckId: deckId }
      : { newDeckName: trimmedDeckName, subjectId: newDeckSubjectId };
  }

  async function runPreview(): Promise<void> {
    setState({ phase: "editing", busy: true, error: null });
    try {
      const result = await window.nexus.previewLlmImport(profileId, kind, answer, deckChoice());
      switch (result.status) {
        case "ready":
          // A fresh preview is always planned on the default (duplicates
          // skipped), so the choice on screen starts there too.
          setImportDuplicates(false);
          setState({ phase: "ready", preview: result.preview, busy: false, error: null });
          return;
        case "unreadable":
          setState({ phase: "editing", busy: false, error: s.unreadable[result.code] });
          return;
        case "kind-mismatch":
          setState({
            phase: "editing",
            busy: false,
            error: `${s.kindMismatchPrefix} ${s.kindsInline[result.answered]} ${s.kindMismatchSuffix}`,
          });
          return;
      }
    } catch (previewError) {
      setState({ phase: "editing", busy: false, error: s.readError });
      console.error("Nexus: failed to preview an LLM answer:", previewError);
    }
  }

  /**
   * Re-plans the parsed answer under the other duplicate choice (ADR-051) and
   * swaps in the fresh preview — and, with it, the fresh token, since the plan
   * the old one named no longer exists. The import block's `chooseDuplicate`,
   * narrowed to the one group an LLM answer can produce: a rejected re-plan
   * leaves the preview, the token and the buttons exactly as they were.
   */
  async function chooseDuplicates(preview: LlmImportPreview, next: boolean): Promise<void> {
    setState({ phase: "ready", preview, busy: true, error: null });
    try {
      const result = await window.nexus.replanLlmImport(profileId, preview.token, next);
      if (result.status === "ready") {
        setImportDuplicates(next);
        setState({ phase: "ready", preview: result.preview, busy: false, error: null });
        return;
      }
      setState({
        phase: "ready",
        preview,
        busy: false,
        error: strings.settings.import.duplicateError,
      });
    } catch (replanError) {
      setState({
        phase: "ready",
        preview,
        busy: false,
        error: strings.settings.import.duplicateError,
      });
      console.error("Nexus: failed to re-plan an LLM import:", replanError);
    }
  }

  async function apply(preview: LlmImportPreview): Promise<void> {
    applying.current = true;
    setState({ phase: "applying", preview });
    try {
      await window.nexus.applyLlmImport(profileId, preview.token);
      // Main reloads this renderer moments after the reply lands, so the success
      // line simply stands until the whole screen is replaced.
      setState({ phase: "applied" });
    } catch (applyError) {
      // A failed apply leaves the plan — and the token main accepts — untouched,
      // so the screen goes back to it rather than to editing.
      setState({ phase: "ready", preview, busy: false, error: s.error });
      console.error("Nexus: failed to apply an LLM import:", applyError);
    } finally {
      applying.current = false;
    }
  }

  async function cancel(): Promise<void> {
    setState({ phase: "editing", busy: false, error: null });
    try {
      await window.nexus.cancelLlmImport();
    } catch (cancelError) {
      console.error("Nexus: failed to release the parsed LLM answer:", cancelError);
    }
  }

  const previewing = state.phase === "ready" || state.phase === "applying";
  const busy = (state.phase === "editing" || state.phase === "ready") && state.busy;
  const frozen = busy || state.phase === "applying";
  // A re-plan is replacing the token this screen holds (ADR-051), so nothing
  // that would spend it — least of all the apply — may fire meanwhile.
  const replanning = state.phase === "ready" && state.busy;

  if (state.phase === "applied") {
    return (
      <div className="set__import-block">
        {showTitle && (
          <h3 className={labelClass("nx-eyebrow set__module-group-title", hits.has("backup-llm"))}>
            {s.title}
          </h3>
        )}
        <p className="nx-hint">{s.applied}</p>
      </div>
    );
  }

  return (
    <div className="set__import-block">
      {showTitle && (
        <h3 className={labelClass("nx-eyebrow set__module-group-title", hits.has("backup-llm"))}>
          {s.title}
        </h3>
      )}
      <p className="nx-hint">{s.description}</p>

      <p className="nx-hint">{s.kindLabel}</p>
      <div className="set__segmented" role="group" aria-label={s.kindLabel}>
        {LLM_IMPORT_KINDS.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={kind === option ? "primary" : "ghost"}
            aria-pressed={kind === option}
            disabled={frozen}
            onClick={() => {
              setKind(option);
              persistLlmImportKind(option);
              setCopied(false);
              invalidatePreview();
            }}
          >
            {s.kinds[option]}
          </Button>
        ))}
      </div>

      <p className="nx-hint">{s.languageLabel}</p>
      <div className="set__segmented" role="group" aria-label={s.languageLabel}>
        {LLM_PROMPT_LANGUAGES.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={language === option ? "primary" : "ghost"}
            aria-pressed={language === option}
            disabled={frozen}
            onClick={() => {
              setLanguage(option);
              persistLlmPromptLanguage(option);
              setCopied(false);
            }}
          >
            {s.languages[option]}
          </Button>
        ))}
      </div>

      <div className="set__restore-actions">
        <Button size="sm" variant="primary" disabled={frozen} onClick={() => void copy()}>
          {copied ? s.copied : s.copyButton}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowPrompt((open) => !open)}>
          {showPrompt ? s.promptHide : s.promptShow}
        </Button>
      </div>
      <p className="nx-hint">{s.copyHint}</p>
      {copyError && <p className="set__error">{s.copyError}</p>}

      {showPrompt && (
        // A named, focusable region: the block scrolls, and a scroll container
        // nothing can put focus into is one a keyboard cannot read.
        <pre className="set__llm-prompt" role="region" aria-label={s.promptLabel} tabIndex={0}>
          {prompt}
        </pre>
      )}

      {needsDeck &&
        (subjects.length === 0 ? (
          // The one honest dead end left: a new deck needs a subject to live
          // in, and this profile has none — the way out is named, not implied.
          <p className="nx-hint">{s.noSubjects}</p>
        ) : (
          <div className="set__llm-deck">
            <p className="nx-hint">{s.deckChoiceLabel}</p>
            <div className="set__segmented" role="group" aria-label={s.deckChoiceLabel}>
              {(["existing", "new"] as const).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={deckMode === option ? "primary" : "ghost"}
                  aria-pressed={deckMode === option}
                  disabled={frozen}
                  onClick={() => {
                    setDeckMode(option);
                    invalidatePreview();
                  }}
                >
                  {option === "existing" ? s.deckExistingOption : s.deckNewOption}
                </Button>
              ))}
            </div>
            {deckMode === "existing" ? (
              decks.length === 0 ? (
                <p className="nx-hint">{s.noDecks}</p>
              ) : (
                <Select
                  label={s.deckLabel}
                  className="set__select"
                  value={deckId}
                  disabled={frozen}
                  onChange={(event) => {
                    setDeckId(event.target.value);
                    invalidatePreview();
                  }}
                >
                  <option value="">{s.deckPlaceholder}</option>
                  {decks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.label}
                    </option>
                  ))}
                </Select>
              )
            ) : (
              <>
                <TextField
                  label={s.newDeckLabel}
                  placeholder={s.newDeckPlaceholder}
                  value={newDeckName}
                  disabled={frozen}
                  onChange={(event) => {
                    setNewDeckName(event.target.value);
                    // The plan on screen was made for the previous name; it
                    // stops describing what „Uvezi" would do the moment this
                    // changes.
                    invalidatePreview();
                  }}
                />
                <Select
                  label={s.newDeckSubjectLabel}
                  className="set__select"
                  value={newDeckSubjectId}
                  disabled={frozen}
                  onChange={(event) => {
                    setNewDeckSubjectId(event.target.value);
                    invalidatePreview();
                  }}
                >
                  <option value="">{s.newDeckSubjectPlaceholder}</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </Select>
              </>
            )}
          </div>
        ))}

      {/*
        „Odgovor asistenta" used to be written twice — a `<p class="nx-hint">`
        above the box and an `aria-label` on it — which is one name for the eye
        and a second for the reader, free to drift apart at the next edit. The
        component's label is a real `<label for>`: one string, and clicking it
        puts the cursor in the box.
      */}
      <TextArea
        className="set__llm-answer"
        label={s.answerLabel}
        value={answer}
        placeholder={s.answerPlaceholder}
        maxLength={LLM_IMPORT_MAX_ANSWER_LENGTH}
        disabled={frozen}
        onChange={(event) => {
          setAnswer(event.target.value);
          invalidatePreview();
        }}
      />

      {!previewing && (
        <Button
          size="sm"
          variant="primary"
          disabled={busy || answer.trim().length === 0 || !deckReady}
          onClick={() => void runPreview()}
        >
          {s.previewButton}
        </Button>
      )}

      {state.phase === "editing" && state.busy && <p className="nx-hint">{s.previewRunning}</p>}
      {state.phase === "editing" && state.error != null && (
        <p className="set__error">{state.error}</p>
      )}

      {previewing && (
        <>
          <table className="set__restore-table">
            <tbody>
              <tr>
                <th scope="row">{s.rowRecords}</th>
                <td>{state.preview.records}</td>
              </tr>
              <tr>
                <th scope="row">{s.rowAccepted}</th>
                <td>{state.preview.accepted}</td>
              </tr>
              <tr>
                <th scope="row">{s.rowPlanned}</th>
                <td>{state.preview.planned}</td>
              </tr>
            </tbody>
          </table>

          {state.preview.kind === "cards" && (
            <p className="nx-hint">{s.cardsCaption}</p>
          )}

          {/* ADR-051: the one part of the preview the user can still CHANGE.
              The sentence says which way the plan currently goes; the answer
              is the import block's own two-state pair, so the flows read as
              siblings. */}
          {state.preview.duplicates > 0 && (
            <div className="set__llm-duplicates">
              <p className="nx-hint">
                {s.duplicatesPrefix} {state.preview.duplicates}{" "}
                {countUnit(
                  state.preview.duplicates,
                  s.duplicatesUnitOne,
                  s.duplicatesUnitFew,
                  s.duplicatesUnitMany,
                )}{" "}
                {importDuplicates ? s.duplicatesSuffixImported : s.duplicatesSuffix}
              </p>
              <span
                className="set__llm-duplicate-choice"
                role="group"
                aria-label={strings.settings.import.duplicateChoiceLabel}
              >
                {DUPLICATE_CHOICES.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    className="nx-segmented__option set__import-choice"
                    aria-pressed={(option === "import") === importDuplicates}
                    disabled={frozen}
                    onClick={() => void chooseDuplicates(state.preview, option === "import")}
                  >
                    {option === "skip"
                      ? strings.settings.import.duplicateSkipButton
                      : strings.settings.import.duplicateImportButton}
                  </Button>
                ))}
              </span>
            </div>
          )}

          {state.preview.droppedFields > 0 && (
            <p className="nx-hint">
              {s.droppedPrefix} {state.preview.droppedFields}{" "}
              {countUnit(
                state.preview.droppedFields,
                s.droppedUnitOne,
                s.droppedUnitFew,
                s.droppedUnitMany,
              )}{" "}
              {s.droppedSuffix}
            </p>
          )}

          {state.preview.skipped.length > 0 && (
            <>
              <h4 className="nx-eyebrow set__module-group-title">{s.skipsTitle}</h4>
              <ul className="set__restore-problems">
                {state.preview.skipped.map((skip) => (
                  <LlmSkipRow key={skip.index} skip={skip} />
                ))}
              </ul>
            </>
          )}

          {state.preview.planned === 0 && (
            <p className="nx-hint">{s.nothingToImport}</p>
          )}

          <div className="set__restore-actions">
            {state.preview.planned > 0 && (
              <Button
                size="sm"
                variant="primary"
                disabled={state.phase === "applying" || replanning}
                onClick={() => void apply(state.preview)}
              >
                {s.applyButton}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={state.phase === "applying" || replanning}
              onClick={() => void cancel()}
            >
              {shared.cancelButton}
            </Button>
          </div>

          {state.phase === "applying" && <p className="nx-hint">{s.applying}</p>}
          {replanning && <p className="nx-hint">{shared.previewRunning}</p>}
          {state.phase === "ready" && state.error != null && (
            <p className="set__error">{state.error}</p>
          )}
        </>
      )}
    </div>
  );
}

interface MarkdownImportSectionProps {
  profileId: string;
  /** SET-014 search hits; the section reads only its own entry id out of it. */
  hits: ReadonlySet<string>;
  /** SET-015: Settings now draws this flow's heading as the card's own title, so the heading is suppressed there. */
  showTitle?: boolean;
}

/**
 * Uvoz beležaka (.md) — IMEX-007's markdown slice, and deliberately the
 * QUIETEST block in this card. Its two archive siblings above it are
 * multi-step, consequential flows with a preview and an undo; this one is a
 * destination, a button and a result line, because that is all it is: files
 * arrive as notes, nothing already here is touched, and anything that lands
 * wrong is deleted like any other note.
 *
 * There is therefore no state machine — no pick to hold, no token to confirm.
 * Main owns the dialog, the size gate and the parse (SEC-EL: the renderer sends
 * no path and no bytes), and what comes back is the whole report: how many
 * notes, how many images arrived as text, and every file that did not make it,
 * NAMED, with the reason beside it.
 */
function MarkdownImportSection({ profileId, hits, showTitle = true }: MarkdownImportSectionProps) {
  const s = strings.settings.markdownImport;
  const [folders, setFolders] = useState<{ id: string; label: string }[]>([]);
  const [folderId, setFolderId] = useState<string>(UNFILED_VALUE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<MarkdownImportReport | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await window.nexus.listNoteFolders(profileId);
        if (active) setFolders(folderOptions(list));
      } catch (loadError) {
        // The destination list is a convenience: without it the root option
        // still works, so this must not take the whole block down.
        console.error("Nexus: failed to load note folders:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  async function run(source: MarkdownImportSource): Promise<void> {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const outcome = await window.nexus.importMarkdownNotes(
        profileId,
        folderId === UNFILED_VALUE ? null : folderId,
        source,
      );
      if (!outcome.canceled) setReport(outcome);
    } catch (importError) {
      setError(s.error);
      console.error("Nexus: failed to import markdown notes:", importError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="set__import-block">
      {showTitle && (
        <h3
          className={labelClass("nx-eyebrow set__module-group-title", hits.has("backup-markdown"))}
        >
          {s.title}
        </h3>
      )}
      <p className="nx-hint">{s.description}</p>

      <Select
        label={s.folderLabel}
        className="set__select"
        value={folderId}
        disabled={busy}
        onChange={(event) => setFolderId(event.target.value)}
      >
        <option value={UNFILED_VALUE}>{s.rootOption}</option>
        {folders.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>

      <div className="set__restore-actions">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void run("files")}>
          {s.filesButton}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("folder")}>
          {s.folderButton}
        </Button>
      </div>
      <p className="nx-hint">{s.folderHint}</p>

      {busy && <p className="nx-hint">{s.running}</p>}
      {error != null && <p className="set__error">{error}</p>}

      {report !== null && (
        <>
          <p className="nx-hint">
            {report.created > 0
              ? `${s.createdPrefix} ${report.created} ${countUnit(report.created, s.createdUnitOne, s.createdUnitFew, s.createdUnitMany)}.`
              : s.createdNone}
          </p>
          {report.imagesAsText > 0 && (
            <p className="nx-hint">
              {s.imagesPrefix} {report.imagesAsText}{" "}
              {countUnit(report.imagesAsText, s.imagesUnitOne, s.imagesUnitFew, s.imagesUnitMany)}{" "}
              {s.imagesSuffix}
            </p>
          )}
          {report.skipped.length > 0 && (
            <>
              <h4 className="nx-eyebrow set__module-group-title">{s.skipsTitle}</h4>
              <ul className="set__restore-problems">
                {report.skipped.map((skip, index) => (
                  <li key={`${skip.name}-${skip.reason}-${index}`} className="set__import-skip">
                    {s.skips[skip.reason]}{" "}
                    <span className="set__import-skip-meta">{skip.name}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** A settings-form result line: green-ish caption on success, `.set__error` on failure — same idiom as `ProfileSection`/`BackupSection`, just shared across the two Sigurnost sub-forms. */
interface SecurityMessage {
  text: string;
  failed: boolean;
}

interface SecuritySectionProps {
  autoLockMinutes: AutoLockMinutes;
  onAutoLockChange: (value: AutoLockMinutes) => void;
  /** SET-014 search hits; the section reads only its own entry ids out of it. */
  hits: ReadonlySet<string>;
}

/**
 * Sigurnost section (ADR-018 / AUTH): change the passcode, regenerate the
 * Recovery Kit (reusing `AuthGate`'s own panel — never a second one), and the
 * idle auto-lock preference. Auth is whole-account, not per-profile, so unlike
 * every other section here this one takes no `profileId`.
 */
function SecuritySection({ autoLockMinutes, onAutoLockChange, hits }: SecuritySectionProps) {
  const [currentPasscode, setCurrentPasscode] = useState("");
  const [nextPasscode, setNextPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [changing, setChanging] = useState(false);
  const [changeMessage, setChangeMessage] = useState<SecurityMessage | null>(null);

  async function submitChange(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (changing) return;
    setChangeMessage(null);
    if (!passcodeMeetsPolicy(nextPasscode)) {
      setChangeMessage({ text: strings.auth.validation.tooWeak, failed: true });
      return;
    }
    if (nextPasscode !== confirmPasscode) {
      setChangeMessage({ text: strings.auth.validation.mismatch, failed: true });
      return;
    }
    setChanging(true);
    try {
      const result = await window.nexus.changePasscode(currentPasscode, nextPasscode);
      if (result.ok) {
        setChangeMessage({ text: strings.settings.security.changeSuccess, failed: false });
        setCurrentPasscode("");
        setNextPasscode("");
        setConfirmPasscode("");
      } else {
        setChangeMessage({ text: authErrorMessage(result.reason), failed: true });
      }
    } catch (error) {
      setChangeMessage({ text: strings.auth.error.generic, failed: true });
      console.error("Nexus: failed to change the passcode:", error);
    } finally {
      setChanging(false);
    }
  }

  const [regenerating, setRegenerating] = useState(false);
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  async function regenerate(): Promise<void> {
    if (regenerating) return;
    setRegenerating(true);
    setRecoveryError(null);
    try {
      const result = await window.nexus.regenerateRecoveryCode();
      if (result.ok && result.recoveryCode) {
        setNewRecoveryCode(result.recoveryCode);
      } else {
        setRecoveryError(result.ok ? strings.auth.error.generic : authErrorMessage(result.reason));
      }
    } catch (error) {
      setRecoveryError(strings.auth.error.generic);
      console.error("Nexus: failed to regenerate the recovery code:", error);
    } finally {
      setRegenerating(false);
    }
  }

  const s = strings.settings.security;

  return (
    <>
      <div className="set__security-block">
        <h3 className={labelClass("nx-eyebrow set__module-group-title", hits.has("security-passcode"))}>
          {s.changeTitle}
        </h3>
        <form className="set__security-form" onSubmit={(event) => void submitChange(event)}>
          <TextField
            type="password"
            label={s.currentLabel}
            value={currentPasscode}
            required
            onChange={(event) => setCurrentPasscode(event.target.value)}
          />
          <TextField
            type="password"
            label={s.newLabel}
            value={nextPasscode}
            required
            onChange={(event) => setNextPasscode(event.target.value)}
          />
          <TextField
            type="password"
            label={s.confirmLabel}
            value={confirmPasscode}
            required
            onChange={(event) => setConfirmPasscode(event.target.value)}
          />
          <Button type="submit" size="sm" variant="primary" disabled={changing}>
            {s.save}
          </Button>
        </form>
        {changeMessage != null && (
          <p className={changeMessage.failed ? "set__error" : "nx-hint"}>
            {changeMessage.text}
          </p>
        )}
      </div>

      <div className="set__security-block">
        <h3 className={labelClass("nx-eyebrow set__module-group-title", hits.has("security-recovery"))}>
          {s.recoveryTitle}
        </h3>
        {newRecoveryCode != null ? (
          <RecoveryKitPanel code={newRecoveryCode} onContinue={() => setNewRecoveryCode(null)} />
        ) : (
          <>
            <p className="nx-hint">{s.recoveryWarning}</p>
            <Button size="sm" variant="primary" disabled={regenerating} onClick={() => void regenerate()}>
              {s.regenerate}
            </Button>
            {recoveryError != null && <p className="set__error">{recoveryError}</p>}
          </>
        )}
      </div>

      {/* One preference, so it is a ROW rather than a third block with a
          heading: the heading and the select's own label were the same words
          twice, and a card whose first two entries are forms and whose third is
          a single choice should say so by shape. The search hit therefore rides
          the row wrapper (`set__hit-field`), which is where the stylesheet
          reaches a `Select`'s label from. */}
      <div className={hits.has("security-auto-lock") ? "set__field set__hit-field" : "set__field"}>
        <Select
          label={s.autoLockTitle}
          layout="inline"
          className="set__select"
          value={autoLockMinutes}
          onChange={(event) => onAutoLockChange(Number(event.target.value) as AutoLockMinutes)}
        >
          {AUTO_LOCK_MINUTES.map((minutes) => (
            <option key={minutes} value={minutes}>
              {lookup(s.autoLockOptions, String(minutes)) ?? String(minutes)}
            </option>
          ))}
        </Select>
        <p className="nx-hint">{s.autoLockHint}</p>
      </div>
    </>
  );
}

interface ShortcutsSectionProps {
  overrides: ShortcutOverrides;
  onChange: (overrides: ShortcutOverrides) => void;
  /** Opens the reference overlay App owns — the same one F1 and the palette command open. */
  onShowAll: () => void;
  /** TASK-002: the system refused the global row's chord to another application. */
  globalTaken: boolean;
  /** SET-014 hit ids — each action row highlights its label under `shortcutEntryId(action.id)`. */
  hits: ReadonlySet<string>;
}

/**
 * Prečice section (ADR-040 / SET-013): the remappable core set, each row
 * showing what it is bound to right now.
 *
 * „Promeni" turns that row's own button into the capture surface — one
 * control, so focus is already where the keystroke must be read and losing it
 * cancels, with no second element to keep in sync. The listener itself sits on
 * `window` in the CAPTURE phase, which is what lets a user record Ctrl+K
 * without also opening the palette: it runs strictly before the app's own
 * bubble-phase global handler and stops the event there.
 *
 * A combination that is not bindable, or that something else already holds, is
 * refused with the reason named and capture stays open. Nothing is ever
 * swapped out from under another action.
 *
 * The global row (TASK-002) carries one extra rule and one extra state. The
 * rule: its chord also has to be expressible as an OS accelerator, refused here
 * so a chord that could never be registered is never stored in the first place.
 * The state: the system can hand the combination to whoever asked first, which
 * is not something capture can foresee — that one is reported after the fact,
 * from `globalTaken`.
 */
function ShortcutsSection({
  overrides,
  onChange,
  onShowAll,
  globalTaken,
  hits,
}: ShortcutsSectionProps) {
  const s = strings.shortcuts;
  const [capturing, setCapturing] = useState<ShortcutActionId | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const bindings = resolveShortcuts(overrides);
  const hasOverrides = SHORTCUT_ACTIONS.some((action) => overrides[action.id] !== undefined);

  useEffect(() => {
    const actionId = capturing;
    if (actionId === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      // A modifier on its own is the combination still being assembled.
      if (isModifierKey(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapturing(null);
        setRefusal(null);
        return;
      }
      const chord = chordFromEvent(event);
      if (chord === null) {
        setRefusal(s.refuseUnbindable);
        return;
      }
      // The OS binds a physical key, so punctuation and layout-specific
      // characters would print one chord in Settings and fire from another
      // (`chordAccelerator`). Refused here rather than after a failed
      // registration, so what is stored is always registrable.
      if (isGlobalShortcutAction(actionId) && chordAccelerator(chord) === null) {
        setRefusal(s.refuseGlobal);
        return;
      }
      // `bindings` is this render's, and `overrides` — what it is derived from
      // — is in the dependency list below, so it is never a stale map.
      const conflict = findChordConflict(actionId, chord, bindings);
      if (conflict !== null) {
        setRefusal(
          s.takenPrefix +
            (conflict === MODULE_NAV_CONFLICT ? s.moduleNavLabel : shortcutActionLabel(conflict)),
        );
        return;
      }
      onChange({ ...overrides, [actionId]: chord });
      setCapturing(null);
      setRefusal(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // `bindings` is a pure derivation of `overrides` (already listed), and `s`
    // is a frozen module constant — neither would ever change when the other
    // dependencies did not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, overrides, onChange]);

  function reset(actionId: ShortcutActionId): void {
    const next = { ...overrides };
    delete next[actionId];
    onChange(next);
  }

  return (
    <>
      <div className="set__shortcut-list">
        {SHORTCUT_ACTIONS.map((action) => {
          const isCapturing = capturing === action.id;
          return (
            <div className="set__shortcut-item" key={action.id}>
              <div className="set__shortcut-row">
                <span className={labelClass("set__shortcut-label", hits.has(shortcutEntryId(action.id)))}>
                  {action.label}
                </span>
                <Kbd>{formatChord(bindings[action.id])}</Kbd>
                <div className="set__shortcut-actions">
                  <Button
                    size="sm"
                    variant={isCapturing ? "primary" : "ghost"}
                    aria-pressed={isCapturing}
                    onClick={() => {
                      setRefusal(null);
                      setCapturing(isCapturing ? null : action.id);
                    }}
                    onBlur={() => {
                      if (isCapturing) {
                        setCapturing(null);
                        setRefusal(null);
                      }
                    }}
                  >
                    {isCapturing ? s.capturePrompt : s.change}
                  </Button>
                  {overrides[action.id] !== undefined && (
                    <Button size="sm" variant="ghost" onClick={() => reset(action.id)}>
                      {s.reset}
                    </Button>
                  )}
                </div>
              </div>
              {isCapturing && (
                <p className={refusal !== null ? "set__error" : "nx-hint"} role="status">
                  {refusal ?? s.captureHint}
                </p>
              )}
              {/* The „globalna" marker, said rather than drawn: what makes this
                  row different is a behaviour, so it is written out under it
                  instead of dressed up as a badge. */}
              {action.global && <p className="nx-hint">{s.globalHint}</p>}
              {action.global && globalTaken && (
                <p className="set__error" role="status">
                  {s.globalTaken}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="nx-hint">{s.cardCaption}</p>
      <div className="set__shortcut-footer">
        <Button size="sm" variant="primary" onClick={onShowAll}>
          {s.showAll}
        </Button>
        <Button size="sm" variant="ghost" disabled={!hasOverrides} onClick={() => onChange({})}>
          {s.resetAll}
        </Button>
      </div>
    </>
  );
}

interface LicenceGroupProps {
  title: string;
  /** The one sentence this group needs said before the list — it stays visible whether the list is open or not. */
  caption: string;
  entries: readonly LicenceEntry[];
  defaultOpen: boolean;
}

/**
 * One group of notices — the libraries, or the fonts — behind the card's own
 * disclosure idiom.
 *
 * **Why the list is collapsible at all.** The library group is three hundred
 * rows. Every card on this page stays MOUNTED while filtered out (SET-014), so
 * an always-open list of that size would sit in the tree for the whole session
 * to serve a screen almost nobody opens twice. The fonts are eight rows and open
 * by default: they are the group the user was most likely looking for, and the
 * sentence about them being bundled is the thing worth reading without a click.
 *
 * **One notice open at a time.** An accordion rather than a set of toggles —
 * a licence is thousands of characters, and two of them open at once would turn
 * the card into a scroll the width of the page rather than a thing being read.
 */
function LicenceGroup({ title, caption, entries, defaultOpen }: LicenceGroupProps) {
  const s = strings.settings.licences;
  const [open, setOpen] = useState(defaultOpen);
  const [openEntry, setOpenEntry] = useState<string | null>(null);

  return (
    <div className="set__licence-group">
      {/* No children: the caption belongs between the trigger and the list and
          is shown whether or not the group is open, so the body stays here. */}
      <Disclosure
        label={title}
        open={open}
        onToggle={setOpen}
        summary={String(entries.length)}
      />
      <p className="nx-hint">{caption}</p>
      {open && (
        <ul className="set__licence-list">
          {entries.map((entry) => {
            const expanded = openEntry === entry.id;
            return (
              <li key={entry.id} className="set__licence-item">
                {/* No aria-label: the row's own text IS its accessible name
                    (name, version, licence — all three worth announcing), and
                    `aria-expanded` is what states whether it is open. */}
                <Disclosure
                  className="set__licence-toggle"
                  label={entry.name}
                  summary={`${entry.version} · ${
                    entry.licence === "UNKNOWN" ? s.unknownLicence : entry.licence
                  }`}
                  open={expanded}
                  title={expanded ? s.collapse : s.expand}
                  onToggle={(next) => {
                    setOpenEntry(next ? entry.id : null);
                  }}
                />
                {expanded && (
                  <div className="set__licence-body">
                    {/* The gap is stated where the text would have been, never
                        papered over: a package that ships no licence file and a
                        font whose licence could not be established are two
                        different facts, and both are the user's to know. */}
                    {entry.status === "declared-only" && (
                      <p className="nx-hint">{s.declaredOnly}</p>
                    )}
                    {entry.status === "unknown" && (
                      <p className="nx-hint">{s.notEstablished}</p>
                    )}
                    {/* A named, focusable region — the same treatment the AI
                        import's prompt block gets: the notice scrolls, and a
                        scroll container nothing can put focus into is one a
                        keyboard cannot read. */}
                    {entry.notice.length > 0 && (
                      <pre
                        className="set__licence-notice"
                        role="region"
                        aria-label={`${s.noticeLabel}: ${entry.name}`}
                        tabIndex={0}
                      >
                        {entry.notice}
                      </pre>
                    )}
                    <p className="nx-hint set__licence-source">
                      {s.source}: {entry.source}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Both groups of notices, once they have arrived. */
interface LoadedLicences {
  packages: readonly LicenceEntry[];
  fonts: readonly LicenceEntry[];
}

/**
 * „Licence" (the card): the notices Nexus owes for the code and the fonts it
 * ships. No IPC and nothing to save — the only state is which row is open and
 * whether the data has arrived.
 *
 * **The notices are fetched, not imported, and that is the whole point.**
 * `data/licences.json` is ~650 KB of licence text — three hundred packages'
 * worth. A static import puts every character of it in the eager renderer
 * chunk, paid at startup by every session that ever runs, to serve a card most
 * people open once. `import()` makes it a chunk of its own that is read when
 * this card first mounts — that is, when somebody opens Settings, not when they
 * open Nexus. The module it reaches for is the same one `licences.test.ts`
 * imports directly, so the gate on the data is unaffected.
 *
 * It is deliberately NOT deferred until a group is expanded: the two disclosure
 * buttons show how many entries each holds, and a count is the one thing this
 * card says that is worth reading without a click.
 */
function LicencesSection() {
  const s = strings.settings.licences;
  const [loaded, setLoaded] = useState<LoadedLicences | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void import("./licences.js")
      .then((module) => {
        if (active) setLoaded({ packages: module.LICENCE_PACKAGES, fonts: module.LICENCE_FONTS });
      })
      .catch((error: unknown) => {
        if (active) setFailed(true);
        console.error("Nexus: failed to load the third-party licences:", error);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <p className="nx-hint">{s.caption}</p>
      {failed && (
        <p className="nx-hint" role="alert">
          {s.loadError}
        </p>
      )}
      {!failed && loaded === null && <p className="nx-hint">{s.loading}</p>}
      {loaded !== null && (
        <>
          <LicenceGroup
            title={s.packagesTitle}
            caption={s.chromium}
            entries={loaded.packages}
            defaultOpen={false}
          />
          <LicenceGroup
            title={s.fontsTitle}
            caption={s.fontsCaption}
            entries={loaded.fonts}
            defaultOpen
          />
        </>
      )}
    </>
  );
}

interface SetupSectionProps {
  profileId: string;
  flags: FlagState;
  registry: ModuleRegistry;
  hits: ReadonlySet<string>;
  onRerunOnboarding: () => void;
}

/**
 * ADR-086 §5 — „Kako je Nexus podešen za tebe".
 *
 * The plan is REBUILT here from the stored answers, never read back from a
 * stored plan, and that is the whole reason the ANSWERS are what get stored: a
 * plan is a snapshot of what one build's registry could compose, where a plan
 * rebuilt from the same answers next year names the modules and cards that
 * exist then. It also means this card cannot drift from the questionnaire's own
 * reveal, because both render `planReasonLines` over the same object.
 *
 * It is rebuilt against the profile's LIVE flags, so the sentence about modules
 * describes the app as it now stands rather than as it stood the day it was
 * answered — somebody who has since switched Finansije off is not told it was
 * turned on for them.
 */
function SetupSection({ profileId, flags, registry, hits, onRerunOnboarding }: SetupSectionProps) {
  const s = strings.settings.setup;
  const [signals, setSignals] = useState(() => readStoredSignals(profileId));
  const plan = useMemo(
    () => buildProfilePlan(signals, registry, resolveModuleSelection(registry, flags)),
    [signals, registry, flags],
  );
  const trades = heardTrades(plan);
  const lines = planReasonLines(plan);
  const answered = signals.length > 0;

  return (
    <>
      <p className="nx-hint">{answered ? s.description : s.none}</p>
      {/* What it HEARD, in the person's own spelling, before anything it
          decided — the reveal's own opening, for the same reason. */}
      {trades.length > 0 && (
        <div className="onb__heard-list">
          {trades.map((entry) => (
            <Chip key={entry.term} variant="accent">
              {entry.term} → {entry.packs}
            </Chip>
          ))}
        </div>
      )}
      {lines.length > 0 && (
        <ul className="onb__reasons">
          {lines.map((line) => (
            <li key={line} className="onb__reason">
              <span className="onb__reason-mark" aria-hidden="true">
                ✦
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="set__module-row set__module-row--foot">
        <div className="set__module-info">
          <span className={labelClass("set__module-name", hits.has("modules-onboarding"))}>
            {strings.settings.onboardingRerunTitle}
          </span>
          <span className="nx-hint">{strings.settings.onboardingRerunCaption}</span>
        </div>
        <Button size="sm" onClick={onRerunOnboarding}>
          {strings.settings.onboardingRerunAction}
        </Button>
      </div>
      {/* Forgetting is quiet and typographic, the `ResetLink` idiom, and it is
          offered only where there is something to forget. It deliberately does
          NOT undo: the answers go, the app stays exactly as it is, which is
          what the hint says. An „erase" that also reverted the app would be an
          undo nobody asked for, reaching settings the person may since have
          changed by hand. */}
      {answered && (
        <>
          <p className={labelClass("nx-hint", hits.has("setup-forget"))}>
            {s.forgetHint}
          </p>
          <Button
            variant="quiet"
            className="set__reset"
            onClick={() => {
              clearStoredSignals(profileId);
              setSignals([]);
            }}
          >
            {s.forget}
          </Button>
        </>
      )}
    </>
  );
}

export interface SettingsPageProps {
  profileId: string;
  profileName: string;
  /** The active profile's picture hash (SET-001), or null — owned by the shell, exactly as its name is. */
  profilePictureHash: string | null;
  /** Every profile of the account (ADR-058), the shell's own list — the „Profili“ card and the active profile's kind both read it. */
  profiles: Profile[];
  info: AppInfo | null;
  flags: FlagState;
  onFlagsChanged: (flags: FlagState) => void;
  onProfileRenamed: (name: string) => void;
  /** Reports a picture change back to the shell, so the sidebar's avatar follows this page. */
  onProfilePictureChanged: (pictureHash: string | null) => void;
  /** ADR-058 §4 — all three owned by App: creation lands in the shell's list, switching passes its passcode gate, deletion may evict the active profile first. */
  onCreateBusinessProfile: () => Promise<Profile>;
  onRequestProfileSwitch: (profile: Profile) => void;
  onDeleteProfile: (profile: Profile) => Promise<void>;
  preference: ThemePreference;
  onPreferenceChange: (preference: ThemePreference) => void;
  /**
   * Told AFTER the copy table has been served a new language, so the shell can
   * redraw. The table is one object rewritten in place, which React has no way
   * to observe — this page re-renders from its own state, and the sidebar, the
   * topbar and every other page would not.
   */
  onLocaleChanged: () => void;
  registry: ModuleRegistry;
  autoLockMinutes: AutoLockMinutes;
  onAutoLockChange: (value: AutoLockMinutes) => void;
  /** Remapped shortcuts (ADR-040), owned by App the way `autoLockMinutes` is. */
  shortcutOverrides: ShortcutOverrides;
  onShortcutOverridesChange: (overrides: ShortcutOverrides) => void;
  /** TASK-002: main's answer to the last global registration — false whenever the system granted it. */
  globalShortcutTaken: boolean;
  onShowShortcuts: () => void;
  /** ADR-065 §5: reopens the onboarding questionnaire over this profile. App owns the flow — it is the same screen the first run draws, not a dialog of this page's. */
  onRerunOnboarding: () => void;
}

/**
 * SET: the SHELL's own settings — profile rename, theme preference
 * (Sistemski/Dan/Noć), the accent palette, the first day of the week (PRD 04
 * §5), the account's passcode and Recovery Kit, keyboard shortcuts, the module
 * gallery (per-category enable/disable, SET-007), NTF-008's appetite presets
 * over the shared quiet-hours/source controls, backup/restore/import, and a
 * read-only "O aplikaciji" info panel.
 *
 * Every card a MODULE owns is NOT here: it is declared in that module's
 * manifest (`SettingsPanel`) and drawn by its own component
 * (`moduleSettingsPanels.tsx`), and this page composes whatever the registry
 * publishes, in registry order, skipping a module the profile switched off.
 * Adding a module's settings therefore does not touch this file — which is the
 * whole point of the split, and the reason the two kinds of settings are named
 * apart rather than merged (see `SettingsPanel`'s own comment).
 *
 * SET-014 layers a filter on top: the field in the header narrows the page to
 * the sections that answer the query (`settingsSearch.ts` owns what is
 * searchable) and marks the matched labels typographically. An empty query is
 * the page exactly as it was before the filter existed.
 *
 * SET-015 gives the page its structure: eight categories, a rail beside the
 * pane on a window wide enough for two columns and a drill-down list on one
 * that is not, and a sub-page for each module card and each import/export flow
 * (`settingsCategories.ts` owns that table). Navigation HIDES cards rather than
 * unmounting them, and the location and the filter are answered by one pure
 * function — so a search still spans every category, and a half-finished flow
 * survives a click in the rail.
 */
export function SettingsPage({
  profileId,
  profileName,
  profilePictureHash,
  profiles,
  info,
  flags,
  onFlagsChanged,
  onProfileRenamed,
  onProfilePictureChanged,
  onCreateBusinessProfile,
  onRequestProfileSwitch,
  onDeleteProfile,
  preference,
  onPreferenceChange,
  onLocaleChanged,
  registry,
  autoLockMinutes,
  onAutoLockChange,
  shortcutOverrides,
  onShortcutOverridesChange,
  globalShortcutTaken,
  onShowShortcuts,
  onRerunOnboarding,
}: SettingsPageProps) {
  // The accent is per-profile (ADR-058 §3), and its default depends on the
  // profile's KIND (bordo for business, decision #11). Reading it lazily in a
  // useState initializer is safe because App keys this page by the active
  // profile, so `profileId` is constant for the lifetime of a mount.
  const activeKind: ProfileKind =
    profiles.find((profile) => profile.id === profileId)?.kind ?? "personal";
  const [accent, setAccent] = useState<AccentId>(() => readStoredAccent(profileId, activeKind));
  const [weekStart, setWeekStart] = useState<WeekStartPreference>(() => readStoredWeekStart());
  /** CAL §5, beside the week start and read the same way: how long a seeded event runs, and which clock the calendar draws. */
  const [eventDuration, setEventDuration] = useState<EventDurationMinutes>(() =>
    readStoredEventDuration(),
  );
  const [clock, setClock] = useState<ClockPreference>(() => readStoredClock());
  /** SET §5: which card's „Vrati na podrazumevano“ is currently being confirmed, or `null`. */
  const [resetting, setResetting] = useState<ResetTarget | null>(null);
  /**
   * How many times each module card has been reset. It is a REMOUNT key, not
   * data: a panel reads its device preferences in `useState` initializers, so
   * bumping this is what makes it start over from what storage now says —
   * without the page knowing which preferences the panel even has.
   */
  const [resetCounts, setResetCounts] = useState<Record<string, number>>({});
  // SET-014: the raw query. Empty means "render everything exactly as before" —
  // the filter is additive, it never becomes the page's normal state.
  const [query, setQuery] = useState("");
  const [modulesError, setModulesError] = useState<string | null>(null);
  const [notificationSources, setNotificationSources] = useState<NotificationSource[] | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  // Bumped after a preset write. Both the effect below (this page's own
  // active-preset highlight) and NotificationSettingsControls's fetch effect
  // (via its `refreshToken` prop) depend on it, so one write refreshes both.
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const settings = await window.nexus.getNotificationSettings(profileId);
        if (active) setNotificationSources(settings.enabledSources);
      } catch (error) {
        console.error("Nexus: failed to load notification settings:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, refreshToken]);

  async function toggleModule(moduleId: string, enabled: boolean): Promise<void> {
    setModulesError(null);
    try {
      await window.nexus.setFlag(profileId, moduleId, enabled);
      onFlagsChanged(await window.nexus.getFlags(profileId));
    } catch (error) {
      setModulesError(strings.settings.modulesToggleError);
      console.error("Nexus: failed to update module flag:", error);
    }
  }

  async function applyPreset(sources: NotificationSource[]): Promise<void> {
    setPresetError(null);
    try {
      await Promise.all(
        ALL_NOTIFICATION_SOURCES.map((source) =>
          window.nexus.setNotificationSourceEnabled(profileId, source, sources.includes(source)),
        ),
      );
      setRefreshToken((token) => token + 1);
    } catch (error) {
      setPresetError(strings.notifications.settings.saveError);
      console.error("Nexus: failed to apply notification preset:", error);
    }
  }

  /**
   * SET §5. A card's reset clears exactly ITS OWN keys — each enumerated in
   * the preference module that owns them, never swept by prefix — and then
   * re-reads every one of them, so the controls show the defaults live rather
   * than only after a reload.
   *
   * „Izgled“ is the shell's own arm, and the theme is the single value in it
   * this page does not own: App holds it and drives `<html data-theme>` and the
   * whole shell, so it is reset through the very channel every other theme
   * change goes through, handed `theme.ts`'s own default — which is exactly
   * what an absent `nexus.theme` reads back as.
   *
   * Every other card is a MODULE's. Its renderer knows which keys are its own
   * (`resetDevice`) and the remount that follows is what re-reads them, so this
   * page needs to know neither.
   */
  function runReset(sectionId: string): void {
    if (sectionId === "appearance") {
      onPreferenceChange(DEFAULT_THEME_PREFERENCE);
      clearStoredAccent(profileId, activeKind);
      clearStoredWeekStart();
      clearStoredCalendarPreferences();
      // The language is part of „Izgled“, so „Vrati na podrazumevano“ returns
      // it too — and `applyLocale` runs before the state update, so the page
      // that redraws is already in the restored language rather than in the
      // one that was just discarded.
      clearStoredLocale();
      const restoredLocale = readStoredLocale();
      applyLocale(restoredLocale);
      reportLocaleToMain(restoredLocale);
      setLocale(restoredLocale);
      onLocaleChanged();
      setAccent(readStoredAccent(profileId, activeKind));
      setWeekStart(readStoredWeekStart());
      setEventDuration(readStoredEventDuration());
      setClock(readStoredClock());
    } else {
      MODULE_SETTINGS_PANELS[sectionId]?.resetDevice?.();
      setResetCounts((counts) => ({ ...counts, [sectionId]: (counts[sectionId] ?? 0) + 1 }));
    }
    setResetting(null);
  }

  const activePreset =
    notificationSources != null
      ? NOTIFICATION_PRESETS.find((preset) => sameSourceSet(preset.sources, notificationSources))
      : undefined;

  // SET-014: the searchable index is a function of the registry alone, so it is
  // built once per registry rather than on every keystroke; the match itself is
  // a dozen string comparisons and needs no memo of its own.
  const searchIndex = useMemo(() => buildSettingsIndex(registry), [registry]);
  const terms = foldSettingsQuery(query);
  const { sections, hits } = matchSettings(searchIndex, terms);
  // A query is „active" exactly when it folded to at least one term: an empty
  // or all-whitespace box is the page as it was before the filter existed, and
  // `matchSettings` answers that case with every section and no hits.
  const searching = terms.length > 0;
  // The module cards this build draws, in registry order and gated by SET-007's
  // flags — the page composes them, it does not know them.
  const moduleCards = useMemo(() => moduleSettingsCards(registry, flags), [registry, flags]);
  // Held in state only so that changing it re-renders THIS page — the copy
  // table itself is one object rewritten in place, so nothing else on screen
  // needs to be told (`strings.ts`).
  const [locale, setLocale] = useState<Locale>(() => readStoredLocale());
  const a = strings.settings.appearance;
  const s = strings.settings;

  // SET-015: where the page is. A category, a sub-page inside it, or — with
  // both null — the narrow layout's root list. Restored from the last visit in
  // this session, and defaulting to nothing at all, which the wide layout
  // resolves to its first category below.
  const [location, setLocation] = useState<SettingsLocation>(
    () => lastSettingsLocation ?? { category: null, sub: null },
  );
  // The rail's roving tab stop: one item carries `tabIndex={0}` at a time, and
  // it follows the current category so Tab always lands where the reader is.
  const [railFocus, setRailFocus] = useState(0);
  // Whether this page's own column is wide enough for the rail. The LAYOUT is a
  // container query in CSS; this is read here only to resolve the default
  // location and to keep a resize from stranding one the wide layout cannot
  // show.
  const [wide, setWide] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const paneHeadingRef = useRef<HTMLHeadingElement | null>(null);
  // A navigation waiting for the render it belongs to; see the effect below.
  const pendingNavigation = useRef<SettingsLocation | null>(null);
  const [navTick, setNavTick] = useState(0);

  // SET-015: what the location — or the query — makes visible. Every other card
  // stays MOUNTED and takes `set__section--hidden`, exactly as the SET-014
  // filter already hid them: navigation that unmounted a card would discard
  // in-progress state (a restore preview holding its archive open, a half-typed
  // passcode) that the reader is coming back to.
  const visibility = visibleSections(location, searching ? { sections, hits } : null);
  // Sections whose visible label IS the card's own title. The import/export
  // sub-pages suppress the block's own eyebrow — it would be the title a second
  // time — so a hit there has to be carried by the title; every other card
  // still highlights the label inside it, exactly as it always has.
  const hitCards = new Set(
    searchIndex.entries.filter((entry) => hits.has(entry.id)).map((entry) => entry.section),
  );

  /**
   * The pane's heading: the current category, or the open sub-page's own title.
   * Looked up rather than switched, because a module card's sub-page id is one
   * of this table's keys and a module id that is not would still be named by
   * `moduleName`.
   */
  const paneTitle =
    location.sub !== null
      ? (lookup(s.sectionTitle, location.sub) ?? moduleName(location.sub))
      : location.category !== null
        ? s.categoryTitle[location.category]
        : null;
  const paneSummary =
    location.sub === null && location.category !== null
      ? s.categorySummary[location.category]
      : null;
  /**
   * The quiet back button, or null when there is nowhere to go: a sub-page
   * returns to its category in either layout, and a category returns to the
   * root only in the narrow one — the wide layout's rail IS the root, so that
   * button is hidden there (see `styles/settings.css`).
   */
  const backTarget =
    location.sub !== null && location.category !== null
      ? {
          label: s.categoryTitle[location.category],
          next: { category: location.category, sub: null } as SettingsLocation,
        }
      : location.sub === null && location.category !== null
        ? {
            label: moduleName("settings"),
            next: { category: null, sub: null } as SettingsLocation,
          }
        : null;

  /** The heading a group of search results sits under, or null when it has no hits. */
  const searchGroupTitle = (id: CategoryId): ReactNode =>
    searching && visibility.groups.includes(id) ? (
      <h2 className="set__group-title" data-settings-group={id}>
        {s.categoryTitle[id]}
      </h2>
    ) : null;

  // The page's own width, not the window's: the shell's sidebar takes part of
  // the window before this page sees any of it (SET-015 §Layout).
  useLayoutEffect(() => {
    const node = rootRef.current;
    if (node === null) return undefined;
    const measure = (): void => {
      setWide(node.getBoundingClientRect().width >= WIDE_LAYOUT_MIN_PX);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A width with no location resolves to the first category: the two-column
  // layout has no root list to sit in. Every other location survives the
  // breakpoint untouched, in both directions (SET-015 §Navigation).
  useLayoutEffect(() => {
    if (wide && location.category === null) setLocation({ category: DEFAULT_CATEGORY, sub: null });
  }, [wide, location.category]);

  // Kept for the session, never written down — `lastSettingsLocation`'s own
  // comment says why.
  useEffect(() => {
    lastSettingsLocation = location;
  }, [location]);

  // The rail's tab stop follows the category the reader is on.
  useEffect(() => {
    const index = SETTINGS_CATEGORIES.findIndex((category) => category.id === location.category);
    if (index >= 0) setRailFocus(index);
  }, [location.category]);

  /**
   * The only way the location changes.
   *
   * The scroll-and-focus work happens in the effect BELOW rather than here,
   * because the heading it focuses does not exist until React has committed the
   * new location; `pendingNavigation` carries the intent across that render,
   * and is cleared on the way through so a later render — a keystroke, a
   * resize — cannot replay it.
   */
  function navigate(next: SettingsLocation): void {
    pendingNavigation.current = next;
    setLocation(next);
    setNavTick((tick) => tick + 1);
  }

  useLayoutEffect(() => {
    const next = pendingNavigation.current;
    if (next === null) return;
    pendingNavigation.current = null;
    if (searching) {
      // A query shows results from every category at once, so a rail item
      // scrolls to that category's group instead of switching the pane.
      document
        .querySelector(`[data-settings-group="${next.category ?? ""}"]`)
        ?.scrollIntoView({ block: "start" });
      return;
    }
    // „Arrive at the top, with the new page named": the scroller belongs to the
    // shell and the heading to this page, so the two are done separately.
    const scroller = scrollContainerOf(rootRef.current);
    if (scroller !== null) scroller.scrollTop = 0;
    paneHeadingRef.current?.focus();
  }, [navTick, searching]);

  return (
    <div className="set" ref={rootRef}>
      {/* The filter is a PAGE-LEVEL control, so it sits in the header's actions
          slot rather than as the first row of the body — which is what
          `actions` exists for, and what it was doing wrong before. The
          header's own band (72px, the mark's height) carries something instead
          of standing empty beside the title. */}
      <PageHeader
        title={moduleName("settings")}
        sigil="settings"
        actions={
          <TextField
            className="set__search"
            value={query}
            aria-label={strings.settings.searchPlaceholder}
            placeholder={strings.settings.searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
          />
        }
      />

      <div className="set__layout">
        {/* SET-015's rail: the eight categories, one `NavItem` each. The active
            row is typographic — accent ink, extra weight, NavItem's own ✦ —
            and nothing here draws a pill, a tab or a bar.

            While a query is active every item carries its hit count and the
            active mark is withheld: `NavItem` suppresses a badge on its active
            row, and „every item shows its count" is the half of that trade the
            reader needs while looking at results that span categories. */}
        <nav
          className="set__rail"
          aria-label={s.categoriesLabel}
          onKeyDown={(event) => {
            if (
              event.key !== "ArrowDown" &&
              event.key !== "ArrowUp" &&
              event.key !== "Home" &&
              event.key !== "End"
            ) {
              return;
            }
            // Roving focus over the rail's own rows, read off the live DOM
            // rather than a ref array: the rows are the anchors carrying
            // `data-settings-category`, and a ref per row would be the same
            // list kept twice.
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>("[data-settings-category]"),
            );
            if (items.length === 0) return;
            const last = items.length - 1;
            const current = items.findIndex((item) => item === document.activeElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? last
                  : event.key === "ArrowDown"
                    ? Math.min(current + 1, last)
                    : Math.max(current - 1, 0);
            event.preventDefault();
            setRailFocus(next);
            items[next]?.focus();
          }}
        >
          {SETTINGS_CATEGORIES.map((category, index) => (
            <NavItem
              key={category.id}
              href="#"
              active={!searching && location.category === category.id}
              tabIndex={index === railFocus ? 0 : -1}
              className={
                searching && categoryHitCount(category.id, visibility.cards) === 0
                  ? "set__rail-item--empty"
                  : undefined
              }
              badge={
                searching
                  ? railCountBadge(categoryHitCount(category.id, visibility.cards))
                  : undefined
              }
              data-settings-category={category.id}
              onClick={(event) => {
                event.preventDefault();
                setRailFocus(index);
                navigate({ category: category.id, sub: null });
              }}
            >
              <Icon name={category.icon} size={16} />
              {s.categoryTitle[category.id]}
            </NavItem>
          ))}
        </nav>

        <div className="set__pane">
          {searching && sections.size === 0 && (
            <EmptyState
              sigil="settings"
              title={strings.search.emptyResults}
              description={s.searchEmptyDescription}
            />
          )}

          {/* The narrow layout's root: the eight categories as one card of
              rows, with no rail beside them. The wide layout hides this card
              and shows the rail, which is the same list. */}
          <Card
            className={`set__root${
              searching || location.category !== null ? " set__section--hidden" : ""
            }`}
          >
            {SETTINGS_CATEGORIES.map((category) => (
              <CategoryListRow
                key={category.id}
                id={category.id}
                icon={category.icon}
                title={s.categoryTitle[category.id]}
                summary={s.categorySummary[category.id]}
                onOpen={() => navigate({ category: category.id, sub: null })}
              />
            ))}
          </Card>

          {/* The pane's own heading. A search draws one heading per group
              instead — see `searchGroupTitle` — because results then span
              categories and no single one of them names the page. */}
          {!searching && paneTitle !== null && (
            <div className="set__pane-head">
              {backTarget !== null && (
                <Button
                  variant="quiet"
                  className={location.sub === null ? "set__back set__back--root" : "set__back"}
                  aria-label={fill(s.backTo, { name: backTarget.label })}
                  onClick={() => navigate(backTarget.next)}
                >
                  <Icon name="chevronLeft" size={16} />
                  {backTarget.label}
                </Button>
              )}
              <h2 className="set__pane-title" tabIndex={-1} ref={paneHeadingRef}>
                {paneTitle}
              </h2>
              {paneSummary !== null && <p className="nx-hint">{paneSummary}</p>}
            </div>
          )}

          {searchGroupTitle("profile")}

          <Card
            id={sectionDomId("profile")}
            title={strings.settings.sectionTitle.profile}
            className={sectionClass(visibility.cards.has("profile"))}
          >
            <ProfileSection
              profileId={profileId}
              initialName={profileName}
              initialPictureHash={profilePictureHash}
              onProfileRenamed={onProfileRenamed}
              onProfilePictureChanged={onProfilePictureChanged}
              hits={hits}
            />
          </Card>

          <Card
            id={sectionDomId("profiles")}
            title={strings.settings.sectionTitle.profiles}
            className={sectionClass(visibility.cards.has("profiles"))}
          >
            <ProfilesSection
              profiles={profiles}
              activeProfileId={profileId}
              onCreateBusiness={onCreateBusinessProfile}
              onRequestSwitch={onRequestProfileSwitch}
              onDelete={onDeleteProfile}
            />
          </Card>

          <Card
            id={sectionDomId("security")}
            title={strings.settings.sectionTitle.security}
            className={sectionClass(visibility.cards.has("security"))}
          >
            <SecuritySection
              autoLockMinutes={autoLockMinutes}
              onAutoLockChange={onAutoLockChange}
              hits={hits}
            />
          </Card>

          {searchGroupTitle("appearance")}
          <Card
            id={sectionDomId("appearance")}
            title={strings.settings.sectionTitle.appearance}
            className={sectionClass(visibility.cards.has("appearance"))}
          >
            {/* First in the card, because it governs every other word on the page.
                The list is `availableLocales()`, so a locale added to `LOCALES`
                appears here without this block changing, and the stored choice is
                what the rest of the app reads on the next render.
                `applyLocale` runs BEFORE the state bump on purpose: the table is
                rewritten in place, so the render that follows reads the new copy
                (see `strings.ts`), and `reportLocaleToMain` tells the main process
                so its dialogs and OS notifications follow. */}
            <div
              className={hits.has("appearance-language") ? "set__field set__hit-field" : "set__field"}
            >
              {/* `layout="inline"` is what makes a `Select` the ROW rather than
                  something inside one: the component owns both the label and the
                  control, so it carries the row's own left-and-right arrangement
                  and nothing here has to name the label twice. */}
              <Select
                label={a.languageLabel}
                layout="inline"
                className="set__select"
                value={locale}
                onChange={(event) => {
                  const next = event.target.value as Locale;
                  persistLocale(next);
                  applyLocale(next);
                  reportLocaleToMain(next);
                  setLocale(next);
                  onLocaleChanged();
                }}
              >
                {availableLocales().map((code) => (
                  <option key={code} value={code}>
                    {lookup(a.languageNames, code) ?? code}
                  </option>
                ))}
              </Select>
              <p className="nx-hint">{a.languageHint}</p>
            </div>
            <div className="set__field">
              <p className={labelClass("nx-hint", hits.has("appearance-theme"))}>
                {a.themeLabel}
              </p>
              <div className="set__segmented" role="group" aria-label={a.themeLabel}>
                {THEME_OPTIONS.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={preference === option ? "primary" : "ghost"}
                    aria-pressed={preference === option}
                    onClick={() => onPreferenceChange(option)}
                  >
                    {themeOptionLabel(option)}
                  </Button>
                ))}
              </div>
              <p className="nx-hint">{a.themeHint}</p>
            </div>
            <div className="set__field">
              <p className={labelClass("nx-hint", hits.has("appearance-accent"))}>
                {a.accentLabel}
              </p>
              <div className="set__accent-row" role="group" aria-label={a.accentLabel}>
                {ACCENT_IDS.map((id) => {
                  const name = a.accentNames[id] ?? id;
                  const selected = accent === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`set__accent-swatch${selected ? " set__accent-swatch--selected" : ""}`}
                      aria-pressed={selected}
                      title={name}
                      aria-label={name}
                      style={{ background: `var(--nx-swatch-${id})` }}
                      onClick={() => {
                        persistAccent(profileId, id);
                        setAccent(id);
                      }}
                    />
                  );
                })}
              </div>
              {/* The chosen accent's NAME, on the row's own explanation line rather
                  than glued to the label with an em dash: eight swatches say which
                  one is selected by shape, and this says what it is called. */}
              <p className="nx-hint">{a.accentNames[accent] ?? accent}</p>
            </div>
            {/* PRD 04 §5. The calendar reads this on mount, so a change here shows
                the next time that page is opened — page switching remounts it. */}
            <div className="set__field">
              <p className={labelClass("nx-hint", hits.has("appearance-week-start"))}>
                {a.weekStartLabel}
              </p>
              <div className="set__segmented" role="group" aria-label={a.weekStartLabel}>
                {WEEK_START_OPTIONS.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={weekStart === option ? "primary" : "ghost"}
                    aria-pressed={weekStart === option}
                    onClick={() => {
                      persistWeekStart(option);
                      setWeekStart(option);
                    }}
                  >
                    {a.weekStartOptions[option]}
                  </Button>
                ))}
              </div>
            </div>
            {/* CAL §5, beside the week start: both say how this machine reads a
                calendar. Selects rather than segmented rows — four spans and two
                clocks with example times in them are longer labels than a row of
                chips can carry without wrapping (the auto-lock precedent). */}
            <div
              className={
                hits.has("calendar-event-duration") ? "set__field set__hit-field" : "set__field"
              }
            >
              <Select
                label={a.eventDurationLabel}
                layout="inline"
                className="set__select"
                value={eventDuration}
                onChange={(event) => {
                  const next = Number(event.target.value) as EventDurationMinutes;
                  persistEventDuration(next);
                  setEventDuration(next);
                }}
              >
                {EVENT_DURATIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {lookup(a.eventDurationOptions, String(minutes)) ?? String(minutes)}
                  </option>
                ))}
              </Select>
            </div>
            <div className={hits.has("calendar-clock") ? "set__field set__hit-field" : "set__field"}>
              <Select
                label={a.clockLabel}
                layout="inline"
                className="set__select"
                value={clock}
                onChange={(event) => {
                  const next = event.target.value as ClockPreference;
                  persistClock(next);
                  setClock(next);
                }}
              >
                {CLOCK_PREFERENCES.map((option) => (
                  <option key={option} value={option}>
                    {a.clockOptions[option]}
                  </option>
                ))}
              </Select>
              <p className="nx-hint">{a.clockHint}</p>
            </div>
            <ResetLink
              onClick={() =>
                setResetting({ id: "appearance", title: strings.settings.sectionTitle.appearance })
              }
            />
          </Card>

          {searchGroupTitle("keyboard")}
          {/* ADR-040's remapping table. Its own category now: „which keys do
              this on this machine" is a question about the keyboard rather than
              about the app's shape, and it used to sit between the module cards
              and the notifications — the exact hunt SET-015 removes. */}
          <Card
            id={sectionDomId("shortcuts")}
            title={strings.settings.sectionTitle.shortcuts}
            className={sectionClass(visibility.cards.has("shortcuts"))}
          >
            <ShortcutsSection
              overrides={shortcutOverrides}
              onChange={onShortcutOverridesChange}
              onShowAll={onShowShortcuts}
              globalTaken={globalShortcutTaken}
              hits={hits}
            />
          </Card>

          {searchGroupTitle("modules")}
          {/* ADR-086 §5 — why this profile's Nexus looks the way it does.
              First in „Moduli", above the gallery and the module cards it
              explains, because a summary belongs before the detail it
              summarises. */}
          <Card
            id={sectionDomId("setup")}
            title={strings.settings.sectionTitle.setup}
            className={sectionClass(visibility.cards.has("setup"))}
          >
            <SetupSection
              profileId={profileId}
              flags={flags}
              registry={registry}
              hits={hits}
              onRerunOnboarding={onRerunOnboarding}
            />
          </Card>

          <Card
            id={sectionDomId("modules")}
            title={strings.settings.sectionTitle.modules}
            className={sectionClass(visibility.cards.has("modules"))}
          >
            {[...registry.byCategory()].map(([category, members]) => (
              <div key={category} className="set__module-group">
                <h3 className="nx-eyebrow set__module-group-title">
                  {strings.settings.moduleCategories[category] ?? category}
                </h3>
                <div className="set__module-list">
                  {members.map((manifest) => {
                    const locked = LOCKED_MODULE_IDS.has(manifest.id);
                    const enabled = flags[manifest.id] ?? manifest.defaultEnabled;
                    return (
                      <div className="set__module-row" key={manifest.id}>
                        <div className="set__module-info">
                          <span
                            className={labelClass(
                              "set__module-name",
                              hits.has(moduleEntryId(manifest.id)),
                            )}
                          >
                            {moduleName(manifest.id)}
                          </span>
                          <span className="nx-hint">
                            {lookup(strings.settings.moduleDescriptions, manifest.id) ?? ""}
                          </span>
                        </div>
                        {locked ? (
                          <Chip>{strings.settings.modulesAlwaysOn}</Chip>
                        ) : (
                          <Checkbox
                            checked={enabled}
                            aria-label={moduleName(manifest.id)}
                            onChange={(event) => void toggleModule(manifest.id, event.target.checked)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {modulesError != null && <p className="set__error">{modulesError}</p>}
          </Card>

          {/* The picker, inline rather than behind the drawer's dialog: this is the
              page somebody opens to change what they have, and a card that only
              holds a button to open a dialog is a card that wastes a click. The
              component is the drawer's own, so the two surfaces cannot drift. */}
          <Card
            id={sectionDomId("packs")}
            title={strings.settings.sectionTitle.packs}
            className={sectionClass(visibility.cards.has("packs"))}
          >
            <ProPackList
              profileId={profileId}
              packs={new Set(enabledPacks(flags))}
              onFlagsChanged={onFlagsChanged}
            />
          </Card>

          {/* The long form of every notice the drawer shows short. It is the
              cheapest of the four mechanisms and, on its own, the least protective
              — a page nobody opens. It earns its place as the ANCHOR: the short
              line on each tool is only honest if the full text exists somewhere a
              person can actually read it, and this is that somewhere.

              Every class is listed, including the ones this profile's toolkits do
              not currently reach. „What does this app say about regulated work" is
              a question somebody asks BEFORE switching a toolkit on, and a card that
              answered it only for toolkits already enabled would be silent exactly
              when it was being consulted. */}
          <Card
            id={sectionDomId("risk")}
            title={strings.settings.sectionTitle.risk}
            className={sectionClass(visibility.cards.has("risk"))}
          >
            <p className="set__hint">{strings.pro.riskSection.description}</p>
            {TOOL_RISK_CLASSES.filter(
              (riskClass): riskClass is Exclude<ToolRiskClass, "none"> => riskClass !== "none",
            ).map((riskClass) => (
              <div className="set__module-group" key={riskClass}>
                <h3 className="nx-eyebrow set__module-group-title">
                  {strings.pro.risk[riskClass].label}
                </h3>
                <p className="nx-hint">{strings.pro.risk[riskClass].note}</p>
              </div>
            ))}
          </Card>

          {/* „Podešavanja modula": one row per module card this build draws, and
              each row opens that card alone. The rows come from the same
              `moduleSettingsCards` gate the cards below do, so a switched-off
              module offers neither a row nor a page. */}
          <Card
            title={s.moduleSettingsList}
            className={
              visibility.lists.has("module-settings") ? undefined : "set__section--hidden"
            }
          >
            {moduleCards.map((card) => (
              <SubPageListRow
                key={card.moduleId}
                id={card.moduleId}
                icon={moduleIconName(card.moduleId)}
                label={card.title}
                onOpen={() => navigate({ category: "modules", sub: card.moduleId })}
              />
            ))}
          </Card>

          {/* Every card a MODULE owns, composed from the registry in registry
              order (`manifest.settings`). Nothing is drawn for a module the
              profile has switched off — a card for a section the sidebar does
              not show would be a dangling control, which is the rule PRIV's card
              already followed and all of them now do. A declaration this build
              has no renderer for draws nothing, exactly as an unknown dashboard
              placement does. */}
          {moduleCards.map((card) => {
            const Body = MODULE_SETTINGS_PANELS[card.moduleId]?.Body;
            if (Body === undefined) return null;
            return (
              <Card
                key={card.moduleId}
                id={sectionDomId(card.moduleId)}
                title={card.title}
                className={sectionClass(visibility.cards.has(card.moduleId))}
              >
                {/* The reset count is a remount key: a cleared preference is
                    re-read by the body's own initializers, so the page never
                    learns what the panel stores. */}
                <Body key={resetCounts[card.moduleId] ?? 0} profileId={profileId} hits={hits} />
                {/* „Vrati na podrazumevano“ is the DECLARATION's decision, not a
                    list here: a card offers it when every value it holds lives
                    on this machine (SET §5). */}
                {isDeviceOnlyPanel(card.panel) && (
                  <ResetLink
                    onClick={() => setResetting({ id: card.moduleId, title: card.title })}
                  />
                )}
              </Card>
            );
          })}

          {searchGroupTitle("notifications")}
          <Card
            id={sectionDomId("notifications")}
            title={strings.settings.sectionTitle.notifications}
            className={sectionClass(visibility.cards.has("notifications"))}
          >
            {/* NTF-008's appetite presets, as the card's first ROW: the question is
                „koliko obaveštenja", the answer is the three-way choice, and the
                controls under it are the exceptions to whichever one is picked. */}
            <div className="set__field">
              <p className="nx-hint">{strings.settings.notificationPresets.label}</p>
              <div className="set__preset-row">
                {NOTIFICATION_PRESETS.map((preset) => (
                  <Button
                    key={preset.key}
                    size="sm"
                    variant={activePreset?.key === preset.key ? "primary" : "ghost"}
                    onClick={() => void applyPreset(preset.sources)}
                  >
                    {strings.settings.notificationPresets[preset.key]}
                  </Button>
                ))}
              </div>
              <p className="nx-hint">{strings.settings.notificationPresets.caption}</p>
            </div>
            {presetError != null && <p className="set__error">{presetError}</p>}
            <NotificationSettingsControls profileId={profileId} refreshToken={refreshToken} />
          </Card>

          {searchGroupTitle("data")}
          <Card
            id={sectionDomId("backup")}
            title={strings.settings.sectionTitle.backup}
            className={sectionClass(visibility.cards.has("backup"))}
          >
            <BackupSection profileId={profileId} />
            <AutoBackupSection profileId={profileId} hits={hits} />
            <RestoreSection profileId={profileId} hits={hits} />
          </Card>

          {/* „Uvoz i izvoz": the eight flows that used to share the card above.
              Each is a page of its own now, because „napravi rezervnu kopiju" and
              „uvezi izvod iz banke" are different acts with different
              consequences, and eleven blocks in one card made neither of them
              findable. */}
          <Card
            title={s.importExportList}
            className={visibility.lists.has("import-export") ? undefined : "set__section--hidden"}
          >
            {subPageListById("import-export").subPages.map((subPage) => (
              <SubPageListRow
                key={subPage.id}
                id={subPage.id}
                icon={subPage.icon}
                label={lookup(s.sectionTitle, subPage.id) ?? subPage.id}
                onOpen={() => navigate({ category: "data", sub: subPage.id })}
              />
            ))}
          </Card>

          {/* The eight sub-pages. Each card is named with the heading its block
              already drew, which is why the block's own eyebrow is suppressed —
              it would be the same words a second time, directly under the title. */}
          <Card
            id={sectionDomId("import-archive")}
            title={s.sectionTitle["import-archive"]}
            className={`${sectionClass(visibility.cards.has("import-archive"))}${
              hitCards.has("import-archive") ? " set__hit-card" : ""
            }`}
          >
            <ImportSection profileId={profileId} hits={hits} showTitle={false} />
          </Card>

          <Card
            id={sectionDomId("import-ics")}
            title={s.sectionTitle["import-ics"]}
            className={`${sectionClass(visibility.cards.has("import-ics"))}${
              hitCards.has("import-ics") ? " set__hit-card" : ""
            }`}
          >
            <IcsImportSection profileId={profileId} hits={hits} showTitle={false} />
          </Card>

          <Card
            id={sectionDomId("export-ics")}
            title={s.sectionTitle["export-ics"]}
            className={`${sectionClass(visibility.cards.has("export-ics"))}${
              hitCards.has("export-ics") ? " set__hit-card" : ""
            }`}
          >
            <CalendarExportSection profileId={profileId} hits={hits} showTitle={false} />
          </Card>

          <Card
            id={sectionDomId("import-apkg")}
            title={s.sectionTitle["import-apkg"]}
            className={`${sectionClass(visibility.cards.has("import-apkg"))}${
              hitCards.has("import-apkg") ? " set__hit-card" : ""
            }`}
          >
            <ApkgImportSection profileId={profileId} hits={hits} showTitle={false} />
          </Card>

          <Card
            id={sectionDomId("import-csv")}
            title={s.sectionTitle["import-csv"]}
            className={`${sectionClass(visibility.cards.has("import-csv"))}${
              hitCards.has("import-csv") ? " set__hit-card" : ""
            }`}
          >
            <CsvImportSection profileId={profileId} hits={hits} showTitle={false} />
          </Card>

          <Card
            id={sectionDomId("import-fin-csv")}
            title={s.sectionTitle["import-fin-csv"]}
            className={`${sectionClass(visibility.cards.has("import-fin-csv"))}${
              hitCards.has("import-fin-csv") ? " set__hit-card" : ""
            }`}
          >
            {/* The same component the finance page mounts (FIN slice e) — one
                flow, two places to reach it, because a second copy of a state
                machine that writes money is a second place for it to go wrong. */}
            <FinCsvImportSection profileId={profileId} showTitle={false} />
          </Card>

          <Card
            id={sectionDomId("import-llm")}
            title={s.sectionTitle["import-llm"]}
            className={`${sectionClass(visibility.cards.has("import-llm"))}${
              hitCards.has("import-llm") ? " set__hit-card" : ""
            }`}
          >
            <LlmImportSection profileId={profileId} hits={hits} showTitle={false} />
          </Card>

          <Card
            id={sectionDomId("import-markdown")}
            title={s.sectionTitle["import-markdown"]}
            className={`${sectionClass(visibility.cards.has("import-markdown"))}${
              hitCards.has("import-markdown") ? " set__hit-card" : ""
            }`}
          >
            <MarkdownImportSection profileId={profileId} hits={hits} showTitle={false} />
          </Card>

          {/* The cloud half. It is a DEVICE card, not a profile one: the cloud
              switch, the account and the master key belong to this computer, so
              it takes no `profileId` and shows the same thing in every profile. */}
          <Card
            id={sectionDomId("sync")}
            title={strings.settings.sectionTitle.sync}
            className={sectionClass(visibility.cards.has("sync"))}
          >
            <SyncSection hits={hits} />
          </Card>

          {searchGroupTitle("privacy")}
          {/* SET-010, local half. Six statements of fact — no toggle, no link, no
              „saznaj više“ on any of them. Every sentence is checkable in the
              source; see the copy block's own comment, which names the file each
              one is true because of. Below them, the one thing on this card that
              IS operable (SRCH-009): the search history is the only place the app
              stores something about how you used it rather than what you made, so
              the card that lists what is stored is where you erase it. */}
          <Card
            id={sectionDomId("privacy")}
            title={strings.settings.sectionTitle.privacy}
            className={sectionClass(visibility.cards.has("privacy"))}
          >
            <p className="nx-hint">{strings.settings.privacy.storage}</p>
            <p className="nx-hint">{strings.settings.privacy.noTelemetry}</p>
            <p className="nx-hint">{strings.settings.privacy.offline}</p>
            <p className="nx-hint">{strings.settings.privacy.sync}</p>
            <p className="nx-hint">{strings.settings.privacy.exports}</p>
            <p className="nx-hint">{strings.settings.privacy.deletion}</p>
            <SearchHistorySection profileId={profileId} hits={hits} />
          </Card>

          {searchGroupTitle("about")}
          <Card
            id={sectionDomId("about")}
            title={strings.settings.sectionTitle.about}
            className={sectionClass(visibility.cards.has("about"))}
          >
            {info ? (
              <dl className="app__facts">
                <div>
                  <dt>{strings.settings.about.version}</dt>
                  <dd>
                    {info.name} {info.version}
                  </dd>
                </div>
                <div>
                  <dt>{strings.settings.about.electron}</dt>
                  <dd>{info.versions.electron}</dd>
                </div>
                <div>
                  <dt>{strings.settings.about.chromium}</dt>
                  <dd>{info.versions.chrome}</dd>
                </div>
                <div>
                  <dt>{strings.settings.about.node}</dt>
                  <dd>{info.versions.node}</dd>
                </div>
                <div>
                  <dt>{strings.settings.about.dataLocation}</dt>
                  <dd className="app__path">{info.userDataPath}</dd>
                </div>
              </dl>
            ) : (
              <p className="nx-hint">{strings.app.loading}</p>
            )}
          </Card>

          {/* The notices this product owes for other people's work. Last on the
              page and after „O aplikaciji" on purpose: it is about the app rather
              than about the user, and it is the longest thing here. */}
          <Card
            id={sectionDomId("licences")}
            title={strings.settings.sectionTitle.licences}
            className={sectionClass(visibility.cards.has("licences"))}
          >
            <LicencesSection />
          </Card>

        </div>
      </div>

      {/* One dialog for every resettable card — the question is the same
          question, and only the card it names differs (SET §5). */}
      {resetting !== null && (
        <SettingsResetDialog
          sectionTitle={resetting.title}
          onConfirm={() => runReset(resetting.id)}
          onCancel={() => setResetting(null)}
        />
      )}
    </div>
  );
}

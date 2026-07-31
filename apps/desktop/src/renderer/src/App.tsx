import { useCallback, useEffect, useMemo, useState } from "react";
import { formatChord, matchesChord, moduleNavPosition, resolveEnabled } from "@nexus/core";
import { Button, EmptyState, NavItem } from "@nexus/ui";
import type { ThemeName } from "@nexus/tokens";
import type {
  AppInfo,
  AuthStatus,
  FlagState,
  Profile,
  RestoreUndoKind,
  SearchResult,
} from "../../shared/ipc.js";
import { AuthGate } from "./AuthGate.js";
import { Onboarding } from "./Onboarding.js";
import { ProfileSwitchDialog } from "./ProfileSwitchDialog.js";
import { NotePopover } from "./notePopover.js";
import { applyProfileAccent, defaultAccent, seedAccent } from "./accent.js";
import {
  persistActiveProfile,
  profileDisplayName,
  resolveActiveProfile,
} from "./profilePrefs.js";
import { DashboardPage } from "./DashboardPage.js";
import { TasksPage, type TasksIntent } from "./TasksPage.js";
import { CalendarPage, type CalendarIntent } from "./CalendarPage.js";
import { NotesPage, type NotesIntent } from "./NotesPage.js";
import { PrivPage, PRIV_LOCKED_EVENT } from "./PrivPage.js";
import { StudyPage, type StudyIntent } from "./StudyPage.js";
import { SettingsPage, formatArchiveInstant } from "./SettingsPage.js";
import { NotificationCenter } from "./NotificationCenter.js";
import { NotificationAppetiteDialog } from "./NotificationAppetiteDialog.js";
import { SearchPalette } from "./SearchPalette.js";
import { SearchPage } from "./SearchPage.js";
import { ShortcutsDialog } from "./ShortcutsDialog.js";
import { buildSearchCommands } from "./searchCommands.js";
import { createModuleRegistry } from "../../shared/modules.js";
import { ProfileAvatar } from "./profileAvatar.js";
import { persistAutoLock, readStoredAutoLock, type AutoLockMinutes } from "./autoLock.js";
import {
  readStoredShortcutOverrides,
  resolveShortcuts,
  SHORTCUT_ACTIONS,
  writeStoredShortcutOverrides,
  type ShortcutActionId,
  type ShortcutOverrides,
} from "./shortcuts.js";
import {
  persistThemePreference,
  readStoredThemePreference,
  resolveTheme,
  subscribeSystemTheme,
  type ThemePreference,
} from "./theme.js";
import { strings } from "./strings.js";

/**
 * A pending page-level intent (021-e): one payload, tagged with the module
 * that must consume it. One state rather than four keeps the invariant that
 * only ever ONE intent is pending, and gives `clearIntent` a single job — the
 * page reports back through `onIntentHandled` and this clears it, so returning
 * to that module later never re-fires a stale reveal.
 */
type PendingIntent =
  | { module: "tasks"; intent: TasksIntent }
  | { module: "calendar"; intent: CalendarIntent }
  | { module: "notes"; intent: NotesIntent }
  | { module: "study"; intent: StudyIntent };

/**
 * The full search page's `activeId` (ADR-039 §1). Deliberately NOT a registry
 * id: search is a system surface like the palette, so it must never show up in
 * the Settings module gallery or grow an enable flag, and the registry's rule
 * stays "hub pages only". Every place that treats `activeId` as a module id
 * therefore has to exempt this one — `effectiveId` and the route guard below.
 */
const SEARCH_PAGE_ID = "search";

/**
 * What the one undo banner says it is offering to undo. A closed map over the
 * wire's own `RestoreUndoKind`, so an operation added to that slot in
 * `shared/ipc.ts` is a compile error here rather than a banner that silently
 * names the wrong thing — which for a button that REPLACES a whole profile is
 * the worst possible gap.
 */
const RESTORE_UNDO_BANNERS: Record<RestoreUndoKind, string> = {
  restore: strings.settings.restore.undoBanner,
  import: strings.settings.import.undoBanner,
  apkg: strings.settings.apkgImport.undoBanner,
  llm: strings.settings.llmImport.undoBanner,
  csv: strings.settings.csvImport.undoBanner,
  ics: strings.settings.icsImport.undoBanner,
};

/** Idle events that count as activity for the auto-lock timer (AUTH-005). */
const IDLE_ACTIVITY_EVENTS = ["mousemove", "keydown", "mousedown", "wheel"] as const;
// A mousemove storm must not rebuild the lock timer on every pixel — activity
// resets it at most once per this window.
const IDLE_RESET_THROTTLE_MS = 1000;

// The registry is static, compiled-in data (ADR-008) — built once per renderer.
const registry = createModuleRegistry();

/**
 * ADR-058 (NTF active-profile rule): tells main which profile this shell is
 * standing in, so the notification scheduler serves the active profile only —
 * called from both landings (the unlock load and a verified switch).
 * Best-effort by design: a shell that loaded matters more than a scheduler
 * told late, and main's own default (the personal anchor) holds until the
 * report arrives. Module-level because it touches no component state.
 */
function reportActiveProfile(profileId: string): void {
  window.nexus.setActiveProfile(profileId).catch((error: unknown) => {
    console.error("Nexus: failed to report the active profile:", error);
  });
}

/** Sidebar/page display name for a module id; falls back to the id. Exported for `searchCommands.ts`'s "Idi na: <modul>" labels, so they are never re-spelled. */
export function moduleName(id: string): string {
  return strings.modules[id] ?? id;
}

export function App() {
  const [preference, setPreference] = useState<ThemePreference>(readStoredThemePreference);
  // The resolved theme lives in state (not derived inline) so an OS light/dark
  // switch while in system mode re-renders the topbar toggle's label.
  const [theme, setTheme] = useState<ThemeName>(() => resolveTheme(preference));
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  // Which of the account's profiles the shell is standing in (ADR-058 §1).
  // Null only until `loadUnlockedData` resolves the stored device pref against
  // the live list; from then on it names a member of `profiles`, and every
  // page below hangs off it.
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  // The profile the passcode gate (AUTH-024) is currently asking about, or
  // null. Set by the sidebar switcher and the „Profili“ card; the dialog's
  // verified answer lands in `completeSwitch`.
  const [switchTarget, setSwitchTarget] = useState<Profile | null>(null);
  // The switcher's own error line, for the two refusals that have no card to
  // report into: creating a business profile from the popover, and a delete
  // that failed AFTER evicting the active profile (the card that asked was
  // remounted away by the eviction). The „Profili“ card shows every other
  // error itself.
  const [profileActionError, setProfileActionError] = useState<string | null>(null);
  // Per-profile module overrides (SET-007). Empty until loaded — every v0
  // module defaults enabled, so the pre-load render matches the common case.
  const [flags, setFlags] = useState<FlagState>({});
  const [failed, setFailed] = useState(false);
  const [activeId, setActiveId] = useState("dashboard");
  // Pending page-level intent (021-e): reveal or create, tagged with the
  // module that owns it. That page consumes it on arrival and reports back
  // via onIntentHandled (`clearIntent`), so a later return to that module
  // never re-fires the same intent.
  const [pending, setPending] = useState<PendingIntent | null>(null);
  // The local account's lock state (ADR-018). `null` only until the very
  // first `getAuthStatus` round trip resolves.
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [autoLockMinutes, setAutoLockMinutes] = useState<AutoLockMinutes>(readStoredAutoLock);
  // Remapped shortcuts (ADR-040). Read once at init and owned here — the
  // `autoLockMinutes` precedent: a device-level UI preference, so it lives in
  // `localStorage` and is handed to SettingsPage with an onChange rather than
  // being re-read wherever it happens to be needed.
  const [shortcutOverrides, setShortcutOverrides] =
    useState<ShortcutOverrides>(readStoredShortcutOverrides);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  // TASK-002: whether the SYSTEM refused the global capture chord because
  // another application already holds it. Main keeps its previous working
  // registration in that case, so this is only a message for the Settings row —
  // never a state anything has to repair.
  const [globalCaptureTaken, setGlobalCaptureTaken] = useState(false);
  // Global search palette (021-d). `searchStatus` is the rebuild command's
  // Serbian confirmation/error text — owned here since this is where the
  // command's `run` closure is built (see `buildSearchCommands` below).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  // A query handed from the palette to the full page (ADR-039 §5). Held here
  // rather than pushed as a prop-with-a-reset because the page may not be
  // mounted at the moment the palette closes; the page consumes it on mount
  // and clears it through `onSeedConsumed`.
  const [searchSeed, setSearchSeed] = useState<string | null>(null);
  // The post-reload archive banner (IMEX slice 3d, ADR-023; ADR-043 §4;
  // ADR-052; IMEX-005). Applying a restore or any of the three imports reloads
  // this renderer, so the screen that ran it is gone by the time there is
  // anything to say — `restoreStatus` below is how the fresh renderer learns an
  // undo is still available. One slot, one banner: `kind` is what the offer is
  // worded from, since "vraćanje", "uvoz iz arhive", "uvoz iz Ankija" and "uvoz
  // preko AI asistenta" undo very different things through the same mechanism.
  const [restoreUndo, setRestoreUndo] = useState<{
    kind: RestoreUndoKind;
    appliedAt: string;
  } | null>(null);
  // Dismissal is presentational and session-only: it hides the banner, it does
  // NOT cancel the undo — main keeps that until the app is locked or closed,
  // and a locked session drops it anyway. Deliberately not persisted: the next
  // unlock has no undo left to offer, so there is nothing for a remembered
  // dismissal to suppress.
  const [restoreBannerHidden, setRestoreBannerHidden] = useState(false);
  const [undoingRestore, setUndoingRestore] = useState(false);
  const [restoreUndoError, setRestoreUndoError] = useState<string | null>(null);
  // The one-time notification-appetite question (NTF-008 / ADR-033). Main
  // decides WHEN to ask — at the first reminder moment it can actually be seen —
  // and pushes a payload-free event; this flag is only "is it on screen". Main
  // may push again on a later check while the question is still unanswered
  // (its own held-cycle mechanism), so setting a boolean already true is the
  // guard against opening twice.
  const [appetiteAsk, setAppetiteAsk] = useState(false);

  /** Loads everything that requires an open database. Only ever called once `auth:status` (or an unlock/create/recover result) has confirmed `state === "unlocked"`. */
  async function loadUnlockedData(): Promise<void> {
    const [nextInfo, nextProfiles] = await Promise.all([
      window.nexus.appInfo(),
      window.nexus.listProfiles(),
    ]);
    // ADR-058 §1: the last-active device pref, validated against the live list
    // — a stale id falls back to the personal profile. Persisted back so the
    // stored pref always names a live profile, and the profile's own accent is
    // re-applied here (§3) so an unlock lands in it fully, boot's raw-pref
    // paint corrected.
    const active = resolveActiveProfile(nextProfiles);
    const nextFlags = active ? await window.nexus.getFlags(active.id) : {};
    setInfo(nextInfo);
    setProfiles(nextProfiles);
    setActiveProfileId(active?.id ?? null);
    setFlags(nextFlags);
    if (active) {
      persistActiveProfile(active.id);
      applyProfileAccent(active.id, active.kind);
      reportActiveProfile(active.id);
    }
    // Signal the --smoke harness that the full renderer -> main -> DB path worked.
    window.__nexusReady = true;
    window.dispatchEvent(new Event("nexus-ready"));
  }

  // ADR-018: `auth:status` is the FIRST thing the renderer asks about — before
  // profiles, before flags. Only when it reports "unlocked" (the smoke run's
  // own path, which unlocks before the window loads) does this go on to load
  // app data; a locked/uninitialized status renders `AuthGate` instead
  // (below), and `__nexusReady` is deliberately never set from that branch.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const status = await window.nexus.getAuthStatus();
        if (!active) return;
        setAuthStatus(status);
        if (status.state === "unlocked") {
          await loadUnlockedData();
        }
      } catch (error) {
        if (!active) return;
        window.__nexusError = true;
        window.dispatchEvent(new Event("nexus-error"));
        setFailed(true);
        console.error("Nexus IPC bridge failed:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  /** `AuthGate`'s `onUnlocked`: re-reads status and, once it is genuinely "unlocked", loads app data — the same path the bootstrap effect takes when the smoke run is already unlocked at load. */
  async function handleUnlocked(): Promise<void> {
    try {
      const status = await window.nexus.getAuthStatus();
      setAuthStatus(status);
      if (status.state === "unlocked") {
        await loadUnlockedData();
      }
    } catch (error) {
      window.__nexusError = true;
      window.dispatchEvent(new Event("nexus-error"));
      setFailed(true);
      console.error("Nexus IPC bridge failed:", error);
    }
  }

  /** The sidebar's manual Zaključaj action, and the idle auto-lock's own trigger. */
  async function handleLock(): Promise<void> {
    try {
      await window.nexus.lock();
    } catch (error) {
      console.error("Nexus: failed to lock:", error);
    }
    // A half-answered profile switch dies with the session: the next unlock may
    // be a DIFFERENT account (ADR-044), and a surviving `switchTarget` would
    // resurrect a passcode dialog aimed at a profile that account does not have.
    setSwitchTarget(null);
    setProfileActionError(null);
    setAuthStatus((previous) => ({
      state: "locked",
      lockedForMs: 0,
      keystoreAvailable: previous?.keystoreAvailable ?? true,
      requiresRecovery: false,
      // Carried over rather than re-fetched: locking changes neither the
      // account list nor which one is selected (ADR-044), and AuthGate needs
      // both to decide whether to open on the picker or the passcode form.
      accounts: previous?.accounts ?? [],
      selectedAccountId: previous?.selectedAccountId ?? null,
    }));
  }

  // Idle auto-lock (AUTH-005): only while genuinely unlocked, and only when
  // the preference is not "never". Listeners are attached once per
  // (unlocked-state, preference) pair and torn down on every cleanup —
  // including the one that fires the instant `handleLock` flips `authStatus`
  // away from "unlocked" — so a stray timer can never fire a second lock
  // after the app is already locked.
  useEffect(() => {
    if (authStatus?.state !== "unlocked" || autoLockMinutes === 0) return;

    let lockTimeout: ReturnType<typeof setTimeout> | undefined;
    let throttleTimeout: ReturnType<typeof setTimeout> | undefined;

    function scheduleLock(): void {
      lockTimeout = setTimeout(() => void handleLock(), autoLockMinutes * 60_000);
    }

    function resetTimer(): void {
      if (throttleTimeout !== undefined) return; // within the throttle window — ignore this burst
      throttleTimeout = setTimeout(() => {
        throttleTimeout = undefined;
      }, IDLE_RESET_THROTTLE_MS);
      clearTimeout(lockTimeout);
      scheduleLock();
    }

    scheduleLock();
    for (const eventName of IDLE_ACTIVITY_EVENTS) {
      window.addEventListener(eventName, resetTimer);
    }
    return () => {
      for (const eventName of IDLE_ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, resetTimer);
      }
      clearTimeout(lockTimeout);
      clearTimeout(throttleTimeout);
    };
  }, [authStatus?.state, autoLockMinutes]);

  function changeAutoLock(value: AutoLockMinutes): void {
    persistAutoLock(value);
    setAutoLockMinutes(value);
  }

  // Stable across renders: SettingsPage's capture mode lists this in the
  // dependency array of the effect that attaches its one-keystroke listener,
  // and a fresh reference on every unrelated App re-render would tear that
  // listener down and re-attach it mid-capture.
  const changeShortcutOverrides = useCallback((next: ShortcutOverrides) => {
    writeStoredShortcutOverrides(next);
    setShortcutOverrides(next);
  }, []);

  const shortcuts = useMemo(() => resolveShortcuts(shortcutOverrides), [shortcutOverrides]);

  // TASK-002: main registers the OS-wide capture hotkey, but only the renderer
  // can read which chord it is — `localStorage` is a renderer-side store, the
  // same reason the theme and auto-lock preferences live here. So the chord is
  // handed over once the shell mounts and again on every remap; the identity of
  // `shortcuts.globalCapture` only changes when the overrides do (the memo
  // above), so this does not re-register on unrelated renders.
  //
  // Deliberately NOT gated on the unlocked state: the hotkey brings the window
  // up on the lock screen too (main decides what happens next), and a chord the
  // user cannot use until they unlock is worse than none.
  const globalCaptureChord = shortcuts.globalCapture;
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await window.nexus.setGlobalShortcut(globalCaptureChord);
        if (active) setGlobalCaptureTaken(!result.ok);
      } catch (error) {
        console.error("Nexus: failed to register the global shortcut:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [globalCaptureChord]);

  /**
   * The sidebar's own order — `registry.byCategory()` flattened, filtered by
   * the enabled flags — which is what Ctrl+1…Ctrl+9 count along. Deliberately
   * NOT `resolveEnabled`: that returns registration order, and the two are
   * only accidentally equal for today's module set.
   */
  const visibleModuleIds = useMemo(() => {
    const enabled = new Set(resolveEnabled(registry, flags));
    return [...registry.byCategory()].flatMap(([, members]) =>
      members.filter((manifest) => enabled.has(manifest.id)).map((manifest) => manifest.id),
    );
  }, [flags]);

  // The profile every page below is handed (ADR-058) — the state's id resolved
  // against the live list. Same-array lookups return the same object, so this
  // is a stable effect dependency across unrelated renders.
  const activeProfile = profiles?.find((profile) => profile.id === activeProfileId);

  /**
   * Lands a VERIFIED profile switch (AUTH-024 passed — or a forced eviction,
   * see `deleteProfileAnywhere`). The restore flow reloads the whole renderer
   * for its version of this; a switch takes the lighter path: swap the id
   * every page hangs off (each page carries `key={activeProfile.id}`, so it
   * remounts and re-enters the new profile cleanly), persist the device pref,
   * re-apply the profile's own accent (§3) and re-read its flags. Cross-profile
   * leftovers — a pending intent, a seeded search query, the open palette —
   * are dropped: they were aimed at entities of the profile being left.
   */
  async function completeSwitch(profile: Profile): Promise<void> {
    setSwitchTarget(null);
    setProfileActionError(null);
    setActiveProfileId(profile.id);
    persistActiveProfile(profile.id);
    applyProfileAccent(profile.id, profile.kind);
    // ADR-058 (NTF rule): the switch landing informs main, which restarts the
    // scheduler for the entered profile — its backlog arrives as the catch-up
    // burst, because its ledger was untouched while it was inactive.
    reportActiveProfile(profile.id);
    setPending(null);
    setSearchSeed(null);
    closePalette();
    try {
      setFlags(await window.nexus.getFlags(profile.id));
    } catch (error) {
      console.error("Nexus: failed to load flags after a profile switch:", error);
    }
  }

  /**
   * ADR-058 §4: creates THE business profile (v1 allows one per account) with
   * the EMPTY-name sentinel, which routes its first entry through ONB-lite
   * naming. The reserved bordo accent (§3, decision #11) is seeded — written,
   * not painted — immediately, so the profile's very first entry, the naming
   * screen included, already opens under it. Main seeds the profile's data
   * side (Inbox, module preset); the renderer names only kind and name.
   */
  async function createBusinessProfile(): Promise<Profile> {
    const created = await window.nexus.createProfile("business", "");
    seedAccent(created.id, defaultAccent("business"));
    setProfiles((previous) => (previous === null ? [created] : [...previous, created]));
    return created;
  }

  /** The switcher popover's „Novi poslovni profil…“: create, then offer the switch through the same passcode gate every switch passes. */
  async function createBusinessFromSwitcher(): Promise<void> {
    setProfileActionError(null);
    try {
      setSwitchTarget(await createBusinessProfile());
    } catch (error) {
      setProfileActionError(strings.profiles.createError);
      console.error("Nexus: failed to create the business profile:", error);
    }
  }

  /**
   * ADR-058 §4: deletes a business profile after the „Profili“ card's
   * typed-name confirm. Deleting the ACTIVE profile moves the shell to the
   * personal profile FIRST — without the passcode gate, deliberately: AUTH-024
   * guards switching INTO a profile by choice, while this is an eviction from
   * one that is about to stop existing, and the personal anchor belongs to the
   * session the user already proved. The wire re-refuses the personal anchor
   * and the last profile; this UI never offers them (UI is UX, main is the
   * gate). Errors are the caller's — the card owns the dialog's error line.
   */
  async function deleteProfileAnywhere(profile: Profile): Promise<void> {
    const evicting = profile.id === activeProfileId;
    if (evicting) {
      const personal = profiles?.find((candidate) => candidate.kind === "personal");
      if (personal === undefined) return;
      await completeSwitch(personal);
    }
    try {
      await window.nexus.deleteProfile(profile.id);
    } catch (error) {
      // When the switch above ran, the „Profili“ card was just remounted away
      // (pages are keyed by the active profile) — its own error line cannot
      // show, so the refusal surfaces under the switcher instead of nowhere.
      if (evicting) setProfileActionError(strings.settings.profiles.deleteError);
      throw error;
    }
    setProfiles((previous) =>
      previous === null ? previous : previous.filter((candidate) => candidate.id !== profile.id),
    );
  }

  // Asked once per unlocked session, and only after profiles are known: main
  // holds the undo in memory, so a locked or freshly launched app has nothing
  // to report and the banner never appears.
  useEffect(() => {
    if (authStatus?.state !== "unlocked" || activeProfileId === null) return;
    let active = true;
    void (async () => {
      try {
        const status = await window.nexus.restoreStatus(activeProfileId);
        if (active) {
          const undo = status.undo;
          setRestoreUndo(undo === null ? null : { kind: undo.kind, appliedAt: undo.appliedAt });
        }
      } catch (error) {
        console.error("Nexus: failed to read the restore status:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [authStatus?.state, activeProfileId]);

  /** The banner's "Opozovi": puts the profile back exactly as it was before the restore — or before the import, which undoes through the same slot. */
  async function undoRestore(): Promise<void> {
    if (activeProfileId === null || undoingRestore) return;
    setUndoingRestore(true);
    setRestoreUndoError(null);
    try {
      await window.nexus.undoRestore(activeProfileId);
      // Main reloads this renderer moments after the reply lands (ADR-023).
      // Nothing is cleared here on purpose — the reloaded app asks
      // `restoreStatus` again and finds no undo left — and `undoingRestore`
      // stays true so the button cannot be pressed twice in that window.
    } catch (error) {
      setRestoreUndoError(strings.settings.restore.undoError);
      console.error("Nexus: failed to undo the restore:", error);
      setUndoingRestore(false);
    }
  }

  // While in system mode, follow OS light/dark changes live (SET-004).
  useEffect(() => {
    if (preference !== "system") return;
    return subscribeSystemTheme(() => {
      persistThemePreference("system"); // re-applies the freshly resolved theme to <html>
      setTheme(resolveTheme("system"));
    });
  }, [preference]);

  // Route guard companion: when the active module gets disabled (or a deep
  // link targets a disabled one), reset the state so the nav highlight is
  // honest — `effectiveId` below already renders the dashboard either way.
  // `SEARCH_PAGE_ID` is exempt: it is a shell surface, not a registry module,
  // so it is never in the enabled set and must not be guarded out of.
  useEffect(() => {
    if (activeId === SEARCH_PAGE_ID) return;
    if (!new Set(resolveEnabled(registry, flags)).has(activeId)) {
      setActiveId("dashboard");
      // A pending intent aimed at a now-disabled module has no page left to
      // consume it and call onIntentHandled — clear it here instead, or it
      // would sit pending forever.
      setPending((current) => (current?.module === activeId ? null : current));
    }
  }, [activeId, flags]);

  function changePreference(next: ThemePreference): void {
    persistThemePreference(next);
    setPreference(next);
    setTheme(resolveTheme(next));
  }

  // The quick-toggle flips to the explicit opposite of the *resolved* theme,
  // deliberately leaving system mode — a manual flip is an explicit choice.
  function toggleTheme(): void {
    changePreference(theme === "noc" ? "dan" : "noc");
  }

  // Stable across renders: the appetite dialog's Escape listener depends on the
  // callback that answers, which depends on this — a fresh reference on every
  // unrelated App re-render would tear the listener down and re-register it for
  // nothing.
  const closeAppetiteAsk = useCallback(() => setAppetiteAsk(false), []);

  // Stable across renders: every page lists `onIntentHandled` (this) in its
  // own intent-effect's dependency array, and a fresh reference on every
  // unrelated App re-render would retrigger that effect for nothing.
  const clearIntent = useCallback(() => setPending(null), []);

  /** Sets the pending intent and switches to the module that owns it — the one place both happen together. */
  function dispatchIntent(next: PendingIntent): void {
    setPending(next);
    setActiveId(next.module);
  }

  /**
   * The app's first cross-module deep link (STUDY -> the note a flashcard was
   * generated from, ADR-017): rides the shared intent mechanism (021-e) that
   * every page now consumes the same way, extending NotificationCenter's
   * `onNavigate={setActiveId}` precedent with a payload NotesPage consumes on
   * arrival.
   */
  function openNote(noteId: string): void {
    dispatchIntent({ module: "notes", intent: { kind: "reveal", noteId } });
  }

  /**
   * Starts a fresh entity in a module through its own create intent (021-e).
   * Shared by the palette's "Novi …" commands and ADR-040's quick-create
   * chord, so both mean exactly the same thing; a module with no create intent
   * falls through and does nothing, predictably.
   */
  function createInModule(moduleId: string): void {
    switch (moduleId) {
      case "tasks":
        dispatchIntent({ module: "tasks", intent: { kind: "create" } });
        return;
      case "calendar":
        dispatchIntent({ module: "calendar", intent: { kind: "create-event" } });
        return;
      case "notes":
        dispatchIntent({ module: "notes", intent: { kind: "create" } });
        return;
    }
  }

  /**
   * TASK-002's landing: ZADACI with the quick-add input focused, which is
   * exactly the tasks module's existing "create" intent (021-e) — the same one
   * the palette's „Novi zadatak" and the in-app quick-create chord dispatch, so
   * arriving from outside the app lands on precisely the surface arriving from
   * inside it does.
   *
   * Nothing happens when TASKS is switched off (SET-007): dispatching would
   * only bounce off the route guard back to the dashboard, and a hotkey that
   * silently navigates elsewhere is worse than one that does nothing. The
   * window has still been brought up by then — main does that unconditionally.
   *
   * Stable across renders: the push subscription below lists it in its
   * dependency array, and a fresh reference each render would tear the
   * subscription down and re-register it for nothing.
   */
  const openTaskCapture = useCallback((): void => {
    if (!visibleModuleIds.includes("tasks")) return;
    setPending({ module: "tasks", intent: { kind: "create" } });
    setActiveId("tasks");
  }, [visibleModuleIds]);

  // Stable across renders: `SearchPalette`'s own auto-close effect (the
  // rebuild command's confirmation timer) depends on this callback, and a
  // fresh reference on every unrelated App re-render would restart that
  // timer's cleanup/reschedule each time, quietly extending how long the
  // confirmation stays up.
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    setSearchStatus(null);
  }, []);

  // The appetite ask (NTF-008): subscribed only while genuinely unlocked, since
  // main never runs a check against a locked session and a dialog over the lock
  // screen would have no profile to answer for. Torn down on lock with the
  // subscription, and the flag is cleared with it so a later unlock starts from
  // "not on screen" rather than resurrecting a dialog nobody is answering.
  //
  // The search palette is closed as the question opens. Both listen for Escape
  // on the document, so leaving the palette up would let one keypress close it
  // AND answer a one-time question the user never got to read — and this
  // question is asked once, ever. It is also simply modal: nothing else should
  // share the screen with it.
  useEffect(() => {
    if (authStatus?.state !== "unlocked") {
      setAppetiteAsk(false);
      return;
    }
    return window.nexus.onNotificationAppetiteAsk(() => {
      closePalette();
      setAppetiteAsk(true);
    });
  }, [authStatus?.state, closePalette]);

  // The OS hotkey firing while Nexus was in the background (TASK-002). Main has
  // already restored and focused the window by the time this arrives, and only
  // ever pushes it to an unlocked session — subscribed only while unlocked for
  // the same reason the appetite ask is: there is no shell to route into
  // otherwise. Overlays are dismissed first, exactly as `runShortcutAction`
  // does: the chord means "capture a task", and landing behind the palette or
  // the reference is not that.
  useEffect(() => {
    if (authStatus?.state !== "unlocked") return;
    return window.nexus.onGlobalCapture(() => {
      closePalette();
      setShortcutsHelpOpen(false);
      openTaskCapture();
    });
  }, [authStatus?.state, closePalette, openTaskCapture]);

  // Stable across renders for the same reason `clearIntent` is: `SearchPage`
  // lists it in a mount effect's dependency array.
  const clearSearchSeed = useCallback(() => setSearchSeed(null), []);

  /** The palette's "Prikaži sve rezultate" row: carry the query to the page and go there. */
  const openSearchPage = useCallback((query: string) => {
    setSearchSeed(query);
    setActiveId(SEARCH_PAGE_ID);
  }, []);

  /**
   * Activates a global-search result (021-d/021-e): dispatches the intent
   * that reveals the exact entity on its owning module's page, rather than
   * only switching to that module. "note" and "attachment" ride the same
   * `openNote` cross-module link ADR-017 already uses from STUDY; every
   * other kind maps directly to its module's own intent shape.
   */
  function onSearchResult(result: SearchResult): void {
    switch (result.kind) {
      case "note":
        openNote(result.entityId);
        return;
      case "attachment":
        if (result.parentId) {
          openNote(result.parentId);
        } else {
          console.error("Nexus: attachment search result has no parent note id:", result.entityId);
        }
        return;
      case "task":
        dispatchIntent({ module: "tasks", intent: { kind: "reveal", taskId: result.entityId } });
        return;
      case "event":
        dispatchIntent({
          module: "calendar",
          intent: { kind: "reveal-event", eventId: result.entityId },
        });
        return;
      case "document":
        dispatchIntent({
          module: "calendar",
          intent: { kind: "reveal-document", documentId: result.entityId },
        });
        return;
      case "subject":
      case "exam":
      case "deck":
      case "card":
        dispatchIntent({
          module: "study",
          intent: {
            kind: "reveal",
            entity: result.kind,
            id: result.entityId,
            parentId: result.parentId,
          },
        });
        return;
    }
  }

  /**
   * Runs one of the remappable core actions (ADR-040). Every action dismisses
   * the overlays it is not itself opening: these actions navigate or put a new
   * surface up, and landing underneath one that is still on screen is not what
   * pressing the chord meant.
   */
  function runShortcutAction(actionId: ShortcutActionId): void {
    if (actionId === "shortcutsHelp") {
      closePalette();
      setShortcutsHelpOpen(true);
      return;
    }
    setShortcutsHelpOpen(false);
    if (actionId === "palette") {
      setPaletteOpen((open) => !open);
      setSearchStatus(null);
      return;
    }
    closePalette();
    switch (actionId) {
      case "quickCreate":
        // The ACTIVE module's create intent — matching what `effectiveId`
        // below actually renders, so the chord never creates in a module the
        // user is not looking at.
        createInModule(visibleModuleIds.includes(activeId) ? activeId : "dashboard");
        return;
      case "globalCapture":
        // Also handled in-app, not only by the OS registration: when the system
        // refused the combination (another application holds it), pressing it
        // with Nexus focused must still capture a task.
        openTaskCapture();
        return;
      case "lock":
        void handleLock();
        return;
      case "privLock":
        // The PRIV panic path (ADR-057 §5): drop the held DEK in main first,
        // then tell a mounted „Privatno" page to swap the lock screen in —
        // the event is presentation only, the lock already happened.
        void window.nexus.privLock().catch((error: unknown) => {
          console.error("Nexus: failed to lock the private section:", error);
        });
        window.dispatchEvent(new Event(PRIV_LOCKED_EVENT));
        return;
      case "settings":
        setActiveId("settings");
        return;
    }
  }

  /**
   * The app's one global chord handler (ADR-040) — it replaced the inline
   * Ctrl+K listener this shell used to carry. Armed only once truly unlocked
   * and past onboarding: a shortcut firing over the lock screen or the name
   * prompt would act on a shell that is not there yet.
   *
   * It needs no input-focus guard, and that is a property of the binding rule
   * rather than an oversight: nothing that looks like typing can be bound (see
   * `isBindableChord`), so no chord here can ever collide with a user writing
   * into a field. Auto-repeat is skipped so holding a chord fires once, and
   * `preventDefault` is called only when something actually matched — the
   * reserved Ctrl+digit family included, since the app claims those keys even
   * when there is no Nth module for them to reach.
   */
  useEffect(() => {
    const ready =
      authStatus?.state === "unlocked" &&
      activeProfile !== undefined &&
      activeProfile.name.trim() !== "";
    if (!ready) return;
    function handleGlobalKeydown(event: KeyboardEvent): void {
      if (event.repeat) return;
      const position = moduleNavPosition(event);
      if (position !== null) {
        event.preventDefault();
        const moduleId = visibleModuleIds[position - 1];
        if (moduleId === undefined) return;
        closePalette();
        setShortcutsHelpOpen(false);
        setActiveId(moduleId);
        return;
      }
      for (const action of SHORTCUT_ACTIONS) {
        if (!matchesChord(shortcuts[action.id], event)) continue;
        event.preventDefault();
        runShortcutAction(action.id);
        return;
      }
    }
    window.addEventListener("keydown", handleGlobalKeydown);
    return () => window.removeEventListener("keydown", handleGlobalKeydown);
    // `runShortcutAction` and `createInModule` are re-created every render but
    // close over nothing that changes except `activeId` and `visibleModuleIds`,
    // both listed here — everything else they touch is a stable state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus?.state, activeProfile, shortcuts, visibleModuleIds, activeId, closePalette]);

  // Rebuilt whenever the enabled-module set can change (flags), the active
  // profile changes, or `theme` changes — the last one matters because
  // `toggleTheme` reads `theme` directly from its own render's closure
  // (`changePreference(theme === "noc" ? "dan" : "noc")`), so leaving it out
  // of this list would let the "Promeni temu" command run against a stale
  // theme once toggled from anywhere else (e.g. the topbar button) without
  // `flags`/`profiles` also changing. `resolveEnabled` itself is a cheap
  // array filter, so recomputing it here rather than threading the
  // render-time `enabledIds` set into a hook (which sits after several
  // conditional returns below) is the simpler option.
  const searchCommands = useMemo(
    () =>
      buildSearchCommands({
        profileId: activeProfile?.id ?? "",
        enabledModuleIds: resolveEnabled(registry, flags),
        moduleName,
        onNavigate: setActiveId,
        onCreate: createInModule,
        // ADR-049: the five TASK views ride the same intent mechanism as a
        // reveal — the page owns which view is selected, so the palette says
        // which one rather than reaching into it.
        onOpenSmartList: (listId) =>
          dispatchIntent({ module: "tasks", intent: { kind: "smart-list", listId } }),
        onToggleTheme: toggleTheme,
        onLock: () => void handleLock(),
        onOpenShortcuts: () => setShortcutsHelpOpen(true),
        onRebuildComplete: setSearchStatus,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flags, profiles, activeProfileId, theme],
  );

  const enabledIds = new Set(resolveEnabled(registry, flags));
  // `SEARCH_PAGE_ID` is a valid destination without being an enabled module:
  // the search page is a system surface like the palette (ADR-039 §1), so it
  // is deliberately NOT a `ModuleManifest` and never appears in the Settings
  // module gallery.
  const effectiveId =
    enabledIds.has(activeId) || activeId === SEARCH_PAGE_ID ? activeId : "dashboard";

  if (failed) {
    return (
      <div className="nx-app app app--center">
        <EmptyState
          title={strings.app.loadErrorTitle}
          description={strings.app.loadErrorDescription}
        />
      </div>
    );
  }

  if (!authStatus) {
    return (
      <div className="nx-app app app--center">
        <p className="app__muted">{strings.app.loading}</p>
      </div>
    );
  }

  if (authStatus.state !== "unlocked") {
    return (
      <div className="nx-app app">
        <AuthGate status={authStatus} onUnlocked={() => void handleUnlocked()} />
      </div>
    );
  }

  if (!profiles) {
    return (
      <div className="nx-app app app--center">
        <p className="app__muted">{strings.app.loading}</p>
      </div>
    );
  }

  // ONB lite gates the shell on the ACTIVE profile's empty name — the
  // deliberate "not yet named" sentinel (ADR-058): the seeded personal profile
  // on first run, and a fresh business profile on its FIRST ENTRY (created
  // empty from the switcher or the „Profili“ card, named here). The theme is
  // device-wide, so a business entry asks only for the name.
  if (activeProfile && activeProfile.name.trim() === "") {
    return (
      <div className="nx-app app">
        <Onboarding
          profileId={activeProfile.id}
          kind={activeProfile.kind}
          theme={theme}
          onThemeChange={changePreference}
          onComplete={(name) =>
            setProfiles(
              profiles.map((profile) =>
                profile.id === activeProfile.id ? { ...profile, name } : profile,
              ),
            )
          }
        />
      </div>
    );
  }

  /** Patches one field of the active profile in the shell's own state — what both Settings callbacks below reflect through. */
  function patchActiveProfile(changes: Partial<Profile>): void {
    if (!profiles || !activeProfile) return;
    setProfiles(
      profiles.map((profile) =>
        profile.id === activeProfile.id ? { ...profile, ...changes } : profile,
      ),
    );
  }

  /** Reflects a Settings-page rename in the shell's own profile state. */
  function renameActiveProfile(name: string): void {
    patchActiveProfile({ name });
  }

  /** Reflects a Settings-page picture change, so the sidebar's avatar updates without a reload (SET-001). */
  function setActiveProfilePicture(pictureHash: string | null): void {
    patchActiveProfile({ pictureHash });
  }

  return (
    <div className="nx-app app">
      <header className="app__topbar">
        <div className="app__brand">
          <span className="app__brand-mark" aria-hidden="true">✦</span>
          <span className="app__brand-name">{strings.app.brand}</span>
        </div>
        <Button size="sm" onClick={toggleTheme} aria-label={strings.app.themeToggle}>
          {theme === "noc" ? strings.app.themeDan : strings.app.themeNoc}
        </Button>
      </header>

      <div className="app__body">
        <nav className="app__sidebar" aria-label={strings.app.navLabel}>
          {[...registry.byCategory()].map(([category, members]) => {
            const visible = members.filter((manifest) => enabledIds.has(manifest.id));
            if (visible.length === 0) return null;
            return (
              <div key={category} className="app__nav-group">
                {visible.map((manifest) => (
                  <NavItem
                    key={manifest.id}
                    href="#"
                    active={manifest.id === effectiveId}
                    onClick={(event) => {
                      event.preventDefault();
                      setActiveId(manifest.id);
                    }}
                  >
                    {moduleName(manifest.id)}
                  </NavItem>
                ))}
              </div>
            );
          })}
          {activeProfile && (
            <>
              {/* SET-001: the one place in the shell that says WHOSE data this
                  is. It sits directly above the two actions that leave the
                  profile („Promeni nalog“, „Zaključaj“), which is where a reader
                  looks for it, and it is a statement rather than a control —
                  clicking a name that only names itself would be a promise of a
                  menu this app does not have. The name is `title`d because a
                  220px sidebar truncates a long one. */}
              <div className="app__profile-row" title={activeProfile.name}>
                <ProfileAvatar
                  name={activeProfile.name}
                  pictureHash={activeProfile.pictureHash}
                  size="sm"
                />
                <span className="app__profile-name">{activeProfile.name}</span>
              </div>
              {/* Navigates to the full page (ADR-039 §1); the badge stays as
                  the hint for Ctrl+K, which still opens the palette. */}
              <NavItem
                href="#"
                active={effectiveId === SEARCH_PAGE_ID}
                // The LIVE palette binding, never a printed "Ctrl+K": a remap
                // has to be visible everywhere at once (ADR-040).
                badge={formatChord(shortcuts.palette)}
                onClick={(event) => {
                  event.preventDefault();
                  setActiveId(SEARCH_PAGE_ID);
                }}
              >
                {strings.search.navLabel}
              </NavItem>
              <NotificationCenter profileId={activeProfile.id} onNavigate={setActiveId} />
              {/* ADR-058 §2: the PROFILE switcher — which of the account's
                  profiles the shell is standing in. A different axis from
                  „Promeni nalog“ below, which switches ACCOUNTS (lock +
                  picker); the copy keeps the words apart — this row says
                  „profil“, that one „nalog“. Every switch INTO another profile
                  passes the passcode gate (AUTH-024); there is deliberately no
                  row that switches without it. With a single profile the row
                  still names where you are, and its one extra offer is the
                  business profile v1 allows. */}
              <NotePopover
                label={strings.profiles.switcherLabel}
                triggerClassName="app__profile-switch"
                triggerContent={`${strings.profiles.rowPrefix} ${profileDisplayName(activeProfile)}`}
              >
                {(close) => (
                  <>
                    {profiles.map((profile) => {
                      const isActive = profile.id === activeProfile.id;
                      return (
                        <button
                          key={profile.id}
                          className={`note__menu-item note__menu-item--check${isActive ? " app__profile-item--active" : ""}`}
                          role="menuitemradio"
                          type="button"
                          aria-checked={isActive}
                          onClick={() => {
                            close();
                            if (!isActive) setSwitchTarget(profile);
                          }}
                        >
                          <span
                            className={`note__menu-check${isActive ? "" : " note__menu-check--hidden"}`}
                            aria-hidden="true"
                          >
                            ✓
                          </span>
                          {profileDisplayName(profile)}
                          {profile.kind === "business" && (
                            <span className="app__profile-kind">
                              {strings.profiles.businessLabel}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {/* ONE business profile per account (the ADR's v1 limit):
                        the offer exists exactly while none does. */}
                    {!profiles.some((profile) => profile.kind === "business") && (
                      <>
                        <div className="note__menu-sep" role="separator" />
                        <button
                          className="note__menu-item"
                          role="menuitem"
                          type="button"
                          onClick={() => {
                            close();
                            void createBusinessFromSwitcher();
                          }}
                        >
                          {strings.profiles.createBusiness}…
                        </button>
                      </>
                    )}
                  </>
                )}
              </NotePopover>
              {profileActionError != null && (
                <p className="app__profile-error" role="alert">
                  {profileActionError}
                </p>
              )}
              {/* Only with somewhere to switch TO (ADR-044). Locking is the
                  whole action: AuthGate opens on the picker by itself once
                  this device holds more than one account. */}
              {authStatus.accounts.length > 1 && (
                <NavItem
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    void handleLock();
                  }}
                >
                  {strings.auth.switchAction}
                </NavItem>
              )}
              <NavItem
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  void handleLock();
                }}
              >
                {strings.auth.lockAction}
              </NavItem>
            </>
          )}
        </nav>

        <main className="app__main">
          {restoreUndo != null && !restoreBannerHidden && (
            <div className="app__restore-banner" role="status">
              <span className="app__restore-banner-text">
                {RESTORE_UNDO_BANNERS[restoreUndo.kind]}{" "}
                <span className="app__restore-banner-when">
                  {formatArchiveInstant(restoreUndo.appliedAt)}
                </span>
              </span>
              {restoreUndoError != null && (
                <span className="app__restore-banner-error">{restoreUndoError}</span>
              )}
              <Button
                size="sm"
                variant="primary"
                disabled={undoingRestore}
                onClick={() => void undoRestore()}
              >
                {strings.settings.restore.undoButton}
              </Button>
              <Button
                size="sm"
                className="app__restore-banner-dismiss"
                aria-label={strings.settings.restore.undoDismiss}
                onClick={() => setRestoreBannerHidden(true)}
              >
                ×
              </Button>
            </div>
          )}
          {/* Every page is keyed by the active profile (ADR-058 §1): a switch
              remounts it, so page-local state — a selected task, an open note,
              a half-typed filter — never leaks across profiles. */}
          {effectiveId === "dashboard" && activeProfile ? (
            <DashboardPage
              key={activeProfile.id}
              profileId={activeProfile.id}
              profileName={activeProfile.name}
              registry={registry}
              enabledModules={enabledIds}
              onOpenModule={setActiveId}
              onOpenNote={openNote}
            />
          ) : effectiveId === "tasks" && activeProfile ? (
            <TasksPage
              key={activeProfile.id}
              profileId={activeProfile.id}
              intent={pending?.module === "tasks" ? pending.intent : null}
              onIntentHandled={clearIntent}
            />
          ) : effectiveId === "calendar" && activeProfile ? (
            <CalendarPage
              key={activeProfile.id}
              profileId={activeProfile.id}
              // CAL-005 / ADR-058 §5: the account's OTHER profile is the
              // overlay chip's origin — v1 keeps one personal anchor plus at
              // most one business profile, so "the other" is at most one row.
              // „Prebaci profil“ routes through the SAME passcode-gated
              // dialog every switch passes (setSwitchTarget → AUTH-024).
              overlayProfile={
                profiles.find((profile) => profile.id !== activeProfile.id) ?? null
              }
              onSwitchToProfile={setSwitchTarget}
              intent={pending?.module === "calendar" ? pending.intent : null}
              onIntentHandled={clearIntent}
            />
          ) : effectiveId === "notes" && activeProfile ? (
            <NotesPage
              key={activeProfile.id}
              profileId={activeProfile.id}
              intent={pending?.module === "notes" ? pending.intent : null}
              onIntentHandled={clearIntent}
            />
          ) : effectiveId === "priv" && activeProfile ? (
            <PrivPage key={activeProfile.id} profileId={activeProfile.id} />
          ) : effectiveId === "study" && activeProfile ? (
            <StudyPage
              key={activeProfile.id}
              profileId={activeProfile.id}
              onOpenNote={openNote}
              intent={pending?.module === "study" ? pending.intent : null}
              onIntentHandled={clearIntent}
            />
          ) : effectiveId === SEARCH_PAGE_ID && activeProfile ? (
            <SearchPage
              key={activeProfile.id}
              profileId={activeProfile.id}
              seed={searchSeed}
              onSeedConsumed={clearSearchSeed}
              onOpenResult={onSearchResult}
              paletteChordLabel={formatChord(shortcuts.palette)}
            />
          ) : effectiveId === "settings" && activeProfile ? (
            <SettingsPage
              key={activeProfile.id}
              profileId={activeProfile.id}
              profileName={activeProfile.name}
              profilePictureHash={activeProfile.pictureHash}
              profiles={profiles}
              info={info}
              flags={flags}
              onFlagsChanged={setFlags}
              onProfileRenamed={renameActiveProfile}
              onProfilePictureChanged={setActiveProfilePicture}
              onCreateBusinessProfile={createBusinessProfile}
              onRequestProfileSwitch={setSwitchTarget}
              onDeleteProfile={deleteProfileAnywhere}
              preference={preference}
              onPreferenceChange={changePreference}
              registry={registry}
              autoLockMinutes={autoLockMinutes}
              onAutoLockChange={changeAutoLock}
              shortcutOverrides={shortcutOverrides}
              onShortcutOverridesChange={changeShortcutOverrides}
              globalShortcutTaken={globalCaptureTaken}
              onShowShortcuts={() => setShortcutsHelpOpen(true)}
            />
          ) : (
            <ModulePage id={effectiveId} />
          )}
        </main>
      </div>

      {activeProfile && (
        <SearchPalette
          profileId={activeProfile.id}
          open={paletteOpen}
          onClose={closePalette}
          commands={searchCommands}
          onOpenResult={onSearchResult}
          onOpenPage={openSearchPage}
          statusMessage={searchStatus}
        />
      )}

      {appetiteAsk && activeProfile && (
        <NotificationAppetiteDialog profileId={activeProfile.id} onAnswered={closeAppetiteAsk} />
      )}

      {/* The passcode gate (AUTH-024) in front of the switch the popover or the
          „Profili“ card asked for. Rendered here so both surfaces share the one
          dialog — and the one verified landing. */}
      {switchTarget != null && (
        <ProfileSwitchDialog
          profile={switchTarget}
          onVerified={() => void completeSwitch(switchTarget)}
          onCancel={() => setSwitchTarget(null)}
        />
      )}

      {shortcutsHelpOpen && (
        <ShortcutsDialog
          bindings={shortcuts}
          moduleIds={visibleModuleIds}
          onClose={() => setShortcutsHelpOpen(false)}
        />
      )}
    </div>
  );
}

/** Placeholder page for a not-yet-built module (ONB-012 empty-state pattern). */
function ModulePage({ id }: { id: string }) {
  return (
    <EmptyState title={moduleName(id)} description={strings.modulePlaceholder.description} />
  );
}

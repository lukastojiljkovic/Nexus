import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveEnabled } from "@nexus/core";
import { Button, EmptyState, NavItem } from "@nexus/ui";
import type { ThemeName } from "@nexus/tokens";
import type {
  AppInfo,
  AuthStatus,
  FlagState,
  Profile,
  SearchKind,
  SearchResult,
} from "../../shared/ipc.js";
import { AuthGate } from "./AuthGate.js";
import { Onboarding } from "./Onboarding.js";
import { DashboardPage } from "./DashboardPage.js";
import { TasksPage } from "./TasksPage.js";
import { CalendarPage } from "./CalendarPage.js";
import { NotesPage } from "./NotesPage.js";
import { StudyPage } from "./StudyPage.js";
import { SettingsPage } from "./SettingsPage.js";
import { NotificationCenter } from "./NotificationCenter.js";
import { SearchPalette } from "./SearchPalette.js";
import { buildSearchCommands } from "./searchCommands.js";
import { createModuleRegistry } from "./modules.js";
import { persistAutoLock, readStoredAutoLock, type AutoLockMinutes } from "./autoLock.js";
import {
  persistThemePreference,
  readStoredThemePreference,
  resolveTheme,
  subscribeSystemTheme,
  type ThemePreference,
} from "./theme.js";
import { strings } from "./strings.js";

/** Idle events that count as activity for the auto-lock timer (AUTH-005). */
const IDLE_ACTIVITY_EVENTS = ["mousemove", "keydown", "mousedown", "wheel"] as const;
// A mousemove storm must not rebuild the lock timer on every pixel — activity
// resets it at most once per this window.
const IDLE_RESET_THROTTLE_MS = 1000;

// The registry is static, compiled-in data (ADR-008) — built once per renderer.
const registry = createModuleRegistry();

/** Sidebar/page display name for a module id; falls back to the id. Exported for `searchCommands.ts`'s "Idi na: <modul>" labels, so they are never re-spelled. */
export function moduleName(id: string): string {
  return strings.modules[id] ?? id;
}

/**
 * Maps a global-search result's kind to the module that owns it (021-d),
 * mirroring `NotificationCenter`'s own `SOURCE_MODULE` idiom. "note" and
 * "attachment" are handled separately in `onSearchResult` below since they
 * use the `openNote` cross-module deep link (ADR-017) instead of a plain
 * module switch — this map only covers the remaining seven kinds, and the
 * `Exclude` keeps it that way at the type level.
 */
const RESULT_MODULE: Record<Exclude<SearchKind, "note" | "attachment">, string> = {
  task: "tasks",
  event: "calendar",
  document: "calendar",
  subject: "study",
  exam: "study",
  deck: "study",
  card: "study",
};

export function App() {
  const [preference, setPreference] = useState<ThemePreference>(readStoredThemePreference);
  // The resolved theme lives in state (not derived inline) so an OS light/dark
  // switch while in system mode re-renders the topbar toggle's label.
  const [theme, setTheme] = useState<ThemeName>(() => resolveTheme(preference));
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  // Per-profile module overrides (SET-007). Empty until loaded — every v0
  // module defaults enabled, so the pre-load render matches the common case.
  const [flags, setFlags] = useState<FlagState>({});
  const [failed, setFailed] = useState(false);
  const [activeId, setActiveId] = useState("dashboard");
  // Pending cross-module deep-link target (STUDY -> a note, ADR-017 — the
  // app's first). NotesPage selects it on arrival and reports back via
  // onTargetOpened, which clears it here so a later return to Beleške never
  // re-selects the same note.
  const [noteTarget, setNoteTarget] = useState<string | null>(null);
  // The local account's lock state (ADR-018). `null` only until the very
  // first `getAuthStatus` round trip resolves.
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [autoLockMinutes, setAutoLockMinutes] = useState<AutoLockMinutes>(readStoredAutoLock);
  // Global search palette (021-d). `searchStatus` is the rebuild command's
  // Serbian confirmation/error text — owned here since this is where the
  // command's `run` closure is built (see `buildSearchCommands` below).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);

  /** Loads everything that requires an open database. Only ever called once `auth:status` (or an unlock/create/recover result) has confirmed `state === "unlocked"`. */
  async function loadUnlockedData(): Promise<void> {
    const [nextInfo, nextProfiles] = await Promise.all([
      window.nexus.appInfo(),
      window.nexus.listProfiles(),
    ]);
    const firstProfile = nextProfiles[0];
    const nextFlags = firstProfile ? await window.nexus.getFlags(firstProfile.id) : {};
    setInfo(nextInfo);
    setProfiles(nextProfiles);
    setFlags(nextFlags);
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
    setAuthStatus((previous) => ({
      state: "locked",
      lockedForMs: 0,
      keystoreAvailable: previous?.keystoreAvailable ?? true,
      requiresRecovery: false,
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
  useEffect(() => {
    if (!new Set(resolveEnabled(registry, flags)).has(activeId)) {
      setActiveId("dashboard");
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

  /**
   * The app's first cross-module deep link (STUDY -> the note a flashcard was
   * generated from, ADR-017): sets the pending target and switches the active
   * module, extending NotificationCenter's `onNavigate={setActiveId}`
   * precedent with a payload that NotesPage consumes on arrival.
   */
  function openNote(noteId: string): void {
    setNoteTarget(noteId);
    setActiveId("notes");
  }

  // Stable across renders: `SearchPalette`'s own auto-close effect (the
  // rebuild command's confirmation timer) depends on this callback, and a
  // fresh reference on every unrelated App re-render would restart that
  // timer's cleanup/reschedule each time, quietly extending how long the
  // confirmation stays up.
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    setSearchStatus(null);
  }, []);

  /**
   * Activates a global-search result (021-d). Only "note" gets a genuine
   * deep link today, via the same cross-module `openNote` ADR-017 already
   * uses from STUDY; every other kind lands on its owning module's page
   * without revealing the specific entity — scrolling to/opening the exact
   * task, event, card, etc. inside that page is the NEXT slice's job, not
   * this one's, so this function deliberately stops at "the right page is
   * now open" rather than stubbing a reveal that would only pretend to work.
   */
  function onSearchResult(result: SearchResult): void {
    if (result.kind === "note") {
      openNote(result.entityId);
      return;
    }
    if (result.kind === "attachment") {
      if (result.parentId) {
        openNote(result.parentId);
      } else {
        console.error("Nexus: attachment search result has no parent note id:", result.entityId);
      }
      return;
    }
    setActiveId(RESULT_MODULE[result.kind]);
  }

  // Ctrl+K / Cmd+K opens the palette (only once truly unlocked and past
  // onboarding — a shortcut firing over the lock screen or the name prompt
  // would open a surface with nothing behind it to search). `preventDefault`
  // stops Electron/Chromium's own default for the combo; a modifier-free "k"
  // typed anywhere never matches, since ctrlKey/metaKey are false for that.
  useEffect(() => {
    const firstProfile = profiles?.[0];
    const ready =
      authStatus?.state === "unlocked" && firstProfile !== undefined && firstProfile.name.trim() !== "";
    if (!ready) return;
    function handleGlobalKeydown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", handleGlobalKeydown);
    return () => window.removeEventListener("keydown", handleGlobalKeydown);
  }, [authStatus?.state, profiles]);

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
        profileId: profiles?.[0]?.id ?? "",
        enabledModuleIds: resolveEnabled(registry, flags),
        moduleName,
        onNavigate: setActiveId,
        onToggleTheme: toggleTheme,
        onLock: () => void handleLock(),
        onRebuildComplete: setSearchStatus,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flags, profiles, theme],
  );

  const enabledIds = new Set(resolveEnabled(registry, flags));
  const effectiveId = enabledIds.has(activeId) ? activeId : "dashboard";

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

  // v0 runs a single seeded personal profile; an empty name means onboarding
  // has not happened yet (ONB lite gates the shell, not the modules).
  const activeProfile = profiles[0];
  if (activeProfile && activeProfile.name.trim() === "") {
    return (
      <div className="nx-app app">
        <Onboarding
          profileId={activeProfile.id}
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

  /** Reflects a Settings-page rename in the shell's own profile state. */
  function renameActiveProfile(name: string): void {
    if (!profiles || !activeProfile) return;
    setProfiles(
      profiles.map((profile) =>
        profile.id === activeProfile.id ? { ...profile, name } : profile,
      ),
    );
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
              <NavItem
                href="#"
                badge={strings.search.shortcutHint}
                onClick={(event) => {
                  event.preventDefault();
                  setPaletteOpen(true);
                }}
              >
                {strings.search.navLabel}
              </NavItem>
              <NotificationCenter profileId={activeProfile.id} onNavigate={setActiveId} />
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
          {effectiveId === "dashboard" && activeProfile ? (
            <DashboardPage
              profileId={activeProfile.id}
              profileName={activeProfile.name}
              enabledModules={enabledIds}
              onOpenModule={setActiveId}
            />
          ) : effectiveId === "tasks" && activeProfile ? (
            <TasksPage profileId={activeProfile.id} />
          ) : effectiveId === "calendar" && activeProfile ? (
            <CalendarPage profileId={activeProfile.id} />
          ) : effectiveId === "notes" && activeProfile ? (
            <NotesPage
              profileId={activeProfile.id}
              targetNoteId={noteTarget}
              onTargetOpened={() => setNoteTarget(null)}
            />
          ) : effectiveId === "study" && activeProfile ? (
            <StudyPage profileId={activeProfile.id} onOpenNote={openNote} />
          ) : effectiveId === "settings" && activeProfile ? (
            <SettingsPage
              profileId={activeProfile.id}
              profileName={activeProfile.name}
              info={info}
              flags={flags}
              onFlagsChanged={setFlags}
              onProfileRenamed={renameActiveProfile}
              preference={preference}
              onPreferenceChange={changePreference}
              registry={registry}
              autoLockMinutes={autoLockMinutes}
              onAutoLockChange={changeAutoLock}
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
          statusMessage={searchStatus}
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

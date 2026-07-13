import { useEffect, useState } from "react";
import { resolveEnabled } from "@nexus/core";
import { Button, EmptyState, NavItem } from "@nexus/ui";
import type { ThemeName } from "@nexus/tokens";
import type { AppInfo, FlagState, Profile } from "../../shared/ipc.js";
import { Onboarding } from "./Onboarding.js";
import { DashboardPage } from "./DashboardPage.js";
import { TasksPage } from "./TasksPage.js";
import { CalendarPage } from "./CalendarPage.js";
import { NotesPage } from "./NotesPage.js";
import { StudyPage } from "./StudyPage.js";
import { SettingsPage } from "./SettingsPage.js";
import { NotificationCenter } from "./NotificationCenter.js";
import { createModuleRegistry } from "./modules.js";
import {
  persistThemePreference,
  readStoredThemePreference,
  resolveTheme,
  subscribeSystemTheme,
  type ThemePreference,
} from "./theme.js";
import { strings } from "./strings.js";

// The registry is static, compiled-in data (ADR-008) — built once per renderer.
const registry = createModuleRegistry();

/** Sidebar/page display name for a module id; falls back to the id. */
function moduleName(id: string): string {
  return strings.modules[id] ?? id;
}

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

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [nextInfo, nextProfiles] = await Promise.all([
          window.nexus.appInfo(),
          window.nexus.listProfiles(),
        ]);
        const firstProfile = nextProfiles[0];
        const nextFlags = firstProfile ? await window.nexus.getFlags(firstProfile.id) : {};
        if (!active) return;
        setInfo(nextInfo);
        setProfiles(nextProfiles);
        setFlags(nextFlags);
        // Signal the --smoke harness that the full renderer -> main -> DB path worked.
        window.__nexusReady = true;
        window.dispatchEvent(new Event("nexus-ready"));
      } catch (error) {
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
            <NotificationCenter profileId={activeProfile.id} onNavigate={setActiveId} />
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
            <NotesPage profileId={activeProfile.id} />
          ) : effectiveId === "study" && activeProfile ? (
            <StudyPage profileId={activeProfile.id} />
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
            />
          ) : (
            <ModulePage id={effectiveId} />
          )}
        </main>
      </div>
    </div>
  );
}

/** Placeholder page for a not-yet-built module (ONB-012 empty-state pattern). */
function ModulePage({ id }: { id: string }) {
  return (
    <EmptyState title={moduleName(id)} description={strings.modulePlaceholder.description} />
  );
}

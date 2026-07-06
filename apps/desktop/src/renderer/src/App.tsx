import { useEffect, useState } from "react";
import { Button, Card, EmptyState, NavItem } from "@nexus/ui";
import type { ThemeName } from "@nexus/tokens";
import type { AppInfo, Profile } from "../../shared/ipc.js";
import { Onboarding } from "./Onboarding.js";
import { TasksPage } from "./TasksPage.js";
import { createModuleRegistry } from "./modules.js";
import { persistTheme, readStoredTheme } from "./theme.js";
import { strings } from "./strings.js";

// The registry is static, compiled-in data (ADR-008) — built once per renderer.
const registry = createModuleRegistry();

/** Sidebar/page display name for a module id; falls back to the id. */
function moduleName(id: string): string {
  return strings.modules[id] ?? id;
}

export function App() {
  const [theme, setTheme] = useState<ThemeName>(readStoredTheme);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
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
        if (!active) return;
        setInfo(nextInfo);
        setProfiles(nextProfiles);
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

  function toggleTheme(): void {
    const next: ThemeName = theme === "noc" ? "dan" : "noc";
    setTheme(next);
    persistTheme(next);
  }

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
          onThemeChange={setTheme}
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
          {[...registry.byCategory()].map(([category, members]) => (
            <div key={category} className="app__nav-group">
              {members.map((manifest) => (
                <NavItem
                  key={manifest.id}
                  href="#"
                  active={manifest.id === activeId}
                  onClick={(event) => {
                    event.preventDefault();
                    setActiveId(manifest.id);
                  }}
                >
                  {moduleName(manifest.id)}
                </NavItem>
              ))}
            </div>
          ))}
        </nav>

        <main className="app__main">
          {activeId === "dashboard" ? (
            <DashboardPage info={info} />
          ) : activeId === "tasks" && activeProfile ? (
            <TasksPage profileId={activeProfile.id} />
          ) : (
            <ModulePage id={activeId} />
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * Dashboard placeholder: the widget grid (DASH-001) lands with the first
 * modules; until then an honest empty state plus the system diagnostics card
 * (the visible proof of the renderer -> main -> DB path).
 */
function DashboardPage({ info }: { info: AppInfo | null }) {
  return (
    <>
      <EmptyState
        title={strings.dashboard.emptyTitle}
        description={strings.dashboard.emptyDescription}
      />

      <Card title={strings.diagnostics.title} className="app__diagnostics">
        {info ? (
          <dl className="app__facts">
            <div>
              <dt>{strings.diagnostics.version}</dt>
              <dd>
                {info.name} {info.version}
              </dd>
            </div>
            <div>
              <dt>{strings.diagnostics.electron}</dt>
              <dd>{info.versions.electron}</dd>
            </div>
            <div>
              <dt>{strings.diagnostics.chromium}</dt>
              <dd>{info.versions.chrome}</dd>
            </div>
            <div>
              <dt>{strings.diagnostics.node}</dt>
              <dd>{info.versions.node}</dd>
            </div>
            <div>
              <dt>{strings.diagnostics.database}</dt>
              <dd className="app__path">{info.databasePath}</dd>
            </div>
          </dl>
        ) : (
          <p className="app__muted">{strings.app.loading}</p>
        )}
      </Card>
    </>
  );
}

/** Placeholder page for a not-yet-built module (ONB-012 empty-state pattern). */
function ModulePage({ id }: { id: string }) {
  return (
    <EmptyState title={moduleName(id)} description={strings.modulePlaceholder.description} />
  );
}

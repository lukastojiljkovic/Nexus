import { useEffect, useState } from "react";
import { Button, Card, EmptyState, NavItem } from "@nexus/ui";
import type { ThemeName } from "@nexus/tokens";
import type { AppInfo, Profile } from "../../shared/ipc.js";
import { persistTheme, readStoredTheme } from "./theme.js";

export function App() {
  const [theme, setTheme] = useState<ThemeName>(readStoredTheme);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);

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
        console.error("Nexus IPC bridge failed:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function toggleTheme() {
    const next: ThemeName = theme === "noc" ? "dan" : "noc";
    setTheme(next);
    persistTheme(next);
  }

  return (
    <div className="nx-app app">
      <header className="app__topbar">
        <div className="app__brand">
          <span className="app__brand-mark" aria-hidden="true">✦</span>
          <span className="app__brand-name">Nexus</span>
        </div>
        <Button size="sm" onClick={toggleTheme} aria-label="Promeni temu">
          {theme === "noc" ? "Dan" : "Noć"}
        </Button>
      </header>

      <div className="app__body">
        <nav className="app__sidebar" aria-label="Glavna navigacija">
          <NavItem href="#" active>Kontrolna tabla</NavItem>
        </nav>

        <main className="app__main">
          <EmptyState
            title="Radni prostor je spreman"
            description="Moduli — zadaci, beleške, kalendar, finansije — stižu u verziji v0. Ova ljuska već koristi pravu bazu podataka na tvom uređaju; ništa ne napušta mašinu."
            action={
              <Button variant="primary" disabled>
                Uskoro
              </Button>
            }
          />

          <Card title="Stanje sistema" className="app__diagnostics">
            {info ? (
              <dl className="app__facts">
                <div>
                  <dt>Verzija</dt>
                  <dd>
                    {info.name} {info.version}
                  </dd>
                </div>
                <div>
                  <dt>Electron</dt>
                  <dd>{info.versions.electron}</dd>
                </div>
                <div>
                  <dt>Chromium</dt>
                  <dd>{info.versions.chrome}</dd>
                </div>
                <div>
                  <dt>Node</dt>
                  <dd>{info.versions.node}</dd>
                </div>
                <div>
                  <dt>Baza podataka</dt>
                  <dd className="app__path">{info.databasePath}</dd>
                </div>
              </dl>
            ) : (
              <p className="app__muted">Učitavanje…</p>
            )}
          </Card>

          <Card title="Profili">
            {profiles.length > 0 ? (
              <ul className="app__profiles">
                {profiles.map((profile) => (
                  <li key={profile.id} className="app__profile">
                    <span className="app__profile-name">
                      {profile.name.trim() === "" ? "Bez naziva" : profile.name}
                    </span>
                    <span className="app__profile-kind">
                      {profile.kind === "personal" ? "lični" : "poslovni"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="app__muted">Nema profila.</p>
            )}
          </Card>
        </main>
      </div>
    </div>
  );
}

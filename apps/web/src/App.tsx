import { useCallback, useEffect, useState } from "react";
import { Button, Card, Chip, EmptyState, Icon, NavItem, PageHeader, Select } from "@nexus/ui";
import type { IconName } from "@nexus/ui";
import { NexusApiNotConnectedError, nexus } from "./api.js";
import { strings } from "./strings.js";
import {
  persistThemePreference,
  readStoredThemePreference,
  subscribeSystemTheme,
  type ThemePreference,
} from "./theme.js";

/**
 * The rail's contents: the fourteen modules, in the desktop's own order, each
 * with the mark it already has. Nothing is drawn for the web — the sigils come
 * from `@nexus/ui`'s icon set, which is the point of listing them at all: this
 * rail is the desktop's rail, rendered by the same components, on a different
 * runtime.
 *
 * The id is the key rather than the label, exactly as the desktop keys its own
 * rail: the label is Serbian today, and a key that changes with the language is
 * not a key.
 */
const MODULES: readonly { id: keyof typeof strings.modules; icon: IconName }[] = [
  { id: "dashboard", icon: "dashboard" },
  { id: "tasks", icon: "tasks" },
  { id: "calendar", icon: "calendar" },
  { id: "notes", icon: "notes" },
  { id: "study", icon: "study" },
  { id: "focus", icon: "focus" },
  { id: "files", icon: "files" },
  { id: "finance", icon: "finance" },
  { id: "habits", icon: "habits" },
  { id: "fitness", icon: "fitness" },
  { id: "canvas", icon: "canvas" },
  { id: "tools", icon: "tools" },
  { id: "priv", icon: "priv" },
  { id: "settings", icon: "settings" },
];

const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "dan", "noc"];

/**
 * The web shell.
 *
 * What it is for: to prove that the design system, the theming and the data
 * contract all cross to the browser unchanged, before a single page is ported.
 * So it renders real `@nexus/ui` components against real `@nexus/tokens`
 * variables, drives both themes through the desktop's own theme module, and
 * calls the real `NexusApi` — which refuses, out loud, because nothing is
 * connected to it yet.
 *
 * What it is NOT: a page. There is no routing, no data and no module content
 * here, and the empty state says so in as many words rather than filling the
 * space with something invented.
 */
export function App() {
  const [activeModule, setActiveModule] = useState<keyof typeof strings.modules>("dashboard");
  const [themePreference, setThemePreference] = useState<ThemePreference>(readStoredThemePreference);
  const [seamAnswer, setSeamAnswer] = useState<string | null>(null);

  useEffect(() => {
    persistThemePreference(themePreference);
    // Only „system" has anything to listen to. Subscribing unconditionally would
    // keep a live media-query listener that re-applies a preference the user has
    // since overridden — the OS going dark would drag a deliberate „Dan" back to
    // „Noć".
    if (themePreference !== "system") return;
    return subscribeSystemTheme(() => {
      persistThemePreference("system");
    });
  }, [themePreference]);

  /**
   * Calls the contract for real and shows what came back.
   *
   * `await` inside `try` rather than `.catch(…)`, because that is the shape
   * that survives BOTH refusals this stub can give — a rejected promise from a
   * request method and a synchronous throw from a subscription — and it is the
   * shape a page will keep once a real implementation replaces the stub.
   */
  const probeSeam = useCallback(async () => {
    try {
      await nexus.listProfiles();
      // Reached only if something answered — which today means the stub was
      // replaced and this card is out of date, not that the call succeeded.
      setSeamAnswer(strings.seam.unexpected);
    } catch (error) {
      // The class is checked rather than the message: „the sync engine is not
      // wired yet" and „the request failed" are different sentences to show a
      // user, and they stay different once sync exists.
      setSeamAnswer(
        error instanceof NexusApiNotConnectedError
          ? error.message
          : `${strings.seam.unexpected} ${String(error)}`,
      );
    }
  }, []);

  // One lookup for both the header watermark and the empty state, because they
  // are the same module's mark at two scales and must never disagree. The
  // fallback is unreachable — `activeModule` is only ever set from this very
  // list — and exists because `find` cannot know that; „dashboard" is the mark
  // the shell opens on, so an impossible state would still show something true.
  const activeSigil: IconName =
    MODULES.find((module) => module.id === activeModule)?.icon ?? "dashboard";

  return (
    // `nx-app` is @nexus/ui's typographic base — family, size, leading and the
    // size-dependent tracking. It is a class rather than a `:root` rule in that
    // package precisely so a host app opts in on one element, and this is that
    // element. Without it the shell would render in the browser's default face
    // at the browser's default leading, and look like a different product.
    <div className="nx-app web">
      <header className="web__bar">
        <span className="web__brand">
          <span aria-hidden="true">{strings.app.glyph}</span>
          {strings.app.name}
        </span>
        <Select
          label={strings.shell.themeLabel}
          layout="inline"
          value={themePreference}
          onChange={(event) => {
            // The `<select>`'s value is one of the three options this component
            // rendered, so the cast restates what the DOM already guarantees
            // rather than trusting arbitrary input.
            setThemePreference(event.currentTarget.value as ThemePreference);
          }}
        >
          {THEME_PREFERENCES.map((preference) => (
            <option key={preference} value={preference}>
              {strings.shell.themeOptions[preference]}
            </option>
          ))}
        </Select>
      </header>

      <div className="web__body">
        <nav className="web__rail" aria-label={strings.shell.navLabel}>
          {MODULES.map((module) => (
            <NavItem
              key={module.id}
              href="#"
              active={module.id === activeModule}
              onClick={(event) => {
                event.preventDefault();
                setActiveModule(module.id);
              }}
            >
              <Icon name={module.icon} size={16} />
              {strings.modules[module.id]}
            </NavItem>
          ))}
        </nav>

        <main className="web__main">
          <PageHeader
            title={strings.shell.title}
            subtitle={strings.shell.subtitle}
            sigil={activeSigil}
            actions={<Chip variant="accent">{strings.modules[activeModule]}</Chip>}
          />

          <Card title={strings.seam.title}>
            <p className="web__prose">{strings.seam.description}</p>
            <div className="web__actions">
              <Button
                variant="primary"
                onClick={() => {
                  void probeSeam();
                }}
              >
                {strings.seam.action}
              </Button>
            </div>
            {seamAnswer !== null && (
              <p className="web__answer">
                <Chip variant="danger">{strings.seam.resultLabel}</Chip>
                <span>{seamAnswer}</span>
              </p>
            )}
          </Card>

          <EmptyState
            title={strings.page.emptyTitle}
            description={strings.page.emptyDescription}
            sigil={activeSigil}
          />
        </main>
      </div>
    </div>
  );
}

import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Card, TextField } from "@nexus/ui";
import type { ThemeName } from "@nexus/tokens";
import type { ProfileKind } from "../../shared/ipc.js";
import { strings } from "./strings.js";

/** Mirrors the main-process rule: 1–80 chars after trimming (UX-side only). */
const NAME_MAX = 80;

export interface OnboardingProps {
  profileId: string;
  /**
   * Which profile is being named. A BUSINESS first entry (ADR-058 §5) skips
   * the theme group entirely — the theme is device-wide and was chosen long
   * before a second profile existed, so re-asking would offer to change
   * something this screen is not about — and words its own intro.
   */
  kind: ProfileKind;
  theme: ThemeName;
  /** Persistence lives in the caller now (SET owns theme.ts's write path); this just reports the pick. */
  onThemeChange: (theme: ThemeName) => void;
  /** Called with the stored (trimmed) name once the rename lands in the DB. */
  onComplete: (name: string) => void;
}

/**
 * ONB lite (v0): one welcome screen — name the profile and (first run only)
 * pick the Dan/Noć theme. No questionnaire, no cloud path, no module gating;
 * the full four-screen ONB flow replaces this later (PRD 01, roadmap).
 *
 * Triggered by the EMPTY-NAME sentinel (ADR-058): a profile created with
 * `name: ""` — the seeded personal profile on first run, a fresh business
 * profile on its first entry — is "not yet named", and App holds the shell
 * behind this screen until the name lands. The business profile's reserved
 * bordo accent is already applied by the time this renders (App re-applies the
 * active profile's accent before the gate, §3), so the screen opens under it.
 */
export function Onboarding({ profileId, kind, theme, onThemeChange, onComplete }: OnboardingProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const business = kind === "business";
  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= NAME_MAX;

  function pickTheme(next: ThemeName): void {
    onThemeChange(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await window.nexus.renameProfile(profileId, trimmed);
      onComplete(trimmed);
    } catch {
      setError(strings.onboarding.saveError);
      setSaving(false);
    }
  }

  return (
    <div className="onb">
      <Card className="onb__card">
        <form className="onb__form" onSubmit={submit}>
          <span className="onb__brand" aria-hidden="true">✦</span>
          <h1 className="onb__title">
            {business ? strings.onboarding.titleBusiness : strings.onboarding.title}
          </h1>
          <p className="onb__desc">
            {business ? strings.onboarding.descriptionBusiness : strings.onboarding.description}
          </p>

          <TextField
            label={strings.onboarding.nameLabel}
            placeholder={strings.onboarding.namePlaceholder}
            value={name}
            maxLength={NAME_MAX}
            autoFocus
            required
            onChange={(event) => setName(event.target.value)}
          />

          {!business && (
            <div className="onb__theme" role="group" aria-label={strings.onboarding.themeLabel}>
              <span className="onb__theme-label">{strings.onboarding.themeLabel}</span>
              <div className="onb__theme-options">
                {(["dan", "noc"] as const).map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={theme === option ? "primary" : "ghost"}
                    aria-pressed={theme === option}
                    onClick={() => pickTheme(option)}
                  >
                    {option === "dan" ? strings.app.themeDan : strings.app.themeNoc}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {error != null && (
            <p className="onb__error" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" disabled={!valid || saving}>
            {strings.onboarding.cta}
          </Button>
        </form>
      </Card>
    </div>
  );
}

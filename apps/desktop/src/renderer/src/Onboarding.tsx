import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Card, TextField } from "@nexus/ui";
import type { ThemeName } from "@nexus/tokens";
import { strings } from "./strings.js";

/** Mirrors the main-process rule: 1–80 chars after trimming (UX-side only). */
const NAME_MAX = 80;

export interface OnboardingProps {
  profileId: string;
  theme: ThemeName;
  /** Persistence lives in the caller now (SET owns theme.ts's write path); this just reports the pick. */
  onThemeChange: (theme: ThemeName) => void;
  /** Called with the stored (trimmed) name once the rename lands in the DB. */
  onComplete: (name: string) => void;
}

/**
 * ONB lite (v0): one welcome screen — name the seeded personal profile and pick
 * the Dan/Noć theme. No questionnaire, no cloud path, no module gating; the
 * full four-screen ONB flow replaces this later (PRD 01, roadmap).
 */
export function Onboarding({ profileId, theme, onThemeChange, onComplete }: OnboardingProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <h1 className="onb__title">{strings.onboarding.title}</h1>
          <p className="onb__desc">{strings.onboarding.description}</p>

          <TextField
            label={strings.onboarding.nameLabel}
            placeholder={strings.onboarding.namePlaceholder}
            value={name}
            maxLength={NAME_MAX}
            autoFocus
            required
            onChange={(event) => setName(event.target.value)}
          />

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

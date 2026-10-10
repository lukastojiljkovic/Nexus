import { useState } from "react";
import { Button, PageHeader } from "@nexus/ui";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import { AsciiTab } from "./AsciiTab.js";
import { copy } from "./copy.js";
import { MeterTab } from "./MeterTab.js";
import { MorseTab } from "./MorseTab.js";
import { persistSignalsPrefs, readSignalsPrefs, type SignalsPrefs } from "./prefs.js";
import { TunerTab } from "./TunerTab.js";
import "./signals.css";

/**
 * SIGNALI (ADR-090) — four instruments on one page, each behind its own tab.
 *
 * **Why tabs rather than four pages.** They are one subject reached for with one
 * hand (see `shared/manifest.ts`), and they share the two things a page would
 * have to duplicate: the copied text somebody is decoding, and the three
 * preferences that decide how a tone sounds and a string is read. A tab set is
 * one heading, one header and one chunk of copy for all four.
 *
 * **Why the page owns the preferences and the tabs do not.** Every control that
 * writes one is a child, and a child that both read and wrote `localStorage`
 * would be a second reader of the key `prefs.ts` defines. The page reads once on
 * mount, hands the value down, and is the only caller of `persistSignalsPrefs`,
 * so a stored value and a drawn value cannot disagree.
 *
 * **Why a tab that is switched away from releases the microphone.** Each tab
 * owns its own session and its own cleanup, so unmounting one is what stops its
 * capture — which is the promise in as many words: the microphone is opened when
 * a tab is started and closed when it is stopped, and switching tabs counts as
 * stopping it.
 *
 * Nothing here is loaded, so there is no loading state and no read to fail: the
 * engines come with the page's chunk, and the only asynchronous thing on it is a
 * microphone the user asks for.
 */

const TABS = ["morse", "ascii", "tuner", "meter"] as const;

type TabId = (typeof TABS)[number];

export default function SignalsPage({ profileId }: ModulePageProps) {
  const [tab, setTab] = useState<TabId>("morse");
  const [prefs, setPrefs] = useState<SignalsPrefs>(() => readSignalsPrefs(profileId));

  /** The one write path: the page's state moves first, then the four keys follow it. */
  function changePrefs(patch: Partial<SignalsPrefs>): void {
    const next: SignalsPrefs = { ...prefs, ...patch };
    setPrefs(next);
    persistSignalsPrefs(profileId, next);
  }

  return (
    <div className="signals">
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="signal"
      />
      {/* The app's own segmented recipe: a group of buttons whose state is
          `aria-pressed`, so what is announced and what is painted cannot drift.
          The group's name is the module's declared name, which is already on
          screen in the header — a second copy of it would be the drift. */}
      <div
        className="signals__tabs"
        role="group"
        aria-label={declaredText(manifest.copy?.name)}
      >
        {TABS.map((id) => (
          <Button
            key={id}
            size="sm"
            variant={tab === id ? "primary" : "ghost"}
            aria-pressed={tab === id}
            onClick={() => {
              setTab(id);
            }}
          >
            {copy.tabs[id]}
          </Button>
        ))}
      </div>
      {tab === "morse" && <MorseTab prefs={prefs} onChange={changePrefs} />}
      {tab === "ascii" && <AsciiTab />}
      {tab === "tuner" && <TunerTab prefs={prefs} onChange={changePrefs} />}
      {tab === "meter" && <MeterTab />}
    </div>
  );
}

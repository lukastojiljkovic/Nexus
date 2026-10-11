import { useCallback, useEffect, useState } from "react";
import { LoadingState, PageHeader } from "@nexus/ui";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { manifest } from "../shared/manifest.js";
import type { LabView } from "../shared/ipc.js";
import { BatteryCard } from "./BatteryCard.js";
import { copy } from "./copy.js";
import { LightCard } from "./LightCard.js";
import { SerialCard } from "./SerialCard.js";
import { ToneCard } from "./ToneCard.js";
import "./lab.css";

/**
 * LABORATORIJA (ADR-090) — the hardware drawer: what this laptop can do beyond
 * its job, in four instruments behind one page.
 *
 * **Why four subjects are one module.** They share nothing except the question
 * they answer — a serial terminal, the battery and a power budget, a tone
 * generator with a scope, and a lamp — and four rail rows for four surfaces
 * nobody opens daily would be four rows of noise. The split is by INSTRUMENT
 * inside one page, which is why each card is its own file: this one owns the
 * header and the one read, and the four cards own their own state.
 *
 * **What runs where.** The terminal, the parsers, the chart, the generator, the
 * scope and the lamp are all renderer work: Web Serial, Web Audio and plain
 * rendering, none of which needs a second process. Main owns the three things a
 * page cannot do — the choice of a serial port (a dialog, because a device on
 * somebody's desk must never be opened without a click), the battery report
 * Windows writes (`powercfg`), and the database. `shared/ipc.ts` is that list and
 * nothing more.
 *
 * **Why nothing here is in a Web Worker.** The two things a worker is for are
 * absent: parsing is O(line) per line at the device's own rate (a 115 200-baud
 * stream is about eleven kilobytes a second), and the one heavy computation —
 * the spectrum — is a `getFloatFrequencyData` call Chromium performs on its own
 * audio thread. A worker would add a message hop to every reading and move the
 * FFT off the thread that already does it well.
 *
 * **Everything the page does not do.** No sound on open (the generator is off
 * until a click, and its level starts at the bottom of the slider), no flashing
 * before an explicit acknowledgement (and none at all when the system asks for
 * reduced motion), no microphone before a click, and no port chosen for the
 * user. The lamp is the one surface that covers the window, and Escape closes it.
 */
export default function LabPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<LabView | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * One read, into state. Every mutation answers with the same shape, so there is
   * exactly one way this page learns anything: what main just said.
   */
  const run = useCallback(
    async (action: (lab: typeof window.nexus.modules.lab) => Promise<LabView>) => {
      try {
        setView(await action(window.nexus.modules.lab));
        setError(null);
      } catch (failure) {
        setError(copy.errors.mutate);
        console.error("Nexus: a lab change failed:", failure);
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const read = await window.nexus.modules.lab.list({ profileId });
        if (active) setView(read);
      } catch (failure) {
        if (active) setError(copy.errors.load);
        console.error("Nexus: the lab could not be loaded:", failure);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  return (
    <div className="lab">
      {/* The page's own name is the word the module DECLARED, read in the
          language being spoken, rather than a second copy of it (ADR-090's copy
          split). */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="lab"
      />
      {error !== null && (
        <p className="lab__error" role="alert">
          {error}
        </p>
      )}
      {view === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={4} />
      ) : (
        <>
          <SerialCard profileId={profileId} view={view} run={run} />
          <BatteryCard profileId={profileId} view={view} run={run} />
          <ToneCard />
          <LightCard />
        </>
      )}
    </div>
  );
}

/** The ops the cards share, in one place so no card has to restate it. */
export type LabApi = typeof window.nexus.modules.lab;
export type LabRun = (action: (lab: LabApi) => Promise<LabView>) => Promise<void>;

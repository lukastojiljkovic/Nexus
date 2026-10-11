import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Chip, SeriesPlot, StatBand } from "@nexus/ui";
import { LeqWindow, amplitudeFromDbfs } from "@nexus/core";
import { numberFormat } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { type MeterReading } from "./analysis.js";
import { createAnalyzer, type Analyzer } from "./analyzer.js";
import { copy } from "./copy.js";
import { microphoneFailure, startMicrophone, type MicrophoneSession } from "./microphone.js";

/**
 * The sound meter: the level in dBFS, a held peak, and a second-by-second history.
 *
 * **It is not a sound pressure level and it says so before it shows a figure.**
 * A computer microphone has no calibration: its sensitivity is a different number
 * per laptop, per driver and per gain setting, and nothing in the software can
 * read it. So every figure here is in dBFS — decibels relative to digital full
 * scale — and the disclaimer is the first paragraph of the card rather than a
 * footnote, because a number that looks like a measurement is read as one.
 *
 * **What the history plots, and what the rule line is.** One point per second,
 * each the equivalent level of the frames inside that second (`LeqWindow`, kept
 * here because the worker's own window is the whole measurement). The rule line
 * is the HELD PEAK — the largest sample peak since the measurement began — which
 * is the one thing a level history cannot show by itself: a clamp that lasted a
 * millisecond is invisible in a per-second average and obvious as a ceiling.
 *
 * **Peak hold is of the PEAK, and the level figures are of the RMS.** They answer
 * different questions, which is why the readout names both and the caption of the
 * chart repeats the distinction.
 */

/** How often a frame is read. Ten a second: fast enough to see a level move, slow enough to read. */
const READ_INTERVAL_MS = 100;
/** How many seconds of history the chart keeps. Sixty — a minute of a room, which is what a sweep of the room is for. */
const HISTORY_SECONDS = 60;

interface HistoryPoint {
  /** Seconds since the measurement began. */
  readonly second: number;
  /** That second's equivalent level, in dBFS. */
  readonly db: number;
}

/** A level with its unit, in the active locale: „−34,2 dBFS". */
function dbfs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${numberFormat({ maximumFractionDigits: 1 }).format(value)} ${copy.meter.dbfs}`;
}

export function MeterTab() {
  const [listening, setListening] = useState(false);
  const [reading, setReading] = useState<MeterReading | null>(null);
  const [heldPeakDb, setHeldPeakDb] = useState<number | null>(null);
  const [history, setHistory] = useState<readonly HistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mainThread, setMainThread] = useState(false);
  const sessionRef = useRef<MicrophoneSession | null>(null);
  const analyzerRef = useRef<Analyzer | null>(null);
  const timerRef = useRef(0);
  const busyRef = useRef(false);
  /** The second being accumulated, and how many seconds are behind it. */
  const secondWindowRef = useRef<LeqWindow | null>(null);
  const secondRef = useRef(0);
  const secondStartedAtRef = useRef(0);

  const stop = useCallback((): void => {
    window.clearInterval(timerRef.current);
    timerRef.current = 0;
    sessionRef.current?.stop();
    sessionRef.current = null;
    analyzerRef.current?.dispose();
    analyzerRef.current = null;
    busyRef.current = false;
    setListening(false);
  }, []);

  // A session that outlived its card would keep the microphone open.
  useEffect(
    () => () => {
      stop();
    },
    [stop],
  );

  async function start(): Promise<void> {
    try {
      const session = await startMicrophone();
      const analyzer = createAnalyzer();
      sessionRef.current = session;
      analyzerRef.current = analyzer;
      secondWindowRef.current = new LeqWindow();
      secondRef.current = 0;
      secondStartedAtRef.current = performance.now();
      setError(null);
      setReading(null);
      setHeldPeakDb(null);
      setHistory([]);
      setMainThread(analyzer.onMainThread);
      setListening(true);
      let fresh = true;
      timerRef.current = window.setInterval(() => {
        const first = fresh;
        fresh = false;
        void tick(session, analyzer, first);
      }, READ_INTERVAL_MS);
    } catch (failure) {
      console.error("Nexus: the sound meter could not open the microphone:", failure);
      setError(
        microphoneFailure(failure) === "denied" ? copy.common.micDenied : copy.common.micFailed,
      );
      stop();
    }
  }

  /** One frame in, one reading out, plus the held peak and the second's window. */
  async function tick(session: MicrophoneSession, analyzer: Analyzer, fresh: boolean): Promise<void> {
    if (busyRef.current || sessionRef.current !== session) return;
    busyRef.current = true;
    try {
      const reply = await analyzer.analyse({
        kind: "meter",
        samples: session.readFrame(),
        fresh,
      });
      if (reply.kind !== "meter" || sessionRef.current !== session) return;
      const next = reply.reading;
      setReading(next);
      setHeldPeakDb((current) => (current === null ? next.peakDb : Math.max(current, next.peakDb)));
      const window = secondWindowRef.current;
      if (window === null) return;
      // The window takes RMS in LINEAR amplitude (the engine's own contract);
      // the reading crossed the wire in dBFS, and `amplitudeFromDbfs` is the
      // engine's exact inverse above its floor.
      window.addFrameRms(amplitudeFromDbfs(next.rmsDb));
      const now = performance.now();
      if (now - secondStartedAtRef.current < 1000) return;
      const point: HistoryPoint = {
        second: secondRef.current,
        db: window.leqDb,
      };
      secondRef.current += 1;
      secondStartedAtRef.current = now;
      window.reset();
      setHistory((current) => [...current, point].slice(-HISTORY_SECONDS));
    } catch (failure) {
      console.error("Nexus: a meter frame could not be read:", failure);
    } finally {
      busyRef.current = false;
    }
  }

  const first = history[0]?.second ?? 0;
  const last = history[history.length - 1]?.second ?? 0;
  const points = history.map((point) => ({ x: point.second, y: point.db }));

  return (
    <Card className="signals__card" title={copy.meter.title}>
      <p className="nx-hint">{copy.meter.notCalibrated}</p>
      <div className="signals__actions">
        <Button
          size="sm"
          variant={listening ? "ghost" : "primary"}
          onClick={() => {
            if (listening) stop();
            else void start();
          }}
        >
          {listening ? copy.meter.stop : copy.meter.start}
        </Button>
        {listening && <Chip variant="data">{copy.common.listening}</Chip>}
        <Button
          size="sm"
          variant="quiet"
          disabled={heldPeakDb === null}
          onClick={() => {
            setHeldPeakDb(reading?.peakDb ?? null);
          }}
        >
          {copy.meter.resetPeak}
        </Button>
      </div>
      {error !== null && <p className="signals__error">{error}</p>}
      <p className="signals__level">{dbfs(reading?.rmsDb ?? null)}</p>
      <StatBand
        caption={copy.meter.crestHint}
        stats={[
          {
            label: copy.meter.rmsLabel,
            value: dbfs(reading?.rmsDb ?? null),
          },
          {
            label: copy.meter.peakLabel,
            value: dbfs(heldPeakDb),
          },
          {
            label: copy.meter.crestLabel,
            value:
              reading === null
                ? "—"
                : `${numberFormat({ maximumFractionDigits: 1 }).format(reading.crestDb)} ${copy.meter.db}`,
          },
          {
            label: copy.meter.leqLabel,
            value: dbfs(reading?.leqDb ?? null),
          },
        ]}
      />
      <SeriesPlot
        title={copy.meter.historyTitle}
        description={copy.meter.historyDescription.replace(
          "{count}",
          numberFormat({ maximumFractionDigits: 0 }).format(HISTORY_SECONDS),
        )}
        caption={copy.meter.historyCaption.replace(
          "{count}",
          numberFormat({ maximumFractionDigits: 0 }).format(HISTORY_SECONDS),
        )}
        empty={history.length === 0 ? { reason: copy.meter.historyEmpty } : null}
        series={
          points.length === 0
            ? []
            : [{ key: "rms", tone: "data", shape: "step", points }]
        }
        x={{ domain: [first, Math.max(first + 1, last)] }}
        y={{ domain: [-120, 0], ticks: 4, format: (value) => `${String(value)} ${copy.meter.dbfs}` }}
        {...(heldPeakDb === null
          ? {}
          : { rule: { value: heldPeakDb, label: copy.meter.peakRule, tone: "accent" as const } })}
        width={720}
      />
      <p className="nx-hint">{copy.common.deviceNote}</p>
      {mainThread && <p className="nx-hint">{copy.common.mainThreadNote}</p>}
    </Card>
  );
}

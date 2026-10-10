import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { formatRecordingDuration, isRecordingMime, type RecordingKind } from "@nexus/core";
import { Button, Card, Select } from "@nexus/ui";
import type { RecorderView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import {
  bytesPerMs,
  captureElapsedMs,
  levelFromWaveform,
  measuredBytesPerMs,
  pickMime,
  remainingMs,
} from "./capture.js";

/**
 * The RECORDER's live capture: which kind, which device, and the three controls
 * a running one has.
 *
 * **Why it is a file of its own.** A capture is a small state machine with six
 * refs (the stream, the recorder, the chunks, the analyser, the audio graph and
 * the clock it started at) and the page around it is a list editor. Keeping the
 * machine in one file is what lets the page read as a list of recordings rather
 * than as a recorder that happens to have a library.
 *
 * **Why the size cap stops the capture rather than warning about it.** The store
 * refuses a recording past `MAX_RECORDING_BYTES` — the blob store holds a blob
 * whole, so that number is a memory bound — and a capture that reached it would
 * be a recording the user watched and then lost. So the page stops itself at the
 * cap and SAVES what it has, which is the only end of that situation that keeps
 * the recording.
 *
 * **Why a device list rather than a bare „default".** A laptop with a webcam and
 * a headset has three input devices, and which microphone is a question only the
 * user can answer. Labels arrive only after a grant (`enumerateDevices`' own
 * rule), so the list is re-read after a successful capture and the next
 * recording can be aimed at the right device.
 */

/** The bitrate the capture asks for, per kind — a REQUEST Chromium may answer differently, which is exactly what the measured readout is for. */
const AUDIO_BITS_PER_SECOND = 128_000;
const VIDEO_BITS_PER_SECOND = 2_500_000;

/** How much of the stream one `dataavailable` chunk holds: often enough that the size readout moves, rarely enough that it is not a cost. */
const TIMESLICE_MS = 1_000;

/** How often the level bar and the clocks are repainted while a capture runs. */
const TICK_MS = 150;

/** The seconds the countdown counts; the „Snimač" settings card turns it on. */
const COUNTDOWN_SECONDS = 3;

/** Which part of a capture the section is in. */
type Phase = "idle" | "countdown" | "recording" | "paused";

/** The word for a kind, read at CALL time so a language switch reaches it (the copy table is rewritten in place). */
function kindWord(kind: RecordingKind): string {
  return kind === "video" ? copy.capture.kindVideo : copy.capture.kindAudio;
}

export function CaptureSection({
  profileId,
  limitBytes,
  countdown,
  startRef,
  onSaved,
}: {
  profileId: string;
  limitBytes: number;
  /** The profile's own preference, from the view the page holds — see `shared/manifest.ts` on why it is a profile row. */
  countdown: boolean;
  /** The empty state's own button presses THIS one: one primary for „record something", wherever it is drawn from. */
  startRef: RefObject<HTMLButtonElement | null>;
  onSaved: (next: RecorderView) => void;
}) {
  const [kind, setKind] = useState<RecordingKind>("audio");
  const [deviceId, setDeviceId] = useState("");
  const [devices, setDevices] = useState<readonly MediaDeviceInfo[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [writtenBytes, setWrittenBytes] = useState(0);
  const [countdownLeft, setCountdownLeft] = useState(COUNTDOWN_SECONDS);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const writtenRef = useRef(0);
  const startedAtRef = useRef(0);
  const pausedMsRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);
  const countdownEndsRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const waveformRef = useRef<Uint8Array>(new Uint8Array(0));
  /** The mime `MediaRecorder` was asked for, decided when the device was acquired. */
  const mimeRef = useRef<string | null>(null);
  const finishingRef = useRef(false);

  const live = phase === "recording" || phase === "paused";

  /** The clock on screen: wall-clock since the start, minus the stretches spent paused. */
  const elapsedMs = live
    ? captureElapsedMs(
        startedAtRef.current,
        nowMs,
        pausedMsRef.current + (pausedAtRef.current === null ? 0 : nowMs - pausedAtRef.current),
      )
    : 0;

  /** What the room left inside the cap buys: the MEASURED rate once there is one, the requested bitrate's estimate before that. */
  const estimatedRate = bytesPerMs(
    kind === "video" ? VIDEO_BITS_PER_SECOND + AUDIO_BITS_PER_SECOND : AUDIO_BITS_PER_SECOND,
  );
  const rate = measuredBytesPerMs(writtenBytes, elapsedMs) ?? estimatedRate;
  const leftMs = Math.max(0, remainingMs(limitBytes, writtenBytes, rate) ?? 0);

  /** Releases the device and the audio graph — the one cleanup every path shares. */
  const releaseDevices = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    analyserRef.current = null;
    waveformRef.current = new Uint8Array(0);
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context !== null) void context.close().catch(() => undefined);
    setLevel(0);
  }, []);

  /**
   * Ends the capture: stops the recorder, assembles the bytes it produced, and
   * either stores them or drops them.
   *
   * The mime stored is `recorder.mimeType` AS CHROMIUM REPORTED IT after the
   * capture — `@nexus/core`'s own rule for this module — and a capture that
   * produced something outside the closed list is dropped with a sentence rather
   * than stored under a mime nothing here can serve.
   */
  const finish = useCallback(
    async (discard: boolean) => {
      if (finishingRef.current) return;
      finishingRef.current = true;
      try {
        const recorder = recorderRef.current;
        if (recorder === null) {
          releaseDevices();
          setPhase("idle");
          return;
        }
        const chunks = chunksRef.current;
        const stopped = new Promise<void>((resolve) => {
          recorder.addEventListener("stop", () => resolve(), { once: true });
        });
        if (recorder.state !== "inactive") recorder.stop();
        await stopped;
        const type = recorder.mimeType;
        const bytes = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer());
        const durationMs = Math.max(
          1,
          Math.round(captureElapsedMs(startedAtRef.current, Date.now(), pausedMsRef.current)),
        );
        recorderRef.current = null;
        chunksRef.current = [];
        writtenRef.current = 0;
        setWrittenBytes(0);
        releaseDevices();
        setPhase("idle");
        if (discard || bytes.byteLength === 0) return;
        if (!isRecordingMime(type)) {
          setProblem(
            kind === "video" ? copy.capture.unsupportedVideo : copy.capture.unsupportedAudio,
          );
          return;
        }
        setSaving(true);
        try {
          onSaved(
            await window.nexus.modules.recorder.save({
              profileId,
              kind,
              mime: type,
              durationMs,
              bytes,
              // The date-and-time default belongs to the page's copy, and the
              // user names it afterwards: an empty title is what a fresh
              // recording has (see `entries.ts`'s `entryTitle`).
              title: "",
              tags: [],
              notes: "",
              isDiary: false,
              diaryDate: null,
            }),
          );
        } catch (failure) {
          setProblem(copy.capture.saveFailed);
          console.error("Nexus: the recording was not saved:", failure);
        } finally {
          setSaving(false);
        }
      } finally {
        finishingRef.current = false;
      }
    },
    [kind, onSaved, profileId, releaseDevices],
  );

  /** The input devices of the chosen kind, as the browser knows them. Labels are empty until a device has been granted. */
  const listDevices = useCallback(async () => {
    const media = navigator.mediaDevices;
    if (media === undefined) return;
    try {
      const all = await media.enumerateDevices();
      setDevices(all.filter((device) => device.kind === `${kind}input`));
    } catch (failure) {
      // A browser that will not enumerate has simply nothing to offer here; the
      // „default device" option is what the capture then uses.
      console.error("Nexus: the recorder's devices could not be listed:", failure);
    }
  }, [kind]);

  useEffect(() => {
    void listDevices();
  }, [listDevices]);

  /**
   * The capture's one clock, while something is on: it repaints the elapsed
   * time, reads the level meter, and stops the recording the moment the size cap
   * is reached (see the file's header for why stopping is the honest end).
   */
  useEffect(() => {
    if (!live) return;
    const handle = setInterval(() => {
      setNowMs(Date.now());
      const analyser = analyserRef.current;
      if (analyser !== null) {
        const buffer = waveformRef.current;
        analyser.getByteTimeDomainData(buffer as Uint8Array<ArrayBuffer>);
        setLevel(levelFromWaveform(buffer));
      }
      if (writtenRef.current >= limitBytes) void finish(false);
    }, TICK_MS);
    return () => clearInterval(handle);
  }, [finish, limitBytes, live]);

  /** The countdown the settings card turns on: three ticks, then the capture. */
  useEffect(() => {
    if (phase !== "countdown") return;
    const handle = setInterval(() => {
      const left = Math.ceil((countdownEndsRef.current - Date.now()) / 1_000);
      setCountdownLeft(Math.max(0, left));
      if (left <= 0) {
        clearInterval(handle);
        setPhase("recording");
      }
    }, 100);
    return () => clearInterval(handle);
  }, [phase]);

  /** Creates the recorder once the countdown has finished — the one effect that starts a capture. */
  useEffect(() => {
    if (phase !== "recording" || recorderRef.current !== null) return;
    const stream = streamRef.current;
    const mime = mimeRef.current;
    if (stream === null || mime === null) {
      if (mime === null) {
        setProblem(
          kind === "video" ? copy.capture.unsupportedVideo : copy.capture.unsupportedAudio,
        );
      }
      releaseDevices();
      setPhase("idle");
      return;
    }
    // The bitrates are asked for explicitly rather than left to Chromium: they
    // are what the remaining-time readout estimates from before the first chunk,
    // and an explicit number is one this file can state. A video option is
    // ABSENT for an audio capture (`exactOptionalPropertyTypes`): a
    // `videoBitsPerSecond: undefined` would be a key that exists and says
    // nothing.
    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      ...(kind === "video" ? { videoBitsPerSecond: VIDEO_BITS_PER_SECOND } : {}),
    });
    recorder.addEventListener("dataavailable", (event: BlobEvent) => {
      if (event.data.size === 0) return;
      chunksRef.current.push(event.data);
      writtenRef.current += event.data.size;
      setWrittenBytes(writtenRef.current);
    });
    recorderRef.current = recorder;
    recorder.start(TIMESLICE_MS);
  }, [kind, phase, releaseDevices]);

  /**
   * Starts a capture: asks main to open the media window, acquires the device,
   * and either counts down or goes straight in.
   *
   * The arming call comes FIRST, and that order is the whole of „the permission
   * is granted while the recorder's page asks": `getUserMedia` is what Chromium
   * consults the session's handler for, and main's rule says no until this page
   * has said it is about to ask.
   */
  const begin = useCallback(async () => {
    setProblem(null);
    const media = navigator.mediaDevices;
    if (media === undefined) {
      setProblem(kind === "video" ? copy.capture.unsupportedVideo : copy.capture.unsupportedAudio);
      return;
    }
    const mime = pickMime(kind, (candidate) => MediaRecorder.isTypeSupported(candidate));
    if (mime === null) {
      setProblem(kind === "video" ? copy.capture.unsupportedVideo : copy.capture.unsupportedAudio);
      return;
    }
    try {
      await window.nexus.modules.recorder.beginCapture({ profileId });
    } catch (failure) {
      setProblem(copy.capture.saveFailed);
      console.error("Nexus: the recorder could not ask for a device:", failure);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await media.getUserMedia({
        audio: deviceId === "" ? true : { deviceId: { exact: deviceId } },
        video: kind === "video" ? (deviceId === "" ? true : { deviceId: { exact: deviceId } }) : false,
      });
    } catch (failure) {
      // The two failures a user meets are „denied" and „no device", and the
      // permission one is the only one a person can act on — with the exact
      // path through Windows' own privacy settings.
      const denied = failure instanceof DOMException && failure.name === "NotAllowedError";
      setProblem(denied ? copy.capture.permissionDenied : copy.capture.saveFailed);
      console.error("Nexus: the recorder could not reach a device:", failure);
      return;
    }
    streamRef.current = stream;
    mimeRef.current = mime;
    await listDevices();
    // The level meter: the stream's own audio, through an analyser. Built here,
    // inside the click that asked for the device, so no autoplay policy applies.
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1_024;
      context.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = context;
      analyserRef.current = analyser;
      waveformRef.current = new Uint8Array(analyser.fftSize);
    } catch (failure) {
      // No analyser is no level bar, and the recording is unaffected.
      console.error("Nexus: the recorder's level meter could not be built:", failure);
    }
    startedAtRef.current = Date.now();
    pausedMsRef.current = 0;
    pausedAtRef.current = null;
    writtenRef.current = 0;
    chunksRef.current = [];
    setWrittenBytes(0);
    setNowMs(Date.now());
    if (countdown) {
      countdownEndsRef.current = Date.now() + COUNTDOWN_SECONDS * 1_000;
      setCountdownLeft(COUNTDOWN_SECONDS);
      setPhase("countdown");
    } else {
      setPhase("recording");
    }
  }, [countdown, deviceId, kind, listDevices, profileId]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder === null || recorder.state !== "recording") return;
    recorder.pause();
    pausedAtRef.current = Date.now();
    setPhase("paused");
  }, []);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder === null || recorder.state !== "paused") return;
    recorder.resume();
    if (pausedAtRef.current !== null) pausedMsRef.current += Date.now() - pausedAtRef.current;
    pausedAtRef.current = null;
    setPhase("recording");
  }, []);

  /** Leaving the page ends a capture in progress the way „Zaustavi" does: by keeping it. */
  useEffect(
    () => () => {
      if (recorderRef.current !== null) void finish(false);
    },
    [finish],
  );

  const secondsOf = (ms: number): string => formatRecordingDuration(ms);
  const busy = phase === "countdown" || phase === "recording" || phase === "paused" || saving;
  const deviceLabel = (device: MediaDeviceInfo, index: number): string =>
    device.label === "" ? `${kindWord(kind)} ${index + 1}` : device.label;

  return (
    <Card className="rec__capture" title={copy.capture.title}>
      <div className="rec__capture-setup">
        <div className="rec__segmented" role="group" aria-label={copy.capture.kindLabel}>
          {(["audio", "video"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={kind === option ? "primary" : "ghost"}
              aria-pressed={kind === option}
              disabled={busy}
              onClick={() => {
                setKind(option);
                setDeviceId("");
              }}
            >
              {kindWord(option)}
            </Button>
          ))}
        </div>
        <Select
          label={copy.capture.deviceLabel}
          value={deviceId}
          disabled={busy}
          onChange={(event) => setDeviceId(event.target.value)}
        >
          <option value="">{copy.capture.deviceDefault}</option>
          {devices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {deviceLabel(device, index)}
            </option>
          ))}
        </Select>
      </div>

      <div className="rec__meter">
        <span className="nx-eyebrow">{copy.capture.levelLabel}</span>
        <span
          className="rec__meter-track"
          role="meter"
          aria-label={copy.capture.levelLabel}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={level}
        >
          <span className="rec__meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
        </span>
      </div>

      <div className="rec__clocks">
        {phase === "countdown" ? (
          <p className="rec__clock" role="status">
            {copy.capture.countdown} {countdownLeft}
          </p>
        ) : (
          <>
            <div className="rec__clock-block">
              <span className="nx-eyebrow">{copy.capture.elapsedLabel}</span>
              <p className="rec__clock" aria-live="off">
                {secondsOf(elapsedMs)}
              </p>
            </div>
            {live && (
              <div className="rec__clock-block">
                <span className="nx-eyebrow">{copy.capture.remainingLabel}</span>
                <p className="rec__clock rec__clock--flow">{secondsOf(leftMs)}</p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="rec__actions">
        {!busy ? (
          <Button ref={startRef} size="sm" variant="primary" onClick={() => void begin()}>
            {copy.capture.start}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              disabled={phase === "countdown" || saving}
              onClick={() => (phase === "paused" ? resume() : pause())}
            >
              {phase === "paused" ? copy.capture.resume : copy.capture.pause}
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void finish(false)}>
              {copy.capture.stop}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                if (phase === "countdown") {
                  setPhase("idle");
                  releaseDevices();
                  return;
                }
                void finish(true);
              }}
            >
              {copy.capture.discard}
            </Button>
          </>
        )}
      </div>

      {problem !== null && (
        <p className="rec__error" role="alert">
          {problem}
        </p>
      )}
    </Card>
  );
}

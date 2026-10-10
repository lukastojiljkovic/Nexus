import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  EmptyState,
  Icon,
  ListRow,
  Select,
  SeriesPlot,
  TextField,
} from "@nexus/ui";
import {
  BAUD_RATES,
  LINE_ENDINGS,
  mergeNmeaFix,
  parseNmeaSentence,
  parseSensorHeader,
  parseSensorLine,
  splitSerialChunk,
  toHexView,
  type LineEnding,
  type NmeaFix,
} from "@nexus/core";
import { activeLocale } from "../../../renderer/src/strings.js";
import type { LabSampleView, LabView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import { LabFigure } from "./parts.js";
import type { LabRun } from "./Page.js";
import {
  fixQualityCode,
  formatCoordinate,
  formatInstant,
  formatMeasure,
  hiddenLineCount,
  readingSeries,
  visibleLines,
} from "./reading.js";

/**
 * The serial laboratory: a terminal with a baud rate, a line ending and a hex
 * view, and two parsers on top of it — NMEA GPS sentences and a sketch's CSV.
 *
 * **The device is chosen by the user, in main's dialog.** `requestPort` is the
 * only way to reach a port and the specification itself demands a real click, so
 * there is no path here that opens a device nobody picked — and the dialog's
 * buttons are the ports, which is `main/serialPicker.ts`'s half.
 *
 * **The reading loop lives in a ref, not in the render.** A stream that arrives
 * faster than React renders would otherwise be a stream that loses lines to
 * batching; the loop appends to the log and the buffer directly, and the page
 * re-renders from what it appended.
 *
 * **Everything the parsers see is the device's own text.** A line is either a
 * sentence with a verified checksum, a header naming columns, or a row of
 * numbers in those columns — and a line that is none of those is COUNTED and
 * shown, never repaired, because a temperature in the humidity column is worse
 * than a refusal.
 */

/** The terminal's reading mode: raw lines, GPS sentences, or a sensor's CSV. */
const MODES = ["terminal", "nmea", "csv"] as const;
type LabMode = (typeof MODES)[number];

/** How many lines the terminal's view keeps. Older ones are dropped, and the page says so. */
const TERMINAL_LINES = 400;

/** How many parsed readings the buffer holds before it is written to the store. */
const BUFFER_LIMIT = 600;

/** The window the sensor chart draws, in readings. */
const CHART_WINDOW = 240;

export function SerialCard({
  profileId,
  view,
  run,
}: {
  profileId: string;
  view: LabView;
  run: LabRun;
}) {
  const [mode, setMode] = useState<LabMode>("terminal");
  const [baudRate, setBaudRate] = useState(9_600);
  const [ending, setEnding] = useState<LineEnding>("crlf");
  const [hexView, setHexView] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [portLabel, setPortLabel] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [failure, setFailure] = useState<"refused" | null>(null);
  const [badLine, setBadLine] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [fix, setFix] = useState<NmeaFix | null>(null);

  const [pendingColumns, setPendingColumns] = useState<readonly string[] | null>(null);
  const [logName, setLogName] = useState("");
  const [selectedLogId, setSelectedLogId] = useState("");
  const [column, setColumn] = useState(0);
  const [logging, setLogging] = useState(false);
  const [samples, setSamples] = useState<LabSampleView[]>([]);
  const [samplesColumns, setSamplesColumns] = useState<readonly string[]>([]);
  const [written, setWritten] = useState(0);

  const portRef = useRef<SerialPort | null>(null);
  const readingRef = useRef(false);
  const carryRef = useRef("");
  const endingRef = useRef<LineEnding>(ending);
  const modeRef = useRef<LabMode>(mode);
  const columnsRef = useRef<readonly string[] | null>(null);
  const logIdRef = useRef<string | null>(null);
  const bufferRef = useRef<string[]>([]);
  const loggingRef = useRef(logging);

  const selectedLog = view.logs.find((log) => log.id === selectedLogId) ?? null;
  // The loop and the flush interval run outside React's render cycle, so the
  // values they read are mirrored into refs rather than captured: a stale
  // capture is how a terminal keeps printing into a log the user has switched
  // away from.
  endingRef.current = ending;
  modeRef.current = mode;
  loggingRef.current = logging;
  columnsRef.current = selectedLog?.columns ?? pendingColumns;
  logIdRef.current = selectedLog === null ? null : selectedLog.id;

  const handleLine = useCallback((line: string) => {
    setLines((current) => [...current, line]);
    const current = modeRef.current;
    if (current === "nmea") {
      const result = parseNmeaSentence(line);
      if (result.ok) {
        setFix((previous) => mergeNmeaFix(previous, result.reading, new Date().toISOString()));
      }
      return;
    }
    if (current !== "csv") return;
    const columns = columnsRef.current;
    if (columns === null) {
      // No columns yet: the device's first line is its own header, and until one
      // arrives there is nothing to interpret a data line against.
      const header = parseSensorHeader(line);
      if (header !== null) setPendingColumns(header);
      return;
    }
    const values = parseSensorLine(line, columns.length);
    if (values === null) {
      setBadLine(line);
      return;
    }
    setBadLine(null);
    if (logIdRef.current !== null && loggingRef.current && bufferRef.current.length < BUFFER_LIMIT) {
      bufferRef.current.push(line);
    }
  }, []);

  /** Opens the port the user picked in main's dialog and reads it until told to stop. */
  const connect = useCallback(async () => {
    if (typeof navigator.serial === "undefined") {
      setUnsupported(true);
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate });
      portRef.current = port;
      readingRef.current = true;
      carryRef.current = "";
      setPortLabel(portLabelOf(port));
      setConnected(true);
      setFailure(null);
      const reader = port.readable?.getReader();
      if (reader === undefined) return;
      const decoder = new TextDecoder();
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done === true || !readingRef.current) break;
            if (value === undefined) continue;
            const split = splitSerialChunk(
              carryRef.current,
              decoder.decode(value, { stream: true }),
              endingRef.current,
            );
            carryRef.current = split.carry;
            for (const read of split.lines) handleLine(read);
          }
        } catch (readFailure) {
          // An unplugged device ends the loop with an error on some drivers and
          // with `done` on others; both are „the port is gone", and the page says
          // that rather than showing the exception.
          console.error("Nexus: the serial port stopped answering:", readFailure);
        } finally {
          reader.releaseLock();
          setConnected(false);
        }
      })();
    } catch (openFailure) {
      // A cancelled picker and a port another program holds are both „not
      // connected", and the page says so rather than showing an exception.
      setFailure("refused");
      setConnected(false);
      console.error("Nexus: the serial port could not be opened:", openFailure);
    }
  }, [baudRate, handleLine]);

  /** Closes the port; the reading loop sees `readingRef` go false and stops. */
  const disconnect = useCallback(async () => {
    readingRef.current = false;
    const port = portRef.current;
    portRef.current = null;
    setConnected(false);
    if (port !== null) {
      try {
        await port.close();
      } catch (closeFailure) {
        console.error("Nexus: the serial port could not be closed:", closeFailure);
      }
    }
  }, []);

  // Every port this page opened is closed when the page goes: a page that left a
  // device open would hold it against whatever the user opens next.
  useEffect(() => {
    return () => {
      readingRef.current = false;
      void portRef.current?.close().catch(() => undefined);
      portRef.current = null;
    };
  }, []);

  /** Writes what the buffer holds, in one call, and empties it. */
  const flush = useCallback(async () => {
    const logId = logIdRef.current;
    if (logId === null) return;
    const buffered = bufferRef.current;
    if (buffered.length === 0) return;
    bufferRef.current = [];
    try {
      await run((lab) => lab.appendSamples({ profileId, logId, lines: buffered }));
      setWritten((current) => current + buffered.length);
    } catch (writeFailure) {
      console.error("Nexus: the readings were not written:", writeFailure);
    }
  }, [profileId, run]);

  // While logging is on, the buffer is written half a second at a time — the
  // batch the wire allows — and once more when logging stops.
  useEffect(() => {
    if (!logging) return;
    const handle = setInterval(() => void flush(), 500);
    return () => {
      clearInterval(handle);
      void flush();
    };
  }, [logging, flush]);

  /** Re-reads the charted log: when the selection changes, and once a second while logging. */
  useEffect(() => {
    if (selectedLogId === "") {
      setSamples([]);
      setSamplesColumns([]);
      return;
    }
    let active = true;
    const read = async (): Promise<void> => {
      try {
        const answer = await window.nexus.modules.lab.logSamples({ profileId, logId: selectedLogId });
        if (!active) return;
        setSamples([...answer.samples]);
        setSamplesColumns(answer.columns);
      } catch (readFailure) {
        console.error("Nexus: the readings could not be read:", readFailure);
      }
    };
    void read();
    const handle = setInterval(() => void read(), logging ? 1_000 : 15_000);
    return () => {
      active = false;
      clearInterval(handle);
    };
  }, [profileId, selectedLogId, logging]);

  const series = useMemo(() => readingSeries(samples, column, CHART_WINDOW), [samples, column]);
  const shownLines = visibleLines(lines, TERMINAL_LINES);
  const hidden = hiddenLineCount(lines, TERMINAL_LINES);

  return (
    <Card className="lab__card" title={copy.serial.title}>
      {unsupported && <p className="nx-hint">{copy.serial.unsupported}</p>}
      <div className="lab__row">
        <span className="lab__port">{portLabel ?? copy.serial.noPort}</span>
        <Chip variant={connected ? "data" : "neutral"}>
          {connected ? copy.serial.connected : copy.serial.disconnected}
        </Chip>
        <Button size="sm" variant="primary" onClick={() => void connect()} disabled={connected}>
          {copy.serial.choosePort}
        </Button>
        <Button size="sm" onClick={() => void disconnect()} disabled={!connected}>
          {copy.serial.disconnect}
        </Button>
      </div>
      <div className="lab__row">
        <Select
          label={copy.serial.baud}
          value={String(baudRate)}
          disabled={connected}
          onChange={(event) => setBaudRate(Number(event.target.value))}
        >
          {BAUD_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}
            </option>
          ))}
        </Select>
        <Select
          label={copy.serial.ending}
          value={ending}
          onChange={(event) => setEnding(event.target.value as LineEnding)}
        >
          {LINE_ENDINGS.map((option) => (
            <option key={option} value={option}>
              {copy.serial.endings[option]}
            </option>
          ))}
        </Select>
        <Select
          label={copy.serial.mode}
          value={mode}
          onChange={(event) => setMode(event.target.value as LabMode)}
        >
          {MODES.map((option) => (
            <option key={option} value={option}>
              {copy.serial.modes[option]}
            </option>
          ))}
        </Select>
        <Checkbox checked={hexView} onChange={(event) => setHexView(event.target.checked)}>
          {copy.serial.hex}
        </Checkbox>
      </div>
      {failure === "refused" && <p className="nx-hint">{copy.serial.refused}</p>}

      <div className="lab__terminal" role="log" aria-label={copy.serial.terminalLabel}>
        {hexView ? (
          <pre className="lab__log lab__log--hex">
            {toHexView(lines.join("\n"), 2_048).join("\n")}
          </pre>
        ) : (
          <pre className="lab__log">{shownLines.join("\n")}</pre>
        )}
      </div>
      {hidden > 0 && <p className="nx-hint">{copy.serial.hidden}</p>}
      <div className="lab__row">
        <Button
          size="sm"
          disabled={lines.length === 0}
          onClick={() => {
            void (async () => {
              try {
                const saved = await window.nexus.modules.lab.saveTerminalLog({
                  text: lines.join("\r\n"),
                });
                setSavedPath(saved.path);
              } catch (saveFailure) {
                console.error("Nexus: the terminal log was not saved:", saveFailure);
              }
            })();
          }}
        >
          {copy.serial.saveLog}
        </Button>
        <Button size="sm" variant="quiet" onClick={() => setLines([])} disabled={lines.length === 0}>
          {copy.serial.clear}
        </Button>
        {savedPath !== null && (
          <span className="nx-hint">{`${copy.serial.savedTo} ${savedPath}`}</span>
        )}
      </div>

      {mode === "nmea" && (
        <div className="lab__panel">
          <div className="nx-eyebrow">{copy.serial.fixTitle}</div>
          {fix === null || fix.latitude === null || fix.longitude === null ? (
            <p className="nx-hint">{copy.serial.fixNone}</p>
          ) : (
            <>
              <div className="lab__figures">
                <LabFigure label={copy.serial.latitude} value={formatCoordinate(fix.latitude, activeLocale())} />
                <LabFigure label={copy.serial.longitude} value={formatCoordinate(fix.longitude, activeLocale())} />
                <LabFigure
                  label={copy.serial.satellites}
                  value={fix.satellites === null ? "—" : String(fix.satellites)}
                />
                <LabFigure label={copy.serial.quality} value={copy.serial.qualityNames[fixQualityCode(fix.fixQuality)]} />
                <LabFigure label={copy.serial.utcTime} value={fix.utcTime ?? "—"} />
                <LabFigure label={copy.serial.gpsDate} value={fix.utcDate ?? "—"} />
              </div>
              <div className="lab__row">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={(fix.fixQuality ?? 0) === 0}
                  onClick={() =>
                    void run((lab) =>
                      lab.setLocation({
                        profileId,
                        latitude: fix.latitude ?? 0,
                        longitude: fix.longitude ?? 0,
                      }),
                    )
                  }
                >
                  {copy.serial.useAsLocation}
                </Button>
                {/* A fix with no quality is a receiver that has not acquired yet:
                    its position may be there, and it is not a place to trust. */}
                {(fix.fixQuality ?? 0) === 0 && (
                  <span className="nx-hint">{copy.serial.qualityNone}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {view.location !== null && (
        <div className="lab__row">
          <Icon name="globe" />
          <span>
            {`${copy.serial.locationIs} ${formatCoordinate(view.location.latitude, activeLocale())}, ${formatCoordinate(view.location.longitude, activeLocale())} — ${formatInstant(view.location.at, activeLocale())}`}
          </span>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => void run((lab) => lab.clearLocation({ profileId }))}
          >
            {copy.serial.forgetLocation}
          </Button>
        </div>
      )}

      {mode === "csv" && (
        <div className="lab__panel">
          <div className="nx-eyebrow">{copy.serial.csvTitle}</div>
          {pendingColumns !== null && (
            <p className="nx-hint">{`${copy.serial.columnsFound}: ${pendingColumns.join(", ")}`}</p>
          )}
          <div className="lab__row">
            <TextField
              label={copy.serial.logName}
              value={logName}
              maxLength={60}
              onChange={(event) => setLogName(event.target.value)}
            />
            <Button
              size="sm"
              variant="primary"
              disabled={logName.trim().length === 0 || pendingColumns === null}
              onClick={() => {
                const columns = pendingColumns ?? [];
                const name = logName.trim();
                setLogName("");
                void run((lab) => lab.createLog({ profileId, name, columns }));
              }}
            >
              {copy.serial.createLog}
            </Button>
            <Select
              label={copy.serial.logSelect}
              value={selectedLogId}
              onChange={(event) => {
                setSelectedLogId(event.target.value);
                setColumn(0);
                setWritten(0);
              }}
            >
              <option value="">{copy.serial.noLog}</option>
              {view.logs.map((log) => (
                <option key={log.id} value={log.id}>
                  {log.name}
                </option>
              ))}
            </Select>
          </div>
          {badLine !== null && <p className="lab__error">{`${copy.serial.badLine} ${badLine}`}</p>}
          {selectedLog !== null && (
            <>
              <div className="lab__row">
                <Select
                  label={copy.serial.column}
                  value={String(column)}
                  onChange={(event) => setColumn(Number(event.target.value))}
                >
                  {(samplesColumns.length > 0 ? samplesColumns : selectedLog.columns).map(
                    (name, index) => (
                      <option key={name} value={index}>
                        {name}
                      </option>
                    ),
                  )}
                </Select>
                <Button
                  size="sm"
                  variant={logging ? "danger" : "primary"}
                  onClick={() => {
                    if (logging) {
                      setLogging(false);
                      void flush();
                      return;
                    }
                    setLogging(true);
                  }}
                >
                  {logging ? copy.serial.stopLogging : copy.serial.startLogging}
                </Button>
                {logging && <Chip variant="data">{copy.serial.logging}</Chip>}
                <span className="nx-hint">{`${copy.serial.written} ${String(written)}`}</span>
              </div>
              <SeriesPlot
                title={selectedLog.name}
                description={`${copy.serial.chartDescription} ${selectedLog.columns[column] ?? ""}`}
                empty={series === null ? { reason: copy.serial.chartEmpty } : null}
                series={
                  series === null
                    ? []
                    : [
                        {
                          key: "values",
                          tone: "data",
                          shape: "line",
                          points: series.points,
                        },
                      ]
                }
                x={{ domain: [series?.domain[0] ?? 0, series?.domain[1] ?? 1] }}
                y={{ format: (value) => formatMeasure(value, 2, activeLocale()) }}
                width={720}
              />
            </>
          )}
          {view.logs.length === 0 ? (
            <EmptyState
              variant="inline"
              title={copy.serial.logsEmpty}
              description={copy.serial.logsEmptyBody}
            />
          ) : (
            <div className="lab__list">
              {view.logs.map((log) => (
                <ListRow
                  key={log.id}
                  leading={<Icon name="chart" />}
                  trailing={
                    <span className="lab__row">
                      <Button
                        size="sm"
                        onClick={() => {
                          void (async () => {
                            try {
                              const saved = await window.nexus.modules.lab.exportLogCsv({
                                profileId,
                                logId: log.id,
                              });
                              setSavedPath(saved.path);
                            } catch (exportFailure) {
                              console.error("Nexus: the CSV was not written:", exportFailure);
                            }
                          })();
                        }}
                      >
                        {copy.serial.exportCsv}
                      </Button>
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() => {
                          if (logIdRef.current === log.id) setSelectedLogId("");
                          void run((lab) => lab.removeLog({ profileId, logId: log.id }));
                        }}
                      >
                        {copy.serial.removeLog}
                      </Button>
                    </span>
                  }
                >
                  <span className="lab__log-name">{log.name}</span>
                  <span className="lab__log-meta">
                    {`${copy.serial.columnsLabel}: ${log.columns.join(", ")} — ${copy.serial.readingsLabel}: ${String(log.sampleCount)}`}
                    {log.lastAt === null
                      ? ""
                      : ` — ${copy.serial.newest}: ${formatInstant(log.lastAt, activeLocale())}`}
                  </span>
                </ListRow>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * The OS's own name for a port, where the driver reports one.
 *
 * Chromium does not hand a page the port's `displayName`, so what is left is the
 * USB identity the device itself carries — and where even that is missing the
 * answer is the generic word rather than an invented `COM` number: the port the
 * user picked is the port that is open, and main's dialog is where it was named.
 */
function portLabelOf(port: SerialPort): string {
  const usb = port.getInfo().usbVendorId;
  return usb === undefined
    ? copy.serial.portGeneric
    : `${copy.serial.usbDevice} ${usb.toString(16).padStart(4, "0")}`;
}

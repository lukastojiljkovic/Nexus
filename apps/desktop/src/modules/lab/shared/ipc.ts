import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * THE LAB's contract: four instruments behind one page, declared once, in its
 * own folder (ADR-090).
 *
 * **One module, four subjects, and the contract is why.** A serial terminal, a
 * battery panel, a tone generator and a lamp share no state: they are four
 * windows onto the machine the app is running on, and the reason they are one
 * module rather than four is the SHELL rather than the code — four rail rows for
 * four surfaces nobody opens daily would be four rows of noise, and „the
 * hardware drawer" is one errand. What the contract states is the other half of
 * that: each subject's own operations, named after what they do, with no op that
 * would let the page touch a device main has not been told about.
 *
 * **The sound and the light have NO ops at all, and that is not an omission.**
 * `AudioContext`, `AnalyserNode`, `navigator.getBattery` and the lamp's colours
 * are renderer APIs: the data never leaves the page, nothing needs a store, and
 * an op whose handler did nothing but answer „fine" would be a channel with no
 * subject. Main's half of this module is what a RENDERER CANNOT DO — the serial
 * port's selection and permission, the battery report `powercfg` writes, the
 * device-wide location, and the logs in the database.
 *
 * **Why every mutation answers with the whole view.** The rows here are logs
 * (a name, its columns, and how many readings they hold) and one budget; a full
 * read of all of them is smaller than the bookkeeping a per-op delta would need,
 * and one result type means the page has exactly one way to update — the kit's
 * rule, and what keeps a wrong local guess impossible.
 */

/**
 * One stored sensor log as it crosses the wire.
 *
 * Declared here rather than imported from `@nexus/db`, which is where the row
 * lives: no file under `shared/` may reach that package (it is SQLite and
 * therefore Node-only, and the renderer shares this file). `main/register.ts` is
 * the only thing that maps one onto the other, and the compiler keeps the two
 * shapes in step because the store's row is what it maps FROM.
 */
export interface LabLogView {
  readonly id: string;
  readonly name: string;
  /** The column names the device's own header declared, in the order its lines print them. */
  readonly columns: readonly string[];
  /** How many readings are stored — read from the list, never by loading them. */
  readonly sampleCount: number;
  /** The instant of the newest reading, or `null` while the log is empty. */
  readonly lastAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One reading: when it arrived, and one value per column of its log. */
export interface LabSampleView {
  readonly at: string;
  readonly values: readonly number[];
}

/** The readings of one log, with the columns they belong to, as one read answers. */
export interface LabSamplesView {
  readonly logId: string;
  readonly columns: readonly string[];
  readonly samples: readonly LabSampleView[];
}

/** One device in the off-grid list. */
export interface LabDeviceView {
  readonly name: string;
  readonly watts: number;
  readonly hoursPerDay: number;
}

/** The profile's off-grid budget, or `null` while the user has never filled one in. */
export interface LabOffGridView {
  readonly devices: readonly LabDeviceView[];
  readonly batteryWh: number;
  readonly depthOfDischarge: number;
  readonly sunHours: number;
}

/** The app-wide location, as the astronomy corner and a map would read it. */
export interface LabLocationView {
  readonly latitude: number;
  readonly longitude: number;
  /** When the fix was taken, from main's clock. */
  readonly at: string;
}

/** Everything one read of this module answers with, and what every mutation answers with too (see the header). */
export interface LabView {
  /** By name, the way a person reads them (`Intl.Collator(["sr-Latn", "sr"])`, in the store). */
  readonly logs: readonly LabLogView[];
  readonly offGrid: LabOffGridView | null;
  /** The device-wide location main currently holds, if any. */
  readonly location: LabLocationView | null;
}

/** One battery of the report Windows writes. */
export interface LabBatteryPackView {
  readonly id: string | null;
  readonly designCapacityMWh: number | null;
  readonly fullChargeCapacityMWh: number | null;
  readonly cycleCount: number | null;
}

/** One line of the report's recent usage table. */
export interface LabBatteryUsageView {
  readonly at: string | null;
  readonly ac: boolean | null;
  readonly entryType: string | null;
  readonly dischargeMWh: number | null;
  readonly durationMs: number | null;
}

/**
 * What one battery read answers, and the three answers it can be.
 *
 * A closed `status` rather than a nullable report alone, because the two ways
 * this can come back empty are different sentences on the page: a desktop with
 * no battery is a machine whose answer is „there is none", and a `powercfg` that
 * did not finish is a report that could not be written. Neither may show the
 * user a raw exception, and neither may be silently the same as the other.
 */
export interface LabBatteryView {
  readonly status: "ok" | "unavailable" | "timeout";
  readonly report: {
    readonly scannedAt: string | null;
    readonly batteries: readonly LabBatteryPackView[];
    readonly recentUsage: readonly LabBatteryUsageView[];
  } | null;
}

/** Where one exported file landed, or that the user closed the dialog. */
export interface LabSavedFileView {
  readonly canceled: boolean;
  /** The absolute path main wrote, for the page to show — `null` when nothing was written. */
  readonly path: string | null;
}

/** One read: whose view is being asked for. */
interface ListPayload {
  profileId: string;
}

/** One log's readings, by its own id. */
interface LogPayload {
  profileId: string;
  logId: string;
}

/** A new log: what it is called and which columns its lines carry. */
interface CreateLogPayload {
  profileId: string;
  name: string;
  columns: readonly string[];
}

/**
 * Readings to append, as the LINES the device printed.
 *
 * The raw lines rather than parsed numbers, deliberately: main parses them with
 * the same `@nexus/core` function the page charts with, so the wire carries what
 * the device said and main decides what it means (`SEC-EL-02`'s rule — the
 * renderer never hands main a computed value it then stores).
 */
interface AppendPayload {
  profileId: string;
  logId: string;
  lines: readonly string[];
}

/** The terminal's log, as one string, for the save dialog. */
interface SaveLogPayload {
  text: string;
}

/** The off-grid budget as the page's form fills it in. */
interface OffGridPayload {
  profileId: string;
  devices: readonly LabDeviceView[];
  batteryWh: number;
  depthOfDischarge: number;
  sunHours: number;
}

/**
 * A GPS fix, as the astronomy corner would need it, plus the profile the answer
 * is scoped to: the mutation answers with the whole view, and the view is one
 * profile's logs and budget.
 */
interface LocationPayload {
  profileId: string;
  latitude: number;
  longitude: number;
}

/**
 * Forgetting the location, and reading the battery: the two payloads with no
 * fields, and the reason each one has none.
 *
 * `battery` reads the MACHINE rather than the profile and takes no value the
 * renderer could get wrong; `Record<string, never>` is the type that says so —
 * an empty object is the only thing that satisfies it — which is why the page
 * calls it with `{}` and why `check:reachable` has no field to find unset.
 *
 * `clearLocation` is NOT in that group: it forgets a device-wide value but
 * answers with the profile's view, so it names the profile like every other
 * mutation.
 */
type NoFields = Record<string, never>;

/**
 * The declared ops, as a payload→result map. `ModuleApiOf` turns this into the
 * `nexus.modules.lab.*` methods the page calls, and `defineModuleContract` turns
 * the keys into the channels main answers on.
 */
type LabOps = {
  list: { request: ListPayload; response: LabView };
  logSamples: { request: LogPayload; response: LabSamplesView };
  createLog: { request: CreateLogPayload; response: LabView };
  appendSamples: { request: AppendPayload; response: LabView };
  removeLog: { request: LogPayload; response: LabView };
  exportLogCsv: { request: LogPayload; response: LabSavedFileView };
  saveTerminalLog: { request: SaveLogPayload; response: LabSavedFileView };
  setOffGrid: { request: OffGridPayload; response: LabView };
  battery: { request: NoFields; response: LabBatteryView };
  setLocation: { request: LocationPayload; response: LabView };
  clearLocation: { request: ListPayload; response: LabView };
};

/** This module's renderer API: one method per op, named after the op. */
export type LabApi = ModuleApiOf<LabOps>;

/**
 * The contract the preload builds the bridge from and main refuses foreign ops
 * against. Exported as `contract` because that is the ONE name the kit's globs
 * agree on: a file that exports none is a module whose bridge is missing, and
 * the preload throws for it at startup rather than on the first click.
 */
export const contract = defineModuleContract<"lab", LabOps>("lab", [
  "list",
  "logSamples",
  "createLog",
  "appendSamples",
  "removeLog",
  "exportLogCsv",
  "saveTerminalLog",
  "setOffGrid",
  "battery",
  "setLocation",
  "clearLocation",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here,
 * which is what makes `window.nexus.modules.lab.list(...)` typed in this
 * module's own page without a line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    lab: LabApi;
  }
}

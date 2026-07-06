import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import {
  openDatabase,
  SqliteFlagStore,
  TaskStore,
  TASK_PRIORITIES,
  TASK_STATUSES,
  uuidv7,
  type CreateTaskInput,
  type NexusDatabase,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type UpdateTaskFields,
} from "@nexus/db";
import {
  IpcChannel,
  type AppInfo,
  type FlagState,
  type Profile,
} from "../shared/ipc.js";

const isSmoke = process.argv.includes("--smoke");

// Stable product name so userData resolves to a clean, branded directory
// (%APPDATA%\Nexus) rather than the scoped package name. Set before any
// getPath("userData") call.
app.setName("Nexus");

let db: NexusDatabase | null = null;
let mainWindow: BrowserWindow | null = null;

// --- Database ---------------------------------------------------------------

function databasePath(): string {
  return join(app.getPath("userData"), "nexus.db");
}

interface ProfileRow {
  id: string;
  kind: "personal" | "business";
  name: string;
  created_at: string;
}

function listProfiles(database: NexusDatabase): Profile[] {
  const rows = database.raw
    .prepare("SELECT id, kind, name, created_at FROM profiles ORDER BY created_at")
    .all() as ProfileRow[];
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    createdAt: row.created_at,
  }));
}

/** Renames an existing profile; throws when the id matches no row (ONB lite). */
function renameProfile(database: NexusDatabase, id: string, name: string): void {
  const result = database.raw
    .prepare("UPDATE profiles SET name = ? WHERE id = ?")
    .run(name, id);
  if (result.changes === 0) {
    throw new Error("Invalid IPC payload: unknown profile id.");
  }
}

/**
 * First-run seeding: create exactly one personal profile if the table is empty.
 * The name is intentionally blank — profile naming belongs to onboarding (ONB)
 * later, so we do not invent a personal name here.
 */
function seedFirstRunProfile(database: NexusDatabase): void {
  const { count } = database.raw
    .prepare("SELECT count(*) AS count FROM profiles")
    .get() as { count: number };
  if (count > 0) return;
  database.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(uuidv7(), "personal", "", new Date().toISOString());
}

function appInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    userDataPath: app.getPath("userData"),
    databasePath: databasePath(),
    versions: {
      electron: process.versions.electron ?? "",
      chrome: process.versions.chrome ?? "",
      node: process.versions.node,
      v8: process.versions.v8,
    },
  };
}

// --- IPC (typed, allowlisted, validated) ------------------------------------
//
// SEC-EL-02: every payload is structurally revalidated before it reaches the DB,
// and every message must originate from our own window's web contents. Handlers
// throw on bad input, which rejects the renderer's promise — no partial writes.

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("IPC message rejected: unrecognized sender.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid IPC payload: expected an object.");
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid IPC payload: "${field}" must be a non-empty string.`);
  }
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid IPC payload: "${field}" must be a boolean.`);
  }
  return value;
}

/** Profile display name: string, 1–80 chars after trimming; the trimmed value is stored. */
function asProfileName(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be 1-80 characters after trimming.`,
    );
  }
  return trimmed;
}

/** A nullable optional string field: either a string or an explicit null. */
function asNullableString(value: unknown, field: string): string | null {
  if (value === null || typeof value === "string") return value;
  throw new Error(`Invalid IPC payload: "${field}" must be a string or null.`);
}

function asTaskStatus(value: unknown, field: string): TaskStatus {
  if (typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value)) {
    return value as TaskStatus;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid task status.`);
}

function asTaskPriority(value: unknown, field: string): TaskPriority {
  if (typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value)) {
    return value as TaskPriority;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid task priority.`);
}

/** Validates a `NewTaskFields` payload into a store input; only present keys are carried. */
function asNewTaskInput(value: unknown): CreateTaskInput {
  const task = asRecord(value);
  const input: CreateTaskInput = { title: asNonEmptyString(task.title, "task.title") };
  if (task.description !== undefined) {
    input.description = asNullableString(task.description, "task.description");
  }
  if (task.status !== undefined) input.status = asTaskStatus(task.status, "task.status");
  if (task.priority !== undefined) input.priority = asTaskPriority(task.priority, "task.priority");
  if (task.dueDate !== undefined) input.dueDate = asNullableString(task.dueDate, "task.dueDate");
  if (task.startDate !== undefined) {
    input.startDate = asNullableString(task.startDate, "task.startDate");
  }
  if (task.parentId !== undefined) input.parentId = asNullableString(task.parentId, "task.parentId");
  return input;
}

/** Validates a `TaskFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asTaskFieldChanges(value: unknown): UpdateTaskFields {
  const changes = asRecord(value);
  const patch: UpdateTaskFields = {};
  if (changes.title !== undefined) patch.title = asNonEmptyString(changes.title, "changes.title");
  if (changes.description !== undefined) {
    patch.description = asNullableString(changes.description, "changes.description");
  }
  if (changes.status !== undefined) patch.status = asTaskStatus(changes.status, "changes.status");
  if (changes.priority !== undefined) {
    patch.priority = asTaskPriority(changes.priority, "changes.priority");
  }
  if (changes.dueDate !== undefined) {
    patch.dueDate = asNullableString(changes.dueDate, "changes.dueDate");
  }
  if (changes.startDate !== undefined) {
    patch.startDate = asNullableString(changes.startDate, "changes.startDate");
  }
  return patch;
}

function requireDb(): NexusDatabase {
  if (!db) throw new Error("Database is not open.");
  return db;
}

function taskStore(profileId: string): TaskStore {
  return new TaskStore(requireDb().raw, profileId);
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.profilesList, (event): Profile[] => {
    assertTrustedSender(event);
    return listProfiles(requireDb());
  });

  ipcMain.handle(IpcChannel.profilesRename, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const id = asNonEmptyString(body.id, "id");
    const name = asProfileName(body.name, "name");
    renameProfile(requireDb(), id, name);
  });

  ipcMain.handle(IpcChannel.flagsGet, (event, payload): Promise<FlagState> => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return new SqliteFlagStore(requireDb().raw, profileId).get();
  });

  ipcMain.handle(IpcChannel.flagsSet, async (event, payload): Promise<void> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const moduleId = asNonEmptyString(body.moduleId, "moduleId");
    const enabled = asBoolean(body.enabled, "enabled");
    await new SqliteFlagStore(requireDb().raw, profileId).set(moduleId, enabled);
  });

  ipcMain.handle(IpcChannel.tasksList, (event, payload): Task[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return taskStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.tasksCreate, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    return taskStore(profileId).create(asNewTaskInput(body.task));
  });

  ipcMain.handle(IpcChannel.tasksUpdate, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return taskStore(profileId).update(id, asTaskFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.tasksSetDone, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const done = asBoolean(body.done, "done");
    return taskStore(profileId).setDone(id, done);
  });

  ipcMain.handle(IpcChannel.tasksDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    taskStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.tasksRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    taskStore(profileId).restore(id);
  });

  ipcMain.handle(IpcChannel.appInfo, (event): AppInfo => {
    assertTrustedSender(event);
    return appInfo();
  });
}

// --- Window (hardened) ------------------------------------------------------

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 720,
    show: false, // shown on ready-to-show to avoid a blank-white first paint
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true, // SEC-EL-01
      nodeIntegration: false, // SEC-EL-01
      sandbox: true, // SEC-EL-01
      // webSecurity is left at its secure default and never touched (SEC-EL-01).
    },
  });

  win.once("ready-to-show", () => win.show());

  // SEC-EL-03: deny every attempt to open a new window. The shell has no external
  // links yet; a vetted shell.openExternal wrapper lands with the first one.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // SEC-EL-03: lock navigation to the app's own document; block anything else.
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

// --- Smoke check ------------------------------------------------------------
//
// `--smoke`: prove the shell is wired end to end, then exit deterministically.
// Combines an authoritative main-side DB read with confirmation that the
// renderer completed a real window.nexus round trip (renderer -> preload -> IPC
// -> DB -> renderer). No extra IPC channel is added: the renderer flags its own
// readiness on `window`, which main reads via executeJavaScript.

async function runSmoke(win: BrowserWindow): Promise<void> {
  const profiles = listProfiles(requireDb());
  if (profiles.length < 1) {
    throw new Error("expected at least one profile after first-run seeding");
  }

  const rendererOk: unknown = await win.webContents.executeJavaScript(
    `new Promise((resolve) => {
       if (window.__nexusReady === true) return resolve(true);
       if (window.__nexusError === true) return resolve(false);
       window.addEventListener("nexus-ready", () => resolve(true), { once: true });
       window.addEventListener("nexus-error", () => resolve(false), { once: true });
       setTimeout(() => resolve(window.__nexusReady === true), 8000);
     })`,
  );
  if (rendererOk !== true) {
    throw new Error("renderer IPC round-trip did not succeed");
  }
}

function shutdown(code: number): void {
  try {
    db?.close();
  } catch {
    // best-effort close; we are exiting anyway
  }
  // Force-exit so the smoke run returns a deterministic code without waiting on
  // window / GPU teardown.
  app.exit(code);
}

// --- Lifecycle --------------------------------------------------------------

app.whenReady().then(() => {
  try {
    // ADR-001 / SEC-EL: the database lives ONLY in the main process; the renderer
    // reaches it exclusively through the typed IPC allowlist above.
    // ADR-004: PIN/keystore-derived key derivation is not built yet, so the file
    // is opened WITHOUT an encryptionKey. This is the honest current state, not a
    // placeholder — encryption at rest (SEC-DAR-01) lands with ADR-004.
    db = openDatabase({ path: databasePath() });
    seedFirstRunProfile(db);
    registerIpc();
    mainWindow = createWindow();

    if (isSmoke) {
      mainWindow.webContents.once("did-finish-load", () => {
        void runSmoke(mainWindow!)
          .then(() => {
            process.stdout.write("SMOKE OK\n");
            shutdown(0);
          })
          .catch((error: unknown) => {
            process.stderr.write(
              `SMOKE FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
            );
            shutdown(1);
          });
      });
    }
  } catch (error) {
    process.stderr.write(
      `Startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    shutdown(1);
  }

  app.on("activate", () => {
    if (!isSmoke && BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  try {
    db?.close();
  } catch {
    // ignore
  }
});

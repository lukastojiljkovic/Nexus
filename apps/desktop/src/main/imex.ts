import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import type { BrowserWindow } from "electron";
import { app, dialog } from "electron";
import { ZipFile } from "yazl";
import { buildExportArchive } from "@nexus/core";
import type {
  CardStore,
  DeckStore,
  DocumentStore,
  EventStore,
  ExamStore,
  FocusStore,
  NotificationStore,
  PlanStore,
  SqliteFlagStore,
  SubjectStore,
  TaskStore,
} from "@nexus/db";
import { localToday } from "./clock.js";
import type { ExportResult } from "../shared/ipc.js";

/**
 * Everything `handleExport` reads through, as plain functions rather than a
 * direct `requireDb()` dependency — mirrors `NotificationSchedulerDeps`
 * (`main/notifications.ts`): keeps this module decoupled from
 * `main/index.ts`'s module-level state, with every store swap explicit at the
 * call site.
 */
export interface ImexExportDeps {
  taskStore(profileId: string): TaskStore;
  eventStore(profileId: string): EventStore;
  documentStore(profileId: string): DocumentStore;
  subjectStore(profileId: string): SubjectStore;
  examStore(profileId: string): ExamStore;
  deckStore(profileId: string): DeckStore;
  cardStore(profileId: string): CardStore;
  planStore(profileId: string): PlanStore;
  focusStore(profileId: string): FocusStore;
  notificationStore(profileId: string): NotificationStore;
  flagStore(profileId: string): SqliteFlagStore;
  getMainWindow(): BrowserWindow | null;
}

/**
 * Full-export handler (IMEX slice a1, PRD 14 IMEX-001 / ADR-009): gathers one
 * profile's data through the stores main already owns, hands the plain arrays
 * to the pure `buildExportArchive` (`@nexus/core`), and streams the result
 * into a `.nexus.zip` at a path the user picks via a native save dialog.
 *
 * SEC-EL: the renderer never supplies a filesystem path — the dialog is the
 * only source of `filePath`, owned entirely by this main-process function.
 *
 * The archive ships in plaintext (no encryption): the founder deferred
 * encryption-at-rest as a whole to AUTH (2026-07-07), so there is no
 * encryption key to wrap it with yet. See `docs/deviations.md` (IMEX-001 /
 * SEC-DAR-02).
 */
export async function handleExport(
  deps: ImexExportDeps,
  profile: { id: string; name: string },
): Promise<ExportResult> {
  const win = deps.getMainWindow();
  const dialogOptions = {
    defaultPath: `nexus-export-${localToday()}.nexus.zip`,
    filters: [{ name: "Nexus arhiva", extensions: ["zip"] }],
  };
  const { canceled, filePath } = win
    ? await dialog.showSaveDialog(win, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);
  if (canceled || !filePath) return { canceled: true };

  const documentsStore = deps.documentStore(profile.id);
  const documents = documentsStore.listActive();

  const decksStore = deps.deckStore(profile.id);
  const decks = decksStore.listActive();

  const cardsStore = deps.cardStore(profile.id);
  const cards = decks.flatMap((deck) => cardsStore.listByDeck(deck.id));

  const plansStore = deps.planStore(profile.id);
  const plans = plansStore.listActive();
  const blocks = plans.flatMap((plan) => plansStore.listBlocks(plan.id));

  const notificationStore = deps.notificationStore(profile.id);
  const notificationSettings = notificationStore.getSettings();

  const archive = buildExportArchive({
    profile,
    appVersion: app.getVersion(),
    createdAt: new Date().toISOString(),
    settings: {
      flags: await deps.flagStore(profile.id).get(),
      notifications: {
        quietFrom: notificationSettings.quietFrom,
        quietTo: notificationSettings.quietTo,
        morningHour: notificationSettings.morningHour,
        enabledSources: notificationSettings.enabledSources,
      },
    },
    data: {
      tasks: deps.taskStore(profile.id).listActive(),
      events: deps.eventStore(profile.id).listActive(),
      documents,
      renewals: documents.flatMap((document) => documentsStore.listRenewals(document.id)),
      subjects: deps.subjectStore(profile.id).listActive(),
      exams: deps.examStore(profile.id).listActive(),
      decks,
      cards,
      reviewLog: cardsStore.listReviewLog(),
      plans,
      blocks,
      focusSessions: deps.focusStore(profile.id).listActive(),
      notifications: notificationStore.listAll(),
    },
    hash: (content) => createHash("sha256").update(content, "utf8").digest("hex"),
  });

  await writeZip(archive.files, filePath);

  return { canceled: false, path: filePath, totalRecords: archive.totalRecords };
}

/** Streams every archive file into a `.nexus.zip` at `path`, resolving only after the write stream's `close` event (yazl's own documented idiom). */
function writeZip(files: ReadonlyMap<string, string>, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const zipfile = new ZipFile();
    for (const [entryPath, content] of files) {
      zipfile.addBuffer(Buffer.from(content, "utf8"), entryPath);
    }

    const output = createWriteStream(path);
    output.on("close", resolve);
    output.on("error", reject);
    zipfile.outputStream.on("error", reject);
    zipfile.outputStream.pipe(output);
    zipfile.end();
  });
}

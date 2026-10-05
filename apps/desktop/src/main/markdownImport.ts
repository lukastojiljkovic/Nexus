import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { BrowserWindow, OpenDialogOptions } from "electron";
import { dialog } from "electron";
import { buildNoteUpdate, parseMarkdownNote } from "@nexus/core";
import type { NoteOrgStore, NoteStore } from "@nexus/db";
import { readFileBounded } from "./boundedRead.js";
import { compactNow } from "./notes.js";
import {
  MARKDOWN_IMPORT_MAX_BYTES,
  MARKDOWN_IMPORT_MAX_FILES,
  NOTE_UPDATE_MAX_BYTES,
} from "../shared/ipc.js";
import type {
  MarkdownImportResult,
  MarkdownImportSkip,
  MarkdownImportSkipCode,
  MarkdownImportSource,
} from "../shared/ipc.js";

/**
 * Markdown files into notes (IMEX-007's `.md` slice). The lighter sibling of
 * `restore.ts`'s archive flows: there is no manifest, no plan and no undo —
 * this reads somebody's plain `.md` files and writes each one as an ordinary
 * note, so there is nothing to preview and nothing that could replace what is
 * already here.
 *
 * SEC-EL, as everywhere main touches the filesystem: the renderer supplies no
 * path and no bytes. It names a target folder and which of the two dialogs to
 * open; the dialog is the only source of a path, `stat` gates every file
 * BEFORE it is read (the `handleDashboardPick` order, for the same reason: a
 * cap applied after the read is decorative), and only the counts come back.
 *
 * WHICH CREATION PATH — the same one the editor uses, and deliberately not a
 * bulk insert. `NoteStore.create` mints the row, `appendUpdate` writes the
 * document AND the denormalised title (it is the only method that sets a
 * title at all), and `compactNow` folds that update into the snapshot, which
 * is what writes `note_snapshots.plaintext` — the note's searchable body
 * (ADR-021 / SRCH-002) — and takes the first version-history checkpoint
 * (ADR-015). An imported note is therefore indistinguishable from a typed one
 * the moment it lands: search finds it, version history has it, the editor
 * opens it.
 *
 * That path's one real limit is inherited honestly: `appendUpdate` caps a
 * single update at `NOTE_UPDATE_MAX_BYTES`, so a file that parses to more than
 * that is refused BY NAME (`too-long`) — and refused before its note row is
 * created, so a refusal never leaves an empty note behind.
 */

/** Everything this module needs: two stores, one window to parent the dialog to, and a transaction runner. */
export interface MarkdownImportDeps {
  noteStore(profileId: string): NoteStore;
  noteOrgStore(profileId: string): NoteOrgStore;
  getMainWindow(): BrowserWindow | null;
  /** Runs `write` in one database transaction — one note's four store calls land whole or not at all. */
  runInTransaction<T>(write: () => T): T;
}

/** The extensions a file must carry to be read as markdown — checked in main, never inferred from the dialog's filter alone. */
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

/** How deep a folder pick is walked. Deep enough for any real note vault, shallow enough that no tree can make this run forever. */
const MAX_FOLDER_DEPTH = 8;

/** File order within a picked folder, so a vault imports in the order its author reads it. */
const COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/**
 * Opens the picker, reads what it returns and writes one note per file into
 * `folderId` (or the unfiled root when it is null).
 *
 * TWO dialogs, not one, and that is a platform fact rather than a preference:
 * Electron's `showOpenDialog` documents that `["openFile", "openDirectory"]`
 * cannot be combined on Windows and Linux — it silently shows a DIRECTORY
 * picker there — so a single button would take "choose files" away on the
 * platform this app ships on first. `source` picks which one opens.
 *
 * A folder pick walks its subfolders too, but every note still lands in the
 * ONE chosen folder: the note tree is the user's, and rebuilding somebody
 * else's directory layout inside it is not what "import these files" means.
 */
export async function handleMarkdownImport(
  deps: MarkdownImportDeps,
  profileId: string,
  folderId: string | null,
  source: MarkdownImportSource,
): Promise<MarkdownImportResult> {
  // Checked before the dialog: a bad folder id must not be discovered halfway
  // through a batch, with some notes already filed and the rest homeless.
  if (folderId !== null) {
    const folders = deps.noteOrgStore(profileId).listFolders();
    if (!folders.some((folder) => folder.id === folderId)) {
      throw new Error(`Invalid IPC payload: no note folder "${folderId}" in this profile.`);
    }
  }

  const picked = await pickPaths(deps.getMainWindow(), source);
  if (picked === null) return { canceled: true };

  const skipped: MarkdownImportSkip[] = [];
  // One cap for both pickers: a folder walk and a 5000-file multi-select are
  // the same request as far as this loop is concerned.
  const collected =
    source === "folder"
      ? await collectFromFolder(picked[0] ?? "")
      : {
          files: picked.slice(0, MARKDOWN_IMPORT_MAX_FILES),
          overflow: picked[MARKDOWN_IMPORT_MAX_FILES] ?? null,
        };
  if (collected.overflow !== null) {
    skipped.push({ name: basename(collected.overflow), reason: "too-many" });
  }

  const notes = deps.noteStore(profileId);
  let created = 0;
  let imagesAsText = 0;

  for (const path of collected.files) {
    const name = basename(path);
    const skip = (reason: MarkdownImportSkipCode): void => {
      skipped.push({ name, reason });
    };

    if (!MARKDOWN_EXTENSIONS.has(extname(name).toLowerCase())) {
      skip("not-markdown");
      continue;
    }

    // One open, with the cap measured against the file the bytes come from
    // (js/file-system-race, #27).
    const read = await readFileBounded(path, MARKDOWN_IMPORT_MAX_BYTES);
    if (read.status === "too-large") {
      skip("too-large");
      continue;
    }
    if (read.status !== "ok") {
      // Permissions, a file that vanished between the dialog and here, a name
      // the OS will not open, a directory under a file name: one bad file must
      // never cost the pick its good ones (the pickAttachmentFiles rule,
      // made visible instead of silent).
      skip("unreadable");
      continue;
    }
    const text = read.bytes.toString("utf8");

    const parsed = parseMarkdownNote(text, basename(name, extname(name)));
    if (parsed.blocks.length === 0) {
      skip("empty");
      continue;
    }
    const update = buildNoteUpdate(parsed.blocks);
    if (update.byteLength > NOTE_UPDATE_MAX_BYTES) {
      skip("too-long");
      continue;
    }

    deps.runInTransaction(() => {
      const now = new Date().toISOString();
      const note = notes.create(now);
      notes.appendUpdate(note.id, update, parsed.title, now);
      if (folderId !== null) notes.setFolder(note.id, folderId);
      // Not `compactIfNeeded`: one update never reaches the threshold, and an
      // imported note that is not in the search index until somebody edits it
      // is an imported note nobody can find.
      compactNow(notes, note.id);
    });
    created += 1;
    imagesAsText += parsed.imagesAsText;
  }

  return { canceled: false, created, skipped, imagesAsText };
}

/** The native dialog, per `source`; null when the user canceled or chose nothing. */
async function pickPaths(
  win: BrowserWindow | null,
  source: MarkdownImportSource,
): Promise<string[] | null> {
  const options: OpenDialogOptions =
    source === "folder"
      ? { properties: ["openDirectory"] }
      : {
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
        };
  const { canceled, filePaths } = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (canceled || filePaths.length === 0) return null;
  return filePaths;
}

/**
 * Every markdown file under `directory`, name-sorted, subfolders included down
 * to `MAX_FOLDER_DEPTH`. A directory that cannot be read is stepped over
 * rather than failing the walk, and symlinks are never followed —
 * `readdir(..., { withFileTypes: true })` reports one as neither a file nor a
 * directory, so a loop through one cannot exist.
 *
 * `overflow` is the name of the first entry the walk did NOT take, once it hit
 * `MARKDOWN_IMPORT_MAX_FILES`. It is reported as a named skip rather than
 * swallowed: importing the first 200 of 900 files without saying so is exactly
 * the kind of quiet half-result this codebase does not ship.
 */
async function collectFromFolder(
  directory: string,
): Promise<{ files: string[]; overflow: string | null }> {
  const files: string[] = [];
  let overflow: string | null = null;

  const walk = async (current: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => COLLATOR.compare(a.name, b.name));
    for (const entry of entries) {
      if (files.length >= MARKDOWN_IMPORT_MAX_FILES) {
        overflow ??= entry.name;
        return;
      }
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_FOLDER_DEPTH) await walk(path, depth + 1);
        continue;
      }
      if (entry.isFile() && MARKDOWN_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(path);
      }
    }
  };

  await walk(directory, 0);
  return { files, overflow };
}

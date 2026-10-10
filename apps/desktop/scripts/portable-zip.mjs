// The archive half of the portable build (ADR-102).
//
// WHY A ZIP AT ALL. The product is „copy a folder to a stick and run it", and
// the folder is what `dist-portable.mjs` builds. A zip is how that folder
// travels: one file on a release page, openable by every extractor Windows
// ships. The archive therefore holds ONE top-level folder rather than the
// folder's contents, so extracting it never scatters `Nexus.exe`, its DLLs and
// its resources into whatever directory somebody happened to be in.
//
// `yazl` is already this app's writer — the encrypted archive in
// `src/main/imex.ts` is built with it — so this adds no dependency and no
// third-party licence. `addFile` streams each entry instead of buffering it:
// an unpacked Electron app is hundreds of megabytes, and `addBuffer` would hold
// all of it in memory at once, which is the reason `imex.ts` streams its
// attachments too.

import { createWriteStream, readdirSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { ZipFile } from "yazl";

/**
 * Every entry under `dir` that is not a directory, as paths relative to it, in
 * a sorted walk. `base` is the directory the walk started from, so a
 * subdirectory's own files come back relative to THAT rather than to the
 * subdirectory — which is what makes the name `sub/x.dll` and not `x.dll`.
 *
 * Sorted so that two builds of the same tree write the same archive in the same
 * order — the difference a diff of two zips would otherwise be full of. Empty
 * directories are not listed here; a zip is a list of files, and the one empty
 * folder this build ships is added by name below.
 */
function filesUnder(dir, base = dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(full, base));
    // Everything that is not a directory goes in, including an entry a `Dirent`
    // does not classify (a symlink): a file silently missing from a shipped
    // application is a worse failure than the writer refusing what it cannot
    // read.
    else found.push(relative(base, full));
  }
  return found.sort();
}

/**
 * Writes `from`'s whole tree into `to` under one `entryRoot` folder, and
 * resolves once the archive is closed and the file handle is closed with it.
 *
 * `emptyDirectories` is the one thing a file walk cannot carry: the
 * `NexusData/` folder a portable build ships empty, so that a person who opens
 * the archive can see where the data will go before the first run.
 */
export function zipDirectory({ from, to, entryRoot, emptyDirectories = [] }) {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    const out = createWriteStream(to);
    // `close`, not `finish`: `finish` fires when the write side is done and the
    // handle may still be open, and a caller that renames or deletes the
    // archive on Windows needs the handle gone.
    out.once("close", resolve);
    out.once("error", reject);
    // An unreadable entry rejects the promise rather than emitting into
    // nothing: `addFile` reports a file it could not stat as an event on the
    // zip, and an archive quietly missing a DLL is the failure this whole
    // script exists to make loud.
    zip.once("error", reject);
    zip.outputStream.pipe(out);

    for (const name of emptyDirectories) {
      zip.addEmptyDirectory(posix.join(entryRoot, name));
    }
    for (const rel of filesUnder(from)) {
      // Forward slashes: the zip format's own separator, whatever the host
      // happens to use — an extractor on Windows reads both, one on Linux and
      // macOS reads only this one.
      zip.addFile(join(from, rel), posix.join(entryRoot, rel.split(sep).join("/")));
    }
    zip.end();
  });
}

// No shebang, for the reason every module in this directory has none: this one is
// imported by the pack builders and by their tests.
//
// WHY A HELPER RATHER THAN `existsSync(path) ? readFileSync(path) : null`, WHICH
// IS WHAT EVERY BUILDER USED TO WRITE. Two calls ask the file system about one
// NAME twice, and the first answer is not a promise about the second: the file
// can be deleted in between, so the read throws for a file that existed a moment
// ago, or be created, so the check says no and bytes that are there are never
// read. CodeQL reports the shape as `js/file-system-race`, and the report is
// right — the race is between this build and the maintainer's own machine, and
// the shape is what turns a cache miss into a stack trace. One call that answers
// `null` for a file that is not there has neither window.
//
// `ENOENT` IS THE ONLY ERROR ANSWERED AS "NOT THERE". A permission or I/O error
// still throws: a builder that treated an unreadable cache file as a miss would
// quietly re-download somebody else's archive, which is the one thing the cache
// exists to make visible rather than to hide.

import { readFileSync, statSync } from "node:fs";

/** The contents of `path` as bytes, `null` when there is no such file, and the same with an encoding. */
export function readIfPresent(path, encoding) {
  try {
    return encoding === undefined ? readFileSync(path) : readFileSync(path, encoding);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** The file's `Stats`, or `null` when there is no such file. For a size the caller needs before it reads. */
export function statIfPresent(path) {
  try {
    return statSync(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function isMissing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

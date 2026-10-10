// The third-party notices of the PLATFORM packages the installer about to be
// built actually carries — the ones `licences.json` leaves out on purpose.
//
// WHY THEY ARE MISSING FROM THE COMMITTED FILE. `generate-licences.mjs` writes
// ONE file that a Linux CI checkout and a Windows working copy both have to
// produce byte for byte, and a platform build is in one tree and not the other:
// `@img/sharp-win32-x64` is installed on Windows and absent on the Linux runner,
// and `@img/sharp-linux-x64` is the other way round. Crediting one of them in
// the committed file would make `check:licences` red on one of the two machines
// and would credit a package the OTHER machine does not ship. So the committed
// file credits neither, and the gap is named there in the generator's own
// comment rather than left for a reader to notice.
//
// WHY THE PACKAGING STEP CLOSES IT, AND HOW. `dist.mjs` runs on the machine it
// packages for — `dist-portable.mjs`'s own header says why: an installer is
// built by the platform that can run it. So the platform builds PRESENT in this
// tree are exactly the ones electron-builder copies into this target's installer
// (`@img/sharp-win32-x64` plus the libvips DLLs inside it on Windows;
// `@img/sharp-linux-x64` and `@img/sharp-libvips-linux-x64` on Linux; the
// `@node-llama-cpp/${os}-${arch}*` binaries beside them). Enumerating them from
// the installed tree rather than from a list written here is the point: a list
// would be a second declaration of what `electron-builder.yml` ships, and this
// repository has already paid once for a hand-kept list beside a generated one.
//
// THE NOTICES ARE NOT INVENTED EITHER. Each entry is read off the package's own
// licence files by `package-notice.mjs` — the same code, and therefore the same
// answer, the committed file is built from.

import { platformEntries, pnpmLicences } from "./package-notice.mjs";

/**
 * Every platform-scoped production package this tree holds, as notice entries in
 * `licences.json`'s shape, sorted by id.
 *
 * Takes pnpm's licence list as an argument so a test can hand it a fixture: the
 * reading is what the test is about, and a function that can only be exercised
 * against the real tree is a function that can only be observed passing.
 */
export function platformNoticeEntries(licences) {
  return platformEntries(licences);
}

/** `platformNoticeEntries` against the real tree. */
export function platformNoticeEntriesHere() {
  return platformNoticeEntries(pnpmLicences());
}

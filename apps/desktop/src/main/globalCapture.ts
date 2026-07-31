/**
 * The OS-level half of ADR-040 (TASK-002): one `globalShortcut` registration,
 * owned here so `index.ts` never has to remember what is currently held.
 *
 * All chord semantics — including which chords may become an accelerator at all
 * — live in `@nexus/core` and are tested there. What is left is the piece that
 * genuinely needs Electron: claiming the combination from the window manager,
 * and dealing with the fact that the claim can be refused.
 *
 * The swap order is the whole point of this module. A remap registers the NEW
 * accelerator first and only releases the old one once that succeeded, so a
 * combination another application already owns leaves the user exactly where
 * they were — still holding a working hotkey — rather than with none at all.
 */

import { globalShortcut } from "electron";

/** The accelerator this process currently holds, or `null` while it holds none. */
let registered: string | null = null;

/**
 * Claims `accelerator` for the app, releasing whatever it held before. Returns
 * whether the system granted it; on `false` nothing changed and the previous
 * registration is still live.
 *
 * `globalShortcut.register` answers `false` for a combination another
 * application owns, and throws for one Electron cannot parse — the second is
 * unreachable (the string is derived from validated chord fields by
 * `chordAccelerator`, never taken from the renderer) but is caught rather than
 * left to crash the handler on some future platform's parser.
 */
export function setGlobalCaptureAccelerator(accelerator: string, onFire: () => void): boolean {
  // Re-registering what is already held is what every boot does after the first
  // (the renderer re-sends its chord on each load); Electron treats a duplicate
  // registration as a failure, which would read as "taken by another app".
  if (accelerator === registered) return true;
  let granted: boolean;
  try {
    granted = globalShortcut.register(accelerator, onFire);
  } catch {
    granted = false;
  }
  if (!granted) return false;
  if (registered !== null) globalShortcut.unregister(registered);
  registered = accelerator;
  return true;
}

/**
 * Gives every registration back. Electron requires this before the process
 * exits, so `will-quit` calls it unconditionally — `unregisterAll` rather than
 * unregistering the one accelerator tracked here, because "the app holds
 * nothing when it is gone" is the property that matters and it must not depend
 * on this module's bookkeeping being right.
 */
export function releaseGlobalCapture(): void {
  globalShortcut.unregisterAll();
  registered = null;
}

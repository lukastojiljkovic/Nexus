/**
 * The serial port picker's arithmetic: what the user is offered, and which port
 * their answer names.
 *
 * **Why the choice is a dialog rather than Chromium's own chooser.** Electron
 * asks the app which port to hand to `navigator.serial.requestPort` through the
 * `select-serial-port` event; the browser's built-in chooser is not available to
 * an app that answers that event itself. So the picker is ours, it is a modal
 * dialog with the ports as its buttons, and the rule the task states is the one
 * this file keeps: **the app never picks for the user.** A port that arrives
 * without a click is a device somebody granted by accident, and the whole
 * subject of a serial port is that it can drive hardware.
 *
 * **Why the pure half is separated from the dialog.** A message box cannot be
 * tested and the mapping from a button index to a port id can: cancelling is an
 * empty string (Electron's own cancellation), a port with no display name is
 * named by its own id, and two ports that present the same name are told apart
 * by their ids rather than becoming one button. `serialPicker.ts` is the thin
 * Electron half, and this file imports `electron` for TYPES only — so a test can
 * read it without an Electron process anywhere.
 */

/** The parts of Electron's `SerialPort` this file uses. */
export interface SerialPortLike {
  readonly portId: string;
  readonly portName?: string;
  readonly displayName?: string;
}

/** One button per port, plus the cancel button, and the index that means „none". */
export interface PortButtons {
  readonly labels: readonly string[];
  /** The index of the cancel button — `labels.length`, which is what Electron's `cancelId` and this file's mapping agree on. */
  readonly cancelId: number;
}

/**
 * The buttons a picker offers, in the order the ports arrived.
 *
 * A port's name is what the OS calls it (`COM3`) and it is DATA rather than
 * copy — it is not translated, and this file never invents one. Where two ports
 * present the same name the id is appended, because two identical buttons are a
 * picker the user cannot answer.
 */
export function portButtons(ports: readonly SerialPortLike[]): PortButtons {
  const seen = new Map<string, number>();
  const labels = ports.map((port) => {
    const name = displayNameOf(port);
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${port.portId})`;
  });
  return { labels, cancelId: labels.length };
}

/** What the OS calls one port, falling back to its id — never the empty string. */
export function displayNameOf(port: SerialPortLike): string {
  const name = (port.displayName ?? port.portName ?? "").trim();
  return name === "" ? port.portId : name;
}

/**
 * The port a dialog's answer names, or `null` when the user cancelled.
 *
 * `null` and the empty string are different things on purpose: the caller turns
 * `null` into Electron's `callback("")` (which cancels the request) and a page
 * that sees nothing happen has been told the truth, where a guessed port would
 * have been a device the user never chose.
 */
export function chosenPortId(
  ports: readonly SerialPortLike[],
  response: number,
): string | null {
  const port = ports[response];
  return port === undefined ? null : port.portId;
}

/** The question the dialog asks, in the language main is writing in. */
export interface PortDialogCopy {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly cancel: string;
}

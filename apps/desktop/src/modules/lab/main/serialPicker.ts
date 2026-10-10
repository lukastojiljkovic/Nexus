import {
  BrowserWindow,
  dialog,
  type MessageBoxOptions,
  type Session,
  type SerialPort,
  type WebContents,
} from "electron";
import { LAB_DIALOG_COPY, dialogText } from "./dialogCopy.js";
import { chosenPortId, portButtons } from "./serialPorts.js";

/**
 * The app's answer to Electron's `select-serial-port`: a modal dialog with the
 * ports as its buttons, and the user's own click as the only way a port is ever
 * chosen.
 *
 * **Why this file is Electron and `serialPorts.ts` is not.** The mapping from a
 * button index to a port id is the part with a rule in it, and rules are
 * testable; `dialog.showMessageBox` and a session are not, under Vitest. So the
 * rule lives next door and this file is the wiring, which is the same split
 * `moduleIpc.ts` makes between itself and `moduleHost.ts`.
 *
 * **Why a cancelled dialog answers with an empty string.** That is Electron's
 * own cancellation for this event — the request fails and `requestPort` rejects,
 * which is the honest outcome of „the user did not pick a port". Auto-selecting
 * the first port instead would open a device the user never named.
 *
 * **Why the listener is registered once, at startup.** `select-serial-port`
 * fires on the SESSION, and a session that has no listener cancels every serial
 * request (Electron's documented default for the device events). Registering it
 * from `index.ts` when the session is prepared is what makes the fence
 * deliberate rather than accidental: without this file the app refuses Web
 * Serial entirely, which is the shipped default this module changes.
 */
export function installSerialPortPicker(ses: Session): void {
  ses.on("select-serial-port", (_event, portList, webContents, callback) => {
    // The listener must answer exactly once, and every path below does — a
    // pending request that never hears back leaves `requestPort` hanging.
    void (async () => {
      try {
        const ports: readonly SerialPort[] = portList;
        const buttons = portButtons(ports);
        const options: MessageBoxOptions = {
          type: "question",
          title: dialogText(LAB_DIALOG_COPY.portTitle),
          message: dialogText(LAB_DIALOG_COPY.portMessage),
          detail: dialogText(LAB_DIALOG_COPY.portDetail),
          buttons: [...buttons.labels, `${dialogText(LAB_DIALOG_COPY.cancel)}`],
          cancelId: buttons.cancelId,
          // The OS draws checkboxes for „do not ask again" on its own; nothing
          // here remembers a choice, so the link is suppressed rather than
          // offering a decision this app cannot honour.
          noLink: true,
        };
        const owner = dialogWindow(webContents);
        // `showMessageBox` takes the window as an argument when there is one, so
        // the call is made in both shapes rather than casting a null through.
        const { response } =
          owner === null
            ? await dialog.showMessageBox(options)
            : await dialog.showMessageBox(owner, options);
        callback(chosenPortId(ports, response) ?? "");
      } catch (error) {
        // A dialog that could not open cancels the request rather than leaving
        // it pending, and the failure is logged because a user who saw nothing
        // happen deserves an answer somewhere.
        console.error(
          `Nexus: the serial port picker could not be shown — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        callback("");
      }
    })();
  });
}

/**
 * The window the dialog is modal to: the one that asked, or the app's own when
 * it has gone — `showMessageBox` takes no window and opens a standalone dialog,
 * which is the right answer for a request whose page has closed.
 */
function dialogWindow(webContents: WebContents): BrowserWindow | null {
  const owner = BrowserWindow.fromWebContents(webContents) ?? BrowserWindow.getFocusedWindow();
  return owner !== null && !owner.isDestroyed() ? owner : null;
}

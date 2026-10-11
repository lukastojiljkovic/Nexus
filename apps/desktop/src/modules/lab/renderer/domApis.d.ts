/**
 * Web Serial and the Battery Status API, as ambient declarations.
 *
 * **Why they are here rather than in TypeScript's DOM library.** Neither is in
 * it: `getBattery` left the standard (the API is Chromium-only in practice) and
 * `navigator.serial` was never added, so both were „Property does not exist on
 * type 'Navigator'" for this module's page. The alternatives were a dependency
 * on `@types/w3c-web-serial` — a package for two interfaces — or these twenty
 * lines, and the file follows `renderer/src/env.d.ts`'s shape for the same
 * reason: what a renderer adds to the DOM lib belongs in a `.d.ts` beside the
 * code that needs it.
 *
 * **The declarations are the SUBSET this page uses**, deliberately and not as a
 * transcription of either specification. An interface nobody implements fully
 * is a promise this repository cannot keep, and the parts left out are exactly
 * the parts no page here calls.
 */
export {};

declare global {
  /** One serial device, as the renderer sees the port the user picked. */
  interface SerialPort {
    readonly readable: ReadableStream<Uint8Array> | null;
    readonly writable: WritableStream<Uint8Array> | null;
    open(options: {
      baudRate: number;
      dataBits?: number;
      stopBits?: number;
      parity?: string;
    }): Promise<void>;
    close(): Promise<void>;
    /** The device's own identity, where the driver reports one. */
    getInfo(): { readonly usbVendorId?: number; readonly usbProductId?: number };
  }

  interface Serial {
    /**
     * Opens main's port picker and answers with the port the user chose.
     *
     * The specification requires a transient activation — a real click — which is
     * why this module's „choose a port" button is the only caller there is.
     */
    requestPort(): Promise<SerialPort>;
  }

  /** The machine's own battery as Chromium reports it: a level and whether it is charging. */
  interface BatteryManager extends EventTarget {
    readonly charging: boolean;
    /** `0`…`1`. */
    readonly level: number;
  }

  interface Navigator {
    readonly serial: Serial;
    getBattery(): Promise<BatteryManager>;
  }
}

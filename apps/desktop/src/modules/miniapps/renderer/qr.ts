/**
 * The QR reader's worker bridge: pixels handed off, text handed back.
 *
 * **Why a worker.** A decode is tens of milliseconds of straight CPU on a
 * photograph, and this module's own rules say heavy computation belongs off the
 * thread that draws the window - so the pixels go to `qr.worker.ts`, whose
 * buffer is TRANSFERRED rather than copied (nothing on this side needs them
 * again), and only a string comes back.
 *
 * **The fallback is real and its limit is stated.** A build whose worker cannot
 * be constructed - a bundler that did not emit the chunk - decodes on this
 * thread instead: slower, but working. That path is only taken BEFORE anything
 * is transferred, which is why the order below matters: a worker that answers
 * with an error, rather than failing to exist, has already taken the buffer and
 * the honest answer for it is "no text" plus a line in the log.
 */
import { MAX_QR_PIXELS, decodeRgba, type RgbaImage } from "./qrDecode.js";

/** The text of the QR code in that image, or `null` when there is none to read. */
export async function decodeOffThread(image: RgbaImage): Promise<string | null> {
  if (image.width * image.height > MAX_QR_PIXELS) return null;

  let worker: Worker;
  try {
    worker = new Worker(new URL("./qr.worker.ts", import.meta.url), { type: "module" });
  } catch (error) {
    console.error("Nexus: the QR worker could not be started; decoding on this thread:", error);
    return decodeRgba(image);
  }

  return await new Promise<string | null>((resolve) => {
    const finish = (answer: string | null): void => {
      worker.terminate();
      resolve(answer);
    };
    worker.onmessage = (event: MessageEvent<string | null>) => finish(event.data);
    worker.onerror = (event: ErrorEvent) => {
      console.error("Nexus: the QR worker failed:", event.message);
      finish(null);
    };
    worker.postMessage(image, [image.rgba.buffer]);
  });
}
